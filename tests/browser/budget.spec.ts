import { gzipSync } from "node:zlib";
import { emptyBudget, TODAY } from "../../src/budget/model";
import { test, expect, type Page } from "@playwright/test";
const KEY = "flexspace.flowbudget.v1";
async function nav(page: Page, name: string) {
  await page.locator(".flow-app").waitFor({ state: "visible" });
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
      name: "Your monthly budget.",
      exact: true,
    }),
  ).toBeVisible();
  await nav(page, "Overview");
});
test("personal budget launches without Firebase or demo controls", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Give your money a clearer path." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /demo/i })).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
  ).toBeNull();
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
  await nav(page, "Overview");
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
  await nav(page, "Overview");
  await expect(
    page.getByText("Your household plan is loaded and saved on this device.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(page.url()).not.toContain("#");
  await page.reload();
  await nav(page, "Overview");
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
  await nav(page, "Overview");
  await expect(
    page.getByText("Your household plan is loaded and saved on this device.", {
      exact: true,
    }),
  ).toBeVisible();
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

test("private setup never overwrites an existing personal budget automatically", async ({
  page,
}) => {
  await account(page);
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "replacement",
      name: "Replacement account",
      type: "Checking",
      openingCents: 90000,
      openingDate: TODAY(),
    },
  ];
  const encoded = gzipSync(Buffer.from(JSON.stringify(preset))).toString(
    "base64url",
  );
  await page.goto("/?app=budget#flow-plan=" + encoded);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Load your budget plan" }),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(saved.accounts[0].name).toBe("Everyday");
  expect(page.url()).not.toContain("#");
});

test("saved what-if projections persist without changing real transactions or balances", async ({
  page,
}) => {
  await account(page);
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  await nav(page, "Scenarios & projections");
  await page.getByLabel("Scenario name", { exact: true }).fill("Roof repair");
  await page
    .getByLabel("Projection length", { exact: true })
    .selectOption("30");
  await page
    .getByLabel("Include remaining monthly spending plan", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Add hypothetical event", exact: true })
    .click();
  await page.getByLabel("Event name", { exact: true }).fill("New roof");
  await page.getByLabel("Event amount", { exact: true }).fill("250");
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Projected closing cash" }),
  ).toContainText("$750.00");
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Difference from baseline" }),
  ).toContainText("-$250.00");
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await expect(
    page.getByText(
      "Scenario saved on this device and included in JSON backups.",
      { exact: true },
    ),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(saved.accounts).toEqual(before.accounts);
  expect(saved.entries).toEqual(before.entries);
  expect(saved.scenarios).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.reload();
  await nav(page, "Overview");
  await nav(page, "Scenarios & projections");
  await expect(page.getByLabel("Scenario name", { exact: true })).toHaveValue(
    "Roof repair",
  );
  await expect(page.getByLabel("Event amount", { exact: true })).toHaveValue(
    "250",
  );
  await page.getByRole("button", { name: "New scenario", exact: true }).click();
  await page
    .getByLabel("Saved scenario", { exact: true })
    .selectOption(saved.scenarios[0].id);
  await expect(page.getByLabel("Scenario name", { exact: true })).toHaveValue(
    "Roof repair",
  );
});

test("monthly income follows fortnightly pay dates instead of a fixed two-pay target", async ({
  page,
}) => {
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "checking",
      name: "Checking",
      type: "Checking",
      openingCents: 100000,
      openingDate: "2020-01-01",
    },
  ];
  preset.recurring = [
    {
      id: "salary",
      payee: "Salary",
      type: "income",
      categoryId: "salary",
      amountCents: 200000,
      frequency: "biweekly",
      accountId: "checking",
      startDate: "2026-11-05",
      endDate: "",
      active: true,
    },
  ];
  await page.evaluate(
    ({ key, preset }) => localStorage.setItem(key, JSON.stringify(preset)),
    { key: KEY, preset },
  );
  await page.reload();
  await nav(page, "Overview");
  await nav(page, "Monthly budget");
  await page.getByLabel("Budget month", { exact: true }).fill("2026-12");
  await expect(
    page.locator(".flow-budget-line").filter({ hasText: "Salary" }),
  ).toContainText("$2,000.00 every 14 days · 3 scheduled payments");
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Planned monthly income" }),
  ).toContainText("$6,000.00");
});

