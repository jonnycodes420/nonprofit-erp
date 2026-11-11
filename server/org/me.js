// server/org/me.js — the signed-in person's own settings (/me).
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
// STAFF-MAIL-1: one person's morning email (sections, hour, days) and the
// columns /me and the prefs route read for it.
const { briefSettings, BRIEF_SECTIONS } = require("../../routes/email");
const NOTIFY_SELECT = "notify_thread_nudge, brief_sections, brief_hour, brief_days, notify_portfolio_gifts, notify_task_assignments, "
  + "notify_step_reminder, notify_meeting_brief, notify_week_in_review, notify_monthly_report, notify_connection_alerts, notify_weekly";

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  TF, TOTP, meRow, mfaVerifyForUser, orgOf, query, requireAuth, resend, run, signToken, wrap,
} = ctx;
const bcrypt = require("bcryptjs");
const mustKeepMfa = (u, o) => !!(u.is_super_admin || (o && o.require_mfa) || (u.role === "admin" && o && o.require_admin_mfa));
// One check for "is this a current code of yours", whatever the method.
async function currentCodeOk(u, code) {
  const c = String(code || "").trim();
  if (!c) return false;
  if (TF.looksLikeRecovery(c)) return TF.useRecoveryCode(u, c);
  if (u.mfa_method === "email") return TF.useEmailCode(u, c);
  return (await mfaVerifyForUser(u, c)) !== null;
}
let app = routers.r1;

app.get("/me/mfa", requireAuth, wrap(async (req, res) => {
  const u = await meRow(req.user.userId);
  const o = await orgOf(req.user.orgId);
  res.json({ enabled: !!(u && u.mfa_enabled_at), enabledAt: u ? u.mfa_enabled_at : null, method: u?.mfa_method || (u?.mfa_enabled_at ? "totp" : null),
    recoveryCodesLeft: u?.mfa_enabled_at ? await TF.recoveryLeft(u.id) : 0,
    orgRequires: !!(o && o.require_mfa), orgRequiresForAdmins: !!(o && o.require_admin_mfa),
    idleMinutes: (o && o.idle_minutes) || TF.IDLE_DEFAULT,
    allowStaffLargeExports: !!(o && o.allow_staff_large_exports),   // SECURE-2 item 8
    mustKeep: !!(u && mustKeepMfa(u, o)), demo: TF.isDemoOrg(o), demoSentence: TF.isDemoOrg(o) ? TF.DEMO_SENTENCE : null });
}));

// Start setup. Authenticator: a new secret, sealed as PENDING, with its QR
// code. Email: a code to the sign-in address. Never on a shared demo login.
app.post("/me/mfa/setup", requireAuth, wrap(async (req, res) => {
  const o = await orgOf(req.user.orgId);
  if (TF.isDemoOrg(o)) return res.status(409).json({ error: "demo_org", message: TF.DEMO_SENTENCE });
  const u = await meRow(req.user.userId);
  if (req.body?.method === "email") {
    const r = await TF.sendEmailCode(u, resend, "turn on two-factor");
    if (!r.sent && r.reason === "too_soon") return res.status(429).json({ error: "too_soon", message: "A code was sent a moment ago. Check your inbox, or try again in a minute." });
    if (!r.sent) return res.status(502).json({ error: "not_delivered", message: `Steward could not email a code to ${u.email} just now. Try again in a minute, or use an authenticator app.` });
    return res.json({ method: "email", sentence: `We emailed a six-digit code to ${u.email}. Type it here to finish.` });
  }
  const { seal, credentialsConfigured } = await import("../../shared/secretBox.js");
  // FIX-10 D — a customer never reads a variable name. The reason is in the
  // server log, where somebody can act on it.
  if (!credentialsConfigured()) {
    console.error("[mfa] setup refused: no credential key is configured on this server");
    return res.status(503).json({ error: "Two-step sign-in isn't available yet. We'll let you know when it is." });
  }
  const secret = TOTP.newSecret();
  await run(`UPDATE users SET mfa_pending_sealed=? WHERE id=?`, [seal(secret, { aad: "mfa:" + req.user.orgId + ":" + req.user.userId }), req.user.userId]);
  const otpauthUrl = TOTP.otpauthUrl(secret, { account: req.user.email || req.user.userId });
  let qr = null;
  try { qr = await require("qrcode").toDataURL(otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: "M" }); } catch { qr = null; }
  res.json({ method: "totp", secret, otpauthUrl, qr,
    sentence: "Scan this with your authenticator app, or type the key, then enter the six-digit code it shows." });
}));

