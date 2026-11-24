// tests/undo1-effects.test.js · UNDO-1 (Jarvis's 22 Nov sweep). The build's one new suite: it
// guards money and donor data. Every side effect a write causes is recorded, and Undo takes it back.
//
// §1 Refund then Undo refund: the refund row goes, every surface foots to the cent to what it
//    was before the refund (assertSurfacesAgree, and the person's stored total), the voided
//    receipt is live again and the reissued one void; Recent changes listed it with "Undo
//    refund" and no longer does; the audit is one sentence with her reason. A receipt sent to
//    the donor since the refund keeps both receipts as they are, and says so. A second Undo is 404.
// §2 A task tick then reopen leaves the journey as it was: a one-step journey is active again
//    with its step open; a two-step journey's second step goes back to waiting and its Thread
//    goes. The tick is a line in Recent changes with Undo. Home's Done and its Undo, the same.
// §3 Logging a touch with a next step closes the open one, and Recent changes says which; its
//    Undo reopens it and takes the touch's own new step away. keepOpen closes nothing.
// §4 Invite then register is ONE place, registered; a second real purchase adds; deleting each
//    registration gift puts the guest row back as it was (2 → 1 → invited 1).
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back; and the suite run on main):
//   · main: no /refunds/:id/undo (§1 404), the plan stays done on reopen (§2), no Recent changes
//     line (§2, §3), invite + register = 2 (§4).
//   · writeEffects.reverse ordered oldest first → §2 two-step red (the old step cannot reopen
//     while the next step's Thread is open).
//   · registrationEffects.CONVERTS_SQL set to FALSE → §4 "one place" red.
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const ORG = "org_undo1";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const ACT = ["system:test/undo1", "UNDO-1 test"];
const one = async (sql, a) => (await q(sql, a))[0] || {};

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Quillmere Undo One Trust','undo1-quillmere',1,'active','team','America/New_York',NOW(),'Quillmere Undo One Trust Inc','83-1190457','4 Fixture Row',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Perpetua Lusk','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,$5,$6)`,
    [id, ORG, name, `${id}@undo1.example.org`, ...ACT]);
  return id;
}
const gift = async (tok, donor, body) => { const r = await api("POST", `/donors/${donor}/gifts`, tok, { idempotencyKey: crypto.randomUUID(), date: TODAY, type: "cash", payment_method: "check", ...body }); return r.body && (r.body.gift ? r.body.gift.id : r.body.id); };
const recent = async tok => ((await api("GET", "/recent-changes", tok)).body || {}).rows || [];
const surfaces = async (tok, label) => { const r = await assertSurfacesAgree(ORG, { token: tok, soft: true, label }); return r; };

