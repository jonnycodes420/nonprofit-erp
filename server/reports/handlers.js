// server/reports/handlers.js — the report handlers: one per report key, the params they read and the CSV they write.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
// FIX-11 Part 3 — the bookkeeper's two files. Pure: grouping, the fee line,
// the net and the assertion that the deposits foot (depositsFile.js), and the
// column sets each tool wants (bookkeeper.js), declared once so the screen,
// this router and routes/finance.js cannot disagree about any of them.
const DEP = require("../../depositsFile");
const BK = require("../../bookkeeper");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { splitGiftRows, giftCountOf } = require("./splitGiftRows");   // MOPUP-2: a split gift is a row per fund line
const { NOT_CREDIT } = require("../../creditTypes");   // FIX-49: soft and matching credits are not money

function mount(ctx) {
const {
  ALL_PIPELINE_STAGES, BOOKKEEPER_COLUMNS, LAPSED_MEMBER_SQL, RB_READY, STAGE_WEIGHT, asJson, bkCents,
  bkDollars, bookkeeperRefusalMessage, bookkeeperRefusals, computeDriftForDonors, computeRetentionRate,
  figureSources, grantBalanceFrom, grantMoneyRows, grantMsMod, inOrgDays, milestoneRow, orgForYears,
  orgLeadDays, orgTime, orgToday, orgTz, query, rbCents, reportCurrentYear, reportYearBounds, restrictedMod,
  runBuilderDef, toDollars,
} = ctx;
let RB = null;
RB_READY.then(m => { RB = m; });

// Shared WHERE fragment for gift-level queries: org-scoped, soft-deleted
// donors excluded (matching the app-wide `deleted_at IS NULL` convention),
// optional fund/campaign filters. is_sample rows are deliberately included —
// they're org data, and real orgs won't have any.
// SWEEP-5 · ONE NAME FOR A FISCAL YEAR ON A REPORT. Retention, the annual
// report and the 3-year comparison said "FY2027" while the chips above them,
// Finance and Grants said "FY 2026–27". The label comes from
// shared/fiscalPeriod.js, the one place that names a fiscal year.
let FP = null;
const FP_READY = import("../../shared/fiscalPeriod.js").then(m => { FP = m; return m; });

// ── BUILD-86 C.3 — FOUR DASHBOARDS, FOUR QUESTIONS ─────────────────────────
// One route. Each dashboard is a question; every number it returns carries the
// DEFINITION from shared/dashboards.js, so the sentence a board member reads on
// hover and the sentence printed in the PDF footnote are the same string,
// never two copies that drift.
//
// SPEED. Every dashboard is ONE parallel batch of independent reads (the
// BUILD-54 §1 pattern), never a query per metric and never a query per row.
// The per-donor loops that made a Home load take fifteen minutes at 25k donors
// (BUILD-05) are the thing this shape exists to avoid.
async function dashboardsMod() { return import("../../shared/dashboards.js"); }

// FIX-3 E — THE SAME POINT LAST YEAR, ONCE. The Board's "Same point last year"
// and the giving summary's comparison are one figure: the gifts source over
// the window orgTime.samePointLastYear draws. Both screens call this; neither
// draws its own window. Filters (a fund, a campaign) narrow it the way they
// narrow the summary.
function samePointLastYearSource(from, to, today, filters = {}) {
  const w = orgTime.samePointLastYear(from, to, today);
  if (!w) return null;
  const params = { from: w.from, to: w.to };
  if (filters.fund) params.fund = filters.fund;
  if (filters.campaign) params.campaign = filters.campaign;
  return { key: "gifts", params };
}

function parseReportParams(q, org = null) {   // ORG_TZ_SEAM_OK
  const bad = msg => { const e = new Error(msg); e.status = 400; return e; };
  const p = {};

  p.yearMode = q.yearMode || "fiscal";
  if (!["fiscal", "calendar"].includes(p.yearMode)) throw bad("yearMode must be 'fiscal' or 'calendar'");
  // FIX-3 E — the org's own fiscal start month and today, so a report's year
  // is the Board's year and "the same point last year" is the Board's point.
  p.org = org || {};
  p.fiscalStartMonth = orgTime.orgFiscalStartMonth(p.org);
  p.today = orgToday(p.org);

  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

  if (q.year !== undefined) {
    p.year = parseInt(q.year, 10);
    if (!Number.isInteger(p.year) || p.year < 1970 || p.year > 2100) throw bad("year must be an integer between 1970 and 2100");
    const b = reportYearBounds(p.year, p.yearMode, p.fiscalStartMonth);
    p.from = b.from; p.to = b.to;
    p.period = p.yearMode;
  } else if (q.from || q.to) {
    if (!q.from || !isDate(q.from)) throw bad("from must be YYYY-MM-DD");
    if (!q.to || !isDate(q.to)) throw bad("to must be YYYY-MM-DD");
    p.from = q.from; p.to = q.to;
    p.year = reportCurrentYear(p.yearMode, org); // for reports that need a year anyway
    p.period = "custom";
  } else {
    p.year = reportCurrentYear(p.yearMode, org);
    const b = reportYearBounds(p.year, p.yearMode, p.fiscalStartMonth);
    p.from = b.from; p.to = b.to;
    p.period = p.yearMode;
  }
  if (p.from > p.to) throw bad("from must be on or before to");
  if (Date.parse(p.to) - Date.parse(p.from) > 10 * 366 * 86400000) throw bad("Date range too large: 10 years max");

  if (q.fundId) p.fundId = String(q.fundId);
  if (q.campaignId) p.campaignId = String(q.campaignId);

  p.groupBy = q.groupBy || "funds";
  if (!["funds", "campaigns", "giving_pages"].includes(p.groupBy)) throw bad("groupBy must be funds, campaigns, or giving_pages");

  p.scope = q.scope === "lifetime" ? "lifetime" : "period";
  p.limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);
  p.view = q.view === "household" ? "household" : "individual"; // top-donors grouping (BUILD-14)
  // BUILD-98 Part 1 — reports are HARD credit unless somebody asks. `credit=soft`
  // adds a separate soft-credit column beside the hard total; it never changes
  // the ranking or the total a report states.
  p.credit = q.credit === "soft" ? "soft" : "hard";
  p.format = q.format === "csv" ? "csv" : "json";
  return p;
}
function reportYearLabel(y, p) {
  if (p.yearMode !== "fiscal") return String(y);
  return FP ? FP.fyLabelFromEnd(y, p.fiscalStartMonth || 7) : `FY${y}`;
}
function reportGiftWhere(p, orgId, params) {
  // TRUTH-1: a report's rows are money, so a soft or matching credit row is
  // never in them (the same rule as the gifts source their figures open).
  let sql = ` g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}`;
  params.push(orgId, p.from, p.to);
  if (p.fundId) { sql += " AND g.fund_id = ?"; params.push(p.fundId); }
  if (p.campaignId) { sql += " AND g.campaign_id = ?"; params.push(p.campaignId); }
  return sql;
}
// SCALE-1: the donor join carries the tenant rule, so the planner probes this
// org's donors instead of hashing every org's (212 ms -> 58 ms at 150k gifts).
const REPORT_GIFT_FROM = "FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id WHERE";

// ── REPORTS-4 · A REPORT'S FIGURES, EACH THROUGH ITS SOURCE ──────────────
// Every number a report puts on screen is computed here, by the source that
// opens its rows, and the report shows THAT value: so the number and the rows
// behind it are one computation and cannot disagree. Returns, per key, the
// value, the source and the one sentence that defines it.
async function reportFigures(orgId, specs) {
  const keys = Object.keys(specs).filter(k => specs[k]);
  const deps = { computeRetentionRate, computeDriftForDonors };
  const got = await Promise.all(keys.map(k => Promise.all([
    figureSources.figureValue(orgId, specs[k], deps), figureSources.figureSentence(specs[k])])));
  return Object.fromEntries(keys.map((k, i) => [k, { value: got[i][0].value, cents: got[i][0].cents, blank: got[i][0].blank,
    source: specs[k], definition: got[i][1] }]));
}

