// server/majorGifts/routes.js — the pipeline, portfolios, moves, opportunities and the major gifts dashboard.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ALL_PIPELINE_STAGES, OU, STAGE_WEIGHT, actor, autoLapseOrg, checkWriteAccess, computeDriftForDonors,
  driftBadgeField, inOrgDays, inviteeDisplayName, money, openProposalConflict, orgOwns, orgPeriodBounds,
  orgPlanTier, orgTime, orgToday, orgTz, parseMoneyOrThrow, portfolioMembership, proposalMod, query,
  recordMove, requireAdmin, requireAuth, requireCrm, run, toCents, toDollars, uuid, wrap,
} = ctx;

// Signal-based move SUGGESTIONS for a donor (never auto-applied). The officer
// reviews and one-click accepts (which applies via the normal move route) or
// dismisses. Pure function over the donor row + light context.
function computeMoveSuggestions(donor, ctx = {}) {
  const out = [];
  const stage = donor.stage;
  const giftCount = Number(donor.gift_count) || 0;
  const lastGift = donor.last_gift_date && donor.last_gift_date !== "" ? donor.last_gift_date : null;
  const daysSinceGift = lastGift ? Math.floor((Date.now() - new Date(lastGift)) / 86400000) : null;
  // FIX-51: the org's civil today, for the one lapse rule (the caller passes it).
  // FIX-60: ctx.pledges (shared/numbers/lapse.js pledgesFor) holds a pledger off lapsing.
  const quietState = lastGift && ctx.today ? lapseRule.lapseState(lastGift, ctx.today, ctx.rhythm || null, ctx.pledges || null) : null;
  // First gift in hand but still parked at prospect → qualify them.
  if (giftCount >= 1 && stage === "prospect") {
    out.push({ signal: "first_gift", toStage: "qualify",
      reason: "First gift received, qualify this donor and start cultivating." });
  }
  // A gift landed while being solicited → the ask effectively closed; steward.
  if (stage === "solicit" && daysSinceGift != null && daysSinceGift <= 90) {
    out.push({ signal: "gift_after_solicit", toStage: "steward",
      reason: "A gift landed after your solicitation, move to Stewardship." });
  }
  // In active cultivation but lapsing (9 to 12 months, the one rule) → take a look.
  if (["qualify", "cultivate"].includes(stage) && quietState === "lapsing") {
    out.push({ signal: "going_quiet", toStage: null,
      reason: `No gift in ${Math.round(daysSinceGift / 30)} months, reach out before they lapse.` });
  }
  return out;
}
let app = routers.r1;

// ── Officer portfolios + color (BUILD-14, Team plan) ───────────────────────
// Read is ungated (a Core org still sees its officers), but returns `tier` +
// `single_user` so the UI locks the color feature and hides it for a
// one-person shop. Assigning a color is Team-only and admin-gated.
app.get("/portfolio/officers", requireAuth, wrap(async (req, res) => {
  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";
  // portfolio_count/giving use the SAME definition as Home's cards + the board
  // (BUILD-30): assigned donors in a pipeline stage. The stage guard lives in the
  // JOIN so a non-pipeline-stage donor can't inflate the legend past the board.
  const officers = await query(
    `SELECT u.id, u.name, u.email, u.role, u.portfolio_color,
            COUNT(d.id)::int AS portfolio_count, COALESCE(SUM(d.total_giving),0) AS portfolio_giving
     FROM users u
     LEFT JOIN donors d ON d.assigned_to = u.id AND d.org_id = u.org_id AND d.deleted_at IS NULL AND COALESCE(d.stage, d.suggested_stage) = ANY(?)
     WHERE u.org_id=? GROUP BY u.id ORDER BY portfolio_giving DESC, u.name`, [ALL_PIPELINE_STAGES, req.user.orgId]);
  // Pending invitees (invited, not yet accepted, unexpired) are surfaced too so
  // the import officer-mapping screen can match + assign donors to them BEFORE
  // they accept (the assignment resolves into their portfolio on acceptance).
  // Includes each invite's held pending-donor count so the UI can show it.
  const invites = await query(
    `SELECT i.id, i.email,
            COUNT(d.id)::int AS pending_count
       FROM invites i
       LEFT JOIN donors d ON d.pending_assignee_invite_id = i.id AND d.org_id = i.org_id AND d.deleted_at IS NULL
      WHERE i.org_id=? AND i.accepted_at IS NULL AND i.expires_at > NOW()
      GROUP BY i.id, i.email ORDER BY i.created_at DESC`, [req.user.orgId]);
  res.json({
    tier,
    single_user: officers.length <= 1,
    officers: officers.map(o => ({
      ...o,
      portfolio_count: parseInt(o.portfolio_count, 10) || 0,
      portfolio_giving: parseFloat(o.portfolio_giving) || 0,
    })),
    invites: invites.map(i => ({ id: i.id, email: i.email, name: inviteeDisplayName(i.email), pending_count: parseInt(i.pending_count, 10) || 0 })),
  });
}));

app.put("/portfolio/officers/:userId/color", requireAuth, requireAdmin, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { color } = req.body;
  if (color && !/^#[0-9a-fA-F]{6}$/.test(String(color))) return res.status(400).json({ error: "Color must be a 6-digit hex like #1a6b4a." });
  const u = await query("SELECT id FROM users WHERE id=? AND org_id=?", [req.params.userId, req.user.orgId]);
  if (!u.length) return res.status(404).json({ error: "Officer not found" });
  await run("UPDATE users SET portfolio_color=? WHERE id=? AND org_id=?", [color || null, req.params.userId, req.user.orgId]);
  res.json({ ok: true, userId: req.params.userId, color: color || null });
}));

