// DSF3 screenshot capture — donor-profile Core/Team split (FIX).
// Captures a Core donor profile (full CRM core + LockedFeature previews over the
// major-gifts panels) beside a Team donor profile (full function). Local only:
// drives a vite preview (BASE) wired to a local backend; logs in as a Core org
// and a Team org seeded by tests/moves.test.js (+ scripts seed). Run with:
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:5602 API=http://localhost:5601 \
//     node scripts/donor-profile-gating-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:5602";
const API = process.env.API || "http://localhost:5601";
const CORE_LOGIN = process.env.CORE_LOGIN || "coreadmin@mv.local";
const TEAM_LOGIN = process.env.TEAM_LOGIN || "admin@mv.local";
const PW = process.env.PW || "loadtest1234";
const OUT = process.env.OUT || "docs/donor-profile-gating-2026-07-19";

const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loginAs(page, email, pw) {
  const res = await page.request.post(`${API}/auth/login`, { data: { email, password: pw } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed for " + email + ": " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });
  return j;
}

async function openDonor(page, name) {
  await page.goto(BASE + "/dashboard"); await sleep(1000);
  await page.locator("text=Donors").first().click().catch(() => {});
  await sleep(1800);
  await page.locator(`text=${name}`).first().click().catch(() => {});
  await sleep(2200);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1600 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // Core
  await loginAs(page, CORE_LOGIN, PW);
  await openDonor(page, "Core Donor");
  await page.screenshot({ path: `${OUT}/core-donor-profile.png`, fullPage: true });
  console.log("captured core-donor-profile.png");

  // Team
  await loginAs(page, TEAM_LOGIN, PW);
  await openDonor(page, "Solicit Three");
  await page.screenshot({ path: `${OUT}/team-donor-profile.png`, fullPage: true });
  console.log("captured team-donor-profile.png");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
