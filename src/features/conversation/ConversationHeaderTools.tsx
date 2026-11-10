import type { ReactNode } from "react";
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
  if (!actions) return null;
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <IconButton
            size="sm"
            variant="subtle"
            aria-label={label}
            title={label}
            icon={<DotsThreeIcon size="1rem" />}
          />
        }
      />
      <PopoverPopup
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
