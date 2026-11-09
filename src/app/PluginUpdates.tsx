import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PluginManager } from "../plugins/manager";
import { pendingManaged } from "../plugins/managed";
import { canRetryPlugin } from "../plugins/manager";
import type { PluginInstallRequests } from "../plugins/installer";
import {
  createPluginUpdates,
  type PluginUpdate,
  type PluginUpdates as Updates,
  pluginUpdateSource,
  updateSourceKey,
} from "../plugins/updates";
import type { AppServices } from "./services";
import { Button } from "../shared/design-system/ui/Button";
import { ToastNotice } from "../shared/design-system/ui/Toast";
import {
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuSubmenuPopup,
  MenuIcon,
  MenuSeparator,
  MenuTrailing,
} from "../shared/design-system/ui/Menu";
import { SquaresFourIcon } from "../shared/design-system/icons";
import { RecommendationCount } from "./RecommendationCount";
import { importRollbackWarning, PluginImport } from "./PluginImport";
import { pluginAccessIncreases } from "./PluginAccessReview";
import { PluginMenu } from "./PluginMenu";
import { usePluginAutoUpdatePreference } from "./plugin-auto-update-preference";

const Context = createContext<{
  updates: readonly PluginUpdate[];
  recommended: readonly string[];
  busy: boolean;
  open(update: PluginUpdate): void;
} | null>(null);
const noSubscribe = () => () => {};
const empty: readonly PluginUpdate[] = [];
const noUpdates = () => empty;

