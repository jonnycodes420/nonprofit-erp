// GTM-1b 1 — GROWING PAST YOUR BAND NEVER MOVES A PRICE ON ITS OWN.
//
// THE ONE TEST THIS BUILD ADDS, and it guards money. Steward now counts an
// org's active donors after every import and compares the count to the band
// they pay for. The whole value of that is the promise attached to it: the
// org is TOLD, thirty days ahead, and nothing about what they are charged
// changes until a person acts. A count that quietly bumped a plan would be
// the worst defect this product could ship — it would charge people more
// without asking, from a number they cannot see.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · `checkActiveDonorBand` writing orgs.plan            → §2 fails
//   · the notice date computed at less than 30 days       → §2 fails
//   · a second check restarting the clock                 → §3 fails
//   · the window widened or narrowed from 24 months       → §1 fails
//   · a legacy core/team/founding org being given a band  → §5 fails
//
//   §1  the count IS the sentence on the pricing page
//   §2  over the band: one notice, thirty days, and the price does not move
//   §3  checking again is the same notice, not a new one
//   §4  back inside the band withdraws the notice
//   §5  a legacy plan is never told it is over a band
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const PRICING = require("../pricing");

const ORG = "org_gtm1bband", LEGACY = "org_gtm1blegacy";
const ADMIN = "gtm1b-admin@t.local", LEG_ADMIN = "gtm1b-legacy@t.local";
const PW = "loadtest1234";

// The first band: up to 1,000. The fixture goes just over it with a handful of
// donors by shrinking the band is NOT possible (it is the real catalogue), so
// the org is put on a plan whose band we then exceed honestly — see seed().
const T1000 = PRICING.tierById("t1000");

async function reset() {
  for (const o of [ORG, LEGACY]) {
    for (const t of ["interactions", "gifts", "donors", "users"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

// `monthsAgo` in the org's own civil terms — a plain date string, which is
// what both the gifts and interactions tables hold.
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

async function addDonor(org, id, { giftMonthsAgo = null, talkMonthsAgo = null, deleted = false } = {}) {
  await q(`INSERT INTO donors (id,org_id,name,total_giving,deleted_at)
           VALUES ($1,$2,$3,0,$4)`,
    [id, org, "Person " + id, deleted ? new Date().toISOString() : null]);
  if (giftMonthsAgo !== null) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,25,$4,'system:test','test')`,
      ["g_" + id, org, id, monthsAgo(giftMonthsAgo)]);
  }
  if (talkMonthsAgo !== null) {
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
             VALUES ($1,$2,$3,'call','spoke',$4,'system:test')`,
      ["i_" + id, org, id, monthsAgo(talkMonthsAgo)]);
  }
}

async function seed() {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  // On the FIRST band, and paying: an active subscription is what makes a
  // band notice meaningful at all.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id)
           VALUES ($1,'Band Test','band-test',1,'active','t1000_monthly','sub_band_test')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_g1b_admin',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, hash]);
  // A legacy Core org — a real shape, and one that must never be given a band.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id)
           VALUES ($1,'Legacy Core','legacy-core',1,'active','core','sub_legacy')`, [LEGACY]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_g1b_leg',$1,$2,$3,'Admin','admin')`, [LEGACY, LEG_ADMIN, hash]);
}

const bandOf = async org => (await q(`SELECT plan, subscription_status, stripe_subscription_id,
    tier_notice_band, tier_notice_effective_at, tier_notice_count FROM orgs WHERE id=$1`, [org]))[0];

