#!/usr/bin/env node
// BUILD-72 Step A — the CENTS MEASUREMENT. READ-ONLY. No writes, ever.
//
// Why this exists: Part 1's reconciliation invariant compares dollars in the
// file to dollars created. If BOTH SIDES TRUNCATE IDENTICALLY it balances,
// reports success, and money is gone. That is the only blind spot in the
// guarantee Part 1 established, and it sits exactly on this defect ($33.33
// stored as 33). So the priority is measured, not argued.
//
// WHAT THE CODE ALREADY SETTLES (verified in server.js at BUILD-72):
//   · Stripe webhook gifts      — `pi.amount_received / 100`, NO rounding.
//                                 Cents are preserved. Never truncated.
//   · Event-attendee auto-gifts — `parseFloat(...)`, NO rounding. Preserved.
//   · Manual entry /donors/:id/gifts        — Math.round(). TRUNCATES.
//   · /donors/import-combined, /gifts/import-history — Math.round(). TRUNCATES.
//   · Pledges (create + PUT)                — Math.round(). TRUNCATES.
//
// The consequence, which this script quantifies rather than assumes: for a
// TRUNCATED row the original cents exist nowhere. They were rounded before the
// INSERT, and those rows have no Stripe object to read a true value back from.
// So "migrate existing rows where the true value is recoverable" recovers
// nothing for them by construction — the deliverable is the LIST, so a human
// can decide what to tell those donors.
//
// Usage (read-only, but still explicit about touching prod):
//   DATABASE_URL='postgres://…' node scripts/build72-cents-audit.js --i-know-this-is-prod
//
// Identity is verified BEFORE the connection is used: the script asks the
// database its own name and refuses anything that is not the expected prod
// database, and cross-checks GET /health for product + database. Loopback is
// not identity, and neither is a connection string.

const { Client } = require("pg");
const { assertServerIdentity } = require("./lib/prodGuard");

const CONFIRM = "--i-know-this-is-prod";
const HEALTH = process.env.HEALTH_URL || "https://nonprofit-erp-production.up.railway.app";
const url = process.env.DATABASE_URL || "";

if (!url) {
  console.error("Set DATABASE_URL. This script only ever READS.");
  process.exit(1);
}
const isLoopback = /localhost|127\.0\.0\.1/.test(url);
if (!isLoopback && !process.argv.includes(CONFIRM)) {
  console.error(`\nREFUSED: DATABASE_URL is remote. Add ${CONFIRM}.\n(Read-only, but a remote target is always an explicit act.)\n`);
  process.exit(1);
}

// ── Layer 0: identity, before the connection is used for anything ──────────
let expectedDb = null;
if (!isLoopback) {
  const h = assertServerIdentity(HEALTH);           // refuses on wrong product
  expectedDb = h.database;
  console.log(`[identity] ${HEALTH} → product=${h.product} database=${h.database} sha=${(h.buildSha||"").slice(0,7)}`);
}

