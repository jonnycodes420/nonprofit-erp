// server/donors/briefComplete.js · ATLAS-4. A BRIEF SAYS EVERY SENTENCE TO THE END.
//
// Prof 7 (Muse, 5 Nov): Brief me wrote "Henderson noted:" with nothing after
// it, and "The profile note reads:" stayed blank although there was an About
// note. The quote was left to the model, and nothing checked that the words a
// sentence leads into ever arrived: a lead-in and its quote came back as two
// sentences (or as a lead-in alone), and the validator kept whatever cited a
// row. The rows also cut every note short (500 characters for the About note,
// 300 in the first words), so even a quote that came through could stop
// mid-sentence.
//
// Now the quote is Steward's, not the model's:
//   · a sentence that ends on a colon, or quotes nothing (""), gets the full
//     text of the conversation or note it cites, from the record; with no
//     such text it is left out, and the "left out" line says so;
//   · a quote that is the start of a note (cut short) is replaced by the note
//     in full;
//   · the About note is always in "What you wrote", in full, in Steward's own
//     sentence, when the model did not quote it whole.
// Pure: the texts come from briefRowsFor (ctx.quotes), nothing is read here.
"use strict";

const OPEN = "“", CLOSE = "”";
const EMPTY_QUOTE = /(["“”'])\s*(["“”'])/;
const QUOTED = /["“]([^"“”]*)["”]/g;
const endsOnColon = t => /[:—-]\s*$/.test(String(t || "").trim());
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const bare = s => norm(s).replace(/(\.\.\.|…)$/, "").replace(/[.\s]+$/, "").toLowerCase();

// The problems a reader would see, one per offending line. The suite reads
// every line of a brief through this; an empty list is a complete brief.
function briefProblems(lines) {
  const out = [];
  for (const l of lines || []) {
    const t = norm(l);
    if (!t) continue;
    if (endsOnColon(t)) out.push({ line: t, why: "ends on a colon with nothing after it" });
    if (EMPTY_QUOTE.test(t)) out.push({ line: t, why: "quotes nothing" });
  }
  return out;
}
// Every line a person reads in a brief: the first words, the headline, the sentences.
function briefLines(brief, opening = []) {
  return [...(opening || []), brief && brief.headline, ...((brief && brief.sections) || []).flatMap(s => (s.sentences || []).map(x => x.text))].filter(Boolean);
}

// Which full text a sentence that cites `refs` leads into.
function textFor(sentence, cites, quotes) {
  const texts = [];
  for (const c of cites || []) for (const q of (quotes.get(c) || [])) texts.push(q);
  if (!texts.length) return null;
  if (texts.length === 1) return texts[0].text;
  const about = texts.find(x => x.kind === "about");
  if (about && /\babout\b|\bprofile\b|\bread first\b/i.test(sentence)) return about.text;
  const conv = texts.find(x => x.kind === "conversation");
  return (conv || texts.find(x => x.kind === "notes") || texts[0]).text;
}

function completeSentence(s, quotes) {
  let text = norm(s.text);
  const full = textFor(text, s.cites, quotes);
  // A quote cut short becomes the note in full.
  if (full) {
    text = text.replace(QUOTED, (all, inner) => {
      const b = bare(inner);
      return b && b !== bare(full) && bare(full).startsWith(b) ? `${OPEN}${norm(full)}${CLOSE}` : all;
    });
  }
  const empty = EMPTY_QUOTE.test(text);
  if (!endsOnColon(text) && !empty) return { text };
  if (!full) return { drop: "it led into a quote the record does not hold" };
  if (empty) return { text: text.replace(EMPTY_QUOTE, `${OPEN}${norm(full)}${CLOSE}`) };
  return { text: `${text.replace(/[\s—-]+$/, "").replace(/:?$/, ":")} ${OPEN}${norm(full)}${CLOSE}` };
}

// checked: validateBrief's output (after scrub). ctx: briefRowsFor's.
function completeBrief(checked, ctx) {
  const quotes = (ctx && ctx.quotes) || new Map();
  const dropped = [...(checked.dropped || [])];
  const sections = [];
  for (const sec of checked.sections || []) {
    const kept = [];
    for (const s of sec.sentences || []) {
      const r = completeSentence(s, quotes);
      if (r.drop) { dropped.push({ where: sec.key, text: s.text, why: r.drop }); continue; }
      kept.push({ ...s, text: r.text });
    }
    if (kept.length) sections.push({ ...sec, sentences: kept });
  }
  // The About note, whole, in "What you wrote".
  const about = ctx && ctx.donor && norm(ctx.donor.about_them);
  if (about) {
    const has = sections.some(sec => sec.sentences.some(x => bare(x.text).includes(bare(about))));
    if (!has) {
      const line = { text: `What the team wrote about them: ${OPEN}${about}${CLOSE}`, cites: [`note:${ctx.donor.id}`] };
      const notes = sections.find(sec => sec.key === "notes");
      if (notes) notes.sentences.unshift(line);
      else sections.push({ key: "notes", title: "What you wrote", sentences: [line] });
    }
  }
  const headline = endsOnColon(checked.headline) ? "" : checked.headline;
  return { ...checked, headline, sections, dropped, sentenceCount: sections.reduce((n, x) => n + x.sentences.length, 0) };
}

module.exports = { completeBrief, briefProblems, briefLines, endsOnColon };
