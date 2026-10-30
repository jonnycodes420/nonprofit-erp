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
// SECURE-2 item 5: and a fifth, on EVERY page any leg opens (giving pages,
// the donor portal and the marketing site included): a Content-Security-
// Policy violation. The preview serves vercel.json's policy, so a script the
// policy refuses on production is refused here, and fails the walk.
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
const units = require("./lib/units");   // FIX-60: a money figure is money, a count a count

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
  // AGENT-5: "workflows" deep-linked into the Agent page, which is gone; its
  // old address lands on Home with Atlas open (agent5-atlas covers that).
  return [...ids];
}

// PROFILE-1 (header): one row of ten tabs, found by data-tab.
const PROFILE_TABS = ["overview", "gifts", "asks", "conversations", "emails", "tasks", "notes", "funds", "related", "files"];
// The rail shows a LABEL, the registry holds an id; the two differ for three
// tabs and a walk that assumed they matched would skip them.
const LABELS = { dashboard: "Home", board: "Dashboards", portal: "Donor Portal", p2p: "Peer-to-peer" };
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

// FIX-60 item 5 · SENTENCE CASE EVERYWHERE, AND THE "?" AFTER WHAT IT EXPLAINS.
// Runs in the page on every screen `look` checks (every tab, every profile tab).
// (a) Labels are sentence case. The ONE exception is the eyebrow: an element
// inside `.eyebrow` (GlobalStyles) whose computed size is at most 11px, the
// small letter-spaced group label over the rail's lists. Anything else whose
// computed `text-transform` is uppercase fails, and so does a literal ALL-CAPS
// run of two or more words ("MY PORTFOLIO") typed into the source.
// (c) A figure's "?" never sits between a count and its noun ("0 ? grants"):
// after a count's "?" the next word may be "of", "and", "·" and the like, never
// the thing counted.
// HOW IT GOES RED: on main (2b4951a) SectionLabel, the profile tiles and the
// Home eyebrows are uppercase on every tab, and Grants · Reports draws "0 ? grants".
function wordsOnScreen() {
  const caps = [], why = [];
  const shown = el => { const r = el.getClientRects(); return r.length > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const eyebrow = (el, cs) => !!el.closest(".eyebrow") && parseFloat(cs.fontSize) <= 11;
  for (const el of document.body.querySelectorAll("*")) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|OPTION|SELECT|TITLE)$/.test(el.tagName)) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ").trim();
    if (!/[A-Za-z]{2}/.test(own) || !shown(el)) continue;
    const cs = getComputedStyle(el);
    if (eyebrow(el, cs)) continue;
    if (cs.textTransform === "uppercase" && /[a-z]/.test(own)) caps.push("uppercase: " + own.slice(0, 50));
    else if (/\b[A-Z][A-Z'’]+(?:[ \t]+[A-Z][A-Z'’]+)+\b/.test(own) && !/\b(?:LYBUNT|SYBUNT)\b/.test(own)) caps.push("typed in caps: " + own.slice(0, 50));
  }
  const STOP = /^\s*(?:of|and|or|to|in|at|from|for|with|by|on|than|out|over|under|per|vs|is|are|was|were|·|—|-|\)|,|\.|;|:|$)/;
  for (const q of document.body.querySelectorAll('[data-testid="figure-why"]')) {
    const wrap = q.parentElement, prev = wrap && wrap.previousElementSibling;
    if (!prev || !shown(q) || !prev.hasAttribute("data-figure")) continue;
    const num = (prev.textContent || "").trim();
    if (!/^[\d,]+$/.test(num)) continue;                       // a count, not $ or %
    let after = "", n = wrap.nextSibling;
    while (n && after.trim().length < 12) { after += n.textContent || ""; n = n.nextSibling; }
    if (/^\s*[A-Za-z]/.test(after) && !STOP.test(after)) why.push(`${num} ? ${after.trim().slice(0, 30)}`);
  }
  return { caps: [...new Set(caps)], why: [...new Set(why)] };
}

// SWEEP-4 · EVENTS AND PLEDGES, EVERY SCREEN, ON TWO ORGS. The Events list
// (Upcoming, Past, All), a past event's page with its follow-up count, the
// Pledges view, Tickets & sponsors, Auctions, Peer-to-peer and Memberships, at
// 1440 and 390, on an org with a past dinner, guests and pledges and on an
// empty org, and the public event page while payments aren't connected. Each
// must say nothing the quality bar names mechanically ("Not set", undefined,
// NaN, null, a {{placeholder}}, an ALL-CAPS label, a console error, an API 4xx
// or 5xx), and the four things the walk found wrong stay fixed: a past event's
// seating speaks only of who came; the follow-up modal counts before it makes;
// "Pledged · first year" clears its "?"; the public page reads Not open yet.
// HOW IT GOES RED: on main (199d99d) the attendee table says "Not set", every
// label is ALL-CAPS, the chart says "1 still without a seat" about a guest who
// never came, the modal has no count, the label runs under the "?", and the
// public page offers Register. Proven by planting "Not set" back in Events.jsx.
async function eventsAndPledgesSayNothingWrong(browser) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  const EV = "ev_sweep4_walk", SLUG = "sweep4-walk-dinner";
  const make = async (org, filled) => {
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "Sweep4 " + org.slice(11), org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Walk','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
    if (filled) {
      const today = require("./clock").civilDay();
      const past = `${Number(today.slice(0, 4)) - 1}-10-17`, due = `${Number(today.slice(0, 4)) + 1}-03-01`;
      await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug,created_by,created_by_name) VALUES ($1,$2,'Walk Dinner','gala',$3,'completed',$4,'system:test','test')`, [EV, org, past, SLUG]);
      await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats) VALUES ('evt_sweep4_w1',$1,$2,'Table 1',8)`, [org, EV]);
      for (let i = 1; i <= 6; i++) {
        await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
          [`d_${org}_${i}`, org, `Walk Guest ${i}`, i === 2 ? null : `walk${i}@example.org`]);
        // 1-4 came and sat; 5 said yes and never came (no seat); 6 declined
        await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,table_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [`ea_${org}_${i}`, EV, org, `d_${org}_${i}`, `Walk Guest ${i}`, i === 2 ? null : `walk${i}@example.org`, i <= 4 ? "attended" : i === 5 ? "registered" : "declined", i <= 4 ? "Table 1" : null]);
      }
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,event_id,created_by,created_by_name) VALUES ($1,$2,$3,500,$4,$5,'system:test','test')`, [`g_${org}_1`, org, `d_${org}_1`, past, EV]);
      await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,event_id,created_by,created_by_name) VALUES ($1,$2,$3,3000,$4,'open',$5,'system:test','test')`, [`pl_${org}_1`, org, `d_${org}_3`, due, EV]);
      for (let k = 0; k < 3; k++)
        await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES ($1,$2,$3,$4,$5,1000)`, [`pli_${org}_${k}`, org, `pl_${org}_1`, k + 1, `${Number(due.slice(0, 4)) + k}-03-01`]);
    }
    return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  };
  const cases = [["a past dinner with guests and pledges", await make("org_sweep4_walk", true), true], ["empty", await make("org_sweep4_none", false), false]];
  const SAYS = [[/\bNot set\b/, "Not set"], [/\bundefined\b/, "undefined"], [/\bNaN\b/, "NaN"], [/\bnull\b/, "null"],
    [/\{\{[^}]*\}\}/, "a {{placeholder}}"], [/\[[A-Za-z][A-Za-z _]+\]/, "a placeholder"], [/\b20\d\d-\d\d-\d\d\b/, "an ISO date"]];
  const screens = filled => [
    ["Events · Upcoming", "/app/events", null], ["Events · Past", "/app/events", "Past"], ["Events · All", "/app/events", "All"],
    ...(filled ? [["the event page", `/app/events?event=${EV}`, null]] : []),
    ["Pledges", "/app/fundraising?fr=pledges", null], ["Tickets & sponsors", "/app/fundraising?fr=events", null],
    ["Auctions", "/app/fundraising?fr=auctions", null], ["Peer-to-peer", "/app/fundraising?fr=p2p", null], ["Memberships", "/app/fundraising?fr=members", null],
  ];
  for (const [what, a, filled] of cases) for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 1000 : 844 }, serviceWorkers: "block", ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    let trouble = [];
    page.on("pageerror", e => trouble.push("threw: " + e.message.slice(0, 140)));
    page.on("console", m => { if (m.type() === "error" && !IGNORABLE_URL.test((m.location() || {}).url || "") && !IGNORABLE_TEXT.test(m.text()) && !/\[SW\]/.test(m.text())) trouble.push("console: " + m.text().slice(0, 140)); });
    page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !EXPECTED_5XX.test(r.url())) trouble.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
    for (const [name, url, tab] of screens(filled)) {
      trouble = [];
      await page.goto(APP + url, { waitUntil: "networkidle", timeout: 45000 }).catch(e => trouble.push("goto: " + e.message.slice(0, 80)));
      if (tab) await page.getByRole("button", { name: tab, exact: true }).first().click().catch(e => trouble.push(`the ${tab} tab: ${e.message.slice(0, 60)}`));
      await page.waitForTimeout(500);
      // the screen's own area (FIX-60 retired SWEEP-5's .no-caps root class)
      const text = await page.evaluate(() => (document.querySelector(".app-content") || document.body).innerText);
      const said = SAYS.filter(([re]) => re.test(text)).map(([, w]) => w);
      const caps = [...new Set(text.split("\n").map(l => l.trim()).filter(l => /^[A-Z][A-Z0-9 ·&'’,\-\/()]{3,}$/.test(l) && /[A-Z]{4}/.test(l)))].slice(0, 6);
      const where = `${name} (${what}, ${width})`;
      ok(`§sweep4 ${where} draws its screen`, text.trim().length > 40, text.slice(0, 80));
      ok(`§sweep4 ${where} says nothing the bar names`, said.length === 0, said);
      ok(`§sweep4 ${where} has no ALL-CAPS label`, caps.length === 0, caps);
      ok(`§sweep4 ${where} has no console error and no API 4xx/5xx`, trouble.length === 0, trouble.slice(0, 4));
      if (name === "the event page") {
        const seating = await page.locator('[data-testid="ev-seating-sentence"]').innerText().catch(() => "");
        ok(`§sweep4 ${where}: a past event's seating speaks only of who came`, !!seating && !/without a seat/.test(seating), seating);
        const tile = page.locator('.fig-tile', { hasText: /Pledged · first year/i }).first();
        if (await tile.count()) {
          const [lb, qb] = [await tile.locator("button span").first().boundingBox(), await tile.locator('[data-testid="figure-why"]').boundingBox()];
          const textRight = await tile.locator("button span").first().evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()]; return Math.max(...rs.map(x => x.right)); });
          ok(`§sweep4 ${where}: "Pledged · first year" clears its "?"`, !!lb && !!qb && textRight <= qb.x + 1, { textRight, why: qb });
        } else ok(`§sweep4 ${where}: the Pledged · first year tile is drawn`, false);
        await page.getByRole("button", { name: /Plan follow-up tasks|Follow-up tasks/ }).first().click().catch(() => {});
        await page.waitForFunction(() => { const el = document.querySelector('[data-testid="ev-followup-plan"]'); return el && !/Counting/.test(el.innerText); }, null, { timeout: 8000 }).catch(() => {});
        const plan = await page.locator('[data-testid="ev-followup-plan"]').innerText({ timeout: 5000 }).catch(() => "");
        ok(`§sweep4 ${where}: the follow-up modal says how many before it makes any`, /This makes 4 tasks/.test(plan), plan);
      }
    }
    await ctx.close();
  }
  const pub = await fetch(`${BASE}/e/${SLUG}`);
  const html = await pub.text();
  ok("§sweep4 the public event page reads Not open yet while payments aren't connected, with no form", /Not open yet/.test(html) && !/<form/i.test(html), html.slice(0, 160));
}

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

