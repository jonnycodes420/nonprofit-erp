#!/usr/bin/env node
// BUILD-88a A.1 — DE-DUPLICATE AN ORG'S GIFTS. Dry run by default.
//
// Why this exists: before A.1 there were five places that wrote a gift row, and
// two of them could write the same gift twice. The event-attendee path used
// `ON CONFLICT DO NOTHING` with NO conflict target, so every re-save of an
// attended row minted another gift and bumped the donor's lifetime total again;
// a hand-logged gift saved twice before the idempotency key existed did the
// same. Both are closed in the code now. This is for the rows already on file.
//
// WHAT COUNTS AS A DUPLICATE, and nothing else: same org, same donor, same
// date, same amount to the cent, AND neither row carries a source key that says
// they are distinct events (no external_id, no stripe_payment_id, no
// idempotency_key that differs, no pledge_id that differs). Forty $100 Sunday
// gifts in an import are forty gifts — they carry external ids, and this never
// touches them. The EARLIEST row survives; the later one is deleted with its
// ledger stamp and its timeline entry, and the donor's rollup is recomputed
// from the gifts that remain.
//
//   node scripts/build88a-dedupe-gifts.js --org org_creo            # dry run
//   node scripts/build88a-dedupe-gifts.js --org org_creo --apply    # do it
//
// A dry run prints exactly what an --apply would delete. Run it first, read it,
// and only then apply: a deleted gift is money off a donor's record.

const { query, run } = require("../db");

const args = process.argv.slice(2);
const orgId = (args[args.indexOf("--org") + 1] || "").trim();
const APPLY = args.includes("--apply");
if (!orgId || orgId.startsWith("--")) {
  console.error("Usage: node scripts/build88a-dedupe-gifts.js --org <orgId> [--apply]");
  process.exit(1);
}

(async () => {
  const groups = await query(
    `SELECT donor_id, date, round(amount::numeric,2) AS amt,
            array_agg(id ORDER BY created_at NULLS FIRST, id) AS ids,
            COUNT(*)::int AS n
       FROM gifts
      WHERE org_id = ?
        AND COALESCE(external_id,'') = ''
        AND COALESCE(stripe_payment_id,'') = ''
        AND COALESCE(idempotency_key,'') = ''
        AND pledge_id IS NULL
      GROUP BY donor_id, date, round(amount::numeric,2)
     HAVING COUNT(*) > 1`,
    [orgId]);

  if (!groups.length) { console.log(`No unkeyed duplicate gifts in ${orgId}. Nothing to do.`); process.exit(0); }

  let toDelete = [];
  console.log(`${APPLY ? "DELETING" : "DRY RUN — would delete"} in ${orgId}:\n`);
  for (const g of groups) {
    const [donor] = await query("SELECT name FROM donors WHERE id=?", [g.donor_id]);
    const losers = g.ids.slice(1);
    toDelete.push(...losers);
    console.log(`  ${donor?.name || g.donor_id} · ${g.date} · $${Number(g.amt).toLocaleString()} — ${g.n} rows, keeping ${g.ids[0]}, dropping ${losers.join(", ")}`);
  }
  console.log(`\n${toDelete.length} gift row${toDelete.length === 1 ? "" : "s"} across ${groups.length} donor-date-amount group${groups.length === 1 ? "" : "s"}.`);

  if (!APPLY) { console.log("\nDry run. Re-run with --apply to delete."); process.exit(0); }

  await run("DELETE FROM fin_transactions WHERE org_id = ? AND gift_id = ANY(?)", [orgId, toDelete]);
  await run("DELETE FROM interactions WHERE org_id = ? AND gift_id = ANY(?)", [orgId, toDelete]);
  await run("DELETE FROM gifts WHERE org_id = ? AND id = ANY(?)", [orgId, toDelete]);
  // The rollup is RECOMPUTED from the gifts that remain, never decremented —
  // a decrement carries every earlier arithmetic error forward.
  const donorIds = [...new Set(groups.map(g => g.donor_id))];
  await run(
    `UPDATE donors d SET
        total_giving = COALESCE(s.total,0), gift_count = COALESCE(s.n,0),
        last_gift_amount = COALESCE(s.last_amt,0), last_gift_date = s.last_date,
        updated_at = NOW()
      FROM (SELECT g.donor_id,
                   SUM(g.amount) AS total, COUNT(*)::int AS n,
                   MAX(g.date) AS last_date,
                   (ARRAY_AGG(g.amount ORDER BY g.date DESC, g.id DESC))[1] AS last_amt
              FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?) GROUP BY g.donor_id) s
     WHERE d.id = s.donor_id AND d.org_id = ?`,
    [orgId, donorIds, orgId]);
  console.log(`Done. ${toDelete.length} rows deleted; ${donorIds.length} donor totals recomputed from what remains.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
