// tests/fix36-history.test.js, FIX-36. OLD GIFTS READ FROM HISTORY NEVER START JOURNEYS.
//
//     A GIFT A HISTORY READ BRINGS IN STARTS A GIFT JOURNEY ONLY WHEN IT IS
//     DATED IN THE LAST 30 DAYS. IT IS RECORDED AND COUNTED EITHER WAY. A LIVE
//     GIFT IS NEVER HELD BACK.
//
// QuickBooks' first read pulls a year of gifts through recordGift. Before
// FIX-36 a check from forty days ago started a first-gift journey today, and a
// donor was thanked for a gift they made last season. That is email to a donor
// about their money, on the wrong date.
//
// WHAT IS ASSERTED, with a first-gift journey switched on:
//   §1  QuickBooks' first read (the QBO-IN stand-in, a year back): Ben's first
//       gift is 40 days old, so no journey; Ada's first gift is 10 days old,
//       so the journey starts. Ben's old gift gets no thank-you draft.
//   §2  a PayPal first read: the gift from 200 days ago starts nothing, the one
//       from 3 days ago starts the journey and gets a thank-you draft; the
//       summary carries the one line that says so
//   §3  a CSV import of an old gift starts nothing
//   §4  a live Stripe gift still starts the journey
//   §5  the old gifts still count: on the profile's lifetime figure and in the
//       Reports gift figure
//
// HOW IT WOULD GO RED: drop `history:` from either caller, or the
// `!oldHistory` gate in recordGift, and §1 or §2 starts a journey for an old
// gift. Run against main (before FIX-36): §1 and §2 are red.
//
// Standard scratch stack (tests/README.md) booted with TEST_MODE=1, plus the
// QuickBooks stand-in tests/qboin/standin.js starts.

const stripe = require("stripe")("sk_test_dummy");
const { ok, summary, login, api, q, closeDb, civilPlusDays } = require("./helpers");
const { ORG, ADMIN, A_CONTRIB, STUB_PORT, day, startStub, reset, company } = require("./qboin/standin");

const ACCT = "acct_fix36";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const DOMAIN = "fix36-history.org";

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