async function reportGivingSummary(orgId, p) {
  // SCALE-1: the period totals and the new-donor split this function used to
  // read first were never returned (the figures below come from reportFigures);
  // they were 2 of its 8 serial reads and are gone. The rest are independent
  // and run as one parallel batch.
  const mParams = [];
  const mWhere = reportGiftWhere(p, orgId, mParams);
  const pMonthly = query(
    `SELECT LEFT(g.date, 7) AS month, COUNT(*)::int AS gifts,
            COALESCE(SUM(g.amount),0) AS total, ${NUMBERS.money.GIVERS("g", "d")}::int AS donors
     ${REPORT_GIFT_FROM} ${mWhere} GROUP BY 1 ORDER BY 1`, mParams);

  // FIX-3 E — THE COMPARISON: the same point last year, the Board's figure,
  // through the one function the Board reads (samePointLastYearSource). A
  // period still running is cut at today and compared with the same stretch
  // a year back; a finished one with the same dates a year earlier.
  const cmpSource = samePointLastYearSource(p.from, p.to, p.today || orgToday(p.org || {}), { fund: p.fundId, campaign: p.campaignId });
  const pComparison = (async () => {
  let comparison = null;
  if (cmpSource) {
    const D = await dashboardsMod();
    const f = await figureSources.figureValue(orgId, cmpSource);
    comparison = {
      basis: "same-point", label: "Same point last year",
      from: cmpSource.params.from, to: cmpSource.params.to,
      value: f.value, cents: f.cents, source: cmpSource,
      // A fiscal year compares with the Board's sentence, word for word.
      definition: p.period === "fiscal"
        ? D.dashboardByKey("board").metrics.find(m => m.key === "revenueLastYear").definition
        : "Gifts received in the same stretch a year earlier, so the comparison is like for like.",
    };
  }

  // REPORTS-5: when Steward has no gifts for the comparison's stretch, an old
  // system's report that covers exactly that stretch stands in, labelled; and
  // the period itself says what the old system said for it, beside Steward's.
  if (comparison && !(comparison.value > 0)) {
    const h = await figureSources.historicalGiving(orgId, comparison.from, comparison.to, { baseline: true });
    if (h) comparison = { ...comparison, value: h.value, cents: h.cents, source: h.source, imported: true, label: `${comparison.label}, from your old system`, definition: h.note };
  }
  return comparison;
  })();
  const pImported = figureSources.historicalGiving(orgId, p.from, p.to);

  // The whole period of equal length before this one. NOT the comparison the
  // screen states: kept for the low-volume default (Reports opens on last year
  // while this one is nearly empty), and named for what it is.
  const spanDays = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  const dayShift = (iso, days) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const prior = { ...p, from: dayShift(p.from, -spanDays), to: dayShift(p.from, -1) };
  const pParams = [];
  const pWhere = reportGiftWhere(prior, orgId, pParams);
  const pPrior = query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total
     ${REPORT_GIFT_FROM} ${pWhere}`, pParams);

  // REPORTS-4: every figure on the summary, through the source that opens it.
  const F = { fund: p.fundId || undefined, campaign: p.campaignId || undefined };
  const G = extra => ({ key: "gifts", params: { from: p.from, to: p.to, ...F, ...extra } });
  const pFigures = reportFigures(orgId, {
    total: G({}), giftCount: G({ measure: "count" }),
    uniqueDonors: { key: "givers", params: { from: p.from, to: p.to, ...F } },
    newDonors: { key: "givers", params: { from: p.from, to: p.to, ...F, first: "new" } },
    returningDonors: { key: "givers", params: { from: p.from, to: p.to, ...F, first: "returning" } },
    avgGift: G({ measure: "mean" }), medianGift: G({ measure: "median", order: "amount" }),
    onlineTotal: G({ online: true }), onlineCount: G({ online: true, measure: "count" }),
    offlineTotal: G({ online: false }), offlineCount: G({ online: false, measure: "count" }),
  });
  // HOME-3: the events dated in the period, each with what it raised the way
  // she says it (received + pledged), beside the gifts received above.
  const pEvents = require("../../numbers").eventsRaised(orgId, { from: p.from, to: p.to, withMoney: true });
  const [monthly, comparison, importedThisPeriod, [priorTotals], figures, events] =
    await Promise.all([pMonthly, pComparison, pImported, pPrior, pFigures, pEvents]);
  const fv = k => figures[k].value;
  return {
    figures,
    importedThisPeriod,
    events,
    from: p.from, to: p.to,
    total: fv("total"),
    giftCount: fv("giftCount"),
    uniqueDonors: fv("uniqueDonors"),
    avgGift: fv("avgGift"),
    medianGift: fv("medianGift"),
    newDonors: fv("newDonors"),
    returningDonors: fv("returningDonors"),
    onlineTotal: fv("onlineTotal"),
    onlineCount: fv("onlineCount"),
    offlineTotal: fv("offlineTotal"),
    offlineCount: fv("offlineCount"),
    year: p.year, yearMode: p.yearMode, fiscalStartMonth: p.fiscalStartMonth,
    // NUMBERS-4: this fiscal year, named as Reports names it (the year it ends
    // in), on the org's calendar, so the browser never works it out.
    fiscalYear: reportCurrentYear("fiscal", p.org),
    calendarYear: reportCurrentYear("calendar", p.org),   // LEDGER-2: the chips name no year the browser worked out
    // The total opens too: the same gifts, through the same source.
    totalSource: { key: "gifts", params: { from: p.from, to: p.to, ...(p.fundId ? { fund: p.fundId } : {}), ...(p.campaignId ? { campaign: p.campaignId } : {}) } },
    comparison,
    prior: { basis: "full-period", label: "The whole period before this one", from: prior.from, to: prior.to, total: Number(priorTotals.total), giftCount: priorTotals.gift_count },
    // Each month's gifts open through the same source, clipped to the period.
    monthly: monthly.map(m => {
      const mFrom = m.month + "-01" < p.from ? p.from : m.month + "-01";
      const end = orgTime.addDays(orgTime.addDays(m.month + "-01", 32).slice(0, 7) + "-01", -1);
      const mTo = end > p.to ? p.to : end;
      return { month: m.month, gifts: m.gifts, total: Number(m.total), donors: m.donors,
        source: { key: "gifts", params: { from: mFrom, to: mTo, ...(p.fundId ? { fund: p.fundId } : {}), ...(p.campaignId ? { campaign: p.campaignId } : {}) } } };
    }),
  };
}

async function reportByGroup(orgId, p) {
  // One query family, parameterized by groupBy. Campaigns honor the legacy
  // dual attribution (gifts.campaign_id OR the older gifts.campaign name
  // column); dangling ids (deleted fund/page) fall into the "No X" bucket —
  // the tolerated-dangling-reference pattern.
  const JOINS = {
    funds: { join: "LEFT JOIN fin_funds x ON x.id = g.fund_id AND x.org_id = g.org_id", name: "COALESCE(x.name, 'Unrestricted (no fund)')" },
    campaigns: { join: "LEFT JOIN campaigns x ON x.id = g.campaign_id AND x.org_id = g.org_id", name: "COALESCE(x.name, NULLIF(g.campaign, ''), 'No campaign')" },
    giving_pages: { join: "LEFT JOIN giving_pages x ON x.id = g.giving_page_id AND x.org_id = g.org_id", name: "COALESCE(x.title, 'No giving page')" },
  };
  const cfg = JOINS[p.groupBy];
  const params = [];
  const where = reportGiftWhere(p, orgId, params);
  const rows = await query(
    `SELECT ${cfg.name} AS name, MIN(x.id) AS key_id, COUNT(DISTINCT x.id)::int AS key_ids, COALESCE(SUM(g.amount),0) AS total,
            COUNT(*)::int AS gift_count, ${NUMBERS.money.GIVERS("g", "d")}::int AS unique_donors
     FROM gifts g JOIN donors d ON d.id = g.donor_id ${cfg.join}
     WHERE ${where} GROUP BY 1 ORDER BY total DESC`, params);
  // REPORTS-4: a row opens its gifts when one id names it: a fund or a page
  // (or none of them), or a campaign by its id. A campaign known only by an
  // old name on the gift has no id to open by, and says so by not opening.
  const PARAM = { funds: "fund", campaigns: "campaign", giving_pages: "page" }[p.groupBy];
  const base = { from: p.from, to: p.to, ...(p.fundId ? { fund: p.fundId } : {}), ...(p.campaignId ? { campaign: p.campaignId } : {}) };
  const rowSource = r => {
    if (r.key_ids === 1) return { key: "gifts", params: { ...base, [PARAM]: r.key_id } };
    if (r.key_ids === 0 && PARAM !== "campaign") return { key: "gifts", params: { ...base, [PARAM]: "none" } };
    return null;
  };
  const figures = await reportFigures(orgId, { grandTotal: { key: "gifts", params: base } });
  const grand = rows.reduce((s, r) => s + Number(r.total), 0);
  return {
    figures,
    from: p.from, to: p.to, groupBy: p.groupBy, grandTotal: figures.grandTotal.value,
    rows: rows.map(r => ({
      source: rowSource(r),
      name: r.name, total: Number(r.total), giftCount: r.gift_count,
      uniqueDonors: r.unique_donors,
      pct: grand > 0 ? Math.round(Number(r.total) / grand * 1000) / 10 : 0,
    })),
  };
}

// LYBUNT = gift in the prior year, none in the selected year.
// SYBUNT = any gift ever before the selected year, none in the selected year.
// Both predicates live here in SQL and nowhere else.
// GROUPS-2: the predicate on its own, for a person alias, so a Groups starter
// ("Gave last year, not yet this year") is this list and never a second guess.
// TRUTH-2: the one rule is shared/numbers/bunt.js; the report, its header,
// the group page and the Groups starter all read it.
function buntPredicate(kind, cur, prior, a = "d") {
  return NUMBERS.bunt.buntSql(kind, cur, prior, a);
}

async function reportBuntList(orgId, p, kind) {
  const cur = reportYearBounds(p.year, p.yearMode, p.fiscalStartMonth);
  const prior = reportYearBounds(p.year - 1, p.yearMode, p.fiscalStartMonth);
  const bp0 = buntPredicate(kind, cur, prior, "d");
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.assigned_to_name,
            COALESCE(d.total_giving, 0) AS total_giving, d.last_gift_date, d.last_gift_amount,
            ${NUMBERS.givingBetween.LAST_YEAR_SUM("d")} AS prior_year_total, ly.f AS last_year_from, ly.t AS last_year_to
     FROM donors d ${NUMBERS.givingBetween.LAST_YEAR_JOIN("d")}
     WHERE d.org_id = ? AND d.deleted_at IS NULL
       AND ${bp0.sql}
     ORDER BY COALESCE(d.total_giving, 0) DESC`,
    // LEDGER-1: each person's amount is what they gave in the last year they
    // gave (givingBetween.LAST_YEAR_SUM): last year for LYBUNT, and for SYBUNT
    // their own last year, never the prior year they did not give in.
    [...NUMBERS.givingBetween.lastYearArgs(cur.from), orgId, ...bp0.args]);
  // REPORTS-4: the count and the prior-year giving at stake, through the
  // `bunt` source (the same predicates, moved there).
  const bp = { kind, from: cur.from, to: cur.to, prevFrom: prior.from, prevTo: prior.to };
  const figures = await reportFigures(orgId, { people: { key: "bunt", params: bp }, atStake: { key: "bunt", params: { ...bp, measure: "sum" } } });
  return {
    figures,
    year: p.year, yearMode: p.yearMode, currentPeriod: cur, priorPeriod: prior,
    rows: rows.map(r => ({
      id: r.id, name: r.name, email: r.email, assignedTo: r.assigned_to_name,
      lifetimeGiving: Number(r.total_giving), lastGiftDate: r.last_gift_date,
      lastGiftAmount: Number(r.last_gift_amount || 0), priorYearTotal: Number(r.prior_year_total),
      lastYear: r.last_year_from ? { from: r.last_year_from, to: r.last_year_to } : null,
    })),
  };
}

