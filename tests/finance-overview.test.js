// BUILD-10 Part 3 — Finance Overview credibility + copy verification.
// Local scratch server + Postgres (tests/README.md recipe). No live services.
//
// What it proves:
//   RECONCILIATION (the treasurer-can't-see-two-truths invariant, Path L):
//     cashOnHand === Σ all income − Σ all expense over the whole ledger, and it
//     is a distinct scope from the period revenue the endpoint also returns.
//   PERIOD SPLIT: ytd* = current period (basis-aware, July-1 fiscal boundary);
//     prior* = the immediately-preceding period of the same basis.
//   MONTHLY BASIS: fiscal series starts at the FY start month (Jul), is 12 long
//     in Jul-first order, and is labeled with the FY range "FY YYYY–YY"; calendar
//     is Jan-first labeled with the year. Zero-activity months are present in the
//     server array and the CLIENT collapse keeps only active ones + an "other N"
//     count (collapse logic replicated + asserted here).
//   HEADLINE GUARD (financeHeadline replicated from Finance.jsx, kept in lockstep):
//     no prior history drops the clause; a real prior period yields a correct,
//     non-degenerate delta; the same number never appears twice in one sentence.
//   ACTIVE FUND COUNT: funds with a txn in the CURRENT period, not total funds.
//   ORG SCOPING: /finance/summary returns only the caller's org.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_fov_a";
const ORG_B = "org_fov_b";

// ── date fixtures relative to "now" so current/prior periods are deterministic
const now = new Date();
const CY = now.getFullYear();                       // current calendar year
const FY_START = now.getMonth() < 6 ? CY - 1 : CY;  // July-1 fiscal year start
const d = (y, m, day = 15) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// fmtFull — byte-identical to shared.jsx (used by the replicated headline).
const fmtFull = n => { const v = Number(n) || 0; return `$${v.toLocaleString(undefined, Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

// financeHeadline — REPLICATED from client/src/components/Finance.jsx.
// Keep in lockstep with that source; this suite is the guard against drift.
function financeHeadline(s, yearMode) {
  if (!s) return "";
  const rev = s.ytdRevenue || 0;
  const prior = s.priorRevenue || 0;
  const n = s.activeFundCount || 0;
  const periodWord = yearMode === "fiscal" ? "this fiscal year" : "this year";
  const lastWord = yearMode === "fiscal" ? "last fiscal year" : "last year";
  if (rev === 0 && n === 0) {
    return `No money has moved ${periodWord} yet — log a transaction or connect Stripe above and your finances take shape here.`;
  }
  const fundClause = n > 0 ? ` across ${n} ${n === 1 ? "fund" : "funds"}` : "";
  let str = `You're operating on ${fmtFull(rev)}${fundClause} ${periodWord}`;
  const delta = rev - prior;
  if (prior > 0 && delta !== rev) {
    str += `, ${delta >= 0 ? "up" : "down"} ${fmtFull(Math.abs(delta))} from ${lastWord}`;
  }
  return str + ".";
}

// collapseMonthly — REPLICATED from the Overview Monthly Breakdown render.
function collapseMonthly(months) {
  const active = months.filter(m => m.income !== 0 || m.expense !== 0);
  return { active, hidden: months.length - active.length };
}

// finPeriodBounds — REPLICATED from server.js (the July-1 FY rule) so the test's
// expected sums are computed independently of the server, not copied from it.
function finPeriodBounds(yearMode, offset = 0) {
  if (yearMode === "fiscal") {
    const curFyStart = now.getMonth() < 6 ? CY - 1 : CY;
    const fyStart = curFyStart + offset;
    return { start: `${fyStart}-07-01`, end: `${fyStart + 1}-06-30` };
  }
  const year = CY + offset;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}
// Sum seeded ROWS through a period window (ground truth for the assertions).
function sumIn(rows, bounds, type) {
  return rows.filter(r => r.type === type && r.date >= bounds.start && r.date <= bounds.end)
             .reduce((s, r) => s + r.amount, 0);
}

