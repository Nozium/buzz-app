import type { OpenTarget, NavigationScope } from "../navigation/targets";
import type { RelaySnapshot } from "../relay/service";
import { readView, replaceView, viewRevision } from "../../shared/view-state";

export type Definition = Readonly<{
  version: 1;
  id: string;
  revision: string;
  title: string;
  request: string;
  source: string;
  config: Readonly<Record<string, unknown>>;
  criteria: string;
  limit: number;
  paused: boolean;
}>;
export type SectionInput = Omit<Definition, "version" | "id" | "revision">;
export type Entity = Readonly<{
  id: string;
  label: string;
  subtitle: string;
  status: string;
  updatedAt: number;
  text: string;
  target?: OpenTarget;
  url?: string;
}>;
export type FeedState = Readonly<{
  items: readonly Entity[];
  status: "loading" | "ready" | "error";
  partial?: boolean;
  error?: string;
  note?: string;
}>;
export type Feed = {
  snapshot(): FeedState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  dispose(): void;
};
export type Source = {
  id: string;
  title: string;
  description: string;
  configSchema: Record<string, unknown>;
  fields: readonly { key: string; label: string; placeholder: string }[];
  parse(config: Readonly<Record<string, unknown>>): Record<string, unknown>;
  open(connection: RelaySnapshot, config: Record<string, unknown>): Feed;
};
export type SectionState = Readonly<{
  definition: Definition;
  items: readonly Entity[];
  status: "loading" | "ready" | "stale" | "paused" | "unavailable";
  note: string;
  unknown: number;
  partial: boolean;
}>;
export const KEY = "smart-sections.v1";
export const sectionId = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function scopeOf(
  connection: RelaySnapshot,
): NavigationScope | undefined {
  return connection.viewer && connection.origin
    ? { viewer: connection.viewer, communityOrigin: connection.origin }
    : undefined;
}
export function pageTarget(
  scope: NavigationScope,
  section?: string,
  item?: string,
): OpenTarget {
  return {
    version: 1,
    kind: "page",
    pluginId: "buzz.smart-sections",
    pageId: "sections",
    scope,
    ...(section
      ? {
          route: { version: 1, params: { section, ...(item ? { item } : {}) } },
        }
      : {}),
  };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(
      `Expected ${required ? "nonempty " : ""}text of at most ${max} characters`,
    );
  return value.trim();
}
export function parseInput(value: unknown): SectionInput {
  const input = record(value);
  const config = record(input.config);
  if (JSON.stringify(config).length > 4096)
    throw new Error("Source configuration is too large");
  const source = bounded(input.source, 128, true);
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(source))
    throw new Error("Invalid source ID");
  if (
    !Number.isInteger(input.limit) ||
    Number(input.limit) < 1 ||
    Number(input.limit) > 20
  )
    throw new Error("Visible row limit must be between 1 and 20");
  if (typeof input.paused !== "boolean")
    throw new Error("paused must be a boolean");
  return {
    title: bounded(input.title, 100, true),
    request: bounded(input.request, 2000),
    source,
    config,
    criteria: bounded(input.criteria, 2000),
    limit: Number(input.limit),
    paused: input.paused,
  };
}
export function definitions(scope: string): readonly Definition[] {
  const raw = readView<unknown>(scope, KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 30)
    .flatMap((value) => {
      try {
        const row = record(value);
        if (
          row.version !== 1 ||
          typeof row.id !== "string" ||
          !sectionId.test(row.id) ||
          typeof row.revision !== "string" ||
          !sectionId.test(row.revision)
        )
          return [];
        return [
          {
            ...parseInput(row),
            version: 1 as const,
            id: row.id,
            revision: row.revision,
          },
        ];
      } catch {
        return [];
      }
    })
    .filter(
      (row, index, rows) =>
        rows.findIndex((other) => other.id === row.id) === index,
    );
}
/** Per-definition revisions reject stale edits; replaceView also catches foreground list changes.
 * Like other device preferences this is not a cross-window transaction. */
export function saveDefinition(
  scope: string,
  input: unknown,
  id?: string,
  expected?: string,
): Definition {
  const revision = viewRevision(scope, KEY);
  const rows = definitions(scope);
  const old = id ? rows.find((row) => row.id === id) : undefined;
  if (id && (!old || old.revision !== expected))
    throw new Error("Section changed. Read it again before editing.");
  if (!id && rows.length >= 30)
    throw new Error(
      "This device supports up to 30 smart sections per community",
    );
  const row: Definition = {
    ...parseInput(input),
    version: 1,
    id: id ?? crypto.randomUUID(),
    revision: crypto.randomUUID(),
  };
  const result = replaceView(
    scope,
    KEY,
    revision,
    old
      ? rows.map((item) => (item.id === old.id ? row : item))
      : [...rows, row],
  );
  if (result !== "saved")
    throw new Error(
      result === "changed"
        ? "Sections changed. Try again."
        : "Couldn’t save sections on this device.",
    );
  return row;
}
export function removeDefinition(scope: string, id: string, expected: string) {
  const revision = viewRevision(scope, KEY),
    rows = definitions(scope);
  if (rows.find((row) => row.id === id)?.revision !== expected)
    throw new Error("Section changed. Read it again before removing.");
  if (
    replaceView(
      scope,
      KEY,
      revision,
      rows.filter((row) => row.id !== id),
    ) !== "saved"
  )
    throw new Error("Couldn’t remove section. Read it again and retry.");
}
