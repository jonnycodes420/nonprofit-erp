// routes/setup.js · ONBOARD-1. The Setup screen's routes. See setup.js for
// what each step does and the lines it never crosses.
//
//   GET  /setup/current               the org's latest run, its plan and progress
//   POST /setup/runs                  files + website + tools in, a PLAN out (writes nothing else)
//   PUT  /setup/runs/:id/answers      her answers to the question cards
//   POST /setup/runs/:id/start        the one Start: the work runs on the server
//   POST /setup/runs/:id/resume       carry on after a closed tab or a restart
//   POST /setup/runs/:id/undo         "Undo all of setup"
//   PUT  /setup/invites/:id           the email for a prepared invitation
//   POST /setup/invites/:id/send      HER click: the one invite route, once
//   POST /admin/orgs/:id/setup        super-admin prepares a plan for an org (she presses Start)
//   GET  /admin/setup-times           minutes from Start to ready, per org
"use strict";
const express = require("express");
const S = require("../setup");

const routers = { r0: express.Router() };
const MAX_FILES = 12;
const MAX_FILE_CHARS = 20 * 1024 * 1024;

function mount(ctx) {
const { query, run, uuid, wrap, requireAuth, requireAdmin, requireSuperAdmin, checkWriteAccess, actor, orgTz, orgToday,
  aiGate, anthropicFor, recordAiFallback } = ctx;
const app = routers.r0;
S.configure({ aiGate, anthropicFor, recordAiFallback, orgTz, orgToday });

async function whoOf(req) {
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [a.id, req.user.orgId]);
  return { id: a.id, name: (u && u.name) || a.name || null };
}
const callOf = async req => { const w = await whoOf(req); return { auth: req.headers.authorization, userId: w.id, userName: w.name }; };

async function runOut(orgId, r) {
  if (!r) return null;
  const invites = await query(`SELECT id, name, title, email, role, status, sent_at FROM setup_invites WHERE org_id=? AND run_id=? ORDER BY created_at`, [orgId, r.id]);
  const steps = S.STEP_KEYS.map(k => ({ key: k, ...(r.steps[k] || { status: "waiting" }) }));
  return { id: r.id, status: r.status, siteUrl: r.site_url, tools: r.tools || [], plan: r.plan, answers: r.answers || {},
    steps, readout: r.readout, error: r.error, stalled: S.isOrphaned(r), startedAt: r.started_at, completedAt: r.completed_at, undoneAt: r.undone_at,
    site: r.site ? { ok: r.site.ok, reason: r.site.reason, pagesRead: r.site.pagesRead,
      facts: Object.fromEntries(Object.entries(r.site.facts || {}).map(([k, v]) => [k, { value: v.value, from: v.from }])) } : null,
    invites, toolCards: S.TOOL_CARDS };
}