async function reportRetention(orgId, p) {
  // Last 3 COMPLETED years (per year mode). Retention for year Y = donors
  // who gave in Y-1 and gave again in Y; dollar retention = Y dollars from
  // those retained donors / total Y-1 dollars; first-year retention = the
  // same, restricted to donors whose first-ever gift was in Y-1.
  const lastCompleted = reportCurrentYear(p.yearMode, p.org) - 1;
  const years = [lastCompleted - 2, lastCompleted - 1, lastCompleted];
  // INSIGHTS-2: the three years at once, and their figures in one read (server/reports/retentionFigures.js).
  const bounds = years.map(y => ({ y, cur: reportYearBounds(y, p.yearMode, p.fiscalStartMonth), prior: reportYearBounds(y - 1, p.yearMode, p.fiscalStartMonth) }));
  const figs = require("./retentionFigures").retentionFigures(orgId, bounds.map(({ cur, prior }) => ({ from1: prior.from, to1: prior.to, from0: cur.from, to0: cur.to })));
  figs.catch(() => {});   // awaited per row below; never an unhandled rejection meanwhile
  const rows = await Promise.all(bounds.map(async ({ y, cur, prior }, j) => {
    const [r] = await query(
      // NUMBERS-5: a donor in a year gave a gift in it (a refund alone is not
      // giving), and their dollars are money (credit rows out, refunds off).
      `WITH prior AS (SELECT g.donor_id, ${NUMBERS.money.MONEY_SUM("g")} AS amt FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                      WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${NUMBERS.givingBetween.IN_SPAN("g")} GROUP BY g.donor_id HAVING bool_or(${NUMBERS.money.GIFT("g")})),
            cur AS (SELECT g.donor_id, ${NUMBERS.money.MONEY_SUM("g")} AS amt FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                    WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${NUMBERS.givingBetween.IN_SPAN("g")} GROUP BY g.donor_id HAVING bool_or(${NUMBERS.money.GIFT("g")})),
            firsts AS (SELECT donor_id, MIN(date) AS fg FROM gifts WHERE org_id = ? GROUP BY donor_id)
       SELECT (SELECT COUNT(*) FROM prior)::int AS prior_donors,
              (SELECT COUNT(*) FROM prior pr WHERE EXISTS (SELECT 1 FROM cur c WHERE c.donor_id = pr.donor_id))::int AS retained_donors,
              (SELECT COALESCE(SUM(amt),0) FROM prior) AS prior_dollars,
              (SELECT COALESCE(SUM(c.amt),0) FROM cur c WHERE EXISTS (SELECT 1 FROM prior pr WHERE pr.donor_id = c.donor_id)) AS retained_dollars,
              (SELECT COUNT(*) FROM prior pr JOIN firsts f ON f.donor_id = pr.donor_id WHERE f.fg >= ? AND f.fg <= ?)::int AS first_year_donors,
              (SELECT COUNT(*) FROM prior pr JOIN firsts f ON f.donor_id = pr.donor_id
                WHERE f.fg >= ? AND f.fg <= ? AND EXISTS (SELECT 1 FROM cur c WHERE c.donor_id = pr.donor_id))::int AS first_year_retained`,
      [orgId, prior.from, prior.to, orgId, cur.from, cur.to, orgId, prior.from, prior.to, prior.from, prior.to]);
    const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : null;
    const row = {
      year: y, label: reportYearLabel(y, p),
      priorDonors: r.prior_donors, retainedDonors: r.retained_donors,
      retentionRate: pct(r.retained_donors, r.prior_donors),
      priorDollars: Number(r.prior_dollars), retainedDollars: Number(r.retained_dollars),
      dollarRetentionRate: r.prior_dollars > 0 ? Math.round(Number(r.retained_dollars) / Number(r.prior_dollars) * 1000) / 10 : null,
      firstYearDonors: r.first_year_donors, firstYearRetained: r.first_year_retained,
      firstYearRetentionRate: pct(r.first_year_retained, r.first_year_donors),
    };
    // REPORTS-4: the row's figures through their sources, and the row shows
    // THEIR values. A person counts as having given when a gift above zero is
    // dated in the year, as on the Board; a refund alone is not giving.
    const f = (await figs)[j];
    for (const k of Object.keys(f)) row[k] = f[k].value;
    row.figures = f;
    return row;
  }));
  return { yearMode: p.yearMode, rows };
}

async function reportTopDonors(orgId, p) {
  if (p.scope === "lifetime") {
    // Donor columns, not SUM(gifts) — imported giving history often has
    // total_giving set with no individual gifts rows behind it.
    const rows = await query(
      `SELECT id, name, COALESCE(total_giving,0) AS total, COALESCE(gift_count,0) AS gift_count, last_gift_date
       FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(total_giving,0) > 0
       ORDER BY COALESCE(total_giving,0) DESC LIMIT ?`, [orgId, p.limit]);
    let soft = new Map();
    if (p.credit === "soft" && rows.length) {
      const sr = await query(
        `SELECT sc.donor_id, COALESCE(SUM(sc.amount),0) AS soft FROM gift_soft_credits sc
           JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
          WHERE sc.org_id=? AND sc.donor_id = ANY(?) GROUP BY sc.donor_id`, [orgId, rows.map(r => r.id)]);
      soft = new Map(sr.map(r => [r.donor_id, Number(r.soft)]));
    }
    // SWEEP-5 · REPORTS SAYS THE ALL-TIME TOTAL. Reports had no all-time
    // giving anywhere, so nobody could hold it against Atlas's "You raised
    // $X ever". It is the gifts source over the same window Atlas asks for
    // ("all time": 1900-01-01 to today, shared/askCatalog.js), so the two are
    // one computation and cannot drift.
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const figures = await reportFigures(orgId, { topTotal: { key: "top-lifetime", params: { top: p.limit } },
      allTime: { key: "gifts", params: { from: "1900-01-01", to: today } } });
    return { figures, scope: "lifetime", credit: p.credit, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, total: Number(r.total), giftCount: Number(r.gift_count), lastGiftDate: r.last_gift_date,
      ...(p.credit === "soft" ? { softCredit: soft.get(r.id) || 0 } : {}) })) };
  }
  const params = [];
  const where = reportGiftWhere(p, orgId, params);
  if (p.view === "household") {
    // Household view: group the SAME gift rows by household (solo donors are
    // their own group via COALESCE(household_id, donor_id)). This is a pure
    // GROUP BY re-key — SUM over groups === SUM over individuals === org hard
    // total, so grouping by household can NEVER inflate totals. That
    // invariant is asserted in tests/households.test.js.
    const rows = await query(
      `SELECT COALESCE(d.household_id, d.id) AS group_id,
              COALESCE(h.name, d.name) AS name,
              (h.id IS NOT NULL) AS is_household,
              COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count,
              MAX(g.date) AS last_gift_date, ${NUMBERS.money.GIVERS("g", "d")}::int AS member_count
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
       WHERE ${where} AND d.erased_at IS NULL
       GROUP BY COALESCE(d.household_id, d.id), COALESCE(h.name, d.name), h.id
       HAVING ${NUMBERS.money.GIVERS("g", "d")} > 0
       ORDER BY total DESC LIMIT ?`, [...params, p.limit]);   // TRUTH-2: a top donor gave (a gift above $0) and is not erased
    return { scope: "period", view: "household", from: p.from, to: p.to,
      rows: rows.map((r, i) => ({ rank: i + 1, id: r.group_id, name: r.name, isHousehold: !!r.is_household, memberCount: r.member_count, total: Number(r.total), giftCount: r.gift_count, lastGiftDate: r.last_gift_date })) };
  }
  const rows = await query(
    `SELECT d.id, d.name, COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count, MAX(g.date) AS last_gift_date
     ${REPORT_GIFT_FROM} ${where} AND d.erased_at IS NULL GROUP BY d.id, d.name
     HAVING ${NUMBERS.money.GIVERS("g", "d")} > 0
     ORDER BY total DESC, d.id LIMIT ?`, [...params, p.limit]);   // TRUTH-2: as the givers figure counts them
  const figures = await reportFigures(orgId, { topTotal: { key: "givers", params: { from: p.from, to: p.to, top: p.limit, measure: "sum",
    ...(p.fundId ? { fund: p.fundId } : {}), ...(p.campaignId ? { campaign: p.campaignId } : {}) } } });
  return { figures, scope: "period", view: "individual", from: p.from, to: p.to, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, total: Number(r.total), giftCount: r.gift_count, lastGiftDate: r.last_gift_date })) };
}

// ── BUILD-17 reporting-cadence reports ─────────────────────────────────────
// 3-year donor giving comparison [Core]: per-donor giving this year vs last
// vs prior (YoYoY), plus the org-level 3-year trend. Reuses reportYearBounds /
// yearMode — one FY definition with the rest of Reports/Finance.
// FIX-60 — EQUAL SPANS. The three years were three whole years, so in
// October the newest column was four months against twelve and the page said
// "a change of -69% year over year". When the selected year is still running,
// every year is cut to the same stretch (orgTime.equalYearSpans, the same
// point last year twice over) and `span` says which days, e.g. "Jul 1 to Oct
// 30, each year". A finished year keeps all three whole, and says that too.
async function yearSpans(p, bounds) {
  const DD = await import("../../shared/displayDate.js");
  const today = p.today || orgToday(p.org || {});
  const { years, cut } = orgTime.equalYearSpans(bounds, today);
  // "Jan 1 to Oct 30, each year", and where a Feb 29 moved a column's last
  // day (the window counts days), the sentence says so rather than pretend.
  const md = s => DD.displayMonthDay(s);
  const off = years.slice(1).filter(y => md(y.to) !== md(years[0].to));
  const sentence = DD.eachYearSpan(years[0].from, years[0].to)
    + (off.length ? ` (${off.map(y => `to ${md(y.to)} in ${DD.civilYear(y.to)}`).join(", ")}, the same number of days across a February 29)` : "");
  return { years, cut, through: cut ? today : null, sentence };
}

