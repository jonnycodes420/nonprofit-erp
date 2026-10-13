// SCALE-1 · part 1's numbers, from a LOCAL server on the seeded load database.
//
//   node scripts/load/measure.js latency   # 20 users, one per large org, screens on a loop
//   node scripts/load/measure.js tick      # every background job once (needs tick-capture.js preloaded)
//   node scripts/load/measure.js import    # a 10,000-row gift file into a medium org
//   node scripts/load/measure.js db        # pg_stat_statements, seq scans, connections
//   node scripts/load/measure.js all
//
// Env: BASE (default http://localhost:6701), DURATION seconds (default 60),
// USERS (default 20), OUT (a JSON file to write the results to).
// Refuses any BASE or DATABASE_URL that is not loopback.
const fs = require("fs");
const { Pool } = require("pg");

const BASE = process.env.BASE || "http://localhost:6701";
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5546/steward_scale1";
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE) || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("Refusing: BASE and DATABASE_URL must be loopback."); process.exit(1);
}
const DURATION = Number(process.env.DURATION || 60) * 1000;
const USERS = Number(process.env.USERS || 20);
const results = {};

const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

// Tokens are kept between runs: the production login limiter allows a few
// sign-ins per IP, and every load user signs in from loopback.
const TOKEN_FILE = process.env.TOKEN_FILE || require("os").homedir() + "/steward-scale-pg/tokens.json";
let tokens = {}; try { tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch {}
async function login(email) {
  if (tokens[email]) {
    const ok = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${tokens[email]}` } });
    if (ok.status === 200) return tokens[email];
  }
  const t = await freshLogin(email);
  tokens[email] = t; fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
  return t;
}
async function freshLogin(email) {
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "loadtest1234" }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  return (await r.json()).token;
}
async function call(token, method, path, body) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { ms: performance.now() - t0, status: r.status, path, bytes: text.length, text };
}

// What each screen asks for on first load, read from the client (SCALE-1
// screen map). Each screen is a list of WAVES: the calls in a wave fire
// together, the next wave waits for the one before, and the screen is done
// when its last wave is.
const G = p => ["GET", p];
const HOME_FIRST = ["/data-health/notice", "/gift-starts/notice", "/recurring/exceptions", "/readouts/latest", "/move",
  "/sequences/home", "/agent/daily-line", "/threads/health", "/org/setup-status", "/me/home-layout", "/tasks/counts?scope=mine",
  "/dashboard/my-stats", "/donors/stage-counts", "/recurring/health", "/impact", "/fundraising/overview", "/goals/active", "/drift",
  "/threads?scope=mine", "/calendar/today", "/calendar/to-log", "/mailbox", "/home/calls", "/home/annual-goal", "/ask/pins",
  "/donors/birthdays-near"];
const HOME_SCOPE = s => [`/dashboard/today?scope=${s}`, `/metrics/stewardship-summary?scope=${s}`, `/dashboard/home?scope=${s}`,
  "/thank-yous", `/dashboard/stewardship-debt/breakdown?scope=${s}`, `/dashboard/retention/breakdown?scope=${s}`];
const bundle = paths => "/home/bundle?" + paths.map(p => "p=" + encodeURIComponent(p)).join("&");
const SCREENS = {
  shell: () => [[G("/org"), G("/donors/summaries"), G("/grants"), G("/volunteers"), G("/tasks"), G("/board"), G("/financials"),
                 G("/billing/status"), G("/journeys"), G("/status/summary"), G("/org/sample-data-status")]],
  // SCALE-2: Home asks for each wave in ONE request (client/src/api.js
  // prefetch -> GET /home/bundle); these are the same reads as SCALE-1's 25
  // and 6, now two calls.
  home: () => [[G(bundle(HOME_FIRST))], [G(bundle(HOME_SCOPE("all")))]],
  donors: () => [[G("/donors?limit=50&offset=0&role=donor"), G("/org/team"), G("/portfolio/officers"),
                  G("/custom-fields?entity=donor"), G("/donors/custom-field-values/all"), G("/me")]],
  profile: (o) => { const d = `/donors/${o.donorId}`; return [[G(d)],
    [G(d + "/relationship"), G(`/threads?donorId=${o.donorId}`), G(d + "/relationships"), G(d + "/custom-fields"), G(d + "/events"),
     G(d + "/recurring-subscription"), G(d + "/soft-credit"), G(d + "/moves"), G(d + "/opportunities"), G(d + "/move-suggestions"),
     G(d + "/designations"), G(d + "/receipts"), G(d + "/planned-gifts"), G(d + "/pledges"), G(d + "/plan"), G(d + "/journeys"),
     G(d + "/journey-suggestion"), G(d + "/status"), G(d + "/scores"), G(d + "/groups"), G(`/people/${o.donorId}`),
     G(d + "/proposals"), G(d + "/memberships"), G(d + "/room-to-give")]]; },
  drift: () => [[G("/drift?all=1&includeMedium=1")]],
  giving: () => [[G("/reports/giving-summary?yearMode=fiscal")], [G(`/reports/giving-summary?year=${new Date().getFullYear()}&yearMode=fiscal`)]],
  search: () => [[G("/search?q=smith")]],
  ask: () => [[G("/ask/guided"), ["POST", "/ask", { text: "who gave the most last year?", previous: null }]]],
};

async function latency() {
  const orgs = Array.from({ length: USERS }, (_, i) => i % 20);
  const users = [];
  for (const n of orgs) {
    const slug = `load${String(n).padStart(3, "0")}`;
    users.push({ slug, token: await login(`admin@${slug}.load`), donorId: `org_${slug}_d${7 + n}` });
  }
  const per = Object.fromEntries(Object.keys(SCREENS).map(k => [k, { screen: [], status: {}, slowest: {} }]));
  const stopAt = Date.now() + DURATION;
  // The connection high-water mark, sampled twice a second while users run.
  const mon = new Pool({ connectionString: DB, ssl: false, max: 1 });
  let connPeak = 0, activePeak = 0; let sampling = true;
  const sampler = (async () => { while (sampling) {
    const r = await mon.query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE state <> 'idle')::int a FROM pg_stat_activity
                                WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`);
    connPeak = Math.max(connPeak, r.rows[0].n); activePeak = Math.max(activePeak, r.rows[0].a);
    await new Promise(res => setTimeout(res, 500)); } })();
  await Promise.all(users.map(async (u) => {
    while (Date.now() < stopAt) {
      for (const [name, reqs] of Object.entries(SCREENS)) {
        const t0 = performance.now();
        const rs = [];
        for (const wave of reqs(u)) rs.push(...await Promise.all(wave.map(([m, p, b]) => call(u.token, m, p, b))));
        per[name].screen.push(performance.now() - t0);
        per[name].bytes = Math.max(per[name].bytes || 0, rs.reduce((n, r) => n + r.bytes, 0));
        for (const r of rs) {
          per[name].status[r.status] = (per[name].status[r.status] || 0) + 1;
          const k = r.path.startsWith("/home/bundle") ? `/home/bundle (${r.path.split("&p=").length} reads)` : r.path.replace(/org_load\d+_d\d+/, ":id");
          (per[name].slowest[k] = per[name].slowest[k] || []).push(r.ms);
        }
      }
    }
  }));
  sampling = false; await sampler; await mon.end();
  results.connections = { peak: connPeak, activePeak };
  console.log(`database connections: peak ${connPeak} open, ${activePeak} busy at once`);
  const table = {};
  for (const [name, v] of Object.entries(per)) {
    table[name] = { n: v.screen.length, p50: Math.round(pct(v.screen, 50)), p95: Math.round(pct(v.screen, 95)), bytes: v.bytes || 0, status: v.status,
      requests: Object.fromEntries(Object.entries(v.slowest).map(([k, arr]) => [k, { p50: Math.round(pct(arr, 50)), p95: Math.round(pct(arr, 95)) }])) };
  }
  results.latency = table;
  console.table(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { n: v.n, p50: v.p50, p95: v.p95, kb: Math.round(v.bytes / 1024), status: JSON.stringify(v.status) }])));
}

