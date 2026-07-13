import type { TestDriveEntry } from '../types';

export function checklistCompletion(entry: TestDriveEntry) {
  const checklist = [entry.carSeatFits, entry.strollerFits, entry.doorsOpen90, entry.passengerLegroom, entry.cargoFloorWorks, entry.winterTireQuote, entry.outTheDoorQuote, entry.prepaymentRules];
  return Math.round((checklist.filter(Boolean).length / checklist.length) * 100);
}
