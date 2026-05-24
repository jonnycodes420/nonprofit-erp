require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const Anthropic = require("@anthropic-ai/sdk");
const nodemailer = require("nodemailer");
const { getDb, query, run, uuid, seedOrgData } = require("./db");
const { signToken, requireAuth } = require("./auth");
const Stripe = require("stripe");

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// Stripe webhook must receive raw body — register BEFORE express.json()
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const email = pi.receipt_email || pi.metadata?.donor_email;
      const amount = pi.amount_received / 100;
      const accountId = event.account;

      if (email && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.rows.length) {
          const orgId = orgRow.rows[0].id;
          const donorRow = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
          if (donorRow.rows.length) {
            const donorId = donorRow.rows[0].id;
            const giftId = "g_" + uuid().slice(0, 8);
            const today = new Date().toISOString().slice(0, 10);
            await run(
              `INSERT INTO gifts (id, org_id, donor_id, amount, date, notes, stripe_payment_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [giftId, orgId, donorId, amount, today, "Online payment via Stripe", pi.id]
            );
            await run(
              `UPDATE donors SET
                 total = total + $1,
                 gifts = gifts + 1,
                 last_gift = GREATEST(last_gift::date, $2::date)::text,
                 last_amount = CASE WHEN ($2::date >= COALESCE(last_gift,'0001-01-01')::date) THEN $3 ELSE last_amount END
               WHERE id = $4`,
              [amount, today, amount, donorId]
            );
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at)
               VALUES ($1,$2,$3,$4,$5,NOW())`,
              [taskId, orgId, `Thank ${email} for online gift of $${amount}`, "high", false]
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  res.json({ received: true });
});

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

// ── Admin guard ────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
};

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.1.0", db: dbReady });
});

// ── Wealth Score ────────────────────────────────────────────────────────────
async function calcWealthScore(donorId, orgId) {
  try {
    const [donorRows, gifts, interactions] = await Promise.all([
      query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]),
      query("SELECT amount FROM gifts WHERE donor_id = ? ORDER BY date DESC", [donorId]),
      query("SELECT type, note FROM interactions WHERE donor_id = ? ORDER BY date DESC", [donorId]),
    ]);
    if (!donorRows.length) return null;
    const d = donorRows[0];

    let score = 0;
    const total = d.total_giving || 0;

    // Lifetime giving (0–3 pts)
    if      (total >= 100000) score += 3;
    else if (total >= 50000)  score += 2.75;
    else if (total >= 25000)  score += 2.5;
    else if (total >= 10000)  score += 2;
    else if (total >= 5000)   score += 1.5;
    else if (total >= 1000)   score += 1;
    else if (total >= 500)    score += 0.5;

    // Largest single gift (0–2 pts)
    const maxGift = gifts.length ? Math.max(...gifts.map(g => g.amount)) : 0;
    if      (maxGift >= 10000) score += 2;
    else if (maxGift >= 5000)  score += 1.5;
    else if (maxGift >= 1000)  score += 1;
    else if (maxGift >= 500)   score += 0.5;
    else if (maxGift >= 100)   score += 0.25;

    // Gift frequency (0–2 pts)
    const gc = d.gift_count || 0;
    if      (gc >= 7) score += 2;
    else if (gc >= 4) score += 1.5;
    else if (gc >= 2) score += 1;
    else if (gc >= 1) score += 0.5;
    // Recency penalty
    if (d.last_gift_date) {
      const daysSince = Math.floor((Date.now() - new Date(d.last_gift_date)) / 86400000);
      if (daysSince > 730) score -= 0.5;
    }

    // Average gift size (0–1 pt)
    const avgGift = gc > 0 ? total / gc : 0;
    if      (avgGift >= 2500) score += 1;
    else if (avgGift >= 1000) score += 0.75;
    else if (avgGift >= 500)  score += 0.5;
    else if (avgGift >= 100)  score += 0.25;

    // Behavioral signals (0–2 pts)
    score += Math.min(interactions.length * 0.1, 0.8);
    const calls = interactions.filter(i => i.type === "call");
    const answered = calls.filter(i => (i.note || "").toLowerCase().includes("answered: yes"));
    if (calls.length > 0 && answered.length / calls.length > 0.5) score += 0.5;
    const eventsAttended = interactions.filter(i => i.type === "event" && (i.note || "").toLowerCase().includes("donor attended: yes"));
    score += Math.min(eventsAttended.length * 0.15, 0.3);
    const stageBonus = { steward: 0.4, major: 0.3, pledge: 0.2, cultivate: 0.1, prospect: 0, lapsed: -0.3 };
    score += stageBonus[d.stage] || 0;

    const finalScore = Math.round(Math.min(10, Math.max(1, score)));
    const capacityTier = finalScore <= 3 ? "Micro" : finalScore <= 5 ? "Small" : finalScore <= 7 ? "Mid" : finalScore <= 9 ? "Major" : "Principal";
    const dataPoints = gc + interactions.length;
    const confidence = dataPoints >= 6 ? "High" : dataPoints >= 3 ? "Medium" : "Low";

    // Claude rationale (2 sentences, non-blocking on failure)
    const avgGiftAmt = gc > 0 ? Math.round(total / gc) : 0;
    let rationale = `${d.name} scored ${finalScore}/10 based on ${gc} gift${gc !== 1 ? "s" : ""} totaling $${total.toLocaleString()} and ${interactions.length} recorded touchpoints.`;
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 130,
        messages: [{
          role: "user",
          content: `Write exactly 2 sentences: first explain why this donor scored ${finalScore}/10 (${capacityTier} tier, ${confidence} confidence) referencing their specific numbers; second, name one concrete action that would raise their score. No labels, no headers.

Data: ${d.name} | Total giving: $${total.toLocaleString()} | ${gc} gifts avg $${avgGiftAmt.toLocaleString()} | Largest gift: $${maxGift.toLocaleString()} | Last gift: ${d.last_gift_date || "none"} | Stage: ${d.stage} | Touchpoints: ${interactions.length}`,
        }],
      });
      rationale = msg.content[0].text;
    } catch(e) {
      console.error("Score rationale:", e.message);
    }

    await run(
      "UPDATE donors SET wealth_score=?,capacity_tier=?,score_confidence=?,score_last_updated=NOW(),score_rationale=? WHERE id=?",
      [finalScore, capacityTier, confidence, rationale, donorId]
    );
    return { wealthScore: finalScore, capacityTier, scoreConfidence: confidence, scoreRationale: rationale };
  } catch(e) {
    console.error("calcWealthScore:", e.message);
    return null;
  }
}

