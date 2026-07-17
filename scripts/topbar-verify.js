#!/usr/bin/env node
// Top-bar global search verification (BUILD-08). Drives the real built
// client against a real backend with the demo login — no mocks.
//
// Usage:
//   PLAYWRIGHT_DIR=/path/with/playwright node scripts/topbar-verify.js
//
// Env: BASE / API / EMAIL / PASSWORD / PLAYWRIGHT_DIR — same conventions as
// scripts/screenshot-matrix.js (BASE should be the deployed frontend; a
// local vite preview can't talk to the prod API through its CORS allowlist).
//
// Checks: ⌘K focuses the search from three different tabs; a donor search
// opens the right donor profile; a grant search opens the grant profile
// (including from the Grants tab itself — the navNonce remount case); the
// "Reports" quick-nav lands on Reports; Settings→Tax Receipts quick-nav
// deep-links to the receipts section; the bar is 52px, sticky above the
// content with no horizontal overflow.

const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://client-five-tau-13.vercel.app";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.PASSWORD || "demo1234";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
};

async function api(pathname, token) {
  const r = await fetch(`${API}${pathname}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`${pathname}: ${r.status}`);
  return r.json();
}

(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => { if (!r.ok) throw new Error("login failed"); return r.json(); });
  console.log(`Logged in as ${EMAIL}`);

  // Real org data to search for
  const donorPage = await api(`/donors?limit=5`, login.token);
  const donor = donorPage.donors.find(d => d.name && d.name.trim().length > 3);
  const grants = await api(`/grants`, login.token);
  const grant = grants.find(g => g.funder && g.funder.trim().length > 3);
  if (!donor || !grant) throw new Error("demo org needs at least one donor and one grant");
  console.log(`Search targets: donor "${donor.name}", grant "${grant.funder}"`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [login.token, login.user, login.org]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const search = page.locator('[data-testid="global-search"]');
  const searchFocused = () => page.evaluate(() => document.activeElement?.dataset?.testid === "global-search");
  const goTab = async label => {
    await page.click(`.app-sidebar button:has-text("${label}")`);
    await page.waitForTimeout(700);
  };

  // ── ⌘K focus from three different tabs ────────────────────────────────────
  for (const label of ["Home", "Grants", "Reports"]) {
    if (label !== "Home") await goTab(label);
    await page.click(".app-content", { position: { x: 10, y: 10 } }).catch(() => {});
    await page.keyboard.press("ControlOrMeta+k");
    t(`⌘K focuses search from ${label}`, await searchFocused());
    await page.keyboard.press("Escape");
  }

  // ── Bar geometry / layout ────────────────────────────────────────────────
  const barBox = await page.locator(".app-topbar").boundingBox();
  const contentBox = await page.locator(".app-content").boundingBox();
  t("top bar is ~52px tall and starts at content-area left edge (x=220)",
    barBox && Math.round(barBox.height) === 52 && Math.round(barBox.x) === 220,
    JSON.stringify(barBox));
  t("content sits below the bar (no overlap)", contentBox && barBox && contentBox.y >= barBox.y + barBox.height - 1,
    `content.y=${contentBox?.y} bar bottom=${barBox ? barBox.y + barBox.height : "?"}`);
  t("no horizontal page scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // ── Donor search → donor profile ─────────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill(donor.name.slice(0, Math.min(donor.name.length, 12)));
  await page.waitForTimeout(900); // debounce + fetch
  const donorResult = page.locator(`[data-testid="search-result"]:has-text("${donor.name}")`).first();
  t("donor search shows the donor in results", (await donorResult.count()) > 0);
  await donorResult.click();
  await page.waitForTimeout(1500);
  const profileHeader = page.locator(".donor-profile-header");
  t("selecting the donor opens their profile",
    await profileHeader.isVisible().catch(() => false) &&
    (await profileHeader.textContent().catch(() => "")).includes(donor.name));

  // While the profile takeover (fixed, z 200) covers the shell, ⌘K must be
  // a no-op — the bar is underneath it.
  await page.keyboard.press("ControlOrMeta+k");
  t("⌘K is a no-op while a full-screen profile covers the bar", !(await searchFocused()));

  // ── Grant search → grant profile (cross-tab: from Home) ──────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill(grant.funder.slice(0, Math.min(grant.funder.length, 12)));
  await page.waitForTimeout(900);
  const grantResult = page.locator(`[data-testid="search-result"]:has-text("${grant.funder}")`).first();
  t("grant search shows the grant in results", (await grantResult.count()) > 0);
  await grantResult.click();
  await page.waitForTimeout(1200);
  t("selecting the grant opens its profile",
    await page.locator(`.grant-profile-body`).isVisible().catch(() => false) ||
    await page.locator(`.app-content:has-text("${grant.funder}")`).first().isVisible().catch(() => false));

  // ── Same-tab grant search (navNonce remount case) ────────────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await goTab("Grants");
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill(grant.funder.slice(0, Math.min(grant.funder.length, 12)));
  await page.waitForTimeout(900);
  await page.locator(`[data-testid="search-result"]:has-text("${grant.funder}")`).first().click();
  await page.waitForTimeout(1200);
  t("grant search works from the Grants tab itself",
    await page.locator(".grant-profile-body").isVisible().catch(() => false));

  // ── Quick-nav: Reports ───────────────────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("reports");
  await page.waitForTimeout(400);
  const navResult = page.locator('[data-testid="search-result"]:has-text("Open the Reports tab")').first();
  t("quick-nav result for Reports appears", (await navResult.count()) > 0);
  await navResult.click();
  await page.waitForTimeout(1200);
  t("quick-nav lands on Reports", await page.locator(".reports-tabbar").isVisible().catch(() => false));

  // ── Quick-nav: Settings → Tax Receipts ───────────────────────────────────
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("tax receipts");
  await page.waitForTimeout(400);
  await page.locator('[data-testid="search-result"]:has-text("Settings → Tax Receipts")').first().click();
  await page.waitForTimeout(1200);
  t("quick-nav deep-links to Settings receipts section",
    await page.locator("text=Year-End Giving Statements").first().isVisible().catch(() => false));

  // ── Help menu + user chip ────────────────────────────────────────────────
  await page.click('[data-testid="topbar-help"]');
  await page.waitForTimeout(300);
  t("help menu shows founder email link",
    await page.locator('a[href^="mailto:jonathan@stewardapp.dev"]').isVisible().catch(() => false));
  t("sign out lives in the top bar", await page.locator('.app-topbar button:has-text("Sign out")').isVisible());
  t("sidebar no longer has a sign out", !(await page.locator('.app-sidebar :text("Sign out")').count()));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
