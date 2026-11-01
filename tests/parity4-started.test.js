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
// ARCH-1: when the session started. "Two hours ago" left the org's month at
// New York's evening on the last day of a month: at 02:04Z on 1 Nov (22:04 on
// 31 Oct in New York) it was 00:04Z on 1 Nov, outside October on a UTC
// database, and §2 read 0 (CI run 41260326197). The start is now inside the
// org's today on both clocks: no earlier than its midnight, and no later than 18:00
// in New York, which is still the same UTC date in summer and in winter.
const { testNow, startOfDay } = require("./clock");
const startedAt = () => { const sod = startOfDay(testNow()); return Math.min(Math.max(testNow() - 7200e3, sod), sod + 18 * 3600e3); };
const expired = (id, sid, md, cents) => ({ id, type: "checkout.session.expired", account: ACCT,
  data: { object: { id: sid, object: "checkout.session", status: "expired", amount_total: cents, created: Math.floor(startedAt() / 1000),
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
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id,stripe_connected,emails_enabled,staff_mail_enabled)
           VALUES ($1,'Started Org','p4gs',1,'active','team','America/New_York',$2,true,true,NULL)`, [ORG, ACCT]);
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

  // §6 THE ORG'S MIDNIGHT, NOT THE DATABASE'S (ARCH-1). A start is counted on
  // the New York day it happened, whatever zone the database runs in (UTC on
  // prod and CI). Red on main: the figure cut each day at the database's
  // midnight, so 10:30 PM in New York on the last day of a month counted in
  // the next month. The fixtures are fixed instants, so this holds at any hour.
  const { civilDay } = require("./clock");
  const NY = "America/New_York";
  // The instant that reads hh:mm on `civil` in New York (EDT -4 or EST -5).
  const nyAt = (civil, hh, mm) => {
    for (const off of [4, 5]) {
      const t = Date.UTC(+civil.slice(0, 4), +civil.slice(5, 7) - 1, +civil.slice(8, 10), hh + off, mm);
      const f = new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
      if (f.replace(",", "") === `${civil} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) return new Date(t).toISOString();
    }
    throw new Error("no such New York time: " + civil);
  };
  const plant = (id, email, at) => q(`INSERT INTO gift_starts (id, org_id, email, amount, started_at, expired_at, created_by, created_by_name)
                                      VALUES ($1, $2, $3, 10, $4, $4, 'system:test', 'test')`, [id, ORG, email, at]);
  const rowsFor = async (from, to) => (await api("GET", `/figures/gifts-not-finished/rows?from=${from}&to=${to}`, tok)).body || {};
  const today6 = civilDay();
  const [ty, tm] = today6.split("-").map(Number);
  const lmY = tm === 1 ? ty - 1 : ty, lmM = tm === 1 ? 12 : tm - 1;
  const lmLast = new Date(Date.UTC(lmY, lmM, 0)).getUTCDate();
  const lm = { from: `${lmY}-${String(lmM).padStart(2, "0")}-01`, to: `${lmY}-${String(lmM).padStart(2, "0")}-${String(lmLast).padStart(2, "0")}` };
  const lateAt = nyAt(lm.to, 22, 30);   // 10:30 PM New York on last month's last day: already tomorrow in UTC
  await plant("gs_p4gs_late", "late@p4gs.test", lateAt);
  const lmRows = await rowsFor(lm.from, lm.to);
  const late = (lmRows.rows || []).find(r => r.id === "gs_p4gs_late");
  ok(`§6 a start at 10:30 PM New York on ${lm.to} counts in that month, not the next (${lateAt})`, !!late, (lmRows.rows || []).map(r => r.id));
  ok("§6 …and its row is dated that New York day", !!late && String(late.date).slice(0, 10) === lm.to, late);
  const now6 = (await api("GET", "/gift-starts", tok)).body || {};
  const nowRows = await rowsFor(now6.month.from, now6.month.to);
  ok("§6 this month's figure does not count last month's late start", !(nowRows.rows || []).some(r => r.id === "gs_p4gs_late"), (nowRows.rows || []).map(r => r.id));
  ok(`§6 this month is the org's month (${today6.slice(0, 7)}), from its 1st to its last day`,
     now6.month.from === `${today6.slice(0, 7)}-01` && now6.month.to.slice(0, 7) === today6.slice(0, 7) && now6.month.to >= today6, now6.month);
  const close6 = (await api("GET", "/finance/month-close", tok)).body || {};
  const cFrom = close6.from || (close6.month && close6.month.from), cTo = close6.to || (close6.month && close6.month.to);
  ok(`§6 last month is the org's last month (${lm.from} to ${lm.to}), on the month close`, cFrom === lm.from && cTo === lm.to, { cFrom, cTo });
  // The clock change (1 Nov 2026, 2 AM EDT → 1 AM EST): 1 Nov is a 25-hour
  // day from 04:00Z to 05:00Z on 2 Nov. A fixed -4h would put the 23:30 EST
  // start on 2 Nov, and a fixed -5h would put the 23:30 EDT start on 1 Nov.
  await plant("gs_p4gs_dst_a", "dst-a@p4gs.test", "2026-11-01T03:30:00Z");   // 23:30 EDT, 31 Oct
  await plant("gs_p4gs_dst_b", "dst-b@p4gs.test", "2026-11-01T04:30:00Z");   // 00:30 EDT, 1 Nov
  await plant("gs_p4gs_dst_c", "dst-c@p4gs.test", "2026-11-02T04:30:00Z");   // 23:30 EST, 1 Nov
  await plant("gs_p4gs_dst_d", "dst-d@p4gs.test", "2026-11-02T05:30:00Z");   // 00:30 EST, 2 Nov
  const dst = ((await rowsFor("2026-11-01", "2026-11-01")).rows || []).map(r => r.id).filter(id => /dst/.test(id)).sort();
  ok("§6 across the clock change, 1 Nov holds exactly its own two starts", dst.join() === "gs_p4gs_dst_b,gs_p4gs_dst_c", dst);

  await wipe();
  if (sink) sink.close();
  await closeDb();
  summary("parity4-started");
})().catch(e => { console.error(e); process.exit(1); });
