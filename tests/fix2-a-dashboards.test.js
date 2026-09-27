// FIX-2 A — DASHBOARDS A BOARD CAN READ, AND EVERY NUMBER ON THEM OPENS.
//
// Part 0 of claude/FIX-2.md, the 27 September walk:
//   1. "Dashboards: no number opens." Giving this year, same point last year,
//      change on last year, people who gave, retention, monthly gifts, stopped
//      and recovered this quarter, giving by designation: none can be clicked.
//   2. "Dashboards look thin." Six small tiles, a half-empty row, "Monthly
//      gifts giving" is not English, "Retention —" says why but not when, and
//      the as-of date is ISO.
//
//   §1  finding 1 — every figure the four dashboards return carries a source,
//       and the rows behind each one answer (tenant-scoped, read-only).
//   §2  finding 2 — plain English, a blank that says when, a sentence at the
//       top of each dashboard, the Board's month-by-month line, designation by
//       restricted and unrestricted, no ISO date on the screen or in the PDF,
//       and the rail's active item is not a solid green block.
//   §3  the Board sentence's dollar difference equals the two tiles' in cents.
//   §4  the browser: 1440 and 390, every dashboard, no sideways scroll, no ISO
//       date, a figure opens its rows and their total equals it to the cent, a
//       person row opens that person. SKIPS without Playwright or a dist.
//
// Run on the scratch stack: BASE, APP_URL, DATABASE_URL (see tests/run-all.sh).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const orgTime = require("../orgTime");

const ORG = "org_fx2adash";
const EMAIL = "fx2adash@example.org";
const PW = "loadtest1234";
const root = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const SHOTS = path.join(root, "docs", "fix-2", "A");
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const cents = n => Math.round((Number(n) || 0) * 100);

const TABLES = ["gift_soft_credits", "payment_recovery_events", "recurring_subscriptions", "milestone_drafts",
  "interactions", "threads", "tasks", "pledges", "grants", "campaigns", "fin_transactions", "gifts", "donors",
  "fin_audit_log", "metric_snapshots", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

// pdfkit Flate-compresses its streams and writes text as hex inside TJ arrays
// (the same extractor tests/dashboards.test.js uses).
function pdfText(buf) {
  const chunks = []; let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i); if (s < 0) break;
    let p = s + 6; if (buf[p] === 13) p++; if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p); if (e < 0) break;
    try { chunks.push(zlib.inflateSync(buf.slice(p, e)).toString("latin1")); } catch {}
    i = e + 9;
  }
  const all = chunks.join("\n"); const out = [];
  for (const m of all.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let s = "";
    for (const h of m[1].matchAll(/<([0-9A-Fa-f]*)>/g)) s += Buffer.from(h[1], "hex").toString("latin1");
    if (s.trim()) out.push(s);
  }
  return out.join("\n");
}

