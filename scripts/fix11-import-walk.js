// FIX-11 Part 4 verification walk — A GIFT FILE WITH NO DONORS IS NOT A DEAD END.
//
// The whole of this part is one screen, and the defect was entirely on it: a
// grey "Import 0 Gifts" button, "40 unmatched (will skip)", and "use combined
// mode later", which is not a place. So the walk uploads a real gift file into
// an org where none of those donors exist and reads what the screen offers.
//
//   APP=http://localhost:4303 API=http://localhost:5831 node scripts/fix11-import-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.HOME, "steward-qa", "node_modules", "playwright"));
const APP = process.env.APP || "http://localhost:4303";
const API = process.env.API || "http://localhost:5831";
const FILE = process.env.GIFT_FILE || "/tmp/gifts-nobody.csv";
let failures = 0;
const ok = (l, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + l + (c ? "" : " — " + String(JSON.stringify(d) ?? "").slice(0, 320))); if (!c) failures++; };

(async () => {
  const EMAIL = `impwalk${Date.now()}@example.org`;
  const api = async (p, o = {}, tok) => {
    const r = await fetch(API + p, { ...o, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(o.headers || {}) } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
  };
  const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "Testpass123!", orgName: "Import Walk", name: "Dana Reyes" }) });
  const tok = reg.body.token;
  await api("/onboarding/complete", { method: "POST", body: "{}" }, tok);
  const org = (await api("/org", {}, tok)).body;
  const donorCount = async () => { const r = await api("/donors", {}, tok); return Array.isArray(r.body) ? r.body.length : (r.body.donors || []).length; };
  ok("a brand-new org with no donors in it", !!tok && (await donorCount()) === 0, { donors: await donorCount() });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel|ai\/stream/.test(m.location()?.url || "")) errs.push(m.text().slice(0, 120)); });
  page.on("response", r => { if (r.status() >= 500 && !/ai\/stream/.test(r.url())) errs.push(r.status() + " " + r.url()); });

  const signIn = async p => {
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
    }, [tok, reg.body.user, org && org.id ? org : { ...reg.body.org, onboarding_complete: 1 }]);
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".app-root", { timeout: 25000 });
    const go = await p.$('[data-testid="first-run-go"]'); if (go) { await go.click(); await p.waitForTimeout(600); }
    const later = p.locator('button').filter({ hasText: /I'll finish later/ }).first();
    if (await later.count()) { await later.click().catch(() => {}); await p.waitForTimeout(500); }
    await p.waitForTimeout(900);
  };
  await signIn(page);

  // Donors, then the gift-history importer.
  await page.locator('.app-sidebar [data-nav-id="donors"]').first().click();
  await page.waitForTimeout(2000);
  // It lives in the "Import & tools" menu as "Add giving history" (BUILD-33).
  const menu = page.locator('button[aria-haspopup="menu"]').filter({ hasText: /Import/ }).first();
  ok("the Import and tools menu is on Donors", await menu.count() > 0);
  if (await menu.count()) { await menu.click(); await page.waitForTimeout(800); }
  const openImport2 = page.locator('[role="menu"] button, [role="menu"] [role="menuitem"]').filter({ hasText: /Add giving history/i }).first();
  ok("the gift-history importer is reachable from it", await openImport2.count() > 0);
  if (await openImport2.count()) { await openImport2.click(); await page.waitForTimeout(1800); }

  // Upload the file.
  const input = page.locator('input[type="file"]').first();
  ok("there is a file input", await input.count() > 0);
  await input.setInputFiles(FILE);
  await page.waitForTimeout(2500);

  // Walk forward until the preview appears.
  for (let i = 0; i < 6; i++) {
    if (await page.locator('[data-testid="gi-new-donors"]').count()) break;
    const next = page.locator('[role="dialog"] button')
      .filter({ hasText: /Match Donors|Continue|Next|Preview|Review/i }).first();
    if (await next.count()) { await next.click(); await page.waitForTimeout(1800); } else break;
  }
  const onPreview = await page.locator('[data-testid="gi-new-donors"]').count() > 0;
  ok("the preview says these people are not on file yet", onPreview,
    { body: (await page.locator('[role="dialog"]').innerText().catch(() => "")).slice(0, 400) });
  if (!onPreview) { await browser.close(); console.log(`\n${failures} failure(s)`); process.exit(1); }

  const block = await page.locator('[data-testid="gi-new-donors"]').innerText();
  ok("…counting them", /5 people in this file are not on file yet/i.test(block), { block: block.slice(0, 200) });
  ok("…and naming them before anything is written",
    /Ada Petrossian/.test(block) && /Dee Marchetti/.test(block), { block: block.slice(0, 300) });
    // $1,496.25 to the CENT. The parse used to Math.round every amount to whole
  // dollars, so this read $1,496.00 and no gift-history import had ever
  // reconciled against its own file.
  ok("…saying what the gifts come to, to the cent", /\$1,496\.25/.test(block), { block: block.slice(0, 260) });
  ok("…and that nothing is written until you choose", /Nothing is written until you choose/.test(block));
  ok("…with no em dash anywhere in it", !/—/.test(block), { found: (block.match(/[^\n]*—[^\n]*/g) || []).slice(0, 2) });
  ok("…and no 'will skip' and no 'later'", !/will skip/i.test(block) && !/\blater\b/i.test(block), { block: block.slice(0, 200) });

  const create = page.locator('[data-testid="gi-create-and-import"]');
  ok("the emerald button offers to create them and import their gifts", await create.count() > 0);
  const createTxt = await create.innerText();
  ok("…named for what it will do", /^Create 5 new donors and import their gifts$/.test(createTxt.trim()), { createTxt });
  const matched = page.locator('[data-testid="gi-import-matched"]');
  ok("…beside the one that imports only the matches", await matched.count() > 0);
  const matchedTxt = await matched.innerText();
  ok("…which says so rather than offering 'Import 0 Gifts'",
    /No gifts match somebody on file/.test(matchedTxt.trim()) && !/Import 0/.test(matchedTxt), { matchedTxt });
  ok("…and is disabled, because there is nothing for it to do", await matched.isDisabled());

  // Do it.
  await create.click();
  await page.waitForTimeout(5000);
  const resultTxt = await page.locator('[data-testid="gi-result-created"]').innerText().catch(() => "");
  ok("the import reports what it created", /5 donors created and 7 gifts imported, as one import/.test(resultTxt),
    { resultTxt: resultTxt.slice(0, 240) });
  ok("…and the donors are really there, once each", (await donorCount()) === 5, { donors: await donorCount() });

  // ── THE UNDO ───────────────────────────────────────────────────────────
  const undo = page.locator('[data-testid="gi-undo"]');
  ok("one undo is offered", await undo.count() > 0);
  await undo.click();
  await page.waitForTimeout(4000);
  ok("…and it removes the people", (await donorCount()) === 0, { donors: await donorCount() });
  const giftsAfter = await api("/reports/bookkeeper?from=2026-01-01&to=2026-12-31", {}, tok);
  ok("…and the gifts", (giftsAfter.body.giftCount || 0) === 0, { gifts: giftsAfter.body.giftCount });

  ok("no console errors or 5xx through the whole flow", errs.length === 0, { errs: errs.slice(0, 4) });

  // ── 390 ────────────────────────────────────────────────────────────────
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await signIn(phone);
  await phone.click(".mobile-bottom-bar button:last-child").catch(() => {});
  await phone.waitForTimeout(800);
  const dn = phone.locator('.mobile-more-drawer [data-nav-id="donors"]').first();
  if (await dn.count()) { await dn.click(); await phone.waitForTimeout(1800); }
  const hScroll = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("no horizontal scroll at 390", !hScroll);

  await browser.close();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
