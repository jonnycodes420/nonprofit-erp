#!/usr/bin/env node
// scripts/ops/restore-drill.js · SECURE-3 item 4. A RESTORE THAT HAS BEEN PROVEN.
//
// docs/security/restore-steps.md as one script. Jonathan runs it, with Muse,
// on a quiet weekend, against a NEW Supabase project restored from prod's
// backup. A builder runs it only against LOCAL databases (a pg_dump of a
// scratch database restored into a second scratch database).
//
//   node scripts/ops/restore-drill.js
//       DRY RUN (the default). Prints the plan and the dashboard clicks for
//       step (a), checks the target if one is set, connects to nothing.
//
//   RESTORE_DATABASE_URL='<the restored project's connection string>' \
//   node scripts/ops/restore-drill.js --run \
//       --project steward-restore-20261108-0300 --i-am-jonathan \
//       [--restore-time 2026-11-08T03:00:00Z] [--org <org id>]... [--port 5690]
//
// The legs, in order:
//   (a) the restore itself. NOT automated: the Management API's point-in-time
//       endpoint restores the SOURCE project in place, which is the one thing
//       this drill must never do. The script prints the dashboard clicks for
//       "Restore to a new project" and takes the new project's connection
//       string from RESTORE_DATABASE_URL (the environment only: never a file,
//       never an argument, never printed).
//   (b) read-only SQL checks, BEFORE anything boots (booting runs migrations
//       and the boot seeds against the copy): counts, the newest gift and audit
//       row against the restore time, and for each --org the independent truth
//       key's people, gifts and lifetime total (tests/keys/truthKey.js).
//   (c) a scratch backend booted against the copy with nothing that can send or
//       charge: a clean environment (not this shell's), dummy Resend and Stripe
//       pointed at closed local ports, no Anthropic key, DISABLE_BACKGROUND_TICKS=1,
//       TEST_MODE=1 and a fresh random JWT_SECRET, so no prod session works here.
//   (d) the smoke (/health, /ready, then each org's CSV export and custom
//       fields as its first admin) and the truth check (tests/lib/surfacesAgree.js
//       assertSurfacesAgree, every surface against the key computed from the
//       rows). It signs in by minting a token with the scratch JWT_SECRET for
//       the org's first admin: no customer's password is needed or used.
//   (e) counts only (no names, no emails, no amounts per person), then the
//       backend is stopped by its own PID.
//
// REFUSALS (exit 2, nothing connects):
//   · no --run: dry run only;
//   · a non-loopback target without --i-am-jonathan, or without --project
//     starting "steward-restore-";
//   · a non-loopback target that is not a Supabase host, or whose project ref
//     cannot be read from it;
//   · a target whose host or project ref matches PROD_DATABASE_URL (when set)
//     or PROD_SUPABASE_REF (when set), or whose ref hashes to the known prod
//     ref (PROD_REF_SHA256 below; the ref itself is not written in the repo);
//   · NODE_ENV=production, or a RAILWAY_* variable in the environment (this
//     is not something a deployed container runs);
//   · a .env file in the repo root (db.js loads it, and it could put a real
//     key into the scratch backend).
//
// The server's own log goes to a 0600 file in the system temp folder, whose
// path is printed; it is deleted at the end unless --keep-log.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PREFIX = "steward-restore-";
// sha256 of the production Supabase project ref (lower case). The ref is not a
// secret, but there is no reason to write it into the repo either.
const PROD_REF_SHA256 = "da80648d76b72984dbc015a79715cd981b26418f61a86eb9a39a7eff3d34c96d";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");

// ── the target: is it allowed? (pure; tests/script-guards.test.js drives it) ──
function parseTarget(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  let ref = null;
  const direct = host.match(/^db\.([a-z0-9]{15,40})\.supabase\.(co|com)$/);
  if (direct) ref = direct[1];
  else if (/\.pooler\.supabase\.(co|com)$/.test(host)) {
    const user = decodeURIComponent(u.username || "");
    const m = user.match(/^[a-z_]+\.([a-z0-9]{15,40})$/);
    if (m) ref = m[1];
  } else {
    const m = host.match(/^([a-z0-9]{15,40})\.supabase\.(co|com)$/);
    if (m) ref = m[1];
  }
  return { host, ref, loopback: LOOPBACK_HOSTS.has(host), supabase: /\.supabase\.(co|com)$/.test(host) };
}

