// server/imports/giftExtrasWrite.js · IMPORT-12 item 4. THE GIFT'S OWN FACTS,
// WRITTEN WITH THE GIFT.
//
// The one reader (shared/giftExtras.js) says, for each gift row, what the old
// system knew: a refund against it, who else is credited, whom it honours,
// whether it is anonymous, which pledge it pays. The gifts themselves are
// written by recordGifts (the one gift path, in the import's transaction);
// this writes the rest onto them, set-wise, in the same transaction:
//   · a refund row (written by recordGifts as a negative gift) points at its
//     gift (gifts.refund_of), and a gift refunded in full says so
//     (refunded_in_full, money.js GIFT), exactly as "Record a refund" leaves it;
//   · a soft credit is a gift_soft_credits row: recognition, never money, so it
//     is in no lifetime (creditTypes.js). It cascades with its gift on Undo;
//   · a tribute is the gift's tribute_type and tribute_name, anonymous its flag;
//   · a pledge payment is set on its pledge and the pledge recalculated.
// A row already here (the same file again) is a duplicate: nothing of it is
// written twice, so importing the same file again changes nothing.
"use strict";
const { newId } = require("../shared/newId");

// The plan's refunds whose gift is still in the plan (a person set aside takes their refunds with them).
function refundsToWrite(u) {
  const rows = new Set(u.gifts.map(g => g.rowId));
  return (u.refunds || []).filter(r => rows.has(r.refundOf));
}

async function writeGiftExtras({ query, run, recalcPledgePayment }, { orgId, who, u, giftIdByRow, pledgeIdByRow, personId }) {
  const out = { refunds: 0, refundCents: 0, refundedInFull: 0, softCredits: 0, tributes: 0, anonymous: 0, pledgePayments: 0 };
  const byRow = new Map(u.gifts.map(g => [g.rowId, g]));
  // refunds: point each at its gift
  const ref = [];
  for (const g of u.gifts) if (g.kind === "refund" && giftIdByRow.has(g.rowId) && giftIdByRow.has(g.refundOf)) ref.push([giftIdByRow.get(g.rowId), giftIdByRow.get(g.refundOf), g]);
  if (ref.length) {
    await run(`UPDATE gifts g SET refund_of = v.orig, refund_reason = 'In the imported file' FROM unnest(?::text[], ?::text[]) AS v(id, orig)
                WHERE g.id = v.id AND g.org_id = ?`, [ref.map(r => r[0]), ref.map(r => r[1]), orgId]);
    const full = ref.filter(r => r[2].full).map(r => r[1]);
    if (full.length) {
      await run(`UPDATE gifts SET refunded_in_full = TRUE WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, full]);
      // a gift refunded in full is no longer a gift (money.js GIFT): its person's last gift and count are worked out again
      const ids = [...new Set(ref.filter(r => r[2].full).map(r => personId.get(r[2].personKey)).filter(Boolean))];
      await require("../../shared/numbers/donorTotals").recomputeStoredTotals(run, orgId, ids);   // NUMBERS-6: the one writer
    }
    out.refunds = ref.length; out.refundCents = ref.reduce((t, r) => t + r[2].cents, 0); out.refundedInFull = full.length;
  }
  // soft credits: recognition on the person thanked
  const sc = [];
  for (const c of u.softCredits || []) {
    const giftId = giftIdByRow.get(c.giftRowId), donorId = personId.get(c.personKey);
    if (giftId && donorId && c.cents > 0) sc.push([newId("gsc"), giftId, donorId, c.cents / 100]);
  }
  for (let k = 0; k < sc.length; k += 1000) {
    const b = sc.slice(k, k + 1000);
    const wrote = await query(`INSERT INTO gift_soft_credits (id, org_id, gift_id, donor_id, amount, role, created_by, created_by_name)
        SELECT v.id, ?, v.gift, v.donor, v.amount, 'other', ?, ? FROM unnest(?::text[], ?::text[], ?::text[], ?::numeric[]) AS v(id, gift, donor, amount)
        ON CONFLICT (gift_id, donor_id) DO NOTHING RETURNING id`,
      [orgId, who.id, who.name, b.map(x => x[0]), b.map(x => x[1]), b.map(x => x[2]), b.map(x => x[3])]);
    out.softCredits += wrote.length;
  }
  // tributes and anonymous
  const tr = [], an = [];
  for (const [rowId, giftId] of giftIdByRow) {
    const g = byRow.get(rowId);
    if (!g || !g.extras) continue;
    if (g.extras.tribute) tr.push([giftId, g.extras.tribute.type, g.extras.tribute.name.slice(0, 200)]);
    if (g.extras.anonymous) an.push(giftId);
  }
  if (tr.length) {
    await run(`UPDATE gifts g SET tribute_type = v.type, tribute_name = v.name FROM unnest(?::text[], ?::text[], ?::text[]) AS v(id, type, name)
                WHERE g.id = v.id AND g.org_id = ? AND g.tribute_type IS NULL`, [tr.map(x => x[0]), tr.map(x => x[1]), tr.map(x => x[2]), orgId]);
    out.tributes = tr.length;
  }
  if (an.length) { await run(`UPDATE gifts SET anonymous = TRUE WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, an]); out.anonymous = an.length; }
  // pledge payments onto their pledge
  const pp = [];
  for (const g of u.gifts) if (g.pledgeOf && giftIdByRow.has(g.rowId) && pledgeIdByRow.has(g.pledgeOf)) pp.push([giftIdByRow.get(g.rowId), pledgeIdByRow.get(g.pledgeOf)]);
  if (pp.length) {
    await run(`UPDATE gifts g SET pledge_id = v.pledge FROM unnest(?::text[], ?::text[]) AS v(id, pledge) WHERE g.id = v.id AND g.org_id = ? AND g.pledge_id IS NULL`,
      [pp.map(x => x[0]), pp.map(x => x[1]), orgId]);
    for (const pid of new Set(pp.map(x => x[1]))) await recalcPledgePayment(pid, orgId);
    out.pledgePayments = pp.length;
  }
  return out;
}

module.exports = { writeGiftExtras, refundsToWrite };
