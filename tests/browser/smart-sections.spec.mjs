import { test, expect } from "./fixture.mjs";

test.use({ productionBroker: true, enabledPlugins: ["buzz.smart-sections"] });

// Browser-only contract: real shell/registry wiring, dialog hit testing at narrow
// widths, and retained routing/storage after a reload. Membership is tested at
// its runtime/source owners, not replayed as a browser matrix.
test("creates, renames, collapses and restores a native smart section", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  await rail
    .getByRole("button", { name: "Smart sections", exact: true })
    .click();
  const view = page.getByRole("region", {
    name: "Smart sections",
    exact: true,
  });
  await expect(view).toBeVisible();
  await view
    .getByRole("button", { name: "New smart section", exact: true })
    .click();
  const describe = page.getByRole("dialog", {
    name: "Create a smart section",
    exact: true,
  });
  await expect(
    describe.getByRole("textbox", { name: "What would you like to see?" }),
  ).toBeVisible();
  await describe
    .getByRole("button", {
      name: "Track all my active agents",
      exact: true,
    })
    .click();
  await expect(
    describe.getByRole("textbox", { name: "What would you like to see?" }),
  ).toHaveValue("Track all my active agents");
  await expect(describe).toHaveCSS("opacity", "1");
  await describe.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: testInfo.outputPath("smart-sections-describe.png"),
  });
  await describe
    .getByRole("button", { name: "Configure manually", exact: true })
    .click();
  let editor = page.getByRole("dialog", {
    name: "New smart section",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("My live agents");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("confirmed matches");
  await editor
    .getByRole("button", { name: "Save section", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    rail.getByRole("heading", { name: "My live agents", exact: true }),
  ).toBeVisible();
  const section = rail.locator("section").filter({
    has: page.getByRole("heading", { name: "My live agents", exact: true }),
  });
  await section
    .getByRole("button", { name: "Collapse My live agents", exact: true })
    .click();
  await expect(section.getByRole("button", { name: /^View more/ })).toHaveCount(
    0,
  );
  await section
    .getByRole("button", { name: "Expand My live agents", exact: true })
    .click();
  await section.getByRole("button", { name: /^View more/ }).click();
  const detail = page.getByRole("region", {
    name: "Smart sections",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "Edit section", exact: true })
    .click();
  editor = page.getByRole("dialog", {
    name: "Edit smart section",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Agent watch");
  await editor
    .getByRole("button", { name: "Save section", exact: true })
    .click();
  await expect(
    rail.getByRole("heading", { name: "Agent watch", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    rail.getByRole("heading", { name: "Agent watch", exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((mode) => {
      localStorage.setItem("buzz-appearance.v1", mode);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "buzz-appearance.v1",
          storageArea: localStorage,
        }),
      );
    }, theme);
    await expect(page.locator("html")).toHaveAttribute(
      "data-color-mode",
      theme,
    );
    await page.screenshot({
      path: testInfo.outputPath(`smart-sections-${theme}.png`),
    });
  }
  await page.setViewportSize({ width: 760, height: 800 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
  await page
    .getByRole("region", { name: "Smart sections", exact: true })
    .getByRole("button", { name: "Edit section", exact: true })
    .click();
  editor = page.getByRole("dialog", {
    name: "Edit smart section",
    exact: true,
  });
  const save = editor.getByRole("button", {
    name: "Save section",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await expect(editor).toHaveCSS("opacity", "1");
  await editor.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: testInfo.outputPath("smart-sections-editor-narrow.png"),
  });
  await save.click();
  await expect(editor).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("smart-sections-narrow.png"),
  });
  const edit = page
    .getByRole("region", { name: "Smart sections", exact: true })
    .getByRole("button", { name: "Edit section", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Edit smart section", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Edit smart section", exact: true }),
  ).toHaveCount(0);
  await expect(edit).toBeFocused();
});
