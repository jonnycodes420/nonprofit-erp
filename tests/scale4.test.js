// SCALE-4 · WHAT FILLS THE POOL, THE NUMBER CHECK OFF THE WEB, A LONG JOB
// NEVER STARVES A SHORT ONE, AND REPLICA ADVICE THAT FITS THE CONNECTIONS.
//
// Guards production stability (the brief allows this suite past the one-new-
// test rule): prod's /ops read "Most database connections in use: 100%" for a
// day and a week, a job waited 39 minutes, and the card advised a second web
// replica that would have needed 58 connections of 40 during a deploy.
//
//   §1 who held the database (server/perf/holders.js): nine planted holders,
//      the card's top 8 are the eight biggest, in order; a request is named by
//      its route pattern (never its path's id); the most held at once.
//   §2 the nightly number check (numberCheck.js): a queued job, never on the
//      web's tick; one org on ONE connection; test orgs skipped at night with
//      their latest check standing; the counts byte-identical to checkOrg's.
//   §3 the job lanes (jobQueue.js): with the long lanes full, a short job
//      still starts at once, and long jobs never take the short lane.
//   §4 the replica advice (connectionBudget.js, capacity.summarize): a second
//      replica that breaks the budget is not advised; the sentence says what
//      comes first. One that fits is advised as before.
//   §5 only live replicas on the card: replicas with no sample in 24 hours fold
//      into one line; their 7-day values still count, only if within 7 days.
//
// PLANTED (each red, then put back): §1 the top list cut at 7; §2 checkOne
// without withPinnedClient (the org took 6 connections at once), and the
// nightly back on bootGate's tick; §3 claimNext's shortOnly always false (the
// short job waited 3 s behind two long ones); §4 summarize ignoring the
// budget; §5 per-replica lines from the 7-day window (27 lines).
const path = require("path");
const { spawn } = require("child_process");
const { ok, summary, q, closeDb, waitFor } = require("./helpers");
const { testNow } = require("./clock");
const HOLD = require("../server/perf/holders");
const CAP = require("../server/perf/capacity");
const BUD = require("../server/perf/connectionBudget");

const ROOT = path.join(__dirname, "..");
const PREFIX = "org_scale4";
const ORGS = [{ id: `${PREFIX}a`, test: false, people: 14 }, { id: `${PREFIX}b`, test: false, people: 3 }, { id: `${PREFIX}t`, test: true, people: 12 }];

async function clean() {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 2; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [`${PREFIX}%`]);
  await q(`DELETE FROM job_queue WHERE name LIKE 'scale4:%'`);
}
async function seed() {
  for (const o of ORGS) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,is_test_org) VALUES ($1,$2,$3,1,'active','team','America/New_York',$4)`,
      [o.id, `Scale Four ${o.id.slice(-1).toUpperCase()}`, o.id.replace("org_", ""), o.test]);
    for (let i = 1; i <= o.people; i++) {
      const d = `${o.id}_d${i}`;
      await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','cultivate','system:test','test')`,
        [d, o.id, `Made Up ${i}`, `made.up.${i}@${o.id}.example`]);
      for (let k = 0; k < 3; k++) {
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','system:test','test')`,
          [`${d}_g${k}`, o.id, d, 25 + i * 10 + k, `202${4 + k}-0${1 + (i % 8)}-1${k}`]);
      }
    }
  }
}

