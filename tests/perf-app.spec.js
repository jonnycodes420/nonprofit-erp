// tests/perf-app.spec.js: HARDEN-2 item 2. The app's own speed budgets, on an
// org the size of a real customer's: 2,000 people and 10,000 gifts (SCALE-1's
// seeder, scripts/load/seed-many.js, for one org), on a desktop and on a phone.
//
//   · Home, the first look after sign-in, its right rail included (HOME-4):
//     usable under 1 s on a desktop, under PHONE_MS on a phone (PERF-2: 4.5 s
//     at SWEEP-6, 3.5 s at PERF-3; the 3 s the bar asks is docs/defects.md's);
//     no read the rail needs starts after Home's first paint; Home's first look
//     downloads no more than JS_FIRST_KB of JavaScript (PERF-2's after + 5%);
//     no bundle of Home's reads is asked for twice (app.html's preloader asks
//     for them and the app takes its answers, PERF-2); and the preloader is
//     allowed by vercel.json's CSP (a wrong hash is not an error anyone sees:
//     the browser skips the preloader and Home is a second slower)
//   · PERF-3: Home on a phone a second time (the cache primed, most of her
//     mornings) under WARM_MS; Home's first look downloads no more than
//     FIRST_KB in all (scripts, fonts, styles and its reads); and nothing on
//     it moves as it loads or as a font swaps (CLS under 0.02, cold and warm)
//   · SHIFT-1: the browser's clock is the test's, never the runner's. Every
//     screen opens on Wednesday, September 30 at a pinned UTC hour, and Home on a phone
//     opens at 08:00, 14:00 and 20:00: the greeting's words change with the
//     hour, and CI's morning once wrapped the greeting line and moved everything
//     under it 27 px (CLS 0.139). The worst hour counts. The fixture org's name
//     is the length that wrapped it. SHIFT-2: and once more at 08:00 with the
//     reads that fill Home's header landing after it has painted (lateHeader),
//     which is how CI's slower runner moved Your moves 68 px. The day is the longest real date, which
//     takes two lines on a phone in the serif and in its fallback alike: on a
//     shorter date the two can wrap differently, and a cold phone moves when
//     the serif arrives (docs/history/SHIFT-1.md, left for the next brief).
//   · the Donors list, 100 rows: under 1 s on the server, drawn under 2 s
//   · a donor's profile: drawn under 2 s
//   · the import preview (FIX-55 item 1b), each real-shaped file, in an org of
//     2,000 people with 500 deleted: the first preview under 4 s and each
//     re-read after an answer under 2 s, at prod's database round trip
//     (tests/lib/previewPerfOrg.js). No browser, so it runs before the skip.
//   · NUMBERS-4: the 25,000-person workbook (messy-25k) imports whole in under
//     2 minutes (tests/lib/workbookImportLeg.js; PERF-2: over 15). No browser.
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
const { ok, summary, q, closeDb, api, login, BASE, browserLegOrSkip, importWorkSettled } = require("./helpers");
const { workbookImportLeg } = require("./lib/workbookImportLeg");
const PREVIEW = require("./lib/previewPerfOrg");
const timed = require("./lib/budget").withinBudget(ok);