async function tick() {
  const LOG = (process.env.LOAD_DIR || require("os").homedir() + "/steward-scale-pg") + "/tick.jsonl";
  fs.writeFileSync(LOG, "");
  const jobs = await (await fetch("http://localhost:6709/jobs")).json();
  const max = Number(process.env.TICK_MAX || 300000);
  const t0 = Date.now();
  await fetch(`http://localhost:6709/run?async=1&max=${max}` + (process.env.TICK_ONLY ? "&only=" + process.env.TICK_ONLY : ""), { method: "POST" });
  let lines = [];
  while (true) {
    lines = fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    if (lines.some(l => l.done)) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  const total = Date.now() - t0;
  const r = lines.filter(l => !l.done).sort((a, b) => b.ms - a.ms);
  results.tick = { totalMs: total, maxEveryMs: max, jobs: r, heldJobs: jobs.length };
  console.log(`every job on a <=${max / 60000} min cadence, run once in turn: ${(total / 1000).toFixed(1)}s`);
  console.table(r.map(j => ({ job: j.name, everyMin: +(j.everyMs / 60000).toFixed(1), seconds: +(j.ms / 1000).toFixed(2), timedBy: j.timedBy, error: j.error || "" })));
}

async function importRun() {
  const slug = process.env.IMPORT_ORG || "load020";
  const token = await login(`admin@${slug}.load`);
  // 10,000 rows: 6,000 to people already on file, 4,000 to new people, dates
  // over three years, 5% inside the last 30 days (the recent-gift lane).
  const rows = [];
  for (let i = 0; i < 10000; i++) {
    const known = i < 6000;
    const daysAgo = i % 20 === 0 ? (i % 29) + 1 : 40 + (i * 37) % 1050;
    const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    rows.push({ name: known ? null : `Imported Person ${i}`, email: known ? `d${1 + (i % 4500)}@${slug}.example` : `imp${i}@${slug}.example`,
      amount: (25 + (i * 13) % 975).toFixed(2), date: d });
  }
  const csv = "Name,Email,Amount,Date\n" + rows.map(r => `${r.name || ""},${r.email},${r.amount},${r.date}`).join("\n");
  fs.writeFileSync(process.env.IMPORT_FILE || "/tmp/scale1-import.csv", csv);
  results.importFile = { rows: rows.length, bytes: csv.length };
  console.log(`wrote ${rows.length}-row file (${csv.length} bytes); the import is driven by the import route recipe in import-drive.js`);
  void token;
}

async function db() {
  const p = new Pool({ connectionString: DB, ssl: false, max: 1 });
  const top = (await p.query(`
    SELECT round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time::numeric,0) max_ms, calls,
           round(total_exec_time::numeric/1000,1) total_s, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) q
      FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND query NOT ILIKE '%pg_stat%' AND query NOT ILIKE 'INSERT INTO %load%'
     ORDER BY mean_exec_time DESC LIMIT 15`)).rows;
  const seq = (await p.query(`
    SELECT relname, seq_scan, seq_tup_read, n_live_tup, idx_scan FROM pg_stat_user_tables
     WHERE n_live_tup > 100000 AND seq_scan > 0 ORDER BY seq_tup_read DESC`)).rows;
  results.db = { slowest: top, seqScans: seq };
  console.log("slowest 15 statements by mean time:"); console.table(top);
  console.log("sequential scans on tables over 100k rows:"); console.table(seq);
  await p.end();
}

if (require.main === module) (async () => {
  const what = process.argv[2] || "all";
  if (what === "latency" || what === "all") await latency();
  if (what === "tick" || what === "all") await tick();
  if (what === "import") await importRun();
  if (what === "db" || what === "all") await db();
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
