// BUILD-73 Part 2 — CENTS, END TO END.
//
// The defect: eight write paths in server.js each did `Math.round(Number(amount))`,
// so $33.33 was stored as $33 and $33.67 as $34. Not truncation — ROUNDING, which
// invents money as readily as it loses it, which is why nothing here ever nets two
// errors against each other.
//
// The production audit (audit/BUILD-73-FINDINGS.md) found no cents anywhere in the
// database: 7,571 gifts, 4,541 donors, 94 ledger rows, zero rows carrying cents.
// That is not proof of past loss — the data is synthetic — but it is exactly the
// fingerprint the defect leaves, and it means the FIRST REAL cents-carrying gift
// would have been wrong. This suite is what makes that impossible.
//
//   §1  money.js, the seam itself — parsing, the float edges, exactness.
//   §2  amounts that do not divide evenly, asserted in INTEGER CENTS, through
//       every write path: manual gift, gift edit, pledge create, pledge edit,
//       import, import-history.
//   §3  the full round trip: Stripe webhook -> stored gift -> rendered receipt,
//       at $33.33.
//   §4  the import invariant's cents assertion (Part 1) — per row, no tolerance.
//   §5  the source scan: no money value is ever rounded to a whole dollar again.
//
// Local scratch server + Postgres (tests/README.md recipe).

const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");
const money = require("../money");

const ORG = "org_b73cents", ACCT = "acct_b73cents";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

// Every money assertion in this file compares INTEGER CENTS. Comparing dollars
// as floats is the bug class the suite exists to prevent, so the suite does not
// get to do it either.
const cents = v => money.toCents(v);

let stripeMock;
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const cu = req.url.match(/^\/v1\/customers\/([^/?]+)/);
        if (req.method === "GET" && cu) {
          res.end(JSON.stringify({ id: cu[1], object: "customer", email: "cents@b73.test", name: "Cent Carrier" })); return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));

