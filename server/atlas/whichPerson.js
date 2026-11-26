// server/atlas/whichPerson.js · ATLAS-12 item 2. A NAME THAT MATCHES TWO PEOPLE ASKS WHICH.
//
// Jarvis (26 Nov, prod): "'How much did Atkinson give?' silently merges two
// different Atkinson givers into $54,807 with no disambiguation." A giving
// question names people; a surname or part of a name that matches more than
// one person is a question back, with each one's lifetime in the sentence:
//   "Two people match: Ada Lindqvist ($150) and Gwen Lindqvist ($100). Which one?"
// one button each, and one more ("Both", "All three") that adds them together.
// Nothing is summed until she presses that one.
"use strict";

const ALL = "__all";   // the option id that means every person the name matched
const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
const usd = c => require("../../money").formatCentsPlain(Math.round(Number(c) || 0));
const listed = xs => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// The question for a giving answer. `options` from personOptions (id, name, lifetimeCents, detail); `more` how many past the shown.
function givingQuestion(qid, said, options, { more = 0, nearMiss = false } = {}) {
  const n = options.length + more;
  const who = options.map(o => `${o.name} (${usd(o.lifetimeCents)})`);
  const lead = more > 0 ? `${n} people match "${said}". The first ${options.length}: ${listed(who)}.` : `${WORDS[n] || n} people match: ${listed(who)}.`;
  const opts = [...options];
  if (!more && options.length >= 2 && options.length <= 8) {
    // No combined figure on the button: nothing is summed before she asks for it (TRUTH-3).
    opts.push({ id: ALL, name: options.length === 2 ? "Both" : `All ${WORDS[options.length].toLowerCase()}`, detail: "Add their giving together" });
  }
  return { id: qid, kind: "person", said, sentence: `${lead} Which one?`, options: opts, more, nearMiss, sums: true };
}

// The people her answer picked: one id, or every matched id when she pressed Both.
function picked(answer, options) {
  if (answer === ALL) return (options || []).map(o => o.id);
  return (options || []).some(o => o.id === answer) ? [answer] : null;
}

module.exports = { ALL, givingQuestion, picked };
