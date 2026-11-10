import { businessDate, type BusinessDayPolicy } from "./businessDays";
export type AccountType =
  | "Checking"
  | "Savings"
  | "Credit card"
  | "Cash"
  | "Investment";
export type EntryType = "income" | "expense" | "transfer";
export type Frequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingCents: number;
  openingDate: string;
  balanceConfirmed?: boolean;
  includeInForecast?: boolean;
}
export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  defaultLimitCents: number;
  group?: string;
  note?: string;
}
export interface Entry {
  id: string;
  accountId: string;
  toAccountId?: string;
  type: EntryType;
  amountCents: number;
  date: string;
  payee: string;
  categoryId: string;
  note: string;
  cleared: boolean;
  recurringId?: string;
  occurrenceDate?: string;
}
export interface Recurring {
  id: string;
  accountId: string;
  type: "income" | "expense";
  amountCents: number;
  payee: string;
  categoryId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string;
  active: boolean;
  dateConfirmed?: boolean;
  businessDay?: BusinessDayPolicy;
}
export interface Plan {
  month: string;
  categoryId: string;
  limitCents: number;
}
export interface ScenarioEvent {
  id: string;
  name: string;
  accountId: string;
  type: "income" | "expense";
  amountCents: number;
  date: string;
  frequency: "once" | Frequency;
  endDate: string;
}
export interface BudgetScenario {
  id: string;
  name: string;
  days: number;
  reserveCents: number;
  includeSpending: boolean;
  spendingPercent: number;
  overrides: Array<{
    recurringId: string;
    amountCents: number;
    active: boolean;
  }>;
  events: ScenarioEvent[];
}
export interface BudgetData {
  version: 1;
  revision: number;
  currency: "CAD" | "USD" | "GBP" | "EUR";
  reserveCents: number;
  accounts: Account[];
  categories: Category[];
  entries: Entry[];
  recurring: Recurring[];
  skipped: string[];
  plans: Plan[];
  scenarios?: BudgetScenario[];
  reportWidgets?: string[];
}
import {
  TODAY,
  localDate,
  dateObject,
  validDate,
  addDays,
  nextMonth,
  displayDate,
} from "./dates";
export {
  TODAY,
  localDate,
  dateObject,
  validDate,
  addDays,
  nextMonth,
  displayDate,
} from "./dates";
export function money(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
export function parseMoney(value: string, signed = false) {
  const raw = value.trim().replace(/[,$£€\s]/g, "");
  const normalized = /^\(.*\)$/.test(raw) ? `-${raw.slice(1, -1)}` : raw;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Enter a valid amount with at most two decimal places.");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const cents =
    (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) *
    (normalized.startsWith("-") ? -1 : 1);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(cents) > 100000000000 ||
    (!signed && cents <= 0)
  )
    throw new Error(
      signed
        ? "Amount is outside the supported range."
        : "Amount must be greater than zero.",
    );
  return cents;
}
export function emptyBudget(): BudgetData {
  const labels = [
    "Housing",
    "Groceries",
    "Utilities",
    "Transport",
    "Dining out",
    "Shopping",
    "Health",
    "Entertainment",
    "Other",
  ];
  const colors = [
    "#525dcc",
    "#258574",
    "#b2812d",
    "#447ca3",
    "#b55b76",
    "#7e66b5",
    "#639159",
    "#c17c4f",
    "#778596",
  ];
  return {
    version: 1,
    revision: 0,
    currency: "CAD",
    reserveCents: 0,
    accounts: [],
    entries: [],
    recurring: [],
    skipped: [],
    plans: [],
    categories: [
      ...labels.map((name, i) => ({
        id: `category-${i}`,
        name,
        kind: "expense" as const,
        color: colors[i],
        defaultLimitCents: 0,
      })),
      {
        id: "salary",
        name: "Salary",
        kind: "income",
        color: "#258574",
        defaultLimitCents: 0,
      },
      {
        id: "other-income",
        name: "Other income",
        kind: "income",
        color: "#447ca3",
        defaultLimitCents: 0,
      },
    ],
  };
}
export function validateEntry(entry: Entry, data: BudgetData) {
  if (
    !entry.id ||
    !entry.payee.trim() ||
    entry.payee.length > 150 ||
    entry.note.length > 2000
  )
    throw new Error(
      "Add a description (up to 150 characters) and keep notes under 2,000 characters.",
    );
  const account = data.accounts.find((a) => a.id === entry.accountId);
  if (!account) throw new Error("Choose an existing account.");
  if (!validDate(entry.date) || entry.date < account.openingDate)
    throw new Error(
      `Transaction date must be on or after the account’s opening date (${account.openingDate}).`,
    );
  if (
    !Number.isSafeInteger(entry.amountCents) ||
    entry.amountCents <= 0 ||
    entry.amountCents > 100000000000
  )
    throw new Error("Enter a positive amount within the supported range.");
  if (!["income", "expense", "transfer"].includes(entry.type))
    throw new Error("Choose income, expense, or transfer.");
  if (entry.type === "transfer") {
    const target = data.accounts.find((a) => a.id === entry.toAccountId);
    if (!target || target.id === account.id || entry.date < target.openingDate)
      throw new Error(
        "Choose a different destination account with an opening date on or before this transfer.",
      );
    if (entry.recurringId)
      throw new Error(
        "Transfers cannot be matched to a recurring income or bill.",
      );
  } else if (
    !data.categories.some(
      (c) => c.id === entry.categoryId && c.kind === entry.type,
    )
  )
    throw new Error("Choose a category that matches this transaction type.");
  if (entry.recurringId) {
    const rule = data.recurring.find((r) => r.id === entry.recurringId);
    if (
      !rule ||
      rule.accountId !== entry.accountId ||
      rule.type !== entry.type ||
      !validDate(entry.occurrenceDate) ||
      !occurrenceDates(rule, entry.occurrenceDate, entry.occurrenceDate).length
    )
      throw new Error(
        "Choose a matching recurring item and a valid scheduled due date.",
      );
    if (
      data.entries.some(
        (e) =>
          e.id !== entry.id &&
          e.recurringId === entry.recurringId &&
          e.occurrenceDate === entry.occurrenceDate,
      )
    )
      throw new Error(
        "That recurring occurrence already has a recorded transaction. Edit the existing transaction instead.",
      );
  }
}
export function validateBudget(value: unknown): BudgetData {
  if (!value || typeof value !== "object")
    throw new Error("This is not a FlowBudget backup.");
  const d = value as BudgetData;
  if (d.version !== 1 || !["CAD", "USD", "GBP", "EUR"].includes(d.currency))
    throw new Error("Unsupported backup version or currency.");
  for (const key of [
    "accounts",
    "categories",
    "entries",
    "recurring",
    "skipped",
    "plans",
  ] as const)
    if (!Array.isArray(d[key]))
      throw new Error(`Missing ${key} in budget data.`);
  if (
    d.accounts.length > 100 ||
    d.categories.length > 500 ||
    d.entries.length > 20000 ||
    d.recurring.length > 500 ||
    d.skipped.length > 20000 ||
    d.plans.length > 10000
  )
    throw new Error("Budget exceeds supported data limits.");
  const cents = (n: unknown) =>
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    Math.abs(n) <= 100000000000;
  const text = (s: unknown, max = 150) =>
    typeof s === "string" && s.length <= max;
  if (
    !cents(d.reserveCents) ||
    d.reserveCents < 0 ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0
  )
    throw new Error("Invalid reserve or revision.");
  for (const key of [
    "accounts",
    "categories",
    "entries",
    "recurring",
  ] as const) {
    const ids = d[key].map((x) => x?.id);
    if (
      ids.some((id) => !text(id, 100) || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new Error(`Invalid or duplicate ${key} identifiers.`);
  }
  for (const a of d.accounts)
    if (
      !text(a.name) ||
      !a.name.trim() ||
      !["Checking", "Savings", "Credit card", "Cash", "Investment"].includes(
        a.type,
      ) ||
      !cents(a.openingCents) ||
      !validDate(a.openingDate) ||
      a.openingDate > TODAY() ||
      (a.balanceConfirmed !== undefined &&
        typeof a.balanceConfirmed !== "boolean") ||
      (a.includeInForecast !== undefined &&
        typeof a.includeInForecast !== "boolean")
    )
      throw new Error("Invalid account or future opening date.");
  for (const c of d.categories)
    if (
      !text(c.name) ||
      !c.name.trim() ||
      !["income", "expense"].includes(c.kind) ||
      !/^#[0-9a-f]{6}$/i.test(c.color) ||
      !cents(c.defaultLimitCents) ||
      c.defaultLimitCents < 0 ||
      (c.group !== undefined && !text(c.group, 30)) ||
      (c.note !== undefined && !text(c.note, 500))
    )
      throw new Error("Invalid category.");
  for (const r of d.recurring) {
    const a = d.accounts.find((a) => a.id === r.accountId);
    if (
      !a ||
      !text(r.payee) ||
      !r.payee.trim() ||
      !["income", "expense"].includes(r.type) ||
      !cents(r.amountCents) ||
      r.amountCents <= 0 ||
      !["weekly", "biweekly", "monthly", "quarterly", "yearly"].includes(
        r.frequency,
      ) ||
      !validDate(r.startDate) ||
      r.startDate < a.openingDate ||
      typeof r.active !== "boolean" ||
      (r.dateConfirmed !== undefined && typeof r.dateConfirmed !== "boolean") ||
      (r.businessDay !== undefined &&
        !["none", "weekdays", "canada-on"].includes(r.businessDay)) ||
      (r.active && r.dateConfirmed === false) ||
      (r.endDate !== "" &&
        (!validDate(r.endDate) || r.endDate < r.startDate)) ||
      !d.categories.some((c) => c.id === r.categoryId && c.kind === r.type)
    )
      throw new Error("Invalid recurring bill or income.");
  }
  for (const e of d.entries) {
    if (typeof e.cleared !== "boolean" || !text(e.note, 2000) || !text(e.payee))
      throw new Error("Invalid transaction.");
    validateEntry(e, d);
  }
  if (d.skipped.some((s) => typeof s !== "string" || s.length > 120))
    throw new Error("Invalid skipped occurrences.");
  const planKeys = new Set<string>();
  for (const p of d.plans) {
    const key = `${p.month}:${p.categoryId}`;
    if (
      planKeys.has(key) ||
      !/^\d{4}-\d{2}$/.test(p.month) ||
      !validDate(`${p.month}-01`) ||
      !d.categories.some((c) => c.id === p.categoryId) ||
      !cents(p.limitCents) ||
      p.limitCents < 0
    )
      throw new Error("Invalid monthly category plan.");
    planKeys.add(key);
  }
  if (d.scenarios !== undefined) {
    if (!Array.isArray(d.scenarios) || d.scenarios.length > 50)
      throw new Error("Keep at most 50 saved scenarios.");
    const scenarioIds = new Set<string>();
    for (const scenario of d.scenarios) {
      if (
        !scenario ||
        !text(scenario.id, 100) ||
        !scenario.id ||
        scenarioIds.has(scenario.id) ||
        !text(scenario.name, 100) ||
        !scenario.name.trim() ||
        !Number.isInteger(scenario.days) ||
        scenario.days < 30 ||
        scenario.days > 730 ||
        !cents(scenario.reserveCents) ||
        scenario.reserveCents < 0 ||
        typeof scenario.includeSpending !== "boolean" ||
        !Number.isInteger(scenario.spendingPercent) ||
        scenario.spendingPercent < 0 ||
        scenario.spendingPercent > 300 ||
        !Array.isArray(scenario.overrides) ||
        scenario.overrides.length > 500 ||
        !Array.isArray(scenario.events) ||
        scenario.events.length > 100
      )
        throw new Error("Invalid saved scenario.");
      scenarioIds.add(scenario.id);
      const overrideIds = new Set<string>();
      for (const o of scenario.overrides) {
        if (
          !o ||
          !text(o.recurringId, 100) ||
          !o.recurringId ||
          overrideIds.has(o.recurringId) ||
          !cents(o.amountCents) ||
          o.amountCents <= 0 ||
          typeof o.active !== "boolean"
        )
          throw new Error("Invalid recurring scenario change.");
        overrideIds.add(o.recurringId);
      }
      const eventIds = new Set<string>();
      for (const event of scenario.events) {
        const account = d.accounts.find((a) => a.id === event?.accountId);
        if (
          !event ||
          !text(event.id, 100) ||
          !event.id ||
          eventIds.has(event.id) ||
          !text(event.name) ||
          !event.name.trim() ||
          !account ||
          !["income", "expense"].includes(event.type) ||
          !cents(event.amountCents) ||
          event.amountCents <= 0 ||
          !validDate(event.date) ||
          event.date < account.openingDate ||
          ![
            "once",
            "weekly",
            "biweekly",
            "monthly",
            "quarterly",
            "yearly",
          ].includes(event.frequency) ||
          (event.endDate !== "" &&
            (!validDate(event.endDate) || event.endDate < event.date))
        )
          throw new Error(
            "Invalid scenario event. Check its account, amount and dates.",
          );
        eventIds.add(event.id);
      }
    }
  }
  if (
    d.reportWidgets !== undefined &&
    (!Array.isArray(d.reportWidgets) ||
      new Set(d.reportWidgets).size !== d.reportWidgets.length ||
      d.reportWidgets.some(
        (w) =>
          ![
            "netWorth",
            "cashFlow",
            "comparisons",
            "categories",
            "calendar",
          ].includes(w),
      ))
  )
    throw new Error("Invalid reports dashboard layout.");
  // Retain only the known top-level schema. Unknown fields never become app configuration.
  return {
    version: 1,
    revision: d.revision,
    currency: d.currency,
    reserveCents: d.reserveCents,
    accounts: d.accounts,
    categories: d.categories,
    entries: d.entries,
    recurring: d.recurring,
    skipped: d.skipped,
    plans: d.plans,
    ...(d.reportWidgets === undefined
      ? {}
      : { reportWidgets: d.reportWidgets }),
    ...(d.scenarios === undefined ? {} : { scenarios: d.scenarios }),
  };
}
export function occurrenceDates(
  rule: Recurring,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  const start = dateObject(rule.startDate);
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  for (let i = 0; i < 6000; i++) {
    let date: string;
    if (rule.frequency === "weekly" || rule.frequency === "biweekly")
      date = addDays(
        rule.startDate,
        i * (rule.frequency === "weekly" ? 7 : 14),
      );
    else {
      const months =
        i *
        (rule.frequency === "yearly"
          ? 12
          : rule.frequency === "quarterly"
            ? 3
            : 1);
      const base = new Date(
        start.getFullYear(),
        start.getMonth() + months,
        1,
        12,
      );
      const last = new Date(
        base.getFullYear(),
        base.getMonth() + 1,
        0,
      ).getDate();
      base.setDate(Math.min(start.getDate(), last));
      date = localDate(base);
    }
    if (date > end) break;
    const posting = businessDate(date, rule.businessDay);
    if (posting >= from && posting <= to) out.push(posting);
  }
  return out;
}
export function entryDelta(entry: Entry, accountId = "all") {
  if (entry.type === "transfer")
    return accountId === "all"
      ? 0
      : entry.accountId === accountId
        ? -entry.amountCents
        : entry.toAccountId === accountId
          ? entry.amountCents
          : 0;
  return accountId !== "all" && entry.accountId !== accountId
    ? 0
    : entry.amountCents * (entry.type === "income" ? 1 : -1);
}
export function balance(data: BudgetData, date = TODAY(), accountId = "all") {
  return (
    data.accounts
      .filter(
        (a) =>
          (accountId === "all" || a.id === accountId) && a.openingDate <= date,
      )
      .reduce((s, a) => s + a.openingCents, 0) +
    data.entries
      .filter((e) => e.date <= date)
      .reduce((s, e) => s + entryDelta(e, accountId), 0)
  );
}
export function cashDelta(data: BudgetData, entry: Entry, accountId = "all") {
  if (accountId !== "all") return entryDelta(entry, accountId);
  const included = (id: string | undefined) =>
    data.accounts.some(
      (a) =>
        a.id === id && a.includeInForecast !== false && a.type !== "Investment",
    );
  if (entry.type === "transfer")
    return (
      (included(entry.toAccountId) ? entry.amountCents : 0) -
      (included(entry.accountId) ? entry.amountCents : 0)
    );
  return included(entry.accountId) ? entryDelta(entry) : 0;
}
export function cashBalance(
  data: BudgetData,
  date = TODAY(),
  accountId = "all",
) {
  return (
    data.accounts
      .filter(
        (a) =>
          (accountId === "all"
            ? a.includeInForecast !== false && a.type !== "Investment"
            : a.id === accountId) && a.openingDate <= date,
      )
      .reduce((sum, a) => sum + a.openingCents, 0) +
    data.entries
      .filter((e) => e.date <= date)
      .reduce((sum, e) => sum + cashDelta(data, e, accountId), 0)
  );
}
export interface DueItem {
  key: string;
  rule: Recurring;
  date: string;
}
export function dueItems(data: BudgetData, until: string): DueItem[] {
  const posted = new Set(
    data.entries
      .filter((e) => e.recurringId)
      .map((e) => `${e.recurringId}:${e.occurrenceDate}`),
  );
  const skipped = new Set(data.skipped);
  return data.recurring
    .filter((r) => r.active && r.dateConfirmed !== false)
    .flatMap((rule) =>
      occurrenceDates(rule, rule.startDate, until)
        .filter(
          (date) =>
            !posted.has(`${rule.id}:${date}`) &&
            !skipped.has(`${rule.id}:${date}`),
        )
        .map((date) => ({ key: `${rule.id}:${date}`, rule, date })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
export function forecast(
  data: BudgetData,
  days = 90,
  accountId = "all",
  today = TODAY(),
) {
  const due = dueItems(data, addDays(today, days)).filter((d) =>
    accountId === "all"
      ? data.accounts.some(
          (a) =>
            a.id === d.rule.accountId &&
            a.includeInForecast !== false &&
            a.type !== "Investment",
        )
      : d.rule.accountId === accountId,
  );
  const changes = new Map<string, number>();
  for (const entry of data.entries)
    if (entry.date > today && entry.date <= addDays(today, days))
      changes.set(
        entry.date,
        (changes.get(entry.date) ?? 0) + cashDelta(data, entry, accountId),
      );
  for (const item of due) {
    const date = item.date < today ? today : item.date;
    changes.set(
      date,
      (changes.get(date) ?? 0) +
        item.rule.amountCents * (item.rule.type === "income" ? 1 : -1),
    );
  }
  let running = cashBalance(data, today, accountId);
  const points = Array.from({ length: days + 1 }, (_, i) => {
    const date = addDays(today, i),
      changeCents = changes.get(date) ?? 0;
    running += changeCents;
    return { date, cents: running, changeCents };
  });
  const low = points.reduce(
    (min, p) => (p.cents < min.cents ? p : min),
    points[0],
  );
  return {
    points,
    low,
    safeCents: Math.max(0, low.cents - data.reserveCents),
    due,
  };
}
export function monthTotals(data: BudgetData, month: string, until = TODAY()) {
  const entries = data.entries.filter(
    (e) => e.date.startsWith(month) && e.date <= until,
  );
  return {
    income: entries
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + e.amountCents, 0),
    spent: entries
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + e.amountCents, 0),
  };
}
export function categoryLimit(
  data: BudgetData,
  categoryId: string,
  month: string,
) {
  const manual = data.plans.find(
    (p) => p.categoryId === categoryId && p.month === month,
  );
  if (manual) return manual.limitCents;
  const scheduled = scheduledCategoryIncome(data, categoryId, month);
  return (
    scheduled?.cents ??
    data.categories.find((c) => c.id === categoryId)?.defaultLimitCents ??
    0
  );
}
export function scheduledCategoryIncome(
  data: BudgetData,
  categoryId: string,
  month: string,
) {
  const rules = data.recurring.filter(
    (r) =>
      r.categoryId === categoryId &&
      r.type === "income" &&
      r.active &&
      r.dateConfirmed !== false,
  );
  if (!rules.length) return null;
  const from = month + "-01",
    to = addDays(nextMonth(month, 1) + "-01", -1);
  const dates = rules.flatMap((rule) =>
    occurrenceDates(rule, from, to).map((date) => ({ date, rule })),
  );
  return {
    cents: dates.reduce((sum, item) => sum + item.rule.amountCents, 0),
    dates,
    rules,
  };
}
export function categorySpent(
  data: BudgetData,
  categoryId: string,
  month: string,
) {
  return data.entries
    .filter(
      (e) =>
        e.type === "expense" &&
        e.categoryId === categoryId &&
        e.date.startsWith(month) &&
        e.date <= TODAY(),
    )
    .reduce((s, e) => s + e.amountCents, 0);
}
export function removeRecord(
  data: BudgetData,
  kind: "account" | "category" | "recurring" | "entry",
  id: string,
): BudgetData {
  if (kind === "account") {
    if (
      data.entries.some((e) => e.accountId === id || e.toAccountId === id) ||
      data.recurring.some((r) => r.accountId === id)
    )
      throw new Error(
        "This account has transactions or recurring items. Remove or move those first to preserve the ledger.",
      );
    return { ...data, accounts: data.accounts.filter((a) => a.id !== id) };
  }
  if (kind === "category") {
    if (
      data.entries.some((e) => e.categoryId === id) ||
      data.recurring.some((r) => r.categoryId === id)
    )
      throw new Error(
        "This category is in use. Move its transactions and recurring items first.",
      );
    return {
      ...data,
      categories: data.categories.filter((c) => c.id !== id),
      plans: data.plans.filter((p) => p.categoryId !== id),
    };
  }
  if (kind === "recurring")
    return {
      ...data,
      recurring: data.recurring.filter((r) => r.id !== id),
      entries: data.entries.map((e) =>
        e.recurringId === id
          ? { ...e, recurringId: undefined, occurrenceDate: undefined }
          : e,
      ),
      skipped: data.skipped.filter((s) => !s.startsWith(id + ":")),
    };
  return { ...data, entries: data.entries.filter((e) => e.id !== id) };
}