// ── Finance audit log helper ───────────────────────────────────────────────
async function writeAuditLog(orgId, userId, userName, action, entityType, entityId, changes) {
  try {
    const id = "al_" + uuid().slice(0, 8);
    await run(
      "INSERT INTO fin_audit_log (id,org_id,user_id,user_name,action,entity_type,entity_id,changes) VALUES (?,?,?,?,?,?,?,?)",
      [id, orgId, userId, userName, action, entityType, entityId, JSON.stringify(changes || {})]
    );
  } catch(e) { console.error("Audit log write:", e.message); }
}

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

// ── Team ───────────────────────────────────────────────────────────────────
app.get("/org/team", requireAuth, wrap(async (req, res) => {
  const members = await query(
    "SELECT id, email, name, role, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC",
    [req.user.orgId]
  );
  res.json(members);
}));

// ── Invite ─────────────────────────────────────────────────────────────────
app.post("/auth/invite", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const validRole = role === "admin" ? "admin" : "staff";

  const existing = await query("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  if (existing.length) return res.status(409).json({ error: "A user with that email already exists" });

  const token = uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
  const id = "inv_" + uuid().slice(0, 8);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await run(
    `INSERT INTO invites (id, org_id, email, token, role, invited_by, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.user.orgId, email.toLowerCase(), token, validRole, req.user.userId, expiresAt]
  );

  const FRONTEND_URL = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
  const inviteLink = `${FRONTEND_URL}/invite/${token}`;

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];

  // Attempt to send via org SMTP if configured
  let emailSent = false;
  if (org.smtp_host && org.smtp_user && org.smtp_pass) {
    try {
      const transporter = nodemailer.createTransport({
        host: org.smtp_host,
        port: org.smtp_port || 587,
        secure: (org.smtp_port || 587) === 465,
        auth: { user: org.smtp_user, pass: org.smtp_pass },
      });
      await transporter.sendMail({
        from: org.smtp_from || org.smtp_user,
        to: email,
        subject: `You've been invited to join ${org.name} on Steward`,
        html: `<p>You've been invited to join <strong>${org.name}</strong> on Steward as a <strong>${validRole}</strong>.</p>
               <p><a href="${inviteLink}" style="background:#10b981;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Accept Invitation</a></p>
               <p>This link expires in 7 days.</p>`,
        text: `You've been invited to join ${org.name} on Steward as a ${validRole}.\n\nAccept your invitation: ${inviteLink}\n\nThis link expires in 7 days.`,
      });
      emailSent = true;
    } catch (err) {
      console.error("Invite email send failed:", err.message);
    }
  }

  res.json({ success: true, inviteLink, emailSent });
}));

app.get("/auth/invite/:token", wrap(async (req, res) => {
  const rows = await query(
    `SELECT i.*, o.name as org_name FROM invites i
     JOIN orgs o ON o.id = i.org_id
     WHERE i.token = ?`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: "Invite not found or already used" });
  const invite = rows[0];
  if (invite.accepted_at) return res.status(410).json({ error: "This invite has already been accepted" });
  if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: "This invite has expired" });
  res.json({ email: invite.email, orgName: invite.org_name, role: invite.role });
}));

app.post("/auth/invite/accept", wrap(async (req, res) => {
  const { token, name, password } = req.body;
  if (!token || !name || !password) return res.status(400).json({ error: "token, name, and password required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const rows = await query(
    `SELECT i.*, o.onboarding_complete FROM invites i
     JOIN orgs o ON o.id = i.org_id
     WHERE i.token = ?`,
    [token]
  );
  if (!rows.length) return res.status(404).json({ error: "Invite not found" });
  const invite = rows[0];
  if (invite.accepted_at) return res.status(410).json({ error: "This invite has already been accepted" });
  if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: "This invite has expired" });

  const existing = await query("SELECT id FROM users WHERE email = ?", [invite.email]);
  if (existing.length) return res.status(409).json({ error: "An account with this email already exists" });

  const userId = "user_" + uuid().slice(0, 8);
  const hash = bcrypt.hashSync(password, 12);
  await run(
    "INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, invite.org_id, invite.email, hash, name, invite.role]
  );
  await run("UPDATE invites SET accepted_at = NOW() WHERE id = ?", [invite.id]);

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [invite.org_id]);
  const org = orgs[0];
  const jwtToken = signToken({ userId, orgId: invite.org_id, email: invite.email, role: invite.role });
  res.status(201).json({
    token: jwtToken,
    user: { id: userId, email: invite.email, name, role: invite.role },
    org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 },
  });
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
       parseInt(d.total) || 0,
       (/^\d{4}[-/]\d{2}/.test(String(d.lastAmount||"")) ? 0 : parseInt(d.lastAmount)||0),
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
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.json({ success: true, stage });
}));

