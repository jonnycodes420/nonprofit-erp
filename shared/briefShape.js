// shared/briefShape.js — BUILD-99 (major gifts) Part 4. THE PROSPECT BRIEF, AND
// THE SCHEMA THAT CANNOT SAY WHAT SHE IS WORTH.
//
// "Brief me" on a person: one page an officer reads in the car. Giving history in
// the organisation's own vocabulary, relationships and soft credits, the open
// proposal, the last five conversations quoted, the plan's next step, and what
// the officer wrote in notes.
//
// ── THE LINE THIS MODULE HOLDS ─────────────────────────────────────────────
// NO CAPACITY. NO WEALTH. NO INFERENCE ABOUT THE PERSON BEYOND WHAT THE FILE
// SAYS. And that is not a sentence in a prompt — a prompt is a request, and this
// has to be a guarantee:
//
//   1. THE SCHEMA HAS NO FIELD FOR A NUMBER. Not an amount, not a score, not a
//      capacity, not a probability, not a tier. The model returns PROSE and
//      CITATIONS; every figure on the finished page is rendered by Steward from
//      the rows themselves. A model that wanted to assert "$50,000 capacity" has
//      nowhere to put it, and `SCHEMA_HAS_NO_NUMBER_FIELD` is asserted against
//      the schema by the suite rather than remembered.
//   2. EVERY SENTENCE CITES A ROW, and a citation that does not resolve to a row
//      Steward actually handed over is REFUSED — the sentence is dropped and
//      counted, never quietly printed.
//   3. A NUMBER IN THE PROSE MUST BE GROUNDED. `shared/thresholds.js` already
//      decides what an ungrounded numeric claim is (a number attached to a time
//      unit or a percent is a RULE about how giving works); the brief runs every
//      sentence through it with the row values as the grounded set.
//
// The forbidden vocabulary is checked too, because a sentence can imply capacity
// without a digit in it ("clearly able to give at a much higher level"). That
// check is a blunt instrument and is deliberately blunt: the cost of a false
// refusal is one sentence missing from a brief; the cost of a false pass is
// Steward telling a fundraiser how much a real person can afford.
//
// Pure: no DB, no network, no clock, no JSX.

// ── THE SECTIONS, IN THE ORDER SHE READS THEM ─────────────────────────────
export const BRIEF_SECTIONS = [
  { key: "giving",        title: "Their giving",        source: "gifts, in this organisation's own words" },
  { key: "relationships", title: "Who they are to you", source: "household, related people and soft credits" },
  { key: "proposal",      title: "The open ask",        source: "the proposal on file, if there is one" },
  { key: "conversations", title: "Last five conversations", source: "logged conversations, quoted" },
  { key: "plan",          title: "What is next",        source: "the cultivation plan's open step" },
  { key: "notes",         title: "What you wrote",      source: "the notes on their record" },
];
export const SECTION_KEYS = BRIEF_SECTIONS.map(s => s.key);

// ── THE CITATION FORM ─────────────────────────────────────────────────────
// `kind:id`, where kind names the TABLE the row came from. Anything else is not
// a citation, which is what makes "every sentence cites a row" checkable.
export const CITE_KINDS = ["gift", "pledge", "conversation", "proposal", "plan", "note", "person", "household", "softcredit"];
export const CITE_RE = /^(gift|pledge|conversation|proposal|plan|note|person|household|softcredit):[A-Za-z0-9_.:-]{1,64}$/;

export function isCitation(s) { return CITE_RE.test(String(s || "")); }

// ── THE SCHEMA ────────────────────────────────────────────────────────────
// Strict tool use: `additionalProperties: false` everywhere and every field
// required, so the model cannot add a key. THERE IS NO NUMERIC FIELD ANYWHERE IN
// IT, on purpose — see the header. `headline` is one line and cites nothing
// because it names the person and the occasion, not a fact about them.
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sections"],
  properties: {
    headline: { type: "string",
      description: "One short line naming who this is and why an officer is reading it. No figures." },
    sections: {
      type: "array",
      description: "One entry per section you have something to say about. Leave a section out rather than padding it.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "sentences"],
        properties: {
          key: { type: "string", enum: SECTION_KEYS },
          sentences: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "cites"],
              properties: {
                text: { type: "string",
                  description: "One sentence, in plain English, about what the cited rows say. No figure that is not in those rows." },
                cites: {
                  type: "array",
                  minItems: 1,
                  description: "The row references this sentence rests on, in the form kind:id, exactly as they were given to you.",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

// The property the suite checks instead of trusting this comment: no key anywhere
// in the schema is a number, and no key is named anything capacity-shaped.
export const FORBIDDEN_SCHEMA_KEYS = [
  "capacity", "wealth", "score", "rating", "tier", "estimate", "potential",
  "amount", "value", "probability", "percent", "affordable", "networth", "net_worth",
];
export function schemaNumericFields(schema = BRIEF_SCHEMA, path = "") {
  const out = [];
  const walk = (node, p) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "number" || node.type === "integer") out.push(p || "(root)");
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) walk(v, p ? `${p}.${k}` : k);
    if (node.items) walk(node.items, `${p}[]`);
  };
  walk(schema, path);
  return out;
}
export function schemaForbiddenKeys(schema = BRIEF_SCHEMA) {
  const out = [];
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) {
      if (FORBIDDEN_SCHEMA_KEYS.includes(String(k).toLowerCase())) out.push(k);
      walk(v);
    }
    if (node.items) walk(node.items);
  };
  walk(schema);
  return out;
}

