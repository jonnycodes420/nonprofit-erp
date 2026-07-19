// DSF3 capture — CREO Home hero on the typed roll-up (FIX 2026-07-19).
// Confirms the Home hero shows the overarching FY goal roll-up with its
// Annual / Capital / Project breakdown (Annual Fund reads "Goal met · $8,500
// over"), not the stale single "$25,000 this quarter" banner. Local only:
// a vite preview built with VITE_API_URL=http://localhost:5601 + the local
// backend seeded by scripts/seed-creo-goals.js.
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:4174 API=http://localhost:5601 \
//     node scripts/creo-goals-capture.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://127.0.0.1:4174";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PW = process.env.PW || "demo1234";
const OUT = process.env.OUT || "docs/creo-goals-2026-07-19";
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 3 });
  const res = await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });
  await page.goto(BASE + "/dashboard");
  await sleep(3500);
  await page.screenshot({ path: path.join(OUT, "creo-home-rollup.png") });
  // Tight crop of just the hero + typed breakdown.
  const hero = await page.locator(".dash-goal-banner").first().boundingBox().catch(() => null);
  if (hero) {
    await page.screenshot({ path: path.join(OUT, "creo-home-hero.png"), clip: { x: Math.max(0, hero.x - 8), y: Math.max(0, hero.y - 8), width: Math.min(1440, hero.width + 16), height: hero.height + 320 } });
  }
  await browser.close();
  console.log("✓ captured to " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