// ── Moves management & prospect pipeline (BUILD-15, Team plan) ─────────────
// The whole pipeline is a staffed-office capability → Team. Reads return a
// `tier`/`locked` flag rather than 403'ing so a Core org renders a graceful
// "upgrade to manage a major-gifts pipeline" state, not a broken tab. Every
// WRITE (move, opportunity) is hard requireCrm('team') + checkWriteAccess.

// GET /pipeline — the board: prospects grouped by stage, officer color map,
// ask amount + stage age + next task per card, and the forecast. Batched
// queries only (no N+1). Optional ?assignedTo= (portfolio) and ?designation=.
app.get("/pipeline", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";
  const stages = ALL_PIPELINE_STAGES.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
  // Core orgs get a READ-only locked preview populated with their OWN data
  // (the board derives entirely from donors.stage / opportunities / moves /
  // tasks — all org-scoped reads a Core user already has). Writes stay hard-
  // gated on POST /pipeline/:donorId/move (requireCrm('team') → 403), so this
  // only softens the read presentation; it does not open a write path.
  const locked = tier !== "team";

  const officers = await query(
    "SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const single_user = officers.length <= 1;

  // BUILD-32 Part 4 — the "My portfolio / All portfolios" toggle (and the
  // officer filter) is meaningless unless 2+ officers actually have donors to
  // work. Count distinct officers with ≥1 ASSIGNED donor in a pipeline stage
  // (the same membership definition the board uses). `multiOfficer` drives
  // hiding the single-value pickers client-side; `canViewAll` still gates on
  // admin (a lone admin sees no toggle even though they could "view all").
  const distinctOfficers = await query(
    `SELECT COUNT(DISTINCT assigned_to)::int AS c FROM donors
       WHERE org_id=? AND assigned_to IS NOT NULL AND deleted_at IS NULL
         AND stage = ANY(?)`, [orgId, ALL_PIPELINE_STAGES]);
  const multiOfficer = (distinctOfficers[0]?.c || 0) >= 2;

  // ── The board is a PORTFOLIO, not the donor list ─────────────────────────
  // Membership = ASSIGNMENT (BUILD-30): a donor assigned to an officer is on
  // that officer's board, full stop. There is no separate "on the board" flag.
  // Unassigned (e.g. bulk-imported) donors match nothing here — they live in
  // the Directory with their stage LABEL and never flood this board. `scope`
  // defaults to the caller's own portfolio; a specific `assignedTo` overrides.
  // The exact same `portfolioMembership` helper feeds Home's Portfolio and
  // Pipeline cards, so all three counts are one number by construction.
  // Cross-officer visibility ("All portfolios", or filtering to another officer)
  // is an ADMIN/ED oversight view — the whole-shop forecast Team sells. An
  // individual officer only ever sees their OWN portfolio (BUILD-31 Part 4).
  // Enforced server-side, not just hidden in the UI: a non-admin's scope=all or
  // foreign assignedTo is downgraded to their own portfolio.
  const isAdmin = req.user.role === "admin";
  let scope = req.query.scope === "all" ? "all" : "mine";
  let assignedTo = req.query.assignedTo || null;
  if (!(await OU.orgUser(orgId, assignedTo, { allowInactive: true })).ok) return OU.refuse(res, "assignedTo");
  if (!isAdmin) {
    scope = "mine";
    if (assignedTo && assignedTo !== userId) assignedTo = null;
  }
  const membership = portfolioMembership({ orgId, userId, scope, assignedTo, alias: "d" });
  const filters = [membership.where];
  const params = [...membership.params];
  if (req.query.designation) {
    filters.push("EXISTS (SELECT 1 FROM donor_designations dd WHERE dd.donor_id = d.id AND dd.org_id = d.org_id AND dd.kind = ?)");
    params.push(req.query.designation);
  }
  if (req.query.search && String(req.query.search).trim()) {
    filters.push("LOWER(d.name) LIKE ?"); params.push("%" + String(req.query.search).trim().toLowerCase() + "%");
  }
  const minGiving = parseFloat(req.query.minGiving);
  if (Number.isFinite(minGiving) && minGiving > 0) { filters.push("d.total_giving >= ?"); params.push(minGiving); }

  const donors = await query(
    `SELECT d.id, d.name, COALESCE(d.stage, d.suggested_stage) AS stage, (d.stage IS NULL) AS stage_suggested,
            d.total_giving, d.last_gift_date, d.assigned_to, d.assigned_to_name, d.updated_at, d.created_at
       FROM donors d WHERE ${filters.join(" AND ")}`, params);

  // Open asks aggregated per donor (org-wide, joined in JS).
  const oppAgg = await query(
    `SELECT donor_id, COALESCE(SUM(target_amount),0) AS ask, COUNT(*)::int AS cnt
       FROM opportunities WHERE org_id=? AND status='open' GROUP BY donor_id`, [orgId]);
  const askByDonor = Object.fromEntries(oppAgg.map(o => [o.donor_id, { ask: parseFloat(o.ask) || 0, cnt: o.cnt }]));

  // Most recent move INTO the donor's current stage → stage age.
  const lastMoves = await query(
    `SELECT DISTINCT ON (donor_id, to_stage) donor_id, to_stage, created_at
       FROM moves WHERE org_id=? ORDER BY donor_id, to_stage, created_at DESC`, [orgId]);
  const moveInto = {};
  for (const m of lastMoves) moveInto[m.donor_id + "|" + m.to_stage] = m.created_at;

  // Next open task per donor (earliest due).
  const nextTasks = await query(
    `SELECT DISTINCT ON (donor_id) donor_id, title, due FROM tasks
       WHERE org_id=? AND done=0 AND voided_at IS NULL AND donor_id IS NOT NULL
       ORDER BY donor_id, (NULLIF(due,'')) ASC NULLS LAST`, [orgId]);
  const taskByDonor = Object.fromEntries(nextTasks.map(t => [t.donor_id, { title: t.title, due: t.due }]));

  // BUILD-76 Part 2 — pipeline cards carry the drift badge, same computation
  // as the home list (scoped to the board's own donors).
  const boardIds = donors.map(d => d.id);
  const { map: driftMap } = await computeDriftForDonors(orgId, { donorIds: boardIds.length ? boardIds : ["_none_"] });

  const now = Date.now();
  const columns = {}; ALL_PIPELINE_STAGES.forEach(s => { columns[s] = []; });
  let forecastOpen = 0, forecastWeighted = 0, openCount = 0;
  for (const d of donors) {
    const a = askByDonor[d.id] || { ask: 0, cnt: 0 };
    forecastOpen += a.ask; openCount += a.cnt;
    forecastWeighted += a.ask * (STAGE_WEIGHT[d.stage] || 0);
    const enteredStage = moveInto[d.id + "|" + d.stage] || d.updated_at || d.created_at;
    const stageAge = enteredStage ? Math.max(0, Math.floor((now - new Date(enteredStage).getTime()) / 86400000)) : null;
    (columns[d.stage] = columns[d.stage] || []).push({
      donorId: d.id, name: d.name, stage: d.stage,
      // BUILD-83 Part 3.5 — the card says whether a human placed this donor or
      // the giving history merely suggests it.
      stageSuggested: d.stage_suggested === true || d.stage_suggested === "t",
      totalGiving: parseFloat(d.total_giving) || 0,
      lastGiftDate: d.last_gift_date || null,
      assignedTo: d.assigned_to, assignedToName: d.assigned_to_name,
      askAmount: a.ask, openOppCount: a.cnt, stageAge,
      nextTask: taskByDonor[d.id] || null,
      drift: driftBadgeField(driftMap.get(d.id)),
    });
  }

  // Sort each column + cap the payload so a large portfolio never ships (or
  // renders) hundreds of cards. counts[stage] carries the TRUE size so the UI
  // can show "showing N of M". Sorts: value (default), last gift, stage age.
  const sort = ["value", "last_gift", "stage_age"].includes(req.query.sort) ? req.query.sort : "value";
  const cmp = {
    value: (a, b) => (b.totalGiving - a.totalGiving) || (b.askAmount - a.askAmount),
    last_gift: (a, b) => (b.lastGiftDate ? Date.parse(b.lastGiftDate) : 0) - (a.lastGiftDate ? Date.parse(a.lastGiftDate) : 0),
    stage_age: (a, b) => (b.stageAge || 0) - (a.stageAge || 0),
  }[sort];
  const PER_COLUMN_CAP = 200;
  const counts = {};
  for (const s of ALL_PIPELINE_STAGES) {
    counts[s] = columns[s].length;
    columns[s].sort(cmp);
    if (columns[s].length > PER_COLUMN_CAP) columns[s] = columns[s].slice(0, PER_COLUMN_CAP);
  }

  // Won this quarter (period) — a coarse pipeline health figure.
  const { start } = NUMBERS.fiscalYear.period(await orgTz(req.user.orgId), "fiscal", 0);   // ORG_TZ_SEAM_OK
  const wonAgg = await query(
    `SELECT COALESCE(SUM(gift_amount),0) AS amt, COUNT(*)::int AS cnt FROM opportunities
       WHERE org_id=? AND status='won' AND ${inOrgDays("closed_at", "org_id", "?", null)}`, [orgId, start]);
  res.json({
    tier, locked, single_user, multiOfficer, stages, scope, sort, canViewAll: isAdmin,
    officers: officers.map(o => ({ id: o.id, name: o.name, color: o.portfolio_color })),
    columns, counts, total: donors.length, cap: PER_COLUMN_CAP,
    forecast: {
      open: Math.round(forecastOpen), weighted: Math.round(forecastWeighted), openCount,
      wonThisPeriod: parseFloat(wonAgg[0].amt) || 0, wonCount: wonAgg[0].cnt,
    },
  });
}));

