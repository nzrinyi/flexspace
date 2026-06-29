import { VEHICLES } from './vehicles';
import type { CriteriaWeights, ScoredVehicle, UserPreferenceDocument, VehicleReference } from './types';

export const DEFAULT_WEIGHTS: CriteriaWeights = {
  space: 5,
  winterTraction: 5,
  valueMSRP: 5,
  reliability: 5,
  fuelEfficiency: 5,
  safetyTech: 5,
  comfort: 5,
};

export const CANADIAN_VEHICLES: VehicleReference[] = VEHICLES;

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
        reliability: acc.reliability + (weights.reliability ?? DEFAULT_WEIGHTS.reliability),
        fuelEfficiency: acc.fuelEfficiency + (weights.fuelEfficiency ?? DEFAULT_WEIGHTS.fuelEfficiency),
        safetyTech: acc.safetyTech + (weights.safetyTech ?? DEFAULT_WEIGHTS.safetyTech),
        comfort: acc.comfort + (weights.comfort ?? DEFAULT_WEIGHTS.comfort),
      };
    },
    { space: 0, winterTraction: 0, valueMSRP: 0, reliability: 0, fuelEfficiency: 0, safetyTech: 0, comfort: 0 },
  );

  return {
    space: totals.space / preferences.length,
    winterTraction: totals.winterTraction / preferences.length,
    valueMSRP: totals.valueMSRP / preferences.length,
    reliability: totals.reliability / preferences.length,
    fuelEfficiency: totals.fuelEfficiency / preferences.length,
    safetyTech: totals.safetyTech / preferences.length,
    comfort: totals.comfort / preferences.length,
  };
}

export function scoreVehicles(weights: CriteriaWeights, vehicles = CANADIAN_VEHICLES): ScoredVehicle[] {
  const totalWeight = Math.max(
    weights.space + weights.winterTraction + weights.valueMSRP + weights.reliability + weights.fuelEfficiency + weights.safetyTech + weights.comfort,
    1,
  );

  return vehicles
    .map((vehicle) => {
      const weightedScore =
        vehicle.spaceScore * weights.space +
        vehicle.winterScore * weights.winterTraction +
        vehicle.valueScore * weights.valueMSRP +
        vehicle.reliabilityScore * weights.reliability +
        vehicle.efficiencyScore * weights.fuelEfficiency +
        vehicle.safetyScore * weights.safetyTech +
        vehicle.comfortScore * weights.comfort;

      return {
        ...vehicle,
        familyCompatibilityScore: Math.round(weightedScore / totalWeight),
      };
    })
    .sort((a, b) => b.familyCompatibilityScore - a.familyCompatibilityScore);
}
