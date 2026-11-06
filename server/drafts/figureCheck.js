// server/drafts/figureCheck.js · TRUTH-2. A DRAFT'S MONEY, CHECKED AGAINST TODAY.
//
// A drafted message is checked once when it is made (draftCheck.js). Its
// words are then stored, and a gift that lands before anyone presses Send
// makes a figure in them wrong: Walk A (5 Nov) read "your giving has now
// reached $12,500" for a person whose lifetime was $21,000. This asks two
// questions again at Send, of the person as they stand now:
//   · every money figure in a sentence about giving is one of their own
//     amounts (suggestionGuard through draftCheck.js, live figures)
//   · a figure that claims a TOTAL ("you've now given", "has reached",
//     "lifetime", "in total") is their lifetime or this year's giving
//     (shared/numbers/draftFigures.js). The first rule alone let "$3,200"
//     stand as a total because one of their gifts was $3,200.
"use strict";
const DRAFT_CHECK = require("../../draftCheck");
const { draftFigures, dollars } = require("../../shared/numbers/draftFigures");
const { fiscalYearToDate } = require("../../shared/numbers/fiscalYear");
const { query } = require("../../db");

const NOT_THEIRS = / is not one of their amounts$/;
const TOTAL_WORDS = /\b(now given|have given|you've given|given (?:us )?(?:a total|in total|in all|altogether|so far|to date)|in total|in all|altogether|so far|to date|lifetime|cumulative|total(?:ling|ed)?|has (?:now )?(?:reached|passed|grown to)|now (?:reached|passed|stands at))\b/i;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

// Pure: the "$N" figures in `text` that claim a total and are neither the
// lifetime nor this year's giving (cents).
function wrongTotals(text, { lifetimeCents = 0, thisYearCents = 0 } = {}) {
  const out = [];
  for (const s of String(text || "").split(/(?<=[.!?])\s+|\n+/)) {
    if (!TOTAL_WORDS.test(s)) continue;
    for (const m of s.matchAll(MONEY)) {
      const cents = Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] || "0").padEnd(2, "0"));
      if (cents !== lifetimeCents && cents !== thisYearCents) out.push(m[0].replace(/\s/g, ""));
    }
  }
  return out;
}

// The figures in the draft that are not the person's amounts today: ["$3,200"].
async function staleFigures(orgId, draft) {
  if (!draft || !draft.donor_id) return [];
  const text = `${draft.subject || ""}\n${draft.body || ""}`;
  const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  const F = await draftFigures(query, orgId, draft.donor_id, fiscalYearToDate(org || {}));
  const rec = await DRAFT_CHECK.draftRecord(orgId, draft.donor_id);
  const chk = await DRAFT_CHECK.checkDraft(text, rec);
  const notTheirs = chk.reasons.filter(r => NOT_THEIRS.test(r)).map(r => r.replace(NOT_THEIRS, ""));
  return [...new Set([...notTheirs, ...(F ? wrongTotals(text, F) : [])])];
}

module.exports = { staleFigures, wrongTotals, dollars };
