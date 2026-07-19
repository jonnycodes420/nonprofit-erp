// BUILD-17 DSF3 screenshot capture — development reporting cadence.
// Local only: drives a vite preview (BASE) wired to a local backend, logging in
// as the demo org (admin@creoarts.org / demo1234 — trial → Team tier), and
// captures the four new Reports views: Week in Review (the digest, in-app),
// 3-Year Comparison, Annual Report, and the Team Solicitations report.
// Run with PLAYWRIGHT_DIR pointing at a scratch playwright install:
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:4173 API=http://localhost:5601 \
//     node scripts/build17-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:4173";
const API = process.env.API || "http://localhost:5601";
const LOGIN = process.env.LOGIN || "admin@creoarts.org";
const PW = process.env.PW || "demo1234";
const OUT = process.env.OUT || "docs/build17-2026-07-18";

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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await loginAs(page, LOGIN, PW);

  const openReport = async (label) => {
    await page.goto(BASE + "/dashboard"); await sleep(900);
    await page.locator("button:has-text('Reports')").first().click().catch(() => {});
    await sleep(1400);
    await page.locator(`.reports-tabbar button:has-text("${label}")`).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.locator(`.reports-tabbar button:has-text("${label}")`).first().click().catch(() => {});
    await sleep(1800);
  };

  await openReport("Week in Review");
  await page.screenshot({ path: `${OUT}/week-in-review.png`, fullPage: true });
  console.log("captured week-in-review");

  await openReport("3-Year Comparison");
  await page.screenshot({ path: `${OUT}/three-year-comparison.png`, fullPage: true });
  console.log("captured three-year-comparison");

  await openReport("Annual Report");
  await page.screenshot({ path: `${OUT}/annual-report.png`, fullPage: true });
  console.log("captured annual-report");

  await openReport("Solicitations");
  await page.screenshot({ path: `${OUT}/solicitations.png`, fullPage: true });
  console.log("captured solicitations");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
