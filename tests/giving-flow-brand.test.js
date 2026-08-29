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
const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, SINK_PORT } = require("./helpers");

const STEWARD_EMERALD = /#0d5c3a|#10b981/i;
const DEFAULT_PRIMARY = "#1a6b4a"; // the neutral portal default — an org's own color must override it

// BUILD-64 — the artifact MEDIA a donor keeps. The brand assertion must run
// against the rendered output of EACH, not the page alone. An unasserted
// medium fails the structural self-check at the end of the run (same shape as
// the script-classification / asset-destruction total-classification suites).
const ARTIFACT_MEDIA = ["page", "email", "pdf"];
const ASSERTED = new Set();

// A capturing Resend sink on :5602 (the scratch server's RESEND_BASE_URL). The
// server POSTs every outbound email here as {from,to,subject,html}. We scan the
// REAL rendered bytes — the whole point of BUILD-64: assert the artifact, not
// a hand-built copy of it.
const captured = [];
const mailSink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails" && b) captured.push(JSON.parse(b)); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "sunk_" + Math.random().toString(36).slice(2) }));
  });
});

// Two themed orgs — the "for each demo org" shape. One terracotta with a custom
// monthly ladder, one blue with the default ladders. Neither carries any
// Steward brand token.
const ORG_A = "org_gfb_a", SLUG_A = "giveflow-terracotta";
const ORG_B = "org_gfb_b", SLUG_B = "giveflow-harbor";
const ADMIN_A = "gfb-a@test.local";
const ADMIN_B = "gfb-b@test.local";
const GIFT = { [ORG_A]: "g_gfb_a", [ORG_B]: "g_gfb_b" };

async function cleanupOrg(id) {
  // Born-with-a-chart orgs (BUILD-58) — clear ledger children before orgs.
  for (const t of ["receipts", "fin_transactions", "budgets", "accounts", "fin_funds", "gifts", "donors", "users", "portal_settings"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
}

// Tax-receipt identity so both orgs can issue a real receipt (email + PDF). The
// LEGAL name/EIN/address are the org's own; the BRAND surface (band color/logo)
// is what BUILD-64 pulls from the portal theme. network_listed=true so the
// giving-account CTA renders in the cover email — proving it's in the org's
// palette, never Steward emerald.
async function enableReceipts(orgId) {
  await q(`UPDATE orgs SET legal_name='Brushworks Collective, Inc.', ein='81-1234567',
             receipt_address='123 Kiln St, Portland, OR 97201', receipt_signature_name='Dana Ruiz',
             receipt_signature_title='Executive Director', receipts_enabled=true WHERE id=$1`, [orgId]);
  await q(`UPDATE portal_settings SET network_listed=true WHERE org_id=$1`, [orgId]);
}

// One donor + one gift so a gift receipt can be issued through the real route.
async function seedGift(orgId, donorId, giftId, email) {
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count) VALUES ($1,$2,'Sam Rivera',$3,120,1)`, [donorId, orgId, email]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method) VALUES ($1,$2,$3,120,'2026-08-14','Credit card')`, [giftId, orgId, donorId]);
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
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_gfb_b',$1,$2,$3,'B Admin','admin')`, [ORG_B, ADMIN_B, hash]);

  for (const id of [ORG_A, ORG_B]) await enableReceipts(id);
  await seedGift(ORG_A, "d_gfb_a", "g_gfb_a", "sam.a@test.local");
  await seedGift(ORG_B, "d_gfb_b", "g_gfb_b", "sam.b@test.local");
}

