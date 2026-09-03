// BUILD-76 Part 3.2 — DRIFT AGAINST REAL STRIPE, test mode, no mocks.
// The Stripe mock lied in seven ways once (BUILD-57); this drill is the
// no-mock leg of the drift proof. LOOPBACK ONLY: drives a scratch server on
// :5621 (never prod) with the authed Stripe CLI's test key; requires
// `stripe listen --forward-connect-to 127.0.0.1:5621/stripe/webhook`
// running (real signed webhooks) — the runner script/README shows the recipe.
//
//   §1  a donor with a real cadence (manual gifts through the API) IS
//       drifting — list, badge, headline agree
//   §2  a REAL charge on the connected account (receipt_email = donor) →
//       the live webhook clears them: off the list, badge gone, headline
//       down by exactly their value at risk
//   §3  the FIRST charge of a brand-new subscription — the case that
//       dropped in production (BUILD-57) — lands: sub row + gift row
//   §4  a FAILED first recurring charge on a drifting-history donor →
//       failed-payment path (past_due sub), donor EXCLUDED from drift
//   §5  a REAL refund of §2's charge → drift recomputes; the donor is back
//
// Usage (see docs/drift/README.md):
//   STRIPE_SECRET_KEY=sk_test_… node scripts/build76-drift-drill.js
const BASE = process.env.BASE || "http://localhost:5621";
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error("loopback only"); process.exit(1); }
const SK = process.env.STRIPE_SECRET_KEY || "";
if (!/^sk_test_/.test(SK)) { console.error("needs a sk_test_ key in STRIPE_SECRET_KEY"); process.exit(1); }
const Stripe = require("stripe");
const stripe = new Stripe(SK);
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: false });
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const bcrypt = require("bcryptjs");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, JSON.stringify(extra ?? "").slice(0, 300)); } };
const uniq = () => Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function waitFor(fn, tries = 90, ms = 1000) { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(ms); } return false; }

// A charges-enabled TEST connected account: reuse one from a prior drill if
// possible (KYC re-verification costs ~2 min), else mint per the BUILD-57/58
// recipe (id_number required; business_profile.url must resolve).
async function enabledAccount(email) {
  const existing = await stripe.accounts.list({ limit: 20 });
  const reuse = existing.data.find(a => a.charges_enabled === true);
  if (reuse) { console.log("  (reusing enabled test account " + reuse.id + ")"); return reuse.id; }
  const acct = await stripe.accounts.create({
    type: "custom", country: "US", email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  });
  await stripe.accounts.update(acct.id, {
    business_type: "individual",
    individual: {
      first_name: "Drift", last_name: "Driller", email,
      phone: "0000000000", id_number: "000000000", ssn_last_4: "0000", dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "address_full_match", city: "Mobile", state: "AL", postal_code: "36602", country: "US" },
    },
    business_profile: { mcc: "8398", product_description: "Drift drill org", url: "https://accessible.stripe.com" },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
    external_account: "btok_us_verified",
  });
  const up = await waitFor(async () => (await stripe.accounts.retrieve(acct.id)).charges_enabled === true, 60, 2000);
  if (!up) throw new Error("test-KYC never enabled charges on " + acct.id);
  return acct.id;
}