// Returns a list of refusal sentences; empty means the target may be used.
function refusals({ env = process.env, argv = process.argv.slice(2), rootDir = ROOT } = {}) {
  const out = [];
  const arg = n => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : null; };
  const url = env.RESTORE_DATABASE_URL;
  if (env.NODE_ENV === "production") out.push("NODE_ENV is production. The drill runs on Jonathan's machine, never in a deployed container.");
  const rw = Object.keys(env).filter(k => /^RAILWAY_/.test(k));
  if (rw.length) out.push(`Railway variables are set (${rw.join(", ")}). Run the drill from a plain shell, never with railway run.`);
  if (fs.existsSync(path.join(rootDir, ".env"))) out.push("There is a .env file in the repo root. db.js loads it, and it could put a real key into the scratch backend. Move it away first.");
  if (!url) { out.push("RESTORE_DATABASE_URL is not set (the restored project's connection string, from the environment only)."); return out; }
  const t = parseTarget(url);
  if (!t) { out.push("RESTORE_DATABASE_URL is not a postgres:// connection string."); return out; }
  if (!t.loopback) {
    if (!argv.includes("--i-am-jonathan")) out.push("A non-local target needs --i-am-jonathan. Builders run this against local databases only.");
    const project = arg("project");
    if (!project || !project.startsWith(PREFIX)) out.push(`A non-local target needs --project naming the restored project, starting "${PREFIX}" (restore-steps.md step 1.3).`);
    if (!t.supabase) out.push("A non-local target must be a Supabase host (db.<ref>.supabase.co or <region>.pooler.supabase.com).");
    else if (!t.ref) out.push("Cannot read the Supabase project ref from the target, so cannot prove it is not prod.");
  }
  if (t.ref && sha256(t.ref) === PROD_REF_SHA256) out.push("The target is the PRODUCTION Supabase project. Restore into a NEW project and point the drill at that.");
  if (t.ref && env.PROD_SUPABASE_REF && t.ref === String(env.PROD_SUPABASE_REF).toLowerCase()) out.push("The target's project ref is PROD_SUPABASE_REF.");
  if (env.PROD_DATABASE_URL) {
    const p = parseTarget(env.PROD_DATABASE_URL);
    if (p && (p.host === t.host && !t.loopback || (p.ref && p.ref === t.ref))) out.push("The target matches PROD_DATABASE_URL.");
    if (p && t.loopback && p.host === t.host) {
      const a = new URL(url), b = new URL(env.PROD_DATABASE_URL);
      if (a.port === b.port && a.pathname === b.pathname) out.push("The target is the same database as PROD_DATABASE_URL.");
    }
  }
  return out;
}

