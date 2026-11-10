import { agentCollectionSource, addCollectionTools } from "./agent-collection";
import { sectionGenerator } from "./generate";
import type { AgentProtectionService } from "../../features/agent-protection/service";
import type { PluginModule } from "../../plugins/api";
import { SparklesIcon, ArrowRightIcon } from "../../shared/design-system/icons";
import { createSmartSections } from "../../features/smart-sections/runtime";
import {
  definitions,
  pageTarget,
  parseInput,
  record,
  removeDefinition,
  scopeOf,
  sectionId,
} from "../../features/smart-sections/model";
import type { SidebarSectionRow } from "../../features/channel-navigation/sidebar-sections-service";
import { activeAgents } from "./active-agents";
import { SmartSectionsPage } from "./page";

export const inject = [
  "relay",
  "decisions",
  "agents",
  "pages",
  "navigation",
  "panels",
];
export const apply: PluginModule["apply"] = (ctx) => {
  const service = createSmartSections(ctx.relay, ctx.decisions);
  let inference: AgentProtectionService | undefined;
  ctx.inject(["agentProtection"], (scope) => {
    inference = scope.agentProtection;
    scope.effect(() => () => {
      inference = undefined;
    });
  });
  const generator = sectionGenerator(ctx.relay, service, () => inference);
  ctx.provide("smartSections", service);
  ctx.effect(() => service.register(activeAgents));
  ctx.effect(() => service.register(agentCollectionSource(ctx.agents)));
  addCollectionTools(ctx.agents, service);
  ctx.effect(() => () => service.dispose());
  ctx.pages.register({
    id: "sections",
    title: "Smart sections",
    primary: true,
    layout: "workspace",
    route: {
      version: 1,
      validate(value) {
        try {
          const params = record(value);
          return (
            Object.keys(params).every(
              (key) => key === "section" || key === "item",
            ) &&
            typeof params.section === "string" &&
            sectionId.test(params.section) &&
            (params.item === undefined ||
              (typeof params.item === "string" && params.item.length <= 512))
          );
        } catch {
          return false;
        }
      },
    },
    component: (props) => (
      <SmartSectionsPage
        {...props}
        service={service}
        relay={ctx.relay}
        navigator={ctx.navigation}
        panels={ctx.panels}
        generator={generator}
      />
    ),
  });
  // The host renders ordinary contributed sections. This plugin owns only their
  // query/result state, not rail geometry or arbitrary model-generated UI.
  ctx.inject(["sidebarSections"], (scope) => {
    const registry = scope.sidebarSections;
    if (!registry) return;
    scope.effect(() => {
      const registered = new Map<
        string,
        {
          revision: string;
          partition: string;
          remove(): void;
          rows: readonly SidebarSectionRow[];
          listeners: Set<() => void>;
        }
      >();
      const bind = () => {
        const connection = ctx.relay.snapshot(),
          destination = scopeOf(connection);
        const states = service.snapshot();
        for (const [id, entry] of registered) {
          if (
            entry.partition !== connection.scope ||
            !states.some(
              (state) =>
                state.definition.id === id &&
                state.definition.revision === entry.revision,
            )
          ) {
            entry.remove();
            registered.delete(id);
          }
        }
        if (!destination || !connection.scope) return;
        for (const state of states) {
          const { definition } = state;
          let entry = registered.get(definition.id);
          if (!entry) {
            entry = {
              revision: definition.revision,
              partition: connection.scope,
              remove: () => {},
              rows: [],
              listeners: new Set(),
            };
            const held = entry;
            registered.set(definition.id, entry);
            entry.remove = registry.register({
              version: 1,
              id: `section-${definition.id}`,
              title: definition.title,
              listTarget: pageTarget(destination, definition.id),
              icon: <SparklesIcon size={16} />,
              rows: {
                snapshot: () => held.rows,
                subscribe(listener) {
                  held.listeners.add(listener);
                  return () => {
                    held.listeners.delete(listener);
                  };
                },
              },
              select(row) {
                const item = service
                  .snapshot()
                  .find((section) => section.definition.id === definition.id)
                  ?.items.find((item) => item.id === row.id);
                return (
                  item?.target ??
                  pageTarget(
                    destination,
                    definition.id,
                    item?.url ? item.id : undefined,
                  )
                );
              },
              actions: [
                {
                  id: "manage",
                  label: `Manage ${definition.title}`,
                  icon: <SparklesIcon size={14} />,
                  onSelect: async () => {
                    await ctx.navigation.open(
                      pageTarget(destination, definition.id),
                    );
                  },
                },
              ],
            });
          }
          entry.rows = [
            ...state.items.slice(0, definition.limit).map((item) => ({
              id: item.id,
              label: item.label,
              icon: <SparklesIcon size={16} />,
              badge: item.status,
            })),
            {
              id: "view-all",
              label:
                state.status === "ready"
                  ? "View more"
                  : `View more · ${state.status}`,
              icon: <ArrowRightIcon size={16} />,
            },
          ];
          for (const listener of entry.listeners) listener();
        }
      };
      const off = service.subscribe(bind);
      bind();
      return () => {
        off();
        for (const entry of registered.values()) entry.remove();
      };
    });
  });
  ctx.agents.addTool({
    name: "smart_sections",
    description:
      "Create and maintain native Buzz sidebar smart sections for your owner when they ask. First discover sources, then preview actual membership, then save a typed definition. Use exact source config for facts (e.g. open PRs or active agents); criteria adds semantic matching through the user's selected Decisions provider. Unknown matches stay excluded. Data updates on this device while Buzz is open; definitions are account/community-scoped and local, not cross-device. list returns revision tokens; update/remove require expected_state. For flexible topics without a direct source, research real facts using your tools, then use smart_sections_deliver to publish an agent-maintained collection with sourced rows and a refresh plan. Sections can cover quotes, research, summaries and other data you can actually access. Never invent data or access. Do not install another Attention timer.",
    inputSchema: {
      type: "object",
      required: ["action"],
      additionalProperties: false,
      properties: {
        action: {
          enum: ["sources", "list", "preview", "save", "remove", "refresh"],
        },
        id: { type: "string" },
        expected_state: { type: "string" },
        definition: {
          type: "object",
          required: [
            "title",
            "request",
            "source",
            "config",
            "criteria",
            "limit",
            "paused",
          ],
          properties: {
            title: { type: "string" },
            request: { type: "string" },
            source: { type: "string" },
            config: { type: "object" },
            criteria: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 20 },
            paused: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async call(client, _context, args) {
      if (args.action === "sources")
        return JSON.stringify(
          service.sources().map(({ id, title, description, configSchema }) => ({
            id,
            title,
            description,
            configSchema,
          })),
        );
      const connection = ctx.agents.relay(client.key)?.snapshot();
      if (connection?.status !== "ready" || !connection.scope)
        throw new Error("This agent needs a connected community first");
      const partition = connection.scope;
      if (args.action === "list")
        return JSON.stringify({
          definitions: definitions(partition),
          results:
            partition === ctx.relay.snapshot().scope ? service.snapshot() : [],
          local_only: true,
        });
      if (args.action === "preview")
        return JSON.stringify(
          await service.preview(connection, parseInput(args.definition)),
        );
      if (args.id !== undefined && typeof args.id !== "string")
        throw new Error("id must be a string");
      if (args.action === "save")
        return JSON.stringify(
          service.save(
            partition,
            args.definition,
            typeof args.id === "string" ? args.id : undefined,
            typeof args.expected_state === "string"
              ? args.expected_state
              : undefined,
          ),
        );
      if (typeof args.id !== "string") throw new Error("id is required");
      if (args.action === "remove") {
        if (typeof args.expected_state !== "string")
          throw new Error("expected_state is required");
        removeDefinition(partition, args.id, args.expected_state);
        return "Removed section on this device.";
      }
      if (args.action === "refresh") {
        if (partition !== ctx.relay.snapshot().scope)
          throw new Error(
            "Open this community in Buzz to refresh its sections",
          );
        await service.refresh(args.id);
        return "Source refreshed; semantic matching may still be updating.";
      }
      throw new Error("Unknown smart_sections action");
    },
  });
};
