// server/reports/fundraising.js — fundraising, the annual fund, goals, metrics and drift.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const SCHED_DUE = require("../../shared/numbers/scheduled").DUE;   // TRUTH-6: a scheduled gift counts on its date
const express = require("express");
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { NOT_CREDIT } = require("../../creditTypes");   // FIX-49: soft and matching credits are not money
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../../orgSummary");
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule
const { sql } = require("../db/sql");   // REDTEAM-2: SQL text only from the code
const GOAL_TABLES = { goal: "fundraising_goals", campaign: "campaigns" };   // REDTEAM-2: the tables a goal's setting lives in

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  FISCAL_READY, GOAL_CATEGORIES, actor, checkThemeImageDimensions, checkWriteAccess, computeDriftForDonors,
  computeFirstTouchDelay, computeFundraisingPace, paceWithCommitment, computeRetentionRate, computeStewardshipDebt, driftEngine,
  figureSources, fundraisingCampaignRows, fundraisingGoalsPortfolio, importHealth, normalizeUploadImage,
  openThreadTx, orgForYears, orgTakesGifts, orgTime, orgToday, orgTz, parseCrop, pruneCampaignAssets,
  putThemeAsset, query, recordAssetPointerHistory, requireAdmin, requireAuth, run, snapshotMetricsForOrg,
  threadShapeMod, toCents, toDollars, uploadImageError, uuid, validateStoryBlocks, weekBounds,
  withAdvisoryLock, withTransaction, wrap,
} = ctx;
// FIX-7 Part 5 — the one pace function. Pure, no clock of its own.
let PACE = null;
const PACE_READY = import("../../shared/pace.js").then(m => { PACE = m; return m; });
let app = routers.r1;

// ── BUILD-76 Part 2 — the Drifting surface ─────────────────────────────────
// The list the product is named for. High confidence only by default
// (?includeMedium=1 opts in, and every row carries its labelled confidence —
// a medium flag is NEVER presented as high); ranked by value at risk,
// descending; capped at DRIFT.HOME_LIST_CAP (?all=1 lifts the cap for the
// see-all view). Rows already handled (a meaningful contact inside the
// snooze window) are filtered from the LIST but stay in the headline —
// the money is still at risk until a gift lands.
app.get("/drift", requireAuth, OS.cached("drift"), wrap(async (req, res) => {
  const { orgId } = req.user;
  const includeMedium = req.query.includeMedium === "1" || req.query.includeMedium === "true";
  const uncapped = req.query.all === "1" || req.query.all === "true";
  // SCALE-1: the reads below that do not depend on the drift map start now
  // and run beside it (one parallel batch instead of five serial trips).
  const pEng = query(`SELECT donor_id, engagement, band FROM donor_scores WHERE org_id = ?`, [orgId]);
  const pInstitutional = query(
    `SELECT id, name, kind, funder_type, donor_type, total_giving, last_gift_date, gift_count FROM donors
      WHERE org_id = ? AND deleted_at IS NULL AND kind = 'organisation' AND COALESCE(gift_count,0) > 0
      ORDER BY total_giving DESC NULLS LAST LIMIT 50`, [orgId]);
  const pImportHealth = importHealth(orgId);
  // BUILD-79 Part 6 — "1,111 giving patterns checked" was once said about an
  // org with ZERO gifts; zero patterns were checked. The chip's honest count.
  const pGifted = query(
    "SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL AND COALESCE(gift_count,0) > 0", [orgId]);
  for (const p of [pEng, pInstitutional, pImportHealth, pGifted]) p.catch(() => {});   // awaited below; never unhandled
  const { map, today } = await computeDriftForDonors(orgId);
  const giftedDonorCount = (await pGifted)[0].n;

  const drifting = [...map.values()].filter(a => a.state === "drifting");
  const high = drifting.filter(a => a.confidence === "high");
  const medium = drifting.filter(a => a.confidence === "medium");
  const lapsed = [...map.values()].filter(a => a.state === "lapsed");
  // POLISH-1 Part 6 — the count can move at midnight with nothing new: each
  // person who crossed into (or out of) "past their own pattern" since
  // yesterday, by name, from the same map (computeDriftForDonors reads the
  // same gifts as of yesterday). Home says who, so a 7 becoming an 8 is a
  // name, not a mystery.
  const isHigh = a => a.state === "drifting" && a.confidence === "high";
  const sinceYesterday = {
    crossed: [...map.values()].filter(a => isHigh(a) && a.wasDriftingHigh === false)
      .map(a => ({ donorId: a.donorId, donorName: a.donorName, reason: a.reason || null })),
    left: [...map.values()].filter(a => a.wasDriftingHigh === true && !isHigh(a))
      .map(a => ({ donorId: a.donorId, donorName: a.donorName, now: a.state === "lapsed" ? "lapsed" : "back on pattern" })),
  };

  // BUILD-76 follow-up — a zero that shows its work. The empty state must
  // name what was checked and who was excluded and why, or a healthy file
  // and a silently failed import read identically. Tallied from the same
  // map every other figure reads.
  const excludedTally = { singleGift: 0, activeRecurring: 0, deceased: 0, doNotContact: 0, doNotSolicit: 0, pledgeCadence: 0, unlinkedSustainer: 0, organisation: 0 };
  let onPattern = 0;
  for (const a of map.values()) {
    if (a.state === "excluded") {
      if (a.excludedReason === "organisation") excludedTally.organisation++;
      else if (a.excludedReason === "deceased") excludedTally.deceased++;
      else if (a.excludedReason === "do_not_contact") excludedTally.doNotContact++;
      else if (a.excludedReason === "do_not_solicit") excludedTally.doNotSolicit++;
      else if (a.excludedReason === "active_recurring") excludedTally.activeRecurring++;
      else if (a.excludedReason === "unlinked_sustainer") excludedTally.unlinkedSustainer++;
      else if (a.excludedReason === "pledge_cadence") excludedTally.pledgeCadence++;
    } else if (a.state === "not_eligible") excludedTally.singleGift++;
    else if (a.state === "ok") onPattern++;
  }

  // The headline: dollars at risk from drift, in this organisation's own
  // file — the same sentence the landing page makes. High confidence only:
  // a number that includes guesses is not a number a director repeats.
  // BUILD-83 Parts 3.3 + 4 — AT RISK IS THE NEXT GIFT. The headline is the sum
  // of each drifting donor's USUAL gift (the amount their own sentence names),
  // not their trailing-24-month total and never their lifetime. The list is
  // sorted by that same figure, so what ranks a row is what the row displays.
  const atRiskAmount = toDollars(high.reduce((s, a) => s + toCents(a.usualGift || 0), 0));

  // ENGAGE-1 — ENGAGEMENT IS ONE INPUT TO THE EARLY SIGNS. A medium-confidence
  // drift (an early sign) is stronger when the person has also gone quiet
  // (engagement Distant), and the row says so; and the list can be put in
  // engagement order (?sort=engagement, closest first: who is likeliest to
  // pick up). The default order is unchanged: the usual gift at risk.
  const engRows = await pEng;
  const engMap = new Map(engRows.map(r => [r.donor_id, r]));
  const byEngagement = req.query.sort === "engagement";
  const surfaced = (includeMedium ? drifting : high)
    .filter(a => !a.handled)
    .sort(byEngagement
      ? (x, y) => ((engMap.get(y.donorId) || {}).engagement || 0) - ((engMap.get(x.donorId) || {}).engagement || 0) || (y.usualGift || 0) - (x.usualGift || 0)
      : (x, y) => (y.usualGift || 0) - (x.usualGift || 0));
  const cap = driftEngine.DRIFT.HOME_LIST_CAP;
  // FIX-33 · "Meeting set for 16 Oct" on a drifting row, so nobody calls her twice.
  const meetingSet = await require("../../meetingEffects").meetingSetFor(orgId, drifting.map(a => a.donorId)).catch(() => new Map());
  const row = a => ({
    meetingSet: meetingSet.get(a.donorId)?.sentence || null,
    donorId: a.donorId, donorName: a.donorName, reason: a.reason,
    confidence: a.confidence, valueAtRisk: a.valueAtRisk,
    usualGift: a.usualGift || 0,          // the labelled "at risk" figure on the row
    kind: a.kind || null, contactName: a.contactName || null,
    lastGiftDate: a.lastGiftDate, assignedTo: a.assignedTo, assignedToName: a.assignedToName,
    basis: a.basis, seasonal: !!a.seasonal,
    engagement: engMap.has(a.donorId) ? engMap.get(a.donorId).engagement : null,
    engagementBand: engMap.has(a.donorId) ? engMap.get(a.donorId).band : null,
    earlySign: a.confidence === "medium" && engMap.has(a.donorId) && engMap.get(a.donorId).band === "distant"
      ? "Their giving has slipped and they have gone quiet too: engagement is Distant." : null,
  });
  // BUILD-80 Part 7 — "Institutional giving": organisations get their own
  // list with grant-cycle language, never a Re-engage button.
  // FIX-1 — each row says what that organisation gave: a grant from a
  // foundation or DAF, a gift from anyone else (shared/institutional.js), and
  // the date as it reads, computed once here for Home to print.
  const INST = await import("../../shared/institutional.js");
  const institutional = (await pInstitutional)
    .map(r => ({ donorId: r.id, name: r.name, totalGiving: r.total_giving, lastGiftDate: r.last_gift_date, giftCount: r.gift_count,
                 lastWord: INST.lastGiftWord(r), lastGiftLabel: INST.shortCivilDate(r.last_gift_date) }));

  const { caveat: importCaveat } = await pImportHealth;
  res.json({
    today,
    institutional,
    importCaveat,
    atRiskAmount,
    atRiskBasis: "usualGift",   // BUILD-83 Part 3.3 — the next gift, not the lifetime
    counts: {
      driftingHigh: high.length,
      driftingMedium: medium.length,
      handled: drifting.filter(a => a.handled).length,
      lapsed: lapsed.length,
    },
    evaluated: map.size,          // every non-deleted donor the computation looked at
    giftedDonorCount,             // BUILD-79 Part 6 — donors with ≥1 gift: the only count "patterns checked" may claim
    onPattern,                    // inside their own pattern (state 'ok')
    excluded: excludedTally,      // and exactly why the rest can never drift
    // BUILD-83 Part 3.3 — the funnel's "Lapsed, window closed" keeps its COUNT
    // and loses its dollars: lifetime giving of people who stopped is history,
    // not risk. Kept on the payload as null so a stale client renders nothing.
    lapsedAmount: null,
    cap,
    sinceYesterday,
    total: surfaced.length,
    list: (uncapped ? surfaced : surfaced.slice(0, cap)).map(row),
  });
}));

