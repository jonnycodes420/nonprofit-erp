// server/reports/helpers.js — what more than one reports file reads: the dashboard, the board pack and fundraising figures.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign

function mount(ctx) {
const {
  ACTIVITY_DEFINITIONS, DS, REPORT_HANDLERS, asJson, buntPredicate, computeDriftForDonors,
  computeRetentionRate, dashboardsMod, displayNameCase, figureSources, orgForYears, orgStewardStart, orgTime,
  orgToday, parseCrop, parseReportParams, query, reportYearBounds, runSaved, samePointLastYearSource,
  savedReportFor, sentenceMoney, reportHooks,
} = ctx;
// FIX-7 Part 5 — the one pace function. Pure, no clock of its own.
let PACE = null;
const PACE_READY = import("../../shared/pace.js").then(m => { PACE = m; return m; });

// ══ REPORTS-3 — SAVED DASHBOARDS AND THE BOARD PACK ════════════════════════
//
// The ED stops rebuilding the same report every month, and the board gets the
// same numbers on the same day without anyone exporting anything.
//
// ONE COMPOSITION. composeBoardPack builds the pack as DATA — every number
// with the figure source it was computed from, its definition and its sentence
// — and renderBoardPackPdf draws that data. The screen and the paper read the
// same object, so a number cannot be one thing on one and another on the
// other. Every number in it is a figureSources.js source, which is what makes
// the one test possible: each can be re-asked of /figures/:source/rows and
// footed to the cent against the live report.
let BP = null;
const BP_READY = import("../../shared/boardPack.js").then(m => { BP = m; return m; });
const sentenceCount = n => Number(n || 0).toLocaleString("en-US");
const RECURRING_STATUS_WORDS = {
  active: "Giving", recovered: "Giving again after a failed card", past_due: "Card failing",
  recovering: "Card being retried", paused: "Paused", canceled: "Ended", cancelled: "Ended",
};
const recurringStatusWord = s => RECURRING_STATUS_WORDS[s] || String(s || "Unknown").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

// THE MONTHS OF A FISCAL YEAR, as civil dates: each month's first and last
// day, and the same month `back` years earlier. The Board's line and the
// Fundraising dashboard's month-by-month chart both read this one list.
function fiscalMonths(fyStart, DD, back = 2) {
  const ym = idx => `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, "0")}`;
  const endOf = idx => orgTime.addDays(`${ym(idx + 1)}-01`, -1);
  const c = orgTime.parseCivil(fyStart);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const idx = (c.y * 12 + c.m - 1) + i;
    const mStart = `${ym(idx)}-01`;
    const prior = [];
    for (let k = 1; k <= back; k++) prior.push({ start: `${ym(idx - 12 * k)}-01`, end: endOf(idx - 12 * k) });
    out.push({ month: mStart.slice(0, 7), label: DD.displayMonth(mStart).slice(0, 3), mStart, mEnd: endOf(idx),
               prevMonth: ym(idx - 12), pEnd: prior[0].end, prior });
  }
  return out;
}

// ONE GOAL, AS FIGURES: what has been raised (opening its gifts), the target
// and the share. The Fundraising dashboard's goal rows and Home's annual goal
// bar are both this, so the two screens cannot show the goal two ways.
// LEDGER-1: a goal with goals under it counts their gifts too (the portfolio's
// own `sources`, goal-rollup-raised), as its Fundraising card does; reading the
// leaf source here is how Home said $0 of $180,000 for an umbrella goal whose
// gifts all sit on its children.
const goalSourcesOf = g => (g.sources && g.sources.raised && g.sources.percent) ? g.sources : {
  raised: { key: "goal-raised", params: { campaign: g.id } },
  goal: { key: "campaign-goal", params: { campaign: g.id } },
  percent: { key: "goal-progress", params: { campaign: g.id } },
};
async function goalFigureRow(g, fig) {
  const S = goalSourcesOf(g);
  const [raised, target, pct] = await Promise.all([
    fig(S.raised),
    fig(S.goal || { key: "campaign-goal", params: { campaign: g.id } }),
    fig(S.percent),
  ]);
  // FIX-7 Part 5 — the badge carries the reason it is a badge.
  return { id: g.id, label: g.name, kind: "money", value: raised.value, source: raised.source, pace: g.paceState || null,
    paceSentence: g.paceSentence || null,
    also: [
      { key: "goal", label: "The goal", kind: "money", value: target.value, source: target.source,
        definition: "The target set on this goal's record." },
      { key: "percent", label: "Of the goal", kind: "percent", value: pct.value, source: pct.source,
        definition: "What has been raised toward this goal, as a share of its target." },
    ] };
}

