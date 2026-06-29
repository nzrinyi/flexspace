import type { CriteriaWeights, ScoredVehicle, UserPreferenceDocument, VehicleReference } from './types';

export const DEFAULT_WEIGHTS: CriteriaWeights = {
  space: 5,
  winterTraction: 5,
  valueMSRP: 5,
};

export const CANADIAN_VEHICLES: VehicleReference[] = [
  { id: 'crv', name: 'Honda CR-V', msrp: 36975, spaceScore: 95, winterScore: 80, valueScore: 85 },
  { id: 'rav4', name: 'Toyota RAV4', msrp: 37500, spaceScore: 75, winterScore: 90, valueScore: 95 },
  { id: 'forester', name: 'Subaru Forester', msrp: 34195, spaceScore: 85, winterScore: 98, valueScore: 90 },
];

export function averagePartnerWeights(preferences: UserPreferenceDocument[] = []): CriteriaWeights {
  if (preferences.length === 0) {
    return DEFAULT_WEIGHTS;
  }

  const totals = preferences.reduce(
    (acc, preference) => {
      const weights = preference.criteriaWeights ?? DEFAULT_WEIGHTS;
      return {
        space: acc.space + (weights.space ?? DEFAULT_WEIGHTS.space),
        winterTraction: acc.winterTraction + (weights.winterTraction ?? DEFAULT_WEIGHTS.winterTraction),
        valueMSRP: acc.valueMSRP + (weights.valueMSRP ?? DEFAULT_WEIGHTS.valueMSRP),
      };
    },
    { space: 0, winterTraction: 0, valueMSRP: 0 },
  );

  return {
    space: totals.space / preferences.length,
    winterTraction: totals.winterTraction / preferences.length,
    valueMSRP: totals.valueMSRP / preferences.length,
  };
}

export function scoreVehicles(weights: CriteriaWeights, vehicles = CANADIAN_VEHICLES): ScoredVehicle[] {
  const totalWeight = Math.max(weights.space + weights.winterTraction + weights.valueMSRP, 1);

  return vehicles
    .map((vehicle) => {
      const weightedScore =
        vehicle.spaceScore * weights.space +
        vehicle.winterScore * weights.winterTraction +
        vehicle.valueScore * weights.valueMSRP;

      return {
        ...vehicle,
        familyCompatibilityScore: Math.round(weightedScore / totalWeight),
      };
    })
    .sort((a, b) => b.familyCompatibilityScore - a.familyCompatibilityScore);
}