async function reportThreeYear(orgId, p) {
  const sp = await yearSpans(p, [0, 1, 2].map(k => reportYearBounds(p.year - k, p.yearMode, p.fiscalStartMonth)));
  const [y0, y1, y2] = sp.years;   // most recent (selected) year first, each cut to the same span
  await FP_READY;
  const label = y => reportYearLabel(y, p);
  const YEAR_SUM = NUMBERS.givingBetween.SPAN_SUM("g");   // NUMBERS-5: each year's money (credit rows out)
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.assigned_to_name,
            ${YEAR_SUM} AS y0, ${YEAR_SUM} AS y1, ${YEAR_SUM} AS y2
     FROM donors d JOIN gifts g ON g.donor_id = d.id AND g.org_id = d.org_id
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND ${NUMBERS.givingBetween.IN_SPAN("g")}
     GROUP BY d.id, d.name, d.email, d.assigned_to_name
     ORDER BY (${YEAR_SUM} + ${YEAR_SUM} + ${YEAR_SUM}) DESC`,
    [y0.from, y0.to, y1.from, y1.to, y2.from, y2.to, orgId, y2.from, y0.to,
     y0.from, y0.to, y1.from, y1.to, y2.from, y2.to]);
  const donors = rows.map(r => {
    const c0 = Number(r.y0), c1 = Number(r.y1), c2 = Number(r.y2);
    return {
      id: r.id, name: r.name, email: r.email, assignedTo: r.assigned_to_name,
      y0: c0, y1: c1, y2: c2,
      // YoY change on the two most recent years, the number that matters most.
      changePct: c1 > 0 ? Math.round((c0 - c1) / c1 * 1000) / 10 : (c0 > 0 ? null : 0),
      trend: c0 > c1 ? "up" : c0 < c1 ? "down" : "flat",
    };
  });
  // REPORTS-4: each year's total and givers, and the growth, through sources.
  const yr = b => ({ from: b.from, to: b.to });
  const figures = await reportFigures(orgId, {
    t0: { key: "gifts", params: yr(y0) }, t1: { key: "gifts", params: yr(y1) }, t2: { key: "gifts", params: yr(y2) },
    d0: { key: "givers", params: yr(y0) }, d1: { key: "givers", params: yr(y1) }, d2: { key: "givers", params: yr(y2) },
    growth: { key: "giving-change", params: { from: y0.from, to: y0.to, prevFrom: y1.from, prevTo: y1.to } },
  });
  return {
    figures,
    yearMode: p.yearMode,
    span: { cut: sp.cut, through: sp.through, sentence: sp.sentence },
    // Each year's total and givers are the sources' values, and open them.
    // REPORTS-5: and what an old system's report said for that year, when one
    // was imported: beside Steward's total, never added into it.
    years: await Promise.all([[p.year - 2, y2, "t2", "d2"], [p.year - 1, y1, "t1", "d1"], [p.year, y0, "t0", "d0"]].map(async ([yy, b, t, d]) => ({
      year: yy, label: label(yy), from: b.from, to: b.to, total: figures[t].value, donors: figures[d].value, source: figures[t].source, donorsSource: figures[d].source,
      imported: await figureSources.historicalGiving(orgId, b.from, b.to) }))),
    orgGrowthPct: figures.growth.value,
    labels: { y0: label(p.year), y1: label(p.year - 1), y2: label(p.year - 2) },
    rows: donors,
  };
}

// Annual report [Core]: the year-end summary. Total giving, gift/donor counts,
// new vs returning, growth vs prior year, donor retention for the year, and
// the by-fund / by-campaign breakdown — one page a board wants at year end.
async function reportAnnual(orgId, p) {
  // TRUTH-1: every query here is money, so a soft or matching credit row is in
  // none of them (its rows foot to the gifts source, which leaves them out).
  // FIX-60: a year still running is cut at today and compared with the same
  // stretch of the year before (`priorSpan`), never with all of it. Retention
  // keeps the whole prior year: it asks who of LAST year's donors came back.
  const prior = reportYearBounds(p.year - 1, p.yearMode, p.fiscalStartMonth);
  const sp = await yearSpans(p, [reportYearBounds(p.year, p.yearMode, p.fiscalStartMonth), prior]);
  const [cur, priorSpan] = sp.years;
  const [totals] = await query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
            ${NUMBERS.money.GIVERS("g", "d")}::int AS unique_donors,
            COALESCE(AVG(g.amount),0) AS avg_gift
     FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}`,
    [orgId, cur.from, cur.to]);
  const [priorT] = await query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
            ${NUMBERS.money.GIVERS("g", "d")}::int AS unique_donors
     FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}`,
    [orgId, priorSpan.from, priorSpan.to]);
  const [split] = await query(
    `WITH period_donors AS (SELECT DISTINCT g.donor_id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                            WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}),
          -- NUMBERS-3: the one first gift (shared/numbers/firstGift.js), imported history included
          firsts AS (SELECT d.id AS donor_id, ${NUMBERS.firstGift.FIRST_DATE("d")} AS fg FROM donors d WHERE d.org_id = ?)
     SELECT COUNT(*) FILTER (WHERE f.fg >= ? AND f.fg <= ?)::int AS new_donors, COUNT(*)::int AS period_donors
     FROM period_donors pd JOIN firsts f ON f.donor_id = pd.donor_id`,
    [orgId, cur.from, cur.to, orgId, cur.from, cur.to]);
  // Retention: donors who gave in the prior year and gave again this year
  // (NUMBERS-3: shared/numbers/retained.js, so a refund is not giving again).
  const ret = await NUMBERS.retained.retention(query, orgId, cur, prior)
    .then(r => ({ prior_donors: r.prior, retained: r.retained }));
  const byFund = await query(
    `SELECT COALESCE(x.name,'Unrestricted (no fund)') AS name, MIN(x.id) AS key_id, COUNT(DISTINCT x.id)::int AS key_ids, COALESCE(SUM(gf.amount),0) AS total, COUNT(*)::int AS gift_count
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     JOIN ${NUMBERS.fundLines.GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id   -- GIFTS-2: a split gift by its lines
     LEFT JOIN fin_funds x ON x.id = gf.fund_id AND x.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}
     GROUP BY 1 ORDER BY total DESC`, [orgId, cur.from, cur.to]);
  const byCampaign = await query(
    `SELECT COALESCE(x.name, NULLIF(g.campaign,''), 'No campaign') AS name, MIN(x.id) AS key_id, COUNT(DISTINCT x.id)::int AS key_ids, COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     LEFT JOIN campaigns x ON x.id = g.campaign_id AND x.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}
     GROUP BY 1 ORDER BY total DESC`, [orgId, cur.from, cur.to]);
  // REPORTS-4: the year's figures through their sources; the page shows them.
  const yw = { from: cur.from, to: cur.to };
  const figures = await reportFigures(orgId, {
    total: { key: "gifts", params: yw }, giftCount: { key: "gifts", params: { ...yw, measure: "count" } },
    uniqueDonors: { key: "givers", params: yw }, avgGift: { key: "gifts", params: { ...yw, measure: "mean" } },
    growthPct: { key: "giving-change", params: { ...yw, prevFrom: priorSpan.from, prevTo: priorSpan.to } },
    priorTotal: { key: "gifts", params: { from: priorSpan.from, to: priorSpan.to } },
    newDonors: { key: "givers", params: { ...yw, first: "new" } }, returningDonors: { key: "givers", params: { ...yw, first: "returning" } },
    retentionRate: { key: "retention-window", params: { from1: prior.from, to1: prior.to, from0: cur.from, to0: cur.to } },
  });
  const groupSource = (r, param) => r.key_ids === 1 ? { key: "gifts", params: { ...yw, [param]: r.key_id } }
    : r.key_ids === 0 && param === "fund" ? { key: "gifts", params: { ...yw, fund: "none" } } : null;
  const total = Number(totals.total), priorTotal = Number(priorT.total);
  const grand = arr => arr.reduce((s, r) => s + Number(r.total), 0);
  return {
    year: p.year, yearMode: p.yearMode, label: reportYearLabel(p.year, p),
    priorLabel: reportYearLabel(p.year - 1, p),
    span: { cut: sp.cut, through: sp.through, sentence: sp.sentence, from: cur.from, to: cur.to, priorFrom: priorSpan.from, priorTo: priorSpan.to },
    total, giftCount: totals.gift_count, uniqueDonors: totals.unique_donors,
    avgGift: Math.round(Number(totals.avg_gift) * 100) / 100,
    priorTotal, priorGiftCount: priorT.gift_count, priorUniqueDonors: priorT.unique_donors,
    growthPct: priorTotal > 0 ? Math.round((total - priorTotal) / priorTotal * 1000) / 10 : null,
    newDonors: split.new_donors, returningDonors: split.period_donors - split.new_donors,
    priorDonors: ret.prior_donors, retainedDonors: ret.retained,
    retentionRate: ret.prior_donors > 0 ? Math.round(ret.retained / ret.prior_donors * 1000) / 10 : null,
    ...Object.fromEntries(Object.entries(figures).map(([k, f]) => [k, f.value])),
    figures,
    byFund: byFund.map(r => ({ source: groupSource(r, "fund"), name: r.name, total: Number(r.total), giftCount: r.gift_count, pct: total > 0 ? Math.round(Number(r.total) / total * 1000) / 10 : 0 })),
    byCampaign: byCampaign.map(r => ({ source: groupSource(r, "campaign"), name: r.name, total: Number(r.total), giftCount: r.gift_count, pct: total > 0 ? Math.round(Number(r.total) / total * 1000) / 10 : 0 })),
  };
}

// Robust solicitations report [Team]: the marquee oversight artifact. Open
// asks by stage + stage-weighted forecast, asks vs closes by officer over the
// period, and aging prospects (open asks whose donor has stalled in-stage).
async function reportSolicitations(orgId, p) {
  // Open asks grouped by the donor's current pipeline stage.
  const stageRows = await query(
    `SELECT d.stage AS stage, COUNT(*)::int AS cnt, COALESCE(SUM(o.target_amount),0) AS ask
     FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND o.status = 'open' AND d.deleted_at IS NULL
     GROUP BY d.stage`, [orgId]);
  const stageMap = Object.fromEntries(stageRows.map(r => [r.stage, r]));
  let openTotal = 0, weightedTotal = 0;
  const byStage = ALL_PIPELINE_STAGES.map(st => {
    const ask = Number(stageMap[st]?.ask || 0), cnt = stageMap[st]?.cnt || 0;
    const weight = STAGE_WEIGHT[st] ?? 0;
    openTotal += ask; weightedTotal += ask * weight;
    return { stage: st, count: cnt, ask, weight, weighted: Math.round(ask * weight * 100) / 100 };
  });
  // Asks vs closes by officer, over the report period (p.from..p.to).
  const officers = await query("SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const openByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='open' GROUP BY officer_id`, [orgId]);
  const madeByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND ${inOrgDays("created_at", "org_id", "?", "?")} GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  const wonByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='won' AND ${inOrgDays("closed_at", "org_id", "?", "?")} GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  // Lost asks decided in the window — the OTHER half of the win-rate denominator.
  // Symmetric with won (marking an ask lost stamps closed_at=NOW(), like won).
  const lostByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='lost' AND ${inOrgDays("closed_at", "org_id", "?", "?")} GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  const idx = rows => Object.fromEntries(rows.map(r => [r.officer_id, r]));
  const op = idx(openByOfficer), md = idx(madeByOfficer), wn = idx(wonByOfficer), ls = idx(lostByOfficer);
  const byOfficer = officers.map(o => {
    const asksMade = md[o.id]?.cnt || 0, giftsClosed = wn[o.id]?.cnt || 0, giftsLost = ls[o.id]?.cnt || 0;
    const decided = giftsClosed + giftsLost;
    return {
      officerId: o.id, name: o.name, color: o.portfolio_color,
      openAsks: op[o.id]?.cnt || 0, openAskAmount: Number(op[o.id]?.amt || 0),
      asksMade, asksMadeAmount: Number(md[o.id]?.amt || 0),
      giftsClosed, giftsClosedAmount: Number(wn[o.id]?.amt || 0),
      lostAsks: giftsLost, lostAskAmount: Number(ls[o.id]?.amt || 0),
      decidedAsks: decided,
      // Win rate = won / (won + lost) — DECIDED asks only. Open asks are NOT
      // losses (an unclosed ask isn't a loss), so they never dilute the rate.
      // null when nothing is decided yet → the UI shows "—"/"No decided asks yet".
      winRate: decided > 0 ? Math.round(giftsClosed / decided * 1000) / 10 : null,
    };
  });
  // Aging prospects: open asks whose donor's most recent move into their
  // current stage is oldest — the stalled solicitations that need a nudge.
  const aging = await query(
    `SELECT d.id, d.name, d.stage, d.assigned_to_name, o.target_amount, o.name AS opp_name,
            (SELECT MAX(m.created_at) FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id AND m.to_stage=d.stage) AS last_move,
            GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(
              (SELECT MAX(m.created_at) FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id AND m.to_stage=d.stage),
              d.updated_at, d.created_at))::int) AS stage_age
     FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND o.status='open' AND d.deleted_at IS NULL
     ORDER BY stage_age DESC LIMIT 25`, [orgId]);
  // Attribution FIX — open PLEDGES alongside open asks: both are
  // committed-but-unpaid forward-looking money (the ask-vs-gift model), so the
  // oversight artifact shows them side by side. Never merged into a raised
  // figure anywhere — a pledge's payments count when they arrive, as gifts.
  const pledgeRow = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(p.amount - COALESCE(pp.paid,0)),0) AS amt
     FROM pledges p
     LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id=p.id
     WHERE p.org_id=? AND p.status='open'`, [orgId, orgId]);
  return {
    from: p.from, to: p.to,
    forecast: { open: Math.round(openTotal * 100) / 100, weighted: Math.round(weightedTotal * 100) / 100 },
    openPledges: { count: pledgeRow[0]?.cnt || 0, total: Number(pledgeRow[0]?.amt || 0) },
    byStage, byOfficer,
    aging: aging.map(r => ({ id: r.id, name: r.name, stage: r.stage, assignedTo: r.assigned_to_name,
      ask: Number(r.target_amount || 0), oppName: r.opp_name, stageAge: Number(r.stage_age) || 0 })),
  };
}

async function reportBookkeeper(orgId, p) {
  const params = [];
  let where = reportGiftWhere(p, orgId, params);
  where += ` AND ${NUMBERS.money.MONEY("g")}`;

  const rows = await query(
    `SELECT LEFT(g.date, 10) AS date,
            d.name AS donor_name,
            g.donor_id AS donor_id,
            g.amount AS amount,
            COALESCE(f.name, '') AS fund,
            COALESCE(g.payment_method, '') AS payment_method,
            COALESCE(NULLIF(g.external_id, ''), NULLIF(g.stripe_payment_id, ''), '') AS reference,
            COALESCE(g.check_number, '') AS check_number,
            COALESCE(g.processor_fee_amount, 0) AS processor_fee_amount,
            -- NUMBERS-3 (D-6): whether it is on a deposit is the one predicate
            -- (shared/numbers/deposited.js), never whether deposit_ref is set
            -- (only Undo wrote it); the column names the deposit when it has a name.
            ${NUMBERS.deposited.DEPOSIT_LABEL("g")} AS deposit_ref,
            ${NUMBERS.deposited.DEPOSITED("g")} AS on_deposit,
            COALESCE(g.deposited_on, '') AS deposited_on,
            COALESCE(g.type, '') AS gift_type,
            COALESCE(g.notes, '') AS notes,
            (g.pledge_id IS NOT NULL) AS pledge_payment,
            (g.recurring_subscription_id IS NOT NULL) AS recurring,
            COALESCE(r.receipt_number, '') AS receipt_number,
            g.id AS gift_id
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
       LEFT JOIN receipts r ON r.gift_id = g.id AND r.org_id = g.org_id AND r.type = 'gift' AND r.voided_at IS NULL
      WHERE ${where}
      ORDER BY g.date, LOWER(d.name), g.id`, params);

  // The grand total, asked of the DATABASE — a second, independent answer to
  // the same question, and the thing the row sum is checked against. It is
  // asked for EXACTLY, not pre-rounded to the same two decimals the file uses:
  // rounding it here would make the two sides agree by construction, and a
  // number that cannot disagree is not a check.
  const tParams = [];
  let tWhere = reportGiftWhere(p, orgId, tParams);
  tWhere += ` AND ${NUMBERS.money.MONEY("g")}`;
  const [tot] = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(g.amount * 100), 0)::text AS cents
       ${REPORT_GIFT_FROM} ${tWhere}`, tParams);

  const giftRows = rows.map(r => {
    const cents = bkCents(r.amount);
    const feeCents = bkCents(r.processor_fee_amount);
    const nonCash = DEP.isNonCash({ type: r.gift_type });
    return {
      date: r.date,
      donorName: r.donor_name,
      donorId: r.donor_id,
      cents,
      amount: bkDollars(cents),
      // FIX-11 Part 3 — the processor's cut, the net, and which bank line this
      // gift is part of. The fee is what the PROCESSOR took, never the
      // donor-covers-the-fee amount above it (those are two different numbers
      // and `cover_fee_amount` is the other one).
      feeCents,
      fee: bkDollars(feeCents),
      netCents: cents - feeCents,
      net: bkDollars(cents - feeCents),
      deposit: r.deposit_ref || "",
      onDeposit: r.on_deposit === true,
      depositedOn: r.deposited_on || "",
      type: r.gift_type,
      notes: r.notes,
      cashOrNot: nonCash ? "Non-cash" : "Cash",
      fund: r.fund,
      paymentMethod: r.payment_method,
      checkNumber: r.check_number,
      reference: r.reference,
      pledgePayment: r.pledge_payment ? "Yes" : "No",
      recurring: r.recurring ? "Yes" : "No",
      receiptNumber: r.receipt_number,
      giftId: r.gift_id,
    };
  });
  // MOPUP-2: a gift split across funds is one row per fund line (splitGiftRows.js).
  const out = splitGiftRows(giftRows,
    await NUMBERS.fundLines.linesFor(query, orgId, giftRows.map(r => r.giftId)), bkDollars);
  const giftCount = giftCountOf(out);

  // TOTALS BY FUND, over the same rows. A gift with no fund is its own line,
  // named for what it is — never silently dropped and never folded into
  // whichever fund happens to sort first.
  const byFundMap = new Map();
  for (const row of out) {
    const name = row.fund || "Unrestricted (no fund)";   // FEEL-1
    const e = byFundMap.get(name) || { name, cents: 0, giftCount: 0 };
    e.cents += row.cents; e.giftCount += 1;
    byFundMap.set(name, e);
  }
  const byFund = [...byFundMap.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map(f => ({ ...f, amount: bkDollars(f.cents) }));

  // THE ASSERTION, IN CENTS, BEFORE ANY FILE IS WRITTEN — bookkeeper.js.
  const rowCents = out.reduce((s, r) => s + r.cents, 0);
  const refusals = bookkeeperRefusals(out, byFund, Number(tot?.cents || 0), Number(tot?.n || 0));

  // ── WHAT IS MISSING, BEFORE THE FILE IS WRITTEN ─────────────────────────
  // FIX-11 Part 3 item 3. The August file had four gifts worth $57,500 with no
  // payment method and one worth $25,000 with no fund, and nothing said so:
  // the file was correct and quietly incomplete, which is the worst of the two
  // ways a file can be wrong. Each count carries the gift ids behind it so the
  // screen can open the rows rather than making somebody go looking.
  const feeCents = out.reduce((s, r) => s + r.feeCents, 0);
  const noMethod = out.filter(r => !String(r.paymentMethod || "").trim()
    || /^(needs you|unknown)$/i.test(String(r.paymentMethod).trim()));
  const noFund = out.filter(r => !String(r.fund || "").trim());
  const chequesNoNumber = out.filter(r => /check|cheque/i.test(String(r.paymentMethod || ""))
    && !String(r.checkNumber || "").trim());
  // NUMBERS-3: the one meaning of deposited and the one list of banked money
  // (shared/numbers/deposited.js), the same set Finance and month close read.
  // A gift that does not say how it arrived is "no payment method" above.
  const noDeposit = out.filter(r => !r.onDeposit && r.cashOrNot === "Cash" && NUMBERS.deposited.isBanked({ payment_method: r.paymentMethod }));
  // POLISH-1 Part 5: the banner read "57 gifts no fund (46693.95)": the CSV's
  // bare decimal, printed at a person. `amount` stays the file's shape;
  // `display` is the money as a person reads it, through the one formatter.
  // `noun` lets a check be called a check ("11 checks with no number").
  const issue = (key, label, rows2, fix, noun = "gift") => rows2.length
    ? { key, label, noun, count: giftCountOf(rows2), cents: rows2.reduce((s, r) => s + r.cents, 0),
        amount: bkDollars(rows2.reduce((s, r) => s + r.cents, 0)),
        display: require("../../money").formatCents(rows2.reduce((s, r) => s + r.cents, 0)),
        giftIds: [...new Set(rows2.map(r => r.giftId))].slice(0, 2000), fix }
    : null;
  const issues = [
    issue("no_method", "with no payment method", noMethod, "Open each gift and say how the money arrived."),
    issue("no_fund", "with no fund", noFund, "Open each gift and designate it, or set a default unrestricted fund."),
    issue("no_check_number", "with no number", chequesNoNumber, "Add the number from the check or the deposit slip.", "check"),
    issue("no_deposit", "not matched to a deposit", noDeposit, "Record the deposit on the deposit sheet, or match the payout."),
  ].filter(Boolean);

  // REPORTS-4: the count and total open the same gifts through `gifts`.
  const bkBase = { from: p.from, to: p.to, bookkeeper: true, ...(p.fundId ? { fund: p.fundId } : {}), ...(p.campaignId ? { campaign: p.campaignId } : {}) };
  const figures = await reportFigures(orgId, { total: { key: "gifts", params: bkBase }, giftCount: { key: "gifts", params: { ...bkBase, measure: "count" } } });
  return {
    figures,
    from: p.from, to: p.to,
    columns: BOOKKEEPER_COLUMNS,
    rows: out,
    byFund,
    totalCents: rowCents,
    total: bkDollars(rowCents),
    feeCents,
    fee: bkDollars(feeCents),
    netCents: rowCents - feeCents,
    net: bkDollars(rowCents - feeCents),
    nonCashCents: out.filter(r => r.cashOrNot === "Non-cash").reduce((s, r) => s + r.cents, 0),
    giftCount,
    issues,
    // A sentence, because a count with no sentence is a number nobody acts on.
    issueSentence: issues.length
      ? issues.map(i => `${i.count} ${i.noun}${i.count === 1 ? "" : "s"} ${i.label}`
          + (i.cents ? ` (${i.display})` : "")).join(", ")
        + ". Fix them or export anyway."
      : null,
    balanced: refusals.length === 0,
    exportRefused: bookkeeperRefusalMessage(refusals),
  };
}

