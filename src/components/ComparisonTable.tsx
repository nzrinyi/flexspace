import { fitSummary } from "../domain/recommendations";
import { useState } from "react";
import type {
  DealQuoteDocument,
  ProfileName,
  ScoredVehicle,
  TestDriveEntry,
  VehicleNoteDocument,
  VehicleStage,
} from "../types";
import { money, vehicleFinance } from "../domain/finance";
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
interface Props {
  vehicles: ScoredVehicle[];
  favoritesByProfile: Record<ProfileName, string[]>;
  notes: Record<string, VehicleNoteDocument>;
  quotes: DealQuoteDocument[];
  entries: TestDriveEntry[];
  onStageChange: (id: string, stage: VehicleStage) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}
export function ComparisonTable({
  vehicles,
  favoritesByProfile,
  notes,
  entries,
  onStageChange,
  onReorder,
  onRemove,
}: Props) {
  const [differences, setDifferences] = useState(false),
    [two, setTwo] = useState(false),
    [pair, setPair] = useState<string[]>([]);
  const validPair = [
    ...pair.filter((id) => vehicles.some((v) => v.id === id)),
    ...vehicles.map((v) => v.id),
  ]
    .filter((id, i, all) => all.indexOf(id) === i)
    .slice(0, 2);
  const shown = two
    ? validPair.map((id) => vehicles.find((v) => v.id === id)!)
    : vehicles;
  const rows: Array<{
    label: string;
    value: (v: ScoredVehicle) => string;
    group: string;
  }> = [
    {
      group: "Cost estimates · shared scenario assumptions",
      label: "Price source",
      value: (v) => vehicleFinance(v).source,
    },
    {
      group: "Cost estimates · shared scenario assumptions",
      label: "Out-the-door before trade-in",
      value: (v) => money(vehicleFinance(v).outTheDoor),
    },
    {
      group: "Cost estimates · shared scenario assumptions",
      label: "Amount financed",
      value: (v) => money(vehicleFinance(v).principal),
    },
    {
      group: "Cost estimates · shared scenario assumptions",
      label: "Loan / month",
      value: (v) => money(vehicleFinance(v).payment),
    },
    {
      group: "Cost estimates · shared scenario assumptions",
      label: "Total ownership / month",
      value: (v) => money(vehicleFinance(v).ownership),
    },
    {
      group: "Fit & evidence",
      label: "Recommendation",
      value: (v) => fitSummary(v),
    },
    {
      group: "Fit & evidence",
      label: "Evidence completeness",
      value: (v) => `${v.confidenceScore}%`,
    },
    {
      group: "Fit & evidence",
      label: "Completed drive rating",
      value: (v) =>
        v.hasDriveEvidence ? `${v.testDriveScore}/100` : "Not evaluated",
    },
    {
      group: "Fit & evidence",
      label: "Active quote evidence",
      value: (v) =>
        v.hasQuoteEvidence ? `${v.dealScore}/100` : "No active quote",
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Model year",
      value: (v) => String(v.year),
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Last verified",
      value: (v) => v.lastVerified || "Not recorded",
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Seats",
      value: (v) => String(v.seats),
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Cargo",
      value: (v) => `${v.cargoLitres} L`,
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Drivetrain",
      value: (v) => v.drivetrain,
    },
    {
      group: "Catalogue · verify chosen-trim specifications",
      label: "Powertrain",
      value: (v) => v.powertrain,
    },
    ...(["Emily", "Nick"] as const).map((p) => ({
      group: "Your observations",
      label: p,
      value: (v: ScoredVehicle) =>
        `${favoritesByProfile[p].includes(v.id) ? "★ Favourite · " : ""}${notes[v.id]?.reactions[p] ?? "Unrated"}`,
    })),
    {
      group: "Your observations",
      label: "Completed drives",
      value: (v) =>
        String(
          entries.filter(
            (e) =>
              e.vehicleId === v.id && !e.archived && e.status === "Completed",
          ).length,
        ),
    },
  ];
  rows.push({
    group: "Trade-offs to discuss",
    label: "Watch-outs",
    value: (v) => v.tradeoffs.join(" · "),
  });
  const visibleRows = rows.filter(
    (row) => !differences || new Set(shown.map(row.value)).size > 1,
  );
  return (
    <section className="card stack comparison-panel">
      <div>
        <p className="eyebrow">Side by side</p>
        <h2>Compare the trade-offs.</h2>
      </div>
      {!vehicles.length ? (
        <p role="status">
          Your comparison is empty. Add vehicles from Browse vehicles to start.
        </p>
      ) : (
        <>
          <div className="action-row">
            <label className="check">
              <input
                type="checkbox"
                checked={differences}
                onChange={(e) => setDifferences(e.target.checked)}
              />
              Show differences only
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={two}
                onChange={(e) => setTwo(e.target.checked)}
              />
              Two-vehicle view
            </label>
          </div>
          {two && (
            <div className="action-row">
              {validPair.map((id, i) => (
                <label key={i}>
                  Vehicle {i + 1}
                  <select
                    value={id}
                    onChange={(e) => {
                      const next = [...validPair];
                      const other = next.indexOf(e.target.value);
                      if (other !== -1) next[other] = id;
                      next[i] = e.target.value;
                      setPair(next);
                    }}
                  >
                    {vehicles.map((v) => (
                      <option value={v.id} key={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div
            className="comparison-scroll"
            tabIndex={0}
            aria-label="Vehicle comparison, scroll for more rows and columns"
          >
            <table className="comparison-table">
              <caption className="sr-only">
                Vehicle comparison using shared purchase assumptions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {shown.map((v) => {
                    const i = vehicles.findIndex((x) => x.id === v.id);
                    return (
                      <th
                        key={v.id}
                        scope="col"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", String(i))
                        }
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const raw = e.dataTransfer.getData("text/plain");
                          if (/^\d+$/.test(raw)) onReorder(+raw, i);
                        }}
                      >
                        <strong>{v.name}</strong>
                        <div className="action-row">
                          <button
                            disabled={i === 0}
                            aria-label={`Move ${v.name} left`}
                            onClick={() => onReorder(i, i - 1)}
                          >
                            ←
                          </button>
                          <button
                            disabled={i === vehicles.length - 1}
                            aria-label={`Move ${v.name} right`}
                            onClick={() => onReorder(i, i + 1)}
                          >
                            →
                          </button>
                          <button
                            aria-label={`Remove ${v.name}`}
                            onClick={() => onRemove(v.id)}
                          >
                            Remove
                          </button>
                        </div>
                        <label>
                          <span className="sr-only">Stage for {v.name}</span>
                          <select
                            value={notes[v.id]?.stage ?? "Browsing"}
                            onChange={(e) =>
                              onStageChange(
                                v.id,
                                e.target.value as VehicleStage,
                              )
                            }
                          >
                            {stages.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr key={row.label}>
                    <th scope="row">
                      <small>
                        {visibleRows[i - 1]?.group !== row.group
                          ? row.group
                          : ""}
                      </small>
                      {row.label}
                    </th>
                    {shown.map((v) => (
                      <td key={v.id}>{row.value(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && (
              <p>No differences in the displayed metrics.</p>
            )}
          </div>
          <p className="muted">
            Costs and catalogue specifications are estimates. Drive ratings and
            reactions are your observations. Use two-vehicle view for a focused
            mobile comparison.
          </p>
        </>
      )}
    </section>
  );
}
