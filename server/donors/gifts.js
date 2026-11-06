// server/donors/gifts.js — gifts, pledges, receipts, soft credits and designations.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// FIX-11 Part 1 — the audit log's own vocabulary (the sentence a row reads as).
// The WRITING of a row happens in middleware/auditTrail.js and nowhere else.
const auditTrailMod = require("../../auditTrail");
const SEND_GATE = require("../../sendGate");   // SEND-GATE-1: a staff click is the confirm for one message
const TL = require("../../timelineLine");
const NUM = require("../../campaignMatch");
const RCE = require("./receiptEmail");   // FLOWS-1: a receipt or statement emailed only on its own click
const PW = require("../../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments
const EG = require("../events/eventGifts");   // GIFTS-1: the event a gift was given at

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  NOT_YOURS, SYS_AUTO, TF, UNDO_SECONDS, actor, allocateReceiptNumber, applyReceiptTokens, calcWealthScore,
  checkGiftExtras, checkWriteAccess, donorCreditTotals, donorMailDecision, donorPhotoUrl, editStamp,
  ensureOrgLedger, fireWorkflows, issueGiftReceipt, mayEditLogged, money, normalizeGiftDate, openGiftThread,
  orgForYears, orgOwns, orgTime, orgToday, orgTz, parseMoneyOrThrow, pledgeDisplayStatus,
  processPledgeInstallmentReminders, processPledgeReminders, query, recalcDonorSummary, recalcPledgePayment,
  recordAssetPointerHistory, recordAutoMove, recordGift, renderReceiptPdf, requireAdmin, requireAuth,
  resolveOrgBrandTheme, resolvePdfLogo, round2, run, runTx, sendPledgeReminderEmail, sendReceiptEmail,
  staffWho, storeChequeImage, toDollars, trashRow, uuid, withAdvisoryLock, withTransaction, wrap,
  writeGiftExtras, giftHooks, queueThankYouDraft,
} = ctx;
let app = routers.r0;

// POST /pledges/run-reminders — drive the sweep for the caller's org now
// (ops/test hook, the /nudges/run bar). {today} pins the date.
app.post("/pledges/run-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  const today = (req.body && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.today))) ? String(req.body.today) : null;
  const out = await processPledgeInstallmentReminders({ orgId: req.user.orgId, today });
  res.json(out);
}));
// FIX-51 · ONE QUIET RULE. "Going quiet" is lapseRule.js and nothing else:
// Lapsing (last gift 9 to 12 months ago) and Lapsed (12 months and more).
// The 180-day clock that the going-quiet suggestion, the Communications
// segment and Home's re-engage list each kept is gone; each reads the rule.

// Auto-un-lapse: a lapsed donor just gave, so move them out of Lapsed to
// Steward automatically ("they just gave"), logged, editable. Called from every
// gift-insert path with the donor's PRE-gift stage. No-op unless they were
// lapsed. The UPDATE is guarded on stage='lapsed' so a concurrent human move
// can't be clobbered.
async function autoUnlapseOnGift(orgId, donorId, preStage) {
  if (preStage !== "lapsed") return false;
  const upd = await query(
    "UPDATE donors SET stage='steward', updated_at=NOW() WHERE id=? AND org_id=? AND stage='lapsed' RETURNING id",
    [donorId, orgId]);
  if (!upd.length) return false; // someone moved them first — respect it
  await recordAutoMove(orgId, donorId, "lapsed", "steward", "Auto: new gift after a year-long gap");
  return true;
}
app = routers.r1;

