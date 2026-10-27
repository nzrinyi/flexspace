import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find a car you both feel good about." }),
  ).toBeVisible();
});
async function navigate(page: any, label: string) {
  const toggle = page.locator(".menu-toggle");
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
  await page
    .locator("nav")
    .getByRole("button", { name: label, exact: true })
    .click();
}
test("viewing details preserves comparison and empty compare stays empty", async ({
  page,
}) => {
  await navigate(page, "Browse vehicles");
  const before = await page.evaluate(() =>
    localStorage.getItem("carmatch.compareVehicleIds"),
  );
  await page.locator(".vehicle-card-main").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why this car?" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("carmatch.compareVehicleIds"),
    ),
  ).toBe(before);
  await page.getByRole("button", { name: "Close vehicle details" }).click();
  await page.getByRole("button", { name: "Clear all" }).click();
  await navigate(page, "Compare");
  await expect(
    page.getByText("Your comparison is empty.", { exact: false }),
  ).toBeVisible();
});
test("quote failures preserve draft; edit, archive and restore work", async ({
  page,
}) => {
  await navigate(page, "Deal tracker");
  await page.getByLabel("Dealer", { exact: true }).fill("Test dealer");
  await page.getByLabel("Vehicle price before tax & fees").fill("40000");
  await page.evaluate(() => {
    (window as any).__failNextWrite = true;
  });
  await page.getByRole("button", { name: "Save quote", exact: true }).click();
  await expect(
    page.getByText("Your draft is preserved.", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Dealer", { exact: true })).toHaveValue(
    "Test dealer",
  );
  await page.getByRole("button", { name: "Save quote", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Quote saved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit quote" }).click();
  await page.getByLabel("Dealer", { exact: true }).fill("Updated dealer");
  await page.getByRole("button", { name: "Save quote changes" }).click();
  await expect(page.locator(".quote-list")).toContainText("Updated dealer");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".quote-list")).not.toContainText("Updated dealer");
  await page
    .getByRole("button", { name: "Archived quotes", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByRole("button", { name: "Active quotes", exact: true })
    .click();
  await expect(page.locator(".quote-list")).toContainText("Updated dealer");
});
test("diary completes an existing planned drive without duplicating it", async ({
  page,
}) => {
  await navigate(page, "Test drive diary");
  await page.getByLabel("Dealer / location").fill("Drive location");
  await page.getByRole("button", { name: "Save diary entry" }).click();
  await expect(page.locator(".timeline-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Open / complete drive" }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Completed");
  await page
    .getByRole("combobox", { name: "Emily's rating", exact: false })
    .selectOption("9");
  await page
    .getByRole("combobox", { name: "Nick's rating", exact: false })
    .selectOption("7");
  await page
    .getByRole("combobox", { name: "Car-seat fit", exact: true })
    .selectOption("Pass");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".timeline-card")).toHaveCount(1);
  await expect(page.locator(".timeline-card")).toContainText("Completed");
  await expect(page.locator(".timeline-card")).toContainText("Emily: 9");
});
test("saved scenarios restore vehicle and financial assumptions; calculator tabs support keyboard", async ({
  page,
}) => {
  await navigate(page, "Payment calculator");
  await page
    .getByRole("combobox", { name: "Vehicle", exact: true })
    .selectOption("crv");
  await page.getByLabel("Cash down payment", { exact: true }).fill("10000");
  await page.getByLabel("Scenario name", { exact: true }).fill("CR-V plan");
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Vehicle", exact: true })
    .selectOption("rav4");
  await page.getByLabel("Cash down payment", { exact: true }).fill("2000");
  await page
    .getByRole("button", { name: "Apply scenario", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Vehicle", exact: true }),
  ).toHaveValue("crv");
  await expect(
    page.getByLabel("Cash down payment", { exact: true }),
  ).toHaveValue("10000");
  await page.getByRole("tab", { name: "Simple", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Ownership", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByLabel("Annual kilometres", { exact: true }),
  ).toBeVisible();
});
test("honour-system profile switch and visible app switching remain available", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Nick", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nick", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Switch app", exact: true }).click();
  await page.getByRole("button", { name: "SenStats", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "Senator expenses", exact: true }),
  ).toBeVisible();
});

test("comparison controls, note failure recovery and responsive layout", async ({
  page,
}, testInfo) => {
  await page.screenshot({
    path: `/tmp/flexspace-home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await navigate(page, "Compare");
  await page.getByLabel("Show differences only", { exact: true }).check();
  await page.getByLabel("Two-vehicle view", { exact: true }).check();
  await expect(page.locator(".comparison-table thead th")).toHaveCount(3);
  await navigate(page, "Browse vehicles");
  await page.locator(".vehicle-card-main").first().click();
  await page
    .getByLabel("Shared notes", { exact: true })
    .fill("No deal breakers. Keep this note.");
  await page.evaluate(() => {
    (window as any).__failNextWrite = true;
  });
  await page
    .getByRole("button", { name: "Save shared note", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Your note is preserved",
  );
  await expect(page.getByLabel("Shared notes", { exact: true })).toHaveValue(
    "No deal breakers. Keep this note.",
  );
  await page
    .getByRole("button", { name: "Save shared note", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Saved",
  );
  await expect(
    page.getByRole("checkbox", { name: "Explicit deal breaker", exact: true }),
  ).not.toBeChecked();
});

test("photo upload and calendar export work without storage credentials", async ({
  page,
}) => {
  await navigate(page, "Test drive diary");
  await page.getByLabel("Dealer / location").fill("Photo drive");
  await page.getByLabel("Appointment time", { exact: true }).fill("10:30");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4361ee";
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(
    page.getByRole("img", { name: "Drive photo 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save diary entry", exact: true })
    .click();
  await expect(page.locator(".timeline-card img")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Add to calendar", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/test-drive-.*\.ics/);
});

test("Needs review opens the requested profile with reaction controls focused", async ({
  page,
}) => {
  const review = page
    .getByRole("button", { name: /Nick: Needs review —/ })
    .first();
  const vehicle = (await review.getAttribute("aria-label"))!.split(" — ")[1];
  await review.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 1 })).toHaveText(vehicle);
  await expect(
    dialog.getByRole("combobox", { name: "Nick's reaction", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("combobox", { name: "Nick's reaction", exact: true })
    .selectOption("Love");
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Close vehicle details" }).click();
  await expect(
    page.getByRole("button", { name: "Nick", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", {
      name: `Nick: Needs review — ${vehicle}`,
      exact: true,
    }),
  ).toHaveCount(0);
});

test("vehicle details preselect the vehicle and its price in quote and drive forms", async ({
  page,
}) => {
  await navigate(page, "Browse vehicles");
  const card = page
    .locator(".vehicle-card-main")
    .filter({ has: page.getByText("Honda CR-V", { exact: true }) });
  await card.click();
  await page.getByRole("button", { name: "Add quote", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Vehicle", exact: true }),
  ).toHaveValue("crv");
  await expect(page.getByLabel("Vehicle price before tax & fees")).toHaveValue(
    "36975",
  );
  await navigate(page, "Browse vehicles");
  await page
    .locator(".vehicle-card-main")
    .filter({ has: page.getByText("Nissan Rogue", { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Plan a test drive", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Vehicle", exact: true }),
  ).toHaveValue("rogue");
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("Planned");
});

test("close recommendations foreground Similar fit and trade-offs instead of point differences", async ({
  page,
}) => {
  await expect(page.locator(".contender-card").first()).toContainText(
    "Similar fit",
  );
  await expect(page.locator(".contender-card").first()).toContainText(
    "Trade-off:",
  );
  await expect(page.locator(".contender-list").first()).not.toContainText(
    "/100",
  );
  await navigate(page, "Compare");
  await expect(page.locator(".comparison-table")).toContainText("Watch-outs");
  await expect(page.locator(".comparison-table")).not.toContainText(
    "Recommendation / 100",
  );
});