// Finish setup with one good code. Returns the recovery codes ONCE and a full
// session: a setup-only session becomes a real one here, and nowhere else.
app.post("/me/mfa/enable", requireAuth, wrap(async (req, res) => {
  const u = await meRow(req.user.userId);
  const o = await orgOf(req.user.orgId);
  if (TF.isDemoOrg(o)) return res.status(409).json({ error: "demo_org", message: TF.DEMO_SENTENCE });
  if (!u) return res.status(400).json({ error: "Start setup first." });
  if (req.body?.method === "email") {
    if (!(await TF.useEmailCode(u, req.body.code))) return res.status(400).json({ error: "mfa_invalid", message: "That code did not match, or it has expired." });
    await run(`UPDATE users SET mfa_method='email', mfa_secret_sealed=NULL, mfa_pending_sealed=NULL, mfa_enabled_at=NOW(), mfa_must_setup=false WHERE id=?`, [u.id]);
  } else {
    if (!u.mfa_pending_sealed) return res.status(400).json({ error: "Start setup first." });
    const { open } = await import("../../shared/secretBox.js");
    const secret = open(u.mfa_pending_sealed, { aad: "mfa:" + u.org_id + ":" + u.id });
    const ctr = TOTP.verify(secret, req.body && req.body.code);
    if (ctr === null) return res.status(400).json({ error: "mfa_invalid", message: "That code did not match. Codes change every 30 seconds." });
    await run(`UPDATE users SET mfa_method='totp', mfa_secret_sealed=mfa_pending_sealed, mfa_pending_sealed=NULL, mfa_enabled_at=NOW(), mfa_last_counter=?, mfa_must_setup=false WHERE id=?`, [ctr, u.id]);
  }
  const recoveryCodes = await TF.makeRecoveryCodes(u);
  req.audit.action("two-factor turned on"); req.audit.entity("user", u.id, u.email);
  const isSuperAdmin = !!u.is_super_admin;
  const { token } = await TF.issueSession(u, req, signToken);
  const [org] = await query(`SELECT * FROM orgs WHERE id=?`, [u.org_id]);
  res.json({ enabled: true, token, recoveryCodes,
    recoverySentence: "Keep these somewhere safe. Each works once, instead of a code, if you lose your phone. They will not be shown again.",
    user: { id: u.id, email: u.email, name: u.name, role: u.role, isSuperAdmin, mfaEnabled: true, portfolio: await require("../auth/portfolio").flagFor(u.id, u.org_id) },
    org: org ? { ...org, onboarding_complete: org.onboarding_complete ?? 1 } : null });
}));

// A code by email, for someone whose method is email and who needs one now
// (to turn it off, or to make new recovery codes).
app.post("/me/mfa/email-code", requireAuth, wrap(async (req, res) => {
  const u = await meRow(req.user.userId);
  if (!u || u.mfa_method !== "email") return res.status(400).json({ error: "Your two-factor uses an authenticator app." });
  const r = await TF.sendEmailCode(u, resend, "confirm a change to two-factor");
  req.audit.skip("a code sent to oneself");
  res.json({ sent: r.sent, sentence: r.sent ? `We emailed a code to ${u.email}.`
    : r.reason === "too_soon" ? "A code was sent a moment ago. Check your inbox."
    : `Steward could not email a code to ${u.email} just now. Try again in a minute.` });
}));

