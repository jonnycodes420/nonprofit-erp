// BUILD-81 — THE THREAD: the surface behind "log a conversation, get the next
// step, and it keeps asking until you've done it".
//
//   §1  the defaults table is the spec's, verbatim (shared module — the ONE
//       definition both sides read)
//   §2  logging a conversation: interaction + thread with the actor; the
//       next-step decision rides the same request; SKIP is recorded as
//       skipped, never as nothing; a missing decision is a 400 (silence is
//       not accepted)
//   §3  one open thread per donor: the next conversation IS the outcome —
//       the open thread closes pointing at the new interaction, and the
//       answer decides whether another opens; the meeting/visit follow-on
//       chain rides along and prefills
//   §4  NO SILENT CLOSE — proven at the DATABASE (raw UPDATE refused by the
//       CHECK constraint), and the dismiss route takes only the fixed
//       reasons; "revisit" is a snooze that resurfaces on its date
//   §5  a LIVE gift opens a "Thank" thread (+2 days); never for
//       sample/deceased/do-not-contact/non-person donors; never a second
//       thread on a donor with one open
//   §6  threads are NEVER inferred from imported data — the same import that
//       creates donors and gifts creates ZERO threads
//   §7  GET /threads composition: overdue first, the stat line's three
//       numbers, daysOpen, hasAny=false on a fresh org
//   §8  the setup checklist's "conversation" item ticks on the FIRST thread,
//       not on a fresh org
//   §9  drift-done with a line opens a thread (BUILD-76's byproduct logging,
//       now visibly the point); drift-done skip opens nothing
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b81thr";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);

async function reset() {
  const CHILD = ["threads", "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "notification_sends", "milestone_drafts",
    "note_reminders", "metric_snapshots", "import_merges"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B81 Thread Org','b81-thread',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b81thr',$1,'b81thr@test.local',$2,'Thread Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b81t4010',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b81t',$1,'General',false)`, [ORG]);
  const donors = [
    ["d_b81_ruth", "Ruth Harmon", "ruth@b81.test", {}],
    ["d_b81_bill", "Bill Okafor", "bill@b81.test", {}],
    ["d_b81_mei",  "Mei Tanaka", "mei@b81.test", {}],
    ["d_b81_gary", "Gary Voss", "gary@b81.test", {}],
    ["d_b81_dec",  "Dora Deceased", "dora@b81.test", { deceased: true }],
    ["d_b81_dnc",  "Nina Nocontact", "nina@b81.test", { do_not_contact: true }],
    ["d_b81_org",  "The Elm Foundation", "elm@b81.test", { kind: "org" }],
    ["d_b81_smp",  "Sam Sample", "sam@b81.test", { is_sample: true }],
    ["d_b81_drift", "Quiet Quentin", "quentin@b81.test", {}],
  ];
  for (const [id, name, em, extra] of donors) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,deceased,do_not_contact,kind,is_sample,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'steward',$5,$6,$7,$8,'u_b81thr','Thread Admin')`,
      [id, ORG, name, em, extra.deceased === true, extra.do_not_contact === true, extra.kind || null, extra.is_sample === true]);
  }
  // Quentin: a clean yearly pattern ending ~15 months ago → high-confidence
  // drift (the §9 fixture).
  for (let i = 5; i >= 1; i--) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,'d_b81_drift',1000,$3,'u_b81thr','Thread Admin')`,
      [`g_b81q${i}`, ORG, daysAgo(455 + (i - 1) * 365)]);
  }
  await q(`UPDATE donors SET total_giving=5000, gift_count=5, last_gift_date=$2 WHERE id='d_b81_drift' AND org_id=$1`, [ORG, daysAgo(455)]);
}

