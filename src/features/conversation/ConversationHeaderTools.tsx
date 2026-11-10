import { useRef, type ReactNode } from "react";
import { DotsThreeIcon } from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPopup,
} from "../../shared/design-system/ui/Popover";
import { ActionList } from "../../shared/design-system/ui/ActionList";

/** Retain each tool's own interaction inside the header's overflow popover. */
export function ConversationHeaderTools({
  actions,
  label = "Conversation actions",
}: {
  actions: ReactNode;
  label?: string;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!actions) return null;
  return (
    <PopoverRoot
      onOpenChange={(open, details) => {
        if (
          open ||
          (details.reason !== "focus-out" &&
            details.reason !== "outside-press" &&
            details.reason !== "escape-key")
        )
          return;
        // Dialogs belong to the action's existing page/provider owner, so they
        // can be siblings in React. Keep their actual return trigger mounted.
        const target =
          details.reason === "focus-out" && "relatedTarget" in details.event
            ? details.event.relatedTarget
            : details.event.target;
        const dialog =
          target instanceof Element
            ? target.closest(
                '[role="dialog"][aria-modal="true"], [role="alertdialog"], .buzz-dialog-backdrop',
              )
            : null;
        if (
          dialog &&
          dialog !== popup.current &&
          !dialog.contains(trigger.current)
        )
          details.cancel();
      }}
    >
      <PopoverTrigger
        render={
          <IconButton
            ref={trigger}
            size="sm"
            variant="subtle"
            aria-label={label}
            title={label}
            icon={<DotsThreeIcon size="1rem" />}
          />
        }
      />
      <PopoverPopup
        ref={popup}
        align="end"
        size="compact"
        padding="list"
        aria-label={label}
      >
        <ActionList>{actions}</ActionList>
      </PopoverPopup>
    </PopoverRoot>
  );
}
