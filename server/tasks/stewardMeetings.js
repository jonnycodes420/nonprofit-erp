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
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests

// FLOWS-10 items 1 and 9 (W-1112-Volunteers-17, W-1113-Volunteers-18): A DEMO ORG'S MEETINGS ARE
// KEPT IN STEWARD. FLOWS-1 kept a meeting in Steward when no calendar is connected, "every demo
// org" among them, but the Harborlight seed gives Dana a connected calendar, so Add meeting and a
// meeting's drag took the connected path, where a demo org is refused with the mailbox sentence
// ("In the demo, connecting is turned off…"): nothing saved, nothing moved, and the words were
// about a mailbox. FLOWS-8 checked it in org_stagewalk, which has no calendar, so it passed there.
// Now booking, moving and cancelling in a demo org happen in Steward only, and say so.
const { isDemoOrg } = require("../../orgKind");
async function keptInSteward(query, orgId) {
  if (PLANT === "demomeeting") return false;
  const [o] = await query(`SELECT id, org_kind FROM orgs WHERE id=?`, [orgId]);
  return !!(o && isDemoOrg(o));
}
const DEMO_SAVED = "This is a demonstration organization, so it is kept in Steward: nothing goes to a real calendar and nobody is invited.";
const DEMO_NO_INVITE = "In the demo nobody is invited: Steward sends nothing here. Untick \"Also invite\" and the meeting is saved in Steward.";

async function actorName(query, req, who) {
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  return (me && me.name) || who.name;
}

// POST /donors/:id/book-visit when she has no calendar connected.
async function book({ query, run, actor }, req, res, { donor, title, startsAt, endsAt, location, demo = false }) {
  const who = actor(req);
  const id = newId("cal");
  await run(
    `INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,booked_in_steward,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,true,?,?)`,
    [id, req.user.orgId, req.user.userId, PROVIDER, id, title, startsAt, endsAt, location, [donor.id], who.id, who.name]);
  await ME().applyMeeting(id, { actorId: who.id, actorName: await actorName(query, req, who) });
  return res.status(201).json({ ok: true, id, inSteward: true,
    // FLOWS-3 (W-1108-Volunteers-19X): they ARE on it; what did not happen is an invitation.
    sentence: demo ? `Saved on Steward's calendar, with ${donor.name}. ${DEMO_SAVED}`
      : `Saved on Steward's calendar, with ${donor.name}. No invitation was sent: there is no calendar connected to send one from.` });
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

module.exports = { PROVIDER, book, move, cancel, actionKeyOf, keptInSteward, DEMO_NO_INVITE };
