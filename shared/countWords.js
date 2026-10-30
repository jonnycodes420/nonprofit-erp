// shared/countWords.js — FIX-58 item 7. ONE HELPER FOR EVERY COUNT.
//
// "1 sustainers" was on the Recurring page because every screen wrote its own
// `n === 1 ? "" : "s"` (or forgot to). Every count a person reads comes from
// here now. The rule (docs/decisions/design-system.md, Counts):
//
//   countLabel  — a count on a tile, chip, badge, button or list header:
//                 always numerals, "1 sustainer", "12 sustainers".
//   countWords  — a count inside a sentence: under ten is spelled,
//                 "one sustainer", "three donors", "12 donors".
//   plural      — just the word, for a label that draws the number itself.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

// many defaults to one + "s"; pass it for anything irregular ("people", "classes").
export function plural(n, one, many) {
  return Number(n) === 1 ? one : (many || one + "s");
}

export function countLabel(n, one, many) {
  const k = Number(n) || 0;
  return `${k.toLocaleString("en-US")} ${plural(k, one, many)}`;
}

export function spell(n) {
  const k = Number(n);
  return Number.isInteger(k) && k >= 0 && k < WORDS.length ? WORDS[k] : (Number(n) || 0).toLocaleString("en-US");
}

export function countWords(n, one, many) {
  const k = Number(n) || 0;
  return `${spell(k)} ${plural(k, one, many)}`;
}
