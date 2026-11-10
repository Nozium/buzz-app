import { expect, it } from "vitest";
import type { InboxItem } from "../../features/relay/inbox";
import { acknowledge, hasCloud, parseFog, withFog } from "./fog";

const item = (messages: [string, number][]) =>
  ({
    messages: messages.map(([id, createdAt]) => ({
      id,
      createdAt,
      mentioned: false,
    })),
  }) as unknown as InboxItem;

it("acknowledges through the captured reply only", () => {
  const row = item([
    ["a", 10],
    ["b", 20],
    ["c", 30],
  ]);
  const record = acknowledge(row, "b");
  expect(record).toEqual({ at: 20, ids: ["a", "b"] });
  expect(hasCloud(row, record)).toBe(true);
  expect(
    hasCloud(
      item([
        ["a", 10],
        ["b", 20],
      ]),
      record,
    ),
  ).toBe(false);
});

it("treats a same-second newcomer as activity but ignores older stragglers", () => {
  const record = acknowledge(item([["b", 20]]));
  expect(
    hasCloud(
      item([
        ["b", 20],
        ["c", 20],
      ]),
      record,
    ),
  ).toBe(true);
  expect(
    hasCloud(
      item([
        ["z", 5],
        ["b", 20],
      ]),
      record,
    ),
  ).toBe(false);
});

it("ignores malformed saved data and caps entries", () => {
  expect(parseFog("x")).toEqual({});
  expect(
    parseFog({
      threads: { a: { at: "1", ids: [] }, b: { at: 1, ids: ["x"] } },
    }),
  ).toEqual({
    b: { at: 1, ids: ["x"] },
  });
  let state = parseFog({});
  for (let i = 0; i < 1005; i++)
    state = withFog(state, `t${i}`, { at: i, ids: [] }).threads;
  expect(Object.keys(state)).toHaveLength(1000);
  expect(withFog(state, "t1004", undefined).threads.t1004).toBeUndefined();
});
