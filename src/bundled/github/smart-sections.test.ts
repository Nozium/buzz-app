import { afterEach, expect, it, vi } from "vitest";
import { openPullsSource } from "./smart-sections";
import type { GitHubCli } from "./gh";
import type { RelaySnapshot } from "../../features/relay/service";

const response = (numbers: number[], partial = false) => ({
  repository: {
    pullRequests: {
      nodes: numbers.map((number) => ({
        id: `PR_${number}`,
        number,
        title: `Pull ${number}`,
        bodyText: "Description",
        updatedAt: "2026-11-10T00:00:00Z",
        isDraft: number === 1,
        author: { login: "example-user" },
      })),
      pageInfo: { hasNextPage: partial },
    },
  },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("discovers open PRs, removes absent ones, retains stale data on failure, and bounds its automatic reads", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const gh = vi.fn<GitHubCli>().mockResolvedValue(response([1, 2], true));
  const source = openPullsSource(gh as GitHubCli),
    feed = source.open(
      {} as RelaySnapshot,
      source.parse({ repository: "Example-Org/Example-Repo" }),
    );
  try {
    expect(gh).not.toHaveBeenCalled();
    await feed.refresh();
    expect(feed.snapshot()).toMatchObject({
      status: "ready",
      partial: true,
      items: [
        {
          status: "Draft",
          url: "https://github.com/example-org/example-repo/pull/1",
        },
        { status: "Open" },
      ],
    });
    gh.mockRejectedValueOnce(new Error("Sign in again"));
    await feed.refresh();
    expect(feed.snapshot()).toMatchObject({
      status: "error",
      error: "Sign in again",
      items: [{ id: "PR_1" }, { id: "PR_2" }],
    });
    gh.mockResolvedValue(response([2]));
    await feed.refresh();
    expect(feed.snapshot().items.map((row) => row.id)).toEqual(["PR_2"]);
    const baseline = gh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(gh).toHaveBeenCalledTimes(baseline);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gh).toHaveBeenCalledTimes(baseline + 1);
  } finally {
    feed.dispose();
  }
  const baseline = gh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(gh).toHaveBeenCalledTimes(baseline);
});
it("coalesces concurrent refreshes and aborts the read when its last lease ends", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const gate = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const gh = vi.fn<GitHubCli>().mockReturnValue(gate as never);
  const feed = openPullsSource(gh as GitHubCli).open({} as RelaySnapshot, {
    repository: "example-org/example-repo",
  });
  const first = feed.refresh(),
    second = feed.refresh();
  expect(gh).toHaveBeenCalledOnce();
  try {
    feed.dispose();
    expect(gh.mock.calls[0]?.[2]?.aborted).toBe(true);
  } finally {
    finish(response([1]));
    await Promise.all([first, second]);
  }
  expect(feed.snapshot().items).toEqual([]);
});
