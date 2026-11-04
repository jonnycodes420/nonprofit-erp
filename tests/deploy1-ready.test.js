// DEPLOY-1 · A DEPLOY WITH NO ERROR WINDOW, AND A QUEUE WITH NOTHING STUCK IN IT.
//
// After two deploys the prod AI smoke got HTTP 500 from Ask, and prod's queue
// held 9 waiting and 8 running jobs, the oldest waiting 15 days. This proves:
//   §1 while a boot step is still running, /ready answers 503 and so does Ask:
//      never a 500, never an answer from a half-booted process
//   §2 a SIGTERM during a slow request: the request completes, then the
//      process exits 0 (red on main: no SIGTERM handler, the socket drops)
//   §3 a SIGTERM while the worker holds a job: the job is handed back and runs
//      exactly once, on the next worker, at once (red on main: it stayed
//      running until the ten-minute reaper)
//   §4 a running job whose worker died, with the same job enqueued again
//      behind it (prod's case): the reaper gives it back and the queued run
//      goes ahead (red on main: one UPDATE broke the one-waiting-per-key index
//      and no stale row was given back again); a failure with a waiting twin
//      is closed into it, not left running (red on main)
//   §5 a job no worker has a handler for is stopped with "No handler for job"
//      once it is past the deploy grace, and a new one is left alone
//   §6 /health's queue.level and `npm run status` turn red for a job that has
//      waited 25 hours, yellow for 2 hours
//   §7 scripts/ops/queue-requeue.js on fixtures: the dry run writes nothing,
//      --apply gives back the expired lease and stops the unrunnable job
//   §8 the worker's heartbeat: /health carries its build and role
//
// POOL-1 (3 Nov: the new web's boot need met a full pooler once, gave up, and
// /ready said 503 until Railway failed the deploy):
//   §9  a boot against a database that answers "max clients reached" for its
//       first 3 s: /ready says "pool (retrying: max clients reached)", turns
//       200 within one backoff step of the connections freeing, and nothing
//       answers a 500 meanwhile (red on main: the database need exited the
//       process and the pool need never tried again); /health has the pool
//   §10 the set-wise pool is out of the same budget (DB_POOL_MAX=5 gives it 1),
//       lets an idle connection go after five minutes (fake timers), and
//       every connection carries application_name and steward.app_connection
//   §11 a job whose query meets EMAXCONNSESSION goes back to waiting with its
//       try not counted, never dead (red on main: its fifth try stopped it)
//   §12 npm run status's db pool line at 70%, 90% and 110% of the pooler
// Planted (POOL-1): the pool need back to a single try turns §9 red.
// Planted (DEPLOY-1, by hand): the gate checking only the database, as on
// main, turns §1 red (Ask answered 200 during the slow step); reapStale back to
// one UPDATE turns §4 red.
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const net = require("net");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, waitFor } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_deploy1q_${RUN}`, EMAIL = `staff-${RUN}@deploy1q.local`, PW = "loadtest1234";
const KEY = (k) => `deploy1q:${RUN}:${k}`;
const QUESTION = "Who are our supporters who run a fundraising page?";
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const children = [];

// The stand-in model: a query plan over peer-to-peer pages, after `delayMs`.
let modelDelayMs = 0;
const model = http.createServer((req, res) => {
  let b = ""; req.on("data", c => { b += c; });
  req.on("end", () => setTimeout(() => {
    let j = {}; try { j = JSON.parse(b); } catch { /* not JSON */ }
    const tool = j.tools && j.tools[0] && j.tools[0].name;
    const input = tool === "query_plan" ? { answerable: true, unsupported: null, entity: "fundraisers", where: [], list: true, measure: { fn: "count" } }
      : { kind: "metric", metric: "nothing_known", unsupported: "unknown" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_d1", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_1", name: tool || "x", input }], usage: { input_tokens: 1, output_tokens: 1 } }));
  }, modelDelayMs));
});

// A process of this suite's own on the suite's database. `wait`: until /ready.
async function boot(extra = {}, { wait = true, script = "server.js" } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [script], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", DISABLE_BACKGROUND_TICKS: "1",
      JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
      RESEND_BASE_URL: "http://localhost:9", SENTRY_DSN: "", JOB_POLL_MS: "100",
      ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: `http://localhost:${model.address().port}`, ...extra },
  });
  let log = "";
  child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  const exited = new Promise(res => child.on("exit", code => res(code)));
  children.push(child);
  const base = `http://localhost:${port}`;
  if (wait) {
    const up = await waitFor(async () => {
      try { return (await fetch(`${base}/ready`).then(r => r.json())).ready === true; } catch { return false; }
    }, { timeout: 120000, interval: 100 });
    if (!up) { console.error(log.slice(-2000)); throw new Error(`${script} on :${port} did not start`); }
  }
  return { port, base, child, exited, log: () => log };
}
const ask = (base, tok) => fetch(`${base}/ask/preview`, { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ text: QUESTION }) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }), e => ({ status: 0, error: e.message }));
const exitWithin = (proc, ms) => Promise.race([proc.exited, sleep(ms).then(() => "still running")]);

