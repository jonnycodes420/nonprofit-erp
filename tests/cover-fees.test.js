// BUILD-08 Phase B — donor-covers-fees verification.
// Local scratch server + Postgres (tests/README.md recipe), plus REAL Stripe
// TEST MODE (never live): POST /donate creates real Checkout Sessions on a
// test-mode connected account, so the suite needs:
//
//   STRIPE_TEST_KEY        sk_test_… (platform test key — also boot the
//                          server with STRIPE_SECRET_KEY set to it)
//   STRIPE_TEST_ACCOUNT    a test-mode connected account with
//                          charges_enabled=true (e.g. from `stripe accounts
//                          list` — the BUILD-01 receipt verification left one)
//
// Optional full end-to-end (checkout completed with the 4242 test card via
// Playwright, webhook → gift row → receipt):
//
//   FULL_E2E=1 PLAYWRIGHT_DIR=/scratch/with/playwright
//   plus `stripe listen --forward-connect-to localhost:5601/stripe/webhook`
//   running, with the server booted with its whsec as STRIPE_WEBHOOK_SECRET.
//
// What it proves:
//   - gross-up math: charged = ceil((base+30)/(1-0.029)) server-side, and the
//     client's display copy of the same function stays in lockstep (parity
//     sweep against the literal source of Donate.jsx's grossUpCents)
//   - the server derives the total from base+boolean (a client-sent total is
//     ignored), one-time AND recurring
//   - org toggle off → checkbox hidden (public endpoints) AND server refuses
//     to gross up even if coverFees:true is sent
//   - full charged amount IS the donation: gift row and receipt both record
//     the grossed-up total (FULL_E2E)

const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const SK = process.env.STRIPE_TEST_KEY;
const ACCT = process.env.STRIPE_TEST_ACCOUNT;
if (!SK || !/^sk_test_/.test(SK)) { console.error("STRIPE_TEST_KEY (sk_test_…) required — test mode only, never a live key"); process.exit(1); }
if (!ACCT) { console.error("STRIPE_TEST_ACCOUNT required (test-mode connected account id)"); process.exit(1); }

const ORG = "org_test_fees";
const SLUG = "cover-fees-fixture";
const grossUp = (c) => Math.ceil((c + 30) / (1 - 0.029));

async function stripeGet(pathname) {
  const r = await fetch("https://api.stripe.com" + pathname, {
    headers: { Authorization: "Basic " + Buffer.from(SK + ":").toString("base64"), "Stripe-Account": ACCT },
  });
  return r.json();
}

