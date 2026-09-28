// GTM-1a 4 — THE $1 PRICE IS NEVER PUBLIC.
//
// THE ONE TEST THIS BUILD ADDS, and it guards money: a price that charges one
// dollar instead of two hundred is the cheapest possible way to lose every
// subscription in the product, and the only thing standing between it and a
// customer is that nothing public can name it.
//
// WHAT WOULD MAKE THIS FAIL (the "a guard must be proven able to fail" rule —
// each of these was planted and watched go red before the green was trusted):
//   · adding `internal_test` to pricing.js TIERS            → §1 fails
//   · letting /public/pricing serve it                      → §1 fails
//   · accepting it in a /public/signup body                 → §2 fails
//   · accepting it in /billing/create-checkout              → §2 fails
//   · letting a close link sell it                          → §2 fails
//   · dropping requireSuperAdmin from the one control       → §3 fails
//
//   §1  it is not in anything a stranger can read
//   §2  every public door that takes a plan name refuses it
//   §3  the one door to it is super-admin only
//   §4  and it is still reachable by the person who is allowed to use it
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const PRICING = require("../pricing");
const { CLOSE_PLANS, SELLABLE_CLOSE_PLANS, validateCloseLink, validateOrgClose } = require("../closeLink");
const { readSource } = require("../scripts/lib/readSource");

const ORG = "org_gtm1adollar";
const SUPER = "gtm1a-super@t.local", ADMIN = "gtm1a-admin@t.local", STAFF = "gtm1a-staff@t.local";
const PW = "loadtest1234";
const ID = PRICING.INTERNAL_TEST.id;

async function reset() {
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function seed() {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Dollar Test HQ','dollar-test-hq',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_g1a_super',$1,$2,$3,'Jonathan','admin',true)`, [ORG, SUPER, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_g1a_admin',$1,$2,$3,'Admin','admin',false)`, [ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_g1a_staff',$1,$2,$3,'Staffer','staff',false)`, [ORG, STAFF, hash]);
}

(async () => {
  await seed();
  const supr = await login(SUPER);
  const admin = await login(ADMIN);
  const staff = await login(STAFF);

  console.log("— §1 · it is not in anything a stranger can read —");
  ok("it is not a public tier", !PRICING.publicTierIds().includes(ID), PRICING.publicTierIds());
  ok("…and TIERS itself does not contain it", !PRICING.TIERS.some(t => t.id === ID));
  ok("…so no donor count ever resolves to it",
     [0, 1, 999, 1000, 4999, 5000, 9999, 10000, 10001, 5000000]
       .every(n => (PRICING.tierForDonorCount(n) || {}).id !== ID));
  ok("its own record says it is not publicly offerable", PRICING.INTERNAL_TEST.publiclyOfferable === false);

  const pub = await api("GET", "/public/pricing", null);
  ok("GET /public/pricing answers", pub.status === 200, pub.status);
  ok("…and nothing in what it serves names the $1 price",
     !JSON.stringify(pub.body).includes(ID) && !JSON.stringify(pub.body.tiers).includes("\"monthlyUsd\":1,"),
     JSON.stringify(pub.body.tiers));
  ok("…and the bands it serves are exactly the three that are on sale",
     pub.body.tiers.map(t => t.id).join(",") === "t1000,t5000,t10000", pub.body.tiers.map(t => t.id));

  // The client bundles shared/pricing.js. A price that is only kept out of a
  // ROUTE is still shipped to every browser if it is in the catalogue the
  // page imports, so the page's own source is checked for the string too.
  ok("§1 the pricing page does not render it",
     !/internal_test/.test(readSource("client/src/pages/Pricing.jsx")));
  ok("§1 …and neither does the signup page",
     !/internal_test/.test(readSource("client/src/pages/SignupPage.jsx")));

  console.log("\n— §2 · every public door that takes a plan name refuses it —");
  const signup = await api("POST", "/public/signup", null, {
    orgName: "Dollar Grabber", contactName: "A Person", contactEmail: "dollar-grabber@example.org",
    estimatedDonors: 100, interval: "monthly", acceptTerms: true, termsVersion: "any",
    plan: ID, tier: ID,              // both spellings, in case a future body reads either
  });
  ok("a signup body naming the $1 price does not get it",
     signup.status !== 201 || !String(JSON.stringify(signup.body)).includes(ID),
     signup.status + " " + JSON.stringify(signup.body).slice(0, 200));

  const co = await api("POST", "/billing/create-checkout", admin, { plan: ID });
  ok("an org admin cannot check out onto it", co.status === 400 && /Invalid plan/i.test(co.body.error || ""), co.status + " " + JSON.stringify(co.body));
  const coSuper = await api("POST", "/billing/create-checkout", supr, { plan: ID });
  ok("…and neither can a SUPER-ADMIN through that route — it is not a plan you pick",
     coSuper.status === 400, coSuper.status + " " + JSON.stringify(coSuper.body));

  ok("a close link cannot sell it",
     validateCloseLink({ orgName: "X", contactEmail: "a@b.org", plan: ID }).error === "invalid_plan");
  ok("…nor a close against an org that already exists",
     validateOrgClose({ orgId: ORG, plan: ID }).error === "invalid_plan");
  ok("…and it is absent from the sellable catalogue while present in the full one",
     !SELLABLE_CLOSE_PLANS.some(p => p.id === ID) && CLOSE_PLANS.some(p => p.id === ID));

  console.log("\n— §3 · the one door to it is super-admin only —");
  const asStaff = await api("POST", `/admin/orgs/${ORG}/internal-test-price`, staff, {});
  ok("a staff member is refused", asStaff.status === 403, asStaff.status);
  const asAdmin = await api("POST", `/admin/orgs/${ORG}/internal-test-price`, admin, {});
  ok("an ORG ADMIN is refused — admin of an org is not super-admin", asAdmin.status === 403, asAdmin.status);
  const anon = await api("POST", `/admin/orgs/${ORG}/internal-test-price`, null, {});
  ok("signed out, nothing", anon.status === 401, anon.status);

  console.log("\n— §4 · and the person who is allowed to use it gets a real answer —");
  const asSuper = await api("POST", `/admin/orgs/${ORG}/internal-test-price`, supr, {});
  // The scratch stack has no STRIPE_PRICE_INTERNAL_TEST and the org has no
  // subscription, so the super-admin's own call must land on a NAMED refusal
  // rather than a 403 or a 500 — the difference between "you may not" and
  // "there is nothing configured yet" is the whole value of this control.
  ok("the super-admin is NOT refused for permission",
     asSuper.status !== 403 && asSuper.status !== 401, asSuper.status);
  ok("…the refusal is about configuration or the subscription, and it names which",
     ["internal_price_not_configured", "no_subscription", "stripe_not_configured"].includes(asSuper.body.error),
     asSuper.status + " " + JSON.stringify(asSuper.body));
  ok("…and nothing moved the org's plan",
     (await q(`SELECT plan FROM orgs WHERE id=$1`, [ORG]))[0].plan === "team");

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