// ── FIX-11 Part 3 — THE DEPOSITS FILE ────────────────────────────────────
// One row per DEPOSIT LINE, which is the shape a bank statement has and the
// shape QuickBooks' and Xero's bank-deposit imports take. The gift-detail file
// above is one row per gift, and reconciling a statement from it meant adding
// gifts up by hand until they matched a line.
//
// It reads THE SAME gifts through THE SAME query, so the two files cannot
// disagree: `reportBookkeeper` is called and its rows are grouped. There is no
// second query and no second set of exclusions.
async function reportDeposits(orgId, p) {
  const detail = await reportBookkeeper(orgId, p);

  // The deposit account each kind of money lands in, from the accounting
  // mapping the Connections screen already keeps, so the file names the
  // bookkeeper's own account rather than a word Steward made up.
  let depositAccounts = {};
  try {
    const [c] = await query(
      `SELECT mapping FROM bookkeeping_connections
        WHERE org_id=? AND status <> 'disconnected' ORDER BY created_at DESC LIMIT 1`, [orgId]);
    const m = c && (typeof c.mapping === "string" ? JSON.parse(c.mapping || "{}") : c.mapping);
    depositAccounts = (m && m.depositAccounts) || {};
  } catch { depositAccounts = {}; }
  const accountFor = r => depositAccounts[String(r.paymentMethod || "").toLowerCase()]
    || depositAccounts.default || "";

  const built = DEP.depositGroups(detail.rows.map(r => ({
    cents: r.cents, feeCents: r.feeCents, type: r.type, fund: r.fund,
    paymentMethod: r.paymentMethod, date: r.date,
    depositedOn: r.depositedOn, depositRef: r.deposit,
    depositAccount: accountFor(r),
    donorName: r.donorName, description: r.notes, giftId: r.giftId,
  })));

  // THE ASSERTION, IN CENTS, BEFORE ANY FILE IS WRITTEN. The cash gifts and
  // the non-cash gifts are counted independently of the grouping and the
  // grouping is checked against them, so a gift that fell out of both lists
  // cannot be silent.
  const expectedCash = detail.rows.filter(r => r.cashOrNot === "Cash").reduce((s, r) => s + r.cents, 0);
  const expectedNonCash = detail.rows.filter(r => r.cashOrNot === "Non-cash").reduce((s, r) => s + r.cents, 0);
  const refusals = DEP.depositsRefusals(built, expectedCash, expectedNonCash);
  // A gift-detail file that will not be written must not become a deposits
  // file either: they are the same money.
  const refusedMessage = detail.exportRefused || DEP.depositsRefusalMessage(refusals);

  return {
    from: p.from, to: p.to,
    flavours: Object.entries(DEP.DEPOSIT_FLAVOURS).map(([key, f]) =>
      ({ key, label: f.label, confidence: f.confidence, note: f.note, headers: f.headers })),
    groups: built.groups.map(g => ({ ...g, gross: bkDollars(g.grossCents), feeAmount: bkDollars(g.feeCents), netAmount: bkDollars(g.netCents) })),
    nonCash: built.nonCash.map(r => ({ ...r, amount: bkDollars(r.cents) })),
    // FIX-60: a day of unmatched gifts is not a deposit
    depositCount: built.groups.filter(g => g.matched).length,
    undepositedDays: built.groups.filter(g => !g.matched).length,
    grossCents: built.grossCents, gross: bkDollars(built.grossCents),
    feeCents: built.feeCents, fee: bkDollars(built.feeCents),
    netCents: built.netCents, net: bkDollars(built.netCents),
    nonCashCents: built.nonCashCents, nonCashTotal: bkDollars(built.nonCashCents),
    unmatchedCents: built.unmatchedCents, unmatched: bkDollars(built.unmatchedCents),
    giftCount: detail.giftCount,
    issues: detail.issues,
    issueSentence: detail.issueSentence,
    sentence: DEP.depositsSentence(built),
    balanced: !refusedMessage,
    exportRefused: refusedMessage,
  };
}

