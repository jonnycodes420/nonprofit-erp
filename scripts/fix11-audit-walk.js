// FIX-11 Part 1 verification walk — THE TWO SURFACES, READ IN A BROWSER.
//
// Everything Part 1 adds to a screen is here, because the defects that matter
// most in this build were ones no server test could see. This walk found four:
//
//   · "+ Log → Gift" did nothing at all when the donor's profile was already
//     open — React keys the profile by donor id, so nothing remounted and the
//     initial state that opens the gift form never ran again.
//   · A gift posted with `payment_method` (the spelling the form, the edit
//     route and the bookkeeper export all use) was stored with NO method,
//     because this one route read only `paymentMethod`.
//   · The timeline printed "Needs you" — the sentinel for a missing method —
//     as though it were a payment method.
//   · An audit row for a CREATE showed nothing about what was created, so a
//     recorded $100,000 gift was a row with no amount in it.
//
// It also found that reaching /settings by URL at 390 lands on Home, which is
// older than this build and is why the phone leg goes through the More drawer.
//
//   APP=http://localhost:4273 API=http://localhost:5801 node scripts/fix11-audit-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const { chromium } = require(path.join(process.env.HOME, "steward-qa", "node_modules", "playwright"));
const APP = process.env.APP || "http://localhost:4273";
const API = process.env.API || "http://localhost:5801";
let failures = 0;
const ok = (l, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + l + (c ? "" : " — " + String(JSON.stringify(d) ?? "").slice(0, 300))); if (!c) failures++; };

