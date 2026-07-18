// BUILD-15 DSF3 screenshot capture — moves management & prospect pipeline.
// Local only: drives a vite preview (BASE) wired to a local backend, logging in
// as a Team-plan demo org (willow / org_smalltest). Captures the officer-colored
// pipeline board, a prospect profile's moves+asks panel, and the Core upgrade
// state (via a Core-org login). Run with PLAYWRIGHT_DIR pointing at a scratch
// playwright install (see tests/README / CLAUDE.md screenshot convention):
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:5602 API=http://localhost:5601 \
//     node scripts/build15-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:5602";
const API = process.env.API || "http://localhost:5601";
const TEAM_LOGIN = process.env.TEAM_LOGIN || "admin@willow.test";
const CORE_LOGIN = process.env.CORE_LOGIN || "admin@test-reports.local"; // any core (seed/trial-lapsed) org
const PW = process.env.PW || "loadtest1234";
const OUT = process.env.OUT || "docs/build15-2026-07-18";

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
const gotoTab = async (page, label) => {
  await page.goto(BASE + "/dashboard"); await sleep(900);
  await page.locator(`text=${label}`).first().click().catch(() => {});
  await sleep(2200);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // ── Team org: the pipeline board (officer-colored) ────────────────────────
  await loginAs(page, TEAM_LOGIN, PW);
  await gotoTab(page, "Pipeline");
  await page.screenshot({ path: `${OUT}/pipeline-board.png` });
  console.log("captured pipeline-board");

  // ── Prospect profile: moves + asks panel ──────────────────────────────────
  // Open a specific prospect (seeded with 2 moves + an ask) → profile Overview,
  // then scroll the takeover to the "Pipeline — moves & asks" panel.
  const PROFILE_NAME = process.env.PROFILE_NAME || "Susan Rodriguez";
  await page.locator(`text=${PROFILE_NAME}`).first().click().catch(() => {});
  await sleep(1800);
  await page.locator("text=Pipeline — moves & asks").first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(600);
  await page.screenshot({ path: `${OUT}/prospect-profile-moves-asks.png` });
  console.log("captured prospect-profile-moves-asks");

  // ── Core org: the graceful upgrade state ──────────────────────────────────
  await loginAs(page, CORE_LOGIN, PW);
  await gotoTab(page, "Pipeline");
  await page.screenshot({ path: `${OUT}/core-upgrade.png` });
  console.log("captured core-upgrade");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
