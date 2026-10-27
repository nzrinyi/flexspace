import { fitSummary } from "../domain/recommendations";
import { useEffect, useRef, useState } from "react";
import type {
  CriteriaWeights,
  DealQuoteDocument,
  ProfileName,
  ScoredVehicle,
  TestDriveEntry,
  VehicleNoteDocument,
  VehicleStage,
  UserReaction,
} from "../types";
import { explainVehicle } from "../domain/evidence";
import { money, vehicleFinance } from "../domain/finance";
import type { VehicleReadiness } from "../domain/readiness";
const stages: VehicleStage[] = [
  "Browsing",
  "Shortlisted",
  "Test drive booked",
  "Test driven",
  "Quote received",
  "Finalist",
  "Rejected",
  "Winner",
];
export function VehicleDetails({
  vehicle,
  activeProfile,
  isFavorite,
  note,
  entries,
  weights,
  readiness,
  onClose,
  onToggleFavorite,
  onSave,
  onCalculate,
  onPlanDrive,
  onAddQuote,
  focusReview = false,
}: {
  vehicle: ScoredVehicle;
  activeProfile: ProfileName;
  isFavorite: boolean;
  note: VehicleNoteDocument;
  quotes: DealQuoteDocument[];
  entries: TestDriveEntry[];
  weights: CriteriaWeights;
  readiness: VehicleReadiness;
  onClose: () => void;
  onToggleFavorite: () => void;
  onSave: (patch: Partial<VehicleNoteDocument>) => Promise<void>;
  onCalculate: () => void;
  onPlanDrive: () => void;
  onAddQuote: () => void;
  focusReview?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reaction = useRef<HTMLSelectElement>(null);
  const [draft, setDraft] = useState(note.sharedNote),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    if (focusReview) {
      reaction.current?.focus();
      reaction.current?.scrollIntoView({ block: "center" });
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty) setDraft(note.sharedNote);
  }, [note.sharedNote, dirty]);
  const finance = vehicleFinance(vehicle),
    reasons = explainVehicle(vehicle, weights);
  async function save(patch: Partial<VehicleNoteDocument>, isNote = false) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSave(patch);
      if (isNote) setDirty(false);
      setMessage("Saved");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }
  function navigate(action: () => void) {
    if (dirty && !window.confirm("Discard the unsaved note?")) return;
    action();
  }
  function close() {
    if (dirty && !window.confirm("Discard the unsaved note?")) return;
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="vehicle-dialog"
      aria-labelledby="vehicle-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-toolbar">
        <span>Vehicle details</span>
        <button autoFocus onClick={close} aria-label="Close vehicle details">
          Close ✕
        </button>
      </div>
      <div className="dialog-content">
        <p className="eyebrow">
          {vehicle.year} · {vehicle.bodyStyle}
        </p>
        <h1 id="vehicle-title">{vehicle.name}</h1>
        <div className="action-row">
          <button aria-pressed={isFavorite} onClick={onToggleFavorite}>
            {isFavorite ? "★" : "☆"} {activeProfile}'s favourite
          </button>
          <button onClick={() => navigate(onCalculate)}>
            Calculate / save a purchase scenario
          </button>
        </div>
        <div className="action-row">
          <button onClick={() => navigate(onPlanDrive)}>
            Plan a test drive
          </button>
          <button onClick={() => navigate(onAddQuote)}>Add quote</button>
        </div>
        {vehicle.imageUrl && (
          <img
            className="detail-photo"
            src={vehicle.imageUrl}
            alt={`${vehicle.name} exterior; illustrative model photo`}
          />
        )}
        <div className="spec-grid">
          <span>
            Out-the-door estimate<b>{money(finance.outTheDoor)}</b>
          </span>
          <span>
            Total ownership estimate<b>{money(finance.ownership)}/mo</b>
          </span>
          <span>
            Fit<b>{fitSummary(vehicle)}</b>
          </span>
          <span>
            Evidence completeness<b>{vehicle.confidenceScore}%</b>
          </span>
          <span>
            Completed drive rating
            <b>
              {vehicle.hasDriveEvidence
                ? `${vehicle.testDriveScore}/100`
                : "Not evaluated"}
            </b>
          </span>
          <span>
            Deal evidence
            <b>
              {vehicle.hasQuoteEvidence
                ? `${vehicle.dealScore}/100`
                : "No active quote"}
            </b>
          </span>
        </div>
        <p className="muted">
          {finance.source}. Monthly totals use the assumptions in Purchase
          scenarios.
        </p>
        <div className="inline-controls">
          <label>
            Stage
            <select
              disabled={saving}
              value={note.stage}
              onChange={(e) =>
                void save({ stage: e.target.value as VehicleStage })
              }
            >
              {stages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label>
            {activeProfile}'s reaction
            <select
              ref={reaction}
              disabled={saving}
              value={note.reactions[activeProfile]}
              onChange={(e) =>
                void save({
                  reactions: {
                    [activeProfile]: e.target.value as UserReaction,
                  } as Record<ProfileName, UserReaction>,
                })
              }
            >
              {["Unrated", "Love", "Maybe", "No"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              disabled={saving}
              type="checkbox"
              checked={Boolean(note.dealBreaker)}
              onChange={(e) => void save({ dealBreaker: e.target.checked })}
            />
            Explicit deal breaker
          </label>
        </div>
        <section>
          <h2>Why this car?</h2>
          <p>
            Similar fit groups recommendations within three points of the
            highest score in each group. This is a rough planning guide, not a
            statistically meaningful difference. Choose based on costs, your own
            drive, and the watch-outs below.
          </p>
          <details>
            <summary>View underlying planning score</summary>
            <p>
              {vehicle.overallRecommendationScore}/100. Small differences should
              not decide your purchase.
            </p>
          </details>
          <p>
            Family fit is a weighted average of catalogue planning scores. A
            completed drive adds 20% and an active quote adds 10%; missing
            evidence is omitted. Evidence completeness measures checks, not
            vehicle quality.
          </p>
          <ul>
            {reasons.slice(0, 3).map((r) => (
              <li key={r.key}>
                <strong>{r.label}</strong>: {r.score}/100 · shared priority{" "}
                {r.weight.toFixed(1)}/10
              </li>
            ))}
          </ul>
          <details>
            <summary>What could change its ranking?</summary>
            <p>
              Adjust shared priorities, add your own completed-drive ratings, or
              compare an active dealer quote.
            </p>
            <ul>
              {reasons
                .slice()
                .sort((a, b) => a.score - b.score)
                .slice(0, 2)
                .map((r) => (
                  <li key={r.key}>
                    {r.label}: {r.score}/100. Increasing this priority can
                    favour stronger alternatives.
                  </li>
                ))}
            </ul>
          </details>
          <h3>Watch-outs</h3>
          <ul>
            {vehicle.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <h3>Readiness: {readiness.status}</h3>
          <ul>
            {readiness.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ sharedNote: draft }, true);
          }}
        >
          <div className="shared-note">
            <label htmlFor="shared-note-draft">Shared notes</label>
            <textarea
              id="shared-note-draft"
              disabled={saving}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          {dirty && note.sharedNote !== draft && (
            <small>
              Unsaved note. Other profile changes will not discard this draft.
            </small>
          )}
          <button disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save shared note"}
          </button>
        </form>
        <p role="status">{message}</p>
        {error && (
          <p className="error-text" role="alert">
            {error} Your note is preserved; retry Save.
          </p>
        )}
        <section>
          <h2>Catalogue & sources</h2>
          <p>
            Model year {vehicle.year} · {vehicle.seats} seats ·{" "}
            {vehicle.cargoLitres} L cargo · {vehicle.drivetrain} ·{" "}
            {vehicle.powertrain}
          </p>
          <p>
            <strong>Last verified:</strong>{" "}
            {vehicle.lastVerified ||
              "Not recorded — confirm pricing and chosen-trim equipment with the manufacturer."}
          </p>
          <a href={vehicle.manufacturerUrl} target="_blank" rel="noreferrer">
            Manufacturer specifications & current pricing
          </a>
          <p className="muted">
            Catalogue prices and equipment are planning estimates and may mix
            trim options. Illustrative photos may show another year or market.{" "}
            {vehicle.photoCredit}
          </p>
          {vehicle.trimOptions?.length ? (
            <div className="trim-options">
              {vehicle.trimOptions.map((t) => (
                <article key={t.name}>
                  <strong>
                    {t.name} · {money(t.price)} MSRP estimate
                  </strong>
                  <p>
                    {t.drivetrain} · {t.powertrain}
                  </p>
                  <ul>
                    {t.keyFeatures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <p>
              No sourced trim breakdown is recorded. Use a dealer quote rather
              than inferred trim prices.
            </p>
          )}
          <p>
            {entries.filter((e) => e.status === "Completed").length} completed
            drives · Emily: {note.reactions.Emily} · Nick: {note.reactions.Nick}
          </p>
        </section>
      </div>
    </dialog>
  );
}
