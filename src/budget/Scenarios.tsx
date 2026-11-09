import { useMemo, useState } from "react";
import { BudgetChart } from "./BudgetChart";
import { newScenario, projectScenario } from "./scenarios";
import {
  displayDate,
  money,
  TODAY,
  validateBudget,
  type BudgetData,
  type BudgetScenario,
  type ScenarioEvent,
} from "./model";

const frequencies = {
  once: "One time",
  weekly: "Every week",
  biweekly: "Every 14 days",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
export function Scenarios({
  data,
  onSave,
}: {
  data: BudgetData;
  onSave: (data: BudgetData) => void;
}) {
  const [draft, setDraft] = useState<BudgetScenario>(
    () => data.scenarios?.[0] ?? newScenario(data),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set = (next: BudgetScenario) => {
    setDraft(next);
    setNotice("");
    setError("");
  };
  const baseline = useMemo(
    () => projectScenario(data, draft, TODAY(), true),
    [data, draft],
  );
  const result = useMemo(() => projectScenario(data, draft), [data, draft]);
  const fmt = (n: number) => money(n, data.currency);
  const cashAccounts = data.accounts.filter(
    (a) => a.includeInForecast !== false && a.type !== "Investment",
  );
  const confirmed =
    cashAccounts.length > 0 &&
    cashAccounts.every((a) => a.balanceConfirmed !== false);
  function save() {
    try {
      const next = validateBudget({
        ...data,
        scenarios: [
          ...(data.scenarios ?? []).filter((s) => s.id !== draft.id),
          draft,
        ],
      });
      onSave(next);
      setError("");
      setNotice("Scenario saved on this device and included in JSON backups.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save scenario.");
    }
  }
  function eventChange(id: string, patch: Partial<ScenarioEvent>) {
    set({
      ...draft,
      events: draft.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }
  return (
    <div className="flow-scenarios">
      <section className="flow-panel">
        <div className="flow-panel-heading">
          <div>
            <h2>Explore a what-if plan</h2>
            <p>
              Compare against your current budget. Scenario changes never alter
              your accounts, transactions or bill schedules.
            </p>
          </div>
          <button
            className="flow-button"
            onClick={() => set(newScenario(data))}
          >
            New scenario
          </button>
        </div>
        <div className="flow-scenario-fields">
          <label>
            Saved scenario
            <select
              aria-label="Saved scenario"
              value={
                (data.scenarios ?? []).some((s) => s.id === draft.id)
                  ? draft.id
                  : ""
              }
              onChange={(e) => {
                const saved = data.scenarios?.find(
                  (s) => s.id === e.target.value,
                );
                if (saved) set(structuredClone(saved));
              }}
            >
              <option value="" disabled>
                Unsaved scenario
              </option>
              {data.scenarios?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scenario name
            <input
              maxLength={100}
              value={draft.name}
              onChange={(e) => set({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Projection length
            <select
              aria-label="Projection length"
              value={draft.days}
              onChange={(e) => set({ ...draft, days: +e.target.value })}
            >
              {[30, 90, 180, 365, 730].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Reserve target
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.reserveCents / 100}
              onChange={(e) =>
                set({
                  ...draft,
                  reserveCents: Math.round(+e.target.value * 100),
                })
              }
            />
          </label>
          <label className="flow-scenario-check">
            <input
              type="checkbox"
              checked={draft.includeSpending}
              onChange={(e) =>
                set({ ...draft, includeSpending: e.target.checked })
              }
            />
            Include remaining monthly spending plan
          </label>
          <label>
            Unscheduled spending (% of remaining plan)
            <input
              type="number"
              min="0"
              max="300"
              step="1"
              disabled={!draft.includeSpending}
              value={draft.spendingPercent}
              onChange={(e) =>
                set({
                  ...draft,
                  spendingPercent: Math.min(300, Math.max(0, +e.target.value)),
                })
              }
            />
          </label>
        </div>
        <p className="flow-help">
          When enabled, remaining category budgets are spread across the days
          left in each month. Recorded expenses and scheduled bills are deducted
          first to avoid counting them twice. The baseline uses 100% of the
          remaining plan. This percentage changes unscheduled spending only;
          edit bill amounts below to change fixed costs. Income always follows
          its dated schedule; undated income is excluded.
        </p>
        <div className="flow-action-row">
          <button className="flow-button primary" onClick={save}>
            Save scenario
          </button>
          {(data.scenarios ?? []).some((s) => s.id === draft.id) && (
            <button
              className="flow-button"
              onClick={() => {
                try {
                  onSave({
                    ...data,
                    scenarios: data.scenarios?.filter((s) => s.id !== draft.id),
                  });
                  set(newScenario(data));
                  setNotice("Scenario deleted.");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Delete scenario
            </button>
          )}
        </div>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="flow-panel">
        <h2>Change recurring bills or income</h2>
        <p className="flow-help">
          Amounts are per occurrence. Every 14 days stays every 14 days,
          including three-paycheque months. Changes apply to all future
          unrecorded occurrences; already recorded transactions stay fixed.
        </p>
        <div className="flow-scenario-rules">
          {data.recurring.map((rule) => {
            const override = draft.overrides.find(
              (o) => o.recurringId === rule.id,
            );
            const active = override?.active ?? rule.active;
            const amount = override?.amountCents ?? rule.amountCents;
            const update = (patch: {
              active?: boolean;
              amountCents?: number;
            }) =>
              set({
                ...draft,
                overrides: [
                  ...draft.overrides.filter((o) => o.recurringId !== rule.id),
                  {
                    recurringId: rule.id,
                    active,
                    amountCents: amount,
                    ...patch,
                  },
                ],
              });
            return (
              <div className="flow-scenario-rule" key={rule.id}>
                <label className="flow-scenario-check">
                  <input
                    type="checkbox"
                    aria-label={`Include ${rule.payee}`}
                    disabled={rule.dateConfirmed === false}
                    checked={active}
                    onChange={(e) => update({ active: e.target.checked })}
                  />
                  <span>
                    <strong>{rule.payee}</strong>
                    <small>
                      {frequencies[rule.frequency]} · {fmt(rule.amountCents)}{" "}
                      per occurrence
                      {rule.dateConfirmed === false
                        ? " · Date needed; excluded"
                        : ""}
                    </small>
                  </span>
                </label>
                <label>
                  Scenario amount
                  <input
                    aria-label={`${rule.payee} scenario amount`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    disabled={!active}
                    value={amount / 100}
                    onChange={(e) =>
                      update({ amountCents: Math.round(+e.target.value * 100) })
                    }
                  />
                </label>
                {override && (
                  <button
                    className="flow-text-button"
                    onClick={() =>
                      set({
                        ...draft,
                        overrides: draft.overrides.filter(
                          (o) => o.recurringId !== rule.id,
                        ),
                      })
                    }
                  >
                    Reset {rule.payee}
                  </button>
                )}
              </div>
            );
          })}
          {!data.recurring.length && (
            <p>
              Add recurring bills and income in Bills & income to compare
              changes here.
            </p>
          )}
        </div>
      </section>
      <section className="flow-panel">
        <div className="flow-panel-heading">
          <div>
            <h2>Hypothetical income & costs</h2>
            <p>
              Try a purchase, a new bill, a bonus, or another future change.
              These are additional to your existing plan.
            </p>
          </div>
          <button
            className="flow-button"
            disabled={!cashAccounts.length}
            onClick={() =>
              set({
                ...draft,
                events: [
                  ...draft.events,
                  {
                    id: crypto.randomUUID(),
                    name: "Future purchase",
                    accountId: cashAccounts[0].id,
                    type: "expense",
                    amountCents: 10000,
                    date: TODAY(),
                    frequency: "once",
                    endDate: "",
                  },
                ],
              })
            }
          >
            Add hypothetical event
          </button>
        </div>
        {draft.events.map((event) => (
          <div className="flow-scenario-event" key={event.id}>
            <div className="flow-scenario-fields">
              <label>
                Event name
                <input
                  value={event.name}
                  maxLength={150}
                  onChange={(e) =>
                    eventChange(event.id, { name: e.target.value })
                  }
                />
              </label>
              <label>
                Event type
                <select
                  aria-label="Event type"
                  value={event.type}
                  onChange={(e) =>
                    eventChange(event.id, {
                      type: e.target.value as "income" | "expense",
                    })
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <label>
                Event amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={event.amountCents / 100}
                  onChange={(e) =>
                    eventChange(event.id, {
                      amountCents: Math.round(+e.target.value * 100),
                    })
                  }
                />
              </label>
              <label>
                Event date
                <input
                  type="date"
                  value={event.date}
                  min={TODAY()}
                  onChange={(e) =>
                    eventChange(event.id, { date: e.target.value || TODAY() })
                  }
                />
              </label>
              <label>
                Event frequency
                <select
                  aria-label="Event frequency"
                  value={event.frequency}
                  onChange={(e) =>
                    eventChange(event.id, {
                      frequency: e.target.value as ScenarioEvent["frequency"],
                    })
                  }
                >
                  {Object.entries(frequencies).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Event account
                <select
                  aria-label="Event account"
                  value={event.accountId}
                  onChange={(e) =>
                    eventChange(event.id, { accountId: e.target.value })
                  }
                >
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {event.frequency !== "once" && (
                <label>
                  Event end date (optional)
                  <input
                    type="date"
                    value={event.endDate}
                    min={event.date}
                    onChange={(e) =>
                      eventChange(event.id, { endDate: e.target.value })
                    }
                  />
                </label>
              )}
            </div>
            <button
              className="flow-text-button"
              onClick={() =>
                set({
                  ...draft,
                  events: draft.events.filter((e) => e.id !== event.id),
                })
              }
            >
              Remove {event.name || "event"}
            </button>
          </div>
        ))}
      </section>
      {!confirmed ? (
        <section className="flow-panel">
          <h2>Set confirmed cash balances to run projections</h2>
          <p>
            Add a cash-flow account and confirm its starting balance in
            Accounts. Tracked savings and investments stay outside the
            projection.
          </p>
        </section>
      ) : (
        <>
          <div className="flow-stats three">
            <article className="flow-stat">
              <span>Projected closing cash</span>
              <strong className={result.closingCents < 0 ? "negative" : ""}>
                {fmt(result.closingCents)}
              </strong>
              <small>
                Baseline {fmt(baseline.closingCents)} ·{" "}
                {displayDate(
                  result.points[result.points.length - 1].date,
                  true,
                )}
              </small>
            </article>
            <article className="flow-stat">
              <span>Difference from baseline</span>
              <strong
                className={
                  result.closingCents < baseline.closingCents ? "negative" : ""
                }
              >
                {fmt(result.closingCents - baseline.closingCents)}
              </strong>
              <small>
                Scenario less baseline at the end of {draft.days} days
              </small>
            </article>
            <article className="flow-stat">
              <span>Lowest scenario balance</span>
              <strong
                className={
                  result.low.cents < draft.reserveCents ? "negative" : ""
                }
              >
                {fmt(result.low.cents)}
              </strong>
              <small>
                {displayDate(result.low.date, true, true)} ·{" "}
                {result.low.cents < draft.reserveCents
                  ? `${fmt(draft.reserveCents - result.low.cents)} below reserve`
                  : "Above reserve"}
              </small>
            </article>
          </div>
          {result.firstShortfall && (
            <p className="flow-warning" role="status">
              First projected shortfall:{" "}
              {displayDate(result.firstShortfall, true, true)}.
            </p>
          )}
          <section className="flow-panel">
            <h2>Baseline vs scenario</h2>
            <BudgetChart
              points={result.points}
              comparison={baseline.points}
              currency={data.currency}
              reserve={draft.reserveCents}
              assumptions={
                draft.includeSpending
                  ? "Includes remaining monthly spending plans, scheduled cash flow and your hypothetical changes. No investment growth or interest is assumed."
                  : "Includes scheduled cash flow and your hypothetical changes only. Other living expenses are excluded."
              }
            />
          </section>
          <section className="flow-panel">
            <h2>Monthly projection</h2>
            <p className="flow-help">
              First and last months may be partial. Starts from today’s recorded
              cash balance; overdue unrecorded bills and income are assumed to
              occur today.
            </p>
            <div className="flow-table-scroll">
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>Through</th>
                    <th>Baseline closing cash</th>
                    <th>Scenario closing cash</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {result.months.map((m, i) => (
                    <tr key={m.month}>
                      <td>{displayDate(m.endDate, true, true)}</td>
                      <td>{fmt(baseline.months[i].closingCents)}</td>
                      <td className={m.closingCents < 0 ? "negative" : ""}>
                        {fmt(m.closingCents)}
                      </td>
                      <td>
                        {fmt(m.closingCents - baseline.months[i].closingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
