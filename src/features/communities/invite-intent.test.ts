import { expect, it, vi } from "vitest";
import { createInviteIntent } from "./invite-intent";

it("offers onboarding only to its active owner without creating a membership intent", () => {
  const intents = createInviteIntent();
  const invite = { community: "https://relay.example", code: "x" };
  const ready = vi.fn();
  const stop = intents.onboarding.subscribe(ready);
  expect(intents.onboarding.offer(invite)).toBe(false);
  const first = vi.fn();
  const releaseFirst = intents.onboarding.handle(first);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(intents.onboarding.offer(invite)).toBe(true);
  expect(first).toHaveBeenCalledWith(invite);
  expect(intents.snapshot()).toBeUndefined();
  const second = vi.fn();
  const releaseSecond = intents.onboarding.handle(second);
  releaseFirst();
  expect(intents.onboarding.offer(invite)).toBe(true);
  expect(second).toHaveBeenCalledTimes(1);
  releaseSecond();
  expect(intents.onboarding.offer(invite)).toBe(false);
  stop();
});

it("keeps the latest arrival and cannot clear a newer invite from a stale dialog", () => {
  const intents = createInviteIntent();
  const listener = vi.fn();
  const stop = intents.subscribe(listener);
  const invite = { community: "https://relay.example", code: "x" };
  intents.open(invite, "alice");
  const old = intents.snapshot();
  intents.open(invite, "alice");
  expect(intents.snapshot()?.requestId).not.toBe(old?.requestId);
  intents.clear(old?.requestId);
  expect(intents.snapshot()?.code).toBe("x");
  intents.clear(intents.snapshot()?.requestId);
  expect(intents.snapshot()).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
});
