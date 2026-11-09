import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  TODAY,
  parseMoney,
  validateEntry,
  validateBudget,
  type Account,
  type AccountType,
  type BudgetData,
  type Category,
  type Entry,
  type EntryType,
  type Recurring,
  type Frequency,
  type DueItem,
} from "./model";
import {
  readCSV,
  detectColumns,
  previewCSV,
  type Columns,
  type DateFormat,
} from "./csv";
export type Editor =
  | { kind: "account"; value?: Account }
  | { kind: "entry"; value?: Entry; due?: DueItem }
  | { kind: "recurring"; value?: Recurring }
  | { kind: "category"; value?: Category }
  | { kind: "import" }
  | { kind: "restore"; value: BudgetData; setup?: boolean };
export interface FormProps {
  data: BudgetData;
  onSave: (data: BudgetData, message: string, replacing?: boolean) => void;
  onClose: () => void;
}
export function BudgetModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    ref.current
      ?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea")
      ?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function close() {
    if (dirty.current && !window.confirm("Discard your unsaved changes?"))
      return;
    onClose();
  }
  return (
    <dialog
      className="flow-modal"
      ref={ref}
      aria-labelledby="flow-dialog-title"
      onChange={() => {
        dirty.current = true;
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <span className="flow-eyebrow">FlowBudget</span>
          <h2 id="flow-dialog-title">{title}</h2>
        </div>
        <button
          className="flow-icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={close}
        >
          ✕
        </button>
      </header>
      <div className="flow-modal-body">{children}</div>
    </dialog>
  );
}
function Form({
  children,
  save,
  label = "Save",
  note,
}: {
  children: ReactNode;
  save: () => void;
  label?: string;
  note?: string;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="flow-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError("");
        try {
          save();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not save. Your draft is preserved.",
          );
        }
      }}
    >
      {children}
      {note && <p className="flow-help flow-wide">{note}</p>}
      {error && (
        <p className="flow-error flow-wide" role="alert">
          {error}
        </p>
      )}
      <footer className="flow-wide">
        <button className="flow-button primary" type="submit">
          {label}
        </button>
      </footer>
    </form>
  );
}
function upsert<T extends { id: string }>(items: T[], item: T) {
  return items.some((x) => x.id === item.id)
    ? items.map((x) => (x.id === item.id ? item : x))
    : [...items, item];
}
export function AccountForm({
  data,
  value,
  onSave,
}: FormProps & { value?: Account }) {
  const [draft, set] = useState<Account>(
    value ?? {
      id: crypto.randomUUID(),
      name: "",
      type: "Checking",
      openingCents: 0,
      openingDate: TODAY().slice(0, 7) + "-01",
    },
  );
  const [amount, setAmount] = useState((draft.openingCents / 100).toFixed(2));
  return (
    <Form
      label={value ? "Save account" : "Create account"}
      save={() => {
        const account = {
          ...draft,
          name: draft.name.trim(),
          openingCents: parseMoney(amount, true),
          balanceConfirmed: true,
        };
        onSave(
          validateBudget({ ...data, accounts: upsert(data.accounts, account) }),
          "Account saved.",
        );
      }}
      note="Opening balance is the balance at the start of this date, before any entered transactions. Enter credit-card debt as a negative balance. Transactions before this date cannot be imported."
    >
      <label className="flow-wide">
        Account name
        <input
          required
          maxLength={150}
          value={draft.name}
          onChange={(e) => set({ ...draft, name: e.target.value })}
          placeholder="e.g. Everyday checking"
        />
      </label>
      <label>
        Account type
        <select
          value={draft.type}
          onChange={(e) =>
            set({
              ...draft,
              type: e.target.value as AccountType,
              includeInForecast: e.target.value !== "Investment",
            })
          }
        >
          {["Checking", "Savings", "Credit card", "Cash", "Investment"].map(
            (t) => (
              <option key={t}>{t}</option>
            ),
          )}
        </select>
      </label>
      <label>
        Opening balance
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {value?.balanceConfirmed === false && (
        <label className="flow-check flow-wide">
          <input required type="checkbox" />I have entered the actual opening
          balance.
        </label>
      )}
      <label className="flow-check flow-wide">
        <input
          type="checkbox"
          checked={
            draft.type !== "Investment" && draft.includeInForecast !== false
          }
          disabled={draft.type === "Investment"}
          onChange={(e) =>
            set({ ...draft, includeInForecast: e.target.checked })
          }
        />
        Include in combined cash-flow forecast
      </label>
      <label>
        Opening date
        <input
          required
          type="date"
          max={TODAY()}
          value={draft.openingDate}
          onChange={(e) => set({ ...draft, openingDate: e.target.value })}
        />
      </label>
    </Form>
  );
}
export function EntryForm({
  data,
  value,
  due,
  onSave,
}: FormProps & { value?: Entry; due?: DueItem }) {
  const rule = due?.rule;
  const [draft, set] = useState<Entry>(
    value ?? {
      id: crypto.randomUUID(),
      accountId: rule?.accountId ?? data.accounts[0]?.id ?? "",
      type: rule?.type ?? "expense",
      amountCents: rule?.amountCents ?? 0,
      date: TODAY(),
      payee: rule?.payee ?? "",
      categoryId: rule?.categoryId ?? "",
      note: "",
      cleared: true,
      ...(due ? { recurringId: rule!.id, occurrenceDate: due.date } : {}),
    },
  );
  const [amount, setAmount] = useState(
    draft.amountCents ? (draft.amountCents / 100).toFixed(2) : "",
  );
  const matches = data.recurring.filter(
    (r) => r.accountId === draft.accountId && r.type === draft.type,
  );
  return (
    <Form
      label={value ? "Save transaction" : "Add transaction"}
      save={() => {
        const entry = {
          ...draft,
          payee: draft.payee.trim(),
          amountCents: parseMoney(amount),
          ...(draft.type === "transfer"
            ? {
                categoryId: "",
                recurringId: undefined,
                occurrenceDate: undefined,
              }
            : { toAccountId: undefined }),
        };
        validateEntry(entry, data);
        onSave(
          { ...data, entries: upsert(data.entries, entry) },
          "Transaction saved.",
        );
      }}
      note="Transfers move money between accounts without counting as income or spending. Match a recurring item to stop its forecast occurrence being counted again."
    >
      <label>
        Transaction type
        <select
          value={draft.type}
          onChange={(e) =>
            set({
              ...draft,
              type: e.target.value as EntryType,
              categoryId: "",
              recurringId: undefined,
              occurrenceDate: undefined,
            })
          }
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label>
        Amount
        <input
          required
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Account
        <select
          required
          value={draft.accountId}
          onChange={(e) =>
            set({
              ...draft,
              accountId: e.target.value,
              recurringId: undefined,
              occurrenceDate: undefined,
            })
          }
        >
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input
          required
          type="date"
          value={draft.date}
          onChange={(e) => set({ ...draft, date: e.target.value })}
        />
      </label>
      <label className="flow-wide">
        Description
        <input
          required
          maxLength={150}
          value={draft.payee}
          onChange={(e) => set({ ...draft, payee: e.target.value })}
          placeholder="e.g. Weekly groceries"
        />
      </label>
      {draft.type === "transfer" ? (
        <label className="flow-wide">
          Destination account
          <select
            required
            value={draft.toAccountId ?? ""}
            onChange={(e) => set({ ...draft, toAccountId: e.target.value })}
          >
            <option value="">Choose an account</option>
            {data.accounts
              .filter((a) => a.id !== draft.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <label className="flow-wide">
          Category
          <select
            required
            value={draft.categoryId}
            onChange={(e) => set({ ...draft, categoryId: e.target.value })}
          >
            <option value="">Choose a category</option>
            {data.categories
              .filter((c) => c.kind === draft.type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {draft.type !== "transfer" && matches.length > 0 && (
        <>
          <label className="flow-wide">
            Matches recurring item
            <select
              value={draft.recurringId ?? ""}
              onChange={(e) =>
                set({
                  ...draft,
                  recurringId: e.target.value || undefined,
                  occurrenceDate: e.target.value ? draft.date : undefined,
                })
              }
            >
              <option value="">None — standalone transaction</option>
              {matches.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.payee}
                </option>
              ))}
            </select>
          </label>
          {draft.recurringId && (
            <label>
              Scheduled due date
              <input
                required
                type="date"
                value={draft.occurrenceDate ?? draft.date}
                onChange={(e) =>
                  set({ ...draft, occurrenceDate: e.target.value })
                }
              />
            </label>
          )}
        </>
      )}
      <label className="flow-wide">
        Notes
        <textarea
          maxLength={2000}
          value={draft.note}
          onChange={(e) => set({ ...draft, note: e.target.value })}
        />
      </label>
      <label className="flow-check flow-wide">
        <input
          type="checkbox"
          checked={draft.cleared}
          onChange={(e) => set({ ...draft, cleared: e.target.checked })}
        />
        Cleared on my statement
      </label>
    </Form>
  );
}
export function RecurringForm({
  data,
  value,
  onSave,
}: FormProps & { value?: Recurring }) {
  const [draft, set] = useState<Recurring>(
    value ?? {
      id: crypto.randomUUID(),
      accountId: data.accounts[0]?.id ?? "",
      type: "expense",
      amountCents: 0,
      payee: "",
      categoryId: "",
      frequency: "monthly",
      startDate: TODAY(),
      endDate: "",
      active: true,
    },
  );
  const [amount, setAmount] = useState(
    draft.amountCents ? (draft.amountCents / 100).toFixed(2) : "",
  );
  return (
    <Form
      label={value ? "Save recurring item" : "Create recurring item"}
      save={() => {
        const recurring = {
          ...draft,
          payee: draft.payee.trim(),
          amountCents: parseMoney(amount),
        };
        onSave(
          validateBudget({
            ...data,
            recurring: upsert(data.recurring, recurring),
          }),
          "Recurring item saved.",
        );
      }}
      note="The next due date anchors the schedule. Monthly payments stay on the original day, or the last day of a shorter month. These are forecasts until you record them. For a rule with recorded payments, pause it and create a replacement before changing its account or schedule."
    >
      <label className="flow-wide">
        Bill or income name
        <input
          required
          maxLength={150}
          value={draft.payee}
          onChange={(e) => set({ ...draft, payee: e.target.value })}
          placeholder="e.g. Rent or Payday"
        />
      </label>
      <label>
        Type
        <select
          value={draft.type}
          onChange={(e) =>
            set({
              ...draft,
              type: e.target.value as Recurring["type"],
              categoryId: "",
            })
          }
        >
          <option value="expense">Bill / expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <label>
        Amount
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Account
        <select
          required
          value={draft.accountId}
          onChange={(e) => set({ ...draft, accountId: e.target.value })}
        >
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Frequency
        <select
          value={draft.frequency}
          onChange={(e) =>
            set({ ...draft, frequency: e.target.value as Frequency })
          }
        >
          {["weekly", "biweekly", "monthly", "quarterly", "yearly"].map((f) => (
            <option key={f} value={f}>
              {f === "biweekly"
                ? "Every two weeks (14 days)"
                : f[0].toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="flow-wide">
        Category
        <select
          required
          value={draft.categoryId}
          onChange={(e) => set({ ...draft, categoryId: e.target.value })}
        >
          <option value="">Choose a category</option>
          {data.categories
            .filter((c) => c.kind === draft.type)
            .map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        {value ? "Schedule start date" : "Next due date"}
        <input
          required
          type="date"
          value={draft.startDate}
          onChange={(e) => set({ ...draft, startDate: e.target.value })}
        />
      </label>
      <label className="flow-wide">
        Posting day adjustment
        <select
          value={draft.businessDay ?? "none"}
          onChange={(e) =>
            set({
              ...draft,
              businessDay: e.target.value as Recurring["businessDay"],
            })
          }
        >
          <option value="none">None — keep the scheduled date</option>
          <option value="weekdays">Next weekday (weekends only)</option>
          <option value="canada-on">
            Next Canadian/Ontario bank business day
          </option>
        </select>
        <small>
          Estimates bank processing dates; actual posting can vary by
          institution.
        </small>
      </label>
      <label>
        End date (optional)
        <input
          type="date"
          min={draft.startDate}
          value={draft.endDate}
          onChange={(e) => set({ ...draft, endDate: e.target.value })}
        />
      </label>
      {draft.dateConfirmed === false && (
        <label className="flow-check flow-wide">
          <input
            type="checkbox"
            checked={false}
            onChange={(e) => set({ ...draft, dateConfirmed: e.target.checked })}
          />
          I have confirmed this item’s scheduled dates.
        </label>
      )}
      <label className="flow-check flow-wide">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => set({ ...draft, active: e.target.checked })}
        />
        Active in forecast
      </label>
    </Form>
  );
}
export function CategoryForm({
  data,
  value,
  onSave,
}: FormProps & { value?: Category }) {
  const [draft, set] = useState<Category>(
    value ?? {
      id: crypto.randomUUID(),
      name: "",
      kind: "expense",
      color: "#4b6bdb",
      defaultLimitCents: 0,
    },
  );
  const [limit, setLimit] = useState(
    (draft.defaultLimitCents / 100).toFixed(2),
  );
  return (
    <Form
      label={value ? "Save category" : "Create category"}
      save={() => {
        const category = {
          ...draft,
          name: draft.name.trim(),
          defaultLimitCents: parseMoney(limit, true),
        };
        if (category.defaultLimitCents < 0)
          throw new Error("Budget must be zero or positive.");
        onSave(
          validateBudget({
            ...data,
            categories: upsert(data.categories, category),
          }),
          "Category saved.",
        );
      }}
    >
      <label className="flow-wide">
        Category name
        <input
          required
          maxLength={150}
          value={draft.name}
          onChange={(e) => set({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        Category type
        <select
          value={draft.kind}
          onChange={(e) =>
            set({ ...draft, kind: e.target.value as Category["kind"] })
          }
        >
          <option value="expense">Spending</option>
          <option value="income">Income</option>
        </select>
      </label>
      <label>
        Colour
        <input
          type="color"
          value={draft.color}
          onChange={(e) => set({ ...draft, color: e.target.value })}
        />
      </label>
      <label className="flow-wide">
        {draft.kind === "income"
          ? "Default monthly income target"
          : "Default monthly budget"}
        <input
          required
          inputMode="decimal"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <small>
          Used for months without an individual plan. Zero means unplanned.
        </small>
      </label>
      <label>
        Group
        <input
          maxLength={30}
          value={draft.group ?? ""}
          onChange={(e) => set({ ...draft, group: e.target.value })}
          placeholder="e.g. Fixed bills"
        />
      </label>
      <label className="flow-wide">
        Category notes
        <textarea
          maxLength={500}
          value={draft.note ?? ""}
          onChange={(e) => set({ ...draft, note: e.target.value })}
        />
      </label>
    </Form>
  );
}
export function CSVImport({ data, onSave }: FormProps) {
  const [rows, setRows] = useState<string[][]>([]),
    [columns, setColumns] = useState<Columns | null>(null),
    [account, setAccount] = useState(data.accounts[0]?.id ?? ""),
    [format, setFormat] = useState<DateFormat>("ISO"),
    [duplicates, setDuplicates] = useState(false),
    [error, setError] = useState("");
  let preview: ReturnType<typeof previewCSV> = [];
  let previewError = "";
  try {
    if (columns && rows.length)
      preview = previewCSV(rows, columns, account, format, data);
  } catch (e) {
    previewError = (e as Error).message;
  }
  const valid = preview.filter((r) => r.entry && (!r.duplicate || duplicates));
  return (
    <>
      <p className="flow-help">
        Import a bank CSV into one account. Positive amounts are income;
        negative amounts are spending. You can map separate positive Debit and
        Credit columns instead. Review transfers and match recurring payments
        after importing.
      </p>
      <label className="flow-file-label">
        Choose CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError("");
            try {
              if (file.size > 5000000)
                throw new Error("CSV must be under 5 MB.");
              const parsed = readCSV(await file.text());
              if (parsed.length < 2)
                throw new Error(
                  "CSV needs a header row and at least one transaction.",
                );
              setRows(parsed);
              setColumns(detectColumns(parsed[0]));
            } catch (err) {
              setError(String(err));
            }
          }}
        />
      </label>
      {rows.length > 0 && columns && (
        <Form
          label={`Import ${valid.length} transactions`}
          save={() => {
            if (previewError) throw new Error(previewError);
            if (!valid.length)
              throw new Error("No valid, selected transactions to import.");
            onSave(
              validateBudget({
                ...data,
                entries: [...data.entries, ...valid.map((r) => r.entry!)],
              }),
              `${valid.length} transactions imported.`,
            );
          }}
        >
          <label>
            Import into account
            <select
              required
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date format
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as DateFormat)}
            >
              <option value="ISO">YYYY-MM-DD</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          {(Object.keys(columns) as Array<keyof Columns>).map((key) => (
            <label key={key}>
              {
                {
                  date: "Date column",
                  payee: "Description column",
                  amount: "Signed amount column",
                  debit: "Debit column",
                  credit: "Credit column",
                  category: "Category column",
                  note: "Notes column",
                }[key]
              }
              <select
                value={columns[key]}
                onChange={(e) =>
                  setColumns({ ...columns, [key]: +e.target.value })
                }
              >
                <option value={-1}>
                  {["date", "payee"].includes(key)
                    ? "Select column"
                    : "Not used"}
                </option>
                {rows[0].map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="flow-check flow-wide">
            <input
              type="checkbox"
              checked={duplicates}
              onChange={(e) => setDuplicates(e.target.checked)}
            />
            Include potential duplicates (normally skipped)
          </label>
          <p className="flow-help flow-wide">
            {valid.length} ready · {preview.filter((r) => r.duplicate).length}{" "}
            potential duplicates · {preview.filter((r) => r.error).length}{" "}
            invalid rows. Invalid rows are not imported. Unknown categories go
            to Other.
          </p>
          {previewError && (
            <p className="flow-error flow-wide" role="alert">
              {previewError}
            </p>
          )}
          <div className="flow-table-scroll flow-wide">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Description</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.entry?.payee ?? "—"}</td>
                    <td>
                      {r.error ??
                        (r.duplicate
                          ? "Potential duplicate"
                          : `${r.entry!.date} · ${r.entry!.type}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flow-help flow-wide">
            Preview shows the first 50 rows; the import count includes all valid
            rows.
          </p>
        </Form>
      )}
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function BudgetEditor({
  editor,
  ...props
}: FormProps & { editor: Editor }) {
  const titles = {
    account:
      editor.kind === "account" && editor.value
        ? "Edit account"
        : "Add an account",
    entry:
      editor.kind === "entry" && editor.value
        ? "Edit transaction"
        : "Add a transaction",
    recurring:
      editor.kind === "recurring" && editor.value
        ? "Edit recurring item"
        : "Add recurring bill or income",
    category:
      editor.kind === "category" && editor.value
        ? "Edit category"
        : "Add a category",
    import: "Import transactions",
    restore:
      editor.kind === "restore" && editor.setup
        ? "Load your budget plan"
        : "Restore budget backup",
  };
  return (
    <BudgetModal title={titles[editor.kind]} onClose={props.onClose}>
      {editor.kind === "account" ? (
        <AccountForm {...props} value={editor.value} />
      ) : editor.kind === "entry" ? (
        <EntryForm {...props} value={editor.value} due={editor.due} />
      ) : editor.kind === "recurring" ? (
        <RecurringForm {...props} value={editor.value} />
      ) : editor.kind === "category" ? (
        <CategoryForm {...props} value={editor.value} />
      ) : editor.kind === "import" ? (
        <CSVImport {...props} />
      ) : (
        <Form
          label={
            editor.setup
              ? "Load household plan"
              : "Replace this device’s budget"
          }
          save={() =>
            props.onSave(
              { ...editor.value, revision: props.data.revision },
              "Budget restored.",
              true,
            )
          }
          note="This replaces the budget stored on this device. Export a backup of your current budget before proceeding."
        >
          <p className="flow-wide">
            Backup contains {editor.value.accounts.length} accounts,{" "}
            {editor.value.entries.length} transactions, and{" "}
            {editor.value.recurring.length} recurring items. Currency:{" "}
            {editor.value.currency}.
          </p>
          {(props.data.accounts.length > 0 ||
            props.data.entries.length > 0) && (
            <label className="flow-check flow-wide">
              <input required type="checkbox" />I understand this replaces my
              current budget.
            </label>
          )}
        </Form>
      )}
    </BudgetModal>
  );
}
