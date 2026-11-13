// page-budget — PROFILE-SPEED-1 item 7. EVERY MAIN PAGE OPENS IN A FEW REQUESTS,
// AND NO REQUEST HOLDS MORE THAN THREE CONNECTIONS.
//
// PROFILE-SPEED-1 measured every main page on a production build: Communications
// opened with 31 requests (every person's summary, 500 at a time), Settings 13,
// Reports 12, Donors and Events 11, and one Donors list read held all ten of
// the web's database connections. The fixes: each page's first reads leave in
// one request as you click (client/src/lib/pageReads.js, from App's navigateTo),
// the profile's first screen is one request (GET /donors/:id/profile), and a
// request's statements share three connections (server/shared/pools.js
// PER_REQUEST_MAX). This walk keeps it that way:
//
//   · It signs in to its own org, opens Home, then clicks each page in the
//     rail the way a person does (the profile from a name in the Donors list,
//     the event and the auction from their names), and counts the API requests
//     each click starts until the page settles (none in flight and none started
//     for 800 ms). The page-ready beacon (POST /perf/page-ready) is not a read
//     and is not counted.
//   · Each page has a budget: 5 by default, so a page added to the rail gets
//     one without anyone remembering to. The pages that still open with more
//     carry today's count in BUDGET below; PROFILE-SPEED-1 lists them for the
//     next brief.
//   · The profile's budget is 3 requests sent before it is DRAWN, and drawn
//     means the first screen's answer has landed: the GET /donors/:id/profile
//     response. What starts after that (the below-the-fold bundle, the panels
//     the drawn screen mounts) is not before the draw.
//   · Connections: the server's per-request peak is reset before the walk
//     (POST /perf/peaks/reset, TEST_MODE only) and read after it: no request
//     held more than PER_REQUEST_MAX (3).
//   · No 5xx, except the AI-off POST /ai/stream (smoke-walk's EXPECTED_5XX).
//
// HOW IT GOES RED (planted, seen red before green; PROFILE-SPEED-1 report):
//   * a page firing 12 calls on open: twelve apiFetch calls added to Settings'
//     mount → "Settings opens in at most 5 requests (16)" red; reverted → 40
//     passed, 0 failed.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without
// Playwright or a localhost-API dist; REQUIRE_BROWSER=1 makes that a failure.
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";

const skip = why => { browserLegOrSkip(why); console.log("\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const API_ORIGIN = BASE.replace(/^https?:\/\//, "");
const assetDir = path.join(DIST, "assets");
const distJs = fs.existsSync(assetDir) ? fs.readdirSync(assetDir).filter(f => f.endsWith(".js")) : [];
if (!distJs.some(f => fs.readFileSync(path.join(assetDir, f), "utf8").includes(API_ORIGIN)))
  skip("client/dist not built against the local API");
let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not installed"); }

const ORG = "org_pbudget", EMAIL = "org_pbudget@test.local";
const EVENT_NAME = "Budget Lantern Supper", AUCTION_NAME = "Budget Lantern Auction", PERSON = "Pia Budgetry";
const DEFAULT_BUDGET = 5;
// Pages that open with more than DEFAULT_BUDGET today, at today's count.
const BUDGET = {
  "Events": 6,       // today's count; PROFILE-SPEED-1 lists it for the next brief (its four year figures are four reads)
  "One event": 8,    // today's count; PROFILE-SPEED-1 lists it for the next brief (/events/:id read twice)
  "Volunteers": 6,   // today's count; PROFILE-SPEED-1 lists it for the next brief (five volunteer-hub reads)
};
const PROFILE_BEFORE_DRAWN = 3;
const EXPECTED_5XX = /\/ai\/stream/;
// [page, rail label, then the name to click inside it]
const PAGES = [
  ["Donors", "Donors"], ["Profile", "Donors", PERSON], ["Fundraising", "Fundraising"],
  ["Events", "Events"], ["One event", "Events", EVENT_NAME], ["Auctions", "Auctions"], ["One auction", "Auctions", AUCTION_NAME],
  ["Major Gifts", "Major Gifts"], ["Journeys", "Journeys"], ["Tasks", "Tasks"], ["Calendar", "Calendar"],
  ["Communications", "Communications"], ["Finance", "Finance"], ["Reports", "Reports"], ["Volunteers", "Volunteers"], ["Settings", "Settings"],
  ["Home", "Home"],   // last, so it is clicked from another page like the rest
];

async function fixture() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Page Budget Trust','page-budget-trust',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Bea Budget','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync("loadtest1234", 4)]);
  const names = [PERSON, "Odo Fenwick", "Lark Ambry", "Tobin Searle", "Wren Halloway", "Cass Mirrin", "Juno Pelt", "Rook Ashdown"];
  for (let i = 0; i < names.length; i++) {
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
      [`d_${ORG}_${i}`, ORG, names[i], `budget${i}@example.org`]);
    for (let g = 0; g < 3; g++)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
        [`g_${ORG}_${i}_${g}`, ORG, `d_${ORG}_${i}`, 50 + 25 * i + g, dayOffset(-40 - 90 * g)]);
  }
  const login = (await api("POST", "/auth/login", null, { email: EMAIL, password: "loadtest1234" })).body;
  const tok = login.token;
  const ev = await api("POST", "/events", tok, { name: EVENT_NAME, eventType: "gala", date: dayOffset(30), location: "Harbor Hall", capacity: 100 });
  const day = civilDay();
  const au = await api("POST", "/auctions", tok, { title: AUCTION_NAME, description: "Silent auction",
    opensLocal: `${dayOffset(5)}T18:00`, closesLocal: `${dayOffset(20)}T21:00` });
  const item = au.body && au.body.id ? await api("POST", `/auctions/${au.body.id}/items`, tok, { title: "Lantern basket", startingBid: 50, bidIncrement: 5, fmv: 100 }) : null;
  ok("the fixture's event, auction and item are made", ev.status < 300 && au.status < 300 && item && item.status < 300,
    { day, ev: ev.status, au: [au.status, au.body], item: item && item.status });
  return login;
}