app.post("/donors/:id/gifts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, pledgeId } = req.body;
  // Accept both spellings for back-compat: the touchpoint modal sends `fundId`,
  // the Add-Gift form sends `fund_id`. Same for the campaign reference.
  const fundId = req.body.fundId || req.body.fund_id || null;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  // FIX-11 Part 1 — and the payment method, in BOTH spellings, for the same
  // reason as the two above. This route read only `paymentMethod`, while the
  // gift form, the gift EDIT route and the bookkeeper export all speak
  // `payment_method` — so a gift typed with a method chosen was stored with
  // none, and came out of the export as one of the blank-method rows Part 3
  // is about. Found by walking the browser, not by any test of the route.
  const paymentMethodIn = req.body.paymentMethod || req.body.payment_method || null;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }

  const donorExists = await query(
    "SELECT id, stage FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });
  const preGiftStage = donorExists[0].stage;  // BUILD-22 auto-unlapse

  // Optional fund designation (the client's "Finance Fund" selector). Validated
  // org-scoped so a foreign fund id can't be pinned onto this gift's ledger row.
  // BUILD-21 Part 3: the gift carries its own fund and stamps the ledger ONCE
  // with it — replacing the old client behavior that logged the gift AND made a
  // second manual /finance/transactions call (the double-stamp bug).
  if (fundId && !(await orgOwns("fin_funds", fundId, req.user.orgId))) {
    return res.status(404).json({ error: "Fund not found" });
  }

  // BUILD-32 — real campaign attribution. `campaign_id` is the structured
  // reference a thermometer/roll-up reads (fundraisingCampaignRows matches
  // campaign_id OR the legacy free-text campaign name). Validated org-scoped so
  // a foreign campaign id can't be pinned on. Optional (a gift may be
  // unattributed). We also copy the campaign NAME into the legacy `campaign`
  // text column so name-based reports/exports stay consistent.
  let campaignName = campaign || "";
  let effectiveCampaignId = campaignId;

  // Optional: this gift is a payment against a specific pledge — the "gift
  // recorded against it" stop condition (see processPledgeReminders()).
  // Validated up front so a stale/foreign pledgeId 400s before any insert.
  //
  // BUILD-72 Part 3 — an ALREADY-FULFILLED pledge still accepts payments. The
  // old `status='open'` filter rejected them, which is one of the three ways a
  // donor's money could fail to land: a final payment arriving after the pledge
  // was completed by an earlier one is a real event, and the brief is explicit
  // that an overpayment is neither capped nor rejected. It becomes surplus.
  // A WRITTEN-OFF pledge is still refused: that is a deliberate human decision
  // and a payment against it should be recorded as a plain gift instead.
  let pledgeRow = null;
  if (pledgeId) {
    const pledgeRows = await query(
      "SELECT * FROM pledges WHERE id=? AND donor_id=? AND org_id=? AND status IN ('open','fulfilled')",
      [pledgeId, req.params.id, req.user.orgId]
    );
    if (!pledgeRows.length) return res.status(400).json({ error: "This pledge is not open for this donor." });
    pledgeRow = pledgeRows[0];
    // Attribution FIX — a payment against a campaign-attributed pledge
    // inherits the pledge's campaign automatically (an explicit campaignId on
    // the gift still wins). This is how a pledge converts from the campaign's
    // "pledged" figure into its "raised" figure as payments arrive — the
    // pledge itself is never summed into raised.
    if (!effectiveCampaignId && pledgeRow.campaign_id) effectiveCampaignId = pledgeRow.campaign_id;
  }

  if (effectiveCampaignId) {
    const camp = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE id=? AND org_id=?", [effectiveCampaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
    // NUMBERS-1 · a gift counts toward a campaign only inside its dates. A
    // campaign somebody chose is refused with the sentence; one inherited from
    // a pledge is simply not inherited, because nobody chose it.
    const refusal = normalizeGiftDate(date) ? NUM.campaignWindowRefusal(camp[0], normalizeGiftDate(date)) : null;
    if (refusal && campaignId) return res.status(400).json({ error: refusal, code: "campaign_window" });
    if (refusal) effectiveCampaignId = null;
    else campaignName = camp[0].name;
  }

  // GIFTS-1: the event this gift was given at, org-scoped like the fund.
  const eventIn = req.body.eventId || req.body.event_id || null;
  const giftEvent = eventIn ? await EG.eventOf(query, req.user.orgId, eventIn) : null;
  if (eventIn && !giftEvent) return res.status(404).json({ error: "Event not found" });

  const giftId = newId("g");
  const giftDate = normalizeGiftDate(date);              // enforce ISO YYYY-MM-DD
  if (!giftDate) return res.status(400).json({ error: "A valid gift date (YYYY-MM-DD) is required, an unparseable date is an error, never today's date." });
  // BUILD-73 Part 2 — the money seam. The comment that used to sit here said
  // "INTEGER column", which stopped being true at the cover-fees migration and
  // is the likeliest reason the rounding outlived its justification.
  let amt;
  try { amt = toDollars(parseMoneyOrThrow(amount, "amount")); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  // §1.1 F-3 — client-generated idempotency key, enforced by uq_gifts_idem at
  // the DATABASE (not an app-layer check). A double-tapped Save, a replayed
  // request, or 50 parallel identical submits produce exactly one gift row;
  // every replay returns the original gift with duplicate:true and runs ZERO
  // side effects (no donor delta, no ledger stamp, no interaction, no
  // workflow fire, no pledge application).
  const idemKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 128) : null;

  // BUILD-98 Part 1 — soft credits, a tribute, an expected match. All checked
  // before the gift exists: a refused extra refuses the gift.
  let giftExtras = null;
  if (req.body.softCredits || req.body.tribute || req.body.match) {
    const ck = await checkGiftExtras(req.user.orgId, req.params.id, Math.round(amt * 100),
      { softCredits: req.body.softCredits, tribute: req.body.tribute, match: req.body.match });
    if (ck.notFound) return res.status(404).json({ error: "Donor not found" });
    if (ck.errors) return res.status(400).json({ error: ck.errors.join("; ") });
    giftExtras = ck.extras;
  }

  // BUILD-88a A.1 — THROUGH THE ONE FUNCTION. The insert, the donor rollup,
  // the ledger stamp and the timeline entry all lived here as four separate
  // statements, each with its own idea of a gift; they are recordGift's now.
  const written = await recordGift({
    orgId: req.user.orgId, donorId: req.params.id, giftId, amount: amt, date: giftDate,
    type: type || "cash", campaign: campaignName || "", campaignId: effectiveCampaignId || null,
    notes: notes || "", fundId: fundId || null, paymentMethod: paymentMethodIn,
    pledgeId: pledgeRow ? pledgeRow.id : null, idempotencyKey: idemKey, conflict: "idempotency",
    eventId: giftEvent ? giftEvent.id : null,
    actorId: actor(req).id, actorName: actor(req).name, source: "gift_form",
    extras: giftExtras, thread: { id: req.user.userId, name: actor(req).name },
  });
  if (written.duplicate) {
    const dupGift = await query("SELECT * FROM gifts WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idemKey]);
    const dupDonor = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    return res.status(200).json({ gift: dupGift[0] || null, donor: dupDonor[0] || null, duplicate: true });
  }
  if (pledgeRow) {
    // §1.2 F-5 — apply the PAID amount against the pledge balance; a partial
    // payment leaves the pledge open with an honest remaining balance.
    await recalcPledgePayment(pledgeRow.id, req.user.orgId);
  }
  const giftRows  = [written.gift];
  const donorRows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  // BUILD-22 — a lapsed donor who just gave auto-moves out of Lapsed to Steward
  // (logged move + timeline entry, editable). No-op unless they were lapsed.
  await autoUnlapseOnGift(req.user.orgId, req.params.id, preGiftStage).catch(e => console.error("[smart-move] unlapse:", e.message));
  // BUILD-13 workflows — a manually-logged gift fires gift_received too (new-
  // donor + major-gift recipes). gift_count===1 after this insert means it was
  // the donor's first gift. Idempotent per giftId; fire-and-forget.
  fireWorkflows(req.user.orgId, "gift_received", {
    dedupKey: `gift:${giftId}`, donorId: req.params.id, giftId, amount: amt,
    isFirstGift: (donorRows[0]?.gift_count || 0) === 1, entityType: "gift", entityId: giftId,
  }).catch(e => console.error("[workflow] gift_received:", e.message));
  const fulfilledPledgeRows = pledgeRow ? await query(
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance,
            GREATEST(COALESCE(pp.paid,0) - p.amount, 0) AS surplus
     FROM pledges p
     LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp
       ON pp.pledge_id = p.id
     WHERE p.id=?`, [req.user.orgId, pledgeRow.id]) : [];
  // BUILD-72 Part 3 — the response a payment returns says what the payment DID:
  // remaining balance, or the surplus if the donor overpaid.
  const fp = fulfilledPledgeRows[0] || null;
  const fpOut = fp ? (() => {
    const paid = round2(parseFloat(fp.paid_amount) || 0);
    const amount = round2(parseFloat(fp.amount) || 0);
    const surplus = round2(parseFloat(fp.surplus) || 0);
    return { ...fp, paid, balance: round2(parseFloat(fp.balance) || 0), surplus, overpaid: surplus > 0,
             displayStatus: pledgeDisplayStatus(paid, amount, fp.status) };
  })() : null;
  // BUILD-81 — a live gift is a touch: it opens a thread whose next step is
  // "Thank" (+2 days) unless the donor already has one open: recordGift's
  // `thread` above, opened by the gift's journeys handler after the journeys
  // have had their turn (JOBS-1). The gift itself never waits.
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0], pledge: fpOut });
}));

app.put("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, fund_id, payment_method, acknowledgement_sent } = req.body;
  const campaignId = req.body.campaignId !== undefined ? req.body.campaignId
                   : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  // §1 tenant isolation: a foreign fund id must not be pinned onto this gift
  // (it would surface another org's fund name in fund-affinity/reports JOINs).
  if (!(await orgOwns("fin_funds", fund_id, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
  const g = existing[0];
  // BUILD-32 — campaign attribution editable. A non-null campaignId is validated
  // org-scoped; passing "" / null explicitly clears attribution. Undefined leaves
  // the existing value untouched. When set, the legacy name column is kept in sync.
  let newCampaignId = g.campaign_id, newCampaign = campaign !== undefined ? campaign : g.campaign;
  if (campaignId !== undefined) {
    if (campaignId) {
      const camp = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      // NUMBERS-1 · choosing a campaign for a gift dated outside it is refused
      // with the sentence. A date edit alone keeps the attribution, and the
      // gift then counts toward nothing (campaignMatch.js).
      const refusal = NUM.campaignWindowRefusal(camp[0], (date && normalizeGiftDate(date)) || g.date);
      if (refusal) return res.status(400).json({ error: refusal, code: "campaign_window" });
      newCampaignId = camp[0].id; newCampaign = camp[0].name;
    } else {
      // BUILD-43 (state-diff harness finding): an explicit clear must clear
      // the legacy NAME column too — the read side matches `campaign_id OR
      // campaign=name`, so leaving the synced name behind kept the gift
      // attributed forever and made clearing impossible. A caller that
      // deliberately sends a free-text `campaign` name alongside keeps it.
      newCampaignId = null;
      if (campaign === undefined) newCampaign = null;
    }
  }
  // BUILD-73 Part 2 — THIS is the path the audit was written for: it rounds any
  // gift, including one carrying a stripe_payment_id, so a $33.33 online gift
  // whose campaign was corrected in the UI came back out as $33.
  let newAmt = g.amount;
  if (amount !== undefined) {
    try { newAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }
  // GIFTS-1: the event is editable; "" or null clears it, undefined keeps it.
  const eventIn = req.body.eventId !== undefined ? req.body.eventId : req.body.event_id;
  let newEventId = g.event_id || null;
  if (eventIn !== undefined) {
    const ev = eventIn ? await EG.eventOf(query, req.user.orgId, eventIn) : null;
    if (eventIn && !ev) return res.status(404).json({ error: "Event not found" });
    newEventId = ev ? ev.id : null;
  }
  const newDate = date ? normalizeGiftDate(date) : g.date;                       // enforce ISO
  if (date && !newDate) return res.status(400).json({ error: "A valid gift date (YYYY-MM-DD) is required, an unparseable date is an error, never today's date." });
  // BUILD-27 concurrency (concurrency2 "torn write" fix): serialize this gift's
  // edit → donor-recalc → ledger-stamp trio under a per-gift advisory lock, the
  // same primitive the import/webhook-donor dedup paths use. recalcDonorSummary
  // is a read-modify-write (SELECT SUM → UPDATE donors) and the ledger UPDATE is
  // a bare write, so two simultaneous edits to the SAME gift could interleave
  // into gift=900 / donor=900 / ledger=700 (the three writes torn apart). With
  // the lock the last writer wins all three, so donor total AND the ledger stamp
  // always equal the winning gift amount. NB a single user's double-tapped Save
  // is safe without this (both requests carry the same amount → they converge);
  // the torn state needs two DIFFERENT target amounts, i.e. two concurrent
  // editors — a P1 coherence race, not P0 single-user corruption.
  const rows = await withAdvisoryLock(`gift:${req.params.id}`, async () => {
    await run(
      `UPDATE gifts SET amount=?,date=?,type=?,campaign=?,campaign_id=?,event_id=?,notes=?,fund_id=?,payment_method=?,acknowledgement_sent=?,
              acknowledgement_sent_at = CASE WHEN ? IS TRUE THEN COALESCE(acknowledgement_sent_at, NOW()) ELSE NULL END
        WHERE id=? AND org_id=?`,
      [newAmt, newDate, type||g.type, newCampaign, newCampaignId, newEventId,
       notes!==undefined?notes:g.notes, fund_id!==undefined?fund_id:g.fund_id,
       payment_method!==undefined?payment_method:g.payment_method,
       acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,
       acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,   // A.5 — the same value drives the stamp
       req.params.id, req.user.orgId]
    );
    // NUMBERS-1: a soft credit follows the gift's new amount.
    for (const sql of require("../../donorSummary").SOFT_CREDIT_RESIZE) await run(sql, [req.params.id, req.user.orgId]);
    // Full recalc replaces the old delta — delta was wrong when editing a non-latest gift's amount
    await recalcDonorSummary(g.donor_id, req.user.orgId);
    // BUILD-43 (state-diff harness finding): the gift's LEDGER STAMP must move
    // with it. Editing a stamped gift's amount/date left fin_transactions at the
    // old figures — Cash on Hand permanently disagreed with the gift record and
    // (unlike receipts) no mismatch queue ever surfaced it. Same sync the
    // partial-refund webhook already does by hand; fund follows when provided.
    await run(
      `UPDATE fin_transactions SET amount=?, date=?, fund_id=COALESCE(?, fund_id)
        WHERE gift_id=? AND org_id=?`,
      // NUMBERS-2: a fund cleared on the gift moves its ledger stamp to the
      // general fund, where recordGift puts a gift with no fund (the old
      // COALESCE kept the money in the fund that was cleared).
      [newAmt, newDate, fund_id !== undefined ? (fund_id || (await ensureOrgLedger(req.user.orgId, { heal: true })).genFundId) : null, req.params.id, req.user.orgId]
    );
    // F-5: an amount edit on a pledge-linked payment changes the pledge's paid
    // total — recompute (may fulfill, may reopen; canceled never resurrected).
    if (g.pledge_id) await recalcPledgePayment(g.pledge_id, req.user.orgId);
    return query("SELECT * FROM gifts WHERE id=?", [req.params.id]);
  });
  // LEDGER-1 · AN EDIT MOVES EVERY FIGURE. The thank-you waiting on this gift
  // was written about the old amount, fund and date: an unsent, unskipped
  // draft is written again from the gift as it now stands (a sent letter is
  // never touched). Then the one after-change step, as every gift door runs
  // it: this year, the household, the rhythm, groups and the stored Home figures.
  const after = rows[0] || {};
  const [draft] = await query(
    "SELECT id FROM thank_you_drafts WHERE org_id=? AND gift_id=? AND sent_at IS NULL AND skipped_at IS NULL", [req.user.orgId, req.params.id]);
  if (draft && queueThankYouDraft) {
    await queueThankYouDraft(req.user.orgId, { giftId: req.params.id, donorId: after.donor_id, cents: money.toCents(after.amount) ?? 0,
      fundId: after.fund_id || null, type: after.type || "cash", force: true, replace: true })
      .catch(e => console.error("[gift-edit] redraft:", e.message));
  }
  await require("../../afterChange").afterChange(req.user.orgId, [g.donor_id], { door: "gift_form", recalc: false })
    .catch(e => console.error("[gift-edit] after-change:", e.message));
  res.json(rows[0]);
}));

