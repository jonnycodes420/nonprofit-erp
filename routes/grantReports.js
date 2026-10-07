// routes/grantReports.js · GRANTS-1. THE GRANTS REPORTS SCREEN, AND THE RENEWAL.
//
//   GET  /grant-overview               every number on Grants → Reports, each with its sentence
//   PUT  /org/grant-goal               an admin sets (or clears) the year's grant goal
//   POST /grants/:id/plan-renewal      plan the renewal of a grant (planRenewal)
//   POST /grants/:id/renewal/undo      take back a renewal it planned, while nobody has touched it
//
// Every number the overview sends is read THROUGH its figure source
// (figureSources.js: grants-stage, grants-awarded-year, grant-goal,
// grant-goal-progress, grant-win-rate, grant-deadlines, grant-reports-due),
// so the number on screen and the rows its drawer opens are one computation.
// The year is the org's FISCAL year (orgPeriodBounds "fiscal_year", its own
// start month), the year the Board and the dashboards measure.
//
// planRenewal is exported: the stage route calls it when a grant moves to
// Closed. Every write is recorded by the one audit write
// (middleware/auditTrail.js); nothing here writes an audit row, and nothing
// here sends anything to anybody.
"use strict";
const express = require("express");
const figureSources = require("../figureSources");
const money = require("../money");

// The overview is /grant-overview, not /grants/overview: crm.js's GET
// /grants/:id is mounted first and would take "overview" for an id.
const routers = { r0: express.Router() };
const DEADLINE_WINDOWS = [30, 60, 90];
const GOAL_MAX_CENTS = 100000000000;   // a billion dollars: past that it is a typo
const UNDO_SECONDS = 10;

let C = null;   // the context server.js passes to mount(); planRenewal reads it
let _gs = null, _gr = null, _gm = null, _fp = null, _dd = null;
async function grantShapeMod() { return _gs || (_gs = await import("../shared/grantShape.js")); }
async function renewalMod() { return _gr || (_gr = await import("../shared/grantRenewal.js")); }
async function grantMsMod() { return _gm || (_gm = await import("../shared/grantMilestones.js")); }
async function fiscalMod() { return _fp || (_fp = await import("../shared/fiscalPeriod.js")); }
async function displayDateMod() { return _dd || (_dd = await import("../shared/displayDate.js")); }

// ── THE NUMBERS ─────────────────────────────────────────────────────────────
async function overview(orgId, role) {
  const { query, orgTime } = C;
  const G = await grantShapeMod(), FP = await fiscalMod(), DD = await displayDateMod();
  const [org] = await query(`SELECT id, timezone, vocabulary_json, grant_goal_cents FROM orgs WHERE id = ?`, [orgId]);
  const today = orgTime.orgToday(org || {});                        // ORG_TZ_SEAM_OK
  const fy = orgTime.orgPeriodBounds(org || {}, "fiscal_year");
  const startMonth = orgTime.orgFiscalStartMonth(org || {});
  const yearLabel = FP.fyLabelFromStart(Number(fy.start.slice(0, 4)), startMonth);
  const fig = source => figureSources.figure(orgId, source, {}, { rows: false });
  const yearParams = { from: fy.start, to: fy.end, fiscal: "true" };

  const stageSources = G.GRANT_STATUSES.map(s => ({ key: "grants-stage", params: { status: s.key } }));
  const winTypes = ["all", ...G.FUNDER_TYPE_KEYS, "none"];
  const winSources = winTypes.map(t => ({ key: "grant-win-rate", params: t === "all" ? {} : { funderType: t } }));
  const deadlineSources = DEADLINE_WINDOWS.map(d => ({ key: "grant-deadlines", params: { days: String(d), today } }));
  const awardedSource = { key: "grants-awarded-year", params: yearParams };
  const goalSource = { key: "grant-goal", params: {} };
  const progressSource = { key: "grant-goal-progress", params: yearParams };
  const reportsSource = { key: "grant-reports-due", params: {} };

  // One parallel batch: sequential reads on prod cost ~65ms each (FIX-21).
  const [stages, wins, deadlines, awarded, goal, progress, reports] = await Promise.all([
    Promise.all(stageSources.map(fig)), Promise.all(winSources.map(fig)), Promise.all(deadlineSources.map(fig)),
    fig(awardedSource), fig(goalSource), fig(progressSource), fig(reportsSource),
  ]);

  const goalSet = org && org.grant_goal_cents !== null && org.grant_goal_cents !== undefined;
  return {
    today,
    year: { from: fy.start, to: fy.end, label: yearLabel, convention: "fiscal",
            sentence: `The year on this screen is your fiscal year, ${yearLabel}: ${DD.displayDate(fy.start)} to ${DD.displayDate(fy.end)}.` },
    stages: G.GRANT_STATUSES.map((s, i) => ({
      status: s.key, label: s.label, kind: s.kind, value: stages[i].value, cents: stages[i].cents,
      count: stages[i].totalRows, sentence: stages[i].sentence, source: stageSources[i],
    })),
    awarded: { value: awarded.value, cents: awarded.cents, count: awarded.totalRows, sentence: awarded.sentence, source: awardedSource },
    goal: { set: !!goalSet, value: goalSet ? goal.value : null, cents: goalSet ? goal.cents : null,
            sentence: goal.sentence, source: goalSource, canEdit: role === "admin" },
    progress: { value: progress.value, blank: progress.blank, sentence: progress.sentence, source: progressSource },
    winRates: winTypes.map((t, i) => {
      const f = wins[i];
      const [won, decided] = f.parts;
      return {
        funderType: t, label: t === "all" ? "Every funder" : t === "none" ? "No type on file" : G.funderTypeLabel(t),
        value: f.value, blank: f.blank, sentence: f.sentence, source: winSources[i],
        won: { value: won.value, sentence: won.sentence, source: won.source },
        decided: { value: decided.value, sentence: decided.sentence, source: decided.source },
      };
    }).filter(w => w.funderType === "all" || w.decided.value > 0),
    deadlines: DEADLINE_WINDOWS.map((d, i) => ({ days: d, count: deadlines[i].value, sentence: deadlines[i].sentence, source: deadlineSources[i] })),
    reportsDue: { count: reports.value, sentence: reports.sentence, source: reportsSource },
  };
}

