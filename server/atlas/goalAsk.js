// server/atlas/goalAsk.js · ATLAS-12 item 3. HOW MUCH IS LEFT ON THE GOAL, SAID AS HOME SAYS IT.
//
// Jarvis (25 Nov, a repeat): "Atlas cannot answer 'How much is left on the
// goal?' or a named-campaign follow-up, while Home shows $136,500 of $180,000
// with $43,500 left in one line." Atlas asked "Which one did you mean?" over
// every running goal even when Home's goal bar named one, and "are we on
// pace?" was a can't-answer. "And the Gala?" after a campaign answer was read
// alone, with AI off a refusal.
//
//   goalAsked   "how much is left (on the goal)", "how far are we from the goal",
//               "are we on pace", "are we on track", "how are we doing against
//               the goal": the goal she means is Home's, so the words name no
//               campaign. A name ("how much is left on the Gala") is campaignAsk's.
//   cardLine    one goal card (server/reports/helpers.js goalCard, the function
//               Home's bar draws) as one line: raised of the goal, what is left,
//               the share, the pace and the days left.
//   followUp    "and the Gala?", "what about Year-end?" after an answer about a
//               goal or campaign: asked as "How is the Gala doing?".
"use strict";

const usd = c => require("../../money").formatCentsPlain(Math.round(Number(c) || 0));
const GOAL = "(?:the |our |this year's )?(?:annual )?(?:goal|target)";
const SHAPES = [
  new RegExp(`^how much (?:is |'s )?(?:still )?(?:left|to go|remaining)(?: (?:on|to|for|until|till|toward|towards) ${GOAL})?$`),
  new RegExp(`^how much (?:more )?(?:do we|we) (?:still )?(?:need|have) (?:to raise )?(?:to (?:reach|hit|make|meet) ${GOAL})?$`),
  new RegExp(`^how (?:far|close) (?:are we|is it|we are) (?:from|to|off) ${GOAL}$`),
  new RegExp(`^(?:are|is) we (?:on|ahead of|behind) (?:pace|track|schedule)(?: (?:for|with|on|to (?:reach|hit|make)) ${GOAL})?$`),
  /^(?:are|is) we (?:ahead|behind)$/,
  new RegExp(`^how are we doing (?:against|on|toward|towards|with|for) ${GOAL}$`),
  new RegExp(`^(?:where|how) (?:are we|do we stand) (?:on|with) ${GOAL}$`),
  new RegExp(`^(?:what is )?${GOAL} (?:progress|status|pace)$`),
  new RegExp(`^how is ${GOAL} (?:doing|going|looking|tracking)$`),
];
const norm = t => String(t || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\b(how|what|where)'s\b/g, "$1 is").replace(/\bwe're\b/g, "we are")
  .replace(/^(?:hey |ok |okay )?(?:atlas,? )?(?:can you tell me |tell me |please tell me |so )?/, "").replace(/[?!.]+\s*$/, "").replace(/\s+/g, " ").trim();

function goalAsked(text) {
  const t = norm(text);
  return t && SHAPES.some(re => re.test(t)) ? "goal_left" : null;
}

// One goal card as Home says it. `card`: goalCard's object; `name`: the goal's name.
function cardLine(name, card) {
  const raised = Math.round(Number(card.value) * 100) || 0;
  const goalP = (card.also || []).find(a => a.key === "goal"), pctP = (card.also || []).find(a => a.key === "percent");
  const goal = Math.round(Number(goalP && goalP.value) * 100) || 0;
  const left = Math.max(0, goal - raised);
  const pct = pctP && pctP.value != null ? ` (${pctP.value}%)` : "";
  const when = card.lifecycle === "upcoming" ? "It hasn't started yet." : card.endsWords === "Ended" ? "It has ended." : card.endsWords ? `${card.endsWords}.` : "It has no end date, so there's no pace.";
  const pace = card.paceSentence ? ` ${card.paceLabel ? card.paceLabel + ": " : ""}${card.paceSentence}.` : "";
  const head = goal > 0 && left === 0 ? `${name} has met its goal: ${usd(raised)} raised of ${usd(goal)}${pct}.` : `${name}: ${usd(raised)} raised of the ${usd(goal)} goal${pct}, ${usd(left)} left.`;
  return { line: `${head}${pace} ${when}`.replace(/\.\./g, ".").replace(/\s+/g, " ").trim(), raised, goal, left,
    answer: { type: "figure", topic: "campaign", parts: [{ label: "Raised", cents: raised, source: card.source || null }, { label: "The goal", cents: goal, source: (goalP && goalP.source) || null }, { label: "Left", cents: left }] } };
}

// "and the Gala?" after a goal or campaign answer: the campaign question it is.
const FOLLOW = /^(?:and|what about|how about|and what about|and how about)\s+(?:the |our )?(.{2,80}?)$/;
function followUp(text, prior) {
  if (!prior || prior.topic !== "campaign") return null;
  const m = norm(text).match(FOLLOW);
  return m ? `How is ${m[1]} doing` : null;
}

module.exports = { goalAsked, cardLine, followUp, norm };
