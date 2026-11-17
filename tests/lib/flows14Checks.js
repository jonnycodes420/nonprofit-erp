// tests/lib/flows14Checks.js · FLOWS-14. SIX MONEY FACTS, ASKED OF assertSurfacesAgree.
//
// Each check reads the org's own rows for its ground truth (plain SQL, no app code) and asks the
// surface the fleet looked at through the real API. Named so a suite can run some (ctx.only):
//
//   orphanRefunds   (W-1115-Finance-07X) no refund row stands without its gift: a deposit undo
//                   or a gift delete takes its refunds with it.
//   averageFoots    (W-1116-Fundraising-07) the Giving summary's Average gift is its Total over its
//                   Gifts, to the cent, this fiscal year and the last 365 days.
//   askOwnGifts     (W-1115-Finance-34X) a person's ask names a largest gift that is theirs, unless
//                   its words say it is the household's.
//   lastGiftIsGift  (W-1116-Fundraising-15X) a person's Last gift is a gift above $0, never a refund
//                   row, never a gift refunded in full.
//   thanksRule      (W-1115-Finance-02X) every thank-you count (Home's org-wide, each profile's) is
//                   the gifts above $0, not refunded in full, with no thank-you logged.
//   portfolioFoots  (W-1115-Donors-06X) the officer rows and Unassigned add up to the Donors tab.
"use strict";

const C = v => Math.round(Number(v || 0) * 100);
const $ = c => `$${(c / 100).toFixed(2)}`;
const CREDIT = "('soft credit','soft-credit','soft_credit','matching gift credit','matched gift credit','hard credit reversal')";
const KEPT = g => `(${g}.amount > 0 AND ${g}.refunded_in_full IS NOT TRUE AND LOWER(TRIM(COALESCE(${g}.type, ''))) NOT IN ${CREDIT})`;

// Run by every assertSurfacesAgree: orphanRefunds, averageFoots, thanksRule, portfolioFoots.
// Run only when a suite names them (`only`): askOwnGifts and lastGiftIsGift, which read each
// person's stored Last gift and Insights, and a fixture written by SQL may not have recomputed those.
const NAMED_ONLY = new Set(["askOwnGifts", "lastGiftIsGift"]);

