import { readView, writeView } from "../../shared/view-state";
import { parseOpenTarget } from "../navigation/targets";
import type { Definition, Entity } from "./model";
const key = (definition: Definition) =>
  `smart-section-results:${definition.id}`;
const identity = (definition: Definition) =>
  JSON.stringify([definition.source, definition.config, definition.criteria]);
/** Only display metadata is cached; PR bodies and inference input stay in memory. */
export function readResults(
  scope: string,
  definition: Definition,
): readonly Entity[] {
  const saved = readView<{ identity?: string; items?: unknown }>(
    scope,
    key(definition),
    {},
  );
  if (saved.identity !== identity(definition) || !Array.isArray(saved.items))
    return [];
  return saved.items.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      ![row.id, row.label, row.subtitle, row.status].every(
        (value) => typeof value === "string" && value.length <= 1024,
      ) ||
      typeof row.updatedAt !== "number" ||
      !Number.isFinite(row.updatedAt)
    )
      return [];
    try {
      const target = row.target ? parseOpenTarget(row.target) : undefined;
      const url =
        typeof row.url === "string" &&
        /^https:\/\//.test(row.url) &&
        row.url.length <= 2048
          ? row.url
          : undefined;
      if (!target && !url) return [];
      return [
        {
          id: String(row.id),
          label: String(row.label),
          subtitle: String(row.subtitle),
          status: String(row.status),
          updatedAt: row.updatedAt,
          text: "",
          ...(target ? { target } : {}),
          ...(url ? { url } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}
export function cacheResults(
  scope: string,
  definition: Definition,
  items: readonly Entity[],
) {
  const value = {
    identity: identity(definition),
    items: items.map(({ text: _text, ...item }) => item),
  };
  if (
    JSON.stringify(readView(scope, key(definition), null)) !==
    JSON.stringify(value)
  )
    writeView(scope, key(definition), value);
}
