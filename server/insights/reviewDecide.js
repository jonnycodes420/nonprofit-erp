// server/insights/reviewDecide.js · ASKS-2 item 3. ONE ROW'S DECISION, FOR ONE ROW OR A GROUP.
//
// "Rows that may not be gifts" listed 167 rows for a customer, about 150 of
// them program fees ("Posted: <name> Service Income - 2022 Fall Session"),
// each needing its own click. A group of them now takes the same three
// decisions with one click and one Undo (server/insights/reviewGroup.js), and
// it must do to each row exactly what the row's own button does. So the
// decisions live here, moved whole from routes/insights.js, and both read them:
//
//   decide(orgId, a, g, b)  Keep as gift / Not a gift / Partly a gift for gift
//                           row `g` (b.decision, b.as, b.value, b.batchId).
//   undo(orgId, r)          put back the row insight_reviews row `r` recorded.
//
// Each returns { status, body, donorId, audit } and does NOT run the donor's
// recalc and after-change step (the caller does, once per person) or write the
// response. Nothing here sends.
//
// REVIEW. Keep as gift: recorded, the row leaves the card. Not a gift
// (Jonathan, 27 Oct; the INT-POS rule: a sale is never a gift row): the money
// stays in Finance as revenue, typed as what it was (a purchase, tickets or a
// reimbursement), on a ledger line with the person, the date, the amount and
// the memo, in Special Events Revenue (4050) or Other Revenue (4060). The gift
// row leaves `gifts`, so it is out of every giving total by construction, and
// is kept whole in insight_reviews.row_data; Undo puts it back exactly, ledger
// line and all. A row with anything attached (a receipt, a payment, a pledge,
// an open thank-you) is changed from the gift itself.
"use strict";
const I = require("../../insights");
const M = require("../../money");
const { query, run, withTransaction, withAdvisoryLock, queryTx, runTx } = require("../../db");
const { SOFT_CREDIT_RESIZE } = require("../../donorSummary");
const { newId } = require("../shared/newId");

const AS_TYPE = { tickets: "ticket", ticket: "ticket", raffle: "ticket", auction: "purchase", purchase: "purchase", reimbursement: "reimbursement", refund: "reimbursement" };
const TYPE_WORD = { purchase: "a purchase", ticket: "tickets", reimbursement: "a reimbursement" };
const TYPE_LABEL = { purchase: "Purchase", ticket: "Tickets", reimbursement: "Reimbursement" };
const ACCOUNT_FOR = { purchase: "4050", ticket: "4050", reimbursement: "4060" };
const out = (status, body, donorId = null, audit = null) => ({ status, body, donorId, audit });

