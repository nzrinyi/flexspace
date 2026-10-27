import { fitSummary } from "../domain/recommendations";
import type {
  DealQuoteDocument,
  ProfileName,
  ScoredVehicle,
  TestDriveEntry,
  VehicleNoteDocument,
} from "../types";
import { localDate, money, vehicleFinance } from "../domain/finance";
export function HomeDashboard({
  vehicles,
  notes,
  favorites,
  entries,
  quotes,
  onOpen,
  onReview,
  onNavigate,
}: {
  vehicles: ScoredVehicle[];
  notes: Record<string, VehicleNoteDocument>;
  favorites: Record<ProfileName, string[]>;
  entries: TestDriveEntry[];
  quotes: DealQuoteDocument[];
  onOpen: (id: string) => void;
  onReview: (id: string, profile: ProfileName) => void;
  onNavigate: (section: "browse" | "diary" | "deals" | "decision") => void;
}) {
  const candidates = vehicles.filter(
    (v) => notes[v.id]?.stage !== "Rejected" && !notes[v.id]?.dealBreaker,
  );
  const shortlist = candidates.filter(
    (v) =>
      favorites.Emily.includes(v.id) ||
      favorites.Nick.includes(v.id) ||
      ["Shortlisted", "Finalist", "Winner"].includes(notes[v.id]?.stage),
  );
  const upcoming = entries
    .filter(
      (e) => !e.archived && e.status === "Planned" && e.date >= localDate(),
    )
    .sort((a, b) =>
      `${a.date}${a.appointmentTime}`.localeCompare(
        `${b.date}${b.appointmentTime}`,
      ),
    );
  const expiring = quotes
    .filter((q) => !q.archived && q.expiryDate && q.expiryDate >= localDate())
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const reviewed = (id: string, p: ProfileName) =>
    favorites[p].includes(id) ||
    Boolean(notes[id]?.reactions[p] && notes[id].reactions[p] !== "Unrated");
  const shared = shortlist.filter(
    (v) => favorites.Emily.includes(v.id) && favorites.Nick.includes(v.id),
  );
  const disagreements = shortlist.filter((v) => {
    const reactions = notes[v.id]?.reactions;
    return (
      ((favorites.Emily.includes(v.id) || reactions?.Emily === "Love") &&
        (reactions?.Nick === "No" || !reviewed(v.id, "Nick"))) ||
      ((favorites.Nick.includes(v.id) || reactions?.Nick === "Love") &&
        (reactions?.Emily === "No" || !reviewed(v.id, "Emily")))
    );
  });
  return (
    <section className="card stack home-dashboard">
      <div>
        <p className="eyebrow">Your next steps</p>
        <h1>Find a car you both feel good about.</h1>
        <p className="muted">
          Emily and Nick share this workspace. Pick either profile and keep the
          decision moving.
        </p>
      </div>
      <div className="next-actions">
        <article>
          <h2>Your shortlist</h2>
          <strong>
            {shortlist.length} vehicles · {shared.length} shared favourites
          </strong>
          <div className="home-card-actions">
            <button
              className="primary-action"
              onClick={() => onNavigate("browse")}
            >
              Browse vehicles
            </button>
            <button
              className="quiet-action"
              onClick={() => onNavigate("decision")}
            >
              Open Decision Room
            </button>
          </div>
        </article>
        <article>
          <h2>Next test drive</h2>
          {upcoming[0] ? (
            <p>
              {vehicles.find((v) => v.id === upcoming[0].vehicleId)?.name} ·{" "}
              {upcoming[0].date} {upcoming[0].appointmentTime} ·{" "}
              {upcoming[0].dealer || "Location TBD"}
            </p>
          ) : (
            <p>
              No upcoming drive. Try a top contender with your car seat and
              stroller.
            </p>
          )}
          <div className="home-card-actions">
            <button
              className="primary-action"
              onClick={() => onNavigate("diary")}
            >
              Plan / complete a drive
            </button>
          </div>
        </article>
        <article>
          <h2>Quote watch</h2>
          {expiring[0] ? (
            <p>
              {expiring[0].dealer} ·{" "}
              {vehicles.find((v) => v.id === expiring[0].vehicleId)?.name} ·
              expires {expiring[0].expiryDate}
            </p>
          ) : (
            <p>No dated active quotes. Add an offer to compare real costs.</p>
          )}
          <div className="home-card-actions">
            <button
              className="primary-action"
              onClick={() => onNavigate("deals")}
            >
              Manage quotes
            </button>
          </div>
        </article>
      </div>
      <div className="recommendations-intro">
        <h2>
          {shortlist.length ? "Your contenders" : "Recommended contenders"}
        </h2>
        <p className="muted">
          Close recommendations are labelled Similar fit. Compare the trade-offs
          rather than small score differences.
        </p>
      </div>
      <div className="contender-list">
        {(shortlist.length ? shortlist : candidates.slice(0, 3)).map((v) => (
          <article key={v.id} className="contender-card">
            <button onClick={() => onOpen(v.id)}>
              <strong>{v.name}</strong>
              <span className="contender-meta">
                <span className="contender-cost">
                  {money(vehicleFinance(v).ownership)}
                  <span>/mo total</span>
                </span>
                <span className="fit-badge">{fitSummary(v)}</span>
              </span>
              <small>
                Trade-off:{" "}
                {v.tradeoffs[0] ?? "Confirm the chosen trim and costs."}
              </small>
            </button>
            <div className="review-actions">
              {(["Emily", "Nick"] as const).map((profile) =>
                reviewed(v.id, profile) ? (
                  <span key={profile}>
                    {profile}:{" "}
                    {notes[v.id]?.reactions[profile] &&
                    notes[v.id].reactions[profile] !== "Unrated"
                      ? notes[v.id].reactions[profile]
                      : "Favourite"}
                  </span>
                ) : (
                  <button
                    key={profile}
                    onClick={() => onReview(v.id, profile)}
                    aria-label={`${profile}: Needs review — ${v.name}`}
                  >
                    {profile}: Needs review
                  </button>
                ),
              )}
            </div>
          </article>
        ))}
      </div>
      <details open>
        <summary>Where you agree—and what to discuss</summary>
        <p>
          <strong>Shared favourites:</strong>{" "}
          {shared.length
            ? shared.map((v) => v.name).join(", ")
            : "None yet. Star vehicles as each profile to find common ground."}
        </p>
        {disagreements.length ? (
          <div className="contender-list">
            {disagreements.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  const profile = !reviewed(v.id, "Emily")
                    ? "Emily"
                    : !reviewed(v.id, "Nick")
                      ? "Nick"
                      : null;
                  if (profile) onReview(v.id, profile);
                  else onOpen(v.id);
                }}
              >
                <strong>{v.name}</strong>
                <span>
                  Emily: {notes[v.id]?.reactions.Emily ?? "Unrated"}
                  {favorites.Emily.includes(v.id) ? " ★" : ""} · Nick:{" "}
                  {notes[v.id]?.reactions.Nick ?? "Unrated"}
                  {favorites.Nick.includes(v.id) ? " ★" : ""}
                </span>
                <small>Open to review the trade-offs together</small>
              </button>
            ))}
          </div>
        ) : (
          <p>No unresolved favourite disagreements.</p>
        )}
      </details>
    </section>
  );
}
