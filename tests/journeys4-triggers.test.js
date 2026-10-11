// tests/journeys4-triggers.test.js · JOURNEYS-4. JOURNEYS START FROM
// EVERYTHING A DONOR DOES, AND STILL NEVER REACH THE WRONG PERSON.
//
//   §1 EACH NEW TRIGGER ENTERS THE RIGHT PERSON ONCE. Pledge made, instalment
//      14 days late, pledge paid; first gift through a giving page, a
//      peer-to-peer page made; auction won (recorded at the desk), bid but
//      lost, item donated; event registered, came, didn't come; a call
//      finished with "Interested in a bigger gift"; an appeal opened with no
//      gift in 14 days. One fixture person per trigger, plus a bystander for
//      each (the loser is not the winner, the no-show is not the guest who
//      came). The sweep, run three times, enrols each person once, and the
//      90-day preview counts the same people.
//   §2 THE RULES THAT HOLD. Two journeys on one trigger: the 7-day gap holds
//      across them. An asking journey skips a do-not-solicit donor while a
//      thank-you journey includes them. Deceased and do-not-contact are never
//      entered, by a rule or by hand. The first step is on the Thread with
//      exactly one task (FIX-31).
//   §3 EVENT NO-SHOWS ARE AN AUDIENCE A GROUP CAN USE: the marked no-show and
//      the registrant never checked in at an event that kept a list; not the
//      person who came. A guest named on a registration is a person record.
//   §4 THE EMAIL TRIGGER WITH NO OPEN DATA SAYS SO AND STAYS OFF.
//
// HOW IT WOULD GO RED: a trigger missing or firing on the wrong person (§1);
// the sweep's event key dropped so a second run enrols again (§1 "once"); the
// do-not-solicit or deceased gate removed from maybeStartJourney (§2); the
// no-show rule reading only status='no_show' (§3 "never checked in"); the
// email trigger switchable with no opens (§4).
//
// Its own fixture org (org_j4trig), never the demo org.

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_j4trig";
const ADMIN = "admin@j4trig.local";
const T = civilToday();
const P = id => `d_j4_${id}`;
const day = s => Math.round(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / 86400000);

