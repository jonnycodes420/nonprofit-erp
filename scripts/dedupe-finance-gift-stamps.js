#!/usr/bin/env node
// BUILD-55: defaults to the LOCAL scratch stack. Running against prod now requires
// BOTH an explicit BASE= AND --i-know-this-is-prod (see scripts/lib/prodGuard.js).
// BUILD-21 Part 3 — de-duplicate double-stamped gift ledger rows.
//
// The old donor-profile "log gift" flow stamped fin_transactions TWICE for one
// gift: the server auto-stamp (source=gift, donor_id + fund set — correct) PLUS
// a stray client-side POST /finance/transactions (source=manual, no fund). This
// inflated Cash on Hand (the demo showed ~$106k for a real ~$55k). The code is
// now fixed (one idempotent stamp per gift); this cleans up rows already made.
//
// It matches each stray manual row to its correct gift-sourced twin by
// (date, amount, vendor_donor, description) and deletes ONLY the manual dupe,
// keeping the gift/online/import-sourced row. A group must contain BOTH a
// gift-sourced row AND a manual "Gift from …"/"Online gift" row to be touched —
// a lone manual entry (a real hand-keyed transaction) is never deleted.
//
// SAFE BY DEFAULT: dry-run unless --apply. Exports matched rows to a timestamped
// docs/ JSON before deleting (recoverable). Deletes via the authenticated admin
// API (DELETE /finance/transactions/:id, which writes fin_audit_log) — no direct
// DB access. IDEMPOTENT: after apply, a re-run matches 0 rows.
//
// Usage:
//   node scripts/dedupe-finance-gift-stamps.js               # dry run (default)
//   node scripts/dedupe-finance-gift-stamps.js --apply       # actually delete
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/dedupe-finance-gift-stamps.js --apply

const fs = require("fs");
const path = require("path");

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@creoarts.org";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "demo1234";
const APPLY = process.argv.includes("--apply");

const GIFT_SOURCES = new Set(["gift", "online", "import", "event"]);
const looksLikeGiftDesc = d => /^Gift from/.test(d || "") || /^Online gift/.test(d || "") || /^Event Gift/.test(d || "");
const groupKey = t => `${t.date}|${Number(t.amount)}|${(t.vendor_donor || "").trim()}|${(t.description || "").trim()}`;

// From the org's ledger, return the manual "Gift from …" rows that duplicate a
// gift-sourced twin. Keeps the gift-sourced row; if a group somehow has several
// manual dupes and one gift twin, all the manual dupes go.
function findManualDupes(rows) {
  const groups = new Map();
  for (const t of rows) {
    if (t.type !== "income") continue;
    const k = groupKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const dupes = [];
  for (const rowsInGroup of groups.values()) {
    const hasGiftTwin = rowsInGroup.some(t => (t.gift_id && t.gift_id.length) || GIFT_SOURCES.has(t.source));
    if (!hasGiftTwin) continue; // lone manual entry — never touch
    for (const t of rowsInGroup) {
      if (t.source === "manual" && !(t.gift_id && t.gift_id.length) && looksLikeGiftDesc(t.description)) {
        dupes.push(t);
      }
    }
  }
  return dupes;
}

async function main() {
  const loginRes = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const login = await loginRes.json();
  if (!login.token) { console.error("Login failed:", login); process.exit(1); }
  const auth = { Authorization: "Bearer " + login.token };

  const before = await (await fetch(BASE + "/finance/summary?yearMode=calendar", { headers: auth })).json();
  const rows = await (await fetch(BASE + "/finance/transactions", { headers: auth })).json();
  const dupes = findManualDupes(Array.isArray(rows) ? rows : []);
  const dupTotal = dupes.reduce((s, o) => s + parseFloat(o.amount), 0);

  console.log(`BASE: ${BASE}`);
  console.log(`Cash on Hand before: $${Number(before.cashOnHand || 0).toLocaleString()}`);
  console.log(`Duplicate manual gift-stamps matched: ${dupes.length}  (income $${dupTotal.toLocaleString()})`);

  if (dupes.length === 0) { console.log("Nothing to do — ledger already deduped. (idempotent no-op)"); return; }

  if (!APPLY) {
    console.log("\nDRY RUN — no changes made. Re-run with --apply to delete these rows.");
    dupes.slice(0, 8).forEach(o => console.log(`  ${o.id}  ${o.date}  $${o.amount}  ${o.description}  [${o.source}]`));
    console.log(`Projected Cash on Hand after: $${(Number(before.cashOnHand || 0) - dupTotal).toLocaleString()}`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `finance-gift-stamp-dupes-removed-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(dupes, null, 2));
  console.log(`\nSaved ${dupes.length} rows to ${outFile} (recoverable) before deleting.`);

  let deleted = 0;
  for (const o of dupes) {
    const r = await fetch(BASE + "/finance/transactions/" + o.id, { method: "DELETE", headers: auth });
    if (r.ok) deleted++;
    else console.error(`  FAILED to delete ${o.id}: ${r.status}`);
  }
  const after = await (await fetch(BASE + "/finance/summary?yearMode=calendar", { headers: auth })).json();
  console.log(`Deleted ${deleted}/${dupes.length} rows.`);
  console.log(`Cash on Hand after: $${Number(after.cashOnHand || 0).toLocaleString()}`);
}

module.exports = { findManualDupes };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