app.delete("/donors/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
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
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
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
  // Auto-sync gift to Finance ledger
  try {
    const [contribAcct, genFund] = await Promise.all([
      query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [req.user.orgId]),
      query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [req.user.orgId]),
    ]);
    if (contribAcct.length) {
      await run(
        "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id) VALUES (?,?,?,?,?,?,?,?,?)",
        ["ft_"+uuid().slice(0,8), req.user.orgId, giftDate,
         `Gift from ${donorRows[0]?.name || "Donor"}`, donorRows[0]?.name || "",
         amt, "income", contribAcct[0].id, genFund.length ? genFund[0].id : null]
      );
    }
  } catch(e) { console.error("Finance sync:", e.message); }
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0] });
}));

app.post("/donors/:id/score", requireAuth, wrap(async (req, res) => {
  const result = await calcWealthScore(req.params.id, req.user.orgId);
  if (!result) return res.status(404).json({ error: "Donor not found" });
  res.json(result);
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
  const { funder, program, amount, received, status, deadline, reportDue, officer, notes, description, requirements } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  const affected = await run(
    `UPDATE grants
     SET funder=?,program=?,amount=?,received=?,status=?,deadline=?,report_due=?,officer=?,notes=?,description=?,requirements=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [funder, program || "", amount || 0, received || 0, status, deadline || "",
     reportDue || "", officer || "", notes || "", description || "", requirements || "",
     req.params.id, req.user.orgId]
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

app.get("/grants/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  const ints = await query(
    "SELECT * FROM grant_interactions WHERE grant_id = ? ORDER BY date DESC, created_at DESC",
    [req.params.id]
  );
  g.interactions = ints;
  res.json(g);
}));

app.post("/grants/:id/interactions", requireAuth, wrap(async (req, res) => {
  const { type, note, date } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: "Note required" });
  const rows = await query("SELECT id FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Grant not found" });
  const id = "gi_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO grant_interactions (id, org_id, grant_id, type, note, date) VALUES (?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type || "note", note.trim(), date || new Date().toISOString().slice(0, 10)]
  );
  res.status(201).json({ id, type: type || "note", note: note.trim(), date: date || new Date().toISOString().slice(0, 10) });
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

app.post("/financials/month", requireAuth, requireAdmin, wrap(async (req, res) => {
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

// ── AI — CSV column mapping ────────────────────────────────────────────────
app.post("/ai/column-map", requireAuth, wrap(async (req, res) => {
  const { headers, sample } = req.body;
  if (!headers?.length) return res.status(400).json({ error: "headers required" });

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: "You are a data mapping assistant for nonprofit CRM systems. Return only valid JSON, no explanation or markdown.",
    messages: [{
      role: "user",
      content: `Map these CSV column headers to donor fields. Available target fields: name, email, phone, total, lastAmount, lastGift, gifts, status, notes. Use empty string to skip a column.

Headers: ${JSON.stringify(headers)}
Sample row values: ${JSON.stringify(sample || {})}

Return ONLY a JSON object like: {"Original Header": "fieldName", "Another Header": ""}`,
    }],
  });

  try {
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json");
    res.json({ mapping: JSON.parse(jsonMatch[0]) });
  } catch {
    res.json({ mapping: {} });
  }
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

// ── SMTP settings ──────────────────────────────────────────────────────────
app.put("/org/smtp", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = req.body;
  await run(
    `UPDATE orgs SET smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=? WHERE id=?`,
    [smtpHost || null, smtpPort || 587, smtpUser || null, smtpPass || null, smtpFrom || null, req.user.orgId]
  );
  res.json({ success: true });
}));

// ── SMTP test endpoint ─────────────────────────────────────────────────────
app.get("/email/test-smtp", requireAuth, requireAdmin, wrap(async (req, res) => {
  const smtpHost = process.env.DEMO_SMTP_HOST;
  const smtpUser = process.env.DEMO_SMTP_USER;
  const smtpPass = process.env.DEMO_SMTP_PASS;
  const smtpPort = parseInt(process.env.DEMO_SMTP_PORT || "587");
  const to = process.env.DEMO_NOTIFY_EMAIL || smtpUser;

  const cfg = {
    host: smtpHost || "MISSING",
    port: smtpPort,
    user: smtpUser || "MISSING",
    pass: smtpPass ? "set" : "MISSING",
    secure: smtpPort === 465,
    to: to || "MISSING",
  };

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.error("[test-smtp] env vars missing:", cfg);
    return res.json({ success: false, error: "DEMO_SMTP_* env vars not fully configured", config: cfg });
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost, port: smtpPort,
    secure: smtpPort === 465,
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    console.log("[test-smtp] verifying connection…", cfg);
    await transporter.verify();
    console.log("[test-smtp] connection OK, sending test email to", to);
    const info = await transporter.sendMail({
      from: smtpUser,
      to,
      subject: "Steward SMTP test",
      text: "SMTP is working. This is a test from your Steward ERP.",
      html: "<p>SMTP is working. This is a test from your <strong>Steward ERP</strong>.</p>",
    });
    console.log("[test-smtp] sent OK — messageId:", info.messageId);
    res.json({ success: true, messageId: info.messageId, from: smtpUser, to, config: cfg });
  } catch (err) {
    const detail = {
      message:      err.message,
      code:         err.code         || null,
      responseCode: err.responseCode || null,
      response:     err.response     || null,
      command:      err.command      || null,
    };
    console.error("[test-smtp] FAILED:", detail);
    res.json({ success: false, error: detail, config: cfg });
  }
}));

// ── Campaigns ──────────────────────────────────────────────────────────────
app.get("/campaigns", requireAuth, wrap(async (req, res) => {
  const campaigns = await query(
    "SELECT * FROM campaigns WHERE org_id = ? ORDER BY created_at DESC",
    [req.user.orgId]
  );
  const result = await Promise.all(campaigns.map(async c => {
    const recipients = await query(
      `SELECT cr.id, cr.email, cr.sent_at, cr.opened_at, cr.failure_reason, d.name as donor_name
       FROM campaign_recipients cr
       LEFT JOIN donors d ON d.id = cr.donor_id
       WHERE cr.campaign_id = ? ORDER BY cr.created_at DESC`,
      [c.id]
    );
    return { ...c, recipients };
  }));
  res.json(result);
}));

app.get("/campaigns/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const recipients = await query(
    `SELECT cr.id, cr.email, cr.sent_at, cr.opened_at, cr.failure_reason, d.name as donor_name
     FROM campaign_recipients cr
     LEFT JOIN donors d ON d.id = cr.donor_id
     WHERE cr.campaign_id = ? ORDER BY cr.created_at DESC`,
    [rows[0].id]
  );
  res.json({ ...rows[0], recipients });
}));

app.post("/campaigns", requireAuth, wrap(async (req, res) => {
  const { name, type, subject, body, segment, scheduledAt } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "cmp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,scheduled_at,recipient_count,open_count)
     VALUES (?,?,?,?,?,?,?,?,?,0,0)`,
    [id, req.user.orgId, name, type || "appeal", subject || "", body || "",
     scheduledAt ? "scheduled" : "draft", JSON.stringify(segment || {}), scheduledAt || null]
  );
  const rows = await query("SELECT * FROM campaigns WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/campaigns/:id", requireAuth, wrap(async (req, res) => {
  const { name, type, subject, body, segment, status, scheduledAt } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const existing = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  if (!["draft", "scheduled"].includes(existing[0].status))
    return res.status(400).json({ error: "Only draft or scheduled campaigns can be edited" });

  await run(
    `UPDATE campaigns SET name=?,type=?,subject=?,body=?,segment=?,status=?,scheduled_at=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, type || "appeal", subject || "", body || "",
     JSON.stringify(segment || {}), status || "draft",
     scheduledAt || null,
     req.params.id, req.user.orgId]
  );
  const rows = await query("SELECT * FROM campaigns WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/campaigns/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM campaigns WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

app.post("/campaigns/:id/send", requireAuth, requireAdmin, wrap(async (req, res) => {
  const BACKEND_URL = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";

  const campaigns = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });
  const campaign = campaigns[0];
  if (campaign.status === "sent") return res.status(400).json({ error: "Campaign already sent" });

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];

  const segment = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});

  let donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != ''",
    [req.user.orgId]
  );

  const mode = segment.mode || "legacy";
  if (mode === "major") {
    donors = donors.filter(d => Number(d.total_giving) >= 10000);
  } else if (mode === "lapsed") {
    donors = donors.filter(d => d.stage === "lapsed");
  } else if (mode === "byStage") {
    if (segment.stages && segment.stages.length) donors = donors.filter(d => segment.stages.includes(d.stage));
  } else if (mode === "byTier") {
    if (segment.tiers && segment.tiers.length) donors = donors.filter(d => segment.tiers.includes(d.capacity_tier));
  } else if (mode === "manual") {
    if (segment.donorIds && segment.donorIds.length) donors = donors.filter(d => segment.donorIds.includes(d.id));
  } else {
    // "all" or legacy format
    if (segment.stages && segment.stages.length) donors = donors.filter(d => segment.stages.includes(d.stage));
    if (segment.statuses && segment.statuses.length) donors = donors.filter(d => segment.statuses.includes(d.status));
  }

  // Mark as sending and respond immediately (non-blocking)
  await run("UPDATE campaigns SET status='sending', updated_at=NOW() WHERE id=?", [campaign.id]);
  res.json({ queued: true, recipientCount: donors.length });

  setImmediate(async () => {
    console.log(`[campaign:${campaign.id}] background send starting — ${donors.length} recipients`);
    let sentCount = 0;
    let failCount = 0;

    try {
      const smtpHost = process.env.DEMO_SMTP_HOST;
      const smtpUser = process.env.DEMO_SMTP_USER;
      const smtpPass = process.env.DEMO_SMTP_PASS;
      const smtpPort = parseInt(process.env.DEMO_SMTP_PORT || "587");
      // Use smtpUser as from exactly — Gmail rejects mismatched from addresses
      const smtpFrom = smtpUser;

      let transporter = null;
      if (smtpHost && smtpUser && smtpPass) {
        transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort,
          secure: smtpPort === 465,
          connectionTimeout: 10000,
          greetingTimeout:   10000,
          socketTimeout:     15000,
          auth: { user: smtpUser, pass: smtpPass },
        });
        console.log(`[campaign:${campaign.id}] SMTP host=${smtpHost} port=${smtpPort} user=${smtpUser} from=${smtpFrom} secure=${smtpPort === 465}`);
      } else {
        console.log(`[campaign:${campaign.id}] DEMO_SMTP_* not set (HOST=${smtpHost||"?"} USER=${smtpUser||"?"} PASS=${smtpPass?"set":"MISSING"}) — logging only`);
      }

      const year = String(new Date().getFullYear());

      for (const donor of donors) {
        const recipientId = "cr_" + uuid().slice(0, 8);
        await run(
          "INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email) VALUES (?,?,?,?,?)",
          [recipientId, org.id, campaign.id, donor.id, donor.email]
        );

        const firstName   = donor.name.split(" ")[0];
        const lastName    = donor.name.split(" ").slice(1).join(" ");
        const totalGiving = donor.total_giving ? `$${Number(donor.total_giving).toLocaleString()}` : "$0";
        const giftRows    = await query("SELECT amount FROM gifts WHERE donor_id=? ORDER BY date DESC LIMIT 1", [donor.id]);
        const giftAmount  = giftRows[0] ? `$${Number(giftRows[0].amount).toLocaleString()}` : "your previous gift";

        const bodyHtml = (campaign.body || "")
          .replace(/{{first_name}}/g,   firstName)
          .replace(/{{last_name}}/g,    lastName)
          .replace(/{{donor_name}}/g,   donor.name)
          .replace(/{{org_name}}/g,     org.name)
          .replace(/{{gift_amount}}/g,  giftAmount)
          .replace(/{{total_giving}}/g, totalGiving)
          .replace(/{{year}}/g,         year);

        const pixel    = `<img src="${BACKEND_URL}/track/${recipientId}/open.gif" width="1" height="1" style="display:none">`;
        const htmlFull = bodyHtml + pixel;
        const textBody = bodyHtml.replace(/<[^>]+>/g, "");

        try {
          if (transporter) {
            await transporter.sendMail({
              from: smtpFrom, to: donor.email,
              subject: campaign.subject || "",
              html: htmlFull, text: textBody,
            });
          }
          await run("UPDATE campaign_recipients SET sent_at=NOW() WHERE id=?", [recipientId]);
          sentCount++;
        } catch (err) {
          failCount++;
          const reason = [
            err.message,
            err.code        ? `code=${err.code}`               : "",
            err.responseCode ? `smtp=${err.responseCode}`      : "",
            err.response    ? `response="${err.response}"`     : "",
            err.command     ? `cmd=${err.command}`             : "",
          ].filter(Boolean).join(" | ").slice(0, 500);
          console.error(`[campaign:${campaign.id}] SEND FAILED ${donor.email}: ${reason}`);
          await run(
            "UPDATE campaign_recipients SET failure_reason=? WHERE id=?",
            [reason, recipientId]
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[campaign:${campaign.id}] FATAL send error: msg="${err.message}" code=${err.code||"?"} smtp=${err.responseCode||"?"} response="${err.response||""}" stack=${err.stack?.split("\n").slice(0,2).join(" | ")}`);
    }

    // Always finalize — even if some or all emails failed
    await run(
      "UPDATE campaigns SET status='sent', sent_at=NOW(), recipient_count=?, updated_at=NOW() WHERE id=?",
      [sentCount, campaign.id]
    ).catch(e => console.error(`[campaign:${campaign.id}] final status update failed:`, e.message));

    console.log(`[campaign:${campaign.id}] done — sent:${sentCount} failed:${failCount}`);
  });
}));

