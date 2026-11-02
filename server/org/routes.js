// server/org/routes.js — the organization: its settings, sending domain, security, setup, AI switch, team and users.
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
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../../orgSummary");

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  TF, _tzCache, actor, checkWriteAccess, displayNameCase, formConfigMod, geocode, getOrgAccessState,
  grantMsMod, importHealth, isBlockedAddress, meRow, membershipSettings, normalizeAccent, orgLeadDays, orgOf,
  orgPlanTier, orgTime, parseMoneyOrThrow, query, ratesMod, requireAdmin, requireAuth, resend, run,
  seedOrgData, sustainerFileFacts, toDollars, wrap, writeAuditLog,
} = ctx;
function invalidateOrgTz(orgId) { _tzCache.delete(orgId); }

// ── BUILD-88c C.1 — HER OWN DOMAIN, VERIFIED ──────────────────────────────
// Three routes and no fourth: READ the state, CLAIM a domain, CHECK it. The
// claim creates the domain on Resend and stores the DNS records the org must
// publish; the check asks Resend whether they hold and flips the state.
//
// A DOMAIN BELONGS TO ONE ORG. The uniqueness is a GLOBAL index at the
// database, not an application check, because "mail from this domain is that
// organisation's" is the entire content of the claim. A second org asking for
// a domain the first has is refused with the reason, never a silent no-op.
//
// Nobody is ever blocked from sending while unverified: the identity seam falls
// back to Steward's shared domain with the org's name in the display slot and a
// Reply-To that reaches a human, and every screen says which of the two is in
// force.
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const RESERVED_SENDING_DOMAINS = new Set(["stewardapp.dev", "send.stewardapp.dev", "resend.dev", "gmail.com",
  "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "aol.com", "me.com", "live.com"]);

function sendingDomainPayload(org) {
  const records = Array.isArray(org?.sending_domain_records) ? org.sending_domain_records
    : (typeof org?.sending_domain_records === "string" ? JSON.parse(org.sending_domain_records || "[]") : []);
  const verified = org?.sending_domain_status === "verified";
  return {
    domain: org?.sending_domain || null,
    fromEmail: org?.sending_from_email || null,
    status: org?.sending_domain_status || "none",
    verified,
    verifiedAt: org?.sending_domain_verified_at || null,
    checkedAt: org?.sending_domain_checked_at || null,
    records,
    // The one sentence the screen shows, written HERE so the screen and the
    // send agree about what is happening.
    sentence: verified
      ? `Your email goes out from ${org.sending_from_email}. Donors see your address and your domain, and nothing of Steward's.`
      : org?.sending_domain
        ? `Until ${org.sending_domain} verifies, your email goes out from Steward's address with your organization's name on it, and replies come to you.`
        : "Your email goes out from Steward's address with your organization's name on it, and replies come to you. Add your own domain and donors will see yours instead.",
  };
}
let app = routers.r0;

app.get("/org/sending-domain", requireAuth, wrap(async (req, res) => {
  const [org] = await query(
    `SELECT sending_domain, sending_domain_status, sending_domain_records, sending_domain_verified_at,
            sending_domain_checked_at, sending_from_email FROM orgs WHERE id=?`, [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  res.json(sendingDomainPayload(org));
}));

app.post("/org/sending-domain", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const fromEmail = String(req.body?.fromEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(fromEmail)) return res.status(400).json({ error: "A real address at your own domain is required, for example ada@yourcharity.org." });
  const domain = String(req.body?.domain || fromEmail.split("@")[1] || "").trim().toLowerCase().replace(/^@/, "");
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: `"${domain}" is not a domain Steward can send from.` });
  if (RESERVED_SENDING_DOMAINS.has(domain)) {
    return res.status(400).json({ error: "reserved_domain",
      message: `${domain} cannot be used: it is either Steward's own, or a mailbox provider you do not control the DNS for. Use a domain your organization owns.` });
  }
  if (fromEmail.split("@")[1] !== domain) {
    return res.status(400).json({ error: "address_domain_mismatch",
      message: `${fromEmail} is not at ${domain}. The address donors see has to be at the domain you are verifying.` });
  }
  // THE WALL. Claimed at the database by a global unique index, so two orgs
  // racing for one domain cannot both win.
  const [taken] = await query("SELECT id FROM orgs WHERE LOWER(sending_domain)=? AND id<>?", [domain, orgId]);
  if (taken) {
    return res.status(409).json({ error: "domain_taken",
      message: `${domain} is already verified for another organization on Steward. A sending domain belongs to one organization; if this is yours, the other organization has to release it first.` });
  }

  // Resend owns the DNS records; Steward stores what it is told and never
  // invents one. A provider failure is reported, not swallowed into a screen
  // that shows records nobody can publish.
  let created = null;
  try {
    const out = await resend.domains.create({ name: domain });
    if (out?.error) throw new Error(out.error.message || String(out.error));
    created = out?.data || out;
  } catch (e) {
    console.error("[sending-domain] create failed:", e.message);
    return res.status(502).json({ error: "provider_unavailable",
      message: "Steward could not reach the mail provider to set up that domain. Nothing was changed; try again in a minute." });
  }
  const records = Array.isArray(created?.records) ? created.records : [];
  try {
    await run(
      `UPDATE orgs SET sending_domain=?, sending_domain_id=?, sending_domain_status=?,
                       sending_domain_records=?::jsonb, sending_domain_verified_at=NULL,
                       sending_domain_checked_at=NOW(), sending_from_email=?
        WHERE id=?`,
      [domain, created?.id || null, created?.status === "verified" ? "verified" : "pending",
       JSON.stringify(records), fromEmail, orgId]);
  } catch (e) {
    if (/uq_orgs_sending_domain/.test(e.message)) {
      return res.status(409).json({ error: "domain_taken",
        message: `${domain} was claimed by another organization a moment ago. A sending domain belongs to one organization.` });
    }
    throw e;
  }
  writeAuditLog(orgId, req.user.userId, req.user.email, "updated", "sending_domain", domain, {
    description: `Claimed ${domain} as the organization's sending domain (from ${fromEmail})`,
    new: { domain, fromEmail },
  }).catch(() => {});
  const [org] = await query(
    `SELECT sending_domain, sending_domain_status, sending_domain_records, sending_domain_verified_at,
            sending_domain_checked_at, sending_from_email FROM orgs WHERE id=?`, [orgId]);
  res.status(201).json(sendingDomainPayload(org));
}));

