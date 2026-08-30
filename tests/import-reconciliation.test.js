// BUILD-72 Part 1 — THE IMPORT RECONCILIATION INVARIANT.
//
// The class fix, and the suite that makes a future silent-loss bug unshippable:
//
//     rows_in_file    = gifts_created + rows_skipped_by_user + rows_errored
//     dollars_in_file = dollars_created + dollars_skipped     + dollars_errored
//
// asserted by the importer itself before its transaction commits, on every
// import path that moves money.
//
// Covered here:
//   §1  The Part 0 fixture matrix (tests/fixtures/build72/twins-matrix.csv),
//       asserting DOLLAR TOTALS and per-case row counts. The dollar total is
//       the assertion that matters — a row count can be right while money is
//       wrong.
//   §2  0.1b — a matched donor's gifts LAND. This is the defect Part 0 found:
//       the importer used to discard every gift belonging to a donor it
//       deduped by email, silently, with a 200.
//   §3  The invariant asserted DIRECTLY against a deliberately sabotaged
//       importer: a test double that drops one row must make the import ABORT,
//       not succeed with a short count.
//   §4  The FAMILY, not one case: any set of rows sharing donor+date+amount at
//       group sizes 2, 3, 12 and 40.
//   §5  A 5,000-row file — the review step and the invariant at the size of a
//       real donor file.
//   §6  Keep-all is the default, and deselecting is the user's explicit,
//       counted act.
//
// Local scratch server + Postgres (tests/README.md recipe).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b72recon";
const CSV = path.join(__dirname, "fixtures", "build72", "twins-matrix.csv");

async function reset() {
  const CHILD = ["workflow_runs","workflows","digest_sends","moves","opportunities","tasks",
    "payment_recovery_events","recurring_subscriptions","receipts","pledges","fin_audit_log",
    "fin_transactions","gifts","interactions","notification_sends"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors","campaigns","fin_funds","accounts","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B72 Reconciliation','b72-recon',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72recon',$1,'b72recon@test.local',$2,'Recon Admin','admin')`,
          [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b72recon',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72recon',$1,'General',false)`, [ORG]);
}