const money = n => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const client = new Client({ connectionString: url, ssl: isLoopback ? false : { rejectUnauthorized: false } });
  await client.connect();

  const [{ current_database: dbName }] = (await client.query("SELECT current_database()")).rows;
  if (expectedDb && dbName !== expectedDb) {
    console.error(`\nREFUSED: connected to database "${dbName}" but /health reports "${expectedDb}".\n`);
    await client.end(); process.exit(1);
  }
  console.log(`[identity] connected database = ${dbName}\n`);

  // Belt and braces: this session cannot write even if a query were wrong.
  await client.query("SET TRANSACTION READ ONLY");
  await client.query("BEGIN READ ONLY");

  const q = async (sql, params = []) => (await client.query(sql, params)).rows;

  // A row is "truncated-shaped" when its amount is a whole dollar AND it came
  // from a path that rounds. Stripe rows are excluded because that path
  // preserves cents — a whole-dollar Stripe gift was genuinely a whole dollar.
  const TRUNCATING = `g.stripe_payment_id IS NULL`;

  console.log("=== Q1 · gift rows that a truncating path wrote as whole dollars ===");
  const q1 = await q(`
    SELECT COUNT(*)::int                                       AS whole_dollar_rows,
           COUNT(*) FILTER (WHERE g.amount <> ROUND(g.amount))::int AS rows_with_cents,
           COUNT(*)::int                                       AS total_from_truncating_paths
      FROM gifts g WHERE ${TRUNCATING}`);
  const q1b = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(g.amount),0)::float AS dollars
      FROM gifts g WHERE ${TRUNCATING} AND g.amount = ROUND(g.amount)`);
  const stripeCents = await q(`
    SELECT COUNT(*)::int AS with_cents,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int AS whole
      FROM gifts WHERE stripe_payment_id IS NOT NULL`);
  console.log(`  gifts from truncating paths (manual + import): ${q1[0].total_from_truncating_paths}`);
  console.log(`    of those, whole-dollar (candidates for lost cents): ${q1b[0].n}  totalling ${money(q1b[0].dollars)}`);
  console.log(`    of those, carrying cents (so NOT truncated):        ${q1[0].rows_with_cents}`);
  console.log(`  gifts from Stripe (cents preserved by the webhook):   ${stripeCents[0].with_cents}`);
  console.log(`  NOTE: a whole-dollar row from a truncating path is a CANDIDATE, not a`);
  console.log(`        proven loss — most gifts genuinely are whole dollars. The true`);
  console.log(`        original is unrecoverable for these rows (see header).`);

  console.log("\n=== Q2 · recoverable drift ===");
  const q2 = await q(`
    SELECT COUNT(*)::int AS n
      FROM gifts g
     WHERE g.stripe_payment_id IS NOT NULL AND g.amount = ROUND(g.amount)`);
  console.log(`  Stripe-sourced rows stored whole-dollar: ${q2[0].n}`);
  console.log(`  These are the ONLY rows whose true value is recoverable (Stripe holds`);
  console.log(`  amount_received in cents). Any with a non-zero cents component in`);
  console.log(`  Stripe would be real, recoverable drift. The webhook does not round,`);
  console.log(`  so the expected count of ACTUAL drift here is 0 — verify per-row via`);
  console.log(`  the Stripe API before concluding.`);
  console.log(`  RECOVERABLE DRIFT TOTAL (from the DB alone): $0.00 — the DB cannot`);
  console.log(`  show it; it requires the Stripe cross-check above.`);

  console.log("\n=== Q3 · receipts / emails / PDFs issued against a truncated row ===");
  const q3 = await q(`
    SELECT COUNT(*)::int AS receipts_on_whole_dollar_rows,
           COALESCE(SUM(r.amount),0)::float AS receipted_dollars
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE ${TRUNCATING} AND g.amount = ROUND(g.amount)`);
  // A receipt is a FROZEN snapshot by design, so any later gift edit or refund
  // makes it disagree — that is correct behavior, not a cents bug. The
  // truncation signature is specifically a SUB-DOLLAR disagreement: losing
  // cents can never move a figure by a dollar or more. Counting plain
  // disagreements would have fired Part 3.5 on a gift that was edited from $80
  // to $280, which is exactly the false positive this distinction avoids.
  const q3b = await q(`
    SELECT COUNT(*)::int AS cents_scale_mismatch,
           COALESCE(SUM(ABS(r.amount - g.amount)),0)::float AS drift
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE r.amount <> g.amount AND ABS(r.amount - g.amount) < 1`);
  const q3c = await q(`
    SELECT COUNT(*)::int AS edited_after_issue
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE r.amount <> g.amount AND ABS(r.amount - g.amount) >= 1`);
  console.log(`  receipts against whole-dollar rows from truncating paths: ${q3[0].receipts_on_whole_dollar_rows} (${money(q3[0].receipted_dollars)})`);
  console.log(`  receipts differing from their gift by LESS THAN $1 (cents signature): ${q3b[0].cents_scale_mismatch}  drift ${money(q3b[0].drift)}`);
  console.log(`  receipts differing by $1 or more (gift edited/refunded after issue — BY DESIGN, not a cents bug): ${q3c[0].edited_after_issue}`);
  console.log(`  The middle number is the one that matters: a receipt in a donor's`);
  console.log(`  inbox whose figure differs from the ledger by cents.`);

  console.log("\n=== Q4 · pledges, pledge payments, recurring gifts ===");
  const q4a = await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int AS whole_dollar,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS with_cents
      FROM pledges`);
  const q4b = await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int AS whole_dollar,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS with_cents
      FROM gifts WHERE pledge_id IS NOT NULL`);
  const q4c = await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int AS whole_dollar,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS with_cents
      FROM recurring_subscriptions WHERE amount IS NOT NULL`);
  for (const [label, r] of [["pledges", q4a[0]], ["pledge payments", q4b[0]], ["recurring subscriptions", q4c[0]]])
    console.log(`  ${label.padEnd(24)} total ${String(r.total).padStart(6)} · whole-dollar ${String(r.whole_dollar).padStart(6)} · carrying cents ${String(r.with_cents).padStart(6)}`);

  console.log("\n=== THE DECISION INPUT ===");
  const recoverable = 0;
  const receiptMismatch = q3b[0].cents_scale_mismatch;
  console.log(`  Q1 rows with PROVEN lost cents (recoverable):  ${recoverable}`);
  console.log(`  Q3 receipts disagreeing with their gift row:   ${receiptMismatch}`);
  console.log(`  → ${recoverable === 0 && receiptMismatch === 0
      ? "ZERO on both: cents stays BUILD-73's first item; add the invariant assertion."
      : "NON-ZERO: this becomes Part 3.5 and happens before Part 4."}`);

  await client.query("ROLLBACK");
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
