#!/usr/bin/env node
// STAGE-1 · REBUILD STAGING'S DATA. ONE COMMAND, THE SAME RESULT EVERY TIME.
//
// Staging never holds customer data. It holds three orgs of made-up people:
//   org_b72demo        the Harborlight demo, by scripts/ci/seed-demo.js (the one
//                      writer of that org). Muse walks it; its baselines are the
//                      seed's own (SHAPE and DRIFTED in seed-demo.js).
//   org_stagewalk      "Staging walk": twelve made-up people with a gift each,
//                      and the walk account (scripts/ci/staging-walk.js writes here
//                      after every merge, so Muse's org stays still)
//   org_stagefixtures  "Real-shaped fixtures": the scrubbed real-shaped files
//                      (tests/fixtures/import/real-shaped/, every name made up)
//                      imported the way a person imports them
// Each org is torn down and rebuilt, so a second run gives the same rows.
// (org_creo, the boot-seed fixture, is made by every fresh database's boot.)
//
// Then THE SCAN: no person in any of them may carry a real name. A name is real
// when it is the founder's, on the mail block, a staff user's (demoRealPeople.js),
// a person in org_creo, a customer org's name (STAGING_REAL_NAMES, a comma list
// you may pass in the environment and never commit), or when any org other than
// these four exists on staging at all. A hit fails the run and names what it found.
//
// SAFETY: it writes only where /health says env "staging" (prodGuard --staging),
// and refuses prod by construction: prod's /health says "production".
//
// Run it (no secret is copied anywhere; Railway injects the variables):
//   railway run --environment staging --service web -- node scripts/ops/staging-seed.js --staging
// Locally, against a scratch server booted with STEWARD_ENV=staging:
//   BASE=http://localhost:5601 DATABASE_URL=… STAGING_WALK_PASSWORD=… node scripts/ops/staging-seed.js --staging
"use strict";
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const guard = require("../lib/prodGuard");
const { findRealPeople } = require("../lib/demoRealPeople");

const ROOT = path.join(__dirname, "..", "..");
const DEMO = "org_b72demo", WALK = "org_stagewalk", FIX = "org_stagefixtures", CREO = "org_creo";
// seed-demo.js also makes two small demo orgs of made-up people (onboarding and privacy mode).
const KNOWN_ORGS = new Set([DEMO, WALK, FIX, CREO, "org_riverbend_demo", "org_meadowbrook_demo"]);
const WALK_EMAIL = "walker@walk.staging.invalid";
const FIX_EMAIL = "fixtures@walk.staging.invalid";
const FX = path.join(ROOT, "tests", "fixtures", "import", "real-shaped");
const FIXTURE_FILES = ["jp-gift-history-287.xlsx", "jp-dinner-gifts-106.xlsx", "jp-contacts-656.xlsx"];
// The dinner file asks which event it was; the answers tests/real-shaped.test.js gives.
const FIXTURE_ANSWERS = { "jp-dinner-gifts-106.xlsx": { eventName: "Finding Joy Dinner", eventDate: "2026-10-22", useEventDate: false, pledgeDue: "event" } };
// Twelve made-up people for the walk org. Invented here; .invalid never delivers.
const WALK_PEOPLE = ["Marisol Vantreese", "Odell Brightwater", "Pernille Ashcombe", "Tobiah Quenneville", "Wrenna Halloway", "Caspian Delacroix-Moor",
  "Ines Fairweather", "Laszlo Underhill", "Philippa Rookwood", "Desmond Okonkwo-Lisle", "Hester Vanderpool", "Rufus Tallgrass"];

const norm = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();

