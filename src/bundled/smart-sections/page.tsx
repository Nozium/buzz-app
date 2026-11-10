import { DescribeSection } from "./DescribeSection";
import type { SectionGenerator } from "./generate";
import { AGENT_COLLECTION } from "./agent-collection";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PageProps } from "../../features/pages/service";
import type { Panels } from "../../features/panels/service";
import type { RelayData } from "../../features/relay/service";
import type { Navigation } from "../../features/navigation/controller";
import type { SmartSections } from "../../features/smart-sections/runtime";
import {
  pageTarget,
  removeDefinition,
  scopeOf,
  type Definition,
  type SectionInput,
  type SectionState,
} from "../../features/smart-sections/model";
import { OwnedContribution } from "../../plugins/OwnedContribution";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { Select } from "../../shared/design-system/ui/Select";
import {
  ArrowClockwiseIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "../../shared/design-system/icons";
import styles from "./sections.module.css";

export function SmartSectionsPage({
  service,
  relay,
  navigator,
  panels,
  navigation,
  generator,
}: PageProps & {
  service: SmartSections;
  relay: RelayData;
  navigator: Navigation;
  panels: Panels;
  generator: SectionGenerator;
}) {
  const states = useSyncExternalStore(
    service.subscribe,
    service.snapshot,
    service.snapshot,
  );
  const connection = useSyncExternalStore(
    relay.subscribe,
    relay.snapshot,
    relay.snapshot,
  );
  useSyncExternalStore(panels.subscribe, panels.snapshot, panels.snapshot);
  const scope = scopeOf(connection),
    partition = connection.scope;
  const params =
    navigation?.target.kind === "page"
      ? navigation.target.route?.params
      : undefined;
  const route =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const state = states.find((row) => row.definition.id === route.section);
  const item = state?.items.find((row) => row.id === route.item);
  const panel = item?.url ? panels.resolve(item.url) : undefined;
  const [editing, setEditing] = useState<Definition | "new">();
  const [describing, setDescribing] = useState<Definition | "new">();
  const [error, setError] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const lastPartition = useRef(partition);
  useEffect(() => {
    if (lastPartition.current !== partition) {
      setEditing(undefined);
      setDescribing(undefined);
      setError("");
      lastPartition.current = partition;
    }
  }, [partition]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each addressable visit receives content focus.
  useEffect(() => {
    if (navigation?.focus !== "preserve")
      content.current?.focus({ preventScroll: true });
  }, [navigation?.entryId, navigation?.focus]);
  const run = (operation: () => void | Promise<void>) => {
    setError("");
    try {
      Promise.resolve(operation()).catch((cause) => setError(String(cause)));
    } catch (cause) {
      setError(String(cause));
    }
  };
  const closeDetail = () => {
    if (!scope || !state || !navigation) return;
    navigator.dismiss(
      [navigation.entryId],
      pageTarget(scope, state.definition.id),
    );
  };
  return (
    <FullPageSurface aria-label="Smart sections">
      <PanelHeader
        divider={false}
        title={
          <PanelHeaderLabel
            title={item?.label ?? "Smart sections"}
            icon={<SparklesIcon size={18} />}
          />
        }
        navigation={
          item ? (
            <IconButton
              aria-label="Close detail"
              variant="ghost"
              size="sm"
              icon={<XIcon size={16} />}
              onClick={closeDetail}
            />
          ) : undefined
        }
        actions={
          <>
            {state && (
              <IconButton
                aria-label="Refresh section"
                variant="ghost"
                size="sm"
                disabled={
                  state.status === "paused" || state.status === "unavailable"
                }
                icon={<ArrowClockwiseIcon size={16} />}
                onClick={() => run(() => service.refresh(state.definition.id))}
              />
            )}
            {state && (
              <IconButton
                aria-label="Edit section"
                variant="ghost"
                size="sm"
                icon={<PencilSimpleIcon size={16} />}
                onClick={() => setEditing(state.definition)}
              />
            )}
            <IconButton
              aria-label="New smart section"
              variant="ghost"
              size="sm"
              disabled={!scope}
              icon={<PlusIcon size={16} />}
              onClick={() => setDescribing("new")}
            />
          </>
        }
      />
      <section
        className={styles.content}
        ref={content}
        tabIndex={-1}
        aria-label={state?.definition.title ?? "Your collections"}
      >
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        {item ? (
          <div className={styles.collection}>
            {state?.definition.source === AGENT_COLLECTION ? (
              <>
                <InlineHeader title={item.status} subtitle={item.subtitle} />
                <p className={`text-body ${styles.detail}`}>
                  {item.text ||
                    "Showing a saved observation. Refresh to check for an update."}
                </p>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-body"
                  >
                    View source
                  </a>
                )}
              </>
            ) : panel ? (
              <OwnedContribution entry={panel} registry={panels}>
                {(entry) => (
                  <entry.component
                    target={item.url ?? ""}
                    close={closeDetail}
                  />
                )}
              </OwnedContribution>
            ) : (
              <EmptyState
                frame="none"
                icon={<SparklesIcon size={24} />}
                title="Detail unavailable"
                description="Enable the source plugin to open this item here."
              />
            )}
          </div>
        ) : (
          <div className={styles.collection}>
            {!scope ? (
              <EmptyState
                frame="none"
                icon={<SparklesIcon size={24} />}
                title="Choose a community"
                description="Smart sections belong to your account in a community."
              />
            ) : state ? (
              <>
                <InlineHeader
                  title={state.definition.title}
                  subtitle={
                    state.definition.criteria ||
                    state.definition.request ||
                    "Live collection"
                  }
                />
                <p className="text-caption text-secondary" role="status">
                  {state.note || `${state.items.length} matching items`}{" "}
                  {state.unknown > 0
                    ? `${state.unknown} matches are unknown.`
                    : ""}{" "}
                  {state.partial ? "Source coverage is partial." : ""}
                </p>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    onClick={() => setDescribing(state.definition)}
                  >
                    Describe a change
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      run(() => {
                        if (partition)
                          service.save(
                            partition,
                            {
                              ...state.definition,
                              paused: !state.definition.paused,
                            },
                            state.definition.id,
                            state.definition.revision,
                          );
                      })
                    }
                  >
                    {state.definition.paused
                      ? "Resume updates"
                      : "Pause updates"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => {
                        if (!partition || !scope) return;
                        removeDefinition(
                          partition,
                          state.definition.id,
                          state.definition.revision,
                        );
                        if (navigation)
                          navigator.dismiss(
                            [navigation.entryId],
                            pageTarget(scope),
                          );
                      })
                    }
                  >
                    Remove section
                  </Button>
                </div>
                {state.items.map((entity) => (
                  <NavigationItem
                    key={entity.id}
                    label={entity.label}
                    title={`${entity.label} · ${entity.subtitle}`}
                    icon={<SparklesIcon size={18} />}
                    trailing={
                      <span className="text-caption text-secondary">
                        {entity.status}
                      </span>
                    }
                    onClick={() => {
                      if (scope)
                        run(async () => {
                          const result = await navigator.open(
                            entity.target ??
                              pageTarget(scope, state.definition.id, entity.id),
                          );
                          if (result.status === "failed")
                            throw new Error(
                              "Couldn’t open this item. Try again.",
                            );
                        });
                    }}
                  />
                ))}
                {!state.items.length && (
                  <EmptyState
                    frame="none"
                    icon={<SparklesIcon size={24} />}
                    title={
                      state.status === "ready"
                        ? "No matching items"
                        : state.status === "loading"
                          ? "Updating section…"
                          : "No confirmed matches"
                    }
                    description={
                      state.status === "ready"
                        ? "This collection will update when matching items appear."
                        : state.note
                    }
                  />
                )}
              </>
            ) : (
              <>
                <InlineHeader
                  title="Your collections"
                  subtitle="Describe what you want in your sidebar. AI configures a section from your available sources."
                />
                <p className="text-caption text-secondary">
                  Saved on this device. Sources update while Buzz is open.
                  Optional matching sends item text to your selected Decisions
                  provider.
                </p>
                {states.map((row) => (
                  <NavigationItem
                    key={row.definition.id}
                    label={row.definition.title}
                    icon={<SparklesIcon size={18} />}
                    trailing={
                      <span className="text-caption text-secondary">
                        {row.status} · {row.items.length}
                      </span>
                    }
                    onClick={() => {
                      if (scope)
                        void navigator.open(
                          pageTarget(scope, row.definition.id),
                        );
                    }}
                  />
                ))}
                {!states.length && (
                  <EmptyState
                    frame="none"
                    icon={<SparklesIcon size={24} />}
                    title="Make the sidebar yours"
                    description="Track active agents, open PRs, and other enabled sources. Generate a section from a simple description."
                    action={
                      <Button onClick={() => setDescribing("new")}>
                        Create with AI
                      </Button>
                    }
                  />
                )}
                {route.section && (
                  <p role="status" className="text-body text-secondary">
                    This section was removed or isn’t available in this
                    community.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
      {describing && partition && (
        <DescribeSection
          key={`${partition}:${typeof describing === "string" ? describing : describing.id}`}
          relay={relay}
          generator={generator}
          section={describing === "new" ? undefined : describing}
          close={() => setDescribing(undefined)}
          manual={() => {
            setEditing(describing);
            setDescribing(undefined);
          }}
          save={(input) => {
            if (relay.snapshot().scope !== partition || !scope)
              throw new Error("Community changed. Generate the section again.");
            const saved = service.save(
              partition,
              input,
              describing === "new" ? undefined : describing.id,
              describing === "new" ? undefined : describing.revision,
            );
            setDescribing(undefined);
            void navigator.open(pageTarget(scope, saved.id));
          }}
        />
      )}
      {editing && partition && (
        <SectionEditor
          key={`${partition}:${typeof editing === "string" ? editing : editing.id}`}
          initial={editing === "new" ? undefined : editing}
          service={service}
          relay={relay}
          close={() => setEditing(undefined)}
          save={(input) => {
            if (relay.snapshot().scope !== partition || !scope)
              throw new Error("Community changed. Open the editor again.");
            const saved = service.save(
              partition,
              input,
              editing === "new" ? undefined : editing.id,
              editing === "new" ? undefined : editing.revision,
            );
            setEditing(undefined);
            void navigator.open(pageTarget(scope, saved.id));
          }}
        />
      )}
    </FullPageSurface>
  );
}
function SectionEditor({
  initial,
  service,
  relay,
  close,
  save,
}: {
  initial: Definition | undefined;
  service: SmartSections;
  relay: RelayData;
  close(): void;
  save(input: SectionInput): void;
}) {
  const sources = service
    .sources()
    .filter(
      (source) =>
        source.id !== AGENT_COLLECTION || initial?.source === AGENT_COLLECTION,
    );
  const [input, setInput] = useState<SectionInput>(
    initial ?? {
      title: "Active agents",
      request: "",
      source: "buzz.agents/active",
      config: {},
      criteria: "",
      limit: 5,
      paused: false,
    },
  );
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<SectionState>();
  const [busy, setBusy] = useState(false);
  const live = useRef(true),
    revision = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const change = (patch: Partial<SectionInput>) => {
    revision.current++;
    setInput({ ...input, ...patch });
    setPreview(undefined);
  };
  const source = sources.find((row) => row.id === input.source);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={initial ? "Edit smart section" : "New smart section"}
      description="Choose live facts, then optionally describe the items you want."
      actions={
        <>
          <Button
            disabled={busy || !source}
            loading={busy}
            onClick={async () => {
              const version = revision.current;
              setBusy(true);
              setError("");
              try {
                const result = await service.preview(relay.snapshot(), input);
                if (live.current && version === revision.current)
                  setPreview(result);
              } catch (cause) {
                if (live.current) setError(String(cause));
              } finally {
                if (live.current) setBusy(false);
              }
            }}
          >
            Preview
          </Button>
          <Button
            variant="prominent"
            disabled={!source}
            onClick={() => {
              try {
                save(input);
              } catch (cause) {
                setError(String(cause));
              }
            }}
          >
            Save section
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Title">
          <Input
            value={input.title}
            onChange={(event) => change({ title: event.currentTarget.value })}
          />
        </Field>
        <Select
          label="Source"
          variant="field"
          value={input.source}
          groups={[
            {
              label: "Available sources",
              options: sources.map((row) => ({
                value: row.id,
                label: row.title,
              })),
            },
          ]}
          onValueChange={(value) => change({ source: value, config: {} })}
        />
        {source?.fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              placeholder={field.placeholder}
              value={String(input.config[field.key] ?? "")}
              onChange={(event) =>
                change({
                  config: {
                    ...input.config,
                    [field.key]: event.currentTarget.value,
                  },
                })
              }
            />
          </Field>
        ))}
        <Field
          label="Matching instructions"
          optional
          description="Leave empty to include every item. Uses your selected Decisions provider; unavailable matches stay unknown."
        >
          <Textarea
            value={input.criteria}
            onChange={(event) =>
              change({ criteria: event.currentTarget.value })
            }
            placeholder="Only PRs about onboarding that need a review"
          />
        </Field>
        <Select
          label="Rows in sidebar"
          variant="field"
          value={String(input.limit)}
          groups={[
            {
              label: "Visible rows",
              options: [3, 5, 10, 20].map((value) => ({
                value: String(value),
                label: String(value),
              })),
            },
          ]}
          onValueChange={(value) => change({ limit: Number(value) })}
        />
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        {preview && (
          <div role="status" className="text-body">
            <p>
              {preview.items.length} confirmed matches · {preview.unknown}{" "}
              unknown
            </p>
            {preview.note && <p>{preview.note}</p>}
            {preview.items.slice(0, 10).map((row) => (
              <p key={row.id}>{row.label}</p>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
