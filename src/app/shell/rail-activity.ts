import type { ChannelSummary } from "../../features/relay/contracts";
import type { IncomingMessage } from "../../features/relay/incoming";
import type { InboxItem } from "../../features/relay/inbox";
import type { RelaySession } from "../../features/relay/session";
import type { SearchUsage } from "../../features/search/usage";
import type { RailEntry } from "./rail-pins";

const newestFirst = (a: IncomingMessage, b: IncomingMessage) =>
  b.createdAt - a.createdAt || a.messageId.localeCompare(b.messageId);

/** Collapse each conversation before ranking. No message-by-roster searches or
 * sorting whole channel histories just to display five destinations. */
export function recentReceivedMessages(
  session: RelaySession,
  channels: readonly ChannelSummary[],
  inbox: readonly InboxItem[],
  excluded?: string,
): readonly IncomingMessage[] {
  const allowed = new Set(channels.map((channel) => channel.id));
  const latest = new Map<string, IncomingMessage>();
  const consider = (message: IncomingMessage) => {
    if (
      message.authorId === session.viewer ||
      message.audience === "agents" ||
      message.channelId === excluded ||
      !allowed.has(message.channelId)
    )
      return;
    const previous = latest.get(message.channelId);
    if (
      !previous ||
      message.messageId === previous.messageId ||
      newestFirst(message, previous) < 0
    )
      latest.set(message.channelId, message);
  };
  for (const item of inbox)
    consider({
      channelId: item.channelId,
      messageId: item.latestMessageId,
      authorId: item.authorId,
      createdAt: item.createdAt,
      previewContent: item.preview,
    });
  for (const channel of channels) {
    const head = session.unread.snapshot({
      kind: "channel",
      channelId: channel.id,
    }).latestTopLevel;
    if (head)
      consider({
        channelId: channel.id,
        messageId: head.id,
        authorId: head.authorId,
        createdAt: head.createdAt,
        previewContent: head.content,
      });
    for (const message of session.channels.window(channel.id).rows)
      if (!message.delivery)
        consider({
          channelId: channel.id,
          messageId: message.id,
          authorId: message.authorId,
          createdAt: message.createdAt,
          previewContent: message.content,
          ...(message.audience ? { audience: message.audience } : {}),
        });
  }
  return [...latest.values()].sort(newestFirst).slice(0, 5);
}

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
