// meetingEffects.js — FIX-33 Part 3. A BOOKED MEETING CHANGES THE WHOLE RECORD.
//
// Jonathan booked "Visit with Christine" from Steward. It reached Outlook and
// the profile's Coming up, and nothing else moved: the Next step still said
// nothing was open, Engagement was still 0, the timeline had no line. A booked
// meeting is the most important thing that can happen to a donor record, so
// this module is the ONE place that makes it count, and the one place that
// undoes it.
//
//   applyMeeting(eventId)   a meeting with a person on file is on a calendar,
//                           from Steward or synced in. Idempotent: a second
//                           call with the same time changes nothing; a call
//                           with a new time MOVES everything it made.
//   revertMeeting(eventId)  the meeting was cancelled or left the calendar.
//                           Everything it made comes off and the step it took
//                           over is put back.
//   meetingLogged(eventId, interactionId)  she wrote down how it went. The
//                           tasks close, the step closes (or the step it took
//                           over comes back), and the record keeps the note.
//
// WHAT IT DOES, per person on the meeting (meeting_effects keeps the receipts):
//   · NEXT STEP becomes the meeting ("Visit with Christine, Fri 16 Oct,
//     Drinklings"). If a step was already open it is taken over, and what it
//     said before is kept so a cancel or a logged meeting gives it back.
//   · A PREP TASK on the business day before: "Prep for Christine: read the brief".
//   · AN AFTER TASK on the day: "How did it go with Christine?".
//   · THE TIMELINE gets "Meeting booked for Fri 16 Oct" now; the meeting itself
//     shows on its day from meetings.js, the one meetings source.
//   · JOURNEY STEPS within three days of the meeting move to the business day
//     after it, each with a line saying why.
// Only a meeting still to come is applied. A synced meeting that already
// happened is a "how did it go" (GET /calendar/to-log), not a booking.
"use strict";

const { query, run } = require("./db");
const orgTime = require("./orgTime");
const crypto = require("crypto");

// server.js points this at scheduleScores, so a booking moves the stored
// engagement score on the next debounce rather than at the six-hour tick.
function changed(orgId) { try { if (module.exports.onChange) module.exports.onChange(orgId); } catch { /* scores are best effort */ } }
const id = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const NEAR_DAYS = 3;