// Turning it off takes a current code, and is refused where it is required.
app.post("/me/mfa/disable", requireAuth, wrap(async (req, res) => {
  const u = await meRow(req.user.userId);
  if (!u || !u.mfa_enabled_at) return res.status(400).json({ error: "Two-step sign-in is not on." });
  const o = await orgOf(u.org_id);
  if (mustKeepMfa(u, o)) return res.status(409).json({ error: u.is_super_admin ? "Super-admin accounts always use two-factor." : "Your organization requires two-factor sign-in." });
  // SECURE-2 item 6: turning two-factor off takes an admin. Staff ask one,
  // who resets it from Settings, Team (that path emails them too).
  if (u.role !== "admin") return res.status(403).json({ error: "admin_required", message: "Turning two-factor off takes an admin. Ask one to reset it for you in Settings, Team." });
  if (!(await currentCodeOk(u, req.body && req.body.code))) return res.status(400).json({ error: "mfa_invalid", message: "That code did not match." });
  await run(`UPDATE users SET mfa_secret_sealed=NULL, mfa_pending_sealed=NULL, mfa_enabled_at=NULL, mfa_last_counter=NULL, mfa_method=NULL WHERE id=?`, [u.id]);
  await run(`DELETE FROM mfa_recovery_codes WHERE user_id=?`, [u.id]);
  await run(`DELETE FROM mfa_trusted_browsers WHERE user_id=?`, [u.id]);
  req.audit.action("two-factor turned off"); req.audit.entity("user", u.id, u.email);
  // Sign-in mail, always on: the person hears that their account lost a lock.
  const emailed = await TF.mailUser(u, resend, "Two-factor was turned off on your Steward account",
    `Two-factor sign-in was turned off on your Steward account on ${new Date().toUTCString()}. If this was not you, change your password and turn it back on in Settings, Security.`);
  res.json({ enabled: false, emailed });
}));

// New recovery codes: the old set stops working the moment these exist.
app.post("/me/mfa/recovery-codes", requireAuth, wrap(async (req, res) => {
  const u = await meRow(req.user.userId);
  if (!u || !u.mfa_enabled_at) return res.status(400).json({ error: "Turn on two-factor first." });
  if (!(await currentCodeOk(u, req.body && req.body.code))) return res.status(400).json({ error: "mfa_invalid", message: "That code did not match." });
  const recoveryCodes = await TF.makeRecoveryCodes(u);
  req.audit.action("recovery codes replaced"); req.audit.entity("user", u.id, u.email);
  res.json({ recoveryCodes, recoverySentence: "Your old recovery codes no longer work. Keep these somewhere safe; they will not be shown again." });
}));

