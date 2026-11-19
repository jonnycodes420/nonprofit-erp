// server/onboard/totals.js · ONBOARD-3 item 1. "DOES THIS MATCH YOUR OLD SYSTEM?"
//
// After a new org's first donor file, before Home: what Steward read, by year.
// Each year's total and gift count are byYear.orgByYear's own (the Giving
// summary's year, shared/numbers): this file never sums a year itself, so a
// year here cannot disagree with Reports. Beside each year, an optional figure
// from the old system. Within $1 reads "Matches"; otherwise the difference is
// shown beside the facts that usually explain it, each one a computed figure
// that opens its rows:
//   · refunds dated in the year (Steward takes them off; many systems do not),
//   · soft and matching credits dated in the year (recognition, never money),
//   · pledges made in the year and not yet paid (a promise, not a gift),
//   · gifts with no date (in no year at all),
//   · rows the import set aside (never written; the import's own check page).
// Steward never says which one is the cause: it shows them and the director
// decides. "Looks right" stamps orgs.data_in_at (ONBOARD-2's data-in gate),
// stored with the figures typed, and never blocks on a mismatch.
"use strict";
const BY = require("../../shared/numbers/byYear");
const FY = require("../../shared/numbers/fiscalYear");
const { MONEY } = require("../../shared/numbers/money");
const { IS_CREDIT } = require("../../creditTypes");
const { PLEDGE_MADE } = require("../../shared/numbers/lapse");
const { PAID_OF } = require("../../shared/numbers/pledges");

const YEARS_SHOWN = 3;
const MATCH_CENTS = 100;   // "within $1"
const UNDATED = g => `(${g}.date IS NULL OR ${g}.date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')`;
const MADE = PLEDGE_MADE.replace(/\bpp\./g, "p.");

