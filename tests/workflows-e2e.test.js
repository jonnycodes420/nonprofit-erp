// BUILD-25 Part A — Workflow recipes, end to end (the highest-stakes suite).
// Local scratch server + Postgres (tests/README.md recipe) + a mock Resend sink.
//
// These five recipes send email IN THE ORG'S NAME TO REAL DONORS — the one class
// of bug you can't take back. This suite proves, against the real routes:
//
//   A0 (THE P0)  imports / re-imports / backfills / past-dated gifts fire ZERO
//                workflows and queue ZERO emails — recipes act on NEW LIVE events,
//                never on historical records being loaded. Includes the lapse
//                sweep: a donor imported already-lapsed never fires; a donor who
//                lapses WHILE live in Steward still does (guard is precise).
//   A1           each recipe fires correctly on a genuine trigger (real gift route,
//                real invoice.payment_failed webhook, real lapse sweep).
//   A2           trust guarantees: no double-send under a PARALLEL re-fire, toggle-
//                off is silent, org isolation, donor mail carries branding + a
//                CAN-SPAM postal footer while internal alerts do NOT, every fire
//                writes a workflow_runs row the UI run log matches, provider
//                failure never double-sends on retry.
//
// The server MUST be booted with RESEND_BASE_URL=http://localhost:5602 (Resend's
// SDK honors it) and STRIPE_WEBHOOK_SECRET=whsec_localtest so the online-recovery
// path is drivable. This suite starts its own capture server on 5602 — no real
// email ever leaves. See tests/README.md / tests/run-all.sh.

const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const A = "org_wfe_a", B = "org_wfe_b";
const ACCT_A = "acct_wfe_a";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Mock Resend sink — captures every email the server tries to send ─────────
let captured = [];        // { path, body }
let failNext = 0;         // when >0, the sink returns 500 this many times (provider-failure test)
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch {}
    if (failNext > 0) { failNext--; res.writeHead(500); res.end(JSON.stringify({ error: { message: "sink forced failure" } })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const clearMail = () => { captured = []; };
const mailTo = to => captured.filter(e => e.path === "/emails" && (e.body?.to === to || e.body?.to?.includes?.(to)));
const allMail = () => captured.filter(e => e.path === "/emails");

// Poll until predicate true (workflow fires are fire-and-forget) or give up.
async function waitFor(fn, { tries = 60, delay = 50 } = {}) {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(delay); }
  return false;
}

// ── DB fixture helpers ───────────────────────────────────────────────────────
const WIPE = ["workflow_runs", "workflows", "moves", "opportunities", "recurring_subscriptions",
  "payment_recovery_events", "fin_transactions", "gifts", "interactions", "tasks", "donors",
  "accounts", "fin_funds", "users"];
async function wipe(org) {
  for (const t of WIPE) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function seedOrg(org, slug, acct) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,recurring_dunning_enabled,legal_name,receipt_address)
           VALUES ($1,$2,$3,1,'active','growth',$4,true,$5,$6)`,
    [org, "WFE " + slug, slug, acct, "WFE " + slug + " Inc.", "1 Steward Way\nSpringfield, IL 62704"]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Contributions','revenue',true)`, [`acc_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
}
async function addUser(org, id, email, name, role) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, org, email, bcrypt.hashSync("loadtest1234", 10), name, role]);
}
// Seed a donor with full control over created_at / gift history / owner / stripe sub.
async function seedDonor(org, id, name, o = {}) {
  const { stage = "cultivate", giftCount = 0, lastGift = null, total = 0, createdAt = null,
    owner = null, ownerName = null, sub = null } = o;
  await q(
    `INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,tags,stripe_subscription_id,created_at)
     VALUES ($1,$2,$3,$4,'mid',$5,$6,$7,$8,$9,$10,'[]',$11, COALESCE($12::timestamptz, NOW()))`,
    [id, org, name, `${id}@wfe.local`, stage, total, giftCount, lastGift, owner, ownerName, sub, createdAt]);
}
const enable = (tok, id, config) => api("PUT", `/workflows/${id}`, tok, { enabled: true, ...(config ? { config } : {}) });
const disable = (tok, id) => api("PUT", `/workflows/${id}`, tok, { enabled: false });
const wfByKey = (list, key) => list.find(w => w.recipe_key === key);
const runCountOrg = async org => (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE org_id=$1`, [org]))[0].n;
const runCountWf = async id => (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1`, [id]))[0].n;
const taskCount = async (org, donorId) => (await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1${donorId ? ` AND donor_id='${donorId}'` : ""}`, [org]))[0].n;