// ── printing: never a connection string, never a secret ────────────────────
function scrubber(env) {
  const secrets = [];
  for (const k of ["RESTORE_DATABASE_URL", "PROD_DATABASE_URL"]) {
    if (!env[k]) continue;
    secrets.push(env[k]);
    try { const u = new URL(env[k]); if (u.password) { secrets.push(u.password, decodeURIComponent(u.password)); } } catch { /* not a URL */ }
  }
  return s => { let o = String(s); for (const x of secrets.filter(Boolean)) o = o.split(x).join("<redacted>"); return o.replace(/postgres(ql)?:\/\/[^\s'"]+/g, "postgres://<redacted>"); };
}

const DASHBOARD_STEPS = `
(a) The restore (Jonathan, in the Supabase dashboard; the script does not do this):
    1. The production project -> Database -> Backups -> Point in Time.
       (No Point in Time tab means PITR is off for the plan: use Scheduled
       backups and pick the nearest daily backup instead.)
    2. Choose "Restore to a new project", NOT "Restore". Pick the time (UTC).
    3. Name it ${PREFIX}YYYYMMDD-HHMM, same region as prod. Start it.
    4. When it is ready: the NEW project -> Connect (or Settings -> Database)
       -> copy its connection string. Keep it in the password manager.
    5. In this shell only:  read -s RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL
       (read -s keeps it out of the shell history and off the screen.)
`;

function plan(argv) {
  const arg = n => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : null; };
  return `restore drill (SECURE-3) · ${argv.includes("--run") ? "RUN" : "DRY RUN: nothing connects"}
${DASHBOARD_STEPS}
(b) read-only SQL on the copy, before anything boots
(c) a scratch backend on :${arg("port") || 5690}, clean env, dummy Resend/Stripe, no Anthropic key, ticks off
(d) the smoke and the truth check, per org${arg("org") ? " (--org given)" : " (every org with an admin)"}
(e) counts only; the backend is stopped by its own PID
`;
}

// ── (b) read-only SQL ───────────────────────────────────────────────────────
async function readOnlyChecks(url, { orgs, restoreTime, ssl, say }) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  const facts = {};
  try {
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await c.query("BEGIN READ ONLY");
    const one = async (label, sql, params) => {
      try { const r = await c.query(sql, params); facts[label] = r.rows[0] ? Object.values(r.rows[0])[0] : null; }
      catch (e) { facts[label] = `unreadable (${e.code || e.message})`; await c.query("ROLLBACK"); await c.query("BEGIN READ ONLY"); }
    };
    await one("orgs", "SELECT COUNT(*)::int FROM orgs");
    await one("users", "SELECT COUNT(*)::int FROM users");
    await one("donors", "SELECT COUNT(*)::int FROM donors");
    await one("gifts", "SELECT COUNT(*)::int FROM gifts");
    await one("newestGift", "SELECT MAX(created_at) FROM gifts");
    await one("newestAudit", "SELECT MAX(created_at) FROM fin_audit_log");
    for (const k of Object.keys(facts)) say(`    ${k.padEnd(12)} ${facts[k] instanceof Date ? facts[k].toISOString() : facts[k]}`);
    if (restoreTime) {
      const t = new Date(restoreTime);
      for (const k of ["newestGift", "newestAudit"]) {
        if (!(facts[k] instanceof Date)) continue;
        const after = facts[k] > t;
        const hrs = ((t - facts[k]) / 3600000).toFixed(1);
        say(`    ${k} is ${after ? "AFTER the restore time: this is not the copy you asked for" : hrs + " h before the restore time"}`);
        if (after) facts.problem = (facts.problem || []).concat(`${k} after the restore time`);
      }
    }
    // The independent key per org, from the rows (TRUTH-1), through this
    // read-only connection.
    // The key's reads run in parallel, so they get a small pool of their own,
    // every connection read-only.
    const { Pool } = require("pg");
    const kp = new Pool({ connectionString: url, ssl, max: 4, options: "-c default_transaction_read_only=on" });
    const q = (sql, params) => kp.query(sql, params).then(r => r.rows);
    const { computeKey } = require(path.join(ROOT, "tests", "keys", "truthKey"));
    const { orgRows } = require(path.join(ROOT, "tests", "keys", "fromDb"));
    facts.keys = {};
    for (const id of orgs) {
      try {
        const r = await orgRows(q, id);
        const k = computeKey(r.rows, r.opts);
        facts.keys[id] = { people: k.people, gifts: k.gifts.count, cents: k.gifts.cents };
        say(`    org ${id}: ${k.people} people, ${k.gifts.count} gifts, lifetime $${(k.gifts.cents / 100).toFixed(2)} (compare with what they last saw)`);
      } catch (e) { say(`    org ${id}: key not computed (${e.code || "error"})`); facts.keys[id] = null; }
    }
    await kp.end();
    await c.query("ROLLBACK");
  } finally { await c.end(); }
  return facts;
}

async function orgsWithAdmin(url, ssl) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  try {
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return (await c.query(
      `SELECT DISTINCT ON (u.org_id) u.org_id, u.id AS user_id, u.email
         FROM users u JOIN orgs o ON o.id = u.org_id
        WHERE u.role = 'admin' AND u.deactivated_at IS NULL
        ORDER BY u.org_id, u.created_at ASC NULLS LAST, u.id`)).rows;
  } finally { await c.end(); }
}

