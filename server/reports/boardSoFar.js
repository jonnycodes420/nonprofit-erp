// server/reports/boardSoFar.js · POLISH-14 item 4. A YEAR-TO-DATE FIGURE SAYS "SO FAR", WITH LAST YEAR'S WHOLE YEAR BESIDE IT.
//
// Duet (27 Nov): the board pack read "Retention 23%" with no word that it was
// the fiscal year to date; the Retention report read 64% for last year, so a
// board reads 23% as a collapse. Every year-to-date figure on the board pack
// now says "so far this fiscal year" and shows last fiscal year's full figure
// beside it, from the same functions (retained.js, the ledger's own sums), so
// the two halves of a tile are one rule over two spans.
"use strict";
const NUMBERS = require("../../shared/numbers");

const SO_FAR = "so far this fiscal year";

// Last fiscal year, whole: { label, revenue, expenses, net, retentionRate } (rate null when nobody gave the year before).
async function lastYearFull(query, orgId, org) {
  const FY = NUMBERS.fiscalYear;
  const prev = FY.fiscalYear(org || {}, -1), prev2 = FY.fiscalYear(org || {}, -2);
  const [fin, ret] = await Promise.all([
    NUMBERS.ledgerSpan.ledgerByType(query, orgId, prev.start, prev.end),
    NUMBERS.retained.retention(query, orgId, { from: prev.start, to: prev.end }, { from: prev2.start, to: prev2.end }),
  ]);
  const revenue = fin.income, expenses = fin.expense;
  return { label: prev.label, start: prev.start, end: prev.end, revenue, expenses, net: revenue - expenses,
    retentionRate: ret.prior > 0 ? Math.round(ret.retained / ret.prior * 100) : null };
}

// The small line under a tile: "Last fiscal year (FY 2025–26), full year: 64%".
function besideWords(last, value) {
  return `Last fiscal year (${last.label}), full year: ${value == null ? "no donors the year before to compare" : value}`;
}

module.exports = { SO_FAR, lastYearFull, besideWords };
