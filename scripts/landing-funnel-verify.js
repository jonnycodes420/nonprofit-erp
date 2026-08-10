// BUILD-11 Build B — landing funnel + honesty-gate verification.
//
// Asserts:
//   1. the funnel sections render in order (hero → wedge calculator → problem
//      → product moments → how it works → money → close). The candor and
//      founder-letter sections were removed in BUILD-49.
//   2. the interactive recurring-loss calculator computes correctly for
//      multiple inputs AND shows its assumption (29% / M+R Benchmarks — the
//      primary-sourced rate, 2026-08-06; never the unsourced "widely-cited
//      20–30%")
//   3. NO fabricated social proof (grep guard: no fake logos / testimonials /
//      star ratings / "trusted by" / invented user counts)
//   4. every primary CTA is "Start free" → /signup (BUILD-49 reopened public
//      self-serve signup; the /invitation route is kept but NOT linked from the
//      landing, and no "invitation-only"/founding-partner copy remains)
//   5. the stat attribution is the PRIMARY source (Fundraising Effectiveness
//      Project), never a competitor's republication
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
    const expected = Math.round(monthly * 12 * 0.29);
    const shown = await setAndRead(monthly);
    ok(`calculator: $${monthly}/mo → $${expected.toLocaleString()} annual loss`, shown === expected, { shown, expected });
  }
  ok("calculator states its assumption (29% / 71% retention)", /29%/.test(bodyText) && /71%/.test(bodyText));
  ok("calculator cites its primary source (M+R Benchmarks)", /M\+R Benchmarks/.test(bodyText));
  ok("the unsourced 'widely-cited' hedge is gone", !/widely[- ]cited/i.test(bodyText));

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
  // ── 3.5 BUILD-49: candor + founder-letter sections removed; no pottery band ──
  ok("candor 'Where Steward is today' section removed", !/where steward is today/i.test(bodyText));
  ok("founder-letter section removed", !/letter from the founder/i.test(bodyText) && !/why i built steward/i.test(bodyText));
  ok("unverified 'load-tested to 25,000' claim removed", !/load[- ]tested to 25,000/i.test(bodyText));
  // The stat attribution is the primary source, never a competitor.
  ok("43% stat attributed to the Fundraising Effectiveness Project", /fundraising effectiveness project/i.test(bodyText));
  ok("no competitor attribution (Bloomerang)", !/bloomerang/i.test(bodyText));
  // "Keep 100%" was an overclaim (Stripe's processing fee still applies).
  ok("no 'keep 100%' overclaim", !/keep 100%|100% of every gift/i.test(bodyText));
  // Pricing signal present on the page and linked to /pricing. (Post-BUILD-49
  // the $149 lives in the money strip: "$149 or $299 a month, flat.")
  ok("pricing signal present ('$149')", /\$149\b/.test(bodyText), bodyText.match(/\$149[^\n]{0,16}/));
  const pricingLinked = await page.evaluate(() =>
    [...document.querySelectorAll("a[href='/pricing']")].length >= 1
  );
  ok("a /pricing link exists in the page body (not just the footer)", pricingLinked);
  // The mid-page pottery/studio band is gone.
  const bandImgs = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter(i => /band-studio|\blp-band-img\b/.test((i.getAttribute("src") || "") + " " + i.className)).length
  );
  ok("no pottery/studio band image on the page", bandImgs === 0, bandImgs);

  // ── 4. CTAs live + public signup reopened (BUILD-49) ──
  ok("'Start free' CTA present", await page.locator('button:has-text("Start free")').count() >= 1);
  ok("Talk to the founder CTA present", await page.locator('button:has-text("Talk to the founder")').count() >= 1);
  // The invitation funnel is de-linked from the landing: no invitation CTA, no
  // invitation-only / founding-partner copy, no link to /invitation.
  ok("no 'Request an invitation' CTA on the landing", await page.locator('button:has-text("Request an invitation")').count() === 0);
  ok("no 'invitation-only' copy", !/invitation-only/i.test(bodyText));
  ok("no 'founding partner' / 'five founding' copy", !/founding partner|five founding/i.test(bodyText));
  const invLinks = await page.evaluate(() => [...document.querySelectorAll('a[href*="/invitation"]')].length);
  ok("no link to /invitation from the landing", invLinks === 0, invLinks);
  const footerLinks = await page.evaluate(() =>
    [...document.querySelectorAll("footer a")].map(a => a.getAttribute("href"))
  );
  for (const href of ["/pricing", "/login", "/terms", "/privacy"]) {
    ok("footer links to " + href, footerLinks.includes(href), footerLinks);
  }
  ok("footer has a contact mailto", footerLinks.some(h => h && h.startsWith("mailto:")));

  // The nav CTA actually navigates to /signup
  await page.locator('button:has-text("Start free")').first().click();
  await page.waitForTimeout(600);
  ok("Start free → /signup", page.url().endsWith("/signup"), page.url());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
