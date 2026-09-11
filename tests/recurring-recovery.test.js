// RECURRING RECOVERY — the three things added 2026-09-11.
//
// Everything in the recovery engine before this started at
// `invoice.payment_failed`: after the gift was already lost. These three close
// the two ends of that.
//
//   §1  THE CARD THAT IS GOING TO DIE, BEFORE IT DIES. A polled sweep (Stripe's
//       customer.source.expiring does NOT fire for PaymentMethod integrations —
//       their own event reference says so) stores the card's expiry, and the
//       donor hears about it while nothing has gone wrong yet.
//   §2  THE NETWORK FIXED IT ITSELF. payment_method.automatically_updated is
//       Stripe's Card Account Updater speaking. Without it the sweep emails
//       donors whose card was never going to fail.
//   §3  THE AUTOMATION HANDING OVER TO A HUMAN. Four emails over a fortnight
//       did not reach them, so the officer gets a thread — the follow-up that
//       was meant and never happened, which is the whole product.
//
// Standard scratch stack + the :5603 Stripe mock + the :5602 mail sink.
const http = require("http");
const bcrypt = require("bcryptjs");
const stripeLib = require("stripe");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, STRIPE_MOCK_PORT } = require("./helpers");

// Fixture ids are unique across the WHOLE battery on purpose: `u_rr` belongs
// to reserved-recovered, and every suite deletes users by ITS OWN org, so a
// stray row carrying the same primary key under a different org survives the
// other suite's reset and collides on insert. Cost one red battery.
const ORG = "org_recrec", EMAIL = "recrecadmin@example.org", PASS = "loadtest1234";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const ACCT = "acct_recrec_mock";

