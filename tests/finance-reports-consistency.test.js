// BUILD-26 Part B1 — Finance ↔ Reports can never be read as contradictory.
// Local scratch server + Postgres (tests/README.md recipe).
//
// The decision (Option A): imported HISTORICAL giving is records being loaded, not
// money moving through Steward, so it deliberately never stamps fin_transactions —
// it lives in Reports/Donors. The HARD RULE: no screen may imply "$0 raised" when
// a giving history exists. Finance must EXPLAIN the gap and cross-link to Reports.
// This suite proves the /finance/summary signal that drives that explainer is
// correct, and that a CURRENT-period gift (which DOES reach the ledger) is not
// mislabeled as unledgered — so the guardrail in consistency-e2e still holds.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_frc_a", B = "org_frc_b";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const num = v => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["fin_transactions", "gifts", "interactions", "donors", "accounts", "fin_funds", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `FRC ${tag}`, `frc-${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
    [`u_${o}`, o, `${tag}@frc.local`, bcrypt.hashSync("loadtest1234", 10)]);
  // A contribution account + unrestricted fund so a CURRENT-period gift CAN stamp
  // the ledger (proving the gap is date-driven, not a missing account).
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Contributions','revenue',true)`, [`acc_${o}`, o]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${o}`, o]);
}

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  const tA = await login("a@frc.local");
  const tB = await login("b@frc.local");

  // Fresh org: no giving anywhere → Finance is honestly empty, NOT "unledgered".
  const empty = (await api("GET", "/finance/summary?yearMode=fiscal", tA)).body;
  ok("empty org: no giving history", num(empty.giftHistoryTotal) === 0 && empty.giftHistoryCount === 0);
  ok("empty org: NOT flagged as having unledgered giving", empty.hasUnledgeredGiving === false, empty);

  // ── Import a large HISTORICAL giving history (all prior-FY dated) ──
  // 3 donors, big totals, gifts dated 400–900 days ago (well before this FY).
  const { groupTransactions } = await import("../shared/importShape.js");
  const ledger = [
    { key: "h1@frc.local", donor: { name: "Historic One", email: "h1@frc.local" }, gift: { amount: 400000, date: daysAgo(500) } },
    { key: "h2@frc.local", donor: { name: "Historic Two", email: "h2@frc.local" }, gift: { amount: 200000, date: daysAgo(700) } },
    { key: "h3@frc.local", donor: { name: "Historic Three", email: "h3@frc.local" }, gift: { amount: 97540, date: daysAgo(900) } },
  ];
  const grouped = groupTransactions(ledger);
  const imp = await api("POST", "/donors/import-combined", tA, grouped);
  ok("historical import 200 (3 donors, 3 gifts)", imp.status === 200 && imp.body.giftsInserted === 3, imp.body);
  const HIST_TOTAL = 400000 + 200000 + 97540; // 697,540 — the observed number

  // Reports SEES the whole giving history (it reads gifts directly).
  const rep = (await api("GET", "/reports/giving-summary?yearMode=fiscal&year=2020", tA)).body; // any year param; total is period-scoped
  // Use lifetime top-donors as the robust "history exists" probe (period-agnostic).
  const top = (await api("GET", "/reports/top-donors?scope=lifetime&limit=10", tA)).body;
  const reportsGiving = (top.rows || top || []).reduce((s, r) => s + num(r.total ?? r.lifetime ?? r.total_giving), 0);
  ok("Reports shows the full giving history (lifetime)", reportsGiving === HIST_TOTAL, { reportsGiving, HIST_TOTAL });

  // Finance summary: the historical giving is NOT in the ledger…
  const fin = (await api("GET", "/finance/summary?yearMode=fiscal", tA)).body;
  ok("Finance ledger gift income excludes historical imports (~$0)", num(fin.ledgerGiftTotal) === 0, fin.ledgerGiftTotal);
  ok("Finance Cash on Hand is NOT the giving total (history isn't ledger money)", num(fin.cashOnHand) === 0, fin.cashOnHand);
  // …but Finance KNOWS the history exists and flags it for the explainer.
  ok("Finance knows the full giving history total", num(fin.giftHistoryTotal) === HIST_TOTAL, fin.giftHistoryTotal);
  ok("Finance counts the imported gifts", fin.giftHistoryCount === 3, fin.giftHistoryCount);
  ok("Finance flags hasUnledgeredGiving (drives the Reports cross-link explainer)", fin.hasUnledgeredGiving === true, fin);
  ok("Finance unledgeredGiving == the giving history (nothing implied as $0)", num(fin.unledgeredGiving) === HIST_TOTAL, fin.unledgeredGiving);

  // THE NO-CONTRADICTION RULE: it is never true that a giving history exists AND
  // Finance shows an unexplained empty ledger. If gifts exist and the ledger gift
  // income is ~0, the summary MUST flag it (so the UI cross-links, never bare $0).
  const contradiction = num(fin.giftHistoryTotal) > 1 && num(fin.ledgerGiftTotal) <= 1 && !fin.hasUnledgeredGiving;
  ok("NO contradiction: giving history without ledger money is always explained", !contradiction);

  // ── A CURRENT-period gift DOES reach the ledger and is NOT mislabeled ──
  // (preserves consistency-e2e's model: current-period imports/gifts stamp once.)
  const h1 = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email='h1@frc.local'`, [A]))[0];
  const g = await api("POST", `/donors/${h1.id}/gifts`, tA, { amount: 5000, date: daysAgo(0) });
  ok("current-period gift recorded", g.status === 201, g.body);
  const fin2 = (await api("GET", "/finance/summary?yearMode=fiscal", tA)).body;
  ok("current-period gift reaches the ledger (gift income now $5,000)", num(fin2.ledgerGiftTotal) === 5000, fin2.ledgerGiftTotal);
  ok("current-period gift shows in period revenue (not implied as $0)", num(fin2.ytdRevenue) === 5000, fin2.ytdRevenue);
  ok("giving history total grows by the new gift", num(fin2.giftHistoryTotal) === HIST_TOTAL + 5000, fin2.giftHistoryTotal);
  ok("unledgered still == ONLY the historical portion (current gift excluded)", num(fin2.unledgeredGiving) === HIST_TOTAL, fin2.unledgeredGiving);
  ok("still flagged (historical giving remains outside the ledger)", fin2.hasUnledgeredGiving === true);

  // ── Org isolation — B sees none of A's giving ──
  const finB = (await api("GET", "/finance/summary?yearMode=fiscal", tB)).body;
  ok("org B sees no giving history from A", num(finB.giftHistoryTotal) === 0 && finB.hasUnledgeredGiving === false);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
