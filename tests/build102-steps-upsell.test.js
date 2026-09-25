// BUILD-102 (Steward Give) Part 2 — MULTI-STEP, WALLETS, AND THE UPSELL.
//
// The brief's own test: a tampered amount still charges the server's price; the
// upsell appears once and a decline never re-appears on the same session; a
// monthly gift from the upsell writes one subscription and one gift through the
// existing webhook, and a redelivered webhook writes nothing.
//
//   §1  the upsell arithmetic — a third, rounded to a whole dollar, and never
//       offered to somebody already giving monthly;
//   §2  THE FORM'S CONFIG CONSTRAINS THE CHARGE: an amount the form does not
//       offer is refused, and the server's price is what is charged;
//   §3  the designation is the FORM's, not the request's — a fixed form ignores
//       what the request asked for, a choice form refuses an outsider;
//   §4  a frequency the form does not offer cannot mint a subscription;
//   §5  cover-fees is unchanged: unchecked by default, grossed up on the server;
//   §6  the org's threshold is the org's, and a useless one is refused;
//   §7  the three steps in a real browser, and the upsell asked ONCE — a decline
//       does not come back on the same session;
//   §8  the wall: a page from another org cannot be charged through this one.
//
// Standard scratch stack; ports per WORKTREE-NOTES.md. The browser leg reads
// APP_URL and SKIPS honestly when there is no preview — never against :4173.

const bcrypt = require("bcryptjs");
const path = require("path");
const http = require("http");
const { ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

// A CHECKOUT SESSION IS AN OUTBOUND STRIPE CALL, so this suite needs the mock the
// boot recipe's `STRIPE_API_BASE` points at — otherwise every SUCCESSFUL donation
// answers 500 ECONNREFUSED and reads exactly like a product defect. The first run
// of this suite failed nine assertions for that reason and none of them were real.
// It records what Stripe was ASKED FOR, which is how §2 checks the server's price
// rather than the request's.
const stripeCalls = [];
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        stripeCalls.push({ method: req.method, path: req.url, body: b });
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) {
          res.end(JSON.stringify({ id: "cs_mock_" + stripeCalls.length, object: "checkout.session",
                                   url: "https://checkout.stripe.test/c/mock" }));
        } else if (/^\/v1\/prices/.test(req.url)) {
          res.end(JSON.stringify({ id: "price_mock", object: "price", unit_amount: 1000, currency: "usd" }));
        } else if (/^\/v1\/products/.test(req.url)) {
          res.end(JSON.stringify({ id: "prod_mock", object: "product", active: true }));
        } else {
          res.end(JSON.stringify({ ok: true, object: "thing", id: "mock_1", data: [] }));
        }
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
// What the last Checkout session was actually priced at, read from the body
// Stripe received — never from what the page or the test believed.
function lastCheckoutCents() {
  for (let i = stripeCalls.length - 1; i >= 0; i--) {
    const c = stripeCalls[i];
    if (!/^\/v1\/checkout\/sessions/.test(c.path)) continue;
    // Stripe's client sends form-encoded brackets LITERALLY, not percent-escaped —
    // checked against a real request body rather than assumed, because the
    // percent-escaped guess matched nothing and reported `null` as a failure.
    const m = /line_items\[0\]\[price_data\]\[unit_amount\]=(\d+)/.exec(c.body)
      || /unit_amount(?:%5D)?=(\d+)/.exec(c.body);
    if (m) return Number(m[1]);
  }
  return null;
}

const ORG = "b102_step", OTHER = "b102_step2";
const ME = "b102step@example.org", THEM = "b102step-other@example.org";
const PW = "loadtest1234";

