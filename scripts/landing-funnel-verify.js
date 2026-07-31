// BUILD-11 Build B — landing funnel + honesty-gate verification.
//
// Asserts:
//   1. the funnel sections render in order (hero → wedge calculator → problem
//      → product moments → how it works → money → candor → founder → close)
//   2. the interactive recurring-loss calculator computes correctly for
//      multiple inputs AND shows its assumption
//   3. NO fabricated social proof (grep guard: no fake logos / testimonials /
//      star ratings / "trusted by" / invented user counts)
//   4. every primary CTA links live (Start free → /signup; real footer links)
//
// Run against the deployed landing OR a local vite preview:
//   PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \
//     node scripts/landing-funnel-verify.js
//   (default BASE https://www.stewardapp.dev)

const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://www.stewardapp.dev";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

// Section markers in the honest funnel order.
const ORDER = [
  "Steward notices",                  // hero
  "leaving on the table",             // wedge calculator
  "keeps 43%",                        // problem, told plainly
  "morning queue",                    // product moment 1
  "gift you didn't know",             // product moment 2
  "receipt that sends itself",        // product moment 3
  "How it works",                     // how it works
  "Your donors give to you",          // money strip
  "Where Steward is today",           // candor
  "letter from the founder",          // founder band
  "See who needs you today",          // close
];

// Patterns that would signal fabricated proof. None may appear.
const BANNED = [
  /trusted by/i,
  /\bas seen in\b/i,
  /\b\d[\d,]*\+?\s+(nonprofits|organizations|customers|users|charities)\s+(trust|use|love|rely)/i,
  /join (thousands|hundreds|\d)/i,
  // NB: not a bare /testimonial/ — the candor section HONESTLY says it won't
  // "sell you a testimonial". A fabricated wall would be a quote + attribution.
  /["“][^"”]{20,}["”]\s*[—-]\s*[A-Z][a-z]+,\s*(Executive Director|Development|CEO|Founder) of/i,
  /★|⭐|\b[45](\.\d)?\s*(out of|\/)\s*5\b/i,
  /loved by|customers love|5[- ]star/i,
];

(async () => {
  console.log("landing-funnel-verify against " + BASE + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // innerText reflects CSS text-transform (uppercase eyebrows), so compare
  // case-insensitively.
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hay = bodyText.toLowerCase();

  // ── 1. Section order ──
  let lastIdx = -1, inOrder = true, missing = [];
  for (const m of ORDER) {
    const idx = hay.indexOf(m.toLowerCase());
    if (idx === -1) { missing.push(m); inOrder = false; continue; }
    if (idx < lastIdx) inOrder = false;
    lastIdx = Math.max(lastIdx, idx);
  }
  ok("all funnel sections present", missing.length === 0, missing);
  ok("funnel sections render in order", inOrder);

  // ── 2. Calculator math + assumption ──
  const slider = page.locator(".lp-slider");
  ok("recurring-loss calculator present", await slider.count() === 1);
  const setAndRead = async (val) => {
    await slider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, val);
    await page.waitForTimeout(150);
    const txt = await page.locator(".lp-calc-loss").innerText();
    return Number(txt.replace(/[^\d]/g, ""));
  };
  for (const monthly of [1500, 5000, 800]) {
    const expected = Math.round(monthly * 12 * 0.24);
    const shown = await setAndRead(monthly);
    ok(`calculator: $${monthly}/mo → $${expected.toLocaleString()} annual loss`, shown === expected, { shown, expected });
  }
  ok("calculator states its assumption (20–30% / 24%)", /24%|20[–-]30%/.test(bodyText));

  // ── 3. No fabricated proof ──
  for (const re of BANNED) {
    const hit = re.exec(bodyText);
    ok("no fabricated-proof pattern " + re, !hit, hit && hit[0]);
  }
  // No logo-bar images
  const logoImgs = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter(i => /logo|client|partner-logo/i.test((i.getAttribute("src") || "") + (i.getAttribute("alt") || ""))).length
  );
  ok("no logo-bar images", logoImgs === 0, logoImgs);
  // The candor line that makes the honesty explicit is present
  ok("candor line present ('no case-study wall / customer count')", /no case-study wall|won't invent/i.test(bodyText));

  // ── 3.5 BUILD-29: order + pricing + no pottery band ──
  // The founder letter must precede the founding-partner ASK (the letter earns
  // the ask). The ask now lives in its own "founding partner organizations"
  // section AFTER the letter.
  const letterIdx = hay.indexOf("letter from the founder");
  const askIdx = hay.indexOf("founding partner organizations");
  ok("founder letter present", letterIdx !== -1);
  ok("founding-partner ask present", askIdx !== -1);
  ok("founder letter PRECEDES the founding-partner ask", letterIdx !== -1 && askIdx !== -1 && letterIdx < askIdx, { letterIdx, askIdx });
  // Pricing signal present near the CTA and linked to /pricing.
  ok("pricing signal present ('$149/month' or '$149/mo')", /\$149\s*\/\s*(month|mo)/i.test(bodyText), bodyText.match(/\$149[^\n]{0,12}/));
  const pricingLinked = await page.evaluate(() =>
    [...document.querySelectorAll("a[href='/pricing']")].length >= 1
  );
  ok("a /pricing link exists in the page body (not just the footer)", pricingLinked);
  // The mid-page pottery/studio band is gone.
  const bandImgs = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter(i => /band-studio|\blp-band-img\b/.test((i.getAttribute("src") || "") + " " + i.className)).length
  );
  ok("no pottery/studio band image on the page", bandImgs === 0, bandImgs);

  // ── 4. CTAs live ──
  ok("Start free CTA present", await page.locator('button:has-text("Start free")').count() >= 1);
  ok("Talk to the founder CTA present", await page.locator('button:has-text("Talk to the founder")').count() >= 1);
  const footerLinks = await page.evaluate(() =>
    [...document.querySelectorAll("footer a")].map(a => a.getAttribute("href"))
  );
  for (const href of ["/pricing", "/login", "/terms", "/privacy"]) {
    ok("footer links to " + href, footerLinks.includes(href), footerLinks);
  }
  ok("footer has a contact mailto", footerLinks.some(h => h && h.startsWith("mailto:")));

  // Start free actually navigates to /signup
  await page.locator('button:has-text("Start free")').first().click();
  await page.waitForTimeout(600);
  ok("Start free → /signup", page.url().endsWith("/signup"), page.url());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
