// JOBS-1 · WHAT FOLLOWS A GIFT IS AN EVENT, AND A FAILED STEP IS TRIED AGAIN.
//
// Before JOBS-1, recordGift called its reactions one after another, each in a
// try/catch: when starting a journey threw, the gift saved, the journey never
// started, a line went to the log, and nothing tried again. Now the gift and
// its event are written in one statement (events_outbox) and each reaction is
// a handler on the queue. This proves:
//   §1 a gift recorded while the journey handler throws: the gift saves, the
//      other handlers run, the journey handler is tried again, and after its
//      last try it is listed as stopped (/health → npm run status, and the
//      Admin console's failed jobs). Red on main, where the failure is a log line.
//   §2 the process dies between the gift and the relay: on restart the event
//      runs, and runs once (one job per handler, one draft, the totals healed)
//   §3 every handler run twice gives the same result
//
// Planted (JOBS-1, by hand): the journeys handler catching its own error, as
// recordGift did, turns §1 red ("tried again", "stopped", "listed").
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, waitFor, login, api, BASE, drainQueue } = require("./helpers");
const { civilDay } = require("./clock");

const ROOT = path.join(__dirname, "..");
// A fresh org each run: a gift writes ledger rows an org cannot be deleted past.
const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_jobs1q_${RUN}`, ADMIN = `admin-${RUN}@jobs1q.local`, PW = "loadtest1234";
const HANDLERS = ["thankYouDraft", "sequences", "journeys", "afterChange"];
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const children = [];

// A server of this suite's own, on the suite's database, told what to do.
async function boot(extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", DISABLE_BACKGROUND_TICKS: "1",
      JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
      RESEND_BASE_URL: "http://localhost:9", SENTRY_DSN: "", JOB_POLL_MS: "100", ...extra },
  });
  let log = "";
  child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  const exited = new Promise(res => child.on("exit", code => res(code)));
  children.push(child);
  const up = await waitFor(async () => {
    try { return (await fetch(`http://localhost:${port}/ready`).then(r => r.json())).ready === true; } catch { return false; }
  }, { timeout: 120000, interval: 250 });
  if (!up) { console.error(log.slice(-2000)); throw new Error(`server on :${port} did not start`); }
  return { port, base: `http://localhost:${port}`, child, exited, log: () => log };
}

const eventFor = async (giftId) => (await q(`SELECT * FROM events_outbox WHERE type = 'gift.recorded' AND payload->>'giftId' = $1`, [giftId]))[0];
const jobsFor = (eventId) => q(`SELECT name, key, status, attempts, last_error FROM job_queue WHERE round = $1 ORDER BY name`, [eventId]);
// A failed try waits out its backoff; the test moves that wait to now rather
// than sleeping through it (whichever process holds the job, this one or the
// shard's own server).
const hurry = (key) => q(`UPDATE job_queue SET run_after = NOW() WHERE key = $1 AND status = 'waiting'`, [key]);

async function newDonor(name, email) {
  const id = "d_j1_" + Math.random().toString(36).slice(2, 10);
  await q(`INSERT INTO donors (id, org_id, name, email, kind, created_by, created_by_name) VALUES ($1,$2,$3,$4,'person','system:test','jobs1-outbox')`,
    [id, ORG, name, email]);
  return id;
}

