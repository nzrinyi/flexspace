import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
} from "react";
import type { ProfileName, ScoredVehicle, TestDriveEntry } from "../types";
import { checklistCompletion } from "../hooks/useTestDriveDiary";
import { localDate } from "../domain/finance";
import { downloadCalendar, preparePhotos } from "../domain/calendar";

export function defaultDiaryDraft(vehicleId: string): TestDriveEntry {
  return {
    vehicleId,
    date: localDate(),
    appointmentTime: "",
    reminderDate: "",
    dealer: "",
    notes: "",
    carSeatFits: false,
    carSeatResult: "Unknown",
    strollerFits: false,
    doorsOpen90: false,
    passengerLegroom: false,
    cargoFloorWorks: false,
    winterTireQuote: false,
    outTheDoorQuote: false,
    prepaymentRules: false,
    winterConfidence: 5,
    partnerRating: 5,
    ratings: {},
    photoUrls: [],
    status: "Planned",
  };
}
const checks = {
  strollerFits: "Stroller fits",
  doorsOpen90: "Rear doors open wide",
  passengerLegroom: "Passenger legroom with car seat",
  cargoFloorWorks: "Cargo floor works for stroller",
  winterTireQuote: "Asked winter tire pricing",
  outTheDoorQuote: "Got out-the-door quote",
  prepaymentRules: "Asked prepayment rules",
} as const;
export function TestDriveDiary({
  initialVehicleId,
  vehicles,
  entries,
  activeProfile,
  onSaveEntry,
}: {
  initialVehicleId?: string;
  vehicles: ScoredVehicle[];
  entries: TestDriveEntry[];
  activeProfile: ProfileName;
  onSaveEntry: (entry: TestDriveEntry) => Promise<void>;
}) {
  const [draft, setDraft] = useState(
    defaultDiaryDraft(initialVehicleId ?? vehicles[0]?.id ?? ""),
  );
  const [saving, setSaving] = useState(false),
    [photoLoading, setPhotoLoading] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const grouped = useMemo(
    () =>
      vehicles
        .map((vehicle) => ({
          vehicle,
          entries: entries
            .filter(
              (e) =>
                e.vehicleId === vehicle.id &&
                Boolean(e.archived) === showArchived,
            )
            .sort((a, b) => b.date.localeCompare(a.date)),
        }))
        .filter((g) => g.entries.length),
    [entries, vehicles, showArchived],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSaveEntry(draft);
      setMessage("Diary entry saved.");
      setDraft(defaultDiaryDraft(draft.vehicleId));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is still here; please retry.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function archive(entry: TestDriveEntry) {
    setSaving(true);
    setError("");
    try {
      await onSaveEntry({ ...entry, archived: !entry.archived });
      setMessage(
        entry.archived
          ? "Entry restored."
          : "Entry archived. You can restore it from Archived.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  function edit(entry: TestDriveEntry) {
    setDraft({ ...defaultDiaryDraft(entry.vehicleId), ...entry });
    setMessage("");
    setError("");
    form.current?.scrollIntoView({ behavior: "smooth" });
  }
  return (
    <section className="card stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Test drive companion</p>
          <h2>Plan it. Drive it. Compare notes.</h2>
        </div>
        <button onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Show active entries" : "Archived entries"}
        </button>
      </div>
      <form ref={form} className="diary-form diary-panel" onSubmit={submit}>
        <fieldset disabled={saving || photoLoading} className="form-fields">
          <label>
            Vehicle
            <select
              value={draft.vehicleId}
              onChange={(e) =>
                setDraft({ ...draft, vehicleId: e.target.value })
              }
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as TestDriveEntry["status"],
                })
              }
            >
              <option>Planned</option>
              <option>Completed</option>
            </select>
          </label>
          <label>
            Date
            <input
              required
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </label>
          <label>
            Appointment time
            <input
              type="time"
              value={draft.appointmentTime}
              onChange={(e) =>
                setDraft({ ...draft, appointmentTime: e.target.value })
              }
            />
          </label>
          <label>
            Calendar reminder date
            <input
              type="date"
              max={draft.date}
              value={draft.reminderDate}
              onChange={(e) =>
                setDraft({ ...draft, reminderDate: e.target.value })
              }
            />
          </label>
          <label>
            Dealer / location
            <input
              value={draft.dealer}
              onChange={(e) => setDraft({ ...draft, dealer: e.target.value })}
            />
          </label>
          <label className="wide">
            Driving notes
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Road noise, kid comfort, visibility…"
            />
          </label>
          <label>
            Car-seat fit
            <select
              value={
                draft.carSeatResult ?? (draft.carSeatFits ? "Pass" : "Unknown")
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  carSeatResult: e.target
                    .value as TestDriveEntry["carSeatResult"],
                  carSeatFits: e.target.value === "Pass",
                })
              }
            >
              <option>Unknown</option>
              <option>Pass</option>
              <option>Fail</option>
            </select>
          </label>
          {Object.entries(checks).map(([key, label]) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={Boolean(draft[key as keyof typeof checks])}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <label>
            Winter confidence: {draft.winterConfidence}/10
            <input
              type="range"
              min="1"
              max="10"
              value={draft.winterConfidence}
              onChange={(e) =>
                setDraft({ ...draft, winterConfidence: +e.target.value })
              }
            />
          </label>
          {(["Emily", "Nick"] as const).map((profile) => (
            <label key={profile}>
              {profile}'s rating{profile === activeProfile ? " (you)" : ""}
              <select
                value={draft.ratings?.[profile] ?? ""}
                onChange={(e) => {
                  const ratings = { ...draft.ratings };
                  if (e.target.value) ratings[profile] = +e.target.value;
                  else delete ratings[profile];
                  setDraft({
                    ...draft,
                    ratings,
                    partnerRating:
                      ratings[activeProfile] ?? draft.partnerRating,
                  });
                }}
              >
                <option value="">Not evaluated</option>
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}/10
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="wide">
            Photos (up to 3)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                setPhotoLoading(true);
                setError("");
                try {
                  const photos = await preparePhotos(e.target.files);
                  setDraft((d) => ({ ...d, photoUrls: photos }));
                } catch (err) {
                  setError(String(err));
                } finally {
                  setPhotoLoading(false);
                }
              }}
            />
            <small>
              Photos are resized and saved with this entry. Choosing photos
              replaces the current set.
            </small>
          </label>
          <div className="photo-strip wide">
            {draft.photoUrls?.map((url, i) => (
              <img key={i} src={url} alt={`Drive photo ${i + 1}`} />
            ))}
            {!!draft.photoUrls?.length && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, photoUrls: [] })}
              >
                Remove photos
              </button>
            )}
          </div>
          <div className="action-row wide">
            <button type="submit">
              {saving
                ? "Saving…"
                : draft.id
                  ? "Save changes"
                  : "Save diary entry"}
            </button>
            {draft.id && (
              <button
                type="button"
                onClick={() => setDraft(defaultDiaryDraft(draft.vehicleId))}
              >
                Cancel editing
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <p role="status">{photoLoading ? "Preparing photos…" : message}</p>
      {error && (
        <p role="alert" className="error-text">
          {error} Your draft is preserved. Retry Save when ready.
        </p>
      )}
      <p className="muted">
        Reminders are included in calendar exports; CarMatch does not send
        notifications. Timed-event reminders use the appointment time on your
        selected reminder day. Planned drives never affect rankings.
      </p>
      {!grouped.length && (
        <p>No {showArchived ? "archived" : "saved"} drives yet.</p>
      )}
      <div className="timeline-list">
        {grouped.map(({ vehicle, entries: list }) => (
          <section key={vehicle.id}>
            <h3>{vehicle.name}</h3>
            {list.map((entry) => (
              <article className="timeline-card" key={entry.id}>
                <div>
                  <strong>{entry.date}</strong>
                  <p>
                    {entry.appointmentTime || "Time TBD"} · {entry.status}
                  </p>
                </div>
                <div>
                  <h3>{entry.dealer || "Dealer TBD"}</h3>
                  <p>{entry.notes || "No notes yet."}</p>
                  <p>
                    Car seat:{" "}
                    {entry.carSeatResult ??
                      (entry.carSeatFits ? "Pass" : "Unknown")}{" "}
                    · Emily: {entry.ratings?.Emily ?? "Not evaluated"} · Nick:{" "}
                    {entry.ratings?.Nick ?? "Not evaluated"}
                  </p>
                  {!entry.ratings && (
                    <p>Legacy partner rating: {entry.partnerRating}/10</p>
                  )}
                  <div className="photo-strip">
                    {entry.photoUrls?.map((url, i) => (
                      <a href={url} target="_blank" rel="noreferrer" key={i}>
                        <img src={url} alt={`Test drive photo ${i + 1}`} />
                      </a>
                    ))}
                  </div>
                  <div className="action-row">
                    <button disabled={saving} onClick={() => edit(entry)}>
                      {entry.status === "Planned"
                        ? "Open / complete drive"
                        : "Edit"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => void archive(entry)}
                    >
                      {entry.archived ? "Restore" : "Archive"}
                    </button>
                    <button
                      onClick={() => downloadCalendar(entry, vehicle.name)}
                    >
                      Add to calendar
                    </button>
                  </div>
                </div>
                <div
                  className="progress-ring"
                  style={
                    {
                      "--progress": `${checklistCompletion(entry)}%`,
                    } as CSSProperties
                  }
                >
                  <strong>{checklistCompletion(entry)}%</strong>
                  <span>checklist</span>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
