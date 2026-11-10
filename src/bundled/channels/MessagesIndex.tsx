import { InboxSheet } from "../inbox/InboxSheet";
import { messagesSheetRoute } from "./messages-sheet-route";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import { useEffect } from "react";
import type { RelayData } from "../../features/relay/service";
import type { Navigation } from "../../features/navigation/controller";
import type { PageNavigation } from "../../features/navigation/service";
import { useRelayConnection } from "../../features/relay/react";
import {
  ActivityFilters,
  ConversationList,
  useActivityView,
} from "../../features/conversation/ConversationList";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { ChatCircleIcon } from "../../shared/design-system/icons";
import styles from "./MessagesIndex.module.css";
import feedStyles from "../../features/conversation/FeedList.module.css";

/** The full collection lives in the reader; the rail keeps only recent messages. */
export function MessagesIndex({
  relay,
  navigator,
  navigation,
  host,
  extensions,
}: {
  host: ConversationHostServices;
  extensions: ConversationExtensions;
  relay: RelayData;
  navigator: Navigation;
  navigation?: PageNavigation;
}) {
  const connection = useRelayConnection(relay);
  const { viewer, scope } = connection;
  const [view, setView] = useActivityView(connection.scope ?? "disconnected");
  useEffect(() => {
    navigation?.complete({ status: "opened" });
  }, [navigation]);
  return (
    <section className={feedStyles.page} aria-label="Messages">
      <ActivityFilters view={view} onChange={setView} layout="collection" />
      {viewer && scope ? (
        <InboxSheet
          key={`${scope}:${connection.generation}`}
          id="messages"
          label="Messages"
          session={connection.session}
          scope={scope}
          host={host}
          extensions={extensions}
          navigation={navigation}
          route={messagesSheetRoute}
        >
          {(open, _close, isOpen) => (
            <div className={`${feedStyles.scroll} ${styles.list}`}>
              <ConversationList
                layout="feed"
                onOpen={open}
                isOpen={isOpen}
                session={connection.session}
                navigator={navigator}
                scope={{
                  viewer,
                  communityOrigin: scope.slice(0, -(viewer.length + 1)),
                }}
                target={
                  navigation?.target ?? {
                    version: 1,
                    kind: "page",
                    pluginId: "buzz.channels",
                    pageId: "channels",
                  }
                }
                view={view}
              />
            </div>
          )}
        </InboxSheet>
      ) : (
        <EmptyState
          icon={<ChatCircleIcon />}
          title={
            connection.status === "connecting"
              ? "Connecting…"
              : "Choose a community"
          }
          description="Your conversations appear here when connected."
        />
      )}
    </section>
  );
}