// BUILD-76 Part 4 — logging as a byproduct. Marking a drift row done asks for
// ONE line, in the flow; Skip is one keypress. BOTH record the interaction —
// the call happened either way, which is what makes the donor record read
// "you called her three weeks ago" and stops the list resurfacing them
// (HANDLED_SNOOZE_DAYS). A skip is recorded as metadata.skipped, never as
// nothing — that is what lets log_capture_rate be measured honestly.
app.post("/drift/:donorId/done", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const donorRows = await query("SELECT id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.donorId, orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });

  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const skipped = note === "";
  const type = ["call", "meeting", "email", "stewardship"].includes(req.body?.type) ? req.body.type : "call";
  const userRow = await query("SELECT name FROM users WHERE id=?", [userId]);
  const org = await orgTz(orgId);
  const todayStr = orgToday(org);                           // ORG_TZ_SEAM_OK
  // Idempotent under a double-tap: ONE drift-done per (donor, org-local day,
  // actor) — the second Save neither duplicates the interaction nor
  // half-clears. Advisory lock because this is a check-then-insert (the
  // BUILD-27 primitive; a unique constraint on a JSONB marker is the wrong
  // tool). A retap that DOES carry a line upgrades the skip in place.
  const result = await withAdvisoryLock(`driftdone:${orgId}:${req.params.donorId}:${userId}:${todayStr}`, async () => {
    const existing = await query(
      `SELECT id FROM interactions WHERE org_id = ? AND donor_id = ? AND created_by = ?
         AND date = ? AND metadata->>'via' = 'drift_done'`,
      [orgId, req.params.donorId, userId, todayStr]);
    if (existing.length) {
      if (!skipped) await run("UPDATE interactions SET note = ?, metadata = jsonb_set(metadata, '{skipped}', 'false') WHERE id = ?",
        [note, existing[0].id]);
      return { id: existing[0].id, deduped: true, status: 200 };
    }
    const id = newId("int");
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, orgId, req.params.donorId, type, note, todayStr, userId,
       userRow[0]?.name || "", JSON.stringify({ via: "drift_done", skipped })]
    );
    return { id, skipped, status: 201 };
  });

  // BUILD-81 — marking a drift item done WITH a logged line opens a thread:
  // this is BUILD-76's byproduct logging, unchanged, now visibly the point.
  // The next-step prompt runs in the same flow; {skipped:true} is recorded as
  // skipped on the interaction (never as nothing), an explicit {type,due} is
  // the user's decision, and an absent nextStep takes the call default
  // (the call default, or whatever the line itself asks for) — the drift row
  // was a call to make.
  let thread = null;
  if (!skipped) {
    const shape = await threadShapeMod();
    const ns = req.body?.nextStep;
    if (ns && ns.skipped === true) {
      await run("UPDATE interactions SET metadata = jsonb_set(metadata, '{next_step}', '\"skipped\"') WHERE id = ?", [result.id]);
    } else {
      let step = null;
      if (ns && shape.nextStepLabelFor(ns.type) && /^\d{4}-\d{2}-\d{2}$/.test(String(ns.due || ""))) {
        step = { type: ns.type, label: shape.sanitizeStepLabel(ns.label) || shape.nextStepLabelFor(ns.type), due: ns.due };
      } else {
        // The drift line IS a note: if it names an ask or a promise, that is
        // the next step — same precedence as the log flow.
        const s = shape.nextStepSuggestion("call_reached", todayStr, note);
        step = { type: s.type, label: s.label, due: s.due };
      }
      const [dRow] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ?", [req.params.donorId, orgId]);
      thread = await withTransaction(client => openThreadTx(client, {
        orgId, donorId: req.params.donorId, step, openedOn: todayStr,
        ownerId: dRow?.assigned_to || userId, ownerName: dRow?.assigned_to ? dRow.assigned_to_name : (userRow[0]?.name || ""),
        actorId: userId, actorName: userRow[0]?.name || "", openingInteractionId: result.id,
      }));
      await run("UPDATE interactions SET metadata = jsonb_set(metadata, '{next_step}', '\"set\"') WHERE id = ?", [result.id]);
    }
  }
  res.status(result.status).json({ id: result.id, skipped: result.skipped, deduped: result.deduped, thread });
}));