const dbTotals = async () =>
  (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1`, [ORG]))[0];

// Parse the committed fixture the same way the client does.
function parseCsv(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(l => {
    const cells = l.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}

(async () => {
  await reset();
  const tok = await login("b72recon@test.local");
  const { groupTransactions } = await import("../client/src/lib/importShape.js");

  // ── §1 · the Part 0 fixture matrix, asserted on DOLLARS ──────────────────
  console.log("\n— §1 · the twins matrix (dollar totals are the assertion) —");
  const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
  const rowsIn = rows.length;
  const dollarsIn = rows.reduce((s, r) => s + Number(r["Amount"]), 0);
  ok("fixture is the Part 0 matrix: 98 rows / $26,115", rowsIn === 98 && dollarsIn === 26115, { rowsIn, dollarsIn });

  const items = rows.map(r => ({
    key: r["Email"].toLowerCase(),
    donor: { name: r["Donor Name"], email: r["Email"], stage: "prospect" },
    gift: { amount: Math.round(Number(r["Amount"])), date: r["Gift Date"], type: "cash", campaign: "", notes: "" },
  }));
  const { donors, gifts } = groupTransactions(items);
  const imp = await api("POST", "/donors/import-combined", tok, { donors, gifts });
  ok("import 200", imp.status === 200, imp.body);

  const rec = imp.body.reconciliation;
  ok("the importer returns a reconciliation", !!rec, imp.body);
  ok("ROWS balance: in = created + skipped + errored",
     rec.rows.inFile === rec.rows.created + rec.rows.skipped + rec.rows.errored, rec.rows);
  ok("DOLLARS balance: in = created + skipped + errored",
     Math.abs(rec.dollars.inFile - (rec.dollars.created + rec.dollars.skipped + rec.dollars.errored)) < 0.005, rec.dollars);
  ok("the importer says it balanced", rec.balanced === true, rec);
  ok(`every one of the ${rowsIn} rows became a gift`, rec.rows.created === rowsIn, rec.rows);
  ok(`all $${dollarsIn} landed — nothing skipped, nothing errored`,
     rec.dollars.created === dollarsIn && rec.dollars.skipped === 0 && rec.dollars.errored === 0, rec.dollars);

  const t1 = await dbTotals();
  ok("DB agrees on rows", t1.n === rowsIn, t1);
  ok("DB agrees on DOLLARS", t1.d === dollarsIn, t1);

  // Per-case, from the matrix.
  const caseTotals = async (emailLike) =>
    (await q(`SELECT COUNT(g.*)::int n, COALESCE(SUM(g.amount),0)::float d
              FROM gifts g JOIN donors dn ON dn.id=g.donor_id
              WHERE dn.org_id=$1 AND dn.email LIKE $2`, [ORG, emailLike]))[0];
  for (const [label, like, n, d] of [
    ["same donor/date/amount x2", "jane.doe@%", 2, 200],
    ["gala table x40",            "marcus.webb@%", 40, 10000],
    ["40 different donors",       "guest%", 40, 4000],
    ["adjacent dates",            "nora.adjacent@%", 2, 200],
    ["same date, different amounts", "owen.split@%", 2, 350],
  ]) {
    const r = await caseTotals(like);
    ok(`case: ${label} — ${n} rows / $${d}`, r.n === n && r.d === d, r);
  }
  const dec = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1 AND date='2025-12-31'`, [ORG]))[0];
  ok("case: December 31 cluster — 12 rows / $11,365", dec.n === 12 && dec.d === 11365, dec);

  // ── §2 · 0.1b — a MATCHED donor's gifts land ─────────────────────────────
  console.log("\n— §2 · 0.1b · a matched donor's gifts must land —");
  const before = await dbTotals();
  const second = await api("POST", "/donors/import-combined", tok, {
    donors: [
      { name: "Jane Doe", email: "jane.doe@b72.test", stage: "prospect" },
      { name: "Marcus Webb", email: "marcus.webb@b72.test", stage: "prospect" },
    ],
    gifts: [
      { donorIndex: 0, amount: 500, date: "2026-06-01", type: "cash", campaign: "", notes: "" },
      { donorIndex: 0, amount: 600, date: "2026-06-02", type: "cash", campaign: "", notes: "" },
      { donorIndex: 1, amount: 700, date: "2026-06-01", type: "cash", campaign: "", notes: "" },
    ],
  });
  const after = await dbTotals();
  ok("second file: 0 donors created (both already on file)", second.body.created === 0, second.body);
  ok("second file: both donors MATCHED", second.body.donorsMatched === 2, second.body);
  ok("second file: all 3 gifts landed", after.n - before.n === 3, { before, after });
  ok("second file: all $1,800 landed — the 0.1b money loss is closed",
     Math.round(after.d - before.d) === 1800, { before, after });
  ok("second file reconciles", second.body.reconciliation.balanced === true, second.body.reconciliation);

  // ── §3 · the invariant vs a SABOTAGED importer ───────────────────────────
  // A test double that drops one row must ABORT the import, not succeed short.
  // Driven through the ops route so the sabotage lives in the server, not here.
  console.log("\n— §3 · a sabotaged importer must ABORT, not short-count —");
  const t3before = await dbTotals();
  const sabotaged = await api("POST", "/donors/import-combined", tok, {
    __sabotageDropRows: 1,          // test-only: silently drop one row mid-import
    donors: [{ name: "Sabotage Target", email: "sabotage@recon.test", stage: "prospect" }],
    gifts: [
      { donorIndex: 0, amount: 111, date: "2026-05-01", type: "cash", campaign: "", notes: "" },
      { donorIndex: 0, amount: 222, date: "2026-05-02", type: "cash", campaign: "", notes: "" },
    ],
  });
  ok("sabotaged import is REFUSED with 409", sabotaged.status === 409, { status: sabotaged.status, body: sabotaged.body });
  ok("the refusal names the discrepancy IN DOLLARS",
     typeof sabotaged.body.message === "string" && /\$/.test(sabotaged.body.message), sabotaged.body.message);
  ok("the refusal carries the failed equation", !!sabotaged.body.reconciliation
     && sabotaged.body.reconciliation.balanced === false, sabotaged.body.reconciliation);
  const t3after = await dbTotals();
  ok("NOTHING was written — the whole import rolled back",
     t3after.n === t3before.n && t3after.d === t3before.d, { t3before, t3after });
  const sabDonor = await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "sabotage@recon.test"]);
  ok("not even the donor row survived the rollback", sabDonor.length === 0, sabDonor);

  // ── §4 · the FAMILY, at group sizes 2, 3, 12 and 40 ──────────────────────
  console.log("\n— §4 · the family: group sizes 2, 3, 12, 40 —");
  for (const size of [2, 3, 12, 40]) {
    const email = `fam${size}@recon.test`;
    const fgifts = Array.from({ length: size }, () => ({
      donorIndex: 0, amount: 125, date: "2026-04-04", type: "cash", campaign: "", notes: "",
    }));
    const r = await api("POST", "/donors/import-combined", tok, {
      donors: [{ name: `Family Of ${size}`, email, stage: "prospect" }], gifts: fgifts,
    });
    const got = (await q(`SELECT COUNT(g.*)::int n, COALESCE(SUM(g.amount),0)::float d
                          FROM gifts g JOIN donors dn ON dn.id=g.donor_id
                          WHERE dn.org_id=$1 AND dn.email=$2`, [ORG, email]))[0];
    ok(`group of ${size}: all ${size} rows imported`, got.n === size, got);
    ok(`group of ${size}: $${125 * size} landed`, got.d === 125 * size, got);
    ok(`group of ${size}: reconciles`, r.body.reconciliation.balanced === true, r.body.reconciliation);
    ok(`group of ${size}: surfaced as ONE reviewable group of ${size}`,
       r.body.duplicateGroups.some(g => g.kind === "within_file" && g.count === size), r.body.duplicateGroups);
  }

  // ── §5 · 5,000 rows — a real donor file ──────────────────────────────────
  console.log("\n— §5 · 5,000 rows —");
  const bigDonors = [], bigGifts = [];
  let bigDollars = 0;
  for (let i = 0; i < 1000; i++) {
    bigDonors.push({ name: `Scale Donor ${i}`, email: `scale${i}@recon.test`, stage: "prospect" });
    for (let k = 0; k < 5; k++) {
      const amount = 10 + ((i + k) % 90);
      bigDollars += amount;
      bigGifts.push({ donorIndex: i, amount, date: "2026-02-1" + (k + 1), type: "cash", campaign: "", notes: "" });
    }
  }
  const t5before = await dbTotals();
  const t0 = Date.now();
  const big = await api("POST", "/donors/import-combined", tok, { donors: bigDonors, gifts: bigGifts });
  const elapsed = Date.now() - t0;
  ok("5,000-row import 200", big.status === 200, big.body?.error || big.status);
  ok("5,000 rows: reconciles", big.body.reconciliation.balanced === true, big.body.reconciliation);
  ok("5,000 rows: every row created", big.body.reconciliation.rows.created === 5000, big.body.reconciliation.rows);
  ok(`5,000 rows: all $${bigDollars} landed`,
     big.body.reconciliation.dollars.created === bigDollars, big.body.reconciliation.dollars);
  const t5after = await dbTotals();
  ok("5,000 rows: DB dollars agree", Math.round(t5after.d - t5before.d) === bigDollars, { t5before, t5after });
  ok(`5,000 rows: the invariant did not fall over (${elapsed}ms)`, elapsed < 120000, elapsed);

  // ── §6 · keep-all is the default; deselecting is explicit and counted ────
  console.log("\n— §6 · keep all by default —");
  const twinPair = {
    donors: [{ name: "Default Keep", email: "defaultkeep@recon.test", stage: "prospect" }],
    gifts: [
      { donorIndex: 0, amount: 500, date: "2026-07-07", type: "cash", campaign: "", notes: "" },
      { donorIndex: 0, amount: 500, date: "2026-07-07", type: "cash", campaign: "", notes: "" },
    ],
  };
  const kept = await api("POST", "/donors/import-combined", tok, twinPair);
  ok("no review sent → BOTH twins import (headless keeps all)",
     kept.body.reconciliation.rows.created === 2 && kept.body.reconciliation.rows.skipped === 0, kept.body.reconciliation);
  ok("the summary states the auto-kept group",
     kept.body.duplicateGroups.some(g => g.kind === "within_file" && g.count === 2), kept.body.duplicateGroups);

  const dkId = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "defaultkeep@recon.test"]))[0].id;
  const desel = await api("POST", "/donors/import-combined", tok, {
    ...twinPair,
    skipRowKeys: [`${dkId}|2026-07-07|500`],
  });
  ok("a deselected key skips its rows", desel.body.reconciliation.rows.created === 0
     && desel.body.reconciliation.rows.skipped === 2, desel.body.reconciliation);
  ok("and they are counted as user_deselected, in dollars",
     desel.body.reconciliation.skippedReasons.user_deselected?.dollars === 1000, desel.body.reconciliation.skippedReasons);
  ok("a deliberate skip still reconciles", desel.body.reconciliation.balanced === true, desel.body.reconciliation);

  await closeDb();
  summary();
})();