async function fixture() {
  // Idempotent: tear down and recreate our own org rows.
  for (const t of ["receipts", "gifts", "interactions", "giving_pages", "peer_fundraisers", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(
    `INSERT INTO orgs (id, name, onboarding_complete, org_slug, stripe_connected, stripe_account_id,
                       legal_name, ein, receipt_address, receipts_enabled)
     VALUES ($1,'Cover Fees Fixture Org',1,$2,true,$3,'Cover Fees Fixture Org','12-3456789','1 Test Way, Testville, TS 00000',true)`,
    [ORG, SLUG, ACCT]
  );
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ('u_fees_admin',$1,'fees-admin@test.local',$2,'Fees Admin','admin')`, [ORG, hash]);
  await q(`INSERT INTO giving_pages (id, org_id, slug, title, status) VALUES ('gp_fees_1',$1,'spring-appeal','Spring Appeal','active')`, [ORG]);
  await q(`INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, status, edit_token)
           VALUES ('pf_fees_1',$1,'gp_fees_1','Pat Peer','pat@test.local','pat','active','tok_fees_fixture_0000000000000000000000000000000000000000000000')`, [ORG]);
}

(async () => {
  await fixture();
  console.log("fixture ready\n");

  // ── 1. Gross-up math parity: server constant vs client display copy ──
  {
    const clientSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Donate.jsx"), "utf8");
    const m = clientSrc.match(/function grossUpCents\(baseCents\) \{\s*return ([^;]+);/);
    ok("client grossUpCents found in Donate.jsx", !!m);
    if (m) {
      const clientFn = new Function("baseCents", "return " + m[1] + ";");
      let mismatch = null;
      for (const cents of [100, 500, 1000, 2500, 5000, 9999, 25000, 100000, 1000000, 123457]) {
        if (clientFn(cents) !== grossUp(cents)) { mismatch = cents; break; }
      }
      ok("client display math === server gross-up math (10-amount sweep)", mismatch === null, mismatch);
    }
  }

  // ── 2. Public endpoints expose the org switch (default on) ──
  const pub1 = await api("GET", `/org/${SLUG}/public`);
  ok("org-wide public: coverFeesEnabled true by default", pub1.body?.org?.coverFeesEnabled === true, pub1.body?.org);
  const pub2 = await api("GET", `/org/${SLUG}/giving-page/spring-appeal/public`);
  ok("giving-page public: coverFeesEnabled true", pub2.body?.org?.coverFeesEnabled === true);
  const pub3 = await api("GET", `/org/${SLUG}/giving-page/spring-appeal/fundraiser/pat/public`);
  ok("peer-fundraiser public: coverFeesEnabled true", pub3.body?.org?.coverFeesEnabled === true);

  // ── 3. One-time with coverFees → session charges the gross-up ──
  const donor = { firstName: "Dana", lastName: "Donor", email: "dana-fees@test.local" };
  const mk = (body) => api("POST", `/donate/${SLUG}`, null, { frequency: "one-time", ...donor, ...body });

  const d1 = await mk({ amount: 50, coverFees: true });
  ok("donate covered: 200 + url", d1.status === 200 && /checkout\.stripe\.com/.test(d1.body?.url || ""), d1.body);
  let coveredSessionUrl = null;
  if (d1.status === 200) {
    coveredSessionUrl = d1.body.url;
    const sid = (d1.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
    ok("session id parseable from url", !!sid, d1.body.url);
    if (sid) {
      const s = await stripeGet(`/v1/checkout/sessions/${sid}`);
      ok("covered $50 charges 5181¢ (= ceil(5030/0.971))", s.amount_total === grossUp(5000) && grossUp(5000) === 5181, s.amount_total);
      ok("metadata records cover_fees + base", s.metadata?.cover_fees === "true" && s.metadata?.base_amount_cents === "5000", s.metadata);
    }
  }

  // ── 4. One-time without coverFees → base amount exactly ──
  const d2 = await mk({ amount: 50, coverFees: false });
  if (d2.status === 200) {
    const sid = (d2.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
    const s = sid ? await stripeGet(`/v1/checkout/sessions/${sid}`) : {};
    ok("uncovered $50 charges 5000¢", s.amount_total === 5000, s.amount_total);
  } else ok("donate uncovered: 200", false, d2.body);

  // ── 5. Server ignores a client-sent total (only base + boolean count) ──
  const d3 = await mk({ amount: 50, coverFees: true, chargedAmount: 1, total: 1, amountTotal: 1 });
  if (d3.status === 200) {
    const sid = (d3.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
    const s = sid ? await stripeGet(`/v1/checkout/sessions/${sid}`) : {};
    ok("client-sent totals ignored — still server-derived 5181¢", s.amount_total === 5181, s.amount_total);
  } else ok("donate with junk totals: 200", false, d3.body);

  // ── 6. Recurring with coverFees → grossed-up recurring price ──
  const d4 = await mk({ amount: 25, frequency: "monthly", coverFees: true });
  if (d4.status === 200) {
    const sid = (d4.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
    const s = sid ? await stripeGet(`/v1/checkout/sessions/${sid}`) : {};
    ok("recurring covered $25/mo → 2606¢/mo in subscription mode", s.mode === "subscription" && s.amount_total === grossUp(2500) && grossUp(2500) === 2606, { mode: s.mode, amount_total: s.amount_total });
  } else ok("recurring covered donate: 200", false, d4.body);

  // ── 7. Org toggle off: hidden from public, refused server-side ──
  {
    const loginR = await api("POST", "/auth/login", null, { email: "fees-admin@test.local", password: "loadtest1234" });
    const token = loginR.body?.token;
    ok("fixture admin login", !!token);
    const patch = await api("PATCH", `/orgs/${ORG}`, token, { coverFeesEnabled: false });
    ok("PATCH coverFeesEnabled:false → 200", patch.status === 200, patch.body);
    const [row] = await q("SELECT mission, cover_fees_enabled FROM orgs WHERE id=$1", [ORG]);
    ok("toggle-only PATCH did not null profile fields", row.cover_fees_enabled === false && row.mission === null /* was null in fixture; the real assertion is next */);
    // Prove the no-clobber guard with a real mission value:
    await q("UPDATE orgs SET mission='Keep me' WHERE id=$1", [ORG]);
    await api("PATCH", `/orgs/${ORG}`, token, { coverFeesEnabled: true });
    const [row2] = await q("SELECT mission FROM orgs WHERE id=$1", [ORG]);
    ok("toggle-only PATCH preserves mission", row2.mission === "Keep me", row2.mission);
    await api("PATCH", `/orgs/${ORG}`, token, { coverFeesEnabled: false });

    const pubOff = await api("GET", `/org/${SLUG}/public`);
    ok("public reports coverFeesEnabled false after toggle", pubOff.body?.org?.coverFeesEnabled === false);
    const d5 = await mk({ amount: 50, coverFees: true });
    if (d5.status === 200) {
      const sid = (d5.body.url.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
      const s = sid ? await stripeGet(`/v1/checkout/sessions/${sid}`) : {};
      ok("org off: coverFees:true still charges base 5000¢", s.amount_total === 5000, s.amount_total);
    } else ok("org-off donate: 200", false, d5.body);
    // back on for the e2e leg
    await api("PATCH", `/orgs/${ORG}`, token, { coverFeesEnabled: true });
  }

  // ── 8. FULL_E2E: complete the covered checkout with the 4242 test card;
  //       webhook (via `stripe listen --forward-connect-to`) records the gift
  //       and auto-issues the receipt — both at the FULL charged amount. ──
  if (process.env.FULL_E2E === "1" && coveredSessionUrl) {
    if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    console.log("\n  completing checkout with test card 4242…");
    // Not networkidle — Stripe Checkout holds connections open indefinitely.
    await page.goto(coveredSessionUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[name="cardNumber"]', { timeout: 30000 });
    await page.fill('input[name="cardNumber"]', "4242 4242 4242 4242");
    await page.fill('input[name="cardExpiry"]', "12 / 34");
    await page.fill('input[name="cardCvc"]', "123");
    await page.fill('input[name="billingName"]', "Dana Donor");
    const zip = page.locator('input[name="billingPostalCode"]');
    if (await zip.count()) await zip.fill("94110");
    // Link's "save my info" is pre-checked and demands a phone number —
    // uncheck it so this stays a plain card payment.
    const link = page.locator('input[name="enableStripePass"]');
    if (await link.count() && await link.isChecked()) await link.uncheck().catch(() => {});
    await page.click('button[type="submit"], .SubmitButton');
    // Confirm via the Stripe API rather than the redirect — FRONTEND_URL is
    // rewritten to https:// by the server, so the local return URL 404s.
    const sid = (coveredSessionUrl.match(/\/pay\/(cs_test_[a-zA-Z0-9]+)/) || [])[1];
    let paid = false;
    for (let i = 0; i < 45 && !paid; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await stripeGet(`/v1/checkout/sessions/${sid}`);
      paid = s.payment_status === "paid";
    }
    ok("checkout session paid (Stripe API)", paid);
    await browser.close();

    // Give the webhook (stripe listen → /stripe/webhook) a moment to land.
    let gift = null;
    for (let i = 0; i < 30 && !gift; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const rows = await q("SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id IS NOT NULL ORDER BY id DESC LIMIT 1", [ORG]);
      if (rows.length) gift = rows[0];
    }
    ok("gift row created by webhook", !!gift);
    if (gift) {
      ok("gift amount = full charged 51.81 (not the 50.00 base)", parseFloat(gift.amount) === 51.81, gift.amount);
      let receipt = null;
      for (let i = 0; i < 20 && !receipt; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const rows = await q("SELECT * FROM receipts WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL", [ORG, gift.id]);
        if (rows.length) receipt = rows[0];
      }
      ok("receipt auto-issued for the gift", !!receipt);
      if (receipt) ok("receipt amount = full charged 51.81", parseFloat(receipt.amount) === 51.81, receipt.amount);
      const [d] = await q("SELECT total_giving FROM donors WHERE org_id=$1 AND email='dana-fees@test.local'", [ORG]);
      ok("donor total_giving reflects full charged amount", d && parseFloat(d.total_giving) === 51.81, d?.total_giving);
    }
  } else {
    console.log("\n  (FULL_E2E not set — skipping card-completion + webhook leg)");
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
