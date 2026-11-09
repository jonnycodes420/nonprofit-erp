#!/usr/bin/env node
// scripts/ops/flows4-volunteer-rows.js · FLOWS-4 (W-1109-Volunteers-26, -01X, -18X).
// JONATHAN RUNS IT. A DRY RUN: it reads and prints, and writes nothing.
//
// FLOWS-4 stops new bad rows. Rows written before it still carry the old state.
// By org id, with counts only (no names, no addresses):
//   A. "Missed you" drafts still waiting for somebody who is no longer
//      Registered-and-not-Attended (marked Attended or checked in since, or
//      off the list). The app retires one the next time that event's guest
//      list changes; until then it sits in Drafts.
//   B. "Missed you" drafts still waiting, and open tasks, on events that are
//      archived (archiving now retires both, "event archived").
//   C. pairs of logged hours that look like one entry saved twice: the same
//      person, day, hours and words, by staff, saved within five seconds.
//      Some may be two real shifts; each is a coordinator's call on the
//      person's record (Remove), so this only counts them.
//   D. "Meeting moved" notes written twice for one move: the same person,
//      meeting and days, within two seconds (a back-and-forth drag is two moves, seconds apart).
//
// No --apply: dismissing a draft, closing a task, removing hours and removing
// a note are each a staff decision on the screen that owns it (Drafts, Tasks,
// the person's hours, the timeline). org_creo is left out.
//
//   node scripts/ops/flows4-volunteer-rows.js               # every org
//   node scripts/ops/flows4-volunteer-rows.js --org=org_x   # one org
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const { Pool } = require("pg");

const ORG = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const SCOPE = (a) => `${a}.org_id <> 'org_creo' AND ($1::text IS NULL OR ${a}.org_id = $1::text)`;

const STALE_DRAFTS_SQL = `
  SELECT m.org_id, COUNT(*)::int AS n FROM milestone_drafts m
   WHERE m.milestone_key LIKE 'event_missed:%' AND m.status = 'pending_review' AND m.sent_at IS NULL AND ${SCOPE("m")}
     AND NOT EXISTS (SELECT 1 FROM event_attendees a
                      WHERE a.org_id = m.org_id AND a.event_id = substring(m.milestone_key from 14) AND a.donor_id = m.donor_id
                        AND lower(coalesce(a.status,'')) IN ('registered','confirmed','no_show') AND a.checked_in_at IS NULL)
   GROUP BY m.org_id ORDER BY m.org_id`;
const ARCHIVED_SQL = `
  SELECT x.org_id, COUNT(*)::int AS n FROM (
    SELECT m.org_id FROM milestone_drafts m JOIN events e ON e.id = substring(m.milestone_key from 14) AND e.org_id = m.org_id
     WHERE m.milestone_key LIKE 'event_missed:%' AND m.status = 'pending_review' AND m.sent_at IS NULL AND e.archived_at IS NOT NULL AND ${SCOPE("m")}
    UNION ALL
    SELECT t.org_id FROM tasks t JOIN events e ON e.id = t.event_id AND e.org_id = t.org_id
     WHERE COALESCE(t.done, 0) = 0 AND t.voided_at IS NULL AND e.archived_at IS NOT NULL AND ${SCOPE("t")}) x
   GROUP BY x.org_id ORDER BY x.org_id`;
const TWICE_HOURS_SQL = `
  SELECT a.org_id, COUNT(*)::int AS n FROM volunteer_shifts a JOIN volunteer_shifts b
      ON b.org_id = a.org_id AND b.person_id = a.person_id AND b.date = a.date AND b.hours = a.hours
     AND COALESCE(b.role,'') = COALESCE(a.role,'') AND b.via = a.via AND b.id > a.id
     AND abs(extract(epoch FROM (b.created_at - a.created_at))) <= 5
   WHERE a.via = 'staff' AND a.import_key IS NULL AND b.import_key IS NULL AND ${SCOPE("a")}
   GROUP BY a.org_id ORDER BY a.org_id`;
const TWICE_NOTES_SQL = `
  SELECT a.org_id, COUNT(*)::int AS n FROM interactions a JOIN interactions b
      ON b.org_id = a.org_id AND b.donor_id = a.donor_id AND b.note = a.note AND b.id > a.id
     AND b.metadata->>'calendar_event_id' = a.metadata->>'calendar_event_id'
     AND abs(extract(epoch FROM (b.created_at - a.created_at))) <= 2
   WHERE a.metadata->>'kind' = 'meeting_moved' AND b.metadata->>'kind' = 'meeting_moved' AND ${SCOPE("a")}
   GROUP BY a.org_id ORDER BY a.org_id`;

(async () => {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  try {
    const parts = [
      ["A. \"Missed you\" drafts waiting for somebody who did not miss it (now)", STALE_DRAFTS_SQL, "draft"],
      ["B. waiting drafts and open tasks on archived events", ARCHIVED_SQL, "row"],
      ["C. hours that look like one entry saved twice (pairs)", TWICE_HOURS_SQL, "pair"],
      ["D. \"Meeting moved\" notes written twice (pairs)", TWICE_NOTES_SQL, "pair"]];
    for (const [label, sql, unit] of parts) {
      const rows = (await pool.query(sql, [ORG])).rows;
      const total = rows.reduce((a, r) => a + r.n, 0);
      console.log(`${label}: ${total} ${total === 1 ? unit : unit + "s"} in ${rows.length} ${rows.length === 1 ? "org" : "orgs"}`);
      for (const r of rows) console.log(`  ${r.org_id}  ${r.n}`);
    }
    console.log("Dry run: nothing was changed. Each is a staff decision on its own screen (Drafts, Tasks, the person's hours, the timeline).");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
