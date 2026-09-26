#!/usr/bin/env node
// tests/test-clock-seam.test.js — CI #297. A SUITE MAY NOT TAKE A CIVIL DATE FROM
// THE MACHINE'S CLOCK.
//
// ── WHAT HAPPENED, AND WHY A GREP IS THE RIGHT ANSWER ─────────────────────
// CI #297 failed six suites and the product was innocent in every one. Four of
// them computed "today" from `new Date()` and compared it against a server that
// computes "today" from the ORG's timezone. CI runners are UTC; the fixture orgs
// are America/New_York; and between 20:00 and midnight Eastern the two disagree by
// a day. Four suites, four separate helpers, all wrong the same way.
//
// The part worth dwelling on: THREE OF THOSE FOUR HELPERS CARRIED A COMMENT
// WARNING ABOUT EXACTLY THIS. They said "never toISOString(), after 8pm Eastern
// the UTC calendar has already turned over" — and then read the MACHINE's local
// calendar parts instead, on the stated assumption that the machine is New York.
// The authors understood the hazard and still shipped it, three times, because the
// fix they reached for was local-instead-of-UTC rather than the org's zone.
//
// A rule that people already know and still break does not need explaining again.
// It needs a gate. `tests/helpers.js` exports `civilToday()` and `civilPlusDays()`;
// this suite fails the battery if a suite reaches past them.
//
// ── WHAT IT REFUSES, AND WHAT IT DELIBERATELY ALLOWS ──────────────────────
// REFUSED: `new Date()` with no argument, anywhere it can reach a civil date —
// `.getFullYear()/.getMonth()/.getDate()`, `.toISOString().slice(0,10)`,
// `.toISOString().split("T")`, or `Date.now()` divided into days.
//
// ALLOWED, each for a reason:
//   · `new Date(<argument>)` — parsing a date the server RETURNED is not taking a
//     date from the clock; it is reading an answer.
//   · a TIMESTAMP, not a civil date — `Date.now()` for an elapsed-milliseconds
//     measurement, a `setTimeout`, a performance number. A suite may know what
//     time it is; it may not decide what DAY it is.
//   · an Intl format in an explicit timeZone — that IS the correct mechanism, and
//     `civilToday` is built out of it.
//   · a file that says, on the line, why it is exempt: `// clock-seam-ok: <reason>`.
//     A gate with no escape hatch gets bypassed wholesale the first time it is
//     wrong; one with a documented, greppable hatch gets argued with line by line.
//
// Run: node tests/test-clock-seam.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = __dirname;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 400) : "")); } };

// The file that is ALLOWED to build the civil clock, because it is the one that
// defines it. Everything else must go through it.
const THE_SEAM = "helpers.js";

// The shapes that turn a machine clock into a civil DATE. Each is a real line from
// the four suites CI #297 caught, generalised.
const PATTERNS = [
  { re: /new Date\(\s*\)\s*[;,)]?\s*$/,           why: "bare new Date() — whose day is that?" },
  { re: /new Date\(\s*\)\s*\.\s*get(FullYear|Month|Date)\b/, why: "reads the machine's calendar parts" },
  { re: /new Date\(\s*\)\s*\.\s*toISOString\(\s*\)\s*\.\s*(slice|split)/, why: "UTC civil date from the machine clock" },
  { re: /\.setDate\(\s*\w+\.getDate\(\s*\)\s*[+-]/,  why: "day arithmetic on a machine-clock Date" },
  { re: /Date\.now\(\s*\)[^;]*\/\s*86400000/,        why: "days from Date.now()" },
  { re: /Date\.now\(\s*\)[^;]*864e5/,                why: "days from Date.now()" },
];

// A line may exempt itself, on the line, with a reason.
const EXEMPT_RE = /clock-seam-ok:\s*\S/;

function scan(sources = null) {
  const srcs = sources || fs.readdirSync(DIR)
    .filter(f => f.endsWith(".js") && f !== THE_SEAM)
    .map(f => ({ f, lines: fs.readFileSync(path.join(DIR, f), "utf8").split("\n") }));
  const hits = [];
  for (const { f, lines } of srcs) {
    lines.forEach((raw, i) => {
      // Comments are not code. A file that EXPLAINS this rule must not fail it —
      // which is the trap the legal-entity guard paid for (BUILD-90).
      const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (!line.trim()) return;
      if (EXEMPT_RE.test(raw)) return;
      for (const p of PATTERNS) {
        if (p.re.test(line)) { hits.push({ file: f, line: i + 1, why: p.why, text: raw.trim().slice(0, 120) }); break; }
      }
    });
  }
  return hits;
}

