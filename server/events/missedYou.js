// server/events/missedYou.js · FLOWS-4 (W-1109-Volunteers-01X). "MISSED YOU"
// GOES TO THE PEOPLE WHO MISSED IT, AS THE GUEST LIST STANDS.
//
// The QA fleet (9 Nov): the "Missed you at QA A4 Gala" draft went to Renee,
// who came and gave, and not to Jonathan A, who registered and never came.
// Renee had been marked No Show first and then Attended: her draft, written at
// the first mark, stayed in Drafts, and Jonathan, Registered and never marked,
// was never anybody's draft. The task stayed open after the event was archived
// and its draft dismissed.
//
// The rules now (THREAD-3's one task per event and one draft per person stay):
//   · The audience is read from the guest statuses at the moment the drafts
//     are made: "missed you" is everyone Registered (or Confirmed, or marked No
//     Show) and not Attended. Invited people who never said yes, and people who
//     declined or cancelled, are not in it. "Thanks for coming" is Attended
//     (the follow-up tasks, server/events/routes.js, already read EVENT_CAME).
//   · Drafts are first made when somebody is marked as not having come (the
//     trigger THREAD-3 had). Each later change of a guest's status refreshes the
//     set, drafting anyone who joins the audience:
//     a person who is no longer in the audience has their waiting draft retired
//     ("came after all"), and the task's title counts who is left.
//   · Archiving the event retires its waiting drafts and closes its open
//     tasks, with the note "event archived" (retireForArchive).
// Nothing here sends anything.
"use strict";
const { query, run } = require("../db/query");
const { newId } = require("../shared/newId");
const orgTime = require("../../orgTime");

const KEY = eventId => `event_missed:${eventId}`;
// Registered but not Attended. `a` is event_attendees.
const MISSED_SQL = a => `lower(coalesce(${a}.status,'')) IN ('registered','confirmed','no_show')
  AND ${a}.checked_in_at IS NULL`;
const ARCHIVED_NOTE = "event archived";
const CAME_NOTE = "no longer missed: their guest status changed";

async function audience(orgId, eventId) {
  return query(
    `SELECT DISTINCT ON (ea.donor_id) ea.donor_id, d.name, d.email FROM event_attendees ea
       JOIN donors d ON d.id = ea.donor_id AND d.org_id = ea.org_id
      WHERE ea.event_id=? AND ea.org_id=? AND ${MISSED_SQL("ea")}
        AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE
        -- one person on two rows of the list (a party and a seat) who came on either did not miss it
        AND NOT EXISTS (SELECT 1 FROM event_attendees x WHERE x.event_id = ea.event_id AND x.org_id = ea.org_id
                          AND x.donor_id = ea.donor_id AND (lower(coalesce(x.status,'')) = 'attended' OR x.checked_in_at IS NOT NULL))
      ORDER BY ea.donor_id`, [eventId, orgId]);
}

// A waiting draft for somebody who is no longer in the audience is retired.
async function retireStale(orgId, eventId, keep) {
  const ids = keep.map(m => m.donor_id);
  return query(
    `UPDATE milestone_drafts SET status='archived', archived_at=NOW(), archived_by='system:event-guest-status', archived_by_name=?
      WHERE org_id=? AND milestone_key=? AND status='pending_review' AND sent_at IS NULL AND NOT (donor_id = ANY(?::text[]))
      RETURNING id, donor_id`, [CAME_NOTE, orgId, KEY(eventId), ids]);
}

