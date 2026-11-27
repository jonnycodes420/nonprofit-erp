// server/outreach/thanksSources.js · NUMBERS-10 item 2 (W-1125-Finance-T7). THE GIFTS OLDER THAN THE THANK-YOU WINDOW.
//
// The fleet read Reports' Acknowledgment backlog at 846 gifts back to Oct 2024 beside Home's 118 since
// Apr 22, 2025. The backlog is one window (Home's, reportHooks.thanksSince) and one rule
// (shared/numbers/thankBacklog.js WAITING). What still waits from before the window is a separate,
// labelled figure, "Older than the window", that opens its own rows, and never part of the backlog.
"use strict";
const TB = require("../../shared/numbers/thankBacklog");

module.exports = () => ({
  "unthanked-before": {
    label: "Older than the window, not yet thanked",
    measure: p => (p.measure === "sum" ? "sum" : "count"),
    params: { before: "date:required", measure: "measure" },
    sentence: (p, dd) => `Every gift dated before ${dd(p.before)}, the day the thank-you window opens, with no thank-you logged. They are older than the window Home and the Acknowledgment backlog count, so neither counts them. A refund, a gift refunded in full, and sample data wait for no thanks.`,
    sql: (orgId, p) => TB.OLDER_ROWS(orgId, p.before),
  },
});
