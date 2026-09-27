// FIX-3 E — REPORTS: THE RAIL REGROUPED, AND ONE "SAME POINT LAST YEAR".
//
// The 27 September walk after FIX-2 found (claude/FIX-3.md Part 0):
//   12. The Reports rail is a long list with things in the wrong place: five
//       grants reports sat under "How did the year go?". Regroup as Your saved
//       reports (top); Who stopped giving; Who gives the most; The year; Money
//       in; Grants; Volunteers and members. Groups collapse, a search box sits
//       at the top of the rail, and every old report id still deep-links (that
//       walk is tests/fix2-b-reports.test.js §5, extended, not copied here).
//   13. The giving summary said "Down from $2,083,194 the prior period" — three
//       months of this fiscal year against ALL of last year — while the Board
//       said $574,959 at the same point last year. The summary now compares the
//       same point last year and says so, and the two screens read ONE figure.
//
//   §1  the rail's groups, pure: names, order, membership, one group each;
//       the search filter and the group of a report;
//   §2  the giving summary and the Board agree in cents, on two fixture orgs
//       whose fiscal years start in different months, today mid-year; the
//       comparison opens and its rows foot to it; the CSV is unchanged;
//   §3  browser: the rail at 1440 (groups in order, collapse remembered per
//       viewer, the open report's group expanded, search across groups, Escape
//       clears) and at 390 (the picker, filtered by the same search);
//   §4  browser: the giving summary's sentence says "the same point last year"
//       and its comparison opens onto rows that foot to it.
//
// Standard scratch stack; §3–§4 SKIP without Playwright or a client dist.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb } = require("./helpers");
const orgTime = require("../orgTime");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const cents = v => Math.round(Number(v) * 100);

// The brief's groups, word for word, in order, and what sits in each.
const BRIEF = [
  ["saved", "Your saved reports", []],
  ["stopped", "Who stopped giving", ["lybunt", "sybunt", "std:lapsed-24", "retention", "std:monthly-givers"]],
  ["most", "Who gives the most", ["top-donors", "three-year", "std:board-giving", "solicitations"]],
  ["year", "The year", ["giving-summary", "std:by-month", "by-group", "annual", "week-in-review", "std:first-time"]],
  ["money", "Money in", ["std:pledges-outstanding", "std:ack-backlog", "std:gifts-by-link-source", "bookkeeper"]],
  ["grants", "Grants", ["std:grants-pipeline", "std:grants-by-funder", "std:grants-awarded-vs-requested",
    "std:grant-deadlines-90", "std:grant-restricted-balances"]],
  ["people", "Volunteers and members", ["std:volunteers-who-give", "std:members-by-level", "std:members-expiring",
    "std:members-lapsed", "std:members-new-renewed", "std:membership-revenue"]],
];

const ORGS = ["org_fx3e_mid", "org_fx3e_jul"];
const EMAIL = id => `reports@${id.replace(/_/g, "-")}.example.org`;
const PW = "loadtest1234";
const CHILD_TABLES = ["saved_report_sends", "saved_reports", "gift_soft_credits", "interactions", "threads", "tasks", "gifts",
  "donors", "users", "budgets", "accounts", "fin_funds", "fin_audit_log"];
