import type { OpenTarget } from "../../features/navigation/targets";
import {
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
const asInbox = (target: OpenTarget | undefined): OpenTarget | undefined =>
  target?.kind === "page" &&
  target.pluginId === messagesTarget.pluginId &&
  target.pageId === messagesTarget.pageId
    ? { ...target, ...inboxTarget }
    : undefined;

export const messagesSheetRoute = {
  target: (params: InboxRoute) => ({
    ...inboxRouteTarget(params),
    ...messagesTarget,
  }),
  filters: (target: OpenTarget | undefined) => routeOf(asInbox(target)),
  detail: (target: OpenTarget | undefined) => detailOf(asInbox(target)),
  composing: (target: OpenTarget | undefined) => composingOf(asInbox(target)),
};
