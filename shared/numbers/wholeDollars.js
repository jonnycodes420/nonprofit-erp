// shared/numbers/wholeDollars · PIPE-1. ONE WAY TO ROUND MONEY TO THE DOLLAR.
//
// Home writes some figures in whole dollars ("$10,150 behind last year").
// Every place that rounds a dollar amount for a sentence, and every check that
// holds such a sentence to the ledger (tests/lib/surfacesAgree.js), rounds with
// THIS function, never its own. On 13 Nov the check used Math.round on a signed
// gap: -$10,149.50 became -$10,149 while Home said $10,150 behind, and a suite
// went red on main because of the day it ran (CI-PIN-2404, PIPE-1).
//
// The rule: half away from zero. $10,149.50 is $10,150 and -$10,149.50 is
// -$10,150, so a gap reads the same size ahead or behind. Math.round alone is
// half toward +infinity, which differs exactly on negative halves.
"use strict";

// Dollars (a number, may be negative) → whole dollars, half away from zero.
// Computed in cents first so 0.1 + 0.2-style float dust never decides a half.
function wholeDollars(dollars) {
  const n = Number(dollars) || 0;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100) + (cents % 100 >= 50 ? 1 : 0);
  return n < 0 && whole !== 0 ? -whole : whole;
}

// Cents (an integer, may be negative) → whole dollars in cents, half away from zero.
function wholeDollarCents(cents) {
  return wholeDollars((Number(cents) || 0) / 100) * 100;
}

// "$10,150": whole dollars with thousands commas. A negative amount keeps its sign.
function dollarsLabel(dollars) {
  const w = wholeDollars(dollars);
  return (w < 0 ? "-$" : "$") + Math.abs(w).toLocaleString("en-US");
}

module.exports = { wholeDollars, wholeDollarCents, dollarsLabel };
