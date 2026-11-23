#!/usr/bin/env node
// scripts/ops/list6-duplicate-views.js · LIST-6 item 4. A DRY RUN: WHICH SAVED VIEWS WERE DUPLICATED?
//
// Before LIST-6, changing a saved view and saving it again made a SECOND view (POST only, no Update),
// often under the same name. LIST-6 stops new ones (PUT /donors/list-views/:id). The ones already made
// are hers: two views with one name may both be wanted, so this script never deletes. It lists, per
// org and person, each name held by more than one view, oldest first, so a person can be told which
// to keep (Saved views → pick it → Delete this view).
//
// usage:  DATABASE_URL=… node scripts/ops/list6-duplicate-views.js [--org <org_id>]
// Reads only. There is no write mode.
"use strict";
const { Client } = require("pg");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const i = process.argv.indexOf("--org");
  const org = i > 0 ? process.argv[i + 1] : null;
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const { rows } = await c.query(
      `SELECT org_id, user_id, lower(trim(name)) AS key, COUNT(*)::int AS n,
              array_agg(id || ' (' || to_char(created_at, 'YYYY-MM-DD') || ')' ORDER BY created_at) AS views
         FROM donor_list_views
        WHERE ($1::text IS NULL OR org_id = $1)
        GROUP BY org_id, user_id, lower(trim(name))
       HAVING COUNT(*) > 1
        ORDER BY org_id, user_id, key`, [org]);
    if (!rows.length) console.log("No person holds two saved views with one name. Nothing to tell anyone.");
    for (const r of rows) console.log(`${r.org_id}  ${r.user_id}  "${r.key}" × ${r.n}: ${r.views.join(", ")}`);
    console.log(`\n${rows.length} name(s) held twice or more. DRY RUN: nothing was changed.`);
    await c.query("ROLLBACK");
  } finally { await c.end(); }
})().catch(e => { console.error(e && e.message); process.exit(1); });