// YOUR SESSIONS.
app.get("/me/sessions", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, user_agent, ip_prefix, created_at, last_active_at FROM user_sessions
      WHERE user_id=? AND revoked_at IS NULL AND last_active_at > NOW() - INTERVAL '8 days'
      ORDER BY last_active_at DESC LIMIT 50`, [req.user.userId]);
  res.json({ sessions: rows.map(r => ({ id: r.id, ...TF.describeAgent(r.user_agent), ipPrefix: r.ip_prefix,
      createdAt: r.created_at, lastActiveAt: r.last_active_at, thisBrowser: r.id === req.user.sid })),
    sentence: "Every browser signed in to your account in the last week. Sign one out and it is asked for a password on its next click." });
}));
app.post("/me/sessions/:id/sign-out", requireAuth, wrap(async (req, res) => {
  const n = await TF.revokeSessions("id=? AND user_id=?", [req.params.id, req.user.userId], req.user.userId);
  if (!n) return res.status(404).json({ error: "That session is not yours, or it has already ended." });
  req.audit.action("signed a session out"); req.audit.entity("session", req.params.id);
  res.json({ ok: true });
}));
// Everywhere else. The cut-off moves too, which also ends any token from
// before sessions were rows; this browser gets a fresh token for its session.
app.post("/me/sessions/sign-out-others", requireAuth, wrap(async (req, res) => {
  if (TF.isDemoOrg(await orgOf(req.user.orgId))) return res.status(409).json({ error: "demo_org", message: "The shared demo login is used by many people at once, so it cannot sign others out or change its password. In your own account this works as described." });
  const u = await meRow(req.user.userId);
  const n = await TF.revokeSessions("user_id=? AND id <> ?", [u.id, req.user.sid || ""], u.id);
  await run(`UPDATE users SET sessions_valid_after=NOW() - INTERVAL '2 seconds' WHERE id=?`, [u.id]);
  require("../../sessionCache").sessionCache.evict(u.id);
  let token = null;
  if (req.user.sid) { token = signToken({ userId: u.id, orgId: req.user.orgId || u.org_id, email: u.email, role: req.user.role || u.role, isSuperAdmin: !!u.is_super_admin, sid: req.user.sid }); }
  else token = (await TF.issueSession(u, req, signToken)).token;
  req.audit.action("signed out everywhere else"); req.audit.entity("user", u.id, u.email);
  res.json({ ok: true, ended: n, token });
}));

// CHANGE YOUR PASSWORD, signed in. Every other session ends; this one stays.
app.post("/me/password", requireAuth, wrap(async (req, res) => {
  if (TF.isDemoOrg(await orgOf(req.user.orgId))) return res.status(409).json({ error: "demo_org", message: "The shared demo login is used by many people at once, so it cannot sign others out or change its password. In your own account this works as described." });
  const u = await meRow(req.user.userId);
  const cur = String(req.body?.current || ""), next = String(req.body?.next || "");
  if (!u || !bcrypt.compareSync(cur, u.password_hash)) return res.status(400).json({ error: "wrong_password", message: "Your current password did not match." });
  if (next.length < 8) return res.status(400).json({ error: "Your new password needs at least 8 characters." });
  await run(`UPDATE users SET password_hash=? WHERE id=?`, [bcrypt.hashSync(next, 12), u.id]);
  const n = await TF.revokeSessions("user_id=? AND id <> ?", [u.id, req.user.sid || ""], u.id);
  await run(`UPDATE users SET sessions_valid_after=NOW() - INTERVAL '2 seconds' WHERE id=?`, [u.id]);
  require("../../sessionCache").sessionCache.evict(u.id);
  const token = req.user.sid ? signToken({ userId: u.id, orgId: req.user.orgId || u.org_id, email: u.email, role: req.user.role || u.role, isSuperAdmin: !!u.is_super_admin, sid: req.user.sid })
    : (await TF.issueSession(u, req, signToken)).token;
  req.audit.action("password changed"); req.audit.entity("user", u.id, u.email);
  res.json({ ok: true, ended: n, token, sentence: n ? `Password changed. ${n} other ${n === 1 ? "session was" : "sessions were"} signed out.` : "Password changed." });
}));

app.get("/me", requireAuth, wrap(async (req, res) => {
  const users = await query(`SELECT id, email, name, role, ${NOTIFY_SELECT} FROM users WHERE id = ?`, [req.user.userId]);
  const orgs  = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!users.length || !orgs.length) return res.status(404).json({ error: "Not found" });
  const u = users[0];
  res.json({
    user: { id: u.id, email: u.email, name: u.name, role: req.user.support ? "admin" : req.user.role, canMajorGifts: await require("../../prospect").canSee(u.id, req.user.orgId),   // PROSPECT-1
      // ACCESS-2: who they see here, and the cabinet's two switches (the app hides what's closed to them).
      portfolio: require("../auth/portfolio").isScoped(req.user), canExport: !(req.user.portfolio && req.user.portfolio.canExport === false),
      canWealthScores: await require("../wealth/access").maySee(u.id, req.user.orgId) },   // WEALTH-1
    org: orgs[0],
    // FIX-57: a support session says so, so the banner reads the server.
    ...(req.user.support ? { support: { ...req.user.support, orgName: orgs[0].name } } : {}),
    notifications: mapNotifyPrefs(u),
  });
}));

// PUT /me/notification-prefs (BUILD-36 A4) — one person's own staff email.
// STAFF-MAIL-1/2: `morningEmail` is off for a new person until they turn it on
// (people added before STAFF-MAIL-2 kept it on); `brief` is what goes in it and when ({sections, hour, days}). Every
// other key is an email she turns on for herself, off until she does.
const NOTIFY_PREF_MAP = { morningEmail: "notify_thread_nudge", portfolioGifts: "notify_portfolio_gifts", taskAssignments: "notify_task_assignments",
  stepReminder: "notify_step_reminder", meetingBrief: "notify_meeting_brief", weekInReview: "notify_week_in_review",
  monthlyReport: "notify_monthly_report", connectionAlerts: "notify_connection_alerts", weekly: "notify_weekly" };
app.put("/me/notification-prefs", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], params = [];
  for (const [k, col] of Object.entries(NOTIFY_PREF_MAP)) {
    if (typeof b[k] === "boolean") { sets.push(`${col}=?`); params.push(b[k]); }
  }
  // STAFF-MAIL-2 (Jonathan, 31 Oct 2026): turning the daily email ON turns the
  // weekly one off, so nobody gets both unless they tick both. Only on the turn
  // itself, and only when the same save does not say what the weekly is; the
  // answer says so (`weeklyTurnedOff`), and the page's Undo sends both back.
  let weeklyTurnedOff = false;
  if (b.morningEmail === true && typeof b.weekly !== "boolean") {
    const [cur] = await query("SELECT notify_thread_nudge, notify_weekly FROM users WHERE id=?", [req.user.userId]);
    if (cur && !briefSettings(cur).on && cur.notify_weekly === true) {
      sets.push("notify_weekly=?"); params.push(false); weeklyTurnedOff = true;
    }
  }
  const brief = b.brief && typeof b.brief === "object" ? b.brief : null;
  if (brief) {
    if (brief.sections && typeof brief.sections === "object") {
      const [cur] = await query("SELECT brief_sections FROM users WHERE id=?", [req.user.userId]);
      const next = { ...((cur && cur.brief_sections) || {}) };
      for (const k of BRIEF_SECTIONS) if (typeof brief.sections[k] === "boolean") next[k] = brief.sections[k];
      sets.push("brief_sections=?::jsonb"); params.push(JSON.stringify(next));
    }
    if (brief.hour !== undefined) {
      if (!Number.isInteger(brief.hour) || brief.hour < 0 || brief.hour > 23) return res.status(400).json({ error: "Pick an hour between midnight and 11 PM." });
      sets.push("brief_hour=?"); params.push(brief.hour);
    }
    if (brief.days !== undefined) {
      if (!["weekdays", "every_day"].includes(brief.days)) return res.status(400).json({ error: "Pick weekdays or every day." });
      sets.push("brief_days=?"); params.push(brief.days);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No valid preferences provided" });
  params.push(req.user.userId);
  await run(`UPDATE users SET ${sets.join(",")} WHERE id=?`, params);
  const rows = await query(`SELECT ${NOTIFY_SELECT} FROM users WHERE id=?`, [req.user.userId]);
  res.json({ notifications: mapNotifyPrefs(rows[0]), ...(weeklyTurnedOff ? { weeklyTurnedOff: true } : {}) });
}));

// ── FIX-57 · MY PROFILE: A SIGNATURE FOR EACH PERSON ──────────────────────
// The name she signs with, title, phone, an optional photo from the org's
// media library, and the block (blank: those lines). What is drafted for her
// signs with it, ahead of Brand's (shared/brandKit.js senderSignature).
async function myProfile(req) {
  const BK = await import("../../shared/brandKit.js");
  const [u] = await query(`SELECT ${BK.SIGN_COLUMNS}, email FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  if (!u) return null;
  const [o] = await query("SELECT name, receipt_signature_name, receipt_signature_title, brand_signature_extra FROM orgs WHERE id=?", [req.user.orgId]);
  const sig = BK.senderSignature(o, u);
  return { name: u.name || "", email: u.email, signName: u.sign_name || "", title: u.sign_title || "", phone: u.sign_phone || "",
    photo: u.sign_photo || null, block: u.sign_block || "",
    // what her drafts are signed with now, and where it came from
    signature: sig.text, from: sig.from };
}
app.get("/me/profile", requireAuth, wrap(async (req, res) => {
  const p = await myProfile(req);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
}));
app.put("/me/profile", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const clip = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n) || null;
  let photo;
  if (b.photoId === null || b.photoId === "") photo = null;
  else if (b.photoId !== undefined) {
    const [m] = await query("SELECT asset_id FROM media_items WHERE id=? AND org_id=? AND kind='photo' AND removed_at IS NULL", [String(b.photoId), req.user.orgId]);
    if (!m) return res.status(400).json({ error: "bad_photo", sentence: "Choose a photo from your media library." });
    photo = `/portal-assets/${m.asset_id}`;
  }
  const [prior] = await query("SELECT sign_name, sign_title, sign_phone, sign_photo, sign_block FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  if (!prior) return res.status(404).json({ error: "Not found" });
  const next = {
    sign_name: b.signName !== undefined ? clip(b.signName, 120) : prior.sign_name,
    sign_title: b.title !== undefined ? clip(b.title, 120) : prior.sign_title,
    sign_phone: b.phone !== undefined ? clip(b.phone, 40) : prior.sign_phone,
    sign_photo: photo !== undefined ? photo : prior.sign_photo,
    sign_block: b.block !== undefined ? (String(b.block || "").replace(/\r/g, "").trim().slice(0, 600) || null) : prior.sign_block,
  };
  if (req.audit) { req.audit.before(prior); req.audit.after(next); }
  await run(`UPDATE users SET sign_name=?, sign_title=?, sign_phone=?, sign_photo=?, sign_block=? WHERE id=? AND org_id=?`,
    [next.sign_name, next.sign_title, next.sign_phone, next.sign_photo, next.sign_block, req.user.userId, req.user.orgId]);
  res.json(await myProfile(req));
}));

