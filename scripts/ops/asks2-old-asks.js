#!/usr/bin/env node
// ASKS-2 item 1 · OPEN TASKS THAT STILL CARRY AN ASK THAT JUMPED.
//
// Before ASKS-2 a rising donor's step up started from the anchor already
// rounded UP to a friendly rung, then went one rung more: largest $35,712 was
// asked $75,000 (2.1 ×). The ask itself is computed live, and the stored
// Insights answers rebuild on their own (insightsData.js ENGINE is part of the
// fingerprint). What can still carry the old number is an open task made from
// a card's "Create tasks" before this build: its title holds the ask's words
// ("Year-end givers due: Name. Ask $75,000: largest gift …").
//
// This LISTS them, per org: open tasks whose title's ask is more than 1.5 ×
// the person's anchor today (the larger of their largest gift and the average
// of their last three, shared/numbers/ask.js), with the ask the rule gives now.
// Only org ids, task ids and amounts are printed, never names. DRY RUN ONLY:
// a task's title is hers to edit, so nothing is rewritten here; REPAIR-1
// decides whether a rewrite is wanted.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/asks2-old-asks.js [--org=org_x]
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard). It only reads.
"use strict";
const { Pool } = require("pg");

const LIST_SQL = `
  SELECT t.org_id, t.id, t.donor_id, substring(t.title from 'Ask \\$([0-9,]+)') AS ask
    FROM tasks t
   WHERE COALESCE(t.done, 0) = 0 AND t.donor_id IS NOT NULL AND t.title ~ 'Ask \\$[0-9,]+'
     AND ($1::text IS NULL OR t.org_id = $1) AND t.org_id <> 'org_creo'
   ORDER BY t.org_id, t.id`;

async function main(argv = process.argv) {
  const { writerDbUrl } = require("../lib/prodGuard");
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: writerDbUrl(), ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false } });
  const ASK = require("../../shared/numbers/ask");
  await ASK.ready;
  const q = (sql, args = []) => { let i = 0; return pool.query(sql.replace(/\?/g, () => `$${++i}`), args).then(r => r.rows); };
  try {
    const tasks = await q(LIST_SQL.replace(/\$1/g, "?"), [orgArg, orgArg]);
    const byOrg = new Map();
    for (const t of tasks) {
      const rows = await q(ASK.GIFTS_SQL, [t.org_id, t.donor_id]);
      const { largestCents, lastThreeCents } = ASK.inputsOf(rows);
      const avg = lastThreeCents.length ? Math.round(lastThreeCents.reduce((a, b) => a + b, 0) / lastThreeCents.length) : 0;
      const anchor = Math.max(largestCents, avg);
      const said = Math.round(Number(String(t.ask).replace(/,/g, "")) * 100);
      if (!(anchor > 0) || said <= 1.5 * anchor) continue;
      const now = ASK.askFor(rows, { roomKnown: true });
      if (!byOrg.has(t.org_id)) byOrg.set(t.org_id, []);
      byOrg.get(t.org_id).push({ task: t.id, said: said / 100, anchor: anchor / 100, nowAtMost: now ? now.askCents / 100 : null });
    }
    if (!byOrg.size) console.log("No open task carries an ask above 1.5 × the person's anchor.");
    for (const [org, list] of byOrg) {
      console.log(`${org}: ${list.length} open task${list.length === 1 ? "" : "s"} with an old ask`);
      for (const x of list.slice(0, 50)) console.log(`  ${x.task}  says $${x.said.toLocaleString("en-US")}  anchor $${x.anchor.toLocaleString("en-US")}  the rule now asks at most $${(x.nowAtMost || 0).toLocaleString("en-US")}`);
    }
    console.log("DRY RUN: nothing was changed.");
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