app.delete("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  const g = existing[0];
  // SECURE-1: a gift is money. The person who entered it may take it back, and
  // so may an admin; nobody else (the pledge delete below already worked so).
  if (!(await mayEditLogged(req, g))) return res.status(403).json(NOT_YOURS);

  // A receipt is a legal artifact — a gift with an ACTIVE receipt can't be
  // silently deleted out from under it (was an unhandled FK violation).
  // Void the receipt first (POST /receipts/:id/void), then delete.
  const activeReceipts = await query(
    "SELECT receipt_number FROM receipts WHERE gift_id=? AND org_id=? AND type='gift' AND voided_at IS NULL",
    [req.params.id, req.user.orgId]
  );
  if (activeReceipts.length) {
    return res.status(409).json({
      error: "receipt_active",
      message: `This gift has an issued tax receipt (#${activeReceipts[0].receipt_number}). Void the receipt first, then delete the gift.`,
    });
  }

  // FIX-10 Part C — how many of this gift's own tasks the delete voided, so the
  // timeline note can say it. Declared above the block that assigns it.
  let voidedTaskCount = 0;
  // BUILD-27 concurrency: serialize the whole delete → donor-recalc under the
  // SAME per-gift advisory lock PUT /gifts/:id takes, so a concurrent edit and
  // delete of the SAME gift can't tear the donor total apart from the ledger.
  await withAdvisoryLock(`gift:${req.params.id}`, async () => {
  await withTransaction(async (client) => {
    // Voided receipts keep their frozen `snapshot`/`pdf_data` record — just
    // detach the gift reference so the FK doesn't block deletion (same
    // tolerated-dangling pattern as gifts.giving_page_id, except here the FK
    // is real so it must be NULLed, not left dangling).
    await runTx(client, "UPDATE receipts SET gift_id=NULL WHERE gift_id=? AND org_id=?", [req.params.id, req.user.orgId]);
    // Clear the fulfilled_gift_id FK before the gift row goes (F-5: whether
    // the pledge actually reopens is decided AFTER the delete by
    // recalcPledgePayment — remaining payments may still cover it).
    await runTx(client,
      `UPDATE pledges SET fulfilled_gift_id=NULL, updated_at=NOW()
       WHERE fulfilled_gift_id=? AND org_id=?`,
      [req.params.id, req.user.orgId]);
    // BUILD-33: the gift's own ledger stamp goes with it. "Every gift stamps
    // fin_transactions exactly once" (uq_fin_txns_gift) — zero gifts, zero
    // stamps; leaving the row would inflate Cash on Hand with money from a
    // gift that no longer exists anywhere. Manual/expense rows (gift_id NULL)
    // are untouched.
    await runTx(client, "DELETE FROM fin_transactions WHERE gift_id=? AND org_id=?", [req.params.id, req.user.orgId]);
    // ── FIX-10 Part C · RECORDS STAY CLEAN ──────────────────────────────────
    // A gift's arrival creates tasks ("Thank Ruth, $500 just came in", the
    // stewardship alert). Deleting the gift used to leave them standing,
    // pointing at money that no longer exists anywhere, and a director had no
    // way to tell them from a task she had typed herself. They are VOIDED
    // here: off every list, still a row, with the reason on it.
    //
    // The predicate is source_gift_id, never the donor and never the title.
    // That is what makes "tasks a person wrote by hand are never touched" true
    // by construction rather than by luck: a hand-written task has no
    // source_gift_id, so this UPDATE cannot reach it.
    //
    // Inside the SAME transaction as the gift row's delete: a void that
    // committed without the delete would cancel a thank-you for a gift that
    // still exists.
    // FIX-31: the next step the gift opened (its thank-you) is dismissed with
    // it, so its task is closed and voided below with the gift's others.
    await runTx(client,
      "UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='gift_deleted' WHERE org_id=? AND opening_gift_id=? AND closed_at IS NULL",
      [req.user.orgId, req.params.id]);
    const voided = await runTx(client,
      "UPDATE tasks SET voided_at=NOW(), voided_reason='gift_deleted', updated_at=NOW() WHERE org_id=? AND source_gift_id=? AND voided_at IS NULL",
      [req.user.orgId, req.params.id]);
    voidedTaskCount = Number(voided?.changes ?? voided?.rowCount ?? 0) || 0;
    await runTx(client, "DELETE FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  });
  // Full recalc: old delta left last_gift_date and last_gift_amount stale when deleting the most recent gift
  await recalcDonorSummary(g.donor_id, req.user.orgId);
  // F-5: this gift may have been paying down a pledge — recompute honestly
  // (reopens only if remaining payments no longer cover the pledge amount).
  if (g.pledge_id) await recalcPledgePayment(g.pledge_id, req.user.orgId);
  }); // end withAdvisoryLock(gift:…) — delete + recalc serialized per gift
  // LEDGER-1: the one after-change step, as every gift door runs it (the
  // totals were just written above, so recalc is off).
  if (g.donor_id) await require("../../afterChange").afterChange(req.user.orgId, [g.donor_id], { door: "gift_form", recalc: false })
    .catch(e => console.error("[gift-delete] after-change:", e.message));
  // FIX-10 Part C — the timeline says what happened, in one line, on the
  // donor's own record. A task that vanishes without a trace is how a director
  // comes to believe she already thanked someone she never thanked. Written
  // after the transaction commits, so the note can never describe a void that
  // rolled back.
  if (voidedTaskCount > 0 && g.donor_id) {
    const _a = actor(req);
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,'note',?,?,?,?)",
      [newId("i"), req.user.orgId, g.donor_id,
       `Gift removed, thank-you cancelled. ${voidedTaskCount === 1 ? "One task" : `${voidedTaskCount} tasks`} Steward had created for this gift ${voidedTaskCount === 1 ? "was" : "were"} voided.`,
       orgToday(await orgTz(req.user.orgId)), _a.id, _a.name]
    ).catch(e => console.error("[gift-delete] timeline note:", e.message));
  }
  res.json({ ok: true, voidedTasks: voidedTaskCount });
}));

