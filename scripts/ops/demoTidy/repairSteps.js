// scripts/ops/demoTidy/repairSteps.js · REPAIR-1. BRING ROWS WRITTEN BEFORE A FIX UP TO THE FIX.
//
// The 8 Nov fleet repeated fails whose code fixes had shipped (SENDS-1,
// STALE-2, PLEDGES-2), because the bad rows were written before the fix and
// every repair script skipped org_creo. Each step here applies the shipped
// rule to the rows as they stand, through the product's own rule (named on
// each step), records every change on the journal `J` for --undo, and does
// nothing when the rows already agree, so a second apply changes nothing.
//
//   6 · Send switches     SENDS-1: one master (Donor mail). A type stored On under it while it is Off becomes Off.
//   7 · Sequences         SENDS-1: Steward's own sequence keeps its own trigger; an Active one with an empty step or no trigger is Paused.
//   8 · Thank-you tasks   SENDS-1 thankYouOnce: one open thank-you per gift; the others go to Done, noted "duplicate".
//   9 · Attendance lines  STALE-2 attendanceLines: every "Came to" / "Registered for" line says what its guest row says now.
//  10 · Pledge flags      PLEDGES-2 relay: each installment's paid flag comes from the payments, oldest due first.
//
// Steps 8 to 10 are about rows any org can carry, so scripts/ops/repair1-all-orgs.js
// runs them on every other org. Steps 6 and 7 change what an org chose, so they run
// only in the demo tidy.
"use strict";
const mailPolicy = require("../../../mailPolicy");
const { sequenceActivationProblem } = require("../../../server/outreach/sendsOff");
const { THANK_TYPES } = require("../../../server/shared/thankYouOnce");
const { VIAS, NOTE, ORPHANS_WHERE } = require("../../../server/events/attendanceLines");
const { flagsFor } = require("../../../server/donors/pledgePayments");
const { MONEY } = require("../../../shared/numbers/money");
const { installmentsLeft, balanceCents } = require("../../../shared/numbers/pledges");

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const usd = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── 6 · Send switches ────────────────────────────────────────────────────
// The master as Home and Settings read it (routes/mailTypes.js orgMail): the
// org's Donor mail is On and mailPolicy lets donor mail go. Home's sentence is
// worked out from these rows on every read (GET /mail-types/status); nothing
// stores it, so once the switches agree with the master, Home does too.
async function sendSwitches(c, J, ctx) {
  const [o] = (await c.query(`SELECT * FROM orgs WHERE id = $1`, [ctx.orgId])).rows;
  const masterOn = !!o && o.emails_enabled === true && mailPolicy.orgMailDecision(o, mailPolicy.CATEGORY.DONOR).send === true;
  if (masterOn) return [];
  const on = (await c.query(`SELECT type_key FROM org_mail_types WHERE org_id = $1 AND is_on = TRUE ORDER BY type_key`, [ctx.orgId])).rows.map(r => r.type_key);
  if (!on.length) return [];
  await J.update("org_mail_types", `org_id = $1 AND is_on = TRUE`, [ctx.orgId],
    { is_on: false, set_at: ctx.now, set_by: ctx.actor.id, set_by_name: ctx.actor.name }, `${plural(on.length, "email type")} Off under the master`, ["org_id", "type_key"]);
  return [`Donor mail is Off, so ${plural(on.length, "email type")} stored On ${on.length === 1 ? "is" : "are"} now Off: ${on.join(", ")}`];
}

// ── 7 · Sequences ────────────────────────────────────────────────────────
// Steward's own sequences (server/boot/helpers-5.js ensureMilestoneSequences,
// ensureAtRiskSequence) are known by their name or their one step, and their
// trigger IS what they are: a Milestone sequence started by "Lapsed 12+ months"
// would draft milestone mail to lapsed donors. Then sendsOff's rule: an Active
// sequence with an empty step or no trigger can't be Active.
const OWN = [
  { trigger: "milestone", name: /^Milestone & Anniversary/i, subject: /^Milestone email \(AI-drafted per donor\)$/i },
  { trigger: "at_risk", name: /^At-Risk Re-Engagement/i, subject: /^At-risk re-engagement email \(AI-drafted per donor\)$/i },
];
async function sequences(c, J, ctx) {
  const out = [];
  const seqs = (await c.query(`SELECT id, name, trigger, status FROM sequences WHERE org_id = $1 ORDER BY created_at, id`, [ctx.orgId])).rows;
  for (const s of seqs) {
    const steps = (await c.query(`SELECT subject, body FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_order, id`, [s.id])).rows;
    const own = OWN.find(k => k.name.test(s.name || "") || (steps.length === 1 && k.subject.test(steps[0].subject || "")));
    let trigger = s.trigger;
    if (own && s.trigger !== own.trigger) {
      await J.update("sequences", `org_id = $1 AND id = $2`, [ctx.orgId, s.id], { trigger: own.trigger }, `"${s.name}" trigger`);
      out.push(`"${s.name}": trigger ${s.trigger || "(none)"} → ${own.trigger}, the one its kind runs on`);
      trigger = own.trigger;
    }
    if (s.status !== "active") continue;
    const problem = sequenceActivationProblem({ trigger }, steps);
    if (!problem) continue;
    await J.update("sequences", `org_id = $1 AND id = $2 AND status = 'active'`, [ctx.orgId, s.id], { status: "paused", turned_off_at: ctx.now }, `"${s.name}" paused`);
    out.push(`"${s.name}": Active → Paused (${problem.error.replace(/_/g, " ")})`);
  }
  return out;
}

