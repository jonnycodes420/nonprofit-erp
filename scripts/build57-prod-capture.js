// BUILD-57 §2d — eyes on the LIVE portal. The BUILD-55 impact-precedence
// change went donor-visible on prod without a human ever looking at it there;
// this captures the live donor-facing surfaces for review. STRICTLY
// READ-ONLY: public GETs only, no login, no writes of any kind.
//
// Run: PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build57-prod-capture.js
// Output: docs/build57/prod/ at 390 and 1440.
//
// Signed-in surfaces (donor dashboard with linked orgs, the authed portal)
// need a live donor session and are NOT captured here — see
// audit/BUILD-57-FINDINGS.md §2d for what still needs a human eyeball.
const path = require("path");
const fs = require("fs");
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "https://www.stewardapp.dev";
const OUT = path.join(__dirname, "..", "docs", "build57", "prod");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 200) : "")); } };

const PAGES = [
  // [name, path, must-contain (case-insensitive), must-NOT-contain]
  ["giving-signedout", "/giving", /one quiet place|giving/i, /error|undefined|NaN/i],
  ["portal-creo-signedout", "/portal/creo-arts-creo", /creo arts/i, /error|undefined|NaN/i],
  ["give-creo", "/give/creo-arts-creo", /creo arts/i, /undefined|NaN/i],
];

(async () => {
  const browser = await chromium.launch();
  for (const [w, h, suffix] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    for (const [name, urlPath, must, mustNot] of PAGES) {
      try {
        const resp = await p.goto(BASE + urlPath, { waitUntil: "networkidle", timeout: 45000 });
        await p.waitForTimeout(1200);
        const text = await p.locator("body").innerText().catch(() => "");
        ok(`(${suffix}) ${name} loads`, resp && resp.status() < 400, resp?.status());
        ok(`(${suffix}) ${name} carries expected content`, must.test(text), text.slice(0, 120));
        ok(`(${suffix}) ${name} shows no error junk`, !mustNot.test(text));
        // No horizontal scroll at phone width (the standing mobile rule).
        if (suffix === "390") {
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          ok(`(390) ${name} no horizontal overflow`, overflow <= 1, overflow);
        }
        await p.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`), fullPage: true });
      } catch (e) { ok(`(${suffix}) ${name}`, false, e.message); }
    }
    // Fund cards + their Give links on the give page (the BUILD-55 chain).
    if (suffix === "1440") {
      await p.goto(BASE + "/give/creo-arts-creo", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      await p.waitForTimeout(800);
      const fundLinks = await p.locator("a[href*='fund=']").count();
      console.log(`  INFO  fund-designated Give links on /give/creo-arts-creo: ${fundLinks}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
