// BUILD-09 — Finance reintegration verification.
// Local scratch server + Postgres (tests/README.md recipe). No live Stripe key
// needed: /finance/stripe-summary degrades to {connected:false} without one.
//
// Optional connected-shape check (verifies the real balance/payouts branch):
//   STRIPE_TEST_KEY      sk_test_… (also boot the server with STRIPE_SECRET_KEY
//                        set to it)
//   STRIPE_TEST_ACCOUNT  a test-mode connected account id
//
// What it proves:
//   - stripe-summary: {connected:false} with no account (and no key); org-scoped
//     strictly by the caller's own org row (org B never sees org A's account);
//     connected:true balance/payouts shape when creds are supplied
//   - unified-ledger provenance: a donor-profile gift syncs to EXACTLY ONE
//     fin_transactions row, stamped source='gift' + donor_id; a manual ledger
//     entry is source='manual'; GET /finance/transactions returns both fields
//     and the donor_id filter works (column now exists)
//   - write-gating: a read_only (trial_expired) org gets 402 on every fin write
//     route, 200 on reads, and DELETE stays allowed (ungated convention)
//   - schema: donor_id + source columns and the two org-scoped indexes exist

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const SK = process.env.STRIPE_TEST_KEY;
const ACCT = process.env.STRIPE_TEST_ACCOUNT;
const HAS_STRIPE = SK && /^sk_test_/.test(SK) && ACCT;

const ORG_A = "org_fin_a";       // active, connected (if creds), has COA + fund + donor
const ORG_B = "org_fin_b";       // read_only (trial_expired)
const today = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["fin_audit_log", "fin_transactions", "budgets", "accounts", "fin_funds", "gifts", "interactions", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);

  // Org A — active. stripe_account_id only if we have test creds to prove the
  // connected branch; otherwise left null so we prove the disconnected branch.
  await q(
    `INSERT INTO orgs (id, name, onboarding_complete, subscription_status, plan, stripe_account_id)
     VALUES ($1,'Finance Fixture A',1,'active','growth',$2)`,
    [ORG_A, HAS_STRIPE ? ACCT : null]
  );
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ('u_fin_a',$1,'fin-a@test.local',$2,'Fin A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_fin_a1',$1,'4010','Individual Contributions','revenue',true)`, [ORG_A]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_fin_a2',$1,'6010','Program Supplies','expense',true)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_fin_a1',$1,'General Operating',false)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_fin_a1',$1,'Ada Donor','ada@test.local','new','cultivate',0,0)`, [ORG_A]);

  // Org B — read_only (trial expired). Same COA so write routes reach the gate.
  await q(
    `INSERT INTO orgs (id, name, onboarding_complete, subscription_status, plan)
     VALUES ($1,'Finance Fixture B',1,'trial_expired','trial')`,
    [ORG_B]
  );
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ('u_fin_b',$1,'fin-b@test.local',$2,'Fin B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_fin_b1',$1,'4010','Individual Contributions','revenue',true)`, [ORG_B]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_fin_b1',$1,'General Operating',false)`, [ORG_B]);
}