// ── 8 · Thank-you tasks ──────────────────────────────────────────────────
// thankYouOnce's rule: a gift's thank-you is ONE open thing. An open step on
// the person's Thread is the thank-you, else the oldest task. The others go to
// Done with the note "duplicate" (a step's task through its Thread, dismissed as
// "duplicate", so the Thread's own trigger ticks it): nothing is deleted.
const THANK_TITLE = `^(call to )?(say |send )?(a )?(personal )?thank`;
async function thankYous(c, J, ctx) {
  const rows = (await c.query(
    `SELECT t.id, t.title, t.thread_id, t.notes, COALESCE(t.thanks_gift_id, t.source_gift_id) AS gift_id, d.name AS donor
       FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = $1 AND t.done = 0 AND t.voided_at IS NULL AND COALESCE(t.thanks_gift_id, t.source_gift_id) IS NOT NULL
        AND (t.title ~* $2 OR t.thread_id IN (SELECT id FROM threads WHERE org_id = $1 AND next_step_type = ANY($3::text[])))
      ORDER BY 5, (t.thread_id IS NULL), t.created_at, t.id`, [ctx.orgId, THANK_TITLE, THANK_TYPES])).rows;
  const by = new Map();
  for (const r of rows) { if (!by.has(r.gift_id)) by.set(r.gift_id, []); by.get(r.gift_id).push(r); }
  const out = [];
  for (const [gift, list] of by) {
    if (list.length < 2) continue;
    for (const t of list.slice(1)) {
      // The task first, then its step: undo reopens the step first (its trigger
      // reopens the task), then puts the task's own fields back.
      await J.update("tasks", `org_id = $1 AND id = $2`, [ctx.orgId, t.id], { done: 1, completed_at: ctx.now, completed_by_name: ctx.actor.name,
        notes: t.notes ? `${t.notes}\nduplicate` : "duplicate", updated_at: ctx.now }, `a duplicate thank-you task for ${gift}`);
      if (t.thread_id) {
        await J.update("threads", `org_id = $1 AND id = $2 AND closed_at IS NULL`, [ctx.orgId, t.thread_id],
          { closed_at: ctx.now, close_kind: "dismissed", close_reason: "duplicate" }, `a duplicate thank-you step for ${gift}`);
      }
    }
    out.push(`${list[0].donor || "A person"}: ${list.length} open thank-yous for one gift (${gift}); kept "${list[0].title}", ${plural(list.length - 1, "other")} to Done as duplicate`);
  }
  return out;
}

