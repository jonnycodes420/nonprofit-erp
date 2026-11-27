// server/atlas/noRepeat.js · POLISH-15 item 5 (W-1127-Atlas). ATLAS NEVER SAYS A THING TWICE.
//
// The fleet heard Atlas repeat itself: "People, people", and one definition
// said twice in one answer. An answer is assembled from parts (Ask's sentence,
// the count's definition "Label: definition", a population's sentence, a
// second clause's own answer), and each part was right on its own; together
// they doubled a word where a label met a definition starting with the same
// word, or said a definition again in the next line of the same request.
//
// The one writer of an Atlas line (routes/atlas.js logAction) passes every
// line through tidyLine, which
//   1. folds a word said twice in a row ("People, people who" → "People who",
//      "Lapsed: lapsed …" → "Lapsed …"), and
//   2. drops a sentence already said in this line, and a definition sentence
//      ("Label: …") already said in an earlier line of the same request.
// repeatsIn(text) is the check the suite reads (tests/atlas6-grounded.test.js §10).
"use strict";

const SENTENCES = /(?<=[.!?])\s+(?=["“$A-Z0-9])/;
// A word, then only spaces or punctuation that joins a label to what follows, then the same word.
const DOUBLED = /\b([A-Za-z][A-Za-z'’+-]*)\b([\s,;:]+)\1\b/gi;
// "Walla Walla", a name: both capitalized with only a space between is left alone.
const isName = (all, gap) => /^\s+$/.test(gap) && all.split(/\s+/).every(w => /^[A-Z]/.test(w));

const keyOf = s => String(s || "").toLowerCase().replace(/[^a-z0-9$%+ ]+/g, " ").replace(/\s+/g, " ").trim();
// "Donors: each person with …" → its definition part; null for a sentence that isn't one.
const definitionKey = s => { const m = /^[^:.!?]{1,60}:\s+(.{20,})$/.exec(String(s || "").trim()); return m ? keyOf(m[1]) : null; };

function foldDoubled(s) {
  // "People: people who gave" → "People who gave"; "people, people" → "people".
  return String(s).replace(DOUBLED, (all, w, gap) => (isName(all, gap) ? all : w));
}

// `said`: what earlier lines of this request already said ({ defs: Set }), updated here.
function tidyLine(line, said = { defs: new Set() }) {
  const text = String(line == null ? "" : line);
  if (!text.trim()) return text;
  const parts = foldDoubled(text).split(SENTENCES);
  const seen = new Set(), kept = [];
  for (const p of parts) {
    const k = keyOf(p), d = definitionKey(p);
    if (k && seen.has(k)) continue;                 // the same sentence twice in one line
    if (d && (seen.has("def:" + d) || said.defs.has(d))) continue;   // a definition said already
    if (k) seen.add(k);
    if (d) seen.add("def:" + d);
    kept.push(p);
  }
  for (const k of seen) if (k.startsWith("def:")) said.defs.add(k.slice(4));
  return kept.length ? kept.join(" ") : text;
}

// The check: a doubled word, or a sentence (or definition) said twice, in one answer's lines.
function repeatsIn(lines) {
  const all = (Array.isArray(lines) ? lines : [lines]).map(String);
  const out = [];
  const defs = new Set();
  for (const line of all) {
    for (const m of String(line).matchAll(DOUBLED)) if (!isName(m[0], m[2])) out.push(`doubled word: "${m[0]}"`);
    const inLine = new Set();
    for (const p of line.split(SENTENCES)) {
      const k = keyOf(p), d = definitionKey(p);
      if (k && inLine.has(k)) out.push(`sentence twice: "${p}"`);
      if (d && defs.has(d)) out.push(`definition twice: "${p}"`);
      if (k) inLine.add(k);
      if (d) defs.add(d);
    }
  }
  return out;
}

module.exports = { tidyLine, repeatsIn };
