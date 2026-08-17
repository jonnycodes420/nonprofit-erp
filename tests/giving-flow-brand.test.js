// BUILD-60 — THE GIVING PAGE IS THE ORG'S PAGE (permanent battery).
//
// Two guarantees, both permanent and in the shape of the org-blindness check:
//
//   (1) NO STEWARD BRAND — for every org, the public /give flow carries the
//       org's OWN theme (colors, white-label display name, per-frequency amount
//       ladders) and NEVER Steward's emerald (#0d5c3a / #10b981) or the word
//       "Steward". "Powered by Steward" is OFF unless the org opts in. The
//       Donate.jsx source is scanned the same way (no hardcoded Steward hex, the
//       powered-by line gated behind the flag).
//
//   (2) RECURRING IS THE ASK — the frequency defaults to Monthly, the amount
//       ladder is per-frequency and org-configurable (defaults + a custom
//       ladder round-trip through PUT /portal-settings), and the full
//       recurring disclosure text lives on/beside the submit button.
//
// Standard scratch stack. DONOR_ACCOUNTS not required.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const STEWARD_EMERALD = /#0d5c3a|#10b981/i;
const DEFAULT_PRIMARY = "#1a6b4a"; // the neutral portal default — an org's own color must override it

// Two themed orgs — the "for each demo org" shape. One terracotta with a custom
// monthly ladder, one blue with the default ladders. Neither carries any
// Steward brand token.
const ORG_A = "org_gfb_a", SLUG_A = "giveflow-terracotta";
const ORG_B = "org_gfb_b", SLUG_B = "giveflow-harbor";
const ADMIN_A = "gfb-a@test.local";

async function cleanupOrg(id) {
  // Born-with-a-chart orgs (BUILD-58) — clear ledger children before orgs.
  for (const t of ["fin_transactions", "budgets", "accounts", "fin_funds", "gifts", "donors", "users", "portal_settings"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
}

async function fixture() {
  await cleanupOrg(ORG_A);
  await cleanupOrg(ORG_B);
  const hash = bcrypt.hashSync("loadtest1234", 10);

  // Staff-side name carries the "(Demo)" leak that must NEVER reach the donor —
  // the white-label display_name is what the give page shows (BUILD-58 W-2).
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,mission)
           VALUES ($1,'Brushworks Collective (Demo)',$2,1,'active','core','acct_gfb_a','Art belongs to everyone.')`, [ORG_A, SLUG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,mission)
           VALUES ($1,'Harbor Music School (Demo)',$2,1,'active','core','acct_gfb_b','Every child, an instrument.')`, [ORG_B, SLUG_B]);

  // Terracotta org: custom monthly ladder, editorial type, square cards, powered_by OFF.
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name,primary_color,accent_color,button_color,type_pairing,card_style,monthly_amounts,powered_by)
           VALUES ($1,true,'Brushworks Collective','#b8593f','#7a5230','#b8593f','editorial','square',$2,false)`,
    [ORG_A, JSON.stringify([5, 15, 30, 60, 120])]);
  // Blue org: default ladders, default powered_by (false).
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name,primary_color,accent_color)
           VALUES ($1,true,'Harbor Music School','#33538a','#7a5230')`, [ORG_B]);

  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_gfb_a',$1,$2,$3,'A Admin','admin')`, [ORG_A, ADMIN_A, hash]);
}