// A queue row, written as the queue writes one. Ages are relative to the
// database's NOW(), so they hold on any day at any hour.
async function plant({ id, name = "testProbe", key, status = "waiting", org = ORG, payload = {}, runAfterAgo = "0 seconds",
  createdAgo = "0 seconds", heartbeatAgo = null, attempts = 0 }) {
  await q(`INSERT INTO job_queue (id, name, org_id, key, payload, status, attempts, run_after, created_at, started_at, heartbeat_at,
                                  locked_by, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7, NOW() - $8::interval, NOW() - $9::interval,
                   CASE WHEN $6 = 'running' THEN NOW() - $10::interval END, CASE WHEN $6 = 'running' THEN NOW() - $10::interval END,
                   CASE WHEN $6 = 'running' THEN 'gone-host:1#1' END, 'system:deploy1-test', 'deploy1 test')`,
    [id, name, org, key, JSON.stringify(payload), status, attempts, runAfterAgo, createdAgo, heartbeatAgo || "0 seconds"]);
  return id;
}
const row = async (id) => (await q(`SELECT id, status, attempts, last_error, locked_by FROM job_queue WHERE id = $1`, [id]))[0];
const probeRuns = async (key) => (await q(`SELECT detail FROM tick_log WHERE name = 'testProbe' AND detail::jsonb->>'key' = $1`, [key])).length;