async function computeDashboard(orgId, key, { isTeam = false } = {}) {
  const D = await dashboardsMod();
  const def = D.dashboardByKey(key);
  if (!def) return null;
  const DD = await import("../../shared/displayDate.js");
  // The ORG's year: its timezone and the fiscal start month it chose
  // (orgPeriodBounds reads vocabulary_json), never the July default alone.
  const org = await orgForYears(orgId);
  const today = orgToday(org);                                  // ORG_TZ_SEAM_OK
  const fy = orgTime.orgPeriodBounds(org, "fiscal_year", 0);     // the ORG's year
  const fyPrev = orgTime.orgPeriodBounds(org, "fiscal_year", -1);
  // "The same point last year" — the equivalent stretch, so the comparison is
  // like for like rather than a full year against a part of one. Drawn by the
  // one function the giving summary reads too (FIX-3 E).
  const lastYearSource = samePointLastYearSource(fy.start, fy.end, today);
  const prevSamePoint = lastYearSource.params.to;
  const qtr = orgTime.orgPeriodBounds(org, "quarter", 0);
  const yr = { from: fy.start, to: today };
  const deps = { computeRetentionRate, computeDriftForDonors };
  const values = {}, extra = {};
  // One figure: its value, through its source, and the source it carries.
  const fig = async source => ({ ...(await figureSources.figureValue(orgId, source, deps)), source });
  const put = async (k, source) => { const f = await fig(source); values[k] = f.value; extra[k] = { source, blank: f.blank, blankShort: f.blankShort }; return f; };
  let answer = null;
  const answerFig = (k, f) => ({ figure: { ...D.answerFigure(key, k), value: f.value, source: f.source } });

  if (key === "board") {
    // HARDEN-1: the span Home and Fundraising compare too (numbers.lastYearSpan).
    const span = require("../../numbers").lastYearSpan(fy.start, fy.end, today);
    const cmp = span ? span.differenceSource.params : { ...yr, prevFrom: fyPrev.start, prevTo: prevSamePoint };
    const [oi] = await query("SELECT other_income_enabled, other_income_this_year FROM orgs WHERE id=?", [orgId]);
    // THE DESIGNATIONS THIS YEAR'S GIFTS NAME, each a figure of its own.
    const funds = await query(
      `SELECT f.id, f.name, COALESCE(f.restricted,false) AS restricted
         FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
         LEFT JOIN fin_funds f ON f.id=g.fund_id AND f.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL AND g.date>=? AND g.date<=?
        GROUP BY f.id, f.name, f.restricted`, [orgId, yr.from, yr.to]);
    // THE MONTHS OF THE FISCAL YEAR, this year to today and last year in full.
    const months = fiscalMonths(fy.start, DD, 1);
    const seriesDef = D.dashboardByKey("board").metrics.find(m => m.key === "givingByMonth");
    const [, , , diff, , , , , , desRows, series] = await Promise.all([
      put("revenueThisYear", { key: "gifts", params: yr }),
      put("revenueLastYear", lastYearSource),
      put("revenueChangePct", { key: "giving-change", params: cmp }),
      fig({ key: "giving-difference", params: cmp }),
      put("donorCount", { key: "givers", params: yr }),
      put("retentionRate", { key: "retention", params: {} }),
      put("recurringActive", { key: "recurring", params: { status: "giving" } }),
      put("recurringStopped", { key: "recurring", params: { endedSince: qtr.start } }),
      put("recurringRecovered", { key: "recurring", params: { recoveredSince: qtr.start } }),
      (async () => {
        // Restricted and unrestricted, each with its funds under it. A gift
        // with no fund named is unrestricted, as it always was.
        const out = [];
        for (const restricted of [true, false]) {
          const g = await fig({ key: "gifts", params: { ...yr, restricted } });
          out.push({ label: restricted ? "Restricted" : "Unrestricted", group: true, restricted, kind: "money", value: g.value, source: g.source });
          const mine = funds.filter(f => (f.id ? f.restricted === restricted : !restricted));
          const rows = await Promise.all(mine.map(async f => {
            const v = await fig({ key: "gifts", params: { ...yr, fund: f.id || "none" } });
            return { label: f.id ? f.name : "Unrestricted (no fund)", restricted, kind: "money", value: v.value, source: v.source };
          }));
          out.push(...rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)));
        }
        return out;
      })(),
      Promise.all(months.map(async mo => {
        const thisYear = mo.mStart <= today
          ? await fig({ key: "gifts", params: { from: fy.start, to: mo.mEnd < today ? mo.mEnd : today } }) : null;
        const lastYear = await fig({ key: "gifts", params: { from: fyPrev.start, to: mo.pEnd } });
        const pt = f => f && ({ value: f.value, kind: "money", source: f.source, definition: seriesDef.definition,
          label: `Giving ${DD.displayDate(f.source.params.from)} to ${DD.displayDate(f.source.params.to)}` });
        return { month: mo.month, label: mo.label, thisYear: pt(thisYear), lastYear: pt(lastYear) };
      })),
    ]);
    values.byDesignation = desRows;
    values.givingByMonth = series;
    // Retention with its cohort: who it is measured against, and who stayed.
    const retained = await fig({ key: "retention-retained", params: {} });
    const prior = await fig({ key: "retention-prior", params: {} });
    if (prior.value > 0) {
      extra.retentionRate.also = [
        // TRUTH-3: these sources are the FISCAL year (retentionOf), and say so.
        { key: "retained", label: "Gave again this fiscal year", kind: "count", value: retained.value, source: retained.source,
          definition: "Everyone who gave last fiscal year and has given again this fiscal year." },
        { key: "prior", label: "Gave last fiscal year", kind: "count", value: prior.value, source: prior.source,
          definition: "Everyone who gave last fiscal year: the people retention is measured against." },
      ];
    }
    // BUILD-88a A.6 — the org's other income, ONLY if somebody turned it on
    // and typed one. Its own line, NEVER added to giving.
    if (oi && oi.other_income_enabled && oi.other_income_this_year != null) await put("otherIncomeThisYear", { key: "other-income", params: {} });
    else values.otherIncomeThisYear = undefined;
    // THE ANSWER. Its dollar difference is the two tiles', subtracted in cents.
    const dc = Math.round((diff.value || 0) * 100);
    answer = dc === 0
      ? { parts: [{ text: "We are level with this time last year." }] }
      : { parts: [{ text: "We are " }, answerFig("givingDifference", diff), { text: dc > 0 ? " ahead of this time last year." : " behind this time last year." }] };
  }

  if (key === "fundraising") {
    const grantWin = { from: today, to: orgTime.addDays(today, 90) };
    const [goalsOut, grants, funnel] = await Promise.all([
      fundraisingCampaignRows(orgId).then(fundraisingGoalsPortfolio).catch(() => null),
      query(`SELECT id, funder, program, deadline FROM grants
              WHERE org_id=? AND deadline IS NOT NULL AND deadline <> '' AND deadline >= ? AND deadline <= ?
                AND status NOT IN ('awarded','reporting','active','closed','rejected','declined')
              ORDER BY deadline ASC, id LIMIT 12`, [orgId, grantWin.from, grantWin.to]),
      isTeam ? query(`SELECT COALESCE(stage,'none') AS stage FROM donors
                       WHERE org_id=? AND deleted_at IS NULL AND assigned_to IS NOT NULL
                       GROUP BY 1`, [orgId]) : Promise.resolve([]),
    ]);
    const goals = ((goalsOut?.goals) || []).filter(g => g.active !== false);
    const [pledged] = await Promise.all([
      put("pledgedOutstanding", { key: "pledges-open", params: {} }),
      put("pledgedPaid", { key: "pledge-payments", params: {} }),
      (async () => {
        values.goals = await Promise.all(goals.map(g => goalFigureRow(g, fig)));
      })(),
      // PARITY-1 Part C · GIVING BY LEVEL. General, Mid and Major on the last
      // 12 months (donorStatus.js), among the people who gave in them: what
      // each level gave and how many people it is, both opening the same rows.
      (async () => {
        const levelDef = def.metrics.find(m => m.key === "byGivingLevel");
        values.byGivingLevel = await Promise.all(Object.keys(DS.LEVELS).map(async tag => {
          const base = { tag, today, gave12: true };
          const [sum, count] = await Promise.all([
            fig({ key: "donors-by-status", params: { ...base, measure: "sum" } }),
            fig({ key: "donors-by-status", params: base }),
          ]);
          return { key: tag, label: DS.tagLabel(tag), kind: "money", value: sum.value, source: sum.source,
            definition: levelDef.definition,
            also: [{ key: "count", label: `${DS.tagLabel(tag)} donors`, kind: "count", value: count.value, source: count.source,
              definition: "How many people at this level gave in the last 12 months." }] };
        }));
      })(),
      // PARITY-1 Part C · GIVING EACH MONTH, this fiscal year against the two
      // before it. Each point is that month's gifts and opens them.
      (async () => {
        const mDef = def.metrics.find(m => m.key === "givingEachMonth");
        const months = fiscalMonths(fy.start, DD, 2);
        const pt = f => f && ({ value: f.value, kind: "money", source: f.source, definition: mDef.definition,
          label: `Giving ${DD.displayDate(f.source.params.from)} to ${DD.displayDate(f.source.params.to)}` });
        values.givingEachMonth = await Promise.all(months.map(async mo => {
          const [cur, ly, yb] = await Promise.all([
            mo.mStart <= today ? fig({ key: "gifts", params: { from: mo.mStart, to: mo.mEnd < today ? mo.mEnd : today } }) : null,
            fig({ key: "gifts", params: { from: mo.prior[0].start, to: mo.prior[0].end } }),
            fig({ key: "gifts", params: { from: mo.prior[1].start, to: mo.prior[1].end } }),
          ]);
          return { month: mo.month, label: mo.label, thisYear: pt(cur), lastYear: pt(ly), yearBefore: pt(yb) };
        }));
      })(),
      // PARITY-1 Part C · RETENTION, THREE WAYS. The screen picks one; each is
      // a percentage whose two halves open their people.
      (async () => {
        const w = DS.windowsFor(today);
        const fyWin = { from1: fyPrev.start, to1: fyPrev.end, from0: fy.start, to0: today };
        const rollWin = { from1: w.w1From, to1: w.w1To, from0: w.w0From, to0: today };
        // TRUTH-3 (W-1107-Fundraising-03): "Calendar year" is the calendar year.
        // It read the plain `retention` source, which is the FISCAL year, under a
        // calendar-year label. Each label now reads the window it names.
        const cy = Number(String(today).slice(0, 4));
        const calWin = { from1: `${cy - 1}-01-01`, to1: `${cy - 1}-12-31`, from0: `${cy}-01-01`, to0: today };
        const opt = async (k, label, definition, source, parts) => {
          const f = await fig(source);
          const ps = await Promise.all(parts.map(async ([pk, plabel, pdef, psrc]) => {
            const v = await fig(psrc);
            return { key: pk, label: plabel, kind: "count", value: v.value, source: v.source, definition: pdef };
          }));
          return { key: k, label, kind: "percent", value: f.value, source, blank: f.blank || null, blankShort: f.blankShort || null,
            definition, also: ps };
        };
        values.retentionChoice = await Promise.all([
          opt("calendar", "Calendar year", "Of the people who gave last calendar year, the share who have given again this one.",
            { key: "retention-window", params: calWin }, [
              ["kept", "Gave again this year", "Everyone who gave last calendar year and has given again this one.", { key: "retention-window-kept", params: calWin }],
              ["prior", "Gave last year", "Everyone who gave last calendar year: the people retention is measured against.", { key: "retention-window-prior", params: { from1: calWin.from1, to1: calWin.to1 } }],
            ]),
          opt("fiscal", "Fiscal year", `Of the people who gave last fiscal year (${DD.displayDate(fyPrev.start)} to ${DD.displayDate(fyPrev.end)}), the share who have given again this fiscal year.`,
            { key: "retention-window", params: fyWin }, [
              ["kept", "Gave again this fiscal year", "Everyone who gave last fiscal year and has given again this one.", { key: "retention-window-kept", params: fyWin }],
              ["prior", "Gave last fiscal year", "Everyone who gave last fiscal year: the people retention is measured against.", { key: "retention-window-prior", params: { from1: fyWin.from1, to1: fyWin.to1 } }],
            ]),
          opt("rolling", "Rolling 12 months", "Of the people who gave in the 12 months before the last 12, the share who also gave in the last 12 months.",
            { key: "retention-window", params: rollWin }, [
              ["kept", "Gave in both", "Everyone who gave in the 12 months before the last 12 and gave again in the last 12.", { key: "retention-window-kept", params: rollWin }],
              ["prior", "Gave in the 12 months before", "Everyone who gave in the 12 months before the last 12: the people retention is measured against.", { key: "retention-window-prior", params: { from1: rollWin.from1, to1: rollWin.to1 } }],
            ]),
        ]);
      })(),
      (async () => {
        values.grantDeadlines = await Promise.all(grants.map(async g => {
          const v = await fig({ key: "grant", params: { id: g.id } });
          return { label: `${g.funder}${g.program ? " · " + g.program : ""}`, kind: "money", value: v.value, source: v.source,
                   when: String(g.deadline).slice(0, 10), whenLabel: DD.displayDate(String(g.deadline).slice(0, 10)) };
        }));
      })(),
      (async () => {
        values.pipelineFunnel = isTeam ? await Promise.all(funnel.map(async r => {
          const v = await fig({ key: "pipeline-stage", params: { stage: r.stage } });
          return { label: r.stage === "none" ? "No stage set" : String(r.stage).replace(/_/g, " ").replace(/^./, c => c.toUpperCase()),
                   kind: "count", value: v.value, source: v.source };
        })).then(rows => rows.sort((a, b) => b.value - a.value)) : null;
      })(),
    ]);
    // HOME-3 · THE ANSWER TO ITS OWN QUESTION. "Are we on pace?" used to say
    // "$104,050 is pledged and still to come, and 0 grant deadlines fall in
    // the next ninety days": no pace, and a clause about grants for an org
    // that keeps none. It leads with received since the fiscal year began
    // against the same days last year (numbers.vsLastYear, the number Home
    // and the Board read), then splits the pledges: due this year · over all
    // years. A clause about a feature the org does not use is left out.
    const [vs, dueThisYear, [grantUse]] = await Promise.all([
      require("../../numbers").vsLastYear(orgId, fy.start, fy.end, today),
      fig({ key: "pledges-due", params: { to: fy.end } }),
      query("SELECT EXISTS (SELECT 1 FROM grants WHERE org_id=?) AS used", [orgId]),
    ]);
    // "Pledged and paid $0" beside open pledges read as if nothing was paid:
    // at $0 it is absent (an optional metric), never a zero tile.
    if (!(Number(values.pledgedPaid) > 0)) values.pledgedPaid = undefined;
    const parts = [];
    if (vs) {
      const thisF = { value: vs.thisYear, source: vs.thisSource }, lastF = { value: vs.lastYear, source: vs.lastSource };
      parts.push({ text: "Received since the fiscal year began: " }, answerFig("receivedThisYear", thisF),
        lastF.value > 0 ? { text: ", against " } : { text: "." },
        ...(lastF.value > 0 ? [answerFig("receivedSamePointLastYear", lastF), { text: " by the same day last year." }] : []));
    }
    if (pledged.value > 0) {
      parts.push({ text: (parts.length ? " " : "") + "Pledged and still to come: " }, answerFig("pledgedDueThisYear", dueThisYear),
        { text: " due this year · " }, answerFig("pledgedOutstanding", pledged), { text: " over all years." });
    }
    if (grantUse && grantUse.used) {
      const due = await fig({ key: "grants-due", params: grantWin });
      parts.push({ text: parts.length ? " " : "" }, answerFig("grantDeadlineCount", due),
        { text: due.value === 1 ? " grant deadline falls in the next ninety days." : " grant deadlines fall in the next ninety days." });
    }
    answer = { parts: parts.length ? parts : [{ text: "Nothing has been received or pledged yet this fiscal year." }] };
  }

  if (key === "people") {
    const start = await orgStewardStart(orgId);
    const wk = orgTime.orgPeriodBounds(org, "week", 0);
    const week = { from: wk.start, to: today };
    const [share, carried, topCount, drifting] = await Promise.all([
      fig({ key: "concentration-share", params: yr }),
      fig({ key: "top-givers", params: { ...yr, measure: "sum" } }),
      fig({ key: "top-givers", params: yr }),
      put("driftingAmongTop", { key: "drifting-top", params: yr }),
      put("milestonesThisQuarter", { key: "milestones", params: { since: qtr.start } }),
      // 0.6 — GIFTS NOT YET THANKED. A count, with a start date, and the start
      // date is what makes it honest: an imported file is history.
      put("giftsNotYetThanked", { key: "unthanked", params: { since: start || fy.start } }),
      (async () => {
        // BUILD-88a A.5 — the activity report, from the ONE counter
        // (composeActivityReport reads these same sources). Monday to today in
        // the ORG's timezone, the window the Week in Review email uses.
        const row = async (label, definition, source, money) => {
          const f = await fig(source);
          return { label, value: f.value, kind: money ? "money" : "count", ...(money ? { money: true } : {}), definition, source };
        };
        values.thisWeek = await Promise.all([
          row("Conversations logged", ACTIVITY_DEFINITIONS.conversationsLogged, { key: "conversations", params: week }),
          row("Gifts received", ACTIVITY_DEFINITIONS.giftsReceived, { key: "gifts", params: { ...week, measure: "count" } }),
          row("Given this week", ACTIVITY_DEFINITIONS.giftsReceived, { key: "gifts", params: week }, true),
          row("Thank-yous marked sent", ACTIVITY_DEFINITIONS.thankYousMarkedSent, { key: "thanks-marked", params: week }),
          row("Follow-ups closed by outcome", ACTIVITY_DEFINITIONS.threadsClosedByOutcome, { key: "threads-closed", params: { ...week, kind: "outcome" } }),
          row("Follow-ups dismissed", ACTIVITY_DEFINITIONS.threadsDismissed, { key: "threads-closed", params: { ...week, kind: "dismissed" } }),
        ]);
      })(),
    ]);
    // WHO THEY ARE: the top givers, each opening their own gifts this year.
    const top = await figureSources.figure(orgId, { key: "top-givers", params: yr }, deps, { page: 1, pageSize: 20 });
    values.topDonors = await Promise.all((top.rows || []).map(async r => {
      const v = await fig({ key: "gifts", params: { ...yr, donor: r.donorId } });
      return { label: r.name, id: r.donorId, kind: "money", value: v.value, source: v.source };
    }));
    values.concentration = carried.value > 0
      ? [{ label: "Share of this year's givers who carry 90% of the giving", kind: "percent", value: share.value, source: share.source },
         // Cents, not whole dollars: printed in a board packet beside the
         // year's total, and a rounded one would not add up to it.
         { label: "What those givers gave this year", kind: "money", money: true, value: carried.value, source: carried.source }]
      : [];
    values.stewardStart = start;
    answer = carried.value > 0
      ? { parts: [answerFig("topGiverCount", topCount), { text: topCount.value === 1 ? " person carries" : " people carry" },
                  { text: " ninety per cent of this year's giving, and " }, answerFig("driftingAmongTop", drifting),
                  { text: drifting.value === 1 ? " of them is drifting." : " of them are drifting." }] }
      : { parts: [{ text: "Nobody has given yet this fiscal year, so there is nobody carrying it." }] };
  }

  if (key === "recurring") {
    const statuses = await query(`SELECT DISTINCT status FROM recurring_subscriptions WHERE org_id=?`, [orgId]);
    const month = orgTime.orgPeriodBounds(org, "month", 0);
    const [givers, mrr] = await Promise.all([
      fig({ key: "recurring", params: { status: "giving" } }),
      put("mrr", { key: "recurring-monthly", params: {} }),
      put("mrrTrend", { key: "recurring-change", params: { since: month.start } }),
      put("failuresCaught", { key: "recovery-events", params: { type: "payment_failed", since: qtr.start } }),
      put("failuresRecovered", { key: "recovery-events", params: { type: "payment_recovered", since: qtr.start } }),
      put("avgMonthsOnFile", { key: "recurring-months", params: {} }),
      // BUILD-89S 89f — provider-neutral recurring, counted apart from the
      // subscriptions Steward processes itself, never folded into them.
      put("sourceRecurring", { key: "source-recurring", params: {} }),
      put("sourceRecurringUnconfirmed", { key: "source-recurring", params: { unconfirmed: true } }),
      (async () => {
        values.byStatus = (await Promise.all(statuses.map(async r => {
          const v = await fig({ key: "recurring", params: { status: r.status } });
          return { label: recurringStatusWord(r.status), kind: "count", value: v.value, source: v.source };
        }))).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      })(),
    ]);
    answer = givers.value > 0
      ? { parts: [answerFig("monthlyGivers", givers), { text: givers.value === 1 ? " monthly gift brings in " : " monthly gifts bring in " },
                  answerFig("mrr", mrr), { text: " a month." }] }
      : { parts: [{ text: "No monthly gifts are charging yet, so there is no monthly base to read." }] };
  }

  // EVERY number leaves here WITH its definition and its source. One string,
  // from the registry, to the hover, the panel and the PDF footnote.
  // REPORTS-5: the Board's "same point last year", when Steward has no gifts
  // for it and an old system's report covers exactly that stretch: the old
  // report's number stands in, and the label and sentence say where it is from.
  if (key === "board" && !(values.revenueLastYear > 0) && lastYearSource) {
    const h = await figureSources.historicalGiving(orgId, lastYearSource.params.from, lastYearSource.params.to, { baseline: true });
    if (h) { values.revenueLastYear = h.value; extra.revenueLastYear = { source: h.source, imported: h }; }
  }
  const metrics = def.metrics
    .filter(m => !m.teamOnly || isTeam)
    // A.6 — an OPTIONAL metric with no value is ABSENT, not blank.
    .filter(m => !m.optional || values[m.key] !== undefined)
    .map(m => ({ key: m.key, label: extra[m.key] && extra[m.key].imported ? `${m.label}, from your old system` : m.label, kind: m.kind, rowsAre: m.rowsAre || null,
                 definition: extra[m.key] && extra[m.key].imported ? extra[m.key].imported.note : m.definition,
                 value: values[m.key] === undefined ? null : values[m.key],
                 ...(extra[m.key] ? { source: extra[m.key].source, blank: extra[m.key].blank || null,
                                      blankShort: extra[m.key].blankShort || null } : {}),
                 ...(extra[m.key] && extra[m.key].also ? { also: extra[m.key].also } : {}) }));
  const text = (answer?.parts || []).map(p => p.text != null ? p.text
    : p.figure.kind === "money" ? sentenceMoney(p.figure.value) : sentenceCount(p.figure.value)).join("");
  return { key: def.key, label: def.label, question: def.question, blurb: def.blurb,
           asOf: today, asOfLabel: DD.displayDate(today),
           fiscalYear: { start: fy.start, end: fy.end, label: `${DD.displayDate(fy.start)} to ${DD.displayDate(fy.end)}`,
                        fyLabel: await require("../shared/periodLabel").fyLongLabelOf(fy) }, isTeam,   // POLISH-7: the one name
           answer: { text, parts: answer?.parts || [] },
           // The boundary 0.6's answer turns on, on the payload so a reader can
           // see WHICH date decided the count rather than trusting it.
           ...(values.stewardStart ? { stewardStart: values.stewardStart } : {}),
           metrics };
}

