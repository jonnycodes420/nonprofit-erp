// FIX-49 · SOFT AND MATCHING CREDITS ARE NOT MONEY, said once.
//
// Jonathan, 25 Oct: a soft or matching credit is never in Lifetime, a campaign
// total, a goal total or an average. It is shown as its own "Soft credit"
// figure, with the gifts behind it. A gift row typed as one of these is a
// credit record, not money the organization received; the bookkeeper's file
// has always left them out (BUILD-87 Part 4). No requires, so donorSummary.js,
// campaignMatch.js and figureSources.js can all load it.
const CREDIT_TYPES = ["soft credit", "soft-credit", "soft_credit",
  "matching gift credit", "matched gift credit", "hard credit reversal"];

const LIST = CREDIT_TYPES.map(t => `'${t}'`).join(", ");
// The SQL that says gift row `g` is real money (not a credit row).
const NOT_CREDIT = (g = "g") => `LOWER(TRIM(COALESCE(${g}.type, ''))) NOT IN (${LIST})`;
const IS_CREDIT = (g = "g") => `LOWER(TRIM(COALESCE(${g}.type, ''))) IN (${LIST})`;
const isCredit = type => CREDIT_TYPES.includes(String(type || "").trim().toLowerCase());

module.exports = { CREDIT_TYPES, NOT_CREDIT, IS_CREDIT, isCredit };
