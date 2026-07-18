// BUILD-14 DSF3 screenshot capture — households, portfolio color, planned-giving.
// Local only: drives a vite preview (BASE) wired to a local backend, logging in
// as the riverbend (Team-plan) demo org. Run with PLAYWRIGHT_DIR pointing at a
// scratch playwright install (see tests/README / CLAUDE.md screenshot convention).
//   PLAYWRIGHT_DIR=/tmp/pw BASE=http://127.0.0.1:5602 API=http://localhost:5601 \
//     LOGIN=admin@riverbend.test PW=loadtest1234 node scripts/build14-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:5602";
const API = process.env.API || "http://localhost:5601";
const LOGIN = process.env.LOGIN || "admin@riverbend.test";
const PW = process.env.PW || "loadtest1234";
const OUT = process.env.OUT || "docs/build14-2026-07-18";
const HH_DONOR = process.env.HH_DONOR || "d_lt0003cb"; // Carol Walker (household primary)

const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // Log in via the API, then seed localStorage exactly like LoginPage does.
  const res = await page.request.post(`${API}/auth/login`, { data: { email: LOGIN, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });

  // ── Directory: portfolio color legend + color dots + designation filter ────
  await page.goto(BASE + "/dashboard");
  await sleep(1200);
  // navigate to Donors
  await page.goto(BASE + "/dashboard");
  await sleep(800);
  const donorsNav = page.locator("text=Donors").first();
  await donorsNav.click().catch(() => {});
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/directory-portfolios.png` });

  // Open the designation filter → planned-giving segment
  const desigSelect = page.locator("select").filter({ hasText: "All designations" }).first();
  await desigSelect.selectOption("planned_confirmed").catch(() => {});
  await sleep(1800);
  await page.screenshot({ path: `${OUT}/planned-giving-filter.png` });

  // ── Household profile card (inside a donor profile) ────────────────────────
  await page.evaluate(() => { localStorage.setItem("__none", "1"); });
  await page.goto(BASE + `/dashboard`);
  await sleep(600);
  // Deep-link to the household primary's profile through the app: use search
  await page.evaluate(async (id) => { window.__deep = id; }, HH_DONOR);
  // Simplest reliable path: click Donors, clear filter, search for the donor
  await page.locator("text=Donors").first().click().catch(() => {});
  await sleep(1500);
  const search = page.locator("input[placeholder*='Search'], input[placeholder*='search']").first();
  await search.fill("Carol Walker").catch(() => {});
  await sleep(1800);
  const row = page.locator(".dir-donor-row").first();
  await row.click().catch(() => {});
  await sleep(2200);
  await page.screenshot({ path: `${OUT}/household-profile.png`, fullPage: false });

  await browser.close();
  console.log("captured to " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