// ── Pledges ──────────────────────────────────────────────────────────────
// A donor's promise to give $X by a future date — separate from `gifts`
// (money already received) and `planned_gifts` (bequests/trusts, no due
// date). See db.js's pledges comment. The reminder cadence that fires
// against these (processPledgeReminders, below) deliberately mirrors the
// recurring-gift dunning engine's architecture.
app.get("/donors/:id/pledges", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  // F-5: every pledge read carries the honest paid/balance figures, derived
  // live from linked payment gifts — never a stored counter.
  // BUILD-72 Part 3 adds the SURPLUS on an overpaid pledge and the DERIVED
  // display status (open / partially_fulfilled / fulfilled), so no surface has
  // to re-derive either and get it subtly different.
  const rows = await query(
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance,
            GREATEST(COALESCE(pp.paid,0) - p.amount, 0) AS surplus
     FROM pledges p
     LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id=p.id
     WHERE p.donor_id=? AND p.org_id=? ORDER BY p.due_date ASC`,
    [req.user.orgId, req.params.id, req.user.orgId]
  );
  // FIX-55: a pledge over several years says this year's installments and the
  // open total, so the profile never shows one number without saying which
  // FUNDRAISING-2: "this year" is the fiscal year, to the day Home and
  // Fundraising's Pledges count to (numbers.pledgeSummary).
  const fyBounds = orgTime.orgPeriodBounds(await orgForYears(req.user.orgId), "fiscal_year", 0);   // ORG_TZ_SEAM_OK
  // WALKB-2: the year is said by its own name (shared/fiscalPeriod.js), so "due this year" is never read as the calendar year.
  const yearLabel = (await import("../../shared/fiscalPeriod.js")).fyLabelFromStart(Number(String(fyBounds.start).slice(0, 4)), Number(String(fyBounds.start).slice(5, 7)));
  const inst = rows.length ? await query(
    `SELECT pledge_id, COUNT(*)::int AS n, MIN(LEFT(due_date,4)) AS y0, MAX(LEFT(due_date,4)) AS y1
       FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?) GROUP BY pledge_id`, [req.user.orgId, rows.map(r => r.id)]) : [];
  const instBy = new Map(inst.map(x => [x.pledge_id, x]));
  // IMPORT-5: each installment with its state, for the open pledge up top
  const instRows = rows.length ? await query(
    `SELECT pledge_id, seq, due_date, amount, paid_gift_id FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?) ORDER BY pledge_id, seq`,
    [req.user.orgId, rows.map(r => r.id)]) : [];
  const listBy = new Map();
  for (const i of instRows) (listBy.get(i.pledge_id) || listBy.set(i.pledge_id, []).get(i.pledge_id))
    .push({ seq: i.seq, dueDate: i.due_date ? String(i.due_date).slice(0, 10) : null, amount: round2(parseFloat(i.amount) || 0), paid: !!i.paid_gift_id });
  res.json(rows.map(r => {
    const paid = round2(parseFloat(r.paid_amount) || 0);
    const amount = round2(parseFloat(r.amount) || 0);
    const surplus = round2(parseFloat(r.surplus) || 0);
    const balance = round2(parseFloat(r.balance) || 0);
    const ix = instBy.get(r.id);
    const years = ix ? Number(ix.y1) - Number(ix.y0) + 1 : 1;
    // LEDGER-1: the one rule (shared/numbers/pledges.js), Fundraising's own.
    const PL = require("../../shared/numbers/pledges");
    const pl = { amount, paid, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : "", installments: listBy.get(r.id) || [] };
    const dueThisYear = r.status !== "open" ? 0 : PL.dueThisFiscalYear(pl, fyBounds, yearLabel).amount;
    const left = PL.installmentsLeft(pl);
    return {
      ...r,
      paid, balance,
      surplus, overpaid: surplus > 0,
      displayStatus: pledgeDisplayStatus(paid, amount, r.status),
      installmentCount: ix ? ix.n : 1, years, dueThisYear, dueYearLabel: yearLabel, unpaidCount: PL.unpaidCount(pl),
      installments: left.map(i => ({ ...i, paid: i.left <= 0 })),
      // the open-pledge figure opens Fundraising's own rows for this person
      openSource: { key: "pledges-open", params: { donor: r.donor_id } },
    };
  }));
}));

app.post("/donors/:id/pledges", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, dueDate, notes } = req.body;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  // BUILD-88b B.2 — THE GUARD READS THE MONEY SEAM, not `Number()`. A pledge
  // typed as "1,000.00" — which is how a person writes a thousand pounds — was
  // refused as "A positive amount is required", because Number("1,000.00") is
  // NaN and the guard ran BEFORE the seam that knows better. Found by this
  // part's own suite on its first run.
  if (amount === undefined || amount === null || String(amount).trim() === "") {
    return res.status(400).json({ error: "A positive amount is required" });
  }
  { let probe; try { probe = parseMoneyOrThrow(amount, "amount"); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (probe <= 0) return res.status(400).json({ error: "A positive amount is required" }); }
  if (!dueDate) return res.status(400).json({ error: "A due date is required" });

  const donorExists = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  // Attribution FIX — a pledge attributes at pledge time (capital campaigns
  // are mostly pledges). Org-scoped: a foreign campaign id 404s, no row
  // planted. The campaign's "pledged" figure shows this while open; payments
  // against it inherit the campaign and count toward raised as they arrive.
  if (campaignId) {
    const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
  }

  // BUILD-72 Part 2 — idempotency, same seam as gifts. The client mints a key
  // when the pledge form opens and rotates it only on a successful save, so a
  // double-tapped Save (or a browser retry on hotel wifi in front of a
  // prospect) replays the SAME key and gets the SAME pledge back — 200, not a
  // second row and not an error. The DB unique is the fix; a disabled button is
  // cosmetic and does not survive a flaky connection.
  const idemKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 128) : null;

  // BUILD-73 Part 2 — the money seam; was Math.round(Number(amount)) inline in
  // the parameter list, where a bad value became NaN and a cents value became
  // a whole dollar with nothing said about either.
  let pledgeAmt;
  try { pledgeAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  // SWEEP-4 / FIX-60: the pledge and its installments are written by the one
  // writer (pledgeWrite.js). A schedule that does not sum to the pledge is
  // refused BEFORE the pledge is written. An explicit schedule is honoured; a
  // stated cadence (frequency + count) generates one, the remainder on the
  // first installment so it SUMS to the pledge; neither is one installment of
  // the whole on its due date.
  const id = newId("pl");
  let wrote;
  try {
    wrote = await PW.writePledge({ id, orgId: req.user.orgId, donorId: req.params.id, amountCents: parseMoneyOrThrow(pledgeAmt, "amount"),
      dueDate, notes: notes || "", campaignId, idempotencyKey: idemKey, createdBy: actor(req).id, createdByName: actor(req).name,
      plan: { schedule: req.body.installments, frequency: req.body.frequency, count: req.body.installmentCount, firstDue: dueDate } },
      { door: "pledge" });
  } catch (e) {
    if (e.code === "schedule_does_not_sum") return res.status(400).json({ error: e.message, code: e.code });
    throw e;
  }
  if (!wrote.created && idemKey) {
    // A replay. Return the ORIGINAL pledge with 200 — never a second row, and
    // never an error the user has to interpret mid-demo.
    const dup = await query("SELECT * FROM pledges WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idemKey]);
    if (dup.length) return res.status(200).json({ ...dup[0], duplicate: true });
  }

  // WIRE-1: the promise is on the person's timeline the day it is made.
  { const who = await staffWho(req);
    await TL.timelineLine({ orgId: req.user.orgId, donorId: req.params.id,
      note: `Pledged ${TL.lineMoney(pledgeAmt)}${dueDate ? `, due ${String(dueDate).slice(0, 10)}` : ""}.`,
      actorId: who.id, actorName: who.name, key: `pledge_created:${id}`, metadata: { via: "pledge", pledge_id: id } }); }

  const rows = await query("SELECT * FROM pledges WHERE id=?", [id]);
  const insts = await query("SELECT id, seq, due_date, amount::float AS amount FROM pledge_installments WHERE pledge_id=? ORDER BY seq", [id]);
  res.status(201).json({ ...rows[0], installments: insts });
}));

// A pledge's schedule, REWRITTEN: a schedule edit and the shell-pledge repair
// in B.2. A new pledge is written with its schedule by pledgeWrite.js (FIX-60);
// both plan through the same planner, so "what a schedule is" is decided
// once. GIFTS-1: an edit keeps the payments already applied. The new plan is
// laid down and every payment on the pledge is applied to it oldest first
// (pledgeWrite.applyPayments, the rule a new pledge's linked payments use), so
// a $300 payment on a $1,200 pledge re-planned as 4 monthly is the first
// installment, paid, whatever the schedule said before.
async function writePledgeInstallments(orgId, pledgeId, opts) {
  const rows = await PW.planInstallments(opts);
  if (!rows.length) return { installments: 0 };
  const { frequency } = opts;
  const pays = await query(
    `SELECT g.id, ROUND(g.amount::numeric * 100)::bigint AS cents, LEFT(g.date::text, 10) AS date FROM gifts g
      WHERE g.org_id=? AND g.pledge_id=? AND ${require("../../shared/numbers/money").MONEY("g")}`, [orgId, pledgeId]);
  const was = new Map((await query("SELECT paid_gift_id, paid_at FROM pledge_installments WHERE org_id=? AND pledge_id=? AND paid_gift_id IS NOT NULL",
    [orgId, pledgeId])).map(r => [r.paid_gift_id, r.paid_at]));
  const laid = pays.length ? PW.applyPayments(rows, pays.map(p => ({ id: p.id, cents: Number(p.cents), date: p.date })))
    : rows.map(r => ({ ...r, paidGiftId: null }));
  await withTransaction(async (client) => {
    await runTx(client, "DELETE FROM pledge_installments WHERE org_id=? AND pledge_id=?", [orgId, pledgeId]);
    for (const r of laid) {
      await runTx(client, 
        `INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount,paid_gift_id,paid_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [newId("pli"), orgId, pledgeId, r.seq, r.dueDate, money.toDollars(r.amountCents), r.paidGiftId || null,
         r.paidGiftId ? (was.get(r.paidGiftId) || new Date().toISOString()) : null]);
    }
    await runTx(client, "UPDATE pledges SET frequency=COALESCE(?,frequency), installment_count=? WHERE id=? AND org_id=?",
      [frequency || null, laid.length, pledgeId, orgId]);
  });
  return { installments: laid.length };
}
// GET /pledges/:id/installments — the schedule, with what has paid each one.
app.get("/pledges/:id/installments", requireAuth, wrap(async (req, res) => {
  const [p] = await query("SELECT id, amount::float AS amount, status, is_shell FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Pledge not found" });
  const rows = await query(
    `SELECT i.id, i.seq, i.due_date, i.amount::float AS amount, i.paid_gift_id, i.paid_at,
            g.date AS paid_date, g.amount::float AS paid_amount
       FROM pledge_installments i LEFT JOIN gifts g ON g.id = i.paid_gift_id
      WHERE i.pledge_id=? AND i.org_id=? ORDER BY i.seq`, [req.params.id, req.user.orgId]);
  res.json({ pledge: p, installments: rows,
             // A pledge with no schedule is not late — it is unfinished, and it
             // says which part is missing rather than chasing a donor for a
             // number nobody wrote down.
             needsSchedule: rows.length === 0 });
}));

