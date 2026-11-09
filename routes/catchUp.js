// routes/catchUp.js · LAG-1. THE SCREEN FOLLOWS THE WORKER UNTIL IT IS DONE.
//
// STALE-1 told the screen about the worker's writes on the bell's 60-second
// poll, so a figure the worker owns (the deck and its tab counts, Drift, the
// scores, a group by rule) showed the old number for up to a minute after a
// change the server had already confirmed: the 30 to 60 seconds the 8 Nov
// fleet measured on production. A TEST_MODE boot hid it (its Insights reads
// wait for the build), which is why STALE-2 could not reproduce it.
//
// GET /changes/marks answers, for the caller's org:
//   tables   the latest org_changes id per table (server/shared/changeMarks.js)
//            and the moment the org's stored Insights were last built
//            (stored_insights is unwatched, so it has a mark of its own)
//   pending  how many after-change events and worker handlers are still
//            waiting or running for this org
// After each write the client asks it every few hundred ms while anything is
// pending (client/src/lib/catchUp.js), announces each table that moved, and
// shows "Updating…" on the worker's figures until pending is 0.
//
// A read: it writes nothing. On any failure it answers { tables: {}, pending: 0 }.
"use strict";
const express = require("express");
const routers = { r0: express.Router() };

async function pendingFor(query, orgId) {
  const [r] = await query(
    `SELECT (SELECT COUNT(*)::int FROM events_outbox WHERE org_id = ? AND relayed_at IS NULL)
          + (SELECT COUNT(*)::int FROM job_queue WHERE org_id = ? AND status IN ('waiting','running')
               AND name LIKE 'handler:%' AND run_after <= NOW() + INTERVAL '30 seconds') AS n`, [orgId, orgId]);
  return (r && r.n) || 0;
}

async function insightsMark(query, orgId) {
  const [r] = await query(`SELECT (EXTRACT(EPOCH FROM MAX(built_at)) * 1000)::bigint::text AS at FROM stored_insights WHERE org_id = ?`, [orgId]);
  return r && r.at ? r.at : null;
}

function mount({ query, requireAuth, wrap }) {
  routers.r0.get("/changes/marks", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const marks = (await require("../server/shared/changeMarks").changeMarks(query, orgId)) || { tables: {} };
    const tables = { ...marks.tables };
    const built = await insightsMark(query, orgId).catch(() => null);
    if (built) tables.stored_insights = built;
    const pending = await pendingFor(query, orgId).catch(() => 0);
    res.json({ tables, pending });
  }));
}

module.exports = { routers, mount, pendingFor };
