import type { ReactNode } from "react";
import "../styles/action-list.css";

/** Label existing controls in a list; portalled dialogs keep their own presentation. */
export function ActionList({ children }: { children: ReactNode }) {
  return (
    <div className="buzz-action-list" data-action-list="">
      {children}
    </div>
  );
}
