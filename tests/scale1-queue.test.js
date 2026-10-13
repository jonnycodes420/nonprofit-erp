// SCALE-1 · two web processes and one worker on one database.
//
// The background work used to be timers inside the one web process, so a
// second replica would have run every job twice. This boots two web
// processes (STEWARD_PROCESS=web) and one worker (STEWARD_PROCESS=worker)
// against the suite's database and proves:
//   §1 a web process runs no job; every job runs exactly once
//   §2 the same key never runs twice at once, and work that arrives while it
//      runs is not lost (it runs after)
//   §3 a job that fails is tried again, stops after five tries, is listed as
//      failed, and runs again when retried
//   §4 one org's flood does not hold up another org's sync
//   §5 the scheduler enqueues a due job once, however many processes ask
//   §6 an OAuth sign-in started on one web process completes on the other
//   §7 a sign-in rate limit is one count across both web processes
//
// The suite's own server (if one is running against the same database) may
// also claim jobs; that is just one more worker, and every assertion holds.
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, waitFor } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const ORG_A = "org_scale1qa", ORG_B = "org_scale1qb";
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const children = [];

async function boot(role, extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), STEWARD_PROCESS: role, TEST_MODE: "1", DISABLE_BACKGROUND_TICKS: "1",
      WORKER_CONCURRENCY: "4", JOB_ORG_CAP: "2", JOB_POLL_MS: "100", JOB_BACKOFF_MS: "50",
      XERO_CLIENT_ID: "scale1-xero-client", XERO_CLIENT_SECRET: "scale1-xero-secret",
      XERO_REDIRECT_URI: "http://localhost:4173/oauth/xero/landing", ...extra },
  });
  let log = "";
  child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  children.push(child);
  const up = await waitFor(async () => {
    try { const r = await fetch(`http://localhost:${port}/health`); return r.ok; } catch { return false; }
  }, { timeout: 90000, interval: 250 });
  if (!up) { console.error(log.slice(-2000)); throw new Error(`${role} on :${port} did not start`); }
  return { port, pid: child.pid, base: `http://localhost:${port}`, log: () => log };
}

async function reset() {
  await q(`DELETE FROM job_queue WHERE name = 'testProbe' OR key LIKE 'scale1q:%'`);
  await q(`DELETE FROM tick_log WHERE name = 'testProbe'`);
  await q(`DELETE FROM job_schedule WHERE name = 'testProbe'`);
}
const enqueue = (rows) => Promise.all(rows.map(r => q(
  `INSERT INTO job_queue (id, name, org_id, key, payload, status, run_after, created_by, created_by_name)
   VALUES ($1,'testProbe',$2,$3,$4::jsonb,'waiting', NOW() + ($5::int * INTERVAL '1 millisecond'),'system:scale1-test','scale1-queue')
   ON CONFLICT (key) WHERE status = 'waiting' DO NOTHING`,
  [`job_s1q_${r.key.replace(/\W/g, "")}_${Math.random().toString(36).slice(2, 8)}`, r.org || null, r.key, JSON.stringify(r.payload || {}), r.delayMs || 0])));
const runs = async () => (await q(`SELECT started_at, finished_at, ok, detail FROM tick_log WHERE name = 'testProbe' ORDER BY started_at`))
  .map(r => ({ ...JSON.parse(r.detail), start: new Date(r.started_at).getTime(), end: new Date(r.finished_at).getTime(), ok: r.ok }));
const settled = (keys) => waitFor(async () => {
  const [r] = await q(`SELECT COUNT(*)::int n FROM job_queue WHERE key = ANY($1) AND status IN ('waiting','running')`, [keys]);
  return r.n === 0;
}, { timeout: 60000, interval: 100 });