// THE PERIOD A PACK COVERS. Either the dates she chose, or — for a schedule —
// the last COMPLETE month or quarter, through orgPeriodBounds, which is the
// one place a period boundary is decided anywhere in the product. A pack sent
// on the 5th is about the month that finished, never the five days of the one
// running.
async function boardPackWindow(org, opts = {}) {
  const B = await BP_READY;
  const DD = await import("../../shared/displayDate.js");
  if (opts.from && opts.to) {
    return { from: opts.from, to: opts.to, periodKey: `custom:${opts.from}:${opts.to}`, frequency: null,
             label: `${DD.displayDate(opts.from)} to ${DD.displayDate(opts.to)}` };
  }
  const frequency = B.PACK_FREQUENCIES.includes(opts.frequency) ? opts.frequency : "quarterly";
  const b = orgTime.orgPeriodBounds(org, B.PACK_PERIOD[frequency], -1);   // ORG_TZ_SEAM_OK
  const label = frequency === "monthly"
    ? DD.displayMonth(b.start)
    : `${DD.displayMonth(b.start).replace(/ \d{4}$/, "")} to ${DD.displayMonth(b.end)}`;
  return { from: b.start, to: b.end, periodKey: b.key, frequency, label };
}

// A figure, composed: its value through its source, the source it carries, the
// definition the pack declares for it and the sentence figureSources composed
// from the parameters the value was really computed with.
async function packFigure(orgId, def, source, deps, filters) {
  const B = await BP_READY;
  if (!source) {
    return { key: def.key, label: def.label, kind: def.kind, value: null, cents: null,
             definition: def.definition, sentence: null, source: null,
             blank: "There is no earlier year on file to compare this period with, so there is nothing to show yet." };
  }
  const sDef = figureSources.sourceDef(source.key);
  const f = await figureSources.figure(orgId, source, deps, { rows: false });
  if (!f) return null;
  const { ignored } = B.filtersHonoured(sDef && sDef.params, filters);
  return { key: def.key, label: def.label, kind: def.kind, suffix: def.suffix || null,
           value: f.value, cents: f.cents, definition: def.definition, sentence: f.sentence,
           source, blank: f.blank || null, blankShort: f.blankShort || null,
           amountKind: f.amountKind || null, note: B.ignoredFilterSentence(ignored) };
}

