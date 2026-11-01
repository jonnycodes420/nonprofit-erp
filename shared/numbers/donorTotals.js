// shared/numbers/donorTotals.js · NUMBERS-3. ONE CORE, MANY FACES.
//
// The figures a face shows for one person or a few (the donor portal, the
// donor account page, a merge field), computed by the modules beside this
// one, so a portal total, {{lifetime_total}} and the profile's Lifetime are
// one call (ARCHITECTURE.md, "One core, many faces"):
//   lifetime   lifetime.js (an imported total included)
//   thisYear   the org's fiscal year to its today (fiscalYear.js, givingBetween.js)
//   first      firstGift.js;  last  lastGift.js
//   gifts      gifts above zero on file;  largest  the largest money row
//   byYear     money by CALENDAR year, for a face that lists years ("2026")
"use strict";
const { MONEY, GIFT, LIVE } = require("./money");
const { LIFETIME } = require("./lifetime");
const { FIRST_DATE } = require("./firstGift");
const { LAST_DATE } = require("./lastGift");
const { IN_SPAN } = require("./givingBetween");
const FY = require("./fiscalYear");

const num = v => Number(v) || 0;

// `org` is the org's row (timezone, vocabulary_json), for its year and today.
async function donorTotals(query, org, ids, { byYear = false } = {}) {
  if (!ids || !ids.length) return { lifetime: 0, thisYear: 0, gifts: 0, largest: 0, first: null, last: null, byYear: [] };
  const span = FY.fiscalYearToDate(org);
  const [[r], years] = await Promise.all([
    query(`SELECT (SELECT COALESCE(SUM(${LIFETIME("d")}), 0) FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])) AS lifetime,
                  (SELECT MIN(${FIRST_DATE("d")}) FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])) AS first,
                  (SELECT MAX(${LAST_DATE("d")}) FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])) AS last,
                  (SELECT COUNT(*) FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${GIFT("g")})::int AS gifts,
                  (SELECT MAX(g.amount) FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${MONEY("g")}) AS largest,
                  (SELECT COALESCE(SUM(g.amount), 0) FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${IN_SPAN("g")}) AS this_year`,
      [org.id, ids, org.id, ids, org.id, ids, org.id, ids, org.id, ids, org.id, ids, span.from, span.to]),
    byYear ? query(`SELECT LEFT(g.date, 4) AS year, COALESCE(SUM(g.amount), 0) AS total, COUNT(*) FILTER (WHERE g.amount > 0)::int AS count
                      FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${MONEY("g")}
                     GROUP BY LEFT(g.date, 4) ORDER BY year DESC`, [org.id, ids]) : [],
  ]);
  return {
    lifetime: num(r.lifetime), thisYear: num(r.this_year), gifts: num(r.gifts), largest: num(r.largest),
    first: r.first ? String(r.first).slice(0, 10) : null, last: r.last ? String(r.last).slice(0, 10) : null,
    byYear: years.map(y => ({ year: y.year, total: num(y.total), count: y.count })),
  };
}

// The same figures across several orgs at once (the donor account page):
// links [{ org_id, donor_id }] -> Map org_id -> { lifetime, thisYear, last }.
async function totalsByOrg(query, links) {
  const orgIds = [...new Set(links.map(l => l.org_id))], ids = links.map(l => l.donor_id);
  if (!orgIds.length) return new Map();
  const orgs = await query(`SELECT id, timezone, vocabulary_json FROM orgs WHERE id = ANY(?::text[])`, [orgIds]);
  const spans = orgs.map(o => ({ id: o.id, ...FY.fiscalYearToDate(o) }));
  const [life, ytd] = await Promise.all([
    query(`SELECT d.org_id, COALESCE(SUM(${LIFETIME("d")}), 0) AS lifetime, MAX(${LAST_DATE("d")}) AS last
             FROM donors d WHERE d.org_id = ANY(?::text[]) AND d.id = ANY(?::text[]) AND ${LIVE("d")} GROUP BY d.org_id`, [orgIds, ids]),
    query(`SELECT g.org_id, COALESCE(SUM(g.amount), 0) AS ytd
             FROM gifts g JOIN unnest(?::text[], ?::text[], ?::text[]) AS w(org, f, t) ON w.org = g.org_id
             JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND ${LIVE("d")}
            WHERE g.donor_id = ANY(?::text[]) AND ${MONEY("g")} AND g.date >= w.f AND g.date <= w.t GROUP BY g.org_id`,
      [spans.map(x => x.id), spans.map(x => x.from), spans.map(x => x.to), ids]),
  ]);
  const y = new Map(ytd.map(r => [r.org_id, num(r.ytd)]));
  return new Map(life.map(r => [r.org_id, { lifetime: num(r.lifetime), thisYear: y.get(r.org_id) || 0, last: r.last ? String(r.last).slice(0, 10) : null }]));
}

module.exports = { donorTotals, totalsByOrg };
