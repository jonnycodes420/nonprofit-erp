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
const { MONEY, LIVE, GIFT } = require("../../shared/numbers/money");
const { GIFT_FUND_ROWS } = require("../../shared/numbers/fundLines");
const DF = require("../../shared/numbers/defaultFund");
const { LEDGER_FUND_ROWS } = require("../../shared/numbers/fundLines");
const { GAP_ROWS } = require("../../shared/numbers/fundGap");

const AG = require("../../shared/numbers/allGifts");
const STATUSES = ["posted", "waiting", "history"];

module.exports = function ledgerSources({ FigureParamError }) {
  return {
    "ledger-status": {
      label: "Gifts and the books",
      measure: p => (p.measure === "count" ? "count" : "sum"),
      // LEDGER-3: `fund` narrows it to one fund's gifts (a split gift is its line;
      // a gift with no fund waits on the default fund, where it will post).
      params: { status: "word:required", measure: "measure", fund: "id" },
      sentence: p => (LS.SENTENCES[p.status] || "Gifts and where they stand with the books.") + (p.fund ? " Only the gifts to this fund." : ""),
      sql: async (orgId, p) => {
        if (!STATUSES.includes(p.status)) throw new FigureParamError("status is posted, waiting or history.");
        if (p.measure && !["sum", "count"].includes(p.measure)) throw new FigureParamError("measure is sum or count.");
        const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
        const fyFrom = FY.fiscalYearToDate(org || {}).from;
        if (p.fund) {
          const defaultId = await DF.defaultFundId(query, orgId);
          return {
            sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(gf.amount::numeric, 2) AS amount,
                         COALESCE(f.name, 'No fund (posts to the default fund)') AS detail
                    FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                    JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
                    LEFT JOIN fin_funds f ON f.id = gf.fund_id AND f.org_id = g.org_id
                   WHERE ${LS.STATUS("g")} = ? AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}${p.measure === "count" ? ` AND ${GIFT("g")}` : ""}
                     AND COALESCE(gf.fund_id, ?::text) = ?`,
            args: [fyFrom, p.status, orgId, defaultId, p.fund],
          };
        }
        return {
          sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                       COALESCE(f.name, 'No fund') AS detail
                  FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                  LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
                 WHERE ${LS.STATUS("g")} = ? AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}${p.measure === "count" ? ` AND ${GIFT("g")}` : ""}`,
          args: [fyFrom, p.status, orgId],
        };
      },
    },
    // POLISH-14 item 3: Reports' All time and Finance's gifts on file are one
    // figure (shared/numbers/allGifts.js): every gift, dated or not.
    "gifts-all": {
      label: "Every gift on file",
      measure: p => (p.measure === "count" ? "count" : "sum"),
      params: { measure: "measure" },
      sentence: () => AG.SENTENCE + " A gift with no date is in it, and in no year's total.",
      sql: async (orgId, p) => ({
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     CASE WHEN ${AG.UNDATED("g")} THEN 'No date on the gift' WHEN g.amount < 0 THEN 'Refund' ELSE COALESCE(f.name, 'Unrestricted') END AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND ${AG.ALL("g", "d")}${p.measure === "count" ? ` AND ${GIFT("g")}` : ""}`,
        args: [orgId],
      }),
    },
    // NUMBERS-9 item 1: the rows behind each line that says why a fund's gifts on the books and its
    // transactions in differ (shared/numbers/fundGap.js). A gift's row is the gift less its ledger row;
    // a hand-entered income row is itself.
    "fund-books-gap": {
      label: "Gifts on the books beside transactions in",
      measure: () => "sum",
      params: { fund: "id:required", kind: "word:required" },
      sentence: p => ({ fee: "Gifts whose donor covered the card fee: the gift is the charge, its ledger row was posted before the fee. Each row is the gift less its row.",
        other: "Gifts whose ledger row differs from the gift: changed after it posted, or posted to another fund. Each row is the gift less its row.",
        manual: "Income rows on this fund entered by hand: they are in transactions in and are no gift's." }[p.kind] || "Why gifts on the books and transactions in differ."),
      sql: async (orgId, p) => {
        if (!["fee", "other", "manual"].includes(p.kind)) throw new FigureParamError("kind is fee, other or manual.");
        const defaultId = await DF.defaultFundId(query, orgId);
        if (p.kind === "manual") {
          return {
            sql: `SELECT ft.id, 'transaction' AS type, ft.donor_id, COALESCE(NULLIF(ft.vendor_donor, ''), ft.description) AS name, ft.date,
                         ROUND(ft.amount::numeric, 2) AS amount, ft.description AS detail
                    FROM ${LEDGER_FUND_ROWS()} ft WHERE ft.type = 'income' AND ft.gift_id IS NULL AND ft.fund_id = ?`,
            args: [orgId, orgId, p.fund],
          };
        }
        return {
          sql: `SELECT x.gift_id AS id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND((x.gift_cents - x.row_cents) / 100.0, 2) AS amount,
                       'Gift ' || TO_CHAR(x.gift_cents / 100.0, 'FM$999,999,990.00') || ', ledger row ' || TO_CHAR(x.row_cents / 100.0, 'FM$999,999,990.00') AS detail
                  FROM ${GAP_ROWS()} x JOIN gifts g ON g.id = x.gift_id JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                 WHERE x.fund_id = ? AND x.kind = ?`,
          args: [defaultId, orgId, orgId, orgId, p.fund, p.kind],
        };
      },
    },
  };
};
