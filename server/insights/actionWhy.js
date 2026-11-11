// server/insights/actionWhy.js · FLOWS-6 (W-1110-Donors-03X). WHY THIS ACTION.
//
// Home's move button read "Draft the note" on one card and "Add to calls" on
// the next, with nothing to say why. The action comes from the move's own
// rule (insights.js actionFor): a pledge is collected, a donor moving up is
// visited, a slipping major donor gets a briefing, a legacy signal gets
// coffee, and otherwise the channel decides, a call at or over the gift size
// the card names and a note under it. This says that rule in one line, from
// the move's own facts, for the button's hover:
//   "Drafting a note because their first gift was $100, under $250. At $250 or more it would be a call."
"use strict";

// The gift each card weighs, and the size at which it calls (the `channel`
// lines in insights.js: year_end and lapsing at $1,000, second_gift and
// gave_before at $250).
const CALL_AT = {
  year_end: { at: "$1,000", fact: k => /^December \d{4}$/.test(k), words: k => `their gift in ${k}` },
  lapsing: { at: "$1,000", fact: k => k === "last gift", words: () => "their last gift" },
  second_gift: { at: "$250", fact: k => k === "first gift", words: () => "their first gift" },
  gave_before: { at: "$250", fact: k => k === "latest gift", words: () => "their latest gift" },
  drift: { at: "$1,000", fact: k => k === "usual gift", words: () => "their usual gift" },
};
const VERB = { draft: "Drafting a note", calls: "Adding them to your calls", visit: "Booking a visit", brief: "Building a briefing first",
  coffee: "Inviting them to coffee, with no ask", collect: "Collecting" };
const lower1 = s => String(s || "").replace(/^[A-Z](?![A-Z])/, c => c.toLowerCase()).replace(/\.\s*$/, "");

function actionWhy(kind, act, it) {
  const verb = VERB[act] || "This step";
  const rule = CALL_AT[kind];
  const f = rule && (it.facts || []).find(([k]) => rule.fact(String(k)));
  // gave_before also calls anyone who gave $10,000 or more before Steward
  const before = kind === "gave_before" && act === "calls" && (it.facts || []).find(([k]) => k === "given before Steward");
  if (before && f && Number(String(f[1]).replace(/[^0-9.]/g, "")) < 250)
    return `${verb} because they gave ${before[1]} before Steward: $10,000 or more before Steward gets a call.`;
  if (f && (act === "draft" || act === "calls")) {
    return act === "calls"
      ? `${verb} because ${rule.words(String(f[0]))} was ${f[1]}, ${rule.at} or more gets a call.`
      : `${verb} because ${rule.words(String(f[0]))} was ${f[1]}, under ${rule.at}. At ${rule.at} or more it would be a call.`;
  }
  if (act === "collect") return `${verb} because ${lower1(it.what)}.`;
  if (act === "visit") return `${verb} because they are moving up: ${lower1(it.what)}.`;
  if (act === "brief") return `${verb} because a major donor is behind last year: ${lower1(it.what)}.`;
  if (act === "coffee") return `${verb} because Planned never asks for money: ${lower1(it.what)}.`;
  return `${verb} because ${lower1(it.what) || "this is the move for them now"}.`;
}

module.exports = { actionWhy, CALL_AT };
