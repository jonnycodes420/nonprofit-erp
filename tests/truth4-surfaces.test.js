// tests/truth4-surfaces.test.js — TRUTH-4. EVERY SURFACE AGREES ON GIFTS, PEOPLE
// AND AT-RISK MONEY.
//
// The QA fleet (8 Nov) found one $0 gift counted on some screens and not
// others, a Top 50 header above its rows, a household's giving counted twice
// on LYBUNT, a split gift whole in one fund's table, two at-risk figures for
// the same people, "with email" above Everyone, a group starter one above the
// same rule by hand, and Home's follow-ups read as the Tasks badge. This suite
// builds one org shaped like that (tests/lib/truth4Fixture.js: a $0 gift, a
// household, a split gift, lapsed donors, a trashed person, an erased
// volunteer, a gift dated after today) and asks:
//   §1 assertSurfacesAgree, whose check "truth4" (tests/lib/truth4Pairs.js)
//      holds every pair to a truth written from the rows
//   §2 the browser, on the built client: LYBUNT's header counts its rows (a
//      household once); Lost & Found's at-risk tile names its basis and is
//      the Lost report's figure; Home's set has its own name
//
// HOW IT GOES RED (planted, see the PR): Fundraising's period count reading
// every row (`gifts: r.rows`, which counts the $0 row) turns §1 red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const orgTime = require("../orgTime");
const { buildTruth4Org } = require("./lib/truth4Fixture");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");   // CI-2: this shard's built client

(async () => {
  const f = await buildTruth4Org();
  const tok = f.token;
  // A gift dated after today: in no span until its day comes (All-time and the years agree).
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,1000,$4,'gift','system:test','test fixture')`,
    [`g_t4_${f.run}_future`, f.org, f.ids.corin, orgTime.addDays(f.today, 20)]);
  await api("PUT", `/donors/${f.ids.corin}`, tok, { notes: "touched" });

  // ── §1 every surface, every pair ──────────────────────────────────────────
  const r = await assertSurfacesAgree(f.org, { token: tok, soft: true, label: "TRUTH-4", skip: ["ask", "atlas"] });
  ok("§1 every surface agrees: gifts, Top donors, LYBUNT, splits, at risk, people, the volunteer starter", r.ok, r.diffs);
  const facts = r.facts || {};
  const t4 = Object.keys(facts).filter(k => k.startsWith("truth4"));
  ok("§1 the truth4 pairs ran (gifts, the $0 rows, Top 50, LYBUNT, a split fund, at risk, Everyone, with email, the starter)", t4.length >= 10, t4);
  ok("§1 the fixture's $0 row is a fact the pairs saw", (facts["truth4 the $0 rows are said apart"] || {})["the rows at $0"] === 1, facts["truth4 the $0 rows are said apart"]);

  // ── §2 the browser ────────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const lg = await api("POST", "/auth/login", null, { email: f.owner, password: f.password });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);

    await page.goto(`${APP}/app/reports?report=lybunt`, { waitUntil: "networkidle", timeout: 60000 });
    const head = (await page.locator('[data-testid="bunt-header-count"]').first().textContent({ timeout: 20000 }).catch(() => "")) || "";
    const rows = await page.locator("table tbody tr").count().catch(() => 0);
    const ly = (await api("GET", "/reports/lybunt", tok)).body;
    ok("§2 LYBUNT's header counts its rows, the Fenwick household once", new RegExp(`^${ly.units.length} donors and households`).test(head.trim()) && ly.units.length === 3,
      { head, units: ly.units.length, rows });
    ok("§2 …and the household's row says household, with Louisa in it and not on a row of her own",
      ly.units.some(u => u.unit === "household" && (u.members || []).some(m => m.id === f.ids.louisa)) && !ly.units.some(u => u.id === f.ids.louisa && !u.members), ly.units.map(u => u.name));

    await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("Lost & Found", { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.getByText(/^Lapsed 12 to 24 months/).first().click().catch(() => {});
    const tile = await page.getByText("At risk · last year of giving").first().locator("xpath=..").textContent({ timeout: 15000 }).catch(() => "");
    // Lapsed 12 to 24 months: Hollis $2,500 + $400 + $600, Oswin $75 + $125, Louisa $650, each in the year ending on their last gift.
    ok("§2 Lost & Found's at-risk tile names its basis and adds each person's last year of giving", /At risk · last year of giving\$4,350/.test(tile), tile);

    await page.goto(`${APP}/app/home`, { waitUntil: "networkidle", timeout: 60000 });
    const body = await page.evaluate(() => document.body.innerText);
    ok("§2 Home never calls its set follow-ups beside the Tasks badge", !/people to follow up|Open follow-ups/.test(body), body.match(/.{0,40}follow.{0,40}/g));
    ok("§2 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
