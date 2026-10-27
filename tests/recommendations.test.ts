import test from "node:test";
import assert from "node:assert/strict";
import { recommendationLabel } from "../src/domain/recommendations";
import { scoreVehicles, DEFAULT_WEIGHTS } from "../src/scoring";
const base = scoreVehicles(DEFAULT_WEIGHTS)[0];
const vehicle = (id: string, score: number) => ({
  ...base,
  id,
  overallRecommendationScore: score,
});
test("one-point differences receive the same Similar fit label without changing scores", () => {
  const a = vehicle("a", 90),
    b = vehicle("b", 89);
  assert.equal(recommendationLabel(a, [a, b]), "Similar fit");
  assert.equal(recommendationLabel(b, [a, b]), "Similar fit");
  assert.equal(b.overallRecommendationScore, 89);
});
test("similarity includes three points but does not chain distant scores", () => {
  const a = vehicle("a", 90),
    b = vehicle("b", 87),
    c = vehicle("c", 84);
  assert.equal(recommendationLabel(b, [c, a, b]), "Similar fit");
  assert.equal(recommendationLabel(c, [c, a, b]), "Strong fit");
});
test("distinct and single recommendations retain qualitative fit labels", () => {
  const a = vehicle("a", 90),
    b = vehicle("b", 70),
    c = vehicle("c", 60);
  assert.equal(recommendationLabel(a, [a, b, c]), "Strong fit");
  assert.equal(recommendationLabel(b, [a, b, c]), "Worth considering");
  assert.equal(recommendationLabel(c, [c]), "More compromises");
});