const ROOT = path.join(__dirname, "..");
const { DIST } = require("./lib/dist");   // CI-2: this shard's dist
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
// PERF-2: Home on a phone, and the JavaScript its first look downloads (bytes,
// so strict everywhere; the milliseconds warn in CI, tests/lib/budget.js).
const PHONE_MS = 3580;   // PERF-3 measured 3,480 ms + 0.1 s, so it cannot regress (PERF-2 3,537; main 3,840 at PERF-3's start); the bar is 3 s, docs/defects.md
const JS_FIRST_KB = 239;   // PERF-3 measured 227 KB + 5%: the moves deck's code (15 KB) is on the first look now, preloaded (PERF-2: 214)
const WARM_MS = 1446;   // PERF-3: Home on a phone a second time, measured 1,314 ms + 10% (main: 1,528)
const FIRST_KB = 309;   // PERF-3: every byte of Home's first look, measured 294 KB + 5% (main: 314)
const CLS_MAX = 0.02;   // PERF-3: main moved 0.49 of the phone's screen (the deck after its stand-in); now 0
// SHIFT-1: a made-up name that, with "Good morning, Load", fits Home's greeting
// line on a 412 px phone at first paint (312 of 326 px) but not once the Edit
// button narrows the column (292 px): on main that wrapped the line, 27 px.
const ORG = { id: "org_perfapp", slug: "perfapp", name: "Riverbend Food Collective", tier: "medium", n: 1, donors: 2000, gifts: 10000, interactions: 4000, tasks: 60, subs: 20, users: 2 };
const RUNS = Number(process.env.PERF_RUNS || 3);
// SHIFT-1: the clock every screen opens at (UTC), and the hours Home's phone
// leg is held to: morning, afternoon, evening, each its own greeting.
const DAY = "2026-09-30", HOURS = [8, 14, 20];
const at = h => new Date(`${DAY}T${String(h).padStart(2, "0")}:00:00Z`);
const BUDGET = { homeDesktop: 1000, homePhone: PHONE_MS, listServer: 1000, listDraw: 2000, profile: 2000 };
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
async function measure(browser, machine, auth, url, ready, rows = 1, { warm = false, hour = 14, late = false } = {}) {
  const ctx = await browser.newContext({ ...machine.ctx, serviceWorkers: "block", timezoneId: "UTC" });
  // SHIFT-1: the page's clock starts at the pinned hour and keeps ticking. Not
  // Playwright's clock.setFixedTime: a Date that never moves slowed the warm
  // visit by 0.8 s and hid the network going quiet. Only Date moves; timers
  // and performance.now() are the browser's own.
  await ctx.addInitScript(t => {
    const R = Date, off = t - R.now(), now = () => R.now() + off;
    window.Date = new Proxy(R, { construct: (c, a, nt) => Reflect.construct(c, a.length ? a : [now()], nt),
      apply: () => new R(now()).toString(), get: (c, k) => (k === "now" ? now : Reflect.get(c, k)) });
  }, at(hour).getTime());
  await ctx.addInitScript(([t, u, o, sel, n]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    window.__perf = { lcp: 0, longEnd: 0, readyAt: 0, cls: 0, shifts: [] };
    const look = () => { if (!window.__perf.readyAt && document.querySelectorAll(sel).length >= n) window.__perf.readyAt = performance.now(); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.renderTime || e.loadTime || e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longEnd = Math.max(window.__perf.longEnd, e.startTime + e.duration); })
        .observe({ type: "longtask", buffered: true });
      // NUMBERS-5, SHIFT-1: each shift that counts keeps what moved and by how
      // much, so a red CLS names the element instead of just a number.
      const what = el => !el ? "?" : el.getAttribute("data-testid") || el.getAttribute("aria-label")
        || `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} "${(el.innerText || el.textContent || "").trim().slice(0, 40)}"`;
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
        window.__perf.cls += e.value;
        if (e.value >= 0.005) window.__perf.shifts.push(`${Math.round(e.startTime)} ms, ${e.value.toFixed(3)}: ` + (e.sources || []).slice(0, 3).map(x => {
          const el = x.node && (x.node.nodeType === 1 ? x.node : x.node.parentElement), p = x.previousRect, c = x.currentRect;
          return `${what(el)} y ${Math.round(p.y)}→${Math.round(c.y)}, h ${Math.round(p.height)}→${Math.round(c.height)}`;
        }).join("; "));
      } })
        .observe({ type: "layout-shift", buffered: true });
    } catch { /* nothing to observe */ }
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org), ready, rows]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  // PERF-3: warm is the second visit: the first, unthrottled, fills the cache.
  if (warm) {
    await page.goto(APP + url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length >= n, [ready, rows], { timeout: 45000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.goto("about:blank");
  } else await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", machine.net);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: machine.cpu });
  let js = 0, bytes = 0, requests = 0;
  const done = [];   // PERF-2: [type, bytes, ms after navigation] for each response
  const types = new Map(), apiUrls = [], fail5xx = [], sent = [];
  // HOME-4: when each request to the API left, against the page's own clock.
  let navAt = null;
  cdp.on("Network.requestWillBeSent", e => {
    if (navAt == null && e.type === "Document") navAt = e.timestamp;
    if (e.request.url.startsWith(BASE) && navAt != null) sent.push({ url: e.request.url, method: e.request.method, at: Math.round((e.timestamp - navAt) * 1000) });
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
    if (navAt != null) done.push([types.get(e.requestId), e.encodedDataLength, (e.timestamp - navAt) * 1000]);
  });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  if (late) await lateHeader(page);
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
    fcp: Math.round(r.fcp || 0), sent, cls: Math.round((r.cls || 0) * 1000) / 1000, shifts: r.shifts || [],
    // PERF-2: the JavaScript in by the time the screen was there, and any bundle asked for twice
    jsFirstKB: Math.round(done.filter(([t, , at]) => t === "Script" && r.readyAt && at <= r.readyAt + 50).reduce((n, [, b]) => n + b, 0) / 1024),
    // PERF-3: every byte in by then: the document, scripts, styles, fonts and reads
    firstKB: Math.round(done.filter(([, , at]) => r.readyAt && at <= r.readyAt + 50).reduce((n, [, b]) => n + b, 0) / 1024),
    twice: sent.filter(x => x.method === "GET" && /\/home\/bundle\?/.test(x.url)).flatMap(x => new URL(x.url).searchParams.getAll("p")).filter((p, i, a) => a.indexOf(p) !== i),
  };
  out.usable = r.readyAt ? Math.max(out.readyAt, out.longEnd, out.lcp, Math.round(r.netQuiet || 0)) : 0;
  await ctx.close();
  return out;
}

