// BUILD-92 A1 — THE DEMO SEED, ON A GENUINELY FRESH DATABASE.
//
// WHAT WAS WRONG (found 20 Sept, reproduced here before it was fixed):
// db.js seeded budgets with `ON CONFLICT (org_id, account_id, year)`. The
// CREATE TABLE does declare `UNIQUE (org_id, account_id, year)` — but a later
// migration step in the SAME file (BUILD-88a, "A BUDGET HAS A FUND") DROPS
// that constraint and replaces it with a unique index on
// (org_id, account_id, year, COALESCE(fund_id, '')). Reading the CREATE TABLE
// therefore tells you the opposite of what the database actually has.
//
// Postgres answers a conflict target that matches no surviving index with
// 42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
// specification". seedData is ONE un-chunked async function, so that throw
// aborted EVERY REMAINING SEED STEP on every boot — the demo org came up with
// no program grants, no impact metrics, no donors, no gifts, no grants, no
// interactions, no milestone drafts, no note reminders, no fundraising goals
// and no metric snapshots. getDb() catches it and logs "[seed] CRITICAL" and
// boots anyway, which is why a broken demo looked like a healthy server.
//
// THREE SECTIONS:
//   §1  CLASS GUARD — every ON CONFLICT target written in db.js and server.js
//       is resolved against the unique indexes that ACTUALLY EXIST on a live
//       database. An orphaned target is a failure. This is the guard that
//       generalises the bug: the next migration that moves a uniqueness
//       constraint out from under an upsert fails here, not in production.
//   §2  The guard PROVEN ABLE TO FAIL (CLAUDE.md: a guard never seen failing
//       is not known to guard) — the exact pre-fix pair is fed to the same
//       resolver and must come back ORPHANED.
//   §3  BEHAVIOUR — a brand-new database, booted TWICE. The seed must succeed
//       both times, log zero errors both times, leave the demo org's content
//       actually present, and the second boot must change NOTHING (row counts
//       and a content hash compared across the two boots).
//
// §3 creates and drops its own throwaway database, and spawns its own server
// on a free port. It never touches the battery's database or server.

const { spawn } = require("child_process");
const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ok, summary, q, closeDb } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const ROOT = path.join(__dirname, "..");
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const SSL = process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false };

// ════════════════════════════════════════════════════════════════════════════
// The resolver, shared by §1 and §2.
// ════════════════════════════════════════════════════════════════════════════

// A conflict target is a comma-separated list of columns or expressions.
// Postgres matches it as a SET, not a sequence, so normalise and sort.
// `''::text` in an index definition and `''` in hand-written SQL are the same
// expression; so are `"year"` and `year`.
function normalizeTarget(raw) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map(p => p
      .toLowerCase()
      .replace(/::[a-z_ ]+/g, "")   // ::text, ::character varying
      .replace(/"/g, "")
      .replace(/\s+/g, "")
      .replace(/\s*(asc|desc)$/, ""))
    .filter(Boolean)
    .sort()
    .join(",");
}

// Every UNIQUE index on a table, as normalised key sets. Reads
// pg_get_indexdef, i.e. what the database really has right now — not what any
// CREATE TABLE in the source says.
async function uniqueKeySets(table) {
  const rows = await q(
    `SELECT pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND n.nspname = 'public' AND i.indisunique`,
    [table]);
  return rows.map(r => {
    // "CREATE UNIQUE INDEX x ON public.t USING btree (a, coalesce(b, ''::text)) WHERE …"
    const m = r.def.match(/USING\s+\w+\s+\((.*?)\)(?:\s+WHERE|$)/is);
    return m ? normalizeTarget(m[1]) : null;
  }).filter(Boolean);
}

// Returns "ok" | "orphaned" | "no-such-table".
async function resolveTarget(table, target) {
  const exists = await q(`SELECT to_regclass('public.' || $1) IS NOT NULL AS e`, [table]);
  if (!exists[0]?.e) return "no-such-table";
  const want = normalizeTarget(target);
  const have = await uniqueKeySets(table);
  return have.includes(want) ? "ok" : "orphaned";
}