async function decide(orgId, a, g, b = {}) {
  const giftId = g.id, batchId = b.batchId || null;
  if (b.decision === "keep") {
    await run(`INSERT INTO insight_reviews (org_id, gift_id, decision, donor_id, batch_id, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT (org_id, gift_id) DO UPDATE SET decision=EXCLUDED.decision, batch_id=EXCLUDED.batch_id, created_by=EXCLUDED.created_by, created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
      [orgId, giftId, "keep", g.donor_id, batchId, a.id, a.name]);
    return out(200, { ok: true, decision: "keep" });
  }
  if (b.decision === "partly") return partlyAGift(orgId, a, g, b);
  const memo = [g.memo, g.notes].filter(Boolean).join(" · ");
  const type = AS_TYPE[String(b.as || "").toLowerCase()] || AS_TYPE[(I.notAGift(memo) || {}).kind] || "purchase";
  const [att] = await query(`SELECT
      (SELECT COUNT(*) FROM receipts WHERE gift_id=? AND org_id=? AND voided_at IS NULL)::int AS receipts,
      (SELECT COUNT(*) FROM threads WHERE opening_gift_id=? AND org_id=? AND closed_at IS NULL)::int AS threads,
      (SELECT COUNT(*) FROM tasks WHERE source_gift_id=? AND org_id=? AND voided_at IS NULL)::int AS tasks,
      (SELECT COUNT(*) FROM pledges WHERE fulfilled_gift_id=? AND org_id=?)::int AS pledges,
      (SELECT COUNT(*) FROM pledge_installments WHERE paid_gift_id=? AND org_id=?)::int AS installments`,
    [giftId, orgId, giftId, orgId, giftId, orgId, giftId, orgId, giftId, orgId]);
  if (g.stripe_payment_id || g.recurring_subscription_id || g.pledge_id || att.receipts || att.threads || att.tasks || att.pledges || att.installments) {
    return out(409, { error: "attached", sentence: "This gift has a receipt, a payment, a pledge or a thank-you attached, so it is changed from the gift itself. Open it from the person's profile." });
  }
  const [acct] = await query("SELECT id FROM accounts WHERE org_id=? AND code=? LIMIT 1", [orgId, ACCOUNT_FOR[type]]);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
  const description = `${TYPE_LABEL[type]}, not a gift${memo ? `: ${memo}` : ""}`.slice(0, 500);
  let finId = null;
  try {
    await withTransaction(async client => {
      const [stamp] = await queryTx(client, "SELECT * FROM fin_transactions WHERE gift_id=? AND org_id=? FOR UPDATE", [giftId, orgId]);
      if (stamp) {
        finId = stamp.id;
        await runTx(client, `UPDATE fin_transactions SET gift_id=NULL, account_id=COALESCE(?, account_id), description=?, donor_id=?, source='not_a_gift' WHERE id=?`,
          [acct ? acct.id : null, description, g.donor_id, stamp.id]);
      } else {
        finId = newId("ft");
        await runTx(client, `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,created_by,created_by_name)
                             VALUES (?,?,?,?,?,?,'income',?,?,?,'not_a_gift',?,?)`,
          [finId, orgId, g.date || null, description, d ? d.name : null, g.amount, acct ? acct.id : null, g.fund_id || null, g.donor_id, a.id, a.name]);
      }
      await runTx(client, `INSERT INTO insight_reviews (org_id, gift_id, decision, as_type, row_data, fin_id, fin_prev, donor_id, batch_id, created_by, created_by_name)
                           SELECT ?, ?, 'not_gift', ?, to_jsonb(t), ?, ?::jsonb, ?, ?, ?, ? FROM gifts t WHERE t.id=? AND t.org_id=?
                           ON CONFLICT (org_id, gift_id) DO UPDATE SET decision=EXCLUDED.decision, as_type=EXCLUDED.as_type, row_data=EXCLUDED.row_data,
                             fin_id=EXCLUDED.fin_id, fin_prev=EXCLUDED.fin_prev, donor_id=EXCLUDED.donor_id, batch_id=EXCLUDED.batch_id, created_by=EXCLUDED.created_by,
                             created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
        [orgId, giftId, type, finId, stamp ? JSON.stringify(stamp) : null, g.donor_id, batchId, a.id, a.name, giftId, orgId]);
      await runTx(client, "DELETE FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
    });
  } catch (e) {
    if (e.code === "23503") return out(409, { error: "attached", sentence: "Something else in Steward points at this gift, so it is changed from the gift itself. Open it from the person's profile." });
    throw e;
  }
  return out(200, { ok: true, decision: "not_gift", as: type, finId, undo: `/insights/review/${giftId}/undo`, undoSeconds: 60,
    sentence: `Marked as ${TYPE_WORD[type]}: ${I.money(Math.round(Number(g.amount) * 100))} is no longer anyone's giving, and stays in Finance as revenue.` },
    g.donor_id, { before: g, after: { finance_line: finId, as: type } });
}

