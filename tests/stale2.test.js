// tests/stale2.test.js: STALE-2. NO FIGURE ON SCREEN IS OLDER THAN THE LAST
// ACTION, AND AN EVENT'S GUEST LEAVES NOTHING BEHIND ON A PROFILE.
// Guards donor data: the QA fleet (7 Nov 2026, W-1107-*) found figures that
// waited for a reload after STALE-1, and a guest's "Came to" left on a
// profile after the guest was marked No Show, removed, or the event deleted.
//
// API leg:
//   §A the attendance line follows the guest row: Attended → No Show rewrites
//      it, back to Registered removes it, the attendance list does the same,
//      removing a guest takes their lines (and Undo brings them back), the
//      bulk Remove takes them, deleting the event leaves none (W-1107-Volunteers-21)
//   §B the orphan script: a dry run counts, --apply removes with an audit
//      row, a second run finds none, --undo puts them back
//   §C the channel's rules: a Thread write is a task change, an event's guest
//      write is an event change
// Browser leg (the action, then the figure, with no page load in between):
//   §1 the event page: guests added and marked come move Invited, Came and
//      Attendees (W-1107-Volunteers-01)
//   §2 Fundraising: attendance saved on the Tickets & sponsors desk moves
//      the lead event card's Came (W-1107-Volunteers-01)
//   §3 a next step snoozed to revisit later, on the profile's Thread, leaves
//      the Tasks badge
//      (W-1107-Volunteers-15)
//   §4 hours logged elsewhere move an open profile's volunteer panel
//      (W-1107-Volunteers-08)
//
// FRESH-1 (Jarvis, 24 Nov: "Trashing QA Test Zero Person left … Trash (1) … after Empty trash
// the message said '1 person was deleted for good' but the row … remained"):
//   §D the census: each write the fleet clicked (a delete, Restore, Empty trash, a cash gift, an
//      attendee added) answers X-Steward-Changed with the topic its counts listen for
//   §5 Settings → Trash: Empty trash takes the row, the sentence and "Trash (n)", no reload
//   §6 a chunk gone with a deploy reopens the page once ("Steward was just updated.
//      Reopening…"); gone again at once, the error shows with Reload and nothing loops
//
// FRESH-2 (Jarvis's mega sweep, 25 Nov: "list and count surfaces do not re-read"):
//   §E the screen census (static, tests/lib/surfaceCensus.js): every list and count surface in
//      client/src/lib/surfaces.js listens, through lib/liveRead.js, for a topic each table it
//      shows announces; a surface that stops listening, or stops hearing one table, fails it
//   §F Atlas: "list them" after a gift says its rows are older than the gift; with no change
//      between, it does not
//   §7 the profile's Notes summary line follows a gift saved and deleted, no reload (item 5)
//   §8 Communications → Overview → Recent sends drops a deleted campaign, no reload
//   §9 Volunteers: a volunteer deleted elsewhere in this browser leaves the header and the list
//   §10 Home's rail person view (the mini-profile): Lifetime moves with a gift
//
// Planted defects (each turned this suite red, then was taken back out; the
// STALE-2 report names them):
//   · "event" dropped from changes.js's event rule → §C and §1 red
//   · run against main's code → §A, §2 and §3 red
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { ok, summary, login, api, q, closeDb, civilToday, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_stale2";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const WAIT = 12000;
let SC_LISTENING = null;   // FRESH-3 §G: which topics each surface listens for (tests/lib/surfaceCensus.js)

async function freshOrg() {
  // FRESH-3 §H: the second org and the membership it gave Odile go first, or her row can't.
  await q(`DELETE FROM org_memberships WHERE user_id=$1 OR org_id=$2`, [ME, ORG + "_two"]).catch(() => {});
  await q(`DELETE FROM user_sessions WHERE org_id=$1`, [ORG + "_two"]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG + "_two"]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG + "_two"]).catch(() => {});
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Stale Two Heron Society',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Marsh','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active','["donor"]'::jsonb,$5,'Odile Marsh','system:test/stale2','STALE-2 test')`,
  [P(id), ORG, name, `${id}@stale2.example.org`, ME]);
// The event lines on one person's timeline, as the profile reads them.
const lines = async (donorId, eventId) => (await q(
  `SELECT note, metadata->>'via' AS via FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'event_id'=$3
     AND metadata->>'via' IN ('event_registration','event_attendance') ORDER BY note`, [ORG, donorId, eventId]));
const notes = async (d, e) => (await lines(d, e)).map(l => l.note);
// Only the attendance line (adding a guest from the directory also writes "Registered for X.").
const came = async (d, e) => (await lines(d, e)).filter(l => l.via === "event_attendance").map(l => l.note);
const attId = async (eventId, donorId) => ((await q(`SELECT id FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id=$3`, [ORG, eventId, donorId]))[0] || {}).id;

(async () => {
  const tok = await freshOrg();
  const today = civilToday();
  for (const [id, name] of [["ada", "Ada Quill"], ["bram", "Bram Oduya"], ["cleo", "Cleo Varga"], ["dev", "Devi Halloran"], ["eli", "Eli Strand"], ["fay", "Fay Morrow"], ["gus", "Gus Penhale"], ["hal", "Hal Wexford"]]) await person(id, name);

  // ── §A · THE ATTENDANCE LINE FOLLOWS THE GUEST ROW ─────────────────────────
  const evA = await api("POST", "/events", tok, { name: "Heron Lantern Walk", date: today, eventType: "community", description: "A walk." });
  const EA = evA.body && (evA.body.id || (evA.body.event && evA.body.event.id));
  await api("POST", `/events/${EA}/attendees`, tok, { donorIds: [P("ada"), P("bram"), P("cleo")] });
  const [a1, a2, a3] = [await attId(EA, P("ada")), await attId(EA, P("bram")), await attId(EA, P("cleo"))];
  ok("§A fixtures: the event and three guests", !!EA && !!a1 && !!a2 && !!a3, { EA, a1, a2, a3 });
  const CAME = "Came to Heron Lantern Walk.", MISSED = "Registered for Heron Lantern Walk and did not come.";

  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "attended" });
  ok("§A marked Attended: one \"Came to\" line", JSON.stringify(await came(P("ada"), EA)) === JSON.stringify([CAME]), await notes(P("ada"), EA));
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "no_show" });
  const ns = await came(P("ada"), EA);
  ok("§A Attended → No Show: no \"Came to\" line stays (W-1107-Volunteers-21)", !ns.includes(CAME), ns);
  ok("§A …and the line says what is true now", JSON.stringify(ns) === JSON.stringify([MISSED]), ns);
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "registered" });
  ok("§A back to Registered: no attendance line at all", (await lines(P("ada"), EA)).filter(l => l.via === "event_attendance").length === 0, await notes(P("ada"), EA));
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "attended" });
  ok("§A marked Attended again: exactly one \"Came to\" line", JSON.stringify(await came(P("ada"), EA)) === JSON.stringify([CAME]), await notes(P("ada"), EA));

  await api("POST", `/events/${EA}/attendance`, tok, { attended: [a2], noShow: [] });
  await api("POST", `/events/${EA}/attendance`, tok, { attended: [], noShow: [a2] });
  ok("§A the attendance list, saved again the other way, rewrites the line", JSON.stringify(await came(P("bram"), EA)) === JSON.stringify([MISSED]), await notes(P("bram"), EA));

  const adaBefore = JSON.stringify(await notes(P("ada"), EA));
  const del = await api("DELETE", `/events/${EA}/attendees/${a1}`, tok);
  ok("§A a guest removed takes their lines with them", del.status === 200 && (await lines(P("ada"), EA)).length === 0, { status: del.status, left: await notes(P("ada"), EA) });
  const back = await api("POST", `/deleted-records/${del.body && del.body.undoId}/restore`, tok);
  ok("§A …and the guest's Undo brings them back", back.status === 200 && JSON.stringify(await notes(P("ada"), EA)) === adaBefore, { status: back.status, lines: await notes(P("ada"), EA) });

  await api("PATCH", `/events/${EA}/attendees/${a3}`, tok, { status: "attended" });
  const cleoBefore = (await lines(P("cleo"), EA)).length;
  const bulk = await api("POST", "/removals/guest", tok, { ids: [a1, a2, a3] });
  const leftB = (await lines(P("ada"), EA)).length + (await lines(P("bram"), EA)).length + (await lines(P("cleo"), EA)).length;
  ok("§A the bulk Remove takes every removed guest's lines", bulk.status === 200 && leftB === 0, { status: bulk.status, left: leftB });
  const und = await api("POST", "/removals/undo", tok, { undoIds: (bulk.body && bulk.body.undoIds) || [] });
  ok("§A …and its Undo brings them back", und.status === 200 && cleoBefore >= 2 && (await lines(P("cleo"), EA)).length === cleoBefore, { status: und.status, cleo: await notes(P("cleo"), EA) });
  await api("POST", "/removals/guest", tok, { ids: [a1, a2, a3] });
  const gone = await api("DELETE", `/events/${EA}`, tok);
  const anyLeft = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND metadata->>'event_id'=$2`, [ORG, EA]);
  ok("§A every guest removed, then the event deleted: no line names it on any profile", gone.status === 200 && anyLeft[0].n === 0, { status: gone.status, left: anyLeft[0].n });

  // ── §B · THE ORPHAN SCRIPT ─────────────────────────────────────────────────
  // A line left behind before STALE-2: its guest row is gone and not in the trash.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
           VALUES ('int_stale2_orphan',$1,$2,'event','Came to The Old Supper.',$3,'system:test/stale2','STALE-2 test',$4::jsonb)`,
    [ORG, P("dev"), today, JSON.stringify({ via: "event_attendance", event_id: "ev_stale2_gone", attendee_id: "att_stale2_gone", status: "attended" })]);
  const S = require("../scripts/ops/stale2-event-line-orphans");
  const db = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: false });
  await db.connect();
  try {
    const dry = (await S.list(db, ORG)).find(r => r.org_id === ORG);
    ok("§B the dry run counts the orphaned line (org id and a count, no names)", !!dry && dry.n === 1 && Object.keys(dry).sort().join() === "n,org_id", dry);
    const r = await S.apply(db, ORG);
    const audit = await q(`SELECT record_count FROM fin_audit_log WHERE id=$1`, [r.auditId]);
    ok("§B --apply removes it, with one audit row", r.count === 1 && audit.length === 1 && audit[0].record_count === 1, r);
    ok("§B a second run finds none", (await S.list(db, ORG)).length === 0);
    const u = await S.undo(db, r.auditId);
    ok("§B --undo puts it back exactly", u.count === 1 && (await q(`SELECT 1 FROM interactions WHERE id='int_stale2_orphan'`)).length === 1, u);
  } finally { await db.end(); }

  // ── §C · THE CHANNEL'S RULES ───────────────────────────────────────────────
  const CH = await import(path.join(__dirname, "../client/src/lib/changes.js"));
  const kinds = (p, m = "POST") => [...CH.kindsOfWrite(p, m, null).kinds];
  ok("§C a Thread write is a task change (a next step IS a task)", kinds("/threads/th_1/dismiss").includes("task"), kinds("/threads/th_1/dismiss"));
  ok("§C a guest's write is an event change, for that event", kinds(`/events/ev_1/attendees/a_1`, "PATCH").includes("event")
    && [...(CH.kindsOfWrite("/events/ev_1/attendees", "POST", null).ids.event || [])].includes("ev_1"), kinds(`/events/ev_1/attendees/a_1`, "PATCH"));
  ok("§C a grant's write is a task change too (its deadlines are tasks)", kinds("/grants/g_1/milestones").includes("task"), kinds("/grants/g_1/milestones"));

  // ── §E · THE SCREEN CENSUS: EVERY LIST AND COUNT HEARS WHAT IT SHOWS ──────
  const SC = require("./lib/surfaceCensus");
  SC_LISTENING = () => SC.listening();
  const clean = await SC.census();
  ok("§E every list and count surface listens for what it shows (FRESH-2 item 3)", clean.length === 0, clean);
  const plant = async (file, from, to) => {
    const src = fs.readFileSync(path.join(__dirname, "../client/src", file), "utf8");
    if (!src.includes(from)) return ["(the planted line was not found: " + from + ")"];
    return SC.census({ src: { [file]: src.replace(from, to) } });
  };
  const deaf = await plant("components/VolunteersHub.jsx", 'useLive("volunteers.roster", ["volunteer", "person"]', 'useLive("volunteers.roster", ["volunteer"]');
  ok("§E …a surface that stops hearing a table it shows fails it (the roster without \"person\")", deaf.length === 1 && /volunteers\.roster shows donors/.test(deaf[0]), deaf);
  const unheard = await plant("components/Communications.jsx", 'useLiveRead("comms.overview"', 'useLiveReadNot("comms.overview"');
  ok("§E …and a surface that stops listening fails it (Overview's Recent sends)", unheard.length === 1 && /comms\.overview .* no longer listens/.test(unheard[0]), unheard);

  // ── §F · ATLAS: A FOLLOW-UP SAYS WHEN ITS ROWS ARE OLDER THAN A GIFT ──────
  const ask = async (text, follows) => { const r = await api("POST", "/atlas", tok, { text, ...(follows ? { followsId: follows.id } : {}) });
    return { status: r.status, id: r.body && r.body.request && r.body.request.id, said: JSON.stringify(r.body || {}) }; };
  const SINCE = /changed after that answer/;
  await api("POST", `/donors/${P("ada")}/gifts`, tok, { amount: 60, date: today, type: "cash" });
  const q1 = await ask("Who gave this month?");
  const lt1 = await ask("list them", q1);
  ok("§F Atlas lists the month's givers again, with no gift in between: no note", q1.status < 300 && lt1.status < 300 && /Ada Quill/.test(lt1.said) && !SINCE.test(lt1.said), { q1: q1.said.slice(0, 200), lt1: lt1.said.slice(0, 300) });
  const q2 = await ask("Who gave this month?");
  await api("POST", `/donors/${P("bram")}/gifts`, tok, { amount: 80, date: today, type: "cash" });
  const l2 = await ask("list them", q2);
  ok("§F …a gift saved between the question and \"list them\": the answer says its rows are older (FRESH-2 item 4)", l2.status < 300 && SINCE.test(l2.said), l2.said.slice(0, 400));
  const q3 = await ask("Who gave this month?");
  ok("§F …and asked again, Bram's gift is in the answer", q3.status < 300 && /Bram Oduya/.test(q3.said), q3.said.slice(0, 400));

  // ── §G · FRESH-3: EVERY MONEY, VOLUNTEER AND EVENT WRITE REACHES THE PANELS THAT SHOW IT ──
  // W-1112-Volunteers-01X (Area 3 F1, Area 4): Finance, Volunteers and Events panels stayed stale
  // after a save. Each write here is made as the screen sends it; its X-Steward-Changed topics must
  // reach every surface in lib/surfaces.js that shows its rows (read from the source: useLive…).
  {
    const BASE_G = process.env.BASE || "http://localhost:5601";
    const told = async (method, url, body) => {
      const r = await fetch(BASE_G + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
      const b = await r.json().catch(() => ({}));
      return { status: r.status, body: b, topics: String(r.headers.get("x-steward-changed") || "").split(",").filter(Boolean) };
    };
    const heard = SC_LISTENING();
    const hears = (names, r) => names.filter(n => !heard[n] || ![...heard[n].topics].some(t => r.topics.includes(t)));
    const FIN = Object.keys(heard).filter(n => n.startsWith("finance.") || n === "fundraising.pledges");
    ok("§G the Finance panels are in the census (FRESH-3 item 1)", FIN.length >= 8, FIN);
    const g1 = await told("POST", `/donors/${P("eli")}/gifts`, { amount: 120, date: today, type: "cash" });
    const GID = g1.body && (g1.body.id || (g1.body.gift && g1.body.gift.id));
    const pl = await told("POST", `/donors/${P("eli")}/pledges`, { amount: 600, date: today, dueDate: today });
    const PLID = pl.body && (pl.body.id || (pl.body.pledge && pl.body.pledge.id));
    const plan = await told("POST", `/donors/${P("eli")}/offline-plans`, { amount: 25, frequency: "monthly", startDate: today });
    const PLAN = plan.body && (plan.body.id || (plan.body.plan && plan.body.plan.id));
    const money = [
      ["a gift added", g1],
      ["a gift edited ($120 to $150)", await told("PUT", `/gifts/${GID}`, { amount: 150, donorId: P("eli") })],
      ["a pledge added", pl],
      ["a pledge payment", await told("POST", `/donors/${P("eli")}/gifts`, { amount: 100, date: today, type: "cash", pledgeId: PLID })],
      ["a pledge written off", await told("PUT", `/pledges/${PLID}`, { status: "written_off", confirmed: true, donorId: P("eli") })],
      ["a recurring plan recorded by staff", plan],
      ["that plan cancelled", await told("POST", `/offline-plans/${PLAN}/cancel`, { confirmed: true })],
      ["a refund", await told("POST", `/gifts/${GID}/refund`, { amount: 20, date: today, reason: "Asked for part back" })],
      ["a gift deleted", await (async () => { const g2 = await told("POST", `/donors/${P("eli")}/gifts`, { amount: 45, date: today, type: "cash" });
        return told("DELETE", `/gifts/${g2.body && (g2.body.id || (g2.body.gift && g2.body.gift.id))}`); })()],
    ];
    for (const [what, r] of money) {
      const deaf = hears(FIN, r);
      ok(`§G ${what} (${r.status}) reaches every Finance panel: ${deaf.length ? "deaf: " + deaf.join(", ") : "all hear it"}`, r.status < 300 && r.topics.length > 0 && deaf.length === 0, { status: r.status, topics: r.topics, deaf, body: r.status >= 300 ? r.body : undefined });
    }

    // Volunteers and Events: a shift made, signed up, deleted; a status; a guest added and removed.
    const VOL = ["volunteers.roster", "volunteers.shifts", "volunteers.schedule", "profile.volunteer"];
    const EVT = ["events.list", "event.rows", "events.desk-guests", "events.desk-cards"];
    await q(`INSERT INTO donors (id,org_id,name,stage,status,person_types,created_by,created_by_name) VALUES ($1,$2,'Wren Calloway','prospect','active','["volunteer"]'::jsonb,'system:test/stale2','FRESH-3 test') ON CONFLICT (id) DO NOTHING`, [P("wren"), ORG]);
    const opp = await told("POST", "/volunteer-hub/opportunities", { name: "Heron Shelving", description: "Shelving." });
    const OPP = opp.body && (opp.body.id || (opp.body.opportunity && opp.body.opportunity.id));
    // Two overlapping shifts next week for Wren: the cards tag both, and the counter must say so.
    const nextWeek = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
    const sA = await told("POST", "/volunteer-hub/slots", { opportunityId: OPP, date: nextWeek, startTime: "09:00", endTime: "12:00", capacity: 4 });
    const sB = await told("POST", "/volunteer-hub/slots", { opportunityId: OPP, date: nextWeek, startTime: "11:00", endTime: "14:00", capacity: 4 });
    const SA = sA.body && (sA.body.id || (sA.body.shift && sA.body.shift.id) || (sA.body.ids && sA.body.ids[0]));
    const SB = sB.body && (sB.body.id || (sB.body.shift && sB.body.shift.id) || (sB.body.ids && sB.body.ids[0]));
    const up1 = await told("POST", "/volunteer-hub/signups", { slotId: SA, personId: P("wren") });
    const up2 = await told("POST", "/volunteer-hub/signups", { slotId: SB, personId: P("wren"), overlapOk: true });
    ok("§G fixtures: an opportunity, two overlapping shifts next week, Wren on both", !!OPP && !!SA && !!SB && up1.status < 300 && up2.status < 300,
      { opp: opp.status, sA: [sA.status, sA.body], sB: sB.status, up1: [up1.status, up1.body], up2: up2.status });
    for (const [what, r] of [["a shift signed up", up1]]) {
      const deaf = hears(VOL, r);
      ok(`§G ${what} reaches every Volunteers panel: ${deaf.length ? "deaf: " + deaf.join(", ") : "all hear it"}`, r.topics.length > 0 && deaf.length === 0, { topics: r.topics, deaf });
    }
    const wk = (() => { const d = new Date(nextWeek + "T12:00:00Z"); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); const f = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 6); return [f, d.toISOString().slice(0, 10)]; })();
    const sch = await api("GET", `/volunteer-hub/schedule?from=${wk[0]}&to=${wk[1]}`, tok);
    const tagged = ((sch.body && sch.body.shifts) || []).filter(x => x.conflicts > 0).length;
    ok("§G next week's Schedule conflicts counts the overlap the cards tag (W-1126-Volunteers-01: it said 0)",
      sch.status === 200 && tagged === 2 && sch.body.conflicts === 1 && (sch.body.shownConflicts || []).length === 1 && sch.body.shownConflicts[0].name === "Wren Calloway",
      { status: sch.status, tagged, conflicts: sch.body && sch.body.conflicts, shown: sch.body && sch.body.shownConflicts, week: sch.body && sch.body.week });
    const shDel = await told("POST", `/removals/shift/${SB}`, { confirm: true });
    const deafS = hears(VOL, shDel);
    ok(`§G a shift deleted (${shDel.status}) reaches every Volunteers panel: ${deafS.length ? "deaf: " + deafS.join(", ") : "all hear it"}`, shDel.status < 300 && deafS.length === 0, { status: shDel.status, topics: shDel.topics, deafS, body: shDel.body });
    const shUndo = await told("POST", "/removals/undo", { undoIds: (shDel.body && (shDel.body.undoIds || (shDel.body.undoId ? [shDel.body.undoId] : []))) || [] });
    const deafU = hears(["volunteers.schedule", "volunteers.shifts"], shUndo);
    ok(`§G its Undo from Recent changes (${shUndo.status}) reaches the Schedule (the fleet saw 1 card, 0 tags until reload)`, shUndo.status < 300 && deafU.length === 0, { status: shUndo.status, topics: shUndo.topics, deafU, body: shDel.body });
    const former = await told("POST", `/donors/${P("wren")}/volunteer-status`, { status: "former" });
    const deafF = hears(VOL, former);
    ok(`§G Mark as former reaches every Volunteers panel: ${deafF.length ? "deaf: " + deafF.join(", ") : "all hear it"}`, former.status < 300 && deafF.length === 0, { status: former.status, topics: former.topics, deafF });
    let audit = [];
    for (let i = 0; i < 20 && !audit.length; i++) {   // the audit row is written as the answer finishes
      audit = await q(`SELECT action, entity_id FROM fin_audit_log WHERE org_id=$1 AND entity_id=$2 AND action LIKE 'marked a volunteer%'`, [ORG, P("wren")]);
      if (!audit.length) await new Promise(r => setTimeout(r, 150));
    }
    const rc = await api("GET", "/recent-changes", tok);
    const rcLine = ((rc.body && rc.body.rows) || []).find(r => /Wren Calloway/.test(r.sentence || ""));
    ok("§G Mark as former writes its Recent changes line, through the audit trail (W-1126-Volunteers-01)", audit.length === 1 && !!rcLine && /former volunteer/.test(rcLine.sentence), { audit, rcLine, rows: ((rc.body && rc.body.rows) || []).map(r => r.sentence).slice(0, 5) });
    const evG = await told("POST", "/events", { name: "Heron Reading Night", date: today, eventType: "community", description: "Readings." });
    const EG = evG.body && (evG.body.id || (evG.body.event && evG.body.event.id));
    const guest = await told("POST", `/events/${EG}/attendees`, { donorIds: [P("eli")] });
    const deafE = hears(EVT, guest);
    ok(`§G a guest added reaches every Events panel: ${deafE.length ? "deaf: " + deafE.join(", ") : "all hear it"}`, guest.status < 300 && deafE.length === 0, { status: guest.status, topics: guest.topics, deafE });
  }

  // ── §J · FRESH-3 item 3: CAMPAIGNS, OVERVIEW AND THE CAMPAIGN LIST COUNT THE SAME CAMPAIGNS ──
  // W-1126-Fundraising-01: "The Campaigns list says 'No campaigns yet' while Overview lists 5 active goal campaigns".
  {
    const end = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 60); return d.toISOString().slice(0, 10); })();
    const start = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 10); return d.toISOString().slice(0, 10); })();
    for (const n of ["Heron Roof Fund", "Heron Reading Room"]) await api("POST", "/fundraising/campaigns", tok, { name: n, goalAmount: 5000, startDate: start, endDate: end, goalCategory: "project" });
    const ov = await api("GET", "/fundraising/overview", tok);
    const list = await api("GET", "/fundraising/campaigns", tok);
    const top = ((ov.body && ov.body.goals) || []).filter(g => g.isTopLevel);
    const active = top.filter(g => g.lifecycle === "active").length;
    // Taken back out: §2's lead event card is Fundraising Overview's hero only when no goal is running.
    await q(`DELETE FROM campaigns WHERE org_id=$1 AND name IN ('Heron Roof Fund','Heron Reading Room')`, [ORG]);
    ok("§J the Campaigns list (Overview's goals), Overview's Active goals and /fundraising/campaigns count the same campaigns",
      ov.status === 200 && top.length >= 2 && active === (ov.body.rollup && ov.body.rollup.activeGoalCount) && Array.isArray(list.body) && list.body.length === top.length,
      { top: top.length, active, rollup: ov.body && ov.body.rollup && ov.body.rollup.activeGoalCount, list: Array.isArray(list.body) ? list.body.length : list.body });
  }

  // ── §I · FRESH-3 item 5: AN IMPORT'S UNDO IS NOT HELD BY ITS OWN GIFT LINE ──
  // W-1126-Finance-02: "Import undo removes the people it created even though its own timeline line
  // exists (that line isn't activity)". A gift line whose gift_id is gone (the gift removed before the
  // undo) counted as "a line on their timeline" and kept the person; a note she wrote still does.
  {
    const UP = require("../server/imports/undoPeople");
    const qq = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); };
    const IMP = { id: "imp_" + ORG + "_fresh3", created_at: new Date(require("./clock").testNow().getTime() - 3600e3).toISOString() };
    await q(`INSERT INTO donors (id,org_id,name,stage,status,person_types,created_import_id,created_by,created_by_name) VALUES ($1,$2,'Jory Imported','prospect','active','["donor"]'::jsonb,$3,$4,'Odile Marsh') `, [P("jory"), ORG, IMP.id, ME]);

    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ($1,$2,$3,'gift','Gave $40.',$4,$5,'Odile Marsh')`, ["int_" + ORG + "_jory_g", ORG, P("jory"), today, ME]);
    const kept = await UP.peopleWithActivity(qq, ORG, IMP);
    ok("§I a person the import made, with only its gift line (gift gone), is not held back by the undo", kept.length === 0, kept);
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ($1,$2,$3,'note','Called about the gala.',$4,$5,'Odile Marsh')`, ["int_" + ORG + "_jory_n", ORG, P("jory"), today, ME]);
    const kept2 = await UP.peopleWithActivity(qq, ORG, IMP);
    ok("§I …and a note she wrote since still keeps them, named", kept2.length === 1 && /a note/.test(kept2[0].why), kept2);
  }

  // ── §H · FRESH-3 item 4: ONE PERSON, TWO ORGS, TWO TABS: THE OTHER TAB KEEPS ITS ORG ──
  // The fleet, 26 Nov: "flipping between Harborlight and org_stagewalk, forcing five re-sign-ins".
  // Tab A is painted for ORG; tab B switches the same person to ORG2 (the browser now holds B's
  // token). Tab A names its org and its person on every request (lib/orgBinding.js).
  {
    const ORG2 = ORG + "_two";
    await q(`DELETE FROM org_memberships WHERE org_id=$1`, [ORG2]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [ORG2]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [ORG2]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG2]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,org_kind) VALUES ($1,'Stale Two Plover Trust',$2,1,'active','team','America/New_York','internal_test')`, [ORG2, ORG2.replace(/_/g, "-")]);
    await q(`INSERT INTO org_memberships (id,user_id,org_id,role,created_by,created_by_name) VALUES ($1,$2,$3,'admin','system:test/stale2','FRESH-3 test')`, ["mem_" + ORG2, ME, ORG2]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Pim Plover','admin')`, ["u_" + ORG2, ORG2, `${ORG2}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
    const BASE_H = process.env.BASE || "http://localhost:5601";
    const call = async (method, url, token, headers = {}, body) => {
      const r = await fetch(BASE_H + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const A = await login(EMAIL, PASSWORD);                          // tab A's session, in ORG
    const sw = await call("POST", "/auth/switch-org", A, {}, { orgId: ORG2 });   // tab B switches
    const B = sw.body && sw.body.token;
    ok("§H fixtures: the same person switched to the second org in tab B", sw.status === 200 && !!B && sw.body.org && sw.body.org.id === ORG2, { status: sw.status, body: sw.body });
    const tabA = { "X-Steward-Org": ORG, "X-Steward-User": ME };
    const read = await call("GET", "/donors?limit=50", B, tabA);
    const names = ((read.body && (read.body.donors || read.body.rows)) || (Array.isArray(read.body) ? read.body : [])).map(d => d.name);
    ok("§H tab A's next read, with the browser's new token, keeps its org (its people, not the second org's)", read.status === 200 && names.includes("Ada Quill"), { status: read.status, names: names.slice(0, 5) });
    const me = await call("GET", "/me", B, tabA);
    ok("§H …and /me tells tab A it is still where it was", me.status === 200 && me.body.org && me.body.org.id === ORG, { status: me.status, org: me.body.org && me.body.org.id });
    const gA = await call("POST", `/donors/${P("ada")}/gifts`, B, tabA, { amount: 31, date: today, type: "cash" });
    const landed = await q(`SELECT org_id FROM gifts WHERE donor_id=$1 AND amount=31`, [P("ada")]);
    ok("§H …a gift saved in tab A lands in tab A's org, nobody signed out", gA.status < 300 && landed.length === 1 && landed[0].org_id === ORG, { status: gA.status, landed });
    const meB = await call("GET", "/me", B, { "X-Steward-Org": ORG2, "X-Steward-User": ME });
    ok("§H …while tab B works in the org it switched to", meB.status === 200 && meB.body.org && meB.body.org.id === ORG2, { status: meB.status, org: meB.body.org && meB.body.org.id });
    const old = await call("GET", "/donors?limit=1", A, tabA);
    ok("§H the old session is still signed out (switchOrg.js unchanged)", old.status === 401, old.status);
    const noUser = await call("GET", "/donors?limit=1", B, { "X-Steward-Org": ORG });
    ok("§H a tab that names no person is answered as before: 409, reload", noUser.status === 409 && noUser.body.code === "org_changed", { status: noUser.status, body: noUser.body });
    const other = await login(`${ORG2}@test.local`, PASSWORD);
    const cross = await call("GET", "/donors?limit=1", other, { "X-Steward-Org": ORG, "X-Steward-User": "u_" + ORG2 });
    const forged = await call("GET", "/donors?limit=1", other, { "X-Steward-Org": ORG, "X-Steward-User": ME });
    ok("§H someone else's session never reaches an org they are not in, whatever the tab says (409)", cross.status === 409 && forged.status === 409, { cross: cross.status, forged: forged.status });
  }

  // ── THE BROWSER LEG ────────────────────────────────────────────────────────
  const ev1 = await api("POST", "/events", tok, { name: "Heron Supper Club", date: today, eventType: "gala", description: "A supper." });
  const E1 = ev1.body && (ev1.body.id || (ev1.body.event && ev1.body.event.id));
  const ev2 = await api("POST", "/events", tok, { name: "Heron Spring Gala", date: today, eventType: "gala", description: "The gala." });
  const E2 = ev2.body && (ev2.body.id || (ev2.body.event && ev2.body.event.id));
  await api("POST", `/events/${E2}/attendees`, tok, { donorIds: [P("eli")] });
  await api("POST", `/donors/${P("fay")}/gifts`, tok, { amount: 400, date: today, type: "cash", eventId: E2 });
  const th = await api("POST", `/donors/${P("gus")}/threads`, tok, { label: "Call Gus about the gala", due: today, ownerId: ME });
  // FRESH-2 fixtures: Ivy has a record note and no gift; Vic volunteers; a draft campaign for Overview.
  await person("ivy", "Ivy Tamsin");
  await q(`UPDATE donors SET notes='Met at the spring open house.', notes_at=NOW() WHERE org_id=$1 AND id=$2`, [ORG, P("ivy")]);
  await q(`INSERT INTO donors (id,org_id,name,stage,status,person_types,created_by,created_by_name) VALUES ($1,$2,'Vic Larkspur','prospect','active','["volunteer"]'::jsonb,'system:test/stale2','FRESH-2 test')`, [P("vic"), ORG]);
  await api("POST", `/donors/${P("vic")}/volunteer-hours`, tok, { date: today, hours: 2, role: "Shelving" });
  const camp = await api("POST", "/campaigns", tok, { name: "Heron Autumn Letter", subject: "Autumn at the Heron Society", body: "<p>Hello</p>" });
  const thD = await api("POST", `/donors/${P("dev")}/threads`, tok, { label: "Ask Devi about the reading room", due: today, ownerId: ME });
  ok("FRESH-2 fixtures: Ivy's note, Vic's hours, a draft campaign, Devi's step due today", camp.status < 300 && thD.status < 300, { camp: camp.status, thread: thD.status });
  await api("POST", `/donors/${P("hal")}/volunteer-hours`, tok, { date: today, hours: 2, role: "Shelving" });
  ok("browser fixtures: two events, a guest, an event gift and a next step due today", !!E1 && !!E2 && th.status < 300, { E1, E2, thread: th.status });

  // ── §D · THE CENSUS: EVERY WRITE THE FLEET CLICKED NAMES WHAT IT CHANGED ──
  // A write that answers "none" (or no header) re-reads nothing on screen, so its counts wait
  // for a reload. Each one here must name the topic its counts listen for (lib/changes.js).
  const BASE = process.env.BASE || "http://localhost:5601";
  const said = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
    await r.text();
    return { status: r.status, topics: String(r.headers.get("x-steward-changed") || "").split(",") };
  };
  await q(`INSERT INTO donors (id,org_id,name,stage,status,person_types,created_by,created_by_name) VALUES ($1,$2,'Ivo Census','prospect','active','["contact"]'::jsonb,'system:test/stale2','FRESH-1 test')`, [P("ivo"), ORG]);
  const evD = await api("POST", "/events", tok, { name: "Heron Census Supper", date: today, eventType: "community", description: "A supper." });
  const ED = evD.body && (evD.body.id || (evD.body.event && evD.body.event.id));
  const census = [
    ["a person moved to the trash", "DELETE", `/donors/${P("ivo")}`, null, "person"],
    ["Restore from Settings → Trash", "POST", "/trash/people/restore", { ids: [P("ivo")] }, "person"],
    ["moved to the trash again", "DELETE", `/donors/${P("ivo")}`, null, "person"],
    ["Empty trash", "POST", "/donors/purge-trash", { confirm: "empty", olderThanDays: null }, "person"],
    ["a $100 cash gift saved", "POST", `/donors/${P("ada")}/gifts`, { amount: 100, date: today, type: "cash" }, "gift"],
    ["an attendee added", "POST", `/events/${ED}/attendees`, { donorIds: [P("bram")] }, "event"],
  ];
  for (const [what, m, url, body, topic] of census) {
    const r = await said(m, url, body);
    ok(`§D census: ${what} answers ${r.status} and names "${topic}" (FRESH-1 item 1)`, r.status < 300 && r.topics.includes(topic), r);
  }

  // FRESH-1 item 3: Notes or tags filters, by whole words, and a nonsense word finds nobody.
  await q(`UPDATE donors SET notes='Met for coffee before the gala' WHERE org_id=$1 AND id=$2`, [ORG, P("cleo")]);
  const textN = async w => { const r = await api("GET", `/donors?limit=5&roleCounts=1&where=${encodeURIComponent(JSON.stringify({ join: "and", conditions: [{ field: "text", op: "contains", value: w }] }))}`, tok); return r.status === 200 ? r.body.total : `status ${r.status}`; };
  ok("§D Notes or tags 'zzzzqq' finds nobody (FRESH-1 item 3)", (await textN("zzzzqq")) === 0, await textN("zzzzqq"));
  ok("§D Notes or tags 'GALA' finds Cleo's note, any case", (await textN("GALA")) === 1, await textN("GALA"));
  ok("§D …by whole words: 'gal' and 'offee' find nobody", (await textN("gal")) === 0 && (await textN("offee")) === 0, [await textN("gal"), await textN("offee")]);
  ok("§D …and what she typed is a word, never a pattern: '(' and '.*' find nobody and do not fail", (await textN("(")) === 0 && (await textN(".*")) === 0, [await textN("("), await textN(".*")]);

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    localStorage.setItem("steward_test_hooks", "1");   // FRESH-2 §9 and §10: lib/changes.js's __stewardWrote
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  // A write made elsewhere in this browser (another panel, Atlas's Yes): sent, then handed to the
  // channel exactly as api.js hands its own writes (lib/changes.js window.__stewardWrote).
  const wroteHere = (method, url, body) => page.evaluate(async ([m, u, b, api, t]) => {
    const r = await fetch(api + u, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: b ? JSON.stringify(b) : undefined });
    window.__stewardWrote(u, m, b ? JSON.stringify(b) : null);
    return r.status;
  }, [method, url, body || null, process.env.BASE || "http://localhost:5601", lg.body.token]);
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const text = async sel => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true).catch(() => false);
  const noReload = async (label, fn) => {
    const before = loads;
    try { await fn(); } catch (e) { ok(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]); return; }
    ok(label + ": no page load happened", loads === before, { loads: loads - before });
  };
  // A figure tile's number, by its label, inside a region.
  const tile = (sel, label) => page.evaluate(([s, l]) => {
    const root = document.querySelector(s); if (!root) return null;
    const el = [...root.querySelectorAll("*")].find(e => e.children.length === 0 && e.textContent.trim() === l);
    const box = el && el.closest("div[class], div[style]") && el.parentElement && el.parentElement.parentElement;
    const m = box && box.textContent.replace(l, "").match(/\d+/);
    return m ? Number(m[0]) : null;
  }, [sel, label]);

  // ── §1 · THE EVENT PAGE: GUESTS ADDED AND MARKED COME ─────────────────────
  await open(`/app/events`);
  await noReload("§1", async () => {
    await page.getByText("Heron Supper Club").first().click();
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    const s = page.getByPlaceholder("Search everyone…");
    for (const n of ["Ada Quill", "Bram Oduya"]) { await s.fill(n.split(" ")[0]); await page.getByRole("button", { name: new RegExp(n) }).first().click({ timeout: 10000 }); }
    await page.getByRole("button", { name: /^Add \d+ (donor|person|people)/ }).first().click();
    const added = await until(() => /Attendees \(2\)/.test(document.body.innerText));
    ok("§1 Attendees says 2 after the add", added, (await page.locator("body").innerText()).match(/Attendees \(\d+\)/));
    const inv = await until(() => { const r = document.querySelector('[data-testid="ev-report"]'); return r && /2 invited/.test(r.innerText); });
    ok("§1 After the event says 2 invited", inv, await text('[data-testid="ev-report"]').then(t => t.slice(0, 160)));
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-testid="event-detail"] button:has-text("Invited")').last().click();
      await page.locator('[data-testid="event-detail"] select').first().selectOption("attended");
      await page.waitForTimeout(400);
    }
    const came = await until(() => { const r = document.querySelector('[data-testid="ev-report"]'); return r && /2 came/.test(r.innerText); });
    ok("§1 After the event says 2 came (W-1107-Volunteers-01)", came, await text('[data-testid="ev-report"]').then(t => t.slice(0, 200)));
  });

  // ── §2 · FUNDRAISING: THE DESK'S ATTENDANCE MOVES THE LEAD CARD ───────────
  await open(`/app/fundraising`);
  await noReload("§2", async () => {
    const lead = page.locator('[data-testid="fr-lead-event"]');
    await lead.waitFor({ timeout: 20000 });
    const before = await text('[data-testid="fr-lead-event"]');
    ok("§2 the lead card is the gala, nobody came yet", /Heron Spring Gala/.test(before) && /Came\s*0/.test(before), before.slice(0, 160));
    await page.locator('[data-fr-section="campaigns"]').first().click();
    await page.getByRole("button", { name: "Tickets & sponsors" }).first().click();
    await page.getByText("Heron Spring Gala").first().click();
    const row = page.locator('[data-testid="event-guest-row"]', { hasText: "Eli Strand" });
    await row.getByRole("button", { name: "Came" }).click({ timeout: 15000 });
    await page.locator('[data-testid="event-save-attendance"]').click();
    await page.getByText("Attendance saved").first().waitFor({ timeout: 10000 });
    await page.locator('[data-fr-section="overview"]').first().click();
    const moved = await until(() => /\bCame\s*1\b/.test((document.querySelector('[data-testid="fr-lead-event"]') || {}).innerText || ""));
    ok("§2 the lead card says 1 came, with no reload (W-1107-Volunteers-01)", moved, (await text('[data-testid="fr-lead-event"]')).slice(0, 200));
  });

  // ── §3 · A NEXT STEP SNOOZED TO LATER LEAVES THE BADGE ────────────────────
  // From the profile's Thread (Home's Thread rows carry the same menu).
  await open(`/donors/${P("gus")}`);
  await noReload("§3", async () => {
    const badge = '[data-testid="tasks-rail-badge"]';
    await page.locator(badge).first().waitFor({ timeout: 20000 });
    const b0 = Number(await text(badge)) || 0;
    ok("§3 the Tasks badge counts the next step due today", b0 >= 1, b0);
    if (process.env.STALE2_SHOTS) await page.screenshot({ path: path.join(process.env.STALE2_SHOTS, "home.png"), fullPage: true });
    await page.getByRole("button", { name: /More actions for Gus Penhale/ }).first().click({ timeout: 15000 });
    await page.getByRole("button", { name: /revisit on a date/ }).click();
    await page.locator('[role="menu"]').getByRole("button", { name: "Snooze", exact: true }).click();
    const moved = await until(([n]) => { const el = document.querySelector('[data-testid="tasks-rail-badge"]'); return !el || Number(el.textContent || 0) === n - 1; }, [b0]);
    ok("§3 the badge drops by one, with no reload (W-1107-Volunteers-15)", moved, { before: b0, after: await text(badge) });
  });

  // ── §4 · HOURS LOGGED ELSEWHERE MOVE THE OPEN VOLUNTEER PANEL ─────────────
  // The kiosk, the Volunteers page or Atlas log hours while this profile is
  // open; Atlas's told() announces it on the one channel (the bell's worker
  // marks do the same for the kiosk), and the panel's total re-reads.
  await open(`/donors/${P("hal")}`);
  await noReload("§4", async () => {
    const tot = '[data-testid="volunteer-total"]';
    await page.locator('[data-tab="volunteer"], [data-tab="giving"]').first().waitFor({ timeout: 20000 });
    await page.locator((await page.locator('[data-tab="volunteer"]').count()) ? '[data-tab="volunteer"]' : '[data-tab="giving"]').first().click({ timeout: 20000 });   // VOL-3: a volunteer's panel sits on their Volunteer tab
    await page.locator(tot).first().waitFor({ timeout: 20000 });
    const before = await text(tot);
    const logged = await api("POST", `/donors/${P("hal")}/volunteer-hours`, tok, { date: today, hours: 3, role: "Sorting" });
    ok("§4 three more hours are logged elsewhere", logged.status === 201, { status: logged.status, body: logged.body && (logged.body.error || "") });
    // Atlas or Tell Steward logged it: VOICE-4's told(), which may have changed anything.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: {} })));
    const moved = await until(([b]) => { const el = document.querySelector('[data-testid="volunteer-total"]'); return el && el.textContent.replace(/\s+/g, " ").trim() !== b; }, [before]);
    ok("§4 the panel's hours move, with no reload (W-1107-Volunteers-08)", moved, { before, after: await text(tot) });
  });

  // ── §5 · EMPTY TRASH TAKES THE ROW, THE SENTENCE AND THE COUNT ────────────
  await q(`INSERT INTO donors (id,org_id,name,stage,status,person_types,created_by,created_by_name) VALUES ($1,$2,'Juno Trashwell','prospect','active','["contact"]'::jsonb,'system:test/stale2','FRESH-1 test')`, [P("juno"), ORG]);
  await api("DELETE", `/donors/${P("juno")}`, tok);
  await open(`/app/settings?section=trash`);
  await noReload("§5", async () => {
    await page.locator('[data-testid="trash-list"]').getByText("Juno Trashwell").first().waitFor({ timeout: 20000 });
    ok("§5 the trash shows Juno and says 1 person", /^1 person is in the trash/.test(await text('[data-testid="trash-list"] > div')), await text('[data-testid="trash-list"] > div'));
    await page.locator('[data-testid="empty-trash-go"]').click({ timeout: 15000 });
    await page.locator('[data-testid="empty-trash-confirm"]').click();
    await page.locator('[data-testid="empty-trash-done"]').waitFor({ timeout: 15000 });
    const rowGone = await until(() => !/Juno Trashwell/.test((document.querySelector('[data-testid="trash-list"]') || {}).innerText || ""));
    ok("§5 after Empty trash the row is gone, with no reload (FRESH-1 item 1)", rowGone, await text('[data-testid="trash-list"]').then(t => t.slice(0, 160)));
    const sentence = await until(() => /^0 people are in the trash/.test(((document.querySelector('[data-testid="trash-list"] > div') || {}).innerText || "").trim()));
    ok("§5 …and the sentence says 0 people are in the trash", sentence, await text('[data-testid="trash-list"] > div'));
    const tab = await until(() => /Trash \(0\)/.test(document.body.innerText) && !/Trash \(1\)/.test(document.body.innerText));
    ok("§5 …and Settings says Trash (0)", tab, (await page.locator("body").innerText()).match(/Trash \(\d+\)/g));
  });

  // ── §7 · THE NOTES SUMMARY LINE FOLLOWS A GIFT SAVED AND DELETED ──────────
  // Prod (Jarvis, 25 Nov): "Notes summary line stale until reload" after gift save and delete.
  await open(`/donors/${P("ivy")}`);
  await noReload("§7", async () => {
    const line = '[data-testid="dp-notes-giving"]';
    const tabTo = t => page.locator(`[data-tab="${t}"]`).first().click({ timeout: 20000 });
    await tabTo("notes");
    await page.locator(line).waitFor({ timeout: 20000 });
    ok("§7 the Notes line says Ivy hasn't given yet", /hasn't given yet/.test(await text(line)), await text(line));
    await tabTo("giving");
    await page.getByRole("button", { name: "+ Add Gift" }).click({ timeout: 15000 });
    await page.getByPlaceholder("Amount ($)").fill("100");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Total: $100").first().waitFor({ timeout: 15000 });
    await tabTo("notes");
    const gave = await until(() => /has given \$100 in all/.test((document.querySelector('[data-testid="dp-notes-giving"]') || {}).textContent || ""));
    ok("§7 after the gift, the Notes line says Ivy has given $100, with no reload (FRESH-2 item 5)", gave, await text(line));
    await tabTo("giving");
    await page.getByRole("button", { name: "Delete", exact: true }).first().click({ timeout: 15000 });
    await page.getByRole("button", { name: "Delete gift" }).click({ timeout: 15000 });
    await page.getByText("Total: $0").first().waitFor({ timeout: 15000 });
    await tabTo("notes");
    const back = await until(() => /hasn't given yet/.test((document.querySelector('[data-testid="dp-notes-giving"]') || {}).textContent || ""));
    ok("§7 …and after the gift is deleted, it says she hasn't given yet again", back, await text(line));
  });

  // ── §8 · OVERVIEW'S RECENT SENDS DROPS A DELETED CAMPAIGN ─────────────────
  await open(`/app/communications`);
  await noReload("§8", async () => {
    const recent = '[data-testid="comms-recent-sends"]';
    await page.locator(recent).getByText("Heron Autumn Letter").first().waitFor({ timeout: 20000 });
    await page.locator("button:visible", { hasText: /^Campaigns/ }).first().click();
    const row = page.locator('[data-testid="camp-more"]').locator("xpath=ancestor::*[contains(., 'Heron Autumn Letter')][1]");
    await row.locator('[data-testid="camp-more"]').first().click({ timeout: 15000 });
    await page.locator('[data-testid="camp-delete"]').click();
    await page.getByRole("button", { name: "Delete campaign" }).click();
    await page.locator("button:visible", { hasText: /^Overview$/ }).first().click();
    const dropped = await until(() => { const el = document.querySelector('[data-testid="comms-recent-sends"]'); return el && !/Heron Autumn Letter/.test(el.innerText); });
    ok("§8 Overview's Recent sends no longer lists the deleted campaign, with no reload", dropped, await text(recent).then(t => t.slice(0, 200)));
  });

  // ── §9 · A VOLUNTEER DELETED ELSEWHERE LEAVES THE VOLUNTEERS HEADER ──────
  // DELETE /donors/:id says "person", never "volunteer": the hub heard only volunteer writes.
  await open(`/app/volunteers`);
  await noReload("§9", async () => {
    const count = () => page.evaluate(() => { const m = document.body.innerText.match(/(\w+) active volunteers? on the roster/i); return m ? m[1].toLowerCase() : null; });
    await page.getByText(/active volunteers? on the roster/i).first().waitFor({ timeout: 20000 });
    const before = await count();
    const st = await wroteHere("DELETE", `/donors/${P("vic")}`);
    const moved = await until(([b]) => { const m = document.body.innerText.match(/(\w+) active volunteers? on the roster/i); return m && m[1].toLowerCase() !== b; }, [before]);
    ok("§9 a volunteer moved to the trash elsewhere: the header moves, with no reload", st === 200 && moved, { status: st, before, after: await count() });
  });

  // ── §10 · HOME'S RAIL PERSON VIEW (THE MINI-PROFILE) FOLLOWS A GIFT ───────
  // Devi's step is due today, so her row is on Home's Thread; a plain click opens the rail.
  await open(`/dashboard`);
  await noReload("§10", async () => {
    const rowMain = page.locator(".attn-row-main", { hasText: "Devi Halloran" }).first();
    await rowMain.waitFor({ timeout: 20000 });
    const box = await rowMain.boundingBox();
    await rowMain.click({ position: { x: Math.max(10, box.width - 30), y: Math.min(20, box.height / 2) } });
    const rail = '[data-testid="rail-donor"]';
    await page.locator(rail).waitFor({ timeout: 15000 });
    ok("§10 the rail opens Devi with no gift on file", /No gift on file yet/.test(await text(rail)), await text(rail));
    const st = await wroteHere("POST", `/donors/${P("dev")}/gifts`, { amount: 75, date: today, type: "cash" });
    const moved = await until(() => /Lifetime giving\s*\$75/.test((document.querySelector('[data-testid="rail-donor"]') || {}).innerText || ""));
    ok("§10 after a gift, the rail says Lifetime giving $75, with no reload", st < 300 && moved, { status: st, rail: await text(rail) });
  });

  // ── §6 · A CHUNK GONE WITH A DEPLOY REOPENS THE PAGE ONCE ─────────────────
  // After a deploy the open page's own chunks still load (they came with it) and every chunk it has
  // not asked for yet is gone. The route answers those as the host does once the old file is gone;
  // a page loaded after the deploy is the new build, and its own files are all there.
  // Each tab is its own chunk (HARDEN-2), so a tab opened from the rail asks for one.
  const ctx6 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });   // the worker would fetch the chunks out of the route's sight
  await ctx6.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const page6 = await ctx6.newPage();
  let booted = new Set(), deployed = false, blocked = 0;
  await page6.route(/\/assets\/[^/]+\.(js|css)$/, r => {
    const f = r.request().url().split("/assets/")[1];
    if (!deployed || booted.has(f)) { booted.add(f); return r.continue(); }
    blocked++; return r.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" });
  });
  let loads6 = 0;
  // The reopened page is the new build from its first request on.
  page6.on("request", r => { if (r.isNavigationRequest() && r.frame() === page6.mainFrame()) { loads6++; deployed = false; booted = new Set(); } });
  const rail = name => page6.locator(`text="${name}" >> visible=true`).first();
  await page6.goto(`${APP}/app/donors`, { waitUntil: "networkidle", timeout: 60000 });
  await page6.locator("input.donors-search").waitFor({ timeout: 30000 });
  await page6.waitForTimeout(16000);   // past lib/chunkReload.js's settle, as a page open a while is
  const l0 = loads6; deployed = true;
  await rail("Grants").click({ timeout: 20000 });
  let reopened = false;
  for (let i = 0; i < WAIT / 200 && !reopened; i++) { await page6.waitForTimeout(200); reopened = loads6 > l0; }
  await page6.waitForLoadState("networkidle").catch(() => {});
  await page6.waitForTimeout(1500);
  ok("§6 a tab whose chunk is gone reopens the page, once (FRESH-1 item 2)", reopened && blocked >= 1 && loads6 - l0 === 1, { blocked, loads: loads6 - l0 });
  ok("§6 …at the tab she opened, which draws (no error boundary)", /grants/.test(page6.url()) && (await page6.locator("text=Something went wrong").count()) === 0, page6.url());
  // A second deploy lands at once, and the next tab's chunk is gone too: the second failure in a
  // row shows the error with its Reload, and nothing loops.
  if (process.env.STALE2_SHOTS) await page6.screenshot({ path: path.join(process.env.STALE2_SHOTS, "reopened.png") });
  const l1 = loads6; deployed = true; const b1 = blocked;
  await rail("Donors").click({ timeout: 20000 });
  await page6.waitForTimeout(5000);
  const reloadBtn = await page6.getByRole("button", { name: "Reload" }).count();
  ok("§6 gone again within the minute: no second reopen, the error with a Reload button", blocked > b1 && loads6 === l1 && reloadBtn >= 1, { blocked: blocked - b1, loads: loads6 - l1, reloadBtn });
  await ctx6.close();

  // ── §11 · FRESH-3 item 4: ONE BROWSER, TWO TABS, ONE PERSON, ONE SWITCH ────
  // One context is one browser profile: the tabs share localStorage and the cookie jar. Tab A is
  // on Ada's profile in the Heron Society; tab B switches Odile to the Plover Trust the way the
  // switcher does (POST /auth/switch-org, the answer into localStorage). Tab A must not sign out,
  // must offer to follow or stay, and after Stay here a gift saved in tab A lands in tab A's org.
  {
    const lg11 = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const ctx11 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx11.addInitScript(([tk, u, o]) => {
      if (!localStorage.getItem("npe_token")) { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); }
    }, [lg11.body.token, JSON.stringify(lg11.body.user), JSON.stringify(lg11.body.org)]);
    const tabA = await ctx11.newPage();
    let signedOut = 0;
    tabA.on("framenavigated", f => { if (f === tabA.mainFrame() && /\/login/.test(f.url())) signedOut++; });
    await tabA.goto(`${APP}/donors/${P("ada")}`, { waitUntil: "networkidle", timeout: 60000 });
    await tabA.getByRole("tab", { name: /^Giving/ }).first().click({ timeout: 30000 }).catch(() => tabA.locator('[data-tab="giving"]').first().click());
    const tabB = await ctx11.newPage();
    await tabB.goto(`${APP}/app/donors`, { waitUntil: "networkidle", timeout: 60000 });
    const swB = await tabB.evaluate(async ([api, org]) => {
      const r = await fetch(api + "/auth/switch-org", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("npe_token") }, body: JSON.stringify({ orgId: org }) });
      const b = await r.json();
      if (r.ok) { localStorage.setItem("npe_token", b.token); localStorage.setItem("npe_user", JSON.stringify(b.user)); localStorage.setItem("npe_org", JSON.stringify(b.org)); }
      return { status: r.status, org: b.org && b.org.id };
    }, [process.env.BASE || "http://localhost:5601", ORG + "_two"]);
    await tabA.bringToFront();
    const banner = tabA.locator('[data-testid="org-changed-banner"]');
    await banner.waitFor({ timeout: WAIT }).catch(() => {});
    const said = await banner.innerText().catch(() => "(no banner)");
    ok("§11 tab B switched; tab A says \"You switched to Stale Two Plover Trust in another tab. Reload to follow, or stay here\", nobody signed out",
      swB.status === 200 && /You switched to Stale Two Plover Trust in another tab\. Reload to follow, or stay here\./.test(said) && signedOut === 0, { swB, said, signedOut });
    await tabA.locator('[data-testid="org-changed-stay"]').click({ timeout: 10000 }).catch(() => {});
    await tabA.getByRole("button", { name: /\+ Add Gift/ }).first().click({ timeout: 15000 });
    await tabA.locator('input[placeholder="Amount ($)"]').first().fill("37");
    await tabA.getByRole("button", { name: /^Save$/ }).first().click();
    let landed = [];
    for (let i = 0; i < 40 && !landed.length; i++) { await tabA.waitForTimeout(250); landed = await q(`SELECT org_id FROM gifts WHERE donor_id=$1 AND amount=37`, [P("ada")]); }
    ok("§11 after Stay here, a gift saved in tab A lands in tab A's org, and tab A is still signed in", landed.length === 1 && landed[0].org_id === ORG && signedOut === 0 && !/\/login/.test(tabA.url()), { landed, signedOut, url: tabA.url() });
    await tabB.reload({ waitUntil: "networkidle" });
    const bOrg = await tabB.evaluate(() => { try { return JSON.parse(localStorage.getItem("npe_org")).id; } catch { return null; } });
    ok("§11 …and tab B, reloaded, is in the org it switched to", bOrg === ORG + "_two" && !/\/login/.test(tabB.url()), { bOrg, url: tabB.url() });
    await ctx11.close();
  }

  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
