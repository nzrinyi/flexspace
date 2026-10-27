import { useRef, useState, type FormEvent } from "react";
import type { DealQuoteDocument, ScoredVehicle } from "../types";
import {
  calculateFinance,
  DEFAULT_FINANCE,
  localDate,
  money,
  type FinanceSettings,
} from "../domain/finance";
export function defaultDealQuote(
  vehicleId: string,
  price = 0,
): DealQuoteDocument {
  return {
    vehicleId,
    dealer: "",
    trim: "",
    price,
    discount: 0,
    fees: 2495,
    accessories: 0,
    tradeIn: 0,
    financeRate: 5.99,
    leaseRate: 6.49,
    expiryDate: "",
    contact: "",
    listingUrl: "",
    accidentHistory: "",
    cpo: false,
    inspectionNotes: "",
  };
}
export function DealTracker({
  initialVehicleId,
  vehicles,
  quotes,
  onSaveQuote,
  settings = DEFAULT_FINANCE,
}: {
  initialVehicleId?: string;
  vehicles: ScoredVehicle[];
  quotes: DealQuoteDocument[];
  onSaveQuote: (quote: DealQuoteDocument) => Promise<void>;
  settings?: FinanceSettings;
}) {
  const [draft, setDraft] = useState(() =>
    defaultDealQuote(
      initialVehicleId ?? vehicles[0]?.id ?? "",
      vehicles.find((v) => v.id === initialVehicleId)?.msrp ??
        vehicles[0]?.msrp,
    ),
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [archived, setArchived] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSaveQuote(draft);
      setMessage("Quote saved.");
      setDraft(
        defaultDealQuote(
          draft.vehicleId,
          vehicles.find((v) => v.id === draft.vehicleId)?.msrp,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }
  async function archive(quote: DealQuoteDocument) {
    setSaving(true);
    setError("");
    try {
      await onSaveQuote({ ...quote, archived: !quote.archived });
      setMessage(
        quote.archived
          ? "Quote restored."
          : "Quote archived. Restore it from Archived quotes.",
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }
  const numeric = (
    key:
      | "price"
      | "discount"
      | "fees"
      | "accessories"
      | "tradeIn"
      | "financeRate"
      | "leaseRate",
    label: string,
  ) => (
    <label>
      {label}
      <input
        required
        type="number"
        min="0"
        step="0.01"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: +e.target.value })}
      />
    </label>
  );
  return (
    <section className="card stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Deal tracker</p>
          <h2>Keep offers on equal terms.</h2>
        </div>
        <button onClick={() => setArchived(!archived)}>
          {archived ? "Active quotes" : "Archived quotes"}
        </button>
      </div>
      <form ref={form} className="calculator-grid deal-form" onSubmit={submit}>
        <fieldset disabled={saving} className="form-fields">
          <label>
            Vehicle
            <select
              value={draft.vehicleId}
              onChange={(e) => {
                const v = vehicles.find((v) => v.id === e.target.value)!;
                setDraft(defaultDealQuote(v.id, v.msrp));
              }}
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dealer
            <input
              required
              value={draft.dealer}
              onChange={(e) => setDraft({ ...draft, dealer: e.target.value })}
            />
          </label>
          <label>
            Trim
            <input
              value={draft.trim}
              onChange={(e) => setDraft({ ...draft, trim: e.target.value })}
            />
          </label>
          {numeric("price", "Vehicle price before tax & fees")}
          {numeric("discount", "Discount")}
          {numeric("fees", "Fees / freight / PDI")}
          {numeric("accessories", "Accessories")}
          {numeric("tradeIn", "Dealer trade-in credit")}
          {numeric("financeRate", "Offered finance APR %")}
          {numeric("leaseRate", "Offered lease rate %")}
          <label>
            Quote expires
            <input
              type="date"
              value={draft.expiryDate}
              onChange={(e) =>
                setDraft({ ...draft, expiryDate: e.target.value })
              }
            />
          </label>
          <label>
            Contact
            <input
              value={draft.contact}
              onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
            />
          </label>
          <label>
            Listing URL
            <input
              type="url"
              pattern="https?://.*"
              value={draft.listingUrl}
              onChange={(e) =>
                setDraft({ ...draft, listingUrl: e.target.value })
              }
            />
          </label>
          <label>
            Used model year
            <input
              type="number"
              min="1980"
              max={new Date().getFullYear() + 2}
              value={draft.usedYear ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  usedYear: e.target.value ? +e.target.value : undefined,
                })
              }
            />
          </label>
          <label>
            Mileage km
            <input
              type="number"
              min="0"
              value={draft.mileageKm ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  mileageKm: e.target.value ? +e.target.value : undefined,
                })
              }
            />
          </label>
          <label>
            Accident history
            <input
              value={draft.accidentHistory ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, accidentHistory: e.target.value })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cpo ?? false}
              onChange={(e) => setDraft({ ...draft, cpo: e.target.checked })}
            />
            Certified pre-owned
          </label>
          <label className="wide">
            Inspection notes
            <textarea
              value={draft.inspectionNotes ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, inspectionNotes: e.target.value })
              }
            />
          </label>
          <div className="wide action-row">
            <button type="submit">
              {saving
                ? "Saving…"
                : draft.id
                  ? "Save quote changes"
                  : "Save quote"}
            </button>
            {draft.id && (
              <button
                type="button"
                onClick={() =>
                  setDraft(
                    defaultDealQuote(
                      draft.vehicleId,
                      vehicles.find((v) => v.id === draft.vehicleId)?.msrp,
                    ),
                  )
                }
              >
                Cancel editing
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <p role="status">{message}</p>
      {error && (
        <p role="alert" className="error-text">
          {error} Your draft is preserved. Retry Save when ready.
        </p>
      )}
      <div className="quote-list">
        {!quotes.some((q) => Boolean(q.archived) === archived) && (
          <p>No {archived ? "archived" : "saved"} quotes yet.</p>
        )}
        {quotes
          .filter((q) => Boolean(q.archived) === archived)
          .map((q) => (
            <article key={q.id}>
              <strong>
                {vehicles.find((v) => v.id === q.vehicleId)?.name} · {q.dealer}
              </strong>
              <span>
                {q.trim || "Trim not specified"} ·{" "}
                {money(calculateFinance(q, settings).outTheDoor)} out-the-door ·{" "}
                {q.financeRate}% offered APR
              </span>
              <span
                className={
                  q.expiryDate && q.expiryDate < localDate() ? "error-text" : ""
                }
              >
                {q.expiryDate
                  ? `${q.expiryDate < localDate() ? "Expired" : "Expires"} ${q.expiryDate}`
                  : "No expiry supplied"}
              </span>
              {q.listingUrl && /^https?:\/\//.test(q.listingUrl) && (
                <a href={q.listingUrl} target="_blank" rel="noreferrer">
                  Open listing
                </a>
              )}
              <div className="action-row">
                <button
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...q });
                    setError("");
                    setMessage("");
                    form.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Edit quote
                </button>
                <button disabled={saving} onClick={() => void archive(q)}>
                  {q.archived ? "Restore" : "Archive"}
                </button>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}
