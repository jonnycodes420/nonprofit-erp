// server/tasks/kindOnce.js · FLOWS-1 item 9. ONE PERSON, ONE OPEN STEP OF A KIND.
//
// Insights' "Create tasks" made the same step ("First gift, no second yet: ...
// Ask $3,750") again on every press: one person had it three times. A caller
// that names the kind (POST /tasks { kindKey }) gets the open task of that kind
// back, marked existing, instead of a second. The kind is the title's prefix
// before ": ", the way Insights writes its titles.
"use strict";

async function openOfKind({ query }, orgId, donorId, body) {
  const kindKey = body && typeof body.kindKey === "string" ? body.kindKey.trim().slice(0, 120) : "";
  if (!kindKey || !donorId) return null;
  const [have] = await query(`SELECT * FROM tasks WHERE org_id=? AND donor_id=? AND done=0 AND voided_at IS NULL AND LEFT(title, ?) = ?
                               ORDER BY created_at LIMIT 1`, [orgId, donorId, kindKey.length + 1, kindKey + ":"]);
  return have ? { ...have, existing: true } : null;
}

module.exports = { openOfKind };