async function login(email) {
  const r = await api("POST", "/auth/login", null, { email, password: "loadtest1234" });
  return r.body.token;
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function run() {
  await fixture();

  // ── (1) NO STEWARD BRAND — for each org ──────────────────────────────────
  for (const [slug, wl, staffName] of [[SLUG_A, "Brushworks Collective", "Brushworks Collective (Demo)"], [SLUG_B, "Harbor Music School", "Harbor Music School (Demo)"]]) {
    const r = await api("GET", `/org/${slug}/public`, null);
    const theme = r.body?.org?.theme;
    ok(`[${slug}] give payload carries the org theme (white-label)`, r.status === 200 && !!theme, r.status);
    ok(`[${slug}] display name is white-label (no "(Demo)")`, theme?.displayName === wl && !/\(Demo\)/.test(theme?.displayName || ""));
    ok(`[${slug}] primary is the org's OWN color, not the neutral default`, typeof theme?.primary === "string" && theme.primary.toLowerCase() !== DEFAULT_PRIMARY);
    ok(`[${slug}] no Steward emerald in any theme value`, !STEWARD_EMERALD.test(JSON.stringify(theme || {})));
    const json = JSON.stringify(r.body);
    ok(`[${slug}] no Steward emerald anywhere in the give payload`, !STEWARD_EMERALD.test(json));
    ok(`[${slug}] the word "Steward" appears nowhere in the give payload`, !/steward/i.test(json), json.match(/.{0,20}steward.{0,20}/i)?.[0]);
    ok(`[${slug}] the staff-side "(Demo)" name never leaks`, !json.includes(staffName));
    ok(`[${slug}] poweredBy defaults OFF`, theme?.poweredBy === false);
  }

  // ── (2) RECURRING IS THE ASK — per-frequency, org-configurable ladders ────
  const a = (await api("GET", `/org/${SLUG_A}/public`, null)).body?.org?.theme || {};
  ok("terracotta org: custom monthly ladder flows through", eq(a.monthlyAmounts, [5, 15, 30, 60, 120]), a.monthlyAmounts);
  ok("terracotta org: one-time ladder falls back to the default", eq(a.onetimeAmounts, [25, 50, 100, 250, 500]), a.onetimeAmounts);
  const b = (await api("GET", `/org/${SLUG_B}/public`, null)).body?.org?.theme || {};
  ok("harbor org: default monthly ladder", eq(b.monthlyAmounts, [10, 25, 50, 100, 250]), b.monthlyAmounts);
  ok("harbor org: default one-time ladder", eq(b.onetimeAmounts, [25, 50, 100, 250, 500]), b.onetimeAmounts);

  // Org-configurable via the real admin API + validation.
  const tok = await login(ADMIN_A);
  ok("admin login ok", !!tok);
  const good = await api("PUT", "/portal-settings", tok, { monthlyAmounts: [3, 7, 11] });
  ok("PUT valid monthly ladder → 200", good.status === 200, good.status);
  const afterGood = (await api("GET", `/org/${SLUG_A}/public`, null)).body?.org?.theme || {};
  ok("configured monthly ladder round-trips to the give page", eq(afterGood.monthlyAmounts, [3, 7, 11]), afterGood.monthlyAmounts);
  const bad1 = await api("PUT", "/portal-settings", tok, { monthlyAmounts: [0, 5] });
  ok("PUT ladder with <3 tiers / zero → 400", bad1.status === 400 && bad1.body?.error === "bad_ladder", bad1.body);
  const bad2 = await api("PUT", "/portal-settings", tok, { onetimeAmounts: [1, 2, 3, 4, 5, 6, 7] });
  ok("PUT ladder with >6 tiers → 400", bad2.status === 400, bad2.body);
  const clear = await api("PUT", "/portal-settings", tok, { monthlyAmounts: "" });
  ok("PUT empty ladder clears back to default", clear.status === 200, clear.status);
  const afterClear = (await api("GET", `/org/${SLUG_A}/public`, null)).body?.org?.theme || {};
  ok("cleared monthly ladder falls back to default", eq(afterClear.monthlyAmounts, [10, 25, 50, 100, 250]), afterClear.monthlyAmounts);

  // ── (3) Donate.jsx source — the client-side contract ─────────────────────
  const src = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Donate.jsx"), "utf8");
  ok("frequency state defaults to Monthly", /useState\(["']monthly["']\)/.test(src), "frequency default");
  ok("no hardcoded Steward emerald in Donate.jsx", !STEWARD_EMERALD.test(src));
  ok('"Powered by Steward" is gated behind th.poweredBy', /th\.poweredBy\s*&&[^]{0,60}Powered by Steward/.test(src));
  ok("the giving page never renders a hardcoded Steward wordmark/logo", !/>\s*Steward\s*</.test(src));
  ok("submit button states the recurring commitment", /Give \$\{fmtAmt\(chargedAmount\)\} \$\{perLabel\}/.test(src));
  ok("recurring disclosure beside the button", /every month until you cancel/.test(src) && /Cancel anytime from your donor account/.test(src));
  ok("amount ladder is per-frequency", /monthlyAmounts/.test(src) && /onetimeAmounts/.test(src) && /activeLadder/.test(src));

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