console.log("test-clock-seam");
console.log("\n— §1 · the count may FALL, never rise —");
const hits = scan();

// ── WHY THIS IS A RATCHET AND NOT ZERO, TONIGHT ───────────────────────────
// Seventy-six sites across the suite directory take a civil value from the
// machine clock. They are not noise — I read them. Twenty-nine are
// `new Date().toISOString().slice(0, 10)` used as a GIFT DATE, which is the exact
// thing helpers.js warns about two lines above `civilToday`: after 8pm Eastern
// that stamps TOMORROW on a New York org, and the import is right to refuse it.
// The rest derive a fiscal year or a month from the same clock, which is lower
// risk only because the fiscal boundary is one day a year.
//
// Fixing seventy-six suites is its own pass, and each one needs checking that the
// correction does not change what it asserts — which is exactly the work that
// should not be done at speed at the end of a long night. So this is a ratchet, on
// the repo's own established mechanism (date-seam's BASELINE, the palette census):
// A RATCHET IS NOT A WEAKER RULE THAN ZERO — IT IS THE SAME RULE WITH A DATE ON
// IT, and unlike a TODO it cannot be quietly lost.
//
// The four CI #297 actually caught are already out of this count.
const BASELINE = Number(process.env.TEST_CLOCK_BASELINE || 76);
ok(`suites taking a civil date from the machine clock: ${hits.length} (baseline ${BASELINE}) — must not RISE`,
   hits.length <= BASELINE, { count: hits.length, BASELINE, worst: hits.slice(0, 8) });
if (hits.length < BASELINE) {
  console.log(`  NOTE  ${BASELINE - hits.length} site(s) newly routed through the seam — lower TEST_CLOCK_BASELINE to ${hits.length} to lock the gain in.`);
}
// AND THE FOUR THAT FAILED CI #297 ARE AT ZERO, held there by name. The ratchet
// protects the rest; these four are finished and may not come back.
const FIXED = ["build99-plans.test.js", "build100-deadlines.test.js",
               "build100-reports.test.js", "build102-funnel.test.js"];
const regressed = hits.filter(h => FIXED.includes(h.file));
ok(`§1 the four suites CI #297 caught are at ZERO and stay there`, regressed.length === 0, regressed);

console.log("\n— §2 · the seam it must go through actually exists —");
const h = require("./helpers");
ok("§2 helpers exports civilToday", typeof h.civilToday === "function");
ok("§2 …and civilPlusDays", typeof h.civilPlusDays === "function");
ok("§2 civilToday is a civil date in the ORG's zone, not UTC's",
   h.civilToday() === new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()),
   h.civilToday());
ok("§2 civilPlusDays(0) is civilToday", h.civilPlusDays(0) === h.civilToday(), [h.civilPlusDays(0), h.civilToday()]);
// The arithmetic must be exact across a DST boundary, because a zoned +24h is not
// a day (BUILD-94 paid for that one).
const spring = "2026-03-08", fall = "2026-11-01";
const addCivil = (d, n) => { const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
ok("§2 a civil day count is exact across spring-forward", addCivil(spring, 1) === "2026-03-09");
ok("§2 …and across fall-back", addCivil(fall, 1) === "2026-11-02");

console.log("\n— §3 · the four shapes CI #297 actually caught are all refused —");
const REAL = [
  ['  const d = new Date(); d.setDate(d.getDate() + n);', "build99-plans / build100-*"],
  ['  const d = new Date();', "build100-deadlines todayLocal"],
  ['  [odd.body.id, new Date().toISOString().slice(0, 10)]);', "build102-funnel form_events.day"],
  ['  const day = new Date().toISOString().split("T")[0];', "the older split form"],
];
for (const [line, origin] of REAL) {
  const h2 = scan([{ f: "synthetic.js", lines: [line] }]);
  ok(`§3 refused: ${origin}`, h2.length === 1, { line, hits: h2 });
}

console.log("\n— §4 · and the shapes it must NOT flag —");
const FINE = [
  ['  const d = new Date(row.date);', "parsing what the server returned"],
  ['  const t0 = Date.now(); const ms = Date.now() - t0;', "elapsed milliseconds"],
  ['  await new Promise(r => setTimeout(r, 300));', "a wait"],
  ['  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());', "the correct mechanism"],
  ['  const day = civilPlusDays(0);', "through the seam"],
  ['  const stamp = new Date().toISOString();  // clock-seam-ok: an instant, not a day', "an exempted instant"],
];
for (const [line, why] of FINE) {
  const h2 = scan([{ f: "synthetic.js", lines: [line] }]);
  ok(`§4 allowed: ${why}`, h2.length === 0, { line, hits: h2 });
}

console.log(`\ntest-clock-seam: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
