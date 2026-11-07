// server/donors/offlinePlans.js · PLEDGES-2. A RECURRING PLAN STAFF CAN RECORD.
//
// W-1107-Finance-24 and -23: there was no way for staff to record an active
// recurring plan. The only route emailed the donor a link (recurring_proposals),
// which is right for a card on file and wrong for a check that arrives every
// month, a bank draft or an employer payroll gift.
//
// The rule (Bloomerang and the others): staff create the recurring record by
// hand for an offline commitment, with the amount, how often, a start date, a
// fund and an optional end date. They then add payments to it, or turn gifts
// already on file into payments of it. The plan says its next expected date and
// its payment history; a payment missed by more than GRACE_DAYS flags it
// "Behind"; Cancel asks first. A card plan through Stripe stays the
// donor-initiated path (recurring_subscriptions) and is labelled apart.
//
// A plan is not money. Each payment is a gift written by recordGift (the one
// gift path) and carries offline_plan_id.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };

const FREQUENCIES = { weekly: { days: 7 }, monthly: { months: 1 }, quarterly: { months: 3 }, annually: { months: 12 } };
const FREQ_WORDS = { weekly: "a week", monthly: "a month", quarterly: "a quarter", annually: "a year" };
const GRACE_DAYS = 7;
const LABEL = "Recorded by staff · offline";   // a card plan reads "Card on file · Stripe"
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Civil-date arithmetic on YYYY-MM-DD, no clock and no zone.
const toUtc = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => fromUtc(toUtc(d) + n * 86400000);
function addMonths(d, n) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();   // the 31st in a 30-day month is the 30th
  return fromUtc(Date.UTC(yy, mm, Math.min(day, last)));
}
// The k-th expected date, counted from the start (never from the last one, so a
// short month never drifts the day).
function nthDate(plan, k) {
  const f = FREQUENCIES[plan.frequency];
  return f.days ? addDays(plan.start_date, f.days * k) : addMonths(plan.start_date, f.months * k);
}

// The plan's state on `today` from its payments (gifts above zero): the next
// expected date, Behind and the sentence that says why.
function planState(plan, payments, today) {
  const paid = payments.filter(p => Number(p.amount) > 0).length;
  const end = plan.end_date || null;
  let next = nthDate(plan, paid);
  if (end && next > end) next = null;
  const cancelled = plan.status === "cancelled";
  // How many expected dates are more than GRACE_DAYS past with no payment for them.
  let due = 0;
  const cutoff = addDays(today, -GRACE_DAYS);
  for (let k = 0; k < 1000; k++) { const d = nthDate(plan, k); if (d > cutoff || (end && d > end)) break; due++; }
  const missed = cancelled ? 0 : Math.max(0, due - paid);
  const behind = missed > 0;
  const $ = v => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 });
  const sentence = cancelled ? "Cancelled. No more payments are expected."
    : !next ? "Complete: every payment through its end date is recorded."
    : behind ? `Behind: ${missed === 1 ? "a payment" : `${missed} payments`} expected by ${nthDate(plan, paid)} ${missed === 1 ? "has" : "have"} not been recorded (a payment is late after ${GRACE_DAYS} days).`
    : `On track. Next payment of ${$(plan.amount)} expected ${next}.`;
  return { nextExpected: cancelled ? null : next, behind, missed, paidCount: paid, sentence,
           status: cancelled ? "cancelled" : !next ? "complete" : behind ? "behind" : "active" };
}

