import { motion, useReducedMotion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useDndContext,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  createContext,
  Children,
  isValidElement,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { NavigationSection } from "../../shared/design-system/ui/NavigationSection";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
} from "../../shared/design-system/ui/Menu";
import {
  DotsThreeIcon,
  PlusIcon,
  ChatCircleIcon,
} from "../../shared/design-system/icons";
import { CreateSidebarSection } from "../../bundled/channels/CreateSidebarSection";
import type { RailEntry } from "./rail-pins";
import { useRailLayout } from "./rail-layout";
import styles from "./RailArrangement.module.css";
import { Header } from "../../shared/design-system/ui/Header";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import feedStyles from "../../features/conversation/FeedList.module.css";

type Group = {
  id: string;
  title: string;
  content: ReactNode;
};
type Arrangement = {
  pageSection?: string | undefined;
  selectedSection?: string | undefined;
  openSection(id: string): void;
  groups: { id: string; title: string }[];
  placements: ReturnType<typeof useRailLayout>["layout"]["placements"];
  move(entry: RailEntry, section: string): void;
  reorder(id: string, over: string): void;
  create(entry: RailEntry): void;
  remove(id: string): void;
  renderEntry(entry: RailEntry, section?: string): ReactNode;
  isPinned(entry: RailEntry): boolean;
  onTogglePin(entry: RailEntry, pinned: boolean): void;
};
const ArrangementContext = createContext<Arrangement | null>(null);
const touchOptions = { activationConstraint: { delay: 250, tolerance: 5 } };
const pointerOptions = { activationConstraint: { distance: 6 } };
const collisions: CollisionDetection = (args) =>
  pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((item) =>
      args.active.data.current?.section ? item.id !== "rail:new-section" : true,
    ),
  });

export function RailArrangement({
  partition,
  sections,
  renderEntry,
  isPinned,
  onTogglePin,
  pageSection,
  selectedSection,
  openSection,
}: {
  partition: string;
  sections: Group[];
  renderEntry(entry: RailEntry, section?: string): ReactNode;
  isPinned(entry: RailEntry): boolean;
  onTogglePin(entry: RailEntry, pinned: boolean): void;
  pageSection?: string | undefined;
  selectedSection?: string | undefined;
  openSection(id: string): void;
}) {
  const { layout, move, reorder, create, remove } = useRailLayout(partition);
  const reducedMotion = useReducedMotion();
  const animateDrop = useRef(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<RailEntry | null>();
  const newSectionButton = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState<{
    label: string;
    section: boolean;
  }>();
  const sensors = useSensors(
    useSensor(MouseSensor, pointerOptions),
    useSensor(TouchSensor, touchOptions),
  );
  const groups = [
    ...sections,
    ...layout.sections.map((section) => ({
      ...section,
      content: <RailGroup id={section.id} title={section.title} />,
    })),
  ];
  const defaultOrder = groups.map((group) => group.id);
  groups.sort((a, b) => {
    const position = (id: string) =>
      layout.order.includes(id)
        ? layout.order.indexOf(id)
        : layout.order.length + defaultOrder.indexOf(id);
    return position(a.id) - position(b.id);
  });
  const saved = (ok: boolean) => {
    setError(ok ? "" : "Couldn’t save the sidebar on this device. Try again.");
    return ok;
  };
  const value: Arrangement = {
    pageSection,
    selectedSection,
    openSection,
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title,
    })),
    placements: layout.placements,
    move: (entry, section) => {
      saved(move(entry, section));
    },
    reorder: (id, over) => {
      saved(
        reorder(
          id,
          over,
          groups.map((group) => group.id),
        ),
      );
    },
    create: setCreating,
    remove: (id) => {
      saved(remove(id));
    },
    renderEntry,
    isPinned,
    onTogglePin,
  };
  return (
    <ArrangementContext value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisions}
        accessibility={{ container: document.body }}
        onDragStart={({ active }) =>
          setDragging({
            label: active.data.current?.label ?? "",
            section: !!active.data.current?.section,
          })
        }
        onDragCancel={() => {
          animateDrop.current = false;
          setDragging(undefined);
        }}
        onDragEnd={({ active, over }) => {
          setDragging(undefined);
          const data = active.data.current;
          animateDrop.current =
            !!over &&
            !reducedMotion &&
            (data?.section
              ? data.section !== over.id
              : !!data?.entry &&
                over.id !== data.source &&
                over.id !== "rail:new-section");
          if (!over) return;
          if (data?.section) value.reorder(data.section, String(over.id));
          else if (data?.entry) {
            if (over.id === "rail:new-section") setCreating(data.entry);
            else if (over.id !== data.source)
              value.move(data.entry, String(over.id));
          }
        }}
      >
        {pageSection ? (
          (groups.find((group) => group.id === pageSection)?.content ?? (
            <EmptyState
              icon={<ChatCircleIcon />}
              title="Section unavailable"
              description="This sidebar section may have been removed."
            />
          ))
        ) : (
          <>
            <div
              className={styles.groups}
              onKeyDownCapture={(event) => {
                // Escape belongs to the active move before the shell's rail dismissal.
                if (dragging && event.key === "Escape") event.preventDefault();
              }}
            >
              {groups.map((group) => (
                <motion.div
                  key={group.id}
                  layout="position"
                  layoutDependency={layout}
                  initial={false}
                  transition={{
                    layout: animateDrop.current
                      ? { type: "spring", duration: 0.28, bounce: 0.15 }
                      : { duration: 0 },
                  }}
                  onLayoutAnimationComplete={() => {
                    animateDrop.current = false;
                  }}
                >
                  {group.content}
                </motion.div>
              ))}
            </div>
            <div className={styles.createSection}>
              <Button
                ref={newSectionButton}
                size="sm"
                variant="subtle"
                onClick={() => setCreating(null)}
              >
                New section
              </Button>
            </div>
            <NewSectionTarget />
          </>
        )}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className={styles.overlay}>
                <NavigationItem label={dragging.label} />
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      {error && (
        <p role="alert" className="text-caption text-secondary">
          {error}
        </p>
      )}
      {creating !== undefined && (
        <CreateSidebarSection
          channelName={creating?.label}
          finalFocus={creating === null ? newSectionButton : false}
          writable
          refreshing={false}
          retry={async () => {}}
          close={() => setCreating(undefined)}
          create={({ id, name }) => {
            if (
              !saved(
                create(
                  id,
                  name,
                  creating ?? undefined,
                  groups.map((group) => group.id),
                ),
              )
            )
              throw new Error("Couldn’t save this section. Try again.");
            setCreating(undefined);
            return true;
          }}
        />
      )}
    </ArrangementContext>
  );
}

