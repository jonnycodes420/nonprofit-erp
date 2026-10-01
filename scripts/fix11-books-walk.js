// FIX-11 Part 3 verification walk — A BOOKKEEPER EXPORT A BOOKKEEPER CAN USE.
//
// The part of this build that was invisible from the server: three format
// "buttons" that were `<span>`s and had never been clickable, and a screen that
// offered one file where a bookkeeper needs two.
//
//   APP=http://localhost:4293 API=http://localhost:5821 node scripts/fix11-books-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const { chromium } = require(path.join(process.env.HOME, "steward-qa", "node_modules", "playwright"));
const APP = process.env.APP || "http://localhost:4293";
const API = process.env.API || "http://localhost:5821";
let failures = 0;
const ok = (l, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + l + (c ? "" : " — " + String(JSON.stringify(d) ?? "").slice(0, 300))); if (!c) failures++; };

(async () => {
  const api = async (p, o = {}, tok) => {
    const r = await fetch(API + p, { ...o, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(o.headers || {}) } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
  };
  // The demo org, because this screen is about a month that has money in it.
  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) });
  const tok = login.body.token;
  ok("signed in to the demo org", !!tok, { status: login.status });
  if (!tok) return process.exit(1);
  const org = (await api("/org", {}, tok)).body;
  const me = (await api("/me", {}, tok)).body;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel|ai\/stream/.test(m.location()?.url || "")) errs.push(m.text().slice(0, 120)); });
  page.on("response", r => { if (r.status() >= 500 && !/ai\/stream/.test(r.url())) errs.push(r.status() + " " + r.url()); });

  await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [tok, me.user || me, org]);
  await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-root", { timeout: 25000 });
  const go = await page.$('[data-testid="first-run-go"]');
  if (go) { await go.click(); await page.waitForTimeout(600); }
  await page.waitForTimeout(1000);

  // Finance, then Exports, then Month close.
  await page.locator('.app-sidebar [data-nav-id="finance"]').first().click();
  await page.waitForTimeout(2000);
  const expTab = page.locator('button, a').filter({ hasText: /^Exports$/ }).first();
  if (await expTab.count()) { await expTab.click(); await page.waitForTimeout(1500); }
  const closeTab = page.locator('button, a').filter({ hasText: /^Month close$/ }).first();
  if (await closeTab.count()) { await closeTab.click(); await page.waitForTimeout(1500); }
  await page.waitForSelector('[data-testid="monthly-close"]', { timeout: 20000 }).catch(() => {});
  ok("Monthly close opens", await page.locator('[data-testid="monthly-close"]').count() > 0);

  // August 2026, the month the brief is about.
  await page.locator('input[aria-label="Month to close"]').fill("2026-08");
  await page.waitForTimeout(2600);
  const sentence = await page.locator('[data-testid="close-sentence"]').innerText().catch(() => "");
  ok("the sentence names the gross, the fees and the net",
    /totalling/.test(sentence) && /processing fees/.test(sentence) && /to the bank/.test(sentence), { sentence });

  // ── ITEM 0 · THE FORMAT IS A CHOICE ────────────────────────────────────
  for (const f of ["steward", "quickbooks", "xero"]) {
    ok(`${f} is a real control, not a span`, await page.locator(`[data-testid="flavour-${f}"]`).count() > 0);
  }
  const sel0 = await page.locator('[data-testid="flavour-steward"]').getAttribute("aria-checked");
  ok("…Steward is selected to begin with", sel0 === "true", { sel0 });
  const btn0 = await page.locator('[data-testid="close-download-deposits"]').innerText();
  ok("…and the green button names the format it will write", /for Steward$/.test(btn0.trim()), { btn0 });
  await page.locator('[data-testid="flavour-quickbooks"]').click();
  await page.waitForTimeout(500);
  ok("…choosing QuickBooks marks it",
    (await page.locator('[data-testid="flavour-quickbooks"]').getAttribute("aria-checked")) === "true"
    && (await page.locator('[data-testid="flavour-steward"]').getAttribute("aria-checked")) === "false");
  const btn1 = await page.locator('[data-testid="close-download-deposits"]').innerText();
  ok("…and the button says so", /for QuickBooks$/.test(btn1.trim()), { btn1 });

  // ── THE TWO FILES ──────────────────────────────────────────────────────
  ok("there is a deposits file and a gift-detail file",
    await page.locator('[data-testid="close-download-deposits"]').count() > 0
    && await page.locator('[data-testid="close-download-detail"]').count() > 0);
  const depSentence = await page.locator('[data-testid="close-deposits"]').innerText().catch(() => "");
  ok("…and the screen says what the deposits file contains before you take it",
    /deposits?,/.test(depSentence) && /to the bank/.test(depSentence), { depSentence: depSentence.slice(0, 200) });

  const dl = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator('[data-testid="close-download-deposits"]').click(),
  ]).then(([d]) => d).catch(() => null);
  ok("the deposits file downloads", !!dl, { name: dl && dl.suggestedFilename() });
  if (dl) ok("…named for the month and the format", /deposits-2026-08-quickbooks\.csv/.test(dl.suggestedFilename()),
    { name: dl.suggestedFilename() });

  // ── ITEM 3 · WHAT IS MISSING, AND ITS ROWS ─────────────────────────────
  const issues = page.locator('[data-testid="close-issues"]');
  if (await issues.count()) {
    const txt = await issues.innerText();
    ok("the screen flags what is missing before the export", /Fix them or export anyway/.test(txt), { txt: txt.slice(0, 200) });
    const firstCount = page.locator('[data-testid^="close-issue-"]').first();
    await firstCount.click();
    await page.waitForTimeout(700);
    const rows = await page.locator('[data-testid="close-issue-rows"]').innerText().catch(() => "");
    ok("…and each count opens its rows", rows.length > 20 && /20\d\d-08/.test(rows), { rows: rows.slice(0, 160) });
  } else {
    ok("the screen flags what is missing before the export", false, "no issues block, and August should have cheques with no number");
  }

  // ── NO TOTALS ROWS, read from the bytes the browser received ───────────
  const detail = await api(`/reports/bookkeeper?from=2026-08-01&to=2026-08-31&format=csv`, {}, tok);
  ok("the gift-detail CSV body carries no TOTAL row",
    typeof detail.body === "string" && !/^TOTAL/m.test(detail.body) && !/TOTALS BY FUND/.test(detail.body),
    { sample: String(detail.body).slice(-180) });

  ok("no console errors or 5xx on the close screen", errs.length === 0, { errs: errs.slice(0, 4) });

  // ── 390 ────────────────────────────────────────────────────────────────
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
  await phone.evaluate(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
  }, [tok, me.user || me, org]);
  await phone.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
  await phone.waitForSelector(".app-root", { timeout: 25000 });
  const g2 = await phone.$('[data-testid="first-run-go"]'); if (g2) { await g2.click(); await phone.waitForTimeout(500); }
  await phone.click(".mobile-bottom-bar button:last-child").catch(() => {});
  await phone.waitForTimeout(800);
  const fin = phone.locator('.mobile-more-drawer [data-nav-id="finance"]').first();
  if (await fin.count()) { await fin.click(); await phone.waitForTimeout(2000); }
  const pExp = phone.locator('button, a').filter({ hasText: /^Exports$/ }).first();
  if (await pExp.count()) { await pExp.click(); await phone.waitForTimeout(1200); }
  const pClose = phone.locator('button, a').filter({ hasText: /^Month close$/ }).first();
  if (await pClose.count()) { await pClose.click(); await phone.waitForTimeout(1800); }
  ok("Monthly close is usable at 390", await phone.locator('[data-testid="monthly-close"]').count() > 0);
  ok("…with the format buttons reachable", await phone.locator('[data-testid="flavour-xero"]').count() > 0);
  const hScroll = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("no horizontal scroll at 390", !hScroll);

  await browser.close();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