// ── the two local seams the suite drives ──────────────────────────────────
let captured = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { captured.push({ path: req.url, body: b ? JSON.parse(b) : null }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails").map(e => e.body);

// The card the mock reports for each subscription — the suite moves it to
// drive the expiry window without waiting for a calendar.
let MOCK_CARDS = {};
let stripeGets = [];
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const sub = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (req.method === "GET" && sub) {
          stripeGets.push(req.url);
          const card = MOCK_CARDS[sub[1]];
          res.end(JSON.stringify({
            id: sub[1], object: "subscription", status: "active",
            default_payment_method: card
              ? { id: card.pm, object: "payment_method", type: "card",
                  card: { brand: card.brand, last4: card.last4, exp_month: card.exp_month, exp_year: card.exp_year } }
              : null,
            customer: { id: "cus_recrec", object: "customer", invoice_settings: { default_payment_method: null } },
          }));
          return;
        }
        res.end(JSON.stringify({ id: "obj_mock", object: "thing" }));
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

async function fireWebhook(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function reset() {
  await q(`DELETE FROM payment_recovery_events WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM recurring_changes WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM recurring_subscriptions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM interactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,onboarding_complete,plan,timezone,stripe_account_id)
           VALUES ($1,'Recurring Recovery Org',1,'team','America/New_York',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'RR Admin','admin')`,
    ["u_recrec", ORG, EMAIL, bcrypt.hashSync(PASS, 10)]);
  // Two sustainers, each with an officer who owns them.
  for (const [id, name, mail] of [["d_recrec1", "Margaret Soto", "margaret@recrec.test"], ["d_recrec2", "Desmond Vale", "desmond@recrec.test"]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,assigned_to,assigned_to_name)
             VALUES ($1,$2,$3,$4,'u_recrec','RR Admin')`, [id, ORG, name, mail]);
  }
}

const sub = (id, donorId, extra = {}) => q(
  `INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,stripe_customer_id,amount,interval,status,
     failure_count,dunning_step,next_dunning_at,first_failed_at)
   VALUES ($1,$2,$3,$4,'cus_recrec',$5,'month',$6,$7,$8,$9,$10)`,
  [id, ORG, donorId, id, extra.amount ?? 25, extra.status ?? "active", extra.failure_count ?? 0,
   extra.dunning_step ?? 0, extra.next_dunning_at ?? null, extra.first_failed_at ?? null]);

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r));
  const smock = await startStripeMock();
  await reset();
  const tok = await login(EMAIL, PASS);

  const now = new Date();
  const thisMonth = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
  const nextM = thisMonth.m === 12 ? { y: thisMonth.y + 1, m: 1 } : { y: thisMonth.y, m: thisMonth.m + 1 };
  const farOff = { y: thisMonth.y + 4, m: thisMonth.m };
  const period = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

  // ── §1 · the card that is going to die ───────────────────────────────────
  console.log("\n— §1 · a card is read BEFORE it fails, and the donor hears about it —");
  await sub("sub_recrec_soon", "d_recrec1", { amount: 25 });
  await sub("sub_recrec_later", "d_recrec2", { amount: 40 });
  MOCK_CARDS = {
    sub_recrec_soon:  { pm: "pm_recrec_soon",  brand: "visa",       last4: "4242", exp_month: nextM.m,      exp_year: nextM.y },
    sub_recrec_later: { pm: "pm_recrec_later", brand: "mastercard", last4: "5555", exp_month: farOff.m,     exp_year: farOff.y },
  };
  stripeGets = []; captured = [];
  const run1 = (await api("POST", "/recurring/check-cards", tok, { dryRun: true })).body;
  ok("the sweep reads the card behind each live subscription — one Stripe call each",
    run1.refreshed?.checked === 2 && run1.refreshed?.requests === 2 && stripeGets.length === 2, run1.refreshed);
  const stored = await q(`SELECT id, card_brand, card_last4, card_exp_month, card_exp_year, card_payment_method_id
                            FROM recurring_subscriptions WHERE org_id=$1 ORDER BY id`, [ORG]);
  ok("…and STORES what it found, so nothing has to ask again to render",
    stored.length === 2 && stored.every(r => r.card_last4 && r.card_payment_method_id), stored);
  ok("only the card expiring this month or next is a candidate — the 4-years-out one is not",
    run1.notified.length === 1 && run1.notified[0].id === "sub_recrec_soon", run1.notified);
  ok("a dry run sends NOTHING and stamps nothing", mails().length === 0
    && (await q(`SELECT card_expiry_notified_for FROM recurring_subscriptions WHERE id='sub_recrec_soon'`, []))[0].card_expiry_notified_for === null);

  captured = [];
  const run2 = (await api("POST", "/recurring/check-cards", tok, {})).body;
  const mail = mails()[0];
  ok("for real, exactly one notice goes out", mails().length === 1 && run2.notified.length === 1, run2);
  ok("…named for the card, not for a failure that has not happened",
    /expires soon/i.test(mail.subject) && /4242/.test(mail.subject), mail.subject);
  ok("…and the body says plainly that nothing has gone wrong",
    /nothing has gone wrong/i.test(mail.html) && /before your next gift/i.test(mail.html), null);
  ok("…carrying the SAME update-card link the failure path uses",
    /\/recurring\/update-card\?token=/.test(mail.html), (mail.html.match(/href="[^"]*update-card[^"]*"/) || [])[0]);
  ok("…and the donor's own gift, in their own words", /\$25/.test(mail.html) && /monthly/.test(mail.html), null);

  // one notice per card per expiry — the stamp is the EXPIRY, not a date
  captured = [];
  const run3 = (await api("POST", "/recurring/check-cards", tok, {})).body;
  ok("running it again sends nothing — the stamp is the expiry period, so a re-read cannot re-notify",
    mails().length === 0 && run3.skipped.some(s => s.reason === "already_notified"), run3);
  const stamp = (await q(`SELECT card_expiry_notified_for FROM recurring_subscriptions WHERE id='sub_recrec_soon'`, []))[0];
  ok(`…and the stamp is the expiry month itself (${period(nextM.y, nextM.m)})`,
    stamp.card_expiry_notified_for === period(nextM.y, nextM.m), stamp);

  // the re-read budget: a fresh check does not re-hit Stripe
  stripeGets = [];
  await api("POST", "/recurring/check-cards", tok, {});
  ok("a card read minutes ago is NOT read again — card_checked_at is a budget, not a decoration",
    stripeGets.length === 0, stripeGets);

  // staff see preventable money separately from lost money
  const health = (await api("GET", "/recurring/health", tok)).body;
  ok("the staff surface counts money that has not failed YET, separately from money that has",
    health.expiringCount === 1 && health.mrrExpiring === 25 && health.atRiskCount === 0, health);

  // ── §2 · the network fixed it by itself ──────────────────────────────────
  console.log("\n— §2 · Stripe's Card Account Updater speaks, and we listen —");
  const upd = await fireWebhook({
    id: "evt_recrec_autoupd", type: "payment_method.automatically_updated", account: ACCT,
    data: { object: { id: "pm_recrec_soon", object: "payment_method", type: "card",
      card: { brand: "visa", last4: "9911", exp_month: farOff.m, exp_year: farOff.y } } } });
  ok("the event is accepted", upd.status === 200, upd);
  const after = (await q(`SELECT card_last4, card_exp_year, card_expiry_notified_for FROM recurring_subscriptions WHERE id='sub_recrec_soon'`, []))[0];
  ok("the new card details replace the old ones", after.card_last4 === "9911" && after.card_exp_year === farOff.y, after);
  ok("…and the expiry notice stamp is CLEARED — the card has a new expiry, and if that one nears the donor should hear about it",
    after.card_expiry_notified_for === null, after);
  const evts = await q(`SELECT type FROM payment_recovery_events WHERE org_id=$1 ORDER BY created_at`, [ORG]);
  ok("the network update is on the record as its own event", evts.some(e => e.type === "card_auto_updated"), evts.map(e => e.type));
  captured = [];
  const run4 = (await api("POST", "/recurring/check-cards", tok, { skipRefresh: true })).body;
  ok("…and NO donor is emailed about a card the network already fixed — the thing this event exists to prevent",
    mails().length === 0 && run4.notified.length === 0, run4);

  // ── §3 · the automation hands over to a human ────────────────────────────
  console.log("\n— §3 · four emails did not reach them, so a person calls —");
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  // A subscription on the LAST step of the cadence, due now.
  await q(`UPDATE recurring_subscriptions SET status='recovering', dunning_step=3, next_dunning_at=NOW() - interval '1 minute',
             first_failed_at=NOW() - interval '14 days' WHERE id='sub_recrec_later'`, []);
  captured = [];
  await api("POST", "/recurring/process-dunning", tok, {});
  const row = (await q(`SELECT next_dunning_at, dunning_step FROM recurring_subscriptions WHERE id='sub_recrec_later'`, []))[0];
  ok("the cadence runs out (next_dunning_at is NULL — Steward stops emailing)",
    row.next_dunning_at === null && row.dunning_step === 4, row);
  const th = await q(`SELECT * FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("…and the donor becomes a PERSON'S JOB: one open thread", th.length === 1 && th[0].donor_id === "d_recrec2", th);
  ok("…owned by the officer who owns the donor", th[0].owner_id === "u_recrec" && th[0].owner_name === "RR Admin", th[0]);
  ok("…due TODAY, because it has already been failing a fortnight",
    th[0].due_date === new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()), th[0].due_date);
  ok("…and the step says the money and the cadence, not a bare 'follow up'",
    /\$40/.test(th[0].next_step_label) && /monthly/.test(th[0].next_step_label) && /card failed/i.test(th[0].next_step_label),
    th[0].next_step_label);
  ok("the hand-off is on the record as its own event",
    (await q(`SELECT type FROM payment_recovery_events WHERE org_id=$1 AND type='dunning_exhausted'`, [ORG])).length === 1);

  // idempotence: the cadence cannot hand the same donor over twice
  await q(`UPDATE recurring_subscriptions SET dunning_step=3, next_dunning_at=NOW() - interval '1 minute' WHERE id='sub_recrec_later'`, []);
  await api("POST", "/recurring/process-dunning", tok, {});
  const th2 = await q(`SELECT id FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("a second exhaustion does NOT stack a second thread (one open thread per donor, at the database)",
    th2.length === 1, th2);

  // the other caller: an org that never dunned at all still gets the hand-off
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  await q(`UPDATE recurring_subscriptions SET status='past_due' WHERE id='sub_recrec_soon'`, []);
  const del = await fireWebhook({
    id: "evt_recrec_del", type: "customer.subscription.deleted", account: ACCT,
    data: { object: { id: "sub_recrec_soon", object: "subscription", status: "canceled" } } });
  ok("an INVOLUNTARY cancellation is accepted", del.status === 200, del);
  const th3 = await q(`SELECT donor_id, next_step_label FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("…and hands that donor to a human too — the org that turned dunning off never had a cadence to exhaust",
    th3.length === 1 && th3[0].donor_id === "d_recrec1", th3);

  // a VOLUNTARY cancellation is a decision, not a failure — no thread
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  await q(`UPDATE recurring_subscriptions SET status='active' WHERE id='sub_recrec_later'`, []);
  await fireWebhook({
    id: "evt_recrec_del2", type: "customer.subscription.deleted", account: ACCT,
    data: { object: { id: "sub_recrec_later", object: "subscription", status: "canceled" } } });
  const th4 = await q(`SELECT id FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("a donor who CHOSE to stop gets no 'their card failed' thread — the churn split is respected",
    th4.length === 0, th4);

  // a do-not-contact donor is never handed over either
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  await q(`UPDATE donors SET do_not_contact=TRUE WHERE id='d_recrec2'`, []);
  await q(`UPDATE recurring_subscriptions SET status='recovering', dunning_step=3,
             next_dunning_at=NOW() - interval '1 minute' WHERE id='sub_recrec_later'`, []);
  await api("POST", "/recurring/process-dunning", tok, {});
  const th5 = await q(`SELECT id FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  ok("a do-not-contact donor is never handed to a human either (the person-surface gate holds)", th5.length === 0, th5);

  await new Promise(r => sink.close(r));
  await new Promise(r => smock.close(r));
  await closeDb();
  summary("recurring-recovery");
})();
