// server/atlas/progress.js · ATLAS-3. THE STATUS LINE SAYS WHAT ATLAS IS DOING NOW.
//
// The dialog used to spin "Drafting the email" while Atlas marked an
// attendance, readied a gift, started a journey and wrote the email. Now the
// browser sends a key with the request and asks GET /atlas/progress/:key
// while it waits; each step sets the line as it starts ("Step 2 of 4:
// Getting Undine's $10,000 gift ready for your tap"). Kept in memory for a
// minute: it is a status line, not a record, and nothing reads it later.
//
// SPEED-3 · SAY WHAT IT'S DOING, AND SHOW THE FIRST WORDS. Each line ends in
// "…" while it works ("Writing the draft to Marlowe…"), and a draft's words
// ride on the same line as the model writes them (`words`), so the dialog
// shows them within a second of the writing starting, not when it is done.
// `lap` keeps how long each part took, for the request's timings.
"use strict";
const LIVE_MS = 60 * 1000;
const lines = new Map();   // key -> { line, step, of, at, words }

const WORDS = {
  came_to_event: n => `Marking ${n} as attended`, register_for_event: n => `Adding ${n} to the guest list`, gift: n => `Getting ${n}'s gift ready for your tap`,
  pledge: n => `Getting ${n}'s pledge ready for your tap`, add_to_journey: n => `Adding ${n} to the journey`, remove_from_journey: n => `Taking ${n} out of the journey`,
  add_to_group: n => `Adding ${n} to the group`, remove_from_group: n => `Taking ${n} out of the group`, draft_email: n => `Writing the email to ${n}`,
  send_now: n => `Writing the email to ${n}`, reminder: () => "Setting the reminder", log_conversation: n => `Logging the conversation with ${n}`,
  note: n => `Saving the note on ${n}`, send_receipt: n => `Getting ${n}'s receipt ready`, question: () => "Looking it up in your records",
  find: n => `Finding ${n}`, about: n => `Reading ${n}'s record`, link: n => `Linking ${n}`, undo: () => "Undoing", merge: () => "Checking the two records",
  recurring_change: () => "Checking", personal_detail: () => "Holding a detail back", other: () => "Working on it",
};
// SPEED-3: what the step is doing, said as it happens.
WORDS.draft_email = n => `Writing the draft to ${n}`;
WORDS.send_now = WORDS.draft_email;
// A question says what it is looking up, in her words ("Looking up: who gave last December…").
WORDS.question = (n, st) => { const t = String((st && st.target) || "").replace(/[?.!\s]+$/, "").trim();
  return t ? `Looking up: ${t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, "") : t.charAt(0).toLowerCase() + t.slice(1)}` : "Looking it up in your records"; };
const working = w => (/[.…?!]$/.test(w) ? w : `${w}…`);
const keyOf = req => { const k = String((req.body && req.body.progressKey) || ""); return /^[a-z0-9-]{8,64}$/i.test(k) ? `${req.user.orgId}:${req.user.userId}:${k}` : null; };
function sweep() { const now = Date.now(); for (const [k, v] of lines) if (now - v.at > LIVE_MS) lines.delete(k); }
function set(req, line, step = 0, of = 0) {
  const k = keyOf(req); if (!k) return;
  sweep();
  const was = lines.get(k);
  lines.set(k, { line: working(line), step, of, at: Date.now(), words: was && was.words });
}
// The words written so far (a draft as it streams). The line stays as it is.
function words(req, text) {
  const k = keyOf(req); if (!k) return;
  const v = lines.get(k) || { line: "", step: 0, of: 0 };
  lines.set(k, { ...v, words: String(text || "").slice(0, 4000), at: Date.now() });
}
// How long each part took: { step, ms } since the last lap.
function lap(req, step) {
  const now = Date.now();
  if (!req.atlasLaps) { req.atlasLaps = []; req.atlasLapAt = req.atlasT0 || now; }
  req.atlasLaps.push({ step, ms: now - req.atlasLapAt });
  req.atlasLapAt = now;
}
// One call per step, in order: "Step 2 of 4: Writing the email to Undine".
function sayer(req, of) {
  let i = 0;
  return (st, name) => {
    i += 1;
    const w = (WORDS[st.kind] || WORDS.other)(String(name || "them").split(/\s+/)[0], st);
    set(req, of > 1 ? `Step ${i} of ${of}: ${w}` : w, i, of);
  };
}
function get(orgId, userId, key) {
  sweep();
  const v = lines.get(`${orgId}:${userId}:${String(key || "")}`);
  return v ? { line: v.line, step: v.step, of: v.of, ...(v.words ? { words: v.words } : {}) } : null;
}
module.exports = { set, sayer, get, words, lap };
