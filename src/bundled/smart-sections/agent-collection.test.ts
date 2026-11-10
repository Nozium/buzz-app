// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AddedTool } from "../../buzz-mcp/session-tools";
import type { BuzzClient } from "../../buzz-mcp/client";
import type { RelayData, RelaySnapshot } from "../../features/relay/service";
import { createSmartSections } from "../../features/smart-sections/runtime";
import { createAgentChoices } from "../../features/agents/choices";
import { createAgentLibrary } from "../../features/agents/library";
import { localAgentsFixture } from "../../features/agents/local-testing";
import {
  definitions,
  removeDefinition,
  type Definition,
} from "../../features/smart-sections/model";
import { agentCollectionSource, addCollectionTools } from "./agent-collection";

const viewer = "a".repeat(64),
  agent = "b".repeat(64),
  origin = "https://relay.example.org",
  scope = `${origin}:${viewer}`;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T16:00:00Z"));
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function harness() {
  const lifetime = new AbortController(),
    library = createAgentLibrary(undefined);
  const choices = createAgentChoices({
    scope,
    library: library.queries,
    native: localAgentsFixture([
      { pubkey: agent, owner: viewer, name: "Bestie", relayUrl: origin },
    ]),
    signal: lifetime.signal,
  });
  const connection: RelaySnapshot = {
    status: "ready",
    generation: 1,
    viewer,
    origin,
    scope,
    session: { agentChoices: choices } as never,
  };
  const relay: RelayData = {
    snapshot: () => connection,
    subscribe: () => () => {},
    retry() {},
    disconnect() {},
    async clearCache() {},
  };
  const service = createSmartSections(relay, {
    backend: () => undefined,
    decide: vi.fn(),
    status: () => "unavailable",
    subscribe: () => () => {},
    registerProvider: () => () => {},
  });
  const tools: AddedTool[] = [],
    wake = vi.fn();
  const agents = {
    addTool: (tool: AddedTool) => tools.push(tool),
    relay: () => relay,
    wake,
  };
  service.register(agentCollectionSource(agents));
  addCollectionTools(agents, service);
  cleanup.push(() => {
    service.dispose();
    lifetime.abort();
    library.dispose();
  });
  const call = async (
    name: string,
    args: Record<string, unknown>,
    key = agent,
  ) => {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error("Missing collection tool");
    return tool.call({ key } as BuzzClient, { channel: "bestie-dm" }, args);
  };
  const deliver = async (overrides = {}) =>
    JSON.parse(
      (await call("smart_sections_deliver", {
        title: "Stocks",
        request: "Track AAPL",
        rows: [row("$250.00 USD")],
        refresh_instructions:
          "Fetch the latest sourced AAPL quote and report its actual observation time and currency.",
        ...overrides,
      })) as string,
    ).section as Definition;
  const token = () => {
    const text = wake.mock.lastCall?.[1]?.text as string | undefined;
    const value = text?.match(/Refresh token: ([a-z0-9-]+)/)?.[1];
    if (!value) throw new Error("No refresh was requested");
    return value;
  };
  const publish = (
    section: Definition,
    refreshToken: string,
    value: Record<string, unknown>,
    key = agent,
  ) =>
    call(
      "smart_sections_publish",
      {
        section_id: section.id,
        expected_state: section.revision,
        refresh_token: refreshToken,
        ...value,
      },
      key,
    );
  return { service, wake, deliver, publish, token, call };
}
const row = (value: string) => ({
  id: "aapl",
  label: "AAPL",
  value,
  observed_at: new Date().toISOString(),
  source_url: "https://finance.example.org/quote/AAPL",
  description: "USD; source may report delayed market data.",
});
it("delivers sourced rows, automatically refreshes once per interval, and applies the returned snapshot", async () => {
  const h = harness(),
    section = await h.deliver();
  expect(definitions(scope)).toHaveLength(1);
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "ready",
    items: [{ label: "AAPL", status: "$250.00 USD" }],
  });
  await vi.advanceTimersByTimeAsync(14 * 60_000);
  expect(h.wake).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.wake).toHaveBeenCalledOnce();
  expect(h.service.snapshot()[0]?.status).toBe("loading");
  await h.service.refresh(section.id);
  expect(h.wake).toHaveBeenCalledOnce(); // pending wake is shared, not another turn
  await h.publish(section, h.token(), { rows: [row("$251.00 USD")] });
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "ready",
    items: [{ status: "$251.00 USD" }],
  });
  expect(h.service.snapshot()[0]?.note).toContain("15 minutes");
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(h.wake).toHaveBeenCalledTimes(2);
});
it("retains prior values on source failure, rejects late/foreign responses, and stops wakes after pause/removal", async () => {
  const h = harness(),
    section = await h.deliver();
  await h.service.refresh(section.id);
  const old = h.token();
  await h.publish(section, old, { error: "Market source unavailable" });
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "stale",
    note: "Market source unavailable",
    items: [{ status: "$250.00 USD" }],
  });
  await h.service.refresh(section.id);
  const current = h.token();
  await expect(
    h.publish(section, old, { rows: [row("$999.00 USD")] }),
  ).rejects.toThrow("expired or was replaced");
  await expect(
    h.publish(section, current, { rows: [row("$999.00 USD")] }, "c".repeat(64)),
  ).rejects.toThrow("assigned collection agent");
  const paused = h.service.save(
    scope,
    { ...section, paused: true },
    section.id,
    section.revision,
  );
  const before = h.wake.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(h.wake).toHaveBeenCalledTimes(before);
  await expect(
    h.publish(paused, current, { rows: [row("$999.00 USD")] }),
  ).rejects.toThrow("paused");
  const resumed = h.service.save(
    scope,
    { ...paused, paused: false },
    paused.id,
    paused.revision,
  );
  await h.service.refresh(resumed.id);
  const pending = h.token();
  removeDefinition(scope, resumed.id, resumed.revision);
  await expect(
    h.publish(resumed, pending, { rows: [row("$999.00 USD")] }),
  ).rejects.toThrow("changed or was removed");
  const after = h.wake.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(h.wake).toHaveBeenCalledTimes(after);
});
it("marks an unanswered refresh stale at its deadline and backs off instead of queuing overlapping work", async () => {
  const h = harness(),
    section = await h.deliver();
  await h.service.refresh(section.id);
  const expired = h.token();
  await vi.advanceTimersByTimeAsync(2 * 60_000);
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "stale",
    items: [{ status: "$250.00 USD" }],
  });
  await expect(
    h.publish(section, expired, { rows: [row("$999.00 USD")] }),
  ).rejects.toThrow("expired or was replaced");
  await vi.advanceTimersByTimeAsync(27 * 60_000);
  expect(h.wake).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.wake).toHaveBeenCalledTimes(2);
});
it("retires an obsolete refresh timeout when the section is renamed", async () => {
  const h = harness(),
    section = await h.deliver();
  await h.service.refresh(section.id);
  const oldToken = h.token();
  h.service.save(
    scope,
    { ...section, title: "Renamed stocks" },
    section.id,
    section.revision,
  );
  await expect(
    h.publish(section, oldToken, { rows: [row("$999.00 USD")] }),
  ).rejects.toThrow("changed");
  await vi.advanceTimersByTimeAsync(2 * 60_000);
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "ready",
    definition: { title: "Renamed stocks" },
    items: [{ status: "$250.00 USD" }],
  });
  expect(h.wake).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(13 * 60_000);
  expect(h.wake).toHaveBeenCalledTimes(2);
});

