// BUILD-88b B.3 — THANK-YOUS, DRAFTED. Run: node tests/build88b-thankyous.test.js
//
// **Steward never sends the thank-you.** It writes one, she reads it, she
// copies it, and it leaves from her own mail where she can see it as the donor
// will. That is the whole design, and the last assertion in this file is the
// one that matters: across every path in this suite, the send layer receives
// nothing.
//
//   §1  a gift through EVERY door earns exactly one draft
//   §2  the four exclusions, each a case where a thank-you would be WRONG
//   §3  her voice, from three samples — and one plain sentence until they exist
//   §4  Copy, Mark sent, Skip, and "Mark all as sent" only after every draft
//       has been OPENED
//   §5  marking one sent logs a conversation, so the Thread cycle runs
//   §6  Steward sends nothing, and the receipt path is untouched
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_b88bt";
const ACCT = "acct_b88bt";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const c = n => Math.round(Number(n) * 100);

let captured = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", x => (b += x));
  req.on("end", () => { try { captured.push({ path: req.url, body: b ? JSON.parse(b) : null }); } catch { }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"mock"}'); });
});
const mails = () => captured.filter(e => e.path === "/emails");

async function fireWebhook(evtId, piId, amountCents, email, name) {
  const payload = JSON.stringify({ id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: amountCents, receipt_email: email, metadata: { donor_name: name } } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const CHILD = ["thank_you_drafts", "pledge_installments", "threads", "digest_sends", "notification_sends",
  "workflow_runs", "workflows", "moves", "opportunities", "tasks", "receipts", "pledges", "fin_audit_log",
  "metric_snapshots", "imports", "recurring_subscriptions", "fundraising_goals", "fin_transactions",
  "gifts", "interactions", "donors", "campaigns", "budgets", "accounts", "fin_funds", "users"];

const SAMPLES = [
  "Dear Anna,\n\nThank you so much for the gift. It means a great deal to the families we work with, and to me personally.\n\nWith gratitude,\nAda",
  "Dear Bill,\n\nYour cheque arrived this morning and I wanted to say thank you straight away. The roof is nearly finished.\n\nWith gratitude,\nAda",
  "Dear Sara,\n\nThank you for standing with us again this year. It matters a great deal more than you probably know.\n\nWith gratitude,\nAda",
];

(async () => {
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id)
           VALUES ($1,'Sparrow Missions','b88b-ty',1,'active','team','America/New_York',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88bt',$1,'b88bt@t.local',$2,'Ada Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ('acct4010_b88bt',$1,'4010','Contributions','revenue','contributions',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88bt',$1,'General Operating',false),('ffx_b88bt',$1,'Xenia Mission Trip',true)`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id='ff_b88bt' WHERE id=$1`, [ORG]);
  const tok = await login("b88bt@t.local");
  const TODAY = civilToday();

  const people = [["ok1", "Margaret Chen", {}], ["ok2", "William Park", {}], ["ok3", "Diana Torres", {}],
                  ["anon", "Anonymous", { kind: "anonymous" }],
                  ["dnc", "Nora Nocontact", { do_not_contact: true }],
                  ["dec", "Elias Gone", { deceased: true }],
                  ["pl", "Priya Pledge", {}]];
  for (const [key, name, f] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name,kind,deceased,do_not_contact)
             VALUES ($1,$2,$3,$4,'new','steward','u_b88bt','Ada Admin',$5,$6,$7)`,
      [`dty_${key}`, ORG, name, `${key}@b88bt.test`, f.kind || null, !!f.deceased, !!f.do_not_contact]);
  }

  // ── §3a · before her voice exists ────────────────────────────────────────
  console.log("\n— §3 · one plain sentence until her voice exists —");
  const g0 = await api("POST", "/donors/dty_ok1/gifts", tok, { amount: 250, date: TODAY, type: "cash", paymentMethod: "Check", fundId: "ffx_b88bt" });
  ok("a gift records", g0.status === 201 || g0.status === 200, g0.status);
  let queue = (await api("GET", "/thank-yous", tok)).body;
  ok("it earns a draft", queue.count === 1, queue.count);
  const plain = queue.drafts[0];
  ok("…which is ONE plain sentence, naming the donor, the amount and the fund",
    plain.voiceUsed === "default" && /^Thank you for your gift of \$250 to Xenia Mission Trip\./.test(plain.body)
    && !/^Dear /.test(plain.body), plain.body);
  ok("…and Steward says how many samples it still needs, rather than inventing a voice",
    queue.voice.ready === false && queue.voice.needs === 3, queue.voice);

  // ── §3b · her voice ──────────────────────────────────────────────────────
  const setVoice = await api("PUT", "/org/voice-samples", tok, { samples: SAMPLES });
  ok("three samples are enough", setVoice.status === 200 && setVoice.body.ready === true && setVoice.body.samples === 3, setVoice.body);
  ok("…and Steward took her greeting and her sign-off, and says which",
    setVoice.body.greeting === "Dear Anna," && setVoice.body.signoff === "With gratitude" && setVoice.body.signature === "Ada", setVoice.body);
  const tooFew = await api("PUT", "/org/voice-samples", tok, { samples: [SAMPLES[0], "too short"] });
  ok("two is not three — and a scrap is not a sample", tooFew.body.ready === false && tooFew.body.samples === 1, tooFew.body);
  await api("PUT", "/org/voice-samples", tok, { samples: SAMPLES });

  // ── §1 · every door ──────────────────────────────────────────────────────
  console.log("\n— §1 · a gift through every door earns exactly one draft —");
  const wh = await fireWebhook("evt_b88bt_1", "pi_b88bt_1", 7500, "ok2@b88bt.test", "William Park");
  ok("a STRIPE gift records", wh.status === 200 && !wh.body.duplicate, wh.body);
  const dep = await api("POST", "/deposits/commit", tok,
    { paste: "Diana Torres\t120.00\tGeneral Operating", depositDate: TODAY, slipTotal: 120 });
  ok("a DEPOSIT gift records", dep.status === 201 && dep.body.gifts === 1, dep.body);
  queue = (await api("GET", "/thank-yous", tok)).body;
  const byName = Object.fromEntries(queue.drafts.map(d => [d.donorName, d]));
  ok("the Stripe gift earned EXACTLY ONE draft",
    queue.drafts.filter(d => d.donorName === "William Park").length === 1, queue.drafts.map(d => d.donorName));
  ok("the deposit gift earned EXACTLY ONE draft",
    queue.drafts.filter(d => d.donorName === "Diana Torres").length === 1, queue.drafts.map(d => d.donorName));
  ok("…and both are in HER voice now",
    /^Dear William,/m.test(byName["William Park"].body) && /With gratitude,\nAda/.test(byName["William Park"].body)
    && byName["William Park"].voiceUsed === "org_samples", byName["William Park"].body);
  ok("the headline spells the count under ten", /^Three thank-yous ready\.$/.test(queue.headline), queue.headline);
  // Re-firing the same Stripe event changes nothing.
  await fireWebhook("evt_b88bt_1", "pi_b88bt_1", 7500, "ok2@b88bt.test", "William Park");
  const q2 = (await api("GET", "/thank-yous", tok)).body;
  ok("a redelivered Stripe event does not queue a second letter", q2.count === 3, q2.count);

  // ── §2 · the four exclusions ─────────────────────────────────────────────
  console.log("\n— §2 · the four exclusions, each a case where a letter would be WRONG —");
  await api("POST", "/donors/dty_anon/gifts", tok, { amount: 500, date: TODAY, type: "cash", paymentMethod: "Cash" });
  await api("POST", "/donors/dty_dnc/gifts", tok, { amount: 500, date: TODAY, type: "cash", paymentMethod: "Check" });
  await api("POST", "/donors/dty_dec/gifts", tok, { amount: 500, date: TODAY, type: "cash", paymentMethod: "Check" });
  const q3 = (await api("GET", "/thank-yous", tok)).body;
  const names = q3.drafts.map(d => d.donorName);
  ok("ANONYMOUS earns none — there is nobody to write to", !names.includes("Anonymous"), names);
  ok("DO-NOT-CONTACT earns none", !names.includes("Nora Nocontact"), names);
  ok("DECEASED earns none", !names.includes("Elias Gone"), names);
  ok("…and the three gifts still landed, in full", q3.count === 3, q3.count);
  const [allGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("…every one of them: a letter nobody should get is not a gift nobody got", allGifts.n === 6, allGifts.n);
  // A small pledge payment: she thanked them for the pledge.
  const pl = await api("POST", "/donors/dty_pl/pledges", tok, { amount: 600, dueDate: TODAY, frequency: "monthly", installmentCount: 12 });
  ok("a twelve-instalment pledge of $50 a month", (pl.body.installments || []).length === 12, (pl.body.installments || []).length);
  await api("POST", "/donors/dty_pl/gifts", tok, { amount: 50, date: TODAY, type: "cash", paymentMethod: "Check" });
  const q4 = (await api("GET", "/thank-yous", tok)).body;
  ok("A SMALL PLEDGE PAYMENT earns none — she thanked them for the pledge",
    !q4.drafts.some(d => d.donorName === "Priya Pledge"), q4.drafts.map(d => d.donorName));
  const [plGift] = await q(`SELECT type, pledge_id FROM gifts WHERE org_id=$1 AND donor_id='dty_pl'`, [ORG]);
  ok("…and it still applied to the pledge", plGift.type === "pledge payment" && plGift.pledge_id === pl.body.id, plGift);
  // A LARGE instalment still earns one: it is a gift somebody will notice giving.
  const big = await api("POST", "/donors/dty_ok1/pledges", tok, { amount: 1200, dueDate: TODAY, frequency: "monthly", installmentCount: 4 });
  await api("POST", "/donors/dty_ok1/gifts", tok, { amount: 300, date: TODAY, type: "cash", paymentMethod: "Check" });
  const q5 = (await api("GET", "/thank-yous", tok)).body;
  ok("a LARGE instalment still earns one — the floor is about small change, not pledges",
    q5.drafts.filter(d => d.donorName === "Margaret Chen").length === 2, q5.drafts.map(d => [d.donorName, d.amount]));
  void big;

  // ── §4 · Copy, Mark sent, Skip ───────────────────────────────────────────
  console.log("\n— §4 · three actions, and a bulk one she has to earn —");
  const first = q5.drafts[0];
  const tooEarly = await api("POST", "/thank-yous/mark-all-sent", tok);
  ok("MARK ALL AS SENT IS REFUSED while any draft is unopened",
    tooEarly.status === 409 && tooEarly.body.error === "unopened_drafts", tooEarly.body);
  ok("…and says why, in a sentence about the queue rather than about a rule",
    /stops meaning anything/.test(tooEarly.body.message || ""), tooEarly.body.message);
  const skipped = q5.drafts.find(d => d.donorName === "Diana Torres");
  const skip = await api("POST", `/thank-yous/${skipped.id}/skip`, tok);
  ok("Skip takes one out of the queue, with no reason asked", skip.status === 200, skip.status);
  const q6 = (await api("GET", "/thank-yous", tok)).body;
  ok("…and it is gone", !q6.drafts.some(d => d.id === skipped.id) && q6.count === q5.count - 1, { before: q5.count, after: q6.count });
  const sent = await api("POST", `/thank-yous/${first.id}/sent`, tok);
  ok("Mark sent takes one out too", sent.status === 200, sent.status);
  for (const d of (await api("GET", "/thank-yous", tok)).body.drafts) {
    await api("POST", `/thank-yous/${d.id}/opened`, tok);
  }
  const nowAll = (await api("GET", "/thank-yous", tok)).body;
  ok("with every draft opened, the bulk action is OFFERED", nowAll.allOpened === true, nowAll.allOpened);
  const all = await api("POST", "/thank-yous/mark-all-sent", tok);
  ok("…and it works", all.status === 200 && all.body.marked === nowAll.count, { marked: all.body.marked, was: nowAll.count });
  const empty = (await api("GET", "/thank-yous", tok)).body;
  ok("the queue is empty, and says nothing rather than zero", empty.count === 0 && empty.headline === null, empty);

  // ── §5 · marking sent logs a conversation ────────────────────────────────
  console.log("\n— §5 · marking one sent is logging a conversation —");
  const ints = await q(`SELECT i.type, i.note, i.gift_id, i.logged_by_name FROM interactions i
                          WHERE i.org_id=$1 AND i.type='stewardship'`, [ORG]);
  ok("each one logged a stewardship touch on the record", ints.length >= 2, ints.length);
  ok("…in HER name, not Steward's", ints.every(i => i.logged_by_name === "Ada Admin"), ints.map(i => i.logged_by_name));
  ok("…linked to the gift it thanked", ints.every(i => !!i.gift_id), ints);
  const [acked] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND acknowledgement_sent_at IS NOT NULL`, [ORG]);
  ok("…and the gift is marked acknowledged, with the MOMENT (BUILD-88a A.5)", acked.n >= 2, acked.n);

  // ── §6 · Steward sends nothing ───────────────────────────────────────────
  console.log("\n— §6 · the send layer never receives a thank-you —");
  ok("NOT ONE EMAIL LEFT STEWARD across every path in this suite",
    mails().length === 0, mails().map(m => ({ to: m.body?.to, subject: m.body?.subject })));
  const [receipts] = await q(`SELECT COUNT(*)::int n FROM receipts WHERE org_id=$1`, [ORG]);
  ok("and the receipt path is untouched by any of this — a §170 acknowledgment is a different document",
    receipts.n === 0, receipts.n);

  summary("build88b-thankyous");
  sink.close();
  await closeDb();
})();