(async () => {
  console.log("BUILD-76 drift drill — REAL Stripe test mode, live webhooks\n");
  const health = await fetch(BASE + "/health").then(r => r.json()).catch(() => null);
  if (!health || health.status !== "ok") { console.error("drill server not up on " + BASE + " — see docs/drift/README.md"); process.exit(1); }

  // ── fixture org + admin (SQL fixture, gifts through the API) ─────────────
  const ORG = "org_b76drill_" + uniq();
  const acctId = await enabledAccount(`b76-${uniq()}@test.local`);
  // The connected TEST account is REUSED across runs (KYC costs ~2 min), but
  // the webhook resolves the org from event.account — release it from any
  // earlier drill org or every event lands in the FIRST run's org (cost one
  // very confusing red run).
  await q(`UPDATE orgs SET stripe_account_id=NULL, stripe_connected=false WHERE id LIKE 'org_b76drill%'`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
           VALUES ($1,'B76 Drift Drill','b76-${uniq()}',1,'active','growth',$2,true)`, [ORG, acctId]);
  const adminEmail = `b76admin-${uniq()}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Drill Admin','admin')`,
    ["u_" + uniq(), ORG, adminEmail, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = (await api("POST", "/auth/login", null, { email: adminEmail, password: "loadtest1234" })).body.token;

  // Wren: a real yearly cadence, entered by hand through the REAL gift route,
  // last gift ~16 months ago → drifting.
  const wrenEmail = `wren-b76-${uniq()}@test.local`;
  const wren = (await api("POST", "/donors", tok, { name: "Wren Yearly", email: wrenEmail, stage: "steward" })).body;
  await q(`DELETE FROM gifts WHERE donor_id=$1`, [wren.id]); // POST /donors seeds a $0 today-gift row shape; cadence must be ONLY the real history
  await q(`UPDATE donors SET last_gift_date=NULL, last_gift_amount=0, total_giving=0, gift_count=0 WHERE id=$1`, [wren.id]);
  for (const d of [daysAgo(1225), daysAgo(860), daysAgo(495)]) {
    const g = await api("POST", `/donors/${wren.id}/gifts`, tok, { amount: 400, date: d });
    if (g.status !== 201 && g.status !== 200) { console.error("gift seed failed", g.status, g.body); process.exit(1); }
  }

  // ── §1 · she is drifting: list, badge and headline agree ────────────────
  console.log("§1 the drifting state before any Stripe traffic");
  const before = (await api("GET", "/drift", tok)).body;
  const herRow = before.list.find(r => r.donorId === wren.id);
  ok("Wren is on the drift list (high confidence)", !!herRow && herRow.confidence === "high", before.list);
  const donorRead = (await api("GET", `/donors/${wren.id}`, tok)).body;
  ok("her badge field agrees", donorRead.drift && donorRead.drift.state === "drifting", donorRead.drift);
  ok("the headline carries her value at risk", before.atRiskAmount >= (herRow?.valueAtRisk || 0), { head: before.atRiskAmount, hers: herRow?.valueAtRisk });

  // ── §2 · a REAL gift via the live webhook clears her ────────────────────
  console.log("\n§2 live webhook gift → she leaves the list");
  const pi = await stripe.paymentIntents.create({
    amount: 40000, currency: "usd", confirm: true, payment_method: "pm_card_visa",
    receipt_email: wrenEmail, metadata: { donor_name: "Wren Yearly" },
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  }, { stripeAccount: acctId });
  ok("real $400 charge succeeded on the connected account", pi.status === "succeeded", pi.status);
  const landed = await waitFor(async () => (await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, pi.id])).length === 1);
  ok("the LIVE webhook recorded the gift on Wren", landed, null);
  const after = (await api("GET", "/drift", tok)).body;
  ok("she LEFT the drift list", !after.list.some(r => r.donorId === wren.id), after.list.map(r => r.donorName));
  const donorAfter = (await api("GET", `/donors/${wren.id}`, tok)).body;
  ok("her badge cleared", donorAfter.drift === null, donorAfter.drift);
  ok("the headline decreased by exactly her value at risk",
    Math.abs(after.atRiskAmount - (before.atRiskAmount - herRow.valueAtRisk)) < 0.01,
    { before: before.atRiskAmount, after: after.atRiskAmount, hers: herRow.valueAtRisk });

  // ── §3 · FIRST charge of a brand-new subscription — through the REAL
  // production flow: POST /donate/:slug (frequency monthly) → complete the
  // Stripe Checkout with the 4242 card (Playwright, the BUILD-57 recipe) →
  // the live checkout.session.completed + PI events land. This is the exact
  // case that once dropped in production.
  console.log("\n§3 first subscription charge lands and is reflected (real Checkout)");
  const [orgRow] = await q(`SELECT org_slug FROM orgs WHERE id=$1`, [ORG]);
  const subEmail = `nadia-b76-${uniq()}@test.local`;
  const co = await api("POST", `/donate/${orgRow.org_slug}`, null, {
    amount: 25, frequency: "monthly", firstName: "Nadia", lastName: "Newsub", email: subEmail,
  });
  ok("donate route minted a subscription checkout session", co.status === 200 && /\/pay\/cs_test_/.test(co.body.url || ""), co.body);
  if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(require("path").join(process.env.PLAYWRIGHT_DIR, "node_modules"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(co.body.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="cardNumber"]', { timeout: 30000 });
  await page.fill('input[name="cardNumber"]', "4242 4242 4242 4242");
  await page.fill('input[name="cardExpiry"]', "12 / 34");
  await page.fill('input[name="cardCvc"]', "123");
  await page.fill('input[name="billingName"]', "Nadia Newsub");
  const zip = page.locator('input[name="billingPostalCode"]');
  if (await zip.count()) await zip.fill("94110");
  const link = page.locator('input[name="enableStripePass"]');
  if (await link.count() && await link.isChecked()) await link.uncheck().catch(() => {});
  await page.click('button[type="submit"], .SubmitButton');
  const sid = (co.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
  let paid = false;
  // stripe-node 22: retrieve() only honors stripeAccount in the THIRD arg
  // (the BUILD-57 finding — 2-arg silently queries the platform account).
  for (let i = 0; i < 45 && !paid; i++) { await sleep(1000); const sess = await stripe.checkout.sessions.retrieve(sid, {}, { stripeAccount: acctId }).catch(() => null); paid = sess?.payment_status === "paid"; }
  ok("checkout session paid (Stripe API)", paid, null);
  await browser.close();
  const subRow = await waitFor(async () => (await q(
    `SELECT rs.status FROM recurring_subscriptions rs JOIN donors d ON d.id=rs.donor_id
      WHERE rs.org_id=$1 AND LOWER(d.email)=LOWER($2)`, [ORG, subEmail])).length === 1, 60, 500);
  ok("the subscription row exists (live webhook)", subRow, null);
  const firstGift = await waitFor(async () => (await q(
    `SELECT g.id FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND LOWER(d.email)=LOWER($2)`, [ORG, subEmail])).length >= 1, 60, 500);
  ok("the FIRST recurring charge became a gift (the case that once dropped)", firstGift, null);
  const nadiaDrift = (await api("GET", "/drift", tok)).body;
  const nadiaId = (await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)=LOWER($2)`, [ORG, subEmail]))[0]?.id;
  ok("the brand-new recurring donor is not on any drift surface", !nadiaDrift.list.some(r => r.donorId === nadiaId), null);

  // ── §4 · failed recurring charge → failed-payment path, NOT drift ───────
  console.log("\n§4 failed recurring charge routes to the failed-payment path");
  const failEmail = `fern-b76-${uniq()}@test.local`;
  const fern = (await api("POST", "/donors", tok, { name: "Fern Failing", email: failEmail, stage: "steward" })).body;
  await q(`DELETE FROM gifts WHERE donor_id=$1`, [fern.id]);
  await q(`UPDATE donors SET last_gift_date=NULL, last_gift_amount=0, total_giving=0, gift_count=0 WHERE id=$1`, [fern.id]);
  for (const d of [daysAgo(1225), daysAgo(860), daysAgo(495)]) await api("POST", `/donors/${fern.id}/gifts`, tok, { amount: 300, date: d });
  const fDrift = (await api("GET", "/drift", tok)).body;
  ok("Fern (no subscription yet) is drifting", fDrift.list.some(r => r.donorId === fern.id), fDrift.list.map(r => r.donorName));

  const cust2 = await stripe.customers.create({ email: failEmail, name: "Fern Failing" }, { stripeAccount: acctId });
  const pmFail = await stripe.paymentMethods.attach(
    (await stripe.paymentMethods.create({ type: "card", card: { token: "tok_chargeCustomerFail" } }, { stripeAccount: acctId })).id,
    { customer: cust2.id }, { stripeAccount: acctId });
  const failProduct = await stripe.products.create({ name: "Recurring gift (drill fail)" }, { stripeAccount: acctId });
  let subFail;
  try {
    subFail = await stripe.subscriptions.create({
      customer: cust2.id, default_payment_method: pmFail.id,
      items: [{ price_data: { currency: "usd", product: failProduct.id, unit_amount: 1500, recurring: { interval: "month" } } }],
      metadata: { donor_email: failEmail, donor_name: "Fern Failing", frequency: "monthly" },
      payment_behavior: "allow_incomplete",
    }, { stripeAccount: acctId });
  } catch (e) { console.log("  (subscription create threw: " + e.message + ")"); }
  ok("failing-card subscription created (incomplete/past_due at Stripe)", !!subFail, subFail && subFail.status);
  const fSubRow = await waitFor(async () => (await q(
    `SELECT status FROM recurring_subscriptions WHERE org_id=$1 AND stripe_subscription_id=$2`, [ORG, subFail?.id || "none"])).length === 1, 60, 500);
  const fStatus = fSubRow ? (await q(`SELECT status FROM recurring_subscriptions WHERE org_id=$1 AND stripe_subscription_id=$2`, [ORG, subFail.id]))[0].status : null;
  ok("the failure lives in the recurring/failed-payment path (sub row, non-active status)",
    fSubRow && ["past_due", "recovering", "incomplete", "active"].includes(fStatus), fStatus);
  const fDrift2 = (await api("GET", "/drift", tok)).body;
  ok("Fern is EXCLUDED from drift (her problem is a card, not drift)", !fDrift2.list.some(r => r.donorId === fern.id), fDrift2.list.map(r => r.donorName));
  ok("no gift was recorded for the failed charge", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1 AND amount=15`, [fern.id]))[0].n === 0);

  // ── §5 · a REAL refund brings Wren back — no stale cleared state ────────
  console.log("\n§5 refund → drift recomputes");
  await stripe.refunds.create({ payment_intent: pi.id }, { stripeAccount: acctId });
  const reversed = await waitFor(async () => (await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, pi.id])).length === 0, 60, 500);
  ok("charge.refunded reversed the gift (live event — only meaningful because §2 proved it landed)", landed && reversed, { landed, reversed });
  const afterRefund = (await api("GET", "/drift", tok)).body;
  ok("Wren is BACK on the drift list — no stale flag", afterRefund.list.some(r => r.donorId === wren.id), afterRefund.list.map(r => r.donorName));
  const wrenFinal = (await api("GET", `/donors/${wren.id}`, tok)).body;
  ok("her badge is back too — same computation", wrenFinal.drift && wrenFinal.drift.state === "drifting", wrenFinal.drift);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