// ── Fundraising goals (home screen goal banner) ─────────────────────────────
// FIX-49 · A GOAL'S PERIOD IS ITS OWN START AND END DATES, everywhere
// (Jonathan, 25 Oct). Home's banner and Fundraising's goal card both read this
// one function: the gifts dated inside the goal's own period, from people who
// are not deleted, at the full amount paid, soft and matching credits left out.
// A recovery goal counts only the gift that brought someone back after a year.
// NUMBERS-5: the goal's money in any span of days (its whole period, or the
// last seven days of it), with the people who gave it; one rule for both.
async function goalGiftsBetween(orgId, goal, from, to) {
  if (goal.goal_type === "lapsed_recovery") {
    const [r] = await query(
      `SELECT COALESCE(SUM(g.amount),0) AS total, ${NUMBERS.money.GIVERS("g", "d")}::int AS donors
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND g.date = d.last_gift_date
         AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}
         AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.org_id = g.org_id AND g2.date < g.date) IS NOT NULL
         AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.org_id = g.org_id AND g2.date < g.date)::date >= ${lapseRule.LAPSED_DAYS}`,
      [orgId, from, to]);
    return { total: parseFloat(r?.total) || 0, donors: Number(r?.donors) || 0 };
  }
  const [r] = await query(
    `SELECT COALESCE(SUM(g.amount),0) AS total, ${NUMBERS.money.GIVERS("g", "d")}::int AS donors FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}`,
    [orgId, from, to]);
  return { total: parseFloat(r?.total) || 0, donors: Number(r?.donors) || 0 };
}
async function orgGoalRaised(orgId, goal) {
  return (await goalGiftsBetween(orgId, goal, goal.period_start, goal.period_end)).total;
}
// GIFTS-2: raised, pledged and committed for the org's goal, by its own switch.
// A recovery goal counts people coming back, so pledges never count toward it.
async function goalCommitted(orgId, goal, raised) {
  const GP = NUMBERS.goalPledges;
  const pledged = goal.goal_type === "lapsed_recovery" ? 0 : await GP.orgPledgedThrough(query, orgId, goal.period_end);
  const on = goal.goal_type !== "lapsed_recovery" && GP.countsPledges("org", goal.count_pledges);
  return { ...GP.committedOf({ raised, pledged, countPledges: on }), goalId: goal.id, kind: "goal", canCount: goal.goal_type !== "lapsed_recovery" };
}

// The checker reads the goal period rule through the function that draws it.
require("../../numbers").screens.orgGoalRaised = orgGoalRaised;

app.get("/goals/active", requireAuth, wrap(async (req, res) => {
  // Civil date: a goal's period is a range of DAYS ON A CALENDAR, so whether
  // today falls inside it is a question about the org's calendar, not UTC's.
  // On the last evening of a goal's period a UTC slice drops the goal off the
  // Home banner hours early.
  const today = orgToday(await orgTz(req.user.orgId));  // ORG_TZ_SEAM_OK
  const rows = await query(
    "SELECT * FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY created_at DESC LIMIT 1",
    [req.user.orgId, today, today]
  );
  if (!rows.length) return res.json(null);
  const goal = rows[0];
  const goalAmount = parseFloat(goal.goal_amount) || 0;

  // FIX-49: the goal's own period, the one rule (orgGoalRaised).
  const currentAmount = await orgGoalRaised(req.user.orgId, goal);

  const percent = goalAmount > 0 ? Math.min(100, Math.round((currentAmount / goalAmount) * 100)) : 0;
  // Uncapped truth + overage, so the Home hero reads a beaten goal as a win
  // ("Goal met · 302% · $50k over") instead of a misleading flat 100%.
  const rawPercent = goalAmount > 0 ? Math.round((currentAmount / goalAmount) * 100) : 0;
  const over = goalAmount > 0 && currentAmount > goalAmount ? currentAmount - goalAmount : 0;

  // Trailing-7-day slice of the same real activity above — powers the Home
  // hero banner's "what's driving this" hint with actual recent gifts
  // instead of an invented/decorative line. Bounded to stay inside the
  // goal's own period so it never reaches back before period_start.
  let recentAmount = 0, recentDonorCount = 0;
  // Seven days back from the ORG'S civil today, not from UTC's. `today` above
  // is already the org's civil date; deriving the other end of the same window
  // from a UTC slice made the window start on the wrong day for four hours a
  // night and, worse, could put its END before its start.
  const sevenDaysAgoStr = orgTime.addDays(today, -6);
  const recentStart = sevenDaysAgoStr > goal.period_start ? sevenDaysAgoStr : goal.period_start;
  if (recentStart <= today) {
    // NUMBERS-5: the recent line is the goal's own rule over the last seven
    // days (credit rows out, deleted people out), so it agrees with raised.
    const recent = await goalGiftsBetween(req.user.orgId, goal, recentStart, today);
    recentAmount = recent.total;
    recentDonorCount = recent.donors;
  }

  // RECONCILE-1 · LAST YEAR, FOR A TOTAL-RAISED GOAL. Steward's gifts for the
  // same stretch a year earlier; when Steward has none, the old report she
  // chose with "Use as last year's total", labelled as from her old system.
  let lastYear = null;
  if (goal.goal_type === "total_raised") {
    const back = d => `${Number(String(d).slice(0, 4)) - 1}${String(d).slice(4, 10)}`;
    const ly = { key: "gifts", params: { from: back(goal.period_start), to: back(goal.period_end) } };
    const f = await figureSources.figureValue(req.user.orgId, ly);
    if (f.value > 0) lastYear = { value: f.value, source: ly, label: "The same stretch last year", imported: false };
    else {
      const h = await figureSources.historicalGiving(req.user.orgId, ly.params.from, ly.params.to, { baseline: true });
      if (h) lastYear = { value: h.value, source: h.source, label: "The same stretch last year, from your old system", imported: true, note: h.note };
    }
  }

  res.json({
    label: goal.label, goalType: goal.goal_type, goalAmount, currentAmount, percent, rawPercent, over,
    periodStart: goal.period_start, periodEnd: goal.period_end,
    recentAmount, recentDonorCount, lastYear,
    commitment: await goalCommitted(req.user.orgId, goal, currentAmount),   // GIFTS-2
  });
}));

app.post("/goals", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { label, goalAmount, goalType, periodStart, periodEnd } = req.body;
  if (!label || !goalAmount || !goalType || !periodStart || !periodEnd) {
    return res.status(400).json({ error: "label, goalAmount, goalType, periodStart, and periodEnd required" });
  }
  if (!["lapsed_recovery", "total_raised"].includes(goalType)) {
    return res.status(400).json({ error: "goalType must be lapsed_recovery or total_raised" });
  }
  const id = newId("goal");
  const countPledges = typeof req.body.countPledges === "boolean" ? req.body.countPledges : null;   // GIFTS-2
  await run(
    "INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label,count_pledges) VALUES (?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, periodStart, periodEnd, goalType, parseFloat(goalAmount), label, countPledges]
  );
  res.status(201).json({ id });
}));

// GIFTS-2 · "Count pledges toward this goal", for the org's goal or a campaign.
// A setting on the goal, changed by an admin; the audit row is the middleware's.
app.put("/goals/:kind/:id/count-pledges", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const table = GOAL_TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Not found" });
  // The goal is this org's before the body is read, so another org's id and an
  // id that does not exist get the same 404 (tenant-matrix: no existence oracle).
  const [own] = await query(sql`SELECT id FROM ${sql.id(table, GOAL_TABLES)} WHERE id = ${req.params.id} AND org_id = ${req.user.orgId}`);   // REDTEAM-2
  if (!own) return res.status(404).json({ error: "Not found" });
  if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on must be true or false" });
  await run(sql`UPDATE ${sql.id(table, GOAL_TABLES)} SET count_pledges = ${req.body.on} WHERE id = ${req.params.id} AND org_id = ${req.user.orgId}`);
  res.json({ ok: true, countPledges: req.body.on });
}));

// Computes both metrics live (so the number shown is never stale), persists
// today's snapshot for this org (so the trend line fills in as the page
// gets viewed, on top of the periodic background job), and returns the
// last 30 days of history for each.
// Wipes the org's own metric-trend history and re-snapshots today from live
// data. Built for baseline pollution (BUILD-06 Phase E): after a mass
// purge-trash (e.g. the CREO 3,905-test-donor cleanup), the Home trends
// compared real data against snapshots of deleted test data ("↓1,153 vs 3
// weeks ago"). Org-scoped + admin — an org resetting its own analytics
// baseline is its own business; trends read "no trend data yet" until real
// history re-accumulates, which is the honest state.
app.post("/metrics/reset-baselines", requireAuth, requireAdmin, wrap(async (req, res) => {
  const del = await run("DELETE FROM metric_snapshots WHERE org_id = ?", [req.user.orgId]);
  await snapshotMetricsForOrg(req.user.orgId);
  res.json({ deleted: del.changes, resnapshotted: true });
}));

