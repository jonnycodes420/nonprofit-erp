// server/tasks/routes.js — tasks, threads, nudges, note and step reminders, and digests.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const REPEAT = require("./repeat");
const TDONE = require("./threadDone");   // FLOWS-1: every way a repeating task is finished makes its next one
const ItemRefs = require("../../itemRefs");   // THREAD-2: the things a sentence names
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ACK_READY, CAL_READY, NOT_YOURS, OU, UNDO_SECONDS, actor, advanceCultivationPlan, checkWriteAccess,
  composeOfficerMonthly, composeWeekInReview, computeThreadHealth, engagementMod, inOrgDays, journeyMod,
  markMilestoneDone, mayEditLogged, monthBounds, notifyTaskAssignment, openThreadTx, orgOwns, orgPlanTier,
  orgTime, orgToday, orgTz, orgTzName, publicAppUrl, query, queryTx, reopenMilestone, requireAdmin,
  requireAuth, run, runDailyTaskRemindersForOrg, runDigestsForOrg, runStepRemindersForOrg,
  runThreadNudgesForOrg, runTx, runWeeklyEmailForOrg, sendMilestoneDraft, threadRankMod, threadShapeMod,
  trashRow, uuid, weekBounds, withTransaction, wrap,
} = ctx;
let CAL = null;
CAL_READY.then(m => { CAL = m; });
let app = routers.r1;