(async () => {
  await fixture();
  console.log("fixture ready" + (HAS_STRIPE ? " (with Stripe test creds)" : " (no Stripe creds — disconnected-branch only)") + "\n");
  const a = await login("fin-a@test.local");
  const b = await login("fin-b@test.local");

  // ── 1. Schema: new columns + indexes ──
  {
    const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='fin_transactions' AND column_name IN ('donor_id','source')`);
    ok("fin_transactions has donor_id + source columns", cols.length === 2, cols.map(c => c.column_name));
    const idx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='fin_transactions' AND indexname IN ('idx_fin_txns_org_date','idx_fin_txns_org_fund')`);
    ok("fin_transactions org-scoped indexes exist", idx.length === 2, idx.map(i => i.indexname));
  }

  // ── 2. stripe-summary ──
  {
    const rb = await api("GET", "/finance/stripe-summary", b);
    ok("stripe-summary: org with no account → connected:false", rb.status === 200 && rb.body?.connected === false, rb.body);

    const ra = await api("GET", "/finance/stripe-summary", a);
    ok("stripe-summary: 200 for connected org", ra.status === 200);
    if (HAS_STRIPE) {
      ok("stripe-summary: connected:true", ra.body?.connected === true, ra.body);
      ok("stripe-summary: balance available/pending are numbers", typeof ra.body?.balance?.available === "number" && typeof ra.body?.balance?.pending === "number", ra.body?.balance);
      ok("stripe-summary: payouts is an array (≤5)", Array.isArray(ra.body?.payouts) && ra.body.payouts.length <= 5, ra.body?.payouts?.length);
    } else {
      ok("stripe-summary: connected:false without a Stripe key", ra.body?.connected === false, ra.body);
    }
    // Org-scope: B must NOT see A's account even if A has one configured.
    ok("stripe-summary: org B never surfaces org A's account", rb.body?.connected === false);
  }

  // ── 3. Unified-ledger provenance — donor-profile gift ──
  {
    const g = await api("POST", "/donors/d_fin_a1/gifts", a, { amount: 250, date: today, type: "cash" });
    ok("gift logged (201)", g.status === 201, g.status);
    const rows = await q(`SELECT source, donor_id, amount, type FROM fin_transactions WHERE org_id=$1 AND donor_id='d_fin_a1'`, [ORG_A]);
    ok("gift synced to EXACTLY ONE fin_transactions row (no double-count)", rows.length === 1, rows.length);
    ok("gift ledger row stamped source='gift' + donor_id + income", rows[0]?.source === "gift" && rows[0]?.donor_id === "d_fin_a1" && rows[0]?.type === "income", rows[0]);
    ok("gift ledger row amount = 250", Number(rows[0]?.amount) === 250, rows[0]?.amount);

    const list = await api("GET", `/finance/transactions?year=${YEAR}`, a);
    const giftRow = (list.body || []).find(t => t.donor_id === "d_fin_a1");
    ok("GET /finance/transactions returns donor_id + source", !!giftRow && giftRow.source === "gift", giftRow);
  }

  // ── 4. Manual ledger entry — source='manual', donor_id null ──
  {
    const m = await api("POST", "/finance/transactions", a, { date: today, description: "Office rent", amount: 900, type: "expense", accountId: "acc_fin_a2", fundId: "ff_fin_a1" });
    ok("manual transaction created (201)", m.status === 201, m.status);
    const row = await q(`SELECT source, donor_id FROM fin_transactions WHERE id=$1`, [m.body?.id]);
    ok("manual entry stamped source='manual', donor_id null", row[0]?.source === "manual" && row[0]?.donor_id === null, row[0]);
  }

  // ── 5. donor_id filter on GET (column now resolves) ──
  {
    const filtered = await api("GET", `/finance/transactions?year=${YEAR}&donor_id=d_fin_a1`, a);
    const allForDonor = Array.isArray(filtered.body) && filtered.body.every(t => t.donor_id === "d_fin_a1") && filtered.body.length >= 1;
    ok("donor_id filter returns only that donor's rows", filtered.status === 200 && allForDonor, filtered.body?.length);
  }

  // ── 6. Write-gating on a read_only (trial_expired) org ──
  {
    const t1 = await api("POST", "/finance/transactions", b, { date: today, description: "x", amount: 10, type: "income" });
    ok("read_only: POST /finance/transactions → 402", t1.status === 402 && t1.body?.error === "subscription_required", t1.status);
    const t2 = await api("POST", "/finance/accounts", b, { code: "4020", name: "Test", type: "revenue" });
    ok("read_only: POST /finance/accounts → 402", t2.status === 402, t2.status);
    const t3 = await api("POST", "/finance/funds", b, { name: "New Fund" });
    ok("read_only: POST /finance/funds → 402", t3.status === 402, t3.status);
    const t4 = await api("POST", "/finance/budgets", b, { accountId: "acc_fin_b1", year: YEAR, amount: 5000 });
    ok("read_only: POST /finance/budgets → 402", t4.status === 402, t4.status);

    // Reads still work for a lapsed org
    const gr = await api("GET", `/finance/transactions?year=${YEAR}`, b);
    ok("read_only: GET /finance/transactions → 200", gr.status === 200, gr.status);
    const gs = await api("GET", "/finance/summary?yearMode=fiscal", b);
    ok("read_only: GET /finance/summary → 200", gs.status === 200, gs.status);

    // DELETE is ungated by convention — seed a row directly, then delete via API.
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,source) VALUES ('ft_fin_b_del',$1,$2,'to delete',5,'income','manual')`, [ORG_B, today]);
    const del = await api("DELETE", "/finance/transactions/ft_fin_b_del", b);
    ok("read_only: DELETE /finance/transactions allowed (not 402)", del.status !== 402 && del.status < 500, del.status);
    const gone = await q(`SELECT id FROM fin_transactions WHERE id='ft_fin_b_del'`);
    ok("read_only: DELETE actually removed the row", gone.length === 0);
  }

  // ── 7. Org isolation on the ledger read ──
  {
    const la = await api("GET", `/finance/transactions?year=${YEAR}`, a);
    const lb = await api("GET", `/finance/transactions?year=${YEAR}`, b);
    const aHasBRows = (la.body || []).some(t => t.org_id === ORG_B);
    const bHasARows = (lb.body || []).some(t => t.org_id === ORG_A);
    ok("ledger is org-scoped both directions", !aHasBRows && !bHasARows);
  }

  // ── 8. Connected-branch REGRESSION via the STRIPE_API_BASE mock seam ──
  // Found live 2026-08-12: stripe.balance.retrieve({ stripeAccount }) passed
  // the account in the PARAMS position — stripe-node v22 sent it as a request
  // parameter, Stripe rejected it ("Received unknown parameter:
  // stripeAccount"), and prod's Money-in strip silently read "not connected"
  // for a connected org. The account must ride the OPTIONS argument (the
  // Stripe-Account header). This leg drives the real route against a local
  // Stripe mock (the BUILD-45 seam the server is already booted with) and
  // asserts the header form — it fails on the params form.
  {
    const seen = [];
    const mock = require("http").createServer((req, res) => {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => {
        seen.push({ url: req.url, account: req.headers["stripe-account"] || null, body });
        res.setHeader("content-type", "application/json");
        if (req.url.startsWith("/v1/balance")) {
          res.end(JSON.stringify({ object: "balance", available: [{ amount: 123400, currency: "usd" }], pending: [{ amount: 5600, currency: "usd" }] }));
        } else if (req.url.startsWith("/v1/payouts")) {
          res.end(JSON.stringify({ object: "list", data: [{ id: "po_mock47", object: "payout", amount: 50000, status: "paid", arrival_date: 1755000000 }], has_more: false }));
        } else {
          res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: unexpected " + req.url } }));
        }
      });
    });
    const mockUp = await new Promise(r => { mock.on("error", () => r(false)); mock.listen(STRIPE_MOCK_PORT, () => r(true)); });
    if (!mockUp) {
      console.log(`  SKIP  connected-branch mock leg (:${STRIPE_MOCK_PORT} busy)`);
    } else {
      // A FRESH org id every run — the route caches per org for 5 minutes in
      // process memory, and the scratch server outlives suite runs.
      const orgM = "org_fin_m" + Date.now().toString(36).slice(-6);
      await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
               VALUES ($1,'Fin Mock Org',$1,1,'active','team','acct_mock47')`, [orgM]);
      const hash2 = bcrypt.hashSync("loadtest1234", 10);
      await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'M Admin','admin')`,
        [orgM + "_u", orgM, orgM + "@test.local", hash2]);
      const m = await login(orgM + "@test.local", "loadtest1234");
      const rm = await api("GET", "/finance/stripe-summary", m);
      if (seen.length === 0) {
        // The server wasn't booted with STRIPE_API_BASE=http://localhost:5603
        // (the standard run-all/CI recipe) — the leg can't observe the wire.
        console.log("  SKIP  connected-branch mock leg (server booted without the STRIPE_API_BASE seam)");
        for (const t of ["users", "orgs"]) await q(`DELETE FROM ${t} WHERE ${t === "orgs" ? "id" : "org_id"}=$1`, [orgM]).catch(() => {});
        mock.close();
      } else {
      ok("mock leg: connected:true through the real route", rm.status === 200 && rm.body?.connected === true, rm.body);
      ok("mock leg: balance mapped from the mock (available 1234 / pending 56)",
        rm.body?.balance?.available === 1234 && rm.body?.balance?.pending === 56, rm.body?.balance);
      ok("mock leg: payout mapped (po_mock47 · $500 · paid)",
        rm.body?.payouts?.[0]?.id === "po_mock47" && rm.body.payouts[0].amount === 500 && rm.body.payouts[0].status === "paid", rm.body?.payouts);
      const bal = seen.find(s => s.url.startsWith("/v1/balance"));
      const po = seen.find(s => s.url.startsWith("/v1/payouts"));
      ok("mock leg: BOTH calls carry the Stripe-Account HEADER (options form)",
        bal?.account === "acct_mock47" && po?.account === "acct_mock47", seen);
      ok("mock leg: stripeAccount NEVER rides as a request parameter (the regression)",
        seen.every(s => !s.url.includes("stripeAccount") && !s.body.includes("stripeAccount")), seen);
      for (const t of ["users", "orgs"]) await q(`DELETE FROM ${t} WHERE ${t === "orgs" ? "id" : "org_id"}=$1`, [orgM]).catch(() => {});
      mock.close();
      }
    }
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
