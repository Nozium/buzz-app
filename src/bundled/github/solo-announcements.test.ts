// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import type { LiveBatch } from "../../features/relay/incoming";
import type { EventData, RelayEvent } from "../../features/relay/events";
import type { PullState, PullStates } from "./pull-states";
import {
  announcedPull,
  watchSoloAnnouncements,
  watchSoloConnections,
} from "./solo-announcements";
import type { Agents } from "../../features/agents/service";
import type { RelayData } from "../../features/relay/service";
import { approvedPull } from "./solo-pull.fixtures";
import { writeLink } from "./solo-pull";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const chat = "11111111-1111-4111-8111-111111111111";
const viewer = "c".repeat(64),
  agent = "a".repeat(64);
const url = "https://github.com/example/project/pull/7";
const branch = "feature";
const declaration = (extra: Partial<EventData> = {}): RelayEvent =>
  ({
    id: crypto.randomUUID(),
    pubkey: agent,
    kind: 9,
    created_at: 1,
    content: `Created ${url}`,
    tags: [
      ["h", chat],
      ["buzz:pull-request", url, branch],
    ],
    ...extra,
  }) as RelayEvent;

function fixture(start = true) {
  let listener!: (batch: LiveBatch) => Promise<unknown>;
  let heads: EventData[] = [];
  const channel = {
    id: chat,
    creator: viewer,
    channelType: "solo",
    members: [viewer, agent],
    archived: false,
    readOnly: false,
  };
  const sign = vi.fn(async (template: object) => ({
    ...template,
    id: crypto.randomUUID(),
    pubkey: viewer,
  }));
  const publish = vi.fn(async (event: EventData) => {
    heads = [event];
    return "";
  });
  const snapshotRead = vi.fn(async () => heads);
  const dispose = vi.fn();
  let listed = true,
    owned = true;
  let channelsChanged = () => {},
    agentsChanged = () => {};
  const session = {
    viewer,
    channels: {
      list: () => ({
        status: listed ? "ready" : "loading",
        channels: listed ? [channel] : [],
      }),
      subscribeList: (listener: () => void) => {
        channelsChanged = listener;
        return () => {};
      },
    },
    snapshotRead,
    configArtifactWriter: { sign, publish },
    subscribeLive: vi.fn((next) => {
      listener = next;
      return dispose;
    }),
  } as unknown as RelaySession;
  const state = { ...approvedPull().state, branch };
  const states = {
    read: vi.fn(async () => ({ state, readAt: Date.now() })),
  } as unknown as PullStates;
  const linked = vi.fn();
  const pulls = { watch: () => () => {}, get: () => undefined, linked };
  const stop = start
    ? watchSoloAnnouncements(
        session,
        states,
        pulls,
        (key) => owned && key === agent,
        (listener) => {
          agentsChanged = listener;
          return () => {};
        },
      )
    : () => {};
  return {
    session,
    states,
    state,
    sign,
    publish,
    snapshotRead,
    linked,
    stop,
    dispose,
    channel,
    listChannels: () => {
      listed = true;
      channelsChanged();
    },
    hideChannels: () => {
      listed = false;
    },
    loadAgent: () => {
      owned = true;
      agentsChanged();
    },
    hideAgent: () => {
      owned = false;
    },
    emit: (events: RelayEvent[], replay?: true) =>
      listener({ events, ...(replay ? { replay } : {}) }),
    heads: () => heads,
  };
}

it("only reads a single explicit top-level work declaration, never prose or fixtures", () => {
  expect(announcedPull(declaration())).toEqual({ channel: chat, url, branch });
  for (const event of [
    declaration({ tags: [["h", chat]], content: `PR: ${url}` }),
    declaration({ kind: 40003 }),
    declaration({
      tags: [
        ["h", chat],
        ["buzz:pull-request", url, branch],
        ["e", "quoted", "", "reply"],
      ],
    }),
    declaration({
      tags: [
        ["h", chat],
        ["buzz:pull-request", url, branch],
        ["buzz:pull-request", `${url}8`, branch],
      ],
    }),
    declaration({
      tags: [
        ["h", chat],
        ["h", "other"],
        ["buzz:pull-request", url, branch],
      ],
    }),
    declaration({
      tags: [
        ["h", chat],
        ["buzz:pull-request", "https://github.com.evil/project/pull/7", branch],
      ],
    }),
    declaration({
      tags: [
        ["h", chat],
        ["buzz:pull-request", url, ""],
      ],
    }),
  ])
    expect(announcedPull(event)).toBeUndefined();
});

