#!/usr/bin/env node
// scripts/ops/flows11-old-rows.js · FLOWS-11. DRY RUN ONLY: it reads and writes nothing.
//
// Two kinds of row that FLOWS-11's fixes stop making but do not mend:
//
//  1. W-1114-Finance-04X · open thank-you tasks whose gift is gone. A task Steward made for a
//     gift (`source_gift_id`) whose gift was deleted before FIX-10's void, and the open step of a
//     journey a deleted gift started: a gift trigger's `gift:<id>` naming no gift, or a first-gift
//     journey whose person has no gift left. FLOWS-11's delete now stops these with the gift; the
//     rows below were left before it. REPAIR-1 voids each task with reason `gift_deleted`, closes
//     its thread, stops the journey and writes "Gift removed, thank-you cancelled." on the record.
//  2. W-1114-Finance-26X · people whose Add person "Gift amount" left a stored gift count or last
//     gift amount with no gift behind it. Their Lifetime is right (the total is kept as giving
//     from before Steward and now says so); the stored `gift_count` / `last_gift_amount` are what
//     the next recompute clears. REPAIR-1 runs donorSummary's recompute for each.
//
//   DATABASE_URL=… node scripts/ops/flows11-old-rows.js
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js); it only reads.
"use strict";
const { Pool } = require("pg");

const GIFT = g => `(${g}.amount > 0 AND ${g}.refunded_in_full IS NOT TRUE)`;

(async () => {
  const pool = new Pool({ connectionString: require("../lib/prodGuard").writerDbUrl() });
  try {
    const tasks = (await pool.query(
      `SELECT t.org_id, t.id, t.title, LEFT(t.due::text, 10) AS due, t.donor_id, d.name AS donor_name, 'its gift ' || t.source_gift_id || ' is gone' AS why
         FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.source_gift_id IS NOT NULL AND t.voided_at IS NULL AND COALESCE(t.done, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = t.source_gift_id AND g.org_id = t.org_id)
       UNION ALL
       SELECT t.org_id, t.id, t.title, LEFT(t.due::text, 10), p.donor_id, d.name,
              'step of "' || COALESCE(p.template_name, 'a journey') || '", started by a gift that is gone'
         FROM cultivation_plans p
         JOIN cultivation_plan_steps s ON s.plan_id = p.id AND s.org_id = p.org_id AND s.status = 'open' AND s.thread_id IS NOT NULL
         JOIN tasks t ON t.thread_id = s.thread_id AND t.org_id = p.org_id AND t.voided_at IS NULL AND COALESCE(t.done, 0) = 0
         LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE p.status = 'active' AND d.deleted_at IS NULL
          AND ((p.source_gift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = p.source_gift_id AND g.org_id = p.org_id))
            OR (p.trigger_event LIKE 'gift:%' AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = substr(p.trigger_event, 6) AND g.org_id = p.org_id))
            OR (p.source_gift_id IS NULL AND p.trigger_key = 'first_gift'
                AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = p.org_id AND g.donor_id = p.donor_id AND g.amount > 0)))
        ORDER BY 1, 6, 4`)).rows;
    const byOrg = new Map();
    for (const r of tasks) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
    console.log(`1. Open thank-you tasks whose gift is gone: ${tasks.length}`);
    for (const [org, n] of byOrg) console.log(`   ${org}: ${n}`);
    for (const r of tasks) console.log(`   ${r.org_id} · task ${r.id} · "${r.title}" due ${r.due || "no date"} · ${r.donor_name || r.donor_id} · ${r.why}`);

    const people = (await pool.query(
      `SELECT d.org_id, d.id, d.name, d.gift_count, d.last_gift_amount::text AS last_amount, d.imported_total::text AS before_steward
         FROM donors d
        WHERE d.deleted_at IS NULL AND d.imported_source = 'an amount typed in when they were added'
          AND (COALESCE(d.gift_count, 0) > 0 OR COALESCE(d.last_gift_amount, 0) <> 0)
          AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND ${GIFT("g")})
        ORDER BY d.org_id, d.name`)).rows;
    console.log(`\n2. People added with a typed "Gift amount" whose stored gift count or last gift has no gift behind it: ${people.length}`);
    for (const r of people) console.log(`   ${r.org_id} · ${r.name} (${r.id}) · stored gifts ${r.gift_count} · last ${r.last_amount} · before Steward ${r.before_steward}`);
    console.log("\nDry run: nothing written. Hand this to REPAIR-1.");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
