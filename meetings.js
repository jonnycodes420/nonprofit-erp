// meetings.js — FIX-14 Part 1. "MEETINGS WITH THIS PERSON", DEFINED ONCE.
//
// Before this, five surfaces each wrote their own idea of a meeting. The
// header's Last met, the rail's Meetings this year and rhythm strip, the
// timeline's Meetings chip, Coming up, the "No meeting in 90 days" filter, the
// meetings-per-staff report and the morning brief. Some read the calendar
// only, some read both, and the calendar half dated an event by its UTC day,
// so a 9pm meeting in New York was "tomorrow". A meeting logged by hand on the
// profile then showed in one count and not in the next one beside it.
//
// A MEETING WITH SOMEBODY ON FILE is either
//   · a calendar meeting (INT-BUILD-1's calendar_events) with them, that was
//     not logged afterwards; or
//   · a meeting interaction: logged by hand ("Log a conversation", Meeting or
//     Visit; the touchpoint form's Meeting), or written when a calendar
//     meeting was logged. A logged calendar meeting is counted once, as that.
// Its DATE is the civil day in the ORGANISATION's timezone (orgTime.js's
// discipline): a logged meeting carries the day she chose; a calendar meeting
// is read in the org's zone here, in SQL, never by its UTC date.
// It is HELD when it has happened: a calendar meeting that has started, or a
// logged meeting dated on or before the org's today. A logged meeting dated
// ahead is one still to come, and shows in Coming up rather than in Last met.
//
// Every surface reads this: figureSources (donor-last-met, meetings,
// no-recent-meeting), GET /donors/:id/relationship (timeline, rhythm, this
// year, Coming up), the meeting brief and the morning email (meetingBrief and
// composeTodayMeetings), /meetings/by-staff and Home's Visits YTD.
"use strict";

const { query } = require("./db");

// The org's zone, in SQL, from the org row itself. Written by the timezone
// route only after orgTime.isValidTimezone, and NOT NULL with a default.
const TZ_OF = alias => `(SELECT COALESCE(NULLIF(oz.timezone, ''), 'America/New_York') FROM orgs oz WHERE oz.id = ${alias}.org_id)`;
// A calendar meeting's civil day, in the org's zone.
const CAL_DATE = `TO_CHAR(c.starts_at AT TIME ZONE ${TZ_OF("c")}, 'YYYY-MM-DD')`;
// The org's civil today, at the instant the query runs.
const ORG_TODAY = alias => `TO_CHAR(NOW() AT TIME ZONE ${TZ_OF(alias)}, 'YYYY-MM-DD')`;

// meetingsSql — THE ONE QUERY. Every column a surface needs; the figure
// sources select from it and shape their rows. Options, all optional:
//   donor   only meetings with this person
//   staff   only meetings on this staff member's calendar or logged by them
//   from/to civil date range, inclusive, on the meeting's org-local day
//   held    true = only meetings that have happened; false = only ones to come
//   eachPerson  without a donor, one row per person on a calendar meeting
//           (for "when did we last meet each person"); otherwise a calendar
//           meeting is one row, under the first person on it
// Returns { sql, args } for a subquery with columns:
//   id, kind ('calendar'|'logged'), donor_id, title, note, date, starts_at,
//   ends_at, location, staff_id, who, held, interaction_type
function meetingsSql(orgId, { donor = null, staff = null, from = null, to = null, held = null, eachPerson = false } = {}) {
  const ca = [orgId], ia = [orgId];
  let wc = "", wi = "";
  if (donor) { wc += " AND ? = ANY(c.person_ids)"; ca.push(donor); wi += " AND i.donor_id = ?"; ia.push(donor); }
  if (staff) { wc += " AND c.owner_user_id = ?"; ca.push(staff); wi += " AND i.created_by = ?"; ia.push(staff); }
  if (from) { wc += ` AND ${CAL_DATE} >= ?`; ca.push(from); wi += " AND i.date >= ?"; ia.push(from); }
  if (to) { wc += ` AND ${CAL_DATE} <= ?`; ca.push(to); wi += " AND i.date <= ?"; ia.push(to); }
  if (held === true) { wc += " AND c.starts_at <= NOW()"; wi += ` AND i.date <= ${ORG_TODAY("i")}`; }
  if (held === false) { wc += " AND c.starts_at > NOW()"; wi += ` AND i.date > ${ORG_TODAY("i")}`; }
  // With a donor, the calendar row is THEIR meeting; without one it is counted
  // once, under the first person on it (a meeting with two people is one meeting).
  const calDonor = donor ? "?::text" : eachPerson ? "unnest(c.person_ids)" : "c.person_ids[1]";
  const calArgs = donor ? [donor, ...ca] : ca;
  const sql = `
    SELECT c.id, 'calendar' AS kind, ${calDonor} AS donor_id, c.title, c.note, ${CAL_DATE} AS date,
           c.starts_at, c.ends_at, c.location, c.owner_user_id AS staff_id, u.name AS who,
           (c.starts_at <= NOW()) AS held, 'meeting' AS interaction_type
      FROM calendar_events c LEFT JOIN users u ON u.id = c.owner_user_id
     WHERE c.org_id = ? AND c.interaction_id IS NULL AND cardinality(c.person_ids) > 0${wc}
    UNION ALL
    SELECT i.id, 'logged' AS kind, i.donor_id, NULL AS title, i.note, LEFT(i.date, 10) AS date,
           NULL::timestamptz AS starts_at, NULL::timestamptz AS ends_at, i.metadata->>'location' AS location,
           -- INTEGRITY-1 (W-1107-Fundraising-03): the staff name is the user's, by id, never the text typed when it was logged
           i.created_by AS staff_id, COALESCE(lu.name, i.logged_by_name) AS who,
           (i.date <= ${ORG_TODAY("i")}) AS held, i.type AS interaction_type
      FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      LEFT JOIN users lu ON lu.id = i.created_by
     WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.type = 'meeting'
       AND i.date IS NOT NULL AND i.date <> ''${wi}`;
  return { sql, args: [...calArgs, ...ia] };
}

