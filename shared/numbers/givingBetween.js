// shared/numbers/givingBetween.js · NUMBERS-3. MONEY GIVEN IN A SPAN OF DAYS.
//
// Every gift dated from `from` to `to`, both civil days inclusive, counted as
// money.js counts (hard credit, refunds off, credit rows out), from people who
// are not deleted. A span never runs past the org's today: a gift dated in the
// future is not money received yet, so "this fiscal year" is its first day to
// today (fiscalYear.fiscalYearToDate). An undated gift is in no span.
"use strict";
const { MONEY, LIVE } = require("./money");

// The span, cut at today. `to` empty means today.
function capped({ from, to }, today) {
  const t = !to || (today && to > today) ? today : to;
  return { from, to: t };
}

// SQL: gift `g` is money given in the span (placeholders, from then to).
const IN_SPAN = (g = "g") => `(${MONEY(g)} AND ${g}.date >= ? AND ${g}.date <= ?)`;

// Total given in cents for the org or one person: `gifts` the gifts above
// zero, `rows` every money row (a refund included), `givers` the people.
async function givingBetween(query, orgId, { from, to, today, donorId = null }) {
  const s = capped({ from, to }, today);
  if (!s.from || !s.to || s.to < s.from) return { cents: 0, gifts: 0, rows: 0, givers: 0, from: s.from, to: s.to };
  const args = [orgId, s.from, s.to];
  if (donorId) args.push(donorId);
  const [r] = await query(
    `SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents, COUNT(*) FILTER (WHERE g.amount > 0)::int AS n,
            COUNT(*)::int AS rows, COUNT(DISTINCT g.donor_id)::int AS givers
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${LIVE("d")} AND ${IN_SPAN("g")}${donorId ? " AND g.donor_id = ?" : ""}`, args);
  return { cents: Number(r.cents), gifts: Number(r.n), rows: Number(r.rows), givers: Number(r.givers), from: s.from, to: s.to };
}

module.exports = { capped, IN_SPAN, givingBetween };
