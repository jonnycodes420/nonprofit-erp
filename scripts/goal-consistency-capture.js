// DSF3 capture — multi-goal display consistency (FIX 2026-07-19).
// Proves the umbrella (FY2026 Comprehensive Campaign) rolls up to $136k/76%
// with its 3 children GROUPED beneath it on all three surfaces: the Home hero,
// Fundraising → Overview, and Fundraising → Campaigns. Local only: a vite
// preview built with VITE_API_URL=http://localhost:5601 + the local backend
// (org_creo already seeded by scripts/seed-creo-goals.js).
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:4174 API=http://localhost:5601 \
//     node scripts/goal-consistency-capture.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:4174";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PW = process.env.PW || "demo1234";
const OUT = process.env.OUT || "docs/goal-consistency-2026-07-19";
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 3 });
  const res = await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });

  // 1) Home hero
  await page.goto(BASE + "/dashboard");
  await sleep(3500);
  const hero = await page.locator(".dash-goal-banner").first().boundingBox().catch(() => null);
  if (hero) {
    await page.screenshot({ path: path.join(OUT, "1-home-hero.png"), clip: { x: Math.max(0, hero.x - 8), y: Math.max(0, hero.y - 8), width: Math.min(1440, hero.width + 16), height: hero.height + 340 } });
  } else {
    await page.screenshot({ path: path.join(OUT, "1-home-hero.png") });
  }

  // Navigate to Fundraising via the sidebar (the group label is a plain div;
  // the nav item is a button.side-nav-btn — scope to that so we don't hit the
  // "Fundraising" section header).
  await page.locator("button.side-nav-btn", { hasText: "Fundraising" }).first().click();
  await sleep(2500);

  // 2) Fundraising → Overview (reference). Subtabs render in the .finance-tabbar.
  await page.locator(".finance-tabbar button", { hasText: "Overview" }).first().click().catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, "2-fundraising-overview.png") });

  // 3) Fundraising → Campaigns
  await page.locator(".finance-tabbar button", { hasText: "Campaigns" }).first().click().catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, "3-fundraising-campaigns.png") });

  await browser.close();
  console.log("✓ captured to " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
