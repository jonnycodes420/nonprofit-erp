#!/usr/bin/env node
// FIX-3 C, finding 8 — IS THERE A REAL PERSON IN THE DEMO?  READ-ONLY.
//
// The walk found "Jonathan Atkinson $1" in the Harborlight demo's thank-you
// list on prod. This prints every row in the demo org that is a real person by
// the rule in scripts/lib/demoRealPeople.js (the founder's identity, the mail
// block, any users row on the instance, a Stripe charge the seed did not
// mint), with the gifts behind each one (amount, date, Stripe id, who wrote
// it, when) so the source of the row is on the screen, and whether the demo
// org is connected to a real Stripe account (the door a real charge came in
// by). It changes nothing: one READ ONLY transaction, SELECTs, ROLLBACK.
//
// Exit 0: clean. Exit 1: offending rows printed. Exit 2: could not check.
//
// Usage (prod, read-only but always an explicit act):
//   DATABASE_URL='postgres://…prod…' node scripts/demo-real-people-check.js --i-know-this-is-prod
// Local:
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_<tag> node scripts/demo-real-people-check.js
// DEMO_ORG overrides the org (the suite points it at its own fixture org);
// DEMO_SEEDED_USERS (comma-separated) overrides the users the seed creates.

const { Client } = require("pg");
const { assertServerIdentity } = require("./lib/prodGuard");
const { findRealPeople } = require("./lib/demoRealPeople");
const demo = require("./seed-demo");

const CONFIRM = "--i-know-this-is-prod";
const HEALTH = process.env.HEALTH_URL || "https://nonprofit-erp-production.up.railway.app";
const url = process.env.DATABASE_URL || "";
const ORG = process.env.DEMO_ORG || demo.ORG;
const SEEDED = process.env.DEMO_SEEDED_USERS ? process.env.DEMO_SEEDED_USERS.split(",").map(s => s.trim()).filter(Boolean) : demo.SEEDED_USER_EMAILS;

if (!url) { console.error("Set DATABASE_URL. This script only ever READS."); process.exit(2); }
const isLoopback = /localhost|127\.0\.0\.1/.test(url);
if (!isLoopback && !process.argv.includes(CONFIRM)) {
  console.error(`\nREFUSED: DATABASE_URL is remote. Add ${CONFIRM}.\n(Read-only, but a remote target is always an explicit act.)\n`);
  process.exit(2);
}
let expectedDb = null;
if (!isLoopback) {
  const h = assertServerIdentity(HEALTH);
  expectedDb = h.database;
  console.log(`[identity] ${HEALTH} → product=${h.product} database=${h.database} sha=${(h.buildSha || "").slice(0, 7)}`);
}

(async () => {
  const client = new Client({ connectionString: url, ssl: isLoopback ? false : { rejectUnauthorized: false } });
  await client.connect();
  const [{ current_database: dbName }] = (await client.query("SELECT current_database()")).rows;
  if (expectedDb && dbName !== expectedDb) {
    console.error(`\nREFUSED: connected to database "${dbName}" but /health reports "${expectedDb}".\n`);
    await client.end(); process.exit(2);
  }
  // This session cannot write even if a query were wrong.
  await client.query("BEGIN READ ONLY");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;

  const [org] = await q(`SELECT id, name, is_demo_org, emails_enabled, (stripe_account_id IS NOT NULL) AS stripe_connected
                           FROM orgs WHERE id=$1`, [ORG]);
  console.log(`[demo] database ${dbName} · org ${ORG}` + (org
    ? ` "${org.name}" · is_demo_org=${org.is_demo_org} · emails_enabled=${org.emails_enabled} · Stripe account connected=${org.stripe_connected}`
    : " — NOT PRESENT"));
  if (org && org.stripe_connected)
    console.log("[demo] WARNING: the demo org is connected to a Stripe account, so its give page can take real money. Re-running scripts/seed-demo.js recreates it unconnected.");

  const found = await findRealPeople(q, ORG, { seededUserEmails: SEEDED });
  const [online] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float amt,
                                   COUNT(*) FILTER (WHERE stripe_payment_id NOT LIKE 'pi\\_demo\\_%')::int real_n
                              FROM gifts WHERE org_id=$1 AND stripe_payment_id IS NOT NULL`, [ORG]);
  console.log(`[demo] online gifts (the report's rule, a Stripe payment id): ${online.n}, $${online.amt.toLocaleString()} — ${online.real_n} not minted by the seed`);

  if (!found.length) {
    console.log(`\nOK — no real person in ${ORG}.`);
    await client.query("ROLLBACK"); await client.end(); process.exit(0);
  }
  console.log(`\nFOUND ${found.length} row(s) in ${ORG} that are real people:\n`);
  for (const r of found) {
    console.log(`  ${r.table} ${r.id}  ${r.name || "(no name)"} <${r.email || "no email"}>  — ${r.reason}`);
    if (r.table !== "donors") continue;
    const gifts = await q(
      `SELECT id, amount::float amount, date, stripe_payment_id, payment_method, recurring_subscription_id, created_by, created_at
         FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY date, id`, [ORG, r.id]);
    for (const g of gifts)
      console.log(`      gift ${g.id}  $${g.amount}  ${g.date}  ${g.stripe_payment_id || "no Stripe id"}  ${g.payment_method || ""}` +
                  `${g.recurring_subscription_id ? "  sub " + g.recurring_subscription_id : ""}  by ${g.created_by || "?"} at ${g.created_at ? new Date(g.created_at).toISOString() : "?"}`);
    const [ty] = await q(`SELECT COUNT(*)::int n FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2 AND sent_at IS NULL AND skipped_at IS NULL`, [ORG, r.id]);
    if (ty && ty.n) console.log(`      ${ty.n} open thank-you draft(s) — this is what Home's thank-you list shows`);
  }
  console.log(`\nTo remove them: re-run scripts/seed-demo.js (it removes these rows first and prints each one, then rebuilds the demo).`);
  await client.query("ROLLBACK"); await client.end();
  process.exit(1);
})().catch(e => { console.error("CHECK ERROR:", e.message); process.exit(2); });