test("default page is a grouped editable household budget with accurate totals", async ({
  page,
}) => {
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "checking",
      name: "Everyday",
      type: "Checking",
      openingCents: 100000,
      openingDate: TODAY(),
    },
  ];
  preset.categories = [
    {
      id: "salary",
      name: "Salary",
      kind: "income",
      color: "#267870",
      defaultLimitCents: 400000,
      group: "Income",
    },
    {
      id: "rent",
      name: "Rent",
      kind: "expense",
      color: "#5565b3",
      defaultLimitCents: 50000,
      group: "Fixed bills",
    },
    {
      id: "food",
      name: "Groceries",
      kind: "expense",
      color: "#4e9181",
      defaultLimitCents: 10000,
      group: "Living",
    },
  ];
  preset.entries = [
    {
      id: "food-1",
      accountId: "checking",
      type: "expense",
      categoryId: "food",
      amountCents: 2550,
      date: TODAY(),
      payee: "Groceries",
      note: "",
      cleared: true,
    },
  ];
  await page.evaluate(
    ({ key, preset }) => localStorage.setItem(key, JSON.stringify(preset)),
    { key: KEY, preset },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your monthly budget.", exact: true }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Monthly household budget" });
  await expect(
    table.getByRole("columnheader", { name: "Planned", exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Actual", exact: true }),
  ).toBeVisible();
  const row = page.locator(".flow-budget-line").filter({
    has: page.getByRole("heading", { name: "Groceries", exact: true }),
  });
  await expect(row).toContainText("$25.50");
  await expect(row).toContainText("$74.50 left");
  await page
    .getByRole("button", { name: "Collapse Living", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Groceries", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand Living", exact: true })
    .click();
  await page.getByLabel("Groceries monthly limit", { exact: true }).fill("120");
  await page
    .getByRole("button", { name: "Save Groceries limit", exact: true })
    .click();
  await expect(row).toContainText("$94.50 left");
  await expect(
    page.locator(".flow-stat").filter({ hasText: "Planned monthly expenses" }),
  ).toContainText("$620.00");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(saved.accounts).toEqual(preset.accounts);
  expect(saved.entries).toEqual(preset.entries);
});

test("main budget shows new savings milestones separately from existing balances and supports scenario comparison", async ({
  page,
}) => {
  const preset = emptyBudget();
  preset.accounts = [
    {
      id: "cash",
      name: "Chequing",
      type: "Checking",
      openingCents: 100000,
      openingDate: TODAY(),
    },
    {
      id: "savings",
      name: "Savings",
      type: "Savings",
      openingCents: 500000,
      openingDate: TODAY(),
      includeInForecast: false,
    },
    {
      id: "investment",
      name: "Investments",
      type: "Investment",
      openingCents: 800000,
      openingDate: TODAY(),
      includeInForecast: false,
    },
  ];
  const future = new Date();
  future.setDate(future.getDate() + 15);
  const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  preset.entries = [
    {
      id: "future-pay",
      accountId: "cash",
      type: "income",
      categoryId: "salary",
      amountCents: 30000,
      date,
      payee: "Extra pay",
      note: "",
      cleared: false,
    },
  ];
  preset.scenarios = [
    {
      id: "trip",
      name: "Holiday",
      days: 365,
      reserveCents: 0,
      includeSpending: true,
      spendingPercent: 100,
      overrides: [],
      events: [
        {
          id: "cost",
          name: "Trip",
          accountId: "cash",
          type: "expense",
          amountCents: 20000,
          date,
          frequency: "once",
          endDate: "",
        },
      ],
    },
  ];
  await page.evaluate(
    ({ key, preset }) => localStorage.setItem(key, JSON.stringify(preset)),
    { key: KEY, preset },
  );
  await page.reload();
  const outlook = page.getByRole("region", {
    name: "Savings outlook",
    exact: true,
  });
  await expect(outlook).toBeVisible();
  await expect(outlook).toContainText("Starting liquid balance: $6,000.00");
  for (const months of [6, 12, 24]) {
    const card = outlook.getByRole("article", {
      name: `${months}-month savings estimate`,
      exact: true,
    });
    await expect(card).toContainText("+$300.00");
    await expect(card).toContainText("$6,300.00");
  }
  await page.getByLabel("Outlook plan", { exact: true }).selectOption("trip");
  await expect(
    outlook.getByRole("article", {
      name: "6-month savings estimate",
      exact: true,
    }),
  ).toContainText("+$100.00");
  await page
    .getByRole("button", { name: "Show savings projection", exact: true })
    .click();
  await page
    .getByLabel("Savings chart horizon", { exact: true })
    .selectOption("24");
  await expect(
    outlook.getByRole("img", { name: /Savings added from/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(saved).toEqual(preset);
});
