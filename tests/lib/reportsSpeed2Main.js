// tests/lib/reportsSpeed2Main.js · REPORTS-SPEED-2. MAIN'S YEAR-OVER-YEAR AND
// ANNUAL, FROZEN, so tests/reports-speed2.test.js can hold today's answers to
// them number for number. Copied verbatim from origin/main at 2427f37
// (shared/numbers/byYear.js orgByYear and donorKindsSql; server/reports/handlers.js
// reportAnnual, reportFigures, yearSpans, reportYearLabel; helpers-4 reportYearBounds). Only the requires
// are this file's: everything they call (shared/numbers, figureSources, orgTime,
// the fiscal-year helpers) is the live code, so the frozen part is exactly the
// code this build rewrote. Do not edit the copied functions.
"use strict";
const path = require("path");
const R = p => require(path.join(__dirname, "../..", p));
const orgTime = R("orgTime");
const FY = R("shared/numbers/fiscalYear");
const NUMBERS = R("shared/numbers");
const { MONEY, GIFT, LIVE } = R("shared/numbers/money");
const { FIRST_ON_FILE_AGG, EARLIER, IMPORTED_FIRST } = R("shared/numbers/firstGift");
const { COUNTED } = R("shared/numbers/giftCount");
const { NOT_CREDIT } = R("creditTypes");
const SCHED_DUE = R("shared/numbers/scheduled").DUE;
const figureSources = R("figureSources");
const { yearsSpan, samePoint, changeWords } = R("shared/numbers/byYear");
// server/boot/helpers-4.js reportYearBounds, verbatim (it is shared through the boot, not exported).
function reportYearBounds(year, yearMode, startMonth = 7) {
  if (yearMode !== "fiscal") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const m = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 7;
  const mm = String(m).padStart(2, "0");
  return { from: `${year - 1}-${mm}-01`, to: orgTime.addDays(`${year}-${mm}-01`, -1) };
}
const orgToday = org => orgTime.orgToday(org);
// Annual's figures never ask for the org-wide retention or drift; a call here would be a change of source.
const computeRetentionRate = () => { throw new Error("reportsSpeed2Main: Annual asked computeRetentionRate"); };
const computeDriftForDonors = () => { throw new Error("reportsSpeed2Main: Annual asked computeDriftForDonors"); };
// shared/numbers/byYear.js's own constants, verbatim.
const ORG_YEARS = 10;
const toCents = v => Math.round(Number(v || 0) * 100);
const dollars = c => c / 100;
let FP = null;
const FP_READY = import(path.join(__dirname, "../../shared/fiscalPeriod.js")).then(m => { FP = m; return m; });