// A NEXT STEP is edited the same way: its words, its date, its time. Whoever
// set it (or owns it) may change it, and an admin.
app.put("/threads/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [t] = await query("SELECT * FROM threads WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Thread not found" });
  if (t.owner_id !== userId && !(await mayEditLogged(req, t))) return res.status(403).json(NOT_YOURS);
  const shape = await threadShapeMod();
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.label !== undefined) {
    const label = shape.sanitizeStepLabel(b.label);
    if (!label) return res.status(400).json({ error: "A next step needs a label." });
    if (label !== t.next_step_label) { sets.push("next_step_label=?", "next_step_type=?"); vals.push(label, shape.nextStepTypeForLabel(label)); }
  }
  if (b.due !== undefined && b.due !== t.due_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.due))) return res.status(400).json({ error: "due must be a date (YYYY-MM-DD)" });
    sets.push("due_date=?"); vals.push(b.due);
  }
  if (b.time !== undefined) {
    const time = shape.sanitizeStepTime(b.time);
    if (b.time && !time) return res.status(400).json({ error: "time must be a 24-hour HH:MM, or empty" });
    if (time && !(await orgTz(orgId)).timezone_confirmed_at) return res.status(400).json({ error: "timezone_unset", message: "Set your organization's timezone in Settings before scheduling a reminder at a specific time." });
    if ((time || null) !== (t.due_time || null)) { sets.push("due_time=?"); vals.push(time || null); }
  }
  if (!sets.length) return res.json({ thread: t, unchanged: true });
  const [u] = await query("SELECT name FROM users WHERE id=?", [userId]);
  sets.push("edited_at=NOW()", "edited_by=?", "edited_by_name=?");
  vals.push(userId, u?.name || req.user.email || "");
  await run(`UPDATE threads SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, [...vals, req.params.id, orgId]);
  const [out] = await query("SELECT * FROM threads WHERE id = ?", [req.params.id]);
  res.json({ thread: out });
}));

app.delete("/threads/:id", requireAuth, wrap(async (req, res) => {
  const [t] = await query("SELECT id, owner_id, created_by FROM threads WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Thread not found" });
  if (t.owner_id !== req.user.userId && !(await mayEditLogged(req, t))) return res.status(403).json(NOT_YOURS);
  const undoId = await trashRow("threads", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Thread not found" });
  res.json({ deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// ── FIX-31 · A LINKED TASK CHANGES THROUGH ITS RECORD ──────────────────────
// Returns null for an ordinary task (the caller writes it), { refused } when
// the change cannot be made, or { ok } once the thread or deadline changed and
// its trigger brought the task along. Ticking a next step's task logs a line
// "<label>: done" and closes the thread on it (a thread may only close on a
// line or a reason, BUILD-81); Undo takes that line back and reopens it.
async function linkedTaskChange(req, taskId, { done, due }) {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=? AND link_kind IN ('next_step','deadline')", [taskId, orgId]);
  if (!t) return null;
  const who = actor(req);
  if (t.link_kind === "deadline") {
    const [ms] = await query("SELECT * FROM grant_milestones WHERE id=? AND org_id=?", [t.milestone_id, orgId]);
    if (!ms) return { refused: { error: "deadline_gone", sentence: "That deadline is no longer on the grant." } };
    if (due !== undefined && due && due !== String(ms.due_date).slice(0, 10)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { refused: { error: "bad_due_date", sentence: "The date must be a day." } };
      await run("UPDATE grant_milestones SET due_date=?, updated_at=NOW() WHERE id=? AND org_id=?", [due, ms.id, orgId]);
      if (ms.thread_id) await run(`UPDATE threads SET due_date=?, original_due_date=COALESCE(original_due_date, due_date)
                                    WHERE id=? AND org_id=? AND closed_at IS NULL`, [due, ms.thread_id, orgId]);
    }
    if (done === 1 && ms.state !== "done") await markMilestoneDone(orgId, ms.id, who);
    if (done === 0 && ms.state === "done") await reopenMilestone(orgId, ms);
    return { ok: true };
  }
  const [th] = await query("SELECT * FROM threads WHERE id=? AND org_id=?", [t.thread_id, orgId]);
  if (!th) return { refused: { error: "step_gone", sentence: "That next step is no longer on the Thread." } };
  if (due !== undefined && due && due !== String(th.due_date).slice(0, 10) && !th.closed_at) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { refused: { error: "bad_due_date", sentence: "The date must be a day." } };
    await run(`UPDATE threads SET due_date=?, original_due_date=COALESCE(original_due_date, due_date) WHERE id=? AND org_id=?`, [due, th.id, orgId]);
  }
  if (done === 1 && !th.closed_at) {
    const intId = newId("int");
    const today = orgToday(await orgTz(orgId));                   // ORG_TZ_SEAM_OK
    await withTransaction(async client => {
      await runTx(client, `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name,metadata)
                           VALUES (?,?,?,?,?,?,?,?,?)`,
        [intId, orgId, th.donor_id, "note", today, `${th.next_step_label}: done.`, who.id, who.name, JSON.stringify({ via: "task_done", threadId: th.id })]);
      await runTx(client, `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=? AND org_id=? AND closed_at IS NULL`,
        [intId, th.id, orgId]);
    });
  }
  if (done === 0 && th.closed_at) {
    const [busy] = await query("SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL AND id<>?", [orgId, th.donor_id, th.id]);
    if (busy) return { refused: { error: "step_replaced", sentence: "A newer next step is already open for this person, so this one stays done." } };
    await withTransaction(async client => {
      await runTx(client, `UPDATE threads SET closed_at=NULL, close_kind=NULL, close_reason=NULL, closing_interaction_id=NULL WHERE id=? AND org_id=?`, [th.id, orgId]);
      if (th.closing_interaction_id) await runTx(client, `DELETE FROM interactions WHERE id=? AND org_id=? AND metadata->>'via' = 'task_done'`, [th.closing_interaction_id, orgId]);
    });
  }
  return { ok: true };
}

// ── Tasks ──────────────────────────────────────────────────────────────────
// Tasks — the daily-driver follow-up surface (BUILD-13). A task links an
// optional donor; the linked donor is now RENDERED in the UI, so donorId must
// be org-verified (orgOwns) — a foreign id would otherwise leak a donor
// name/link across tenants (the §1 resurfacing threat model note).
// ── TASKS-2 · ONE RULE FOR WHICH VIEW A TASK IS IN ───────────────────────
// The list, the counts on every view, Home's numbers and the profile all read
// taskViewSql. It is shared/taskShape.js viewOf, in SQL; the tasks2-thread
// suite checks the two agree row by row. Done means done in the last 30 days.
let _taskShape = null;
const taskShapeMod = async () => _taskShape || (_taskShape = await import("../../shared/taskShape.js"));
const taskViewSql = `CASE
    WHEN t.done = 1 THEN 'done'
    WHEN COALESCE(t.due, '') !~ '^\\d{4}-\\d{2}-\\d{2}' THEN 'nodate'
    WHEN LEFT(t.due, 10) < ? THEN 'overdue'
    WHEN LEFT(t.due, 10) = ? THEN 'today'
    WHEN LEFT(t.due, 10) <= ? THEN 'upcoming'
    ELSE 'later' END`;
const TASK_SELECT = `t.*, d.name AS donor_name, g.funder AS grant_funder, g.program AS grant_program,
    ev.name AS event_name, cp.name AS campaign_name, hh.name AS household_name`;
const TASK_JOINS = `LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
    LEFT JOIN grants g ON g.id = t.grant_id AND g.org_id = t.org_id
    LEFT JOIN events ev ON ev.id = t.event_id AND ev.org_id = t.org_id
    LEFT JOIN campaigns cp ON cp.id = t.campaign_id AND cp.org_id = t.org_id
    LEFT JOIN households hh ON hh.id = t.household_id AND hh.org_id = t.org_id`;
// Whose tasks. "mine" for an admin also holds the unowned ones, the Thread's
// own rule (composeThreads), so Home's Thread and Home's numbers agree.
async function taskScope(req) {
  const { orgId, userId } = req.user;
  const isAdmin = req.user.role === "admin";
  const staff = req.query.staff ? String(req.query.staff) : null;
  if (staff && isAdmin) {
    if (!(await OU.orgUser(orgId, staff, { allowInactive: true })).ok) return { refused: true };
    return { sql: "AND t.assigned_to = ?", params: [staff] };
  }
  if (req.query.scope === "all") return { sql: "", params: [] };
  if (req.query.scope === "mine" || req.query.scope === undefined && req.query.view)
    return isAdmin ? { sql: "AND (t.assigned_to = ? OR t.assigned_to IS NULL)", params: [userId] } : { sql: "AND t.assigned_to = ?", params: [userId] };
  return { sql: "", params: [] };
}
async function taskDays(orgId) {
  const today = orgToday(await orgTz(orgId));                        // ORG_TZ_SEAM_OK
  const ts = await taskShapeMod();
  return { today, week: ts.addDays(today, 7), monthAgo: ts.addDays(today, -30) };
}
// What a task is about, as one chip: the most specific record wins.
function taskAbout(t) {
  if (t.grant_id && (t.grant_funder || t.grant_program)) return { kind: "grant", id: t.grant_id, name: [t.grant_funder, t.grant_program].filter(Boolean).join(" · ") };
  if (t.event_id && t.event_name) return { kind: "event", id: t.event_id, name: t.event_name };
  if (t.campaign_id && t.campaign_name) return { kind: "campaign", id: t.campaign_id, name: t.campaign_name };
  if (t.household_id && t.household_name) return { kind: "household", id: t.household_id, name: t.household_name };
  if (t.donor_id && t.donor_name) return { kind: "person", id: t.donor_id, name: t.donor_name };
  return null;
}
async function readTasks(orgId, { where = "", params = [], days }) {
  const ts = await taskShapeMod();
  const rows = await query(
    `SELECT ${TASK_SELECT}, ${taskViewSql} AS view
       FROM tasks t ${TASK_JOINS}
      WHERE t.org_id = ? AND t.voided_at IS NULL
        -- WIRE-1: a deleted person's tasks go with them (and come back on Undo).
        AND (t.donor_id IS NULL OR d.deleted_at IS NULL) ${where}
      ORDER BY CASE t.priority WHEN 'high' THEN 0 ELSE 1 END, t.due ASC NULLS LAST, t.due_time ASC NULLS LAST, t.created_at DESC`,
    [days.today, days.today, days.week, orgId, ...params]);
  return rows.map(t => ({ ...t, kind: ts.kindOf(t), kindChosen: t.kind || null, about: taskAbout(t) }));
}
const readTask = async (orgId, id) => {
  const days = await taskDays(orgId);
  const [row] = await readTasks(orgId, { where: "AND t.id = ?", params: [id], days });
  return row || null;
};

app.get("/tasks", requireAuth, wrap(async (req, res) => {
  // scope=mine → the caller's own; all (or none) → the whole org; staff=<id>
  // (admins) → one person's. view=<today|upcoming|overdue|later|nodate|done>
  // narrows to one view with the same rule the counts use.
  const scope = await taskScope(req);
  if (scope.refused) return OU.refuse(res, "staff");
  const days = await taskDays(req.user.orgId);
  const view = String(req.query.view || "");
  const viewWhere = ["today", "upcoming", "overdue", "later", "nodate", "done"].includes(view) ? `AND ${taskViewSql} = ?` : "";
  const viewParams = viewWhere ? [days.today, days.today, days.week, view] : [];
  const doneWindow = view === "done" ? `AND ${inOrgDays("COALESCE(t.completed_at, t.updated_at, t.created_at)", "t.org_id", "?", null)}` : "";
  const rows = await readTasks(req.user.orgId, {
    where: `${scope.sql} ${viewWhere} ${doneWindow}`,
    params: [...scope.params, ...viewParams, ...(doneWindow ? [days.monthAgo] : [])], days });
  res.json(rows);
}));

// The count on every view, from the same rule as the list. Home reads this.
async function taskCounts(orgId, scope) {
  const days = await taskDays(orgId);
  const rows = await query(
    `SELECT v, COUNT(*)::int AS n FROM (
       SELECT ${taskViewSql} AS v, t.done, COALESCE(t.completed_at, t.updated_at, t.created_at) AS fin, t.org_id AS oid
         FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND t.voided_at IS NULL AND (t.donor_id IS NULL OR d.deleted_at IS NULL) ${scope.sql}) x
      WHERE v <> 'done' OR ${inOrgDays("x.fin", "x.oid", "?", null)}   -- CLOCK-1: the same window as the list
      GROUP BY v`,
    [days.today, days.today, days.week, orgId, ...scope.params, days.monthAgo]);
  const out = { today: 0, upcoming: 0, overdue: 0, later: 0, nodate: 0, done: 0 };
  for (const r of rows) out[r.v] = r.n;
  out.open = out.today + out.upcoming + out.overdue + out.later + out.nodate;
  return { ...out, asOf: days.today };
}
app.get("/tasks/counts", requireAuth, wrap(async (req, res) => {
  const scope = await taskScope({ ...req, query: { ...req.query, view: req.query.view || "count" } });
  if (scope.refused) return OU.refuse(res, "staff");
  res.json(await taskCounts(req.user.orgId, scope));
}));

// THREAD-2 · ONE TASK, so a link to a task opens it. This org's only: a task
// of another org is the same 404 as a task that never existed.
app.get("/tasks/:id", requireAuth, wrap(async (req, res) => {
  const row = await readTask(req.user.orgId, String(req.params.id));
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
}));


// Quick add: read the words, find the person, change nothing. The person
// confirms on the screen before anything is saved.
app.post("/tasks/parse", requireAuth, wrap(async (req, res) => {
  if (req.audit) req.audit.skip("reads a sentence and writes nothing");
  const text = String((req.body && req.body.text) || "").slice(0, 300);
  if (!text.trim()) return res.status(400).json({ error: "text_required", sentence: "Type what needs doing." });
  const ts = await taskShapeMod();
  const { today } = await taskDays(req.user.orgId);
  const p = ts.parseQuickAdd(text, today);
  let person = null, span = null, candidates = [];
  // Each capitalised run, and its tail without a title ("Rev. Ana Ortiz").
  const tries = [];
  for (const sp of p.nameSpans) { const w = sp.split(" "); for (let i = 0; i < w.length && w.length - i >= 1; i++) tries.push([sp, w.slice(i).join(" ")]); }
  for (const [sp, name] of tries) {
    if (name.length < 3) continue;
    const rows = await query(
      `SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL
          AND (LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?))
        ORDER BY (LOWER(name) = LOWER(?)) DESC, name LIMIT 5`,
      [req.user.orgId, name, name + " %", "% " + name, name]);
    const exact = rows.filter(r => r.name.toLowerCase() === name.toLowerCase());
    if (exact.length === 1 || rows.length === 1) { person = exact[0] || rows[0]; span = name; break; }
    if (rows.length > 1 && !candidates.length) { candidates = rows; span = name; }
  }
  const title = ts.titleWithout(p.rest, person ? span : null);
  res.json({ title, kind: p.kind, due: p.due, time: p.time, recur: p.recur, recurPhrase: ts.recurPhrase(p.recur),
             priority: p.priority, person, candidates: person ? [] : candidates, heard: p.matched, today });
}));

// A donor's own open tasks — surfaced on the donor profile.
app.get("/donors/:id/tasks", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });
  const tasks = await query(
    `SELECT * FROM tasks WHERE org_id = ? AND donor_id = ? AND voided_at IS NULL
      ORDER BY done ASC, due ASC NULLS LAST, created_at DESC`,
    [req.user.orgId, req.params.id]
  );
  res.json(tasks);
}));

app.post("/tasks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, donorId, assignedTo, assignedToName } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  // Tenant guard: a linked donor must belong to the caller's org.
  if (!(await orgOwns("donors", donorId, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });
  const ofKind = await require("./kindOnce").openOfKind({ query }, req.user.orgId, donorId, req.body);   // FLOWS-1 item 9
  if (ofKind) return res.status(200).json(ofKind);

  // Owner defaults to the creator; may target a teammate (validated to the org).
  if (!(await OU.orgUser(req.user.orgId, assignedTo)).ok) return OU.refuse(res, "assignedTo");
  const ownerTargetId = assignedTo || req.user.userId;
  const u = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [ownerTargetId, req.user.orgId]);
  const ownerId = u.length ? u[0].id : req.user.userId;
  const ownerName = (u.length && u[0].name) || assignedToName || "";

  // ── BUILD-88a A.2 — NO LABEL BEGINS "FOLLOW UP:" ─────────────────────────
  // A follow-up list every row of which starts with the words "Follow up" is a
  // list you cannot read: the only part that differs is at the end, and the
  // thing that tells you what to DO has been replaced by the fact that there is
  // something to do. The label is the STEP — read out of the note by the same
  // extractor the conversation flow uses (shared/threadShape.js stepFromNote),
  // or the type's own default. The user's own sentence is never touched; only
  // the prefix that says nothing is.
  const taskTitle = await (async () => {
    const raw = String(title).trim();
    const m = /^follow\s*up\s*:\s*(.*)$/i.exec(raw);
    if (!m) return raw;
    const shape = await threadShapeMod();
    const rest = m[1].trim();
    const fromNote = shape.stepFromNote(req.body.note || rest);
    if (fromNote && fromNote.label) return fromNote.label;
    return shape.nextStepLabelFor("follow_up") || "Follow up";
  })();

  // TASKS-2 — the rest of a task: its kind, time, notes, checklist, repeat,
  // and the record it is about (each checked to belong to this org).
  const x = await taskExtras(req.user.orgId, req.body || {});
  if (x.refused) return res.status(x.status || 400).json(x.refused);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(String(due))) return res.status(400).json({ error: "bad_due_date", sentence: "The date must be a day." });
  const id = newId("t");
  await run(
    `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,
                        kind,due_time,notes,checklist,recur,household_id,grant_id,event_id,campaign_id,recur_parent_id)
     VALUES (?,?,?,?,?,?,0,?,?,?,NOW(),?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?)`,
    [id, req.user.orgId, taskTitle, due || "", priority === "high" ? "high" : "medium", type || "donor",
     donorId || null, ownerId, ownerName, actor(req).id, actor(req).name,
     x.fields.kind ?? null, x.fields.due_time ?? null, x.fields.notes ?? null, JSON.stringify(x.fields.checklist || []),
     x.fields.recur ? JSON.stringify(x.fields.recur) : null, x.fields.household_id ?? null, x.fields.grant_id ?? null,
     x.fields.event_id ?? null, x.fields.campaign_id ?? null, req.body.recurParentId && /^t_/.test(String(req.body.recurParentId)) ? String(req.body.recurParentId) : null]
  );
  const rows = [await readTask(req.user.orgId, id)];
  // BUILD-36 A2: if this task was assigned to someone OTHER than the creator,
  // email the assignee (no email for a self-assigned task). Fire-and-forget.
  if (rows[0]?.assigned_to && rows[0].assigned_to !== req.user.userId) {
    queueTaskAssignmentEmail(rows[0], req.user.userId).catch(e => console.error("[task] assign email:", e.message));
  }
  res.status(201).json(rows[0]);
}));

// TASKS-2 — the optional fields of a task, validated once for create, edit
// and bulk. Returns { fields } (only the keys that were sent) or { refused }.
async function taskExtras(orgId, b) {
  const ts = await taskShapeMod();
  const f = {};
  if (b.kind !== undefined) f.kind = b.kind ? ts.normalizeKind(b.kind) : null;
  if (b.kind && !f.kind) return { refused: { error: "bad_kind", sentence: "That kind of task is not one Steward knows." } };
  if (b.dueTime !== undefined) {
    if (b.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.dueTime))) return { refused: { error: "bad_time", sentence: "The time must be like 14:00." } };
    f.due_time = b.dueTime || null;
  }
  if (b.notes !== undefined) f.notes = String(b.notes || "").slice(0, 8000) || null;
  if (b.checklist !== undefined) {
    if (!Array.isArray(b.checklist)) return { refused: { error: "bad_checklist", sentence: "A checklist is a list of items." } };
    f.checklist = b.checklist.slice(0, 50).map(i => ({ text: String((i && i.text) || "").slice(0, 300), done: !!(i && i.done) })).filter(i => i.text.trim());
  }
  if (b.recur !== undefined) {
    f.recur = b.recur ? ts.normalizeRecur(b.recur) : null;
    if (b.recur && !f.recur) return { refused: { error: "bad_recur", sentence: "A repeat is weekly, monthly, quarterly or yearly." } };
    // DATES-1 — a yearly repeat keeps the date it was set on, so a Feb 29
    // task comes back on the 29th in a leap year and on the 28th otherwise.
    const due = /^\d{4}-\d{2}-\d{2}/.exec(String(b.due || ""));
    if (f.recur && f.recur.every === "year" && !f.recur.month && due) {
      f.recur = { every: "year", month: Number(due[0].slice(5, 7)), day: Number(due[0].slice(8, 10)) };
    }
  }
  for (const [key, table, col] of [["householdId", "households", "household_id"], ["grantId", "grants", "grant_id"],
                                   ["eventId", "events", "event_id"], ["campaignId", "campaigns", "campaign_id"]]) {
    if (b[key] === undefined) continue;
    if (b[key] && !(await orgOwns(table, b[key], orgId))) return { refused: { error: "not_found", sentence: "That record is not in this organization." }, status: 404 };
    f[col] = b[key] || null;
  }
  return { fields: f };
}

// TASKS-2 — change some of a task and leave the rest alone (the full PUT
// replaces every column, which an inline edit must never do). A linked
// task's day goes through its next step or deadline, like everywhere else.
app.patch("/tasks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  const b = req.body || {};
  const x = await taskExtras(orgId, b);
  if (x.refused) return res.status(x.status || 400).json(x.refused);
  const sets = [], params = [];
  const add = (col, v, cast = "") => { sets.push(`${col}=?${cast}`); params.push(v); };
  for (const [col, v] of Object.entries(x.fields)) add(col, col === "checklist" || col === "recur" ? (v == null ? null : JSON.stringify(v)) : v, col === "checklist" || col === "recur" ? "::jsonb" : "");
  if (b.title !== undefined && !t.link_kind) { if (!String(b.title).trim()) return res.status(400).json({ error: "Title required" }); add("title", String(b.title).trim().slice(0, 300)); }
  if (b.priority !== undefined) add("priority", b.priority === "high" ? "high" : "medium");
  if (b.donorId !== undefined && !t.link_kind) {
    if (!(await orgOwns("donors", b.donorId, orgId))) return res.status(404).json({ error: "Donor not found" });
    add("donor_id", b.donorId || null);
  }
  let reassigned = null;
  if (b.assignedTo !== undefined) {
    if (b.assignedTo) {
      const { ok, user: u } = await OU.orgUser(orgId, b.assignedTo);
      if (!ok) return OU.refuse(res, "assignedTo");
      add("assigned_to", u.id); add("assigned_to_name", u.name || "");
      if (u.id !== t.assigned_to) reassigned = u.id;
    } else { add("assigned_to", null); add("assigned_to_name", null); }
    add("reassign_note", String(b.reassignNote || "").slice(0, 500) || null);
  }
  if (b.due !== undefined) {
    const due = String(b.due || "");
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "bad_due_date", sentence: "The date must be a day." });
    const linked = await linkedTaskChange(req, t.id, { due });
    if (linked && linked.refused) return res.status(409).json(linked.refused);
    if (!linked) add("due", due);
  }
  if (sets.length) {
    sets.push("updated_at=NOW()");
    await run(`UPDATE tasks SET ${sets.join(",")} WHERE id=? AND org_id=?`, [...params, t.id, orgId]);
  }
  // FIX-31: a next step's owner is the thread's; reassigning its task moves the thread.
  if (reassigned && t.link_kind === "next_step" && t.thread_id) {
    const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [reassigned, orgId]);
    await run("UPDATE threads SET owner_id=?, owner_name=? WHERE id=? AND org_id=? AND closed_at IS NULL", [reassigned, u ? u.name : null, t.thread_id, orgId]);
  }
  const row = await readTask(orgId, t.id);
  if (reassigned && reassigned !== req.user.userId) queueTaskAssignmentEmail(row, req.user.userId).catch(e => console.error("[task] reassign email:", e.message));
  res.json(row);
}));

// TASKS-2 — Snooze: the task moves to a later day and remembers why and from
// when. Undo is a PATCH of the day back (the screen holds `snoozedFrom`).
app.post("/tasks/:id/snooze", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const until = String((req.body && req.body.until) || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return res.status(400).json({ error: "bad_due_date", sentence: "Pick the day to bring it back." });
  const { today } = await taskDays(orgId);
  if (until <= today) return res.status(400).json({ error: "not_later", sentence: "Snooze to a day after today." });
  const [t] = await query("SELECT id, due FROM tasks WHERE id=? AND org_id=? AND done=0", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  const linked = await linkedTaskChange(req, t.id, { due: until });
  if (linked && linked.refused) return res.status(409).json(linked.refused);
  await run(`UPDATE tasks SET ${linked ? "" : "due=?, "}snooze_reason=?, snoozed_from=?, snoozed_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`,
    [...(linked ? [] : [until]), String((req.body && req.body.reason) || "").slice(0, 300) || null, t.due || "", t.id, orgId]);
  res.json({ ...(await readTask(orgId, t.id)), previousDue: t.due || "" });
}));

// TASKS-2 — Bulk: reassign, move a day, mark done, or delete, many at once.
// A next step or a grant deadline changes through its own record (FIX-31);
// one that cannot is SKIPPED and named, never half-done. The answer carries
// what each row was before, so the screen's Undo can put every one back.
app.post("/tasks/bulk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 200) : [];
  const action = String(b.action || "");
  if (!ids.length || !["reassign", "move", "done", "undone", "delete", "restore"].includes(action))
    return res.status(400).json({ error: "bad_bulk", sentence: "Pick some tasks and one thing to do to them." });
  const rows = await query(`SELECT id, title, due, done, recur, assigned_to, assigned_to_name, link_kind, thread_id FROM tasks WHERE org_id=? AND id = ANY(?::text[])`, [orgId, ids]);   // REDTEAM-2: one bound array
  let owner = null;
  if (action === "reassign") {
    const { ok, user: u } = await OU.orgUser(orgId, b.assignedTo);
    if (!ok || !b.assignedTo) return OU.refuse(res, "assignedTo");
    owner = u;
  }
  if (action === "move" && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.due || ""))) return res.status(400).json({ error: "bad_due_date", sentence: "The date must be a day." });
  const before = [], changed = [], skipped = [], undoIds = [];
  for (const t of rows) {
    const prior = { id: t.id, due: t.due || "", done: t.done, assignedTo: t.assigned_to || null };
    if (action === "reassign") {
      await run("UPDATE tasks SET assigned_to=?, assigned_to_name=?, reassign_note=?, updated_at=NOW() WHERE id=? AND org_id=?",
        [owner.id, owner.name || "", String(b.note || "").slice(0, 500) || null, t.id, orgId]);
      if (t.link_kind === "next_step" && t.thread_id)
        await run("UPDATE threads SET owner_id=?, owner_name=? WHERE id=? AND org_id=? AND closed_at IS NULL", [owner.id, owner.name, t.thread_id, orgId]);
    } else if (action === "move") {
      const linked = await linkedTaskChange(req, t.id, { due: b.due });
      if (linked && linked.refused) { skipped.push({ id: t.id, title: t.title, sentence: linked.refused.sentence }); continue; }
      if (!linked) await run("UPDATE tasks SET due=?, updated_at=NOW() WHERE id=? AND org_id=?", [b.due, t.id, orgId]);
    } else if (action === "done" || action === "undone") {
      const done = action === "done" ? 1 : 0;
      if (t.done === done) continue;
      const linked = await linkedTaskChange(req, t.id, { done });
      if (linked && linked.refused) { skipped.push({ id: t.id, title: t.title, sentence: linked.refused.sentence }); continue; }
      if (!linked) await run(`UPDATE tasks SET done=?, completed_at=${done ? "NOW()" : "NULL"}, completed_by_name=?, updated_at=NOW() WHERE id=? AND org_id=?`,
        [done, done ? actor(req).name : null, t.id, orgId]);
      if (done) await REPEAT.afterDone({ query, run }, orgId, t, (await taskDays(orgId)).today); else await REPEAT.afterUndone({ run }, orgId, t);   // FLOWS-1
    } else if (action === "delete") {
      if (t.link_kind === "next_step" || t.link_kind === "deadline") {
        skipped.push({ id: t.id, title: t.title, sentence: t.link_kind === "deadline" ? "A grant deadline goes when it is taken off the grant." : "A next step goes when it is dismissed on the Thread." });
        continue;
      }
      const undoId = await trashRow("tasks", t.id, req);
      if (undoId) undoIds.push(undoId);
    } else if (action === "restore") {
      // Undo of a reassign or a move: each row back as it was.
      const want = (Array.isArray(b.before) ? b.before : []).find(x => x && x.id === t.id);
      if (!want) continue;
      if (want.assignedTo !== undefined && want.assignedTo !== t.assigned_to) {
        const [u] = want.assignedTo ? await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [want.assignedTo, orgId]) : [null];
        await run("UPDATE tasks SET assigned_to=?, assigned_to_name=?, updated_at=NOW() WHERE id=? AND org_id=?", [u ? u.id : null, u ? u.name : null, t.id, orgId]);
        if (t.link_kind === "next_step" && t.thread_id && u)
          await run("UPDATE threads SET owner_id=?, owner_name=? WHERE id=? AND org_id=? AND closed_at IS NULL", [u.id, u.name, t.thread_id, orgId]);
      }
      if (want.due !== undefined && String(want.due) !== String(t.due || "")) {
        const linked = await linkedTaskChange(req, t.id, { due: want.due });
        if (!linked && /^(\d{4}-\d{2}-\d{2})?$/.test(String(want.due))) await run("UPDATE tasks SET due=?, updated_at=NOW() WHERE id=? AND org_id=?", [want.due, t.id, orgId]);
      }
    }
    before.push(prior); changed.push(t.id);
  }
  if (req.audit) req.audit.after({ action, changed, skipped: skipped.map(x => x.id) });
  res.json({ action, changed, skipped, before, undoIds, undoSeconds: UNDO_SECONDS });
}));

app.put("/tasks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, done, donorId, assignedTo } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  if (donorId !== undefined && !(await orgOwns("donors", donorId, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });

  // Reassignment (BUILD-36 A2): validate a new assignee to the org, capture the
  // prior owner so we only notify on a genuine change to a NEW person.
  const priorRows = await query("SELECT id, assigned_to, done, recur, due FROM tasks WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!priorRows.length) return res.status(404).json({ error: "Task not found" });
  const priorAssignee = priorRows[0].assigned_to;
  let newAssignee, newAssigneeName;
  if (assignedTo !== undefined) {
    if (assignedTo) {
      const { ok, user: u } = await OU.orgUser(req.user.orgId, assignedTo);
      if (!ok) return OU.refuse(res, "assignedTo");
      newAssignee = u.id; newAssigneeName = u.name || "";
    } else { newAssignee = null; newAssigneeName = null; }
  }

  // FIX-31: a linked task's date and done state belong to its next step or
  // deadline; change them there and the trigger brings the task along.
  const linked = await linkedTaskChange(req, req.params.id, { done: done ? 1 : 0, due: due || "" });
  if (linked && linked.refused) return res.status(409).json(linked.refused);
  const sets = linked ? ["priority=?", "updated_at=NOW()"] : ["title=?", "due=?", "priority=?", "type=?", "done=?", "updated_at=NOW()"];
  const params = linked ? [priority || "medium"] : [String(title).trim(), due || "", priority || "medium", type || "donor", done ? 1 : 0];
  if (donorId !== undefined) { sets.push("donor_id=?"); params.push(donorId || null); }
  if (assignedTo !== undefined) { sets.push("assigned_to=?", "assigned_to_name=?"); params.push(newAssignee, newAssigneeName); }
  params.push(req.params.id, req.user.orgId);

  const affected = await run(
    `UPDATE tasks SET ${sets.join(",")} WHERE id=? AND org_id=?`, params);
  if (!affected.changes) return res.status(404).json({ error: "Task not found" });
  // FLOWS-1: a repeating task ticked here comes back, as it does from Tasks
  if (done !== undefined && !!done !== (priorRows[0].done === 1)) {
    if (done) await REPEAT.afterDone({ query, run }, req.user.orgId, priorRows[0], (await taskDays(req.user.orgId)).today);
    else await REPEAT.afterUndone({ run }, req.user.orgId, priorRows[0]);
  }
  const rows = await query(
    `SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id WHERE t.id = ?`, [req.params.id]);
  // Notify only on a genuine reassignment to a NEW person who isn't the actor.
  if (assignedTo !== undefined && newAssignee && newAssignee !== priorAssignee && newAssignee !== req.user.userId) {
    queueTaskAssignmentEmail(rows[0], req.user.userId).catch(e => console.error("[task] reassign email:", e.message));
  }
  res.json(rows[0]);
}));

// One-click complete/reopen — the primary Tasks action (write-gated).
app.post("/tasks/:id/complete", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const done = req.body.done === false ? 0 : 1;
  const orgId = req.user.orgId;
  const ts = await taskShapeMod();
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  // TASKS-2 · DONE PROPERLY. A call or a meeting with a person is finished by
  // saying how it went and what is next: the conversation is logged through
  // POST /donors/:id/conversations (which requires a next step or an explicit
  // "No next step") and its id comes here. A bare tick is refused, so the
  // thread never ends without a decision.
  // FIX-34 · AN EMAIL SENT FROM ITS TASK asks for the next step the way a
  // call does: the email's own timeline line (sent through /tasks/:id/email)
  // carries the decision, and a next step opens a thread on it.
  if (done === 1 && !t.done && t.donor_id && req.body.interactionId && req.body.nextStep) {
    const [ei] = await query(
      `SELECT id, date FROM interactions WHERE id=? AND org_id=? AND donor_id=? AND metadata->>'via'='task_email' AND metadata->>'taskId'=?
          AND metadata->>'next_step' IS NULL`, [String(req.body.interactionId), orgId, t.donor_id, t.id]);
    if (ei) {
      const shape = await threadShapeMod();
      const ns = req.body.nextStep;
      const skipped = ns.skipped === true;
      let step = null;
      if (!skipped) {
        const typeLabel = shape.nextStepLabelFor(ns.type);
        if (!typeLabel || !/^\d{4}-\d{2}-\d{2}$/.test(String(ns.due || ""))) return res.status(400).json({ error: "nextStep must be {type, due} from the offered set, or {skipped:true}" });
        step = { type: ns.type, label: shape.sanitizeStepLabel(ns.label) || typeLabel, due: ns.due, time: null };
      }
      const [donor] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=?", [t.donor_id, orgId]);
      const [me] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
      const userName = me?.name || "";
      const { today } = await taskDays(orgId);
      await withTransaction(async client => {
        await runTx(client, `UPDATE interactions SET metadata = COALESCE(metadata,'{}'::jsonb) || ?::jsonb WHERE id=? AND org_id=?`,
          [JSON.stringify({ next_step: skipped ? "skipped" : "set", ...(step ? { next_step_label: step.label } : {}) }), ei.id, orgId]);
        await queryTx(client, `UPDATE threads SET closed_at = NOW(), close_kind = 'outcome', closing_interaction_id = ?
            WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL RETURNING id`, [ei.id, orgId, t.donor_id]);
        if (step) await openThreadTx(client, { orgId, donorId: t.donor_id, step, openedOn: today,
          ownerId: donor?.assigned_to || req.user.userId, ownerName: donor?.assigned_to ? donor.assigned_to_name : userName,
          actorId: req.user.userId, actorName: userName, openingInteractionId: ei.id, followon: null });
      });
    }
  }
  // FIX-34: a next step's own task (link_kind next_step) that is a call or a
  // meeting is finished the same way: the Calendar's Mark done used to close
  // it with no "How did it go?" and no "What's next?". A deadline's task keeps
  // its plain tick.
  let viaConversation = false;
  let outcomeKind = !t.link_kind ? ts.kindOf(t) : null;
  if (t.link_kind === "next_step" && t.thread_id) {
    const [th] = await query("SELECT next_step_type FROM threads WHERE id=? AND org_id=?", [t.thread_id, orgId]);
    outcomeKind = th && ts.NEEDS_OUTCOME.has(th.next_step_type) ? th.next_step_type : ts.kindOf(t);
  }
  if (done === 1 && !t.done && t.donor_id && outcomeKind && ts.NEEDS_OUTCOME.has(outcomeKind)) {
    const iid = String(req.body.interactionId || "");
    const [i] = iid ? await query(
      `SELECT id, metadata->>'outcome' AS outcome FROM interactions WHERE id=? AND org_id=? AND donor_id=? AND metadata->>'next_step' IN ('set','skipped')`,
      [iid, orgId, t.donor_id]) : [];
    if (!i) return res.status(422).json({ error: "needs_outcome",
      kind: outcomeKind,
      sentence: `Say how the ${outcomeKind === "call" ? "call" : "meeting"} went and what's next (or "No next step") to finish it.` });
    viaConversation = true;
    // FEEL-1: a conversation logged with "No next step" no longer closes the
    // person's open step by itself (a skip skips only its own step); the step
    // this task belongs to closes here, on her line, as it did before.
    if (t.link_kind === "next_step" && t.thread_id)
      await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=? AND org_id=? AND donor_id=? AND closed_at IS NULL`,
        [i.id, t.thread_id, orgId, t.donor_id]);
    // JOURNEYS-4 — the outcome she picked rides onto the task, where a
    // task_outcome journey reads it (lifecycleRows).
    const J4 = await journeyMod();
    const picked = J4.TASK_OUTCOME_KEYS.includes(String(i.outcome || "")) ? i.outcome
      : (J4.TASK_OUTCOME_KEYS.includes(String(req.body.outcome || "")) ? String(req.body.outcome) : null);
    if (picked) await run("UPDATE tasks SET outcome=? WHERE id=? AND org_id=?", [picked, t.id, orgId]);
  }
  // FIX-31: a next step's or a deadline's task is ticked through that record,
  // and the record's trigger ticks the task: one record, every view. When the
  // conversation already closed the next step, there is nothing left to tick.
  const fresh = viaConversation ? (await query("SELECT done FROM tasks WHERE id=? AND org_id=?", [t.id, orgId]))[0] : null;
  const linked = fresh && fresh.done === 1 ? { ok: true } : await linkedTaskChange(req, t.id, { done });
  if (linked && linked.refused) return res.status(409).json(linked.refused);
  if (!linked) await run("UPDATE tasks SET done=?, updated_at=NOW() WHERE id=? AND org_id=?", [done, t.id, orgId]);
  await run(`UPDATE tasks SET completed_at=${done ? "COALESCE(completed_at, NOW())" : "NULL"}, completed_by_name=? WHERE id=? AND org_id=?`,
    [done ? actor(req).name : null, t.id, orgId]);
  // TASKS-2 · A REPEAT. Finishing a repeating task makes the next one, once;
  // taking the tick back takes the untouched next one away again.
  // FLOWS-1: the one place a next repeat is made (repeat.js), for every way a task is finished.
  let next = null;
  if (done === 1) { const nid = await REPEAT.afterDone({ query, run }, orgId, t, (await taskDays(orgId)).today); if (nid) next = await readTask(orgId, nid); }
  else await REPEAT.afterUndone({ run }, orgId, t);
  res.json({ ...(await readTask(orgId, t.id)), next });
}));

// FIX-34 · A THANK-YOU TASK DOES THE THANKING. The task's Thank-you button
// opens the draft for THAT gift (the task's source gift, else the person's
// latest gift not yet thanked). Sending it, or marking it sent, is one write:
// the gift is thanked the way /acknowledgments/mark thanks it, its drafted
// thank-you leaves the queue, and the task closes. She pressed Send; Steward
// did not send anything on its own. Undo (POST /tasks/:id/thank/undo) puts
// all three back.
async function taskGiftToThank(orgId, t, giftId) {
  if (giftId) { const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=? AND donor_id=?", [String(giftId), orgId, t.donor_id]); if (g) return g; }
  if (t.source_gift_id) { const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [t.source_gift_id, orgId]); if (g) return g; }
  const [g] = await query(
    `SELECT * FROM gifts WHERE org_id=? AND donor_id=? AND amount > 0 AND acknowledgement_sent IS NOT TRUE
      ORDER BY date DESC NULLS LAST, id DESC LIMIT 1`, [orgId, t.donor_id]);
  return g || null;
}
app.get("/tasks/:id/thank", requireAuth, wrap(async (req, res) => {
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!t || !t.donor_id) return res.status(404).json({ error: "Task not found" });
  const g = await taskGiftToThank(req.user.orgId, t, req.query.giftId);
  const [d] = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [t.donor_id, req.user.orgId]);
  const [gc] = await query("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=? AND amount > 0", [req.user.orgId, t.donor_id]);
  res.json({ giftCount: gc ? gc.n : 0, gift: g ? { id: g.id, amount: Number(g.amount), date: String(g.date || "").slice(0, 10), thanked: g.acknowledgement_sent === true } : null,
             donor: d ? { id: d.id, name: d.name, email: d.email || null } : null });
}));
app.post("/tasks/:id/thank", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t || !t.donor_id) return res.status(404).json({ error: "Task not found" });
  const g = await taskGiftToThank(orgId, t, req.body && req.body.giftId);
  if (!g) return res.status(409).json({ error: "no_gift", sentence: "There is no gift on file to thank this person for yet." });
  const mode = req.body && req.body.mode === "send" ? "send" : "mark";
  if (mode === "send") {
    const subject = String((req.body && req.body.subject) || "").trim().slice(0, 200);
    const body = String((req.body && req.body.body) || "").trim().slice(0, 8000);
    if (!subject || !body) return res.status(400).json({ error: "A thank-you needs a subject and words." });
    const who = actor(req), mdId = newId("md");
    await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,'pending_review','task',?,?)`,
      [mdId, orgId, t.donor_id, `task-thanks:${t.id}:${Date.now()}`, subject, body, who.id, who.name]);
    const [draft] = await query("SELECT * FROM milestone_drafts WHERE id=?", [mdId]);
    const r = await sendMilestoneDraft(req, draft);
    if (r.status !== 200) { await run("DELETE FROM milestone_drafts WHERE id=? AND org_id=?", [mdId, orgId]); return res.status(r.status).json({ error: r.error, sentence: r.error }); }
  }
  const before = { acknowledgement_sent: g.acknowledgement_sent === true, acknowledgement_sent_at: g.acknowledgement_sent_at || null,
    acknowledged_by: g.acknowledged_by || null, acknowledged_by_name: g.acknowledged_by_name || null, acknowledged_via: g.acknowledged_via || null };
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const whoName = u?.name || actor(req).name;
  await run(
    `UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()), thanked_at=COALESCE(thanked_at, NOW()),
                      acknowledged_by=COALESCE(acknowledged_by, ?), acknowledged_by_name=COALESCE(acknowledged_by_name, ?),
                      acknowledged_via=COALESCE(acknowledged_via, 'email')
      WHERE org_id=? AND id=?`, [actor(req).id, whoName, orgId, g.id]);
  const drafts = await query("UPDATE thank_you_drafts SET sent_at=NOW() WHERE org_id=? AND gift_id=? AND sent_at IS NULL AND skipped_at IS NULL RETURNING id", [orgId, g.id]).catch(() => []);
  const linked = await linkedTaskChange(req, t.id, { done: 1 });
  if (linked && linked.refused) return res.status(409).json(linked.refused);
  if (!linked) await run("UPDATE tasks SET done=1, updated_at=NOW() WHERE id=? AND org_id=?", [t.id, orgId]);
  await run("UPDATE tasks SET completed_at=COALESCE(completed_at, NOW()), completed_by_name=? WHERE id=? AND org_id=?", [actor(req).name, t.id, orgId]);
  await REPEAT.afterDone({ query, run }, orgId, t, (await taskDays(orgId)).today);   // FLOWS-1
  if (req.audit) { req.audit.entity("gift", g.id); req.audit.before(before); req.audit.after({ acknowledgement_sent: true, task_done: true, mode }); }
  res.json({ ok: true, mode, giftId: g.id, before, draftIds: drafts.map(d => d.id), task: await readTask(orgId, t.id) });
}));
app.post("/tasks/:id/thank/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  const b = (req.body && req.body.before) || {};
  const giftId = String((req.body && req.body.giftId) || "");
  if (giftId && !b.acknowledgement_sent) {
    await run(`UPDATE gifts SET acknowledgement_sent=false, acknowledgement_sent_at=NULL, acknowledged_by=NULL, acknowledged_by_name=NULL, acknowledged_via=NULL
                WHERE org_id=? AND id=?`, [orgId, giftId]);
  }
  const ids = Array.isArray(req.body && req.body.draftIds) ? req.body.draftIds.map(String) : [];
  if (ids.length) await run("UPDATE thank_you_drafts SET sent_at=NULL WHERE org_id=? AND id = ANY(?)", [orgId, ids]);
  const linked = await linkedTaskChange(req, t.id, { done: 0 });
  if (!linked) await run("UPDATE tasks SET done=0, completed_at=NULL, completed_by_name=NULL, updated_at=NOW() WHERE id=? AND org_id=?", [t.id, orgId]);
  res.json({ ok: true, task: await readTask(orgId, t.id) });
}));