// HOME-3 · THE GREETING IS ALWAYS FIRST. "The greeting should always be on
// top, always" (Jonathan, 27 Oct). For an org with data (the demo), an empty
// org and an org mid-setup (people in, setup not done), the first words on
// Home are the greeting (org and "Good …"), the date is its heading, and the
// moves deck, the setup line and the rail all come after it. Red on main: the
// INSIGHTS-1 ladder box rendered above the greeting.
async function greetingFirst(browser, demoAuth) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const make = async (org, people) => {
    const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "Home3 " + org.slice(10), org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Home','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
    for (let i = 1; i <= people; i++) {
      await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,$3,'system:test','test')`, [`d_${org}_${i}`, org, `Home Person ${i}`]);
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
        [`g_${org}_${i}`, org, `d_${org}_${i}`, 100 * i, i % 2 ? "2025-12-10" : "2026-03-02"]);
    }
    return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  };
  const cases = [["with data (the demo)", demoAuth], ["empty", await make("org_home3_empty", 0)], ["mid-setup", await make("org_home3_setup", 6)]];
  for (const [what, a] of cases) for (const vp of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="home-moves"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const root = document.querySelector(".dash-root");
      if (!root) return { root: false };
      const day = root.querySelector(".home-day");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() && n.parentElement.offsetParent !== null ? 1 : 3 });
      const firstText = walker.nextNode();
      const head = day && day.closest(".home-head-wide, .home-head-narrow");
      const after = sel => [...root.querySelectorAll(sel)].every(el => day && (day.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { root: true, day: !!day && day.tagName, first: firstText ? firstText.textContent.trim().slice(0, 60) : null,
        firstInHead: !!(firstText && head && head.contains(firstText.parentElement)),
        greet: /Good (morning|afternoon|evening)/.test(head ? head.textContent : ""),
        afterIt: after('[data-testid="home-moves"], [data-testid="home-setup-line"], [data-testid="ladder-strip"], .home-rail, .home-block') };
    });
    ok(`§home-3 Home ${what} at ${vp.width}: the greeting is first, the date is its heading, everything else follows`,
       r.root && r.firstInHead && r.greet && r.day === "H1" && r.afterIt, r);
    // HOME-4: the rail draws whole (Today with no zeros, at most three calls,
    // To confirm in one line), the deck's extras are chips hidden at zero, no
    // Drift section and no empty Thread, setup where the org is, and an org
    // with no donors gets one friendly card and no pace sentence.
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 20000 }).catch(() => {});
    const h = await page.evaluate(() => {
      const t = s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, " ").trim() : null; };
      const n = s => document.querySelectorAll(s).length;
      return { rail: n('[data-testid="home-rail"][data-ready="1"]'), today: t('[data-testid="home-today"]'), calls: n('[data-testid="home-call-row"]'),
        callsAll: t('[data-testid="calls-see-all"]'), confirm: t('[data-testid="home-to-confirm"]'), oldTiles: n('[data-testid^="rail-tile-"]'),
        chips: [...document.querySelectorAll('[data-testid^="moves-chip-"]')].map(e => e.innerText.trim()), oldLinks: n('[data-testid="moves-quiet"]'),
        drift: n("#dash-drifting"), thread: n("#dash-thread"), threadEmpty: n('[data-testid="thread-empty-state"]'),
        first: n('[data-testid="home-setup-first"]'), railSetup: n('[data-testid="home-setup-rail"]'), setupLine: n('[data-testid="home-setup-line"]'),
        noDonors: t('[data-testid="moves-no-donors"]'), tabs: n('[data-testid^="moves-tab-"]'), pace: n('[data-testid="home-pace"]'),
        zeroTabs: [...document.querySelectorAll('[data-testid^="moves-tab-"]')].filter(e => e.dataset.count === "0" && e.getAttribute("aria-selected") !== "true").length,
        never: n('[data-testid="moves-never"]'), say: n('[data-testid="move-card"] blockquote') };
    });
    ok(`§home-4 Home ${what} at ${vp.width}: the rail draws whole, Today says no zero, at most three calls, To confirm is one line`,
       h.rail === 1 && h.oldTiles === 0 && !!h.today && !/(^|\s)0\s/.test(h.today) && h.calls <= 3 && (!h.callsAll || /^See all [\d,]+$/.test(h.callsAll))
       && !!h.confirm && !/\n/.test(h.confirm) && h.confirm.length < 80, h);
    ok(`§home-4 Home ${what} at ${vp.width}: chips hide at zero, no Drift section, no empty Thread, no loose links, no zero tabs`,
       h.chips.every(c => !/(^|\s)0\s/.test(c)) && h.oldLinks === 0 && h.drift === 0 && h.threadEmpty === 0 && h.zeroTabs === 0 && h.setupLine === 0 && (h.never === 0 || h.say > 0), h);
    if (what === "empty") ok(`§home-4 the empty org at ${vp.width}: Set up Steward under Ask, one friendly card with Import and sample data, no tabs, no pace`,
       h.first === 1 && h.railSetup === 0 && /Bring in your donors/.test(h.noDonors || "") && /Import a spreadsheet/.test(h.noDonors || "") && /sample data/.test(h.noDonors || "")
       && h.tabs === 0 && h.pace === 0 && h.thread === 0, h);
    if (what === "mid-setup") ok(`§home-4 mid-setup at ${vp.width} (one step done): still the full setup card above Your moves`, h.first === 1 && h.railSetup === 0, h);
    await ctx.close();
  }
  // HOME-4: three steps done moves setup to the top of the rail, and "I'll
  // finish later" on a new org's card does the same, for good.
  const { q: q2 } = require("./helpers");
  await q2(`UPDATE orgs SET receipt_address='1 Test Way, Testville, TS 00000', stripe_account_id='acct_test_home4' WHERE id='org_home3_setup'`);
  for (const [org, later] of [[cases[2][1], false], [cases[1][1], true]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [org.token, JSON.stringify(org.user), JSON.stringify(org.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 }).catch(() => {});
    if (later) {
      await page.click('[data-testid="setup-later"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 }).catch(() => {});
    }
    const s2 = await page.evaluate(() => ({ first: document.querySelectorAll('[data-testid="home-setup-first"]').length,
      rail: (document.querySelector('[data-testid="home-setup-rail"]') || {}).innerText || null,
      top: !!document.querySelector('[data-testid="home-rail"] > [data-testid="home-setup-rail"]:first-child') }));
    ok(later ? "§home-4 \"I'll finish later\" moves the new org's setup card to the top of the rail, and it stays there"
             : "§home-4 three steps done: setup is the rail's first card, with the count, the next step and Show all steps",
       s2.first === 0 && s2.top && /Set up Steward · \d+ of \d+/.test(s2.rail || "") && /Show all steps/.test(s2.rail || "") && (later || /Next:/.test(s2.rail || "")), s2);
    await ctx.close();
  }
}

// FIX-56 · EVERY COMMUNICATIONS TAB SWITCHES, AND "EDIT IN EDITOR" OPENS THE
// EMAIL EDITOR. On 28 Oct the thank-yous' "Edit in editor" opened the plain
// letter form, above the list and out of sight, so the card seemed to do
// nothing. In its own fixture org (never the demo): every tab of the bar and of
// Templates is clicked and must become the selected one and draw; then one
// email of each kind (a thank-you, the receipt, a campaign starter, a journey
// step's email by the link the step carries) must open the EMAIL-1 editor,
// with its blocks and its preview frame on screen. The receipt's tax lines
// must be the locked block.
// HOW IT GOES RED: on main (970d9cf) the thank-you opens [data-testid=
// template-editor], not [data-testid=email-editor-blocks]: §fix56 thank-you red.
async function emailEditorEverywhere(browser) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const org = "org_fix56_walk";
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Fix56 Shelter','fix56-walk',1,'active','team','America/New_York')`, [org]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Hale','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,'Maria Lopez','maria@example.org','system:test','test')`, ["d_" + org, org]);
  const a = (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  const j = await api("POST", "/journeys", a.token, { presetKey: "recurring_failed" });
  const stepTpl = ((j.body && j.body.steps) || []).map(st => /^template:(.+)$/.exec(String(st.draft || ""))).filter(Boolean).map(m => m[1])[0];
  ok("§fix56 the fixture journey has a step that drafts from an email template", !!stepTpl, j.body);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message.slice(0, 160)));
  const drawn = () => page.evaluate(() => {
    const m = document.querySelector(".comm-main") || document.querySelector(".app-content") || document.body;
    return { text: (m.innerText || "").trim().length, boundary: /Something went wrong|An error occurred in this part/i.test(m.innerText || "") };
  });
  await page.goto(`${APP}/app/communications`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".comm-tabbar [role=tab]", { timeout: 20000 }).catch(() => {});
  const bar = await page.$$eval(".comm-tabbar [role=tab]", bs => bs.map(b => b.innerText.trim()));
  for (const label of bar) {
    const tab = page.locator(".comm-tabbar [role=tab]", { hasText: label }).first();
    await tab.click();
    await page.waitForTimeout(600);
    const d = await drawn();
    ok(`§fix56 Communications tab "${label}" switches and draws`, (await tab.getAttribute("aria-selected")) === "true" && d.text > 0 && !d.boundary, d);
  }
  await page.locator(".comm-tabbar [role=tab]", { hasText: "Templates" }).first().click();
  await page.waitForSelector("[data-template-card]", { timeout: 15000 }).catch(() => {});
  for (const [label, sel] of [["Brand", "text=Your brand"], ["Media library", '[data-testid="templates-merged"] >> text=/photo|video|upload/i'], ["Templates", "[data-template-card]"]]) {
    const tab = page.getByTestId("templates-merged").getByRole("tab", { name: label, exact: true });
    await tab.click();
    const shown = await page.locator(sel).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    ok(`§fix56 Templates › ${label} switches and draws`, (await tab.getAttribute("aria-selected")) === "true" && shown);
  }
  // EDITOR-1: every editor is the one shell (StewardEditor): a left rail, ONE
  // preview with the Phone / Desktop toggle, and the words typed in that
  // preview, so no body textarea sits beside it. HOW IT GOES RED: on main
  // (1e383a1) the email editor is form blocks beside a preview (no
  // [data-testid=steward-editor]); the campaign builder is a body editor beside
  // "What Margaret will see"; the giving page editor shows two previews side by
  // side; the event page is a form card with no preview at all.
  const shellOf = async (frameSel) => page.evaluate((fs) => {
    const ed = document.querySelector('[data-testid="steward-editor"],[data-testid="portal-editor"]');
    const canvas = ed && ed.querySelector('[data-testid="editor-canvas"]');
    let editable = 0;
    try { const f = fs && document.querySelector(fs); editable = f ? f.contentDocument.querySelectorAll("[data-st-edit]").length : document.querySelectorAll("[data-inline]").length; } catch { editable = -1; }
    return { shell: !!ed, rail: !!(ed && ed.querySelector('[data-testid="editor-left-rail"]')),
      toggle: !!(ed && ed.querySelector('[data-testid="editor-device-phone"]') && ed.querySelector('[data-testid="editor-device-desktop"]')),
      previews: canvas ? canvas.querySelectorAll('iframe, [data-testid="giving-page"]').length : 0,
      bodyTextareas: ed ? [...ed.querySelectorAll("textarea, [contenteditable=true]:not([data-inline])")].filter(t => !t.closest('[data-testid="editor-left-rail"],[data-testid="editor-right-rail"]')).length : -1,
      editable };
  }, frameSel);
  const shellOk = (what, r) => ok(`§editor-1 ${what}: the one editor (rail, one preview, Phone/Desktop), typed in the preview, no body textarea beside it`,
    r.shell && r.rail && r.toggle && r.previews === 1 && r.bodyTextareas === 0 && r.editable > 0, r);
  const opensEditor = async (what, open) => {
    await open();
    const r = await page.locator('[data-testid="steward-editor"] [data-testid="email-preview-frame"]').first().waitFor({ timeout: 15000 })
      .then(() => true).catch(() => false);
    await page.waitForFunction(() => { const f = document.querySelector('[data-testid="email-preview-frame"]'); try { return f && f.contentDocument.querySelector("[data-st-edit]"); } catch { return false; } }, null, { timeout: 15000 }).catch(() => {});
    const res = { opened: r, plainForm: await page.locator('[data-testid="template-editor"]').count(), ...(await shellOf('[data-testid="email-preview-frame"]')) };
    ok(`§fix56 ${what}: "Edit in editor" opens the email editor with its preview`, r && res.plainForm === 0, res);
    shellOk(what, res);
    return res;
  };
  const backToLibrary = async () => {
    await page.getByTestId("editor-back").click().catch(() => {});
    await page.waitForSelector("[data-template-card]", { timeout: 15000 }).catch(() => {});
  };
  const card = id => page.locator(`[data-template-id="${id}"]`).first();
  await opensEditor("a thank-you (first gift)", () => card("letter-thanks_first").click());
  await backToLibrary();
  await opensEditor("the receipt", () => card("letter-receipt").click());
  ok("§fix56 the receipt's tax lines are the locked block", await page.evaluate(() => {
    const d = document.querySelector('[data-testid="email-preview-frame"]').contentDocument;
    const rows = d.querySelectorAll('tr[data-st-locked="1"]');
    return rows.length > 0 && [...rows].every(r => !r.querySelector("[data-st-edit]"));
  }));
  await backToLibrary();
  await opensEditor("a campaign starter", () => page.locator('[data-template-card="campaign"]').first().click());
  await backToLibrary();
  if (stepTpl) await opensEditor("a journey step's email", () => page.goto(`${APP}/app/communications?subtab=templates&template=${encodeURIComponent(stepTpl)}&back=${encodeURIComponent("/app/journeys")}`, { waitUntil: "domcontentloaded" }));
  // EDITOR-1: a campaign, a giving page and an event page open in the same shell.
  await page.goto(`${APP}/app/communications?subtab=campaigns`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: /new campaign/i }).first().click().catch(() => {});
  await page.locator('[data-testid^="template-"]').first().click({ timeout: 15000 }).catch(() => {});
  await page.locator('[data-testid="campaign-preview"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => { const f = document.querySelector('[data-testid="campaign-preview"]'); try { return f && f.contentDocument.querySelector("[data-st-edit]"); } catch { return false; } }, null, { timeout: 15000 }).catch(() => {});
  shellOk("a campaign", await shellOf('[data-testid="campaign-preview"]'));
  const gp = await api("POST", "/giving-pages", a.token, { title: "Winter coats" });
  const gpId = gp.body && (gp.body.id || (gp.body.page && gp.body.page.id));
  await page.goto(`${APP}/portal-editor?page=${encodeURIComponent(gpId || "")}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('[data-testid="real-preview"] [data-testid="giving-page"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  shellOk("a giving page", await shellOf(null));
  const ev = await api("POST", "/events", a.token, { name: "Coat drive night", date: "2027-01-15", eventType: "community" });
  const evId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  await page.goto(`${APP}/app/events?event=${encodeURIComponent(evId || "")}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('[data-testid="event-page-open"]').first().click({ timeout: 20000 }).catch(() => {});
  await page.locator('[data-testid="event-page-preview"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => { const f = document.querySelector('[data-testid="event-page-preview"]'); try { return f && f.contentDocument.querySelector("[data-st-edit]"); } catch { return false; } }, null, { timeout: 15000 }).catch(() => {});
  shellOk("an event page", await shellOf('[data-testid="event-page-preview"]'));
  ok("§fix56 nothing threw on Communications", errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// FIX-32 · THE DEMO DOOR, AND SAMPLE DONORS ARE NOT AN IMPORT. On 7 Oct a
// signup chose "Explore the demo" on the start page: 25 sample donors loaded
// and the page never moved, because /dashboard bounces an org whose
// onboarding is not complete back to /welcome. Going on to the import step
// then said "25 donors, safely home", celebrating invented people as her file.
//
// HOW IT GOES RED: the demo door leaves onboarding incomplete, or the client
// navigates before its auth context hears about it (§demo stays on /welcome);
// the import step counts sample donors as imported (§sample shows "safely
// home" and no "Import your real file"); a real import opens over the sample
// without asking (§sample sees no confirm).
// Proven red on main (e6d318b): see the FIX-32 PR.
async function demoDoor(browser) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const ORGS = ["org_fix32_demo", "org_fix32_sample"];
  const wipe = async org => {
    const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
  };
  // A fresh signup: trialing, onboarding NOT complete, one admin.
  const fresh = async (org, email) => {
    await wipe(org);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,trial_ends_at)
             VALUES ($1,$2,$3,0,'trialing','t1000_monthly','America/New_York',NOW() + INTERVAL '30 days')`, [org, "Fix32 " + org, org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sam Fix','admin')`,
      ["u_" + org, org, email, bcrypt.hashSync("loadtest1234", 4)]);
    const li = await api("POST", "/auth/login", null, { email, password: "loadtest1234" });
    const tok = li.body && li.body.token;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [tok, JSON.stringify(li.body.user || {}), JSON.stringify(li.body.org || {})]);
    return { tok, ctx, page: await ctx.newPage() };
  };
  try {
    // §demo — Explore the demo lands on Home with the sample in it.
    {
      const { tok, ctx, page } = await fresh(ORGS[0], "sam@fix32-demo.test");
      await page.goto(`${APP}/welcome`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator('[data-testid="start-demo"]').click({ timeout: 15000 });
      const landed = await page.waitForURL(u => /\/dashboard/.test(String(u)), { timeout: 30000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(1500);
      const where = new URL(page.url()).pathname;
      ok("§demo Explore the demo lands on Home, not back on the start page", landed && where === "/dashboard", where);
      const st = await api("GET", "/org/sample-data-status", tok);
      ok("§demo …with the 25 sample donors in it", st.body && st.body.sampleDonorCount === 25, st.body);
      const [o] = await q(`SELECT onboarding_complete FROM orgs WHERE id=$1`, [ORGS[0]]);
      ok("§demo …and onboarding reads complete, so a reload stays on Home", Number(o.onboarding_complete) === 1, o);
      await ctx.close();
    }
    // §sample — sample donors loaded before the import step are not an import.
    {
      const { tok, ctx, page } = await fresh(ORGS[1], "sam@fix32-sample.test");
      await api("POST", "/org/load-sample-data", tok, {});
      // The state the 7 Oct signup reached: sample in, onboarding still open.
      await q(`UPDATE orgs SET onboarding_complete=0 WHERE id=$1`, [ORGS[1]]);
      await page.goto(`${APP}/welcome`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator('[data-testid="start-import"]').click({ timeout: 15000 });
      await page.getByRole("button", { name: /Continue/ }).first().click({ timeout: 15000 });
      // A plan that reads as Team puts "Invite your team" between basics and import.
      const importStep = page.getByRole("heading", { name: "Import your donors" });
      for (let i = 0; i < 20 && !(await importStep.count()); i++) {
        const later = page.getByRole("button", { name: /invite them later/i });
        if (await later.count()) await later.click();
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => document.body.innerText || "");
      ok("§sample the import step does not call sample donors safely home", !/safely home/i.test(text), text.slice(0, 300));
      ok("§sample the import step says sample data is loaded and offers the real file",
        /Sample data is loaded/i.test(text) && (await page.locator('[data-testid="import-real-file"]').count()) === 1, text.slice(0, 300));
      if (await page.locator('[data-testid="import-real-file"]').count()) {
        await page.locator('[data-testid="import-real-file"]').click();
        const asked = await page.locator('[data-testid="confirm-clear-sample"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
        const before = await api("GET", "/org/sample-data-status", tok);
        ok("§sample importing the real file asks before clearing, and clears nothing until she confirms",
          asked && before.body.sampleDonorCount === 25, { asked, before: before.body });
        await page.locator('[data-testid="confirm-clear-sample-yes"]').click();
        await page.waitForTimeout(2500);
        const after = await api("GET", "/org/sample-data-status", tok);
        ok("§sample confirming clears the sample", after.body && after.body.hasSampleData === false, after.body);
      }
      await ctx.close();
    }
  } finally {
    for (const o of ORGS) await wipe(o);
  }
}

// SECURE-2 item 5 · THE PAGES A DONOR OR A VISITOR OPENS, under the policy:
// the marketing site (prerendered), sign-in and sign-up, a giving page (its own
// entry, give.html, with the prefetch that used to be inline), a campaign
// giving page, and the donor portal. Signed out, as a donor is. Each must
// draw and throw nothing; CSP refusals are collected by the walk's watcher.
async function publicPagesUnderTheCsp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  for (const p of ["/", "/pricing", "/security", "/login", "/signup", "/give/harborlight", "/give/harborlight/harbor-run", "/portal/harborlight"]) {
    const errors = [];
    const onErr = e => errors.push(e.message.slice(0, 160));
    page.on("pageerror", onErr);
    await page.goto(APP + p, { waitUntil: "networkidle", timeout: 45000 }).catch(e => errors.push("goto: " + e.message.slice(0, 120)));
    const drawn = await page.evaluate(() => (document.body.innerText || "").trim().length);
    page.off("pageerror", onErr);
    ok(`§csp ${p} draws and throws nothing`, drawn > 0 && errors.length === 0, { drawn, errors: errors.slice(0, 3) });
  }
  await ctx.close();
}

// SWEEP-3 · COMMUNICATIONS, AUTOMATIC EMAIL, GOING OUT AND JOURNEYS, EVERY
// SCREEN, ON TWO ORGS. Every Communications tab (Overview, Campaigns,
// Templates and its Brand and Media library, Audience, Analytics, Sequences,
// Your email tool, Drafts to review, Surveys), Settings › Automatic email,
// Going out (with a held email) and Journeys, at 1440 and 390, on an org with
// givers, a lapsed donor and a held receipt and on an empty org. Each must say
// nothing the quality bar names mechanically ("Not set", undefined, NaN, null,
// a {{placeholder}} or [placeholder], an ALL-CAPS label,
// a console error, an API 4xx or 5xx), and the walk's own finds stay fixed:
// one "No sequences yet", not two; no "Trigger now"; Journeys does not say it
// never sends; a held email says what to do next.
// HOW IT GOES RED: on main (2b4951a) every tab's labels are ALL-CAPS, the
// Sequences tab says "No sequences yet" twice with "Trigger now", and Journeys
// says "It never sends anything". Proven by planting "Not set" in MailTypes.jsx.
async function commsScreensSayNothingWrong(browser) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  const make = async (org, filled) => {
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "Sweep3 " + org.slice(11), org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Walk','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
    if (filled) {
      const today = require("./clock").civilDay(), past = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
      for (let i = 1; i <= 5; i++) {
        await q(`INSERT INTO donors (id,org_id,name,email,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'["donor"]','system:test','test')`,
          [`d_${org}_${i}`, org, `Walk Giver ${i}`, i === 5 ? null : `giver${i}@example.org`]);
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
          [`g_${org}_${i}`, org, `d_${org}_${i}`, 100 * i, i === 1 ? past : today]);
      }
      await q(`INSERT INTO mail_blocked (id,org_id,donor_id,kind,what,subject,payload,dedupe_key,created_by,created_by_name,held_reason,type_key)
               VALUES ($1,$2,$3,'receipt','A receipt for a $200 gift','Your receipt','{"html":"<p>Thank you</p>"}',$1,'system:test','test','type_off','gift_receipt')`, [`mb_${org}`, org, `d_${org}_2`]);
    }
    return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  };
  const cases = [["givers and a held receipt", await make("org_sweep3_walk", true), true], ["empty", await make("org_sweep3_none", false), false]];
  const SAYS = [[/\bNot set\b/, "Not set"], [/\bundefined\b/, "undefined"], [/\bNaN\b/, "NaN"], [/\bnull\b/, "null"], [/\[object Object\]/, "[object Object]"],
    [/\{\{[^}]*\}\}/, "a {{placeholder}}"], [/\[[A-Za-z][A-Za-z _]+\]/, "a placeholder"],
    [/ (?:for|to|with|from|of|by|about|in) \.(?:\s|$)/, "a hole"]];
  const screens = [
    ["Overview", "/app/communications"], ["Campaigns", "/app/communications?subtab=campaigns"], ["Templates", "/app/communications?subtab=templates"],
    ["Templates › Brand", "/app/communications?subtab=templates", "Brand"], ["Templates › Media library", "/app/communications?subtab=templates", "Media library"],
    ["Audience", "/app/communications?subtab=audience"], ["Analytics", "/app/communications?subtab=analytics"], ["Sequences", "/app/communications?subtab=sequences"],
    ["Your email tool", "/app/communications?subtab=emailtool"], ["Drafts to review", "/app/communications?subtab=milestones"], ["Surveys", "/app/communications?subtab=surveys"],
    ["Automatic email", "/app/settings?section=automatic"], ["Going out", "/app/settings?section=going-out"], ["Journeys", "/app/journeys"],
  ];
  for (const [what, a, filled] of cases) for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 1000 : 844 }, serviceWorkers: "block", ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    let trouble = [];
    page.on("pageerror", e => trouble.push("threw: " + e.message.slice(0, 140)));
    page.on("console", m => { if (m.type() === "error" && !IGNORABLE_URL.test((m.location() || {}).url || "") && !IGNORABLE_TEXT.test(m.text()) && !/\[SW\]/.test(m.text())) trouble.push("console: " + m.text().slice(0, 140)); });
    page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !EXPECTED_5XX.test(r.url())) trouble.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
    page.on("dialog", d => { trouble.push("a browser dialog: " + d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
    for (const [name, url, tab] of screens) {
      trouble = [];
      await page.goto(APP + url, { waitUntil: "networkidle", timeout: 45000 }).catch(e => trouble.push("goto: " + e.message.slice(0, 80)));
      if (tab) await page.getByRole("tab", { name: tab, exact: true }).first().click().catch(e => trouble.push(`the ${tab} tab: ${e.message.slice(0, 60)}`));
      await page.waitForFunction(() => !/Loading|Counting who/.test((document.querySelector(".app-content") || document.body).innerText.slice(0, 3000)), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const roots = [...document.querySelectorAll(".no-caps")];
        const caps = [];
        for (const root of roots) for (const el of root.querySelectorAll("*")) {
          if (!el.offsetParent || el.children.length || !/[a-z]{2}/i.test(el.textContent || "")) continue;
          if (getComputedStyle(el).textTransform === "uppercase") caps.push((el.textContent || "").trim().slice(0, 40));
        }
        return { text: roots.map(n => n.innerText).join("\n"), caps: caps.slice(0, 6) };
      });
      const said = [];
      for (const line of r.text.split("\n")) for (const [re, w] of SAYS) if (re.test(line)) said.push(`${w}: ${line.trim().slice(0, 90)}`);
      const where = `${name} (${what}, ${width})`;
      ok(`§sweep3 ${where} draws its screen`, r.text.trim().length > 40, r.text.slice(0, 80));
      ok(`§sweep3 ${where} says nothing the bar names`, said.length === 0, said.slice(0, 4));
      ok(`§sweep3 ${where} has no ALL-CAPS label`, r.caps.length === 0, r.caps);
      ok(`§sweep3 ${where} has no console error, dialog or API 4xx/5xx`, trouble.length === 0, trouble.slice(0, 4));
      if (name === "Sequences") ok(`§sweep3 ${where}: one "No sequences yet", and no "Trigger now"`, (r.text.match(/No sequences yet/g) || []).length <= 1 && !/Trigger now/.test(r.text), r.text.slice(0, 300));
      if (name === "Journeys") ok(`§sweep3 ${where}: Journeys never says it never sends`, !/never sends anything/i.test(r.text), r.text.slice(0, 300));
      if (name === "Going out" && filled) {
        const held = await page.locator('[data-testid="going-out-held-row"]').first().innerText().catch(() => "");
        ok(`§sweep3 ${where}: the held receipt says why and what to do next`, /Not sent: /.test(held) && /It can go once Steward turns email on|Choose which emails go/.test(held), held);
      }
    }
    await ctx.close();
  }
}