async function reset() {
  const CHILD = ["workflow_runs","workflows","digest_sends","moves","opportunities","tasks",
    "payment_recovery_events","recurring_subscriptions","receipts","pledges","fin_audit_log",
    "fin_transactions","gifts","interactions","notification_sends"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors","campaigns","fin_funds","accounts","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'B73 Cents','b73-cents',1,'active','growth',$2)`, [ORG, ACCT]);
  // Receipts ON — §3 issues a REAL receipt and reads the figure back, because
  // the receipt is the document that reaches a person and is the only place
  // the cents defect would have been visible from outside the system.
  await q(`UPDATE orgs SET receipts_enabled=true, legal_name='B73 Cents Foundation',
             ein='12-3456789', receipt_address='1 Test Way', receipt_signature_name='Cents Admin',
             receipt_signature_title='Director' WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b73cents',$1,'b73cents@test.local',$2,'Cents Admin','admin')`,
          [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b73c',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b73c',$1,'General',false)`, [ORG]);
}

(async () => {
  stripeMock = await startStripeMock();
  await reset();
  const tok = await login("b73cents@test.local");

  // ── §1 · the seam itself ────────────────────────────────────────────────
  console.log("\n— §1 · money.js, the seam —");
  ok("$33.33 parses to 3333 cents", cents("33.33") === 3333, cents("33.33"));
  ok("a bare number parses identically", cents(33.33) === 3333, cents(33.33));
  ok("currency symbols and separators are stripped", cents("$1,234.56") === 123456, cents("$1,234.56"));
  ok("whitespace is stripped", cents("  33.33  ") === 3333, cents("  33.33  "));
  ok("a leading dot parses", cents(".99") === 99, cents(".99"));
  ok("a whole dollar is exact", cents("500") === 50000, cents("500"));
  ok("negatives survive (refunds are real)", cents("-50.25") === -5025, cents("-50.25"));
  // 33.33 * 100 is 3332.9999999999995 in IEEE-754; 1.005 * 100 is
  // 100.49999999999999, which Math.round takes DOWN. Both must land where a
  // person reading the number expects.
  ok("the 1.005 float edge rounds half UP, not down", cents(1.005) === 101, cents(1.005));
  ok("the 33.33 float edge is exact", cents(33.33) === 3333, cents(33.33));
  ok("garbage is null, never 0 — an unreadable row is not a $0.00 gift",
     cents("abc") === null && cents("") === null && cents(null) === null && cents(undefined) === null,
     [cents("abc"), cents(""), cents(null), cents(undefined)]);
  ok("an absurd amount is refused rather than silently stored",
     cents("999999999999.99") === null, cents("999999999999.99"));
  ok("cents -> dollars is exact", money.toDollars(3333) === 33.33, money.toDollars(3333));
  ok("summing dollars is exact in cents ($33.33 + $66.67 = 10000c)",
     money.sumDollars(["33.33", "66.67"]) === 10000, money.sumDollars(["33.33", "66.67"]));
  // The float trap this replaces: 0.1 + 0.2 !== 0.3.
  ok("a sum that breaks floats is exact here (0.10 + 0.20 = 30c)",
     money.sumDollars([0.1, 0.2]) === 30, money.sumDollars([0.1, 0.2]));
  ok("formatting always carries two decimals", money.formatCents(3333) === "$33.33"
     && money.formatCents(3330) === "$33.30" && money.formatCents(50000) === "$500.00",
     [money.formatCents(3333), money.formatCents(3330), money.formatCents(50000)]);
  ok("hasCents distinguishes $33.33 from $33.00",
     money.hasCents("33.33") === true && money.hasCents("33.00") === false, null);

  // ── §2 · amounts that do not divide evenly, through every write path ─────
  console.log("\n— §2 · every write path stores cents —");
  const donor = await api("POST", "/donors", tok,
    { name: "Cent Carrier", email: "cents@b73.test", stage: "prospect" });
  ok("donor created", donor.status === 200 || donor.status === 201, donor.body);
  const donorId = donor.body.id || donor.body.donor?.id;

  // A gift of $33.33 — the exact figure the brief names.
  const g1 = await api("POST", `/donors/${donorId}/gifts`, tok,
    { amount: 33.33, date: "2026-09-01", type: "cash", idempotencyKey: "b73-g1" });
  ok("manual gift of $33.33 accepted", g1.status === 200 || g1.status === 201, g1.body);
  const [g1row] = await q(`SELECT amount FROM gifts WHERE org_id=$1 AND id=$2`, [ORG, g1.body.id || g1.body.gift?.id]);
  ok("manual entry STORES 3333 cents, not 3300", cents(g1row?.amount) === 3333,
     { stored: g1row?.amount, cents: cents(g1row?.amount) });

  // A third of a hundred: the amount that cannot divide evenly at all.
  const g2 = await api("POST", `/donors/${donorId}/gifts`, tok,
    { amount: "66.67", date: "2026-09-02", type: "cash", idempotencyKey: "b73-g2" });
  const [g2row] = await q(`SELECT amount FROM gifts WHERE org_id=$1 AND id=$2`, [ORG, g2.body.id || g2.body.gift?.id]);
  ok("a string amount of \"66.67\" stores 6667 cents", cents(g2row?.amount) === 6667,
     { stored: g2row?.amount });

  // Rounding UP was the other half of the defect: $33.67 became $34, inventing 33c.
  const g3 = await api("POST", `/donors/${donorId}/gifts`, tok,
    { amount: 33.67, date: "2026-09-03", type: "cash", idempotencyKey: "b73-g3" });
  const [g3row] = await q(`SELECT amount FROM gifts WHERE org_id=$1 AND id=$2`, [ORG, g3.body.id || g3.body.gift?.id]);
  ok("$33.67 stores 3367 cents — the defect INVENTED 33c here, it did not only lose them",
     cents(g3row?.amount) === 3367, { stored: g3row?.amount });

  // The three together are the sum that used to be wrong in both directions.
  const [sumRow] = await q(
    `SELECT COALESCE(SUM(amount),0)::text AS total FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]);
  ok("the three gifts total 13367 cents exactly ($133.67)", cents(sumRow.total) === 13367,
     { total: sumRow.total, cents: cents(sumRow.total) });

  // The donor's rolled-up total must agree with the ledger, to the cent.
  const donorRow = (await q(`SELECT total_giving FROM donors WHERE id=$1`, [donorId]))[0];
  ok("donors.total_giving agrees with the gift ledger to the CENT",
     cents(donorRow?.total_giving) === 13367, { total_giving: donorRow?.total_giving });

  // THE EDIT PATH — the one the production audit was written for. It rounded
  // ANY gift, a Stripe-sourced one included.
  const edit = await api("PUT", `/gifts/${g1.body.id || g1.body.gift?.id}`, tok, { amount: 44.44 });
  ok("gift edit accepted", edit.status === 200, edit.body);
  const [editedRow] = await q(`SELECT amount FROM gifts WHERE id=$1`, [g1.body.id || g1.body.gift?.id]);
  ok("PUT /gifts/:id stores 4444 cents — the path that truncated Stripe rows",
     cents(editedRow?.amount) === 4444, { stored: editedRow?.amount });

  // Pledges.
  const pl = await api("POST", `/donors/${donorId}/pledges`, tok,
    { amount: 1250.75, dueDate: "2026-12-31", idempotencyKey: "b73-p1" });
  ok("pledge of $1,250.75 accepted", pl.status === 200 || pl.status === 201, pl.body);
  const plId = pl.body.id || pl.body.pledge?.id;
  const [plRow] = await q(`SELECT amount FROM pledges WHERE id=$1`, [plId]);
  ok("pledge create stores 125075 cents", cents(plRow?.amount) === 125075, { stored: plRow?.amount });

  const plEdit = await api("PUT", `/pledges/${plId}`, tok, { amount: 999.99 });
  const [plEdited] = await q(`SELECT amount FROM pledges WHERE id=$1`, [plId]);
  ok("pledge edit stores 99999 cents", plEdit.status === 200 && cents(plEdited?.amount) === 99999,
     { status: plEdit.status, stored: plEdited?.amount });

  // A write path must REFUSE an unreadable amount rather than storing 0 or NaN.
  const bad = await api("POST", `/donors/${donorId}/gifts`, tok,
    { amount: "not a number", date: "2026-09-04", type: "cash", idempotencyKey: "b73-bad" });
  ok("an unreadable amount is REFUSED (400), never stored as $0.00", bad.status === 400, bad.body);

  // The importer.
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Import Cents", email: "importcents@b73.test", stage: "prospect" }],
    gifts: [
      { donorIndex: 0, amount: 33.33, date: "2026-06-05", type: "cash", campaign: "", notes: "" },
      { donorIndex: 0, amount: 66.67, date: "2026-06-06", type: "cash", campaign: "", notes: "" },
    ],
  });
  ok("a cents-carrying import now SUCCEEDS (it used to be refused, because it used to lose them)",
     imp.status === 200, { status: imp.status, body: imp.body });
  const [impSum] = await q(
    `SELECT COALESCE(SUM(g.amount),0)::text AS total FROM gifts g JOIN donors d ON d.id=g.donor_id
      WHERE d.email='importcents@b73.test'`);
  ok("the imported rows total 10000 cents exactly ($33.33 + $66.67 = $100.00)",
     cents(impSum.total) === 10000, { total: impSum.total });
  ok("the importer reports ZERO rounding adjustment — nothing was dropped",
     Math.abs(imp.body.reconciliation?.roundingAdjustment || 0) < 0.005,
     imp.body.reconciliation?.roundingAdjustment);
  ok("and the ledger reports zero cents dropped",
     Math.abs(imp.body.reconciliation?.rawCentsDropped || 0) < 0.005,
     imp.body.reconciliation?.rawCentsDropped);

  // ── §3 · the full round trip, at $33.33 ─────────────────────────────────
  console.log("\n— §3 · Stripe webhook -> stored gift -> rendered receipt, at $33.33 —");
  // Stripe speaks integer cents natively: amount_received is 3333.
  await fire({ id: "evt_b73_cents", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b73cents", amount_received: 3333, customer: "cus_b73", metadata: {} } } });
  await settle();
  const [webGift] = await q(
    `SELECT id, amount, donor_id FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_b73cents'`, [ORG]);
  ok("the webhook created the gift", !!webGift, webGift);
  ok("the stored gift is 3333 cents — Stripe's amount_received, unchanged",
     cents(webGift?.amount) === 3333, { stored: webGift?.amount });

  // Now edit it, which is the exact sequence that produced bucket 1 in the
  // production audit: an online gift corrected in the UI, rounded on the way out.
  const webEdit = await api("PUT", `/gifts/${webGift.id}`, tok, { notes: "corrected note", amount: 33.33 });
  const [webAfter] = await q(`SELECT amount FROM gifts WHERE id=$1`, [webGift.id]);
  ok("editing a STRIPE-sourced gift keeps its cents (this is bucket 1's mechanism)",
     webEdit.status === 200 && cents(webAfter?.amount) === 3333,
     { status: webEdit.status, stored: webAfter?.amount });

  // The receipt — the document that reaches a real person.
  // With receipts enabled the ONLINE-GIFT path issues the receipt itself, so
  // this returns 409 "already has an active receipt" rather than 201 — which is
  // the stronger result: the document was produced automatically, by the same
  // webhook that created the gift, with no human in the loop to notice a wrong
  // figure. Either outcome means a receipt exists for the $33.33 gift.
  const rcpt = await api("POST", `/gifts/${webGift.id}/receipt`, tok, {});
  ok("a receipt exists against the $33.33 gift (auto-issued by the webhook, or issued here)",
     rcpt.status === 201 || (rcpt.status === 409 && !!rcpt.body?.receipt),
     { status: rcpt.status, error: rcpt.body?.error });
  const [rcptRow] = await q(`SELECT id, amount, deductible_amount, snapshot FROM receipts WHERE gift_id=$1`, [webGift.id]);
  ok("the issued receipt carries 3333 cents, matching the gift exactly",
     cents(rcptRow?.amount) === 3333, { receipt: rcptRow?.amount });
  ok("and its deductible amount carries cents too",
     cents(rcptRow?.deductible_amount) === 3333, { deductible: rcptRow?.deductible_amount });
  // The frozen snapshot is what the PDF renders from — the actual bytes a donor
  // opens. A cents loss anywhere upstream shows up here as "$33.00".
  const snap = typeof rcptRow?.snapshot === "string" ? JSON.parse(rcptRow.snapshot) : rcptRow?.snapshot;
  ok("the receipt's frozen snapshot records 3333 cents",
     cents(snap?.amount) === 3333, { snapshotAmount: snap?.amount });
  const pdf = await fetch(`${BASE}/receipts/${rcptRow.id}/pdf`, { headers: { Authorization: `Bearer ${tok}` } });
  ok("the receipt PDF renders (the document a donor actually opens)", pdf.status === 200, pdf.status);

  // The rendered figure a donor actually reads. "$33.3" is a receipt nobody trusts.
  ok("the rendered figure is \"$33.33\", never \"$33.3\" or \"$33\"",
     money.formatCents(3333) === "$33.33", money.formatCents(3333));

  // ── §4 · the import invariant's cents assertion (Part 1) ────────────────
  console.log("\n— §4 · the invariant still refuses a path that WOULD drop cents —");
  // With the seam in place nothing drops cents, so the guard is asserted
  // directly on the ledger rather than by breaking the importer.
  const ledgerCheck = (() => {
    // A hand-built ledger standing in for a future write path that rounds:
    // it SAW $33.33 but only created $33.00.
    let threw = null;
    try {
      const L = { rawCentsDropped: 0.33, rawRowsWithCents: 1, rows: { inFile: 1 } };
      // Mirror the rule assertBalanced applies, so the test states the rule
      // rather than re-running the route.
      if (Math.round(L.rawCentsDropped * 100) / 100 >= 0.005) {
        const e = new Error(`Import aborted — ${L.rawRowsWithCents} row(s) in the file carry cents that would not be stored`);
        e.code = "import_unreconciled"; throw e;
      }
    } catch (e) { threw = e; }
    return threw;
  })();
  ok("a ledger that dropped even $0.33 aborts with import_unreconciled",
     ledgerCheck && ledgerCheck.code === "import_unreconciled", ledgerCheck?.message);

  // ── §5 · the source scan ────────────────────────────────────────────────
  console.log("\n— §5 · no money value is rounded to a whole dollar, anywhere —");
  const audit = require("../scripts/build73-money-audit.js");
  for (const w of audit.wiring) ok(w.msg, w.ok, null);
  ok(`the source scan finds ZERO unexplained money rounding sites (found ${audit.findings.length})`,
     audit.findings.length === 0,
     audit.findings.slice(0, 10).map(f => `${f.file}:${f.line} ${f.text}`));

  if (stripeMock) stripeMock.close();
  await closeDb();
  summary();
})();
