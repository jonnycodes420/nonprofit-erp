// BUILD-24 — platform billing cutover (Core $149 / Team $299 subscriptions).
// Local scratch server + Postgres (tests/README.md recipe). Boot the server with
// a known billing webhook secret (falls back to STRIPE_WEBHOOK_SECRET):
//   … STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest node server.js
//
// Drives the PLATFORM subscription lifecycle via locally-signed /billing/webhook
// events (no real Stripe needed — the tier logic lives in the webhook handler).
// Covers: checkout → tier set (core/team); subscription.updated/deleted →
// downgrade + Team re-lock; invoice failed/succeeded; event-id idempotency
// (redelivery no-ops); org-scoping; donation-event separation (payment_intent is
// ignored, never reserved); create-checkout plan validation + founding-partner
// super-admin gating.

const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const A = "org_bill_a", B = "org_bill_b", S = "org_bill_s";
const BASE = process.env.BASE || "http://localhost:5601";

async function reset() {
  for (const org of [A, B, S]) {
    await q(`DELETE FROM billing_webhook_events WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  await q(`DELETE FROM billing_webhook_events WHERE event_id LIKE 'evt_bill_%'`).catch(() => {});
}
async function seedOrg(o, plan, status, customer) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_customer_id) VALUES ($1,$2,$3,1,$4,$5,$6)`,
    [o, `Bill ${o}`, `bill-${o}`, status, plan, customer]);
}
async function seedUser(o, id, email, role = "admin", superAdmin = false) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, o, email, hash, `User ${id}`, role, superAdmin]);
}
async function orgRow(id) { return (await q(`SELECT plan,subscription_status,grace_until,stripe_subscription_id FROM orgs WHERE id=$1`, [id]))[0]; }
async function evtCount(evtId) { return Number((await q(`SELECT COUNT(*) c FROM billing_webhook_events WHERE event_id=$1`, [evtId]))[0].c); }

