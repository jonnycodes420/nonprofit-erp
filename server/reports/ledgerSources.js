// server/reports/ledgerSources.js · TRUTH-3 item 6. THE LEDGER'S THREE FIGURES OPEN THEIR GIFTS.
//
// Finance's Posted, Waiting to post and History only (shared/numbers/
// ledgerStatus.js) are figures, so each opens the gifts behind it and foots
// to the cent. The status is read against the org's fiscal year (history is
// an import dated before it). A count opens counted gifts only (giftCount.js).
"use strict";
const { query } = require("../../db");
const FY = require("../../shared/numbers/fiscalYear");
const LS = require("../../shared/numbers/ledgerStatus");
const { MONEY, LIVE } = require("../../shared/numbers/money");

const STATUSES = ["posted", "waiting", "history"];

module.exports = function ledgerSources({ FigureParamError }) {
  return {
    "ledger-status": {
      label: "Gifts and the books",
      measure: p => (p.measure === "count" ? "count" : "sum"),
      params: { status: "word:required", measure: "measure" },
      sentence: p => LS.SENTENCES[p.status] || "Gifts and where they stand with the books.",
      sql: async (orgId, p) => {
        if (!STATUSES.includes(p.status)) throw new FigureParamError("status is posted, waiting or history.");
        if (p.measure && !["sum", "count"].includes(p.measure)) throw new FigureParamError("measure is sum or count.");
        const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
        const fyFrom = FY.fiscalYearToDate(org || {}).from;
        return {
          sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                       COALESCE(f.name, 'No fund') AS detail
                  FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                  LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
                 WHERE ${LS.STATUS("g")} = ? AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}${p.measure === "count" ? " AND g.amount > 0" : ""}`,
          args: [fyFrom, p.status, orgId],
        };
      },
    },
  };
};