(async () => {
  console.log("undo1-effects (UNDO-1)");
  const tok = await freshOrg();

  // ── §1 refund, then Undo refund ──────────────────────────────────────────
  const WREN = await person("d_undo1_wren", "Wren Halloway");
  const g = await gift(tok, WREN, { amount: 250 });
  await gift(tok, WREN, { amount: 40 });
  const rc = await api("POST", `/gifts/${g}/receipt`, tok, { send: false });
  const before = await one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [WREN]);
  const s0 = await surfaces(tok, "before the refund");
  ok("§1 fixture: $290 in two gifts, the $250 receipted, surfaces agree", before.t === 290 && before.n === 2 && rc.status === 201 && s0.ok, { before, rc: rc.status, d: s0.diffs });

  const rf = await api("POST", `/gifts/${g}/refund`, tok, { amount: 100, reason: "Charged twice at the gala", date: TODAY });
  const refundId = rf.body && rf.body.refundId;
  const afterRefund = await one(`SELECT total_giving::float AS t FROM donors WHERE id=$1`, [WREN]);
  const line = (await recent(tok)).find(r => r.kind === "effect_refund");
  ok("§1 the refund is a line in Recent changes with Undo refund and the reason", rf.status === 201 && afterRefund.t === 190 && line
    && line.undoLabel === "Undo refund" && line.ask === "reason" && /Refunded \$100 of Wren Halloway's \$250 gift\. Reason: Charged twice at the gala/.test(line.sentence),
    { s: rf.status, afterRefund, line });
  const audit1 = await one(`SELECT summary FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE $2 ORDER BY created_at DESC LIMIT 1`, [ORG, `/gifts/${g}/refund%`]);
  ok("§1 the refund's audit row is a sentence with the reason", /^Refunded \$100 of Wren Halloway's \$250 gift on \d{4}-\d{2}-\d{2}\. Reason: Charged twice at the gala$/.test(audit1.summary || ""), audit1);

  const noReason = await api("POST", `/refunds/${refundId}/undo`, tok, {});
  const un = await api("POST", `/refunds/${refundId}/undo`, tok, { reason: "Recorded on the wrong gift" });
  const after = await one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [WREN]);
  const rcs = await q(`SELECT receipt_number, amount::float AS a, voided_at IS NOT NULL AS v FROM receipts WHERE org_id=$1 AND gift_id=$2 ORDER BY created_at`, [ORG, g]);
  const left = await one(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND refund_of=$2`, [ORG, g]);
  ok("§1 Undo refund needs a reason, then the refund row goes and the totals are what they were", noReason.status === 400 && un.status === 200
    && left.n === 0 && after.t === before.t && after.n === before.n, { noReason: noReason.status, un: un.body, after, left });
  ok("§1 the voided receipt is live again and the reissued one is void", rcs.length === 2 && !rcs[0].v && rcs[0].a === 250 && rcs[1].v
    && new RegExp(`Receipt #${rcs[0].receipt_number} is live again`).test(un.body.sentence || ""), { rcs, s: un.body.sentence });
  const s1 = await surfaces(tok, "after the refund was undone");
  ok("§1 every surface foots to the cent after the Undo", s1.ok, s1.diffs);
  const audit2 = await one(`SELECT summary FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE $2 ORDER BY created_at DESC LIMIT 1`, [ORG, `/refunds/${refundId}/undo%`]);
  ok("§1 the Undo's audit row is a sentence with her reason", audit2.summary === "Undid the $100 refund of Wren Halloway's $250 gift. Reason: Recorded on the wrong gift", audit2);
  ok("§1 the line has left Recent changes, and a second Undo finds nothing", !(await recent(tok)).some(r => r.id === line.id)
    && (await api("POST", `/refunds/${refundId}/undo`, tok, { reason: "again" })).status === 404);

  // A receipt that went to the donor since the refund: the receipts stay, and the answer says so.
  const rf2 = await api("POST", `/gifts/${g}/refund`, tok, { amount: 50, reason: "Partial return", date: TODAY });
  await q(`UPDATE receipts SET sent_at = NOW() + INTERVAL '1 second', sent_to='wren@undo1.example.org' WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL`, [ORG, g]);
  const live0 = await q(`SELECT id, voided_at IS NOT NULL AS v FROM receipts WHERE org_id=$1 AND gift_id=$2 ORDER BY created_at`, [ORG, g]);
  const un2 = await api("POST", `/refunds/${rf2.body.refundId}/undo`, tok, { reason: "Kept after all" });
  const live1 = await q(`SELECT id, voided_at IS NOT NULL AS v FROM receipts WHERE org_id=$1 AND gift_id=$2 ORDER BY created_at`, [ORG, g]);
  ok("§1 a receipt sent since the refund keeps the receipts as they are, and says so", un2.status === 200
    && JSON.stringify(live0) === JSON.stringify(live1) && /already went to Wren Halloway, so the receipts stay as they are/.test(un2.body.sentence || ""),
    { s: un2.body, live0, live1 });

  // ── §2 a task tick, then reopen ──────────────────────────────────────────
  const OSK = await person("d_undo1_oskar", "Oskar Penhallow");
  const j1 = await api("POST", "/journeys", tok, { name: "Birthday card (test)", trigger: "by_hand", enabled: true, steps: [{ type: "send", label: "Mail a birthday card", offsetDays: 0 }] });
  const ap = await api("POST", `/journeys/${j1.body.id}/apply`, tok, { donorIds: [OSK] });
  const plan = async (d, tid) => one(`SELECT p.status, s.status AS step, s.thread_id FROM cultivation_plans p JOIN cultivation_plan_steps s ON s.plan_id=p.id
                                        WHERE p.org_id=$1 AND p.donor_id=$2 AND p.template_id=$3 ORDER BY s.seq LIMIT 1`, [ORG, d, tid]);
  const task = await one(`SELECT id, thread_id FROM tasks WHERE org_id=$1 AND donor_id=$2 AND link_kind='next_step' AND done=0`, [ORG, OSK]);
  ok("§2 fixture: Oskar is in a one-step journey with its task open", j1.status === 201 && ap.status === 200 && task.id && (await plan(OSK, j1.body.id)).status === "active", { j1: j1.status, ap: ap.body, task });
  await api("POST", `/tasks/${task.id}/complete`, tok, { done: true });
  const ticked = await plan(OSK, j1.body.id);
  const tickLine = (await recent(tok)).find(r => r.kind === "effect_task_done");
  ok("§2 the tick finishes the journey and is a line in Recent changes with Undo", ticked.status === "done" && ticked.step === "done"
    && tickLine && tickLine.sentence === "Ticked: Mail a birthday card for Oskar Penhallow." && tickLine.undo.path === `/tasks/${task.id}/complete`, { ticked, tickLine });
  const re = await api("POST", tickLine.undo.path, tok, tickLine.undo.body);
  const back = await plan(OSK, j1.body.id);
  const th = await one(`SELECT closed_at FROM threads WHERE id=$1`, [task.thread_id]);
  ok("§2 reopening the task leaves the journey as it was (active, step open, its Thread open)", re.status === 200 && back.status === "active" && back.step === "open"
    && back.thread_id === task.thread_id && th.closed_at === null && !(await recent(tok)).some(r => r.id === tickLine.id), { re: re.status, back, th });

  // A two-step journey: the tick opens step two; reopening step one takes it back.
  const IDA = await person("d_undo1_ida", "Ida Marrowby");
  const j2 = await api("POST", "/journeys", tok, { name: "Two steps (test)", trigger: "by_hand", enabled: true,
    steps: [{ type: "send", label: "Send the welcome pack", offsetDays: 0 }, { type: "follow_up", label: "Call about the welcome pack", offsetDays: 0 }] });
  await api("POST", `/journeys/${j2.body.id}/apply`, tok, { donorIds: [IDA] });
  const t2 = await one(`SELECT id, thread_id FROM tasks WHERE org_id=$1 AND donor_id=$2 AND link_kind='next_step' AND done=0`, [ORG, IDA]);
  await api("POST", `/tasks/${t2.id}/complete`, tok, { done: true });
  const steps = async () => q(`SELECT s.label, s.status FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id WHERE p.org_id=$1 AND p.donor_id=$2 ORDER BY s.seq`, [ORG, IDA]);
  const mid = await steps();
  const open2 = await one(`SELECT id, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, IDA]);
  await api("POST", `/tasks/${t2.id}/complete`, tok, { done: false });
  const end = await steps();
  const openEnd = await one(`SELECT id, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, IDA]);
  ok("§2 two steps: the tick opened step two; reopening step one takes step two back to waiting", mid[0].status === "done" && mid[1].status === "open"
    && open2.next_step_label === "Call about the welcome pack" && end[0].status === "open" && end[1].status === "pending" && openEnd.id === t2.thread_id,
    { mid, open2, end, openEnd });

  // Home's Done on the step, and its Undo.
  const RUE = await person("d_undo1_rue", "Rue Calloway");
  await api("POST", `/journeys/${j1.body.id}/apply`, tok, { donorIds: [RUE] });
  const th3 = await one(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, RUE]);
  await api("POST", `/threads/${th3.id}/done`, tok, {});
  const doneLine = (await recent(tok)).find(r => r.kind === "effect_thread_done");
  const d1 = await plan(RUE, j1.body.id);
  const ud = await api("POST", `/threads/${th3.id}/done`, tok, { done: false });
  const d2 = await plan(RUE, j1.body.id);
  ok("§2 Home's Done finishes the journey, is in Recent changes, and its Undo puts the journey back", d1.status === "done" && doneLine
    && doneLine.sentence === "Marked done: Mail a birthday card for Rue Calloway." && ud.status === 200 && d2.status === "active" && d2.step === "open",
    { d1, doneLine, ud: ud.body, d2 });

  // ── §3 logging a touch says what it closed, and Undo opens it again ─────
  const MAE = await person("d_undo1_mae", "Mae Thistlewood");
  const ns = await api("POST", `/donors/${MAE}/threads`, tok, { label: "Call about the spring visit", due: dayOffset(3) });
  const keep = await api("POST", `/donors/${MAE}/conversations`, tok, { touchKind: "call", line: "Left a message.", keepOpen: true,
    nextStep: { type: "follow_up", label: "Send the brochure", due: dayOffset(7) } });
  const still = await one(`SELECT id, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, MAE]);
  ok("§3 Keep it open: the touch is logged and the open step stays, with no new one", ns.status === 201 && keep.status === 201
    && still.next_step_label === "Call about the spring visit", { ns: ns.status, keep: keep.status, still });
  const lg = await api("POST", `/donors/${MAE}/conversations`, tok, { touchKind: "call", line: "Talked about the spring visit.",
    nextStep: { type: "follow_up", label: "Send the brochure", due: dayOffset(7) } });
  const touchLine = (await recent(tok)).find(r => r.kind === "effect_touch");
  const now = await one(`SELECT next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, MAE]);
  ok("§3 the touch closed the step, and Recent changes says which", lg.status === 201 && now.next_step_label === "Send the brochure" && touchLine
    && touchLine.sentence === "Logged a call with Mae Thistlewood; it closed the next step: Call about the spring visit.", { lg: lg.status, now, touchLine });
  const ut = await api("POST", touchLine.undo.path, tok, {});
  const afterUndo = await q(`SELECT next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, MAE]);
  ok("§3 its Undo reopens the step and takes the touch's new step away", ut.status === 200 && afterUndo.length === 1
    && afterUndo[0].next_step_label === "Call about the spring visit" && /open again/.test(ut.body.sentence || ""), { ut: ut.body, afterUndo });

  // ── §4 invite, then register ─────────────────────────────────────────────
  const NELL = await person("d_undo1_nell", "Nell Ashgrove");
  const ev = await api("POST", "/events", tok, { name: "Lantern Supper (test)", eventType: "gala", date: dayOffset(40) });
  const lv = await api("POST", `/events/${ev.body.id}/levels`, tok, { kind: "ticket", name: "Ticket", price: 100, capacity: 5 });
  await api("POST", `/events/${ev.body.id}/attendees`, tok, { donorIds: [NELL] });
  const row = async () => one(`SELECT status, quantity FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id=$3`, [ORG, ev.body.id, NELL]);
  const invited = await row();
  const r1 = await api("POST", `/events/${ev.body.id}/register`, tok, { levelId: lv.body.id, donorId: NELL, quantity: 1, paymentMethod: "check" });
  const reg1 = await row();
  ok("§4 invite then register is ONE place, registered", invited.status === "invited" && r1.status === 201 && reg1.status === "registered" && reg1.quantity === 1, { invited, r1: r1.status, reg1 });
  const r2 = await api("POST", `/events/${ev.body.id}/register`, tok, { levelId: lv.body.id, donorId: NELL, quantity: 1, paymentMethod: "check", idempotencyKey: "undo1-second" });
  const reg2 = await row();
  await api("DELETE", `/gifts/${r2.body.giftId}`, tok);
  const del2 = await row();
  await api("DELETE", `/gifts/${r1.body.giftId}`, tok);
  const del1 = await row();
  ok("§4 a second purchase adds; deleting each registration gift puts the guest row back as it was", reg2.quantity === 2
    && del2.status === "registered" && del2.quantity === 1 && del1.status === "invited" && del1.quantity === 1, { reg2, del2, del1 });

  const s2 = await surfaces(tok, "at the end");
  ok("every surface agrees at the end", s2.ok, s2.diffs);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