// SHIFT-2: CI's slower runner, on this page's terms. The reads that fill Home's
// header land after Home has painted: its lead (Ask's suggestions) misses the
// first bundle and comes alone LATE_MS later, and the agent's line, which is
// always set after the first paint, has words (this org has no drafts, so on
// its own it says nothing). On main the suggestions then arrived as a 68 px
// row on a phone and pushed Your moves down (CLS 0.045, CI's own number).
// The rail's checklist is a new org's, so the setup card is tested too.
const LATE_MS = 1500;
const LATE_LINE = "Steward did 3 things for you yesterday, and 2 drafts are waiting for you.";
async function lateHeader(page) {
  await page.route(u => u.href.startsWith(BASE + "/home/bundle") && u.searchParams.getAll("p").includes("/home/lead"), async r => {
    const res = await r.fetch();
    const b = await res.json();
    b["/home/lead"] = { status: 503 };
    if (b["/agent/daily-line"] && b["/agent/daily-line"].body) b["/agent/daily-line"].body.line = LATE_LINE;
    await r.fulfill({ response: res, body: JSON.stringify(b) });
  });
  await page.route(u => u.href.startsWith(BASE + "/home/lead"), async r => { await new Promise(z => setTimeout(z, LATE_MS)); await r.continue(); });
  // And the rail's checklist is a new org's (fewer than three steps done):
  // on main its card, read after the first paint, came in above Your moves.
  await page.route(u => u.href.startsWith(BASE + "/home/bundle") && u.searchParams.getAll("p").includes("/org/setup-status"), async r => {
    const res = await r.fetch();
    const b = await res.json();
    const st = b["/org/setup-status"] && b["/org/setup-status"].body;
    if (st && Array.isArray(st.items)) {
      for (const it of st.items) if (it.key !== "donors") it.done = false;
      Object.assign(st, { complete: false, cardState: null, doneCount: st.items.filter(i => i.done).length });
    }
    await r.fulfill({ response: res, body: JSON.stringify(b) });
  });
}

