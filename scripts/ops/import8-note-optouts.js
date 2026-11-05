#!/usr/bin/env node
// IMPORT-8 · PEOPLE AN IMPORT BLOCKED FROM EMAIL BECAUSE OF A NOTE.
//
// Before IMPORT-8, "Import a spreadsheet" read a note anywhere on the row as
// an opt-out (on 3 Nov, 16 About-them notes reading "Asked for no more mail,
// email only" became 16 opt-outs): it set donors.do_not_email and added an
// email_suppressions row (reason unsubscribed, source import:<id>). The
// read-only count is scripts/ops/import8-note-optouts-readonly.sql.
//
// DRY RUN BY DEFAULT: lists each person, per org and import, as donor id, the
// column and the note's words. A person is listed only when the note is the
// whole reason: no choice column (Do not email, Unsubscribed, Mailing list…)
// in any import says so, and nothing outside that import suppressed the
// address. --apply, inside ONE transaction, turns do_not_email back off for
// each, deletes that import's own suppression of their address, and writes one
// audit row each (actor system:scripts/ops/import8-note-optouts) with what it
// changed. Safe to run twice: the second run finds nobody.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import8-note-optouts.js               # dry run, every org
//   DATABASE_URL=… node scripts/ops/import8-note-optouts.js --apply       # write
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/import8-note-optouts", name: "Fix: an import read a note as an opt-out", kind: "system" };
const CHOICE = "(mailing|newsletter|e-?news|opt|unsub|subscri|email list|do not|no e-?mail|dne|dnc|restrict)";

const LIST_SQL = `
  WITH note_optouts AS (
    SELECT DISTINCT ON (i.donor_id) i.org_id, i.import_id, i.donor_id, i.metadata->>'header' AS header, i.metadata->>'value' AS words
      FROM interactions i
     WHERE i.metadata->>'source' = 'sheet-import' AND i.metadata->>'kind' = 'preference' AND i.metadata->>'preference' = 'optOut'
       AND LOWER(COALESCE(i.metadata->>'header', '')) !~ '${CHOICE}'
       AND ($1::text IS NULL OR i.org_id = $1) AND i.org_id <> 'org_creo'
     ORDER BY i.donor_id, i.created_at
  )
  SELECT n.*, d.email
    FROM note_optouts n
    JOIN donors d ON d.id = n.donor_id AND d.org_id = n.org_id AND d.deleted_at IS NULL AND d.do_not_email
   WHERE NOT EXISTS (SELECT 1 FROM interactions c WHERE c.org_id = n.org_id AND c.donor_id = n.donor_id
                       AND c.metadata->>'source' = 'sheet-import' AND c.metadata->>'kind' = 'preference'
                       AND c.metadata->>'preference' IN ('optOut', 'doNotEmail', 'doNotContact')
                       AND LOWER(COALESCE(c.metadata->>'header', '')) ~ '${CHOICE}')
     AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.org_id = n.org_id AND LOWER(s.email) = LOWER(d.email)
                       AND COALESCE(s.source, '') <> 'import:' || n.import_id)
   ORDER BY n.org_id, n.import_id, n.donor_id`;

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = process.argv.includes("--apply");
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log(APPLY ? "MODE: APPLY (one transaction)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    if (APPLY) await client.query("BEGIN");
    const { rows } = await client.query(LIST_SQL, [orgArg]);
    let at = null;
    for (const r of rows) {
      const k = `${r.org_id} · ${r.import_id}`;
      if (k !== at) { at = k; console.log(`${k}: ${rows.filter(x => `${x.org_id} · ${x.import_id}` === k).length} person(s)`); }
      console.log(`  ${r.donor_id}  "${r.header}": ${String(r.words || "").slice(0, 80)}`);
      if (!APPLY) continue;
      await client.query("UPDATE donors SET do_not_email = false, updated_at = NOW() WHERE id = $1 AND org_id = $2", [r.donor_id, r.org_id]);
      const sup = await client.query("DELETE FROM email_suppressions WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND source = $3 RETURNING id",
        [r.org_id, r.email || "", `import:${r.import_id}`]);
      await client.query(
        `INSERT INTO fin_audit_log
           (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
            changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'turn email back on','donor',$6,$7,$8,$9,$10,1,'SCRIPT','scripts/ops/import8-note-optouts.js')`,
        ["al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), r.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, r.donor_id,
         JSON.stringify({ do_not_email: { from: true, to: false }, suppressions_removed: sup.rows.map(x => x.id) }),
         JSON.stringify({ do_not_email: true }), JSON.stringify({ do_not_email: false }),
         `Email turned back on: import ${r.import_id} read the note in "${r.header}" as an opt-out; no choice column said so`]);
    }
    if (APPLY) await client.query("COMMIT");
    console.log(`\n${rows.length} person(s) ${APPLY ? "can be emailed again" : "would be able to be emailed again"}.`);
  } catch (e) {
    if (APPLY) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { LIST_SQL };