// FIX-34 · AN EMAIL TASK OPENS A DRAFT. Send goes through the one draft sender
// (sendMilestoneDraft: donorMailDecision, the footer, the timeline line). The
// task stays open: it is finished through /tasks/:id/complete with the email's
// interactionId and a next step (or "No next step"), the way a call is.
app.post("/tasks/:id/email", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM tasks WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t || !t.donor_id) return res.status(404).json({ error: "Task not found" });
  const subject = String((req.body && req.body.subject) || "").trim().slice(0, 200);
  const body = String((req.body && req.body.body) || "").trim().slice(0, 8000);
  if (!subject || !body) return res.status(400).json({ error: "An email needs a subject and words." });
  const who = actor(req), mdId = newId("md");
  await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,'pending_review','task',?,?)`,
    [mdId, orgId, t.donor_id, `task-email:${t.id}:${Date.now()}`, subject, body, who.id, who.name]);
  const [draft] = await query("SELECT * FROM milestone_drafts WHERE id=?", [mdId]);
  const r = await sendMilestoneDraft(req, draft, { taskId: t.id });
  if (r.status !== 200) { await run("DELETE FROM milestone_drafts WHERE id=? AND org_id=?", [mdId, orgId]); return res.status(r.status).json({ error: r.error, sentence: r.error }); }
  res.json({ ok: true, interactionId: r.interactionId, needsNextStep: true });
}));

// FIX-31: a task's day on its own (a Calendar drag, "Give it a day"). The full
// PUT replaces every column, which a drag must never do. A linked task's day
// moves its next step or deadline, and the trigger brings the task along.
app.patch("/tasks/:id/due", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const due = String((req.body && req.body.due) || "");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "bad_due_date", sentence: "The date must be a day." });
  const [t] = await query("SELECT id, due FROM tasks WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  req.audit = { ...(req.audit || {}), before: { due: t.due || "" }, after: { due } };
  const linked = await linkedTaskChange(req, t.id, { due });
  if (linked && linked.refused) return res.status(409).json(linked.refused);
  if (!linked) await run("UPDATE tasks SET due=?, updated_at=NOW() WHERE id=? AND org_id=?", [due, t.id, req.user.orgId]);
  const [row] = await query(`SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id WHERE t.id = ? AND t.org_id = ?`, [t.id, req.user.orgId]);
  res.json({ ...row, previousDue: t.due || "" });
}));

app.delete("/tasks/:id", requireAuth, wrap(async (req, res) => {
  // FIX-31: a linked task goes when its next step or deadline goes, never alone.
  const [lk] = await query("SELECT link_kind FROM tasks WHERE id=? AND org_id=? AND link_kind IN ('next_step','deadline')", [req.params.id, req.user.orgId]);
  if (lk) return res.status(409).json({ error: "linked_task", sentence: lk.link_kind === "deadline"
    ? "This task is the grant deadline itself. Take the deadline off the grant and the task goes with it."
    : "This task is a next step. Dismiss it on the Thread and the task goes with it." });
  // FIX-14 Part 2: moved, not destroyed, so the screen can offer Undo.
  const undoId = await trashRow("tasks", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true, undoId, undoSeconds: UNDO_SECONDS });
}));

// ── BUILD-85 — THE QUEUE ───────────────────────────────────────────────────
// BUILD-81 composed every open thread in the org, unbounded, sorted by
// overdue-then-due-date, and handed the same list to everyone. Three things
// were wrong with that and all three are fixed here:
//
//   OWNERSHIP. A thread carries `owner_id` (the donor's officer, else the
//   person who logged it) and nothing read it. `scope=mine` is now the
//   default and the server ENFORCES it: a non-admin asking for `all` is
//   downgraded rather than refused (the BUILD-31 pipeline precedent — the
//   cross-officer view is the oversight Team sells, so staff never get it by
//   editing a query param). Unowned threads are nobody's by definition, so
//   they ride the ADMIN's own list rather than vanishing — a backstop, and
//   the reason `unowned` is reported separately in the stat.
//
//   A CAP. shared/threadRank.js QUEUE_CAP. A list you cannot finish is a list
//   you stop opening; the remainder is stated as a number, never hidden.
//
//   AN ORDER WITH A REASON. Ranking lives in shared/threadRank.js, and every
//   signal it uses is read HERE, in four batched queries — never per row.
//
// Snoozed threads (revisit dates still in the future) stay off the list and
// out of the stat; they resurface by construction the day snoozed_until
// arrives. `donorId` asks for one donor's thread and bypasses scope and cap —
// a donor record shows its own thread whoever owns it.
async function composeThreads(orgId, { donorId = null, scope = "mine", userId = null, isAdmin = false, cap = null } = {}) {
  const DDth = await import("../../shared/displayDate.js");   // CHECK-2: a line Steward wrote reads "Fri, Oct 23"
  const org = await orgTz(orgId);
  const today = orgToday(org);                         // ORG_TZ_SEAM_OK
  const rank = await threadRankMod();

  // Non-admins may not read across officers, whatever the query string says.
  const effScope = donorId ? "all" : (scope === "all" && isAdmin ? "all" : "mine");
  const ownerClause = effScope === "all" || !userId
    ? ""
    : (isAdmin ? "AND (t.owner_id = ? OR t.owner_id IS NULL)" : "AND t.owner_id = ?");
  const ownerParams = ownerClause ? [userId] : [];

  const rows = await query(
    `SELECT t.*, d.name AS donor_name, d.email AS donor_email, d.total_giving, d.gift_count,
            i.type AS touch_type, i.note AS touch_note, i.date AS touch_date, i.logged_by_name AS touch_actor,
            g.amount AS gift_amount, g.date AS gift_date
       FROM threads t
       JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
       LEFT JOIN interactions i ON i.id = t.opening_interaction_id
       LEFT JOIN gifts g ON g.id = t.opening_gift_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        ${donorId ? "AND t.donor_id = ?" : ""} ${ownerClause}
      ORDER BY t.due_date ASC, t.opened_on ASC`,
    donorId ? [orgId, donorId, ...ownerParams] : [orgId, ...ownerParams]);

  // ── BUILD-88a A.2 — ONE COMPOSER, EVERY OPEN ITEM ────────────────────────
  // A follow-up created by the conversation flow is a THREAD; one created by
  // "+ Add task", a pipeline move or a workflow recipe is a TASK. They are two
  // tables and they will stay two tables in this build — the thread carries an
  // opening interaction, a close kind and a one-open-per-donor constraint that
  // a task row has no place for. What they must not be is two LISTS: a donor
  // with an open thread and an open task had one of them on the profile and the
  // other on a screen nobody opens, and "what do I owe this person?" had two
  // answers.
  //
  // So they are read through ONE composer, ranked by the ONE ranking
  // (shared/threadRank.js), and carry `kind` so a row can say which it is.
  // Only a task ATTACHED TO A DONOR joins: an org to-do ("renew the insurance")
  // is not a follow-up and does not belong on a donor's record.
  const taskRows = await query(
    `SELECT k.id, k.title, k.due, k.type, k.donor_id, k.assigned_to, k.assigned_to_name, k.calendar_event_id,
            k.created_at, k.source_gift_id, d.name AS donor_name, d.email AS donor_email, d.total_giving, d.gift_count,
            sg.amount AS source_gift_amount, sg.date AS source_gift_date
       FROM tasks k
       JOIN donors d ON d.id = k.donor_id AND d.org_id = k.org_id
       LEFT JOIN gifts sg ON sg.id = k.source_gift_id AND sg.org_id = k.org_id
      WHERE k.org_id = ? AND k.done = 0 AND k.voided_at IS NULL AND k.donor_id IS NOT NULL AND d.deleted_at IS NULL
        AND k.due IS NOT NULL AND k.due <> ''
        -- FIX-31: a next step's own task IS the thread row above, and a deadline
        -- whose follow-up thread is open is that thread; each shows once.
        AND COALESCE(k.link_kind, '') <> 'next_step'
        AND NOT EXISTS (SELECT 1 FROM grant_milestones m JOIN threads th ON th.id = m.thread_id AND th.closed_at IS NULL
                         WHERE m.id = k.milestone_id AND m.org_id = k.org_id AND k.link_kind = 'deadline')
        ${donorId ? "AND k.donor_id = ?" : ""}
        ${effScope === "all" || !userId ? "" : "AND (k.assigned_to = ? OR (k.assigned_to IS NULL AND d.assigned_to = ?))"}
      ORDER BY k.due ASC, k.id ASC`,
    donorId
      ? (effScope === "all" || !userId ? [orgId, donorId] : [orgId, donorId, userId, userId])
      : (effScope === "all" || !userId ? [orgId] : [orgId, userId, userId]));

  // ── The rank signals, read in BATCHES ────────────────────────────────────
  // Four queries for the whole list, never one per row (the BUILD-15 board
  // discipline). Each is scoped to the donors actually on the list.
  const donorIds = [...new Set([...rows.map(r => r.donor_id), ...taskRows.map(r => r.donor_id)])];
  let asks = {}, atRisk = new Set(), majorThreshold = 0;
  if (donorIds.length) {
    const ph = donorIds.map(() => "?").join(",");
    for (const a of await query(
      `SELECT donor_id, COALESCE(SUM(target_amount),0) AS amt FROM opportunities
        WHERE org_id = ? AND status = 'open' AND donor_id IN (${ph}) GROUP BY donor_id`,
      [orgId, ...donorIds])) asks[a.donor_id] = parseFloat(a.amt) || 0;
    for (const r of await query(
      `SELECT DISTINCT donor_id FROM recurring_subscriptions
        WHERE org_id = ? AND donor_id IN (${ph}) AND status IN ('past_due','recovering')`,
      [orgId, ...donorIds])) atRisk.add(r.donor_id);
  }
  // THE ORG'S OWN SCALE, never an absolute dollar figure: p90 of lifetime
  // giving among donors who have given at all. A $5,000 ask is the year for
  // one organization and noise for another; ranking on absolute money is how
  // a CRM starts telling a food pantry its work is small.
  // NUMBERS-4: the top tenth by lifetime, one line (shared/numbers/tags.js).
  const [{ p90 } = {}] = await query(require("../../shared/numbers/tags").TOP_TENTH_SQL, [orgId]);
  majorThreshold = parseFloat(p90) || 0;

  // THREAD-2 · the org's named things (events, campaigns, journeys, groups)
  // and each thread's own task, so a step opens where it lives.
  const links = await ItemRefs.links();
  const catalog = rows.length || taskRows.length ? await ItemRefs.orgCatalog(query, orgId) : [];
  const linkedTask = {}, journeyOf = {};
  if (rows.length) {
    for (const r of await query(`SELECT id, thread_id FROM tasks WHERE org_id = ? AND link_kind = 'next_step' AND done = 0 AND thread_id = ANY(?::text[])`,
      [orgId, rows.map(r => r.id)]).catch(() => [])) linkedTask[r.thread_id] = r.id;
    // A step a journey opened names that journey.
    for (const r of await query(
      `SELECT s.thread_id, p.template_id, COALESCE(ct.name, p.template_name) AS name
         FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id AND p.org_id = s.org_id
         LEFT JOIN cultivation_templates ct ON ct.id = p.template_id AND ct.org_id = p.org_id
        WHERE s.org_id = ? AND s.thread_id = ANY(?::text[]) AND p.template_id IS NOT NULL`,
      [orgId, rows.map(r => r.id)]).catch(() => [])) journeyOf[r.thread_id] = { kind: "journey", id: r.template_id, name: links.realName(r.name) };
  }
  const list = [];
  let snoozed = 0, unowned = 0;
  for (const t of rows) {
    const snoozedOut = t.snoozed_until && String(t.snoozed_until) > today;
    if (snoozedOut && !donorId) { snoozed++; continue; }
    if (!t.owner_id) unowned++;
    const daysOpen = orgTime.daysBetween(t.opened_on, today) ?? 0;
    const lastTouch = t.opening_interaction_id
      ? { kind: "interaction", type: t.touch_type, date: t.touch_date, line: t.touch_type === "activity" ? DDth.humanDates(t.touch_note, today) : t.touch_note, actor: t.touch_actor,
          // THREAD-2: what she logged is a line on the person, and opens there.
          ref: { kind: t.touch_type === "meeting" ? "meeting" : (t.touch_type || "note"), logged: true, id: t.opening_interaction_id, donorId: t.donor_id } }
      : t.opening_gift_id
        ? { kind: "gift", type: "gift", date: t.gift_date ? String(t.gift_date).slice(0, 10) : t.opened_on, amount: t.gift_amount != null ? parseFloat(t.gift_amount) : null, actor: t.created_by_name || null,
            ref: { kind: "gift", id: t.opening_gift_id, donorId: t.donor_id } }
        : { kind: "none", type: null, date: t.opened_on, line: null, actor: t.created_by_name || null };
    const person = { kind: "person", id: t.donor_id, name: links.nameOrFallback(t.donor_name, t.donor_email), email: t.donor_email || null };
    list.push({
      id: t.id, kind: "thread", donorId: t.donor_id, donorName: person.name,
      // THREAD-2 · EVERY NAME IS A LINK. The person, what opened the thread,
      // the step (its task, or its meeting) and anything the words name.
      refs: [person, ...(lastTouch.ref ? [lastTouch.ref] : []),
        ...(t.calendar_event_id ? [{ kind: "meeting", id: t.calendar_event_id, donorId: t.donor_id, date: t.due_date }] : []),
        ...(journeyOf[t.id] ? [journeyOf[t.id]] : []),
        ...ItemRefs.refsNamedIn([t.next_step_label, t.touch_note], catalog)],
      journey: journeyOf[t.id] || null,
      stepRef: t.calendar_event_id ? { kind: "meeting", id: t.calendar_event_id, donorId: t.donor_id, date: t.due_date }
        : (linkedTask[t.id] ? { kind: "task", id: linkedTask[t.id], donorId: t.donor_id } : null),
      nextStep: { type: t.next_step_type, label: t.next_step_label, due: t.due_date, time: t.due_time || null,
                  // The day this was first promised, when a revisit has moved
                  // the due date since. Null on a thread nobody deferred.
                  originalDue: t.original_due_date || null },
      overdue: t.due_date < today,
      // BUILD-86 — HOW LATE, computed ONCE, server-side, on the civil calendar.
      // The morning sentence was deriving it from Date.now() against the due
      // date and landing a day off the row's own "Overdue 23 days" — two
      // numbers for one fact, on one screen. There is one now and both read it.
      overdueDays: t.due_date < today ? (orgTime.daysBetween(t.due_date, today) ?? 0) : 0,
      daysOpen, openedOn: t.opened_on,
      // FIX-14: the rail's next step shows "Edited" from these.
      edited_at: t.edited_at || null, edited_by_name: t.edited_by_name || null,
      owner: t.owner_id ? { id: t.owner_id, name: t.owner_name } : null,
      calendarEventId: t.calendar_event_id || null,   // FIX-33: a meeting step opens its meeting
      lastTouch, snoozedUntil: snoozedOut ? t.snoozed_until : null,
      followon: t.followon_type ? { type: t.followon_type, label: t.followon_label, due: t.followon_due } : null,
      // The rank inputs ride ALONG so the client can explain a row without a
      // second request, and so the pure module stays the only place that
      // decides what they mean.
      signals: {
        dueDate: t.due_date, stepType: t.next_step_type, stepLabel: t.next_step_label, daysOpen,
        openAskAmount: asks[t.donor_id] || 0,
        recurringAtRisk: atRisk.has(t.donor_id),
        // The opening gift was this donor's FIRST when the thread was opened
        // by a gift and the donor has exactly one on record. Cheap, and right
        // for the moment that matters: the gift that decides whether a second
        // one ever comes.
        isFirstGift: !!t.opening_gift_id && Number(t.gift_count) === 1,
        lifetimeGiving: parseFloat(t.total_giving) || 0,
        majorThreshold,
      },
    });
    // ENGAGE-1 §3 — a step that IS an ask carries the suggested ask, worked
    // out from this donor's own gifts (engagement.js; never wealth data).
    if (t.next_step_type === "check_in_ask" || /\bask\b/i.test(String(t.next_step_label || ""))) {
      list[list.length - 1].suggestedAsk = await engagementMod.suggestedAsk(query, orgId, t.donor_id).catch(() => null);
    }
  }

  // The tasks, in the same shape, so the ranking cannot tell them apart by
  // anything except what they actually say.
  for (const k of taskRows) {
    const due = String(k.due).slice(0, 10);
    const openedOn = k.created_at ? new Date(k.created_at).toISOString().slice(0, 10) : due;
    const daysOpen = orgTime.daysBetween(openedOn, today) ?? 0;
    const kPerson = { kind: "person", id: k.donor_id, name: links.nameOrFallback(k.donor_name, k.donor_email), email: k.donor_email || null };
    list.push({
      id: k.id, kind: "task", donorId: k.donor_id, donorName: kPerson.name,
      refs: [kPerson, { kind: "task", id: k.id, donorId: k.donor_id },
        ...(k.source_gift_id ? [{ kind: "gift", id: k.source_gift_id, donorId: k.donor_id }] : []),
        ...(k.calendar_event_id ? [{ kind: "meeting", id: k.calendar_event_id, donorId: k.donor_id, date: due }] : []),
        ...ItemRefs.refsNamedIn([k.title], catalog)],
      stepRef: k.calendar_event_id ? { kind: "meeting", id: k.calendar_event_id, donorId: k.donor_id, date: due } : { kind: "task", id: k.id, donorId: k.donor_id },
      nextStep: { type: k.type || "task", label: k.title, due, time: null, originalDue: null },
      // FIX-33: a meeting's prep and after tasks open the meeting they belong to.
      calendarEventId: k.calendar_event_id || null,
      // FIX-34: Done on a task row finishes THAT task, through its own route,
      // never the donor's open thread (logging a conversation would close the
      // meeting step a prep task belongs to). The row then shows the next step.
      doneRoute: `/tasks/${encodeURIComponent(k.id)}/complete`,
      overdue: due < today,
      overdueDays: due < today ? (orgTime.daysBetween(due, today) ?? 0) : 0,
      daysOpen: Math.max(0, daysOpen), openedOn,
      owner: k.assigned_to ? { id: k.assigned_to, name: k.assigned_to_name } : null,
      lastTouch: { kind: "none", type: null, date: openedOn, line: null, actor: k.assigned_to_name || null },
      snoozedUntil: null, followon: null,
      signals: {
        dueDate: due, stepType: k.type || "task", stepLabel: k.title, daysOpen: Math.max(0, daysOpen),
        // VOICE-4: a task shows only what belongs to it. The donor's open ask
        // is context for a task about the ask, never for "Send Margaret the
        // receipt"; a task made for a gift leads with that gift.
        openAskAmount: /\b(ask|asks|proposal|pledge|solicit)\b/i.test(String(k.title || "")) ? (asks[k.donor_id] || 0) : 0,
        giftAmount: k.source_gift_amount != null ? parseFloat(k.source_gift_amount) || 0 : 0,
        giftDate: k.source_gift_date ? String(k.source_gift_date).slice(0, 10) : null,
        recurringAtRisk: atRisk.has(k.donor_id),
        isFirstGift: false,
        lifetimeGiving: parseFloat(k.total_giving) || 0,
        majorThreshold,
      },
    });
  }

  // FIX-34 · ONE ROW PER DONOR. A booked meeting put three rows on the Thread
  // for one person (the prep, the meeting, "How did it go?"). The Thread is a
  // list of PEOPLE: each donor shows once, as the soonest open step, carrying
  // the rest as `moreSteps` (the row opens them in place). Done on that row
  // leaves the next one soonest. Tasks still lists every step; a profile read
  // (donorId) keeps every row. Counts below are donors, not steps.
  let shownList = list;
  if (!donorId) {
    const soon = (a, b) => String(a.nextStep.due || "9999").localeCompare(String(b.nextStep.due || "9999"))
      || (a.kind === b.kind ? 0 : a.kind === "thread" ? -1 : 1) || String(a.nextStep.time || "").localeCompare(String(b.nextStep.time || ""));
    const byDonor = new Map();
    for (const r of list) { if (!byDonor.has(r.donorId)) byDonor.set(r.donorId, []); byDonor.get(r.donorId).push(r); }
    shownList = [];
    for (const rs of byDonor.values()) {
      rs.sort(soon);
      const [head, ...rest] = rs;
      head.moreSteps = rest.map(r => ({ id: r.id, kind: r.kind, label: r.nextStep.label, due: r.nextStep.due, time: r.nextStep.time || null, stepRef: r.stepRef || null,
        overdue: r.overdue, calendarEventId: r.calendarEventId || null }));
      shownList.push(head);
    }
  }
  // Rank + band + cap in the ONE place that decides it.
  const forRank = shownList.map(t => ({ ...t, ...t.signals }));
  const q = rank.buildQueue(forRank, today, { cap: donorId ? 0 : (cap == null ? rank.QUEUE_CAP : cap) });
  const ranked = q.list.map(r => {
    const { signals, ...rest } = r;
    return { ...rest, rank: r.rank, band: r.band };
  });

  const overdue = shownList.filter(t => t.overdue).length;
  // FIX-1 §9 — "oldest" is the oldest ROW, by the one figure its badge and the
  // Home sentence also read (shared/threadFigures.js), over the whole list, not
  // the capped one. It used to be max(daysOpen) while the badges said overdue.
  const { threadFigures } = await import("../../shared/threadFigures.js");
  const figures = threadFigures(shownList);
  const oldestDays = figures.oldest ? figures.oldest.days : 0;
  const oldest = figures.oldest && figures.oldest.days > 0 ? figures.oldest : null;
  const [{ n: everCount } = { n: 0 }] = await query(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id = ?`, [orgId]);
  return {
    list: ranked, bands: q.bands, more: q.more,
    stat: { open: shownList.length, steps: list.length, overdue, oldestDays, oldest, snoozed, unowned, shown: ranked.length },
    scope: effScope, canViewAll: isAdmin, hasAny: everCount > 0, today,
  };
}