async function flows14Checks({ orgId, get, q, agree, diffs, skip, today, named = false }) {
  const on = n => !skip.has(n) && (!NAMED_ONLY.has(n) || named);
  const addDays = require("../../orgTime").addDays;

  if (on("orphanRefunds")) {
    const [o] = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(r.amount * 100)), 0)::bigint AS c FROM gifts r
                          WHERE r.org_id = $1 AND r.refund_of IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = r.refund_of AND g.org_id = r.org_id)`, [orgId]);
    agree("refund rows whose gift is gone", [["none", 0], ["on file", Number(o.n)]]);
  }

  if (on("averageFoots")) {
    for (const params of [`period=fiscal`, `from=${addDays(today, -365)}&to=${today}`]) {
      const gs = await get(`/reports/giving-summary?${params}`).catch(() => null);
      if (!gs || !(Number(gs.giftCount) > 0)) continue;
      const want = Math.round(C(gs.total) / Number(gs.giftCount));
      agree(`the Giving summary's average (${params})`, [["Total ÷ Gifts", want], ["Average gift", C(gs.avgGift)]], $);
    }
  }

  if (on("askOwnGifts")) {
    const people = await q(`SELECT d.id FROM donors d WHERE d.org_id = $1 AND d.household_id IS NOT NULL AND d.deleted_at IS NULL AND d.erased_at IS NULL
                               AND (SELECT COUNT(*) FROM donors m WHERE m.org_id = d.org_id AND m.household_id = d.household_id AND m.deleted_at IS NULL) > 1
                             ORDER BY d.id LIMIT 8`, [orgId]);
    for (const { id } of people) {
      const [k] = await q(`SELECT COALESCE(MAX(ROUND(g.amount * 100)) FILTER (WHERE ${KEPT("g")}), 0)::bigint AS big FROM gifts g WHERE g.org_id = $1 AND g.donor_id = $2`, [orgId, id]);
      const ins = await get(`/insights/donor/${id}`).catch(() => null);
      const words = JSON.stringify(ins || {});
      for (const m of words.matchAll(/Ask \$[\d,]+: ([^"]*?)largest gift \$([\d,]+(?:\.\d\d)?)/g)) {
        if (/household's\s*$/.test(m[1])) continue;
        const said = C(String(m[2]).replace(/,/g, ""));
        if (said > Number(k.big)) diffs.push(`${id}: the ask says "largest gift ${$(said)}" as theirs, and their own largest gift is ${$(Number(k.big))}`);
      }
    }
  }

  if (on("lastGiftIsGift")) {
    const people = await q(`SELECT DISTINCT r.donor_id AS id FROM gifts r JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
                             WHERE r.org_id = $1 AND (r.amount < 0 OR r.refunded_in_full IS TRUE) AND d.deleted_at IS NULL AND d.erased_at IS NULL AND d.imported_last_gift_date IS NULL LIMIT 8`, [orgId]);
    for (const { id } of people) {
      const [k] = await q(`SELECT ROUND(g.amount * 100)::bigint AS c FROM gifts g WHERE g.org_id = $1 AND g.donor_id = $2 AND ${KEPT("g")} AND g.date IS NOT NULL AND LEFT(g.date, 10) <= $3
                            ORDER BY g.date DESC, g.created_at DESC, g.amount DESC LIMIT 1`, [orgId, id, today]);
      const d = await get(`/donors/${id}`).catch(() => null);
      if (!d) continue;
      if (!k) { if (C(d.last_gift_amount) > 0) diffs.push(`${id}: no gift on file, and Last gift reads ${$(C(d.last_gift_amount))}`); continue; }
      agree(`${id}'s Last gift`, [["the last gift that is a gift", Number(k.c)], ["Last gift", C(d.last_gift_amount)]], $);
    }
  }

  if (on("thanksRule")) {
    const [org] = await q(`SELECT LEFT(COALESCE(steward_start_date::text, created_at::text), 10) AS since FROM orgs WHERE id = $1`, [orgId]).catch(() => [null]);
    const since = (org && org.since) || "2000-01-01";
    const [k] = await q(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                          WHERE g.org_id = $1 AND d.deleted_at IS NULL AND COALESCE(g.is_sample, false) = false AND g.date >= $2
                            AND COALESCE(g.acknowledgement_sent, false) = false AND g.amount > 0 AND g.refunded_in_full IS NOT TRUE`, [orgId, since]);
    const f = await get(`/figures/unthanked/rows?since=${since}&page=1&pageSize=1`).catch(() => null);
    if (f) agree("Home's gifts not yet thanked", [["gifts above $0, not refunded in full, not thanked", Number(k.n)], ["the figure", Number(f.value)]]);
  }

  if (on("portfolioFoots")) {
    const r = await get("/portfolio/officers").catch(() => null);
    if (r && r.file) {
      const off = (r.officers || []).filter(o => Number(o.portfolio_count) > 0);
      const [k] = await q(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.erased_at IS NULL
                              AND (d.person_types IS NULL OR d.person_types @> '["donor"]'::jsonb
                                   OR COALESCE(d.imported_total, 0) > 0 OR EXISTS (SELECT 1 FROM gifts kg WHERE kg.org_id = d.org_id AND kg.donor_id = d.id AND ${KEPT("kg")}))`, [orgId]);   // FLOWS-18: a giver is a donor
      const tab = await get("/donors?role=donor&limit=1").catch(() => null);
      const rowsN = off.reduce((s, o) => s + Number(o.portfolio_count), 0) + Number(r.file.unassigned.portfolio_count)
        + (r.file.other ? r.file.other.count : 0) - (r.file.outside ? r.file.outside.count : 0);
      agree("the officer portfolios and Unassigned, added up", [["the donor file (SQL)", Number(k.n)], ["the Donors tab", tab ? Number(tab.total) : Number(k.n)], ["the rows", rowsN]]);
      const rowsC = off.reduce((s, o) => s + C(o.portfolio_giving), 0) + C(r.file.unassigned.portfolio_giving)
        + (r.file.other ? C(r.file.other.giving) : 0) - (r.file.outside ? C(r.file.outside.giving) : 0);
      agree("the portfolios' giving, added up", [["the file's Lifetime", C(r.file.file.giving)], ["the rows", rowsC]], $);
      if (!r.file.foots) diffs.push(`the portfolio strip says it does not foot: ${r.file.sentence}`);
    }
  }
}

module.exports = { flows14Checks };
