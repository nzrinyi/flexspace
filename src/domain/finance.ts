import type {
  DealQuoteDocument,
  VehicleReference,
  ScoredVehicle,
} from "../types";

export interface FinanceSettings {
  downPayment: number;
  rate: number;
  termMonths: number;
  fees: number;
  taxRate: number;
  insurance: number;
  maintenance: number;
  annualKm: number;
  fuelPrice: number;
  electricityPrice: number;
}
export interface PurchaseSelection {
  source: "auto" | "msrp" | "trim" | "quote" | "custom";
  sourceId?: string;
  price?: number;
  fees?: number;
  discount?: number;
  accessories?: number;
  tradeIn?: number;
  consumption?: number;
}
export interface FinanceResult {
  price: number;
  fees: number;
  discount: number;
  accessories: number;
  tradeIn: number;
  tax: number;
  outTheDoor: number;
  principal: number;
  payment: number;
  interest: number;
  energy: number;
  ownership: number;
  rate: number;
  source: string;
}
export const DEFAULT_FINANCE: FinanceSettings = {
  downPayment: 5000,
  rate: 5.99,
  termMonths: 60,
  fees: 2495,
  taxRate: 13,
  insurance: 180,
  maintenance: 85,
  annualKm: 15000,
  fuelPrice: 1.6,
  electricityPrice: 0.16,
};
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function activeQuotes(quotes: DealQuoteDocument[], vehicleId?: string) {
  return quotes.filter(
    (q) =>
      !q.archived &&
      (!vehicleId || q.vehicleId === vehicleId) &&
      (!q.expiryDate || q.expiryDate >= localDate()),
  );
}
const positive = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
export function calculateFinance(
  input: {
    price: number;
    fees: number;
    discount?: number;
    accessories?: number;
    tradeIn?: number;
    consumption?: number;
    electric?: boolean;
  },
  settings: FinanceSettings,
): FinanceResult {
  const price = positive(input.price),
    fees = positive(input.fees),
    discount = positive(input.discount ?? 0),
    accessories = positive(input.accessories ?? 0),
    tradeIn = positive(input.tradeIn ?? 0);
  // Ontario-style dealer trade-in credit; display this assumption in the calculator.
  const taxable = Math.max(0, price + fees + accessories - discount - tradeIn);
  const tax = (taxable * positive(settings.taxRate)) / 100;
  const outTheDoor = Math.max(0, price + fees + accessories - discount + tax);
  const principal = Math.max(
    0,
    outTheDoor - tradeIn - positive(settings.downPayment),
  );
  const months = Math.max(1, Math.round(positive(settings.termMonths))),
    rate = positive(settings.rate),
    r = rate / 1200;
  const payment =
    r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
  const energy =
    (positive(settings.annualKm) / 1200) *
    positive(input.consumption ?? 8) *
    positive(input.electric ? settings.electricityPrice : settings.fuelPrice);
  return {
    price,
    fees,
    discount,
    accessories,
    tradeIn,
    tax,
    outTheDoor,
    principal,
    payment,
    interest: Math.max(0, payment * months - principal),
    energy,
    ownership:
      payment +
      energy +
      positive(settings.insurance) +
      positive(settings.maintenance),
    rate,
    source: "Estimate",
  };
}
export function resolveFinance(
  vehicle: VehicleReference,
  quotes: DealQuoteDocument[],
  settings = DEFAULT_FINANCE,
  selection: PurchaseSelection = { source: "auto" },
): FinanceResult {
  const eligible = activeQuotes(quotes, vehicle.id);
  const cost = (q: DealQuoteDocument) =>
    calculateFinance(q, settings).outTheDoor;
  const quote =
    selection.source === "quote"
      ? eligible.find((q) => q.id === selection.sourceId)
      : selection.source === "auto"
        ? [...eligible].sort((a, b) => cost(a) - cost(b))[0]
        : undefined;
  const trim =
    selection.source === "trim"
      ? vehicle.trimOptions?.find((t) => t.name === selection.sourceId)
      : undefined;
  const electric = (trim?.powertrain ?? vehicle.powertrain) === "Electric";
  const consumption =
    selection.consumption ??
    (Number(vehicle.fuelEfficiency.match(/(\d+(?:\.\d+)?)\s*L\//)?.[1]) ||
      (electric ? 20 : vehicle.powertrain.includes("Hybrid") ? 6.5 : 9));
  const input = quote ?? {
    price:
      selection.source === "custom"
        ? (selection.price ?? vehicle.msrp)
        : (trim?.price ?? vehicle.msrp),
    fees: selection.fees ?? settings.fees,
    discount: selection.discount,
    accessories: selection.accessories,
    tradeIn: selection.tradeIn,
  };
  // Use the same household rate for every scenario; choosing "Use quote rate" is explicit in the UI.
  return {
    ...calculateFinance({ ...input, consumption, electric }, settings),
    source: quote
      ? `${quote.dealer || "Dealer"} · ${quote.trim || "saved quote"}`
      : trim
        ? `${trim.name} · catalogue estimate`
        : selection.source === "custom"
          ? "Custom estimate"
          : "MSRP estimate",
  };
}
export function vehicleFinance(
  vehicle: ScoredVehicle,
  quotes: DealQuoteDocument[] = [],
) {
  return vehicle.financials ?? resolveFinance(vehicle, quotes);
}
export function actualVehiclePrice(
  vehicle: ScoredVehicle,
  quotes: DealQuoteDocument[],
) {
  return Math.round(vehicleFinance(vehicle, quotes).outTheDoor);
}
export function actualVehiclePriceLabel(
  vehicle: ScoredVehicle,
  quotes: DealQuoteDocument[],
) {
  return vehicleFinance(vehicle, quotes).source;
}
export function estimateMonthlyPayment(vehicle: ScoredVehicle) {
  return Math.round(vehicleFinance(vehicle).ownership);
}
export function quoteNetPrice(quote: DealQuoteDocument) {
  return calculateFinance(quote, DEFAULT_FINANCE).outTheDoor;
}
export function money(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