// Fire a signed Stripe connect webhook of an arbitrary type/object.
async function fireWebhook(type, object, evtId, account = ACCT_A) {
  const payload = JSON.stringify({ id: evtId, type, account, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  await new Promise((res, rej) => { mock.on("error", rej); mock.listen(5602, res); });
  await wipe(A); await wipe(B);
  await seedOrg(A, "wfe-a", ACCT_A);
  await seedOrg(B, "wfe-b", null);
  await addUser(A, "u_a_admin", "a-admin@wfe.local", "Admin A", "admin");
  await addUser(A, "u_a_ed", "a-ed@wfe.local", "ED A", "admin");
  await addUser(A, "u_a_off", "a-off@wfe.local", "Officer A", "staff");
  await addUser(B, "u_b_admin", "b-admin@wfe.local", "Admin B", "admin");
  const tA = await login("a-admin@wfe.local");
  const tB = await login("b-admin@wfe.local");

  const recipesA = () => api("GET", "/workflows", tA).then(r => r.body);

  // ═══════════════════════════════════════════════════════════════════════════
  // A0 — THE P0: imports / backfills / past-dated gifts fire ZERO workflows.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── A0: imports must fire ZERO workflows (the P0) ──");
  let list = await recipesA();
  ok("A0 setup: 5 recipes provision, disabled by default", list.length === 5 && list.every(w => !w.enabled));
  // Turn ON ALL FIVE — the worst case a real org's first onboarding faces.
  for (const w of list) await enable(tA, w.id, w.recipe_key === "major_gift_alert" ? { threshold: 1000 } : undefined);
  list = await recipesA();
  ok("A0 setup: all 5 recipes enabled", list.every(w => w.enabled));
  clearMail();

  // Import a mix through the REAL importers: a brand-new donor whose FIRST gift
  // is fresh-dated (would trip new_donor if it were live), a big fresh gift
  // (would trip major_gift), and already-lapsed historical donors (>365d).
  const ledger = [
    { key: "fresh@wfe.local", donor: { name: "Fresh Import", email: "fresh@wfe.local" }, gift: { amount: 50, date: daysAgo(1) } },
    { key: "whale@wfe.local", donor: { name: "Whale Import", email: "whale@wfe.local" }, gift: { amount: 25000, date: daysAgo(2) } },
    { key: "lapsed1@wfe.local", donor: { name: "Lapsed One", email: "lapsed1@wfe.local" }, gift: { amount: 300, date: daysAgo(500) } },
    { key: "lapsed2@wfe.local", donor: { name: "Lapsed Two", email: "lapsed2@wfe.local" }, gift: { amount: 800, date: daysAgo(900) } },
  ];
  const { groupTransactions } = await import("../client/src/lib/importShape.js");
  const grouped = groupTransactions(ledger);
  const imp = await api("POST", "/donors/import-combined", tA, grouped);
  ok("A0: combined import 200 (4 donors, 4 gifts)", imp.status === 200 && imp.body.created === 4 && imp.body.giftsInserted === 4, imp.body);
  // Aggregate importer path too (one-row-per-donor with totals).
  const aggImp = await api("POST", "/donors/import", tA, {
    donors: [{ name: "Agg Donor", email: "agg@wfe.local", total_giving: 5000, last_gift_date: daysAgo(3), gift_count: 1 }],
  });
  ok("A0: aggregate import 200", aggImp.status === 200, aggImp.body);
  // Backfill more history onto an existing donor (past-dated gifts) via import-history.
  const jane = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email='fresh@wfe.local'`, [A]))[0];
  const backfill = await api("POST", "/gifts/import-history", tA, {
    gifts: [{ donorId: jane.id, amount: 120, date: daysAgo(700) }, { donorId: jane.id, amount: 90, date: daysAgo(650) }] });
  ok("A0: gift-history backfill 200", backfill.status === 200, backfill.body);

  // Give any fire-and-forget path a chance to (wrongly) fire, then assert NONE did.
  await sleep(400);
  ok("A0 [P0]: import fired ZERO workflow_runs", (await runCountOrg(A)) === 0, await runCountOrg(A));
  ok("A0 [P0]: import queued ZERO emails", allMail().length === 0, allMail().map(m => m.body?.to));

  // Re-import the same file (the idempotent re-run / re-migration case).
  const reimp = await api("POST", "/donors/import-combined", tA, grouped);
  ok("A0: re-import 200 (0 created, 4 duplicates)", reimp.status === 200 && reimp.body.created === 0, reimp.body);
  await sleep(300);
  ok("A0 [P0]: re-import still ZERO runs, ZERO emails", (await runCountOrg(A)) === 0 && allMail().length === 0);

  // The lapse SWEEP is the only non-webhook fire path. Run it now: the imported
  // already-lapsed donors must NOT fire (they were loaded already past the
  // window — history, not a live crossing).
  const sweep1 = await api("POST", "/workflows/run-sweeps", tA);
  ok("A0: run-sweeps 200", sweep1.status === 200, sweep1.body);
  await sleep(200);
  ok("A0 [P0]: lapse sweep did NOT fire for imported-already-lapsed donors", (await runCountOrg(A)) === 0, await runCountOrg(A));
  ok("A0 [P0]: still ZERO emails after sweep", allMail().length === 0);

  // Precision: a donor who lapsed WHILE LIVE in Steward (created 800d ago, last
  // gift 400d ago) MUST still fire — the guard is precise, not a blanket off.
  await seedDonor(A, "d_live_lapse", "Live Lapser", { giftCount: 2, lastGift: daysAgo(400), total: 500, createdAt: daysAgo(800) });
  clearMail();
  await api("POST", "/workflows/run-sweeps", tA);
  ok("A0: genuine in-system lapse DOES fire (guard precise)",
    await waitFor(async () => (await runCountOrg(A)) === 1), await runCountOrg(A));
  const liveTags = (await q(`SELECT tags FROM donors WHERE id='d_live_lapse'`))[0].tags;
  ok("A0: live-lapse added the 'lapsing' tag", (Array.isArray(liveTags) ? liveTags : JSON.parse(liveTags)).includes("lapsing"));
  ok("A0: live-lapse created a re-engagement task", (await taskCount(A, "d_live_lapse")) === 1);
  ok("A0: lapsing default (sendEmail off) queued NO donor email", mailTo("d_live_lapse@wfe.local").length === 0);
  // Re-run the sweep — dedup per (donor,last_gift_date) means no re-fire.
  await api("POST", "/workflows/run-sweeps", tA);
  await sleep(200);
  ok("A0: re-running sweep does NOT re-fire the same lapse (dedup)", (await runCountOrg(A)) === 1, await runCountOrg(A));

  // ═══════════════════════════════════════════════════════════════════════════
  // A1 — each recipe fires correctly on a GENUINE trigger. Fresh org state.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── A1: each recipe fires on a genuine trigger ──");
  for (const t of ["workflow_runs", "fin_transactions", "interactions", "gifts", "tasks", "recurring_subscriptions", "payment_recovery_events", "donors"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  let L = await recipesA();
  for (const w of L) await disable(tA, w.id);
  const wfNew = wfByKey(L, "new_donor_welcome"), wfMajor = wfByKey(L, "major_gift_alert"),
        wfFailed = wfByKey(L, "failed_recurring_recovery"), wfLapse = wfByKey(L, "lapsing_reengage"),
        wfThanks = wfByKey(L, "instant_gift_thanks");

  // ── A1.2 new_donor_welcome — real first gift via POST /donors/:id/gifts ──
  await enable(tA, wfNew.id);
  clearMail();
  const nd = await api("POST", "/donors", tA, { name: "New Donor", email: "newdonor@wfe.local" });
  const ndId = nd.body.id;
  const g1 = await api("POST", `/donors/${ndId}/gifts`, tA, { amount: 50, date: daysAgo(0) });
  ok("A1.2: first gift recorded (201)", g1.status === 201, g1.body);
  ok("A1.2: new_donor fired on a genuine FIRST gift → 1 run",
    await waitFor(async () => (await runCountWf(wfNew.id)) === 1), await runCountWf(wfNew.id));
  ok("A1.2: branded thank-you email sent to the DONOR",
    await waitFor(() => mailTo("newdonor@wfe.local").length === 1), mailTo("newdonor@wfe.local").length);
  const thxHtml = mailTo("newdonor@wfe.local")[0]?.body?.html || "";
  ok("A1.2: thank-you names the donor's first gift + org", /first gift/i.test(thxHtml) && /WFE wfe-a/.test(thxHtml), thxHtml.slice(0, 200));
  // Poll: the task insert is a separate async action that can land after the
  // email (same reserve-then-execute window as the A1.4 fix; flaked on CI
  // 2026-08-12 run 31551766829).
  ok("A1.2: new_donor created a welcome-call task",
    await waitFor(async () => (await taskCount(A, ndId)) === 1), await taskCount(A, ndId));
  // Second gift to the SAME donor is not a first gift — must NOT fire new_donor.
  clearMail();
  await api("POST", `/donors/${ndId}/gifts`, tA, { amount: 75, date: daysAgo(0) });
  await sleep(300);
  ok("A1.2: a repeat (non-first) gift does NOT fire new_donor", (await runCountWf(wfNew.id)) === 1, await runCountWf(wfNew.id));
  ok("A1.2: no second thank-you email on the repeat gift", mailTo("newdonor@wfe.local").length === 0);
  await disable(tA, wfNew.id);

  // ── A1.4 major_gift_alert — threshold + no-owner graceful fallback ──
  await enable(tA, wfMajor.id, { threshold: 1000 });
  // Donor WITH an owner.
  await seedDonor(A, "d_major_owned", "Major Owned", { owner: "u_a_off", ownerName: "Officer A" });
  const small = await api("POST", `/donors/d_major_owned/gifts`, tA, { amount: 500, date: daysAgo(0) });
  ok("A1.4: under-threshold gift ($500) does nothing", small.status === 201 && await waitFor(async () => true) && (await runCountWf(wfMajor.id)) === 0, await runCountWf(wfMajor.id));
  await api("POST", `/donors/d_major_owned/gifts`, tA, { amount: 5000, date: daysAgo(0) });
  ok("A1.4: over-threshold gift ($5000) fires major_gift", await waitFor(async () => (await runCountWf(wfMajor.id)) === 1), await runCountWf(wfMajor.id));
  const ownedTask = await q(`SELECT * FROM tasks WHERE org_id=$1 AND donor_id='d_major_owned' AND assigned_to='u_a_off' AND title ILIKE 'Stewardship alert%'`, [A]);
  ok("A1.4: alert task assigned to the donor's owner", ownedTask.length === 1, ownedTask.length);
  // Donor with NO owner → graceful fallback to the ED (first admin), never dropped.
  await seedDonor(A, "d_major_noowner", "Major NoOwner", { owner: null });
  await api("POST", `/donors/d_major_noowner/gifts`, tA, { amount: 9000, date: daysAgo(0) });
  ok("A1.4: no-owner major gift STILL fires (never silently dropped)", await waitFor(async () => (await runCountWf(wfMajor.id)) === 2), await runCountWf(wfMajor.id));
  const fbTask = await q(`SELECT * FROM tasks WHERE org_id=$1 AND donor_id='d_major_noowner' AND title ILIKE 'Stewardship alert%'`, [A]);
  ok("A1.4: no-owner alert falls back to the ED/admin (assigned, not orphaned)",
    fbTask.length === 1 && fbTask[0].assigned_to && ["u_a_admin", "u_a_ed"].includes(fbTask[0].assigned_to), fbTask.map(t => t.assigned_to));
  // The engine RESERVES the run row before executing actions and writes
  // actions_taken afterwards — so poll until the write lands, not just until
  // the row exists (the row-exists-but-actions-empty window stretched under
  // full-run load and blocked two pushes on 2026-08-11).
  let fbRun;
  ok("A1.4: run log records the fallback truthfully (assignedFallback:true)",
    await waitFor(async () => {
      fbRun = (await api("GET", `/workflows/${wfMajor.id}/runs`, tA)).body.find(r => r.donor_id === "d_major_noowner");
      return !!(fbRun && (fbRun.actions_taken || []).some(a => a.type === "notify_owner" && a.assignedFallback === true));
    }), fbRun?.actions_taken);
  await disable(tA, wfMajor.id);

  // ── A1.1 failed_recurring_recovery — genuine invoice.payment_failed webhook ──
  await enable(tA, wfFailed.id);
  await seedDonor(A, "d_recur", "Recurring Donor", { sub: "sub_wfe_1", stage: "steward" });
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,stripe_customer_id,amount,interval,status)
           VALUES ('rs_wfe_1',$1,'d_recur','sub_wfe_1','cus_wfe_1',25,'month','active')`, [A]);
  clearMail();
  const failEvt = await fireWebhook("invoice.payment_failed", { id: "in_wfe_1", subscription: "sub_wfe_1", customer: "cus_wfe_1", amount_due: 2500 }, "evt_wfe_fail_1");
  ok("A1.1: invoice.payment_failed webhook 200", failEvt.status === 200, failEvt.body);
  ok("A1.1: failed_recurring fired → 1 run", await waitFor(async () => (await runCountWf(wfFailed.id)) === 1), await runCountWf(wfFailed.id));
  ok("A1.1: branded recovery (card-update) email sent to the DONOR",
    await waitFor(() => mailTo("d_recur@wfe.local").length === 1), mailTo("d_recur@wfe.local").length);
  const recHtml = mailTo("d_recur@wfe.local")[0]?.body?.html || "";
  ok("A1.1: recovery email carries a card-update link", /update-card\?token=/.test(recHtml), recHtml.slice(0, 120));
  ok("A1.1: failed_recurring created a follow-up task", (await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1 AND donor_id='d_recur'`, [A]))[0].n === 1);
  // Dunning coordination — after recipe sent day-0, the subscription is advanced
  // past dunning_step 0 so the always-on engine won't ALSO send a day-0 email.
  const subRow = (await q(`SELECT dunning_step FROM recurring_subscriptions WHERE stripe_subscription_id='sub_wfe_1'`))[0];
  ok("A1.1: dunning cadence advanced past day-0 (no double day-0 send)", subRow.dunning_step === 1, subRow.dunning_step);
  // Redelivery of the SAME event id is a strict no-op (recoveryEventAlreadyProcessed).
  clearMail();
  await fireWebhook("invoice.payment_failed", { id: "in_wfe_1", subscription: "sub_wfe_1", customer: "cus_wfe_1", amount_due: 2500 }, "evt_wfe_fail_1");
  await sleep(300);
  ok("A1.1: redelivered webhook → no second run, no second email", (await runCountWf(wfFailed.id)) === 1 && mailTo("d_recur@wfe.local").length === 0);
  await disable(tA, wfFailed.id);

  // ── A1.3 lapsing_reengage — optional email leg via config.sendEmail ──
  await enable(tA, wfLapse.id, { sendEmail: true, lapseDays: 365 });
  await seedDonor(A, "d_lapse_email", "Lapse Emailer", { giftCount: 1, lastGift: daysAgo(400), total: 200, createdAt: daysAgo(900) });
  clearMail();
  await api("POST", "/workflows/run-sweeps", tA);
  ok("A1.3: lapsing sweep fires for a live-lapsed donor", await waitFor(async () => (await runCountWf(wfLapse.id)) === 1), await runCountWf(wfLapse.id));
  ok("A1.3: optional re-engagement email sent to the DONOR when checked",
    await waitFor(() => mailTo("d_lapse_email@wfe.local").length === 1), mailTo("d_lapse_email@wfe.local").length);
  await api("POST", "/workflows/run-sweeps", tA);
  await sleep(200);
  ok("A1.3: lapsing does NOT re-fire on the next tick while still lapsed (dedup)",
    (await runCountWf(wfLapse.id)) === 1 && mailTo("d_lapse_email@wfe.local").length === 1);
  await disable(tA, wfLapse.id);

  // ── A1.5 instant_gift_thanks — three recipient modes + threshold, once ──
  await seedDonor(A, "d_gift", "Gift Donor", { owner: "u_a_off", ownerName: "Officer A" });
  await enable(tA, wfThanks.id, { notify: "both", threshold: 0 });
  clearMail();
  await api("POST", `/donors/d_gift/gifts`, tA, { amount: 40, date: daysAgo(0) });
  ok("A1.5: instant_gift_thanks fires on any gift → 1 run", await waitFor(async () => (await runCountWf(wfThanks.id)) === 1), await runCountWf(wfThanks.id));
  ok("A1.5: notify=both emails BOTH the officer and the ED (internal)",
    await waitFor(() => mailTo("a-off@wfe.local").length === 1 && (mailTo("a-admin@wfe.local").length + mailTo("a-ed@wfe.local").length) >= 1), allMail().map(m => m.body?.to));
  ok("A1.5: exactly one thank task, assigned to the officer",
    (await q(`SELECT * FROM tasks WHERE org_id=$1 AND donor_id='d_gift'`, [A])).length === 1);
  // ed-only, then owner-only
  clearMail(); await api("PUT", `/workflows/${wfThanks.id}`, tA, { config: { notify: "ed", threshold: 0 } });
  await api("POST", `/donors/d_gift/gifts`, tA, { amount: 41, date: daysAgo(0) });
  await waitFor(async () => (await runCountWf(wfThanks.id)) === 2);
  await sleep(150);
  ok("A1.5: notify=ed emails admins only (not the officer)",
    mailTo("a-off@wfe.local").length === 0 && (mailTo("a-admin@wfe.local").length + mailTo("a-ed@wfe.local").length) >= 1, allMail().map(m => m.body?.to));
  clearMail(); await api("PUT", `/workflows/${wfThanks.id}`, tA, { config: { notify: "owner", threshold: 0 } });
  await api("POST", `/donors/d_gift/gifts`, tA, { amount: 42, date: daysAgo(0) });
  await waitFor(async () => (await runCountWf(wfThanks.id)) === 3);
  await sleep(150);
  ok("A1.5: notify=owner emails the officer only (not the ED)",
    mailTo("a-off@wfe.local").length === 1 && mailTo("a-ed@wfe.local").length === 0, allMail().map(m => m.body?.to));
  // threshold gate
  clearMail(); await api("PUT", `/workflows/${wfThanks.id}`, tA, { config: { notify: "both", threshold: 100 } });
  await api("POST", `/donors/d_gift/gifts`, tA, { amount: 50, date: daysAgo(0) });
  await sleep(300);
  ok("A1.5: below-threshold gift ($50 < $100) does NOT fire", (await runCountWf(wfThanks.id)) === 3, await runCountWf(wfThanks.id));
  await api("POST", `/donors/d_gift/gifts`, tA, { amount: 150, date: daysAgo(0) });
  ok("A1.5: at/above-threshold gift ($150) fires", await waitFor(async () => (await runCountWf(wfThanks.id)) === 4), await runCountWf(wfThanks.id));
  await disable(tA, wfThanks.id);

  // ═══════════════════════════════════════════════════════════════════════════
  // A2 — trust guarantees.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── A2: trust guarantees ──");
  for (const t of ["workflow_runs", "fin_transactions", "interactions", "gifts", "tasks", "donors"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  L = await recipesA();
  const wfNew2 = wfByKey(L, "new_donor_welcome"), wfThanks2 = wfByKey(L, "instant_gift_thanks");

  // ── A2: no double-send under a PARALLEL re-fire (real race on the dedup key) ──
  await enable(tA, wfNew2.id);
  await seedDonor(A, "d_race", "Race Donor", { giftCount: 0 });
  clearMail();
  // Fire the SAME event (same dedupKey) from FIVE simultaneous requests.
  const dk = "gift:race-1";
  const races = await Promise.all(Array.from({ length: 5 }, () =>
    api("POST", "/workflows/simulate", tA, { trigger: "gift_received", donorId: "d_race", amount: 50, isFirstGift: true, dedupKey: dk })));
  const totalRan = races.reduce((n, r) => n + (r.body?.ran?.length || 0), 0);
  await sleep(300);
  ok("A2: 5 parallel identical fires → exactly ONE ran across all of them", totalRan === 1, totalRan);
  ok("A2: exactly one workflow_runs row for the dedup key (DB unique held under race)",
    (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1 AND dedup_key=$2`, [wfNew2.id, dk]))[0].n === 1);
  ok("A2: exactly one thank-you email despite the parallel storm",
    await waitFor(() => mailTo("d_race@wfe.local").length === 1) && mailTo("d_race@wfe.local").length === 1, mailTo("d_race@wfe.local").length);
  ok("A2: exactly one welcome task despite the parallel storm", (await taskCount(A, "d_race")) === 1, await taskCount(A, "d_race"));

  // ── A2: toggle-off is silent ──
  await disable(tA, wfNew2.id);
  clearMail();
  const offFire = await api("POST", "/workflows/simulate", tA, { trigger: "gift_received", donorId: "d_race", amount: 50, isFirstGift: true, dedupKey: "gift:off-1" });
  await sleep(200);
  ok("A2: a disabled recipe fires nothing", offFire.body.ran.length === 0 && mailTo("d_race@wfe.local").length === 0);

  // ── A2: branding + CAN-SPAM footer on DONOR mail; internal alerts have NO footer ──
  await enable(tA, wfNew2.id);
  await enable(tA, wfThanks2.id, { notify: "ed", threshold: 0 });
  await seedDonor(A, "d_brand", "Brand Donor", { giftCount: 0 });
  clearMail();
  await api("POST", `/donors/d_brand/gifts`, tA, { amount: 60, date: daysAgo(0) });
  await waitFor(() => mailTo("d_brand@wfe.local").length === 1 && (mailTo("a-admin@wfe.local").length + mailTo("a-ed@wfe.local").length) >= 1);
  await sleep(150);
  const donorMail = mailTo("d_brand@wfe.local")[0]?.body?.html || "";
  const internalMail = (mailTo("a-admin@wfe.local")[0] || mailTo("a-ed@wfe.local")[0])?.body?.html || "";
  ok("A2: donor mail carries org branding header", /WFE wfe-a/.test(donorMail), donorMail.slice(0, 120));
  ok("A2: donor mail carries the CAN-SPAM postal footer (legal name + address)",
    /WFE wfe-a Inc\./.test(donorMail) && /Springfield, IL 62704/.test(donorMail), donorMail.slice(-300));
  ok("A2: donor mail has an unsubscribe link", /Unsubscribe/i.test(donorMail));
  ok("A2: internal alert has NO unsubscribe/CAN-SPAM footer (it's staff mail)",
    internalMail.length > 0 && !/Unsubscribe/i.test(internalMail), internalMail.slice(-200));
  await disable(tA, wfThanks2.id);

  // ── A2: every fire writes a run row the UI run log matches ──
  const uiRuns = (await api("GET", `/workflows/${wfNew2.id}/runs`, tA)).body;
  const dbRuns = await q(`SELECT id FROM workflow_runs WHERE workflow_id=$1`, [wfNew2.id]);
  ok("A2: GET /workflows/:id/runs count == DB workflow_runs count", uiRuns.length === dbRuns.length && uiRuns.length > 0, { ui: uiRuns.length, db: dbRuns.length });
  ok("A2: every run row carries its dedup_key + parsed actions_taken",
    uiRuns.every(r => r.dedup_key && Array.isArray(r.actions_taken)));

  // ── A2: provider failure never double-sends on retry ──
  await seedDonor(A, "d_provfail", "Provider Fail", { giftCount: 0 });
  clearMail();
  failNext = 1; // the sink 500s the first email attempt
  await api("POST", `/donors/d_provfail/gifts`, tA, { amount: 55, date: daysAgo(0) });
  ok("A2: provider failure still records the run (never silently lost)",
    await waitFor(async () => (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1 AND donor_id='d_provfail'`, [wfNew2.id]))[0].n === 1), "run recorded");
  // Poll: the run row is reserved BEFORE the send attempt executes, so the
  // attempt can land after the previous waitFor resolves. Without the poll,
  // this read 0 on a loaded runner AND the late send then landed after the
  // clearMail() below, cascading into a false "double-send" failure (both
  // seen on CI 2026-08-12 run 31551766829).
  ok("A2: the failed send was attempted exactly once (no crash, no silent success)",
    await waitFor(() => mailTo("d_provfail@wfe.local").length === 1), mailTo("d_provfail@wfe.local").length);
  // Re-firing the SAME gift event is a no-op — so a retry never double-sends.
  const gRow = (await q(`SELECT id FROM gifts WHERE donor_id='d_provfail'`))[0];
  clearMail(); failNext = 0;
  await api("POST", "/workflows/simulate", tA, { trigger: "gift_received", donorId: "d_provfail", amount: 55, isFirstGift: true, dedupKey: `gift:${gRow.id}` });
  await sleep(250);
  ok("A2: retrying the same event after a provider failure does NOT double-send", mailTo("d_provfail@wfe.local").length === 0, mailTo("d_provfail@wfe.local").length);
  await disable(tA, wfNew2.id);

  // ── A2: org isolation — A's events never touch B's donors ──
  const listB = await api("GET", "/workflows", tB).then(r => r.body);
  await enable(tB, wfByKey(listB, "new_donor_welcome").id);
  clearMail();
  const cross = await api("POST", "/workflows/simulate", tB, { trigger: "gift_received", donorId: "d_race", amount: 50, isFirstGift: true, dedupKey: "gift:cross" });
  ok("A2: B simulating against A's donor → 404, no side effect", cross.status === 404);
  ok("A2: no run planted in B for A's donor", (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE org_id=$1 AND donor_id='d_race'`, [B]))[0].n === 0);
  ok("A2: B cannot read A's workflow runs (404)", (await api("GET", `/workflows/${wfNew2.id}/runs`, tB)).status === 404);
  ok("A2: A's runs never appear under B's org", (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE org_id=$1 AND workflow_id=$2`, [B, wfNew2.id]))[0].n === 0);

  await wipe(A); await wipe(B);
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); try { mock.close(); } catch {} await closeDb().catch(() => {}); process.exit(1); });