// POST /pipeline/add — the deliberate act that puts prospects on the working
// board (single or bulk via `ids`). Assignment IS membership (BUILD-30), so
// "add to my pipeline" = assign to the caller (donors nobody owns yet land on
// the caller's own board; already-owned donors stay with their owner). No
// separate flag. Cross-officer assignment stays the admin `/donors/bulk-assign`.
// Team + write-gated.
app.post("/pipeline/add", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "ids array required" });
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL", [ids, req.user.orgId]);
  if (owned.length !== ids.length) return res.status(404).json({ error: "One or more donors not found in your org" });
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const myName = userRow[0]?.name || "";
  const result = await run(
    `UPDATE donors
        SET assigned_to      = COALESCE(assigned_to, ?),
            assigned_to_name = COALESCE(assigned_to_name, ?),
            updated_at = NOW()
      WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [req.user.userId, myName, ids, req.user.orgId]);
  res.json({ added: result.changes });
}));

// POST /pipeline/remove — take a donor OFF the working board (single or bulk).
// Assignment IS membership (BUILD-30), so removing from the board = unassigning;
// the donor stays in the Directory with its stage label untouched. Team +
// write-gated (a curation write, not a delete).
app.post("/pipeline/remove", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "ids array required" });
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL", [ids, req.user.orgId]);
  if (owned.length !== ids.length) return res.status(404).json({ error: "One or more donors not found in your org" });
  const result = await run(
    `UPDATE donors SET assigned_to = NULL, assigned_to_name = NULL, updated_at = NOW()
      WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [ids, req.user.orgId]);
  res.json({ removed: result.changes });
}));

