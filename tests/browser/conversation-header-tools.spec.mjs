import { test, expect } from "./fixture.mjs";
test.use({
  productionBroker: true,
  readState: true,
  enabledPlugins: ["buzz.todos"],
  historyCounts: { alpha: 3 },
});
// Browser-only: header placement, nested portalled menu focus, and stable history geometry.
test("conversation header opens its tools without moving history", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  await page
    .getByRole("navigation", { name: "Apps", exact: true })
    .getByRole("button", { name: "Alpha", exact: true })
    .first()
    .click();
  const pane = page.getByRole("article", { name: "Conversation", exact: true });
  const identity = pane.getByRole("button", {
    name: "Manage members of Alpha",
    exact: true,
  });
  const trigger = pane.getByRole("button", {
    name: "Conversation actions",
    exact: true,
  });
  const actions = page.getByRole("button", {
    name: "Channel actions",
    exact: true,
  });
  await expect(identity).toBeVisible();
  const title = pane.getByRole("heading", {
    name: "Alpha",
    level: 2,
    exact: true,
  });
  await expect(title).toBeVisible();
  await expect(trigger).toBeVisible();
  await identity.hover();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  const history = pane.locator("[data-channel-timeline]");
  const before = await history.boundingBox();
  const identityBox = await identity.boundingBox();
  const titleBox = await title.boundingBox();
  expect(identityBox.x + identityBox.width).toBeLessThan(titleBox.x);
  expect(identityBox.y + identityBox.height / 2).toBeCloseTo(
    titleBox.y + titleBox.height / 2,
    0,
  );
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox.x).toBeGreaterThan(identityBox.x + identityBox.width);
  await trigger.click();
  await expect(actions).toBeVisible();
  expect((await history.boundingBox()).y).toBe(before.y);
  await page.screenshot({ path: testInfo.outputPath("header-tools.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: testInfo.outputPath("header-tools-dark.png") });
  await actions.click();
  await expect(page.getByRole("menu").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(actions).toBeVisible();
  await page.setViewportSize({ width: 480, height: 950 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(actions).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("header-tools-narrow.png"),
  });
});
