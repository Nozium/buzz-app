import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type MotionValue,
} from "motion/react";
import { Panel } from "../../shared/design-system/ui/Panel";
import styles from "./AppDock.module.css";

const PointerPosition = createContext<MotionValue<number> | null>(null);
const finePointer = "(hover: hover) and (pointer: fine)";

/** Pointer feedback scales artwork without resizing the dock or its hit targets. */
export function DockMagnification({ children }: { children: ReactNode }) {
  const pointer = useMotionValue(Number.POSITIVE_INFINITY);
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [usingKeyboard, setUsingKeyboard] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(finePointer);
    const update = () => setHover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const enabled = hover && !reduced && !usingKeyboard;
  return (
    <PointerPosition value={enabled ? pointer : null}>
      <Panel
        as="nav"
        aria-label="Apps dock"
        shape="capsule"
        onPointerMove={(event) => {
          if (hover && !reduced && event.pointerType === "mouse") {
            if (usingKeyboard) setUsingKeyboard(false);
            pointer.set(event.clientY);
          }
        }}
        onKeyDownCapture={() => {
          pointer.jump(Number.POSITIVE_INFINITY);
          setUsingKeyboard(true);
        }}
        onPointerLeave={() => pointer.set(Number.POSITIVE_INFINITY)}
        onScrollCapture={() => pointer.set(Number.POSITIVE_INFINITY)}
      >
        <div className={styles.dock}>{children}</div>
      </Panel>
    </PointerPosition>
  );
}

export function DockArtwork({ children }: { children: ReactNode }) {
  const pointer = useContext(PointerPosition);
  const anchor = useRef<HTMLSpanElement>(null);
  const target = useMotionValue(1);
  const scale = useSpring(target, { duration: 0.4, bounce: 0 });
  const transform = useMotionTemplate`scale(${scale})`;
  useEffect(() => {
    const update = () => {
      const box = anchor.current?.getBoundingClientRect();
      const distance = box
        ? Math.abs((pointer?.get() ?? Infinity) - box.top - box.height / 2)
        : Infinity;
      const proximity = Math.max(0, 1 - distance / 96);
      target.set(1 + 0.45 * proximity * proximity);
    };
    update();
    return pointer?.on("change", update);
  }, [pointer, target]);
  return (
    <span ref={anchor} className={styles.artworkAnchor}>
      <motion.span
        className={styles.artwork}
        style={{ transform: pointer ? transform : "none" }}
      >
        {children}
      </motion.span>
    </span>
  );
}