(async () => {
  const a = await fixture();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
  const page = await ctx.newPage();
  let log = [];
  const fivexx = [];
  const live = new Map();
  const now = () => performance.now();
  page.on("request", r => {
    if (!r.url().startsWith(BASE)) return;
    const path = r.method() + " " + r.url().slice(BASE.length);
    if (/^POST \/perf\/page-ready/.test(path)) return;   // the beacon, not a read
    const e = { path, start: now() }; live.set(r, e); log.push(e);
  });
  page.on("requestfinished", r => { const e = live.get(r); if (e) e.end = now(); });
  page.on("requestfailed", r => { const e = live.get(r); if (e) e.end = now(); });
  page.on("response", r => { if (r.status() >= 500 && r.url().startsWith(BASE) && !EXPECTED_5XX.test(r.url())) fivexx.push(`${r.status()} ${r.url().slice(BASE.length, BASE.length + 90)}`); });
  // Settled: nothing in flight and nothing started for 800 ms (at most 20 s).
  const settle = async (t0) => {
    for (;;) {
      await page.waitForTimeout(100);
      const busy = log.some(e => e.end == null);
      const last = Math.max(t0, ...log.map(e => Math.max(e.start, e.end || 0)));
      if (!busy && now() - last > 800) return true;
      if (now() - t0 > 20000) return false;
    }
  };
  // The rail: the item with this label in the left 240 px, the last match so a group heading is never the one clicked.
  const rail = async (label) => {
    for (let k = 0; k < 50; k++) {
      for (const el of (await page.getByText(new RegExp("^\\s*" + label + "\\s*\\d*\\s*$")).all()).reverse()) {
        const b = await el.boundingBox().catch(() => null);
        if (b && b.x < 240 && b.width > 0) return el.click({ timeout: 5000 });
      }
      await page.waitForTimeout(200);
    }
    throw new Error("no rail item " + label);
  };

  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 90000 });
  await settle(now());
  ok("the app opens on Home for the fixture org", /\/dashboard/.test(page.url()), page.url());
  const reset = await api("POST", "/perf/peaks/reset", a.token);
  ok("the server's peaks reset (TEST_MODE)", reset.status === 200, reset);

  const seen = {};
  for (const [name, label, inner] of PAGES) {
    try {
      if (inner) { await rail(label); await settle(now()); }
      log = [];
      const t0 = now();
      if (inner) await page.getByText(inner, { exact: true }).first().click({ timeout: 15000 });
      else await rail(label);
      const settled = await settle(t0);
      const n = log.length;
      seen[name] = n;
      if (name === "Profile") {
        const first = log.find(e => /^GET \/donors\/[^/?]+\/profile(\?|$)/.test(e.path));
        const before = first && first.end != null ? log.filter(e => e.start <= first.end).length : null;
        seen["Profile before drawn"] = before;
        ok(`Profile: its first screen is one request (GET /donors/:id/profile)`, !!first, log.map(e => e.path.slice(0, 80)));
        ok(`Profile sends at most ${PROFILE_BEFORE_DRAWN} requests before it is drawn (${before})`, before != null && before <= PROFILE_BEFORE_DRAWN,
          log.filter(e => first && e.start <= first.end).map(e => e.path.slice(0, 80)));
      } else {
        const budget = BUDGET[name] || DEFAULT_BUDGET;
        ok(`${name} opens in at most ${budget} requests (${n})`, n <= budget, log.map(e => e.path.slice(0, 80)));
      }
      ok(`${name} settles`, settled, log.filter(e => e.end == null).map(e => e.path.slice(0, 80)));
    } catch (e) { ok(`${name} opens`, false, e.message.split("\n")[0].slice(0, 160)); }
  }
  console.log("  counts: " + JSON.stringify(seen));

  const peaks = await api("GET", "/perf/peaks", a.token);
  const p = peaks.body || {};
  ok(`no request held more than ${p.perRequestMax} connections at once (${p.perRequestPeak})`,
    peaks.status === 200 && p.perRequestMax === 3 && p.perRequestPeak >= 1 && p.perRequestPeak <= p.perRequestMax, p);
  ok("no 5xx on any page (the AI-off draft aside)", fivexx.length === 0, fivexx.slice(0, 6));
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e.stack); ok("the walk ran", false, e.message); await closeDb().catch(() => {}); summary(); });
