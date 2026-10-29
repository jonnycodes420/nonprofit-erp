// PRICING-1 — RECORD-BANDED PRICING, THE SETUP FEE, AND A PRICE THAT NEVER
// MOVES ON ITS OWN.
//
// Replaces gtm1b-band-notice (the GTM-1b band rules it guarded are the ones
// this build changed). It guards money: what an org is charged at signup, when
// its monthly starts, and that growing past a band never changes a price
// without the owner's yes.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · a prospect, volunteer or contact with no gift counted       → §1
//   · a band edge off by one (`<` for `<=`)                       → §2
//   · the setup fee missing from Checkout, or on it twice          → §3
//   · the first invoice (it carries the setup fee) ending the trial → §3
//   · a note after ONE month over                                  → §4
//   · a price that moves without the owner's yes                   → §4
//   · a custom-price org measured or moved                         → §5
//
//   §1  the count is people with at least one gift
//   §2  every band edge picks the right price and setup fee
//   §3  signup charges the setup fee once and the monthly starts on the first charge date
//   §4  one month over changes nothing; two months sends a note; the price moves only with a yes
//   §5  a custom-price org is never moved
//
// Run on the scratch stack: BASE, DATABASE_URL, and the shard server env in
// tests/shard.sh (the twelve STRIPE_PRICE_R* test ids, the billing mock seam).

const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, BILLING_MOCK_PORT } = require("./helpers");
const PRICING = require("../pricing");
const { computeTrialEnd } = require("../trialEnd");
const { testNow } = require("./clock");

const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const ORG = "org_p1bands", CUSTOM = "org_p1custom";
const ADMIN = "p1-admin@t.local", CUST_ADMIN = "p1-custom@t.local", PW = "loadtest1234";
const SIGNUP = n => `p1-signup-${n}@pricing1.test`;
const DAY = 86400000;

