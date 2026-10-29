// tests/perf-app.spec.js: HARDEN-2 item 2. The app's own speed budgets, on an
// org the size of a real customer's: 2,000 people and 10,000 gifts (SCALE-1's
// seeder, scripts/load/seed-many.js, for one org), on a desktop and on a phone.
//
//   · Home, the first look after sign-in, its right rail included (HOME-4):
//     usable under 1 s on a desktop, under 5 s on a phone (HOME-4 asked for
//     4 s; the phone is now the app's own code over slow 4G, see HISTORY);
//     and no read the rail needs starts after Home's first paint
//   · the Donors list, 100 rows: under 1 s on the server, drawn under 2 s
//   · a donor's profile: drawn under 2 s
//   · the import preview (FIX-55 item 1b), each real-shaped file, in an org of
//     2,000 people with 500 deleted: the first preview under 4 s and each
//     re-read after an answer under 2 s, at prod's database round trip
//     (tests/lib/previewPerfOrg.js). No browser, so it runs before the skip.
//
// THE MACHINES. A phone is tests/lib/phone.js's (Moto G Power: DevTools slow
// 4G, a CPU slowdown calibrated to this machine). A desktop is Lighthouse's desktop: 1350×940, CPU
// 1x, 40 ms round trip, 10 Mbps. Fresh browser and no cache for every run; each
// number is the median of PERF_RUNS (default 3).
//
// USABLE. The thing that means "this screen" is on the page (rows, the
// profile's rail, Home's own blocks), and the later of: its last long task,
// its Largest Contentful Paint, and the network going quiet as Lighthouse's
// Time to Interactive defines it (no more than two requests in flight).
//
// The fixture org is this file's own (org_perfapp); it never names the demo.
// Run by tests/perf-app.test.js. A browser leg.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, api, login, BASE, browserLegOrSkip } = require("./helpers");
const PREVIEW = require("./lib/previewPerfOrg");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const ORG = { id: "org_perfapp", slug: "perfapp", name: "Perf App Harbor Trust", tier: "medium", n: 1, donors: 2000, gifts: 10000, interactions: 4000, tasks: 60, subs: 20, users: 2 };
const RUNS = Number(process.env.PERF_RUNS || 3);
const BUDGET = { homeDesktop: 1000, homePhone: 5000, listServer: 1000, listDraw: 2000, profile: 2000 };
const DESKTOP = {
  ctx: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 },
  net: { offline: false, latency: 40, downloadThroughput: (10240 * 1024) / 8, uploadThroughput: (10240 * 1024) / 8 }, cpu: 1,
};
const { PHONE: PHONE_CTX, SLOW_4G, cpuRate } = require("./lib/phone");
const PHONE = { ctx: PHONE_CTX, net: SLOW_4G, cpu: 4 };   // cpu set from cpuRate() before the first screen
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function seed() {
  // Drop this file's own org and rebuild it from the fixed seed.
  const tabs = (await q(`SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG.id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG.id]);
  await q("SET session_replication_role = origin");
  const seedMany = require("../scripts/load/seed-many.js");
  await seedMany.seedOrg(ORG, bcrypt.hashSync("loadtest1234", 8));
  await seedMany.pool.query("ANALYZE donors; ANALYZE gifts; ANALYZE interactions; ANALYZE tasks");
  await seedMany.pool.end();
}

// One screen in one fresh browser. `ready` is the element that means this
// screen is on the page; `rows` (optional) how many of it must be there.
async function measure(browser, machine, auth, url, ready, rows = 1) {
  const ctx = await browser.newContext({ ...machine.ctx, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o, sel, n]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    window.__perf = { lcp: 0, longEnd: 0, readyAt: 0 };
    const look = () => { if (!window.__perf.readyAt && document.querySelectorAll(sel).length >= n) window.__perf.readyAt = performance.now(); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.renderTime || e.loadTime || e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longEnd = Math.max(window.__perf.longEnd, e.startTime + e.duration); })
        .observe({ type: "longtask", buffered: true });
    } catch { /* nothing to observe */ }
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org), ready, rows]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", machine.net);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: machine.cpu });
  let js = 0, bytes = 0, requests = 0;
  const types = new Map(), apiUrls = [], fail5xx = [], sent = [];
  // HOME-4: when each request to the API left, against the page's own clock.
  let navAt = null;
  cdp.on("Network.requestWillBeSent", e => {
    if (navAt == null && e.type === "Document") navAt = e.timestamp;
    if (e.request.url.startsWith(BASE) && navAt != null) sent.push({ url: e.request.url, at: Math.round((e.timestamp - navAt) * 1000) });
  });
  cdp.on("Network.responseReceived", e => {
    types.set(e.requestId, e.type);
    // The AI stream answers 5xx on a server with no model key (the scratch
    // stack); that is the AI switch's business, not this file's.
    if (e.response.status >= 500 && !/\/ai\/stream/.test(e.response.url)) fail5xx.push(e.response.url);
    if (e.response.url.startsWith(BASE)) apiUrls.push(e.response.url);
  });
  cdp.on("Network.loadingFinished", e => {
    requests++; bytes += e.encodedDataLength; if (types.get(e.requestId) === "Script") js += e.encodedDataLength;
  });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  await page.goto(APP + url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length >= n, [ready, rows], { timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(300);
  // When the network went quiet, as Lighthouse's Time to Interactive defines
  // it: from then on no more than two requests are in flight (one trailing
  // beacon, such as "these cards were seen", is not a page still loading).
  const r = await page.evaluate(() => {
    const rs = performance.getEntriesByType("resource").map(e => [e.startTime, e.responseEnd]);
    let quiet = 0;
    for (const [, end] of rs) if (rs.filter(([s, e]) => s < end && e >= end).length >= 3) quiet = Math.max(quiet, end);
    const fcp = (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0;
    return { ...window.__perf, netQuiet: quiet, fcp };
  });
  const out = {
    ready: !!r.readyAt, readyAt: Math.round(r.readyAt), lcp: Math.round(r.lcp), longEnd: Math.round(r.longEnd), net: Math.round(r.netQuiet || 0),
    jsKB: Math.round(js / 1024), totalKB: Math.round(bytes / 1024), requests, errors, fail5xx, apiUrls,
    fcp: Math.round(r.fcp || 0), sent,
  };
  out.usable = r.readyAt ? Math.max(out.readyAt, out.longEnd, out.lcp, Math.round(r.netQuiet || 0)) : 0;
  await ctx.close();
  return out;
}

async function measureN(browser, machine, auth, url, ready, rows) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, machine, auth, url, ready, rows));
  const m = { ...runs[0], ready: runs.every(r => r.ready), errors: runs.flatMap(r => r.errors), fail5xx: runs.flatMap(r => r.fail5xx),
    lateRail: runs.flatMap(r => lateRailReads(r)) };
  for (const k of ["usable", "readyAt", "lcp", "longEnd", "net", "jsKB", "totalKB", "requests"]) m[k] = median(runs.map(r => r[k]));
  return m;
}

// HOME-4: the rail's reads (client/src/lib/homeReads.js RAIL_READS), read
// from the file so the list is the one the client asks for. A read the rail
// needs that leaves after Home's first paint, alone or inside a bundle, is late.
const RAIL_READS = (() => {
  const src = fs.readFileSync(path.join(ROOT, "client", "src", "lib", "homeReads.js"), "utf8");
  const m = /export const RAIL_READS=\[([^\]]*)\]/.exec(src);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1].split("?")[0]) : [];
})();
function lateRailReads(r) {
  const pathsOf = u => {
    const url = new URL(u);
    return url.pathname === "/home/bundle" ? url.searchParams.getAll("p").map(p => p.split("?")[0]) : [url.pathname];
  };
  return r.sent.filter(x => x.at > r.fcp && pathsOf(x.url).some(p => RAIL_READS.includes(p))).map(x => `${x.at}ms > paint ${r.fcp}ms: ${x.url.replace(BASE, "").slice(0, 90)}`);
}

// The import preview's budgets: their own org (org_perfpreview), API only.
async function previewLeg() {
  const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
  const { token } = await PREVIEW.freshPerfOrg(q, login, "org_perfpreview", "Perf Preview Trust");
  const seeded = await PREVIEW.seedPreviewOrg(q, "org_perfpreview", XLSX);
  ok(`the preview org has 2,000 people, 500 of them deleted`, seeded.people === 2000 && seeded.deleted === 500, seeded);
  await PREVIEW.previewBudgets({ ok, base: BASE, token, XLSX });
}

(async () => {
  await previewLeg();
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built (bash scripts/build-local-dist.sh)";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (browserLegOrSkip(why, "(perf-app)")) { summary(); await closeDb(); return; }
  const t0 = performance.now();
  await seed();
  const [{ d, g }] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int d, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g`, [ORG.id]);
  ok(`the fixture org has 2,000 people and 10,000 gifts (seeded in ${Math.round((performance.now() - t0) / 1000)} s)`, d === 2000 && g === 10000, { d, g });
  const login = await api("POST", "/auth/login", null, { email: `admin@${ORG.slug}.load`, password: "loadtest1234" });
  ok("the fixture admin signs in", login.status === 200 && !!login.body.token, login.status);
  const auth = { token: login.body.token, user: login.body.user, org: login.body.org };
  const [top] = await q(`SELECT id FROM donors WHERE org_id=$1 ORDER BY gift_count DESC, id LIMIT 1`, [ORG.id]);

  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const cal = await cpuRate(browser);
  PHONE.cpu = cal.rate;
  console.log(`  phone CPU slowdown ${PHONE.cpu}x (this machine's benchmark ${cal.score == null ? "not run: PERF_CPU" : cal.score})`);
  // Home's own blocks, whatever INSIGHTS-1 or a later build draws there.
  // HOME-4: Home is usable when the rail is drawn whole, not before.
  const HOME_READY = process.env.PERF_HOME_READY || '[data-testid="home-rail"][data-ready="1"]';
  const homeD = await measureN(browser, DESKTOP, auth, "/dashboard", HOME_READY);
  const homeP = await measureN(browser, PHONE, auth, "/dashboard", HOME_READY);
  const list = await measureN(browser, DESKTOP, auth, "/donors", '[data-testid="dir-table"] [data-testid="person-mark"]', 100);
  const prof = await measureN(browser, DESKTOP, auth, `/donors/${top.id}`, '[data-testid="dp-right-rail"]');
  await browser.close();

  // The list's own request, replayed from here: the server's time alone.
  const listUrl = list.apiUrls.find(u => /\/donors\?/.test(u));
  const serverMs = [];
  if (listUrl) for (let i = 0; i < 5; i++) {
    const s = performance.now();
    const r = await fetch(listUrl, { headers: { Authorization: "Bearer " + auth.token } });
    await r.arrayBuffer();
    serverMs.push(r.ok ? performance.now() - s : Infinity);
  }
  const listServer = serverMs.length ? median(serverMs) : Infinity;

  {
    console.log("\n  screen            usable ms  ready ms  LCP ms  long ms  net ms  JS KB  total KB  requests");
    for (const [name, r] of [["Home, desktop", homeD], ["Home, phone", homeP], ["Donors, desktop", list], ["Profile, desktop", prof]])
      console.log(`  ${name.padEnd(17)} ${String(r.usable).padStart(9)} ${String(r.readyAt).padStart(9)} ${String(r.lcp).padStart(7)} ${String(r.longEnd).padStart(8)} ${String(r.net).padStart(7)} ${String(r.jsKB).padStart(6)} ${String(r.totalKB).padStart(9)} ${String(r.requests).padStart(9)}`);
    console.log(`  Donors list, 100 rows, server: ${listServer} ms (median of 5)\n`);
  }
  for (const [name, r] of [["Home (desktop)", homeD], ["Home (phone)", homeP], ["Donors list", list], ["donor profile", prof]])
    ok(`${name}: draws with no error and no 5xx`, r.ready && !r.errors.length && !r.fail5xx.length, { ready: r.ready, errors: r.errors.slice(0, 3), fail5xx: r.fail5xx.slice(0, 3) });
  ok(`Home, its rail included, usable under 1 s on a desktop (${homeD.usable} ms)`, homeD.usable > 0 && homeD.usable < BUDGET.homeDesktop, homeD.usable);
  ok(`Home, its rail included, usable under 5 s on a phone (${homeP.usable} ms)`, homeP.usable > 0 && homeP.usable < BUDGET.homePhone, homeP.usable);
  ok(`Home: no read the rail needs starts after the first paint (${RAIL_READS.length} reads, desktop and phone)`,
     RAIL_READS.length > 5 && !homeD.lateRail.length && !homeP.lateRail.length, [...homeD.lateRail, ...homeP.lateRail].slice(0, 6));
  ok(`the Donors list's 100 rows in under 1 s on the server (${listServer} ms)`, listServer < BUDGET.listServer, { listServer, listUrl });
  ok(`the Donors list draws 100 rows in under 2 s (${list.readyAt} ms)`, list.ready && list.readyAt < BUDGET.listDraw, list.readyAt);
  ok(`a donor profile draws in under 2 s (${prof.usable} ms)`, prof.usable > 0 && prof.usable < BUDGET.profile, prof.usable);
  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("perf-app ran", false, String(e && e.stack || e)); summary(); await closeDb().catch(() => {}); });
