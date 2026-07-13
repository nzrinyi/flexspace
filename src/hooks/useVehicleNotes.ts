import type { ProfileName, UserReaction, VehicleNoteDocument, VehicleStage } from '../types';

export const defaultVehicleStage: VehicleStage = 'Browsing';
export const defaultReactions: Record<ProfileName, UserReaction> = { Emily: 'Unrated', Nick: 'Unrated' };

export function mergeVehicleNote(vehicleId: string, note?: Partial<VehicleNoteDocument>): VehicleNoteDocument {
  return { vehicleId, sharedNote: '', stage: defaultVehicleStage, reactions: { ...defaultReactions, ...(note?.reactions ?? {}) }, ...note };
}
