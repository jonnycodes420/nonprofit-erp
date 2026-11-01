#!/usr/bin/env node
// scripts/ci/arch-check.js: ARCH-1 item 2. THE RATCHET: rules that only tighten.
//
// docs/architecture/ARCHITECTURE.md sets the rules; this checks the ones a
// machine can. Each check keeps today's violations in
// docs/architecture/baseline/<check>.json, and FAILS when a count goes UP.
// When a build removes violations it lowers the baseline in the same commit:
//
//   node scripts/ci/arch-check.js            check (CI's guards job, pre-push)
//   node scripts/ci/arch-check.js --update   lower the baselines to today's counts;
//                                            refuses if any count would go up
//   node scripts/ci/arch-check.js --root <dir>  check another tree (the planted-defect test)
//
// The checks are pattern matches, written down in ARCHITECTURE.md ("The ratchet").
// They miss things and catch some innocent lines; because they are ratchets, an
// innocent line that already exists is in the baseline and costs nothing.
// No server, no database, no network.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(flag("root") || path.join(__dirname, "..", ".."));
const BASE_DIR = path.join(ROOT, "docs", "architecture", "baseline");
const INIT = args.includes("--init");              // ARCH-1 only: write the first baselines
const UPDATE = args.includes("--update") || INIT;

const BIG = 1500, GROWTH = 50, IMAGE_MAX = 500 * 1024;

const tracked = () => execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 << 20 })
  .toString().split("\0").filter(Boolean).filter(f => fs.existsSync(path.join(ROOT, f)));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const lineCount = f => { const s = read(f); return s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0; };
const countLines = (f, re) => read(f).split("\n").filter(l => re.test(l)).length;

const CODE = /\.(js|jsx|mjs|cjs)$/;

// Gift SQL a route must not compute: a sum of an amount, or a window over a gift's date.
const GIFT_SQL = /SUM\s*\([^)]*amount|\b(g|gifts|gi|g2)\.date\s*(>=|<=|<|>|BETWEEN)|LEFT\s*\(\s*(\w+\.)?date\s*,\s*4\s*\)/i;
const isRoute = f => /^routes\/.+\.js$/.test(f) || /^server\/[^/]+\/routes?[^/]*\.js$/.test(f);

// A hand-rolled fiscal-year boundary: a month compared with the start month, a
// date string built from the start month, or one of the known copies by name.
const SM = String.raw`(sm|startMonth|fiscalStartMonth|fyStartMonth|fsm|fyMonth)`;
const FISCAL = new RegExp([
  String.raw`\b(m|month|mo|c\.m|t\.m|now\.m|cm|_today\.m)\s*(<|>=)\s*${SM}\b`,
  String.raw`\$\{[^}]*\}-\$\{[^}]*\b${SM}\b`,
  // (NUMBERS-3: donorStatus.windowsFor now reads shared/numbers/fiscalYear.js,
  // so its name is no longer a copy; finPeriodBounds and fyOf are deleted.)
  String.raw`\bfunction\s+(fyOf|finPeriodBounds)\b`,
  String.raw`\bconst\s+fyOf\s*=`,
  String.raw`getMonth\(\)\s*(\+\s*1\s*)?(<|>=)\s*\w*${SM}`,
].join("|"));
const FISCAL_HOME = new Set(["orgTime.js", "shared/fiscalPeriod.js", "shared/numbers/fiscalYear.js"]);   // NUMBERS-3: the home
const isAppCode = f => CODE.test(f) && !/^(tests|scripts|docs|audit|node_modules)\//.test(f) && !/(^|\/)node_modules\//.test(f);

// A test that reads the real clock instead of setting its own (the same count
// tests/test-clock-seam.test.js §5 holds against audit/test-clock-direct.json).
const REAL_CLOCK = /Date\.now\(\s*\)|new Date\(\s*\)/;
const isTestFile = f => /^tests\/[^/]+\.js$/.test(f) && !/^tests\/(clock|test-clock-seam\.test)\.js$/.test(f);
const countClock = f => read(f).split("\n").filter(l => REAL_CLOCK.test(l.replace(/\/\/.*$/, ""))).length;

// Code for one customer: an org id written into app code, or a branch on one
// org's slug. Differences between orgs are settings or data. Tests, scripts and
// fixtures are exempt (a fixture org is supposed to have an id).
const ORG_SPECIFIC = /["'`]org_[a-z0-9][a-z0-9_]{2,}["'`]|org_slug\s*===?\s*["'`]|\borgId\s*===?\s*["'`]org_/;

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i;
const IMAGE_OK = f => f.startsWith("client/src/assets/") || f.startsWith("assets/");

