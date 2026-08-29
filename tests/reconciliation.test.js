// BUILD-62 Part 3 — the RECONCILIATION GUARD.
//
// The instance was a webhook race that dropped a live recurring charge; the
// CLASS is "money can move at Stripe and leave no trace in Steward, and nothing
// notices." This suite pins the guard that closes the class: on demand (and on
// a schedule in prod) it walks every connected account and, both directions,
// reconciles succeeded charges against gift rows — a charge with no gift is an
// ALERT surfaced as a COUNT on /health (UptimeRobot keyword watch), with enough
// detail to act on (charge id, account, amount, age).
//
// Uses its own Stripe mock on :5603 (the run-all STRIPE_API_BASE seam) that
// answers ONLY for this suite's connected account, so other orgs in the scratch
// DB contribute nothing to the counts.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, api, q, closeDb, login, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "org_recon", ACCT = "acct_recon_x", SUPER = "recon-super@test.local";

// ── Stripe mock (:5603): parameterizable per scenario ───────────────────────
let mockCharges = [];                 // charges returned for ACCT only
let mockCanceledPIs = new Set();      // PIs whose retrieve() reports non-succeeded
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const acct = req.headers["stripe-account"];
        if (req.method === "GET" && req.url.startsWith("/v1/charges")) {
          // BUILD-63 — simulate a key that can't read a connected account's
          // charges (restricted key / revoked grant): the guard must count this
          // as a blind account, never silently as "clean".
          if (acct === "acct_blind") {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: { message: "no access to acct_blind", type: "invalid_request_error", code: "account_invalid" } }));
            return;
          }
          const data = acct === ACCT ? mockCharges : [];
          res.end(JSON.stringify({ object: "list", data, has_more: false }));
          return;
        }
        const pi = req.url.match(/^\/v1\/payment_intents\/([^/?]+)/);
        if (req.method === "GET" && pi) {
          const status = mockCanceledPIs.has(pi[1]) ? "canceled" : "succeeded";
          res.end(JSON.stringify({ id: pi[1], object: "payment_intent", status }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

const nowSec = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const runReconcile = token => api("POST", "/admin/reconcile/run", token);
const healthRecon = async () => (await api("GET", "/health")).body.reconciliation;

(async () => {
  const smock = await startStripeMock(STRIPE_MOCK_PORT);

  // ── fixture ───────────────────────────────────────────────────────────────
  for (const t of ["gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
           VALUES ($1,'Reconcile Org','recon',1,'active','growth',$2,true)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_recon',$1,$2,$3,'Recon Super','admin',true)`, [ORG, SUPER, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count)
           VALUES ('d_recon',$1,'Rae Recon','rae@recon.test','mid','steward',0,0)`, [ORG]);

  const token = await login(SUPER);

  // Gate: the guard is a platform op — a normal admin can't run it.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_recon_admin',$1,'recon-admin@test.local',$2,'Plain Admin','admin')`, [ORG, hash]);
  const adminTok = await login("recon-admin@test.local");
  ok("non-super-admin cannot run the reconciliation guard", (await runReconcile(adminTok)).status === 403);

  // ── Scenario 1 — a succeeded charge with NO gift is an ALERT ───────────────
  mockCharges = [
    { id: "ch_recon_1", status: "succeeded", amount: 1000, amount_refunded: 0, payment_intent: "pi_recon_1", created: nowSec() - 40 * 60 },
  ];
  let r = await runReconcile(token);
  ok("reconcile runs → 200", r.status === 200, r.status);
  ok("Scenario 1: a Stripe charge with no gift is counted as unrecorded",
    r.body.unrecordedCharges === 1 && r.body.orphanGifts === 0, r.body);
  const d1 = (r.body.divergences || []).find(d => d.kind === "charge_without_gift" && d.paymentIntent === "pi_recon_1");
  ok("…divergence carries enough detail to act on (charge id · account · amount · age)",
    !!d1 && d1.chargeId === "ch_recon_1" && d1.account === ACCT && d1.amount === 10 && d1.ageMin >= 39 && d1.ageMin <= 45, d1);
  let h = await healthRecon();
  ok("…and the alert is SURFACED on /health (the UptimeRobot paging signal)",
    h.unrecordedCharges === 1 && h.oldestUnrecordedAgeMin >= 39 && h.checkedAt != null, h);

  // ── Scenario 2 — record the gift → the alert clears ────────────────────────
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,stripe_payment_id,notes)
           VALUES ('g_recon_1',$1,'d_recon',10,$2,'pi_recon_1','recovered')`, [ORG, today()]);
  r = await runReconcile(token);
  ok("Scenario 2: once the gift exists, the charge is no longer unrecorded",
    r.body.unrecordedCharges === 0, r.body);
  h = await healthRecon();
  ok("…/health returns to zero", h.unrecordedCharges === 0 && h.oldestUnrecordedAgeMin === null, h);

  // ── Scenario 3 — a FULLY refunded charge with no gift is NOT an alert ───────
  mockCharges = [
    { id: "ch_recon_1", status: "succeeded", amount: 1000, amount_refunded: 0, payment_intent: "pi_recon_1", created: nowSec() - 40 * 60 },
    { id: "ch_recon_2", status: "succeeded", amount: 2000, amount_refunded: 2000, payment_intent: "pi_recon_2", created: nowSec() - 20 * 60 },
    { id: "ch_recon_3", status: "failed", amount: 3000, amount_refunded: 0, payment_intent: "pi_recon_3", created: nowSec() - 10 * 60 },
  ];
  r = await runReconcile(token);
  ok("Scenario 3: a fully-refunded charge and a failed charge are not counted",
    r.body.unrecordedCharges === 0, r.body);

  // ── Scenario 4 — the REVERSE: a gift with no succeeded charge behind it ─────
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,stripe_payment_id,notes)
           VALUES ('g_recon_orphan',$1,'d_recon',15,$2,'pi_orphan','phantom')`, [ORG, today()]);
  mockCanceledPIs = new Set(["pi_orphan"]);
  r = await runReconcile(token);
  const d4 = (r.body.divergences || []).find(d => d.kind === "gift_without_charge" && d.paymentIntent === "pi_orphan");
  ok("Scenario 4: a gift whose PI is not a succeeded charge is flagged (reverse direction)",
    r.body.orphanGifts >= 1 && !!d4 && d4.giftId === "g_recon_orphan" && d4.account === ACCT, r.body);

  // ── Scenario 5 — a gift whose PI IS succeeded (just outside the charge
  //     window) is NOT a false orphan ────────────────────────────────────────
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,stripe_payment_id,notes)
           VALUES ('g_recon_ok',$1,'d_recon',5,$2,'pi_windowed','older-but-real')`, [ORG, today()]);
  r = await runReconcile(token);
  const falseOrphan = (r.body.divergences || []).find(d => d.paymentIntent === "pi_windowed");
  ok("Scenario 5: a gift whose PI still reports succeeded is NOT a false orphan",
    !falseOrphan, r.body.divergences);

  // ── Scenario 6 — BUILD-63: a fully-refunded charge that STILL has a live gift.
  //     The charge.refunded handler should have reversed it; if a gift remains,
  //     the handler never ran (raced ahead of the gift, or the event isn't
  //     subscribed). A refunded donation sitting as a live gift is divergence. ──
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,stripe_payment_id,notes)
           VALUES ('g_recon_refunded',$1,'d_recon',30,$2,'pi_refunded','should-have-been-reversed')`, [ORG, today()]);
  mockCharges = [
    { id: "ch_recon_ref", status: "succeeded", amount: 3000, amount_refunded: 3000, payment_intent: "pi_refunded", created: nowSec() - 15 * 60 },
  ];
  r = await runReconcile(token);
  const d6 = (r.body.divergences || []).find(d => d.kind === "refunded_charge_with_live_gift" && d.paymentIntent === "pi_refunded");
  ok("Scenario 6: a fully-refunded charge whose gift was never reversed is flagged",
    !!d6 && d6.chargeId === "ch_recon_ref" && d6.account === ACCT, r.body.divergences);

  // ── Scenario 7 — BUILD-63: the guard must not report "clean" when it is BLIND.
  //     An account whose charges can't be read (restricted key / revoked grant)
  //     is counted, not silently skipped — a non-zero accountsErrored means an
  //     unrecordedCharges:0 is NOT a clean bill of health. ────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
           VALUES ('org_recon_blind','Blind Org','recon-blind',1,'active','growth','acct_blind',true)`, [])
    .catch(() => {});
  mockCharges = [];
  r = await runReconcile(token);
  ok("Scenario 7: a connected account that can't be read is counted as errored, not clean",
    r.body.accountsErrored >= 1 && r.body.accountsChecked >= 1, { errored: r.body.accountsErrored, checked: r.body.accountsChecked });
  h = await healthRecon();
  ok("…and /health surfaces accountsErrored so a blind guard is visible", h.accountsErrored >= 1, h);
  await q(`DELETE FROM orgs WHERE id='org_recon_blind'`, []).catch(() => {});

  if (smock) smock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
