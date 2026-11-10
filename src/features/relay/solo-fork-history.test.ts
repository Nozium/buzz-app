import { expect, it, vi } from "vitest";
import { eventDto } from "./events";
import { readSoloFork } from "./solo-fork-history";
import { keypair, signed } from "./testing";

const id = "44444444-4444-4444-8444-444444444444";
const source = "22222222-2222-4222-8222-222222222222";
const pointer = ["forked_from", source, "ab".repeat(32)];

it("reads fresh authority metadata, not an untrusted or wrong-channel pointer", async () => {
  const relay = keypair();
  const metadata = (author = relay, channel = id, tags: string[][] = []) =>
    eventDto(
      signed(author, {
        kind: 39000,
        content: "",
        created_at: 10,
        tags: [["d", channel], ...tags],
      }),
    );
  const read = vi.fn(async () => [
    metadata(keypair(), id, [pointer]),
    metadata(relay, source, [pointer]),
    metadata(),
  ]);
  const controller = new AbortController();
  const reader = { read, relayAuthor: () => relay.pubkey };
  await expect(
    readSoloFork(reader, id, controller.signal),
  ).resolves.toBeUndefined();
  expect(read).toHaveBeenCalledExactlyOnceWith(
    [
      {
        kinds: [39000],
        authors: [relay.pubkey],
        "#d": [id],
        limit: 1,
        consistency: "strong",
      },
    ],
    controller.signal,
  );
  read.mockResolvedValue([{ ...metadata(relay, id, [pointer]) }]);
  await expect(readSoloFork(reader, id, controller.signal)).rejects.toThrow(
    "signed metadata could not be confirmed",
  );
  read.mockResolvedValue([metadata(relay, id, [pointer])]);
  await expect(readSoloFork(reader, id, controller.signal)).resolves.toEqual({
    channelId: source,
    messageId: pointer[2],
  });
  read.mockResolvedValue([metadata(relay, id, [pointer, pointer])]);
  await expect(readSoloFork(reader, id, controller.signal)).rejects.toThrow(
    "invalid source metadata",
  );
  read.mockResolvedValue([]);
  await expect(readSoloFork(reader, id, controller.signal)).rejects.toThrow(
    "signed metadata could not be confirmed",
  );
});

it("requires metadata authority and propagates read failure and cancellation", async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => []);
  await expect(
    readSoloFork({ read, relayAuthor: () => undefined }, id, controller.signal),
  ).rejects.toThrow("authority is unavailable");
  expect(read).not.toHaveBeenCalled();
  const reader = { read, relayAuthor: () => keypair().pubkey };
  read.mockRejectedValueOnce(new Error("access revoked"));
  await expect(readSoloFork(reader, id, controller.signal)).rejects.toThrow(
    "access revoked",
  );
  controller.abort();
  await expect(
    readSoloFork(reader, id, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
