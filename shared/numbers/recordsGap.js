// shared/numbers/recordsGap.js · FLOWS-10 item 14 (Area 5 Explore 5). WHY BILLING'S RECORDS AND
// THE DONORS TAB ARE TWO NUMBERS.
//
// Billing counts records: a person or organization with at least one gift row (PRICING-1,
// server/boot/helpers-7.js countRecords). The Donors tab counts people marked Donor
// (shared/personType.js donorOnlySql). They differ by exactly two sets of people, named here
// once so the line under Billing foots to the tab:
//   marked Donor, no gift on file        (counted on Donors, not a record)
//   a gift on file, not marked Donor or erased (a record, not on the Donors tab)
// Donors tab = records + markedNoGift − giftNotMarked.
"use strict";
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests
const { donorOnlySql } = require("../personType.js");

const LIVE = (d = "d") => `${d}.deleted_at IS NULL AND ${d}.erased_at IS NULL`;
const HAS_GIFT_ROW = (d = "d") => `EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = ${d}.id AND g.org_id = ${d}.org_id)`;
// On the Donors tab and not a record: live, marked Donor, no gift row.
const MARKED_NO_GIFT = (d = "d") => `(${d}.erased_at IS NULL AND ${donorOnlySql(d)} AND NOT ${HAS_GIFT_ROW(d)})`;
// A record and not on the Donors tab: Records counts every person with a gift who is not deleted,
// erased ones too (countRecords), so this is a gift row and either not marked Donor or erased.
// FLOWS-10 re-check on staging: an erased giver made the line foot one short (1,124 + 66 − 1 ≠ 1,188).
const GIFT_NOT_MARKED = (d = "d") => `(${HAS_GIFT_ROW(d)} AND (${d}.erased_at IS NOT NULL OR NOT ${donorOnlySql(d)}))`;

// One pass: both sets, as counts, over the people Records reads (not deleted).
const countsSql = () => `SELECT COUNT(*) FILTER (WHERE ${MARKED_NO_GIFT("d")})::int AS marked_no_gift,
                                COUNT(*) FILTER (WHERE ${GIFT_NOT_MARKED("d")})::int AS gift_not_marked
                           FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL`;

const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
// The line under Billing's Records. Empty when the two numbers agree.
function gapSentence({ markedNoGift = 0, giftNotMarked = 0 } = {}) {
  if (PLANT === "nogap") return "";
  const parts = [];
  if (markedNoGift) parts.push(`${plural(markedNoGift, "person is", "people are")} marked Donor but ${markedNoGift === 1 ? "has" : "have"} no gift on file, so the Donors tab counts them and Records does not`);
  if (giftNotMarked) parts.push(`${plural(giftNotMarked, "person has", "people have")} a gift on file but ${giftNotMarked === 1 ? "is" : "are"} not on the Donors tab (not marked Donor, or erased for privacy), so Records counts them and the Donors tab does not`);
  return parts.length ? parts.join("; ") + "." : "";
}

// Rows for the figure drawer: the people marked Donor with no gift on file.
function markedNoGiftRowsSql(orgId) {
  return {
    sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, LEFT(d.created_at::text, 10) AS date, NULL::numeric AS amount,
                 'Marked Donor, no gift on file' AS detail
            FROM donors d WHERE d.org_id = ? AND ${LIVE("d")} AND ${MARKED_NO_GIFT("d")}`,
    args: [orgId],
    order: "name, id",
  };
}

module.exports = { MARKED_NO_GIFT, GIFT_NOT_MARKED, HAS_GIFT_ROW, countsSql, gapSentence, markedNoGiftRowsSql,
  MARKED_NO_GIFT_SENTENCE: "People marked Donor who have no gift on file. The Donors tab counts them; Billing's Records does not, because a record is a person or organization with at least one gift." };
