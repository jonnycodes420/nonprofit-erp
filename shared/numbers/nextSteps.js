// shared/numbers/nextSteps.js · ACCESS-3. PEOPLE WITH A NEXT STEP OVERDUE.
//
// A next step is what the Thread lists (server/tasks/routes.js composeThreads):
// an open follow-up (a thread not closed) or an open task on the person (not
// done, not voided). It is overdue when its day is before the org's today. A
// person counts once, however many steps of theirs are late. Live people only
// (EVERYONE: not in the trash, archived or erased).
"use strict";
const { EVERYONE } = require("./everyone");

const SENTENCE = "People with a next step overdue: a follow-up or a task on them, not done, whose day has passed.";

// `visible` (server/auth/portfolio.js visibleSql over "d") narrows it to a
// portfolio user's people; omitted, it is the whole org.
async function peopleWithStepOverdue(query, orgId, today, visible) {
  const v = visible && visible.sql ? visible : { sql: "", args: [] };
  const [r] = await query(
    `SELECT COUNT(*)::int AS n FROM donors d
      WHERE d.org_id = ? AND ${EVERYONE("d")}${v.sql}
        AND (EXISTS (SELECT 1 FROM threads t WHERE t.org_id = d.org_id AND t.donor_id = d.id AND t.closed_at IS NULL AND LEFT(t.due_date::text, 10) < ?)
          OR EXISTS (SELECT 1 FROM tasks k WHERE k.org_id = d.org_id AND k.donor_id = d.id AND COALESCE(k.done, 0) = 0 AND k.voided_at IS NULL
                      AND COALESCE(k.due, '') ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(k.due, 10) < ?))`,
    [orgId, ...v.args, today, today]);
  return r ? Number(r.n) : 0;
}

module.exports = { SENTENCE, peopleWithStepOverdue };
