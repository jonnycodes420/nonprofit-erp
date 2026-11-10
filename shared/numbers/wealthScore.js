// shared/numbers/wealthScore.js · WEALTH-1. THE WEALTH SCORE, 1 TO 5.
//
// A Wealth Score is a number a PERSON sets on somebody's record: 1, 2, 3, 4
// or 5, or not set. Steward never sets one. It may SUGGEST one beside an
// empty score, from facts it already holds, and the suggestion is written
// nowhere until somebody clicks it. A suggested score is never counted as set:
// no filter, sort, report, export or count reads a suggestion.
//
// THE BANDS (a year of capacity, in dollars):
//   5  $25,000 or more        4  $10,000 to $25,000     3  $2,500 to $10,000
//   2  $500 to $2,500         1  under $500
//
// WHAT A SUGGESTION READS, and nothing else:
//   - their own gifts: the last complete calendar year, and the last twelve
//     months (refunds taken off), the same gifts Room to give reads
//     (prospect.loadFacts);
//   - a screening file's capacity range, when one was imported (the low end).
// The highest band any of these reaches is the suggestion, and its sentence
// names the one fact that reached it ("gave $12,000 in 2025").
//
// NEVER FEC DATA. Federal campaign-contribution records may not be used for
// fundraising (52 U.S.C. 30111(a)(4)). Steward reads no political-giving source,
// and a screening file's free-text notes are never read here: only its range.
//
// Pure: no DB, no network, no clock. The caller hands in `today`.
"use strict";

const MIN = 1, MAX = 5;
const LABEL = "Wealth Score";
// Lower edge of each band, in cents, highest first.
const BANDS = [
  { score: 5, fromCents: 2500000 },
  { score: 4, fromCents: 1000000 },
  { score: 3, fromCents: 250000 },
  { score: 2, fromCents: 50000 },
  { score: 1, fromCents: 0 },
];
const SENTENCE = "Wealth Score: a 1 to 5 rank somebody on your team set by hand (5 = could give $25,000 or more a year, 4 = $10,000 to $25,000, 3 = $2,500 to $10,000, 2 = $500 to $2,500, 1 = under $500). Blank means nobody has set one. Steward's suggestions are never counted.";

// A value from a form, a file or a query string, as a score or null.
// Returns { ok, score } where score is 1..5 or null (clear); ok:false otherwise.
function parseScore(v) {
  if (v === null || v === undefined) return { ok: true, score: null };
  const s = String(v).trim();
  if (s === "" || /^(none|not set|clear|-)$/i.test(s)) return { ok: true, score: null };
  if (!/^[1-5](\.0+)?$/.test(s)) return { ok: false };
  return { ok: true, score: Number(s.slice(0, 1)) };
}
const isScore = n => Number.isInteger(n) && n >= MIN && n <= MAX;

function bandFor(cents) {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  return BANDS.find(b => c >= b.fromCents).score;
}

const FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dollars = cents => "$" + FMT.format(Math.round(Number(cents) || 0) / 100);
const dayNum = d => Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86400000;

// facts: { today, gifts:[{date,cents}], refunds:[{date,cents<0}], screening:{provider,capacityLowCents}|null }
// Returns { score, cents, basis, sentence } or null when there is nothing to read.
function suggest(facts) {
  const f = facts || {};
  const today = String(f.today || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const rows = [...(f.gifts || []).filter(g => g && g.cents > 0 && g.date), ...(f.refunds || []).filter(r => r && r.cents < 0 && r.date)];
  const lastYear = Number(today.slice(0, 4)) - 1;
  const t = dayNum(today);
  let yearCents = 0, trailingCents = 0;
  for (const g of rows) {
    if (Number(String(g.date).slice(0, 4)) === lastYear) yearCents += g.cents;
    const age = t - dayNum(g.date);
    if (age >= 0 && age < 365) trailingCents += g.cents;
  }
  const cands = [];
  if (yearCents > 0) cands.push({ basis: "year", cents: yearCents, words: `gave ${dollars(yearCents)} in ${lastYear}` });
  if (trailingCents > 0) cands.push({ basis: "trailing", cents: trailingCents, words: `gave ${dollars(trailingCents)} in the last twelve months` });
  const s = f.screening;
  if (s && s.capacityLowCents != null && Number(s.capacityLowCents) > 0) {
    cands.push({ basis: "screening", cents: Number(s.capacityLowCents),
      words: `${s.provider ? `${s.provider}'s screening file` : "a screening file"} puts their capacity at ${dollars(s.capacityLowCents)} or more` });
  }
  if (!cands.length) return null;
  // The highest band wins; on a tie, their own giving speaks before a vendor's.
  const best = cands.reduce((a, b) => (bandFor(b.cents) > bandFor(a.cents) ? b : a));
  const score = bandFor(best.cents);
  return { score, cents: best.cents, basis: best.basis, sentence: `Steward suggests ${score}: ${best.words}.` };
}

module.exports = { MIN, MAX, LABEL, BANDS, SENTENCE, parseScore, isScore, bandFor, suggest, dollars };
