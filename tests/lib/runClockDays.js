// tests/lib/runClockDays.js · FLAKE-5 (W-DAY-sweep). A TEST MAY NOT TURN THE CLOCK
// INTO A UTC DAY.
//
// CLOCK-1's real-clock rule stops `Date.now()` and a bare `new Date()` in tests,
// and test-clock-seam stops a bare `new Date()` read as a calendar. What both let
// through is the run's own clock made into a day the UTC way:
//
//     new Date(testNow() + 10 * DAY).toISOString().slice(0, 10)     // "10 days from now"
//
// testNow() is the real clock on CI (no pin since CLOCK-1), and that is the UTC
// day: from 7 PM Eastern it is the next day, while the server and dayOffset() say
// New York's. sales1-crm §11 failed every evening on exactly this (11b7a36). A
// day from the run's clock comes from tests/clock.js: civilDay(), dayOffset(n).
//
// scan(source) returns the 1-based lines where a clock-derived value (testNow(),
// Date.now(), new Date(), or a name assigned from one, transitively, e.g.
// `const daysAgo = n => new Date(testNow() - n * DAY)`) meets a UTC day
// (`toISOString()` cut to 10 characters or split at "T", or `getUTC*`).
"use strict";
const fs = require("fs");
const path = require("path");

const UTC_DAY = /toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|substr\(\s*0\s*,\s*10\s*\)|split\(\s*["'`]T["'`]\s*\))|\.getUTC(Date|Day|Month|FullYear)\s*\(/;
const CLOCK = /\btestNow\(\s*\)|\bDate\.now\(\s*\)|\bnew Date\(\s*\)/;
const ASSIGN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/;

const strip = line => line.replace(/\/\/.*$/, "");

function scan(source) {
  const lines = String(source).split("\n").map(strip);
  const ids = new Set();
  const refersToClock = text => CLOCK.test(text) || [...ids].some(id => new RegExp(`(^|[^\\w$.])${id.replace(/\$/g, "\\$")}\\b`).test(text));
  for (let changed = true; changed;) {   // names fed by the clock, to a fixed point
    changed = false;
    for (const l of lines) {
      const m = l.match(ASSIGN);
      if (m && !ids.has(m[1]) && refersToClock(m[2])) { ids.add(m[1]); changed = true; }
    }
  }
  const hits = [];
  lines.forEach((l, i) => { if (UTC_DAY.test(l) && refersToClock(l)) hits.push(i + 1); });
  return hits;
}

// Every tests/*.test.js, as { name: [lines] }, files with none left out. Not
// script-guards itself, whose planted lines are this guard's proof.
const OWN = "script-guards.test.js";
function scanTests(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".test.js") && f !== OWN).sort()) {
    const hits = scan(fs.readFileSync(path.join(dir, f), "utf8"));
    if (hits.length) out[f.replace(/\.test\.js$/, "")] = hits;
  }
  return out;
}

module.exports = { scan, scanTests, UTC_DAY, CLOCK };
