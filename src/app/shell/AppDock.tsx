import type { ComponentProps, ReactNode } from "react";
import { PageNavigation } from "./PageNavigation";
import { DockMagnification } from "./DockMagnification";
import styles from "./AppDock.module.css";

export function AppDock({
  community,
  profile,
  settings,
  ...pages
}: Omit<ComponentProps<typeof PageNavigation>, "placement"> & {
  community: ReactNode;
  profile: ReactNode;
  settings: ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <DockMagnification>
        <div className={styles.apps}>
          <PageNavigation {...pages} placement="dock" />
        </div>
        <div className={styles.footer}>
          {(
            [
              ["community", community],
              ["profile", profile],
              ["settings", settings],
            ] as const
          ).map(([key, action]) => (
            <div key={key} className={styles.footerItem}>
              {action}
            </div>
          ))}
        </div>
      </DockMagnification>
    </div>
  );
}
