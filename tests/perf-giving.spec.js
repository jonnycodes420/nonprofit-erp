// tests/perf-giving.spec.js: HARDEN-2 item 1. A donor on a phone who waits
// four seconds for a giving page leaves. This holds every public page a donor
// opens to a budget, on the built app, on a phone over a slow network:
//
//   · Largest Contentful Paint under 2.5 s
//   · usable (the form is on the screen and the main thread has gone quiet)
//     under 3 s
//   · under 200 KB of JavaScript over the wire
//
// THE PHONE. Lighthouse's mobile profile (Moto G Power) applied the way
// Lighthouse's own "devtools" throttling applies it, because a browser driven
// by Playwright throttles per request, not by simulation: 412×823 at 1.75x,
// CPU 4x slower, and slow 4G as DevTools emulates it (562.5 ms round trip,
// 1,474.56 Kbps down, 675 Kbps up). Fresh browser, no cache, no service worker.
//
// THE PAGES. /give/<org> in each layout (Story, simple, campaign), a
// peer-to-peer fundraiser's page, the membership page (/give/<org>?memberships)
// and an event page (/e/<slug>, which the API draws itself). The fixture org is
// this file's own (org_perfgive); it never names or logs in to the demo.
//
// The file is run by tests/perf-giving.test.js (run-all.sh runs
// `<name>.test.js`). It is a browser leg.
//
// HOW IT GOES RED ON MAIN (watched, see the HARDEN-2 report): every /give page
// loaded the whole CRM's entry (the marketing site, Sentry and the app's
// shared code, about 300 KB of JavaScript compressed), so the JavaScript
// budget fails on all five, and Story and campaign miss LCP.
//
// Env:
//   APP_URL, BASE         the preview and the API (tests/shard.sh sets both)
//   PERF_CPU=4            CPU slowdown (CI runners are slower than a laptop;
//                         the budget is the same, the phone is the same)
//   PERF_RUNS=3           fresh phones per page; each number is the median
//   PERF_REPORT=1         print a table of every number, budget or not
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, q, closeDb, BASE, browserLegOrSkip, civilPlusDays } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const ORG = "org_perfgive", SLUG = "perf-give-harbor";
const BUDGET = { lcp: 2500, usable: 3000, jsBytes: 200 * 1024 };
const CPU = Number(process.env.PERF_CPU || 4);
// DevTools' slow 4G, which is what Lighthouse applies with throttlingMethod=devtools.
const NET = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };
const PHONE = {
  viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

// Every page, with the element that means "a donor can use this now".
const PAGES = [
  { name: "give: Story", url: `/give/${SLUG}`, ready: "#give-form button" },
  { name: "give: simple", url: `/give/${SLUG}/simple-page`, ready: "#give-form button" },
  { name: "give: campaign", url: `/give/${SLUG}/campaign-page`, ready: "#give-form button" },
  { name: "peer-to-peer", url: `/give/${SLUG}/p2p-page/cora-runs`, ready: "#give-form button" },
  { name: "membership", url: `/give/${SLUG}?memberships`, ready: '[data-testid="membership-join"]' },
  { name: "event", url: `/e/perf-lantern-night`, ready: "form button, form input[type=submit]" },
];

async function reset() {
  for (const t of ["peer_fundraisers", "giving_page_versions", "giving_pages", "event_levels", "events", "membership_levels", "gifts", "donors", "campaigns", "portal_settings"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id,stripe_connected,legal_name,receipt_address,ein)
           VALUES ($1,'Perf Harbor Rowing',$2,1,'active','growth','America/New_York','acct_perfgive',true,'Perf Harbor Rowing, Inc.','4 Pier Road, Salem, MA 01970','12-3456789')`, [ORG, SLUG]);
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,created_by,created_by_name)
           VALUES ('camp_perfgive',$1,'The boathouse',25000,$2::date,$3::date,'system:test','Test')`, [ORG, civilPlusDays(-30), civilPlusDays(30)]);
  // Real-shaped: a few hundred people and gifts behind the campaign's bar.
  const dv = [], gv = [], args = [ORG];
  for (let i = 0; i < 300; i++) {
    dv.push(`('d_perfgive_${i}',$1,'Rower ${i}','rower${i}@perfgive.test','active')`);
    gv.push(`('g_perfgive_${i}',$1,'d_perfgive_${i}',${25 + (i % 9) * 10},'${civilPlusDays(-(i % 25))}','camp_perfgive','one-time','system:test','Test')`);
  }
  await q(`INSERT INTO donors (id,org_id,name,email,status) VALUES ${dv.join(",")}`, args);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,type,created_by,created_by_name) VALUES ${gv.join(",")}`, args);
  const page = (id, slug, title, story, extra = {}) => q(
    `INSERT INTO giving_pages (id,org_id,slug,title,story,status,campaign_id,p2p_enabled,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'active',$6,$7,'system:test','Test')`, [id, ORG, slug, title, story, extra.campaign || null, !!extra.p2p]);
  const story = "Every morning before school, forty kids carry boats down to the water.\n\nThey learn to pull together.\n\nThis spring the old boathouse roof gave in, and the boats are sleeping under tarps.";
  await page("gp_perfsimple", "simple-page", "Give today", "");
  await page("gp_perfcamp", "campaign-page", "Build the boathouse", story, { campaign: "camp_perfgive" });
  await page("gp_perfp2p", "p2p-page", "Row for the boathouse", story, { campaign: "camp_perfgive", p2p: true });
  await q(`UPDATE giving_pages SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1`, ["gp_perfcamp", JSON.stringify({ design: { layout: "campaign" } })]).catch(() => {});
  await q(`UPDATE giving_pages SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1`, ["gp_perfsimple", JSON.stringify({ design: { layout: "simple" } })]).catch(() => {});
  await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,status,personal_goal_amount)
           VALUES ('pf_perfgive',$1,'gp_perfp2p','Cora Vance','cora@perfgive.test','cora-runs','active',1500)`, [ORG]);
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term) VALUES ('ml_perfgive_a',$1,'Friend',60,'12_months'),('ml_perfgive_b',$1,'Crew',250,'12_months')`, [ORG]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,location,public_slug,status) VALUES ('ev_perfgive',$1,'Lantern Night','gala',$2,'The boathouse','perf-lantern-night','active')`,
    [ORG, civilPlusDays(21)]);
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,capacity,position) VALUES ('el_perfgive',$1,'ev_perfgive','ticket','Dinner',75,40,120,0)`, [ORG]);
}

// One page on one fresh phone: the numbers Lighthouse reports.
async function measure(browser, p) {
  const ctx = await browser.newContext({ ...PHONE, serviceWorkers: "block" });
  await ctx.addInitScript(sel => {
    window.__perf = { lcp: 0, longEnd: 0, readyAt: 0 };
    // When the element that means "usable" first appears, on the page's clock.
    const look = () => { if (!window.__perf.readyAt && document.querySelector(sel)) window.__perf.readyAt = performance.now(); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.renderTime || e.loadTime || e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longEnd = Math.max(window.__perf.longEnd, e.startTime + e.duration); })
        .observe({ type: "longtask", buffered: true });
    } catch { /* a browser without these observers measures nothing */ }
  }, p.ready);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const types = new Map(), bytes = { js: 0, all: 0, requests: 0 };
  cdp.on("Network.responseReceived", e => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", e => {
    bytes.requests++; bytes.all += e.encodedDataLength;
    if (types.get(e.requestId) === "Script") bytes.js += e.encodedDataLength;
  });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  let readyAt = null;
  const t0 = Date.now();
  await page.goto(APP + p.url, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(p.ready, { state: "visible", timeout: 30000 }).then(() => { readyAt = true; }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600); // let a late LCP candidate or long task be recorded
  // Usable = the form is on the screen AND the main thread is quiet: the later
  // of the ready element's arrival and the end of the last long task.
  const r = await page.evaluate(sel => ({ ...window.__perf, ready: !!document.querySelector(sel) }), p.ready);
  const out = {
    name: p.name, url: p.url, lcp: Math.round(r.lcp), usable: r.readyAt ? Math.round(Math.max(r.readyAt, r.longEnd)) : 0,
    jsKB: Math.round(bytes.js / 1024), totalKB: Math.round(bytes.all / 1024), requests: bytes.requests, ready: !!(readyAt && r.ready),
    wall: Date.now() - t0, errors,
  };
  await ctx.close();
  return out;
}

(async () => {
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built (bash scripts/build-local-dist.sh)";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (browserLegOrSkip(why, "(perf-giving)")) { summary(); await closeDb(); return; }
  await reset();
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  // Three fresh phones per page and the median of each number, as Lighthouse
  // advises: one run is one sample of a noisy machine.
  const RUNS = Number(process.env.PERF_RUNS || 3);
  const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const results = [];
  for (const p of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, p));
    const m = { ...runs[0], ready: runs.every(r => r.ready), errors: runs.flatMap(r => r.errors) };
    for (const k of ["lcp", "usable", "jsKB", "totalKB", "requests"]) m[k] = median(runs.map(r => r[k]));
    results.push(m);
  }
  await browser.close();
  if (process.env.PERF_REPORT === "1" || results.some(r => r.lcp > BUDGET.lcp || r.usable > BUDGET.usable || r.jsKB * 1024 > BUDGET.jsBytes)) {
    console.log("\n  page               LCP ms  usable ms  JS KB  total KB  requests");
    for (const r of results) console.log(`  ${r.name.padEnd(18)} ${String(r.lcp).padStart(6)} ${String(r.usable).padStart(10)} ${String(r.jsKB).padStart(6)} ${String(r.totalKB).padStart(9)} ${String(r.requests).padStart(9)}`);
    console.log("");
  }
  for (const r of results) {
    ok(`${r.name}: the page draws and can be used (${r.url})`, r.ready && !r.errors.length, { ready: r.ready, errors: r.errors });
    ok(`${r.name}: Largest Contentful Paint under 2.5 s on a phone (${r.lcp} ms)`, r.lcp > 0 && r.lcp < BUDGET.lcp, r.lcp);
    ok(`${r.name}: usable under 3 s on a phone (${r.usable} ms)`, r.usable > 0 && r.usable < BUDGET.usable, r.usable);
    ok(`${r.name}: under 200 KB of JavaScript (${r.jsKB} KB)`, r.jsKB * 1024 < BUDGET.jsBytes, r.jsKB);
  }
  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("perf-giving ran", false, String(e && e.stack || e)); summary(); await closeDb().catch(() => {}); });
