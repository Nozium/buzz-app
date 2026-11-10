import type { EventData } from "../../features/relay/events";
import type { Agents } from "../../features/agents/service";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { ownSolo } from "../../features/solo/labels";
import type { PullStates } from "./pull-states";
import { parseGitHubReference } from "./references";
import { writeLink, type SoloPulls } from "./solo-pull";

/** Only a signed work declaration, never a link extracted from message text. */
export function announcedPull(event: EventData) {
  const tags = event.tags.filter((tag) => tag[0] === "buzz:pull-request");
  const channels = event.tags.filter((tag) => tag[0] === "h");
  const [tag] = tags;
  if (
    event.kind !== 9 ||
    tags.length !== 1 ||
    channels.length !== 1 ||
    event.tags.some((tag) => tag[0] === "e" || tag[0] === "proxy")
  )
    return;
  const reference = tag?.[1] ? parseGitHubReference(tag[1]) : undefined;
  const branch = tag?.[2];
  const channel = channels[0]?.[1];
  if (
    reference?.kind !== "pull" ||
    !channel ||
    !branch ||
    branch.length > 255 ||
    /[\s\p{Cc}]/u.test(branch)
  )
    return;
  return { channel, url: reference.url, branch };
}

/** Reuses the session's verified live/reconnect delivery and the shared PR reader. */
export function watchSoloAnnouncements(
  session: RelaySession,
  states: PullStates,
  pulls: SoloPulls,
  ownedAgent: (pubkey: string) => boolean,
  subscribeAgents: (listener: () => void) => () => void = () => () => {},
) {
  const controller = new AbortController();
  const seen = new Set<string>();
  const candidates = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();
  const waiting = new Map<string, EventData>();
  const eligible = (channelId: string, author: string) => {
    const channel = session.channels
      .list()
      .channels.find((item) => item.id === channelId);
    return (
      !controller.signal.aborted &&
      ownSolo(channel, session.viewer) &&
      !channel?.archived &&
      !channel?.readOnly &&
      (author === session.viewer ||
        (!!channel?.members?.includes(author) && ownedAgent(author)))
    );
  };
  const flush = () => {
    const declarations = [...waiting.values()].flatMap((event) => {
      if (seen.has(event.id)) return [];
      const pull = announcedPull(event);
      if (!pull || !eligible(pull.channel, event.pubkey)) return [];
      waiting.delete(event.id);
      seen.add(event.id);
      const first = seen.values().next().value;
      if (seen.size > 512 && first) seen.delete(first);
      const prior = candidates.get(pull.channel);
      const key = `${pull.url} ${pull.branch}`;
      candidates.set(pull.channel, prior && prior !== key ? "ambiguous" : key);
      return [{ ...pull, id: event.id, key, author: event.pubkey }];
    });
    for (const pull of declarations) {
      if (
        candidates.get(pull.channel) !== pull.key ||
        pending.has(pull.channel)
      ) {
        seen.delete(pull.id);
        continue;
      }
      const allowed = () =>
        eligible(pull.channel, pull.author) &&
        candidates.get(pull.channel) === pull.key;
      const work = (async () => {
        try {
          const read = await states.read(pull.url, {
            maxAge: 0,
            level: "details",
          });
          if (read.error || read.state === "failed") {
            seen.delete(pull.id);
            return;
          }
          if (
            !allowed() ||
            !read.state.details?.signedIn ||
            !read.state.details.checklist?.authored ||
            read.state.branch !== pull.branch
          )
            return;
          if (
            (await writeLink(
              session,
              pull.channel,
              pull.url,
              AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
              true,
              allowed,
            )) &&
            allowed()
          )
            pulls.linked(pull.channel, pull.url);
        } catch (error) {
          seen.delete(pull.id);
          if (!controller.signal.aborted)
            console.warn("Could not link announced pull request", error);
        } finally {
          pending.delete(pull.channel);
        }
      })();
      pending.set(pull.channel, work);
    }
    return Promise.all(pending.values());
  };
  const stopChannels = session.channels.subscribeList(() => void flush());
  const stopAgents = subscribeAgents(() => void flush());
  const stop = session.subscribeLive(
    ({ events }) => {
      for (const event of events) {
        if (seen.has(event.id) || !announcedPull(event)) continue;
        waiting.set(event.id, event);
        const first = waiting.keys().next().value;
        if (waiting.size > 512 && first) waiting.delete(first);
      }
      return flush();
    },
    { replay: true },
  );
  return () => {
    controller.abort();
    stop();
    stopChannels();
    stopAgents();
  };
}

/** Observe existing connections, including communities whose rows were never shown. */
export function watchSoloConnections(
  relay: RelayData,
  agents: Pick<Agents, "snapshot" | "subscribe" | "relay">,
  states: PullStates,
  pullsFor: (session: RelaySession) => SoloPulls,
) {
  const connections = new Map<RelayData, () => void>();
  const sessions = new Map<RelaySession, () => void>();
  const bind = () => {
    const running = agents.snapshot().running;
    const current = new Set([
      relay,
      ...running.flatMap((agent) => agents.relay(agent.key) ?? []),
    ]);
    for (const [connection, stop] of connections)
      if (!current.has(connection)) {
        stop();
        connections.delete(connection);
      }
    for (const connection of current)
      if (!connections.has(connection))
        connections.set(connection, connection.subscribe(bind));
    const live = new Set(
      [...current].flatMap((connection) => {
        const snapshot = connection.snapshot();
        return snapshot.status === "ready" && !snapshot.cached
          ? [snapshot.session]
          : [];
      }),
    );
    for (const [session, stop] of sessions)
      if (!live.has(session)) {
        stop();
        sessions.delete(session);
      }
    for (const session of live)
      if (!sessions.has(session))
        sessions.set(
          session,
          watchSoloAnnouncements(
            session,
            states,
            {
              ...pullsFor(session),
              linked(channel, url) {
                for (const target of sessions.keys())
                  if (
                    target.scope === session.scope &&
                    target.viewer === session.viewer
                  )
                    pullsFor(target).linked(channel, url);
              },
            },
            (pubkey) =>
              agents
                .snapshot()
                .running.some(
                  (agent) =>
                    agent.pubkey === pubkey &&
                    agent.owner === session.viewer &&
                    agents.relay(agent.key)?.snapshot().scope === session.scope,
                ),
            agents.subscribe,
          ),
        );
  };
  const stop = agents.subscribe(bind);
  bind();
  return () => {
    stop();
    for (const release of sessions.values()) release();
    for (const release of connections.values()) release();
  };
}
