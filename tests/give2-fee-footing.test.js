// GIVE-2 — THE ONE TEST. The four money figures on an online gift foot to the
// cent, for a card gift and for an ACH gift.
//
//   GROSS    gifts.amount — what was charged
//   COVERED  gifts.cover_fee_amount — what the donor added on purpose
//   FEE      gifts.processor_fee_amount — what the processor actually took,
//            read off the charge's own balance transaction
//   NET      gross − fee — what reached the bank account
//
// It earns its place under CLAUDE.md's one-test rule because every one of them
// is money: the charge a donor's card is asked for, the amount a receipt
// states, and the figure a bookkeeper reconciles against a Stripe payout.
//
// ── WHAT WOULD MAKE IT FAIL (the guard-must-be-able-to-fail rule) ──────────
// Four plantable defects, each the shape of a real one:
//   1. Gross up at the hard-coded 2.9% when the org's rate is 2.2% → §1 goes
//      red on the unit_amount Stripe was asked for. (This WAS the behaviour
//      before this build.)
//   2. Leave `processor_fee_amount` at its 0 default → §2's net equals gross
//      and the fee assertion fails.
//   3. Keep `paymentMethod: "Card"` hard-coded → §3's ACH method assertion
//      fails. (This WAS the behaviour before this build.)
//   4. Default `processor_fee_source` to a value when nobody read a fee → §4
//      stops being able to tell "nothing was taken" from "nobody has said".
// Each was planted and watched go red before this suite was trusted.
//
// Runs against the scratch server + scratch Postgres, never production.
const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "org_g2fee", ACCT = "acct_g2fee", SLUG = "g2fee-harbor-test";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const uniq = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 900) => new Promise(r => setTimeout(r, ms));
const cents = v => Math.round(Number(v || 0) * 100);

// Stripe's published rates, which are also this module's defaults.
const CARD_PCT = 0.029, CARD_FLAT = 30;
const ACH_PCT = 0.008, ACH_CAP = 500;

// What the mock was asked to charge, and which charges it will answer for.
const seen = [];
const charges = new Map();
let mock;

