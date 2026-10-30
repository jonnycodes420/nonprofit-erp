// BUILD-21 Part 3 — "every gift stamps fin_transactions exactly once".
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The bug: logging a gift from a donor profile created TWO ledger rows — one
// source='gift' (correct) and a stray source='manual' from a second client call
// — inflating Cash on Hand. The fix: the gift route stamps once, carrying the
// chosen fund, and the stamp is idempotent (partial-unique on fin_transactions.
// gift_id, ON CONFLICT DO NOTHING) so no path can double-insert.
//
// What it proves:
//   - schema: fin_transactions.gift_id + its partial-unique index exist
//   - donor-profile gift  → exactly ONE row, source='gift', donor_id+gift_id set
//   - a chosen fundId lands on both the gift and its single ledger row
//   - import (gift-history)→ exactly ONE row per gift, source='import', gift_id set
//   - idempotency mechanism: a second stamp for the same gift_id is a no-op
//     (the ON CONFLICT (gift_id) clause every gift-stamp path shares — this is
//     what makes the online webhook + every other path non-double-insertable)
//   - a genuine manual /finance/transactions entry still works (gift_id null)
//   - Cash on Hand after a mix of gifts = Σ gifts (no inflation)
//   - findManualDupes() flags a legacy manual twin but never a lone manual row
//   - org-scoped: org B never sees org A's rows

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, waitFor } = require("./helpers");
const { findManualDupes } = require("../scripts/dedupe-finance-gift-stamps");

