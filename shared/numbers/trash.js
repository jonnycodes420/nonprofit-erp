// shared/numbers/trash.js · INTEGRITY-3. WHO IS IN THE TRASH, COUNTED ONCE.
//
// The Everyone breakdown said 277 people were in the trash while the Trash
// page said 276. They counted with two fragments: the breakdown counted every
// deleted record, and the Trash page left out a record merged into another
// (the merge's own Undo holds it, so it is not in the trash). A merged record
// was the one extra. Both now read this fragment, and so does Empty trash, so
// the number on the Trash page is the number Empty trash deletes.
//
// In the trash: deleted (donors.deleted_at), not an erased shell (TRUTH-2),
// not a staged import's hidden people (ONBOARD-1), not merged into another
// record (an open donor_merges row).
"use strict";

// SQL: `d` (an alias) is a person in the trash.
const IN_TRASH = (d = "d") => `(${d}.deleted_at IS NOT NULL AND ${d}.erased_at IS NULL AND ${d}.staged_import_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM donor_merges m WHERE m.org_id = ${d}.org_id AND m.merged_id = ${d}.id AND m.undone_at IS NULL))`;

const SENTENCE = "In the trash: people deleted from Steward who can still be restored, not counting a record merged into another (the merge's Undo holds it) or an erased record.";

async function trashCount(query, orgId) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = ? AND ${IN_TRASH("d")}`, [orgId]);
  return r ? Number(r.n) : 0;
}

module.exports = { IN_TRASH, SENTENCE, trashCount };
