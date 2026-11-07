// tests/race1-concurrency.test.js · RACE-1. TWO THINGS AT ONCE NEVER LOSE OR
// DOUBLE A STEP, A GIFT OR A TASK.
//
//   §1 THE JOURNEY STEP RACE, HELD. A person in a lower exclusive journey is
//      held at the moment its step's Thread is about to open (raceHold, the
//      plans already read). A higher exclusive journey is applied to them
//      meanwhile. FLAKE-2 saw the end of this in 2 of 30 loaded runs: the
//      lower one opened its Thread after it had been replaced, and the higher
//      one's first step waited with no Thread. RACE1_ROUNDS rounds (100 by
//      default), each must end with the higher journey's first step holding
//      the person's one open Thread.
//   §2 WRITE-ONCE PATHS. The same write fired 10 times at once gives exactly
//      one result (see the sections below).
//
// HOW IT WOULD GO RED: take the per-person lock off the journey start
// (server/shared/journeyStart.js, maybeStartJourney → maybeStartJourneyNow
// directly), and §1 is red on every round: the step is pending, no Thread.
//
// Its own fixture org (org_race1), made-up people, never the demo org.
"use strict";

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api } = require("./helpers");
const { drainQueue } = require("./lib/drainQueue");
const { hold, waiters, until } = require("./lib/raceHold");

const ORG = "org_race1";
const ADMIN = "admin@race1.local";
const ROUNDS = Math.max(1, Number(process.env.RACE1_ROUNDS) || (process.env.CI ? 50 : 100));   // CI: 50 keeps the suite well under 90 s
const t0 = Date.now();

async function freshOrg() {
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Race One Fixture','race-one-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_race1',$1,$2,$3,'Race Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
}

const person = async (id, name) => q(
  `INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
  [id, ORG, name, `${id}@race1.local`]);

async function journeyRace(tok) {
  const mk = (name, priority) => api("POST", "/journeys", tok, { name, trigger: "by_hand", priority, exclusive: true,
    steps: [{ type: "thank", label: `${name} call`, offsetDays: 2 }, { type: "follow_up", label: `${name} visit`, offsetDays: 30 }] });
  const low = await mk("Race Card", 40);
  const high = await mk("Race Monthly", 80);
  ok("§1 two exclusive journeys are made", low.status === 201 && high.status === 201, [low.status, high.status, low.body, high.body]);
  const LOW = low.body.id, HIGH = high.body.id;

  let good = 0;
  const bad = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const who = `d_race1_j${round}`;
    await person(who, `Race Journey ${round}`);
    const hLow = await hold(`journey-open:${who}:${LOW}`);
    const hHigh = await hold(`journey-open:${who}:${HIGH}`);
    let a, b;
    try {
      // A: the lower journey, stopped with its plans read and its Thread not yet open.
      a = api("POST", `/journeys/${LOW}/apply`, tok, { donorIds: [who] });
      await until(async () => (await waiters(q, hLow.key)) === 1);
      // B: the higher one, while A is held. Before the fix it reads A's plan,
      // replaces it (no Thread to hand on yet) and stops at its own open;
      // after it, it waits for A to finish with this person.
      b = api("POST", `/journeys/${HIGH}/apply`, tok, { donorIds: [who] });
      await until(async () => (await waiters(q)) >= 2);
      await hLow.release();
      a = await a;
      await hHigh.release();
      b = await b;
    } finally { await hLow.release(); await hHigh.release(); }

    const plans = await q(`SELECT id, template_id, status FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2`, [ORG, who]);
    const active = plans.filter(p => p.status === "active");
    const [step] = active.length === 1
      ? await q(`SELECT status, thread_id FROM cultivation_plan_steps WHERE plan_id=$1 ORDER BY seq LIMIT 1`, [active[0].id]) : [];
    const open = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, who]);
    const right = a.status === 200 && b.status === 200
      && active.length === 1 && active[0].template_id === HIGH
      && step && step.status === "open" && open.length === 1 && open[0].id === step.thread_id;
    if (right) good++;
    else if (bad.length < 3) bad.push({ round, a: a.status, b: b.status, plans, step, open });
  }
  ok(`§1 the journey race, held, ${ROUNDS} rounds: the higher journey's first step holds the person's one open Thread every time (${good}/${ROUNDS})`,
     good === ROUNDS, bad);
}

const ten = fn => Promise.all(Array.from({ length: 10 }, (_, i) => fn(i)));
const statuses = rs => rs.map(r => r.status).sort().join(",");

// §2a JOURNEY ENROLMENT. Rule: one active plan per person per journey
// (cultivation_plans_one_active_per_journey), and between exclusive journeys,
// one of them. Ten applies of one journey, then ten of two exclusive ones mixed.
async function enrolment(tok) {
  const mk = (name, priority) => api("POST", "/journeys", tok, { name, trigger: "by_hand", priority, exclusive: true,
    steps: [{ type: "thank", label: `${name} call`, offsetDays: 2 }] });
  const A = (await mk("Race Ten A", 50)).body.id, B = (await mk("Race Ten B", 60)).body.id;
  const one = "d_race1_enrol1", two = "d_race1_enrol2";
  await person(one, "Race Enrol One"); await person(two, "Race Enrol Two");
  const rs = await ten(() => api("POST", `/journeys/${A}/apply`, tok, { donorIds: [one] }));
  const plans = await q(`SELECT id, status FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2`, [ORG, one]);
  const open = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, one]);
  ok("§2a ten applies of one journey at once: all answer, one plan, one open Thread",
     rs.every(r => r.status === 200) && plans.length === 1 && open.length === 1, { s: statuses(rs), plans, open });
  const mixed = await ten(i => api("POST", `/journeys/${i % 2 ? A : B}/apply`, tok, { donorIds: [two] }));
  const act = await q(`SELECT template_id FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 AND status='active'`, [ORG, two]);
  const [st] = act.length === 1 ? await q(`SELECT s.status, s.thread_id FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id
                                             WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active' ORDER BY s.seq LIMIT 1`, [ORG, two]) : [];
  const open2 = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, two]);
  ok("§2a ten applies of two exclusive journeys at once: one active, the higher, and its step holds the one open Thread",
     mixed.every(r => r.status === 200) && act.length === 1 && act[0].template_id === B
       && st && st.status === "open" && open2.length === 1 && open2[0].id === st.thread_id, { s: statuses(mixed), act, st, open2 });
}

