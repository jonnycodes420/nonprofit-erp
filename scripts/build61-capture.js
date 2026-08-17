// BUILD-61 — local capture of the giving page (read-only, loopback only).
// Requires: a localhost-API client build served by `vite preview` on :4173, the
// scratch server on :5601, and the fixture orgs already seeded (giveflow-*, plus
// an unthemed org). Screenshots → docs/build61/local/.
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build61-capture.js
const path = require("path");
const fs = require("fs");
const PW_DIR = process.env.PLAYWRIGHT_DIR || process.env.HOME + "/steward-qa";
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const APP = "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build61", "local");
const WIDTHS = [390, 1440, 2560];
// slug → label. Unthemed first (the day-one experience this build is about).
const PAGES = (process.env.SLUGS || "unthemed-demo,giveflow-terracotta,giveflow-harbor").split(",");

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const slug of PAGES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: Math.max(1000, Math.round(w * 0.8)) }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(`${APP}/give/${slug}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${slug}-${w}.png`), fullPage: true });
      console.log(`  shot ${slug} @ ${w}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log("done → " + OUT);
}
run().catch(e => { console.error(e); process.exit(1); });