(async () => {
  const now = testNow();
  // ── §1 who held the database ───────────────────────────────────────────
  const { query } = require("../db");
  HOLD.take();   // a clean window
  const planted = [["tick numberCheck", 9], ["job refreshStoredDrift", 8], ["job recomputeScores", 7], ["tick digest feeds", 6], ["job handler:scores", 5],
    ["GET /reports/:key", 4], ["GET /donors", 3], ["tick status page check", 2], ["job processSmartMoves", 1]];
  for (const [name, n] of planted) await HOLD.as(name, () => query(`SELECT pg_sleep(${n * 0.03})`));
  const window = HOLD.take();
  await HOLD.as("job peak probe", () => Promise.all([1, 2, 3].map(() => query(`SELECT pg_sleep(0.05)`))));
  const peakWin = HOLD.take();
  const rows = window.map(r => ({ holder: r.holder, role: "worker", held_ms: r.ms, peak: r.peak, uses: r.uses }));
  const card = HOLD.summarize(rows);
  const want = planted.slice(0, 8).map(p => p[0]);
  ok("§1 the card's top 8 are the eight biggest planted holders, biggest first", JSON.stringify(card.top.map(t => t.holder)) === JSON.stringify(want),
    JSON.stringify(card.top.map(t => [t.holder, t.seconds])));
  ok("§1 the ninth (smallest) is not on it, and only 8 are shown", card.top.length === 8 && !card.top.some(t => t.holder === "job processSmartMoves"));
  ok("§1 the number check is a named holder", card.top.some(t => t.holder === "tick numberCheck" && t.seconds >= 0.2), JSON.stringify(card.top[0]));
  ok("§1 most at once: three reads together under one job is 3", (peakWin.find(r => r.holder === "job peak probe") || {}).peak === 3, JSON.stringify(peakWin));
  // A request is its route's pattern, never its path.
  const LIMITS = require("../server/shared/requestLimits");
  const express = require("express");
  const app = express();
  app.use(LIMITS.middleware(async () => {}));
  app.get("/plant/:personId/thing", async (req, res) => { await query(`SELECT pg_sleep(0.05)`); res.json({ ok: true }); });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  await fetch(`http://localhost:${srv.address().port}/plant/${PREFIX}a_d7/thing`).then(r => r.text());
  srv.close();
  const reqWin = HOLD.take();
  ok("§1 a request is named by its route pattern, with no id in it", reqWin.some(r => r.holder === "GET /plant/:personId/thing" && r.ms >= 40)
    && !reqWin.some(r => r.holder.includes(PREFIX)), JSON.stringify(reqWin));
  // Through the table, as /ops reads it.
  await HOLD.ensureTable(async (sql, p) => q(sql.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })()), p));
  await q(`DELETE FROM capacity_holders WHERE process = 'scale4-test'`);
  for (const r of window) await q(`INSERT INTO capacity_holders (process, role, holder, held_ms, peak, uses) VALUES ('scale4-test','worker',$1,$2,$3,$4)`, [r.holder, r.ms * 1000, r.peak, r.uses]);
  const read = await HOLD.read(query);
  ok("§1 read back from capacity_holders: the planted top holder leads", read.top[0] && read.top[0].holder === "tick numberCheck", JSON.stringify(read.top.slice(0, 3)));
  await q(`DELETE FROM capacity_holders WHERE process = 'scale4-test'`);

  // ── §2 the nightly number check ────────────────────────────────────────
  const fs = require("fs");
  const steps2 = fs.readFileSync(path.join(ROOT, "server/boot/steps-2.js"), "utf8");
  ok("§2 the number check is not on the web's tick", !/everyAfterMigrations\([^\n]*numberCheck/.test(steps2) && !/everyAfterMigrations\([^\n]*nightlyTick/.test(steps2));
  const JQ = require("../jobQueue");
  const NC = require("../numberCheck");
  NC.defineJobs({ define: (n, o) => JQ.define(n, { ...o, run: async () => null }), handle: (n, fn, o) => JQ.handle(n, async () => null, o) }, () => null);
  ok("§2 it is a queued job, a long one (so it runs on the worker, in a long lane)", JQ.isLong("numberCheckNightly") && JQ.isLong("numberCheckOrg"));

  await clean();
  await seed();
  process.env.NUMBER_CHECK_PAUSE_MS = "0";
  const NUM = require("../numbers");
  const { checkOrg, countLine } = require("../scripts/ci/check-numbers");
  const direct = {};
  for (const o of ORGS) direct[o.id] = countLine(await checkOrg(o.id, { screens: NUM.screens, sample: 300 }));
  const ranOn = "2026-11-04";
  HOLD.take();
  const one = await HOLD.as("tick scale4 check", () => NC.checkOne(`${PREFIX}a`, { screens: NUM.screens, ranOn }));
  const held = HOLD.take().find(r => r.holder === "tick scale4 check") || {};
  ok("§2 one org is checked on ONE connection (most at once 1)", held.peak === 1, JSON.stringify(held));
  ok("§2 and its count line is checkOrg's, byte for byte", one.line === direct[`${PREFIX}a`], `${one.line} | ${direct[`${PREFIX}a`]}`);
  // The on-demand check of the test org, then the night.
  await NC.runAll({ screens: NUM.screens, onlyOrg: `${PREFIX}t`, ranOn: "2026-11-03" });
  const night = await NC.runAll({ screens: NUM.screens, ranOn, skipTest: true, orgIds: ORGS.map(o => o.id) });
  const stored = await q(`SELECT org_id, line FROM number_checks WHERE ran_on = $1 AND org_id LIKE $2 ORDER BY org_id`, [ranOn, `${PREFIX}%`]);
  ok("§2 the night checked the real orgs, byte-identical to checkOrg", stored.length === 2 && stored.every(r => r.line === direct[r.org_id]),
    JSON.stringify(stored));
  ok("§2 the test org was not checked at night (no row tonight)", !stored.some(r => r.org_id === `${PREFIX}t`));
  ok("§2 its latest check stands in the digest line", night.lines.includes(direct[`${PREFIX}t`]) && /test orgs: /.test(night.head), night.head);

  // ── §3 a long job never starves a short one ────────────────────────────
  const child = spawn(process.execPath, [path.join(ROOT, "tests/lib/scale4Lanes.js")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, STEWARD_PROCESS: "worker", WORKER_CONCURRENCY: "3", JOB_SHORT_LANES: "1", JOB_POLL_MS: "100", JOB_NO_HANDLER_MS: "86400000", DISABLE_BACKGROUND_TICKS: "1" } });
  let clog = ""; child.stdout.on("data", d => { clog += d; }); child.stderr.on("data", d => { clog += d; });
  try {
    await waitFor(async () => /scale4 lanes ready/.test(clog), { timeout: 30000, interval: 100 });
    const ins = (id, name, payload) => q(`INSERT INTO job_queue (id, name, key, payload, status, run_after, created_by, created_by_name)
      VALUES ($1,$2,$1,$3::jsonb,'waiting',NOW(),'system:test','test')`, [id, name, JSON.stringify(payload)]);
    const RUN = require("crypto").randomBytes(4).toString("hex");   // this run's own rows
    for (let i = 1; i <= 3; i++) await ins(`scale4:${RUN}:long${i}`, "scale4:long", { hold_ms: 3000 });
    await waitFor(async () => (await q(`SELECT COUNT(*)::int AS n FROM job_queue WHERE id LIKE $1 AND status = 'running'`, [`scale4:${RUN}:long%`]))[0].n >= 2, { timeout: 10000, interval: 100 });
    const t0 = Date.now();
    await ins(`scale4:${RUN}:short1`, "scale4:short", {});
    await waitFor(async () => (await q(`SELECT status FROM job_queue WHERE id = $1`, [`scale4:${RUN}:short1`]))[0].status === "done", { timeout: 15000, interval: 50 });
    const waited = Date.now() - t0;
    ok("§3 with the long lanes busy, a short job starts at once (under 1.5 s, the long ones hold 3 s)", waited < 1500, `${waited} ms`);
    await waitFor(async () => (await q(`SELECT COUNT(*)::int AS n FROM job_queue WHERE id LIKE $1 AND status = 'done'`, [`scale4:${RUN}:long%`]))[0].n === 3, { timeout: 20000, interval: 100 });
    const longs = (await q(`SELECT (payload->>'began')::bigint AS b, (payload->>'ended')::bigint AS e FROM job_queue WHERE id LIKE $1`, [`scale4:${RUN}:long%`]));
    const most = Math.max(...longs.map(a => longs.filter(x => x.b < a.e && a.b < x.e).length));
    ok("§3 at most two long jobs at once with three lanes (one kept for short jobs)", most === 2, JSON.stringify(longs));
  } finally { child.kill("SIGTERM"); await q(`DELETE FROM job_queue WHERE name LIKE 'scale4:%'`); }

  // ── §4 the replica advice and the connection budget ────────────────────
  const live = await BUD.readLive(query, { worker: { max: 5, setMax: 1 } });
  ok("§4 Postgres's max_connections is read live", Number.isFinite(live.maxConnections) && live.maxConnections > 0, JSON.stringify(live));
  const prodShape = BUD.budget({ maxConnections: 60, poolerSize: 40, web: { max: 10, setMax: 3 }, worker: { max: 5, setMax: 1 }, replicas: 1 });
  ok("§4 prod's shape: 1 × 13 × 2 + 6 = 32 fits, a second replica (58) does not fit 40",
    prodShape.now === 32 && prodShape.fitsNow && prodShape.next === 58 && !prodShape.fitsNext && prodShape.limit === 40, JSON.stringify(prodShape));
  ok("§4 the web pool that would fit two replicas is 6 (6 + 2, 2 × 8 × 2 + 6 = 38)", prodShape.fitPool === 6 && prodShape.fitPerRequest === 3);
  const sample = (t, o) => ({ at: new Date(t).toISOString(), process: "web-a", role: "web", lagP95: 20, busyPct: 30, reqP95: 200, poolWaitP95: 5, poolPeakPct: 40, queueOldestS: null, failedHour: null, ...o });
  const days = (n, o) => { const out = []; for (let t = now - n * 864e5 + 3e5; t <= now; t += 3e5) out.push(sample(t, o)); return out; };
  const pass = { ok: true, level: "ok", detail: "fine" };
  const blocked = CAP.summarize(days(3, { reqP95: 1500 }), pass, now, prodShape);
  ok("§4 three slow days, but 58 of 40: no replica advised; the sentence says what comes first",
    blocked.advice === "replica-blocked" && !/^Add a second web replica/.test(blocked.sentence) && /58/.test(blocked.sentence) && /DB_POOL_MAX=6/.test(blocked.sentence)
    && /connection pooler/.test(blocked.sentence) && /SCALE-4\.md/.test(blocked.sentence), blocked.sentence);
  const watch = CAP.summarize(days(1, { reqP95: 1500 }), pass, now, prodShape);
  ok("§4 over today only (prod's Nov 15 card): it says a second replica would not fit", watch.advice === "watch-blocked" && /would not fit/.test(watch.sentence), watch.sentence);
  const roomy = BUD.budget({ maxConnections: 200, poolerSize: 100, web: { max: 10, setMax: 3 }, worker: { max: 5, setMax: 1 }, replicas: 1 });
  const fits = CAP.summarize(days(3, { reqP95: 1500 }), pass, now, roomy);
  ok("§4 the same three days with room for 58: add a second web replica, as before", fits.advice === "replica" && fits.sentence === CAP.SAY.replica, fits.sentence);

  // ── §5 only live replicas on the card ──────────────────────────────────
  const fleet = [...days(7, { process: "replica live" })];
  for (let i = 0; i < 26; i++) { const t = now - (2 + (i % 4)) * 864e5 - i * 6e5; fleet.push(sample(t, { process: `replica old${String(i).padStart(2, "0")}`, lagP95: i === 3 || i === 7 ? 400 : 30 })); }
  fleet.push(sample(now - 8 * 864e5, { process: "replica ancient", lagP95: 900 }));
  const folded = CAP.summarize(fleet, pass, now, prodShape);
  const lagLines = folded.lines.filter(l => l.key === "lagP95");
  ok("§5 one line for the live replica and one folded line for the 26 earlier ones", lagLines.length === 2 && lagLines.filter(l => l.folded).length === 1,
    JSON.stringify(lagLines.map(l => l.label)));
  const old = lagLines.find(l => l.folded) || {};
  ok("§5 the folded line says 26 earlier replicas and when they were last seen", /26 earlier replicas, last seen \w{3} \d+, \d+:\d\d [AP]M/.test(old.label || ""), old.label);
  ok("§5 their 7-day value still counts (two ran at 400 ms lag days ago: red)", old.week === 400 && old.weekColour === "red" && old.day == null, JSON.stringify(old));
  ok("§5 a replica last seen 8 days ago counts for nothing", !folded.lines.some(l => /ancient/.test(l.label)) && old.week !== 900);

  await clean();
})().catch(e => ok("suite ran without throwing", false, e.stack))
  .finally(async () => { await closeDb().catch(() => {}); await require("../db").pool?.end?.().catch?.(() => {}); summary(); process.exit(process.exitCode || 0); });
