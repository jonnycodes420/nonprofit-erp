#!/usr/bin/env node
// CAMPAIGN-2 · ROWS STILL CARRYING THE OLD STATE. READ ONLY: there is no --apply; it writes nothing.
//
//   item 4: "Start a campaign from this" made a draft in silence on every press (Jarvis: "silently
//     created a third campaign draft"). Listed: draft campaigns started from a template that are
//     still exactly as made (the template's blocks, the default audience, never sent) and have a
//     twin, the same template, name and person, made within 30 minutes of an earlier one. Each
//     can be deleted from Communications > Campaigns (Delete asks, and has Undo). Nothing deletes
//     them here.
//   item 2: unsent campaigns saved "By tier" with an old capacity tier (transformational, small,
//     micro). Those tiers were matched against a wealth-score column and reached almost nobody;
//     since CAMPAIGN-2 they reach nobody, and the picker offers the giving levels instead. Listed so
//     the org can pick a level.
//   item 1 needs nothing: a draft saved with a stale stage under "All donors" is all donors on
//     every read now (filterBySegment reads a stage only on a segment with no mode).
//
// Usage:
//   DATABASE_URL=… node scripts/ops/campaign2-old-rows.js            # every org
//   DATABASE_URL=… node scripts/ops/campaign2-old-rows.js org_x      # one org
"use strict";
const { Pool } = require("pg");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const org = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const twins = await pool.query(
      `SELECT c.org_id, c.id, c.name, c.created_at, c.created_by_name, t.name AS template
         FROM campaigns c JOIN email_templates t ON t.id = c.template_id AND t.org_id = c.org_id
        WHERE c.status = 'draft' AND c.sent_at IS NULL AND c.segment = '{"mode":"all"}'
          AND c.email_blocks::jsonb = t.blocks::jsonb AND ($1::text IS NULL OR c.org_id = $1)
          AND EXISTS (SELECT 1 FROM campaigns e WHERE e.org_id = c.org_id AND e.template_id = c.template_id
                       AND e.name = c.name AND e.created_by IS NOT DISTINCT FROM c.created_by AND e.id <> c.id
                       AND e.created_at < c.created_at AND e.created_at > c.created_at - INTERVAL '30 minutes')
        ORDER BY c.org_id, c.created_at`, [org]).catch(e => ({ rows: [], error: e.message }));
    console.log(`\nItem 4 · untouched twin drafts started from a template: ${twins.rows.length}${twins.error ? ` (could not read: ${twins.error})` : ""}`);
    for (const r of twins.rows) console.log(`  ${r.org_id}  ${r.id}  "${r.name}" from "${r.template}", ${new Date(r.created_at).toISOString()} by ${r.created_by_name || "unknown"}`);
    const tiers = await pool.query(
      `SELECT org_id, id, name, status, segment FROM campaigns
        WHERE status NOT IN ('sent','sending') AND segment LIKE '%"byTier"%'
          AND (segment LIKE '%transformational%' OR segment LIKE '%"small"%' OR segment LIKE '%"micro"%')
          AND ($1::text IS NULL OR org_id = $1) ORDER BY org_id, name`, [org]);
    console.log(`\nItem 2 · unsent campaigns saved with an old capacity tier: ${tiers.rows.length}`);
    for (const r of tiers.rows) console.log(`  ${r.org_id}  ${r.id}  "${r.name}" (${r.status})  ${r.segment}`);
    console.log("\nNothing was changed.\n");
  } finally { await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