// POST /pipeline/:donorId/move — the managed stage change. Description REQUIRED.
app.post("/pipeline/:donorId/move", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { toStage, description } = req.body;
  if (!ALL_PIPELINE_STAGES.includes(toStage)) return res.status(400).json({ error: "Invalid stage" });
  if (!description || !String(description).trim()) return res.status(400).json({ error: "A description of the move is required." });
  const rows = await query("SELECT stage FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.donorId, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });
  const fromStage = rows[0].stage;
  if (fromStage === toStage) return res.status(400).json({ error: "Donor is already in that stage." });

  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const officerName = userRow[0]?.name || "";
  await run("UPDATE donors SET stage=?, updated_at=NOW() WHERE id=? AND org_id=?", [toStage, req.params.donorId, req.user.orgId]);
  const moveId = await recordMove(req.user.orgId, req.params.donorId, req.user.userId, officerName, fromStage, toStage, String(description).trim());
  // Keep the donor timeline consistent with the legacy stage_change path.
  try {
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_" + uuid().slice(0, 8), req.user.orgId, req.params.donorId, "stage_change",
       `Moved ${fromStage || "Not set"} → ${toStage}: ${String(description).trim()}`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, officerName]);   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
  } catch (e) { console.error("move interaction log:", e.message); }
  res.status(201).json({ ok: true, moveId, stage: toStage, fromStage });
}));

// GET /donors/:id/move-suggestions — signal-based suggestions (BUILD-22).
// A read: never changes stage. The officer accepts (→ POST /pipeline/:id/move)
// or dismisses. Org-scoped; foreign donor → 404.
app.get("/donors/:id/move-suggestions", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });
  const _msToday = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
  res.json({ suggestions: computeMoveSuggestions(rows[0], { today: _msToday, pledges: await require("../../shared/numbers/lapse").pledgesFor(query, req.user.orgId, rows[0].id, _msToday) }) });
}));

// POST /pipeline/run-auto-lapse — run the auto-lapse sweep for the caller's org
// now (drives the exact scheduled path; for ops + tests). Admin-only, same bar
// as /sequences/process and /recurring/process-dunning.
app.post("/pipeline/run-auto-lapse", requireAuth, requireAdmin, wrap(async (req, res) => {
  const moved = await autoLapseOrg(req.user.orgId);
  res.json({ moved });
}));

// GET /donors/:id/moves — full move history for a constituent.
app.get("/donors/:id/moves", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    "SELECT id, officer_id, officer_name, from_stage, to_stage, description, created_at FROM moves WHERE org_id=? AND donor_id=? ORDER BY created_at DESC",
    [req.user.orgId, req.params.id]);
  res.json(rows);
}));

// GET /donors/:id/opportunities — asks on a prospect.
app.get("/donors/:id/opportunities", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    "SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE org_id=? AND donor_id=? ORDER BY (status='open') DESC, created_at DESC",
    [req.user.orgId, req.params.id]);
  res.json(rows.map(o => ({ ...o, target_amount: parseFloat(o.target_amount) || 0, gift_amount: o.gift_amount == null ? null : parseFloat(o.gift_amount) })));
}));

app.post("/donors/:id/opportunities", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { name, targetAmount, expectedClose } = req.body;
  const amt = parseFloat(targetAmount);
  if (!(amt > 0)) return res.status(400).json({ error: "A positive target ask amount is required." });
  const d = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  // Officer = the donor's relationship owner; falls back to the creating user.
  let officerId = d[0].assigned_to, officerName = d[0].assigned_to_name;
  if (!officerId) { officerId = req.user.userId; const u = await query("SELECT name FROM users WHERE id=?", [req.user.userId]); officerName = u[0]?.name || ""; }
  // BUILD-99 Part 1 — THIS DOOR AND THE PROPOSALS DOOR ARE ONE OBJECT, so they
  // obey one rule. An ask written here is a proposal at stage `asked` (BUILD-15's
  // own word for what target_amount is), its status is DERIVED from that stage by
  // the one derivation, and "one open at a time per fund" applies — because two
  // doors with two rules over the same rows is how a double-ask gets in. This
  // NARROWS BUILD-15, which allowed several open asks on one prospect; the
  // narrowing is the brief's, and `tests/moves.test.js` was updated to match.
  const P99 = await proposalMod();
  const clash = await openProposalConflict(req.user.orgId, req.params.id, null, null);
  if (clash) return res.status(409).json(clash);
  const id = "opp_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,proposal_stage,officer_id,officer_name,expected_close,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, (name || "").trim() || "Ask", amt,
     P99.statusForStage("asked"), "asked", officerId, officerName || "", expectedClose || null, actor(req).id, actor(req).name]);
  const rows = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=?", [id]);
  res.status(201).json({ ...rows[0], target_amount: parseFloat(rows[0].target_amount) || 0 });
}));

