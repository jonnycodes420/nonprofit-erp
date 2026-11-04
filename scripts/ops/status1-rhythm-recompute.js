#!/usr/bin/env node
// STATUS-1 · THE STORED EXPECTED NEXT GIFT, FROM THE ONE RHYTHM.
//
// donor_rhythm.expected_next is written by afterChange.js on every change to a
// person, and since STATUS-1 it is shared/numbers/rhythm.js's answer. A row
// written before STATUS-1 holds the old one, which differs only for a person
// who gave MORE than their usual count in a year (FIX-33: they are due when
// that year runs out). Until that person's next change, the Directory's On
// track filter, the Lapsing tag in lists and Groups read the old date while
// the profile reads the new one. This puts every stored row on the one rhythm.
//
// It writes expected_next, cadence_days and rhythm only. It does not run the
// after-change step, so no group crossing, journey or Drift transition fires,
// and drift_state and state_changed_at are left as they are. donor_rhythm is a
// derived table (like donor_scores), so no audit row is written.
//
// DRY RUN BY DEFAULT: per org, how many rows would change, and five examples.
// --apply writes them, one transaction per org. Safe to run twice: a second
// run finds nothing to change.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/status1-rhythm-recompute.js             # dry run, every org
//   DATABASE_URL=… node scripts/ops/status1-rhythm-recompute.js --apply     # write
//   --org=org_x narrows it to one organisation.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const drift = require("../../drift");

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = process.argv.includes("--apply");
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  let changed = 0, rows = 0;
  try {
    const orgs = (await client.query(`SELECT DISTINCT org_id FROM donor_rhythm WHERE ($1::text IS NULL OR org_id = $1) ORDER BY org_id`, [orgArg])).rows.map(r => r.org_id);
    for (const orgId of orgs) {
      const [{ timezone } = {}] = (await client.query(`SELECT timezone FROM orgs WHERE id = $1`, [orgId])).rows;
      const today = require("../../orgTime").orgToday({ timezone });
      const stored = (await client.query(
        `SELECT r.donor_id, r.rhythm, r.cadence_days, r.expected_next,
                (SELECT json_agg(json_build_object('date', LEFT(g.date, 10), 'amount', g.amount::float8) ORDER BY g.date)
                   FROM gifts g WHERE g.org_id = r.org_id AND g.donor_id = r.donor_id AND g.amount > 0
                    AND g.date ~ '^\\d{4}-\\d{2}-\\d{2}') AS gifts
           FROM donor_rhythm r WHERE r.org_id = $1`, [orgId])).rows;
      const fixes = [];
      for (const s of stored) {
        rows++;
        const a = drift.assessDrift(s.gifts || [], today);
        const want = { rhythm: drift.rhythmOf(a), cadence: a.cadenceDays || null, next: a.onTimeThrough || a.expectedNext || null };
        const had = s.expected_next ? String(s.expected_next).slice(0, 10) : null;
        if (had !== want.next || s.rhythm !== want.rhythm || (s.cadence_days || null) !== want.cadence) fixes.push({ id: s.donor_id, had, ...want });
      }
      changed += fixes.length;
      if (!fixes.length) continue;
      console.log(`${orgId}: ${fixes.length} of ${stored.length} stored rhythms change`);
      for (const f of fixes.slice(0, 5)) console.log(`  ${f.id}: expected ${f.had || "none"} → ${f.next || "none"} (${f.rhythm})`);
      if (!APPLY) continue;
      await client.query("BEGIN");
      try {
        for (const f of fixes) {
          await client.query(`UPDATE donor_rhythm SET expected_next = $3, cadence_days = $4, rhythm = $5, computed_for = $6, computed_at = NOW()
                               WHERE org_id = $1 AND donor_id = $2`, [orgId, f.id, f.next, f.cadence, f.rhythm, today]);
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
    console.log(`\n${APPLY ? "Wrote" : "Would write"} ${changed} of ${rows} stored rhythms${APPLY ? "." : ". Dry run: nothing written (add --apply)."}`);
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