async function measureN(browser, machine, auth, url, ready, rows, opts) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, machine, auth, url, ready, rows, opts));
  const m = { ...runs[0], ready: runs.every(r => r.ready), errors: runs.flatMap(r => r.errors), fail5xx: runs.flatMap(r => r.fail5xx),
    lateRail: runs.flatMap(r => lateRailReads(r)), twice: runs.flatMap(r => r.twice) };
  for (const k of ["usable", "readyAt", "lcp", "longEnd", "net", "jsKB", "jsFirstKB", "firstKB", "totalKB", "requests"]) m[k] = median(runs.map(r => r[k]));
  m.cls = Math.max(...runs.map(r => r.cls));   // PERF-3: the worst run, not the median
  m.shifts = runs.reduce((w, r) => (r.cls > w.cls ? r : w), runs[0]).shifts;   // what moved in that run
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

// PERF-2: app.html's inline preloader is allowed by its hash in vercel.json's
// script CSP. Its text changes with what it does (scripts/prerender.mjs), and
// a hash left behind is no error anyone sees: the browser skips the script.
function preloaderAllowed() {
  const html = fs.readFileSync(path.join(DIST, "app.html"), "utf8");
  const m = /<script data-need="[^"]*"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const csp = (vj.headers || []).flatMap(h => h.headers || []).filter(h => h.key === "Content-Security-Policy").map(h => h.value).join(" ");
  const hash = m ? "sha256-" + require("crypto").createHash("sha256").update(m[1]).digest("base64") : null;
  ok(`app.html's preloader is allowed by vercel.json's script CSP (${hash || "no preloader"})`, !!hash && csp.includes(`'${hash}'`), hash);
}