// org_creo on a fresh database is the boot seed's fiction (server/db/seed.js): "Margaret
// Chen" is in it on purpose, and in the demo too, as the landing page's example. So a
// name the boot seed itself writes is fiction. An org_creo person the boot seed did NOT
// write is real CREO data that reached staging: it is a hit, and so is anyone with its name.
function bootSeedFiction() {
  const src = fs.readFileSync(path.join(ROOT, "server", "db", "seed.js"), "utf8");
  return new Set([...src.matchAll(/"([^"\n]{1,80})"/g)].map(m => norm(m[1])));
}

// The scan, pure so the test can hold it: every staging person against the real lists.
function scanNames(people, { creoNames = [], customerNames = [], strayOrgs = [], fiction = new Set() } = {}) {
  const realCreo = creoNames.filter(n => norm(n).includes(" ") && !fiction.has(norm(n)));
  const creo = new Set(realCreo.map(norm));
  const cust = customerNames.map(norm).filter(Boolean);
  const hits = realCreo.map(name => ({ org_id: CREO, name, reason: "a person in org_creo the boot seed did not write (real CREO data on staging)" }));
  for (const p of people) {
    const n = norm(p.name);
    if (!n) continue;
    if (creo.has(n)) hits.push({ ...p, reason: "the same name as a person in org_creo" });
    else if (cust.some(c => n === c || (c.length > 5 && n.includes(c)))) hits.push({ ...p, reason: "a customer org's name" });
  }
  for (const o of strayOrgs) hits.push({ org: o.id, name: o.name, reason: "an org staging should not have (only the demo, walk, fixtures and org_creo belong)" });
  return hits;
}

async function main() {
  const argv = process.argv;
  if (!argv.includes(guard.STAGING_FLAG)) { console.error(`REFUSED: pass ${guard.STAGING_FLAG}. This script writes, and only to staging.`); process.exit(1); }
  const env = process.env;
  if (!env.BASE && env.RAILWAY_PUBLIC_DOMAIN) env.BASE = `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  const DB = env.DATABASE_PUBLIC_URL || env.DATABASE_URL;
  const PASSWORD = env.STAGING_WALK_PASSWORD || "";
  if (!DB) { console.error("REFUSED: DATABASE_URL (or DATABASE_PUBLIC_URL) is not set."); process.exit(1); }
  if (PASSWORD.length < 12) { console.error("REFUSED: STAGING_WALK_PASSWORD must be set (12 characters or more) on staging's web service."); process.exit(1); }

  const BASE = guard.writerBase("http://localhost:5601");
  const health = guard.assertServerIdentity(BASE);
  if (health.env !== "staging") { console.error(`REFUSED: ${BASE}/health says env "${health.env}". Only staging is rebuilt.`); process.exit(1); }
  const client = new Client({ connectionString: DB, ssl: /localhost|127\.0\.0\.1/.test(DB) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const q = (sql, p = []) => client.query(sql, p).then(r => r.rows);
  const [{ current_database: dbName }] = await q("SELECT current_database()");
  if (dbName !== health.database) { console.error(`REFUSED: ${BASE} serves database "${health.database}" but this connection is to "${dbName}".`); process.exit(1); }
  console.log(`[staging] ${BASE} is staging, database "${dbName}". Rebuilding.\n`);

  // 1. the demo, by its one writer
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "ci", "seed-demo.js"), guard.STAGING_FLAG],
    { stdio: "inherit", env: { ...env, BASE, DATABASE_URL: DB } });
  if (r.status !== 0) { console.error("[staging] the demo seed failed; stopping."); process.exit(1); }

  const { teardownOrg } = require("../ci/seed-demo");
  const api = async (method, p, token, body) => {
    const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch { /* none */ }
    return { status: res.status, body: j };
  };
  const freshOrg = async (id, name, email, userName) => {
    await q(`DELETE FROM users WHERE lower(email) = lower($1) AND org_id <> $2`, [email, id]);
    if ((await q(`SELECT 1 FROM orgs WHERE id=$1`, [id])).length) await teardownOrg(q, id);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,emails_enabled)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),false)`, [id, name, id.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 10), userName]);
    const login = await api("POST", "/auth/login", null, { email, password: PASSWORD });
    if (login.status !== 200) throw new Error(`could not sign in to ${id} (${login.status})`);
    return login.body.token;
  };

  // 2. the walk org: people through the app's own routes, each gift through recordGift
  const wt = await freshOrg(WALK, "Staging walk (made-up people)", WALK_EMAIL, "Walk Account");
  for (const [i, name] of WALK_PEOPLE.entries()) {
    const d = await api("POST", "/donors", wt, { name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@walk.staging.invalid` });
    const id = d.body && (d.body.id || (d.body.donor && d.body.donor.id));
    if (!id) throw new Error(`the walk org's person ${name} was not made (${d.status})`);
    const g = await api("POST", `/donors/${id}/gifts`, wt, { amount: 50 + i * 25, date: `2026-0${1 + (i % 9)}-15`, type: "one-time", payment_method: "check" });
    if (g.status !== 200 && g.status !== 201) throw new Error(`a gift for ${name} was not recorded (${g.status})`);
  }
  console.log(`[staging] ${WALK}: ${WALK_PEOPLE.length} people, one gift each, and the walk account ${WALK_EMAIL}`);

  // 3. the real-shaped fixtures, imported the way a person imports them
  const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
  const R = await import(path.join(ROOT, "shared", "sheetRead.js"));
  const ft = await freshOrg(FIX, "Real-shaped fixtures (made-up names)", FIX_EMAIL, "Fixture Account");
  for (const file of FIXTURE_FILES) {
    const sheets = R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
    const body = { fileName: file, sheets, ...(FIXTURE_ANSWERS[file] ? { answers: FIXTURE_ANSWERS[file] } : {}) };
    const u = await api("POST", "/sheet-import/understand", ft, body);
    if (!u.body || u.body.ready !== true) throw new Error(`${file}: the preview is not ready (${JSON.stringify((u.body && u.body.questions) || u.body).slice(0, 200)})`);
    const start = await api("POST", "/sheet-import/commit", ft, { ...body, background: true });
    if (start.status !== 202) throw new Error(`${file} did not start (${start.status} ${JSON.stringify(start.body).slice(0, 200)})`);
    let end = null;
    for (let t = 0; t < 400 && !end; t++) {
      const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(start.body.importId)}`, ft);
      if (j.status === 200 && j.body.status !== "running") end = j.body;
      else await new Promise(res => setTimeout(res, 500));
    }
    if (!end || end.status !== "done") throw new Error(`${file} did not finish (${JSON.stringify(end).slice(0, 200)})`);
    console.log(`[staging] ${FIX}: ${file} imported`);
  }

  // 4. the scan
  const people = await q(`SELECT org_id, id, name FROM donors WHERE org_id = ANY($1) AND deleted_at IS NULL`, [[DEMO, WALK, FIX]]);
  const creoNames = (await q(`SELECT name FROM donors WHERE org_id=$1`, [CREO])).map(x => x.name);
  const strayOrgs = (await q(`SELECT id, name FROM orgs`)).filter(o => !KNOWN_ORGS.has(o.id));
  const customerNames = String(env.STAGING_REAL_NAMES || "").split(",").map(s => s.trim()).filter(Boolean);
  const hits = scanNames(people, { creoNames, customerNames, strayOrgs, fiction: bootSeedFiction() });
  for (const org of [DEMO, WALK, FIX]) {
    const seeded = org === DEMO ? require("../ci/seed-demo").SEEDED_USER_EMAILS : [org === WALK ? WALK_EMAIL : FIX_EMAIL];
    for (const h of await findRealPeople(q, org, { seededUserEmails: seeded })) hits.push({ org_id: org, name: h.name, reason: h.reason });
  }

  // 5. the baselines Muse walks against
  const count = async (sql, org) => (await q(sql, [org]))[0].n;
  const base = {};
  for (const org of [DEMO, WALK, FIX]) {
    base[org] = { people: await count(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(is_sample,false)=false`, org),
      gifts: await count(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND amount > 0`, org) };
  }
  await client.end();
  console.log(`\n[staging] baselines: ${Object.entries(base).map(([o, b]) => `${o} ${b.people} people, ${b.gifts} gifts`).join(" · ")}`);
  if (hits.length) {
    console.error(`\n[staging] FAILED THE SCAN: ${hits.length} real name(s) or stray org(s) on staging:`);
    for (const h of hits.slice(0, 20)) console.error(`  ${h.org_id || h.org || "?"} · ${h.name} · ${h.reason}`);
    process.exit(1);
  }
  console.log("[staging] the scan found no real name and no stray org. Staging is rebuilt.");
}

if (require.main === module) main().catch(e => { console.error(`[staging] ${e.message}`); process.exit(1); });
module.exports = { scanNames, bootSeedFiction, WALK_PEOPLE, KNOWN_ORGS, WALK_EMAIL, FIXTURE_FILES };
