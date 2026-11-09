// server/tasks/stewardMeetings.js · FLOWS-1 item 3. A MEETING WITH NO CALENDAR
// CONNECTED IS STILL A MEETING.
//
// Calendar's "Add meeting" booked only through a connected Google or Outlook
// calendar. With none connected (every demo org, and anyone who hasn't
// connected one) Save answered "Connect your calendar first", the dialog's copy
// said it was "Booked on your connected calendar", and nothing was saved.
//
// Now a meeting booked with no calendar connected is kept in Steward itself:
// a calendar_events row with provider "steward" (calendar.js already reads
// that as a meeting of Steward's own). It reaches the record the way a booked
// meeting does (meetingEffects.applyMeeting), moves and cancels in Steward
// only, and nobody is invited or emailed: there is no calendar to send from.
"use strict";
const { newId } = require("../shared/newId");
const ME = () => require("../../meetingEffects");

const PROVIDER = "steward";

async function actorName(query, req, who) {
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  return (me && me.name) || who.name;
}

// POST /donors/:id/book-visit when she has no calendar connected.
async function book({ query, run, actor }, req, res, { donor, title, startsAt, endsAt, location }) {
  const who = actor(req);
  const id = newId("cal");
  await run(
    `INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,booked_in_steward,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,true,?,?)`,
    [id, req.user.orgId, req.user.userId, PROVIDER, id, title, startsAt, endsAt, location, [donor.id], who.id, who.name]);
  await ME().applyMeeting(id, { actorId: who.id, actorName: await actorName(query, req, who) });
  return res.status(201).json({ ok: true, id, inSteward: true,
    // FLOWS-3 (W-1108-Volunteers-19X): they ARE on it; what did not happen is an invitation.
    sentence: `Saved on Steward's calendar, with ${donor.name}. No invitation was sent: there is no calendar connected to send one from.` });
}

// FLOWS-4: the key one user action carries (a drag, a reschedule), so its
// timeline note is written once however many requests it arrives as.
const actionKeyOf = req => { const k = String((req.body && req.body.actionKey) || ""); return /^[A-Za-z0-9_-]{8,64}$/.test(k) ? k : null; };

// POST /calendar/events/:id/move for a meeting kept in Steward.
async function move({ query, run, actor }, req, res, c, { startsAt, endsAt }) {
  await run(`UPDATE calendar_events SET starts_at=?, ends_at=?, updated_at=NOW() WHERE id=? AND org_id=?`, [startsAt, endsAt, c.id, req.user.orgId]);
  const who = actor(req);
  await ME().applyMeeting(c.id, { actorId: who.id, actorName: await actorName(query, req, who), actionKey: actionKeyOf(req) });   // FLOWS-4: one drag, one note
  return res.json({ ok: true, sentence: "Moved, and the prep, the follow-up and the next step moved with it." });
}

// POST /calendar/events/:id/cancel for a meeting kept in Steward.
async function cancel({ query, run, actor }, req, res, c) {
  const who = actor(req);
  await ME().revertMeeting(c.id, { actorId: who.id, actorName: await actorName(query, req, who) });
  await run(`DELETE FROM calendar_events WHERE id=? AND org_id=?`, [c.id, req.user.orgId]);
  return res.json({ ok: true, sentence: "Cancelled. The prep and follow-up are closed and the next step is back to what it was." });
}

module.exports = { PROVIDER, book, move, cancel, actionKeyOf };