function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/\/v1\/checkout\/sessions/.test(req.url) && req.method === "POST") {
          const p = new URLSearchParams(b);
          const id = "cs_test_" + uniq();
          seen.push({
            id,
            unitAmount: Number(p.get("line_items[0][price_data][unit_amount]")),
            // GIVE-2 §2 — the absence of this parameter IS the feature: with no
            // `payment_method_types`, Stripe renders whatever the connected
            // account accepts (card, the wallets, Link, ACH, PayPal) and
            // nothing it does not.
            pinnedMethods: [...p.keys()].filter(k => k.startsWith("payment_method_types")),
            setupFutureUsage: p.get("payment_intent_data[setup_future_usage]") || "",
            customerCreation: p.get("customer_creation") || "",
            customer: p.get("customer") || "",
            customerEmail: p.get("customer_email") || "",
            rememberMe: p.get("metadata[remember_me]") || "",
            baseAmount: p.get("metadata[base_amount_cents]") || "",
            coverFees: p.get("metadata[cover_fees]") || "",
          });
          res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
          return;
        }
        // GET /v1/charges/:id — the balance transaction is where the FEE comes
        // from. A charge the test did not register answers 404, which is how §4
        // drives the "nobody has told us yet" case.
        const m = req.url.match(/\/v1\/charges\/(ch_[^/?]+)/);
        if (m && req.method === "GET") {
          const ch = charges.get(m[1]);
          if (!ch) { res.statusCode = 404; res.end(JSON.stringify({ error: { message: "No such charge" } })); return; }
          res.end(JSON.stringify(ch));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

function registerCharge({ id, amountCents, feeCents, type, wallet }) {
  charges.set(id, {
    id, object: "charge", amount: amountCents,
    payment_method_details: type === "us_bank_account"
      ? { type: "us_bank_account", us_bank_account: { last4: "6789" } }
      : { type: "card", card: { brand: "visa", last4: "4242", wallet: wallet ? { type: wallet } : null } },
    balance_transaction: {
      id: "txn_" + uniq(), object: "balance_transaction",
      amount: amountCents, fee: feeCents, net: amountCents - feeCents, currency: "usd",
    },
  });
}

async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

// A real subscription-free one-time charge: `payment_intent.succeeded` with the
// metadata /donate stamped, and `latest_charge` pointing at the registered
// charge the handler will read the fee from.
function piEvent({ piId, chargeId, amountCents, email, baseCents, coverFees }) {
  return {
    id: "evt_" + uniq(), type: "payment_intent.succeeded", account: ACCT,
    data: { object: {
      id: piId, object: "payment_intent", amount: amountCents, amount_received: amountCents,
      receipt_email: email, latest_charge: chargeId,
      metadata: {
        donor_email: email, donor_name: "Fee Footing", org_id: ORG, frequency: "once",
        fund_id: "", campaign_id: "", giving_page_id: "", peer_fundraiser_id: "",
        ...(coverFees ? { cover_fees: "true", base_amount_cents: String(baseCents) } : {}),
      },
    } },
  };
}

async function reset() {
  const CHILD = ["receipts", "fin_audit_log", "fin_transactions", "gifts", "interactions",
    "notification_sends", "recurring_subscriptions", "tasks", "threads", "matching_employers",
    "portal_magic_links", "payment_recovery_events"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,
                             stripe_account_id,stripe_connected,cover_fees_enabled)
           VALUES ($1,'Harbor Fee Trust',$2,1,'active','growth',$3,true,true)`, [ORG, SLUG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Fee Admin','admin')`,
    ["u_g2fee", ORG, "g2fee@example.org", bcrypt.hashSync("demo1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`,
    ["ff_g2fee", ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions')`, ["acc_g2fee", ORG]);
}

// ── THE FOOTING, read through the SAME module every screen reads ───────────
async function footingOf(piId) {
  const F = await import("../shared/giftFooting.js");
  const [g] = await q(
    `SELECT amount, cover_fee_amount, processor_fee_amount, processor_fee_source, payment_method
       FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, piId]);
  if (!g) return null;
  return {
    row: g,
    f: F.giftFooting({
      grossCents: cents(g.amount),
      feeCents: cents(g.processor_fee_amount),
      coveredCents: cents(g.cover_fee_amount),
      feeSource: g.processor_fee_source,
    }),
    foots: F.footsToTheCent(F.giftFooting({
      grossCents: cents(g.amount),
      feeCents: cents(g.processor_fee_amount),
      coveredCents: cents(g.cover_fee_amount),
      feeSource: g.processor_fee_source,
    })),
  };
}

(async () => {
  mock = await startStripeMock();
  if (!mock) {
    console.log(`  FAIL  could not bind the Stripe mock on :${STRIPE_MOCK_PORT} — another process is on it`);
    console.log("\n0 passed, 1 failed (the Stripe mock could not start)");
    process.exit(1);
  }
  await reset();

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§1 the charge is grossed up at THE ORG'S rate");
  // ════════════════════════════════════════════════════════════════════════
  {
    const R = await import("../shared/processingRates.js");
    const base = 10000;                                // a $100 gift

    // (a) the published default, which is what every org starts on.
    seen.length = 0;
    let r = await fetch(`${BASE}/donate/${SLUG}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100", frequency: "once", coverFees: true,
                             firstName: "Fee", lastName: "Footing", email: "g2fee-donor@example.org" }),
    });
    const expectedDefault = Math.ceil((base + CARD_FLAT) / (1 - CARD_PCT));
    ok("a cover-the-fee gift reaches Stripe", r.status === 200 && seen.length === 1, { status: r.status, seen: seen.length });
    ok(`the charge is the published gross-up (${expectedDefault}¢)`,
      seen[0] && seen[0].unitAmount === expectedDefault, { asked: seen[0]?.unitAmount, expectedDefault });
    ok("the base amount rides the metadata so the webhook can split it",
      seen[0] && seen[0].baseAmount === String(base) && seen[0].coverFees === "true", seen[0]);

    // (b) THE ORG'S OWN RATE CHANGES THE CHARGE. This is the assertion that
    // would have been red before this build, when the 2.9% was a constant in
    // routes/give.js: an org on Stripe's nonprofit rate was asking its donors
    // to cover a rate it does not pay.
    await api("PATCH", `/orgs/${ORG}`, (await api("POST", "/auth/login", null,
      { email: "g2fee@example.org", password: "demo1234" })).body.token,
      { processingRates: { card: { pctDisplay: 2.2, flatCents: 30 } } });
    seen.length = 0;
    r = await fetch(`${BASE}/donate/${SLUG}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100", frequency: "once", coverFees: true,
                             firstName: "Fee", lastName: "Footing", email: "g2fee-donor@example.org" }),
    });
    const expectedNonprofit = R.grossUpCents(base, { pct: 0.022, flatCents: 30, capCents: null });
    ok(`the nonprofit rate asks for less (${expectedNonprofit}¢, not ${expectedDefault}¢)`,
      seen[0] && seen[0].unitAmount === expectedNonprofit && expectedNonprofit < expectedDefault,
      { asked: seen[0]?.unitAmount, expectedNonprofit, expectedDefault });

    // Back to the published rate for the rest of the suite, so the fee numbers
    // below are Stripe's own arithmetic.
    const tok = (await api("POST", "/auth/login", null, { email: "g2fee@example.org", password: "demo1234" })).body.token;
    await api("PATCH", `/orgs/${ORG}`, tok, { processingRates: { card: null, ach: null } });

    // (c) GIVE-2 §2 — Checkout is no longer pinned to cards.
    ok("the checkout session pins NO payment method types, so the account decides",
      seen[0] && seen[0].pinnedMethods.length === 0, { pinned: seen[0]?.pinnedMethods });

    // (d) GIVE-2 §4 — "remember me" is opt-in and reaches Stripe as a save.
    seen.length = 0;
    await fetch(`${BASE}/donate/${SLUG}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100", frequency: "once", rememberMe: true,
                             firstName: "Fee", lastName: "Footing", email: "g2fee-donor@example.org" }),
    });
    ok("remember-me asks Stripe to save the method on a customer",
      seen[0] && seen[0].setupFutureUsage === "off_session" && seen[0].customerCreation === "always"
        && seen[0].rememberMe === "1", seen[0]);
    seen.length = 0;
    await fetch(`${BASE}/donate/${SLUG}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100", frequency: "once",
                             firstName: "Fee", lastName: "Footing", email: "g2fee-donor@example.org" }),
    });
    ok("without the box, nothing is saved and no customer is made",
      seen[0] && !seen[0].setupFutureUsage && !seen[0].customerCreation && !seen[0].rememberMe, seen[0]);

    // (e) THE SAME PERSON IS THE SAME STRIPE CUSTOMER. A donor who already has
    // one (the recurring layer put it there) must not be given a second for the
    // same organisation, and `donors.stripe_customer_id` must not be overwritten
    // by a path that did not know about the first.
    // The donor row exists because they have given before — which is the only
    // way they could have a saved customer in the first place.
    await q(`INSERT INTO donors (id,org_id,name,email,stripe_customer_id,created_by,created_by_name)
             VALUES ($1,$2,'Fee Footing',$3,'cus_already_theirs','system:test','Test')
             ON CONFLICT (id) DO UPDATE SET stripe_customer_id='cus_already_theirs'`,
      ["d_g2fee_known", ORG, "g2fee-donor@example.org"]);
    seen.length = 0;
    await fetch(`${BASE}/donate/${SLUG}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100", frequency: "once", rememberMe: true,
                             firstName: "Fee", lastName: "Footing", email: "g2fee-donor@example.org" }),
    });
    ok("a donor Steward already has a Stripe customer for keeps that customer",
      seen[0] && seen[0].customer === "cus_already_theirs" && !seen[0].customerCreation, seen[0]);
    ok("…and no customer_email rides beside it (Stripe refuses both)",
      seen[0] && !seen[0].customerEmail, seen[0]);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§2 A CARD GIFT — gross, covered, fee and net foot to the cent");
  // ════════════════════════════════════════════════════════════════════════
  {
    const base = 10000;
    const charged = Math.ceil((base + CARD_FLAT) / (1 - CARD_PCT));       // 10330
    const realFee = Math.ceil(charged * CARD_PCT) + CARD_FLAT;            // what Stripe took
    const piId = "pi_g2fee_card_" + uniq(), chId = "ch_g2fee_card_" + uniq();
    registerCharge({ id: chId, amountCents: charged, feeCents: realFee, type: "card" });
    const status = await fire(piEvent({ piId, chargeId: chId, amountCents: charged,
      email: "g2fee-card@example.org", baseCents: base, coverFees: true }));
    await settle();
    ok("the webhook accepted the card charge", status === 200, { status });

    const out = await footingOf(piId);
    ok("the gift was written", !!out, null);
    if (out) {
      ok(`gross is the charged amount (${charged}¢)`, out.f.grossCents === charged, out.f);
      ok(`covered is what the donor added (${charged - base}¢)`, out.f.coveredCents === charged - base, out.f);
      ok(`the fee came off the balance transaction (${realFee}¢), not from a rate`,
        out.f.feeCents === realFee && out.row.processor_fee_source === "stripe_balance_transaction",
        { fee: out.f.feeCents, realFee, source: out.row.processor_fee_source });
      ok("net = gross − fee, to the cent", out.f.netCents === charged - realFee, out.f);
      ok("intended = gross − covered, to the cent", out.f.intendedCents === base, out.f);
      ok("IT FOOTS: net + fee = gross AND intended + covered = gross", out.foots === true, out.f);
      // The claim the copy under the checkbox makes, pinned: the org nets at
      // least what the donor meant to give. Never less.
      ok("the organisation nets at least the intended gift", out.f.netCents >= out.f.intendedCents,
        { net: out.f.netCents, intended: out.f.intendedCents });
      ok("the method was recorded as a card", out.row.payment_method === "Card", out.row);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§3 AN ACH GIFT — the cheaper rate, the right method, same footing");
  // ════════════════════════════════════════════════════════════════════════
  {
    const base = 10000;
    // The gross-up is at the CARD rate, because the donor chooses how to pay on
    // Stripe's page AFTER the amount is set. The ACH fee is far smaller, so the
    // org nets MORE than the gift — which is exactly what the sentence under
    // the box promises, and the assertion below is that promise.
    const charged = Math.ceil((base + CARD_FLAT) / (1 - CARD_PCT));
    const realFee = Math.min(ACH_CAP, Math.ceil(charged * ACH_PCT));
    const piId = "pi_g2fee_ach_" + uniq(), chId = "ch_g2fee_ach_" + uniq();
    registerCharge({ id: chId, amountCents: charged, feeCents: realFee, type: "us_bank_account" });
    const status = await fire(piEvent({ piId, chargeId: chId, amountCents: charged,
      email: "g2fee-ach@example.org", baseCents: base, coverFees: true }));
    await settle();
    ok("the webhook accepted the ACH charge", status === 200, { status });

    const out = await footingOf(piId);
    ok("the ACH gift was written", !!out, null);
    if (out) {
      ok(`the ACH fee is the bank rate (${realFee}¢), not the card rate`,
        out.f.feeCents === realFee && realFee < Math.ceil(charged * CARD_PCT) + CARD_FLAT,
        { fee: out.f.feeCents, realFee });
      ok("net = gross − fee, to the cent", out.f.netCents === charged - realFee, out.f);
      ok("IT FOOTS: net + fee = gross AND intended + covered = gross", out.foots === true, out.f);
      ok("the org nets MORE than the intended gift on a bank transfer, never less",
        out.f.netCents > out.f.intendedCents, { net: out.f.netCents, intended: out.f.intendedCents });
      // THE METHOD. `paymentMethod: "Card"` was hard-coded in the webhook, so
      // every bank transfer was recorded as a card gift — in the column the
      // deposit sheet and every method breakdown read.
      ok("the method was recorded as a bank transfer, not a card",
        out.row.payment_method === "Bank transfer (ACH)", out.row);
    }

    // A LARGE ACH GIFT HITS THE CAP. The naive gross-up formula is wrong above
    // it in the expensive direction, so the module's cap branch is pinned here.
    const R = await import("../shared/processingRates.js");
    const bigBase = 500000;                                     // $5,000
    const achRate = { pct: ACH_PCT, flatCents: 0, capCents: ACH_CAP };
    ok("a $5,000 bank gift is grossed up by the $5 cap, not by 0.8% of it",
      R.grossUpCents(bigBase, achRate) === bigBase + ACH_CAP,
      { grossUp: R.grossUpCents(bigBase, achRate), expected: bigBase + ACH_CAP,
        naive: Math.ceil(bigBase / (1 - ACH_PCT)) });
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§4 a fee NOBODY has read is not a fee of zero");
  // ════════════════════════════════════════════════════════════════════════
  {
    // The charge is deliberately NOT registered with the mock, so the handler's
    // read 404s. The gift must still be written — an outage in a reporting
    // detail may not turn a completed payment into a 500 — and the footing must
    // say the fee is unknown rather than zero.
    const charged = 5000;
    const piId = "pi_g2fee_unread_" + uniq(), chId = "ch_g2fee_unread_" + uniq();
    const status = await fire(piEvent({ piId, chargeId: chId, amountCents: charged,
      email: "g2fee-unread@example.org", coverFees: false }));
    await settle();
    ok("an unreadable fee still writes the gift", status === 200, { status });
    const out = await footingOf(piId);
    ok("the gift is there", !!out, null);
    if (out) {
      ok("no fee was invented", out.f.feeCents === 0, out.f);
      ok("and the source says NOBODY HAS SAID, which is not the same as zero",
        out.row.processor_fee_source === null && out.f.feeKnown === false,
        { source: out.row.processor_fee_source, feeKnown: out.f.feeKnown });
      ok("it still foots", out.foots === true, out.f);
    }
    // And a CASH gift, whose fee of zero IS a fact, is distinguishable from it.
    const F = await import("../shared/giftFooting.js");
    const cash = F.giftFooting({ grossCents: 10000, feeCents: 0, coveredCents: 0, feeSource: "none" });
    ok("a gift with no processor at all reports a KNOWN fee of zero",
      cash.feeKnown === true && cash.netCents === 10000, cash);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§5 the Fundraising panel's dollars foot to its own rows");
  // ════════════════════════════════════════════════════════════════════════
  {
    const tok = (await api("POST", "/auth/login", null, { email: "g2fee@example.org", password: "demo1234" })).body.token;
    const r = await api("GET", "/recurring/recovery", tok);
    ok("the recovery panel answers", r.status === 200, r.body);
    if (r.status === 200) {
      const d = r.body;
      const sum = (d.dollars.rows || []).reduce((a, g) => a + g.grossCents, 0);
      ok("the dollars figure is exactly the sum of the rows it opens", d.dollars.cents === sum,
        { figure: d.dollars.cents, rows: sum });
      ok("every figure carries the sentence that defines it",
        !!(d.failed.definition && d.recovered.definition && d.dollars.definition), null);
    }
  }

  mock.close();
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { if (mock) mock.close(); await closeDb(); } catch { /* shutting down */ }
  process.exit(1);
});