// THE ACTIVE GOALS, through the three sources the Fundraising dashboard reads.
// A goal keeps its own period, so these figures do not move with the pack's
// period and the section's definition says so.
async function packGoalRows(orgId, deps) {
  const out = await fundraisingCampaignRows(orgId).then(fundraisingGoalsPortfolio).catch(() => null);
  const goals = ((out && out.goals) || []).filter(g => g.active !== false);
  const fig = async source => ({ ...(await figureSources.figure(orgId, source, deps, { rows: false })), source });
  return Promise.all(goals.map(async g => {
    const S = goalSourcesOf(g);   // LEDGER-1: an umbrella goal counts its children's gifts
    const [raised, target, pct] = await Promise.all([
      fig(S.raised),
      fig(S.goal || { key: "campaign-goal", params: { campaign: g.id } }),
      fig(S.percent),
    ]);
    return { label: g.name, raised: { value: raised.value, cents: raised.cents, source: raised.source, sentence: raised.sentence },
             target: { value: target.value, cents: target.cents, source: target.source, sentence: target.sentence },
             percent: { value: pct.value, source: pct.source, sentence: pct.sentence, blank: pct.blank || null },
             pace: g.paceState || null };
  }));
}

// A TILE ON A SAVED DASHBOARD. The dashboard's filters are authoritative and
// the tile's own saved params are the fallback, so a tile that fixes something
// (a count rather than a sum) keeps it while the dashboard still narrows what
// it can narrow. A filter the tile's source cannot honour is SAID on the tile
// (`note`), never silently dropped under a heading that claims otherwise.
function tileSourceParams(sDef, tileParams, filters, fallbackWindow) {
  const params = {};
  const declared = (sDef && sDef.params) || {};
  for (const name of Object.keys(declared)) {
    if (name === "from") { params.from = filters.from || (tileParams && tileParams.from) || fallbackWindow.from; continue; }
    if (name === "to") { params.to = filters.to || (tileParams && tileParams.to) || fallbackWindow.to; continue; }
    const byFilter = Object.entries({ fund: "fund", campaign: "campaign", owner: "assigned" })
      .find(([, pname]) => pname === name);
    if (byFilter && filters[byFilter[0]]) { params[name] = filters[byFilter[0]]; continue; }
    if (tileParams && tileParams[name] !== undefined) params[name] = tileParams[name];
  }
  return params;
}

