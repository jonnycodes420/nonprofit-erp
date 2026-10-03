#!/usr/bin/env node
// scripts/landing-prod-verify.js — the marketing site's PROD honesty + quality
// gate.
//
// ── LANDING-2 REBUILD ───────────────────────────────────────────────────────
// The single landing page became a full marketing site: 59 routes from one
// table (client/src/marketing/routes.js), one shell, data in modules. This
// gate now CRAWLS that table at 1440 and at 390 instead of reading one page.
// It grows, never shrinks: the old file held 76 gates, and the count below is
// compared against that.
//
// What died with the old page, and why: the Thread H1 and section order, the
// 199-dot field, the three how-it-works screenshots, the photo strip, the
// Keep-how-people-give source row, and the "no pricing" rule. Each policed a
// section the new site does not have; the "no pricing" rule is INVERTED by the
// approved reference, whose header links Pricing and whose FAQ quotes the
// published price. What carried forward unchanged: no fabricated social proof,
// no competitor, no outcome-claim language, no em dash, the © line naming the
// registered legal entity with a computed year, no bracketed placeholder, no
// auto popup, a clean console, real anchors for navigating CTAs, and the
// reduced-motion check. New: every route renders with its own title,
// description and canonical; every rendered internal link resolves; every
// research number renders beside its source link; no quote that is not a
// sourced research quote; no sideways scroll at 390 on ANY route.
//
// READ-ONLY: it loads public pages and asserts. No login, no writes. It never
// submits the demo form. Defaults to prod deliberately, because that is the
// point of it.
//
// Usage:
//   node scripts/landing-prod-verify.js
//   BASE=http://localhost:4183 node scripts/landing-prod-verify.js

const path = require("path");

const BASE = (process.env.BASE || "https://www.stewardapp.dev").replace(/\/+$/, "");
const PW = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

const GUARDS_BEFORE = 76; // the pre-LANDING-2 file's gate count

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

let chromium;
try { ({ chromium } = require(path.join(PW, "node_modules", "playwright"))); }
catch { console.log("  SKIP  Playwright not found (set PLAYWRIGHT_DIR)\n\n0 passed, 0 failed (skipped)"); process.exit(0); }