// ── Per-user Home layout (BUILD-34) ────────────────────────────────────────
// Storage for Home's edit mode (reorder + show/hide, section-level only).
// Per USER (keyed on req.user.userId — org admins don't control other users'
// layouts; org isolation is inherent). The CANONICAL section list + the
// stale-config merge live client-side in client/src/lib/homeLayout.js — the
// server only validates shape and enforces the one hard rail it knows: the
// hero section ("hero") can never be stored hidden, so Home can't be blanked.
const HOME_HERO_SECTION_ID = "hero";
function normalizeHomeLayout(layout) {
  if (!Array.isArray(layout) || layout.length > 32) return null;
  const seen = new Set();
  const out = [];
  for (const row of layout) {
    if (!row || typeof row.id !== "string" || !row.id || row.id.length > 40) return null;
    if (typeof row.visible !== "boolean") return null;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, visible: row.id === HOME_HERO_SECTION_ID ? true : row.visible });
  }
  return out;
}

app.get("/me/home-layout", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT home_layout FROM users WHERE id = ?", [req.user.userId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  let layout = null;
  try { layout = rows[0].home_layout ? JSON.parse(rows[0].home_layout) : null; } catch { layout = null; }
  res.json({ layout: normalizeHomeLayout(layout) });
}));

app.put("/me/home-layout", requireAuth, wrap(async (req, res) => {
  const layout = normalizeHomeLayout(req.body?.layout);
  if (!layout) return res.status(400).json({ error: "layout must be an array of {id, visible}" });
  await run("UPDATE users SET home_layout = ? WHERE id = ?", [JSON.stringify(layout), req.user.userId]);
  res.json({ layout });
}));

