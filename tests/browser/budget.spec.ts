import { gzipSync } from "node:zlib";
import { emptyBudget, TODAY } from "../../src/budget/model";
import { test, expect, type Page } from "@playwright/test";
const KEY = "flexspace.flowbudget.v1";
async function nav(page: Page, name: string) {
  const toggle = page.getByRole("button", {
    name: "Toggle budgeting menu",
    exact: true,
  });
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
  if (name === "Settings & backups")
    await page
      .locator(".flow-sidebar")
      .getByRole("button", { name, exact: true })
      .click();
  else
    await page
      .getByRole("navigation", { name: "FlowBudget sections" })
      .getByRole("button", { name, exact: false })
      .click();
}
async function account(page: Page) {
  await page.getByRole("button", { name: "Add your first account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account name", { exact: true }).fill("Everyday");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("1000.00");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/?app=budget");
  await expect(
    page.getByRole("heading", {
      name: "Your money, a little clearer.",
      exact: true,
    }),
  ).toBeVisible();
});
test("personal budget launches without Firebase or demo controls", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Give your money a clearer path." })).toBeVisible();
  await expect(page.getByRole("button", { name: /demo/i })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});
test("account and transaction persist, monthly budgets and reports reflect real entries", async ({
  page,
}) => {
  await account(page);
  await page
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("25.50");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Weekly groceries");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(page.locator(".flow-stats").first()).toContainText("$974.50");
  await page.reload();
  await expect(page.locator(".flow-stats").first()).toContainText("$974.50");
  await nav(page, "Monthly budget");
  await page.getByLabel("Groceries monthly limit", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Save Groceries limit", exact: true })
    .click();
  await expect(
    page.locator(".flow-budget-line").filter({
      has: page.getByRole("heading", { name: "Groceries", exact: true }),
    }),
  ).toContainText("$74.50 left");
  await nav(page, "Reports");
  await expect(page.locator(".flow-stats")).toContainText("$25.50");
  await nav(page, "Transactions");
  await page
    .getByRole("button", {
      name: "Edit Weekly groceries transaction",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("30");
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(page.locator(".flow-ledger")).toContainText("30.00");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: "Delete Weekly groceries transaction",
      exact: true,
    })
    .click();
  await expect(page.locator(".flow-ledger")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".flow-ledger")).toContainText("Weekly groceries");
});
test("recorded recurring payment replaces its forecast occurrence", async ({
  page,
}) => {
  await account(page);
  await nav(page, "Bills & income");
  await page
    .getByRole("button", { name: "＋ Add recurring item", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Bill or income name", { exact: true })
    .fill("Internet");
  await dialog.getByLabel("Amount", { exact: true }).fill("80");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-2");
  await dialog
    .getByRole("button", { name: "Create recurring item", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Record Internet due/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await nav(page, "Overview");
  await expect(page.locator(".flow-stats").first()).toContainText("$920.00");
  await nav(page, "Transactions");
  await expect(page.locator(".flow-ledger tbody tr")).toHaveCount(1);
  const raw = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(raw.entries[0].recurringId).toBe(raw.recurring[0].id);
});
test("CSV previews invalid and duplicate rows and persists a confirmed import", async ({
  page,
}) => {
  await account(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const csv = `Date,Payee,Amount,Category\n${today},Coffee,-4.25,Dining out\n${today},Coffee,-4.25,Dining out\nnot-a-date,Bad,-2,Other`;
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(dialog).toContainText("1 ready");
  await expect(dialog).toContainText("1 potential duplicates");
  await expect(dialog).toContainText("1 invalid rows");
  await dialog
    .getByRole("button", { name: "Import 1 transactions", exact: true })
    .click();
  await nav(page, "Transactions");
  await expect(page.locator(".flow-ledger tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(dialog).toContainText("0 ready");
});
test("backup export and validation preserve existing data", async ({
  page,
}) => {
  await account(page);
  await nav(page, "Settings & backups");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON backup", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /flowbudget-backup-.*\.json/,
  );
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page.getByLabel("Restore JSON backup", { exact: false }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    before,
  );
  const restored = JSON.parse(before!);
  restored.accounts[0].name = "Restored account";
  await page.getByLabel("Restore JSON backup", { exact: false }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Replace this device’s budget", exact: true })
    .click();
  await nav(page, "Accounts");
  await expect(
    page.getByRole("heading", { name: "Restored account", exact: true }),
  ).toBeVisible();
});
test("responsive budget layouts have no page overflow", async ({
  page,
}, info) => {
  await account(page);
  await page.screenshot({
    path: `/tmp/flowbudget-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await nav(page, "Monthly budget");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `/tmp/flowbudget-budget-${info.project.name}.png`,
    fullPage: true,
  });
});

test("storage failures preserve form drafts and leave saved data unchanged", async ({
  page,
}) => {
  await account(page);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("15");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Draft purchase");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "flexspace.flowbudget.v1")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Nothing was saved");
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Draft purchase",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    before,
  );
  await page.evaluate(() => (window as any).__restoreStorage());
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("another tab updates balances without discarding an open transaction draft", async ({
  page,
  context,
}) => {
  await account(page);
  await page
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Description", { exact: true }).fill("Keep my draft");
  const other = await context.newPage();
  await other.route("https://**/*", (route) => route.abort());
  await other.goto("/?app=budget");
  await other
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const d = other.getByRole("dialog");
  await d.getByLabel("Amount", { exact: true }).fill("5");
  await d.getByLabel("Description", { exact: true }).fill("Other tab");
  await d
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await d.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(
    page.getByText("Budget updated in another tab.", { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Keep my draft",
  );
  await dialog.getByLabel("Amount", { exact: true }).fill("7");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(saved.entries).toHaveLength(2);
  await other.close();
});

test("private preload links are consumed locally and unknown starting balances never become forecasts", async ({
  page,
}) => {
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "imported",
      name: "Imported checking",
      type: "Checking",
      openingDate: TODAY(),
      openingCents: 0,
      balanceConfirmed: false,
    },
  ];
  preset.categories.push({
    id: "planned-income",
    name: "Planned salary",
    kind: "income",
    color: "#267870",
    defaultLimitCents: 50000,
    group: "Income",
  });
  const encoded = gzipSync(Buffer.from(JSON.stringify(preset))).toString(
    "base64url",
  );
  await page.goto("/?app=budget#flow-plan=" + encoded);
  await expect(page.getByText("Your household plan is loaded and saved on this device.", { exact: true })).toBeVisible();
  expect(page.url()).not.toContain("#");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Add your actual starting balance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Projected daily balance/ }),
  ).toHaveCount(0);
  await nav(page, "Monthly budget");
  await expect(page.locator(".flow-stats")).toContainText("$500.00");
  await nav(page, "Overview");
  await page
    .getByRole("button", { name: "Set starting balance", exact: true })
    .click();
  const accountDialog = page.getByRole("dialog");
  await accountDialog
    .getByLabel("Opening balance", { exact: true })
    .fill("250");
  await accountDialog
    .getByRole("checkbox", {
      name: "I have entered the actual opening balance.",
      exact: true,
    })
    .check();
  await accountDialog
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Projected daily balance/ }),
  ).toBeVisible();
  await expect(page.locator(".flow-stats")).toContainText("$250.00");
});

test("tracked savings and investment snapshots do not inflate bill-paying cash", async ({
  page,
}) => {
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "cash",
      name: "Daily checking",
      type: "Checking",
      openingDate: TODAY(),
      openingCents: 100000,
      includeInForecast: true,
    },
    {
      id: "saved",
      name: "Earmarked savings",
      type: "Savings",
      openingDate: TODAY(),
      openingCents: 200000,
      includeInForecast: false,
    },
    {
      id: "invested",
      name: "Investment snapshot",
      type: "Investment",
      openingDate: TODAY(),
      openingCents: 300000,
      includeInForecast: false,
    },
  ];
  const encoded = gzipSync(Buffer.from(JSON.stringify(preset))).toString(
    "base64url",
  );
  await page.goto("/?app=budget#flow-plan=" + encoded);
  await expect(page.getByText("Your household plan is loaded and saved on this device.", { exact: true })).toBeVisible();
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Current balance" }),
  ).toContainText("$1,000.00");
  await expect(
    page
      .getByRole("combobox", { name: "Account filter", exact: true })
      .locator("option"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Transaction type", exact: true })
    .selectOption("transfer");
  await dialog.getByLabel("Amount", { exact: true }).fill("100");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Set money aside");
  await dialog
    .getByRole("combobox", { name: "Destination account", exact: true })
    .selectOption("saved");
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Current balance" }),
  ).toContainText("$900.00");
  await nav(page, "Accounts");
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Total tracked balance" }),
  ).toContainText("$6,000.00");
  await expect(
    page.getByRole("heading", { name: "Investment snapshot", exact: true }),
  ).toBeVisible();
});

test("private setup never overwrites an existing personal budget automatically", async ({ page }) => {
  await account(page);
  const preset = emptyBudget();
  preset.accounts = [{ id: "replacement", name: "Replacement account", type: "Checking", openingCents: 90000, openingDate: TODAY() }];
  const encoded = gzipSync(Buffer.from(JSON.stringify(preset))).toString("base64url");
  await page.goto("/?app=budget#flow-plan=" + encoded);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Load your budget plan" })).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(saved.accounts[0].name).toBe("Everyday");
  expect(page.url()).not.toContain("#");
});