// meetingsWith — the rows themselves, for a person, newest first. What the
// relationship read and the brief use; the figure sources use meetingsSql.
async function meetingsWith(orgId, donorId, opts = {}) {
  const { sql, args } = meetingsSql(orgId, { ...opts, donor: donorId });
  const lim = Math.max(1, Math.min(1000, Number(opts.limit) || 500));
  const rows = await query(`SELECT * FROM (${sql}) m ORDER BY m.date DESC NULLS LAST, m.starts_at DESC NULLS LAST, m.id DESC LIMIT ${lim}`, args);
  return rows.map(r => ({ ...r, held: r.held === true || r.held === "t" }));
}

// The newest meeting with this person that has happened, or null.
async function lastMeetingWith(orgId, donorId, { before = null } = {}) {
  const rows = await meetingsWith(orgId, donorId, { held: true, ...(before ? { to: before } : {}), limit: 1 });
  return rows[0] || null;
}

// ── FIX-24 2b · LAST CONVERSATION, DEFINED ONCE ────────────────────────────
// THE RULE (COUNTS-1): a conversation with somebody, and so their LAST
// CONTACT, is the latest of
//   · a meeting (above: a held calendar meeting, or one logged by hand);
//   · a call, an email sent or received, an ask or a stewardship touch logged
//     on their record;
//   · a note somebody marked as a conversation (metadata.conversation);
//   · an event they came to (shared/numbers/events.js EVENT_CAME), on its day;
// dated on or before the org's today. A PLAIN NOTE IS NOT A CONVERSATION,
// whoever wrote it, so nothing the Agent writes as a note moves it; and a
// newsletter line (system:email-marketing) is not one either.
// The LAST MEETING is lastMeetingWith above, and since every meeting is a
// conversation, the last conversation is never older than the last meeting.
// Read by the header's Last contact (figureSources donor-contact-gap), the
// About sentence (routes/profileStatus.js) and Engagement's sentence
// (lastContactWith, GET /donors/:id/scores), so the three cannot disagree.
// It used to leave out events and marked notes, and the header read only Last
// met and Last email, so a call logged today left it at "none yet".
const CONVERSATION_TYPES = ["call", "email", "ask", "stewardship"];
async function conversationsWith(orgId, donorId, { limit = 500 } = {}) {
  const lim = Math.max(1, Math.min(1000, Number(limit) || 500));
  const { EVENT_CAME } = require("./shared/numbers/events");
  const [talk, came] = await Promise.all([query(
    `SELECT i.id, 'logged' AS kind, i.donor_id, i.type, i.note, LEFT(i.date, 10) AS date, i.logged_by_name AS who
       FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = ? AND i.donor_id = ? AND d.deleted_at IS NULL
        AND (i.type = ANY(?) OR (i.type = 'note' AND COALESCE(i.metadata->>'conversation', '') = 'true'))
        AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%'
        AND i.date IS NOT NULL AND i.date <> '' AND LEFT(i.date, 10) <= ${ORG_TODAY("i")}
      ORDER BY i.date DESC NULLS LAST, i.id DESC LIMIT ${lim}`, [orgId, donorId, CONVERSATION_TYPES]),
    query(
    `SELECT * FROM (SELECT DISTINCT ON (e.id) a.id, 'event' AS kind, a.donor_id, 'event' AS type, e.name AS note, LEFT(e.date::text, 10) AS date, NULL AS who
       FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
       JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
      WHERE a.org_id = ? AND a.donor_id = ? AND d.deleted_at IS NULL AND ${EVENT_CAME("a")}
        AND e.date IS NOT NULL AND LEFT(e.date::text, 10) <= ${ORG_TODAY("a")}
      ORDER BY e.id, a.id) x ORDER BY x.date DESC, x.id DESC LIMIT ${lim}`, [orgId, donorId])]);
  const met = (await meetingsWith(orgId, donorId, { held: true, limit: lim }))
    .map(m => ({ id: m.id, kind: m.kind, donor_id: m.donor_id, type: "meeting", note: m.kind === "calendar" ? (m.title || "Meeting") : m.note, date: m.date, who: m.who }));
  return [...talk, ...came, ...met].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))).slice(0, lim);
}
// The one Last contact: { date, type, kind, note } of the newest conversation, or null.
async function lastContactWith(orgId, donorId) {
  const [r] = await conversationsWith(orgId, donorId, { limit: 1 });
  return r ? { date: String(r.date).slice(0, 10), type: r.type, kind: r.kind, note: r.note || null } : null;
}

