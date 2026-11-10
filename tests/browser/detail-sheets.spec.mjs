import { test, expect } from "./fixture.mjs";
import { settleDialogMotion } from "./navigation.mjs";

test.use({
  productionBroker: true,
  soloChannels: ["beta"],
  historyCounts: { alpha: 2, beta: 2 },
});

// Real portals, native editing, history traversal and unchanged background
// geometry cannot be established by the state-owner DOM tests.
test("conversation and profile details expand without resizing the reader or losing drafts", async ({
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
  const readerWidth = (await main.boundingBox()).width;
  const link = app.append(
    "primary",
    "alpha",
    "[Open Beta](buzz://channel/beta)",
  );
  const opener = main
    .locator(`[data-message-id="${link.id}"]`)
    .getByRole("link");
  await opener.click();
  const beta = page.getByRole("dialog", { name: "Beta", exact: true });
  await expect(beta).toBeVisible();
  await expect(beta).toHaveAttribute("data-placement", "bottom");
  expect((await main.boundingBox()).width).toBeCloseTo(readerWidth, 0);
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
  await beta.getByRole("button", { name: "Close", exact: true }).click();
  await expect(beta).toHaveCount(0);
  await expect(alpha).toHaveText("Keep the main draft");
  await opener.click();
  await expect(betaEditor).toHaveText("Keep the detail draft");
  await beta.getByRole("button", { name: "Close", exact: true }).click();
  await expect(beta).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await main
    .getByRole("button", { name: /^View .* profile$/ })
    .first()
    .click();
  const profile = page.getByRole("dialog").filter({
    has: page.getByRole("complementary", { name: "Profile", exact: true }),
  });
  await expect(profile).toBeVisible();
  await expect(profile).toHaveAttribute("data-placement", "rail");
  await expect(profile).toHaveAttribute("aria-modal", "false");
  expect((await main.boundingBox()).width).toBeCloseTo(readerWidth, 0);
  await alpha.fill("Keep typing behind the profile");
  await expect(profile).toBeVisible();
  await settleDialogMotion(profile);
  const workspaceBounds = await page
    .locator("[data-detail-container]")
    .boundingBox();
  expect((await profile.boundingBox()).y - workspaceBounds.y).toBeCloseTo(4, 0);
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
    profile.getByRole("button", { name: "Close", exact: true }),
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
  await expect(profile).toHaveCount(0);
  await page.goForward();
  await expect(profile).toBeVisible();
  await profile.getByRole("button", { name: "Close", exact: true }).click();
  await expect(profile).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await page.goForward();
  await expect(page.locator('[data-channel-timeline="alpha"]')).toBeVisible();
  await expect(profile).toHaveCount(0);
});
