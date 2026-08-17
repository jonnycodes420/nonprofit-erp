// BUILD-57 Part 1 — the staff recurring-giving surface.
//
// Covers: the roster (at-risk first, statuses, fund names, linked-gift
// totals), the movement summary (MRR + waterfall over recurring_change_log
// with involuntary/voluntary churn NEVER collapsed + 12-month retention +
// the sourced M+R benchmark), the exceptions payload, staff-direct actions
// (pause/resume/cancel/fund — each writes the change log, a timeline note,
// and an UNSUPPRESSIBLE donor email), and the proposal machinery (anything
// that moves money is an invitation the donor completes: create / amount /
// frequency / card update — tokens hash-at-rest, 14-day expiry, one resend).
//
// The single most load-bearing assertions here are the SUPPRESSION ones: the
// donor notification must arrive with recurring_dunning_enabled=false AND the
// donor on the suppression list. Test that it CANNOT be suppressed, not that
// it fires.
//
// Standard scratch stack (run-all boot env: STRIPE_API_BASE=:5603 mock —
// started here — RESEND_BASE_URL=:5602 sink — started here).

const bcrypt = require("bcryptjs");
const http = require("http");
const Stripe = require("stripe");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

const ORG_A = "org_rec_a", ORG_B = "org_rec_b", ORG_RO = "org_rec_ro";
const ACCT_A = "acct_rec_a", ACCT_B = "acct_rec_b", ACCT_RO = "acct_rec_ro";

// ── mail sink (:5602) ──────────────────────────────────────────────────────
let mail = [];
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { } res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const mailTo = to => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

// ── Stripe mock (:5603) — subscriptions retrieve/update + checkout sessions ─
let stripeCalls = [];
function startStripeMock(port = 5603) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        stripeCalls.push({ method: req.method, path: req.url, body: b });
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const mode = /mode=setup/.test(b) ? "setup" : "subscription";
          res.end(JSON.stringify({ id: "cs_mock_" + stripeCalls.length, object: "checkout.session", mode, url: `http://127.0.0.1:${port}/mock-checkout/${mode}` }));
          return;
        }
        // §6 — the PI→invoice→subscription resolution path (BUILD-57 §2a).
        const inv = req.url.match(/^\/v1\/invoices\/([^/?]+)/);
        if (req.method === "GET" && inv) {
          res.end(JSON.stringify({ id: inv[1], object: "invoice", subscription: ({ in_mock_r1: "sub_r1" })[inv[1]] || null }));
          return;
        }
        // BUILD-62 — the customer→donor fallback (used when a subscription
        // charge's PI arrives before checkout.session.completed has created
        // the recurring_subscriptions row).
        const cust = req.url.match(/^\/v1\/customers\/([^/?]+)/);
        if (req.method === "GET" && cust) {
          const email = ({ cus_race: "eli@rec.test" })[cust[1]] || null;
          res.end(JSON.stringify({ id: cust[1], object: "customer", email, name: email ? "Eli Epsilon" : null }));
          return;
        }
        const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (m) {
          res.end(JSON.stringify({
            id: m[1], object: "subscription", status: "active",
            current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
            items: { data: [{ id: "si_mock_1", price: { currency: "usd", product: "prod_mock" } }] },
          }));
        } else { res.end(JSON.stringify({ ok: true })); }
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

