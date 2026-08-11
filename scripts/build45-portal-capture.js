// BUILD-45 — portal demo capture (deliverable 6 evidence).
// Prereqs (the standing local capture recipe, tests/README.md + CLAUDE.md):
//   1. scratch server on :5601 booted with CORS_ORIGIN=http://localhost:4173
//   2. client built with VITE_API_URL=http://localhost:5601, `vite preview --port 4173`
//   3. node scripts/seed-build45-portal-demo.js (local mode) already run
//   4. PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build45-portal-capture.js
// Captures: themed portal login · magic-link email render · donor dashboard
// (giving bars, recurring w/ pause, impact updates) · staff day view showing
// the drift alert · Settings › Donor Portal manager.

const path = require("path");
const fs = require("fs");
const http = require("http");
const PW_DIR = process.env.PLAYWRIGHT_DIR || process.env.HOME + "/steward-qa";
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const API = "http://localhost:5601";
const APP = "http://localhost:4173";
const SLUG = "creo-arts-creo";
const OUT = path.join(__dirname, "..", "docs", "build45-portal-demo");
fs.mkdirSync(OUT, { recursive: true });

let mail = [];
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { /* */ } res.end(JSON.stringify({ id: "s" })); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

(async () => {
  const sink = await startSink();
  // Portal session for the rich-history donor (the real magic-link flow).
  const donorEmail = "grants@sunrisefdn.org";
  await fetch(`${API}/portal/${SLUG}/request-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: donorEmail }) });
  await settle();
  const linkMail = mail.find(m => /#token=/.test(m.html || ""));
  const token = /#token=([A-Za-z0-9_-]+)/.exec(linkMail.html)[1];
  const v = await fetch(`${API}/portal/${SLUG}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  const cookieVal = /steward_portal=([^;]+)/.exec(v.headers.get("set-cookie"))[1];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  let shots = 0;
  const snap = async (page, name, fullPage = true) => { await page.screenshot({ path: path.join(OUT, name), fullPage }); shots++; console.log("  shot", name); };

  // 1 · themed login page (logged-out portal)
  let page = await ctx.newPage();
  await page.goto(`${APP}/portal/${SLUG}`, { waitUntil: "networkidle" });
  await snap(page, "portal-login-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await snap(page, "portal-login-390.png");
  await page.close();

  // 2 · magic-link email render
  page = await ctx.newPage();
  await page.setViewportSize({ width: 700, height: 600 });
  await page.setContent(`<div style="background:#eceae4;padding:40px 0"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.08)">${linkMail.html}</div></div>`);
  await snap(page, "portal-magic-link-email.png");
  await page.close();

  // 3 · donor dashboard (signed in) — desktop + mobile
  await ctx.addCookies([{ name: "steward_portal", value: decodeURIComponent(cookieVal), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${APP}/portal/${SLUG}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Your giving", { timeout: 8000 });
  await snap(page, "portal-dashboard-1440.png");
  await page.setViewportSize({ width: 390, height: 900 });
  await settle(300);
  await snap(page, "portal-dashboard-390.png");
  await page.close();

  // 4 · staff day view with the drift alert + Settings › Donor Portal
  const login = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@creoarts.org", password: "demo1234" }) }).then(r => r.json());
  page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(([tok, user, org]) => {
    localStorage.setItem("npe_token", tok);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, [login.token, login.user, login.org]);
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=reach out today", { timeout: 10000 }).catch(() => {});
  await snap(page, "day-view-drift-alert.png");
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await page.evaluate(() => { const b = [...document.querySelectorAll("button,div[role=button]")].find(x => /Settings/.test(x.textContent)); b && b.click(); });
  await settle(600);
  await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Donor Portal"); t && t.click(); });
  await settle(800);
  await snap(page, "settings-donor-portal.png");
  await page.close();

  await browser.close();
  if (sink) sink.close();
  console.log(`\n${shots} screenshots → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
