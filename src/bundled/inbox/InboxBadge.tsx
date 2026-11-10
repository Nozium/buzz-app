import { useSyncExternalStore } from "react";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import { CountBadge } from "../../shared/design-system/ui/CountBadge";
import { hasUnread } from "./InboxRow";

/** Sidebar count of unread Activity conversations: the total the hover card
 * leads with and the page's Unread switch lists. It reads the unread evidence
 * the sidebar already loads, and requests nothing. */
export function InboxBadge({ relay }: { relay: RelayData }) {
  const connection = useRelayConnection(relay);
  const { unread } = connection.session;
  const inbox = useSyncExternalStore(
    unread.subscribeInbox,
    unread.inbox,
    unread.inbox,
  );
  const count =
    connection.status === "ready" ? inbox.items.filter(hasUnread).length : 0;
  return <CountBadge count={count} label={`${count} unread`} />;
}
