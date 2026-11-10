#!/usr/bin/env node
// INTEGRITY-3 · WHERE IS THIS PERSON? A READ; IT WRITES NOTHING.
//
// Fiona Callahan ($35,000) was gone from every surface. Before this build an
// import's undo deleted outright the people its file created, already in the
// trash or not, with their trash rows and no audit row naming them
// (server/imports/undoMoves.js says how). This finds what is left of anyone
// whose name matches, in one org, and prints ONLY ids and states: never a
// name, an email or an amount.
//
// Where a name can still be found once the person's row is gone:
//   · donors.name                          the row itself (any state)
//   · deleted_records.row_data ->> 'name'  an older trash row kept the whole record
//   · donor_merges kept_name / merged_name a merge named both sides
//   · receipts.snapshot ->> 'donor_name'   a receipt keeps the name it was sent to
// For each id found it prints:
//   · state: active, trash (with the open trash row's id and why), merged into
//     another record, erased, archived, staged, or HARD-DELETED (no row: only
//     the traces above remain)
//   · every audit row naming the id (when, action, path, actor id)
//   · every import that touched the id: the one that created them, the ones
//     whose gifts they hold, the ones that brought them back from the trash
//     or put them in it, and whether each was undone
//
// One READ ONLY transaction. A remote DATABASE_URL needs --i-know-this-is-prod.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/integrity3-find-person.js --org=<org id> --name="<text>" [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");

const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const day = v => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 19) + "Z" : "-");

// Every id a name points at, from the row or from what outlived it.
const IDS_SQL = `
  SELECT id, 'donors.name' AS via FROM donors WHERE org_id = $1 AND name ILIKE $2
  UNION SELECT record_id, 'trash row' FROM deleted_records WHERE org_id = $1 AND table_name = 'donors' AND (row_data ->> 'name') ILIKE $2
  UNION SELECT kept_id, 'merge (kept)' FROM donor_merges WHERE org_id = $1 AND kept_name ILIKE $2
  UNION SELECT merged_id, 'merge (merged)' FROM donor_merges WHERE org_id = $1 AND merged_name ILIKE $2
  UNION SELECT donor_id, 'receipt' FROM receipts WHERE org_id = $1 AND donor_id IS NOT NULL AND (snapshot ->> 'donor_name') ILIKE $2`;

