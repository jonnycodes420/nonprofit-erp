// server/volunteers/personShifts.js · FLOWS-3 (W-1107-Volunteers-24, a repeat).
// ONE PERSON'S SCHEDULED SHIFTS, READ FROM THE SCHEDULE'S OWN ROWS.
//
// The fleet saw two shifts on the Schedule that the volunteer's own record
// did not show: the Volunteers page's drawer said "1 shift, Coming up:
// Nothing on the schedule yet." STALE-2 added Past shifts to the profile's
// panel, but the drawer kept its own read (future dates only), and the two
// reads disagreed with the Schedule about which places count.
//
// Now there is one rule. A place counts for a person exactly when the
// Schedule shows them on it (routes/volunteerScheduling.js scheduleRows):
// a sign-up that is confirmed, waiting, done or marked as not coming, on a
// shift not cancelled, held by a person not deleted. Coming up is today and
// after; Past is before today. The profile's panel and the drawer both read
// here.
"use strict";

// The statuses the Schedule lists a person under. scheduleRows reads this too.
const SCHEDULE_STATUSES = ["confirmed", "waitlisted", "completed", "no_show"];
const SCHEDULE_STATUS_SQL = SCHEDULE_STATUSES.map(s => `'${s}'`).join(",");

const STATUS_NOTE = { waitlisted: " (waiting list)", no_show: " (did not come)" };

async function personShifts(query, orgId, personId, today, { upcomingLimit = 20, pastLimit = 20 } = {}) {
  // cmp and order are the two constants below, never a request's text.
  const read = (cmp, order, limit) => query(
    `SELECT su.id AS "signupId", su.slot_id AS "slotId", su.status, su.position, s.date, s.start_time AS "startTime", s.end_time AS "endTime",
            COALESCE(s.name, o.name) AS name, o.name AS opportunity, COALESCE(s.venue, o.location) AS location
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id AND s.org_id = su.org_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
       JOIN donors d ON d.id = su.person_id AND d.org_id = su.org_id AND d.deleted_at IS NULL
      WHERE su.org_id = ? AND su.person_id = ? AND su.status IN (${SCHEDULE_STATUS_SQL})
        AND s.cancelled_at IS NULL AND s.date ${cmp} ?
      ORDER BY ${order} LIMIT ?`, [orgId, personId, today, Math.max(1, Math.min(100, Number(limit) | 0))]);
  const [upcoming, past] = await Promise.all([
    read(">=", "s.date, s.start_time", upcomingLimit),
    read("<", "s.date DESC, s.start_time DESC", pastLimit),
  ]);
  const shape = r => ({ ...r, date: String(r.date).slice(0, 10), when: `${r.name}, ${String(r.date).slice(0, 10)}${STATUS_NOTE[r.status] || ""}` });
  return { upcoming: upcoming.map(shape), past: past.map(shape) };
}

module.exports = { SCHEDULE_STATUSES, SCHEDULE_STATUS_SQL, personShifts };