// §2b A NEXT STEP (FOLLOW-UP). Rule: one open thread per person (threads_one_open);
// the opener's ON CONFLICT is the arbiter. Ten presses: one 201, nine 409.
async function nextStep(tok) {
  const who = "d_race1_thread";
  await person(who, "Race Thread");
  const rs = await ten(i => api("POST", `/donors/${who}/threads`, tok, { label: `Call them back ${i}`, due: "2030-01-15" }));
  const open = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, who]);
  const made = rs.filter(r => r.status === 201);
  ok("§2b ten next steps at once: one open Thread, one 201 that names it, nine 409",
     open.length === 1 && made.length === 1 && made[0].body.thread && made[0].body.thread.id === open[0].id
       && rs.filter(r => r.status === 409).length === 9, { s: statuses(rs), open });
}

// §2c THE NEXT YEARLY TASK. Rule: one next repeat per task
// (tasks_one_repeat_per_parent). A birthday task ticked done ten times at once.
async function yearly(tok) {
  const who = "d_race1_bday";
  await person(who, "Race Birthday");
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,recur,created_by,created_by_name)
           VALUES ('t_race1_bday',$1,'Birthday card for Race Birthday','2030-03-14','medium','donor',0,$2,$3::jsonb,'system:test','test')`,
    [ORG, who, JSON.stringify({ every: "year", month: 3, day: 14, birthday: true })]);
  const rs = await ten(() => api("POST", "/tasks/t_race1_bday/complete", tok, {}));
  const next = await q(`SELECT id, due FROM tasks WHERE org_id=$1 AND recur_parent_id='t_race1_bday'`, [ORG]);
  ok("§2c a yearly birthday task ticked done ten times at once makes ONE next year's task",
     rs.every(r => r.status === 200) && next.length === 1 && String(next[0].due).startsWith("2031-03-14"), { s: statuses(rs), next });
}

// §2d RECEIPT NUMBERS. Rule: one active receipt per gift (receipts_active_gift_uk),
// one active statement per person per year (receipts_active_statement_uk), and a
// number never repeats in an org (receipts_number_once) and is never skipped.
async function receipts(tok) {
  const who = "d_race1_rcpt";
  await person(who, "Race Receipt");
  await q(`UPDATE orgs SET receipts_enabled=true, legal_name='Race One Fixture Inc', receipt_counter=0 WHERE id=$1`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES
             ('g_race1_r1',$1,$2,120,'2025-05-01','system:test','test'), ('g_race1_r2',$1,$2,80,'2025-09-01','system:test','test')`, [ORG, who]);
  const counter = async () => Number((await q(`SELECT receipt_counter FROM orgs WHERE id=$1`, [ORG]))[0].receipt_counter);
  const rs = await ten(() => api("POST", "/gifts/g_race1_r1/receipt", tok, { send: false }));
  const act = await q(`SELECT receipt_number FROM receipts WHERE org_id=$1 AND gift_id='g_race1_r1' AND voided_at IS NULL`, [ORG]);
  const after1 = await counter();
  ok("§2d ten receipts for one gift at once: one receipt, one 201 and nine 409, one number taken",
     act.length === 1 && rs.filter(r => r.status === 201).length === 1 && rs.filter(r => r.status === 409).length === 9 && after1 === 1,
     { s: statuses(rs), act, counter: after1 });
  const ys = await ten(() => api("POST", `/donors/${who}/year-end-statement`, tok, { year: 2025, send: false }));
  const all = await q(`SELECT receipt_number, voided_at FROM receipts WHERE org_id=$1 AND donor_id=$2 AND type='year_end' AND tax_year=2025`, [ORG, who]);
  const after2 = await counter();
  ok("§2d ten year-end statements at once: all answer, one active statement, the other nine superseded",
     ys.every(r => r.status === 201) && all.filter(r => !r.voided_at).length === 1 && all.length === 10, { s: statuses(ys), all });
  const nums = (await q(`SELECT receipt_number FROM receipts WHERE org_id=$1`, [ORG])).map(r => Number(String(r.receipt_number).split("-").pop())).sort((x, y) => x - y);
  ok("§2d receipt numbers never repeat and never skip: 1..11, and the counter says 11",
     nums.length === 11 && nums.every((n, i) => n === i + 1) && after2 === 11, { nums, counter: after2 });
}

