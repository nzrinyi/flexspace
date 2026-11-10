import { useMemo, useState } from "react";
import {
  displayDate,
  money,
  TODAY,
  type BudgetData,
  type DueItem,
  type Entry,
} from "./model";
import { monthDays, reportData, REPORT_WIDGETS } from "./reports";
function monthLabel(month: string) {
  return new Date(
    +month.slice(0, 4),
    +month.slice(5, 7) - 1,
    1,
  ).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}
const labels = {
  netWorth: "Net worth",
  cashFlow: "Cash flow",
  comparisons: "Monthly comparisons",
  categories: "Budget overview",
  calendar: "Transaction calendar",
};
function Trend({
  points,
  currency,
  label,
}: {
  points: Array<{ date: string; cents: number }>;
  currency: string;
  label: string;
}) {
  if (!points.length)
    return (
      <p className="flow-report-empty">
        No recorded balance history for this period.
      </p>
    );
  const values = points.map((p) => p.cents),
    min = Math.min(...values, 0),
    max = Math.max(...values, 100),
    span = Math.max(max - min, 100);
  const x = (i: number) => 35 + (i / Math.max(1, points.length - 1)) * 530,
    y = (n: number) => 125 - ((n - min) / span) * 100;
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.cents)}`)
    .join(" ");
  return (
    <>
      <svg viewBox="0 0 600 155" role="img" aria-label={label}>
        <line x1="35" x2="565" y1={y(0)} y2={y(0)} stroke="#dce5eb" />
        <path d={path} fill="none" stroke="#267870" strokeWidth="3" />
        {points.length === 1 && (
          <circle cx={x(0)} cy={y(points[0].cents)} r="4" fill="#267870" />
        )}
        <text x="35" y="150">
          {displayDate(points[0].date, true, true)}
        </text>
        <text x="565" y="150" textAnchor="end">
          {displayDate(points[points.length - 1].date, true, true)}
        </text>
      </svg>
      <details className="flow-help">
        <summary>View chart values</summary>
        <div className="flow-report-values">
          {points.map((p) => (
            <span key={p.date}>
              {displayDate(p.date, true, true)}: {money(p.cents, currency)}
            </span>
          ))}
        </div>
      </details>
    </>
  );
}
export function ReportsDashboard({
  data,
  month,
  onSave,
  onEditEntry,
  onRecordDue,
  onBudget,
}: {
  data: BudgetData;
  month: string;
  onSave: (data: BudgetData) => void | Promise<void>;
  onEditEntry: (entry: Entry) => void;
  onRecordDue: (due: DueItem) => void;
  onBudget: () => void;
}) {
  const today = TODAY();
  const report = useMemo(
    () => reportData(data, month, today),
    [data, month, today],
  );
  const fmt = (n: number) => money(n, data.currency);
  const [editing, setEditing] = useState(false),
    [widgets, setWidgets] = useState<string[]>([
      ...(data.reportWidgets ?? REPORT_WIDGETS),
    ]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState(today);
  const shown = data.reportWidgets ?? REPORT_WIDGETS;
  const active =
    selected >= report.calendarStart && selected <= report.calendarEnd
      ? selected
      : report.calendarEnd;
  const entries = data.entries.filter((e) => e.date === active),
    due = report.due.filter((d) => d.date === active);
  async function saveLayout() {
    setSaving(true);
    setError("");
    try {
      await onSave({ ...data, reportWidgets: widgets });
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flow-reports-dashboard">
      <div className="flow-panel-heading">
        <div>
          <h2>Reports dashboard</h2>
          <p>
            Actual activity is based on recorded transactions. Scheduled items
            are marked separately.
          </p>
        </div>
        <div className="flow-action-row">
          <button
            className="flow-button"
            onClick={() => {
              setWidgets([...(data.reportWidgets ?? REPORT_WIDGETS)]);
              setEditing(!editing);
            }}
          >
            Edit dashboard
          </button>
          <button className="flow-button" onClick={() => window.print()}>
            Print report
          </button>
        </div>
      </div>
      {editing && (
        <section className="flow-panel">
          <h3>Dashboard cards</h3>
          <div className="flow-report-layout-options">
            {REPORT_WIDGETS.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={widgets.includes(id)}
                  onChange={(e) =>
                    setWidgets(
                      e.target.checked
                        ? [...widgets, id]
                        : widgets.filter((w) => w !== id),
                    )
                  }
                />
                {labels[id]}
              </label>
            ))}
          </div>
          <button
            className="flow-button primary"
            disabled={saving}
            onClick={() => void saveLayout()}
          >
            {saving ? "Saving…" : "Save dashboard"}
          </button>
          {error && (
            <p role="alert" className="flow-error">
              {error}
            </p>
          )}
        </section>
      )}
      <div className="flow-stats flow-report-kpis">
        {[
          { label: "Total income (YTD)", value: report.income },
          { label: "Total expenses (YTD)", value: report.spent },
          { label: "Average monthly spending", value: report.averageMonthly },
          {
            label: "Average expense transaction",
            value: report.averageTransaction,
          },
        ].map((k) => (
          <article className="flow-stat" key={k.label}>
            <span>{k.label}</span>
            <strong>{fmt(k.value)}</strong>
            <small>
              {k.label.includes("YTD")
                ? `Jan ${report.year} – ${displayDate(today, true, true)}`
                : k.label.includes("monthly")
                  ? "Across months with recorded activity"
                  : "Recorded expenses only; transfers excluded"}
            </small>
          </article>
        ))}
      </div>
      {!report.activityCount && (
        <p className="flow-help">
          No recorded income or expenses this year yet. Budget targets and
          forecasts are not counted as actual activity.
        </p>
      )}
      <div className="flow-report-large-grid">
        {shown.includes("netWorth") && (
          <section className="flow-panel">
            <div className="flow-panel-heading">
              <div>
                <h2>Tracked net worth</h2>
                <p>Account balances, including investments and card debt</p>
              </div>
              <strong>
                {fmt(report.trends[report.trends.length - 1]?.cents ?? 0)}
              </strong>
            </div>
            <Trend
              points={report.trends}
              currency={data.currency}
              label="Recorded net worth history"
            />
          </section>
        )}
        {shown.includes("cashFlow") && (
          <section className="flow-panel">
            <div className="flow-panel-heading">
              <div>
                <h2>Cash flow</h2>
                <p>{monthLabel(month)} · recorded income less expenses</p>
              </div>
              <strong
                className={
                  report.actual.income < report.actual.spent ? "negative" : ""
                }
              >
                {fmt(report.actual.income - report.actual.spent)}
              </strong>
            </div>
            <Trend
              points={report.flow}
              currency={data.currency}
              label="Recorded monthly cash flow"
            />
          </section>
        )}
      </div>
      {shown.includes("comparisons") && (
        <div className="flow-report-comparisons">
          <section className="flow-panel">
            <h2>This month</h2>
            <strong className="flow-report-total">
              {fmt(report.actual.spent)}
            </strong>
            <p>Recorded expenses · {monthLabel(month)}</p>
            <p className="flow-help">
              Previous month: {fmt(report.previous.spent)}. Current months may
              be partial.
            </p>
          </section>
          <section className="flow-panel">
            <h2>Budget overview</h2>
            <strong className="flow-report-total">
              {fmt(
                report.categories.reduce((s, c) => s + c.planned, 0) -
                  report.actual.spent,
              )}
            </strong>
            <p>Planned spending remaining</p>
            <button className="flow-text-button" onClick={onBudget}>
              Open monthly budget
            </button>
          </section>
          <section className="flow-panel">
            <h2>3-month average</h2>
            <strong className="flow-report-total">{fmt(report.average)}</strong>
            <p>Recorded monthly expenses in the preceding three months</p>
            <p className="flow-help">
              Missing records are not evidence of zero real spending.
            </p>
          </section>
        </div>
      )}
      {shown.includes("categories") && (
        <section className="flow-panel">
          <h2>Spending by category</h2>
          <div className="flow-report-category-grid">
            {report.categories
              .filter((c) => c.actual || c.planned)
              .map((c) => (
                <div key={c.category.id}>
                  <span>{c.category.name}</span>
                  <strong className={c.actual > c.planned ? "negative" : ""}>
                    {fmt(c.actual)} / {fmt(c.planned)}
                  </strong>
                  <div className="flow-progress">
                    <span
                      className={c.actual > c.planned ? "over" : ""}
                      style={{
                        width: `${c.planned ? Math.min(100, (c.actual / c.planned) * 100) : 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
          {!report.categories.some((c) => c.actual || c.planned) && (
            <p className="flow-report-empty">
              Add budget targets or record spending to see the breakdown.
            </p>
          )}
        </section>
      )}
      {shown.includes("calendar") && (
        <section className="flow-panel">
          <div className="flow-panel-heading">
            <div>
              <h2>Transaction calendar</h2>
              <p>Click a day to inspect transactions and scheduled payments.</p>
            </div>
            <span className="flow-help">
              {monthLabel(report.calendarMonths[0])} – {monthLabel(month)}
            </span>
          </div>
          <div className="flow-report-calendars">
            {report.calendarMonths.map((m) => {
              const days = monthDays(m);
              return (
                <div className="flow-report-calendar" key={m}>
                  <h3>{monthLabel(m)}</h3>
                  <div className="flow-report-calendar-grid">
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <span className="flow-calendar-weekday" key={i}>
                        {d}
                      </span>
                    ))}
                    {Array.from({ length: days.offset }, (_, i) => (
                      <span key={"blank" + i} />
                    ))}
                    {days.dates.map((date) => {
                      const count = data.entries.filter(
                          (e) => e.date === date,
                        ).length,
                        expected = report.due.filter(
                          (d) => d.date === date,
                        ).length;
                      return (
                        <button
                          key={date}
                          aria-label={`${displayDate(date)}: ${count} transactions, ${expected} scheduled payments`}
                          aria-pressed={active === date}
                          className={`${count ? "has-activity" : ""} ${expected ? "has-schedule" : ""} ${active === date ? "selected" : ""}`}
                          onClick={() => setSelected(date)}
                        >
                          {+date.slice(-2)}
                          <span aria-hidden="true">
                            {count ? "●" : expected ? "○" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="flow-help">
            ● Transactions · ○ Scheduled payments. Future-dated entries remain
            scheduled; overdue unrecorded bills stay pending.
          </p>
          <div className="flow-report-day">
            <h3>{displayDate(active)}</h3>
            {!entries.length && !due.length && (
              <p>No transactions or scheduled payments on this day.</p>
            )}
            {entries.map((entry) => (
              <div key={entry.id}>
                <div>
                  <strong>{entry.payee || "Transfer"}</strong>
                  <small>
                    {entry.date > today ? "Scheduled entry" : "Recorded"} ·{" "}
                    {data.accounts.find((a) => a.id === entry.accountId)?.name}
                  </small>
                </div>
                <strong>
                  {entry.type === "expense"
                    ? "−"
                    : entry.type === "income"
                      ? "+"
                      : ""}
                  {fmt(entry.amountCents)}
                </strong>
                <button
                  className="flow-text-button"
                  onClick={() => onEditEntry(entry)}
                >
                  Edit transaction
                </button>
              </div>
            ))}
            {due.map((item) => (
              <div key={item.key}>
                <div>
                  <strong>{item.rule.payee}</strong>
                  <small>
                    {item.date < today
                      ? "Overdue · not recorded"
                      : "Scheduled · not recorded"}
                  </small>
                </div>
                <strong>
                  {item.rule.type === "expense" ? "−" : "+"}
                  {fmt(item.rule.amountCents)}
                </strong>
                <button
                  className="flow-text-button"
                  onClick={() => onRecordDue(item)}
                >
                  Record payment
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
