#!/usr/bin/env node
// BUILD-48 — DSF2 screenshots + DOM assertions for the ADAPTIVE ORG TAKEOVER,
// at 390 AND 1440: the three states (zero orgs → neutral shell · exactly one
// → full org takeover · two+ → neutral shell with per-org themed cards), BOTH
// transitions driven IN-PAGE (add via the directory → shell; unfollow → back
// to takeover — no reload), the seamless drill-down, and the Settings live
// preview. Self-seeding against the LOCAL scratch stack.
//
// Brand assertions (the §4 deliverable):
//   • takeover shows NO Steward brand beyond the one quiet wordmark line;
//   • the multi-org shell carries no org theme token outside that org's own
//     sections (checked by computed border color containment);
//   • the trust sentence renders in every state.
//
// Local stack recipe (the BUILD-45/46/47 capture conventions):
//   client built with VITE_API_URL=http://localhost:5601
//     VITE_PORTAL_API=http://localhost:5601/portal
//     VITE_ACCOUNT_API=http://localhost:5601/account
//     VITE_NETWORK_API=http://localhost:5601/network
//   `npx vite preview --port 4173` + server booted with
//   CORS_ORIGIN=http://localhost:4173 and both BUILD-46 flags on.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build48-capture.js
const fs = require("fs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const { chromium } = require(process.env.PLAYWRIGHT_DIR + "/node_modules/playwright");

const API = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const APP = process.env.APP || "http://localhost:4173";
const OUT = process.env.OUT || (__dirname + "/../docs/build48-takeover");
const DB = process.env.DATABASE_URL || "postgres://steward:steward@localhost:5544/steward_loadtest";
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error("refusing a non-scratch DATABASE_URL"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, d ?? ""); } };

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed, headers: r.headers };
};
const cookieOf = (r) => decodeURIComponent(((r.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/) || [])[1] || "");
const svgBand = (bg, fg) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="${bg}"/>` +
  `<circle cx="220" cy="150" r="90" fill="${fg}" opacity="0.35"/><circle cx="520" cy="90" r="55" fill="${fg}" opacity="0.25"/>` +
  `<circle cx="880" cy="200" r="120" fill="${fg}" opacity="0.3"/><circle cx="1120" cy="70" r="40" fill="${fg}" opacity="0.2"/></svg>`
).toString("base64");
const svgLogo = (bg, letter) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="${bg}"/>` +
  `<text x="48" y="64" font-family="Georgia,serif" font-size="52" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`
).toString("base64");
const hexToRgbStr = (hex) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

