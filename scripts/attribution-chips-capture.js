// DSF3 screenshots for the attribution-completeness FIX — the Home hero chips
// (Pace · This FY · This week · Re-engaged) with the shared interactive
// treatment, incl. a hover state, plus the This-week chip's destination
// (Reports › Giving Summary filtered to the chip's exact week).
//
// Run against a LOCAL stack (never prod):
//   1. scratch server on :5601 booted with CORS_ORIGIN=http://localhost:4173
//   2. client built with VITE_API_URL=http://localhost:5601, `vite preview` on :4173
//   3. the attribution-completeness suite run once (seeds org_ac_a with
//      campaigns/gifts — ac-a@test.local / loadtest1234)
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/attribution-chips-capture.js
const path = require("path");
const fs = require("fs");

const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "ac-a@test.local";
const PASSWORD = process.env.PASSWORD || "loadtest1234";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "attribution-fix-2026-08-04");

(async () => {
  if (!/localhost/.test(BASE) || !/localhost/.test(API)) throw new Error("local stack only");
  fs.mkdirSync(OUT, { recursive: true });

  const login = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!login.token) throw new Error("login failed: " + JSON.stringify(login));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  await page.goto(BASE + "/login");
  await page.evaluate(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [login.token, login.user, login.org]);
  await page.goto(BASE + "/dashboard");
  await page.waitForSelector(".dash-goal-banner", { timeout: 20000 });
  await page.waitForTimeout(2500);

  // 1. Hero with the four chips.
  await page.locator(".dash-goal-banner").first().screenshot({ path: path.join(OUT, "hero-chips.png") });

  // 2. Chip hover state (This week) — the shared dark interactive treatment.
  const chip = page.locator('.dash-goal-banner [role="button"].click-card-dark', { hasText: "This week" }).first();
  await chip.hover();
  await page.waitForTimeout(400);
  await page.locator(".dash-goal-banner").first().screenshot({ path: path.join(OUT, "hero-chip-hover.png") });

  // 3. Keyboard focus ring on a chip (accessibility).
  await chip.focus();
  await page.waitForTimeout(300);
  await page.locator(".dash-goal-banner").first().screenshot({ path: path.join(OUT, "hero-chip-focus.png") });

  // 4. Click This week → Reports Giving Summary filtered to the exact week.
  await chip.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "this-week-destination.png"), fullPage: false });

  await browser.close();
  console.log("Saved to " + OUT + ": hero-chips, hero-chip-hover, hero-chip-focus, this-week-destination");
})().catch(e => { console.error(e); process.exit(1); });
