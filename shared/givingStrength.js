// shared/givingStrength.js · LIST-6 item 1. ONE GIVING STRENGTH.
//
// Jarvis (22 Nov): "Two generosity scores per person: list 'Giving strength' vs profile 'Generosity'
// disagree (72 vs 68, 85 vs 89); sorting uses the hidden one." The list drew a browser formula
// (shared.jsx donorScore: dollars, days and gift count on a fixed 5..99 scale) while the profile and
// the sort read the stored score (donor_scores.generosity, engagement.js). Reproduced on staging:
// Alaric Applewhite read 81 on the list and 77 on his profile.
//
// Now there is one: the stored score, under one name, "Giving strength", on the list, Re-engage and
// the profile. This file turns the stored parts (donor_scores.parts.generosity, which every list row
// carries as `generosity_parts`) into the hover's sentence, with the same labels the profile's "See
// why" prints, so the reasons add up to the number shown.
import { GENEROSITY_PARTS } from "./engagementWeights.js";

export const GIVING_STRENGTH = "Giving strength";

// A score to show, or null: 0 is somebody with no gift (engagement.js gives a non-giver 0), and
// null is somebody not worked out yet. Neither is drawn as a number.
export function givingStrengthOf(d) {
  const n = d == null ? null : Number(d.generosity);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "Giving strength 77: Lifetime giving 24 of 30, Last 24 months 21 of 30, …" from the stored parts.
export function givingStrengthSentence(score, parts) {
  if (!(Number(score) > 0)) return "Giving strength comes from gifts, and there are none on file";
  const list = Array.isArray(parts) ? parts : [];
  const said = list
    .filter(p => p && GENEROSITY_PARTS[p.key])
    .map(p => `${GENEROSITY_PARTS[p.key].label} ${Number(p.points) || 0} of ${Math.round(GENEROSITY_PARTS[p.key].weight * 100)}`);
  return said.length
    ? `${GIVING_STRENGTH} ${score} of 100: ${said.join(", ")}. The parts add up to the score; the profile's See why opens the gifts behind each.`
    : `${GIVING_STRENGTH} ${score} of 100. The profile's See why shows the parts.`;
}
