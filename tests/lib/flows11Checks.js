// tests/lib/flows11Checks.js · FLOWS-11. SIX MONEY FACTS, ASKED OF assertSurfacesAgree.
//
// Each check reads the org's own rows for its ground truth (plain SQL, no app code) and asks the
// surface the fleet looked at through the real API. Named so a suite can run some (ctx.only):
//
//   giftDialog        (W-1113-Fundraising-01) the gift dialog's count line is the gift count:
//                     "Showing 1–50 of N" never counts a refund row or a gift refunded in full,
//                     and every row it lists (gifts, their refunds, the rows not counted) adds up
//                     to the figure.
//   refundedProfile   (W-1113-Finance-27X) a person's Average "of N gifts", First, Largest, the
//                     Thank-yous count and the tags count only gifts not refunded in full.
//   householdStatement (W-1114-Finance-29) a household's one statement holds every member's gifts
//                     for the year: its total is the members' gifts added up, in cents.
//   splitTransactions (W-1114-Finance-05X) a split gift is one Transactions line per fund line, and
//                     Transactions filtered to a fund (every year) foots to that fund's balance.
//   beforeSteward     (W-1114-Finance-26X) a Lifetime with no gift behind it says where it came
//                     from, and gives nobody a gift count or a last gift.
//   deletedThanks     (W-1114-Finance-04X) no open thank-you task is left for a gift that is gone.
"use strict";

const C = v => Math.round(Number(v || 0) * 100);
const $ = c => `$${(c / 100).toFixed(2)}`;
const KEPT = g => `(${g}.amount > 0 AND ${g}.refunded_in_full IS NOT TRUE AND LOWER(TRIM(COALESCE(${g}.type, ''))) NOT IN ('soft credit','soft-credit','soft_credit','matching gift credit','matched gift credit','hard credit reversal'))`;

