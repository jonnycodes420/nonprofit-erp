// server/onboard/totalsSources.js · ONBOARD-3 item 1. The rows behind each
// explanation on "Does this match your old system?". Registered into
// figureSources.js's SOURCES; each is totals.js's own filter, so the rows foot
// to the figure shown.
"use strict";
const T = require("./totals");

module.exports = function totalsSources() {
  return {
    "onb-refunds": {
      label: "Refunds in the year", measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Every refund dated ${dd(p.from)} to ${dd(p.to)}: Steward takes each off the year's giving.`,
      sql: (orgId, p) => T.SQL.refunds(orgId, p),
    },
    "onb-soft": {
      label: "Soft and matching credits in the year", measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Every soft or matching credit on a gift dated ${dd(p.from)} to ${dd(p.to)}: recognition, never money, so never in the year's giving.`,
      sql: (orgId, p) => T.SQL.soft(orgId, p),
    },
    "onb-pledges": {
      label: "Pledged in the year, not yet paid", measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Every open pledge made ${dd(p.from)} to ${dd(p.to)}, at what is still to come on it. A pledge counts as giving when it is paid.`,
      sql: (orgId, p) => T.SQL.pledges(orgId, p),
    },
    "onb-undated": {
      label: "Gifts with no date", measure: () => "sum",
      params: {},
      sentence: () => "Every gift with no date on it: it is in Lifetime, and in no year.",
      sql: (orgId) => T.SQL.undated(orgId),
    },
    // Part B: the day-30 readout (dayOne.js).
    "onb-gave-again": {
      label: "Gave again since you started", measure: () => "sum",
      params: { from: "date:required", to: "date:required" },
      sentence: (p, dd) => `Every gift dated ${dd(p.from)} to ${dd(p.to)} from someone on the day-one list (lapsed or lapsing when the totals were said to look right), refunds and credits left out.`,
      sql: (orgId, p) => require("./dayOne").SQL.gaveAgain(orgId, p),
    },
    "onb-touches": {
      label: "Calls and notes since you started", measure: () => "count",
      params: { kind: "word" },
      sentence: p => `Every ${p.kind === "call" ? "call" : p.kind === "note" ? "note or touch other than a call" : "call, note or touch"} a person at the organization logged since the totals were said to look right.`,
      sql: (orgId, p) => require("./dayOne").SQL.touches(orgId, p),
    },
  };
};