// ── 9 · Attendance lines ─────────────────────────────────────────────────
// attendanceLines' rule: a guest's line is the guest row as it stands now.
// "Came to X." for attended and "Registered for X and did not come." for a no
// show (NOTE); any other status has no attendance line (and the claim stamp is
// cleared, so marking them again writes it afresh); "Registered for X." names
// the event as it is called now; a line whose guest is gone goes (ORPHANS_WHERE).
async function attendance(c, J, ctx) {
  const org = ctx.orgId, out = [];
  const orphans = await J.del("interactions", `org_id = $1 AND id IN (SELECT i.id FROM interactions i WHERE i.org_id = $1 AND ${ORPHANS_WHERE})`, [org], "lines whose guest is gone");
  if (orphans) out.push(`${plural(orphans, "line")} whose guest is gone, removed`);
  const lines = (await c.query(
    `SELECT i.id, i.note, i.metadata, i.metadata->>'via' AS via, a.id AS att, LOWER(COALESCE(a.status, '')) AS status, e.name AS event, d.name AS donor
       FROM interactions i JOIN event_attendees a ON a.id = i.metadata->>'attendee_id' AND a.org_id = i.org_id
       JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id LEFT JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = $1 AND i.metadata->>'via' = ANY($2::text[]) ORDER BY i.id`, [org, VIAS])).rows;
  const gone = [];
  for (const l of lines) {
    if (l.via === "event_registration") {
      const want = `Registered for ${l.event}.`;
      if (l.note !== want) { await J.update("interactions", `org_id = $1 AND id = $2`, [org, l.id], { note: want }, "a registration line"); out.push(`${l.donor}: "${l.note}" → "${want}"`); }
      continue;
    }
    if (!NOTE[l.status]) { gone.push(l); continue; }
    const want = NOTE[l.status](l.event);
    const meta = l.metadata || {};
    if (l.note === want && meta.status === l.status) continue;
    await J.update("interactions", `org_id = $1 AND id = $2`, [org, l.id], { note: want, metadata: { ...meta, status: l.status } }, "an attendance line");
    out.push(`${l.donor}: "${l.note}" → "${want}"`);
  }
  if (gone.length) {
    await J.del("interactions", `org_id = $1 AND id = ANY($2::text[])`, [org, gone.map(l => l.id)], "attendance lines for guests who neither came nor missed it");
    await J.update("event_attendees", `org_id = $1 AND id = ANY($2::text[]) AND attendance_logged_at IS NOT NULL`, [org, gone.map(l => l.att)], { attendance_logged_at: null }, "their claim stamps");
    for (const l of gone) out.push(`${l.donor}: "${l.note}" removed (the guest is ${l.status || "not marked"} now)`);
  }
  return out;
}

// ── 10 · Pledge flags ────────────────────────────────────────────────────
// PLEDGES-2's relay, as recordGift runs it after a payment: every payment on
// the pledge applied oldest due first (flagsFor), an installment the money
// reaches in full flagged paid by the payment that completed it. The same two
// reads as relay. What is left on each installment is not stored: readers work
// it out from these flags and the payments (shared/numbers/pledges.js).
async function pledgeFlags(c, J, ctx) {
  const org = ctx.orgId, out = [];
  const pledges = (await c.query(
    `SELECT p.id, p.amount, d.name AS donor FROM pledges p LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
      WHERE p.org_id = $1 AND EXISTS (SELECT 1 FROM pledge_installments i WHERE i.org_id = p.org_id AND i.pledge_id = p.id) ORDER BY p.created_at, p.id`, [org])).rows;
  for (const p of pledges) {
    const rows = (await c.query(
      `SELECT id, due_date, amount, ROUND(amount::numeric * 100)::bigint AS cents, paid_gift_id, paid_at FROM pledge_installments
        WHERE org_id = $1 AND pledge_id = $2 ORDER BY due_date ASC NULLS LAST, seq ASC`, [org, p.id])).rows;
    const pays = (await c.query(
      `SELECT g.id, g.amount, ROUND(g.amount::numeric * 100)::bigint AS cents FROM gifts g
        WHERE g.org_id = $1 AND g.pledge_id = $2 AND ${MONEY("g")} AND g.amount > 0 ORDER BY LEFT(g.date::text, 10) ASC, g.created_at ASC, g.id ASC`, [org, p.id])).rows;
    const want = flagsFor(rows.map(r => Number(r.cents)), pays.map(g => ({ id: g.id, cents: Number(g.cents) })));
    let n = 0;
    for (const [k, r] of rows.entries()) {
      if ((r.paid_gift_id || null) === want[k]) continue;
      await J.update("pledge_installments", `org_id = $1 AND id = $2`, [org, r.id],
        { paid_gift_id: want[k], paid_at: want[k] ? (r.paid_at || ctx.now) : null }, "an installment's paid flag");
      n++;
    }
    if (!n) continue;
    const paid = pays.reduce((s, g) => s + Number(g.amount), 0);
    const pl = { amount: p.amount, paid, installments: rows.map((r, k) => ({ amount: r.amount, dueDate: r.due_date, paid: !!want[k] })) };
    const left = installmentsLeft(pl).filter(i => i.left > 0).length;
    out.push(`${p.donor || "A person"}'s pledge ${p.id}: ${plural(n, "paid flag")} put right from ${plural(pays.length, "payment")}; ${plural(left, "installment")} left, ${usd(balanceCents(pl))} still to come`);
  }
  return out;
}

const REPAIR_STEPS = [
  ["6 Send switches", sendSwitches],
  ["7 Sequences", sequences],
  ["8 Thank-you tasks", thankYous],
  ["9 Attendance lines", attendance],
  ["10 Pledge flags", pledgeFlags],
];
const ALL_ORG_STEPS = REPAIR_STEPS.filter(([t]) => /^(8|9|10) /.test(t));

module.exports = { REPAIR_STEPS, ALL_ORG_STEPS, OWN };
