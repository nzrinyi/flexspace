import {
  cashBalance,
  categoryLimit,
  dateObject,
  localDate,
  nextMonth,
  TODAY,
  type BudgetData,
  type BudgetScenario,
} from "./model";
import { projectScenario } from "./scenarios";

export function monthsAfter(date: string, months: number) {
  const start = dateObject(date);
  const target = new Date(
    start.getFullYear(),
    start.getMonth() + months,
    1,
    12,
  );
  const last = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
    12,
  ).getDate();
  target.setDate(Math.min(start.getDate(), last));
  return localDate(target);
}
export function savingsOutlook(
  data: BudgetData,
  options: {
    today?: string;
    scenario?: BudgetScenario;
    includeUndatedIncome?: boolean;
  } = {},
) {
  const today = options.today ?? TODAY();
  // Liquid balances include tracked savings but exclude investment valuations.
  // This does not change the account selection used for the bill-paying forecast.
  const liquid: BudgetData = {
    ...data,
    accounts: data.accounts.map((a) => ({
      ...a,
      includeInForecast: a.type !== "Investment",
    })),
  };
  const accounts = liquid.accounts.filter((a) => a.type !== "Investment");
  const confirmed =
    accounts.length > 0 && accounts.every((a) => a.balanceConfirmed !== false);
  const startingCents = cashBalance(liquid, today);
  const end = monthsAfter(today, 24);
  const days = Math.round(
    (dateObject(end).getTime() - dateObject(today).getTime()) / 86400000,
  );
  const scenario: BudgetScenario = {
    id: "outlook",
    name: "Current budget",
    reserveCents: data.reserveCents,
    includeSpending: true,
    spendingPercent: 100,
    overrides: [],
    events: [],
    ...options.scenario,
    days,
  };
  const projection = projectScenario(liquid, scenario, today);
  const undatedCategories = data.categories.filter(
    (c) =>
      c.kind === "income" &&
      !data.recurring.some(
        (r) =>
          r.categoryId === c.id &&
          r.type === "income" &&
          r.dateConfirmed !== false,
      ) &&
      (c.defaultLimitCents > 0 ||
        data.plans.some((p) => p.categoryId === c.id && p.limitCents > 0)),
  );
  const additions = new Map<string, number>();
  const next = nextMonth(today.slice(0, 7), 1) + "-01";
  if (options.includeUndatedIncome !== false) {
    // Do not assume whether undated income in the opening-balance month was
    // already received. Start these estimates with the next full month.
    for (
      let first = next;
      first <= end;
      first = nextMonth(first.slice(0, 7), 1) + "-01"
    ) {
      const month = first.slice(0, 7),
        count = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
      for (const category of undatedCategories) {
        const recorded = data.entries
          .filter(
            (e) =>
              e.type === "income" &&
              e.categoryId === category.id &&
              e.date.startsWith(month) &&
              accounts.some((a) => a.id === e.accountId),
          )
          .reduce((sum, e) => sum + e.amountCents, 0);
        const remaining = Math.max(
          0,
          categoryLimit(data, category.id, month) - recorded,
        );
        for (let i = 0; i < count; i++) {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          if (date > end) break;
          const cents =
            Math.floor((remaining * (i + 1)) / count) -
            Math.floor((remaining * i) / count);
          additions.set(date, (additions.get(date) ?? 0) + cents);
        }
      }
    }
  }
  let cumulative = 0;
  const points = projection.points.map((p) => {
    cumulative += additions.get(p.date) ?? 0;
    const balanceCents = p.cents + cumulative;
    return { date: p.date, cents: balanceCents - startingCents, balanceCents };
  });
  const milestones = [6, 12, 24].map((months) => {
    const date = monthsAfter(today, months);
    const point = points.find((p) => p.date === date)!;
    const range = points.filter((p) => p.date <= date);
    return {
      months,
      date,
      addedCents: point.cents,
      balanceCents: point.balanceCents,
      lowCents: Math.min(...range.map((p) => p.balanceCents)),
    };
  });
  return {
    today,
    confirmed,
    startingCents,
    points,
    milestones,
    undatedCategories,
    scenario,
    firstShortfall: points.find((p) => p.balanceCents < 0)?.date,
  };
}
