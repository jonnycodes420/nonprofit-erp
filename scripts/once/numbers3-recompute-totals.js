#!/usr/bin/env node
// NUMBERS-3 · Bring every person's stored rollup up to the one last-gift rule.
//
// NUMBERS-3 settled what a person's first and last gift are: a GIFT, money
// above zero (shared/numbers/lastGift.js, firstGift.js). Before it, a refund
// dated after the last gift was the stored last gift (with a negative amount),
// and a soft or matching credit row could be anyone's first or last gift. The
// rollup (donors.first_gift_date, last_gift_date, last_gift_amount, and with
// them total_giving and gift_count) is recomputed on every write, so a person
// nobody has touched since the deploy still carries the old answer. This
// brings them up to date with the same statement every write runs
// (donorSummary.DONOR_SUMMARY_UPDATE). Nothing changes at deploy.
//
// DRY RUN BY DEFAULT. It prints, per org, how many people would change and a
// few of them (old and new values), and writes nothing. Only `--apply` writes.
// org_creo is never touched. Jonathan runs it; a build never runs it on prod.
//
//   DATABASE_URL=… node scripts/once/numbers3-recompute-totals.js                 # dry run
//   DATABASE_URL=… node scripts/once/numbers3-recompute-totals.js --apply --i-know-this-is-prod
//
// --apply resolves its database through scripts/lib/prodGuard.js (a remote
// DATABASE_URL needs --i-know-this-is-prod as well). Delete this script once it
// has run on prod and Jonathan says so (ARCHITECTURE.md, scripts/once/).
"use strict";
const apply = process.argv.includes("--apply");
if (apply) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const SKIP = ["org_creo"];

(async () => {
  const { query, run } = require("../../db");
  const { DONOR_SUMMARY_UPDATE, DONOR_SUMMARY_DIFF } = require("../../donorSummary");
  const orgs = (await query(`SELECT id FROM orgs WHERE NOT (id = ANY(?)) ORDER BY id`, [SKIP])).map(r => r.id);
  console.log(`${apply ? "APPLY" : "DRY RUN"} · ${orgs.length} org(s) (skipping ${SKIP.join(", ")})`);
  let people = 0, touched = 0;
  for (const org of orgs) {
    const diff = await query(DONOR_SUMMARY_DIFF(""), [org]);
    if (!diff.length) continue;
    people += diff.length; touched++;
    console.log(`  ${org}  ${diff.length} person(s)`);
    for (const d of diff.slice(0, 3)) {
      console.log(`    ${d.id}  last ${d.stored_last || "-"} ${d.stored_last_amt ?? "-"} → ${d.last_date || "-"} ${d.last_amt ?? "-"}`
        + `  first ${d.stored_first || "-"} → ${d.first_date || "-"}  total ${d.stored_total} → ${d.total}  gifts ${d.stored_n} → ${d.n}`);
    }
    if (apply) await run(DONOR_SUMMARY_UPDATE(""), [org]);
  }
  console.log(`${people} person(s) in ${touched} org(s) ${apply ? "recomputed" : "would change"}.${apply ? "" : people ? " Nothing was changed. Run again with --apply to write them." : " Nothing to do."}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
