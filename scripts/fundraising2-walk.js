// scripts/fundraising2-walk.js · FUNDRAISING-2. Opens every Fundraising screen
// (each section and part), Events, Grants and the event page, at 1440 and 390,
// on two orgs, and saves a full-page screenshot of each plus its text, so the
// walk can be read line by line. Local stack only.
//   APP=http://localhost:4291 API=http://localhost:5821 OUT=docs/fundraising-2/before node scripts/fundraising2-walk.js
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const APP = process.env.APP || "http://localhost:4291", API = process.env.API || "http://localhost:5821";
if (!/localhost|127\.0\.0\.1/.test(APP + API)) throw new Error("local stack only");
const OUT = path.resolve(process.env.OUT || "docs/fundraising-2/before");
const ORGS = [["demo", "director@harborlight.demo", "demo-harbor-2026"], ["real", "org_fr2walk2@test.local", "loadtest1234"]];
const FR = ["overview", "campaigns", "pages", "events", "auctions", "p2p", "recurring", "members", "majorgifts", "toconfirm", "pledges", "deposits", "acknowledgments", "funds", "unfinished"];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const texts = {};
  for (const [tag, email, password] of ORGS) {
    const auth = await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
    const evs = await (await fetch(API + "/events", { headers: { Authorization: "Bearer " + auth.token } })).json().catch(() => []);
    const evList = Array.isArray(evs) ? evs : (evs.events || []);
    const ev = evList.find(e => /Finding Joy|Gala|Dinner/i.test(e.name)) || evList[0];
    const screens = [...FR.map(id => [`fr-${id}`, `/app/fundraising?fr=${id}`]), ["events", "/app/events"], ["grants", "/app/grants"], ["dashboard", "/dashboard"]];
    if (ev) screens.push(["event-page", `/app/events?event=${encodeURIComponent(ev.id)}`]);
    for (const vp of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
      await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
        [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
      for (const [name, url] of screens) {
        if (ONLY && !ONLY.has(name)) continue;
        errs.length = 0;
        await page.goto(APP + url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(900);
        const file = `${tag}-${name}-${vp.width}.png`;
        await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        const main = await page.$("main") || await page.$("body");
        texts[file] = { url, text: (await main.innerText()).slice(0, 6000), errors: [...errs] };
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(OUT, "texts.json"), JSON.stringify(texts, null, 1));
  await browser.close();
  console.log(`${Object.keys(texts).length} screens → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
