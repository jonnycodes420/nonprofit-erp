#!/usr/bin/env node
// ASKS-1 · AUCTION SHEETS AN IMPORT READ BEFORE IT KNEW WHAT ONE WAS. READ-ONLY.
//
// Before ASKS-1, "Import a spreadsheet" did not know an auction sheet: Bidder
// was not a name, and Winning bid, Item and FMV were kept as custom fields on
// the people. No gift was written, so nothing reached a total or a receipt.
// ASKS-1 reads such a sheet as gifts (type auction, the item's value as
// quid_pro_quo_value). It does not touch a file imported before it.
//
// This lists each sheet import whose kept columns look like an auction sheet
// (a column for the item AND one for what was paid or what it was worth), with
// how many people hold a value in them. It writes NOTHING and has no --apply:
// the repair is a person's decision, in the app: undo that import (Imports →
// Undo) and import the same file again, picking the gala. Nothing is guessed.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/asks1-auction-sheets-readonly.js            # every org
//   DATABASE_URL=… node scripts/ops/asks1-auction-sheets-readonly.js --org=org_x
// org_creo (the boot fixture) is never listed.
"use strict";
const { Pool } = require("pg");

const ITEM = "^(item|auction item|item name|item title|item description|lot|lot name|lot title|package|package name|item won)$";
const MONEY = "^(winning bid|amount paid|paid amount|final bid|high bid|winning amount|sale price|sold for|purchase price|price paid|bid amount|fmv|fair market value|value|item value|retail value|estimated value|est value|market value|value received|fmv value)$";

const SQL = `
  WITH kept AS (
    SELECT i.org_id, i.id AS import_id, i.name AS file, i.started_at, c.id AS def_id, c.key, LOWER(TRIM(c.label)) AS label
      FROM imports i
      JOIN LATERAL jsonb_array_elements_text(COALESCE(i.summary_json::jsonb -> 'customFieldsCreated', '[]'::jsonb)) AS f(def_id) ON true
      JOIN custom_field_defs c ON c.id = f.def_id AND c.org_id = i.org_id
     WHERE i.shape = 'sheet' AND i.org_id <> 'org_creo' AND ($1::text IS NULL OR i.org_id = $1)
       AND i.reversed_at IS NULL
  )
  SELECT k.org_id, k.import_id, k.file, k.started_at,
         string_agg(DISTINCT k.label, ', ') AS columns,
         (SELECT COUNT(*) FROM donors d WHERE d.org_id = k.org_id AND d.deleted_at IS NULL
             AND d.custom_fields ?| array_agg(k.key)) AS people_holding_values
    FROM kept k
   GROUP BY k.org_id, k.import_id, k.file, k.started_at
  HAVING bool_or(k.label ~ '${ITEM}') AND bool_or(k.label ~ '${MONEY}')
   ORDER BY k.org_id, k.started_at`;

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const org = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query(SQL, [org]);
    if (!rows.length) { console.log("No sheet import kept an auction sheet's columns. Nothing to repair."); return; }
    console.log(`${rows.length} sheet ${rows.length === 1 ? "import" : "imports"} kept an auction sheet's columns as custom fields (no gifts were written):\n`);
    for (const r of rows)
      console.log(`  ${r.org_id}  ${r.import_id}  "${r.file}"  ${new Date(r.started_at).toISOString().slice(0, 10)}  columns: ${r.columns}  people with values: ${r.people_holding_values}`);
    console.log("\nRepair, by a person in the app: undo that import, then import the same file again and pick the gala.");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