// One thread's next step, as a calendar event. The ONE place a task becomes an
// appointment — every output below reads this, so they cannot disagree.
async function calendarEventForThread(orgId, threadId) {
  await CAL_READY;
  const [t] = await query(
    `SELECT t.id, t.next_step_label, t.next_step_type, t.due_date, t.due_time,
            d.id AS donor_id, d.name AS donor_name
       FROM threads t JOIN donors d ON d.id = t.donor_id
      WHERE t.id = ? AND t.org_id = ?`, [threadId, orgId]);
  if (!t) return null;
  const [org] = await query(`SELECT name FROM orgs WHERE id = ?`, [orgId]);
  const tzName = await orgTzName(orgId);
  // The time is HH:MM in the ORG's zone (BUILD-84). No time = an ALL-DAY
  // event; inventing 9am would put a fictional appointment in her morning.
  const startInstant = t.due_time
    ? orgTime.localToInstant(`${t.due_date}T${t.due_time}`, tzName)   // ORG_TZ_SEAM_OK
    : null;
  // The last logged line on this person — what she will actually need to
  // remember when the reminder fires three days from now.
  const [last] = await query(
    `SELECT note FROM interactions WHERE org_id = ? AND donor_id = ?
      ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 1`, [orgId, t.donor_id]).catch(() => []);
  const recordUrl = `${publicAppUrl()}/donors/${t.donor_id}`;
  return {
    uid: CAL.taskUid(orgId, t.id),
    // "Call Bill Harmon" — the step and the person, which is the whole
    // subject somebody needs in a calendar three days from now.
    subject: `${t.next_step_label} ${t.donor_name}`.replace(/\s+/g, " ").trim(),
    description: CAL.eventDescription({
      lastLine: last?.note || null, personName: t.donor_name,
      recordUrl, orgName: org?.name || null,
    }),
    startInstant, dueCivil: t.due_date, minutes: CAL.DEFAULT_MINUTES,
    timezone: tzName, donorId: t.donor_id, donorName: t.donor_name,
  };
}

