import type { ScoredVehicle } from "../types";

// A three-point range is a presentation heuristic, not statistical confidence.
// Anchor each group to its highest score so chains cannot join distant scores.
export const SIMILAR_FIT_RANGE = 3;
export function recommendationLabel(
  vehicle: ScoredVehicle,
  peers: ScoredVehicle[],
): string {
  const sorted = [...peers].sort(
    (a, b) => b.overallRecommendationScore - a.overallRecommendationScore,
  );
  while (sorted.length) {
    const anchor = sorted[0].overallRecommendationScore;
    const end = sorted.findIndex(
      (v) => anchor - v.overallRecommendationScore > SIMILAR_FIT_RANGE,
    );
    const group = sorted.splice(0, end === -1 ? sorted.length : end);
    if (group.some((v) => v.id === vehicle.id) && group.length > 1)
      return "Similar fit";
  }
  return vehicle.overallRecommendationScore >= 80
    ? "Strong fit"
    : vehicle.overallRecommendationScore >= 65
      ? "Worth considering"
      : "More compromises";
}
export function fitSummary(vehicle: ScoredVehicle) {
  return vehicle.fitSummary ?? recommendationLabel(vehicle, [vehicle]);
}