async function find(c, orgId, name) {
  const like = `%${String(name).replace(/[%_\\]/g, m => "\\" + m)}%`;
  const hits = (await c.query(IDS_SQL, [orgId, like]).catch(async e => {
    // a database without one of the outliving tables: read what there is
    if (!/does not exist/.test(e.message)) throw e;
    return c.query(`SELECT id, 'donors.name' AS via FROM donors WHERE org_id = $1 AND name ILIKE $2
                    UNION SELECT record_id, 'trash row' FROM deleted_records WHERE org_id = $1 AND table_name = 'donors' AND (row_data ->> 'name') ILIKE $2`, [orgId, like]);
  })).rows;
  const ids = new Map();
  for (const h of hits) { if (!h.id) continue; if (!ids.has(h.id)) ids.set(h.id, new Set()); ids.get(h.id).add(h.via); }
  const out = [];
  for (const [id, via] of ids) {
    const [d] = (await c.query(`SELECT deleted_at, erased_at, archived_at, staged_import_id, created_import_id, created_at, created_by FROM donors WHERE org_id = $1 AND id = $2`, [orgId, id])).rows;
    const [merged] = (await c.query(`SELECT kept_id, created_at FROM donor_merges WHERE org_id = $1 AND merged_id = $2 AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId, id])).rows;
    const trash = (await c.query(`SELECT id, created_at, restored_at, created_by, row_data -> '__why' AS why, row_data ->> '__importUndo' AS undo_import,
                                         row_data -> '__bringBack' ->> 'importId' AS brought_back_by, row_data -> '__bringBackUndone' AS bring_back_undone
                                    FROM deleted_records WHERE org_id = $1 AND table_name = 'donors' AND record_id = $2 ORDER BY created_at`, [orgId, id])).rows;
    const state = !d ? "HARD-DELETED (no row)" : d.erased_at ? "erased" : merged ? `merged into ${merged.kept_id}` : d.staged_import_id ? `staged (import ${d.staged_import_id})`
      : d.deleted_at ? "trash" : d.archived_at ? "archived" : "active";
    const audit = (await c.query(`SELECT created_at, action, entity_type, request_method, request_path, user_id, summary FROM fin_audit_log
                                   WHERE org_id = $1 AND (entity_id = $2 OR changes::text LIKE '%' || $2 || '%' OR after_fields::text LIKE '%' || $2 || '%'
                                                          OR before_fields::text LIKE '%' || $2 || '%')
                                   ORDER BY created_at`, [orgId, id])).rows;
    const giftImports = (await c.query(`SELECT import_id, COUNT(*)::int AS gifts FROM gifts WHERE org_id = $1 AND donor_id = $2 AND import_id IS NOT NULL GROUP BY import_id`, [orgId, id])).rows;
    const restoredIn = (await c.query(`SELECT id FROM imports WHERE org_id = $1 AND (summary_json -> 'restoredFromTrash') ? $2`, [orgId, id])).rows.map(r => r.id);
    const importIds = [...new Set([d && d.created_import_id, d && d.staged_import_id, ...giftImports.map(g => g.import_id), ...restoredIn,
      ...trash.map(t => t.undo_import), ...trash.map(t => t.brought_back_by),
      ...trash.flatMap(t => (Array.isArray(t.bring_back_undone) ? t.bring_back_undone : []).map(b => b && b.importId))].filter(Boolean))];
    const imports = importIds.length ? (await c.query(`SELECT id, shape, committed_at, reversed_at FROM imports WHERE org_id = $1 AND id = ANY($2)`, [orgId, importIds])).rows : [];
    out.push({ id, via: [...via], state, row: d ? { created: day(d.created_at), createdBy: d.created_by, createdByImport: d.created_import_id || null } : null,
      trash, audit, imports, importIds, giftImports, restoredIn });
  }
  return out;
}

function print(orgId, people) {
  console.log(`org ${orgId}: ${people.length} ${people.length === 1 ? "record matches" : "records match"} the name (ids and states only).\n`);
  for (const p of people) {
    console.log(`· ${p.id}  ${p.state}   (found by: ${p.via.join(", ")})`);
    if (p.row) console.log(`    created ${p.row.created} by ${p.row.createdBy}${p.row.createdByImport ? `, by import ${p.row.createdByImport}` : ""}`);
    for (const t of p.trash) {
      const why = t.why ? (typeof t.why === "string" ? JSON.parse(t.why) : t.why) : null;
      console.log(`    trash row ${t.id}: in ${day(t.created_at)} by ${t.created_by}${why ? ` (${why.kind}${why.importId ? ` ${why.importId}` : ""})` : ""}`
        + `${t.restored_at ? `, closed ${day(t.restored_at)}` : ", OPEN"}${t.brought_back_by ? `, brought back for import ${t.brought_back_by}` : ""}`);
    }
    if (!p.trash.length) console.log("    no trash rows");
    for (const i of p.imports) {
      const how = [p.row && p.row.createdByImport === i.id && "created them", p.giftImports.some(g => g.import_id === i.id) && "their gifts",
        p.restoredIn.includes(i.id) && "brought them back", p.trash.some(t => t.undo_import === i.id) && "its undo put them in the trash"].filter(Boolean).join(", ");
      console.log(`    import ${i.id} (${i.shape}): committed ${day(i.committed_at)}${i.reversed_at ? `, undone ${day(i.reversed_at)}` : ""}${how ? ` · ${how}` : ""}`);
    }
    for (const id of p.importIds.filter(x => !p.imports.some(i => i.id === x))) console.log(`    import ${id}: no longer on file`);
    console.log(`    ${p.audit.length} audit ${p.audit.length === 1 ? "row" : "rows"}${p.audit.length ? ":" : ""}`);
    for (const a of p.audit) console.log(`      ${day(a.created_at)}  ${a.action} ${a.entity_type || ""}  ${a.request_method || ""} ${a.request_path || ""}  by ${a.user_id || "-"}`);
    console.log("");
  }
  if (people.some(p => /^HARD-DELETED/.test(p.state))) console.log("A HARD-DELETED record has no row to restore here: docs/needs-jonathan/INTEGRITY-3.md has the point-in-time restore steps for one row.");
  if (!people.length) console.log("Nothing matches. Her row and every trace that names her are gone: docs/needs-jonathan/INTEGRITY-3.md has the point-in-time restore steps.");
}

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script only reads; it has no --apply."); process.exit(2); }
  const orgId = arg("org"), name = arg("name");
  if (!orgId || !name || name.trim().length < 3) { console.error('Usage: node scripts/ops/integrity3-find-person.js --org=<org id> --name="<at least 3 letters>" [--i-know-this-is-prod]'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (!local && !process.argv.includes("--i-know-this-is-prod")) { console.error("REFUSED: DATABASE_URL is not loopback. Add --i-know-this-is-prod to read it."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    print(orgId, await find(c, orgId, name.trim()));
    await c.query("ROLLBACK");
  } finally { c.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { find, IDS_SQL };