// The three links for one next step. A GET, and it changes nothing.
app.get("/threads/:id/calendar", requireAuth, wrap(async (req, res) => {
  await CAL_READY;
  const ev = await calendarEventForThread(req.user.orgId, req.params.id);
  if (!ev) return res.status(404).json({ error: "Not found" });
  res.json({
    subject: ev.subject,
    startsAt: ev.startInstant ? new Date(ev.startInstant).toISOString() : null,
    allDay: !ev.startInstant, dueDate: ev.dueCivil, timezone: ev.timezone,
    outlook: CAL.outlookUrl(ev),
    google: CAL.googleUrl(ev),
    ics: `/threads/${req.params.id}/calendar.ics`,
    uid: ev.uid,
    note: CAL.NOT_SYNC_NOTE,
  });
}));

// The .ics itself, generated SERVER-SIDE so the UID rule lives in one place.
app.get("/threads/:id/calendar.ics", requireAuth, wrap(async (req, res) => {
  await CAL_READY;
  const ev = await calendarEventForThread(req.user.orgId, req.params.id);
  if (!ev) return res.status(404).json({ error: "Not found" });
  const filename = (ev.subject || "task").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "task";
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}.ics"`);
  // No caching: the step's time can change, and a cached .ics is a stale
  // appointment that looks current.
  res.set("Cache-Control", "no-store");
  res.send(CAL.buildIcs(ev));
}));