// WHAT KIND OF NUMBER A SOURCE PRODUCES. Not every source has a `measure`
// function: a ratio (retention, the change on last year) and a difference (the
// Board's sentence) are computed from their two parts, and the engine never
// asks them for one. Calling `sDef.measure(...)` on a ratio threw, and because
// one tile's crash is the whole composition's crash it took the entire
// dashboard down — a blank screen with a 500 behind it, found by opening the
// seeded dashboard in a browser and not by any server test, because the
// default board pack never puts a tile over a ratio.
function tileFigureKind(sDef, params) {
  if (sDef.ratio) return "percent";
  if (sDef.difference) return "money";
  if (sDef.amountKind && sDef.amountKind !== "money") return "count";
  return typeof sDef.measure === "function" && sDef.measure(params) === "sum" ? "money" : "count";
}

async function composeDashboardTiles(orgId, dash, window, deps, userId) {
  const B = await BP_READY;
  const filters = window.filters || {};
  const sections = [];
  for (const [i, tile] of (dash.tiles || []).entries()) {
    if (tile.kind === "figure") {
      const sDef = figureSources.sourceDef(tile.source);
      if (!sDef) { sections.push({ key: `tile${i}`, kind: "missing", title: "A number Steward no longer has",
        definition: `This tile asks for "${tile.source}", which is not a figure Steward knows any more. Edit the dashboard to replace it.` }); continue; }
      const params = tileSourceParams(sDef, tile.params, filters, window);
      let f;
      try {
        f = await packFigure(orgId, { key: `tile${i}`, label: sDef.label, kind: tileFigureKind(sDef, params),
          suffix: sDef.amountKind && sDef.amountKind !== "money" ? sDef.amountKind : null,
          definition: sDef.label }, { key: tile.source, params }, deps, filters);
      } catch (e) {
        // ONE TILE'S FAILURE COSTS THAT TILE. It used to cost the whole
        // dashboard: a single source that could not be read threw out of the
        // composition and the screen went blank with a 500 behind it. A tile
        // that cannot be drawn says so where it sits, and everything else on
        // the dashboard still draws.
        if (!(e instanceof figureSources.FigureParamError)) console.error("[dashboard-tile]", tile.source, e.message);
        sections.push({ key: `tile${i}`, kind: "missing", title: sDef.label,
          definition: e instanceof figureSources.FigureParamError ? e.message
            : "Steward could not work this number out just now. Everything else on this dashboard is unaffected." });
        continue;
      }
      // The DEFINITION of a tile's number is the source's own sentence: it is
      // the one string that states exactly which rows were counted and over
      // which dates, and it is the string the drill-through shows too.
      sections.push({ key: `tile${i}`, kind: "figures", title: tile.label || sDef.label,
        figures: [{ ...f, ...(tile.label ? { label: tile.label } : {}), definition: f.sentence, kind: f.kind }] });
    } else if (tile.kind === "chart") {
      try {
        const points = await packGivingByMonth(orgId, deps);
        sections.push({ key: `tile${i}`, kind: "chart", title: "Giving this year against last year", points,
          definition: "Giving added up month by month through your fiscal year: this year to today, and last year in full." });
      } catch (e) {
        console.error("[dashboard-tile] chart", e.message);
        sections.push({ key: `tile${i}`, kind: "missing", title: "Giving this year against last year",
          definition: "Steward could not draw this chart just now. Everything else on this dashboard is unaffected." });
      }
    } else if (tile.kind === "list") {
      try {
        const list = await packReportList(orgId, tile.report, tile.limit || 10, userId);
        sections.push({ key: `tile${i}`, kind: "report", title: list.name, columns: list.columns, rows: list.rows,
          totalRows: list.totalRows, definition: list.question || `Every row the report "${list.name}" returns.` });
      } catch (e) {
        console.error("[dashboard-tile] list", tile.report, e.message);
        sections.push({ key: `tile${i}`, kind: "missing", title: "A list Steward could not run",
          definition: "Steward could not run this report just now. Everything else on this dashboard is unaffected." });
      }
    }
  }
  return sections;
}

// THE BOARD'S LINE, for a chart tile: the board dashboard's own series, read
// from the one place it is computed.
async function packGivingByMonth(orgId, deps) {
  const board = await computeDashboard(orgId, "board", { isTeam: false });
  const m = ((board && board.metrics) || []).find(x => x.key === "givingByMonth");
  return Array.isArray(m && m.value) ? m.value : [];
}

// A LIST TILE: a standard or saved report, run through the ONE path that runs
// a report anywhere (savedReportFor + runSaved), so a list on a dashboard is
// the same rows the report tab shows.
// `userId` is WHOSE reports this may read: a private saved report belongs to
// one person, and a dashboard carrying a list tile of it is read as its OWNER
// would read it — on a scheduled send too, where nobody is signed in.
async function packReportList(orgId, reportId, limit, userId) {
  const rep = await savedReportFor(orgId, userId || null, reportId);
  if (!rep) return { name: "A report Steward no longer has", columns: [], rows: [], totalRows: 0,
                     question: `This tile asks for a report ("${reportId}") that is not there any more. Edit the dashboard to replace it.` };
  const out = await runSaved(orgId, rep);
  if (out.errors) return { name: rep.name, columns: [], rows: [], totalRows: 0, question: out.errors.join(" ") };
  return { name: rep.name, question: rep.question || null, columns: out.columns,
           rows: (out.rows || []).slice(0, limit), totalRows: (out.totals && out.totals.count) || (out.rows || []).length };
}

