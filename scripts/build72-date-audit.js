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

// ── REACHABILITY (added after BUILD-74 found three sites this audit could not
// see) ─────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS. Everything above matches EXPRESSIONS ON LINES. That makes a
// defective HELPER exactly one site forever: `localDateKey` was counted once,
// at its definition, and its three call sites — including the one that stamped
// tasks.due for the portal drift wire — were invisible. A fourth caller would
// never have moved `total`, so `total <= BASELINE` could not fail for this
// class. Part 4 enumerated ~100 sites and still shipped the bug, because the
// method asks "where is the bad expression written?" and never "where does the
// bad value get USED?".
//
// scanHelpers answers the second question: which functions DERIVE a civil date
// (or a day-of decision) from process-local Date accessors, and how many call
// sites do they have. The call-site total is the number to hold flat.
const LOCAL_ACCESSOR = /\.(getFullYear|getMonth|getDate|getHours|getDay|getMinutes)\s*\(\)/;
const HELPER_DEF = /^(?:\s*)(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\()/;

function bodyOf(lines, start) {
  let depth = 0, seen = false, out = [];
  for (let j = start; j < lines.length && j < start + 400; j++) {
    out.push(lines[j].replace(/\/\/.*$/, ""));
    for (const ch of lines[j]) { if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--; }
    if (seen && depth <= 0) break;
  }
  return out.join("\n");
}

// `sources` (optional) — [{ f, lines }] to scan a CONSTRUCTED tree instead of
// the repo. date-seam §8 uses this to PROVE the guard fails on a tree where
// the defect exists — a guard never seen failing is not known to guard.
function scanHelpers(sources = null) {
  const srcs = sources || FILES.map(f => ({ f, lines: fs.readFileSync(path.join(ROOT, f), "utf8").split("\n") }));
  const helpers = [];
  for (const { f, lines } of srcs)
    lines.forEach((raw, i) => {
      const m = HELPER_DEF.exec(raw);
      if (!m) return;
      const body = bodyOf(lines, i);
      // LINE-LEVEL taint (BUILD-75 A.6): a helper is tainted when any line of
      // its body reads a process-local accessor on a line that is not itself
      // routed through the seam. The old BODY-level escape (`ROUTED.test(body)`
      // cleared the whole helper) meant one seam call anywhere in a body could
      // hide a raw accessor elsewhere in it — a helper could BECOME tainted
      // with the guard unable to see it, the exact class this scan exists for.
      const tainted = body.split("\n").some(l => LOCAL_ACCESSOR.test(l) && !ROUTED.test(l));
      if (!tainted) return;
      helpers.push({ name: m[1] || m[2], at: `${f}:${i + 1}` });
    });
  let callSites = 0;
  const rows = helpers.map(h => {
    const call = new RegExp(`(?<![\\w$.])${h.name}\\s*\\(`);
    const sites = [];
    for (const { f, lines } of srcs)
      lines.forEach((raw, i) => {
        const at = `${f}:${i + 1}`;
        if (at === h.at) return;
        const line = raw.replace(/\/\/.*$/, "");
        const dm = HELPER_DEF.exec(line);
        if (dm && (dm[1] || dm[2]) === h.name) return;
        if (call.test(line)) sites.push(at);
      });
    callSites += sites.length;
    return { ...h, callers: sites.length, sites };
  });
  rows.sort((a, b) => b.callers - a.callers);
  return { helpers: rows, callSites };
}

if (require.main === module) {
  const r = report(scan(), { verbose: !process.argv.includes("--count") });
  const h = scanHelpers();
  if (process.argv.includes("--count")) {
    console.log(JSON.stringify({ total: r.total, routed: r.routed, helperCallSites: h.callSites }));
  } else {
    console.log(`\nREACHABILITY — helpers deriving a civil date from the PROCESS clock`);
    console.log(`  ${String(h.helpers.length).padStart(4)}   tainted helpers`);
    console.log(`  ${String(h.callSites).padStart(4)}   call sites the line-oriented count above CANNOT see\n`);
    for (const x of h.helpers) console.log(`  ${String(x.callers).padStart(3)}  ${x.name.padEnd(28)} ${x.at}`);
  }
}
module.exports = { scan, report, scanHelpers, DEFECTS, CIVIL_COLUMNS };