// Fire a signed platform-billing webhook event.
async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(BASE + "/billing/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const future = ts => ts && new Date(ts).getTime() > Date.now();

(async () => {
  await reset();
  await seedOrg(A, "seed", "active", "cus_bill_a");
  await seedUser(A, "u_bill_a", "a-admin@bill.local");
  await seedOrg(B, "seed", "active", "cus_bill_b");
  await seedUser(B, "u_bill_b", "b-admin@bill.local");
  await seedOrg(S, "seed", "active", "cus_bill_s");
  await seedUser(S, "u_bill_s_admin", "s-admin@bill.local", "admin", false);
  await seedUser(S, "u_bill_s_super", "s-super@bill.local", "admin", true);

  const aAdmin = await login("a-admin@bill.local");

  // ── checkout → Team tier ──────────────────────────────────────────────
  let r = await fireBilling("evt_bill_1", "checkout.session.completed",
    { metadata: { orgId: A, plan: "team" }, subscription: null, customer: "cus_bill_a" });
  let a = await orgRow(A);
  ok("checkout team → 200", r.status === 200, r);
  ok("checkout team → plan=team", a.plan === "team", a);
  ok("checkout team → status=active", a.subscription_status === "active", a);
  ok("checkout team → one dedup row", await evtCount("evt_bill_1") === 1);

  // Team tier is live via the API (this is what unlocks LockedFeature previews).
  let st = await api("GET", "/billing/status", aAdmin);
  ok("billing/status planTier=team after Team checkout", st.body.planTier === "team", st.body);

  // ── idempotency: redeliver SAME event id (different plan) → no-op ─────────
  r = await fireBilling("evt_bill_1", "checkout.session.completed",
    { metadata: { orgId: A, plan: "core" }, subscription: null, customer: "cus_bill_a" });
  a = await orgRow(A);
  ok("redelivered event → duplicate:true", r.body.duplicate === true, r.body);
  ok("redelivered event → plan STILL team (no-op)", a.plan === "team", a);
  ok("redelivered event → still one dedup row", await evtCount("evt_bill_1") === 1);

  // ── subscription.updated canceled → downgrade to core + Team re-locks ────
  r = await fireBilling("evt_bill_2", "customer.subscription.updated",
    { metadata: { orgId: A }, status: "canceled", customer: "cus_bill_a", current_period_end: null });
  a = await orgRow(A);
  ok("sub.updated canceled → plan=core (re-lock)", a.plan === "core", a);
  ok("sub.updated canceled → status=canceled", a.subscription_status === "canceled", a);
  ok("sub.updated canceled → grace set", future(a.grace_until), a);
  st = await api("GET", "/billing/status", aAdmin);
  ok("billing/status planTier=core after cancel (Team re-locked)", st.body.planTier === "core", st.body);

  // ── reactivate: checkout core → core tier active ─────────────────────────
  r = await fireBilling("evt_bill_3", "checkout.session.completed",
    { metadata: { orgId: A, plan: "core" }, subscription: null, customer: "cus_bill_a" });
  a = await orgRow(A);
  ok("checkout core → plan=core", a.plan === "core", a);
  ok("checkout core → status=active + grace cleared", a.subscription_status === "active" && !a.grace_until, a);

  // ── invoice.payment_failed → past_due + grace ────────────────────────────
  r = await fireBilling("evt_bill_4", "invoice.payment_failed", { customer: "cus_bill_a" });
  a = await orgRow(A);
  ok("invoice failed → past_due", a.subscription_status === "past_due", a);
  ok("invoice failed → grace set", future(a.grace_until), a);

  // ── invoice.payment_succeeded → active again ─────────────────────────────
  r = await fireBilling("evt_bill_5", "invoice.payment_succeeded", { customer: "cus_bill_a" });
  a = await orgRow(A);
  ok("invoice succeeded → active", a.subscription_status === "active", a);
  ok("invoice succeeded → grace cleared", !a.grace_until, a);

  // ── subscription.deleted → downgrade + re-lock + grace ───────────────────
  r = await fireBilling("evt_bill_6", "customer.subscription.deleted", { metadata: { orgId: A }, customer: "cus_bill_a" });
  a = await orgRow(A);
  ok("sub.deleted → plan=core (re-lock)", a.plan === "core", a);
  ok("sub.deleted → status=canceled + grace", a.subscription_status === "canceled" && future(a.grace_until), a);

  // ── org-scoping: an event for A never touches B ──────────────────────────
  let b = await orgRow(B);
  ok("org B untouched by A's lifecycle", b.plan === "seed" && b.subscription_status === "active", b);
  r = await fireBilling("evt_bill_7", "checkout.session.completed",
    { metadata: { orgId: A, plan: "team" }, subscription: null, customer: "cus_bill_a" });
  b = await orgRow(B);
  ok("event targeting A leaves B alone", b.plan === "seed" && b.subscription_status === "active", b);

  // ── donation-event separation: payment_intent is IGNORED, never reserved ─
  r = await fireBilling("evt_bill_pi", "payment_intent.succeeded",
    { id: "pi_x", amount_received: 5000, customer: "cus_bill_b", metadata: { orgId: B } });
  b = await orgRow(B);
  ok("payment_intent on /billing/webhook → ignored", r.body.ignored === "payment_intent.succeeded", r.body);
  ok("payment_intent → B plan unchanged (donation flow separate)", b.plan === "seed", b);
  ok("payment_intent → NOT reserved in billing_webhook_events", await evtCount("evt_bill_pi") === 0);

  // ── create-checkout: plan validation + founding super-admin gating ───────
  const sAdmin = await login("s-admin@bill.local");
  const sSuper = await login("s-super@bill.local");

  r = await api("POST", "/billing/create-checkout", sAdmin, { plan: "nonsense" });
  ok("create-checkout bad plan → 400", r.status === 400, r);

  r = await api("POST", "/billing/create-checkout", sAdmin, { plan: "founding" });
  ok("create-checkout founding as normal admin → 403 founding_forbidden", r.status === 403 && r.body.error === "founding_forbidden", r);

  // Super admin passes the founding gate; with no STRIPE_PRICE_FOUNDING set it
  // stops at the price-config check (proving it got PAST the gate, not blocked).
  r = await api("POST", "/billing/create-checkout", sSuper, { plan: "founding" });
  ok("create-checkout founding as super admin → past gate (plan_not_configured, not 403)",
    r.status === 400 && r.body.error === "plan_not_configured", r);

  // Core with no price configured → clean plan_not_configured (never a 500).
  r = await api("POST", "/billing/create-checkout", sAdmin, { plan: "core" });
  ok("create-checkout core, no price env → plan_not_configured (not 500)",
    r.status === 400 && r.body.error === "plan_not_configured", r);

  // ── Stripe key separation (FIX): platform billing gets its own key ─────────
  // Pure resolver used by server.js for `stripe` (donations) vs `billingStripe`
  // (platform subscription). Asserted directly so it needs no live Stripe.
  const { donationStripeKey, billingStripeKey } = require("../stripeKeys");
  const LIVE = "sk_live_donation", TEST = "sk_test_billing";

  // Billing uses its OWN key when set…
  ok("billing key: uses STRIPE_BILLING_SECRET_KEY when set",
    billingStripeKey({ STRIPE_BILLING_SECRET_KEY: TEST, STRIPE_SECRET_KEY: LIVE }) === TEST);
  // …and falls back to the donation key when its own is unset.
  ok("billing key: falls back to STRIPE_SECRET_KEY when its own is unset",
    billingStripeKey({ STRIPE_SECRET_KEY: LIVE }) === LIVE);
  ok("billing key: null when neither is set",
    billingStripeKey({}) === null);

  // Donations ALWAYS use STRIPE_SECRET_KEY — never the billing key. No cross-wiring:
  // even with a test billing key present, donation stays on the live donation key.
  ok("donation key: always STRIPE_SECRET_KEY, ignores billing key (no cross-wire)",
    donationStripeKey({ STRIPE_BILLING_SECRET_KEY: TEST, STRIPE_SECRET_KEY: LIVE }) === LIVE);
  ok("donation key: unaffected by billing key alone",
    donationStripeKey({ STRIPE_BILLING_SECRET_KEY: TEST }) === null);
  // The whole point of the fix: a separate test billing key does NOT change the
  // live donation key — the two resolve independently.
  ok("key separation: billing test key + live donation key resolve to different clients",
    billingStripeKey({ STRIPE_BILLING_SECRET_KEY: TEST, STRIPE_SECRET_KEY: LIVE })
      !== donationStripeKey({ STRIPE_BILLING_SECRET_KEY: TEST, STRIPE_SECRET_KEY: LIVE }));

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
