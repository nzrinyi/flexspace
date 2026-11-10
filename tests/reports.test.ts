import test from "node:test";
import assert from "node:assert/strict";
import { emptyBudget, validateBudget } from "../src/budget/model";
import { monthDays, reportData } from "../src/budget/reports";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  mergeBudgetRules,
} = require("../.github/scripts/deploy-budget-rules.cjs");
test("report totals exclude transfers and future entries, and preserve real opening history", () => {
  const d = emptyBudget();
  d.accounts = [
    {
      id: "cash",
      name: "Cash",
      type: "Checking",
      openingCents: 100000,
      openingDate: "2026-11-01",
    },
    {
      id: "savings",
      name: "Savings",
      type: "Savings",
      openingCents: 50000,
      openingDate: "2026-11-01",
    },
  ];
  d.entries = [
    {
      id: "pay",
      accountId: "cash",
      type: "income",
      amountCents: 20000,
      date: "2026-11-02",
      payee: "Pay",
      categoryId: "salary",
      note: "",
      cleared: true,
    },
    {
      id: "food",
      accountId: "cash",
      type: "expense",
      amountCents: 5000,
      date: "2026-11-03",
      payee: "Food",
      categoryId: "category-1",
      note: "",
      cleared: true,
    },
    {
      id: "future",
      accountId: "cash",
      type: "expense",
      amountCents: 9000,
      date: "2026-11-20",
      payee: "Future",
      categoryId: "category-1",
      note: "",
      cleared: false,
    },
    {
      id: "transfer",
      accountId: "cash",
      toAccountId: "savings",
      type: "transfer",
      amountCents: 10000,
      date: "2026-11-04",
      payee: "Save",
      categoryId: "",
      note: "",
      cleared: true,
    },
  ];
  const result = reportData(d, "2026-11", "2026-11-10");
  assert.equal(result.income, 20000);
  assert.equal(result.spent, 5000);
  assert.equal(result.averageMonthly, 5000);
  assert.equal(result.averageTransaction, 5000);
  assert.equal(result.trends.length, 1);
  assert.equal(result.trends[0].cents, 165000);
  assert.equal(result.flow[result.flow.length - 1].cents, 15000);
});
test("calendar dates respect leap years and recorded recurring payments are not duplicated", () => {
  assert.equal(monthDays("2024-02").dates.length, 29);
  assert.equal(monthDays("2026-11").offset, 0);
  const d = emptyBudget();
  d.accounts = [
    {
      id: "cash",
      name: "Cash",
      type: "Checking",
      openingCents: 0,
      openingDate: "2026-01-01",
    },
  ];
  d.recurring = [
    {
      id: "rent",
      accountId: "cash",
      type: "expense",
      amountCents: 10000,
      payee: "Rent",
      categoryId: "category-0",
      frequency: "monthly",
      startDate: "2026-11-01",
      endDate: "",
      active: true,
    },
  ];
  d.entries = [
    {
      id: "recorded",
      accountId: "cash",
      type: "expense",
      amountCents: 10000,
      payee: "Rent",
      categoryId: "category-0",
      date: "2026-11-01",
      recurringId: "rent",
      occurrenceDate: "2026-11-01",
      cleared: true,
      note: "",
    },
  ];
  assert.equal(reportData(d, "2026-11", "2026-11-10").due.length, 0);
  d.reportWidgets = ["calendar", "netWorth"];
  assert.deepEqual(validateBudget(d).reportWidgets, d.reportWidgets);
  assert.throws(() => validateBudget({ ...d, reportWidgets: ["untrusted"] }));
});
test("rules deployment preserves other application rules and replaces only the budget block", () => {
  const old = `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /existing/{id} { allow read: if request.auth != null; } } }`;
  const block =
    "// BEGIN FLOWBUDGET CLOUD\nmatch /flowBudgets/{id} { allow list: if false; }\n// END FLOWBUDGET CLOUD";
  const merged = mergeBudgetRules(old, block);
  assert.ok(
    merged.includes(
      "match /existing/{id} { allow read: if request.auth != null; }",
    ),
  );
  assert.equal(mergeBudgetRules(merged, block), merged);
  assert.throws(() => mergeBudgetRules("unexpected rules", block));
});
