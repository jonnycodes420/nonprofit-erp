// server/reports/splitGiftRows.js · MOPUP-2 item 1. A SPLIT GIFT IS SPLIT IN THE BOOKKEEPER'S FILES.
//
// GIFTS-2 let one gift be split across funds (`gift_fund_lines`), and named the
// largest line on `gifts.fund_id` so a reader that never heard of lines still
// sees a real fund. The bookkeeper's gift-detail file and the deposits file
// were such readers: a $500 gift given $300 / $200 left as one $500 row on the
// $300 line's fund. Bookkeepers code to funds, so that is a wrong book.
//
// Here each line of a split gift becomes its own row, with its own fund and
// amount. The processor fee is cut the same way the ledger row is cut
// (shared/numbers/fundLines.js LEDGER_FUND_ROWS): in proportion, the last line
// taking the remainder, so the pieces foot to the gift to the cent. Every other
// column (date, donor, deposit, method, receipt, gift id) is the gift's own, so
// the rows still group into the same deposit and still foot to it.
//
// Pure: `linesByGift` is fundLines.linesFor's Map giftId → [{ fundName, amount }].
"use strict";

const toCents = v => Math.round(Number(v) * 100);

// Cut `total` cents across `weights` (cents) in proportion; the last takes the
// remainder so the parts always add back to `total`.
function cutInProportion(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  let before = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - before;
    const part = Math.round((total * w) / sum);
    before += part;
    return part;
  });
}

// rows: the bookkeeper rows (one per gift, with cents, feeCents, fund, giftId).
// fmt: cents → the file's dollar string.
function splitGiftRows(rows, linesByGift, fmt) {
  if (!linesByGift || !linesByGift.size) return rows;
  const out = [];
  for (const r of rows) {
    const lines = linesByGift.get(r.giftId);
    if (!lines || lines.length < 2) { out.push(r); continue; }
    const lineCents = lines.map(l => toCents(l.amount));
    // The lines add to the gift (linesRefusal); if a later refund changed the
    // gift's amount, cut what the gift says now, as the ledger does.
    const amounts = cutInProportion(r.cents, lineCents);
    const fees = cutInProportion(r.feeCents || 0, lineCents);
    lines.forEach((l, i) => {
      const cents = amounts[i], feeCents = fees[i];
      out.push({
        ...r,
        cents, amount: fmt(cents),
        feeCents, fee: fmt(feeCents),
        netCents: cents - feeCents, net: fmt(cents - feeCents),
        fund: l.fundName || "", fundId: l.fundId || null,
        splitLine: `${i + 1} of ${lines.length}`,
      });
    });
  }
  return out;
}

// How many gifts the rows hold (a split gift is one gift on several rows).
function giftCountOf(rows) {
  const ids = new Set();
  let noId = 0;
  for (const r of rows) { if (r && r.giftId) ids.add(r.giftId); else noId += 1; }
  return ids.size + noId;
}

module.exports = { splitGiftRows, cutInProportion, giftCountOf };
