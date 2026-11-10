import { test, expect } from "./fixture.mjs";
import { generateSecretKey, getPublicKey } from "nostr-tools";

test.use({
  productionBroker: true,
  readState: true,
  inboxDm: true,
  enabledPlugins: ["buzz.bestie"],
  channelIds: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
  historyCounts: { alpha: 4, beta: 3, gamma: 1, delta: 1, epsilon: 1, zeta: 1 },
});

// Browser-only: shell routing, persistent pin wiring, real collection/reader
// geometry, and the narrow rail overlay must work together without losing drafts.
test("the combined rail pins destinations and opens centered Messages", async ({
  page,
  app,
}, testInfo) => {
  const identities = Array.from({ length: 5 }, (_, index) => ({
    pubkey: getPublicKey(generateSecretKey()),
    name: `Agent ${index + 1}`,
  }));
  await page.route("**/agent-library", (route) =>
    route.fulfill({ json: { definitions: [], identities } }),
  );
  await page.goto(app.origin, { waitUntil: "domcontentloaded" });
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  for (const name of ["Pins", "Messages", "Solo", "Agents"])
    await expect(
      rail.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  for (const name of ["Agent 1", "Agent 2", "Agent 3", "Agent 4"])
    await expect(rail.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "Agent 5", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Discover", exact: true }),
  ).toHaveCount(0);
  const community = await page
    .getByRole("button", { name: /^Community switcher:/ })
    .boundingBox();
  const profile = await page
    .getByRole("button", { name: "Your profile", exact: true })
    .boundingBox();
  expect(community.x + community.width).toBeLessThanOrEqual(profile.x);
  expect(community.y).toBeCloseTo(profile.y, 0);

  await rail
    .getByRole("button", { name: "View more messages", exact: true })
    .click();
  const index = page.getByRole("region", { name: "Messages", exact: true });
  await expect(
    index.getByRole("heading", { name: "Messages", level: 2 }),
  ).toBeVisible();
  // Real geometry: view chips share the rows' leading content edge.
  const firstRow = index
    .locator("[data-activity-row] [data-conversation-row]")
    .first();
  await expect(firstRow).toBeVisible();
  const contentLeft = await firstRow.evaluate(
    (element) =>
      element.getBoundingClientRect().left +
      Number.parseFloat(getComputedStyle(element).paddingInlineStart),
  );
  const firstFilter = await index
    .getByRole("tab", { name: "All", exact: true })
    .boundingBox();
  expect(firstFilter.x).toBeCloseTo(contentLeft, 0);
  const beta = index.locator('[data-activity-row="beta"]');
  const recentBeta = rail
    .getByRole("list", { name: "Recent conversations" })
    .getByRole("button", { name: "Beta", exact: true });
  await expect(
    recentBeta.getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  const beforeMark = page.url();
  await beta.hover();
  await beta.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(
    beta.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(beforeMark);
  await expect(
    recentBeta.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  const recentAlpha = rail
    .getByRole("list", { name: "Recent conversations" })
    .getByRole("button", { name: "Alpha", exact: true });
  // Rail destinations open the full conversation for pinning and navigation;
  // collection-row sheet visits are exercised in messages-sheet.spec.mjs.
  await recentAlpha.click();
  const conversation = page.getByRole("article", {
    name: "Conversation",
    exact: true,
  });
  const editor = conversation.getByRole("textbox");
  await editor.fill("Keep this Messages draft");
  await expect(
    recentAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  await expect(
    rail
      .getByRole("list", { name: "Recent conversations" })
      .getByRole("listitem"),
  ).toHaveCount(4);
  await expect(
    rail
      .getByRole("list", { name: "Recent conversations" })
      .getByRole("button", { name: "Alpha", exact: true }),
  ).toHaveCount(1);
  const currentConversation = page.url();
  await rail.getByRole("button", { name: "Add pin", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add a pin", exact: true });
  await picker
    .getByRole("textbox", { name: "Find something to pin" })
    .fill("Alpha");
  await picker.getByRole("button", { name: "Pin Alpha", exact: true }).click();
  const pins = rail
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Pins", exact: true }) });
  await expect(
    pins.getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(currentConversation);
  await expect(editor).toHaveText("Keep this Messages draft");
  const pinnedAlpha = pins.getByRole("button", { name: "Alpha", exact: true });
  await expect(
    pinnedAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "Activity", exact: true }).click();
  await expect.poll(() => app.relay.hasRoute("primary", "alpha")).toBe(true);
  app.append("primary", "alpha", "New sidebar unread message", true, false);
  await expect(
    recentAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  await expect(
    pinnedAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  await pinnedAlpha.hover();
  await expect(
    pinnedAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rail-unread.png") });
  await pinnedAlpha.click();
  await expect(editor).toHaveText("Keep this Messages draft");
  await expect(
    pinnedAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  await expect(
    recentAlpha.getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);

  await rail
    .getByRole("button", { name: "View more messages", exact: true })
    .click();
  await index.getByRole("tab", { name: "Direct", exact: true }).click();
  await expect(
    index.getByRole("heading", { name: "Direct", level: 2 }),
  ).toBeVisible();
  await pins.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect(editor).toHaveText("Keep this Messages draft");
  await page.reload();
  await expect(
    pins.getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveText("Keep this Messages draft");

  await rail.getByRole("button", { name: "Add pin", exact: true }).click();
  await picker
    .getByRole("textbox", { name: "Find something to pin" })
    .fill("Alice Fixture");
  await picker
    .getByRole("button", { name: "Pin person Alice Fixture", exact: true })
    .click();
  await pins
    .getByRole("button", { name: "Alice Fixture", exact: true })
    .click();
  await expect(page).not.toHaveURL(currentConversation);
  await expect(rail.getByRole("alert")).toHaveCount(0);
  await expect(
    conversation.getByRole("textbox", { name: /Message/ }),
  ).toBeVisible();
  await pins.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect(editor).toHaveText("Keep this Messages draft");
  for (const mode of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: mode });
    const railBox = await rail.boundingBox();
    const reader = await conversation.boundingBox();
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(reader.x);
    await expect(editor).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`rail-${mode}.png`) });
  }
  await page.setViewportSize({ width: 900, height: 950 });
  await expect(editor).toBeInViewport();
  await expect(rail).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("rail-medium.png") });
  await rail.getByRole("button", { name: "Bestie", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Choose your bestie agent",
      exact: true,
    }),
  ).toBeVisible();
  await expect(rail).toBeVisible();
  await pins.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect(editor).toHaveText("Keep this Messages draft");

  await page.setViewportSize({ width: 480, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "125%";
  });
  await expect(editor).toBeInViewport();
  await expect(rail).toBeHidden();
  await page
    .getByRole("button", { name: "Show navigation", exact: true })
    .click();
  await expect(
    pins.getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rail-narrow.png") });
  await pins
    .getByRole("button", { name: "Alpha", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "Add pin", exact: true }),
  ).toBeFocused();
  await expect(
    pins.getByRole("button", { name: "Alpha", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(rail).toBeHidden();
  await expect(editor).toBeInViewport();
});

// Host wiring: an agent shortcut must use the shared DM opener, including its
// readiness failure, while View all continues to navigate to the directory.
test("agent rail rows open DMs and keep View all for the directory", async ({
  page,
  app,
}) => {
  const peer = app.histories.get("primary/dm-peer").at(-1).pubkey;
  await page.route("**/agent-library", (route) =>
    route.fulfill({
      json: {
        definitions: [],
        identities: [
          { pubkey: peer, name: "DM agent" },
          {
            pubkey: getPublicKey(generateSecretKey()),
            name: "Unavailable agent",
          },
        ],
      },
    }),
  );
  await page.goto(app.origin, { waitUntil: "domcontentloaded" });
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const agents = rail.locator("section").filter({
    has: page.getByRole("heading", { name: "Agents", exact: true }),
  });
  await expect(
    agents
      .getByRole("button", { name: "DM agent", exact: true })
      .getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  await agents
    .getByRole("button", { name: "Unavailable agent", exact: true })
    .click();
  await expect(rail.getByRole("alert")).toHaveText(
    "This agent is not ready to message in this community.",
  );
  await agents.getByRole("button", { name: "DM agent", exact: true }).click();
  await expect(page).toHaveURL(/dm-peer/);
  await expect(
    page
      .getByRole("article", { name: "Conversation", exact: true })
      .getByRole("textbox"),
  ).toBeVisible();
  await expect(
    agents.getByRole("button", { name: "DM agent", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    agents
      .getByRole("button", { name: "DM agent", exact: true })
      .getByRole("img", { name: "Unread", exact: true }),
  ).toHaveCount(0);
  await expect(rail.getByRole("alert")).toHaveCount(0);
  await rail
    .getByRole("button", { name: "View more agents", exact: true })
    .click();
  await expect(page).toHaveURL(/buzz.agents/);
  await page.goBack();
  await expect(page).toHaveURL(/dm-peer/);
});

// Browser-only: pointer collision geometry, the animated footer drop target,
// context-menu handoff, and remounted shell rows cannot be proved in jsdom.
test("rail sections and rows can be arranged and a drop creates a named section", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin, { waitUntil: "domcontentloaded" });
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const messages = rail.locator('[data-rail-section="messages"]');
  const agents = rail.locator('[data-rail-section="agents"]');
  const beta = messages.getByRole("button", { name: "Beta", exact: true });
  await expect(beta).toBeVisible();
  const primary = rail.locator("section").filter({
    has: page.getByRole("button", { name: "Activity", exact: true }),
  });
  await expect(
    primary.getByRole("button", { name: "View all plugins", exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
  await expect(beta.getByRole("img", { name: "Unread" })).toBeVisible();
  const startDrag = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 9, {
      steps: 3,
    });
  };
  const dropOn = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
  };
  const order = () =>
    rail
      .locator("[data-rail-section]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.railSection));
  const navigation = rail.locator('[data-rail-section="navigation"]');
  const pins = rail.locator('[data-rail-section="pins"]');
  await startDrag(pins.getByRole("heading", { name: "Pins", exact: true }));
  await dropOn(
    navigation.getByRole("heading", { name: "Plugins", exact: true }),
  );
  await expect
    .poll(order)
    .toEqual(["pins", "navigation", "messages", "solo", "agents"]);
  await page.reload();
  await expect
    .poll(order)
    .toEqual(["pins", "navigation", "messages", "solo", "agents"]);
  await startDrag(agents.getByRole("heading", { name: "Agents", exact: true }));
  await dropOn(
    messages.getByRole("heading", { name: "Messages", exact: true }),
  );
  await expect
    .poll(order)
    .toEqual(["pins", "navigation", "agents", "messages", "solo"]);

  await startDrag(beta);
  const newSection = rail.getByRole("region", {
    name: "New section",
    exact: true,
  });
  await expect(newSection).toBeInViewport();
  await expect(newSection).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("rail-dragging.png") });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(newSection).toBeHidden();
  await expect(beta).toBeVisible();

  await startDrag(beta);
  await dropOn(agents.getByRole("heading", { name: "Agents", exact: true }));
  const movedBeta = agents.getByRole("button", { name: "Beta", exact: true });
  await expect(movedBeta).toBeVisible();
  await expect(beta).toHaveCount(0);
  await expect(movedBeta.getByRole("img", { name: "Unread" })).toBeVisible();

  await startDrag(movedBeta);
  await expect(newSection).toHaveCSS("opacity", "1");
  await dropOn(newSection);
  const dialog = page.getByRole("dialog", {
    name: "Move to new section",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(movedBeta).toBeVisible();

  await startDrag(movedBeta);
  await expect(newSection).toHaveCSS("opacity", "1");
  await dropOn(newSection);
  await dialog
    .getByRole("textbox", { name: "Section name" })
    .fill("Project chats");
  await dialog
    .getByRole("button", { name: "Create and move", exact: true })
    .click();
  const custom = rail.locator("[data-rail-section]").filter({
    has: page.getByRole("heading", { name: "Project chats", exact: true }),
  });
  await expect(
    custom.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(movedBeta).toHaveCount(0);
  await navigation
    .getByRole("button", { name: "Activity", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Project chats", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", { name: "Activity", exact: true }),
  ).toHaveCount(0);
  await custom
    .getByRole("button", { name: "Activity", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
  await expect(
    navigation.getByRole("button", { name: "Activity", exact: true }),
  ).toBeVisible();
  await expect
    .poll(order)
    .toEqual([
      "pins",
      "navigation",
      "agents",
      "messages",
      "solo",
      await custom.getAttribute("data-rail-section"),
    ]);
  await expect(
    navigation
      .locator("[data-rail-row]")
      .last()
      .getByRole("button", { name: "View all plugins", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rail-arranged.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await page.screenshot({
    path: testInfo.outputPath("rail-arranged-dark.png"),
  });
  await page.setViewportSize({ width: 480, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "125%";
  });
  await page
    .getByRole("button", { name: "Show navigation", exact: true })
    .click();
  await expect(
    custom.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  const scroller = rail.locator('[data-scroll-fade="scrolled"]');
  await expect(scroller).toHaveAttribute("data-overflow-end", "");
  await scroller.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  });
  await expect(scroller).toHaveAttribute("data-overflow-start", "");
  await expect(scroller).toHaveAttribute("data-overflow-end", "");
  await page.screenshot({
    path: testInfo.outputPath("rail-arranged-narrow.png"),
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });

  await page.reload();
  await expect(
    custom.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await custom
    .getByRole("button", { name: "Beta", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Messages", exact: true }).click();
  await messages.getByRole("button", { name: /^View more Messages$/i }).click();
  const messagesPage = page.getByRole("region", {
    name: "Messages",
    exact: true,
  });
  await expect(
    messagesPage.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(messages.locator("[data-rail-row]")).toHaveCount(4);
  await page.goBack();
  await expect(
    custom.getByRole("button", { name: "Beta", exact: true }),
  ).toHaveCount(0);
  await custom
    .getByRole("button", { name: "Arrange Project chats", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Remove section", exact: true })
    .click();
  await expect(custom).toHaveCount(0);

  await agents
    .getByRole("button", { name: "Arrange Agents", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("menuitem", { name: "Move section down", exact: true })
    .click();
  await expect
    .poll(order)
    .toEqual(["pins", "navigation", "messages", "agents", "solo"]);
  await messages.getByRole("button", { name: /^View more Messages$/i }).click();
  const fullBeta = messagesPage.getByRole("button", {
    name: "Beta",
    exact: true,
  });
  await fullBeta.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "New section…", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await fullBeta.click();
  await expect(
    page
      .getByRole("article", { name: "Conversation", exact: true })
      .getByRole("textbox"),
  ).toBeVisible();
  await messages.getByRole("button", { name: /^View more Messages$/i }).click();
  await expect(fullBeta.getByRole("img", { name: "Unread" })).toHaveCount(0);
  await fullBeta.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  const pinnedBeta = pins.getByRole("button", { name: "Beta", exact: true });
  await pinnedBeta.hover();
  await expect(
    rail.getByRole("button", { name: /^(?:Pin|Unpin) Beta$/ }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("rail-row-actions.png") });
  await pinnedBeta.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect(pinnedBeta).toHaveCount(0);
  await expect(beta).toBeVisible();
  await beta.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(pinnedBeta).toBeVisible();
  await rail
    .getByRole("button", { name: "View more agents", exact: true })
    .click();
  const agentPage = page.getByRole("region", { name: "Agents", exact: true });
  await expect(
    agentPage.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("page-header-agents.png"),
  });
  await primary
    .getByRole("button", { name: "Smart sections", exact: true })
    .click();
  const pluginPage = page.getByRole("region", {
    name: "Smart sections",
    exact: true,
  });
  await expect(
    pluginPage.getByRole("heading", { name: "Smart sections", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("page-header-plugin.png"),
  });
  const createSection = rail.getByRole("button", {
    name: "New section",
    exact: true,
  });
  await createSection.click();
  const emptySectionDialog = page.getByRole("dialog", {
    name: "Create new section",
    exact: true,
  });
  await expect(
    emptySectionDialog.getByRole("textbox", { name: "Section name" }),
  ).toBeFocused();
  await expect(
    emptySectionDialog.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();
  await emptySectionDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(createSection).toBeFocused();
  await createSection.click();
  await emptySectionDialog
    .getByRole("textbox", { name: "Section name" })
    .fill("Saved for later");
  await emptySectionDialog
    .getByRole("button", { name: "Create", exact: true })
    .click();
  const emptySection = rail.locator("[data-rail-section]").filter({
    has: page.getByRole("heading", { name: "Saved for later", exact: true }),
  });
  await expect(emptySection).toBeVisible();
  await expect(emptySection.locator("[data-rail-row]")).toHaveCount(0);
  await expect(createSection).toBeFocused();
  await page.reload();
  await expect(emptySection).toBeVisible();
  await createSection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("rail-new-section.png") });
});

// Browser-only: align actual chip hit targets with row content, and retain the
// same view strip through overflow, themes and enlarged text in both hosts.
test.describe("Solo rail", () => {
  test.use({
    soloChannels: ["alpha"],
    ownSoloChannels: ["alpha"],
    historyCounts: { alpha: 0, beta: 1 },
  });
  // Host wiring: a Solo with no received messages must be reachable, then stay
  // out of Messages as replies arrive and open through the existing chat host.
  test("Solo chats have their own card and New chat entry point", async ({
    page,
    app,
  }, testInfo) => {
    await page.goto(app.origin);
    const rail = page.getByRole("navigation", { name: "Apps", exact: true });
    const solo = rail.locator('[data-rail-section="solo"]');
    const messages = rail.locator('[data-rail-section="messages"]');
    const alpha = solo.getByRole("button", { name: "Alpha", exact: true });
    await expect(alpha).toBeVisible();
    await solo
      .getByRole("button", { name: "New Solo chat", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "New chat", exact: true }),
    ).toBeVisible();
    await alpha.click();
    await expect(
      page.getByRole("region", {
        name: "Channel message history",
        exact: true,
      }),
    ).toBeVisible();
    app.append("primary", "alpha", "Solo agent reply", true, false);
    await expect(
      page.getByText("Solo agent reply", { exact: true }),
    ).toBeVisible();
    await expect(
      messages.getByRole("button", { name: "Alpha", exact: true }),
    ).toHaveCount(0);
    await expect(
      messages.getByRole("button", { name: "Beta", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(alpha).toBeVisible();
    await expect(
      messages.getByRole("button", { name: "Alpha", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("solo-card.png") });
  });
});

test.describe("Sidebar row limits", () => {
  const chats = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
  test.use({ soloChannels: chats, ownSoloChannels: chats });
  test("Solo opens a full list with history while Pins stays uncapped", async ({
    page,
    app,
  }, testInfo) => {
    await page.goto(app.origin);
    const rail = page.getByRole("navigation", { name: "Apps", exact: true });
    const solo = rail.locator('[data-rail-section="solo"]');
    await expect(solo.locator("[data-rail-row]")).toHaveCount(4);
    const more = solo.getByRole("button", {
      name: "View more Solo",
      exact: true,
    });
    await more.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("region", { name: "Solo", exact: true });
    await expect(list.locator("[data-rail-row]")).toHaveCount(6);
    await expect(solo.locator("[data-rail-row]")).toHaveCount(4);
    await expect(rail.getByRole("button", { name: /^View less/ })).toHaveCount(
      0,
    );
    await list.getByRole("button", { name: "Alpha", exact: true }).click();
    await expect(
      page.getByRole("region", {
        name: "Channel message history",
        exact: true,
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(list.locator("[data-rail-row]")).toHaveCount(6);
    await page.reload();
    await expect(list.locator("[data-rail-row]")).toHaveCount(6);
    await page.goBack();
    await expect(
      page.getByRole("region", { name: "Activity", exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(list.locator("[data-rail-row]")).toHaveCount(6);
    for (const row of await list.locator("[data-rail-row]").all()) {
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    }
    const pins = rail.locator('[data-rail-section="pins"]');
    await expect(pins.locator("[data-rail-row]")).toHaveCount(6);
    await expect(pins.getByRole("button", { name: /^View more/ })).toHaveCount(
      0,
    );
    const pinRows = pins.locator("[data-rail-row]");
    // Real layout: avatar destinations wrap after four and stay inside the card.
    const pinButtons = pinRows.getByRole("button");
    await expect(pinButtons).toHaveCount(6);
    await expect
      .poll(() =>
        pinButtons.evaluateAll((buttons) => {
          const rows = new Map();
          for (const button of buttons) {
            const rect = button.getBoundingClientRect();
            const top = Math.round(rect.top);
            rows.set(top, (rows.get(top) ?? 0) + 1);
          }
          return Math.max(...rows.values());
        }),
      )
      .toBe(4);
    const card = await pins.boundingBox();
    for (const button of await pinButtons.all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeCloseTo(box.height, 0);
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    }
    await pinButtons.first().hover();
    await expect(page.getByRole("tooltip")).toHaveText("Alpha");
    await page.screenshot({ path: testInfo.outputPath("pins-grid-light.png") });
    await page.keyboard.press("Escape");
    await pinButtons.first().focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("tooltip", { name: "Beta", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 480, height: 900 });
    await page
      .getByRole("button", { name: "Show navigation", exact: true })
      .click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "125%";
    });
    await expect
      .poll(() => pins.evaluate((card) => card.scrollWidth <= card.clientWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("pins-grid-narrow-dark.png"),
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1440, height: 950 });
    await pinRows.first().click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "New section…", exact: true })
      .click();
    const naming = page.getByRole("dialog", {
      name: "Move to new section",
      exact: true,
    });
    await naming
      .getByRole("textbox", { name: "Section name" })
      .fill("Saved chats");
    await naming
      .getByRole("button", { name: "Create and move", exact: true })
      .click();
    while (await pinRows.count()) {
      await pinRows.first().click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "Saved chats", exact: true })
        .click();
    }
    const customCard = rail.locator("[data-rail-section]").filter({
      has: page.getByRole("heading", { name: "Saved chats", exact: true }),
    });
    await expect(customCard.locator("[data-rail-row]")).toHaveCount(4);
    await customCard
      .getByRole("button", { name: "View more Saved chats", exact: true })
      .click();
    const customPage = page.getByRole("region", {
      name: "Saved chats",
      exact: true,
    });
    await expect(customPage.locator("[data-rail-row]")).toHaveCount(6);
    await page.reload();
    await expect(customPage.locator("[data-rail-row]")).toHaveCount(6);
    await expect(customCard.locator("[data-rail-row]")).toHaveCount(4);
    await page.screenshot({
      path: testInfo.outputPath("sidebar-four-row-limit.png"),
    });
  });
});

test("Messages and Activity expose aligned view filters", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  const checkAlignment = async (view) => {
    const row = view.locator("[data-conversation-row]").first();
    await expect(row).toBeVisible();
    const contentLeft = await row.evaluate(
      (element) =>
        element.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(element).paddingInlineStart),
    );
    const filter = await view
      .getByRole("tab", { name: "All", exact: true })
      .boundingBox();
    expect(filter.x).toBeCloseTo(contentLeft, 0);
  };
  const activityViews = activity.getByRole("tablist", {
    name: "Activity views",
    exact: true,
  });
  await checkAlignment(activity);
  for (const name of ["Channels", "Direct", "Working", "Waiting", "All"]) {
    const choice = activityViews.getByRole("tab", { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-selected", "true");
  }
  await checkAlignment(activity);
  await activityViews.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: testInfo.outputPath("activity-visible-filters.png"),
  });
  await rail
    .getByRole("button", { name: "View more messages", exact: true })
    .click();
  const messages = page.getByRole("region", { name: "Messages", exact: true });
  for (const [width, theme] of [
    [1440, "light"],
    [760, "dark"],
    [480, "light"],
  ]) {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme });
    await checkAlignment(messages);
    await page.screenshot({
      path: testInfo.outputPath(`message-filters-${width}-${theme}.png`),
    });
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
  await checkAlignment(messages);
  await page.screenshot({
    path: testInfo.outputPath("message-filters-enlarged.png"),
  });
});
