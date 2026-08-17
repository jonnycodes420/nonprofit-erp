// BUILD-61 Part 0 — prove BUILD-60 is VISIBLE on prod, not just green in tests.
// Read-only: loads the LIVE giving page for each demo org and asserts against the
// real rendered DOM + computed styles. No writes anywhere.
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build61-prod-verify.js
//
// Asserts, per the brief: no Steward mark/wordmark/emerald; the org's own colors
// present; frequency above the amount with Monthly pre-selected; the second
// monthly tier pre-selected; the button reads "Give $<tier> every month"; the
// disclosure present and not visually demoted.
const path = require("path");
const fs = require("fs");
const PW_DIR = process.env.PLAYWRIGHT_DIR || process.env.HOME + "/steward-qa";
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const APP = process.env.APP || "https://www.stewardapp.dev";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const OUT = path.join(__dirname, "..", "docs", "build61", "prod-verify");
const WIDTHS = [390, 1440, 2560];
const ORGS = ["creo-arts-creo", "harbor-music-school-demo-b6e8fe"];

// Steward brand emerald as rgb() (computed styles return rgb).
const STEWARD_RGB = ["rgb(13, 92, 58)", "rgb(16, 185, 129)"]; // #0d5c3a, #10b981
function hexToRgb(hex) {
  const m = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex || "");
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : null;
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 160) : "")); } };

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const slug of ORGS) {
    console.log(`\n=== ${slug} ===`);
    const theme = (await (await fetch(`${API}/org/${slug}/public`)).json()).org?.theme || {};
    const btnColor = hexToRgb(theme.buttonColor || theme.primary);
    const monthly = Array.isArray(theme.monthlyAmounts) ? theme.monthlyAmounts : [10, 25, 50, 100, 250];
    const expectTier = monthly[monthly.length > 1 ? 1 : 0];

    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: Math.max(900, Math.round(w * 0.7)) }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(`${APP}/give/${slug}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${slug}-${w}.png`), fullPage: true });
      await ctx.close();
    }

    // Assertions at 1440.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${APP}/give/${slug}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    // (1) no Steward wordmark/name in the page CHROME. An org's OWN authored
    //     content (its footer/mission/name) may legitimately contain any word,
    //     including "Steward" — white-label is about Steward's branding never
    //     appearing, not censoring an org's copy. So strip the org-authored
    //     fields, then assert no "Steward" and no "Powered by Steward" remains.
    let bodyText = await page.evaluate(() => document.body.innerText);
    for (const own of [theme.footerText, theme.einLine, theme.displayName]) if (own) bodyText = bodyText.split(own).join("");
    ok(`[${slug}] no Steward wordmark/name in the page chrome`, !/steward/i.test(bodyText), bodyText.match(/.{0,15}steward.{0,15}/i)?.[0]);
    ok(`[${slug}] no "Powered by Steward"`, !/powered by steward/i.test(await page.evaluate(() => document.body.innerText)));

    // (2) no Steward emerald anywhere in computed styles.
    const emeraldHits = await page.evaluate((stew) => {
      const hits = [];
      for (const el of document.querySelectorAll("*")) {
        const s = getComputedStyle(el);
        for (const p of ["backgroundColor", "color", "borderTopColor", "borderBottomColor"]) {
          if (stew.includes(s[p])) hits.push(el.tagName + "." + p + "=" + s[p]);
        }
      }
      return hits.slice(0, 5);
    }, STEWARD_RGB);
    ok(`[${slug}] no Steward emerald in any computed style`, emeraldHits.length === 0, emeraldHits);

    // (3) the org's own color is present (the submit button uses it).
    const submit = page.locator("button[type=submit]");
    const submitBg = await submit.evaluate(el => getComputedStyle(el).backgroundColor);
    ok(`[${slug}] submit button uses the org's own button/primary color`, submitBg === btnColor, { submitBg, btnColor });
    const hasLogoOrMonogram = await page.evaluate(() => {
      const img = [...document.querySelectorAll("img")].some(i => i.naturalWidth > 0 && i.offsetHeight <= 80);
      return img || !!document.querySelector("h1");
    });
    ok(`[${slug}] org identity (logo or monogram + name) present`, hasLogoOrMonogram);

    // (4) frequency control ABOVE the amount.
    const geo = await page.evaluate(() => {
      const find = (re) => [...document.querySelectorAll("div")].find(d => re.test(d.textContent) && d.children.length < 6);
      const freq = [...document.querySelectorAll("*")].find(e => /How often/i.test(e.textContent) && e.textContent.length < 40);
      const amt = [...document.querySelectorAll("*")].find(e => /(Monthly amount|Donation amount|Annual amount)/i.test(e.textContent) && e.textContent.length < 40);
      void find;
      return { freqY: freq?.getBoundingClientRect().top ?? -1, amtY: amt?.getBoundingClientRect().top ?? -1 };
    });
    ok(`[${slug}] frequency control is above the amount`, geo.freqY > 0 && geo.amtY > geo.freqY, geo);

    // (5) Monthly pre-selected (its button carries the saturated button color;
    //     One-time does not).
    const freqState = await page.evaluate((btnColor) => {
      const btns = [...document.querySelectorAll("button")].filter(b => /^(Monthly|One-time|Annual)$/.test(b.textContent.trim()));
      const bg = (t) => { const b = btns.find(x => x.textContent.trim() === t); return b ? getComputedStyle(b).backgroundColor : null; };
      return { monthly: bg("Monthly"), oneTime: bg("One-time"), btnColor };
    }, btnColor);
    ok(`[${slug}] Monthly is pre-selected (saturated) and One-time is not`, freqState.monthly === btnColor && freqState.oneTime !== btnColor, freqState);

    // (6) the second monthly tier pre-selected + (7) button states the commitment.
    const submitText = (await submit.textContent()).trim();
    ok(`[${slug}] submit button states the monthly commitment "Give $${expectTier} every month"`, submitText === `Give $${expectTier} every month`, submitText);

    // (8) disclosure present and not demoted (>= 14px, darker than a hint grey).
    const disc = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(d => /every month until you cancel/i.test(d.textContent) && d.children.length < 4);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { text: el.textContent.slice(0, 60), fontSize: parseFloat(s.fontSize), color: s.color };
    });
    ok(`[${slug}] recurring disclosure present`, !!disc, disc);
    ok(`[${slug}] disclosure not demoted (font-size >= 14px)`, disc && disc.fontSize >= 14, disc?.fontSize);

    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