function main(query) {
  function donorKindsSql(orgId, spans) {
    const args = [spans.map(s => s.k), spans.map(s => s.f), spans.map(s => s.t), spans.map(s => s.pf), spans.map(s => s.pt), orgId,
      orgId, spans.map(s => s.k), spans.map(s => s.pf), spans.map(s => s.pt), orgId];
    const sql = `
      SELECT p.k, d.id, 'person' AS type, d.id AS donor_id, d.name, p.date, p.amount,
             CASE WHEN ${EARLIER("fa.first", IMPORTED_FIRST("d"))} >= p.f THEN 'new'
                  WHEN pv.donor_id IS NOT NULL THEN 'retained'
                  ELSE 'reactivated' END AS kind
        FROM (SELECT y.k, y.f, y.pf, y.pt, g.donor_id, g.org_id, MAX(g.date) AS date, ROUND(SUM(g.amount)::numeric, 2) AS amount
                FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[]) AS y(k, f, t, pf, pt)
                JOIN gifts g ON g.org_id = ? AND g.date >= y.f AND g.date <= y.t AND ${MONEY("g")}
               GROUP BY y.k, y.f, y.pf, y.pt, g.donor_id, g.org_id
              HAVING COUNT(*) FILTER (WHERE g.amount > 0) > 0) p
        JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL AND d.erased_at IS NULL
        LEFT JOIN (SELECT fg.donor_id, ${FIRST_ON_FILE_AGG("fg")} AS first FROM gifts fg WHERE fg.org_id = ? GROUP BY fg.donor_id) fa
               ON fa.donor_id = d.id
        LEFT JOIN (SELECT DISTINCT y.k, y.pf, y.pt, pg.donor_id
                     FROM unnest(?::text[], ?::text[], ?::text[]) AS y(k, pf, pt)
                     JOIN gifts pg ON pg.org_id = ? AND ${GIFT("pg")} AND pg.date >= y.pf AND pg.date <= y.pt) pv
               ON pv.k = p.k AND pv.pf = p.pf AND pv.pt = p.pt AND pv.donor_id = d.id`;
    return { sql, args };
  }

  async function orgByYear(query, org, today) {
    const orgId = org.id;
    const [e] = await query(
      `SELECT MIN(g.date) AS first FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")} AND g.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`, [orgId]);
    const years = yearsSpan(org, today, e && e.first ? String(e.first).slice(0, 10) : null, ORG_YEARS);
    const sp = samePoint(years[0], today);
    const spans = years.map(y => ({ k: y.key, f: y.from, t: y.to, pf: y.prevFrom, pt: y.prevTo }));
    // The `gifts` source over each year, all years in one read.
    const totals = await query(
      `SELECT y.k, COALESCE(SUM(g.amount), 0)::text AS s, COUNT(g.id) FILTER (WHERE ${COUNTED("g")})::int AS n, MAX(g.amount) FILTER (WHERE g.amount > 0)::text AS mx
         FROM unnest(?::text[], ?::text[], ?::text[]) AS y(k, f, t)
         JOIN gifts g ON g.org_id = ? AND g.date >= y.f AND g.date <= y.t AND ${MONEY("g")}
         JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
        GROUP BY y.k`, [spans.map(s => s.k), spans.map(s => s.f), spans.map(s => s.t), orgId]);
    const k = donorKindsSql(orgId, spans);
    const kinds = await query(`SELECT x.k, x.kind, COUNT(*)::int AS n FROM (${k.sql}) x GROUP BY 1, 2`, k.args);
    // The year before the oldest shown, so its retention rate has a denominator.
    const oldest = years[years.length - 1];
    const kp = donorKindsSql(orgId, [{ k: "prior", f: oldest.prevFrom, t: oldest.prevTo, pf: oldest.prevFrom, pt: oldest.prevTo }]);
    const [priorN] = await query(`SELECT COUNT(*)::int AS n FROM (${kp.sql}) x`, kp.args);

    const byKey = new Map(totals.map(t => [t.k, t]));
    const count = (key, kind) => kinds.filter(r => r.k === key && (!kind || r.kind === kind)).reduce((s, r) => s + r.n, 0);
    const rows = years.map(y => {
      const t = byKey.get(y.key) || { s: "0", n: 0, mx: null };
      const G = extra => ({ key: "gifts", params: { from: y.from, to: y.to, ...extra } });
      const P = kind => ({ key: "yoy-donors", params: { from: y.from, to: y.to, pfrom: y.prevFrom, pto: y.prevTo, kind } });
      const donors = count(y.key), retained = count(y.key, "retained");
      return {
        key: y.key, label: y.label, chartLabel: y.chartLabel, from: y.from, to: y.to, current: y.current,
        total: dollars(toCents(t.s)), cents: toCents(t.s), giftCount: t.n, largest: dollars(toCents(t.mx)), largestCents: toCents(t.mx),
        donors, newDonors: count(y.key, "new"), retained, reactivated: count(y.key, "reactivated"),
        sources: { total: G({}), giftCount: G({ measure: "count" }), largest: { key: "year-largest", params: { from: y.from, to: y.to } },
          donors: P("all"), newDonors: P("new"), retained: P("retained"), reactivated: P("reactivated"),
          retentionRate: { key: "yoy-retention", params: { from: y.from, to: y.to, pfrom: y.prevFrom, pto: y.prevTo } } },
      };
    });
    rows.forEach((r, i) => {
      const priorDonors = i + 1 < rows.length ? rows[i + 1].donors : priorN.n;
      r.priorDonors = priorDonors;
      r.retentionRate = priorDonors ? r.retained / priorDonors : null;
    });
    // The same point last year: the same three sources over the earlier window.
    let samePointRow = null;
    if (sp) {
      const [s] = await query(
        `SELECT COALESCE(SUM(g.amount), 0)::text AS s, COUNT(g.id) FILTER (WHERE ${COUNTED("g")})::int AS n
           FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
          WHERE g.org_id = ? AND g.date >= ? AND g.date <= ? AND ${MONEY("g")}`, [orgId, sp.from, sp.to]);
      const ks = donorKindsSql(orgId, [{ k: "sp", f: sp.from, t: sp.to, pf: years[1] ? years[1].prevFrom : sp.from, pt: years[1] ? years[1].prevTo : sp.to }]);
      const [n] = await query(`SELECT COUNT(*)::int AS n FROM (${ks.sql}) x`, ks.args);
      samePointRow = { from: sp.from, to: sp.to, total: dollars(toCents(s.s)), cents: toCents(s.s), giftCount: s.n, donors: n.n,
        sources: { total: { key: "gifts", params: { from: sp.from, to: sp.to } }, giftCount: { key: "gifts", params: { from: sp.from, to: sp.to, measure: "count" } },
          donors: { key: "givers", params: { from: sp.from, to: sp.to } } } };
    }
    rows.forEach((r, i) => {
      const prev = rows[i + 1];
      r.change = r.current && samePointRow
        ? changeWords(r.cents, samePointRow.cents, { first: !prev && !samePointRow.cents, partial: true, basis: "on the same point last year" })
        : changeWords(r.cents, prev ? prev.cents : 0, { first: !prev, partial: r.current });
    });
    return {
      years: rows, samePoint: samePointRow, today, fiscalStartMonth: FY.startMonth(org),
      sentence: "Each fiscal year's giving, the Giving summary's figures for that year: every gift dated in it, refunds taken off, soft and matching credits left out. Donors are the people with a gift in the year; each is new (their first gift ever is in it), retained (they gave the year before too) or reactivated (they gave before, but not the year before). Retention is retained over the year before's donors. The year still running is so far, and sits beside the same point last year.",
    };
  }

  async function reportFigures(orgId, specs) {
    const keys = Object.keys(specs).filter(k => specs[k]);
    const deps = { computeRetentionRate, computeDriftForDonors };
    const got = await Promise.all(keys.map(k => Promise.all([
      figureSources.figureValue(orgId, specs[k], deps), figureSources.figureSentence(specs[k])])));
    return Object.fromEntries(keys.map((k, i) => [k, { value: got[i][0].value, cents: got[i][0].cents, blank: got[i][0].blank,
      source: specs[k], definition: got[i][1] }]));
  }

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

  function reportYearLabel(y, p) {
    if (p.yearMode !== "fiscal") return String(y);
    return FP ? FP.fyLabelFromEnd(y, p.fiscalStartMonth || 7) : `FY${y}`;
  }

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
      `SELECT COUNT(*) FILTER (WHERE ${NUMBERS.giftCount.COUNTED("g")})::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
              ${NUMBERS.money.GIVERS("g", "d")}::int AS unique_donors,
              COALESCE(AVG(g.amount) FILTER (WHERE ${NUMBERS.giftCount.COUNTED("g")}),0) AS avg_gift
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}`,
      [orgId, cur.from, cur.to]);
    const [priorT] = await query(
      `SELECT COUNT(*) FILTER (WHERE ${NUMBERS.giftCount.COUNTED("g")})::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
              ${NUMBERS.money.GIVERS("g", "d")}::int AS unique_donors
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}`,
      [orgId, priorSpan.from, priorSpan.to]);
    const [split] = await query(
      `WITH period_donors AS (SELECT DISTINCT g.donor_id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                              WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}),
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
      `SELECT COALESCE(x.name,'Unrestricted (no fund)') AS name, MIN(x.id) AS key_id, COUNT(DISTINCT x.id)::int AS key_ids, COALESCE(SUM(gf.amount),0) AS total, COUNT(*) FILTER (WHERE ${NUMBERS.giftCount.COUNTED("g")})::int AS gift_count
       FROM gifts g JOIN donors d ON d.id = g.donor_id
       JOIN ${NUMBERS.fundLines.GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id   -- GIFTS-2: a split gift by its lines
       LEFT JOIN fin_funds x ON x.id = gf.fund_id AND x.org_id = g.org_id
       WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}
       GROUP BY 1 ORDER BY total DESC`, [orgId, cur.from, cur.to]);
    const byCampaign = await query(
      `SELECT COALESCE(x.name, NULLIF(g.campaign,''), 'No campaign') AS name, MIN(x.id) AS key_id, COUNT(DISTINCT x.id)::int AS key_ids, COALESCE(SUM(g.amount),0) AS total, COUNT(*) FILTER (WHERE ${NUMBERS.giftCount.COUNTED("g")})::int AS gift_count
       FROM gifts g JOIN donors d ON d.id = g.donor_id
       LEFT JOIN campaigns x ON x.id = g.campaign_id AND x.org_id = g.org_id
       WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}
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

  return { orgByYear, reportAnnual: async (orgId, p) => { await FP_READY; return reportAnnual(orgId, p); } };
}

module.exports = { main, reportYearBounds };
