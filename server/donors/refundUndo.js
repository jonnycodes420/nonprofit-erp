// server/donors/refundUndo.js · UNDO-1 item 2. A REFUND CAN BE TAKEN BACK.
//
// "A refund still cannot be undone anywhere." (fleet, 22 Nov)
//
// Recording a refund (refunds.js) writes a linked negative row through
// recordGift, voids the gift's receipt and reissues one for what remains. Each
// of those is now recorded (write_effects): a header line in Recent changes
// ("Refunded $100 of Renee Castillo's $100 gift. Reason: …") whose Undo is
// POST /refunds/:id/undo, and one effect per receipt it voided or issued.
//
// Undo refund, within 30 days, with the reason she gives:
//   · the refund row goes (refundPairs.removeRefundRows: its ledger line,
//     timeline line and draft with it), and the gift's "refunded in full" mark
//     is read again from what remains;
//   · the receipt comes back as it was: the reissued one is voided and the
//     voided one is live again, UNLESS a receipt for this gift went to the
//     donor since the refund. Then both stay as they are and the answer says
//     so: the donor holds that receipt, and a corrected one is issued by hand.
//   · a card refund made in Stripe is never offered: that money went back to
//     the card, and Steward can't take it back from here.
//   · the audit row is one sentence with her reason (req.audit.summary).
"use strict";

const express = require("express");
const WE = require("../effects/writeEffects");
const PAIRS = require("./refundPairs");
const RF = require("../../shared/numbers/refunds");

const routers = { r1: express.Router() };
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const toC = v => Math.round((Number(v) || 0) * 100);

