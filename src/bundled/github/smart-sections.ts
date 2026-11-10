import type { GitHubCli } from "./gh";
import type {
  Source,
  FeedState,
  Entity,
} from "../../features/smart-sections/model";

type Pull = {
  id: string;
  number: number;
  title: string;
  bodyText: string;
  updatedAt: string;
  isDraft: boolean;
  author: { login: string } | null;
};
const query = `query SmartSectionPulls($owner:String!, $name:String!) {
  repository(owner:$owner,name:$name) { pullRequests(states:OPEN,first:100,orderBy:{field:UPDATED_AT,direction:DESC}) {
    nodes { id number title bodyText updatedAt isDraft author { login } }
    pageInfo { hasNextPage }
  } }
}`;
/** One repository snapshot per leased account/config. At most 100 newest open PRs;
 * the partial flag is part of the product contract, never a complete-list claim. */
export function openPullsSource(gh: GitHubCli): Source {
  return {
    id: "buzz.github/open-pulls",
    title: "Open GitHub pull requests",
    description:
      "The 100 most recently updated open PRs in a repository, including drafts. Uses this device’s GitHub sign-in; refreshes about every five minutes while Buzz is open.",
    fields: [
      {
        key: "repository",
        label: "Repository",
        placeholder: "example-org/example-repo",
      },
    ],
    configSchema: {
      type: "object",
      required: ["repository"],
      additionalProperties: false,
      properties: {
        repository: { type: "string", description: "owner/repository" },
      },
    },
    parse(config) {
      if (
        Object.keys(config).some((key) => key !== "repository") ||
        typeof config.repository !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(
          config.repository,
        ) ||
        config.repository.endsWith("/..") ||
        config.repository.endsWith("/.")
      )
        throw new Error("Use a GitHub repository in owner/repository form");
      return { repository: config.repository.toLowerCase() };
    },
    open(_connection, config) {
      const repository = String(config.repository),
        [owner, name] = repository.split("/");
      let state: FeedState = { status: "loading", items: [] };
      const listeners = new Set<() => void>(),
        controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined,
        pending: Promise<void> | undefined,
        failures = 0;
      const publish = (next: FeedState) => {
        state = next;
        for (const listener of listeners) listener();
      };
      const refresh = (): Promise<void> => {
        if (controller.signal.aborted) return Promise.resolve();
        if (pending) return pending;
        clearTimeout(timer);
        pending = (async () => {
          try {
            const response = await gh<{
              repository: {
                pullRequests: {
                  nodes: Pull[];
                  pageInfo: { hasNextPage: boolean };
                };
              } | null;
            }>(query, { owner, name }, controller.signal);
            if (controller.signal.aborted) return;
            if (!response.repository)
              throw new Error(
                "Repository is unavailable to your GitHub account",
              );
            const pulls = response.repository.pullRequests;
            const items: Entity[] = pulls.nodes.map((pr) => ({
              id: pr.id,
              label: pr.title,
              subtitle: `#${pr.number} · ${pr.author?.login ?? "Unknown author"}`,
              status: pr.isDraft ? "Draft" : "Open",
              updatedAt: Date.parse(pr.updatedAt),
              text: `${repository} #${pr.number}\n${pr.title}\nAuthor: ${pr.author?.login ?? "unknown"}\nDraft: ${pr.isDraft}\n${pr.bodyText.slice(0, 3500)}`,
              url: `https://github.com/${repository}/pull/${pr.number}`,
            }));
            failures = 0;
            publish({
              status: "ready",
              items,
              partial: pulls.pageInfo.hasNextPage,
            });
          } catch (error) {
            if (!controller.signal.aborted) {
              failures++;
              publish({
                ...state,
                status: "error",
                error:
                  error instanceof Error
                    ? error.message
                    : "GitHub did not answer",
              });
            }
          } finally {
            pending = undefined;
            if (!controller.signal.aborted) {
              const delay = failures
                ? Math.min(30 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 5))
                : 5 * 60_000;
              timer = setTimeout(
                () => {
                  void refresh();
                },
                delay * (0.9 + Math.random() * 0.2),
              );
            }
          }
        })();
        return pending;
      };
      // Restoring many sections/devices must not synchronize network reads.
      timer = setTimeout(
        () => {
          void refresh();
        },
        1000 + Math.random() * 9000,
      );
      return {
        snapshot: () => state,
        refresh,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        dispose() {
          controller.abort();
          clearTimeout(timer);
          listeners.clear();
        },
      };
    },
  };
}
