// Finance entity-routing FIX (2026-08-04) — donor/grant money enters through
// the gift/grant paths; manual money-in is non-donor revenue. Local scratch
// server + Postgres (tests/README.md recipe). No external creds.
//
// The live bug: logging $60,000 "Money in" with Vendor/Donor free-typed as
// "Mellon Foundation" while the Grants board showed Mellon with a $60k open
// ask. The ledger gained money; the grant stayed "in the works"; and marking
// it Awarded later would stamp the ledger AGAIN (double-count).
//
// What it proves:
//   - schema: fin_transactions.grant_id + partial-unique uq_fin_txns_grant
//   - pure matcher (client/src/lib/financeMatch.js): open-grant + donor name
//     matching, ambiguity → no match (never mis-assign)
//   - award transition → EXACTLY ONE ledger row (grant_id, source='grant');
//     a redundant awarded→awarded PUT re-stamps nothing; the DB unique makes
//     a second insert a no-op even if application logic slips
//   - un-award reverses the ledger (auto stamp deleted); re-award books once
//   - POST /grants created directly IN 'awarded' stamps once (was a gap)
//   - GET /grants/:id/manual-match finds a recent manual money-in by funder
//     name or exact amount, org-scoped, excludes already-linked rows
//   - PUT adoptTxnId: the existing manual row BECOMES the award's booking
//     (no new row, source stays 'manual', grant_id set) — same dollars once;
//     un-award UNLINKS the adopted row (treasurer data never deleted)
//   - adoptTxnId validation: foreign/wrong-shaped → 404 with NO state change
//   - gift path still books once (manual + award + gift can never double)
//   - org isolation both directions

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const ORG_A = "org_froute_a", ORG_B = "org_froute_b";
const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["fin_audit_log", "fin_transactions", "accounts", "fin_funds", "gifts", "interactions", "grants", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [org, slug] of [[ORG_A, "froute-a"], [ORG_B, "froute-b"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
      [org, "FRoute " + slug, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
      [`u_${org}`, org, `${slug}@test.local`, hash]);
    // Code 4010 is the account the gift route's ledger stamp looks up.
    await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Individual Contributions','revenue',true)`, [`acc_${org}`, org]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffg_${org}`, org]);
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,'Margaret Chen',$3,'mid','steward',500,2)`,
      [`d_${org}`, org, `mchen-${slug}@test.local`]);
    await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,deadline) VALUES ($1,$2,'Mellon Foundation','Community Arts Access',60000,'prospecting',$3)`,
      [`gr_mellon_${org}`, org, future]);
  }
  // A second donor in org A sharing a first name — the ambiguity case.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,'Margaret Okafor',$3,'new','cultivate',0,0)`,
    [`d2_${ORG_A}`, ORG_A, `mokafor@test.local`]);
}

const grantLedger = (org, grantId) =>
  q(`SELECT id, source, amount, grant_id, vendor_donor FROM fin_transactions WHERE org_id=$1 AND grant_id=$2`, [org, grantId]);

// Full-body PUT the way every client path sends it.
const putGrant = (token, id, g, status, extra = {}) =>
  api("PUT", `/grants/${id}`, token, {
    funder: g.funder, program: g.program || "", amount: g.amount, received: g.received || 0,
    status, deadline: g.deadline || "", reportDue: "", officer: "", notes: "",
    description: "", requirements: "", ...extra,
  });

const MELLON = { funder: "Mellon Foundation", program: "Community Arts Access", amount: 60000, deadline: future };