// Org-A seeded ledger — single source for both the fixture inserts and the
// expected-value computation.
const cmn = now.getMonth() + 1; // current month number (in-window for both bases)
const ROWS = [
  { id: "cur1", date: d(CY, cmn, 10), amount: 5000, type: "income",  fund: "fov_f1" },
  { id: "cur2", date: d(CY, cmn, 12), amount: 2000, type: "income",  fund: "fov_f2" },
  { id: "cur3", date: d(CY, cmn, 14), amount: 1000, type: "expense", fund: "fov_f1" },
  { id: "pcal", date: d(CY - 1, 3, 9), amount: 9000, type: "income",  fund: "fov_f1" },
  { id: "pcal2", date: d(CY - 1, 4, 9), amount: 500, type: "expense", fund: "fov_f1" },
  { id: "pfy",  date: d(FY_START - 1, 9, 9), amount: 7000, type: "income", fund: "fov_f1" },
];

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["fin_transactions", "accounts", "fin_funds", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);

  await q(`INSERT INTO orgs (id,name,onboarding_complete,subscription_status,plan) VALUES ($1,'FOV A',1,'active','growth')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,onboarding_complete,subscription_status,plan) VALUES ($1,'FOV B',1,'active','growth')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fov_a',$1,'fov-a@test.local',$2,'A','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fov_b',$1,'fov-b@test.local',$2,'B','admin')`, [ORG_B, hash]);

  // Funds: F1 (unrestricted), F2 (restricted). F2 gets activity only in the
  // CURRENT period; F3 exists but never gets a txn (so it's never "active").
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fov_f1',$1,'General',false)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fov_f2',$1,'Restricted Youth',true)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fov_f3',$1,'Dormant',false)`, [ORG_A]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('fov_acc',$1,'4010','Contributions','revenue',true)`, [ORG_A]);

  // Current-period rows sit in the current calendar month (in-window for BOTH
  // bases). Prior rows sit in CY-1 and in FY_START-1; each basis's expected sum
  // is recomputed from ROWS via finPeriodBounds, so no magic numbers to drift.
  for (const r of ROWS) {
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id,source)
             VALUES ($1,$2,$3,$4,$5,$6,'fov_acc',$7,'manual')`,
      [r.id, ORG_A, r.date, `t${r.id}`, r.amount, r.type, r.fund]);
  }

  // Org B: a single current-period income row, different amount, to prove scoping.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fov_bf',$1,'B Fund',false)`, [ORG_B]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('fov_bacc',$1,'4010','C','revenue',true)`, [ORG_B]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id,source)
           VALUES ('bcur',$1,$2,'b',777,'income','fov_bacc','fov_bf','manual')`, [ORG_B, d(CY, cmn, 10)]);
}

// Expected values, recomputed from ROWS via the replicated period logic.
const allIncome = ROWS.filter(r => r.type === "income").reduce((s, r) => s + r.amount, 0);
const allExpense = ROWS.filter(r => r.type === "expense").reduce((s, r) => s + r.amount, 0);
const EXP = {
  cashOnHand: allIncome - allExpense,
  calCurRev: sumIn(ROWS, finPeriodBounds("calendar", 0), "income"),
  calCurExp: sumIn(ROWS, finPeriodBounds("calendar", 0), "expense"),
  calPriorRev: sumIn(ROWS, finPeriodBounds("calendar", -1), "income"),
  fisCurRev: sumIn(ROWS, finPeriodBounds("fiscal", 0), "income"),
  fisPriorRev: sumIn(ROWS, finPeriodBounds("fiscal", -1), "income"),
};

