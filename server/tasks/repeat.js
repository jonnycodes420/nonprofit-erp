// server/tasks/repeat.js · FLOWS-1 item 11. EVERY WAY A REPEATING TASK IS
// FINISHED MAKES ITS NEXT ONE.
//
// Only POST /tasks/:id/complete made the next one. An "Every year, same date"
// task ticked on a profile (PUT /tasks/:id), done in bulk on Tasks, finished by
// its thank-you, or done through Tell Steward simply ended, and next year's
// never came. Each of those now calls `afterDone`, the one place the next one
// is made, once (a task's next is found by recur_parent_id), and `afterUndone`
// takes an untouched next one back off when the tick is taken back.
"use strict";
const { newId } = require("../shared/newId");

let _ts = null;
const tsMod = async () => _ts || (_ts = await import("../../shared/taskShape.js"));

// t: the task row as it was (needs id, org_id, recur, due). Returns the new
// task's id, or null when it does not repeat or its next one is already made.
async function afterDone({ query, run }, orgId, t, today) {
  const ts = await tsMod();
  const recur = ts.normalizeRecur(t && t.recur);
  if (!recur) return null;
  const [have] = await query("SELECT id FROM tasks WHERE recur_parent_id=? AND org_id=?", [t.id, orgId]);
  if (have) return null;
  const nid = newId("t");
  await run(
    `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,
                        kind,due_time,notes,checklist,recur,household_id,grant_id,event_id,campaign_id,recur_parent_id)
     SELECT ?,org_id,title,?,priority,type,0,donor_id,assigned_to,assigned_to_name,NOW(),?,?,
            kind,due_time,notes,(SELECT COALESCE(jsonb_agg(jsonb_set(e,'{done}','false'::jsonb)),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(checklist,'[]'::jsonb)) e),
            recur,household_id,grant_id,event_id,campaign_id,id
       FROM tasks WHERE id=? AND org_id=?`,
    [nid, ts.nextDue(recur, t.due, today), "system:task-repeat", "Steward", t.id, orgId]);
  return nid;
}

async function afterUndone({ run }, orgId, t) {
  const ts = await tsMod();
  if (!ts.normalizeRecur(t && t.recur)) return;
  await run("DELETE FROM tasks WHERE recur_parent_id=? AND org_id=? AND done=0 AND link_kind IS NULL", [t.id, orgId]);
}

// For a writer that marks a list of tasks done at once (Tell Steward).
async function afterDoneMany(db, orgId, ids, today) {
  if (!ids || !ids.length) return;
  const rows = await db.query("SELECT id, org_id, recur, due FROM tasks WHERE org_id=? AND id = ANY(?::text[]) AND recur IS NOT NULL AND done=1", [orgId, ids]);
  for (const t of rows) await afterDone(db, orgId, t, today);
}

module.exports = { afterDone, afterUndone, afterDoneMany };
