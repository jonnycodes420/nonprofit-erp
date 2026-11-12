// tests/lib/truth4Pairs.js · TRUTH-4. EVERY SURFACE AGREES ON GIFTS, PEOPLE AND
// AT-RISK MONEY. The pairs the fleet found apart (lead-2026-11-08), asked of
// the real routes and held to a truth written out here from the rows, with no
// app code. surfacesAgree.js runs them as the check "truth4".
//
//   gifts      a gift is hard credit above $0. Fundraising's count, the Giving
//              summary's header and its months, and both drill-downs of one
//              total are the counted rows; a $0 row is said apart ("Also on
//              file"). By year and a one-day report say the $0 row is on file.
//   top        the Top donors header is the sum of its rows; All-time is the
//              sum of the years Year over year shows (both to today).
//   bunt       a person is on at most one LYBUNT row; the rows foot to the header's money.
//   splits     a fund's row in Gifts by fund is the sum of its split lines and
//              foots to the drill-down it opens.
//   atRisk     Lost & Found and the Lost report: each person's last year of
//              giving (the twelve months ending on their last gift), one sum.
//   people     "with email" is never above Everyone, and is Everyone's people with an address.
//   starter    "Volunteers who have never given" = the same rule as a group.
// (Tasks: counts1's check holds the badge to the open tasks; Home's set has its own name.)
"use strict";

const cents = v => Math.round(Number(v || 0) * 100);
const money = c => `$${(c / 100).toFixed(2)}`;
// Hard credit, written out: a row typed as any kind of soft or matching credit is recognition.
// The key's own words (tests/keys/truthKey.js CREDIT_WORDS); a matching gift is money, its credit row is not.
const NOT_CREDIT = "NOT (LOWER(TRIM(COALESCE(g.type,''))) ~ '^(soft[[:space:]_-]?credit|match(ing|ed)?[[:space:]]+gift[[:space:]]+credit)$')";
const GIFT = `${NOT_CREDIT} AND g.amount > 0`;