app.get("/threads", requireAuth, wrap(async (req, res) => {
  const donorId = req.query.donorId ? String(req.query.donorId) : null;
  const cap = /^\d+$/.test(String(req.query.cap || "")) ? Math.min(200, parseInt(req.query.cap, 10)) : null;
  res.json(await composeThreads(req.user.orgId, {
    donorId, cap,
    scope: String(req.query.scope || "mine"),
    userId: req.user.userId,
    isAdmin: req.user.role === "admin",
  }));
}));

// POST /threads/:id/dismiss — the other way out. reason ∈ the short fixed
// list; "revisit" is a snooze (the thread stays open, resurfaces on the
// date), the other two close the thread with the reason on the row.
TDONE.register(app, { query, run, wrap, requireAuth, checkWriteAccess, actor, advanceCultivationPlan });   // FLOWS-1 item 12: Mark done marks it done
app.post("/threads/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const [t] = await query("SELECT * FROM threads WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Thread not found" });
  if (t.closed_at) return res.status(400).json({ error: "Thread is already closed" });

  const { DISMISS_REASONS } = await threadShapeMod();
  const reason = String(req.body?.reason || "");
  if (!DISMISS_REASONS.some(r => r.key === reason)) {
    return res.status(400).json({ error: "reason must be one of: " + DISMISS_REASONS.map(r => r.key).join(", ") });
  }
  if (reason === "revisit") {
    const on = String(req.body?.revisitOn || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return res.status(400).json({ error: "revisitOn must be a date (YYYY-MM-DD)" });
    const org = await orgTz(orgId);
    if (on <= orgToday(org)) return res.status(400).json({ error: "revisitOn must be a future date, a revisit today is just the open thread" });   // ORG_TZ_SEAM_OK
    // MOVE the due date, and keep the first one. A revisit is a new promise
    // about when; leaving due_date behind made every deferred thread return as
    // a false alarm, and dropping it would lose the day she originally said.
    // COALESCE means a thread snoozed twice still remembers the FIRST date.
    await run(
      `UPDATE threads
          SET original_due_date = COALESCE(original_due_date, due_date),
              due_date = ?, snoozed_until = ?
        WHERE id = ?`, [on, on, req.params.id]);
    return res.json({ ok: true, snoozedUntil: on, dueDate: on, originalDue: t.original_due_date || t.due_date });
  }
  await run(
    "UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = ? WHERE id = ?",
    [reason, req.params.id]);
  // BUILD-99 Part 3 — a dismissal closes a plan step too. Deciding not to do
  // something is still deciding; the plan moves on rather than sitting on a
  // thread nobody is going to act on.
  await advanceCultivationPlan(orgId, t.donor_id, {
    actorId: actor(req).id, actorName: actor(req).name,
  }).catch(e => console.error("[plan] advance:", e.message));
  res.json({ ok: true, dismissed: reason });
}));

