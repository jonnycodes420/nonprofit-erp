require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const Anthropic = require("@anthropic-ai/sdk");
const { getDb, query, run, uuid, seedOrgData } = require("./db");
const { signToken, requireAuth } = require("./auth");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// ── DB readiness guard ─────────────────────────────────────────────────────
let dbReady = false;
getDb()
  .then(() => { dbReady = true; console.log("✅ Database ready"); })
  .catch(err => { console.error("❌ Database init failed:", err); process.exit(1); });

app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: "Database initializing" });
  next();
});

// ── Async error wrapper ────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", db: dbReady });
});

// ── Auth ───────────────────────────────────────────────────────────────────
app.post("/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const users = await query("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  if (!users.length) return res.status(401).json({ error: "Invalid credentials" });

  const user = users[0];
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [user.org_id]);
  const org = orgs[0];
  const token = signToken({ userId: user.id, orgId: user.org_id, email: user.email, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 } });
}));

app.post("/auth/register", wrap(async (req, res) => {
  const { email, password, name, orgName, orgMission, ein } = req.body;
  if (!email || !password || !orgName) {
    return res.status(400).json({ error: "Email, password, and org name required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = await query("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  if (existing.length) return res.status(409).json({ error: "Email already registered" });

  const orgId = "org_" + uuid().slice(0, 8);
  const userId = "user_" + uuid().slice(0, 8);
  await run("INSERT INTO orgs (id, name, mission, ein, onboarding_complete) VALUES (?,?,?,?,0)",
    [orgId, orgName, orgMission || "", ein || ""]);
  const hash = bcrypt.hashSync(password, 12);
  await run("INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, orgId, email.toLowerCase(), hash, name || email, "admin"]);

  const token = signToken({ userId, orgId, email: email.toLowerCase(), role: "admin" });
  res.status(201).json({
    token,
    user: { id: userId, email, name: name || email, role: "admin" },
    org: { id: orgId, name: orgName, onboarding_complete: 0 },
  });
}));

// ── Me ─────────────────────────────────────────────────────────────────────
app.get("/me", requireAuth, wrap(async (req, res) => {
  const users = await query("SELECT id, email, name, role FROM users WHERE id = ?", [req.user.userId]);
  const orgs  = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!users.length || !orgs.length) return res.status(404).json({ error: "Not found" });
  res.json({ user: users[0], org: orgs[0] });
}));

// ── Onboarding ─────────────────────────────────────────────────────────────
app.post("/onboarding/complete", requireAuth, wrap(async (req, res) => {
  const { answers } = req.body;
  if (!answers) return res.status(400).json({ error: "answers required" });
  await seedOrgData(req.user.orgId, answers);
  await run("UPDATE orgs SET onboarding_complete = 1 WHERE id = ?", [req.user.orgId]);
  res.json({ success: true });
}));

// ── Org ────────────────────────────────────────────────────────────────────
app.get("/org", requireAuth, wrap(async (req, res) => {
  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  res.json(orgs[0]);
}));

// ── Donors ─────────────────────────────────────────────────────────────────
app.get("/donors", requireAuth, wrap(async (req, res) => {
  const donors = await query(
    "SELECT * FROM donors WHERE org_id = ? ORDER BY total_giving DESC",
    [req.user.orgId]
  );
  const result = await Promise.all(donors.map(async d => ({
    ...d,
    tags: JSON.parse(d.tags || "[]"),
    interactions: await query(
      "SELECT * FROM interactions WHERE donor_id = ? ORDER BY date DESC LIMIT 10",
      [d.id]
    ),
  })));
  res.json(result);
}));

app.get("/donors/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });

  const d = rows[0];
  d.tags = JSON.parse(d.tags || "[]");
  d.interactions = await query("SELECT * FROM interactions WHERE donor_id = ? ORDER BY date DESC", [d.id]);
  d.gifts = await query("SELECT * FROM gifts WHERE donor_id = ? ORDER BY date DESC", [d.id]);
  res.json(d);
}));

app.post("/donors", requireAuth, wrap(async (req, res) => {
  const { name, email, phone, status, stage, tags, notes, lastAmount } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "d_" + uuid().slice(0, 8);
  const today = new Date().toISOString().split("T")[0];
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, email || "", phone || "", status || "new", stage || "prospect",
     lastAmount || 0, lastAmount || 0, today, lastAmount ? 1 : 0,
     JSON.stringify(tags || []), notes || ""]
  );
  const rows = await query("SELECT * FROM donors WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.post("/donors/import", requireAuth, wrap(async (req, res) => {
  const { donors } = req.body;
  if (!Array.isArray(donors) || donors.length === 0)
    return res.status(400).json({ error: "donors array required" });

  let inserted = 0;
  for (const d of donors) {
    if (!d.name) continue;
    const id = "d_" + uuid().slice(0, 8);
    const today = new Date().toISOString().split("T")[0];
    await run(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.user.orgId, d.name, d.email || "", d.phone || "",
       d.status || "new", d.stage || "prospect",
       parseInt(d.total) || 0, parseInt(d.lastAmount) || 0,
       d.lastGift || today, parseInt(d.gifts) || (d.total ? 1 : 0),
       JSON.stringify(Array.isArray(d.tags) ? d.tags : []), d.notes || ""]
    );
    inserted++;
  }
  res.json({ inserted });
}));