async function truth4Pairs({ orgId, get, q, agree, diffs, today }) {
  const tday = String(today).slice(0, 10);
  const LIVE = "d.org_id = $1 AND d.deleted_at IS NULL";
  const ov = await get("/fundraising/overview");
  const period = ov && ov.period;
  if (!period || !period.start) { diffs.push("truth4: /fundraising/overview has no period"); return; }
  const from = period.start, to = tday < period.end ? tday : period.end;

  // ── gifts ─────────────────────────────────────────────────────────────────
  const [t] = await q(`SELECT COUNT(*) FILTER (WHERE ${NOT_CREDIT} AND g.amount > 0)::int AS counted,
                              COUNT(*) FILTER (WHERE ${NOT_CREDIT} AND g.amount = 0)::int AS zero,
                              COUNT(*) FILTER (WHERE ${NOT_CREDIT} AND g.amount <> 0)::int AS nonzero
                         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                        WHERE ${LIVE} AND g.date >= $2 AND g.date <= $3`, [orgId, from, to]);
  const gs = await get(`/reports/giving-summary?from=${from}&to=${to}`);
  const months = ((gs && gs.monthly) || []).reduce((n, m) => n + (Number(m.gifts) || 0), 0);
  const sumDlg = await get(`/figures/gifts/rows?from=${from}&to=${to}&pageSize=1`);
  const cntDlg = await get(`/figures/gifts/rows?from=${from}&to=${to}&measure=count&pageSize=1`);
  agree("truth4 gifts this fiscal year (counted, above $0)", [
    ["the rows (hard credit above $0)", t.counted],
    ["Fundraising's Gifts tile", Number(period.giftCount)],
    ["the Giving summary's header", Number(gs && gs.giftCount)],
    ["the Giving summary's months, added up", months],
    ["the count dialog's rows", Number(cntDlg && cntDlg.totalRows)],
  ]);
  agree("truth4 the total's dialog lists the counted rows (and refunds), not $0 rows", [
    ["the rows above or below $0", t.nonzero], ["the total's dialog", Number(sumDlg && sumDlg.totalRows)]]);
  agree("truth4 the $0 rows are said apart", [
    ["the rows at $0", t.zero],
    ["the total's dialog, Also on file", Number(sumDlg && sumDlg.alsoOnFile ? sumDlg.alsoOnFile.zero : 0)],
    ["the Giving summary, Also on file", Number(gs && gs.alsoOnFile ? gs.alsoOnFile.zero : 0)]]);

  // A person with a $0 row: By year says it is on file in its year; a one-day report says so too.
  const zeros = await q(`SELECT g.donor_id, LEFT(g.date,10) AS date FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                          WHERE ${LIVE} AND d.erased_at IS NULL AND g.amount = 0 AND ${NOT_CREDIT} AND g.date IS NOT NULL ORDER BY g.date DESC LIMIT 3`, [orgId]);
  for (const z of zeros) {
    const by = await get(`/donors/${z.donor_id}/by-year`);
    const yr = ((by && by.years) || []).find(y => z.date >= y.from && z.date <= y.to);
    if (yr && !(yr.alsoOnFile && yr.alsoOnFile.zero > 0)) diffs.push(`truth4 By year ${yr.label} for ${z.donor_id} does not say its $0 record on ${z.date} is on file (history lists it)`);
    const day = await get(`/reports/giving-summary?from=${z.date}&to=${z.date}`);
    if (!(day && day.alsoOnFile && day.alsoOnFile.zero > 0)) diffs.push(`truth4 the report for ${z.date} does not say a $0 record is on file that day`);
  }

  // ── top ───────────────────────────────────────────────────────────────────
  const top = await get("/reports/top-donors?scope=lifetime&limit=50");
  if (top && top.figures && top.figures.topTotal) {
    agree("truth4 Top 50 lifetime", [["the header", cents(top.figures.topTotal.value)], ["its rows, added up", (top.rows || []).reduce((n, r) => n + cents(r.total), 0)]], money);
    const yoy = await get("/reports/year-over-year");
    const years = (yoy && yoy.years) || [];
    const [old] = await q(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                            WHERE ${LIVE} AND ${NOT_CREDIT} AND g.date < $2`, [orgId, years.length ? years[years.length - 1].from : "0000"]);
    if (years.length && !old.n) agree("truth4 all-time giving", [["Top donors' All-time", cents(top.figures.allTime && top.figures.allTime.value)],
      ["Year over year's years, added up", years.reduce((n, y) => n + Number(y.cents || 0), 0)]], money);
  }

  // ── bunt ──────────────────────────────────────────────────────────────────
  const ly = await get("/reports/lybunt");
  if (ly && Array.isArray(ly.units)) {
    const seen = new Map();
    for (const u of ly.units) for (const m of (u.members || [{ id: u.id }])) seen.set(m.id, (seen.get(m.id) || 0) + 1);
    for (const [id, n] of seen) if (n > 1) diffs.push(`truth4 LYBUNT lists ${id} on ${n} rows`);
    agree("truth4 LYBUNT people", [["the people on the rows", seen.size], ["the header's people", Number(ly.figures && ly.figures.people && ly.figures.people.value)]]);
    agree("truth4 LYBUNT money", [["the header", cents(ly.figures && ly.figures.atStake && ly.figures.atStake.value)], ["the rows, added up", ly.units.reduce((n, u) => n + cents(u.priorYearTotal), 0)]], money);
  }

  // ── splits ────────────────────────────────────────────────────────────────
  const lines = await q(`SELECT l.fund_id, COALESCE(SUM(ROUND(l.amount*100)),0)::bigint AS c FROM gift_fund_lines l
                           JOIN gifts g ON g.id = l.gift_id AND g.org_id = l.org_id JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                          WHERE ${LIVE} AND g.date >= $2 AND g.date <= $3 GROUP BY l.fund_id`, [orgId, from, to]).catch(() => []);
  if (lines.length) {
    const byFund = await get(`/reports/by-group?groupBy=funds&from=${from}&to=${to}`);
    for (const l of lines) {
      const [{ c: whole }] = await q(`SELECT COALESCE(SUM(ROUND(x.amount*100)),0)::bigint AS c FROM (
            SELECT l.amount FROM gift_fund_lines l JOIN gifts g ON g.id = l.gift_id AND g.org_id = l.org_id JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE ${LIVE} AND l.fund_id = $4 AND g.date >= $2 AND g.date <= $3
            UNION ALL
            SELECT g.amount FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE ${LIVE} AND ${NOT_CREDIT} AND g.fund_id = $4 AND g.date >= $2 AND g.date <= $3
               AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l2 WHERE l2.gift_id = g.id AND l2.org_id = g.org_id)) x`, [orgId, from, to, l.fund_id]);
      const row = ((byFund && byFund.rows) || []).find(r => r.source && r.source.params && r.source.params.fund === l.fund_id);
      const dlg = await get(`/figures/gifts/rows?from=${from}&to=${to}&fund=${l.fund_id}&pageSize=1`);
      agree(`truth4 fund ${l.fund_id} this year`, [["its split lines and whole gifts", Number(whole)], ["Gifts by fund's row", row ? cents(row.total) : 0], ["the row's drill-down", cents(dlg && dlg.value)]], money);
    }
  }

  // ── atRisk ────────────────────────────────────────────────────────────────
  const lostRun = await get("/saved-reports/std:lapsed-24/run").catch(() => null);
  const lost = lostRun && (lostRun.result || lostRun.data || lostRun);
  const sums = await get("/donors/summaries?limit=500");
  if (lost && Array.isArray(lost.rows) && Array.isArray(sums) && sums.length < 500) {
    const ids = lost.rows.map(r => r._pid);
    const truth = ids.length ? (await q(`SELECT COALESCE(SUM(x.c),0)::bigint AS c FROM (
        SELECT (SELECT COALESCE(SUM(ROUND(g.amount*100)),0) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND ${NOT_CREDIT}
                  AND l.last IS NOT NULL AND LEFT(g.date,10) <= l.last AND LEFT(g.date,10) > to_char(l.last::date - INTERVAL '12 months','YYYY-MM-DD')) AS c
          FROM donors d, LATERAL (SELECT LEFT(MAX(g.date),10) AS last FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND ${GIFT}) l
         WHERE d.org_id = $1 AND d.id = ANY($2::text[])) x`, [orgId, ids]))[0].c : 0;
    const tile = sums.filter(d => d.lost && d.reengage).reduce((n, d) => n + cents(d.last_year_giving), 0);
    const total = ((lost.totals && lost.totals.sums) || []).find(s => s.key === "lastYear");
    agree("truth4 money at risk, Lost (last year of giving)", [["each lost person's last twelve giving months", Number(truth)],
      ["Lost & Found's tile", tile], ["the Lost report's total", total ? Number(total.cents) : undefined]], money);
    agree("truth4 Lost people", [["the Lost report", ids.length], ["Lost & Found", sums.filter(d => d.lost && d.reengage).length]]);
  }

  // ── people ────────────────────────────────────────────────────────────────
  const [ev] = await q(`SELECT COUNT(*)::int AS everyone, COUNT(*) FILTER (WHERE COALESCE(TRIM(d.email),'') <> '')::int AS with_email
                          FROM donors d WHERE ${LIVE} AND d.erased_at IS NULL AND d.archived_at IS NULL`, [orgId]);
  const hub = await get("/communications/hub");
  const dir = await get("/donors?limit=1&offset=0&roleCounts=1");
  const roleCounts = dir && dir.roleCounts;
  const everyoneShown = roleCounts && (roleCounts.everyone ?? roleCounts.all);
  const evAud = hub && (hub.audiences || []).find(a => a.mode === "everyone");
  agree("truth4 Everyone", [["the people (not in the trash, archived or erased)", ev.everyone], ["the Directory's Everyone", everyoneShown]]);
  agree("truth4 Everyone with an email", [["Everyone's people with an address", ev.with_email], ["Communications' card", evAud && evAud.inSegment], ["Communications' line", hub && hub.withEmail]]);
  if (evAud && evAud.inSegment > ev.everyone) diffs.push(`truth4 "with email" (${evAud.inSegment}) is above Everyone (${ev.everyone})`);

  // ── starter ───────────────────────────────────────────────────────────────
  const [vt] = await q(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${LIVE} AND d.erased_at IS NULL AND d.archived_at IS NULL
      AND d.person_types @> '["volunteer"]'::jsonb   -- FLOWS-7: a volunteer is the Volunteer type, as the roster and a rule group read it
      AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND ${GIFT})`, [orgId]);
  const st = await get("/groups/starters");
  const vs = ((st && (st.starters || st)) || []).find ? (st.starters || st).find(s => s.key === "volunteers_never_gave") : null;
  const vp = await get("/groups/starters/volunteers_never_gave");
  agree("truth4 volunteers who have never given", [["volunteers with no gift above $0", vt.n], ["the starter's count", vs && vs.count],
    ["the starter's people", vp && Array.isArray(vp.people) ? vp.people.length : (vp && vp.count)]]);
  return { from, to };
}

module.exports = { truth4Pairs };
