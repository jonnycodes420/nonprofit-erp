// routes/billing.js — sign-in, platform billing, super-admin and the health check.
//
// FIX-1 split: these routes and the helpers only they use were moved here
// VERBATIM from server.js. Nothing in them changed.
//
// How it is wired, so it behaves exactly as it did inside server.js:
//   * Each router below is mounted in server.js with app.use(...) at the place
//     its first route used to be declared, so it keeps its place in the stack
//     (before or after the same middleware, before or after the same routes).
//   * server.js calls mount() once, at the end of boot, when every binding the
//     code below reads exists. `app` inside mount() is the current router, so
//     the unchanged `app.get(...)` lines register on it.
//   * `__dirname` is server.js's own, so every path built from it resolves as
//     before; a relative require()/import() reads "../x" because it resolves
//     against this file, one folder down (readSource reads it back as "./x").
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
// FIX-4 5 — the price→plan lookup, so the reconcile below names the plan the
// live subscription is actually on rather than trusting a stale column.
const { planFromSubscription } = require("../billingPlans");

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  CLOSE_PLANS, PLAN_LIMITS, PLAN_PRICE_ENV, RECOVERY_SECRET, SYS_AUTO, bcrypt, billingConfigError,
  billingCustomerColumn, billingStripe, billingStripeMode, checkBillingPriceModes, checkPlanLimit,
  checkWebhookSubscriptions, checkoutSessionParams, closePlan, computeTrialEnd, crypto,
  displayNameCase, donorMailDecision, effectivePlanLimits, einLookup, ensureOrgLedger,
  firstChargeSentence, formatChargeDate, getOrgAccessState, inviteeDisplayName, linkEmailToAccounts,
  loginAccountLimiter, loginIpLimiter, mfaVerifyForUser, opsAlert, orgMailGateCache,
  orgMaySendEmail, orgPlanTier, orgTzName, otherBillingMode, passwordResetLimiter,
  processNetworkGate, processTrialReminders, provisionNewOrgWorkflows, publicAppUrl, query,
  reconcileStripeVsGifts, recordTick, registerLimiter, requireAdmin, requireAuth, requireSuperAdmin,
  resend, retryFailedNotifications, run, sampleDataMod, sessionCache, signToken,
  stripeChargesEnabled, unsubscribeEmailFooterHtml, unsubscribeHeaders, uuid, validateCloseLink,
  validateOrgClose, withTransaction, wrap, orgSendingIdentity,
  // GTM-1a — the pricing catalogue, the plan-amount helpers, the click-through
  // agreement and the founder address public signup reports to.
  PRICING, planAmountUsd, planInterval, SELLABLE_CLOSE_PLANS, customerAgreement,
  // GTM-1b — the active-donor count and the over-band notice.
  checkActiveDonorBand,
} = ctx;
let app = routers.r0;
// BUILD-38 Part 1 — kill all of a user's live sessions: stamp sessions_valid_after
// (auth.js rejects any token issued before it) and evict this instance's cache
// entry so revocation is immediate locally (other instances expire within TTL).
// Call on password reset/change, role change, removal, and deactivation. A future
// role-change/removal/deactivation route MUST call this.
async function invalidateUserSessions(userId) {
  await run("UPDATE users SET sessions_valid_after = NOW() WHERE id = ?", [userId]);
  sessionCache.evict(userId);
  // SEC-1 — and the rows, so the session list says what is true.
  await require("../twoFactor").revokeSessions("user_id=?", [userId], "system:sessions-invalidated").catch(() => {});
}

// ── Notification retry (ops/test hook — BUILD-45 / F-2) ────────────────────
// Drives retryFailedNotifications NOW for the caller (drives the exact
// scheduled path; same bar as /pipeline/run-auto-lapse, /workflows/run-sweeps).
// `force` retries due-or-not (for a deterministic test); otherwise honors the
// backoff window.
app.post("/admin/notifications/retry", requireAuth, requireAdmin, wrap(async (req, res) => {
  const result = await retryFailedNotifications({ force: !!(req.body && req.body.force) });
  res.json(result);
}));

// ── Sentry test hook (org-admin-gated) ─────────────────────────────────────
// Fires a deliberate test error down one of the two backend reporting paths:
//   ?mode=route      → throws inside a route handler (Express error handler → Sentry)
//   ?mode=rejection  → fire-and-forget rejected promise (process unhandledRejection → Sentry)
// Used to verify events actually arrive in Sentry — safe to keep: admin-only,
// writes nothing, and each call produces exactly one error event.
app.post("/admin/debug/sentry-test", requireAuth, requireAdmin, wrap(async (req, res) => {
  const mode = req.query.mode || "route";
  if (mode === "rejection") {
    setTimeout(() => { Promise.reject(new Error(`[sentry-test] deliberate unhandledRejection by ${req.user.userId} at ${new Date().toISOString()}`)); }, 10);
    return res.json({ ok: true, fired: "rejection" });
  }
  throw new Error(`[sentry-test] deliberate route error by ${req.user.userId} at ${new Date().toISOString()}`);
}));
app = routers.r1;

// ── Auth ───────────────────────────────────────────────────────────────────
app.post("/auth/login", loginIpLimiter, loginAccountLimiter, wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const users = await query("SELECT * FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (!users.length) return res.status(401).json({ error: "Invalid credentials" });

  const user = users[0];
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // BUILD-75 C.3 — a removed user cannot log in. Same generic message as a
  // wrong password: the login form is not the place to enumerate accounts.
  // BUILD-93 Part 2 — a deactivated account is told so, by name. The generic
  // message was deliberate (the login form is not the place to enumerate
  // accounts), but it only holds for a WRONG PASSWORD: here the password was
  // correct, so nothing is being disclosed that the person did not already
  // prove - and "Invalid credentials" sent somebody who still works there to
  // reset a password that was never the problem.
  if (user.deactivated_at) {
    return res.status(403).json({
      error: "account_deactivated",
      message: "This account has been deactivated. Contact your workspace admin.",
    });
  }

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [user.org_id]);
  const org = orgs[0];
  const isSuperAdmin = !!user.is_super_admin;

  // ── SEC-1 · TWO-FACTOR SIGN-IN ──────────────────────────────────────────
  // Password first (above), then the code. A correct password alone never
  // returns a session for someone with two-factor on: it returns
  // `mfa_required` and no token. The code can be the authenticator's, an
  // emailed one, or a recovery code. Five wrong codes lock code entry for
  // fifteen minutes. A browser she chose to trust skips the code for 30 days.
  const TF = require("../twoFactor");
  const say = (verb, extra = {}) => {
    req.audit.org(user.org_id);
    req.audit.actor({ kind: "user", id: user.id, name: user.name || user.email });
    req.audit.entity("user", user.id, user.email);
    req.audit.action(verb);
    if (Object.keys(extra).length) req.auditLegacyChanges = { ...(req.auditLegacyChanges || {}), ...extra };
  };
  let trustToken = null;
  if (user.mfa_enabled_at) {
    const trusted = await TF.isTrusted(user, req.body.trustToken);
    if (!trusted) {
      const until = TF.lockedUntil(user);
      if (until) return res.status(429).json({ error: "mfa_locked", lockedUntil: until.toISOString(),
        message: `Too many wrong codes. Code entry opens again at ${until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.` });
      const code = String(req.body.code || "").trim();
      if (!code) {
        // FIX-15 Part 3: the sentence follows what actually happened to the code.
        const ec = user.mfa_method === "email" ? await TF.sendEmailCode(user, resend, "sign in") : null;
        return res.status(401).json({ error: "mfa_required", method: user.mfa_method || "totp",
          message: !ec ? "Enter the six-digit code from your authenticator app."
            : ec.sent ? `We emailed a six-digit code to ${user.email}. It works for ${TF.EMAIL_CODE_MINUTES} minutes.`
            : ec.reason === "too_soon" ? `A code went to ${user.email} a moment ago. Use that one; it works for ${TF.EMAIL_CODE_MINUTES} minutes.`
            : `Steward could not email a code to ${user.email} just now. Try again in a minute, or use a recovery code.` });
      }
      let how = null;
      if (TF.looksLikeRecovery(code) && await TF.useRecoveryCode(user, code)) how = "recovery";
      else if (user.mfa_method === "email" ? await TF.useEmailCode(user, code) : (await mfaVerifyForUser(user, code)) !== null) how = "code";
      if (!how) {
        const f = await TF.recordFailure(user, resend);
        if (f.locked) { say("two-factor locked after wrong codes"); return res.status(429).json({ error: "mfa_locked",
          message: `That was the ${TF.LOCK_AFTER}th wrong code. Code entry is paused for ${TF.LOCK_MINUTES} minutes${f.mailed ? ", and we emailed you" : ""}.` }); }
        return res.status(401).json({ error: "mfa_invalid", message: user.mfa_method === "email"
          ? "That code did not match, or it has expired." : "That code did not match. Codes change every 30 seconds." });
      }
      await TF.clearFailures(user);
      if (how === "recovery") {
        const left = await TF.recoveryLeft(user.id);
        say("signed in with a recovery code", { recoveryCodesLeft: left });
        await TF.mailUser(user, resend, "A recovery code was used on your Steward account",
          `Someone signed in to your Steward account with one of your recovery codes. ${left} ${left === 1 ? "code is" : "codes are"} left. If it was not you, change your password and make new codes in Settings, Security.`);
      }
      if (req.body.trustBrowser === true) trustToken = await TF.trustBrowser(user, req);
    }
  } else if (!TF.isDemoOrg(org) && (user.mfa_must_setup || isSuperAdmin || (org && org.require_mfa)
             || (user.role === "admin" && org && org.require_admin_mfa))) {
    // Two-factor is required here and this person has not set it up (or an
    // owner reset it). The session opens ONLY the setup routes (auth.js), so
    // no donor data is reachable until it is done.
    const setupToken = signToken({ userId: user.id, orgId: user.org_id, email: user.email, role: user.role, isSuperAdmin, mfaSetup: true });
    return res.json({ mfaSetupRequired: true, token: setupToken,
      message: isSuperAdmin ? "Super-admin accounts always use two-factor. Set it up to continue."
        : user.mfa_must_setup ? "Your two-factor was reset by an owner. Set it up again to continue."
        : "Your organisation requires two-factor sign-in. Set it up to continue." });
  }

  const { token } = await TF.issueSession(user, req, signToken);
  res.json({ token, trustToken, user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin, mfaEnabled: !!user.mfa_enabled_at }, org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 } });
}));

// SEC-1 — signing out ends THIS session on the server, not only in the browser.
app.post("/auth/logout", requireAuth, wrap(async (req, res) => {
  if (req.user.sid) await require("../twoFactor").revokeSessions("id=? AND user_id=?", [req.user.sid, req.user.userId], req.user.userId);
  req.audit.action("signed out");
  res.json({ ok: true });
}));

app.post("/auth/register", registerLimiter, wrap(async (req, res) => {
  const { email, password, name, orgName, orgMission, ein } = req.body;
  if (!email || !password || !orgName) {
    return res.status(400).json({ error: "Email, password, and org name required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (existing.length) return res.status(409).json({ error: "Email already registered" });

  const orgId = "org_" + uuid().slice(0, 8);
  const userId = "user_" + uuid().slice(0, 8);
  const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + orgId.slice(4, 10);
  // BUILD-90: thirty days from signing, and for a self-serve path signing is
  // the moment the org row is written. `signed_at` is stamped here with the
  // same timestamp the trial end is derived from, so the date can always be
  // re-derived and shown never to have moved.
  const signedAt = new Date();
  const trialEndsAt = computeTrialEnd(signedAt).toISOString();
  // 2026-09-24 — MAIL IS OPT-IN PER ORG, BY A SUPER-ADMIN ONLY. Every org the
  // product creates starts with emails_enabled=false; POST /admin/orgs/:id/
  // email-switch is the one way on.
  await run("INSERT INTO orgs (id, name, mission, ein, onboarding_complete, org_slug, plan, subscription_status, signed_at, trial_ends_at, emails_enabled) VALUES (?,?,?,?,0,?,'trial','trialing',?,?,false)",
    [orgId, orgName, orgMission || "", ein || "", orgSlug, signedAt.toISOString(), trialEndsAt]);
  // BUILD-58 W-3: every org is born with a usable ledger (chart of accounts +
  // General Operating fund) — gift stamps must never no-op on a fresh org.
  await ensureOrgLedger(orgId).catch(e => console.error("[org] ledger provisioning:", e.message));
  const hash = bcrypt.hashSync(password, 12);
  await run("INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, orgId, normalizedEmail, hash, name || email, "admin"]);
  // BUILD-36 A1: new org → instant_gift_thanks ON by default.
  await provisionNewOrgWorkflows(orgId).catch(e => console.error("[org] provision workflows:", e.message));

  const { token } = await require("../twoFactor").issueSession({ id: userId, org_id: orgId, email: normalizedEmail, role: "admin" }, req, signToken);
  res.status(201).json({
    token,
    user: { id: userId, email: normalizedEmail, name: name || email, role: "admin" },
    org: { id: orgId, name: orgName, onboarding_complete: 0 },
  });
}));

// POST /auth/forgot-password — generate reset token and email the user
app.post("/auth/forgot-password", passwordResetLimiter, wrap(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const users = await query("SELECT * FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  // Always return 200 to avoid leaking whether the email exists
  if (!users.length) {
    console.log("[forgot-password] no matching user for submitted email — no email sent");
    return res.json({ success: true });
  }

  const user = users[0];
  const token = crypto.randomBytes(32).toString("hex");
  const id = "prt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL '1 hour')`,
    [id, user.id, token]
  );

  const frontendUrl = publicAppUrl();
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  if (process.env.RESEND_API_KEY) {
    const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
    try {
      const { data, error } = await resend.emails.send({
        from,
        to: user.email,
        subject: "Reset your Steward password",
        html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Header: serif Steward wordmark (no glyph; Georgia stack for email) -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;line-height:1.2;">Reset your password</h1>
          <p style="margin:0 0 28px;font-size:15px;color:#6b7c72;line-height:1.6;">Click the button below to reset your password. This link expires in <strong style="color:#0f1a12;">1 hour</strong>.</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="border-radius:10px;background:#c9a84c;">
              <a href="${resetLink}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#0f1a12;text-decoration:none;letter-spacing:-0.01em;">Reset Password →</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#8fa896;line-height:1.5;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
          <p style="margin:0;font-size:12px;color:#b0b8b2;">Or copy this link: <span style="color:#0f1a12;word-break:break-all;">${resetLink}</span></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding-top:20px;text-align:center;font-size:12px;color:#a0a8a4;">
          Steward · stewardapp.dev
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      });
      if (error) {
        console.error("[forgot-password] resend error:", error);
      } else {
        console.log(`[forgot-password] reset email sent, resend id=${data?.id}`);
      }
    } catch (err) {
      console.error("[forgot-password] email send failed:", err.message);
    }
  } else {
    console.warn("[forgot-password] RESEND_API_KEY not set — reset email not sent");
  }

  res.json({ success: true });
}));

// POST /auth/reset-password — validate token and update password
app.post("/auth/reset-password", passwordResetLimiter, wrap(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const rows = await query(
    `SELECT * FROM password_reset_tokens WHERE token = ? AND used = false AND expires_at > NOW()`,
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: "Invalid or expired reset link" });

  const prt = rows[0];
  const hash = bcrypt.hashSync(password, 12);
  await run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, prt.user_id]);
  // Invalidate this token plus any other outstanding, unused reset tokens for
  // the same user — an old link left in an inbox shouldn't still work after
  // the password has already been changed.
  await run("UPDATE password_reset_tokens SET used = true WHERE user_id = ? AND used = false", [prt.user_id]);
  // BUILD-38 Part 1 — a password reset kills every live session for this user
  // (a stolen/older token must not survive the reset the victim just performed).
  await invalidateUserSessions(prt.user_id);

  res.json({ success: true });
}));

