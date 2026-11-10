import { expect, test, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type { ChannelMessage } from "../../features/relay/contracts";
import type { RailEntry } from "./rail-pins";
import { preferredRailAgents, recentReceivedMessages } from "./rail-activity";

test("recent destinations keep five distinct received conversations and current loaded content", () => {
  const base = createRelaySession(null).session;
  const channels = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    name: `Channel ${i}`,
  }));
  const session = {
    ...base,
    viewer: "me",
    unread: {
      ...base.unread,
      snapshot: (target: Parameters<typeof base.unread.snapshot>[0]) => ({
        ...base.unread.snapshot(target),
        ...(target.channelId === "c6"
          ? {
              latestTopLevel: {
                id: "latest-6",
                createdAt: 60,
                authorId: "alice",
                content: "old content",
              },
            }
          : {}),
      }),
    },
    channels: {
      ...base.channels,
      window: (id: string) => ({
        ...base.channels.window(id),
        rows: [
          {
            id: `latest-${id.slice(1)}`,
            authorId: "alice",
            createdAt: Number(id.slice(1)) * 10,
            content: "current content",
          },
          {
            id: `self-${id}`,
            authorId: "me",
            createdAt: 200,
            content: "outgoing",
          },
          {
            id: `quiet-${id}`,
            authorId: "agent",
            createdAt: 300,
            audience: "agents" as const,
            content: "coordination",
          },
          {
            id: `pending-${id}`,
            authorId: "alice",
            createdAt: 400,
            delivery: "sending" as const,
            content: "pending",
          },
        ].map(
          (row): ChannelMessage => ({
            ...row,
            channelId: id,
            mentions: [],
            attachments: [],
            reactions: [],
            replyCount: 0,
            participants: [],
          }),
        ),
      }),
    },
  };
  const recent = recentReceivedMessages(session, channels, [], "c7");
  expect(recent.map((item) => item.channelId)).toEqual([
    "c6",
    "c5",
    "c4",
    "c3",
    "c2",
  ]);
  expect(recent[0]?.previewContent).toBe("current content");
});

test("agent ranking combines personal and channel usage once per candidate", () => {
  const agents: RailEntry[] = ["zed", "amy", "bob", "cat"].map((key) => ({
    id: `agent:${key}`,
    kind: "agent",
    label: key,
    target: { kind: "person", pubkey: key },
  }));
  const boost = vi.fn((...keys: string[]) =>
    keys.includes("channel:used") ? 1 : 0,
  );
  const result = preferredRailAgents(
    agents,
    [{ id: "used", name: "Used", members: ["zed", "zed"] }],
    { boost, pick: () => undefined },
  );
  expect(result.map((entry) => entry.label)).toEqual([
    "zed",
    "amy",
    "bob",
    "cat",
  ]);
  expect(boost).toHaveBeenCalledTimes(agents.length);
  expect(boost).toHaveBeenCalledWith("person:zed", "channel:used");
});
