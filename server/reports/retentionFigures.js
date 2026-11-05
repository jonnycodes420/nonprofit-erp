// server/reports/retentionFigures.js · INSIGHTS-2 item 3. THE RETENTION
// REPORT'S FIGURES, SET-WISE, IN ONE READ.
//
// The report shows three years, and each year's row carries seven figures
// (figureSources retention-window, -dollars, -first, and the -window-prior and
// -window-kept people behind them). Asked one at a time that was ten whole-org
// GROUP BYs over gifts per year, thirty in all, one after another: 1.7 s
// median and 7.3 s p95 under LOAD-1's load test.
//
// This is the same arithmetic over the same rows in one statement, the way
// FIX-21's groupFigureValues does the group page: each person's gifts are read
// once and aggregated per year window, with exactly the conditions the
// sources' own `sql` builders write (money rows in the window, a gift above
// zero to count, the window's money rounded per person; "gave again" a gift in
// the earlier window; "first year" the person's first gift date, the one
// FIRST_DATE). Each figure's value comes back in the shape figureValue gives,
// ratios from their parts' values as figure() makes them, so a row's numbers
// and the drawer each one opens (figure(), unchanged) still agree to the cent.
"use strict";
const { query } = require("../../db");
const FS = require("../../figureSources");
const money = require("../../money");
const NMONEY = require("../../shared/numbers/money");
const FG = require("../../shared/numbers/firstGift");

const NOTHING = "There is nothing yet to measure this against, so there is no percentage to show.";
const ratio = (a, b) => { const v = b > 0 ? Math.round((a / b) * 100) : null; return { value: v, cents: null, blank: v === null ? NOTHING : null }; };

// windows: [{ from1, to1, from0, to0 }] (the earlier window, then the later).
// Returns, per window, the seven specs reportRetention shows, each
// { value, cents, blank, source, definition } as reportFigures returns them.
async function retentionFigures(orgId, windows) {
  const spans = [];
  const at = (from, to) => { const k = `${from}|${to}`; let i = spans.findIndex(s => s.k === k); if (i < 0) { spans.push({ k, from, to }); i = spans.length - 1; } return i; };
  const plan = windows.map(w => ({ w, e: at(w.from1, w.to1), l: at(w.from0, w.to0) }));
  const args = [];
  const p = v => { args.push(v); return "?"; };
  const inSpan = s => `LEFT(g.date,10) >= ${p(s.from)} AND LEFT(g.date,10) <= ${p(s.to)}`;
  const perSpan = spans.map((s, i) => `
      BOOL_OR(${NMONEY.GIFT("g")} AND ${inSpan(s)}) AS gave${i},
      ROUND(COALESCE(SUM(g.amount) FILTER (WHERE ${NMONEY.MONEY("g")} AND ${inSpan(s)}), 0)::numeric, 2) AS amt${i}`).join(",");
  const per = `SELECT d.id, ${FG.EARLIER(FG.FIRST_ON_FILE_AGG("g"), FG.IMPORTED_FIRST("d"))} AS first,${perSpan}
      FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id = ${p(orgId)} AND d.deleted_at IS NULL GROUP BY d.id`;
  const cols = [];
  plan.forEach((x, j) => {
    // Placeholders bind in the order they appear, so each use takes its own.
    const firstIn = () => `per.first BETWEEN ${p(x.w.from1)} AND ${p(x.w.to1)}`;
    const prior = `per.gave${x.e} IS TRUE`, kept = `per.gave${x.e} IS TRUE AND per.gave${x.l} IS TRUE`;
    cols.push(`COUNT(*) FILTER (WHERE ${prior})::int AS prior_n${j}`,
      `(COALESCE(SUM(per.amt${x.e}) FILTER (WHERE ${prior}), 0) * 100)::bigint AS prior_c${j}`,
      `COUNT(*) FILTER (WHERE ${prior} AND ${firstIn()})::int AS prior_first_n${j}`,
      `COUNT(*) FILTER (WHERE ${kept})::int AS kept_n${j}`,
      `(COALESCE(SUM(per.amt${x.l}) FILTER (WHERE ${kept}), 0) * 100)::bigint AS kept_c${j}`,
      `COUNT(*) FILTER (WHERE ${kept} AND ${firstIn()})::int AS kept_first_n${j}`);
  });
  const [row] = await query(`WITH per AS (${per}) SELECT ${cols.join(", ")} FROM per`, args);
  return Promise.all(plan.map(async (x, j) => {
    const w = x.w;
    const n = k => Number(row[`${k}${j}`]) || 0;
    // Cents exactly (each person's amount is already to the cent), as figureSources' sumCents reads the total.
    const sum = k => { const c = Number(row[`${k}${j}`]) || 0; return { value: money.toDollars(c), cents: c }; };
    const priorN = n("prior_n"), keptN = n("kept_n"), priorS = sum("prior_c"), keptS = sum("kept_c");
    const vals = {
      retentionRate: [{ key: "retention-window", params: w }, ratio(keptN, priorN)],
      dollarRetentionRate: [{ key: "retention-dollars", params: w }, ratio(keptS.value, priorS.value)],
      firstYearRetentionRate: [{ key: "retention-first", params: w }, ratio(n("kept_first_n"), n("prior_first_n"))],
      priorDonors: [{ key: "retention-window-prior", params: { from1: w.from1, to1: w.to1 } }, { value: priorN, cents: null, blank: null }],
      retainedDonors: [{ key: "retention-window-kept", params: w }, { value: keptN, cents: null, blank: null }],
      priorDollars: [{ key: "retention-window-prior", params: { from1: w.from1, to1: w.to1, measure: "sum" } }, { ...priorS, blank: null }],
      firstYearDonors: [{ key: "retention-window-prior", params: { from1: w.from1, to1: w.to1, firstYear: true } }, { value: n("prior_first_n"), cents: null, blank: null }],
    };
    const keys = Object.keys(vals);
    const defs = await Promise.all(keys.map(k => FS.figureSentence(vals[k][0])));
    return Object.fromEntries(keys.map((k, i) => [k, { ...vals[k][1], source: vals[k][0], definition: defs[i] }]));
  }));
}

module.exports = { retentionFigures };
