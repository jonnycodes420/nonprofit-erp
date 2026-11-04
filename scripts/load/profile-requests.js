// LOAD-1 · how many requests opening one profile fires, counted in a real
// browser: sign in, open Donors, wait for it to settle, then click the first
// person and count every API request until the profile settles (first paint
// is the requests fired before the header shows the name).
//
//   APP=http://localhost:4173 BASE=http://localhost:5601 EMAIL=admin@ten10.load node scripts/load/profile-requests.js
// Loopback only.
"use strict";
const APP = process.env.APP || "http://localhost:4173", BASE = process.env.BASE || "http://localhost:5601";
if (![APP, BASE].every(u => /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u + "/"))) { console.error("Refusing: loopback only."); process.exit(1); }
const EMAIL = process.env.EMAIL || "admin@ten10.load";
(async () => {
  const { chromium } = require(require("path").join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
  const a = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) })).json();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
  const page = await ctx.newPage();
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
  const seen = [];
  let painted = null;
  page.on("request", r => { if (r.url().startsWith(BASE)) seen.push({ at: Date.now(), path: r.method() + " " + r.url().slice(BASE.length) }); });
  const t0 = Date.now();
  const row = page.locator('[data-donor-id], a[href*="/donors/"], tr[role="row"], tbody tr').first();
  await row.click({ timeout: 20000 });
  await page.waitForURL(/\/donors\/[^/?]+/, { timeout: 20000 });
  const name = await page.locator("h1, h2").first().textContent({ timeout: 20000 }).catch(() => null);
  painted = Date.now();
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  const settled = Date.now();
  const first = seen.filter(s => s.at <= painted);
  console.log(JSON.stringify({ url: page.url().replace(APP, ""), name, total: seen.length, firstPaint: first.length,
    paintMs: painted - t0, settleMs: settled - t0, requests: seen.map(s => s.path) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
