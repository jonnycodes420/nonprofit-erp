// smoke-walk — CHORE-2. EVERY SCREEN, OPENED, AT LEAST ONCE.
//
// The 238 suites retired in CHORE-2 (docs/tests-retired.md) included nearly
// all the per-screen browser checks. This is what replaces them: one walk
// that opens every route in `client/src/lib/tabRegistry.js`, plus every tab
// of a donor's profile for three different donors, and fails on the four
// things that mean a screen is BROKEN rather than merely different:
//
//   1. a blank main area — the page rendered nothing;
//   2. an error boundary — React caught a throw and replaced the screen;
//   3. a 5xx from anything the page fetched;
//   4. a console error, including an uncaught exception or a failed request.
//
// HOW IT NAVIGATES, and why that matters. Until FIX-13 Part 6 only
// `/dashboard` and `/donors/:id` were real routes; every other tab was
// state inside <App/>, switched by `navigateTo(id)` (tabs are /app/:tab now). The first draft of this
// suite walked `/tasks`, `/reports` and the rest as URLs, they all fell
// through the router's catch-all to the dashboard, and it walked the SAME
// screen fifteen times and passed. So it clicks the nav, opens the More
// group, and asserts the tab it asked for is the tab it got.
//
// It deliberately does NOT assert what any screen SAYS. Copy, layout and
// numbers are what the retired suites held, and the trade CHORE-2 made is
// that those are reviewed by eye and guarded, where they touch money, donor
// data, email or security, by the 34 suites that stayed. What this suite
// promises is narrower and worth having on every push: nothing is white, and
// nothing is on fire.
//
// Target: under two minutes. It reuses ONE browser and ONE logged-in context
// and navigates within the SPA where it can.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without
// Playwright or a localhost-API dist.

const path = require("path");
const fs = require("fs");
const { ok, summary, api, closeDb, browserLegOrSkip } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";