// ── Self-serve org registration (SaaS signup) ──────────────────────────────
app.post("/auth/register-org", registerLimiter, wrap(async (req, res) => {
  // INCIDENT 2026-09-22 — `provisioned: true` is how an org gets created FOR
  // somebody rather than BY them. It is the difference between a signup and a
  // handover, and until tonight the route could not tell them apart: Allie's
  // organisation was provisioned through here and got the self-serve founder
  // drip in her inbox eight hours before anyone intended to contact her.
  //
  // A provisioned org is born with mail OFF and marked as fiction, because at
  // the moment of creation its data is invented and its owner has not agreed
  // to hear from us. Turning it on is a deliberate, separate act (PATCH
  // /orgs/:id) performed once the real data is in and she has signed in.
  //
  // The flag is deliberately NOT permission-gated. Its only effect is to make
  // the resulting org quieter and more clearly marked, so the worst a caller
  // can do by passing it is create an org that sends nothing — which is not a
  // capability worth a guard, and a guard here would be one more thing to get
  // wrong on the night somebody needs to provision in a hurry.
  const { orgName, userName, email, password, provisioned, demoData } = req.body;
  const isProvisioned = provisioned === true;
  // CKRH-1 — "CREATED FOR SOMEBODY" AND "FULL OF FICTION" ARE TWO DIFFERENT
  // FACTS, and this route conflated them because the org that prompted the
  // flag happened to be both. `is_demo_org` is not a quiet bookkeeping bit: it
  // puts a NON-DISMISSIBLE banner across the top of every screen reading "This
  // is a demonstration organisation. Everything in it is invented." On a real
  // customer's first sign-in that sentence is simply false, and it is the first
  // thing she would read after her welcome.
  //
  // So it stays the default for a provisioned org — the flag exists because
  // provisioning usually means invented data, and defaulting the other way
  // would silently un-mark every future demo — but a caller that KNOWS the org
  // holds nothing invented can say so. Mail is off either way: `emails_enabled`
  // is false for every new org regardless, so this changes what she is TOLD,
  // never what is sent.
  const isDemoData = demoData === undefined ? isProvisioned : demoData === true;
  if (!orgName || !userName || !email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (existing.length) return res.status(409).json({ error: "An account with that email already exists" });

  const orgId  = "org_"  + uuid().slice(0, 8);
  const userId = "user_" + uuid().slice(0, 8);
  const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + orgId.slice(4, 10);
  // BUILD-90: thirty days from signing, full stop (trialEnd.js). This legacy
  // self-serve route is no longer reachable from the UI — /signup redirects to
  // the invitation request and the close link is the real door — but while it
  // is mounted it must produce the SAME billing date as every other path.
  const signedAt = new Date();
  const trialEndsAt = computeTrialEnd(signedAt).toISOString();

  // CKRH-1 — A PROVISIONED ORG HAS ALREADY BEEN ONBOARDED, BY THE PERSON
  // PROVISIONING IT. The wizard exists to collect the org's name, mission,
  // timezone and first funds; a handover arrives with every one of those
  // already filled in from the customer's own website, so sending her through
  // it would ask her to retype what is on the screen behind it — and, worse,
  // `POST /onboarding/complete` calls `seedOrgData`, which would put invented
  // donors and gifts into a REAL organisation's account. The first-run
  // greeting is what a provisioned org opens on instead, which is the whole
  // point of arming it. A self-serve signup is unchanged and still onboards.
  await run(
    `INSERT INTO orgs (id, name, onboarding_complete, org_slug, plan, subscription_status,
                       signed_at, trial_ends_at, emails_enabled, is_demo_org)
     VALUES (?,?,?,?,'trial','trialing',?,?,?,?)`,
    // 2026-09-24 — mail OFF for every new org (opt-in, super-admin only);
    // `provisioned` still marks the org as fiction.
    [orgId, orgName, isProvisioned ? 1 : 0, orgSlug, signedAt.toISOString(), trialEndsAt,
     false, isDemoData]
  );
  // BUILD-58 W-3: every org is born with a usable ledger.
  await ensureOrgLedger(orgId).catch(e => console.error("[org] ledger provisioning:", e.message));
  const hash = bcrypt.hashSync(password, 12);
  await run(
    // BUILD-94 FIRST RUN — welcomed_at NULL, explicitly. The column DEFAULTS to
    // NOW() ("already welcomed" is the safe default, because the greeting is a
    // full-screen takeover and a NULL-means-greet column would throw one in
    // front of every existing user and every test fixture). THIS is the one
    // path where somebody is genuinely arriving for the first time, so it opts
    // into the greeting by name.
    "INSERT INTO users (id, org_id, email, password_hash, name, role, welcomed_at) VALUES (?,?,?,?,?,?,NULL)",
    [userId, orgId, normalizedEmail, hash, userName, "admin"]
  );

  let stripeCustomerId = null;
  if (billingStripe) {
    try {
      const customer = await billingStripe.customers.create({
        email: normalizedEmail,
        name: orgName,
        metadata: { orgId },
      });
      stripeCustomerId = customer.id;
      // Persist to the column for the current billing mode (test vs live) so it
      // isn't reused cross-mode later — see ensureStripeCustomer.
      await run(`UPDATE orgs SET ${billingCustomerColumn()}=? WHERE id=?`, [stripeCustomerId, orgId]);
    } catch (err) {
      console.error("Stripe customer creation failed:", err.message);
    }
  }

  // BUILD-36 A1: a new org hears about gifts out of the box (instant_gift_thanks
  // ON, ED & assigned officer). Existing orgs are never re-created, so untouched.
  await provisionNewOrgWorkflows(orgId).catch(e => console.error("[org] provision workflows:", e.message));

  const { token } = await require("../twoFactor").issueSession({ id: userId, org_id: orgId, email: normalizedEmail, role: "admin" }, req, signToken);
  res.status(201).json({
    token,
    user: { id: userId, email: normalizedEmail, name: userName, role: "admin" },
    org: { id: orgId, name: orgName, onboarding_complete: 0, plan: "trial", subscription_status: "trialing", trial_ends_at: trialEndsAt },
    stripeCustomerId,
  });
  // MAIL-1 (Jonathan, 4 Oct 2026): no onboarding sequence, for any signup.
  // Jonathan writes and sends onboarding himself, so nothing is queued here.
  console.log(`[mail-policy] org ${orgId} created; no onboarding sequence (off for good, MAIL-1)` +
    (isProvisioned ? (isDemoData ? ", provisioned as a demonstration org" : ", provisioned (REAL org, holds no invented data)") : ""));
}));

// ── Invite ─────────────────────────────────────────────────────────────────
app.post("/auth/invite", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  // VOL-1 — three roles now. A volunteer coordinator sees volunteers and
  // hours and not giving; the boundary is enforced in auth.js, not here.
  const validRole = ["admin", "volunteer_coordinator"].includes(role) ? role : "staff";
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (existing.length) return res.status(409).json({ error: "A user with that email already exists" });

  // Seat limit: count active users + pending unexpired invites
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const seatCheck = await checkPlanLimit(orgForLimit[0], "seats");
    // FIX-10 F — "unlimited" is one answer, in shared/seats.js. The literal
    // 999999999 was spelled here as well as in PLAN_LIMITS, so the two could
    // drift and a plan that sells unlimited users could start counting seats.
    const { seatsAreUnlimited, SEAT_REFUSED_SENTENCE } = await import("../shared/seats.js");
    if (!seatCheck.isTrial && !seatsAreUnlimited(seatCheck.limit)) {
      const pendingRow = await query(
        "SELECT COUNT(*) AS c FROM invites WHERE org_id=? AND accepted_at IS NULL AND expires_at > NOW()",
        [req.user.orgId]
      );
      const totalWithPending = seatCheck.current + Number(pendingRow[0]?.c || 0);
      if (totalWithPending >= seatCheck.limit) {
        return res.status(403).json({ error: "seat_limit", message: SEAT_REFUSED_SENTENCE, current: totalWithPending, limit: seatCheck.limit, plan: orgForLimit[0].plan, isTrial: false });
      }
    }
  }

  const token = uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
  const id = "inv_" + uuid().slice(0, 8);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await run(
    `INSERT INTO invites (id, org_id, email, token, role, invited_by, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.user.orgId, normalizedEmail, token, validRole, req.user.userId, expiresAt]
  );

  const inviteLink = `${publicAppUrl()}/invite/${token}`;

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];

  // Send invite via Resend HTTP API
  let emailSent = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const from = process.env.DEMO_SMTP_FROM || "onboarding@resend.dev";
      const { error } = await resend.emails.send({
        from,
        to: normalizedEmail,
        subject: `You've been invited to join ${displayNameCase(org.name)} on Steward`,
        html: `<p>You've been invited to join <strong>${displayNameCase(org.name)}</strong> on Steward as a <strong>${validRole}</strong>.</p>
               <p><a href="${inviteLink}" style="background:#c9a84c;color:#0f1a12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Accept Invitation</a></p>
               <p>This link expires in 7 days.</p>`,
      });
      if (error) throw new Error(error.message);
      emailSent = true;
    } catch (err) {
      console.error("Invite email send failed:", err.message);
    }
  }

  // Return the invite id/email/derived name so the caller (e.g. the import
  // officer-mapping screen) can make the newly-invited officer immediately
  // selectable + assignable as PENDING, without re-running the import.
  res.json({ success: true, inviteLink, emailSent, id, email: normalizedEmail, name: inviteeDisplayName(normalizedEmail) });
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

  const existing = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [invite.email]);
  if (existing.length) return res.status(409).json({ error: "An account with this email already exists" });

  const userId = "user_" + uuid().slice(0, 8);
  const hash = bcrypt.hashSync(password, 12);
  await run(
    "INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, invite.org_id, invite.email, hash, name, invite.role]
  );
  await run("UPDATE invites SET accepted_at = NOW() WHERE id = ?", [invite.id]);

  // Resolve any donors an import routed to this (previously pending) officer —
  // their portfolio is populated the moment they log in (the magic moment for a
  // new gift officer). assigned_to fills in → they're in this officer's portfolio
  // AND on their pipeline board (assignment IS membership, BUILD-30), and the
  // pending pointer clears. Matched by EMAIL across every invite for this address
  // in the org (org-scoped) — so donors held against an earlier invite that
  // expired and was re-sent are still claimed, nothing orphans.
  const claimed = await run(
    `UPDATE donors
        SET assigned_to = ?, assigned_to_name = ?,
            pending_assignee_invite_id = NULL, pending_assignee_name = NULL
      WHERE org_id = ?
        AND pending_assignee_invite_id IN (
          SELECT id FROM invites WHERE org_id = ? AND lower(email) = lower(?)
        )`,
    [userId, name, invite.org_id, invite.org_id, invite.email]
  );
  if (claimed?.changes) console.log(`[invite-accept] populated ${claimed.changes} donor(s) into ${invite.email}'s portfolio`);

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [invite.org_id]);
  const org = orgs[0];
  const { token: jwtToken } = await require("../twoFactor").issueSession({ id: userId, org_id: invite.org_id, email: invite.email, role: invite.role }, req, signToken);
  res.status(201).json({
    token: jwtToken,
    user: { id: userId, email: invite.email, name, role: invite.role },
    org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 },
  });
}));
function clearOrgMailGate(orgId) {
  if (orgId) orgMailGateCache.delete(orgId); else orgMailGateCache.clear();
}

// Addresses that cannot reach a real person — RFC 2606's reserved names, which
// publish no MX. Everything else is a real mailbox somewhere, which is the
// whole point of the check.
//
// It lives in shared/reservedDomains.js rather than here because
// tests/email-links.test.js bans the LOOPBACK HOSTNAME from server.js
// OUTRIGHT -- no exception list, because the moment a guard grows one it stops
// being checkable. The predicate legitimately has to name that hostname, so it
// went somewhere it can. (And this comment deliberately does not write it
// either: a guard that greps source must strip comments first, or the file
// explaining why a string was removed fails the rule it documents -- a trap
// this repo has already paid for twice.)
let _reservedDomains = null;
async function reservedDomains() {
  return _reservedDomains || (_reservedDomains = await import("../shared/reservedDomains.js"));
}

// The alert the incident would have tripped on 10 September: a demo org sent
// mail to a real mailbox provider. Run on a tick rather than in the send path,
// so a slow check can never delay or break a send.
async function checkDemoOrgSends() {
  const rows = await query(
    `SELECT e.org_id, o.name AS org_name, e.recipient_domain, COUNT(*)::int AS n
       FROM email_log e JOIN orgs o ON o.id = e.org_id
      WHERE e.created_at >= NOW() - INTERVAL '1 hour'
        AND e.status = 'sent'
        AND (o.is_demo_org = TRUE OR o.emails_enabled = FALSE)
      GROUP BY e.org_id, o.name, e.recipient_domain`);
  const { reachesARealMailbox } = await reservedDomains();
  const bad = rows.filter(r => r.recipient_domain && reachesARealMailbox(r.recipient_domain));
  if (!bad.length) return "clean";
  await opsAlert("demo_org_send",
    `A demo organisation sent mail to a real address`,
    bad.map(b => `${b.org_name} (${b.org_id}) sent ${b.n} to ${b.recipient_domain}`).join("; "));
  return `ALERTED: ${bad.length}`;
}

// THE PAGE. One route, super-admin only, four sections, all reads.
app.get("/admin/observability", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [emails, ticks, sources, agent, demoSends] = await Promise.all([
    // Every outbound email in the last 7 days: org, recipient DOMAIN, template
    // and status. Never the address.
    query(`SELECT e.id, e.org_id, o.name AS org_name, o.is_demo_org, o.emails_enabled,
                  e.recipient_domain, e.kind, e.subject, e.status, e.error, e.created_at
             FROM email_log e LEFT JOIN orgs o ON o.id = e.org_id
            WHERE e.created_at >= NOW() - INTERVAL '7 days'
            ORDER BY e.created_at DESC LIMIT 500`),
    // Every background tick with its last run and result.
    query(`SELECT DISTINCT ON (name) name, started_at, finished_at, ok, detail, error
             FROM tick_log ORDER BY name, started_at DESC`),
    // Every giving-source sync with rows read and errors.
    query(`SELECT gs.id, gs.org_id, o.name AS org_name, gs.provider, gs.status,
                  gs.last_synced_at, gs.last_error
             FROM giving_sources gs LEFT JOIN orgs o ON o.id = gs.org_id
            ORDER BY gs.last_synced_at DESC NULLS LAST LIMIT 200`).catch(() => []),
    // Every agent run with proposals made and withheld.
    query(`SELECT r.id, r.org_id, o.name AS org_name, r.started_at, r.status,
                  r.drafted, r.sent, r.declined, r.withheld, r.withheld_reason, r.error
             FROM agent_runs r LEFT JOIN orgs o ON o.id = r.org_id
            WHERE r.started_at >= NOW() - INTERVAL '7 days'
            ORDER BY r.started_at DESC LIMIT 200`).catch(() => []),
    query(`SELECT COUNT(*)::int AS n FROM email_log e JOIN orgs o ON o.id = e.org_id
            WHERE e.created_at >= NOW() - INTERVAL '7 days' AND e.status='sent'
              AND (o.is_demo_org = TRUE OR o.emails_enabled = FALSE)`),
  ]);

  // THE ONE LINE THAT WOULD HAVE ENDED THE INCIDENT ON DAY ONE.
  const { reachesARealMailbox } = await reservedDomains();
  const realProviderFromDemo = emails.filter(e =>
    e.status === "sent" && e.recipient_domain && reachesARealMailbox(e.recipient_domain)
    && (e.is_demo_org === true || e.emails_enabled === false));

  res.json({
    window: "7 days",
    emails,
    // Counted separately so it is a HEADLINE, not a row somebody has to spot.
    alarm: {
      demoOrgRealSends: realProviderFromDemo.length,
      demoOrgSendsAny: (demoSends && demoSends[0] && demoSends[0].n) || 0,
      failedTicks: ticks.filter(t => t.ok === false).map(t => t.name),
      sourceErrors: (sources || []).filter(x => x.last_error).map(x => x.id),
      sentence: realProviderFromDemo.length
        ? `${realProviderFromDemo.length} message${realProviderFromDemo.length === 1 ? "" : "s"} ` +
          `reached a real mailbox provider from an organisation marked as demonstration data.`
        : "",
    },
    ticks, sources, agentRuns: agent,
    // What the alert would do, and to whom, stated rather than assumed.
    alerting: { to: process.env.FOUNDER_EMAIL || null,
                configured: !!process.env.FOUNDER_EMAIL,
                triggers: ["a demo org sending to a real address", "a background tick failing", "a 5xx burst"] },
  });
}));

// Drives the demo-org check now, for ops and for the suite.
app.post("/admin/observability/run-checks", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const demo = await recordTick("demo-org-send-check", checkDemoOrgSends);
  res.json({ ok: true, demo });
}));

// MAIL-1: the founder onboarding drip that lived here is gone. Jonathan writes
// and sends onboarding himself; see mailPolicy.js.
// Ops/test hook (super-admin — the guard reads across every org's connected
// account, so it is a platform operation, not an org-scoped one). Returns the
// full divergence detail so a human can act: charge id, account, amount, age.
app.post("/admin/reconcile/run", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const result = await reconcileStripeVsGifts();
  res.json(result);
}));
// BUILD-63 Part 2 — on-demand manifest-vs-live-subscription diff (super-admin).
// Returns the full per-endpoint diff (missing/extra event types) so Jonathan can
// fix the subscription list in one pass. Read-only.
app.post("/admin/webhook-subscriptions/check", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const result = await checkWebhookSubscriptions();
  res.json(result);
}));

// What /billing/status reports. Reads the stored value; never blocks the page
// on Stripe. Null is an honest answer — the UI says "your card on file".
function billingCardLast4(org) {
  return org && org.billing_card_last4 ? String(org.billing_card_last4) : null;
}

