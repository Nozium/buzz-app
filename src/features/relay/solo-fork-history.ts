import {
  hasEventProof,
  newer,
  type EventData,
  type ReadFilter,
} from "./events";
import { soloFork, type SoloFork } from "./solo-fork-protocol";

export type ForkReader = Readonly<{
  read(
    filters: readonly ReadFilter[],
    signal: AbortSignal,
  ): Promise<readonly EventData[]>;
  relayAuthor(): string | undefined;
}>;

/** Fresh authorized metadata: absence/error is unresolved, never an ordinary chat. */
export async function readSoloFork(
  reader: ForkReader,
  channelId: string,
  signal: AbortSignal,
): Promise<SoloFork | undefined> {
  const author = reader.relayAuthor();
  if (!author)
    throw new Error("The community's metadata authority is unavailable.");
  const events = await reader.read(
    [
      {
        kinds: [39000],
        authors: [author],
        "#d": [channelId],
        limit: 1,
        consistency: "strong",
      },
    ],
    signal,
  );
  signal.throwIfAborted();
  const metadata = events
    .filter(
      (event) =>
        hasEventProof(event) &&
        event.kind === 39000 &&
        event.pubkey === author &&
        event.tags.some((tag) => tag[0] === "d" && tag[1] === channelId),
    )
    .reduce<EventData | undefined>(
      (previous, event) => newer(previous, event),
      undefined,
    );
  if (!metadata)
    throw new Error(
      "The chat's signed metadata could not be confirmed. Retry without creating another chat.",
    );
  return soloFork(metadata);
}
