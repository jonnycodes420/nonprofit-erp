// BUILD-05 load-test driver — autocannon against a LOCAL server seeded by
// scripts/seed-loadtest.js. Never point BASE at production.
//
// Phases (all optional flags; default runs just the autocannon targets):
//   node scripts/loadtest.js                 # hot-path latency targets
//   node scripts/loadtest.js --export        # + /org/export/csv single-shot timings
//   node scripts/loadtest.js --import        # + POST /donors/import-combined 25k rows (org_importtest)
//   node scripts/loadtest.js --jobs          # + autoEnroll/processSequences sweep timing
//                                            #   (needs DATABASE_URL to activate the paused sequences)
//   node scripts/loadtest.js --noisy         # + small-org latency while big org is under load
//
// Env: BASE (default http://localhost:5601), DURATION (s, default 30),
//      CONNECTIONS (default 10), OUT (json results path)
const autocannon = require("autocannon");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:5601";
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error("Refusing: BASE must be localhost"); process.exit(1); }
const DURATION = parseInt(process.env.DURATION || "30", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "10", 10);
const flags = new Set(process.argv.slice(2));

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "loadtest1234" }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

function cannon(name, opts) {
  return new Promise((resolve, reject) => {
    autocannon({ url: BASE, duration: DURATION, connections: CONNECTIONS, ...opts }, (err, result) => {
      if (err) return reject(err);
      // autocannon's percentile set has no p95 — p97_5 is the nearest and is
      // conservative (p97_5 >= p95), so the report labels it "p95 (as p97.5)".
      resolve({
        name,
        latency: { p50: result.latency.p50, p90: result.latency.p90, p95: result.latency.p97_5, p99: result.latency.p99, max: result.latency.max, mean: result.latency.mean },
        rps: result.requests.average,
        throughputMBs: +(result.throughput.average / 1048576).toFixed(1),
        non2xx: result.non2xx, errors: result.errors, timeouts: result.timeouts,
        totalRequests: result.requests.total,
      });
    });
  });
}

const fmt = r => `${r.name.padEnd(46)} p50 ${String(r.latency.p50).padStart(7)}ms  p95 ${String(r.latency.p95).padStart(7)}ms  p99 ${String(r.latency.p99).padStart(7)}ms  ${String(r.rps.toFixed(1)).padStart(8)} req/s  ${String(r.throughputMBs).padStart(7)} MB/s  non2xx=${r.non2xx} err=${r.errors} to=${r.timeouts}`;

async function timeOnce(name, fn) {
  const t0 = process.hrtime.bigint();
  const extra = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { name, singleShotMs: Math.round(ms), ...extra };
}

