// BUILD-58 Part 3 — boundary drills against REAL Stripe test mode.
// LOOPBACK ONLY: drives the scratch server on :5621 (never prod) with the
// authed Stripe CLI's test key; `stripe listen --forward-connect-to
// 127.0.0.1:5621/stripe/webhook` must be running (real signed webhooks).
//
// Drills (each answers the boundary audit's three questions — see
// docs/build58/boundaries/DIFFERENCES.md):
//   A. Connect onboarding states: a half-onboarded account (link created,
//      KYC never finished) has charges_enabled=false — the W-1 approval gate
//      must refuse it against REAL Stripe, and pass once test-KYC enables it.
//   B. Full refund: charge.refunded (real event) reverses the gift + ledger.
//   C. DISPUTE: a real dispute-triggering test payment — observe exactly what
//      Steward does with charge.dispute.created (expected: nothing — the
//      finding), and RECORD the real payloads into tests/fixtures/external/.
//   D. Payouts/balance: /finance/stripe-summary against a real enabled
//      account and a real restricted (bare) account.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_… node scripts/build58-stripe-drill.js
const BASE = process.env.BASE || "http://localhost:5621";
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error("loopback only"); process.exit(1); }
const SK = process.env.STRIPE_SECRET_KEY || "";
if (!/^sk_test_/.test(SK)) { console.error("needs a sk_test_ key in STRIPE_SECRET_KEY"); process.exit(1); }
const Stripe = require("stripe");
const stripe = new Stripe(SK);
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://steward@localhost:5544/steward_loadtest", ssl: false });
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, JSON.stringify(extra ?? "").slice(0, 300)); } };
const uniq = () => Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function waitFor(fn, tries = 40, ms = 500) { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(ms); } return false; }