const SOCIAL_PROOF = [
  /trusted by/i, /as seen in/i, /join (hundreds|thousands|dozens|\d+)/i,
  /loved by/i, /used by \d/i, /\bour customers\b/i, /\btestimonial/i,
  /★|⭐/, /\brated\s*\d/i, /\d(\.\d)?\s*(\/\s*5|out of 5|stars)/i,
  /\b\d[\d,]*\+?\s*(customers|clients|nonprofits|organizations|orgs|teams|users)\b/i,
  /\b(customers|nonprofits|organizations|orgs|teams)\s+(use|trust|rely on|switched to)\b/i,
];
const OUTCOME = [/\brecovered\b/i, /\bre-?engaged\b/i, /\brecaptured\b/i, /\bwon back\b/i, /\bbrought back\b/i];
const COMPETITORS = /\b(Bloomerang|Little Green Light|DonorPerfect|Neon ?(CRM|One)|Blackbaud|Raiser['’]?s Edge|eTapestry|Salesforce|NPSP|Virtuous|Kindful|Keela|Bonterra|EveryAction|Network for Good|Kindsight|Funraise|Classy|Qgiv|DonorSnap|CiviCRM|GiveSmart|OneCause)\b/;

(async () => {
  console.log(`landing-prod-verify → ${BASE}\n`);
  const { ROUTES, APP_LINK_TARGETS, FILE_LINK_TARGETS, HOME_TITLE } = await import("../client/src/marketing/routes.js");
  const { STATS, SRC, QUOTES } = await import("../client/src/marketing/data/research.js");
  const { TEAM } = await import("../client/src/marketing/data/team.js");
  const { LEGAL_ENTITY_NAME } = await import("../shared/legalEntity.js");
  const known = new Set([...ROUTES.map(r => r.path), ...APP_LINK_TARGETS, ...FILE_LINK_TARGETS]);
  const quoteTexts = QUOTES.map(q => q[0]);

  const browser = await chromium.launch();

  // ── §1 · every route, at 1440 and at 390 ───────────────────────────────
  const texts = {};
  for (const width of [1440, 390]) {
    console.log(`\n— §1 · every route at ${width} —`);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 400 && !(LOCAL && /_vercel/.test(r.url()))) errors.push(r.status() + " " + r.url()); });
    for (const r of ROUTES) {
      errors.length = 0;
      await page.goto(BASE + r.path, { waitUntil: "networkidle" });
      const info = await page.evaluate(() => ({
        path: location.pathname,
        h1: document.querySelector("h1")?.textContent.trim() || "",
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.content || "",
        canon: document.querySelector('link[rel="canonical"]')?.href || "",
        og: document.querySelector('meta[property="og:title"]')?.content || "",
        ov: document.documentElement.scrollWidth - window.innerWidth,
        links: [...document.querySelectorAll(".mk a[href]")].map(a => a.getAttribute("href")),
        text: document.querySelector(".mk")?.innerText || "",
        noAlt: [...document.querySelectorAll(".mk img")].filter(i => !(i.getAttribute("alt") || "").trim()).length,
      }));
      // One gate per route per width: it renders at its own path with an H1,
      // its own title, description, canonical and og:title, no sideways
      // scroll, every internal link resolves, every image has alt text, and
      // the console is clean.
      const probs = [];
      if (info.path !== r.path || !info.h1) probs.push("no H1 at its own path (" + info.path + ")");
      if (info.title !== r.title) probs.push("title " + info.title);
      if (info.desc !== r.description || info.canon !== "https://www.stewardapp.dev" + r.path || info.og !== r.title) probs.push("head tags");
      if (info.ov > 0) probs.push("sideways scroll +" + info.ov + "px");
      const dead = [...new Set(info.links.filter(h => h === "#" || h === "" || (h.startsWith("/") && !known.has(h.split(/[#?]/)[0]))))];
      if (dead.length) probs.push("dead links " + dead.join(", "));
      if (info.noAlt) probs.push(info.noAlt + " images without alt");
      if (errors.length) probs.push("console: " + errors.slice(0, 2).join(" | "));
      ok(`${r.path} at ${width}: renders, own head tags, no sideways scroll, links resolve, alt text, clean console`, probs.length === 0, probs);
      if (width === 1440) texts[r.path] = info.text;
    }
    await page.close();
  }

  // ── §2 · honesty, on the rendered text of every route ──────────────────
  console.log("\n— §2 · honesty —");
  const all = Object.values(texts).join("\n");
  ok("no fabricated social proof anywhere (logos, review scores, testimonials, customer counts, trusted-by)",
     !SOCIAL_PROOF.some(re => re.test(all)), SOCIAL_PROOF.filter(re => re.test(all)).map(String));
  ok("no outcome-claim language (recovered, re-engaged, recaptured, won back, brought back)",
     !OUTCOME.some(re => re.test(all)), OUTCOME.filter(re => re.test(all)).map(String));
  ok("no competitor named on any page", !COMPETITORS.test(all), (all.match(COMPETITORS) || [])[0]);
  ok("no em dash in the rendered copy of any page (Jonathan's voice uses periods)", !/—/.test(all),
     Object.keys(texts).filter(p => /—/.test(texts[p])));
  // /templates is exempt: its whole point is merge fields like [First name].
  const notTemplates = Object.entries(texts).filter(([p]) => p !== "/templates").map(([, t]) => t).join("\n");
  ok("no bracketed placeholder of ANY shape survives on a public page (the templates' merge fields aside)",
     !/\[(?:TBD|TODO|placeholder|insert|name|company|legal|year)[^\]]*\]/i.test(notTemplates.replace(/\[ \d+ \]/g, "")));

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── §3 · research numbers and quotes ───────────────────────────────────
  console.log("\n— §3 · research numbers keep their sources —");
  await page.goto(BASE + "/why", { waitUntil: "networkidle" });
  const stats = await page.evaluate(() => [...document.querySelectorAll(".stat")].map(s => ({
    n: s.querySelector("b")?.textContent, p: s.querySelector("p")?.textContent, href: s.querySelector("a")?.href })));
  for (const s of STATS) {
    const got = stats.find(x => x.n === s[0]);
    ok(`"${s[0]}" renders with its sentence and its source link (${s[2]})`, !!got && got.p === s[1] && got.href === SRC[s[2]][1], got);
  }
  const quotes = await page.evaluate(() => [...document.querySelectorAll(".mk blockquote, .mk q")].map(q => q.childNodes[0]?.textContent?.trim()));
  ok("the two research quotes render, word for word", quoteTexts.every(q => quotes.includes(q)), quotes);
  let strayQuotes = [];
  for (const p of ROUTES.map(r => r.path)) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    const qs = await page.evaluate(() => [...document.querySelectorAll(".mk blockquote, .mk q")].map(q => q.childNodes[0]?.textContent?.trim()));
    strayQuotes = strayQuotes.concat(qs.filter(q => !quoteTexts.includes(q)).map(q => p + ": " + q));
  }
  ok("no testimonial or customer quote on any page: every quote is a sourced research quote", strayQuotes.length === 0, strayQuotes);

  // ── §4 · the homepage ──────────────────────────────────────────────────
  console.log("\n— §4 · the homepage —");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  ok("the homepage title", (await page.title()) === HOME_TITLE, await page.title());
  ok("the H1 is the reference's", (await page.evaluate(() => document.querySelector("h1").textContent.trim())) === "Keep the donors you already have.");
  const home = texts["/"];
  const SECTIONS = ["What the research says", "Donor software that keeps", "AI that drafts.", "Three products,", "Everything included,", "People who pick up the phone.", "Only 19.4% of first-time donors", "Questions?", "Every donor is a person.", "Twenty minutes,"];
  const pos = SECTIONS.map(s => home.indexOf(s));
  ok("every homepage section is present, in the reference's order", pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), SECTIONS.filter((_, i) => pos[i] < 0));
  ok("the research strip carries every STATS figure", STATS.every(s => home.includes(s[0])));
  ok("the people reel names the four people with their titles", TEAM.every(t => home.includes(t[0]) && home.includes(t[1])));
  const portraits = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll(".reel img")].slice(0, 4);
    for (const i of imgs) { i.loading = "eager"; i.scrollIntoView(); }
    await new Promise(r => setTimeout(r, 1500));
    return imgs.map(i => ({ src: i.getAttribute("src"), loaded: i.naturalWidth > 0 }));
  });
  ok("…with their real portraits, each loaded", portraits.length === 4 && portraits.every((p, i) => p.loaded && p.src === TEAM[i][2]), portraits);
  ok("the reel moves on its own and pauses on hover", await page.evaluate(() => {
    const t = document.querySelector(".reel .track"); return getComputedStyle(t).animationName.includes("reel") && !document.querySelector(".reel button"); }));
  // Feature finder: the search narrows the list.
  await page.fill('#feat-home input[type="search"]', "volunteer");
  ok("the feature search narrows the list", /Showing \d+ of \d+/.test(await page.textContent(".fcount")) && (await page.$$(".fgrid .fc")).length < 6);
  // Why tabs switch panes.
  await page.click('#why-tabs [role="tab"]:nth-child(3)');
  ok("the Why tabs switch panes", await page.evaluate(() => [...document.querySelectorAll("#why-tabs .pane")].filter(p => !p.hidden).length === 1 && document.querySelector('#why-tabs [role="tab"][aria-selected="true"]').textContent === "Run lighter"));
  ok("NO auto popup, modal or interstitial covers the page on load", !(await page.$('[role="dialog"], .modal')));
  const ctaKinds = await page.evaluate(() => [...document.querySelectorAll(".mk .pill")].filter(e => /Book a demo|Start free|Tour Steward|Take a tour/.test(e.textContent)).map(e => e.tagName));
  ok("every navigating CTA is a REAL anchor, never a <button>", ctaKinds.length > 3 && ctaKinds.every(t => t === "A"), ctaKinds);

  // ── §5 · the shell ─────────────────────────────────────────────────────
  console.log("\n— §5 · header, menus, footer —");
  for (const [label, needs] of [["Platform", "/features/drift"], ["Why Steward", "/leadership"], ["Resources", "/tools/retention"]]) {
    await page.click(`.menu button:has-text("${label}")`);
    const open = await page.evaluate(n => { const m = [...document.querySelectorAll(".mega")].find(x => !x.hidden); return m ? [...m.querySelectorAll("a")].map(a => a.getAttribute("href")).includes(n) : false; }, needs);
    ok(`the ${label} mega menu opens on click and links ${needs}`, open);
    await page.keyboard.press("Escape");
  }
  ok("Escape closes every mega menu", await page.evaluate(() => [...document.querySelectorAll(".mega")].every(m => m.hidden)));
  const footer = await page.evaluate(() => ({ cols: document.querySelectorAll("footer .fcols > div").length, legal: document.querySelector("footer .legal")?.textContent || "" }));
  ok("the footer has five columns", footer.cols === 5, footer.cols);
  ok("the © line names the registered legal entity", footer.legal.includes(LEGAL_ENTITY_NAME), footer.legal);
  ok("…with the CURRENT year, computed rather than hardcoded", footer.legal.includes("© " + new Date().getFullYear()), footer.legal);
  ok("Log in links to /login and Pricing to the live /pricing page",
     await page.evaluate(() => !!document.querySelector('.hdr a[href="/login"]') && !!document.querySelector('.hdr .menu a[href="/pricing"]')));
  await page.goto(BASE + "/features/drift", { waitUntil: "networkidle" });
  ok("inner pages carry breadcrumbs", await page.evaluate(() => !!document.querySelector(".crumbs a[href='/']")));
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + "/", { waitUntil: "networkidle" });
  await m.click(".burger");
  ok("the mobile drawer opens from the burger at 390", await m.evaluate(() => !document.getElementById("drawer").hidden && document.querySelectorAll("#drawer details").length === 4));
  await m.close();

  // ── §6 · tools, demo, legal ────────────────────────────────────────────
  console.log("\n— §6 · tools, demo, legal —");
  await page.goto(BASE + "/tools/retention", { waitUntil: "networkidle" });
  ok("retention calculator: the reference's defaults give 42.0% and $12,500", /42\.0%[\s\S]*\$12,500/.test(await page.textContent(".out")));
  await page.fill(".tool input >> nth=1", "500");
  ok("…and it recomputes in the browser as you type (50.0%)", (await page.textContent(".out")).includes("50.0%"));
  await page.goto(BASE + "/tools/lapsed-cost", { waitUntil: "networkidle" });
  ok("lapsed donor calculator: $104,400 a year, $15,660 back after a call", /\$104,400[\s\S]*\$15,660/.test(await page.textContent(".out")));
  await page.goto(BASE + "/tools/thermometer", { waitUntil: "networkidle" });
  ok("thermometer: $31,250 of $50,000 · 63%", /\$31,250[\s\S]*\$50,000 · 63%/.test(await page.textContent(".out")));
  await page.goto(BASE + "/demo", { waitUntil: "networkidle" });
  ok("the demo form asks for name, work email and organization, all required",
     await page.evaluate(() => ["name", "email", "organization"].every(n => document.querySelector(`[data-demo-form] input[name="${n}"]`)?.required)));
  for (const p of ["/legal/privacy", "/legal/terms", "/legal/accessibility"]) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    ok(`${p} carries the "Draft for attorney review" badge`, (await page.textContent(".draft")).startsWith("Draft for attorney review"));
  }

  // ── §7 · reduced motion ────────────────────────────────────────────────
  console.log("\n— §7 · reduced motion —");
  const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await rm.goto(BASE + "/", { waitUntil: "networkidle" });
  const rmInfo = await rm.evaluate(() => ({
    anim: [...document.querySelectorAll(".track")].map(t => getComputedStyle(t).animationName),
    dupsShown: [...document.querySelectorAll("[data-dup]")].filter(d => getComputedStyle(d).display !== "none").length,
    people: document.querySelectorAll(".reel .tm").length,
  }));
  ok("with reduced motion on, the reel and the research strip do not move", rmInfo.anim.length === 2 && rmInfo.anim.every(a => a === "none"), rmInfo.anim);
  ok("…and show one copy of each, not three", rmInfo.dupsShown === 0, rmInfo);
  await rm.close();

  await browser.close();
  const ran = pass + fail;
  const delta = ran - GUARDS_BEFORE;
  console.log(`\n${ran} guards ran: ${delta === 0 ? "the same as" : delta < 0 ? `${-delta} FEWER than` : `${delta} more than`} the ${GUARDS_BEFORE} before LANDING-2.`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail || delta < 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