app.get("/metrics/stewardship-summary", requireAuth, OS.cached("stewardship-summary"), wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // ?scope=mine (default) scopes Debt/Retention to the logged-in user's own
  // assigned donors, same as GET /dashboard/today; ?scope=all is org-wide.
  // Only the "current" figures are scoped — the trend/sparkline history
  // below stays org-wide (metric_snapshots has no per-user dimension, and
  // building one is out of scope here), and a scoped read is never persisted
  // as a snapshot, so one user's "mine" view can't pollute the org's daily
  // trend. First-Touch Delay is intentionally left unscoped.
  const scope = req.query.scope === "all" ? "all" : "mine";
  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  // BUILD-54 §1 — the three metric computations and three trend reads are
  // independent; one parallel batch (was 6 sequential round trips).
  // SCALE-1: scope=all snapshots, and the snapshot already computes first
  // touch and org-wide retention; reuse those instead of computing each twice.
  const snap = {};
  const pDebt = scope === "all" ? snapshotMetricsForOrg(orgId, snap) : computeStewardshipDebt(orgId, { userId });
  const [debt, firstTouch, retention, debtTrend, touchTrend, retentionTrend] = await Promise.all([
    pDebt,
    scope === "all" ? pDebt.then(() => snap.firstTouch) : computeFirstTouchDelay(orgId),
    scope === "all" ? pDebt.then(() => snap.retention) : computeRetentionRate(orgId, { userId }),
    query(
      "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='stewardship_debt' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
      [orgId, sinceStr]),
    query(
      "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='first_touch_delay' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
      [orgId, sinceStr]),
    query(
      "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='retention_rate' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
      [orgId, sinceStr]),
  ]);

  const trendDelta = trend => trend.length >= 2 ? Math.round(Number(trend[trend.length - 1].value) - Number(trend[0].value)) : null;

  res.json({
    stewardshipDebt: { current: debt, trend: debtTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(debtTrend) },
    firstTouchDelay: { current: firstTouch.avgDays, sampleSize: firstTouch.sampleSize, untouchedCount: firstTouch.untouchedCount, newestUntouched: firstTouch.newestUntouched, trend: touchTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(touchTrend) },
    importCaveat: (await importHealth(orgId)).caveat,
    retentionRate: {
      // BUILD-80 Part 9 — the sector comparison is GONE (the sentence
      // BUILD-73 banned: no benchmarking an org on first contact, no
      // unsourced sector statistics). Rate, window, denominator — nothing else.
      current: retention.retentionRate,
      // BUILD-76 follow-up — the confidence floor: below it the client says
      // "not enough history yet" and drops the sector comparison entirely.
      thinData: retention.thinData, historyDays: retention.historyDays, floor: retention.floor,
      retained: retention.retained, prevYearCount: retention.prevYearCount,
      // Lets the client tell "0% because nothing has been logged this year
      // yet" (day-one org, too early to measure) apart from a genuine 0%.
      thisYearCount: retention.thisYearCount,
      // BUILD-77 Part 4 — the tile STATES its window + denominator (a rate is
      // meaningless without them: 66% "above sector average" over 204
      // prior-year donors where half the file is lapsed reads as fake).
      year: retention.year, prevYear: retention.prevYear,
      // NUMBERS-2: the fiscal years by name, the one definition, and the
      // same-dates-last-year rate for reading "so far this year" fairly.
      yearLabel: retention.period && retention.period.label, prevYearLabel: retention.period && retention.period.prevLabel,
      definition: figureSources.RETENTION_WORDS,
      sameDatesLastYear: retention.period ? await (async () => {
        const w = figureSources.sameDatesLastYear(retention.period);
        const f = await figureSources.figureValue(orgId, { key: "retention-window", params: w }, {});
        return { current: f.value == null ? null : Math.round(Number(f.value)), source: { key: "retention-window", params: w }, definition: figureSources.RETENTION_SAME_POINT_WORDS };
      })() : null,
      trend: retentionTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(retentionTrend),
    },
    // IMPORT-4: gifts with no date are in no figure for a span of time, so
    // Home says how many retention and the year's figures left out.
    undated: await (async () => {
      const [u] = await query(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                                WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date IS NULL`, [orgId]);
      return u && u.n ? { count: u.n, words: require("../../numbers").undatedWords(u.n), source: { key: "undated-gifts", params: {} } } : null;
    })(),
  });
}));

// Overview — the money-moving command view. Everything the Fundraising home
// needs in one call: the active org goal with pace, this-period momentum vs
// the prior period (same FY/calendar basis as Finance — one source of truth),
// campaign + giving-page rollups, and recent real gifts.
// FUNDRAISING-2: the stored answer's name carries its shape, so a deploy that
// changes the shape never serves yesterday's body (stored answers are not
// keyed by build).
app.get("/fundraising/overview", requireAuth, OS.cached("fundraising-overview-4"), wrap(async (req, res) => {
  await PACE_READY;
  await FISCAL_READY;   // FIX-10 Part B — the period label is the shared one, not a race
  const { orgId } = req.user;
  const yearMode = req.query.yearMode === "calendar" ? "calendar" : "fiscal";
  const _fpTz = await orgTz(orgId);   // ORG_TZ_SEAM_OK
  // TRUTH-5: This FY, Last FY or custom days (server/reports/overviewPeriod.js).
  const OP = require("./overviewPeriod").overviewPeriod(req.query, _fpTz, yearMode);
  if (OP.error) return res.status(400).json({ error: OP.error });
  const cur = OP.cur;
  const today = orgToday(_fpTz);   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  // BUILD-32 Part 3 — the Home hero's "this week's giving" figure. A true
  // Monday-based calendar week (weekBounds), independent of the fiscal/calendar
  // period above, so the hero shows a number that genuinely moves week to week.
  const wk = weekBounds(0, await orgTz(orgId));   // ORG_TZ_SEAM_OK

  // FIX-10 Part B — A ZERO THAT EXPLAINS ITSELF. Fundraising opened on
  // "$0 RAISED · FY 2026–27" to an org that had imported $19,750 the hour
  // before, because the fiscal year had turned in July and every imported
  // gift was dated before it. Finance already handles exactly this ("$19,750
  // of imported giving across 23 gifts isn't in this ledger…") and this is
  // that pattern, on Fundraising: the last twelve months, beside the empty
  // year, each opening its own rows. Same JOIN and deleted_at predicate as
  // the period query above, so both figures foot to Reports.
  const l12Start = orgTime.addDays(orgToday(_fpTz), -364);
  const l12End = orgToday(_fpTz);
  // Each span's money, gifts and givers: the one computation (shared/numbers),
  // in the row shape this route has always read.
  const periodGiving = span => NUMBERS.givingBetween.givingBetween(query, orgId, { ...span, today })
    .then(r => [{ total: r.cents / 100, gifts: r.gifts, donors: r.givers }]);   // TRUTH-4: counted gifts (giftCount.js), never every row
  const [goalRows, curRows, vsLast, weekRows, recentGifts, campaigns, givingPages, l12Rows, anyGiftRows] = await Promise.all([
    // TRUTH-6 (W-1110-Fundraising-06X): the goal is the period's. This FY reads
    // the goal running today; Last FY or custom days read a goal set for days
    // in that span, or none (and the page says so: periodNotes below).
    OP.key === "this_fy"
      ? query("SELECT * FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY created_at DESC LIMIT 1", [orgId, today, today])
      : query("SELECT * FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY period_end DESC, created_at DESC LIMIT 1", [orgId, cur.end, cur.start]),
    // BUILD-33: period totals exclude soft-deleted (trashed) donors' gifts —
    // same JOIN + deleted_at IS NULL predicate as Reports' giving-summary, so
    // Fundraising and Reports report the SAME period number (the BUILD-23
    // cross-surface invariant). Trashing a donor hides them from Reports; the
    // Fundraising header must not keep counting them.
    // TRUTH-1: every gift sum on this page is money: a soft or matching credit
    // row is in none of them (the pace beside them, numbers.vsLastYear, leaves them out).
    // NUMBERS-3: Raised is this period TO TODAY (shared/numbers/givingBetween.js):
    // a gift dated later in the year is not money received yet. It ran to the
    // period's end, so a future-dated gift counted here and not on the Board.
    periodGiving({ from: cur.start, to: cur.end }),
    // HARDEN-1: "vs last year" is this period so far against the SAME DAYS
    // last year, read through the one computation Home and the Board read.
    // It was the whole of the prior period ("↓ $210,535.51 vs last period"
    // beside Home's "$63,984 behind last year at this point").
    require("../../numbers").vsLastYear(orgId, cur.start, cur.end, today),
    periodGiving({ from: wk.start, to: wk.end }),
    query(
      `SELECT g.id, g.amount, g.date, g.stripe_payment_id, g.giving_page_id, g.payment_method, g.campaign, g.donor_id, d.name AS donor_name,
              ev.name AS event_name
         FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id
         LEFT JOIN events ev ON ev.id = g.event_id AND ev.org_id = g.org_id
        -- NUMBERS-3 (D-8): a soft credit row is recognition, never a recent gift.
        WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${NUMBERS.money.MONEY("g")} ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC LIMIT 8`,
      [orgId]
    ),
    fundraisingCampaignRows(orgId),
    query(
      `SELECT gp.id, gp.title, gp.slug, gp.goal_amount, gp.status,
              COALESCE((SELECT SUM(amount) FROM gifts WHERE giving_page_id = gp.id AND gifts.org_id = gp.org_id AND ${NOT_DELETED("gifts")} AND ${NUMBERS.money.MONEY("gifts")}), 0) AS raised
         FROM giving_pages gp WHERE gp.org_id = ? AND COALESCE(gp.page_kind,'give') = 'give' ORDER BY gp.created_at DESC`,
      [orgId]
    ),
    periodGiving({ from: l12Start, to: l12End }),
    query(`SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(*) AS gifts FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${NOT_CREDIT("g")} AND ${SCHED_DUE("g")}`, [orgId]),
  ]);

  // Active org goal with pace (reuses the goal-progress math shape).
  let goal = null;
  if (goalRows.length) {
    const gr = goalRows[0];
    const goalAmount = parseFloat(gr.goal_amount) || 0;
    // FIX-49 · A GOAL'S PERIOD IS ITS OWN DATES. FIX-34 made a raised-money
    // goal count the fiscal year (the Raised card's window) while Home's banner
    // counted the goal's own period, so one goal read two amounts. Both now
    // read orgGoalRaised over the goal's own start and end.
    const currentAmount = await orgGoalRaised(orgId, gr);
    const pStart = gr.period_start, pEnd = gr.period_end;
    const DD = await import("../../shared/displayDate.js");
    // GIFTS-2: the goal says whether pledges count; pace reads committed when they do.
    const commit = await goalCommitted(orgId, gr, currentAmount);
    const pace = paceWithCommitment(currentAmount, commit, goalAmount, pStart, pEnd);
    // A label that is only the amount again ("25,000") is not a name.
    const label = /^[\s$£€\d,.]*$/.test(String(gr.label || "")) ? null : gr.label;
    goal = {
      id: gr.id, label, goalType: gr.goal_type, goalAmount, currentAmount,
      periodStart: pStart, periodEnd: pEnd, source: "goal", ...pace, commitment: commit,
      // MOPUP-2: dates read the one way a person reads them (shared/displayDate.js), never ISO.
      sourceNote: `Counts every gift dated ${DD.displayDate(pStart) || pStart} to ${DD.displayDate(pEnd) || pEnd}, this goal's own dates${commit.countPledges ? ", and what is still owed on open pledges due by then" : ""}.`,
    };
  }

  // ── BUILD-88a A.3 — FINANCE FEEDS FUNDRAISING ─────────────────────────────
  // An org that budgets $200,000 of contributions for the year HAS a $200,000
  // fundraising goal. It was typing that number twice — once into Finance and
  // once into a fundraising goal — which is how two screens come to disagree
  // about the same commitment. With no goal of its own set, the card reads the
  // year's CONTRIBUTIONS BUDGET, says where the figure came from, and moves the
  // moment an admin edits the budget. An explicit goal still wins: a goal
  // somebody set on purpose outranks one Steward inferred.
  if (!goal) {
    const fyLabel = Number(String(cur.end).slice(0, 4));
    const [bud] = await query(
      `SELECT COALESCE(SUM(b.amount),0) AS v FROM budgets b
         JOIN accounts a ON a.id = b.account_id AND a.org_id = b.org_id
        WHERE b.org_id = ? AND b.year = ? AND a.type = 'revenue' AND a.subtype = 'contributions'
          AND COALESCE(b.basis, 'calendar') = ?`,
      // FIX-60: a budget is read on the kind of year it was set for (an old
      // row with no basis is a calendar budget), never a calendar budget
      // under a fiscal year's name.
      [orgId, yearMode === "fiscal" ? fyLabel : Number(String(cur.start).slice(0, 4)),
       yearMode === "fiscal" && orgTime.orgFiscalStartMonth(_fpTz) !== 1 ? "fiscal" : "calendar"]);
    const budgeted = parseFloat(bud?.v) || 0;
    if (budgeted > 0) {
      const pace = computeFundraisingPace((parseFloat(curRows[0]?.total) || 0), budgeted, cur.start, cur.end);
      goal = {
        id: null, label: `Contributions budget, ${yearMode === "fiscal" ? await require("../shared/periodLabel").fyLabelOf(cur, orgTime.orgFiscalStartMonth(_fpTz)) : fyLabel}`,   // POLISH-6
        goalType: "budget", goalAmount: budgeted, currentAmount: (parseFloat(curRows[0]?.total) || 0),
        periodStart: cur.start, periodEnd: cur.end, source: "budget",
        sourceNote: "From your Finance budget for contributions this year. Set a fundraising goal to use a different number.",
        ...pace,
      };
    }
  }

  const periodTotal = parseFloat(curRows[0]?.total) || 0;
  // vsLast: numbers.vsLastYear, or null before the period begins.
  const priorTotal = vsLast ? vsLast.lastYear : 0;
  // FUNDRAISING-2: live means it can take money: active, and payments connected.
  const [payOrg] = await query("SELECT stripe_connected, stripe_account_id FROM orgs WHERE id = ?", [orgId]);
  const activePages = orgTakesGifts(payOrg) ? givingPages.filter(p => p.status === "active") : [];

  // BUILD-16 Part 2 — the goal portfolio + roll-up header replaces the single
  // org goal as the Fundraising Overview centerpiece.
  const portfolio = fundraisingGoalsPortfolio(campaigns);

  // IMPORT-4: gifts with no date are in no period's figure; the tiles say how many.
  const [undatedRow] = await query(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                                     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date IS NULL`, [orgId]);
  const N = require("../../numbers");
  // FUNDRAISING-2: pledges, the same three figures Home and Pledges read.
  const _fyOrg = await orgForYears(orgId);
  const pledges = { ...(await N.pledgeSummary(orgId, { yearEnd: orgTime.orgPeriodBounds(_fyOrg, "fiscal_year", 0).end, today })),
    yearLabel: await require("../shared/periodLabel").orgFyLabel(_fyOrg) };   // POLISH-6: "due in FY 2026–27"
  // The leading campaign is the running one that has raised most; one that
  // has ended leads only when nothing is running.
  const running = campaigns.filter(c => c.lifecycle === "active");
  const top = (running.length ? running : campaigns).slice().sort((a, b) => b.raised - a.raised)[0] || null;
  let lead = null;
  if (top && top.lifecycle === "active") {
    const monthStart = String(today).slice(0, 8) + "01";
    const givers = await query(
      `SELECT d.id, d.name, SUM(g.amount)::text AS total FROM campaigns c
         JOIN gifts g ON g.org_id = c.org_id AND ${N.CAMPAIGN_GIFT_MATCH("g", "c")}
         JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
        WHERE c.org_id = ? AND c.id = ? AND g.date >= ? AND g.date <= ?
        GROUP BY d.id, d.name ORDER BY SUM(g.amount) DESC, d.id LIMIT 3`, [orgId, top.id, monthStart, today]);
    const left = Math.max(0, Math.round((top.goalAmount - top.raised) * 100) / 100);
    const weeks = top.daysLeft ? Math.max(1, Math.ceil(top.daysLeft / 7)) : null;
    lead = { left, perWeek: left > 0 && weeks ? Math.ceil(left / weeks) : 0, weeksLeft: weeks,
             topGivers: givers.map(x => ({ id: x.id, name: x.name, total: parseFloat(x.total) || 0 })) };
  }
  // FUNDRAISING-2: with no campaign running, the card shows the event that
  // raised most in the last twelve months, as its own page tells it.
  let leadEvent = null;
  if (!running.length) {
    const recent = await N.eventsRaised(orgId, { withMoney: true });
    const inYear = recent.filter(e => !e.date || (e.date >= l12Start && e.date <= l12End));
    const best = inYear.sort((a, b) => b.raisedCents - a.raisedCents)[0];
    if (best) leadEvent = await N.eventStory(orgId, best.id);
  }
  const methodWord = g => g.giving_page_id ? "Online form" : g.stripe_payment_id ? "Stripe"
    : (/^(check|card|cash|ach|daf|stock)$/i.test(String(g.payment_method || "").trim()) ? (/^(ach|daf)$/i.test(g.payment_method.trim()) ? g.payment_method.trim().toUpperCase()
      : g.payment_method.trim()[0].toUpperCase() + g.payment_method.trim().slice(1).toLowerCase()) : null);
  res.json({
    undated: undatedRow && undatedRow.n ? { count: undatedRow.n, words: require("../../numbers").undatedWords(undatedRow.n), source: { key: "undated-gifts", params: {} } } : null,
    yearMode,
    periodLabel: cur.chartLabel,
    // "this fiscal year": what "this period" means, in words.
    periodWords: OP.periodWords, periodKey: OP.key,
    // TRUTH-6: what on the page does not move with the period, said beside it.
    periodNotes: await require("./periodNotes").periodNotes({ key: OP.key, label: cur.chartLabel, goal, orgId, today, pledges }),
    pledges,
    leadEvent,
    goal,
    rollup: portfolio.rollup,
    goals: portfolio.goals,
    period: {
      raised: periodTotal,
      giftCount: parseInt(curRows[0]?.gifts, 10) || 0,
      donorCount: parseInt(curRows[0]?.donors, 10) || 0,
      priorRaised: priorTotal,
      delta: vsLast ? vsLast.difference : 0,
      // The comparison and the days it compares, each half a figure source.
      compare: vsLast ? {
        thisYear: vsLast.thisYear, lastYear: vsLast.lastYear, difference: vsLast.difference,
        from: vsLast.from, to: vsLast.to, lastFrom: vsLast.lastFrom, lastTo: vsLast.lastTo,
        sentence: vsLast.sentence, source: vsLast.differenceSource,
      } : null,
      // FIX-10 Part B — the bounds this figure was summed over, so the tile can
      // open EXACTLY the rows it claims instead of a whole-Reports link.
      start: cur.start,
      end: cur.end,
      // FLOWS-2: the gifts behind Raised, the `gifts` figure source over the
      // span Raised was summed over (to today), so the tile opens those rows.
      source: { key: "gifts", params: { from: cur.start, to: today < cur.end ? today : cur.end } },
    },
    // FIX-10 Part B — the last twelve months, and whether this org has any
    // giving at all. `emptyYearWithHistory` is the single condition the client
    // reads: the fiscal year has no gifts AND the file is not empty, which is
    // the only case where "$0 raised" is true and useless at the same time.
    last12: {
      raised: parseFloat(l12Rows[0]?.total) || 0,
      giftCount: parseInt(l12Rows[0]?.gifts, 10) || 0,
      donorCount: parseInt(l12Rows[0]?.donors, 10) || 0,
      start: l12Start,
      end: l12End,
    },
    allTime: {
      raised: parseFloat(anyGiftRows[0]?.total) || 0,
      giftCount: parseInt(anyGiftRows[0]?.gifts, 10) || 0,
    },
    emptyYearWithHistory: periodTotal === 0 && (parseInt(anyGiftRows[0]?.gifts, 10) || 0) > 0,
    thisWeek: {
      raised: parseFloat(weekRows[0]?.total) || 0,
      giftCount: parseInt(weekRows[0]?.gifts, 10) || 0,
      // Week bounds exposed so the Home hero's "This week" chip can deep-link
      // to a gifts view filtered to EXACTLY this window (the chip's number and
      // its destination must agree — count-matches-destination rule).
      start: wk.start,
      end: wk.end,
    },
    campaigns: {
      count: campaigns.length,
      activeCount: running.length,
      raised: campaigns.reduce((s, c) => s + c.raised, 0),
      top: top ? { ...top, lead } : null,
    },
    givingPages: {
      takesGifts: orgTakesGifts(payOrg),
      count: activePages.length,
      raised: activePages.reduce((s, p) => s + (parseFloat(p.raised) || 0), 0),
      pages: activePages.map(p => ({ id: p.id, title: p.title, slug: p.slug, goalAmount: p.goal_amount != null ? parseFloat(p.goal_amount) : null, raised: parseFloat(p.raised) || 0 })),
    },
    recentGifts: recentGifts.map(g => ({
      id: g.id, amount: parseFloat(g.amount) || 0, date: g.date,
      source: g.stripe_payment_id ? "online" : "offline", campaign: g.campaign || g.event_name || null,
      eventName: g.event_name || null, method: methodWord(g),
      donorId: g.donor_id || null,
      donorName: g.donor_name || "Anonymous",
    })),
  });
}));

// FUNDRAISING-2 · PLEDGES. Every open pledge with what is left on it, what
// falls due this fiscal year, what is overdue, and each installment. The
// three totals are numbers.pledgeSummary (Home and the Overview read it), and
// each pledge's dueThisYear is the profile's, to the same day.
app.get("/fundraising/pledges", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const org = await orgForYears(orgId);
  const today = orgToday(org);   // ORG_TZ_SEAM_OK
  const yearEnd = orgTime.orgPeriodBounds(org, "fiscal_year", 0).end;   // the day Home's "due this year" counts to
  const [summary, rows] = await Promise.all([
    require("../../numbers").pledgeSummary(orgId, { yearEnd, today }),
    query(
      `SELECT p.id, p.donor_id, d.name AS donor_name, p.amount, p.due_date, p.created_at, p.notes,
              p.event_id, ev.name AS event_name, p.campaign_id, c.name AS campaign_name,
              COALESCE(pp.paid, 0) AS paid, GREATEST(p.amount - COALESCE(pp.paid, 0), 0) AS balance
         FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
         LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
         LEFT JOIN events ev ON ev.id = p.event_id AND ev.org_id = p.org_id
         LEFT JOIN campaigns c ON c.id = p.campaign_id AND c.org_id = p.org_id
        WHERE p.org_id = ? AND p.status = 'open'
        ORDER BY GREATEST(p.amount - COALESCE(pp.paid, 0), 0) DESC, d.name, p.id`, [orgId, orgId]),
  ]);
  const inst = rows.length ? await query(
    `SELECT id, pledge_id, seq, LEFT(due_date::text, 10) AS due_date, amount, paid_gift_id FROM pledge_installments
      WHERE org_id = ? AND pledge_id = ANY(?) ORDER BY due_date, seq, id`, [orgId, rows.map(r => r.id)]) : [];
  const by = new Map();
  for (const i of inst) (by.get(i.pledge_id) || by.set(i.pledge_id, []).get(i.pledge_id)).push(i);
  const r2 = v => Math.round((parseFloat(v) || 0) * 100) / 100;
  res.json({
    ...summary,
    pledges: rows.map(r => {
      const list = by.get(r.id) || [];
      const balance = r2(r.balance), due = String(r.due_date || "").slice(0, 10);
      // LEDGER-1: the one rule (shared/numbers/pledges.js), the totals' own.
      const PL = require("../../shared/numbers/pledges");
      const pl = { amount: r.amount, paid: r.paid, dueDate: due, installments: list.map(i => ({ seq: i.seq, dueDate: i.due_date, amount: i.amount, paid: !!i.paid_gift_id })) };
      const dueThisYear = PL.dueOf(pl, yearEnd, "<=");
      const overdue = PL.dueOf(pl, today, "<");
      const left = PL.installmentsLeft(pl);
      return {
        id: r.id, donorId: r.donor_id, donorName: r.donor_name, amount: r2(r.amount), paid: r2(r.paid), balance,
        dueThisYear: r2(dueThisYear), overdue: r2(overdue), dueDate: due || null,
        summary: PL.summaryOf(pl),   // PLEDGES-3: the Next column is summary.nextAmount, never the pledge total
        madeAt: r.event_name ? { kind: "event", id: r.event_id, name: r.event_name } : r.campaign_name ? { kind: "campaign", id: r.campaign_id, name: r.campaign_name } : null,
        installments: list.map((i, k) => ({ id: i.id, dueDate: i.due_date, amount: r2(i.amount), left: left[k].left, paid: left[k].left <= 0, overdue: left[k].left > 0 && i.due_date < today })),
      };
    }),
  });
}));

app.get("/fundraising/campaigns", requireAuth, wrap(async (req, res) => {
  res.json(await fundraisingCampaignRows(req.user.orgId));
}));

// BUILD-16 Part 2 — the typed goal portfolio + org roll-up header.
app.get("/fundraising/goals", requireAuth, wrap(async (req, res) => {
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.json(fundraisingGoalsPortfolio(rows));
}));

// BUILD-54 §2 — the donor-facing fields ride the SAME create/edit routes the
// CRM campaign form uses (setup happens where the campaign is created — no
// separate configuration screen to forget). Shared validator for both routes;
// returns { sets, params } column assignments or { status, body } to reject.
async function parseDonorFacingCampaignFields(b, orgId) {
  const sets = [];   // REDTEAM-2: each a sql`` piece, its value bound
  if (b.donorFacingName !== undefined) { sets.push(sql`donor_facing_name = ${String(b.donorFacingName || "").trim().slice(0, 120) || null}`); }
  if (b.donorDescription !== undefined) { sets.push(sql`donor_description = ${String(b.donorDescription || "").trim().slice(0, 600) || null}`); }
  if (b.donorStory !== undefined) {
    const v = validateStoryBlocks(b.donorStory);
    if (v.error) return { status: 400, body: { error: v.error, message: "The story must be paragraphs, headings, and lists, no HTML or embeds." } };
    sets.push(sql`donor_story = ${v.blocks && v.blocks.length ? JSON.stringify(v.blocks) : null}`);
  }
  if (b.heroImageData !== undefined) {
    const h = await storeCampaignHero(orgId, b.heroImageData);
    if (h.error) return { status: 400, body: { error: h.error, message: h.message } };
    if (h.url !== undefined) { sets.push(sql`hero_image_url = ${h.url}`); }
  }
  // BUILD-65 Part 3 — non-destructive crop + focal for the hero (same library
  // and validation as the banner: parseCrop; a crop wins, focal is the fallback).
  if (b.heroCrop !== undefined) {
    if (b.heroCrop === "" || b.heroCrop == null) { sets.push(sql`hero_crop = NULL`); }
    else {
      const c = parseCrop(b.heroCrop);
      if (!c) return { status: 400, body: { error: "bad_crop", message: "Crop must be a rectangle {x,y,w,h} within the image." } };
      sets.push(sql`hero_crop = ${JSON.stringify(c)}`);
    }
  }
  for (const [key, col] of [["heroFocalX", "hero_focal_x"], ["heroFocalY", "hero_focal_y"]]) {
    if (b[key] === undefined) continue;
    const nn = Number(b[key]);
    if (!Number.isFinite(nn)) return { status: 400, body: { error: "bad_focal", message: "Focal point must be a number between 0 and 1." } };
    sets.push(sql`${sql.id(col, ["hero_focal_x", "hero_focal_y"])} = ${Math.min(1, Math.max(0, nn))}`);
  }
  if (b.goalProgressPublic !== undefined) { sets.push(sql`goal_progress_public = ${b.goalProgressPublic === true}`); }
  if (b.grantsOffPublicBar !== undefined) { sets.push(sql`grants_off_public_bar = ${b.grantsOffPublicBar === true}`); }   // FIX-49
  return { sets };
}

app.post("/fundraising/campaigns", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, goalAmount, startDate, endDate, goalCategory, parentGoalId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  const goal = parseFloat(goalAmount);
  if (!Number.isFinite(goal) || goal <= 0) return res.status(400).json({ error: "Goal amount must be a positive number" });
  const category = GOAL_CATEGORIES.includes(goalCategory) ? goalCategory : "project";
  // A parent goal, if given, must be another goal'd campaign in this org.
  let parent = null;
  if (parentGoalId) {
    const p = await query("SELECT id FROM campaigns WHERE id=? AND org_id=? AND goal_amount IS NOT NULL AND goal_amount > 0", [parentGoalId, req.user.orgId]);
    if (!p.length) return res.status(400).json({ error: "parentGoalId must be an existing goal in this org" });
    parent = parentGoalId;
  }
  const df = await parseDonorFacingCampaignFields(req.body, req.user.orgId);
  if (df.status) return res.status(df.status).json(df.body);
  const id = newId("cmp");
  await run(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,goal_amount,start_date,end_date,goal_category,parent_goal_id,recipient_count,open_count,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)`,
    [id, req.user.orgId, name.trim(), "appeal", "", "", "draft", JSON.stringify({}), goal, startDate || null, endDate || null, category, parent, actor(req).id, actor(req).name]
  );
  if (df.sets.length) {
    await run(sql`UPDATE campaigns SET ${sql.join(df.sets)} WHERE id = ${id} AND org_id = ${req.user.orgId}`);
  }
  if (req.body.heroImageData !== undefined) {
    const [c] = await query(`SELECT hero_image_url FROM campaigns WHERE id = ?`, [id]);
    await recordAssetPointerHistory(req.user.orgId, "campaign.hero", id, null, c?.hero_image_url || null, req.user);
  }
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.status(201).json(rows.find(r => r.id === id) || { id });
}));

app.put("/fundraising/campaigns/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, goalAmount, startDate, endDate, goalCategory, parentGoalId } = req.body;
  const existing = await query("SELECT id, hero_image_url FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  if (goalAmount !== undefined) {
    const goal = parseFloat(goalAmount);
    if (!Number.isFinite(goal) || goal <= 0) return res.status(400).json({ error: "Goal amount must be a positive number" });
  }
  if (goalCategory !== undefined && !GOAL_CATEGORIES.includes(goalCategory)) {
    return res.status(400).json({ error: "goalCategory must be annual, project, or capital" });
  }
  // A goal can't be its own parent, and the parent must exist in this org.
  let parentUpdate = null, parentProvided = parentGoalId !== undefined;
  if (parentProvided && parentGoalId) {
    if (parentGoalId === req.params.id) return res.status(400).json({ error: "A goal cannot be its own parent" });
    const p = await query("SELECT id FROM campaigns WHERE id=? AND org_id=? AND goal_amount IS NOT NULL AND goal_amount > 0", [parentGoalId, req.user.orgId]);
    if (!p.length) return res.status(400).json({ error: "parentGoalId must be an existing goal in this org" });
    parentUpdate = parentGoalId;
  }
  const df = await parseDonorFacingCampaignFields(req.body, req.user.orgId);
  if (df.status) return res.status(df.status).json(df.body);
  await run(
    `UPDATE campaigns SET name=COALESCE(?,name), goal_amount=COALESCE(?,goal_amount),
       start_date=?, end_date=?, goal_category=COALESCE(?,goal_category),
       parent_goal_id=CASE WHEN ? THEN ? ELSE parent_goal_id END, updated_at=NOW() WHERE id=? AND org_id=?`,
    [name || null, goalAmount !== undefined ? parseFloat(goalAmount) : null,
     startDate || null, endDate || null, goalCategory || null,
     parentProvided, parentUpdate, req.params.id, req.user.orgId]
  );
  if (df.sets.length) {
    await run(sql`UPDATE campaigns SET ${sql.join(df.sets)} WHERE id = ${req.params.id} AND org_id = ${req.user.orgId}`);
    // A replaced/cleared hero leaves no orphaned asset (content addressing —
    // one photo may back several campaigns; reference-counted like impact).
    // BUILD-56: prune = soft delete + a pointer-history row.
    if (req.body.heroImageData !== undefined) {
      await pruneCampaignAssets(req.user.orgId);
      const [c] = await query(`SELECT hero_image_url FROM campaigns WHERE id = ?`, [req.params.id]);
      await recordAssetPointerHistory(req.user.orgId, "campaign.hero", req.params.id,
        existing[0].hero_image_url || null, c?.hero_image_url || null, req.user);
    }
  }
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.json(rows.find(r => r.id === req.params.id) || { id: req.params.id });
}));

