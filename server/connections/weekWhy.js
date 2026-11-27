// server/connections/weekWhy.js · HONEST-3 item 3 (W-1126-Integrations-05). A WEEKLY COUNT THAT
// CHANGES SAYS WHY.
//
// "PayPal and Stripe weekly counts fell ... with no new check since Nov 23 and no explanation." The
// "Connects directly" tile counts the source's gifts dated in the last seven days, so the number moves
// when a gift comes in, when a refund is recorded, and when a gift's day slips out of the window. The
// daily check (./checks.js) keeps that count; the tile now compares with the last check and names
// what changed: "Down from 9 at the Nov 26 check: 1 refund recorded Nov 25, 2 from Nov 19 are now
// more than a week old."
"use strict";

const monDay = d => { const t = new Date(String(d).length === 10 ? d + "T12:00:00Z" : d);
  return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
const dayOf = (iso, back = 0) => new Date(new Date(iso).getTime() - back * 86400000).toISOString().slice(0, 10);

// `sources` are giving_sources rows with gifts_this_week. Returns { [sourceId]: sentence }.
async function weekWhys(query, orgId, sources, { now = new Date() } = {}) {
  const ids = sources.map(s => s.id);
  if (!ids.length) return {};
  require("./checks");   // the table exists once checks.js has been asked for it
  const prev = await query(
    `SELECT DISTINCT ON (card_key) card_key, checked_at, (counts->>'week')::int AS week FROM connection_checks
      WHERE org_id = ? AND card_key = ANY(?::text[]) AND counts->>'week' IS NOT NULL AND checked_at < ?::timestamptz
      ORDER BY card_key, checked_at DESC`, [orgId, ids, new Date(new Date(now).getTime() - 60 * 60 * 1000).toISOString()]).catch(() => []);
  const out = {};
  for (const p of prev) {
    const s = sources.find(x => x.id === p.card_key);
    const nowCount = Number(s && s.gifts_this_week) || 0;
    if (!s || p.week == null || p.week === nowCount) continue;
    const at = new Date(p.checked_at).toISOString();
    const [r] = await query(
      `SELECT COUNT(*) FILTER (WHERE refund_of IS NOT NULL AND created_at > ?::timestamptz)::int AS refunds,
              MAX(created_at) FILTER (WHERE refund_of IS NOT NULL AND created_at > ?::timestamptz) AS refund_at,
              COUNT(*) FILTER (WHERE refund_of IS NULL AND created_at > ?::timestamptz AND date >= ?)::int AS fresh,
              COUNT(*) FILTER (WHERE date >= ? AND date < ?)::int AS aged,
              MIN(date) FILTER (WHERE date >= ? AND date < ?) AS aged_from
         FROM gifts WHERE org_id = ? AND giving_source_id = ?`,
      [at, at, at, dayOf(now, 7), dayOf(at, 7), dayOf(now, 7), dayOf(at, 7), dayOf(now, 7), orgId, s.id]);
    const parts = [];
    if (r.fresh) parts.push(`${r.fresh} new`);
    if (r.refunds) parts.push(`${r.refunds} ${r.refunds === 1 ? "refund" : "refunds"} recorded ${monDay(r.refund_at)}`);
    if (r.aged) parts.push(`${r.aged} from ${monDay(r.aged_from)} ${r.aged === 1 ? "is" : "are"} now more than a week old`);
    if (!parts.length) parts.push("a gift in the window was changed or removed");
    out[s.id] = `${nowCount > p.week ? "Up" : "Down"} from ${p.week} at the ${monDay(at)} check: ${parts.join(", ")}.`;
  }
  return out;
}

module.exports = { weekWhys };
