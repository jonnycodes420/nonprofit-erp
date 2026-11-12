#!/usr/bin/env node
// IMPORT-10 · SPREADSHEET IMPORTS THAT LEFT A PERSON'S ROW OUT AS A "TOTAL".
//
// Before IMPORT-10 the reader treated any row with the word "total" in any
// non-money cell as a total line, so a winner whose lot was "Total Wine & More"
// was set aside, not imported (11 Nov, a silent-auction file: $280 paid left
// out). The fix (shared/totalRows.js) covers imports from now on. Those rows
// were never written, so nothing in the database is wrong and there is nothing
// to apply: this script only LISTS the past imports that did it, so each org
// can be told which lines of which file to bring in.
//
// Each committed sheet import keeps its total rows in imports.summary_json.totals,
// each with the row's non-money cells joined as its label. A row is listed when
// that label holds an email (certainly a person) or does not read as a total
// label by today's rule (isTotalLabel): "look".
// Only org ids, import ids, file names, line numbers and amounts are printed,
// never a name or an email.
//
// READ ONLY. Usage:
//   DATABASE_URL=… node scripts/ops/import10-lost-total-rows.js            # every org
//   DATABASE_URL=… node scripts/ops/import10-lost-total-rows.js --org=org_x
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");

const LIST_SQL = `
  SELECT i.org_id, i.id AS import_id, i.source_filename, i.committed_at, i.reversed_at, t.value AS total
    FROM imports i, jsonb_array_elements(CASE WHEN jsonb_typeof(i.summary_json::jsonb -> 'totals') = 'array' THEN i.summary_json::jsonb -> 'totals' ELSE '[]'::jsonb END) t
   WHERE i.shape = 'sheet' AND ($1::text IS NULL OR i.org_id = $1) AND i.org_id <> 'org_creo'
   ORDER BY i.org_id, i.committed_at, i.id`;

async function list(client, orgArg) {
  const { isTotalLabel } = await import("../../shared/totalRows.js");
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const out = [], seen = new Set();
  for (const r of rows) {
    const t = r.total || {};
    const label = String(t.label || "");
    const k = `${r.import_id}:${t.sheet}:${t.line}`;
    if (seen.has(k)) continue;   // one line per row, not per money column
    const certain = /@/.test(label);
    if (!certain && isTotalLabel(label)) continue;
    seen.add(k);
    out.push({ org: r.org_id, importId: r.import_id, file: r.source_filename, undone: !!r.reversed_at, sheet: t.sheet, line: t.line,
               cents: t.statedCents, column: t.column, kind: certain ? "person (email on the row)" : "look" });
  }
  return out;
}

async function main(argv = process.argv) {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log("MODE: READ ONLY (lists rows an import left out as a total; writes nothing)\n");
    const found = await list(client, orgArg);
    if (!found.length) { console.log("None found."); return found; }
    const money = c => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    for (const f of found) console.log(`${f.org}  ${f.importId}  "${f.file || "?"}"${f.undone ? " (undone)" : ""}  ${f.sheet} line ${f.line}  ${money(f.cents)} in "${f.column}"  ${f.kind}`);
    const orgs = new Set(found.map(f => f.org));
    console.log(`\n${found.length} row(s) in ${orgs.size} org(s). Re-import only those lines (a file of just those rows) to bring them in.`);
    return found;
  } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { list, main };
