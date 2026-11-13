// shared/numbers/givingBetween.js · NUMBERS-3. MONEY GIVEN IN A SPAN OF DAYS.
//
// Every gift dated from `from` to `to`, both civil days inclusive, counted as
// money.js counts (hard credit, refunds off, credit rows out), from people who
// are not deleted. A span never runs past the org's today: a gift dated in the
// future is not money received yet, so "this fiscal year" is its first day to
// today (fiscalYear.fiscalYearToDate). An undated gift is in no span.
"use strict";
const { MONEY, LIVE, GIVERS } = require("./money");

// The span, cut at today. `to` empty means today.
function capped({ from, to }, today) {
  const t = !to || (today && to > today) ? today : to;
  return { from, to: t };
}

// SQL: gift `g` is money given in the span (placeholders, from then to).
const IN_SPAN = (g = "g") => `(${MONEY(g)} AND ${g}.date >= ? AND ${g}.date <= ?)`;
// SQL: the money given in the span by rows `g`, dollars (two placeholders, from
// then to). A report's year column (NUMBERS-5).
const SPAN_SUM = (g = "g") => `COALESCE(SUM(${g}.amount) FILTER (WHERE ${IN_SPAN(g)}), 0)`;
// SQL: the same, in whole cents.
const SPAN_CENTS = (g = "g") => `COALESCE(SUM(ROUND(${g}.amount * 100)) FILTER (WHERE ${IN_SPAN(g)}), 0)::bigint`;

// Total given in cents for the org or one person: `gifts` the gifts above
// zero, `rows` every money row (a refund included), `givers` the people.
// ACCESS-3: `visible` (server/auth/portfolio.js visibleSql over "d") narrows it
// to a portfolio user's people; omitted, it is the whole org.
async function givingBetween(query, orgId, { from, to, today, donorId = null, visible = null }) {
  const s = capped({ from, to }, today);
  if (!s.from || !s.to || s.to < s.from) return { cents: 0, gifts: 0, rows: 0, givers: 0, from: s.from, to: s.to };
  const v = visible && visible.sql ? visible : { sql: "", args: [] };
  const args = [orgId, s.from, s.to];
  if (donorId) args.push(donorId);
  const [r] = await query(
    `SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents, COUNT(*) FILTER (WHERE ${require("./giftCount").COUNTED("g")})::int AS n,   -- FLOWS-9: giftCount.js, a gift refunded in full is not one
            COUNT(*)::int AS rows, ${GIVERS("g", "d")}::int AS givers
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${LIVE("d")} AND ${IN_SPAN("g")}${donorId ? " AND g.donor_id = ?" : ""}${v.sql}`, [...args, ...v.args]);
  return { cents: Number(r.cents), gifts: Number(r.n), rows: Number(r.rows), givers: Number(r.givers), from: s.from, to: s.to };
}

// ACCESS-3: the same money, person by person, most first (ties by id), people
// who gave nothing in the span left out. Its rows foot to givingBetween's cents
// for the same span and `visible`, because both read IN_SPAN over live people.
async function givingBetweenByPerson(query, orgId, { from, to, today, visible = null, limit = 5 }) {
  const s = capped({ from, to }, today);
  if (!s.from || !s.to || s.to < s.from) return [];
  const v = visible && visible.sql ? visible : { sql: "", args: [] };
  const rows = await query(
    `SELECT d.id, d.name, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${LIVE("d")} AND ${IN_SPAN("g")}${v.sql}
      GROUP BY d.id, d.name HAVING COALESCE(SUM(ROUND(g.amount * 100)), 0) > 0
      ORDER BY cents DESC, d.id LIMIT ${Math.max(1, Math.min(100, Number(limit) || 5))}`, [orgId, s.from, s.to, ...v.args]);
  return rows.map(r => ({ id: r.id, name: r.name, cents: Number(r.cents) }));
}

// LEDGER-1 · THE LAST YEAR THEY GAVE. LYBUNT's and SYBUNT's amount, one rule:
// what the person gave in the latest year, before the year that starts on
// `yearFrom`, in which they gave anything. The years are the report's own,
// stepped back from `yearFrom` a whole year at a time, so a fiscal report's
// years are fiscal and a calendar report's calendar (a May 2025 gift with a
// July year is FY2025, never "last year" because it is 2025). For somebody who
// gave last year it is last year's total, so LYBUNT is unchanged; for a SYBUNT
// person it is never $0, because they gave in it.
//   yearsBefore("2026-07-01") → { froms: ["2025-07-01", ...], tos: ["2026-06-30", ...] }
const YEARS_BACK = 80;
function yearsBefore(yearFrom, n = YEARS_BACK) {
  const y0 = Number(String(yearFrom).slice(0, 4)), mmdd = String(yearFrom).slice(4, 10);
  const froms = [], tos = [];
  let next = String(yearFrom).slice(0, 10);
  for (let k = 1; k <= n; k++) {
    const f = `${y0 - k}${mmdd}`;
    const t = new Date(Date.parse(next + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
    froms.push(f); tos.push(t); next = f;
  }
  return { froms, tos };
}
// SQL, for a person alias `d`: joins `ly` (ly.f, ly.t: the last year they
// gave, before yearFrom) and exposes LAST_YEAR_SUM(d) beside it.
// Placeholders, in order: yearFrom, the froms array, the tos array.
const LAST_YEAR_JOIN = (d = "d") => `
  LEFT JOIN LATERAL (SELECT MAX(lg.date) AS last FROM gifts lg
     WHERE lg.org_id = ${d}.org_id AND lg.donor_id = ${d}.id AND lg.amount > 0 AND ${MONEY("lg")} AND lg.date < ?) lgd ON true
  LEFT JOIN LATERAL (SELECT y.f, y.t FROM unnest(?::text[], ?::text[]) AS y(f, t)
     WHERE lgd.last >= y.f AND lgd.last <= y.t LIMIT 1) ly ON true`;
const LAST_YEAR_SUM = (d = "d") => `(SELECT COALESCE(SUM(lg.amount), 0) FROM gifts lg
     WHERE lg.org_id = ${d}.org_id AND lg.donor_id = ${d}.id AND ${MONEY("lg")} AND lg.date >= ly.f AND lg.date <= ly.t)`;
const lastYearArgs = (yearFrom) => { const y = yearsBefore(yearFrom); return [yearFrom, y.froms, y.tos]; };

module.exports = { capped, IN_SPAN, SPAN_SUM, SPAN_CENTS, givingBetween, givingBetweenByPerson, yearsBefore, LAST_YEAR_JOIN, LAST_YEAR_SUM, lastYearArgs };