// ── THE ONE COMPOSITION ────────────────────────────────────────────────────
async function composeBoardPack(orgId, opts = {}) {
  const B = await BP_READY;
  const DD = await import("../../shared/displayDate.js");
  const org = await orgForYears(orgId);
  const [row] = await query("SELECT id, name, logo_data FROM orgs WHERE id=?", [orgId]);
  const today = orgToday(org);                                   // ORG_TZ_SEAM_OK
  const w = await boardPackWindow(org, opts);
  const sp = orgTime.samePointLastYear(w.from, w.to, today);
  const filters = {};
  for (const k of ["fund", "campaign", "owner", "group"]) if (opts[k]) filters[k] = String(opts[k]);
  if (opts.from && opts.to) { filters.from = opts.from; filters.to = opts.to; }
  const window = { from: w.from, to: w.to, prev: sp ? { from: sp.from, to: sp.to } : null, filters };
  const deps = { computeRetentionRate, computeDriftForDonors };

  let dashboard = null, sections;
  if (opts.dashboardId) {
    dashboard = await savedDashboardFor(orgId, opts.userId, opts.dashboardId);
    if (!dashboard) return null;
    sections = await composeDashboardTiles(orgId, dashboard, window, deps, dashboard.owner_id || opts.userId || null);
  } else {
    sections = [];
    for (const s of B.PACK_SECTIONS) {
      if (s.kind === "figures") {
        const figures = [];
        for (const def of s.figures) {
          let f = await packFigure(orgId, def, def.source(window), deps, filters);
          // REPORTS-5: last year's stretch with no gifts in Steward, and an old
          // system's report that covers exactly it (and no filter it cannot
          // honour): the old report's number, labelled, never added in.
          if (f && def.key === "givingLastYear" && !(f.value > 0) && window.prev && !Object.values(filters || {}).some(Boolean)) {
            const h = await figureSources.historicalGiving(orgId, window.prev.from, window.prev.to, { baseline: true });
            if (h) f = { ...f, label: `${f.label}, from your old system`, value: h.value, cents: h.cents, source: h.source, sentence: h.note, note: h.note, blank: null, fromHistory: true };
          }
          // NUMBERS-2: when last year is the old system's figure, the change is
          // worked out against that same figure, never against Steward's empty year.
          const lastF = figures.find(x => x && x.key === "givingLastYear");
          const thisF = figures.find(x => x && x.key === "givingThisPeriod");
          if (f && def.key === "givingChangePct" && lastF && lastF.fromHistory && thisF && lastF.cents > 0) {
            const pct = Math.round(((thisF.cents || 0) - lastF.cents) / lastF.cents * 100);
            f = { ...f, value: pct, blank: null, note: "Against the same period last year as your old system reported it." };
          }
          figures.push(f);
        }
        sections.push({ key: s.key, kind: "figures", title: s.title, figures: figures.filter(Boolean) });
      } else if (s.kind === "list") {
        const source = s.source(window);
        const f = await figureSources.figure(orgId, source, deps, { page: 1, pageSize: s.limit });
        sections.push({ key: s.key, kind: "list", title: s.title, definition: s.definition, source,
          rows: f.rows || [], total: f.value, cents: f.cents, totalRows: f.totalRows, sentence: f.sentence, label: f.label });
      } else if (s.kind === "goals") {
        sections.push({ key: s.key, kind: "goals", title: s.title, definition: s.definition, goals: await packGoalRows(orgId, deps) });
      }
    }
  }

  // THE DEFINITIONS PAGE. Every number that got printed, with the sentence
  // that defines it and the sentence that says which rows it counted. A
  // number without both does not reach the page, because the page is the
  // reason a board can read the rest of the pack at all.
  const definitions = [];
  const seen = new Set();
  const addDef = (label, definition, sentence) => {
    const k = `${label}|${definition}`;
    if (!label || !definition || seen.has(k)) return;
    seen.add(k); definitions.push({ label, definition, sentence: sentence || null });
  };
  for (const s of sections) {
    if (s.kind === "figures") for (const f of s.figures) addDef(f.label, f.definition, f.sentence);
    if (s.kind === "list") addDef(s.title, s.definition, s.sentence);
    if (s.kind === "report" || s.kind === "chart" || s.kind === "missing") addDef(s.title, s.definition, null);
    if (s.kind === "goals") {
      addDef(s.title, s.definition, null);
      // POLISH-1 Part 7: one definition for every goal's two numbers, not
      // two near-identical lines per goal (eight goals printed sixteen
      // entries and a page and a half of the same two sentences).
      if (s.goals.length) {
        addDef("Raised toward a goal", "Every gift given to the goal, at the full amount the donor paid, and every grant awarded toward it. Soft and matching credits are not counted.", null);
        addDef("A goal's target", "The target set on the goal's own record.", null);
      }
    }
  }

  return {
    orgId, orgName: displayNameCase(row && row.name || "") || "", logo: row ? row.logo_data : null,
    title: dashboard ? dashboard.name : "Board pack",
    dashboard: dashboard ? { id: dashboard.id, name: dashboard.name } : null,
    period: { from: w.from, to: w.to, label: w.label, key: w.periodKey, frequency: w.frequency },
    comparison: window.prev,
    filters, producedOn: today, producedOnLabel: DD.displayDate(today),
    sections, definitions,
  };
}

// ── SAVED DASHBOARDS ───────────────────────────────────────────────────────
// Private to its owner unless shared with the team, exactly as a saved report
// is. The read is `shared OR mine`; only the owner edits or deletes.
async function savedDashboardFor(orgId, userId, id) {
  const [r] = await query(
    "SELECT * FROM saved_dashboards WHERE id=? AND org_id=? AND (shared = true OR owner_id = ?)",
    [id, orgId, userId || null]);
  if (!r) return null;
  return { ...r, tiles: asJson(r.tiles, []), filters: asJson(r.filters, {}) };
}
// A DATE column comes back as a Date at local midnight; its own calendar day.
const civilDay = d => d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d || "").slice(0, 10);
function computeFundraisingPace(raised, goal, startDate, endDate) {
  const g = parseFloat(goal) || 0;
  const r = parseFloat(raised) || 0;
  // `percent` stays capped at 100 (thermometer bar width). `rawPercent` is the
  // true, UNCAPPED figure so the UI can honestly say "302% · $50k over" instead
  // of a misleading flat 100% when a goal is exceeded. `over` = dollars past goal.
  const percent = g > 0 ? Math.min(100, Math.round((r / g) * 100)) : null;
  const rawPercent = g > 0 ? Math.round((r / g) * 100) : null;
  const over = g > 0 && r > g ? r - g : 0;
  const now = new Date();
  let daysLeft = null, lifecycle = "active";
  if (startDate && new Date(startDate) > now) lifecycle = "upcoming";
  if (endDate) {
    daysLeft = Math.ceil((new Date(endDate) - now) / 86400000);
    if (daysLeft < 0) { lifecycle = "ended"; daysLeft = 0; }
  }
  // ── FIX-7 Part 5 · PACE IS ONE FUNCTION, AND IT SAYS WHY ────────────────
  // shared/pace.js owns the definition (raised share against the share of the
  // campaign's OWN window that has gone) and the ten-point band. This used to
  // be a 2%-of-expected-dollars test living here, and a separate 8-point test
  // living in Dashboard.jsx, which is how two screens said different things
  // about the same money. No start or no deadline: no pace at all — the caller
  // shows raised against goal, which is the honest thing to show.
  let paceState = null, expected = null, paceSentence = null, paceRaisedPct = null, paceElapsedPct = null, paceMath = null;
  const p = PACE && PACE.paceOf({ raised: r, goal: g, start: startDate, end: endDate, today: now.toISOString().slice(0, 10) });
  if (p) {
    paceState = p.state === "on_pace" ? "on_track" : p.state;   // the wire word the screens already read
    paceSentence = p.sentence;
    paceRaisedPct = p.raisedPct;
    paceElapsedPct = p.elapsedPct;
    paceMath = p.math ? p.math.sentence : null;   // LEDGER-2: the projection, with its inputs
    const total = new Date(endDate) - new Date(startDate);
    const elapsed = Math.max(0, Math.min(total, now - new Date(startDate)));
    expected = total > 0 ? g * (elapsed / total) : null;
  } else if (g > 0 && r >= g) {
    paceState = "met";
  }
  // FIX-34: "On pace" beside "$0 of $25,000, 0%" said two things. Nothing
  // counted yet is never on pace; the bar says $0 and no badge rides it.
  if (r <= 0 && (paceState === "on_track" || paceState === "ahead")) { paceState = null; paceSentence = null; }
  // FUNDRAISING-2: a goal that has not started has no pace. It says when it
  // starts, and the card shows what was pledged or given early.
  if (lifecycle === "upcoming") { paceState = null; paceSentence = null; expected = null; paceRaisedPct = null; paceElapsedPct = null; paceMath = null; }
  return { percent, rawPercent, over, daysLeft, lifecycle, paceState, expected,
           paceSentence, paceMath, paceRaisedPct, paceElapsedPct, startsOn: lifecycle === "upcoming" ? civilDay(startDate) : null };
}

