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
const LABELS = { dashboard: "Home", board: "Dashboards", portal: "Donor Portal", agent: "Agent", workflows: "Agent" };
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

(async () => {
  console.log("smoke-walk");
  const login = await api("POST", "/auth/login", null, DEMO);
  if (login.status !== 200) {
    ok("the demo org is on this database (run scripts/seed-demo.js)", false, login.status);
    return summary("smoke-walk");
  }
  ok("logged in to the demo", true);
  const auth = login.body;

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

  await browser.close();
  await closeDb();
  summary("smoke-walk");
})().catch(e => { console.error(e); process.exit(1); });
