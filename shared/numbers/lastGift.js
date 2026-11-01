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
const LAST_GIFT_ORDER = "g.date DESC NULLS LAST, g.created_at DESC, g.id DESC";

// SQL: person `d`'s last gift date on file (no imported floor), or NULL.
const LAST_ON_FILE = (d = "d") => `(SELECT MAX(lg.date) FROM gifts lg WHERE lg.org_id = ${d}.org_id AND lg.donor_id = ${d}.id AND lg.date IS NOT NULL AND ${GIFT("lg")})`;
// SQL: with the imported last gift as the floor.
const LAST_DATE = (d = "d") => `GREATEST(${LAST_ON_FILE(d)}, NULLIF(${d}.imported_last_gift_date, ''))`;

// Each person's last gift, { date, cents }, read in one query: Map id -> it.
async function lastGifts(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(
    `SELECT DISTINCT ON (d.id) d.id, g.date AS g_date, ROUND(g.amount * 100)::bigint AS g_cents,
            NULLIF(d.imported_last_gift_date, '') AS imp_date, ROUND(COALESCE(d.imported_last_gift_amount, 0) * 100)::bigint AS imp_cents
       FROM donors d LEFT JOIN gifts g ON g.org_id = d.org_id AND g.donor_id = d.id AND g.date IS NOT NULL AND ${GIFT("g")}
      WHERE d.org_id = ? AND d.id = ANY(?::text[])
      ORDER BY d.id, ${LAST_GIFT_ORDER}`, [orgId, ids]);
  return new Map(rows.map(r => {
    const onFile = r.g_date ? String(r.g_date).slice(0, 10) : null, imp = r.imp_date ? String(r.imp_date).slice(0, 10) : null;
    const v = onFile && (!imp || onFile >= imp) ? { date: onFile, cents: Number(r.g_cents) }
      : imp ? { date: imp, cents: Number(r.imp_cents) } : null;
    return [r.id, v];
  }));
}

// The same rule over rows already read: [{ date, amount|cents, type, created_at?, id? }].
function lastOf(rows, imported = null) {
  const { isGift, centsOf } = require("./money");
  const dated = (rows || []).filter(r => r.date && isGift(r)).sort((a, b) =>
    String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10)) || String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  const top = dated[0] ? { date: String(dated[0].date).slice(0, 10), cents: centsOf(dated[0]) } : null;
  if (imported && imported.date && (!top || imported.date > top.date)) return { date: imported.date, cents: imported.cents || 0 };
  return top;
}

module.exports = { LAST_GIFT_ORDER, LAST_ON_FILE, LAST_DATE, lastGifts, lastOf };
