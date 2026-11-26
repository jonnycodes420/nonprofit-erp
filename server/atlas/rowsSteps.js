// server/atlas/rowsSteps.js · ATLAS-8. THE ASKS ATLAS ANSWERS FROM ROWS ALREADY ON A SCREEN.
//
// Read in code before any model (routes/atlas.js POST /atlas), and run as one
// step each (execute):
//   prior_rows   "list them", "tell me more": the last answer's own rows (whyRows.js)
//   population   LYBUNT, SYBUNT, lapsed: the screen that counts it (populations.js)
//   home_figure  the goal left, the stopped monthly gifts: Home's own reads (whyRows.js)
// And item 6: the question kept on each Atlas line (auditQuestion), and the one
// line an answer given with reading off says first (readingOffLine).
"use strict";
const WR = require("./whyRows");
const POP = require("./populations");
const A = require("../../auditTrail");

const KINDS = new Set(["prior_rows", "population", "population_call", "home_figure"]);

// The steps her words make, or null. `prior`: AN.priorContext's (the request before).
function read(text, prior) {
  const fu = prior && prior.id ? WR.followUp(text) : null;
  if (fu) return [{ kind: "prior_rows", mode: fu, follows: prior.id, words: text }];
  const home = WR.homeAsked(text);
  if (home) return [{ kind: "home_figure", which: home, words: text }];
  // ATLAS-9 items 2 and 3: any phrasing the registry's words name; a call question lists that population.
  const pop = require("./populationAsk").readPopulation(text);
  if (pop && pop.call) return pop.ids.map(key => ({ kind: "population_call", key, words: text }));
  if (pop) return pop.ids.map((key, i) => ({ kind: "population", key, words: text, ...(pop.ambiguous ? { both: pop.ids, first: i === 0 } : {}) }));
  return null;
}

// Runs one of KINDS. `log(a)` writes the line and returns its id; `save(id, answer)` keeps the answer.
async function run(st, { log, save, get, query, orgId, parse }) {
  let out;
  if (st.kind === "prior_rows") {
    const prior = await WR.lastAnswer(query, orgId, st.follows, parse);
    // ATLAS-10 item 1: "Tell me more" after a person's brief shows more (every open item, more
    // conversations), never "that's everything" while the brief was holding lines back.
    // ATLAS-11 item 3: a lifetime answer about one person ("Margaret's total") goes on the same way.
    const morePerson = prior && ((prior.type === "person" && !prior.more) || (prior.type === "giving_total" && (prior.donorIds || []).length === 1));
    if (st.mode === "more" && morePerson) {
      const pid = prior.donorId || prior.donorIds[0];
      const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]).catch(() => []);
      const OT = require("../../orgTime");
      const pa = await require("./answers").personAnswer({ query, orgId, donorId: pid, today: OT.orgToday(o || {}), more: true });   // ORG_TZ_SEAM_OK
      // ATLAS-10 follow-up (staging re-check, Rufus Tallgrass): two gifts of $25 on one day are two
      // lines with the same words, so what the brief showed is counted line by line, never as a set.
      // ATLAS-11 item 3: only what the first answer didn't say is drawn (the brief is still above it).
      const shownBefore = new Map();
      for (const f of prior.facts || []) shownBefore.set(f.line, (shownBefore.get(f.line) || 0) + 1);
      const added = pa ? pa.facts.filter(f => { if (prior.type === "giving_total" && f.kind === "giving") return false; const n = shownBefore.get(f.line) || 0; if (n) { shownBefore.set(f.line, n - 1); return false; } return true; }) : [];
      if (pa && added.length) out = { line: `Here's more on ${pa.name}, beyond what I just said.`, answer: { type: "person", ...pa, facts: added }, link: { tab: "donor", donorId: pid } };
      else if (pa) out = { line: `That brief was everything Steward holds on ${pa.name}: nothing in it was held back. Their record has the full timeline.`, link: { tab: "donor", donorId: pid, section: "timeline" } };
    }
    if (!out && st.mode === "more") out = await require("./moreRows").moreRows(prior, { query, orgId });   // ATLAS-11 item 3: the rows behind a number, the next of a list
    if (!out) out = WR.followUpLine(st.mode, prior);
    // FRESH-2 item 4: rows drawn again from an answer older than a gift or a change to a person say so.
    if (out && out.answer && prior && (prior.type === "why" || prior.type === "list")) {
      const since = await require("./sinceAnswer").sinceLine(query, orgId, st.follows);
      if (since) out = { ...out, line: `${out.line} ${since}` };
    }
  } else if (st.kind === "population") {
    out = await POP.populationAnswer(st.key, { get, query, orgId });
    // "Lapsed this year" could be either list: both answer, each named, and the first says so.
    if (out && st.both && st.first) out.line = `That can mean two different lists, so here are both: ${st.both.map(k => (POP.populationOf(k) || {}).word).join(" and ")}. ${out.line}`;
  } else if (st.kind === "population_call") {
    out = await POP.populationCallAnswer(st.key, { query, orgId });
  } else if (st.kind === "home_figure") {
    const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]).catch(() => []);
    out = await WR.homeAnswer(st.which, get, o || null);
  }
  if (!out) out = { line: "I couldn't read that just now." };
  const id = await log({ kind: "answer", state: "done", line: out.line, ...(out.link ? { link: out.link } : {}) });
  if (out.answer) await save(id, out.answer);
  return id;
}

// ── 6. AUDITABLE ───────────────────────────────────────────────────────────
// The question as kept on atlas_actions.question: the audit's own redaction
// (auditTrail.redact: the length cut), and a card or social security number
// said aloud never kept whole.
function auditQuestion(text) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const r = String(A.redact(t)).slice(0, 1000);
  return r.replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[redacted]").replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]");
}

// The one line said before an answer given with reading off (ai off, or the
// read failed), or null. `ai`: the request's ai; `lines`: its lines.
const { READING_OFF } = require("../../shared/atlasReading.js");   // ATLAS-9 item 5: one line, read by every surface
function readingOffLine(ai, lines) {
  if (ai === "on") return null;
  return (lines || []).some(l => l.kind === "answer" && l.state === "done") ? READING_OFF : null;
}

// ── 4. NEVER "HERE'S WHAT I FOUND." OVER "I CAN'T ANSWER THAT" ─────────────
// The header over a request whose every answer says it could not answer is
// that, not a claim that something was found (staging, 22 Nov: "Here's what I
// found." over "I can't answer that from what Steward keeps.").
const CANT = /^(?:I can['’]t|I couldn['’]t|Steward can['’]t|I don['’]t have)\b/;
function spokeOver(spoke, lines) {
  const ans = (lines || []).filter(l => l.kind === "answer");
  if (spoke !== "Here's what I found." || !ans.length || ans.length !== (lines || []).length) return spoke;
  return ans.every(l => CANT.test(String(l.line || "")) && !/,\s*but\b/.test(String(l.line || ""))) ? "I couldn't answer that." : spoke;   // "I can't predict …, but she gave $80" answered
}

module.exports = { KINDS, read, run, auditQuestion, readingOffLine, READING_OFF, spokeOver };
