// server/reports/bookkeeperFund.js · MOPUP-3 item 5. THE BOOKKEEPER'S FUND FILTER READS FUND LINES.
//
// The bookkeeper report's fund filter read `gifts.fund_id`, which for a split
// gift is only its largest line (GIFTS-2). Filtered to General, a $500 gift
// given $300 Food Pantry / $200 General was missing; filtered to Food Pantry it
// came out as $300 of a $500 row. Now a gift is in when any of its fund rows
// (shared/numbers/fundLines.js GIFT_FUND_ROWS: its lines, or itself when it has
// none) is on the fund, and the file keeps only that fund's rows.
//
// FUND_HIT: the gift has a row on the fund (one `?`, the fund id).
// FUND_CENTS: the cents of the gift's rows on that fund, the database's own
// answer the file is footed against (one `?`, the fund id).
"use strict";
const { GIFT_FUND_ROWS } = require("../../shared/numbers/fundLines");

const FUND_HIT = (g = "g") => `EXISTS (SELECT 1 FROM ${GIFT_FUND_ROWS(g)} bf WHERE bf.fund_id = ?)`;
const FUND_CENTS = (g = "g") => `(SELECT SUM(bf.amount * 100) FROM ${GIFT_FUND_ROWS(g)} bf WHERE bf.fund_id = ?)`;

module.exports = { FUND_HIT, FUND_CENTS };
