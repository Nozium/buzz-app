// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Decisions, DecisionResult } from "../decisions/service";
import { checkRequest } from "../decisions/service";
import type { RelayData, RelaySnapshot } from "../relay/service";
import { createSmartSections } from "./runtime";
import {
  definitions,
  removeDefinition,
  type Entity,
  type FeedState,
  type SectionInput,
  type Source,
} from "./model";

const viewer = "a".repeat(64),
  origin = "https://relay.example.org",
  partition = `${origin}:${viewer}`;
const input: SectionInput = {
  title: "Open PRs",
  request: "Show my open PRs",
  source: "example/pulls",
  config: {},
  criteria: "",
  limit: 5,
  paused: false,
};
const entity = (id: string, text = id): Entity => ({
  id,
  text,
  label: id,
  subtitle: "",
  status: "Open",
  updatedAt: 1,
  url: `https://example.org/${id}`,
});
const releases: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function harness() {
  let connection: RelaySnapshot = {
    status: "ready",
    generation: 1,
    viewer,
    origin,
    scope: partition,
    session: {} as never,
  };
  const relayListeners = new Set<() => void>();
  const relay: RelayData = {
    snapshot: () => connection,
    subscribe(listener) {
      relayListeners.add(listener);
      return () => {
        relayListeners.delete(listener);
      };
    },
    retry() {},
    disconnect() {},
    async clearCache() {},
  };
  const decide = vi.fn<Decisions["decide"]>(async (request) => ({
    outcome: "answered",
    backend: "example/provider",
    model: "v1",
    answers: Object.fromEntries(
      Object.keys(request.questions).map((id) => [
        id,
        { type: "yes_no", probability: 1 },
      ]),
    ),
  }));
  const decisions: Decisions = {
    decide,
    backend: () => "example/provider",
    status: () => "ready",
    subscribe: () => () => {},
    registerProvider: () => () => {},
  };
  const service = createSmartSections(relay, decisions);
  releases.push(service.dispose);
  const feeds: {
    set(state: FeedState): void;
    dispose: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  }[] = [];
  const source: Source = {
    id: input.source,
    title: "PRs",
    description: "PRs",
    configSchema: {},
    fields: [],
    parse: () => ({}),
    open() {
      let state: FeedState = { status: "loading", items: [] };
      const listeners = new Set<() => void>();
      const dispose = vi.fn(),
        refresh = vi.fn(async () => {});
      feeds.push({
        set(next) {
          state = next;
          for (const listener of listeners) listener();
        },
        dispose,
        refresh,
      });
      return {
        snapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        dispose,
        refresh,
      };
    },
  };
  service.register(source);
  return {
    service,
    decide,
    feeds,
    relay,
    switchScope(nextViewer: string) {
      connection = {
        ...connection,
        viewer: nextViewer,
        scope: `${origin}:${nextViewer}`,
        session: {} as never,
        generation: connection.generation + 1,
      };
      for (const listener of relayListeners) listener();
    },
  };
}
it("persists scoped definitions, rejects stale edits and storage failures, and restores the original community", async () => {
  const h = harness(),
    saved = h.service.save(partition, input);
  expect(definitions(partition)).toEqual([saved]);
  expect(() =>
    h.service.save(
      partition,
      { ...input, title: "Changed" },
      saved.id,
      "stale",
    ),
  ).toThrow("Section changed");
  h.switchScope("b".repeat(64));
  expect(h.service.snapshot()).toEqual([]);
  h.switchScope(viewer);
  expect(h.service.snapshot()[0]?.definition.title).toBe("Open PRs");
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
  expect(() =>
    h.service.save(
      partition,
      { ...input, title: "Unsaved" },
      saved.id,
      saved.revision,
    ),
  ).toThrow("Couldn’t save");
  expect(definitions(partition)[0]?.title).toBe("Open PRs");
  storage.mockRestore();
  removeDefinition(partition, saved.id, saved.revision);
  expect(h.service.snapshot()).toEqual([]);
});
it("shares one feed, preserves it on rename, removes closed items, and releases it only after its last section pauses", async () => {
  const h = harness(),
    first = h.service.save(partition, input),
    second = h.service.save(partition, { ...input, title: "Other PRs" });
  expect(h.feeds).toHaveLength(1);
  const feed = h.feeds[0];
  if (!feed) throw new Error("Source did not open");
  feed.set({ status: "ready", items: [entity("a"), entity("b")] });
  expect(h.service.snapshot().map((row) => row.items.length)).toEqual([2, 2]);
  const renamed = h.service.save(
    partition,
    { ...input, title: "Renamed" },
    first.id,
    first.revision,
  );
  expect(h.feeds).toHaveLength(1);
  feed.set({ status: "ready", items: [entity("b")] });
  expect(
    h.service
      .snapshot()
      .every((row) => row.items.map((item) => item.id).join() === "b"),
  ).toBe(true);
  h.service.save(
    partition,
    { ...input, paused: true },
    renamed.id,
    renamed.revision,
  );
  expect(feed.dispose).not.toHaveBeenCalled();
  h.service.save(
    partition,
    { ...input, paused: true },
    second.id,
    second.revision,
  );
  expect(feed.dispose).toHaveBeenCalledOnce();
});
it("keeps changed confirmed matches stale on inference failure, excludes new unknowns, and never reuses old criteria", async () => {
  const h = harness(),
    saved = h.service.save(partition, { ...input, criteria: "Relevant" });
  const feed = h.feeds[0];
  if (!feed) throw new Error("Source did not open");
  feed.set({ status: "ready", items: [entity("a")] });
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]?.items).toHaveLength(1),
  );
  const answered = h.decide.mock.calls.length;
  feed.set({ status: "ready", items: [entity("a")] });
  await h.service.refresh(saved.id);
  await vi.waitFor(() => expect(h.service.snapshot()[0]?.status).toBe("ready"));
  expect(h.decide).toHaveBeenCalledTimes(answered);
  h.decide.mockResolvedValue({
    outcome: "failed",
    backend: "example/provider",
    reason: "missing_credentials",
  });
  feed.set({
    status: "ready",
    items: [entity("a", "Changed description"), entity("b")],
  });
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]).toMatchObject({
      status: "stale",
      unknown: 2,
      items: [{ id: "a" }],
    }),
  );
  const failedCalls = h.decide.mock.calls.length;
  await new Promise<void>((resolve) => {
    const off = h.service.subscribe(() => {
      off();
      resolve();
    });
    feed.set({
      status: "ready",
      items: [entity("a", "Changed description"), entity("b")],
    });
  });
  expect(h.decide).toHaveBeenCalledTimes(failedCalls);
  await new Promise<void>((resolve, reject) => {
    const off = h.service.subscribe(() => {
      off();
      resolve();
    });
    h.service.refresh(saved.id).catch((error) => {
      off();
      reject(error);
    });
  });
  expect(h.decide).toHaveBeenCalledTimes(failedCalls + 1);
  h.service.save(
    partition,
    { ...input, criteria: "Different criteria" },
    saved.id,
    saved.revision,
  );
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]).toMatchObject({
      status: "stale",
      unknown: 2,
      items: [],
    }),
  );
  feed.set({ status: "ready", items: [] });
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]).toMatchObject({
      status: "ready",
      items: [],
      unknown: 0,
    }),
  );
});
it.each([false, true])(
  "only discards a pending answer when membership evidence changes (changed=%s)",
  async (changed) => {
    const h = harness();
    let finish: (result: DecisionResult) => void = () => {
      throw new Error("No pending decision");
    };
    const gate = new Promise<DecisionResult>((resolve) => {
      finish = resolve;
    });
    h.decide.mockReturnValueOnce(gate);
    h.service.save(partition, { ...input, criteria: "Relevant" });
    h.feeds[0]?.set({ status: "ready", items: [entity("old")] });
    await vi.waitFor(() => expect(h.decide).toHaveBeenCalledOnce());
    try {
      h.feeds[0]?.set({
        status: "ready",
        items: [{ ...entity(changed ? "current" : "old"), updatedAt: 2 }],
      });
    } finally {
      finish({
        outcome: "answered",
        backend: "example/provider",
        model: "v1",
        answers: { item_0: { type: "yes_no", probability: 1 } },
      });
    }
    await vi.waitFor(() =>
      expect(h.service.snapshot()[0]?.items.map((row) => row.id)).toEqual([
        changed ? "current" : "old",
      ]),
    );
    expect(h.decide).toHaveBeenCalledTimes(changed ? 2 : 1);
  },
);
it("matches multilingual items within the Decisions byte limit", async () => {
  const h = harness();
  h.decide.mockImplementation(async (request) => {
    const reason = checkRequest(request);
    return reason
      ? { outcome: "failed", backend: "example/provider", reason }
      : {
          outcome: "answered",
          backend: "example/provider",
          model: "v1",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((id) => [
              id,
              { type: "yes_no", probability: 1 },
            ]),
          ),
        };
  });
  h.service.save(partition, { ...input, criteria: "Relevant" });
  const items = Array.from({ length: 16 }, (_, index) =>
    entity(String(index), "漢".repeat(5000)),
  );
  h.feeds[0]?.set({ status: "ready", items });
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]?.status).not.toBe("loading"),
  );
  expect(h.service.snapshot()[0]).toMatchObject({
    status: "ready",
    unknown: 0,
  });
  expect(h.service.snapshot()[0]?.items).toHaveLength(items.length);
  expect(
    h.decide.mock.calls.every(
      ([request]) => checkRequest(request) === undefined,
    ),
  ).toBe(true);
});