// Every figure a dashboard payload draws: the tiles, each breakdown row, each
// point on a series, and the figures inside the answer sentence.
function figuresOf(board) {
  const out = [];
  for (const p of (board.answer?.parts || [])) if (p.figure) out.push({ where: `${board.key} sentence`, ...p.figure });
  for (const m of board.metrics || []) {
    if (m.kind === "breakdown") {
      for (const r of (Array.isArray(m.value) ? m.value : [])) {
        out.push({ where: `${board.key}.${m.key} · ${r.label}`, ...r });
        for (const a of (r.also || [])) out.push({ where: `${board.key}.${m.key} · ${r.label} · ${a.label}`, ...a });
      }
    } else if (m.kind === "series") {
      for (const pt of (Array.isArray(m.value) ? m.value : [])) {
        if (pt.thisYear) out.push({ where: `${board.key}.${m.key} · ${pt.month} this year`, ...pt.thisYear });
        if (pt.lastYear) out.push({ where: `${board.key}.${m.key} · ${pt.month} last year`, ...pt.lastYear });
      }
    } else {
      out.push({ where: `${board.key}.${m.key}`, ...m });
      for (const a of (m.also || [])) out.push({ where: `${board.key}.${m.key} · ${a.label}`, ...a });
    }
  }
  return out;
}
const qs = params => Object.entries(params || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

(async () => {
  console.log("fix2-a-dashboards");
  await reset();
  const org = { timezone: orgTime.DEFAULT_TZ };
  const today = orgTime.orgToday(org);
  const fy = orgTime.orgPeriodBounds(org, "fiscal_year", 0);
  const fyPrev = orgTime.orgPeriodBounds(org, "fiscal_year", -1);
  const Y = orgTime.parseCivil(today).y;

  // A young organisation: every gift is inside this fiscal year, so there is
  // no prior year to compare with and retention has no history at all.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at)
           VALUES ($1,'Lantern Arts','fx2a-dash',1,'active','growth', NOW() - INTERVAL '30 days')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2adash',$1,$2,$3,'Dana Dash','admin')`,
    [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_fx2a_sch',$1,'Scholarship Fund',true),('ff_fx2a_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,stage,created_at) VALUES
           ('d_fx2a_1',$1,'Margaret Okafor','steward', NOW() - INTERVAL '30 days'),
           ('d_fx2a_2',$1,'Tomas Reyes','steward', NOW() - INTERVAL '30 days'),
           ('d_fx2a_3',$1,'Ivy Lindqvist','steward', NOW() - INTERVAL '30 days')`, [ORG]);
  const inFy = n => { const d = orgTime.addDays(today, -n); return d < fy.start ? fy.start : d; };
  const firstGift = inFy(20);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id) VALUES
           ('g_fx2a_1',$1,'d_fx2a_1',1200.50,$2,'cash','ff_fx2a_sch'),
           ('g_fx2a_2',$1,'d_fx2a_2',300,$3,'cash','ff_fx2a_gen'),
           ('g_fx2a_3',$1,'d_fx2a_3',75.25,$4,'cash',NULL)`, [ORG, firstGift, inFy(5), today]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,canceled_at) VALUES
           ('rs_fx2a_1',$1,'d_fx2a_1','sub_fx2a_1',25,'month','active',NULL),
           ('rs_fx2a_2',$1,'d_fx2a_2','sub_fx2a_2',10,'month','past_due',NULL)`, [ORG]);
  const tok = await login(EMAIL, PW);

  const keys = ["board", "fundraising", "people", "recurring"];
  const boards = {};
  for (const k of keys) boards[k] = (await api("GET", `/dashboards/${k}`, tok)).body || {};

  // ── §1 · finding 1: every number opens ─────────────────────────────────
  console.log("\n— §1 · every figure carries a source, and its rows answer —");
  for (const k of keys) {
    const figs = figuresOf(boards[k]);
    const noSource = figs.filter(f => !f.source || typeof f.source.key !== "string");
    ok(`§1 ${k}: every figure on it carries a source`, figs.length > 0 && noSource.length === 0,
      { figures: figs.length, without: noSource.map(f => f.where) });
  }
  const giving = (boards.board.metrics || []).find(m => m.key === "revenueThisYear");
  const rowsRes = giving?.source ? await api("GET", `/figures/${giving.source.key}/rows?${qs(giving.source.params)}`, tok) : { status: 0 };
  ok("§1 Giving this year opens: its rows answer", rowsRes.status === 200 && Array.isArray(rowsRes.body?.rows), rowsRes.status);
  ok("§1 …three gifts, footing to the figure in cents",
    rowsRes.body?.rows?.length === 3 && cents(rowsRes.body.value) === cents(giving?.value) && cents(giving?.value) === cents(1575.75),
    { rows: rowsRes.body?.rows?.length, value: rowsRes.body?.value, figure: giving?.value });
  ok("§1 …and each gift row names its person, for the profile to open",
    (rowsRes.body?.rows || []).length === 3 && rowsRes.body.rows.every(r => r.donorId && r.name), rowsRes.body?.rows);
  ok("§1 …and says its date for a person, not as ISO",
    (rowsRes.body?.rows || []).length === 3 && rowsRes.body.rows.every(r => r.dateLabel && !ISO.test(r.dateLabel)), (rowsRes.body?.rows || []).map(r => r.dateLabel));
  const census = require("../scripts/build97-number-census.js");
  ok("§1 the number census knows which screens must carry a source (FIGURE_SOURCE_SCOPE)",
    Array.isArray(census.FIGURE_SOURCE_SCOPE) && census.FIGURE_SOURCE_SCOPE.includes("components/Dashboards.jsx"), census.FIGURE_SOURCE_SCOPE);
  const probs = typeof census.figureSourceProblems === "function" ? census.figureSourceProblems() : null;
  ok("§1 …and no figure on those screens is drawn without one", Array.isArray(probs) && probs.length === 0, probs);
  const panelSrc = fs.readFileSync(path.join(root, "client/src/components/MetricBreakdownPanel.jsx"), "utf8");
  ok("§1 one drill-through panel: MetricBreakdownPanel fetches the rows behind a figure",
    /\/figures\//.test(panelSrc), null);
  ok("§1 …and there is no second panel beside it",
    !fs.existsSync(path.join(root, "client/src/components/FigurePanel.jsx"))
    && !fs.existsSync(path.join(root, "client/src/components/DrillThroughPanel.jsx")));

  // ── §2 · finding 2: a board can read it ────────────────────────────────
  console.log("\n— §2 · plain English, a blank that says when, a sentence at the top —");
  const D = await import("../shared/dashboards.js");
  const labels = D.allMetrics().map(m => m.label);
  ok("§2 \"Monthly gifts giving\" is gone", !labels.some(l => /monthly gifts giving/i.test(l)), labels);
  ok("§2 …it reads \"Monthly givers\"",
    (D.DASHBOARDS.find(d => d.key === "board").metrics.find(m => m.key === "recurringActive") || {}).label === "Monthly givers");
  const byStatus = (boards.recurring.metrics || []).find(m => m.key === "byStatus");
  ok("§2 recurring statuses are words, not column values", (byStatus?.value || []).length === 2 && byStatus.value.every(r => !/_|^[a-z]/.test(r.label)), byStatus?.value);

  for (const k of keys) {
    const a = boards[k].answer || {};
    ok(`§2 ${k} answers its question in a sentence at the top`,
      typeof a.text === "string" && a.text.length > 15 && /[.]$/.test(a.text) && Array.isArray(a.parts), a);
    ok(`§2 ${k} carries a human as-of date`, !!boards[k].asOfLabel && !ISO.test(boards[k].asOfLabel)
      && boards[k].asOfLabel.endsWith(String(Y)), boards[k].asOfLabel);
  }

  const ret = (boards.board.metrics || []).find(m => m.key === "retentionRate");
  // The rule the sentence states: retention needs a prior calendar year of at
  // least twenty givers and eighteen months of history (RETENTION_FLOOR).
  const { displayDate } = await import("../shared/displayDate.js");
  const byHistory = orgTime.addDays(firstGift, 548);
  const nextJan = `${Y + 1}-01-01`;
  const appears = byHistory > nextJan ? byHistory : nextJan;
  ok("§2 retention is blank for a young organisation", ret && ret.value === null, ret?.value);
  ok("§2 …and its blank says WHEN it will appear, from the org's own data",
    ret && typeof ret.blank === "string" && ret.blank.includes(displayDate(appears)), { blank: ret?.blank, expected: displayDate(appears) });
  const chg = (boards.board.metrics || []).find(m => m.key === "revenueChangePct");
  const fg = orgTime.parseCivil(firstGift);
  const anniv = `${fg.y + 1}-${String(fg.m).padStart(2, "0")}-${String(fg.m === 2 && fg.d === 29 ? 28 : fg.d).padStart(2, "0")}`;
  ok("§2 the change on last year is blank, and says what is missing and when it appears",
    chg && chg.value === null && typeof chg.blank === "string" && chg.blank.includes(displayDate(anniv)),
    { blank: chg?.blank, expected: displayDate(anniv) });

  const series = (boards.board.metrics || []).find(m => m.kind === "series");
  ok("§2 Board draws giving this year against last year, month by month",
    series && Array.isArray(series.value) && series.value.length === 12
    && series.value.every(p => p.lastYear && typeof p.label === "string"), series?.value?.length);
  ok("§2 …with a definition for the chart", series && series.definition && series.definition.length > 30, series?.definition);
  ok("§2 …this year's line stops at this month", series && series.value.filter(p => p.thisYear).length ===
    series.value.findIndex(p => p.month === today.slice(0, 7)) + 1, series?.value?.map(p => [p.month, !!p.thisYear]));

  const des = (boards.board.metrics || []).find(m => m.key === "byDesignation");
  const groups = (des?.value || []).filter(r => r.group === true);
  ok("§2 giving by designation shows restricted and unrestricted",
    groups.map(g => g.label).join(",") === "Restricted,Unrestricted", (des?.value || []).map(r => r.label));
  const restricted = (des?.value || []).filter(r => r.group !== true && r.restricted === true);
  ok("§2 …with their funds under each", restricted.some(r => r.label === "Scholarship Fund")
    && (des?.value || []).some(r => r.group !== true && r.restricted === false && r.label === "General Operating"), des?.value);
  ok("§2 …and the two groups add up to Giving this year, to the cent",
    groups.reduce((s, g) => s + cents(g.value), 0) === cents(giving?.value), groups);

  const dashSrc = fs.readFileSync(path.join(root, "client/src/components/Dashboards.jsx"), "utf8");
  ok("§2 the screen shows the as-of date through shared/displayDate or the server's label, never the ISO string",
    !/As of \{board\?\.asOf/.test(dashSrc) && /asOfLabel|displayDate\(/.test(dashSrc));
  ok("§2 the rail's active item is not a solid green block",
    !/background:\s*key\s*===\s*d\.key\s*\?\s*T\.greenDk/.test(dashSrc) && /3px solid " \+ T\.greenDk|activeMark\(on, "left"\)/.test(dashSrc));

  for (const k of ["board", "fundraising"]) {
    const r = await fetch(`${BASE}/dashboards/${k}/pdf`, { headers: { Authorization: "Bearer " + tok } });
    const text = pdfText(Buffer.from(await r.arrayBuffer()));
    ok(`§2 ${k}'s PDF prints the answer sentence`, r.status === 200 && text.replace(/\s+/g, " ").includes((boards[k].answer?.text || "@@").slice(0, 30)),
      text.slice(0, 200));
    ok(`§2 …and no ISO date`, !ISO.test(text), (text.match(ISO) || [])[0]);
  }

  // ── §3 · the Board sentence ────────────────────────────────────────────
  console.log("\n— §3 · the Board sentence equals the tiles —");
  const last = (boards.board.metrics || []).find(m => m.key === "revenueLastYear");
  const txt = boards.board.answer?.text || "";
  const m$ = /We are \$([\d,]+(?:\.\d\d)?) (ahead of|behind) this time last year\./.exec(txt);
  ok("§3 Board says \"We are $X ahead of / behind this time last year.\"", !!m$, txt);
  const diff = cents(giving?.value) - cents(last?.value);
  ok("§3 …and $X is the two tiles' difference, in cents",
    !!m$ && cents(m$[1].replace(/,/g, "")) === Math.abs(diff) && (diff >= 0) === (m$[2] === "ahead of"),
    { sentence: m$ && m$[1], tiles: diff / 100 });
  const dfig = (boards.board.answer?.parts || []).find(p => p.figure)?.figure;
  ok("§3 …and the $X in it opens, like every other number", !!dfig?.source && cents(dfig.value) === diff, dfig);

  // ── §4 · the browser ───────────────────────────────────────────────────
  console.log("\n— §4 · in a browser, at 1440 and 390 —");
  let chromium = null;
  try { ({ chromium } = require(path.join(PW_DIR, "node_modules", "playwright"))); } catch {}
  if (!chromium || !fs.existsSync(path.join(root, "client", "dist", "index.html"))) {
    console.log("  SKIP §4 — no Playwright or client/dist (browser leg)");
  } else {
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const lr = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) });
    const lj = await lr.json();
    for (const w of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
      const errors = [];
      page.on("pageerror", e => errors.push(String(e.message)));
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(d => {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
      }, lj);
      await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
      // Dashboards is on the rail's More (FIX-1 §12), and on the mobile drawer.
      const direct = page.locator("button:visible", { hasText: /^\s*[^A-Za-z]*\s*Dashboards\s*$/ });
      if (await direct.count()) await direct.first().click();
      else {
        await page.locator("button:visible", { hasText: /^\s*[^A-Za-z]*\s*More\s*$/ }).first().click();
        await page.waitForTimeout(400);
        await page.locator("button:visible", { hasText: /Dashboards/ }).first().click();
      }
      await page.waitForSelector("[data-dashboard]", { timeout: 15000 }).catch(() => {});
      for (const k of keys) {
        await page.locator(`[data-dash-key="${k}"]`).first().click().catch(() => {});
        await page.waitForSelector(`[data-dashboard="${k}"]`, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(400);
        const shape = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          text: document.body.innerText,
          figures: document.querySelectorAll("[data-figure]").length,
          noSource: document.querySelectorAll("[data-figure][data-no-source]").length,
        }));
        ok(`§4 ${k} @${w}: renders its figures`, shape.figures > 0, shape.figures);
        ok(`§4 ${k} @${w}: no sideways scroll`, shape.sw <= shape.cw + 1, { sw: shape.sw, cw: shape.cw });
        ok(`§4 ${k} @${w}: no ISO date on the screen`, !ISO.test(shape.text), (shape.text.match(ISO) || [])[0]);
        ok(`§4 ${k} @${w}: every drawn figure carries a source`, shape.noSource === 0, shape.noSource);
        await page.screenshot({ path: path.join(SHOTS, `${k}-${w}.png`) });
        // FIX-2 walk: a figure a pointer cannot reach does not open. Every chart
        // point must be the element under its own centre (last year's used to
        // hide under this year's where the two lines met).
        const hidden = await page.evaluate(async () => {
          const out = [];
          for (const el of document.querySelectorAll('[data-figure-key^="last-"],[data-figure-key^="this-"]')) {
            el.scrollIntoView({ block: "center" });
            await new Promise(r => setTimeout(r, 30));
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (!(hit && (hit === el || el.contains(hit)))) out.push(el.getAttribute("data-figure-key"));
          }
          return out;
        });
        ok(`§4 ${k} @${w}: every chart point can be reached by a pointer`, hidden.length === 0, hidden);
      }
      // Open Giving this year: the panel's total equals the tile to the cent.
      await page.locator('[data-dash-key="board"]').first().click();
      await page.waitForSelector('[data-dashboard="board"]');
      const tile = page.locator('[data-figure-key="revenueThisYear"]').first();
      const tileCents = await tile.getAttribute("data-cents");
      await tile.click();
      await page.waitForSelector("[data-figure-total]", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);   // the sheet's entrance animation, before the capture
      const totalCents = await page.locator("[data-figure-total]").first().getAttribute("data-cents").catch(() => null);
      ok(`§4 @${w}: Giving this year opens, and its rows' total equals it to the cent`,
        tileCents != null && totalCents === tileCents, { tileCents, totalCents });
      const rowsShown = await page.locator("[data-figure-row]").count();
      ok(`§4 @${w}: …with its gift rows`, rowsShown === 3, rowsShown);
      const panelText = await page.locator('[role="dialog"]').first().innerText().catch(() => "");
      ok(`§4 @${w}: …and the sentence that defines it`, panelText.includes("Contributions only"), panelText.slice(0, 160));
      await page.screenshot({ path: path.join(SHOTS, `panel-${w}.png`) });
      const person = page.locator("[data-person-row]").first();
      const pid = await person.getAttribute("data-person-row");
      await person.click();
      await page.waitForTimeout(1500);
      const url = page.url(), body = await page.innerText("body");
      ok(`§4 @${w}: a person row opens that person's profile`,
        /\/donors\//.test(url) || /Margaret Okafor|Tomas Reyes|Ivy Lindqvist/.test(body.slice(0, 4000)) && !(await page.locator("[data-figure-panel]").count()),
        { url, pid });
      ok(`§4 @${w}: no page error`, errors.length === 0, errors);
      await page.close();
    }
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