async function tzOf(orgId) {
  const [o] = await query(`SELECT timezone FROM orgs WHERE id=?`, [orgId]);
  return { timezone: orgTime.normalizeTimezone(o && o.timezone) };
}
// "Fri 16 Oct", the way a person says a day.
function dayWords(day) {
  const d = new Date(String(day).slice(0, 10) + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}
// "16 Oct", for the status line.
function shortDay(day) {
  const d = new Date(String(day).slice(0, 10) + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
const isWeekend = day => orgTime.dayOfWeek(day) >= 5;
function businessDayBefore(day) {
  let d = orgTime.addDays(day, -1);
  while (isWeekend(d)) d = orgTime.addDays(d, -1);
  return d;
}
function businessDayAfter(day) {
  let d = orgTime.addDays(day, 1);
  while (isWeekend(d)) d = orgTime.addDays(d, 1);
  return d;
}
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "them";

// The step's words: the title, the day, the place. Nothing invented.
function meetingLabel(ev, day) {
  return [String(ev.title || "Meeting").trim(), dayWords(day), ev.location ? String(ev.location).trim() : null]
    .filter(Boolean).join(", ").slice(0, 200);
}
function localTime(tz, instant) {
  const c = orgTime.orgClock(tz, new Date(instant));
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

async function note(orgId, donorId, text, day, meta, actorId, actorName) {
  const intId = id("int_");
  await run(
    `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata)
     VALUES (?,?,?,'note',?,?,?,?,?)`,
    [intId, orgId, donorId, text, day, actorId, actorName, JSON.stringify(meta)]);
  return intId;
}

// Move the journey steps that sit within three days of the meeting to the
// business day after it. Returns [{id, from}] so a cancel can put them back.
async function moveNearSteps(orgId, donorId, day, actorId) {
  const lo = orgTime.addDays(day, -NEAR_DAYS), hi = orgTime.addDays(day, NEAR_DAYS);
  const after = businessDayAfter(day);
  const rows = await query(
    `SELECT st.id, LEFT(st.due_date::text, 10) AS due FROM cultivation_plan_steps st
       JOIN cultivation_plans p ON p.id = st.plan_id AND p.org_id = st.org_id
      WHERE st.org_id=? AND p.donor_id=? AND st.status IN ('pending','open') AND st.closed_at IS NULL
        AND LEFT(st.due_date::text, 10) BETWEEN ? AND ?`, [orgId, donorId, lo, hi]).catch(() => []);
  const moved = [];
  for (const r of rows) {
    if (r.due === after) continue;
    await run(
      `UPDATE cultivation_plan_steps SET due_date=?, moved_from=?, moved_reason=? WHERE id=? AND org_id=?`,
      [after, r.due, `Moved to after the meeting on ${dayWords(day)}, so the visit comes first.`, r.id, orgId]);
    // The thread a journey step holds follows its step.
    await run(`UPDATE threads SET due_date=? WHERE org_id=? AND closed_at IS NULL AND id IN
                 (SELECT thread_id FROM cultivation_plan_steps WHERE id=? AND thread_id IS NOT NULL)
                 AND calendar_event_id IS NULL`, [after, orgId, r.id]).catch(() => {});
    moved.push({ id: r.id, from: r.due });
  }
  void actorId;
  return moved;
}
async function restoreSteps(orgId, moved) {
  for (const m of moved || []) {
    await run(`UPDATE cultivation_plan_steps SET due_date=?, moved_from=NULL, moved_reason=NULL
                WHERE id=? AND org_id=? AND status IN ('pending','open')`, [m.from, m.id, orgId]).catch(() => {});
  }
}

async function loadEvent(eventId) {
  const [ev] = await query(`SELECT * FROM calendar_events WHERE id=?`, [eventId]);
  return ev || null;
}

async function applyMeeting(eventId, { actorId = "system:meetings", actorName = "Meetings" } = {}) {
  const ev = await loadEvent(eventId);
  if (!ev || ev.logged_at || ev.dismissed_at) return { applied: 0 };
  const orgId = ev.org_id;
  const tz = await tzOf(orgId);
  const today = orgTime.orgToday(tz);
  const day = orgTime.orgToday(tz, new Date(ev.starts_at));
  const time = localTime(tz, ev.starts_at);
  const label = meetingLabel(ev, day);
  const people = ev.person_ids || [];
  const existing = await query(`SELECT * FROM meeting_effects WHERE calendar_event_id=?`, [eventId]);
  const byDonor = new Map(existing.map(e => [e.donor_id, e]));
  // Somebody taken off the meeting: their part of it comes off.
  for (const e of existing) if (!people.includes(e.donor_id)) await revertOne(e, "removed", actorId, actorName);
  // A meeting that has already started is not a booking.
  if (new Date(ev.starts_at).getTime() <= Date.now()) return { applied: 0 };

  const [owner] = await query(`SELECT id, name FROM users WHERE id=?`, [ev.owner_user_id]);
  let applied = 0;
  for (const donorId of people) {
    const [d] = await query(`SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
    if (!d) continue;
    const first = firstName(d.name);
    const prepDay = (() => { const p = businessDayBefore(day); return p < today ? today : p; })();
    const had = byDonor.get(donorId);
    if (had) {
      if (had.day === day) {
        await run(`UPDATE threads SET next_step_label=?, due_time=? WHERE id=? AND closed_at IS NULL AND calendar_event_id=?`,
          [label, time, had.thread_id, eventId]).catch(() => {});
        continue;
      }
      // MOVED. Everything it made moves with it, and the record says so.
      await run(`UPDATE threads SET next_step_label=?, due_date=?, due_time=? WHERE id=? AND closed_at IS NULL AND calendar_event_id=?`,
        [label, day, time, had.thread_id, eventId]).catch(() => {});
      if (had.prep_task_id) await run(`UPDATE tasks SET due=?, updated_at=NOW() WHERE id=? AND done=0`, [prepDay, had.prep_task_id]);
      if (had.after_task_id) await run(`UPDATE tasks SET due=?, updated_at=NOW() WHERE id=? AND done=0`, [day, had.after_task_id]);
      await restoreSteps(orgId, had.moved_steps);
      const moved = await moveNearSteps(orgId, donorId, day, actorId);
      await note(orgId, donorId, `Meeting moved from ${dayWords(had.day)} to ${dayWords(day)}`, today,
        { kind: "meeting_moved", calendar_event_id: eventId, from_day: had.day, meeting_day: day }, actorId, actorName);
      await run(`UPDATE meeting_effects SET day=?, moved_steps=?::jsonb, updated_at=NOW() WHERE id=?`,
        [day, JSON.stringify(moved), had.id]);
      applied++;
      continue;
    }

    // NEXT STEP. Take over the open step, keeping what it said, or open one.
    const [open] = await query(`SELECT * FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL LIMIT 1`, [orgId, donorId]);
    let threadId, created = false, prev = null;
    if (open && open.calendar_event_id && open.calendar_event_id !== eventId) {
      // Already holding another meeting: the sooner one stays the next step.
      threadId = null;
    } else if (open) {
      prev = { type: open.next_step_type, label: open.next_step_label, due: open.due_date, time: open.due_time || null };
      threadId = open.id;
      await run(`UPDATE threads SET next_step_type='meeting', next_step_label=?, due_date=?, due_time=?, calendar_event_id=?, snoozed_until=NULL
                  WHERE id=? AND closed_at IS NULL`, [label, day, time, eventId, open.id]);
    } else {
      threadId = id("th_mt_");
      created = true;
      await run(
        `INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,due_time,opened_on,owner_id,owner_name,
                              calendar_event_id,created_by,created_by_name)
         VALUES (?,?,?,'meeting',?,?,?,?,?,?,?,?,?)`,
        [threadId, orgId, donorId, label, day, time, today, owner?.id || null, owner?.name || null, eventId, actorId, actorName]);
    }

    const prepId = id("task_mp_"), afterId = id("task_ma_");
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,calendar_event_id)
       VALUES (?,?,?,?,'high','meeting_prep',0,?,?,?,NOW(),?,?,?)`,
      [prepId, orgId, `Prep for ${first}: read the brief`, prepDay, donorId, owner?.id || null, owner?.name || null, actorId, actorName, eventId]);
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,calendar_event_id)
       VALUES (?,?,?,?,'high','meeting_after',0,?,?,?,NOW(),?,?,?)`,
      [afterId, orgId, `How did it go with ${first}?`, day, donorId, owner?.id || null, owner?.name || null, actorId, actorName, eventId]);
    const bookedId = await note(orgId, donorId, `Meeting booked for ${dayWords(day)}`, today,
      { kind: "meeting_booked", calendar_event_id: eventId, meeting_day: day, title: ev.title || null, location: ev.location || null },
      actorId, actorName);
    const moved = await moveNearSteps(orgId, donorId, day, actorId);
    await run(
      `INSERT INTO meeting_effects (id,org_id,calendar_event_id,donor_id,day,thread_id,thread_created,prev_step,prep_task_id,after_task_id,
                                    moved_steps,booked_interaction_id,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?,?) ON CONFLICT (calendar_event_id, donor_id) DO NOTHING`,
      [id("me_"), orgId, eventId, donorId, day, threadId, created, prev ? JSON.stringify(prev) : null, prepId, afterId,
       JSON.stringify(moved), bookedId, actorId, actorName]);
    applied++;
  }
  if (applied) changed(orgId);
  return { applied };
}

// Put back the step a meeting took over; close the one it opened.
async function releaseThread(e, { interactionId = null, reason }) {
  if (!e.thread_id) return;
  const [t] = await query(`SELECT * FROM threads WHERE id=? AND closed_at IS NULL AND calendar_event_id=?`, [e.thread_id, e.calendar_event_id]);
  if (!t) return;
  if (!e.thread_created && e.prev_step) {
    const p = typeof e.prev_step === "string" ? JSON.parse(e.prev_step) : e.prev_step;
    await run(`UPDATE threads SET next_step_type=?, next_step_label=?, due_date=?, due_time=?, calendar_event_id=NULL WHERE id=?`,
      [p.type, p.label, p.due, p.time || null, t.id]);
    return;
  }
  if (interactionId) {
    await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=?`, [interactionId, t.id]);
  } else {
    await run(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason=? WHERE id=?`, [reason, t.id]);
  }
}

async function revertOne(e, why, actorId, actorName) {
  const reason = why === "removed" ? "They were taken off the meeting." : "The meeting was cancelled.";
  await releaseThread(e, { reason });
  for (const tid of [e.prep_task_id, e.after_task_id].filter(Boolean)) {
    await run(`UPDATE tasks SET voided_at=NOW(), voided_reason=?, updated_at=NOW() WHERE id=? AND done=0 AND voided_at IS NULL`,
      [why === "removed" ? "meeting_removed" : "meeting_cancelled", tid]);
  }
  await restoreSteps(e.org_id, typeof e.moved_steps === "string" ? JSON.parse(e.moved_steps) : e.moved_steps);
  // The booking stops counting as engagement; the timeline says what happened.
  if (e.booked_interaction_id)
    await run(`UPDATE interactions SET metadata = metadata || '{"cancelled": true}'::jsonb WHERE id=?`, [e.booked_interaction_id]).catch(() => {});
  const tz = await tzOf(e.org_id);
  await note(e.org_id, e.donor_id,
    why === "removed" ? `Taken off the meeting on ${dayWords(e.day)}` : `Meeting on ${dayWords(e.day)} cancelled`,
    orgTime.orgToday(tz), { kind: "meeting_cancelled", calendar_event_id: e.calendar_event_id, meeting_day: e.day }, actorId, actorName);
  await run(`DELETE FROM meeting_effects WHERE id=?`, [e.id]);
}

async function revertMeeting(eventId, { actorId = "system:meetings", actorName = "Meetings", why = "cancelled" } = {}) {
  const rows = await query(`SELECT * FROM meeting_effects WHERE calendar_event_id=?`, [eventId]);
  for (const e of rows) await revertOne(e, why, actorId, actorName);
  if (rows.length) changed(rows[0].org_id);
  return { reverted: rows.length };
}

// SHE WROTE DOWN HOW IT WENT. The tasks are done and the step is answered.
async function meetingLogged(eventId, interactionId) {
  const rows = await query(`SELECT * FROM meeting_effects WHERE calendar_event_id=?`, [eventId]);
  for (const e of rows) {
    await run(`UPDATE tasks SET done=1, updated_at=NOW() WHERE id = ANY(?) AND done=0`, [[e.prep_task_id, e.after_task_id].filter(Boolean)]);
    await releaseThread(e, { interactionId });
    await run(`DELETE FROM meeting_effects WHERE id=?`, [e.id]);
  }
  return { closed: rows.length };
}

// The next booked meeting per person, for the status line and the drift list
// ("Meeting set for 16 Oct", so nobody calls her twice).
async function meetingSetFor(orgId, donorIds) {
  if (!donorIds || !donorIds.length) return new Map();
  const rows = await query(
    `SELECT DISTINCT ON (me.donor_id) me.donor_id, me.day FROM meeting_effects me
       JOIN calendar_events c ON c.id = me.calendar_event_id
      WHERE me.org_id=? AND me.donor_id = ANY(?) AND c.starts_at > NOW()
      ORDER BY me.donor_id, c.starts_at`, [orgId, donorIds]);
  return new Map(rows.map(r => [r.donor_id, { day: r.day, sentence: `Meeting set for ${shortDay(r.day)}` }]));
}

module.exports = { applyMeeting, revertMeeting, meetingLogged, meetingSetFor, meetingLabel, dayWords, shortDay,
  businessDayBefore, businessDayAfter, NEAR_DAYS };