// PUT /opportunities/:id — edit, or close won/lost. Closing 'won' links the
// real gift and records the actual gift amount (the ask-vs-gift accountability).
app.put("/opportunities/:id", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const existing = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Opportunity not found" });
  const { name, targetAmount, expectedClose, status, giftId, giftAmount } = req.body;
  const sets = [], params = [];
  if (name !== undefined) { sets.push("name=?"); params.push((name || "").trim() || "Ask"); }
  if (targetAmount !== undefined) { const a = parseFloat(targetAmount); if (!(a > 0)) return res.status(400).json({ error: "Target ask amount must be positive." }); sets.push("target_amount=?"); params.push(a); }
  if (expectedClose !== undefined) { sets.push("expected_close=?"); params.push(expectedClose || null); }
  if (status !== undefined) {
    if (!["open", "won", "lost"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    sets.push("status=?"); params.push(status);
    // BUILD-99 Part 1 — THE STAGE MOVES WITH THE STATUS, ALWAYS. A status
    // written here without its stage would leave the Proposals screen showing
    // "Asked" on a row the board calls won: one object, two truths, and the way
    // they disagree is a board report that is wrong. `stageFromLegacyStatus` is
    // the same mapping the migration used, so this door and that one agree.
    const P99 = await proposalMod();
    sets.push("proposal_stage=?"); params.push(P99.stageFromLegacyStatus(status));
    if (status === "won") {
      let amt = giftAmount != null ? parseFloat(giftAmount) : null;
      let gId = giftId || null;
      if (gId) {
        const g = await query("SELECT amount FROM gifts WHERE id=? AND org_id=?", [gId, req.user.orgId]);
        if (!g.length) return res.status(404).json({ error: "Linked gift not found" });
        if (amt == null) amt = parseFloat(g[0].amount) || 0;
      }
      sets.push("gift_id=?", "gift_amount=?", "closed_at=NOW()"); params.push(gId, amt);
    } else if (status === "lost") {
      sets.push("gift_id=NULL", "gift_amount=NULL", "closed_at=NOW()");
    } else { // reopen
      sets.push("gift_id=NULL", "gift_amount=NULL", "closed_at=NULL");
    }
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.id, req.user.orgId);
  await run(`UPDATE opportunities SET ${sets.join(",")} WHERE id=? AND org_id=?`, params);
  const rows = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=?", [req.params.id]);
  res.json({ ...rows[0], target_amount: parseFloat(rows[0].target_amount) || 0, gift_amount: rows[0].gift_amount == null ? null : parseFloat(rows[0].gift_amount) });
}));

app.delete("/opportunities/:id", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM opportunities WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));

// ── BUILD-99 (major gifts) Part 2 — PORTFOLIOS ─────────────────────────────
// `portfolioMembership` above is STILL the one definition of who is in a
// portfolio (BUILD-30, and it cost a build to settle). Nothing here forks it.
// What is new is what she puts AROUND that list: the order she reads it in, the
// target and count cap she typed, and who assigned each person to her.
async function portfolioMod() { return import("../../shared/portfolioShape.js"); }

// The org's own word for "major prospect", in cents. A threshold Steward chose
// would be a claim about what a big gift is at an organisation it knows nothing
// about — so the DEFAULT is $1,000 and the answer is the org's.
async function majorProspectCents(orgId) {
  const [o] = await query("SELECT major_prospect_cents FROM orgs WHERE id=?", [orgId]);
  const v = o && o.major_prospect_cents != null ? Number(o.major_prospect_cents) : 100000;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 100000;
}

// The officer whose portfolio is being read, resolved against THIS org. A
// non-admin may only read their own (the BUILD-31 rule: cross-officer visibility
// is the oversight Team sells, and it is admin-only) — and they are DOWNGRADED
// to their own rather than refused, which is the precedent that route set.
async function resolvePortfolioOfficer(req, wanted) {
  const isAdmin = req.user.role === "admin";
  const want = String(wanted || "").trim();
  const id = (!isAdmin || !want || want === "me") ? req.user.userId : want;
  const [u] = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [id, req.user.orgId]);
  if (!u) return null;
  return { id: u.id, name: u.name, downgraded: !isAdmin && want && want !== req.user.userId };
}

// ROUTE ORDER IS PART OF THE CONTRACT: this is declared BEFORE
// `/portfolio/:officerId` or Express matches "unassigned-prospects" as an
// officer id and answers 404 for a screen that is not asking about an officer
// at all. (`/portfolio/officers` sits further up the file for the same reason.)
// GET /portfolio/unassigned-prospects — lifetime over the ORG's threshold, no
// owner. This is the list to assign FROM, which is the only reason it exists.
app.get("/portfolio/unassigned-prospects", requireAuth, wrap(async (req, res) => {
  const PF = await portfolioMod();
  const orgId = req.user.orgId;
  const thresholdCents = await majorProspectCents(orgId);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await query(
    `SELECT id, name, email, kind, total_giving, gift_count, last_gift_date, stage, suggested_stage
       FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND assigned_to IS NULL
        AND pending_assignee_invite_id IS NULL
        AND is_sample IS NOT TRUE AND COALESCE(deceased,false) = false
        AND round(COALESCE(total_giving,0)::numeric * 100) >= ?
      ORDER BY total_giving DESC NULLS LAST, id
      LIMIT ?`, [orgId, thresholdCents, limit]);
  const [c] = await query(
    `SELECT COUNT(*)::int AS n FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND assigned_to IS NULL
        AND pending_assignee_invite_id IS NULL
        AND is_sample IS NOT TRUE AND COALESCE(deceased,false) = false
        AND round(COALESCE(total_giving,0)::numeric * 100) >= ?`, [orgId, thresholdCents]);
  res.json({
    thresholdCents, thresholdAmount: toDollars(thresholdCents),
    count: c.n, shown: rows.length,
    sentence: PF.unassignedSentence({ count: c.n, thresholdCents }, money.formatCentsPlain),
    prospects: rows.map(r => ({
      donorId: r.id, name: r.name, email: r.email, kind: r.kind || "person",
      lifetime: toDollars(toCents(r.total_giving) || 0), giftCount: Number(r.gift_count) || 0,
      lastGiftDate: r.last_gift_date || null, stage: r.stage || r.suggested_stage || null,
    })),
  });
}));

