import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBudget,
  parseMoney,
  occurrenceDates,
  forecast,
  balance,
  validateBudget,
  validateEntry,
  categorySpent,
  categoryLimit,
  removeRecord,
  TODAY,
  addDays,
  type Recurring,
  type Entry,
} from "../src/budget/model";
import {
  readCSV,
  detectColumns,
  previewCSV,
  exportCSV,
  importDate,
} from "../src/budget/csv";
function setup() {
  const d = emptyBudget();
  d.accounts = [
    {
      id: "checking",
      name: "Checking",
      type: "Checking",
      openingCents: 100000,
      openingDate: "2020-01-01",
    },
    {
      id: "savings",
      name: "Savings",
      type: "Savings",
      openingCents: 50000,
      openingDate: "2020-01-01",
    },
  ];
  return d;
}
const rule: Recurring = {
  id: "rent",
  accountId: "checking",
  type: "expense",
  amountCents: 10000,
  payee: "Rent",
  categoryId: "category-0",
  frequency: "monthly",
  startDate: "2024-01-31",
  endDate: "",
  active: true,
};
function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "one",
    accountId: "checking",
    type: "expense",
    amountCents: 2000,
    date: "2024-02-01",
    payee: "Shop",
    categoryId: "category-1",
    note: "",
    cleared: true,
    ...overrides,
  };
}
test("money parsing uses exact integer cents and rejects malformed/negative expense amounts", () => {
  assert.equal(parseMoney("0.29"), 29);
  assert.equal(parseMoney("1,200.05"), 120005);
  assert.equal(parseMoney("(32.10)", true), -3210);
  assert.equal(parseMoney("0", true), 0);
  assert.throws(() => parseMoney("-2"));
  assert.throws(() => parseMoney("1.001"));
  assert.throws(() => parseMoney(""));
});
test("monthly and yearly recurrence clamps month end without drifting", () => {
  assert.deepEqual(occurrenceDates(rule, "2024-01-01", "2024-04-30"), [
    "2024-01-31",
    "2024-02-29",
    "2024-03-31",
    "2024-04-30",
  ]);
  assert.deepEqual(
    occurrenceDates(
      { ...rule, startDate: "2024-02-29", frequency: "yearly" },
      "2024-01-01",
      "2028-03-01",
    ),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
});
test("biweekly recurrence crosses years and respects end dates", () => {
  assert.deepEqual(
    occurrenceDates(
      {
        ...rule,
        startDate: "2024-12-24",
        frequency: "biweekly",
        endDate: "2025-01-22",
      },
      "2024-12-01",
      "2025-02-20",
    ),
    ["2024-12-24", "2025-01-07", "2025-01-21"],
  );
});
test("transfers move balances without changing combined wealth or spending", () => {
  const d = setup();
  d.entries = [
    entry({
      type: "transfer",
      toAccountId: "savings",
      categoryId: "",
      amountCents: 30000,
    }),
  ];
  validateBudget(d);
  assert.equal(balance(d, "2024-02-01"), 150000);
  assert.equal(balance(d, "2024-02-01", "checking"), 70000);
  assert.equal(balance(d, "2024-02-01", "savings"), 80000);
  assert.equal(categorySpent(d, "category-1", "2024-02"), 0);
});
test("forecast accounts for dated entries once, and combines matching recurrence once", () => {
  const d = setup();
  d.recurring = [{ ...rule, startDate: "2024-02-01" }];
  d.entries = [
    entry({
      date: "2024-02-01",
      amountCents: 10000,
      categoryId: "category-0",
      recurringId: "rent",
      occurrenceDate: "2024-02-01",
    }),
    entry({
      id: "future",
      type: "income",
      date: "2024-02-03",
      amountCents: 5000,
      categoryId: "salary",
    }),
  ];
  const f = forecast(d, 3, "checking", "2024-02-01");
  assert.equal(f.points[0].cents, 90000);
  assert.equal(f.points[2].cents, 95000);
  assert.equal(f.due.length, 0);
});
test("overdue unpaid bills apply today, while skipped and paused rules do not", () => {
  const d = setup();
  d.recurring = [{ ...rule, startDate: "2024-02-01", endDate: "2024-02-01" }];
  assert.equal(forecast(d, 5, "checking", "2024-02-03").points[0].cents, 90000);
  d.skipped = ["rent:2024-02-01"];
  assert.equal(
    forecast(d, 5, "checking", "2024-02-03").points[0].cents,
    100000,
  );
  d.skipped = [];
  d.recurring[0].active = false;
  assert.equal(
    forecast(d, 5, "checking", "2024-02-03").points[0].cents,
    100000,
  );
});
test("reserve room uses the lowest balance and can never be negative", () => {
  const d = setup();
  d.reserveCents = 90000;
  d.entries = [entry({ date: "2024-02-02", amountCents: 15000 })];
  const f = forecast(d, 5, "checking", "2024-02-01");
  assert.equal(f.low.cents, 85000);
  assert.equal(f.low.date, "2024-02-02");
  assert.equal(f.safeCents, 0);
});
test("early recorded payments suppress their original due date, and duplicates are rejected", () => {
  const d = setup();
  d.recurring = [rule];
  d.entries = [
    entry({
      date: "2024-01-29",
      recurringId: "rent",
      occurrenceDate: "2024-01-31",
      categoryId: "category-0",
    }),
  ];
  assert.equal(forecast(d, 4, "checking", "2024-01-30").due.length, 0);
  assert.throws(
    () => validateEntry({ ...d.entries[0], id: "two" }, d),
    /already/,
  );
});
test("category plans override defaults for one month only", () => {
  const d = setup();
  d.categories[1].defaultLimitCents = 20000;
  d.plans = [{ month: "2024-02", categoryId: "category-1", limitCents: 30000 }];
  assert.equal(categoryLimit(d, "category-1", "2024-02"), 30000);
  assert.equal(categoryLimit(d, "category-1", "2024-03"), 20000);
});
test("backup validation rejects broken references and protects account/category history", () => {
  const d = setup();
  d.entries = [entry()];
  assert.deepEqual(validateBudget(JSON.parse(JSON.stringify(d))), d);
  assert.throws(() =>
    validateBudget({ ...d, entries: [entry({ accountId: "missing" })] }),
  );
  assert.throws(() => removeRecord(d, "account", "checking"));
  assert.throws(() => removeRecord(d, "category", "category-1"));
  assert.throws(() => validateBudget({ ...d, version: 99 }));
  assert.throws(() => validateEntry(entry({ date: "2019-01-01" }), d));
});
test("CSV handles quoted commas, escaped quotes and newline fields", () => {
  assert.deepEqual(
    readCSV('Date,Payee,Amount\r\n2024-02-01,"A, B ""Shop""",-12.34\r\n'),
    [
      ["Date", "Payee", "Amount"],
      ["2024-02-01", 'A, B "Shop"', "-12.34"],
    ],
  );
  assert.throws(() => readCSV('A,B\n"unfinished'));
});
test("CSV preview reports invalid rows and potential duplicates without changing the ledger", () => {
  const d = setup();
  d.entries = [entry({ payee: "A shop", amountCents: 1234 })];
  const rows = readCSV(
    "Date,Description,Amount\n2024-02-01,A shop,-12.34\n2024-02-02,Pay,200.00\n2024-02-30,Oops,-4\n2024-02-03,Text,abc",
  );
  const p = previewCSV(rows, detectColumns(rows[0]), "checking", "ISO", d);
  assert.equal(p[0].duplicate, true);
  assert.equal(p[1].entry?.type, "income");
  assert.equal(p.filter((r) => r.error).length, 2);
  assert.equal(d.entries.length, 1);
});
test("CSV supports debit/credit columns and unambiguous configured dates", () => {
  const d = setup();
  const rows = readCSV(
    "Date,Payee,Debit,Credit\n31/01/2024,Grocer,12.30,\n01/02/2024,Pay,,100",
  );
  const p = previewCSV(rows, detectColumns(rows[0]), "checking", "DMY", d);
  assert.equal(p[0].entry?.date, "2024-01-31");
  assert.equal(p[0].entry?.amountCents, 1230);
  assert.equal(p[1].entry?.type, "income");
  assert.throws(() => importDate("31/01/2024", "MDY"));
});
test("CSV exports neutralize spreadsheet formula text while preserving signed amounts", () => {
  const d = setup();
  d.entries = [entry({ payee: '=HYPERLINK("bad")', note: "@command" })];
  const csv = exportCSV(d);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'@command/);
  assert.match(csv, /"-20.00"/);
});

test("excluded savings and investments stay out of spending cash, including transfers", () => {
  const d = setup();
  d.accounts[1].includeInForecast = false;
  d.accounts.push({
    id: "invested",
    name: "Investment",
    type: "Investment",
    openingCents: 40000,
    openingDate: "2020-01-01",
  });
  assert.equal(balance(d, "2024-02-01"), 190000);
  const transfer = entry({
    type: "transfer",
    categoryId: "",
    amountCents: 30000,
    date: "2024-02-02",
    toAccountId: "savings",
  });
  d.entries = [transfer];
  const f = forecast(d, 3, "all", "2024-02-01");
  assert.equal(f.points[0].cents, 100000);
  assert.equal(f.points[1].cents, 70000);
  assert.equal(balance(d, "2024-02-03"), 190000);
});
