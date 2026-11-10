// server/donors/refunds.js · MONEY-4 (W-1109-Finance-27). RECORD A REFUND.
//
// There was no way to record a refund anywhere. As in Bloomerang, Little Green
// Light and Salesforce NPSP, a gift has "Record a refund": an amount (full or
// partial), a date and a reason. It writes a LINKED NEGATIVE ROW through
// recordGift (the one gift path), and the original gift stays as it was:
//   · totals net it out (shared/numbers/money.js MONEY: a refund is money that
//     went back out), and the gift reads "refunded" beside its amount;
//   · the gift count drops only on a full refund (gifts.refunded_in_full,
//     which money.js GIFT reads; kept here and nowhere else);
//   · the gift's receipt is voided, and reissued for the net amount if any
//     remains (made, not emailed: it is sent from its own Email link);
//   · a Stripe gift's refund is also made in Stripe, only after a confirm that
//     names the amount (409 stripe_confirm first). Stripe's later
//     charge.refunded echo finds the refund on file and changes nothing.
//   GET  /gifts/:id/refunds   what has been refunded, and what is left to refund
//   POST /gifts/:id/refund    { amount, date, reason, confirmStripe? }
"use strict";
const express = require("express");
const routers = { r1: express.Router() };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const toC = v => Math.round((Number(v) || 0) * 100);

