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
//   node scripts/ci/arch-check.js --update --moved <file>
//                                            SPLIT-1: <file>'s lines moved VERBATIM into
//                                            new files, which take over its baseline; refused
//                                            unless their counts sum to exactly what left it
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
const MOVED = flag("moved");

const BIG = 1500, GROWTH = 50, IMAGE_MAX = 500 * 1024;

const tracked = () => execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 << 20 })
  .toString().split("\0").filter(Boolean).filter(f => fs.existsSync(path.join(ROOT, f)));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const lineCount = f => { const s = read(f); return s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0; };
const countLines = (f, re) => read(f).split("\n").filter(l => re.test(l)).length;

const CODE = /\.(js|jsx|mjs|cjs)$/;
// SPLIT-1: a route registration, the way crm.js's 561 were written.
const CRM_ROUTE = /\b(app|router|routers\.\w+)\.(get|post|put|patch|delete|all)\(\s*["'`]/;

// Gift SQL a route must not compute: a sum of an amount, or a window over a gift's date.
const GIFT_SQL = /SUM\s*\([^)]*amount|\b(g|gifts|gi|g2)\.date\s*(>=|<=|<|>|BETWEEN)|LEFT\s*\(\s*(\w+\.)?date\s*,\s*4\s*\)/i;
// NUMBERS-4: every file of server code, not only routes/ (the architect found
// 153 hand-written SUM(amount) outside shared/numbers/, most of them outside
// routes/; docs/architecture/money-sums.md lists and classes them). The home,
// shared/numbers/, is exempt: it is where the rule lives.
const isServerCode = f => /\.(js|cjs|mjs)$/.test(f) && !/^(client|tests|scripts|docs|audit|node_modules)\//.test(f)
  && !/(^|\/)node_modules\//.test(f) && !f.startsWith("shared/numbers/");

// NUMBERS-4 · A SECOND RULE FOR A DONOR LABEL. The shapes a copy of one of
// shared/numbers' rules takes, so a new copy goes red here: a "major" or "top
// tenth" line (the org's giving-level cut read, or a 90th percentile of
// lifetime), a hand-built lapse window (LAPSED_DAYS or 365 days off a last
// gift), or a first gift worked out from MIN over gift dates.
const NUMBER_COPY = new RegExp([
  String.raw`percentile_cont\(0\.9\)`,
  String.raw`giving_level_major_cents\s*(>=|<=|>|<)|(>=|<=|>|<)\s*\w*\.?giving_level_major_cents`,
  String.raw`(today|now|cutoff)\w*\s*-\s*(last_gift_date|lastGift)\w*\s*\)?\s*>=?\s*(365|LAPSED_DAYS)`,
  String.raw`MIN\s*\(\s*LEFT\s*\(\s*\w+\.date\s*,\s*10\s*\)\s*\)\s*FROM\s+gifts`,
].join("|"), "i");

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
// CLOCK-1: every test file and helper under tests/, not only the top level.
// The two clocks themselves (tests/clock.js, tests/lib/browserClock.js) and the
// seam's own test read the real clock on purpose; fixtures are data.
const isTestFile = f => /^tests\/.+\.js$/.test(f) && !/^tests\/fixtures\//.test(f)
  && !/^tests\/(clock|test-clock-seam\.test|lib\/browserClock)\.js$/.test(f);
const countClock = f => read(f).split("\n").filter(l => REAL_CLOCK.test(l.replace(/\/\/.*$/, ""))).length;

// Code for one customer: an org id written into app code, or a branch on one
// org's slug. Differences between orgs are settings or data. Tests, scripts and
// fixtures are exempt (a fixture org is supposed to have an id).
const ORG_SPECIFIC = /["'`]org_[a-z0-9][a-z0-9_]{2,}["'`]|org_slug\s*===?\s*["'`]|\borgId\s*===?\s*["'`]org_/;

// IDS-1: a row id built from a cut-down UUID ("th_" + uuid().slice(0, 8)) collides at
// tens of thousands of rows. Server code makes ids with server/shared/newId.js (20 hex).
// Any uuid().slice( counts, and so does uuid().replace(/-/g, "").slice(0, N) with N <= 12.
const SHORT_ID = /(uuid|randomUUID)\(\)\.slice\(|(uuid|randomUUID)\(\)\.replace\([^)]*\)\.slice\(0,\s*([1-9]|1[0-2])\)/;

// STATUS-1 · A SECOND RHYTHM. "When is this person's next gift due, and has
// it passed?" is shared/numbers/rhythm.js, once. The shapes a second answer
// takes: an expected date built from a cadence, a copy of the median /
// variability / season helpers, the old yearly-only "usual time ahead", and
// the closeness word read from the stored nightly pattern.
const RHYTHM_COPY = new RegExp([
  String.raw`addDays\(\s*[\w.]*last[\w.]*\s*,[^)]*\bcadence`,
  String.raw`\bfunction\s+(intervalCv|detectSeasonalCluster)\b`,
  String.raw`rhythm\s+IN\s*\(\s*'yearly'`,
  String.raw`YEARLY\.includes\(`,
  String.raw`ds\.pattern\b|\.pattern\s*===?\s*["']on_track`,
].join("|"));

// SCORES-1 · A DELETE OF AN ORG'S SCORES. On 4 Nov prod was down ~2.5 hours
// behind an ANALYZE of donor_scores, a table that churned because every
// change deleted and reinserted the whole org's rows. Scores are upserted
// (engagement.js writeScores); the only delete is a person's own row, so a
// line that deletes from donor_scores names donor_id on that line.
const SCORE_DELETE = /DELETE\s+FROM\s+donor_scores\b(?![^\n]*\bdonor_id\b)/i;

// SPLIT-2: the files cut down to a shell. Each is capped at the size the split
// left it; new code goes in its parts (server/db/, components/profile/).
const SHELLS = new Set(["server.js", "db.js", "client/src/components/DonorProfile.jsx"]);

// SPLIT-2 · A WRITE NOBODY ELSE SEES. server.js's statements live in
// server/boot/, and each module reads another's names through its own copy,
// refreshed by __boot.share(). A write to a module-scope name that is not
// followed at once by `__share({ name })` leaves every other module reading
// the old value: no error, just a stale status or an import that never landed.
const isBootModule = f => /^server\/boot\/(helpers|steps)-\d+\.js$/.test(f);
function unsharedWrites(f) {
  const ROOTDIR = ROOT;
  const espree = require(path.join(ROOTDIR, "client", "node_modules", "espree"));
  const es = require(path.join(ROOTDIR, "client", "node_modules", "eslint-scope"));
  const ast = espree.parse(read(f), { ecmaVersion: "latest", sourceType: "script", range: true });
  const sm = es.analyze(ast, { ecmaVersion: 2022, sourceType: "script", nodejsScope: true, childVisitorKeys: null });
  const parents = new Map();
  (function mark(n, p) { if (!n || typeof n.type !== "string") return; parents.set(n, p);
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(c => mark(c, n)); else if (v && typeof v.type === "string") mark(v, n); } })(ast, null);
  // the bind callbacks write every copy on purpose
  const inRegister = n => { for (let p = n; p; p = parents.get(p)) if (p.type === "CallExpression" && p.callee.type === "MemberExpression" && p.callee.object.name === "__boot" && p.callee.property.name === "register") return true; return false; };
  const shares = (stmt, name) => stmt && stmt.type === "ExpressionStatement" && stmt.expression.type === "CallExpression" && stmt.expression.callee.name === "__share"
    && stmt.expression.arguments[0] && stmt.expression.arguments[0].properties.some(p => p.key.name === name);
  let bad = 0;
  for (const v of sm.scopes[1].variables) for (const r of v.references) {
    if (!r.isWrite() || r.init || inRegister(r.identifier)) continue;
    let n = r.identifier;
    while (parents.get(n) && !["Program", "BlockStatement", "SwitchCase"].includes(parents.get(n).type)) n = parents.get(n);
    const list = parents.get(n); const body = list && (list.body || list.consequent);
    if (!shares(body && body[body.indexOf(n) + 1], v.name)) bad++;
  }
  return bad;
}

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
    what: "lines in server code (outside shared/numbers/) that sum an amount or window a gift's date",
    measure: files => Object.fromEntries(files.filter(isServerCode).map(f => [f, countLines(f, GIFT_SQL)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} gift-SQL lines (baseline ${base || 0}); call the service or figure source` : null,
  },
  "number-copies": {
    what: "a second rule for a donor label (major, top tenth, lapsed, first gift) outside shared/numbers/",
    measure: files => Object.fromEntries(files.filter(f => isAppCode(f) && !f.startsWith("shared/numbers/")).map(f => [f, countLines(f, NUMBER_COPY)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} line(s) with a donor label's own rule (baseline ${base || 0}); call shared/numbers/ (tags.js, lapse.js, firstGift.js)` : null,
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
  // CLOCK-1: the count reached zero, so it is a hard rule now.
  "real-clock": {
    what: "test files that read the real clock (Date.now(), new Date()) instead of setting their own (a hard rule)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(isTestFile).map(f => [f, countClock(f)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key}: ${now} real-clock read(s); read the run's clock through tests/clock.js (testNow, civilDay, dayOffset)`,
  },
  "org-specific": {
    what: "app code naming one org (an org id or slug in code; tests, scripts and fixtures excepted)",
    measure: files => Object.fromEntries(files.filter(isAppCode).map(f => [f, countLines(f, ORG_SPECIFIC)]).filter(([, n]) => n > 0)),
    worse: (key, now, base) => now > (base || 0) ? `${key}: ${now} lines naming one org (baseline ${base || 0}); make it a setting or data` : null,
  },
  // SPLIT-1: routes/crm.js only shrinks. Its routes moved to server/<domain>/,
  // and a new route goes in its domain's file (ARCHITECTURE.md "Routes").
  "crm-routes": {
    what: "routes registered in routes/crm.js (a hard rule: a new route goes in its domain's file under server/)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(f => f === "routes/crm.js").map(f => [f, countLines(f, CRM_ROUTE)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key} registers ${now} route(s); put each in server/<domain>/`,
  },
  // IDS-1: reached zero in the build that made it, so it is a hard rule.
  "short-ids": {
    what: "server code that builds an id from a cut-down UUID (a hard rule: use newId() from server/shared/newId.js)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(isServerCode).map(f => [f, countLines(f, SHORT_ID)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key}: ${now} id(s) cut from a UUID; use newId(prefix) from server/shared/newId.js (20 hex, never collides)`,
  },
  // STATUS-1: zero in the build that made it, so a hard rule.
  "rhythm-copies": {
    what: "a second rhythm (an expected next gift or an on-time test) outside shared/numbers/rhythm.js (a hard rule)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(f => isAppCode(f) && !f.startsWith("shared/numbers/")).map(f => [f, countLines(f, RHYTHM_COPY)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key}: ${now} line(s) working out a rhythm of its own; read rhythmFor from shared/numbers/rhythm.js`,
  },
  // SCORES-1: zero in the build that made it, so a hard rule.
  "score-deletes": {
    what: "app code that deletes donor_scores rows without naming the person (a hard rule: upsert, and delete only a person's own row)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(isAppCode).map(f => [f, countLines(f, SCORE_DELETE)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key}: ${now} org-wide delete(s) of donor_scores; upsert the changed rows (engagement.js writeScores) and delete only a person's own row by donor_id`,
  },
  "boot-shares": {
    what: "a write in server/boot/ to a name other modules read, with no __share({ name }) after it (a hard rule)",
    hard: true,
    measure: files => Object.fromEntries(files.filter(isBootModule).map(f => [f, unsharedWrites(f)]).filter(([, n]) => n > 0)),
    worse: (key, now) => `${key}: ${now} write(s) not followed by __share({ name }); every other module keeps the old value (see server/boot/share.js)`,
  },
  "split-shells": {
    what: "the files SPLIT-2 cut down to a shell (each capped at the size the split left it)",
    measure: files => Object.fromEntries(files.filter(f => SHELLS.has(f)).map(f => [f, lineCount(f)])),
    worse: (key, now, base) => base == null ? `${key} has no cap in the baseline`
      : now > base ? `${key} grew to ${now} lines (cap ${base}); put the new code in its parts` : null,
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
  if (MOVED && UPDATE && !c.hard && name !== "big-files" && name !== "split-shells" && base[MOVED]) {
    // what left the moved file is exactly what the new files hold, or nothing moves
    const left = base[MOVED] - (now[MOVED] || 0);
    const fresh = Object.keys(now).filter(k => !(k in base));
    const got = fresh.reduce((n, k) => n + now[k], 0);
    if (got !== left) { out.push(`  ✗ ${name}: ${left} line(s) left ${MOVED} but the new files hold ${got}; not moved`); failed++; continue; }
    base = { ...base };
    for (const k of fresh) base[k] = now[k];
    if (now[MOVED]) base[MOVED] = now[MOVED]; else delete base[MOVED];
    out.push(`  → ${name}: ${MOVED}'s ${left} line(s) moved to ${fresh.length} file(s)`);
  }
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