async function fireStripe(evtId, piId, cents, email, name) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: cents, receipt_email: email, metadata: { donor_name: name } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch((process.env.BASE || "http://localhost:5601") + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  console.log("FIX-36: old gifts read from history never start journeys\n");
  const stub = await startStub();
  ok("the QuickBooks stand-in is listening (without it this suite proves nothing)", !!stub, STUB_PORT);
  await wipe();
  await reset();
  await q(`UPDATE orgs SET stripe_account_id=$2 WHERE id=$1`, [ORG, ACCT]);
  const tok = await login(ADMIN);

  const j = await api("POST", "/journeys", tok, { name: "Welcome, first gift", trigger: "first_gift", enabled: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }] });
  ok("a first-gift journey is made and switched on", j.status === 201 && j.body?.enabled === true, j.body);
  const plansOf = async donorId => (await q(
    `SELECT id FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 AND template_id=$3`, [ORG, donorId, j.body.id])).length;
  const draftsOf = async donorId => (await q(
    `SELECT id FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId])).length;
  const donorByEmail = async email => (await q(`SELECT id, gift_count FROM donors WHERE org_id=$1 AND email=$2`, [ORG, email]))[0];

  // ── §1 · QUICKBOOKS' FIRST READ ────────────────────────────────────────
  await api("PUT", "/qbo/read/settings", tok, { from: day(-365), accounts: { [A_CONTRIB]: { name: "Contributed income" } } });
  const p1 = await api("POST", "/qbo/read/preview", tok, {});
  ok("§1 the first read opens a review", p1.status === 200 && p1.body?.status === "review", p1.body);
  ok("§1 the review says old gifts start nothing",
     p1.body?.historyNote === "Gifts older than 30 days won't start journeys or thank-yous.", p1.body?.historyNote);
  const sam = (p1.body?.ambiguous || [])[0], harbor = (p1.body?.unmatched || [])[0];
  const s1 = await api("POST", "/qbo/read/save", tok, { runId: p1.body?.runId,
    picks: { ...(sam ? { [sam.id]: "d_qi_sam2" } : {}), ...(harbor ? { [harbor.id]: "create" } : {}) } });
  ok("§1 the read saves", s1.status === 200 && s1.body?.recorded > 0, s1.body);
  const [ben] = await q(`SELECT gift_count FROM donors WHERE id='d_qi_ben'`);
  ok("§1 Ben's two gifts are both recorded (the 40-day-old one first)", ben && Number(ben.gift_count) === 2, ben);
  ok("§1 Ben's first gift is 40 days old: no first-gift journey", (await plansOf("d_qi_ben")) === 0, await plansOf("d_qi_ben"));
  // SEND-GATE-1: QuickBooks' read stamps its import id, and an import fires no trigger.
  ok("§1 Ada's first gift is 10 days old, from the QuickBooks read: no journey (SEND-GATE-1)", (await plansOf("d_qi_ada")) === 0, await plansOf("d_qi_ada"));
  const benOldDraft = await q(`SELECT t.id FROM thank_you_drafts t JOIN gifts g ON g.id=t.gift_id
                                WHERE t.org_id=$1 AND g.donor_id='d_qi_ben' AND g.date=$2`, [ORG, day(-40)]);
  ok("§1 Ben's 40-day-old gift opens no thank-you draft", benOldDraft.length === 0, benOldDraft);
  // SEND-GATE-1: only the FIRST read is an import. A later read brings new
  // gifts as they arrive, and a new first gift there starts its journey.
  await q(`INSERT INTO donors (id,org_id,name,email,person_types,auto_email) VALUES ('d_qi_nell',$1,'Nell Newgift','nell@example.org','["donor"]'::jsonb,true)`, [ORG]);
  await require("./helpers").mailTypesOn(ORG);   // SEND-GATE-2: the emails themselves are on, for chosen donors
  company.Customer.push({ Id: "7", DisplayName: "Nell Newgift", GivenName: "Nell", FamilyName: "Newgift", PrimaryEmailAddr: { Address: "nell@example.org" } });
  company.SalesReceipt.push({ Id: "199", TxnDate: day(-3), TotalAmt: 60, CustomerRef: { value: "7", name: "Nell Newgift" },
    PaymentMethodRef: { value: "2", name: "Check" }, PaymentRefNum: "1201",
    Line: [{ Id: "1", Amount: 60, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11", name: "Donation" } } }] });
  const p1b = await api("POST", "/qbo/read/preview", tok, {});
  const s1b = await api("POST", "/qbo/read/save", tok, { runId: p1b.body?.runId, picks: {} });
  ok("§1 a later read records Nell's new 3-day-old gift", s1b.status === 200 && s1b.body?.recorded === 1, s1b.body);
  ok("§1 …and, as new giving rather than an import, it starts her first-gift journey (SEND-GATE-1)", (await plansOf("d_qi_nell")) === 1, await plansOf("d_qi_nell"));

  // ── §2 · A PAYPAL FIRST READ ───────────────────────────────────────────
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status) VALUES ('gs_fix36',$1,'paypal','PayPal','active')`, [ORG]);
  const row = (id, daysAgo, who) => ({ externalId: id, occurredAt: civilPlusDays(-daysAgo), amountCents: 5000, feeCents: 175,
    currency: "USD", donorName: who, donorEmail: `${who.toLowerCase().split(" ")[0]}@${DOMAIN}`, recurringRef: null, status: "completed", memo: "" });
  const pp = await api("POST", "/giving-sources/gs_fix36/sync-fixture", tok,
    { rows: [row("PP-OLD-1", 200, "Pat Oldfield"), row("PP-NEW-1", 3, "Rae Newton")] });
  ok("§2 the PayPal first read records both gifts", pp.status === 200 && pp.body?.giftsCreated === 2, pp.body);
  ok("§2 the first read's summary says old gifts start nothing",
     pp.body?.historyNote === "Gifts older than 30 days won't start journeys or thank-yous.", pp.body?.historyNote);
  const pat = await donorByEmail(`pat@${DOMAIN}`), rae = await donorByEmail(`rae@${DOMAIN}`);
  ok("§2 Pat's 200-day-old gift: no journey, no thank-you draft",
     pat && (await plansOf(pat.id)) === 0 && (await draftsOf(pat.id)) === 0, pat);
  ok("§2 Rae's 3-day-old gift: the journey starts and a thank-you is drafted",
     rae && (await plansOf(rae.id)) === 1 && (await draftsOf(rae.id)) === 1, rae);

  // ── §3 · A CSV IMPORT ──────────────────────────────────────────────────
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Ivy Imported", email: `ivy@${DOMAIN}` }],
    gifts: [{ donorIndex: 0, amount: 120, date: civilPlusDays(-150), type: "cash", paymentMethod: "Check", externalId: "FIX36-IMP-1" }],
  });
  ok("§3 the import records the gift", imp.status === 200 && imp.body?.giftsInserted === 1, imp.body);
  const ivy = await donorByEmail(`ivy@${DOMAIN}`);
  ok("§3 the imported 150-day-old gift starts no journey", ivy && (await plansOf(ivy.id)) === 0, ivy);

  // ── §4 · A LIVE STRIPE GIFT ────────────────────────────────────────────
  const wh = await fireStripe("evt_fix36_1", "pi_fix36_1", 4000, `lee@${DOMAIN}`, "Lee Live");
  ok("§4 a live Stripe gift is recorded", wh.status === 200, wh);
  const lee = await donorByEmail(`lee@${DOMAIN}`);
  ok("§4 …and still starts the first-gift journey", lee && (await plansOf(lee.id)) === 1, lee);

  // ── §5 · OLD GIFTS STILL COUNT ─────────────────────────────────────────
  const life = await api("GET", "/figures/donor-lifetime/rows?donor=d_qi_ben", tok);
  ok("§5 Ben's profile lifetime figure includes the 40-day-old gift",
     life.status === 200 && (life.body?.rows || []).some(r => String(r.date).slice(0, 10) === day(-40) && Number(r.amount) === 100), life.body);
  const rep = await api("GET", `/figures/gifts/rows?from=${civilPlusDays(-365)}&to=${civilPlusDays(0)}&donor=${pat && pat.id}`, tok);
  ok("§5 the Reports gift figure counts Pat's 200-day-old PayPal gift",
     rep.status === 200 && (rep.body?.rows || []).length === 1 && Number(rep.body.rows[0].amount) === 50, rep.body);

  stub.close();
  await wipe();
  await closeDb();
  summary();
})().catch(async e => { ok("ran to the end", false, e.stack || e.message); await closeDb().catch(() => {}); summary(); });