// Returns the org's billing customer id for the current Stripe MODE, creating
// and persisting one on the fly if missing (e.g. legacy /auth/register orgs, a
// silently-failed signup creation, or the first checkout after switching the
// billing key to a new mode). Self-heals: if the stored id belongs to the other
// mode or was deleted, Stripe rejects it with `resource_missing` and we mint a
// fresh customer in the current mode. Returns null only if the org doesn't exist.
async function ensureStripeCustomer(orgId, email) {
  const col = billingCustomerColumn();
  const orgs = await query(`SELECT name, ${col} AS customer_id FROM orgs WHERE id=?`, [orgId]);
  if (!orgs.length) return null;

  let stored = orgs[0].customer_id;
  if (stored) {
    try {
      const existing = await billingStripe.customers.retrieve(stored);
      if (!existing.deleted) return stored;   // deleted:true → fall through, re-create
    } catch (err) {
      // Cross-mode reuse ("a similar object exists in live mode…") and deleted
      // customers both surface as resource_missing — re-create for this mode.
      if (err && (err.code === "resource_missing" || err.statusCode === 404)) stored = null;
      else throw err;
    }
  }

  const customer = await billingStripe.customers.create({ email, name: orgs[0].name, metadata: { orgId } });
  await run(`UPDATE orgs SET ${col}=? WHERE id=?`, [customer.id, orgId]);
  return customer.id;
}

app.get("/admin/billing-diagnostic", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const status = await checkBillingPriceModes();
  res.json({
    billingConfigured: !!billingStripe,
    ...status,
    hint: status.ok === false
      ? "The billing key and price IDs are in different Stripe modes. Align them (all test or all live)."
      : undefined,
  });
}));

// "Nov 6", in the org's zone. A malformed zone falls back, never throws.
function shortChargeDate(at, tz) {
  const opts = { month: "short", day: "numeric" };
  try { return new Date(at).toLocaleDateString("en-US", { ...opts, timeZone: tz || "America/New_York" }); }
  catch { return new Date(at).toLocaleDateString("en-US", { ...opts, timeZone: "America/New_York" }); }
}

app.get("/billing/status", requireAuth, wrap(async (req, res) => {
  const orgs = await query("SELECT plan, subscription_status, trial_ends_at, signed_at, stripe_customer_id, stripe_customer_id_test, stripe_subscription_id, grace_until, current_period_end, billing_card_brand, billing_card_last4 FROM orgs WHERE id=?", [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = orgs[0];
  const plan = org.plan || "trial";
  const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000)) : null;
  const isTrial = (org.subscription_status || "trialing") === "trialing";
  const trialCanceledNow = ["canceled", "cancelled"].includes(org.subscription_status || "")
    && !!trialEndsAt && trialEndsAt.getTime() > Date.now();
  // BUILD-90 90b — Settings shows THE SAME DATE the reminder email shows and
  // the same one Checkout showed, because all three build the sentence from
  // this one field through closeLink.js. No phone call required to cancel:
  // the button beside it posts to /billing/cancel.
  const planPrice = closePlan(plan);
  const tz = await orgTzName(req.user.orgId);
  const firstChargeSentenceText = isTrial && trialEndsAt && planPrice
    ? firstChargeSentence({ monthlyUsd: planPrice.monthlyUsd, firstChargeAt: trialEndsAt, tz })
    : null;

  const [[seatRow], [recordRow]] = await Promise.all([
    query("SELECT COUNT(*) AS c FROM users WHERE org_id=?", [req.user.orgId]),
    query("SELECT COUNT(*) AS c FROM donors WHERE org_id=? AND deleted_at IS NULL", [req.user.orgId]),
  ]);

  res.json({
    plan,
    subscriptionStatus: org.subscription_status || "trialing",
    trialEndsAt: org.trial_ends_at,
    trialDaysLeft,
    graceUntil: org.grace_until,
    currentPeriodEnd: org.current_period_end,
    accessState: getOrgAccessState(org),
    limits: effectivePlanLimits(org),
    planLimits: PLAN_LIMITS[plan] || PLAN_LIMITS.core,
    planTier: orgPlanTier(org),
    usage: { seats: Number(seatRow?.c) || 0, records: Number(recordRow?.c) || 0 },
    isTrial,
    // Whether there's a REAL Stripe subscription behind the plan. A plan set by a
    // manual/super-admin grant (e.g. flagged Team) has no stripe_subscription_id →
    // the Customer Portal would open EMPTY. The UI uses this to explain that
    // in-app instead of sending the admin to a blank portal (BUILD-31 Part 1).
    hasSubscription: !!org.stripe_subscription_id,
    // BUILD-90 90b — the date, the amount, and whether cancelling costs nothing.
    signedAt: org.signed_at,
    monthlyUsd: planPrice ? planPrice.monthlyUsd : null,
    firstChargeAt: isTrial ? org.trial_ends_at : null,
    firstChargeSentence: firstChargeSentenceText,
    // Before the first charge, cancelling means paying nothing. After it, the
    // subscription runs to the end of the month already paid for.
    cancelIsFree: isTrial,
    canCancel: !!org.stripe_subscription_id && !["canceled"].includes(org.subscription_status || ""),
    cardLast4: billingCardLast4(org),
    cardBrand: org.billing_card_brand || null,
    // FIX-32: cancelled inside the free thirty days. The org keeps everything
    // until the trial's own end date and is never charged; the one offer is
    // "Keep Steward", a new Checkout on the same plan ending on the same date.
    trialCanceled: trialCanceledNow,
    trialCanceledSentence: trialCanceledNow
      ? `Your trial ends ${shortChargeDate(trialEndsAt, tz)} and you won't be charged.`
      : null,
  });
}));

// Turn a thrown Stripe error on a billing path into a typed, actionable HTTP
// response instead of a raw 500. Returns true if it handled the error (response
// sent); false if it's not a billing-config error and should bubble up. The UI
// shows a clean admin-facing message; Stripe internals are logged, never sent.
function handleBillingConfigError(err, res, { plan, surface } = {}) {
  const cls = billingConfigError(err);
  if (!cls) return false;
  const mode = billingStripeMode();
  const envName = plan ? PLAN_PRICE_ENV[plan] : null;
  if (cls.type === "mode_mismatch") {
    const other = otherBillingMode(mode);
    // Loud, specific server log naming which mode the key is in vs the price.
    console.error(
      `[billing] MODE MISMATCH on ${surface}: billing key is ${String(mode).toUpperCase()} ` +
      `but ${envName || "the configured price"} is a ${String(other).toUpperCase()} price. ` +
      `Align STRIPE_BILLING_SECRET_KEY and the STRIPE_PRICE_* ids (and the Stripe Customer ` +
      `Portal config) to the SAME mode. Stripe said: ${err && err.message}`
    );
    res.status(400).json({
      error: "plan_mode_mismatch",
      message: "Billing isn't configured correctly — the Stripe key and price IDs are in different modes (test vs live). Ask your Steward admin to align them.",
    });
    return true;
  }
  // A configured price id that doesn't resolve in this mode (typo/deleted) —
  // still a config problem, surfaced as "not configured for this mode", not a 500.
  console.error(
    `[billing] PRICE NOT FOUND on ${surface}: ${envName || "the configured price"} did not resolve ` +
    `under the ${String(mode).toUpperCase()} billing key. Check the id. Stripe said: ${err && err.message}`
  );
  res.status(400).json({
    error: "plan_not_configured",
    message: "Billing isn't configured correctly — a plan's Stripe price ID couldn't be found. Ask your Steward admin to check it.",
  });
  return true;
}

app.post("/billing/create-checkout", requireAuth, requireAdmin, wrap(async (req, res) => {
  let { plan } = req.body;
  // FIX-32: "Keep Steward" after a cancel inside the trial: the plan is the
  // one the org signed up for, read from its close link, never a choice. (A
  // subscription that ended used to rewrite orgs.plan to 'core', so the org
  // row alone cannot be trusted for an org that cancelled before this fix.)
  if (req.body && req.body.keep === true) {
    const [kept] = await query(
      `SELECT o.plan, cl.plan AS link_plan FROM orgs o LEFT JOIN close_links cl ON cl.id = o.close_link_id WHERE o.id=?`,
      [req.user.orgId]);
    plan = (kept && (kept.link_plan || kept.plan)) || plan;
  }
  // Live commercial model (BUILD-24). `founding` is the private $99 founding-
  // partner price — off-menu, super-admin only, never in the public UI. Legacy
  // seed/growth/impact stay mapped so a pre-cutover org can still reactivate on
  // its old price if that env is still set.
  const priceMap = {
    core:     process.env.STRIPE_PRICE_CORE,
    team:     process.env.STRIPE_PRICE_TEAM,
    founding: process.env.STRIPE_PRICE_FOUNDING,
    seed:     process.env.STRIPE_PRICE_SEED,
    growth:   process.env.STRIPE_PRICE_GROWTH,
    impact:   process.env.STRIPE_PRICE_IMPACT,
  };
  // GTM-1a — the six tier prices, monthly and yearly. Built from the
  // catalogue, so the plan the pricing page offers is the plan this route can
  // sell, always. The INTERNAL $1 price is deliberately absent: it is not in
  // TIERS, so it cannot be named here by anyone, super-admin included. The one
  // door to it is POST /admin/orgs/:id/internal-test-price.
  for (const t of PRICING.TIERS) {
    priceMap[`${t.id}_monthly`] = process.env[t.envMonthly];
    priceMap[`${t.id}_yearly`] = process.env[t.envYearly];
  }
  // Validation ordered BEFORE any Stripe API call so it's testable without keys.
  if (!(plan in priceMap)) return res.status(400).json({ error: "Invalid plan.", message: `Plan must be one of: ${Object.keys(priceMap).join(", ")}.` });
  if (plan === "founding" && !req.user.isSuperAdmin) {
    return res.status(403).json({ error: "founding_forbidden", message: "The founding-partner plan is assigned privately." });
  }
  const priceId = priceMap[plan];
  if (!priceId) return res.status(400).json({ error: "plan_not_configured", message: `No Stripe price is configured for the ${plan} plan yet.` });

  if (!billingStripe) return res.status(503).json({ error: "Stripe not configured" });
  try {
    const customerId = await ensureStripeCustomer(req.user.orgId, req.user.email);
    if (!customerId) return res.status(404).json({ error: "Org not found" });

    // BUILD-50 item 1: the Stripe subscription's trial_end MUST match what the app
    // shows. An org that picks a plan while still inside the free period (through
    // 2026-12-31) must not be charged until that free period ends, or an eager
    // early checkout would silently break the public "Free through Dec 31, 2026"
    // promise. So carry the org's app-level trial_ends_at onto the subscription as
    // Stripe's trial_end. (This sets a trial on the SUBSCRIPTION only — it does
    // NOT change any Stripe product or price object, so it's a code change, not a
    // money-configuration change.) If the trial is already past, bill immediately.
    const orgRows = await query("SELECT trial_ends_at FROM orgs WHERE id=?", [req.user.orgId]);
    const trialEndsAtMs = orgRows[0] && orgRows[0].trial_ends_at ? new Date(orgRows[0].trial_ends_at).getTime() : null;
    const trialEndSec = trialEndsAtMs ? Math.floor(trialEndsAtMs / 1000) : null;
    const subData = { metadata: { orgId: req.user.orgId, plan } };
    // Stripe requires trial_end strictly in the future; guard with a small margin.
    if (trialEndSec && trialEndSec > Math.floor(Date.now() / 1000) + 60) subData.trial_end = trialEndSec;

    // GTM-1b 4 — A FOUNDING ORG KEEPS ITS $50 OFF, WHICHEVER BAND IT MOVES
    // TO. The discount is a coupon rather than a price precisely so it
    // survives this moment: an org that outgrows the first band would
    // otherwise lose the thing it was promised on the day it grew.
    const [orgForDiscount] = await query("SELECT founding_partner, plan FROM orgs WHERE id=?", [req.user.orgId]);
    const isFounding = !!(orgForDiscount && (orgForDiscount.founding_partner || orgForDiscount.plan === "founding"));

    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: publicAppUrl() + "/dashboard?subscribed=true",
      cancel_url:  publicAppUrl() + "/pricing",
      metadata: { orgId: req.user.orgId, plan, ...(isFounding ? { foundingDiscount: "1" } : {}) },
      subscription_data: subData,
      customer: customerId,
      ...(isFounding ? { discounts: [{ coupon: PRICING.FOUNDING_COUPON.couponId }] } : {}),
    };
    if (isFounding) console.log(`[billing] ${req.user.orgId} is a founding partner — applying coupon ${PRICING.FOUNDING_COUPON.couponId} to ${plan}`);

    const session = await billingStripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    // A test-key + live-price (or vice-versa) mismatch must never surface as a
    // raw 500 — return a typed, actionable error instead. Anything else re-throws.
    if (handleBillingConfigError(err, res, { plan, surface: "create-checkout" })) return;
    throw err;
  }
}));

app.post("/billing/create-portal", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!billingStripe) return res.status(503).json({ error: "Stripe not configured" });
  try {
    const customerId = await ensureStripeCustomer(req.user.orgId, req.user.email);
    if (!customerId) return res.status(404).json({ error: "Org not found" });
    const session = await billingStripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: publicAppUrl() + "/dashboard",
    });
    res.json({ url: session.url });
  } catch (err) {
    // The Customer Portal must be configured in the SAME Stripe mode as the key;
    // a mode mismatch or an unconfigured portal comes back as a config error, not a 500.
    if (handleBillingConfigError(err, res, { surface: "create-portal" })) return;
    // Stripe throws a distinct invalid_request when the portal itself isn't set
    // up for this mode ("No configuration provided…"). Surface it cleanly too.
    const msg = String((err && err.message) || "");
    if (/portal|configuration/i.test(msg) && (err.type === "StripeInvalidRequestError" || err.statusCode === 400)) {
      console.error(`[billing] Customer Portal not configured for the ${String(billingStripeMode()).toUpperCase()} mode: ${msg}`);
      return res.status(400).json({
        error: "portal_not_configured",
        message: "The billing portal isn't set up yet — ask your Steward admin to configure the Stripe Customer Portal.",
      });
    }
    throw err;
  }
}));