// ── (c) the scratch backend ─────────────────────────────────────────────────
// A CLEAN environment: this shell's variables never reach it, so no real
// Resend, Stripe or Anthropic key can. The keys db.js's dotenv could fill are
// set to empty (dotenv never overrides a variable that is set).
function backendEnv(url, port, jwtSecret, dbSsl) {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), LANG: "en_US.UTF-8",
    DATABASE_URL: url, JWT_SECRET: jwtSecret, PORT: String(port),
    DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0",
    RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: `http://127.0.0.1:${port + 1}`,
    STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_API_BASE: `http://127.0.0.1:${port + 2}`,
    STRIPE_BILLING_SECRET_KEY: "sk_test_dummy", STRIPE_BILLING_API_BASE: `http://127.0.0.1:${port + 3}`,
    STRIPE_WEBHOOK_SECRET: "whsec_restore_drill_dummy",
    STEWARD_CREDENTIAL_KEY: "restore-drill-throwaway-" + crypto.randomBytes(16).toString("hex"),
    ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", SENTRY_DSN: "", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "",
    PORTAL_ASSETS_S3_ENDPOINT: "", PORTAL_ASSETS_S3_KEY: "", PORTAL_ASSETS_S3_SECRET: "", PORTAL_ASSETS_S3_BUCKET: "",
    INBOUND_EMAIL_ENABLED: "", RESEND_WEBHOOK_SECRET: "",
  };
  if (dbSsl === "disable") env.DB_SSL = "disable";
  return env;
}

async function waitReady(base, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(base + "/ready"); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function stop(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve("already stopped");
    const pid = child.pid;
    const hard = setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }, 10000);
    child.once("exit", () => { clearTimeout(hard); resolve(`stopped (pid ${pid})`); });
    try { process.kill(pid, "SIGTERM"); } catch { clearTimeout(hard); resolve("already stopped"); }
  });
}