// PUT /pledges/:id/installments — set or regenerate the schedule.
app.put("/pledges/:id/installments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [p] = await query("SELECT id, amount FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Pledge not found" });
  // A schedule EDIT says what the schedule is; the one-installment default is
  // for a pledge being made, not for an edit that said nothing.
  if (!(Array.isArray(req.body.installments) && req.body.installments.length) && !(req.body.frequency && req.body.installmentCount))
    return res.status(400).json({ error: "no_schedule", message: "Give a schedule, or a frequency and a number of installments." });
  try {
    const out = await writePledgeInstallments(req.user.orgId, req.params.id, {
      amountCents: money.toCents(p.amount) ?? 0,
      schedule: req.body.installments, frequency: req.body.frequency,
      count: req.body.installmentCount, firstDue: req.body.firstDue,
    });
    if (!out.installments) return res.status(400).json({ error: "no_schedule", message: "Give a schedule, or a frequency and a number of installments." });
    // A pledge that now has a schedule is no longer a shell.
    await run("UPDATE pledges SET is_shell=false WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  } catch (e) {
    if (e.code === "schedule_does_not_sum") return res.status(400).json({ error: e.code, message: e.message });
    throw e;
  }
  const rows = await query("SELECT id, seq, due_date, amount::float AS amount, paid_gift_id FROM pledge_installments WHERE pledge_id=? ORDER BY seq", [req.params.id]);
  res.json({ installments: rows });
}));

