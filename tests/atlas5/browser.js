// tests/atlas5/browser.js · ATLAS-5. The browser leg: real clicks on the built client.
// §3 the textbox starts empty and Send waits for her words; §4 the bell
// closes with Escape, its × and a click outside, focus back on the bell, and
// an unanswered question in it has Dismiss. Skips (or fails, with
// REQUIRE_BROWSER=1) without Playwright or a dist built against the shard's API.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { browserLegOrSkip } = require("../helpers");
const { DIST } = require("../lib/dist");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };

function ready(base) {
  if (!base) return "no shard server (BASE) to walk against";
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const origin = base.replace(/^https?:\/\//, "");
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(dir, f), "utf8").includes(origin))) return "client/dist not built against the local API";
  try { require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}

// The built client, from DIST, when nothing serves APP_URL already. Paths stay inside DIST.
async function frontend(app) {
  try { const r = await fetch(app + "/", { signal: AbortSignal.timeout(1500) }); if (r.ok) return null; } catch { /* serve it here */ }
  const INDEX = fs.existsSync(path.join(DIST, "app.html")) ? path.join(DIST, "app.html") : path.join(DIST, "index.html");
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const full = path.resolve(DIST, "." + path.posix.normalize("/" + url));
    const inside = full === DIST || full.startsWith(DIST + path.sep);
    const file = inside && fs.existsSync(full) && !fs.statSync(full).isDirectory() ? full : INDEX;
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => srv.listen(Number(new URL(app).port || 80), r));
  return srv;
}

async function leg({ ok, F, base, api, tok }) {
  console.log("\n§3/§4 in the browser");
  const why = ready(base);
  if (browserLegOrSkip(why, "(browser leg)")) return;
  const APP = process.env.APP_URL || "http://localhost:4173";
  const srv = await frontend(APP);
  const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
  const browser = await chromium.launch();
  try {
    const a = await (await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: F.ADMIN, password: "loadtest1234" }) })).json();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    // An open "Which Walter?" to find in the bell.
    await api("POST", "/atlas", tok, { text: "Tell me about Walter", source: "typed" });
    await page.goto(APP + "/app/home", { waitUntil: "networkidle", timeout: 45000 });
    await page.click('[data-testid="sidebar-tell-steward"]');
    const box = await page.waitForSelector('[data-testid="tell-text"]');
    const ph = await box.getAttribute("placeholder");
    ok("§3 the textbox opens empty", (await box.inputValue()) === "", await box.inputValue());
    ok("§3 an example sits only in the placeholder, and says it is one (or where her words will show)", /^For example: |^Your words show here/.test(ph || ""), ph);
    ok("§3 Send waits for her own words", await page.$eval('[data-testid="tell-send"]', b => b.disabled));
    await box.fill("Remind me next Tuesday to call Sterling");
    ok("§3 her words turn Send on", !(await page.$eval('[data-testid="tell-send"]', b => b.disabled)));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok("§3 Escape closes Atlas", !(await page.$('[data-testid="tell-steward-sheet"]')));

    const bell = '[data-testid="atlas-bell"]', list = '[data-testid="atlas-bell-list"]';
    await page.click(bell); await page.waitForSelector(list);
    const q = await page.$(`${list} [data-testid="atlas-bell-item"][data-kind="question"]`);
    ok("§4 the open question is in the bell, with Answer and Dismiss", !!q && !!(await q.$('[data-testid="atlas-note-answer"]')) && !!(await q.$('[data-testid="atlas-note-letgo"]')));
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
    ok("§4 Escape closes the bell, and focus goes back to it", !(await page.$(list)) && focus === "atlas-bell", focus);
    await page.click(bell); await page.waitForSelector(list);
    await page.click('[data-testid="atlas-bell-close"]'); await page.waitForTimeout(250);
    ok("§4 its × closes it", !(await page.$(list)));
    await page.click(bell); await page.waitForSelector(list);
    await page.mouse.click(600, 20); await page.waitForTimeout(250);
    ok("§4 a click outside (the header) closes it", !(await page.$(list)));
    await page.click(bell); await page.waitForSelector(list);
    await page.click(`${list} [data-testid="atlas-bell-item"][data-kind="question"] [data-testid="atlas-note-letgo"]`);
    await page.waitForTimeout(800);
    ok("§4 Dismiss takes the question out of the bell", !(await page.$(`${list} [data-testid="atlas-bell-item"][data-kind="question"]`)));
    ok("§3/§4 no page errors", errs.length === 0, errs);
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
}
module.exports = { leg };
