import type { ReactNode } from "react";
import { Avatar } from "./Avatar";

/** Match conversation portraits in a view's leading identity slot. */
export function HeaderIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex size-12 shrink-0" aria-hidden="true">
      <Avatar
        size="fill"
        shape="circle"
        alt=""
        fallback=""
        fallbackContent={children}
      />
    </span>
  );
}
