// BUILD-19 Home tweak — My Portfolio leads + expanded by default.
// Captures Team Home (portfolio at top, expanded, retention/signals below) and
// confirms Core Home still reads sensibly.
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:5602 API=http://localhost:5601 \
//     node scripts/build19-home-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:5602";
const API = process.env.API || "http://localhost:5601";
const PW = process.env.PW || "loadtest1234";
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
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log("  ✓ " + name); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  await loginAs(page, "admin@mv.local");     // Team org
  await page.goto(BASE + "/dashboard"); await sleep(2600);
  await shot(page, "team-home-portfolio-top-expanded");

  await loginAs(page, "coreadmin@mv.local"); // Core org
  await page.goto(BASE + "/dashboard"); await sleep(2600);
  await shot(page, "core-home");

  await browser.close();
  console.log("\nBUILD-19 Home capture → " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
