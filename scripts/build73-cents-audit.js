#!/usr/bin/env node
// BUILD-73 Part 1 — THE PRODUCTION CENTS AUDIT. READ-ONLY. No writes, ever.
//
// WHY THIS REPLACES scripts/build72-cents-audit.js
// ------------------------------------------------
// BUILD-72's script defined the affected set as `stripe_payment_id IS NULL`,
// reasoning that the webhook writes `pi.amount_received / 100` and never
// rounds, so a Stripe-sourced row was never truncated. That reasoning is true
// of the WEBHOOK and false of the SYSTEM:
//
//   PUT /gifts/:id  →  `Math.round(Number(amount))`   (server.js, the edit path)
//
// rounds ANY gift, including one carrying a stripe_payment_id. A $33.33 online
// gift whose campaign or notes were corrected through the UI comes back out of
// that route as $33. So the BUILD-72 filter excluded precisely the bucket whose
// true value IS recoverable, and reported "nothing is recoverable" from it.
//
// THE THREE BUCKETS THIS SCRIPT PRODUCES
//   1. Whole-dollar rows WITH a Stripe reference   → RECOVERABLE.
//      gifts.stripe_payment_id is the PaymentIntent id; Stripe holds
//      amount_received as an integer number of cents. The same mapping the
//      reconciliation guard uses (server.js reconcileStripeVsGifts).
//   2. Whole-dollar rows with NO Stripe reference  → NOT RECOVERABLE.
//      Rounded before the INSERT, no upstream object. A human decision.
//   3. Receipts/emails/PDFs issued against any row in 1 or 2 → the set where a
//      real person is holding a document with a wrong number on it.
//   4. The same three questions for pledges, pledge payments and recurring
//      gift amounts.
//
// A whole-dollar row is a CANDIDATE, not a proven loss — most gifts genuinely
// are whole dollars. Bucket 1 is the only one that can be PROVEN, because
// Stripe can be asked. Pass --stripe to do that (needs STRIPE_SECRET_KEY).
//
// Usage:
//   railway run -- node scripts/build73-cents-audit.js --i-know-this-is-prod --stripe
//
// Identity is verified BEFORE the connection is used: GET /health for product +
// database, then the database is asked its own name and the two must agree.
// Loopback is not identity, and neither is a connection string.

const { Client } = require("pg");
const { assertServerIdentity } = require("./lib/prodGuard");

const CONFIRM = "--i-know-this-is-prod";
const HEALTH = process.env.HEALTH_URL || "https://nonprofit-erp-production.up.railway.app";
const url = process.env.DATABASE_URL || "";
const WANT_STRIPE = process.argv.includes("--stripe");
const SAMPLE = Number(process.env.STRIPE_SAMPLE || 25);

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
  console.log(`[identity] ${HEALTH} → product=${h.product} database=${h.database} sha=${(h.buildSha || "").slice(0, 7)}`);
}

const money = n => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s).padStart(n);

