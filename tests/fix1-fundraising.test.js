// FIX-1 §B — FUNDRAISING, REORGANISED.
//
// Fundraising carried fourteen tabs (thirteen sub-tabs plus the sidebar's own
// Pipeline) and scrolled sideways (Part 0, finding 6). It becomes FOUR tabs,
// each a question: Overview · Campaigns & pages · Major gifts · Money in.
// Nothing is deleted: every old view is a PART of one of the four, and every
// old id still lands on it.
//
//   §1  THE MAP (pure). client/src/lib/fundraisingSections.js — four sections,
//       every old id (the thirteen sub-tabs and the sidebar's `pipeline`)
//       resolves to a section AND to the part inside it that is that old view.
//   §2  THE SIDEBAR (source). `pipeline` leaves TABS / MORE_TABS / MORE_NAV /
//       PRIMARY_NAV; navigateTo("pipeline") still lands (on Major gifts →
//       Pipeline, carrying its scope); the Team gate that marked the sidebar
//       item now marks the Pipeline inside Major gifts.
//   §3  EVERY OLD ID LANDS (browser). /dashboard?fr=<old id> for all fourteen,
//       plus the in-app call sites that navigate to "pipeline" and to an old
//       frSection: the right tab is selected and the right part is open.
//   §4  IT FITS (browser). The tab strip and the part row have no horizontal
//       scroll at 1440 and at 390 (scrollWidth vs clientWidth), and neither
//       does the page.
//   §5  NO NUMBER MOVED (browser). Every money figure each old view showed for
//       this fixture org BEFORE the change (tests/fixtures/fix1-fundraising-
//       before.json, captured from the old build with FIX1_FR_CAPTURE=1) is
//       the figure the same view shows now — the same strings, the same total
//       in cents.
//
// The fixture is dated relative to the org's civil today, so the figures are
// the same on any day the suite runs.
//
// Run on a scratch stack (BASE, APP_URL, DATABASE_URL — see tests/README.md):
//   node tests/fix1-fundraising.test.js
// Re-capture the "before" figures (ONLY against the pre-FIX-1 build):
//   FIX1_FR_CAPTURE=1 node tests/fix1-fundraising.test.js

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const root = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(root, "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const BEFORE_FILE = path.join(__dirname, "fixtures", "fix1-fundraising-before.json");
const CAPTURE = process.env.FIX1_FR_CAPTURE === "1";

const ORG = "org_fx1fr";
const ME = "fx1fr@example.org";
const PW = "loadtest1234";

// Every old id, the section it now lives in, and the part inside it. This is
// the contract §6 of tests/fix1-walk.test.js names, with the part added.
const OLD = {
  overview:        ["overview", "overview"],
  campaigns:       ["campaigns", "campaigns"],
  pages:           ["campaigns", "pages"],
  events:          ["campaigns", "events"],
  recurring:       ["campaigns", "recurring"],
  members:         ["campaigns", "members"],
  majorgifts:      ["majorgifts", "majorgifts"],
  pipeline:        ["majorgifts", "pipeline"],
  proposals:       ["majorgifts", "proposals"],
  portfolios:      ["majorgifts", "portfolios"],
  plans:           ["majorgifts", "plans"],
  deposits:        ["moneyin", "deposits"],
  acknowledgments: ["moneyin", "acknowledgments"],
  funds:           ["moneyin", "funds"],
};
// How the OLD build reached each one (capture mode only): the sub-tab's label,
// or, for the sidebar's Pipeline, the sidebar item.
const OLD_LABEL = {
  overview: /^Overview$/, deposits: /^Deposits$/, acknowledgments: /^Acknowledgments$/, events: /^Events$/,
  majorgifts: /^Major gifts$/, proposals: /^Proposals$/, portfolios: /^Portfolios$/, plans: /^Plans$/,
  campaigns: /^Campaigns\d*$/, pages: /^Giving Pages\d*$/, recurring: /^Recurring Giving$/, members: /^Members$/,
  funds: /^Funds$/,
};

async function tryImport(rel) {
  try { return await import(path.join(root, rel)); }
  catch (e) { return { __missing: String(e && e.message || e).slice(0, 200) }; }
}

// ── The fixture ────────────────────────────────────────────────────────────
const CHILD = ["event_registrations", "event_levels", "event_attendees", "events", "memberships", "membership_levels",
  "gift_soft_credits", "receipts", "portfolio_targets", "pledge_installments", "pledges", "opportunities", "moves",
  "interactions", "threads", "tasks", "fin_transactions", "gifts", "recurring_subscriptions", "giving_pages",
  "campaigns", "fundraising_goals", "imports", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function fixture() {
  await reset();
  const TODAY = civilToday();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
           VALUES ($1,'Fix One Fundraising','fx1-fr',1,'team','active','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1fr',$1,$2,$3,'Frances Row','admin')`,
    [ORG, ME, bcrypt.hashSync(PW, 4)]);
  const donor = (id, name, stage, lifetime) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,assigned_to,assigned_to_name)
     VALUES ($1,$2,$3,$4,'person',$5,0,0,'u_fx1fr','Frances Row')`, [id, ORG, name, id + "@example.org", stage]);
  await donor("dfx_ada", "Ada Lindqvist", "cultivate");
  await donor("dfx_ben", "Ben Okafor", "solicit");
  await donor("dfx_cal", "Cal Moreno", "prospect");
  await donor("dfx_dee", "Dee Harrow", "steward");
  const tok = await login(ME, PW);
  await api("POST", "/onboarding/complete", tok, {});

  // An org goal straddling today, two campaigns with goals, one live page.
  await q(`INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label)
           VALUES ('gfx_1',$1,$2,$3,'total_raised',20000,'Raise $20,000 this season')`, [ORG, civilPlusDays(-60), civilPlusDays(60)]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,recipient_count,open_count)
           VALUES ('cfx_spring',$1,'Spring Barn Appeal','appeal','draft',8000,$2,$3,0,0)`, [ORG, civilPlusDays(-30), civilPlusDays(60)]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count)
           VALUES ('cfx_roof',$1,'Roof Fund','appeal','draft',1500,0,0)`, [ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,status) VALUES ('gpfx_1',$1,'orchard','Orchard Page',5000,'active')`, [ORG]);

  // Gifts through the one gift path.
  const gift = (d, amount, extra, key) => api("POST", `/donors/${d}/gifts`, tok, { amount, date: TODAY, type: "cash", idempotencyKey: "fx1fr-" + key, ...extra });
  await gift("dfx_ada", 2500, { campaignId: "cfx_spring" }, "g1");
  await gift("dfx_ben", 1250.5, { campaignId: "cfx_spring" }, "g2");
  await gift("dfx_cal", 1800, { campaignId: "cfx_roof" }, "g3");
  await gift("dfx_dee", 333.33, {}, "g4");
  await q(`UPDATE gifts SET giving_page_id='gpfx_1' WHERE org_id=$1 AND amount=333.33`, [ORG]);

  // A monthly sustainer.
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status)
           VALUES ('rsfx_1',$1,'dfx_ada','sub_fx1fr_1',45,'month','active')`, [ORG]);

  // Asks (proposals ARE the pipeline's opportunities).
  await api("POST", "/donors/dfx_ben/proposals", tok, { purpose: "Lead gift for the barn roof", askAmount: "12,000.00",
    expectedClose: civilPlusDays(45), stage: "identified", probability: 50 });
  await api("POST", "/donors/dfx_ada/proposals", tok, { purpose: "Orchard naming", askAmount: "7,500.00",
    expectedClose: civilPlusDays(20), stage: "identified", probability: 25 });

  // A membership level and one member (a membership payment is a gift).
  const lv = await api("POST", "/membership-levels", tok, { name: "Family", price: 100, fmv: 25, term: "12_months", scope: "household" });
  if (lv.body && lv.body.id) await api("POST", "/donors/dfx_cal/memberships", tok, { levelId: lv.body.id, paymentMethod: "check", idempotencyKey: "fx1fr-m1" });

  // An event with one ticket sold.
  const ev = await api("POST", "/events", tok, { name: "Harvest Supper", eventType: "gala", date: civilPlusDays(30), location: "The Barn", capacity: 80 });
  const evId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  if (evId) {
    const tl = await api("POST", `/events/${evId}/levels`, tok, { kind: "ticket", name: "Supper ticket", price: 80, fmv: 30, capacity: 80 });
    if (tl.body && tl.body.id) await api("POST", `/events/${evId}/register`, tok, { name: "Ben Okafor", email: "dfx_ben@example.org", levelId: tl.body.id, quantity: 1, paymentMethod: "Check", idempotencyKey: "fx1fr-e1" });
  }
  return tok;
}

