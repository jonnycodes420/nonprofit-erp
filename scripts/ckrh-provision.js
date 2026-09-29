#!/usr/bin/env node
// scripts/ckrh-provision.js — CKRH-1. PROVISION ONE REAL ORGANISATION.
//
// Central Kentucky Riding for Hope (Lexington, KY), Steward's first customer.
//
// THIS IS NOT A SEED SCRIPT AND IT MUST NEVER BECOME ONE. It writes no donors,
// no gifts, no tasks and no sample anything: a real organisation's account is
// empty until her own file is imported, because the first wrong number she ever
// sees is the one she will not trust the product about again. The only rows it
// creates are the org, her login, three funds she actually has, and her own
// brand — every one of them a fact about CKRH rather than an illustration.
//
// It goes through `/auth/register-org` with `provisioned: true`, which is the
// path Allie's org came through (BUILD-95 §7): mail OFF, no founder drip, and
// the first-run greeting armed. Turning mail on afterwards is a separate,
// deliberate act (`POST /admin/orgs/:id/email-switch`) and this script will not
// do it for you.
//
// IDEMPOTENT. Re-running finds the existing org by the admin's email and
// updates it in place rather than making a second one.
//
// IT WRITES, SO IT IS GUARDED LIKE EVERY OTHER WRITER (prodGuard, BUILD-55):
// loopback by default, and prod needs BOTH an explicit BASE= and the confirm
// flag. Creating a real customer's account is exactly the kind of write a
// typo'd BASE must not be able to perform.
//
//   BASE=https://nonprofit-erp-production.up.railway.app \
//   SUPER_EMAIL=… SUPER_PASSWORD=… \
//   node scripts/ckrh-provision.js --i-know-this-is-prod
//
// SUPER_EMAIL/SUPER_PASSWORD are needed ONLY for the plan grant (Sapling +
// founding partner). Without them everything else still runs and the script
// prints the one command left to run.

const fs = require("fs");
const path = require("path");
const { writerBase } = require("./lib/prodGuard");

const DRY = process.argv.includes("--dry-run");
const API = DRY ? "http://localhost:5601" : writerBase("http://localhost:5601");

// ── WHO THEY ARE. Every value below is from ckrh.org or from Jonathan, and
//    nothing here is inferred, rounded or improved upon.
const ORG_NAME = "Central Kentucky Riding for Hope";
const TIMEZONE = "America/New_York";
const WEBSITE  = "https://ckrh.org";
const MISSION  =
  "Central Kentucky Riding for Hope is dedicated to enriching the community by improving " +
  "the quality of life and the health of children and adults with special physical, cognitive, " +
  "emotional and social needs through therapeutic activities with the horse.";

const OWNER_NAME  = "Sarah Fishback";
const OWNER_EMAIL = "develop@ckrh.org";

// Their own blue, read out of their own logo file (#215AA8 fills the CKRH
// wordmark; #04955F fills the line under it). Not sampled by eye and not
// generated — the server normalises it for contrast on save and says so.
const BRAND_ACCENT = "#215AA8";
const LOGO_SRC = path.join(__dirname, "..", "client", "src", "assets", "orgs", "ckrh-logo.svg");

// The greeting, in CKRH's words rather than Steward's.
const WELCOME_LINE = "Let's keep every friend of the barn close.";
const WELCOME_NEXT = "Send Jonathan your Salesforce export and he'll bring everyone over.";

// THE THREE FUNDS THEY ACTUALLY HAVE. Horse Care's description carries their
// own monthly ask, in their own words, off their donate page — a suggested
// amount invented here would be a number on her screen that nobody at CKRH
// ever chose.
const FUNDS = [
  { name: "Horse Care", restricted: true,
    description: "Monthly giving for the herd. $180 covers one month of care for a therapy horse — the monthly ask on ckrh.org." },
  { name: "Scott Mead Riding Scholarship & Memorial Fund", restricted: true,
    description: "Scholarships for riders who could not otherwise ride, in memory of Scott Mead." },
  { name: "General Operating", restricted: false,
    description: "Unrestricted support — wherever it is needed most." },
];

const PLAN = "t5000";          // Sapling. pricing.json is the one price list.
const FOUNDING_PARTNER = true; // $50 off, as a coupon that follows them across bands.

