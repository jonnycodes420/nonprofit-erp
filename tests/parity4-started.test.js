// PARITY-4 Part 2 · TEST 1: A GIFT STARTED AND NOT FINISHED.
//
// Money and donor mail, so it earns its place: a Checkout session that expires
// with an email on it becomes exactly one "started, not finished" row (and a
// re-delivered event does not make two); a later gift by the same email closes
// it and links the gift; nothing is ever emailed without a person pressing
// Send, a note goes at most once per person per form and never to someone who
// gave since; and the month's total foots to its rows to the cent.
const bcrypt = require("bcryptjs");
const http = require("http");
const Stripe = require("stripe");
const { ok, summary, q, closeDb, login, api, BASE, SINK_PORT } = require("./helpers");

const ORG = "org_p4gs", ACCT = "acct_p4gs", ADMIN = "director@p4gs.local";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const mail = [];
const startSink = () => new Promise(resolve => {
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { mail.push(JSON.parse(b)); } catch {} res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
  });
  srv.on("error", () => resolve(null));
  srv.listen(SINK_PORT, () => resolve(srv));
});
const mailTo = to => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return (await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload })).status;
}
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));
const expired = (id, sid, md, cents) => ({ id, type: "checkout.session.expired", account: ACCT,
  data: { object: { id: sid, object: "checkout.session", status: "expired", amount_total: cents, created: Math.floor(Date.now() / 1000) - 7200,
                    customer_email: md.donor_email, metadata: { org_id: ORG, ...md } } } });
const startsFor = email => q(`SELECT * FROM gift_starts WHERE org_id=$1 AND LOWER(email)=LOWER($2)`, [ORG, email]);

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

(async () => {
  console.log("parity4-started");
  const sink = await startSink();
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id,stripe_connected)
           VALUES ($1,'Started Org','p4gs',1,'active','team','America/New_York',$2,true)`, [ORG, ACCT]);
  // MAIL-1: an org that has onboarded (its donor file is in); without it nothing sends.
  await q("UPDATE orgs SET onboarded_at=NOW() WHERE id=$1", [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_p4gs',$1,$2,$3,'Dana Director','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_p4gs',$1,'General',false)`, [ORG]);
  const tok = await login(ADMIN);

  // §1 An expired session with an email → one row, and a re-delivery is still one.
  const A = "ada@p4gs.test", B = "bo@p4gs.test";
  ok("§1 the expired-session event is accepted", (await fire(expired("evt_p4gs_1", "cs_p4gs_1", { donor_email: A, donor_name: "Ada Lane", frequency: "once" }, 5000))) === 200);
  await fire(expired("evt_p4gs_1", "cs_p4gs_1", { donor_email: A, donor_name: "Ada Lane", frequency: "once" }, 5000));
  await fire(expired("evt_p4gs_1b", "cs_p4gs_1", { donor_email: A, donor_name: "Ada Lane", frequency: "once" }, 5000));
  await settle();
  let rows = await startsFor(A);
  ok("§1 exactly ONE started-not-finished row, however often the event comes", rows.length === 1, rows.length);
  ok("§1 …with the amount, the name and the time it expired", rows[0] && rows[0].amount === "50.00" && rows[0].first_name === "Ada" && rows[0].expired_at, rows[0]);
  // A purchase is not a gift: an expired auction payment writes nothing.
  await fire(expired("evt_p4gs_2", "cs_p4gs_2", { donor_email: "bid@p4gs.test", auction_item_id: "ai_x", auction_bid_id: "ab_x" }, 9000));
  await fire(expired("evt_p4gs_3", "cs_p4gs_3", { donor_email: B, donor_name: "Bo Reed", frequency: "once" }, 2500));
  await settle();
  ok("§1 an expired auction payment is not a started gift", (await startsFor("bid@p4gs.test")).length === 0);

  // §2 The month's total foots to its rows, to the cent.
  const list = await api("GET", "/gift-starts", tok);
  const m = list.body.month;
  ok("§2 the month counts both, at the amounts chosen ($75.00)", list.status === 200 && m.count === 2 && Math.round(m.total * 100) === 7500, m);
  const fig = await api("GET", `/figures/gifts-not-finished/rows?from=${m.from}&to=${m.to}`, tok);
  const footed = (fig.body.rows || []).reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0);
  ok("§2 the figure's rows foot to the total on screen to the cent", fig.status === 200 && fig.body.cents === 7500 && footed === 7500, { cents: fig.body.cents, footed });

  // §3 Nothing is emailed without a person.
  ok("§3 recording, expiring and listing sent nothing to anyone", mailTo(A).length === 0 && mailTo(B).length === 0, mail.length);
  const draft = await api("GET", `/gift-starts/${rows[0].id}/draft`, tok);
  ok("§3 the draft is words on a screen, with the form link, and still nothing sent", draft.status === 200 && /didn't go through/.test(draft.body.body) && mailTo(A).length === 0);

  // §4 A later gift by the same email closes the row and links the gift.
  await fire({ id: "evt_p4gs_pi", type: "payment_intent.succeeded", account: ACCT,
               data: { object: { id: "pi_p4gs_1", amount_received: 5000, receipt_email: A, metadata: { donor_name: "Ada Lane", donor_email: A } } } });
  await settle(900);
  const [gift] = await q(`SELECT g.id FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND LOWER(d.email)=LOWER($2)`, [ORG, A]);
  const after = await api("GET", "/gift-starts", tok);
  const adaRow = (after.body.rows || []).find(r => r.email === A);
  ok("§4 the gift was recorded", !!gift);
  ok("§4 the row closes and links that gift", adaRow && adaRow.status === "finished" && gift && adaRow.giftId === gift.id, adaRow);
  ok("§4 the month's total drops to Bo's $25.00 alone", after.body.month.count === 1 && Math.round(after.body.month.total * 100) === 2500, after.body.month);
  const toAda = await api("POST", `/gift-starts/${rows[0].id}/send`, tok, { subject: "x", body: "y" });
  ok("§4 a note to someone who gave since is refused, and nothing is sent", toAda.status === 409 && toAda.body.error === "gave_since" && mailTo(A).length === 0, toAda.body);

  // §5 A person sends a note once; a second is refused.
  const [bo] = await startsFor(B);
  const s1 = await api("POST", `/gift-starts/${bo.id}/send`, tok, { subject: "Your gift", body: "It looks like your gift didn't go through." });
  await settle();
  ok("§5 the admin's press sends exactly one note", s1.status === 201 && mailTo(B).length === 1, { status: s1.status, body: s1.body, n: mailTo(B).length });
  await fire(expired("evt_p4gs_4", "cs_p4gs_4", { donor_email: B, donor_name: "Bo Reed", frequency: "once" }, 2500));
  await settle();
  const again = (await startsFor(B)).find(r => r.id !== bo.id);
  const s2 = again ? await api("POST", `/gift-starts/${again.id}/send`, tok, { subject: "Your gift", body: "Again" }) : { status: 0 };
  await settle();
  ok("§5 a second note to the same person for the same form is refused", s2.status === 409 && mailTo(B).length === 1, { status: s2.status, n: mailTo(B).length });

  await wipe();
  if (sink) sink.close();
  await closeDb();
  summary("parity4-started");
})().catch(e => { console.error(e); process.exit(1); });
