import type { JsonValue, OpenTarget } from "../../features/navigation/targets";
import {
  isInboxRoute,
  composingOf,
  detailOf,
  inboxRouteTarget,
  inboxTarget,
  routeOf,
  type InboxRoute,
} from "../inbox/route";

const messagesTarget = {
  version: 1,
  kind: "page",
  pluginId: "buzz.channels",
  pageId: "channels",
} as const;
function withoutCollection(params: JsonValue | undefined) {
  if (!params || typeof params !== "object" || Array.isArray(params))
    return params;
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== "collection"),
  );
}
export function isMessagesRoute(params: JsonValue) {
  if (
    params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    "collection" in params &&
    params.collection !== "solo"
  )
    return false;
  const route = withoutCollection(params);
  return route !== undefined && isInboxRoute(route);
}
export function messageCollectionOf(target: OpenTarget | undefined) {
  const params =
    target?.kind === "page" &&
    target.pluginId === messagesTarget.pluginId &&
    target.pageId === messagesTarget.pageId
      ? target.route?.params
      : undefined;
  return params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    "collection" in params &&
    params.collection === "solo"
    ? "solo"
    : undefined;
}
const asInbox = (target: OpenTarget | undefined): OpenTarget | undefined => {
  if (
    target?.kind !== "page" ||
    target.pluginId !== messagesTarget.pluginId ||
    target.pageId !== messagesTarget.pageId
  )
    return;
  return {
    ...target,
    ...inboxTarget,
    ...(target.route && {
      route: {
        ...target.route,
        params: withoutCollection(target.route.params) ?? {},
      },
    }),
  };
};

export const messagesSheetRoute = {
  target: (params: InboxRoute) => ({
    ...inboxRouteTarget(params),
    ...messagesTarget,
  }),
  filters: (target: OpenTarget | undefined) => routeOf(asInbox(target)),
  detail: (target: OpenTarget | undefined) => detailOf(asInbox(target)),
  composing: (target: OpenTarget | undefined) => composingOf(asInbox(target)),
};

/** Draft and selection visits retain the Solo collection across reload/traversal. */
export const soloMessagesSheetRoute = {
  ...messagesSheetRoute,
  target: (params: InboxRoute) => ({
    ...messagesSheetRoute.target(params),
    route: { version: 1 as const, params: { ...params, collection: "solo" } },
  }),
};
