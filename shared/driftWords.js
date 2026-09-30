// shared/driftWords.js — FIX-10 Part A. ONE VOCABULARY FOR DRIFT.
//
// On a fresh org with 14 donors, Home said "No donors drifting" while GET
// /drift reported five at medium confidence and the donor directory badged
// three of them "DRIFTING · UNSURE". Three surfaces, three answers, and no
// way in from the one screen a director actually reads: "See all" sent
// ?all=1, which lifts the cap on the high-confidence list and never asks for
// the medium ones at all.
//
// So drift is counted and named in exactly one place now. Home, the directory
// and the see-all list read these functions, which is what makes the counts
// agree. Two rules ride on this file:
//
//   1. A medium flag is NEVER presented as high. The headline dollars stay
//      high-confidence only, because a number that includes guesses is not a
//      number a director repeats. The medium ones are named as what they are.
//   2. No surface says "no donors drifting" while anyone is drifting at any
//      confidence. That sentence was the one a customer believed.

export const DRIFT_WORD = "Drifting";
export const UNSURE_SUFFIX = " · unsure";   // the directory badge's own words

// The badge text, everywhere a donor appears. The list groups its medium rows
// under EARLY_SIGNS_HEADING and labels each row from this same function, so
// the words on the row match the words on the badge on the donor's profile.
export function driftBadgeLabel(confidence) {
  return confidence === "medium" ? DRIFT_WORD + UNSURE_SUFFIX : DRIFT_WORD;
}

export const EARLY_SIGNS_HEADING = "Early signs";

// The counts, read off ONE /drift payload. Every surface that wants to know
// how many donors are drifting asks this, not the payload's fields directly.
export function driftCounts(payload) {
  const c = (payload && payload.counts) || {};
  const high = Number(c.driftingHigh) || 0;
  const medium = Number(c.driftingMedium) || 0;
  return { high, medium, total: high + medium, anyDrifting: high + medium > 0 };
}

// "3 early signs" / "1 early sign" — the quiet line under Home's drift card,
// and the count beside the see-all group heading.
export function earlySignsPhrase(medium) {
  const n = Number(medium) || 0;
  return `${n.toLocaleString()} early sign${n === 1 ? "" : "s"}`;
}

// The sentence that defines what an early sign IS, shown wherever the phrase
// is. Every number has a sentence, and this is that number's.
export const EARLY_SIGNS_MEANING =
  "donors a little past their own giving rhythm, not far enough to be sure";
