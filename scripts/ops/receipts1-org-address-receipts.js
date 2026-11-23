#!/usr/bin/env node
// RECEIPTS-1 item 3 · RECEIPTS THAT PRINTED THE ORG'S ADDRESS IN THE DONOR BLOCK.
//
// Before RECEIPTS-1 the receipt template printed `snapshot.orgAddress` under the donor's name, on
// every receipt and statement whose org had a receipt address. It never printed the donor's own.
// And an in-kind or stock gift's receipt was drawn like cash, with an AMOUNT box.
//
// READ ONLY, ALWAYS. Nothing is reissued automatically: this tells Jonathan how many, per org.
// An org that wants corrected copies presses Reissue on each receipt (Settings → Tax Receipts →
// Issued receipts), which voids it and makes it again as the same number with -R1.
//
//   DATABASE_URL=… node scripts/ops/receipts1-org-address-receipts.js [--org <org id>]
//
// Counted: ACTIVE receipts (not voided). "No address on file" is the person (or a household
// statement's primary member) with no mailing address today, the case Jarvis saw, where the
// org's address read as the donor's. With --org, every receipt is listed.
"use strict";

const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");

async function main() {
  const { query } = require("../../db");
  const RP = require("../../server/receipts/receiptParts");
  const NON_CASH = [...RP.NON_CASH];
  const rows = await query(
    `SELECT r.org_id, r.id, r.receipt_number, r.type, r.tax_year, r.created_at, d.name AS donor_name,
            (COALESCE(BTRIM(d.address), '') = '' AND COALESCE(BTRIM(d.city), '') = '') AS donor_has_no_address,
            ${RP.ORG_ADDRESS_IN_DONOR_BLOCK_SQL("r")} AS org_address_in_donor_block,
            (r.type = 'gift' AND LOWER(BTRIM(COALESCE(g.type, ''))) = ANY(?) AND (r.snapshot::jsonb -> 'nonCash') IS NULL) AS non_cash_with_amount
       FROM receipts r
       LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
       LEFT JOIN gifts g ON g.id = r.gift_id AND g.org_id = r.org_id
      WHERE r.voided_at IS NULL AND (?::text IS NULL OR r.org_id = ?)
        AND (${RP.ORG_ADDRESS_IN_DONOR_BLOCK_SQL("r")}
             OR (r.type = 'gift' AND LOWER(BTRIM(COALESCE(g.type, ''))) = ANY(?) AND (r.snapshot::jsonb -> 'nonCash') IS NULL))
      ORDER BY r.org_id, r.created_at`, [NON_CASH, ORG, ORG, NON_CASH]);

  const byOrg = new Map();
  for (const r of rows) {
    const o = byOrg.get(r.org_id) || { addr: 0, noAddr: 0, nonCash: 0 };
    if (r.org_address_in_donor_block) { o.addr++; if (r.donor_has_no_address) o.noAddr++; }
    if (r.non_cash_with_amount) o.nonCash++;
    byOrg.set(r.org_id, o);
  }
  const sum = k => [...byOrg.values()].reduce((n, o) => n + o[k], 0);
  console.log(`Active receipts that printed the org's address under the donor's name: ${sum("addr")}`
    + ` (${sum("noAddr")} of them for a person with no address on file).`);
  console.log(`Active in-kind or stock receipts drawn with an AMOUNT box: ${sum("nonCash")}.`);
  console.log(`${ORG ? `In ${ORG}.` : `Across ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}.`}\n`);
  if (byOrg.size) console.log(`  ${"org".padEnd(28)} ${"org address".padStart(11)} ${"no address".padStart(10)} ${"in-kind".padStart(8)}`);
  for (const [org, o] of byOrg) console.log(`  ${org.padEnd(28)} ${String(o.addr).padStart(11)} ${String(o.noAddr).padStart(10)} ${String(o.nonCash).padStart(8)}`);
  if (ORG) for (const r of rows) {
    const why = [r.org_address_in_donor_block && "org address in donor block", r.non_cash_with_amount && "in-kind drawn with an AMOUNT"].filter(Boolean).join("; ");
    console.log(`    #${r.receipt_number} ${r.type}${r.tax_year ? ` ${r.tax_year}` : ""} · ${r.donor_name || "(no person)"}${r.donor_has_no_address ? " (no address on file)" : ""} · ${why}`);
  }
  console.log("\nDry run: nothing was written, and nothing is reissued automatically. An org reissues a receipt"
    + " itself with Reissue in Settings → Tax Receipts → Issued receipts (void, same number with -R1).");
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main };
