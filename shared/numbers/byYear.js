// shared/numbers/byYear.js · HISTORY-1. GIVING BY FISCAL YEAR, A PERSON'S AND THE ORG'S.
//
// A development director's first question about a donor is "how has their
// giving changed year to year?". This file answers it in the org's own fiscal
// years (fiscalYear.js), newest first, out of the same rules every other
// number reads:
//   · a person's year is their Lifetime (lifetime.js) cut by fiscal year: every
//     money row (money.js: hard credit, refunds off) the imported total does
//     not already cover (AFTER_IMPORT). The imported total is one row of its
//     own, "Before Steward", never spread across years. So the years, plus
//     Before Steward, plus any undated or future-dated gift, foot to Lifetime.
//   · soft credit is its own line per year, never inside the total (FIX-49).
//   · the org's year is the Giving summary's year: the `gifts` source over the
//     year's dates, so the two never disagree; its donors are the `givers`
//     source, split three ways (new, retained, reactivated) that add up to it.
//   · the year still running is "so far", and is compared with the same point
//     last year (orgTime.samePointLastYear: the same day of the fiscal year),
//     never with a whole year.
// Every figure carries the source that opens its rows (server/reports/yoySources.js).
"use strict";
const orgTime = require("../../orgTime");
const FY = require("./fiscalYear");
const { MONEY, GIFT, LIVE } = require("./money");
const { AFTER_IMPORT, LIFETIME } = require("./lifetime");
const { FIRST_DATE, FIRST_ON_FILE_AGG, EARLIER, IMPORTED_FIRST } = require("./firstGift");
const { IS_CREDIT, NOT_CREDIT } = require("../../creditTypes");
const { COUNTED } = require("./giftCount");   // TRUTH-3: one rule for counting a gift

const PERSON_YEARS_MAX = 40;   // a longer history than this is very rare; older gifts get one row
const ORG_YEARS = 10;

