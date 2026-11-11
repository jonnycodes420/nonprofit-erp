// tests/lib/countsKey.js: COUNTS-1. THE COUNTS PASS OF TRUTH-1'S KEY.
//
// surfacesAgree calls countsDiffs(...) unless a suite skips "counts". Each
// count a screen shows is compared to a key worked out here from the org's
// rows, by definitions written out with no app code:
//   · open tasks: not voided, not done, not on a deleted person's record;
//     "due now" (the Tasks badge) is the open ones due on or before the org's
//     today. Compared to GET /tasks/counts?scope=all (the Tasks page's tabs).
//   · Last contact: for each person with anything logged (at most 12), the
//     latest of a call, email, ask, stewardship touch or meeting logged on
//     (TOUCH-1: a handwritten note, a text, a gift sent, an event invite, or
//     any touch logged through "Log a touch", an org's own kind included)
//     their record, a note marked as a conversation, a held calendar meeting
//     with them, or an event they came to (marked attended, or checked in and
//     not cancelled or declined), dated on or before the org's today; never a
//     plain note or a newsletter line. Compared, in whole days, to the
//     header's Last contact (GET /donors/:id figures.contact).
// It returns a list of disagreements, in words; [] when every count agrees.
"use strict";

const TALK = ["call", "email", "ask", "stewardship", "meeting", "letter", "text", "gift_sent", "event_invite"];
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

async function countsDiffs({ q, orgId, get, asOf }) {
  const diffs = [];
  // ── open tasks, and the badge's "due now" ──────────────────────────────
  const [t] = await q(
    `SELECT COUNT(*)::int AS open,
            COUNT(*) FILTER (WHERE t.due IS NOT NULL AND t.due <> '' AND LEFT(t.due, 10) <= $2)::int AS due_now
       FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = $1 AND t.voided_at IS NULL AND COALESCE(t.done, 0) = 0
        AND (t.donor_id IS NULL OR d.deleted_at IS NULL)`, [orgId, asOf]);
  const tc = await get("/tasks/counts?scope=all").catch(() => null);
  if (!tc) diffs.push("counts: GET /tasks/counts did not answer");
  else {
    if (Number(tc.open) !== t.open) diffs.push(`open tasks: the key says ${t.open}, the Tasks page's tabs add to ${tc.open}`);
    const dueNow = (Number(tc.today) || 0) + (Number(tc.overdue) || 0);
    if (dueNow !== t.due_now) diffs.push(`tasks due today or overdue (the badge): the key says ${t.due_now}, GET /tasks/counts says ${dueNow}`);
  }

  // ── Last contact, per person ───────────────────────────────────────────
  const people = await q(
    `SELECT d.id FROM donors d
      WHERE d.org_id = $1 AND d.deleted_at IS NULL AND COALESCE(d.is_sample, false) = false
        AND (EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id)
          OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.org_id = d.org_id AND a.donor_id = d.id))
      ORDER BY d.id LIMIT 12`, [orgId]);
  for (const { id } of people) {
    const [k] = await q(
      `SELECT MAX(x.day) AS last FROM (
         SELECT LEFT(i.date, 10) AS day FROM interactions i
          WHERE i.org_id = $1 AND i.donor_id = $2 AND i.date IS NOT NULL AND i.date <> ''
            AND (i.type = ANY($4) OR (i.type = 'note' AND i.metadata->>'conversation' = 'true') OR i.metadata ? 'touch_kind')
            AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%'
         UNION ALL
         SELECT LEFT(e.date::text, 10) FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
          WHERE a.org_id = $1 AND a.donor_id = $2
            AND (a.status = 'attended' OR (a.checked_in_at IS NOT NULL AND COALESCE(a.status, 'invited') NOT IN ('cancelled','canceled','declined')))
         UNION ALL
         SELECT TO_CHAR(c.starts_at AT TIME ZONE (SELECT COALESCE(NULLIF(timezone, ''), 'America/New_York') FROM orgs WHERE id = $1), 'YYYY-MM-DD')
           FROM calendar_events c
          WHERE c.org_id = $1 AND $2 = ANY(c.person_ids) AND c.interaction_id IS NULL AND c.starts_at <= NOW()
       ) x WHERE x.day <= $3`, [orgId, id, asOf, TALK]);
    const keyDays = k && k.last ? daysBetween(k.last, asOf) : null;
    const rec = await get(`/donors/${encodeURIComponent(id)}`).catch(() => null);
    const f = rec && rec.figures && rec.figures.contact;
    const shown = f && f.value != null && f.totalRows !== 0 && !f.blank ? Number(f.value) : null;
    if (shown !== keyDays) diffs.push(`Last contact for ${id}: the key says ${keyDays == null ? "none" : keyDays + " days"} (${k && k.last}), the header says ${shown == null ? "none" : shown + " days"}`);
  }
  return diffs;
}

module.exports = { countsDiffs };
