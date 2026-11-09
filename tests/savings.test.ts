import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBudget,
  occurrenceDates,
  type BudgetScenario,
} from "../src/budget/model";
import { monthsAfter, savingsOutlook } from "../src/budget/savings";
function setup() {
  const data = emptyBudget();
  data.accounts = [
    {
      id: "cash",
      name: "Chequing",
      type: "Checking",
      openingCents: 100000,
      openingDate: "2020-01-01",
    },
  ];
  data.categories = [
    {
      id: "salary",
      name: "Salary",
      kind: "income",
      color: "#267870",
      defaultLimitCents: 0,
    },
    {
      id: "food",
      name: "Groceries",
      kind: "expense",
      color: "#267870",
      defaultLimitCents: 0,
    },
  ];
  return data;
}
test("savings milestones use calendar months, including leap years and month ends", () => {
  assert.equal(monthsAfter("2026-01-31", 1), "2026-02-28");
  assert.equal(monthsAfter("2024-02-29", 12), "2025-02-28");
  const result = savingsOutlook(setup(), { today: "2026-11-09" });
  assert.deepEqual(
    result.milestones.map((m) => m.date),
    ["2027-05-09", "2027-11-09", "2028-11-09"],
  );
  assert.equal(result.points.length, 732);
});
test("new savings exclude existing money and internal transfers, while investments stay outside liquid totals", () => {
  const data = setup();
  data.accounts.push(
    {
      id: "savings",
      name: "Savings",
      type: "Savings",
      openingCents: 500000,
      openingDate: "2020-01-01",
      includeInForecast: false,
    },
    {
      id: "card",
      name: "Card",
      type: "Credit card",
      openingCents: -10000,
      openingDate: "2020-01-01",
    },
    {
      id: "investments",
      name: "Investments",
      type: "Investment",
      openingCents: 800000,
      openingDate: "2020-01-01",
    },
  );
  data.entries = [
    {
      id: "pay",
      type: "income",
      accountId: "cash",
      categoryId: "salary",
      amountCents: 30000,
      date: "2026-03-01",
      payee: "Pay",
      note: "",
      cleared: false,
    },
    {
      id: "transfer",
      type: "transfer",
      accountId: "cash",
      toAccountId: "savings",
      categoryId: "",
      amountCents: 20000,
      date: "2026-04-01",
      payee: "Save",
      note: "",
      cleared: false,
    },
  ];
  const original = JSON.stringify(data);
  const result = savingsOutlook(data, { today: "2026-01-01" });
  assert.equal(result.startingCents, 590000);
  assert.equal(result.milestones[0].addedCents, 30000);
  assert.equal(result.milestones[0].balanceCents, 620000);
  assert.equal(JSON.stringify(data), original);
});
test("biweekly pay remains anchored every fourteen days across yearly savings projections", () => {
  const data = setup();
  data.recurring = [
    {
      id: "pay",
      accountId: "cash",
      categoryId: "salary",
      type: "income",
      amountCents: 10000,
      payee: "Salary",
      frequency: "biweekly",
      startDate: "2026-01-02",
      endDate: "",
      active: true,
    },
  ];
  const result = savingsOutlook(data, { today: "2026-01-01" });
  for (const milestone of result.milestones)
    assert.equal(
      milestone.addedCents,
      occurrenceDates(data.recurring[0], "2026-01-01", milestone.date).length *
        10000,
    );
  assert.equal(result.undatedCategories.length, 0);
});
test("undated income is optional, begins next full month, and does not double count future recorded income", () => {
  const data = setup();
  data.categories[0].defaultLimitCents = 28000;
  data.recurring = [
    {
      id: "pending",
      accountId: "cash",
      categoryId: "salary",
      type: "income",
      amountCents: 28000,
      payee: "Undated income",
      frequency: "monthly",
      startDate: "2026-02-01",
      endDate: "",
      active: false,
      dateConfirmed: false,
    },
  ];
  data.entries = [
    {
      id: "received",
      type: "income",
      accountId: "cash",
      categoryId: "salary",
      amountCents: 10000,
      date: "2026-02-05",
      payee: "Partial income",
      note: "",
      cleared: false,
    },
  ];
  const included = savingsOutlook(data, { today: "2026-01-15" });
  const excluded = savingsOutlook(data, {
    today: "2026-01-15",
    includeUndatedIncome: false,
  });
  assert.equal(included.points.find((p) => p.date === "2026-01-31")!.cents, 0);
  assert.equal(
    included.points.find((p) => p.date === "2026-02-28")!.cents,
    28000,
  );
  assert.equal(
    excluded.points.find((p) => p.date === "2026-02-28")!.cents,
    10000,
  );
  data.recurring[0].dateConfirmed = true; // Explicitly paused pay must not reappear as undated income.
  assert.equal(
    savingsOutlook(data, { today: "2026-01-15" }).undatedCategories.length,
    0,
  );
});
test("savings estimates include spending plans, saved scenario changes and unconfirmed-balance gating", () => {
  const data = setup();
  data.categories[1].defaultLimitCents = 31000;
  const base = savingsOutlook(data, { today: "2026-01-01" });
  assert.equal(base.points.find((p) => p.date === "2026-01-31")!.cents, -31000);
  const scenario: BudgetScenario = {
    id: "s",
    name: "Less spending",
    days: 90,
    reserveCents: 0,
    includeSpending: true,
    spendingPercent: 50,
    overrides: [],
    events: [],
  };
  const lower = savingsOutlook(data, { today: "2026-01-01", scenario });
  assert.equal(
    lower.points.find((p) => p.date === "2026-01-31")!.cents,
    -15500,
  );
  data.accounts[0].balanceConfirmed = false;
  assert.equal(savingsOutlook(data, { today: "2026-01-01" }).confirmed, false);
});