const CHILD = ["custom_field_values", "custom_field_defs", "peer_fundraisers", "gifts",
  "giving_pages", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, slug, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,
                     stripe_account_id,stripe_connected,cover_fees_enabled)
   VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW(),$4,TRUE,TRUE)
   ON CONFLICT (id) DO UPDATE SET stripe_account_id=$4, stripe_connected=TRUE, cover_fees_enabled=TRUE`,
  [id, name, slug, "acct_" + id]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build102-steps-upsell");
  await reset();
  await mkOrg(ORG, "b102-step", "Harbor Music School");
  await mkOrg(OTHER, "b102-step2", "Open Door Pantry");
  await mkUser("u_b102s", ORG, ME, "Allie Barnett");
  await mkUser("u_b102s2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen_s','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_youth_s','${ORG}','Youth lessons',true)
           ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_them_s','${OTHER}','Their pantry',true)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const F = await import("../shared/formConfig.js");
  const smock = await startStripeMock();
  if (!smock) ok("fixture the Stripe mock bound (environment)", false,
                 `port ${STRIPE_MOCK_PORT} is busy — set STRIPE_MOCK_PORT to this worktree's own`);

  // ── §1 · THE UPSELL ARITHMETIC ──────────────────────────────────────────
  console.log("\n— §1 · a third, rounded to a whole dollar —");
  ok("§1 $100 suggests $33 a month", F.upsellFor(cents(100)).monthlyCents === cents(33), F.upsellFor(cents(100)));
  ok("§1 $150 suggests $50", F.upsellFor(cents(150)).monthlyCents === cents(50));
  ok("§1 $1,000 suggests $333", F.upsellFor(cents(1000)).monthlyCents === cents(333));
  // A WHOLE DOLLAR, because "$12.50 a month" is a decimal nobody chooses.
  ok("§1 the suggestion is always whole dollars",
     [100, 150, 175, 220, 999].every(d => F.upsellFor(cents(d)).monthlyCents % 100 === 0),
     [100, 150, 175, 220, 999].map(d => F.upsellFor(cents(d)).monthlyCents));
  ok("§1 a gift under the threshold is not asked",
     F.upsellFor(cents(99)).offer === false && F.upsellFor(cents(99)).why === "below_threshold");
  ok("§1 exactly AT the threshold IS asked", F.upsellFor(cents(100)).offer === true);
  // A MONTHLY DONOR IS NEVER UPSOLD — asking is the software not reading its page.
  ok("§1 somebody already giving monthly is never asked",
     F.upsellFor(cents(500), { frequency: "monthly" }).why === "already_recurring");
  ok("§1 a form with monthly switched off never asks",
     F.upsellFor(cents(500), { offerMonthly: false }).why === "monthly_not_offered");
  ok("§1 the org's own threshold is honoured",
     F.upsellFor(cents(100), { thresholdCents: cents(500) }).offer === false
     && F.upsellFor(cents(500), { thresholdCents: cents(500) }).offer === true);
  // The sentence states the arithmetic rather than selling it.
  const sent = F.upsellSentence(F.upsellFor(cents(150)), c => "$" + (c / 100).toFixed(0));
  ok("§1 the sentence gives the year's total and a reason", /\$600 over a year/.test(sent) && /plan/.test(sent), sent);
  ok("§1 …with no exclamation mark and no 'just'", !/!/.test(sent) && !/\bjust\b/.test(sent), sent);

  // ── FIXTURE: a configured form ──────────────────────────────────────────
  const page = await api("POST", "/giving-pages", tok, { title: "Give lessons", slug: "lessons" });
  const PAGE = page.body.id;
  const fixedPage = await api("POST", "/giving-pages", tok, { title: "Youth only", slug: "youth" });
  const FIXED = fixedPage.body.id;
  const onceOnlyPage = await api("POST", "/giving-pages", tok, { title: "One time only", slug: "once" });
  const ONCE = onceOnlyPage.body.id;
  ok("fixture three giving pages", page.status === 201 && fixedPage.status === 201 && onceOnlyPage.status === 201);

  await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: {
    amountsCents: [cents(25), cents(50), cents(100), cents(250)], allowOther: false,
    defaultFrequency: "once", offerMonthly: true,
    designation: { mode: "choice", fundIds: ["f_gen_s", "f_youth_s"] },
  } });
  await api("PUT", `/giving-pages/${FIXED}/form`, tok, { config: {
    amountsCents: [cents(40)], allowOther: true,
    designation: { mode: "fixed", fundId: "f_youth_s" },
  } });
  await api("PUT", `/giving-pages/${ONCE}/form`, tok, { config: {
    amountsCents: [cents(20)], allowOther: true, offerMonthly: false, defaultFrequency: "once",
  } });

  // The client may not send a total. The server derives it, and the suite checks
  // the arithmetic against the ONE formula rather than a hand-typed number.
  const grossUp = base => Math.ceil((base + 30) / (1 - 0.029));
  const donor = { firstName: "Mabel", lastName: "Fenwick", email: "mabel.b102@example.org" };
  const donate = (body, slug = "b102-step") => api("POST", `/donate/${slug}`, null, body);

  // ── §2 · A TAMPERED AMOUNT IS REFUSED ───────────────────────────────────
  console.log("\n— §2 · the form's own list is what may be charged —");
  const tampered = await donate({ ...donor, amount: 3.17, frequency: "once", givingPageId: PAGE, fundId: "f_gen_s" });
  ok("§2 an amount the form does not offer is refused",
     tampered.status === 400 && tampered.body.code === "amount_not_offered", [tampered.status, tampered.body]);
  ok("§2 …and the refusal NAMES what is on offer",
     Array.isArray(tampered.body.amountsCents) && tampered.body.amountsCents.includes(cents(50)),
     tampered.body.amountsCents);
  ok("§2 …in words a donor can act on",
     /Choose one of the amounts/.test(tampered.body.error), tampered.body.error);
  const allowed = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE, fundId: "f_gen_s" });
  ok("§2 an amount the form DOES offer goes through", allowed.status === 200, [allowed.status, allowed.body]);
  // AND THE SERVER'S PRICE IS WHAT STRIPE WAS TOLD — read off the body Stripe
  // received, not off what the page or this test believed.
  ok("§2 Stripe was asked for the server's price, in cents",
     lastCheckoutCents() === cents(50), [lastCheckoutCents(), cents(50)]);
  // A form that allows a typed amount takes one the list does not hold.
  const otherOk = await donate({ ...donor, amount: 63.50, frequency: "once", givingPageId: FIXED });
  ok("§2 a form that invites a typed amount accepts one", otherOk.status === 200, [otherOk.status, otherOk.body]);
  // The rule is in the SHARED module, not only the route.
  ok("§2 the rule lives in the shared module too",
     !F.checkRequestedAmount({ amountsCents: [cents(25)], allowOther: false }, 317).ok);
  // A page with NO form configured is unchanged — the old behaviour, untouched.
  const plainPage = await api("POST", "/giving-pages", tok, { title: "Plain", slug: "plain" });
  const anyAmount = await donate({ ...donor, amount: 3.17, frequency: "once", givingPageId: plainPage.body.id });
  ok("§2 a page nobody configured still takes any amount — unchanged",
     anyAmount.status === 200, [anyAmount.status, anyAmount.body]);

  // ── §3 · THE DESIGNATION IS THE FORM'S ──────────────────────────────────
  console.log("\n— §3 · which fund a gift goes to is the form's answer —");
  const fixedIgnores = F.resolveDesignation(
    { designation: { mode: "fixed", fundId: "f_youth_s" } }, "f_gen_s",
    { funds: [{ id: "f_gen_s" }, { id: "f_youth_s" }] });
  ok("§3 a fixed form ignores the fund the request asked for",
     fixedIgnores.fundId === "f_youth_s" && fixedIgnores.ignoredRequest === true, fixedIgnores);
  const outsider = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE, fundId: "f_them_s" });
  ok("§3 a choice form refuses a fund it does not offer — including another org's",
     outsider.status === 400 && outsider.body.code === "fund_not_offered", [outsider.status, outsider.body]);
  const ownButUnoffered = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE, fundId: "f_gen_s" });
  ok("§3 …and accepts one it does", ownButUnoffered.status === 200, ownButUnoffered.body);
  const unaskedFund = await donate({ ...donor, amount: 20, frequency: "once", givingPageId: ONCE, fundId: "f_gen_s" });
  ok("§3 a form that does not ask about funds refuses a fund in the request",
     unaskedFund.status === 400 && unaskedFund.body.code === "fund_not_offered", [unaskedFund.status, unaskedFund.body]);

  // ── §4 · A FREQUENCY THE FORM DOES NOT OFFER ────────────────────────────
  console.log("\n— §4 · a hand-rolled request cannot mint a subscription —");
  const sneakyMonthly = await donate({ ...donor, amount: 20, frequency: "monthly", givingPageId: ONCE });
  ok("§4 monthly through a one-time-only form is refused",
     sneakyMonthly.status === 400 && sneakyMonthly.body.code === "frequency_not_offered",
     [sneakyMonthly.status, sneakyMonthly.body]);
  const realMonthly = await donate({ ...donor, amount: 50, frequency: "monthly", givingPageId: PAGE, fundId: "f_gen_s" });
  ok("§4 monthly through a form that offers it goes through", realMonthly.status === 200, realMonthly.body);

  // ── §5 · COVER-FEES IS UNCHANGED ────────────────────────────────────────
  console.log("\n— §5 · BUILD-08's rule, untouched —");
  const covered = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE, fundId: "f_gen_s", coverFees: true });
  ok("§5 a covered gift goes through", covered.status === 200, covered.body);
  ok("§5 the gross-up formula is the documented card rate",
     grossUp(cents(50)) === 5181, grossUp(cents(50)));
  const clientLies = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE,
                                    fundId: "f_gen_s", coverFees: true, amountCents: 1 });
  ok("§5 a total the client invented changes nothing", clientLies.status === 200, clientLies.body);
  ok("§5 …and Stripe was asked for the GROSSED-UP figure the server derived",
     lastCheckoutCents() === grossUp(cents(50)), [lastCheckoutCents(), grossUp(cents(50))]);

  // ── §6 · THE ORG'S THRESHOLD ────────────────────────────────────────────
  console.log("\n— §6 · what counts as worth asking about is the org's number —");
  const setThreshold = await api("PATCH", `/orgs/${ORG}`, tok, { upsellThresholdCents: cents(250) });
  ok("§6 an admin can set it", setThreshold.status === 200, setThreshold.body);
  const pub = await api("GET", `/org/b102-step/giving-page/lessons/public`, null, null);
  ok("§6 the public page carries it, so the page asks the shared rule",
     pub.body.givingPage.upsellThresholdCents === cents(250), pub.body.givingPage.upsellThresholdCents);
  const zero = await api("PATCH", `/orgs/${ORG}`, tok, { upsellThresholdCents: 0 });
  ok("§6 a threshold of zero is refused — it would ask every single donor",
     zero.status === 400 && zero.body.code === "bad_upsell_threshold", [zero.status, zero.body]);
  const fractional = await api("PATCH", `/orgs/${ORG}`, tok, { upsellThresholdCents: 100.5 });
  ok("§6 a fractional number of cents is refused", fractional.status === 400, fractional.body);
  const cleared = await api("PATCH", `/orgs/${ORG}`, tok, { upsellThresholdCents: null });
  ok("§6 clearing it falls back to the default", cleared.status === 200
     && (await api("GET", `/org/b102-step/giving-page/lessons/public`, null, null))
          .body.givingPage.upsellThresholdCents === F.UPSELL_DEFAULT_THRESHOLD_CENTS);
  // AND THE PATCH TOUCHES NOTHING ELSE (the BUILD-95 no-clobber rule).
  const orgAfter = await q(`SELECT name, cover_fees_enabled, mission FROM orgs WHERE id=$1`, [ORG]);
  ok("§6 a threshold-only PATCH does not clobber the org's other settings",
     orgAfter[0].name === "Harbor Music School" && orgAfter[0].cover_fees_enabled === true, orgAfter[0]);

  // ── §7 · THE THREE STEPS, IN A BROWSER ──────────────────────────────────
  console.log("\n— §7 · three steps, and the upsell asked ONCE —");
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  // APP_URL, NEVER A LITERAL PORT — a hardcoded :4173 reaches another session's
  // stack, and a false red costs an hour (BUILD-100 paid it).
  const PREVIEW = (process.env.APP_URL || "").replace(/\/+$/, "");
  let previewUp = false;
  if (PREVIEW) { try { previewUp = (await fetch(PREVIEW + "/give/b102-step/lessons")).ok; } catch { previewUp = false; } }
  if (!chromium || !previewUp) {
    console.log(`— browser leg SKIPPED (playwright at ${PW_DIR}: ${chromium ? "found" : "MISSING"}; preview at ${PREVIEW || "APP_URL UNSET"}: ${previewUp ? "up" : "DOWN"}) —`);
    ok("§7 browser leg (environment)", false,
       "set APP_URL to this worktree's own preview and install playwright — a skipped leg is a red leg here");
  } else {
    await api("PATCH", `/orgs/${ORG}`, tok, { upsellThresholdCents: cents(100) });
    const browser = await chromium.launch();
    for (const [label, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport, hasTouch: label === "390", isMobile: label === "390" });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", e => errors.push(String(e)));
      await pg.goto(`${PREVIEW}/give/b102-step/lessons`, { waitUntil: "networkidle" });
      ok(`§7 ${label}: the step form renders`, await pg.locator(".give-steps").count() === 1,
         await pg.locator(".give-steps").count());
      ok(`§7 ${label}: no page error`, errors.length === 0, errors.slice(0, 2));
      // The form's own amounts, not the theme ladder.
      const amts = await pg.locator(".give-amt").evaluateAll(els => els.map(e => e.dataset.cents));
      ok(`§7 ${label}: the amounts are the FORM's`, amts.join(",") === "2500,5000,10000,25000", amts);
      // A form with allowOther:false offers no "another amount" link.
      ok(`§7 ${label}: a closed list offers no typed amount`, await pg.locator(".give-other").count() === 0);
      // STEP ONE ONLY. Nothing from step two is on the screen yet.
      ok(`§7 ${label}: the name fields are not on screen yet`, await pg.locator(".give-first").count() === 0);

      await pg.locator('.give-amt[data-cents="25000"]').click();
      await pg.locator(".give-fund").selectOption("f_gen_s");
      await pg.locator(".give-next").click();
      // $250 is over the $100 threshold, so the upsell is asked HERE.
      ok(`§7 ${label}: the upsell is asked once the amount clears the threshold`,
         await pg.locator(".give-upsell").count() === 1);
      ok(`§7 ${label}: …suggesting a third, in whole dollars`,
         /\$83 a month/.test(await pg.locator(".give-upsell").innerText()),
         await pg.locator(".give-upsell").innerText());
      await pg.locator(".give-upsell-no").click();
      ok(`§7 ${label}: declining moves on to the details`, await pg.locator(".give-first").count() === 1);

      // AND A DECLINE DOES NOT COME BACK. Go back, re-choose, continue.
      await pg.locator(".give-back").click();
      await pg.locator('.give-amt[data-cents="25000"]').click();
      await pg.locator(".give-next").click();
      ok(`§7 ${label}: THE UPSELL DOES NOT COME BACK on the same session`,
         await pg.locator(".give-upsell").count() === 0);
      ok(`§7 ${label}: …and it went straight to the details`, await pg.locator(".give-first").count() === 1);

      await pg.locator(".give-first").fill("Mabel");
      await pg.locator(".give-last").fill("Fenwick");
      await pg.locator(".give-email").fill("mabel.b102@example.org");
      await pg.locator(".give-next").click();
      ok(`§7 ${label}: step three is the payment step`, await pg.locator(".give-pay").count() === 1);
      const summaryText = await pg.locator(".give-summary").innerText();
      ok(`§7 ${label}: the summary states what will be charged`, /\$250/.test(summaryText), summaryText);
      ok(`§7 ${label}: NO CARD FIELD EXISTS ON THIS PAGE`,
         await pg.locator('input[autocomplete*="cc-"], input[name*="cardnumber"], iframe[name*="stripe"]').count() === 0);
      ok(`§7 ${label}: …and it says where payment happens`,
         /Stripe's secure page/.test(await pg.locator(".give-steps").innerText()));
      ok(`§7 ${label}: the trust line says who takes a cut`,
         /never holds or moves it/.test(await pg.locator(".give-trust").innerText()));
      // A RELOAD IS A NEW RENDER BUT THE SAME SESSION: still no second ask.
      await pg.reload({ waitUntil: "networkidle" });
      await pg.locator('.give-amt[data-cents="25000"]').click();
      await pg.locator(".give-fund").selectOption("f_gen_s");
      await pg.locator(".give-next").click();
      ok(`§7 ${label}: a reload does not resurrect the ask`, await pg.locator(".give-upsell").count() === 0);
      // No horizontal scroll at either width.
      const scrolls = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      ok(`§7 ${label}: the page does not scroll sideways`, scrolls === false);
      await ctx.close();
    }
    // AN UNCONFIGURED PAGE IS UNCHANGED — the single form, as it always was.
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${PREVIEW}/give/b102-step/plain`, { waitUntil: "networkidle" });
    ok("§7 a page nobody configured shows NO step form", await p2.locator(".give-steps").count() === 0);
    ok("§7 …and still shows the form it always had", await p2.locator("form").count() >= 1);
    await ctx2.close();
    await browser.close();
  }

  // ── §8 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §8 · a page belongs to one org —");
  const crossPage = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: PAGE }, "b102-step2");
  ok("§8 org B's slug cannot be charged through org A's page",
     crossPage.status === 400, [crossPage.status, crossPage.body]);
  const crossThreshold = await api("PATCH", `/orgs/${ORG}`, tok2, { upsellThresholdCents: cents(999) });
  ok("§8 org B cannot set org A's threshold", crossThreshold.status === 404, crossThreshold.status);
  ok("§8 …and org A's threshold is untouched",
     (await q(`SELECT form_upsell_threshold_cents AS t FROM orgs WHERE id=$1`, [ORG]))[0].t !== cents(999));

  if (smock) smock.close();
  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();
