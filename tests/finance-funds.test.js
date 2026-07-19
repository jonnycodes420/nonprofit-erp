// BUILD-21 Part 2 — Funds view crash insurance.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The Funds view black-screened on a ReferenceError — the subtab read a
// variable `fundBalances` that was never defined (the real map is `_fbMap`);
// fmt(null) throwing was a second latent hazard. Both are fixed. This proves
// the layers that ARE node-testable:
//   0. source guard: the Funds subtab references a DEFINED balance map, not the
//      bare `fundBalances` that caused the crash (a render-time ReferenceError
//      can't be caught by this API suite, so this guards the exact regression)
//   1. the money formatters (client/src/lib/money.js) are null-safe — never
//      throw, always return a finite "$…" string — for null/undefined/NaN/
//      empty/string/negative/large-negative/cents inputs (the crash root cause)
//   2. the server never hands the Funds view a non-finite balance: a negative-
//      balance fund, a zero (no-transaction) fund, and an org with NO funds all
//      come back from /finance/summary with finite numeric balances (or []),
//      and Cash on Hand stays finite and reconciles
// (The React render-without-throwing + error-boundary-shows-fallback behavior is
// verified in-browser at DSF3 — see docs/build21-*; a class error boundary can't
// be exercised without a DOM renderer, which this suite deliberately isn't.)

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_funds_a", ORG_EMPTY = "org_funds_empty";
const today = new Date().toISOString().slice(0, 10);

async function fixture() {
  for (const org of [ORG_A, ORG_EMPTY]) {
    for (const t of ["fin_audit_log", "fin_transactions", "accounts", "fin_funds", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [org, slug] of [[ORG_A, "funds-a"], [ORG_EMPTY, "funds-empty"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [org, "Funds " + slug, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, [`u_${org}`, org, `${slug}@test.local`, hash]);
    await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Individual Contributions','revenue',true)`, [`acc_${org}`, org]);
  }
  // Org A: three funds — one NEGATIVE balance (like the demo's "Gala Reserve
  // -$4,200"), one with NO transactions (zero, the null-ish case), one positive.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_neg',$1,'Gala Reserve',true)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_zero',$1,'Empty Fund',false)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_pos',$1,'General Operating',false)`, [ORG_A]);
  // Gala Reserve: $800 in, $5000 out → −$4,200.
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id,source) VALUES ('t1',$1,$2,'gift',800,'income',$3,'ff_neg','gift')`, [ORG_A, today, `acc_${ORG_A}`]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id,source) VALUES ('t2',$1,$2,'venue',5000,'expense',$3,'ff_neg','manual')`, [ORG_A, today, `acc_${ORG_A}`]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id,source) VALUES ('t3',$1,$2,'gift',1200,'income',$3,'ff_pos','gift')`, [ORG_A, today, `acc_${ORG_A}`]);
  // Org EMPTY: no funds, no transactions at all.
}

async function testMoneyHelpers() {
  const money = await import("../client/src/lib/money.js");
  const { fmt, fmtFull } = money;
  const bad = [null, undefined, NaN, "", "not-a-number", {}, [], Infinity, -Infinity];
  let allSafe = true, allZero = true;
  for (const b of bad) {
    let out;
    try { out = fmt(b); } catch (e) { allSafe = false; break; }
    if (out !== "$0") allZero = false;
    try { fmtFull(b); } catch (e) { allSafe = false; break; }
  }
  ok("fmt/fmtFull never throw on null/undefined/NaN/empty/junk/Infinity", allSafe);
  ok("fmt/fmtFull degrade bad input to $0", allZero);

  ok("fmt handles a negative balance", fmt(-4200) === "-$4.2k", fmt(-4200));
  ok("fmt handles a large negative (demo −$36,898)", fmt(-36898) === "-$36.9k", fmt(-36898));
  ok("fmt handles a small negative", fmt(-250) === "-$250", fmt(-250));
  ok("fmt handles a positive under 1k", fmt(850) === "$850", fmt(850));
  ok("fmt handles a positive over 1k", fmt(1200) === "$1.2k", fmt(1200));
  ok("fmt handles a numeric string (pg NUMERIC)", fmt("1200") === "$1.2k", fmt("1200"));
  ok("fmtFull renders cents ($140.50 not $140.5)", fmtFull(140.5) === "$140.50", fmtFull(140.5));
  ok("fmtFull renders a negative", fmtFull(-4200) === "$-4,200", fmtFull(-4200));
  ok("fmtFull renders zero", fmtFull(0) === "$0", fmtFull(0));
}

function testFundsSourceGuard() {
  const src = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Finance.jsx"), "utf8");
  // The crash was `const fb = fundBalances[f.id]` — `fundBalances` is undefined
  // (the real map is `_fbMap`). Guard the exact regression.
  // `finFundBalances` uses a capital F, so a lowercase-f `fundBalances[` match is
  // unambiguously the buggy bare reference.
  ok("Funds subtab does not reference the undefined `fundBalances[` map", !/fundBalances\[/.test(src), (src.match(/.{0,14}fundBalances\[/g) || []));
  ok("Funds subtab reads the defined `_fbMap[f.id]`", src.includes("_fbMap[f.id]"));
}

async function run() {
  testFundsSourceGuard();
  await testMoneyHelpers();
  await fixture();
  const a = await login("funds-a@test.local");

  // ── server never emits a non-finite fund balance ──
  {
    const sum = await api("GET", "/finance/summary", a);
    ok("summary returns 200 with a negative-balance fund present", sum.status === 200, sum.status);
    const fb = sum.body?.fundBalances || [];
    ok("all fund balances are finite numbers (no null/NaN)", fb.length === 3 && fb.every(f => Number.isFinite(Number(f.balance))), fb);
    const neg = fb.find(f => f.id === "ff_neg");
    ok("negative fund balance preserved as a real negative (−4200)", Number(neg?.balance) === -4200, neg);
    const zero = fb.find(f => f.id === "ff_zero");
    ok("no-transaction fund balance is 0, not null", Number(zero?.balance) === 0, zero);
    ok("cashOnHand is finite and reconciles (800−5000+1200 = −3000)", Number(sum.body?.cashOnHand) === -3000, sum.body?.cashOnHand);
  }

  // ── /finance/funds (the Funds subtab's list source) is coherent ──
  {
    const funds = await api("GET", "/finance/funds", a);
    ok("funds list returns 200 with all three funds", funds.status === 200 && (funds.body || []).length === 3, funds.status);
  }

  // ── an org with NO funds must not crash the summary (empty view) ──
  {
    const e = await login("funds-empty@test.local");
    const sum = await api("GET", "/finance/summary", e);
    ok("empty-fund org: summary 200, fundBalances = []", sum.status === 200 && Array.isArray(sum.body?.fundBalances) && sum.body.fundBalances.length === 0, sum.body?.fundBalances);
    ok("empty-fund org: cashOnHand finite (0)", Number(sum.body?.cashOnHand) === 0, sum.body?.cashOnHand);
    const funds = await api("GET", "/finance/funds", e);
    ok("empty-fund org: funds list is []", funds.status === 200 && (funds.body || []).length === 0, funds.body);
  }

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
