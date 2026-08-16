// FIX — magical one-file import (server side): a transaction/gift-ledger file
// becomes donors + their individual gift history in one pass, smart-staged;
// large imports don't hang (batched recalc, one set-based query); re-running is
// idempotent (email dedup). Local scratch server + Postgres (tests/README.md).
//
// The client groups a raw gift ledger into { donors, gifts:[{donorIndex}] } via
// lib/importShape.groupTransactions, then POSTs /donors/import-combined. This
// suite exercises that exact server contract + the batch-recalc hang fix.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_ic_a", B = "org_ic_b";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["moves", "opportunities", "interactions", "gifts", "fin_transactions", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `IC ${tag}`, `ic-${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    ["u_" + o, o, `${tag}@ic.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`]);
}
const donorRow = async (o, email) => (await q(`SELECT * FROM donors WHERE org_id=$1 AND email=$2`, [o, email]))[0];
const countDonors = async o => (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [o]))[0].n;
const countGifts  = async o => (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [o]))[0].n;

(async () => {
  await reset();
  await seedOrg(A, "a-admin");
  await seedOrg(B, "b-admin");
  const tA = await login("a-admin@ic.local");
  const tB = await login("b-admin@ic.local");

  const { groupTransactions } = await import("../client/src/lib/importShape.js");

  // ── 1. A transaction ledger → donors + individual gift history ───────────
  // 3 donors, 6 gift rows (Jane×3, Bob×2, Carol×1). Client-side grouping.
  const ledger = [
    { key: "jane@ic.local", donor: { name: "Jane Ledger", email: "jane@ic.local", stage: "prospect" }, gift: { amount: 100, date: daysAgo(300) } },
    { key: "jane@ic.local", donor: { name: "Jane Ledger", email: "jane@ic.local", stage: "prospect" }, gift: { amount: 250, date: daysAgo(200) } },
    { key: "jane@ic.local", donor: { name: "Jane Ledger", email: "jane@ic.local", stage: "prospect" }, gift: { amount: 400, date: daysAgo(20) } },   // most recent → last_gift_amount 400
    { key: "bob@ic.local",  donor: { name: "Bob Ledger",  email: "bob@ic.local",  stage: "prospect" }, gift: { amount: 3000, date: daysAgo(400) } },  // >365d → lapsed
    { key: "bob@ic.local",  donor: { name: "Bob Ledger",  email: "bob@ic.local",  stage: "prospect" }, gift: { amount: 500, date: daysAgo(390) } },
    { key: "carol@ic.local",donor: { name: "Carol Ledger",email: "carol@ic.local",stage: "prospect" }, gift: { amount: 1500, date: daysAgo(120) } },  // $1500 @120d → solicit
  ];
  const { donors, gifts } = groupTransactions(ledger);
  ok("client grouping: 6 rows → 3 donors", donors.length === 3, donors.map(d => d.name));
  ok("client grouping: 6 gifts kept", gifts.length === 6, gifts.length);

  const imp = await api("POST", "/donors/import-combined", tA, { donors, gifts });
  ok("combined import 200", imp.status === 200, imp.body);
  ok("created 3 donors", imp.body.created === 3, imp.body);
  ok("attached 6 gifts", imp.body.giftsInserted === 6, imp.body);

  const jane = await donorRow(A, "jane@ic.local");
  ok("Jane total = sum of her 3 gifts (750)", Number(jane.total_giving) === 750, jane.total_giving);
  ok("Jane gift_count = 3", Number(jane.gift_count) === 3, jane.gift_count);
  ok("Jane last_gift_amount = most-recent (400)", Number(jane.last_gift_amount) === 400, jane.last_gift_amount);
  ok("Jane last_gift_date = most-recent", iso(jane.last_gift_date) === daysAgo(20), jane.last_gift_date);
  ok("Jane recent gift → steward", jane.stage === "steward", jane.stage);

  const bob = await donorRow(A, "bob@ic.local");
  ok("Bob total = 3500", Number(bob.total_giving) === 3500, bob.total_giving);
  ok("Bob >365d → lapsed", bob.stage === "lapsed", bob.stage);

  const carol = await donorRow(A, "carol@ic.local");
  ok("Carol $1500 @120d → solicit", carol.stage === "solicit", carol.stage);

  // ── 2. Idempotent re-run — same file again adds no donors, no gift dupes ──
  const rerun = await api("POST", "/donors/import-combined", tA, { donors, gifts });
  ok("re-run 200", rerun.status === 200, rerun.body);
  ok("re-run creates 0 donors", rerun.body.created === 0, rerun.body);
  ok("re-run reports 3 duplicates", rerun.body.duplicates === 3, rerun.body);
  ok("re-run attaches 0 new gifts", rerun.body.giftsInserted === 0, rerun.body);
  ok("still exactly 3 donors after re-run", (await countDonors(A)) === 3, await countDonors(A));
  ok("still exactly 6 gifts after re-run", (await countGifts(A)) === 6, await countGifts(A));

  // ── 3. Org isolation — same email in org B is independent; A untouched ────
  const impB = await api("POST", "/donors/import-combined", tB, {
    donors: [{ name: "Jane In B", email: "jane@ic.local", stage: "prospect" }],
    gifts: [{ donorIndex: 0, amount: 99, date: daysAgo(10) }],
  });
  ok("org B import 200", impB.status === 200, impB.body);
  ok("org B created its own Jane (email dedup is org-scoped)", impB.body.created === 1, impB.body);
  ok("org A still has exactly 3 donors", (await countDonors(A)) === 3, await countDonors(A));
  ok("org B has exactly 1 donor", (await countDonors(B)) === 1, await countDonors(B));
  const janeA = await donorRow(A, "jane@ic.local");
  ok("org A Jane's total unchanged by org B import", Number(janeA.total_giving) === 750, janeA.total_giving);

  // ── 4. Large import doesn't hang — 1,500 donors + 1,500 gifts, batched ────
  const bigDonors = [], bigGifts = [];
  for (let i = 0; i < 1500; i++) {
    bigDonors.push({ name: `Big Donor ${i}`, email: `big${i}@ic.local`, stage: "prospect" });
    bigGifts.push({ donorIndex: i, amount: 100 + i, date: daysAgo(30) });
  }
  const t0 = Date.now();
  const big = await api("POST", "/donors/import-combined", tA, { donors: bigDonors, gifts: bigGifts });
  const bigMs = Date.now() - t0;
  ok("1,500-donor import 200", big.status === 200, big.body);
  ok("1,500 donors created", big.body.created === 1500, big.body);
  ok("1,500 gifts attached", big.body.giftsInserted === 1500, big.body);
  ok("1,500-donor import finishes fast (< 10s — no N+1 recalc hang)", bigMs < 10000, bigMs + "ms");
  const sample = await donorRow(A, "big750@ic.local");
  ok("sampled big donor recalced (total 850)", Number(sample.total_giving) === 850, sample.total_giving);
  ok("sampled big donor recent gift → steward", sample.stage === "steward", sample.stage);
  // BUILD-57 §2b — import-minted ids carry FULL uuid entropy (32 hex). The old
  // 8-hex ids birthday-collided at multi-tenant scale and ONE collision
  // aborted a whole 500-row batch (BUILD-54 finding, hit live in a pre-push).
  ok("bulk-import donor ids are full-width (d_ + 32 hex — the batch-abort collision class is closed)",
    /^d_[0-9a-f]{32}$/.test(sample.id), sample.id);
  const [sampleGift] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 LIMIT 1`, [A, sample.id]);
  ok("bulk-import gift ids are full-width too", /^g_[0-9a-f]{32}$/.test(sampleGift?.id || ""), sampleGift);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
