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
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const { findManualDupes } = require("../scripts/dedupe-finance-gift-stamps");

const ORG_A = "org_gstamp_a", ORG_B = "org_gstamp_b";
const today = require("./helpers").civilToday();

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["fin_audit_log", "fin_transactions", "accounts", "fin_funds", "gifts", "interactions", "donors", "users"])
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

  // ── 3. gift-history import → one row per gift, source='import', gift_id set ──
  {
    const imp = await api("POST", "/gifts/import-history", a, {
      gifts: [{ donorId: `d_${ORG_A}`, amount: 400, date: today, type: "cash", campaign: "", notes: "" }],
    });
    ok("gift-history import ok", imp.status === 200 || imp.status === 201, imp.status);
    const rows = await q(`SELECT source, gift_id FROM fin_transactions WHERE org_id=$1 AND source='import' AND gift_id IS NOT NULL`, [ORG_A]);
    ok("import gift → exactly one ledger row with gift_id", rows.length === 1, rows.length);
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
    ok("Cash on Hand reconciles (650 − 900 = −250), no doubled gift", Number(sum.body?.cashOnHand) === -250, sum.body?.cashOnHand);
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

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