it("automatically persists the PR from a verified own-agent announcement, with replay idempotency", async () => {
  const f = fixture();
  const event = declaration();
  f.emit([event]);
  await vi.waitFor(() => expect(f.linked).toHaveBeenCalledWith(chat, url));
  expect(JSON.parse(f.heads()[0]?.content ?? "{}").url).toBe(url);
  f.emit([event], true);
  expect(f.states.read).toHaveBeenCalledOnce();
  f.stop();
  expect(f.dispose).toHaveBeenCalledOnce();
  // A new listener on reconnect reads the durable record rather than replacing it.
  let listener!: (batch: LiveBatch) => void;
  const session = {
    ...f.session,
    subscribeLive: (next: typeof listener) => {
      listener = next;
      return () => {};
    },
  } as RelaySession;
  const stop = watchSoloAnnouncements(
    session,
    f.states,
    { watch: () => () => {}, get: () => undefined, linked: f.linked },
    () => true,
  );
  listener({ events: [event], replay: true });
  await vi.waitFor(() => expect(f.snapshotRead).toHaveBeenCalledTimes(3));
  expect(f.publish).toHaveBeenCalledOnce();
  stop();
});

it.each([
  "foreign agent",
  "foreign author",
  "foreign branch",
  "public",
  "failed",
  "archived",
  "read-only",
  "team",
])("does not link %s", async (reason) => {
  const f = fixture();
  const read = vi.mocked(f.states.read);
  let result: PullState = f.state;
  if (reason === "foreign author")
    result = {
      ...result,
      details: {
        ...f.state.details,
        checklist: { ...f.state.details.checklist, authored: false },
      },
    };
  if (reason === "foreign branch") result = { ...result, branch: "different" };
  if (reason === "public")
    result = { ...result, details: { ...f.state.details, signedIn: false } };
  if (reason === "archived") f.channel.archived = true;
  if (reason === "read-only") f.channel.readOnly = true;
  if (reason === "team") f.channel.channelType = "stream";
  read.mockImplementationOnce(async () => {
    return {
      state: result,
      readAt: Date.now(),
      ...(reason === "failed" ? { error: new Error("offline") } : {}),
    };
  });
  await f.emit([
    declaration(reason === "foreign agent" ? { pubkey: "f".repeat(64) } : {}),
  ]);
  expect(f.publish).not.toHaveBeenCalled();
  f.stop();
});

it("refuses ambiguous candidates, including a new candidate while the first read waits", async () => {
  const f = fixture();
  const gate = deferred<Awaited<ReturnType<PullStates["read"]>>>();
  vi.mocked(f.states.read).mockReturnValue(gate.promise);
  const work = f.emit([declaration()]);
  expect(f.states.read).toHaveBeenCalledOnce();
  f.emit([
    declaration({
      tags: [
        ["h", chat],
        ["buzz:pull-request", `${url}8`, branch],
      ],
    }),
  ]);
  gate.resolve({ state: f.state, readAt: Date.now() });
  await work;
  f.stop();
  expect(f.publish).not.toHaveBeenCalled();
});

it.each([null, "https://github.com/example/project/pull/99"])(
  "preserves explicit prior intent %s",
  async (manual) => {
    const f = fixture();
    await writeLink(f.session, chat, manual);
    await f.emit([declaration()], true);
    expect(f.snapshotRead).toHaveBeenCalledTimes(2);
    expect(f.publish).toHaveBeenCalledOnce();
    expect(JSON.parse(f.heads()[0]?.content ?? "{}").url).toBe(manual);
    f.stop();
  },
);

it("serializes a manual unlink behind an automatic create without losing intent", async () => {
  const f = fixture();
  const gate = deferred<void>();
  const started = deferred<void>();
  const persist = f.publish.getMockImplementation();
  if (!persist) throw new Error("Missing fixture publisher");
  f.publish.mockImplementationOnce(async (event) => {
    started.resolve(undefined);
    await gate.promise;
    return persist(event);
  });
  const automatic = f.emit([declaration()]);
  await started.promise;
  const anotherConnection = { ...f.session } as RelaySession;
  const unlink = writeLink(anotherConnection, chat, null);
  gate.resolve(undefined);
  await unlink;
  await automatic;
  expect(JSON.parse(f.heads()[0]?.content ?? "{}").url).toBeNull();
  expect(f.publish).toHaveBeenCalledTimes(2);
  expect(f.linked).not.toHaveBeenCalled();
  f.stop();
});