const fmt = c => {
  const n = Math.abs(Math.round(Number(c) || 0));
  return `${c < 0 ? "-" : ""}$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;

// The rows behind each explanation, as figure sources (registered into
// figureSources.js by totalsSources.js). Each is the same filter as its figure.
const SQL = {
  refunds: (orgId, p) => ({
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, 'Refund' AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${MONEY("g")} AND g.amount < 0 AND g.date >= ? AND g.date <= ?`,
    args: [orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  soft: (orgId, p) => ({
    sql: `SELECT sc.id, 'soft_credit' AS type, sc.donor_id, d.name, g.date, ROUND(sc.amount::numeric, 2) AS amount, 'Soft credit from another person''s gift' AS detail
            FROM gift_soft_credits sc JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
            JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id AND d.deleted_at IS NULL
           WHERE sc.org_id = ? AND g.date >= ? AND g.date <= ?
          UNION ALL
          SELECT g.id, 'gift', g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2), 'Soft or matching credit'
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${IS_CREDIT("g")} AND g.date >= ? AND g.date <= ?`,
    args: [orgId, p.from, p.to, orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  pledges: (orgId, p) => ({
    sql: `SELECT p.id, 'pledge' AS type, p.donor_id, d.name, ${MADE} AS date,
                 ROUND(GREATEST(p.amount - ${PAID_OF("p")}, 0)::numeric, 2) AS amount, 'Pledged, not yet paid' AS detail
            FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
           WHERE p.org_id = ? AND p.status = 'open' AND p.amount - ${PAID_OF("p")} > 0 AND ${MADE} >= ? AND ${MADE} <= ?`,
    args: [orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  undated: (orgId) => ({
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, NULL::text AS date, ROUND(g.amount::numeric, 2) AS amount, 'No date on the gift' AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${MONEY("g")} AND ${UNDATED("g")}`,
    args: [orgId], order: "amount DESC NULLS LAST, id" }),
};

async function sumOf(query, built) {
  const [r] = await query(`SELECT COALESCE(SUM(ROUND(x.amount * 100)), 0)::bigint AS cents, COUNT(*)::int AS n FROM (${built.sql}) x`, built.args);
  return { cents: Math.abs(Number(r && r.cents) || 0), n: Number(r && r.n) || 0 };
}

// What the import set aside (never written), per donor-file import still on file.
async function setAside(query, orgId) {
  const rows = await query(`SELECT i.id, i.name, i.rows_set_aside, i.summary_json FROM imports i
     WHERE i.org_id = ? AND i.committed_at IS NOT NULL AND i.reversed_at IS NULL
       AND COALESCE(i.shape,'') NOT IN ('deposit','source','volunteers') AND COALESCE(i.rows_set_aside, 0) > 0
     ORDER BY i.committed_at`, [orgId]);
  return rows.map(r => {
    let s = {}; try { s = typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : (r.summary_json || {}); } catch { s = {}; }
    const gaps = ((s.verifyFile || {}).gaps || []);
    const cents = gaps.reduce((a, g) => a + (Number(g.cents) || 0), 0);
    return { importId: r.id, name: r.name, rows: Number(r.rows_set_aside) || 0, cents };
  });
}

// The difference between Steward's year and the figure typed (cents), in words.
function compare(stewardCents, typedCents) {
  if (typedCents == null || !Number.isFinite(Number(typedCents))) return null;
  const diff = Math.round(Number(typedCents)) - Math.round(Number(stewardCents));
  if (Math.abs(diff) <= MATCH_CENTS) return { matches: true, diffCents: diff, words: "Matches" };
  return { matches: false, diffCents: diff,
    words: `Your old system says ${fmt(typedCents)}, ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than Steward.` };
}

// "$12,400" / "12400.50" / "12,400" → cents; blank → null; anything else → NaN.
function parseTyped(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : NaN;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

// The screen: the last three years (the org's year setting), each with its
// definition, its sources and its explanations.
async function read(query, org, today, { heavy } = {}) {
  const all = await BY.orgByYear(query, org, today, { heavy });
  const years = all.years.slice(0, YEARS_SHOWN);
  const fiscal = FY.startMonth(org) !== 1;
  const out = [];
  for (const y of years) {
    const p = { from: y.from, to: y.to };
    const [refunds, soft, pledges] = await Promise.all([sumOf(query, SQL.refunds(org.id, p)), sumOf(query, SQL.soft(org.id, p)), sumOf(query, SQL.pledges(org.id, p))]);
    const explain = [];
    if (refunds.n) explain.push({ key: "refunds", cents: refunds.cents, sentence: `${plural(refunds.n, "refund", "refunds")} came off this year in Steward (${fmt(refunds.cents)}). A system that shows gifts before refunds reads higher.`, source: { key: "onb-refunds", params: p } });
    if (soft.n) explain.push({ key: "soft", cents: soft.cents, sentence: `${plural(soft.n, "soft or matching credit", "soft or matching credits")} (${fmt(soft.cents)}) are left out: they recognise someone, they are not money in. A system that counts them reads higher.`, source: { key: "onb-soft", params: p } });
    if (pledges.n) explain.push({ key: "pledges", cents: pledges.cents, sentence: `${plural(pledges.n, "pledge", "pledges")} made this year ${pledges.n === 1 ? "is" : "are"} not yet paid (${fmt(pledges.cents)}). Steward counts a pledge when it is paid; a system that counts pledges reads higher.`, source: { key: "onb-pledges", params: p } });
    out.push({ key: y.key, label: y.label, from: y.from, to: y.to, current: !!y.current,
      cents: y.cents, giftCount: y.giftCount, sources: { total: y.sources.total, giftCount: y.sources.giftCount },
      sentence: `Every gift dated ${y.from} to ${y.to}${y.current ? " (so far)" : ""}, refunds taken off, soft and matching credits left out.`,
      explain });
  }
  const undated = await sumOf(query, SQL.undated(org.id));
  const aside = await setAside(query, org.id);
  const always = [];
  if (undated.n) always.push({ key: "undated", cents: undated.cents, sentence: `${plural(undated.n, "gift has", "gifts have")} no date (${fmt(undated.cents)}), so ${undated.n === 1 ? "it is" : "they are"} in no year.`, source: { key: "onb-undated", params: {} } });
  for (const a of aside) always.push({ key: `aside:${a.importId}`, cents: a.cents, sentence: `${plural(a.rows, "row", "rows")} of "${a.name}" ${a.rows === 1 ? "was" : "were"} set aside on import and never written${a.cents ? `; ${a.rows === 1 ? "it comes" : "together they come"} to ${fmt(a.cents)}${a.cents < 0 ? " (refunds or credits in the file)" : ""}` : ""}. This is across all years.`, open: { kind: "import", id: a.importId } });
  return { yearKind: fiscal ? "fiscal" : "calendar", years: out, always,
    sentence: fiscal ? "Your years are fiscal years, from your Settings." : "Your years are calendar years, from your Settings.",
    question: "What does your old system say?" };
}

// Due: the first donor file is in and nobody has said "Looks right" yet.
async function isDue(query, orgId) {
  const [o] = await query(`SELECT totals_due_at, data_in_at FROM orgs WHERE id = ?`, [orgId]);
  return !!(o && o.totals_due_at && !o.data_in_at);
}

// Called after every import is recorded (routes/dataHealth.afterImport) and
// after a staged import is made live. The org's FIRST donor file, live, with no
// data-in yet, makes the check due; an org that already had a donor file (every
// customer before this build) never sees it.
async function markDue(query, orgId, importId) {
  if (!orgId || !importId) return false;
  const DONOR_FILE = `i.committed_at IS NOT NULL AND i.reversed_at IS NULL AND COALESCE(i.shape,'') NOT IN ('deposit','source','volunteers')
    AND EXISTS (SELECT 1 FROM donors d WHERE d.org_id = i.org_id AND d.created_import_id = i.id AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE)`;
  const rows = await query(`UPDATE orgs o SET totals_due_at = NOW()
      WHERE o.id = ? AND o.data_in_at IS NULL AND o.totals_due_at IS NULL
        AND EXISTS (SELECT 1 FROM imports i WHERE i.id = ? AND i.org_id = o.id AND ${DONOR_FILE})
        AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.org_id = o.id AND i.id <> ? AND i.committed_at < (SELECT committed_at FROM imports WHERE id = ?)
                         AND COALESCE(i.shape,'') NOT IN ('deposit','source','volunteers') AND i.reversed_at IS NULL)
      RETURNING o.id`, [orgId, importId, importId, importId]);
  return rows.length > 0;
}

module.exports = { read, compare, parseTyped, isDue, markDue, SQL, MATCH_CENTS, YEARS_SHOWN, fmt };
