// twoFactor.js — SEC-1. TWO-FACTOR SIGN-IN AND THE SESSIONS IT GUARDS.
//
// BUILD-98 built the authenticator code (totp.js) and the switch that made
// admins use it. This is the rest of what a board means by "our donor data
// needs a password and a code": recovery codes, an emailed code for someone
// without an authenticator app, a trusted browser, a lockout, and sessions a
// person can see and end one by one.
//
// THE RULES, each enforced here or in the route that calls it:
//   · A session is a row. Every token carries its id (`sid`), requireAuth
//     checks the row on every request, and signing a session out takes effect
//     on its very next request on this instance (the cache entry is dropped).
//   · Recovery codes are shown once and stored hashed. Each works once.
//   · An emailed code goes to the person's own sign-in address only, lasts ten
//     minutes, and is stored hashed.
//   · Five wrong codes lock code entry for fifteen minutes and tell the person.
//   · "Trust this browser" is off by default and lasts thirty days. The token
//     lives in that browser; the server keeps only its hash.
//   · A password reset never turns two-factor off (nothing here is called by it).
"use strict";
const crypto = require("crypto");
const { query, run } = require("./db");
const { isBlockedAddress } = require("./mailBlock");

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const TRUST_DAYS = 30;
const EMAIL_CODE_MINUTES = 10;
const RECOVERY_COUNT = 10;
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const DEMO_ORG_IDS = ["org_b72demo", "org_creo"];
const DEMO_SENTENCE = "Two-factor is turned off for the shared demo login. In your own account it takes about a minute.";

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const isDemoOrg = org => !!org && (org.is_demo_org === true || DEMO_ORG_IDS.includes(org.id));

// ── WHAT A SESSION SAYS ABOUT ITSELF ───────────────────────────────────────
// The first three parts of an IPv4 address, or the first three groups of an
// IPv6 one. Enough to recognise "that is the office", not enough to locate a
// person.
function ipPrefix(ip) {
  const s = String(ip || "").replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split(".").slice(0, 3).join(".") + ".x";
  if (s.includes(":")) return s.split(":").filter(Boolean).slice(0, 3).join(":") + ":…";
  return s || null;
}
function describeAgent(ua) {
  const u = String(ua || "");
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox"
    : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : u ? "A browser" : "Unknown browser";
  const os = /iPhone|iPad/.test(u) ? "iOS" : /Android/.test(u) ? "Android" : /Mac OS X|Macintosh/.test(u) ? "macOS"
    : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "Unknown system";
  return { browser, os };
}

// ── SESSIONS ───────────────────────────────────────────────────────────────
const alive = new Map();      // sid -> { ok, expires }
const touched = new Map();    // sid -> last touch ms
const cacheTtl = () => { const n = Number(process.env.SESSION_CACHE_TTL_MS); return Number.isFinite(n) ? n : 30000; };

async function createSession(user, req) {
  const id = "ses_" + crypto.randomBytes(12).toString("hex");
  const ua = req && req.headers ? String(req.headers["user-agent"] || "").slice(0, 400) : "";
  await run(
    `INSERT INTO user_sessions (id,user_id,org_id,user_agent,ip_prefix,created_at,last_active_at)
     VALUES (?,?,?,?,?,NOW(),NOW())`, [id, user.id, user.org_id, ua, ipPrefix(req && req.ip)]);
  return id;
}
// A full session token, always with a session row behind it.
async function issueSession(user, req, signToken) {
  const sid = await createSession(user, req);
  const token = signToken({ userId: user.id, orgId: user.org_id, email: user.email, role: user.role,
    isSuperAdmin: !!user.is_super_admin, sid });
  return { token, sid };
}
async function sessionAlive(sid, userId) {
  const now = Date.now();
  const hit = alive.get(sid);
  if (hit && hit.expires > now) return hit.ok;
  const [row] = await query(`SELECT user_id, revoked_at FROM user_sessions WHERE id=?`, [sid]);
  const ok = !!row && !row.revoked_at && row.user_id === userId;
  alive.set(sid, { ok, expires: now + cacheTtl() });
  if (ok && (now - (touched.get(sid) || 0)) > TOUCH_EVERY_MS) {
    touched.set(sid, now);
    run(`UPDATE user_sessions SET last_active_at=NOW() WHERE id=?`, [sid]).catch(() => {});
  }
  return ok;
}
async function revokeSessions(where, args, by) {
  const rows = await query(
    `UPDATE user_sessions SET revoked_at=NOW(), revoked_by=? WHERE revoked_at IS NULL AND ${where} RETURNING id`, [by || null, ...args]);
  for (const r of rows) alive.delete(r.id);
  return rows.length;
}