// PARTLY A GIFT (HOME-3, Justin's Place, 27 Oct). A logo sponsorship with two
// tickets, a table for ten, an auction item bought above its value: mostly a
// gift. She enters the value received; only that part leaves giving. The gift
// row stays, at the rest, edited the way PUT /gifts/:id edits an amount (the
// row, its soft credits and its ledger stamp, under the gift's lock; then the
// donor recalc and the after-change step). The value received is stated on
// the gift in the columns a gala ticket already uses (quid_pro_quo_value and
// _desc, deductible_amount), so the receipt and the letter say it. It becomes
// a Finance revenue line exactly as Not a gift makes one (source 'not_a_gift',
// Special Events or Other Revenue), and insight_reviews keeps the row as it
// was, so Undo puts it back to the cent. A raffle row is never partly a gift.
async function partlyAGift(orgId, a, g, b) {
  const giftId = g.id, batchId = b.batchId || null;
  const memo = [g.memo, g.notes].filter(Boolean).join(" · ");
  const kind = (I.notAGift(memo) || {}).kind;
  if (kind === "raffle") return out(400, { error: "raffle", sentence: "Raffle tickets are never a gift, not even in part. Mark the row Not a gift." });
  const amountCents = M.toCents(g.amount);
  const valueCents = M.toCents(b.value);
  if (valueCents == null) return out(400, { error: "need_value", sentence: "Enter the value of what they received, in dollars." });
  if (!(valueCents > 0 && valueCents < amountCents)) return out(400, { error: "bad_value", sentence: `The value received is more than $0 and less than the row's ${I.money(amountCents)}.` });
  if (g.quid_pro_quo_value != null && Number(g.quid_pro_quo_value) > 0) {
    return out(409, { error: "already_split", sentence: "This gift already states the goods or services received. Change it from the gift itself." });
  }
  const [att] = await query(`SELECT
      (SELECT COUNT(*) FROM receipts WHERE gift_id=? AND org_id=? AND voided_at IS NULL)::int AS receipts,
      (SELECT COUNT(*) FROM pledges WHERE fulfilled_gift_id=? AND org_id=?)::int AS pledges,
      (SELECT COUNT(*) FROM pledge_installments WHERE paid_gift_id=? AND org_id=?)::int AS installments`,
    [giftId, orgId, giftId, orgId, giftId, orgId]);
  if (g.stripe_payment_id || g.recurring_subscription_id || g.pledge_id || att.receipts || att.pledges || att.installments) {
    return out(409, { error: "attached", sentence: "This gift has a receipt, a payment or a pledge attached, so it is changed from the gift itself. Open it from the person's profile." });
  }
  const type = AS_TYPE[String(b.as || "").toLowerCase()] || AS_TYPE[kind] || "purchase";
  const rest = M.toDollars(amountCents - valueCents), value = M.toDollars(valueCents);
  const received = `${TYPE_LABEL[type]}${memo ? `: ${memo}` : ""}`.slice(0, 300);
  const [acct] = await query("SELECT id FROM accounts WHERE org_id=? AND code=? LIMIT 1", [orgId, ACCOUNT_FOR[type]]);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [g.donor_id, orgId]);
  const description = `${TYPE_LABEL[type]}, the part that was not a gift${memo ? `: ${memo}` : ""}`.slice(0, 500);
  const finId = newId("ft");
  const done = await withAdvisoryLock(`gift:${giftId}`, () => withTransaction(async client => {
    const [now] = await queryTx(client, "SELECT * FROM gifts WHERE id=? AND org_id=? FOR UPDATE", [giftId, orgId]);
    if (!now || M.toCents(now.amount) !== amountCents || (now.quid_pro_quo_value != null && Number(now.quid_pro_quo_value) > 0)) return false;
    const [stamp] = await queryTx(client, "SELECT * FROM fin_transactions WHERE gift_id=? AND org_id=? FOR UPDATE", [giftId, orgId]);
    // the row as it was, for Undo, before anything changes
    await runTx(client, `INSERT INTO insight_reviews (org_id, gift_id, decision, as_type, row_data, fin_id, fin_prev, donor_id, received, batch_id, created_by, created_by_name)
                         SELECT ?, ?, 'partly', ?, to_jsonb(t), ?, ?::jsonb, ?, ?, ?, ?, ? FROM gifts t WHERE t.id=? AND t.org_id=?
                         ON CONFLICT (org_id, gift_id) DO UPDATE SET decision=EXCLUDED.decision, as_type=EXCLUDED.as_type, row_data=EXCLUDED.row_data,
                           fin_id=EXCLUDED.fin_id, fin_prev=EXCLUDED.fin_prev, donor_id=EXCLUDED.donor_id, received=EXCLUDED.received, batch_id=EXCLUDED.batch_id,
                           created_by=EXCLUDED.created_by, created_by_name=EXCLUDED.created_by_name, created_at=NOW()`,
      [orgId, giftId, type, finId, stamp ? JSON.stringify(stamp) : null, g.donor_id, value, batchId, a.id, a.name, giftId, orgId]);
    await runTx(client, "UPDATE gifts SET amount=?, deductible_amount=?, quid_pro_quo_value=?, quid_pro_quo_desc=? WHERE id=? AND org_id=?",
      [rest, rest, value, received, giftId, orgId]);
    // NUMBERS-1: a soft credit follows the gift's new amount (as PUT /gifts/:id)
    for (const sql of SOFT_CREDIT_RESIZE) await client.query(sql, [giftId, orgId]);
    // BUILD-43: the gift's ledger stamp moves with it (as PUT /gifts/:id)
    if (stamp) await runTx(client, "UPDATE fin_transactions SET amount=? WHERE id=? AND org_id=?", [rest, stamp.id, orgId]);
    await runTx(client, `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,created_by,created_by_name)
                         VALUES (?,?,?,?,?,?,'income',?,?,?,'not_a_gift',?,?)`,
      [finId, orgId, g.date || null, description, d ? d.name : null, value, acct ? acct.id : null, g.fund_id || null, g.donor_id, a.id, a.name]);
    return true;
  }));
  if (!done) return out(409, { error: "changed", sentence: "This gift changed while you were deciding. Look at it again." });
  return out(200, { ok: true, decision: "partly", as: type, finId, rest, value, undo: `/insights/review/${giftId}/undo`, undoSeconds: 60,
    sentence: `Partly a gift: ${I.money(valueCents)} was ${TYPE_WORD[type]} and is in Finance as revenue; ${I.money(amountCents - valueCents)} stays a gift. Its receipt will say what they received.` },
    g.donor_id, { before: g, after: { amount: rest, value_received: value, as: type, finance_line: finId } });
}

