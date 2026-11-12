// tests/sales3-close.test.js · SALES-3 Part A: a quote on a deal, its private link, Accept and
// sign, billing that starts on the start day and not before, and Today and the forecast.
// One section per numbered item (§1–§4).
//
// THE PLANTED DEFECTS (set SALES3_PLANT on the SERVER and on THIS process, with TEST_MODE=1;
// each turns its section red):
//   noreason     a quote below list with no reason saves                         → §1
//   otherquote   one quote's link opens another quote                            → §2
//   chargeearly  accepting makes a subscription with no trial_end (bills today)  → §3
//
// "No charge before the start date" is a statement about what Stripe was ASKED: the platform
// billing Stripe here is a local mock (sk_test_dummy) that records every request, so the test
// reads the subscription Steward created and every call that could move money.
// Made-up fixtures only. Nothing is emailed by a quote. The suite sets its own clock.
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE, BILLING_MOCK_PORT } = require("./helpers");
const { testNow } = require("./clock");
const QUOTES = require("../server/admin/sales/quotes");
const { firstChargeAt } = require("../server/onboard/startLink");

const PLANT = process.env.SALES3_PLANT || "";
const SECRET = "whsec_localtest";
const stripeLib = require("stripe")("sk_test_dummy");
const PASS = "loadtest1234";
const HOME = "org_sales3home", PILOT = "org_sales3pilot";
const SUPER = "sales3-super@example.org";
const TZ = "America/New_York";
const DAY = 86400000;
const civil = t => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const plusDays = n => civil(testNow() + n * DAY);
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);
const raw = async (method, path, body, headers = {}) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, text: await r.text(), json() { try { return JSON.parse(this.text); } catch { return {}; } } }; };

// ── The billing Stripe mock: answers, and remembers every request ──
const seen = [];
function billingMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        const form = new URLSearchParams(b);
        seen.push({ method: req.method, url: req.url, form });
        res.setHeader("Content-Type", "application/json");
        const send = o => res.end(JSON.stringify(o));
        const u = req.url.split("?")[0];
        if (req.method === "POST" && u === "/v1/customers") return send({ id: "cus_sales3_" + seen.length, object: "customer" });
        if (req.method === "POST" && /^\/v1\/customers\//.test(u)) return send({ id: u.split("/")[3], object: "customer" });
        if (req.method === "GET" && /^\/v1\/prices\//.test(u)) return send({ id: u.split("/")[3], object: "price", product: "prod_test_steward", unit_amount: 29900, currency: "usd", recurring: { interval: "month", interval_count: 1 } });
        if (req.method === "POST" && u === "/v1/subscriptions") {
          const te = form.get("trial_end");
          return send({ id: "sub_sales3_" + seen.length, object: "subscription", status: te ? "trialing" : "active", trial_end: te ? Number(te) : null, metadata: {} });
        }
        if (req.method === "POST" && /^\/v1\/subscriptions\//.test(u)) return send({ id: u.split("/")[3], object: "subscription", status: "trialing" });
        if (req.method === "POST" && u === "/v1/invoiceitems") return send({ id: "ii_sales3_" + seen.length, object: "invoiceitem" });
        if (req.method === "POST" && u === "/v1/checkout/sessions") return send({ id: "cs_test_sales3_" + seen.length, object: "checkout.session", url: "https://checkout.stripe.test/sales3" });
        if (req.method === "GET" && /^\/v1\/setup_intents\//.test(u)) return send({ id: "seti_sales3", object: "setup_intent", payment_method: { id: "pm_sales3", card: { brand: "visa", last4: "4242" } } });
        res.statusCode = 404; send({ error: { message: "mock: " + req.method + " " + req.url } });
      });
    });
    srv.listen(BILLING_MOCK_PORT, () => resolve(srv));
  });
}
async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return fetch(BASE + "/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
}
// Every request that could move money today.
const moneyMoves = from => seen.slice(from).filter(r => r.method === "POST" && (/^\/v1\/(payment_intents|charges)/.test(r.url) || /^\/v1\/invoices\/[^/]+\/pay/.test(r.url)
  || (r.url.startsWith("/v1/subscriptions") && !r.form.get("trial_end") && r.url === "/v1/subscriptions")));