// ── RECOVERY CODES ─────────────────────────────────────────────────────────
// Ten codes like "k7m2-9qx4". Shown once; only the hash is kept.
const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newRecoveryCode() {
  // randomInt, not a byte modulo the alphabet: 256 is not a multiple of 31,
  // so the modulo would favour the first letters (CodeQL caught it).
  let s = "";
  for (let i = 0; i < 8; i++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}
const normaliseRecovery = c => String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const looksLikeRecovery = c => normaliseRecovery(c).length === 8 && /[a-z]/.test(normaliseRecovery(c));
async function makeRecoveryCodes(user) {
  await run(`DELETE FROM mfa_recovery_codes WHERE user_id=?`, [user.id]);
  const codes = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const c = newRecoveryCode();
    codes.push(c);
    await run(`INSERT INTO mfa_recovery_codes (id,user_id,org_id,code_hash) VALUES (?,?,?,?)`,
      ["mrc_" + crypto.randomBytes(8).toString("hex"), user.id, user.org_id, sha(user.id + ":" + normaliseRecovery(c))]);
  }
  return codes;
}
async function useRecoveryCode(user, code) {
  if (!looksLikeRecovery(code)) return false;
  const rows = await query(
    `UPDATE mfa_recovery_codes SET used_at=NOW() WHERE user_id=? AND code_hash=? AND used_at IS NULL RETURNING id`,
    [user.id, sha(user.id + ":" + normaliseRecovery(code))]);
  return rows.length > 0;
}
async function recoveryLeft(userId) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM mfa_recovery_codes WHERE user_id=? AND used_at IS NULL`, [userId]);
  return r ? r.n : 0;
}

// ── EMAILED CODES ──────────────────────────────────────────────────────────
async function sendEmailCode(user, resend, purpose = "sign in") {
  const [recent] = await query(
    `SELECT 1 FROM mfa_email_codes WHERE user_id=? AND created_at > NOW() - INTERVAL '45 seconds' LIMIT 1`, [user.id]);
  if (recent) return { sent: false, reason: "too_soon" };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await run(`INSERT INTO mfa_email_codes (id,user_id,code_hash,expires_at) VALUES (?,?,?, NOW() + INTERVAL '${EMAIL_CODE_MINUTES} minutes')`,
    ["mec_" + crypto.randomBytes(8).toString("hex"), user.id, sha(user.id + ":" + code)]);
  // FIX-15 Part 3: what the provider said, so no screen says "we emailed a
  // code" that never left.
  const sent = await mailUser(user, resend, `Your Steward code: ${code}`,
    `Your code to ${purpose} is <strong style="font-size:22px;letter-spacing:0.12em">${code}</strong>. It works for ${EMAIL_CODE_MINUTES} minutes. If you did not just try to ${purpose}, change your password.`);
  return sent ? { sent: true } : { sent: false, reason: "not_delivered" };
}
async function useEmailCode(user, code) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length !== 6) return false;
  const rows = await query(
    `UPDATE mfa_email_codes SET used_at=NOW() WHERE user_id=? AND code_hash=? AND used_at IS NULL AND expires_at > NOW() RETURNING id`,
    [user.id, sha(user.id + ":" + c)]);
  return rows.length > 0;
}

// ── TRUSTED BROWSERS ───────────────────────────────────────────────────────
async function trustBrowser(user, req) {
  const token = crypto.randomBytes(24).toString("base64url");
  await run(`INSERT INTO mfa_trusted_browsers (id,user_id,token_hash,user_agent,expires_at) VALUES (?,?,?,?, NOW() + INTERVAL '${TRUST_DAYS} days')`,
    ["mtb_" + crypto.randomBytes(8).toString("hex"), user.id, sha(user.id + ":" + token),
     String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 400)]);
  return token;
}
async function isTrusted(user, token) {
  if (!token) return false;
  const [r] = await query(`SELECT 1 FROM mfa_trusted_browsers WHERE user_id=? AND token_hash=? AND expires_at > NOW() LIMIT 1`,
    [user.id, sha(user.id + ":" + String(token))]);
  return !!r;
}

// ── LOCKOUT ────────────────────────────────────────────────────────────────
const lockedUntil = user => (user.mfa_locked_until && new Date(user.mfa_locked_until) > new Date()) ? new Date(user.mfa_locked_until) : null;
async function recordFailure(user, resend) {
  const [r] = await query(
    `UPDATE users SET mfa_failed_count = COALESCE(mfa_failed_count,0) + 1 WHERE id=? RETURNING mfa_failed_count`, [user.id]);
  const n = r ? Number(r.mfa_failed_count) : 0;
  if (n >= LOCK_AFTER) {
    await run(`UPDATE users SET mfa_failed_count=0, mfa_locked_until=NOW() + INTERVAL '${LOCK_MINUTES} minutes' WHERE id=?`, [user.id]);
    const mailed = await mailUser(user, resend, "Steward paused sign-in codes on your account",
      `Someone entered ${LOCK_AFTER} wrong two-factor codes for your Steward account. Code entry is paused for ${LOCK_MINUTES} minutes. If it was not you, change your password now; your password alone does not open your account.`);
    return { locked: true, mailed };
  }
  return { locked: false, left: LOCK_AFTER - n };
}
async function clearFailures(user) {
  await run(`UPDATE users SET mfa_failed_count=0, mfa_locked_until=NULL WHERE id=?`, [user.id]);
}

// ── MAIL TO THE PERSON THEMSELVES ──────────────────────────────────────────
// Only ever to the account's own sign-in address, never to a list or a donor,
// and never to an address on the mail block.
async function mailUser(user, resend, subject, sentenceHtml) {
  if (!user || !user.email || isBlockedAddress(user.email)) return false;
  if (!process.env.RESEND_API_KEY || !resend) { console.warn("[2fa] RESEND_API_KEY not set; not sent:", subject); return false; }
  try {
    const out = await resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to: user.email, subject,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:#f0ede6;font-family:Helvetica,Arial,sans-serif;color:#0f1a12">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="100%" style="max-width:520px">
<tr><td style="padding-bottom:20px;text-align:center;font-family:Georgia,serif;font-size:24px;font-weight:700">Steward</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;padding:32px;font-size:15px;line-height:1.6">${sentenceHtml}</td></tr>
<tr><td style="padding-top:16px;text-align:center;font-size:12px;color:#5a554f">Sent to ${user.email} because it is the sign-in address for this Steward account.</td></tr>
</table></td></tr></table></body></html>`,
    });
    // The client answers a refusal with { error }, it does not throw.
    if (out && out.error) { console.error("[2fa] mail refused:", out.error.message); return false; }
    return true;
  } catch (e) { console.error("[2fa] mail failed:", e.message); return false; }
}

module.exports = {
  LOCK_AFTER, LOCK_MINUTES, TRUST_DAYS, EMAIL_CODE_MINUTES, RECOVERY_COUNT, DEMO_SENTENCE,
  isDemoOrg, ipPrefix, describeAgent,
  createSession, issueSession, sessionAlive, revokeSessions,
  makeRecoveryCodes, useRecoveryCode, recoveryLeft, looksLikeRecovery,
  sendEmailCode, useEmailCode, trustBrowser, isTrusted,
  lockedUntil, recordFailure, clearFailures, mailUser,
};
