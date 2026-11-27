// server/atlas/bellUndo.js · POLISH-15 item 5 (W-1127-Settings-01). EVERY ROW
// IN "WHAT ATLAS DID" CARRIES ITS OWN UNDO WHILE IT CAN STILL BE UNDONE.
//
// The bell listed "Saved 2 things." with no Undo: its two lines below had one
// each, but the line a person reads as "what Atlas did" did not, so the fleet
// went back to Atlas's answer to take it back. Now:
//   · a line's Undo shows only inside the undo window (agentShape UNDO_DAYS,
//     the same one POST /atlas/actions/:id/undo enforces), with its last day;
//   · a saved proposal ("Saved 2 things.") offers Undo all while any line it
//     wrote can still be undone. It calls POST /atlas/:requestId/undo, the
//     same path as Atlas's own "Undo all of it": no new write path.
// A read only: nothing here writes.
"use strict";

// items: actionOut() shapes, plus `at`. Returns them with undoable gated by the
// window, undoUntil on each that can be undone, and undoAll on a saved proposal.
async function withUndo(query, orgId, items, undoDays) {
  const ms = Number(undoDays) * 86400000;
  const now = Date.now();
  const until = at => new Date(new Date(at).getTime() + ms);
  const open = at => at && until(at).getTime() > now;
  const saved = items.filter(it => it.kind === "proposal" && it.state === "done" && it.requestId);
  const lastDay = new Map();
  const undoneAll = new Set();
  if (saved.length) {
    const rows = await query(`SELECT request_id, MIN(created_at) FILTER (WHERE state='done' AND undoable=true) AS at,
                                     COUNT(*) FILTER (WHERE state='undone')::int AS undone
                                FROM atlas_actions
                               WHERE org_id=? AND request_id = ANY(?::text[]) AND kind <> 'proposal'
                               GROUP BY request_id`, [orgId, [...new Set(saved.map(s => s.requestId))]]);
    for (const r of rows) {
      if (r.at && open(r.at)) lastDay.set(r.request_id, until(r.at).toISOString());
      else if (!r.at && r.undone > 0) undoneAll.add(r.request_id);   // everything it saved was taken back
    }
  }
  return items.map(it => {
    if (it.undoable) return open(it.at) ? { ...it, undoUntil: until(it.at).toISOString() } : { ...it, undoable: false };
    if (it.kind === "proposal" && it.state === "done" && lastDay.has(it.requestId)) return { ...it, undoAll: true, undoUntil: lastDay.get(it.requestId) };
    if (it.kind === "proposal" && it.state === "done" && undoneAll.has(it.requestId)) return { ...it, allUndone: true };
    return it;
  });
}

module.exports = { withUndo };