export function PluginUpdates({
  plugins,
  relay,
  installRequests,
  navigation,
  children,
}: {
  plugins: PluginManager;
  relay: AppServices["relay"];
  installRequests: PluginInstallRequests;
  navigation: Pick<AppServices["navigation"], "open">;
  children: ReactNode;
}) {
  const [store, setStore] = useState<Updates>();
  const [action, setAction] = useState<PluginUpdate>();
  // Updates the launch check, or the first check a day after it, found;
  // keyed by plugin id and candidate revision.
  const [daily, setDaily] = useState<ReadonlySet<string>>(new Set());
  const returnFocus = useRef<HTMLElement | null>(null);
  const state = useSyncExternalStore(plugins.subscribe, plugins.snapshot);
  const updates = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.snapshot ?? noUpdates,
  );
  const authorizeGit = async (repository: string) =>
    (await relay.snapshot().session.authorizeGit?.(repository)) ?? null;
  useEffect(() => {
    const updates = createPluginUpdates(
      plugins,
      async (repository) =>
        (await relay.snapshot().session.authorizeGit?.(repository)) ?? null,
    );
    setStore(updates);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let dailyAt: number | undefined;
    const visible = () => document.visibilityState !== "hidden";
    const check = async () => {
      clearTimeout(timer);
      if (!visible()) return;
      const due = dailyAt === undefined || Date.now() - dailyAt >= 86_400_000;
      const delay = await updates.check();
      if (delay !== undefined && due && !disposed) {
        dailyAt = Date.now();
        const found = updates
          .snapshot()
          .flatMap((update) =>
            update.candidate
              ? [`${update.id}:${update.candidate.revision}`]
              : [],
          );
        setDaily((keys) => new Set([...keys, ...found]));
      }
      if (delay === undefined || disposed || !visible()) return;
      clearTimeout(timer);
      timer = setTimeout(check, delay);
    };
    void check();
    const unsubscribe = plugins.subscribe(check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      unsubscribe();
      updates.dispose();
    };
  }, [plugins, relay]);
  const configuration = state.configuration;
  const catalog =
    configuration.status === "ready" ? configuration.catalog : undefined;
  const open = (update: PluginUpdate) => {
    if (state.busy || action) return;
    returnFocus.current = document.activeElement as HTMLElement;
    setAction(update);
  };
  const installed =
    action && catalog?.plugins.find((p) => p.manifest.id === action.id);
  const source = action && pluginUpdateSource(plugins, action.id);
  const validAction =
    action &&
    installed &&
    source &&
    installed.revision === action.installedRevision &&
    updateSourceKey(source) === updateSourceKey(action.source);
  useEffect(() => {
    if (action && !validAction && !state.busy) setAction(undefined);
  }, [action, validAction, state.busy]);
  const needsReview = (update: PluginUpdate) => {
    const previous = catalog?.plugins.find((p) => p.manifest.id === update.id);
    return (
      !previous ||
      !update.candidate ||
      pluginAccessIncreases(update.candidate.manifest, previous.manifest) ||
      (update.candidate.publisher ?? null) !== (previous.publisher ?? null)
    );
  };
  const [recovering, setRecovering] = useState<readonly string[]>([]);
  // With the choice on, an update that needs no review and was found at
  // launch or by the daily check starts the same apply as Update and reload,
  // once per found revision. Others keep their notice until then.
  const autoUpdate = usePluginAutoUpdatePreference();
  const attempted = useRef(new Set<string>());
  // Another review or install request holds the single native import preview.
  const reviewing = useSyncExternalStore(
    installRequests.subscribe,
    () => installRequests.reviewing() || !!installRequests.snapshot(),
  );
  const canStart = !state.busy && !action && !reviewing;
  const automatic = (update: PluginUpdate) =>
    autoUpdate &&
    !!update.candidate &&
    !store?.hidden(update) &&
    !needsReview(update) &&
    !importRollbackWarning(
      update.candidate,
      catalog?.plugins.find((p) => p.manifest.id === update.id),
    ) &&
    daily.has(`${update.id}:${update.candidate.revision}`) &&
    !attempted.current.has(`${update.id}:${update.candidate.revision}`);
  const nextAutomatic = canStart ? updates.find(automatic) : undefined;
  const startAutomatic = useEffectEvent((update: PluginUpdate) => {
    if (!update.candidate || !canStart) return;
    attempted.current.add(`${update.id}:${update.candidate.revision}`);
    open(update);
  });
  useEffect(() => {
    if (nextAutomatic) startAutomatic(nextAutomatic);
  }, [nextAutomatic]);
  return (
    <Context
      value={{
        updates,
        open,
        busy: state.busy || !!action,
        recommended: pendingManaged(
          configuration.status === "ready" ? configuration.managed : undefined,
        ).map((entry) => entry.id),
      }}
    >
      {children}
      {updates
        .filter(
          (update) =>
            !store?.hidden(update) &&
            update.id !== action?.id &&
            !(canStart && automatic(update)),
        )
        .map((update) => {
          const plugin = catalog?.plugins.find(
            (p) => p.manifest.id === update.id,
          );
          const review = needsReview(update);
          return (
            <ToastNotice
              key={update.id}
              title={
                update.error
                  ? `Cannot check ${plugin?.manifest.name ?? update.id}`
                  : `Update ${plugin?.manifest.name ?? update.id}`
              }
              description={
                update.error ??
                "Save unfinished forms and stop active plugin workers first. Updating an enabled plugin reloads it immediately."
              }
              tone={update.error ? "error" : "info"}
              onDismiss={() => store?.later(update)}
              closeLabel="Dismiss plugin update notice"
              navigation={{
                label: `Manage ${plugin?.manifest.name ?? update.id} update checks`,
                open: () =>
                  void navigation.open({
                    version: 1,
                    kind: "settings",
                    section: "plugins",
                    pluginId: update.id,
                  }),
              }}
            >
              <Button
                size="sm"
                disabled={state.busy || !!action}
                onClick={() =>
                  update.error ? void store?.check(true) : open(update)
                }
              >
                {update.error
                  ? "Retry"
                  : review
                    ? "Review permissions"
                    : "Update and reload"}
              </Button>
              <Button size="sm" onClick={() => store?.later(update)}>
                Later
              </Button>
            </ToastNotice>
          );
        })}
      {validAction && catalog && (
        <PluginImport
          key={`${action.id}:${updateSourceKey(action.source)}`}
          plugins={plugins}
          catalog={catalog}
          busy={state.busy}
          updateId={action.id}
          updateAction={{ source: action.source, apply: !needsReview(action) }}
          reviewRequested
          authorizeGit={authorizeGit}
          holdReview={installRequests.holdReview}
          returnFocus={() => returnFocus.current}
          onClosed={() => {
            setRecovering((ids) =>
              ids.includes(action.id) ? ids : [...ids, action.id],
            );
            setAction(undefined);
          }}
        />
      )}
      {catalog?.plugins
        .filter((plugin) => recovering.includes(plugin.manifest.id))
        .map((recovery) => {
          const activation = state.activation[recovery.manifest.id];
          return activation?.status === "failed" ? (
            <ToastNotice
              key={recovery.manifest.id}
              title={`${recovery.manifest.name} cannot start`}
              description={`${activation.error}${recovery.rollbackBlockedReason ? ` ${recovery.rollbackBlockedReason}` : ""}`}
              tone="error"
            >
              <Button
                size="sm"
                disabled={
                  state.busy ||
                  !canRetryPlugin(
                    recovery,
                    activation,
                    configuration.status === "ready" &&
                      configuration.externalPluginsPaused,
                  )
                }
                onClick={() => plugins.retryPlugin(recovery.manifest.id)}
              >
                Retry activation
              </Button>
              <PluginMenu
                plugin={recovery}
                plugins={plugins}
                busy={state.busy}
                label="Plugin recovery actions"
              />
            </ToastNotice>
          ) : null;
        })}
    </Context>
  );
}

export function PluginUpdatesMenu({
  onManage,
  recommendations,
}: {
  onManage(): void;
  recommendations: number;
}) {
  const context = useContext(Context);
  const updates = context?.updates ?? empty;
  const count =
    recommendations +
    updates.filter((update) => !context?.recommended.includes(update.id))
      .length;
  const label = (
    <>
      <MenuIcon>
        <SquaresFourIcon aria-hidden="true" size={16} />
      </MenuIcon>
      Plugins
      {count > 0 && (
        <MenuTrailing>
          <RecommendationCount count={count} />
        </MenuTrailing>
      )}
    </>
  );
  if (!updates.length) return <MenuItem onClick={onManage}>{label}</MenuItem>;
  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger>{label}</MenuSubmenuTrigger>
      <MenuSubmenuPopup>
        {updates.map((update) => (
          <MenuItem
            key={update.id}
            disabled={context?.busy}
            onClick={() => context?.open(update)}
          >
            {update.error ? "Retry update" : "Update"}{" "}
            {update.candidate?.manifest.name ?? update.id}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={onManage}>Manage plugins</MenuItem>
      </MenuSubmenuPopup>
    </MenuSubmenu>
  );
}
