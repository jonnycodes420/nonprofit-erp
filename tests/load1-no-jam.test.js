// LOAD-1 · ONE SLOW PAGE CAN'T SLOW ANYONE ELSE.
//
// On 4 Nov a fresh org's Donors list took 146 s; the user refreshed, every
// refresh left another query running, and /me for every other org waited 6 to
// 23 s behind them. This boots its own server (TEST_MODE, the planted route
// GET /test/slow-sql, a 10-connection pool) and proves:
//   §1 two orgs each open the slow route 10 times and abandon every one
//      after 300 ms: /me from a third org stays under 200 ms for the next
//      8 s, and no planted statement is left running (red on main: the 20
//      sleeps hold all 10 connections for 60 s and /me waits)
//   §2 a caller who does not abandon gets a 503 with the plain sentence at
//      the limit, never a hang, and the statement is gone after it
// Planted: the statement timeout removed (requestLimits.align sets 0) turns
// §2 red; the cancel removed (close() skips cancelBackend) turns §1 red.
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const RUN = Math.random().toString(36).slice(2, 8);
const ORGS = ["a", "b", "c"].map(k => ({ id: `org_load1j${k}_${RUN}`, email: `staff-${k}-${RUN}@load1j.local` }));
const PW = "loadtest1234";
const LIMIT_MS = 3000;
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Statements the planted route left running, by the marker only it sends.
const sleeping = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND state = 'active' AND query LIKE 'SELECT pg_sleep($1) AS slept%'`))[0].n);
let child = null;

(async () => {
  for (const o of ORGS) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,'Load One Jam',$2,1,'active','team','America/New_York',NOW())`, [o.id, o.id.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rae Dunn','staff')`,
      [`u_${o.id}`, o.id, o.email, bcrypt.hashSync(PW, 8)]);
  }
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  child = spawn(process.execPath, ["server.js"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", STEWARD_TEST_SLOW_SQL: "1", DB_POOL_MAX: "10",
      REQUEST_STATEMENT_TIMEOUT_MS: String(LIMIT_MS), DISABLE_BACKGROUND_TICKS: "1", STEWARD_PROCESS: "web",
      // What any boot needs, as deploy1-ready's server has it, when the battery's env is not there.
      JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
      RESEND_BASE_URL: "http://localhost:9", DB_SSL: process.env.DB_SSL || "disable" } });
  let err = ""; child.stderr.on("data", d => { err = (err + d).slice(-2000); });
  // A shard's machine is busy: the boot gets three minutes, and says so if it never came up.
  let up = false;
  for (let i = 0; i < 360 && !up; i++) { up = (await fetch(`${BASE}/ready`).catch(() => null))?.status === 200; if (!up) await sleep(500); }
  if (!up) throw new Error("the suite's server never became ready: " + (err.split("\n").filter(l => /Error|EADDR|refus/i.test(l)).slice(0, 4).join(" | ") || err.slice(-300)));
  const login = async (email) => (await (await fetch(`${BASE}/auth/login`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }) })).json()).token;
  const [ta, tb, tc] = await Promise.all(ORGS.map(o => login(o.email)));
  ok("three orgs signed in", !!(ta && tb && tc), err.slice(-300));
  const auth = (t) => ({ authorization: `Bearer ${t}` });
  await fetch(`${BASE}/me`, { headers: auth(tc) });   // warm

  // ── §1 · twenty abandoned slow reads ────────────────────────────────────
  console.log("\n§1 two orgs abandon the slow route ten times each");
  for (const t of [ta, tb]) for (let i = 0; i < 10; i++) {
    const ac = new AbortController();
    fetch(`${BASE}/test/slow-sql?s=60`, { headers: auth(t), signal: ac.signal }).catch(() => {});
    setTimeout(() => ac.abort(), 300);
  }
  await sleep(150);
  const peak = await sleeping();
  const times = [];
  const until = performance.now() + 8000;
  while (performance.now() < until) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/me`, { headers: auth(tc), signal: AbortSignal.timeout(20000) }).catch(() => null);
    times.push({ ms: Math.round(performance.now() - t0), status: r && r.status });
    await sleep(100);
  }
  const worst = Math.max(...times.map(x => x.ms));
  ok("the slow statements did start (the jam is real)", peak >= 5, { peak });
  ok("/me from a third org answered 200 every time", times.every(x => x.status === 200), times.filter(x => x.status !== 200).slice(0, 3));
  ok(`/me stayed under 200 ms the whole time (worst ${worst} ms over ${times.length})`, worst < 200, times.slice(0, 12));
  ok("no planted statement is left running", (await sleeping()) === 0, await sleeping());

  // ── §2 · a caller who waits gets the sentence at the limit ──────────────
  console.log("\n§2 a caller who waits");
  const t0 = performance.now();
  const r = await fetch(`${BASE}/test/slow-sql?s=60`, { headers: auth(ta), signal: AbortSignal.timeout(30000) }).catch(e => ({ status: 0, json: async () => ({ error: e.message }) }));
  const ms = Math.round(performance.now() - t0), body = await r.json().catch(() => ({}));
  ok(`answered 503 with the plain sentence (${r.status} after ${ms} ms)`, r.status === 503 && body.error === "This took too long; try again or narrow it.", body);
  ok("at the limit, not at the sleep's end", ms >= LIMIT_MS - 200 && ms < LIMIT_MS + 2500, ms);
  ok("the statement is gone after it", (await sleeping()) === 0);
  const h = await (await fetch(`${BASE}/health`)).json();
  ok("/health.pool counts the cancels and the timeout", h.pool && h.pool.limits && h.pool.limits.cancelled >= 1 && h.pool.limits.statementTimeouts >= 1, h.pool && h.pool.limits);
})().catch(e => ok("suite ran", false, e.stack)).finally(async () => {
  if (child) { child.kill("SIGTERM"); await new Promise(r => { child.once("exit", r); setTimeout(r, 8000); }); }
  for (const o of ORGS) {
    await q(`DELETE FROM users WHERE org_id = $1`, [o.id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id = $1`, [o.id]).catch(() => {});
  }
  await closeDb();
  summary();
});