// POST /admin/close-links — mint one. Super-admin only.
app.post("/admin/close-links", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  // TWO WAYS IN, ONE PATH THROUGH.
  //
  // `orgId` in the body means the customer is ALREADY an organisation in
  // Steward and this link only has to attach a subscription to it. Everything
  // after this block - the price check, the Checkout session, the row, the
  // thirty-day sentence - is identical for both, because a second close path
  // is a second set of rules about what a close is.
  //
  // The email-in-use refusal below is the reason this exists. It is correct for
  // a NEW org (a close link mints the first admin, and users.email is globally
  // unique), and it was the only thing standing between the console and an org
  // that already has an account. Here no user is created, so there is nothing
  // to collide with, and the check is deliberately NOT applied.
  const targetOrgId = String((req.body || {}).orgId || "").trim();
  let orgName, contactEmail, plan, targetOrg = null;

  if (targetOrgId) {
    const v = validateOrgClose(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error, message: v.message });
    plan = v.plan;

    const orgRows = await query(
      `SELECT id, name, plan, subscription_status, stripe_subscription_id,
              ${billingCustomerColumn()} AS billing_customer_id
         FROM orgs WHERE id=?`, [v.orgId]);
    if (!orgRows.length) return res.status(404).json({ error: "org_not_found", message: "That organization does not exist." });
    targetOrg = orgRows[0];
    orgName = targetOrg.name;

    // Already paying is not a thing to do twice. A second live subscription on
    // the same org bills the customer twice and neither side notices until an
    // invoice lands, so this refuses and names the plan they are already on.
    if (targetOrg.stripe_subscription_id) {
      return res.status(409).json({
        error: "already_subscribed",
        message: `${targetOrg.name} already has a Stripe subscription (${targetOrg.plan || "unknown plan"}). `
               + `Cancel it from Settings, Billing before closing them again.`,
      });
    }

    // AND NOT TWICE. Two open links against one org both complete into two
    // Stripe subscriptions; the second overwrites the first on the org row and
    // the first goes on billing the customer with nothing in Steward pointing
    // at it. The already_subscribed check above cannot see this one, because
    // neither link has been walked yet.
    const openAlready = await query(
      `SELECT id, plan, created_at FROM close_links
        WHERE target_org_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`, [v.orgId]);
    if (openAlready.length) {
      return res.status(409).json({
        error: "close_link_open",
        message: `${targetOrg.name} already has an open close link on ${openAlready[0].plan}. `
               + `Use that link, or let it be walked, before raising another.`,
        existingLinkId: openAlready[0].id,
      });
    }

    // The link goes to a person, and for an existing org that person is its
    // admin. Read it rather than let it be typed: an address typed here that
    // does not match the org is how somebody ends up owning an organisation
    // they have never seen.
    const admins = await query(
      `SELECT email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL
        ORDER BY created_at ASC LIMIT 1`, [v.orgId]);
    if (!admins.length) {
      return res.status(409).json({
        error: "no_active_admin",
        message: `${targetOrg.name} has no active admin to send the link to. Invite one first.`,
      });
    }
    contactEmail = String(admins[0].email).trim().toLowerCase();
  } else {
    const v = validateCloseLink(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error, message: v.message });
    ({ orgName, contactEmail, plan } = v);

    const clash = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [contactEmail]);
    if (clash.length) {
      // Name WHICH org holds it, and whether that account is still usable. The
      // bare refusal sent somebody to the database to find out.
      const holder = await query(
        `SELECT u.deactivated_at, o.id AS org_id, o.name AS org_name
           FROM users u LEFT JOIN orgs o ON o.id = u.org_id
          WHERE lower(u.email) = lower(btrim(?)) LIMIT 1`, [contactEmail]);
      const h = holder[0] || {};
      const where = h.org_name ? `"${h.org_name}"` : "an organization";
      const message = h.deactivated_at
        ? `That email belongs to a removed user of ${where}. Removing a user does not free the address - delete that organization to reuse it, or use a different email.`
        : `That email is already the ${where} account. To put an existing organization on a plan, close it from Organizations instead of minting a new link.`;
      return res.status(409).json({
        error: "email_in_use", message,
        orgId: h.org_id || null, orgName: h.org_name || null, removedUser: !!h.deactivated_at,
      });
    }
  }

  const priceId = process.env[plan.env];
  if (!priceId) {
    return res.status(400).json({
      error: "plan_not_configured",
      message: `No Stripe price is configured for the ${plan.name} plan yet (${plan.env}).`,
    });
  }
  if (!billingStripe) return res.status(503).json({ error: "Stripe not configured" });

  // THE PRICE ON THE PAGE MUST BE THE PRICE IN STRIPE.
  // A configured price id is not enough. Production already carried live price
  // ids from BUILD-24's retired lower set, so "configured" was true and the
  // amounts were wrong: Checkout would have read the sentence closeLink.js
  // composes while Stripe charged the retired amount. That is precisely the
  // contradiction between the contract and the product this build exists to
  // remove, so the amount is CHECKED against Stripe before a link is ever
  // minted, and a mismatch names both numbers rather than failing quietly.
  // (The retired figures are deliberately not written here: a dead price in a
  // comment is a dead price somebody copies — tests/invitation-only.test.js
  // bans them from this file, comments included.)
  try {
    const price = await billingStripe.prices.retrieve(priceId);
    const expected = planAmountUsd(plan) * 100;
    const wantInterval = planInterval(plan);
    const monthly = price.recurring && price.recurring.interval === wantInterval && price.recurring.interval_count === 1;
    if (price.unit_amount !== expected || price.currency !== "usd" || !monthly) {
      const actual = price.unit_amount != null ? `$${(price.unit_amount / 100).toFixed(2)} ${String(price.currency).toUpperCase()}` : "an unreadable amount";
      const cadence = price.recurring ? `every ${price.recurring.interval_count || 1} ${price.recurring.interval}` : "not recurring";
      console.error(
        `[close-link] PRICE MISMATCH: ${plan.env} (${priceId}) is ${actual}, ${cadence}, ` +
        `but the ${plan.name} plan is $${planAmountUsd(plan)} every ${planInterval(plan)}. Refusing to mint a link that would ` +
        `quote one number and charge another. Run scripts/create-billing-products.js and update ${plan.env}.`
      );
      return res.status(400).json({
        error: "plan_price_mismatch",
        message: `${plan.env} points at a Stripe price of ${actual} ${cadence}, but ${plan.name} is $${planAmountUsd(plan)} every ${planInterval(plan)}. `
               + `Create the price at the right amount and update ${plan.env} before closing anyone.`,
      });
    }
  } catch (err) {
    if (handleBillingConfigError(err, res, { plan: plan.id, surface: "close-link price check" })) return;
    throw err;
  }

  const closeLinkId = "cl_" + uuid().slice(0, 8);
  const signin = mintSigninKey();
  const params = checkoutSessionParams({
    plan, orgName, contactEmail, closeLinkId, priceId,
    // An org that already exists keeps the Stripe customer it already has, so
    // one organisation has one customer and one billing history. A new-org
    // link has neither yet and Checkout mints them.
    customerId: targetOrg ? (targetOrg.billing_customer_id || null) : null,
    targetOrgId: targetOrg ? targetOrg.id : null,
    // FIX-32: a NEW org's link lands her signed in. An existing org already
    // has its admin and her password, so that link still lands on sign-in.
    successUrl: targetOrg ? publicAppUrl() + "/login?welcome=1" : signinSuccessUrl(signin.key),
    cancelUrl: publicAppUrl() + "/pricing",
  });

  try {
    const session = await billingStripe.checkout.sessions.create(params);
    await run(
      `INSERT INTO close_links (id, org_name, contact_email, plan, stripe_session_id, checkout_url, created_by, created_by_name, target_org_id, signin_key_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [closeLinkId, orgName, contactEmail, plan.id, session.id, session.url, req.user.userId, req.user.email, targetOrg ? targetOrg.id : null,
       targetOrg ? null : signin.hash]
    );
    console.log(`[close-link] ${closeLinkId} created for ${orgName} (${contactEmail}) on ${plan.id} by ${req.user.email}`
      + (targetOrg ? ` - EXISTING org ${targetOrg.id}` : ""));
    res.status(201).json({
      id: closeLinkId,
      url: session.url,
      orgName, contactEmail,
      targetOrgId: targetOrg ? targetOrg.id : null,
      existingOrg: !!targetOrg,
      plan: plan.id,
      planName: plan.name,
      monthlyUsd: plan.monthlyUsd,
      firstChargeAt: computeTrialEnd(Date.now()).toISOString(),
      notice: params.custom_text.submit.message,
    });
  } catch (err) {
    if (handleBillingConfigError(err, res, { plan: plan.id, surface: "close-link" })) return;
    throw err;
  }
}));

// ── GTM-1b 1 · WHAT THE PRODUCT SAYS ABOUT YOUR BAND ──────────────────────
// One read, for the banner and for Settings → Billing. It does NOT recount on
// every call: the count is taken after an import (the thing that changes it)
// and stored with the notice, so opening a page cannot be an expensive scan
// of every gift in the org. `recount=1` takes a fresh one on purpose, for the
// admin who has just deleted a pile of records and wants the answer now.
app.get("/billing/donor-band", requireAuth, wrap(async (req, res) => {
  const [org] = await query(
    `SELECT id, plan, tier_notice_band, tier_notice_at, tier_notice_effective_at,
            tier_notice_count, tier_notice_dismissed_at
       FROM orgs WHERE id=?`, [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "org_not_found" });

  if (req.query.recount === "1") {
    const fresh = await checkActiveDonorBand(req.user.orgId, { send: false });
    return res.json({ ...fresh, sentence: PRICING.ACTIVE_DONOR_SENTENCE, recounted: true });
  }

  const band = PRICING.tierById(String(org.plan || "").split("_")[0]);
  const next = org.tier_notice_band ? PRICING.tierById(org.tier_notice_band) : null;
  res.json({
    plan: org.plan,
    // FIX-4 6 — the plan has a NAME, and the donor count goes under it.
    planName: PRICING.planDisplayName(org.plan),
    band: band ? { id: band.id, name: band.name, label: band.band, maxDonors: band.maxDonors } : null,
    sentence: PRICING.ACTIVE_DONOR_SENTENCE,
    notice: org.tier_notice_band ? {
      nextBand: org.tier_notice_band,
      nextBandName: next ? next.name : PRICING.TALK_TO_US.name,
      nextBandLabel: next ? next.band : PRICING.TALK_TO_US.band,
      nextMonthlyUsd: next ? next.monthlyUsd : null,
      nextYearlyUsd: next ? next.yearlyUsd : null,
      count: org.tier_notice_count,
      noticedAt: org.tier_notice_at,
      effectiveAt: org.tier_notice_effective_at,
      dismissedAt: org.tier_notice_dismissed_at,
    } : null,
  });
}));

// Dismissing the banner hides the BANNER. It does not withdraw the notice, it
// does not move the date, and the sentence stays in Settings → Billing — a
// price change somebody has been told about cannot be un-told by closing a
// card. A POST, because it changes state.
app.post("/billing/donor-band/dismiss", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run(`UPDATE orgs SET tier_notice_dismissed_at=NOW() WHERE id=? AND tier_notice_band IS NOT NULL`,
    [req.user.orgId]);
  res.json({ ok: true });
}));

// ── GTM-1a 1-5 · PUBLIC SIGNUP, AND IT IS A CLOSE LINK ────────────────────
//
// Signup was closed in BUILD-87 because the form contradicted the product it
// signed you up for: a price that no longer existed, a self-serve door the
// product had shut, and a promise nothing kept. It reopens here with the
// opposite property — it is the SAME path a close link takes. Same
// `close_links` row, same Stripe Checkout, same thirty days from signing, same
// seven-day reminder, same two-click cancel, same webhook that mints the org.
// There is exactly one way an organisation comes into being, and this is a
// second person allowed to press the button on it.
//
// WHAT THIS ROUTE DOES NOT DO: create anything. No org, no user, no Stripe
// customer. It writes a close_links row and a terms_acceptances row and hands
// back a Checkout URL. Someone who opens the page and never pays has left two
// rows saying so, which is a record of interest, not an organisation.

// The public catalogue. Served rather than baked into the bundle so a price
// can be corrected without a frontend deploy, and so the page and the route
// that takes the money are reading the same list on the same day.
app.get("/public/pricing", wrap(async (req, res) => {
  const agr = customerAgreement.agreement();
  res.json({
    tiers: PRICING.TIERS.map(t => ({
      id: t.id, band: t.band, maxDonors: t.maxDonors,
      monthlyUsd: t.monthlyUsd, yearlyUsd: t.yearlyUsd,
    })),
    talkToUs: PRICING.TALK_TO_US,
    included: PRICING.INCLUDED,
    termsStrip: PRICING.TERMS_STRIP,
    yearlyNote: PRICING.YEARLY_NOTE,
    activeDonorSentence: PRICING.ACTIVE_DONOR_SENTENCE,
    agreement: { version: agr.version, sha256: agr.sha256, available: !!agr.ok },
  });
}));

// The agreement itself, as markdown, so the signup page renders the exact
// words it is about to record an acceptance of. A GET, and it writes nothing.
app.get("/public/agreement", wrap(async (req, res) => {
  const agr = customerAgreement.agreement();
  if (!agr.ok) return res.status(503).json({ error: agr.error, message: agr.message });
  res.json({ version: agr.version, sha256: agr.sha256, markdown: agr.text });
}));

// ── FIX-32 · CHECKOUT SIGNS HER IN ─────────────────────────────────────────
// After paying she used to land on /login with no password. Now the success
// URL carries a one-time key (only its sha256 is stored). The page trades it,
// together with Stripe's {CHECKOUT_SESSION_ID}, for a session. Neither half is
// trusted alone: the key must hash to the close link's, the session id must be
// that link's, Stripe must say the session is complete, and the key is spent
// on first use and dies SIGNIN_KEY_HOURS after the link was made.
const SIGNIN_KEY_HOURS = 24;
function mintSigninKey() {
  const key = crypto.randomBytes(24).toString("base64url");
  return { key, hash: crypto.createHash("sha256").update(key).digest("hex") };
}
function signinSuccessUrl(key) {
  // Stripe substitutes {CHECKOUT_SESSION_ID} itself; it must stay unencoded.
  return publicAppUrl() + "/signed-up?session_id={CHECKOUT_SESSION_ID}&k=" + encodeURIComponent(key);
}
async function checkoutSigninLink(b) {
  const sessionId = String(b.sessionId || "").trim(), key = String(b.key || "").trim();
  if (!sessionId || !key) return null;
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const rows = await query(
    `SELECT * FROM close_links WHERE stripe_session_id=? AND signin_key_hash=? AND target_org_id IS NULL
        AND created_at > NOW() - (? * INTERVAL '1 hour')`, [sessionId, hash, SIGNIN_KEY_HOURS]);
  return rows[0] || null;
}
const CHECKOUT_SIGNIN_BAD = { error: "signin_link_invalid",
  message: "This sign-in link has expired or was already used. We can email you a fresh one." };

// POST /public/checkout-signin { sessionId, key }
//   200 { token, user, org }       signed in, once
//   202 { status:"pending", orgName }  Stripe has the card, the org is still being made
//   410 signin_link_invalid        wrong, expired or already spent
app.post("/public/checkout-signin", registerLimiter, wrap(async (req, res) => {
  const link = await checkoutSigninLink(req.body || {});
  if (!link) return res.status(410).json(CHECKOUT_SIGNIN_BAD);
  if (link.signin_used_at) return res.status(410).json({ ...CHECKOUT_SIGNIN_BAD, orgName: link.org_name });
  if (!billingStripe) return res.status(503).json({ error: "stripe_not_configured", message: "Checkout is not available right now." });
  // Stripe is the witness that this browser finished paying for THIS link.
  let session;
  try { session = await billingStripe.checkout.sessions.retrieve(link.stripe_session_id); }
  catch (e) {
    console.error("[checkout-signin] could not read the Checkout session:", e.message);
    return res.status(202).json({ status: "pending", orgName: link.org_name });
  }
  if (!session || session.status !== "complete" || session.metadata?.closeLinkId !== link.id) {
    return res.status(202).json({ status: "pending", orgName: link.org_name });
  }
  if (!link.org_id) return res.status(202).json({ status: "pending", orgName: link.org_name });
  const users = await query(
    `SELECT * FROM users WHERE org_id=? AND lower(email)=lower(btrim(?)) AND deactivated_at IS NULL`,
    [link.org_id, link.contact_email]);
  if (!users.length) return res.status(202).json({ status: "pending", orgName: link.org_name });
  const user = users[0];
  if (user.mfa_enabled_at || user.is_super_admin) {
    // Never a way round two-step: that person signs in at the front door.
    return res.status(410).json({ ...CHECKOUT_SIGNIN_BAD, orgName: link.org_name });
  }
  // Spent here, atomically: two tabs racing get one session between them.
  const spent = await query(
    `UPDATE close_links SET signin_used_at=NOW() WHERE id=? AND signin_used_at IS NULL RETURNING id`, [link.id]);
  if (!spent.length) return res.status(410).json({ ...CHECKOUT_SIGNIN_BAD, orgName: link.org_name });
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [user.org_id]);
  req.audit.org(user.org_id);
  req.audit.actor({ kind: "user", id: user.id, name: user.name || user.email });
  req.audit.entity("user", user.id, user.email);
  req.audit.action("signed in after Checkout");
  const { token } = await require("../twoFactor").issueSession(user, req, signToken);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: false, mfaEnabled: false },
    org: { ...org, onboarding_complete: org.onboarding_complete ?? 0 },
  });
}));

// POST /public/checkout-signin/email { sessionId, key }: the fallback when the
// page gave up waiting. Sends the same set-your-password link the welcome
// email carries, to the address on the close link and nowhere else.
app.post("/public/checkout-signin/email", passwordResetLimiter, wrap(async (req, res) => {
  const link = await checkoutSigninLink(req.body || {});
  if (!link) return res.status(410).json(CHECKOUT_SIGNIN_BAD);
  const masked = String(link.contact_email).replace(/^(.).*(@.*)$/, "$1***$2");
  if (!link.org_id) {
    // The welcome email goes out the moment the org exists; nothing to add.
    return res.json({ ok: true, sent: false, to: masked,
      message: `We will email ${masked} a sign-in link as soon as ${link.org_name} is ready.` });
  }
  const [user] = await query(`SELECT id, email FROM users WHERE org_id=? AND lower(email)=lower(btrim(?))`,
    [link.org_id, link.contact_email]);
  if (!user) return res.json({ ok: true, sent: false, to: masked,
    message: `We will email ${masked} a sign-in link as soon as ${link.org_name} is ready.` });
  const mail = await sendSigninLinkEmail(user);
  res.json({ ok: true, sent: mail.sent, to: masked,
    message: mail.sent ? `We emailed a sign-in link to ${masked}.`
      : `We could not send email just now. Use "Forgot password" on the sign-in page with ${masked}.` });
}));

async function sendSigninLinkEmail(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await run(`INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL '1 hour')`,
    ["prt_" + uuid().slice(0, 8), user.id, token]);
  const link = `${publicAppUrl()}/reset-password?token=${token}`;
  if (!process.env.RESEND_API_KEY) {
    console.error(`[checkout-signin] MAIL IS NOT CONFIGURED (RESEND_API_KEY unset): the sign-in link for ${user.email} was NOT sent.`);
    return { sent: false };
  }
  try {
    const { error } = await resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev", to: user.email,
      subject: "Your Steward sign-in link",
      html: `<div style="font-family:Georgia,serif;font-size:15px;color:#0f1a12;line-height:1.7">`
        + `<p>Set your password to sign in to Steward. This link works for one hour.</p>`
        + `<p><a href="${link}" style="color:#0D5C3A">Set your password</a></p></div>`,
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  } catch (e) {
    console.error("[checkout-signin] sign-in email failed:", e.message);
    return { sent: false };
  }
}

const SIGNUP_ACTOR_ID = "system:public-signup";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/public/signup", registerLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const orgName = String(b.orgName || "").trim();
  const contactName = String(b.contactName || "").trim();
  const contactEmail = String(b.contactEmail || "").trim().toLowerCase();
  const interval = String(b.interval || "monthly").trim();
  const estimateRaw = b.estimatedDonors;

  if (!orgName) return res.status(400).json({ error: "org_name_required", message: "Your organization's name is required." });
  if (!contactName) return res.status(400).json({ error: "contact_name_required", message: "Your name is required — it goes on the agreement." });
  if (!EMAIL_SHAPE.test(contactEmail)) return res.status(400).json({ error: "contact_email_invalid", message: "A valid email address is required." });
  if (!PRICING.BILLING_INTERVALS.includes(interval))
    return res.status(400).json({ error: "interval_invalid", message: "Choose monthly or yearly." });

  const estimate = Number(estimateRaw);
  if (!Number.isFinite(estimate) || estimate < 0 || !Number.isInteger(estimate))
    return res.status(400).json({ error: "estimate_required", message: `How many active donors do you work? ${PRICING.ACTIVE_DONOR_SENTENCE}` });

  // ABOVE THE TOP BAND THERE IS NO PRICE. Selling the biggest tier to an org
  // that is larger than it is quoting a number that is wrong on the day it is
  // quoted, so this is a refusal with a door, not a fallback.
  const tier = PRICING.tierForDonorCount(estimate);
  if (!tier) {
    return res.status(409).json({
      error: "talk_to_us",
      message: `${PRICING.TALK_TO_US.band} is a conversation, not a checkout. Write to ${process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev"} and we will size it with you.`,
      band: PRICING.TALK_TO_US.band,
    });
  }

  // ── THE AGREEMENT ────────────────────────────────────────────────────────
  // Accepting is explicit and it names a VERSION. A page left open across a
  // deploy would otherwise record an acceptance of words that are no longer
  // the words; this refuses and tells the visitor to reload, which costs one
  // click and is the difference between evidence and a guess.
  const agr = customerAgreement.agreement();
  if (!agr.ok) return res.status(503).json({ error: agr.error, message: agr.message });
  if (b.acceptTerms !== true)
    return res.status(400).json({ error: "terms_not_accepted", message: "You have to accept the customer agreement to continue." });
  if (String(b.termsVersion || "") !== agr.version) {
    return res.status(409).json({
      error: "terms_version_stale",
      message: "The customer agreement was updated while this page was open. Reload and read the current one before accepting.",
      currentVersion: agr.version,
    });
  }

  // The same refusal the close link gives, for the same reason: users.email is
  // globally unique and this path mints the first admin.
  const clash = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [contactEmail]);
  if (clash.length) {
    return res.status(409).json({
      error: "email_in_use",
      message: "That email already has a Steward account. Sign in instead, or use a different address.",
    });
  }

  const plan = closePlan(`${tier.id}_${interval}`);
  if (!plan) return res.status(500).json({ error: "plan_missing", message: "That band is not configured. Nothing has been created." });

  const priceId = process.env[plan.env];
  if (!priceId) {
    // Said plainly to the visitor and LOUDLY in the log: a band on the public
    // page with no Stripe price behind it is a page selling something that
    // cannot be bought, and the founder needs to know within the minute.
    console.error(`[signup] ${plan.env} is not set — the public page offers ${tier.band} ${interval} and Checkout cannot be started.`);
    return res.status(503).json({
      error: "plan_not_configured",
      message: "That plan is not available to buy online yet. Write to us and we will set it up by hand — nothing has been created.",
    });
  }
  if (!billingStripe) return res.status(503).json({ error: "stripe_not_configured", message: "Checkout is not available right now. Nothing has been created." });

  // THE PRICE ON THE PAGE MUST BE THE PRICE IN STRIPE — the BUILD-90 rule,
  // applied to a door that is now open to the public rather than held by
  // Jonathan. A mismatch here would quote one number on the page and charge
  // another on the card.
  try {
    const price = await billingStripe.prices.retrieve(priceId);
    const expected = planAmountUsd(plan) * 100;
    const wantInterval = planInterval(plan);
    const cadenceOk = price.recurring && price.recurring.interval === wantInterval && (price.recurring.interval_count || 1) === 1;
    if (price.unit_amount !== expected || price.currency !== "usd" || !cadenceOk) {
      console.error(`[signup] PRICE MISMATCH: ${plan.env} (${priceId}) is ${price.unit_amount} ${price.currency}, `
        + `but ${plan.name} is $${planAmountUsd(plan)} every ${wantInterval}. Refusing to sell it.`);
      return res.status(503).json({
        error: "plan_price_mismatch",
        message: "We cannot take a card for that plan right now. Write to us — nothing has been created.",
      });
    }
  } catch (err) {
    if (handleBillingConfigError(err, res, { plan: plan.id, surface: "public signup price check" })) return;
    throw err;
  }

  const closeLinkId = "cl_" + uuid().slice(0, 8);
  // FIX-32: after Checkout she lands signed in, on onboarding. This used to
  // be /login?welcome=1: she paid and was handed a password form for an
  // account whose password she had never set.
  const signin = mintSigninKey();
  const params = checkoutSessionParams({
    plan, orgName, contactEmail, closeLinkId, priceId,
    successUrl: signinSuccessUrl(signin.key),
    cancelUrl: publicAppUrl() + "/pricing",
  });

  let session;
  try {
    session = await billingStripe.checkout.sessions.create(params);
  } catch (err) {
    if (handleBillingConfigError(err, res, { plan: plan.id, surface: "public signup" })) return;
    throw err;
  }

  await run(
    `INSERT INTO close_links (id, org_name, contact_email, contact_name, plan, stripe_session_id, checkout_url,
                              created_by, created_by_name, signup_source, estimated_donors, billing_interval, signin_key_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [closeLinkId, orgName, contactEmail, contactName, plan.id, session.id, session.url,
     SIGNUP_ACTOR_ID, contactName, "public", estimate, interval, signin.hash]
  );

  // The acceptance is written BEFORE the card, deliberately. She read the
  // words and ticked the box; whether Stripe then succeeds is a separate fact,
  // and losing the acceptance because a card was declined would lose the only
  // evidence of the one thing she actually did.
  await run(
    `INSERT INTO terms_acceptances (id, close_link_id, email, name, doc_version, doc_sha256, ip, user_agent)
     VALUES (?,?,?,?,?,?,?,?)`,
    ["ta_" + uuid().slice(0, 10), closeLinkId, contactEmail, contactName, agr.version, agr.sha256,
     String(req.ip || "").slice(0, 60), String(req.get("user-agent") || "").slice(0, 300)]
  );

  console.log(`[signup] ${closeLinkId} — ${orgName} (${contactEmail}) chose ${plan.id}, ${estimate} active donors, `
    + `agreement ${agr.version}`);

  // EVERY SIGNUP REACHES JONATHAN. Not a digest, not a dedupe: one message per
  // signup, because two organisations starting in the same hour is exactly the
  // case a deduped alert would hide.
  notifyFounderOfSignup({ closeLinkId, orgName, contactName, contactEmail, plan, estimate, interval,
                          agreementVersion: agr.version })
    .catch(e => console.error("[signup] founder notification failed:", e.message));

  res.status(201).json({
    url: session.url,
    tier: tier.id, band: tier.band, interval,
    amountUsd: planAmountUsd(plan),
    firstChargeAt: computeTrialEnd(Date.now()).toISOString(),
    notice: params.custom_text.submit.message,
    agreementVersion: agr.version,
  });
}));

// One message, to the founder, per signup. Not `opsAlert`: that dedupes by
// kind and hour, which is right for an incident and wrong here — a second
// organisation signing up in the same hour is news, not a repeat.
async function notifyFounderOfSignup({ closeLinkId, orgName, contactName, contactEmail, plan, estimate, interval, agreementVersion }) {
  const to = process.env.FOUNDER_EMAIL;
  if (!to) { console.warn("[signup] FOUNDER_EMAIL is not set — nobody was told about", closeLinkId); return; }
  if (!process.env.RESEND_API_KEY) { console.warn("[signup] RESEND_API_KEY not set — founder not told about", closeLinkId); return; }
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  const lines = [
    `${orgName}`,
    `${contactName} · ${contactEmail}`,
    `${plan.name} · ${interval} · $${planAmountUsd(plan)}`,
    `They said about ${estimate.toLocaleString("en-US")} active donors.`,
    `Agreement ${agreementVersion} accepted.`,
    `Close link ${closeLinkId}. Nothing exists until they finish Checkout.`,
  ];
  await resend.emails.send({
    from, to, replyTo: to,
    subject: `New Steward signup — ${orgName}`,
    html: `<div style="font-family:Georgia,serif;font-size:15px;color:#0f1a12;line-height:1.7">`
      + lines.map(l => `<div>${String(l).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</div>`).join("")
      + `</div>`,
  });
}

// ── FIX-4 5 · PUT THE SUBSCRIPTION BACK ON THE ORG ────────────────────────
// A signup through Start now takes a card, and Stripe creates a TRIALING
// subscription the moment Checkout completes. The org learns about it from
// one webhook (`checkout.session.completed` → provisionOrgFromCloseLink). If
// that event is not delivered — the endpoint was down, the event type was
// not subscribed, the delivery was dropped — the money side of Stripe is
// perfectly correct and Steward's copy of it is blank, and everything that
// reads `orgs.stripe_subscription_id` then refuses: the Customer Portal, the
// cancel button, the seven-day reminder, and the $1 test, which is the one
// that says so out loud.
//
// Stripe is the record. This reads it back and writes what is true:
//   1. the close link that created this org already stored the subscription
//      id — the cheapest and most certain answer;
//   2. failing that, the org's Stripe CUSTOMER, whose live subscriptions
//      Stripe will list.
//
// It never CREATES a subscription and never charges anything. If Stripe has
// none, it says so and changes nothing, because an org with no subscription
// is a real state and inventing one would be worse than reporting it.
app.post("/admin/orgs/:id/reconcile-subscription", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  if (!billingStripe) return res.status(503).json({ error: "stripe_not_configured", message: "Platform billing is not configured, so there is nothing to read back from Stripe." });
  const [org] = await query(
    `SELECT id, name, plan, subscription_status, stripe_subscription_id, close_link_id,
            stripe_customer_id, stripe_customer_id_test FROM orgs WHERE id=?`, [req.params.id]);
  if (!org) return res.status(404).json({ error: "org_not_found", message: "That organization does not exist." });
  if (org.stripe_subscription_id) {
    return res.json({ ok: true, changed: false, subscriptionId: org.stripe_subscription_id,
      message: `${org.name} already has a Stripe subscription on file. Nothing was changed.` });
  }

  // 1 — the close link that created this org.
  let subId = null, found = "";
  if (org.close_link_id) {
    const [cl] = await query("SELECT stripe_subscription_id FROM close_links WHERE id=?", [org.close_link_id]);
    if (cl && cl.stripe_subscription_id) { subId = cl.stripe_subscription_id; found = "the close link it signed up through"; }
  }
  if (!subId) {
    const [cl] = await query("SELECT stripe_subscription_id FROM close_links WHERE org_id=? AND stripe_subscription_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1", [org.id]);
    if (cl && cl.stripe_subscription_id) { subId = cl.stripe_subscription_id; found = "the close link it signed up through"; }
  }

  // 2 — Stripe itself, through the customer.
  const customerId = org.stripe_customer_id || org.stripe_customer_id_test || null;
  if (!subId && customerId) {
    try {
      const list = await billingStripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      // The live one, and only a live one: a cancelled subscription is not a
      // subscription to put back, it is history.
      const live = (list?.data || []).find(s => ["trialing", "active", "past_due", "unpaid"].includes(s.status));
      if (live) { subId = live.id; found = "Stripe, on this organization's customer"; }
    } catch (err) {
      if (handleBillingConfigError(err, res, { plan: org.plan, surface: "subscription reconcile" })) return;
      throw err;
    }
  }

  if (!subId) {
    return res.status(409).json({
      error: "no_subscription_in_stripe",
      message: `Stripe has no live subscription for ${org.name}${customerId ? "" : ", and no Stripe customer is on file for it either"}. `
        + `Nothing was changed. Close them onto a plan, or have them sign up through Start now.`,
    });
  }

  const sub = await billingStripe.subscriptions.retrieve(subId);
  const priceId = sub?.items?.data?.[0]?.price?.id || null;
  const plan = planFromSubscription(sub) || org.plan || null;
  const status = sub.status === "trialing" ? "trialing"
    : ["active"].includes(sub.status) ? "active"
    : ["past_due", "unpaid"].includes(sub.status) ? "past_due"
    : sub.status === "canceled" ? "cancelled" : org.subscription_status;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const cust = typeof sub.customer === "string" ? sub.customer : sub.customer?.id || customerId;

  await run(
    `UPDATE orgs SET stripe_subscription_id=?, subscription_status=?, plan=COALESCE(?, plan),
            trial_ends_at=COALESCE(?, trial_ends_at), current_period_end=COALESCE(?, current_period_end),
            ${billingCustomerColumn()}=COALESCE(?, ${billingCustomerColumn()})
      WHERE id=?`,
    [subId, status, plan, trialEnd, periodEnd, cust, org.id]);
  // The card, so the seven-day reminder can name it. Best effort: a missing
  // card is a worse reminder, never a failed reconcile.
  try {
    const full = await billingStripe.subscriptions.retrieve(subId, { expand: ["default_payment_method"] });
    const pm = full && full.default_payment_method;
    if (pm && pm.card) await run("UPDATE orgs SET billing_card_brand=?, billing_card_last4=? WHERE id=?", [pm.card.brand, pm.card.last4, org.id]);
  } catch { /* the reminder degrades; the reconcile does not */ }
  console.log(`[reconcile-subscription] ${org.id} (${org.name}) <- ${subId} (${sub.status}, price ${priceId}) via ${found}, by ${req.user.email}`);

  res.json({ ok: true, changed: true, subscriptionId: subId, status, plan,
    trialEndsAt: trialEnd, foundVia: found,
    message: `${org.name} is on ${PRICING.planDisplayName(plan) || plan || "a plan"}, ${status}. `
      + `Steward read the subscription back from ${found} and saved it. Nothing was charged.` });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  LOST & FOUND · THE ONLY TWO THINGS THAT REACH A SERVER
// ═══════════════════════════════════════════════════════════════════════════
//
// The audit runs in the visitor's browser and the donor file never leaves
// it. These two routes are the COMPLETE list of what Lost & Found sends,
// and both of them are written to be read at a glance:
//
//   POST /lost-and-found/lead       three fields the visitor typed, plus ?ref=
//                                   (Book a demo adds two: orgSize, currentSystem)
//   POST /lost-and-found/benchmark  four aggregate numbers, opt-in
//
// Neither accepts anything else. Every field is picked OUT of the body by
// name — never a spread, never a whitelist filter over an object somebody
// else built — so a page that started sending more would find the extra
// silently dropped rather than quietly stored.

const LF_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/lost-and-found/lead", registerLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 200);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const organization = String(b.organization || "").trim().slice(0, 200);
  const ref = String(b.ref || "").trim().slice(0, 120) || null;
  // FIX-13 · Book a demo's two extra answers. Optional, picked out by name
  // like the rest, and stored as the words she chose.
  const orgSize = String(b.orgSize || "").trim().slice(0, 60) || null;
  const currentSystem = String(b.currentSystem || "").trim().slice(0, 300) || null;
  const isDemo = ref === "book-a-demo";

  if (!name) return res.status(400).json({ error: "name_required", message: "Your name, so we know who to write back to." });
  if (!LF_EMAIL.test(email)) return res.status(400).json({ error: "email_invalid", message: "A working email address, so we can send the report." });
  if (!organization) return res.status(400).json({ error: "org_required", message: "Your organization's name." });

  const id = "lf_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO lost_and_found_leads (id, name, email, organization, ref, org_size, current_system, user_agent, ip)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, email, organization, ref, orgSize, currentSystem,
     String(req.get("user-agent") || "").slice(0, 300), String(req.ip || "").slice(0, 60)]);

  // Jonathan hears about every one. Not a digest: a nonprofit running a
  // donor audit at 11pm is somebody to write to in the morning, and a
  // deduped alert would hide the second one.
  const to = process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev";
  if (to && process.env.RESEND_API_KEY) {
    resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev", to, replyTo: email,
      // FIX-13: a demo request is named one, in the subject and the body.
      // It used to arrive as "Lost & Found", which read as an audit download.
      subject: isDemo ? `Demo request: ${organization}` : `Lost & Found: ${organization}`,
      html: `<div style="font-family:Georgia,serif;font-size:15px;color:#0f1a12;line-height:1.7">`
        + (isDemo
          ? [`Demo request from ${organization}`, `${name} · ${email}`,
             `Active donors: ${orgSize || "not given"}`, `Where their donors are today: ${currentSystem || "not given"}`,
             "Source: book-a-demo. They asked for a demo on stewardapp.dev/demo. Reply to pick a time."]
          : [organization, `${name} · ${email}`, ref ? `Came from: ${ref}` : "No referrer.",
             "They ran the audit and downloaded the report. Their donor file never reached us."])
            .map(l => `<div>${String(l).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</div>`).join("")
        + `</div>`,
    }).catch(e => console.error("[lost-and-found] founder notification failed:", e.message));
  } else {
    console.warn("[lost-and-found] FOUNDER_EMAIL or RESEND_API_KEY unset — nobody was told about", id);
  }
  console.log(`[lost-and-found] lead ${id} — ${organization} (${email})${ref ? ` via ${ref}` : ""}`);
  res.status(201).json({ ok: true, id,
    message: isDemo ? "Thank you. Jonathan will email you within one business day to pick a time."
      : "Thank you. Your report is downloading, and nothing about your donors left your computer." });
}));

// THE BENCHMARK. Four numbers, and the route REFUSES anything that is not
// one of them rather than ignoring it: a page that started sending a fifth
// field should fail loudly here, in a test, not succeed quietly in
// production. `donorBand` is a band and not a count, because a count plus a
// city is a fingerprint.
const LF_BANDS = new Set(["under 250", "250 to 1,000", "1,000 to 5,000", "5,000 to 25,000", "more than 25,000"]);
const LF_BENCH_KEYS = ["donorBand", "retentionPct", "shareLapsedPct", "shareDriftingPct"];

app.post("/lost-and-found/benchmark", registerLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const extra = Object.keys(b).filter(k => !LF_BENCH_KEYS.includes(k));
  if (extra.length) {
    console.error(`[lost-and-found] benchmark REFUSED: it carried ${extra.join(", ")}, which is not one of the four aggregates.`);
    return res.status(400).json({ error: "unexpected_fields",
      message: "The benchmark takes four aggregate numbers and nothing else." });
  }
  if (!LF_BANDS.has(String(b.donorBand || ""))) {
    return res.status(400).json({ error: "band_invalid", message: "That is not a donor band." });
  }
  const pct = v => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  };
  const id = "lfb_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO lost_and_found_benchmarks (id, donor_band, retention_pct, share_lapsed_pct, share_drifting_pct)
     VALUES (?,?,?,?,?)`,
    [id, String(b.donorBand), pct(b.retentionPct), pct(b.shareLapsedPct), pct(b.shareDriftingPct)]);
  res.status(201).json({ ok: true,
    message: "Added to the benchmark. Four numbers, no names." });
}));

