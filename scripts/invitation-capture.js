// Invitation pivot (2026-08-06) — live drive + DSF3 screenshots.
//
// Drives the REAL flow end to end against a local preview + scratch server
// (the committed tests/invitation.test.js covers the API contract; this
// exercises the browser path a real visitor takes):
//   1. /invitation renders (ink page, form, labels above fields)
//   2. filling and submitting the form (after the 3s minimum-fill window)
//      lands a row via POST /invitation-request and swaps the form for the
//      in-place success state ("Thank you — that's with me.")
//   3. the landing's on-page invitation section renders the same form
//   4. /pricing shows the future-tense founding-partner framing and its
//      unauthed CTA points at /invitation
//
// Setup (memory-recipe stack):
//   client: VITE_API_URL=http://localhost:5601 npx vite build && npx vite preview --port 4173
//   server: booted with CORS_ORIGIN=http://localhost:4173 (+ the tests/run-all.sh env)
// Run:
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4173 \
//     OUT=docs/invitation-2026-08-06 node scripts/invitation-capture.js

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:4173";
const OUT = process.env.OUT || "docs/invitation-capture";
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

(async () => {
  console.log("invitation-capture against " + BASE + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3 });

  // ── 1. /invitation renders ──
  await page.goto(BASE + "/invitation", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  ok("/invitation renders the form", await page.locator("#invitation form").count() === 1);
  ok("headline present", (await page.locator("#invitation h2").innerText()).includes("who to call today"));
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("#invitation form label > span")].map(s => s.innerText.trim())
  );
  ok("labels rendered above fields (never placeholder-only)", labels.length >= 5, labels);
  await page.screenshot({ path: path.join(OUT, "invitation-page.png"), fullPage: true });

  // ── 2. fill + submit → success state in place ──
  const email = `capture+${Date.now()}@example.org`;
  const fill = async (label, value) => {
    const input = page.locator(`#invitation form label:has-text("${label}") input, #invitation form label:has-text("${label}") textarea`);
    await input.first().fill(value);
  };
  await fill("Your name", "Capture Test");
  await fill("Email", email);
  await fill("Organization", "Capture Arts Collective");
  await fill("Your role", "Development Director");
  await page.locator("#invitation form select").selectOption({ label: "500–2,500" });
  await fill("hardest part", "Knowing who is drifting.");
  // Respect the minimum-fill window (a sub-3s submit is silently dropped as a bot).
  await page.waitForTimeout(3200);
  await page.locator('#invitation button[type="submit"]').click();
  await page.waitForSelector('#invitation [role="status"]', { timeout: 8000 });
  const success = await page.locator('#invitation [role="status"]').innerText();
  ok("success state replaces the form in place", success.includes("that's with me"));
  ok("success state keeps the honest 'I might say no' line", /honestly/.test(success));
  ok("form is gone after success", await page.locator("#invitation form").count() === 0);
  await page.screenshot({ path: path.join(OUT, "invitation-success.png"), fullPage: false });

  // ── 3. the landing carries the same section ──
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  ok("landing renders the invitation section", await page.locator("#invitation form").count() === 1);
  const sect = page.locator("#invitation");
  await sect.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await sect.screenshot({ path: path.join(OUT, "landing-invitation-section.png") });

  // ── 4. pricing page framing + CTA ──
  await page.goto(BASE + "/pricing", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const pricingText = await page.evaluate(() => document.body.innerText);
  ok("pricing carries the future-tense framing", /invitation-only/i.test(pricingText) && /lock in below/i.test(pricingText));
  ok("pricing shows published prices ($149/$299)", /\$149/.test(pricingText) && /\$299/.test(pricingText));
  const ctas = await page.evaluate(() =>
    [...document.querySelectorAll('a[href="/invitation"], button')].map(e => e.innerText.trim()).filter(t => /request an invitation/i.test(t))
  );
  ok("pricing CTAs say 'Request an invitation'", ctas.length >= 2, ctas);
  ok("pricing has no 'Start free trial' CTA", !/start free trial/i.test(pricingText));
  await page.screenshot({ path: path.join(OUT, "pricing-future-tense.png"), fullPage: true });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — screenshots in ${OUT}/`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
