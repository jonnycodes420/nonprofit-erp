// tests/lib/pageReadyLeg.js · PERF-4. THE SEVEN MAIN PAGES, READY THE WAY A
// PERSON FEELS IT.
//
// Muse's Walk B (5 Nov) timed seven pages on prod and each was ready after
// about 4 s. This leg times the same seven by the app's own page-ready mark
// (client/src/lib/pageReady.js: the content drawn, its numbers in, no spinner
// showing), on an org the size of the walk's (about 1,000 people and 500 gifts
// this year; SCALE-1's seeder plus LOAD-1's journeys, scores and rhythms), and
// optionally at 25,000 people.
//
//   cold: a fresh sign-in (POST /auth/login, a new token) in a fresh browser
//         with its cache off: the morning she signs in.
//   warm: the same page again in that browser, its cache primed.
//
// The machine is a desktop on a 40 ms round trip, 10 Mbps, CPU 1x: what the
// walk's laptop was. Each number is the median of `runs`.
//
// Used by scripts/perf/page-ready.js (the before/after table) and
// tests/perf-app.spec.js (the 2 s check). Fake fixtures only; sends nothing.
"use strict";
const bcrypt = require("bcryptjs");

const READY_MS = 2000;
// The walk's org: 1,000 people; 3,600 gifts over six years is about 500 this year.
const WALK_ORG = { id: "org_perf4walk", slug: "perf4walk", name: "Larkspur Tide Mutual Aid", tier: "medium", n: 941,
  donors: 1000, gifts: 3600, interactions: 3000, tasks: 40, subs: 10, users: 2 };
const BIG_ORG = { id: "org_perf4big", slug: "perf4big", name: "Copperfield Commons Trust", tier: "large", n: 942,
  donors: 25000, gifts: 90000, interactions: 60000, tasks: 400, subs: 250, users: 2 };

// The seven: Home, Donors, a big profile, Fundraising, the giving report, Journeys, Settings.
const PAGES = top => [
  ["Home", "/dashboard"],
  ["Donors", "/donors"],
  ["Profile (most gifts)", `/donors/${encodeURIComponent(top)}`],
  ["Fundraising", "/app/fundraising"],
  ["Giving report", "/app/reports?report=giving-summary"],
  ["Journeys", "/app/journeys"],
  ["Settings", "/app/settings"],
];

