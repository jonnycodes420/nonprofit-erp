#!/usr/bin/env node
// FLOWS-5 (W-1107-Volunteers-14X) · TWO OPEN THANK-YOU TASKS FOR ONE GIFT. A DRY RUN; IT WRITES NOTHING.
//
// One gift's thank-you is one thing (server/shared/thankYouOnce.js). Rows
// written before that rule can hold two or more open tasks for the same gift
// (tasks.thanks_gift_id or tasks.source_gift_id). The screens now show only the
// first one written (server/tasks/openTaskRule.js ONE_THANKS); this lists the
// rest, gift by gift: keep the first, close the others. A person closes them
// from the task itself (Done), or Jonathan voids them after reading the list.
//
// Reads every org except org_b72demo (seed-demo.js owns it). org_creo is
// listed, never written (nothing here writes).
//
// Usage:
//   node scripts/ops/flows5-dup-thanks.js                 # every org
//   node scripts/ops/flows5-dup-thanks.js --org=<org_id>  # one org
"use strict";
const { Pool } = require("pg");

const SKIP_ORGS = ["org_b72demo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  try {
    const rows = (await pool.query(
      `SELECT t.org_id, COALESCE(t.thanks_gift_id, t.source_gift_id) AS gift_id, t.id, t.title, t.due, t.created_at, d.name
         FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE COALESCE(t.thanks_gift_id, t.source_gift_id) IS NOT NULL
          AND t.voided_at IS NULL AND COALESCE(t.done::text, '0') NOT IN ('1', 'true')
          AND NOT (t.org_id = ANY($1)) ${one ? "AND t.org_id = $2" : ""}
        ORDER BY t.org_id, gift_id, t.created_at, t.id`, one ? [SKIP_ORGS, one] : [SKIP_ORGS])).rows;
    const byGift = new Map();
    for (const r of rows) { const k = `${r.org_id}|${r.gift_id}`; (byGift.get(k) || byGift.set(k, []).get(k)).push(r); }
    let extra = 0;
    for (const [k, list] of byGift) {
      if (list.length < 2) continue;
      const [keep, ...rest] = list;
      extra += rest.length;
      console.log(`${k.replace("|", " · gift ")} · ${keep.name || "(no person)"} · keep ${keep.id} "${keep.title}"`);
      for (const r of rest) console.log(`    close ${r.id} "${r.title}" (written ${new Date(r.created_at).toISOString().slice(0, 10)})`);
    }
    console.log(`\n${extra} open thank-you task(s) duplicate another for the same gift.`);
    console.log("Dry run: nothing was written.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