// TOP100-1 · THE SAME LAST CONTACT FOR MANY PEOPLE AT ONCE (the Top 100's
// column and Atlas's "not touched in 60 days"). conversationsWith's rule, the
// newest per person, read set-wise: three reads for any number of people,
// never one per row. A Map of donorId -> { date, type, kind }.
async function lastContactsFor(orgId, donorIds) {
  const ids = [...new Set((donorIds || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const { EVENT_CAME } = require("./shared/numbers/events");
  const m = meetingsSql(orgId, { held: true, eachPerson: true });
  const [talk, came, met] = await Promise.all([query(
    `SELECT DISTINCT ON (i.donor_id) i.donor_id, i.type, 'logged' AS kind, LEFT(i.date, 10) AS date
       FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = ? AND i.donor_id = ANY(?::text[]) AND d.deleted_at IS NULL
        AND (i.type = ANY(?) OR (i.type = 'note' AND COALESCE(i.metadata->>'conversation', '') = 'true'))
        AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%'
        AND i.date IS NOT NULL AND i.date <> '' AND LEFT(i.date, 10) <= ${ORG_TODAY("i")}
      ORDER BY i.donor_id, LEFT(i.date, 10) DESC, i.id DESC`, [orgId, ids, CONVERSATION_TYPES]),
    query(
    `SELECT a.donor_id, 'event' AS type, 'event' AS kind, MAX(LEFT(e.date::text, 10)) AS date
       FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
       JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
      WHERE a.org_id = ? AND a.donor_id = ANY(?::text[]) AND d.deleted_at IS NULL AND ${EVENT_CAME("a")}
        AND e.date IS NOT NULL AND LEFT(e.date::text, 10) <= ${ORG_TODAY("a")}
      GROUP BY a.donor_id`, [orgId, ids]),
    query(`SELECT x.donor_id, 'meeting' AS type, MAX(x.kind) AS kind, MAX(x.date) AS date FROM (${m.sql}) x
            WHERE x.donor_id = ANY(?::text[]) GROUP BY x.donor_id`, [...m.args, ids])]);
  for (const r of [...talk, ...came, ...met]) {
    const date = String(r.date || "").slice(0, 10);
    const had = out.get(r.donor_id);
    if (date && (!had || date > had.date)) out.set(r.donor_id, { date, type: r.type, kind: r.kind });
  }
  return out;
}

module.exports = { meetingsSql, meetingsWith, lastMeetingWith, conversationsWith, lastContactWith, lastContactsFor, CONVERSATION_TYPES, CAL_DATE };
