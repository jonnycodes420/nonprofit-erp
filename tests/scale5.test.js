// SCALE-5 · smart moves stop holding the pool, and background sweeps skip orgs
// nobody uses. Prod's /ops on 17 Nov: processSmartMoves held 56.6% of the
// database's connection time and the queue's own claims, beats and reaps 25.3%.
//
//   §1 live orgs only: an archived org, a test org and a fixture are not live;
//      a customer, a demo and CREO (by id) are. A tick and the nightly move
//      nobody in an archived org.
//   §2 smart moves for what changed: a scripted day of writes, run the old way
//      (every org from scratch after each write) and the new way (the
//      change-driven tick), gives byte-identical moves and stages. An org that
//      did not change is not worked on the five-minute tick; the nightly pass
//      finds what only the date moved.
//   §3 every per-org background sweep reads the live-org list (a source check
//      over each sweep's function).
//   §4 the queue: a claim is ONE statement, an empty queue is asked less and
//      less often (not every second per lane), and a new row wakes the worker
//      at once.
//
// Planted (each red before it was trusted; see docs/history/SCALE-5.md):
//   §1 isLiveOrg ignoring archived_at · §2 changedSince returning every org ·
//   §3 dataHealth's nightly without liveOrgIds · §4 the old three-statement
//   claim transaction, and a poller that never backs off.
"use strict";
process.env.TEST_MODE = "1";
process.env.LIVE_ORGS_TTL_MS = "0";
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, waitFor, login, api, civilPlusDays } = require("./helpers");
const { testNow } = require("./clock");

const ROOT = path.join(__dirname, "..");
const P = "org_scale5";
const A = `${P}old`, B = `${P}new`, X = `${P}arch`, F = `${P}fix`;
const ORG_KIND = require("../orgKind");
const SMART = require("../server/smartMoves");
const MARKS = require("../server/smartMoves/marks");
const LIVE = require("../server/orgs/liveOrgs");

