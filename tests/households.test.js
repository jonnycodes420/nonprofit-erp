// BUILD-14 Part 1 — Households / soft credit suite.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The correctness crux: HARD CREDIT NEVER MOVES. Creating/deleting a household
// must leave org hard totals byte-identical everywhere they're computed
// (DB gift sum, DB total_giving sum, Reports giving-summary, Reports
// top-donors, Fundraising overview, Finance summary). Combined giving and
// soft credit are DERIVED views over the same gift rows, never stored — so
// grouping by household can never double-count. Also covers: primary/secondary,
// combined giving history, PUT (rename/re-primary/add-remove member), DELETE
// (unlink, no cascade into donors/gifts), validation, checkWriteAccess, and
// two-way org isolation incl. foreign-member IDOR.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_hh_a", B = "org_hh_b", RO = "org_hh_ro";
const today = new Date().toISOString().slice(0, 10);
const round2 = n => Math.round(n * 100) / 100;

async function reset() {
  for (const org of [A, B, RO]) {
    for (const t of ["donor_designations", "households", "gifts", "interactions", "fin_transactions", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    // households FK from donors is SET NULL; delete households after donors cleared above is fine
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}

async function seedOrg(o, tag, subStatus = "active") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,'growth')`,
    [o, `HH ${tag}`, `hh-${tag}`, subStatus]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${o}`, o, `${tag}@hh.local`, hash, `Admin ${tag}`]);
}
async function seedDonor(o, id, name, total) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,last_gift_amount)
           VALUES ($1,$2,$3,$4,'mid','cultivate',$5,1,$6,$5)`,
    [id, o, name, `${id}@hh.local`, total, today]);
}
async function seedGift(o, donorId, amount) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'one-time')`,
    ["g_" + Math.random().toString(36).slice(2, 10), o, donorId, amount, today]);
}
const dbSum = async (sql, org) => parseFloat((await q(sql, [org]))[0].s) || 0;

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  await seedOrg(RO, "ro", "trial_expired");

  // Org A: Alice + Bob Smith (a household), Carol Jones (solo). Cents on purpose.
  await seedDonor(A, "d_alice", "Alice Smith", 150.50);
  await seedGift(A, "d_alice", 100.00); await seedGift(A, "d_alice", 50.50);
  await seedDonor(A, "d_bob", "Bob Smith", 200.00);
  await seedGift(A, "d_bob", 200.00);
  await seedDonor(A, "d_carol", "Carol Jones", 75.25);
  await seedGift(A, "d_carol", 75.25);
  const ORG_HARD_TOTAL = round2(150.50 + 200 + 75.25); // 425.75

  // Org B: one donor, for isolation probes
  await seedDonor(B, "d_bx", "Zed Foreign", 999);

  const tokenA = await login("a@hh.local");
  const tokenB = await login("b@hh.local");
  const tokenRO = await login("ro@hh.local");

  // ── Baseline hard totals (before any household) ───────────────────────────
  const giftSumSql = "SELECT COALESCE(SUM(amount),0) AS s FROM gifts WHERE org_id=$1";
  const totalGivingSql = "SELECT COALESCE(SUM(total_giving),0) AS s FROM donors WHERE org_id=$1 AND deleted_at IS NULL";
  const before = {
    giftSum: await dbSum(giftSumSql, A),
    totalGiving: await dbSum(totalGivingSql, A),
    givingSummary: (await api("GET", "/reports/giving-summary", tokenA)).body.total,
    fundraising: (await api("GET", "/fundraising/overview", tokenA)).body.period.raised,
    finance: (await api("GET", "/finance/summary", tokenA)).body.cashOnHand,
    topIndividual: (await api("GET", "/reports/top-donors", tokenA)).body.rows.reduce((s, r) => s + r.total, 0),
  };
  ok("baseline gift sum = org hard total", round2(before.giftSum) === ORG_HARD_TOTAL, before.giftSum);
  ok("baseline top-donors(individual) sums to org total", round2(before.topIndividual) === ORG_HARD_TOTAL, before.topIndividual);

  // ── Create household ──────────────────────────────────────────────────────
  const create = await api("POST", "/households", tokenA, { memberIds: ["d_alice", "d_bob"], primaryDonorId: "d_alice" });
  ok("POST /households → 201", create.status === 201, create.status);
  const hhId = create.body.id;
  ok("default name is 'The Smith Household'", create.body.name === "The Smith Household", create.body.name);
  ok("member_count = 2", create.body.member_count === 2, create.body.member_count);
  ok("combined_giving = 350.50 (sum of members' hard credit)", round2(create.body.combined_giving) === 350.50, create.body.combined_giving);
  const alice = create.body.members.find(m => m.id === "d_alice");
  const bob = create.body.members.find(m => m.id === "d_bob");
  ok("Alice flagged primary", alice.is_primary === true && bob.is_primary === false);
  ok("Alice hard credit unchanged (150.50)", round2(alice.total_giving) === 150.50, alice.total_giving);
  ok("Alice soft credit = Bob's gifts (200)", round2(alice.soft_credit) === 200, alice.soft_credit);
  ok("Bob soft credit = Alice's gifts (150.50)", round2(bob.soft_credit) === 150.50, bob.soft_credit);

  // ── THE INVARIANT: org hard totals unchanged everywhere ───────────────────
  const after = {
    giftSum: await dbSum(giftSumSql, A),
    totalGiving: await dbSum(totalGivingSql, A),
    givingSummary: (await api("GET", "/reports/giving-summary", tokenA)).body.total,
    fundraising: (await api("GET", "/fundraising/overview", tokenA)).body.period.raised,
    finance: (await api("GET", "/finance/summary", tokenA)).body.cashOnHand,
  };
  ok("HARD INVARIANT: DB gift sum unchanged", after.giftSum === before.giftSum, [before.giftSum, after.giftSum]);
  ok("HARD INVARIANT: DB total_giving sum unchanged", after.totalGiving === before.totalGiving, [before.totalGiving, after.totalGiving]);
  ok("HARD INVARIANT: Reports giving-summary total unchanged", after.givingSummary === before.givingSummary, [before.givingSummary, after.givingSummary]);
  ok("HARD INVARIANT: Fundraising overview raised unchanged", after.fundraising === before.fundraising, [before.fundraising, after.fundraising]);
  ok("HARD INVARIANT: Finance summary cashOnHand unchanged", after.finance === before.finance, [before.finance, after.finance]);

  // ── Reports: individual vs household, no inflation ────────────────────────
  const topHH = (await api("GET", "/reports/top-donors?view=household", tokenA)).body;
  const hhTotal = topHH.rows.reduce((s, r) => s + r.total, 0);
  ok("top-donors(household) sums to SAME org total (no double-count)", round2(hhTotal) === ORG_HARD_TOTAL, hhTotal);
  const hhRow = topHH.rows.find(r => r.isHousehold);
  ok("household appears as ONE row", hhRow && round2(hhRow.total) === 350.50 && hhRow.memberCount === 2, hhRow);
  ok("solo donor still its own row", topHH.rows.some(r => !r.isHousehold && round2(r.total) === 75.25));
  ok("household view has fewer rows than individual (2 vs 3)", topHH.rows.length === 2, topHH.rows.length);

  // ── Combined giving history ───────────────────────────────────────────────
  const profile = (await api("GET", `/households/${hhId}`, tokenA)).body;
  ok("household profile giving_history merges both members (3 gifts)", profile.giving_history.length === 3, profile.giving_history.length);
  ok("history includes both donors", new Set(profile.giving_history.map(g => g.donor_id)).size === 2);

  // ── List ──────────────────────────────────────────────────────────────────
  const list = (await api("GET", "/households", tokenA)).body;
  ok("GET /households lists it with combined_giving", list.length === 1 && round2(list[0].combined_giving) === 350.50, list);

  // ── Soft-credit endpoint ──────────────────────────────────────────────────
  const sc = (await api("GET", "/donors/d_alice/soft-credit", tokenA)).body;
  ok("soft-credit: hard 150.50 / soft 200 / combined 350.50", round2(sc.hardCredit) === 150.50 && round2(sc.softCredit) === 200 && round2(sc.householdCombined) === 350.50, sc);
  const scSolo = (await api("GET", "/donors/d_carol/soft-credit", tokenA)).body;
  ok("solo donor: soft credit 0, combined = own hard", round2(scSolo.softCredit) === 0 && round2(scSolo.householdCombined) === 75.25, scSolo);

  // ── PUT: rename, re-primary, add member ───────────────────────────────────
  const reprimary = await api("PUT", `/households/${hhId}`, tokenA, { primaryDonorId: "d_bob" });
  ok("PUT re-primary → Bob primary", reprimary.body.members.find(m => m.id === "d_bob").is_primary === true);
  const rename = await api("PUT", `/households/${hhId}`, tokenA, { name: "Smith Family Fund" });
  ok("PUT rename", rename.body.name === "Smith Family Fund", rename.body.name);
  const addMember = await api("PUT", `/households/${hhId}`, tokenA, { memberIds: ["d_alice", "d_bob", "d_carol"] });
  ok("PUT add member → 3, combined now full org total", addMember.body.member_count === 3 && round2(addMember.body.combined_giving) === ORG_HARD_TOTAL, addMember.body.combined_giving);
  // adding Carol didn't move any hard credit
  ok("hard total STILL unchanged after add", await dbSum(giftSumSql, A) === before.giftSum);
  const removeMember = await api("PUT", `/households/${hhId}`, tokenA, { memberIds: ["d_bob", "d_carol"] });
  ok("PUT remove Alice → she's unlinked", removeMember.body.member_count === 2 && !removeMember.body.members.some(m => m.id === "d_alice"));
  ok("removed member household_id is NULL", (await q("SELECT household_id FROM donors WHERE id='d_alice'"))[0].household_id === null);

  // ── Validation ────────────────────────────────────────────────────────────
  ok("POST <2 members → 400", (await api("POST", "/households", tokenA, { memberIds: ["d_alice"] })).status === 400);
  ok("POST member already in household → 400", (await api("POST", "/households", tokenA, { memberIds: ["d_bob", "d_carol"] })).status === 400);
  ok("POST foreign donor → 404", (await api("POST", "/households", tokenA, { memberIds: ["d_alice", "d_bx"] })).status === 404);

  // ── checkWriteAccess (read_only org) ──────────────────────────────────────
  await seedDonor(RO, "d_ro1", "RO One", 10); await seedDonor(RO, "d_ro2", "RO Two", 20);
  ok("read_only POST /households → 402", (await api("POST", "/households", tokenRO, { memberIds: ["d_ro1", "d_ro2"] })).status === 402);
  ok("read_only GET /households → 200 (reads never gated)", (await api("GET", "/households", tokenRO)).status === 200);

  // ── Org isolation ─────────────────────────────────────────────────────────
  ok("org B GET /households/:id (A's) → 404", (await api("GET", `/households/${hhId}`, tokenB)).status === 404);
  ok("org B PUT (A's household) → 404", (await api("PUT", `/households/${hhId}`, tokenB, { name: "hijack" })).status === 404);
  ok("org B DELETE (A's household) → 404", (await api("DELETE", `/households/${hhId}`, tokenB)).status === 404);
  ok("org B soft-credit on A's donor → 404", (await api("GET", "/donors/d_bob/soft-credit", tokenB)).status === 404);
  // foreign-member IDOR: B tries to build a household including A's donor
  await seedDonor(B, "d_bx2", "Zed Two", 5);
  ok("org B POST with A's donor as member → 404 (no cross-tenant household)", (await api("POST", "/households", tokenB, { memberIds: ["d_bx", "d_alice"] })).status === 404);

  // ── DELETE unlinks, no cascade into donor/gift data ───────────────────────
  const giftsBeforeDelete = await dbSum(giftSumSql, A);
  const del = await api("DELETE", `/households/${hhId}`, tokenA);
  ok("DELETE /households/:id → 200 (ungated)", del.status === 200);
  ok("household row gone", (await q("SELECT COUNT(*)::int AS n FROM households WHERE id=$1", [hhId]))[0].n === 0);
  ok("members survive, unlinked", (await q("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL", [A]))[0].n === 3);
  ok("no gift touched by household delete", await dbSum(giftSumSql, A) === giftsBeforeDelete);
  ok("all donors household_id NULL after delete", (await q("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND household_id IS NOT NULL", [A]))[0].n === 0);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
