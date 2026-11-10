import { useState } from "react";
import {
  categoryLimit,
  categorySpent,
  money,
  parseMoney,
  scheduledCategoryIncome,
  TODAY,
  type BudgetData,
  type Category,
} from "./model";

function activity(data: BudgetData, category: Category, month: string) {
  return category.kind === "expense"
    ? categorySpent(data, category.id, month)
    : data.entries
        .filter(
          (e) =>
            e.type === "income" &&
            e.categoryId === category.id &&
            e.date.startsWith(month) &&
            e.date <= TODAY(),
        )
        .reduce((sum, e) => sum + e.amountCents, 0);
}
export function BudgetSheet({
  data,
  month,
  onSave,
  onEdit,
  onDelete,
  onAdd,
  onAccount,
}: {
  data: BudgetData;
  month: string;
  onSave: (data: BudgetData) => void | Promise<void>;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onAccount: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = ["income", "expense"].flatMap((kind) =>
    Array.from(
      new Set(
        data.categories
          .filter((c) => c.kind === kind)
          .map((c) => c.group || (kind === "income" ? "Income" : "Spending")),
      ),
    ).map((name) => ({
      kind,
      name,
      key: kind + ":" + name,
      categories: data.categories.filter(
        (c) =>
          c.kind === kind &&
          (c.group || (kind === "income" ? "Income" : "Spending")) === name,
      ),
    })),
  );
  const fmt = (n: number) => money(n, data.currency);
  return (
    <section className="flow-panel flow-budget-sheet">
      <div className="flow-panel-heading">
        <div>
          <h2>Your monthly budget</h2>
          <p>Income, fixed bills and everyday living, together in one place.</p>
        </div>
        <button className="flow-button" onClick={onAdd}>
          ＋ Add category
        </button>
      </div>
      {!data.accounts.length && (
        <div className="flow-budget-start">
          <span>
            Add your account balance to start tracking actual income and
            expenses.
          </span>
          <button className="flow-button" onClick={onAccount}>
            Add your first account
          </button>
        </div>
      )}
      <p className="flow-help">
        Amounts in {data.currency}. Remaining means planned minus recorded
        activity, not cash available. Scheduled income follows its actual pay
        dates, including three-paycheque months. Earlier pay before a schedule
        starts is already in your opening balance.
      </p>
      <div className="flow-table-scroll">
        <table
          className="flow-budget-table"
          aria-label="Monthly household budget"
        >
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Planned</th>
              <th scope="col">Actual</th>
              <th scope="col">Remaining</th>
              <th scope="col">
                <span className="flow-sr-only">Category actions</span>
              </th>
            </tr>
          </thead>
          {groups.map((group) => {
            const planned = group.categories.reduce(
              (sum, c) => sum + categoryLimit(data, c.id, month),
              0,
            );
            const actual = group.categories.reduce(
              (sum, c) => sum + activity(data, c, month),
              0,
            );
            const closed = collapsed.has(group.key);
            return (
              <tbody key={group.key}>
                <tr className="flow-budget-group">
                  <th scope="row">
                    <button
                      aria-label={`${closed ? "Expand" : "Collapse"} ${group.name}`}
                      aria-expanded={!closed}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (closed) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                    >
                      <span aria-hidden="true">{closed ? "▸" : "▾"}</span>{" "}
                      {group.name}
                    </button>
                    {group.name.toLowerCase() !== group.kind && (
                      <small>
                        {group.kind === "income" ? "Income" : "Expenses"}
                      </small>
                    )}
                  </th>
                  <td>{fmt(planned)}</td>
                  <td>{fmt(actual)}</td>
                  <td
                    className={
                      group.kind === "expense" && actual > planned
                        ? "negative"
                        : ""
                    }
                  >
                    {fmt(planned - actual)}
                  </td>
                  <td />
                </tr>
                {!closed &&
                  group.categories.map((category) => (
                    <BudgetRow
                      key={`${category.id}:${month}:${categoryLimit(data, category.id, month)}`}
                      data={data}
                      month={month}
                      category={category}
                      onSave={onSave}
                      onEdit={() => onEdit(category)}
                      onDelete={() => onDelete(category.id)}
                    />
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="flow-help flow-budget-footnote">
        Only recorded transactions appear under Actual. Future bills stay in the
        forecast until you record them. Monthly amounts can be edited without
        changing your recurring schedules.
      </p>
    </section>
  );
}
function BudgetRow({
  data,
  month,
  category,
  onSave,
  onEdit,
  onDelete,
}: {
  data: BudgetData;
  month: string;
  category: Category;
  onSave: (data: BudgetData) => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const limit = categoryLimit(data, category.id, month),
    actual = activity(data, category, month),
    remaining = limit - actual;
  const [draft, setDraft] = useState((limit / 100).toFixed(2)),
    [error, setError] = useState("");
  const scheduled =
    category.kind === "income"
      ? scheduledCategoryIncome(data, category.id, month)
      : null;
  const overridden = data.plans.some(
    (p) => p.categoryId === category.id && p.month === month,
  );
  const fmt = (n: number) => money(n, data.currency);
  const remainingLabel =
    category.kind === "income"
      ? remaining < 0
        ? "above target"
        : "to receive"
      : remaining < 0
        ? "over budget"
        : "left";
  return (
    <tr className="flow-budget-line">
      <th scope="row">
        <h3>
          <i style={{ background: category.color }} />
          {category.name}
        </h3>

        {(category.note || scheduled) && (
          <details className="flow-budget-notes">
            <summary>Notes{scheduled ? " & pay dates" : ""}</summary>
            <p>
              {scheduled
                ? `${scheduled.dates.map((d) => d.date).join(", ") || "No scheduled payments this month"}. Target follows the schedule unless manually overridden.`
                : category.note}
            </p>
            {scheduled && overridden && (
              <button
                className="flow-text-button"
                onClick={async () => {
                  try {
                    await onSave({
                      ...data,
                      plans: data.plans.filter(
                        (p) =>
                          !(p.month === month && p.categoryId === category.id),
                      ),
                    });
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Reset to pay schedule
              </button>
            )}
          </details>
        )}
        {scheduled && (
          <small className="flow-budget-cadence">
            {scheduled.rules
              .map(
                (r) =>
                  `${fmt(r.amountCents)} ${r.frequency === "biweekly" ? "every 14 days" : r.frequency}`,
              )
              .join(" + ")}{" "}
            · {scheduled.dates.length} scheduled payments
            {overridden ? " · Manual target" : ""}
          </small>
        )}
      </th>
      <td>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              const cents = parseMoney(draft, true);
              if (cents < 0)
                throw new Error("Planned amount must be zero or positive.");
              await onSave({
                ...data,
                plans: [
                  ...data.plans.filter(
                    (p) => !(p.month === month && p.categoryId === category.id),
                  ),
                  { month, categoryId: category.id, limitCents: cents },
                ],
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <label>
            <span className="flow-sr-only">{category.name} monthly limit</span>
            <input
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            className="flow-budget-save"
            aria-label={`Save ${category.name} limit`}
            title="Save planned amount"
          >
            ✓
          </button>
        </form>
        {error && (
          <p className="flow-error" role="alert">
            {error}
          </p>
        )}
      </td>
      <td>
        <span className="flow-budget-spent">{fmt(actual)}</span>
      </td>
      <td
        className={
          remaining < 0 && category.kind === "expense" ? "negative" : ""
        }
      >
        <span>
          {fmt(Math.abs(remaining))} {remainingLabel}
        </span>
        <div className="flow-progress" aria-hidden="true">
          <span
            className={
              remaining < 0 && category.kind === "expense" ? "over" : ""
            }
            style={{
              width: `${limit ? Math.min(100, (actual / limit) * 100) : actual ? 100 : 0}%`,
            }}
          />
        </div>
      </td>
      <td>
        <div className="flow-budget-row-actions">
          <button
            className="flow-text-button"
            aria-label={`Edit ${category.name} category`}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="flow-icon-button danger"
            aria-label={`Remove ${category.name} category`}
            onClick={onDelete}
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}
