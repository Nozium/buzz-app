import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationExtensions,
  PageTabOptions,
  PageTabsProps,
  PageTabTarget,
} from "../../features/conversation/contracts";
import {
  ConversationHost,
  type ConversationHostServices,
} from "../../features/conversation/ConversationHost";
import { useConversationPresentation } from "../../features/conversation/ConversationPresentation";
import { NewMessage } from "../../features/direct-messages/NewMessage";
import { SoloDraft } from "../../features/solo/SoloDraft";
import { ConversationPresentation } from "../../features/conversation/ConversationPresentation";
import { useToastNotification } from "../../shared/design-system/ui/Toast";
import { useChannelList } from "../../features/relay/react";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { ScrollEdgeMaterial } from "../../shared/design-system/ui/ScrollEdgeMaterial";
import { ConversationTab } from "../channels/ConversationTab";
import { ChannelMembersButton } from "../channels/ChannelMembersDialog";
import { useChannelLabels } from "../channels/useChannelLabels";
import { InboxSheetActions } from "./InboxSheetActions";
import type { ConversationTab as Tab } from "../channels/useChannelTabState";
import { inboxRouteTarget, routeOf, detailOf, composingOf } from "./route";
import type { OpenTarget } from "../../features/navigation/targets";
import type { PageNavigation } from "../../features/navigation/service";
import styles from "./Inbox.module.css";

const activitySheetRoute = {
  target: (
    params: Parameters<typeof inboxRouteTarget>[0],
  ): Extract<OpenTarget, { kind: "page" }> => inboxRouteTarget(params),
  filters: routeOf,
  detail: detailOf,
  composing: composingOf,
};

const sameConversation = (a: PageTabTarget, b: PageTabTarget) =>
  a.channelId === b.channelId && a.threadId === b.threadId;

type Opening = {
  target: PageTabTarget;
  request: number;
  options?: PageTabOptions | undefined;
  reply?: boolean | undefined;
};

/** Activity keeps its list mounted; its existing open/close contract places
 * the conversation in one composer sheet instead of a split workspace. */