// The leads, for the super admin. Newest first, with the referrer, because
// the one question Jonathan asks this list is "who came from where".
app.get("/admin/lost-and-found", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const leads = await query(
    `SELECT id, name, email, organization, ref, org_size, current_system, created_at FROM lost_and_found_leads
      ORDER BY created_at DESC LIMIT 500`, []);
  const byRef = await query(
    `SELECT COALESCE(ref, 'direct') AS ref, COUNT(*)::int AS n FROM lost_and_found_leads
      GROUP BY 1 ORDER BY 2 DESC`, []);
  const bench = await query(
    `SELECT donor_band, COUNT(*)::int AS n,
            ROUND(AVG(retention_pct))::int AS retention,
            ROUND(AVG(share_lapsed_pct))::int AS lapsed,
            ROUND(AVG(share_drifting_pct))::int AS drifting
       FROM lost_and_found_benchmarks GROUP BY 1 ORDER BY 1`, []);
  res.json({
    leads, byRef, benchmarks: bench,
    sentence: leads.length
      ? `${leads.length} ${leads.length === 1 ? "person has" : "people have"} downloaded a Lost & Found report.`
      : "Nobody has downloaded a report yet.",
    note: "A lead is the three fields they typed. No donor file, and nothing derived from one, ever reaches this server.",
  });
}));

