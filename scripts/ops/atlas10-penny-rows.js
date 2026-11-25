#!/usr/bin/env node
// ATLAS-10 item 6 — "Finance Transactions contains $0.01 gift/refund rows" (fleet, prod).
//
// Not reproduced on staging (no $0.01 row in any staging org on 25 Nov 2026), and prod is not
// read from a build. This LISTS every gift and ledger row of exactly one cent, with who wrote it
// and from where (source, created_by, the gift it stamps), so the writer can be named from the
// rows themselves. Never writes.
//
// READ ONLY. Usage:
//   DATABASE_URL=… node scripts/ops/atlas10-penny-rows.js [--org=org_x]
"use strict";

const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;

async function main() {
  const { query } = require("../../db");
  const where = orgArg ? "AND org_id = ?" : "";
  const args = orgArg ? [orgArg] : [];
  const gifts = await query(`SELECT org_id, id, donor_id, amount, date, type, payment_method, created_by, import_id
                               FROM gifts WHERE ABS(amount) = 0.01 ${where} ORDER BY org_id, date`, args).catch(e => { console.error(e.message); return []; });
  const ledger = await query(`SELECT org_id, id, gift_id, amount, date, type, source, created_by, description
                                FROM fin_transactions WHERE ABS(amount) = 0.01 ${where} ORDER BY org_id, date`, args).catch(e => { console.error(e.message); return []; });
  console.log(`Gifts of one cent: ${gifts.length}`);
  for (const g of gifts) console.log(`  ${g.org_id}  ${g.id}  ${g.amount}  ${String(g.date || "").slice(0, 10)}  ${g.type || ""}/${g.payment_method || ""}  by ${g.created_by || "?"}${g.import_id ? `  import ${g.import_id}` : ""}`);
  console.log(`\nLedger rows of one cent: ${ledger.length}`);
  for (const r of ledger) console.log(`  ${r.org_id}  ${r.id}  ${r.amount}  ${String(r.date || "").slice(0, 10)}  ${r.type}/${r.source || ""}  gift ${r.gift_id || "-"}  by ${r.created_by || "?"}  "${String(r.description || "").slice(0, 60)}"`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
