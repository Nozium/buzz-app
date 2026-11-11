import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { Navigation } from "../../features/navigation/controller";
import type { PageNavigation } from "../../features/navigation/service";
import type { PagesReader } from "../../features/pages/service";
import type { SidebarSections } from "../../features/channel-navigation/sidebar-sections-service";
import { splitPartition } from "../../features/relay/partition";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { ChatCircleIcon } from "../../shared/design-system/icons";
import { RailNavigation } from "./RailNavigation";

/** Full lists reuse the rail's inventory, opening policy, and saved placements. */
export function RailSectionPage({
  section,
  relay,
  navigator,
  pages: reader,
  sidebarSections,
  navigation,
}: {
  section: string;
  relay: RelayData;
  navigator: Navigation;
  pages: PagesReader;
  sidebarSections?: SidebarSections | undefined;
  navigation?: PageNavigation | undefined;
}) {
  const connection = useRelayConnection(relay);
  const pages = useSyncExternalStore(reader.subscribe, reader.snapshot);
  const scope = connection.scope ? splitPartition(connection.scope) : undefined;
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!navigation || navigation.signal.aborted) return;
    if (navigation?.focus !== "preserve")
      content.current?.focus({ preventScroll: true });
    navigation?.complete({ status: "opened" });
  }, [navigation]);
  return (
    <div
      ref={content}
      tabIndex={-1}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      {scope ? (
        <RailNavigation
          key={connection.scope}
          pageSection={section}
          session={connection.session}
          scope={scope}
          navigator={navigator}
          pages={pages}
          selected="buzz.channels/channels"
          onSelect={(key) => {
            const page = pages.find((page) => page.key === key);
            if (page)
              void navigator.open({
                version: 1,
                kind: "page",
                pluginId: page.pluginId,
                pageId: page.id,
                scope,
              });
          }}
          sidebarSections={sidebarSections}
        />
      ) : (
        <EmptyState
          icon={<ChatCircleIcon />}
          title="Choose a community"
          description="Your sidebar lists appear here when connected."
        />
      )}
    </div>
  );
}