async function refundedCents(query, orgId, giftId) {
  const [r] = await query(require("../../shared/numbers/refunds").REFUNDED_CENTS_SQL, [orgId, giftId]);
  return Number(r && r.c) || 0;
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, actor, recordGift, recalcPledgePayment, recalcDonorSummary,
    issueGiftReceipt, parseMoneyOrThrow, orgToday, orgTz, withAdvisoryLock } = ctx;
  const app = routers.r1;

  async function ownGift(req) {
    const [g] = await query(
      `SELECT g.*, d.name AS donor_name FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.id=? AND g.org_id=?`, [req.params.id, req.user.orgId]);
    return g || null;
  }

  app.get("/gifts/:id/refunds", requireAuth, wrap(async (req, res) => {
    const g = await ownGift(req);
    if (!g) return res.status(404).json({ error: "Gift not found" });
    const rows = await query(`SELECT id, amount, date, refund_reason, created_by_name FROM gifts WHERE org_id=? AND refund_of=? ORDER BY date, created_at`, [req.user.orgId, g.id]);
    const giftC = toC(g.amount), refC = rows.reduce((n, r) => n - toC(r.amount), 0);
    res.json({ giftId: g.id, giftCents: giftC, refundedCents: refC, leftCents: Math.max(0, giftC - refC), stripe: !!g.stripe_payment_id,
      refunds: rows.map(r => ({ id: r.id, cents: -toC(r.amount), date: String(r.date || "").slice(0, 10), reason: r.refund_reason || "", by: r.created_by_name || "" })) });
  }));

  app.post("/gifts/:id/refund", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const b = req.body || {};
    const orgId = req.user.orgId;
    const g = await ownGift(req);
    if (!g) return res.status(404).json({ error: "Gift not found" });
    if (g.refund_of || !(toC(g.amount) > 0)) return res.status(409).json({ error: "not_a_gift", sentence: "Only a gift above $0 can be refunded." });
    let cents;
    try { cents = parseMoneyOrThrow(b.amount, "amount"); } catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (!(cents > 0)) return res.status(400).json({ error: "bad_amount", sentence: "A refund needs an amount above $0." });
    const day = ISO.test(String(b.date || "")) ? String(b.date) : orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const reason = String(b.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(400).json({ error: "reason_required", sentence: "Say why it is being refunded." });

    const out = await withAdvisoryLock(`gift:${g.id}`, async () => {
      const already = await refundedCents(query, orgId, g.id);
      const left = toC(g.amount) - already;
      if (cents > left) return { status: 409, body: { error: "over_refund", leftCents: left,
        sentence: left > 0 ? `Only ${usd(left)} of this ${usd(toC(g.amount))} gift is left to refund.` : "This gift is already refunded in full." } };
      const full = cents === left;
      // A Stripe gift: the money goes back to the card too, and only on a confirm that names the amount.
      if (g.stripe_payment_id) {
        if (b.confirmStripe !== true || toC(b.confirmAmount) !== cents) {
          return { status: 409, body: { error: "stripe_confirm", cents,
            sentence: `This gift was paid by card through Stripe. Refunding it sends ${usd(cents)} back to ${g.donor_name || "the donor"}'s card. Refund ${usd(cents)}?` } };
        }
        const [org] = await query("SELECT stripe_account_id FROM orgs WHERE id=?", [orgId]);
        if (!ctx.stripe || !org || !org.stripe_account_id) return { status: 409, body: { error: "stripe_not_connected", sentence: "Stripe is not connected, so the card can't be refunded from here. Refund it in Stripe; Steward records it when Stripe says so." } };
        try {
          await ctx.stripe.refunds.create({ payment_intent: g.stripe_payment_id, amount: cents, metadata: { steward_gift_id: g.id, reason: reason.slice(0, 200) } },
            { stripeAccount: org.stripe_account_id, idempotencyKey: `steward-refund:${g.id}:${already}:${cents}` });
        } catch (e) {
          return { status: 502, body: { error: "stripe_refused", sentence: `Stripe did not make the refund: ${e.message}. Nothing was recorded.` } };
        }
      }
      const who = actor(req);
      const w = await recordGift({
        orgId, donorId: g.donor_id, amount: -cents / 100, date: day, type: "refund", fundId: g.fund_id || null,
        paymentMethod: g.payment_method || null, pledgeId: g.pledge_id || null, campaign: g.campaign || "", campaignId: g.campaign_id || null,
        notes: `Refund: ${reason}`,
        refundOf: g.id, refundReason: reason, applyInstallment: false, membershipRenewal: false,
        thankYou: false, alreadyThanked: true, defaultFund: false, door: "refund", source: "refund",
        ledgerDescription: `Refund: ${g.donor_name || "gift"}`, actorId: who.id, actorName: who.name,
      });
      const refundId = w && w.gift ? w.gift.id : null;
      await run("UPDATE gifts SET refunded_in_full=? WHERE id=? AND org_id=?", [full, g.id, orgId]);
      if (g.pledge_id) await recalcPledgePayment(g.pledge_id, orgId).catch(() => {});
      await recalcDonorSummary(g.donor_id, orgId).catch(() => {});

      // The receipt: voided, and reissued for what remains.
      let voided = null, reissued = null;
      const [rc] = await query("SELECT id, receipt_number, amount FROM receipts WHERE gift_id=? AND org_id=? AND type='gift' AND voided_at IS NULL", [g.id, orgId]);
      if (rc) {
        const netC = left - cents;
        const why = `Refunded ${usd(cents)} on ${day} (${reason}). Voided by ${who.name}.`;
        await run("UPDATE receipts SET voided_at=NOW(), void_reason=? WHERE id=? AND org_id=? AND voided_at IS NULL", [why, rc.id, orgId]);
        voided = { id: rc.id, number: rc.receipt_number };
        if (netC > 0) {
          const [o] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
          const [d] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
          const r = await issueGiftReceipt({ ...g, amount: netC / 100, refund_net: true, refunded_in_full: false }, o, d, { send: false, by: who, manual: true });
          if (r && r.receipt) {
            reissued = { id: r.receipt.id, number: r.receipt.receipt_number, cents: toC(r.receipt.amount) };
            await run("UPDATE receipts SET void_reason=? WHERE id=? AND org_id=?", [`${why} Reissued as #${r.receipt.receipt_number} for ${usd(netC)}.`, rc.id, orgId]);
          }
        }
      }
      const netC = left - cents;
      return { status: 201, body: {
        refundId, giftId: g.id, cents, full, netCents: netC, stripe: !!g.stripe_payment_id, voided, reissued,
        sentence: [`Recorded a ${usd(cents)} refund of the ${usd(toC(g.amount))} gift${full ? ", refunded in full" : `; ${usd(netC)} remains`}.`,
          g.stripe_payment_id ? `Stripe is refunding ${usd(cents)} to the card.` : null,
          voided ? (reissued ? `Receipt #${voided.number} is void, and #${reissued.number} for ${usd(reissued.cents)} is ready.` : `Receipt #${voided.number} is void.`) : null].filter(Boolean).join(" "),
      } };
    });
    res.status(out.status).json(out.body);
  }));
  return {};
}

module.exports = { routers, mount, refundedCents };