// CHECK — ask the provider whether the records she published hold. Every press
// is a real call; the answer is stored with the moment it was asked, so the
// screen shows a fact with a date on it rather than a spinner's memory.
app.post("/org/sending-domain/check", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [org0] = await query("SELECT sending_domain, sending_domain_id FROM orgs WHERE id=?", [orgId]);
  if (!org0?.sending_domain) return res.status(400).json({ error: "no_domain", message: "Add your domain first." });
  let got = null;
  try {
    const out = org0.sending_domain_id
      ? await resend.domains.get(org0.sending_domain_id)
      : await resend.domains.list();
    if (out?.error) throw new Error(out.error.message || String(out.error));
    got = out?.data ?? out;
    if (Array.isArray(got?.data)) got = got.data.find(d => String(d.name).toLowerCase() === org0.sending_domain) || null;
    else if (Array.isArray(got)) got = got.find(d => String(d.name).toLowerCase() === org0.sending_domain) || null;
  } catch (e) {
    console.error("[sending-domain] check failed:", e.message);
    return res.status(502).json({ error: "provider_unavailable",
      message: "Steward could not reach the mail provider just now. Nothing has changed; try the check again in a minute." });
  }
  const status = String(got?.status || "pending").toLowerCase();
  const verified = status === "verified";
  await run(
    `UPDATE orgs SET sending_domain_status=?, sending_domain_checked_at=NOW(),
                     sending_domain_verified_at = CASE WHEN ? THEN COALESCE(sending_domain_verified_at, NOW()) ELSE NULL END,
                     sending_domain_records = COALESCE(?::jsonb, sending_domain_records)
      WHERE id=?`,
    [verified ? "verified" : status === "failed" ? "failed" : "pending", verified,
     Array.isArray(got?.records) && got.records.length ? JSON.stringify(got.records) : null, orgId]);
  const [org] = await query(
    `SELECT sending_domain, sending_domain_status, sending_domain_records, sending_domain_verified_at,
            sending_domain_checked_at, sending_from_email FROM orgs WHERE id=?`, [orgId]);
  res.json(sendingDomainPayload(org));
}));

// Releasing it drops back to the shared domain — and frees the domain for
// whichever organisation actually owns it.
app.delete("/org/sending-domain", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [org0] = await query("SELECT sending_domain FROM orgs WHERE id=?", [req.user.orgId]);
  await run(
    `UPDATE orgs SET sending_domain=NULL, sending_domain_id=NULL, sending_domain_status=NULL,
                     sending_domain_records=NULL, sending_domain_verified_at=NULL,
                     sending_domain_checked_at=NULL, sending_from_email=NULL WHERE id=?`, [req.user.orgId]);
  if (org0?.sending_domain) {
    writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "deleted", "sending_domain", org0.sending_domain, {
      description: `Released ${org0.sending_domain}; email goes out on Steward's shared domain again`,
    }).catch(() => {});
  }
  res.json({ released: org0?.sending_domain || null });
}));

// Her voice: three samples she pastes in Settings. Fewer than three and the
// draft stays one plain sentence — Steward never invents a voice.
app.put("/org/voice-samples", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const raw = Array.isArray(req.body?.samples) ? req.body.samples : [];
  const samples = raw.map(x => String(x || "").trim()).filter(x => x.length >= 40).slice(0, 5).map(x => x.slice(0, 4000));
  await run("UPDATE orgs SET voice_samples=?::jsonb WHERE id=?", [samples.length ? JSON.stringify(samples) : null, req.user.orgId]);
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  res.json({ samples: samples.length, ready: voice.ready,
             needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - samples.length),
             greeting: voice.greeting || null, signoff: voice.signoff || null, signature: voice.signature || null });
}));

app.get("/org/voice-samples", requireAuth, wrap(async (req, res) => {
  const [org] = await query("SELECT voice_samples FROM orgs WHERE id=?", [req.user.orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  res.json({ samples, ready: voice.ready, needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - samples.length),
             greeting: voice.greeting || null, signoff: voice.signoff || null, signature: voice.signature || null });
}));
app = routers.r1;

// The org rule, OWNER. Only an admin who already has two-factor on may switch
// either one on, so nobody locks themselves out by clicking a box.
app.put("/org/security", requireAuth, requireAdmin, wrap(async (req, res) => {
  const want = req.body || {};
  const sets = [], args = [];
  for (const [k, col] of [["requireMfa", "require_mfa"], ["requireAdminMfa", "require_admin_mfa"], ["allowStaffLargeExports", "allow_staff_large_exports"]]) {
    if (want[k] === undefined) continue;
    if (typeof want[k] !== "boolean") return res.status(400).json({ error: `${k} must be true or false` });
    sets.push(`${col}=?`); args.push(want[k]);
  }
  // SECURE-2 item 7: idle sign-out, in whole minutes, 15 to 480.
  if (want.idleMinutes !== undefined) {
    const m = Number(want.idleMinutes);
    if (!Number.isInteger(m) || m < TF.IDLE_MIN || m > TF.IDLE_MAX)
      return res.status(400).json({ error: "idle_minutes_range", message: `Idle sign-out is between ${TF.IDLE_MIN} minutes and ${TF.IDLE_MAX / 60} hours, in whole minutes.` });
    sets.push("idle_minutes=?"); args.push(m);
  }
  if (!sets.length) return res.status(400).json({ error: "requireMfa, requireAdminMfa, idleMinutes or allowStaffLargeExports is required" });
  if (want.requireMfa === true || want.requireAdminMfa === true) {
    const u = await meRow(req.user.userId);
    if (!u || !u.mfa_enabled_at) return res.status(409).json({ error: "Turn on two-factor for yourself first." });
  }
  const o = await orgOf(req.user.orgId);
  if (TF.isDemoOrg(o)) return res.status(409).json({ error: "demo_org", message: TF.DEMO_SENTENCE });
  await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, [...args, req.user.orgId]);
  const [after] = await query(`SELECT require_mfa, require_admin_mfa, idle_minutes, allow_staff_large_exports FROM orgs WHERE id=?`, [req.user.orgId]);
  if (want.allowStaffLargeExports !== undefined) req.audit.action(want.allowStaffLargeExports ? "allowed staff to export more than 1,000 people" : "large exports by staff need an admin again");
  res.json({ requireMfa: !!after.require_mfa, requireAdminMfa: !!after.require_admin_mfa, idleMinutes: after.idle_minutes, allowStaffLargeExports: !!after.allow_staff_large_exports });
}));

// RESET A TEAMMATE'S TWO-FACTOR, OWNER. They set it up again at their next
// sign-in; every session they have ends now; they are told who and when.
app.post("/org/users/:id/mfa/reset", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (TF.isDemoOrg(await orgOf(req.user.orgId))) return res.status(409).json({ error: "demo_org", message: "The shared demo login is used by many people at once, so it cannot sign others out or change its password. In your own account this works as described." });
  const [t] = await query(`SELECT * FROM users WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "That person is not on your team." });
  const [me] = await query(`SELECT name, email FROM users WHERE id=?`, [req.user.userId]);
  await run(`UPDATE users SET mfa_secret_sealed=NULL, mfa_pending_sealed=NULL, mfa_enabled_at=NULL, mfa_last_counter=NULL, mfa_method=NULL,
                              mfa_must_setup=true, mfa_failed_count=0, mfa_locked_until=NULL, sessions_valid_after=NOW() WHERE id=?`, [t.id]);
  await run(`DELETE FROM mfa_recovery_codes WHERE user_id=?`, [t.id]);
  await run(`DELETE FROM mfa_trusted_browsers WHERE user_id=?`, [t.id]);
  await TF.revokeSessions("user_id=?", [t.id], req.user.userId);
  require("../../sessionCache").sessionCache.evict(t.id);
  const when = new Date().toUTCString();
  const mailed = await TF.mailUser(t, resend, "Your Steward two-factor was reset",
    `${me?.name || me?.email || "An owner"} reset two-factor on your Steward account on ${when}. You will be asked to set it up again the next time you sign in. If you did not expect this, reply to your team's owner.`);
  req.audit.action("two-factor reset by an owner"); req.audit.entity("user", t.id, t.email);
  res.json({ ok: true, emailed: mailed, sentence: `Reset. ${t.name || t.email} sets two-factor up again at their next sign-in, `
    + (mailed ? "and was emailed to say you did this." : "but Steward could not email them about it, so tell them yourself.") });
}));