(async () => {
  await reset();
  const tok = await login("b81thr@test.local");
  const shape = await import("../shared/threadShape.js");
  const TODAY = (await api("GET", "/threads", tok)).body.today; // the org's civil today, from the seam

  // ── §1 · the defaults table, verbatim ────────────────────────────────────
  console.log("\n— §1 · the defaults table —");
  const D = shape.NEXT_STEP_DEFAULTS;
  ok("call reached → Follow up, +7", D.call_reached.type === "follow_up" && D.call_reached.plusDays === 7, D.call_reached);
  ok("call no answer → Try again, +2", D.call_no_answer.type === "try_again" && D.call_no_answer.plusDays === 2, D.call_no_answer);
  ok("meeting → thank-you note +2, THEN a second thread Follow up +14",
     D.meeting.type === "thank_you_note" && D.meeting.plusDays === 2 &&
     D.meeting.followon?.type === "follow_up" && D.meeting.followon?.plusDays === 14, D.meeting);
  ok("visit carries the same chain as meeting", JSON.stringify(D.visit) === JSON.stringify(D.meeting), D.visit);
  ok("email sent → Follow up, +5", D.email.type === "follow_up" && D.email.plusDays === 5, D.email);
  ok("gift received → Thank, +2", D.gift.type === "thank" && D.gift.plusDays === 2, D.gift);
  const sug = shape.nextStepSuggestion("call_reached", "2026-03-03");
  ok("the suggestion computes the civil due date", sug.due === "2026-03-10", sug);

  // ── §2 · logging a conversation ──────────────────────────────────────────
  console.log("\n— §2 · logging a conversation —");
  const c1 = await api("POST", "/donors/d_b81_ruth/conversations", tok,
    { touch: "call_reached", line: "Talked about the gala. She asked for the impact report.",
      nextStep: { type: "follow_up", due: shape.addCivilDays(TODAY, 7) } });
  ok("logging returns 201 with the interaction and the thread", c1.status === 201 && c1.body.interactionId && c1.body.thread?.id, c1.body);
  const [int1] = await q(`SELECT * FROM interactions WHERE id=$1`, [c1.body.interactionId]);
  ok("the interaction carries the line, the type, and the ACTOR",
     int1 && int1.type === "call" && int1.note.includes("impact report") && int1.created_by === "u_b81thr" && int1.logged_by_name === "Thread Admin", int1);
  const [th1] = await q(`SELECT * FROM threads WHERE id=$1`, [c1.body.thread.id]);
  ok("the thread: next step follow_up, due +7, open, actor stamped",
     th1 && th1.next_step_type === "follow_up" && th1.due_date === shape.addCivilDays(TODAY, 7)
       && th1.closed_at === null && th1.created_by === "u_b81thr" && th1.created_by_name === "Thread Admin", th1);
  ok("the thread points at its opening interaction", th1.opening_interaction_id === c1.body.interactionId, th1.opening_interaction_id);

  const cSkip = await api("POST", "/donors/d_b81_bill/conversations", tok,
    { touch: "call_no_answer", line: "Left a message.", nextStep: { skipped: true } });
  ok("skip: 201, interaction recorded, NO thread", cSkip.status === 201 && cSkip.body.skipped === true && !cSkip.body.thread, cSkip.body);
  const [intSkip] = await q(`SELECT metadata FROM interactions WHERE id=$1`, [cSkip.body.interactionId]);
  ok("the skip is RECORDED as skipped on the interaction — never as nothing",
     intSkip?.metadata?.next_step === "skipped", intSkip);
  const cNothing = await api("POST", "/donors/d_b81_mei/conversations", tok,
    { touch: "email", line: "Sent the annual report." });
  ok("a missing next-step decision is a 400 — silence is not accepted", cNothing.status === 400, cNothing.status);
  const cNoLine = await api("POST", "/donors/d_b81_mei/conversations", tok,
    { touch: "email", nextStep: { skipped: true } });
  ok("a conversation with no line is a 400 — the log IS the product", cNoLine.status === 400, cNoLine.status);
  const cBadTouch = await api("POST", "/donors/d_b81_mei/conversations", tok,
    { touch: "carrier_pigeon", line: "x", nextStep: { skipped: true } });
  ok("an unknown touch type is a 400", cBadTouch.status === 400, cBadTouch.status);
  const cForeign = await api("POST", "/donors/d_nonexistent/conversations", tok,
    { touch: "email", line: "x", nextStep: { skipped: true } });
  ok("an unknown donor is a 404", cForeign.status === 404, cForeign.status);

  // ── §3 · one open thread; the next conversation is the outcome ───────────
  console.log("\n— §3 · one open thread per donor —");
  const c2 = await api("POST", "/donors/d_b81_ruth/conversations", tok,
    { touch: "meeting", line: "Coffee at Marlowe's. She wants to fund the youth program.",
      nextStep: { type: "thank_you_note", due: shape.addCivilDays(TODAY, 2) } });
  ok("the second conversation CLOSES the open thread and opens the next",
     c2.status === 201 && c2.body.closedThreadId === th1.id && c2.body.thread?.id, c2.body);
  const [th1After] = await q(`SELECT * FROM threads WHERE id=$1`, [th1.id]);
  ok("the closed thread is an OUTCOME pointing at the new interaction",
     th1After.closed_at !== null && th1After.close_kind === "outcome" && th1After.closing_interaction_id === c2.body.interactionId, th1After);
  const [th2] = await q(`SELECT * FROM threads WHERE id=$1`, [c2.body.thread.id]);
  ok("the meeting default carries the follow-on chain (Follow up, +14 from the touch)",
     th2.followon_type === "follow_up" && th2.followon_due === shape.addCivilDays(TODAY, 14), th2);
  const openCount = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id='d_b81_ruth' AND closed_at IS NULL`, [ORG]);
  ok("exactly ONE open thread on the donor", openCount[0].n === 1, openCount[0].n);
  const c3 = await api("POST", "/donors/d_b81_mei/conversations", tok,
    { touch: "meeting", line: "Site visit.", nextStep: { type: "follow_up", due: shape.addCivilDays(TODAY, 3) } });
  const [th3] = await q(`SELECT * FROM threads WHERE id=$1`, [c3.body.thread.id]);
  ok("changing the type away from the default DROPS the follow-on (the user's decision replaced the plan)",
     th3.followon_type === null, th3.followon_type);

  // ── §4 · NO SILENT CLOSE — prove the red ─────────────────────────────────
  console.log("\n— §4 · no silent close —");
  let rawErr = null;
  try { await q(`UPDATE threads SET closed_at=NOW() WHERE id=$1`, [th2.id]); }
  catch (e) { rawErr = e.message; }
  ok("a raw close with no outcome and no reason is REFUSED BY THE DATABASE",
     rawErr && /threads_close_honest/.test(rawErr), rawErr);
  let rawErr2 = null;
  try { await q(`UPDATE threads SET closed_at=NOW(), close_kind='outcome' WHERE id=$1`, [th2.id]); }
  catch (e) { rawErr2 = e.message; }
  ok("an 'outcome' close with no interaction behind it is refused too",
     rawErr2 && /threads_close_honest/.test(rawErr2), rawErr2);
  const dBad = await api("POST", `/threads/${th2.id}/dismiss`, tok, { reason: "felt_like_it" });
  ok("a dismissal outside the fixed list is a 400", dBad.status === 400, dBad.body);
  const dRevPast = await api("POST", `/threads/${th2.id}/dismiss`, tok, { reason: "revisit", revisitOn: daysAgo(3) });
  ok("revisit on a past date is a 400", dRevPast.status === 400, dRevPast.body);
  const revisitOn = shape.addCivilDays(TODAY, 30);
  const dRev = await api("POST", `/threads/${th2.id}/dismiss`, tok, { reason: "revisit", revisitOn });
  ok("revisit is a SNOOZE — 200, the thread stays open with the date", dRev.status === 200 && dRev.body.snoozedUntil === revisitOn, dRev.body);
  let list = (await api("GET", "/threads", tok)).body;
  ok("a snoozed thread is OFF the list and OFF the stat, counted as snoozed",
     !list.list.some(t => t.id === th2.id) && list.stat.snoozed >= 1, list.stat);
  await q(`UPDATE threads SET snoozed_until=$2 WHERE id=$1`, [th2.id, TODAY]);
  list = (await api("GET", "/threads", tok)).body;
  ok("on its revisit date the thread RESURFACES by construction", list.list.some(t => t.id === th2.id), list.stat);
  const dClose = await api("POST", `/threads/${th3.id}/dismiss`, tok, { reason: "no_longer_prospect" });
  ok("dismissing with a reason closes the thread", dClose.status === 200, dClose.body);
  const [th3After] = await q(`SELECT * FROM threads WHERE id=$1`, [th3.id]);
  ok("the dismissal reason is ON the row", th3After.closed_at !== null && th3After.close_kind === "dismissed" && th3After.close_reason === "no_longer_prospect", th3After);
  const dTwice = await api("POST", `/threads/${th3.id}/dismiss`, tok, { reason: "handled_outside" });
  ok("dismissing a closed thread is a 400", dTwice.status === 400, dTwice.status);

  // ── §5 · a live gift opens a Thank thread ────────────────────────────────
  console.log("\n— §5 · a live gift opens a thread —");
  const g1 = await api("POST", "/donors/d_b81_gary/gifts", tok, { amount: 250, date: TODAY, idempotencyKey: "b81-gift-1" });
  ok("manual gift 201", g1.status === 201, g1.status);
  await new Promise(r => setTimeout(r, 500)); // the thread opens beside the response
  const [thGift] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_b81_gary' AND closed_at IS NULL`, [ORG]);
  ok("the gift opened a thread: next step Thank, due +2 days",
     thGift && thGift.next_step_type === "thank" && thGift.due_date === shape.addCivilDays(TODAY, 2), thGift);
  ok("the gift thread points at the GIFT, and the actor is the human who recorded it",
     thGift.opening_gift_id === g1.body.gift.id && thGift.created_by === "u_b81thr", thGift);
  const g2 = await api("POST", "/donors/d_b81_gary/gifts", tok, { amount: 100, date: TODAY, idempotencyKey: "b81-gift-2" });
  await new Promise(r => setTimeout(r, 500));
  const garyOpen = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id='d_b81_gary' AND closed_at IS NULL`, [ORG]);
  ok("a second gift does NOT open a second thread (one open thread per donor)", g2.status === 201 && garyOpen[0].n === 1, garyOpen[0].n);
  for (const [donor, label] of [["d_b81_dec", "deceased"], ["d_b81_dnc", "do-not-contact"], ["d_b81_org", "non-person (org record)"], ["d_b81_smp", "sample"]]) {
    await api("POST", `/donors/${donor}/gifts`, tok, { amount: 50, date: TODAY, idempotencyKey: `b81-${donor}` });
    await new Promise(r => setTimeout(r, 300));
    const n = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id=$2`, [ORG, donor]);
    ok(`a gift on a ${label} donor opens NO thread`, n[0].n === 0, n[0].n);
  }

  // ── §6 · imports NEVER create threads ────────────────────────────────────
  console.log("\n— §6 · imports never create threads —");
  const before = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1`, [ORG]);
  const { groupTransactions } = await import("../shared/importShape.js");
  const items = [];
  for (let i = 0; i < 6; i++) {
    items.push({
      key: `imp${i}@b81.test`,
      donor: { name: `Imported Donor ${i}`, email: `imp${i}@b81.test`, stage: "steward" },
      gift: { amount: 100 + i, date: daysAgo(40 + i * 30), type: "cash", campaign: "", notes: "" },
    });
  }
  const { donors: impD, gifts: impG } = groupTransactions(items);
  const imp = await api("POST", "/donors/import-combined", tok, { donors: impD, gifts: impG });
  ok("import 200", imp.status === 200, imp.body?.error);
  await new Promise(r => setTimeout(r, 500));
  const after = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1`, [ORG]);
  ok("the import created donors and gifts and ZERO threads — a Last Contact column is history, not an open loop",
     after[0].n === before[0].n, { before: before[0].n, after: after[0].n });

  // ── §7 · composition: overdue first, the stat line ───────────────────────
  console.log("\n— §7 · composition —");
  // Backdate Ruth's open thread so it is overdue and old.
  const [ruthOpen] = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id='d_b81_ruth' AND closed_at IS NULL`, [ORG]);
  await q(`UPDATE threads SET due_date=$2, opened_on=$3 WHERE id=$1`, [ruthOpen.id, daysAgo(11), daysAgo(23)]);
  list = (await api("GET", "/threads", tok)).body;
  ok("overdue threads come FIRST", list.list.length >= 2 && list.list[0].id === ruthOpen.id && list.list[0].overdue === true, list.list.map(t => [t.donorName, t.overdue]));
  ok("the stat line: open, overdue, oldest days",
     list.stat.open === list.list.length && list.stat.overdue === 1 && list.stat.oldestDays === 23, list.stat);
  ok("each row carries the last touch (type, date, the line, the actor) and the next step",
     list.list.every(t => t.lastTouch && t.nextStep && t.nextStep.due && typeof t.daysOpen === "number"), list.list[0]);
  const dq = (await api("GET", "/threads?donorId=d_b81_ruth", tok)).body;
  ok("the donor-scoped read returns that donor's thread", dq.list.length === 1 && dq.list[0].donorId === "d_b81_ruth", dq.list);

  // ── §8 · the checklist ticks on the FIRST thread ─────────────────────────
  console.log("\n— §8 · the checklist —");
  const setup = await api("GET", "/org/setup-status", tok);
  const convItem = (setup.body.items || []).find(i => i.key === "conversation");
  ok("the checklist has the conversation item and it is DONE here (threads exist)", convItem && convItem.done === true, setup.body.items);
  ok("the old auto-ticking workflow item is GONE", !(setup.body.items || []).some(i => i.key === "workflow"), setup.body.items);
  // A fresh org: wipe threads → not done (nothing else in this org ticks it).
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  const setup2 = await api("GET", "/org/setup-status", tok);
  const convItem2 = (setup2.body.items || []).find(i => i.key === "conversation");
  ok("with no thread ever logged the item is NOT done — a fresh org that has done nothing shows nothing done", convItem2 && convItem2.done === false, convItem2);
  const fresh = (await api("GET", "/threads", tok)).body;
  ok("hasAny=false drives the honest empty state", fresh.hasAny === false && fresh.list.length === 0, fresh);

  // ── §9 · drift-done opens a thread ───────────────────────────────────────
  console.log("\n— §9 · drift-done opens a thread —");
  const drift = (await api("GET", "/drift", tok)).body;
  ok("the drift fixture is on the list", (drift.list || []).some(r => r.donorId === "d_b81_drift"), drift.counts);
  const dd = await api("POST", "/drift/d_b81_drift/done", tok, { note: "Called him. He was traveling all spring, wants to talk in October." });
  ok("drift-done with a line opens a thread with the call default (Follow up, +7)",
     dd.body.thread && dd.body.thread.next_step_type === "follow_up" && dd.body.thread.due_date === shape.addCivilDays(TODAY, 7), dd.body);
  await q(`DELETE FROM threads WHERE org_id=$1 AND donor_id='d_b81_drift'`, [ORG]);
  await q(`DELETE FROM interactions WHERE org_id=$1 AND donor_id='d_b81_drift' AND metadata->>'via'='drift_done'`, [ORG]);
  const ddSkip = await api("POST", "/drift/d_b81_drift/done", tok, { note: "" });
  ok("drift-done SKIP opens nothing (no conversation happened)", ddSkip.body.skipped === true && !ddSkip.body.thread, ddSkip.body);
  const skipN = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id='d_b81_drift'`, [ORG]);
  ok("…and no thread row exists", skipN[0].n === 0, skipN[0].n);
  const ddNS = await api("POST", "/drift/d_b81_drift/done", tok, { note: "Reached him after all.", nextStep: { skipped: true } });
  ok("drift-done with a line but a SKIPPED next step records the skip and opens nothing",
     !ddNS.body.thread, ddNS.body);
  const [ddInt] = await q(`SELECT metadata FROM interactions WHERE org_id=$1 AND donor_id='d_b81_drift' AND metadata->>'via'='drift_done' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("the skip is recorded on the interaction", ddInt?.metadata?.next_step === "skipped", ddInt);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