// Reset = back to the canonical default (NULL, so future default-order changes
// apply automatically instead of freezing today's order into the row).
app.delete("/me/home-layout", requireAuth, wrap(async (req, res) => {
  await run("UPDATE users SET home_layout = NULL WHERE id = ?", [req.user.userId]);
  res.json({ layout: null });
}));

// ── NAV-1 §4 — the per-user sidebar layout ─────────────────────────────────
// The same shape and the same three verbs as the Home layout above, for the
// same reason: a preference about a screen belongs to the person, follows them
// to another browser, and resets to NULL rather than to a frozen copy of
// today's default. The canonical groups live in client/src/lib/navGroups.js;
// the server stores what the person chose and validates nothing about the
// groups themselves, so a nav item added there needs no migration here.
const NAV_ALWAYS_VISIBLE = new Set(["dashboard", "settings"]);
function normalizeNavLayout(layout) {
  if (!Array.isArray(layout) || layout.length > 48) return null;
  const seen = new Set();
  const out = [];
  for (const row of layout) {
    if (!row || typeof row.id !== "string" || !row.id || row.id.length > 40) return null;
    if (typeof row.visible !== "boolean") return null;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    // Home and Settings are never hidden: hiding either would leave somebody
    // with no way back. The client refuses it too; this is the half a stale
    // client cannot get past.
    out.push({ id: row.id, visible: NAV_ALWAYS_VISIBLE.has(row.id) ? true : row.visible });
  }
  return out;
}