// ── BUILD-85 — PLANNING FORWARD ────────────────────────────────────────────
// Every BUILD-81 opener required something to have ALREADY HAPPENED: a logged
// conversation, a gift, a drift-done, a sustainer lapse. Half of a
// fundraiser's week is not reactive — "I am calling these twenty lapsed
// donors this month" had nowhere to live, so it lived in Tasks, which is what
// kept two follow-up systems alive at once.
//
// This does NOT reopen the tasks battle. That rule was "logging a
// conversation must not require a second step", not "you may never plan". A
// planned thread is the same row as any other: one donor, one open step, one
// owner, closed honestly by the same conversation flow. Its `lastTouch.kind`
// is "none", a case composeThreads has always handled.
app.post("/donors/:id/threads", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [donor] = await query(
    "SELECT id, name, assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const shape = await threadShapeMod();
  const label = shape.sanitizeStepLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: "A next step needs a label, say what you are going to do." });
  const due = String(req.body?.due || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "due must be a date (YYYY-MM-DD)" });

  const org = await orgTz(orgId);
  const today = orgToday(org);                          // ORG_TZ_SEAM_OK
  let time = shape.sanitizeStepTime(req.body?.time);
  if (req.body?.time != null && req.body.time !== "" && !time)
    return res.status(400).json({ error: "time must be a 24-hour HH:MM, or omitted for a date-only step" });
  if (time && !org.timezone_confirmed_at)
    return res.status(400).json({ error: "timezone_unset", message: "Set your organization's timezone in Settings before scheduling a reminder at a specific time." });

  // ONE OPEN THREAD PER DONOR is the model, and the DB enforces it
  // (threads_one_open). Refuse with the thread that is already there rather
  // than silently replacing a commitment somebody made.
  const [open] = await query(
    "SELECT id, next_step_label, due_date FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL",
    [orgId, req.params.id]);
  const DDt = await import("../../shared/displayDate.js");
  if (open) return res.status(409).json({ error: "thread_open",
    message: `${donor.name} already has an open next step: "${open.next_step_label}", due ${DDt.displayDate(open.due_date)}.`,
    thread: { id: open.id, label: open.next_step_label, due: open.due_date } });

  // FIX-19: an ownerId from the body is an active user of THIS org, or the
  // request is refused before anything is written.
  const named = await OU.orgUser(orgId, req.body?.ownerId);
  if (!named.ok) return OU.refuse(res, "ownerId");
  const userRow = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRow[0]?.name || "";
  const step = { type: shape.nextStepTypeForLabel(label), label, due, time };
  const thread = await withTransaction(client => openThreadTx(client, {
    orgId, donorId: req.params.id, step, openedOn: today,
    ownerId: named.user ? named.user.id : (donor.assigned_to || userId),
    ownerName: named.user ? named.user.name : (donor.assigned_to ? donor.assigned_to_name : userName),
    actorId: userId, actorName: userName,
  }));
  // RACE-1: a press beside another loses at the index; it answers 409, as a later press does.
  if (!thread) return res.status(409).json({ error: "thread_open", message: `${donor.name} already has an open next step.` });
  res.status(201).json({ thread });
}));

