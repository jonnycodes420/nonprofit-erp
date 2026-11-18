// server/admin/sales/touch.js · SALES-4. THE LAST TOUCH ON EVERY SALES RECORD.
//
// A touch is anything that reached the person: a call, a meeting, a note, an email drafted, or
// an email captured from the sales mailbox (either way). A task is not a touch: it is a plan.
// lastTouches(query) reads them in two statements, never one per row, and answers
//   "org:<id>" | "contact:<id>" | "deal:<id>"  →  { at, kind, outcome, direction, says }
// A deal's own last touch is the newest of its own, its organization's and its people's, so a
// call logged on the organization still counts for the deal (dealTouch).
//
// reasonOf(touch, now) is the short reason Now shows ("Interested 6 days ago").
"use strict";

const DAY = 86400000;
const OUTCOME_WORDS = {
  no_answer: "No answer", voicemail: "Left voicemail", gatekeeper: "Reached the gatekeeper", not_now: "Said not now",
  interested: "Interested", meeting_booked: "Booked a meeting", not_a_fit: "Not a fit", bad_number: "Bad number",
};

async function lastTouches(query, now = Date.now()) {
  const [acts, mails] = await Promise.all([
    query(`SELECT DISTINCT ON (l.record_type, l.record_id) l.record_type, l.record_id, a.at, a.kind, a.outcome, a.body
             FROM sales_activity_links l JOIN sales_activities a ON a.id = l.activity_id AND a.deleted_at IS NULL AND a.kind <> 'task'
            WHERE a.at <= ?
            ORDER BY l.record_type, l.record_id, a.at DESC`, [new Date(now + 60000).toISOString()]),
    query(`SELECT DISTINCT ON (l.record_type, l.record_id) l.record_type, l.record_id, e.sent_at AS at, e.direction, e.subject
             FROM sales_email_links l JOIN sales_emails e ON e.id = l.email_id
            ORDER BY l.record_type, l.record_id, e.sent_at DESC`),
  ]);
  const out = new Map();
  const put = (k, t) => { const have = out.get(k); if (!have || new Date(t.at) > new Date(have.at)) out.set(k, t); };
  for (const a of acts) put(`${a.record_type}:${a.record_id}`, { at: new Date(a.at).toISOString(), kind: a.kind, outcome: a.outcome || null, says: String(a.body || "").slice(0, 140) });
  for (const e of mails) put(`${e.record_type}:${e.record_id}`, { at: new Date(e.at).toISOString(), kind: "email", direction: e.direction, says: String(e.subject || "").slice(0, 140) });
  return out;
}

// The newest of several records' touches (a deal, its org, its people).
function newest(touches, keys) {
  let best = null;
  for (const k of keys) { const t = touches.get(k); if (t && (!best || new Date(t.at) > new Date(best.at))) best = t; }
  return best;
}
function dealTouch(touches, deal, contactIds = []) {
  return newest(touches, [`deal:${deal.id}`, ...(deal.linked_org_ids || []).map(id => `org:${id}`), ...contactIds.map(id => `contact:${id}`)]);
}

const daysSince = (t, now) => (t ? Math.max(0, Math.floor((now - new Date(t).getTime()) / DAY)) : null);
const ago = n => (n == null ? "" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

// "Interested 6 days ago", "Emailed 3 days ago", "They replied yesterday", "No touch yet".
function reasonOf(t, now) {
  if (!t) return "No touch yet";
  const when = ago(daysSince(t.at, now));
  if (t.kind === "call") return `${OUTCOME_WORDS[t.outcome] || "Called"} ${when}`;
  if (t.kind === "email") return t.direction === "in" ? `They replied ${when}` : `Emailed ${when}`;
  if (t.kind === "meeting") return new Date(t.at).getTime() > now ? "Meeting ahead" : `Met ${when}`;
  return `Note ${when}`;
}

// A list cell: "Called · Nov 12" style words, with the day.
function cellOf(t) {
  if (!t) return null;
  const kind = t.kind === "call" ? (OUTCOME_WORDS[t.outcome] || "Call") : t.kind === "email" ? (t.direction === "in" ? "Their email" : "Email") : t.kind === "meeting" ? "Meeting" : "Note";
  return { at: t.at, kind };
}

module.exports = { OUTCOME_WORDS, lastTouches, newest, dealTouch, daysSince, reasonOf, cellOf, DAY };