// GIFTS-2 · PACE ON COMMITTED, THE BAR ON RAISED. When a goal counts pledges,
// the pace badge compares committed (raised + still owed) with the time gone;
// the bar, the percent and "over" stay money raised, which is what every other
// figure of this goal (goal-progress, Reports) reads.
const PACE_KEYS = ["paceState", "expected", "paceSentence", "paceMath", "paceRaisedPct", "paceElapsedPct"];
function paceWithCommitment(raised, commitment, goal, startDate, endDate) {
  const base = computeFundraisingPace(raised, goal, startDate, endDate);
  if (!commitment || !commitment.countPledges || commitment.paceBasis === raised) return base;
  const on = computeFundraisingPace(commitment.paceBasis, goal, startDate, endDate);
  for (const k of PACE_KEYS) base[k] = on[k];
  if (base.paceSentence) base.paceSentence = base.paceSentence.replace("% raised", "% committed");
  if (base.paceMath) base.paceMath = base.paceMath.replace(" raised by day", " committed by day");
  return base;
}

// Live totals for a set of campaigns, matched the same way
// /campaigns/:id/progress matches: campaign_id OR the legacy campaign-name text
// column. One query per component, grouped, so the list view never N+1s.
//
// Attribution completeness (FIX, 2026-08-04) — what "raised" MEANS here:
//   raised = giftRaised + grantAwarded
//   · giftRaised   = Σ attributed gift PAYMENTS RECEIVED, at the full amount
//     the donor paid (FIX-49: a covered fee is part of the gift; only Finance
//     works in net). Soft and matching credit rows count toward nothing.
//   · grantAwarded = Σ attributed grants' amounts once AWARDED (awarded_at
//     set) — a real capital campaign counts foundation money toward its
//     target. If grant money ALSO arrives as a gift from the foundation
//     donor, attribute ONE of the two, never both (documented, surfaced in
//     the grant UI helper text).
//   · pledged      = Σ attributed OPEN pledges — committed-but-unpaid, a
//     SEPARATE figure. NEVER summed into raised: a pledge's payments arrive
//     as gifts (which inherit the pledge's campaign), so pledge+payments in
//     one number would double-count and a treasurer would catch it.
async function fundraisingCampaignRows(orgId) {
  await PACE_READY;
  const campaigns = await query(
    `SELECT id, name, goal_amount, start_date, end_date, status, type, goal_category, parent_goal_id, created_at, count_pledges,
            donor_facing_name, donor_description, donor_story, hero_image_url, hero_crop, hero_focal_x, hero_focal_y, goal_progress_public, grants_off_public_bar, retired_at
     FROM campaigns WHERE org_id = ? AND goal_amount IS NOT NULL AND goal_amount > 0
     ORDER BY created_at DESC`,
    [orgId]
  );
  if (!campaigns.length) return [];
  const [sums, pledgeSums, grantSums, rollSums, earlySums] = await Promise.all([
    // NUMBERS-1: the one function every campaign total and the checker read.
    require("../../numbers").campaignGiftTotals(query, orgId),
    query(
      `SELECT p.campaign_id AS cid,
              COALESCE(SUM(GREATEST(p.amount - COALESCE(pp.paid,0), 0)), 0) AS pledged,
              COUNT(*) AS pledge_count
         FROM pledges p
         LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
        WHERE p.org_id = ? AND p.campaign_id IS NOT NULL AND p.status = 'open' AND ${NOT_DELETED("p")}
        GROUP BY p.campaign_id`,
      [orgId, orgId]
    ),
    query(
      `SELECT campaign_id AS cid, COALESCE(SUM(amount), 0) AS grant_awarded, COUNT(*) AS grant_count
         FROM grants WHERE org_id = ? AND campaign_id IS NOT NULL AND awarded_at IS NOT NULL
        GROUP BY campaign_id`,
      [orgId]
    ),
    // FIX-49: a parent goal's own gifts plus its children's, each gift once.
    require("../../numbers").goalRollupGiftTotals(query, orgId),
    // FUNDRAISING-2: gifts given to a goal before it starts. They are outside
    // its window, so not in raised; a goal that has not started says them.
    query(
      `SELECT g.campaign_id AS cid, ${require("../../shared/numbers/money").MONEY_SUM("g")} AS early, COUNT(*) FILTER (WHERE g.amount > 0)::int AS n
         FROM gifts g JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
         JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${require("../../shared/numbers/money").MONEY("g")} AND c.start_date IS NOT NULL AND g.date < to_char(c.start_date, 'YYYY-MM-DD')
        GROUP BY g.campaign_id`,
      [orgId]
    ),
  ]);
  const earlyById = Object.fromEntries(earlySums.map(s => [s.cid, parseFloat(s.early) || 0]));
  const byId = Object.fromEntries(sums.map(s => [s.cid, s]));
  const rollById = Object.fromEntries(rollSums.map(s => [s.pid, parseFloat(s.raised) || 0]));
  const pledgeById = Object.fromEntries(pledgeSums.map(s => [s.cid, s]));
  const grantById = Object.fromEntries(grantSums.map(s => [s.cid, s]));
  return campaigns.map(c => {
    const s = byId[c.id] || {};
    const giftRaised = parseFloat(s.raised) || 0;
    const grantAwarded = parseFloat(grantById[c.id]?.grant_awarded) || 0;
    const raised = giftRaised + grantAwarded;
    const pledged = parseFloat(pledgeById[c.id]?.pledged) || 0;
    // GIFTS-2: a campaign counts its pledges toward the goal unless it says not;
    // pace then reads committed (raised + still owed), never a dollar twice.
    const GP = require("../../shared/numbers/goalPledges");
    const commitment = { ...GP.committedOf({ raised, pledged, countPledges: GP.countsPledges("campaign", c.count_pledges) }), goalId: c.id, kind: "campaign", canCount: true };
    const pace = paceWithCommitment(raised, commitment, c.goal_amount, c.start_date, c.end_date);
    return {
      id: c.id,
      name: c.name,
      goalAmount: parseFloat(c.goal_amount) || 0,
      raised,
      giftRaised,
      grantAwarded,
      rollupGiftRaised: rollById[c.id] ?? null,   // FIX-49: own + children's gifts, each once
      grantCount: parseInt(grantById[c.id]?.grant_count, 10) || 0,
      pledged,
      pledgeCount: parseInt(pledgeById[c.id]?.pledge_count, 10) || 0,
      commitment,   // GIFTS-2
      earlyGiven: earlyById[c.id] || 0,
      donorCount: parseInt(s.donor_count, 10) || 0,
      startDate: c.start_date,
      endDate: c.end_date,
      type: c.type,
      goalCategory: GOAL_CATEGORIES.includes(c.goal_category) ? c.goal_category : "project",
      parentGoalId: c.parent_goal_id || null,
      // BUILD-54 §2 — donor-facing content (org-authored; the CRM edit form
      // round-trips these; donor surfaces read them via the portal payloads).
      donorFacingName: c.donor_facing_name || null,
      donorDescription: c.donor_description || null,
      donorStory: Array.isArray(c.donor_story) ? c.donor_story : null,
      heroImageUrl: c.hero_image_url || null,
      heroCrop: parseCrop(c.hero_crop),
      heroFocal: { x: Math.min(1, Math.max(0, Number(c.hero_focal_x ?? 0.5) || 0.5)), y: Math.min(1, Math.max(0, Number(c.hero_focal_y ?? 0.5) || 0.5)) },
      goalProgressPublic: c.goal_progress_public === true,
      grantsOffPublicBar: c.grants_off_public_bar === true,   // FIX-49
      retired: !!c.retired_at,   // FIX-41: kept on every report; the Campaigns list marks it
      ...pace,
    };
  });
}