// GET /portfolio/:officerId — her people, in the order the brief asks for.
// ONE batch of reads (the BUILD-54 §1 pattern), never a query per person.
app.get("/portfolio/:officerId", requireAuth, wrap(async (req, res) => {
  const PF = await portfolioMod();
  const P = await proposalMod();
  const orgId = req.user.orgId;
  const officer = await resolvePortfolioOfficer(req, req.params.officerId);
  if (!officer) return res.status(404).json({ error: "Officer not found" });

  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const fy = orgPeriodBounds(org, "fiscal_year", 0);
  const fyYear = Number(String(fy.key).replace("fy:", ""));
  const today = orgToday(org);

  // THE MEMBERSHIP IS THE SHARED ONE. Read it, then decorate it.
  const m = portfolioMembership({ orgId, userId: officer.id, scope: "mine", assignedTo: officer.id, alias: "d" });
  const people = await query(
    `SELECT d.id, d.name, d.email, d.kind, d.stage, d.suggested_stage, d.total_giving,
            d.last_gift_date, d.last_gift_amount, d.assigned_by_name, d.assigned_at
       FROM donors d WHERE ${m.where} ORDER BY d.id`, m.params);
  const ids = people.map(p => p.id);

  const openAsk = new Map(), lastConv = new Map(), nextStep = new Map();
  if (ids.length) {
    for (const r of await query(
      `SELECT donor_id, COALESCE(SUM(target_amount),0) AS amt, COUNT(*)::int AS n
         FROM opportunities WHERE org_id=? AND donor_id = ANY(?) AND proposal_stage = ANY(?::text[])
        GROUP BY donor_id`, [orgId, ids, P.OPEN_STAGE_KEYS]))
      openAsk.set(r.donor_id, { cents: toCents(r.amt) || 0, count: r.n });
    // The LAST LOGGED CONVERSATION, which is a fact on the interactions table —
    // one row per donor via DISTINCT ON, not a correlated subquery per person.
    for (const r of await query(
      `SELECT DISTINCT ON (donor_id) donor_id, type, date, note, logged_by_name
         FROM interactions WHERE org_id=? AND donor_id = ANY(?)
          AND type = ANY(ARRAY['call','meeting','email','ask','note','stewardship','gift','event'])
        ORDER BY donor_id, date DESC NULLS LAST, created_at DESC`, [orgId, ids]))
      lastConv.set(r.donor_id, { type: r.type, date: r.date, note: (r.note || "").slice(0, 220), by: r.logged_by_name || "" });
    // The NEXT STEP comes from the Thread (BUILD-81) — the one open one per
    // donor, which the partial unique index makes true by construction.
    for (const r of await query(
      `SELECT donor_id, next_step_label, next_step_type, due_date, due_time
         FROM threads WHERE org_id=? AND donor_id = ANY(?) AND closed_at IS NULL`, [orgId, ids]))
      nextStep.set(r.donor_id, { label: r.next_step_label, type: r.next_step_type, due: r.due_date, time: r.due_time });
  }

  const rows = people.map(p => {
    const lc = lastConv.get(p.id) || null;
    const days = lc && /^\d{4}-\d{2}-\d{2}$/.test(String(lc.date))
      ? Math.max(0, orgTime.daysBetween(String(lc.date), today)) : null;
    const ask = openAsk.get(p.id) || { cents: 0, count: 0 };
    return {
      donorId: p.id, name: p.name, email: p.email, kind: p.kind || "person",
      stage: p.stage || p.suggested_stage || null, placed: !!p.stage,
      lifetime: toDollars(toCents(p.total_giving) || 0),
      lifetimeCents: toCents(p.total_giving) || 0,
      openAskCents: ask.cents, openAskAmount: toDollars(ask.cents), openProposals: ask.count,
      daysSinceContact: days,
      contactPhrase: PF.contactPhrase(days), quiet: PF.isQuiet(days),
      lastConversation: lc, nextStep: nextStep.get(p.id) || null,
      assignedByName: p.assigned_by_name || null, assignedAt: p.assigned_at || null,
    };
  });
  const ranked = PF.rankPortfolio(rows);

  // Committed THIS FISCAL YEAR, against the target she typed. Committed, not
  // asked — a target is about money that landed.
  const [won] = await query(
    `SELECT COALESCE(SUM(COALESCE(gift_amount, target_amount)),0) AS amt, COUNT(*)::int AS n
       FROM opportunities WHERE org_id=? AND officer_id=? AND status='won'
        AND ${inOrgDays("closed_at", "org_id", "?", "?")}`, [orgId, officer.id, fy.start, fy.end]);
  const [t] = await query("SELECT target_amount, count_cap FROM portfolio_targets WHERE org_id=? AND user_id=? AND fiscal_year=?",
    [orgId, officer.id, fyYear]);
  const prog = PF.targetProgress({
    targetCents: t && t.target_amount != null ? toCents(t.target_amount) : null,
    committedCents: toCents(won.amt) || 0,
    fiscalLabel: `FY ${fyYear}–${String(fyYear + 1).slice(2)}`,
  });
  const cap = PF.capState({ capCount: t ? t.count_cap : null, actualCount: ranked.length });

  res.json({
    officer: { id: officer.id, name: officer.name }, downgraded: !!officer.downgraded,
    fiscalYear: fyYear, fiscalLabel: prog.fiscalLabel,
    people: ranked,
    count: { value: ranked.length, sentence: PF.portfolioCountSentence(ranked.length, officer.name) },
    target: { ...prog, amount: prog.targetCents == null ? null : toDollars(prog.targetCents),
              committedAmount: toDollars(prog.committedCents), committedCount: won.n,
              sentence: PF.targetSentence(prog, money.formatCentsPlain) },
    cap: { ...cap, sentence: PF.capSentence(cap) },
  });
}));