app.put("/donors/:id", requireAuth, wrap(async (req, res) => {
  const { name, email, phone, status, stage, tags, notes } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const affected = await run(
    `UPDATE donors SET name=?,email=?,phone=?,status=?,stage=?,tags=?,notes=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, email || "", phone || "", status, stage || "cultivate", JSON.stringify(tags || []), notes || "",
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });

  const rows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  const d = rows[0];
  d.tags = JSON.parse(d.tags || "[]");
  res.json(d);
}));

app.patch("/donors/:id/stage", requireAuth, wrap(async (req, res) => {
  const { stage } = req.body;
  const valid = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
  if (!valid.includes(stage)) return res.status(400).json({ error: "Invalid stage" });

  const affected = await run(
    `UPDATE donors SET stage=?,updated_at=NOW() WHERE id=? AND org_id=?`,
    [stage, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  res.json({ success: true, stage });
}));

app.delete("/donors/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM donors WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Interactions ───────────────────────────────────────────────────────────
app.post("/donors/:id/interactions", requireAuth, wrap(async (req, res) => {
  const { type, note, date } = req.body;
  if (!type) return res.status(400).json({ error: "Interaction type required" });

  const donorExists = await query(
    "SELECT id FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  const id = "int_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type, note || "",
     date || new Date().toISOString().split("T")[0], req.user.userId]
  );
  const rows = await query("SELECT * FROM interactions WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

// ── Gifts ──────────────────────────────────────────────────────────────────
app.post("/donors/:id/gifts", requireAuth, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }

  const donorExists = await query(
    "SELECT id FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  const giftId = "g_" + uuid().slice(0, 8);
  const giftDate = date || new Date().toISOString().split("T")[0];
  const amt = Number(amount);

  await run(
    "INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes) VALUES (?,?,?,?,?,?,?,?)",
    [giftId, req.user.orgId, req.params.id, amt, giftDate, type || "cash", campaign || "", notes || ""]
  );
  await run(
    `UPDATE donors
     SET total_giving     = total_giving + ?,
         last_gift_amount = ?,
         last_gift_date   = ?,
         gift_count       = gift_count + 1,
         status           = CASE
           WHEN total_giving + ? > 20000 THEN 'major'
           WHEN total_giving + ? > 5000  THEN 'mid'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = ?`,
    [amt, amt, giftDate, amt, amt, req.params.id]
  );

  const giftRows  = await query("SELECT * FROM gifts  WHERE id = ?", [giftId]);
  const donorRows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0] });
}));

// ── Grants ─────────────────────────────────────────────────────────────────
app.get("/grants", requireAuth, wrap(async (req, res) => {
  const grants = await query(
    "SELECT * FROM grants WHERE org_id = ? ORDER BY deadline ASC",
    [req.user.orgId]
  );
  res.json(grants.map(g => ({ ...g, history: JSON.parse(g.history || "[]") })));
}));

app.post("/grants", requireAuth, wrap(async (req, res) => {
  const { funder, program, amount, status, deadline, reportDue, officer, notes } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  const id = "gr_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,report_due,officer,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, funder, program || "", amount || 0,
     status || "prospecting", deadline || "", reportDue || "", officer || "", notes || ""]
  );
  const rows = await query("SELECT * FROM grants WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/grants/:id", requireAuth, wrap(async (req, res) => {
  const { funder, program, amount, received, status, deadline, reportDue, officer, notes } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  const affected = await run(
    `UPDATE grants
     SET funder=?,program=?,amount=?,received=?,status=?,deadline=?,report_due=?,officer=?,notes=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [funder, program || "", amount || 0, received || 0, status, deadline || "",
     reportDue || "", officer || "", notes || "", req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Grant not found" });

  const rows = await query("SELECT * FROM grants WHERE id = ?", [req.params.id]);
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  res.json(g);
}));

app.delete("/grants/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Volunteers ─────────────────────────────────────────────────────────────
app.get("/volunteers", requireAuth, wrap(async (req, res) => {
  const vols = await query(
    "SELECT * FROM volunteers WHERE org_id = ? ORDER BY hours DESC",
    [req.user.orgId]
  );
  res.json(vols.map(v => ({ ...v, skills: JSON.parse(v.skills || "[]") })));
}));

app.post("/volunteers", requireAuth, wrap(async (req, res) => {
  const { name, email, hours, skills, employer, notes, convertPotential } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "v_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO volunteers (id,org_id,name,email,hours,skills,employer,notes,convert_potential,last_active) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, name, email || "", hours || 0,
     JSON.stringify(skills || []), employer || "", notes || "",
     convertPotential || "medium", new Date().toISOString().split("T")[0]]
  );
  const rows = await query("SELECT * FROM volunteers WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/volunteers/:id", requireAuth, wrap(async (req, res) => {
  const { name, email, hours, skills, employer, notes, convertPotential } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const affected = await run(
    "UPDATE volunteers SET name=?,email=?,hours=?,skills=?,employer=?,notes=?,convert_potential=? WHERE id=? AND org_id=?",
    [name, email || "", hours || 0, JSON.stringify(skills || []),
     employer || "", notes || "", convertPotential || "medium", req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Volunteer not found" });
  const rows = await query("SELECT * FROM volunteers WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

// ── Tasks ──────────────────────────────────────────────────────────────────
app.get("/tasks", requireAuth, wrap(async (req, res) => {
  const tasks = await query(
    `SELECT * FROM tasks WHERE org_id = ?
     ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due ASC`,
    [req.user.orgId]
  );
  res.json(tasks);
}));

app.post("/tasks", requireAuth, wrap(async (req, res) => {
  const { title, due, priority, type, donorId } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });

  const id = "t_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id) VALUES (?,?,?,?,?,?,0,?)",
    [id, req.user.orgId, title, due || "", priority || "medium", type || "donor", donorId || null]
  );
  const rows = await query("SELECT * FROM tasks WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/tasks/:id", requireAuth, wrap(async (req, res) => {
  const { title, due, priority, type, done } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });

  const affected = await run(
    "UPDATE tasks SET title=?,due=?,priority=?,type=?,done=? WHERE id=? AND org_id=?",
    [title, due || "", priority || "medium", type || "donor", done ? 1 : 0,
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Task not found" });
  const rows = await query("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/tasks/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM tasks WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Board ──────────────────────────────────────────────────────────────────
app.get("/board", requireAuth, wrap(async (req, res) => {
  const members = await query("SELECT * FROM board_members WHERE org_id = ?", [req.user.orgId]);
  res.json(members.map(m => ({ ...m, committees: JSON.parse(m.committees || "[]") })));
}));

app.post("/board", requireAuth, wrap(async (req, res) => {
  const { name, role, employer, term, givingLevel, committees, attendance } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "b_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO board_members (id,org_id,name,role,employer,term,giving_level,committees,attendance) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, name, role || "Member", employer || "", term || "",
     givingLevel || "$0", JSON.stringify(committees || []), attendance ?? 100]
  );
  const rows = await query("SELECT * FROM board_members WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

// ── Financials ─────────────────────────────────────────────────────────────
app.get("/financials", requireAuth, wrap(async (req, res) => {
  const months = await query(
    `SELECT * FROM financials WHERE org_id = ?
     ORDER BY year,
       CASE month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                  WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                  WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                  WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 ELSE 12 END`,
    [req.user.orgId]
  );
  const funds = await query("SELECT * FROM funds WHERE org_id = ?", [req.user.orgId]);

  const ytdRevenue  = months.reduce((s, m) => s + m.individual + m.grants + m.events + m.other_revenue, 0);
  const ytdExpenses = months.reduce((s, m) => s + m.programs + m.admin + m.fundraising, 0);
  const programsTotal = months.reduce((s, m) => s + m.programs, 0);

  res.json({
    months,
    funds,
    summary: {
      ytdRevenue,
      ytdExpenses,
      netIncome: ytdRevenue - ytdExpenses,
      programRatio: ytdExpenses > 0 ? Math.round(programsTotal / ytdExpenses * 100) : 0,
    },
  });
}));

app.post("/financials/month", requireAuth, wrap(async (req, res) => {
  const { month, year, individual, grants, events, otherRevenue, programs, admin, fundraising } = req.body;
  if (!month || !year) return res.status(400).json({ error: "Month and year required" });

  const id = "fin_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO financials (id,org_id,month,year,individual,grants,events,other_revenue,programs,admin,fundraising)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, month, year) DO UPDATE SET
       individual=EXCLUDED.individual, grants=EXCLUDED.grants, events=EXCLUDED.events,
       other_revenue=EXCLUDED.other_revenue, programs=EXCLUDED.programs,
       admin=EXCLUDED.admin, fundraising=EXCLUDED.fundraising`,
    [id, req.user.orgId, month, year,
     individual || 0, grants || 0, events || 0, otherRevenue || 0,
     programs || 0, admin || 0, fundraising || 0]
  );
  res.status(201).json({ success: true });
}));

// ── Analytics ──────────────────────────────────────────────────────────────
app.get("/analytics", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const donors     = await query("SELECT * FROM donors     WHERE org_id = ?", [orgId]);
  const grants     = await query("SELECT * FROM grants     WHERE org_id = ?", [orgId]);
  const tasks      = await query("SELECT * FROM tasks      WHERE org_id = ?", [orgId]);
  const financials = await query("SELECT * FROM financials WHERE org_id = ?", [orgId]);

  const totalRaised   = donors.reduce((s, d) => s + d.total_giving, 0);
  const avgGift       = donors.length
    ? Math.round(donors.reduce((s, d) => s + d.last_gift_amount, 0) / donors.length)
    : 0;
  const retentionRate = donors.length
    ? Math.round(donors.filter(d => d.status !== "lapsed").length / donors.length * 100)
    : 0;

  const submittedGrants  = grants.filter(g => g.status !== "prospecting");
  const wonGrants        = grants.filter(g => ["active", "closed"].includes(g.status));
  const grantSuccessRate = submittedGrants.length
    ? Math.round(wonGrants.length / submittedGrants.length * 100)
    : 0;

  const ytdRevenue  = financials.reduce((s, m) => s + m.individual + m.grants + m.events + m.other_revenue, 0);
  const ytdExpenses = financials.reduce((s, m) => s + m.programs + m.admin + m.fundraising, 0);

  res.json({
    totalRaised, avgGift, retentionRate, grantSuccessRate, ytdRevenue, ytdExpenses,
    donorCount:       donors.length,
    lapsedCount:      donors.filter(d => d.status === "lapsed").length,
    majorDonorCount:  donors.filter(d => d.status === "major").length,
    activeGrantValue: grants.filter(g => g.status === "active").reduce((s, g) => s + g.amount, 0),
    pipelineValue:    grants.filter(g => ["pending", "prospecting"].includes(g.status)).reduce((s, g) => s + g.amount, 0),
    openTasks:        tasks.filter(t => !t.done).length,
    urgentTasks:      tasks.filter(t => !t.done && t.priority === "high").length,
  });
}));

// ── Dashboard ──────────────────────────────────────────────────────────────
app.get("/dashboard", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const urgentTasks = await query(
    "SELECT * FROM tasks WHERE org_id=? AND done=0 AND priority='high' ORDER BY due ASC LIMIT 5",
    [orgId]
  );
  const upcomingDeadlines = await query(
    "SELECT * FROM grants WHERE org_id=? AND status!='closed' ORDER BY deadline ASC LIMIT 5",
    [orgId]
  );
  const recentInteractions = await query(
    `SELECT i.*, d.name as donor_name FROM interactions i
     JOIN donors d ON d.id = i.donor_id
     WHERE i.org_id=? ORDER BY i.date DESC LIMIT 10`,
    [orgId]
  );
  const lapsedDonors = await query(
    "SELECT * FROM donors WHERE org_id=? AND status='lapsed' ORDER BY last_gift_date ASC LIMIT 5",
    [orgId]
  );
  res.json({ urgentTasks, upcomingDeadlines, recentInteractions, lapsedDonors });
}));

// ── AI — streaming chat ────────────────────────────────────────────────────
app.post("/ai/stream", requireAuth, wrap(async (req, res) => {
  const { systemPrompt, userMessage } = req.body;
  if (!userMessage) return res.status(400).json({ error: "Message required" });

  await run(
    "INSERT INTO ai_log (id,org_id,user_id,type,prompt_summary) VALUES (?,?,?,?,?)",
    ["log_" + uuid().slice(0, 8), req.user.orgId, req.user.userId, "stream", userMessage.slice(0, 100)]
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt || "You are a helpful nonprofit development assistant.",
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}));

// ── AI — donor propensity scoring ──────────────────────────────────────────
app.get("/ai/donor-score", requireAuth, wrap(async (req, res) => {
  const donors = await query("SELECT * FROM donors WHERE org_id = ?", [req.user.orgId]);
  const scored = donors.map(d => {
    let score = 0;

    if      (d.total_giving > 20000) score += 35;
    else if (d.total_giving > 5000)  score += 22;
    else if (d.total_giving > 1000)  score += 12;
    else                             score += 5;

    const days = Math.floor((Date.now() - new Date(d.last_gift_date)) / 86_400_000);
    if      (days < 90)  score += 30;
    else if (days < 180) score += 22;
    else if (days < 365) score += 12;

    score += Math.min(d.gift_count * 4, 20);

    if (d.status === "lapsed") score -= 15;

    const tags = JSON.parse(d.tags || "[]");
    if (tags.includes("board-adjacent")) score += 10;
    if (tags.includes("recurring"))      score += 5;

    return { id: d.id, name: d.name, score: Math.max(5, Math.min(score, 99)), status: d.status };
  });
  res.json(scored.sort((a, b) => b.score - a.score));
}));

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`🚀 Steward backend running on port ${PORT}`);
  console.log(`   Demo login: admin@creoarts.org / demo1234`);
});

module.exports = app;