function mount(ctx) {
  const { actor, checkWriteAccess, orgOwns, orgToday, orgTz, query, recordGift, requireAuth, run, toDollars, parseMoneyOrThrow, wrap } = ctx;
  const app = routers.r1;
  const TL = require("../../timelineLine");
  const todayOf = async orgId => orgToday(await orgTz(orgId));

  async function plansOf(orgId, donorId, planId = null) {
    const plans = await query(
      `SELECT pl.id, pl.donor_id, pl.amount::float AS amount, pl.frequency, pl.start_date, pl.end_date, pl.fund_id, f.name AS fund_name,
              pl.method, pl.notes, pl.status, pl.canceled_at, pl.canceled_by_name, pl.created_by_name, pl.created_at
         FROM offline_recurring_plans pl LEFT JOIN fin_funds f ON f.id = pl.fund_id AND f.org_id = pl.org_id
        WHERE pl.org_id=? AND ${planId ? "pl.id=?" : "pl.donor_id=?"} ORDER BY pl.created_at DESC`, [orgId, planId || donorId]);
    if (!plans.length) return [];
    const gifts = await query(
      `SELECT id, offline_plan_id, amount::float AS amount, LEFT(date::text, 10) AS date, payment_method FROM gifts
        WHERE org_id=? AND offline_plan_id = ANY(?) AND amount > 0 ORDER BY date ASC, created_at ASC`, [orgId, plans.map(p => p.id)]);
    const today = await todayOf(orgId);
    return plans.map(p => {
      const pays = gifts.filter(g => g.offline_plan_id === p.id);
      return { ...p, kind: "offline", label: LABEL, every: FREQ_WORDS[p.frequency] || p.frequency,
               payments: pays.map(g => ({ giftId: g.id, amount: g.amount, date: g.date, method: g.payment_method })),
               ...planState(p, pays, today) };
    });
  }

  // GET /donors/:id/offline-plans: this person's plans, each with its state and payments.
  app.get("/donors/:id/offline-plans", requireAuth, wrap(async (req, res) => {
    if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
    res.json({ plans: await plansOf(req.user.orgId, req.params.id), label: LABEL,
      sentence: `A plan staff recorded for an offline commitment. Its payments are gifts you add to it; a payment more than ${GRACE_DAYS} days late marks it Behind.` });
  }));

  // POST /donors/:id/offline-plans: { amount, frequency, startDate, endDate?, fundId?, method?, notes? }
  app.post("/donors/:id/offline-plans", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const b = req.body || {};
    if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
    let amount;
    try { amount = toDollars(parseMoneyOrThrow(b.amount, "amount")); } catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (!(amount > 0)) return res.status(400).json({ error: "A positive amount is required" });
    if (!FREQUENCIES[b.frequency]) return res.status(400).json({ error: "How often: weekly, monthly, quarterly or annually." });
    if (!ISO.test(String(b.startDate || ""))) return res.status(400).json({ error: "A start date (YYYY-MM-DD) is required." });
    if (b.endDate && (!ISO.test(String(b.endDate)) || b.endDate < b.startDate)) return res.status(400).json({ error: "The end date must be a date on or after the start." });
    if (b.fundId && !(await orgOwns("fin_funds", b.fundId, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
    const id = newId("orp"), who = actor(req);
    await run(`INSERT INTO offline_recurring_plans (id, org_id, donor_id, amount, frequency, start_date, end_date, fund_id, method, notes, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.user.orgId, req.params.id, amount, b.frequency, b.startDate, b.endDate || null, b.fundId || null,
       b.method ? String(b.method).slice(0, 60) : null, b.notes ? String(b.notes).slice(0, 500) : null, who.id, who.name]);
    await TL.timelineLine({ orgId: req.user.orgId, donorId: req.params.id, actorId: who.id, actorName: who.name, key: `offline_plan:${id}`,
      note: `Recurring plan recorded: ${TL.lineMoney(amount)} ${FREQ_WORDS[b.frequency]}${b.method ? ` by ${b.method}` : ""}, from ${b.startDate}${b.endDate ? ` to ${b.endDate}` : ""}.`,
      metadata: { via: "offline_plan", offline_plan_id: id } });
    res.status(201).json((await plansOf(req.user.orgId, req.params.id, id))[0]);
  }));

  async function ownPlan(req) {
    const [p] = await query("SELECT * FROM offline_recurring_plans WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    return p || null;
  }

  // POST /offline-plans/:id/payments: { amount?, date, method? } a payment, as a gift through recordGift.
  app.post("/offline-plans/:id/payments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const p = await ownPlan(req);
    if (!p) return res.status(404).json({ error: "Not found" });
    if (p.status === "cancelled") return res.status(400).json({ error: "This plan is cancelled. Record the payment as a gift." });
    const b = req.body || {};
    if (!ISO.test(String(b.date || ""))) return res.status(400).json({ error: "A payment date (YYYY-MM-DD) is required." });
    let amount;
    try { amount = toDollars(parseMoneyOrThrow(b.amount != null && b.amount !== "" ? b.amount : p.amount, "amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (!(amount > 0)) return res.status(400).json({ error: "A positive amount is required" });
    const who = actor(req), giftId = newId("g");
    const idem = typeof b.idempotencyKey === "string" && b.idempotencyKey.trim() ? b.idempotencyKey.trim().slice(0, 128) : null;
    const written = await recordGift({ orgId: req.user.orgId, donorId: p.donor_id, giftId, amount, date: b.date, type: "recurring",
      fundId: p.fund_id || null, paymentMethod: b.method || p.method || null, notes: "Payment on a recurring plan recorded by staff.",
      idempotencyKey: idem, conflict: "idempotency", recurring: true, applyInstallment: false,
      actorId: who.id, actorName: who.name, source: "offline_plan" });
    const gid = written.duplicate
      ? ((await query("SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idem]))[0] || {}).id
      : giftId;
    if (gid) await run("UPDATE gifts SET offline_plan_id=? WHERE id=? AND org_id=? AND offline_plan_id IS NULL", [p.id, gid, req.user.orgId]);
    res.status(written.duplicate ? 200 : 201).json({ giftId: gid, plan: (await plansOf(req.user.orgId, p.donor_id, p.id))[0] });
  }));

  // POST /offline-plans/:id/convert: { giftIds } gifts already on file become payments of the plan.
  // Only this person's, not a pledge payment, not already on a plan, not a card plan's.
  app.post("/offline-plans/:id/convert", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const p = await ownPlan(req);
    if (!p) return res.status(404).json({ error: "Not found" });
    const ids = (Array.isArray(req.body && req.body.giftIds) ? req.body.giftIds : []).map(String).slice(0, 500);
    if (!ids.length) return res.status(400).json({ error: "Pick the gifts to make payments of this plan." });
    const done = await query(
      `UPDATE gifts SET offline_plan_id=? WHERE org_id=? AND donor_id=? AND id = ANY(?) AND amount > 0 AND offline_plan_id IS NULL
          AND pledge_id IS NULL AND recurring_subscription_id IS NULL RETURNING id`, [p.id, req.user.orgId, p.donor_id, ids]);
    res.json({ converted: done.length, skipped: ids.length - done.length, plan: (await plansOf(req.user.orgId, p.donor_id, p.id))[0],
      sentence: done.length === ids.length ? null : "A gift that pays a pledge, a card plan or another plan, or is someone else's, was left as it was." });
  }));

  // POST /offline-plans/:id/cancel: { confirmed: true }. Without the confirm, the question.
  app.post("/offline-plans/:id/cancel", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const p = await ownPlan(req);
    if (!p) return res.status(404).json({ error: "Not found" });
    if (p.status === "cancelled") return res.json({ ok: true, already: true });
    const words = `${TL.lineMoney(Number(p.amount))} ${FREQ_WORDS[p.frequency] || ""}`.trim();
    if (!req.body || req.body.confirmed !== true)
      return res.status(409).json({ error: "confirm_cancel", code: "confirm_cancel",
        sentence: `Cancel the recurring plan of ${words}? Payments already recorded stay; no more are expected.` });
    const who = actor(req);
    await run("UPDATE offline_recurring_plans SET status='cancelled', canceled_at=NOW(), canceled_by=?, canceled_by_name=?, updated_at=NOW() WHERE id=? AND org_id=?",
      [who.id, who.name, p.id, req.user.orgId]);
    await TL.timelineLine({ orgId: req.user.orgId, donorId: p.donor_id, actorId: who.id, actorName: who.name,
      note: `Recurring plan of ${words} cancelled.`, metadata: { via: "offline_plan", offline_plan_id: p.id, cancelled: true } });
    res.json({ ok: true, plan: (await plansOf(req.user.orgId, p.donor_id, p.id))[0] });
  }));
}

module.exports = { routers, mount, planState, nthDate, addMonths, FREQUENCIES, GRACE_DAYS, LABEL };
