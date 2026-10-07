// tests/journeys3-triggers.test.js · JOURNEYS-3. JOURNEYS START THEMSELVES,
// A PERSON CAN BE IN SEVERAL, AND NOBODY GETS TWO TOUCHES IN ONE WEEK.
//
//   §1 THE NEW TRIGGERS. One ready-made journey per trigger, made from its
//      preset and switched on: membership ending in 30 days, membership
//      lapsed, monthly gift failed, monthly gift cancelled, card expiring next
//      month, volunteer hours milestone, first event, grant awarded, and a
//      peer-to-peer page reaching its goal. Each has one fixture person whose
//      record makes it true. The journey sweep (the hourly look, run now)
//      enrols each of them in the right journey once; the first step is open
//      on their Thread, and a step that names an email starter is a review
//      draft, never a send. Running the sweep again enrols nobody twice. The
//      first event fires from the real attendance route.
//   §2 SEVERAL JOURNEYS AT ONCE. A person in two journeys that are not
//      exclusive gets steps from both, and no two steps from different
//      journeys land within the org's touch gap (7 days). The higher-ranked
//      one keeps its dates; the other step moves and says why. Their profile
//      lists both. Two exclusive journeys still block: the failed-card person
//      also has a card expiring next month, and is in only the higher one.
//   §3 COUNTED HONESTLY, AND UNDONE EXACTLY (the Harborlight walk, items 6 to
//      8). Before the click: who qualifies, who will join, who is already in
//      it, who stays in a journey that ranks higher, who is in another one.
//      The apply puts in exactly the number on the button; How it is going
//      matches the people enrolled straight after, and again after Undo, which
//      also puts back the step another journey moved to make room.
//   §4 THE SCREEN. The apply result is the shared Undo toast, never a
//      browser box (an alert blocks React from drawing the new counts, which
//      is why How it is going read 0 behind it).
//
// HOW IT WOULD GO RED: a trigger that never fires or fires twice (§1); the
// one-journey-per-person rule left in place (§2 "steps from both"); spacing
// skipped (§2 "never two in a week"); an apply that recounts differently from
// the offer (§3 "joined = the number on the button"); an Undo that leaves
// steps, threads or moved dates behind (§3 after Undo); the alert box (§4).
//
// PROVEN ABLE TO FAIL: run against main (15284bd) this suite fails §1 (no
// such triggers or presets), §2, §3 and §4. On this branch, planting
// `return []` at the top of spaceTouches turns §2 "never two touches inside a
// week" red; planting `joinOthers` ignored in applySplit turns §3 red.
//
// Its own fixture org (org_j3trig), never the demo org.

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, q, closeDb, login, api, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_j3trig";
const ADMIN = "admin@j3trig.local";
const T = civilToday();
const P = id => `d_j3_${id}`;
const day = s => Math.round(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / 86400000);

