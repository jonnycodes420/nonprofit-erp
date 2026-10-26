#!/usr/bin/env node
// NUMBERS-1 · EVERY NUMBER ADDS UP, AND WE CAN PROVE IT.
//
// Reads one organisation (or every one) and checks, to the cent, that the
// numbers Steward shows agree with the gifts they come from. It only READS.
// Each rule below is written once, in plain words, with the screens it covers;
// the expected value is worked out here from the gift rows, and the shown
// value is asked of the same function the screen calls (figureSources.js,
// numbers.js), so a disagreement is a screen that would show a wrong number.
//
//   node scripts/check-numbers.js --org org_b72demo          problems, with ids
//   node scripts/check-numbers.js --all --counts             counts only, every org
//
// --counts prints no names, amounts or ids: only "Org: N problems; 2 donors
// where Average disagrees". That is the only form that may leave an org (the
// nightly job and the prod command use it).
//
// As a module: checkOrg(orgId, { screens }) returns { orgId, name, problems,
// checked }, where problems is [{ rule, words, count, examples }]. `screens`
// is optional: the server hands in the Fundraising roll-up so the combined
// goal total is checked on the very function that draws it.
const path = require("path");
process.chdir(path.join(__dirname, ".."));
const { query } = require("../db");
const FS = require("../figureSources");
const NUM = require("../numbers");
const money = require("../money");
const orgTime = require("../orgTime");
const { statementLines } = require("../statementTotals");

const CREDIT = new Set(FS.BOOKKEEPER_EXCLUDED_TYPES);
const c = v => money.toCents(String(v ?? "0")) ?? 0;
const day = v => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v == null ? null : String(v).slice(0, 10));

// THE RULES. `words` is the rule; `screens` is where a broken one would show.
const RULES = {
  "donor-lifetime": { words: "A person's Lifetime equals their imported total (if any) plus their gifts dated after the last day it covers, refunds taken off, at the full amount paid (a fee they covered included). A gift dated on or before that day is inside the imported total and is never counted twice. Soft and matching credit rows are not in it.",
    screens: "profile header, rail, donor list, Ask, the Lifetime drawer" },
  "donor-count-average": { words: "Average gift is the counted gifts (refunds taken off; soft and matching credit rows are not gifts) over how many gifts above zero there are, to the cent.",
    screens: "profile header Average gift, 'of N gifts'" },
  "donor-first-largest-last": { words: "First is their earliest gift above zero, Largest their biggest, and Last gift their most recent, each a real gift on file.",
    screens: "profile header First / Largest, Last gift, the rail" },
  "donor-this-year": { words: "This year is the sum of their gifts dated from the start of the org's fiscal year to today.",
    screens: "profile header This year" },
  "donor-stored": { words: "The totals kept on the person (total_giving, gift_count, first and last gift date, last amount) agree with their gifts and imported total, and no recompute has erased an imported total.",
    screens: "donor list, groups, households, portfolios, Lost & Found, exports, staff emails" },
  "household": { words: "A household's combined giving is the sum of its members' Lifetime, and each member's household soft credit is the combined total less their own.",
    screens: "household panel, profile household total" },
  "soft-credit": { words: "A soft credit is never counted as money: it never adds to anyone's Lifetime, a campaign, a goal or an average, it is never more than the gift it points at, and the profile's Soft credit figure is exactly the credits and credit rows behind it.",
    screens: "profile Soft credit, profile soft credits, reports with soft credit" },
  "campaign": { words: "A campaign's raised is the gifts attributed to it, dated inside its start and end, at the full amount the donor paid (a covered fee included), from people who are not deleted, soft and matching credit rows left out; its donor count is those givers, once each.",
    screens: "Fundraising cards, campaign pages, thermometers, goal drawers" },
  "campaign-window": { words: "No gift dated outside a campaign's start and end counts toward it.",
    screens: "every campaign total" },
  "goal-rollup": { words: "The Fundraising overview's combined goal total equals the sum of its top-level active goals, and a parent goal's raised is its own gifts plus its child goals' gifts, each gift once, plus their awarded grants.",
    screens: "Fundraising overview header, parent goal cards" },
  "goal-period": { words: "An organization goal counts the gifts dated inside its own start and end, the same on Home and Fundraising, from people who are not deleted, soft and matching credits left out.",
    screens: "Home goal banner, Fundraising goal card" },
  "public-bar": { words: "A campaign's public bar is its gifts plus its awarded grants, unless the campaign leaves grants off the public bar.",
    screens: "giving page bar" },
  "fund": { words: "A fund's total equals the gifts designated to it.",
    screens: "Reports by fund, Finance funds" },
  "report-year": { words: "The year's giving in Reports equals the sum of the year's gifts from people who are not deleted.",
    screens: "Reports, board pack, Home this year" },
  "statement": { words: "A year-end statement's total equals that person's real gifts dated in the year; soft and matching credit rows are not on it.",
    screens: "year-end statements, receipts" },
  "removed": { words: "A deleted gift or person counts nowhere: no ledger stamp, soft credit or pledge payment points at a gift that is gone, and a deleted person's gifts are in no total.",
    screens: "Finance ledger, pledges, every total" },
  // FIX-49 · imported history is giving: the tags and "Donor since" read it.
  "donor-since": { words: "A person's first gift (Donor since, and the lifecycle tags) is the earlier of their first gift above zero on file and the first gift the old system told us about; someone who gave in the old system before the last 12 months is never tagged New.",
    screens: "profile roles line (Donor since), lifecycle tags, donor list filters, groups" },
  "foots": { words: "Every number that opens its rows foots to those rows.",
    screens: "every figure drawer" },
};