app.get("/me/nav-layout", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT nav_layout FROM users WHERE id = ?", [req.user.userId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  let layout = null;
  try { layout = rows[0].nav_layout ? JSON.parse(rows[0].nav_layout) : null; } catch { layout = null; }
  // NAV-1 (menu): the org's layer rides along, so the shell reads both in one request.
  res.json({ layout: normalizeNavLayout(layout), org: await require("./menu").orgMenu(query, req.user.orgId) });
}));

app.put("/me/nav-layout", requireAuth, wrap(async (req, res) => {
  const layout = normalizeNavLayout(req.body?.layout);
  if (!layout) return res.status(400).json({ error: "layout must be an array of {id, visible}" });
  await run("UPDATE users SET nav_layout = ? WHERE id = ?", [JSON.stringify(layout), req.user.userId]);
  res.json({ layout });
}));

app.delete("/me/nav-layout", requireAuth, wrap(async (req, res) => {
  await run("UPDATE users SET nav_layout = NULL WHERE id = ?", [req.user.userId]);
  res.json({ layout: null });
}));
// STAFF-MAIL-1/2: the morning email reads on only for a NULL left from before
// STAFF-MAIL-2 (new people get false); every other
// staff email reads off unless turned on (routes/email.js userWantsEmail).
function mapNotifyPrefs(row) {
  const b = briefSettings(row);
  return {
    morningEmail: b.on,
    brief: { sections: b.sections, hour: b.hour, days: b.days },
    portfolioGifts: row?.notify_portfolio_gifts === true,
    taskAssignments: row?.notify_task_assignments === true,
    stepReminder: row?.notify_step_reminder === true,
    meetingBrief: row?.notify_meeting_brief === true,
    weekInReview: row?.notify_week_in_review === true,
    monthlyReport: row?.notify_monthly_report === true,
    connectionAlerts: row?.notify_connection_alerts === true,
    weekly: row?.notify_weekly === true,   // STAFF-MAIL-2: NULL (from before) reads off
  };
}
}

module.exports = { routers, mount };