(async () => {
  const results = [];
  const token = await login("admin@riverbend.test");
  const auth = { authorization: `Bearer ${token}` };

  // A donor with real history for the profile target (top donor by giving)
  const donorsRes = await fetch(`${BASE}/donors`, { headers: auth });
  const donors = await donorsRes.json();
  const topDonor = donors[0];
  console.log(`Logged in. Big org donors: ${donors.length}. Profile target: ${topDonor.id} (${topDonor.gift_count} gifts)`);

  // --skip-slow: leave out endpoints known to take minutes per request at
  // baseline (autocannon would record nothing but timeouts while stacking
  // minutes-long queries on the server) — their baseline is the single-shot
  // curl timings in LOADTEST_REPORT.md instead.
  const skipSlow = flags.has("--skip-slow");
  const slowTargets = skipSlow ? [] : [
    ["GET /metrics/stewardship-summary?scope=all", { url: `${BASE}/metrics/stewardship-summary?scope=all`, headers: auth }],
    ["GET /metrics/stewardship-summary (mine)", { url: `${BASE}/metrics/stewardship-summary`, headers: auth }],
    ["GET /dashboard/stewardship-debt/breakdown?scope=all", { url: `${BASE}/dashboard/stewardship-debt/breakdown?scope=all`, headers: auth }],
  ];

  const targets = [
    ...slowTargets,
    ["GET /dashboard/today?scope=all", { url: `${BASE}/dashboard/today?scope=all`, headers: auth }],
    ["GET /dashboard/today (mine)", { url: `${BASE}/dashboard/today`, headers: auth }],
    ["GET /donors (full directory payload)", { url: `${BASE}/donors`, headers: auth }],
    [`GET /donors/:id (top donor profile)`, { url: `${BASE}/donors/${topDonor.id}`, headers: auth }],
    ["GET /reports/giving-summary (this FY)", { url: `${BASE}/reports/giving-summary?year=2027&yearMode=fiscal`, headers: auth }],
    ["GET /reports/lybunt (this FY)", { url: `${BASE}/reports/lybunt?year=2027&yearMode=fiscal`, headers: auth }],
    ["GET /reports/retention", { url: `${BASE}/reports/retention`, headers: auth }],
    ["GET /goals/active", { url: `${BASE}/goals/active`, headers: auth }],
    ["POST /auth/login (bcrypt)", {
      url: `${BASE}/auth/login`, method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@riverbend.test", password: "loadtest1234" }),
    }],
  ];

  // TARGET_FILTER=regex narrows which targets run (e.g. TARGET_FILTER="lybunt|login")
  const targetFilter = process.env.TARGET_FILTER ? new RegExp(process.env.TARGET_FILTER, "i") : null;
  if (!flags.has("--no-cannon")) {
    for (const [name, opts] of targets) {
      if (targetFilter && !targetFilter.test(name)) continue;
      // one warm-up request; a timeout here (server still draining a previous
      // pathological target) shouldn't kill the whole run
      try { await fetch(opts.url, { method: opts.method || "GET", headers: opts.headers, body: opts.body }); }
      catch (e) { console.error(`warm-up for ${name} failed (${e.cause?.code || e.message}) — continuing`); }
      const r = await cannon(name, opts);
      results.push(r);
      console.log(fmt(r));
    }
  }

  if (flags.has("--export")) {
    for (let i = 1; i <= 3; i++) {
      const r = await timeOnce(`GET /org/export/csv (zip, run ${i})`, async () => {
        const res = await fetch(`${BASE}/org/export/csv`, { headers: auth });
        const buf = await res.arrayBuffer();
        return { status: res.status, zipMB: +(buf.byteLength / 1048576).toFixed(1) };
      });
      results.push(r);
      console.log(`${r.name}: ${r.singleShotMs}ms, ${r.zipMB}MB, status ${r.status}`);
    }
  }

  if (flags.has("--import")) {
    const itoken = await login("admin@importtest.test");
    const N = parseInt(process.env.IMPORT_DONORS || "25000", 10), runTag = Date.now().toString(36);
    const impDonors = [], impGifts = [];
    for (let i = 0; i < N; i++) {
      impDonors.push({ name: `Import Donor ${i}`, email: `imp${runTag}_${i}@import.test`, total: 100 + (i % 900) });
      const nGifts = 1 + (i % 15); // ~200k gifts total
      for (let k = 0; k < nGifts; k++) {
        impGifts.push({ donorIndex: i, amount: 25 + (k * 10), date: `202${k % 6 + 1}-0${(k % 9) + 1}-15` });
      }
    }
    console.log(`Import payload: ${impDonors.length} donors, ${impGifts.length} gifts`);
    const r = await timeOnce("POST /donors/import-combined (25k donors)", async () => {
      const res = await fetch(`${BASE}/donors/import-combined`, {
        method: "POST",
        headers: { authorization: `Bearer ${itoken}`, "content-type": "application/json" },
        body: JSON.stringify({ donors: impDonors, gifts: impGifts }),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, created: body.created, giftsAttached: body.giftsAttached ?? body.giftsCreated };
    });
    results.push(r);
    console.log(`${r.name}: ${r.singleShotMs}ms, status ${r.status}, created=${r.created}`);
  }

  if (flags.has("--jobs")) {
    // Activate the paused sequences, time one full autoEnroll+processSequences
    // sweep via the admin route, then re-pause and clear enrollments.
    const { Pool } = require("pg");
    const DB_URL = process.env.DATABASE_URL || "";
    if (!/localhost|127\.0\.0\.1/.test(DB_URL)) { console.error("--jobs needs a localhost DATABASE_URL"); process.exit(1); }
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await pool.query("UPDATE sequences SET status='active' WHERE org_id IN ('org_loadtest','org_smalltest')");
    const r = await timeOnce("POST /sequences/process (autoEnroll + processSequences sweep)", async () => {
      const res = await fetch(`${BASE}/sequences/process`, { method: "POST", headers: auth });
      return { status: res.status };
    });
    const enr = await pool.query("SELECT COUNT(*) FROM sequence_enrollments WHERE org_id='org_loadtest'");
    r.enrollmentsCreated = Number(enr.rows[0].count);
    results.push(r);
    console.log(`${r.name}: ${r.singleShotMs}ms, enrollments now: ${r.enrollmentsCreated}`);
    await pool.query("UPDATE sequences SET status='paused' WHERE org_id IN ('org_loadtest','org_smalltest')");
    await pool.query("DELETE FROM milestone_drafts WHERE org_id='org_loadtest' AND sequence_enrollment_id IS NOT NULL");
    await pool.query("DELETE FROM note_reminders WHERE org_id='org_loadtest' AND sequence_enrollment_id IS NOT NULL");
    await pool.query("DELETE FROM sequence_enrollments WHERE org_id IN ('org_loadtest','org_smalltest')");
    await pool.end();
  }

  if (flags.has("--noisy")) {
    // Small-org latency alone vs while the big org is hammered.
    const stoken = await login("admin@willow.test");
    const sauth = { authorization: `Bearer ${stoken}` };
    const sample = async label => {
      const times = [];
      for (let i = 0; i < 40; i++) {
        const t0 = process.hrtime.bigint();
        await fetch(`${BASE}/dashboard/today?scope=all`, { headers: sauth });
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      times.sort((a, b) => a - b);
      const r = { name: `small org /dashboard/today (${label})`, latency: { p50: Math.round(times[19]), p95: Math.round(times[37]), p99: Math.round(times[39]), mean: Math.round(times.reduce((s, x) => s + x, 0) / times.length) }, samples: times.length };
      results.push(r);
      console.log(`${r.name}: p50 ${r.latency.p50}ms p95 ${r.latency.p95}ms`);
    };
    await sample("alone");
    const bg = cannon("bg big-org stewardship-summary (noisy-neighbor driver)", { url: `${BASE}/metrics/stewardship-summary?scope=all`, headers: auth });
    await new Promise(r => setTimeout(r, 2000)); // let load ramp
    await sample("while big org under load");
    const bgr = await bg;
    console.log(fmt(bgr));
    results.push(bgr);
  }

  if (process.env.OUT) {
    fs.writeFileSync(process.env.OUT, JSON.stringify({ base: BASE, duration: DURATION, connections: CONNECTIONS, when: new Date().toISOString(), results }, null, 2));
    console.log(`\nResults written to ${process.env.OUT}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
