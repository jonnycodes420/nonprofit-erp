// server/atlas/periodAnswer.js · TRUTH-5. THE PEOPLE OF AN ASK ANSWER, WITH THE PERIOD'S AMOUNTS.
//
// The query layer (askQuery.js) lists a person with `donors.total_giving`.
// Asked about a period, that read as the period's amount (W-1109-Atlas-01).
// This replaces each person's amount with what they gave in the question's
// window (shared/numbers/periodAmounts.js), keeps Lifetime beside it labeled,
// and rewrites "How Steward read this" and "Counted" from the plan that ran
// and the window read from it.
"use strict";
const PA = require("../../shared/numbers/periodAmounts");

async function periodAnswer(query, orgId, plan, a, today) {
  const pp = await PA.periodPeople(query, orgId, { plan, people: a.people, today });
  const planWords = PA.readWords(a.planWords, pp.window);
  return {
    people: pp.people,
    planWords,
    counted: `${planWords}. Steward read this from your own records and wrote nothing.`,
    // The window's whole: every person's amount above is a part of it.
    periodWhole: pp.window ? { cents: pp.wholeCents, words: pp.window.words, from: pp.window.from, to: pp.window.to } : null,
  };
}

module.exports = { periodAnswer };