// PERF4_RTT / PERF4_CPU slow the machine down to look for waits in series
// (scripts/perf/page-ready.js --rtt 150 --cpu 4); the check uses the desktop as it is.
const DESKTOP = {
  ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  net: { offline: false, latency: Number(process.env.PERF4_RTT || 40), downloadThroughput: (10240 * 1024) / 8, uploadThroughput: (10240 * 1024) / 8 },
  cpu: Number(process.env.PERF4_CPU || 1),
};
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function seedOrg(q, o) {
  const tabs = (await q(`SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [o.id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [o.id]);
  await q("SET session_replication_role = origin");
  const seedMany = require("../../scripts/load/seed-many.js");
  await seedMany.seedOrg(o, bcrypt.hashSync("loadtest1234", 8));
  await require("../../scripts/load/ten-orgs.js").extras(seedMany.pool, o);
  await seedMany.pool.query("ANALYZE donors; ANALYZE gifts; ANALYZE interactions; ANALYZE tasks; ANALYZE donor_scores; ANALYZE donor_rhythm");
  const [top] = await q(`SELECT id FROM donors WHERE org_id=$1 ORDER BY gift_count DESC, id LIMIT 1`, [o.id]);
  return { email: `admin@${o.slug}.load`, password: "loadtest1234", top: top.id };
}

// One page, cold then warm, in one fresh browser with a fresh sign-in.
async function onePage(browser, { app, base, api, email, password, url, log: opts_log = false }) {
  const login = await api("POST", "/auth/login", null, { email, password });
  if (login.status !== 200 || !login.body.token) throw new Error(`sign-in failed: ${login.status}`);
  const ctx = await browser.newContext({ ...DESKTOP.ctx, serviceWorkers: "block", timezoneId: "UTC" });
  await ctx.addInitScript(([t, u, o]) => {
    if (!sessionStorage.getItem("perf4_in")) { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); sessionStorage.setItem("perf4_in", "1"); }
  }, [login.body.token, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
  const page = await ctx.newPage();
  const errors = [], fail5xx = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  page.on("response", r => { if (r.status() >= 500 && r.url().startsWith(base) && !/\/ai\/stream/.test(r.url())) fail5xx.push(r.url()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", DESKTOP.net);
  if (DESKTOP.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: DESKTOP.cpu });
  const sent = [];
  const t0 = Date.now();
  page.on("request", r => { if (r.url().startsWith(base) && opts_log) sent.push([Date.now() - t0, r.method(), r.url().slice(base.length, base.length + 110)]); });
  page.on("requestfinished", r => { if (r.url().startsWith(base) && opts_log) { const x = sent.find(s => s[2] === r.url().slice(base.length, base.length + 110) && s.length === 3); if (x) x.push(Date.now() - t0); } });
  const read = async () => {
    await page.waitForFunction(() => !!window.__stewardReady, null, { timeout: 30000 }).catch(() => {});
    return page.evaluate(() => window.__stewardReady || null);
  };
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(app + url, { waitUntil: "commit", timeout: 60000 });
  const cold = await read();
  if (opts_log) { console.log(`  ${url} cold ready ${cold && cold.ms} ms`); for (const x of sent) console.log(`    ${String(x[0]).padStart(5)}–${String(x[3] ?? "…").padStart(5)} ${x[1]} ${x[2]}`); sent.length = 0; }
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.goto(app + url, { waitUntil: "commit", timeout: 60000 });
  const warm = await read();
  await ctx.close();
  return { cold: cold ? cold.ms : null, warm: warm ? warm.ms : null, page: cold && cold.page, errors, fail5xx };
}

async function measurePages(browser, opts, { runs = 3, only = null } = {}) {
  const out = [];
  for (const [name, url] of PAGES(opts.top)) {
    if (only && !only.includes(name)) continue;
    const rs = [];
    for (let i = 0; i < runs; i++) rs.push(await onePage(browser, { ...opts, url }));
    const ms = k => (rs.every(r => r[k] != null) ? median(rs.map(r => r[k])) : null);
    out.push({ name, url, cold: ms("cold"), warm: ms("warm"), runs: rs.map(r => r.cold), page: rs[0].page,
      errors: rs.flatMap(r => r.errors), fail5xx: rs.flatMap(r => r.fail5xx) });
  }
  return out;
}

// THE CHECK (tests/perf-app.spec.js). Each of the seven is ready under
// READY_MS after a fresh sign-in, on the walk-sized org, median of `runs`,
// strict on CI as on a laptop: no WARN. FLAKE-1's rule, same run: a page over
// the bar is measured once more, saying why, and that reading is the one held
// to the bar, so a page that really grew is over it twice. The bar is never moved.
async function checkSevenPages({ ok, browser, q, api, app, base, runs = 3 }) {
  const who = await seedOrg(q, WALK_ORG);
  const [{ d, g }] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int d,
     (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND date >= to_char(date_trunc('year', CURRENT_DATE), 'YYYY-MM-DD'))::int g`, [WALK_ORG.id]);
  ok(`PERF-4: the walk-sized org has 1,000 people and about 500 gifts this year (${g})`, d === 1000 && g > 300 && g < 700, { d, g });
  const opts = { app, base, api, ...who };
  const rows = await measurePages(browser, opts, { runs });
  for (const r of rows) {
    if (r.cold != null && r.cold < READY_MS) continue;
    console.log(`  PERF-4: ${r.name} ready at ${r.cold ?? "never"} ms (bar ${READY_MS}); measuring once more`);
    const [again] = await measurePages(browser, opts, { runs, only: [r.name] });
    console.log(`  …once more: ${again.cold ?? "never"} ms (runs ${again.runs.join(", ")})`);
    Object.assign(r, { cold: again.cold, warm: again.warm, runs: again.runs, errors: [...r.errors, ...again.errors], fail5xx: [...r.fail5xx, ...again.fail5xx] });
  }
  console.log(table(`PERF-4: the seven pages, ${WALK_ORG.donors.toLocaleString()} people, desktop, fresh sign-in (cold) and again (warm)`, rows));
  for (const r of rows) {
    ok(`PERF-4: ${r.name} is ready under ${READY_MS / 1000} s after a fresh sign-in (${r.cold ?? "never"} ms; warm ${r.warm ?? "never"} ms)`,
       r.cold != null && r.cold < READY_MS, { cold: r.cold, runs: r.runs, warm: r.warm, page: r.page });
    ok(`PERF-4: ${r.name} draws with no error and no 5xx`, !r.errors.length && !r.fail5xx.length, { errors: r.errors.slice(0, 3), fail5xx: r.fail5xx.slice(0, 3) });
  }
  return rows;
}

const table = (label, rows) => [`  ${label}`, "  page                    cold ms   warm ms   runs (cold)",
  ...rows.map(r => `  ${r.name.padEnd(22)} ${String(r.cold ?? "never").padStart(8)} ${String(r.warm ?? "never").padStart(9)}   ${r.runs.join(", ")}`)].join("\n");

module.exports = { READY_MS, WALK_ORG, BIG_ORG, PAGES, seedOrg, measurePages, onePage, table, checkSevenPages };