// ── Annual Fund ────────────────────────────────────────────────────────────
app.get("/annual-fund", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  // REDTEAM-1: a year outside 1900–2200 (or "1' OR …", which parses as 1) was a 500.
  const asked = parseInt(req.query.year, 10);
  const year = asked >= 1900 && asked <= 2200 ? asked : orgTime.parseCivil(orgToday(await orgTz(orgId))).y; // ORG_TZ_SEAM_OK (BUILD-75 A.4)

  const goalRows = await query(
    "SELECT goal FROM annual_fund_goals WHERE org_id = ? AND year = ?",
    [orgId, year]
  );
  const goal = goalRows.length ? goalRows[0].goal : 0;

  // HARDEN-1: nobody deleted counts, an amount is a number (pg hands NUMERIC
  // back as text, so `s + g.amount` was joining strings), and the year and
  // month are read off the civil date, never through a UTC Date. An undated
  // gift belongs to no year.
  const allGifts = (await query(
    `SELECT g.* FROM gifts g WHERE g.org_id = ? AND ${NOT_DELETED("g")}`,
    [orgId]
  )).map(g => ({ ...g, amount: Number(g.amount) || 0 }));

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const civil = g => (g.date ? String(g.date instanceof Date ? orgTime.civilOf(g.date) : g.date).slice(0, 10) : "");

  const thisYearGifts = allGifts.filter(g => civil(g).slice(0, 4) === String(year));

  const totalRaised = thisYearGifts.reduce((s, g) => s + g.amount, 0);
  // TRUTH-3: the count and the average's divisor are the one rule (shared/numbers/giftCount.js).
  const giftCount   = thisYearGifts.filter(g => g.amount > 0 && !require("../../creditTypes").isCredit(g.type)).length;
  const avgGift     = giftCount > 0 ? Math.round(totalRaised / giftCount) : 0;

  const monthly = monthNames.map((month, idx) => {
    const raised = thisYearGifts
      .filter(g => Number(civil(g).slice(5, 7)) === idx + 1)
      .reduce((s, g) => s + g.amount, 0);
    return { month, raised };
  });

  // Shared with the Home dashboard's Retention Rate metric (see
  // computeRetentionRate) so the two can never disagree — pass the
  // already-fetched allGifts through rather than querying twice.
  // `year` is a calendar year here, so retention counts calendar years too.
  const retentionResult = await computeRetentionRate(orgId, { year, gifts: allGifts, startMonth: 1 });
  const totalDonors    = retentionResult.thisYearCount;
  const retained       = retentionResult.retained;
  const acquired       = totalDonors - retained;
  const retentionRate  = retentionResult.retentionRate ?? 0;

  const currentDate  = new Date();
  const currentYear  = currentDate.getFullYear();
  let projectedTotal = totalRaised;
  if (year === currentYear) {
    const elapsedMonths = currentDate.getMonth() + (currentDate.getDate() / 30);
    projectedTotal = elapsedMonths > 0
      ? Math.round(totalRaised / elapsedMonths * 12)
      : totalRaised;
  }

  const goalPct = goal > 0 ? Math.round(totalRaised / goal * 100) : 0;

  const lapsedDonorIds = new Set(
    (await query("SELECT id FROM donors WHERE org_id = ? AND status = 'lapsed' AND deleted_at IS NULL", [orgId])).map(d => d.id)
  );
  const recovered = thisYearGifts.filter(g => lapsedDonorIds.has(g.donor_id)).length;

  res.json({
    year,
    goal,
    totalRaised,
    monthly,
    donors: { total: totalDonors, acquired, retained, retentionRate },
    avgGift,
    giftCount,
    projectedTotal,
    goalPct,
    recovered,
  });
}));