const toCents = v => Math.round(Number(v || 0) * 100);
const dollars = c => c / 100;
const fmt = c => {
  const neg = c < 0, a = Math.abs(c);
  const s = (a / 100).toLocaleString("en-US", { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${s}`;
};

// The fiscal years from the one `earliest` falls in to the one `today` is in,
// newest first. The year still running ends at today ("so far").
function yearsSpan(org, today, earliest, max) {
  const sm = FY.startMonth(org);
  const cur = FY.startYearOf(today, sm);
  let first = earliest ? FY.startYearOf(earliest, sm) : cur;
  if (first == null || first > cur) first = cur;
  first = Math.max(first, cur - max + 1);
  const out = [];
  for (let y = cur; y >= first; y--) {
    const fy = FY.yearStarting(y, sm);
    const current = y === cur;
    const prev = FY.yearStarting(y - 1, sm);
    out.push({ key: fy.key, startYear: y, label: fy.label, chartLabel: fy.chartLabel, start: fy.start, end: fy.end,
      from: fy.start, to: current && today < fy.end ? today : fy.end, current, prevFrom: prev.start, prevTo: prev.end });
  }
  return out;
}

// The same point last year for the year still running: its first day to the
// same day of the year before (orgTime's one window, Reports' and the Board's).
function samePoint(year, today) {
  if (!year || !year.current) return null;
  const w = orgTime.samePointLastYear(year.start, year.end, today);
  return w ? { from: w.from, to: w.to } : null;
}

// "up $1,200 (25%)", "down $800 (40%)", "first year", "no gifts".
function changeWords(cents, prevCents, { first = false, partial = false, firstWords = "first year", basis = "", gifts = 0 } = {}) {
  // TRUTH-4: a year with a gift that a refund took back to $0 or below has gifts; it says so, never "no gifts".
  if (cents <= 0 && gifts > 0) return `refunded, net ${fmt(cents)}`;
  if (cents <= 0 && !first) return partial ? "no gifts yet" : "no gifts";
  if (first) return cents > 0 ? firstWords : (partial ? "no gifts yet" : "no gifts");
  const tail = basis ? ` ${basis}` : "";
  if (prevCents <= 0) return `up ${fmt(cents)}${tail}`;
  const diff = cents - prevCents;
  if (diff === 0) return `the same${tail}`;
  const pct = Math.round(Math.abs(diff) / prevCents * 100);
  return `${diff > 0 ? "up" : "down"} ${fmt(Math.abs(diff))} (${pct}%)${tail}`;
}

// ── ONE PERSON ─────────────────────────────────────────────────────────────
async function donorByYear(query, org, donorId, today) {
  const orgId = org.id;
  const [d] = await query(
    `SELECT d.id, d.name, d.imported_total, d.imported_through, d.imported_source, d.imported_import_id,
            ROUND(${LIFETIME("d")} * 100)::bigint AS lifetime_cents
       FROM donors d WHERE d.org_id = ? AND d.id = ? AND ${LIVE("d")}`, [orgId, donorId]);
  if (!d) return null;
  // Every money row Lifetime counts, read once.
  const gifts = await query(
    `SELECT g.id, LEFT(g.date, 10) AS date, g.amount::text AS amount
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND g.donor_id = ? AND ${MONEY("g")} AND ${AFTER_IMPORT("g", "d")}`, [orgId, donorId]);
  // Soft credit: someone else's gift credited to them, and their own credit rows.
  const soft = await query(
    `SELECT LEFT(g.date, 10) AS date, sc.amount::text AS amount
       FROM gift_soft_credits sc JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
      WHERE sc.org_id = ? AND sc.donor_id = ?
     UNION ALL
     SELECT LEFT(g.date, 10), g.amount::text FROM gifts g WHERE g.org_id = ? AND g.donor_id = ? AND ${IS_CREDIT("g")}`,
    [orgId, donorId, orgId, donorId]);

  const dated = gifts.filter(g => /^\d{4}-\d{2}-\d{2}$/.test(g.date || ""));
  const earliest = dated.map(g => g.date).sort()[0] || null;
  const years = yearsSpan(org, today, earliest, PERSON_YEARS_MAX);
  const oldest = years[years.length - 1];
  const sp = samePoint(years[0], today);
  const inY = (date, y) => date >= y.from && date <= y.to;

  const rows = years.map(y => {
    const mine = dated.filter(g => inY(g.date, y));
    const cents = mine.reduce((s, g) => s + toCents(g.amount), 0);
    const positive = mine.filter(g => toCents(g.amount) > 0);
    const largest = positive.reduce((m, g) => Math.max(m, toCents(g.amount)), 0);
    const softCents = soft.filter(s => s.date && inY(s.date, y)).reduce((n, s) => n + toCents(s.amount), 0);
    const src = extra => ({ key: "donor-year", params: { donor: donorId, from: y.from, to: y.to, ...extra } });
    return {
      key: y.key, label: y.label, chartLabel: y.chartLabel, from: y.from, to: y.to, current: y.current,
      total: dollars(cents), cents, giftCount: positive.length, largest: dollars(largest), largestCents: largest,
      // TRUTH-4: a $0 row in the year is listed in history; the year says it is on file, not counted.
      alsoOnFile: (z => (z ? { zero: z, sentence: require("./giftCount").alsoOnFile(z) } : null))(mine.filter(g => toCents(g.amount) === 0).length),
      softCredit: dollars(softCents), softCents,
      sources: { total: src({}), giftCount: src({ measure: "count" }), largest: src({ largest: true }),
        softCredit: { key: "donor-year-soft", params: { donor: donorId, from: y.from, to: y.to } } },
    };
  });
  // The year still running against the same point last year.
  let samePointRow = null;
  if (sp) {
    const c = dated.filter(g => g.date >= sp.from && g.date <= sp.to).reduce((s, g) => s + toCents(g.amount), 0);
    samePointRow = { from: sp.from, to: sp.to, total: dollars(c), cents: c, source: { key: "donor-year", params: { donor: donorId, from: sp.from, to: sp.to } } };
  }
  const hasBefore = d.imported_total != null && toCents(d.imported_total) !== 0;
  rows.forEach((r, i) => {
    const prev = rows[i + 1];
    const first = !prev;
    if (r.current && samePointRow) r.change = changeWords(r.cents, samePointRow.cents, { first, partial: true, firstWords: hasBefore ? "first year after the import" : "first year", basis: "on the same point last year", gifts: r.giftCount });
    else r.change = changeWords(r.cents, prev ? prev.cents : 0, { first, partial: r.current, firstWords: hasBefore ? "first year after the import" : "first year", gifts: r.giftCount });
  });

  // Money Lifetime counts that is in no year: older than the years shown, no
  // date, or dated after today. Each is its own row so the rows foot.
  const other = [];
  const older = dated.filter(g => g.date < oldest.from);
  const later = dated.filter(g => g.date > years[0].to);
  const undated = gifts.filter(g => !/^\d{4}-\d{2}-\d{2}$/.test(g.date || ""));
  const add = (key, label, list, params) => {
    if (!list.length) return;
    const c = list.reduce((s, g) => s + toCents(g.amount), 0);
    other.push({ key, label, total: dollars(c), cents: c, giftCount: list.filter(g => toCents(g.amount) > 0).length, source: { key: "donor-year", params: { donor: donorId, ...params } } });
  };
  add("older", `Before ${oldest.label}`, older, { to: orgTime.addDays(oldest.from, -1) });
  add("later", "Dated after today", later, { from: orgTime.addDays(years[0].to, 1) });
  add("undated", "No date on the gift", undated, { undated: true });

  const before = hasBefore ? {
    total: dollars(toCents(d.imported_total)), cents: toCents(d.imported_total),
    source: d.imported_source || null, through: d.imported_through ? String(d.imported_through).slice(0, 10) : null,
    sentence: `Before Steward: ${fmt(toCents(d.imported_total))} (stated in your import)`,
    figureSource: { key: "donor-lifetime", params: { donor: donorId } },
  } : null;

  const sumCents = rows.reduce((s, r) => s + r.cents, 0) + other.reduce((s, r) => s + r.cents, 0) + (before ? before.cents : 0);
  return {
    donorId, today, years: rows, other, before, samePoint: samePointRow,
    lifetime: dollars(Number(d.lifetime_cents)), lifetimeCents: Number(d.lifetime_cents), footsCents: sumCents,
    sentence: "Each fiscal year's giving: every gift dated in it, refunds taken off, soft and matching credits left out (they are on their own line). The year still running is so far, and is compared with the same point last year. A total stated in an import is its own row, Before Steward, and is not spread across years. The rows add up to Lifetime.",
  };
}

// ── THE ORG ───────────────────────────────────────────────────────────────
// SQL: each person who gave in each span, with how they came to give in it.
// `y` rows (k, f, t, pf, pt): the span and the year before it. One person is
// exactly one of: new (their first gift ever is in the span, firstGift.js),
// retained (gave in the year before, retained.js), reactivated (gave before
// that, not in the year before). The `givers` source's people, cut three ways.
// SCALE-3: set-wise. Each person's first gift date (FIRST_DATE's aggregate,
// FIRST_ON_FILE_AGG, then EARLIER with the import's) is read once for the org,
// and "gave in the year before" once per span, then joined; before, both were
// a subquery per person per span, 1.3 s of year-over-year's 1.6 s on a
// 25,000-person org. Same rows, same kinds (the JSON diffed byte for byte).
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
const KIND_WORDS = { new: "First gift ever in this year", retained: "Gave the year before too", reactivated: "Gave before, not the year before" };

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

// ── THE ROWS BEHIND THE FIGURES (server/reports/yoySources.js) ──────────────
// One person's money in a span of their Lifetime: every money row the imported
// total does not already cover. `largest` keeps only the largest gift;
// `undated` only the gifts with no date. Columns as every figure source.
function donorYearSql(orgId, p) {
  const args = [orgId, p.donor];
  let span = "";
  if (p.undated) span += " AND (g.date IS NULL OR g.date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')";
  else {
    span += " AND g.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'";
    if (p.from) { span += " AND LEFT(g.date, 10) >= ?"; args.push(p.from); }
    if (p.to) { span += " AND LEFT(g.date, 10) <= ?"; args.push(p.to); }
  }
  if (p.largest || p.measure === "count") span += " AND g.amount > 0";   // TRUTH-3: a count opens the counted gifts (giftCount.js)
  const inner = `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(f.name, 'Unrestricted') AS name, g.date,
                        ROUND(g.amount::numeric, 2) AS amount, COALESCE(NULLIF(g.payment_method, ''), INITCAP(NULLIF(g.type, ''))) AS detail
                   FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                   LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
                  WHERE g.org_id = ? AND g.donor_id = ? AND d.deleted_at IS NULL AND ${MONEY("g")} AND ${AFTER_IMPORT("g", "d")}${span}`;
  return {
    sql: p.largest ? `SELECT * FROM (${inner}) t ORDER BY amount DESC, date DESC NULLS LAST, id LIMIT 1` : inner,
    args, order: p.largest ? "amount DESC, id" : undefined,
  };
}
// One person's soft credit dated in a span: someone else's gift credited to
// them, and their own soft or matching credit rows. Never in a total.
function donorSoftYearSql(orgId, p) {
  return {
    sql: `SELECT sc.id, 'soft_credit' AS type, g.donor_id, COALESCE(gd.name, 'Someone no longer in Steward') AS name, g.date,
                 ROUND(sc.amount::numeric, 2) AS amount, 'Credited from their gift' AS detail
            FROM gift_soft_credits sc
            JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
            JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id AND d.deleted_at IS NULL
            LEFT JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
           WHERE sc.org_id = ? AND sc.donor_id = ? AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?
          UNION ALL
          SELECT g.id, 'gift', g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2), INITCAP(TRIM(g.type))
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND g.donor_id = ? AND ${IS_CREDIT("g")} AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?`,
    args: [orgId, p.donor, p.from, p.to, orgId, p.donor, p.from, p.to],
    order: "date DESC NULLS LAST, id",
  };
}
// The org's largest single gift in a span (the `gifts` source's rows, the top one).
function yearLargestSql(orgId, p) {
  return {
    sql: `SELECT * FROM (SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                 COALESCE(f.name, 'Unrestricted') AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
            LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
           WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND g.amount > 0
           ORDER BY g.amount DESC, g.date DESC, g.id LIMIT 1) t`,
    args: [orgId, p.from, p.to],
    order: "amount DESC, id",
  };
}

module.exports = { donorYearSql, donorSoftYearSql, yearLargestSql, yearsSpan, samePoint, changeWords, donorByYear, orgByYear, donorKindsSql, KIND_WORDS, fmt };