function reportToCsv(key, data, opts = {}) {
  switch (key) {
    case "giving-summary": {
      const headers = ["Month", "Gifts", "Total", "Unique donors"];
      const rows = data.monthly.map(m => [m.month, m.gifts, m.total, m.donors]);
      rows.push(["TOTAL", data.giftCount, data.total, data.uniqueDonors]);
      return { headers, rows };
    }
    case "by-group":
      return {
        headers: ["Name", "Total", "Gifts", "Unique donors", "% of total"],
        rows: data.rows.map(r => [r.name, r.total, r.giftCount, r.uniqueDonors, r.pct]),
      };
    case "lybunt":
      return {
        headers: ["Name", "Email", "Assigned to", "Last gift date", "Last gift amount", `Gave ${data.yearMode === "fiscal" ? "FY" + (data.year - 1) : data.year - 1}`, "Lifetime giving"],
        rows: data.rows.map(r => [r.name, r.email, r.assignedTo, r.lastGiftDate, r.lastGiftAmount, r.priorYearTotal, r.lifetimeGiving]),
      };
    case "sybunt":   // LEDGER-1: the last year each person gave, and what they gave in it
      return {
        headers: ["Name", "Email", "Assigned to", "Last gift date", "Last gift amount", "Last year they gave (from)", "Last year they gave (to)", "Gave in their last year", "Lifetime giving"],
        rows: data.rows.map(r => [r.name, r.email, r.assignedTo, r.lastGiftDate, r.lastGiftAmount, r.lastYear ? r.lastYear.from : "", r.lastYear ? r.lastYear.to : "", r.priorYearTotal, r.lifetimeGiving]),
      };
    case "retention":
      return {
        headers: ["Year", "Prior-year donors", "Retained", "Retention %", "Prior-year dollars", "Retained dollars", "Dollar retention %", "First-year donors", "First-year retained", "First-year retention %"],
        rows: data.rows.map(r => [r.label, r.priorDonors, r.retainedDonors, r.retentionRate, r.priorDollars, r.retainedDollars, r.dollarRetentionRate, r.firstYearDonors, r.firstYearRetained, r.firstYearRetentionRate]),
      };
    case "top-donors":
      return {
        headers: ["Rank", "Name", "Total", "Gifts", "Last gift date"],
        rows: data.rows.map(r => [r.rank, r.name, r.total, r.giftCount, r.lastGiftDate]),
      };
    case "three-year":
      return {
        // FIX-60: the file says which days every column counts.
        headers: ["Donor", "Email", "Assigned to", data.labels.y2, data.labels.y1, data.labels.y0,
          data.span && data.span.sentence ? `YoY change % (${data.span.sentence})` : "YoY change %"],
        rows: data.rows.map(r => [r.name, r.email, r.assignedTo, r.y2, r.y1, r.y0, r.changePct === null ? "new" : r.changePct]),
      };
    case "annual": {
      const rows = [
        ["Total giving", data.total], ["Gifts", data.giftCount], ["Unique donors", data.uniqueDonors],
        ["Average gift", data.avgGift], ["New donors", data.newDonors], ["Returning donors", data.returningDonors],
        ["Growth vs prior year %", data.growthPct === null ? "n/a" : data.growthPct],
        ["Prior year, same days", data.priorTotal], ["Compared over", data.span ? data.span.sentence : ""],
        ["Donor retention %", data.retentionRate === null ? "n/a" : data.retentionRate],
        ["", ""], ["BY FUND", ""],
        ...data.byFund.map(f => [f.name, f.total]),
        ["", ""], ["BY CAMPAIGN", ""],
        ...data.byCampaign.map(c => [c.name, c.total]),
      ];
      return { headers: ["Metric", "Value"], rows };
    }
    // BUILD-103 Part 6 — peer-to-peer, through the ONE CSV layer like every
    // other report. No email column: a fundraiser's address is the org's to
    // hold, and a CSV is a file that gets forwarded.
    case "p2p-fundraisers": {
      const headers = ["Campaign", "Team", "Fundraiser", "Status", "Goal", "Raised", "Gifts"];
      const rows = data.rows.map(r => [r.campaign, r.team, r.name, r.status, r.goal ?? "", r.raised, r.gifts]);
      rows.push(["TOTAL", "", `${data.totals.fundraisers} fundraisers`, "", "", data.totals.raised, ""]);
      return { headers, rows };
    }
    case "p2p-teams": {
      const headers = ["Campaign", "Team", "Status", "Fundraisers", "Goal", "Raised"];
      const rows = data.rows.map(r => [r.campaign, r.name, r.status, r.members, r.goal ?? "", r.raised]);
      rows.push(["TOTAL", `${data.totals.teams} teams`, "", "", "", data.totals.raised]);
      return { headers, rows };
    }
    // BUILD-100 (grants) Part 5 — the two computed grant reports export through
    // the ONE `sendReportCsv` like every other, so the injection guard and the
    // BOM come for free rather than being re-remembered.
    case "grant-deadlines": {
      const headers = ["Funder", "Programme", "Deadline", "Due", "Officer", "State", "Days overdue", "Note"];
      const rows = data.rows.map(r => [r.funder, r.program, r.deadline, r.dueDate, r.officer,
                                       r.state, r.overdueDays || "", r.note]);
      return { headers, rows };
    }
    case "grant-restricted": {
      const headers = ["Funder", "Programme", "Fund", "Restriction", "Awarded", "Received",
                       "Spent", "Still owed", "Remaining to spend", "Restricted until"];
      const rows = data.rows.map(r => [r.funder, r.program, r.fund, r.restriction,
                                       r.awarded, r.received, r.spent, r.outstanding,
                                       r.remaining, r.releaseDate || ""]);
      // The TOTAL row is the org position, blank-separated so a spreadsheet
      // never reads it as another grant.
      rows.push(new Array(headers.length).fill(""));
      const t = new Array(headers.length).fill("");
      t[0] = "TOTAL"; t[4] = data.totals.awarded; t[5] = data.totals.received;
      t[6] = data.totals.spent; t[7] = data.totals.outstanding; t[8] = data.totals.remaining;
      rows.push(t);
      return { headers, rows };
    }
    case "bookkeeper": {
      // FIX-11 Part 3 — NO TOTALS ROWS IN THE CSV BODY.
      //
      // This used to append a blank row, a TOTAL row, another blank, a
      // "TOTALS BY FUND" heading, a line per fund and a second TOTAL — inside
      // the same file, under the gift columns. It reads beautifully in a
      // spreadsheet and it is the reason a QuickBooks import of the August
      // file would have booked six phantom transactions, one of them for
      // $240,853: an importer reads rows, not layout.
      //
      // The totals have not been lost. They are on the payload the screen
      // shows above the button, and in the XLSX they are a SECOND SHEET. In
      // the CSV there is one header row and then gifts, to the last line.
      const flavour = BK.giftFlavour(opts && opts.flavour);
      if (flavour && flavour.columns) {
        return {
          headers: flavour.columns.map(c => c[0]),
          rows: data.rows.map(r => flavour.columns.map(([, get]) => get(r))),
        };
      }
      const headers = data.columns.map(c => c.label);
      return { headers, rows: data.rows.map(r => data.columns.map(c => r[c.key])) };
    }
    case "deposits": {
      // One row per deposit line, in the column order the chosen tool wants.
      // No totals rows, for the same reason: this file is imported, not read.
      const f = DEP.DEPOSIT_FLAVOURS[String((opts && opts.flavour) || "steward").toLowerCase()]
        || DEP.DEPOSIT_FLAVOURS.steward;
      return { headers: f.headers, rows: f.rows({ groups: data.groups }) };
    }
    case "non-cash": {
      // The non-cash gifts, as their own file. Never a section inside the
      // deposits file: that file is imported as bank transactions, and a stock
      // gift never reached a bank.
      return { headers: DEP.NON_CASH_HEADERS, rows: DEP.nonCashRows({ nonCash: data.nonCash }) };
    }
    case "members-directory":
      return { headers: ["Name", "Email", "Phone", "Level", "Status", "Member since", "Expires"],
               rows: data.rows.map(r => [r.name, r.email, r.phone, r.level, r.status, r.joined_on, r.expires_on || "Lifetime"]) };
    case "members-by-level": {
      const rows = data.rows.map(r => [r.name, r.price, r.current, r.lapsed, c2d(r.revenueCents)]);
      rows.push(["TOTAL", "", data.totals.current, data.totals.lapsed, c2d(data.totals.revenueCents)]);
      return { headers: ["Level", "Price", "Current members", "Lapsed members", "Membership revenue this year"], rows };
    }
    case "members-expiring":
      return { headers: ["Name", "Email", "Level", "Status", "Expires"], rows: data.rows.map(r => [r.name, r.email, r.level, r.status, r.expires_on]) };
    case "members-lapsed":
      return { headers: ["Name", "Email", "Last level", "Lapsed", "Years as a member"], rows: data.rows.map(r => [r.name, r.email, r.level, r.lapsed_on, r.years]) };
    case "members-new-renewed": {
      const rows = data.rows.map(r => [r.month, r.new_members, r.renewed]);
      rows.push(["TOTAL", data.totals.newMembers, data.totals.renewed]);
      return { headers: ["Month", "New members", "Renewed"], rows };
    }
    case "membership-revenue": {
      const rows = data.rows.map(r => [r.month, c2d(r.membershipCents), c2d(r.donationCents)]);
      rows.push(["TOTAL", c2d(data.totals.membershipCents), c2d(data.totals.donationCents)]);
      return { headers: ["Month", "Membership revenue", "Donation revenue"], rows };
    }
    case "solicitations": {
      const rows = [
        ["FORECAST: open asks", data.forecast.open], ["FORECAST: stage-weighted", data.forecast.weighted],
        ["", ""], ["OPEN ASKS BY STAGE", ""],
        ...data.byStage.map(s => [s.stage, `${s.count} asks · ${s.ask}`]),
        ["", ""], ["BY OFFICER (open / made / closed)", ""],
        ...data.byOfficer.map(o => [o.name, `open ${o.openAsks} ($${o.openAskAmount}) · made ${o.asksMade} · closed ${o.giftsClosed} ($${o.giftsClosedAmount})`]),
      ];
      return { headers: ["", ""], rows };
    }
  }
}

