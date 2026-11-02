// shared/numbers/pledges.js · NUMBERS-4. WHAT A PLEDGE HAS BEEN PAID, ONCE.
//
// A pledge is paid by gifts linked to it (gifts.pledge_id), and a gift is
// money (money.js): a soft or matching credit row linked to a pledge is
// recognition and pays nothing; a refund of a payment comes off. About twenty
// places wrote their own "paid" (docs/architecture/money-sums.md), every one
// counting credit rows. They read these two fragments now. (Due and overdue
// come from pledge_installments, figureSources.pledgesDueSql.)
"use strict";
const { MONEY } = require("./money");

// Each pledge's paid, as a joinable set: (pledge_id, paid). One `?`: the org.
const PAID_BY_PLEDGE = `(SELECT ppg.pledge_id, SUM(ppg.amount) AS paid FROM gifts ppg
    WHERE ppg.org_id = ? AND ppg.pledge_id IS NOT NULL AND ${MONEY("ppg")} GROUP BY ppg.pledge_id)`;
// Pledge `p`'s paid, correlated (no placeholders).
const PAID_OF = (p = "p") => `(SELECT COALESCE(SUM(ppg.amount), 0) FROM gifts ppg
    WHERE ppg.pledge_id = ${p}.id AND ppg.org_id = ${p}.org_id AND ${MONEY("ppg")})`;

module.exports = { PAID_BY_PLEDGE, PAID_OF };
