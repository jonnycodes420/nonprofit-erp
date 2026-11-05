// shared/numbers/retentionFigures.js · INSIGHTS-2. THE RETENTION REPORT'S
// FIGURES AS ONE STATEMENT (server/reports/retentionFigures.js runs it and
// makes the values).
//
// Each person's gifts are read once and aggregated per year window, with
// exactly the conditions figureSources' retention-window-prior and
// retention-window-kept write: money rows in the window, a gift above zero to
// count, the window's money rounded per person; "gave again" a gift in the
// earlier window; "first year" the person's first gift date (firstGift.js
// FIRST_DATE, as the gift pass's own aggregate). Per window j the row carries
// prior_n, prior_c (cents), prior_first_n, kept_n, kept_c, kept_first_n.
"use strict";
const NMONEY = require("./money");
const FG = require("./firstGift");

// windows: [{ from1, to1, from0, to0 }] (the earlier window, then the later).
function retentionSql(orgId, windows) {
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
  return { sql: `WITH per AS (${per}) SELECT ${cols.join(", ")} FROM per`, args };
}

module.exports = { retentionSql };