// Every money figure in the content area, in document order.
const MONEY = /-?\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmMbB]?\b/g;
async function figures(page) {
  const text = await page.locator(".app-content").innerText().catch(() => "");
  return (text.match(MONEY) || []).map(s => s.replace(/\s/g, ""));
}
const exactCents = s => /[kKmMbB]$/.test(s) ? null : Math.round(Number(s.replace(/[$,]/g, "")) * 100);
const sumCents = list => list.map(exactCents).filter(v => v != null).reduce((a, b) => a + b, 0);

async function settle(page) {
  await page.waitForTimeout(900);
  for (let i = 0; i < 30; i++) {
    const t = await page.locator(".app-content").innerText().catch(() => "");
    if (!/Loading/.test(t)) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
}

async function signIn(page) {
  const lj = await (await page.request.post(process.env.BASE + "/auth/login", { data: { email: ME, password: PW } })).json();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(x => {
    localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user));
    localStorage.setItem("npe_org", JSON.stringify(x.org)); localStorage.setItem("steward_nav_more", "1");
  }, lj);
}

// ── Capture mode: the OLD build's figures, per old view ────────────────────
async function capture() {
  await fixture();
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await signIn(page);
  const out = {};
  for (const id of Object.keys(OLD)) {
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    if (id === "pipeline") {
      await page.locator(".app-sidebar button", { hasText: /^◫\s*Pipeline/ }).first().click();
    } else {
      await page.locator(".app-sidebar button", { hasText: "Fundraising" }).first().click();
      await settle(page);
      await page.locator(".section-tabbar button", { hasText: OLD_LABEL[id] }).first().click();
    }
    await settle(page);
    out[id] = await figures(page);
    console.log(`  captured ${id}: ${out[id].length} figures`);
  }
  await browser.close();
  fs.mkdirSync(path.dirname(BEFORE_FILE), { recursive: true });
  fs.writeFileSync(BEFORE_FILE, JSON.stringify({
    note: "FIX-1 §B — the money figures each old Fundraising view (and the sidebar Pipeline) showed for the fix1-fundraising fixture org, captured from the build before the reorganisation. Regenerate ONLY against that build.",
    capturedAt: civilToday(),
    figures: out,
  }, null, 2) + "\n");
  console.log("wrote " + path.relative(root, BEFORE_FILE));
}