// ── GTM-1a 4 · THE $1 PRICE, AND THE ONE DOOR TO IT ───────────────────────
// It is never public: it is not in `TIERS`, so nothing that renders the
// pricing page or reads a signup body can name it, and `validateCloseLink`
// refuses it by name so a close link cannot sell it either. This is the only
// way onto it, it is super-admin only, and it moves an org that ALREADY
// EXISTS — it never creates one.
//
// It is for one thing: proving a live charge end to end with real money that
// is one dollar. The guard is tests/gtm1a-internal-price.test.js.
app.post("/admin/orgs/:id/internal-test-price", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const priceId = process.env[PRICING.INTERNAL_TEST.env];
  if (!priceId) {
    return res.status(400).json({
      error: "internal_price_not_configured",
      message: `${PRICING.INTERNAL_TEST.env} is not set. Create the $1 price in Stripe and set it before moving anyone onto it.`,
    });
  }
  if (!billingStripe) return res.status(503).json({ error: "stripe_not_configured" });

  const rows = await query(
    `SELECT id, name, plan, subscription_status, stripe_subscription_id FROM orgs WHERE id=?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "org_not_found", message: "That organization does not exist." });
  const org = rows[0];
  if (!org.stripe_subscription_id) {
    return res.status(409).json({
      error: "no_subscription",
      message: `${org.name} has no Stripe subscription to move. Close them first, then move them onto the test price.`,
    });
  }

  // A dollar is still a charge, so the amount is CHECKED before an org is put
  // on it — the same rule as every other price in this file.
  try {
    const price = await billingStripe.prices.retrieve(priceId);
    if (price.unit_amount !== 100 || price.currency !== "usd" || !price.recurring) {
      return res.status(400).json({
        error: "internal_price_wrong",
        message: `${PRICING.INTERNAL_TEST.env} does not point at a recurring $1 USD price. Fix it before using it.`,
      });
    }
  } catch (err) {
    if (handleBillingConfigError(err, res, { plan: PRICING.INTERNAL_TEST.id, surface: "internal test price" })) return;
    throw err;
  }

  const sub = await billingStripe.subscriptions.retrieve(org.stripe_subscription_id);
  const itemId = sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].id;
  if (!itemId) return res.status(409).json({ error: "subscription_unreadable", message: "That subscription has no line to move." });
  await billingStripe.subscriptions.update(org.stripe_subscription_id, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "none",
    metadata: { plan: PRICING.INTERNAL_TEST.id, movedBy: req.user.email },
  });
  await run(`UPDATE orgs SET plan=? WHERE id=?`, [PRICING.INTERNAL_TEST.id, org.id]);
  console.log(`[internal-price] ${org.id} (${org.name}) moved onto the $1 price by ${req.user.email}`);
  res.json({ ok: true, orgId: org.id, orgName: org.name, plan: PRICING.INTERNAL_TEST.id, monthlyUsd: 1 });
}));

// GET /admin/close-links — what has been handed out, and what it became.
app.get("/admin/close-links", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const rows = await query(
    `SELECT c.*, o.name AS created_org_name, o.trial_ends_at,
            t.name AS target_org_name
       FROM close_links c
       LEFT JOIN orgs o ON o.id = c.org_id
       LEFT JOIN orgs t ON t.id = c.target_org_id
      ORDER BY c.created_at DESC LIMIT 100`, []);
  // "Configured" is not "correct" — production proved that: every price id was
  // set and every AMOUNT was the retired one. So this reports what Stripe
  // actually holds, and whether it matches what the page would quote.
  const plans = await Promise.all(CLOSE_PLANS.map(async p => {
    const priceId = process.env[p.env] || null;
    // GTM-1a — the amount and the CADENCE both come off the plan now. A
    // yearly tier charges the yearly figure on a `year` interval, and
    // comparing it against a monthly one would report every yearly price as
    // broken.
    const want = planAmountUsd(p), wantInterval = planInterval(p);
    const row = { id: p.id, name: p.name, monthlyUsd: p.monthlyUsd, amountUsd: want,
                  interval: wantInterval, internal: !!p.internal, env: p.env,
                  configured: !!priceId, ready: false };
    if (!priceId || !billingStripe) return row;
    try {
      const price = await billingStripe.prices.retrieve(priceId);
      row.stripeAmountUsd = price.unit_amount != null ? price.unit_amount / 100 : null;
      row.stripeInterval = price.recurring ? `${price.recurring.interval_count || 1} ${price.recurring.interval}` : null;
      row.ready = price.unit_amount === want * 100 && price.currency === "usd"
        && !!price.recurring && price.recurring.interval === wantInterval && (price.recurring.interval_count || 1) === 1;
    } catch (e) { row.error = "price_unreadable"; }
    return row;
  }));
  res.json({
    plans,
    links: rows.map(r => ({
      id: r.id, orgName: r.org_name, contactEmail: r.contact_email, plan: r.plan,
      status: r.status, url: r.checkout_url, orgId: r.org_id,
      trialEndsAt: r.trial_ends_at, createdAt: r.created_at, completedAt: r.completed_at,
      createdByName: r.created_by_name,
      // GTM-1a 5 — every signup lists here. `signupSource` is 'public' when
      // the visitor pressed the button themselves and null when Jonathan
      // minted the link, so the console can tell a deal he closed from one
      // that closed itself. The estimate is what they said their size was,
      // which is the number GTM-1b 1 checks against a real count after the
      // import.
      signupSource: r.signup_source || null,
      contactName: r.contact_name || null,
      estimatedDonors: r.estimated_donors == null ? null : Number(r.estimated_donors),
      billingInterval: r.billing_interval || null,
      // Which EXISTING org this link attaches to, if any. A link with a target
      // reads differently in the list - it did not create the organisation it
      // names, it put one that was already here onto a plan.
      targetOrgId: r.target_org_id || null,
      targetOrgName: r.target_org_name || null,
    })),
  });
}));
function verifyCancelToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", RECOVERY_SECRET).update("cancel:" + payload).digest("base64url");
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return decoded.cancelOrgId ? decoded.cancelOrgId : null;
  } catch { return null; }
}

// THE CANCEL, both halves of it:
//   • BEFORE the first charge — cancel the subscription outright. Zero charges,
//     ever. This is the promise the Checkout page made, kept.
//   • AFTER a charge — cancel at period end. She keeps what she paid for until
//     the month she paid for runs out, and is never charged again.
// Returns { ok, when: "now" | "period_end", periodEnd, alreadyCanceled }.
async function cancelOrgSubscription(orgId) {
  const rows = await query(
    "SELECT id, subscription_status, stripe_subscription_id, trial_ends_at, current_period_end FROM orgs WHERE id=?", [orgId]);
  if (!rows.length) return { ok: false, error: "org_not_found" };
  const org = rows[0];
  if ((org.subscription_status || "") === "canceled") {
    return { ok: true, when: "period_end", alreadyCanceled: true, periodEnd: org.current_period_end };
  }
  const isTrial = (org.subscription_status || "trialing") === "trialing";
  if (!org.stripe_subscription_id) {
    // No Stripe subscription behind the plan (a manual grant, or a trial that
    // never went through Checkout). There is nothing to charge and nothing to
    // call Stripe about — end it locally and say so plainly.
    await run("UPDATE orgs SET subscription_status='canceled', grace_until=NOW() + INTERVAL '3 days' WHERE id=?", [orgId]);
    return { ok: true, when: "now", noSubscription: true };
  }
  if (!billingStripe) return { ok: false, error: "stripe_not_configured" };
  try {
    if (isTrial) {
      await billingStripe.subscriptions.cancel(org.stripe_subscription_id);
      // FIX-32: cancelling inside the free thirty days keeps everything open
      // until the trial's own end date; the plan is left as chosen so "Keep
      // Steward" can restore it.
      await run(`UPDATE orgs SET subscription_status='canceled',
                   grace_until=CASE WHEN trial_ends_at > NOW() THEN trial_ends_at ELSE NOW() + INTERVAL '3 days' END
                 WHERE id=?`, [orgId]);
      console.log(`[billing] ${orgId} cancelled during trial — no charge was ever made`);
      return { ok: true, when: "now", freeOfCharge: true };
    }
    const sub = await billingStripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true });
    const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : org.current_period_end;
    await run("UPDATE orgs SET current_period_end=COALESCE(?, current_period_end) WHERE id=?", [periodEnd, orgId]);
    console.log(`[billing] ${orgId} set to cancel at period end ${periodEnd}`);
    return { ok: true, when: "period_end", periodEnd };
  } catch (e) {
    console.error("[billing] cancel failed for", orgId, e.message);
    return { ok: false, error: "stripe_error", message: e.message };
  }
}

// POST /billing/cancel — the button in Settings → Billing. No phone call.
app.post("/billing/cancel", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await cancelOrgSubscription(req.user.orgId);
  if (!out.ok) {
    const code = out.error === "org_not_found" ? 404 : out.error === "stripe_not_configured" ? 503 : 400;
    return res.status(code).json({ error: out.error, message: out.message || "Could not cancel. Please try again." });
  }
  res.json(out);
}));

// The emailed cancel. A GET renders one button rather than cancelling on load —
// an inbox scanner that prefetches links must not be able to end somebody's
// subscription — and the POST behind it does the work. Same server-rendered,
// no-login shape as /unsubscribe.
function cancelPageHtml({ state, orgName, sentence, token, periodEnd }) {
  const shell = inner => `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Steward</title></head>
<body style="margin:0;background:#f0ede6;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:56px 20px;">
  <div style="text-align:center;margin-bottom:24px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</div>
  <div style="background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">${inner}</div>
</div></body></html>`;
  if (state === "invalid") {
    return shell(`<h1 style="margin:0 0 10px;font-size:22px;color:#0f1a12;">This link is no longer valid</h1>
      <p style="margin:0;font-size:15px;color:#5A554F;line-height:1.6;">Cancel from Settings &rarr; Billing inside Steward, or reply to the email and we will take care of it.</p>`);
  }
  if (state === "done_now") {
    return shell(`<h1 style="margin:0 0 10px;font-size:22px;color:#0f1a12;">Cancelled. You were never charged.</h1>
      <p style="margin:0;font-size:15px;color:#5A554F;line-height:1.6;">${orgName ? displayNameCase(orgName) + "&rsquo;s" : "Your"} subscription has ended before its first charge, so nothing was billed and nothing will be. Your data is still here if you change your mind.</p>`);
  }
  if (state === "done_period_end") {
    return shell(`<h1 style="margin:0 0 10px;font-size:22px;color:#0f1a12;">Cancelled</h1>
      <p style="margin:0;font-size:15px;color:#5A554F;line-height:1.6;">You will not be charged again. You keep full access until ${periodEnd ? formatChargeDate(periodEnd) : "the end of the month you have paid for"}.</p>`);
  }
  return shell(`<h1 style="margin:0 0 10px;font-size:22px;color:#0f1a12;">Cancel your Steward subscription?</h1>
    <p style="margin:0 0 22px;font-size:15px;color:#5A554F;line-height:1.6;">${sentence || ""} Cancel now and you pay nothing.</p>
    <form method="POST" action="/billing/cancel/${token}">
      <button type="submit" style="background:#0D5C3A;border:none;border-radius:10px;padding:13px 26px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Cancel my subscription</button>
    </form>
    <p style="margin:18px 0 0;font-size:13px;color:#8a857f;line-height:1.5;">Changed your mind? Close this page &mdash; nothing happens unless you press the button.</p>`);
}

app.get("/billing/cancel/:token", wrap(async (req, res) => {
  res.set("Content-Type", "text/html");
  const orgId = verifyCancelToken(req.params.token);
  if (!orgId) return res.status(400).send(cancelPageHtml({ state: "invalid" }));
  const rows = await query("SELECT id, name, plan, subscription_status, trial_ends_at FROM orgs WHERE id=?", [orgId]);
  if (!rows.length) return res.status(400).send(cancelPageHtml({ state: "invalid" }));
  const org = rows[0];
  const plan = closePlan(org.plan);
  const isTrial = (org.subscription_status || "trialing") === "trialing";
  const tz = await orgTzName(orgId);
  const sentence = isTrial && plan && org.trial_ends_at
    ? firstChargeSentence({ monthlyUsd: plan.monthlyUsd, firstChargeAt: org.trial_ends_at, tz }) : "";
  res.send(cancelPageHtml({ state: "confirm", orgName: org.name, sentence, token: req.params.token }));
}));

app.post("/billing/cancel/:token", wrap(async (req, res) => {
  res.set("Content-Type", "text/html");
  const orgId = verifyCancelToken(req.params.token);
  if (!orgId) return res.status(400).send(cancelPageHtml({ state: "invalid" }));
  const before = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
  const out = await cancelOrgSubscription(orgId);
  if (!out.ok) return res.status(400).send(cancelPageHtml({ state: "invalid" }));
  res.send(cancelPageHtml({
    state: out.when === "now" ? "done_now" : "done_period_end",
    orgName: before[0]?.name, periodEnd: out.periodEnd,
  }));
}));

// Ops/test driver — the same path the tick takes. Super-admin only; `now` lets
// the suite stand on day 23, `dryRun` composes without sending or stamping.
app.post("/billing/trial-reminders/run", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const { now, dryRun } = req.body || {};
  const at = now ? new Date(now).getTime() : Date.now();
  res.json(await processTrialReminders({ now: Number.isNaN(at) ? Date.now() : at, send: !dryRun }));
}));

// ── Admin (super admin only) ───────────────────────────────────────────────
// BUILD-90: the live commercial model — Founding $199, Core $249, Team $499.
// These superseded the lower three-price set BUILD-24 shipped; closeLink.js is the
// source of truth for the three a close link may sell, and this table exists
// only so the super-admin dashboard can add up MRR. seed/growth/impact are
// legacy prices no org is on.
const PLAN_MRR = { core: 249, team: 499, founding: 199, seed: 99, growth: 249, impact: 499, trial: 0 };

async function orgWithMetrics(org) {
  const [donors, grants, users, lastActive] = await Promise.all([
    query("SELECT COUNT(*) AS c FROM donors WHERE org_id=? AND deleted_at IS NULL", [org.id]),
    query("SELECT COUNT(*) AS c FROM grants WHERE org_id=?", [org.id]),
    query("SELECT COUNT(*) AS c FROM users WHERE org_id=?", [org.id]),
    query("SELECT MAX(created_at) AS t FROM interactions WHERE org_id=?", [org.id]),
  ]);
  return {
    ...org,
    donor_count:    parseInt(donors[0].c, 10),
    grant_count:    parseInt(grants[0].c, 10),
    user_count:     parseInt(users[0].c, 10),
    last_active:    lastActive[0]?.t || null,
    monthly_revenue: PLAN_MRR[org.subscription_status === "active" ? org.plan : "trial"] || 0,
  };
}

app.get("/admin/orgs", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  // One grouped aggregate per table instead of 4 queries per org (was N+1 —
  // Promise.all(orgs.map(orgWithMetrics))). orgWithMetrics stays for the
  // single-org GET /admin/orgs/:id, where per-org queries are fine.
  const [orgs, donorCounts, grantCounts, userCounts, lastActives] = await Promise.all([
    query("SELECT * FROM orgs ORDER BY created_at DESC", []),
    query("SELECT org_id, COUNT(*) AS c FROM donors WHERE deleted_at IS NULL GROUP BY org_id", []),
    query("SELECT org_id, COUNT(*) AS c FROM grants GROUP BY org_id", []),
    query("SELECT org_id, COUNT(*) AS c FROM users GROUP BY org_id", []),
    query("SELECT org_id, MAX(created_at) AS t FROM interactions GROUP BY org_id", []),
  ]);
  const byOrg = (rows, col) => new Map(rows.map(r => [r.org_id, r[col]]));
  const dMap = byOrg(donorCounts, "c"), gMap = byOrg(grantCounts, "c"),
        uMap = byOrg(userCounts, "c"), aMap = byOrg(lastActives, "t");
  res.json(orgs.map(org => ({
    ...org,
    donor_count:    parseInt(dMap.get(org.id) || 0, 10),
    grant_count:    parseInt(gMap.get(org.id) || 0, 10),
    user_count:     parseInt(uMap.get(org.id) || 0, 10),
    last_active:    aMap.get(org.id) || null,
    monthly_revenue: PLAN_MRR[org.subscription_status === "active" ? org.plan : "trial"] || 0,
  })));
}));

app.get("/admin/metrics", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orgs = await query("SELECT * FROM orgs", []);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const active = orgs.filter(o => o.subscription_status === "active");
  const trialing = orgs.filter(o => o.subscription_status === "trialing");
  const churned = orgs.filter(o => o.subscription_status === "cancelled");
  const mrr = active.reduce((s, o) => s + (PLAN_MRR[o.plan] || 0), 0);

  const [donors, grants, interactions, newThisMonth, newLastMonth] = await Promise.all([
    query("SELECT COUNT(*) AS c FROM donors", []),
    query("SELECT COUNT(*) AS c FROM grants", []),
    query("SELECT COUNT(*) AS c FROM interactions", []),
    query("SELECT COUNT(*) AS c FROM orgs WHERE created_at >= ?", [startOfMonth]),
    query("SELECT COUNT(*) AS c FROM orgs WHERE created_at >= ? AND created_at < ?", [startOfLastMonth, endOfLastMonth]),
  ]);

  const trialDaysLeft = trialing.map(o => {
    if (!o.trial_ends_at) return 30;
    return Math.max(0, Math.ceil((new Date(o.trial_ends_at) - Date.now()) / 86400000));
  });
  const avgTrialDays = trialDaysLeft.length ? Math.round(trialDaysLeft.reduce((a, b) => a + b, 0) / trialDaysLeft.length) : 0;

  res.json({
    total_orgs: orgs.length,
    active_subscriptions: active.length,
    trialing: trialing.length,
    churned: churned.length,
    mrr,
    arr: mrr * 12,
    avg_trial_days_remaining: avgTrialDays,
    trial_conversion_rate: (active.length + churned.length) > 0
      ? Math.round((active.length / (active.length + churned.length)) * 100)
      : 0,
    new_orgs_this_month: parseInt(newThisMonth[0].c, 10),
    new_orgs_last_month: parseInt(newLastMonth[0].c, 10),
    total_donors: parseInt(donors[0].c, 10),
    total_grants: parseInt(grants[0].c, 10),
    total_interactions: parseInt(interactions[0].c, 10),
    plan_breakdown: {
      trial:    orgs.filter(o => !o.plan || o.plan === "trial").length,
      core:     orgs.filter(o => o.plan === "core" && o.subscription_status === "active").length,
      team:     orgs.filter(o => o.plan === "team" && o.subscription_status === "active").length,
      founding: orgs.filter(o => o.plan === "founding" && o.subscription_status === "active").length,
      seed:     orgs.filter(o => o.plan === "seed" && o.subscription_status === "active").length,
      growth:   orgs.filter(o => o.plan === "growth" && o.subscription_status === "active").length,
      impact:   orgs.filter(o => o.plan === "impact" && o.subscription_status === "active").length,
    },
  });
}));

app.get("/admin/orgs/:id", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orgs = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = await orgWithMetrics(orgs[0]);

  const [users, recentActivity, sequences, enrollments] = await Promise.all([
    // deactivated_at rides along so the console can tell a live admin from a
    // removed one - the close screen has to name the person a link will
    // actually reach, and a removed user reaches nobody.
    query("SELECT id, name, email, role, created_at, deactivated_at FROM users WHERE org_id=? ORDER BY created_at ASC", [req.params.id]),
    query(`SELECT i.type, i.note, i.date, i.created_at, d.name AS donor_name
           FROM interactions i JOIN donors d ON i.donor_id = d.id
           WHERE i.org_id=? ORDER BY i.created_at DESC LIMIT 10`, [req.params.id]),
    query("SELECT COUNT(*) AS c FROM sequences WHERE org_id=?", [req.params.id]),
    query("SELECT COUNT(*) AS c FROM sequence_enrollments WHERE org_id=?", [req.params.id]),
  ]);
  res.json({
    ...org,
    users,
    recent_activity: recentActivity,
    sequence_count: parseInt(sequences[0].c, 10),
    enrollment_count: parseInt(enrollments[0].c, 10),
  });
}));

app.post("/admin/orgs/:id/extend-trial", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const { days } = req.body;
  const n = parseInt(days, 10);
  if (!days || isNaN(n) || n <= 0) return res.status(400).json({ error: "days (positive integer) required" });
  // Extend from whichever is later: the current trial end or now — extending
  // a long-expired trial by 7 days must land in the future, not still in the
  // past. If checkTrialExpiry already flipped the org to trial_expired
  // (read_only), restore trialing so the extension actually grants access.
  // INTERVAL template literal is safe — n is parseInt-validated (see the
  // sequences engine's identical convention).
  const result = await run(
    `UPDATE orgs SET
       trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + INTERVAL '${n} days',
       subscription_status = CASE WHEN subscription_status = 'trial_expired' THEN 'trialing' ELSE subscription_status END
     WHERE id = ?`,
    [req.params.id]
  );
  if (!result.changes) return res.status(404).json({ error: "Org not found" });
  const orgs = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  res.json(orgs[0]);
}));

app.post("/admin/orgs/:id/change-plan", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const { plan, foundingPartner } = req.body;
  // CKRH-1 — the list was written before the tiers existed and had gone stale:
  // Seed, Sapling and Orchard are what the pricing page sells, and a super
  // admin could not name any of them here. It is now the LEGACY list plus
  // whatever `pricing.json` currently holds, so the one price list stays the
  // one price list and this route cannot drift from it again.
  const tierIds = [];
  for (const t of (PRICING.TIERS || [])) { tierIds.push(t.id, `${t.id}_monthly`, `${t.id}_yearly`); }
  const valid = ["trial", "core", "team", "founding", "seed", "growth", "impact", ...tierIds];
  if (!valid.includes(plan)) return res.status(400).json({ error: "Invalid plan" });

  // GRANTING A PLAN DOES NOT END A FREE TRIAL THAT IS STILL RUNNING. An
  // invoice-only customer is put on their plan on day ONE — the plan is what
  // they have agreed to pay for, and the thirty days is when they start paying
  // for it. Flattening `trialing` to `active` here charged that customer
  // nothing (there is no subscription) but told Settings, the band check and
  // `orgPlanTier` that the free period was over on the day it began.
  const [before] = await query(
    "SELECT subscription_status, trial_ends_at FROM orgs WHERE id=?", [req.params.id]);
  if (!before) return res.status(404).json({ error: "Org not found" });
  const trialRunning = before.subscription_status === "trialing"
    && before.trial_ends_at && new Date(before.trial_ends_at).getTime() > Date.now();
  const status = (plan === "trial" || trialRunning) ? "trialing" : "active";

  const sets = ["plan=?", "subscription_status=?"], params = [plan, status];
  // The founding discount is a COUPON that follows the org across bands
  // (GTM-1b), so it is a flag on the org and not a plan of its own.
  if (foundingPartner !== undefined) { sets.push("founding_partner=?"); params.push(foundingPartner === true); }
  params.push(req.params.id);
  await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, params);
  const orgs = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  res.json(orgs[0]);
}));

// ── INCIDENT 2026-09-22 — THE ORG-LEVEL MAIL SWITCH ───────────────────────
// The lever that did not exist on the night. Super-admin rather than org-admin
// on purpose: the orgs this is for are demo and provisioned ones, whose own
// "admin" is either nobody or a prospect who has not signed in yet, and
// turning mail back on for an org full of invented people is an operator
// decision that should be made by someone who can see what is in it.
//
// Every flip is logged with an actor. Silently changing whether an
// organisation can contact its donors is not something to do without a trace.
app.post("/admin/orgs/:id/email-switch", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orgId = req.params.id;
  const [org] = await query("SELECT id, name, emails_enabled, is_demo_org FROM orgs WHERE id=?", [orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });

  const { emailsEnabled, isDemoOrg } = req.body || {};
  if (emailsEnabled === undefined && isDemoOrg === undefined) {
    return res.status(400).json({ error: "emailsEnabled and/or isDemoOrg (boolean) required" });
  }
  if (emailsEnabled !== undefined && typeof emailsEnabled !== "boolean") {
    return res.status(400).json({ error: "emailsEnabled must be a boolean" });
  }
  if (isDemoOrg !== undefined && typeof isDemoOrg !== "boolean") {
    return res.status(400).json({ error: "isDemoOrg must be a boolean" });
  }

  // Turning mail ON for an org still marked as fiction is refused rather than
  // silently obeyed. The two flags disagreeing is how the incident would
  // repeat: somebody flips the switch to unblock a real customer and does not
  // notice the org is still full of invented donors. Clear the mark first,
  // which forces a look at what is actually in there.
  const willBeDemo  = isDemoOrg  !== undefined ? isDemoOrg  : org.is_demo_org === true;
  const willBeOn    = emailsEnabled !== undefined ? emailsEnabled : org.emails_enabled !== false;
  if (willBeOn && willBeDemo) {
    return res.status(409).json({
      error: "This org is still marked as a demo org. Clear isDemoOrg in the same call (or first) if its data is real now.",
    });
  }

  const sets = [], params = [];
  if (emailsEnabled !== undefined) { sets.push("emails_enabled=?"); params.push(emailsEnabled); }
  if (isDemoOrg     !== undefined) { sets.push("is_demo_org=?");    params.push(isDemoOrg); }
  params.push(orgId);
  await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, params);

  clearOrgMailGate(orgId);   // an operator flip takes effect now, not in five seconds
  console.log(`[mail-switch] ${orgId} (${org.name}) emails_enabled=${willBeOn} is_demo_org=${willBeDemo} ` +
              `by ${req.user.email || req.user.userId}`);

  const [after] = await query("SELECT id, name, emails_enabled, is_demo_org FROM orgs WHERE id=?", [orgId]);
  res.json({ ok: true, org: after });
}));

// ── MAIL-1: ONE ORG'S MAIL, AS A SUPER-ADMIN SEES IT ─────────────────────
// Onboarded or not, the donor-mail switch, the sending identity, and what each
// family of mail would do right now, in sentences (mailPolicy.js decides; this
// only reports it). A demonstration org shows everything locked, with why.
const mailPolicy = require("../mailPolicy");
async function adminMailPayload(orgId) {
  const [org] = await query(
    `SELECT id, name, emails_enabled, is_demo_org, onboarded_at, onboarded_via, onboarded_by_name,
            sending_domain, sending_domain_status, sending_from_email FROM orgs WHERE id=?`, [orgId]);
  if (!org) return null;
  const demo = mailPolicy.orgMailDecision(org, mailPolicy.CATEGORY.DONOR).reason === "demo_org";
  const ident = await orgSendingIdentity(orgId).catch(() => null);
  const families = {};
  for (const c of ["staff", "donor", "account", "billing", "jonathan", "onboarding"]) {
    const d = mailPolicy.orgMailDecision(org, c);
    families[c] = { sends: d.send, sentence: d.send ? "Sends." : mailPolicy.REASON_SENTENCE[d.reason] || "Does not send." };
  }
  return {
    orgId: org.id, name: org.name,
    onboarded: !!org.onboarded_at, onboardedAt: org.onboarded_at || null,
    onboardedHow: !org.onboarded_at ? null
      : String(org.onboarded_via || "").startsWith("import:") ? "Their first donor file was imported."
      : `Marked onboarded by ${org.onboarded_by_name || "a super-admin"}.`,
    donorMailOn: org.emails_enabled !== false,
    demo, locked: demo,
    lockedSentence: demo ? mailPolicy.REASON_SENTENCE.demo_org + " Sign-in mail to its own logins still goes." : null,
    domain: {
      status: org.sending_domain_status || "none", domain: org.sending_domain || null,
      from: ident ? ident.from : null,
      sentence: ident && ident.verified ? `Mail goes out from ${ident.address}, the organization's own verified domain.`
        : org.sending_domain ? `${org.sending_domain} is not verified yet, so mail goes out from Steward's address with the organization's name on it.`
        : "No sending domain, so mail goes out from Steward's address with the organization's name on it.",
    },
    families,
    waitsForOnboarding: mailPolicy.waitsForOnboarding(),
  };
}
app.get("/admin/orgs/:id/mail", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const out = await adminMailPayload(req.params.id);
  if (!out) return res.status(404).json({ error: "Org not found" });
  res.json(out);
}));
// By hand, for an org whose donors came in some other way. Never on a demo org.
app.post("/admin/orgs/:id/mark-onboarded", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const before = await adminMailPayload(req.params.id);
  if (!before) return res.status(404).json({ error: "Org not found" });
  if (before.demo) return res.status(409).json({ error: before.lockedSentence });
  const [me] = await query("SELECT id, name, email FROM users WHERE id=?", [req.user.userId]);
  await run(`UPDATE orgs SET onboarded_at = NOW(), onboarded_via = 'super_admin', onboarded_by = ?, onboarded_by_name = ?
              WHERE id = ? AND onboarded_at IS NULL`,
    [req.user.userId, (me && (me.name || me.email)) || "Super-admin", req.params.id]);
  clearOrgMailGate(req.params.id);
  console.log(`[mail-1] ${req.params.id} marked onboarded by ${req.user.email || req.user.userId}`);
  res.json(await adminMailPayload(req.params.id));
}));
// A test of this org's sending identity, to the signed-in super-admin's OWN
// address and nobody else's. The address is read from the session, never the body.
app.post("/admin/orgs/:id/mail-test", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const info = await adminMailPayload(req.params.id);
  if (!info) return res.status(404).json({ error: "Org not found" });
  if (info.demo) return res.status(409).json({ error: info.lockedSentence });
  const [me] = await query("SELECT email FROM users WHERE id=?", [req.user.userId]);
  const to = me && me.email;
  if (!to) return res.status(400).json({ error: "Your account has no email address to send the test to." });
  if (!process.env.RESEND_API_KEY) return res.json({ sent: false, to, sentence: "No mail provider is configured, so nothing was sent." });
  const ident = await orgSendingIdentity(req.params.id);
  const { error } = await resend.emails.send({
    from: ident.from, ...(ident.replyTo ? { replyTo: ident.replyTo } : {}), to,
    subject: `Test from ${info.name}`,
    html: `<p>This is a test of how ${displayNameCase(info.name)}'s mail leaves Steward. It went only to you.</p><p>${info.domain.sentence}</p>`,
    _stewardOrgId: req.params.id, _stewardKind: "mail_test",
  });
  if (error) return res.json({ sent: false, to, sentence: `The mail provider did not accept it: ${error.message}` });
  res.json({ sent: true, to, sentence: `Sent to ${to} only.` });
}));