// Read a parenthesised target starting at the "(" — balanced, because a target
// may contain COALESCE(fund_id, ''). A regex cannot do this and the first
// version of this scanner silently truncated the one target that mattered.
function readParens(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return { body: src.slice(openIdx + 1, i), end: i }; }
  }
  return null;
}

// Pull every (table, conflict-target) pair out of a source file. SQL lives in
// template literals, so this is a text scan.
//
// ATTRIBUTION: an ON CONFLICT clause is usually inside the same template
// literal as its `INSERT INTO <table>`, but several call sites build the
// clause into a `const conflict = …` FIRST and interpolate it into the insert
// below (recordGift's three conflict keys, thank_you_drafts' replace/ignore
// pair). So each clause carries TWO candidate tables — the nearest insert
// before it and the nearest insert after it — and passes if the target
// resolves against either. That is still enough to catch the bug this guard
// exists for: at db.js's budgets statement the neighbours are `budgets` and
// `program_grants`, and the orphaned three-column target resolves against
// neither.
function scanConflictTargets(file) {
  const src = readSource(path.join(ROOT, file));
  const inserts = [...src.matchAll(/INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi)]
    .map(m => ({ idx: m.index, table: m[1].toLowerCase() }));
  const out = [];
  for (const m of src.matchAll(/ON\s+CONFLICT\s*\(/gi)) {
    const openIdx = m.index + m[0].length - 1;
    // Skip anything on a comment line — comments quote old SQL.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, m.index))) continue;
    const p = readParens(src, openIdx);
    if (!p) continue;
    let before = null, after = null;
    for (const ins of inserts) { if (ins.idx < m.index) before = ins; else { after = ins; break; } }
    out.push({
      file,
      tables: [...new Set([before?.table, after?.table].filter(Boolean))],
      target: p.body,
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// §3 helpers — a throwaway database and a throwaway server.
// ════════════════════════════════════════════════════════════════════════════

function dbUrlFor(name) {
  const u = new URL(DB_URL);   // keeps user, password, host and port
  u.pathname = "/" + name;
  return u.toString();
}
const FRESH_DB = "steward_92a_seedspec";

async function adminExec(sql) {
  const pool = new Pool({ connectionString: dbUrlFor("postgres"), ssl: SSL });
  try { await pool.query(sql); } finally { await pool.end(); }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Boot a server against `dbName`, wait for /health, return the captured
// stdout+stderr. Kills the child before returning.
async function bootOnce(dbName, label) {
  const port = await freePort();
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: dbUrlFor(dbName),
      DB_SSL: process.env.DB_SSL || "",
      JWT_SECRET: "local-test-secret", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0",
      DISABLE_BACKGROUND_TICKS: "1",
      RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:1",
      DEMO_SMTP_FROM: "noreply@stewardapp.dev",
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_localtest",
      STRIPE_API_BASE: "http://localhost:1",
      STEWARD_CREDENTIAL_KEY: "local-scratch-credential-key-0123456789",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", d => { log += d.toString(); });
  child.stderr.on("data", d => { log += d.toString(); });

  let up = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const h = await fetch(`http://localhost:${port}/health`); if (h.ok) { up = true; break; } } catch { }
    if (child.exitCode !== null) break;
  }
  // The seed runs on the first getDb(), which /health already forces. Give the
  // remaining boot logging a moment to flush before reading it.
  await new Promise(r => setTimeout(r, 1500));
  child.kill("SIGKILL");
  await new Promise(r => setTimeout(r, 400));
  return { up, log, port, label };
}

// The demo org's whole content, as counts plus a hash. Anything the second
// boot changes shows up in one of the two.
const SEEDED_TABLES = [
  // before the failing statement
  "orgs", "users", "accounts", "fin_funds", "programs", "grants", "campaigns",
  // the failing statement itself
  "budgets",
  // …and everything downstream of it, which never ran
  "program_grants", "impact_metrics", "donors", "gifts", "interactions",
  "milestone_drafts", "note_reminders", "fundraising_goals", "metric_snapshots",
];

async function snapshot(dbName) {
  const pool = new Pool({ connectionString: dbUrlFor(dbName), ssl: SSL });
  try {
    const counts = {};
    const h = crypto.createHash("sha256");
    for (const t of SEEDED_TABLES) {
      const exists = await pool.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS e`, [t]);
      if (!exists.rows[0].e) { counts[t] = null; continue; }
      const hasOrg = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='org_id'`, [t]);
      const where = t === "orgs" ? `WHERE id='org_creo'` : (hasOrg.rows.length ? `WHERE org_id='org_creo'` : "");
      const c = await pool.query(`SELECT COUNT(*)::int n FROM ${t} ${where}`);
      counts[t] = c.rows[0].n;
      // Content, not just cardinality: the id list, ordered, hashed.
      const ids = await pool.query(`SELECT id FROM ${t} ${where} ORDER BY id`);
      h.update(t + ":" + ids.rows.map(r => r.id).join(",") + "\n");
    }
    const vocab = await pool.query(`SELECT vocabulary_json FROM orgs WHERE id='org_creo'`);
    return { counts, hash: h.digest("hex"), vocabulary: vocab.rows[0]?.vocabulary_json || null };
  } finally { await pool.end(); }
}

// Boot noise that is expected on a scratch box with no mail/Stripe/S3 and is
// NOT a seed failure. Anything outside this set counts as an error.
const BENIGN = [
  /RESEND_DOMAIN_VERIFIED not set/,
  /FRONTEND_URL is unset/,
  /injected env/,
  /background ticks DISABLED/,
  /\[billing\]/,
  /ECONNREFUSED|fetch failed|ENOTFOUND/,   // the unbound mock ports above
];
function realErrors(log) {
  return log.split("\n").filter(l =>
    /CRITICAL|there is no unique or exclusion constraint|^error:|42P10|42P01|Unhandled|UnhandledPromiseRejection/.test(l)
    && !BENIGN.some(re => re.test(l)));
}

// ════════════════════════════════════════════════════════════════════════════

(async () => {
  console.log("BUILD-92 A1 — the demo seed\n");

  // ── §1 · every ON CONFLICT target resolves against a real unique index ────
  console.log("— §1 · no orphaned ON CONFLICT target —");
  const pairs = [...scanConflictTargets("db.js"), ...scanConflictTargets("server.js")];
  ok(`scanner found conflict targets to check (${pairs.length})`, pairs.length >= 40, pairs.length);

  const orphaned = [], missing = [];
  for (const p of pairs) {
    const verdicts = [];
    for (const t of p.tables) verdicts.push(await resolveTarget(t, p.target));
    if (verdicts.includes("ok")) continue;
    if (verdicts.every(v => v === "no-such-table")) missing.push(`${p.file}:${p.line} ${p.tables.join("|")}`);
    else orphaned.push(`${p.file}:${p.line} ${p.tables.join("|")} (${p.target.trim().replace(/\s+/g, " ")})`);
  }
  ok("every ON CONFLICT target matches a unique index that actually exists", orphaned.length === 0, orphaned);
  // A table the scanner cannot see is a scanner problem, not a schema problem —
  // reported separately so the two axes never get summed (CLAUDE.md guard rule).
  ok("every insert's table exists on a live database", missing.length === 0, missing);

  // ── §2 · the guard proven able to fail ────────────────────────────────────
  console.log("\n— §2 · the guard, proven able to fail —");
  // This is the EXACT pair db.js carried before BUILD-92 A1. If the resolver
  // calls this "ok" it is not measuring anything and §1 is ceremony.
  const preFix = await resolveTarget("budgets", "org_id, account_id, year");
  ok("the pre-fix budgets target is reported ORPHANED by the same resolver", preFix === "orphaned", preFix);
  const postFix = await resolveTarget("budgets", "org_id, account_id, year, COALESCE(fund_id, '')");
  ok("the fixed budgets target resolves", postFix === "ok", postFix);
  // And the resolver is not simply calling everything orphaned.
  ok("a plain primary-key target resolves", (await resolveTarget("orgs", "id")) === "ok");
  ok("a target naming a column that is not unique is orphaned", (await resolveTarget("gifts", "amount")) === "orphaned");

  // ── §3 · a fresh database, booted twice ───────────────────────────────────
  console.log("\n— §3 · fresh database, two boots, nothing changes on the second —");
  await adminExec(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
  await adminExec(`CREATE DATABASE ${FRESH_DB}`);
  try {
    const b1 = await bootOnce(FRESH_DB, "first");
    ok("boot 1: the server comes up on a brand-new database", b1.up, b1.log.slice(-600));
    const e1 = realErrors(b1.log);
    ok("boot 1: ZERO errors logged (no [seed] CRITICAL, no 42P10)", e1.length === 0, e1.slice(0, 4));

    const s1 = await snapshot(FRESH_DB);

    // The whole point: the rows DOWNSTREAM of the budgets statement exist.
    ok("boot 1: the demo org has its donors", s1.counts.donors > 0, s1.counts.donors);
    ok("boot 1: the demo org has its gifts", s1.counts.gifts > 0, s1.counts.gifts);
    ok("boot 1: budgets seeded (the statement that used to throw)", s1.counts.budgets > 0, s1.counts.budgets);
    ok("boot 1: program_grants seeded (the FIRST casualty downstream)", s1.counts.program_grants > 0, s1.counts.program_grants);
    ok("boot 1: interactions seeded", s1.counts.interactions > 0, s1.counts.interactions);
    ok("boot 1: milestone_drafts seeded", s1.counts.milestone_drafts > 0, s1.counts.milestone_drafts);
    ok("boot 1: note_reminders seeded (BUILD-86 C.2's twenty notes)", s1.counts.note_reminders > 0, s1.counts.note_reminders);
    ok("boot 1: fundraising_goals seeded", s1.counts.fundraising_goals > 0, s1.counts.fundraising_goals);
    ok("boot 1: metric_snapshots seeded (the LAST step in seedData)", s1.counts.metric_snapshots > 0, s1.counts.metric_snapshots);

    // BUILD-86 Part B — the demo org's own words, not the generic defaults.
    const v = s1.vocabulary ? JSON.parse(s1.vocabulary) : null;
    ok("boot 1: the demo org carries Heart of Africa's vocabulary", !!v && v.giver_plural === "sponsors" && v.fund_plural === "designations", v);
    ok("boot 1: …including the season BUILD-86 named", !!v && v.season_name === "Spring Campaign", v && v.season_name);

    // ── the second boot changes nothing ──────────────────────────────────────
    const b2 = await bootOnce(FRESH_DB, "second");
    ok("boot 2: the server comes up again on the same database", b2.up, b2.log.slice(-600));
    const e2 = realErrors(b2.log);
    ok("boot 2: ZERO errors logged", e2.length === 0, e2.slice(0, 4));

    const s2 = await snapshot(FRESH_DB);
    const changed = Object.keys(s1.counts).filter(t => s1.counts[t] !== s2.counts[t])
      .map(t => `${t}: ${s1.counts[t]} → ${s2.counts[t]}`);
    ok("boot 2: every seeded table has the SAME row count", changed.length === 0, changed);
    ok("boot 2: the content hash is identical — the seed is idempotent", s1.hash === s2.hash,
      { first: s1.hash.slice(0, 16), second: s2.hash.slice(0, 16) });
    ok("boot 2: the vocabulary is not rewritten", s1.vocabulary === s2.vocabulary);
  } finally {
    await adminExec(`DROP DATABASE IF EXISTS ${FRESH_DB}`).catch(() => { });
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