// Undo a Partly: the gift's amount and its goods-or-services columns go back
// to what they were, its soft credits and ledger stamp follow, the revenue
// line goes. A receipt issued since names the gift part, so it is voided first.
async function undoPartly(orgId, r) {
  const giftId = r.gift_id, was = r.row_data || {};
  const [rc] = await query("SELECT COUNT(*)::int AS n FROM receipts WHERE gift_id=? AND org_id=? AND voided_at IS NULL", [giftId, orgId]);
  if (rc.n) return out(409, { error: "receipt", sentence: "A receipt was issued for the gift part since. Void that receipt first, then undo." });
  const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
  await withAdvisoryLock(`gift:${giftId}`, () => withTransaction(async client => {
    if (g) {
      // read back from the stored row in SQL, so each number keeps its own scale
      await runTx(client, `UPDATE gifts t SET amount=(r.row_data->>'amount')::numeric, deductible_amount=(r.row_data->>'deductible_amount')::numeric,
                                  quid_pro_quo_value=(r.row_data->>'quid_pro_quo_value')::numeric, quid_pro_quo_desc=r.row_data->>'quid_pro_quo_desc'
                             FROM insight_reviews r WHERE r.org_id=t.org_id AND r.gift_id=t.id AND t.id=? AND t.org_id=?`, [giftId, orgId]);
      for (const sql of SOFT_CREDIT_RESIZE) await client.query(sql, [giftId, orgId]);
      if (r.fin_prev) await runTx(client, `UPDATE fin_transactions t SET amount=(r.fin_prev->>'amount')::numeric FROM insight_reviews r
                                           WHERE r.org_id=t.org_id AND r.gift_id=? AND t.id=r.fin_prev->>'id' AND t.org_id=?`, [giftId, orgId]);
    }
    if (r.fin_id) await runTx(client, "DELETE FROM fin_transactions WHERE id=? AND org_id=? AND source='not_a_gift'", [r.fin_id, orgId]);
    await runTx(client, "DELETE FROM insight_reviews WHERE org_id=? AND gift_id=?", [orgId, giftId]);
  }));
  return out(200, { ok: true, sentence: "Put back as it was." }, g ? g.donor_id : null, { before: g || null, after: was });
}

