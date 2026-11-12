#!/usr/bin/env node
// scripts/ops/flows7-starter-volunteers.js · FLOWS-7 (W-1112-Volunteers-31X). DRY RUN ONLY.
//
// The starter group "Volunteers who have never given" counted people with a
// logged shift or an approved application (13 on staging) while a rule group
// "Role is Volunteer + Has never given" and the roster's Never given filter
// counted people with the Volunteer type (40). FLOWS-7 made the starter the
// role rule. A group an org ADDED from the old starter before FLOWS-7 is a
// saved row in `audiences` with the old rules ({ volunteer: "1", given:
// "never" }) and the starter's name, so it still says the old thing.
//
// This lists those rows, per org id, with each one's count under the old rule
// and under the new, and writes NOTHING. Applying is REPAIR-1's: it is one
// UPDATE per row, `rules = {"role":"volunteer","given":"never"}`, with an
// audit row, and only for groups still carrying the starter's own name (a
// group someone renamed may mean the activity rule on purpose).
//
//   DATABASE_URL=… node scripts/ops/flows7-starter-volunteers.js
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js); it only reads.
"use strict";
const { Pool } = require("pg");

const NAME = "Volunteers who have never given";
const GAVE = `EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0
               AND COALESCE(g.credit_type, 'hard') = 'hard' AND g.deleted_at IS NULL)`;

(async () => {
  const pool = new Pool({ connectionString: require("../lib/prodGuard").writerDbUrl() });
  try {
    const rows = (await pool.query(
      `SELECT id, org_id, name, rules FROM audiences
        WHERE kind = 'dynamic' AND name = $1 AND rules->>'volunteer' = '1' AND rules->>'given' = 'never'
          AND NOT (rules ? 'role') AND org_id NOT IN ('org_b72demo')
        ORDER BY org_id, id`, [NAME])).rows;
    if (!rows.length) { console.log("Nothing to repair: no saved group carries the old starter rule."); return; }
    for (const r of rows) {
      const live = `d.org_id = $1 AND d.deleted_at IS NULL AND d.erased_at IS NULL AND d.archived_at IS NULL AND NOT ${GAVE}`;
      const [oldN] = (await pool.query(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${live}
          AND (EXISTS (SELECT 1 FROM volunteer_shifts vx WHERE vx.org_id = d.org_id AND vx.person_id = d.id)
            OR EXISTS (SELECT 1 FROM volunteer_applications ax WHERE ax.org_id = d.org_id AND ax.person_id = d.id AND ax.status = 'approved'))`, [r.org_id])).rows;
      const [newN] = (await pool.query(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${live}
          AND d.person_types @> '["volunteer"]'::jsonb`, [r.org_id])).rows;
      console.log(`${r.org_id} · group ${r.id} · would change rules ${JSON.stringify(r.rules)} -> {"role":"volunteer","given":"never"} · about ${oldN.n} now, about ${newN.n} after`);
    }
    console.log(`\n${rows.length} saved group(s) would change. Dry run: nothing written. Apply through REPAIR-1.`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
