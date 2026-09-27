// FIX-2 B — REPORTS, ONE WAY IN.
//
// The 27 September walk found (claude/FIX-2.md Part 0):
//   3. Reports has two navigations — a tab row AND a left list that repeat
//      each other — and the tab row runs off the screen at 1440.
//   4. Report results look like a spreadsheet dump: ISO dates, cents on
//      whole-dollar amounts ($24,500.00), no totals row, rows that don't open
//      the donor.
// Part B's Tests line is this suite's acceptance list:
//   · every old report id and tab id lands on its report;
//   · no row of tabs on Reports (no tablist, no sideways scroll at 1440/390);
//   · totals equal the sum of the rows, in cents;
//   · a row click opens the right person.
//
//   §1  one navigation, in source: no tab row, no second list, one rail;
//   §2  the rail places every report, and every old id resolves to one;
//   §3  the pure formatters: human dates, whole dollars unless cents, a foot
//       that is the sum of the rows in cents;
//   §4  the server hands every person row its person (read only, exports
//       untouched — scripts/fix2-b-capture-exports.js diffs the bytes);
//   §5  browser: every old id deep-links; no tablist; no sideways scroll;
//   §6  browser: LYBUNT reads like a report; the total foots; sorting keeps
//       the total at the foot; a row opens the right person;
//   §7  browser: a standard report and a saved one read the same way;
//   §8  browser: Start here stays and opens LYBUNT; 390 has a compact picker.
//
// Standard scratch stack + the preview for §5–§8 (they SKIP without Playwright).

