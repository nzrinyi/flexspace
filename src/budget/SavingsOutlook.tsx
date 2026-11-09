import { useMemo, useState } from "react";
import { BudgetChart } from "./BudgetChart";
import { displayDate, money, TODAY, type BudgetData } from "./model";
import { savingsOutlook } from "./savings";

export function SavingsOutlook({
  data,
  onSchedules,
  onAccounts,
  onScenarios,
}: {
  data: BudgetData;
  onSchedules: () => void;
  onAccounts: () => void;
  onScenarios: () => void;
}) {
  const [scenarioId, setScenarioId] = useState("");
  const [includeUndated, setIncludeUndated] = useState(true);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartMonths, setChartMonths] = useState(12);
  const scenario = data.scenarios?.find((s) => s.id === scenarioId);
  const today = TODAY();
  const outlook = useMemo(
    () =>
      savingsOutlook(data, {
        scenario,
        includeUndatedIncome: includeUndated,
        today,
      }),
    [data, scenario, includeUndated, today],
  );
  const baseline = useMemo(
    () =>
      scenario
        ? savingsOutlook(data, { includeUndatedIncome: includeUndated, today })
        : null,
    [data, scenario, includeUndated, today],
  );
  const fmt = (n: number) => money(n, data.currency);
  const chartEnd = outlook.milestones.find(
    (m) => m.months === chartMonths,
  )!.date;
  return (
    <section
      className="flow-panel flow-savings-outlook"
      aria-label="Savings outlook"
    >
      <div className="flow-panel-heading">
        <div>
          <p className="flow-eyebrow">LOOKING AHEAD</p>
          <h2>Your savings outlook</h2>
          <p>
            How much extra cash you could build from{" "}
            {displayDate(today, true, true)}, after bills and planned spending.
          </p>
        </div>
        <button className="flow-button" onClick={onScenarios}>
          Edit scenarios
        </button>
      </div>
      <div className="flow-savings-controls">
        <label>
          Outlook plan
          <select
            aria-label="Outlook plan"
            value={scenario?.id ?? ""}
            onChange={(e) => setScenarioId(e.target.value)}
          >
            <option value="">Current budget</option>
            {data.scenarios?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {outlook.undatedCategories.length > 0 && (
          <label className="flow-savings-check">
            <input
              type="checkbox"
              checked={includeUndated}
              onChange={(e) => setIncludeUndated(e.target.checked)}
            />
            Include undated monthly income estimates from next month
          </label>
        )}
      </div>
      {!outlook.confirmed ? (
        <div className="flow-budget-start">
          <span>
            Confirm your chequing, savings and credit-card balances to calculate
            how much you can save.
          </span>
          <button className="flow-button" onClick={onAccounts}>
            Set account balances
          </button>
        </div>
      ) : (
        <>
          {!outlook.scenario.includeSpending && (
            <p className="flow-warning" role="status">
              This scenario excludes unscheduled living expenses. Its savings
              estimates do not include your full spending plan.
            </p>
          )}
          <p className="flow-help">
            Starting liquid balance:{" "}
            <strong>{fmt(outlook.startingCents)}</strong> · Chequing and
            savings, less credit-card debt. Investments are excluded.
          </p>
          <div className="flow-savings-cards">
            {outlook.milestones.map((m, i) => (
              <article
                className="flow-savings-card"
                key={m.months}
                aria-label={`${m.months}-month savings estimate`}
              >
                <span>
                  {m.months === 6
                    ? "In 6 months"
                    : m.months === 12
                      ? "In 1 year"
                      : "In 2 years"}
                </span>
                <strong className={m.addedCents < 0 ? "negative" : ""}>
                  {m.addedCents > 0 ? "+" : ""}
                  {fmt(m.addedCents)}
                </strong>
                <small>
                  {m.addedCents < 0
                    ? "Net decrease in cash savings"
                    : "Additional cash savings"}
                </small>
                <div>
                  <b>{fmt(m.balanceCents)}</b> projected liquid balance
                </div>
                <small>By {displayDate(m.date, true, true)}</small>
                {baseline && (
                  <small>
                    {fmt(m.addedCents - baseline.milestones[i].addedCents)} vs
                    current budget
                  </small>
                )}
              </article>
            ))}
          </div>
          {outlook.firstShortfall && (
            <p className="flow-warning" role="status">
              Projected cash drops below zero on{" "}
              {displayDate(outlook.firstShortfall, true, true)}. A positive
              ending balance can still hide a shortfall along the way.
            </p>
          )}
          <button
            className="flow-text-button"
            aria-expanded={chartOpen}
            onClick={() => setChartOpen(!chartOpen)}
          >
            {chartOpen ? "Hide savings projection" : "Show savings projection"}
          </button>
          {chartOpen && (
            <div className="flow-savings-chart">
              <label>
                Chart horizon
                <select
                  aria-label="Savings chart horizon"
                  value={chartMonths}
                  onChange={(e) => setChartMonths(+e.target.value)}
                >
                  <option value={6}>6 months</option>
                  <option value={12}>1 year</option>
                  <option value={24}>2 years</option>
                </select>
              </label>
              <BudgetChart
                points={outlook.points.filter((p) => p.date <= chartEnd)}
                comparison={baseline?.points.filter((p) => p.date <= chartEnd)}
                currency={data.currency}
                reserve={0}
                valueLabel="Savings added"
                referenceLabel="No change from today"
                assumptions="Net change in liquid balances from today. Internal transfers between chequing and savings do not create new savings."
              />
            </div>
          )}
        </>
      )}
      <details className="flow-savings-assumptions">
        <summary>
          Projection assumptions
          {outlook.undatedCategories.length
            ? " · Income dates need attention"
            : ""}
        </summary>
        <p>
          {scenario
            ? `Using saved scenario “${scenario.name}”.`
            : "Using your current budget."}{" "}
          Pay and mortgages follow their dated schedules, including every-14-day
          cycles and three-payment months.{" "}
          {outlook.scenario.includeSpending
            ? `Includes ${outlook.scenario.spendingPercent}% of remaining monthly spending plans, after recorded expenses and scheduled bills.`
            : "This scenario excludes unscheduled living expenses; its savings estimate will be higher."}
        </p>
        {outlook.undatedCategories.length > 0 && (
          <p>
            {includeUndated
              ? "Monthly income targets are estimated evenly from next month for: "
              : "Excluded income targets without confirmed schedules: "}
            {outlook.undatedCategories.map((c) => c.name).join(", ")}.
            Current-month undated income is excluded to avoid counting money
            already in your opening balance twice.{" "}
            <button className="flow-text-button" onClick={onSchedules}>
              Review income dates
            </button>
          </p>
        )}
        <p>
          Amounts are estimates, not automatic transfers to a savings account.
          Cash moved to investments reduces liquid savings; investment balances,
          interest and market returns are not projected. Current-month spending
          uses the remaining budget, so record earlier spending for a more
          accurate estimate. Overdue unrecorded items are assumed to occur
          today.
        </p>
      </details>
    </section>
  );
}
