#!/usr/bin/env node
// FIN-1 — THE WALK. SELF_REFUSING.
//
// Every Finance screen on Harborlight, at 1440 AND 390. What it is actually
// checking, beyond "it draws":
//
//   · FIVE tabs, not eight, and every old view still reachable underneath
//   · the four figures OPEN, and the rows say out loud that they foot
//   · a bar opens its gifts
//   · "Needs you" names things to do, not problems
//   · every fund card says where its restriction came from
//   · NO DARK GROUND anywhere on any Finance screen
//   · the month-close checklist, and the export flavours
//
//   BASE=http://localhost:5621 APP_URL=http://localhost:4193 node scripts/fin1-walk.js
//
// Read-only against the product: it opens screens and reads numbers. It is
// still loopback-only, because a walk that logs in as a real admin on a
// production URL is a walk nobody should be able to run by accident.

const path = require("path");

const BASE = (process.env.BASE || "http://localhost:5621").replace(/\/+$/, "");
const APP = (process.env.APP_URL || "http://localhost:4193").replace(/\/+$/, "");
for (const [name, url] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run: ${name} must be loopback (got ${url}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.PASSWORD || "demo-harbor-2026";
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "fin-1");
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 400) : "")); }
};
const api = async (p, token) => {
  const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + token } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// Is this element a dark GROUND? Three things this deliberately does NOT
