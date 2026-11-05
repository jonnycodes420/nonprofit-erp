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
  // First paint: the profile's header has the person's figures, which come
  // from its first answers. Before LOAD-1 that is when /donors/:id/status has
  // answered; after, when the above-the-fold bundle has.
  page.on("response", r => { if (!painted && /\/donors\/[^/?]+\/(status|bundle)(\?|$)/.test(r.url())) painted = Date.now(); });
  const t0 = Date.now();
  const row = page.locator('[data-donor-id], a[href*="/donors/"], tr[role="row"], tbody tr').first();
  await row.click({ timeout: 20000 });
  await page.waitForURL(/\/donors\/[^/?]+/, { timeout: 20000 });
  await page.waitForTimeout(Number(process.env.WAIT_MS || 4000));
  const first = seen.filter(s => painted && s.at <= painted);
  console.log(JSON.stringify({ url: page.url().replace(APP, ""), total: seen.length, firstPaint: first.length,
    paintMs: painted ? painted - t0 : null, refetchesList: seen.some(s => /^GET \/donors(\?|\/counts|$)/.test(s.path)),
    requests: seen.map(s => s.path.length > 110 ? s.path.slice(0, 110) + "…" : s.path) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
