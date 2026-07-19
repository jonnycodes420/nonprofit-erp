// BUILD-19 DSF3 screenshot capture — pipeline reconciliation + solid titles.
// Local only: drives a vite preview (BASE) wired to a local backend.
//  Part 1: Team org (org_mv_team) → the single Pipeline board; Core org
//          (org_mv_core) → the upgrade card only (no backdoor board); the
//          Donors tab with its view toggle (no "My Pipeline" entry).
//  Part 2: solid page titles on Donors, Pipeline, Finance.
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:5602 API=http://localhost:5601 \
//     node scripts/build19-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
const fs = require("fs");

const BASE = process.env.BASE || "http://127.0.0.1:5602";
const API = process.env.API || "http://localhost:5601";
const PW = process.env.PW || "loadtest1234";
const TEAM_LOGIN = process.env.TEAM_LOGIN || "admin@mv.local";
const CORE_LOGIN = process.env.CORE_LOGIN || "coreadmin@mv.local";
const OUT = process.env.OUT || "docs/build19-2026-07-18";
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loginAs(page, email) {
  const res = await page.request.post(`${API}/auth/login`, { data: { email, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed for " + email + ": " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });
}
const gotoTab = async (page, label) => {
  await page.goto(BASE + "/dashboard"); await sleep(1200);
  await page.locator(".side-nav-btn", { hasText: label }).first().click();
  await sleep(2400);
};
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("  ✓ " + name); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // ── Team org: the single pipeline board + solid titles ────────────────────
  await loginAs(page, TEAM_LOGIN);
  await gotoTab(page, "Pipeline");
  await shot(page, "team-pipeline-board");
  await gotoTab(page, "Donors");
  await shot(page, "donors-no-mypipeline-tab");   // view toggle has no "My Pipeline"
  await gotoTab(page, "Finance");
  await shot(page, "finance-solid-title");

  // ── Core org: upgrade card only, no backdoor board ────────────────────────
  await loginAs(page, CORE_LOGIN);
  await gotoTab(page, "Pipeline");
  await shot(page, "core-pipeline-upgrade");
  await gotoTab(page, "Donors");
  await shot(page, "core-donors-no-backdoor");

  await browser.close();
  console.log("\nBUILD-19 capture → " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
