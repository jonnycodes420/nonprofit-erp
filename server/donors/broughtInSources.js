// server/donors/broughtInSources.js · CONNECT-1. THE ROWS BEHIND "BROUGHT IN".
// Registered into figureSources.js's SOURCES, so the connector's line on the
// profile ("Brought in 4 people · $12,400 given since") opens through
// /figures/:key/rows like every other number. The rule and the SQL are
// shared/numbers/broughtIn.js's; the value is the rows' own count or sum.
"use strict";
const BI = require("../../shared/numbers/broughtIn");

module.exports = function broughtInSources() {
  return {
    "brought-in-people": {
      label: "People brought in",
      measure: () => "count",
      params: { donor: "id:required" },
      sentence: () => BI.PEOPLE_SENTENCE,
      sql: (orgId, p) => BI.peopleRowsSql(orgId, p.donor),
    },
    "brought-in-gifts": {
      label: "Given since they came in",
      measure: () => "sum",
      params: { donor: "id:required" },
      sentence: () => BI.GIFTS_SENTENCE,
      sql: (orgId, p) => BI.giftRowsSql(orgId, p.donor),
    },
  };
};