async function flows11Checks({ orgId, get, q, agree, diffs, skip, today }) {
  const on = n => !skip.has(n);   // skip: ["flows11"] leaves all six out (surfacesAgree.js)

  // ── giftDialog ──────────────────────────────────────────────────────────
  if (on("giftDialog")) {
    // The last year to today (the fleet's FY dialog is inside it), so a big org stays quick.
    const span = { a: require("../../orgTime").addDays(today, -365), b: today };
    {
      const params = `from=${span.a}&to=${span.b}`;
      const page1 = await get(`/figures/gifts/rows?${params}&page=1&pageSize=50`).catch(() => null);
      if (page1) {
        agree("the gift dialog's count line", [["the answer's gift count", page1.giftCount], ['"Showing 1–50 of N"', page1.totalRows]]);
        // Every row the dialog lists, every page, the refunds under each gift and the rows apart.
        let listed = 0, n = 0;
        for (let page = 1; page <= 200; page++) {
          const f = await get(`/figures/gifts/rows?${params}&page=${page}&pageSize=200`).catch(() => null);
          if (!f || !f.rows.length) break;
          for (const r of f.rows) { listed += C(r.amount); n++; for (const x of r.refunds || []) listed += C(x.amount); if (r.counted === false) diffs.push(`gift dialog: a row not counted as a gift (${r.id}, ${r.detail}) is paged as one`); }
          if (page === 1 && f.notCounted) for (const x of f.notCounted.rows) listed += C(x.amount);
          if (n >= f.totalRows) break;
        }
        agree("the gift dialog's rows, added up", [["the figure", C(page1.value)], ["every row it lists", listed]], $);
      }
    }
  }

  // ── refundedProfile ─────────────────────────────────────────────────────
  if (on("refundedProfile")) {
    const people = await q(`SELECT DISTINCT g.donor_id AS id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                             WHERE g.org_id = $1 AND g.refunded_in_full IS TRUE AND d.deleted_at IS NULL AND d.erased_at IS NULL LIMIT 6`, [orgId]);
    for (const { id } of people) {
      const [k] = await q(`SELECT COUNT(*) FILTER (WHERE ${KEPT("g")} AND g.date IS NOT NULL AND LEFT(g.date, 10) <= $3)::int AS n,
                                  COALESCE(MAX(ROUND(g.amount * 100)) FILTER (WHERE ${KEPT("g")} AND LEFT(COALESCE(g.date, ''), 10) <= $3), 0)::bigint AS big,
                                  COUNT(*) FILTER (WHERE ${KEPT("g")} AND COALESCE(g.acknowledgement_sent, false) = false AND COALESCE(g.is_sample, false) = false)::int AS unthanked
                             FROM gifts g WHERE g.org_id = $1 AND g.donor_id = $2`, [orgId, id, today]);
      const d = await get(`/donors/${id}`).catch(() => null);
      const F = d && d.figures;
      if (!F) continue;
      agree(`gifts counted for ${id} (a gift refunded in full is not a gift)`, [["the key", k.n], ['Average gift\'s "of N gifts"', F.average ? F.average.count : undefined]]);
      agree(`largest gift for ${id}`, [["the key", Number(k.big)], ["Largest", F.largest && F.largest.cents != null ? F.largest.cents : 0]], $);
      if (k.n === 0 && F.first && F.first.value != null) diffs.push(`first gift for ${id}: every gift is refunded in full, and First still says ${F.first.value}`);
      const st = await get(`/donors/${id}/status`).catch(() => null);
      if (st && k.n === 0 && (st.tags || []).length) diffs.push(`tags for ${id}: every gift is refunded in full, and the profile is tagged ${(st.tags || []).map(t => t.label || t.key || t).join(", ")}`);
    }
  }

  // ── householdStatement ──────────────────────────────────────────────────
  if (on("householdStatement")) {
    const hhs = await q(`SELECT h.id, LEFT(MAX(g.date), 4) AS y FROM households h JOIN donors d ON d.household_id = h.id AND d.org_id = h.org_id AND d.deleted_at IS NULL
                           JOIN gifts g ON g.donor_id = d.id AND g.org_id = h.org_id AND g.date IS NOT NULL
                          WHERE h.org_id = $1 GROUP BY h.id HAVING COUNT(DISTINCT d.id) > 1 ORDER BY h.id LIMIT 4`, [orgId]);
    for (const h of hhs) {
      const [k] = await q(`SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS c, COUNT(DISTINCT g.donor_id)::int AS givers
                             FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                            WHERE g.org_id = $1 AND d.household_id = $2 AND d.deleted_at IS NULL AND g.is_sample IS NOT TRUE
                              AND g.date >= $3 AND g.date <= $4 AND COALESCE(g.dispute_status, '') <> 'lost'
                              AND LOWER(TRIM(COALESCE(g.type, ''))) NOT IN ('soft credit','soft-credit','soft_credit','matching gift credit','matched gift credit','hard credit reversal')`,
                          [orgId, h.id, `${h.y}-01-01`, `${h.y}-12-31`]);
      const p = await get(`/households/${h.id}/year-end-statement/preview?year=${h.y}`).catch(() => null);
      if (!p || !Array.isArray(p.members)) { diffs.push(`the ${h.y} household statement for ${h.id}: there is no one statement for the household (${JSON.stringify(p).slice(0, 120)})`); continue; }
      agree(`the ${h.y} household statement for ${h.id}`, [["every member's gifts, added up", Number(k.c)], ["the household statement's total", p ? p.totalCents : -1]], $);
      const giving = p ? p.members.filter(m => m.lines > 0).length : 0;
      if (p && giving !== k.givers) diffs.push(`the ${h.y} household statement for ${h.id}: ${k.givers} members gave that year, the statement lists gifts from ${giving}`);
    }
  }

  // ── splitTransactions ───────────────────────────────────────────────────
  if (on("splitTransactions")) {
    const lines = await q(`SELECT l.gift_id, l.fund_id, ROUND(l.amount * 100)::bigint AS c FROM gift_fund_lines l
                             JOIN fin_transactions ft ON ft.gift_id = l.gift_id AND ft.org_id = l.org_id
                            WHERE l.org_id = $1 ORDER BY l.gift_id, l.fund_id LIMIT 40`, [orgId]);
    if (lines.length) {
      const got0 = await get(`/finance/transactions?year=all`).catch(() => null);
      const all = Array.isArray(got0) ? got0 : [];
      const byGift = new Map();
      for (const l of lines) (byGift.get(l.gift_id) || byGift.set(l.gift_id, []).get(l.gift_id)).push(l);
      for (const [gid, want] of byGift) {
        const got = all.filter(t => t.gift_id === gid);
        agree(`Transactions lines for split gift ${gid}`, [["its fund lines", want.length], ["Transactions", got.length]]);
        for (const l of want) {
          const t = got.find(x => x.fund_id === l.fund_id);
          agree(`split gift ${gid}'s ${l.fund_id} line`, [["the fund line", Number(l.c)], ["Transactions", t ? C(t.amount) : 0]], $);
        }
      }
      const summary = await get(`/finance/summary`).catch(() => null);
      const funds = [...new Set(lines.map(l => l.fund_id))];
      for (const fid of funds) {
        const fb = summary && (summary.fundBalances || []).find(f => f.id === fid);
        if (!fb) continue;
        const got1 = await get(`/finance/transactions?year=all&fund=${encodeURIComponent(fid)}`).catch(() => null);
        const rows = Array.isArray(got1) ? got1 : [];
        const net = rows.reduce((n, t) => n + (t.type === "income" ? 1 : -1) * C(t.amount), 0);
        agree(`fund ${fb.name}: Transactions filtered to it, every year`, [["Fund Balances", C(fb.balance)], ["its lines, in less out", net]], $);
      }
    }
  }

  // ── beforeSteward ───────────────────────────────────────────────────────
  if (on("beforeSteward")) {
    const people = await q(`SELECT d.id, d.gift_count, d.last_gift_amount, d.imported_source FROM donors d
                             WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.erased_at IS NULL AND COALESCE(d.total_giving, 0) > 0
                               AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount <> 0)
                             ORDER BY (d.imported_source = 'an amount typed in when they were added') DESC, d.id LIMIT 6`, [orgId]);
    for (const p of people) {
      const typed = p.imported_source === "an amount typed in when they were added";
      const d = await get(`/donors/${p.id}`).catch(() => null);
      const F = d && d.figures;
      if (!F) continue;
      const words = (F.imported && F.imported.words) || "";
      if (!(typed ? /^Includes \$[\d,.]+ from before Steward/ : /^Includes \$[\d,.]+ from (before Steward|your old system)/).test(words)) {
        diffs.push(`Lifetime for ${p.id} is ${F.lifetime && F.lifetime.value} with no gift on file, and the line beside it does not say it is from before Steward ("${words}")`);
      }
      if (typed && (Number(p.gift_count) > 0 || Number(p.last_gift_amount) > 0)) {
        diffs.push(`${p.id}: a total typed in on Add person is not a gift, yet the record carries ${p.gift_count} gift(s) and a last gift of ${p.last_gift_amount}`);
      }
    }
  }

  // ── deletedThanks ───────────────────────────────────────────────────────
  if (on("deletedThanks")) {
    const left = await q(`SELECT t.id, t.title, t.donor_id FROM tasks t
                           WHERE t.org_id = $1 AND t.voided_at IS NULL AND COALESCE(t.done, 0) = 0 AND (
                             (t.source_gift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = t.source_gift_id AND g.org_id = t.org_id))
                             OR EXISTS (SELECT 1 FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id AND p.org_id = s.org_id
                                         WHERE s.thread_id = t.thread_id AND s.org_id = t.org_id AND p.status = 'active' AND s.status = 'open'
                                           AND ((to_jsonb(p)->>'source_gift_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = to_jsonb(p)->>'source_gift_id' AND g.org_id = p.org_id))
                                             OR (p.trigger_key = 'first_gift' AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = p.org_id AND g.donor_id = p.donor_id AND g.amount > 0)))))
                           LIMIT 5`, [orgId]);
    for (const t of left) diffs.push(`thank-you for a gift that is gone: task ${t.id} "${t.title}" for ${t.donor_id} is still open`);
  }
}

module.exports = { flows11Checks };