// PUT /portfolio/:officerId/target — the target and the cap, both hers, both
// optional. Sending null CLEARS one, which is how "I have not decided" is said.
app.put("/portfolio/:officerId/target", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const isAdmin = req.user.role === "admin";
  const want = String(req.params.officerId || "").trim();
  // A staff member may set their OWN target and nobody else's; an admin may set
  // anyone's in this org. REFUSED rather than downgraded, because a WRITE
  // silently landing on a different row is worse than an error — and the first
  // cut of this collapsed `want` into the caller's own id BEFORE the check, so
  // the refusal could never fire and a staff member's attempt quietly wrote to
  // her own target instead. Found by this part's own suite.
  if (!isAdmin && want && want !== "me" && want !== req.user.userId) {
    return res.status(403).json({ error: "You can set your own target." });
  }
  const id = (!isAdmin || !want || want === "me") ? req.user.userId : want;
  const [u] = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [id, orgId]);
  if (!u) return res.status(404).json({ error: "Officer not found" });

  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const fyYear = req.body.fiscalYear != null
    ? Number(req.body.fiscalYear)
    : Number(String(orgPeriodBounds(org, "fiscal_year", 0).key).replace("fy:", ""));
  if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) return res.status(400).json({ error: "A fiscal year is required." });

  let targetCents = null;
  if (req.body.target !== undefined && req.body.target !== null && String(req.body.target).trim() !== "") {
    try { targetCents = parseMoneyOrThrow(req.body.target, "target"); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (targetCents <= 0) return res.status(400).json({ error: "A target has to be a positive amount, or blank." });
  }
  let cap = null;
  if (req.body.countCap !== undefined && req.body.countCap !== null && String(req.body.countCap).trim() !== "") {
    cap = Number(req.body.countCap);
    if (!Number.isInteger(cap) || cap <= 0) return res.status(400).json({ error: "A count cap has to be a whole number, or blank." });
  }

  await run(
    `INSERT INTO portfolio_targets (id,org_id,user_id,fiscal_year,target_amount,count_cap,created_by,created_by_name,updated_at)
     VALUES (?,?,?,?,?,?,?,?,NOW())
     ON CONFLICT (org_id, user_id, fiscal_year) DO UPDATE
       SET target_amount=EXCLUDED.target_amount, count_cap=EXCLUDED.count_cap, updated_at=NOW()`,
    ["pt_" + uuid().slice(0, 10), orgId, id, fyYear,
     targetCents == null ? null : toDollars(targetCents), cap, actor(req).id, actor(req).name]);
  const [row] = await query("SELECT * FROM portfolio_targets WHERE org_id=? AND user_id=? AND fiscal_year=?", [orgId, id, fyYear]);
  res.json({
    officer: { id: u.id, name: u.name }, fiscalYear: fyYear,
    target: row.target_amount == null ? null : toDollars(toCents(row.target_amount) || 0),
    countCap: row.count_cap == null ? null : Number(row.count_cap),
  });
}));

// ── BUILD-99 (major gifts) Part 5 — THE MAJOR-GIFTS DASHBOARD ──────────────
// Five things a development director asks. shared/majorGiftsDash.js holds the
// definitions, ONE STRING each, and nothing on this screen may appear without
// one — the BUILD-86 C.3 rule, applied again because the reason has not changed.
//
// NO GOAL IS INVENTED. The only target here is the one she typed in Part 2.
async function mgDashMod() { return import("../../shared/majorGiftsDash.js"); }

