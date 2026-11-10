import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ConversationHostInteractions } from "../../features/conversation/ConversationHost";
import type {
  ChannelPanelContext,
  Panels,
} from "../../features/panels/service";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPopup,
} from "../../shared/design-system/ui/Popover";
import {
  ArrowUpRightIcon,
  DotsThreeIcon,
} from "../../shared/design-system/icons";
import { ActionList } from "../../shared/design-system/ui/ActionList";

/** Keep plugin controls intact: they own confirmation, shortcuts and call state. */
export function InboxSheetActions({
  panels,
  context,
  interactions,
  active,
  onOpen,
}: {
  panels: Panels;
  context: ChannelPanelContext;
  interactions: ConversationHostInteractions;
  active: boolean;
  onOpen(): void;
}) {
  const contributions = useSyncExternalStore(panels.subscribe, panels.snapshot);
  const live = useRef(active);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    live.current = active;
    return () => {
      live.current = false;
    };
  }, [active]);
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <IconButton
            ref={trigger}
            size="sm"
            variant="subtle"
            aria-label="Conversation actions"
            title="Conversation actions"
            icon={<DotsThreeIcon size="1rem" />}
          />
        }
      />
      <PopoverPopup
        align="end"
        size="compact"
        padding="list"
        aria-label="Conversation actions"
      >
        <ActionList>
          {contributions.map((panel) => {
            const Launcher = panel.channelLauncher;
            if (!Launcher) return null;
            const available = () =>
              live.current && panels.snapshot().includes(panel);
            return (
              <Launcher
                key={`${panel.key}:${panel.revision}`}
                context={context}
                pressed={false}
                available={available}
                canOpen={(target) =>
                  available() && (interactions.canOpenLink?.(target) ?? false)
                }
                open={(target) =>
                  available() && interactions.onOpenLink(target)
                }
                toggle={(target) => {
                  if (available())
                    interactions.openPanel(panel, target, trigger.current);
                }}
              />
            );
          })}
          <Button size="sm" variant="ghost" onClick={onOpen}>
            <ArrowUpRightIcon size="1rem" /> Open in Messages
          </Button>
        </ActionList>
      </PopoverPopup>
    </PopoverRoot>
  );
}