// ── BUILD-100 (grants) Part 5 — the two computed grant reports ─────────────
// Both read the functions Parts 2 and 4 already own. A report that recomputed
// a restricted balance its own way would eventually disagree with the screen,
// and the screen is what an officer trusts.
async function reportGrantDeadlines(orgId, p = {}) {
  const M = await grantMsMod();
  const org = await orgTz(orgId);
  const today = orgToday(org);                                       // ORG_TZ_SEAM_OK
  const days = Number.isFinite(Number(p.days)) ? Math.max(1, Math.min(730, Number(p.days))) : 90;
  const leadDays = await orgLeadDays(orgId);
  const rows = await query(
    `SELECT m.*, g.program, g.status, g.funder, g.officer_id, d.name AS funder_name, u.name AS officer_name
       FROM grant_milestones m
       JOIN grants g ON g.id = m.grant_id AND g.org_id = m.org_id
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
       LEFT JOIN users u ON u.id = g.officer_id AND u.org_id = g.org_id
      WHERE m.org_id = ? AND g.is_sample IS NOT TRUE
        AND m.state NOT IN ('done','skipped')
      ORDER BY m.due_date ASC`, [orgId]);
  const all = rows.map(r => ({ ...milestoneRow(r, M, today, leadDays), officerName: r.officer_name || "(nobody)" }));
  // OVERDUE COUNTS. A deadline three days past is more owed than one three days
  // out, and a window that excluded it would answer the wrong question.
  const within = all.filter(m => {
    const d = M.daysBetween(today, m.dueDate);
    return d !== null && d <= days;
  });
  return {
    today, windowDays: days,
    rows: within.map(m => ({
      funder: m.funderName || "(not named)", program: m.program || "(not stated)",
      deadline: m.kindLabel, dueDate: m.dueDate, officer: m.officerName,
      state: m.state, overdueDays: m.overdueDays, note: m.sentence,
    })),
    total: within.length,
    overdue: within.filter(m => m.band === "overdue").length,
    waiting: within.filter(m => m.state === "waiting").length,
  };
}

async function reportGrantRestricted(orgId) {
  const R = await restrictedMod();
  const org = await orgTz(orgId);
  const today = orgToday(org);                                       // ORG_TZ_SEAM_OK
  const rows = await grantMoneyRows(orgId, "AND g.status IN ('awarded','reporting','closed')");
  const balances = rows.map(r => grantBalanceFrom(R, r, today));
  const restricted = balances.filter(b => b.restricted);
  const totals = R.restrictedTotals(balances);
  return {
    today,
    rows: restricted
      .sort((a, b) => b.remainingCents - a.remainingCents)
      .map(b => ({
        funder: b.funderName || "(not named)", program: b.program || "(not stated)",
        fund: b.fundName || "Unrestricted (no fund)", restriction: b.restriction,
        awarded: b.awarded, received: b.received, spent: b.spent,
        outstanding: b.outstanding, remaining: b.remaining,
        releaseDate: b.releaseDate, overspent: b.overspent, note: b.sentence,
      })),
    totals: {
      grants: totals.grants,
      awarded: toDollars(totals.awardedCents), received: toDollars(totals.receivedCents),
      spent: toDollars(totals.spentCents), outstanding: toDollars(totals.outstandingCents),
      remaining: toDollars(totals.remainingCents), overspentGrants: totals.overspentGrants,
    },
    // Summed in cents and exposed so a reader can reconcile the total against
    // the rows without trusting the dollars.
    totalsCents: {
      awarded: totals.awardedCents, received: totals.receivedCents, spent: totals.spentCents,
      outstanding: totals.outstandingCents, remaining: totals.remainingCents,
    },
    definitions: Object.fromEntries(R.RESTRICTED_METRICS.map(m => [m.key, m.definition])),
    spendSourceNote: R.SPEND_SOURCE_NOTE,
  };
}
// ── BUILD-101 Part 5 — MEMBERSHIP REPORTS ─────────────────────────────────
// Read paths like every other report, on the one CSV layer. Money is summed
// in the database in integer CENTS; membership money and donation money are
// two columns and never one "revenue" total. A membership payment is a gift
// some membership points at (memberships.gift_id); everything else is a
// donation.
const MB_GIFT_SQL = `EXISTS (SELECT 1 FROM memberships x WHERE x.org_id=g.org_id AND x.gift_id=g.id)`;
async function mbReportToday(orgId) { return orgToday(await orgTz(orgId)); }   // ORG_TZ_SEAM_OK

async function reportMembersDirectory(orgId) {
  const rows = await query(
    `SELECT d.name, d.email, d.phone, l.name AS level, m.status, m.joined_on, m.expires_on
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND d.deleted_at IS NULL
      WHERE m.org_id=? AND m.status IN ('active','grace') ORDER BY d.name`, [orgId]);
  return { rows, sentence: "Everyone who holds a membership now, active or in grace." };
}
async function reportMembersByLevel(orgId) {
  const yo = await orgForYears(orgId);
  const fy = reportYearBounds(reportCurrentYear("fiscal", yo), "fiscal", orgTime.orgFiscalStartMonth(yo));   // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT l.id, l.name, l.price,
            (SELECT COUNT(*)::int FROM memberships m WHERE m.org_id=l.org_id AND m.level_id=l.id AND m.status IN ('active','grace')) AS current,
            (SELECT COUNT(*)::int FROM memberships m WHERE m.org_id=l.org_id AND m.level_id=l.id AND m.status='lapsed' AND ${LAPSED_MEMBER_SQL}) AS lapsed,
            (SELECT ${NUMBERS.givingBetween.SPAN_CENTS("g")} FROM gifts g JOIN memberships m ON m.gift_id=g.id AND m.org_id=g.org_id
               JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
              WHERE g.org_id=l.org_id AND m.level_id=l.id) AS revenue_cents
       FROM membership_levels l WHERE l.org_id=? ORDER BY l.position, l.price`, [fy.from, fy.to, orgId]);
  return { from: fy.from, to: fy.to,
    rows: rows.map(r => ({ name: r.name, price: Number(r.price), current: r.current, lapsed: r.lapsed, revenueCents: Number(r.revenue_cents) })),
    totals: { current: rows.reduce((a, r) => a + r.current, 0), lapsed: rows.reduce((a, r) => a + r.lapsed, 0),
              revenueCents: rows.reduce((a, r) => a + Number(r.revenue_cents), 0) },
    sentence: "Current counts active and in-grace members; lapsed counts people, once. Revenue is membership payments this fiscal year." };
}
async function reportMembersExpiring(orgId) {
  const today = await mbReportToday(orgId);
  const rows = await query(
    `SELECT d.name, d.email, l.name AS level, m.status, m.expires_on, d.id AS donor_id
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND d.deleted_at IS NULL
      WHERE m.org_id=? AND m.status IN ('active','grace') AND m.expires_on BETWEEN ? AND ?
      ORDER BY m.expires_on, d.name`, [orgId, today, orgTime.addDays(today, 60)]);
  return { from: today, to: orgTime.addDays(today, 60), rows, sentence: "Memberships held now that expire in the next 60 days." };
}
async function reportMembersLapsed(orgId) {
  const rows = await query(
    `SELECT d.name, d.email, l.name AS level, COALESCE(m.status_changed_on, m.expires_on) AS lapsed_on, d.id AS donor_id,
            (SELECT COUNT(*)::int FROM memberships t WHERE t.org_id=m.org_id AND t.donor_id=m.donor_id AND t.status IN ('active','grace','lapsed','renewed')) AS years
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND d.deleted_at IS NULL
      WHERE m.org_id=? AND m.status='lapsed' AND ${LAPSED_MEMBER_SQL}
      ORDER BY lapsed_on DESC, d.name`, [orgId]);
  return { rows, sentence: "People whose most recent membership lapsed and who hold none now." };
}
// New vs renewed, by month, the last twelve months. A membership's month is
// the date of the payment that bought it; one given without a payment
// (complimentary, imported) counts in the month it starts.
async function reportMembersNewRenewed(orgId) {
  const today = await mbReportToday(orgId);
  // The first day of the month eleven months back: twelve calendar months.
  const [ty, tm] = today.split("-").map(Number);
  const back = ty * 12 + (tm - 1) - 11;
  const start = `${Math.floor(back / 12)}-${String(back % 12 + 1).padStart(2, "0")}-01`;
  const rows = await query(
    `SELECT LEFT(COALESCE(g.date, m.starts_on), 7) AS month,
            COUNT(*) FILTER (WHERE m.renewed_from IS NULL)::int AS new_members,
            COUNT(*) FILTER (WHERE m.renewed_from IS NOT NULL)::int AS renewed
       FROM memberships m LEFT JOIN gifts g ON g.id=m.gift_id AND g.org_id=m.org_id
      WHERE m.org_id=? AND COALESCE(g.date, m.starts_on) BETWEEN ? AND ?
      GROUP BY 1 ORDER BY 1`, [orgId, start, today]);
  return { from: start, to: today, rows,
    totals: { newMembers: rows.reduce((a, r) => a + r.new_members, 0), renewed: rows.reduce((a, r) => a + r.renewed, 0) },
    sentence: "A membership counts in the month of the payment that bought it; one given without a payment counts in the month it starts." };
}
// Membership revenue BESIDE donation revenue: two columns, this fiscal year
// by month, and never summed into one figure.
async function reportMembershipRevenue(orgId) {
  const yo = await orgForYears(orgId);
  const fy = reportYearBounds(reportCurrentYear("fiscal", yo), "fiscal", orgTime.orgFiscalStartMonth(yo));   // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT LEFT(g.date, 7) AS month,
            ${NUMBERS.money.MONEY_CENTS("g", MB_GIFT_SQL)} AS membership_cents,
            ${NUMBERS.money.MONEY_CENTS("g", `NOT ${MB_GIFT_SQL}`)} AS donation_cents
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
      WHERE g.org_id=? AND ${NUMBERS.givingBetween.IN_SPAN("g")} GROUP BY 1 ORDER BY 1`, [orgId, fy.from, fy.to]);
  const out = rows.map(r => ({ month: r.month, membershipCents: Number(r.membership_cents), donationCents: Number(r.donation_cents) }));
  return { from: fy.from, to: fy.to, rows: out,
    totals: { membershipCents: out.reduce((a, r) => a + r.membershipCents, 0), donationCents: out.reduce((a, r) => a + r.donationCents, 0) },
    sentence: "Membership payments and donations this fiscal year, side by side. They are two lines and are never added into one revenue figure." };
}
const c2d = c => (Number(c) / 100).toFixed(2);

