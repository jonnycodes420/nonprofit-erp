// server/atlas/resume.js · FLOWS-16 items 3 and 4. WHAT A CONVERSATION CARRIES FORWARD.
//
// Item 4 (W-1116-Atlas-02X): "How much did Prudence Galbraith give in December
// 2025?" asked "Which Prudence Galbraith?", and after the choice Atlas answered
// with her lifetime. POST /atlas/:id/answer rebuilt each step from a fixed list
// of fields (kind, who, words …) and the question's `period` was not on it. Now
// the step resumes whole: only what resolving wrote is taken off (`unresolved`).
//
// Item 4, second half: a "Which X?" nobody answered waited for ever (Area 5
// found Nov 8 and Nov 10 questions still in the bell). After QUESTION_DAYS it
// closes itself, with a line in the bell saying so (`expireQuestions`, a daily
// job), and the bell stops listing it at once (`openQuestions` reads the same
// cut-off, so the read changes nothing).
//
// Item 3 (W-1116-Atlas-20): a follow-up asked for from a neutral page (Reports)
// after a question about Linwood saved nothing: "Saved 0 things." beside "I
// couldn't set that reminder: Steward could not point at the record it came
// from." The question named him, but a giving question keeps its people in
// `donorIds` (TRUTH-3), and neither the request's donor_ids nor the next
// request's prior context read them, so the follow-up had no person. Now
// `donorIdsOf` reads both shapes, and `personInConversation` finds who the
// conversation was about.
"use strict";

const QUESTION_DAYS = 7;

// What resolveAll (routes/atlas.js) writes on a step. Everything else is what
// was asked, and it all comes back.
const RESOLVED = ["donorId", "donorIds", "missing", "notFound", "noWho", "otherId", "targetId", "targetName",
  "targetDate", "targetMissing", "index", "unrecorded"];
function unresolved(step) {
  const s = { ...(step || {}) };
  for (const k of RESOLVED) delete s[k];
  return s;
}

// Every person a request's steps are about: one (donorId) or several (a giving question's donorIds).
function donorIdsOf(steps) {
  const out = [];
  for (const s of steps || []) {
    if (s && s.donorId) out.push(s.donorId);
    for (const id of (s && Array.isArray(s.donorIds) ? s.donorIds : [])) if (id) out.push(id);
  }
  return [...new Set(out)];
}

// The one person the conversation before this request was about, or null.
// Several people (a list answer, two names) is not one person: Atlas asks.
function personInConversation(prior) {
  if (!prior || !prior.context) return null;
  const people = prior.context.people || [];
  if (prior.context.lastPerson && people.length <= 1) return prior.context.lastPerson;
  return people.length === 1 ? people[0] : null;
}

// A follow-up's words that point at a person ("follow up with him", "call
// her", "check in"), as against a task of her own ("draft the year-end letter").
const ABOUT_SOMEONE = /\b(him|her|them|he|she|they|follow[- ]?up|call|ring|phone|email|write to|thank|meet|visit|check in|touch base|reach out)\b/i;
const pointsAtSomeone = words => ABOUT_SOMEONE.test(String(words || ""));

// The name in a follow-up's own words ("follow up with Linwood next Tuesday"), which the code read
// leaves out of `who`: on his profile the page filled it in, on Reports nothing did.
const NOT_NAMES = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Next|The|This|Tomorrow|Today|Steward|Atlas)$/;
function nameInWords(words) {
  const re = /\b(?:with|to|call|ring|phone|email|thank|visit|meet|see|about)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)?)/g;
  for (const m of String(words || "").matchAll(re)) {
    const parts = m[1].split(/\s+/).filter(w => !NOT_NAMES.test(w));
    if (parts.length && !NOT_NAMES.test(parts[0])) return parts.join(" ");
  }
  return null;
}

const NO_PERSON_LINE = "Who is this follow-up for? Say their name and I'll set it, on whatever page you're on.";

// SQL cut-off for an open question, shared by the bell's read and the job.
const STALE_SQL = `created_at < NOW() - interval '${QUESTION_DAYS} days'`;
const EXPIRED_LINE = asked => `${asked ? asked + " " : ""}Nobody answered this for ${QUESTION_DAYS} days, so I closed it. Nothing in it ran; ask me again any time.`;

// The daily job: every question older than QUESTION_DAYS closes, and says so in the bell.
async function expireQuestions({ query, run, newId }, { limit = 500 } = {}) {
  const rows = await query(
    `UPDATE voice_memos SET status='expired'
      WHERE id IN (SELECT id FROM voice_memos WHERE status='needs_answers' AND source LIKE 'atlas%' AND ${STALE_SQL} ORDER BY created_at LIMIT ?)
        AND status='needs_answers'
      RETURNING id, org_id, read, text`, [limit]);
  for (const m of rows) {
    const read = typeof m.read === "string" ? (() => { try { return JSON.parse(m.read); } catch { return {}; } })() : (m.read || {});
    const asked = (((read.atlas || {}).questions) || []).map(q => q.sentence).filter(Boolean).join(" ");
    await run(`INSERT INTO atlas_actions (id,org_id,request_id,kind,state,waits,undoable,line,actor_id,actor_name,created_by,created_by_name)
               VALUES (?,?,?,'question','expired',false,false,?,'system:atlas/expire-questions','Atlas','system:atlas/expire-questions','Atlas')`,
      [newId("aa"), m.org_id, m.id, EXPIRED_LINE(asked)]);
  }
  return { closed: rows.length };
}

module.exports = { QUESTION_DAYS, RESOLVED, unresolved, donorIdsOf, personInConversation, pointsAtSomeone, nameInWords, NO_PERSON_LINE, STALE_SQL, EXPIRED_LINE, expireQuestions };