it("shows a wake failure as stale and retries after the backoff", async () => {
  const h = harness(),
    section = await h.deliver();
  h.wake.mockImplementationOnce(() => {
    throw new Error("Agent stopped");
  });
  await expect(h.service.refresh(section.id)).rejects.toThrow("Agent stopped");
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "stale",
    note: "Agent stopped",
    items: [{ status: "$250.00 USD" }],
  });
  await vi.advanceTimersByTimeAsync(29 * 60_000);
  expect(h.wake).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.wake).toHaveBeenCalledTimes(2);
  await h.publish(section, h.token(), { rows: [row("$252.00 USD")] });
  await vi.advanceTimersByTimeAsync(14 * 60_000);
  expect(h.wake).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.wake).toHaveBeenCalledTimes(3);
});
it.each([
  { rows: [row("$1"), row("$2")] },
  { rows: [{ ...row("$1"), source_url: "javascript:alert(1)" }] },
  { rows: [{ ...row("$1"), observed_at: "unknown" }] },
  { refresh_minutes: 0 },
])(
  "rejects invalid factual snapshots without creating a section: %j",
  async (input) => {
    const h = harness();
    await expect(h.deliver(input)).rejects.toThrow();
    expect(definitions(scope)).toEqual([]);
  },
);
it("refines a paused collection without resuming its automatic refreshes", async () => {
  const h = harness(),
    section = await h.deliver();
  const paused = h.service.save(
    scope,
    { ...section, paused: true },
    section.id,
    section.revision,
  );
  const changed = await h.deliver({
    section_id: paused.id,
    expected_state: paused.revision,
    title: "Renamed stocks",
  });
  expect(changed.paused).toBe(true);
  expect(h.service.snapshot()[0]?.definition.title).toBe("Renamed stocks");
  expect(h.service.snapshot()[0]?.items[0]?.status).toBe("$250.00 USD");
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(h.wake).not.toHaveBeenCalled();
});
it("does not acknowledge delivery when local persistence fails", async () => {
  const h = harness();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  await expect(h.deliver()).rejects.toThrow("Couldn’t save");
  expect(h.service.snapshot()).toEqual([]);
});

it("preserves confirmed data and its pending refresh when saving a refinement fails", async () => {
  const h = harness(),
    section = await h.deliver();
  await h.service.refresh(section.id);
  const token = h.token(),
    setItem = Storage.prototype.setItem;
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key.includes("smart-sections.v1")) throw new Error("Quota exceeded");
      setItem.call(this, key, value);
    });
  await expect(
    h.deliver({
      section_id: section.id,
      expected_state: section.revision,
      title: "Unsaved",
      rows: [row("$999.00 USD")],
    }),
  ).rejects.toThrow("Couldn’t save");
  expect(h.service.snapshot()[0]).toMatchObject({
    definition: { title: "Stocks" },
    items: [{ status: "$250.00 USD" }],
  });
  storage.mockRestore();
  await h.publish(section, token, { rows: [row("$251.00 USD")] });
  expect(h.service.snapshot()[0]?.items[0]?.status).toBe("$251.00 USD");
});

it("marks existing values stale when a refresh cannot be persisted", async () => {
  const h = harness(),
    section = await h.deliver();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  await expect(h.service.refresh(section.id)).rejects.toThrow("Couldn’t save");
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "stale",
    items: [{ status: "$250.00 USD" }],
  });
  expect(h.wake).not.toHaveBeenCalled();
});
