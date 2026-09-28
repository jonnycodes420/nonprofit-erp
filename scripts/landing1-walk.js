#!/usr/bin/env node
// LANDING-1 — THE WALK. SELF_REFUSING.
//
// The whole landing page at 1440 AND 390, against the six things the brief
// names, plus the two rules this page has always had:
//
//   1. the pricing cards are FIX-4's (Seed, Sapling, Orchard, Forest), and
//      the numbers are the ones `pricing.json` prices signup against
//   2. Volunteers says background checks are TRACKED, and Checkr appears
//      nowhere
//   3. Journeys is a live feature in Relationships, not "coming soon"
//   4. the Connections band is NOT solid emerald
//   5. the header is Relationships, Connections, Pricing, Lost & Found,
//      Book a call, Start now — and the Lost & Found band follows the
//      three promises
//   6. the founder and all three advisors are there, with their photos
//
//   · no invented social proof, ever
//   · no em dash in any copy on the page
//
//   APP_URL=http://localhost:4213 node scripts/landing1-walk.js
//
// Read-only: it opens a public page and looks at it. Loopback only anyway.

const path = require("path");

const APP = (process.env.APP_URL || "http://localhost:4213").replace(/\/+$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
  console.error(`Refusing to run: APP_URL must be loopback (got ${APP}).`); process.exit(1);
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const PRICING = require(path.join(__dirname, "..", "pricing.json"));
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "landing-1");
const IGNORE = /_vercel\/(insights|speed-insights)|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 420) : "")); } };

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) { console.error(`Playwright not found under ${PW_DIR}. This walk IS the browser half.`); process.exit(1); }

  const browser = await chromium.launch();
  const shots = [];
  const shot = async (p, n) => { const f = path.join(SHOTS, n + ".png"); await p.screenshot({ path: f, fullPage: false }); shots.push(f); };

  for (const width of [1440, 390]) {
    console.log(`\n— ${width} · the whole page —`);
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
      isMobile: width === 390, hasTouch: width === 390 });
    const page = await ctx.newPage();
    const errors = [];
    const missing = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 400 && !IGNORE.test(r.url())) missing.push(`${r.status()} ${r.url().replace(APP, "")}`); });

    await page.goto(APP + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const body = await page.locator("body").innerText();

    // ── 5 · the header ───────────────────────────────────────────────────
    const nav = await page.locator("nav.nav").innerText().catch(() => "");
    for (const label of ["Relationships", "Connections", "Pricing", "Lost & Found", "Book a call", "Start now"]) {
      ok(`${width}: the header has ${label}`, nav.includes(label), nav.replace(/\n/g, " ").slice(0, 160));
    }
    const lfHref = await page.locator("nav.nav a[href='/lost-and-found']").count();
    ok(`${width}: …and Lost & Found points at the tool`, lfHref >= 1, lfHref);

    // The three promises, then the Lost & Found band.
    const order = await page.evaluate(() => {
      const p = document.querySelector(".promises"), lf = document.querySelector("#lost-and-found");
      if (!p || !lf) return null;
      return { promises: p.getBoundingClientRect().top + window.scrollY,
               band: lf.getBoundingClientRect().top + window.scrollY,
               promiseCount: p.querySelectorAll(".promise").length };
    });
    ok(`${width}: three promises, and the Lost & Found band comes after them`,
       !!order && order.promiseCount === 3 && order.band > order.promises, order);
    const bandText = await page.locator("#lost-and-found").innerText().catch(() => "");
    ok(`${width}: …and the band is the $1,500 line with a button to the tool`,
       /A \$1,500 donor audit\. Free\./.test(bandText), bandText.replace(/\n/g, " ").slice(0, 120));
    ok(`${width}: …whose button goes to /lost-and-found`,
       await page.locator("#lost-and-found a[href='/lost-and-found']").count() >= 1);

    // ── 1 · the pricing cards are FIX-4's ────────────────────────────────
    const pricing = await page.locator("#pricing").innerText();
    for (const t of PRICING.tiers) {
      ok(`${width}: pricing names ${t.name}`, pricing.includes(t.name), pricing.slice(0, 120));
      ok(`${width}: …with ${t.band} under it`, pricing.includes(t.band));
      ok(`${width}: …at $${t.monthlyUsd} a month`, pricing.includes("$" + t.monthlyUsd.toLocaleString("en-US")));
    }
    ok(`${width}: …and Forest is the fourth`, pricing.includes(PRICING.talkToUs.name), pricing.slice(0, 200));
    ok(`${width}: the featured card is Sapling, where most land`,
       (await page.locator(".lp-tier.featured .lp-tier-name").innerText().catch(() => "")).trim() === "Sapling");
    ok(`${width}: the mockup's own pricing table is gone`,
       !/data-m=|tier-price strong/.test(await page.content()) || (await page.locator(".lp-tier").count()) === 3,
       await page.locator(".lp-tier").count());

    // The toggle moves the numbers, and the numbers are the JSON's.
    await page.locator("#pricing .toggle button[data-period='yearly']").click();
    await page.waitForTimeout(250);
    const yearly = await page.locator("#pricing").innerText();
    for (const t of PRICING.tiers) {
      ok(`${width}: yearly shows ${t.name} at $${t.yearlyUsd.toLocaleString("en-US")}`,
         yearly.includes("$" + t.yearlyUsd.toLocaleString("en-US")), yearly.slice(0, 200));
    }
    await page.locator("#pricing .toggle button[data-period='monthly']").click();
    await page.waitForTimeout(200);

    // ── 2 · background checks, not Checkr ────────────────────────────────
    ok(`${width}: CHECKR APPEARS NOWHERE on the page`, !/checkr/i.test(body), (body.match(/.{0,40}checkr.{0,40}/i) || [])[0]);
    ok(`${width}: Volunteers says checks are tracked, with a heads-up before one expires`,
       /Track background checks and get a heads-up before one expires\./.test(body));

    // ── 3 · Journeys is live ─────────────────────────────────────────────
    const rel = await page.locator("#relationships").innerText();
    ok(`${width}: Journeys is a feature in Relationships`, /Journeys/.test(rel), rel.replace(/\n/g, " ").slice(0, 200));
    ok(`${width}: …and it is not under "coming soon"`,
       !/Journeys[\s\S]{0,140}coming soon/i.test(body) && !/coming soon[\s\S]{0,140}Journeys/i.test(body));
    ok(`${width}: …and it names the first-year rhythm`, /first-year rhythm/i.test(rel), rel.replace(/\n/g, " ").slice(0, 240));

    // ── 4 · the Connections band is not solid emerald ────────────────────
    const conn = await page.evaluate(() => {
      const el = document.querySelector("#connections");
      if (!el) return null;
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || "");
      return { bg, r: m && +m[1], g: m && +m[2], b: m && +m[3] };
    });
    ok(`${width}: the Connections band is not emerald`,
       !!conn && !(conn.r === 13 && conn.g === 92 && conn.b === 58), conn);
    ok(`${width}: …and it is cream or white, not ink`, !!conn && conn.r > 200 && conn.g > 200, conn);
    const connText = await page.evaluate(() => {
      const el = document.querySelector("#connections .connection");
      return el ? { colour: getComputedStyle(el).color, text: el.innerText } : null;
    });
    ok(`${width}: …so the logo tiles read in ink, not white on colour`,
       !!connText && !/rgb\(255,\s*255,\s*255\)/.test(connText.colour), connText);

    // ── 6 · the founder and all three advisors ───────────────────────────
    const people = await page.locator("#founder").innerText().catch(() => "");
    ok(`${width}: the founder is there`, /Jonathan Atkinson/.test(people) && /Founder of Steward/.test(people));
    for (const [who, what] of [["Winfield Bevins", "Creo Arts"], ["Ross Jenkins", "Kingdom Legacy Collective"],
                               ["Brad Atkinson", "Asbury University"]]) {
      ok(`${width}: advisor ${who} is there, with ${what}`, people.includes(who) && people.includes(what), people.replace(/\n/g, " ").slice(0, 300));
    }
    const photos = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll("#founder img")) {
        out.push({ alt: img.alt, loaded: img.complete && img.naturalWidth > 0, src: img.getAttribute("src") });
      }
      return out;
    });
    ok(`${width}: the founder and three advisors all have a photo that LOADED`,
       photos.length === 4 && photos.every(p => p.loaded), photos);
    ok(`${width}: …and no photo credit is printed on the page`,
       !/photo(graph)? by|credit:|unsplash|pexels|getty/i.test(body), (body.match(/.{0,50}(photo by|credit:).{0,30}/i) || [])[0]);

    // ── the two standing rules ───────────────────────────────────────────
    ok(`${width}: NO EM DASH anywhere in the copy`, !body.includes("—"),
       (body.match(/.{0,60}—.{0,60}/) || [])[0]);
    ok(`${width}: no invented social proof`,
       !/trusted by|\d+\+? nonprofits use|customers love|testimonial|★|rated \d/i.test(body),
       (body.match(/.{0,50}(trusted by|rated \d).{0,30}/i) || [])[0]);

    // ── it works ─────────────────────────────────────────────────────────
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: no horizontal scroll`, noScroll <= 0, noScroll);
    ok(`${width}: every asset loaded`, missing.length === 0, missing.slice(0, 5));
    ok(`${width}: nothing on fire`, errors.length === 0, errors.slice(0, 3));

    // The Agent demo on the page actually works.
    if (width === 1440) {
      await page.locator("[data-decision='accepted']").click();
      await page.waitForTimeout(300);
      const after = await page.locator("#approvalResult").innerText().catch(() => "");
      ok("1440: the Agent demo accepts, and says what happened",
         /Accepted/.test(after) && /ready to appear on Marisol's record/.test(after), after.replace(/\n/g, " "));
      await page.locator("#reviewAgain").click();
      await page.waitForTimeout(300);
      ok("1440: …and Review again puts it back", await page.locator("#approvalPrompt").count() === 1);
    }

    // The whole page, top to bottom.
    await shot(page, `landing-top-${width}`);
    const full = path.join(SHOTS, `landing-full-${width}.png`);
    await page.screenshot({ path: full, fullPage: true });
    shots.push(full);
    for (const id of ["lost-and-found", "relationships", "growth", "connections", "volunteers", "pricing"]) {
      await page.locator("#" + id).scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(350);
      await shot(page, `landing-${id}-${width}`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\nlanding1-walk — ${pass} passed, ${fail} failed`);
  if (shots.length) console.log(`screenshots: ${shots.length} in ${SHOTS}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