// POST /threads/plan — the same act, for a selection. "Call these twenty
// lapsed donors" in one request. A donor who ALREADY has an open thread is
// SKIPPED and REPORTED, never overwritten: the whole point of the one-open
// rule is that a commitment already made outranks a plan being drawn up.
const BULK_PLAN_MAX = 200;
app.post("/threads/plan", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const ids = Array.isArray(req.body?.donorIds) ? req.body.donorIds.map(String).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "donorIds must be a non-empty array" });
  if (ids.length > BULK_PLAN_MAX) return res.status(400).json({ error: `At most ${BULK_PLAN_MAX} donors at a time` });

  const shape = await threadShapeMod();
  const label = shape.sanitizeStepLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: "A next step needs a label, say what you are going to do." });
  const due = String(req.body?.due || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "due must be a date (YYYY-MM-DD)" });

  const org = await orgTz(orgId);
  const today = orgToday(org);                          // ORG_TZ_SEAM_OK
  const userRow = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRow[0]?.name || "";

  // Org-scoped up front: an id from another org is not found, never planted.
  // REDTEAM-2: the ids as one bound array, not a placeholder list built into the text.
  const donors = await query(
    `SELECT id, name, assigned_to, assigned_to_name FROM donors
      WHERE org_id = ? AND deleted_at IS NULL AND id = ANY(?::text[])`, [orgId, ids]);
  const byId = new Map(donors.map(d => [d.id, d]));
  const openAlready = new Set((await query(
    `SELECT donor_id FROM threads WHERE org_id = ? AND closed_at IS NULL AND donor_id = ANY(?::text[])`,
    [orgId, ids])).map(r => r.donor_id));

  const planned = [], skipped = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) { skipped.push({ donorId: id, reason: "not_found" }); continue; }
    if (openAlready.has(id)) { skipped.push({ donorId: id, donorName: d.name, reason: "already_open" }); continue; }
    try {
      const t = await withTransaction(client => openThreadTx(client, {
        orgId, donorId: id, step: { type: shape.nextStepTypeForLabel(label), label, due, time: null },
        openedOn: today, ownerId: d.assigned_to || userId,
        ownerName: d.assigned_to ? d.assigned_to_name : userName,
        actorId: userId, actorName: userName,
      }));
      planned.push({ donorId: id, donorName: d.name, threadId: t?.id || null });
    } catch (e) {
      // The partial unique index is the arbiter under a race — a loser is a
      // skip with a reason, never a 500 and never a second open thread.
      skipped.push({ donorId: id, donorName: d.name, reason: "already_open" });
    }
  }
  res.status(201).json({ planned: planned.length, skipped: skipped.length, details: { planned, skipped } });
}));

app.get("/threads/health", requireAuth, wrap(async (req, res) => {
  const days = /^\d+$/.test(String(req.query.days || "")) ? Math.min(365, parseInt(req.query.days, 10)) : 30;
  res.json(await computeThreadHealth(req.user.orgId, { days }));
}));

// POST /digests/run-daily (requireAuth + requireAdmin) — drive the daily
// reminder for the caller's org NOW (ops/test hook, same bar as /digests/run).
// {today?, dryRun?} pin the date / preview without sending.
app.post("/digests/run-daily", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, timezone FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const today = (req.body && req.body.today) || orgToday(org); // ORG_TZ_SEAM_OK (BUILD-75 A.3)
  const out = await runDailyTaskRemindersForOrg(org, { today, send: !(req.body && req.body.dryRun) });
  res.json({ today, ...out });
}));

// POST /nudges/run (requireAuth + requireAdmin) — drive the morning email for
// the caller's org NOW (ops/test hook, /digests/run-daily's bar). {today?}
// pins the date; each person's own days (weekdays or every day) still apply
// to the pinned date unless {force:true}; {hour?} checks each person's own
// hour, and without it the hour is not checked (time-of-day flaky otherwise).
app.post("/nudges/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, legal_name, timezone, receipt_address, thread_nudge_weekends FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const today = (req.body && req.body.today) || orgToday(org);   // ORG_TZ_SEAM_OK
  const hour = Number.isInteger(req.body?.hour) ? req.body.hour : null;
  // STAFF-MAIL-2: {kind:"weekly"} runs the weekly email instead; with dryRun
  // it composes only and returns each person's email, which is the preview.
  const run1 = req.body?.kind === "weekly" ? runWeeklyEmailForOrg : runThreadNudgesForOrg;
  const out = await run1(org, { today, send: !(req.body && req.body.dryRun), nowHour: hour, force: !!req.body?.force });
  res.json({ today, ...out });
}));

// POST /step-reminders/run — the ops/test hook, same bar as POST /nudges/run.
// {today, now} pin the org's date and wall clock so the SCHEDULE is testable;
// {force:true} ignores the delivery window; {dryRun:true} composes only.
app.post("/step-reminders/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, legal_name, timezone, receipt_address FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const clock = orgTime.orgClock(org);                  // ORG_TZ_SEAM_OK
  const today = (req.body && req.body.today) || clock.date;
  const nowHHMM = (req.body && req.body.now)
    || `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
  const out = await runStepRemindersForOrg(org, {
    today, nowHHMM, force: !!req.body?.force, send: !(req.body && req.body.dryRun) });
  res.json({ today, now: nowHHMM, ...out });
}));

// GET /digests/preview — compose (never send) the caller's current digest, for
// the in-app "Week in Review" view. Scope follows the caller's role/plan.
app.get("/digests/preview", requireAuth, wrap(async (req, res) => {
  const type = req.query.type === "monthly" ? "monthly" : "weekly";
  const orgRows = await query("SELECT id, name, plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "Org not found" });
  const tier = orgPlanTier(org);
  const [me] = await query("SELECT id, name, role FROM users WHERE id=?", [req.user.userId]);
  // Preview the most-recently-completed period (what actually gets emailed),
  // matching the tick — offset -1.
  if (type === "monthly") {
    // Core: return the caller's own monthly report as a READ-only locked
    // preview (their own gifts/portfolio — a pure read), flagged locked so the
    // client dims it behind LockedFeature instead of a bare 403 card.
    const mo = monthBounds(-1, await orgTz(org.id));   // ORG_TZ_SEAM_OK
    const report = await composeOfficerMonthly(org.id, mo, { id: me.id, name: me.name });
    return res.json({ type, window: mo, report, locked: tier !== "team" });
  }
  const wk = weekBounds(-1, await orgTz(org.id));   // ORG_TZ_SEAM_OK
  const isOfficerScope = tier === "team" && me.role !== "admin";
  const sections = await composeWeekInReview(org.id, wk, isOfficerScope ? me.id : null);
  const teamRollup = isOfficerScope ? (await composeWeekInReview(org.id, wk, null)).totals : null;
  res.json({ type, window: wk, scope: isOfficerScope ? "officer" : "org", tier, sections, teamRollup });
}));

// POST /digests/run — actually reserve + send the caller's org digests now
// (requireAuth + requireAdmin). Drives the same path the tick uses, for ops
// and for the committed test suite. Optional window overrides pin the period
// (so tests can seed a specific week/month); dryRun composes without sending.
app.post("/digests/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgRows = await query("SELECT id, name, plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "Org not found" });
  const { weekStart, monthStart, type, dryRun } = req.body || {};
  const types = type === "weekly" || type === "monthly" ? [type] : ["weekly", "monthly"];
  // Build windows: explicit override (a Monday / month-start date) or the
  // most-recently-completed period.
  // ORG_TZ_SEAM_OK — an explicit override pins the window to a civil date the
  // caller supplied; otherwise the org's own most-recently-completed period.
  const _tz = await orgTz(org.id);
  const wk = weekStart ? weekBounds(0, _tz, new Date(weekStart + "T12:00:00Z")) : weekBounds(-1, _tz);
  const mo = monthStart ? monthBounds(0, _tz, new Date(monthStart + "T12:00:00Z")) : monthBounds(-1, _tz);
  const result = await runDigestsForOrg(org, { wk, mo, types, send: !dryRun });
  res.json({ windows: { weekly: wk, monthly: mo }, ...result });
}));

// ── Personal-note reminders (non-AI-drafted sibling of milestone_drafts) ───
app.get("/note-reminders", requireAuth, wrap(async (req, res) => {
  const status = req.query.status || "pending";
  const rows = await query(
    `SELECT nr.*, d.name AS donor_name, d.email AS donor_email, d.total_giving AS donor_total_giving
     FROM note_reminders nr
     JOIN donors d ON d.id = nr.donor_id
     WHERE nr.org_id = ? AND nr.status = ?
     ORDER BY nr.created_at DESC`,
    [req.user.orgId, status]
  );
  res.json(rows.map(r => ({ ...r, talking_points: typeof r.talking_points === "string" ? JSON.parse(r.talking_points) : r.talking_points })));
}));

// Marks the reminder sent and logs a stewardship interaction confirming a
// personal note went out — never generates or stores any note content.
app.post("/note-reminders/:id/send", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM note_reminders WHERE id=? AND org_id=? AND status='pending'",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found or already handled" });
  const reminder = rows[0];
  const points = typeof reminder.talking_points === "string" ? JSON.parse(reminder.talking_points) : reminder.talking_points;

  await run(
    "UPDATE note_reminders SET status='sent', sent_at=NOW(), sent_by=? WHERE id=?",
    [req.user.userId, reminder.id]
  );
  const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  await run(
    "INSERT INTO interactions (id, org_id, donor_id, type, note, date, metadata) VALUES (?, ?, ?, 'stewardship', ?, ?, ?)",
    [newId("i"), req.user.orgId, reminder.donor_id, "Personal note sent", today,
     JSON.stringify({ stewardship_type: "personal_note", detail: (points || []).join(" · ") })]
  ).catch(() => {});

  res.json({ success: true });
}));

app.post("/note-reminders/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const affected = await run(
    "UPDATE note_reminders SET status='dismissed' WHERE id=? AND org_id=? AND status='pending'",
    [req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already handled" });
  res.json({ success: true });
}));

// Fire-and-forget wrapper for the task routes: load the org + fire the
// assignment email. actorUserId = who triggered the assignment (null = workflow).
async function queueTaskAssignmentEmail(task, actorUserId, eventKey = null) {
  if (!task || !task.assigned_to) return;
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [task.org_id]);
  if (!org) return;
  await notifyTaskAssignment(task, { org, actorUserId, eventKey });
}
}

module.exports = { routers, mount };