// ── Tracking pixel (no auth) ───────────────────────────────────────────────
app.get("/track/:recipientId/open.gif", wrap(async (req, res) => {
  const { recipientId } = req.params;
  await run(
    "UPDATE campaign_recipients SET opened_at = NOW() WHERE id = ? AND opened_at IS NULL",
    [recipientId]
  );
  await run(
    `UPDATE campaigns SET open_count = open_count + 1
     WHERE id = (SELECT campaign_id FROM campaign_recipients WHERE id = ?)`,
    [recipientId]
  );
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.end(gif);
}));

// ── Programs ───────────────────────────────────────────────────────────────
app.get("/programs", requireAuth, wrap(async (req, res) => {
  const programs = await query(
    "SELECT * FROM programs WHERE org_id = ? ORDER BY created_at DESC",
    [req.user.orgId]
  );
  const result = await Promise.all(programs.map(async p => {
    const grants = await query(
      `SELECT pg.grant_id as "grantId", g.funder, g.program, pg.allocated
       FROM program_grants pg
       JOIN grants g ON g.id = pg.grant_id
       WHERE pg.program_id = ?`,
      [p.id]
    );
    return { ...p, grants };
  }));
  res.json(result);
}));

app.post("/programs", requireAuth, wrap(async (req, res) => {
  const { name, description, budget, spent, staff, participantCount, startDate, endDate, status, outcomes, metrics } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "prg_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO programs (id,org_id,name,description,budget,spent,staff,participant_count,start_date,end_date,status,outcomes,metrics)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, description || "", budget || 0, spent || 0,
     JSON.stringify(staff || []), participantCount || 0,
     startDate || null, endDate || null, status || "active",
     outcomes || "", JSON.stringify(metrics || {})]
  );
  const rows = await query("SELECT * FROM programs WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/programs/:id", requireAuth, wrap(async (req, res) => {
  const { name, description, budget, spent, staff, participantCount, startDate, endDate, status, outcomes, metrics } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const affected = await run(
    `UPDATE programs
     SET name=?,description=?,budget=?,spent=?,staff=?,participant_count=?,
         start_date=?,end_date=?,status=?,outcomes=?,metrics=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, description || "", budget || 0, spent || 0,
     JSON.stringify(staff || []), participantCount || 0,
     startDate || null, endDate || null, status || "active",
     outcomes || "", JSON.stringify(metrics || {}),
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Program not found" });
  const rows = await query("SELECT * FROM programs WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/programs/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM programs WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

app.post("/programs/:id/grants", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { grantId, allocated } = req.body;
  if (!grantId) return res.status(400).json({ error: "grantId required" });

  const programExists = await query(
    "SELECT id FROM programs WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!programExists.length) return res.status(404).json({ error: "Program not found" });

  const id = "pg_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO program_grants (id,org_id,program_id,grant_id,allocated)
     VALUES (?,?,?,?,?)
     ON CONFLICT (program_id, grant_id) DO UPDATE SET allocated=EXCLUDED.allocated`,
    [id, req.user.orgId, req.params.id, grantId, allocated || 0]
  );
  res.json({ success: true });
}));

app.delete("/programs/:id/grants/:grantId", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run(
    "DELETE FROM program_grants WHERE program_id = ? AND grant_id = ?",
    [req.params.id, req.params.grantId]
  );
  res.json({ success: true });
}));