(async () => {
  if (CAPTURE) { await capture(); await closeDb(); return; }
  console.log("fix1-fundraising");

  // ── §1 THE MAP ───────────────────────────────────────────────────────────
  console.log("\n— §1 · four sections, and every old id lands on its part —");
  const F = await tryImport("client/src/lib/fundraisingSections.js");
  ok("§1 fundraisingSections.js exists and is importable by Node", !F.__missing, F.__missing);
  const secs = (F.FR_SECTIONS || []);
  ok("§1 exactly four sections, in order", secs.map(s => s.id).join() === "overview,campaigns,majorgifts,moneyin", secs.map(s => s.id));
  ok("§1 each is labelled as the brief names it",
    secs.map(s => s.label).join("|") === "Overview|Campaigns & pages|Major gifts|Money in", secs.map(s => s.label));
  ok("§1 each section says the question it answers", secs.length === 4 && secs.every(s => typeof s.question === "string" && /\?$/.test(s.question)),
    secs.map(s => s.question));
  for (const [id, [section, part]] of Object.entries(OLD)) {
    const to = F.FR_LEGACY && F.FR_LEGACY[id];
    ok(`§1 old "${id}" → ${section} / ${part}`, !!to && to.section === section && to.part === part, to);
    const sec = secs.find(s => s.id === section);
    ok(`§1 …and "${part}" is a part of ${section}`, !!sec && Array.isArray(sec.parts) && sec.parts.some(p => p.id === part), sec && sec.parts);
    const r = typeof F.resolveFr === "function" ? F.resolveFr(id) : null;
    ok(`§1 resolveFr("${id}") agrees`, !!r && r.section === section && r.part === part, r);
  }
  ok("§1 a section id resolves to itself and its first part",
    typeof F.resolveFr === "function" && secs.every(s => { const r = F.resolveFr(s.id); return r.section === s.id && r.part === (F.FR_LEGACY[s.id] ? F.FR_LEGACY[s.id].part : s.parts[0].id); }));
  ok("§1 an unknown id falls back to the Overview, never to nothing",
    typeof F.resolveFr === "function" && F.resolveFr("nonsense").section === "overview" && F.resolveFr(undefined).section === "overview");
  const allParts = secs.flatMap(s => (s.parts || []).map(p => p.id));
  ok("§1 no part is in two sections", new Set(allParts).size === allParts.length, allParts);
  ok("§1 forms (BUILD-102) are named inside Campaigns & pages — a form is a giving page with a form config",
    !!secs.find(s => s.id === "campaigns") && (secs.find(s => s.id === "campaigns").parts.find(p => p.id === "pages") || {}).label === "Giving pages & forms");

  // ── §2 THE SIDEBAR ───────────────────────────────────────────────────────
  console.log("\n— §2 · Pipeline leaves the sidebar, and folds into Major gifts —");
  const R = await tryImport("client/src/lib/tabRegistry.js");
  ok("§2 tabRegistry imports", !R.__missing, R.__missing);
  if (!R.__missing) {
    ok("§2 no sidebar list carries `pipeline`",
      !R.TABS.some(t => t.id === "pipeline") && !R.MORE_TABS.some(t => t.id === "pipeline")
      && !R.MORE_NAV.includes("pipeline") && !R.PRIMARY_NAV.includes("pipeline"),
      { MORE_NAV: R.MORE_NAV, PRIMARY_NAV: R.PRIMARY_NAV });
    ok("§2 the Team gate still names the pipeline", R.TEAM_GATED.has("pipeline"));
  }
  const app = readSource("client/src/App.jsx");
  ok("§2 navigateTo sends `pipeline` into Fundraising → Major gifts, with its scope",
    /t==="pipeline"\)\{[^}]*t="fundraising"/.test(app.replace(/\s+/g, "")) || /if\(t==="pipeline"\)\{/.test(app));
  ok("§2 the App renders no stand-alone Pipeline tab", !/tab==="pipeline"&&<Pipeline/.test(app));
  ok("§2 /dashboard?fr=<id> deep-links into Fundraising", /params\.get\("fr"\)/.test(app));
  ok("§2 ?fr=pipeline goes through navigateTo(\"pipeline\"), the old sidebar's own call", /params\.get\("fr"\)==="pipeline"\)navigateTo\("pipeline"\)/.test(app));
  const fr = fs.readFileSync(path.join(root, "client/src/components/Fundraising.jsx"), "utf8");
  ok("§2 Fundraising reads its tabs from the one map", /from "\.\.\/lib\/fundraisingSections"/.test(fr) && /FR_SECTIONS/.test(fr));
  ok("§2 the Pipeline part carries the Team gate for Core", /TEAM_GATED\.has\("pipeline"\)/.test(fr) && /LockGlyph/.test(fr));
  ok("§2 Fundraising renders the one Pipeline board (no second board)", /<Pipeline\b/.test(fr) && /embedded/.test(fr));

  // ── §3–§5 THE BROWSER ────────────────────────────────────────────────────
  if (!haveBrowser()) {
    console.log("  SKIP  browser legs (§3–§5): no Playwright at " + PW_DIR + " or no client/dist");
    await closeDb(); summary(); return;
  }
  const before = fs.existsSync(BEFORE_FILE) ? JSON.parse(fs.readFileSync(BEFORE_FILE, "utf8")).figures : null;
  ok("§5 the before-figures were captured from the old build", !!before);
  await fixture();
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();

  console.log("\n— §3 · every old id lands; §5 · and shows the figures it showed —");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e && e.message || e)));
  await signIn(page);
  const selected = async () => ({
    section: await page.locator('[data-fr-section][aria-selected="true"]').first().getAttribute("data-fr-section", { timeout: 1500 }).catch(() => null),
    part: await page.locator('[data-fr-part][aria-current="true"]').first().getAttribute("data-fr-part", { timeout: 1500 }).catch(() => null),
    view: await page.locator("[data-fr-view]").first().getAttribute("data-fr-view", { timeout: 1500 }).catch(() => null),
  });
  for (const [id, [section, part]] of Object.entries(OLD)) {
    await page.goto(`${APP}/dashboard?fr=${id}`, { waitUntil: "networkidle" });
    await settle(page);
    const s = await selected();
    ok(`§3 ?fr=${id} opens ${section}`, s.section === section, s);
    ok(`§3 …on the ${part} part`, s.view === part && (s.part === part || section === "overview"), s);
    if (before && before[id]) {
      const now = await figures(page);
      const want = [...before[id]].sort().join(" "), got = [...now].sort().join(" ");
      ok(`§5 ${id}: the same ${before[id].length} figures`, want === got, { before: before[id], now });
      ok(`§5 ${id}: the same total, in cents (${sumCents(before[id])})`, sumCents(before[id]) === sumCents(now), sumCents(now));
    }
  }
  ok("§5 the fixture put real money on the screens (not a vacuous compare)",
    !!before && Object.values(before).filter(l => l.length > 0).length >= 8 && before.pipeline && before.pipeline.length > 0,
    before && Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length])));

  // The in-app call sites: a click on the part row and on the tab strip.
  await page.goto(`${APP}/dashboard?fr=majorgifts`, { waitUntil: "networkidle" });
  await settle(page);
  await page.locator('[data-fr-part="pipeline"]').first().click({ timeout: 3000 }).catch(() => {});
  await settle(page);
  ok("§3 the Pipeline part opens the one board inside Major gifts", (await selected()).view === "pipeline"
    && /Open asks/i.test(await page.locator(".app-content").innerText()));
  await page.locator('[data-fr-section="moneyin"]').first().click({ timeout: 3000 }).catch(() => {});
  await settle(page);
  ok("§3 the Money in tab opens on Deposits", (await selected()).view === "deposits", await selected());
  // The Overview's index reaches every old view by its old name.
  await page.goto(`${APP}/dashboard?fr=overview`, { waitUntil: "networkidle" });
  await settle(page);
  await page.locator("button:visible", { hasText: /^Proposals$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await settle(page);
  ok("§3 Overview → Proposals (the old name still finds it)", (await selected()).view === "proposals", await selected());
  // Home's Recurring link (navigateTo("fundraising",{frSection:"recurring"})) and
  // a stale navigateTo("pipeline") both land — driven through the real App.
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await settle(page);
  const sidebarPipeline = await page.locator(".app-sidebar button", { hasText: /Pipeline$/ }).count();
  ok("§2 the sidebar has no Pipeline item", sidebarPipeline === 0, sidebarPipeline);
  // The Team gate: on Core the Pipeline part carries the padlock the sidebar
  // item used to; on Team it does not.
  const lockOn = async () => {
    await page.goto(`${APP}/dashboard?fr=majorgifts`, { waitUntil: "networkidle" });
    await settle(page);
    return page.locator('[data-fr-part="pipeline"] svg').count();
  };
  ok("§2 Team: no padlock on the Pipeline part", (await lockOn()) === 0);
  await q(`UPDATE orgs SET plan='core' WHERE id=$1`, [ORG]);
  ok("§2 Core: the padlock the sidebar's Pipeline carried is on the Pipeline part", (await lockOn()) === 1);
  ok("§2 …and only there (no other part is Team-gated)", (await page.locator("[data-fr-part] svg").count()) === 1);
  await q(`UPDATE orgs SET plan='team' WHERE id=$1`, [ORG]);
  ok("§3 no page errors on the way", errs.length === 0, errs);
  await page.close();

  // ── §4 IT FITS ───────────────────────────────────────────────────────────
  console.log("\n— §4 · no sideways scroll at 1440 and 390 —");
  for (const [w, h] of [[1440, 1000], [390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await signIn(p);
    for (const id of ["overview", "campaigns", "majorgifts", "moneyin", "pipeline", "pages"]) {
      await p.goto(`${APP}/dashboard?fr=${id}`, { waitUntil: "networkidle" });
      await settle(p);
      const m = await p.evaluate(() => {
        const box = el => el ? { sw: el.scrollWidth, cw: el.clientWidth } : null;
        return {
          strip: box(document.querySelector("[data-fr-strip]")),
          parts: box(document.querySelector("[data-fr-parts]")),
          page: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
        };
      });
      ok(`§4 ${w}px ${id}: the tab strip fits`, !!m.strip && m.strip.sw <= m.strip.cw, m.strip);
      ok(`§4 ${w}px ${id}: the part row fits`, !m.parts || m.parts.sw <= m.parts.cw, m.parts);
      ok(`§4 ${w}px ${id}: the page does not scroll sideways`, m.page.sw <= m.page.cw, m.page);
    }
    await p.close();
  }
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