// ── PARITY-2 Part 5: QUICKBOOKS SYNC, PER ORG ────────────────────────────
// The founder's switch, not the org's: production QuickBooks keys need
// Intuit's app assessment, and until it is passed the connection is offered
// only to the organisations he turns it on for. Turning it off hides the
// Connect button and stops sending; it deletes nothing, and every gift already
// sent keeps its QuickBooks id.
app.post("/admin/orgs/:id/qbo-sync", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [req.params.id]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
  await run("UPDATE orgs SET qbo_sync_enabled=? WHERE id=?", [req.body.enabled, org.id]);
  if (!req.body.enabled) await run("UPDATE orgs SET qbo_auto_sync=false WHERE id=?", [org.id]);
  res.json({ ok: true, orgId: org.id, qboSyncEnabled: req.body.enabled,
    sentence: req.body.enabled ? `QuickBooks sync is on for ${org.name}.` : `QuickBooks sync is off for ${org.name}. Nothing was deleted.` });
}));

// ── BUILD-96 Part 2 — CLEAR SAMPLE DATA, on somebody else's org ────────────
// org_justinsplace holds invented people under a real organisation's name.
// Before Allie's real export loads, all of that has to go and NOTHING else —
// her users, her five real funds, her vocabulary, the Welcome sequence
// definition and every setting stay exactly as they are.
//
// This is a super-admin action rather than a button in her Settings because
// the org is handed over already provisioned: she should never have to think
// about the fiction, only stop seeing it.
//
// GET first, always. A destructive action on someone else's data says what it
// is about to do before it does it.
app.get("/admin/orgs/:id/sample-data", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orgs = await query("SELECT id, name FROM orgs WHERE id=?", [req.params.id]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const counts = await sampleDataMod.countSampleData(query, req.params.id);
  res.json({
    org: orgs[0],
    counts,
    // The guard, surfaced BEFORE the press rather than as an error after it.
    clearable: counts.realGifts === 0,
    blockedBy: counts.realGifts > 0
      ? `${counts.realGifts} gift${counts.realGifts === 1 ? "" : "s"} this org entered itself`
      : null,
  });
}));