// SIGN A TEAMMATE OUT EVERYWHERE, OWNER.
app.post("/org/users/:id/sign-out-everywhere", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (TF.isDemoOrg(await orgOf(req.user.orgId))) return res.status(409).json({ error: "demo_org", message: "The shared demo login is used by many people at once, so it cannot sign others out or change its password. In your own account this works as described." });
  const [t] = await query(`SELECT id, name, email FROM users WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "That person is not on your team." });
  await run(`UPDATE users SET sessions_valid_after=NOW() WHERE id=?`, [t.id]);
  require("../../sessionCache").sessionCache.evict(t.id);
  const n = await TF.revokeSessions("user_id=?", [t.id], req.user.userId);
  req.audit.action("signed a teammate out everywhere"); req.audit.entity("user", t.id, t.email);
  res.json({ ok: true, ended: n, sentence: `${t.name || t.email} is signed out of every browser.` });
}));

// ── Onboarding ─────────────────────────────────────────────────────────────
app.post("/onboarding/complete", requireAuth, wrap(async (req, res) => {
  await seedOrgData(req.user.orgId);
  await run("UPDATE orgs SET onboarding_complete = 1 WHERE id = ?", [req.user.orgId]);
  res.json({ success: true });
}));

// ── Org ────────────────────────────────────────────────────────────────────
app.get("/org", requireAuth, wrap(async (req, res) => {
  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = orgs[0];
  // FIX-50: `demo` is the one rule (orgKind.isDemoOrg); the banner reads it.
  // FIX-55 item 6: what this server has connected, as booleans only (never a
  // key). A screen whose feature needs a service that is not set up hides it.
  res.json({ ...org, demo: require("../../orgKind").isDemoOrg(org), accessState: getOrgAccessState(org),
    capabilities: {
      geocoding: geocode.geocodingConfigured(),
      // aiClient.aiGate's rule without the budget: a key, and the org's switch.
      ai: !!process.env.ANTHROPIC_API_KEY && org.ai_enabled !== false,
      // server.js builds the donation Stripe client from this one key.
      stripe: !!require("../../stripeKeys").donationStripeKey(),
    } });
}));

// ── BUILD-86 PART B — HER WORDS ────────────────────────────────────────────
// Five questions, answered once, read by every staff-facing surface. The
// answers are PRESENTATION ONLY: nothing here renames a column, an id, an API
// field or a route, and nothing here reaches a receipt, a year-end statement
// or the donor portal (a §170 acknowledgment is a legal document).
//
// GET returns the normalised vocabulary plus the org's OWN EVIDENCE for the
// questions its file already answered — the fund names the import created —
// so the first run never asks what she has already told us.
// ── BUILD-94 FIRST RUN — the greeting an organisation gets once ────────────
// Everything on the greeting comes from here, so the screen cannot invent a
// mission or a name the org never typed. `show` is the whole decision: the
// user has not been welcomed yet, and the org has something to say.
app.get("/org/welcome", requireAuth, wrap(async (req, res) => {
  const [org] = await query(
    `SELECT name, mission, welcome_motif, welcome_words, welcome_line, welcome_next_step, logo_data
       FROM orgs WHERE id = ?`, [req.user.orgId]);
  const [me] = await query(
    `SELECT name, welcomed_at FROM users WHERE id = ?`, [req.user.userId]);
  const first = String(me?.name || "").trim().split(/\s+/)[0] || null;
  // CKRH-1 — the funds the org already has, by name, at most three. A greeting
  // that can say "Horse Care is already here" is telling her something TRUE
  // about her own account; the same screen with invented funds on it would be
  // the exact thing a real org must never be shown. Sample funds are excluded
  // for that reason, and an org with none simply shows none.
  const funds = await query(
    `SELECT name FROM fin_funds
      WHERE org_id = ? AND COALESCE(is_sample, false) = false
      ORDER BY restricted DESC, created_at, name LIMIT 3`, [req.user.orgId]);
  res.json({
    show: !!me && me.welcomed_at == null,
    firstName: first,
    orgName: displayNameCase(org?.name || "") || null,
    mission: org?.mission || null,
    motif: org?.welcome_motif || null,
    words: Array.isArray(org?.welcome_words) ? org.welcome_words.slice(0, 4).map(String) : [],
    line: org?.welcome_line || null,
    nextStep: org?.welcome_next_step || null,
    // The org's OWN logo, the one already on its receipts — not a second upload
    // and not a copy, so the greeting cannot show a brand the product has since
    // been told to stop using.
    logo: org?.logo_data || null,
    funds: funds.map(f => String(f.name)),
  });
}));

// Stamped when it has been SEEN, not when it was rendered — a greeting that
// marks itself shown on a page that then failed to paint is a greeting nobody
// ever got. Idempotent: a second call leaves the first timestamp alone.
app.post("/org/welcome/seen", requireAuth, wrap(async (req, res) => {
  await run(`UPDATE users SET welcomed_at = NOW() WHERE id = ? AND welcomed_at IS NULL`, [req.user.userId]);
  res.json({ ok: true });
}));

app.get("/org/vocabulary", requireAuth, wrap(async (req, res) => {
  const V = await import("../../shared/vocabulary.js");
  const [org] = await query("SELECT vocabulary_json, vocabulary_set_at FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const funds = await query(
    "SELECT name FROM fin_funds WHERE org_id=? AND COALESCE(is_sample,false)=false ORDER BY name LIMIT 12",
    [req.user.orgId]);
  res.json({
    vocabulary: V.normalizeVocabulary(org.vocabulary_json),
    stored: org.vocabulary_json ? JSON.parse(org.vocabulary_json) : {},
    setAt: org.vocabulary_set_at || null,
    // Her own words, already in the product, for question three.
    evidence: { funds: funds.map(f => f.name) },
    questions: V.VOCAB_QUESTIONS,
    defaults: V.VOCAB_DEFAULTS,
  });
}));

// PUT — admin + checkWriteAccess, because it changes what every screen in the
// org says. `{skip:true}` records the DECISION not to answer: the first run is
// offered once, and a skip must not leave a state that keeps asking.
app.put("/org/vocabulary", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const V = await import("../../shared/vocabulary.js");
  if (req.body && req.body.skip === true) {
    await run("UPDATE orgs SET vocabulary_set_at=NOW() WHERE id=?", [req.user.orgId]);
    return res.json({ skipped: true, vocabulary: V.normalizeVocabulary(null) });
  }
  // Only the fixed keys survive: a hostile or mistyped payload cannot invent
  // vocabulary, and only what DIFFERS from today's strings is stored.
  const store = V.vocabularyToStore(req.body || {});
  await run("UPDATE orgs SET vocabulary_json=?, vocabulary_set_at=NOW() WHERE id=?",
    [JSON.stringify(store), req.user.orgId]);
  res.json({ vocabulary: V.normalizeVocabulary(store), stored: store });
}));

// ── BUILD-35: "Set up Steward" activation checklist ─────────────────────────
// Every item's done-state is COMPUTED live from the actual org data — never
// stored per-step — so an item checks itself off however the underlying thing
// became true (wizard, Settings, a teammate). No checklist state can drift
// out of sync with reality (the count-matches-destination lesson applied to
// setup). Only the card's dismissal preference is stored (orgs.setup_card_state).
const SETUP_DONOR_THRESHOLD = 5; // >5 real donors = "imported" (matches the sample-data loader's real-org bar)

app.get("/org/setup-status", requireAuth, OS.cached("setup-status"), wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = orgs[0];
  const tier = orgPlanTier(org);

  const [donorRow, giftRow, pageRow, threadRow, userRow, inviteRow] = await Promise.all([
    // NUMBERS-4: people, counted once (shared/numbers/households.js).
    NUMBERS.households.counts(query, orgId).then(c => [{ n: c.people }]),
    // NUMBERS-3 (D-7): a soft or matching credit row is not a gift on file.
    query(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE AND ${NUMBERS.money.MONEY("g")}`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM giving_pages WHERE org_id = ? AND status = 'active' AND COALESCE(page_kind,'give') = 'give'`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id = ?`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM users WHERE org_id = ?`, [orgId]),
    query(`SELECT COUNT(*)::int AS n, MIN(expires_at) AS next_expiry FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > NOW()`, [orgId]),
  ]);
  // SCALE-2: the stored answer (orgSummary.js) turns over when the next
  // pending invite expires, the one thing here that moves with the clock.
  if (inviteRow[0].next_expiry) res.locals.orgSummaryValidUntil = inviteRow[0].next_expiry;
  const donorCount = donorRow[0].n;
  const giftCount = giftRow[0].n;

  // In value order. `key` is stable (the client owns labels/why-lines/deep
  // links); `done` is the live computation. The invite item exists only on
  // Team tier — plan-graceful means HIDDEN on Core, not shown-and-locked.
  // BUILD-95 §4 — a connected giving source counts as activation too.
  let connectedSourceCount = 0;
  try {
    const [cs] = await query(
      `SELECT COUNT(*)::int AS n FROM giving_sources WHERE org_id = ? AND status <> 'disconnected'`, [orgId]);
    connectedSourceCount = cs ? cs.n : 0;
  } catch { /* pre-89S database — no sources table yet, and none connected */ }
  const sustainerFacts = await sustainerFileFacts(orgId);   // BUILD-83 Part 5.1 — the ONE definition
  const sustainerSent = await query(
    `SELECT COUNT(*)::int AS n FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.imported_sustainer IS TRUE
        AND EXISTS (SELECT 1 FROM reconnect_sends rs WHERE rs.org_id = d.org_id AND rs.donor_id = d.id)`, [orgId]);
  const sustainerRow = [{ total: sustainerFacts.fromFile, stopped: sustainerFacts.stopped, stopped_sent: sustainerSent[0]?.n || 0 }];
  const items = [
    // BUILD-79 Part 6 — donors without a single gift do not tick the box: an
    // import that dropped every dollar is not "done". A human can confirm the
    // file genuinely had no gifts (POST /org/setup-confirm-no-gifts).
    { key: "donors",
      done: donorCount > SETUP_DONOR_THRESHOLD && (giftCount > 0 || !!org.setup_no_gifts_confirmed),
      count: donorCount, giftCount,
      needsGiftConfirm: donorCount > SETUP_DONOR_THRESHOLD && giftCount === 0 && !org.setup_no_gifts_confirmed },
    // BUILD-95 §4 — ONE ITEM, TWO JOBS, AND NEITHER OF THEM IS A VENDOR'S NAME.
    // This read "Connect Stripe" — our card processor's name, in her setup
    // list, as if it were the task. It is not: the task is "money either
    // reaches you through Steward, or Steward can see the money reaching you
    // somewhere else", and an organisation that connected the Square account
    // it already takes gifts on has genuinely activated even though it has
    // never heard of Stripe.
    //
    // OR, not AND, deliberately. Requiring both would refuse to tick for the
    // org that only ever wants Steward to watch — which is BUILD-89S's whole
    // premise ("keep what you take gifts through").
    { key: "onlineGiving", done: !!org.stripe_account_id || connectedSourceCount > 0 },
    { key: "address", done: !!(org.receipt_address && String(org.receipt_address).trim()) },
    { key: "givingPage", done: pageRow[0].n > 0 },
    // BUILD-81 — "Turn on your first automation" became "Log your first
    // conversation": it ticks when the first THREAD exists, which only a real
    // logged conversation (or a live gift) can create. The old workflow item
    // ticked on a fresh org that had done nothing.
    { key: "conversation", done: threadRow[0].n > 0 },
    // INT-BUILD-1 Part 0 — CONNECT YOUR INBOX, and it is the VIEWER'S step:
    // a mailbox is one person's, so it ticks for whoever connected their own.
    // A demo org counts it done, because its example connection is the point.
    { key: "inbox", done: require("../../orgKind").isDemoOrg(org)
        || (await query(`SELECT 1 FROM mailbox_connections WHERE user_id=? AND org_id=? AND status <> 'disconnected' LIMIT 1`,
                        [req.user.userId, orgId]).catch(() => [])).length > 0 },
    // BUILD-83 Part 5.3 — MOVE YOUR MONTHLY DONORS, after the first
    // conversation. This is the closer from the Sept-6 positioning and it was
    // nowhere in the product: the org's file names its sustainers, Steward
    // detects them, and moving them here is the thing only Steward asks for.
    // The step exists only for an org whose file actually HAS sustainers, and
    // it is done when every stopped one has been sent a reconnect link.
    ...(sustainerRow[0].total > 0 ? [{ key: "sustainers", done: sustainerRow[0].stopped === 0 || sustainerRow[0].stopped_sent >= sustainerRow[0].stopped,
        detail: { total: sustainerRow[0].total, stopped: sustainerRow[0].stopped } }] : []),
    ...(tier === "team" ? [{ key: "team", done: userRow[0].n >= 2 || inviteRow[0].n > 0 }] : []),
  ];
  const doneCount = items.filter(i => i.done).length;
  res.json({
    items,
    doneCount,
    totalCount: items.length,
    complete: doneCount === items.length,
    cardState: org.setup_card_state || null,
    tier,
  });
}));

// The card's dismissal preference — per ORG (admins share it), requireAdmin.
// Deliberately NOT checkWriteAccess-gated: collapsing a setup card is a
// display preference, not org data; a read_only org may still tidy its Home.
// BUILD-79 Part 6 — the explicit "my file genuinely had no gifts" confirmation
// that lets the donors checklist item tick at $0. Admin, one-way (re-importing
// with gifts makes it moot).
app.post("/org/setup-confirm-no-gifts", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("UPDATE orgs SET setup_no_gifts_confirmed = TRUE WHERE id = ?", [req.user.orgId]);
  res.json({ ok: true });
}));

app.put("/org/setup-card", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { state } = req.body || {};
  const normalized = state === "" || state == null ? null : state;
  if (normalized !== null && normalized !== "collapsed" && normalized !== "hidden") {
    return res.status(400).json({ error: "state must be null, 'collapsed', or 'hidden'" });
  }
  await run(`UPDATE orgs SET setup_card_state = ? WHERE id = ?`, [normalized, req.user.orgId]);
  res.json({ success: true, cardState: normalized });
}));

app.patch("/orgs/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  if (req.user.orgId !== req.params.id) return res.status(404).json({ error: "Not found" });
  const { name, mission, focusArea, annualBudget, foundedYear, website,
          legalName, ein, receiptAddress, receiptSignatureName, receiptSignatureTitle, receiptCustomMessage, receiptsEnabled } = req.body;
  // name is optional — only the new onboarding flow's "org basics" step
  // sends it (letting a fresh org tweak the name they typed at signup);
  // Settings' org-profile form never has, so it must stay opt-in rather
  // than overwriting a real org's name with null on every other caller.
  if (name && name.trim()) {
    await run(`UPDATE orgs SET name=? WHERE id=?`, [name.trim(), req.params.id]);
  }
  // Only rewrite the profile fields when the request actually carries any of
  // them — a settings-toggle-only PATCH (e.g. coverFeesEnabled below) must
  // not null out the org's mission/website as a side effect.
  if ([mission, focusArea, annualBudget, foundedYear, website].some(v => v !== undefined)) {
    // SECURE-1: a web address or nothing; any other scheme is refused.
    if (website != null && require("../../webAddress").webAddress(website) === null)
      return res.status(400).json({ error: "bad_website", message: "The website should be a web address, like yourorg.org." });
    await run(
      `UPDATE orgs SET mission=?, focus_area=?, annual_budget=?, founded_year=?, website=? WHERE id=?`,
      [mission || null, focusArea || null, annualBudget || null, foundedYear ? parseInt(foundedYear, 10) : null, require("../../webAddress").webAddress(website) || null, req.params.id]
    );
  }

  // BUILD-72 Part 4 — the organization's timezone. EVERY date boundary in the
  // product is computed in this zone, so a wrong value is not cosmetic: it
  // moves what "this week" and "overdue" mean. Validated against Intl (the
  // authority on IANA zones — never a hand-kept list) and rejected rather than
  // silently defaulted, because a silent default here is exactly the class of
  // bug Part 4 exists to remove.
  if (req.body.timezone !== undefined) {
    const tz = String(req.body.timezone || "").trim();
    if (!orgTime.isValidTimezone(tz)) {
      return res.status(400).json({
        error: "invalid_timezone",
        message: `"${tz}" is not a recognized IANA timezone (for example: America/New_York, America/Chicago, Asia/Kolkata).`,
      });
    }
    // BUILD-84 — a timezone that came through this route came from a HUMAN,
    // which is what the timed step reminder requires. The column's NOT NULL
    // default has always made "has a timezone" trivially true; this stamp is
    // the difference between a choice and Steward's guess.
    await run(`UPDATE orgs SET timezone=?, timezone_confirmed_at=NOW() WHERE id=?`, [tz, req.params.id]);
    invalidateOrgTz(req.params.id);   // the 30s read cache must not serve the old zone
  }

  // BUILD-94 FIRST RUN — the org's own motif and its own words, on the same
  // route as its mission and website, because that is what they are: the
  // organisation saying what it is. Both opt-in (only touched when sent), and
  // a motif the product does not draw simply does not draw — an unknown value
  // is stored and ignored rather than rejected, so naming a motif before it
  // exists is harmless.
  if (req.body.welcomeMotif !== undefined) {
    const m = String(req.body.welcomeMotif || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    await run(`UPDATE orgs SET welcome_motif=? WHERE id=?`, [m || null, req.params.id]);
  }
  // CKRH-1 — the sentence and the one next step, on the same route and with the
  // same opt-in rule as the motif and the words: touched only when sent, and an
  // empty string clears back to the product default rather than storing "".
  if (req.body.welcomeLine !== undefined) {
    const l = String(req.body.welcomeLine || "").trim().slice(0, 240);
    await run(`UPDATE orgs SET welcome_line=? WHERE id=?`, [l || null, req.params.id]);
  }
  if (req.body.welcomeNextStep !== undefined) {
    const n = String(req.body.welcomeNextStep || "").trim().slice(0, 240);
    await run(`UPDATE orgs SET welcome_next_step=? WHERE id=?`, [n || null, req.params.id]);
  }
  if (req.body.welcomeWords !== undefined) {
    // At most four, each short — this is an eyebrow, not a paragraph.
    const w = Array.isArray(req.body.welcomeWords)
      ? req.body.welcomeWords.map(x => String(x).trim()).filter(Boolean).slice(0, 4).map(x => x.slice(0, 24))
      : [];
    await run(`UPDATE orgs SET welcome_words=?::jsonb WHERE id=?`, [JSON.stringify(w), req.params.id]);
  }

  // Donor-covers-fees switch — only touched when the request includes it
  // (Settings' Giving section sends it; no other PATCH caller does).
  // BUILD-102 Part 2 — the upsell threshold, in CENTS. What counts as a gift
  // worth asking about differs by an order of magnitude between a food pantry and
  // a university, so it is the org's number. A value below $5 is refused rather
  // than stored: below that the monthly suggestion is not worth the question, and
  // a threshold of zero would ask every single donor.
  if (req.body.upsellThresholdCents !== undefined) {
    const F = await formConfigMod();
    const raw = req.body.upsellThresholdCents;
    if (raw === null || raw === "") {
      await run(`UPDATE orgs SET form_upsell_threshold_cents=NULL WHERE id=?`, [req.params.id]);
    } else {
      const c = Number(raw);
      if (!Number.isInteger(c) || c < F.UPSELL_MIN_MONTHLY_CENTS * F.UPSELL_FRACTION) {
        return res.status(400).json({ code: "bad_upsell_threshold",
          error: `The threshold is a whole number of cents, at least ${F.UPSELL_MIN_MONTHLY_CENTS * F.UPSELL_FRACTION}, below that the monthly suggestion is too small to be worth asking about.` });
      }
      await run(`UPDATE orgs SET form_upsell_threshold_cents=? WHERE id=?`, [c, req.params.id]);
    }
  }
  // GIVE-2 §6 — the monthly amount the org suggests when it asks a one-time
  // donor to make it monthly. NULL goes back to a third of the gift.
  if (req.body.upsellMonthlyCents !== undefined) {
    const F = await formConfigMod();
    const raw = req.body.upsellMonthlyCents;
    if (raw === null || raw === "") {
      await run(`UPDATE orgs SET form_upsell_monthly_cents=NULL WHERE id=?`, [req.params.id]);
    } else {
      const c = Number(raw);
      if (!Number.isInteger(c) || c < F.UPSELL_MIN_MONTHLY_CENTS) {
        return res.status(400).json({ code: "bad_upsell_monthly",
          error: `A suggested monthly amount is a whole number of cents, at least ${F.UPSELL_MIN_MONTHLY_CENTS}.` });
      }
      await run(`UPDATE orgs SET form_upsell_monthly_cents=? WHERE id=?`, [c, req.params.id]);
    }
  }
  if (req.body.coverFeesEnabled !== undefined) {
    await run(`UPDATE orgs SET cover_fees_enabled=? WHERE id=?`, [!!req.body.coverFeesEnabled, req.params.id]);
  }

  // ── GIVE-2 §5 — THE ORG'S OWN PROCESSING RATES ────────────────────────────
  // What the cover-the-fee box ASKS for. Until this existed it was Stripe's
  // published card rate hard-coded in three files, which is wrong in the
  // expensive direction for an org on Stripe's nonprofit rate (2.2%) and for
  // every bank transfer (0.8% capped at $5).
  //
  // A percentage is TYPED AS A PERCENTAGE and stored as a fraction — an org
  // reads "2.2" off its Stripe dashboard, and a screen that took 2.2 to mean
  // 220% would ask a donor to cover three times their gift. The conversion and
  // the range check are both in `shared/processingRates.js`, which is also what
  // the gross-up reads, so a rate the settings screen accepted cannot be a rate
  // the form refuses.
  //
  // `null` for a kind means "go back to Stripe's published rate", which is where
  // every org starts.
  if (req.body.processingRates !== undefined) {
    const R = await ratesMod();
    const v = R.validateRates(req.body.processingRates);
    if (!v.ok) return res.status(400).json({ code: "bad_processing_rate", error: v.errors[0].message, errors: v.errors });
    for (const [kind, rate] of Object.entries(v.rates)) {
      if (kind === "card") {
        await run(`UPDATE orgs SET fee_rate_card_pct=?, fee_rate_card_flat_cents=? WHERE id=?`,
          [rate ? rate.pct : null, rate ? rate.flatCents : null, req.params.id]);
      } else if (kind === "ach") {
        await run(`UPDATE orgs SET fee_rate_ach_pct=?, fee_rate_ach_flat_cents=?, fee_rate_ach_cap_cents=? WHERE id=?`,
          [rate ? rate.pct : null, rate ? rate.flatCents : null, rate ? rate.capCents : null, req.params.id]);
      }
    }
  }

  // BUILD-81 — the thread-nudge weekend toggle (org-level; the nudge itself
  // is weekday-only by default). Only touched when the request includes it.
  if (req.body.threadNudgeWeekends !== undefined) {
    await run(`UPDATE orgs SET thread_nudge_weekends=? WHERE id=?`, [!!req.body.threadNudgeWeekends, req.params.id]);
  }

  // BUILD-88a A.6 — "Other income this year": one figure the org keeps
  // elsewhere, off by default. Shown on its own line under giving on the board
  // and in its PDF, and NEVER summed into giving.
  if (req.body.otherIncomeEnabled !== undefined) {
    await run(`UPDATE orgs SET other_income_enabled=? WHERE id=?`, [!!req.body.otherIncomeEnabled, req.params.id]);
  }
  if (req.body.otherIncomeThisYear !== undefined) {
    const raw = req.body.otherIncomeThisYear;
    if (raw === null || String(raw).trim() === "") {
      await run(`UPDATE orgs SET other_income_this_year=NULL WHERE id=?`, [req.params.id]);
    } else {
      let cents;
      try { cents = parseMoneyOrThrow(raw, "otherIncomeThisYear"); }
      catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
      if (cents < 0) return res.status(400).json({ error: "Other income cannot be negative." });
      await run(`UPDATE orgs SET other_income_this_year=? WHERE id=?`, [toDollars(cents), req.params.id]);
    }
  }
  // ── REPORTS-3 — THE STAFF AND BOARD ADDRESSES A BOARD PACK GOES TO ──────
  // The organisation's OWN leadership. Three things are refused rather than
  // accepted and worked around later: an address that is not one, an address
  // on the mail block (mailBlock.js, from any org, for any reason) and an
  // address belonging to a DONOR of this org. The last is the one that
  // matters: "the org's own leadership, never donors" is the rule this list
  // exists under, and a typo that put a major donor's address here would mail
  // them the org's retention figures. Steward can check that, so it does.
  if (req.body.boardPackEmails !== undefined) {
    const raw = Array.isArray(req.body.boardPackEmails) ? req.body.boardPackEmails : [];
    if (raw.length > 50) return res.status(400).json({ error: "That is more than fifty addresses." });
    const seen = new Set(), list = [];
    for (const v of raw) {
      const addr = String(v || "").trim();
      if (!addr) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) return res.status(400).json({ error: `"${addr}" is not an email address.` });
      const key = addr.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); list.push(addr);
    }
    for (const addr of list) {
      if (isBlockedAddress(addr)) return res.status(400).json({ error: `Steward does not send to ${addr}.` });
    }
    if (list.length) {
      const donors = await query(
        `SELECT name, email FROM donors
          WHERE org_id = ? AND deleted_at IS NULL AND LOWER(email) = ANY(?) LIMIT 1`,
        [req.params.id, list.map(a => a.toLowerCase())]);
      if (donors.length) {
        return res.status(400).json({
          error: `${donors[0].email} is on file as a donor. A board pack goes to your staff and board, never to a donor.` });
      }
    }
    await run(`UPDATE orgs SET board_pack_emails=? WHERE id=?`, [JSON.stringify(list), req.params.id]);
  }

  // BUILD-88a A.1 — the BUILD-83 posting rule as a switch. Imported history
  // never posts whatever this says; a LIVE gift posts while it is on.
  if (req.body.ledgerPostingEnabled !== undefined) {
    await run(`UPDATE orgs SET ledger_posting_enabled=? WHERE id=?`, [!!req.body.ledgerPostingEnabled, req.params.id]);
  }

  // Tax receipt settings — only touched when the request actually includes
  // at least one of these fields (Settings' Tax Receipts panel sends them;
  // onboarding's "org basics" step and other PATCH callers never do).
  const touchesReceiptFields = [legalName, ein, receiptAddress, receiptSignatureName, receiptSignatureTitle, receiptCustomMessage, receiptsEnabled].some(v => v !== undefined);
  if (touchesReceiptFields) {
    const existingRows = await query(
      "SELECT legal_name, ein, receipt_address, receipt_signature_name, receipt_signature_title, receipt_custom_message, receipts_enabled FROM orgs WHERE id=?",
      [req.params.id]
    );
    const existing = existingRows[0] || {};

    let normalizedEin = existing.ein;
    if (ein !== undefined) {
      if (ein) {
        normalizedEin = normalizeEin(ein);
        if (!normalizedEin) return res.status(400).json({ error: "EIN must be 9 digits (XX-XXXXXXX)." });
      } else {
        normalizedEin = null;
      }
    }
    const effectiveLegalName = legalName !== undefined ? (legalName.trim() || null) : existing.legal_name;
    const effectiveAddress = receiptAddress !== undefined ? (receiptAddress.trim() || null) : existing.receipt_address;

    // Server refuses to flip receipts_enabled true unless legal_name, ein,
    // and receipt_address are ALL present — checked against the effective
    // (post-this-request) values, so a request that sets receiptsEnabled:
    // true *and* fills in the missing fields in the same call works.
    const effectiveEnabled = receiptsEnabled !== undefined ? !!receiptsEnabled : existing.receipts_enabled;
    if (effectiveEnabled && (!effectiveLegalName || !normalizedEin || !effectiveAddress)) {
      return res.status(400).json({ error: "Legal name, EIN, and receipt address are required before enabling tax receipts." });
    }

    await run(
      `UPDATE orgs SET legal_name=?, ein=?, receipt_address=?, receipt_signature_name=?, receipt_signature_title=?, receipt_custom_message=?, receipts_enabled=? WHERE id=?`,
      [
        effectiveLegalName,
        normalizedEin,
        effectiveAddress,
        receiptSignatureName !== undefined ? (receiptSignatureName.trim() || null) : existing.receipt_signature_name,
        receiptSignatureTitle !== undefined ? (receiptSignatureTitle.trim() || null) : existing.receipt_signature_title,
        receiptCustomMessage !== undefined ? (receiptCustomMessage || null) : existing.receipt_custom_message,
        effectiveEnabled,
        req.params.id,
      ]
    );
  }

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.params.id]);
  res.json(orgs[0]);
}));

// ── Org branding (BUILD-13 Part 2 — tasteful white-label) ───────────────────
// Logo (base64 data-URI) + one accent color. The accent is normalized to an
// accessible range on save (branding.js) so the UI can never render illegibly.
// requireAdmin (org identity is an admin setting) + checkWriteAccess (a
// read_only/lapsed org can't change branding, like any other write).
const LOGO_MAX_BYTES = 512 * 1024; // ~512KB of data-URI text; a real logo is far smaller
app.put("/orgs/branding", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { logoData, brandAccent, removeLogo } = req.body;
  const sets = [], params = [];
  let normalized = null;

  if (brandAccent !== undefined) {
    if (brandAccent === null || brandAccent === "") {
      sets.push("brand_accent=NULL", "brand_accent_fg=NULL"); // revert to Steward default
    } else {
      normalized = normalizeAccent(brandAccent);
      if (!normalized) return res.status(400).json({ error: "Accent must be a hex color like #1a6b4a." });
      sets.push("brand_accent=?", "brand_accent_fg=?");
      params.push(normalized.accent, normalized.fg);
    }
  }
  if (removeLogo) {
    sets.push("logo_data=NULL");
  } else if (logoData !== undefined && logoData !== null) {
    if (typeof logoData !== "string" || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(logoData))   // SECURE-1: no SVG
      return res.status(400).json({ error: "Logo must be a PNG, JPEG, GIF or WebP image." });
    if (Buffer.byteLength(logoData, "utf8") > LOGO_MAX_BYTES)
      return res.status(400).json({ error: "Logo is too large, please use an image under 350KB." });
    sets.push("logo_data=?"); params.push(logoData);
  }

  if (sets.length) {
    params.push(req.user.orgId);
    await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, params);
  }
  const orgs = await query("SELECT id, name, logo_data, brand_accent, brand_accent_fg FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ ...orgs[0], adjusted: !!(normalized && normalized.adjusted) });
}));

// ── BUILD-96 Part 3 — WHAT THE SCREEN NEEDS TO KNOW BEFORE IT DRAWS ────────
// The client reads this so a control can be ABSENT rather than present and
// broken. "Photograph the cheques" that returns a 503 when pressed is worse
// than no button: it teaches somebody the product is unreliable, when the
// truth is that a key is not set.
//
// It reports the two conditions SEPARATELY, because they are different facts
// about different people. `configured` is Steward's — whether a key exists at
// all. `enabled` is the organisation's own choice. A screen that collapsed
// them would tell an org it had switched something off that it never touched.
app.get("/org/ai-status", requireAuth, wrap(async (req, res) => {
  const [org] = await query("SELECT ai_enabled FROM orgs WHERE id=?", [req.user.orgId]);
  const configured = !!process.env.ANTHROPIC_API_KEY;
  const enabled = !(org && org.ai_enabled === false);
  res.json({
    configured,
    enabled,
    // The two features, named, so a future one does not inherit this answer by
    // accident.
    chequeReading: configured && enabled,
    agentDrafting: configured && enabled,
    provider: "Anthropic",
  });
}));

// The switch. Org admin, not super-admin: it is the organisation's decision
// about its own donors' images, and the sentence it belongs to is in its own
// Settings.
app.patch("/org/ai-settings", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled (boolean) required" });
  await run("UPDATE orgs SET ai_enabled=? WHERE id=?", [enabled, req.user.orgId]);
  console.log(`[ai-settings] ${req.user.orgId} ai_enabled=${enabled} by ${req.user.email || req.user.userId}`);
  // FIX-2 D — the same switch is in Settings → Data and Agent → Guardrails, and
  // both write HERE; the audit log says who turned drafting on or off.
  const [who] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  await writeAuditLog(req.user.orgId, actor(req).id, (who && who.name) || actor(req).name, enabled ? "turned_on" : "turned_off", "ai_drafting", req.user.orgId, { enabled });
  res.json({ ok: true, enabled, configured: !!process.env.ANTHROPIC_API_KEY });
}));

// ── One-time backfill: create missing gift touchpoints ────────────────────
// For gifts that pre-date the touchpoint-creation code in the history importer.
// Safe to re-run: skips any gift that already has a type='gift' interaction
// whose note contains the same dollar amount (donor_id + date + amount match).
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── Team ───────────────────────────────────────────────────────────────────
app.get("/org/team", requireAuth, wrap(async (req, res) => {
  // Active members only — a removed (soft-detached) user leaves the team list
  // but their authored rows keep their created_by identity (BUILD-75 C.1/C.3).
  const members = await query(
    // SEC-1 — whether each person has two-factor on, for the owner's Security list.
    "SELECT id, email, name, role, created_at, (mfa_enabled_at IS NOT NULL) AS mfa_enabled, mfa_must_setup, (role = 'admin' OR COALESCE(can_major_gifts, false)) AS can_major_gifts FROM users WHERE org_id = ? AND deactivated_at IS NULL ORDER BY created_at ASC",
    [req.user.orgId]
  );
  res.json(members);
}));

// ── BUILD-75 C.3 — USER REMOVAL, finally ────────────────────────────────────
// Settings could invite but not remove; the only path was manual database
// surgery (which caused the documented dangling-FK incident). Removal is a
// SOFT DETACH: the row survives (institutional memory — everything they
// authored keeps its actor), their sessions are revoked through the BUILD-38
// machinery, login is blocked, and their operational attachments (portfolio,
// open task assignments) are released. DELETE-shaped, so per the standing
// convention it is deliberately NOT checkWriteAccess-gated.
// BUILD-93 Part 2 — every user removal, and every REFUSED removal, leaves an
// actor behind. FIX-12 Part 5: that row is the audit middleware's (one audit
// write); this route only names it. The refusals are logged because
// auditTrail.js marks DELETE /users/:id with logFailures.
app.delete("/users/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { orgId } = req.user;
  const [target] = await query(
    "SELECT id, role, email, deactivated_at, is_super_admin FROM users WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!target || target.deactivated_at) return res.status(404).json({ error: "Not found" });

  // Everything that refuses below is RECORDED, not just returned. A refusal is
  // an attempt, and an attempt on a super-admin is the thing you most want to
  // find afterwards.
  req.audit.entity("user", target.id);
  req.audit.before({ role: target.is_super_admin ? "super_admin" : (target.role || null) });
  const refuse = async (status, error, message) => {
    req.audit.after({ refused: error });
    return res.status(status).json({ error, message });
  };

  if (target.id === req.user.userId) {
    return refuse(400, "cannot_remove_self", "You can't remove your own account. Ask another admin.");
  }

  // ── BUILD-93 Part 2 — A SUPER-ADMIN IS NOT AN ORG ADMIN'S TO REMOVE ──────
  // The last-admin guard below counts `role='admin'` and has never looked at
  // is_super_admin, so the seeded demo admin - whose password is in this repo
  // - could remove the only super-admin on production and the count would be
  // satisfied, because it is itself an admin. Deactivation then locks the door
  // behind it: requireAuth refuses a deactivated user, so every super-admin
  // surface becomes unreachable by anybody, with no in-product way back.
  //
  // Two rules, in this order, because they answer different questions:
  //   1. Only a super-admin may remove a super-admin at all.
  //   2. Not even a super-admin may remove the LAST active one.
  if (target.is_super_admin === true) {
    if (req.user.isSuperAdmin !== true) {
      return refuse(403, "super_admin_protected",
        "That account is a Steward super-admin and cannot be removed from an organization's team settings.");
    }
    const [{ c }] = await query(
      "SELECT COUNT(*)::int AS c FROM users WHERE is_super_admin=true AND deactivated_at IS NULL AND id<>?", [target.id]);
    if (!c) {
      return refuse(400, "last_super_admin",
        "That is the last active super-admin. Removing it would lock everyone out of the super-admin console, including you. Promote another super-admin first.");
    }
  }

  if (target.role === "admin") {
    const [{ c }] = await query("SELECT COUNT(*)::int AS c FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL AND id<>?", [orgId, target.id]);
    if (!c) return refuse(400, "last_admin", "You can't remove the last admin of an organization.");
  }
  // Soft-detach + revoke every session (sessions_valid_after is the BUILD-38
  // revocation clock requireAuth checks; worst-case lag is the session-cache
  // TTL, same as a password reset).
  await run("UPDATE users SET deactivated_at=NOW(), sessions_valid_after=NOW() WHERE id=? AND org_id=?", [target.id, orgId]);
  await require("../../twoFactor").revokeSessions("user_id=?", [target.id], req.user.userId).catch(() => {});   // SEC-1
  req.audit.action("removed from the team"); req.audit.after({ removed: true });
  // Release operational attachments — assignment is portfolio/board membership
  // (BUILD-30), and a removed officer's donors go back to the Directory
  // unassigned rather than orbiting a ghost. Authorship (created_by) is
  // untouched everywhere, deliberately.
  const dn = await run("UPDATE donors SET assigned_to=NULL, assigned_to_name=NULL WHERE org_id=? AND assigned_to=?", [orgId, target.id]);
  const tn = await run("UPDATE tasks SET assigned_to=NULL, assigned_to_name=NULL WHERE org_id=? AND assigned_to=? AND done=0", [orgId, target.id]);
  res.json({ removed: true, donorsUnassigned: dn.changes, openTasksUnassigned: tn.changes });
}));

// ── Donors ─────────────────────────────────────────────────────────────────
// Server-side filtering/pagination (BUILD-06 Phase A). Shared between
// GET /donors and GET /donors/export/csv so the export always matches the
// same query the Directory ran. Sort is a whitelist — never interpolate
// user input into ORDER BY.
// PARITY-1 Part D · the sorts and score columns moved to groups.js with the
// filter itself, so a Group rule and the list are one function.
const { DONOR_SORTS, DONOR_SCORE_COLS } = require("../../groups");

// ── Tax Receipting & Year-End Giving Statements ─────────────────────────────
// US-only v1 (IRC §170(f)(8), IRS Pub 1771) — see CLAUDE.md "Tax receipting"
// for the full design and explicit non-goals. This is a transactional send,
// same category as recurring-gift dunning — receipts auto-send for online
// gifts once an org has completed its tax settings; they are not a
// stewardship judgment call the way milestone/note drafts are.

// Validates + normalizes an EIN to XX-XXXXXXX. Accepts either format on
// input (with or without the hyphen); always stores hyphenated.
function normalizeEin(raw) {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

app.get("/org/import-health", requireAuth, wrap(async (req, res) => {
  res.json(await importHealth(req.user.orgId));
}));

// Confirm one of the last import's largest gifts as REAL — until then it
// waits in the queue as a question, never a thank-you task.
app.post("/org/import-health/confirm-gift", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { stats } = await importHealth(req.user.orgId);
  if (!stats) return res.status(404).json({ error: "no import on record" });
  const { name, dollars } = req.body || {};
  let hit = false;
  for (const g of stats.largestGifts || []) {
    if (g.name === name && Number(g.dollars) === Number(dollars)) { g.confirmed = true; hit = true; }
  }
  if (!hit) return res.status(404).json({ error: "no such gift on the largest-gifts panel" });
  await run("UPDATE orgs SET last_import_stats=? WHERE id=?", [JSON.stringify(stats), req.user.orgId]);
  res.json({ ok: true });
}));

// PUT /orgs/major-prospect-threshold — the org's own number, in its own money.
app.put("/orgs/major-prospect-threshold", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  let cents;
  try { cents = parseMoneyOrThrow(req.body.threshold, "threshold"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  if (!(cents > 0)) return res.status(400).json({ error: "A positive amount is required." });
  await run("UPDATE orgs SET major_prospect_cents=? WHERE id=?", [cents, req.user.orgId]);
  res.json({ thresholdCents: cents, thresholdAmount: toDollars(cents) });
}));

// PUT /org/grant-lead-days — the org's own lead times (admins).
app.put("/org/grant-lead-days", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const M = await grantMsMod();
  // MERGE OVER WHAT THE ORG ALREADY CHOSE, never over the defaults. Sending
  // one key used to reset the other four to their defaults — an org that set
  // the report lead to 45 in September lost it the moment it touched the
  // decision lead in October, and nothing on the screen would have said so.
  const stored = await orgLeadDays(req.user.orgId);
  // pickLeadDays, NOT normalizeLeadDays: the latter fills from the DEFAULTS, so
  // merging an invalid value in took the key back to its default instead of
  // leaving the org's own choice standing. The patch contributes only the keys
  // it actually got right.
  const clean = M.normalizeLeadDays({ ...stored, ...M.pickLeadDays(req.body && req.body.leadDays) });
  await run("UPDATE orgs SET grant_lead_days=?::jsonb WHERE id=?", [JSON.stringify(clean), req.user.orgId]);
  // FIX-31: the heads-up task's days ahead (0 = off), only when it was sent.
  const h = req.body && req.body.headsUpDays;
  if (h !== undefined) {
    const n = Number(h);
    if (!Number.isInteger(n) || n < 0 || n > 90) return res.status(400).json({ error: "bad_heads_up", sentence: "Days ahead is a whole number from 0 to 90." });
    await run("UPDATE orgs SET grant_headsup_days=? WHERE id=?", [n, req.user.orgId]);
  }
  const [o] = await query("SELECT grant_headsup_days FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ leadDays: clean, defaults: M.DEFAULT_LEAD_DAYS, headsUpDays: o ? (o.grant_headsup_days ?? 14) : 14 });
}));

app.get("/org/membership-settings", requireAuth, wrap(async (req, res) => {
  const st = await membershipSettings(req.user.orgId);
  res.json({ ...st, sentence: `A renewal thread opens ${st.renewalDays} days before a membership expires, and an expired membership stays in grace for ${st.graceDays} days before it lapses.` });
}));
// Merged over the STORED values, never over the defaults: changing one number
// must not quietly reset the other.
app.put("/org/membership-settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const cur = await membershipSettings(req.user.orgId);
  const pick = (v, d) => {
    if (v === undefined || v === null || v === "") return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw Object.assign(new Error("Days must be a whole number from 0 to 365."), { status: 400 });
    return n;
  };
  try {
    const renewalDays = pick(req.body?.renewalDays, cur.renewalDays), graceDays = pick(req.body?.graceDays, cur.graceDays);
    await run("UPDATE orgs SET membership_renewal_days=?, membership_grace_days=? WHERE id=?", [renewalDays, graceDays, req.user.orgId]);
    res.json({ renewalDays, graceDays });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
}));
}

module.exports = { routers, mount };