async function reset() {
  for (const org of ORGS) {
    for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
}

// An org whose fiscal year starts in `startMonth`, with gifts either side of
// the same point last year. Returns the windows and the hand count.
async function seedOrg(org, startMonth) {
  const tz = "America/New_York";
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,timezone,timezone_confirmed_at,vocabulary_json)
           VALUES ($1,'Same Point Trust',$2,1,'team','active','1 Main St, Lexington, KY 40507',$3,NOW(),$4)`,
    [org, org.replace(/_/g, "-"), tz, JSON.stringify({ fiscal_year_start_month: startMonth })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rae Porter','admin')`,
    ["u_" + org, org, EMAIL(org), bcrypt.hashSync(PW, 4)]);
  const o = { timezone: tz, vocabulary_json: JSON.stringify({ fiscal_year_start_month: startMonth }) };
  const today = orgTime.orgToday(o);
  const fy = orgTime.orgPeriodBounds(o, "fiscal_year", 0);
  const fyPrev = orgTime.orgPeriodBounds(o, "fiscal_year", -1);
  const into = orgTime.daysBetween(fy.start, today);
  const same = orgTime.addDays(fyPrev.start, into);            // the same point last year
  const label = orgTime.orgReportYear(o, "fiscal");
  const P = (id, name, deleted = false) => q(`INSERT INTO donors (id,org_id,name,email,stage,tags,deleted_at) VALUES ($1,$2,$3,$4,'cultivate','[]',$5)`,
    [id, org, name, `${id}@example.org`, deleted ? new Date() : null]);
  await P(org + "_ada", "Ada Whitlock"); await P(org + "_ben", "Ben Okafor"); await P(org + "_gone", "Gone Person", true);
  const G = (i, donor, amount, date, sample = false) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,is_sample) VALUES ($1,$2,$3,$4,$5,'cash',$6)`,
    [`g_${org}_${i}`, org, donor, amount, date, sample]);
  // This year to today.
  await G(1, org + "_ada", 1000, fy.start);
  await G(2, org + "_ben", 250.25, orgTime.addDays(today, -1));
  // Last year, up to and including the same point…
  await G(3, org + "_ada", 400, fyPrev.start);
  await G(4, org + "_ben", 99.99, orgTime.addDays(same, -5));
  await G(5, org + "_ben", 10, same);
  await G(6, org + "_ada", 3, orgTime.addDays(same, -1), true);        // a sample row counts on both screens
  await G(7, org + "_gone", 50, orgTime.addDays(same, -2));           // a deleted person counts on neither
  // …and after it: last year's rest, which the full year holds and the same point does not.
  await G(8, org + "_ada", 5000, orgTime.addDays(same, 1));
  await G(9, org + "_ben", 777, fyPrev.end);
  const tok = await login(EMAIL(org), PW);
  return { tok, today, fy, fyPrev, same, label, into, want: 51299, wantThis: 125025, wantFullPrior: 51299 + 500000 + 77700 };
}

(async () => {
  console.log("fix3-e-reports");

  // ── §1 · THE RAIL'S GROUPS ───────────────────────────────────────────────
  console.log("\n— §1 · the rail, regrouped as the brief names it —");
  const RAIL = await import("../client/src/lib/reportsRail.js");
  const RB = await import("../shared/reportBuilder.js");
  ok("finding 12: the groups are the brief's seven, in order, Your saved reports on top",
     JSON.stringify(RAIL.RAIL_GROUPS.map(g => [g.id, g.question])) === JSON.stringify(BRIEF.map(([id, qn]) => [id, qn])),
     RAIL.RAIL_GROUPS.map(g => g.question));
  for (const [id, qn, items] of BRIEF) {
    const g = RAIL.RAIL_GROUPS.find(x => x.id === id);
    ok(`finding 12: "${qn}" holds exactly ${items.length ? items.join(", ") : "the org's own saved reports"}`,
       !!g && JSON.stringify(g.items) === JSON.stringify(items), g && g.items);
  }
  const placed = RAIL.RAIL_GROUPS.flatMap(g => g.items);
  ok("finding 12: every report sits in exactly one group", new Set(placed).size === placed.length);
  const every = [...RAIL.TAB_IDS, ...RB.STANDARD_KEYS.map(k => "std:" + k)];
  const homeless = every.filter(id => !placed.includes(RAIL.resolveReportId(id).id));
  ok("finding 12: every existing report lands in a group (tab reports and all 24 standard ones)", homeless.length === 0, homeless);
  ok("finding 12: the five grants reports are no longer under the year", !RAIL.RAIL_GROUPS.find(g => g.id === "year").items.some(i => /grant/.test(i)));

  ok("the rail exports its search filter and the group of a report",
     typeof RAIL.filterRail === "function" && typeof RAIL.groupOfReport === "function");
  if (typeof RAIL.filterRail === "function" && typeof RAIL.groupOfReport === "function") {
    const named = RAIL.railGroups([{ key: "lybunt", label: "LYBUNT" }, { key: "giving-summary", label: "Giving summary" }],
      [{ id: "std:by-month", name: "Gifts by month vs last year" }, { id: "std:monthly-givers", name: "Monthly givers and status" },
       { id: "std:members-new-renewed", name: "New and renewed members by month" }, { id: "std:grants-pipeline", name: "Grants pipeline" }],
      [{ id: "rpt_1", name: "Monthly board pack" }]);
    const hit = RAIL.filterRail(named, "  MONTH ");
    ok("search: matches by name, any case, across groups; groups with no match drop out",
       JSON.stringify(hit.map(g => [g.id, g.items.map(i => i.id)])) === JSON.stringify([
         ["saved", ["rpt_1"]], ["stopped", ["std:monthly-givers"]], ["year", ["std:by-month"]], ["people", ["std:members-new-renewed"]]]),
       hit.map(g => [g.id, g.items.map(i => i.id)]));
    ok("search: an empty search is the whole rail, empty saved group included", RAIL.filterRail(named, "").length === named.length);
    ok("search: no match is no group", RAIL.filterRail(named, "zzzz").length === 0);
    ok("the group of a report: a rail item, an alias and a saved report",
       RAIL.groupOfReport("std:grants-pipeline") === "grants" && RAIL.groupOfReport("std:top-50") === "most"
       && RAIL.groupOfReport("saved") === "stopped" && RAIL.groupOfReport("rpt_abc") === "saved" && RAIL.groupOfReport("build") === null,
       ["std:grants-pipeline", "std:top-50", "saved", "rpt_abc", "build"].map(RAIL.groupOfReport));
  }

  // ── §2 · THE GIVING SUMMARY AND THE BOARD READ ONE FIGURE ────────────────
  console.log("\n— §2 · the giving summary's comparison IS the Board's same point last year —");
  await reset();
  const now = orgTime.parseCivil(orgTime.orgToday({ timezone: "America/New_York" }));
  // An org whose year began five months ago, so today is mid-year — and a
  // July org, the default, alongside it.
  const midStart = ((now.m - 1 - 5 + 12) % 12) + 1;
  const fixtures = [["org_fx3e_mid", midStart], ["org_fx3e_jul", 7]];
  let midFx = null;
  for (const [org, start] of fixtures) {
    const fx = await seedOrg(org, start);
    if (org === "org_fx3e_mid") midFx = fx;
    const tag = `(fiscal year from month ${start}, ${fx.into} days in)`;
    const board = (await api("GET", "/dashboards/board", fx.tok)).body;
    const bm = board && board.metrics ? board.metrics.find(m => m.key === "revenueLastYear") : null;
    ok(`${tag} the Board's same point last year is the hand count, $512.99`, !!bm && cents(bm.value) === fx.want, bm);
    const gsDefault = await api("GET", "/reports/giving-summary?yearMode=fiscal", fx.tok);
    const gs = await api("GET", `/reports/giving-summary?year=${fx.label}&yearMode=fiscal`, fx.tok);
    ok(`${tag} the summary's This FY is the org's fiscal year, from the Board's first day`,
       gs.status === 200 && gs.body.from === fx.fy.start && gsDefault.body.from === fx.fy.start, { from: gs.body.from, def: gsDefault.body.from, want: fx.fy.start });
    ok(`${tag} …and its total is this year's gifts ($1,250.25)`, cents(gs.body.total) === fx.wantThis, gs.body.total);
    const c = gs.body.comparison;
    ok(`${tag} finding 13: the summary compares the same point last year`, !!c && c.basis === "same-point", c);
    ok(`${tag} finding 13: …in cents, the Board's figure`, !!c && !!bm && cents(c.value) === cents(bm.value) && cents(c.value) === fx.want,
       { summary: c && c.value, board: bm && bm.value });
    ok(`${tag} …read through the Board's own source, not a second computation`,
       !!c && !!bm && JSON.stringify(c.source) === JSON.stringify(bm.source), { summary: c && c.source, board: bm && bm.source });
    ok(`${tag} …from the first day of last fiscal year to the same point`,
       !!c && c.from === fx.fyPrev.start && c.to === fx.same, c && { from: c.from, to: c.to, want: [fx.fyPrev.start, fx.same] });
    ok(`${tag} …with the Board's one sentence for it`, !!c && !!bm && c.definition === bm.definition && /like for like/.test(c.definition || ""));
    // Every number opens: the comparison's rows foot to it.
    if (c && c.source) {
      const qs = new URLSearchParams({ ...c.source.params, page: 1, pageSize: 200 }).toString();
      const rows = await api("GET", `/figures/${c.source.key}/rows?${qs}`, fx.tok);
      const foot = (rows.body.rows || []).reduce((s, r) => s + cents(r.amount), 0);
      ok(`${tag} every number opens: the comparison's rows foot to it in cents`,
         rows.status === 200 && foot === fx.want && rows.body.cents === fx.want && rows.body.totalRows === 4, { foot, cents: rows.body.cents, n: rows.body.totalRows });
    } else ok(`${tag} every number opens: the comparison carries its source`, false, c);
    // The full year is still in the payload for the low-volume default, and is not the comparison.
    ok(`${tag} the full-year figure is kept, apart, and plainly named`,
       !!gs.body.prior && cents(gs.body.prior.total) === fx.wantFullPrior && gs.body.prior.basis === "full-period", gs.body.prior);
    // Last FY (complete) compares with the whole year before it.
    const last = await api("GET", `/reports/giving-summary?year=${fx.label - 1}&yearMode=fiscal`, fx.tok);
    ok(`${tag} Last FY, a finished year, compares with the finished year before it`,
       !!last.body.comparison && last.body.comparison.from === orgTime.orgPeriodBounds({ timezone: "America/New_York", vocabulary_json: JSON.stringify({ fiscal_year_start_month: start }) }, "fiscal_year", -2).start
       && last.body.comparison.to === orgTime.addDays(fx.fyPrev.start, -1), last.body.comparison);
    // The CSV does not carry the comparison: it is the monthly table and its total.
    const csv = await api("GET", `/reports/giving-summary?year=${fx.label}&yearMode=fiscal&format=csv`, fx.tok);
    ok(`${tag} the CSV is the monthly table and its total, unchanged in shape`,
       csv.status === 200 && /^﻿?Month,Gifts,Total,Unique donors/.test(csv.text) && /TOTAL,2,1250.25,2/.test(csv.text) && !/prior|same point/i.test(csv.text), csv.text.slice(0, 200));
  }

  // ── §3–§4 · THE SCREEN ───────────────────────────────────────────────────
  if (!haveBrowser()) {
    console.log("  SKIP  browser legs (§3–§4): no Playwright at " + PW_DIR + " or no client/dist");
    await reset(); await closeDb(); summary(); return;
  }
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  const lj = await (await fetch(process.env.BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL("org_fx3e_mid"), password: PW }) })).json();
  const saved = await api("POST", "/saved-reports", midFx.tok, { name: "Monthly board pack", shared: true,
    definition: { entity: "people", columns: ["name", "lifetime"], filter: { op: "and", rules: [] } } });
  const open = async (w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(x => { localStorage.clear(); localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user));
      localStorage.setItem("npe_org", JSON.stringify(x.org)); localStorage.setItem("steward_seen_reports_intro", "1"); }, lj);
    return { page, errs };
  };
  const settle = async page => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(600); };
  const goReport = async (page, id) => { await page.goto(`${APP}/dashboard?report=${encodeURIComponent(id)}`, { waitUntil: "networkidle" }); await settle(page); };
  const railState = page => page.evaluate(() => {
    const vis = el => !!el && el.offsetParent !== null;
    return [...document.querySelectorAll('[data-testid="reports-rail"] [data-testid="rail-group"]')].filter(vis).map(g => ({
      id: g.getAttribute("data-group-id"),
      name: (g.querySelector('[data-testid="rail-group-toggle"]') || {}).innerText,
      expanded: (g.querySelector('[data-testid="rail-group-toggle"]') || { getAttribute: () => null }).getAttribute("aria-expanded"),
      items: [...g.querySelectorAll("[data-report-id]")].filter(vis).map(i => i.getAttribute("data-report-id")),
    }));
  });
  const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

  console.log("\n— §3 · the rail at 1440: groups, collapse, search —");
  const { page, errs } = await open(1440, 1000);
  await goReport(page, "lybunt");
  let st = await railState(page);
  ok("1440: the rail draws the brief's seven groups, in order",
     JSON.stringify(st.map(g => (g.name || "").replace(/\s+/g, " ").trim().toLowerCase())) === JSON.stringify(BRIEF.map(b => b.slice(1, 2)[0].toLowerCase())),
     st.map(g => g.name));
  ok("1440: each group draws exactly its reports (saved on top holds the org's own)",
     st.length === 7 && st.every((g, i) => JSON.stringify(g.items) === JSON.stringify(i === 0 ? [saved.body.id] : BRIEF[i][2])),
     st.map(g => [g.id, g.items.length]));
  // Collapse Grants: its reports go; the choice is remembered for this viewer.
  await page.locator('[data-group-id="grants"] [data-testid="rail-group-toggle"]').click({ timeout: 3000 }).catch(() => {});
  st = await railState(page);
  const grants = st.find(g => g.id === "grants");
  ok("collapse: a group's header folds its reports away", !!grants && grants.expanded === "false" && grants.items.length === 0, grants);
  await page.locator('[data-group-id="people"] [data-testid="rail-group-toggle"]').click({ timeout: 3000 }).catch(() => {});
  await goReport(page, "lybunt");   // a fresh load of the page (the app drops ?report= once read, so not reload())
  st = await railState(page);
  ok("collapse: remembered for this viewer across a reload",
     st.find(g => g.id === "grants")?.expanded === "false" && st.find(g => g.id === "people")?.expanded === "false"
     && st.find(g => g.id === "stopped")?.expanded === "true", st.map(g => [g.id, g.expanded]));
  const key = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("steward_reports_rail_collapsed")));
  ok("…under a key that names the viewer", key.length === 1 && key[0].endsWith(lj.user.id), key);
  // Open a report inside a collapsed group: its group opens.
  await goReport(page, "std:grants-pipeline");
  st = await railState(page);
  const g2 = st.find(g => g.id === "grants");
  ok("the group holding the open report is expanded", !!g2 && g2.expanded === "true" && g2.items.includes("std:grants-pipeline")
     && await page.locator('[data-report-id="std:grants-pipeline"][aria-current="page"]').isVisible().catch(() => false), g2);
  ok("…and the other folded group stays folded", st.find(g => g.id === "people")?.expanded === "false");
  // Search, across groups.
  const search = page.locator('[data-testid="reports-search"]');
  ok("a search box sits at the top of the rail", await search.isVisible().catch(() => false)
     && await page.evaluate(() => { const r = document.querySelector('[data-testid="reports-rail"]'); const s = document.querySelector('[data-testid="reports-search"]');
       const l = document.querySelector('[data-testid="rail-list"]'); return !!(r && s && l) && (s.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }));
  await search.fill("month", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(150);
  st = await railState(page);
  ok("search: \"month\" finds its reports across groups (Lapsed over 24 months too), folded or not, and hides the rest",
     JSON.stringify(st.map(g => [g.id, g.items])) === JSON.stringify([["saved", [saved.body.id]], ["stopped", ["std:lapsed-24", "std:monthly-givers"]],
       ["year", ["std:by-month"]], ["people", ["std:members-new-renewed"]]]), st.map(g => [g.id, g.items]));
  await search.press("Escape", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(150);
  st = await railState(page);
  ok("search: Escape clears it and the rail comes back as it was", (await search.inputValue().catch(() => null)) === "" && st.length === 7
     && st.find(g => g.id === "people")?.expanded === "false", st.map(g => [g.id, g.expanded]));
  await search.fill("zzzz", { timeout: 3000 }).catch(() => {});
  ok("search: no match says so", await page.locator('[data-testid="rail-no-match"]').isVisible().catch(() => false) && (await railState(page)).length === 0);
  await search.fill("", { timeout: 3000 }).catch(() => {});
  // A search result opens its report.
  await search.fill("board giv", { timeout: 3000 }).catch(() => {});
  await page.locator('[data-report-id="std:board-giving"]').first().click({ timeout: 3000 }).catch(() => {}); await settle(page);
  ok("a found report opens", await page.locator('[data-report-id="std:board-giving"][aria-current="page"]').isVisible().catch(() => false));
  ok("1440: no sideways scroll, no page errors", !(await sideways(page)) && errs.length === 0, errs.slice(0, 3));

  // §4 — the giving summary.
  console.log("\n— §4 · the giving summary says the same point last year, and it opens —");
  await goReport(page, "giving-summary");
  await page.locator('button', { hasText: "This FY" }).first().click().catch(() => {}); await settle(page);
  const narr = await page.locator('[data-testid="gs-narrative"]').innerText().catch(() => "");
  ok("finding 13: the sentence says \"the same point last year\", and not \"the prior period\"",
     /at the same point last year/.test(narr) && !/prior period/.test(narr), narr);
  const cmp = page.locator('[data-testid="gs-narrative"] [data-source-key="gifts"][data-figure-key="samePointLastYear"]');
  ok("…its comparison is the Board's figure, $512.99", (await cmp.getAttribute("data-cents").catch(() => null)) === String(midFx.want), await cmp.count());
  await cmp.click().catch(() => {});
  await page.waitForSelector("[data-figure-total]", { timeout: 10000 }).catch(() => {});
  const tot = await page.locator("[data-figure-total]").first().getAttribute("data-cents").catch(() => null);
  ok("every number opens: its rows foot to it, to the cent", tot === String(midFx.want), tot);
  await page.keyboard.press("Escape").catch(() => {});
  await page.close();

  console.log("\n— §3b · 390: the picker, with the same groups and the same search —");
  const m = await open(390, 844);
  await goReport(m.page, "lybunt");
  const picker = m.page.locator('[data-testid="reports-picker"]');
  const groupsOf = () => m.page.evaluate(() => [...document.querySelectorAll('[data-testid="reports-picker"] optgroup')].map(g => [g.label, [...g.querySelectorAll("option")].map(o => o.value)]));
  let og = await groupsOf();
  ok("390: the picker's groups are the rail's, in order",
     JSON.stringify(og.map(g => g[0])) === JSON.stringify(BRIEF.map(b => b[1])), og.map(g => g[0]));
  const ms = m.page.locator('[data-testid="reports-search"]');
  ok("390: the search box is there too", await ms.isVisible().catch(() => false));
  await ms.fill("month", { timeout: 3000 }).catch(() => {}); await m.page.waitForTimeout(150);
  og = await groupsOf();
  ok("390: a search narrows the picker to its matches",
     JSON.stringify(og) === JSON.stringify([["Your saved reports", [saved.body.id]], ["Who stopped giving", ["std:lapsed-24", "std:monthly-givers"]],
       ["The year", ["std:by-month"]], ["Volunteers and members", ["std:members-new-renewed"]]]), og);
  const listed = await m.page.evaluate(() => [...document.querySelectorAll('[data-testid="rail-list"] [data-report-id]')].filter(e => e.offsetParent !== null).map(e => e.getAttribute("data-report-id")));
  ok("390: …and lists its matches under the box, to tap", JSON.stringify(listed) === JSON.stringify([saved.body.id, "std:lapsed-24", "std:monthly-givers", "std:by-month", "std:members-new-renewed"]), listed);
  await picker.selectOption("std:monthly-givers").catch(() => {}); await settle(m.page);
  ok("390: picking from it lands on the report", (await picker.inputValue().catch(() => null)) === "std:monthly-givers");
  ok("390: no sideways scroll", !(await sideways(m.page)));
  await ms.fill("", { timeout: 3000 }).catch(() => {}); await m.page.waitForTimeout(150);
  ok("390: with no search, the list folds back into the picker", !(await m.page.locator('[data-testid="rail-list"]').isVisible().catch(() => true)));
  await m.page.close();

  await browser.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