(async () => {
  // Fixture: two orgs, an admin in the first.
  await q(`DELETE FROM oauth_states WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  // Sign-in counts are shared and persist now; this suite's own come off first
  // (only TEST_MODE servers run beside it, and they count nothing).
  await q(`DELETE FROM rate_limit_hits WHERE key LIKE 'rl:loginAccountLimiter:%scale1q%' OR key LIKE 'rl:loginIpLimiter:%'`);
  await q(`DELETE FROM users WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await q(`DELETE FROM orgs WHERE id IN ($1,$2)`, [ORG_A, ORG_B]);
  for (const o of [ORG_A, ORG_B])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','UTC')`, [o, `Scale ${o}`, o.replace("org_", "")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_scale1qa',$1,'admin@scale1q.local',$2,'Scale Admin','admin')`,
    [ORG_A, bcrypt.hashSync("loadtest1234", 8)]);
  await reset();

  // The web processes run with the production limiters (no TEST_MODE), so §7
  // counts for real; the worker is the test-mode one, for the probe job.
  const PROD_LIMITS = { TEST_MODE: "", DISABLE_RATE_LIMIT: "" };
  const web1 = await boot("web", PROD_LIMITS), web2 = await boot("web", PROD_LIMITS), worker = await boot("worker");
  const webPids = new Set([web1.pid, web2.pid]);
  ok("§0 three processes up (two web, one worker)", !!(web1.port && web2.port && worker.port));

  // §1 Forty jobs, every key enqueued three times over (as two web replicas
  // and a retry might) while it waits: one row per key, one run per key, and
  // no web process runs any of them. (A copy that arrives while the job RUNS
  // is new work and runs after it: §2.)
  const keys = Array.from({ length: 40 }, (_, i) => `scale1q:one:${i}`);
  await enqueue(keys.flatMap(k => [{ key: k, org: k.endsWith("0") ? ORG_A : ORG_B, delayMs: 1500 }, { key: k, delayMs: 1500 }, { key: k, delayMs: 1500 }]));
  const [w] = await q(`SELECT COUNT(*)::int n FROM job_queue WHERE key = ANY($1)`, [keys]);
  ok("§1 three enqueues of the same key leave one row", w.n === 40, `rows=${w.n}`);
  ok("§1 every job finished", !!await settled(keys));
  let r1 = (await runs()).filter(r => keys.includes(r.key));
  const perKey = new Map(); r1.forEach(r => perKey.set(r.key, (perKey.get(r.key) || 0) + 1));
  ok("§1 each job ran exactly once", r1.length === 40 && [...perKey.values()].every(n => n === 1), `runs=${r1.length}`);
  ok("§1 no web process ran a job", r1.every(r => !webPids.has(r.pid)));
  ok("§1 the worker ran jobs", r1.some(r => r.pid === worker.pid));

  // §2 One key, a slow run, and more work arriving while it runs.
  await reset();
  await enqueue([{ key: "scale1q:same", org: ORG_A, payload: { sleepMs: 800 } }]);
  await waitFor(async () => (await q(`SELECT 1 FROM job_queue WHERE key='scale1q:same' AND status='running'`)).length > 0, { timeout: 10000 });
  await enqueue([{ key: "scale1q:same", org: ORG_A, payload: { sleepMs: 200 } }, { key: "scale1q:same", org: ORG_A, payload: { sleepMs: 200 } }]);
  await settled(["scale1q:same"]);
  const r2 = (await runs()).filter(r => r.key === "scale1q:same");
  ok("§2 the work that arrived mid-run ran after it (two runs, not three)", r2.length === 2, `runs=${r2.length}`);
  ok("§2 the two runs never overlapped", r2.length === 2 && r2[1].start >= r2[0].end - 5, JSON.stringify(r2.map(r => [r.start, r.end])));

  // §3 Fails five times, stops, is listed, and runs again when retried.
  await reset();
  await enqueue([{ key: "scale1q:fail", org: ORG_B, payload: { fail: true } }]);
  const dead = await waitFor(async () => (await q(`SELECT * FROM job_queue WHERE key='scale1q:fail' AND status='dead'`))[0], { timeout: 30000 });
  ok("§3 a failing job stops as dead", !!dead);
  ok("§3 after exactly five tries", dead && dead.attempts === 5, `attempts=${dead && dead.attempts}`);
  ok("§3 its error is kept", dead && /probe told to fail/.test(dead.last_error || ""));
  ok("§3 it ran five times, no more", (await runs()).filter(r => r.key === "scale1q:fail").length === 5);
  const JQ = require("../jobQueue");
  const listed = await JQ.deadJobs(500);
  ok("§3 the Admin console's list shows it with its org", listed.some(j => j.id === dead.id && j.org_id === ORG_B));
  await q(`UPDATE job_queue SET payload = '{}'::jsonb WHERE id = $1`, [dead.id]);   // what an operator fixed
  ok("§3 retry puts it back", !!await JQ.retry(dead.id));
  ok("§3 and it runs and finishes", !!await waitFor(async () => (await q(`SELECT 1 FROM job_queue WHERE id=$1 AND status='done'`, [dead.id])).length > 0, { timeout: 15000 }));

  // §4 Org A floods the queue with thirty slow jobs; org B's one sync, enqueued
  // after them, starts while A is still flooding (the per-org cap keeps lanes free).
  await reset();
  const flood = Array.from({ length: 30 }, (_, i) => ({ key: `scale1q:flood:${i}`, org: ORG_A, payload: { sleepMs: 400 } }));
  await enqueue(flood);
  const tB = Date.now();
  await enqueue([{ key: "scale1q:b-sync", org: ORG_B }]);
  await settled(["scale1q:b-sync"]);
  const bRun = (await runs()).find(r => r.key === "scale1q:b-sync");
  const [{ left }] = await q(`SELECT COUNT(*)::int AS left FROM job_queue WHERE key LIKE 'scale1q:flood:%' AND status IN ('waiting','running')`);
  ok("§4 org B's sync ran while org A's flood was still queued", bRun && left > 0, `floodLeft=${left}`);
  ok("§4 within one flood job's time of being enqueued (not after the flood)", bRun && bRun.start - tB < 1500, `waited=${bRun && bRun.start - tB}ms`);
  await settled(flood.map(f => f.key));

  // §5 Five processes ask the scheduler at once: one enqueue.
  await reset();
  JQ.define("testProbe", { everyMs: 60 * 60 * 1000, firstMs: 0, run: async () => {} });
  await Promise.all(Array.from({ length: 5 }, () => JQ.scheduleDue()));
  await Promise.all(Array.from({ length: 5 }, () => JQ.scheduleDue()));
  await settled(["testProbe"]);
  const r5 = (await runs()).filter(r => r.key === "testProbe");
  ok("§5 ten scheduler passes from one due time: one run", r5.length === 1, `runs=${r5.length}`);

  // §6 OAuth: start on web 1, complete on web 2. The state is verified and
  // spent there (the refusal is about the missing code, which comes AFTER the
  // state check); a second completion finds it spent. No provider is called.
  const login = await (await fetch(`${web1.base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@scale1q.local", password: "loadtest1234" }) })).json();
  const auth = { authorization: `Bearer ${login.token}`, "content-type": "application/json" };
  const start = await (await fetch(`${web1.base}/oauth/xero/start`, { method: "POST", headers: auth, body: "{}" })).json();
  const state = start.url ? new URL(start.url).searchParams.get("state") : null;
  ok("§6 web 1 starts the sign-in", !!state, JSON.stringify(start).slice(0, 200));
  const done1 = await (await fetch(`${web2.base}/oauth/xero/complete`, { method: "POST", headers: auth, body: JSON.stringify({ state }) })).json();
  ok("§6 web 2 recognises web 1's state (refuses only for the missing code)", done1.error === "no_code", JSON.stringify(done1));
  const done2 = await (await fetch(`${web1.base}/oauth/xero/complete`, { method: "POST", headers: auth, body: JSON.stringify({ state }) })).json();
  ok("§6 and the state is single-use across both", done2.error === "state_spent", JSON.stringify(done2));

  // §7 The per-account sign-in limit (6 per 15 minutes) counts across both
  // web processes: alternate wrong passwords between them, and the eleventh is
  // refused although neither process has seen more than three.
  const bad = (base) => fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody-scale1q@scale1q.local", password: "wrong" }) }).then(r => r.status);
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push(await bad(i % 2 ? web2.base : web1.base));
  ok("§7 six attempts across two processes are all answered", statuses.every(s => s !== 429), statuses.join(","));
  const [{ n: hits }] = await q(`SELECT COALESCE(SUM(hits),0)::int AS n FROM rate_limit_hits WHERE key LIKE 'rl:loginAccountLimiter:%nobody-scale1q%'`);
  ok("§7 one shared count of six", hits === 6, `hits=${hits}`);
  ok("§7 the seventh is refused", (await bad(web1.base)) === 429);

  await reset();
  await q(`DELETE FROM oauth_states WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await q(`DELETE FROM users WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
  await q(`DELETE FROM orgs WHERE id IN ($1,$2)`, [ORG_A, ORG_B]);
})().catch(e => { ok("suite ran without throwing", false, e.stack); })
  .finally(async () => {
    for (const c of children) { try { c.kill(); } catch {} }
    await closeDb().catch(() => {});
    summary();
  });
