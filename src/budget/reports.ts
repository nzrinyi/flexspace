import {
  addDays,
  balance,
  categoryLimit,
  dateObject,
  dueItems,
  localDate,
  monthTotals,
  nextMonth,
  TODAY,
  type BudgetData,
} from "./model";
export const REPORT_WIDGETS = [
  "netWorth",
  "cashFlow",
  "comparisons",
  "categories",
  "calendar",
] as const;
export function reportData(data: BudgetData, month: string, today = TODAY()) {
  const year = today.slice(0, 4),
    start = year + "-01-01";
  const ytd = data.entries.filter(
    (e) => e.type !== "transfer" && e.date >= start && e.date <= today,
  );
  const income = ytd
    .filter((e) => e.type === "income")
    .reduce((s, e) => s + e.amountCents, 0);
  const expenses = ytd.filter((e) => e.type === "expense");
  const spent = expenses.reduce((s, e) => s + e.amountCents, 0);
  const months = new Set(ytd.map((e) => e.date.slice(0, 7))).size;
  const first = month + "-01",
    last = addDays(nextMonth(month, 1) + "-01", -1),
    until = last < today ? last : today;
  const actual = monthTotals(data, month, today),
    previous = monthTotals(data, nextMonth(month, -1), today);
  const trends = Array.from({ length: 4 }, (_, i) =>
    nextMonth(month, i - 3),
  ).flatMap((m) => {
    const date = addDays(nextMonth(m, 1) + "-01", -1),
      asOf = date < today ? date : today;
    return m > today.slice(0, 7) ||
      !data.accounts.some((a) => a.openingDate <= asOf)
      ? []
      : [{ date: asOf, cents: balance(data, asOf) }];
  });
  const days =
    until >= first
      ? Math.round(
          (dateObject(until).getTime() - dateObject(first).getTime()) /
            86400000,
        ) + 1
      : 0;
  let cash = 0;
  const flow = Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    cash += data.entries
      .filter((e) => e.date === date && e.type !== "transfer")
      .reduce((s, e) => s + (e.type === "income" ? 1 : -1) * e.amountCents, 0);
    return { date, cents: cash };
  });
  const priorMonths = Array.from({ length: 3 }, (_, i) =>
    nextMonth(month, i - 3),
  );
  const average = Math.round(
    priorMonths.reduce((sum, m) => sum + monthTotals(data, m, today).spent, 0) /
      3,
  );
  const calendarMonths = Array.from({ length: 4 }, (_, i) =>
    nextMonth(month, i - 3),
  );
  const calendarStart = calendarMonths[0] + "-01";
  const due = dueItems(data, last).filter((d) => d.date >= calendarStart);
  const categories = data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      category: c,
      planned: categoryLimit(data, c.id, month),
      actual: data.entries
        .filter(
          (e) =>
            e.type === "expense" &&
            e.categoryId === c.id &&
            e.date.startsWith(month) &&
            e.date <= today,
        )
        .reduce((sum, e) => sum + e.amountCents, 0),
    }));
  return {
    year,
    income,
    spent,
    averageMonthly: months ? Math.round(spent / months) : 0,
    averageTransaction: expenses.length
      ? Math.round(spent / expenses.length)
      : 0,
    activityCount: ytd.length,
    actual,
    previous,
    trends,
    flow,
    average,
    categories,
    calendarMonths,
    calendarStart,
    calendarEnd: last,
    due,
  };
}
export function monthDays(month: string) {
  const first = month + "-01",
    start = dateObject(first);
  const count = new Date(
    start.getFullYear(),
    start.getMonth() + 1,
    0,
  ).getDate();
  return {
    offset: start.getDay(),
    dates: Array.from({ length: count }, (_, i) =>
      localDate(new Date(start.getFullYear(), start.getMonth(), i + 1, 12)),
    ),
  };
}
