import { expect, it } from "vitest";
import { createAgentChoices } from "../../features/agents/choices";
import { createAgentActivity } from "../../features/agents/activity";
import { createAgentLibrary } from "../../features/agents/library";
import { createLocalAgentActivity } from "../../features/agents/local-activity";
import { localAgentsFixture } from "../../features/agents/local-testing";
import type { RelaySnapshot } from "../../features/relay/service";
import { activeAgents } from "./active-agents";

it("tracks real waiting/working/finished projections and excludes agents from other accounts", () => {
  const viewer = "a".repeat(64),
    pubkey = "b".repeat(64),
    origin = "https://relay.example.org",
    scope = `${origin}:${viewer}`;
  const native = localAgentsFixture([
    { pubkey, name: "Research", owner: viewer, relayUrl: origin },
    {
      pubkey: "c".repeat(64),
      name: "Other account",
      owner: "d".repeat(64),
      relayUrl: origin,
    },
  ]);
  const lifetime = new AbortController(),
    library = createAgentLibrary(undefined);
  const choices = createAgentChoices({
    scope,
    library: library.queries,
    native,
    signal: lifetime.signal,
  });
  const local = createLocalAgentActivity();
  const activity = createAgentActivity(
    false,
    () => {},
    () => true,
    undefined,
    undefined,
    { source: local.reader, scope },
  );
  const connection = {
    status: "ready",
    generation: 1,
    viewer,
    origin,
    scope,
    session: { viewer, agentChoices: choices, agentActivity: activity.queries },
  } as RelaySnapshot;
  const feed = activeAgents.open(connection, {});
  try {
    const work = local.begin({
      scope,
      agent: pubkey,
      channelId: "channel",
      messageId: "message",
      threadRootId: "root",
    });
    const other = local.begin({
      scope,
      agent: "c".repeat(64),
      channelId: "channel",
      messageId: "other",
      threadRootId: "root",
    });
    expect(feed.snapshot().items).toMatchObject([
      { label: "Research", status: "Waiting", updatedAt: expect.any(Number) },
    ]);
    work.started();
    expect(feed.snapshot().items).toMatchObject([{ status: "Working" }]);
    work.finish({ ok: true });
    other.finish({ ok: true });
    expect(feed.snapshot().items).toEqual([]);
    expect(feed.snapshot().partial).toBe(true); // remote coverage is unavailable, not idle
  } finally {
    feed.dispose();
    lifetime.abort();
    activity.dispose();
    library.dispose();
  }
  expect(native.listeners()).toBe(0);
});
