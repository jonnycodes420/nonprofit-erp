#!/usr/bin/env node
// PLEDGES-3 · THE ROWS WRITTEN BEFORE THIS BUILD THAT STILL CARRY THE OLD STATE. A DRY RUN; IT WRITES NOTHING.
//
// The code fixes read live, so most old rows show right the moment this build
// is deployed: a pledge's five values come from its payments (summaryOf), a
// receipt's drift from its gift as it is now, a grant's "payments not set up"
// from its status and amount. What this lists is what a person still has to
// act on, and the pledge flags REPAIR-1 recomputes:
//   1. pledge flags   installments whose paid flag disagrees with the payments
//                     applied oldest due first (shared/numbers/pledges.js).
//                     Every surface now ignores a missing flag; a flag set on an
//                     installment the money never reached still counts as paid
//                     there. REPAIR-1's demo-tidy step 10 and
//                     scripts/ops/repair1-all-orgs.js recompute them.
//   2. receipts       issued gift receipts whose gift changed after issue (the
//                     W-1108-Finance-09X shape). Each shows "Gift changed after
//                     this receipt" with Void and reissue; a receipt is never
//                     edited by a script, so this only counts them.
//   3. grants         awarded by status with no award row (W-1107-Finance-31).
//                     Each now says "payments not set up · Set up payments".
//
// Reads every org except org_b72demo (seed-demo.js owns it). org_creo is
// listed, never written (nothing here writes).
//
// Usage:
//   node scripts/ops/pledges3-old-rows.js                 # every org
//   node scripts/ops/pledges3-old-rows.js --org=<org_id>  # one org
"use strict";
const { Pool } = require("pg");
const { installmentsLeft, PAID_OF } = require("../../shared/numbers/pledges");

const SKIP_ORGS = ["org_b72demo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply. See the header for who acts on each list."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  const orgWhere = one ? "AND p.org_id = $2" : "";
  const args = one ? [SKIP_ORGS, one] : [SKIP_ORGS];
  try {
    // 1 · pledge flags
    const pl = (await pool.query(
      `SELECT p.id, p.org_id, p.amount,
              ${PAID_OF("p")} AS paid,
              json_agg(json_build_object('id', i.id, 'seq', i.seq, 'dueDate', LEFT(i.due_date::text, 10), 'amount', i.amount, 'flag', i.paid_gift_id IS NOT NULL) ORDER BY i.due_date, i.seq) AS inst
         FROM pledges p JOIN pledge_installments i ON i.pledge_id = p.id AND i.org_id = p.org_id
        WHERE p.status = 'open' AND NOT (p.org_id = ANY($1)) ${orgWhere}
        GROUP BY p.id, p.org_id, p.amount`, args).catch(e => { console.error("pledges:", e.message); return { rows: [] }; })).rows;
    const off = [];
    for (const p of pl) {
      // the payments alone, applied oldest due first: what the flags should say
      const left = installmentsLeft({ amount: p.amount, paid: p.paid, installments: p.inst.map(i => ({ ...i, paid: false })) });
      const bad = p.inst.filter((i, k) => i.flag !== (left[k].left <= 0));
      if (bad.length) off.push({ org: p.org_id, pledge: p.id, installments: bad.map(i => `${i.seq}:${i.dueDate}:${i.flag ? "flagged, not covered" : "covered, not flagged"}`) });
    }
    console.log(`1 · pledge flags: ${off.length} open ${off.length === 1 ? "pledge has" : "pledges have"} installment flags that disagree with the payments.`);
    for (const o of off.slice(0, 200)) console.log(`   ${o.org} ${o.pledge}  ${o.installments.join(", ")}`);
    // 2 · receipts whose gift changed after issue
    const rc = (await pool.query(
      `SELECT r.org_id, r.id, r.receipt_number, r.amount, g.amount AS gift_amount, (g.id IS NULL) AS gift_missing
         FROM receipts r LEFT JOIN gifts g ON g.id = r.gift_id AND g.org_id = r.org_id
        WHERE r.type = 'gift' AND r.voided_at IS NULL AND r.gift_id IS NOT NULL AND NOT (r.org_id = ANY($1)) ${one ? "AND r.org_id = $2" : ""}
          AND (g.id IS NULL OR ROUND(g.amount * 100) <> ROUND(r.amount * 100))
        ORDER BY r.org_id, r.created_at`, args)).rows;
    console.log(`2 · receipts: ${rc.length} issued ${rc.length === 1 ? "receipt stands" : "receipts stand"} against a gift that changed after issue (each shows Void and reissue).`);
    for (const r of rc.slice(0, 200)) console.log(`   ${r.org_id} #${r.receipt_number}  receipt $${Number(r.amount)}  gift ${r.gift_missing ? "removed" : "$" + Number(r.gift_amount)}`);
    // 3 · grants awarded by status, no award row
    const gr = (await pool.query(
      `SELECT g.org_id, g.id, g.funder, g.amount_awarded FROM grants g
        WHERE g.status = 'awarded' AND g.award_pledge_id IS NULL AND NOT (g.org_id = ANY($1)) ${one ? "AND g.org_id = $2" : ""}
        ORDER BY g.org_id, g.funder`, args)).rows;
    console.log(`3 · grants: ${gr.length} ${gr.length === 1 ? "grant is" : "grants are"} awarded with no award row (each shows Set up payments).`);
    for (const g of gr.slice(0, 200)) console.log(`   ${g.org_id} ${g.id}  ${g.funder}  awarded ${g.amount_awarded == null ? "(no amount)" : "$" + Number(g.amount_awarded)}`);
    console.log("\nDry run: nothing was written.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
