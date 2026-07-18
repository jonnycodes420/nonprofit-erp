#!/usr/bin/env node
// BUILD-12 app-UI capture — crisp DSF3 verification screenshots for the three
// app-side parts (enriched palette, no page-subtitle blurbs, everything
// clickable). Logs into prod with the demo account (read-only nav only) and
// captures element crops of the Fundraising/Reports/Finance headers post-blurb
// plus interactive hover/focus states.
//
// Crispness: deviceScaleFactor 3 → element bitmaps ≥3× CSS size, PNG lossless.
//
// Usage:
//   PLAYWRIGHT_DIR=/path/to/pw node scripts/build12-ui-capture.js
// Env: BASE (frontend), API (backend), EMAIL/PASSWORD, OUT

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://client-five-tau-13.vercel.app";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.PASSWORD || "demo1234";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", `build12-ui-${new Date().toISOString().split("T")[0]}`);
const DSF = 3;

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json();
}

const nav = async (page, label) => {
  await page.click(`.app-sidebar button:has-text("${label}")`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const session = await login();
  console.log(`Logged in as ${EMAIL} (org ${session.org?.id})`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [session.token, session.user, session.org]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  let fails = 0;
  const shot = async (name, el) => {
    const target = el ? await page.$(el) : page;
    if (el && !target) { console.log(`  ⚠ ${name}: selector ${el} not found — full page`); }
    await (target || page).screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}.png`);
  };
  // Assert a page has NO leftover subtitle string under its PageTitle.
  const assertNoBlurb = async (label, forbidden) => {
    const body = await page.textContent("body");
    const hit = forbidden.find(s => body.includes(s));
    if (hit) { fails++; console.error(`  ✗ ${label}: blurb still present → "${hit}"`); }
    else console.log(`  ✓ ${label}: no subtitle blurb`);
  };

  // ── Fundraising (showcase) ──
  await nav(page, "Fundraising");
  await shot("fundraising-overview", ".app-content");
  await assertNoBlurb("Fundraising", ["command center", "You've raised"]);
  // Hover an interactive stat tile + focus the goal card to show affordances.
  const tile = await page.$('.app-content [role="button"]');
  if (tile) { await tile.hover(); await page.waitForTimeout(250); await shot("fundraising-hover-card", ".app-content"); }
  // Count interactive elements as a smoke check.
  const nBtns = await page.$$eval('.app-content [role="button"]', els => els.length);
  console.log(`  · Fundraising interactive elements: ${nBtns}`);
  if (nBtns < 5) { fails++; console.error(`  ✗ expected ≥5 interactive elements on Fundraising, got ${nBtns}`); }

  // ── Reports ──
  await nav(page, "Reports");
  await shot("reports-header", ".app-content");
  await assertNoBlurb("Reports", ["Six answers to the questions", "How much did we raise this period"]);

  // ── Finance (header fix: title + year-basis toggle inline, no dead band) ──
  await nav(page, "Finance");
  await shot("finance-overview", ".app-content");
  await assertNoBlurb("Finance", ["You're operating on"]);
  const finTile = await page.$('.app-content [role="button"]');
  if (finTile) { await finTile.hover(); await page.waitForTimeout(250); await shot("finance-hover-card", ".app-content"); }

  // ── Grants (pipeline cards filter the list) ──
  await nav(page, "Grants");
  const listToggle = await page.$('button:has-text("List")');
  if (listToggle) { await listToggle.click(); await page.waitForTimeout(600); }
  await shot("grants-list", ".app-content");
  const gBtns = await page.$$eval('.app-content [role="button"]', els => els.length);
  console.log(`  · Grants interactive elements: ${gBtns}`);
  // Click the first pipeline card to prove the list filters.
  const gCard = await page.$('.grants-pipeline-grid [role="button"]');
  if (gCard) { await gCard.click(); await page.waitForTimeout(500); await shot("grants-filtered", ".app-content"); }

  // ── Communications (Analytics cards) ──
  await nav(page, "Communications");
  const anTab = await page.$('.comm-tabbar button:has-text("Analytics")');
  if (anTab) { await anTab.click(); await page.waitForTimeout(700); await shot("comms-analytics", ".app-content"); }

  await browser.close();
  console.log(fails ? `\n${fails} assertion(s) FAILED` : `\nAll capture assertions passed. Screenshots → ${OUT}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