// ── (d) smoke and truth ─────────────────────────────────────────────────────
async function smokeAndTruth({ base, url, ssl, jwtSecret, admins, say, showDiffs }) {
  const jwt = require("jsonwebtoken");
  const out = { health: false, ready: false, orgs: [] };
  const h = await fetch(base + "/health").then(r => r.json()).catch(() => null);
  out.health = !!(h && (h.ok === true || h.status === "ok"));
  out.ready = await fetch(base + "/ready").then(r => r.ok).catch(() => false);
  say(`    /health ${out.health ? "ok" : "NOT ok"} · /ready ${out.ready ? "ok" : "NOT ok"}`);

  // The truth check's helpers refuse a non-loopback DATABASE_URL at load and
  // would read the scratch default. Its database reads come through ctx.q
  // (this read-only connection to the copy), so helpers' own handle points at
  // a closed loopback port and can reach nothing.
  process.env.BASE = base;
  process.env.DATABASE_URL = "postgresql://restore-drill-unused@127.0.0.1:1/never";
  const { assertSurfacesAgree } = require(path.join(ROOT, "tests", "lib", "surfacesAgree"));
  const { Pool } = require("pg");
  // Not read-only: the truth check tidies the Atlas rows its own questions
  // made (surfacesAgree.js). This is the scratch copy, after the boot has
  // already run its migrations on it; leg (b) was the read-only one.
  const pool = new Pool({ connectionString: url, ssl, max: 4 });
  const q = (sql, params) => pool.query(sql, params).then(r => r.rows);
  try {
    for (const a of admins) {
      const token = jwt.sign({ userId: a.user_id, orgId: a.org_id, email: a.email, role: "admin", isSuperAdmin: false }, jwtSecret, { expiresIn: "1h" });
      const auth = { headers: { Authorization: "Bearer " + token } };
      const ex = await fetch(base + "/donors/export/csv", auth);
      const csv = ex.ok ? await ex.text() : "";
      const cf = await fetch(base + "/custom-fields?entity=donor", auth);
      const smoke = ex.ok && /^﻿?Name,/.test(csv) && cf.ok;
      let truth = null;
      try {
        const r = await assertSurfacesAgree(a.org_id, { token, q, soft: true, label: "restore drill" });
        truth = { ok: r.ok, diffs: r.diffs.length, known: (r.known || []).length, ms: r.ms, lines: r.diffs };
      } catch (e) { truth = { ok: false, diffs: -1, error: e.message }; }
      const rows = Math.max(0, csv.split("\n").filter(Boolean).length - 1);
      say(`    org ${a.org_id}: smoke ${smoke ? "ok" : `FAIL (export ${ex.status}, custom-fields ${cf.status})`} (${rows} people in the export) · truth ${truth.ok ? "agrees" : truth.diffs < 0 ? `did not run (${String(truth.error).slice(0, 200)})` : `${truth.diffs} disagreement(s)`}${truth.known ? `, ${truth.known} known` : ""}`);
      if (showDiffs && truth.lines && truth.lines.length) for (const l of truth.lines) say("        " + l);
      out.orgs.push({ org: a.org_id, smoke, truthOk: truth.ok, diffs: truth.diffs, peopleInExport: rows });
    }
  } finally { await pool.end(); }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const scrub = scrubber(process.env);
  const say = (s = "") => console.log(scrub(s));
  const arg = n => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : null; };
  const args = n => argv.flatMap((a, i) => a === "--" + n && argv[i + 1] ? [argv[i + 1]] : []);
  say(plan(argv));

  const refused = refusals({ argv });
  const url = process.env.RESTORE_DATABASE_URL;
  if (url && !refused.length) {
    const t = parseTarget(url);
    say(`target: ${t.loopback ? "a local database (builder rehearsal)" : `Supabase project ref ${t.ref}, named ${arg("project")}`}`);
  }
  if (refused.length) {
    for (const r of refused) say("REFUSED: " + r);
    if (!argv.includes("--run")) say("\n(dry run) set RESTORE_DATABASE_URL and the flags above, then add --run.");
    process.exit(argv.includes("--run") || url ? 2 : 0);
  }
  if (!argv.includes("--run")) { say("(dry run) the target passes every refusal. Add --run to do (b) to (e)."); return; }

  const t = parseTarget(url);
  const ssl = t.loopback && process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false };
  const port = Number(arg("port")) || 5690;
  const base = `http://127.0.0.1:${port}`;
  const summary = { problems: [] };

  // the orgs to check: --org ids, or every org with an admin
  const admins = (await orgsWithAdmin(url, ssl)).filter(a => !args("org").length || args("org").includes(a.org_id));
  say(`\n(b) read-only checks (${admins.length} org(s) with an admin)`);
  const facts = await readOnlyChecks(url, { orgs: admins.map(a => a.org_id), restoreTime: arg("restore-time"), ssl, say });
  if (facts.problem) summary.problems.push(...facts.problem);

  say(`\n(c) scratch backend on :${port}`);
  const logPath = path.join(os.tmpdir(), `steward-restore-drill-${process.pid}.log`);
  const logFd = fs.openSync(logPath, "w", 0o600);
  const jwtSecret = crypto.randomBytes(48).toString("base64");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env: backendEnv(url, port, jwtSecret, t.loopback ? process.env.DB_SSL : undefined), stdio: ["ignore", logFd, logFd],
  });
  say(`    started pid ${child.pid}; its log: ${logPath}`);
  let result = null;
  try {
    const up = await waitReady(base, Number(arg("boot-timeout")) * 1000 || 600000);
    if (!up) { summary.problems.push("the backend never answered /ready"); say(`    NOT ready (exit code ${child.exitCode}); read the log above`); }
    else {
      say("    ready");
      say("\n(d) smoke and truth check");
      result = await smokeAndTruth({ base, url, ssl, jwtSecret, admins, say: s => say(s), showDiffs: argv.includes("--show-diffs") });
      if (!result.health || !result.ready) summary.problems.push("/health or /ready not ok");
      for (const o of result.orgs) {
        if (!o.smoke) summary.problems.push(`org ${o.org}: smoke failed`);
        if (!o.truthOk) summary.problems.push(`org ${o.org}: truth check ${o.diffs < 0 ? "did not run" : o.diffs + " disagreement(s)"}`);
      }
    }
  } finally {
    say("\n(e) " + await stop(child));
    fs.closeSync(logFd);
    if (!argv.includes("--keep-log")) { fs.rmSync(logPath, { force: true }); say("    log deleted (--keep-log keeps it)"); }
  }

  say(`\nresult: ${summary.problems.length ? "PROBLEMS" : "the copy boots, the smoke passes and every surface agrees with its rows"}`);
  for (const p of summary.problems) say("  · " + p);
  say(`counts: orgs ${facts.orgs}, users ${facts.users}, people ${facts.donors}, gifts ${facts.gifts}, orgs checked ${admins.length}`);
  if (!t.loopback) say(`\nWrite the date and these counts under "Last practised" in docs/security/restore-steps.md, then delete ${arg("project")} the same day.`);
  process.exitCode = summary.problems.length ? 1 : 0;
}

if (require.main === module) {
  main().catch(e => { console.error(scrubber(process.env)("restore drill failed: " + (e && e.stack || e))); process.exit(1); });
}

module.exports = { parseTarget, refusals, scrubber, backendEnv, PREFIX, PROD_REF_SHA256 };