// §2e A GIFT, AND WHAT FOLLOWS IT. Rule: one gift per idempotency key
// (uq_gifts_idem), one thank-you draft per gift (thank_you_drafts UNIQUE
// (org_id, gift_id)), one rhythm row per person (donor_rhythm's key), and the
// rhythm written last is the one that read every gift.
async function gifts(tok) {
  const who = "d_race1_gift";
  await person(who, "Race Gift");
  const today = new Date().toISOString().slice(0, 10);
  const rs = await ten(() => api("POST", `/donors/${who}/gifts`, tok, { amount: 40, date: today, idempotencyKey: "race1-same-press" }));
  await drainQueue(q, { orgId: ORG });
  const g = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, who]);
  const drafts = await q(`SELECT gift_id FROM thank_you_drafts WHERE org_id=$1 AND gift_id = ANY($2)`, [ORG, g.map(x => x.id)]);
  ok("§2e one gift pressed ten times at once is one gift, with at most one thank-you draft",
     rs.every(r => r.status < 300) && g.length === 1 && drafts.length <= 1, { s: statuses(rs), g, drafts });
  const more = await ten(i => api("POST", `/donors/${who}/gifts`, tok, { amount: 10 + i, date: today, idempotencyKey: `race1-gift-${i}` }));
  await drainQueue(q, { orgId: ORG });
  const n = await q(`SELECT COUNT(*)::int n, SUM(amount)::numeric s FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, who]);
  const rh = await q(`SELECT giving_this_year FROM donor_rhythm WHERE org_id=$1 AND donor_id=$2`, [ORG, who]);
  const dr = await q(`SELECT COUNT(*)::int n FROM thank_you_drafts d JOIN gifts g ON g.id=d.gift_id WHERE d.org_id=$1 AND g.donor_id=$2`, [ORG, who]);
  ok("§2e ten different gifts at once: eleven gifts, one rhythm row whose this-year figure counts all eleven, never two drafts for one gift",
     more.every(r => r.status < 300) && n[0].n === 11 && rh.length === 1 && Number(rh[0].giving_this_year) === Number(n[0].s) && dr[0].n <= 11,
     { s: statuses(more), n, rh, dr });
}

(async () => {
  await freshOrg();
  const tok = await login(ADMIN);
  await journeyRace(tok);
  await enrolment(tok);
  await nextStep(tok);
  await yearly(tok);
  await receipts(tok);
  await gifts(tok);
  console.log(`race1: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
