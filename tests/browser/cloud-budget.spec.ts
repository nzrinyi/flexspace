import { test, expect, type Page } from "@playwright/test";
import { emptyBudget, TODAY } from "../../src/budget/model";
async function nav(page: Page, name: string) {
  await page.locator(".flow-app").waitFor();
  const toggle = page.getByRole("button", {
    name: "Toggle budgeting menu",
    exact: true,
  });
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
  await page
    .getByRole("navigation", { name: "FlowBudget sections" })
    .getByRole("button", { name, exact: false })
    .click();
}
async function create(page: Page, name: string) {
  await page.getByLabel("Budget name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Create empty budget", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your monthly budget.", exact: true }),
  ).toBeVisible();
}
async function account(page: Page, name: string, amount = "1000") {
  await page
    .getByRole("button", { name: "Add your first account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account name", { exact: true }).fill(name);
  await dialog.getByLabel("Opening balance", { exact: true }).fill(amount);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (r) => r.abort());
  await page.goto("/?app=budget&cloudTest=1");
  await expect(
    page.getByRole("heading", { name: "Budget manager", exact: true }),
  ).toBeVisible();
});
test("cloud budgets are separate, survive reloads and do not write a local budget", async ({
  page,
}) => {
  await create(page, "Home");
  await account(page, "Household cash");
  await page.getByRole("button", { name: "Budgets", exact: true }).click();
  await create(page, "Travel");
  await account(page, "Travel cash", "200");
  await page.getByRole("button", { name: "Budgets", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await nav(page, "Accounts");
  await expect(
    page.getByRole("heading", { name: "Household cash", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Travel cash", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("flexspace.flowbudget.v1")),
  ).toBeNull();
  await page.reload();
  await nav(page, "Accounts");
  await expect(
    page.getByRole("heading", { name: "Household cash", exact: true }),
  ).toBeVisible();
});
test("cloud save failures keep the editor and draft open until a server-confirmed retry", async ({
  page,
}) => {
  await create(page, "Home");
  await page
    .getByRole("button", { name: "Add your first account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Account name", { exact: true })
    .fill("Keep my draft");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("500");
  await page.evaluate(() => {
    (window as any).__failCloudWrite = true;
  });
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Cloud save unavailable",
  );
  await expect(dialog.getByLabel("Account name", { exact: true })).toHaveValue(
    "Keep my draft",
  );
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});
test("another device opens the same budget normally, syncs updates, and preserves open drafts", async ({
  page,
  context,
}) => {
  await create(page, "Family");
  await account(page, "Joint cash");
  await page
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const own = page.getByRole("dialog");
  await own.getByLabel("Description", { exact: true }).fill("Owner draft");
  await own.getByLabel("Amount", { exact: true }).fill("10");
  const wife = await context.newPage();
  await wife.route("https://**/*", (r) => r.abort());
  await wife.goto("/?app=budget&cloudTest=1&testUser=wife");
  await expect(
    wife.getByRole("heading", { name: "Your monthly budget.", exact: true }),
  ).toBeVisible();
  expect(wife.url()).not.toContain("budget-invite");
  await wife
    .getByRole("button", { name: "＋ Add transaction", exact: true })
    .click();
  const other = wife.getByRole("dialog");
  await other.getByLabel("Description", { exact: true }).fill("Wife purchase");
  await other.getByLabel("Amount", { exact: true }).fill("25");
  await other
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await other
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(other).toHaveCount(0);
  await expect(
    page.getByText("Budget updated on another device.", { exact: false }),
  ).toBeVisible();
  await own
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("category-1");
  await own
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(own.getByRole("alert")).toContainText(
    "changed on another device",
  );
  await expect(own.getByLabel("Description", { exact: true })).toHaveValue(
    "Owner draft",
  );
  await own
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(own).toHaveCount(0);
  await nav(wife, "Transactions");
  await expect(wife.locator(".flow-ledger")).toContainText("Owner draft");
  await expect(wife.locator(".flow-ledger")).toContainText("Wife purchase");
  await wife.close();
});
test("an existing browser budget migrates to Firestore and remains recoverable as an old backup", async ({
  page,
}) => {
  const data = emptyBudget();
  data.accounts = [
    {
      id: "legacy",
      name: "Existing household",
      type: "Checking",
      openingCents: 100000,
      openingDate: TODAY(),
    },
  ];
  await page.evaluate((d) => {
    localStorage.setItem("flexspace.flowbudget.v1", JSON.stringify(d));
  }, data);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your monthly budget.", exact: true }),
  ).toBeVisible();
  await nav(page, "Accounts");
  await expect(
    page.getByRole("heading", { name: "Existing household", exact: true }),
  ).toBeVisible();
  await page.reload();
  await nav(page, "Accounts");
  await expect(
    page.getByRole("heading", { name: "Existing household", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("flexspace.flowbudget.v1")!).revision,
    ),
  ).toBe(0);
});
