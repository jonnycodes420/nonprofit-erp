#!/usr/bin/env node
// scripts/ops/flows3-journey-starts.js · FLOWS-3 (W-1107-Fundraising-28).
// JONATHAN RUNS IT. A DRY RUN: it reads and prints, and writes nothing.
//
// Since FLOWS-3 only an Active journey starts people, and a by-hand start of a
// dated journey counts from the journey's own date. Rows written before that
// still carry the old state. By org id, with counts only (no names):
//   A. people still in a journey that has never been turned on (a Draft).
//      Nobody can be put in a Draft now, so every one of these came in by hand
//      while it was a Draft.
//   B. people still in a journey that is Paused now. Some came in while it ran
//      and stay in it on purpose (pausing never takes anyone out), so this is
//      the most there can be, not a count of mistakes.
//   C. people in a dated journey ("A date every year") whose first step is due
//      before the journey's date came round, the Nov 10 for Dec 1 case.
//
// No --apply: taking someone out of a journey closes their open step and its
// Thread, which is the journey page's Stop (or the batch's Undo) and is a
// staff decision for each person. The counts say where to look. org_creo is
// left out.
//
//   node scripts/ops/flows3-journey-starts.js               # every org
//   node scripts/ops/flows3-journey-starts.js --org=org_x   # one org
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const { Pool } = require("pg");

const ORG = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;

const DRAFT_SQL = `
  SELECT p.org_id, COUNT(*)::int AS n
    FROM cultivation_plans p JOIN cultivation_templates t ON t.id = p.template_id AND t.org_id = p.org_id
   WHERE p.status = 'active' AND t.archived_at IS NULL AND t.journey_enabled IS NOT TRUE AND t.ever_enabled IS NOT TRUE
     AND p.org_id <> 'org_creo' AND ($1::text IS NULL OR p.org_id = $1::text)
   GROUP BY p.org_id ORDER BY p.org_id`;
const PAUSED_SQL = `
  SELECT p.org_id, COUNT(*)::int AS n
    FROM cultivation_plans p JOIN cultivation_templates t ON t.id = p.template_id AND t.org_id = p.org_id
   WHERE p.status = 'active' AND t.archived_at IS NULL AND t.journey_enabled IS NOT TRUE AND t.ever_enabled IS TRUE
     AND p.org_id <> 'org_creo' AND ($1::text IS NULL OR p.org_id = $1::text)
   GROUP BY p.org_id ORDER BY p.org_id`;
// The next time month/day comes round on or after the day they were put in.
const DATED_SQL = `
  WITH d AS (
    SELECT p.org_id, p.id, p.applied_on::date AS put_in, s.due_date::date AS first_due,
           make_date(EXTRACT(YEAR FROM p.applied_on::date)::int, (t.trigger_filters->>'month')::int,
                     LEAST((t.trigger_filters->>'day')::int, 28)) AS this_year
      FROM cultivation_plans p
      JOIN cultivation_templates t ON t.id = p.template_id AND t.org_id = p.org_id
      JOIN cultivation_plan_steps s ON s.plan_id = p.id AND s.org_id = p.org_id AND s.seq = 1
     WHERE p.status = 'active' AND t.trigger_key = 'yearly_date'
       AND (t.trigger_filters->>'month') ~ '^[0-9]+$' AND (t.trigger_filters->>'day') ~ '^[0-9]+$'
       AND p.org_id <> 'org_creo' AND ($1::text IS NULL OR p.org_id = $1::text))
  SELECT org_id, COUNT(*)::int AS n FROM d
   WHERE first_due < CASE WHEN this_year >= put_in THEN this_year ELSE (this_year + INTERVAL '1 year')::date END
   GROUP BY org_id ORDER BY org_id`;

(async () => {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  try {
    const parts = [["A. still in a Draft journey", DRAFT_SQL], ["B. still in a journey that is Paused now (the most, not all mistakes)", PAUSED_SQL],
      ["C. a dated journey's first step due before its date", DATED_SQL]];
    for (const [label, sql] of parts) {
      const rows = (await pool.query(sql, [ORG])).rows;
      const total = rows.reduce((a, r) => a + r.n, 0);
      console.log(`${label}: ${total} ${total === 1 ? "person" : "people"} in ${rows.length} ${rows.length === 1 ? "org" : "orgs"}`);
      for (const r of rows) console.log(`  ${r.org_id}  ${r.n}`);
    }
    console.log("Dry run: nothing was changed. Take people out on each journey's page (Stop), or with the batch's Undo.");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
