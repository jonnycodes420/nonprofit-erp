#!/usr/bin/env node
// BUILD-10 Part 3 — demo Finance ledger coherence fix.
//
// The demo org's fin_transactions ledger was inflated to ~$626k Cash on Hand by
// 76 ORPHANED gift-sync rows: all dated 2025-12-31, all donor_id=NULL, all
// inserted in a single 2026-06-12 batch, all under acc_4010 "Individual
// Contributions", with descriptions "Gift from …" / "Online gift via Stripe".
// Actual donor lifetime giving only totals ~$162k — these rows are left-behind
// bookkeeping from test donors that were later purged (purge-trash deliberately
// leaves fin_transactions untouched). They make the Overview YoY delta and the
// monthly breakdown incoherent.
//
// This removes ONLY those orphans so the demo ledger reconciles with real donor
// data, via the authenticated admin API (DELETE /finance/transactions/:id, which
// also writes fin_audit_log) — no direct DB access, works against prod with just
// the documented demo login.
//
// SAFE BY DEFAULT: dry-run unless --apply is passed. Before deleting anything it
// writes the full row set to a timestamped JSON in docs/ so the change is
// recoverable. IDEMPOTENT: after a successful apply, a re-run matches 0 rows.
//
// Usage:
//   node scripts/fix-demo-finance-ledger.js               # dry run (default)
//   node scripts/fix-demo-finance-ledger.js --apply       # actually delete
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/fix-demo-finance-ledger.js --apply
//
// Predicate (exact — no heuristics beyond these three, all confirmed true for
// every one of the 76 rows and false for every legitimate seed/real row):
//   date = '2025-12-31'  AND  donor_id IS NULL  AND
//   (description starts with 'Gift from' OR 'Online gift')

const fs = require("fs");
const path = require("path");

// Prod is an explicit BASE= opt-in on every seed/fix script (2026-08-15 rule,
// pinned by tests/demo-content.test.js) — this one used to default to prod.
const BASE = process.env.BASE || "http://localhost:5601";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@creoarts.org";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "demo1234";
const APPLY = process.argv.includes("--apply");

const isOrphan = t =>
  t.date === "2025-12-31" &&
  !t.donor_id &&
  (/^Gift from/.test(t.description || "") || /^Online gift/.test(t.description || ""));

async function main() {
  const loginRes = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const login = await loginRes.json();
  if (!login.token) { console.error("Login failed:", login); process.exit(1); }
  const token = login.token;
  const auth = { Authorization: "Bearer " + token };

  const before = await (await fetch(BASE + "/finance/summary?yearMode=calendar", { headers: auth })).json();
  const rows = await (await fetch(BASE + "/finance/transactions?year=2025", { headers: auth })).json();
  const orphans = rows.filter(isOrphan);

  const income = orphans.filter(o => o.type === "income").reduce((s, o) => s + parseFloat(o.amount), 0);
  console.log(`BASE: ${BASE}`);
  console.log(`Cash on Hand before: $${before.cashOnHand.toLocaleString()}`);
  console.log(`Orphan rows matched: ${orphans.length}  (income $${income.toLocaleString()})`);

  if (orphans.length === 0) {
    console.log("Nothing to do — ledger already clean. (idempotent no-op)");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no changes made. Re-run with --apply to delete these rows.");
    console.log("Sample matched rows:");
    orphans.slice(0, 5).forEach(o => console.log(`  ${o.id}  ${o.date}  $${o.amount}  ${o.description}`));
    console.log(`Projected Cash on Hand after: $${(before.cashOnHand - income).toLocaleString()}`);
    return;
  }

  // Export before deleting (recoverable).
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `demo-finance-orphans-removed-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(orphans, null, 2));
  console.log(`\nSaved ${orphans.length} rows to ${outFile} (recoverable) before deleting.`);

  let deleted = 0;
  for (const o of orphans) {
    const r = await fetch(BASE + "/finance/transactions/" + o.id, { method: "DELETE", headers: auth });
    if (r.ok) deleted++;
    else console.error(`  FAILED to delete ${o.id}: ${r.status}`);
  }
  const after = await (await fetch(BASE + "/finance/summary?yearMode=calendar", { headers: auth })).json();
  console.log(`Deleted ${deleted}/${orphans.length} rows.`);
  console.log(`Cash on Hand after: $${after.cashOnHand.toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
