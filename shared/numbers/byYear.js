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
const SCHED_DUE = require("./scheduled").DUE;   // TRUTH-6: a scheduled gift counts on its date
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
  // TRUTH-6: a gift stored scheduled is not money yet (money.js MONEY), so it
  // is never here; this row is a gift dated after today written before the rule.
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

// REPORTS-SPEED-2: the org's figures for every span in ONE pass over the
// gifts. Year-over-year sent five statements over the same gifts (the year
// totals, then donorKindsSql's rows for the years, for the year before the
// oldest and for the same point last year), and the kinds statement carried
// each person's name, date and amount through four sorts that spilled to
// disk: 1.4 s of 2.2 s on a 25,000-person org, holding its connection.
// Here the org's money rows are read once, in person order straight off the
// covering index (gifts_person_money), and summed per person with one set of
// FILTER columns per span, so nothing is sorted; each figure is then a count
// or a sum over one row per person. The rules are the ones above, unchanged:
//   · total, gift count, largest: the `gifts` source (MONEY, a person not
//     deleted), as the totals read was.
//   · a donor: donorKindsSql's person (not deleted, not erased, a money row
//     above zero in the span), and its kind by the same CASE: a first gift
//     ever (FIRST_ON_FILE_AGG, EARLIER than the import's) on or after the
//     span's start is new; a GIFT in the span keyed `pk` (the year before) is
//     retained; otherwise reactivated.
// `spans`: [{ k, f, t, pk }]; pk is another span's key, or null when that
// span's kinds are never asked. `read(row)` gives a Map of k to
// { s, n, mx, donors, new, retained, reactivated }. The drawer's rows stay
// donorKindsSql's, by the same rules; tests/reports-speed2.test.js holds the
// answer to main's five-statement one and to the raw rows worked by hand.
function orgYearsSql(orgId, spans) {
  const spanArgs = [];
  const at = new Map(spans.map((s, i) => [s.k, i]));
  const inSpan = spans.map((s, i) => { spanArgs.push(s.f, s.t); return `(g.date >= ? AND g.date <= ?) AS i${i}`; });
  const perPerson = spans.map((s, i) => `SUM(g.amount) FILTER (WHERE g.i${i}) AS s${i},
             COUNT(*) FILTER (WHERE g.i${i} AND g.gift) AS n${i},
             MAX(g.amount) FILTER (WHERE g.i${i} AND g.amount > 0) AS mx${i},
             COUNT(*) FILTER (WHERE g.i${i} AND g.amount > 0) AS pos${i}`);
  const kindArgs = [];
  const perSpan = spans.map((s, i) => {
    const giver = `p.pos${i} > 0 AND p.erased_at IS NULL`;
    kindArgs.push(s.f, s.f, s.f);
    const isNew = `${EARLIER("p.first", IMPORTED_FIRST("p"))} >= ?`;
    const prev = s.pk != null && at.has(s.pk) ? `p.n${at.get(s.pk)} > 0` : "false";
    return `COALESCE(SUM(p.s${i}), 0)::text AS s${i}, COALESCE(SUM(p.n${i}), 0)::int AS n${i}, MAX(p.mx${i})::text AS mx${i},
           COUNT(*) FILTER (WHERE ${giver})::int AS donors${i},
           COUNT(*) FILTER (WHERE ${giver} AND ${isNew})::int AS new${i},
           COUNT(*) FILTER (WHERE ${giver} AND NOT COALESCE(${isNew}, false) AND ${prev})::int AS retained${i},
           COUNT(*) FILTER (WHERE ${giver} AND NOT COALESCE(${isNew}, false) AND NOT (${prev}))::int AS reactivated${i}`;
  });
  // In the order the text reads them: the kinds' span starts, the spans, the org twice.
  const args = [...kindArgs, ...spanArgs, orgId, orgId];
  const sql = `
    SELECT ${perSpan.join(",\n           ")}
      FROM (SELECT a.*, d.erased_at, d.imported_first_gift_date, d.imported_last_gift_date
              FROM (SELECT g.donor_id, ${FIRST_ON_FILE_AGG("g")} AS first,
                           ${perPerson.join(",\n                           ")}
                      FROM (SELECT g.donor_id, g.org_id, g.amount, g.type, g.date, g.scheduled_on, g.refunded_in_full,
                                   ${COUNTED("g")} AS gift, ${inSpan.join(", ")}
                              FROM gifts g WHERE g.org_id = ? AND ${MONEY("g")}) g
                     GROUP BY g.donor_id) a
              JOIN donors d ON d.id = a.donor_id AND d.org_id = ? AND d.deleted_at IS NULL) p`;
  const read = (row) => new Map(spans.map((s, i) => [s.k, { k: s.k, s: row[`s${i}`], n: row[`n${i}`], mx: row[`mx${i}`], donors: row[`donors${i}`],
    new: row[`new${i}`], retained: row[`retained${i}`], reactivated: row[`reactivated${i}`] }]));
  return { sql, args, read };
}

async function orgByYear(query, org, today) {
  const orgId = org.id;
  // REPORTS-SPEED-2: the earliest dated money row, as the first one in date
  // order (idx_gifts_org_date walked from the start) rather than MIN over
  // every row: the same date, 0.3 ms instead of 200 on a 25,000-person org.
  const [e] = await query(
    `SELECT g.date AS first FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")} AND g.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      ORDER BY g.date LIMIT 1`, [orgId]);
  const years = yearsSpan(org, today, e && e.first ? String(e.first).slice(0, 10) : null, ORG_YEARS);
  const sp = samePoint(years[0], today);
  // REPORTS-SPEED-2: every span in one read (orgYearsSql). Each year's "year
  // before" is the next row down, a whole fiscal year, and the oldest's is the
  // year before it ("prior", so its retention rate has a denominator). The
  // same point last year is a span of its own; only its total and its donors
  // are shown, so its kind is never asked.
  const oldest = years[years.length - 1];
  const spans = years.map((y, i) => ({ k: y.key, f: y.from, t: y.to, pk: years[i + 1] ? years[i + 1].key : "prior" }));
  spans.push({ k: "prior", f: oldest.prevFrom, t: oldest.prevTo, pk: null });
  if (sp) spans.push({ k: "sp", f: sp.from, t: sp.to, pk: null });
  const q = orgYearsSql(orgId, spans);
  const byKey = q.read((await query(q.sql, q.args))[0]);
  const count = (key, kind) => { const r = byKey.get(key); return r ? r[kind || "donors"] : 0; };
  const priorN = { n: count("prior") };
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
    const s = byKey.get("sp") || { s: "0", n: 0 };
    const n = { n: count("sp") };
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
           WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")} AND g.amount > 0
           ORDER BY g.amount DESC, g.date DESC, g.id LIMIT 1) t`,
    args: [orgId, p.from, p.to],
    order: "amount DESC, id",
  };
}

module.exports = { donorYearSql, donorSoftYearSql, yearLargestSql, yearsSpan, samePoint, changeWords, donorByYear, orgByYear, donorKindsSql, orgYearsSql, KIND_WORDS, fmt };