(async () => {
  const client = new Client({ connectionString: url, ssl: isLoopback ? false : { rejectUnauthorized: false } });
  await client.connect();

  const [{ current_database: dbName }] = (await client.query("SELECT current_database()")).rows;
  if (expectedDb && dbName !== expectedDb) {
    console.error(`\nREFUSED: connected to database "${dbName}" but /health reports "${expectedDb}".\n`);
    await client.end(); process.exit(1);
  }
  console.log(`[identity] connected database = ${dbName}`);
  console.log(`[mode] READ ONLY transaction · no writes of any kind\n`);

  // Belt and braces: this session cannot write even if a query were wrong.
  await client.query("SET TRANSACTION READ ONLY");
  await client.query("BEGIN READ ONLY");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;

  // Scale first, so every count below has a denominator.
  const [scale] = await q(`
    SELECT (SELECT COUNT(*)::int FROM gifts)                                   AS gifts,
           (SELECT COUNT(*)::int FROM gifts WHERE stripe_payment_id IS NOT NULL) AS stripe_gifts,
           (SELECT COUNT(*)::int FROM receipts)                                AS receipts,
           (SELECT COUNT(*)::int FROM pledges)                                 AS pledges,
           (SELECT COUNT(*)::int FROM recurring_subscriptions)                 AS subs,
           (SELECT COUNT(*)::int FROM orgs)                                    AS orgs`);
  console.log("=== SCALE ===");
  console.log(`  orgs ${scale.orgs} · gifts ${scale.gifts} (${scale.stripe_gifts} with a Stripe PI) · receipts ${scale.receipts} · pledges ${scale.pledges} · recurring subs ${scale.subs}\n`);

  // ── BUCKET 1 — whole-dollar rows WITH a Stripe reference (RECOVERABLE) ────
  console.log("=== BUCKET 1 · truncation candidates WITH a Stripe charge reference (RECOVERABLE) ===");
  const [b1] = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS dollars
      FROM gifts
     WHERE stripe_payment_id IS NOT NULL AND amount = ROUND(amount)`);
  const [b1cents] = await q(`
    SELECT COUNT(*)::int AS n FROM gifts
     WHERE stripe_payment_id IS NOT NULL AND amount <> ROUND(amount)`);
  console.log(`  Stripe-sourced rows stored as a whole dollar: ${b1.n}  totalling ${money(b1.dollars)}`);
  console.log(`  Stripe-sourced rows still carrying cents (untouched by the edit path): ${b1cents.n}`);
  console.log(`  Max recoverable drift if EVERY candidate lost cents: ${money(b1.n * 0.99)} (upper bound, not a claim)`);
  console.log(`  → the true amount for each of these is readable from Stripe: PaymentIntent.amount_received.`);

  const b1sample = await q(`
    SELECT g.id, g.org_id, g.stripe_payment_id, g.amount::float AS amount, g.date, o.stripe_account_id
      FROM gifts g JOIN orgs o ON o.id = g.org_id
     WHERE g.stripe_payment_id IS NOT NULL AND g.amount = ROUND(g.amount)
       AND o.stripe_account_id IS NOT NULL
     ORDER BY g.date DESC LIMIT $1`, [SAMPLE]);
  console.log(`  sample available for the Stripe cross-check: ${b1sample.length} row(s)`);

  // ── BUCKET 2 — whole-dollar rows with NO Stripe reference (UNRECOVERABLE) ─
  console.log("\n=== BUCKET 2 · truncation candidates with NO Stripe reference (NOT RECOVERABLE) ===");
  const [b2] = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS dollars
      FROM gifts
     WHERE stripe_payment_id IS NULL AND amount = ROUND(amount)`);
  const [b2cents] = await q(`
    SELECT COUNT(*)::int AS n FROM gifts
     WHERE stripe_payment_id IS NULL AND amount <> ROUND(amount)`);
  console.log(`  manual / imported / event rows stored as a whole dollar: ${b2.n}  totalling ${money(b2.dollars)}`);
  console.log(`  rows from those paths carrying cents (so NOT written by a rounding path): ${b2cents.n}`);
  console.log(`  Max unrecoverable drift if EVERY candidate lost cents: ${money(b2.n * 0.99)} (upper bound)`);
  console.log(`  → the original cents exist nowhere: not in the row, not in an audit trail, not upstream.`);

  // Per-org / per-donor breakdown for bucket 2 — this is the list a human acts on.
  const b2byOrg = await q(`
    SELECT o.id AS org_id, o.name AS org_name, COUNT(*)::int AS rows,
           COALESCE(SUM(g.amount), 0)::float AS dollars
      FROM gifts g JOIN orgs o ON o.id = g.org_id
     WHERE g.stripe_payment_id IS NULL AND g.amount = ROUND(g.amount)
     GROUP BY o.id, o.name ORDER BY rows DESC LIMIT 50`);
  if (b2byOrg.length) {
    console.log("\n  by organization:");
    for (const r of b2byOrg) console.log(`    ${pad(r.rows, 7)} rows  ${pad(money(r.dollars), 16)}  ${r.org_name} (${r.org_id})`);
  }

  // ── BUCKET 3 — documents already in a donor's hands ──────────────────────
  console.log("\n=== BUCKET 3 · receipts / emails / PDFs issued against a truncation candidate ===");
  const [b3a] = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(r.amount), 0)::float AS dollars
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE g.amount = ROUND(g.amount)`);
  const [b3stripe] = await q(`
    SELECT COUNT(*)::int AS n FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE g.amount = ROUND(g.amount) AND g.stripe_payment_id IS NOT NULL`);
  // A receipt is a FROZEN snapshot by design (BUILD-64), so any later gift edit
  // or refund makes it disagree — correct behavior, not a cents bug. Losing
  // cents can never move a figure by a dollar or more, so the cents signature
  // is specifically a SUB-DOLLAR disagreement. BUILD-72 A-3 found this
  // distinction the hard way: without it a gift edited $80 → $280 fires the
  // decision rule.
  const [b3b] = await q(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(ABS(r.amount - g.amount)), 0)::float AS drift
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE r.amount <> g.amount AND ABS(r.amount - g.amount) < 1`);
  const [b3c] = await q(`
    SELECT COUNT(*)::int AS n FROM receipts r JOIN gifts g ON g.id = r.gift_id
     WHERE r.amount <> g.amount AND ABS(r.amount - g.amount) >= 1`);
  console.log(`  receipts issued against a whole-dollar gift: ${b3a.n} (${money(b3a.dollars)})`);
  console.log(`    of those, against a Stripe-sourced (recoverable) gift: ${b3stripe.n}`);
  console.log(`  receipts differing from their gift by LESS than $1 — the cents signature: ${b3b.n}  drift ${money(b3b.drift)}`);
  console.log(`  receipts differing by $1 or more (gift edited/refunded after issue — BY DESIGN): ${b3c.n}`);

  const b3donors = await q(`
    SELECT d.id AS donor_id, d.name, d.email, o.name AS org_name,
           COUNT(*)::int AS receipts, COALESCE(SUM(ABS(r.amount - g.amount)), 0)::float AS drift
      FROM receipts r JOIN gifts g ON g.id = r.gift_id
      JOIN donors d ON d.id = g.donor_id JOIN orgs o ON o.id = g.org_id
     WHERE r.amount <> g.amount AND ABS(r.amount - g.amount) < 1
     GROUP BY d.id, d.name, d.email, o.name ORDER BY drift DESC LIMIT 100`);
  if (b3donors.length) {
    console.log("\n  DONORS HOLDING A DOCUMENT THAT DISAGREES WITH THE LEDGER BY CENTS:");
    for (const r of b3donors) console.log(`    ${money(r.drift)}  ${r.receipts} receipt(s)  ${r.name} <${r.email || "no email"}>  · ${r.org_name}`);
  } else {
    console.log("  (no donor holds a receipt that disagrees with its gift by cents)");
  }

  // ── BUCKET 4 — pledges, pledge payments, recurring gift amounts ──────────
  console.log("\n=== BUCKET 4 · pledges, pledge payments, recurring gift amounts ===");
  const q4 = async (label, sql) => {
    const [r] = await q(sql);
    console.log(`  ${label.padEnd(26)} total ${pad(r.total, 6)} · whole-dollar ${pad(r.whole, 6)} · carrying cents ${pad(r.cents, 6)} · whole-dollar sum ${money(r.dollars)}`);
    return r;
  };
  const p4a = await q4("pledges", `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int  AS whole,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS cents,
           COALESCE(SUM(amount) FILTER (WHERE amount = ROUND(amount)), 0)::float AS dollars
      FROM pledges`);
  const p4b = await q4("pledge payments", `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int  AS whole,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS cents,
           COALESCE(SUM(amount) FILTER (WHERE amount = ROUND(amount)), 0)::float AS dollars
      FROM gifts WHERE pledge_id IS NOT NULL`);
  const p4c = await q4("recurring subscriptions", `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE amount = ROUND(amount))::int  AS whole,
           COUNT(*) FILTER (WHERE amount <> ROUND(amount))::int AS cents,
           COALESCE(SUM(amount) FILTER (WHERE amount = ROUND(amount)), 0)::float AS dollars
      FROM recurring_subscriptions WHERE amount IS NOT NULL`);
  // Pledges and recurring subs are never written by the Stripe webhook's
  // amount path, so they have no per-row recoverable source. Recurring subs DO
  // carry a stripe_subscription_id; the true amount is on the Stripe Price, but
  // the stored `amount` is a display/health figure, not a money ledger row.
  const [p4d] = await q(`
    SELECT COUNT(*)::int AS n FROM recurring_subscriptions
     WHERE amount IS NOT NULL AND amount = ROUND(amount) AND stripe_subscription_id IS NOT NULL`);
  console.log(`  recurring subs that are whole-dollar AND carry a Stripe subscription id: ${p4d.n}`);

  // ── The Stripe cross-check — the only thing that turns a candidate into a
  //    proven loss. Read-only against the Stripe API.
  let proven = null;
  if (WANT_STRIPE) {
    console.log("\n=== STRIPE CROSS-CHECK · bucket 1 sample ===");
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.log("  SKIPPED: STRIPE_SECRET_KEY not present in this environment.");
    } else if (!b1sample.length) {
      console.log("  SKIPPED: bucket 1 is empty — nothing to cross-check.");
    } else {
      const Stripe = require("stripe");
      const stripe = new Stripe(key);
      let checked = 0, drifted = 0, matched = 0, failed = 0, driftDollars = 0;
      const rows = [];
      for (const g of b1sample) {
        checked++;
        try {
          const pi = await stripe.paymentIntents.retrieve(g.stripe_payment_id, {}, { stripeAccount: g.stripe_account_id });
          const trueCents = pi.amount_received != null ? pi.amount_received : pi.amount;
          const storedCents = Math.round(g.amount * 100);
          if (trueCents === storedCents) { matched++; continue; }
          drifted++;
          const delta = (trueCents - storedCents) / 100;
          driftDollars += delta;
          rows.push({ giftId: g.id, orgId: g.org_id, pi: g.stripe_payment_id, stored: g.amount, trueAmount: trueCents / 100, delta });
        } catch (e) {
          failed++;
          console.log(`    [unreadable] gift ${g.id} pi ${g.stripe_payment_id}: ${e.message}`);
        }
      }
      console.log(`  sampled ${checked} · matched ${matched} · DRIFTED ${drifted} · unreadable ${failed}`);
      if (rows.length) {
        console.log(`  net drift across the sample: ${money(driftDollars)}`);
        for (const r of rows) console.log(`    gift ${r.giftId}  stored ${money(r.stored)}  Stripe ${money(r.trueAmount)}  delta ${money(r.delta)}  (${r.pi})`);
      } else if (!failed) {
        console.log(`  every sampled row's stored amount equals Stripe's amount_received — no drift in this sample.`);
      }
      proven = { checked, matched, drifted, failed, driftDollars };
    }
  } else {
    console.log("\n=== STRIPE CROSS-CHECK · not requested (pass --stripe) ===");
  }

  // ── The verdict ──────────────────────────────────────────────────────────
  console.log("\n=== THE DECISION INPUT ===");
  console.log(`  Bucket 1 (recoverable candidates):   ${b1.n}`);
  console.log(`  Bucket 2 (unrecoverable candidates): ${b2.n}`);
  console.log(`  Bucket 3 (cents-signature receipts): ${b3b.n}`);
  console.log(`  Bucket 4 whole-dollar: pledges ${p4a.whole} · pledge payments ${p4b.whole} · recurring ${p4c.whole}`);
  if (proven) console.log(`  Stripe-PROVEN drift in the bucket-1 sample: ${proven.drifted} row(s), ${money(proven.driftDollars)}`);
  const anyNonZero = b1.n || b2.n || b3b.n || p4a.whole || p4b.whole || p4c.whole;
  console.log(`  → ${anyNonZero
    ? "NON-ZERO somewhere: Part 2 (cents end to end) happens now, before Parts 3 and 4."
    : "ALL ZERO: fix the write paths in Part 2 so it cannot start; no migration needed."}`);

  await client.query("ROLLBACK");
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
