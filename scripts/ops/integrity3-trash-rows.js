#!/usr/bin/env node
// INTEGRITY-3 · PEOPLE IN THE TRASH ON THE WRONG TRASH ROW. A DRY RUN; IT WRITES NOTHING.
//
// Before this build, undoing an import that had brought people back from the
// trash put them back with a NEW trash row ("Import undo of <file>") and left
// the row they came out of closed, so the Trash says the undo deleted them
// when someone else did, on another day, for another reason. The code now
// reopens their original row (server/imports/undoMoves.putBackRestored); the
// people sent back before it still carry the old state. This lists them, by
// org id and count only:
//   a person is listed when they are in the trash, their open trash row was
//   written by an import's undo (__importUndo = I), and an earlier trash row
//   of theirs, now closed, was closed by a Bring them back that import I
//   claimed (__bringBack.importId = I).
// The repair (reopen that earlier row, close the undo's, deleted_at back to
// when they first went in) is REPAIR-1's to write; nothing here writes.
// People an undo deleted outright have no row left to list:
// scripts/ops/integrity3-find-person.js finds what is left of one by name.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/integrity3-trash-rows.js [--org=<org id>] [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");

const LIST_SQL = `
  SELECT u.org_id, COUNT(DISTINCT u.record_id)::int AS people
    FROM deleted_records u
    JOIN donors d ON d.org_id = u.org_id AND d.id = u.record_id AND d.deleted_at IS NOT NULL
   WHERE u.table_name = 'donors' AND u.restored_at IS NULL AND (u.row_data ->> '__importUndo') IS NOT NULL
     AND ($1::text IS NULL OR u.org_id = $1)
     AND EXISTS (SELECT 1 FROM deleted_records o WHERE o.org_id = u.org_id AND o.table_name = 'donors' AND o.record_id = u.record_id
                   AND o.restored_at IS NOT NULL AND o.created_at < u.created_at
                   AND (o.row_data -> '__bringBack' ->> 'importId') = (u.row_data ->> '__importUndo'))
   GROUP BY u.org_id ORDER BY u.org_id`;

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply (REPAIR-1 writes the repair)."); process.exit(2); }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (!local && !process.argv.includes("--i-know-this-is-prod")) { console.error("REFUSED: DATABASE_URL is not loopback. Add --i-know-this-is-prod to read it."); process.exit(2); }
  const org = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const rows = (await c.query(LIST_SQL, [org])).rows;
    await c.query("ROLLBACK");
    console.log("MODE: DRY RUN (nothing is written)\n");
    for (const r of rows) console.log(`${r.org_id}: ${r.people}`);
    const total = rows.reduce((s, r) => s + r.people, 0);
    console.log(`\n${total} ${total === 1 ? "person" : "people"} in ${rows.length} ${rows.length === 1 ? "org" : "orgs"} ${total === 1 ? "sits" : "sit"} in the trash on an import undo's row instead of the one they came out of.`);
  } finally { c.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL };
