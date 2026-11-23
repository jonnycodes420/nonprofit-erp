// shared/numbers/recordsGap.js · FLOWS-10 item 14, FLOWS-15 item 5 (W-1116-Atlas-24X). WHY
// BILLING'S RECORDS AND THE DONORS TAB ARE TWO NUMBERS, AS A SUM THAT FOOTS.
//
// Billing counts records: a person or organization with at least one gift row, not deleted
// (PRICING-1, server/boot/helpers-7.js countRecords; erased and archived givers count, and so does
// someone whose only gift was refunded: the row is there). The Donors tab counts Everyone's people
// marked Donor (shared/numbers/everyoneBreakdown.js: not in the trash, archived or erased, with
// shared/personType.js's donor rule). They differ by the people named here, every part of it:
//   plus  marked Donor, on the Donors tab, no gift on file   (on the tab, not a record)
//   minus erased givers whose gifts remain                    (a record, not on the tab)
//   minus archived givers                                     (a record, not on the tab)
//   minus givers not marked Donor                             (a record, not on the tab)
// Records + plus − minuses = the Donors tab, by construction: each person with a gift row is in
// exactly one of "on the tab", erased, archived, not marked; each person on the tab has a gift row
// or is the plus.
//
// DEFINE-1 item 4: the Donors tab is who has GIVEN (shared/numbers/isDonor.js IS_DONOR, the stored
// totals), not who is marked Donor. So the plus is now people whose giving is an imported history
// total with no gift row in Steward, and the last minus is people whose gift rows add to nothing
// ($0 or refunded only). A person marked Donor who never gave is on neither side: not a record, not
// on the tab. The keys (markedNoGift, unmarkedGivers) are kept so Billing's band and the figure read on.
//
// Why FLOWS-10's line missed: it read the Donors tab as "not deleted, not erased, marked Donor",
// which counts ARCHIVED people the tab leaves out, and its own test pinned that same wrong rule.
// Its plus counted archived people with no gift and its minus never counted archived givers, so it
// footed only in an org with nobody archived. And it said the parts in two long clauses with no
// sum, so a reader adding the first one ("1,122 plus 66 is 1,188") had no way to see the minus.
"use strict";
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // tests plant defects here; never set outside tests
const { IS_DONOR } = require("./isDonor");   // FLOWS-18: the Donors tab's one rule
const donorOnlySql = d => IS_DONOR(d);
const { EVERYONE } = require("./everyone");

const HAS_GIFT_ROW = (d = "d") => `EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = ${d}.id AND g.org_id = ${d}.org_id)`;
const ON_DONORS_TAB = (d = "d") => `(${EVERYONE(d)} AND ${donorOnlySql(d)})`;
// On the Donors tab and not a record.
const MARKED_NO_GIFT = (d = "d") => `(${ON_DONORS_TAB(d)} AND NOT ${HAS_GIFT_ROW(d)})`;
// A record and not on the Donors tab, each in one place: erased, else archived, else not marked Donor.
const ERASED_GIVER = (d = "d") => `(${HAS_GIFT_ROW(d)} AND ${d}.erased_at IS NOT NULL)`;
const ARCHIVED_GIVER = (d = "d") => `(${HAS_GIFT_ROW(d)} AND ${d}.erased_at IS NULL AND ${d}.archived_at IS NOT NULL)`;
const UNMARKED_GIVER = (d = "d") => `(${HAS_GIFT_ROW(d)} AND ${d}.erased_at IS NULL AND ${d}.archived_at IS NULL AND NOT ${donorOnlySql(d)})`;
const GIFT_NOT_MARKED = (d = "d") => `(${HAS_GIFT_ROW(d)} AND NOT ${ON_DONORS_TAB(d)})`;

// One pass over the people Records reads (not deleted): both totals and every part.
const countsSql = () => `SELECT COUNT(*) FILTER (WHERE ${HAS_GIFT_ROW("d")})::int AS records,
                                COUNT(*) FILTER (WHERE ${ON_DONORS_TAB("d")})::int AS donors_tab,
                                COUNT(*) FILTER (WHERE ${MARKED_NO_GIFT("d")})::int AS marked_no_gift,
                                COUNT(*) FILTER (WHERE ${ERASED_GIVER("d")})::int AS erased_givers,
                                COUNT(*) FILTER (WHERE ${ARCHIVED_GIVER("d")})::int AS archived_givers,
                                COUNT(*) FILTER (WHERE ${UNMARKED_GIVER("d")})::int AS unmarked_givers
                           FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL`;

const n = x => Number(x) || 0;
// The row from countsSql, as the parts.
function gapOf(row) {
  const g = { records: n(row && row.records), donorsTab: n(row && row.donors_tab), markedNoGift: n(row && row.marked_no_gift),
    erasedGivers: n(row && row.erased_givers), archivedGivers: n(row && row.archived_givers), unmarkedGivers: n(row && row.unmarked_givers) };
  g.giftNotMarked = g.erasedGivers + g.archivedGivers + g.unmarkedGivers;
  g.foots = g.records + g.markedNoGift - g.giftNotMarked === g.donorsTab;
  return g;
}

const fmt = x => Number(x).toLocaleString("en-US");
const plural = (k, one, many) => `${fmt(k)} ${k === 1 ? one : many}`;
// The line under Billing's Records: the sum, every part named. Empty when the two numbers agree.
// "Records 1,122, plus 6 people whose giving was imported with no gift row, minus 4 erased givers
//  whose gifts remain, is the Donors tab's 1,124."
function gapSentence(g = {}) {
  if (PLANT === "nogap") return "";
  const parts = [];
  if (g.markedNoGift) parts.push(`plus ${plural(g.markedNoGift, "person", "people")} whose giving was imported with no gift row`);
  if (g.erasedGivers) parts.push(`minus ${plural(g.erasedGivers, "erased giver", "erased givers")} whose gifts remain`);
  if (g.archivedGivers) parts.push(`minus ${plural(g.archivedGivers, "archived giver", "archived givers")}`);
  if (g.unmarkedGivers) parts.push(`minus ${plural(g.unmarkedGivers, "person", "people")} whose gift rows add to nothing given`);
  if (!parts.length) return "";
  return `Records ${fmt(g.records)}, ${parts.join(", ")}, is the Donors tab's ${fmt(g.donorsTab)}.`;
}

// Rows for the figure drawer: the people on the Donors tab with no gift row (imported history only).
function markedNoGiftRowsSql(orgId) {
  return {
    sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, LEFT(d.created_at::text, 10) AS date, NULL::numeric AS amount,
                 'Imported giving, no gift row' AS detail
            FROM donors d WHERE d.org_id = ? AND ${MARKED_NO_GIFT("d")}`,
    args: [orgId],
    order: "name, id",
  };
}

module.exports = { MARKED_NO_GIFT, GIFT_NOT_MARKED, ERASED_GIVER, ARCHIVED_GIVER, UNMARKED_GIVER, ON_DONORS_TAB, HAS_GIFT_ROW,
  countsSql, gapOf, gapSentence, markedNoGiftRowsSql,
  MARKED_NO_GIFT_SENTENCE: "People whose giving came in as an imported history total, with no gift row in Steward. The Donors tab counts them, because they have given; Billing's Records does not, because a record is a person or organization with at least one gift row." };