const fs = require("fs"), path = require("path");
const { ok, summary, api, q, closeDb } = require("./helpers");
const { ORG, EMAIL, PW, seed, reset } = require("./fix2-b-fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const cents = v => Math.round(Number(v) * 100);
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;

// Every id a report arrived by before FIX-2 (the tab row at 58c61bc, plus
// "saved", the "Your reports" tab). Literal on purpose: the list the rail must
// keep honouring is the OLD one, not whatever the new file happens to hold.
const OLD_TAB_IDS = ["saved", "giving-summary", "by-group", "lybunt", "sybunt", "retention", "top-donors",
  "week-in-review", "three-year", "annual", "solicitations", "bookkeeper"];
const GROUPS = ["Who stopped giving?", "Who gives the most?", "How did the year go?", "Volunteers and members", "Your saved reports"];

(async () => {
  console.log("fix2-b-reports");

  // ── §1 · ONE NAVIGATION, IN SOURCE ───────────────────────────────────────
  console.log("\n— §1 · one navigation: no tab row, no second list —");
  const reportsSrc = read("client/src/components/Reports.jsx");
  const builderSrc = read("client/src/components/ReportBuilder.jsx");
  ok("finding 3: Reports draws no SectionTabs row", !/<SectionTabs\b/.test(reportsSrc));
  ok("…and no tablist of its own", !/role="tablist"|role=\{"tablist"\}/.test(reportsSrc));
  ok("finding 3: the builder view keeps no second list of reports", !/Everyday questions/.test(builderSrc) && !/list\.standard\.map/.test(builderSrc));
  ok("Reports renders ONE rail", (reportsSrc.match(/data-testid="reports-rail"/g) || []).length === 1);
  ok("…with Build a report at its top", /data-testid="rb-new"[\s\S]{0,400}Build a report/.test(reportsSrc + builderSrc));
  ok("every way in goes through the one resolver (initialReport and initialSavedReport alike)",
     /resolveReportId\(\s*initialSavedReport\s*\|\|\s*initialReport/.test(reportsSrc));

  // ── §2 · THE RAIL PLACES EVERY REPORT ────────────────────────────────────
  console.log("\n— §2 · every report has a place, every old id a landing —");
  let RAIL = null;
  try { RAIL = await import("../client/src/lib/reportsRail.js"); } catch (e) { RAIL = null; }
  const RB = await import("../shared/reportBuilder.js");
  ok("client/src/lib/reportsRail.js exists and is pure", !!RAIL);
  if (RAIL) {
    ok("the groups are the brief's five questions, in order",
       JSON.stringify(RAIL.RAIL_GROUPS.map(g => g.question)) === JSON.stringify(GROUPS), RAIL.RAIL_GROUPS.map(g => g.question));
    const placed = RAIL.RAIL_GROUPS.flatMap(g => g.items);
    ok("no report sits in two groups", new Set(placed).size === placed.length, placed);
    const unresolved = [...OLD_TAB_IDS, ...RB.STANDARD_KEYS.map(k => "std:" + k)].filter(id => !placed.includes(RAIL.resolveReportId(id).id));
    ok("every old tab id and every standard report id resolves to a rail item", unresolved.length === 0, unresolved);
    ok("every standard report is reachable (placed, or the same computation as one that is)",
       RB.STANDARD_KEYS.every(k => placed.includes("std:" + k) || RAIL.resolveReportId("std:" + k).id !== "std:" + k));
    ok("the saved group holds no fixed item (it is the org's own list)", RAIL.RAIL_GROUPS[4].items.length === 0);
    ok("a saved report's own id passes through untouched", RAIL.resolveReportId("rpt_abc123").id === "rpt_abc123" && RAIL.resolveReportId("rpt_abc123").saved === true);
    ok("std:top-50 lands on Top donors, lifetime", RAIL.resolveReportId("std:top-50").id === "top-donors" && RAIL.resolveReportId("std:top-50").params?.scope === "lifetime");
    ok("the old \"Your reports\" tab lands on LYBUNT, which is what it opened on", RAIL.resolveReportId("saved").id === "lybunt");
    ok("nothing resolves to nowhere: an empty id lands on the default report", RAIL.resolveReportId("").id === RAIL.DEFAULT_REPORT && placed.includes(RAIL.DEFAULT_REPORT));
    const defs = [...(reportsSrc.match(/const REPORT_DEFS = \[([\s\S]*?)\n\];/) || [, ""])[1].matchAll(/key: "([a-z0-9-]+)"/g)].map(m => m[1]);
    ok("the rail's tab ids are exactly the reports Reports.jsx draws (REPORT_DEFS)", JSON.stringify(defs) === JSON.stringify(RAIL.TAB_IDS), { defs, rail: RAIL.TAB_IDS });
    ok("the Agent's LYBUNT link is the plain id", RAIL.resolveReportId("lybunt").id === "lybunt");
  }

  // ── §3 · THE PURE FORMATTERS ─────────────────────────────────────────────
  console.log("\n— §3 · human dates, whole dollars unless cents, a foot in cents —");
  let F = null;
  try { F = await import("../client/src/lib/reportFormat.js"); } catch (e) { F = null; }
  ok("client/src/lib/reportFormat.js exists and is pure", !!F);
  if (F) {
    ok("finding 4: $24,500 reads $24,500, not $24,500.00", F.cellText(24500, "money") === "$24,500" && F.cellText("24500.00", "money") === "$24,500");
    ok("…and a value with cents keeps them", F.cellText(140.5, "money") === "$140.50" && F.cellText("200.50", "money") === "$200.50");
    ok("finding 4: a date reads Nov 15, 2024", F.cellText("2024-11-15", "date") === "Nov 15, 2024" && F.cellText("2024-11-15T00:00:00.000Z", "date") === "Nov 15, 2024");
    ok("…a month reads Nov 2024", F.cellText("2024-11", "month") === "Nov 2024");
    ok("…and a text cell that is an ISO date is read as one", F.cellText("2025-01-02", "text") === "Jan 2, 2025");
    ok("nothing reads as nothing", F.cellText(null, "money") === "" && F.cellText("", "date") === "");
    const rows = [{ a: 24500 }, { a: 140.5 }, { a: "60.00" }, { a: null }, { a: 0.1 }, { a: 0.2 }];
    ok("the foot is the sum of the rows in integer cents (no float drift)", F.footCents(rows, r => r.a) === 2470080, F.footCents(rows, r => r.a));
  }

  // ── §4 · THE SERVER HANDS EVERY PERSON ROW ITS PERSON ────────────────────
  console.log("\n— §4 · person rows carry their person; exports do not change —");
  const { tok, savedId, y } = await seed();
  const ft = await api("GET", "/saved-reports/std:first-time/run", tok);
  ok("std:first-time runs", ft.status === 200, ft.body);
  ok("…its one row is Cy, and carries Cy's id to open", (ft.body.rows || []).length === 1 && ft.body.rows[0]._pid === "fx2b_cy", ft.body.rows);
  const big = await api("GET", `/saved-reports/${savedId}/run`, tok);
  ok("a saved people report's rows carry their person", (big.body.rows || []).length > 0 && big.body.rows.every(r => typeof r._pid === "string" && r._pid.startsWith("fx2b_")), big.body.rows);
  const csv = await api("GET", `/saved-reports/${savedId}/csv`, tok);
  ok("…and the file does not grow a column for it", !/fx2b_/.test(csv.text) && csv.text.split(/\r?\n/)[0].split(",").length === 3, csv.text.slice(0, 200));
  const grouped = await api("GET", "/saved-reports/std:by-fund/run", tok);
  ok("a grouped report's rows are groups, not people, and carry no person", (grouped.body.rows || []).every(r => r._pid === undefined), grouped.body.rows);
  const cols = (ft.body.columns || []).map(c => c.type);
  ok("a handler report's columns name how to show each cell", (await api("GET", "/saved-reports/std:members-lapsed/run", tok)).body.columns?.some(c => c.display === "date"), cols);

  // ── §5–§8 · THE SCREEN ───────────────────────────────────────────────────
  if (!haveBrowser()) {
    console.log("  SKIP  browser legs (§5–§8): no Playwright at " + PW_DIR + " or no client/dist");
    await reset(); await closeDb(); summary(); return;
  }
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  const lj = await (await fetch(process.env.BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
  const open = async (w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(x => { localStorage.clear(); localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user));
      localStorage.setItem("npe_org", JSON.stringify(x.org)); }, lj);
    return { page, errs };
  };
  const settle = async page => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(700); };
  const goReport = async (page, id) => { await page.goto(`${APP}/dashboard?report=${encodeURIComponent(id)}`, { waitUntil: "networkidle" }); await settle(page); };
  const activeId = page => page.evaluate(() => {
    const vis = el => el && el.offsetParent !== null;
    const a = [...document.querySelectorAll('[data-testid="reports-rail"] [aria-current="page"]')].find(vis);
    if (a) return a.getAttribute("data-report-id");
    const s = document.querySelector('[data-testid="reports-picker"]');
    return vis(s) ? s.value : null;
  });
  const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

  // §5 every old id lands
  console.log("\n— §5 · every old id deep-links, and there is no tab row —");
  const { page, errs } = await open(1440, 1000);
  let RES = RAIL;
  if (!RES) RES = { resolveReportId: id => ({ id }) };
  const misses = [];
  for (const id of [...OLD_TAB_IDS, ...RB.STANDARD_KEYS.map(k => "std:" + k), savedId]) {
    await goReport(page, id);
    const want = RES.resolveReportId(id).id;
    const got = await activeId(page);
    const body = await page.innerText("body");
    if (got !== want || /Something went wrong/.test(body)) misses.push(`${id} → ${got} (want ${want})`);
  }
  ok("every old tab id, standard id and saved id lands on its report", misses.length === 0, misses);
  ok("…with no page errors", errs.length === 0, errs.slice(0, 3));
  await goReport(page, "lybunt");
  ok("finding 3: no tablist anywhere on Reports", (await page.locator('[role="tablist"]').count()) === 0);
  ok("…and the old tab row's class is gone", (await page.locator(".reports-tabbar").count()) === 0);
  ok("1440: the page does not scroll sideways", !(await sideways(page)));
  const act = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="reports-rail"] [aria-current="page"]');
    if (!a) return null;
    const s = getComputedStyle(a);
    return { w: s.fontWeight, bl: s.borderLeftWidth, blc: s.borderLeftColor, bg: s.backgroundColor, c: s.color };
  });
  ok("the active rail item: weight 700 and a 3px emerald rule on the left", !!act && act.w === "700" && act.bl === "3px" && act.blc === "rgb(13, 92, 58)", act);
  ok("…on cream or white, never a solid green block", !!act && act.bg !== "rgb(13, 92, 58)" && act.c !== "rgb(255, 255, 255)", act);

  // §6 LYBUNT reads like a report
  console.log("\n— §6 · LYBUNT: human dates, whole dollars, a total that foots, rows that open —");
  const table = page.locator('[data-testid="report-table"]').first();
  const tableText = await table.innerText().catch(() => "");
  ok("finding 4: no ISO date in the results", tableText.length > 0 && !ISO.test(tableText), (tableText.match(ISO) || [])[0]);
  ok("finding 4: $24,500 is whole dollars", tableText.includes("$24,500") && !tableText.includes("$24,500.00"));
  ok("…and $200.50 keeps its cents", tableText.includes("$200.50"));
  const foot = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="report-table"]');
    if (!t) return null;
    const rows = [...t.querySelectorAll('tbody [data-testid="report-row"]')];
    const total = t.querySelector('tfoot [data-testid="report-total-row"]');
    if (!total) return { rows: rows.length, total: null };
    const out = [];
    [...total.children].forEach((cell, i) => {
      if (!cell.hasAttribute("data-cents")) return;
      const sum = rows.reduce((s, r) => s + Number(r.children[i]?.getAttribute("data-cents") || 0), 0);
      const shown = Math.round(Number(cell.innerText.replace(/[^0-9.-]/g, "")) * 100);
      out.push({ i, total: Number(cell.getAttribute("data-cents")), sum, shown });
    });
    return { rows: rows.length, cols: out };
  });
  ok("finding 4: LYBUNT has a totals row", !!foot && !!foot.cols && foot.cols.length >= 2, foot);
  ok("totals equal the sum of the rows, in cents, column by column",
     !!foot?.cols && foot.cols.every(c => c.total === c.sum && c.shown === c.total), foot?.cols);
  // By hand from the fixture: Ada $24,500 + Ben $140.50 + $60 + Ed $1,400, all
  // in last fiscal year — and the database agrees before the screen is asked.
  const [db] = await q(`SELECT COALESCE(SUM(round(amount*100)),0)::bigint AS c FROM gifts WHERE org_id=$1
                          AND donor_id IN ('fx2b_ada','fx2b_ben','fx2b_ed') AND date >= $2 AND date <= $3`, [ORG, `${y - 1}-07-01`, `${y}-06-30`]);
  const priorCol = foot?.cols?.[0];
  ok("…and the prior-year total is the hand count and the database's ($26,100.50)",
     Number(db.c) === 2610050 && !!priorCol && priorCol.total === 2610050, { priorCol, db: db.c });
  // Sorting: the lowest lifetime first, then the total is still the last row.
  const header = page.locator('[data-testid="report-table"] thead [data-sort-key="lifetimeGiving"]').first();
  const firstName = () => page.locator('[data-testid="report-table"] tbody [data-testid="report-row"]').first().innerText();
  const before = await firstName().catch(() => "");
  await header.click().catch(() => {}); await page.waitForTimeout(200);
  await header.click().catch(() => {}); await page.waitForTimeout(200);
  const after = await firstName().catch(() => "");
  ok("a header click sorts the column (ascending: Ben's $200.50 first)", /Ben Okafor/.test(after) && before !== after, { before, after });
  ok("…and the totals row stays at the foot", await page.evaluate(() => {
    const t = document.querySelector('[data-testid="report-table"]');
    const trs = t ? [...t.querySelectorAll("tr")] : [];
    return trs.length > 0 && trs[trs.length - 1].getAttribute("data-testid") === "report-total-row";
  }));
  // A row click opens the right person.
  await page.locator('[data-testid="report-table"] tbody [data-testid="report-row"]', { hasText: "Ed Brandt" }).first().click().catch(() => {});
  await settle(page);
  const opened = await page.evaluate(() => ({ chips: !!document.querySelector('[data-testid="role-chips"]'), text: document.body.innerText }));
  ok("a row click opens that person's profile (Ed Brandt, not another)", opened.chips && /Ed Brandt/.test(opened.text) && !/Ada Whitlock/.test(opened.text.split("Ed Brandt")[0].slice(-300)), opened.chips);

  // §7 a standard and a saved report read the same way
  console.log("\n— §7 · a standard report and a saved one read like reports too —");
  await goReport(page, "std:first-time");
  const ftText = await page.locator('[data-testid="rb-result"]').innerText().catch(() => "");
  ok("first-time donors: Cy's first gift date is human", ftText.includes("Cy Marsh") && !ISO.test(ftText), ftText.slice(0, 300));
  ok("…and $1,200 is whole dollars", ftText.includes("$1,200") && !ftText.includes("$1,200.00"));
  ok("…with a totals row", (await page.locator('[data-testid="rb-result"] tfoot [data-testid="report-total-row"]').count()) === 1);
  await page.locator('[data-testid="rb-result"] tbody [data-testid="report-row"]', { hasText: "Cy Marsh" }).first().click().catch(() => {});
  await settle(page);
  ok("…and Cy's row opens Cy", await page.evaluate(() => !!document.querySelector('[data-testid="role-chips"]') && /Cy Marsh/.test(document.body.innerText)));
  await goReport(page, savedId);
  const savedFoot = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="rb-result"] table');
    if (!t) return null;
    const rows = [...t.querySelectorAll('tbody [data-testid="report-row"]')];
    const total = t.querySelector('tfoot [data-testid="report-total-row"]');
    const cells = total ? [...total.children].map((c, i) => c.hasAttribute("data-cents") ? { i, total: Number(c.getAttribute("data-cents")), sum: rows.reduce((s, r) => s + Number(r.children[i]?.getAttribute("data-cents") || 0), 0) } : null).filter(Boolean) : [];
    return { rows: rows.length, cells, text: t.innerText };
  });
  // Ada 24,500 + Ed 2,400 + Fay 1,250.25 + Cy 1,200 (lifetime over $1,000).
  ok("a saved report's lifetime column foots in cents", !!savedFoot && savedFoot.cells.length === 1 && savedFoot.cells[0].total === savedFoot.cells[0].sum && savedFoot.cells[0].total === 2935025, savedFoot);
  ok("…and shows no ISO date", !!savedFoot && !ISO.test(savedFoot.text));

  // §7b every report on the rail, walked: no ISO date anywhere in the results
  // (the saved and standard tables, the bookkeeper's gift list, Week in
  // review's window and past-due tasks, members and grants). Inputs, selects
  // and a [data-export-preview] are exports' business, not the screen's.
  console.log("\n— §7b · every report on the rail shows no ISO date —");
  const day = n => { const t = new Date(Date.now() + n * 86400000); return t.toISOString().slice(0, 10); };
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id) VALUES ('g_fx2b_wk1',$1,'fx2b_cy',25,$2,'cash','ff_fx2b_gen'),('g_fx2b_wk2',$1,'fx2b_fay',40,$3,'cash','ff_fx2b_gen')`, [ORG, day(-7), day(-10)]);
  await q(`INSERT INTO tasks (id,org_id,title,due,done,donor_id) VALUES ('t_fx2b_1',$1,'Call Ada back',$2,0,'fx2b_ada')`, [ORG, day(-3)]);
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term) VALUES ('ml_fx2b',$1,'Friend',50,'12_months')`, [ORG]);
  await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status) VALUES
           ('m_fx2b_1',$1,'fx2b_di','ml_fx2b',$2,$2,$3,'lapsed'),('m_fx2b_2',$1,'fx2b_fay','ml_fx2b',$4,$4,$5,'active')`,
    [ORG, day(-500), day(-135), day(-330), day(30)]);
  const railIds = [...(RAIL ? RAIL.RAIL_GROUPS.flatMap(g => g.items) : OLD_TAB_IDS), savedId, "std:by-fund", "std:top-50"];
  const isoHits = [];
  for (const id of railIds) {
    await goReport(page, id);
    if (id === "week-in-review" || id === "bookkeeper") await page.waitForTimeout(600);
    const text = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="reports-rail"]')?.parentElement || document.body;
      const out = [];
      const walk = n => {
        if (n.nodeType === 3) { if (n.textContent.trim()) out.push(n.textContent); return; }
        if (n.nodeType !== 1 || n.matches("select,option,input,textarea,script,style,[data-export-preview]")) return;
        n.childNodes.forEach(walk);
      };
      walk(main);
      return out.join(" | ");
    });
    const m = text.match(ISO);
    if (m) isoHits.push(`${id}: ${text.slice(Math.max(0, m.index - 60), m.index + 30)}`);
  }
  ok(`every one of the ${railIds.length} reports renders its dates as people read them`, isoHits.length === 0, isoHits);

  // §8 Start here, and 390
  console.log("\n— §8 · Start here opens LYBUNT; 390 has a compact picker —");
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("steward_seen_reports_intro")) localStorage.removeItem(k); });
  await page.locator(".app-sidebar button", { hasText: "Reports" }).first().click();
  await settle(page);
  const sh = page.locator("button", { hasText: "Open LYBUNT" }).first();
  ok("the Start here card is on Reports", (await sh.count()) === 1);
  await sh.click().catch(() => {}); await settle(page);
  ok("…and opens LYBUNT", (await activeId(page)) === "lybunt");
  await page.close();

  const m = await open(390, 844);
  await goReport(m.page, "lybunt");
  const picker = m.page.locator('[data-testid="reports-picker"]');
  ok("390: the rail becomes a compact picker", (await picker.count()) === 1 && await picker.isVisible());
  ok("390: …and the full rail is not drawn beside it", !(await m.page.locator('[data-testid="reports-rail"] [data-testid="rail-list"]').isVisible().catch(() => false)));
  ok("390: LYBUNT is the picked report", (await activeId(m.page)) === "lybunt");
  ok("390: the page does not scroll sideways", !(await sideways(m.page)));
  await picker.selectOption("sybunt").catch(() => {}); await settle(m.page);
  ok("390: picking SYBUNT lands on SYBUNT", (await activeId(m.page)) === "sybunt");
  ok("390: …and still no sideways scroll", !(await sideways(m.page)));
  ok("390: no tablist", (await m.page.locator('[role="tablist"]').count()) === 0);
  await m.page.close();

  await browser.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
