// BUILD-90 90b — THE REMINDER AND THE CANCEL BUTTON.
// Local scratch server + Postgres, plus the platform-billing Stripe mock (the
// same boot as tests/close-link.test.js — STRIPE_BILLING_API_BASE + the three
// STRIPE_PRICE_* ids).
//
// THE ONE TEST THE BRIEF ASKS FOR, in four parts:
//   · an import on any day leaves the trial end untouched
//   · the reminder fires once on day 23
//   · cancel before trial end produces zero charges
//   · cancel after a charge ends access at the period end
//
// The first is the one that matters most and is the easiest to get wrong. An
// earlier draft of this build started the billing clock at import with a
// 44-day cap, which made the date a customer could move by doing ordinary
// work. It is now thirty days from signing, full stop — so the strongest form
// of the assertion is available: import a real donor file through the real
// route, twice, and prove `trial_ends_at` is byte-identical afterwards.

const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, BILLING_MOCK_PORT } = require("./helpers");
const { computeTrialEnd, computeReminderAt } = require("../trialEnd");

const A = "org_tb_a", B = "org_tb_b", C = "org_tb_c", HQ = "org_tb_hq";
const A_ADMIN = "a-admin@tb.local", B_ADMIN = "b-admin@tb.local", C_ADMIN = "c-admin@tb.local";
const SUPER = "super@tb.local";
const DAY = 24 * 60 * 60 * 1000;

// ── the two local seams ────────────────────────────────────────────────────
let mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails") mails.push(JSON.parse(b)); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

// What the mock SAW is the assertion: cancelling during a trial must reach
// Stripe as an outright cancel, and cancelling after a charge as
// cancel_at_period_end. Those are two different promises to the customer.
let stripeCalls = [];
function startBillingMock(port = BILLING_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (m) {
          stripeCalls.push({ method: req.method, sub: m[1], body: b });
          const periodEnd = Math.floor(Date.now() / 1000) + 12 * 86400;
          return res.end(JSON.stringify({
            id: m[1], object: "subscription",
            status: req.method === "DELETE" ? "canceled" : "active",
            current_period_end: periodEnd,
            cancel_at_period_end: /cancel_at_period_end=true/.test(b),
            default_payment_method: { id: "pm_1", object: "payment_method", type: "card", card: { brand: "visa", last4: "4242" } },
            items: { data: [{ price: { id: "price_test_core" } }] },
          }));
        }
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

const orgRow = async id => (await q(`SELECT * FROM orgs WHERE id=$1`, [id]))[0];

async function reset() {
  for (const o of [A, B, C, HQ, "org_tb_d"]) {
    for (const t of ["gifts", "interactions", "donors", "users", "accounts", "fin_funds", "workflows", "imports"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
async function seedOrg(id, name, plan, status, extra = {}) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,
                             signed_at,trial_ends_at,stripe_subscription_id,current_period_end,
                             billing_card_brand,billing_card_last4)
           VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, name, id.replace(/_/g, "-"), plan, status,
     extra.signedAt || null, extra.trialEndsAt || null, extra.sub || null, extra.periodEnd || null,
     extra.cardBrand || null, extra.cardLast4 || null]);
}
async function seedUser(id, org, email, { role = "admin", superAdmin = false } = {}) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, hash, "TB " + id, role, superAdmin]);
}