// Called by POST /gifts/:id/refund once the refund row and its receipt work are written.
async function recordRefund(ctx, { orgId, g, refundId, cents, reason, who, voided, reissued, usd: money }) {
  if (!refundId) return;
  const db = { query: ctx.query, run: ctx.run };
  const parent = { orgId, kind: "refund", id: refundId, donorId: g.donor_id, who };
  await WE.begin(db, { ...parent,
    sentence: `Refunded ${money(cents)} of ${g.donor_name || "a donor"}'s ${money(toC(g.amount))} gift. Reason: ${reason}`,
    undo: g.stripe_payment_id ? null : { label: "Undo refund", ask: "reason", path: `/refunds/${encodeURIComponent(refundId)}/undo` } });
  if (voided) await WE.record(db, parent, { kind: "receipt_voided", table: "receipts", rowId: voided.id, before: { voided_at: null, void_reason: null } });
  if (reissued) await WE.record(db, parent, { kind: "receipt_issued", table: "receipts", rowId: reissued.id, before: null });
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, actor, recalcPledgePayment, recalcDonorSummary,
    withAdvisoryLock, withTransaction, queryTx, runTx } = ctx;
  const app = routers.r1;

  // What Undo refund will do, for the gift's menu: may it, and why not.
  async function refundOf(orgId, id) {
    const [r] = await query(
      `SELECT r.*, g.amount AS gift_amount, g.donor_id AS gift_donor_id, g.stripe_payment_id AS gift_stripe, g.pledge_id AS gift_pledge_id,
              d.name AS donor_name, h.created_at AS recorded_at, h.undone_at AS header_undone
         FROM gifts r JOIN gifts g ON g.id = r.refund_of AND g.org_id = r.org_id
         LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         LEFT JOIN write_effects h ON h.org_id = r.org_id AND h.parent_kind = 'refund' AND h.parent_id = r.id AND h.kind = 'write'
        WHERE r.id = ? AND r.org_id = ? AND r.refund_of IS NOT NULL`, [id, orgId]);
    return r || null;
  }
  function refusal(r) {
    if (!r) return { status: 404, body: { error: "not_found", sentence: "That refund is no longer on file." } };
    if (r.gift_stripe) return { status: 409, body: { error: "stripe_refund", sentence: "That refund went back to the card through Stripe, and Steward can't take it back from here." } };
    const at = r.recorded_at || r.created_at;
    if (at && Date.now() - new Date(at).getTime() > WE.UNDO_DAYS * 864e5) return { status: 409, body: { error: "too_old", sentence: `A refund can be undone for ${WE.UNDO_DAYS} days. This one is older, so it stays.` } };
    return null;
  }

  app.get("/gifts/:id/refund-undo", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const rows = await query("SELECT id FROM gifts WHERE org_id=? AND refund_of=? ORDER BY created_at DESC", [orgId, req.params.id]);
    const out = [];
    for (const x of rows) { const r = await refundOf(orgId, x.id); const no = refusal(r); out.push({ refundId: x.id, cents: -toC(r && r.amount), may: !no, sentence: no ? no.body.sentence : null }); }
    res.json({ giftId: req.params.id, refunds: out });
  }));

  app.post("/refunds/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, who = actor(req);
    const reason = String((req.body && req.body.reason) || "").trim().slice(0, 300);
    const r0 = await refundOf(orgId, req.params.id);
    const no = refusal(r0);
    if (no) return res.status(no.status).json(no.body);
    if (!reason) return res.status(400).json({ error: "reason_required", sentence: "Say why the refund is being undone." });
    const giftId = r0.refund_of;
    const out = await withAdvisoryLock(`gift:${giftId}`, async () => {
      const r = await refundOf(orgId, req.params.id);   // read again under the lock: a second click finds it gone
      if (!r) return { status: 404, body: { error: "not_found", sentence: "That refund was already undone." } };
      const cents = -toC(r.amount);
      // Did a receipt for this gift go to the donor after the refund? Then the receipts stay.
      const [sent] = await query(
        `SELECT receipt_number, sent_at FROM receipts WHERE org_id=? AND gift_id=? AND type='gift' AND sent_at IS NOT NULL AND sent_at > ?
          ORDER BY sent_at DESC LIMIT 1`, [orgId, giftId, r.recorded_at || r.created_at]);
      let receiptWords = "";
      await withTransaction(async client => {
        const db = WE.onClient(client, queryTx, runTx);
        if (sent) {
          await db.run(`UPDATE write_effects SET undone_at=NOW(), undone_by=?, undone_by_name=?, undo_reason=?
                         WHERE org_id=? AND parent_kind='refund' AND parent_id=? AND kind <> 'write' AND undone_at IS NULL`,
            [who.id, who.name, `kept: receipt #${sent.receipt_number} went to the donor`, orgId, r.id]);
          receiptWords = ` Receipt #${sent.receipt_number} already went to ${r.donor_name || "the donor"}, so the receipts stay as they are: issue a corrected one from the gift.`;
        } else {
          const back = await WE.reverse(db, orgId, { parentKind: "refund", parentId: r.id }, who, { reason });
          const restored = back.find(x => x.kind === "receipt_voided" && x.ok);
          if (restored) {
            const [rc] = await db.query("SELECT receipt_number FROM receipts WHERE id=? AND org_id=?", [restored.rowId, orgId]);
            receiptWords = rc ? ` Receipt #${rc.receipt_number} is live again.` : "";
          }
          const kept = WE.keptSentence(back);
          if (kept) receiptWords += " " + kept;
        }
        await PAIRS.removeRefundRows(PAIRS.onClient(client), orgId, [{ id: r.id, amount: r.amount }]);
        await runTx(client, RF.REMARK_IN_FULL_SQL, [giftId, orgId]);
        await WE.finish(db, orgId, "refund", r.id, who, reason);
      });
      if (r.gift_pledge_id) await recalcPledgePayment(r.gift_pledge_id, orgId).catch(() => {});
      await recalcDonorSummary(r.gift_donor_id, orgId).catch(() => {});
      await require("../../afterChange").afterChange(orgId, [r.gift_donor_id], { door: "gift_form", recalc: false })
        .catch(e => console.error("[refund-undo] after-change:", e.message));
      if (req.audit) { req.audit.entity("gift", giftId, r.donor_name || null); req.audit.action("refund undone");
        req.audit.summary(`Undid the ${usd(cents)} refund of ${r.donor_name || "a donor"}'s ${usd(toC(r.gift_amount))} gift. Reason: ${reason}`); }
      const [left] = await query(RF.REFUNDED_CENTS_SQL, [orgId, giftId]);
      const still = Number(left && left.c) || 0;
      return { status: 200, body: { ok: true, giftId, refundId: r.id, cents, stillRefundedCents: still,
        sentence: `The ${usd(cents)} refund is undone. ${still > 0 ? `${usd(still)} of the ${usd(toC(r.gift_amount))} gift is still refunded.` : `The ${usd(toC(r.gift_amount))} gift counts in full again.`}${receiptWords}` } };
    });
    res.status(out.status).json(out.body);
  }));
  return {};
}

module.exports = { routers, mount, recordRefund };
