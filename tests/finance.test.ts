import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFinance,
  DEFAULT_FINANCE,
  resolveFinance,
  localDate,
} from "../src/domain/finance";
import { VEHICLES } from "../src/vehicles";
import type { DealQuoteDocument } from "../src/types";
const quote: DealQuoteDocument = {
  id: "offer",
  vehicleId: "crv",
  dealer: "Dealer",
  trim: "Test",
  price: 40000,
  discount: 1000,
  fees: 2000,
  accessories: 500,
  tradeIn: 0,
  financeRate: 3,
  leaseRate: 4,
  expiryDate: "",
  contact: "",
  listingUrl: "",
};
test("taxes and fees are applied exactly once to a raw quote", () => {
  const r = resolveFinance(VEHICLES[0], [quote], DEFAULT_FINANCE, {
    source: "quote",
    sourceId: "offer",
  });
  assert.equal(r.outTheDoor, 46895);
  assert.equal(r.principal, r.outTheDoor - 5000);
  assert.equal(r.rate, DEFAULT_FINANCE.rate);
});
test("zero interest, full down payment and invalid inputs remain finite", () => {
  const r = calculateFinance(
    { price: 12000, fees: 0 },
    { ...DEFAULT_FINANCE, rate: 0, taxRate: 0, downPayment: 0, termMonths: 12 },
  );
  assert.equal(r.payment, 1000);
  assert.equal(
    calculateFinance(
      { price: 1000, fees: 0 },
      { ...DEFAULT_FINANCE, downPayment: 10000 },
    ).payment,
    0,
  );
  const invalid = calculateFinance(
    { price: NaN, fees: -50 },
    { ...DEFAULT_FINANCE, termMonths: 0, rate: -2 },
  );
  assert.ok(Number.isFinite(invalid.ownership));
});
test("expired and archived quotes are excluded; explicit missing quote falls back to MSRP", () => {
  const expired = { ...quote, expiryDate: "2000-01-01" };
  assert.equal(resolveFinance(VEHICLES[0], [expired]).source, "MSRP estimate");
  assert.equal(
    resolveFinance(VEHICLES[0], [{ ...quote, archived: true }]).source,
    "MSRP estimate",
  );
  assert.equal(
    resolveFinance(VEHICLES[0], [quote], DEFAULT_FINANCE, {
      source: "quote",
      sourceId: "missing",
    }).price,
    VEHICLES[0].msrp,
  );
});
test("custom scenarios preserve raw amounts and reproduce totals", () => {
  const a = resolveFinance(VEHICLES[0], [quote], DEFAULT_FINANCE);
  const b = resolveFinance(VEHICLES[0], [], DEFAULT_FINANCE, {
    source: "custom",
    price: a.price,
    fees: a.fees,
    discount: a.discount,
    accessories: a.accessories,
    tradeIn: a.tradeIn,
  });
  assert.equal(a.outTheDoor, b.outTheDoor);
  assert.equal(a.ownership, b.ownership);
});
test("dealer trade-in credit reduces taxable amount and financed balance", () => {
  const r = calculateFinance({ ...quote, tradeIn: 10000 }, DEFAULT_FINANCE);
  assert.equal(r.tax, 31500 * 0.13);
  assert.equal(r.principal, r.outTheDoor - 15000);
});
test("annual kilometres change energy and ownership costs consistently", () => {
  const a = resolveFinance(VEHICLES[0], [], {
    ...DEFAULT_FINANCE,
    annualKm: 10000,
  });
  const b = resolveFinance(VEHICLES[0], [], {
    ...DEFAULT_FINANCE,
    annualKm: 20000,
  });
  assert.equal(b.energy, a.energy * 2);
  assert.equal(b.payment, a.payment);
});
test("local date uses calendar components rather than UTC slicing", () => {
  const d = new Date(2026, 0, 2, 23, 55);
  assert.equal(localDate(d), "2026-01-02");
});
