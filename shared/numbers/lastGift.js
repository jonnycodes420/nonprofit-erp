// shared/numbers/lastGift.js · NUMBERS-3. A PERSON'S LAST GIFT.
//
// One rule (MAP-1 §2.3 found two): the last gift is the latest DATED GIFT,
// money above zero (money.js): a refund is not a gift and a credit row is not
// money, so neither is ever anyone's last gift. On one day it is the one
// recorded last (donorSummary.LAST_GIFT_ORDER). The old system's last gift
// (donors.imported_last_gift_*) stands when nothing on file is as recent.
// The lapse rule, the tags and the merge fields all read this date.
"use strict";
const { GIFT } = require("./money");
// NUMBERS-4: one import writes every row with one created_at, so two gifts on
// one day from one file were picked by a random id. Now: the larger, then the
// one further down the file (gifts.import_row), and the id only for rows that
// are the same in every way a person can see.
const LAST_GIFT_ORDER = "g.date DESC NULLS LAST, g.created_at DESC, g.amount DESC, g.import_row DESC NULLS LAST, g.id DESC";

// NUMBERS-9 item 3 (W-1126-Finance-01): "Last gift $50 gross while Lifetime is $35 net after a $15
// refund". The last gift is still the latest gift (a refund is never one), and its amount is the
// gift as it is now: less what was refunded on it (refunds.js NET_AMOUNT), with the refund named:
// "$35 · $50 less a $15 refund". The stored donors.last_gift_amount is this net figure
// (donorSummary.js), so the Directory, lists, exports and merge fields agree with Lifetime.
// SQL: what has been refunded on gift row `g`, in dollars (0 when nothing).
const REFUNDED_ON = (g = "g") => `COALESCE(-(SELECT SUM(rf.amount) FROM gifts rf WHERE rf.org_id = ${g}.org_id AND rf.refund_of = ${g}.id), 0)`;
// SQL: gift row `g`'s amount less its refunds, in dollars.
const NET_OF = (g = "g") => `(${g}.amount - ${REFUNDED_ON(g)})`;
// SQL: what was refunded on person `d`'s last gift on file, in dollars (0 when nothing, or no gift).
const LAST_GIFT_REFUNDED = (d = "d") => `COALESCE((SELECT ${REFUNDED_ON("g")} FROM gifts g
    WHERE g.org_id = ${d}.org_id AND g.donor_id = ${d}.id AND g.date IS NOT NULL AND ${GIFT("g")}
    ORDER BY ${LAST_GIFT_ORDER} LIMIT 1), 0)`;
const usd = c => "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
// The words for a last gift: "$35 · $50 less a $15 refund", or "$50" when nothing came back.
function lastGiftWords({ cents, refundedCents = 0 }) {
  if (cents == null) return "";
  if (!(refundedCents > 0)) return usd(cents);
  return `${usd(cents)} · ${usd(cents + refundedCents)} less a ${usd(refundedCents)} refund`;
}
// SQL (binds org id, person id): the profile's Last gift row, its amount net of refunds, its detail
// naming the refund ("Less a refund of $15.00 on $50.00") or how it was paid. `order` is LAST_GIFT_ORDER.
const LAST_GIFT_ROW = (order = LAST_GIFT_ORDER) => `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(f.name, 'Unrestricted') AS name, g.date,
       ROUND(${NET_OF("g")}::numeric, 2) AS amount,
       CASE WHEN ${REFUNDED_ON("g")} > 0
            THEN 'Less a refund of ' || TO_CHAR(${REFUNDED_ON("g")}, 'FM$999,999,990.00') || ' on ' || TO_CHAR(g.amount, 'FM$999,999,990.00')
            ELSE COALESCE(NULLIF(g.payment_method, ''), INITCAP(NULLIF(g.type, ''))) END AS detail
  FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
  LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
 WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.donor_id = ? AND g.date IS NOT NULL AND ${GIFT("g")}
 ORDER BY ${order} LIMIT 1`;
const REFUND_SENTENCE = "The last gift is shown as it is now: the gift less anything refunded on it, the same basis as Lifetime.";

// SQL: person `d`'s last gift date on file (no imported floor), or NULL.
const LAST_ON_FILE = (d = "d") => `(SELECT MAX(lg.date) FROM gifts lg WHERE lg.org_id = ${d}.org_id AND lg.donor_id = ${d}.id AND lg.date IS NOT NULL AND ${GIFT("lg")})`;
// SQL: with the imported last gift as the floor.
const LAST_DATE = (d = "d") => `GREATEST(${LAST_ON_FILE(d)}, NULLIF(${d}.imported_last_gift_date, ''))`;

// Each person's last gift, { date, cents }, read in one query: Map id -> it.
async function lastGifts(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(
    `SELECT DISTINCT ON (d.id) d.id, g.date AS g_date, ROUND(${NET_OF("g")} * 100)::bigint AS g_cents, ROUND(${REFUNDED_ON("g")} * 100)::bigint AS g_refunded,
            NULLIF(d.imported_last_gift_date, '') AS imp_date, ROUND(COALESCE(d.imported_last_gift_amount, 0) * 100)::bigint AS imp_cents
       FROM donors d LEFT JOIN gifts g ON g.org_id = d.org_id AND g.donor_id = d.id AND g.date IS NOT NULL AND ${GIFT("g")}
      WHERE d.org_id = ? AND d.id = ANY(?::text[])
      ORDER BY d.id, ${LAST_GIFT_ORDER}`, [orgId, ids]);
  return new Map(rows.map(r => {
    const onFile = r.g_date ? String(r.g_date).slice(0, 10) : null, imp = r.imp_date ? String(r.imp_date).slice(0, 10) : null;
    const v = onFile && (!imp || onFile >= imp) ? { date: onFile, cents: Number(r.g_cents), refundedCents: Number(r.g_refunded) || 0 }
      : imp ? { date: imp, cents: Number(r.imp_cents) } : null;
    return [r.id, v];
  }));
}

// The same rule over rows already read: [{ date, amount|cents, type, created_at?, import_row?, id? }].
function lastOf(rows, imported = null) {
  const { isGift, centsOf } = require("./money");
  const dated = (rows || []).filter(r => r.date && isGift(r)).sort((a, b) =>
    String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10)) || String(b.created_at || "").localeCompare(String(a.created_at || ""))
    || centsOf(b) - centsOf(a) || (b.import_row == null ? -1 : a.import_row == null ? 1 : b.import_row - a.import_row) || String(b.id || "").localeCompare(String(a.id || "")));
  const top = dated[0] ? { date: String(dated[0].date).slice(0, 10), cents: centsOf(dated[0]) } : null;
  if (imported && imported.date && (!top || imported.date > top.date)) return { date: imported.date, cents: imported.cents || 0 };
  return top;
}

module.exports = { LAST_GIFT_ORDER, LAST_ON_FILE, LAST_DATE, lastGifts, lastOf, REFUNDED_ON, NET_OF, LAST_GIFT_REFUNDED, lastGiftWords, REFUND_SENTENCE, LAST_GIFT_ROW };