// BUILD-16 Part 2 — typed, multiple, roll-up goals. A "goal" is a goal'd
// campaign; several run at once, each with its own category (annual/project/
// capital). An overarching goal is a campaign that other campaigns name as
// their parent_goal_id — its progress rolls up its children's live raised. The
// roll-up is a live SUM over the same gift rows (never a stored counter), so it
// can't drift. Returns the goal portfolio + an org-wide roll-up header figure.
const GOAL_CATEGORIES = ["annual", "project", "capital"];
// NUMBERS-1: the checker reads the overview's roll-up through this.
require("../../numbers").screens.fundraisingPortfolio = orgId => fundraisingCampaignRows(orgId).then(fundraisingGoalsPortfolio);
function fundraisingGoalsPortfolio(rows) {
  // rows = fundraisingCampaignRows output.
  // Child raised/goal rolled up onto each parent.
  const childrenByParent = {};
  for (const r of rows) {
    if (r.parentGoalId) (childrenByParent[r.parentGoalId] = childrenByParent[r.parentGoalId] || []).push(r);
  }
  const goals = rows.map(r => {
    const kids = childrenByParent[r.id] || [];
    const isOverarching = kids.length > 0;
    const childRaised = kids.reduce((s, k) => s + k.raised, 0);
    const childGoal = kids.reduce((s, k) => s + k.goalAmount, 0);
    // FIX-49 · An overarching goal totals the gifts given to it directly plus
    // its children's gifts, each gift once (rollupGiftRaised), and its own and
    // its children's awarded grants; a leaf goal shows its own SUM(gifts).
    const rolledRaised = isOverarching
      ? Math.round(((r.rollupGiftRaised ?? (r.giftRaised + kids.reduce((s, k) => s + (k.giftRaised || 0), 0))) + (r.grantAwarded || 0) + kids.reduce((s, k) => s + (k.grantAwarded || 0), 0)) * 100) / 100
      : r.raised;
    const rolled = isOverarching ? computeFundraisingPace(rolledRaised, r.goalAmount, r.startDate, r.endDate) : null;
    return {
      ...r,
      isOverarching,
      childCount: kids.length,
      childRaised, childGoal,
      childIds: kids.map(k => k.id),
      // Pledged rolls up alongside raised but stays a SEPARATE figure —
      // committed-but-unpaid is never summed into a raised number.
      rolledPledged: (r.pledged || 0) + kids.reduce((s, k) => s + (k.pledged || 0), 0),
      rolledRaised,
      rolledPercent: isOverarching ? rolled.percent : r.percent,
      rolledRawPercent: isOverarching ? rolled.rawPercent : r.rawPercent,
      rolledOver: isOverarching ? rolled.over : r.over,
      rolledPaceState: isOverarching ? rolled.paceState : r.paceState,
      rolledPaceSentence: isOverarching ? rolled.paceSentence : r.paceSentence,
      // FIX-27 Part 1: every figure on a campaign card and page opens its rows
      // (figureSources.js), so the list and the page foot to the same rows.
      sources: {
        raised: { key: isOverarching ? "goal-rollup-raised" : "goal-raised", params: { campaign: r.id } },
        goal: { key: "campaign-goal", params: { campaign: r.id } },
        percent: { key: isOverarching ? "goal-rollup-progress" : "goal-progress", params: { campaign: r.id } },
        donors: { key: "campaign-donors", params: { campaign: r.id } },
        pledged: { key: "pledges-open", params: { campaign: r.id } },
        grants: { key: "campaign-grants", params: { campaign: r.id } },
      },
    };
  });
  // Org roll-up header: total raised vs total goal across ACTIVE top-level goals
  // only (a child's raised is already inside its parent's roll-up — counting
  // both would double-count). Top-level = has no parent_goal_id; active = not
  // ended. Computed over the ENRICHED goals (so rolledRaised is present).
  // FUNDRAISING-2: active means running today. A goal that has not started
  // and a goal that has ended are not in the roll-up, and not in its count.
  const topActive = goals.filter(g => !g.parentGoalId && g.lifecycle === "active");
  const totalGoal = topActive.reduce((s, g) => s + g.goalAmount, 0);
  const totalRaised = topActive.reduce((s, g) => s + g.rolledRaised, 0);
  const rollup = topActive.length ? {
    totalRaised, totalGoal,
    percent: totalGoal > 0 ? Math.min(100, Math.round((totalRaised / totalGoal) * 100)) : null,
    rawPercent: totalGoal > 0 ? Math.round((totalRaised / totalGoal) * 100) : null,
    over: totalGoal > 0 && totalRaised > totalGoal ? totalRaised - totalGoal : 0,
    activeGoalCount: topActive.length,
  } : null;
  return { goals: goals.map(g => ({ ...g, isTopLevel: !g.parentGoalId })), rollup };
}
reportHooks.buntPredicate = buntPredicate;
// The year a starter group means by "this year" and "last year": the fiscal
// year the Reports tab and Ask default to, at the org's own fiscal start.
reportHooks.yearWindows = async orgId => {
  const p = parseReportParams({ yearMode: "fiscal" }, await orgForYears(orgId));
  return { cur: reportYearBounds(p.year, p.yearMode, p.fiscalStartMonth), prior: reportYearBounds(p.year - 1, p.yearMode, p.fiscalStartMonth), year: p.year };
};
reportHooks.run = async (orgId, key, q = {}) => REPORT_HANDLERS[key](orgId, parseReportParams(q, await orgForYears(orgId)));   // ORG_TZ_SEAM_OK
return { GOAL_CATEGORIES, composeBoardPack, computeDashboard, computeFundraisingPace, paceWithCommitment, fundraisingCampaignRows, fundraisingGoalsPortfolio, goalFigureRow, savedDashboardFor };
}

module.exports = { mount };