// ── a one-time password she will be asked to change, generated here so it is
//    never a pattern anybody could guess from the org name.
function newPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = require("crypto").randomBytes(20);
  return Array.from(buf, b => abc[b % abc.length]).join("");
}

async function api(method, route, token, body) {
  const res = await fetch(API + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null;
  try { json = await res.json(); } catch { /* a 204 or an HTML error page */ }
  return { status: res.status, body: json };
}

function logoDataUri() {
  if (!fs.existsSync(LOGO_SRC)) throw new Error(`logo not found at ${LOGO_SRC}`);
  const svg = fs.readFileSync(LOGO_SRC);
  return "data:image/svg+xml;base64," + svg.toString("base64");
}

(async () => {
  console.log(`\nCKRH provisioning → ${API}${DRY ? "  (DRY RUN)" : ""}\n`);
  const password = process.env.OWNER_PASSWORD || newPassword();

  if (DRY) {
    console.log(JSON.stringify({ ORG_NAME, OWNER_NAME, OWNER_EMAIL, TIMEZONE, WEBSITE,
      BRAND_ACCENT, PLAN, FOUNDING_PARTNER, WELCOME_LINE, WELCOME_NEXT,
      funds: FUNDS.map(f => f.name), logoBytes: logoDataUri().length }, null, 2));
    return;
  }

  // 1 · THE ORG AND HER LOGIN. `provisioned: true` is the whole difference
  //     between a signup and a handover: mail off, no drip, greeting armed.
  let token, orgId, userId, trialEndsAt, created = false;
  let reg = await api("POST", "/auth/register-org", null, {
    orgName: ORG_NAME, userName: OWNER_NAME, email: OWNER_EMAIL, password,
    provisioned: true,
    // Provisioned, but NOT a demonstration org: this account holds no invented
    // data at all, so it must not carry the banner that says it does.
    demoData: false,
  });
  if (reg.status === 201) {
    created = true;
    ({ token } = reg.body);
    orgId = reg.body.org.id; userId = reg.body.user.id; trialEndsAt = reg.body.org.trial_ends_at;
    console.log(`  ✓ org created         ${orgId}`);
    console.log(`  ✓ admin created       ${userId}  ${OWNER_EMAIL}`);
    // A CREDENTIAL IS PRINTED THE INSTANT IT EXISTS, NEVER AT THE END.
    // The first prod run of this script proved why: the password was printed
    // in the closing summary, the plan grant threw on a bad super-admin
    // login, and the ONLY copy of a real customer's password died with the
    // process — leaving an account on production that nobody could sign in
    // to. Everything after this line is recoverable by re-running; this is
    // the one value that is not.
    console.log("");
    console.log("  ┌─ HER SIGN-IN — COPY THIS NOW, IT IS NOT SHOWN AGAIN ─────────");
    console.log(`  │  ${OWNER_EMAIL}`);
    console.log(`  │  ${password}`);
    console.log("  └──────────────────────────────────────────────────────────────");
    console.log("");
  } else if (reg.status === 409) {
    // Already provisioned — sign in and update in place. Re-running this
    // script must never produce a second Central Kentucky Riding for Hope.
    if (!process.env.OWNER_PASSWORD)
      throw new Error("org already exists — re-run with OWNER_PASSWORD=<her password> to update it in place");
    const login = await api("POST", "/auth/login", null, { email: OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
    if (login.status !== 200) throw new Error(`org exists and OWNER_PASSWORD did not sign in: ${JSON.stringify(login.body)}`);
    token = login.body.token; orgId = login.body.org.id; userId = login.body.user.id;
    trialEndsAt = login.body.org.trial_ends_at;
    console.log(`  · org already exists  ${orgId} — updating in place`);
  } else {
    throw new Error(`register-org ${reg.status}: ${JSON.stringify(reg.body)}`);
  }

  // ONCE THE ACCOUNT EXISTS, NOTHING BELOW MAY ABORT THE RUN. Every step
  // after this point is idempotent and re-runnable, so a failure is worth
  // REPORTING and finishing around — aborting only costs the operator the
  // summary, and the summary is where the recovery instructions are.
  const problems = [];
  const step = async (label, fn) => {
    try { const out = await fn(); console.log(`  ✓ ${label.padEnd(20)} ${out || ""}`); }
    catch (e) { problems.push(`${label}: ${e.message}`); console.log(`  ✗ ${label.padEnd(20)} ${e.message}`); }
  };

  // 2 · THEIR BRAND. Their real logo file and the blue out of it.
  await step("logo + accent", async () => {
    const brand = await api("PUT", "/orgs/branding", token, {
      logoData: logoDataUri(), brandAccent: BRAND_ACCENT,
    });
    if (brand.status !== 200) throw new Error(`${brand.status}: ${JSON.stringify(brand.body)}`);
    return brand.body.brand_accent + (brand.body.adjusted ? `  (darkened from ${BRAND_ACCENT} for contrast)` : "");
  });

  // 3 · THE ORG'S OWN RECORD, including the two lines the greeting reads.
  await step("org record", async () => {
    const patch = await api("PATCH", `/orgs/${orgId}`, token, {
      mission: MISSION, website: WEBSITE, timezone: TIMEZONE,
      welcomeLine: WELCOME_LINE, welcomeNextStep: WELCOME_NEXT,
    });
    if (patch.status !== 200) throw new Error(`${patch.status}: ${JSON.stringify(patch.body)}`);
    return "mission, website, timezone, greeting";
  });

  // 4 · THE THREE FUNDS. Created only if absent, by name.
  const existing = await api("GET", "/finance/funds", token);
  const have = new Set((Array.isArray(existing.body) ? existing.body : (existing.body?.funds || []))
    .map(f => String(f.name).trim().toLowerCase()));
  for (const f of FUNDS) {
    if (have.has(f.name.trim().toLowerCase())) { console.log(`  · fund exists         ${f.name}`); continue; }
    await step("fund", async () => {
      const r = await api("POST", "/finance/funds", token, f);
      if (r.status >= 300) throw new Error(`"${f.name}" ${r.status}: ${JSON.stringify(r.body)}`);
      return f.name;
    });
  }

  // 5 · THE PLAN. Super-admin only, and the one step that needs Jonathan.
  //     No card, no Stripe subscription: this is a manual grant, so nothing
  //     can charge automatically and no billing reminder is ever sent (the
  //     reminder requires a real stripe_subscription_id — BUILD-90).
  const superEmail = process.env.SUPER_EMAIL, superPassword = process.env.SUPER_PASSWORD;
  if (superEmail && superPassword) {
    await step("plan", async () => {
      const su = await api("POST", "/auth/login", null, { email: superEmail, password: superPassword });
      if (su.status !== 200) throw new Error(`super-admin login ${su.status}: ${JSON.stringify(su.body)} — re-run just this step, the org is already correct`);
      const plan = await api("POST", `/admin/orgs/${orgId}/change-plan`, su.body.token, {
        plan: PLAN, foundingPartner: FOUNDING_PARTNER,
      });
      if (plan.status !== 200) throw new Error(`change-plan ${plan.status}: ${JSON.stringify(plan.body)}`);
      return `${plan.body.plan} (founding partner: ${plan.body.founding_partner}) · status ${plan.body.subscription_status}`;
    });
  } else {
    console.log(`  ! plan NOT SET        run with SUPER_EMAIL / SUPER_PASSWORD, or:`);
    console.log(`      POST /admin/orgs/${orgId}/change-plan  {"plan":"${PLAN}","foundingPartner":true}`);
  }

  console.log(`\n  org id        ${orgId}`);
  console.log(`  sign in at    https://www.stewardapp.dev/login`);
  console.log(`  email         ${OWNER_EMAIL}`);
  if (created) console.log(`  password      ${password}`);
  console.log(`  first charge  ${trialEndsAt}`);
  console.log(`\n  Mail is OFF for this org. Turn it on deliberately when her data is in:`);
  console.log(`      POST /admin/orgs/${orgId}/email-switch  {"emailsEnabled":true,"isDemoOrg":false}`);
  if (problems.length) {
    console.log(`\n  ${problems.length} STEP(S) DID NOT LAND — the org and her login are fine, re-run to finish:`);
    for (const p of problems) console.log(`    · ${p}`);
  }
  console.log("");
})().catch(e => { console.error("\nFAILED:", e.message, "\n"); process.exit(1); });
