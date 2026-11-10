// LOAD-1 · TEN ORGS AT ONCE. Steward has to serve a hundred orgs, and until
// this no test ran more than one at a time.
//
//   node scripts/load/ten-orgs.js seed [--fresh]   # 10 orgs of made-up people
//   node scripts/load/ten-orgs.js run              # 20 users, 5 minutes, the table
//
// seed: orgs of 1k, 2k, 5k x4, 10k x2, 15k and 25k people, with gifts, calls,
// tasks, journeys, scores and rhythms, every value a hash of the row number
// (scripts/load/seed-many.js seedOrg, the same generator SCALE-1 uses).
// run: USERS (20) simulated staff, two per org, for DURATION seconds (300),
// each doing a realistic mix with THINK_MS (3 s) to read each screen: open Home, open Donors,
// filter, search, open a profile, log a call, record a gift, open
// Fundraising, run one report (and, since SCALE-3, any other report). It prints a table per route (count, p50, p95,
// max) and the pass bar, writes OUT (JSON) and GITHUB_STEP_SUMMARY (markdown)
// when set, and exits 1 when the bar fails:
//   p95 under 1 s for every API route (retention 800 ms) · a whole profile open under 1.5 s (p95)
//   · nothing over 10 s · zero waits for a connection that gave up · zero 5xx
//
// Refuses any BASE or DATABASE_URL that is not loopback. Never run it against prod.
"use strict";
const fs = require("fs");

const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const DB = process.env.DATABASE_URL || "";
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + "/") || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("Refusing: BASE and DATABASE_URL must both be loopback."); process.exit(1);
}
const MODE = process.argv[2];
const SIZES = [1000, 2000, 5000, 5000, 5000, 5000, 10000, 10000, 15000, 25000];
const ORGS = SIZES.map((donors, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { n: 900 + i, tier: "ten", id: `org_ten${n}`, slug: `ten${n}`, name: `Ten Orgs ${n}`, donors,
    gifts: donors * 6, interactions: donors * 3, tasks: Math.round(donors / 25), subs: Math.round(donors / 100), users: 2 };
});
const WHO = "system:load/ten-orgs";
const R = (i, salt) => `((hashint8((${i})::bigint * 7919 + ${salt}) & 2147483647)::float8 / 2147483648.0)`;

