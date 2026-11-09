import { parseMoney, validDate, type BudgetData, type Entry } from "./model";
export function readCSV(text: string): string[][] {
  if (text.length > 5000000) throw new Error("CSV files must be under 5 MB.");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (cell === "") quoted = true;
      else
        throw new Error(
          "Unexpected quote in CSV. Use standard comma-separated CSV.",
        );
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unfinished quoted field.");
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  if (rows.length > 20001)
    throw new Error("Import up to 20,000 rows at a time.");
  return rows;
}
export interface Columns {
  date: number;
  payee: number;
  amount: number;
  debit: number;
  credit: number;
  category: number;
  note: number;
}
export type DateFormat = "ISO" | "MDY" | "DMY";
export function detectColumns(headers: string[]): Columns {
  const find = (names: string[]) =>
    headers.findIndex((h) => names.includes(h.trim().toLowerCase()));
  return {
    date: find(["date", "transaction date", "posted date"]),
    payee: find(["payee", "description", "merchant", "name"]),
    amount: find(["amount", "signed amount"]),
    debit: find(["debit", "withdrawal", "withdrawals"]),
    credit: find(["credit", "deposit", "deposits"]),
    category: find(["category"]),
    note: find(["note", "notes", "memo"]),
  };
}
export function importDate(raw: string, format: DateFormat) {
  let date = raw.trim();
  if (format !== "ISO") {
    const match = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) throw new Error("Date does not match the selected format.");
    const [, a, b, y] = match;
    date = `${y}-${(format === "MDY" ? a : b).padStart(2, "0")}-${(format === "MDY" ? b : a).padStart(2, "0")}`;
  }
  if (!validDate(date)) throw new Error("Invalid date.");
  return date;
}
export function fingerprint(e: Entry) {
  return [
    e.accountId,
    e.date,
    e.type,
    e.amountCents,
    e.payee.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
}
export interface ImportRow {
  row: number;
  entry?: Entry;
  error?: string;
  duplicate: boolean;
}
export function previewCSV(
  rows: string[][],
  columns: Columns,
  accountId: string,
  format: DateFormat,
  data: BudgetData,
): ImportRow[] {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Choose an account for these transactions.");
  if (
    columns.date < 0 ||
    columns.payee < 0 ||
    (columns.amount < 0 && (columns.debit < 0 || columns.credit < 0))
  )
    throw new Error(
      "Map Date, Description and either Amount or both Debit and Credit columns.",
    );
  const seen = new Set(data.entries.map(fingerprint));
  return rows.slice(1).map((row, i) => {
    try {
      const date = importDate(row[columns.date] ?? "", format);
      if (date < account.openingDate)
        throw new Error(
          `Before the account opening date (${account.openingDate}). Adjust the opening date if importing earlier history.`,
        );
      const payee = (row[columns.payee] ?? "").trim();
      if (!payee || payee.length > 150)
        throw new Error("Description is missing or too long.");
      let amount: number;
      if (columns.amount >= 0)
        amount = parseMoney(row[columns.amount] ?? "", true);
      else {
        const debit = (row[columns.debit] ?? "").trim()
          ? parseMoney(row[columns.debit], true)
          : 0;
        const credit = (row[columns.credit] ?? "").trim()
          ? parseMoney(row[columns.credit], true)
          : 0;
        if (debit < 0 || credit < 0 || (debit && credit))
          throw new Error("Use a positive debit or credit, not both.");
        amount = credit - debit;
      }
      if (!amount) throw new Error("Zero-value transaction.");
      const type = amount > 0 ? "income" : "expense";
      const name = (row[columns.category] ?? "").trim().toLowerCase();
      const category =
        data.categories.find(
          (c) => c.kind === type && c.name.toLowerCase() === name,
        ) ??
        data.categories.find(
          (c) =>
            c.kind === type &&
            c.name.toLowerCase() ===
              (type === "expense" ? "other" : "other income"),
        ) ??
        data.categories.find((c) => c.kind === type);
      if (!category) throw new Error(`Create an ${type} category first.`);
      const entry: Entry = {
        id: crypto.randomUUID(),
        accountId,
        date,
        payee,
        type,
        amountCents: Math.abs(amount),
        categoryId: category.id,
        note: (row[columns.note] ?? "").slice(0, 2000),
        cleared: true,
      };
      const key = fingerprint(entry),
        duplicate = seen.has(key);
      seen.add(key);
      return { row: i + 2, entry, duplicate };
    } catch (e) {
      return {
        row: i + 2,
        error: e instanceof Error ? e.message : "Invalid row.",
        duplicate: false,
      };
    }
  });
}
function escapeCSV(value: string, text = true) {
  const safe = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function exportCSV(data: BudgetData) {
  return [
    [
      "Date",
      "Payee",
      "Amount",
      "Type",
      "Account",
      "Destination account",
      "Category",
      "Note",
      "Cleared",
    ]
      .map((s) => escapeCSV(s))
      .join(","),
    ...data.entries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) =>
        [
          escapeCSV(e.date),
          escapeCSV(e.payee),
          escapeCSV(
            (((e.type === "income" ? 1 : -1) * e.amountCents) / 100).toFixed(2),
            false,
          ),
          escapeCSV(e.type),
          escapeCSV(
            data.accounts.find((a) => a.id === e.accountId)?.name ?? "",
          ),
          escapeCSV(
            data.accounts.find((a) => a.id === e.toAccountId)?.name ?? "",
          ),
          escapeCSV(
            data.categories.find((c) => c.id === e.categoryId)?.name ?? "",
          ),
          escapeCSV(e.note),
          escapeCSV(String(e.cleared)),
        ].join(","),
      ),
  ].join("\r\n");
}
export function downloadFile(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
