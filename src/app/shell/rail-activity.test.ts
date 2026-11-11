import { expect, test, vi } from "vitest";
import type { RailEntry } from "./rail-pins";
import { preferredRailAgents } from "./rail-activity";

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
