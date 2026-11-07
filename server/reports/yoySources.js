// server/reports/yoySources.js · HISTORY-1. THE ROWS BEHIND "BY YEAR" AND
// "YEAR OVER YEAR". Registered into figureSources.js's SOURCES, so each figure
// on those two views opens through /figures/:key/rows like every other number.
// The rules are shared/numbers/byYear.js's; each source here is the same
// filter over one year, so the rows foot to the figure.
"use strict";
const { MONEY } = require("../../shared/numbers/money");
const { AFTER_IMPORT } = require("../../shared/numbers/lifetime");
const { NOT_CREDIT, IS_CREDIT } = require("../../creditTypes");
const BY = require("../../shared/numbers/byYear");

const KINDS = ["all", "new", "retained", "reactivated"];

module.exports = function yoySources({ FigureParamError }) {
  return {
    // One person's money in a span of their Lifetime: every money row the
    // imported total does not already cover. `largest` keeps only the largest
    // gift; `undated` only the gifts with no date.
    "donor-year": {
      label: "Given in the year",
      measure: p => (p.measure === "count" ? "count" : "sum"),
      params: { donor: "id:required", from: "date", to: "date", undated: "bool", largest: "bool", measure: "measure" },
      sentence: (p, dd) => `${p.largest ? "The largest single gift" : p.measure === "count" ? "Every gift" : "Every gift"} this person gave${p.undated ? " with no date on it" : p.from && p.to ? ` dated ${dd(p.from)} to ${dd(p.to)}` : p.from ? ` dated after ${dd(p.from)}` : p.to ? ` dated up to ${dd(p.to)}` : ""}, a refund taken off, soft and matching credits left out. A gift already inside a total stated in an import is in that total, not here.`,
      sql: (orgId, p) => {
        if (p.measure && !["sum", "count"].includes(p.measure)) throw new FigureParamError("measure is sum or count.");
        const args = [orgId, p.donor];
        let span = "";
        if (p.undated) span += " AND (g.date IS NULL OR g.date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')";
        else {
          span += " AND g.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'";
          if (p.from) { span += " AND LEFT(g.date, 10) >= ?"; args.push(p.from); }
          if (p.to) { span += " AND LEFT(g.date, 10) <= ?"; args.push(p.to); }
        }
        if (p.largest) span += " AND g.amount > 0";
        const inner = `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(f.name, 'Unrestricted') AS name, g.date,
                              ROUND(g.amount::numeric, 2) AS amount, COALESCE(NULLIF(g.payment_method, ''), INITCAP(NULLIF(g.type, ''))) AS detail
                         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                         LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
                        WHERE g.org_id = ? AND g.donor_id = ? AND d.deleted_at IS NULL AND ${MONEY("g")} AND ${AFTER_IMPORT("g", "d")}${span}`;
        return {
          sql: p.largest ? `SELECT * FROM (${inner}) t ORDER BY amount DESC, date DESC NULLS LAST, id LIMIT 1` : inner,
          args, order: p.largest ? "amount DESC, id" : undefined,
        };
      },
    },
    // One person's soft credit dated in a span: someone else's gift credited
    // to them, and their own soft or matching credit rows. Never in a total.
    "donor-year-soft": {
      label: "Soft credit in the year",
      measure: () => "sum",
      params: { donor: "id:required", from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Gifts dated ${dd(p.from)} to ${dd(p.to)} this person is credited with but did not give themselves: someone else's gift credited to them, and soft or matching credit records. Never added to the year's total.`,
      sql: (orgId, p) => ({
        sql: `SELECT sc.id, 'soft_credit' AS type, g.donor_id, COALESCE(gd.name, 'Someone no longer in Steward') AS name, g.date,
                     ROUND(sc.amount::numeric, 2) AS amount, 'Credited from their gift' AS detail
                FROM gift_soft_credits sc
                JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
                JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id AND d.deleted_at IS NULL
                LEFT JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
               WHERE sc.org_id = ? AND sc.donor_id = ? AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?
              UNION ALL
              SELECT g.id, 'gift', g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2), INITCAP(TRIM(g.type))
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
               WHERE g.org_id = ? AND g.donor_id = ? AND ${IS_CREDIT("g")} AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?`,
        args: [orgId, p.donor, p.from, p.to, orgId, p.donor, p.from, p.to],
        order: "date DESC NULLS LAST, id",
      }),
    },
    // The org's largest single gift in a span (the `gifts` source's rows, the top one).
    "year-largest": {
      label: "Largest gift",
      measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `The largest single gift dated ${dd(p.from)} to ${dd(p.to)}, soft and matching credits left out.`,
      sql: (orgId, p) => ({
        sql: `SELECT * FROM (SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     COALESCE(f.name, 'Unrestricted') AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND g.amount > 0
               ORDER BY g.amount DESC, g.date DESC, g.id LIMIT 1) t`,
        args: [orgId, p.from, p.to],
        order: "amount DESC, id",
      }),
    },
    // The people who gave in a span, all of them or one of the three kinds
    // (shared/numbers/byYear.js donorKindsSql). pfrom..pto is the year before.
    "yoy-donors": {
      label: "Donors",
      measure: p => p.measure || "count",
      params: { from: "date:required", to: "date:required", pfrom: "date:required", pto: "date:required", kind: "word", measure: "measure" },
      sentence: (p, dd) => {
        const k = p.kind || "all";
        const who = k === "new" ? "whose first gift ever is" : k === "retained" ? `who also gave ${dd(p.pfrom)} to ${dd(p.pto)}, with a gift` : k === "reactivated" ? `who had given before but not ${dd(p.pfrom)} to ${dd(p.pto)}, with a gift` : "with at least one gift";
        return `Each person ${who} dated ${dd(p.from)} to ${dd(p.to)}, with what they gave in that time.`;
      },
      sql: (orgId, p) => {
        const kind = p.kind || "all";
        if (!KINDS.includes(kind)) throw new FigureParamError("kind is all, new, retained or reactivated.");
        const k = BY.donorKindsSql(orgId, [{ k: "y", f: p.from, t: p.to, pf: p.pfrom, pt: p.pto }]);
        return {
          sql: `SELECT x.id, x.type, x.donor_id, x.name, x.date, x.amount,
                       CASE x.kind WHEN 'new' THEN '${BY.KIND_WORDS.new}' WHEN 'retained' THEN '${BY.KIND_WORDS.retained}' ELSE '${BY.KIND_WORDS.reactivated}' END AS detail
                  FROM (${k.sql}) x${kind === "all" ? "" : " WHERE x.kind = ?"}`,
          args: kind === "all" ? k.args : [...k.args, kind],
          order: "amount DESC, id",
        };
      },
    },
    // Retention for a year: of the people who gave the year before, the share
    // who gave in this one.
    "yoy-retention": {
      label: "Retention",
      ratio: "share",
      params: { from: "date:required", to: "date:required", pfrom: "date:required", pto: "date:required" },
      sentence: (p, dd) => `Of the people who gave ${dd(p.pfrom)} to ${dd(p.pto)}, the share who gave again ${dd(p.from)} to ${dd(p.to)}.`,
      parts: p => [
        { role: "numerator", label: "Gave again", key: "yoy-donors", params: { ...p, kind: "retained" } },
        { role: "denominator", label: "Gave the year before", key: "yoy-donors", params: { from: p.pfrom, to: p.pto, pfrom: p.pfrom, pto: p.pto, kind: "all" } },
      ],
    },
  };
};