// SWEEP-5 · FINANCE, REPORTS AND GRANTS, EVERY PART, ON TWO ORGS. Every
// Finance section and part (and the year basis both ways), every report in
// the Reports rail and every Grants tab, at 1440, on an org with imported
// history and no Stripe and on an empty org, and each must say nothing the
// quality bar names mechanically: "Not set", "undefined", "NaN", "null", a
// hole where a word was ("gave in ."), an ALL-CAPS label, a console error, a
// 4xx or 5xx from the API. Then the three things the walk found wrong:
//   · with imported history and no ledger, Finance says the ledger is empty
//     in one card and draws no row of ledger $0s (it read as broken);
//   · Top donors' total is the dollars its rows gave, never the head count
//     ("Your top 50 donors gave $50");
//   · the bookkeeper's Processing fee column is the fee, not the gross.
// HOW IT GOES RED: on main (1e383a1) "Not set" is on LYBUNT, Retention, the
// Board and Grants · Reports; Finance's labels are ALL-CAPS; the ledger-empty
// card is missing and the four $0 tiles are drawn; Top donors says $5 for
// five people. Proven by planting "Not set" back in Figure.jsx: §sweep5 red.
async function moneyScreensSayNothingWrong(browser) {
  const bcrypt = require("bcryptjs");
  const { q } = require("./helpers");
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  const make = async (org, people) => {
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "Sweep5 " + org.slice(11), org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Walk','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
    // Imported history: gifts this month, last fiscal year and two years back,
    // a check with a processing fee, people without an email; no ledger rows.
    const today = require("./clock").civilDay(), ym = today.slice(0, 7);   // the org's New York day, through the test clock
    for (let i = 1; i <= people; i++) {
      await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`,
        [`d_${org}_${i}`, org, `Walk Person ${i}`, i % 3 ? null : `walk${i}@example.org`]);
      const dates = [`${ym}-01`, `${Number(today.slice(0, 4)) - 1}-0${1 + (i % 6)}-15`, `${Number(today.slice(0, 4)) - 2}-0${1 + (i % 6)}-20`];
      for (const [k, dt] of dates.entries())
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,processor_fee_amount,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'Check',$6,'system:test','test')`,
          [`g_${org}_${i}_${k}`, org, `d_${org}_${i}`, 100 * i + k, dt, k === 0 && i === 1 ? 4.5 : 0]);
    }
    // Last month: one gift that does not say how the money arrived.
    if (people) {
      const lm = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 10)).toISOString().slice(0, 10);
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name) VALUES ($1,$2,$3,250,$4,'Needs you','system:test','test')`,
        [`g_${org}_lm`, org, `d_${org}_1`, lm]);
    }
    return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  };
  const cases = [["imported history, no ledger", await make("org_sweep5_hist", 8)], ["empty", await make("org_sweep5_none", 0)]];
  const SAYS = [[/\bNot set\b/, "Not set"], [/\bundefined\b/, "undefined"], [/\bNaN\b/, "NaN"], [/\bnull\b/, "null"],
    [/ (?:for|to|with|from|of|by|about|in) \.(?:\s|$)/, "a hole"], [/\[[A-Za-z][A-Za-z _]+\]/, "a placeholder"]];
  // Month close: a gift with no payment method may be a check, so "Every
  // check is on a deposit" is not ticked while the bookkeeper's file for the
  // same month says that gift is not matched to a deposit. Red on main.
  {
    const tok = cases[0][1].token;
    const close = (await api("GET", "/finance/month-close", tok)).body || {};
    const banked = (close.items || []).find(i => i.key === "banked") || {};
    const from = close.from || (close.month && close.month.from), to = close.to || (close.month && close.month.to);
    const bk = (await api("GET", `/reports/bookkeeper?from=${from}&to=${to}`, tok)).body || {};
    const unmatched = ((bk.issues || []).find(i => i.key === "no_deposit") || {}).count || 0;
    ok("§sweep5 Month close does not tick \"every check is on a deposit\" beside gifts the bookkeeper's file says are not on one",
       unmatched > 0 && banked.done === false && banked.count === unmatched, { banked, unmatched, from, to });
  }
  for (const [what, a] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    let trouble = [];
    page.on("pageerror", e => trouble.push("threw: " + e.message.slice(0, 140)));
    page.on("console", m => { if (m.type() === "error" && !IGNORABLE_URL.test((m.location() || {}).url || "") && !IGNORABLE_TEXT.test(m.text()) && !/\[SW\]/.test(m.text())) trouble.push("console: " + m.text().slice(0, 140)); });
    page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !EXPECTED_5XX.test(r.url())) trouble.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
    const settle = async () => {
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !/Loading|Running |Adding up|Opening the rows/.test((document.querySelector(".app-content") || document.body).innerText.slice(0, 3000)), null, { timeout: 8000 }).catch(() => {});
    };
    const check = async screen => {
      const r = await page.evaluate(SAYS_SRC => {
        const m = document.querySelector(".app-content") || document.body;
        const says = SAYS_SRC.map(([src, name]) => [new RegExp(src), name]);
        const bad = [];
        for (const line of (m.innerText || "").split("\n")) for (const [re, name] of says) if (re.test(line)) bad.push(`${name}: ${line.trim().slice(0, 100)}`);
        const caps = [];
        for (const el of m.querySelectorAll("*")) {
          if (!el.offsetParent || el.children.length || !/[a-z]{2}/i.test(el.textContent || "")) continue;
          if (getComputedStyle(el).textTransform === "uppercase") caps.push((el.textContent || "").trim().slice(0, 40));
        }
        return { bad: bad.slice(0, 4), caps: caps.slice(0, 4), text: (m.innerText || "").trim().length };
      }, SAYS.map(([re, n]) => [re.source, n]));
      ok(`§sweep5 ${what} · ${screen}: draws, says nothing the bar names, no ALL-CAPS label, nothing on fire`,
         r.text > 0 && !r.bad.length && !r.caps.length && !trouble.length, { bad: r.bad, caps: r.caps, trouble: trouble.slice(0, 3) });
      const w = await page.evaluate(wordsOnScreen).catch(() => ({ why: ["(could not read)"] }));
      ok(`§fix60 ${what} · ${screen}: no figure's "?" sits between a count and its noun`, !w.why.length, w.why.slice(0, 4));
      trouble = [];
      // FIX-60: the units rules (tests/lib/units.js) on every money screen
      const u = await units.figuresOnPage(page, p => api("GET", p, a.token).then(x => x.body)).catch(e => ({ problems: ["could not read: " + e.message] }));
      const fees = await units.feeTablesOnPage(page).catch(e => ({ problems: ["could not read: " + e.message] }));
      ok(`§fix60 ${what} · ${screen}: a money figure is money, a count a count (${u.figures || 0} figures), a fee less than its gift (${fees.rows || 0} rows)`,
         !u.problems.length && !fees.problems.length, [...u.problems, ...fees.problems].slice(0, 4));
    };
    // Finance: every section and part, and the year basis both ways
    await page.goto(`${APP}/app/finance`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("[data-fin-section]", { timeout: 20000 }).catch(() => {});
    await settle();
    for (const sec of await page.$$eval("[data-fin-section]", bs => bs.map(b => b.getAttribute("data-fin-section")))) {
      await page.click(`[data-fin-section="${sec}"]`); await settle();
      const parts = await page.$$eval("[data-fin-part]", bs => bs.map(b => b.getAttribute("data-fin-part")));
      if (!parts.length) await check(`Finance › ${sec}`);
      for (const p of parts) { await page.click(`[data-fin-part="${p}"]`); await settle(); await check(`Finance › ${sec} › ${p}`); }
    }
    await page.click(`[data-fin-section="overview"]`); await settle();
    for (const basis of ["Calendar Year", "Fiscal Year"]) {
      await page.locator("button", { hasText: basis }).first().click(); await settle();
      await check(`Finance › This month on the ${basis.toLowerCase()}`);
    }
    if (what !== "empty") {
      const fin = await page.evaluate(() => ({ empty: !!document.querySelector('[data-testid="fin-ledger-empty"]'),
        tiles: [...document.querySelectorAll(".app-content div")].filter(e => !e.children.length && /^(Cash on hand|FY revenue|FY expenses|Net surplus|Restricted balance|Unrestricted balance)$/i.test(e.textContent.trim())).length,
        giving: !!document.querySelector('[data-testid="fin-giving-head"]') && !!document.querySelector('[data-testid="fin-ledger-head"]') }));
      ok("§sweep5 imported history and no ledger: Finance says the ledger is empty in one card, under its own heading, with no ledger $0 tiles", fin.empty && fin.tiles === 0 && fin.giving, fin);
    }
    // Reports: every report in the rail
    await page.goto(`${APP}/app/reports`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="reports-rail"] [data-report-id]', { timeout: 20000 }).catch(() => {});
    await settle();
    await check("Reports");
    for (const id of await page.$$eval('[data-testid="reports-rail"] [data-report-id]', bs => [...new Set(bs.map(b => b.getAttribute("data-report-id")))])) {
      await page.locator(`[data-testid="reports-rail"] [data-report-id="${id}"]`).first().click(); await settle();
      await check(`Reports › ${id}`);
      if (what !== "empty" && id === "top-donors") {
        const say = await page.locator('[data-testid="report-table"]').first().evaluate(t => {
          const cells = [...t.querySelectorAll("tbody tr")].map(tr => Number((tr.children[2] || {}).textContent.replace(/[$,]/g, "")) || 0);
          return { rows: Math.round(cells.reduce((a, b) => a + b, 0) * 100), narrative: (document.querySelector(".app-content").innerText.match(/donors gave \$([\d,.]+)/) || [])[1] };
        }).catch(e => ({ error: e.message }));
        ok("§sweep5 Top donors says the dollars its rows gave, not how many people", say.narrative && Math.round(Number(say.narrative.replace(/,/g, "")) * 100) === say.rows, say);
      }
      if (what !== "empty" && id === "bookkeeper") {
        await page.locator("button", { hasText: /^This CY/ }).first().click().catch(() => {}); await settle();
        const fee = await page.evaluate(() => {
          const t = document.querySelector('[data-testid="report-table"]'); if (!t) return null;
          const heads = [...t.querySelectorAll("th")].map(h => h.textContent.trim().toLowerCase());
          const fi = heads.findIndex(h => h.startsWith("processing fee")), ai = heads.findIndex(h => h.startsWith("amount"));
          return [...t.querySelectorAll("tbody tr")].map(tr => [tr.children[ai] && tr.children[ai].textContent.trim(), tr.children[fi] && tr.children[fi].textContent.trim()]);
        });
        // FIX-60: the units rule, on the year's rows as drawn: each fee less
        // than its gift, net the gift less the fee. Red with SWEEP-5's bug
        // planted back (bookkeeperCell reading the gross for every column).
        const feeRule = await units.feeTablesOnPage(page).catch(e => ({ rows: 0, problems: ["could not read: " + e.message] }));
        ok(`§fix60 the bookkeeper's year (${feeRule.rows} rows): every fee is less than its gift, net is the gift less the fee`,
           feeRule.rows > 0 && !feeRule.problems.length, feeRule.problems.slice(0, 4));
        ok("§sweep5 the bookkeeper's Processing fee column is the fee ($4.50 on one gift, $0 on the rest), not the gross",
           !!fee && fee.some(([, f]) => f === "$4.50") && fee.filter(([, f]) => f !== "$4.50").every(([, f]) => f === "$0"), (fee || []).slice(0, 4));
      }
    }
    // Grants: every tab
    await page.goto(`${APP}/app/grants`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await settle();
    for (const t of await page.$$eval(".app-content [role=tab]", bs => bs.map(b => b.innerText.trim()).filter(Boolean))) {
      await page.locator(".app-content [role=tab]", { hasText: t }).first().click(); await settle();
      await check(`Grants › ${t.split("\n")[0]}`);
    }
    await ctx.close();
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
  // SECURE-2 item 5 · every page any leg opens is watched for a CSP violation.
  // Chromium says "Refused to … because it violates the following Content
  // Security Policy directive" on the console, for scripts, handlers and the rest.
  const csp = [], watched = new WeakSet();
  const watchCsp = p => {
    if (watched.has(p)) return;
    watched.add(p);
    p.on("console", m => { const t = m.text(); if (/Content Security Policy/i.test(t)) csp.push(`${(p.url() || "").replace(APP, "") || "/"}: ${t.slice(0, 200)}`); });
  };
  { const nc = browser.newContext.bind(browser), np = browser.newPage.bind(browser);
    browser.newContext = async (...a) => { const c = await nc(...a); c.on("page", watchCsp); return c; };
    browser.newPage = async (...a) => { const p = await np(...a); watchCsp(p); return p; }; }
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

  // FIX-57 item 5 · NO SENTENCE WITH A HOLE IN IT. "Nothing is open for ."
  // showed while a profile loaded. Every 100 ms, from the first paint, the
  // visible text is read for a missing interpolation: " for .", "Dear ,", two
  // spaces in a sentence, "undefined", "null", "NaN". A loading moment counts:
  // that is when the hole shows. Inputs and textareas are not visible text.
  await page.addInitScript(() => {
    const BAD = [/ (?:for|to|with|from|of|by|about) \./, /\b(?:Dear|Hi|Hello) ,/, /\S {2,}\S/, /\bundefined\b/, /\bnull\b/, /\bNaN\b/];
    window.__holes = [];
    const scan = () => {
      const t = document.body ? document.body.innerText || "" : "";
      for (const line of t.split("\n")) for (const re of BAD) {
        const m = re.exec(line);
        if (m && window.__holes.length < 20 && !window.__holes.some(h => h.line === line.slice(0, 160))) window.__holes.push({ line: line.slice(0, 160), path: location.pathname });
      }
    };
    setInterval(scan, 100);
  });

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
    const holes = await page.evaluate(() => { const h = window.__holes || []; window.__holes = []; return h; }).catch(() => []);
    ok(`${what} — no sentence with a missing name or number in it`, holes.length === 0, holes.slice(0, 3));
    // FIX-60: every figure on the screen is the kind of number it is drawn as
    // (its source adds up money or counts rows), and every fee column is less
    // than its gift (tests/lib/units.js).
    const u = await units.figuresOnPage(page, p => api("GET", p, auth.token).then(r => r.body)).catch(e => ({ problems: ["could not read: " + e.message] }));
    const fees = await units.feeTablesOnPage(page).catch(e => ({ problems: ["could not read: " + e.message] }));
    ok(`${what} — every figure is the right kind of number (${u.figures || 0} figures, ${u.sources || 0} sources), every fee less than its gift`,
       !u.problems.length && !fees.problems.length, [...u.problems, ...fees.problems].slice(0, 4));
    const words = await page.evaluate(wordsOnScreen).catch(e => ({ caps: ["(could not read: " + e.message.slice(0, 60) + ")"], why: [] }));
    ok(`${what} — no ALL-CAPS text outside the one eyebrow style`, words.caps.length === 0, words.caps.slice(0, 5));
    ok(`${what} — no figure's "?" sits between a count and its noun`, words.why.length === 0, words.why.slice(0, 4));
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
  // THREAD-2: the name itself is the anchor now (inside .attn-donor-name), so
  // the step and what opened the thread can be links in the same row.
  await namesAreLinks("Home", () => [...document.querySelectorAll(".attn-donor-name")].map(n => {
    const a = n.closest("a") || n.querySelector("a"); return { href: a && a.getAttribute("href"), id: null };
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
  // POLISH-3 · CLICK ANYWHERE. On Groups you had to hit the name to open a
  // group. A card that opens something opens from anywhere on it, so the walk
  // clicks the card's EMPTY bottom padding, away from the name, the count and
  // the menu, and needs the group's own page. It goes red when only the name
  // is the button (proven on da0242f: the click lands on nothing).
  {
    trouble = [];
    await page.goto(`${APP}/app/groups`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const card = page.locator('[data-testid="group-card"]').first();
    await card.waitFor({ timeout: 15000 }).catch(() => {});
    const box = await card.boundingBox().catch(() => null);
    let opened = false;
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 5);
      opened = await page.locator('[data-testid="group-page"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    }
    ok("§click a click on the empty part of a Groups card opens that group", opened, { box: !!box, url: page.url() });
    if (opened) {
      await page.locator('[data-testid="group-page"] button', { hasText: "All groups" }).first().click().catch(() => {});
      await card.waitFor({ timeout: 10000 }).catch(() => {});
      await card.focus().catch(() => {});
      await page.keyboard.press("Enter");
      ok("§click Enter on a focused Groups card opens it too",
        await page.locator('[data-testid="group-page"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
    }
    await look("groups · click anywhere");
  }

  // FIX-55 item 6 · HIDE WHAT ISN'T CONNECTED. The Donors Map tab drew an
  // empty US map and a configuration error when no address lookup provider
  // was set up. GET /org now says, as a boolean only, whether one is
  // (capabilities.geocoding, from geocode.js's own rule), and the tab exists
  // only when it is. shard.sh boots with no provider, so the server says
  // false and there is no tab; the same answer rewritten to true (what a
  // GEOCODIO_API_KEY gives) brings the tab back and the map opens.
  // Red when the tab is always shown, or when the flag is always true.
  {
    trouble = [];
    const org = await api("GET", "/org", auth.token);
    const caps = (org.body && org.body.capabilities) || {};
    ok("§connected GET /org says address lookup is not set up (no provider on this server), as a boolean",
       caps.geocoding === false, caps);
    ok("§connected …and the same rule says it is with a key", require("../geocode").geocodingConfigured({ GEOCODIO_API_KEY: "fake" }) === true);
    ok("§connected …and the answer carries no key", !/GEOCODIO|api_key|NOMINATIM/i.test(JSON.stringify(caps)), caps);
    // Its own page with the service worker blocked: the app's worker answers
    // fetches itself, and a route on the walk's page never sees /org.
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await p2.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    const p2errors = [];
    p2.on("pageerror", e => p2errors.push(e.message.slice(0, 160)));
    const mapTabs = () => p2.locator(".donors-view-toggle button").filter({ hasText: /^Map$/ }).count();
    const openDonors = async () => {
      await p2.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p2.locator(".donors-view-toggle").waitFor({ timeout: 15000 }).catch(() => {});
      await p2.waitForTimeout(800);
    };
    let orgSeen = 0;
    const isOrg = u => { try { return new URL(u).pathname === "/org"; } catch { return false; } };
    await p2.route(isOrg, async route => { orgSeen++; await route.continue(); });
    await openDonors();
    ok("§connected with no address lookup provider the Donors page has no Map tab", orgSeen > 0 && (await mapTabs()) === 0,
       { orgSeen, tabs: await mapTabs() });
    await p2.unroute(isOrg);
    await p2.route(isOrg, async route => {
      const r = await route.fetch();
      const j = await r.json();
      await route.fulfill({ response: r, json: { ...j, capabilities: { ...(j.capabilities || {}), geocoding: true } } });
    });
    await openDonors();
    ok("§connected with a provider set up the Map tab appears", (await mapTabs()) === 1, await mapTabs());
    if (await mapTabs()) {
      await p2.locator(".donors-view-toggle button").filter({ hasText: /^Map$/ }).first().click();
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => (document.querySelector(".app-content") || document.body).innerText || "");
      ok("§connected …and the map opens, with no error boundary and nothing thrown",
         !/Something went wrong|An error occurred in this part/i.test(t) && p2errors.length === 0, p2errors.slice(0, 3));
    }
    await p2.close();
    trouble = [];
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
    // CHECK-2: Acknowledgments also lists the thank-you drafts, each amount a link to its gift.
    gift: new Set([...await ids("/acknowledgments/backlog", b => b.gifts), ...await ids("/thank-yous", b => b.drafts.map(d => ({ id: d.giftId })))]),
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

  // FIX-60 item 5 (e) · /app/events?eventId=… OPENS THAT EVENT. tabHref names
  // it eventId; the Events screen read only ?event= and drew the list.
  // (f) · HOME'S "DRAFT" OPENS THE DRAFT. The ladder's "Draft a note" asked for
  // the profile with openCompose, App dropped it, and only the profile opened.
  // HOW IT GOES RED: on main (2b4951a) the eventId link draws the list, and
  // Draft lands on the profile with no Suggested draft open.
  {
    trouble = [];
    const evId = [...known.event][0];
    await page.goto(`${APP}/app/events?eventId=${encodeURIComponent(evId)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const opened = await page.locator(`[data-testid="ev-page"][data-event-id="${evId}"]`).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    ok("§fix60 /app/events?eventId=<id> opens that event", !!evId && opened, { evId, url: page.url() });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    trouble = [];
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator('[data-testid="moves-chip-ladder"]').click({ timeout: 20000 }).catch(() => {});
    const draft = page.locator('[role=dialog] button', { hasText: /^Draft a / }).first();
    await draft.waitFor({ timeout: 15000 }).catch(() => {});
    const had = await draft.count();
    if (had) await draft.click();
    const composer = await page.locator('[data-testid="dp-suggested"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    ok("§fix60 Home's Draft opens that person's profile with the draft open", had > 0 && composer && /\/donors\/[^/?]+/.test(page.url()), { had, composer, url: page.url() });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    trouble = [];
  }

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
      // Let the tab's own reads finish before the walk leaves it: a read cut
      // off by the next page.goto logs "Failed to fetch" on the NEXT page.
      // CI's slower runner put it on the first donor profile, and then (after
      // the wait sat only after this loop) on ?subtab=emailtemplates, whose
      // leg was charged with the templates leg's cancelled read (2026-10-16).
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
  }
  trouble = [];

  for (const d of three) {
    for (const tab of PROFILE_TABS) {
      trouble = [];
      if (tab === "overview") {
        await page.goto(`${APP}/donors/${d.id}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => trouble.push("navigation: " + e.message.slice(0, 120)));
        await page.waitForTimeout(1300);
      } else {
        const btn = page.locator(`.dp-tabs [data-tab="${tab}"]`).first();
        if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); }
        else { ok(`donor ${d.id} — the ${tab} tab is on the profile`, false, "tab not found"); continue; }
      }
      await look(`donor ${d.id} · ${tab}`);
    }
  }
  // FIX-57 item 5: a profile whose full record is slow (a phone on 3G) reads
  // no sentence with an empty name while it waits. Red on 78e156e: "Nothing
  // is open for ." until the record lands.
  if (three[0]) {
    trouble = [];
    const slow = new RegExp(`/donors/${three[0].id}(\\?|$)`);
    await page.route(slow, async r => { await new Promise(res => setTimeout(res, 3000)); await r.continue().catch(() => {}); });
    await page.goto(`${APP}/donors/${three[0].id}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => trouble.push("navigation: " + e.message.slice(0, 120)));
    await page.waitForTimeout(4500);
    const holes = await page.evaluate(() => { const h = window.__holes || []; window.__holes = []; return h; }).catch(() => []);
    ok(`donor ${three[0].id} · its record slow to arrive — no sentence with a missing name in it while it waits`, holes.length === 0, holes.slice(0, 3));
    await page.unroute(slow);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    trouble = [];
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

  await eventsAndPledgesSayNothingWrong(browser);
  await demoDoor(browser);
  await greetingFirst(browser, auth);
  await emailEditorEverywhere(browser);
  await publicPagesUnderTheCsp(browser);
  await moneyScreensSayNothingWrong(browser);
  await commsScreensSayNothingWrong(browser);

  // SECURE-2 item 5: the policy is really served (so a clean walk means
  // something), it runs no inline script and no eval, and nothing any leg
  // opened was refused by it.
  const head = (await fetch(APP + "/")).headers.get("content-security-policy") || "";
  const scriptSrc = (/(?:^|;)\s*script-src ([^;]*)/.exec(head) || [])[1] || "";
  ok("§csp the app is served an enforced Content-Security-Policy with a script-src", !!scriptSrc, head.slice(0, 200));
  ok("§csp …which runs no inline script and no eval", !/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc), scriptSrc);
  ok(`§csp no Content-Security-Policy violation on any page the walk opened`, csp.length === 0, csp.slice(0, 5));

  await browser.close();
  await closeDb();
  summary("smoke-walk");
})().catch(e => { console.error(e); process.exit(1); });