async function createRun(orgId, who, b) {
  const files = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES) : [];
  if (!files.length && !b.siteUrl) return { status: 400, body: { error: "nothing_given", sentence: "Add your donor files or your website address to start." } };
  for (const f of files) {
    const body = f && (typeof f.text === "string" ? f.text : Array.isArray(f.records) ? JSON.stringify({ records: f.records }) : null);
    if (!body || !String(f.name || "").trim()) return { status: 400, body: { error: "bad_file", sentence: "A file arrived without its name or its contents." } };
    if (body.length > MAX_FILE_CHARS) return { status: 413, body: { error: "file_too_big", sentence: `${String(f.name).slice(0, 80)} is larger than setup reads at once. Use Import for it.` } };
  }
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(String).filter(t => S.TOOL_KEYS.includes(t));
  const id = "sr_" + uuid().replace(/-/g, "").slice(0, 12);
  const instr = "ai_" + uuid().replace(/-/g, "").slice(0, 12);
  // The plan-then-confirm pipeline: her instruction is a row, in her words.
  await run(`INSERT INTO agent_instructions (id, org_id, text, kind, status, persona, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?)`, [instr, orgId, "Set up Steward for me", "task", "planned", "setup", who.id, who.name]);
  await run(`INSERT INTO setup_runs (id, org_id, instruction_id, status, site_url, tools, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?)`, [id, orgId, instr, "planned", String(b.siteUrl || "").trim().slice(0, 400) || null, JSON.stringify(tools), who.id, who.name]);
  for (const f of files) {
    const body = typeof f.text === "string" ? JSON.stringify({ text: f.text }) : JSON.stringify({ records: f.records });
    await run(`INSERT INTO setup_files (id, org_id, run_id, name, body, bytes, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
      ["sf_" + uuid().replace(/-/g, "").slice(0, 12), orgId, id, String(f.name).slice(0, 200), body, body.length, who.id, who.name]);
  }
  const plan = await S.planRun(orgId, id, { today: orgToday(await orgTz(orgId)) });   // ORG_TZ_SEAM_OK
  await run(`UPDATE agent_instructions SET plan=? WHERE id=? AND org_id=?`, [JSON.stringify(plan), instr, orgId]);
  return { status: 201, body: await runOut(orgId, await S.loadRun(orgId, id)) };
}

app.get("/setup/current", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query(`SELECT id FROM setup_runs WHERE org_id=? AND status<>'undone' ORDER BY created_at DESC LIMIT 1`, [orgId]);
  const [o] = await query(`SELECT setup_started_at, setup_completed_at FROM orgs WHERE id=?`, [orgId]);
  // A closed tab never stops setup. A restart does stop the process working
  // on it; the page then says so and offers "Carry on", which is a POST (a GET
  // never changes state).
  const full = r ? await S.loadRun(orgId, r.id) : null;
  res.json({ run: full ? await runOut(orgId, full) : null,
    startedAt: o && o.setup_started_at, completedAt: o && o.setup_completed_at });
}));

app.post("/setup/runs", requireAuth, requireAdmin, checkWriteAccess, express.json({ limit: "64mb" }), wrap(async (req, res) => {
  const out = await createRun(req.user.orgId, await whoOf(req), req.body || {});
  res.status(out.status).json(out.body);
}));

app.put("/setup/runs/:id/answers", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await S.loadRun(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  if (r.status !== "planned") return res.status(409).json({ error: "already_started", sentence: "Setup has started, so its answers are set." });
  const allowed = new Set([...((r.plan && r.plan.questions) || []), ...((r.plan && r.plan.later) || [])].map(q => q.key));
  const next = { ...(r.answers || {}) };
  for (const [k, v] of Object.entries((req.body && req.body.answers) || {})) if (allowed.has(k)) next[k] = String(v == null ? "" : v).slice(0, 400);
  await run(`UPDATE setup_runs SET answers=?, updated_at=NOW() WHERE id=? AND org_id=?`, [JSON.stringify(next), r.id, orgId]);
  res.json(await runOut(orgId, await S.loadRun(orgId, r.id)));
}));

app.post("/setup/runs/:id/start", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  // A super-admin prepares the plan; the org's own person presses Start, so
  // every write is made in her session and carries her name.
  if (req.user.isSuperAdmin || req.user.is_super_admin) return res.status(403).json({ error: "not_yours_to_start", sentence: "The organization's own admin presses Start." });
  const r = await S.loadRun(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  if (r.status !== "planned") return res.status(409).json({ error: "already_started", run: await runOut(orgId, r) });
  const who = await whoOf(req);
  const agentRun = "ar_" + uuid().replace(/-/g, "").slice(0, 12);
  await run(`INSERT INTO agent_runs (id, org_id, instruction_id, status, plan) VALUES (?,?,?,?,?)`, [agentRun, orgId, r.instruction_id, "running", JSON.stringify(r.plan)]);
  await run(`UPDATE agent_instructions SET status='active', turned_on_by=?, turned_on_by_name=?, turned_on_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`,
    [who.id, who.name, r.instruction_id, orgId]);
  await run(`UPDATE setup_runs SET status='running', agent_run_id=?, started_at=NOW(), heartbeat_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`, [agentRun, r.id, orgId]);
  await run(`UPDATE orgs SET setup_started_at=COALESCE(setup_started_at, NOW()), setup_completed_at=NULL WHERE id=?`, [orgId]);
  const call = await callOf(req);
  S.execute(orgId, r.id, call).catch(e => console.error("[setup] run failed:", r.id, e && e.message));
  res.status(202).json(await runOut(orgId, await S.loadRun(orgId, r.id)));
}));

app.post("/setup/runs/:id/resume", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await S.loadRun(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  if (!["running", "failed"].includes(r.status)) return res.status(409).json({ error: "not_resumable", run: await runOut(orgId, r) });
  if (r.status === "failed") {
    for (const k of S.STEP_KEYS) if (r.steps[k] && r.steps[k].status === "failed") r.steps[k] = { ...r.steps[k], status: "waiting", error: null };
    await run(`UPDATE setup_runs SET status='running', error=NULL, steps=? WHERE id=? AND org_id=?`, [JSON.stringify(r.steps), r.id, orgId]);
  }
  S.execute(orgId, r.id, await callOf(req)).catch(e => console.error("[setup] resume failed:", r.id, e && e.message));
  res.status(202).json(await runOut(orgId, await S.loadRun(orgId, r.id)));
}));

app.post("/setup/runs/:id/undo", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const out = await S.undoAll(req.user.orgId, req.params.id, await callOf(req));
  if (!out.ok && out.reason === "not_found") return res.status(404).json({ error: "not_found" });
  if (!out.ok && out.reason) return res.status(409).json({ error: out.reason });
  res.json(out);
}));

app.put("/setup/invites/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "bad_email", sentence: "That does not look like an email address." });
  const role = ["admin", "staff", "volunteer_coordinator"].includes(req.body && req.body.role) ? req.body.role : null;
  const up = await query(`UPDATE setup_invites SET email=COALESCE(?, email), role=COALESCE(?, role) WHERE id=? AND org_id=? AND status='prepared' RETURNING id`,
    [email || null, role, req.params.id, orgId]);
  if (!up.length) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
}));

app.post("/setup/invites/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [i] = await query(`SELECT * FROM setup_invites WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!i) return res.status(404).json({ error: "not_found" });
  if (i.status !== "prepared") return res.status(409).json({ error: "already_sent" });
  if (!i.email) return res.status(400).json({ error: "no_email", sentence: `Add ${i.name}'s email first.` });
  // Claim it first, so two clicks send one invitation.
  const claimed = await query(`UPDATE setup_invites SET status='sending' WHERE id=? AND org_id=? AND status='prepared' RETURNING id`, [i.id, orgId]);
  if (!claimed.length) return res.status(409).json({ error: "already_sent" });
  const r = await require("../agentCall").call(await callOf(req), "POST", "/auth/invite", { email: i.email, role: i.role });
  if (r.status >= 400) {
    await run(`UPDATE setup_invites SET status='prepared' WHERE id=? AND org_id=?`, [i.id, orgId]);
    return res.status(r.status).json(r.body || { error: "invite_failed" });
  }
  const who = await whoOf(req);
  await run(`UPDATE setup_invites SET status='sent', invite_id=?, sent_at=NOW(), sent_by=?, sent_by_name=? WHERE id=? AND org_id=?`,
    [(r.body && r.body.id) || null, who.id, who.name, i.id, orgId]);
  res.json({ ok: true, emailSent: !!(r.body && r.body.emailSent) });
}));

