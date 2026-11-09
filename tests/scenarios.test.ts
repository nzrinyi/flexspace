import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBudget,
  categoryLimit,
  occurrenceDates,
  validateBudget,
  type BudgetScenario,
  type Recurring,
} from "../src/budget/model";
import { projectScenario } from "../src/budget/scenarios";
function setup() {
  const d = emptyBudget();
  d.accounts = [
    {
      id: "checking",
      name: "Checking",
      type: "Checking",
      openingCents: 100000,
      openingDate: "2026-01-01",
    },
  ];
  d.categories = [
    {
      id: "pay",
      name: "Salary",
      kind: "income",
      color: "#267870",
      defaultLimitCents: 400000,
    },
    {
      id: "food",
      name: "Groceries",
      kind: "expense",
      color: "#267870",
      defaultLimitCents: 31000,
    },
  ];
  const scenario: BudgetScenario = {
    id: "s",
    name: "Test projection",
    days: 30,
    reserveCents: 10000,
    includeSpending: false,
    spendingPercent: 100,
    events: [],
    overrides: [],
  };
  return { d, scenario };
}
test("calendar income uses actual fourteen-day cycles and includes three-pay months", () => {
  const { d } = setup();
  const rule: Recurring = {
    id: "salary",
    accountId: "checking",
    categoryId: "pay",
    type: "income",
    amountCents: 200000,
    payee: "Salary",
    frequency: "biweekly",
    startDate: "2026-01-01",
    endDate: "",
    active: true,
  };
  d.recurring = [rule];
  assert.deepEqual(occurrenceDates(rule, "2026-01-01", "2026-01-31"), [
    "2026-01-01",
    "2026-01-15",
    "2026-01-29",
  ]);
  assert.equal(categoryLimit(d, "pay", "2026-01"), 600000);
  assert.equal(categoryLimit(d, "pay", "2026-02"), 400000);
  d.plans = [{ categoryId: "pay", month: "2026-01", limitCents: 500000 }];
  assert.equal(categoryLimit(d, "pay", "2026-01"), 500000);
});
test("scenario costs, income changes and paused rules compare without mutating the ledger", () => {
  const { d, scenario } = setup();
  d.recurring = [
    {
      id: "salary",
      accountId: "checking",
      categoryId: "pay",
      type: "income",
      amountCents: 10000,
      payee: "Salary",
      frequency: "biweekly",
      startDate: "2026-01-02",
      endDate: "",
      active: true,
    },
  ];
  scenario.overrides = [
    { recurringId: "salary", amountCents: 12000, active: true },
  ];
  scenario.events = [
    {
      id: "purchase",
      name: "Purchase",
      accountId: "checking",
      type: "expense",
      amountCents: 50000,
      frequency: "once",
      date: "2026-01-10",
      endDate: "",
    },
  ];
  const original = JSON.stringify(d);
  const base = projectScenario(d, scenario, "2026-01-01", true);
  const result = projectScenario(d, scenario, "2026-01-01");
  assert.equal(base.closingCents, 130000);
  assert.equal(result.closingCents, 86000);
  assert.equal(result.closingCents - base.closingCents, -44000);
  assert.equal(JSON.stringify(d), original);
  scenario.overrides[0].active = false;
  assert.equal(projectScenario(d, scenario, "2026-01-01").closingCents, 50000);
});
test("planned spending deducts recorded expenses and scheduled bills before spreading the remainder", () => {
  const { d, scenario } = setup();
  scenario.includeSpending = true;
  d.entries = [
    {
      id: "spent",
      accountId: "checking",
      type: "expense",
      categoryId: "food",
      amountCents: 1000,
      date: "2026-01-01",
      payee: "Food",
      note: "",
      cleared: true,
    },
  ];
  d.recurring = [
    {
      id: "bill",
      accountId: "checking",
      type: "expense",
      categoryId: "food",
      amountCents: 5000,
      frequency: "monthly",
      startDate: "2026-01-15",
      endDate: "",
      payee: "Food delivery",
      active: true,
    },
  ];
  const result = projectScenario(d, scenario, "2026-01-01");
  assert.equal(result.plannedSpendingCents, 25000);
  assert.equal(result.closingCents, 69000);
  scenario.spendingPercent = 50;
  assert.equal(projectScenario(d, scenario, "2026-01-01").closingCents, 81500);
  assert.equal(
    projectScenario(d, scenario, "2026-01-01", true).closingCents,
    69000,
  );
});
test("partial-month projections pace spending across the month and detect the first shortfall", () => {
  const { d, scenario } = setup();
  scenario.includeSpending = true;
  d.accounts[0].openingCents = 10000;
  const result = projectScenario(d, scenario, "2026-01-15");
  assert.equal(result.months[0].closingCents, -21000);
  assert.ok(result.firstShortfall);
  assert.equal(result.points.length, 31);
});
test("scenarios round-trip in backups, reject invalid changes, and respect excluded accounts", () => {
  const { d, scenario } = setup();
  d.scenarios = [scenario];
  assert.deepEqual(validateBudget(JSON.parse(JSON.stringify(d))).scenarios, [
    scenario,
  ]);
  assert.equal(
    validateBudget({ ...d, scenarios: undefined }).scenarios,
    undefined,
  );
  assert.throws(() =>
    validateBudget({ ...d, scenarios: [{ ...scenario, days: 999999 }] }),
  );
  assert.throws(() =>
    validateBudget({
      ...d,
      scenarios: [{ ...scenario, events: [{ id: "bad" }] }],
    }),
  );
  d.accounts[0].includeInForecast = false;
  scenario.events = [
    {
      id: "cost",
      name: "Cost",
      accountId: "checking",
      type: "expense",
      amountCents: 10000,
      frequency: "once",
      date: "2026-01-02",
      endDate: "",
    },
  ];
  assert.equal(projectScenario(d, scenario, "2026-01-01").closingCents, 0);
});
test("lower recurring costs produce savings instead of being reassigned to the spending plan", () => {
  const { d, scenario } = setup();
  scenario.includeSpending = true;
  d.recurring = [
    {
      id: "bill",
      accountId: "checking",
      type: "expense",
      categoryId: "food",
      amountCents: 10000,
      frequency: "monthly",
      startDate: "2026-01-15",
      endDate: "",
      payee: "Bill",
      active: true,
    },
  ];
  scenario.overrides = [
    { recurringId: "bill", amountCents: 5000, active: true },
  ];
  const base = projectScenario(d, scenario, "2026-01-01", true);
  const result = projectScenario(d, scenario, "2026-01-01");
  assert.equal(result.closingCents - base.closingCents, 5000);
});

test("bills after a partial projection month still reduce that month's spending allowance", () => {
  const { d, scenario } = setup();
  scenario.includeSpending = true;
  d.recurring = [
    {
      id: "bill",
      accountId: "checking",
      type: "expense",
      categoryId: "food",
      amountCents: 10000,
      frequency: "monthly",
      startDate: "2026-02-28",
      endDate: "",
      payee: "Bill",
      active: true,
    },
  ];
  const result = projectScenario(d, scenario, "2026-01-15");
  assert.equal(result.months[0].closingCents, 69000);
  assert.equal(result.closingCents, 58500);
});

test("hypothetical recurring pay follows fourteen-day dates and stops at its end date", () => {
  const { d, scenario } = setup();
  scenario.events = [
    {
      id: "extra",
      name: "Temporary income",
      accountId: "checking",
      type: "income",
      amountCents: 10000,
      frequency: "biweekly",
      date: "2026-01-01",
      endDate: "2026-01-15",
    },
  ];
  assert.equal(projectScenario(d, scenario, "2026-01-01").closingCents, 120000);
});