// ── the platform-billing Stripe mock ───────────────────────────────────────
// Every test price id answers with its own amount from pricing.json; it
// records Checkout sessions and subscription updates (a price move).
const sessions = [], updates = [];
let SUB = null;
function priceFor(id) {
  const m = String(id).match(/^price_test_r(\d+)([mys])$/);
  if (!m) return null;
  const t = PRICING.tierById("r" + m[1]);
  const usd = m[2] === "m" ? t.monthlyUsd : m[2] === "y" ? t.yearlyUsd : t.setupUsd;
  return { id, object: "price", unit_amount: usd * 100, currency: "usd",
    recurring: m[2] === "s" ? null : { interval: m[2] === "y" ? "year" : "month", interval_count: 1 } };
}
function startMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const form = new URLSearchParams(b);
          const id = "cs_test_p1_" + (sessions.length + 1);
          sessions.push({ id, form });
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        const cs = req.url.match(/^\/v1\/checkout\/sessions\/([^/?]+)/);
        if (req.method === "GET" && cs) return res.end(JSON.stringify({ id: cs[1], object: "checkout.session", status: "complete", subscription: SUB && SUB.id, customer: "cus_p1" }));
        const sub = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (sub && req.method === "POST") { updates.push({ id: sub[1], form: new URLSearchParams(b) }); return res.end(JSON.stringify({ ...SUB, id: sub[1] })); }
        if (sub && req.method === "GET") return res.end(JSON.stringify({ ...SUB, id: sub[1] }));
        const pr = req.url.match(/^\/v1\/prices\/([^/?]+)/);
        if (req.method === "GET" && pr) {
          const p = priceFor(pr[1]);
          if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: "resource_missing", message: "No such price", param: "price" } })); }
          return res.end(JSON.stringify(p));
        }
        if (req.method === "GET" && /^\/v1\/(payment_methods|customers)/.test(req.url))
          return res.end(JSON.stringify({ id: "pm_p1", object: "payment_method", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }));
        if (req.method === "POST" && /^\/v1\/customers/.test(req.url)) return res.end(JSON.stringify({ id: "cus_p1", object: "customer" }));
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
      });
    });
    srv.listen(BILLING_MOCK_PORT, () => resolve(srv));
  });
}
async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(BASE + "/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

async function wipeOrg(o) {
  for (const t of ["interactions", "gifts", "donors", "users", "org_record_months", "platform_payments"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
}
async function reset() {
  for (const o of [ORG, CUSTOM]) await wipeOrg(o);
  const made = await q(`SELECT org_id FROM close_links WHERE contact_email LIKE '%@pricing1.test'`).catch(() => []);
  for (const r of made) if (r.org_id) {
    for (const t of ["accounts", "fin_funds", "workflows"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await wipeOrg(r.org_id);
  }
  await q(`DELETE FROM terms_acceptances WHERE email LIKE '%@pricing1.test'`).catch(() => {});
  await q(`DELETE FROM close_links WHERE contact_email LIKE '%@pricing1.test'`).catch(() => {});
  await q(`DELETE FROM billing_webhook_events WHERE event_id LIKE 'evt_p1_%'`).catch(() => {});
}

async function addPerson(org, id, { gifts = 0, deleted = false, types = null } = {}) {
  await q(`INSERT INTO donors (id,org_id,name,total_giving,deleted_at${types ? ",person_types" : ""}) VALUES ($1,$2,$3,0,$4${types ? ",$5" : ""})`,
    [id, org, "Person " + id, deleted ? new Date(testNow()).toISOString() : null, ...(types ? [JSON.stringify(types)] : [])]);
  for (let i = 0; i < gifts; i++) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,25,'2019-03-01','system:test','test')`,
      [`g_${id}_${i}`, org, id]);
  }
}
// N people with one gift each, in one statement.
async function addGivers(org, prefix, n) {
  await q(`INSERT INTO donors (id,org_id,name,total_giving) SELECT $2 || g, $1, 'Giver ' || g, 25 FROM generate_series(1,$3::int) g`, [org, prefix, n]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
           SELECT 'g_' || $2 || g, $1, $2 || g, 25, '2026-01-10', 'system:test', 'test' FROM generate_series(1,$3::int) g`, [org, prefix, n]);
}
const orgRow = async id => (await q(`SELECT plan, subscription_status, trial_ends_at, tier_notice_band, tier_notice_effective_at,
    tier_notice_agreed_at, setup_fee_cents, setup_fee_paid_at, custom_price_cents FROM orgs WHERE id=$1`, [id]))[0];

(async () => {
  await reset();
  const mock = await startMock();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id,current_period_end)
           VALUES ($1,'Bands Test','p1-bands',1,'active','r500_monthly','sub_p1_bands',$2)`, [ORG, new Date(testNow() + 20 * DAY).toISOString()]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_p1_admin',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, hash]);
  const admin = await login(ADMIN);

  console.log("— §1 · the count is people with at least one gift —");
  await addPerson(ORG, "d_gave", { gifts: 1 });
  await addPerson(ORG, "d_gave_many", { gifts: 4 });
  await addPerson(ORG, "d_prospect", { types: ["prospect"] });
  await addPerson(ORG, "d_volunteer", { types: ["volunteer"] });
  await addPerson(ORG, "d_contact", {});
  await addPerson(ORG, "d_deleted", { gifts: 1, deleted: true });
  let r = await api("GET", "/billing/donor-band?recount=1&at=2026-07-15T12:00:00Z", admin);
  ok("a giver counts once however many gifts; a prospect, a volunteer, a contact and a deleted giver never count",
    r.status === 200 && r.body.count === 2, `count=${r.body.count}`);
  ok("…and the sentence that defines it travels with it", r.body.sentence === PRICING.RECORD_SENTENCE, r.body.sentence);
  const st = await api("GET", "/billing/status", admin);
  ok("Billing shows the same count and how it is counted", st.body.records === 2 && st.body.recordSentence === PRICING.RECORD_SENTENCE
    && st.body.band && st.body.band.label === "Up to 500 records" && st.body.priceUsd === 199, st.body);

  console.log("\n— §2 · every band edge picks the right price and setup fee —");
  const agr = (await api("GET", "/public/agreement")).body;
  const EDGES = [[500, "r500", 199, 250], [501, "r2500", 299, 500], [2500, "r2500", 299, 500], [2501, "r10000", 449, 1000],
                 [10000, "r10000", 449, 1000], [10001, "r25000", 649, 1500], [25000, "r25000", 649, 1500]];
  for (const [n, band, monthly, setup] of EDGES) {
    const before = sessions.length;
    const su = await api("POST", "/public/signup", null, { orgName: "Edge " + n, contactName: "Ed Edge", contactEmail: SIGNUP(n),
      estimatedRecords: n, interval: "monthly", acceptTerms: true, termsVersion: agr.version });
    const s = sessions[before];
    ok(`${n.toLocaleString("en-US")} records: ${band}, $${monthly}/month, $${setup} setup`,
      su.status === 202 && su.body.tier === band && su.body.amountUsd === monthly && su.body.setupUsd === setup
      && s && s.form.get("line_items[0][price]") === `price_test_${band}m` && s.form.get("line_items[1][price]") === `price_test_${band}s`,
      { status: su.status, body: su.body, items: s && [s.form.get("line_items[0][price]"), s.form.get("line_items[1][price]")] });
  }
  const over = await api("POST", "/public/signup", null, { orgName: "Edge 25001", contactName: "Ed Edge", contactEmail: SIGNUP(25001),
    estimatedRecords: 25001, interval: "monthly", acceptTerms: true, termsVersion: agr.version });
  ok("25,001 records: talk to us, no checkout and no price", over.status === 409 && over.body.error === "talk_to_us", over.body);
  const yr = await api("POST", "/public/signup", null, { orgName: "Edge yearly", contactName: "Ed Edge", contactEmail: SIGNUP("y"),
    estimatedRecords: 2500, interval: "yearly", acceptTerms: true, termsVersion: agr.version });
  ok("yearly is ten times monthly ($2,990) with the same setup fee", yr.status === 202 && yr.body.amountUsd === 2990 && yr.body.setupUsd === 500, yr.body);

  console.log("\n— §3 · signup charges the setup fee once and the monthly starts on the first charge date —");
  const signedAt = testNow();
  const before = sessions.length;
  const su = await api("POST", "/public/signup", null, { orgName: "Lantern House", contactName: "Lena Lantern", contactEmail: SIGNUP("lantern"),
    estimatedRecords: 300, interval: "monthly", acceptTerms: true, termsVersion: agr.version });
  const sess = sessions[before];
  const items = [...sess.form.keys()].filter(k => /^line_items\[\d+\]\[price\]$/.test(k)).map(k => sess.form.get(k));
  ok("Checkout carries the monthly price and the setup fee, the setup fee exactly once",
    su.status === 202 && items.length === 2 && items.filter(p => p === "price_test_r500s").length === 1 && items.includes("price_test_r500m"), items);
  ok("the monthly waits thirty days: the subscription starts in a 30-day trial", sess.form.get("subscription_data[trial_period_days]") === "30",
    sess.form.get("subscription_data[trial_period_days]"));
  const firstCharge = computeTrialEnd(signedAt);
  const dateWords = firstCharge.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  ok("the sentence above the button says today's setup fee and the first charge date",
    /setup fee of \$250/.test(sess.form.get("custom_text[submit][message]")) && sess.form.get("custom_text[submit][message]").includes(dateWords),
    sess.form.get("custom_text[submit][message]"));

  const trialEnd = Math.floor(firstCharge.getTime() / 1000);
  SUB = { id: "sub_p1_lantern", object: "subscription", status: "trialing", trial_start: Math.floor(signedAt / 1000), trial_end: trialEnd,
    current_period_end: trialEnd, customer: "cus_p1", items: { data: [{ id: "si_p1", price: { id: "price_test_r500m", recurring: { interval: "month" }, unit_amount: 19900 } }] },
    metadata: { closeLinkId: sess.form.get("metadata[closeLinkId]"), plan: "r500_monthly" } };
  const completed = { id: sess.id, object: "checkout.session", status: "complete", payment_status: "paid", amount_total: 25000,
    customer: "cus_p1", subscription: SUB.id, customer_details: { email: SIGNUP("lantern"), name: "Lena Lantern" },
    metadata: { closeLinkId: sess.form.get("metadata[closeLinkId]"), plan: "r500_monthly", setupFeeUsd: "250",
      orgName: "Lantern House", contactEmail: SIGNUP("lantern") } };
  ok("Checkout completes", (await fireBilling("evt_p1_done", "checkout.session.completed", completed)) === 200);
  const link = (await q(`SELECT org_id FROM close_links WHERE stripe_session_id=$1`, [sess.id]))[0];
  const born = link && link.org_id && await orgRow(link.org_id);
  ok("the org is born on its band, in its thirty days, with the setup fee recorded once",
    born && born.plan === "r500_monthly" && born.subscription_status === "trialing" && born.setup_fee_cents === 25000 && !!born.setup_fee_paid_at, born);
  ok("…and its first charge date is the trial end Stripe holds",
    born && Math.abs(new Date(born.trial_ends_at).getTime() - trialEnd * 1000) < 2000, born && born.trial_ends_at);
  // The first invoice carries the setup fee. It is not the first monthly charge.
  await fireBilling("evt_p1_inv1", "invoice.payment_succeeded", { id: "in_p1_setup", object: "invoice", customer: "cus_p1", subscription: SUB.id,
    billing_reason: "subscription_create", amount_paid: 25000, status_transitions: { paid_at: Math.floor(signedAt / 1000) },
    lines: { data: [{ amount: 25000, price: { id: "price_test_r500s" }, period: { start: Math.floor(signedAt / 1000), end: Math.floor(signedAt / 1000) } },
                    { amount: 0, price: { id: "price_test_r500m", recurring: { interval: "month" } }, period: { start: Math.floor(signedAt / 1000), end: trialEnd } }] },
    metadata: { orgId: link.org_id } });
  // Read BEFORE anything else touches the org: a later completion re-reads
  // the subscription and would put a wrongly flipped status back.
  const afterInv = await orgRow(link.org_id);
  ok("paying the setup fee does not start the monthly: still trialing, the same first charge date",
    afterInv.subscription_status === "trialing" && Math.abs(new Date(afterInv.trial_ends_at).getTime() - trialEnd * 1000) < 2000, afterInv);
  // A redelivered completion (a new event id, the same session) must not record it again.
  const paidAt = born && born.setup_fee_paid_at;
  await fireBilling("evt_p1_done_again", "checkout.session.completed", completed);
  const after = await orgRow(link.org_id);
  const orgs = await q(`SELECT COUNT(*)::int AS n FROM close_links WHERE stripe_session_id=$1 AND org_id IS NOT NULL`, [sess.id]);
  ok("a second completion is still one org and one setup fee, paid at the same moment",
    orgs[0].n === 1 && after.setup_fee_cents === 25000 && new Date(after.setup_fee_paid_at).getTime() === new Date(paidAt).getTime(), after);

  console.log("\n— §4 · one month over changes nothing; two months sends a note; the price moves only with a yes —");
  await addGivers(ORG, "dp_", 499);    // 2 + 499 = 501, one over the first band
  const upd0 = updates.length;
  r = await api("GET", "/billing/donor-band?recount=1&at=2026-08-15T12:00:00Z", admin);
  let row = await orgRow(ORG);
  ok("August, 501 records: over, one month, no note", r.body.count === 501 && r.body.over === true && r.body.monthsOver === 1 && !r.body.noted
    && !row.tier_notice_band && row.plan === "r500_monthly", { body: r.body, row });
  r = await api("GET", "/billing/donor-band?recount=1&at=2026-09-15T12:00:00Z", admin);
  row = await orgRow(ORG);
  ok("September, still over: two months running, the note goes out for the next band",
    r.body.noted === true && r.body.monthsOver === 2 && row.tier_notice_band === "r2500", { body: r.body, row });
  ok("…the change waits at least thirty days", new Date(row.tier_notice_effective_at).getTime() - Date.parse("2026-09-15T12:00:00Z") >= 30 * DAY - 1000,
    row.tier_notice_effective_at);
  ok("…and the price has not moved", row.plan === "r500_monthly" && updates.length === upd0, { plan: row.plan, updates: updates.length - upd0 });
  r = await api("POST", "/billing/band/apply-now", admin, { at: new Date(new Date(row.tier_notice_effective_at).getTime() + 5 * DAY).toISOString() });
  row = await orgRow(ORG);
  ok("after the notice period, without the owner's yes, nothing moves", r.status === 200 && r.body.up.length === 0
    && row.plan === "r500_monthly" && updates.length === upd0, { body: r.body, plan: row.plan });
  const st2 = await api("GET", "/billing/status", admin);
  ok("Billing shows the note, the next band's price and the date", st2.body.notice && st2.body.notice.band === "r2500" && st2.body.notice.monthlyUsd === 299
    && !st2.body.notice.agreedAt, st2.body.notice);
  r = await api("POST", "/billing/band/agree", admin);
  ok("the owner says yes", r.status === 200, r.body);
  r = await api("POST", "/billing/band/apply-now", admin, { at: new Date(Date.parse("2026-09-15T12:00:00Z") + 10 * DAY).toISOString() });
  row = await orgRow(ORG);
  ok("…a yes does not move it before the notice period ends", r.body.up.length === 0 && row.plan === "r500_monthly", { body: r.body, plan: row.plan });
  SUB = { id: "sub_p1_bands", status: "active", items: { data: [{ id: "si_bands", price: { id: "price_test_r500m", recurring: { interval: "month" } } }] } };
  r = await api("POST", "/billing/band/apply-now", admin, { at: new Date(new Date(row.tier_notice_effective_at).getTime() + DAY).toISOString() });
  row = await orgRow(ORG);
  const up = updates[updates.length - 1];
  ok("with the yes and after the date, the subscription moves to the next band's price, unprorated",
    r.body.up.length === 1 && row.plan === "r2500_monthly" && up && up.form.get("items[0][price]") === "price_test_r2500m"
    && up.form.get("proration_behavior") === "none", { body: r.body, plan: row.plan, sent: up && Object.fromEntries(up.form) });

  console.log("\n— §5 · a custom-price org is never moved —");
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id,custom_price_cents,custom_price_ends_on)
           VALUES ($1,'Custom Deal','p1-custom',1,'active','r500_monthly','sub_p1_custom',14900,'2027-06-30')`, [CUSTOM]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_p1_cust',$1,$2,$3,'Admin','admin')`, [CUSTOM, CUST_ADMIN, hash]);
  const custAdmin = await login(CUST_ADMIN);
  await addGivers(CUSTOM, "dc_", 900);
  const upd1 = updates.length;
  const c1 = await api("GET", "/billing/donor-band?recount=1&at=2026-08-15T12:00:00Z", custAdmin);
  const c2 = await api("GET", "/billing/donor-band?recount=1&at=2026-09-15T12:00:00Z", custAdmin);
  await q(`UPDATE orgs SET tier_notice_band='r2500', tier_notice_effective_at='2026-01-01', tier_notice_agreed_at=NOW() WHERE id=$1`, [CUSTOM]);
  const c3 = await api("POST", "/billing/band/apply-now", custAdmin, { at: "2026-12-01T12:00:00Z" });
  const crow = await orgRow(CUSTOM);
  ok("900 records on a $149 custom price: never measured against a band",
    c1.body.checked === false && c1.body.reason === "custom_price" && c2.body.reason === "custom_price", { c1: c1.body, c2: c2.body });
  ok("…and never moved, even with a notice and a yes on file", c3.body.up.length === 0 && crow.plan === "r500_monthly"
    && crow.custom_price_cents === 14900 && updates.length === upd1, { body: c3.body, row: crow });
  const cst = await api("GET", "/billing/status", custAdmin);
  ok("Billing shows the agreed price and its end date", cst.body.customPrice && cst.body.customPrice.usd === 149
    && String(cst.body.customPrice.endsOn).startsWith("2027-06-30"), cst.body.customPrice);

  await reset();
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
