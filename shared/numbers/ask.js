// shared/numbers/ask.js · NUMBERS-4. THE SUGGESTED ASK, ONE RULE.
//
// MAP-1 §2.10 found the profile's Suggested ask (engagement.suggestedAsk) and
// six more rules on the Insights cards (last December, last gift, first gift,
// 1.5 times the last 12 months, the usual gift, half to all of last year), so
// Home could ask one amount and the profile another for the same person. Now
// every suggested ask is this one:
//   the larger of their largest gift and the average of their last three,
//   rounded to a natural amount (smartAmounts.naturalAskCents), and one
//   friendly step up when the last three are rising (held at their own level
//   when Room to give is not yet known; the profile says so).
// Gifts are gifts (money.js): a refund or a soft or matching credit row never
// sets "largest" (MAP-1 found a $10,000 soft credit could). What is NOT a
// suggested ask keeps its own amount, said as such: a sponsorship renewal is
// the level's price, a pledge is collected as promised, Planned asks nothing.
// The rule's arithmetic is shared/smartAmounts.js suggestedAskCents (an ES
// module, so it is loaded once: `await ask.ready`).
//
// NUMBERS-5: the step up is the profile's rule everywhere. A rising donor steps
// up a rung only when Room to give is known (shared/roomToGive.js); until then
// they are held at their own level, and the ask says so. Home's cards stepped
// up regardless (3 of 93 moves on real-shaped asked more on Home than on the
// profile); they read roomKnown() and askFor's roomKnown now.
"use strict";
const { GIFT, isMoney, centsOf } = require("./money");
const { LAST_GIFT_ORDER } = require("./lastGift");

let SA = null;
const ready = import("../smartAmounts.js").then(m => { SA = m; return m; });

const RULE = "Every suggested ask is one rule: the larger of their largest gift and the average of their last three, rounded to a natural amount, one step up when their giving is rising.";

// One person's gifts, newest first, for the rule. `?` org, `?` person.
const GIFTS_SQL = `SELECT LEFT(g.date, 10) AS date, g.amount::text AS amount, g.type FROM gifts g
   WHERE g.org_id = ? AND g.donor_id = ? AND ${GIFT("g")} ORDER BY ${LAST_GIFT_ORDER}`;

// The rule's two inputs from gift rows ({ date, amount|cents|amount_cents, type? }).
function inputsOf(rows) {
  const gifts = (rows || []).map(r => ({ date: r.date ? String(r.date).slice(0, 10) : "", cents: r.amount_cents != null ? Math.round(Number(r.amount_cents)) : centsOf(r), type: r.type }))
    .filter(g => g.cents > 0 && isMoney({ type: g.type }));
  gifts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // Gifts on one day are not a trend: the three are the newest, and within a
  // day they are compared smallest first, so one day never reads as "rising"
  // (four gifts on 21 Oct, the largest first, stepped an ask up a rung).
  const three = gifts.slice(0, 3).sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.cents - b.cents);
  return { largestCents: gifts.reduce((m, g) => Math.max(m, g.cents), 0), lastThreeCents: three.map(g => g.cents) };
}
const HOLD_WORDS = "their own level, because Room to give is not yet known";

// The ask for those rows: { askCents, sentence, largestCents, avgLastThreeCents, rising, held } or null.
// `roomKnown` false holds a rising donor at their own level.
function askFor(rows, { roomKnown = false } = {}) {
  if (!SA) throw new Error("shared/numbers/ask: await ask.ready first");
  return SA.suggestedAskCents({ ...inputsOf(rows), stepUp: !!roomKnown, holdWords: HOLD_WORDS });
}
// Whether the rule would step this person up (their last three rising), from their gift rows.
function rising(rows) {
  if (!SA) throw new Error("shared/numbers/ask: await ask.ready first");
  const a = SA.suggestedAskCents(inputsOf(rows));
  return !!(a && a.rising);
}
// The people among `ids` whose Room to give is known: Set of ids. `screenings`
// (id -> the latest screening) only for a viewer who may see it, as the profile.
async function roomKnown(q, orgId, ids, screenings = new Map()) {
  if (!ids || !ids.length) return new Set();
  const P = require("../../prospect");
  const RT = await import("../roomToGive.js");
  const facts = await P.loadFacts(orgId, ids, q);
  return new Set(ids.filter(id => { const f = facts.get(id); return !!f && RT.assess({ ...f, screening: screenings.get(id) || null }).word !== "unknown"; }));
}
const natural = cents => { if (!SA) throw new Error("shared/numbers/ask: await ask.ready first"); return SA.naturalAskCents(cents); };

module.exports = { ready, RULE, HOLD_WORDS, GIFTS_SQL, inputsOf, askFor, rising, roomKnown, natural };
