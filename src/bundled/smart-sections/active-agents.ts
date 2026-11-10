import { agentTarget } from "../agents/routes";
import type {
  Source,
  FeedState,
  Entity,
} from "../../features/smart-sections/model";

export const activeAgents: Source = {
  id: "buzz.agents/active",
  title: "Active agents",
  description:
    "Your agents with observed working or waiting activity in this community. Missing remote evidence does not imply idle.",
  configSchema: { type: "object", properties: {}, additionalProperties: false },
  fields: [],
  parse(config) {
    if (Object.keys(config).length)
      throw new Error("Active agents has no configuration fields");
    return {};
  },
  open(connection) {
    const viewer = connection.viewer,
      origin = connection.origin;
    if (!viewer || !origin) throw new Error("Connect to this community first");
    const session = connection.session,
      choices = session.agentChoices,
      activity = session.agentActivity;
    const listeners = new Set<() => void>();
    let state: FeedState = { status: "loading", items: [] },
      fingerprint = "";
    const update = () => {
      const inventory = choices.snapshot(),
        evidence = activity.snapshot();
      const active = new Map<
        string,
        { status: string; updatedAt: number; subtitle: string }
      >();
      for (const turn of evidence.turns)
        if (turn.state === "working")
          active.set(turn.agent, {
            status: "Working",
            updatedAt: turn.timestamp,
            subtitle: "Active turn",
          });
      for (const work of evidence.local ?? []) {
        if (work.state !== "working" && work.state !== "waiting") continue;
        const old = active.get(work.agent);
        if (old?.status === "Working" && work.state === "waiting") continue;
        active.set(work.agent, {
          status: work.state === "working" ? "Working" : "Waiting",
          updatedAt: work.startedAt,
          subtitle:
            work.step?.tool ?? work.conversationName ?? "Active request",
        });
      }
      const items: Entity[] = inventory.selectable.flatMap((agent) => {
        const found = active.get(agent.pubkey);
        if (!found) return [];
        const label = agent.managedName ?? agent.name;
        return [
          {
            id: agent.pubkey,
            label,
            ...found,
            text: `${label}\n${found.status}\n${found.subtitle}`,
            target: {
              ...agentTarget(agent.pubkey),
              scope: { viewer, communityOrigin: origin },
            },
          },
        ];
      });
      const next: FeedState = {
        items,
        status: inventory.pending ? "loading" : "ready",
        ...(!inventory.complete || evidence.status !== "listening"
          ? { partial: true }
          : {}),
      };
      const key = JSON.stringify(next);
      if (key === fingerprint) return;
      fingerprint = key;
      state = next;
      for (const listener of listeners) listener();
    };
    const release = choices.retain(),
      releaseActivity = activity.activate();
    // Existing activity owner supplies evidence. The shared lease
    // activates one session observer, independent of the Attention plugin.
    choices.ensure(true, true);
    const offChoices = choices.subscribe(update),
      offActivity = activity.subscribe(update);
    update();
    return {
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async refresh() {
        choices.ensure(true, true);
        update();
      },
      dispose() {
        offChoices();
        offActivity();
        release();
        releaseActivity();
        listeners.clear();
      },
    };
  },
};
