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

const KINDS = new Set(["prior_rows", "population", "home_figure"]);

// The steps her words make, or null. `prior`: AN.priorContext's (the request before).
function read(text, prior) {
  const fu = prior && prior.id ? WR.followUp(text) : null;
  if (fu) return [{ kind: "prior_rows", mode: fu, follows: prior.id, words: text }];
  const pop = POP.populationAsked(text);
  if (pop) return [{ kind: "population", key: pop, words: text }];
  const home = WR.homeAsked(text);
  if (home) return [{ kind: "home_figure", which: home, words: text }];
  return null;
}

// Runs one of KINDS. `log(a)` writes the line and returns its id; `save(id, answer)` keeps the answer.
async function run(st, { log, save, get, query, orgId, parse }) {
  let out;
  if (st.kind === "prior_rows") {
    const prior = await WR.lastAnswer(query, orgId, st.follows, parse);
    out = WR.followUpLine(st.mode, prior);
  } else if (st.kind === "population") {
    out = await POP.populationAnswer(st.key, { get, query, orgId });
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
const READING_OFF = "My reading is off for this organization, so I answered from Steward's own counts only. A question they don't cover, I'll say I can't answer.";
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