app.put("/pledges/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Pledge not found" });
  const p = existing[0];
  // FIX-14 Part 2b: whoever recorded the pledge, or an admin.
  if (!(await mayEditLogged(req, p))) return res.status(403).json(NOT_YOURS);
  const { amount, dueDate, notes, status } = req.body;
  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  const campaignIdRaw = req.body.campaignId !== undefined ? req.body.campaignId
    : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  let newCampaignId = p.campaign_id;
  if (campaignIdRaw !== undefined) {
    if (campaignIdRaw) {
      const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignIdRaw, req.user.orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      newCampaignId = campaignIdRaw;
    } else {
      newCampaignId = null;
    }
  }

  // BUILD-72 Part 3 — the two drift vectors this route used to carry are closed.
  //
  //  (1) Changing `amount` did NOT recompute the status, so raising a fulfilled
  //      $1,000 pledge to $5,000 left it reading "fulfilled" with $3,300
  //      outstanding.
  //  (2) `status` was directly settable, so a pledge with $0 paid could be
  //      stored as 'fulfilled' — an independent flag drifting from the money.
  //
  // Now: `written_off` is the ONLY status a human sets, because it is the only
  // one that is a decision rather than a fact. open/fulfilled are FACTS about
  // the payment total and are always derived by recalcPledgePayment() below.
  const HUMAN_SETTABLE = ["written_off", "open"];   // 'open' = un-write-off
  let newStatus = p.status;
  if (status && HUMAN_SETTABLE.includes(status)) newStatus = status;
  else if (status === "fulfilled") {
    // Refused deliberately: a pledge becomes fulfilled by being PAID. Marking
    // it fulfilled by hand is what let the flag drift from the money.
    return res.status(400).json({
      error: "status_derived",
      message: "A pledge is fulfilled by its payments, not by hand. Record the payment against it, or write it off.",
    });
  }
  const stopping = newStatus !== "open" && p.status === "open";

  // BUILD-73 Part 2 — the money seam; was Math.round(Number(amount)).
  let pledgeNewAmt = p.amount;
  if (amount !== undefined) {
    try { pledgeNewAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }

  await run(
    `UPDATE pledges SET amount=?, due_date=?, notes=?, status=?, campaign_id=?,
       next_reminder_at = CASE WHEN ? THEN NULL ELSE next_reminder_at END,
       updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [
      pledgeNewAmt,
      dueDate || p.due_date,
      notes !== undefined ? notes : p.notes,
      newStatus,
      newCampaignId,
      stopping,
      req.params.id, req.user.orgId,
    ]
  );
  // FIX-14 Part 2b — "Edited by, when", only when something a person typed moved.
  if (!auditTrailMod.sameValue(p.amount, pledgeNewAmt) || !auditTrailMod.sameValue(p.due_date, dueDate || p.due_date)
      || (notes !== undefined && !auditTrailMod.sameValue(p.notes, notes)) || newStatus !== p.status || newCampaignId !== p.campaign_id) {
    await run("UPDATE pledges SET edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?",
      [...(await editStamp(req)), req.params.id, req.user.orgId]);
  }
  // ALWAYS recompute against the payment total — this is what closes drift (1).
  // A changed amount, or a write-off being lifted, re-derives open/fulfilled and
  // the surplus from the gifts actually linked to this pledge.
  const recomputed = await recalcPledgePayment(req.params.id, req.user.orgId);
  const rows = await query("SELECT * FROM pledges WHERE id=?", [req.params.id]);
  res.json({ ...rows[0], ...(recomputed || {}) });
}));

// FIX-14 Part 2b — a pledge with money applied to it is not deleted: the
// payments would point at nothing and the balance would lie. Write it off
// instead. One with no payments is moved to the trash, so Undo can bring it
// back with its instalments, exactly as it was.
app.delete("/pledges/:id", requireAuth, wrap(async (req, res) => {
  const [p] = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  if (!(await mayEditLogged(req, p))) return res.status(403).json(NOT_YOURS);
  const [paid] = await query(
    `SELECT (SELECT COUNT(*)::int FROM gifts WHERE pledge_id=? AND org_id=?)
          + (SELECT COUNT(*)::int FROM pledge_installments WHERE pledge_id=? AND org_id=? AND paid_gift_id IS NOT NULL) AS n`,
    [req.params.id, req.user.orgId, req.params.id, req.user.orgId]);
  if (paid && paid.n > 0) {
    return res.status(409).json({ error: "pledge_has_payments",
      sentence: "This pledge has payments applied to it, so it cannot be deleted. Write it off instead." });
  }
  const undoId = await trashRow("pledges", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// Re-sends the exact already-issued PDF (never regenerates) — used by
// POST /gifts/:id/receipt?resend and POST /donors/:id/receipts (manual
// resend from DonorProfile), so a resend is always byte-identical to what
// was originally issued.
// SEND-GATE-1: a resend is a person's click, the confirm for this one receipt.
async function resendReceiptEmail(receipt, org, donor, by) {
  if (!donor.email) return false;
  const decision = await donorMailDecision("receipt", donor.email, org.id, { donorId: donor.id });
  if (!decision.send) return false;
  const pdfBuffer = Buffer.from(receipt.pdf_data, "base64");
  const filename = receipt.type === "year_end" ? `${receipt.tax_year}-giving-statement.pdf` : `receipt-${receipt.receipt_number}.pdf`;
  const extra = by ? { _stewardConfirm: await SEND_GATE.recordStaffConfirm({ orgId: org.id, to: donor.email, what: "Receipt", by }) } : {};
  const sent = await sendReceiptEmail(org, donor, receipt.snapshot, pdfBuffer, filename, extra);
  if (sent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, receipt.id]);
  return sent;
}

// Aggregates a donor's calendar-year gifts into one consolidated statement.
// Supersedes (voids) any prior active statement for the same donor+year
// before inserting the new one, since the partial-unique index only allows
// one active statement per (org_id, donor_id, tax_year).
async function issueYearEndStatement(org, donor, year, { send = true, by = SYS_AUTO } = {}) {
  const gifts = await query(
    `SELECT * FROM gifts WHERE org_id=? AND donor_id=? AND (is_sample IS NOT TRUE)
       AND date >= ? AND date <= ? ORDER BY date ASC`,
    [org.id, donor.id, `${year}-01-01`, `${year}-12-31`]
  );
  if (!gifts.length) return { skipped: "no_gifts" };

  await run(
    `UPDATE receipts SET voided_at=NOW(), void_reason='Superseded by a newly generated statement'
     WHERE org_id=? AND donor_id=? AND tax_year=? AND type='year_end' AND voided_at IS NULL`,
    [org.id, donor.id, year]
  );

  // COMMS-2 — the money is statementTotals.js's, in cents: deductible never
  // above what was given (a partial refund), a lost dispute off the statement.
  const ST = require("../../statementTotals").statementLines(gifts, { year: true });
  const lineItems = ST.lines.map(l => ({
    date: l.date ? orgTime.formatCivil(l.date) : "", // civil date formatted from its own Y/M/D — never round-tripped through new Date()
    amount: toDollars(l.amountCents),
    deductibleAmount: toDollars(l.deductibleCents),
    paymentMethod: l.paymentMethod,
  }));
  const totalAmount = ST.totalAmount;
  const totalDeductible = ST.totalDeductible;
  // COMMS-2 §3 — "your year with us": hours given and events attended that
  // year, unless the org turned the section off. Facts, not money: nothing in
  // it touches a total.
  let yourYear = null;
  if (org.statement_your_year !== false) {
    const [h] = await query(`SELECT COALESCE(SUM(ROUND(hours * 100)), 0)::int AS hh, COUNT(*)::int AS n FROM volunteer_shifts
                               WHERE org_id=? AND person_id=? AND LEFT(date, 4) = ?`, [org.id, donor.id, String(year)]);
    const evs = await query(`SELECT e.name, e.date::text AS date FROM event_attendees a JOIN events e ON e.id = a.event_id
                               WHERE a.org_id=? AND a.donor_id=? AND (a.status='attended' OR a.checked_in_at IS NOT NULL)
                                 AND EXTRACT(YEAR FROM e.date) = ? ORDER BY e.date`, [org.id, donor.id, year]);
    const hours = (h && h.hh) ? h.hh / 100 : 0;
    if (hours > 0 || evs.length) yourYear = { volunteerHours: hours, shifts: h ? h.n : 0, events: evs.map(e => e.name) };
  }

  const receiptNumber = await allocateReceiptNumber(org.id);
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null); // BUILD-64: shared resolver, frozen at issue
  const snapshot = {
    type: "year_end",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,      // BUILD-64: portal primary, never Steward green
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),      // BUILD-65: from object storage, not base64-only
    orgEin: (await import("../../shared/placeholderCopy.js")).publicEin(org.ein),   // WALKB-1: never a placeholder EIN
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    taxLanguage: org.tax_language || null,   // COMMS-2: the brand kit's tax language
    receiptNumber,
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))), // ORG_TZ_SEAM_OK
    donorName: donor.name,
    taxYear: year,
    lineItems, totalAmount, totalDeductible,
    yourYear,
  };
  // BUILD-65 Part 5: the "create your free giving account" CTA has LEFT the PDF.
  // A year-end statement may be handed to an accountant or attached to a filing;
  // a marketing link inside it is the one place it stops looking like a receipt.
  // The account CTA stays in the receipt/statement EMAIL (sendReceiptEmail,
  // in the org's palette, where it reads as a service the org offers) — this
  // only removes it from the document. (BUILD-49 had stamped it into the frozen
  // snapshot; we no longer set snapshot.givingAccountUrl at all.)
  if (TF.isDemoOrg(org)) snapshot.demo = true;   // WHY-1 Part 8: a demo statement says so on every page
  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = newId("rcpt");
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, snapshot, pdf_data, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, null, "year_end", year, receiptNumber, totalAmount, totalDeductible, JSON.stringify(snapshot), pdfBuffer.toString("base64"), by.id, by.name]
  );

  let emailSent = false;
  if (send && donor.email) {
    // W-4: year-end statements are TRANSACTIONAL (tax paperwork, not outreach).
    const decision = await donorMailDecision("year_end", donor.email, org.id, { donorId: donor.id });
    if (decision.send) {
      emailSent = await sendReceiptEmail(org, donor, snapshot, pdfBuffer, `${year}-giving-statement.pdf`);
      if (emailSent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, id]);
    }
  }
  const rows = await query("SELECT * FROM receipts WHERE id=?", [id]);
  return { receipt: rows[0], created: true, emailSent, giftCount: gifts.length, totalAmount, totalDeductible };
}

// Literal routes declared before /receipts/:id/... siblings (matches the
// existing POST /sequences/process convention) — not currently a real
// collision risk since these have different segment counts, but kept
// consistent with the codebase's own established defensive ordering.
app.get("/receipts/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  // Nothing stored, nothing sent — placeholder text fills in any settings
  // fields not yet configured, so this stays useful as a "here's what's
  // missing" preview even before receipts_enabled can be flipped on.
  const fakeDonor = { name: "Jordan Sample", email: null };
  const fakeGiftDate = orgToday(await orgTz(org.id)); // ORG_TZ_SEAM_OK
  // BUILD-65 Part 2 sweep: the preview also assumed base64 (org.brand_accent /
  // org.logo_data) — a modern org's Settings preview showed Steward-green + no
  // logo. Read the SAME resolver + object-storage logo the issued receipt does.
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null);
  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),
    orgEin: (await import("../../shared/placeholderCopy.js")).publicEin(org.ein) || "XX-XXXXXXX",
    orgAddress: org.receipt_address || "123 Main St, Anytown, ST 00000",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, fakeDonor),
    taxLanguage: org.tax_language || null,
    receiptNumber: `${orgToday(await orgTz(org.id)).slice(0, 4)}-PREVIEW`, // ORG_TZ_SEAM_OK — the preview shows the number an issue would mint
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))),
    donorName: fakeDonor.name,
    giftDate: orgTime.formatCivil(fakeGiftDate),
    amount: 250,
    deductibleAmount: 250,
    paymentMethod: "Credit Card",
    quidProQuoDesc: null,
    quidProQuoValue: null,
  };
  const pdfBuffer = await renderReceiptPdf(snapshot);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-preview.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));

// Bulk — every donor with ≥1 real gift in {year}. No cron; the org triggers
// this deliberately each January (see CLAUDE.md "Tax receipting").
app.post("/receipts/year-end-run", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { year, dryRun } = req.body;
  const taxYear = parseInt(year, 10);
  if (!taxYear) return res.status(400).json({ error: "year required" });
  const orgId = req.user.orgId;
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet." });

  const donorRows = await query(
    `SELECT DISTINCT d.id, d.name, d.email FROM donors d
     JOIN gifts g ON g.donor_id = d.id
     WHERE d.org_id=? AND g.org_id=? AND (g.is_sample IS NOT TRUE) AND g.date >= ? AND g.date <= ? AND d.deleted_at IS NULL`,
    [orgId, orgId, `${taxYear}-01-01`, `${taxYear}-12-31`]
  );

  if (dryRun) {
    const missingEmailCount = donorRows.filter(d => !d.email).length;
    const giftCountRows = await query(
      `SELECT COUNT(*) AS count FROM gifts WHERE org_id=? AND (is_sample IS NOT TRUE) AND date >= ? AND date <= ?`,
      [orgId, `${taxYear}-01-01`, `${taxYear}-12-31`]
    );
    return res.json({ dryRun: true, donorCount: donorRows.length, giftCount: parseInt(giftCountRows[0]?.count, 10) || 0, missingEmailCount });
  }

  // Real run: sequential with a small delay between sends so a large donor
  // list doesn't blast Resend's API all at once.
  let generated = 0, emailed = 0, skipped = 0;
  for (const donorRow of donorRows) {
    try {
      const result = await issueYearEndStatement(org, donorRow, taxYear, { send: true, by: actor(req) });
      if (result.skipped) { skipped++; continue; }
      generated++;
      if (result.emailSent) emailed++;
    } catch (e) {
      console.error(`[receipts] year-end-run failed for donor ${donorRow.id}:`, e.message);
      skipped++;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  res.json({ dryRun: false, donorCount: donorRows.length, generated, emailed, skipped });
}));

app.get("/receipts/:id/pdf", requireAuth, wrap(async (req, res) => {
  const [receipt] = await query("SELECT id, receipt_number, type, tax_year, pdf_data FROM receipts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!receipt || !receipt.pdf_data) return res.status(404).json({ error: "Receipt not found" });
  const buf = Buffer.from(receipt.pdf_data, "base64");
  const filename = receipt.type === "year_end" ? `${receipt.tax_year}-giving-statement.pdf` : `receipt-${receipt.receipt_number}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}));