(async () => {
  await previewLeg();
  await workbookImportLeg({ ok, timed, q, login: require("./helpers").login, base: BASE, importWorkSettled });   // the helper (a `login` below shadows it)
  // SCORES-1: an import's one full score pass runs on the queue a moment after
  // its last chunk; the 25k org's pass is done before Home is timed.
  await require("./helpers").drainQueue({ scores: true, timeout: 300000 });
  if (fs.existsSync(path.join(DIST, "app.html"))) preloaderAllowed();
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built (bash scripts/ops/build-local-dist.sh)";
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
  // SHIFT-1: the phone at each pinned hour; its times are the morning's, its CLS the worst hour's.
  const byHour = [];
  for (const hour of HOURS) byHour.push({ hour, ...(await measureN(browser, PHONE, auth, "/dashboard", HOME_READY, 1, { hour: hour })) });
  const worst = byHour.reduce((w, r) => (r.cls > w.cls ? r : w));
  const homeP = { ...byHour[0], cls: worst.cls, shifts: worst.shifts, clsHour: worst.hour,
    errors: byHour.flatMap(r => r.errors), fail5xx: byHour.flatMap(r => r.fail5xx), ready: byHour.every(r => r.ready) };
  console.log(`  Home, phone, CLS by hour: ${byHour.map(r => `${String(r.hour).padStart(2, "0")}:00 ${r.cls}`).join(", ")}`);
  const homeW = await measureN(browser, PHONE, auth, "/dashboard", HOME_READY, 1, { warm: true, hour: HOURS[0] });   // PERF-3
  const homeL = await measureN(browser, PHONE, auth, "/dashboard", HOME_READY, 1, { hour: HOURS[0], late: true });   // SHIFT-2
  console.log(`  Home, phone, its header's reads late: CLS ${homeL.cls}`);
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
    console.log("\n  screen            usable ms  ready ms  LCP ms  long ms  net ms  JS KB  JS first  total KB  requests");
    for (const [name, r] of [["Home, desktop", homeD], ["Home, phone", homeP], ["Home, phone warm", homeW], ["Donors, desktop", list], ["Profile, desktop", prof]])
      console.log(`  ${name.padEnd(17)} ${String(r.usable).padStart(9)} ${String(r.readyAt).padStart(9)} ${String(r.lcp).padStart(7)} ${String(r.longEnd).padStart(8)} ${String(r.net).padStart(7)} ${String(r.jsKB).padStart(6)} ${String(r.jsFirstKB).padStart(9)} ${String(r.totalKB).padStart(9)} ${String(r.requests).padStart(9)}  first ${r.firstKB} KB, CLS ${r.cls}`);
    console.log(`  Donors list, 100 rows, server: ${listServer} ms (median of 5)\n`);
  }
  for (const [name, r] of [["Home (desktop)", homeD], ["Home (phone)", homeP], ["Home (phone, warm)", homeW], ["Home (phone, header late)", homeL], ["Donors list", list], ["donor profile", prof]])
    ok(`${name}: draws with no error and no 5xx`, r.ready && !r.errors.length && !r.fail5xx.length, { ready: r.ready, errors: r.errors.slice(0, 3), fail5xx: r.fail5xx.slice(0, 3) });
  timed(`Home, its rail included, usable under 1 s on a desktop (${homeD.usable} ms)`, { ms: homeD.usable, budget: BUDGET.homeDesktop });
  timed(`Home, its rail included, usable under ${BUDGET.homePhone / 1000} s on a phone (${homeP.usable} ms)`, { ms: homeP.usable, budget: BUDGET.homePhone });
  ok(`Home's first look downloads at most ${JS_FIRST_KB} KB of JavaScript on a phone (${homeP.jsFirstKB} KB)`, homeP.jsFirstKB > 0 && homeP.jsFirstKB <= JS_FIRST_KB, homeP.jsFirstKB);
  // PERF-3: the second visit, every byte of the first look, and nothing moving.
  timed(`Home, a second time, usable under ${WARM_MS / 1000} s on a phone (${homeW.usable} ms)`, { ms: homeW.usable, budget: WARM_MS });
  ok(`Home's first look downloads at most ${FIRST_KB} KB in all on a phone (${homeP.firstKB} KB)`, homeP.firstKB > 0 && homeP.firstKB <= FIRST_KB, homeP.firstKB);
  // SHIFT-2: strict everywhere again, CI included (step 1 let it warn there
  // while the shift was found), and held to a fourth load: the header's reads late.
  ok(`nothing on Home moves as it loads on a phone, at ${HOURS.map(h => `${h}:00`).join(", ")} UTC, and when its header's reads land late (CLS ${homeP.cls} cold at ${homeP.clsHour}:00, ${homeW.cls} warm, ${homeL.cls} late; under ${CLS_MAX}; worst of ${RUNS} each)`,
     homeP.cls < CLS_MAX && homeW.cls < CLS_MAX && homeL.cls < CLS_MAX,
     { cold: homeP.cls, coldHour: homeP.clsHour, warm: homeW.cls, late: homeL.cls, coldMoved: homeP.shifts, warmMoved: homeW.shifts, lateMoved: homeL.shifts });
  ok("Home asks for none of its bundled reads twice (desktop and phone)", !homeD.twice.length && !homeP.twice.length && !homeW.twice.length, [...homeD.twice, ...homeP.twice, ...homeW.twice].slice(0, 3));
  ok(`Home: no read the rail needs starts after the first paint (${RAIL_READS.length} reads, desktop and phone)`,
     RAIL_READS.length > 5 && !homeD.lateRail.length && !homeP.lateRail.length, [...homeD.lateRail, ...homeP.lateRail].slice(0, 6));
  timed(`the Donors list's 100 rows in under 1 s on the server (${listServer} ms)`, { ms: listServer, budget: BUDGET.listServer, extra: { listServer, listUrl } });
  timed(`the Donors list draws 100 rows in under 2 s (${list.readyAt} ms)`, { drew: list.ready, ms: list.readyAt, budget: BUDGET.listDraw });
  timed(`a donor profile draws in under 2 s (${prof.usable} ms)`, { ms: prof.usable, budget: BUDGET.profile });
  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("perf-app ran", false, String(e && e.stack || e)); summary(); await closeDb().catch(() => {}); });
