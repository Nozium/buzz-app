import type { ChannelSummary } from "../../features/relay/contracts";
import type { SearchUsage } from "../../features/search/usage";
import type { RailEntry } from "./rail-pins";

/** Score each agent once using one membership index, not roster scans from the
 * sort comparator. The search usage owner retains ranking/decay semantics. */
export function preferredRailAgents(
  agents: readonly RailEntry[],
  channels: readonly ChannelSummary[],
  usage: SearchUsage,
): readonly RailEntry[] {
  const memberships = new Map<string, string[]>();
  for (const channel of channels)
    for (const member of new Set(channel.members)) {
      const keys = memberships.get(member) ?? [];
      keys.push(`channel:${channel.id}`);
      memberships.set(member, keys);
    }
  return agents
    .map((entry) => {
      const pubkey = entry.id.slice("agent:".length);
      return {
        entry,
        score: usage.boost(
          `person:${pubkey}`,
          ...(memberships.get(pubkey) ?? []),
        ),
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label),
    )
    .slice(0, 4)
    .map(({ entry }) => entry);
}