(async () => {
  console.log("BUILD-58 real-Stripe boundary drill\n");

  // ── fixture: a network org + a super admin (documented SQL pattern) ──────
  const ein = String(910000000 + Math.floor(Math.random() * 89999999));
  await q(`INSERT INTO ein_registry (ein,name,status) VALUES ($1,'DRILL ORG B58','ok') ON CONFLICT (ein) DO UPDATE SET status='ok'`, [ein]);
  const orgEmail = `b58drill-${uniq()}@test.local`;
  const reg = await api("POST", "/network/signup", null, { orgName: "Drill Org B58", ein, email: orgEmail, password: "loadtest1234", website: "https://example.org", consent: true });
  const orgId = reg.body.org.id, orgTok = reg.body.token, appId = reg.body.application.id;
  const superEmail = `b58super-${uniq()}@test.local`;
  const sreg = await api("POST", "/auth/register-org", null, { orgName: "Drill Ops", userName: "Ops", email: superEmail, password: "loadtest1234" });
  await q(`UPDATE users SET is_super_admin=true WHERE email=$1`, [superEmail]);
  const superTok = (await api("POST", "/auth/login", null, { email: superEmail, password: "loadtest1234" })).body.token;

  // ── A. Connect onboarding states ─────────────────────────────────────────
  console.log("§A Connect onboarding — the gate against REAL charges_enabled");
  const bare = await stripe.accounts.create({
    type: "custom", country: "US", email: orgEmail,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  });
  ok("a bare (link-created, never-onboarded) account has charges_enabled=false", bare.charges_enabled === false, bare.charges_enabled);
  await q(`UPDATE orgs SET stripe_account_id=$1, stripe_connected=true WHERE id=$2`, [bare.id, orgId]);

  const refuse = await api("POST", `/admin/network/applications/${appId}/decide`, superTok, { action: "approve" });
  ok("W-1: approval REFUSED for the half-onboarded account (real Stripe says no)",
    refuse.status === 400 && refuse.body.error === "gate_unmet" && refuse.body.gate.stripe === false, refuse.body);
  ok("the refusal names the reason (charges_disabled)", refuse.body?.gate?.stripeReason === "charges_disabled", refuse.body?.gate);

  const appStatus = await api("GET", "/network/application", orgTok);
  ok("org's own checklist shows chargesEnabled=false (truth, not our flag)", appStatus.body?.chargesEnabled === false, appStatus.body);

  // Complete test-mode KYC (the BUILD-57 recipe) → charges enable in seconds.
  await stripe.accounts.update(bare.id, {
    business_type: "individual",
    individual: {
      first_name: "Drill", last_name: "Operator", email: orgEmail,
      phone: "0000000000", id_number: "000000000", ssn_last_4: "0000", dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "address_full_match", city: "Mobile", state: "AL", postal_code: "36602", country: "US" },
    },
    business_profile: { mcc: "8398", product_description: "Drill org", url: "https://accessible.stripe.com" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
    external_account: "btok_us_verified",
  });
  const enabled = await waitFor(async () => (await stripe.accounts.retrieve(bare.id)).charges_enabled === true, 60, 2000);
  if (!enabled) { const a = await stripe.accounts.retrieve(bare.id); console.log("  still pending:", JSON.stringify(a.requirements.pending_verification), "currently_due:", JSON.stringify(a.requirements.currently_due)); }
  ok("test-KYC completes onboarding (charges_enabled flips true)", enabled, null);

  const approve = await api("POST", `/admin/network/applications/${appId}/decide`, superTok, { action: "approve" });
  ok("approval passes once Stripe actually enables charges", approve.status === 200 && approve.body.status === "approved", approve.body);

  // Receipts config so the gift path is fully real.
  await q(`UPDATE orgs SET receipts_enabled=true, legal_name='Drill Org B58, Inc.', ein_display, receipt_address='1 Drill Way, Mobile, AL' WHERE id=$1`, [orgId]).catch(() => {});
  await q(`UPDATE orgs SET receipts_enabled=true, legal_name='Drill Org B58, Inc.', receipt_address='1 Drill Way, Mobile, AL' WHERE id=$1`, [orgId]);

  // ── B. one-time gift + FULL REFUND (real charge.refunded) ────────────────
  console.log("\n§B refund — the real event reverses gift + ledger");
  const donorEmail = `wren-drill-${uniq()}@test.local`;
  const pi1 = await stripe.paymentIntents.create({
    amount: 4200, currency: "usd", confirm: true, payment_method: "pm_card_visa",
    receipt_email: donorEmail, metadata: { donor_name: "Wren Drill" },
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  }, { stripeAccount: bare.id });
  ok("real $42 charge succeeded on the connected account", pi1.status === "succeeded", pi1.status);
  const giftArrived = await waitFor(async () => (await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [orgId, pi1.id])).length === 1);
  ok("webhook recorded the gift", giftArrived, null);
  const [gift1] = await q(`SELECT id, amount FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [orgId, pi1.id]);
  const stamps1 = await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gift1?.id || "none"]);
  ok("gift stamped the ledger exactly once (W-3 holds on the real path)", stamps1.length === 1, stamps1.length);

  await stripe.refunds.create({ payment_intent: pi1.id }, { stripeAccount: bare.id });
  const reversed = await waitFor(async () => (await q(`SELECT id FROM gifts WHERE id=$1`, [gift1.id])).length === 0);
  ok("charge.refunded reversed the gift row", reversed, null);
  const stampsAfter = await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gift1.id]);
  ok("…and its ledger stamp", stampsAfter.length === 0, stampsAfter.length);

  // ── C. DISPUTE — never handled anywhere; observe and record ──────────────
  console.log("\n§C dispute — what does Steward actually do?");
  const pi2 = await stripe.paymentIntents.create({
    amount: 9500, currency: "usd", confirm: true, payment_method: "pm_card_createDispute",
    receipt_email: donorEmail, metadata: { donor_name: "Wren Drill" },
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  }, { stripeAccount: bare.id });
  ok("dispute-card charge succeeded", pi2.status === "succeeded", pi2.status);
  const gift2Arrived = await waitFor(async () => (await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [orgId, pi2.id])).length === 1);
  ok("the disputed gift was recorded first (webhook)", gift2Arrived, null);

  // Wait for the dispute to exist at Stripe, then give the webhook time.
  const disputes = [];
  await waitFor(async () => {
    const d = await stripe.disputes.list({ limit: 5 }, { stripeAccount: bare.id });
    disputes.length = 0; disputes.push(...d.data.filter(x => x.payment_intent === pi2.id));
    return disputes.length > 0;
  }, 30, 1000);
  ok("a REAL dispute exists at Stripe for the charge", disputes.length === 1, disputes.length);
  await sleep(4000); // let any charge.dispute.* webhook land

  // BUILD-58 fix (was the finding): on dispute.created the gift is FLAGGED
  // (money is only held — not reversed) AND staff are alerted LOUDLY.
  const flagged = await waitFor(async () => (await q(`SELECT disputed_at FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [orgId, pi2.id]))[0]?.disputed_at != null, 20, 500);
  ok("dispute.created FLAGS the gift (disputed_at set) — not silent", flagged, null);
  const [gift2] = await q(`SELECT id, amount, dispute_status FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [orgId, pi2.id]);
  ok("the disputed gift is NOT reversed (money only held, org may win)", !!gift2, { gift2: !!gift2 });
  const stamps2 = await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gift2?.id || "none"]);
  ok("its ledger stamp survives while the dispute is open", stamps2.length === 1, stamps2.length);
  const tasks = await q(`SELECT title FROM tasks WHERE org_id=$1 AND title ILIKE '%disput%'`, [orgId]);
  ok("a LOUD staff task now exists for the dispute (with a respond-by deadline)", tasks.length >= 1, tasks.map(t => t.title));

  // Record the REAL dispute event payload as a provenance-stamped fixture.
  const evList = await stripe.events.list({ types: ["charge.dispute.created"], limit: 3 }, { stripeAccount: bare.id });
  const dEvt = evList.data.find(e => e.data?.object?.payment_intent === pi2.id) || evList.data[0];
  ok("charge.dispute.created event retrieved from Stripe", !!dEvt, null);
  if (dEvt) {
    const outDir = path.join(__dirname, "..", "tests", "fixtures", "external");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stripe-charge.dispute.created.json"), JSON.stringify({
      _provenance: {
        service: "stripe", mode: "test", recordedAt: new Date().toISOString(),
        apiVersion: dEvt.api_version, drill: "scripts/build58-stripe-drill.js §C",
        note: "REAL charge.dispute.created from a pm_card_createDispute charge on a real test connected account. Hand-editing the payload voids its provenance — re-record instead.",
      },
      event: dEvt,
    }, null, 2));
    console.log("  recorded tests/fixtures/external/stripe-charge.dispute.created.json (api_version " + dEvt.api_version + ")");
  }

  // ── D. balance/payouts surface against real account states ───────────────
  console.log("\n§D /finance/stripe-summary against real account states");
  const sum1 = await api("GET", "/finance/stripe-summary", orgTok);
  ok("enabled account: summary answers 200 with a balance object", sum1.status === 200 && sum1.body && (sum1.body.connected === true ? !!sum1.body.balance : true), sum1.body);
  const bare2 = await stripe.accounts.create({ type: "custom", country: "US", email: `r-${uniq()}@test.local`, capabilities: { card_payments: { requested: true }, transfers: { requested: true } } });
  await q(`UPDATE orgs SET stripe_account_id=$1 WHERE id=$2`, [bare2.id, orgId]);
  const sum2 = await api("GET", "/finance/stripe-summary", orgTok);
  ok("restricted/bare account: summary degrades gracefully (200, never a 500)", sum2.status === 200, sum2.status);
  await q(`UPDATE orgs SET stripe_account_id=$1 WHERE id=$2`, [bare.id, orgId]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
