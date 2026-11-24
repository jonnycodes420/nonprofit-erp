#!/usr/bin/env node
// THANKS-1 item 2 · GIFTS WHOSE ONLY ACKNOWLEDGMENT IS A RECEIPT.
//
// Before THANKS-1 every screen read gifts.acknowledgement_sent as "Thanked",
// and the receipt writer sets that mark the moment a PDF is made (the IRS
// rule). So a receipted gift read "Thanked" with no thank-you sent. Since
// THANKS-1 "thanked" is shared/numbers/thanks.js: `thanked_at`, or a legacy
// mark with no receipt behind it. This lists, per org, the gifts marked
// acknowledged with no thank-you clock:
//   · with a receipt: they now read "Receipt issued, not thanked yet", which
//     is the truth; they wait for a thank-you like any other gift;
//   · without a receipt: a mark from before the clock existed (or an import);
//     they still read "Thanked".
//
// READ ONLY. It changes nothing, and has no --apply: nothing needs repair.
//
//   DATABASE_URL=… node scripts/ops/thanks1-receipt-not-thanked.js [--org <org id>] [--i-know-this-is-prod]
"use strict";

const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
if (!process.env.DATABASE_URL) { console.error("\nREFUSED: set DATABASE_URL first.\n"); process.exit(2); }
process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();   // a remote database needs --i-know-this-is-prod

const { HAS_RECEIPT } = require("../../shared/numbers/thanks");
const COUNT_SQL = `
  SELECT g.org_id, o.name AS org_name,
         COUNT(*) FILTER (WHERE ${HAS_RECEIPT("g")})::int AS receipt_only,
         COUNT(*) FILTER (WHERE NOT ${HAS_RECEIPT("g")})::int AS legacy_mark
    FROM gifts g LEFT JOIN orgs o ON o.id = g.org_id
   WHERE COALESCE(g.acknowledgement_sent, false) AND g.thanked_at IS NULL AND g.amount > 0
     AND ($1::text IS NULL OR g.org_id = $1)
   GROUP BY g.org_id, o.name ORDER BY g.org_id`;

async function main() {
  const { query } = require("../../db");
  const rows = await query(COUNT_SQL, [ORG || null]);
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  console.log(`Gifts marked acknowledged with no thank-you: ${sum("receipt_only") + sum("legacy_mark")}${ORG ? ` in ${ORG}` : ` in ${rows.length} ${rows.length === 1 ? "org" : "orgs"}`}.`);
  console.log(`  ${"org".padEnd(28)} ${"receipt only".padStart(13)} ${"legacy mark".padStart(12)}`);
  for (const r of rows) console.log(`  ${(r.org_id + (r.org_name ? ` (${r.org_name})` : "")).slice(0, 28).padEnd(28)} ${String(r.receipt_only).padStart(13)} ${String(r.legacy_mark).padStart(12)}`);
  console.log("\nReceipt only: now \"Receipt issued, not thanked yet\" (the truth). Legacy mark: still \"Thanked\".\nRead only: nothing was written.");
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
module.exports = { COUNT_SQL };
