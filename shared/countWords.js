// shared/countWords.js — FIX-58 item 7. ONE HELPER FOR EVERY COUNT.
//
// "1 sustainers" was on the Recurring page because every screen wrote its own
// `n === 1 ? "" : "s"` (or forgot to). Every count a person reads comes from
// here now. The rule (docs/decisions/design-system.md, Counts):
//
//   countLabel  — a count on a tile, chip, badge, button or list header:
//                 always numerals, "1 sustainer", "12 sustainers".
//   countWords  — a count inside a sentence: under ten is spelled,
//                 "one sustainer", "three donors", "12 donors".
//   plural      — just the word, for a label that draws the number itself.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

// many defaults to one + "s"; pass it for anything irregular ("people", "classes").
export function plural(n, one, many) {
  return Number(n) === 1 ? one : (many || one + "s");
}

export function countLabel(n, one, many) {
  const k = Number(n) || 0;
  return `${k.toLocaleString("en-US")} ${plural(k, one, many)}`;
}

export function spell(n) {
  const k = Number(n);
  return Number.isInteger(k) && k >= 0 && k < WORDS.length ? WORDS[k] : (Number(n) || 0).toLocaleString("en-US");
}

export function countWords(n, one, many) {
  const k = Number(n) || 0;
  return `${spell(k)} ${plural(k, one, many)}`;
}

// ── WALKB-1 · AN IMPACT METRIC'S SENTENCE ─────────────────────────────────
// An org writes its own outcome template ("Your {amount} has funded {n}
// after-school arts workshops"), so the noun after {n} is theirs, written in
// the plural. When {n} is 1 the noun takes its singular: the last word of the
// phrase after {n}, which ends at punctuation, a joining word ("of", "for")
// or a participle ("meals served"). "1 after-school arts workshop", not
// "1 after-school art workshops".
const IRREGULAR = { people: "person", children: "child", men: "man", women: "woman", mice: "mouse", geese: "goose", teeth: "tooth", feet: "foot" };
const STOP = new Set(["of", "for", "in", "to", "at", "with", "and", "or", "that", "who", "which", "from", "across", "through", "this", "last", "each", "per", "a", "an", "the", "on", "by", "so", "into", "over", "during"]);

export function singular(word) {
  const w = String(word || "");
  const lower = w.toLowerCase();
  if (IRREGULAR[lower]) return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? IRREGULAR[lower][0].toUpperCase() + IRREGULAR[lower].slice(1) : IRREGULAR[lower];
  if (/(ss|us|is)$/i.test(w)) return w;                          // class, bus, analysis: already singular
  if (/[^aeiou]ies$/i.test(w) && !/series$/i.test(w)) return w.slice(0, -3) + "y";   // families → family
  if (/(ches|shes|sses|xes|zes)$/i.test(w)) return w.slice(0, -2);  // lunches → lunch, boxes → box
  if (/s$/i.test(w)) return w.slice(0, -1);
  return w;
}

function singularPhrase(rest) {
  // rest is the text after "{n}". Find the noun phrase's last word.
  const m = /^(\s+)([^.,;:!?()]*)/.exec(rest);
  if (!m) return rest;
  const words = m[2].split(/(\s+)/);                              // keep the spaces
  let last = -1;
  for (let i = 0; i < words.length; i += 2) {
    const raw = words[i];
    const bare = raw.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!bare) break;
    if (i > 0 && (STOP.has(bare) || /ed$/.test(bare))) break;   // "of", "served", "funded"
    last = i;
  }
  if (last < 0) return rest;
  words[last] = singular(words[last]);
  return m[1] + words.join("") + rest.slice(m[0].length);
}

// template: the org's outcome template. n: the count. amount: dollars.
export function impactSentence(template, { n, amount } = {}) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  const dollars = "$" + Math.round(Number(amount) || 0).toLocaleString("en-US");
  let s = String(template || "").replace(/\$?\{\{?\s*amount\s*\}?\}/gi, dollars);
  const N = /\{\{?\s*n\s*\}?\}/i;
  let out = "";
  let m;
  while ((m = N.exec(s))) {
    out += s.slice(0, m.index) + k.toLocaleString("en-US");
    s = s.slice(m.index + m[0].length);
    if (k === 1) s = singularPhrase(s);
  }
  return (out + s).replace(/\s+/g, " ").trim();
}