// Void, never delete — receipts are legal artifacts. Matches the DELETE-
// routes-stay-ungated convention everywhere else in this app; voiding is
// this record type's equivalent removal action, so it's requireAdmin (like
// other irreversible-ish admin actions) rather than checkWriteAccess.
app.post("/receipts/:id/void", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { reason } = req.body;
  const existing = await query("SELECT id FROM receipts WHERE id=? AND org_id=? AND voided_at IS NULL", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Active receipt not found" });
  // TRUTH-2: a void always keeps its note (hers, or who voided it and when).
  // The number stays on the voided row; the org's counter only goes up, so it
  // is never issued again.
  const note = String(reason || "").trim().slice(0, 500) || `Voided by ${actor(req).name} on ${orgToday(await orgTz(req.user.orgId))}.`;   // ORG_TZ_SEAM_OK
  await run("UPDATE receipts SET voided_at=NOW(), void_reason=? WHERE id=? AND org_id=?", [note, req.params.id, req.user.orgId]);
  const rows = await query(
    "SELECT id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, sent_to, sent_at, voided_at, void_reason, created_at FROM receipts WHERE id=?",
    [req.params.id]
  );
  res.json(rows[0]);
}));

// Manual per-gift issue/resend — the one-click path for offline gifts
// (which never auto-receipt) and the "Send receipt" button in DonorProfile.
app.post("/gifts/:id/receipt", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [gift] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!gift) return res.status(404).json({ error: "Gift not found" });
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet, set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [gift.donor_id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const existingRows = await query("SELECT * FROM receipts WHERE gift_id=? AND voided_at IS NULL AND type='gift'", [gift.id]);
  if (existingRows.length) {
    if (req.query.resend !== undefined) {
      const emailSent = await resendReceiptEmail(existingRows[0], org, donor, actor(req));
      const rows = await query("SELECT * FROM receipts WHERE id=?", [existingRows[0].id]);
      return res.json({ receipt: rows[0], emailSent, resent: true });
    }
    return res.status(409).json({ error: "This gift already has an active receipt.", receipt: existingRows[0] });
  }

  // FLOWS-1: the profile makes the receipt (send:false) and emails it only on its own click (/receipts/:id/email)
  const result = await issueGiftReceipt(gift, org, donor, { send: !(req.body && req.body.send === false), by: actor(req), manual: true });
  if (result.skipped === "undated_gift") return res.status(409).json({ error: "undated_gift",
    message: "This gift has no date, and a tax receipt names the day a gift was given. Set the date on the gift, then send the receipt." });
  if (result.skipped) return res.status(400).json({ error: `Could not issue receipt: ${result.skipped}` });
  res.status(201).json(result.receipt);
}));

// List for DonorProfile's Gifts & Pledges tab — no pdf_data in the list
// response (board_reports pattern), fetched separately via
// GET /receipts/:id/pdf only when actually downloading one.
RCE.register(app, { query, requireAuth, checkWriteAccess, wrap, actor, resendReceiptEmail });   // FLOWS-1 item 4: "Email it", one click
app.get("/donors/:id/receipts", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const rows = await query(
    `SELECT id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, sent_to, sent_at, voided_at, void_reason, created_at
     FROM receipts WHERE donor_id=? AND org_id=? ORDER BY created_at DESC`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

app.post("/donors/:id/year-end-statement", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { year, send } = req.body;
  const taxYear = parseInt(year, 10);
  if (!taxYear) return res.status(400).json({ error: "year required" });
  const orgId = req.user.orgId;
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet, set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const result = await issueYearEndStatement(org, donor, taxYear, { send: send !== false, by: actor(req) });
  if (result.skipped) return res.status(400).json({ error: `No gifts found for ${taxYear}.` });
  res.status(201).json(result.receipt);
}));

// Per-donor soft-credit breakdown: hard = own gifts, soft = other household
// members' gifts, combined = the household total. Derived, no stored counter.
app.get("/donors/:id/soft-credit", requireAuth, wrap(async (req, res) => {
  const d = await query("SELECT id, household_id, total_giving FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  const hardCredit = parseFloat(d[0].total_giving) || 0;
  const householdId = d[0].household_id || null;
  let householdCombined = hardCredit, softCredit = 0;
  if (householdId) {
    const agg = await query(
      "SELECT COALESCE(SUM(total_giving),0) AS combined FROM donors WHERE household_id=? AND org_id=? AND deleted_at IS NULL",
      [householdId, req.user.orgId]);
    householdCombined = parseFloat(agg[0].combined) || 0;
    softCredit = (Math.round(householdCombined * 100) - Math.round(hardCredit * 100)) / 100;
  }
  // REPORTS-4: the household panel's three figures open their members.
  const householdSources = householdId ? {
    hardCredit: { key: "household-giving", params: { household: householdId, only: req.params.id } },
    softCredit: { key: "household-giving", params: { household: householdId, except: req.params.id } },
    householdCombined: { key: "household-giving", params: { household: householdId } },
  } : null;
  // BUILD-98 Part 1 — the soft credits on OTHER people's gifts, which is a
  // different thing from the household view above: a DAF recommender, the
  // spouse on a joint cheque, the board member who asked. Hard stays hard;
  // "with soft credit" is its own figure, beside it and labelled.
  // FIX-7 Part 1 — the PAGE a peer-to-peer soft credit came through, so the
  // record can say "raised $1,900 for Harbor Run" in the one sentence a
  // fundraiser would use. A soft credit is never this person's giving: it
  // does not move their lifetime total, their last gift, their drift, their
  // LYBUNT or their retention, and every one of those reads `gifts` alone.
  const scRows = await query(
    `SELECT sc.id, sc.amount, sc.pct, sc.role, g.id AS gift_id, g.date, g.amount AS gift_amount,
            dg.id AS giver_id, dg.name AS giver_name,
            gp.id AS page_id, gp.title AS page_title
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors dg ON dg.id = g.donor_id AND dg.org_id = g.org_id
       LEFT JOIN giving_pages gp ON gp.id = g.giving_page_id AND gp.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? ORDER BY g.date DESC NULLS LAST LIMIT 200`, [req.user.orgId, req.params.id]);
  // NUMBERS-2: the totals are added up over EVERY soft credit, not the 200
  // newest the list shows (a busy peer-to-peer fundraiser has more).
  const scAgg = await query(
    `SELECT sc.role, gp.id AS page_id, gp.title AS page_title, MAX(g.date) AS newest,
            COALESCE(SUM(ROUND(sc.amount * 100)), 0)::bigint AS cents, COUNT(*)::int AS n
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors dg ON dg.id = g.donor_id AND dg.org_id = g.org_id
       LEFT JOIN giving_pages gp ON gp.id = g.giving_page_id AND gp.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? GROUP BY sc.role, gp.id, gp.title`, [req.user.orgId, req.params.id]);
  // FIX-51: the census lines read donorCreditTotals, the header's own two
  // figures: their own giving is Lifetime (no credit rows), and soft credit
  // is the one Soft credit figure (others' gifts and their own credit rows).
  const credit = await donorCreditTotals(req.user.orgId, req.params.id);
  const giftSoftCents = credit.softCents;
  // One line per page they raised for, newest gift first, in cents.
  const raisedFor = scAgg.filter(r => r.role === "peer_fundraiser" && r.page_id)
    .sort((a, b) => (String(b.newest) > String(a.newest) ? 1 : -1))
    .map(r => ({ pageId: r.page_id, pageTitle: r.page_title, amountCents: Number(r.cents), giftCount: r.n }));
  res.json({ donorId: d[0].id, householdId, hardCredit, softCredit, householdCombined, householdSources,
    giftSoftCredit: giftSoftCents / 100,
    ownGiving: credit.hardCents / 100,
    hardPlusGiftSoft: credit.hardPlusSoftCents / 100,
    raisedFor,
    raisedForSentence: "Money other people gave through their fundraiser page. It is recognition, not their own giving, and it changes nothing about their record.",
    giftSoftCredits: scRows.map(r => ({ id: r.id, amount: Number(r.amount), pct: r.pct == null ? null : Number(r.pct), role: r.role,
      giftId: r.gift_id, date: r.date, giftAmount: Number(r.gift_amount), giverId: r.giver_id, giverName: r.giver_name,
      pageId: r.page_id || null, pageTitle: r.page_title || null })) });
}));
// ── BUILD-98 Part 1 — a gift's soft credits, tribute and match ─────────────
app.get("/gifts/:id/extras", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, donor_id, amount, tribute_type, tribute_donor_id, tribute_name, match_employer_id, match_pledge_id FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Gift not found" });
  const [soft, notice, match] = await Promise.all([
    query(`SELECT sc.donor_id, sc.amount, sc.pct, sc.role, d.name FROM gift_soft_credits sc
             JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id
            WHERE sc.gift_id=? AND sc.org_id=? ORDER BY d.name`, [g.id, orgId]),
    query("SELECT id, status, notify_name, notify_email, notify_address, body FROM tribute_notices WHERE gift_id=? AND org_id=?", [g.id, orgId]),
    g.match_pledge_id ? query(
      `SELECT p.id, p.amount, p.status, p.due_date, d.name AS employer_name, COALESCE(pp.paid,0) AS paid
         FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
         LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
        WHERE p.id=? AND p.org_id=?`, [orgId, g.match_pledge_id, orgId]) : [],
  ]);
  res.json({
    softCredits: soft.map(r => ({ donorId: r.donor_id, name: r.name, amount: Number(r.amount), pct: r.pct == null ? null : Number(r.pct), role: r.role })),
    tribute: g.tribute_type ? { type: g.tribute_type, donorId: g.tribute_donor_id, name: g.tribute_name } : null,
    tributeNotice: notice[0] || null,
    match: match[0] ? { pledgeId: match[0].id, employerId: g.match_employer_id, employerName: match[0].employer_name,
      expected: Number(match[0].amount), received: Number(match[0].paid), status: match[0].status, dueDate: match[0].due_date } : null,
  });
}));

