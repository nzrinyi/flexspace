import test from "node:test";
import assert from "node:assert/strict";
import { enrichScores } from "../src/domain/evidence";
import {
  vehicleReadiness,
  mustHaveLabels,
  type MustHaveSettings,
} from "../src/domain/readiness";
import { scoreVehicles, DEFAULT_WEIGHTS } from "../src/scoring";
import { calendarEvent } from "../src/domain/calendar";
import type { TestDriveEntry, VehicleNoteDocument } from "../src/types";
const v = scoreVehicles(DEFAULT_WEIGHTS)[0];
const drive: TestDriveEntry = {
  vehicleId: v.id,
  date: "2026-11-03",
  appointmentTime: "11:00",
  reminderDate: "2026-11-02",
  dealer: "Dealer, Inc",
  notes: "Bring seat\nand stroller",
  carSeatFits: true,
  strollerFits: true,
  doorsOpen90: true,
  passengerLegroom: true,
  cargoFloorWorks: true,
  winterTireQuote: true,
  outTheDoorQuote: true,
  prepaymentRules: true,
  winterConfidence: 10,
  partnerRating: 10,
  status: "Planned",
};
const must = Object.fromEntries(
  Object.keys(mustHaveLabels).map((k) => [k, false]),
) as MustHaveSettings;
const note: VehicleNoteDocument = {
  vehicleId: v.id,
  stage: "Browsing",
  sharedNote: "No deal breakers; do not reject yet",
  reactions: { Emily: "Unrated", Nick: "Unrated" },
};
const favorites = { Emily: [], Nick: [] };
test("planned and archived drives do not affect ratings or evidence", () => {
  const base = enrichScores([v], [], [])[0];
  assert.deepEqual(enrichScores([v], [drive], [])[0], base);
  assert.deepEqual(
    enrichScores(
      [v],
      [{ ...drive, status: "Completed", archived: true }],
      [],
    )[0],
    base,
  );
});
test("completed drive ratings stay within 100 and include both profiles", () => {
  const best = enrichScores([v], [{ ...drive, status: "Completed" }], [])[0];
  assert.equal(best.testDriveScore, 100);
  assert.ok(best.overallRecommendationScore <= 100);
  const split = enrichScores(
    [v],
    [{ ...drive, status: "Completed", ratings: { Emily: 10, Nick: 2 } }],
    [],
  )[0];
  assert.equal(split.testDriveScore, 60);
});
test("new unrated completed entries do not invent a rating", () => {
  assert.equal(
    enrichScores([v], [{ ...drive, status: "Completed", ratings: {} }], [])[0]
      .hasDriveEvidence,
    false,
  );
});
test("unknown car-seat fit requires verification; only an observed failure blocks", () => {
  const req = { ...must, mustFitCarSeat: true };
  const unknown = vehicleReadiness(v, favorites, note, [], [], 0, req);
  assert.equal(unknown.blocked, false);
  assert.ok(unknown.missing.some((m) => m.includes("Verify car-seat")));
  const failed = vehicleReadiness(
    v,
    favorites,
    note,
    [],
    [
      {
        ...drive,
        status: "Completed",
        carSeatFits: false,
        carSeatResult: "Fail",
      },
    ],
    0,
    req,
  );
  assert.equal(failed.blocked, true);
});
test("free text never sets a deal breaker; explicit control does", () => {
  assert.equal(
    vehicleReadiness(v, favorites, note, [], [], 0, must).blocked,
    false,
  );
  assert.equal(
    vehicleReadiness(
      v,
      favorites,
      { ...note, dealBreaker: true },
      [],
      [],
      0,
      must,
    ).blocked,
    true,
  );
});
test("calendar export escapes notes, keeps local appointment time and supplies reminder", () => {
  const ics = calendarEvent(drive, "Honda");
  assert.match(ics, /DTSTART:20261103T110000/);
  assert.match(ics, /LOCATION:Dealer\\, Inc/);
  assert.match(ics, /Bring seat\\nand stroller/);
  assert.match(ics, /BEGIN:VALARM/);
});