it("previews semantic membership without saving a definition, and releases its temporary feed", async () => {
  const h = harness();
  const preview = h.service.preview(h.relay.snapshot(), {
    ...input,
    criteria: "Relevant",
  });
  h.feeds[0]?.set({ status: "ready", items: [entity("candidate")] });
  expect((await preview).items.map((item) => item.id)).toEqual(["candidate"]);
  expect(definitions(partition)).toEqual([]);
  expect(h.feeds[0]?.dispose).toHaveBeenCalledOnce();
});

it("restores cached display metadata and matching decisions without storing inference input", async () => {
  const h = harness(),
    saved = h.service.save(partition, { ...input, criteria: "Relevant" });
  h.feeds[0]?.set({
    status: "ready",
    items: [entity("cached", "Private inference input")],
  });
  await vi.waitFor(() =>
    expect(h.service.snapshot()[0]?.items).toHaveLength(1),
  );
  h.service.dispose();
  const restored = harness();
  expect(restored.service.snapshot()[0]?.items).toMatchObject([
    { id: "cached", text: "" },
  ]);
  restored.feeds[0]?.set({
    status: "ready",
    items: [entity("cached", "Private inference input")],
  });
  await vi.waitFor(() =>
    expect(restored.service.snapshot()[0]?.status).toBe("ready"),
  );
  expect(restored.decide).not.toHaveBeenCalled();
  const stored = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index) ?? ""),
  ).join("\n");
  expect(stored).not.toContain("Private inference input");
  restored.service.save(
    partition,
    { ...input, criteria: "Relevant", paused: true },
    saved.id,
    saved.revision,
  );
  expect(restored.service.snapshot()[0]).toMatchObject({
    status: "paused",
    items: [{ id: "cached" }],
  });
});