app.post("/admin/orgs/:id/clear-sample-data", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orgId = req.params.id;
  const orgs = await query("SELECT id, name FROM orgs WHERE id=?", [orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: "confirm: true required" });

  const counts = await sampleDataMod.countSampleData(query, orgId);

  // THE GUARD. A gift the provisioning path did not write means somebody has
  // started using this org, and clearing it is never what was meant — the
  // realistic accident is not a wrong click on the right org, it is the right
  // click on the wrong one. An audit row records the refusal too: a
  // near-miss on a customer's data is exactly the thing worth being able to
  // find afterwards.
  if (counts.realGifts > 0) {
    await auditSampleData(orgId, "refused", req.user, counts,
      { reason: "org has gifts the provisioning path did not write" });
    return res.status(409).json({
      error: `Refused: ${orgId} has ${counts.realGifts} gift${counts.realGifts === 1 ? "" : "s"} that the provisioning script did not write. This org has real data in it.`,
      counts,
    });
  }

  const { deleted, errors } = await sampleDataMod.clearSampleData({ query, run }, orgId);
  await run("DELETE FROM fin_funds WHERE org_id=? AND id IN (?,?,?)",
    [orgId, "fund_smpl_general", "fund_smpl_edu", "fund_smpl_capital"]).catch(() => {});

  if (errors.length) {
    await auditSampleData(orgId, "refused", req.user, counts, { errors, deleted, partial: true });
    return res.status(500).json({ error: "Some sample rows could not be removed", errors, deleted });
  }

  await auditSampleData(orgId, "cleared", req.user, counts, { deleted });
  const after = await sampleDataMod.countSampleData(query, orgId);
  res.json({ ok: true, before: counts, deleted, after });
}));

// Append-only. A write failure is logged and never fails the action it
// records — an audit row is evidence, not a permission (the BUILD-93
// convention, same as auditUserAdmin).
async function auditSampleData(orgId, action, actor, counts, detail) {
  try {
    await run(
      `INSERT INTO sample_data_audit (id, org_id, action, actor_user_id, actor_email, counts, detail)
       VALUES (?,?,?,?,?,?,?)`,
      ["sda_" + uuid().slice(0, 8), orgId, action, actor?.userId || null, actor?.email || null,
       JSON.stringify(counts || {}), detail ? JSON.stringify(detail) : null]);
  } catch (err) {
    console.error("[sample-data] audit write failed (action continues):", err.message);
  }
}

app.delete("/admin/orgs/:id", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const { confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: "confirm: true required" });
  const orgs = await query("SELECT id FROM orgs WHERE id=?", [req.params.id]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const orgId = req.params.id;
  // Cascade delete — order matters for FK constraints; .catch(() => {}) on each so a missing table never aborts.
  // donor_materials/planned_gifts/milestone_drafts/note_reminders reference
  // donor_id and MUST go before the `donors` delete below — found missing
  // from this cascade entirely (added in later sessions after this route
  // was written) while investigating a manually-deleted test org.
  await run("DELETE FROM sequence_enrollments WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE org_id=?)", [orgId]).catch(() => {});
  await run("DELETE FROM sequences WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM custom_field_values WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM custom_fields WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM custom_field_events WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM custom_field_defs WHERE org_id=?", [orgId]).catch(() => {});
  // FIX-12 Part 5 — the audit rows are NOT deleted with the org. The log
  // promises seven years, and the org's history is exactly what somebody may
  // need after the org is gone. fin_audit_log has no foreign key to orgs any
  // more, so the org row below can go while its history stays.
  await run("DELETE FROM budgets WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM fin_transactions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM fin_funds WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM accounts WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM campaign_recipients WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM campaigns WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM event_attendees WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM events WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM grant_interactions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM milestone_drafts WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM note_reminders WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM donor_materials WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM planned_gifts WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM receipts WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM payment_recovery_events WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM recurring_subscriptions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM interactions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM gifts WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM donors WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM program_grants WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM programs WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM grants WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM volunteers WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM tasks WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM board_members WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM board_reports WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM invites WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM annual_fund_goals WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM fundraising_goals WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM impact_metrics WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM metric_snapshots WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM email_suppressions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM financials WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM funds WHERE org_id=?", [orgId]).catch(() => {});
  // PARITY-2 Part 4: an auction's items, bidders and bids cascade from it.
  await run("DELETE FROM auctions WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM ai_log WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM gmail_connections WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id=?)", [orgId]).catch(() => {});
  await run("DELETE FROM users WHERE org_id=?", [orgId]).catch(() => {});
  // PARITY-2 Part 5: the accounting connection and what it sent go with the
  // org (the connection row was missing from this list since INT-2).
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_customers", "bookkeeping_deposits", "bookkeeping_connections"])
    await run(`DELETE FROM ${t} WHERE org_id=?`, [orgId]).catch(() => {});
  await run("DELETE FROM orgs WHERE id=?", [orgId]);
  res.json({ deleted: true });
}));

// ── Data integrity diagnostics (super admin) ────────────────────────────────
// Ad hoc maintenance tool: reports (and can fix) drift left behind by manual
// edits directly in the DB — orgs with no users left to log in, and TEXT
// columns that reference a user_id/donor "logged by" style but aren't real
// FK constraints, so deleting a user row via Table Editor never errors and
// silently leaves dangling references behind.
const DANGLING_USER_REF_CHECKS = [
  { table: "interactions", col: "created_by" },
  { table: "donors", col: "assigned_to" },
  { table: "donor_materials", col: "uploaded_by" },
  { table: "milestone_drafts", col: "reviewed_by" },
  { table: "note_reminders", col: "sent_by" },
  { table: "board_reports", col: "generated_by" },
  // fin_audit_log is NOT here: a removed user's id in the log is the point of
  // the log (FIX-12), and the append-only trigger would refuse the fix anyway.
  { table: "ai_log", col: "user_id" },
  { table: "invites", col: "invited_by" },
];
// NOT NULL + UNIQUE(user_id)/user_id columns — can't null these, the whole
// row is dead once the user is gone (an OAuth connection or reset token
// nobody can use), so a dangling reference here means DELETE the row, not
// null the column.
const DANGLING_USER_ROW_CHECKS = [
  { table: "gmail_connections", col: "user_id", hasOrgId: true },
  { table: "password_reset_tokens", col: "user_id", hasOrgId: false },
];

app.get("/admin/data-integrity", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const orphanedOrgs = await query(
    `SELECT o.id, o.name, o.created_at, o.stripe_customer_id, o.stripe_subscription_id, o.subscription_status, o.plan
     FROM orgs o WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id) ORDER BY o.created_at DESC`,
    []
  );

  const danglingRefs = [];
  for (const c of DANGLING_USER_REF_CHECKS) {
    const rows = await query(
      `SELECT id, org_id, ${c.col} AS dangling_value FROM ${c.table}
       WHERE ${c.col} IS NOT NULL AND ${c.col} NOT IN (SELECT id FROM users)
       LIMIT 5`,
      []
    ).catch(() => []);
    const countRows = await query(
      `SELECT COUNT(*) AS c FROM ${c.table} WHERE ${c.col} IS NOT NULL AND ${c.col} NOT IN (SELECT id FROM users)`,
      []
    ).catch(() => [{ c: 0 }]);
    const count = parseInt(countRows[0]?.c || 0, 10);
    if (count > 0) danglingRefs.push({ table: c.table, column: c.col, count, samples: rows });
  }

  const danglingRows = [];
  for (const c of DANGLING_USER_ROW_CHECKS) {
    const cols = c.hasOrgId ? `id, org_id, ${c.col} AS dangling_value` : `id, ${c.col} AS dangling_value`;
    const rows = await query(
      `SELECT ${cols} FROM ${c.table} WHERE ${c.col} NOT IN (SELECT id FROM users) LIMIT 5`,
      []
    ).catch(() => []);
    const countRows = await query(
      `SELECT COUNT(*) AS c FROM ${c.table} WHERE ${c.col} NOT IN (SELECT id FROM users)`,
      []
    ).catch(() => [{ c: 0 }]);
    const count = parseInt(countRows[0]?.c || 0, 10);
    if (count > 0) danglingRows.push({ table: c.table, column: c.col, count, samples: rows });
  }

  res.json({ orphanedOrgs, danglingRefs, danglingRows });
}));

// Fixes only what's unambiguously safe: nulls a dangling "who did this"
// reference (never touches the parent row's real content), or deletes a
// row that is ENTIRELY about a now-nonexistent user (a dead OAuth
// connection, an unusable reset token) — never touches donors, gifts, or
// any row containing real org data.
app.post("/admin/data-integrity/fix", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const results = { nulled: [], deleted: [] };
  for (const c of DANGLING_USER_REF_CHECKS) {
    const affected = await run(
      `UPDATE ${c.table} SET ${c.col}=NULL WHERE ${c.col} IS NOT NULL AND ${c.col} NOT IN (SELECT id FROM users)`,
      []
    ).catch(() => ({ changes: 0 }));
    if (affected.changes) results.nulled.push({ table: c.table, column: c.col, count: affected.changes });
  }
  // donors.assigned_to_name is a paired display-name column with no FK
  // reference of its own — clear it wherever assigned_to just got nulled
  // above so the two don't fall out of sync (an assigned_to_name with no
  // assigned_to would otherwise look like a UI bug).
  await run(`UPDATE donors SET assigned_to_name=NULL WHERE assigned_to IS NULL AND assigned_to_name IS NOT NULL`, []).catch(() => {});
  await run(`UPDATE board_reports SET generated_by_name=NULL WHERE generated_by IS NULL AND generated_by_name IS NOT NULL`, []).catch(() => {});

  for (const c of DANGLING_USER_ROW_CHECKS) {
    const affected = await run(
      `DELETE FROM ${c.table} WHERE ${c.col} NOT IN (SELECT id FROM users)`,
      []
    ).catch(() => ({ changes: 0 }));
    if (affected.changes) results.deleted.push({ table: c.table, column: c.col, count: affected.changes });
  }
  res.json(results);
}));
async function linkOrgJoinsNetwork(orgId) {
  // Org just became portal-enabled/approved: link every verified account whose
  // email matches one of this org's donor records.
  const rows = await query(
    `SELECT DISTINCT LOWER(d.email) AS em FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.email IS NOT NULL AND d.email <> ''`, [orgId]);
  for (const r of rows) await linkEmailToAccounts(orgId, r.em);
}

// ── Admin review queue — a human approves EVERYTHING (auto-approve nothing) ─
app.get("/admin/network/applications", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const status = String(req.query.status || "pending");
  const rows = await query(
    `SELECT na.*, o.name AS org_name, o.org_slug, o.stripe_account_id, o.stripe_connected, u.email AS admin_email
     FROM network_applications na
     JOIN orgs o ON o.id = na.org_id
     LEFT JOIN users u ON u.org_id = na.org_id AND u.role = 'admin'
     WHERE na.status = ? ORDER BY na.created_at ASC LIMIT 100`, [status]);
  res.json(rows);
}));

app.post("/admin/network/applications/:id/decide", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const action = String(req.body?.action || "");
  const reason = String(req.body?.reason || "").slice(0, 500);
  if (!["approve", "hold", "reject"].includes(action)) return res.status(400).json({ error: "action must be approve | hold | reject" });
  const [appRow] = await query(`SELECT * FROM network_applications WHERE id = ?`, [req.params.id]);
  if (!appRow) return res.status(404).json({ error: "not_found" });
  if (action === "approve") {
    // The gate holds even against the approver: EIN verified-and-ok AND
    // Stripe onboarding ACTUALLY complete, or the approve is refused. The EIN
    // is re-checked LIVE (the registry refreshes monthly — the signup-time
    // snapshot is display evidence, never the gate). BUILD-58 (BUILD-57 W-1):
    // Stripe is re-checked LIVE too — `stripe_connected` is set at LINK
    // creation, before any onboarding happens, so the gate now asks Stripe
    // for charges_enabled instead of trusting our own flag. Unreachable
    // Stripe = refuse (an approval must verify; the human retries).
    const liveEin = await einLookup(appRow.ein);
    const [org] = await query(`SELECT stripe_account_id, stripe_connected FROM orgs WHERE id = ?`, [appRow.org_id]);
    const stripeChk = await stripeChargesEnabled(org?.stripe_account_id);
    const gate = {
      einFound: liveEin.found === true && (liveEin.status || "ok") === "ok",
      stripe: stripeChk.ok,
      stripeReason: stripeChk.reason,
      notDispute: appRow.status !== "dispute" || !!req.body?.resolveDispute,
    };
    if (!gate.einFound || !gate.stripe || !gate.notDispute) {
      // A refused approval is a decision too — log it (§3.2 "log every decision").
      const refused = (typeof appRow.decisions === "string" ? JSON.parse(appRow.decisions || "[]") : (appRow.decisions || []));
      refused.push({ at: new Date().toISOString(), by: req.user.userId, action: "approve_refused", gate });
      await run(`UPDATE network_applications SET decisions = ?, updated_at = NOW() WHERE id = ?`, [JSON.stringify(refused), req.params.id]);
      return res.status(400).json({ error: "gate_unmet", gate, message: "EIN verification, Stripe onboarding, and dispute resolution must all pass before approval." });
    }
    // Refresh the stored evidence with the live result the approval relied on.
    await run(`UPDATE network_applications SET ein_result = ? WHERE id = ?`,
      [JSON.stringify({ ...liveEin, checkedAt: new Date().toISOString() }), req.params.id]);
  }
  const newStatus = action === "approve" ? "approved" : action === "hold" ? "held" : "rejected";
  const decisions = (typeof appRow.decisions === "string" ? JSON.parse(appRow.decisions || "[]") : (appRow.decisions || []));
  decisions.push({ at: new Date().toISOString(), by: req.user.userId, action, reason: reason || null });
  await run(`UPDATE network_applications SET status = ?, decisions = ?, updated_at = NOW() WHERE id = ?`,
    [newStatus, JSON.stringify(decisions), req.params.id]);
  if (action === "approve") {
    await run(
      `UPDATE portal_settings SET enabled = true, network_listed = true, updated_at = NOW() WHERE org_id = ?`, [appRow.org_id]);
    linkOrgJoinsNetwork(appRow.org_id).catch(e => console.error("[network] join-link job:", e.message));
  } else {
    await run(`UPDATE portal_settings SET enabled = false, network_listed = false, updated_at = NOW() WHERE org_id = ?`, [appRow.org_id]);
  }
  res.json({ ok: true, status: newStatus });
}));
app.post("/admin/network/run-gate-sweep", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  res.json(await processNetworkGate());
}));
}

module.exports = { routers, mount };