// Add or change them after the gift exists. Soft credits are REPLACED as a set;
// a tribute is set; a match is added once (a second one is refused by the
// database, not by an if-statement).
app.put("/gifts/:id/extras", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Gift not found" });
  const ck = await checkGiftExtras(orgId, g.donor_id, Math.round(Number(g.amount) * 100),
    { softCredits: req.body?.softCredits, tribute: req.body?.tribute, match: req.body?.match });
  if (ck.notFound) return res.status(404).json({ error: "Donor not found" });
  if (ck.errors) return res.status(400).json({ error: ck.errors.join("; ") });
  const extras = { ...ck.extras };
  if (!Array.isArray(req.body?.softCredits)) delete extras.softCredits;   // absent means "leave them"
  const result = await writeGiftExtras(orgId, g, extras, { actorId: actor(req).id, actorName: actor(req).name });
  res.json({ ok: true, ...result });
}));

// ── Constituent designations (BUILD-14) ────────────────────────────────────
// First-class, filterable, reportable gift-vehicle / planned-giving flags.
// Filter the donor list via GET /donors?designation=<kind>.
const DESIGNATION_KINDS = {
  estate: "Estate giving",
  planned_confirmed: "Planned gift confirmed",
  planned_prospect: "Planned-giving prospect",
};

app.get("/donors/:id/designations", requireAuth, wrap(async (req, res) => {
  const d = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  const rows = await query("SELECT kind, created_at FROM donor_designations WHERE donor_id=? AND org_id=? ORDER BY created_at", [req.params.id, req.user.orgId]);
  res.json(rows.map(r => ({ kind: r.kind, label: DESIGNATION_KINDS[r.kind] || r.kind, created_at: r.created_at })));
}));

app.post("/donors/:id/designations", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { kind } = req.body;
  if (!DESIGNATION_KINDS[kind]) return res.status(400).json({ error: "Unknown designation. Must be one of: " + Object.keys(DESIGNATION_KINDS).join(", ") });
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  await run(
    "INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES (?,?,?,?) ON CONFLICT (donor_id, kind) DO NOTHING",
    [newId("dsg"), req.user.orgId, req.params.id, kind]);
  res.status(201).json({ ok: true, kind, label: DESIGNATION_KINDS[kind] });
}));

app.delete("/donors/:id/designations/:kind", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  await run("DELETE FROM donor_designations WHERE donor_id=? AND org_id=? AND kind=?", [req.params.id, req.user.orgId, req.params.kind]);
  res.json({ ok: true });
}));

// Per-donor health record for the DonorProfile status chip (Active/Payment
// failed/Recovering/Recovered/Canceled) — null if this donor never had a
// recurring gift that's failed a payment (donors.stripe_subscription_status
// alone can't distinguish "recovering" from "past_due").
app.get("/donors/:id/recurring-subscription", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const rows = await query(
    `SELECT id, stripe_subscription_id, amount, interval, status, failure_count, first_failed_at, last_failed_at, recovered_at, canceled_at
     FROM recurring_subscriptions WHERE donor_id=? AND org_id=? ORDER BY created_at DESC LIMIT 1`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows[0] || null);
}));

app.post("/pledges/process-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await processPledgeReminders({ orgId: req.user.orgId });   // TRUST-1: this org only
  // FIX-45: how many of THIS org's pledges the sweep picked (never another org's ids).
  res.json({ success: true, picked: ((out && out.picked) || []).filter(r => r.orgId === req.user.orgId).length });
}));

// Everyday staff action, matching POST /recurring/:donorId/resend — resends
// the current step's reminder on demand without touching reminder_step/
// next_reminder_at, so a manual nudge never interferes with the automatic
// cadence.
app.post("/pledges/:id/resend", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT p.*, d.name AS donor_name, d.email AS donor_email
     FROM pledges p JOIN donors d ON d.id = p.donor_id
     WHERE p.id=? AND p.org_id=? AND p.status='open'`,
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "This pledge is not open." });
  const p = rows[0];
  if (!p.donor_email) return res.status(400).json({ error: "This donor has no email on file." });

  const decision = await donorMailDecision("pledge_reminder", p.donor_email, req.user.orgId, { donorId: p.donor_id });
  if (!decision.send) return res.status(400).json({ error: `Cannot send, ${decision.reason === "deceased" ? "this donor is marked deceased" : decision.reason === "do_not_contact" ? "this donor is marked do-not-contact" : `this donor's email is suppressed (${decision.reason})`}.` });

  const orgRows = await query(
    "SELECT id, name, org_slug, pledge_reminder_subject, pledge_reminder_body FROM orgs WHERE id=?", [req.user.orgId]
  );
  // FIX-15 Part 3: the provider's answer, not an assumed "Sent".
  // SEND-GATE-1: she pressed Send now; that press is the confirm for this one reminder.
  const confirm = await SEND_GATE.recordStaffConfirm({ orgId: req.user.orgId, to: p.donor_email, what: "Pledge reminder", by: actor(req) });
  const { sent } = await sendPledgeReminderEmail(orgRows[0], { name: p.donor_name, email: p.donor_email }, p, { _stewardConfirm: confirm });
  if (!sent) return res.status(502).json({ sent: false, error: "The email provider did not accept the reminder, so it was not sent. Try again in a few minutes." });
  res.json({ sent: true });
}));

// One cheque image, attached to a gift that already exists.
app.post("/gifts/:id/cheque", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [g] = await query(`SELECT id, cheque_asset_id FROM gifts WHERE id = ? AND org_id = ?`,
    [req.params.id, req.user.orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const r = await storeChequeImage({ orgId: req.user.orgId, dataUri: req.body && req.body.image });
  if (r.error) return res.status(400).json({ error: "invalid_photo", message: r.error });
  await run(`UPDATE gifts SET cheque_asset_id = ? WHERE id = ? AND org_id = ?`, [r.assetId, g.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "gift.cheque", g.id, g.cheque_asset_id || null, r.assetId, req.user);
  res.json({ ok: true, chequeUrl: donorPhotoUrl(req.user.orgId, r.assetId) });
}));

// FIX-1 — what a gift a PERSON recorded sets off after recordGift, for the
// other doors that record one (Agent → confirm). Filled once, here, when the
// functions exist; the gift form above calls them directly.
giftHooks.autoUnlapseOnGift = autoUnlapseOnGift;
}

module.exports = { routers, mount };