(async () => {
  const mockSrv = await startBillingMock();
  await new Promise(r => sink.listen(SINK_PORT, r));
  await reset();

  // A signed the day this suite runs, so its whole thirty days are ahead of it.
  const signedA = new Date(Date.now() - 2 * DAY);
  const endA = computeTrialEnd(signedA);
  await seedOrg(A, "Sparrow", "core", "trialing",
    { signedAt: signedA.toISOString(), trialEndsAt: endA.toISOString(), sub: "sub_tb_a", cardBrand: "visa", cardLast4: "4242" });
  await seedUser("u_tb_a", A, A_ADMIN);

  // B is a paying customer, twelve days into a month it has paid for.
  await seedOrg(B, "Harborlight", "team", "active",
    { signedAt: new Date(Date.now() - 60 * DAY).toISOString(), sub: "sub_tb_b",
      periodEnd: new Date(Date.now() + 12 * DAY).toISOString(), cardBrand: "visa", cardLast4: "1881" });
  await seedUser("u_tb_b", B, B_ADMIN);

  // C is mid-trial and about to cancel from Settings.
  const signedC = new Date(Date.now() - 5 * DAY);
  await seedOrg(C, "Cedar House", "founding", "trialing",
    { signedAt: signedC.toISOString(), trialEndsAt: computeTrialEnd(signedC).toISOString(), sub: "sub_tb_c", cardBrand: "visa", cardLast4: "0002" });
  await seedUser("u_tb_c", C, C_ADMIN);

  await seedOrg(HQ, "Steward HQ", "team", "active", {});
  await seedUser("u_tb_super", HQ, SUPER, { superAdmin: true });

  const aTok = await login(A_ADMIN), bTok = await login(B_ADMIN), cTok = await login(C_ADMIN), sTok = await login(SUPER);

  console.log("— §1 · NOTHING MOVES THE TRIAL END —");
  const before = (await orgRow(A)).trial_ends_at;
  ok("the seeded org's trial ends thirty days after it signed",
     new Date(before).getTime() - new Date((await orgRow(A)).signed_at).getTime() === 30 * DAY, before);

  let imp = await api("POST", "/donors/import-combined", aTok, {
    donors: [
      { name: "Margaret Vale", email: "mvale@tb.local" },
      { name: "Owen Price", email: "oprice@tb.local" },
    ],
    gifts: [
      { donorIndex: 0, amount: 500, date: "2026-02-02", type: "cash" },
      { donorIndex: 1, amount: 125.5, date: "2026-03-14", type: "cash" },
    ],
  });
  ok("a donor file imported through the real route", imp.status === 200, imp.body);
  let after = (await orgRow(A)).trial_ends_at;
  ok("…and the trial end is BYTE-IDENTICAL afterwards",
     String(after) === String(before), { before: String(before), after: String(after) });

  // A SECOND import. This is the case the retired draft got wrong: a clock
  // started at "the file is in" restarts, or extends, when the file comes in
  // again. Here there is no clock to restart.
  imp = await api("POST", "/donors/import-combined", aTok, {
    donors: [{ name: "Ruth Carver", email: "rcarver@tb.local" }],
    gifts: [{ donorIndex: 0, amount: 40, date: "2026-04-01", type: "cash" }],
  });
  ok("a SECOND import also succeeds", imp.status === 200, imp.body);
  after = (await orgRow(A)).trial_ends_at;
  ok("…and the trial end still has not moved", String(after) === String(before), { before: String(before), after: String(after) });
  ok("…nor has the signing timestamp it is derived from",
     new Date((await orgRow(A)).signed_at).getTime() === signedA.getTime());

  // The API speaks ISO, pg hands back a Date — compare the INSTANT, not two
  // different renderings of it.
  const iso = d => new Date(d).toISOString();
  const status = await api("GET", "/billing/status", aTok);
  ok("Settings → Billing reports that same date as the first charge",
     status.status === 200 && iso(status.body.firstChargeAt) === iso(before),
     { api: status.body.firstChargeAt, db: iso(before) });
  ok("…with the amount, the card, and the promise beside it",
     status.body.monthlyUsd === 249 && status.body.cardLast4 === "4242" && status.body.cancelIsFree === true
     && /^Your first charge is \$249 on /.test(status.body.firstChargeSentence || ""), status.body.firstChargeSentence);

  console.log("\n— §2 · the reminder fires ONCE, on day 23 —");
  const dueAt = computeReminderAt(endA).getTime();
  mails = [];
  let run = await api("POST", "/billing/trial-reminders/run", sTok, { now: new Date(dueAt - DAY).toISOString() });
  ok("day 22 — nothing sent", run.status === 200 && !run.body.sent.some(s => s.id === A), run.body);

  mails = [];
  run = await api("POST", "/billing/trial-reminders/run", sTok, { now: new Date(dueAt + 60000).toISOString() });
  const sentA = run.body.sent.find(s => s.id === A);
  ok("day 23 — sent", !!sentA, run.body);
  ok("…to the org's admin, naming the date and the amount",
     sentA && sentA.to === A_ADMIN && sentA.amount === 249 && iso(sentA.trialEndsAt) === iso(before), sentA);

  const mail = mails.find(m => m.to === A_ADMIN || (m.to || [])[0] === A_ADMIN);
  ok("an email really left", !!mail, mails.map(m => m.to));
  ok("…from the founder's address", mail && /stewardapp\.dev/.test(mail.from || ""), mail && mail.from);
  ok("…with the charge date in the SUBJECT, so it is legible without opening it",
     mail && /^Your first Steward charge is [A-Z][a-z]+ \d+, \d{4}$/.test(mail.subject || ""), mail && mail.subject);
  ok("…the amount and the date in the body", mail && /Your first charge is \$249 on /.test(mail.html || ""),
     mail && (mail.html || "").match(/Your first charge[^<]*/));
  ok("…the card's last four, so she knows which card", mail && /ending 4242/.test(mail.html || ""),
     mail && (mail.html || "").match(/ending \d{4}/));
  ok("…and a one-click cancel link", mail && /\/billing\/cancel\/[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+/.test(mail.html || ""));
  ok("…and it says cancelling costs nothing", mail && /cancel before then and you pay nothing/i.test(mail.html || ""));

  // ONCE. A tick every six hours across seven days must not send fourteen.
  mails = [];
  run = await api("POST", "/billing/trial-reminders/run", sTok, { now: new Date(dueAt + DAY).toISOString() });
  ok("day 24 — NOT sent again", !run.body.sent.some(s => s.id === A), run.body);
  ok("…and no second email left", !mails.some(m => m.to === A_ADMIN || (m.to || [])[0] === A_ADMIN), mails.map(m => m.to));
  ok("the org carries the stamp that makes 'once' true", !!(await orgRow(A)).trial_reminder_sent_at);

  // NO SUBSCRIPTION, NO WARNING. An email naming an amount, a date and a
  // card's last four must never reach an org that has none of those — a
  // manual super-admin grant, a demo org, a legacy trial that never went
  // through Checkout. This is what keeps the first production tick silent.
  const D = "org_tb_d";
  await q(`DELETE FROM users WHERE org_id=$1`, [D]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [D]).catch(() => {});
  const signedD = new Date(dueAt - 23 * DAY);
  await seedOrg(D, "Granted Org", "team", "trialing",
    { signedAt: signedD.toISOString(), trialEndsAt: new Date(dueAt + 7 * DAY).toISOString() }); // no sub, no card
  await seedUser("u_tb_d", D, "d-admin@tb.local");
  mails = [];
  run = await api("POST", "/billing/trial-reminders/run", sTok, { now: new Date(dueAt + 60000).toISOString() });
  ok("an org on a priced plan with NO Stripe subscription is never warned about a charge",
     !run.body.sent.some(s2 => s2.id === D), run.body);
  ok("…and no email left for it", !mails.some(m => m.to === "d-admin@tb.local" || (m.to || [])[0] === "d-admin@tb.local"),
     mails.map(m => m.to));

  // The ops route is not a public one.
  const forbidden = await api("POST", "/billing/trial-reminders/run", aTok, {});
  ok("a plain admin cannot drive the reminder sweep", forbidden.status === 403, forbidden.status);

  console.log("\n— §3 · the one-click cancel in the email —");
  const cancelUrl = (mail.html.match(/href="([^"]*\/billing\/cancel\/[^"]+)"/) || [])[1];
  ok("the link points at the canonical domain, not a raw API host",
     /^http:\/\/localhost:4173\/billing\/cancel\//.test(cancelUrl) || /stewardapp\.dev/.test(cancelUrl), cancelUrl);
  const token = cancelUrl.split("/billing/cancel/")[1];

  // A GET must NOT cancel. Inbox scanners prefetch links; a subscription that
  // ends because Outlook looked at an email is not a cancel button.
  let page = await fetch(BASE + "/billing/cancel/" + token);
  let html = await page.text();
  ok("GET renders a confirmation page", page.status === 200 && /Cancel my subscription/.test(html), page.status);
  ok("…stating what is at stake", /Your first charge is \$249 on /.test(html), html.match(/Your first charge[^<]*/));
  ok("…and the subscription is STILL LIVE — a prefetch must not cancel anything",
     (await orgRow(A)).subscription_status === "trialing", (await orgRow(A)).subscription_status);

  stripeCalls = [];
  page = await fetch(BASE + "/billing/cancel/" + token, { method: "POST" });
  html = await page.text();
  ok("POST cancels", page.status === 200, page.status);
  ok("…and says so in the words that matter: never charged", /You were never charged/.test(html), html.slice(0, 400));
  ok("…the org is cancelled", (await orgRow(A)).subscription_status === "canceled");
  ok("…and Stripe was told to cancel OUTRIGHT, not at period end",
     stripeCalls.some(c => c.method === "DELETE" && c.sub === "sub_tb_a")
     && !stripeCalls.some(c => /cancel_at_period_end/.test(c.body || "")), stripeCalls);

  const forged = await fetch(BASE + "/billing/cancel/" + token.slice(0, -3) + "aaa", { method: "POST" });
  ok("a forged token cancels nothing", forged.status === 400, forged.status);

  console.log("\n— §4 · cancel from Settings, before the first charge: zero charges —");
  stripeCalls = [];
  let r = await api("POST", "/billing/cancel", cTok);
  ok("the admin's cancel is accepted", r.status === 200, r.body);
  ok("…it happens NOW and is free of charge", r.body.when === "now" && r.body.freeOfCharge === true, r.body);
  ok("…Stripe was asked to cancel outright", stripeCalls.some(c => c.method === "DELETE" && c.sub === "sub_tb_c"), stripeCalls);
  ok("…and the org is cancelled", (await orgRow(C)).subscription_status === "canceled");
  const cGifts = await q(`SELECT COUNT(*) c FROM orgs WHERE id=$1 AND current_period_end IS NOT NULL`, [C]);
  ok("…with no paid period ever recorded against it — nothing was ever charged", Number(cGifts[0].c) === 0, cGifts[0]);

  console.log("\n— §5 · cancel after a charge: access ends at the period end —");
  stripeCalls = [];
  const bEndBefore = (await orgRow(B)).current_period_end;
  r = await api("POST", "/billing/cancel", bTok);
  ok("the cancel is accepted", r.status === 200, r.body);
  ok("…and it takes effect at the PERIOD END, not now", r.body.when === "period_end" && !!r.body.periodEnd, r.body);
  ok("…Stripe was told cancel_at_period_end, not delete",
     stripeCalls.some(c => c.method === "POST" && c.sub === "sub_tb_b" && /cancel_at_period_end=true/.test(c.body))
     && !stripeCalls.some(c => c.method === "DELETE"), stripeCalls);
  const bAfter = await orgRow(B);
  ok("…the org keeps what it paid for: still active until the period ends",
     bAfter.subscription_status === "active" && new Date(bAfter.current_period_end).getTime() > Date.now(),
     { status: bAfter.subscription_status, before: bEndBefore, after: bAfter.current_period_end });
  const bStatus = await api("GET", "/billing/status", bTok);
  ok("…and Settings still shows it working, with a period end to run out",
     bStatus.body.accessState !== "read_only" && !!bStatus.body.currentPeriodEnd, bStatus.body.accessState);

  console.log("\n— §6 · only an admin may end the relationship —");
  await seedUser("u_tb_b_staff", B, "b-staff@tb.local", { role: "staff" });
  const staffTok = await login("b-staff@tb.local");
  r = await api("POST", "/billing/cancel", staffTok);
  ok("a staff user cannot cancel the org's subscription", r.status === 403, r.status);
  r = await api("POST", "/billing/cancel", null);
  ok("…nor can an anonymous caller", r.status === 401, r.status);

  mockSrv.close(); sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
