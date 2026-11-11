import { test, expect } from "./fixture.mjs";
import { animationsSettled } from "./animations.mjs";

test.use({
  productionBroker: true,
  soloChannels: ["beta"],
  historyCounts: { alpha: 2, beta: 2 },
});

// Real portals, native editing, history traversal and unchanged background
// geometry cannot be established by the state-owner DOM tests.
test("conversation and profile details share the full workspace without losing drafts", async ({
  page,
  app,
}, testInfo) => {
  const conversationUrl = (channelId) =>
    `${app.origin}/#buzz=${encodeURIComponent(
      JSON.stringify({
        version: 1,
        kind: "conversation",
        channelId,
        scope: {
          viewer: app.viewer,
          communityOrigin: "https://primary.example",
        },
      }),
    )}`;
  // Give Close a meaningful previous visit; traversing beyond the first app
  // entry would leave the document rather than exercise detail dismissal.
  await page.goto(conversationUrl("beta"));
  await expect(page.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await page.goto(conversationUrl("alpha"));
  const main = page.locator("[data-main-workspace]");
  const alpha = main.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await alpha.fill("Keep the main draft");
  const dock = page.locator("[data-channel-workspace] > [data-panel-dock]");
  const link = app.append(
    "primary",
    "alpha",
    "[Open Beta](buzz://channel/beta)",
  );
  const opener = main
    .locator(`[data-message-id="${link.id}"]`)
    .getByRole("link");
  await opener.click();
  const beta = dock;
  await expect(beta).toBeVisible();
  await animationsSettled(page.locator("body"), { subtree: true });
  const mainBox = await main.boundingBox();
  const sideBox = await dock.boundingBox();
  expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(sideBox.x + 1);
  expect(sideBox.height).toBeCloseTo(mainBox.height, 0);
  const mainAction = await main
    .getByRole("button", { name: "Conversation actions", exact: true })
    .boundingBox();
  const sideAction = await dock
    .getByRole("button", { name: "Toggle tab pane", exact: true })
    .boundingBox();
  const selectedTab = await dock
    .getByRole("tab", { name: "Beta", exact: true })
    .boundingBox();
  expect(mainAction.y + mainAction.height / 2).toBeCloseTo(
    sideAction.y + sideAction.height / 2,
    0,
  );
  expect(selectedTab.y + selectedTab.height / 2).toBeCloseTo(
    sideAction.y + sideAction.height / 2,
    0,
  );

  const betaEditor = beta.getByRole("textbox", { name: /^Message/ });
  await betaEditor.fill("Keep the detail draft");
  await page.screenshot({
    path: testInfo.outputPath("conversation-sheet-wide.png"),
  });
  await page.setViewportSize({ width: 480, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });
  await expect(betaEditor).toBeInViewport();
  const bounds = await beta.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(480);
  await page.screenshot({
    path: testInfo.outputPath("conversation-sheet-narrow.png"),
  });
  await beta
    .getByRole("button", { name: "Close Beta tab", exact: true })
    .click();
  await expect(beta).toBeHidden();
  await expect(alpha).toHaveText("Keep the main draft");
  await opener.click();
  await expect(betaEditor).toHaveText("Keep the detail draft");
  await beta
    .getByRole("button", { name: "Close Beta tab", exact: true })
    .click();
  await expect(beta).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await main
    .getByRole("button", { name: /^View .* profile$/ })
    .first()
    .click();
  const profile = dock;
  await expect(profile).toBeVisible();
  await animationsSettled(page.locator("body"), { subtree: true });
  const splitMain = await main.boundingBox();
  const splitDetail = await profile.boundingBox();
  expect(splitMain.x + splitMain.width).toBeLessThanOrEqual(splitDetail.x + 1);
  expect(splitDetail.height).toBeCloseTo(splitMain.height, 0);
  await alpha.fill("Keep typing behind the profile");
  await expect(profile).toBeVisible();
  await animationsSettled(page.locator("body"), { subtree: true });
  const workspaceBounds = await page
    .locator("[data-detail-container]")
    .boundingBox();
  expect((await profile.boundingBox()).height).toBeGreaterThan(
    workspaceBounds.height * 0.9,
  );
  await page.screenshot({ path: testInfo.outputPath("profile-rail-wide.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 480, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });
  const cardBounds = await profile.boundingBox();
  expect(cardBounds.x).toBeGreaterThanOrEqual(0);
  expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(480);
  await expect(
    profile.getByRole("button", { name: /^Close .* tab$/ }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("profile-rail-narrow.png"),
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await expect(
    profile.getByRole("complementary", { name: "Profile", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(profile).toBeHidden();
  await page.goForward();
  await expect(profile).toBeVisible();
  await profile.getByRole("button", { name: /^Close .* tab$/ }).click();
  await expect(profile).toBeHidden();
  await page.goBack();
  await expect(page.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await page.goForward();
  await expect(page.locator('[data-channel-timeline="alpha"]')).toBeVisible();
  await expect(profile).toBeHidden();
});

test.describe("collection details", () => {
  test.use({ readState: true, threadUnread: true, threadUnreadMentions: true });

  // A real portal and editor must survive promotion, resizing and dismissal;
  // DOM-only tests cannot establish the split's hit testing or viewport bounds.
  test("Activity keeps its list beside a thread and its tools without losing the draft", async ({
    page,
    app,
  }, testInfo) => {
    await page.goto(
      `${app.origin}/#buzz=${encodeURIComponent(
        JSON.stringify({
          version: 1,
          kind: "conversation",
          channelId: "beta",
          scope: {
            viewer: app.viewer,
            communityOrigin: "https://primary.example",
          },
        }),
      )}`,
    );
    await expect(page.locator('[data-channel-timeline="beta"]')).toBeVisible();
    await page
      .getByRole("navigation", { name: "Apps", exact: true })
      .getByRole("button", { name: "Activity", exact: true })
      .click();
    const activity = page.getByRole("region", {
      name: "Activity",
      exact: true,
    });
    await activity
      .getByRole("listitem")
      .filter({ hasText: "Unread reply 1" })
      .getByRole("button", { name: /^Open / })
      .click();
    const sheet = activity.getByRole("region", {
      name: "Conversation detail",
      exact: true,
    });
    const reply = sheet.getByRole("textbox", {
      name: "Reply to thread",
      exact: true,
    });
    await reply.fill("Keep this thread draft");
    const editor = await reply.elementHandle();
    await sheet
      .getByRole("button", { name: /^View .* profile$/ })
      .first()
      .click();
    const profile = sheet.getByRole("complementary", {
      name: "Profile",
      exact: true,
    });
    await expect(profile).toBeVisible();
    await expect(profile).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(profile).toHaveCount(0);
    await expect(reply).toBeVisible();
    await expect(reply).toHaveText("Keep this thread draft");
    await sheet
      .getByRole("button", { name: /^View .* profile$/ })
      .first()
      .click();
    await expect(profile).toBeFocused();
    await expect(
      activity.getByRole("list", { name: "Activity", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Alpha", exact: true }),
    ).toHaveCount(0);
    await animationsSettled(page.locator("body"), { subtree: true });
    const detail = sheet.locator("[data-panel-dock]");
    const detailBox = await detail.boundingBox();
    const composerBox = await reply.boundingBox();
    const identityBox = await sheet
      .getByRole("button", { name: "Manage members of Alpha", exact: true })
      .boundingBox();
    const titleBox = await sheet
      .getByRole("heading", { name: "Alpha", exact: true })
      .boundingBox();
    const conversationPane = await sheet
      .locator('.panel-header[data-variant="conversation"]')
      .boundingBox();
    const conversationCenter = conversationPane.x + conversationPane.width / 2;
    expect(identityBox.x + identityBox.width / 2).toBeCloseTo(
      conversationCenter,
      0,
    );
    expect(titleBox.x + titleBox.width / 2).toBeCloseTo(conversationCenter, 0);
    expect(titleBox.y).toBeGreaterThanOrEqual(
      identityBox.y + identityBox.height,
    );

    expect(detailBox.height).toBeGreaterThan(700);
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(
      detailBox.x + 1,
    );
    expect(
      await reply.evaluate((element, previous) => element === previous, editor),
    ).toBe(true);
    await reply.fill("Still typing beside the profile");
    await expect(profile).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("thread-detail-split-wide.png"),
    });
    await page.setViewportSize({ width: 480, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    await expect(
      profile.getByRole("button", { name: "Close Profile panel", exact: true }),
    ).toBeInViewport();
    const narrow = await detail.boundingBox();

    expect(narrow.x).toBeGreaterThanOrEqual(0);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(480);
    await page.screenshot({
      path: testInfo.outputPath("thread-detail-split-narrow.png"),
    });
    await profile
      .getByRole("button", { name: "Close Profile panel", exact: true })
      .click();
    await expect(profile).toHaveCount(0);
    await expect(reply).toHaveText("Still typing beside the profile");
    expect(
      await reply.evaluate((element, previous) => element === previous, editor),
    ).toBe(true);
    await sheet
      .getByRole("button", { name: "Close conversation", exact: true })
      .click();
    await expect(sheet).toBeHidden();
    await page.goBack();
    await expect(reply).toBeHidden();
    await page.goForward();
    await expect(reply).toBeHidden();
  });
});
