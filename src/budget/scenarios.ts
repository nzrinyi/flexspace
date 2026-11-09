import {
  addDays,
  categoryLimit,
  dateObject,
  dueItems,
  forecast,
  nextMonth,
  occurrenceDates,
  TODAY,
  type BudgetData,
  type BudgetScenario,
  type Recurring,
} from "./model";

export function newScenario(data: BudgetData): BudgetScenario {
  return {
    id: crypto.randomUUID(),
    name: "What if plan",
    days: 365,
    reserveCents: data.reserveCents,
    includeSpending: true,
    spendingPercent: 100,
    overrides: [],
    events: [],
  };
}

// Pure projections never create ledger entries or change the original budget.
export function projectScenario(
  data: BudgetData,
  scenario: BudgetScenario,
  today = TODAY(),
  baseline = false,
) {
  const source: BudgetData = {
    ...data,
    recurring: data.recurring.map((rule) => {
      const override =
        !baseline && scenario.overrides.find((o) => o.recurringId === rule.id);
      return override
        ? {
            ...rule,
            amountCents: override.amountCents,
            active: override.active && rule.dateConfirmed !== false,
          }
        : rule;
    }),
  };
  const base = forecast(source, scenario.days, "all", today);
  const end = addDays(today, scenario.days);
  const changes = new Map<string, number>();
  const add = (date: string, cents: number) =>
    changes.set(date, (changes.get(date) ?? 0) + cents);
  if (!baseline)
    for (const event of scenario.events) {
      const account = data.accounts.find((a) => a.id === event.accountId);
      if (
        !account ||
        account.includeInForecast === false ||
        account.type === "Investment"
      )
        continue;
      const dates =
        event.frequency === "once"
          ? [event.date]
          : occurrenceDates(
              {
                ...event,
                startDate: event.date,
                payee: event.name,
                frequency: event.frequency,
                categoryId: "",
                active: true,
              } as Recurring,
              today,
              end,
            );
      for (const date of dates)
        if (date >= today && date <= end)
          add(date, event.amountCents * (event.type === "income" ? 1 : -1));
    }
  const monthEnd = addDays(nextMonth(end.slice(0, 7), 1) + "-01", -1);
  const plannedBills = dueItems(data, monthEnd).filter((d) =>
    data.accounts.some(
      (a) =>
        a.id === d.rule.accountId &&
        a.includeInForecast !== false &&
        a.type !== "Investment",
    ),
  );
  let plannedSpendingCents = 0;
  if (scenario.includeSpending) {
    for (
      let first = today.slice(0, 7) + "-01";
      first <= end;
      first = nextMonth(first.slice(0, 7), 1) + "-01"
    ) {
      const month = first.slice(0, 7),
        last = addDays(nextMonth(month, 1) + "-01", -1);
      const start = first < today ? today : first;
      const count =
        Math.round(
          (dateObject(last).getTime() - dateObject(start).getTime()) / 86400000,
        ) + 1;
      for (const category of data.categories.filter(
        (c) => c.kind === "expense",
      )) {
        const target = categoryLimit(data, category.id, month);
        // Recorded and known scheduled expenses already consume this category's plan.
        const recorded = source.entries
          .filter(
            (e) =>
              e.type === "expense" &&
              e.categoryId === category.id &&
              e.date.startsWith(month),
          )
          .reduce((sum, e) => sum + e.amountCents, 0);
        const scheduled = plannedBills
          .filter(
            (d) =>
              d.rule.type === "expense" &&
              d.rule.categoryId === category.id &&
              (d.date < today ? today : d.date).startsWith(month),
          )
          .reduce((sum, d) => sum + d.rule.amountCents, 0);
        const remainder = Math.round(
          (Math.max(0, target - recorded - scheduled) *
            (baseline ? 100 : scenario.spendingPercent)) /
            100,
        );
        for (let i = 0; i < count; i++) {
          const date = addDays(start, i);
          if (date > end) break;
          // Integer allocation totals exactly to the remaining monthly budget.
          const cents =
            Math.floor((remainder * (i + 1)) / count) -
            Math.floor((remainder * i) / count);
          add(date, -cents);
          plannedSpendingCents += cents;
        }
      }
    }
  }
  let cumulative = 0;
  const points = base.points.map((p) => {
    const extra = changes.get(p.date) ?? 0;
    cumulative += extra;
    return {
      ...p,
      cents: p.cents + cumulative,
      changeCents: p.changeCents + extra,
    };
  });
  const low = points.reduce(
    (min, p) => (p.cents < min.cents ? p : min),
    points[0],
  );
  const firstShortfall = points.find((p) => p.cents < 0)?.date;
  const months = Array.from(new Set(points.map((p) => p.date.slice(0, 7)))).map(
    (month) => {
      const days = points.filter((p) => p.date.startsWith(month));
      return {
        month,
        endDate: days[days.length - 1].date,
        closingCents: days[days.length - 1].cents,
      };
    },
  );
  return {
    points,
    low,
    firstShortfall,
    months,
    closingCents: points[points.length - 1].cents,
    plannedSpendingCents,
  };
}
