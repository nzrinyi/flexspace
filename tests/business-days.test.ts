import test from "node:test";
import assert from "node:assert/strict";
import { businessDate, canadianBankHolidays } from "../src/budget/businessDays";
import { occurrenceDates, type Recurring } from "../src/budget/model";
test("first-of-month postings roll weekends and Canadian bank holidays forward", () => {
  assert.equal(businessDate("2026-11-01", "weekdays"), "2026-11-02");
  assert.equal(businessDate("2027-01-01", "canada-on"), "2027-01-04");
  assert.equal(businessDate("2026-12-01", "canada-on"), "2026-12-01");
});
test("Christmas and Boxing Day substitute days remain distinct", () => {
  const h = canadianBankHolidays(2021);
  assert.ok(h.has("2021-12-27"));
  assert.ok(h.has("2021-12-28"));
  assert.equal(businessDate("2021-12-25", "canada-on"), "2021-12-29");
});
test("business day adjustment preserves the original recurrence anchor", () => {
  const r: Recurring = {
    id: "bill",
    accountId: "one",
    type: "expense",
    amountCents: 100,
    payee: "Bill",
    categoryId: "c",
    frequency: "monthly",
    startDate: "2026-12-01",
    endDate: "",
    active: true,
    businessDay: "canada-on",
  };
  assert.deepEqual(occurrenceDates(r, "2026-12-01", "2027-02-02"), [
    "2026-12-01",
    "2027-01-04",
    "2027-02-01",
  ]);
});