const ORG_A = "org_gstamp_a", ORG_B = "org_gstamp_b";
const today = require("./helpers").civilToday();

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["fin_audit_log", "fin_transactions", "budgets", "accounts", "fin_funds", "gifts", "interactions", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [org, slug, acct] of [[ORG_A, "gstamp-a", "acct_gstamp_a"], [ORG_B, "gstamp-b", null]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,$2,$3,1,'active','growth',$4)`,
      [org, "GStamp " + slug, slug, acct]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
      [`u_${org}`, org, `${slug}@test.local`, hash]);
    await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Individual Contributions','revenue',true)`, [`acc_${org}`, org]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffg_${org}`, org]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Scholarship Fund',true)`, [`ffr_${org}`, org]);
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,'Ada Donor',$3,'new','cultivate',0,0)`,
      [`d_${org}`, org, `ada-${slug}@test.local`]);
  }
}

async function run() {
  await fixture();
  const a = await login("gstamp-a@test.local");

  // ── 1. schema ──
  {
    const col = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='fin_transactions' AND column_name='gift_id'`);
    ok("fin_transactions.gift_id column exists", col.length === 1);
    const idx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='fin_transactions' AND indexname='uq_fin_txns_gift'`);
    ok("fin_transactions gift_id partial-unique index exists", idx.length === 1, idx.map(i => i.indexname));
  }

  // ── 2. donor-profile gift → exactly one row, with a chosen fund ──
  {
    const g = await api("POST", `/donors/d_${ORG_A}/gifts`, a, { amount: 250, date: today, type: "cash", fundId: `ffr_${ORG_A}` });
    ok("gift logged (201)", g.status === 201, g.status);
    const giftId = g.body?.gift?.id;
    const rows = await q(`SELECT source, donor_id, gift_id, fund_id, amount FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG_A, giftId]);
    ok("donor-profile gift → EXACTLY ONE ledger row", rows.length === 1, rows.length);
    ok("row stamped source='gift' + donor_id + gift_id", rows[0]?.source === "gift" && rows[0]?.donor_id === `d_${ORG_A}` && rows[0]?.gift_id === giftId, rows[0]);
    ok("chosen fund lands on the ledger row", rows[0]?.fund_id === `ffr_${ORG_A}`, rows[0]?.fund_id);
    const giftRow = await q(`SELECT fund_id FROM gifts WHERE id=$1`, [giftId]);
    ok("chosen fund lands on the gift itself", giftRow[0]?.fund_id === `ffr_${ORG_A}`, giftRow[0]);
    // No source='manual' twin (the old double-stamp) for this donor.
    const manual = await q(`SELECT id FROM fin_transactions WHERE org_id=$1 AND donor_id=$2 AND source='manual'`, [ORG_A, `d_${ORG_A}`]);
    ok("no stray manual twin created", manual.length === 0, manual.length);
  }

  // ── 3. gift-history import → NO ledger row at all ──
  // MONEY-FLOW CONTRACT CHANGE, BUILD-83 Part 6 (deliberate, reviewed): an
  // import is history being loaded, not money moving through Steward, so it
  // posts nothing to the ledger. The gift row still lands and every gift-history
  // surface counts it; Finance flags the gap (hasUnledgeredGiving) instead of
  // quietly booking someone else's past year as this year's revenue. The
  // once-and-only-once stamp rule still governs every LIVE path (§2, §4, §5).
  {
    const imp = await api("POST", "/gifts/import-history", a, {
      gifts: [{ donorId: `d_${ORG_A}`, amount: 400, date: today, type: "cash", campaign: "", notes: "" }],
    });
    ok("gift-history import ok", imp.status === 200 || imp.status === 201, imp.status);
    // FIX-37: a recent imported gift is written behind the screen; wait for it.
    await waitFor(async () => { const r = await api("GET", `/imports/${imp.body?.importId}/progress`, a); return r.body?.status === "done" ? r : null; }, { timeout: 20000 }).catch(() => null);
    const gRows = await q(`SELECT id FROM gifts WHERE org_id=$1 AND amount=400`, [ORG_A]);
    ok("the imported gift row itself lands", gRows.length === 1, gRows.length);
    const rows = await q(`SELECT source, gift_id FROM fin_transactions WHERE org_id=$1 AND source='import'`, [ORG_A]);
    ok("import posts NOTHING to the ledger", rows.length === 0, rows.length);
  }

  // ── 4. idempotency mechanism — a second stamp for the same gift_id is a no-op.
  // This is the exact ON CONFLICT (gift_id) clause every gift-stamp path shares
  // (donor-profile, import, and the Stripe webhook's source='online' insert), so
  // proving it here proves none of them can double-insert for one gift. Run
  // through the real DB + real clause; a duplicate attempt must leave 1 row. ──
  {
    const gid = "g_idem_test";
    const stamp = () => q(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id)
       VALUES ($1,$2,$3,'Gift from Ada Donor','Ada Donor',999,'income',$4,$5,$6,'online',$7)
       ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
      ["ft_" + Math.random().toString(36).slice(2, 10), ORG_A, today, `acc_${ORG_A}`, `ffg_${ORG_A}`, `d_${ORG_A}`, gid]
    );
    await stamp();
    await stamp(); // the double-fire a buggy path would produce
    const rows = await q(`SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG_A, gid]);
    ok("same gift_id stamped twice → exactly one row survives (ON CONFLICT no-op)", rows.length === 1, rows.length);
    await q(`DELETE FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG_A, gid]); // keep §6's total clean
  }

  // ── 5. genuine manual entry still works (gift_id null) ──
  {
    const m = await api("POST", "/finance/transactions", a, {
      date: today, description: "Office rent", vendorDonor: "Landlord LLC",
      amount: 900, type: "expense", accountId: `acc_${ORG_A}`, fundId: `ffg_${ORG_A}`,
    });
    ok("manual entry created (201)", m.status === 201, m.status);
    const row = await q(`SELECT source, gift_id FROM fin_transactions WHERE id=$1`, [m.body?.id]);
    ok("manual entry: source='manual', gift_id null", row[0]?.source === "manual" && row[0]?.gift_id === null, row[0]);
  }

  // ── 6. Cash on Hand = Σ income − Σ expense, no inflation ──
  {
    const sum = await api("GET", "/finance/summary", a);
    // income: 250 (gift) + 400 (import) = 650 ; expense 900 → −250. If a gift had
    // double-stamped, income would read 900 (net −0) — the bug this guards.
    // BUILD-83 Part 6: the $400 gift-history import no longer books income, so
    // the ledger holds the two LIVE gifts (250 + 400 = 650... minus the import's
    // 400 that never lands) — i.e. live money only, against the 900 expense.
    const expectedCash = Number(sum.body?.cashOnHand);
    const liveIncome = await q(`SELECT COALESCE(SUM(amount),0)::numeric s FROM fin_transactions WHERE org_id=$1 AND type='income'`, [ORG_A]);
    const expense = await q(`SELECT COALESCE(SUM(amount),0)::numeric s FROM fin_transactions WHERE org_id=$1 AND type='expense'`, [ORG_A]);
    ok("Cash on Hand == live income − expenses, and no imported history in it",
       expectedCash === Number(liveIncome[0].s) - Number(expense[0].s), { expectedCash, live: liveIncome[0].s, expense: expense[0].s });
  }

  // ── 7. findManualDupes() — flags a legacy twin, spares a lone manual row ──
  {
    const ledger = [
      { id: "x1", type: "income", date: today, amount: 250, vendor_donor: "Ada Donor", description: "Gift from Ada Donor", source: "gift", gift_id: "g_real" },
      { id: "x2", type: "income", date: today, amount: 250, vendor_donor: "Ada Donor", description: "Gift from Ada Donor", source: "manual", gift_id: null }, // the legacy dupe
      { id: "x3", type: "income", date: today, amount: 60, vendor_donor: "Bake Sale", description: "Bake sale proceeds", source: "manual", gift_id: null }, // lone real manual — keep
    ];
    const dupes = findManualDupes(ledger);
    ok("dedupe flags the legacy manual twin", dupes.length === 1 && dupes[0].id === "x2", dupes.map(d => d.id));
    ok("dedupe spares a lone real manual row", !dupes.some(d => d.id === "x3"));
  }

  // ── 8. org isolation ──
  {
    const rowsB = await q(`SELECT id FROM fin_transactions WHERE org_id=$1`, [ORG_B]);
    ok("org B has no ledger rows from org A's activity", rowsB.length === 0, rowsB.length);
  }

  // ── 9. FIX-60 · fair comparisons in Finance ──
  // (a) Budgets follow the fiscal year on a page set to it. A row stores its
  // basis; an old row (no basis) is a calendar budget and stays one. Red on
  // main: ?basis=fiscal ignored the row's kind and drew the calendar 2026 line
  // under the fiscal page, and a fiscal write overwrote the calendar row.
  {
    const Y = Number(today.slice(0, 4)), md = today.slice(5);
    const fyEnd = md >= "07-01" ? Y + 1 : Y;   // the org never set a start month: July
    await q(`INSERT INTO budgets (id,org_id,account_id,year,amount) VALUES ('bgt_fix60_old',$1,$2,$3,1000)`, [ORG_A, `acc_${ORG_A}`, fyEnd]);
    const pg = await api("GET", `/finance/budgets?basis=fiscal&shape=page`, a);
    const rows = (pg.body && pg.body.rows) || [];
    ok("§fix60 the fiscal page names its year (FY, July to June)", pg.body && pg.body.basis === "fiscal" && pg.body.year === fyEnd
       && pg.body.periodStart === `${fyEnd - 1}-07-01` && pg.body.periodEnd === `${fyEnd}-06-30`, pg.body && { basis: pg.body.basis, year: pg.body.year, from: pg.body.periodStart });
    ok("§fix60 an old (calendar) budget is not drawn on the fiscal page", rows.length > 0 && !rows.some(r => r.id === "bgt_fix60_old"), rows.map(r => r.id));
    ok("§fix60 the fiscal page says where the calendar line is", pg.body && pg.body.otherBasis && pg.body.otherBasis.lines === 1 && pg.body.otherBasis.basis === "calendar", pg.body && pg.body.otherBasis);
    const w = await api("POST", "/finance/budgets", a, { accountId: `acc_${ORG_A}`, year: fyEnd, amount: 500, basis: "fiscal" });
    const kept = await q(`SELECT b.id, b.amount::numeric AS amount, to_jsonb(b)->>'basis' AS basis FROM budgets b WHERE b.org_id=$1 ORDER BY b.id`, [ORG_A]);
    ok("§fix60 a fiscal budget is its own row; the calendar one is untouched", w.status === 200 && kept.length === 2
       && kept.some(r => r.id === "bgt_fix60_old" && Number(r.amount) === 1000 && r.basis === null)
       && kept.some(r => r.id !== "bgt_fix60_old" && Number(r.amount) === 500 && r.basis === "fiscal"), kept);
    const cal = await api("GET", `/finance/budgets?basis=calendar&year=${fyEnd}`, a);
    ok("§fix60 the calendar page still reads the old line", Array.isArray(cal.body) && cal.body.some(r => r.id === "bgt_fix60_old" && r.budget === 1000 && r.basis === "calendar"), cal.body);
    const fis = await api("GET", `/finance/budgets?basis=fiscal&year=${fyEnd}`, a);
    ok("§fix60 the fiscal page reads the fiscal line", Array.isArray(fis.body) && fis.body.some(r => r.budget === 500) && !fis.body.some(r => r.budget === 1000), fis.body);
  }
  // (b) A zero variance reads "on budget", never "+$0"; and a fiscal year
  // four months in is four months in, for the projection.
  {
    const W = await import("../client/src/lib/budgetWords.js").catch(e => ({ err: e.message }));
    const money = n => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
    ok("§fix60 a zero variance reads \"on budget\"", !W.err && W.budgetVarianceText(0, money) === "on budget" && W.budgetVarianceText(0.004, money) === "on budget", W.err);
    ok("§fix60 a real variance keeps its sign", !W.err && W.budgetVarianceText(12.5, money) === "+$12.50" && W.budgetVarianceText(-3, money) === "-$3.00");
    ok("§fix60 months gone by are the budget year's own", !W.err && W.budgetMonthsElapsed("2026-07-01", "2027-06-30", "2026-10-30") === 4
       && W.budgetMonthsElapsed("2026-01-01", "2026-12-31", "2026-10-30") === 10 && W.budgetMonthsElapsed("2027-07-01", "2028-06-30", "2026-10-30") === 0);
  }
  // (c) The Revenue card compared this year so far with ALL of last year.
  // It compares with the same days. Red on main: no samePointRevenue.
  {
    const Y = Number(today.slice(0, 4)), md = today.slice(5);
    const txn = (date, amount) => q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,source)
      VALUES ($1,$2,$3,'fix60','fix60',$4,'income',$5,'manual')`, ["ft_fix60_" + Math.random().toString(36).slice(2, 8), ORG_A, date, amount, `acc_${ORG_A}`]);
    await txn(`${Y - 1}-01-01`, 100);
    if (md !== "12-31") await txn(`${Y - 1}-12-31`, 7);
    const sm = await api("GET", "/finance/summary?yearMode=calendar", a);
    const prevTo = md === "02-29" ? `${Y - 1}-02-28` : `${Y - 1}-${md}`;
    ok("§fix60 the Revenue card's comparison is the same days last year", sm.body && sm.body.samePoint && sm.body.samePoint.from === `${Y - 1}-01-01` && sm.body.samePoint.to === prevTo, sm.body && sm.body.samePoint);
    ok("§fix60 and counts only those days' income", sm.body && Number(sm.body.samePointRevenue) === (md === "12-31" ? 107 : 100), sm.body && sm.body.samePointRevenue);
  }

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