app.post("/annual-fund/goal", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { year, goal } = req.body;
  if (!year || goal === undefined) return res.status(400).json({ error: "year and goal required" });

  const id = newId("afg");
  await run(
    `INSERT INTO annual_fund_goals (id,org_id,year,goal)
     VALUES (?,?,?,?)
     ON CONFLICT (org_id, year) DO UPDATE SET goal=EXCLUDED.goal`,
    [id, req.user.orgId, year, goal]
  );
  res.json({ success: true, year, goal });
}));

// Campaign hero image — single image on the BUILD-51 asset seam (kind
// 'campaign'; content-photo rules, any orientation). A stored /portal-assets/
// path echoes through unchanged; "" clears.
async function storeCampaignHero(orgId, heroIn) {
  if (heroIn == null) return { url: undefined };            // field not being set
  if (heroIn === "") return { url: null };                  // explicit clear
  if (typeof heroIn === "string" && heroIn.startsWith("/portal-assets/")) return { url: heroIn };
  const uerr = uploadImageError(heroIn);
  if (uerr) return { error: "bad_image", message: uerr };
  const m = String(heroIn).match(/^data:([^;]+);base64,(.*)$/s);
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "bad_image" }; }
  const dims = checkThemeImageDimensions("campaign", m[1], buffer);
  if (!dims.ok) return { error: "bad_image_dimensions", message: dims.message };
  const norm = await normalizeUploadImage("campaign", m[1], buffer);
  if (norm.error) return norm;
  const asset = await putThemeAsset({ orgId, kind: "campaign", isPublic: true, buffer: norm.buffer, contentType: norm.contentType, width: norm.width ?? dims.width, height: norm.height ?? dims.height });
  return { url: asset.path };
}
}

module.exports = { routers, mount };
