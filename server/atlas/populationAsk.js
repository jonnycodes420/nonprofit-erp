// server/atlas/populationAsk.js · ATLAS-9 items 2 and 3. ANY WAY OF ASKING ABOUT A POPULATION.
//
// Jarvis (23 Nov): "Atlas's lapsed question now gives no count at all." ATLAS-8
// read "lapsed" with one exact regex (populations.js LAPSED_ONLY: the whole
// sentence shaped one way), so "how many people have lapsed?" or "who's lapsed
// this year?" fell through to Ask, which answered a different question (the
// donors past their own rhythm, retention). And "who should I call to win back
// lapsed donors?" was the morning call list (why.js call), which ranks reasons,
// not lapsed people: one of five was lapsed, and the biggest lapsed were missing.
//
// Here her words are read against the population registry
// (shared/populationWords.js): each id has the words people use for it, the
// registry's own name among them. A question is a population question when,
// with those words and the plain words of asking taken out ("how many", "who",
// "our", "donors", "do we have"), nothing is left. Anything left ("in
// Lexington", "over $1,000", "how much did they give") is a narrower question
// and stays with Ask. "Lapsed" said with a fiscal year ("lapsed this year")
// could be Lapsed (rolling 12 months) or LYBUNT (fiscal years): both answer,
// each named. A call question ("who should I call", "to win back") about a
// population lists that population's askable people (the registry's "you can
// ask" twin), ranked by lifetime giving.
"use strict";

const W = require("../../shared/populationWords.js");

// The words each population is asked by. Every key must be a registry id.
const CUES = {
  lybunt: [/\blybunts?\b/, /\b(?:gave|given|giving|donated) (?:last (?:fiscal )?year|in (?:the )?last fiscal year) (?:but|and) (?:not|nothing|didn't give|did not give|haven't given|have not given|hasn't given|has not given)(?: (?:yet|anything|given|give))* (?:this|so far this) (?:fiscal )?year\b/,
    /\blast year but (?:not|nothing)(?: yet)? this year\b/, /\blast year but unfortunately not this year\b/],
  sybunt: [/\bsybunts?\b/, /\bsome year but (?:unfortunately )?not this year\b/, /\b(?:gave|given|donated) (?:in )?(?:some|a|an earlier|a previous|a past) (?:fiscal )?year (?:but|and) not this (?:fiscal )?year\b/],
  lapsing: [/\blapsing\b/, /\b(?:about|going|likely|starting) to lapse\b/, /\bat risk of lapsing\b/],
  lapsed: [/\blapsed\b/, /\blapses?\b/, /\b(?:stopped|quit|ceased|stopped) (?:giving|donating)\b/, /\bno longer (?:give|giving|gives|donate|donating|donates)\b/,
    /\b(?:not|haven't|have not|hasn't|has not) (?:given|donated) in (?:a year|12 months|twelve months|over a year|more than a year)\b/, /\bfallen off\b|\bdropped off\b|\bfell off\b/],
};
for (const id of Object.keys(CUES)) if (!W.isPopulationId(id)) throw new Error(`populationAsk: ${id} is not a registry population`);
// The registry's own name, said as a word, names it too ("Lapsing", "LYBUNT").
for (const id of Object.keys(CUES)) {
  const name = W.population(id).name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (name && !/\d/.test(name)) CUES[id].push(new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`));
}
// The askable twin a call list draws (never call someone marked do not contact).
const ASKABLE = { lapsed: "lapsed_askable", lybunt: "lybunt_askable", lapsing: "lapsing_askable", sybunt: "sybunt_askable" };
for (const [k, v] of Object.entries(ASKABLE)) if (!W.isPopulationId(v)) throw new Error(`populationAsk: ${k} -> ${v} is not a registry population`);

// A fiscal year said beside "lapsed" is what makes it ambiguous with LYBUNT.
const FISCAL = /\b(?:this|last|so far this) (?:fiscal )?year\b|\b(?:this|last) fy\b|\bfiscal year\b|\bsince last year\b/;
// A call question: who to call, reach, win back.
const CALL = /\b(?:call|calls|calling|ring|phone|reach out to|reach|contact|win back|winback|bring back|get back|re-?engage|re-?activate)\b/;
const WIN_BACK = /\b(?:win back|winback|bring back|get back|re-?engage|re-?activate)\b/;
// The plain words of asking. Whatever is left after these and the cues is a narrower question.
const FILL = new Set(("how many who whos which what whats is are was were be been being has have had do does did we i you our my the all of " +
  "people person persons donors donor givers giver supporters supporter members folks contacts ones those these them they us any " +
  "currently now today right there got show me list count number total totals in so far yet still already tell about see find get let know " +
  "please would like to can could us a an count gone become became considered counted as some just exactly here " +
  "anyone anybody somebody someone").split(/\s+/));
// ATLAS-11 item 2 (Jarvis: "cannot give LYBUNT dollars"): the money words of a count question. A
// population answer always says its dollars, so "LYBUNT dollars" and "how much did they give" are it too.
const MONEY_FILL = new Set(("and how much many did do does they them their give gave given giving dollars dollar money worth value " +
  "stake at risk total totals sum amount amounts raise raised households household families family last year's").split(/\s+/));
const CALL_FILL = new Set("should shall must call calls calling ring phone reach out contact first next tomorrow week this today start with among from back win winback bring get reengage re engage reactivate try ought i who whom to".split(/\s+/));

function norm(text) {
  return String(text || "").toLowerCase().replace(/[’‘`]/g, "'")
    .replace(/\bwho's\b/g, "who is").replace(/\bwhat's\b/g, "what is").replace(/\bhow's\b/g, "how is")
    .replace(/[^a-z0-9' +-]+/g, " ").replace(/\s+/g, " ").trim();
}

// What her words ask, or null:
//   { ids: [population ids, each answered and named], call: boolean, ambiguous: boolean }
function readPopulation(text) {
  let t = norm(text);
  if (!t || t.length > 160) return null;
  const hit = new Set();
  let rest = t;
  for (const [id, res] of Object.entries(CUES)) for (const re of res) {
    if (re.test(rest)) { hit.add(id); rest = rest.replace(new RegExp(re.source, "g"), " "); }
  }
  const call = CALL.test(t);
  // "who should I call to win back" names no population: winning back is the lapsed.
  if (!hit.size && call && WIN_BACK.test(t)) hit.add("lapsed");
  if (!hit.size) return null;
  // "lapsed" with LYBUNT's own words is LYBUNT ("gave last year but not this year, lapsed").
  if (hit.has("lybunt") && hit.has("lapsed")) hit.delete("lapsed");
  const fiscal = FISCAL.test(t);
  rest = rest.replace(new RegExp(FISCAL.source, "g"), " ").replace(new RegExp(CALL.source, "g"), " ");
  const withMoney = [...hit].every(id => id === "lybunt" || id === "sybunt");   // the reports that carry the dollars
  const left = rest.split(/\s+/).map(w => w.replace(/^'+|'+$/g, "").replace(/'s$/, "")).filter(Boolean)
    .filter(w => !FILL.has(w) && !(call && CALL_FILL.has(w)) && !(!call && withMoney && MONEY_FILL.has(w)));
  if (left.length) return null;
  let ids = [...hit];
  let ambiguous = false;
  if (ids.length === 1 && ids[0] === "lapsed" && fiscal) { ids = ["lapsed", "lybunt"]; ambiguous = true; }
  if (call) ids = ids.map(id => ASKABLE[id] || id);
  return { ids, call, ambiguous };
}

module.exports = { readPopulation, norm, CUES, ASKABLE };