async function clean() {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 2; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [`${P}%`]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [`${P}%`]);
  await q(`DELETE FROM smart_move_state WHERE k LIKE 'scale5%'`).catch(() => {});
  await q(`DELETE FROM smart_move_sweeps WHERE org_key LIKE $1`, [`${P}%`]).catch(() => {});
  await q(`DELETE FROM job_queue WHERE name LIKE 'scale5:%'`);
}
async function seedOrg(id, kind, { archived = false } = {}) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,org_kind,archived_at)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',$4,$5)`,
    [id, `Scale Five ${id.slice(P.length)}`, id.replace("org_", ""), kind, archived ? new Date(testNow()) : null]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
    [`u_${id}`, id, `admin@${id.replace(/_/g, "-")}.example`, bcrypt.hashSync("loadtest1234", 10)]);
}
const OLD = civilPlusDays(-400), RECENT = civilPlusDays(-30);
async function person(org, n, stage, last, giftCount = 2) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,gift_count,total_giving,last_gift_date,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'new',$5,$6,100,$7,'system:test','test')`,
    [`${org}_${n}`, org, `Made Up ${n}`, `${n}@${org.replace(/_/g, "-")}.example`, stage, giftCount, last]);
}
// The moves and stages of an org, its own prefix taken off, so two orgs compare.
async function shape(org) {
  const moves = await q(`SELECT substring(donor_id from $2::int) AS who, from_stage, to_stage, description FROM moves WHERE org_id = $1 ORDER BY who, created_at, to_stage`, [org, org.length + 2]);
  const stages = await q(`SELECT substring(id from $2::int) AS who, stage FROM donors WHERE org_id = $1 ORDER BY who`, [org, org.length + 2]);
  return JSON.stringify({ moves, stages });
}

(async () => {
  await clean();
  const { query, run } = require("../db");

  // ── §1 live orgs only ───────────────────────────────────────────────────
  ok("§1 the rule: archived is never live, whatever its kind", !ORG_KIND.isLiveOrg({ id: "x", org_kind: "customer", archived_at: new Date(testNow()) }));
  ok("§1 internal test and fixture are not live; customer, prospect trial and demo are",
    !ORG_KIND.isLiveOrg({ id: "x", org_kind: "internal_test" }) && !ORG_KIND.isLiveOrg({ id: "x", org_kind: "fixture" })
    && ["customer", "prospect_trial", "demo"].every(k => ORG_KIND.isLiveOrg({ id: "x", org_kind: k })));
  ok("§1 CREO is kept by id, as ADMIN-CLEAN keeps it", ORG_KIND.isLiveOrg({ id: "org_creo", org_kind: "fixture" }));
  ok("§1 a kind not set is inferred: a name like 's' is a test, not live", !ORG_KIND.isLiveOrg({ id: "x", name: "s" }, { users: [{ email: "someone@realcharity.org" }] }));

  await seedOrg(A, "customer"); await seedOrg(B, "customer"); await seedOrg(X, "customer", { archived: true }); await seedOrg(F, "fixture");
  const live = await LIVE.liveOrgIds(query, { fresh: true });
  ok("§1 liveOrgIds: the customers in, the archived org and the fixture out", live.includes(A) && live.includes(B) && !live.includes(X) && !live.includes(F),
    JSON.stringify(live.filter(i => i.startsWith(P))));
  for (const o of [X, F]) await person(o, "lapsing", "cultivate", OLD);

  const tok = {};
  for (const o of [A, B, X, F]) tok[o] = await login(`admin@${o.replace(/_/g, "-")}.example`);
  const lapseVia = (org) => api("POST", "/pipeline/run-auto-lapse", tok[org]).then(r => { if (r.status !== 200) throw new Error(`run-auto-lapse ${org}: ${r.status}`); return r.body.moved; });
  const deps = { query, run, autoLapseOrg: lapseVia, orgClock: require("../orgTime").orgClock };
  const tickB = () => SMART.tick(deps, { onlyOrgs: [B, X, F], markKey: "scale5" });

  const first = await tickB();
  ok("§1 the tick never works an archived or a fixture org", !first.worked.includes(X) && !first.worked.includes(F), JSON.stringify(first.worked));
  await SMART.nightly(deps, { force: true, onlyOrgs: [X, F] });
  const still = await q(`SELECT stage FROM donors WHERE org_id = ANY($1) ORDER BY id`, [[X, F]]);
  ok("§1 nor does the nightly: their people are where they were", still.length === 2 && still.every(r => r.stage === "cultivate"), JSON.stringify(still));

  // ── §2 smart moves for what changed: a scripted day, both ways ─────────
  // A is the old sweep (every org from scratch after each write); B is the tick.
  // Before each write the org is settled (a tick that worked it found nothing
  // more), so the write itself is what the next tick must notice.
  const settle = async () => { for (let i = 0; i < 8; i++) if (!(await tickB()).worked.includes(B)) return true; return false; };
  const both = async (fn) => { await settle(); await fn(A); await fn(B); };
  const step = async (label) => {
    await lapseVia(A);
    const t = await tickB();
    const [sa, sb] = [await shape(A), await shape(B)];
    ok(`§2 ${label}: the tick's moves are the old sweep's, byte for byte`, sa === sb, `${sa}\n${sb}`);
    return t;
  };
  await both(async o => {
    await person(o, "d1", "cultivate", OLD);         // lapses at the first pass
    await person(o, "d2", "steward", RECENT);        // recent: stays
    await person(o, "d3", "cultivate", OLD);         // held by an open ask
    await q(`INSERT INTO opportunities (id,org_id,donor_id,name,status) VALUES ($1,$2,$3,'Ask','open')`, [`${o}_opp3`, o, `${o}_d3`]);
    await person(o, "d4", "cultivate", OLD);         // held by an officer's move after the last gift
    await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description) VALUES ($1,$2,$3,'u_x','An Officer','qualify','cultivate','Moved by hand')`,
      [`${o}_mv4`, o, `${o}_d4`]);
  });
  await step("after the morning's writes");
  await both(o => q(`UPDATE opportunities SET status='closed', closed_at=NOW() WHERE id=$1`, [`${o}_opp3`]));
  await step("an ask is closed");
  await both(o => q(`UPDATE donors SET last_gift_date=$2 WHERE id=$1`, [`${o}_d2`, OLD]));
  await step("a recent gift is refunded away");
  await both(o => q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ($1,$2,$3,500,$4,'open')`, [`${o}_pl1`, o, `${o}_d1`, civilPlusDays(60)]));
  await step("a pledge comes in for someone lapsed");
  await both(o => person(o, "d5", "steward", OLD, 1));
  await step("a new person arrives already lapsing");

  // An org that did not change is not worked. (Its own moves are a change, so
  // the tick after one that moved somebody looks once more, and finds nothing.)
  // Another suite's open transaction can hold the kept mark back for a tick or
  // two (a write is "since" until every older transaction has ended), so this
  // allows a few; with every org worked every tick it never comes.
  let quiet = null;
  for (let i = 0; i < 8 && (!quiet || quiet.worked.includes(B)); i++) quiet = await tickB();
  ok("§2 an unchanged org is not worked on the five-minute tick", !quiet.worked.includes(B), JSON.stringify(quiet.worked));
  // What only the date moves: a lapse with no write behind it. Planted as a
  // person written before the tick's kept mark, so the tick treats it as seen.
  await both(o => person(o, "d6", "cultivate", OLD));
  await MARKS.keepMark(run, (await q(`SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS m`))[0].m, "scale5");
  const dateOnly = await tickB();
  const d6 = async o => (await q(`SELECT stage FROM donors WHERE id=$1`, [`${o}_d6`]))[0].stage;
  ok("§2 the tick leaves what no write moved", !dateOnly.worked.includes(B) && await d6(B) === "cultivate", JSON.stringify(dateOnly));
  const night = await SMART.nightly(deps, { force: true, onlyOrgs: [B] });
  await lapseVia(A);
  ok("§2 the nightly sweep finds it", night.swept.includes(B) && await d6(B) === "lapsed", JSON.stringify(night));
  ok("§2 and at the end of the day both ways agree, byte for byte", await shape(A) === await shape(B));
  const auto = await q(`SELECT to_stage, COUNT(*)::int AS n FROM moves WHERE org_id=$1 AND officer_id IS NULL GROUP BY to_stage ORDER BY to_stage`, [B]);
  ok("§2 the day really moved people both ways (lapsed and back to Stewardship)", JSON.stringify(auto) === JSON.stringify([{ to_stage: "lapsed", n: 5 }, { to_stage: "steward", n: 1 }]), JSON.stringify(auto));
  const [sw] = await q(`SELECT swept_on FROM smart_move_sweeps WHERE org_key=$1`, [B]);
  ok("§2 the nightly records the org's day, so it runs once a night", sw && /^\d{4}-\d\d-\d\d$/.test(sw.swept_on), JSON.stringify(sw));
  const again = await SMART.nightly(deps, { onlyOrgs: [B], now: new Date(testNow()) });
  ok("§2 outside its quiet hours, or swept already today, the nightly passes it by", !again.swept.includes(B) || (() => { const h = require("../orgTime").orgClock({ timezone: "America/New_York" }).hour; return h >= SMART.NIGHT_FROM && h < SMART.NIGHT_TO && sw.swept_on !== require("../orgTime").orgClock({ timezone: "America/New_York" }).date; })(), JSON.stringify(again));

  // ── §3 every per-org background sweep reads the live-org list ──────────
  const src = f => fs.readFileSync(path.join(ROOT, f), "utf8");
  const body = (text, name) => {
    const i = text.search(new RegExp(`(async )?function ${name}\\(`));
    if (i < 0) return null;
    const next = text.slice(i + 10).search(/\n(async )?function |\n\/\/ SPLIT-2 end/);
    return text.slice(i, next < 0 ? undefined : i + 10 + next);
  };
  const SWEEPS = [
    ["routes/jobs.js", "processDigests"], ["routes/jobs.js", "processThreadNudges"], ["routes/jobs.js", "processStepReminders"],
    ["routes/jobs.js", "snapshotAllOrgMetrics"], ["routes/jobs.js", "fanOutMailboxes"],
    ["server/boot/helpers-1.js", "refreshStoredDrift"], ["server/boot/helpers-1.js", "recomputeAllScores"],
    ["server/boot/helpers-2.js", "processPledgeInstallmentReminders"], ["server/boot/helpers-3.js", "processGrantMilestones"],
    ["server/boot/helpers-6.js", "processWorkflowSweeps"], ["server/boot/helpers-7.js", "processPledgeReminders"],
    ["server/boot/helpers-8.js", "processMembershipRenewals"], ["server/outreach/helpers.js", "runJourneySweep"],
    ["server/reports/storedReports.js", "nightly"], ["routes/dataHealth.js", "runDataHealthNightly"],
    ["numberCheck.js", "nightlyTick"], ["server/smartMoves/index.js", "liveOnboarded"],
  ];
  const missing = SWEEPS.filter(([f, n]) => { const b = body(src(f), n); return !b || !/liveOrgIds\(/.test(b); });
  ok(`§3 each of the ${SWEEPS.length} per-org background sweeps reads liveOrgIds`, missing.length === 0, JSON.stringify(missing));
  ok("§3 processSmartMoves goes through the change-driven tick", /SMART\.tick\(/.test(body(src("routes/jobs.js"), "processSmartMoves") || ""));

  // ── §4 the queue's own bookkeeping ─────────────────────────────────────
  const JQ = require("../jobQueue");
  const { countRoundTrips } = require("../server/db/query");
  JQ.handle("scale5:claimed", async () => {});
  await q(`INSERT INTO job_queue (id, name, org_id, key, status, run_after, created_by, created_by_name)
           VALUES ('scale5:c1','scale5:claimed',$1,'scale5:c1','waiting',NOW(),'system:test','test')`, [A]);
  // The claim takes the suite's row only: the suite's process handles no other type... and the
  // shard server's handlers are not this process's, so `names` is this process's set.
  const names = [...new Set(["scale5:claimed"])];
  const { result: got, trips } = await countRoundTrips(() => JQ.claim());
  ok("§4 a claim is one statement", trips === 1, `trips=${trips}`);
  ok("§4 and it claims the row (running, its try counted, a lease)", got && got.id === "scale5:c1" && got.status === "running" && got.attempts === 1 && /#\d+$/.test(got.locked_by || ""), JSON.stringify(got));
  const { result: none, trips: emptyTrips } = await countRoundTrips(() => JQ.claim());
  ok("§4 an empty claim is one statement too", none === null && emptyTrips === 1, `trips=${emptyTrips}`);
  void names;

  // The wake is opt-in (JOB_WAKE=on, server/jobs/wake.js): its trigger is built
  // for this check and dropped after, as a boot without JOB_WAKE=on does.
  const WAKE = require("../server/jobs/wake");
  process.env.JOB_WAKE = "on"; await WAKE.ensureWakeTrigger(require("../server/db/pool").pool);
  const child = spawn(process.execPath, [path.join(ROOT, "tests/lib/scale5Idle.js")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, STEWARD_PROCESS: "worker", WORKER_CONCURRENCY: "4", JOB_WAKE: "on", JOB_POLL_MS: "100", JOB_POLL_MAX_MS: "4000", JOB_NO_HANDLER_MS: "86400000", DISABLE_BACKGROUND_TICKS: "1", JOB_REAP_MS: "60000" } });
  let clog = ""; child.stdout.on("data", d => { clog += d; }); child.stderr.on("data", d => { clog += d; });
  try {
    await waitFor(async () => /scale5 idle ready/.test(clog), { timeout: 30000, interval: 100 });
    await new Promise(r => setTimeout(r, 8000));   // eight idle seconds
    child.stdin.write("stats\n");
    await waitFor(async () => /STATS /.test(clog), { timeout: 5000, interval: 50 });
    const st = JSON.parse(clog.match(/STATS (.*)/)[1]);
    // Before: four lanes asking every 100 ms = ~320 asks in 8 s. Now one lane, 100 → 4,000 ms.
    // Timed asks only: another suite's new rows in a shared database wake it too (that is the point).
    ok("§4 an empty queue is asked by one lane, backing off (under 40 timed asks in 8 s, was ~320)", st.timedPolls < 40, JSON.stringify(st));
    ok("§4 the worker listens for new rows", st.listening === true, JSON.stringify(st));
    await q(`INSERT INTO job_queue (id, name, key, status, run_after, created_by, created_by_name)
             VALUES ('scale5:wake','scale5:probe','scale5:wake','waiting',NOW(),'system:test','test')`);
    await waitFor(async () => (await q(`SELECT status FROM job_queue WHERE id='scale5:wake'`))[0].status === "done", { timeout: 10000, interval: 25 });
    // Both ends from the database's own clock: the row's insert and its run's start.
    const [w] = await q(`SELECT (payload->>'began')::bigint - (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS waited FROM job_queue WHERE id='scale5:wake'`);
    const waited = Number(w.waited);
    ok("§4 a new row wakes the idle worker at once (under 1 s; its poll was up to 4 s)", waited < 1000, `${waited} ms`);
  } finally { child.kill("SIGTERM"); delete process.env.JOB_WAKE; await WAKE.ensureWakeTrigger(require("../server/db/pool").pool).catch(() => {}); }
  ok("§4 without JOB_WAKE=on no wake trigger is left on job_queue (the measured default)",
    (await q(`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'job_queue_wake%'`))[0].n === 0);

  await clean();
})().catch(e => ok("suite ran without throwing", false, e.stack))
  .finally(async () => { await closeDb().catch(() => {}); await require("../db").pool?.end?.().catch?.(() => {}); summary(); process.exit(process.exitCode || 0); });