(async () => {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at) VALUES ($1,'Jobs One',$2,1,'active','team','America/New_York',NOW())`, [ORG, `jobs1q-${RUN}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($4,$1,$2,$3,'Rowan Ash','admin')`, [ORG, ADMIN, bcrypt.hashSync(PW, 8), `u_jobs1q_${RUN}`]);
  // A first-gift sequence, so the sequences handler has something to do.
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,tracks) VALUES ($3,$1,'Welcome','first_gift','active',$2::jsonb)`,
    [ORG, JSON.stringify([{ key: "all", label: "Everyone else", rule: "everyone_else" }]), `seq_jobs1q_${RUN}`]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body,track_key) VALUES ($1,$2,0,3,'Welcome','Hi','all')`,
    [`sst_jobs1q_${RUN}`, `seq_jobs1q_${RUN}`]);
  const tok = await login(ADMIN, PW);
  const armed = await api("POST", "/journeys", tok, { presetKey: "new_donor_first_year", enabled: true });
  ok("§0 a first-gift journey is armed", armed.status === 201, armed.status);

  // §1 ─ the journey handler throws (a person @jobs1-fail.test, TEST_MODE only).
  const failing = await newDonor("Wren Halloway", "wren@jobs1-fail.test");
  const g1 = await api("POST", `/donors/${failing}/gifts`, tok, { amount: 250, date: civilDay() });
  ok("§1 the gift saves while its journey handler is failing", g1.status === 201 && g1.body.gift && g1.body.gift.id, g1.status);
  const gift1 = g1.body.gift && g1.body.gift.id;
  const ev1 = await eventFor(gift1);
  ok("§1 its event was written with it", !!ev1 && ev1.org_id === ORG && (ev1.donor_ids || []).includes(failing));
  await drainQueue({ orgId: ORG });
  const [ty1] = await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE gift_id = $1`, [gift1]);
  ok("§1 the other handlers ran: the thank-you is drafted", ty1.n === 1, ty1);
  const [en1] = await q(`SELECT COUNT(*)::int AS n FROM sequence_enrollments WHERE donor_id = $1`, [failing]);
  ok("§1 …and the first-gift sequence enrolled them", en1.n === 1, en1);
  const jKey = `ev:${ev1 && ev1.id}:journeys`;
  const dead = await waitFor(async () => {
    await hurry(jKey);
    const [j] = await q(`SELECT status, attempts, last_error FROM job_queue WHERE key = $1`, [jKey]);
    return j && j.status === "dead" ? j : null;
  }, { timeout: 60000, interval: 100 });
  ok("§1 the journey handler was tried again, five times in all", dead && dead.attempts === 5, dead);
  ok("§1 …and stopped with its error kept", dead && /journey engine is down/.test(dead.last_error || ""), dead);
  const listed = await require("../jobQueue").deadJobs(500);
  ok("§1 it is listed on the Admin console's failed jobs, with its org", listed.some(j => j.name === "handler:journeys" && j.org_id === ORG));
  const health = await waitFor(async () => {
    const h = await fetch(`${BASE}/health`).then(r => r.json()).catch(() => null);
    const s = h && h.queue && Array.isArray(h.queue.stopped) ? h.queue.stopped.find(x => x.name === "journeys") : null;
    return s ? h : null;
  }, { timeout: 30000, interval: 500 });
  ok("§1 /health names it as stopped (what npm run status prints)", !!health, health && health.queue);
  const [plans1] = await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE donor_id = $1`, [failing]).catch(() => [{ n: -1 }]);
  ok("§1 no journey was started for them (the failure is real, not swallowed)", plans1.n === 0, plans1);

  // §2 ─ the process dies between the gift and the relay.
  const crashing = await boot({ JOBS_TEST_CRASH_AFTER_OUTBOX: "1" });
  const survivor = await newDonor("Ilse Marrow", "ilse@jobs1q.example");
  const crashRes = await fetch(`${crashing.base}/donors/${survivor}/gifts`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ amount: 75, date: civilDay() }) }).then(r => r.status).catch(() => "no answer");
  const code = await crashing.exited;
  ok("§2 the process died mid-gift (no answer, exit 86)", crashRes === "no answer" && code === 86, { crashRes, code });
  const [gift2] = await q(`SELECT id FROM gifts WHERE donor_id = $1`, [survivor]);
  ok("§2 the gift was written before it died", !!gift2);
  const ev2 = gift2 && await eventFor(gift2.id);
  ok("§2 …and so was its event, not yet ready and not relayed", ev2 && ev2.ready === false && !ev2.relayed_at, ev2);
  const [before] = await q(`SELECT gift_count FROM donors WHERE id = $1`, [survivor]);
  ok("§2 the person's totals never got the gift (the rollup came after the crash)", Number(before.gift_count || 0) === 0, before);
  await boot({ OUTBOX_STALE_MS: "500", OUTBOX_SWEEP_MS: "250" });
  const ran = await waitFor(async () => {
    const e = await eventFor(gift2.id);
    if (!e || !e.relayed_at) return null;
    const jobs = await jobsFor(e.id);
    return jobs.length && jobs.every(j => j.status === "done") ? jobs : null;
  }, { timeout: 60000, interval: 200 });
  ok("§2 on restart the event was relayed and its handlers ran", !!ran, ran);
  const perHandler = new Map((ran || []).map(j => [j.name, 0]));
  (ran || []).forEach(j => perHandler.set(j.name, perHandler.get(j.name) + 1));
  ok("§2 once: one job per handler", ran && HANDLERS.every(h => perHandler.get(`handler:${h}`) === 1), [...perHandler]);
  const [ty2] = await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE gift_id = $1`, [gift2.id]);
  ok("§2 one thank-you draft", ty2.n === 1, ty2);
  const [after] = await q(`SELECT gift_count, total_giving FROM donors WHERE id = $1`, [survivor]);
  ok("§2 the after-change handler healed the totals", Number(after.gift_count) === 1 && Number(after.total_giving) === 75, after);
  await require("../server/shared/outbox").relay();
  const again = await jobsFor(ev2.id);
  ok("§2 relaying again moves nothing twice", again.length === (ran || []).length, again.length);

  // §3 ─ every handler, run twice: the same result.
  const twice = await newDonor("Tamsin Reed", "tamsin@jobs1q.example");
  const g3 = await api("POST", `/donors/${twice}/gifts`, tok, { amount: 120, date: civilDay() });
  const gift3 = g3.body.gift && g3.body.gift.id;
  const ev3 = await eventFor(gift3);
  await drainQueue({ orgId: ORG, scores: true });
  const snap = async () => {
    const [r] = await q(
      `SELECT (SELECT COUNT(*) FROM thank_you_drafts WHERE gift_id = $2)::int AS drafts,
              (SELECT COUNT(*) FROM sequence_enrollments WHERE donor_id = $1)::int AS enrollments,
              (SELECT COUNT(*) FROM cultivation_plans WHERE donor_id = $1)::int AS journeys,
              (SELECT COUNT(*) FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id WHERE p.donor_id = $1)::int AS steps,
              (SELECT COUNT(*) FROM threads WHERE donor_id = $1 AND closed_at IS NULL)::int AS threads,
              (SELECT COUNT(*) FROM group_crossings WHERE donor_id = $1)::int AS crossings,
              (SELECT row_to_json(x) FROM (SELECT rhythm, drift_state, giving_this_year, largest_gift FROM donor_rhythm WHERE donor_id = $1) x)::text AS rhythm,
              (SELECT gift_count::text || '/' || total_giving::text FROM donors WHERE id = $1) AS totals,
              (SELECT COUNT(*) FROM donor_scores WHERE donor_id = $1)::int AS scores`, [twice, gift3]);
    return r;
  };
  const first = await snap();
  ok("§3 the first run did each thing (a draft, an enrollment, a journey, a thread, a rhythm)",
    first.drafts === 1 && first.enrollments === 1 && first.journeys === 1 && first.threads === 1 && !!first.rhythm, first);
  for (const h of HANDLERS) {
    await q(`INSERT INTO job_queue (id, name, org_id, key, payload, status, run_after, round, created_by, created_by_name)
             VALUES ($1, $2, $3, $4, $5::jsonb, 'waiting', NOW(), $6, 'system:test', 'jobs1-outbox')`,
      [`job_j1_${h}_${Math.random().toString(36).slice(2, 8)}`, `handler:${h}`, ORG, `ev:${ev3.id}:${h}:again`, JSON.stringify({ eventId: ev3.id }), ev3.id]);
  }
  await q(`INSERT INTO job_queue (id, name, org_id, key, payload, status, run_after, created_by, created_by_name)
           VALUES ($1, 'handler:scores', $2, $3, $4::jsonb, 'waiting', NOW(), 'system:test', 'jobs1-outbox')`,
    [`job_j1_scores_${Math.random().toString(36).slice(2, 8)}`, ORG, `scores:${ORG}:again`, JSON.stringify({ orgId: ORG })]);
  await drainQueue({ orgId: ORG, scores: true });
  const ranTwice = await q(`SELECT name, status FROM job_queue WHERE key LIKE $1 OR key = $2`, [`ev:${ev3.id}:%:again`, `scores:${ORG}:again`]);
  ok("§3 each handler ran a second time without failing", ranTwice.length === 5 && ranTwice.every(j => j.status === "done"), ranTwice);
  const second = await snap();
  ok("§3 …and the record is exactly as it was", JSON.stringify(second) === JSON.stringify(first), { first, second });
})().catch(e => { ok("suite ran without throwing", false, e.stack); })
  .finally(async () => {
    for (const c of children) { try { c.kill(); } catch {} }
    await q(`DELETE FROM job_queue WHERE org_id = $1`, [ORG]).catch(() => {});
    await closeDb().catch(() => {});
    summary();
  });