(async () => {
  await seed();
  const admin = await login(ADMIN);

  console.log("— §1 · the count IS the sentence on the pricing page —");
  ok("the sentence says 24 months", PRICING.ACTIVE_DONOR_MONTHS === 24
     && /last 24 months/.test(PRICING.ACTIVE_DONOR_SENTENCE), PRICING.ACTIVE_DONOR_SENTENCE);

  await addDonor(ORG, "d_gift_recent", { giftMonthsAgo: 2 });
  await addDonor(ORG, "d_gift_edge",   { giftMonthsAgo: 23 });
  await addDonor(ORG, "d_gift_old",    { giftMonthsAgo: 30 });
  await addDonor(ORG, "d_talk_recent", { talkMonthsAgo: 3 });
  await addDonor(ORG, "d_talk_old",    { talkMonthsAgo: 30 });
  await addDonor(ORG, "d_nothing",     {});
  await addDonor(ORG, "d_deleted",     { giftMonthsAgo: 1, deleted: true });
  // One donor, four gifts: a person, not four people.
  await addDonor(ORG, "d_many", { giftMonthsAgo: 1 });
  for (const n of [2, 3, 4]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,'d_many',10,$3,'system:test','test')`,
      ["g_many_" + n, ORG, monthsAgo(n)]);
  }

  let r = await api("GET", "/billing/donor-band?recount=1", admin);
  ok("the recount answers", r.status === 200, r.status);
  // recent gift + 23-month gift + recent conversation + the many-gift donor = 4
  ok("a gift inside the window counts, one outside it does not, a conversation counts, "
     + "a deleted donor does not, and four gifts are still one person",
     r.body.count === 4, `count=${r.body.count} (expected 4)`);
  ok("…and it is not over the first band", r.body.over === false, r.body);
  ok("…the definition travels with the number", /last 24 months/.test(r.body.sentence || ""), r.body.sentence);

  console.log("\n— §2 · over the band: one notice, thirty days, and the price does not move —");
  const before = await bandOf(ORG);
  // Over the top of the first band. Inserted directly rather than through the
  // import route: what is under test is the COUNT and the notice, and an
  // import of a thousand rows would be testing the importer.
  const rows = [];
  for (let i = 0; i < T1000.maxDonors + 5 - 4; i++) rows.push(i);
  for (const i of rows) {
    await q(`INSERT INTO donors (id,org_id,name,total_giving) VALUES ($1,$2,$3,0)`,
      ["d_bulk_" + i, ORG, "Bulk " + i]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,5,$4,'system:test','test')`,
      ["g_bulk_" + i, ORG, "d_bulk_" + i, monthsAgo(1)]);
  }

  r = await api("GET", "/billing/donor-band?recount=1", admin);
  ok("now it is over the band", r.body.over === true && r.body.count === T1000.maxDonors + 5,
     `count=${r.body.count} over=${r.body.over}`);
  ok("…and it names the band they should be on", r.body.nextBand === "t5000", r.body.nextBand);

  const after = await bandOf(ORG);
  // THE LOAD-BEARING ASSERTION OF THIS WHOLE FILE.
  ok("§2 THE PLAN DID NOT MOVE", after.plan === before.plan && after.plan === "t1000_monthly",
     `${before.plan} → ${after.plan}`);
  ok("§2 …the subscription is untouched",
     after.stripe_subscription_id === before.stripe_subscription_id
     && after.subscription_status === before.subscription_status, after);
  ok("a notice was recorded, naming the band", after.tier_notice_band === "t5000", after.tier_notice_band);
  ok("…and the count it was raised on", Number(after.tier_notice_count) === T1000.maxDonors + 5, after.tier_notice_count);

  const days = (new Date(after.tier_notice_effective_at) - Date.now()) / 86400000;
  ok("§2 the new price cannot take effect for at least thirty days",
     days > 29.5 && days < 30.5, `${days.toFixed(2)} days out`);

  const shown = await api("GET", "/billing/donor-band", admin);
  ok("the product shows the notice without recounting",
     shown.body.notice && shown.body.notice.nextBand === "t5000"
     && shown.body.notice.nextMonthlyUsd === PRICING.tierById("t5000").monthlyUsd, shown.body.notice);

  console.log("\n— §3 · checking again is the SAME notice, not a new one —");
  const firstDate = after.tier_notice_effective_at;
  await api("GET", "/billing/donor-band?recount=1", admin);
  await api("GET", "/billing/donor-band?recount=1", admin);
  const third = await bandOf(ORG);
  ok("the thirty days did not restart",
     String(third.tier_notice_effective_at) === String(firstDate),
     `${firstDate} → ${third.tier_notice_effective_at}`);
  ok("…and the plan STILL did not move", third.plan === "t1000_monthly", third.plan);

  console.log("\n— §4 · back inside the band withdraws the notice —");
  await q(`DELETE FROM gifts WHERE org_id=$1 AND donor_id LIKE 'd_bulk_%'`, [ORG]);
  await q(`DELETE FROM donors WHERE org_id=$1 AND id LIKE 'd_bulk_%'`, [ORG]);
  r = await api("GET", "/billing/donor-band?recount=1", admin);
  ok("it is inside the band again", r.body.over === false && r.body.count === 4, r.body);
  const withdrawn = await bandOf(ORG);
  ok("…so the standing notice is withdrawn, not left saying something untrue",
     withdrawn.tier_notice_band === null && withdrawn.tier_notice_effective_at === null, withdrawn);

  console.log("\n— §5 · a legacy plan is never told it is over a band —");
  const legAdmin = await login(LEG_ADMIN);
  for (let i = 0; i < 12; i++) {
    await q(`INSERT INTO donors (id,org_id,name,total_giving) VALUES ($1,$2,$3,0)`,
      ["d_leg_" + i, LEGACY, "Legacy " + i]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,5,$4,'system:test','test')`,
      ["g_leg_" + i, LEGACY, "d_leg_" + i, monthsAgo(1)]);
  }
  r = await api("GET", "/billing/donor-band?recount=1", legAdmin);
  ok("a Core org is not measured against a band it never bought",
     r.body.checked === false && r.body.reason === "no_band_on_this_plan", r.body);
  const leg = await bandOf(LEGACY);
  ok("…and nothing was written to it",
     leg.plan === "core" && leg.tier_notice_band === null, leg);

  console.log("\n— §6 · the notice is the admin's to dismiss, and dismissing hides the banner only —");
  await q(`UPDATE orgs SET tier_notice_band='t5000', tier_notice_at=NOW(),
             tier_notice_effective_at=NOW() + INTERVAL '30 days', tier_notice_count=1200 WHERE id=$1`, [ORG]);
  const dis = await api("POST", "/billing/donor-band/dismiss", admin, {});
  ok("an admin can dismiss it", dis.status === 200, dis.status);
  const afterDismiss = await bandOf(ORG);
  ok("…and the notice itself SURVIVES — a price change cannot be un-told by closing a card",
     afterDismiss.tier_notice_band === "t5000" && afterDismiss.tier_notice_effective_at !== null,
     afterDismiss);
  const anon = await api("POST", "/billing/donor-band/dismiss", null, {});
  ok("signed out, nothing", anon.status === 401, anon.status);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