// ── seed ────────────────────────────────────────────────────────────────────
async function seed() {
  const { seedOrg, pool } = require("./seed-many");
  const have = (await pool.query(`SELECT id FROM orgs WHERE id LIKE 'org_ten%'`)).rows.map(r => r.id);
  if (have.length && !process.argv.includes("--fresh")) {
    console.log(`${have.length} ten-orgs already seeded (pass --fresh to rebuild).`); await pool.end(); return;
  }
  if (have.length) {
    const tabs = (await pool.query(`SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).rows.map(r => r.table_name);
    await pool.query("SET session_replication_role = replica");
    for (const t of tabs) await pool.query(`DELETE FROM ${t} WHERE org_id LIKE 'org_ten%'`);
    await pool.query(`DELETE FROM orgs WHERE id LIKE 'org_ten%'`);
    await pool.query("SET session_replication_role = origin");
  }
  const hash = require("bcryptjs").hashSync("loadtest1234", 8);
  const t0 = Date.now();
  const queue = ORGS.slice().reverse();   // the big ones first
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const o = queue.shift();
      const ms = await seedOrg(o, hash);
      await extras(pool, o);
      console.log(`  ${o.id} ${o.donors} people ${(ms / 1000).toFixed(1)}s`);
    }
  }));
  await pool.query("ANALYZE");
  console.log(`seeded ${ORGS.length} orgs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await pool.end();
}
// What seedOrg leaves out: journeys (a cultivation plan with three steps for
// one person in twenty), and the stored scores and rhythm every list reads.
async function extras(pool, o) {
  await pool.query(`
    INSERT INTO cultivation_plans (id, org_id, donor_id, template_id, template_name, applied_on, status, owner_id, owner_name, created_by, created_by_name)
    SELECT $1 || '_cp' || i, $1, $1 || '_d' || i, $1 || '_tpl', 'New donor welcome', (CURRENT_DATE - (i % 40))::text, 'active',
           'u_' || $2 || '_admin', 'Load Admin', '${WHO}', 'LOAD-1 seed'
      FROM generate_series(1, $3::int, 20) i`, [o.id, o.slug, o.donors]);
  await pool.query(`
    INSERT INTO cultivation_plan_steps (id, org_id, plan_id, seq, step_type, label, due_date, status)
    SELECT p.id || '_s' || s, $1, p.id, s, (ARRAY['call','email','note'])[s], 'Step ' || s,
           (p.applied_on::date + s * 7)::text, CASE WHEN s = 1 THEN 'open' ELSE 'pending' END
      FROM cultivation_plans p, generate_series(1, 3) s WHERE p.org_id = $1`, [o.id]);
  await pool.query(`
    INSERT INTO donor_scores (org_id, donor_id, engagement, generosity, band, reason, computed_for, computed_at, created_by, created_by_name, pattern, on_time_through)
    SELECT $1, d.id, floor(${R("i", 41)} * 100)::int, floor(${R("i", 42)} * 100)::int,
           (ARRAY['close','warm','cooling','distant'])[1 + floor(${R("i", 43)} * 4)::int], 'Seeded', CURRENT_DATE::text, NOW(),
           '${WHO}', 'LOAD-1 seed', (ARRAY['on_track','drifting','lapsed'])[1 + floor(${R("i", 44)} * 3)::int],
           CASE WHEN d.last_gift_date IS NOT NULL THEN (LEFT(d.last_gift_date, 10)::date + 365)::text END
      FROM donors d, LATERAL (SELECT substring(d.id from '_d([0-9]+)$')::int AS i) k WHERE d.org_id = $1`, [o.id]);
  await pool.query(`
    INSERT INTO donor_rhythm (org_id, donor_id, rhythm, cadence_days, expected_next, drift_state, computed_for, computed_at, created_by, created_by_name)
    SELECT $1, d.id, CASE WHEN d.gift_count > 1 THEN 'yearly' ELSE 'none' END, CASE WHEN d.gift_count > 1 THEN 365 END,
           CASE WHEN d.last_gift_date IS NOT NULL THEN (LEFT(d.last_gift_date, 10)::date + 365)::text END,
           'on_track', CURRENT_DATE::text, NOW() - interval '1 day', '${WHO}', 'LOAD-1 seed'
      FROM donors d WHERE d.org_id = $1`, [o.id]);
}

// ── run ─────────────────────────────────────────────────────────────────────
// What each screen asks for, as the browser asks it. PROFILE is every request
// opening one person fires (counted in a browser; LOAD-1 item 4 changes it).
// Waves of requests: each wave at once, the next when it has answered.
// PROFILE_SHAPE=many is the shape before LOAD-1 (every read at once).
const PROFILE = (id) => process.env.PROFILE_SHAPE === "many" ? [PROFILE_MANY(id)] : PROFILE_BUNDLE(id);
// The 37 a profile fired on main (scripts/load/profile-requests.js, 4 Nov).
const PROFILE_MANY = (id) => [
  `/donors/${id}`, `/insights/donor/${id}`, `/atlas/notes?place=person&id=${id}`, `/people/${id}`, `/donors/${id}/groups`,
  `/donors/${id}/blocked-mail`, `/donors/${id}/before-meeting`, `/donors/${id}/scores`, `/donors/${id}/status`, "/mailbox",
  `/donors/${id}/rail`, `/donors/${id}/relationship`, "/sequences", `/donors/${id}/proposals`, `/threads?donorId=${id}`,
  `/donors/${id}/relationships`, `/donors/${id}/custom-fields`, "/custom-fields?entity=gift", `/donors/${id}/events`,
  `/donors/${id}/attachments`, `/donors/${id}/tasks`, `/donors/${id}/volunteer-hours`, `/donors/${id}/recurring-subscription`,
  `/donors/${id}/soft-credit`, `/donors/${id}/moves`, `/donors/${id}/opportunities`, `/donors/${id}/move-suggestions`,
  `/donors/${id}/designations`, `/donors/${id}/receipts`, "/org", `/donors/${id}/plan`, `/donors/${id}/journeys`, "/journeys",
  `/donors/${id}/journey-suggestion`, `/donors/${id}/planned-gifts`, `/donors/${id}/pledges`, "/fundraising/campaigns",
];
// LOAD-1 item 4: the header's own read and the above-the-fold bundle at once,
// then the below-the-fold bundle once that has answered (client/src/lib/profileReads.js).
const bundleOf = (id, paths) => `/donors/${id}/bundle?` + paths.map(p => "p=" + encodeURIComponent(p)).join("&");
const PROFILE_BUNDLE = (id) => {
  const { top, below } = profileLists(id);
  return [[`/donors/${id}`, bundleOf(id, top.filter(p => p !== `/donors/${id}`))], [bundleOf(id, below)]];
};
// The two lists, as the client spells them (PROFILE_MANY, split at the fold).
const profileLists = (id) => {
  const top = [`/donors/${id}`, `/donors/${id}/status`, `/donors/${id}/scores`, `/donors/${id}/rail`, `/donors/${id}/relationship`,
    `/threads?donorId=${id}`, `/insights/donor/${id}`, `/donors/${id}/before-meeting`, `/donors/${id}/blocked-mail`,
    `/people/${id}`, `/atlas/notes?place=person&id=${id}`, `/donors/${id}/plan`, `/donors/${id}/journeys`];
  return { top, below: PROFILE_MANY(id).filter(p => !top.includes(p)) };
};
// SCALE-3: the rest of REPORT_HANDLERS (server/reports/handlers.js), one picked per "reports" turn.
const OTHER_REPORTS = ["giving-summary", "deposits", "non-cash", "by-group", "sybunt", "top-donors", "three-year", "year-over-year",
  "annual", "solicitations", "bookkeeper", "grant-deadlines", "grant-restricted", "members-directory", "members-by-level",
  "members-expiring", "members-lapsed", "members-new-renewed", "membership-revenue", "p2p-fundraisers", "p2p-teams"];
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
const routeOf = (path) => (/\/bundle\?/.test(path) ? path.split("?")[0] + (path.includes(encodeURIComponent("/status")) ? " (above the fold)" : " (below the fold)") : path.split("?")[0]).replace(/\/org_ten\d+_[a-z]+\d+/g, "/:id").replace(/\/(d|g|i|t)_[0-9a-f]{8,}/g, "/:id");

async function run() {
  const USERS = Number(process.env.USERS || 20);
  const DURATION = Number(process.env.DURATION || 300) * 1000;
  // A person reads a screen before the next click: THINK_MS on average (half
  // to one and a half of it). 0 is SCALE-2's zero-think run, which measures
  // how much one process can take rather than what twenty people see.
  const THINK_MS = Number(process.env.THINK_MS ?? 3000);
  const stats = new Map();   // route -> [ms]
  const fivexx = new Map(), slowest = { ms: 0 };
  const profileOpens = [];
  const note = (route, ms, status) => {
    (stats.get(route) || stats.set(route, []).get(route)).push(ms);
    if (status >= 500 || status === 0) fivexx.set(route, (fivexx.get(route) || 0) + 1);
    if (ms > slowest.ms) Object.assign(slowest, { ms, route });
  };
  const call = async (tok, method, path, body) => {
    const t0 = performance.now();
    let status = 0;
    try {
      const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
      status = r.status; await r.arrayBuffer();
    } catch { status = 0; }
    note(`${method} ${routeOf(path)}`, performance.now() - t0, status);
    return status;
  };
  const health0 = await (await fetch(`${BASE}/health`)).json();
  // One sign-in per org, shared by its users: the real sign-in limiter allows
  // 20 an IP in 15 minutes, and every simulated user signs in from loopback.
  const signedIn = new Map();
  const tokens = [];
  // SCALE-3: ONLY_ORG=org_ten10 puts every user on one org (the brief's "the
  // largest org with 20 users"); unset, users spread two to an org as before.
  const pool = process.env.ONLY_ORG ? ORGS.filter(o => o.id === process.env.ONLY_ORG) : ORGS;
  if (!pool.length) throw new Error(`ONLY_ORG ${process.env.ONLY_ORG} is not one of the ten orgs`);
  for (let u = 0; u < USERS; u++) {
    const o = pool[u % pool.length];
    if (!signedIn.has(o.id)) {
      const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `admin@${o.slug}.load`, password: "loadtest1234" }) });
      const j = await r.json();
      if (!j.token) throw new Error(`sign-in failed for ${o.slug}: ${JSON.stringify(j).slice(0, 200)}`);
      signedIn.set(o.id, j.token);
    }
    tokens.push({ tok: signedIn.get(o.id), o });
  }
  const today = new Date().toISOString().slice(0, 10);
  const until = Date.now() + DURATION;
  const MIX = [["home", 3], ["donors", 3], ["filter", 2], ["search", 2], ["profile", 5], ["call", 1], ["gift", 1], ["fundraising", 1], ["report", 1], ["reports", 1]];
  const bag = MIX.flatMap(([k, w]) => Array(w).fill(k));
  await Promise.all(tokens.map(async ({ tok, o }, u) => {
    let seedN = u * 7919 + 1;
    const r = () => { seedN = (seedN * 48271) % 2147483647; return seedN / 2147483647; };
    const person = () => `${o.id}_d${1 + Math.floor(r() * o.donors)}`;
    while (Date.now() < until) {
      if (THINK_MS) await new Promise(res => setTimeout(res, THINK_MS * (0.5 + r())));
      const what = pick(bag, r);
      if (what === "home") await call(tok, "GET", "/home/bundle");
      else if (what === "donors") await Promise.all([call(tok, "GET", "/donors?limit=50"), call(tok, "GET", "/donors/counts")]);
      else if (what === "filter") await call(tok, "GET", `/donors?limit=50&status=${pick(["lapsed", "active", "major"], r)}`);
      else if (what === "search") await call(tok, "GET", `/donors?limit=50&q=${pick(["smith", "garcia", "landry", "mary", "d12"], r)}`);
      else if (what === "profile") {
        const id = person(), t0 = performance.now();
        for (const wave of PROFILE(id)) await Promise.all(wave.map(p => call(tok, "GET", p)));
        profileOpens.push(performance.now() - t0);
      } else if (what === "call") await call(tok, "POST", `/donors/${person()}/interactions`, { type: "call", date: today, note: "Load test call" });
      else if (what === "gift") await call(tok, "POST", `/donors/${person()}/gifts`, { amount: 25 + Math.floor(r() * 200), date: today, type: "cash", payment_method: "check" });
      else if (what === "fundraising") await call(tok, "GET", "/fundraising/overview");
      else if (what === "report") await call(tok, "GET", `/reports/${pick(["lybunt", "retention"], r)}`);
      // SCALE-3: every other report on the Reports tab, so a slow one shows in the same run.
      else if (what === "reports") await call(tok, "GET", `/reports/${pick(OTHER_REPORTS, r)}`);
    }
  }));
  const health1 = await (await fetch(`${BASE}/health`)).json();
  const lim = (h) => (h.pool && h.pool.limits) || {};
  const checkoutTimeouts = (lim(health1).checkoutTimeouts || 0) - (lim(health0).checkoutTimeouts || 0);
  return report({ stats, fivexx, slowest, profileOpens, checkoutTimeouts, USERS, DURATION, THINK_MS });
}