async function fireWebhook(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function rawGet(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, text: await r.text() };
}
async function formPost(path, fields, redirect = "follow") {
  const r = await fetch(BASE + path, {
    method: "POST", redirect,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: r.status, location: r.headers.get("location"), text: redirect === "manual" ? "" : await r.text() };
}
const tokenFromMail = m => (/\/recurring\/proposal\?token=([A-Za-z0-9_-]+)/.exec(m?.html || "") || [])[1] || null;

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

async function fixture() {
  for (const org of [ORG_A, ORG_B, ORG_RO]) {
    for (const t of ["recurring_change_log", "recurring_proposals", "recurring_subscriptions", "payment_recovery_events",
      "email_suppressions", "notification_sends", "gifts", "interactions", "fin_transactions", "fin_funds", "accounts",
      "portal_settings", "workflow_runs", "workflows", "tasks", "donors", "users"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'recurring test org','rec-a',1,'active','growth',$2)`, [ORG_A, ACCT_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'recurring org b','rec-b',1,'active','growth',$2)`, [ORG_B, ACCT_B]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'readonly rec org','rec-ro',1,'trial_expired','trial',$2)`, [ORG_RO, ACCT_RO]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rec_admin',$1,'rec-admin@test.local',$2,'Rec Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rec_staff',$1,'rec-staff@test.local',$2,'Sam Staff','staff')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rec_b',$1,'rec-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rec_ro',$1,'rec-ro@test.local',$2,'RO Admin','admin')`, [ORG_RO, hash]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_rec_1',$1,'River Fund',true)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_rec_2',$1,'Bridge Fund',true)`, [ORG_A]);

  const donors = [
    ["d_rec_a", "Ada Alpha", "ada@rec.test"], ["d_rec_b", "Ben Beta", "ben@rec.test"],
    ["d_rec_c", "Cy Gamma", "cy@rec.test"], ["d_rec_d", "Dee Delta", "dee@rec.test"],
    ["d_rec_e", "Eli Epsilon", "eli@rec.test"],
  ];
  for (const [id, name, email] of donors) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'mid','steward',0,0)`, [id, ORG_A, name, email]);
  }
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_rec_f',$1,'Fay NoEmail',NULL,'mid','steward',0,0)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_rec_bb',$1,'Bob OrgB','bob@recb.test','mid','steward',0,0)`, [ORG_B]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_rec_ro',$1,'Ro Donor','ro@recro.test','mid','steward',0,0)`, [ORG_RO]);

  // Subscriptions. rs_r1's start ~360 days ago puts its 1-year anniversary
  // ~5 days out (the anniversary bucket) while staying OUT of the 12-month
  // retention cohort. The two rs_ret rows ARE the cohort: ret1 died at 13
  // months (retained at the 12-month mark), ret2 died at 1 month (lost).
  const subs = [
    ["rs_r1", "d_rec_a", "sub_r1", 50, "month", "active", { created: daysAgo(360), fund: "fund_rec_1" }],
    ["rs_r2", "d_rec_b", "sub_r2", 25, "month", "past_due", { lastFailed: daysAgo(0), dunningStep: 1, failureCount: 2 }],
    ["rs_r3", "d_rec_c", "sub_r3", 10, "month", "recovering", { lastFailed: daysAgo(2), dunningStep: 3 }],
    ["rs_r4", "d_rec_d", "sub_r4", 40, "month", "paused", { paused: daysAgo(1) }],
    ["rs_r5", "d_rec_a", "sub_r5", 120, "year", "active", {}],
    ["rs_ret1", "d_rec_b", "sub_ret1", 20, "month", "canceled", { created: daysAgo(456), canceled: daysAgo(60) }],
    ["rs_ret2", "d_rec_c", "sub_ret2", 20, "month", "canceled", { created: daysAgo(426), canceled: daysAgo(396) }],
  ];
  for (const [id, donor, sid, amount, interval, status, o] of subs) {
    await q(
      `INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,stripe_customer_id,amount,interval,status,created_at,last_failed_at,first_failed_at,dunning_step,next_dunning_at,failure_count,paused_at,canceled_at,fund_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),$10,$10,COALESCE($11,0),$12,COALESCE($13,0),$14,$15,$16)`,
      [id, ORG_A, donor, sid, "cus_" + id, amount, interval, status,
        o.created || null, o.lastFailed || null, o.dunningStep || null,
        status === "recovering" ? null : (o.lastFailed ? daysAgo(-1) : null),
        o.failureCount || null, o.paused || null, o.canceled || null, o.fund || null]);
  }
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_b1',$1,'d_rec_bb','sub_b1',77,'month','active')`, [ORG_B]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_ro1',$1,'d_rec_ro','sub_ro1',30,'month','active')`, [ORG_RO]);

  // Linked renewal gifts → rs_r1's "total given on this subscription".
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,recurring_subscription_id) VALUES ('g_rl1',$1,'d_rec_a',50,'2026-06-01','cash','','rs_r1')`, [ORG_A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,recurring_subscription_id) VALUES ('g_rl2',$1,'d_rec_a',50,'2026-07-01','cash','','rs_r1')`, [ORG_A]);

  // This month's movement (hand-computable waterfall) + one out-of-window row.
  const logs = [
    ["created", null, 30, "month"], ["amount_up", 20, 35, "month"], ["amount_down", 50, 40, "month"],
    ["paused", 15, null, "month"], ["resumed", null, 15, "month"],
    ["canceled_involuntary", 25, null, "month"], ["canceled_voluntary", 10, null, "month"],
  ];
  let i = 0;
  for (const [kind, oldA, newA, intv] of logs) {
    await q(`INSERT INTO recurring_change_log (id,org_id,subscription_id,donor_id,kind,old_amount,new_amount,sub_interval,actor) VALUES ($1,$2,'rs_seed','d_rec_a',$3,$4,$5,$6,'system')`,
      ["rcl_fix_" + (i++), ORG_A, kind, oldA, newA, intv]);
  }
  await q(`INSERT INTO recurring_change_log (id,org_id,subscription_id,donor_id,kind,old_amount,new_amount,sub_interval,actor,created_at) VALUES ('rcl_fix_old',$1,'rs_seed','d_rec_a','created',NULL,99,'month','system',NOW()-INTERVAL '40 days')`, [ORG_A]);
}

(async () => {
  const sink = await startSink();
  const smock = await startStripeMock();
  await fixture();
  const admin = (await api("POST", "/auth/login", null, { email: "rec-admin@test.local", password: "loadtest1234" })).body.token;
  const staff = (await api("POST", "/auth/login", null, { email: "rec-staff@test.local", password: "loadtest1234" })).body.token;
  const adminB = (await api("POST", "/auth/login", null, { email: "rec-b@test.local", password: "loadtest1234" })).body.token;
  const adminRO = (await api("POST", "/auth/login", null, { email: "rec-ro@test.local", password: "loadtest1234" })).body.token;

  // ── §1 roster ────────────────────────────────────────────────────────────
  let roster = (await api("GET", "/recurring/roster", admin)).body;
  ok("roster lists every org-A subscription", roster.subs?.length === 7, roster.subs?.length);
  ok("at-risk rows sort FIRST (freshest failure on top)",
    roster.subs[0].id === "rs_r2" && roster.subs[1].id === "rs_r3", roster.subs.slice(0, 2).map(s => s.id));
  const byId = Object.fromEntries((roster.subs || []).map(s => [s.id, s]));
  ok("displayStatus maps the full state set", byId.rs_r1.displayStatus === "active" && byId.rs_r2.displayStatus === "past_due"
    && byId.rs_r3.displayStatus === "past_due" && byId.rs_r4.displayStatus === "paused" && byId.rs_ret1.displayStatus === "canceled",
    Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, v.displayStatus])));
  ok("fund designation joins by name", byId.rs_r1.fundName === "River Fund", byId.rs_r1);
  ok("total given on the subscription is a SUM over LINKED gifts", byId.rs_r1.totalGiven === 100 && byId.rs_r1.linkedGiftCount === 2, byId.rs_r1);
  ok("a subscription with no linked gifts reports zero, not a guess", byId.rs_r5.totalGiven === 0 && byId.rs_r5.linkedGiftCount === 0);
  ok("roster carries donor identity + start date", byId.rs_r2.donorName === "Ben Beta" && !!byId.rs_r2.startedAt);
  const rosterB = (await api("GET", "/recurring/roster", adminB)).body;
  ok("org B sees only its own roster", rosterB.subs?.length === 1 && rosterB.subs[0].id === "rs_b1", rosterB.subs);
  ok("org A roster carries no org-B marker", !JSON.stringify(roster).includes("d_rec_bb") && !JSON.stringify(roster).includes("Bob OrgB"));

  // ── §2 movement ──────────────────────────────────────────────────────────
  const mv = (await api("GET", "/recurring/movement", admin)).body;
  ok("MRR = hand-computed monthly equivalent (50+25+10+120/12 = 95)", mv.mrr === 95, mv.mrr);
  ok("healthy/at-risk counts split", mv.healthyCount === 2 && mv.atRiskCount === 2, mv);
  const w = mv.waterfall;
  ok("waterfall: new", w.new.count === 1 && w.new.amount === 30, w.new);
  ok("waterfall: upgraded = delta", w.upgraded.count === 1 && w.upgraded.amount === 15, w.upgraded);
  ok("waterfall: downgraded = delta", w.downgraded.count === 1 && w.downgraded.amount === 10, w.downgraded);
  ok("waterfall: paused/resumed", w.paused.amount === 15 && w.resumed.amount === 15);
  ok("INVOLUNTARY churn is its own bucket, never merged", w.involuntaryChurn.count === 1 && w.involuntaryChurn.amount === 25, w.involuntaryChurn);
  ok("VOLUNTARY churn is its own bucket, never merged", w.voluntaryChurn.count === 1 && w.voluntaryChurn.amount === 10, w.voluntaryChurn);
  ok("net = +30+15+15 −10−15−25−10 = 0", w.net === 0, w.net);
  ok("last month's row is excluded from this month's waterfall", w.new.amount === 30);
  ok("12-month retention = 1 of 2 cohort = 50%", mv.retention12.rate === 50 && mv.retention12.cohortSize === 2, mv.retention12);
  ok("the benchmark is cited WITH its source (M+R Benchmarks 2026, 71%)",
    mv.benchmark?.value === 71 && mv.benchmark?.source === "M+R Benchmarks 2026", mv.benchmark);

  // ── §3 exceptions ────────────────────────────────────────────────────────
  const ex = (await api("GET", "/recurring/exceptions", admin)).body;
  ok("failed cards count + list", ex.counts.failedCards === 2 && ex.failedCards[0].donorName === "Ben Beta", ex.counts);
  ok("about-to-lapse = recovering with the cadence exhausted", ex.counts.aboutToLapse === 1 && ex.aboutToLapse[0].subId === "rs_r3", ex.aboutToLapse);
  ok("anniversary: rs_r1 lands in the 14-day window at 1 year", ex.counts.anniversaries === 1 && ex.anniversaries[0].years === 1 && ex.anniversaries[0].donorName === "Ada Alpha", ex.anniversaries);
  ok("no proposals yet → zero pending", ex.counts.pendingProposals === 0);

  // ── §4 staff-direct actions ──────────────────────────────────────────────
  mail = [];
  let r = await api("POST", "/recurring/subs/rs_r1/pause", staff, {});
  ok("staff pause → 200 + paused", r.status === 200 && r.body.status === "paused", r);
  let [rsRow] = await q(`SELECT status FROM recurring_subscriptions WHERE id='rs_r1'`);
  ok("pause persisted", rsRow.status === "paused");
  let logRows = await q(`SELECT * FROM recurring_change_log WHERE org_id=$1 AND subscription_id='rs_r1' AND kind='paused'`, [ORG_A]);
  ok("pause wrote the movement ledger with the STAFF actor", logRows.length === 1 && logRows[0].actor === "staff" && logRows[0].actor_name === "Sam Staff", logRows[0]);
  let notes = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_rec_a' AND note LIKE 'Paused%'`, [ORG_A]);
  ok("pause logged a donor-timeline note", notes.length === 1, notes);
  await settle();
  ok("pause notified the donor by email", mailTo("ada@rec.test").length === 1, mail.map(m => m.to));

  // THE unsuppressibility assertion: throw every lever, then resume.
  await q(`UPDATE orgs SET recurring_dunning_enabled=false WHERE id=$1`, [ORG_A]);
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source) VALUES ('sup_rec_1',$1,'ada@rec.test','unsubscribe','test')`, [ORG_A]);
  mail = [];
  r = await api("POST", "/recurring/subs/rs_r1/resume", staff, {});
  ok("staff resume → 200", r.status === 200, r);
  await settle();
  ok("UNSUPPRESSIBLE: dunning kill-switch OFF + suppression-listed donor still gets the staff-change email",
    mailTo("ada@rec.test").length === 1, mail.map(m => m.to));
  logRows = await q(`SELECT * FROM recurring_change_log WHERE org_id=$1 AND subscription_id='rs_r1' AND kind='resumed' AND actor='staff'`, [ORG_A]);
  ok("resume wrote the ledger", logRows.length === 1);
  await q(`UPDATE orgs SET recurring_dunning_enabled=true WHERE id=$1`, [ORG_A]);

  mail = [];
  r = await api("PUT", "/recurring/subs/rs_r5/fund", admin, { fundId: "fund_rec_2" });
  ok("fund designation change → 200 + name echoed", r.status === 200 && r.body.fundName === "Bridge Fund", r.body);
  [rsRow] = await q(`SELECT fund_id FROM recurring_subscriptions WHERE id='rs_r5'`);
  ok("fund persisted on the subscription (renewals will route there)", rsRow.fund_id === "fund_rec_2");
  await settle();
  ok("fund change notified the donor", mailTo("ada@rec.test").length === 1);
  r = await api("PUT", "/recurring/subs/rs_r5/fund", admin, { fundId: "fund_foreign" });
  ok("foreign/unknown fund → 404, designation untouched", r.status === 404
    && (await q(`SELECT fund_id FROM recurring_subscriptions WHERE id='rs_r5'`))[0].fund_id === "fund_rec_2");

  mail = [];
  r = await api("POST", "/recurring/subs/rs_r4/cancel", staff, {});
  ok("staff cancel → 200", r.status === 200 && r.body.status === "canceled", r);
  logRows = await q(`SELECT * FROM recurring_change_log WHERE subscription_id='rs_r4' AND kind='canceled_voluntary'`);
  ok("staff cancel logs VOLUNTARY churn (a request honored, not a failed card)", logRows.length === 1 && logRows[0].actor === "staff");
  await settle();
  ok("cancel notified the donor", mailTo("dee@rec.test").length === 1);
  r = await api("POST", "/recurring/subs/rs_r4/cancel", staff, {});
  ok("cancel twice → 409", r.status === 409, r);

  r = await api("POST", "/recurring/subs/rs_b1/pause", admin, {});
  ok("foreign org's subscription → 404 (pause)", r.status === 404);
  r = await api("POST", "/recurring/subs/rs_b1/cancel", admin, {});
  ok("foreign org's subscription → 404 (cancel), no side effect", r.status === 404
    && (await q(`SELECT status FROM recurring_subscriptions WHERE id='rs_b1'`))[0].status === "active");

  // read_only org: gated writes 402; CANCEL is deliberately ungated.
  r = await api("POST", "/recurring/subs/rs_ro1/pause", adminRO, {});
  ok("read_only org: pause → 402 (gated write)", r.status === 402, r);
  mail = [];
  r = await api("POST", "/recurring/subs/rs_ro1/cancel", adminRO, {});
  ok("read_only org: CANCEL still works — a donor asking to stop is never blocked", r.status === 200, r);
  await settle();
  ok("…and still notifies the donor", mailTo("ro@recro.test").length === 1);

  // ── §5 proposals ─────────────────────────────────────────────────────────
  ok("bad kind → 400", (await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_a", kind: "steal" })).status === 400);
  ok("below-minimum amount → 400", (await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_a", kind: "amount", subId: "rs_r5", amountCents: 100 })).status === 400);
  ok("foreign donor → 404", (await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_bb", kind: "create", amountCents: 3000, interval: "month" })).status === 404);
  ok("donor without an email → 400 (a proposal is completed FROM an email)",
    (await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_f", kind: "create", amountCents: 3000, interval: "month" })).status === 400);
  ok("read_only org: proposals are gated writes → 402",
    (await api("POST", "/recurring/proposals", adminRO, { donorId: "d_rec_ro", kind: "create", amountCents: 3000, interval: "month" })).status === 402);

  // amount proposal on rs_r5 ($120/yr → $240/yr), completed by the donor.
  mail = [];
  r = await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_a", kind: "amount", subId: "rs_r5", amountCents: 24000 });
  ok("amount proposal → 201 pending", r.status === 201 && r.body.status === "pending", r);
  await settle();
  let pMail = mailTo("ada@rec.test")[0];
  const tokAmount = tokenFromMail(pMail);
  ok("proposal email carries the completion link", !!tokAmount, pMail?.html?.slice(0, 200));
  ok("token is NOT in the API response (email-only, like fundraiser edit tokens)", !JSON.stringify(r.body).includes(tokAmount || "@@"));
  const [pRow] = await q(`SELECT token_hash FROM recurring_proposals WHERE id=$1`, [r.body.id]);
  ok("token is stored HASHED (hash-at-rest)", pRow.token_hash !== tokAmount && pRow.token_hash.length === 64);
  roster = (await api("GET", "/recurring/roster", admin)).body;
  ok("roster shows the sub as PENDING DONOR ACTION",
    roster.subs.find(s => s.id === "rs_r5")?.displayStatus === "pending");
  const ex2 = (await api("GET", "/recurring/exceptions", admin)).body;
  ok("exceptions count the pending proposal", ex2.counts.pendingProposals === 1);

  let page = await rawGet(`/recurring/proposal?token=${tokAmount}`);
  ok("public proposal page renders (org name title-cased, amounts shown)",
    page.status === 200 && page.text.includes("Recurring Test Org") && page.text.includes("$240"), page.status);
  mail = [];
  let conf = await formPost("/recurring/proposal/confirm", { token: tokAmount });
  ok("donor confirm → success page", conf.status === 200 && /Done — thank you/.test(conf.text), conf.status);
  [rsRow] = await q(`SELECT amount, interval FROM recurring_subscriptions WHERE id='rs_r5'`);
  ok("Stripe-first reprice landed: $240/yr", parseFloat(rsRow.amount) === 240 && rsRow.interval === "year", rsRow);
  ok("the reprice hit Stripe (mock saw the subscription update)",
    stripeCalls.some(c => c.method === "POST" && c.path.includes("/v1/subscriptions/sub_r5")));
  logRows = await q(`SELECT * FROM recurring_change_log WHERE subscription_id='rs_r5' AND kind='amount_up'`);
  ok("upgrade logged with the DONOR actor (they completed it)", logRows.length === 1 && logRows[0].actor === "donor", logRows);
  ok("proposal marked completed", (await q(`SELECT status FROM recurring_proposals WHERE token_hash IS NOT NULL AND subscription_id='rs_r5'`))[0].status === "completed");
  await settle();
  ok("donor got the confirmation email", mailTo("ada@rec.test").length === 1);
  ok("a completed token is dead", (await rawGet(`/recurring/proposal?token=${tokAmount}`)).status === 400);
  roster = (await api("GET", "/recurring/roster", admin)).body;
  ok("roster returns to ACTIVE after completion", roster.subs.find(s => s.id === "rs_r5")?.displayStatus === "active");

  // frequency proposal (rs_r5 yearly → monthly).
  mail = [];
  r = await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_a", kind: "frequency", subId: "rs_r5", interval: "month" });
  await settle();
  const tokFreq = tokenFromMail(mailTo("ada@rec.test")[0]);
  conf = await formPost("/recurring/proposal/confirm", { token: tokFreq });
  [rsRow] = await q(`SELECT amount, interval FROM recurring_subscriptions WHERE id='rs_r5'`);
  ok("frequency change completed: now monthly, amount untouched", conf.status === 200 && rsRow.interval === "month" && parseFloat(rsRow.amount) === 240, rsRow);

  // create proposal → donor completes on Stripe Checkout → webhook finishes.
  mail = [];
  r = await api("POST", "/recurring/proposals", admin, { donorId: "d_rec_e", kind: "create", amountCents: 3000, interval: "month", fundId: "fund_rec_1" });
  ok("create proposal → 201", r.status === 201, r);
  const createPropId = r.body.id;
  await settle();
  const tokCreate = tokenFromMail(mailTo("eli@rec.test")[0]);
  page = await rawGet(`/recurring/proposal?token=${tokCreate}`);
  ok("create page shows amount + fund designation", page.status === 200 && page.text.includes("$30") && page.text.includes("River Fund"));
  conf = await formPost("/recurring/proposal/confirm", { token: tokCreate }, "manual");
  ok("create confirm → 303 to Stripe Checkout", conf.status === 303 && /mock-checkout\/subscription/.test(conf.location || ""), conf);
  const whC = await fireWebhook({
    id: "evt_rec_create_1", type: "checkout.session.completed", account: ACCT_A,
    data: { object: { id: "cs_done_1", mode: "subscription", subscription: "sub_new_e", customer: "cus_new_e",
      customer_email: "eli@rec.test", amount_total: 3000,
      metadata: { proposal_id: createPropId, org_id: ORG_A, donor_email: "eli@rec.test", frequency: "monthly", fund_id: "fund_rec_1" } } },
  });
  ok("checkout webhook accepted", whC.status === 200, whC);
  const [newSub] = await q(`SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id='sub_new_e'`);
  ok("subscription created with amount + FUND DESIGNATION stamped (BUILD-56 chain)",
    newSub && parseFloat(newSub.amount) === 30 && newSub.fund_id === "fund_rec_1" && newSub.donor_id === "d_rec_e", newSub);
  ok("created logged in the movement ledger", (await q(`SELECT * FROM recurring_change_log WHERE subscription_id=$1 AND kind='created'`, [newSub?.id || "none"])).length === 1);
  ok("create proposal completed by the webhook", (await q(`SELECT status FROM recurring_proposals WHERE id=$1`, [createPropId]))[0].status === "completed");

  // card-update proposal → 303 to a setup-mode session; supersede + resend + expiry.
  mail = [];
  r = await api("POST", "/recurring/proposals", admin, { donorId: "d_rec_b", kind: "card_update", subId: "rs_r2" });
  ok("card-update proposal → 201 (staff never touch card data — Stripe does)", r.status === 201, r);
  await settle();
  const tokCard = tokenFromMail(mailTo("ben@rec.test")[0]);
  conf = await formPost("/recurring/proposal/confirm", { token: tokCard }, "manual");
  ok("card-update confirm → 303 to a SETUP session", conf.status === 303 && /mock-checkout\/setup/.test(conf.location || ""), conf);

  // resend: exactly once, superseding the old token.
  mail = [];
  r = await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_c", kind: "amount", subId: "rs_r3", amountCents: 2000 });
  const p3 = r.body.id;
  await settle();
  const tok3a = tokenFromMail(mailTo("cy@rec.test")[0]);
  mail = [];
  r = await api("POST", `/recurring/proposals/${p3}/resend`, staff, {});
  ok("resend once → 200", r.status === 200 && r.body.resendCount === 1, r);
  await settle();
  const tok3b = tokenFromMail(mailTo("cy@rec.test")[0]);
  ok("resend supersedes: OLD token dead, NEW token live",
    (await rawGet(`/recurring/proposal?token=${tok3a}`)).status === 400
    && (await rawGet(`/recurring/proposal?token=${tok3b}`)).status === 200);
  ok("second resend → 409 (once means once)", (await api("POST", `/recurring/proposals/${p3}/resend`, staff, {})).status === 409);

  // supersede: a second identical ask cancels the first.
  r = await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_c", kind: "amount", subId: "rs_r3", amountCents: 2500 });
  ok("a new proposal supersedes the pending one (canceled, token dead)",
    (await q(`SELECT status FROM recurring_proposals WHERE id=$1`, [p3]))[0].status === "canceled"
    && (await rawGet(`/recurring/proposal?token=${tok3b}`)).status === 400);

  // expiry: pending past expires_at flips to expired and the link dies.
  const p4 = r.body.id;
  await q(`UPDATE recurring_proposals SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1`, [p4]);
  roster = (await api("GET", "/recurring/roster", admin)).body;
  ok("expired proposal no longer marks the roster pending",
    roster.subs.find(s => s.id === "rs_r3")?.pendingProposal == null);
  ok("expired proposal flipped by the lazy sweep", (await q(`SELECT status FROM recurring_proposals WHERE id=$1`, [p4]))[0].status === "expired");

  // proposal email is ALSO unsuppressible (same standing rule).
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source) VALUES ('sup_rec_2',$1,'cy@rec.test','unsubscribe','test')`, [ORG_A]);
  mail = [];
  r = await api("POST", "/recurring/proposals", staff, { donorId: "d_rec_c", kind: "card_update", subId: "rs_r3" });
  await settle();
  ok("proposal invitation reaches a suppression-listed donor (it IS the mechanism)",
    r.status === 201 && mailTo("cy@rec.test").length === 1);

  // ── §6 real-Stripe event shapes (BUILD-57 §2a drill, pinned) ─────────────
  // A real subscription charge's PI carries NO receipt_email and NO metadata
  // (and on API 2025+, NO invoice field at all) — the drill proved the old
  // handler silently skipped every real recurring charge. These pin the two
  // resolution paths and the new-payload shapes.

  // (a) invoice-carrying PI, no email: invoice → subscription → donor + fund.
  let wh = await fireWebhook({
    id: "evt_rec_shape_a", type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: "pi_shape_a", amount_received: 5000, invoice: "in_mock_r1", customer: "cus_rs_r1", metadata: {} } },
  });
  ok("real-shape PI (no email, has invoice) → 200", wh.status === 200, wh);
  let [g] = await q(`SELECT * FROM gifts WHERE stripe_payment_id='pi_shape_a'`);
  ok("renewal gift recorded via invoice→subscription resolution (no email needed)",
    g && g.donor_id === "d_rec_a" && parseFloat(g.amount) === 50, g);
  ok("…linked to its subscription AND fund-designated (BUILD-56 chain)",
    g?.recurring_subscription_id === "rs_r1" && g?.fund_id === "fund_rec_1", g);

  // (b) 2025+ shape: NO invoice field either — pi.customer is the only link.
  wh = await fireWebhook({
    id: "evt_rec_shape_b", type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: "pi_shape_b", amount_received: 2500, customer: "cus_rs_r2", metadata: {} } },
  });
  [g] = await q(`SELECT * FROM gifts WHERE stripe_payment_id='pi_shape_b'`);
  ok("2025+ PI (no email, no invoice) resolves by unique customer → gift linked",
    g && g.donor_id === "d_rec_b" && g.recurring_subscription_id === "rs_r2", g);

  // (c) 2025+ invoice.payment_failed: subscription under parent.subscription_details.
  wh = await fireWebhook({
    id: "evt_rec_shape_c", type: "invoice.payment_failed", account: ACCT_A,
    data: { object: { id: "in_shape_c", amount_due: 24000, customer: "cus_rs_r5",
      parent: { subscription_details: { subscription: "sub_r5", metadata: { donor_email: "ada@rec.test" } } },
      lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 25 * 86400 }, pricing: { price_details: { recurring: { interval: "month" } } } }] } } },
  });
  let [rsr5] = await q(`SELECT status FROM recurring_subscriptions WHERE id='rs_r5'`);
  ok("new-shape payment_failed still triggers the recovery family", rsr5.status === "past_due", rsr5);

  // (d) 2025+ invoice.payment_succeeded: recovery + next-charge sync from the
  // line period (subscription.updated does NOT fire at creation on real Stripe).
  wh = await fireWebhook({
    id: "evt_rec_shape_d", type: "invoice.payment_succeeded", account: ACCT_A,
    data: { object: { id: "in_shape_d", amount_paid: 24000, customer: "cus_rs_r5",
      parent: { subscription_details: { subscription: "sub_r5" } },
      lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } },
  });
  [rsr5] = await q(`SELECT status, current_period_end FROM recurring_subscriptions WHERE id='rs_r5'`);
  ok("new-shape payment_succeeded → recovered + current_period_end synced from the line period",
    rsr5.status === "recovered" && rsr5.current_period_end != null, rsr5);
  ok("recovery logged in the movement ledger",
    (await q(`SELECT * FROM recurring_change_log WHERE subscription_id='rs_r5' AND kind='recovered'`)).length >= 1);

  // (e) BUILD-62 — THE LIVE-CHARGE-THAT-LEFT-NO-TRACE RACE. On a brand-new
  // subscription Stripe emits payment_intent.succeeded ~2s BEFORE
  // checkout.session.completed and delivers them concurrently, so the
  // recurring_subscriptions row (a) and (b) rely on does NOT exist yet when
  // the PI handler runs. The old handler dropped the gift and returned 200
  // (money taken, no record). Here we deliberately fire the PI with a
  // customer that has NO recurring_subscriptions row — the handler must
  // resolve the donor from Stripe's own customer object and record the gift
  // anyway. (cus_race maps to eli@rec.test in the mock; d_rec_e exists.)
  ok("precondition: no recurring_subscriptions row exists for the racing customer",
    (await q(`SELECT id FROM recurring_subscriptions WHERE stripe_customer_id='cus_race'`)).length === 0);
  wh = await fireWebhook({
    id: "evt_rec_race", type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: "pi_race", amount_received: 100, customer: "cus_race", metadata: {} } },
  });
  ok("racing PI (no email, no invoice, NO local sub row yet) → 200", wh.status === 200, wh);
  [g] = await q(`SELECT * FROM gifts WHERE stripe_payment_id='pi_race'`);
  ok("BUILD-62: first recurring charge is RECORDED even when the sub row is not there yet",
    g && g.donor_id === "d_rec_e" && parseFloat(g.amount) === 1, g);
  // Idempotency holds on the customer-fallback path too: redelivery is a no-op.
  await fireWebhook({
    id: "evt_rec_race", type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: "pi_race", amount_received: 100, customer: "cus_race", metadata: {} } },
  });
  ok("BUILD-62: redelivered racing PI does not double-record",
    (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE stripe_payment_id='pi_race'`))[0].n === 1);

  if (sink) sink.close();
  if (smock) smock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