// ── THE RENEWAL ─────────────────────────────────────────────────────────────
// For a grant whose funder is on file: a new grant at Prospecting (funder,
// program and officer copied, asking for what the old one was awarded, or
// requested) and one dated deadline on it, which puts it on the Calendar.
// Idempotent: a grant that already has its renewal returns that one. When no
// date can be planned it plans nothing and says why.
//   who: { id, name } — a user, or a system:<path> identity.
async function planRenewal(orgId, grantId, who) {
  if (!C) throw new Error("grantReports: planRenewal called before mount");
  const { query, withTransaction, uuid, orgTz, orgToday } = C;
  const G = await grantShapeMod(), R = await renewalMod(), GM = await grantMsMod(), DD = await displayDateMod();
  const actorId = (who && who.id) || "system:grants/renewal";
  const actorName = (who && who.name) || "Steward (renewal planner)";
  const [g] = await query(
    `SELECT g.*, d.id AS fid, d.name AS fname, d.funder_cycle, d.funder_due_months
       FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
      WHERE g.id = ? AND g.org_id = ?`, [grantId, orgId]);
  if (!g) return { notFound: true, sentence: "That grant is not on file." };
  if (!g.fid) {
    return { skipped: true, sentence: `This grant is not linked to a funder record, so there is no renewal to plan. Link ${g.funder || "the funder"} to their record first.` };
  }
  const already = await existingRenewal(orgId, g.id);
  if (already) return { ...already, existing: true, sentence: `The renewal with ${g.fname} is already planned${already.dueDate ? `: ${GM.milestoneLabel(already.kind) || "the first deadline"} ${DD.displayDate(already.dueDate)}` : ""}.` };

  const today = orgToday(await orgTz(orgId));                        // ORG_TZ_SEAM_OK
  const plan = R.nextRenewalDate({ cycle: g.funder_cycle, dueMonths: g.funder_due_months, closedOn: g.closed_on, today, funderName: g.fname });
  if (!plan.date) return { skipped: true, sentence: plan.sentence };

  const ms = await query(`SELECT kind FROM grant_milestones WHERE org_id = ? AND grant_id = ?`, [orgId, g.id]);
  let hist = [];
  try { hist = JSON.parse(g.history || "[]"); } catch { hist = []; }
  const statuses = (Array.isArray(hist) ? hist : []).map(x => (typeof x === "string" ? x : x && (x.status || x.to || x.stage))).filter(Boolean);
  const kind = R.renewalKind({ milestoneKinds: ms.map(m => m.kind), statuses });
  const awardedC = money.toCents(g.amount_awarded) || 0;
  const requestedC = money.toCents(g.amount_requested != null ? g.amount_requested : g.amount) || 0;
  const askC = awardedC || requestedC;

  const out = await withTransaction(async c => {
    // Two presses at once plan one renewal: the second waits here, then finds it.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`grant-renewal:${orgId}:${g.id}`]);
    const ex = await c.query(`SELECT id FROM grants WHERE org_id = $1 AND renewal_of = $2 LIMIT 1`, [orgId, g.id]);
    if (ex.rows[0]) return { existingId: ex.rows[0].id };
    const id = "gr_" + uuid().slice(0, 8);
    await c.query(
      `INSERT INTO grants (id, org_id, funder, funder_donor_id, program, amount, amount_requested, status, deadline,
                           officer_id, officer, notes, renewal_of, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'researching',$8,$9,$10,$11,$12,$13,$14)`,
      [id, orgId, g.fname, g.fid, g.program || "", Math.round(askC / 100), money.toDollars(askC), plan.date,
       g.officer_id || null, g.officer || "", `The renewal of the ${g.program || "grant"} grant${g.closed_on ? ` that closed ${DD.displayDate(g.closed_on)}` : ""}.`,
       g.id, actorId, actorName]);
    const msId = "gms_" + uuid().slice(0, 10);
    await c.query(
      `INSERT INTO grant_milestones (id, org_id, grant_id, kind, due_date, state, notes, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)`,
      [msId, orgId, id, kind, plan.date, plan.sentence.slice(0, 2000), actorId, actorName]);
    return { id };
  });
  if (out.existingId) {
    const again = await existingRenewal(orgId, g.id);
    return { ...again, existing: true, sentence: `The renewal with ${g.fname} is already planned.` };
  }
  return {
    renewalGrantId: out.id, dueDate: plan.date, kind,
    sentence: `Planned the renewal with ${g.fname}: ${GM.milestoneLabel(kind)} ${DD.displayDate(plan.date)}, now on the Calendar. ${plan.sentence}`,
  };
}