async function login(email) {
  const r = await api("POST", "/auth/login", null, { email, password: "loadtest1234" });
  return r.body.token;
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function run() {
  await fixture();
  await new Promise(r => { mailSink.on("error", () => r()); mailSink.listen(SINK_PORT, r); });

  // ── (1) NO STEWARD BRAND — for each org ──────────────────────────────────
  ASSERTED.add("page");
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

  // ── (4) BUILD-61 Part 1 — the unthemed default is DESIGNED, never empty ───
  ok("no-banner default renders a SOLID identity band in the org's color", /height: 156,[^]{0,140}background: th\.primary/.test(src));
  ok("the default band carries an intentional serif monogram (not an empty box)", /border: `2px solid \$\{th\.primaryFg\}[^]{0,220}fontFamily: th\.serif[^]{0,140}\{monogram\}/.test(src));
  ok("no placeholder-image source in the giving-page header", !/placeholder\.com|via\.placeholder|picsum|dummyimage|#cccccc"|#dddddd"|#e0e0e0"/i.test(src));

  // ── (5) BUILD-64 — THE ARTIFACT, NOT THE PAGE ─────────────────────────────
  // The give page proved the org's identity above. The receipt EMAIL and the
  // receipt PDF are artifacts the donor KEEPS — filed for taxes, forwarded to
  // an accountant — and until BUILD-64 they read a SECOND theme copy
  // (orgs.brand_accent) that fell back to Steward green. Now they resolve from
  // the SAME theme as the page. We drive the REAL issue route and scan the REAL
  // rendered bytes the sink captured — for EACH org.
  for (const [orgId, slug, wl, adminEmail] of [[ORG_A, SLUG_A, "Brushworks Collective", ADMIN_A], [ORG_B, SLUG_B, "Harbor Music School", ADMIN_B]]) {
    const theme = (await api("GET", `/org/${slug}/public`, null)).body?.org?.theme || {};
    const bandColor = String(theme.primary || "").toLowerCase(); // the org's OWN resolved primary
    const tok = await login(adminEmail);
    captured.length = 0;
    const r = await api("POST", `/gifts/${GIFT[orgId]}/receipt`, tok);
    ok(`[${slug}] gift receipt issued (201)`, r.status === 201, r.status);

    // ── EMAIL artifact — the real cover-email bytes ──
    ASSERTED.add("email");
    const mail = captured.find(e => (e.to || "").includes("sam."));
    ok(`[${slug}] receipt cover email was sent`, !!mail, captured.map(c => c.to));
    const html = String(mail?.html || "");
    ok(`[${slug}] email header band is the org's OWN color (shared resolver)`, html.includes(`background:${bandColor}`), bandColor);
    ok(`[${slug}] no Steward emerald anywhere in the receipt email`, !STEWARD_EMERALD.test(html), html.match(/#0d5c3a|#10b981/i)?.[0]);
    ok(`[${slug}] email header is NOT the neutral #1a6b4a default (org has a theme)`, !html.includes(`background:${DEFAULT_PRIMARY}`));
    // No VISIBLE "Steward" brand text. The one allowed occurrence is the
    // canonical app DOMAIN inside the giving-account CTA href (stewardapp.dev) —
    // the account genuinely lives there and the CTA is a decided keep — so we
    // strip the domain before scanning for the wordmark/name as displayed text.
    const visible = html.replace(/stewardapp\.dev/gi, "");
    ok(`[${slug}] no visible "Steward" wordmark/name in the receipt email`, !/steward/i.test(visible), visible.match(/.{0,20}steward.{0,20}/i)?.[0]);
    ok(`[${slug}] the staff-side "(Demo)" name never leaks into the email`, !/\(Demo\)/.test(html));
    // Sender identity (BUILD-64 Part 2): the org's name in the inbox.
    ok(`[${slug}] From carries the org display name, not a bare domain`, mail?.from === `${wl} <noreply@stewardapp.dev>`, mail?.from);
    // The giving-account CTA stays, but in the ORG's palette (never emerald).
    ok(`[${slug}] account CTA link is the org's palette, not Steward emerald`,
      !/create your free giving account<\/a>/.test(html) || html.includes(`color:${bandColor}`));

    // ── PDF artifact — the frozen brand snapshot the PDF is drawn from ──
    ASSERTED.add("pdf");
    const [rc] = await q(`SELECT snapshot, pdf_data FROM receipts WHERE org_id=$1 AND type='gift' AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId]);
    const snap = typeof rc?.snapshot === "string" ? JSON.parse(rc.snapshot) : (rc?.snapshot || {});
    ok(`[${slug}] receipt PDF band = the org's OWN resolved primary (not Steward green)`, String(snap.orgAccent || "").toLowerCase() === bandColor, snap.orgAccent);
    ok(`[${slug}] receipt PDF band is NOT the neutral #1a6b4a default`, String(snap.orgAccent || "").toLowerCase() !== DEFAULT_PRIMARY);
    ok(`[${slug}] receipt PDF band is NOT Steward emerald`, !STEWARD_EMERALD.test(String(snap.orgAccent || "")));
    const pdfBuf = Buffer.from(rc?.pdf_data || "", "base64");
    ok(`[${slug}] receipt PDF actually rendered (starts with %PDF)`, pdfBuf.slice(0, 4).toString() === "%PDF", pdfBuf.slice(0, 8).toString());
  }

  // ── (6) THE UNASSERTED-ARTIFACT-TYPE-FAILS SELF-CHECK ─────────────────────
  // The class fix, encoded: the brand assertion enumerates artifact MEDIA and
  // must run against each. A new donor-facing medium with no assertion here
  // fails the suite — the same total-classification shape as script-guards and
  // asset-retention. Remove a leg (or add a medium to ARTIFACT_MEDIA without
  // asserting it) and this fails.
  for (const m of ARTIFACT_MEDIA)
    ok(`brand assertion covers the "${m}" artifact medium`, ASSERTED.has(m));
  ok("no artifact medium was asserted that isn't enumerated", [...ASSERTED].every(m => ARTIFACT_MEDIA.includes(m)), [...ASSERTED]);

  await new Promise(r => mailSink.close(r));
  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