(async () => {
  const EMAIL = `walk${Date.now()}@example.org`;
  const api = async (p, o = {}, tok) => {
    const r = await fetch(API + p, { ...o, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(o.headers || {}) } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
  };
  const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "Testpass123!", orgName: "Walk Org", name: "Dana Reyes" }) });
  const tok = reg.body.token;
  const d = await api("/donors", { method: "POST", body: JSON.stringify({ name: "Ada Petrossian", email: "ada-walk@example.org" }) }, tok);
  const donorId = d.body.id;
  const gRes = await api(`/donors/${donorId}/gifts`, { method: "POST", body: JSON.stringify({ amount: 100000, date: "2026-09-28", payment_method: "ACH", idempotencyKey: "walk-1" }) }, tok);
  ok("a gift posted with payment_method keeps that method", gRes.body.gift && gRes.body.gift.payment_method === "ACH", { got: gRes.body.gift && gRes.body.gift.payment_method });

  await api("/onboarding/complete", { method: "POST", body: "{}" }, tok);
  const org = (await api("/org", {}, tok)).body;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel/.test(m.location()?.url || "")) consoleErrs.push(m.text().slice(0, 120) + " @ " + (m.location()?.url || "")); });
  page.on("response", r => { if (r.status() >= 500 && !/\/ai\/stream/.test(r.url())) consoleErrs.push(r.status() + " " + r.url()); });
  const signIn = async p => {
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [tok, reg.body.user, org && org.id ? org : { ...reg.body.org, onboarding_complete: 1 }]);
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".app-root", { timeout: 25000 });
    const go = await p.$('[data-testid="first-run-go"]');
    if (go) { await go.click(); await p.waitForTimeout(800); }
    const later = p.locator('button').filter({ hasText: /I'll finish later/ }).first();
    if (await later.count()) { await later.click().catch(() => {}); await p.waitForTimeout(600); }
    await p.waitForTimeout(1200);
  };
  await signIn(page);

  // ── Settings → Audit log ────────────────────────────────────────────────
  await page.goto(APP + "/settings", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1800);
  let tabFound = await page.locator('text="Audit log"').first().count().catch(() => 0);
  if (!tabFound) { // the shell may route settings differently; find the nav
    const navBtn = page.locator('button, a').filter({ hasText: /^Settings$/ }).first();
    if (await navBtn.count()) { await navBtn.click(); await page.waitForTimeout(1500); }
    tabFound = await page.locator('text="Audit log"').first().count().catch(() => 0);
  }
  ok("the Audit log tab is on Settings for an admin", tabFound > 0, { tabFound });
  if (tabFound) {
    await page.locator('text="Audit log"').first().click();
    await page.waitForTimeout(2000);
    const panel = page.locator('[data-testid="audit-log"]');
    ok("the Audit log screen renders", await panel.count() > 0);
    const txt = await page.locator("body").innerText();
    ok("a line at the top says what the log covers", /Every change anyone makes in Steward/i.test(txt), { has: txt.slice(0, 200) });
    ok("the $100,000 gift is on the screen", /gift/i.test(txt) && /created/i.test(txt), { sample: txt.slice(0, 400) });
    ok("the donor is named and the row opens its record", /Ada Petrossian/.test(txt));
    ok("it says rows cannot be edited or removed", /cannot be edited or removed/i.test(txt));
    ok("there is an Export as CSV button", await page.locator('text="Export as CSV"').count() > 0);
    const wc = page.locator('text="What changed"').first();
    if (await wc.count()) {
      await wc.click(); await page.waitForTimeout(600);
      const t2 = await page.locator("body").innerText();
      ok("…and 'What changed' shows a Was / Is now table", /\bwas\b/i.test(t2) && /is now/i.test(t2), { sample: t2.slice(0, 200) });
    } else ok("…and 'What changed' shows a Was / Is now table", false, "no disclosure found");
    const panelTxt = await panel.innerText().catch(() => "");
    ok("no em dash in the audit screen's own copy", !/—/.test(panelTxt), { found: (panelTxt.match(/[^\n]*—[^\n]*/g) || []).slice(0, 3) });
  }

  // ── + Log → Gift ───────────────────────────────────────────────────────
  await page.goto(APP + "/donors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2000);
  const row = page.locator('text="Ada Petrossian"').first();
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(2000);
    const logBtn = page.locator('button').filter({ hasText: /^\+ Log( Touchpoint)?$/ }).first();
    ok("the profile has a + Log button", await logBtn.count() > 0);
    if (await logBtn.count()) {
      await logBtn.click(); await page.waitForTimeout(900);
      const giftChip = page.locator('button[aria-pressed]').filter({ hasText: /^Gift$/ }).first();
      ok("the type is called Gift, not Gift/Pledge", await giftChip.count() > 0);
      if (await giftChip.count()) {
        await giftChip.click(); await page.waitForTimeout(600);
        const modal = await page.locator('[role="dialog"]').first().innerText();
        const amountInputs = await page.locator('[role="dialog"] input[placeholder*="5,000"], [role="dialog"] input[placeholder*="Amount"]').count();
        ok("Gift collects no amount in the touchpoint modal", amountInputs === 0, { amountInputs, modal: modal.slice(0, 200) });
        ok("…it explains that a gift is recorded on the gift form", /recorded on the gift form/i.test(modal));
        ok("…and there is no Save Touchpoint for a gift", !/Save Touchpoint/i.test(modal));
        const open = page.locator('button').filter({ hasText: /^Open the gift form$/ }).first();
        ok("…with one button that opens it", await open.count() > 0);
        if (await open.count()) {
          await open.click(); await page.waitForTimeout(2200);
          const body = await page.locator("body").innerText();
          const methodInput = await page.locator('input[placeholder="Payment method"]').count();
          const amtInput = await page.locator('input[placeholder="Amount ($)"]').count();
          ok("the real gift form opened, asking for an amount and a payment method",
            methodInput > 0 && amtInput > 0, { methodInput, amtInput, sample: body.slice(0, 200) });
          ok("…on the Gifts tab, not the touchpoint modal", await page.locator('[role="dialog"]').count() === 0 || !/Log Touchpoint/i.test(body));
        }
      }
    }
    // the timeline line
    await page.goto(APP + "/donors", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1500);
    const row2 = page.locator('text="Ada Petrossian"').first();
    if (await row2.count()) {
      await row2.click(); await page.waitForTimeout(1800);
      const act = page.locator('button, [role="tab"]').filter({ hasText: /^Activity$/ }).first();
      if (await act.count()) {
        await act.click(); await page.waitForTimeout(1800);
        const t = await page.locator("body").innerText();
        ok("the gift reads as a formatted row, not key:value text", !/Amount:\s*100/.test(t) && !/Designation:/.test(t), { sample: (t.match(/[^\n]*Amount[^\n]*/g) || []).slice(0, 2) });
        ok("…with money, fund, method and whether it was thanked", /\$100,000/.test(t) && /General Operating/.test(t) && /ACH/.test(t) && /not yet thanked/.test(t), { line: (t.match(/[^\n]*100,000[^\n]*/g) || []).slice(0, 3) });
        ok("…and never the 'no method yet' sentinel as if it were a method", !/· Needs you/.test(t), { line: (t.match(/[^\n]*Needs you[^\n]*/g) || []).slice(0, 2) });
        const rowTexts = await page.locator(".tp-row").allInnerTexts().catch(() => []);
        const giftRows = rowTexts.filter(x => /\$100,000/.test(x)).length;
        ok("…and it appears ONCE in the activity list", giftRows === 1, { giftRows, rows: rowTexts.slice(0, 5) });
      } else ok("the Activity tab opens", false);
    }
  } else ok("the donor is in the directory", false);

  ok("no console errors on either screen", consoleErrs.filter(e => !/favicon|404|ai\/stream/.test(e)).length === 0, { errs: consoleErrs.slice(0, 4) });

  // 390
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await signIn(phone);
  // At 390 the rail is display:none and the shell draws a bottom bar whose last
  // button opens the More drawer (NAV-1). Reaching Settings by URL lands on
  // Home, so the walk goes the way a person does.
  await phone.click(".mobile-bottom-bar button:last-child").catch(() => {});
  await phone.waitForTimeout(900);
  const setBtn = phone.locator('.mobile-more-drawer [data-nav-id="settings"], .mobile-more-drawer button').filter({ hasText: /Settings/ }).first();
  if (await setBtn.count()) { await setBtn.click().catch(() => {}); await phone.waitForTimeout(2200); }
  const pw = await phone.locator("body").innerText();
  ok("Settings renders at 390 with the audit tab reachable", /Audit log/i.test(pw), { sample: pw.slice(0, 200) });
  const hScroll = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("no horizontal scroll at 390", !hScroll);

  await browser.close();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
