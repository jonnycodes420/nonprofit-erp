// server/qbo/giftParts.js · MOPUP-3 item 1. A SPLIT GIFT REACHES QUICKBOOKS SPLIT.
//
// GIFTS-2 lets one gift be split across funds (`gift_fund_lines`) and names the
// largest line on `gifts.fund_id`. MOPUP-2 made the bookkeeper's files read the
// lines; QuickBooks sync still read `gifts.fund_id`, so a $500 gift given
// $300 / $200 was one $500 line on the $300 fund's account: restricted money in
// the wrong place in the org's own books.
//
// Here a gift becomes its PARTS: one per fund line, each with its own fund and
// amount, and the processor fee cut across them the way the deposit sheet cuts
// it (server/reports/splitGiftRows.js cutInProportion: in proportion, the last
// line taking the remainder), so the parts foot to the gift and to its fee to
// the cent. A gift with no split is one part, itself, unchanged.
//
// Pure apart from `loadLines`. `g` is a qboSync pending row (id, cents,
// fee_cents, fund_id, fund_name, campaign_id, …).
"use strict";

const { cutInProportion } = require("../reports/splitGiftRows");
const { linesFor } = require("../../shared/numbers/fundLines");

async function loadLines(query, orgId, gifts) {
  return linesFor(query, orgId, (gifts || []).map(g => g.id));
}

// The parts of one gift: [{ ...g, fund_id, fund_name, cents, fee_cents, part }].
function partsOf(g, linesByGift) {
  const lines = linesByGift ? linesByGift.get(g.id) : null;
  if (!lines || lines.length < 2) return [{ ...g, part: null }];
  const weights = lines.map(l => Math.round(Number(l.amount) * 100));
  // The lines add to the gift (linesRefusal); if a refund later changed the
  // gift, cut what the gift says now, as the ledger and the deposit sheet do.
  const amounts = cutInProportion(Number(g.cents), weights);
  const fees = cutInProportion(Number(g.fee_cents || 0), weights);
  return lines.map((l, i) => ({
    ...g, fund_id: l.fundId, fund_name: l.fundName, cents: amounts[i], fee_cents: fees[i],
    part: `${i + 1} of ${lines.length}`,
  }));
}

// Where each part lands. One part that cannot land holds the whole gift back
// (a receipt or deposit missing a line does not match the gift), with that
// part's sentence.
function landingsOf(parts, map, landingFor) {
  const out = [];
  for (const p of parts) {
    const landing = landingFor(p, map);
    if (!landing.ok) return { ok: false, landing, part: p };
    out.push({ g: p, landing });
  }
  return { ok: true, items: out };
}

// The Pending row's "lands" words for a split gift: each part's amount and
// where it goes.
function landsSentence(items) {
  if (items.length === 1) return items[0].landing.sentence;
  const money = c => `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return items.map(({ g, landing }) => `${money(g.cents)} to ${landing.sentence}`).join("; ");
}

module.exports = { loadLines, partsOf, landingsOf, landsSentence };