async function orgToday(orgId) {
  const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
  return orgTime.orgToday(o || {});
}

async function checkOrg(orgId, opts = {}) {
  const problems = {};
  const add = (rule, example) => { (problems[rule] = problems[rule] || []).push(example); };
  const [org] = await query(`SELECT id, name FROM orgs WHERE id = ?`, [orgId]);
  if (!org) throw new Error(`no org ${orgId}`);
  const today = await orgToday(orgId);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  // NUMBERS-2: "This year" on the profile is the org's own fiscal year.
  const [vo] = await query(`SELECT timezone, vocabulary_json FROM orgs WHERE id = ?`, [orgId]);
  const fyStart = orgTime.orgFiscalYearStart(vo || {});

  // The gift rows, once. Everything below is worked out from these.
  const gifts = await query(
    `SELECT g.id, g.donor_id, g.type, g.amount::text AS amount, g.date, g.created_at, g.campaign_id, g.campaign, g.fund_id,
            COALESCE(g.cover_fee_amount, 0)::text AS cover, g.is_sample, g.dispute_status, g.deductible_amount::text AS deductible_amount
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL`, [orgId]);
  const donors = await query(
    `SELECT id, total_giving::text AS total_giving, gift_count, first_gift_date, last_gift_date, last_gift_amount::text AS last_gift_amount,
            created_import_id, household_id, imported_total::text AS imported_total, imported_gift_count,
            imported_first_gift_date, imported_last_gift_date, imported_last_gift_amount::text AS imported_last_gift_amount, imported_through
       FROM donors WHERE org_id = ? AND deleted_at IS NULL`, [orgId]);
  const byDonor = new Map();
  for (const g of gifts) { if (!byDonor.has(g.donor_id)) byDonor.set(g.donor_id, []); byDonor.get(g.donor_id).push(g); }

  // ── one person ────────────────────────────────────────────────────────
  const sample = opts.sample ? new Set(donors.filter(d => byDonor.has(d.id)).slice(0, opts.sample).map(d => d.id)) : null;
  // People are checked side by side, a few at a time, so a small org checks in
  // one round trip's time and a large one does not open a connection per person.
  const one = async d => {
    const gs = byDonor.get(d.id) || [];
    // FIX-49: soft and matching credit rows are not money: not in Lifetime or the count.
    const cash = gs.filter(g => !CREDIT.has(String(g.type || "").trim().toLowerCase()));
    const real = gs.filter(g => c(g.amount) > 0);
    const realCash = cash.filter(g => c(g.amount) > 0);
    const stored = c(d.total_giving);
    // NUMBERS-2: the imported total is its own figure; gifts after the last
    // day it covers are added to it, gifts on or before it are inside it.
    const imp = d.imported_total != null;
    const through = imp ? day(d.imported_through) : null;
    const after = imp && through ? cash.filter(g => day(g.date) > through) : cash;
    const lifetime = (imp ? c(d.imported_total) : 0) + after.reduce((s, g) => s + c(g.amount), 0);
    const latest = [...gs].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : new Date(b.created_at) - new Date(a.created_at) || (b.id > a.id ? 1 : -1)))[0];
    // Stored on the person: exactly what the gifts and the imported figure say.
    if (stored !== lifetime) add("donor-stored", { donor: d.id, what: "total_giving", stored, gifts: lifetime });
    const afterN = after.filter(g => c(g.amount) > 0).length;
    const wantN = (imp ? (d.imported_gift_count != null ? Number(d.imported_gift_count) : realCash.length - afterN) : 0) + afterN;
    const n = Number(d.gift_count) || 0;
    if (n !== wantN) add("donor-stored", { donor: d.id, what: "gift_count", stored: n, gifts: wantN });
    const firstReal = real.map(g => day(g.date)).sort()[0] || null;
    const wantFirst = [firstReal, imp ? day(d.imported_first_gift_date || d.imported_last_gift_date) : null].filter(Boolean).sort()[0] || null;
    if ((day(d.first_gift_date) || null) !== wantFirst) add("donor-stored", { donor: d.id, what: "first_gift_date", stored: day(d.first_gift_date), gifts: wantFirst });
    const impLast = imp ? day(d.imported_last_gift_date) : null;
    const rowLast = latest ? day(latest.date) : null;
    const wantLast = rowLast && (!impLast || rowLast >= impLast) ? rowLast : impLast;
    const wantLastAmt = rowLast && (!impLast || rowLast >= impLast) ? c(latest.amount) : impLast ? c(d.imported_last_gift_amount) : 0;
    if ((day(d.last_gift_date) || null) !== (wantLast || null)) add("donor-stored", { donor: d.id, what: "last_gift_date", stored: day(d.last_gift_date), gifts: wantLast });
    else if (c(d.last_gift_amount) !== wantLastAmt) add("donor-stored", { donor: d.id, what: "last_gift_amount", stored: c(d.last_gift_amount), gifts: wantLastAmt });
    if ((!gs.length && !imp) || (sample && !sample.has(d.id))) return;

    // Shown on the profile: the figure sources the header and drawers read.
    const src = (key, extra = {}) => ({ key, params: { donor: d.id, ...extra } });
    const glance = await NUM.donorGlance(query, orgId, d.id);
    const [lt, last, year] = await Promise.all([
      FS.figureValue(orgId, src("donor-lifetime"), {}),
      FS.figure(orgId, src("donor-last-gift"), {}, { pageSize: 1 }),
      FS.figureValue(orgId, src("donor-gifts-between", { from: fyStart, to: today }), {}),
    ]);
    if (lt.cents !== lifetime) add("donor-lifetime", { donor: d.id, shown: lt.cents, gifts: lifetime });
    // NUMBERS-2: the average is over counted gifts; a soft or matching credit row is not a gift.
    const counted = gs.filter(g => !CREDIT.has(String(g.type || "").trim().toLowerCase()));
    const countedN = counted.filter(g => c(g.amount) > 0).length;
    const avgCents = countedN ? Math.round(counted.reduce((s, g) => s + c(g.amount), 0) / countedN) : null;
    if ((glance.average.count || 0) !== countedN || (countedN && glance.average.cents !== avgCents))
      add("donor-count-average", { donor: d.id, shown: [glance.average.cents, glance.average.count], gifts: [avgCents, countedN] });
    const first = [...real].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))[0];
    const largest = real.reduce((m, g) => (c(g.amount) > m ? c(g.amount) : m), 0);
    if (real.length && (glance.first.cents !== c(first.amount) || day(glance.first.date) !== day(first.date)))
      add("donor-first-largest-last", { donor: d.id, what: "first", shown: glance.first.cents, gifts: c(first.amount) });
    if (real.length && glance.largest.cents !== largest) add("donor-first-largest-last", { donor: d.id, what: "largest", shown: glance.largest.cents, gifts: largest });
    if (latest && (!last.rows[0] || last.rows[0].id !== latest.id)) add("donor-first-largest-last", { donor: d.id, what: "last", shown: last.rows[0] && last.rows[0].id, gifts: latest.id });
    const yearCents = gs.filter(g => g.date >= fyStart && g.date <= today).reduce((s, g) => s + c(g.amount), 0);
    if ((year.totalRows ? year.cents : 0) !== yearCents) add("donor-this-year", { donor: d.id, shown: year.cents, gifts: yearCents });
    // Each of these opens rows that must foot.
    for (const f of await Promise.all(["donor-lifetime", "donor-average-gift"].map(key => FS.footCheck(orgId, src(key), {}))))
      if (f && !f.foots) add("foots", { source: f.key, donor: d.id, value: f.value, rows: f.rowsFoot });
  };
  for (let i = 0; i < donors.length; i += 8) await Promise.all(donors.slice(i, i + 8).map(one));

  // ── imported history in the tags (FIX-49) ───────────────────────────
  {
    const DS = require("../donorStatus");
    const imported = donors.filter(d => d.imported_total != null && (byDonor.get(d.id) || []).some(g => c(g.amount) > 0));
    if (imported.length) {
      const st = DS.statusSql(orgId, today, await DS.cutsFor(orgId));
      const tag = new Map((await query(st.sql, st.args)).map(r => [r.donor_id, r]));
      const w0From = orgTime.addDays(today, -364);
      for (const d of imported) {
        const impFirst = day(d.imported_first_gift_date || d.imported_last_gift_date);
        const t = tag.get(d.id);
        if (!impFirst || !t) continue;
        if (impFirst < w0From && t.lifecycle === "new") add("donor-since", { donor: d.id, what: "lifecycle", shown: "new", importedFirst: impFirst });
        const realFirst = (byDonor.get(d.id) || []).filter(g => c(g.amount) > 0).map(g => day(g.date)).sort()[0];
        const want = [realFirst, impFirst].filter(Boolean).sort()[0];
        if (day(t.first_date) !== want) add("donor-since", { donor: d.id, what: "first", shown: day(t.first_date), want });
      }
    }
  }

  // ── households ───────────────────────────────────────────────────────
  const households = [...new Set(donors.map(d => d.household_id).filter(Boolean))];
  const lifeOf = new Map(donors.map(d => {
    const through = d.imported_total != null ? day(d.imported_through) : null;
    const it = (byDonor.get(d.id) || []).filter(g => (!through || day(g.date) > through) && !CREDIT.has(String(g.type || "").trim().toLowerCase())).reduce((s, g) => s + c(g.amount), 0);
    return [d.id, (d.imported_total != null ? c(d.imported_total) : 0) + it];
  }));
  for (const h of households) {
    const members = donors.filter(d => d.household_id === h);
    const want = members.reduce((s, m) => s + lifeOf.get(m.id), 0);
    const f = await FS.figureValue(orgId, { key: "household-giving", params: { household: h } }, {});
    if ((f.cents || 0) !== want) add("household", { household: h, shown: f.cents, members: want });
    const m = members[0];
    const ex = await FS.figureValue(orgId, { key: "household-giving", params: { household: h, except: m.id } }, {});
    if ((ex.cents || 0) !== want - lifeOf.get(m.id)) add("household", { household: h, what: "soft credit", donor: m.id, shown: ex.cents, want: want - lifeOf.get(m.id) });
  }

  // ── soft credits ─────────────────────────────────────────────────────
  const scBad = await query(
    `SELECT sc.id FROM gift_soft_credits sc LEFT JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
      WHERE sc.org_id = ? AND (g.id IS NULL OR sc.amount > g.amount OR sc.donor_id = g.donor_id)`, [orgId]);
  for (const r of scBad) add("soft-credit", { softCredit: r.id });
  // FIX-49: the profile's Soft credit figure is the credits and credit rows behind it.
  const scSum = await query(`SELECT sc.donor_id, SUM(sc.amount)::text AS t FROM gift_soft_credits sc JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id
                               WHERE sc.org_id = ? AND d.deleted_at IS NULL GROUP BY sc.donor_id`, [orgId]);
  const scWant = new Map(scSum.map(r => [r.donor_id, c(r.t)]));
  for (const g of gifts) if (CREDIT.has(String(g.type || "").trim().toLowerCase())) scWant.set(g.donor_id, (scWant.get(g.donor_id) || 0) + c(g.amount));
  for (const [donorId, want] of scWant) {
    if (sample && !sample.has(donorId)) continue;
    const f = await FS.figureValue(orgId, { key: "donor-soft-credit", params: { donor: donorId } }, {});
    if ((f.totalRows ? f.cents : 0) !== want) add("soft-credit", { donor: donorId, what: "figure", shown: f.cents, want });
  }

  // ── campaigns ────────────────────────────────────────────────────────
  const camps = await query(`SELECT id, name, start_date, end_date, goal_amount, parent_goal_id, grants_off_public_bar FROM campaigns WHERE org_id = ?`, [orgId]);
  const shownCamp = new Map((await NUM.campaignGiftTotals(query, orgId)).map(r => [r.cid, r]));
  const grants = await query(`SELECT campaign_id, COALESCE(SUM(amount),0)::text AS t FROM grants WHERE org_id = ? AND campaign_id IS NOT NULL AND awarded_at IS NOT NULL GROUP BY campaign_id`, [orgId]);
  const grantOf = new Map(grants.map(r => [r.campaign_id, c(r.t)]));
  for (const k of camps) {
    const attributed = gifts.filter(g => (g.campaign_id === k.id || (!g.campaign_id && g.campaign && g.campaign === k.name))
      && !CREDIT.has(String(g.type || "").trim().toLowerCase()));   // FIX-49: credits count toward no campaign
    const counted = attributed.filter(g => NUM.inWindow(g.date, k.start_date, k.end_date));
    const want = counted.reduce((s, g) => s + c(g.amount), 0);   // FIX-49: the full gift, a covered fee included
    const wantDonors = new Set(counted.map(g => g.donor_id)).size;
    const outside = attributed.length - counted.length;
    if (Number(k.goal_amount) > 0) {
      const s = shownCamp.get(k.id) || {};
      if (c(s.raised) !== want || (Number(s.donor_count) || 0) !== wantDonors) add("campaign", { campaign: k.id, shown: [c(s.raised), Number(s.donor_count) || 0], gifts: [want, wantDonors] });
      const f = await FS.figureValue(orgId, { key: "goal-raised", params: { campaign: k.id } }, {});
      if ((f.cents || 0) !== want + (grantOf.get(k.id) || 0)) add("campaign", { campaign: k.id, what: "drawer", shown: f.cents, gifts: want + (grantOf.get(k.id) || 0) });
      const ft = await FS.footCheck(orgId, { key: "goal-raised", params: { campaign: k.id } }, {});
      if (ft && !ft.foots) add("foots", { source: "goal-raised", campaign: k.id });
      // The total took in the gifts dated outside the window.
      const withOutside = attributed.reduce((x, g) => x + c(g.amount), 0);
      if (outside && c(s.raised) !== want && c(s.raised) === withOutside) add("campaign-window", { campaign: k.id, gifts: outside });
    }
    if (outside) (problems._outside = problems._outside || []).push({ campaign: k.id, gifts: outside });
    // FIX-49: the public bar adds awarded grants unless the campaign leaves them off.
    const bar = await NUM.publicBarRaised(query, orgId, k.id);
    const wantBar = want + (k.grants_off_public_bar ? 0 : (grantOf.get(k.id) || 0));
    if (c(bar) !== wantBar) add("public-bar", { campaign: k.id, shown: c(bar), want: wantBar });
  }
  // FIX-49: what each goal'd campaign counts, for the parent roll-up below.
  const giftIdsOf = new Map(camps.map(k => [k.id, new Set(gifts.filter(g => (g.campaign_id === k.id || (!g.campaign_id && g.campaign && g.campaign === k.name))
    && !CREDIT.has(String(g.type || "").trim().toLowerCase()) && NUM.inWindow(g.date, k.start_date, k.end_date)).map(g => g.id))]));
  const giftById = new Map(gifts.map(g => [g.id, g]));

  // ── the Fundraising overview's combined goal ─────────────────────────
  if (opts.screens && opts.screens.fundraisingPortfolio) {
    const p = await opts.screens.fundraisingPortfolio(orgId);
    if (p && p.rollup) {
      const top = p.goals.filter(g => !g.parentGoalId && g.lifecycle !== "ended");
      const want = top.reduce((s, g) => s + c(g.rolledRaised), 0);
      const wantGoal = top.reduce((s, g) => s + c(g.goalAmount), 0);
      if (c(p.rollup.totalRaised) !== want || c(p.rollup.totalGoal) !== wantGoal) add("goal-rollup", { shown: [c(p.rollup.totalRaised), c(p.rollup.totalGoal)], goals: [want, wantGoal] });
      // FIX-49: a parent is its own gifts plus its children's, each gift once, plus their grants.
      for (const g of p.goals.filter(x => x.isOverarching)) {
        const kids = p.goals.filter(x => x.parentGoalId === g.id);
        const ids = new Set([g.id, ...kids.map(k => k.id)].flatMap(id => [...(giftIdsOf.get(id) || [])]));
        const want = [...ids].reduce((s, id) => s + c(giftById.get(id).amount), 0)
          + [g.id, ...kids.map(k => k.id)].reduce((s, id) => s + (grantOf.get(id) || 0), 0);
        if (c(g.rolledRaised) !== want) add("goal-rollup", { goal: g.id, shown: c(g.rolledRaised), want });
      }
    }
  }

  // ── FIX-49: an organization goal reads its own start and end ──────────
  if (opts.screens && opts.screens.orgGoalRaised) {
    const goals = await query(`SELECT * FROM fundraising_goals WHERE org_id = ? AND goal_type <> 'lapsed_recovery'`, [orgId]);
    for (const gl of goals) {
      const want = gifts.filter(g => day(g.date) >= gl.period_start && day(g.date) <= gl.period_end && !CREDIT.has(String(g.type || "").trim().toLowerCase()))
        .reduce((s, g) => s + c(g.amount), 0);
      const shown = c(await opts.screens.orgGoalRaised(orgId, gl));
      if (shown !== want) add("goal-period", { goal: gl.id, shown, gifts: want });
    }
  }

  // ── funds, the year, statements ──────────────────────────────────────
  const funds = await query(`SELECT id FROM fin_funds WHERE org_id = ?`, [orgId]);
  for (const f of funds) {
    const want = gifts.filter(g => g.fund_id === f.id && g.date >= yearStart && g.date <= today).reduce((s, g) => s + c(g.amount), 0);
    const v = await FS.figureValue(orgId, { key: "gifts", params: { from: yearStart, to: today, fund: f.id } }, {});
    if ((v.totalRows ? v.cents : 0) !== want) add("fund", { fund: f.id, shown: v.cents, gifts: want });
  }
  {
    const want = gifts.filter(g => g.date >= yearStart && g.date <= today).reduce((s, g) => s + c(g.amount), 0);
    const v = await FS.figureValue(orgId, { key: "gifts", params: { from: yearStart, to: today } }, {});
    if ((v.totalRows ? v.cents : 0) !== want) add("report-year", { shown: v.cents, gifts: want });
    const ft = await FS.footCheck(orgId, { key: "gifts", params: { from: yearStart, to: today } }, {});
    if (ft && !ft.foots) add("foots", { source: "gifts", year: today.slice(0, 4) });
  }
  {
    const last = String(Number(today.slice(0, 4)) - 1);
    for (const [donorId, gs] of byDonor) {
      if (sample && !sample.has(donorId)) continue;
      const inYear = gs.filter(g => String(g.date).slice(0, 4) === last);
      if (!inYear.length) continue;
      const want = inYear.filter(g => g.is_sample !== true && String(g.dispute_status || "") !== "lost" && !CREDIT.has(String(g.type || "").trim().toLowerCase())).reduce((s, g) => s + c(g.amount), 0);
      if (statementLines(inYear, { year: true }).totalCents !== want) add("statement", { donor: donorId, year: last });
    }
  }

  // ── what was removed counts nowhere ──────────────────────────────────
  const orphans = await query(
    `SELECT 'ledger' AS what, t.id FROM fin_transactions t WHERE t.org_id = ? AND t.gift_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = t.gift_id AND g.org_id = t.org_id)
     UNION ALL
     SELECT 'pledge', p.id FROM pledges p WHERE p.org_id = ? AND p.fulfilled_gift_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = p.fulfilled_gift_id AND g.org_id = p.org_id)`, [orgId, orgId]);
  for (const r of orphans) add("removed", { what: r.what, id: r.id });
  // A deleted person's gifts in a total are caught above: every expected
  // value is worked out from the gifts of people who are not deleted.

  const outside = problems._outside || [];
  delete problems._outside;
  return {
    orgId, name: org.name,
    problems: Object.entries(problems).map(([rule, ex]) => ({ rule, words: RULES[rule].words, screens: RULES[rule].screens, count: ex.length, examples: ex.slice(0, 5) })),
    checked: { donors: donors.length, gifts: gifts.length, campaigns: camps.length, households: households.length },
    giftsOutsideCampaignDates: outside.reduce((s, o) => s + o.gifts, 0),
  };
}