// count, each of which the first version of this walk flagged on a page
// that was already correct:
//   · TRANSPARENT. rgba(…, 0) reads as rgb(0,0,0) to a naive check, and
//     that is how the FIX-4 walk failed a page that was fine.
//   · A BUTTON OR A LINK. Ink is one of the four colours and a filled ink
//     button is the design system, not a ground.
//   · A TINT. rgba(15,26,18,0.12) behind a badge is a light wash; the
//     alpha has to be near 1 for it to be a ground at all.
// What is left is what the brief means: a large block of dark painted
// behind content. "Large" is a quarter of the content column, because a
// ground is the thing you see before you see anything on it.
const DARK_JS = `(el) => {
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "SVG" || tag === "PATH") return null;
  if (el.closest("button") || el.closest("a")) return null;
  const c = getComputedStyle(el).backgroundColor;
  const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(c || "");
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (alpha < 0.9) return null;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  if (!(r < 90 && g < 90 && b < 90)) return null;
  const main = document.querySelector(".app-content");
  const area = el.getBoundingClientRect().width * el.getBoundingClientRect().height;
  const mainArea = main ? main.getBoundingClientRect().width * main.getBoundingClientRect().height : 0;
  if (!mainArea || area < mainArea * 0.25) return null;
  return c + " (" + Math.round(area / mainArea * 100) + "% of the column)";
}`;

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) { console.error(`Playwright not found under ${PW_DIR}. This walk IS the browser half.`); process.exit(1); }

  const login = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!login.token) { console.error("Could not sign in: " + JSON.stringify(login).slice(0, 200)); process.exit(1); }
  const token = login.token;
  const AUTH = [token, JSON.stringify(login.user || {}), JSON.stringify(login.org || {})];

  // ── The server half, first: the figures must FOOT before any screen is
  // worth looking at. A screen showing a number that does not foot is a
  // screen that looks fine.
  console.log("— the figures foot —");
  const ov = await api("/finance/overview", token);
  ok("the overview answers", ov.status === 200, ov.status);
  ok("…with four figures", (ov.body.figures || []).length === 4, (ov.body.figures || []).map(f => f.key));
  for (const f of ov.body.figures || []) {
    const rows = await api(`/finance/overview/rows?rows=${f.key}`, token);
    ok(`${f.label} opens its rows, and they foot to the cent`, rows.body.foots === true,
       { key: f.key, sentence: rows.body.sentence });
    ok(`…and ${f.label} carries its one defining sentence`,
       typeof f.definition === "string" && f.definition.length > 40, f.definition);
  }
  const funds = await api("/finance/funds-detail", token);
  ok("every fund says whether it is restricted, in a sentence",
     (funds.body.funds || []).length > 0 && funds.body.funds.every(f => /^(Restricted|Unrestricted)\./.test(f.sentence)),
     (funds.body.funds || []).map(f => f.sentence.slice(0, 50)));
  ok("…and a restricted fund names the grant or the donors that restricted it",
     (funds.body.funds || []).filter(f => f.restricted).every(f => /it came from/.test(f.sentence) || !f.restrictedBy.length),
     (funds.body.funds || []).filter(f => f.restricted).map(f => f.sentence.slice(0, 90)));
  ok("…and at least one restricted fund actually holds money (the demo answers the question)",
     (funds.body.funds || []).some(f => f.restricted && f.balanceCents > 0),
     (funds.body.funds || []).map(f => [f.name, f.restricted, f.balance]));

  const browser = await chromium.launch();
  const shots = [];
  const shot = async (page, n) => { const f = path.join(SHOTS, n + ".png"); await page.screenshot({ path: f }); shots.push(f); };

  for (const width of [1440, 390]) {
    console.log(`\n— ${width} · every Finance screen —`);
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
                                            isMobile: width === 390, hasTouch: width === 390 });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, AUTH);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });

    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Finance\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-fin-strip]", { timeout: 12000 }).catch(() => {});

    const tabs = await page.locator("[data-fin-strip] button").allTextContents();
    ok(`${width}: FIVE tabs, not eight`, tabs.length === 5, tabs);
    ok(`${width}: …and they are the five the brief names`,
       ["Overview", "Funds", "Deposits and payouts", "Grants money", "Exports"].every(l => tabs.some(t => t.includes(l))), tabs);
    const title = await page.locator("h1, [data-testid='page-title']").first().innerText().catch(() => "");
    ok(`${width}: the title is "Your money."`, /Your\s*money\./i.test(title.replace(/\s+/g, " ")), title);

    // Walk every section, and every part inside it.
    const sections = await page.locator("[data-fin-strip] button").count();
    let partsSeen = 0;
    for (let i = 0; i < sections; i++) {
      await page.locator("[data-fin-strip] button").nth(i).click();
      await page.waitForTimeout(900);
      const secName = (await page.locator("[data-fin-strip] button").nth(i).innerText()).trim();
      const question = await page.locator("[data-fin-strip] ~ div").first().innerText().catch(() => "");
      ok(`${width}: ${secName} asks a question`, /\?/.test(question), question.slice(0, 80));

      const parts = await page.locator("[data-fin-part]").count();
      for (let j = 0; j < Math.max(1, parts); j++) {
        if (parts) { await page.locator("[data-fin-part]").nth(j).click(); await page.waitForTimeout(800); }
        partsSeen++;
        const state = await page.evaluate(() => {
          const main = document.querySelector(".app-content") || document.body;
          return { text: (main.innerText || "").trim().length,
                   boundary: /Something went wrong|An error occurred in this part/i.test(main.innerText || "") };
        });
        const part = parts ? (await page.locator("[data-fin-part]").nth(j).innerText()).trim() : secName;
        ok(`${width}: ${secName} · ${part} draws something`, state.text > 40, state);
        ok(`${width}: ${secName} · ${part} has no error boundary`, !state.boundary);

        // NO DARK GROUND, anywhere on any Finance screen. Every element
        // inside the content column is asked, not just the root.
        const dark = await page.evaluate((js) => {
          const isDark = eval(js);
          const main = document.querySelector(".app-content");
          if (!main) return [];
          const out = [];
          for (const el of main.querySelectorAll("*")) {
            const c = isDark(el);
            if (c) out.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 40), bg: c,
                              txt: (el.innerText || "").slice(0, 30) });
            if (out.length > 4) break;
          }
          return out;
        }, DARK_JS);
        ok(`${width}: ${secName} · ${part} has no dark green ground`, dark.length === 0, dark);
        // Shoot the FIRST part of each section: the loop ends on the LAST
        // one, so shooting after it captured Transactions under a heading
        // that says Overview.
        if (width === 1440 && j === 0) await shot(page, `finance-${secName.toLowerCase().replace(/[^a-z]+/g, "-")}-1440`);
      }
    }
    ok(`${width}: every old view is still reachable as a part`, partsSeen >= 8, partsSeen);

    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: Finance does not scroll sideways`, noScroll <= 0, noScroll);

    // ── The Overview's own behaviour, at 1440.
    if (width === 1440) {
      await page.locator("[data-fin-strip] button").first().click();
      await page.waitForTimeout(700);
      await page.waitForSelector("[data-testid='fin-overview']", { timeout: 8000 }).catch(() => {});
      const figs = await page.locator("[data-testid^='fin-figure-']").count();
      ok("1440: the four figures are on screen", figs === 4, figs);

      await page.locator("[data-testid='fin-figure-moneyInThisMonth']").click();
      await page.waitForTimeout(900);
      const sentence = await page.locator("[data-testid='fin-rows-sentence']").innerText().catch(() => "");
      ok("1440: a figure opens its rows, and the rows SAY they foot",
         /add up to the figure, to the cent/.test(sentence), sentence);
      await shot(page, "finance-figure-open-1440");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);

      const bars = await page.locator("[data-testid^='fin-bar-']").count();
      ok("1440: twelve months of bars, empty months included", bars === 12, bars);
      await page.locator("[data-testid^='fin-bar-']").last().click();
      await page.waitForTimeout(900);
      const monthRows = await page.locator("[data-testid='fin-rows-sentence']").innerText().catch(() => "");
      ok("1440: a bar opens the gifts behind it", /gifts? in \d{4}-\d{2}/.test(monthRows), monthRows);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);

      const needs = await page.locator("[data-testid^='fin-needs-']").count();
      ok("1440: Needs you names things to do", needs > 0, needs);
      const needsText = needs ? await page.locator("[data-testid^='fin-needs-']").first().innerText() : "";
      ok("…each one a sentence, not a code", /\. /.test(needsText) || /\.$/.test(needsText.trim()), needsText.slice(0, 120));

      // Funds cards.
      await page.locator("[data-fin-strip] button").nth(1).click();
      await page.waitForTimeout(900);
      const cards = await page.locator("[data-testid='fin-fund-card']").count();
      ok("1440: one card per fund", cards >= 3, cards);
      await page.locator("[data-testid='fin-fund-card']").first().click();
      await page.waitForTimeout(900);
      const fundRows = await page.locator("body").innerText();
      ok("1440: a fund card opens its transactions", /net\. This is every row behind that balance|Nothing has moved/.test(fundRows), fundRows.slice(0, 200));
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, "finance-funds-cards-1440");

      // Exports: the checklist and the flavours.
      await page.locator("[data-fin-strip] button").nth(4).click();
      await page.waitForTimeout(1100);
      const openCount = await page.locator("[data-testid='close-open-count']").count();
      ok("1440: the month-close checklist is on Exports", openCount === 1, openCount);
      const items = await page.locator("[data-testid^='close-item-']").count();
      ok("…with five things on it", items === 5, items);
      const flav = await page.locator("[data-testid='bookkeeper-flavours']").count();
      ok("…and the QuickBooks and Xero column sets are named", flav === 1, flav);
      const flavText = flav ? await page.locator("[data-testid='bookkeeper-flavours']").innerText() : "";
      ok("…honestly: neither has been run through a real import", /check the first file/.test(flavText), flavText.slice(0, 200));
      await shot(page, "finance-exports-1440");
    }

    if (width === 390) await shot(page, "finance-390");
    ok(`${width}: nothing on fire in Finance`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  console.log(`\nfin1-walk — ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
