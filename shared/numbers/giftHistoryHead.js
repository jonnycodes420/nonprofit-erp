// shared/numbers/giftHistoryHead.js · NUMBERS-10 item 4 (W-1127-Finance-01). THE GIFT HISTORY HEADER
// FOOTS TO THE ROWS LISTED UNDER IT.
//
// The fleet read a profile's Gift History header at "Total: $800 · 19 gifts" over a list of 11 rows
// that summed to $800. The header was counted in the browser by its own rule (any row above $0 not
// refunded in full), and summed by another (every row not scheduled), and neither was the profile's
// glance rule (money.js isGift / isMoney: a soft or matching credit is never money). Now the server
// counts the header from exactly the rows it sends for the list, by the glance rule, and says what
// every listed row that is not in the count is:
//
//   gifts      rows that are a gift (money.js isGift): the count, and their amounts
//   total      every row that is money (isMoney): the gifts, less refunds, so a gift refunded in full
//              nets to $0 and a partial refund comes off
//   notCounted the listed rows that are not in the count, by reason: refunds, refunded in full,
//              scheduled (dated after today), credits (soft or matching), $0 records
//
//   listed = gifts.n + every notCounted n, always. The header reads "Total: $800 · 11 gifts", and when
//   any row is listed but not counted, "· 13 rows listed: 1 refund (-$15), 1 scheduled".
"use strict";
const { isMoney, isGift, centsOf } = require("./money");
const { isCredit } = require("../../creditTypes");

const REASONS = [
  ["refund", "refund", "refunds"],
  ["refundedInFull", "gift refunded in full", "gifts refunded in full"],
  ["scheduled", "scheduled gift, counted on its date", "scheduled gifts, counted on their dates"],
  ["credit", "soft or matching credit", "soft or matching credits"],
  ["zero", "$0 record", "$0 records"],
];

function reasonOf(r) {
  if (isGift(r)) return null;
  if (r && r.scheduled === true) return "scheduled";
  if (isCredit(r && (r.type ?? r.gift_type))) return "credit";
  const c = centsOf(r);
  if (c < 0) return "refund";
  if (c > 0) return "refundedInFull";
  return "zero";
}

const usd = c => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

// rows: the gift rows the list shows ({ amount, type, scheduled, refunded_in_full }).
function giftHistoryHead(rows) {
  const list = rows || [];
  const gifts = { n: 0, cents: 0 };
  let total = 0;
  const not = Object.fromEntries(REASONS.map(([k]) => [k, { n: 0, cents: 0 }]));
  for (const r of list) {
    if (isMoney(r)) total += centsOf(r);
    const why = reasonOf(r);
    if (!why) { gifts.n++; gifts.cents += centsOf(r); continue; }
    not[why].n++; not[why].cents += centsOf(r);
  }
  const notCounted = REASONS.filter(([k]) => not[k].n).map(([k, one, many]) => ({ reason: k, n: not[k].n, cents: not[k].cents,
    words: `${not[k].n.toLocaleString("en-US")} ${not[k].n === 1 ? one : many}${k === "refund" || k === "credit" ? ` (${usd(not[k].cents)})` : ""}` }));
  const words = `Total: ${usd(total)} · ${gifts.n.toLocaleString("en-US")} ${gifts.n === 1 ? "gift" : "gifts"}`
    + (notCounted.length ? ` · ${list.length.toLocaleString("en-US")} rows listed: ${notCounted.map(x => x.words).join(", ")}, not in the count` : "");
  return { listed: list.length, gifts, totalCents: total, notCounted, words,
    sentence: "The header counts the gifts listed below: each gift above $0 that is not refunded in full and not dated after today. The total is the money listed, less refunds. A soft or matching credit is listed, never counted." };
}

// The flags each listed row carries to the screen, so the header the browser draws sums exactly the
// rows it lists, by this rule (GET /donors/:id): in_count, in_total, and why a row is not counted.
const rowFlags = r => ({ in_count: !reasonOf(r), in_total: isMoney(r), not_counted: reasonOf(r) });

module.exports = { giftHistoryHead, rowFlags, REASONS };
