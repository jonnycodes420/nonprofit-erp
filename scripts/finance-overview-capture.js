#!/usr/bin/env node
// BUILD-10 Part 3 — Finance Overview capture (verification screenshots).
// Logs into prod with the demo account (read-only: nav + year-basis toggle,
// which only reloads GET /finance/summary and writes localStorage), and captures
// crisp element crops of the Overview under both year bases + the Accounts tab.
//
// Crispness invariant (Part-2): deviceScaleFactor 3 → element bitmaps are ≥3×
// their CSS size; PNG is lossless. A companion assertion prints the natural/rendered
// ratio per shot so grainy captures can't pass silently.
//
// Usage:
//   PLAYWRIGHT_DIR=/tmp/steward-pw node scripts/finance-overview-capture.js
// Env: BASE (frontend), API (backend), EMAIL/PASSWORD, OUT

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://client-five-tau-13.vercel.app";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.PASSWORD || "demo1234";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", `finance-overview-${new Date().toISOString().split("T")[0]}`);

const DSF = 3;

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const session = await login();
  console.log(`Logged in as ${EMAIL} (org ${session.org?.id})`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
    localStorage.setItem("steward_fin_yearmode", "fiscal");
  }, [session.token, session.user, session.org]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // Navigate to Finance via the sidebar (desktop shell).
  await page.click('.app-sidebar button:has-text("Finance")');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const results = [];
  // Capture the main content column (headline + stat row + Overview cards).
  async function shot(name) {
    await page.waitForTimeout(900);
    const el = page.locator(".app-main").first();
    const box = await el.boundingBox();
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1600) } });
    // crispness check: read back the PNG pixel width vs the CSS clip width
    const buf = fs.readFileSync(file);
    const pxW = buf.readUInt32BE(16); // IHDR width
    const ratio = pxW / box.width;
    results.push({ name, cssW: Math.round(box.width), pxW, ratio: +ratio.toFixed(2) });
    console.log(`  ${name}: ${pxW}px / ${Math.round(box.width)}css = ${ratio.toFixed(2)}× ${ratio >= 2 ? "OK" : "GRAINY"}`);
  }

  // 1. Fiscal (default)
  await shot("overview-fiscal");

  // 2. Calendar — click the Calendar Year basis toggle
  await page.click('button:has-text("Calendar Year")');
  await page.waitForTimeout(1200);
  await shot("overview-calendar");

  // 3. Accounts tab (chart of accounts — no starting-balance model; Path L)
  await page.click('.finance-tabbar button:has-text("Accounts")');
  await page.waitForTimeout(1000);
  await shot("accounts");

  const grainy = results.filter(r => r.ratio < 2);
  console.log(`\nSaved ${results.length} shots to ${OUT}`);
  if (grainy.length) { console.error("GRAINY shots (ratio<2):", grainy.map(g => g.name)); process.exitCode = 1; }
  else console.log("All shots meet the ≥2× crispness bar.");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
