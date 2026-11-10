import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { ConversationHeaderTools } from "../conversation/ConversationHeaderTools";
import styles from "./Panels.module.css";

type SheetHeader = {
  title: string;
  /** Message owners opt into the composer expansion; other details use the rail. */
  composer?: boolean;
  icon?: ReactNode;
  actions?: ReactNode;
  source?: RefObject<HTMLElement | null>;
  // biome-ignore lint/suspicious/noConfusingVoidType: Existing closers return false to retain unsaved work.
  close(): boolean | void;
};
const Sheet = createContext<{
  register(header: SheetHeader): () => void;
} | null>(null);

/** The content owner supplies identity and its existing guarded close action. */
export function usePanelSheet(header?: SheetHeader) {
  const sheet = useContext(Sheet);
  useLayoutEffect(() => {
    if (sheet && header) return sheet.register(header);
  }, [sheet, header]);
  return !!sheet;
}

/** Presentation only: retained content, navigation and close policy stay with
 * the existing workspace/card. This frame never starts a content read. */
export function PanelSheet({
  open,
  children,
  keepMounted = false,
  title = "Details",
  close,
}: {
  open: boolean;
  children: ReactNode;
  keepMounted?: boolean | undefined;
  title?: string | undefined;
  close?: (() => void) | undefined;
}) {
  const source = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [railAnchor, setRailAnchor] = useState<HTMLElement | null>(null);
  const [headers, setHeaders] = useState<readonly SheetHeader[]>([]);
  const [retained, setRetained] = useState(children);
  if ((open || keepMounted) && retained !== children) setRetained(children);
  const register = useCallback((header: SheetHeader) => {
    setHeaders((current) => [...current, header]);
    return () =>
      setHeaders((current) => current.filter((item) => item !== header));
  }, []);
  const context = useMemo(() => ({ register }), [register]);
  useLayoutEffect(() => {
    if (!open) return;
    setRailAnchor(
      source.current?.closest<HTMLElement>("[data-detail-container]") ?? null,
    );
    const scope =
      source.current?.closest("[data-expando-scope]") ??
      document.getElementById("main-content");
    const composer = [
      ...(scope?.querySelectorAll<HTMLElement>("[data-composer-surface]") ??
        []),
    ].find(
      (element) =>
        element.getClientRects().length &&
        !element.closest("[hidden], [data-covered]"),
    );
    setAnchor(composer ?? null);
  }, [open]);
  const header = [...headers].reverse().find((item) => {
    // Ignore host-hidden siblings without treating a closed, retained modal
    // itself as a retired content owner.
    for (
      let node = item.source?.current;
      node && !node.hasAttribute("data-panel-sheet-body");
      node = node.parentElement
    ) {
      if (node.hidden) return false;
    }
    return true;
  });
  const composer = header?.composer === true;
  return (
    <Sheet value={context}>
      <span ref={source} data-panel-sheet="" hidden />
      <Dialog
        open={open}
        keepMounted={keepMounted}
        title={header?.title ?? title}
        identity={header?.icon}
        headerActions={
          <ConversationHeaderTools
            label="Detail actions"
            actions={header?.actions}
          />
        }
        closePlacement="start"
        placement={composer ? "bottom" : "rail"}
        dismissOnOutsideClick={composer}
        backdrop="subtle"
        anchor={composer ? anchor : railAnchor}
        size="wide"
        height="stable"
        bodyLayout="flex"
        initialFocus="dialog"
        onOpenChange={(next) => {
          if (!next) (header?.close ?? close)?.();
        }}
        onOpenChangeComplete={(next) => {
          if (!next && !keepMounted) setRetained(null);
        }}
      >
        <div
          className={styles.sheetBody}
          data-panel-sheet-body=""
          tabIndex={-1}
        >
          {open || keepMounted ? children : retained}
        </div>
      </Dialog>
    </Sheet>
  );
}
