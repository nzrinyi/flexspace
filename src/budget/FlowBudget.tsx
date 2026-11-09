import { useEffect, useMemo, useRef, useState } from "react";
import { BudgetEditor, type Editor } from "./BudgetForms";
import { Scenarios } from "./Scenarios";
import { BudgetSheet } from "./BudgetSheet";
import { BudgetChart } from "./BudgetChart";
import { useBudget, BUDGET_KEY } from "./useBudget";
import {
  balance,
  cashBalance,
  forecast,
  dueItems,
  monthTotals,
  categoryLimit,
  categorySpent,
  removeRecord,
  money,
  parseMoney,
  TODAY,
  nextMonth,
  displayDate,
  addDays,
  validateBudget,
  type BudgetData,
  type DueItem,
  type Entry,
} from "./model";
import { downloadFile, exportCSV } from "./csv";
import { consumeSetupFragment, decodeSetup } from "./preload";
import "./budget.css";
type View =
  | "overview"
  | "transactions"
  | "budget"
  | "recurring"
  | "accounts"
  | "reports"
  | "settings"
  | "scenarios";
const sections: Array<{ id: View; label: string; icon: string }> = [
  { id: "budget", label: "Monthly budget", icon: "▤" },
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "transactions", label: "Transactions", icon: "⇄" },
  { id: "recurring", label: "Bills & income", icon: "↻" },
  { id: "accounts", label: "Accounts", icon: "▣" },
  { id: "scenarios", label: "Scenarios & projections", icon: "⌁" },
  { id: "reports", label: "Reports", icon: "▥" },
];
const titles: Record<View, string> = {
  overview: "Your money, a little clearer.",
  transactions: "Every little movement.",
  budget: "Your monthly budget.",
  recurring: "One less thing to remember.",
  accounts: "The whole picture.",
  reports: "See where it goes.",
  settings: "Make it yours.",
  scenarios: "See what could change.",
};
export default function FlowBudget({
  onSwitchApp,
}: {
  onSwitchApp: () => void;
}) {
  const store = useBudget(),
    data = store.data;
  const latestStore = useRef(store);
  latestStore.current = store;
  const [view, setView] = useState<View>("budget"),
    [month, setMonth] = useState(TODAY().slice(0, 7)),
    [editor, setEditor] = useState<Editor | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [menuOpen, setMenuOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all"),
    [horizon, setHorizon] = useState(90),
    [search, setSearch] = useState(""),
    [typeFilter, setTypeFilter] = useState("all");
  const account = data.accounts.some(
    (a) =>
      a.id === accountFilter &&
      (view !== "overview" ||
        (a.includeInForecast !== false && a.type !== "Investment")),
  )
    ? accountFilter
    : "all";
  const projection = useMemo(
    () => forecast(data, horizon, account),
    [data, horizon, account],
  );
  const totals = monthTotals(data, month);
  const current = cashBalance(data, TODAY(), account);
  const upcoming = projection.due;
  const entries = data.entries
    .filter(
      (e) =>
        e.date.startsWith(month) &&
        (account === "all" ||
          e.accountId === account ||
          e.toAccountId === account) &&
        (typeFilter === "all" || e.type === typeFilter) &&
        `${e.payee} ${e.note} ${data.categories.find((c) => c.id === e.categoryId)?.name ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.payee.localeCompare(b.payee),
    );
  const balanceConfirmed = data.accounts
    .filter((a) =>
      account === "all"
        ? a.includeInForecast !== false && a.type !== "Investment"
        : a.id === account,
    )
    .every((a) => a.balanceConfirmed !== false);
  const fmt = (n: number) => money(n, data.currency),
    accountName = (id: string) =>
      data.accounts.find((a) => a.id === id)?.name ?? "Account";
  function navigate(next: View) {
    setView(next);
    setMenuOpen(false);
    setError("");
  }
  function save(next: BudgetData, notice: string, replacing = false) {
    store.commit(next, replacing);
    setEditor(null);
    setMessage(notice);
    setError("");
  }
  function action(fn: () => void) {
    setError("");
    try {
      fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Action failed. Your data has not been changed.",
      );
    }
  }
  function remove(
    kind: "account" | "category" | "recurring" | "entry",
    id: string,
  ) {
    if (
      !window.confirm(
        `Remove this ${kind === "entry" ? "transaction" : kind}?${kind === "entry" ? " If it matches a recurring payment, that scheduled payment becomes pending again." : ""} You can undo this change.`,
      )
    )
      return;
    action(() =>
      save(
        removeRecord(data, kind, id),
        "Removed. Use Undo to restore the last change.",
      ),
    );
  }
  function exportBackup() {
    downloadFile(
      `flowbudget-backup-${TODAY()}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
    setMessage("Backup downloaded. Keep it somewhere safe.");
  }
  function openEntry() {
    if (!data.accounts.length) {
      setEditor({ kind: "account" });
      setMessage("Add an account first, then enter a transaction.");
    } else setEditor({ kind: "entry" });
  }
  useEffect(() => {
    const previous = document.title;
    const icon = document.querySelector<HTMLLinkElement>("link[rel=icon]");
    const previousIcon = icon?.getAttribute("href");
    document.title = "FlowBudget · Flexspace";
    if (icon) icon.href = "/flowbudget.svg";
    return () => {
      document.title = previous;
      if (icon && previousIcon) icon.href = previousIcon;
    };
  }, []);
  useEffect(() => {
    function read() {
      const encoded = consumeSetupFragment();
      if (!encoded) return;
      void decodeSetup(encoded)
        .then((value) => {
          const currentStore = latestStore.current;
          if (
            !currentStore.data.accounts.length &&
            !currentStore.data.entries.length &&
            !currentStore.storageError
          ) {
            currentStore.commit(value);
            setMessage(
              "Your household plan is loaded and saved on this device.",
            );
          } else {
            setEditor({ kind: "restore", value, setup: true });
            setMessage(
              "Your household plan is ready. Confirm before replacing this device’s budget.",
            );
          }
        })
        .catch((e) =>
          setError(
            e instanceof Error
              ? e.message
              : "The setup link could not be read.",
          ),
        );
    }
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const monthName = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5)) - 1,
    1,
  ).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return (
    <div className="flow-app">
      <aside className={`flow-sidebar ${menuOpen ? "open" : ""}`}>
        <button
          className="flow-brand"
          onClick={() => navigate("budget")}
          aria-label="FlowBudget home"
        >
          <span className="flow-logo" aria-hidden="true">
            ≈
          </span>
          <span>
            flow<span>budget</span>
          </span>
        </button>
        <p className="flow-sidebar-label">YOUR FINANCES</p>
        <nav aria-label="FlowBudget sections">
          {sections.map((s) => (
            <button
              key={s.id}
              className={view === s.id ? "active" : ""}
              aria-current={view === s.id ? "page" : undefined}
              onClick={() => navigate(s.id)}
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
              {s.id === "recurring" &&
                data.recurring.filter((r) => r.active).length > 0 && (
                  <small>{data.recurring.filter((r) => r.active).length}</small>
                )}
            </button>
          ))}
        </nav>
        <div className="flow-sidebar-bottom">
          <div className="flow-device">
            <span aria-hidden="true">◉</span>
            <div>
              <strong>Yours. On this device.</strong>
              <small>Manual tracking · no bank connection</small>
            </div>
          </div>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            Settings & backups
          </button>
          <button onClick={onSwitchApp}>↗ Switch app</button>
        </div>
      </aside>
      <div className="flow-main">
        <header className="flow-topbar">
          <button
            className="flow-icon-button flow-mobile-menu"
            aria-label="Toggle budgeting menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰
          </button>
          <span className="flow-breadcrumb">
            Flexspace <span>/</span> FlowBudget
          </span>
          <div className="flow-topbar-actions">
            <button
              className="flow-button"
              disabled={!data.accounts.length}
              onClick={() => setEditor({ kind: "import" })}
            >
              Import CSV
            </button>
            <button className="flow-button primary" onClick={openEntry}>
              ＋ Add transaction
            </button>
          </div>
        </header>
        <main className="flow-content">
          <div className="flow-page-heading">
            <div>
              <p className="flow-eyebrow">
                {sections.find((s) => s.id === view)?.label ?? "Preferences"}
              </p>
              <h1>{titles[view]}</h1>
              <p>
                {view === "overview"
                  ? `A calmer view of today, and what comes next. As of ${displayDate(TODAY(), true)}.`
                  : view === "transactions"
                    ? "Your ledger, with room for the details."
                    : view === "budget"
                      ? "Your household plan: income, fixed bills and living expenses."
                      : view === "recurring"
                        ? "Recurring plans become real transactions only when you record them."
                        : view === "accounts"
                          ? "Opening balances plus the transactions you enter."
                          : view === "reports"
                            ? "Recorded income and spending, without transfers."
                            : view === "scenarios"
                              ? "Compare changes in income, bills and spending over the next two years."
                              : "Your currency, safety buffer and portable backups."}
              </p>
            </div>
            {["transactions", "budget", "reports"].includes(view) && (
              <div className="flow-month-picker">
                <button
                  aria-label="Previous month"
                  onClick={() => setMonth(nextMonth(month, -1))}
                >
                  ←
                </button>
                <label>
                  <span className="flow-sr-only">Budget month</span>
                  <input
                    type="month"
                    min="2000-01"
                    max="2100-12"
                    value={month}
                    onChange={(e) => {
                      if (/^\d{4}-\d{2}$/.test(e.target.value))
                        setMonth(e.target.value);
                    }}
                  />
                </label>
                <button
                  aria-label="Next month"
                  onClick={() => setMonth(nextMonth(month, 1))}
                >
                  →
                </button>
              </div>
            )}
          </div>
          {(message || store.canUndo) && (
            <div className="flow-notice" role="status">
              <span>{message}</span>
              {store.canUndo && (
                <button
                  onClick={() =>
                    action(() => {
                      store.undo();
                      setMessage("Last change undone.");
                    })
                  }
                >
                  Undo last change
                </button>
              )}
              <button
                className="flow-icon-button"
                aria-label="Dismiss status"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </div>
          )}
          {(error || store.storageError) && (
            <div className="flow-error" role="alert">
              {error || store.storageError}
            </div>
          )}
          {!data.accounts.length && view === "overview" ? (
            <section className="flow-welcome flow-panel">
              <div className="flow-welcome-art" aria-hidden="true">
                <div />
                <span>↗</span>
                <i />
              </div>
              <span className="flow-tag">A fresh start</span>
              <h2>Give your money a clearer path.</h2>
              <p>
                Add your first account, record the money coming in and out, then
                see how future bills affect your balance.
              </p>
              <div className="flow-action-row">
                <button
                  className="flow-button primary"
                  onClick={() => setEditor({ kind: "account" })}
                >
                  Add your first account
                </button>
              </div>
              <ol>
                <li>
                  <b>01</b>Start with an account
                </li>
                <li>
                  <b>02</b>Add bills & payday
                </li>
                <li>
                  <b>03</b>See what’s ahead
                </li>
              </ol>
            </section>
          ) : view === "overview" ? (
            <>
              <div className="flow-stats">
                <Stat
                  label="Current balance"
                  value={balanceConfirmed ? fmt(current) : "Set balance"}
                  detail={
                    account === "all"
                      ? `${data.accounts.filter((a) => a.includeInForecast !== false && a.type !== "Investment").length} cash-flow accounts · recorded balance`
                      : "Selected account · recorded balance"
                  }
                />
                <Stat
                  label="Lowest projected balance"
                  value={
                    balanceConfirmed ? fmt(projection.low.cents) : "Set balance"
                  }
                  detail={`${displayDate(projection.low.date, true)} · next ${horizon} days`}
                  negative={balanceConfirmed && projection.low.cents < 0}
                />
                <Stat
                  label="Room above your reserve"
                  value={
                    balanceConfirmed ? fmt(projection.safeCents) : "Set balance"
                  }
                  detail={`Lowest projected balance less ${fmt(data.reserveCents)} reserve`}
                  accent
                />
                <Stat
                  label="Spent this month"
                  value={fmt(monthTotals(data, TODAY().slice(0, 7)).spent)}
                  detail="Recorded expenses · all accounts"
                />
              </div>
              {data.recurring.some((r) => r.dateConfirmed === false) && (
                <div className="flow-warning">
                  {
                    data.recurring.filter((r) => r.dateConfirmed === false)
                      .length
                  }{" "}
                  recurring items need due dates and are excluded from the
                  forecast.{" "}
                  <button
                    className="flow-text-button"
                    onClick={() => navigate("recurring")}
                  >
                    Set bill dates
                  </button>
                </div>
              )}
              <section className="flow-panel">
                <div className="flow-panel-heading">
                  <div>
                    <h2>Your cash-flow forecast</h2>
                    <p>A little perspective for the road ahead.</p>
                  </div>
                  <div className="flow-action-row">
                    <AccountFilter
                      data={data}
                      value={account}
                      set={setAccountFilter}
                      cashFlow
                    />
                    <label>
                      <span className="flow-sr-only">Forecast range</span>
                      <select
                        value={horizon}
                        onChange={(e) => setHorizon(+e.target.value)}
                      >
                        {[30, 90, 180, 365].map((n) => (
                          <option key={n} value={n}>
                            Next {n} days
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                {balanceConfirmed && projection.low.cents < 0 && (
                  <p className="flow-warning">
                    A shortfall of {fmt(-projection.low.cents)} is projected on{" "}
                    {displayDate(projection.low.date)}. Review upcoming bills
                    and income.
                  </p>
                )}
                {balanceConfirmed ? (
                  <BudgetChart
                    points={projection.points}
                    currency={data.currency}
                    reserve={data.reserveCents}
                  />
                ) : (
                  <Empty
                    title="Add your actual starting balance"
                    text="Your plan is loaded, but a cash-flow forecast needs a real starting balance. No balance has been assumed."
                    action="Set starting balance"
                    onAction={() =>
                      setEditor({
                        kind: "account",
                        value: data.accounts.find(
                          (a) => a.balanceConfirmed === false,
                        ),
                      })
                    }
                  />
                )}
              </section>
              <div className="flow-two-columns">
                <section className="flow-panel">
                  <div className="flow-panel-heading">
                    <div>
                      <h2>Coming up</h2>
                      <p>Scheduled bills & income</p>
                    </div>
                    <button
                      className="flow-text-button"
                      onClick={() => navigate("recurring")}
                    >
                      View all →
                    </button>
                  </div>
                  {upcoming.length ? (
                    <ul className="flow-due-list">
                      {upcoming.slice(0, 6).map((item) => (
                        <DueRow
                          key={item.key}
                          item={item}
                          currency={data.currency}
                          onRecord={() =>
                            setEditor({ kind: "entry", due: item })
                          }
                          onSkip={() =>
                            action(() =>
                              save(
                                {
                                  ...data,
                                  skipped: [...data.skipped, item.key],
                                },
                                "Occurrence skipped. Undo is available.",
                              ),
                            )
                          }
                        />
                      ))}
                    </ul>
                  ) : (
                    <Empty
                      title="Nothing on the horizon"
                      text="Add recurring bills and income to bring your forecast to life."
                      action="Add recurring item"
                      onAction={() => setEditor({ kind: "recurring" })}
                    />
                  )}
                </section>
                <section className="flow-panel">
                  <div className="flow-panel-heading">
                    <div>
                      <h2>Monthly spending</h2>
                      <p>
                        {new Date().toLocaleDateString("en-CA", {
                          month: "long",
                        })}{" "}
                        · recorded expenses
                      </p>
                    </div>
                    <button
                      className="flow-text-button"
                      onClick={() => navigate("budget")}
                    >
                      Your budget →
                    </button>
                  </div>
                  <SpendingList data={data} month={TODAY().slice(0, 7)} />
                </section>
              </div>
              <section className="flow-panel">
                <div className="flow-panel-heading">
                  <div>
                    <h2>Recent activity</h2>
                    <p>The latest entries in your ledger</p>
                  </div>
                  <button
                    className="flow-text-button"
                    onClick={() => navigate("transactions")}
                  >
                    All transactions →
                  </button>
                </div>
                <Ledger
                  data={data}
                  entries={[...data.entries]
                    .filter((e) => e.date <= TODAY())
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 5)}
                  onEdit={(e) => setEditor({ kind: "entry", value: e })}
                  onDelete={(id) => remove("entry", id)}
                />
              </section>
            </>
          ) : null}
          {view === "transactions" && (
            <section className="flow-panel">
              <div className="flow-filter-bar">
                <label className="flow-search">
                  <span className="flow-sr-only">Search transactions</span>
                  <input
                    type="search"
                    placeholder="Search transactions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <AccountFilter
                  data={data}
                  value={account}
                  set={setAccountFilter}
                />
                <label>
                  <span className="flow-sr-only">Transaction filter</span>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="expense">Expenses</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfers</option>
                  </select>
                </label>
                <button
                  className="flow-button"
                  onClick={() =>
                    downloadFile(
                      `flowbudget-transactions-${month}.csv`,
                      exportCSV({ ...data, entries }),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  Export CSV
                </button>
              </div>
              <Ledger
                data={data}
                entries={entries}
                onEdit={(e) => setEditor({ kind: "entry", value: e })}
                onDelete={(id) => remove("entry", id)}
              />
              <p className="flow-help">
                {entries.length} entries in this view. Future-dated entries are
                scheduled and appear in the forecast, not today’s balance.
              </p>
            </section>
          )}
          {view === "budget" && (
            <>
              <div className="flow-stats three">
                <Stat
                  label="Planned monthly income"
                  value={fmt(
                    data.categories
                      .filter((c) => c.kind === "income")
                      .reduce(
                        (sum, c) => sum + categoryLimit(data, c.id, month),
                        0,
                      ),
                  )}
                  detail="Scheduled pay dates plus any undated income targets"
                  accent
                />
                <Stat
                  label="Planned monthly expenses"
                  value={fmt(
                    data.categories
                      .filter((c) => c.kind === "expense")
                      .reduce(
                        (sum, c) => sum + categoryLimit(data, c.id, month),
                        0,
                      ),
                  )}
                  detail={monthName}
                />
                <Stat
                  label="Planned monthly remainder"
                  value={fmt(
                    data.categories.reduce(
                      (sum, c) =>
                        sum +
                        categoryLimit(data, c.id, month) *
                          (c.kind === "income" ? 1 : -1),
                      0,
                    ),
                  )}
                  detail="Income target less planned expenses"
                />
              </div>
              <BudgetSheet
                data={data}
                month={month}
                onSave={(next) => save(next, "Monthly plan saved.")}
                onEdit={(category) =>
                  setEditor({ kind: "category", value: category })
                }
                onDelete={(id) => remove("category", id)}
                onAdd={() => setEditor({ kind: "category" })}
                onAccount={() => setEditor({ kind: "account" })}
              />
            </>
          )}
          {view === "recurring" && (
            <section className="flow-panel">
              <div className="flow-panel-heading">
                <div>
                  <h2>Bills & recurring income</h2>
                  <p>
                    Record payments when they happen. Unrecorded overdue items
                    are included in today’s forecast.
                  </p>
                </div>
                <button
                  className="flow-button primary"
                  disabled={!data.accounts.length}
                  onClick={() => setEditor({ kind: "recurring" })}
                >
                  ＋ Add recurring item
                </button>
              </div>
              {!data.accounts.length ? (
                <Empty
                  title="Start with an account"
                  text="Your recurring items need an account to flow through."
                  action="Add account"
                  onAction={() => setEditor({ kind: "account" })}
                />
              ) : !data.recurring.length ? (
                <Empty
                  title="Make the predictable feel simple"
                  text="Add your rent, subscriptions, bills and payday."
                  action="Add recurring item"
                  onAction={() => setEditor({ kind: "recurring" })}
                />
              ) : (
                <>
                  <div className="flow-recurring-grid">
                    {data.recurring.map((r) => (
                      <article key={r.id}>
                        <div className="flow-recurring-icon" aria-hidden="true">
                          {r.type === "income" ? "↙" : "↗"}
                        </div>
                        <div>
                          <h3>{r.payee}</h3>
                          <p>
                            {accountName(r.accountId)} ·{" "}
                            {r.frequency === "biweekly"
                              ? "Every 2 weeks"
                              : r.frequency}
                          </p>
                          <small>
                            {r.dateConfirmed === false
                              ? "Set due date"
                              : r.active
                                ? "Active"
                                : "Paused"}{" "}
                            · starts {displayDate(r.startDate, true)}
                          </small>
                        </div>
                        <strong
                          className={r.type === "income" ? "positive" : ""}
                        >
                          {r.type === "income" ? "+" : "−"}
                          {fmt(r.amountCents)}
                        </strong>
                        <div className="flow-action-row">
                          <button
                            className="flow-text-button"
                            onClick={() =>
                              setEditor({ kind: "recurring", value: r })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="flow-text-button"
                            onClick={() =>
                              action(() =>
                                save(
                                  {
                                    ...data,
                                    recurring: data.recurring.map((x) =>
                                      x.id === r.id
                                        ? { ...x, active: !x.active }
                                        : x,
                                    ),
                                  },
                                  r.active
                                    ? "Recurring item paused."
                                    : "Recurring item resumed.",
                                ),
                              )
                            }
                          >
                            {r.active ? "Pause" : "Resume"}
                          </button>
                          <button
                            className="flow-text-button danger"
                            aria-label={`Remove ${r.payee} recurring item`}
                            onClick={() => remove("recurring", r.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <h3 className="flow-section-label">
                    Pending through the next {horizon} days
                  </h3>
                  <ul className="flow-due-list">
                    {dueItems(data, addDays(TODAY(), horizon))
                      .slice(0, 30)
                      .map((item) => (
                        <DueRow
                          key={item.key}
                          item={item}
                          currency={data.currency}
                          onRecord={() =>
                            setEditor({ kind: "entry", due: item })
                          }
                          onSkip={() =>
                            action(() =>
                              save(
                                {
                                  ...data,
                                  skipped: [...data.skipped, item.key],
                                },
                                "Occurrence skipped.",
                              ),
                            )
                          }
                        />
                      ))}
                  </ul>
                  <p className="flow-help">
                    Showing up to 30 pending occurrences.
                  </p>
                </>
              )}
              {data.skipped.length > 0 && (
                <details className="flow-details">
                  <summary>Skipped occurrences ({data.skipped.length})</summary>
                  {data.skipped.map((key) => {
                    const split = key.lastIndexOf(":");
                    return (
                      <div className="flow-skipped" key={key}>
                        <span>
                          {data.recurring.find(
                            (r) => r.id === key.slice(0, split),
                          )?.payee ?? "Recurring item"}{" "}
                          · {key.slice(split + 1)}
                        </span>
                        <button
                          className="flow-text-button"
                          onClick={() =>
                            action(() =>
                              save(
                                {
                                  ...data,
                                  skipped: data.skipped.filter(
                                    (k) => k !== key,
                                  ),
                                },
                                "Occurrence restored.",
                              ),
                            )
                          }
                        >
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </details>
              )}
            </section>
          )}
          {view === "accounts" && (
            <>
              <div className="flow-stats three">
                <Stat
                  label="Total tracked balance"
                  value={fmt(balance(data))}
                  detail="Account snapshots; no investment returns assumed"
                />
                <Stat
                  label="Cash-flow balance"
                  value={fmt(cashBalance(data))}
                  detail="Only accounts included in combined forecast"
                  accent
                />
                <Stat
                  label="Tracked outside cash flow"
                  value={fmt(balance(data) - cashBalance(data))}
                  detail="Savings, investments and earmarked assets"
                />
              </div>
              <div className="flow-panel-heading">
                <p className="flow-help">
                  Balances reflect opening balances and dated transactions, not
                  live bank feeds.
                </p>
                <button
                  className="flow-button primary"
                  onClick={() => setEditor({ kind: "account" })}
                >
                  ＋ Add account
                </button>
              </div>
              {data.accounts.length ? (
                <div className="flow-account-grid">
                  {data.accounts.map((a) => (
                    <article className="flow-panel" key={a.id}>
                      <div className="flow-account-icon" aria-hidden="true">
                        {a.type === "Savings"
                          ? "◇"
                          : a.type === "Credit card"
                            ? "▰"
                            : "▣"}
                      </div>
                      <p className="flow-eyebrow">
                        {a.type} ·{" "}
                        {a.type === "Investment" ||
                        a.includeInForecast === false
                          ? "Tracked only"
                          : "Cash flow"}
                      </p>
                      <h2>{a.name}</h2>
                      <strong
                        className={`flow-account-balance ${a.balanceConfirmed !== false && balance(data, TODAY(), a.id) < 0 ? "negative" : ""}`}
                      >
                        {a.balanceConfirmed === false
                          ? "Balance needed"
                          : fmt(balance(data, TODAY(), a.id))}
                      </strong>
                      <p>
                        Opening {fmt(a.openingCents)} ·{" "}
                        {displayDate(a.openingDate, true)}
                      </p>
                      <div className="flow-action-row">
                        <button
                          className="flow-button"
                          onClick={() =>
                            setEditor({ kind: "account", value: a })
                          }
                        >
                          Edit account
                        </button>
                        <button
                          className="flow-text-button danger"
                          aria-label={`Remove ${a.name} account`}
                          onClick={() => remove("account", a.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="An account is your starting point"
                  text="Add a checking, savings, cash or credit-card account."
                  action="Add account"
                  onAction={() => setEditor({ kind: "account" })}
                />
              )}
            </>
          )}
          {view === "reports" && (
            <>
              <div className="flow-stats three">
                <Stat
                  label="Income"
                  value={fmt(totals.income)}
                  detail={monthName}
                  accent
                />
                <Stat
                  label="Spending"
                  value={fmt(totals.spent)}
                  detail={monthName}
                />
                <Stat
                  label="Net cash flow"
                  value={fmt(totals.income - totals.spent)}
                  detail="Income less expenses · transfers excluded"
                  negative={totals.spent > totals.income}
                />
              </div>
              <div className="flow-two-columns">
                <section className="flow-panel">
                  <div className="flow-panel-heading">
                    <h2>Spending by category</h2>
                    <button
                      className="flow-button"
                      onClick={() => window.print()}
                    >
                      Print report
                    </button>
                  </div>
                  <SpendingList data={data} month={month} />
                </section>
                <section className="flow-panel">
                  <div className="flow-panel-heading">
                    <div>
                      <h2>Six-month view</h2>
                      <p>Recorded income and expenses</p>
                    </div>
                  </div>
                  <div className="flow-month-report">
                    {Array.from({ length: 6 }, (_, i) =>
                      nextMonth(month, i - 5),
                    ).map((m) => {
                      const t = monthTotals(data, m),
                        max = Math.max(t.income, t.spent, 1);
                      return (
                        <div key={m}>
                          <strong>
                            {new Date(
                              Number(m.slice(0, 4)),
                              Number(m.slice(5)) - 1,
                              1,
                            ).toLocaleDateString("en-CA", {
                              month: "short",
                              year: "2-digit",
                            })}
                          </strong>
                          <div>
                            <span
                              className="income"
                              style={{ width: `${(t.income / max) * 100}%` }}
                            />
                            <small>Income {fmt(t.income)}</small>
                            <span
                              className="expense"
                              style={{ width: `${(t.spent / max) * 100}%` }}
                            />
                            <small>Spent {fmt(t.spent)}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "scenarios" && (
            <Scenarios
              data={data}
              onSave={(next) => save(next, "Scenario saved.")}
            />
          )}
          {view === "settings" && (
            <Settings
              key={data.currency + ":" + data.reserveCents}
              data={data}
              onSave={(next) => save(next, "Settings saved.")}
              onBackup={exportBackup}
              onRestore={(value) => setEditor({ kind: "restore", value })}
            />
          )}
          <footer className="flow-footer">
            <span>FlowBudget · built for a little peace of mind.</span>
            <button onClick={exportBackup}>Export backup</button>
            <span>Stored on this device. Back up regularly.</span>
          </footer>
        </main>
      </div>
      {editor && (
        <BudgetEditor
          key={
            editor.kind +
            ("value" in editor
              ? ((editor.value as { id?: string })?.id ?? "new")
              : "new")
          }
          editor={editor}
          data={data}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  negative,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  negative?: boolean;
  accent?: boolean;
}) {
  return (
    <article className={`flow-stat ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong className={negative ? "negative" : ""}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flow-empty">
      <span aria-hidden="true">◌</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="flow-button" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
function AccountFilter({
  data,
  value,
  set,
  cashFlow = false,
}: {
  cashFlow?: boolean;
  data: BudgetData;
  value: string;
  set: (id: string) => void;
}) {
  return (
    <label>
      <span className="flow-sr-only">Account filter</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="all">
          {cashFlow ? "Cash-flow accounts" : "All accounts"}
        </option>
        {data.accounts
          .filter(
            (a) =>
              !cashFlow ||
              (a.includeInForecast !== false && a.type !== "Investment"),
          )
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </label>
  );
}
function DueRow({
  item,
  currency,
  onRecord,
  onSkip,
}: {
  item: DueItem;
  currency: string;
  onRecord: () => void;
  onSkip: () => void;
}) {
  const date = new Date(
    Number(item.date.slice(0, 4)),
    Number(item.date.slice(5, 7)) - 1,
    Number(item.date.slice(8)),
    12,
  );
  return (
    <li className="flow-due-row">
      <div className="flow-date-tile">
        <span>{date.toLocaleDateString("en-CA", { month: "short" })}</span>
        <strong>{date.getDate()}</strong>
      </div>
      <div className="flow-due-info">
        <strong>{item.rule.payee}</strong>
        <small className={item.date < TODAY() ? "negative" : ""}>
          {item.date < TODAY() ? "Overdue · " : ""}
          {item.rule.type === "income" ? "Expected income" : "Scheduled bill"}
        </small>
      </div>
      <strong className={item.rule.type === "income" ? "positive" : ""}>
        {item.rule.type === "income" ? "+" : "−"}
        {money(item.rule.amountCents, currency)}
      </strong>
      <div className="flow-action-row">
        <button
          className="flow-text-button"
          aria-label={`Record ${item.rule.payee} due ${item.date}`}
          onClick={onRecord}
        >
          Record
        </button>
        <button
          className="flow-text-button muted"
          aria-label={`Skip ${item.rule.payee} due ${item.date}`}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </li>
  );
}
function Ledger({
  data,
  entries,
  onEdit,
  onDelete,
}: {
  data: BudgetData;
  entries: Entry[];
  onEdit: (e: Entry) => void;
  onDelete: (id: string) => void;
}) {
  return entries.length ? (
    <div className="flow-table-scroll">
      <table className="flow-ledger">
        <thead>
          <tr>
            <th>Description</th>
            <th>Date</th>
            <th>Category / account</th>
            <th>Status</th>
            <th className="amount">Amount</th>
            <th>
              <span className="flow-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <strong>{e.payee}</strong>
                {e.note && <small>{e.note}</small>}
              </td>
              <td>{displayDate(e.date, true)}</td>
              <td>
                <span>
                  {e.type === "transfer"
                    ? `Transfer to ${data.accounts.find((a) => a.id === e.toAccountId)?.name}`
                    : data.categories.find((c) => c.id === e.categoryId)?.name}
                </span>
                <small>
                  {data.accounts.find((a) => a.id === e.accountId)?.name}
                </small>
              </td>
              <td>
                <span
                  className={`flow-tag ${e.date > TODAY() ? "scheduled" : ""}`}
                >
                  {e.date > TODAY()
                    ? "Scheduled"
                    : e.cleared
                      ? "Cleared"
                      : "Uncleared"}
                </span>
              </td>
              <td className={`amount ${e.type === "income" ? "positive" : ""}`}>
                {e.type === "income"
                  ? "+"
                  : e.type === "transfer"
                    ? "↔ "
                    : "−"}
                {money(e.amountCents, data.currency)}
              </td>
              <td>
                <div className="flow-action-row">
                  <button
                    className="flow-text-button"
                    aria-label={`Edit ${e.payee} transaction`}
                    onClick={() => onEdit(e)}
                  >
                    Edit
                  </button>
                  <button
                    className="flow-icon-button danger"
                    aria-label={`Delete ${e.payee} transaction`}
                    onClick={() => onDelete(e.id)}
                  >
                    ×
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="A clean slate"
      text="No transactions in this view. Add one or import a CSV to get started."
    />
  );
}
function SpendingList({ data, month }: { data: BudgetData; month: string }) {
  const rows = data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({ category: c, cents: categorySpent(data, c.id, month) }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const max = Math.max(...rows.map((r) => r.cents), 1);
  return rows.length ? (
    <div className="flow-spending-list">
      {rows.map(({ category, cents }) => (
        <div key={category.id}>
          <div>
            <span>
              <i style={{ background: category.color }} />
              {category.name}
            </span>
            <strong>{money(cents, data.currency)}</strong>
          </div>
          <div className="flow-progress">
            <span
              style={{
                width: `${(cents / max) * 100}%`,
                background: category.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      title="No spending recorded"
      text="Your category breakdown will appear as you add expenses."
    />
  );
}
function Settings({
  data,
  onSave,
  onBackup,
  onRestore,
}: {
  data: BudgetData;
  onSave: (data: BudgetData) => void;
  onBackup: () => void;
  onRestore: (data: BudgetData) => void;
}) {
  const [currency, setCurrency] = useState(data.currency),
    [reserve, setReserve] = useState((data.reserveCents / 100).toFixed(2)),
    [error, setError] = useState("");
  return (
    <div className="flow-settings-grid">
      <section className="flow-panel">
        <h2>Planning preferences</h2>
        <form
          className="flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            try {
              const reserveCents = parseMoney(reserve, true);
              if (reserveCents < 0)
                throw new Error("Reserve must be zero or positive.");
              onSave({ ...data, currency, reserveCents });
            } catch (err) {
              setError(String(err));
            }
          }}
        >
          <label>
            Currency
            <select
              value={currency}
              onChange={(e) =>
                setCurrency(e.target.value as BudgetData["currency"])
              }
            >
              {["CAD", "USD", "GBP", "EUR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <small>
              All accounts use one currency. Changing this label does not
              convert amounts.
            </small>
          </label>
          <label>
            Reserve floor
            <input
              inputMode="decimal"
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
            />
            <small>
              A buffer you want to keep. Room above reserve is the lowest
              forecast balance minus this amount.
            </small>
          </label>
          <footer className="flow-wide">
            <button className="flow-button primary">Save preferences</button>
          </footer>
        </form>
      </section>
      <section className="flow-panel">
        <h2>Your data, your copy.</h2>
        <p>
          Data stays in this browser on this device. It does not sync to another
          device or to Emily/Nick profiles. No bank login is collected.
        </p>
        <p>
          Download a backup before clearing browser data or switching devices. A
          JSON backup preserves accounts, transactions, recurring schedules and
          budgets.
        </p>
        <div className="flow-action-row">
          <button className="flow-button primary" onClick={onBackup}>
            Download JSON backup
          </button>
          <button
            className="flow-button"
            onClick={() =>
              downloadFile(
                `flowbudget-transactions-${TODAY()}.csv`,
                exportCSV(data),
                "text/csv;charset=utf-8",
              )
            }
          >
            Export all transactions
          </button>
        </div>
        <label className="flow-file-label">
          Restore JSON backup
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError("");
              try {
                if (file.size > 10000000)
                  throw new Error("Backup must be under 10 MB.");
                onRestore(validateBudget(JSON.parse(await file.text())));
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Invalid backup file.",
                );
              }
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="flow-text-button"
          onClick={() => {
            try {
              const raw = localStorage.getItem(BUDGET_KEY);
              if (!raw) throw new Error("No saved file exists on this device.");
              downloadFile(
                `flowbudget-saved-${TODAY()}.json`,
                raw,
                "application/json",
              );
            } catch (err) {
              setError(String(err));
            }
          }}
        >
          Download original saved file
        </button>
      </section>
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
      <section className="flow-panel flow-wide">
        <h2>How the forecast works</h2>
        <p>
          Starting from your recorded balance, FlowBudget adds future-dated
          transactions and active recurring income, and subtracts scheduled
          bills. Overdue, unrecorded recurring items are applied to today.
          Matching a transaction to its scheduled occurrence prevents double
          counting.
        </p>
        <p>
          Unplanned spending, interest, bank fees and changing income are not
          predicted. Credit-card debt should be entered as a negative opening
          balance, and payments between your accounts should be recorded as
          transfers. Use the account filter to forecast a specific account.
        </p>
      </section>
    </div>
  );
}