// ── Annual Fund ────────────────────────────────────────────────────────────
app.get("/annual-fund", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const prevYear = year - 1;

  const goalRows = await query(
    "SELECT goal FROM annual_fund_goals WHERE org_id = ? AND year = ?",
    [orgId, year]
  );
  const goal = goalRows.length ? goalRows[0].goal : 0;

  const allGifts = await query(
    "SELECT * FROM gifts WHERE org_id = ?",
    [orgId]
  );

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const thisYearGifts = allGifts.filter(g => {
    const d = new Date(g.date);
    return d.getFullYear() === year;
  });

  const prevYearGifts = allGifts.filter(g => {
    const d = new Date(g.date);
    return d.getFullYear() === prevYear;
  });

  const totalRaised = thisYearGifts.reduce((s, g) => s + g.amount, 0);
  const giftCount   = thisYearGifts.length;
  const avgGift     = giftCount > 0 ? Math.round(totalRaised / giftCount) : 0;

  const monthly = monthNames.map((month, idx) => {
    const raised = thisYearGifts
      .filter(g => new Date(g.date).getMonth() === idx)
      .reduce((s, g) => s + g.amount, 0);
    return { month, raised };
  });

  const thisYearDonorIds = new Set(thisYearGifts.map(g => g.donor_id));
  const prevYearDonorIds = new Set(prevYearGifts.map(g => g.donor_id));

  const totalDonors    = thisYearDonorIds.size;
  const retained       = [...thisYearDonorIds].filter(id => prevYearDonorIds.has(id)).length;
  const acquired       = totalDonors - retained;
  const retentionRate  = prevYearDonorIds.size > 0
    ? Math.round(retained / prevYearDonorIds.size * 100)
    : 0;

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
    (await query("SELECT id FROM donors WHERE org_id = ? AND status = 'lapsed'", [orgId])).map(d => d.id)
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

  const id = "afg_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO annual_fund_goals (id,org_id,year,goal)
     VALUES (?,?,?,?)
     ON CONFLICT (org_id, year) DO UPDATE SET goal=EXCLUDED.goal`,
    [id, req.user.orgId, year, goal]
  );
  res.json({ success: true, year, goal });
}));

// ── Stripe Connect ────────────────────────────────────────────────────────
app.post("/stripe/connect", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const state = Buffer.from(JSON.stringify({ orgId: req.user.orgId, ts: Date.now() })).toString("base64url");
  const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${process.env.STRIPE_CLIENT_ID}&scope=read_write&state=${state}&redirect_uri=${encodeURIComponent(process.env.APP_URL + "/stripe/callback")}`;
  res.json({ url });
}));