const CREO_SLUG = "creo-arts-creo";
const PANTRY = "org_b48p", PANTRY_SLUG = "b48-pantry";
const CAP = "b48.capture@b48.test", ZERO = "b48.zero@b48.test";
const THIS_YEAR = String(new Date().getFullYear());

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const db = new Client({ connectionString: DB });
  await db.connect();

  // ── seed ──────────────────────────────────────────────────────────────────
  // CREO's portal theme goes through the REAL write route (exercising the
  // guards); the second org is a fresh listed pantry with its own theme.
  const creoLogin = await j("POST", "/auth/login", { email: "admin@creoarts.org", password: "demo1234" });
  ok("creo admin login (scratch demo seed)", !!creoLogin.body?.token);
  const creoTok = creoLogin.body.token;
  const creoTheme = await j("PUT", "/portal-settings", {
    enabled: true, networkListed: true, displayName: "CREO Arts",
    primaryColor: "#8a4a2c", accentColor: "#c9a84c", buttonColor: "#8a4a2c",
    backgroundTint: "#faf5ec", typePairing: "editorial", cardStyle: "soft-shadow",
    headerImageData: svgBand("#8a4a2c", "#e7cf91"), logoData: svgLogo("#8a4a2c", "C"),
    footerText: "CREO Arts — community art education on the Gulf Coast.",
    einLine: "Tax ID (EIN): 12-3456789", contactEmail: "hello@creoarts.org",
    directoryDescription: "Community art education", directoryCity: "Fairhope", directoryState: "AL",
  }, { Authorization: "Bearer " + creoTok });
  ok("creo theme saved through the guarded route", creoTheme.status === 200, creoTheme.body);
  const CREO_ACCENT = creoTheme.body.accent_color, CREO_PRIMARY = creoTheme.body.primary_color;
  const CREO_TINT = creoTheme.body.background_tint;

  await db.query(`DELETE FROM donor_org_follows WHERE org_id=$1`, [PANTRY]).catch(() => {});
  await db.query(`DELETE FROM portal_settings WHERE org_id=$1`, [PANTRY]);
  await db.query(`DELETE FROM donors WHERE org_id=$1`, [PANTRY]);
  await db.query(`DELETE FROM orgs WHERE id=$1`, [PANTRY]);
  await db.query(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Open Door Pantry','${PANTRY_SLUG}',1,'active','core')`, [PANTRY]);
  await db.query(
    `INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,primary_color,accent_color,type_pairing,card_style,header_image_data,logo_data,directory_description,directory_city,directory_state)
     VALUES ($1,true,true,'Open Door Pantry','#3f5c8a','#3f5c8a','classic','square',$2,$3,'Groceries and warm meals, no questions asked','Fairhope','AL')`,
    [PANTRY, svgBand("#3f5c8a", "#dfe8e2"), svgLogo("#3f5c8a", "O")]);

  // Donor accounts: CAP has a donor record in CREO ONLY (auto-links on read →
  // the single-org takeover); ZERO has none anywhere (the neutral shell).
  for (const [id, email] of [["da_b48cap", CAP], ["da_b48zero", ZERO]]) {
    await db.query(`DELETE FROM donor_org_follows WHERE account_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM donor_account_links WHERE account_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM donor_accounts WHERE email=$1 OR id=$2`, [email, id]);
    await db.query(`INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ($1,$2,$3,NOW())`,
      [id, email, bcrypt.hashSync("b48capture999", 10)]);
  }
  // Portal sign-ins mirror low-priority notes onto the donor timeline
  // (BUILD-45 drift wire) — clear them or the donor delete hits the FK.
  await db.query(`DELETE FROM interactions WHERE donor_id='d_b48cap'`);
  await db.query(`DELETE FROM gifts WHERE donor_id='d_b48cap'`);
  await db.query(`DELETE FROM donors WHERE id='d_b48cap'`);
  await db.query(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_b48cap','org_creo','Morgan Ellis',$1,850,2,'mid','steward')`, [CAP]);
  await db.query(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_b48c1','org_creo','d_b48cap',600,'${THIS_YEAR}-01-20','cash',''),('g_b48c2','org_creo','d_b48cap',250,'${THIS_YEAR}-04-14','cash','')`);

  const capLogin = await j("POST", "/account/login", { email: CAP, password: "b48capture999" });
  const zeroLogin = await j("POST", "/account/login", { email: ZERO, password: "b48capture999" });
  ok("both capture accounts log in", capLogin.status === 200 && zeroLogin.status === 200);
  const capCookie = cookieOf(capLogin), zeroCookie = cookieOf(zeroLogin);

  const browser = await chromium.launch();
  const newPage = async (cookie, vp) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    if (cookie) await ctx.addCookies([{ name: "steward_portal", value: cookie, url: APP }]);
    const page = await ctx.newPage();
    await page.goto(APP + "/giving", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    return { ctx, page };
  };
  const VPS = [["1440", { width: 1440, height: 950 }], ["390", { width: 390, height: 844 }]];
  const trustLine = "Each nonprofit sees only its own relationship";

  // ── STATE 0 — zero orgs: neutral Steward shell, directory is the hero ────
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(zeroCookie, vp);
    ok(`state0 neutral Steward header (${w})`, await page.locator('span:text-is("Your Giving")').count() === 1);
    ok(`state0 directory-led empty state (${w})`, await page.locator("text=Find the organizations you give to").count() > 0);
    ok(`state0 trust line renders (${w})`, await page.locator(`text=${trustLine}`).count() > 0);
    await page.screenshot({ path: `${OUT}/state0-neutral-${w}.png`, fullPage: true });
    await ctx.close();
  }

  // ── STATE 1 — exactly one org: FULL takeover ──────────────────────────────
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(capCookie, vp);
    ok(`takeover shows the org name (${w})`, await page.locator("text=CREO Arts").count() > 0);
    const stewardMentions = await page.evaluate(() => (document.body.innerText.match(/Steward/g) || []).length);
    ok(`takeover: ONE quiet Steward wordmark line and nothing else (${w})`,
      stewardMentions === 1 && await page.getByTestId("steward-quiet-line").count() === 1, stewardMentions);
    ok(`takeover: neutral "Your Giving" ink header is GONE (${w})`, await page.locator('span:text-is("Your Giving")').count() === 0);
    const stripBg = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".gd-stats")];
      return els.length ? getComputedStyle(els[0]).backgroundColor : null;
    });
    ok(`takeover stats strip wears the ORG primary, not Steward ink (${w})`, stripBg === hexToRgbStr(CREO_PRIMARY), stripBg);
    const pageBg = await page.evaluate(() => getComputedStyle(document.querySelector("div[style*='min-height']") || document.body).backgroundColor);
    ok(`takeover page background is the org's validated tint (${w})`, pageBg === hexToRgbStr(CREO_TINT), pageBg);
    ok(`takeover footer carries the ORG identity (${w})`, await page.locator("text=Tax ID (EIN): 12-3456789").count() > 0);
    ok(`takeover trust line still renders (${w})`, await page.locator(`text=${trustLine}`).count() > 0);
    await page.screenshot({ path: `${OUT}/state1-takeover-${w}.png`, fullPage: true });
    await ctx.close();
  }

  // ── TRANSITION 1→2 (in-page, no reload): add a second org → neutral shell ─
  {
    const { ctx, page } = await newPage(capCookie, { width: 1440, height: 950 });
    await page.click("text=+ Add another organization");
    await page.fill('input[aria-label="Search organizations"]', "pantry");
    await page.waitForTimeout(900);
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(1200);
    ok("transition 1→2: neutral shell returns IN-PAGE after adding org #2",
      await page.locator('span:text-is("Your Giving")').count() === 1);
    ok("transition 1→2: both org cards render", await page.locator("text=CREO Arts").count() > 0 && await page.locator("text=Open Door Pantry").count() > 0);
    await page.screenshot({ path: `${OUT}/transition-add-1440.png`, fullPage: true });

    // Scoping: CREO's accent must appear ONLY inside CREO's own card.
    const leak = await page.evaluate((accentRgb) => {
      const offenders = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.borderLeftColor === accentRgb && parseFloat(cs.borderLeftWidth) > 0) {
          const inCreoCard = !!el.closest(".gd-orgcard") && el.closest(".gd-orgcard").innerText.includes("CREO Arts");
          const isImpact = el.innerText.includes("CREO") || (el.closest("div")?.innerText || "").includes("CREO");
          if (!inCreoCard && !isImpact) offenders.push(el.className + "|" + el.tagName);
        }
      }
      return offenders;
    }, hexToRgbStr(CREO_ACCENT));
    ok("multi-org shell: CREO's accent appears only on CREO's own sections", leak.length === 0, leak);
    const headerBg = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(d => d.innerText.startsWith("Steward") && getComputedStyle(d).borderBottomWidth === "3px");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok("multi-org shell header band is Steward ink, no org color above the fold", headerBg === "rgb(15, 26, 18)", headerBg);
    await ctx.close();
  }

  // ── STATE 2 — two orgs: neutral shell, per-org themed cards ──────────────
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(capCookie, vp);
    ok(`state2 neutral shell (${w})`, await page.locator('span:text-is("Your Giving")').count() === 1);
    // BUILD-51: a theme saved through the guarded route now stores the image
    // as an ASSET — the banner src is a /portal-assets URL (legacy direct-DB
    // fixtures still render as data: URIs; both are valid generations).
    ok(`state2 CREO card has its header-image banner (${w})`, await page.evaluate(() =>
      [...document.querySelectorAll(".gd-orgcard img")].some(i => (i.src || "").includes("/portal-assets/") || (i.src || "").startsWith("data:image/svg"))));
    ok(`state2 trust line renders (${w})`, await page.locator(`text=${trustLine}`).count() > 0);
    await page.screenshot({ path: `${OUT}/state2-shell-${w}.png`, fullPage: true });
    await ctx.close();
  }

  // ── DRILL-DOWN — seamless takeover of the org (theme stashed pre-nav) ─────
  {
    const { ctx, page } = await newPage(capCookie, { width: 1440, height: 950 });
    await page.click(".gd-orgcard");
    await page.waitForTimeout(300);
    const stashed = await page.evaluate((slug) => sessionStorage.getItem("pt_theme_" + slug) !== null, CREO_SLUG);
    ok("drill-down stashes the org theme BEFORE navigating (no neutral flash)", stashed);
    await page.waitForTimeout(900);
    ok("drill-down lands on the org portal under the Your-Giving back bar",
      await page.locator("text=← Your Giving").count() === 1 && await page.locator("text=CREO Arts").count() > 0);
    const portalBg = await page.evaluate(() => {
      const el = document.querySelector('div[style*="min-height: 100vh"]');
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok("drill-down portal wears the org tint end to end", portalBg === hexToRgbStr(CREO_TINT), portalBg);
    await page.screenshot({ path: `${OUT}/drilldown-1440.png`, fullPage: true });
    await ctx.close();
  }

  // ── TRANSITION 2→1 (in-page): unfollow the pantry → takeover returns ─────
  {
    const { ctx, page } = await newPage(capCookie, { width: 1440, height: 950 });
    await page.click('button:has-text("Unfollow")');
    await page.waitForTimeout(1200);
    ok("transition 2→1: takeover returns IN-PAGE after removing org #2",
      await page.locator('span:text-is("Your Giving")').count() === 0 && await page.getByTestId("steward-quiet-line").count() === 1);
    await page.screenshot({ path: `${OUT}/transition-remove-1440.png`, fullPage: true });
    await ctx.close();
  }

  // ── SETTINGS — the live preview panel (staff app) ─────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const auth = creoLogin.body;
    await page.addInitScript(({ token, user, org }) => {
      localStorage.setItem("npe_token", token);
      localStorage.setItem("npe_user", JSON.stringify(user));
      localStorage.setItem("npe_org", JSON.stringify(org));
    }, { token: auth.token, user: auth.user, org: auth.org });
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.click('button:has-text("Settings")', { timeout: 5000 });
    await page.waitForTimeout(600);
    await page.click('button:has-text("Donor Portal")', { timeout: 5000 });
    await page.waitForTimeout(900);
    // BUILD-54 follow-up (2026-08-15): the theme form + PortalThemePreview
    // mock were retired from the CRM — appearance editing (and its preview,
    // the REAL page) now lives in /portal-editor Design mode, asserted by
    // scripts/build54-capture.js. The CRM hub must NOT carry a theme preview.
    ok("CRM hub carries no theme-preview mock (moved to the editor)",
      await page.locator("text=Live preview").count() === 0
      && await page.locator("text=Their card keeps their own theme").count() === 0);
    ok("CRM hub keeps the edit-mode path", await page.locator("text=Edit the portal").count() > 0);
    await page.screenshot({ path: `${OUT}/settings-preview-1440.png`, fullPage: true });
    await ctx.close();
  }

  // cleanup follows so reruns are stable (donor records + theme stay — they
  // make org_creo's scratch portal a standing themed demo)
  await db.query(`DELETE FROM donor_org_follows WHERE account_id IN ('da_b48cap','da_b48zero')`);
  await db.end();
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — shots in ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
