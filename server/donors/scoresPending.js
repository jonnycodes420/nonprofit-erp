// FRESH-4 item 3 · A PERSON'S SCORES AFTER A CHANGE ARE NEVER THE ONES FROM BEFORE IT.
//
// The two scores (ENGAGE-1) are stored rows the queue rewrites after a change
// (server/donors/handlers/scores.js), three seconds later, folded per org. In
// those seconds the profile's re-read was handed the row from before the gift,
// the touch or the hours (staging, 27 Nov: /donors/:id/scores unchanged 300 ms
// after the write, new at 5 s). While a rescore that names this person (or the
// whole org) is waiting or running, the profile's answer is scored on the fly
// instead, against the stored population, exactly as for a person with no row
// yet (SCORES-1). A GET still writes nothing; the queued job writes the row.
"use strict";
const { query } = require("../../db");

// What is still to land for this person: their change's event not yet relayed, its after-change
// step (which asks for the rescore) waiting or running, or the org's rescore itself
// (server/shared/outbox.js pending(), the same answer the profile's "updating" line reads). The
// first two matter: read in the same tick as the gift's answer, the rescore is not even queued yet.
async function rescorePending(orgId, donorId) {
  if (await require("../shared/outbox").pending(orgId, [donorId])) return true;
  const rows = await query(
    `SELECT payload FROM job_queue WHERE key = ? AND status IN ('waiting', 'running')`, [`scores:${orgId}`]);
  return rows.some(r => {
    const p = typeof r.payload === "string" ? JSON.parse(r.payload) : (r.payload || {});
    const ids = Array.isArray(p.donorIds) ? p.donorIds : [];
    return !!p.full || !ids.length || ids.includes(donorId);
  });
}

module.exports = { rescorePending };
