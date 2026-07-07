import type { CriteriaWeights, ProfileName, UserPreferenceDocument } from '../types';

export function profilePreferenceDocument(profileName: ProfileName, criteriaWeights: CriteriaWeights, favoriteVehicleIds: string[]): UserPreferenceDocument {
  return { userId: profileName, criteriaWeights, personalNotes: {}, favoriteVehicleIds };
}
