// shared/grantOutline.js — BUILD-100 (grants) Part 5. THE AGENT DRAFTS A
// REPORT OUTLINE, AND IT CANNOT WRITE AN OUTCOME IT CANNOT SEE.
//
// ── THE GUARANTEE IS THE SCHEMA, NOT THE PROMPT ───────────────────────────
// BUILD-99's prospect brief settled how this is done and this is the same
// mechanism applied to a narrower job: **there is NO NUMERIC FIELD ANYWHERE IN
// THE OUTLINE SCHEMA.** The model returns prose and CITATIONS; every figure a
// reader sees is rendered by Steward from the rows it handed over. A model that
// wanted to claim "we served 400 young people" has nowhere to put the 400.
//
// ── AND THE RULE THIS PART ADDS ───────────────────────────────────────────
// A grant report is where an organisation tells a funder what its money did.
// That is exactly the place a fluent model will invent an outcome, because an
// outcome is what the genre wants. So on top of the brief's rules:
//
//   **AN OUTCOME CLAIM IS REFUSED, AND A CITATION CANNOT RESCUE IT.** Steward
//   holds gifts, people, conversations, spending and dates. It does NOT hold
//   programme outcomes — attendance, test scores, meals served, lives changed —
//   because nobody has ever entered them. So there is NO row that could ground
//   one, and "it cited a gift" is not evidence that twelve people attended a
//   showcase. An outcome claim is DROPPED AND COUNTED whatever it cites, and the
//   page says how many lines were left out.
//
//   THAT UNCONDITIONAL FORM IS THE WHOLE RULE. The first cut refused an outcome
//   only when it cited nothing — which rule 4 below already refuses, so the
//   check changed the wording of a refusal and nothing else. A guard that cannot
//   refuse anything rule 4 would not is decoration with a pass count (the
//   BUILD-75 rule), and the suite proves this one able to fail on a line that
//   DOES cite a row Steward handed over.
//
// The honest output for the outcomes section is therefore a PROMPT to the human:
// you know what happened; Steward does not.
//
// Every other sentence must cite a row on THIS GRANT or its fund. A citation to
// a gift in another fund is not evidence about this programme.
//
// Pure: no DB, no network, no clock, no model call.

// ── WHAT MAY BE CITED ─────────────────────────────────────────────────────
// Deliberately narrower than the brief's list. A grant report is about this
// grant's money and this programme's activity; a household relationship or a
// soft credit is not evidence about either.
export const CITE_RE = /^(gift|payment|spend|milestone|document|conversation|person|grant):[A-Za-z0-9_.:-]{1,64}$/;
export function isCitation(s) { return CITE_RE.test(String(s || "")); }

// ── THE SCHEMA — AND NOT ONE NUMERIC FIELD IN IT ──────────────────────────
// `type: "prose"` is a string the model writes. `type: "cites"` is an array of
// citation strings. There is no number, no money, no count, no percentage, and
// `schemaNumericFields` below walks the whole structure to prove it — so one
// cannot be added quietly in six months.
export const OUTLINE_SCHEMA = {
  headline: { type: "prose", max: 160 },
  sections: {
    type: "array", max: 6,
    of: {
      heading: { type: "prose", max: 80 },
      lines: {
        type: "array", max: 8,
        of: { text: { type: "prose", max: 400 }, cites: { type: "cites", max: 6 } },
      },
    },
  },
};

// The structural walker. Returns the PATH of any field whose declared type
// could carry a number. Proven able to fail by the suite against a schema with
// one planted in it — a walker that can only be observed returning nothing is
// not measuring anything (the BUILD-75 rule).
export function schemaNumericFields(schema = OUTLINE_SCHEMA, path = "") {
  const out = [];
  const NUMERIC = new Set(["number", "money", "integer", "count", "percent", "amount"]);
  const walk = (node, p) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string") {
      if (NUMERIC.has(node.type)) out.push(p);
      if (node.type === "array" && node.of) walk(node.of, p + "[]");
      return;
    }
    for (const k of Object.keys(node)) walk(node[k], p ? `${p}.${k}` : k);
  };
  walk(schema, path);
  return out;
}

// ── OUTCOME LANGUAGE ──────────────────────────────────────────────────────
// Matched on WHOLE WORD RUNS, never substrings — the BUILD-84 census rule.
// "served" inside "reserved" or "observed" must not fire, and a phrase is a
// sequence of tokens rather than a string to search for.
//
// BECAUSE THE REFUSAL IS UNCONDITIONAL, A FALSE POSITIVE COSTS A REAL SENTENCE —
// so this list holds only phrases that cannot be a reading of a row. Three were
// deliberately left OUT for that reason: a bare "reached" ("the award reached us
// in two payments"), "increase in" ("an increase in giving" is arithmetic over
// the rows), and "as a result" (which a sentence about a balance can earn). Each
// would have refused a sentence Steward can actually back.
export const OUTCOME_PHRASES = [
  ["served"], ["we", "reached"], ["impacted"], ["lives", "changed"], ["outcomes"],
  ["participants"], ["attendance"], ["attended"], ["graduated"], ["improved"],
  ["meals", "served"], ["beneficiaries"], ["success", "rate"], ["test", "scores"],
  ["thanks", "to", "your", "support"], ["because", "of", "this", "grant"],
];