(async () => {
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Journeys Four Fixture','journeys-four-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_j4trig',$1,$2,$3,'Journeys Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const people = ["pledger", "late", "paid", "pagegiver", "p2p", "winner", "loser", "donated", "reg", "came", "noshow",
                  "unchecked", "caller", "opener", "dns", "dead", "dnc", "bystander"];
  for (const id of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
      [P(id), ORG, `J4 ${id[0].toUpperCase() + id.slice(1)}`, `${id}@j4trig.local`]);
  }
  await q(`UPDATE donors SET do_not_solicit=true WHERE id=$1`, [P("dns")]);
  await q(`UPDATE donors SET deceased=true WHERE id=$1`, [P("dead")]);
  await q(`UPDATE donors SET do_not_contact=true WHERE id=$1`, [P("dnc")]);
  const tok = await login(ADMIN);

  // ── the records that make each trigger true ──────────────────────────────
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES
             ('pl_j4_made',$1,$2,500,$5,'open','system:test','test'),
             ('pl_j4_late',$1,$3,1200,$6,'open','system:test','test'),
             ('pl_j4_paid',$1,$4,300,$7,'fulfilled','system:test','test')`,
    [ORG, P("pledger"), P("late"), P("paid"), civilPlusDays(90), civilPlusDays(200), civilPlusDays(-3)]);
  await q(`UPDATE pledges SET created_at=NOW() - interval '400 days' WHERE id IN ('pl_j4_late','pl_j4_paid')`);
  await q(`UPDATE pledges SET fulfilled_at=NOW() WHERE id='pl_j4_paid'`);
  await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES
             ('pi_j4_1',$1,'pl_j4_late',1,$2,100), ('pi_j4_2',$1,'pl_j4_late',2,$3,100)`,
    [ORG, civilPlusDays(-15), civilPlusDays(15)]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title) VALUES ('gp_j4',$1,'j4-page','J4 Page')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,giving_page_id,created_by,created_by_name) VALUES ('g_j4_page',$1,$2,40,$3,'gp_j4','system:test','test')`,
    [ORG, P("pagegiver"), civilPlusDays(-2)]);
  await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,personal_goal_amount,status,person_id,edit_token)
             VALUES ('pf_j4',$1,'gp_j4','J4 P2p','p2p@j4trig.local','j4-p2p',500,'active',$2,'tok_j4_p2p')`, [ORG, P("p2p")]);
  // An auction still open, with an item the loser bid on online. It closes
  // after the winner is recorded at the desk.
  await q(`INSERT INTO auctions (id,org_id,title,public_slug,opens_at,closes_at,created_by,created_by_name)
             VALUES ('au_j4',$1,'J4 Spring Auction','j4-spring-auction',NOW() - interval '3 days',NOW() + interval '1 day','system:test','test')`, [ORG]);
  await q(`INSERT INTO auction_items (id,org_id,auction_id,title,donor_id,starting_bid,bid_increment,created_by,created_by_name)
             VALUES ('aui_j4_a',$1,'au_j4','Weekend at the lake',$2,100,10,'system:test','test')`, [ORG, P("donated")]);
  await q(`INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,bidder_number,token_hash,created_by,created_by_name)
             VALUES ('aub_j4_l',$1,'au_j4',$2,'J4 Loser','loser@j4trig.local',101,'h_j4_l','system:test','test')`, [ORG, P("loser")]);
  await q(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,created_by,created_by_name)
             VALUES ('abid_j4_l',$1,'au_j4','aui_j4_a','aub_j4_l',120,'system:test','test')`, [ORG]);
  // Two events: one that has passed with a list kept at the door, one to come.
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_j4_past',$1,'J4 Gala','gala',$2), ('ev_j4_next',$1,'J4 Spring Lunch','lunch',$3)`,
    [ORG, civilPlusDays(-3), civilPlusDays(20)]);
  await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,status,checked_in_at) VALUES
             ('ea_j4_came',$1,'ev_j4_past',$2,'J4 Came','attended',NOW() - interval '3 days'),
             ('ea_j4_noshow',$1,'ev_j4_past',$3,'J4 Noshow','no_show',NULL),
             ('ea_j4_unchk',$1,'ev_j4_past',$4,'J4 Unchecked','registered',NULL)`,
    [ORG, P("came"), P("noshow"), P("unchecked")]);
  await q(`UPDATE event_attendees SET created_at=NOW() - interval '120 days' WHERE event_id='ev_j4_past'`);
  await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,status) VALUES
             ('ea_j4_reg',$1,'ev_j4_next',$2,'J4 Reg','registered'),
             ('ea_j4_dns',$1,'ev_j4_next',$3,'J4 Dns','registered'),
             ('ea_j4_dead',$1,'ev_j4_next',$4,'J4 Dead','registered'),
             ('ea_j4_dnc',$1,'ev_j4_next',$5,'J4 Dnc','registered')`,
    [ORG, P("reg"), P("dns"), P("dead"), P("dnc")]);

  // ── §4 first: the email trigger, before this org has any opens ────────────
  const cat0 = await api("GET", "/journeys", tok);
  const avail0 = (cat0.body.triggerAvailability || {}).email_engaged_no_gift || {};
  ok("§4 with no opens on file the email trigger says so", avail0.ok === false && /no email opens or clicks/i.test(avail0.sentence || ""), JSON.stringify(avail0));
  const em = await api("POST", "/journeys", tok, { name: "J4 Opened, no gift", trigger: "email_engaged_no_gift", enabled: true,
    steps: [{ type: "follow_up", label: "Call to ask what they thought", offsetDays: 2 }] });
  ok("§4 and it cannot be switched on", em.status === 409 && em.body.error === "no_open_data", JSON.stringify(em.body).slice(0, 200));
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,sent_at) VALUES ('cmp_j4',$1,'J4 Spring Appeal','appeal','sent',NOW() - interval '20 days')`, [ORG]);
  await q(`INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,sent_at,opened_at) VALUES
             ('cr_j4_o',$1,'cmp_j4',$2,'opener@j4trig.local',NOW() - interval '20 days',NOW() - interval '19 days'),
             ('cr_j4_b',$1,'cmp_j4',$3,'bystander@j4trig.local',NOW() - interval '20 days',NOW() - interval '19 days')`,
    [ORG, P("opener"), P("bystander")]);
  // The bystander opened it too, and then gave: not a candidate.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_j4_by',$1,$2,25,$3,'system:test','test')`,
    [ORG, P("bystander"), civilPlusDays(-10)]);
  const avail1 = ((await api("GET", "/journeys", tok)).body.triggerAvailability || {}).email_engaged_no_gift || {};
  ok("§4 with an open on file it can be used", avail1.ok === true, JSON.stringify(avail1));

  // ── §1 one journey per trigger, switched on ───────────────────────────────
  const WANT = {
    pledge_made: ["pledger"], pledge_late: ["late"], pledge_paid: ["paid"], page_first_gift: ["pagegiver"],
    p2p_created: ["p2p"], auction_won: ["winner"], auction_lost: ["loser"], auction_donated: ["donated"],
    attended_event: ["came"], event_no_show: ["noshow", "unchecked"], task_outcome: ["caller"],
    email_engaged_no_gift: ["opener"],
  };
  const jid = {};
  for (const key of Object.keys(WANT)) {
    const made = await api("POST", "/journeys", tok, { name: `J4 ${key}`, trigger: key, enabled: true,
      triggerFilters: key === "task_outcome" ? { outcome: "bigger_gift" } : undefined,
      steps: [{ type: "thank", label: `Thank for ${key}`, offsetDays: 1 }, { type: "follow_up", label: `Follow up ${key}`, offsetDays: 30 }] });
    ok(`§1 "${key}" is a trigger a journey can start from, switched on`, made.status === 201 && made.body.enabled === true, JSON.stringify(made.body).slice(0, 200));
    jid[key] = made.body.id;
  }
  const cat = await api("GET", "/journeys", tok);
  ok("§1 every new trigger is offered in plain words, with its sentence",
     Object.keys(WANT).concat(["event_registered"]).every(k => (cat.body.triggers || []).some(t => t.key === k && t.label && t.sentence && !/—/.test(t.sentence))));
  ok("§1 the outcomes a call can end with are offered, with the bigger gift one",
     (cat.body.taskOutcomes || []).some(o => o.key === "bigger_gift" && o.label === "Interested in a bigger gift"));
  // §2's two journeys on one trigger: a thank-you and an ask.
  const TY = await api("POST", "/journeys", tok, { name: "J4 Registered thank-you", trigger: "event_registered", enabled: true, priority: 60,
    steps: [{ type: "thank", label: "Thank them for registering", offsetDays: 1 }, { type: "send", label: "Send the details", offsetDays: 10 }] });
  const ASK = await api("POST", "/journeys", tok, { name: "J4 Registered ask", trigger: "event_registered", enabled: true, priority: 40,
    steps: [{ type: "follow_up", label: "Call before the lunch", offsetDays: 2 }, { type: "check_in_ask", label: "Make the ask", offsetDays: 40 }] });
  ok("§2 the thank-you and the asking journey are made on one trigger", TY.status === 201 && ASK.status === 201, [TY.status, ASK.status]);

  // The 90-day preview, before anything has fired: who would have entered.
  const prevWin = await api("GET", `/journeys/${jid.auction_won}/qualifying?days=90`, tok);
  ok("§1 the 90-day preview for 'won an auction item' is empty before the win is recorded", prevWin.status === 200 && prevWin.body.count === 0, JSON.stringify(prevWin.body).slice(0, 200));
  const prevAsk = await api("GET", `/journeys/${ASK.body.id}/qualifying?days=90`, tok);
  ok("§2 the asking journey's preview leaves out the do-not-solicit and the deceased or do-not-contact",
     prevAsk.body.count === 2 && prevAsk.body.willJoin === 1 && (prevAsk.body.donorIds || []).join() === P("reg") && /1 person is marked do not solicit/.test(prevAsk.body.sentence),
     JSON.stringify(prevAsk.body).slice(0, 400));

  // The win, recorded at the desk (the walk's path). The loser's online bid was lower.
  const win = await api("POST", "/auction-items/aui_j4_a/winner", tok, { donorId: P("winner"), amount: "450" });
  ok("§1 recording the winner at the desk works and says so", win.status === 200 && /J4 Winner won Weekend at the lake at \$450/.test(win.body.sentence || ""), JSON.stringify(win.body));
  const lowWin = await api("POST", "/auction-items/aui_j4_a/winner", tok, { donorId: P("loser"), amount: "200" });
  ok("§1 a lower 'winning' bid than the high bid is refused", lowWin.status === 400, JSON.stringify(lowWin.body));
  await q(`UPDATE auctions SET closes_at=NOW() - interval '1 minute' WHERE id='au_j4'`);   // the night ends
  // The call, finished with "Interested in a bigger gift".
  await q(`INSERT INTO tasks (id,org_id,title,due,kind,donor_id,created_by,created_by_name) VALUES ('t_j4_call',$1,'Call J4 Caller',$2,'call',$3,'system:test','test')`,
    [ORG, T, P("caller")]);
  const conv = await api("POST", `/donors/${P("caller")}/conversations`, tok, { touch: "call_reached", line: "Talked about the new building.",
    outcome: "bigger_gift", nextStep: { skipped: true } });
  ok("§1 the call is logged with the outcome she picked", conv.status === 200 || conv.status === 201, JSON.stringify(conv.body).slice(0, 200));
  const done = await api("POST", "/tasks/t_j4_call/complete", tok, { interactionId: conv.body.interactionId || (conv.body.interaction || {}).id });
  ok("§1 the call task is finished, carrying the outcome", done.status === 200 && (await q(`SELECT outcome FROM tasks WHERE id='t_j4_call'`))[0].outcome === "bigger_gift",
     JSON.stringify(done.body).slice(0, 200));

  // The sweep, three times. Each run after the first enrols nobody.
  await api("POST", "/journeys/run-sweep", tok, {});
  const countPlans = async () => Number((await q(`SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=$1`, [ORG]))[0].n);
  const n1 = await countPlans();
  await api("POST", "/journeys/run-sweep", tok, {});
  await api("POST", "/journeys/run-sweep", tok, {});
  ok("§1 a trigger that fires again for the same thing enters nobody twice", (await countPlans()) === n1, `${n1} then ${await countPlans()}`);

  const plansIn = async tplId => (await q(`SELECT donor_id FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 ORDER BY donor_id`, [ORG, tplId])).map(r => r.donor_id);
  for (const [key, who] of Object.entries(WANT)) {
    const got = await plansIn(jid[key]);
    const want = who.map(P).sort();
    ok(`§1 ${key}: exactly ${who.join(" and ")}, once`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  }
  const prevWin2 = await api("GET", `/journeys/${jid.auction_won}/qualifying?days=90`, tok);
  ok("§1 the 90-day preview names the winner, already in it", prevWin2.body.count === 1 && (prevWin2.body.alreadyIn || []).map(r => r.id).join() === P("winner"), JSON.stringify(prevWin2.body).slice(0, 300));

  // ── §2 THE RULES THAT HOLD ────────────────────────────────────────────────
  const tyIn = await plansIn(TY.body.id), askIn = await plansIn(ASK.body.id);
  ok("§2 the thank-you journey includes the do-not-solicit donor", tyIn.includes(P("dns")) && tyIn.includes(P("reg")), JSON.stringify(tyIn));
  ok("§2 the asking journey skips them", !askIn.includes(P("dns")) && askIn.includes(P("reg")), JSON.stringify(askIn));
  ok("§2 deceased and do-not-contact are in neither", ![...tyIn, ...askIn].some(id => id === P("dead") || id === P("dnc")), JSON.stringify([tyIn, askIn]));
  const byHand = await api("POST", `/journeys/${TY.body.id}/apply`, tok, { donorIds: [P("dead"), P("dnc")] });
  ok("§2 nor by hand, and the reason is named", byHand.body.started === 0
     && (byHand.body.detail.skipped || []).map(s => s.reason).sort().join() === "deceased,do_not_contact", JSON.stringify(byHand.body).slice(0, 300));
  const regSteps = await q(
    `SELECT st.id, st.plan_id, st.label, st.due_date, st.status FROM cultivation_plan_steps st
       JOIN cultivation_plans p ON p.id=st.plan_id WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active'
        AND st.status IN ('pending','open') ORDER BY st.due_date`, [ORG, P("reg")]);
  ok("§2 the person in both has steps from both", new Set(regSteps.map(s => s.plan_id)).size === 2, JSON.stringify(regSteps));
  const clash = [];
  for (const a of regSteps) for (const b of regSteps) {
    if (a.id < b.id && a.plan_id !== b.plan_id && Math.abs(day(a.due_date) - day(b.due_date)) < 7) clash.push([a.label, a.due_date, b.label, b.due_date]);
  }
  ok("§2 the 7-day gap holds across the two journeys", clash.length === 0, JSON.stringify(clash));
  // FIX-31: every journey step lands on the Thread and the Calendar as ONE task.
  const [wPlan] = await q(`SELECT id FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND donor_id=$3`, [ORG, jid.auction_won, P("winner")]);
  const [wStep] = wPlan ? await q(`SELECT id, status, thread_id, label FROM cultivation_plan_steps WHERE plan_id=$1 AND seq=1`, [wPlan.id]) : [];
  const wThread = wStep && wStep.thread_id ? (await q(`SELECT id, closed_at FROM threads WHERE id=$1`, [wStep.thread_id]))[0] : null;
  const wTasks = wStep && wStep.thread_id ? await q(`SELECT id FROM tasks WHERE org_id=$1 AND thread_id=$2`, [ORG, wStep.thread_id]) : [];
  ok("§2 the winner's first step is open on their Thread", wStep && wStep.status === "open" && wThread && !wThread.closed_at, JSON.stringify(wStep));
  ok("§2 and is one task (Thread and Calendar read the same row)", wTasks.length === 1, JSON.stringify(wTasks));

  // ── §3 EVENT NO-SHOWS AS AN AUDIENCE ──────────────────────────────────────
  const grp = await api("POST", "/groups", tok, { name: "J4 Gala no-shows", kind: "dynamic", rules: { eventGuest: "no_show" } });
  ok("§3 a group by rule from event no-shows is made", grp.status === 201, JSON.stringify(grp.body).slice(0, 200));
  const GR = require("../groups");
  const members = grp.body && grp.body.id ? (await GR.memberIds(ORG, await GR.groupById(ORG, grp.body.id))).sort() : [];
  ok("§3 it holds the marked no-show and the registrant never checked in, not the person who came",
     JSON.stringify(members) === JSON.stringify([P("noshow"), P("unchecked")].sort()), JSON.stringify(members));
  const bad = await api("POST", "/groups", tok, { name: "J4 bad", kind: "dynamic", rules: { eventGuest: "everyone" } });
  ok("§3 an event-guest rule nobody understands is refused, never widened", bad.status === 400, bad.status);
  const narrowed = await api("POST", "/journeys", tok, { name: "J4 No-show audience", trigger: "by_hand", audience: { eventGuests: "no_show" },
    steps: [{ type: "follow_up", label: "Say we missed them", offsetDays: 1 }] });
  ok("§3 a journey's audience can be event no-shows", narrowed.status === 201 && (narrowed.body.audience || {}).eventGuests === "no_show", JSON.stringify(narrowed.body.audience));
  // A guest named on a registration is a person record of their own.
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price) VALUES ('evl_j4',$1,'ev_j4_next','ticket','Lunch',40)`, [ORG]);
  await q(`UPDATE events SET public_slug='j4-spring-lunch' WHERE id='ev_j4_next'`);
  const BASE = process.env.BASE || "http://localhost:5601";
  const reg = await fetch(`${BASE}/e/j4-spring-lunch/register`, { method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "J4 Host", email: "host@j4trig.local", levelId: "evl_j4", quantity: "2", guests: "Wren Guestname" }).toString() });
  const [guestRow] = await q(`SELECT ea.donor_id, d.person_types FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id
                               WHERE ea.org_id=$1 AND ea.name='Wren Guestname'`, [ORG]);
  ok("§3 a guest on a registration is a person record, not a donor yet", reg.status === 200 && guestRow && guestRow.donor_id
     && JSON.stringify(guestRow.person_types) === '["other"]', JSON.stringify({ status: reg.status, guestRow }));
  const guests = (await GR.memberIds(ORG, { kind: "dynamic", rules: { eventGuest: "brought_guest" }, org_id: ORG }).catch(() => null));
  ok("§3 'came as someone's guest, not a donor yet' finds them", Array.isArray(guests) && guestRow && guests.includes(guestRow.donor_id), JSON.stringify(guests));

  await closeDb();
  summary("journeys4-triggers");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