async function undo(orgId, r) {
  if (r.decision === "partly") return undoPartly(orgId, r);
  const giftId = r.gift_id;
  await withTransaction(async client => {
    if (r.decision === "not_gift" && r.row_data) {
      // back on the person the review now points at (a merge since moves it, dataHealth.js MERGE_REFS)
      await runTx(client, "INSERT INTO gifts SELECT * FROM jsonb_populate_record(NULL::gifts, ?::jsonb)", [JSON.stringify({ ...r.row_data, donor_id: r.donor_id || r.row_data.donor_id })]);
      if (r.fin_prev) {
        const f = r.fin_prev;
        await runTx(client, "UPDATE fin_transactions SET gift_id=?, account_id=?, description=?, donor_id=?, source=? WHERE id=? AND org_id=?",
          [f.gift_id, f.account_id, f.description, f.donor_id, f.source, f.id, orgId]);
      } else if (r.fin_id) {
        await runTx(client, "DELETE FROM fin_transactions WHERE id=? AND org_id=? AND source='not_a_gift'", [r.fin_id, orgId]);
      }
    }
    await runTx(client, "DELETE FROM insight_reviews WHERE org_id=? AND gift_id=?", [orgId, giftId]);
  });
  return out(200, { ok: true, sentence: "Put back as it was." }, r.decision === "not_gift" ? r.donor_id : null,
    { before: null, after: r.decision === "not_gift" ? r.row_data : null });
}

// ASKS-2: which of `ids` the decision would refuse because something is
// attached (the same checks decide() makes, read for many rows at once), so a
// group's preview never counts a row its click will leave alone. Set of ids.
async function attachedIds(orgId, ids, decision) {
  if (decision === "keep" || !ids || !ids.length) return new Set();
  const thanks = decision === "not_gift" ? `
       OR EXISTS (SELECT 1 FROM threads t WHERE t.opening_gift_id = g.id AND t.org_id = g.org_id AND t.closed_at IS NULL)
       OR EXISTS (SELECT 1 FROM tasks k WHERE k.source_gift_id = g.id AND k.org_id = g.org_id AND k.voided_at IS NULL)` : "";
  const rows = await query(`SELECT g.id FROM gifts g WHERE g.org_id = ? AND g.id = ANY(?::text[]) AND (
         g.stripe_payment_id IS NOT NULL OR g.recurring_subscription_id IS NOT NULL OR g.pledge_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM receipts r WHERE r.gift_id = g.id AND r.org_id = g.org_id AND r.voided_at IS NULL)
      OR EXISTS (SELECT 1 FROM pledges p WHERE p.fulfilled_gift_id = g.id AND p.org_id = g.org_id)
      OR EXISTS (SELECT 1 FROM pledge_installments i WHERE i.paid_gift_id = g.id AND i.org_id = g.org_id)${thanks})`, [orgId, ids]);
  return new Set(rows.map(r => r.id));
}

module.exports = { decide, undo, attachedIds, AS_TYPE, TYPE_WORD, TYPE_LABEL, ACCOUNT_FOR };