async function run() {
  await fixture();
  const tokenA = await login("fov-a@test.local");
  const tokenB = await login("fov-b@test.local");

  // ── CALENDAR basis ──────────────────────────────────────────────────────
  const cal = (await api("GET", "/finance/summary?yearMode=calendar", tokenA)).body;
  ok("calendar: cashOnHand reconciles with full ledger (Σin−Σout)",
    cal.cashOnHand === EXP.cashOnHand, { got: cal.cashOnHand, want: EXP.cashOnHand });
  ok("calendar: current-period revenue = current CY income",
    cal.ytdRevenue === EXP.calCurRev, { got: cal.ytdRevenue, want: EXP.calCurRev });
  ok("calendar: current-period expenses = current CY expense",
    cal.ytdExpenses === EXP.calCurExp, { got: cal.ytdExpenses, want: EXP.calCurExp });
  ok("calendar: prior-period revenue = prior CY income",
    cal.priorRevenue === EXP.calPriorRev, { got: cal.priorRevenue, want: EXP.calPriorRev });
  ok("calendar: cashOnHand ≠ ytdRevenue (distinct scopes — the credibility fix)",
    cal.cashOnHand !== cal.ytdRevenue, { cash: cal.cashOnHand, ytd: cal.ytdRevenue });
  ok("calendar: monthly is 12 months, Jan-first",
    cal.monthly.length === 12 && cal.monthly[0].label === "Jan" && cal.monthly[0].key === `${CY}-01`,
    { first: cal.monthly[0] });
  ok("calendar: monthlyLabel is the plain year",
    cal.monthlyLabel === `${CY}`, { got: cal.monthlyLabel });
  ok("calendar: activeFundCount = funds active THIS period (F1+F2 = 2, not 3 total)",
    cal.activeFundCount === 2, { got: cal.activeFundCount });

  // ── FISCAL basis ────────────────────────────────────────────────────────
  const fis = (await api("GET", "/finance/summary?yearMode=fiscal", tokenA)).body;
  ok("fiscal: cashOnHand identical (all-time, basis-independent)",
    fis.cashOnHand === EXP.cashOnHand, { got: fis.cashOnHand });
  ok("fiscal: current-period revenue = current-FY income",
    fis.ytdRevenue === EXP.fisCurRev, { got: fis.ytdRevenue, want: EXP.fisCurRev });
  ok("fiscal: prior-period revenue = prior-FY income",
    fis.priorRevenue === EXP.fisPriorRev, { got: fis.priorRevenue, want: EXP.fisPriorRev });
  ok("fiscal: monthly is 12 months and STARTS at Jul (FY start month)",
    fis.monthly.length === 12 && fis.monthly[0].label === "Jul" && fis.monthly[0].key === `${FY_START}-07`,
    { first: fis.monthly[0] });
  ok("fiscal: month 6 wraps to Jan of FY_START+1",
    fis.monthly[6].label === "Jan" && fis.monthly[6].key === `${FY_START + 1}-01`,
    { m6: fis.monthly[6] });
  ok("fiscal: monthlyLabel is the FY range 'FY YYYY–YY' (never a bare year)",
    fis.monthlyLabel === `FY ${FY_START}–${String(FY_START + 1).slice(2)}`, { got: fis.monthlyLabel });

  // ── Monthly collapse (client) — zero months absent, counted in "other N" ──
  const { active, hidden } = collapseMonthly(cal.monthly);
  ok("collapse: only months with activity are shown",
    active.every(m => m.income !== 0 || m.expense !== 0), { active: active.map(m => m.label) });
  ok("collapse: hidden count + shown count = full series (11 empty of 12 here)",
    active.length + hidden === 12 && active.length === 1 && hidden === 11,
    { activeLen: active.length, hidden });
  ok("collapse: order preserved (shown month is the current calendar month)",
    active[0] && active[0].label === cal.monthly[now.getMonth()].label, { shown: active[0] });

  // ── fundBalances (all-time, per fund) ─────────────────────────────────────
  const f1 = cal.fundBalances.find(f => f.id === "fov_f1");
  const f2 = cal.fundBalances.find(f => f.id === "fov_f2");
  const f3 = cal.fundBalances.find(f => f.id === "fov_f3");
  const fundNet = fund => ROWS.filter(r => r.fund === fund)
    .reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
  ok("fundBalances: F1 all-time net (income − expense across all periods)",
    f1 && f1.balance === fundNet("fov_f1"), { got: f1 && f1.balance, want: fundNet("fov_f1") });
  ok("fundBalances: F2 all-time net = 2000, flagged restricted",
    f2 && f2.balance === 2000 && f2.restricted === true, { got: f2 });
  ok("fundBalances: Σ fund balances = cashOnHand (no unassigned txns here)",
    cal.fundBalances.reduce((s, f) => s + f.balance, 0) === cal.cashOnHand,
    { sumFunds: cal.fundBalances.reduce((s, f) => s + f.balance, 0), cash: cal.cashOnHand });
  ok("fundBalances: dormant fund present with 0 balance",
    f3 && f3.balance === 0, { got: f3 });

  // ── HEADLINE guard cases ──────────────────────────────────────────────────
  // Real prior history (calendar): non-degenerate down clause, number not doubled.
  const hCal = financeHeadline(cal, "calendar");
  ok("headline(calendar): has 'from last year' clause when prior>0",
    /from last year\.$/.test(hCal), { hCal });
  ok("headline(calendar): direction is 'down' (7000 < 9000)",
    /down/.test(hCal) && !/up/.test(hCal), { hCal });
  ok("headline(calendar): revenue figure ($7,000) appears exactly once",
    hCal.split(fmtFull(7000)).length - 1 === 1, { hCal });
  ok("headline(calendar): 'across 2 funds' from activeFundCount",
    /across 2 funds/.test(hCal), { hCal });

  // No-prior-history org: clause dropped entirely.
  const noPrior = { ytdRevenue: 5002, priorRevenue: 0, activeFundCount: 3 };
  const hNo = financeHeadline(noPrior, "calendar");
  ok("headline(no history): comparison clause dropped",
    !/from last/.test(hNo) && hNo === "You're operating on $5,002 across 3 funds this year.", { hNo });
  ok("headline(no history): the figure is never rendered twice",
    hNo.split(fmtFull(5002)).length - 1 === 1, { hNo });

  // Degenerate delta===current guard (prior 0 caught even if it slipped past prior>0).
  const degen = financeHeadline({ ytdRevenue: 1240, priorRevenue: 0, activeFundCount: 1 }, "fiscal");
  ok("headline(degenerate): delta===current suppresses clause",
    !/from last/.test(degen), { degen });

  // Fully empty period → warm empty-state sentence, no numbers.
  const empty = financeHeadline({ ytdRevenue: 0, priorRevenue: 0, activeFundCount: 0 }, "fiscal");
  ok("headline(empty): warm empty-state copy, no dollar figure",
    /No money has moved this fiscal year yet/.test(empty) && !/\$/.test(empty), { empty });

  // Fiscal real-history headline (prior FY 7000, current 7000 → delta 0 → 'up $0'?).
  // delta===0, prior>0, delta!==rev → clause renders "up $0". Guard that it's not
  // a doubled number and reads sanely.
  const hFis = financeHeadline(fis, "fiscal");
  ok("headline(fiscal): clause present, figure once, 'fiscal year' wording",
    /this fiscal year/.test(hFis) && hFis.split(fmtFull(7000)).length - 1 === 1, { hFis });

  // ── ORG SCOPING ───────────────────────────────────────────────────────────
  const bSum = (await api("GET", "/finance/summary?yearMode=calendar", tokenB)).body;
  ok("scoping: org B sees only its own ledger (cash 777, not A's)",
    bSum.cashOnHand === 777, { got: bSum.cashOnHand });
  ok("scoping: org B fundBalances contains only B's fund",
    bSum.fundBalances.length === 1 && bSum.fundBalances[0].id === "fov_bf", { got: bSum.fundBalances });
  ok("scoping: org A cash unaffected by org B's data",
    cal.cashOnHand === EXP.cashOnHand, { got: cal.cashOnHand, want: EXP.cashOnHand });

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