const RETENTION_BAR_MS = 800;
const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
function report({ stats, fivexx, slowest, profileOpens, checkoutTimeouts, USERS, DURATION, THINK_MS = 0 }) {
  const rows = [...stats].map(([route, ms]) => ({ route, count: ms.length, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), max: Math.round(Math.max(...ms)), fivexx: fivexx.get(route) || 0 }))
    .sort((a, b) => b.p95 - a.p95);
  const profile = { count: profileOpens.length, p50: Math.round(pct(profileOpens, 50)), p95: Math.round(pct(profileOpens, 95)), max: Math.round(Math.max(0, ...profileOpens)) };
  const misses = [];
  for (const r of rows) {
    if (r.p95 >= 1000) misses.push(`${r.route} p95 ${r.p95} ms`);
    if (r.max > 10000) misses.push(`${r.route} max ${r.max} ms`);
    if (r.fivexx) misses.push(`${r.route} ${r.fivexx} 5xx or no answer`);
  }
  // SCALE-3: retention's own bar is tighter, 800 ms, so it has room under the 1 s.
  for (const r of rows) if (r.route === "GET /reports/retention" && r.p95 >= RETENTION_BAR_MS && r.p95 < 1000) misses.push(`${r.route} p95 ${r.p95} ms (its bar is ${RETENTION_BAR_MS} ms)`);
  if (profile.p95 >= 1500) misses.push(`profile open p95 ${profile.p95} ms`);
  if (checkoutTimeouts) misses.push(`${checkoutTimeouts} waits for a connection gave up`);
  const pass = misses.length === 0;
  const lines = [
    `### Load test: ${USERS} users, 10 orgs, ${Math.round(DURATION / 1000)} s, ${THINK_MS / 1000} s to read each screen · ${pass ? "PASS" : "FAIL"}`, "",
    "| route | count | p50 ms | p95 ms | max ms | 5xx |", "|---|---:|---:|---:|---:|---:|",
    ...rows.map(r => `| ${r.route} | ${r.count} | ${r.p50} | ${r.p95} | ${r.max} | ${r.fivexx} |`),
    `| **profile open (all its requests)** | ${profile.count} | ${profile.p50} | ${profile.p95} | ${profile.max} | |`, "",
    `Connection waits that gave up: ${checkoutTimeouts}. Slowest single request: ${slowest.route} ${Math.round(slowest.ms)} ms.`,
    pass ? "Every route is inside the bar." : `Misses: ${misses.join("; ")}.`,
  ];
  const md = lines.join("\n");
  console.log(md);
  const out = { at: new Date().toISOString(), pass, users: USERS, seconds: Math.round(DURATION / 1000), thinkMs: THINK_MS, rows, profile, checkoutTimeouts,
    slowest: { route: slowest.route, ms: Math.round(slowest.ms) }, misses };
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  return out;
}

module.exports = { ORGS, routeOf, report, extras };
if (require.main === module) {
  (MODE === "seed" ? seed() : MODE === "run" ? run().then(o => process.exit(o.pass ? 0 : 1)) : Promise.reject(new Error("usage: ten-orgs.js seed|run")))
    .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}
