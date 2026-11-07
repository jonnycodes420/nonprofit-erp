// server/reports/yoySources.js · HISTORY-1. THE ROWS BEHIND "BY YEAR" AND
// "YEAR OVER YEAR". Registered into figureSources.js's SOURCES, so each figure
// on those two views opens through /figures/:key/rows like every other number.
// The rules are shared/numbers/byYear.js's; each source here is the same
// filter over one year, so the rows foot to the figure.
"use strict";
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
        return BY.donorYearSql(orgId, p);
      },
    },
    // One person's soft credit dated in a span: someone else's gift credited
    // to them, and their own soft or matching credit rows. Never in a total.
    "donor-year-soft": {
      label: "Soft credit in the year",
      measure: () => "sum",
      params: { donor: "id:required", from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Gifts dated ${dd(p.from)} to ${dd(p.to)} this person is credited with but did not give themselves: someone else's gift credited to them, and soft or matching credit records. Never added to the year's total.`,
      sql: (orgId, p) => BY.donorSoftYearSql(orgId, p),
    },
    // The org's largest single gift in a span (the `gifts` source's rows, the top one).
    "year-largest": {
      label: "Largest gift",
      measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `The largest single gift dated ${dd(p.from)} to ${dd(p.to)}, soft and matching credits left out.`,
      sql: (orgId, p) => BY.yearLargestSql(orgId, p),
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
