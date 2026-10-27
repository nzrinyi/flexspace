import type {
  CriteriaWeights,
  DealQuoteDocument,
  ScoredVehicle,
  TestDriveEntry,
} from "../types";
import { activeQuotes, quoteNetPrice } from "./finance";
export function enrichScores(
  vehicles: ScoredVehicle[],
  entries: TestDriveEntry[],
  quotes: DealQuoteDocument[],
) {
  return vehicles
    .map((vehicle) => {
      const drives = entries.filter(
        (e) =>
          e.vehicleId === vehicle.id && !e.archived && e.status === "Completed",
      );
      const offers = activeQuotes(quotes, vehicle.id);
      const ratings = drives.flatMap((e) =>
        e.ratings
          ? Object.values(e.ratings).filter(
              (v): v is number => typeof v === "number",
            )
          : [e.partnerRating],
      );
      const testDriveScore = ratings.length
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                (ratings.reduce((s, v) => s + v, 0) / ratings.length) * 10,
              ),
            ),
          )
        : 0;
      const dealScore = offers.length
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                (100 * vehicle.msrp) /
                  Math.max(
                    vehicle.msrp,
                    Math.min(
                      ...offers.map(
                        (q) => q.price - q.discount + q.fees + q.accessories,
                      ),
                    ),
                  ),
              ),
            ),
          )
        : 0;
      const confidenceScore = Math.round(
        (((drives.length ? 1 : 0) +
          (offers.length ? 1 : 0) +
          (drives.some((e) => e.carSeatResult && e.carSeatResult !== "Unknown")
            ? 1
            : 0) +
          (vehicle.lastVerified ? 1 : 0)) /
          4) *
          100,
      );
      // Missing evidence is omitted rather than treated as a poor review.
      const totalWeight =
        0.7 + (ratings.length ? 0.2 : 0) + (offers.length ? 0.1 : 0);
      const overallRecommendationScore = Math.round(
        (vehicle.familyCompatibilityScore * 0.7 +
          (ratings.length ? testDriveScore * 0.2 : 0) +
          (offers.length ? dealScore * 0.1 : 0)) /
          totalWeight,
      );
      return {
        ...vehicle,
        confidenceScore,
        testDriveScore,
        dealScore,
        overallRecommendationScore,
        hasDriveEvidence: ratings.length > 0,
        hasQuoteEvidence: offers.length > 0,
      };
    })
    .sort(
      (a, b) => b.overallRecommendationScore - a.overallRecommendationScore,
    );
}
export const criterionLabels: Record<keyof CriteriaWeights, string> = {
  space: "Cabin & cargo space",
  winterTraction: "Winter traction",
  valueMSRP: "Value",
  reliability: "Reliability",
  fuelEfficiency: "Efficiency",
  safetyTech: "Safety",
  comfort: "Comfort",
};
export function explainVehicle(
  vehicle: ScoredVehicle,
  weights: CriteriaWeights,
) {
  const scores = {
    space: vehicle.spaceScore,
    winterTraction: vehicle.winterScore,
    valueMSRP: vehicle.valueScore,
    reliability: vehicle.reliabilityScore,
    fuelEfficiency: vehicle.efficiencyScore,
    safetyTech: vehicle.safetyScore,
    comfort: vehicle.comfortScore,
  };
  return (Object.keys(weights) as Array<keyof CriteriaWeights>)
    .map((key) => ({
      key,
      label: criterionLabels[key],
      score: scores[key],
      weight: weights[key],
      contribution: scores[key] * weights[key],
    }))
    .sort((a, b) => b.contribution - a.contribution);
}