// "2 donors where Average disagrees": the count line, with no data in it.
const UNIT = { "donor-lifetime": "donors where Lifetime disagrees", "donor-count-average": "donors where Average or the gift count disagrees",
  "donor-first-largest-last": "donors where First, Largest or Last gift disagrees", "donor-this-year": "donors where This year disagrees",
  "donor-stored": "stored donor totals that disagree", household: "households that disagree", "soft-credit": "soft credits that break the rule",
  campaign: "campaign totals that disagree", "campaign-window": "campaigns counting gifts outside their dates", "goal-rollup": "goal roll-ups that disagree",
  fund: "fund totals that disagree", "report-year": "year totals that disagree", statement: "statements that disagree",
  removed: "rows pointing at removed gifts", foots: "figures that do not foot",
  "donor-since": "people whose imported history is missing from Donor since or the lifecycle tags" };
function countLine(r) {
  const n = r.problems.reduce((s, p) => s + p.count, 0);
  if (!n) return `${r.name}: 0 problems`;
  return `${r.name}: ${n} problem${n === 1 ? "" : "s"}; ` + r.problems.map(p => `${p.count} ${UNIT[p.rule]}`).join("; ");
}

async function main() {
  const args = process.argv.slice(2);
  const flag = k => args.includes(k);
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const orgs = flag("--all") ? (await query(`SELECT id FROM orgs ORDER BY id`)).map(r => r.id) : [val("--org")].filter(Boolean);
  if (!orgs.length) { console.error("usage: node scripts/check-numbers.js --org <org id> | --all [--counts] [--sample N]"); process.exit(2); }
  let bad = 0;
  for (const id of orgs) {
    const r = await checkOrg(id, { sample: Number(val("--sample")) || 0 });
    bad += r.problems.length;
    if (flag("--counts")) { console.log(countLine(r)); continue; }
    console.log(`${r.name} (${id}): ${JSON.stringify(r.checked)}, ${r.giftsOutsideCampaignDates} gift(s) attributed outside a campaign's dates`);
    for (const p of r.problems) console.log(`  FAIL ${p.rule} x${p.count}: ${p.words}\n       screens: ${p.screens}\n       e.g. ${JSON.stringify(p.examples)}`);
    if (!r.problems.length) console.log("  every rule holds");
  }
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { RULES, checkOrg, countLine };