(async () => {
  await new Promise(r => model.listen(0, r));
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Deploy One',$2,1,'active','team','America/New_York',NOW())`, [ORG, `deploy1q-${RUN}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sam Reed','staff')`,
    [`u_deploy1q_${RUN}`, ORG, EMAIL, bcrypt.hashSync(PW, 8)]);

  // ── §1 · the gate holds every route behind every boot step ──────────────
  // One process to sign in on, then stopped; the next one boots with a boot
  // step that takes 4 s (STEWARD_TEST_SLOW_BOOT_MS), and Ask is asked from its
  // first second.
  const first = await boot();
  const tok = (await (await fetch(`${first.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).token;
  ok("§1 signed in", !!tok);
  first.child.kill("SIGTERM");
  ok("§1 the first process exits on SIGTERM", await exitWithin(first, 30000) === 0);

  const slow = await boot({ STEWARD_TEST_SLOW_BOOT_MS: "4000" }, { wait: false });
  const seen = [];
  let readyAt = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 60000) {
    const [r, a] = await Promise.all([
      fetch(`${slow.base}/ready`).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }), () => ({ status: 0 })),
      ask(slow.base, tok)]);
    seen.push({ ready: r.status, waiting: (r.body && r.body.waitingFor) || null, ask: a.status, answered: a.body && a.body.answered });
    if (r.status === 200 && a.status === 200) { readyAt = performance.now() - t0; break; }
    await sleep(100);
  }
  const answered = seen.filter(s => s.ask !== 0);
  ok("§1 Ask was asked while the process was booting", answered.some(s => s.ask === 503), seen.slice(0, 5));
  ok("§1 Ask never answered a 500 (or any 5xx but 503) at boot", answered.every(s => s.ask === 200 || s.ask === 503), answered.filter(s => s.ask !== 200 && s.ask !== 503));
  ok("§1 while /ready said 503, Ask said 503 too (no answer from a half-booted process)",
    answered.filter(s => s.ready === 503).every(s => s.ask === 503), answered.filter(s => s.ready === 503 && s.ask !== 503));
  ok("§1 /ready named the slow step while it ran", seen.some(s => (s.waiting || []).includes("test-slow-step")), seen.map(s => s.waiting).filter(Boolean).slice(0, 4));
  ok("§1 /ready held for the slow step (over 3.5 s after the process started)", readyAt != null && readyAt > 3500, { readyAt });
  ok("§1 then Ask answered", seen.length && seen[seen.length - 1].answered === true, seen[seen.length - 1]);
  slow.child.kill("SIGTERM"); await exitWithin(slow, 30000);

  // ── §2 · SIGTERM during a slow request ──────────────────────────────────
  const web = await boot();
  modelDelayMs = 3000;
  const inFlight = ask(web.base, tok);
  await sleep(1000);
  web.child.kill("SIGTERM");
  const got = await inFlight;
  modelDelayMs = 0;
  ok("§2 the request in flight at SIGTERM completed with its answer", got.status === 200 && got.body.answered === true, got);
  ok("§2 then the process exited 0, inside the grace", await exitWithin(web, 30000) === 0, web.log().slice(-600));
  ok("§2 and said what it did", /\[shutdown\] SIGTERM: no new work; finishing 1 request/.test(web.log()), web.log().slice(-400));

  // ── §3 · SIGTERM while the worker holds a job ───────────────────────────
  const W = { STEWARD_PROCESS: "worker", STEWARD_TEST_PROBE: "1", SHUTDOWN_GRACE_MS: "3000", JOB_REAP_MS: "500" };
  const w1 = await boot(W, { script: "worker.js" });
  const k3 = KEY("held");
  const j3 = await plant({ id: `job_d1q_${RUN}_held`, key: k3, payload: { sleepMs: 8000 } });
  ok("§3 the worker took the job", !!await waitFor(async () => (await row(j3)).status === "running", { timeout: 20000, interval: 100 }));
  w1.child.kill("SIGTERM");
  ok("§3 the worker exited 0 inside its grace", await exitWithin(w1, 15000) === 0, w1.log().slice(-600));
  const back = await row(j3);
  ok("§3 the job it held is waiting again, its try not counted", back.status === "waiting" && back.attempts === 0 && back.locked_by === null, back);
  ok("§3 it said so", /handed back testProbe/.test(w1.log()), w1.log().slice(-400));
  ok("§3 the job had not run", await probeRuns(k3) === 0);
  const w2 = await boot(W, { script: "worker.js" });
  ok("§3 the next worker runs it at once, not ten minutes later", !!await waitFor(async () => (await row(j3)).status === "done", { timeout: 20000, interval: 100 }), await row(j3));
  ok("§3 exactly once", await probeRuns(k3) === 1, await probeRuns(k3));

  // ── §4 · a stale running job with its key enqueued again behind it ─────
  const JQ = require("../jobQueue");
  const k4 = KEY("twin");
  const dead4 = await plant({ id: `job_d1q_${RUN}_stale`, key: k4, status: "running", heartbeatAgo: "20 minutes", runAfterAgo: "20 minutes", attempts: 1 });
  const twin4 = await plant({ id: `job_d1q_${RUN}_twin`, key: k4, payload: {} });
  const k4b = KEY("alone");
  const alone = await plant({ id: `job_d1q_${RUN}_alone`, key: k4b, status: "running", heartbeatAgo: "20 minutes", attempts: 1 });
  let reapErr = null;
  try { await JQ.reapStale(); } catch (e) { reapErr = e.message; }
  ok("§4 the reaper gives back stale rows even when one has a waiting twin", reapErr === null, reapErr);
  ok("§4 the stale row with a twin is closed into it", (await row(dead4)).status === "done", await row(dead4));
  ok("§4 the stale row on its own is waiting again", ["waiting", "running", "done"].includes((await row(alone)).status) && (await row(alone)).locked_by !== "gone-host:1#1", await row(alone));
  ok("§4 the twin that waited behind it runs", !!await waitFor(async () => (await row(twin4)).status === "done", { timeout: 20000, interval: 100 }), await row(twin4));
  ok("§4 the lone one runs too", !!await waitFor(async () => (await row(alone)).status === "done", { timeout: 20000, interval: 100 }), await row(alone));
  // A run that fails while the same key waits behind it.
  const k4c = KEY("fails");
  const failing = await plant({ id: `job_d1q_${RUN}_fails`, key: k4c, payload: { sleepMs: 1500, fail: true } });
  ok("§4 the failing run started", !!await waitFor(async () => (await row(failing)).status === "running", { timeout: 20000, interval: 100 }));
  const behind = await plant({ id: `job_d1q_${RUN}_behind`, key: k4c, payload: {} });
  ok("§4 the failed run is closed into the run waiting for it, not left running",
    !!await waitFor(async () => (await row(failing)).status === "done", { timeout: 20000, interval: 100 }), await row(failing));
  ok("§4 and that run goes ahead", !!await waitFor(async () => (await row(behind)).status === "done", { timeout: 20000, interval: 100 }), await row(behind));

  // ── §5 · a job no worker can run ────────────────────────────────────────
  const gone = await plant({ id: `job_d1q_${RUN}_gone`, name: `deploy1q:renamedAway:${RUN}`, key: KEY("gone"), createdAgo: "1 hour", runAfterAgo: "1 hour" });
  const fresh = await plant({ id: `job_d1q_${RUN}_fresh`, name: `deploy1q:newType:${RUN}`, key: KEY("fresh") });
  ok("§5 a job no worker handles is stopped", !!await waitFor(async () => (await row(gone)).status === "dead", { timeout: 20000, interval: 200 }), await row(gone));
  ok("§5 with its reason", /^No handler for job "deploy1q:renamedAway/.test((await row(gone)).last_error || ""), (await row(gone)).last_error);
  ok("§5 one enqueued a moment ago is left for the deploy grace (the new code may know it)", (await row(fresh)).status === "waiting", await row(fresh));
  await q(`DELETE FROM job_queue WHERE id = $1`, [fresh]);

  // ── §8 · the worker's heartbeat on /health ──────────────────────────────
  const health = await (await fetch(`${w2.base}/health`)).json();
  ok("§8 /health carries the newest worker's heartbeat with its role", health.worker && health.worker.role === "worker", health.worker);
  const [hb] = await q(`SELECT role, handlers FROM process_heartbeats WHERE role = 'worker' AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  ok("§8 the heartbeat lists the job types it runs", hb && hb.handlers.includes("testProbe") && hb.handlers.includes("handler:scores"), hb);
  const [stopped] = await q(`SELECT COUNT(*)::int AS n FROM process_heartbeats WHERE role = 'worker' AND stopped_at IS NOT NULL AND stopped_at > NOW() - INTERVAL '5 minutes'`);
  ok("§8 the worker stopped at SIGTERM said so", stopped.n >= 1);
  w2.child.kill("SIGTERM"); await exitWithin(w2, 15000);

  // ── §6 · the level on /health and in npm run status ─────────────────────
  // Fresh rows (created now: never stopped for want of a handler) whose turn
  // came 25 hours ago and 2 hours ago. refreshHealth reads the whole queue;
  // this suite's rows are the oldest due on the shard's database.
  const S = require("../scripts/ci/status.js");
  const old6 = await plant({ id: `job_d1q_${RUN}_old`, name: `deploy1q:waits:${RUN}`, key: KEY("old"), runAfterAgo: "25 hours" });
  let h = (await JQ.refreshHealth()).queue;
  ok("§6 a job waiting 25 hours: red", h.level === "red" && h.oldestWaiting && h.oldestWaiting.seconds >= 25 * 3600, h);
  ok("§6 the oldest is named by type", h.oldestWaiting && h.oldestWaiting.name === `deploy1q:waits:${RUN}`, h.oldestWaiting);
  const said = S.queueReport(h);
  ok("§6 npm run status says red, with the type and the age", said.level === "red" && /oldest waiting: deploy1q:waits:\w+, 25h/.test(said.detail), said);
  await q(`UPDATE job_queue SET run_after = NOW() - INTERVAL '2 hours' WHERE id = $1`, [old6]);
  h = (await JQ.refreshHealth()).queue;
  ok("§6 two hours: yellow", h.level === "yellow", h);
  ok("§6 the rule itself: an hour and a day are the lines", JQ.queueLevel(3599) === "ok" && JQ.queueLevel(3601) === "yellow"
    && JQ.queueLevel(86399) === "yellow" && JQ.queueLevel(86401) === "red" && JQ.queueLevel(10, 1) === "yellow");
  await q(`DELETE FROM job_queue WHERE id = $1`, [old6]);

  // ── §7 · scripts/ops/queue-requeue.js on fixtures ───────────────────────
  // A heartbeat of a worker that runs testProbe (and every type the shard's
  // server runs), an expired lease, a job no worker can run; --org keeps the
  // script on this suite's rows.
  const [peer] = await q(`SELECT handlers FROM process_heartbeats WHERE stopped_at IS NULL ORDER BY seen_at DESC LIMIT 1`);
  await q(`INSERT INTO process_heartbeats (id, role, build_sha, handlers, started_at, seen_at)
           VALUES ($1, 'worker', 'fixture', $2::text[], NOW() + INTERVAL '1 minute', NOW())`,
    [`deploy1q-fixture-${RUN}`, [...new Set([...(peer ? peer.handlers : []), "testProbe"])]]);
  const exp = await plant({ id: `job_d1q_${RUN}_exp`, key: KEY("exp"), status: "running", heartbeatAgo: "30 minutes", attempts: 5 });
  const orphan = await plant({ id: `job_d1q_${RUN}_orphan`, name: `deploy1q:noSuchJob:${RUN}`, key: KEY("orphan") });
  const script = (args) => execFileSync(process.execPath, ["scripts/ops/queue-requeue.js", `--org=${ORG}`, ...args],
    { cwd: ROOT, env: { ...process.env }, encoding: "utf8" });
  const dry = script([]);
  ok("§7 the dry run lists the expired lease and the unrunnable job", /back to waiting · testProbe/.test(dry) && /stopped: no handler · deploy1q:noSuchJob/.test(dry), dry);
  ok("§7 and writes nothing", (await row(exp)).status === "running" && (await row(orphan)).status === "waiting");
  const applied = script(["--apply"]);
  ok("§7 --apply: the expired lease is waiting again, with one try back", (await row(exp)).status !== "running" && (await row(exp)).locked_by === null, { r: await row(exp), applied });
  ok("§7 --apply: the unrunnable job is stopped with its reason", (await row(orphan)).status === "dead" && /No handler for job/.test((await row(orphan)).last_error), await row(orphan));
  ok("§7 a second dry run finds nothing", /nothing stuck/.test(script([])));
  await q(`DELETE FROM process_heartbeats WHERE id = $1`, [`deploy1q-fixture-${RUN}`]);

  // ── §9 · a boot that meets a full pooler waits it out ───────────────────
  // A stand-in for the pooler in front of the suite's database: for its first
  // 3 s every new connection gets Supavisor's "max clients reached" and is
  // closed; after that it passes connections through.
  const real = new URL(process.env.DATABASE_URL);
  const fullFrame = (() => {
    const field = (t, v) => Buffer.concat([Buffer.from(t), Buffer.from(v + "\0")]);
    const body = Buffer.concat([field("S", "FATAL"), field("V", "FATAL"), field("C", "XX000"),
      field("M", "(EMAXCONNSESSION) max clients reached in session mode, pool_size: 15"), Buffer.from([0])]);
    const head = Buffer.alloc(5); head.write("E", 0); head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  })();
  let refuseUntil = 0, refused = 0;
  const pooler = net.createServer(sock => {
    sock.on("error", () => {});
    if (performance.now() < refuseUntil) { refused++; sock.end(fullFrame); return; }
    const up = net.connect(Number(real.port || 5432), real.hostname);
    up.on("error", () => sock.destroy()); sock.on("close", () => up.destroy());
    sock.pipe(up); up.pipe(sock);
  });
  await new Promise(r => pooler.listen(0, r));
  const viaPooler = new URL(process.env.DATABASE_URL); viaPooler.hostname = "127.0.0.1"; viaPooler.port = String(pooler.address().port);
  refuseUntil = performance.now() + 3000;
  const freesAt = refuseUntil;
  const full = await boot({ DATABASE_URL: viaPooler.toString() }, { wait: false });
  const seen9 = [];
  let ready9 = null, connectedAt = null;
  while (performance.now() - freesAt < 60000) {
    if (connectedAt == null && /\[boot\] pool: connected on try/.test(full.log())) connectedAt = performance.now() - freesAt;
    const [r, h, a] = await Promise.all([
      fetch(`${full.base}/ready`).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }), () => ({ status: 0 })),
      fetch(`${full.base}/health`).then(x => x.status, () => 0),
      ask(full.base, tok)]);
    seen9.push({ at: performance.now() - freesAt, ready: r.status, waiting: (r.body && r.body.waitingFor) || null, health: h, ask: a.status });
    if (r.status === 200) { ready9 = performance.now() - freesAt; break; }
    if (full.child.exitCode != null) break;
    await sleep(100);
  }
  ok("§9 the stand-in pooler turned connections away", refused > 0, { refused });
  ok("§9 the process kept running while the pooler was full", full.child.exitCode == null, full.log().slice(-800));
  ok("§9 /ready said what it waited for: pool (retrying: max clients reached)",
    seen9.some(s => (s.waiting || []).includes("pool (retrying: max clients reached)")), seen9.map(s => s.waiting).filter(Boolean).slice(0, 4));
  ok("§9 each try was logged once", /\[boot\] pool: try 1 failed \(max clients reached\); next in 1 s/.test(full.log())
    && (full.log().match(/\[boot\] pool: try 1 failed/g) || []).length === 1, full.log().slice(0, 1200));
  // Tries at 0, 1, 3, 7 s from boot: the first one after 3 s is at most 4 s
  // (the step then) after the pooler frees; the boot after it takes a moment.
  const connectedOn = Number((full.log().match(/\[boot\] pool: connected on try (\d+)/) || [])[1]);
  ok("§9 the pool connected on the first try after the pooler freed", connectedOn >= 2 && connectedOn <= 4, { connectedOn });
  ok("§9 it connected within one backoff step (4 s then) of the pooler freeing", connectedAt != null && connectedAt <= 4000 + 500, { connectedAt });
  ok("§9 /ready turned 200 once a connection was free", ready9 != null, { ready9, connectedAt, last: seen9.slice(-3) });
  const answered9 = seen9.flatMap(s => [s.ready, s.health, s.ask]).filter(x => x !== 0);
  ok("§9 nothing answered a 500 meanwhile (503 while waiting, never a 5xx but 503)", answered9.every(x => x < 500 || x === 503), seen9.filter(s => [s.ready, s.health, s.ask].some(x => x >= 500 && x !== 503)));
  const h9 = await fetch(`${full.base}/health`).then(r => r.json(), () => ({}));
  ok("§9 /health reports its own pool from pg's counters", h9.pool && h9.pool.max >= 2 && typeof h9.pool.total === "number" && typeof h9.pool.idle === "number"
    && typeof h9.pool.waiting === "number" && h9.pool.set && h9.pool.set.max >= 1 && typeof h9.pool.set.total === "number", h9.pool);
  full.child.kill("SIGTERM"); await exitWithin(full, 30000);
  pooler.close();

  // ── §10 · the set-wise pool's budget, its idle timeout, and the names ───
  const probe10 = execFileSync(process.execPath, ["-e", `
    const { mock } = require("node:test");
    const db = require("./db");
    (async () => {
      const set = db.setPool();
      const [n] = (await set.query("SELECT current_setting('application_name') AS app, current_setting('steward.app_connection') AS mark")).rows;
      const [m] = await db.query("SELECT current_setting('application_name') AS app, current_setting('steward.app_connection') AS mark");
      const out = { setMax: db.SET_POOL_MAX, optMax: set.options.max, idle: set.options.idleTimeoutMillis, set: n, main: m };
      // One more read under fake timers: its idle connection is let go at five minutes, not before.
      await set.end();
      mock.timers.enable({ apis: ["setTimeout"] });
      const p2 = new (require("pg").Pool)(set.options);
      await p2.query("SELECT 1");
      out.openAfterRead = p2.totalCount;
      mock.timers.tick(5 * 60 * 1000 - 1000); out.openAt4m59 = p2.totalCount;
      mock.timers.tick(2000); await new Promise(r => setImmediate(r)); out.openAt5m01 = p2.totalCount;
      mock.timers.reset();
      console.log(JSON.stringify(out)); process.exit(0);
    })().catch(e => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });`],
    { cwd: ROOT, env: { ...process.env, DB_POOL_MAX: "5", STEWARD_PROCESS: "worker", BUILD_SHA: "abc1234def" }, encoding: "utf8" });
  const r10 = JSON.parse(probe10.trim().split("\n").pop());
  ok("§10 DB_POOL_MAX=5 gives the set-wise pool a max of 1", r10.setMax === 1 && r10.optMax === 1, r10);
  ok("§10 its idle connections close after five minutes", r10.idle === 300000 && r10.openAfterRead === 1 && r10.openAt4m59 === 1 && r10.openAt5m01 === 0, r10);
  ok("§10 every connection names its process and build", r10.set && r10.set.app === "steward-worker@abc1234" && r10.main.app === "steward-worker@abc1234", r10);
  ok("§10 and still says it is the application's (the audit trigger reads it)", r10.set && r10.set.mark === "on" && r10.main.mark === "on", r10);
  const budget = (max) => JSON.parse(execFileSync(process.execPath, ["-e", `const d = require("./db"); console.log(JSON.stringify([d.POOL_MAX, d.SET_POOL_MAX])); process.exit(0)`],
    { cwd: ROOT, env: { ...process.env, DB_POOL_MAX: max }, encoding: "utf8" }).trim().split("\n").pop());
  ok("§10 the set-wise share is a third of DB_POOL_MAX, one to three", JSON.stringify([budget("2"), budget("9"), budget("10"), budget("40")]) === JSON.stringify([[2, 1], [9, 3], [10, 3], [40, 3]]));

  // ── §11 · a job that meets a full pooler is tried again, never dead ─────
  const w11 = await boot(W, { script: "worker.js" });
  const j11 = await plant({ id: `job_d1q_${RUN}_full`, key: KEY("full"), payload: { failPoolFull: true }, attempts: 4 });
  ok("§11 the worker ran it and it went back to waiting",
    !!await waitFor(async () => { const r = await row(j11); return r.status === "waiting" && r.last_error; }, { timeout: 20000, interval: 100 }), await row(j11));
  const r11 = await row(j11);
  ok("§11 on what would have been its last try, it is not dead and the try is not counted", r11.status === "waiting" && r11.attempts === 4, r11);
  ok("§11 with the pooler's words as its last error", /EMAXCONNSESSION/.test(r11.last_error || ""), r11.last_error);
  ok("§11 and the worker said so", /found the database pool full \(try 5, not counted\)/.test(w11.log()), w11.log().slice(-600));
  const [hb11] = await q(`SELECT pool FROM process_heartbeats WHERE role = 'worker' AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  ok("§11 the worker's heartbeat carries its pool budget", hb11 && hb11.pool && hb11.pool.max >= 2 && hb11.pool.setMax >= 1, hb11);
  w11.child.kill("SIGTERM"); await exitWithin(w11, 15000);

  // ── §12 · npm run status's db pool line ────────────────────────────────
  const S12 = require("../scripts/ci/status.js");
  const at70 = S12.poolReport({ max: 9, set: { max: 3 } }, { max: 3, setMax: 1 }, 40);
  const at90 = S12.poolReport({ max: 10, set: { max: 3 } }, { max: 8, setMax: 2 }, 40);
  const at110 = S12.poolReport({ max: 13, set: { max: 3 } }, { max: 9, setMax: 3 }, 40);
  ok("§12 70% of the pooler: ok, with the sum", at70.level === "ok" && /2 × 12 \+ 4 = 28 of 40 \(70%\)/.test(at70.detail) && !/lower/.test(at70.detail), at70);
  ok("§12 90%: yellow, and which number to lower", at90.level === "yellow" && /36 of 40 \(90%\)/.test(at90.detail) && /lower DB_POOL_MAX on the web to 8/.test(at90.detail), at90);
  ok("§12 110%: red, and which number to lower", at110.level === "red" && /44 of 40 \(110%\)/.test(at110.detail) && /lower DB_POOL_MAX on the web to 8/.test(at110.detail)
    && /a deploy can run out of connections/.test(at110.detail), at110);
  ok("§12 the line says so when the worker's numbers are not in yet", S12.poolReport({ max: 10, set: { max: 3 } }, null, 40).level === null);
})().catch(e => { ok("suite ran without throwing", false, e.stack); })
  .finally(async () => {
    for (const c of children) { try { c.kill("SIGKILL"); } catch { /* gone */ } }
    model.close();
    await q(`DELETE FROM job_queue WHERE key LIKE $1`, [`deploy1q:${RUN}:%`]).catch(() => {});
    await q(`DELETE FROM tick_log WHERE name = 'testProbe' AND detail::jsonb->>'key' LIKE $1`, [`deploy1q:${RUN}:%`]).catch(() => {});
    await q(`DELETE FROM user_sessions WHERE user_id = $1`, [`u_deploy1q_${RUN}`]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id = $1`, [ORG]).catch(() => {});
    await q(`DELETE FROM ai_usage WHERE org_id = $1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id = $1`, [ORG]).catch(() => {});
    await closeDb().catch(() => {});
    summary();
  });