app.get("/stripe/callback", wrap(async (req, res) => {
  if (!stripe) return res.status(503).send("Stripe not configured");
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");

  let orgId;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    orgId = parsed.orgId;
  } catch {
    return res.status(400).send("Invalid state");
  }

  const response = await stripe.oauth.token({ grant_type: "authorization_code", code });
  const accountId = response.stripe_user_id;
  await run(
    `UPDATE orgs SET stripe_account_id=$1, stripe_connected=TRUE, stripe_connected_at=NOW() WHERE id=$2`,
    [accountId, orgId]
  );

  const frontendUrl = process.env.CORS_ORIGIN || "http://localhost:5173";
  res.redirect(`${frontendUrl}/dashboard?tab=settings&stripe=connected`);
}));

app.post("/stripe/donation-page", requireAuth, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { donorName, donorEmail, amount } = req.body;
  if (!donorName || !donorEmail) return res.status(400).json({ error: "donorName and donorEmail required" });

  const orgRow = await query("SELECT stripe_account_id, stripe_connected, name FROM orgs WHERE id=$1", [req.user.orgId]);
  const org = orgRow.rows[0];
  if (!org?.stripe_connected || !org.stripe_account_id) {
    return res.status(400).json({ error: "Stripe not connected" });
  }

  const amountCents = amount ? Math.round(parseFloat(amount) * 100) : null;
  const stripeOpts = { stripeAccount: org.stripe_account_id };

  const product = await stripe.products.create(
    { name: `Donation to ${org.name}`, metadata: { donor_email: donorEmail, donor_name: donorName } },
    stripeOpts
  );
  const price = await stripe.prices.create(
    amountCents
      ? { unit_amount: amountCents, currency: "usd", product: product.id }
      : { currency: "usd", product: product.id, custom_unit_amount: { enabled: true } },
    stripeOpts
  );
  const link = await stripe.paymentLinks.create(
    { line_items: [{ price: price.id, quantity: 1 }], metadata: { donor_email: donorEmail } },
    stripeOpts
  );

  res.json({ url: link.url });
}));

app.get("/stripe/status", requireAuth, wrap(async (req, res) => {
  const orgRow = await query("SELECT stripe_account_id, stripe_connected, stripe_connected_at FROM orgs WHERE id=$1", [req.user.orgId]);
  const org = orgRow.rows[0];
  res.json({
    connected: !!org?.stripe_connected,
    accountId: org?.stripe_account_id || null,
    connectedAt: org?.stripe_connected_at || null,
  });
}));

app.get("/stripe/online-gifts", requireAuth, wrap(async (req, res) => {
  const result = await query(
    `SELECT g.id, g.amount, g.date, g.stripe_payment_id,
            d.name AS donor_name, d.email AS donor_email
     FROM gifts g
     JOIN donors d ON d.id = g.donor_id
     WHERE g.org_id=$1 AND g.stripe_payment_id IS NOT NULL
     ORDER BY g.date DESC, g.created_at DESC
     LIMIT 20`,
    [req.user.orgId]
  );
  res.json(result.rows.map(r => ({
    id: r.id,
    amount: parseFloat(r.amount),
    date: r.date,
    donorName: r.donor_name,
    donorEmail: r.donor_email,
    stripePaymentId: r.stripe_payment_id,
  })));
}));

