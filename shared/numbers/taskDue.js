// shared/numbers/taskDue.js · FLOWS-7 (W-1112-Volunteers-19). ONE RULE FOR
// "WHAT TASKS ARE DUE OR OVERDUE".
//
// The first staging night: the morning email's preview said "8 waiting on
// you", listed 2 tasks and "Dana · 17 open · 5 overdue"; Tasks and Home said 11
// due or overdue (3 today, 8 overdue) and Dana's overdue was 8. Three rules
// counted it: Tasks (taskViewSql, TASKS-2), the email's task list (its own
// query, which left out next steps and, for an admin, the unowned tasks), and
// the email's team row, which counted conversation threads, not tasks.
//
// THE RULE, read by Tasks, Home's numbers and the morning email:
//   · A task is live when it is not voided and its person is not deleted.
//   · Its view: done; no date; overdue (due before the org's today); today;
//     upcoming (within 7 days); later. TASKS-2's rule, here once.
//   · Whose: "mine" is the tasks assigned to me, and for an admin also the
//     unowned ones (Home's Thread's own rule). One person's ("staff") is the
//     tasks assigned to them.
//   · Due or overdue = the today and overdue views. Open = every view but done.
"use strict";

// The view of task `t`, given (today, today, today + 7) as its three params.
const VIEW_SQL = `CASE
    WHEN t.done = 1 THEN 'done'
    WHEN COALESCE(t.due, '') !~ '^\\d{4}-\\d{2}-\\d{2}' THEN 'nodate'
    WHEN LEFT(t.due, 10) < ? THEN 'overdue'
    WHEN LEFT(t.due, 10) = ? THEN 'today'
    WHEN LEFT(t.due, 10) <= ? THEN 'upcoming'
    ELSE 'later' END`;
// Live: not voided, and its person (if any) not deleted. Needs `d` joined on t.donor_id.
const LIVE_SQL = `t.voided_at IS NULL AND (t.donor_id IS NULL OR d.deleted_at IS NULL)`;
// Whose: "mine" (an admin's holds the unowned too) or one staff member's.
const MINE = isAdmin => isAdmin ? "(t.assigned_to = ? OR t.assigned_to IS NULL)" : "t.assigned_to = ?";

const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The tasks due today or overdue for one person, by Tasks' own rule, oldest first.
async function dueFor(query, orgId, { userId, isAdmin = false, today }) {
  const rows = await query(
    `SELECT t.*, d.name AS donor_name, d.email AS donor_email, ${VIEW_SQL} AS view
       FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND ${LIVE_SQL} AND ${MINE(isAdmin)} AND t.done = 0
        AND COALESCE(t.due, '') ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(t.due, 10) <= ?
      ORDER BY LEFT(t.due, 10) ASC, t.id`,
    [today, today, addDays(today, 7), orgId, userId, today]);
  const overdue = rows.filter(r => r.view === "overdue");
  const dueToday = rows.filter(r => r.view === "today");
  return { rows, overdue, dueToday, count: rows.length };
}

// Per staff member: open and overdue, each equal to Tasks' counts for that person
// (/tasks/counts?staff=<id>). Unowned tasks are their own line.
// FLOWS-9 (W-1112-Volunteers-19): open is Tasks' own "every view but done"
// (a task whose done is unset is open in Tasks, and was left out here), and one
// person is one row, grouped by who they are, never by how their name reads.
async function teamCounts(query, orgId, today) {
  return query(
    `SELECT COALESCE(NULLIF(TRIM(u.name), ''), u.email, CASE WHEN t.assigned_to IS NULL THEN 'Unassigned' ELSE 'Someone no longer here' END) AS who,
            t.assigned_to AS user_id,
            COUNT(*) FILTER (WHERE ${VIEW_SQL} <> 'done')::int AS n,
            COUNT(*) FILTER (WHERE ${VIEW_SQL} = 'overdue')::int AS overdue
       FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
       LEFT JOIN users u ON u.id = t.assigned_to AND u.org_id = t.org_id
      WHERE t.org_id = ? AND ${LIVE_SQL}
      GROUP BY t.assigned_to, u.name, u.email
      ORDER BY 3 DESC, 1`,
    [today, today, addDays(today, 7), today, today, addDays(today, 7), orgId]).then(rows => rows.filter(r => r.n > 0));
}

module.exports = { VIEW_SQL, LIVE_SQL, MINE, dueFor, teamCounts };