it("rechecks channel eligibility after GitHub resolves and aborts on disposal", async () => {
  const f = fixture();
  const gate = deferred<Awaited<ReturnType<PullStates["read"]>>>();
  vi.mocked(f.states.read).mockReturnValue(gate.promise);
  const work = f.emit([declaration()]);
  f.channel.members = [viewer];
  gate.resolve({ state: f.state, readAt: Date.now() });
  await work;
  f.stop();
  expect(f.publish).not.toHaveBeenCalled();
});

it("retries a failed GitHub read only when the declaration is delivered again", async () => {
  const f = fixture();
  const event = declaration();
  vi.mocked(f.states.read).mockResolvedValueOnce({
    state: f.state,
    readAt: Date.now(),
    error: new Error("offline"),
  });
  await f.emit([event]);
  expect(f.publish).not.toHaveBeenCalled();
  await f.emit([event], true);
  expect(f.linked).toHaveBeenCalledWith(chat, url);
  expect(f.publish).toHaveBeenCalledOnce();
  f.stop();
});

it.each(["channels", "agent"])(
  "retains declarations until %s metadata is available",
  async (kind) => {
    const f = fixture();
    if (kind === "channels") f.hideChannels();
    else f.hideAgent();
    await f.emit([declaration()], true);
    expect(f.states.read).not.toHaveBeenCalled();
    if (kind === "channels") f.listChannels();
    else f.loadAgent();
    await vi.waitFor(() => expect(f.linked).toHaveBeenCalledWith(chat, url));
    expect(f.publish).toHaveBeenCalledOnce();
    f.stop();
  },
);

it("starts before any row renders, observes another community and releases replaced sessions", async () => {
  const selected = fixture(false),
    background = fixture(false),
    replacement = fixture(false);
  let current = background.session;
  const changed = new Set<() => void>();
  const connection = (read: () => RelaySession) =>
    ({
      snapshot: () => ({ status: "ready", session: read() }),
      subscribe: (listener: () => void) => {
        changed.add(listener);
        return () => changed.delete(listener);
      },
    }) as unknown as RelayData;
  const relay = connection(() => selected.session),
    other = connection(() => current);
  const agents = {
    snapshot: () => ({
      running: [{ key: "local", pubkey: agent, owner: viewer }],
    }),
    relay: () => other,
    subscribe: () => () => {},
  } as unknown as Pick<Agents, "snapshot" | "relay" | "subscribe">;
  const stop = watchSoloConnections(
    relay,
    agents,
    background.states,
    (session) => ({
      watch: () => () => {},
      get: () => undefined,
      linked:
        session === selected.session ? selected.linked : background.linked,
    }),
  );
  expect(selected.session.subscribeLive).toHaveBeenCalledOnce();
  expect(background.session.subscribeLive).toHaveBeenCalledOnce();
  await background.emit([declaration()]);
  expect(background.linked).toHaveBeenCalledWith(chat, url);
  expect(selected.linked).toHaveBeenCalledWith(chat, url);
  current = replacement.session;
  for (const listener of [...changed]) listener();
  expect(background.dispose).toHaveBeenCalledOnce();
  expect(replacement.session.subscribeLive).toHaveBeenCalledOnce();
  stop();
  expect(selected.dispose).toHaveBeenCalledOnce();
  expect(replacement.dispose).toHaveBeenCalledOnce();
  expect(changed.size).toBe(0);
});

it("does not project an auto-create superseded by another device's manual intent", async () => {
  const f = fixture();
  const persist = f.publish.getMockImplementation();
  if (!persist) throw new Error("Missing publisher");
  f.publish.mockImplementationOnce(async (event) => {
    await persist(event);
    f.snapshotRead.mockResolvedValueOnce([
      {
        ...event,
        id: "manual",
        content: JSON.stringify({ version: 1, url: null }),
      },
    ]);
    return "";
  });
  await f.emit([declaration()]);
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.linked).not.toHaveBeenCalled();
  f.stop();
});