async function run() {
  await fixture();
  const a = await login("froute-a@test.local");
  const b = await login("froute-b@test.local");
  const GR = `gr_mellon_${ORG_A}`;

  // ── 1. schema ──
  {
    const col = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='fin_transactions' AND column_name='grant_id'`);
    ok("fin_transactions.grant_id column exists", col.length === 1);
    const idx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='fin_transactions' AND indexname='uq_fin_txns_grant'`);
    ok("grant_id partial-unique index exists", idx.length === 1, idx);
  }

  // ── 2. pure matcher lib ──
  {
    const m = await import("../client/src/lib/financeMatch.js");
    ok("namesMatch: funder vs legal-noise variant", m.namesMatch("Mellon Foundation", "The Mellon Fdn Inc") === true);
    ok("namesMatch: unrelated names don't match", m.namesMatch("Mellon Foundation", "Ford Foundation") === false);
    ok("namesMatch: short token never matches broadly", m.namesMatch("Jo", "Jonathan Atkinson") === false);
    const grants = [
      { id: "g1", funder: "Mellon Foundation", status: "prospecting", amount: 60000 },
      { id: "g2", funder: "Mellon Foundation", status: "loi", amount: 10000 },
      { id: "g3", funder: "Ford Foundation", status: "awarded", amount: 99999 },
    ];
    ok("findOpenGrantMatch: matches an open ask", m.findOpenGrantMatch("Mellon Foundation", grants)?.id === "g1");
    ok("findOpenGrantMatch: same funder, several asks → largest", m.findOpenGrantMatch("mellon", grants)?.id === "g1");
    ok("findOpenGrantMatch: awarded grant is NOT an open ask", m.findOpenGrantMatch("Ford", grants) === null);
    const ambiguous = [
      { id: "g4", funder: "Community Foundation of Boston", status: "applied", amount: 5000 },
      { id: "g5", funder: "Community Foundation of Austin", status: "applied", amount: 5000 },
    ];
    ok("findOpenGrantMatch: matches spanning different funders → null", m.findOpenGrantMatch("Community Foundation", ambiguous) === null);
    const donors = [{ id: "d1", name: "Margaret Chen" }, { id: "d2", name: "Margaret Okafor" }];
    ok("findDonorMatch: unique full name matches", m.findDonorMatch("Margaret Chen", donors)?.id === "d1");
    ok("findDonorMatch: ambiguous first name → null (never mis-assign)", m.findDonorMatch("Margaret", donors) === null);
    ok("findDonorMatch: unknown name → null", m.findDonorMatch("Beatrix Potter", donors) === null);
  }

  // ── 3. award transition books EXACTLY once; redundant PUT re-stamps nothing ──
  {
    const r = await putGrant(a, GR, MELLON, "awarded");
    ok("award PUT 200", r.status === 200, r.status);
    ok("awarded_at stamped", !!r.body.awarded_at);
    let rows = await grantLedger(ORG_A, GR);
    ok("award → EXACTLY ONE ledger row", rows.length === 1, rows.length);
    ok("row is source='grant', right amount + vendor", rows[0]?.source === "grant" && parseFloat(rows[0]?.amount) === 60000 && rows[0]?.vendor_donor === "Mellon Foundation", rows[0]);
    await putGrant(a, GR, MELLON, "awarded"); // redundant awarded→awarded
    rows = await grantLedger(ORG_A, GR);
    ok("redundant awarded→awarded PUT re-stamps nothing", rows.length === 1, rows.length);
    // The DB unique holds even if application logic slips: a raw second insert no-ops.
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,grant_id,source)
             VALUES ('ft_dup_test',$1,$2,'dup',60000,'income',$3,'grant')
             ON CONFLICT (grant_id) WHERE grant_id IS NOT NULL DO NOTHING`, [ORG_A, today, GR]);
    rows = await grantLedger(ORG_A, GR);
    ok("uq_fin_txns_grant: second insert is a DB-level no-op", rows.length === 1, rows.length);
  }

  // ── 4. un-award reverses the ledger; re-award books once ──
  {
    const r = await putGrant(a, GR, MELLON, "applied");
    ok("un-award PUT 200 + awarded_at cleared", r.status === 200 && !r.body.awarded_at, r.body.awarded_at);
    let rows = await grantLedger(ORG_A, GR);
    ok("un-award deletes the auto stamp (income reverses)", rows.length === 0, rows.length);
    await putGrant(a, GR, MELLON, "awarded");
    rows = await grantLedger(ORG_A, GR);
    ok("re-award books exactly once again", rows.length === 1, rows.length);
    await putGrant(a, GR, MELLON, "applied"); // back to open for the sections below
  }

  // ── 5. a grant created directly IN 'awarded' stamps once (was a gap) ──
  {
    const r = await api("POST", "/grants", a, { funder: "Kresge Foundation", program: "Ops", amount: 15000, status: "awarded" });
    ok("create-as-awarded 201", r.status === 201, r.status);
    const rows = await grantLedger(ORG_A, r.body.id);
    ok("create-as-awarded stamps the ledger once", rows.length === 1 && rows[0].source === "grant" && parseFloat(rows[0].amount) === 15000, rows);
  }

  // ── 6. manual-match detection ──
  let manualId;
  {
    const t = await api("POST", "/finance/transactions", a, {
      date: today, description: "Wire received", vendorDonor: "Mellon Foundation",
      amount: 60000, type: "income", accountId: `acc_${ORG_A}`, fundId: `ffg_${ORG_A}`,
    });
    ok("manual money-in logged (201)", t.status === 201, t.status);
    manualId = t.body.id;
    const mm = await api("GET", `/grants/${GR}/manual-match`, a);
    ok("manual-match finds the funder-named manual row", mm.status === 200 && mm.body.matches.some(m => m.id === manualId), mm.body);
    // Amount-only match: same $60k, different name.
    const t2 = await api("POST", "/finance/transactions", a, { date: today, description: "Unlabeled deposit", vendorDonor: "First National Bank", amount: 60000, type: "income" });
    const mm2 = await api("GET", `/grants/${GR}/manual-match`, a);
    ok("manual-match also flags an exact-amount row", mm2.body.matches.some(m => m.id === t2.body.id), mm2.body.matches.map(m => m.id));
    await api("DELETE", `/finance/transactions/${t2.body.id}`, a);
    // Isolation: org B's identical grant never sees org A's ledger.
    const mmB = await api("GET", `/grants/gr_mellon_${ORG_B}/manual-match`, b);
    ok("org B's manual-match sees nothing of org A", mmB.status === 200 && mmB.body.matches.length === 0, mmB.body);
    const mmX = await api("GET", `/grants/${GR}/manual-match`, b);
    ok("foreign grant id → 404", mmX.status === 404, mmX.status);
  }

  // ── 7. adoption: the manual row BECOMES the award's booking — dollars once ──
  {
    const before = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND type='income'`, [ORG_A]);
    const r = await putGrant(a, GR, MELLON, "awarded", { adoptTxnId: manualId });
    ok("award-with-adoption 200 + awarded_at", r.status === 200 && !!r.body.awarded_at, r.status);
    const after = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND type='income'`, [ORG_A]);
    ok("adoption inserts NO new row", after[0].n === before[0].n, { before: before[0].n, after: after[0].n });
    const row = await q(`SELECT source, grant_id, amount FROM fin_transactions WHERE id=$1`, [manualId]);
    ok("manual row now carries grant_id, source stays 'manual'", row[0]?.grant_id === GR && row[0]?.source === "manual", row[0]);
    const mellonTotal = await q(`SELECT COALESCE(SUM(amount),0)::numeric AS t FROM fin_transactions WHERE org_id=$1 AND type='income' AND (grant_id=$2 OR vendor_donor='Mellon Foundation')`, [ORG_A, GR]);
    ok("the $60k books EXACTLY once across manual+award", parseFloat(mellonTotal[0].t) === 60000, mellonTotal[0]);
    const mm = await api("GET", `/grants/${GR}/manual-match`, a);
    ok("an adopted (linked) row stops matching", !mm.body.matches.some(m => m.id === manualId), mm.body.matches);
  }

  // ── 8. un-award after adoption UNLINKS the treasurer's row, never deletes ──
  {
    await putGrant(a, GR, MELLON, "applied");
    const row = await q(`SELECT id, grant_id, source FROM fin_transactions WHERE id=$1`, [manualId]);
    ok("adopted row survives un-award, unlinked back to manual", row.length === 1 && row[0].grant_id === null && row[0].source === "manual", row[0]);
  }

  // ── 9. adoptTxnId validation — never a silent double-book ──
  {
    // Foreign txn id (org B's ledger) → 404, grant untouched.
    const tB = await api("POST", "/finance/transactions", b, { date: today, description: "B's money", vendorDonor: "X", amount: 100, type: "income" });
    const r1 = await putGrant(a, GR, MELLON, "awarded", { adoptTxnId: tB.body.id });
    ok("foreign adoptTxnId → 404", r1.status === 404, r1.status);
    const g1 = await q(`SELECT status, awarded_at FROM grants WHERE id=$1`, [GR]);
    ok("failed adoption leaves the grant un-awarded (no state change)", g1[0].status === "applied" && !g1[0].awarded_at, g1[0]);
    ok("failed adoption stamped nothing", (await grantLedger(ORG_A, GR)).length === 0);
    // A gift-sourced ledger row is not adoptable.
    const gift = await api("POST", `/donors/d_${ORG_A}/gifts`, a, { amount: 250, date: today, type: "cash" });
    const giftTxn = await q(`SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG_A, gift.body.gift.id]);
    const r2 = await putGrant(a, GR, MELLON, "awarded", { adoptTxnId: giftTxn[0].id });
    ok("gift-sourced row not adoptable → 404", r2.status === 404, r2.status);
    // adoptTxnId without an award status → 400.
    const r3 = await putGrant(a, GR, MELLON, "applied", { adoptTxnId: "ft_whatever" });
    ok("adoptTxnId on a non-award PUT → 400", r3.status === 400, r3.status);
  }

  // ── 10. gift path books once + manual donorId FK (the other routing arm) ──
  {
    const rows = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND donor_id=$2 AND source='gift'`, [ORG_A, `d_${ORG_A}`]);
    ok("gift-flow money-in → one gift-sourced ledger row", rows[0].n === 1, rows[0]);
    const t = await api("POST", "/finance/transactions", a, { date: today, description: "Ledger-only from a known donor", vendorDonor: "Margaret Chen", amount: 40, type: "income", donorId: `d_${ORG_A}` });
    ok("manual entry can carry the donor FK (entity-aware field)", t.status === 201 && t.body.donor_id === `d_${ORG_A}`, t.body.donor_id);
    const tf = await api("POST", "/finance/transactions", a, { date: today, description: "x", vendorDonor: "y", amount: 5, type: "income", donorId: `d_${ORG_B}` });
    ok("foreign donorId on manual entry → 404", tf.status === 404, tf.status);
    const dTot = await q(`SELECT total_giving FROM donors WHERE id=$1`, [`d_${ORG_A}`]);
    ok("ledger-only manual row never touches donor lifetime giving", parseFloat(dTot[0].total_giving) === 750, dTot[0]);
  }

  // ── 11. the Mellon scenario end-to-end: consistency across surfaces ──
  {
    // Clean slate for the scenario: the open grant + the treasurer's manual log.
    await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG_A]);
    await q(`UPDATE grants SET status='prospecting', awarded_at=NULL WHERE id=$1`, [GR]);
    const t = await api("POST", "/finance/transactions", a, { date: today, description: "Grant check received", vendorDonor: "Mellon Foundation", amount: 60000, type: "income", fundId: `ffg_${ORG_A}` });
    // Award accepts the guard's link offer:
    await putGrant(a, GR, MELLON, "awarded", { adoptTxnId: t.body.id });
    const s = await api("GET", "/finance/summary?yearMode=calendar", a);
    ok("Cash on Hand = $60,000 (once, not $120,000)", parseFloat(s.body.cashOnHand) === 60000, s.body.cashOnHand);
    const open = await q(`SELECT COUNT(*)::int AS n FROM grants WHERE org_id=$1 AND status IN ('prospecting','loi','applied','submitted','draft','pending')`, [ORG_A]);
    ok("the open ask cleared (board moved to Awarded)", open[0].n === 0, open[0]);
    const gr = await q(`SELECT status, awarded_at FROM grants WHERE id=$1`, [GR]);
    ok("grant is awarded with awarded_at (attribution fact)", gr[0].status === "awarded" && !!gr[0].awarded_at, gr[0]);
  }

  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