async function existingRenewal(orgId, grantId) {
  const [r] = await C.query(
    `SELECT g.id,
            (SELECT m.due_date FROM grant_milestones m WHERE m.org_id = g.org_id AND m.grant_id = g.id
                AND m.kind IN ('loi_due','proposal_due') AND m.state NOT IN ('done','skipped') ORDER BY m.due_date LIMIT 1) AS due_date,
            (SELECT m.kind FROM grant_milestones m WHERE m.org_id = g.org_id AND m.grant_id = g.id
                AND m.kind IN ('loi_due','proposal_due') AND m.state NOT IN ('done','skipped') ORDER BY m.due_date LIMIT 1) AS kind
       FROM grants g WHERE g.org_id = ? AND g.renewal_of = ? ORDER BY g.created_at LIMIT 1`, [orgId, grantId]);
  return r ? { renewalGrantId: r.id, dueDate: r.due_date || null, kind: r.kind || null } : null;
}

// What makes a planned renewal "touched": anything anybody did to it after
// Steward planned it. Then Undo leaves it alone, and it is deleted (or kept)
// from the grant itself like any other.
async function renewalTouched(orgId, rid) {
  const [r] = await C.query(
    `SELECT g.status, EXTRACT(EPOCH FROM (g.updated_at - g.created_at)) AS edited_after,
            (SELECT COUNT(*)::int FROM grant_milestones m WHERE m.org_id = g.org_id AND m.grant_id = g.id) AS ms_all,
            (SELECT COUNT(*)::int FROM grant_milestones m WHERE m.org_id = g.org_id AND m.grant_id = g.id
                AND (m.state <> 'pending' OR m.thread_id IS NOT NULL OR m.updated_at > m.created_at + INTERVAL '2 seconds')) AS ms_moved,
            (SELECT COUNT(*)::int FROM grant_documents x WHERE x.org_id = g.org_id AND x.grant_id = g.id)
          + (SELECT COUNT(*)::int FROM grant_reports x WHERE x.org_id = g.org_id AND x.grant_id = g.id)
          + (SELECT COUNT(*)::int FROM grant_spend x WHERE x.org_id = g.org_id AND x.grant_id = g.id)
          + (SELECT COUNT(*)::int FROM grant_sends x WHERE x.org_id = g.org_id AND x.grant_id = g.id)
          + (SELECT COUNT(*)::int FROM grant_interactions x WHERE x.grant_id = g.id)
          + (SELECT COUNT(*)::int FROM tasks x WHERE x.org_id = g.org_id AND x.grant_id = g.id) AS children
       FROM grants g WHERE g.org_id = ? AND g.id = ?`, [orgId, rid]);
  if (!r) return true;
  const G = await grantShapeMod();
  return G.normalizeStatus(r.status) !== "researching" || Number(r.edited_after) > 2
    || r.ms_all > 1 || r.ms_moved > 0 || r.children > 0;
}

