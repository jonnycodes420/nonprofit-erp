// STALE-1 · WHAT CHANGED ON THE SERVER, FOR A SCREEN THAT DID NOT DO IT.
//
// The worker's after-change step (afterChange.js), a webhook or a timed job
// writes where no browser request names it, so the screen behind never heard.
// Every watched table already notes each statement's org in org_changes
// (orgSummary.js, a statement trigger). This reads the latest change id per
// table in the last ten minutes, for the org, and rides on the bell's 60-second
// GET /atlas/activity: no request is added. The client announces a table whose
// id moved (client/src/lib/changes.js noteServerChanges).
//
// A read: it changes nothing. On any failure it answers null, and the bell
// answers as it always did.
"use strict";

async function changeMarks(query, orgId) {
  if (!orgId) return null;
  try {
    const rows = await query(
      `SELECT tbl, MAX(id)::text AS id FROM org_changes
        WHERE org_key = ? AND at > NOW() - INTERVAL '10 minutes' GROUP BY tbl`, [String(orgId)]);
    const tables = {};
    for (const r of rows) tables[r.tbl] = r.id;
    return { tables };
  } catch { return null; }
}

module.exports = { changeMarks };