export function InboxSheet({
  session,
  scope,
  children,
  host,
  extensions,
  navigation,
  route = activitySheetRoute,
}: PageTabsProps & {
  navigation?: PageNavigation | undefined;
  route?: typeof activitySheetRoute;
  host: ConversationHostServices;
  extensions: ConversationExtensions;
}) {
  const list = useChannelList(session.channels);
  const notify = useToastNotification();
  const [composer, setComposer] = useState<HTMLDivElement | null>(null);
  const presented = useConversationPresentation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftContent, setDraftContent] = useState<HTMLDivElement | null>(null);
  const [draftMount] = useState(() => {
    const element = document.createElement("div");
    element.className = styles.draftContent ?? "";
    return element;
  });
  const [opening, setOpening] = useState<Opening>();
  const [shown, setShown] = useState(false);
  const covered = shown || drafting || !!draftContent;
  // Keep one portal destination so expanding never recreates the editor or
  // mounts history in the collapsed card before the dialog is ready.
  useLayoutEffect(() => {
    const destination = draftContent ?? composer;
    if (!destination || draftMount.parentElement === destination) return;
    const moving = !!draftMount.parentElement;
    destination.appendChild(draftMount);
    if (moving && presented && !shown)
      draftMount
        .querySelector<HTMLElement>('[role="textbox"]')
        ?.focus({ preventScroll: true });
  }, [draftContent, composer, draftMount, presented, shown]);
  useLayoutEffect(() => () => draftMount.remove(), [draftMount]);
  // The feed runs behind the floating editor. Reserve its measured height only
  // at the scroll end, so the last row can still be brought above a growing draft.
  useLayoutEffect(() => {
    if (!container || !composer || covered) return;
    const measure = () => {
      container.style.setProperty(
        "--activity-composer-clearance",
        `${composer.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(composer);
    return () => {
      observer?.disconnect();
    };
  }, [container, composer, covered]);
  const trigger = useRef<HTMLElement | null>(null);
  const current = useRef<Opening | undefined>(undefined);
  const live = useRef(false);
  const sequence = useRef(0);
  const visit = useRef(navigation);
  const appliedVisit = useRef<PageNavigation | undefined>(undefined);
  const returnTarget = useRef<OpenTarget | undefined>(undefined);
  useLayoutEffect(() => {
    visit.current = navigation;
  });
  const navigationScope = useMemo(
    () => ({
      viewer: session.viewer ?? "",
      communityOrigin: scope.slice(0, -((session.viewer?.length ?? 0) + 1)),
    }),
    [session.viewer, scope],
  );
  useLayoutEffect(() => {
    live.current = presented;
    if (!presented) {
      appliedVisit.current = undefined;
      current.current = undefined;
      setShown(false);
      setDrafting(false);
    }
    return () => {
      live.current = false;
    };
  }, [presented]);
  const hide = useCallback(() => {
    current.current = undefined;
    setShown(false);
    setDrafting(false);
  }, []);
  const retire = useCallback(
    (active: PageNavigation | undefined) => {
      const detail = route.detail(active?.target);
      const compose = route.composing(active?.target);
      if (!active || (!detail && !compose)) return;
      host.navigation.dismiss(
        (candidate) => {
          const next = route.detail(candidate);
          if (compose)
            return (
              candidate.kind === "page" &&
              route.composing(candidate) &&
              (candidate.scope === undefined ||
                (candidate.scope?.viewer === session.viewer &&
                  candidate.scope?.communityOrigin ===
                    navigationScope.communityOrigin))
            );
          return (
            !!detail &&
            !!next &&
            sameConversation(detail, next) &&
            candidate.kind === "page" &&
            (candidate.scope === undefined ||
              (candidate.scope?.viewer === session.viewer &&
                candidate.scope?.communityOrigin ===
                  navigationScope.communityOrigin))
          );
        },
        returnTarget.current ?? {
          ...route.target(route.filters(active.target) ?? {}),
          scope: navigationScope,
        },
      );
    },
    [host.navigation, session.viewer, navigationScope, route],
  );
  const dismiss = useCallback(() => {
    if (route.composing(visit.current?.target))
      composer?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
    hide();
    retire(visit.current);
  }, [hide, retire, composer, route]);
  const open = useCallback(
    (target: PageTabTarget, options?: PageTabOptions, reply = false) => {
      const connection = host.relay.snapshot();
      const channel = session.channels
        .list()
        .channels.find((item) => item.id === target.channelId);
      if (
        !live.current ||
        connection.status !== "ready" ||
        connection.session !== session ||
        !channel ||
        channel.readOnly ||
        channel.archived ||
        channel.cached ||
        channel.huddle ||
        channel.metadataPending ||
        (channel.channelType === "solo" &&
          !channel.members?.includes(session.viewer ?? ""))
      )
        return false;
      if (!current.current)
        trigger.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      const next = { target, options, reply, request: ++sequence.current };
      current.current = next;
      setOpening(next);
      setShown(true);
      setDrafting(false);
      if (visit.current)
        void host.navigation.open(
          {
            ...route.target({
              ...(route.filters(visit.current.target) ?? {}),
              ...target,
            }),
            scope: navigationScope,
          },
          { focus: "preserve" },
        );
      return true;
    },
    [host.relay, host.navigation, session, navigationScope, route],
  );
  // Traversal restores presentation with fresh authority; it never replays a send.
  useLayoutEffect(() => {
    if (!navigation || !presented || appliedVisit.current === navigation)
      return;
    if (route.composing(navigation.target)) {
      appliedVisit.current = navigation;
      setShown(false);
      setDrafting(true);
      return;
    }
    setDrafting(false);
    const target = route.detail(navigation.target);
    if (!target) {
      appliedVisit.current = navigation;
      returnTarget.current = navigation.target;
      current.current = undefined;
      setShown(false);
      return;
    }
    const channel = list.channels.find((item) => item.id === target.channelId);
    if (
      !channel ||
      channel.archived ||
      channel.cached ||
      channel.readOnly ||
      channel.huddle ||
      channel.metadataPending ||
      (channel.channelType === "solo" &&
        !channel.members?.includes(session.viewer ?? ""))
    ) {
      if (list.status === "ready") dismiss();
      return;
    }
    appliedVisit.current = navigation;
    const prior = current.current;
    const next = {
      target,
      request: ++sequence.current,
      ...(prior &&
      sameConversation(prior.target, target) &&
      prior.target.messageId === target.messageId
        ? { options: prior.options, reply: prior.reply }
        : {}),
    };
    current.current = next;
    setOpening(next);
    setShown(true);
  }, [
    navigation,
    route,
    presented,
    list.channels,
    list.status,
    session.viewer,
    dismiss,
  ]);
  const close = useCallback(
    (target: PageTabTarget) => {
      if (!current.current || !sameConversation(current.current.target, target))
        return false;
      dismiss();
      return true;
    },
    [dismiss],
  );
  const isOpen = useCallback(
    (target: PageTabTarget) =>
      shown && !!opening && sameConversation(opening.target, target),
    [shown, opening],
  );
  const target = opening?.target;
  const selectedChannel = list.channels.find(
    (item) => item.id === target?.channelId,
  );
  const labelRoster = useMemo(
    () => (selectedChannel ? [selectedChannel] : []),
    [selectedChannel],
  );
  const { channels } = useChannelLabels(
    labelRoster,
    session.profiles,
    session.names,
  );
  const channel =
    channels.find((item) => item.id === target?.channelId) ??
    list.channels.find((item) => item.id === target?.channelId);
  const available =
    channel &&
    !channel.archived &&
    !channel.readOnly &&
    !channel.cached &&
    !channel.huddle &&
    !channel.metadataPending &&
    (channel.channelType !== "solo" ||
      !!channel.members?.includes(session.viewer ?? ""));
  useLayoutEffect(() => {
    if (shown && !available) dismiss();
  }, [shown, available, dismiss]);
  const detailHost = useMemo<ConversationHostServices>(
    () => ({
      relay: host.relay,
      panels: host.panels,
      navigation: {
        ...host.navigation,
        open: (target, options) => {
          const closing = visit.current;
          hide();
          const pending = host.navigation.open(target, options);
          // An admitted handoff retires the sheet before a quick Back can
          // return to it, even while the destination is still loading.
          if (
            closing &&
            host.navigation.snapshot().entry.id !== closing.entryId
          ) {
            retire(closing);
            return pending;
          }
          return pending.then((result) => {
            if (result.status === "opened") retire(closing);
            return result;
          });
        },
      },
    }),
    [host.relay, host.panels, host.navigation, hide, retire],
  );
  const navigateConversation = (target: PageTabTarget) => {
    const viewer = session.viewer;
    if (!viewer) return;
    void detailHost.navigation.open({
      version: 1,
      kind: "conversation",
      scope: navigationScope,
      channelId: target.channelId,
      ...(target.messageId && { messageId: target.messageId }),
      ...(target.threadId && {
        threadRootId: target.threadId,
        context: "channel",
      }),
    });
  };
  const showConversation = (channelId: string, messageId?: string) => {
    const target = { channelId, ...(messageId && { messageId }) };
    if (!open(target)) navigateConversation(target);
  };
  const expandDraft = () => {
    if (!presented || drafting || shown) return;
    setDrafting(true);
    if (visit.current)
      void host.navigation.open(
        {
          ...route.target({
            ...(route.filters(visit.current.target) ?? {}),
            compose: "new",
          }),
          scope: navigationScope,
        },
        { focus: "preserve" },
      );
  };
  const tab: Tab | undefined =
    target &&
    opening &&
    (target.threadId
      ? {
          id: `thread:${target.channelId}:${target.threadId}`,
          kind: "thread",
          channelId: target.channelId,
          rootId: target.threadId,
          messageId: target.messageId ?? target.threadId,
          revealRequest: opening.request,
          ...(opening.reply && { replyRequest: opening.request }),
        }
      : {
          id: `conversation:${target.channelId}`,
          kind: "conversation",
          channelId: target.channelId,
          messageId: target.messageId,
          revealRequest: opening.request,
          ...(!target.messageId && { focusRequest: opening.request }),
          ...(opening.options?.markRead === false && { markRead: false }),
        });
  return (
    <div ref={setContainer} className={styles.sheetHost}>
      <div
        className={styles.sheetFeed}
        data-activity-covered={covered || undefined}
      >
        <ConversationPresentation value={presented && !covered}>
          {children(open, close, isOpen)}
        </ConversationPresentation>
      </div>
      <div
        ref={setComposer}
        className={styles.newMessage}
        data-covered={covered || undefined}
      >
        <div className={styles.composerEdge}>
          <ScrollEdgeMaterial edge="bottom" />
        </div>
        <ConversationPresentation value={presented && !shown}>
          <NewMessage
            layout="composer"
            expanded={drafting && !!draftContent}
            contentContainer={draftMount}
            onAddressed={expandDraft}
            allowChannels
            session={session}
            scope={scope}
            channels={list.channels}
            host={host}
            extensions={extensions}
            onStarted={showConversation}
            onOpenThread={(channelId, messageId, threadId) => {
              open({ channelId, messageId, threadId });
            }}
            onOpenChat={showConversation}
            renderSolo={(agent, focusRequest, onDraftChange) => (
              <SoloDraft
                key={agent}
                embedded
                draftPrefix="direct-message"
                onDraftChange={onDraftChange}
                agent={agent}
                focusRequest={focusRequest}
                session={session}
                scope={scope}
                extensions={extensions}
                onStarted={showConversation}
                onFailed={(_id, message, retry) =>
                  notify(
                    message,
                    "error",
                    retry
                      ? {
                          label: "Retry restoring message",
                          onClick: () => {
                            void retry();
                          },
                          timeout: Infinity,
                        }
                      : undefined,
                  )
                }
              />
            )}
          />
        </ConversationPresentation>
      </div>
      <Dialog
        visit
        open={drafting}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
        title="New message"
        closeLabel="Close new message"
        backdrop="subtle"
        placement="bottom"
        anchor={composer}
        size="wide"
        height="stable"
        bodyLayout="flex"
        initialFocus={false}
        finalFocus={false}
      >
        <div ref={setDraftContent} className={styles.draftContent} />
      </Dialog>
      {available && channel && target && tab && (
        <ConversationPresentation value={shown}>
          <ConversationHost
            host={detailHost}
            session={session}
            scope={scope}
            channelId={channel.id}
            channelName={channel.name}
            threadId={target.threadId}
          >
            {(interactions) => (
              <Dialog
                visit
                open={shown}
                onOpenChange={(next) => {
                  if (!next) dismiss();
                }}
                title={channel.name}
                closePlacement="start"
                headerActions={
                  <InboxSheetActions
                    key={tab.id}
                    active={shown}
                    panels={host.panels}
                    context={{
                      scope,
                      channelId: channel.id,
                      channelName: channel.name,
                      viewer: session.viewer ?? "",
                      relayUrl: navigationScope.communityOrigin
                        .replace(/^https:/, "wss:")
                        .replace(/^http:/, "ws:"),
                      ...(target.threadId && { threadId: target.threadId }),
                    }}
                    interactions={interactions}
                    onOpen={() => navigateConversation(target)}
                  />
                }
                identity={
                  <ChannelMembersButton
                    key={channel.id}
                    session={session}
                    channelId={channel.id}
                    conversationName={channel.name}
                    navigator={detailHost.navigation}
                  />
                }
                backdrop="subtle"
                placement="bottom"
                anchor={composer}
                size="wide"
                height="stable"
                bodyLayout="flex"
                initialFocus="dialog"
                finalFocus={() =>
                  trigger.current?.isConnected ? trigger.current : false
                }
              >
                <ConversationTab
                  key={tab.id}
                  tab={tab}
                  active={shown}
                  visit={false}
                  channel={channel}
                  session={session}
                  scope={scope}
                  extensions={extensions}
                  openLink={interactions.onOpenLink}
                  canOpenLink={interactions.canOpenLink}
                  openThread={(messageId, rootId, intent) => {
                    open(
                      { channelId: channel.id, threadId: rootId, messageId },
                      undefined,
                      intent === "reply",
                    );
                  }}
                />
              </Dialog>
            )}
          </ConversationHost>
        </ConversationPresentation>
      )}
    </div>
  );
}