function mount(ctx) {
C = ctx;
const { query, run, wrap, requireAuth, requireAdmin, requireCrm, checkWriteAccess, actor, withTransaction } = ctx;
const app = routers.r0;

app.get("/grant-overview", requireAuth, wrap(async (req, res) => {
  res.json(await overview(req.user.orgId, req.user.role));
}));

app.put("/org/grant-goal", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const raw = (req.body || {}).goalCents;
  const goal = raw === null || raw === "" ? null : Number(raw);
  if (goal !== null && (!Number.isInteger(goal) || goal < 0 || goal > GOAL_MAX_CENTS)) {
    return res.status(400).json({ error: "The grant goal is a whole number of cents, zero or more.", code: "invalid_goal" });
  }
  const orgId = req.user.orgId;
  const [before] = await query(`SELECT grant_goal_cents FROM orgs WHERE id = ?`, [orgId]);
  await run(`UPDATE orgs SET grant_goal_cents = ? WHERE id = ?`, [goal, orgId]);
  const prev = before && before.grant_goal_cents != null ? Number(before.grant_goal_cents) : null;
  if (req.audit) req.audit.entity("org", orgId, "Grant goal");
  res.json({
    goalCents: goal, previousGoalCents: prev,
    sentence: goal === null ? "The grant goal is cleared." : `The grant goal is now ${money.formatCentsPlain(goal)}.`,
  });
}));

app.post("/grants/:id/plan-renewal", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const out = await planRenewal(req.user.orgId, String(req.params.id), actor(req));
  if (out.notFound) return res.status(404).json({ error: out.sentence });
  // Improve the one audit row: a planned renewal names the grant it made; a
  // press that planned nothing (skipped, or already planned) records nothing.
  if (req.audit) {
    if (out.renewalGrantId && !out.existing) { req.audit.entity("grant", out.renewalGrantId); req.audit.action("planned renewal"); req.audit.summary(out.sentence); }
    else req.audit.skip(out.existing ? "renewal already planned" : "no renewal date to plan");
  }
  res.status(out.renewalGrantId && !out.existing ? 201 : 200).json({ ...out, undoSeconds: out.renewalGrantId && !out.existing ? UNDO_SECONDS : undefined });
}));

app.post("/grants/:id/renewal/undo", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query(`SELECT id FROM grants WHERE id = ? AND org_id = ?`, [String(req.params.id), orgId]);
  if (!g) return res.status(404).json({ error: "That grant is not on file." });
  const ren = await existingRenewal(orgId, g.id);
  if (!ren) return res.status(404).json({ error: "There is no planned renewal to take back." });
  if (await renewalTouched(orgId, ren.renewalGrantId)) {
    return res.status(409).json({ error: "The renewal has been worked on since it was planned, so it stays. Delete it from the grant itself if it is not wanted.", code: "renewal_touched" });
  }
  await withTransaction(async c => {
    await c.query(`DELETE FROM grant_milestones WHERE org_id = $1 AND grant_id = $2`, [orgId, ren.renewalGrantId]);
    await c.query(`DELETE FROM grants WHERE org_id = $1 AND id = $2 AND renewal_of = $3`, [orgId, ren.renewalGrantId, g.id]);
  });
  if (req.audit) { req.audit.entity("grant", ren.renewalGrantId); req.audit.action("took back planned renewal"); }
  res.json({ removed: true, renewalGrantId: ren.renewalGrantId, sentence: "The planned renewal is taken back, and its deadline is off the Calendar." });
}));
}

module.exports = { routers, mount, planRenewal };