app.get("/major-gifts/dashboard", requireAuth, wrap(async (req, res) => {
  const MG = await mgDashMod();
  const P = await proposalMod();
  const orgId = req.user.orgId;
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const fy = orgPeriodBounds(org, "fiscal_year", 0);
  const fyYear = Number(String(fy.key).replace("fy:", ""));
  const qtr = orgPeriodBounds(org, "quarter", 0);
  const mon = orgPeriodBounds(org, "month", 0);
  const today = orgToday(org);

  // ONE BATCH OF READS, not a query per tile (the BUILD-54 §1 pattern). Every
  // figure below is summed in the database over exactly the rows it names.
  const [pipeline, dueQ, askedY, committedY, convs, backlog, officers, counts] = await Promise.all([
    // Pipeline by stage, over the whole org's open proposals.
    query(`SELECT o.proposal_stage AS stage, COUNT(*)::int AS n, COALESCE(SUM(o.target_amount),0) AS amt,
                  COALESCE(SUM(CASE WHEN o.probability IS NOT NULL
                                    THEN round(o.target_amount::numeric * 100) * o.probability / 100 END),0) AS weighted_cents,
                  COUNT(o.probability)::int AS with_prob
             FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
            WHERE o.org_id=? AND d.deleted_at IS NULL
            GROUP BY o.proposal_stage`, [orgId]),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(o.target_amount),0) AS amt
             FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
            WHERE o.org_id=? AND d.deleted_at IS NULL AND o.proposal_stage = ANY(?::text[])
              AND o.expected_close >= ?::date AND o.expected_close <= ?::date`,
      [orgId, P.OPEN_STAGE_KEYS, qtr.start, qtr.end]),
    // ASKED THIS YEAR is about reaching the stage, so it reads the stage-change
    // line the proposal routes write — `created_at` would count a proposal
    // opened in July as an ask made in July, which it is not.
    query(`SELECT COUNT(DISTINCT o.id)::int AS n, COALESCE(SUM(o.target_amount),0) AS amt
             FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
            WHERE o.org_id=? AND d.deleted_at IS NULL
              AND o.proposal_stage IN ('asked','committed','declined','stewarding')
              AND ${inOrgDays("COALESCE(o.updated_at, o.created_at)", "o.org_id", "?", "?")}`, [orgId, fy.start, fy.end]),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(COALESCE(o.gift_amount, o.target_amount)),0) AS amt
             FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
            WHERE o.org_id=? AND d.deleted_at IS NULL AND o.status='won'
              AND ${inOrgDays("o.closed_at", "o.org_id", "?", "?")}`, [orgId, fy.start, fy.end]),
    // Conversations logged THIS MONTH, per officer, from who logged them.
    query(`SELECT COALESCE(NULLIF(i.logged_by_name,''),'(not recorded)') AS who, COUNT(*)::int AS n
             FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
            WHERE i.org_id=? AND d.deleted_at IS NULL AND i.is_sample IS NOT TRUE
              AND i.type = ANY(ARRAY['call','meeting','email','ask','stewardship'])
              AND i.date >= ? AND i.date <= ?
            GROUP BY 1 ORDER BY 2 DESC`, [orgId, mon.start, mon.end]),
    // Thread backlog per officer — open follow-ups on their own people, with the
    // overdue ones counted separately. A snoozed thread is not backlog.
    query(`SELECT COALESCE(NULLIF(t.owner_name,''), COALESCE(NULLIF(d.assigned_to_name,''),'(nobody)')) AS who,
                  COUNT(*)::int AS open_n,
                  COUNT(*) FILTER (WHERE t.due_date < ?)::int AS overdue_n
             FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
            WHERE t.org_id=? AND t.closed_at IS NULL AND d.deleted_at IS NULL
              AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
            GROUP BY 1 ORDER BY 2 DESC`, [today, orgId, today]),
    query("SELECT COUNT(*)::int AS n FROM users WHERE org_id=?", [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
            WHERE o.org_id=? AND d.deleted_at IS NULL`, [orgId]),
  ]);

  const byStage = P.PROPOSAL_STAGES.map(s => {
    const r = pipeline.find(x => x.stage === s.key);
    const askCents = r ? (toCents(r.amt) || 0) : 0;
    return { stage: s.key, label: s.label, kind: s.kind, count: r ? r.n : 0,
             askCents, amount: toDollars(askCents),
             sentence: P.stageTileSentence({ stage: s.key, label: s.label, count: r ? r.n : 0, askCents }, money.formatCentsPlain) };
  });
  const openRows = pipeline.filter(r => P.OPEN_STAGE_KEYS.includes(r.stage));
  const openCents = openRows.reduce((s, r) => s + (toCents(r.amt) || 0), 0);
  const weightedCents = openRows.reduce((s, r) => s + Math.round(Number(r.weighted_cents) || 0), 0);
  const withProb = openRows.reduce((s, r) => s + (Number(r.with_prob) || 0), 0);
  const openCount = openRows.reduce((s, r) => s + (Number(r.n) || 0), 0);

  const askedCents = toCents(askedY[0].amt) || 0;
  const committedCents = toCents(committedY[0].amt) || 0;

  const tile = (id, value) => ({
    id, label: MG.metric(id).label, value,
    definition: MG.definitionFor(id),
    sentence: MG.tileSentence(id, value, money.formatCentsPlain),
  });

  res.json({
    fiscalYear: fyYear, fiscalLabel: `FY ${fyYear}–${String(fyYear + 1).slice(2)}`,
    quarter: { start: qtr.start, end: qtr.end },
    month: { start: mon.start, end: mon.end },
    proposalCount: counts[0].n,
    empty: MG.emptySentence({ proposalCount: counts[0].n, officerCount: officers[0].n }),
    byStage,
    tiles: {
      pipeline: { ...tile("pipeline", openCents), amount: toDollars(openCents), count: openCount },
      weighted: { ...tile("weighted", weightedCents), amount: toDollars(weightedCents), counted: withProb,
                  unset: openCount - withProb,
                  sentence: P.weightedSentence({ cents: weightedCents, counted: withProb, unset: openCount - withProb,
                                                 openCount, askCents: openCents }, money.formatCentsPlain) },
      dueThisQuarter: { ...tile("dueThisQuarter", dueQ[0].n), amount: toDollars(toCents(dueQ[0].amt) || 0) },
      askedThisYear: { ...tile("askedThisYear", askedCents), amount: toDollars(askedCents), count: askedY[0].n },
      committedThisYear: { ...tile("committedThisYear", committedCents), amount: toDollars(committedCents), count: committedY[0].n },
    },
    askedVsCommitted: MG.askedVsCommitted({ askedCents, committedCents }, money.formatCentsPlain),
    officerActivity: {
      definition: MG.definitionFor("conversationsThisMonth"),
      rows: convs.map(r => ({ officerName: r.who, conversations: r.n })),
    },
    threadBacklog: {
      definition: MG.definitionFor("threadBacklog"),
      rows: backlog.map(r => ({ officerName: r.who, open: r.open_n, overdue: r.overdue_n })),
    },
    metrics: MG.METRICS,
  });
}));

// GET /pipeline/officer-activity — per-officer moves/asks/gifts over a period.
// The raw data BUILD-17's per-officer reports read; just recorded cleanly here.
app.get("/pipeline/officer-activity", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const to = req.query.to || orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  const from = req.query.from || orgTime.addDays(orgToday(await orgTz(orgId)), -90);   // ORG_TZ_SEAM_OK (ARCH-1: the org's day, not UTC's)
  const officers = await query("SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const moves = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt FROM moves WHERE org_id=? AND ${inOrgDays("created_at", "org_id", "?", "?")} GROUP BY officer_id`, [orgId, from, to]);
  const asks = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt FROM opportunities WHERE org_id=? AND ${inOrgDays("created_at", "org_id", "?", "?")} GROUP BY officer_id`, [orgId, from, to]);
  const won = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt FROM opportunities WHERE org_id=? AND status='won' AND ${inOrgDays("closed_at", "org_id", "?", "?")} GROUP BY officer_id`, [orgId, from, to]);
  const mv = Object.fromEntries(moves.map(r => [r.officer_id, r.cnt]));
  const ak = Object.fromEntries(asks.map(r => [r.officer_id, r]));
  const wn = Object.fromEntries(won.map(r => [r.officer_id, r]));
  res.json({
    from, to,
    officers: officers.map(o => ({
      officerId: o.id, name: o.name, color: o.portfolio_color,
      movesMade: mv[o.id] || 0,
      asksMade: ak[o.id]?.cnt || 0, asksAmount: parseFloat(ak[o.id]?.amt) || 0,
      giftsClosed: wn[o.id]?.cnt || 0, giftsAmount: parseFloat(wn[o.id]?.amt) || 0,
    })),
  });
}));
}

module.exports = { routers, mount };
