#!/usr/bin/env node
// BUILD-72 Part 4 — THE DATE-BOUNDARY ENUMERATION. Read-only source scan.
//
// The type discipline this build adopts:
//   INSTANTS    — created_at, webhook receipt times, session times. timestamptz,
//                 always UTC. `now()` on one of these is CORRECT and is not a
//                 finding: 358 of the 613 raw matches in server.js/db.js are
//                 exactly that.
//   CIVIL DATES — gift date, pledge due date, task due, campaign start/end.
//                 No timezone. A gift given on March 15 was given on March 15
//                 in every timezone on earth, and any code that shifts it is
//                 wrong.
//
// THE RULE: never compare a civil-date column to now(), CURRENT_DATE,
// CURRENT_TIMESTAMP, or a JavaScript `new Date()`. That comparison is the bug,
// in all of its forms — including the one Part 0 captured live, where a task
// due today read as "1 day overdue" at 20:00:58 EDT with nothing changing but
// the clock.
//
// This script IS the enumeration. tests/date-seam.test.js runs it and fails
// when the count of unrouted sites goes UP, so coverage cannot decay the moment
// someone adds a view.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = ["server.js", "db.js"];

// Civil-date columns, from information_schema (DATE, or TEXT holding YYYY-MM-DD).
const CIVIL_COLUMNS = [
  "campaigns.end_date", "campaigns.start_date", "donors.first_gift_date",
  "donors.last_gift_date", "events.date", "events.end_date", "fin_transactions.date",
  "fundraising_goals.period_end", "fundraising_goals.period_start", "gifts.date",
  "grant_interactions.date", "grants.report_due", "interactions.date",
  "metric_snapshots.snapshot_date", "opportunities.expected_close",
  "planned_gifts.date_indicated", "pledges.due_date", "programs.end_date",
  "programs.start_date", "tasks.due",
];
const CIVIL_BARE = [...new Set(CIVIL_COLUMNS.map(c => c.split(".")[1]))];

// A SQL fragment that compares a civil-date column against an instant/clock.
const CLOCK = String.raw`(now\(\)|CURRENT_DATE|CURRENT_TIMESTAMP)`;
const CIVIL = `(?:\\b(?:${CIVIL_BARE.join("|")})\\b)`;

// JS `Date.now()` / `new Date()` contain the substring "date" and must not be
// mistaken for the column. SQL lives in multi-line template literals, so the
// civil column and the clock token are often on DIFFERENT lines — the sqlOnly
// patterns are therefore matched against a small window, not one line.
const JS_NOT_SQL = /Date\.now\(\)|new Date\(/;

const DEFECTS = [
  ["civil_vs_clock_sql",
   new RegExp(`${CLOCK}`),
   "a civil-date column compared against the SQL clock",
   { window: 4, needsCivil: true }],
  ["civil_from_utc_instant",
   /toISOString\(\)\.(?:slice\(0,\s*10\)|split\("T"\)\[0\])/,
   "a civil date derived from a UTC instant"],
  ["fixed_ms_week",
   /7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|\b604800000\b/,
   "fixed-ms week — wrong by definition across a DST transition (167/169h)"],
  ["server_local_year",
   /new Date\(\)\.getFullYear\(\)|_?[a-zA-Z]*[Nn]ow\.getFullYear\(\)/,
   "a period year taken from the server's local clock"],
  ["server_local_bounds",
   /\bdigestYmd\(new Date\(\)\)|new Date\(\s*now\.getFullYear\(\)/,
   "period bounds built from the server's local clock"],
];

// Call sites that have been routed through the seam are no longer defects.
const ROUTED = /orgToday\(|orgPeriodBounds\(|orgIsOverdue\(|orgCivilNow\(|ORG_TZ_SEAM_OK/;

function scan() {
  const found = {};
  let routed = 0;
  for (const f of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
    lines.forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, "");           // ignore comments
      if (!line.trim()) return;
      if (ROUTED.test(line)) { routed++; return; }
      for (const [key, re, desc, opts] of DEFECTS) {
        if (!re.test(line)) continue;
        if (opts && opts.needsCivil) {
          if (JS_NOT_SQL.test(line)) continue;                 // JS clock, not SQL
          const w = opts.window || 0;
          const ctx = lines.slice(Math.max(0, i - w), i + w + 1)
            .map(l => l.replace(/\/\/.*$/, "")).join("\n");
          if (!new RegExp(CIVIL).test(ctx)) continue;          // no civil column nearby
        }
        (found[key] ||= []).push({ at: `${f}:${i + 1}`, src: raw.trim().slice(0, 110) });
      }
    });
  }
  return { found, routed };
}

function report({ found, routed }, { verbose = true } = {}) {
  let total = 0;
  const rows = [];
  for (const [key, , desc] of DEFECTS) {
    const hits = found[key] || [];
    total += hits.length;
    rows.push({ key, n: hits.length, desc, hits });
  }
  if (verbose) {
    console.log("BUILD-72 Part 4 — civil-date / instant confusion sites\n");
    for (const r of rows) console.log(`  ${r.key.padEnd(24)} ${String(r.n).padStart(4)}   ${r.desc}`);
    console.log(`  ${"".padEnd(24)} ${String(total).padStart(4)}   TOTAL UNROUTED SITES`);
    console.log(`  ${"".padEnd(24)} ${String(routed).padStart(4)}   routed through the seam`);
    for (const r of rows) {
      if (!r.hits.length) continue;
      console.log(`\n${r.key} (${r.n}) — ${r.desc}`);
      for (const h of r.hits) console.log(`  ${h.at.padEnd(16)} ${h.src}`);
    }
  }
  return { total, routed, rows };
}

if (require.main === module) {
  const r = report(scan(), { verbose: !process.argv.includes("--count") });
  if (process.argv.includes("--count")) console.log(JSON.stringify({ total: r.total, routed: r.routed }));
}
module.exports = { scan, report, DEFECTS, CIVIL_COLUMNS };
