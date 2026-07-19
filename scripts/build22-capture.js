// BUILD-22 DSF3 screenshot capture — smart moves + in-view drill-downs.
// Same conventions as scripts/build15-capture.js etc.: Playwright is NOT a repo
// dep — install it in a scratch dir and pass PLAYWRIGHT_DIR. Point BASE at a
// running build whose API has the smart-moves scenarios (the tests/smart-moves
// seed data works: log in as admin@sm.local / loadtest1234 against a local
// preview wired to the scratch server).
//
//   PLAYWRIGHT_DIR=/private/tmp/steward-pw BASE=http://localhost:4173 \
//     EMAIL=admin@sm.local PASSWORD=loadtest1234 node scripts/build22-capture.js
//
// Captures at deviceScaleFactor 3:
//   1. suggested-move.png     — donor profile "Suggested Move" (Accept/Dismiss)
//   2. auto-lapse-moves.png   — a profile with auto-lapse + auto-unlapse moves
//   3. drilldown-in-view.png  — a Home stat drill-down centred in the viewport

const path = require("path");
const fs = require("fs");
const PW = process.env.PLAYWRIGHT_DIR || "/private/tmp/steward-pw";
const { chromium } = require(path.join(PW, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://localhost:4173";
const EMAIL = process.env.EMAIL || "admin@sm.local";
const PASSWORD = process.env.PASSWORD || "loadtest1234";
const OUT = path.join(__dirname, "..", "docs", "build22-2026-07-19");
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  saved", name); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1456, height: 820 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // Login
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // 3. Drill-down in view: open a My Portfolio stat and confirm the modal is
  //    centred in the viewport (portalled to <body>, not below the fold).
  const giftsStat = page.locator("text=Gifts YTD").first();
  await giftsStat.scrollIntoViewIfNeeded();
  await giftsStat.click();
  await page.waitForTimeout(800);
  await shot(page, "drilldown-in-view.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 1. Suggested Move on a first-gift prospect.
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.click("text=Donors");
  await page.waitForTimeout(1200);
  await page.click("text=First-Gift Prospect");
  await page.waitForTimeout(1500);
  await shot(page, "suggested-move.png");

  // 2. Auto-lapse + auto-unlapse moves on the "Lapse Eligible" profile.
  await page.click("text=Back");
  await page.waitForTimeout(1000);
  await page.click("text=Lapse Eligible");
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(500);
  await shot(page, "auto-lapse-moves.png");

  await browser.close();
  console.log("done →", OUT);
})().catch(e => { console.error(e); process.exit(1); });