// Make (or bring up to date) the event's "Missed you" drafts and its one task.
//   make: true when somebody was just marked as not having come; false when a
//         status changed some other way (only retire and recount then).
async function refresh(orgId, eventId, who, { make = true } = {}) {
  const [event] = await query("SELECT id, name, archived_at FROM events WHERE id=? AND org_id=?", [eventId, orgId]);
  if (!event) return null;
  const missed = event.archived_at ? [] : await audience(orgId, event.id);
  await retireStale(orgId, event.id, missed);
  const [open] = await query("SELECT id FROM tasks WHERE org_id=? AND event_id=? AND type='event_no_show'", [orgId, event.id]);
  if (!make && !open) return null;
  // Once the event's "Missed you" task exists, the drafts follow the list: a
  // guest who becomes Registered-and-not-Attended later gets theirs too.
  make = make || !!open;
  const EV = await import("../../shared/eventShape.js");
  const BKit = await import("../../shared/brandKit.js");
  const GR = await import("../../shared/greeting.js");
  const [u] = who && who.id ? await query(`SELECT ${BKit.SIGN_COLUMNS} FROM users WHERE id=? AND org_id=?`, [who.id, orgId]) : [];
  const signature = BKit.personSignature(u) || (u && u.name) || (who && who.name) || "";   // FIX-57: her own block first
  if (make) {
    for (const m of missed) {
      if (!m.email) continue;
      // Never a second draft for one person and event: one waiting, sent or dismissed stays the only one.
      const [had] = await query("SELECT id FROM milestone_drafts WHERE org_id=? AND donor_id=? AND milestone_key=? AND archived_by IS DISTINCT FROM 'system:event-guest-status'",
        [orgId, m.donor_id, KEY(event.id)]);
      if (had) continue;
      // A draft retired because they were marked as come, and now missed again, comes back.
      const back = await query(`UPDATE milestone_drafts SET status='pending_review', archived_at=NULL, archived_by=NULL, archived_by_name=NULL
                                 WHERE org_id=? AND donor_id=? AND milestone_key=? AND archived_by='system:event-guest-status' AND sent_at IS NULL RETURNING id`,
        [orgId, m.donor_id, KEY(event.id)]);
      if (back.length) continue;
      const values = { first_name: GR.firstNames(m), greeting: GR.greetingName(m), event_name: event.name, signature };
      await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,'pending_review','template',?,?)`,
        [newId("md"), orgId, m.donor_id, KEY(event.id),
         BKit.renderTemplate(EV.MISSED_YOU.subject, values).text, BKit.renderTemplate(EV.MISSED_YOU.body, values).text,
         who.id, who.name]);
    }
  }
  const [drafted] = await query("SELECT COUNT(*)::int AS c FROM milestone_drafts WHERE org_id=? AND milestone_key=? AND status='pending_review'", [orgId, KEY(event.id)]);
  if (open) {
    if (!missed.length) {
      // Nobody missed it after all: the task closes and says why.
      await run(`UPDATE tasks SET voided_at=NOW(), voided_reason=?, updated_at=NOW() WHERE id=? AND org_id=? AND COALESCE(done,0)=0 AND voided_at IS NULL`,
        [event.archived_at ? ARCHIVED_NOTE : "nobody missed it", open.id, orgId]);
      return open.id;
    }
    await run("UPDATE tasks SET title=?, voided_at=NULL, voided_reason=NULL, updated_at=NOW() WHERE id=? AND org_id=? AND (voided_reason IS NULL OR voided_reason <> ?)",
      [EV.missedYouTaskTitle(event.name, missed.length, drafted ? drafted.c : 0), open.id, orgId, ARCHIVED_NOTE]);
    return open.id;
  }
  if (!missed.length) return null;
  const owner = u ? { id: who.id, name: u.name } : (await query(
    `SELECT id, name, email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL ORDER BY created_at ASC LIMIT 1`, [orgId]))[0];
  const id = newId("t");
  const today = orgTime.orgToday((await query("SELECT timezone FROM orgs WHERE id=?", [orgId]))[0] || {});   // ORG_TZ_SEAM_OK
  await run(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,event_id,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES (?,?,?,?,'medium','event_no_show',0,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [id, orgId, EV.missedYouTaskTitle(event.name, missed.length, drafted ? drafted.c : 0), orgTime.addDays(today, 2), event.id,
     owner ? owner.id : null, owner ? (owner.name || owner.email || "") : null, who.id, who.name]);
  return id;
}

// Archiving an event: its waiting drafts are retired and its open tasks closed,
// each with the note "event archived". Unarchiving does not bring them back.
async function retireForArchive(orgId, eventId) {
  const drafts = await query(
    `UPDATE milestone_drafts SET status='archived', archived_at=NOW(), archived_by='system:event-archive', archived_by_name=?
      WHERE org_id=? AND milestone_key=? AND status='pending_review' AND sent_at IS NULL RETURNING id`,
    [ARCHIVED_NOTE, orgId, KEY(eventId)]);
  const tasks = await query(
    `UPDATE tasks SET voided_at=NOW(), voided_reason=?, updated_at=NOW()
      WHERE org_id=? AND event_id=? AND COALESCE(done,0)=0 AND voided_at IS NULL RETURNING id`,
    [ARCHIVED_NOTE, orgId, eventId]);
  return { drafts: drafts.length, tasks: tasks.length };
}

module.exports = { refresh, retireForArchive, audience, ARCHIVED_NOTE, KEY };
