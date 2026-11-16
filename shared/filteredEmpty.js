// shared/filteredEmpty.js · FLOWS-13 item 4 (W-1113-Donors-18). A LIST EMPTIED BY ITS FILTERS SAYS SO.
//
// Re-engage, with the Directory's filters on, showed "0 of 277" above "No lapsed
// donors / Nobody on file has gone a year without giving", while 277 lapsed donors
// were on file. A sentence about the whole file is true only when nothing narrows
// the list. When something does, the empty list names how many are behind it:
// "None of the 277 lapsed donors match these filters."
// n: how many are on the unfiltered list; noun: one of them ("lapsed donor").
// what: what narrowed it ("these filters", "that search").
export function filteredEmptySentence(n, noun, what = "these filters") {
  const count = Number(n) || 0;
  if (count === 1) return `The 1 ${noun} on file doesn't match ${what}.`;
  return `None of the ${count.toLocaleString("en-US")} ${noun}s match ${what}.`;
}
