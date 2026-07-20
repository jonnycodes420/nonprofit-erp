// FIX (smart initial stage on import) — DSF3 screenshot capture.
// Local only: drives a vite preview (BASE) wired to the local backend (API),
// logging in to a demo org whose donors already span every stage. Captures:
//   (1) the Import preview showing per-donor inferred stages + the Smart Stage
//       Assignment summary (pure client-side inference, writes nothing);
//   (2) the Donors directory after import, sorted across stages.
// Run:
//   PLAYWRIGHT_DIR=/tmp/steward-pw BASE=http://127.0.0.1:5602 \
//     API=http://localhost:5601 LOGIN=a-admin@is.local node scripts/import-stage-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE  = process.env.BASE  || "http://127.0.0.1:5602";
const API   = process.env.API   || "http://localhost:5601";
const LOGIN = process.env.LOGIN || "a-admin@is.local";
const PW    = process.env.PW    || "loadtest1234";
const OUT   = process.env.OUT   || "docs/import-stage-2026-07-20";

const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A demo list with real giving history that lands each donor in a distinct
// stage under today's date — the "Steward sorted your list" beat.
const DEMO_CSV = [
  "Name,Email,Total Giving,Last Gift Date",
  "Margaret Chen,m.chen@example.com,24500,2026-06-20",   // recent → steward
  "Robert Atkinson,ratkinson@example.com,12000,2024-11-15", // >365d → lapsed
  "David Kim,dkim@example.com,1500,2026-03-15",          // $1500 @ ~120d → solicit
  "Aisha Patel,apatel@example.com,300,2025-09-01",       // small/old → cultivate
  "Sarah Lee,slee@example.com,,",                        // contact, no gift → qualify
  "Tom Nguyen,,,",                                       // no contact, no gift → prospect
].join("\n");

async function loginAs(page, email) {
  const res = await page.request.post(`${API}/auth/login`, { data: { email, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed for " + email + ": " + JSON.stringify(j));
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, j);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("[pageerror]", e.message));

  await loginAs(page, LOGIN);
  await page.goto(BASE + "/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2500);

  // → Donors tab (sidebar buttons carry class `side-nav-btn`)
  await page.locator("button.side-nav-btn", { hasText: "Donors" }).first().click();
  await page.getByRole("button", { name: /Import/i }).first().waitFor({ timeout: 15000 });
  await sleep(1800);
  await page.screenshot({ path: `${OUT}/directory-stages.png` });
  console.log("saved directory-stages.png");

  // Open the Import modal, paste the demo CSV, Parse → the inferred-stage preview
  await page.getByRole("button", { name: /Import/i }).first().click();
  const ta = page.locator("textarea").first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill(DEMO_CSV);
  await sleep(400);
  await page.getByRole("button", { name: /Parse/i }).click();
  await page.getByText(/Smart Stage Assignment/i).first().waitFor({ timeout: 10000 }).catch(() => {});
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/import-preview-stages.png`, fullPage: true });
  console.log("saved import-preview-stages.png");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