(async () => {
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Journeys Three Fixture','journeys-three-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_j3trig',$1,$2,$3,'Journeys Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const people = ["ending", "lapsed", "failed", "cancelled", "card", "hours", "event", "funder", "p2p",
                  "two", "g1", "g2", "g3", "g4"];
  for (const id of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
      [P(id), ORG, `J3 ${id[0].toUpperCase() + id.slice(1)}`, `${id}@j3trig.local`]);
  }
  const tok = await login(ADMIN);

  // ── the records that make each trigger true ──────────────────────────────
  await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term) VALUES ('mbl_j3',$1,'Friend',50,0,'12_months')`, [ORG]);
  await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status) VALUES
             ('m_j3_end',$1,$2,'mbl_j3',$4,$4,$5,'active'), ('m_j3_lap',$1,$3,'mbl_j3',$6,$6,$7,'lapsed')`,
    [ORG, P("ending"), P("lapsed"), civilPlusDays(-345), civilPlusDays(20), civilPlusDays(-370), civilPlusDays(-5)]);
  const [y, mo] = T.slice(0, 7).split("-").map(Number);
  const nextY = mo === 12 ? y + 1 : y, nextM = mo === 12 ? 1 : mo + 1;
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,first_failed_at,last_failed_at,card_exp_year,card_exp_month) VALUES
             ('rs_j3_fail',$1,$2,'sub_j3_fail',25,'month','past_due',NOW(),NOW(),$4,$5),
             ('rs_j3_card',$1,$3,'sub_j3_card',25,'month','active',NULL,NULL,$4,$5)`,
    [ORG, P("failed"), P("card"), nextY, nextM]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,canceled_at) VALUES
             ('rs_j3_cancel',$1,$2,'sub_j3_cancel',25,'month','canceled',NOW())`, [ORG, P("cancelled")]);
  await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,via,created_by,created_by_name) VALUES
             ('vs_j3_a',$1,$2,$3,8,'Mentor','test','system:test','test'), ('vs_j3_b',$1,$2,$4,5,'Mentor','test','system:test','test')`,
    [ORG, P("hours"), civilPlusDays(-60), T]);
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,awarded_at,funder_donor_id) VALUES ('gr_j3',$1,'J3 Funder','Youth',10000,'awarded',NOW(),$2)`, [ORG, P("funder")]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title) VALUES ('gp_j3',$1,'j3-page','J3 Page')`, [ORG]);
  await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,personal_goal_amount,status,person_id) VALUES ('pf_j3',$1,'gp_j3','J3 P2p','p2p@j3trig.local','j3-p2p',100,'active',$2)`, [ORG, P("p2p")]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,peer_fundraiser_id,created_by,created_by_name) VALUES ('g_j3_p2p',$1,$2,150,$3,'pf_j3','system:test','test')`, [ORG, P("two"), T]);

  // ── §1 THE NEW TRIGGERS, FROM THEIR READY-MADE JOURNEYS ─────────────────────
  const cat = await api("GET", "/journeys", tok);
  const WANT = { membership_ending: "ending", membership_lapsed: "lapsed", recurring_failed: "failed",
    recurring_cancelled: "cancelled", card_expiring: "card", volunteer_hours: "hours", first_event: "event",
    grant_awarded: "funder", p2p_goal: "p2p" };
  const jid = {};
  for (const key of Object.keys(WANT)) {
    ok(`§1 "${key}" is a trigger with a ready-made journey`, (cat.body.triggers || []).some(t => t.key === key)
       && (cat.body.presets || []).some(p => p.key === key && p.trigger === key), key);
    const made = await api("POST", "/journeys", tok, { presetKey: key });
    ok(`§1 the "${key}" journey is made from its preset, and arrives off`, made.status === 201 && made.body.enabled === false, JSON.stringify(made.body).slice(0, 200));
    jid[key] = made.body.id;
    const starters = (made.body.steps || []).filter(s => s.draft);
    const preset = (cat.body.presets || []).find(p => p.key === key) || { steps: [{ starter: "missing" }] };
    ok(`§1 "${key}": every email step drafts from the org's own copy of its EMAIL-1 email`,
       starters.length === preset.steps.filter(s => s.starter).length && starters.every(s => /^template:et_/.test(s.draft)), JSON.stringify(made.body.steps));
    if (!made.body.id) continue;
    const on = await api("PATCH", `/journeys/${made.body.id}`, tok, { enabled: true });
    ok(`§1 "${key}" is switched on`, on.status === 200, on.status);
  }
  ok("§1 the two that ask a monthly giver the same thing are exclusive",
     (await q(`SELECT trigger_key FROM cultivation_templates WHERE org_id=$1 AND exclusive ORDER BY 1`, [ORG])).map(r => r.trigger_key).join(",") === "card_expiring,recurring_failed");

  const sweep = await api("POST", "/journeys/run-sweep", tok, {});
  ok("§1 the journey sweep runs", sweep.status === 200, sweep.status);
  // The first event, through the real attendance route.
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_j3',$1,'J3 Open House','open_house',$2)`, [ORG, T]);
  await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,status) VALUES ('ea_j3',$1,'ev_j3',$2,'J3 Event','registered')`, [ORG, P("event")]);
  const att = await api("POST", "/events/ev_j3/attendance", tok, { attended: ["ea_j3"] });
  ok("§1 the attendance route marks them as having come", att.status === 200, att.status);

  const plansOf = async donor => q(
    `SELECT p.id, p.template_id, p.status, p.trigger_event, t.trigger_key FROM cultivation_plans p
       JOIN cultivation_templates t ON t.id=p.template_id WHERE p.org_id=$1 AND p.donor_id=$2 ORDER BY p.created_at`, [ORG, donor]);
  for (const [key, who] of Object.entries(WANT)) {
    const ps = (await plansOf(P(who))).filter(p => p.status === "active");
    ok(`§1 ${key}: ${who} is in the "${key}" journey, once`, ps.filter(p => p.trigger_key === key).length === 1, JSON.stringify(ps));
    const mine = ps.find(p => p.trigger_key === key);
    if (!mine) continue;
    const [first] = await q(`SELECT id, status, thread_id, draft_kind FROM cultivation_plan_steps WHERE plan_id=$1 AND seq=1`, [mine.id]);
    const th = first && first.thread_id ? (await q(`SELECT id, closed_at FROM threads WHERE id=$1`, [first.thread_id]))[0] : null;
    ok(`§1 ${key}: the first step is open on their Thread`, first && first.status === "open" && th && !th.closed_at, JSON.stringify(first));
    if (first && first.draft_kind) {
      const [dr] = await q(`SELECT status FROM milestone_drafts WHERE org_id=$1 AND milestone_key=$2`, [ORG, `journey-step:${first.id}`]);
      ok(`§1 ${key}: its email is a draft waiting for a person, not a send`, dr && dr.status === "pending_review", JSON.stringify(dr));
    }
    const [line] = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'line_key'=$3`, [ORG, P(who), `journey-step:${first.id}`]);
    ok(`§1 ${key}: the step is on their timeline`, !!line, line);
  }
  const countPlans = async () => Number((await q(`SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=$1`, [ORG]))[0].n);
  const before2 = await countPlans();
  await api("POST", "/journeys/run-sweep", tok, {});
  await api("POST", "/journeys/run-sweep", tok, {});
  ok("§1 running the sweep twice more enrols nobody a second time", (await countPlans()) === before2, `${before2} then ${await countPlans()}`);

  // ── §2 SEVERAL JOURNEYS AT ONCE ───────────────────────────────────────────
  const A = await api("POST", "/journeys", tok, { name: "J3 High", trigger: "by_hand", priority: 90,
    steps: [{ type: "thank", label: "High call", offsetDays: 3 }, { type: "follow_up", label: "High visit", offsetDays: 20 }] });
  const B = await api("POST", "/journeys", tok, { name: "J3 Low", trigger: "by_hand", priority: 40,
    steps: [{ type: "thank", label: "Low call", offsetDays: 1 }, { type: "send", label: "Low note", offsetDays: 6 }, { type: "follow_up", label: "Low check-in", offsetDays: 22 }] });
  const inB = await api("POST", `/journeys/${B.body.id}/apply`, tok, { donorIds: [P("two")] });
  const inA = await api("POST", `/journeys/${A.body.id}/apply`, tok, { donorIds: [P("two")] });
  ok("§2 a person goes into a second journey that is not exclusive", inB.body.started === 1 && inA.body.started === 1, JSON.stringify([inB.body, inA.body]).slice(0, 300));
  const twoSteps = await q(
    `SELECT st.id, st.plan_id, st.label, st.due_date, st.status, st.moved_reason FROM cultivation_plan_steps st
       JOIN cultivation_plans p ON p.id=st.plan_id WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active'
        AND st.status IN ('pending','open') ORDER BY st.due_date`, [ORG, P("two")]);
  ok("§2 they get steps from both journeys", new Set(twoSteps.map(s => s.plan_id)).size === 2, JSON.stringify(twoSteps));
  const clash = [];
  for (const a of twoSteps) for (const b of twoSteps) {
    if (a.id < b.id && a.plan_id !== b.plan_id && Math.abs(day(a.due_date) - day(b.due_date)) < 7) clash.push([a.label, a.due_date, b.label, b.due_date]);
  }
  ok("§2 never two touches from different journeys inside a week", clash.length === 0, JSON.stringify(clash));
  ok("§2 a step that moved says why", twoSteps.some(s => /moved to .* because/.test(s.moved_reason || "")), twoSteps.map(s => s.moved_reason));
  const open = twoSteps.filter(s => s.status === "open");
  ok("§2 still one next step on their Thread: the soonest", open.length === 1 && open[0].due_date === twoSteps[0].due_date, JSON.stringify(open));
  const prof = await api("GET", `/donors/${P("two")}/journeys`, tok);
  ok("§2 the profile's Journey panel lists both, each with its next step",
     prof.status === 200 && prof.body.journeys.length === 2 && prof.body.journeys.every(j => j.next && j.next.label), JSON.stringify(prof.body).slice(0, 300));

  const failedActive = (await plansOf(P("failed"))).filter(p => p.status === "active");
  ok("§2 an exclusive pair still blocks: the failed-card person is in the higher one only",
     failedActive.length === 1 && failedActive[0].trigger_key === "recurring_failed", JSON.stringify(failedActive));
  const tryCard = await api("POST", `/journeys/${jid.card_expiring}/apply`, tok, { donorIds: [P("failed")] });
  ok("§2 putting them in the lower exclusive one by hand is refused, with the reason",
     tryCard.body.started === 0 && tryCard.body.detail.skipped[0].reason === "already_in_a_journey", JSON.stringify(tryCard.body).slice(0, 300));

  // ── §3 COUNTED HONESTLY, AND UNDONE EXACTLY ─────────────────────────────────
  for (const g of ["g1", "g2", "g3", "g4"]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,2000,$4,'system:test','test')`,
      [`g_j3_${g}`, ORG, P(g), civilPlusDays(-10)]);
  }
  const M = await api("POST", "/journeys", tok, { name: "J3 Major", trigger: "gift_over", amountCents: 100000, priority: 50, exclusive: true,
    steps: [{ type: "thank", label: "Major call", offsetDays: 3 }, { type: "follow_up", label: "Major visit", offsetDays: 30 }] });
  const H = await api("POST", "/journeys", tok, { name: "J3 Higher", trigger: "by_hand", priority: 95, exclusive: true,
    steps: [{ type: "thank", label: "Higher call", offsetDays: 2 }] });
  const O = await api("POST", "/journeys", tok, { name: "J3 Other", trigger: "by_hand", priority: 30,
    steps: [{ type: "follow_up", label: "Other check-in", offsetDays: 30 }, { type: "send", label: "Other note", offsetDays: 60 }] });
  ok("§3 the fixture journeys are made", [M, H, O].every(r => r.status === 201), [M, H, O].map(r => r.status));
  await api("POST", `/journeys/${H.body.id}/apply`, tok, { donorIds: [P("g2")] });
  await api("POST", `/journeys/${O.body.id}/apply`, tok, { donorIds: [P("g3")] });
  await api("POST", `/journeys/${M.body.id}/apply`, tok, { donorIds: [P("g4")] });

  const qual = await api("GET", `/journeys/${M.body.id}/qualifying?days=90`, tok);
  ok("§3 the offer counts before the click: 4 qualify, 2 will join",
     qual.status === 200 && qual.body.count === 4 && qual.body.willJoin === 2, JSON.stringify(qual.body).slice(0, 400));
  ok("§3 it names who stays in a journey that ranks higher, and who is already in it",
     (qual.body.blocked || []).map(r => r.id).join() === P("g2") && (qual.body.alreadyIn || []).map(r => r.id).join() === P("g4")
     && (qual.body.blocked[0].journeys || []).includes("J3 Higher"), JSON.stringify([qual.body.blocked, qual.body.alreadyIn]));
  ok("§3 and who is in another journey", (qual.body.inOthers || []).map(r => r.id).join() === P("g3"), JSON.stringify(qual.body.inOthers));
  ok("§3 the sentence says it plainly, with no em dash",
     /^4 qualify\. 2 will join\./.test(qual.body.sentence) && /ranks higher/.test(qual.body.sentence) && !/—/.test(qual.body.sentence), qual.body.sentence);
  const leave = await api("GET", `/journeys/${M.body.id}/qualifying?days=90&joinOthers=false`, tok);
  ok("§3 'Leave them where they are' leaves the person in another journey out: 1 will join", leave.body.willJoin === 1, leave.body.sentence);

  const stats = async id => Object.fromEntries(((await api("GET", `/journeys/${id}/stats`, tok)).body.figures || []).map(f => [f.key, f.value]));
  const enrolled = async id => Number((await q(`SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND status='active'`, [ORG, id]))[0].n);
  const s0 = await stats(M.body.id);
  const g3Before = await q(`SELECT st.id, st.due_date, st.status, st.thread_id FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id=st.plan_id
                             WHERE p.org_id=$1 AND p.donor_id=$2 ORDER BY st.id`, [ORG, P("g3")]);
  const [g3Thread0] = await q(`SELECT id, due_date, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, P("g3")]);

  const ap = await api("POST", `/journeys/${M.body.id}/apply`, tok, { allQualifying: true, days: 90, joinOthers: true });
  ok("§3 the apply puts in exactly the number on the button", ap.status === 200 && ap.body.started === qual.body.willJoin && ap.body.planIds.length === 2, JSON.stringify(ap.body).slice(0, 300));
  ok("§3 the result reads like the toast: '2 people joined J3 Major.'", ap.body.sentence === "2 people joined J3 Major.", ap.body.sentence);
  const s1 = await stats(M.body.id);
  const now1 = await enrolled(M.body.id);
  ok("§3 How it is going updates at once and matches who is enrolled",
     s1.inIt === now1 && now1 === s0.inIt + 2 && s1.entered === s0.entered + 2, JSON.stringify({ s0, s1, now1 }));
  const [g3Thread1] = await q(`SELECT id, due_date, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, P("g3")]);
  ok("§3 the person in two journeys has their soonest step on their Thread", g3Thread1 && g3Thread1.next_step_label === "Major call", JSON.stringify([g3Thread0, g3Thread1]));

  const un = await api("POST", `/journeys/${M.body.id}/apply/undo`, tok, { planIds: ap.body.planIds });
  ok("§3 Undo takes them back out", un.status === 200 && un.body.undone === 2, JSON.stringify(un.body));
  const s2 = await stats(M.body.id);
  ok("§3 after Undo, How it is going is back where it was and matches who is enrolled",
     JSON.stringify(s2) === JSON.stringify(s0) && s2.inIt === (await enrolled(M.body.id)), JSON.stringify({ s0, s2 }));
  const left = await q(`SELECT COUNT(*)::int n FROM cultivation_plan_steps WHERE org_id=$1 AND plan_id = ANY($2::text[])`, [ORG, ap.body.planIds]);
  ok("§3 their steps are gone", Number(left[0].n) === 0, left);
  const g3After = await q(`SELECT st.id, st.due_date, st.status, st.thread_id FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id=st.plan_id
                            WHERE p.org_id=$1 AND p.donor_id=$2 ORDER BY st.id`, [ORG, P("g3")]);
  const [g3Thread2] = await q(`SELECT next_step_label, due_date FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, P("g3")]);
  ok("§3 the other journey's steps are back on their own dates, and its step holds the Thread again",
     JSON.stringify(g3After.map(s => [s.id, s.due_date, s.status])) === JSON.stringify(g3Before.map(s => [s.id, s.due_date, s.status]))
     && g3Thread2 && g3Thread2.next_step_label === g3Thread0.next_step_label && g3Thread2.due_date === g3Thread0.due_date,
     JSON.stringify({ g3Before, g3After, g3Thread0, g3Thread2 }));
  const strays = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id = ANY($2::text[]) AND note ILIKE '%J3 Major%'
                            AND donor_id <> $3`, [ORG, [P("g1"), P("g3")], P("g4")]);
  ok("§3 and their timeline lines about it are gone", strays.length === 0, strays);

  // ── §4 THE SCREEN ─────────────────────────────────────────────────────────
  const jb = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "JourneyBuilder.jsx"), "utf8");
  ok("§4 the apply result is never a browser box", !/\balert\(/.test(jb));
  const applyAt = jb.indexOf("/apply`"), toastAt = jb.indexOf("offerUndo(", applyAt), statsAt = jb.indexOf("/stats`", applyAt);
  ok("§4 it is the shared Undo toast, and the counts are fetched before it shows",
     applyAt > 0 && toastAt > 0 && statsAt > applyAt && statsAt < toastAt && jb.includes("/apply/undo"), { applyAt, statsAt, toastAt });
  ok("§4 the button says how many will join", /Put \{applyPanel\.willJoin/.test(jb));

  await closeDb();
  summary("journeys3-triggers");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
