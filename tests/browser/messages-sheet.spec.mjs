import { test, expect } from "./fixture.mjs";
test.use({
  productionBroker: true,
  readState: true,
  inboxDm: true,
  historyCounts: { alpha: 3, beta: 2 },
});
// Browser contract: the Messages route retains its collection while the shared
// composer sheet owns focus, responsive geometry, and Back/Forward/Close visits.
test("Messages expands from its compact composer and restores visits", async ({
  page,
  app,
}, testInfo) => {
  app.append("primary", "dm-peer", "[Open Beta](buzz://channel/beta)", false);
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  const activityComposer = activity.locator("[data-composer-surface]");
  await expect(activityComposer).toBeVisible();
  await expect(activity.getByRole("textbox")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  const activityWidth = (await activityComposer.boundingBox()).width;
  await rail
    .getByRole("button", { name: "View more messages", exact: true })
    .click();
  const index = page.getByRole("region", { name: "Messages", exact: true });
  await expect(index.locator("[data-composer-surface]")).toBeVisible();
  await expect(index.getByRole("textbox")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  expect(
    (await index.locator("[data-composer-surface]").last().boundingBox()).width,
  ).toBeCloseTo(activityWidth, 0);

  await index
    .locator('[data-activity-row="alpha"]')
    .getByRole("button", { name: /Alpha/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Alpha", exact: true });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("heading", { name: "Alpha", exact: true }),
  ).toBeVisible();
  // The dialog makes the covered list inert; inspect its retained selection
  // without asking the accessibility tree to expose that background region.
  const selectedRow = page.locator(
    'section[aria-label="Messages"] [data-activity-row="alpha"] [data-conversation-row]',
  );
  await expect(selectedRow).toHaveAttribute("aria-current", "page");
  let sheetHistoryWidth;
  for (const [width, theme] of [
    [1440, "light"],
    [480, "dark"],
  ]) {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme });
    await expect(sheet.getByRole("textbox")).toBeInViewport();
    const box = await sheet.boundingBox();
    if (width === 1440) {
      expect(
        (await sheet.locator("[data-composer-surface]").boundingBox()).width,
      ).toBeCloseTo(activityWidth, 0);
      sheetHistoryWidth = (
        await sheet
          .locator('[data-channel-timeline="alpha"] > ol')
          .boundingBox()
      ).width;
    }
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`messages-sheet-${width}.png`),
    });
  }
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(selectedRow).not.toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(sheet).toBeVisible();
  await expect(selectedRow).toHaveAttribute("aria-current", "page");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(index.locator("[data-composer-surface]")).toBeVisible();
  await page.reload();
  await expect(sheet).toHaveCount(0);
  await expect(index.locator("[data-composer-surface]")).toBeVisible();
  await index.getByRole("textbox").fill("@Alice");
  await page.getByRole("option", { name: /Alice Fixture/ }).click();
  const draft = page.getByRole("dialog", { name: "New message", exact: true });
  await expect(draft).toBeVisible();
  await expect(
    draft.getByText("Inbox DM fixture reply", { exact: true }),
  ).toBeVisible();
  await draft.getByRole("link", { name: "Open Beta", exact: true }).click();
  await expect(page.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await page.goBack();
  await expect(draft).toHaveCount(0);

  // A direct Messages conversation is the reference for every composing host.
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.emulateMedia({ colorScheme: "light" });
  await rail.getByRole("button", { name: "Alpha", exact: true }).click();
  const conversation = page.getByRole("article", {
    name: "Conversation",
    exact: true,
  });
  const referenceComposer = conversation.locator("[data-composer-surface]");
  await expect(referenceComposer).toBeVisible();
  expect((await referenceComposer.boundingBox()).width).toBeCloseTo(
    activityWidth,
    0,
  );
  expect(
    (
      await conversation
        .locator('[data-channel-timeline="alpha"] > ol')
        .boundingBox()
    ).width,
  ).toBeCloseTo(sheetHistoryWidth, 0);
  await rail.getByRole("button", { name: "New", exact: true }).click();
  const newMessage = page.getByRole("region", {
    name: "New message",
    exact: true,
  });
  const newComposer = newMessage.locator("[data-composer-surface]");
  await expect(newComposer).toBeVisible();
  const composerBounds = await newComposer.boundingBox();
  const recipientBounds = await newMessage
    .getByRole("group", { name: "Recipients", exact: true })
    .boundingBox();
  expect(composerBounds.width).toBeCloseTo(activityWidth, 0);
  expect(recipientBounds.x).toBeCloseTo(composerBounds.x, 0);
  expect(recipientBounds.width).toBeCloseTo(composerBounds.width, 0);
  await page.screenshot({
    path: testInfo.outputPath("new-message-shared-width.png"),
  });
});
