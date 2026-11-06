// server/atlas/progress.js · ATLAS-3. THE STATUS LINE SAYS WHAT ATLAS IS DOING NOW.
//
// The dialog used to spin "Drafting the email" while Atlas marked an
// attendance, readied a gift, started a journey and wrote the email. Now the
// browser sends a key with the request and asks GET /atlas/progress/:key
// while it waits; each step sets the line as it starts ("Step 2 of 4:
// Getting Undine's $10,000 gift ready for your tap"). Kept in memory for a
// minute: it is a status line, not a record, and nothing reads it later.
"use strict";
const LIVE_MS = 60 * 1000;
const lines = new Map();   // key -> { line, step, of, at, user }

const WORDS = {
  came_to_event: n => `Marking ${n} as attended`, register_for_event: n => `Adding ${n} to the guest list`, gift: n => `Getting ${n}'s gift ready for your tap`,
  pledge: n => `Getting ${n}'s pledge ready for your tap`, add_to_journey: n => `Adding ${n} to the journey`, remove_from_journey: n => `Taking ${n} out of the journey`,
  add_to_group: n => `Adding ${n} to the group`, remove_from_group: n => `Taking ${n} out of the group`, draft_email: n => `Writing the email to ${n}`,
  send_now: n => `Writing the email to ${n}`, reminder: () => "Setting the reminder", log_conversation: n => `Logging the conversation with ${n}`,
  note: n => `Saving the note on ${n}`, send_receipt: n => `Getting ${n}'s receipt ready`, question: () => "Looking it up in your records",
  find: n => `Finding ${n}`, about: n => `Reading ${n}'s record`, link: n => `Linking ${n}`, undo: () => "Undoing", merge: () => "Checking the two records",
  recurring_change: () => "Checking", personal_detail: () => "Holding a detail back", other: () => "Working on it",
};
const keyOf = req => { const k = String((req.body && req.body.progressKey) || ""); return /^[a-z0-9-]{8,64}$/i.test(k) ? `${req.user.orgId}:${req.user.userId}:${k}` : null; };
function sweep() { const now = Date.now(); for (const [k, v] of lines) if (now - v.at > LIVE_MS) lines.delete(k); }
function set(req, line, step = 0, of = 0) {
  const k = keyOf(req); if (!k) return;
  sweep();
  lines.set(k, { line, step, of, at: Date.now() });
}
// One call per step, in order: "Step 2 of 4: Writing the email to Undine".
function sayer(req, of) {
  let i = 0;
  return (st, name) => {
    i += 1;
    const w = (WORDS[st.kind] || WORDS.other)(String(name || "them").split(/\s+/)[0]);
    set(req, of > 1 ? `Step ${i} of ${of}: ${w}` : w, i, of);
  };
}
function get(orgId, userId, key) {
  sweep();
  const v = lines.get(`${orgId}:${userId}:${String(key || "")}`);
  return v ? { line: v.line, step: v.step, of: v.of } : null;
}
module.exports = { set, sayer, get };