// ── SUPER-ADMIN ────────────────────────────────────────────────────────────
// Jonathan prepares the plan for a customer on a call; the customer presses
// Start in her own session, so every write is hers.
app.post("/admin/orgs/:id/setup", requireAuth, requireSuperAdmin, express.json({ limit: "64mb" }), wrap(async (req, res) => {
  const [o] = await query(`SELECT id FROM orgs WHERE id=?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: "not_found" });
  const a = actor(req);
  const out = await createRun(o.id, { id: a.id, name: `${a.name || a.id} (Steward support)` }, req.body || {});
  res.status(out.status).json(out.body && out.body.id ? { id: out.body.id, status: out.body.status, plan: out.body.plan } : out.body);
}));

app.get("/admin/setup-times", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const rows = await query(`SELECT id, name, setup_started_at, setup_completed_at,
      ROUND(EXTRACT(EPOCH FROM (setup_completed_at - setup_started_at)) / 60.0, 1)::float AS minutes
      FROM orgs WHERE setup_started_at IS NOT NULL ORDER BY setup_started_at DESC LIMIT 200`);
  res.json({ orgs: rows.map(r => ({ orgId: r.id, name: r.name, startedAt: r.setup_started_at, completedAt: r.setup_completed_at, minutes: r.minutes })) });
}));
}

module.exports = { routers, mount };