// ── the checks: each returns { counts: {key: n} } and how to judge it ───────
const CHECKS = {
  "big-files": {
    what: `files over ${BIG} lines (a listed file may grow by at most ${GROWTH})`,
    measure: files => Object.fromEntries(files.filter(f => CODE.test(f)).map(f => [f, lineCount(f)]).filter(([, n]) => n > BIG)),
    // A file in the baseline may be up to baseline + GROWTH; one not in it is new.
    worse: (key, now, base) => base == null ? `${key} is ${now} lines (no new file over ${BIG})`
      : now > base + GROWTH ? `${key} grew to ${now} lines (baseline ${base}, at most +${GROWTH})` : null,
  },
  "route-gift-sql": {
    what: "lines in routes/ that sum an amount or window a gift's date",
    measure: files => Object.fromEntries(files.filter(isRoute).map(f => [f, countLines(f, GIFT_SQL)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} gift-SQL lines (baseline ${base || 0}); call the service or figure source` : null,
  },
  "fiscal-year": {
    what: "hand-rolled fiscal-year boundaries outside orgTime.orgPeriodBounds",
    measure: files => Object.fromEntries(files.filter(f => isAppCode(f) && !FISCAL_HOME.has(f)).map(f => [f, countLines(f, FISCAL)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} fiscal-year boundary lines (baseline ${base || 0}); use orgTime.orgPeriodBounds(org, "fiscal_year")` : null,
  },
  "scripts-root": {
    what: "files in the scripts/ root (new ones go in scripts/ops, ci or once)",
    measure: files => Object.fromEntries(files.filter(f => /^scripts\/[^/]+$/.test(f) && !/README\.md$/.test(f)).map(f => [f, 1])),
    worse: (key, now, base) => base == null ? `${key} is new in the scripts/ root; put it in scripts/ops/, scripts/ci/ or scripts/once/` : null,
  },
  "real-clock": {
    what: "test files that read the real clock (Date.now(), new Date()) instead of setting their own",
    measure: files => Object.fromEntries(files.filter(isTestFile).map(f => [f, countClock(f)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} real-clock reads (baseline ${base || 0}); set the test's own time through tests/clock.js` : null,
  },
  "org-specific": {
    what: "app code naming one org (an org id or slug in code; tests, scripts and fixtures excepted)",
    measure: files => Object.fromEntries(files.filter(isAppCode).map(f => [f, countLines(f, ORG_SPECIFIC)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} lines naming one org (baseline ${base || 0}); make it a setting or data` : null,
  },
  "big-images": {
    what: `committed images over ${IMAGE_MAX / 1024} KB outside client/src/assets/ and assets/ (a hard rule)`,
    hard: true,
    measure: files => Object.fromEntries(files.filter(f => IMAGE.test(f) && !IMAGE_OK(f))
      .map(f => [f, fs.statSync(path.join(ROOT, f)).size]).filter(([, n]) => n > IMAGE_MAX)),
    worse: (key, now) => `${key} is ${Math.round(now / 1024)} KB; screenshots and captures stay out of git`,
  },
};

const files = tracked();
let failed = 0;
const out = [];
for (const [name, c] of Object.entries(CHECKS)) {
  const now = c.measure(files);
  const bPath = path.join(BASE_DIR, name + ".json");
  let base = c.hard ? {} : (fs.existsSync(bPath) ? JSON.parse(fs.readFileSync(bPath, "utf8")).counts : null);
  if (base == null && INIT) base = { ...now };   // the first baseline is today, once
  if (base == null) { out.push(`  ✗ ${name}: no baseline at ${path.relative(ROOT, bPath)}`); failed++; continue; }
  const bad = Object.keys(now).map(k => c.worse(k, now[k], base[k])).filter(Boolean);
  const total = o => Object.values(o).reduce((s, n) => s + n, 0);
  if (bad.length) {
    failed++;
    out.push(`  ✗ ${name}: ${c.what}`);
    for (const b of bad) out.push(`      ${b}`);
  } else {
    const lower = Object.keys(base).filter(k => (now[k] || 0) < base[k]).length;
    out.push(`  ✓ ${name}: ${c.hard ? "none" : `${Object.keys(now).length} file(s), ${name === "big-files" || name === "scripts-root" ? "" : total(now) + (name === "real-clock" ? " read(s), " : " line(s), ")}within the baseline`}${lower ? ` (${lower} below it: run --update to lower it)` : ""}`);
  }
  if (UPDATE && !c.hard && !bad.length) {
    // Only ever down: each key keeps the lower of its baseline and today, and a
    // key with nothing left drops out. (A big file that grew within its +50 keeps
    // its old baseline, so the allowance never compounds.)
    fs.mkdirSync(BASE_DIR, { recursive: true });
    const kept = Object.keys(now).filter(k => k in base).map(k => [k, Math.min(now[k], base[k])]);
    const sorted = Object.fromEntries(kept.sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(bPath, JSON.stringify({ check: name, what: c.what, counts: sorted }, null, 2) + "\n");
  }
}
console.log(`arch-check (docs/architecture/ARCHITECTURE.md)\n${out.join("\n")}`);
if (UPDATE && failed) console.log("\nNot updated where a count went up: the baseline only goes down.");
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