// ── BUILD-103 Part 6 — THE TWO PEER-TO-PEER REPORTS ─────────────────────
// Fundraisers by campaign, and teams by campaign. Both sum the SAME gift rows
// the P2P screen and the public page sum, so a saved report and the screen
// cannot show different figures.
async function reportP2PFundraisers(orgId) {
  const rows = await query(
    `SELECT gp.title AS campaign, t.name AS team, pf.name, pf.status,
            pf.personal_goal_amount AS goal,
            COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.peer_fundraiser_id=pf.id AND g.amount > 0),0)::float AS raised,
            COALESCE((SELECT COUNT(*) FROM gifts g WHERE g.peer_fundraiser_id=pf.id AND g.amount > 0),0)::int AS gifts
       FROM peer_fundraisers pf
       JOIN giving_pages gp ON gp.id=pf.giving_page_id
       LEFT JOIN p2p_teams t ON t.id=pf.team_id
      WHERE pf.org_id=? ORDER BY gp.title, raised DESC, pf.name`, [orgId]);
  return {
    rows: rows.map(r => ({ campaign: r.campaign, team: r.team || "", name: r.name, status: r.status,
      goal: r.goal == null ? null : Number(r.goal), raised: Number(r.raised), gifts: r.gifts })),
    totals: { raised: rows.reduce((a, r) => a + Number(r.raised), 0), fundraisers: rows.length,
              notYet: rows.filter(r => Number(r.raised) === 0).length },
    sentence: "Every fundraiser on every peer-to-peer campaign, and what came in through their own page. Raised is a live sum over the gifts, in cents. A fundraiser at zero has not received a gift yet; nobody is emailed from a report.",
  };
}
async function reportP2PTeams(orgId) {
  const rows = await query(
    `SELECT gp.title AS campaign, t.name, t.status, t.goal_amount AS goal,
            (SELECT COUNT(*)::int FROM peer_fundraisers pf WHERE pf.team_id=t.id AND pf.status='active') AS members,
            COALESCE((SELECT SUM(g.amount) FROM gifts g JOIN peer_fundraisers pf ON pf.id=g.peer_fundraiser_id
                       WHERE pf.team_id=t.id AND g.amount > 0),0)::float AS raised
       FROM p2p_teams t JOIN giving_pages gp ON gp.id=t.giving_page_id
      WHERE t.org_id=? ORDER BY gp.title, raised DESC, t.name`, [orgId]);
  return {
    rows: rows.map(r => ({ campaign: r.campaign, name: r.name, status: r.status, members: r.members,
      goal: r.goal == null ? null : Number(r.goal), raised: Number(r.raised) })),
    totals: { raised: rows.reduce((a, r) => a + Number(r.raised), 0), teams: rows.length },
    sentence: "Every team on every peer-to-peer campaign. A team's raised is summed from the gifts its fundraisers brought in, never a stored counter, so it always agrees with the campaign's own total.",
  };
}

const REPORT_HANDLERS = {
  "giving-summary": reportGivingSummary,
  // FIX-11 Part 3 — one row per deposit line, from the same gifts the
  // bookkeeper file reads. `non-cash` is the same computation read from the
  // other end: the gifts that are revenue and never reached a bank.
  "deposits": reportDeposits,
  "non-cash": reportDeposits,
  "by-group": reportByGroup,
  "lybunt": (orgId, p) => reportBuntList(orgId, p, "lybunt"),
  "sybunt": (orgId, p) => reportBuntList(orgId, p, "sybunt"),
  "retention": reportRetention,
  "top-donors": reportTopDonors,
  "three-year": reportThreeYear,
  "annual": reportAnnual,
  "solicitations": reportSolicitations,
  // BUILD-87 Part 4 — the bookkeeper's export. A read path like every other
  // report, on the BUILD-79 file layer; there is no second export path.
  "bookkeeper": reportBookkeeper,
  // BUILD-100 (grants) Part 5 — the two grant reports that are COMPUTED rather
  // than queried. They call the SAME functions the screens do, so a saved
  // report and the screen can never show different figures (BUILD-98 Part 3's
  // rule). Expressing either as a second query would be a second computation.
  "grant-deadlines": reportGrantDeadlines,
  "grant-restricted": reportGrantRestricted,
  // BUILD-101 Part 5 — memberships.
  "members-directory": reportMembersDirectory,
  "members-by-level": reportMembersByLevel,
  "members-expiring": reportMembersExpiring,
  "members-lapsed": reportMembersLapsed,
  "members-new-renewed": reportMembersNewRenewed,
  "membership-revenue": reportMembershipRevenue,
  // BUILD-103 Part 6 — peer-to-peer.
  "p2p-fundraisers": reportP2PFundraisers,
  "p2p-teams": reportP2PTeams,
};

// Gifts by month, this year beside last year, from the giving-summary handler
// itself — the Reports tab's monthly figures, twice, aligned by fiscal month.
async function reportByMonthVsLastYear(orgId, p) {
  const prev = { ...p, year: p.year - 1, ...reportYearBounds(p.year - 1, p.yearMode, p.fiscalStartMonth) };
  const [cur, last] = await Promise.all([reportGivingSummary(orgId, p), reportGivingSummary(orgId, prev)]);
  const idx = (ym, start) => (Number(ym.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(ym.slice(5, 7)) - Number(start.slice(5, 7));
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const c = cur.monthly.find(m => idx(m.month, p.from) === i);
    const l = last.monthly.find(m => idx(m.month, prev.from) === i);
    const ym = orgTime.addDays(p.from, i * 31).slice(0, 7);
    rows.push({ month: ym, thisYear: c ? c.total : 0, lastYear: l ? l.total : 0 });
  }
  return { from: p.from, to: p.to, rows, total: cur.total, lastTotal: last.total };
}

// Per handler, column by column, in reportToCsv's order: money (summed in the
// foot), price (money, not summed), count (summed), number, pct, date, month.
const STD_DISPLAY = {
  "lybunt": [null, null, null, "date", "money", "money", "money"],
  "sybunt": [null, null, null, "date", "money", "money", "money"],
  "retention": [null, "number", "number", "pct", "money", "money", "pct", "number", "number", "pct"],
  "top-donors": ["number", null, "money", "count", "date"],
  "grant-deadlines": [null, null, null, "date", null, null, "number", null],
  "grant-restricted": [null, null, null, null, "money", "money", "money", "money", "money", "date"],
  "members-by-level": [null, "price", "count", "count", "money"],
  "members-expiring": [null, null, null, null, "date"],
  "members-lapsed": [null, null, null, "date", "number"],
  "members-new-renewed": ["month", "count", "count"],
  "membership-revenue": ["month", "money", "money"],
};
// The row's person, where a row is one.
const STD_PERSON = {
  "lybunt": r => r.id, "sybunt": r => r.id, "top-donors": r => r.id,
  "members-expiring": r => r.donor_id, "members-lapsed": r => r.donor_id,
};

async function runStandardReport(orgId, std) {
  if (std.kind === "builder") return runBuilderDef(orgId, std.def);
  if (std.handler === "lost") return require("./lostReport").lostReport(orgId);   // COUNTS-1: lapse.js lostSql, Re-engage's Lost & Found
  const p = parseReportParams({ ...std.params }, await orgForYears(orgId));   // ORG_TZ_SEAM_OK
  if (std.handler === "by-month-vs-last-year") {
    const d = await reportByMonthVsLastYear(orgId, p);
    return { columns: [{ key: "month", label: "Month", type: "text", display: "month" }, { key: "thisYear", label: "This year", type: "money" }, { key: "lastYear", label: "Last year", type: "money" }],
             rows: d.rows, totals: { count: d.rows.length, sums: [{ key: "thisYear", label: "This year", cents: rbCents(d.total) }, { key: "lastYear", label: "Last year", cents: rbCents(d.lastTotal) }] } };
  }
  const data = await REPORT_HANDLERS[std.handler](orgId, p);
  // The SAME shaping the Reports tab's CSV uses — one table, one definition.
  const { headers, rows } = reportToCsv(std.handler, data);
  // FIX-2 B — how each cell READS on screen (`display`) and whose row it is
  // (`_pid`). `type` stays "text": the PDF formats by `type` and the CSV by
  // value, so neither file changes by a byte.
  const hints = STD_DISPLAY[std.handler] || [];
  const pidOf = STD_PERSON[std.handler];
  const dataRows = Array.isArray(data?.rows) ? data.rows : [];
  return { columns: headers.map((h, i) => ({ key: "c" + i, label: h, type: "text", ...(hints[i] ? { display: hints[i] } : {}) })),
           rows: rows.map((r, j) => {
             const o = Object.fromEntries(r.map((v, i) => ["c" + i, v]));
             const pid = pidOf && j < dataRows.length ? pidOf(dataRows[j]) : null;
             if (pid) o._pid = pid;
             return o;
           }),
           totals: { count: rows.length, sums: [] }, raw: data };
}

async function savedReportFor(orgId, userId, id) {
  await RB_READY;
  const std = RB.STANDARD_REPORTS.find(r => "std:" + r.key === id);
  if (std) return { id, name: std.name, question: std.question, standard: true, kind: std.kind, def: std.def || null, std };
  const [r] = await query("SELECT * FROM saved_reports WHERE id=? AND org_id=? AND (shared = true OR owner_id = ?)", [id, orgId, userId]);
  if (!r) return null;
  return { id: r.id, name: r.name, question: r.question, standard: false, kind: "builder", def: asJson(r.definition, {}), row: r };
}

async function runSaved(orgId, rep) {
  return rep.standard ? runStandardReport(orgId, rep.std) : runBuilderDef(orgId, rep.def);
}
return { REPORT_HANDLERS, buntPredicate, dashboardsMod, parseReportParams, reportToCsv, runSaved, samePointLastYearSource, savedReportFor };
}

module.exports = { mount };
