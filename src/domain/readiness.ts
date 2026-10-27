import type {
  ProfileName,
  ScoredVehicle,
  VehicleNoteDocument,
  DealQuoteDocument,
  TestDriveEntry,
} from "../types";
import { activeQuotes, estimateMonthlyPayment } from "./finance";
export const mustHaveLabels = {
  mustHaveAwd: "Must be AWD / 4WD",
  mustFitCarSeat: "Must fit rear-facing car seat",
  mustBeUnderBudget: "Must be under monthly budget",
  mustHaveHybrid: "Must have hybrid/electric option",
  mustHaveHeatedRearSeats: "Must have heated rear seats",
  mustHaveMemorySeats: "Must have memory seats",
  mustHaveSpareTire: "Must have spare tire",
  mustAvoidCvt: "Must not be CVT",
  mustHavePhysicalClimateControls: "Must have physical climate controls",
} as const;
export type MustHaveKey = keyof typeof mustHaveLabels;
export type MustHaveSettings = Record<MustHaveKey, boolean>;
export interface VehicleReadiness {
  score: number;
  status: string;
  checklist: Array<{ label: string; complete: boolean }>;
  missing: string[];
  blocked: boolean;
}
export function requirementChecks(
  vehicle: ScoredVehicle,
  entries: TestDriveEntry[],
  maxMonthly: number,
  mustHaves: MustHaveSettings,
) {
  const failed: string[] = [],
    unknown: string[] = [];
  function check(enabled: boolean, pass: boolean | undefined, label: string) {
    if (enabled) {
      if (pass === false) failed.push(label);
      else if (pass === undefined)
        unknown.push(`Verify ${label.toLowerCase()}`);
    }
  }
  const completed = entries.filter(
    (e) => !e.archived && e.status === "Completed",
  );
  const seat = completed.some(
    (e) => e.carSeatResult === "Pass" || e.carSeatFits,
  )
    ? true
    : completed.some((e) => e.carSeatResult === "Fail")
      ? false
      : undefined;
  check(
    mustHaves.mustHaveAwd,
    vehicle.drivetrain === "AWD" || vehicle.drivetrain === "4WD",
    "AWD / 4WD",
  );
  check(mustHaves.mustFitCarSeat, seat, "Car-seat fit");
  check(
    mustHaves.mustBeUnderBudget,
    maxMonthly ? estimateMonthlyPayment(vehicle) <= maxMonthly : undefined,
    "Monthly budget",
  );
  check(
    mustHaves.mustHaveHybrid,
    vehicle.powertrain !== "Gas",
    "Hybrid / electric",
  );
  check(
    mustHaves.mustHaveHeatedRearSeats,
    vehicle.hasHeatedRearSeats,
    "Heated rear seats on chosen trim",
  );
  check(
    mustHaves.mustHaveMemorySeats,
    vehicle.hasMemorySeats,
    "Memory seats on chosen trim",
  );
  check(mustHaves.mustHaveSpareTire, vehicle.hasSpareTire, "Spare tire");
  check(
    mustHaves.mustAvoidCvt,
    vehicle.hasCvt === undefined ? undefined : !vehicle.hasCvt,
    "Transmission without CVT",
  );
  check(
    mustHaves.mustHavePhysicalClimateControls,
    vehicle.physicalClimateControls,
    "Physical climate controls",
  );
  return { failed, unknown };
}
export function vehicleReadiness(
  vehicle: ScoredVehicle,
  favorites: Record<ProfileName, string[]>,
  note: VehicleNoteDocument,
  quotes: DealQuoteDocument[],
  entries: TestDriveEntry[],
  maxMonthly: number,
  mustHaves: MustHaveSettings,
): VehicleReadiness {
  const drives = entries.filter(
    (e) =>
      e.vehicleId === vehicle.id && !e.archived && e.status === "Completed",
  );
  const requirements = requirementChecks(
    vehicle,
    drives,
    maxMonthly,
    mustHaves,
  );
  const blocked = Boolean(
    note.dealBreaker || note.stage === "Rejected" || requirements.failed.length,
  );
  const checklist = [
    {
      label: "Emily review",
      complete:
        favorites.Emily.includes(vehicle.id) ||
        note.reactions.Emily !== "Unrated",
    },
    {
      label: "Nick review",
      complete:
        favorites.Nick.includes(vehicle.id) ||
        note.reactions.Nick !== "Unrated",
    },
    { label: "Shared note", complete: Boolean(note.sharedNote.trim()) },
    { label: "Completed test drive", complete: drives.length > 0 },
    {
      label: "Active dealer quote",
      complete: activeQuotes(quotes, vehicle.id).length > 0,
    },
    {
      label: "Monthly budget",
      complete: !maxMonthly || estimateMonthlyPayment(vehicle) <= maxMonthly,
    },
    {
      label: "Car seat and stroller checks",
      complete: drives.some((e) => e.carSeatFits && e.strollerFits),
    },
    {
      label: "Requirements confirmed",
      complete: !blocked && !requirements.unknown.length,
    },
  ];
  const missing = [
    ...checklist
      .filter((c) => !c.complete)
      .map((c) => `Needs ${c.label.toLowerCase()}`),
    ...requirements.unknown,
    ...requirements.failed.map((f) => `Does not meet: ${f}`),
  ];
  return {
    score: Math.round(
      (checklist.filter((c) => c.complete).length / checklist.length) * 100,
    ),
    status: blocked
      ? "Does not meet requirements"
      : missing.length
        ? missing[0]
        : note.stage === "Finalist"
          ? `Finalist${note.stageSetBy ? ` · marked by ${note.stageSetBy}` : ""}`
          : "Ready to decide",
    checklist,
    missing,
    blocked,
  };
}