// ── THE FORBIDDEN VOCABULARY ──────────────────────────────────────────────
// A sentence can imply capacity with no digit in it. These phrases are refused
// on sight. Matched on WHOLE WORD RUNS (shared/textMatch.js's rule, applied by
// hand here so this module stays dependency-free): "worth" must not fire inside
// "worthwhile", and "able to give" must not fire on "unable to give".
export const CAPACITY_PHRASES = [
  "capacity", "net worth", "wealth", "estimated worth", "able to give more",
  "could give more", "could afford", "can afford", "give at a higher level",
  "give more than", "good for", "worth approaching for", "major gift potential",
  "likely to give", "should be asked for", "ask amount should",
];
const WORDS = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
function containsRun(hay, needle) {
  const H = WORDS(hay), N = WORDS(needle);
  if (!N.length || N.length > H.length) return false;
  for (let i = 0; i + N.length <= H.length; i++) {
    let hit = true;
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}
export function capacityPhrasesIn(text) {
  return CAPACITY_PHRASES.filter(p => containsRun(text, p));
}

// ── VALIDATION ────────────────────────────────────────────────────────────
// `rows` is the set Steward handed over: a Set (or array) of `kind:id` strings.
// `ungrounded` is injected — shared/thresholds.js owns what an ungrounded numeric
// claim is, and a second copy of that rule here is the thing this repo has been
// burned by four times.
//
// Returns the KEPT brief plus a `dropped` list, each with its reason. Nothing is
// silently removed: a brief that lost a sentence says so, because the officer is
// about to walk into a room on the strength of this page.
export function validateBrief(raw, { rows = [], ungrounded = null, groundedValues = [] } = {}) {
  const known = new Set((rows instanceof Set ? [...rows] : rows).map(String));
  const dropped = [];
  const sections = [];
  const headline = String((raw && raw.headline) || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const headlineProblems = [];
  if (capacityPhrasesIn(headline).length) headlineProblems.push("capacity language");
  if (/\d/.test(headline)) headlineProblems.push("a figure in the headline");
  const keptHeadline = headlineProblems.length ? "" : headline;
  if (headlineProblems.length) dropped.push({ where: "headline", text: headline, why: headlineProblems.join("; ") });

  for (const sec of (Array.isArray(raw && raw.sections) ? raw.sections : [])) {
    const key = String((sec && sec.key) || "");
    if (!SECTION_KEYS.includes(key)) { dropped.push({ where: "section", text: key, why: "not a section of a brief" }); continue; }
    const kept = [];
    for (const s of (Array.isArray(sec.sentences) ? sec.sentences : [])) {
      const text = String((s && s.text) || "").replace(/\s+/g, " ").trim();
      const cites = (Array.isArray(s && s.cites) ? s.cites : []).map(String);
      if (!text) continue;
      const why = [];
      // 1. EVERY SENTENCE CITES A ROW, and the row has to be one we handed over.
      const good = cites.filter(c => isCitation(c) && known.has(c));
      if (!good.length) why.push(cites.length ? "cites no row on this person's file" : "cites nothing");
      // 2. NO CAPACITY LANGUAGE.
      const phrases = capacityPhrasesIn(text);
      if (phrases.length) why.push(`says "${phrases[0]}"`);
      // 3. NO NUMERIC CLAIM THE ROWS AND THE CONSTANTS MODULE DO NOT CONTAIN.
      if (typeof ungrounded === "function") {
        const claims = ungrounded(text, { groundedValues });
        if (claims.length) why.push(`states a rule nothing here defines (${claims[0].value}${claims[0].unit ? " " + claims[0].unit : ""})`);
      }
      if (why.length) { dropped.push({ where: key, text, why: why.join("; ") }); continue; }
      kept.push({ text, cites: good });
    }
    if (kept.length) sections.push({ key, title: sectionTitle(key), sentences: kept });
  }
  // Sections come back in the order a person reads them, not the order a model
  // happened to emit them.
  sections.sort((a, b) => SECTION_KEYS.indexOf(a.key) - SECTION_KEYS.indexOf(b.key));
  return {
    headline: keptHeadline, sections, dropped,
    sentenceCount: sections.reduce((n, s) => n + s.sentences.length, 0),
  };
}

export function sectionTitle(key) {
  const s = BRIEF_SECTIONS.find(x => x.key === key);
  return s ? s.title : key;
}

// The line at the foot of the page. It is not decoration: a brief is read in a
// car on the way to an ask, and the reader has to know what it is and is not.
export const BRIEF_FOOTER =
  "Written from this organisation's own records. Every line above rests on a row you can open. " +
  "Steward has not estimated this person's means and cannot.";

export function droppedSentence(dropped = []) {
  const n = dropped.length;
  if (!n) return "";
  return `${n} ${n === 1 ? "line was" : "lines were"} left out because ${n === 1 ? "it" : "they"} could not be traced to a row on this file.`;
}