// ── Finance: Accounts ─────────────────────────────────────────────────────
app.get("/finance/accounts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM accounts WHERE org_id = ? ORDER BY code ASC",
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/finance/accounts", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { code, name, type, subtype } = req.body;
  if (!code || !name || !type) return res.status(400).json({ error: "code, name, and type required" });
  const id = "acc_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES (?,?,?,?,?,?)",
    [id, req.user.orgId, code, name, type, subtype || ""]
  );
  const rows = await query("SELECT * FROM accounts WHERE id = ?", [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "account", id, {
    description: `Created account ${code} ${name} (${type})`,
    new: { code, name, type, subtype: subtype || "" }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.put("/finance/accounts/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, subtype, active } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [oldAcct] = await query("SELECT * FROM accounts WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  const affected = await run(
    "UPDATE accounts SET name=?,subtype=?,active=? WHERE id=? AND org_id=?",
    [name, subtype || "", active !== false, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Account not found" });
  const rows = await query("SELECT * FROM accounts WHERE id = ?", [req.params.id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "account", req.params.id, {
    description: `Updated account ${oldAcct?.code || ""} ${oldAcct?.name || name}`,
    old: oldAcct ? { name: oldAcct.name, subtype: oldAcct.subtype, active: oldAcct.active } : {},
    new: { name, subtype: subtype || "", active: active !== false }
  }).catch(() => {});
  res.json(rows[0]);
}));

// ── Finance: Funds ─────────────────────────────────────────────────────────
app.get("/finance/funds", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM fin_funds WHERE org_id = ? ORDER BY restricted ASC, name ASC",
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/finance/funds", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, description, restricted } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const id = "ff_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_funds (id,org_id,name,description,restricted) VALUES (?,?,?,?,?)",
    [id, req.user.orgId, name, description || "", restricted ? true : false]
  );
  const rows = await query("SELECT * FROM fin_funds WHERE id = ?", [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "fund", id, {
    description: `Created fund "${name}"${restricted ? " (restricted)" : ""}`,
    new: { name, description: description || "", restricted: !!restricted }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.put("/finance/funds/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, description, restricted } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [oldFund] = await query("SELECT * FROM fin_funds WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  const affected = await run(
    "UPDATE fin_funds SET name=?,description=?,restricted=? WHERE id=? AND org_id=?",
    [name, description || "", restricted ? true : false, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Fund not found" });
  const rows = await query("SELECT * FROM fin_funds WHERE id = ?", [req.params.id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "fund", req.params.id, {
    description: `Updated fund "${name}"`,
    old: oldFund ? { name: oldFund.name, description: oldFund.description, restricted: oldFund.restricted } : {},
    new: { name, description: description || "", restricted: !!restricted }
  }).catch(() => {});
  res.json(rows[0]);
}));

// ── Finance: Transactions ──────────────────────────────────────────────────
app.get("/finance/transactions", requireAuth, wrap(async (req, res) => {
  const { year, fund, account } = req.query;
  let sql = `
    SELECT ft.*, a.code as account_code, a.name as account_name, a.type as account_type,
           f.name as fund_name, f.restricted as fund_restricted
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.org_id = ?
  `;
  const params = [req.user.orgId];
  if (year) { sql += " AND ft.date >= ? AND ft.date <= ?"; params.push(`${year}-01-01`, `${year}-12-31`); }
  if (fund) { sql += " AND ft.fund_id = ?"; params.push(fund); }
  if (account) { sql += " AND ft.account_id = ?"; params.push(account); }
  sql += " ORDER BY ft.date DESC, ft.created_at DESC";
  const rows = await query(sql, params);
  res.json(rows);
}));

app.post("/finance/transactions", requireAuth, wrap(async (req, res) => {
  const { date, description, vendorDonor, amount, type, accountId, fundId, notes } = req.body;
  if (!date || !description || !amount || !type) {
    return res.status(400).json({ error: "date, description, amount, and type required" });
  }
  const id = "ft_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, date, description, vendorDonor || "", parseFloat(amount), type, accountId || null, fundId || null, notes || ""]
  );
  const rows = await query(`
    SELECT ft.*, a.code as account_code, a.name as account_name, a.type as account_type,
           f.name as fund_name, f.restricted as fund_restricted
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.id = ?`, [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "transaction", id, {
    description: `Added ${type === "income" ? "+" : "-"}$${parseFloat(amount).toFixed(2)} — ${description} (${rows[0]?.account_name || "No account"}, ${rows[0]?.fund_name || "No fund"})`,
    new: { amount: parseFloat(amount), type, description, account: rows[0]?.account_name, fund: rows[0]?.fund_name, date, vendorDonor }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.delete("/finance/transactions/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [txnToDelete] = await query(`
    SELECT ft.*, a.name as account_name, f.name as fund_name
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.id = ? AND ft.org_id = ?`, [req.params.id, req.user.orgId]);
  await run("DELETE FROM fin_transactions WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "deleted", "transaction", req.params.id, {
    description: txnToDelete ? `Deleted ${txnToDelete.type === "income" ? "+" : "-"}$${parseFloat(txnToDelete.amount).toFixed(2)} — ${txnToDelete.description}` : "Deleted transaction",
    old: txnToDelete ? { amount: parseFloat(txnToDelete.amount), type: txnToDelete.type, description: txnToDelete.description, account: txnToDelete.account_name, fund: txnToDelete.fund_name, date: txnToDelete.date } : {}
  }).catch(() => {});
  res.json({ success: true });
}));

// ── Finance: Budgets ───────────────────────────────────────────────────────
app.get("/finance/budgets", requireAuth, wrap(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const accounts = await query(
    "SELECT * FROM accounts WHERE org_id = ? AND active = TRUE AND type IN ('revenue','expense') ORDER BY code ASC",
    [req.user.orgId]
  );
  const budgets = await query(
    "SELECT * FROM budgets WHERE org_id = ? AND year = ?",
    [req.user.orgId, year]
  );
  const actuals = await query(
    `SELECT account_id, type, SUM(amount) as total
     FROM fin_transactions
     WHERE org_id = ? AND date >= ? AND date <= ?
     GROUP BY account_id, type`,
    [req.user.orgId, `${year}-01-01`, `${year}-12-31`]
  );
  const budgetMap = Object.fromEntries(budgets.map(b => [b.account_id, parseFloat(b.amount)]));
  const actualMap = Object.fromEntries(actuals.map(a => [a.account_id, parseFloat(a.total)]));

  res.json(accounts.map(a => ({
    accountId:   a.id,
    accountCode: a.code,
    accountName: a.name,
    accountType: a.type,
    subtype:     a.subtype,
    budget:      budgetMap[a.id] || 0,
    actual:      actualMap[a.id] || 0,
    variance:    (budgetMap[a.id] || 0) - (actualMap[a.id] || 0),
  })));
}));

app.post("/finance/budgets", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { accountId, year, amount } = req.body;
  if (!accountId || !year) return res.status(400).json({ error: "accountId and year required" });
  const id = "bgt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO budgets (id,org_id,account_id,year,amount)
     VALUES (?,?,?,?,?)
     ON CONFLICT (org_id, account_id, year) DO UPDATE SET amount=EXCLUDED.amount`,
    [id, req.user.orgId, accountId, parseInt(year), parseFloat(amount) || 0]
  );
  const [acctRow] = await query("SELECT code, name FROM accounts WHERE id = ?", [accountId]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "budget", `${accountId}_${year}`, {
    description: `Set ${year} budget for ${acctRow?.code || ""} ${acctRow?.name || accountId} to $${(parseFloat(amount)||0).toLocaleString()}`,
    new: { account: acctRow?.name || accountId, year: parseInt(year), amount: parseFloat(amount) || 0 }
  }).catch(() => {});
  res.json({ success: true, accountId, year, amount: parseFloat(amount) || 0 });
}));

// ── Finance: Summary ───────────────────────────────────────────────────────
app.get("/finance/summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const year = new Date().getFullYear();
  const [ytdRows, allRows] = await Promise.all([
    query(
      `SELECT type, SUM(amount) as total FROM fin_transactions
       WHERE org_id = ? AND date >= ? AND date <= ?
       GROUP BY type`,
      [orgId, `${year}-01-01`, `${year}-12-31`]
    ),
    query(
      "SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type",
      [orgId]
    ),
  ]);
  const ytd = Object.fromEntries(ytdRows.map(r => [r.type, parseFloat(r.total)]));
  const all = Object.fromEntries(allRows.map(r => [r.type, parseFloat(r.total)]));
  const ytdRevenue  = ytd.income  || 0;
  const ytdExpenses = ytd.expense || 0;
  const cashOnHand  = (all.income || 0) - (all.expense || 0);
  res.json({ cashOnHand, ytdRevenue, ytdExpenses, netSurplus: ytdRevenue - ytdExpenses });
}));

// ── Finance: Audit Log ─────────────────────────────────────────────────────
app.get("/finance/audit-log", requireAuth, wrap(async (req, res) => {
  const { action, entityType, limit = 200 } = req.query;
  let sql = "SELECT * FROM fin_audit_log WHERE org_id = ?";
  const params = [req.user.orgId];
  if (action) { sql += " AND action = ?"; params.push(action); }
  if (entityType) { sql += " AND entity_type = ?"; params.push(entityType); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(parseInt(limit));
  const rows = await query(sql, params);
  res.json(rows.map(r => ({
    ...r,
    changes: typeof r.changes === "string" ? JSON.parse(r.changes || "{}") : (r.changes || {}),
  })));
}));

// ── Demo request (no auth — public landing page) ──────────────────────────
app.post("/demo-request", wrap(async (req, res) => {
  const { name, email, orgName, orgSize, challenge } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Name and email required" });

  // Store in DB for reference
  await run(
    `CREATE TABLE IF NOT EXISTS demo_requests (
      id TEXT PRIMARY KEY,
      name TEXT, email TEXT, org_name TEXT,
      org_size TEXT, challenge TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await run(
    `INSERT INTO demo_requests (id, name, email, org_name, org_size, challenge)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), name, email, orgName || "", orgSize || "", challenge || ""]
  );

  // Send notification email if DEMO_NOTIFY_EMAIL + SMTP env vars are set
  const notifyTo = process.env.DEMO_NOTIFY_EMAIL;
  const smtpHost = process.env.DEMO_SMTP_HOST;
  const smtpUser = process.env.DEMO_SMTP_USER;
  const smtpPass = process.env.DEMO_SMTP_PASS;

  if (notifyTo && smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.DEMO_SMTP_PORT || "587"),
        secure: parseInt(process.env.DEMO_SMTP_PORT || "587") === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: smtpUser,
        to: notifyTo,
        subject: `New Steward demo request — ${name} (${orgName || "unknown org"})`,
        text: `New demo request:\n\nName: ${name}\nEmail: ${email}\nOrg: ${orgName}\nSize: ${orgSize}\nChallenge: ${challenge}\n`,
      });
    } catch (e) {
      console.error("Demo notify email failed:", e.message);
    }
  }

  res.json({ success: true });
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