/** Shared section/row paint stays with NavigationSection and NavigationItem. */
export function RailGroup({
  id,
  title,
  action,
  children,
  footer,
  rowsLabel,
  unlimited = false,
  trailingEntryId,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  rowsLabel?: string;
  unlimited?: boolean;
  trailingEntryId?: string;
}) {
  const arrangement = useContext(ArrangementContext);
  const { active } = useDndContext();
  const drop = useDroppable({
    id,
    resizeObserverConfig: { updateMeasurementsFor: [] },
  });
  const drag = useDraggable({
    id: `section:${id}`,
    data: { section: id, label: title },
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const movableGroups = arrangement?.groups ?? [];
  const index = movableGroups.findIndex((group) => group.id === id);
  const sectionDrag = !!active?.data.current?.section;
  const target = drop.isOver && active?.data.current?.section !== id;
  const sourceIndex = movableGroups.findIndex(
    (group) => group.id === active?.data.current?.section,
  );
  const insertionEdge =
    target && sectionDrag && sourceIndex >= 0 && index >= 0
      ? sourceIndex < index
        ? "after"
        : "before"
      : undefined;
  const rows: ReactElement<{ entry: RailEntry }>[] = [];
  const notes: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (
      isValidElement<ComponentProps<typeof RailSourceRow>>(child) &&
      child.props.entry &&
      child.props.section === id
    ) {
      if (
        !arrangement?.placements.some(
          (item) =>
            item.entry.id === child.props.entry.id &&
            arrangement.groups.some((group) => group.id === item.section),
        )
      )
        rows.push(child);
    } else notes.push(child);
  }
  const placed =
    arrangement?.placements.filter((item) => item.section === id) ?? [];
  for (const { entry } of placed)
    rows.push(
      <MovableRow key={entry.id} entry={entry} section={id}>
        {arrangement?.renderEntry(entry, id)}
      </MovableRow>,
    );
  if (trailingEntryId)
    rows.sort(
      (a, b) =>
        Number(a.props.entry.id === trailingEntryId) -
        Number(b.props.entry.id === trailingEntryId),
    );
  const limited = id !== "pins" && !unlimited;
  const shown = limited ? rows.slice(0, 4) : rows;
  const more = limited && rows.length > 4 && (!footer || placed.length > 0);
  if (arrangement?.pageSection === id)
    return (
      <section className={feedStyles.page} aria-label={title}>
        <Header title={title} actions={action} />
        <div className={`${feedStyles.scroll} ${styles.pageRows}`}>
          {rows.map((row) => (
            <div key={row.key} className={styles.pageRow}>
              {row}
            </div>
          ))}
          {notes}
        </div>
      </section>
    );
  return (
    <div
      ref={(node) => {
        drop.setNodeRef(node);
        drag.setNodeRef(node);
      }}
      className={styles.group}
      data-rail-section={id}
      data-drop-target={target || undefined}
      data-section-drag={sectionDrag || undefined}
      data-insertion-edge={insertionEdge}
      data-dragging={drag.isDragging || undefined}
    >
      <MenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
        <NavigationSection
          label={
            <Button
              ref={menuAnchor}
              {...drag.listeners}
              variant="plain"
              size="text"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              {title}
            </Button>
          }
          action={
            <>
              <span className={styles.handle}>
                <MenuTrigger
                  render={
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Arrange ${title}`}
                      icon={<DotsThreeIcon size={16} strokeWidth={2} />}
                    />
                  }
                />
              </span>
              {action}
            </>
          }
        >
          {rowsLabel ? (
            <ul aria-label={rowsLabel} className={styles.rows}>
              {shown.map((row) => (
                <li key={row.key}>{row}</li>
              ))}
            </ul>
          ) : id === "pins" ? (
            <div className={styles.pinsGrid} data-pins-grid="">
              {shown}
            </div>
          ) : (
            shown
          )}
          {notes}
          {more && (
            <NavigationItem
              label="View more"
              aria-label={`View more ${title}`}
              selected={arrangement?.selectedSection === id}
              onClick={() => arrangement?.openSection(id)}
            />
          )}
          {!more && footer}
        </NavigationSection>
        <MenuPopup anchor={menuAnchor}>
          <MenuItem
            disabled={index <= 0}
            onClick={() => {
              const previous = movableGroups[index - 1];
              if (previous) arrangement?.reorder(id, previous.id);
            }}
          >
            Move section up
          </MenuItem>
          <MenuItem
            disabled={!arrangement || index === movableGroups.length - 1}
            onClick={() => {
              const next = movableGroups[index + 1];
              if (next) arrangement?.reorder(id, next.id);
            }}
          >
            Move section down
          </MenuItem>
          {id.startsWith("custom:") && (
            <MenuItem onClick={() => arrangement?.remove(id)}>
              Remove section
            </MenuItem>
          )}
        </MenuPopup>
      </MenuRoot>
    </div>
  );
}

/** Assigned rows render once in their chosen section, even if also in a live feed. */
export function RailSourceRow({
  entry,
  section,
  children,
}: {
  entry: RailEntry;
  section: string;
  children: ReactNode;
}) {
  const arrangement = useContext(ArrangementContext);
  if (
    arrangement?.placements.some(
      (item) =>
        item.entry.id === entry.id &&
        arrangement.groups.some((group) => group.id === item.section),
    )
  )
    return null;
  return (
    <MovableRow entry={entry} section={section}>
      {children}
    </MovableRow>
  );
}
function MovableRow({
  entry,
  section,
  children,
}: {
  entry: RailEntry;
  section: string;
  children: ReactNode;
}) {
  const arrangement = useContext(ArrangementContext);
  const pinned = section === "pins" || arrangement?.isPinned(entry);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement>();
  const drag = useDraggable({
    id: `row:${section}:${entry.id}`,
    disabled: !!arrangement?.pageSection,
    data: { entry, source: section, label: entry.label },
  });
  return (
    <ContextMenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger
        onContextMenu={() => setMenuAnchor(undefined)}
        onTouchStart={() => setMenuAnchor(undefined)}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            setMenuAnchor(event.currentTarget);
            setMenuOpen(true);
          }
        }}
        render={
          <div
            ref={drag.setNodeRef}
            {...drag.listeners}
            className={styles.row}
            data-rail-row={entry.id}
            data-dragging={drag.isDragging || undefined}
          />
        }
      >
        {children}
      </ContextMenuTrigger>
      <MenuPopup anchor={menuAnchor}>
        <MenuItem onClick={() => arrangement?.onTogglePin(entry, !pinned)}>
          {pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuGroup>
          <MenuGroupLabel>Move to</MenuGroupLabel>
          {arrangement?.groups.map((group) => (
            <MenuItem
              key={group.id}
              disabled={group.id === section}
              onClick={() => arrangement.move(entry, group.id)}
            >
              {group.title}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuItem onClick={() => arrangement?.create(entry)}>
          New section…
        </MenuItem>
      </MenuPopup>
    </ContextMenuRoot>
  );
}
function NewSectionTarget() {
  const { active } = useDndContext();
  const shown = !!active && !active.data.current?.section;
  const { setNodeRef, isOver } = useDroppable({
    id: "rail:new-section",
    disabled: !shown,
  });
  const content = (
    <div
      ref={setNodeRef}
      className={styles.newSection}
      data-shown={shown || undefined}
      aria-hidden={!shown}
      inert={!shown}
    >
      <section
        className={styles.newSectionReveal}
        aria-label="New section"
        data-drop-target={isOver || undefined}
      >
        <div className={styles.newSectionLabel}>
          <PlusIcon size={16} aria-hidden="true" />
          <span>New section</span>
        </div>
      </section>
    </div>
  );
  const slot = document.getElementById("rail-drop-slot");
  return slot ? createPortal(content, slot) : content;
}