async function wipeOrg(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function wipeSales() {
  const t = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  for (const x of t) await q(`DELETE FROM "${x}"`);
}
const stageOf = async dealId => (await q(`SELECT s.name, d.value_cents FROM sales_deals d JOIN sales_stages s ON s.id = d.stage_id WHERE d.id = $1`, [dealId]))[0];

(async () => {
  await wipeSales();
  for (const o of [HOME, PILOT]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id = 'u_sales3_super'`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales3 Home','sales3-home',1,'active','team')`, [HOME]);
  // The pilot: a beta org with no subscription yet (made-up).
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Quillfeather Animal Haven','sales3-pilot',1,'beta','r2500_monthly','America/New_York')`, [PILOT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales3_super',$1,$2,$3,'Close Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER);
  const mock = await billingMock();

  // Fixtures: a prospect linked to the pilot org, and one with no Steward org.
  const orgA = (await S(sup, "POST", "/rec/org", { name: "Quillfeather Animal Haven", domain: "quillfeather.sales3.example.org" })).body.id;
  await S(sup, "POST", `/orgs/${orgA}/steward`, { stewardOrgId: PILOT });
  const contactA = (await S(sup, "POST", "/rec/contact", { first_name: "Rowena", last_name: "Ashdown", emails: ["rowena@quillfeather.sales3.example.org"], links: [{ type: "org", id: orgA }] })).body.id;
  const dealA = (await S(sup, "POST", "/rec/deal", { name: "Quillfeather Animal Haven", links: [{ type: "org", id: orgA, primary: true }, { type: "contact", id: contactA }] })).body.id;
  const orgB = (await S(sup, "POST", "/rec/org", { name: "Tarnwick Choir Society" })).body.id;
  const dealB = (await S(sup, "POST", "/rec/deal", { name: "Tarnwick Choir Society", links: [{ type: "org", id: orgB, primary: true }] })).body.id;

  // ── §1 · A QUOTE ON THE DEAL ──────────────────────────────────────────────────────
  // HOW IT GOES RED (SALES3_PLANT=noreason): $250 under a $299 list saves with no reason.
  const meta = (await S(sup, "GET", `/deals/${dealA}/quotes`)).body;
  const bundle = meta.plans.plans.find(p => p.key === "bundle");
  ok("§1 the plans start with the public $299 bundle and CRM alone; billing starts Jan 1, 2027 by default",
    bundle && bundle.listCents === 29900 && meta.plans.plans.some(p => p.key === "crm") && meta.defaultStart === "2027-01-01", meta.plans);
  const start = plusDays(10);
  const noReason = await S(sup, "POST", `/deals/${dealA}/quotes`, { plan: "bundle", price: "250", start_on: start });
  ok("§1 a price below list with no reason is refused, and says why", noReason.status === 400 && noReason.body.field === "reason" && /below the list price of \$299/.test(noReason.body.message || ""), noReason.body);
  ok("§1 …and nothing was saved", (await q(`SELECT COUNT(*)::int AS n FROM sales_quotes WHERE deal_id = $1`, [dealA]))[0].n === 0);
  const v1 = await S(sup, "POST", `/deals/${dealA}/quotes`, { plan: "bundle", price: "275", reason: "beta", start_on: start });
  const v2 = await S(sup, "POST", `/deals/${dealA}/quotes`, { plan: "bundle", price: "250", reason: "family pricing", start_on: start, setup_fee: "150" });
  const vs = (await S(sup, "GET", `/deals/${dealA}/quotes`)).body.quotes;
  ok("§1 each save is a new version; the newer one replaces the older", v1.status === 201 && v2.status === 201 && vs.length === 2 && vs[0].version === 2 && vs[0].state === "draft" && vs[1].state === "superseded", vs.map(x => [x.version, x.state]));
  ok("§1 the version keeps the plan, price, reason, start, setup fee and term", vs[0].price_cents === 25000 && vs[0].list_cents === 29900 && vs[0].below_list_reason === "family pricing"
    && vs[0].start_on === start && vs[0].setup_fee_cents === 15000 && vs[0].term === "month_to_month" && vs[0].created_by_name === "Close Super", vs[0]);
  const tooSoon = await S(sup, "POST", `/deals/${dealB}/quotes`, { plan: "crm", start_on: plusDays(1) });
  ok("§1 a start day under three days away is refused (Stripe can't hold it)", tooSoon.status === 400 && tooSoon.body.field === "start_on", tooSoon.body);
  ok("§1 the deal's value doesn't move until a quote is accepted", Number((await stageOf(dealA)).value_cents || 0) === 0);

  // ── §2 · THE PRIVATE LINK ─────────────────────────────────────────────────────────
  // HOW IT GOES RED (SALES3_PLANT=otherquote): A's link opens B's quote, the newest made.
  const qA = vs[0].id;
  const linkA = await S(sup, "POST", `/quotes/${qA}/link`, {});
  const tokA = linkA.body.token;
  const qB = (await S(sup, "POST", `/deals/${dealB}/quotes`, { plan: "crm", start_on: plusDays(40) })).body.id;
  const tokB = (await S(sup, "POST", `/quotes/${qB}/link`, {})).body.token;
  ok("§2 Copy link makes a long random link; only its fingerprint is kept", linkA.status === 201 && /^[A-Za-z0-9_-]{40,}$/.test(tokA) && linkA.body.path === `/quote/${tokA}`
    && !JSON.stringify(await q(`SELECT * FROM sales_quotes`)).includes(tokA), linkA.body);
  const pageA = await raw("GET", `/public/quote/${tokA}`);
  const pa = pageA.json();
  ok("§2 the page shows the org's name, the plan, the price, the start day and what's included", pageA.status === 200 && pa.orgName === "Quillfeather Animal Haven" && pa.priceCents === 25000
    && pa.startOn === start && pa.plan === bundle.name && pa.includes.length === bundle.includes.length && pa.setupFeeCents === 15000, pa);
  ok("§2 …with the customer agreement, and the hash of exactly what's shown", /Steward Customer Agreement/.test(pa.agreement && pa.agreement.text) && pa.agreement.sha256 === crypto.createHash("sha256").update(pa.agreement.text, "utf8").digest("hex"));
  ok("§2 A's link shows A's quote only: never B's org, price or the reason kept below list", !/Tarnwick|family pricing/.test(pageA.text) && pa.priceCents !== 29900 - 10000, pageA.text.slice(0, 300));
  const pageB = (await raw("GET", `/public/quote/${tokB}`)).json();
  ok("§2 B's link shows B's", pageB.orgName === "Tarnwick Choir Society" && pageB.priceCents === 19900, pageB);
  const bad = await raw("GET", `/public/quote/${"x".repeat(43)}`);
  ok("§2 a made-up token is a 404 that names nothing", bad.status === 404 && !/Quillfeather|Tarnwick/.test(bad.text));
  // A new link turns the old one off; an expired one says so.
  const tokA2 = (await S(sup, "POST", `/quotes/${qA}/link`, {})).body.token;
  const oldA = await raw("GET", `/public/quote/${tokA}`);
  ok("§2 making a new link turns the old one off", oldA.status === 404 && (await raw("GET", `/public/quote/${tokA2}`)).status === 200, oldA.status);
  await q(`UPDATE sales_quotes SET expires_at = $2 WHERE id = $1`, [qB, new Date(testNow() - 60000).toISOString()]);
  const expB = await raw("GET", `/public/quote/${tokB}`);
  ok("§2 after 30 days the link has expired and shows nothing of the quote", expB.status === 410 && /expired/.test(expB.json().message) && !/Tarnwick/.test(expB.text), expB.text);
  const lA = (await q(`SELECT link_made_at, expires_at FROM sales_quotes WHERE id = $1`, [qA]))[0];
  ok("§2 a link lives 30 days", Math.round((new Date(lA.expires_at) - new Date(lA.link_made_at)) / DAY) === 30, lA);

  // ── §3 · ACCEPTED MEANS SET UP; NO CHARGE BEFORE THE START DAY ────────────────────
  // HOW IT GOES RED (SALES3_PLANT=chargeearly): the subscription has no trial_end, so it bills today.
  const pa2 = (await raw("GET", `/public/quote/${tokA2}`)).json();
  const stale = await raw("POST", `/public/quote/${tokA2}/accept`, { name: "Rowena Ashdown", title: "Executive Director", agree: true, sha256: "0".repeat(64) });
  ok("§3 a signature on text other than what's shown is refused", stale.status === 409, stale.text);
  const noTitle = await raw("POST", `/public/quote/${tokA2}/accept`, { name: "Rowena Ashdown", agree: true, sha256: pa2.agreement.sha256 });
  const noTick = await raw("POST", `/public/quote/${tokA2}/accept`, { name: "Rowena Ashdown", title: "Executive Director", sha256: pa2.agreement.sha256 });
  ok("§3 a title and the tick are both required", noTitle.status === 400 && noTick.status === 400 && noTick.json().field === "agree");
  const before = seen.length;
  const acc = await raw("POST", `/public/quote/${tokA2}/accept`, { name: "Rowena Ashdown", title: "Executive Director", agree: true, sha256: pa2.agreement.sha256 });
  const ab = acc.json();
  ok("§3 Accept and sign answers with what happens next", acc.status === 200 && /Nothing is charged today\. Billing starts .* at \$250 a month, with the \$150 setup fee on that first charge\./.test(ab.confirmation || ""), acc.text);
  const sq = (await q(`SELECT status, signer_name, signer_title, signer_ip, accepted_at, pdf, stripe_subscription_id, billing_starts_at, billing_error FROM sales_quotes WHERE id = $1`, [qA]))[0];
  ok("§3 the signature keeps the typed name, title, time and IP", sq.status === "accepted" && sq.signer_name === "Rowena Ashdown" && sq.signer_title === "Executive Director" && !!sq.accepted_at && !!sq.signer_ip, sq);
  ok("§3 the signed agreement is kept as a PDF on the deal", sq.pdf && Buffer.from(sq.pdf).slice(0, 5).toString() === "%PDF-");
  const pdf = await fetch(`${BASE}/ops/sales/quotes/${qA}/pdf`, { headers: { Authorization: `Bearer ${sup}` } });
  ok("§3 …and opens from the deal", pdf.status === 200 && /application\/pdf/.test(pdf.headers.get("content-type") || ""));
  const sig = (await q(`SELECT org_id, signer_name, price_cents, first_charge_at, text_sha256 FROM start_signatures WHERE start_link_id = $1`, [qA]))[0];
  const startAt = firstChargeAt({ charge_mode: "fixed", first_charge_on: start }, 0, TZ);
  ok("§3 …and on the org: Settings → Billing's signed agreement", sig && sig.org_id === PILOT && sig.price_cents === 25000 && new Date(sig.first_charge_at).getTime() === startAt.getTime() && sig.text_sha256 === pa2.agreement.sha256, sig);
  const st = await stageOf(dealA);
  ok("§3 the deal moves to Trial (a Steward org is linked) and its value is the quote's price", st.name === "Trial" && Number(st.value_cents) === 25000, st);
  const subReq = seen.slice(before).find(r => r.method === "POST" && r.url === "/v1/subscriptions");
  ok("§3 the subscription is scheduled: trial_end is noon on the start day in the org's zone", subReq && Number(subReq.form.get("trial_end")) === Math.floor(startAt.getTime() / 1000),
    subReq ? subReq.form.get("trial_end") : "no subscription request");
  ok("§3 …at the agreed price, monthly", subReq && subReq.form.get("items[0][price_data][unit_amount]") === "25000" && subReq.form.get("items[0][price_data][recurring][interval]") === "month");
  ok("§3 NO CHARGE BEFORE THE START DAY: nothing asked of Stripe moves money today", moneyMoves(before).length === 0 && !!subReq && !!subReq.form.get("trial_end"), moneyMoves(before).map(r => r.url));
  const ii = seen.slice(before).find(r => r.method === "POST" && r.url === "/v1/invoiceitems");
  ok("§3 the setup fee waits for the first real invoice (an item on the subscription, never add_invoice_items)", ii && ii.form.get("amount") === "15000" && ii.form.get("subscription") === sq.stripe_subscription_id
    && ![...subReq.form.keys()].some(k => /add_invoice_items/.test(k)), ii && Object.fromEntries(ii.form));
  const org = (await q(`SELECT subscription_status, trial_ends_at, stripe_subscription_id, custom_price_cents, paper_done_at FROM orgs WHERE id = $1`, [PILOT]))[0];
  ok("§3 the org bills from the start day at the agreed price", org.subscription_status === "trialing" && new Date(org.trial_ends_at).getTime() === startAt.getTime() && org.stripe_subscription_id === sq.stripe_subscription_id && org.custom_price_cents === 25000, org);
  ok("§3 paper is signature AND card: signed, no card yet, so the gate waits", org.paper_done_at === null);
  const after = await raw("GET", `/public/quote/${tokA2}`);
  ok("§3 after acceptance the link shows the confirmation only, not the quote", after.status === 200 && after.json().state === "accepted" && !after.json().agreement && after.json().canAddCard === true, after.text.slice(0, 300));
  const again = await raw("POST", `/public/quote/${tokA2}/accept`, { name: "Someone Else", title: "Board", agree: true, sha256: pa2.agreement.sha256 });
  ok("§3 a second signature is refused", again.status === 410 && (await q(`SELECT signer_name FROM sales_quotes WHERE id = $1`, [qA]))[0].signer_name === "Rowena Ashdown");
  const newVer = await S(sup, "POST", `/deals/${dealA}/quotes`, { plan: "bundle", start_on: start });
  ok("§3 an accepted quote is settled: no new version", newVer.status === 400);
  // The card step: Checkout in setup mode (a SetupIntent), then Stripe's word.
  const b2 = seen.length;
  const card = await raw("POST", `/public/quote/${tokA2}/card`, {});
  const cs = seen.slice(b2).find(r => r.method === "POST" && r.url === "/v1/checkout/sessions");
  ok("§3 Add a card is Stripe Checkout in setup mode on the org's customer: no price, no charge", card.status === 200 && cs && cs.form.get("mode") === "setup" && !cs.form.get("line_items[0][price]")
    && cs.form.get("metadata[salesQuoteId]") === qA, cs && Object.fromEntries(cs.form));
  const cust = (await q(`SELECT COALESCE(stripe_customer_id_test, stripe_customer_id) AS c FROM orgs WHERE id = $1`, [PILOT]))[0].c;
  await fireBilling("evt_sales3_card", "checkout.session.completed", { id: "cs_test_sales3_done", object: "checkout.session", mode: "setup", customer: cust,
    setup_intent: "seti_sales3", metadata: { salesQuoteId: qA, orgId: PILOT } });
  const org2 = (await q(`SELECT paper_done_at, billing_card_last4 FROM orgs WHERE id = $1`, [PILOT]))[0];
  ok("§3 with the card in, ONBOARD-2's paper gate is met", !!org2.paper_done_at && org2.billing_card_last4 === "4242", org2);
  ok("§3 the card becomes the subscription's, still with no charge", seen.slice(b2).some(r => r.url === `/v1/subscriptions/${sq.stripe_subscription_id}` && r.form.get("default_payment_method") === "pm_sales3")
    && moneyMoves(b2).length === 0);
  // A deal with no Steward org: Verbal yes, and words for why nothing is scheduled.
  await q(`UPDATE sales_quotes SET expires_at = $2 WHERE id = $1`, [qB, new Date(testNow() + 20 * DAY).toISOString()]);
  const pb = (await raw("GET", `/public/quote/${tokB}`)).json();
  const b3 = seen.length;
  await raw("POST", `/public/quote/${tokB}/accept`, { name: "Piers Lowther", title: "Chair", agree: true, sha256: pb.agreement.sha256 });
  const stB = await stageOf(dealB);
  const qBrow = (await q(`SELECT billing_error FROM sales_quotes WHERE id = $1`, [qB]))[0];
  ok("§3 with no Steward org linked: Verbal yes, nothing asked of Stripe, and it says why", stB.name === "Verbal yes" && seen.length === b3 && /No Steward org is linked/.test(qBrow.billing_error || ""), [stB, qBrow]);

  // ── §4 · TODAY AND THE FORECAST READ IT ───────────────────────────────────────────
  const dealC = (await S(sup, "POST", "/rec/deal", { name: "Brackenmoor Food Shelf" })).body.id;
  const qC = (await S(sup, "POST", `/deals/${dealC}/quotes`, { plan: "crm", start_on: plusDays(45) })).body.id;
  await S(sup, "POST", `/quotes/${qC}/link`, {});
  await q(`UPDATE sales_quotes SET link_made_at = $2 WHERE id = $1`, [qC, new Date(testNow() - 6 * DAY).toISOString()]);
  const dealD = (await S(sup, "POST", "/rec/deal", { name: "Fenwhistle Literacy" })).body.id;
  const qD = (await S(sup, "POST", `/deals/${dealD}/quotes`, { plan: "crm", start_on: plusDays(45) })).body.id;
  await S(sup, "POST", `/quotes/${qD}/link`, {});
  await q(`UPDATE sales_quotes SET link_made_at = $2 WHERE id = $1`, [qD, new Date(testNow() - 4 * DAY).toISOString()]);
  const home = (await S(sup, "GET", "/home")).body;
  const bs = home.today.lines.billingStarts || [], qu = home.today.lines.quoteUnsigned || [];
  ok("§4 Today: 'billing starts in 10 days' for the signed quote, opening its deal", bs.some(l => l.says === "Quillfeather Animal Haven: billing starts in 10 days ($250 a month)" && l.open.id === dealA), bs);
  ok("§4 …and not for a signed quote starting later than 14 days out", !bs.some(l => l.open.id === dealB));
  ok("§4 Today: 'quote sent 6 days ago, not signed'; a 4-day-old one isn't there yet", qu.some(l => l.says === "Brackenmoor Food Shelf: quote sent 6 days ago, not signed" && l.open.id === dealC) && !qu.some(l => l.open.id === dealD), qu);
  ok("§4 each line carries its sentence", /Nothing is charged before that day/.test(home.today.sentences.billingStarts) && /not signed/.test(home.today.sentences.quoteUnsigned));
  const fc = home.forecast;
  const startMonth = start.slice(0, 7), bMonth = plusDays(40).slice(0, 7);
  const mA = fc.months.find(m => m.month === startMonth), mB = fc.months.find(m => m.month === bMonth);
  ok("§4 the forecast counts signed quotes in full at their price, from the month billing starts", fc.signedCents === 25000 + 19900 && fc.signedDeals === 2
    && mA && mA.signedStartingCents >= 25000 && (startMonth === bMonth ? mA.signedStartingCents === 44900 : (mB && mB.signedStartingCents === 19900)), { signed: fc.signedCents, months: fc.months.map(m => [m.month, m.signedStartingCents]) });
  ok("§4 …and a signed deal is not also in the weighted pipeline", fc.weightedCents === 0, fc.weightedCents);
  ok("§4 the signed figure carries its sentence", /accepted quote/.test(fc.sentences.signed));
  // The line's day count, by hand, at the edge: billing tomorrow and today.
  const lines = QUOTES.todayLines([{ status: "accepted", deal_id: "d1", deal_name: "Edge", price_cents: 100, start_on: civil(testNow() + DAY) },
    { status: "accepted", deal_id: "d2", deal_name: "Gone", price_cents: 100, start_on: civil(testNow() - DAY) }], testNow(), TZ);
  ok("§4 a start tomorrow reads 'tomorrow'; one already gone isn't a line", lines.billingStarts.length === 1 && /billing starts tomorrow/.test(lines.billingStarts[0].says), lines.billingStarts);

  await new Promise(r => mock.close(r));
  await wipeSales();
  for (const o of [HOME, PILOT]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id = 'u_sales3_super'`);
  await closeDb();
  summary();
  if (PLANT) console.log(`(planted: ${PLANT})`);
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
