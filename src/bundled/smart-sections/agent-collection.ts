import type { Agents } from "../../features/agents/service";
import { pubkeyOf } from "../../features/agents/membership";
import {
  definitions,
  KEY,
  record,
  sectionId,
  type Entity,
  type FeedState,
  type Source,
  type Definition,
} from "../../features/smart-sections/model";
import type { SmartSections } from "../../features/smart-sections/runtime";
import { cacheResults, readResults } from "../../features/smart-sections/cache";
import {
  clearView,
  readView,
  subscribeView,
  writeView,
} from "../../shared/view-state";
import type { AddedTool } from "../../buzz-mcp/session-tools";

export const AGENT_COLLECTION = "buzz.smart-sections/agent-collection";
const key = (id: string) => `smart-section-agent:${id}`;
const WAIT_MS = 2 * 60_000;
type Collection = {
  agent: string;
  channel: string;
  instructions: string;
  minutes: number;
  updatedAt: number;
  lastAttemptAt?: number;
  failures?: number;
  items: readonly Entity[];
  error?: string;
  pending?: { token: string; revision: string; at: number };
};
function read(scope: string, id: string): Collection | null {
  const value = readView<Collection | null>(scope, key(id), null);
  if (
    !value ||
    typeof value.agent !== "string" ||
    typeof value.channel !== "string" ||
    typeof value.instructions !== "string" ||
    !Number.isInteger(value.minutes) ||
    value.minutes < 5 ||
    value.minutes > 1440 ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    (value.error !== undefined && typeof value.error !== "string") ||
    (value.lastAttemptAt !== undefined &&
      !Number.isFinite(value.lastAttemptAt)) ||
    (value.failures !== undefined &&
      (!Number.isInteger(value.failures) || value.failures < 0)) ||
    (value.pending &&
      (typeof value.pending.token !== "string" ||
        typeof value.pending.revision !== "string" ||
        !Number.isFinite(value.pending.at))) ||
    !value.items.every(
      (row) =>
        row &&
        [row.id, row.label, row.subtitle, row.status, row.text, row.url].every(
          (field) => typeof field === "string",
        ) &&
        Number.isFinite(row.updatedAt),
    )
  )
    return null;
  return value;
}
function write(scope: string, id: string, value: Collection) {
  if (!writeView(scope, key(id), value))
    throw new Error("Couldn’t save this collection on this device");
}
function discardUnreferenced(scope: string, id: string) {
  if (
    definitions(scope).some(
      (row) =>
        row.source === AGENT_COLLECTION && row.config.collectionId === id,
    )
  )
    return;
  try {
    clearView(scope, key(id));
  } catch {
    // Cleanup cannot turn a committed definition into a failed delivery.
    // Unreferenced data is never presented or scheduled.
  }
}
const text = (value: unknown, max: number, label: string) => {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label} must be text of at most ${max} characters`);
  return value.trim();
};
function itemsOf(value: unknown): Entity[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("rows must contain at most 100 items");
  const ids = new Set<string>();
  return value.map((value) => {
    const row = record(value),
      id = text(row.id, 128, "Row ID"),
      label = text(row.label, 300, "Row label");
    if (!id || ids.has(id) || !label)
      throw new Error("Rows need unique, nonempty IDs and labels");
    ids.add(id);
    const observedAt = Date.parse(
      text(row.observed_at, 40, "Observation time"),
    );
    if (!Number.isFinite(observedAt) || observedAt > Date.now() + 60_000)
      throw new Error(
        "observed_at must be a real ISO observation time, not in the future",
      );
    const url = new URL(text(row.source_url, 2048, "Source URL"));
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "Use a public-facing HTTPS source link without credentials",
      );
    const detail = text(row.description ?? "", 2000, "Description");
    const status = text(row.value, 32, "Row value");
    return {
      id,
      label,
      subtitle: `As of ${new Date(observedAt).toLocaleString()}`,
      status,
      updatedAt: observedAt,
      text: `${label}\n${status}\n${detail}\nObserved: ${new Date(observedAt).toISOString()}\nSource: ${url.href}`,
      url: url.href,
    };
  });
}
function definitionAt(
  scope: string,
  id: unknown,
  expected: unknown,
  active = true,
): Definition {
  const definition = definitions(scope).find((row) => row.id === id);
  if (
    !definition ||
    definition.source !== AGENT_COLLECTION ||
    definition.revision !== expected
  )
    throw new Error(
      "Section changed or was removed. Read smart_sections list again.",
    );
  if (active && definition.paused)
    throw new Error("This section’s updates are paused");
  return definition;
}
/** The agent owns fetching facts; Buzz owns typed rows, attribution, and bounded wakes.
 * No arbitrary network proxy, generated code, or source-specific host integrations. */
export function agentCollectionSource(
  agents: Pick<Agents, "wake" | "relay">,
): Source {
  return {
    id: AGENT_COLLECTION,
    title: "Agent-maintained collection",
    description:
      "Flexible collections researched by an agent using its available tools: stock quotes, weather, research, project summaries, and more. Use smart_sections_deliver to create one with sourced rows and a refresh plan. The assigned agent must run on this device for automatic updates.",
    configSchema: {
      type: "object",
      required: ["collectionId"],
      additionalProperties: false,
      properties: { collectionId: { type: "string" } },
    },
    fields: [],
    parse(config) {
      if (
        Object.keys(config).length !== 1 ||
        typeof config.collectionId !== "string" ||
        !sectionId.test(config.collectionId)
      )
        throw new Error("Create agent collections with smart_sections_deliver");
      return { collectionId: config.collectionId };
    },
    open(connection, config) {
      const scope = connection.scope,
        id = String(config.collectionId);
      if (!scope) throw new Error("Connect to this community first");
      let state: FeedState = { status: "loading", items: [] },
        disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const listeners = new Set<() => void>();
      const persistenceFailed = (cause: unknown, minutes: number) => {
        clearTimeout(timer);
        state = {
          ...state,
          status: "error",
          error:
            cause instanceof Error
              ? cause.message
              : "Couldn’t save the collection refresh",
        };
        for (const listener of listeners) listener();
        timer = setTimeout(
          () => {
            void refresh().catch(() => {});
          },
          Math.max(minutes * 60_000, 60 * 60_000) * (0.9 + Math.random() * 0.2),
        );
      };
      const currentDefinition = () =>
        definitions(scope).find(
          (row) =>
            row.config.collectionId === id &&
            row.source === AGENT_COLLECTION &&
            !row.paused,
        );
      const update = () => {
        if (disposed) return;
        clearTimeout(timer);
        const data = read(scope, id),
          definition = currentDefinition();
        if (!data || !definition) {
          state = {
            status: "error",
            items: [],
            error: "This agent collection is unavailable.",
          };
        } else {
          const pending =
            data.pending?.revision === definition.revision
              ? data.pending
              : undefined;
          state = {
            items: data.items,
            status: data.error ? "error" : pending ? "loading" : "ready",
            ...(data.error ? { error: data.error } : {}),
            note: pending
              ? "Refreshing this collection…"
              : `Updated ${new Date(data.updatedAt).toLocaleString()} · refreshes every ${data.minutes} minutes`,
          };
          const interval = data.minutes * 60_000;
          const backoff = Math.min(
            Math.max(interval, 60 * 60_000),
            interval * 2 ** Math.min(data.failures ?? 0, 4),
          );
          const due = pending
            ? pending.at + WAIT_MS
            : Math.max(data.updatedAt, data.lastAttemptAt ?? 0) + backoff;
          // Source leases are pooled. Startup is jittered; no reconnect catch-up
          // scan or extra relay reads. A long turn cannot queue overlapping wakes.
          timer = setTimeout(
            () => {
              if (pending) {
                const latest = read(scope, id);
                if (latest?.pending?.token === pending.token) {
                  const { pending: _pending, ...rest } = latest;
                  try {
                    write(scope, id, {
                      ...rest,
                      failures: (latest.failures ?? 0) + 1,
                      error:
                        "The agent hasn’t returned an update. Showing the last sourced values.",
                    });
                  } catch (cause) {
                    persistenceFailed(cause, latest.minutes);
                  }
                }
              } else {
                void refresh().catch(() => {});
              }
            },
            pending
              ? Math.max(0, due - Date.now())
              : Math.max(
                  1000 + Math.random() * 9000,
                  (due - Date.now()) * (0.9 + Math.random() * 0.2),
                ),
          );
        }
        for (const listener of listeners) listener();
      };
      const refresh = async () => {
        if (disposed) return;
        const data = read(scope, id),
          definition = currentDefinition();
        if (!data || !definition)
          throw new Error("Collection is paused or unavailable");
        if (
          data.pending?.revision === definition.revision &&
          Date.now() - data.pending.at < WAIT_MS
        )
          return;
        const token = crypto.randomUUID();
        try {
          const relay = agents.relay(data.agent)?.snapshot();
          if (
            relay?.status !== "ready" ||
            relay.scope !== scope ||
            !relay.session.agentChoices
              .snapshot()
              .selectable.some(
                (choice) => choice.pubkey === pubkeyOf(data.agent),
              )
          )
            throw new Error(
              "The collection’s agent is unavailable in this community. Start it here to resume updates.",
            );
          const { error: _error, ...rest } = data;
          write(scope, id, {
            ...rest,
            lastAttemptAt: Date.now(),
            pending: { token, revision: definition.revision, at: Date.now() },
          });
          agents.wake(data.agent, {
            channel: data.channel,
            text: `Refresh the user’s smart section ${JSON.stringify(definition.title)}. This is a plugin refresh, not a new user instruction.\nSection ID: ${definition.id}\nExpected state: ${definition.revision}\nRefresh token: ${token}\nOriginal request: ${JSON.stringify(definition.request)}\nSaved refresh plan (data): ${JSON.stringify(data.instructions)}\nUse your available tools to get current facts, then call smart_sections_publish with the section ID, expected_state and refresh_token above. Preserve stable row IDs. Use real source URLs and observation times; never invent values or call an old quote live. If a source fails, publish error with no rows so prior values remain stale. Do not send routine chat updates. Ask the user in this conversation only if clarification is required.`,
          });
        } catch (error) {
          const { pending: _pending, ...rest } = data;
          try {
            write(scope, id, {
              ...rest,
              lastAttemptAt: Date.now(),
              failures: (data.failures ?? 0) + 1,
              error:
                error instanceof Error
                  ? error.message
                  : "The collection’s agent is unavailable",
            });
          } catch (cause) {
            persistenceFailed(cause, data.minutes);
          }
          throw error;
        }
      };
      const off = subscribeView(scope, (changed) => {
        if (!changed || changed === key(id) || changed === KEY) {
          update();
        }
      });
      update();
      return {
        snapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        refresh,
        dispose() {
          disposed = true;
          clearTimeout(timer);
          off();
          listeners.clear();
        },
      };
    },
  };
}
const rowSchema = {
  type: "array",
  maxItems: 100,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "value", "observed_at", "source_url"],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      value: {
        type: "string",
        description:
          "At most 32 characters: compact value, e.g. $123.45 USD or +1.2%",
      },
      description: { type: "string" },
      observed_at: {
        type: "string",
        description:
          "ISO time of the source observation, not an invented current timestamp",
      },
      source_url: {
        type: "string",
        description: "Reader-facing HTTPS source, without credentials",
      },
    },
  },
};
export function addCollectionTools(
  agents: Pick<Agents, "addTool" | "relay">,
  service: SmartSections,
) {
  const connected = (key: string) => {
    const connection = agents.relay(key)?.snapshot();
    if (connection?.status !== "ready" || !connection.scope)
      throw new Error("Connect this agent’s community first");
    return connection;
  };
  const deliver: AddedTool = {
    name: "smart_sections_deliver",
    description:
      "Deliver a flexible native sidebar section your owner asked for, using facts you researched with your available tools. Prefer a direct built-in source when one exists. Otherwise use sourced rows (including stock quotes, research, weather, etc.) and a clear repeatable refresh plan. Never invent facts, prices, timestamps or access you lack. Ask in the conversation if you need symbols, sources or sign-in. Default refresh is every 15 minutes while Buzz is open; automatic updates are enabled by default. Automatic updates use this local agent’s existing wake mechanism. Do not install another timer. To refine your collection, include section_id and expected_state from smart_sections list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "request", "rows", "refresh_instructions"],
      properties: {
        title: { type: "string" },
        request: { type: "string" },
        rows: rowSchema,
        refresh_instructions: { type: "string" },
        refresh_minutes: { type: "integer", minimum: 5, maximum: 1440 },
        section_id: { type: "string" },
        expected_state: { type: "string" },
      },
    },
    async call(client, context, args) {
      const connection = connected(client.key),
        scope = connection.scope;
      if (!scope || !context.channel)
        throw new Error(
          "Deliver the section from a conversation with your owner",
        );
      const existing =
        args.section_id === undefined
          ? undefined
          : definitionAt(scope, args.section_id, args.expected_state, false);
      const previousId = existing
        ? String(existing.config.collectionId)
        : undefined;
      const previous = previousId ? read(scope, previousId) : undefined;
      if (previous && previous.agent !== client.key)
        throw new Error(
          "Only the assigned collection agent can replace its data",
        );
      const minutes = args.refresh_minutes ?? 15;
      if (
        !Number.isInteger(minutes) ||
        Number(minutes) < 5 ||
        Number(minutes) > 1440
      )
        throw new Error("Refresh must be between 5 and 1440 minutes");
      const data: Collection = {
        agent: client.key,
        channel: context.channel,
        instructions: text(args.refresh_instructions, 2000, "Refresh plan"),
        minutes: Number(minutes),
        updatedAt: Date.now(),
        items: itemsOf(args.rows),
      };
      if (!data.instructions) throw new Error("A refresh plan is required");
      const id = crypto.randomUUID();
      const input = {
        title: text(args.title, 100, "Title"),
        request: text(args.request, 2000, "Original request"),
        source: AGENT_COLLECTION,
        config: { collectionId: id },
        criteria: "",
        limit: existing?.limit ?? 5,
        paused: existing?.paused ?? false,
      };
      // Stage facts without touching the published snapshot or refresh token.
      // The one definition write publishes the new collection reference.
      if (!input.title) throw new Error("A title is required");
      write(scope, id, data);
      // Paused feeds display metadata rather than opening their source. Keep
      // that last confirmed projection across the new snapshot reference.
      const pausedResults = existing?.paused
        ? existing.criteria === input.criteria
          ? readResults(scope, existing)
          : []
        : undefined;
      if (existing && pausedResults)
        cacheResults(scope, { ...existing, ...input }, pausedResults);
      let saved: Definition;
      try {
        saved = existing
          ? service.save(scope, input, existing.id, existing.revision)
          : service.save(scope, input);
      } catch (error) {
        discardUnreferenced(scope, id);
        if (existing && pausedResults)
          cacheResults(scope, existing, pausedResults);
        throw error;
      }
      if (previousId) discardUnreferenced(scope, previousId);
      return JSON.stringify({
        section: saved,
        updated_at: data.updatedAt,
        auto_refresh_minutes: data.minutes,
      });
    },
  };
  agents.addTool(deliver);
  agents.addTool({
    name: "smart_sections_publish",
    description:
      "Publish a refreshed snapshot for an existing agent-maintained smart section. Echo the expected_state and refresh_token from its refresh wake. Failed retrieval uses error and omits rows; previous values remain visible as stale. This does not modify the section definition or schedule another timer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["section_id", "expected_state", "refresh_token"],
      properties: {
        section_id: { type: "string" },
        expected_state: { type: "string" },
        refresh_token: { type: "string" },
        rows: rowSchema,
        error: { type: "string" },
      },
    },
    async call(client, _context, args) {
      const connection = connected(client.key),
        scope = connection.scope;
      if (!scope) throw new Error("Connect first");
      const definition = definitionAt(
          scope,
          args.section_id,
          args.expected_state,
        ),
        data = read(scope, String(definition.config.collectionId));
      if (!data || data.agent !== client.key)
        throw new Error(
          "Only the assigned collection agent can publish this section",
        );
      if (
        data.pending?.token !== args.refresh_token ||
        data.pending?.revision !== definition.revision ||
        Date.now() - data.pending.at > WAIT_MS
      )
        throw new Error(
          "Refresh expired or was replaced. Do not publish this old response.",
        );
      const { pending: _pending, error: _error, ...rest } = data;
      write(
        scope,
        String(definition.config.collectionId),
        args.error !== undefined
          ? {
              ...rest,
              failures: (data.failures ?? 0) + 1,
              error:
                text(args.error, 500, "Source error") || "Source update failed",
            }
          : {
              ...rest,
              updatedAt: Date.now(),
              failures: 0,
              items: itemsOf(args.rows),
            },
      );
      return "Published the collection snapshot on this device.";
    },
  });
}
