// server/dataHealth/mergeConnections.js · CONNECT-1. A MERGE KEEPS HOW PEOPLE CAME IN, ONCE.
//
// Introduced by and Guest of (server/donors/connections.js) are links like any
// other, so the merge moves them with the person (MERGE_REFS), and a link
// between the two people being merged is set aside before anything moves
// (step 1 of mergeInTx: it would link the person to themselves). What this
// adds: a link of the merged person's that the kept person already has (the
// same newcomer, connector, type and event once the merged id reads as the
// kept one) would be a second copy of one link, so it is set aside whole,
// before the move, and comes back on Undo like every set-aside row.
"use strict";
const { CONNECT_TYPES } = require("../../shared/numbers/broughtIn");

async function setAsideTwins(client, { orgId, keptId, mergedId, queryTx, runTx }) {
  const rows = await queryTx(client,
    `SELECT to_jsonb(r.*) AS j FROM donor_relationships r
      WHERE r.org_id = ? AND r.relationship_type = ANY(?::text[])
        AND (r.donor_id_a = ANY(?::text[]) OR r.donor_id_b = ANY(?::text[]))
      ORDER BY r.created_at, r.id`, [orgId, [...CONNECT_TYPES], [keptId, mergedId], [keptId, mergedId]]);
  const as = id => (id === mergedId ? keptId : id);
  const key = j => [as(j.donor_id_a), as(j.donor_id_b), j.relationship_type, j.event_id || ""].join("|");
  const seen = new Set(), aside = [];
  // The kept person's own links first: theirs are the ones that stay.
  for (const { j } of rows) if (j.donor_id_a !== mergedId && j.donor_id_b !== mergedId) seen.add(key(j));
  for (const { j } of rows) {
    if (j.donor_id_a !== mergedId && j.donor_id_b !== mergedId) continue;
    if (as(j.donor_id_a) === as(j.donor_id_b)) continue;   // step 1 has already set it aside
    if (seen.has(key(j))) {
      await runTx(client, "DELETE FROM donor_relationships WHERE id = ? AND org_id = ?", [j.id, orgId]);
      aside.push({ table: "donor_relationships", why: "the kept person already has this link", row: j });
    } else seen.add(key(j));
  }
  return aside;
}

module.exports = { setAsideTwins };