// GTM-1a A — REQUIRE_BROWSER=1 (CI) turns this skip into a failure, so a
// missing Chromium or an unbuilt dist can never read as a green battery.
const skip = why => { browserLegOrSkip(why); console.log("\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const API_ORIGIN = BASE.replace(/^https?:\/\//, "");
const assetDir = path.join(DIST, "assets");
const distJs = fs.existsSync(assetDir) ? fs.readdirSync(assetDir).filter(f => f.endsWith(".js")) : [];
if (!distJs.some(f => fs.readFileSync(path.join(assetDir, f), "utf8").includes(API_ORIGIN)))
  skip("client/dist not built against the local API");
let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

// ── the routes, read from the registry rather than listed here ────────────
// A tab added to the app is walked by this suite the day it is added, with no
// edit here. That is the whole point of the registry being JSX-free.
function routes() {
  const src = fs.readFileSync(path.join(ROOT, "client", "src", "lib", "tabRegistry.js"), "utf8");
  const ids = new Set();
  for (const block of ["TABS", "BOTTOM_TABS", "MORE_TABS"]) {
    const m = new RegExp(`const ${block}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(src);
    if (!m) continue;
    for (const line of m[1].split("\n")) {
      if (/^\s*\/\//.test(line)) continue;            // a commented-out tab is not a route
      const id = /\{\s*id\s*:\s*"([^"]+)"/.exec(line);
      if (id) ids.add(id[1]);
    }
  }
  // Deep-link ids that have no nav entry of their own but must still open.
  ids.add("workflows");
  return [...ids];
}

const PROFILE_TABS = ["overview", "gifts", "funds", "related", "materials", "activity"];
// The rail shows a LABEL, the registry holds an id; the two differ for three
// tabs and a walk that assumed they matched would skip them.
const LABELS = { dashboard: "Home", board: "Dashboards", portal: "Donor Portal", agent: "Agent", workflows: "Agent", p2p: "Peer-to-peer" };
// FIX-25: rail ids that open a PART of Fundraising (tabRegistry FR_PART_TABS).
// Each is walked like a tab and must land on its own part, not the Overview.
const FR_PART_TABS = Object.fromEntries([...((/const FR_PART_TABS\s*=\s*\{([^}]*)\}/.exec(
  fs.readFileSync(path.join(ROOT, "client", "src", "lib", "tabRegistry.js"), "utf8")) || [0, ""])[1]
  .matchAll(/(\w+)\s*:\s*"([^"]+)"/g))].map(m => [m[1], m[2]]));
// Read from the registry, so a tab that becomes visible is walked from that
// day and a tab that becomes hidden stops being a failure.
const HIDDEN_FOR_CRM = new Set(
  (/const CRM_HIDDEN_TABS\s*=\s*new Set\(\[([^\]]*)\]/.exec(
    fs.readFileSync(path.join(ROOT, "client", "src", "lib", "tabRegistry.js"), "utf8")) || [0, ""])[1]
    .split(",").map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean));
const DEMO = { email: "director@harborlight.demo", password: "demo-harbor-2026" };

// What counts as "on fire". Three things are noise on the local stack and
// nowhere else, so each is excluded BY URL with its reason:
//   · /_vercel/*        — Vercel's analytics stubs, which exist in production
//                         and not on the local preview. Note the console TEXT
//                         for a failed resource does not carry the URL
//                         ("Failed to load resource: …404"), which is why the
//                         filter reads location().url and not the message.
//   · fonts.googleapis  — the webfont CDN, blocked or slow in a sandbox.
//   · /ai/stream 503    — the Anthropic gate refusing because no key is
//                         configured locally. That is the gate working; a
//                         screen that says so is not a broken screen.
const IGNORABLE_URL = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
const IGNORABLE_TEXT = /Download the React DevTools|Unexpected token '<'/;
const EXPECTED_5XX = /\/ai\/stream/;

// ── FIX-21 · GROUPS ANSWER IN UNDER HALF A SECOND ─────────────────────────
// Clicking a group was six seconds of white on prod: the page asked for its
// 22 figures one at a time, each re-reading the group and re-running its
// rule, up to 100 round trips. A screen that takes that long to answer is a
// blank screen to the person looking at it, so this walk times the Groups
// list and a 1,000-member group page (one kept by hand, one by a rule) and
// fails either over 500 ms. Its own fixture org, never the demo; the rows are
// fresh, so the planner has had no ANALYZE to lean on, as on a busy prod.
// The median of three warm reads, so one slow tick on a runner is not a fail.
// PROVEN ABLE TO FAIL (2026-10-03): with the old routes/groups.js put back
// (one count per group, 22 figure reads per page, nested loops allowed) all
// three went red locally: the list at 633 ms and both pages over 4 seconds.
const PERF_ORG = "org_fix21perf", PERF_ADMIN = "admin@fix21perf.local", BUDGET_MS = 500;
async function groupsAreQuick() {
  const bcrypt = require("bcryptjs");
  const { q, login } = require("./helpers");
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [PERF_ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [PERF_ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Groups Speed Fixture','fix21-perf',1,'active','team','America/New_York')`, [PERF_ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix21perf',$1,$2,$3,'Speed Admin','admin')`, [PERF_ORG, PERF_ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  // 1,000 people, five gifts each across the last two years.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
           SELECT 'd_fix21_' || i, $1, 'Speed Person ' || lpad(i::text, 4, '0'), 'p' || i || '@fix21perf.local', 'steward', 'system:test', 'test'
             FROM generate_series(1, 1000) i`, [PERF_ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
           SELECT 'g_fix21_' || i || '_' || k, $1, 'd_fix21_' || i, 25 + (i % 40) * 10 + k,
                  to_char(CURRENT_DATE - (k * 140 + i % 120), 'YYYY-MM-DD'), 'system:test', 'test'
             FROM generate_series(1, 1000) i, generate_series(1, 5) k`, [PERF_ORG]);
  const tok = await login(PERF_ADMIN);
  const byHand = await api("POST", "/groups", tok, { name: "Everyone by hand", kind: "static" });
  const byRule = await api("POST", "/groups", tok, { name: "Everyone who gave", kind: "dynamic", rules: { given: "ever" } });
  ok("§speed the two 1,000-member groups are made", byHand.status === 201 && byRule.status === 201, [byHand.status, byRule.status]);
  await q(`INSERT INTO group_members (org_id, group_id, donor_id, added_by, added_by_name)
           SELECT $1, $2, id, 'system:test', 'test' FROM donors WHERE org_id = $1`, [PERF_ORG, byHand.body.id]);
  const median = async path => {
    await api("GET", path, tok);                        // warm: the first read pays for the connection
    const runs = [];
    let last;
    for (let i = 0; i < 3; i++) { last = await api("GET", path, tok); runs.push(last.ms); }
    runs.sort((a, b) => a - b);
    return { ms: runs[1], runs, last };
  };
  const list = await median("/groups");
  ok(`§speed the Groups list answers in under ${BUDGET_MS} ms (${list.ms} ms)`, list.last.status === 200 && list.ms < BUDGET_MS, list.runs);
  ok("§speed the list counts 1,000 in each group", (list.last.body.groups || []).every(g => g.count === 1000), (list.last.body.groups || []).map(g => g.count));
  for (const [what, g] of [["kept by hand", byHand.body], ["by a rule", byRule.body]]) {
    const p = await median(`/groups/${g.id}`);
    ok(`§speed a 1,000-member group ${what} answers in under ${BUDGET_MS} ms (${p.ms} ms)`, p.last.status === 200 && p.ms < BUDGET_MS, p.runs);
    const people = (p.last.body.figures || []).find(f => f.label === "People");
    ok(`§speed the ${what} page lists its 1,000 people and counts them`, (p.last.body.members || []).length === 1000 && people && people.value === 1000,
       { members: (p.last.body.members || []).length, people: people && people.value });
  }
}

(async () => {
  console.log("smoke-walk");
  const login = await api("POST", "/auth/login", null, DEMO);
  if (login.status !== 200) {
    ok("the demo org is on this database (run scripts/seed-demo.js)", false, login.status);
    return summary("smoke-walk");
  }
  ok("logged in to the demo", true);
  const auth = login.body;

  await groupsAreQuick();

  const donors = await api("GET", "/donors?limit=3", auth.token);
  const three = (Array.isArray(donors.body) ? donors.body : (donors.body.donors || donors.body.rows || [])).slice(0, 3);
  ok("the demo has donors to walk", three.length === 3, three.length);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // Everything that means "on fire", collected per screen.
  let trouble = [];
  page.on("pageerror", e => trouble.push("threw: " + e.message.slice(0, 160)));
  page.on("console", m => {
    if (m.type() !== "error") return;
    const url = (m.location() && m.location().url) || "";
    if (IGNORABLE_URL.test(url)) return;
    const t = m.text();
    if (IGNORABLE_TEXT.test(t)) return;
    trouble.push("console: " + t.slice(0, 140) + (url ? ` <${url.replace(APP, "").replace(BASE, "").slice(0, 70)}>` : ""));
  });
  page.on("requestfailed", r => {
    if (IGNORABLE_URL.test(r.url())) return;
    // ERR_ABORTED IS THE WALK'S OWN DOING, NOT A BROKEN SCREEN. Clicking the
    // next tab, and then `page.goto` into a donor profile, cancels whatever
    // the screen before it still had in flight — on a slow runner that is
    // Finance's `/finance/overview`, a multi-month aggregate over the demo
    // org. The abort is then recorded against the NEXT leg, which is how a
    // perfectly good donor profile came to be reported as on fire. A request
    // the test cancelled says nothing about the screen; a request that fails
    // on its own merits still does, and still lands here.
    if (/ERR_ABORTED/.test((r.failure() || {}).errorText || "")) return;
    trouble.push(`request failed: ${r.url().replace(APP, "").replace(BASE, "").slice(0, 90)} (${(r.failure() || {}).errorText || "?"})`);
  });
  page.on("response", r => {
    if (r.status() < 500) return;
    if (EXPECTED_5XX.test(r.url())) return;
    trouble.push(`${r.status()} from ${r.url().replace(BASE, "").slice(0, 90)}`);
  });

  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);

  // A screen is OPEN when its main area has drawn something. Not "has the
  // right thing in it" — has anything at all, which is the difference between
  // a screen and a white rectangle.
  const look = async what => {
    // Give a slow runner (CI) up to 8s to draw; a blank screen still fails.
    await page.waitForFunction(() => {
      const m = document.querySelector(".app-content") || document.querySelector("main") || document.body;
      return (m.innerText || "").trim().length > 0 && m.querySelectorAll("*").length > 8;
    }, null, { timeout: 8000 }).catch(() => {});
    const state = await page.evaluate(() => {
      // `.app-content` IS the page body — the sidebar and the top bar are
      // outside it — so a screen that renders nothing leaves it nearly
      // empty. (Measured: a real Tasks screen is 189 characters and 21
      // nodes; a planted blank one is 0 and 0.)
      const main = document.querySelector(".app-content") || document.querySelector("main") || document.body;
      const boundary = /Something went wrong|An error occurred in this part|ErrorBoundary/i.test(main.innerText || "");
      return { text: (main.innerText || "").trim().length, nodes: main.querySelectorAll("*").length, boundary };
    });
    ok(`${what} — draws something`, state.text > 0 && state.nodes > 8, state);
    ok(`${what} — no error boundary`, !state.boundary, state.boundary);
    ok(`${what} — nothing on fire`, trouble.length === 0, trouble.slice(0, 3));
    trouble = [];
  };

  // FIX-13 Part 6 — REAL LINKS. Every donor name on Home, Donors and a report
  // is an <a href="/donors/:id"> to THAT donor, so Cmd-click, middle-click and
  // "Open in new tab" work. `pick` returns, for each name on screen, the href
  // of the anchor that carries it and the id that name belongs to (or null).
  const namesAreLinks = async (what, pick) => {
    const r = await page.evaluate(pick);
    const bad = r.filter(x => !x.href || (x.id && x.href !== "/donors/" + encodeURIComponent(x.id)) || !/^\/donors\/[^/?#]+$/.test(x.href));
    ok(`${what} — every donor name is a link to that donor's profile (${r.length} names)`, r.length > 0 && bad.length === 0,
       { names: r.length, bad: bad.slice(0, 3) });
  };

  // ── every tab, by clicking the nav ────────────────────────────────────
  trouble = [];
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await look("/dashboard");
  await namesAreLinks("Home", () => [...document.querySelectorAll(".attn-donor-name")].map(n => {
    const a = n.closest("a"); return { href: a && a.getAttribute("href"), id: null };
  }));

  // Two ids can share one nav entry (workflows deep-links into Agent), so the
  // walk visits each LABEL once.
  const want = [...new Map(routes().filter(id => id !== "dashboard")
    .map(id => [(LABELS[id] || id).toLowerCase(), id])).values()];
  const seen = [];
  for (const id of want) {
    trouble = [];
    // NAV-1 — the rail is groups now and nothing is behind a fold, so every
    // label is on screen. The More fallback below is kept as a belt: it costs
    // one $$eval when a label is genuinely missing, and it is the difference
    // between "unreachable" and "unreachable unless you expand something".
    // A nav button's text is its ICON, a newline, then its label
    // ("◈\nHome"). Rather than fight the matcher's whitespace handling, the
    // buttons are read once and matched on ANY of their lines. Not the last
    // line: a tab with a count badge reads "◻\nTasks\n2", and matching the
    // last line reported Tasks as unreachable when it was simply carrying a
    // number.
    const label = LABELS[id] || id;
    const indexOf = async () => page.$$eval(".side-nav-btn", (bs, want) =>
      bs.findIndex(b => (b.innerText || "").split("\n").some(l => l.trim().toLowerCase() === want.toLowerCase())), label);
    let i = await indexOf();
    if (i < 0) {
      const mi = await page.$$eval(".side-nav-btn", bs => bs.findIndex(b => /MORE/.test(b.innerText || "")));
      if (mi >= 0) { await page.locator(".side-nav-btn").nth(mi).click(); await page.waitForTimeout(400); }
      i = await indexOf();
    }
    if (i < 0) {
      // A tab the registry hides for this org's tier has no nav entry, and
      // that is the product working. Anything else has genuinely lost its
      // way into the app and is a failure.
      if (HIDDEN_FOR_CRM.has(id)) { console.log(`  SKIP  tab ${id} — hidden from the CRM for this org (tabRegistry CRM_HIDDEN_TABS)`); continue; }
      ok(`tab ${id} — reachable from the nav`, false, "no nav button whose label is " + label);
      continue;
    }
    const btn = page.locator(".side-nav-btn").nth(i);
    await btn.click();
    await page.waitForTimeout(1100);
    const current = (await page.locator(".side-nav-btn[aria-current]").first().innerText().catch(() => "")).trim();
    ok(`tab ${id} — the nav moved to it`,
       current.split("\n").some(l => l.trim().toLowerCase() === label.toLowerCase()), { asked: label, got: current });
    seen.push(current.trim().toLowerCase());
    await look(`tab ${id}`);
    if (FR_PART_TABS[id]) ok(`tab ${id}: opens the Fundraising part "${FR_PART_TABS[id]}"`,
      await page.locator(`[data-fr-view="${FR_PART_TABS[id]}"]`).count() === 1, page.url());
    if (id === "donors") await namesAreLinks("Donors", () => [...document.querySelectorAll(".dir-donor-row")].map(row => {
      const a = row.querySelector("a[href]"); return { href: a && a.getAttribute("href"), id: a && a.getAttribute("data-donor-link") };
    }));
    if (id === "reports") {
      const lybunt = page.locator('[data-testid="reports-rail"] [data-report-id="lybunt"]').first();
      if (await lybunt.count()) {
        await lybunt.click();
        await page.waitForSelector('tr[data-testid="report-row"][data-person-id]', { timeout: 10000 }).catch(() => {});
      }
      await namesAreLinks("Reports · LYBUNT", () => [...document.querySelectorAll('tr[data-testid="report-row"][data-person-id]')].map(tr => {
        const a = tr.querySelector('a[href^="/donors/"]'); return { href: a && a.getAttribute("href"), id: tr.getAttribute("data-person-id") };
      }));
      trouble = [];
    }
    // NAV-1 §2 — Dashboards is no longer a tab of its own; it is the first
    // group of the Reports rail. It still gets opened on every walk, from the
    // one place it now lives, so folding it in did not quietly stop walking it.
    if (id === "reports") {
      const dash = page.locator("[data-testid=\"reports-rail\"] [data-report-id^=\"dash:\"]").first();
      if (await dash.count()) {
        trouble = [];
        await dash.click();
        await page.waitForTimeout(1200);
        await look("reports · dashboards");
      } else {
        ok("reports · dashboards — the rail offers a dashboard", false, "no dash: item in the Reports rail");
      }
    }
  }
  ok("the walk visited a DIFFERENT screen each time (not the dashboard N times)",
     new Set(seen).size === seen.length, seen);

  // FIX-14 Part 5: THE OTHER RECORDS ARE LINKS TOO. One of each kind, on
  // the screen that lists it, is an <a> (data-record-link names the kind)
  // whose href is that record's own URL, naming a record that exists. A
  // kind drawn as a <button> or a <span> has no anchor and fails here.
  // FIX-14 Part 3: a household is drawn on the donor profile, so its row
  // opens the profile of the household's first person and its name must be
  // a link to /donors?household=<id> (householdHref).
  const ids = async (p, pick) => { const r = await api("GET", p, auth.token); try { return new Set(pick(r.body).map(x => x.id)); } catch { return new Set(); } };
  const known = {
    event: await ids("/events", b => b),
    campaign: await ids("/fundraising/overview", b => b.goals),
    fund: await ids("/finance/funds-detail", b => b.funds),
    journey: await ids("/journeys", b => b.journeys),
    gift: await ids("/acknowledgments/backlog", b => b.gifts),
    grant: await ids("/grants", b => b),
    volunteer: await ids("/volunteer-hub/roster", b => b.people),
    household: await ids("/households", b => b),
  };
  const hhList = (await api("GET", "/households", auth.token)).body;
  const hhPerson = Array.isArray(hhList) && hhList[0] ? hhList[0].primary_donor_id : null;
  const RECORDS = [
    ["event", "/app/events", /^\/app\/events\?event=([^&#]+)$/],
    ["campaign", "/app/fundraising?fr=campaigns", /^\/app\/fundraising\?fr=campaigns&campaign=([^&#]+)$/],
    ["fund", "/app/finance?subtab=funds", /^\/app\/finance\?subtab=funds&fund=([^&#]+)$/],
    ["journey", "/app/journeys", /^\/app\/journeys\?journey=([^&#]+)$/],
    ["gift", "/app/fundraising?fr=acknowledgments", /^\/donors\/[^/?#]+#gift-([^&#]+)$/],
    ["grant", "/app/grants", /^\/app\/grants\?grant=([^&#]+)$/],
    ["volunteer", "/app/volunteers", /^\/app\/volunteers\?volunteer=([^&#]+)$/],
    ["household", `/donors/${hhPerson}`, /^\/donors\?household=([^&#]+)$/],
  ];
  for (const [kind, url, shape] of RECORDS) {
    trouble = [];
    await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector(`[data-record-link="${kind}"]`, { timeout: 10000 }).catch(() => {});
    const r = await page.$$eval(`[data-record-link="${kind}"]`, els => els.map(e => ({ tag: e.tagName, href: e.getAttribute("href") })));
    const bad = r.filter(x => {
      const m = x.tag === "A" && shape.exec(x.href || "");
      return !m || (known[kind].size > 0 && !known[kind].has(decodeURIComponent(m[1])));
    });
    ok(`${kind}: every ${kind} on ${url} is a link to its own URL (${r.length})`, r.length > 0 && bad.length === 0,
       { found: r.length, bad: bad.slice(0, 3) });
  }
  trouble = [];

  // WIRE-1-ADDENDUM · ONE TEMPLATES TAB. "Templates" and "Email templates" were
  // the same thing twice. An old link to either lands on the one tab, the old
  // tab is gone from the bar, and every template from the three stores is on
  // it exactly once (letters and one-person emails, campaign starters, the
  // designed emails and their starters). Fails before the merge: there is no
  // templates-merged root and ?subtab=emailtemplates opens the old tab.
  {
    const [lt, cs, et] = await Promise.all(["/templates", "/campaigns/templates", "/email-templates"].map(p => api("GET", p, auth.token)));
    const want = (lt.body.templates || []).length + (cs.body.templates || []).length
      + (et.body.templates || []).filter(t => !t.archived).length + (et.body.starters || []).length;
    for (const sub of ["templates", "emailtemplates"]) {
      trouble = [];
      await page.goto(`${APP}/app/communications?subtab=${sub}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("[data-template-card]", { timeout: 15000 }).catch(() => {});
      const r = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[data-template-card]")].map(c => c.dataset.templateId);
        return { merged: !!document.querySelector('[data-testid="templates-merged"]'), n: ids.length, unique: new Set(ids).size,
          oldTab: [...document.querySelectorAll(".comm-tabbar button")].some(b => /email templates/i.test(b.innerText || "")) };
      });
      ok(`§templates ?subtab=${sub} lands on the one Templates tab with every template once (${r.n} of ${want})`,
        r.merged && !r.oldTab && r.n === want && r.unique === r.n, r);
      await look(`communications · templates (${sub})`);
    }
    // Let the tab's own reads finish before the walk leaves it: a read cut off
    // by the next page.goto logs "Failed to fetch" on the NEXT page (CI's
    // slower runner put it on the first donor profile).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
  trouble = [];

  for (const d of three) {
    for (const tab of PROFILE_TABS) {
      trouble = [];
      if (tab === "overview") {
        await page.goto(`${APP}/donors/${d.id}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => trouble.push("navigation: " + e.message.slice(0, 120)));
        await page.waitForTimeout(1300);
      } else {
        const btn = page.locator(`.dp-tabs button`).filter({ hasText: new RegExp(tab === "gifts" ? "Gifts" : tab, "i") }).first();
        if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); }
        else { ok(`donor ${d.id} — the ${tab} tab is on the profile`, false, "tab not found"); continue; }
      }
      await look(`donor ${d.id} · ${tab}`);
    }
  }

  // FIX-25 · DELETE A MEETING, THEN UNDO. A tester deleted a meeting and saw no
  // Undo. The walk deletes one of the demo's meetings from its profile, needs
  // the toast on screen, presses Undo, and needs the same row back by its id,
  // so the demo ends the walk exactly as it began.
  {
    trouble = [];
    const { q } = require("./helpers");
    const [m] = await q(`SELECT id, donor_id FROM interactions WHERE org_id = $1 AND type = 'meeting' ORDER BY date DESC, id LIMIT 1`, [(auth.org && auth.org.id) || auth.user.orgId]);
    ok("§undo the demo has a meeting to delete", !!m, m);
    if (m) {
      await page.goto(`${APP}/donors/${m.donor_id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const menu = page.locator('[aria-label="Edit or delete this meeting"]').first();
      await menu.waitFor({ timeout: 15000 }).catch(() => {});
      let shown = false, back = [];
      if (await menu.count()) {
        await menu.scrollIntoViewIfNeeded();
        await menu.click();
        await page.getByRole("menuitem", { name: "Delete" }).click();
        const toast = page.locator('[data-testid="undo-toast"]');
        shown = await toast.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
        const gone = (await q("SELECT id FROM interactions WHERE id = $1", [m.id])).length === 0;
        ok("§undo deleting a meeting takes it off the record at once", gone);
        if (shown) {
          await toast.getByRole("button", { name: /Undo/ }).click();
          await toast.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
        }
        back = await q("SELECT id FROM interactions WHERE id = $1", [m.id]);
      }
      ok("§undo deleting a meeting shows the Undo toast", shown);
      ok("§undo pressing Undo puts the same meeting back", back.length === 1, back);
      await look("donor profile after a meeting delete and Undo");
    }
  }

  await browser.close();
  await closeDb();
  summary("smoke-walk");
})().catch(e => { console.error(e); process.exit(1); });