export function tokenize(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
}
export function containsRun(tokens, run) {
  if (!run.length || run.length > tokens.length) return false;
  for (let i = 0; i + run.length <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < run.length; j++) if (tokens[i + j] !== run[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}
export function outcomeLanguage(text) {
  const t = tokenize(text);
  const hits = OUTCOME_PHRASES.filter(r => containsRun(t, r)).map(r => r.join(" "));
  return hits;
}

// The sentence offered in place of an outcome Steward cannot back. It is a
// PROMPT to the human, not a placeholder that reads like content.
export const OUTCOMES_PROMPT =
  "Steward does not hold programme outcomes — attendance, results, what changed for the people you serve. Nobody has entered them, so nothing here can state them. Write this section yourself; the figures above are the parts Steward can back.";

export const OUTLINE_FOOTER =
  "Every figure above is rendered by Steward from its own rows. Sentences that could not cite a row were left out and counted.";

const trim = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// ── VALIDATION ────────────────────────────────────────────────────────────
// `rows` is the set of citation keys Steward ACTUALLY HANDED the model. A
// citation to anything else is not a citation, it is a guess with a colon in
// it. `ungrounded` is shared/thresholds.js's verdict on numeric rules, reused
// so "spend it within 12 months" is checked the same way everywhere.
export function validateOutline(raw, { rows = new Set(), ungrounded = null } = {}) {
  const handed = rows instanceof Set ? rows : new Set(rows || []);
  const dropped = [];
  const drop = (text, why) => dropped.push({ text: trim(text, 160), why });

  const headline = trim(raw && raw.headline, OUTLINE_SCHEMA.headline.max);

  const sections = [];
  const rawSections = Array.isArray(raw && raw.sections) ? raw.sections.slice(0, OUTLINE_SCHEMA.sections.max) : [];
  for (const sec of rawSections) {
    const heading = trim(sec && sec.heading, 80);
    if (!heading) continue;
    const lines = [];
    const rawLines = Array.isArray(sec && sec.lines) ? sec.lines.slice(0, OUTLINE_SCHEMA.sections.of.lines.max) : [];
    for (const ln of rawLines) {
      const text = trim(ln && ln.text, OUTLINE_SCHEMA.sections.of.lines.of.text.max);
      if (!text) continue;
      const cites = (Array.isArray(ln && ln.cites) ? ln.cites : [])
        .map(c => String(c || "")).filter(isCitation).slice(0, 6);
      const grounded = cites.filter(c => handed.has(c));

      // 1 — A CITATION MUST RESOLVE TO A ROW STEWARD HANDED OVER.
      if (cites.length && !grounded.length) { drop(text, "cited a row Steward never handed over"); continue; }

      // 2 — AN OUTCOME CLAIM IS REFUSED, WHATEVER IT CITES. There is no row in
      // this product that could ground one, so a citation is not evidence — it
      // is a gift row standing behind a sentence about attendance. This is the
      // rule this part adds, and the one a fluent model will test.
      const outcomes = outcomeLanguage(text);
      if (outcomes.length) {
        drop(text, `claimed an outcome Steward cannot see ("${outcomes[0]}"). Nothing in your records holds it; write this line yourself.`);
        continue;
      }

      // 3 — A NUMERIC RULE goes through the thresholds seam. Data is not a
      // claim: "$12,500 across five payments" is a reading of rows; "spend it
      // within 12 months" is a threshold nobody here set.
      if (typeof ungrounded === "function") {
        const bad = ungrounded(text) || [];
        if (bad.length) { drop(text, `stated a rule nothing here sets (${bad[0]})`); continue; }
      }

      // 4 — AND NOTHING AT ALL WITHOUT A ROW BEHIND IT.
      if (!grounded.length) { drop(text, "cited nothing"); continue; }

      lines.push({ text, cites: grounded });
    }
    if (lines.length) sections.push({ heading, lines });
  }

  return {
    headline, sections, dropped,
    droppedCount: dropped.length,
    sentenceCount: sections.reduce((s, x) => s + x.lines.length, 0),
    // NOTHING IS DROPPED SILENTLY. The page and any export both say how many.
    droppedSentence: dropped.length
      ? `${dropped.length} ${dropped.length === 1 ? "line was" : "lines were"} left out because ${dropped.length === 1 ? "it" : "they"} could not cite a row.`
      : null,
    outcomesPrompt: OUTCOMES_PROMPT,
    footer: OUTLINE_FOOTER,
  };
}

// ── WHAT AN OUTLINE IS ALLOWED TO BE ABOUT ────────────────────────────────
// The sections Steward can actually supply rows for. Offered to the model as
// the shape, so an outline is not free to invent a section about something
// nobody recorded.
export const OUTLINE_SECTIONS = [
  { key: "promised", heading: "What we said we would do",
    source: "the grant's programme and the proposal on file" },
  { key: "money_in", heading: "What the funder paid",
    source: "payments applied to the award" },
  { key: "money_out", heading: "What we spent against it",
    source: "spending entered by hand against this grant" },
  { key: "activity", heading: "The programme's giving and people in the period",
    source: "gifts to this grant's fund, and the people who gave them" },
  { key: "outcomes", heading: "What changed for the people you serve",
    source: null },       // NOTHING. Steward holds no outcomes; the human writes it.
];
export function sectionsWithoutSource() {
  return OUTLINE_SECTIONS.filter(s => !s.source).map(s => s.key);
}
