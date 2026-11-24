// server/donors/householdSources.js · HOUSEHOLD-1. THE ROWS BEHIND A HOUSEHOLD'S
// "THIS YEAR". Registered into figureSources.js's SOURCES so a household row's
// figure (Top 100, the Donors list) opens its gifts through /figures/:key/rows.
// Lifetime opens `household-giving` (each person's Lifetime, the household
// panel's source); the rule and SQL here are shared/numbers/householdGiving.js's.
"use strict";
const HG = require("../../shared/numbers/householdGiving");

module.exports = function householdSources() {
  return {
    "household-span": {
      label: "Household given",
      measure: () => "sum",
      params: { household: "id:required", from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Every gift the people in this household gave from ${dd(p.from)} to ${dd(p.to)}, added up to the cent. Each gift stays on the person who gave it. A refund comes off; soft and matching credits are not money.`,
      sql: (orgId, p) => HG.spanRowsSql(orgId, p.household, p.from, p.to),
    },
  };
};
