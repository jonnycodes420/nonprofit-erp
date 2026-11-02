// routes/crm.js — the CRM: people, gifts, the Thread, pipeline, grants, reports, settings and the rest of the signed-in app.
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
//
// SPLIT-1 is moving these routes, and the helpers only they use, VERBATIM into
// server/<domain>/, one domain per commit. The ones still below stay in mount();
// the moved modules are mounted from here (mountAll), and their routers sit
// inside routers.r0 and routers.r1 in the order Express tried them before.
const express = require("express");
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, requireAi, transcribeAudio, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../aiClient");
// FIX-11 Part 1 — the audit log's own vocabulary (the sentence a row reads as).
// The WRITING of a row happens in middleware/auditTrail.js and nowhere else.
const auditTrailMod = require("../auditTrail");
const auditMw = require("../middleware/auditTrail");
// FIX-11 Part 3 — the bookkeeper's two files. Pure: grouping, the fee line,
// the net and the assertion that the deposits foot (depositsFile.js), and the
// column sets each tool wants (bookkeeper.js), declared once so the screen,
// this router and routes/finance.js cannot disagree about any of them.
const DEP = require("../depositsFile");
const SEND_GATE = require("../sendGate");   // SEND-GATE-1: a staff click is the confirm for one message
const DTAGS = require("../donorTags");   // FIX-33: internal flags never reach a screen as tags
const ItemRefs = require("../itemRefs");   // THREAD-2: the things a sentence names
const BK = require("../bookkeeper");
// PARITY-1 Part B — a file on a conversation or a note (types, bytes, signed door).
const IXF = require("../interactionFiles");
const TL = require("../timelineLine");
const PM = require("../personMatch");   // WIRE-1 rule 1: one record per person   // WIRE-1 rule 2: every act lands on the timeline
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const NUM = require("../campaignMatch");
const NUMBERS = require("../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { NOT_CREDIT } = require("../creditTypes");   // FIX-49: soft and matching credits are not money
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../emailCompose");
const { requireAuth404 } = require("../auth");   // FIX-20 Part 0: the file doors
const { rateLimit } = require("../rateLimitStore");   // SCALE-1: shared by every replica
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../orgSummary");
const lapseRule = require("../lapseRule");   // FIX-49: the one lapse rule
const SEALED_MAIL = require("../server/mail/sealedMail");   // SECURE-3: a synced email's body opens only here
// STAFF-MAIL-1: one person's morning email (sections, hour, days) and the
// columns /me and the prefs route read for it.
const { briefSettings, BRIEF_SECTIONS } = require("./email");
const NOTIFY_SELECT = "notify_thread_nudge, brief_sections, brief_hour, brief_days, notify_portfolio_gifts, notify_task_assignments, "
  + "notify_step_reminder, notify_meeting_brief, notify_week_in_review, notify_monthly_report, notify_connection_alerts, notify_weekly";
const { fileLimiter } = require("../server/shared/fileLimiter");   // SPLIT-1: one limiter, shared by the two file doors
const PW = require("../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments

const routers = {
  r0: express.Router(),
  r1: express.Router(),
  c0: express.Router(),
  c1: express.Router(),
};
const giftHooks = {};
// FIX-2 D — the one way another module runs a report: the SAME handler and
// params GET /reports/:key uses, so Agent's count is the report's count.
const reportHooks = {};

// SPLIT-1 — the helpers more than one module reads, mounted first, each after
// the ones it reads; then the route modules. Each mount() hands back what
// the others read, and the next one finds it on ctx.
const HELPERS = [
  "../server/shared/crmCommon",
  "../server/imports/helpers",
  "../server/reports/bookkeeperReports",
  "../server/shared/grantMilestones",
  "../server/reports/handlers",
  "../server/reports/helpers",
  "../server/shared/trash",
  "../server/majorGifts/helpers",
  "../server/shared/journeyStart",
  "../server/outreach/helpers",
  "../server/grants/helpers",
  "../server/shared/csv",
  "../server/shared/milestoneDrafts",
  "../server/events/helpers",
  "../server/shared/chequeImage",
];
const MODULES = [
  "../server/events/publicPage",
  "../server/events/routes",
  "../server/grants/funders",
  "../server/grants/routes",
  "../server/imports/combined",
  "../server/imports/gifts",
  "../server/imports/recentGifts",
  "../server/imports/routes",
  "../server/majorGifts/plans",
  "../server/majorGifts/routes",
  "../server/outreach/autoSend",
  "../server/outreach/journeys",
  "../server/outreach/routes",
  "../server/outreach/thanks",
  "../server/reports/boardPack",
  "../server/reports/dashboard",
  "../server/reports/fundraising",
  "../server/reports/impact",
  "../server/reports/routes",
  "../server/tasks/routes",
];

// The order Express tries them in. Two routes that can answer the same
// request keep the order they had in one file; scripts/ci/route-diff.js
// checks it against main.
routers.r0.use(require("../server/outreach/routes").routers.r0);
routers.r0.use(routers.c0);
routers.r0.use(require("../server/outreach/thanks").routers.r0);
routers.r1.use(routers.c1);
routers.r1.use(require("../server/reports/dashboard").routers.r1);
routers.r1.use(require("../server/reports/boardPack").routers.r1);
routers.r1.use(require("../server/reports/routes").routers.r1);
routers.r1.use(require("../server/imports/routes").routers.r1);
routers.r1.use(require("../server/imports/combined").routers.r1);
routers.r1.use(require("../server/tasks/routes").routers.r1);
routers.r1.use(require("../server/imports/gifts").routers.r1);
routers.r1.use(require("../server/majorGifts/plans").routers.r1);
routers.r1.use(require("../server/outreach/thanks").routers.r1);
routers.r1.use(require("../server/majorGifts/routes").routers.r1);
routers.r1.use(require("../server/outreach/autoSend").routers.r1);
routers.r1.use(require("../server/outreach/journeys").routers.r1);
routers.r1.use(require("../server/outreach/routes").routers.r1);
routers.r1.use(require("../server/grants/routes").routers.r1);
routers.r1.use(require("../server/grants/funders").routers.r1);
routers.r1.use(require("../server/reports/fundraising").routers.r1);
routers.r1.use(require("../server/reports/impact").routers.r1);
routers.r1.use(require("../server/events/routes").routers.r1);
routers.r1.use(require("../server/events/publicPage").routers.r1);

function mountAll(ctx) {
  const shared = Object.assign({}, ctx, { giftHooks, reportHooks });
  for (const h of HELPERS) Object.assign(shared, require(h).mount(shared));
  mount(shared);
  for (const r of MODULES) require(r).mount(shared);
}

function mount(ctx) {
const {
  AGENT_MODEL, API_KEY_PREFIX, ASSET_ID_RE, CF_ENTITIES, GEOCODE_TICK_BUDGET, GIVE_THEME_COLS, GR,
  INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_ENABLED, LAPSED_MEMBER_SQL, MB_READY, NOT_HISTORY_TYPES, NOT_YOURS, OU,
  PERSON_ONLY_SENTENCE, PHOTO_FETCH_BUDGET, PT_READY, RESTORABLE, SYS_AUTO, TOTP, UNDO_SECONDS, VH_READY,
  _tzCache, actor, advanceCultivationPlan, agentGate, allocateReceiptNumber, apiLimiter, applyReceiptTokens,
  birthdayMod, campaignPageMod, cfEvent, cfShape, checkGiftExtras, checkPlanLimit, checkWriteAccess,
  computeDriftForDonors, computeRetentionRate, coverFeePayload, crypto, demoMailNote, displayNameCase,
  donateLimiter, donorCreditTotals, donorFacingOrgName, donorFromAddress, donorMailDecision, driftBadgeField,
  editStamp, emitWebhook, engagementMod, enrollInSequences, enrollMembership, ensureOrgLedger, escapeHtml,
  eventLevelPayload, figureSources, fireWorkflows, formConfigMod, geocode, getOrgAccessState, getThemeAsset,
  giveThemePayload, givingAccountEntry, givingSourcesMod, grantMsMod, hashApiKey, imageBytesMatchMime,
  importHealth, inOrgDays, inboundMod, insertShift, inviteeDisplayName, isBlockedAddress, issueGiftReceipt,
  journeyMod, keepImportedTotals, levelTaken, loadCfDefs, lookupMatchingGift, markDonorsForGeocoding,
  mayEditLogged, mbCents, membershipSettings, mergeCustomValues, mfaVerifyForUser, money, normalizeAccent,
  normalizeGiftDate, openAdminTask, openGiftThread, openThreadTx, orgFiscalYearStart, orgForYears,
  orgLeadDays, orgOwns, orgPlanTier, orgStewardStart, orgTakesGifts, orgTime, orgToday, orgTz, orgTzName,
  parseMoneyOrThrow, personPhoto, pledgeDisplayStatus, processGeocodeQueue, processMembershipRenewals,
  processPhotoQueue, processPledgeInstallmentReminders, processPledgeReminders, proposalMod,
  pruneUnreferencedAssets, publicAppUrl, putThemeAsset, query, queryTx, ratesMod, recalcDonorSummary,
  recalcPledgePayment, recomputeScoresForOrg, recordAssetPointerHistory, recordAutoMove, recordGift,
  renderReceiptPdf, renewMembership, reportCsvCell, requireAdmin, requireAuth, requireCrm, resend,
  resolveOrgBrandTheme, resolvePdfLogo, resolveWidgetsPublic, round2, run, runTx, sampleDataMod, seedOrgData,
  sendPledgeReminderEmail, sendReceiptEmail, signToken, slugifyGivingPage, staffWho, storeChequeImage,
  sustainerFileFacts, syncGmail, threadShapeMod, thresholdsMod, toCents, toDollars, trashRow, uuid,
  validateCustomFields, volunteerSummary, widgetMod, withAdvisoryLock, withSmartAmounts, withTransaction,
  wrap, writeAuditLog, writeGiftExtras,
} = ctx;
let MB = null;
MB_READY.then(m => { MB = m; });
let PT = null;
PT_READY.then(m => { PT = m; });
let VH = null;
VH_READY.then(m => { VH = m; });
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
let app = routers.c0;

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
  const draftMod = await import("../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  res.json({ samples: samples.length, ready: voice.ready,
             needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - samples.length),
             greeting: voice.greeting || null, signoff: voice.signoff || null, signature: voice.signature || null });
}));

app.get("/org/voice-samples", requireAuth, wrap(async (req, res) => {
  const [org] = await query("SELECT voice_samples FROM orgs WHERE id=?", [req.user.orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const draftMod = await import("../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  res.json({ samples, ready: voice.ready, needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - samples.length),
             greeting: voice.greeting || null, signoff: voice.signoff || null, signature: voice.signature || null });
}));

// POST /pledges/run-reminders — drive the sweep for the caller's org now
// (ops/test hook, the /nudges/run bar). {today} pins the date.
app.post("/pledges/run-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  const today = (req.body && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.today))) ? String(req.body.today) : null;
  const out = await processPledgeInstallmentReminders({ orgId: req.user.orgId, today });
  res.json(out);
}));
// FIX-51 · ONE QUIET RULE. "Going quiet" is lapseRule.js and nothing else:
// Lapsing (last gift 9 to 12 months ago) and Lapsed (12 months and more).
// The 180-day clock that the going-quiet suggestion, the Communications
// segment and Home's re-engage list each kept is gone; each reads the rule.

// Auto-un-lapse: a lapsed donor just gave, so move them out of Lapsed to
// Steward automatically ("they just gave"), logged, editable. Called from every
// gift-insert path with the donor's PRE-gift stage. No-op unless they were
// lapsed. The UPDATE is guarded on stage='lapsed' so a concurrent human move
// can't be clobbered.
async function autoUnlapseOnGift(orgId, donorId, preStage) {
  if (preStage !== "lapsed") return false;
  const upd = await query(
    "UPDATE donors SET stage='steward', updated_at=NOW() WHERE id=? AND org_id=? AND stage='lapsed' RETURNING id",
    [donorId, orgId]);
  if (!upd.length) return false; // someone moved them first — respect it
  await recordAutoMove(orgId, donorId, "lapsed", "steward", "Auto: new gift after a year-long gap");
  return true;
}

// ── Wealth Score ────────────────────────────────────────────────────────────
async function calcWealthScore(donorId, orgId) {
  try {
    const [donorRows, gifts, interactions] = await Promise.all([
      query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]),
      query("SELECT amount FROM gifts WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [donorId, orgId]),
      query("SELECT type, note FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [donorId, orgId]),
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
      const client = anthropicFor(orgId);
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 130,
        thinking: { type: "disabled" },   // FIX-28: two sentences need no thinking (the ASK-3 rule)
        messages: [{
          role: "user",
          content: `Write exactly 2 sentences: first explain why this donor scored ${finalScore}/10 (${capacityTier} tier, ${confidence} confidence) referencing their specific numbers; second, name one concrete action that would raise their score. No labels, no headers.

Data: ${d.name} | Total giving: $${total.toLocaleString()} | ${gc} gifts avg $${avgGiftAmt.toLocaleString()} | Largest gift: $${maxGift.toLocaleString()} | Last gift: ${d.last_gift_date || "none"} | Stage: ${d.stage} | Touchpoints: ${interactions.length}`,
        }],
      });
      // FIX-28: an unfinished reply is never shown; the template rationale stands.
      const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      if ((!msg.stop_reason || msg.stop_reason === "end_turn") && text) rationale = text;
    } catch(e) {
      console.error("Score rationale:", e.message);
    }

    await run(
      "UPDATE donors SET wealth_score=?,capacity_tier=?,score_confidence=?,score_last_updated=NOW(),score_rationale=? WHERE id=? AND org_id=?",
      [finalScore, capacityTier, confidence, rationale, donorId, orgId]
    );
    return { wealthScore: finalScore, capacityTier, scoreConfidence: confidence, scoreRationale: rationale };
  } catch(e) {
    console.error("calcWealthScore:", e.message);
    return null;
  }
}
// ═══ SEC-1 · TWO-FACTOR AND SESSIONS ═══════════════════════════════════════
// Every route below is the signed-in person's own, except the three marked
// OWNER, which take an admin and a teammate in the same organisation. Every
// one is audited by the trail above every router; the verbs are named here.
const TF = require("../twoFactor");
const bcrypt = require("bcryptjs");
const meRow = async userId => (await query(`SELECT * FROM users WHERE id=?`, [userId]))[0] || null;
const orgOf = async orgId => (await query(`SELECT id, org_kind, require_mfa, require_admin_mfa, idle_minutes, allow_staff_large_exports FROM orgs WHERE id=?`, [orgId]))[0] || null;
const mustKeepMfa = (u, o) => !!(u.is_super_admin || (o && o.require_mfa) || (u.role === "admin" && o && o.require_admin_mfa));
// One check for "is this a current code of yours", whatever the method.
async function currentCodeOk(u, code) {
  const c = String(code || "").trim();
  if (!c) return false;
  if (TF.looksLikeRecovery(c)) return TF.useRecoveryCode(u, c);
  if (u.mfa_method === "email") return TF.useEmailCode(u, c);
  return (await mfaVerifyForUser(u, c)) !== null;
}
app = routers.c1;

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
  const { seal, credentialsConfigured } = await import("../shared/secretBox.js");
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
    const { open } = await import("../shared/secretBox.js");
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
    user: { id: u.id, email: u.email, name: u.name, role: u.role, isSuperAdmin, mfaEnabled: true },
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
  require("../sessionCache").sessionCache.evict(t.id);
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
  require("../sessionCache").sessionCache.evict(t.id);
  const n = await TF.revokeSessions("user_id=?", [t.id], req.user.userId);
  req.audit.action("signed a teammate out everywhere"); req.audit.entity("user", t.id, t.email);
  res.json({ ok: true, ended: n, sentence: `${t.name || t.email} is signed out of every browser.` });
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
  require("../sessionCache").sessionCache.evict(u.id);
  let token = null;
  if (req.user.sid) { token = signToken({ userId: u.id, orgId: u.org_id, email: u.email, role: u.role, isSuperAdmin: !!u.is_super_admin, sid: req.user.sid }); }
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
  require("../sessionCache").sessionCache.evict(u.id);
  const token = req.user.sid ? signToken({ userId: u.id, orgId: u.org_id, email: u.email, role: u.role, isSuperAdmin: !!u.is_super_admin, sid: req.user.sid })
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
    user: { id: u.id, email: u.email, name: u.name, role: req.user.support ? "admin" : u.role, canMajorGifts: await require("../prospect").canSee(u.id) },   // PROSPECT-1
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
  const BK = await import("../shared/brandKit.js");
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
  res.json({ layout: normalizeNavLayout(layout) });
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
  res.json({ ...org, demo: require("../orgKind").isDemoOrg(org), accessState: getOrgAccessState(org),
    capabilities: {
      geocoding: geocode.geocodingConfigured(),
      // aiClient.aiGate's rule without the budget: a key, and the org's switch.
      ai: !!process.env.ANTHROPIC_API_KEY && org.ai_enabled !== false,
      // server.js builds the donation Stripe client from this one key.
      stripe: !!require("../stripeKeys").donationStripeKey(),
    } });
}));
// PARITY-2 Part 1: the one list of an org's public doors (the give hub).
const { waysToGive } = require("../waysToGive");

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
  const V = await import("../shared/vocabulary.js");
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
  const V = await import("../shared/vocabulary.js");
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
    { key: "inbox", done: require("../orgKind").isDemoOrg(org)
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
    if (website != null && require("../webAddress").webAddress(website) === null)
      return res.status(400).json({ error: "bad_website", message: "The website should be a web address, like yourorg.org." });
    await run(
      `UPDATE orgs SET mission=?, focus_area=?, annual_budget=?, founded_year=?, website=? WHERE id=?`,
      [mission || null, focusArea || null, annualBudget || null, foundedYear ? parseInt(foundedYear, 10) : null, require("../webAddress").webAddress(website) || null, req.params.id]
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

// ── Sample data ────────────────────────────────────────────────────────────
app.get("/org/sample-data-status", requireAuth, wrap(async (req, res) => {
  // BUILD-96 Part 2 — this route now carries the whole picture, because Home
  // reads it to decide whether to say "you're looking at sample data". A
  // banner driven by a different count from the one the clear acts on would
  // eventually outlive the rows it is about.
  const counts = await sampleDataMod.countSampleData(query, req.user.orgId);
  // TASKS-2 — "your own donors arrive when your file is loaded" is only true
  // while NOTHING real is here. An org that imported 1,000 donors and still
  // carries the samples was told its file had not arrived.
  const [real] = await query(
    "SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL AND (is_sample IS NULL OR is_sample=false)",
    [req.user.orgId]);
  res.json({
    hasSampleData: counts.people > 0 || counts.gifts > 0,
    realDonorCount: real ? real.n : 0,
    sampleDonorCount: counts.people,
    counts,
  });
}));

app.post("/org/load-sample-data", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const userId = req.user.userId;

  const existing = await query(
    "SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND (is_sample IS NULL OR is_sample=false)",
    [orgId]
  );
  if (parseInt(existing[0].cnt) > 5) {
    return res.status(400).json({ error: "Org already has data" });
  }

  const userRows = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRows[0]?.name || "Sample User";

  // ── BUILD-96 Part 2 FIX — A SAMPLE ID BELONGS TO ONE ORG ─────────────────
  // Every sample row used a FIXED id: smpl_d1…smpl_d25, smpl_g*,
  // fund_smpl_general. `donors.id` is a bare global PRIMARY KEY, not
  // (org_id, id), and every insert below is ON CONFLICT (id) DO NOTHING.
  //
  // So the SECOND org on an installation to load sample data got NOTHING, and
  // was told it worked — every insert conflicted with the first org's rows and
  // did nothing, and the response reported `donors.length`, a constant, rather
  // than a count of anything written. On production org_creo holds those ids,
  // which means this has been broken for every other org since the feature
  // existed, silently, in the direction where the screen says yes.
  //
  // It was found by a battery run, not by a test: another suite's org held the
  // ids and ten assertions in build96-sample-data failed for what looked like
  // this build's bug. It was the product lying about a write.
  //
  // The ids are now namespaced per org. The arrays below keep their RAW keys
  // because they cross-reference each other (a task points at "smpl_d3"), and
  // `sid` is applied at every insert — one function, so a reference and its
  // target can never be namespaced differently.
  const sidTag = crypto.createHash("sha1").update(String(orgId)).digest("hex").slice(0, 8);
  const sid = key => `${key}__${sidTag}`;

  // ORG_TZ_SEAM_OK (BUILD-75 A.5) — sample dates are civil dates in the ORG's
  // timezone; the old UTC slice dated every demo row for tomorrow when the
  // sample data was loaded in the local evening.
  const sampleToday = orgToday(await orgTz(orgId));
  function dAgo(n) { return orgTime.addDays(sampleToday, -n); }

  // Insert 3 sample funds
  const fGen = sid("fund_smpl_general"), fEdu = sid("fund_smpl_edu"), fCap = sid("fund_smpl_capital");
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,false,true) ON CONFLICT (id) DO NOTHING`,
    [fGen, orgId, "General Operating", "Unrestricted operating support"]);
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,true,true) ON CONFLICT (id) DO NOTHING`,
    [fEdu, orgId, "Education Program", "Restricted to youth education programs"]);
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,true,true) ON CONFLICT (id) DO NOTHING`,
    [fCap, orgId, "Capital Campaign", "New facility construction"]);

  // 25 donors across all 6 stages, all assigned to current user
  const donors = [
    {id:"smpl_d1",name:"Margaret Whitfield",email:"mwhitfield@example.com",phone:"212-555-0101",stage:"steward",total:485000,last:150000,lastGift:dAgo(45),giftCount:12,city:"New York",state:"NY",zip:"10021"},
    {id:"smpl_d2",name:"James & Carol Thorne",email:"thornegiving@example.com",phone:"617-555-0102",stage:"steward",total:225000,last:75000,lastGift:dAgo(60),giftCount:8,city:"Boston",state:"MA",zip:"02116"},
    {id:"smpl_d3",name:"David Okonkwo",email:"dokonkwo@example.com",phone:"312-555-0103",stage:"solicit",total:95000,last:50000,lastGift:dAgo(180),giftCount:5,city:"Chicago",state:"IL",zip:"60611"},
    {id:"smpl_d4",name:"Patricia Hernandez",email:"phernandez@example.com",phone:"415-555-0104",stage:"solicit",total:42000,last:20000,lastGift:dAgo(120),giftCount:4,city:"San Francisco",state:"CA",zip:"94105"},
    {id:"smpl_d5",name:"Robert Chen",email:"rchen@example.com",phone:"202-555-0105",stage:"solicit",total:58000,last:25000,lastGift:dAgo(90),giftCount:6,city:"Washington",state:"DC",zip:"20001"},
    {id:"smpl_d6",name:"Linda Abramowitz",email:"labramowitz@example.com",phone:"212-555-0106",stage:"cultivate",total:28000,last:10000,lastGift:dAgo(210),giftCount:3,city:"New York",state:"NY",zip:"10022"},
    {id:"smpl_d7",name:"Thomas Nakamura",email:"tnakamura@example.com",phone:"310-555-0107",stage:"cultivate",total:15000,last:5000,lastGift:dAgo(300),giftCount:2,city:"Los Angeles",state:"CA",zip:"90025"},
    {id:"smpl_d8",name:"Sarah Obi",email:"sobi@example.com",phone:"512-555-0108",stage:"cultivate",total:8500,last:3500,lastGift:dAgo(400),giftCount:3,city:"Austin",state:"TX",zip:"78701"},
    {id:"smpl_d9",name:"Michael Russo",email:"mrusso@example.com",phone:"305-555-0109",stage:"cultivate",total:12000,last:4000,lastGift:dAgo(350),giftCount:2,city:"Miami",state:"FL",zip:"33101"},
    {id:"smpl_d10",name:"Eleanor Park",email:"epark@example.com",phone:"206-555-0110",stage:"cultivate",total:6000,last:2000,lastGift:dAgo(500),giftCount:3,city:"Seattle",state:"WA",zip:"98101"},
    {id:"smpl_d11",name:"William Foster",email:"wfoster@example.com",phone:"404-555-0111",stage:"qualify",total:4000,last:1500,lastGift:dAgo(450),giftCount:2,city:"Atlanta",state:"GA",zip:"30303"},
    {id:"smpl_d12",name:"Amanda Kowalski",email:"akowalski@example.com",phone:"303-555-0112",stage:"qualify",total:2500,last:1000,lastGift:dAgo(600),giftCount:2,city:"Denver",state:"CO",zip:"80202"},
    {id:"smpl_d13",name:"Kevin Patel",email:"kpatel@example.com",phone:"480-555-0113",stage:"qualify",total:1800,last:800,lastGift:dAgo(700),giftCount:2,city:"Phoenix",state:"AZ",zip:"85001"},
    {id:"smpl_d14",name:"Nancy Williams",email:"nwilliams@example.com",phone:"614-555-0114",stage:"qualify",total:900,last:500,lastGift:dAgo(800),giftCount:1,city:"Columbus",state:"OH",zip:"43215"},
    {id:"smpl_d15",name:"Gregory Martin",email:"gmartin@example.com",phone:"215-555-0115",stage:"qualify",total:1200,last:600,lastGift:dAgo(550),giftCount:2,city:"Philadelphia",state:"PA",zip:"19103"},
    {id:"smpl_d16",name:"Priya Sharma",email:"psharma@example.com",phone:"617-555-0116",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Cambridge",state:"MA",zip:"02139"},
    {id:"smpl_d17",name:"Christopher Hughes",email:"chughes@example.com",phone:"502-555-0117",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Louisville",state:"KY",zip:"40202"},
    {id:"smpl_d18",name:"Diana Moss",email:"dmoss@example.com",phone:"901-555-0118",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Memphis",state:"TN",zip:"38101"},
    {id:"smpl_d19",name:"Frank Delgado",email:"fdelgado@example.com",phone:"505-555-0119",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Albuquerque",state:"NM",zip:"87101"},
    {id:"smpl_d20",name:"Helen Kim",email:"hkim@example.com",phone:"503-555-0120",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Portland",state:"OR",zip:"97201"},
    {id:"smpl_d21",name:"Arthur Blake",email:"ablake@example.com",phone:"212-555-0121",stage:"lapsed",total:35000,last:15000,lastGift:dAgo(800),giftCount:5,city:"New York",state:"NY",zip:"10001"},
    {id:"smpl_d22",name:"Meredith Stone",email:"mstone@example.com",phone:"619-555-0122",stage:"lapsed",total:18000,last:8000,lastGift:dAgo(950),giftCount:3,city:"San Diego",state:"CA",zip:"92101"},
    {id:"smpl_d23",name:"George Tremblay",email:"gtremblay@example.com",phone:"718-555-0123",stage:"lapsed",total:9000,last:3000,lastGift:dAgo(750),giftCount:4,city:"Brooklyn",state:"NY",zip:"11201"},
    {id:"smpl_d24",name:"Beatrice Nguyen",email:"bnguyen@example.com",phone:"619-555-0124",stage:"lapsed",total:7500,last:2500,lastGift:dAgo(820),giftCount:3,city:"San Diego",state:"CA",zip:"92103"},
    {id:"smpl_d25",name:"Oscar Campbell",email:"ocampbell@example.com",phone:"401-555-0125",stage:"lapsed",total:500,last:500,lastGift:dAgo(900),giftCount:1,city:"Providence",state:"RI",zip:"02903"},
  ];

  for (const d of donors) {
    await run(
      `INSERT INTO donors (id,org_id,name,email,phone,stage,total_giving,last_gift_amount,last_gift_date,gift_count,city,state,zip,assigned_to,assigned_to_name,is_sample,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(d.id),orgId,d.name,d.email,d.phone,d.stage,d.total,d.last,d.lastGift,d.giftCount,d.city,d.state,d.zip,userId,userName,userId,userName]
    );
  }

  // Gifts for donors with giving history
  for (const d of donors.filter(x => x.total > 0)) {
    const n = d.id.replace("smpl_d","");
    const fundId = d.stage==="steward" ? fEdu : fGen;
    const method = (d.stage==="steward"||d.stage==="solicit") ? "check" : "credit_card";
    await run(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid("smpl_g"+n), orgId, sid(d.id), d.last, d.lastGift, "cash", fundId, method, userId, userName]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid("smpl_ftx"+n), orgId, d.lastGift, `Gift · ${d.name}`, d.name, d.last, "income", null, fundId, userId, userName]
    );
  }
  // Additional historical gifts for top donors
  const oldGifts = [
    {id:"smpl_g1b",donor:"smpl_d1",amount:125000,date:dAgo(400),fund:fEdu,method:"check"},
    {id:"smpl_g1c",donor:"smpl_d1",amount:100000,date:dAgo(750),fund:fCap,method:"check"},
    {id:"smpl_g2b",donor:"smpl_d2",amount:60000,date:dAgo(390),fund:fGen,method:"check"},
    {id:"smpl_g3b",donor:"smpl_d3",amount:25000,date:dAgo(540),fund:fEdu,method:"check"},
    {id:"smpl_g21b",donor:"smpl_d21",amount:12000,date:dAgo(400),fund:fGen,method:"check"},
  ];
  for (const g of oldGifts) {
    await run(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id),orgId,sid(g.donor),g.amount,g.date,"cash",g.fund,g.method,userId,userName]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id+"_ftx"),orgId,g.date,`Historical gift`,donors.find(d=>d.id===g.donor)?.name||"",g.amount,"income",null,g.fund,userId,userName]
    );
  }

  // Expense transactions to make Finance Overview show P&L
  const expenses = [
    {id:"smpl_exp1",date:dAgo(30),desc:"Program staff salaries",vendor:"Payroll",amount:28000,fund:fGen},
    {id:"smpl_exp2",date:dAgo(30),desc:"Facilities & rent",vendor:"Property Management",amount:8500,fund:fGen},
    {id:"smpl_exp3",date:dAgo(60),desc:"Arts supplies & materials",vendor:"Dick Blick Art Materials",amount:3200,fund:fEdu},
    {id:"smpl_exp4",date:dAgo(60),desc:"Program staff salaries",vendor:"Payroll",amount:28000,fund:fGen},
    {id:"smpl_exp5",date:dAgo(90),desc:"Annual Spring Gala event costs",vendor:"The Plaza Hotel",amount:42000,fund:fGen},
    {id:"smpl_exp6",date:dAgo(15),desc:"Marketing & communications",vendor:"Design Agency",amount:4800,fund:fGen},
  ];
  for (const e of expenses) {
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(e.id),orgId,e.date,e.desc,e.vendor,e.amount,"expense",null,e.fund,userId,userName]
    );
  }

  // 4 grants
  const grants = [
    {id:"smpl_gr1",funder:"W.K. Kellogg Foundation",program:"Arts Education Grant",amount:120000,status:"submitted",deadline:dAgo(-45),notes:"Annual renewal - strong history with this funder. Proposal submitted on time."},
    {id:"smpl_gr2",funder:"MacArthur Foundation",program:"Enduring Commitment Grant",amount:250000,status:"prospecting",deadline:dAgo(-120),notes:"LOI approved. Invited to submit full proposal. Strongest funding prospect for capital campaign."},
    {id:"smpl_gr3",funder:"NYC Dept. of Cultural Affairs",program:"Cultural Development Fund",amount:75000,status:"draft",deadline:dAgo(-200),notes:"LOI drafted. Awaiting program officer feedback before submitting."},
    {id:"smpl_gr4",funder:"National Endowment for the Arts",program:"Arts Education Partnership",amount:50000,status:"awarded",deadline:dAgo(90),notes:"Year 2 of 3-year grant. Mid-year report due in 60 days. On track."},
  ];
  for (const g of grants) {
    await run(
      `INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,notes,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id),orgId,g.funder,g.program,g.amount,g.status,g.deadline,g.notes,userId,userName]
    );
  }

  // 2 events
  const ev1 = sid("smpl_ev1"), ev2 = sid("smpl_ev2");
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [ev1,orgId,"Annual Spring Gala","gala",dAgo(30),dAgo(30),"The Plaza Hotel, NYC","Our signature annual fundraising gala celebrating 10 years of impact.",200,"completed",185000,42000,userId,userName]
  );
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [ev2,orgId,"Fall Cultivation Dinner","cultivation",dAgo(-60),dAgo(-60),"Private Dining Room, One World Trade","Intimate dinner for prospective major donors.",30,"upcoming",0,8500,userId,userName]
  );
  // Gala attendees
  const galaGuests = [
    {aId:"smpl_ea1",dId:"smpl_d1",gift:5000},
    {aId:"smpl_ea2",dId:"smpl_d2",gift:2500},
    {aId:"smpl_ea3",dId:"smpl_d3",gift:1000},
    {aId:"smpl_ea4",dId:"smpl_d5",gift:1000},
    {aId:"smpl_ea5",dId:"smpl_d6",gift:500},
  ];
  for (const a of galaGuests) {
    const dn = donors.find(d=>d.id===a.dId);
    if (!dn) continue;
    await run(
      `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,gift_amount,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT DO NOTHING`,
      [sid(a.aId),ev1,orgId,sid(a.dId),dn.name,dn.email,"attended",a.gift]
    );
  }

  // 1 email campaign
  await run(
    `INSERT INTO campaigns (id,org_id,name,subject,body,status,briefing,goal_amount,raised_amount,start_date,end_date,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [sid("smpl_camp1"),orgId,"Year-End Giving Appeal","Make a difference before the year ends",
     "Dear {{first_name}},\n\nAs the year draws to a close, we reflect on the incredible impact your support has made possible. This year, our students performed on stages across New York City, received 47 scholarships, and logged over 12,000 hours of instruction.\n\nYour gift today, doubled by a board matching challenge, will fund another year of transformative programming.\n\nWith gratitude,\n{{user_name}}",
     "sent",
     "Lead with the 3 scholarship recipient stories. Emphasize the 2:1 board match, expires Dec 31. Subject line A/B: test urgency vs. impact angle. Send to all active donors + lapsed within 2 years.",
     200000,142000,dAgo(45),dAgo(-20),userId,userName]
  );

  // 15 interactions
  const interactions = [
    {id:"smpl_i1",donor:"smpl_d1",type:"meeting",note:"Stewardship lunch at Per Se. Discussed Capital Campaign leadership gift opportunity. Very enthusiastic about naming the rehearsal hall. Will bring husband to site visit next month.",date:dAgo(15)},
    {id:"smpl_i2",donor:"smpl_d1",type:"call",note:"Called to thank for $150k Annual Fund renewal. She mentioned interest in an endowed scholarship. Will follow up with proposal.",date:dAgo(45)},
    {id:"smpl_i3",donor:"smpl_d2",type:"meeting",note:"Portfolio review with James and Carol. Carol is particularly interested in scholarship outcomes. James wants to see facility plans for capital campaign.",date:dAgo(25)},
    {id:"smpl_i4",donor:"smpl_d3",type:"call",note:"Discovery call, board member referral. David runs a PE firm, has significant capacity. Deep interest in youth workforce development. Scheduled site visit for next week.",date:dAgo(8)},
    {id:"smpl_i5",donor:"smpl_d3",type:"meeting",note:"Site visit to after-school program. Deeply moved by student presentations. Ask conversation: mid-six figures for endowed scholarship. Strategy session with ED scheduled.",date:dAgo(45)},
    {id:"smpl_i6",donor:"smpl_d4",type:"email",note:"Subject: Follow-up on proposal\n\nSent $20k proposal documents as discussed. Patricia confirmed receipt and said she would review with her financial advisor this month.",date:dAgo(30)},
    {id:"smpl_i7",donor:"smpl_d5",type:"meeting",note:"Met at Kennedy Center gala. Strong connection to arts education mission, has given to 3 similar organizations. Invited to Fall Cultivation Dinner.",date:dAgo(18)},
    {id:"smpl_i8",donor:"smpl_d6",type:"call",note:"Follow-up after proposal submission. Linda said the grants committee meets next month. Asked about a board matching gift opportunity.",date:dAgo(12)},
    {id:"smpl_i9",donor:"smpl_d8",type:"event",note:"Attended Spring Gala with spouse. Made $3,500 gift at the event. Very engaged during student performances, a strong cultivation prospect.",date:dAgo(30)},
    {id:"smpl_i10",donor:"smpl_d9",type:"call",note:"Cold outreach from board referral. Michael is a real estate developer, new to NYC philanthropy. Invited to a site visit. Very responsive.",date:dAgo(22)},
    {id:"smpl_i11",donor:"smpl_d21",type:"email",note:"Subject: Reconnecting, 2 years since your last gift\n\nSent personalized re-engagement email. Arthur's company was recently acquired. New email confirmed by EA.",date:dAgo(40)},
    {id:"smpl_i12",donor:"smpl_d22",type:"call",note:"Left voicemail, 3rd attempt this quarter. Meredith has not responded to outreach since her major gift 3 years ago. May need board member warm intro.",date:dAgo(60)},
    {id:"smpl_i13",donor:"smpl_d1",type:"stewardship",note:"Mailed annual impact report with personal handwritten note. Highlighted the scholarship recipients she funded this year.",date:dAgo(20)},
    {id:"smpl_i14",donor:"smpl_d2",type:"gift",note:"Received $75,000 annual fund gift via wire transfer. Acknowledgement letter sent same day.",date:dAgo(60)},
    {id:"smpl_i15",donor:"smpl_d3",type:"meeting",note:"Strategy session with ED and board chair. Confirmed ask of $75,000 for named scholarship fund. Meeting scheduled for next week.",date:dAgo(5)},
  ];
  for (const i of interactions) {
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [sid(i.id),orgId,sid(i.donor),i.type,i.note,i.date,userId,userName]
    );
  }

  // 5 tasks
  const tasks = [
    {id:"smpl_t1",title:"Call David Okonkwo: schedule formal ask meeting",priority:"high",due:dAgo(-3),donor:"smpl_d3"},
    {id:"smpl_t2",title:"Draft MacArthur Foundation full proposal",priority:"high",due:dAgo(-14),donor:null},
    {id:"smpl_t3",title:"Send Fall Cultivation Dinner invitations to Prospect-stage donors",priority:"medium",due:dAgo(-7),donor:null},
    {id:"smpl_t4",title:"Prepare NEA mid-year grant report",priority:"medium",due:dAgo(-30),donor:null},
    {id:"smpl_t5",title:"Follow up with Arthur Blake, re-engagement email",priority:"low",due:dAgo(-2),donor:"smpl_d21"},
  ];
  for (const t of tasks) {
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,0,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(t.id),orgId,t.title,t.due,t.priority,"donor",t.donor?sid(t.donor):null,userId,userName]
    );
  }

  // 4 volunteers
  const volunteers = [
    {id:"smpl_v1",name:"Jessica Kim",email:"jkim@example.com",hours:42,skills:JSON.stringify(["Arts instruction","Curriculum design"]),notes:"Lead instructor for after-school program. Available Mon/Wed/Fri."},
    {id:"smpl_v2",name:"Marco Alvarez",email:"malvarez@example.com",hours:28,skills:JSON.stringify(["Event planning","Marketing"]),notes:"Coordinates all signature events. Very reliable."},
    {id:"smpl_v3",name:"Denise Okafor",email:"dokafor@example.com",hours:35,skills:JSON.stringify(["Youth mentorship","Career development"]),notes:"Board-matched mentor for senior students. Board candidate."},
    {id:"smpl_v4",name:"Alex Brennan",email:"abrennan@example.com",hours:15,skills:JSON.stringify(["Audiovisual","IT support"]),notes:"Manages tech for performances and webinars."},
  ];
  for (const v of volunteers) {
    await run(
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,notes,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(v.id),orgId,v.name,v.email,v.hours,v.skills,v.notes,userId,userName]
    );
  }

  // 5 board members
  const board = [
    {id:"smpl_bm1",name:"Catherine Worthington",role:"Chair",giving_level:"100,000+",committees:JSON.stringify(["Executive","Finance"])},
    {id:"smpl_bm2",name:"Daniel Fontaine",role:"Treasurer",giving_level:"50,000+",committees:JSON.stringify(["Finance","Audit"])},
    {id:"smpl_bm3",name:"Rosalind Chen",role:"Secretary",giving_level:"25,000+",committees:JSON.stringify(["Governance"])},
    {id:"smpl_bm4",name:"Victor Osei",role:"Member",giving_level:"10,000+",committees:JSON.stringify(["Programs","Development"])},
    {id:"smpl_bm5",name:"Sylvia Brennan",role:"Member",giving_level:"10,000+",committees:JSON.stringify(["Development"])},
  ];
  for (const b of board) {
    await run(
      `INSERT INTO board_members (id,org_id,name,role,giving_level,committees,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(b.id),orgId,b.name,b.role,b.giving_level,b.committees,userId,userName]
    );
  }

  // BUILD-96 Part 2 — THE LOADER TAGS EVERYTHING IT IS RESPONSIBLE FOR.
  // Every INSERT above carries `is_sample` in its own column list. These three
  // tables the loader does not write at all — a Thread, a household, an
  // enrolment appear later, because of the people it just wrote — so the sweep
  // runs here and again before any clear. Without it the columns BUILD-96
  // added would be a default nobody ever sets.
  const tagged = await sampleDataMod.tagSampleRows({ query, run }, orgId).catch(err => {
    console.error("[sample-data] post-load tagging failed:", err.message);
    return {};
  });

  // WHAT WAS ACTUALLY WRITTEN. `donors.length` is a constant and reported 25
  // even when every insert had conflicted away to nothing, which is how the
  // id collision above stayed invisible. A route that writes rows reports the
  // rows it wrote.
  const [wrote] = await query(
    "SELECT COUNT(*)::int AS c FROM donors WHERE org_id=? AND is_sample=true", [orgId]);

  // FIX-32 · THE DEMO DOOR GOES TO HOME. "Explore the demo" is the first page
  // after signup, before onboarding is complete, and it sent her to /dashboard,
  // where RequireOnboarded bounced her straight back to /welcome: 25 sample
  // donors loaded and a start page that never moved. Choosing the demo IS
  // finishing onboarding (the same structural seed /onboarding/complete runs),
  // and it happens here, server side, so no client can load the sample and
  // forget the second half.
  let onboarded = false;
  const [o] = await query("SELECT onboarding_complete FROM orgs WHERE id=?", [orgId]);
  if (o && !Number(o.onboarding_complete)) {
    await seedOrgData(orgId);
    await run("UPDATE orgs SET onboarding_complete = 1 WHERE id = ?", [orgId]);
    onboarded = true;
  }
  res.json({ ok: true, donorCount: (wrote && wrote.c) || 0, tagged, onboarded });
}));

app.post("/org/clear-sample-data", requireAuth, wrap(async (req, res) => {
  // An org clearing its OWN sample data. This is the "get the demo donors out
  // of the way before I import my real file" path, and it deliberately does
  // NOT carry the super-admin route's refuse-on-real-gift guard: an org that
  // has already entered one real gift would otherwise be stuck with the demo
  // people forever. It is safe without it because the set it deletes is
  // defined by membership, not by judgement — only rows tagged sample, or
  // hanging off a person who is.
  const orgId = req.user.orgId;
  const { deleted, errors } = await sampleDataMod.clearSampleData({ query, run }, orgId);
  // Sample funds predate the is_sample column on fin_funds and were seeded
  // with fixed ids; the tagged delete covers them now, this covers a row
  // seeded before the tag existed.
  await run("DELETE FROM fin_funds WHERE org_id=? AND id IN (?,?,?)",
    [orgId, "fund_smpl_general", "fund_smpl_edu", "fund_smpl_capital"]).catch(() => {});
  if (errors.length) return res.status(500).json({ error: "Some sample rows could not be removed", errors, deleted });
  res.json({ ok: true, deleted });
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
  await require("../twoFactor").revokeSessions("user_id=?", [target.id], req.user.userId).catch(() => {});   // SEC-1
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
const { DONOR_SORTS, DONOR_SCORE_COLS } = require("../groups");
// FIX-1 D — the roles a person can carry that a chip or a list may name.
// "other" is not a role, it is the absence of one: normalizeTypes floors an
// empty list at it, and turning any role on replaces it.
const PEOPLE_ROLES = ["donor", "volunteer", "staff_board"];
const UNKNOWN_ROLE = { error: "unknown_role", sentence: "A role is Donor, Volunteer, or Staff and board." };
const UNKNOWN_STATUS = { error: "unknown_status", sentence: "A tag is General, Mid, Major, New, Current, Recaptured, Lapsed or Retained, and closeness is Close, Warm, On track, Cooling or New." };
// PARITY-1 — the filters a Group rule can also use: giving level, lifecycle,
// retained, closeness, and "has never given". Each is donorStatus.js's one
// definition, so a list, a Group and a profile tag cannot disagree.
async function buildDonorListFilter(req) {
  // PARITY-1 Part D · the filter takes a plain params object now (groups.js),
  // so a dynamic Group's rule runs through exactly this code.
  // FIX-22 · the Room to give sort reads the word for the whole org (a
  // handful of set-wise queries side by side, never one per row), and only
  // for someone who may see it; anyone else gets the list's own order.
  const q = req.query || {};
  let opts = {};
  if (q.sort === "room_to_give") {
    const PR = require("../prospect");
    if (await PR.canSee(req.user.userId)) {
      const all = await PR.roomToGive(req.user.orgId);
      const roomRanks = [];
      for (const [id, a] of all) if (a.rank > 0) roomRanks.push([id, a.rank]);
      opts = { roomRanks };
    }
  }
  // THREAD-3: archived people leave the list; ?archived=1 shows only them.
  if (String(q.archived || "") === "1") return GR.buildDonorFilter(req.user.orgId, q, opts)
    .then(f => ({ ...f, whereSql: `${f.whereSql} AND archived_at IS NOT NULL` }));
  return GR.buildDonorFilter(req.user.orgId, q, { ...opts, hideArchived: true });
}

// GET /donors — unpaginated legacy shape (plain array) when `limit` is
// absent, so every pre-pagination caller keeps working; `{donors, total}`
// when `limit` is present. Filters (search/stage/status/assignedTo/sort)
// are honored in both modes.
app.get("/donors", requireAuth, wrap(async (req, res) => {
  // IMPORT-6 · Everyone · Donors · Contacts, each counted (groups.directoryRoles)
  const { roleCounts, role } = await GR.directoryRoles(req.user.orgId, req.query, rq => buildDonorListFilter({ ...req, query: rq }));
  const filter = await buildDonorListFilter(role === req.query.role ? req : { ...req, query: { ...req.query, role } });
  if (filter.badFilter) return res.status(400).json({ error: "bad_filter", sentence: filter.badFilter });   // LIST-1
  if (filter.badRole) return res.status(400).json(UNKNOWN_ROLE);
  if (filter.badStatus) return res.status(400).json(UNKNOWN_STATUS);
  if (!(await OU.orgUser(req.user.orgId, req.query.assignedTo, { allowInactive: true })).ok) return OU.refuse(res, "assignedTo");
  const { whereSql, params, orderBy, selectCols, selectArgs } = filter;
  const PRm = require("../prospect");
  const roomWord = a => (a ? { word: a.word, label: a.label, rank: a.rank } : { word: "unknown", label: "Not yet known", rank: 0 });
  const mayRoom = await PRm.canSee(req.user.userId);
  let roomMap = null;
  // BUILD-76 Part 2 — every donor row carries the drift badge field, computed
  // fresh by the same function as the home list (one computation, one truth).
  const mapDonor = (tpMap, driftMap) => d => ({
    ...d,
    tags: DTAGS.visibleTags(d.tags),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
    drift: driftBadgeField(driftMap.get(d.id)),
    // BUILD-94 Part 1 — the signed, expiring URL for this donor's photograph,
    // or null. Minted here rather than stored so a payload can never carry a
    // link that outlives its signature.
    photo_url: donorPhotoUrl(req.user.orgId, d.photo_asset_id),
    // BUILD-94 Part 2 — normalised here so a NULL legacy column and an
    // explicit ["donor"] reach the client as the same thing.
    person_types: PT.typesOf(d),
    // FIX-33 · Room to give rides on the row, from prospect.roomToGive, the
    // one function the profile's block reads too. Only for someone who may
    // see it (admin or the major gifts permission); null for anyone else.
    room: roomMap ? roomWord(roomMap.get(d.id)) : null,
    // FIX-33 · the owner in words. An imported person with nobody assigned
    // read "?"; they read "No owner", beside an Assign that uses the one
    // assign route (PATCH /donors/:id/assign).
    owner_label: d.assigned_to_name || d.pending_assignee_name || "No owner",
  });

  // SECURE-2 item 3: this list always pages (default 100, at most 500). The
  // old no-limit form read every person in the org in one answer.
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const [donors, cnt] = await Promise.all([
    query(`SELECT donors.*${selectCols} FROM donors WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...selectArgs, ...params, limit, offset]),
    query(`SELECT COUNT(*) AS c FROM donors WHERE ${whereSql}`, params),
  ]);
  // Touchpoints + drift only for the page's donors — not the org-wide GROUP BY
  const ids = donors.map(d => d.id);
  const [touchpoints, { map: driftMap }] = await Promise.all([
    ids.length
      ? query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? AND donor_id = ANY(?) GROUP BY donor_id", [req.user.orgId, ids])
      : Promise.resolve([]),
    computeDriftForDonors(req.user.orgId, { donorIds: ids.length ? ids : ["_none_"] }),
  ]);
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  if (mayRoom && ids.length) roomMap = await PRm.roomToGive(req.user.orgId, ids);
  // LIST-1: the columns she chose, for this page only (donorList.js cellsFor).
  const cols = String(req.query.cols || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 40);
  const cells = cols.length ? await require("../donorList").cellsFor(req.user.orgId, donors, cols) : null;
  const out = donors.map(mapDonor(tpMap, driftMap));
  if (cells) for (const d of out) d.cells = cells.get(d.id) || {};
  res.json({ donors: out, total: parseInt(cnt[0].c, 10), ...(roleCounts ? { roleCounts, role: role === "donor" ? "donors" : role === "contact" ? "contacts" : "everyone" } : {}) });
}));

// Lightweight whole-org list for consumers that need every donor but not the
// heavy text columns (notes, score_rationale — the bulk of GET /donors'
// 21.7MB payload at 25k donors). Feeds the app shell's shared donor state:
// Kanban/team/re-engage/map views, onboarding snapshot, Communications
// audience counts, AI context builders. Column names match GET /donors so
// adaptDonor works unchanged on the subset.
app.get("/donors/summaries", requireAuth, wrap(async (req, res) => {
  // SECURE-2 item 3: a page at a time (default 100, at most 500); a screen
  // that wants everyone pages through (client/src/lib/pages.js).
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  // FIX-60: a pledge keeps a person off Lapsed (lapseRule.js), on every list.
  const _sumHold = require("../shared/numbers/lapse").holdSql("donors.id", orgToday(await orgTz(req.user.orgId)));   // ORG_TZ_SEAM_OK
  const [donors, touchpoints, { map: driftMap }] = await Promise.all([
    query(`SELECT id, name, email, phone, stage, status, total_giving, last_gift_date,
                  last_gift_amount, gift_count, assigned_to, assigned_to_name,
                  pending_assignee_invite_id, pending_assignee_name,
                  city, state, zip, country, address, kind, contact_name,
                  latitude, longitude, geocode_status,
                  tags, wealth_score, capacity_tier, planned_giving,
                  employer, stripe_subscription_status,
                  deceased, do_not_contact, do_not_solicit, do_not_mail, do_not_email,
                  imported_sustainer, imported_sustainer_amount, imported_sustainer_last_gift,
                  birth_month, birth_day, birth_year, ${_sumHold.sql} AS pledge_hold
           FROM donors WHERE org_id = ? AND deleted_at IS NULL ORDER BY total_giving DESC, id LIMIT ? OFFSET ?`, [..._sumHold.args, req.user.orgId, limit, offset]),
    query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
    computeDriftForDonors(req.user.orgId),   // BUILD-76 — the shared-state views badge from the same computation
  ]);
  res.setHeader("X-Total-Count", String((await query("SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND deleted_at IS NULL", [req.user.orgId]))[0].n));
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  res.json(donors.map(d => ({
    ...d,
    tags: DTAGS.visibleTags(d.tags),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
    drift: driftBadgeField(driftMap.get(d.id)),
  })));
}));

// ── Duplicate detection (BUILD-08 Phase C) ─────────────────────────────────
// Staff-level, org-scoped, read-only. Two tiers: same email (case-insensitive)
// is the confident tier; same-or-near name (normalized equality, or edit
// distance ≤2 within a first/last-token bucket) is the "worth a look" tier.
// Declared BEFORE /donors/:id routes (Express order) like /donors/summaries.
function normDonorName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const t = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[a.length];
}

app.get("/donors/duplicates", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, name, email, phone, stage, status, total_giving, gift_count,
            last_gift_date, city, state, created_at
     FROM donors WHERE org_id = ? AND deleted_at IS NULL`,
    [req.user.orgId]
  );
  const donorOut = d => ({ ...d, total_giving: parseFloat(d.total_giving) || 0 });
  const groups = [];

  // Tier 1 — same email.
  const byEmail = new Map();
  for (const d of rows) {
    const e = (d.email || "").toLowerCase().trim();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(d);
  }
  const inEmailGroup = new Set();
  for (const [e, list] of byEmail) {
    if (list.length < 2) continue;
    list.forEach(d => inEmailGroup.add(d.id));
    groups.push({ tier: "email", reason: `Same email · ${e}`, donors: list.map(donorOut) });
  }

  // Tier 2 — same normalized name, or near-identical name (edit distance ≤2
  // within a cheap first+last-token bucket so this never goes O(n²) on the
  // whole org). Pairs fully covered by an email group aren't repeated.
  const named = rows.filter(d => normDonorName(d.name).length >= 5);
  const byName = new Map();
  for (const d of named) {
    const n = normDonorName(d.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(d);
  }
  const inNameGroup = new Set();
  for (const [n, list] of byName) {
    if (list.length < 2) continue;
    if (list.every(d => inEmailGroup.has(d.id))) continue;
    list.forEach(d => inNameGroup.add(d.id));
    groups.push({ tier: "name", reason: `Same name · "${list[0].name}"`, donors: list.map(donorOut) });
  }
  const buckets = new Map();
  for (const d of named) {
    if (inNameGroup.has(d.id)) continue;
    const toks = normDonorName(d.name).split(" ");
    const key = toks[0].slice(0, 2) + "|" + (toks[toks.length - 1] || "").slice(0, 2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 200) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (inEmailGroup.has(a.id) && inEmailGroup.has(b.id)) continue;
      const na = normDonorName(a.name), nb = normDonorName(b.name);
      if (na.length >= 8 && nb.length >= 8 && editDistance(na, nb, 2) <= 2) {
        groups.push({ tier: "name", reason: `Similar names · "${a.name}" / "${b.name}"`, donors: [a, b].map(donorOut) });
      }
    }
  }

  groups.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "email" ? -1 : 1));
  res.json({ groups: groups.slice(0, 50), truncated: groups.length > 50 });
}));

// Directory CSV export — replaces the client-side "export what's on screen"
// now that the screen is one page: honors the same query params as
// GET /donors, exports EVERY matching row. Staff-level (it's data staff
// already see), never checkWriteAccess-gated (export-routes convention).
app.get("/donors/export/csv", requireAuth, wrap(async (req, res) => {
  const filter = await buildDonorListFilter(req);
  if (filter.badFilter) return res.status(400).json({ error: "bad_filter", sentence: filter.badFilter });   // LIST-1
  if (filter.badRole) return res.status(400).json(UNKNOWN_ROLE);
  if (filter.badStatus) return res.status(400).json(UNKNOWN_STATUS);
  if (!(await OU.orgUser(req.user.orgId, req.query.assignedTo, { allowInactive: true })).ok) return OU.refuse(res, "assignedTo");
  const { whereSql, params, orderBy, selectCols, selectArgs } = filter;
  const donors = await query(`SELECT donors.*${selectCols} FROM donors WHERE ${whereSql} ORDER BY ${orderBy}`, [...selectArgs, ...params]);
  if (await require("../exportGuard").largeExportRefused(req, res, donors.length)) return;   // SECURE-2 item 8
  
  // BUILD-78 6.1 — every non-archived donor custom field is its own column,
  // headed with the CURRENT label, rendered per the type table.
  const cfDonorDefs = await loadCfDefs("donor", req.user.orgId);
  const { renderCustomValue } = await cfShape();
  const columns = [
    ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
    ["Stage", "stage"], ["Status", "status"],
    ["Total giving", "total_giving"], ["Last gift date", "last_gift_date"],
    ["Last gift amount", "last_gift_amount"], ["Gift count", "gift_count"],
    ["Assigned to", d => d.assigned_to_name || ""],
    ["Closeness", d => (d.closeness ? d.closeness.charAt(0).toUpperCase() + d.closeness.slice(1) : "")],
    ["City", d => d.city || ""], ["State", d => d.state || ""],
    ["Tags", d => DTAGS.visibleTags(d.tags).join("|")],
    ...cfDonorDefs.map(f => [f.label, d => renderCustomValue(f, (d.custom_fields || {})[f.key])]),
  ];
  // PROSPECT-1 — screening results are never in the default export. An admin
  // may add them with the checkbox that says what it adds (includeScreening=1).
  if (String(req.query.includeScreening || "") === "1") {
    const [me] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
    if (!me || me.role !== "admin") return res.status(403).json({ error: "Only an admin can include screening results in an export." });
    const PR = require("../prospect"), RT = await PR.rtg();
    const sc = await PR.latestScreening(req.user.orgId, donors.map(d => d.id));
    const s = d => sc.get(d.id) || {};
    columns.push(["Screening provider", d => s(d).provider || ""], ["Screening date", d => s(d).screenedOn || ""],
      ["Capacity range", d => RT.rangeText(s(d).capacityLowCents ?? null, s(d).capacityHighCents ?? null) || ""],
      ["Real estate range", d => RT.rangeText(s(d).realEstateLowCents ?? null, s(d).realEstateHighCents ?? null) || ""]);
    if (req.audit) req.audit.summary(`Exported donors with screening results (${donors.length})`, { count: donors.length });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="donors-${orgToday(await orgTz(req.user.orgId))}.csv"`); // ORG_TZ_SEAM_OK — an evening export is named for today, not UTC-tomorrow
  res.send(toCsv(columns, donors));
}));

// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

app.get("/donors/custom-field-values/all", requireAuth, wrap(async (req, res) => {
  // BUILD-78: values live on the donor row (JSONB, keyed by the immutable
  // field key), so this is one column read — no EAV join, no pivot.
  const rows = await query(
    "SELECT id, custom_fields FROM donors WHERE org_id = ? AND deleted_at IS NULL AND custom_fields IS NOT NULL",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({ donorId: r.id, values: r.custom_fields || {} })));
}));

// Pipeline stage counts — reuses the same grouping the Dashboard's Donor
// Pipeline/funnel widgets compute, exposed as its own callable endpoint.
// BUILD-83 Part 3.5 — PLACED vs SUGGESTED, side by side and never conflated.
// `placed` counts donors a human actually put in a stage; `suggested` counts
// what the giving history proposes for the ones nobody has touched. A caller
// that shows the suggestion must say it is one (Home does).
app.get("/donors/stage-counts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT COALESCE(stage, suggested_stage) AS stage,
            (stage IS NOT NULL) AS placed,
            COUNT(*) AS count, COALESCE(SUM(total_giving),0) AS total
       FROM donors WHERE org_id = ? AND deleted_at IS NULL
        AND COALESCE(stage, suggested_stage) IS NOT NULL
      GROUP BY 1, 2`,
    [req.user.orgId]
  );
  const merge = (acc, r) => {
    const k = r.stage;
    acc[k] = acc[k] || { stage: k, count: 0, total: 0 };
    acc[k].count += parseInt(r.count, 10);
    acc[k].total += parseFloat(r.total) || 0;
    return acc;
  };
  const placedRows = rows.filter(r => r.placed === true || r.placed === "t");
  const suggestedRows = rows.filter(r => !(r.placed === true || r.placed === "t"));
  const placed = Object.values(placedRows.reduce(merge, {}));
  const suggested = Object.values(suggestedRows.reduce(merge, {}));
  const anyPlaced = placed.reduce((n, r) => n + r.count, 0) > 0;
  // An OBJECT, deliberately: the caller must know whether it is holding the
  // board a human built or a suggestion the file proposed, and an array cannot
  // carry that without a caller that silently ignores it.
  res.json({ counts: anyPlaced ? placed : suggested, placed, suggested, anyPlaced });
}));

// ── PROFILE-1 — THE FOUR FIGURES AT THE TOP OF A PERSON'S RECORD ───────────
// Lifetime giving, the last gift, how long since we last spoke, and what we
// are asking them for. Each one is a figure like every other number in
// Steward: its VALUE comes from figureSources.figureValue, and the `source`
// it carries is exactly what the drawer re-fetches for the rows behind it, so
// the number on the record and the rows in the drawer are one computation and
// cannot drift apart.
//
// A figure with NO ROWS BEHIND IT IS NOT A ZERO. "£0 lifetime" and "nobody
// has given yet" are different facts and a record that says the first when it
// means the second is lying. So an empty figure comes back with value null
// and a sentence saying what will appear there and when.
const PROFILE_FIGURE_BLANKS = {
  softCredit: {
    blank: "No one has credited a gift to this person. When someone else's gift is credited to them, or a matching gift is, it shows here and never in Lifetime.",
    short: "No soft credit.",
  },
  lifetime: {
    blank: "Nothing has been given on this record yet. The first gift, logged here, imported, or given online, starts this total, and it never resets.",
    short: "No giving yet.",
  },
  lastGift: {
    blank: "No gift has come in from this person yet. The first one shows here the day it lands, with its date, its fund and how it was paid.",
    short: "No gift yet.",
  },
  contact: {
    blank: "Nobody has logged a conversation with this person yet. Log a call, a meeting, an email, an ask or a note and this becomes the days since the last one.",
    short: "Never contacted.",
  },
  openAsk: {
    blank: "There is no ask in flight with this person. Open a proposal and what you are asking for sits here until they say yes or no.",
    short: "No open ask.",
  },
  lastMet: {
    blank: "Nobody here has met this person yet, on a connected calendar or logged by hand. The first meeting shows here the day it happens.",
    short: "Not met yet.",
  },
  thisYear: {
    blank: "Nothing given yet this fiscal year. A gift dated in it shows here the day it is recorded.",
    short: "Nothing yet this fiscal year.",   // PROFILE-2: the number is the fiscal year
  },
  lastEmail: {
    blank: "No email with this person is on the record. Connect your inbox, or BCC Steward, and the next one lands here.",
    short: "No email yet.",
  },
};

// VOICE-4: the line under Last met is one short phrase, never cut mid-word.
// "Lunch. Went well, she made a gift to the boat fund" reads "Lunch, went
// well"; a longer first clause is cut back to the last whole word.
const MEETING_PHRASE_MAX = 22;
const PHRASE_TAIL = /\s+(?:a|an|the|at|to|of|in|on|for|with|and|or|down|up|about|from|by)$/i;
function meetingPhrase(name) {
  const line = String(name || "").split("\n")[0].replace(/\s+/g, " ").trim();
  if (!line) return null;
  const sentences = line.split(/(?<=[.!?])\s+/).map(x => x.replace(/[.!?]+$/, "").trim()).filter(Boolean);
  const clause = x => String(x || "").split(/[,;:(]|\s[-\u2013]\s/)[0].trim();
  let out = clause(sentences[0]);
  // A one- or two-word opener ("Lunch.") takes the first clause of what follows.
  if (out.split(" ").length <= 2 && sentences[1]) out = `${out}, ${clause(sentences[1]).replace(/^./, c => c.toLowerCase())}`;
  if (out.length > MEETING_PHRASE_MAX) {
    const cut = out.slice(0, MEETING_PHRASE_MAX + 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).replace(/[\s,;:]+$/, "") || out.split(" ")[0];
    while (PHRASE_TAIL.test(out)) out = out.replace(PHRASE_TAIL, "");
  }
  return out || null;
}

// The four, in one round trip. `today` is the ORGANISATION's civil date,
// computed once by the caller and handed to the source — figureSources.js
// never reads a clock for a calendar day.
async function donorProfileFigures(orgId, donorId, today) {
  const deps = { computeRetentionRate, computeDriftForDonors };
  const wanted = [
    ["lifetime", { key: "donor-lifetime",    params: { donor: donorId } }],
    ["lastGift", { key: "donor-last-gift",   params: { donor: donorId } }],
    ["contact",  { key: "donor-contact-gap", params: { donor: donorId, today } }],
    ["openAsk",  { key: "donor-open-ask",    params: { donor: donorId } }],
    // INT-BUILD-1 — the header reads Lifetime, Last gift, Last met, Last email.
    ["lastMet",   { key: "donor-last-met",   params: { donor: donorId, today } }],
    ["lastEmail", { key: "donor-last-email", params: { donor: donorId, today } }],
    // PROFILE-1 (header) — This year, beside Lifetime in the header's row.
    // NUMBERS-2: the org's own fiscal year, as Home and Fundraising.
    ["thisYear",  { key: "donor-gifts-between", params: { donor: donorId, from: orgFiscalYearStart(await orgTz(orgId)), to: today } }],   // ORG_TZ_SEAM_OK
    // FIX-49: soft and matching credits, their own figure, never in Lifetime.
    ["softCredit", { key: "donor-soft-credit", params: { donor: donorId } }],
  ];
  // PROFILE-1 (header) — the line under three of the numbers is read off the
  // figure's own first row (the same rows its drawer opens), so the date under
  // Last gift is the date of the gift that number is.
  const UNDER = {
    lastGift: r => r.date ? { date: String(r.date).slice(0, 10) } : null,
    lastMet: r => ({ date: String(r.date || "").slice(0, 10) || null, what: meetingPhrase(r.name) }),
    lastEmail: r => ({ date: String(r.date || "").slice(0, 10) || null, direction: /^From them/.test(r.detail || "") ? "replied" : /^To them/.test(r.detail || "") ? "sent" : null }),
  };
  const got = await Promise.all(wanted.map(async ([k, source]) => {
    const f = await figureSources.figureValue(orgId, source, deps);
    const empty = !f.totalRows;
    let under = null;
    if (!empty && UNDER[k]) {
      const full = await figureSources.figure(orgId, source, deps, { page: 1, pageSize: 1 });
      const r = full && full.rows && full.rows[0];
      under = r ? UNDER[k](r) : null;
      // PROFILE-2: how the last gift was paid, from the gift itself (the drawer
      // row's detail is its thank-you state).
      if (k === "lastGift" && under && r.id) {
        const [g] = await query(`SELECT NULLIF(payment_method, '') AS m FROM gifts WHERE id = ? AND org_id = ?`, [r.id, orgId]);
        // "Needs you" is recordGift's word for a method nobody gave (server.js GIFT_METHOD_UNKNOWN).
        under.method = g && g.m && g.m !== "Needs you" ? g.m : null;
      }
    }
    return [k, {
      value: empty ? null : f.value,
      cents: empty ? null : f.cents,
      under,
      source,
      blank: empty ? PROFILE_FIGURE_BLANKS[k].blank : null,
      blankShort: empty ? PROFILE_FIGURE_BLANKS[k].short : null,
    }];
  }));
  // NUMBERS-1 · First, Largest and Average ride the same read as Lifetime, so
  // whatever refreshes one tile refreshes all of them (they were a second read
  // that the voice card and other doors never re-asked for).
  const glance = await require("../numbers").donorGlance(query, orgId, donorId);
  const figs = Object.fromEntries(got);
  // IMPORT-4: This year leaves out gifts with no date, and says so on the figure itself.
  if (glance.undated && figs.thisYear) figs.thisYear = { ...figs.thisYear, notCounted: glance.undated.words, undatedSource: glance.undated.source };
  // A person whose every gift is undated has gifts, just no dated last one.
  if (glance.undated && figs.lastGift && figs.lastGift.value == null) figs.lastGift = { ...figs.lastGift, blank: "Their gifts on file have no date, so none is the last one.", blankShort: "No dated gift." };
  return { ...figs, first: glance.first, largest: glance.largest, average: glance.average, imported: glance.imported, undated: glance.undated };
}

app.get("/donors/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });

  const d = rows[0];
  d.tags = DTAGS.visibleTags(d.tags);
  // SECURE-3: the timeline is the one reader that opens a synced email's body.
  d.interactions = SEALED_MAIL.openInteractions(await query("SELECT * FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [d.id, req.user.orgId]));
  // FIX-11 Part 1 — the gift carries its fund's NAME, not just its id. The
  // timeline line reads "$100,000.00 · General Operating · ACH", and a screen
  // that only had `fund_id` had to either print an id at a fundraiser or load
  // the fund list a second time to translate it.
  d.gifts = await query(
    `SELECT g.*, f.name AS fund_name, ev.name AS event_name
       FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
       LEFT JOIN events ev ON ev.id = g.event_id AND ev.org_id = g.org_id
      WHERE g.donor_id = ? AND g.org_id = ? ORDER BY g.date DESC NULLS LAST`, [d.id, req.user.orgId]);
  d.matching_gift = lookupMatchingGift(d.employer);
  // BUILD-76 — the donor record shows the drift reason inline; same
  // computation as the list and every badge.
  const { map: driftMap } = await computeDriftForDonors(req.user.orgId, { donorIds: [d.id] });
  d.drift = driftBadgeField(driftMap.get(d.id));
  // BUILD-89S 89f — a donor who gives monthly through a connected source says
  // so on the record, in the SAME sentence the recurring dashboard uses
  // (shared/givingSources.js recurringPhrase), so the two cannot drift apart.
  // "Gives $50 monthly through PayPal" when the provider named it; "Looks like
  // $50 monthly through PayPal" while it is still Steward's own reading.
  try {
    const rec = await query(
      `SELECT r.amount_cents, r.interval, r.confidence, r.provider, r.expected_next, r.confirmed_at, s.display_name
         FROM giving_recurring r
         JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
        WHERE r.org_id=? AND r.donor_id=? AND r.status <> 'ended' AND s.status <> 'disconnected'
        ORDER BY r.amount_cents DESC LIMIT 1`, [req.user.orgId, d.id]);
    if (rec.length) {
      const { recurringPhrase } = await givingSourcesMod();
      const r = rec[0];
      d.source_recurring = {
        phrase: recurringPhrase({ amountCents: Number(r.amount_cents), interval: r.interval, confidence: r.confidence },
                                { provider: r.provider }),
        amountCents: Number(r.amount_cents), interval: r.interval,
        confidence: r.confidence, confirmed: !!r.confirmed_at,
        sourceName: r.display_name, expectedNext: r.expected_next,
      };
    }
  } catch (e) { console.error("[donor] source recurring:", e.message); }
  // BUILD-94 Part 1 — the record's own photo URL. The header signs its own
  // rather than reading the /people/photos map, so a profile is never the
  // record whose face went missing because a list was capped.
  d.photo_url = donorPhotoUrl(req.user.orgId, d.photo_asset_id);
  d.person_types = PT.typesOf(d);   // BUILD-94 Part 2
  // PROFILE-1 — the four figures, each carrying the source its drawer opens.
  d.figures = await donorProfileFigures(
    req.user.orgId, d.id, orgToday(await orgTz(req.user.orgId)));   // ORG_TZ_SEAM_OK
  // SECURE-2 item 3: an imported address that is not one is kept, and flagged.
  d.contact_flags = await require("../contactInputs").contactFlags(d);
  res.json(d);
}));

// ═══ PROFILE-1 (header + tabs) · THE RAIL, IN ONE READ ═══════════════════════
// The facts the profile's ink rail adds beside Next step and the scores: the
// giving rhythm LIVE-1 stored, a monthly plan, gifts waiting for a thank-you,
// what is coming up, how to reach them, volunteering and where their gifts
// come from. A card with nothing to say is null or an empty list, never an
// empty object, so the client leaves it out. Every number carries the source
// its rows open from. A read only: nothing here writes or heals.
const RAIL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const railMeetings = require("../meetings");
const railMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
const RAIL_PROVIDER_WORD = { paypal: "PayPal", zeffy: "Zeffy", givebutter: "Givebutter", square: "Square", stripe: "Stripe", quickbooks: "QuickBooks" };
function railNextBirthday(month, day, today) {
  if (!month || !day) return null;
  const y = +today.slice(0, 4);
  const on = yr => {
    const leap = yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0);
    const d = month === 2 && day === 29 && !leap ? 28 : day;
    return `${yr}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const thisYear = on(y);
  return thisYear >= today ? thisYear : on(y + 1);
}
app.get("/donors/:id/rail", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, id = req.params.id;
  const [d] = await query(
    `SELECT id, name, email, phone, address, address2, city, state, zip, country, birth_month, birth_day,
            deceased, do_not_contact, do_not_solicit, do_not_mail, do_not_email, email_unreachable, address_unmailable,
            phone_unreachable, is_client, (SELECT client_privacy FROM orgs WHERE id = donors.org_id) AS client_privacy
       FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const plus = n => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const horizon = plus(60);
  const since = await orgStewardStart(orgId);
  const val = s => figureSources.figureValue(orgId, s);
  const [rhy, subs, srcRec, unthanked, events, meetingsAhead, steps, vh, origins, suppressed] = await Promise.all([
    query(`SELECT rhythm, expected_next FROM donor_rhythm WHERE org_id = ? AND donor_id = ?`, [orgId, id]),
    query(`SELECT id, amount, interval, status, TO_CHAR(current_period_end, 'YYYY-MM-DD') AS next_charge
             FROM recurring_subscriptions
            WHERE org_id = ? AND donor_id = ? AND status IN ('active','past_due','recovering','recovered','paused')
            ORDER BY (status IN ('past_due','recovering')) DESC, amount DESC LIMIT 1`, [orgId, id]),
    query(`SELECT r.id, r.amount_cents, r.interval, r.expected_next, r.status, s.provider, s.display_name
             FROM giving_recurring r JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
            WHERE r.org_id = ? AND r.donor_id = ? AND r.status <> 'ended' AND s.status <> 'disconnected'
            ORDER BY r.amount_cents DESC LIMIT 1`, [orgId, id]),
    since ? query(`SELECT g.id, g.amount, g.date,
                          (SELECT t.id FROM thank_you_drafts t WHERE t.org_id = g.org_id AND t.gift_id = g.id
                              AND t.sent_at IS NULL AND t.skipped_at IS NULL ORDER BY t.created_at DESC LIMIT 1) AS draft_id
                     FROM gifts g
                    WHERE g.org_id = ? AND g.donor_id = ? AND COALESCE(g.is_sample,false) = false
                      AND g.date >= ? AND COALESCE(g.acknowledgement_sent,false) = false AND g.amount > 0
                    ORDER BY g.date DESC NULLS LAST, g.id DESC`, [orgId, id, since]) : [],
    query(`SELECT e.id, e.name, LEFT(e.date::text, 10) AS date FROM event_attendees ea JOIN events e ON e.id = ea.event_id AND e.org_id = ea.org_id
            WHERE ea.donor_id = ? AND ea.org_id = ? AND LEFT(e.date::text, 10) >= ?
              AND COALESCE(ea.status, '') NOT IN ('cancelled','canceled','declined')
              AND e.date_unknown IS NOT TRUE   -- IMPORT-4: an imported event whose day the file never gave is past, not coming up
            ORDER BY e.date ASC LIMIT 6`, [id, orgId, today]),
    railMeetings.meetingsWith(orgId, id, { held: false, limit: 50 }),
    query(`SELECT st.id, st.label, st.due_date, p.template_name
             FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id = st.plan_id AND p.org_id = st.org_id
            WHERE st.org_id = ? AND p.donor_id = ? AND p.status = 'active' AND st.status IN ('open','pending')
              AND st.due_date >= ? AND st.due_date <= ?
            ORDER BY st.due_date ASC LIMIT 6`, [orgId, id, today, horizon]),
    query(`SELECT COALESCE(SUM(hours), 0)::float AS h, TO_CHAR(MAX(date::date), 'YYYY-MM-DD') AS last
             FROM volunteer_shifts WHERE org_id = ? AND person_id = ?`, [orgId, id]),
    query(`SELECT CASE WHEN g.giving_page_id IS NOT NULL THEN 'page'
                       WHEN g.giving_source_id IS NOT NULL THEN 'source'
                       WHEN g.stripe_payment_id IS NOT NULL THEN 'stripe'
                       WHEN g.read_from_vendor = 'quickbooks' THEN 'quickbooks' END AS origin,
                  CASE WHEN g.giving_page_id IS NULL THEN g.giving_source_id END AS ref,
                  COUNT(*)::int AS n
             FROM gifts g WHERE g.org_id = ? AND g.donor_id = ?
              AND (g.giving_page_id IS NOT NULL OR g.giving_source_id IS NOT NULL OR g.stripe_payment_id IS NOT NULL OR g.read_from_vendor = 'quickbooks')
            GROUP BY 1, 2`, [orgId, id]),
    d.email ? query(`SELECT 1 AS y FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND (org_id = ? OR org_id IS NULL) LIMIT 1`, [d.email, orgId]) : [],
  ]);
  const lifetimeSrc = { key: "donor-lifetime", params: { donor: id } };

  // GIVING RHYTHM: LIVE-1's stored rhythm, said once.
  let rhythm = null;
  const r = rhy[0];
  if (r && (r.rhythm !== "none" || r.expected_next)) {
    const exp = r.expected_next ? String(r.expected_next).slice(0, 10) : null;
    const DR = require("../drift");
    const sentence = (r.rhythm === "yearly" || r.rhythm === "year_end") && exp
      ? `Gives every ${RAIL_MONTHS[+exp.slice(5, 7) - 1]}` : (DR.RHYTHM_WORDS[r.rhythm] || DR.RHYTHM_WORDS.none);
    // PROFILE-2 Part 4: a steady gap between the named bands (every two
    // months, say) was stored as "none" beside an expected next gift, and the
    // card read "No pattern yet" over a closeness line that named the gap.
    // Drift's own reading names it here too, the way routes/profileStatus.js does.
    let said = sentence;
    if (r.rhythm === "none" && exp) {
      const gs = await query(`SELECT LEFT(date,10) AS date, amount::text AS amount FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0 AND LEFT(date,10) <= ?`, [orgId, id, today]);
      const a = DR.assessDrift(gs.map(g => ({ date: g.date, amount: Number(g.amount) })), today);
      if (a && a.cadenceDays) said = `Gives ${DR.humanCadence(a.cadenceDays)}`;
    }
    rhythm = { sentence: said, expectedNext: exp, late: !!exp && exp < today, source: lifetimeSrc };
  }

  // RECURRING: a monthly plan Steward charges, else a schedule in a source.
  let recurring = null;
  if (subs[0]) {
    const s = subs[0], failed = ["past_due", "recovering"].includes(s.status);
    const source = { key: "donor-gifts-from", params: { donor: id, origin: "plan", ref: s.id } };
    const word = s.interval === "year" ? "yearly" : "monthly";
    recurring = { amount: Number(s.amount), interval: s.interval || "month", nextCharge: failed || s.status === "paused" ? null : s.next_charge || null,
      failed, paused: s.status === "paused",
      sentence: failed ? `The card on their ${word} gift is failing` : s.status === "paused" ? `Their ${word} gift is paused` : `Gives ${railMoney(s.amount)} ${word}`,
      source, given: await val(source) };
  } else if (srcRec[0]) {
    const s = srcRec[0], amount = Number(s.amount_cents) / 100;
    const source = { key: "donor-gifts-from", params: { donor: id, origin: "recurring", ref: s.id } };
    const via = RAIL_PROVIDER_WORD[s.provider] || s.display_name;
    recurring = { amount, interval: s.interval || "month", nextCharge: s.expected_next ? String(s.expected_next).slice(0, 10) : null,
      failed: s.status === "missed", paused: false,
      sentence: s.status === "missed" ? `A ${via} gift they give on a schedule did not come in` : `Gives ${railMoney(amount)} ${s.interval === "year" ? "yearly" : "monthly"} through ${via}`,
      source, given: await val(source) };
  }
  if (recurring && recurring.given) recurring.given = { value: recurring.given.value, count: recurring.given.totalRows };

  // THANK-YOUS: the gifts the 0.6 rule says are still owed one.
  const thankYousSource = since ? { key: "unthanked", params: { since, donor: id } } : null;
  // Each gift opens the waiting list it is one row of.
  const thankYous = unthanked.map(g => ({ giftId: g.id, amount: Number(g.amount), date: String(g.date).slice(0, 10),
    draftId: g.draft_id || null, source: thankYousSource }));

  // COMING UP: the next sixty days, soonest first.
  const comingUp = [];
  const bd = railNextBirthday(Number(d.birth_month) || 0, Number(d.birth_day) || 0, today);
  if (bd && bd <= horizon) comingUp.push({ kind: "birthday", label: "Birthday", date: bd });
  for (const e of events) comingUp.push({ kind: "event", label: e.name, date: e.date, id: e.id });
  for (const m of meetingsAhead) if (m.date && m.date >= today && m.date <= horizon) comingUp.push({ kind: "meeting", label: m.title || "Meeting", date: m.date, id: m.id });
  for (const st of steps) comingUp.push({ kind: "journey", label: st.label, date: String(st.due_date).slice(0, 10), id: st.id, journey: st.template_name });
  comingUp.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // VOLUNTEERING: the profile's own volunteer-hours source, lifetime.
  const h = vh[0] && Number(vh[0].h) || 0;
  const volunteering = h > 0 ? { hours: Math.round(h * 100) / 100, lastShift: vh[0].last || null,
    source: { key: "volunteer-hours", params: { from: "1900-01-01", to: "2999-12-31", donor: id } } } : null;

  // CONNECTED: one card per place their gifts came from.
  const srcIds = [...new Set(origins.filter(o => o.origin === "source" && o.ref).map(o => o.ref))];
  const srcNames = srcIds.length ? await query(`SELECT id, provider, display_name FROM giving_sources WHERE org_id = ? AND id = ANY(?)`, [orgId, srcIds]) : [];
  const nameOf = Object.fromEntries(srcNames.map(s => [s.id, s]));
  const connected = await Promise.all(origins.filter(o => o.origin).map(async o => {
    const params = { donor: id, origin: o.origin, ...(o.origin === "source" ? { ref: o.ref } : {}) };
    const source = { key: "donor-gifts-from", params };
    const f = await val(source);
    const s = o.origin === "source" ? nameOf[o.ref] : null;
    const provider = o.origin === "source" ? (s ? s.provider : "source") : o.origin;
    const label = o.origin === "page" ? "A giving page" : o.origin === "source" ? (RAIL_PROVIDER_WORD[provider] || (s && s.display_name) || "A connected source")
      : RAIL_PROVIDER_WORD[o.origin];
    return { provider, label, count: f.totalRows, total: f.value, source };
  }));
  connected.sort((a, b) => b.total - a.total);

  // CONTACT: how to reach them, and every flag that says not to, plainly.
  // The country is said only when it is not the default and there is an
  // address to go with it ("US" alone is not an address).
  const street = [d.address, d.address2, [d.city, [d.state, d.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .map(x => String(x || "").trim()).filter(Boolean);
  const country = String(d.country || "").trim();
  const address = street.length ? [...street, ...(country && !/^(us|usa|united states)$/i.test(country) ? [country] : [])].join(", ") : null;
  const flags = [];
  if (d.deceased) flags.push({ key: "deceased", label: "Deceased" });
  if (d.do_not_contact) flags.push({ key: "do_not_contact", label: "Do not contact" });
  if (d.do_not_solicit) flags.push({ key: "do_not_solicit", label: "Do not solicit" });
  if (d.do_not_mail) flags.push({ key: "do_not_mail", label: "Do not mail" });
  if (d.do_not_email || suppressed.length) flags.push({ key: "do_not_email", label: "No email: opted out" });
  if (d.email_unreachable) flags.push({ key: "email_unreachable", label: "Email bounced" });
  if (d.address_unmailable) flags.push({ key: "address_unmailable", label: "Address returned mail" });
  if (d.phone_unreachable) flags.push({ key: "phone_unreachable", label: "Phone marked wrong" });
  // CLIENT-SAFE-1: the client flag has its own row (ContactExtras), shown when
  // the org's privacy mode is on or the flag is already set.
  const contact = { email: d.email || null, phone: d.phone || null, address, addressBad: d.address_unmailable === true, preferred: null, flags,
    isClient: d.is_client === true, privacyOn: d.client_privacy === true };

  res.json({ today, rhythm, recurring, thankYous, thankYousSource: thankYous.length ? thankYousSource : null,
    comingUp: comingUp.slice(0, 6), volunteering, connected, contact });
}));

app.post("/donors", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../contactInputs").checkContact(req.body || {}, { email: ["email", "email2"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const { email, phone, status, stage, tags, notes, lastAmount, assignedTo, assignedToName, personTypes } = req.body;
  // THREAD-2 · A NAME IS A NAME. "   " and the word "null" (a form that joined
  // two empty fields) were saved as names, and printed on the Thread and in
  // the morning email as a blank or as "null". Refused here, at the source.
  if (!(await ItemRefs.links()).realName(req.body.name)) return res.status(400).json({ error: "Name required" });
  const name = String(req.body.name).replace(/\s+/g, " ").trim();
  // BUILD-94 Part 2 — a person added by hand can be a volunteer from the
  // start. Unknown keys are dropped by normalizeTypes, never stored.
  const types = personTypes === undefined ? ["donor"] : PT.normalizeTypes(personTypes);

  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999 && recordCheck.current >= recordCheck.limit) {
      return res.status(403).json({ error: "record_limit", message: `You've reached your donor record limit of ${recordCheck.limit}.`, current: recordCheck.current, limit: recordCheck.limit, plan: orgForLimit[0].plan, isTrial: false });
    }
  }

  // FIX-19: an assignee named here is an active user of this org, and the name
  // beside the id is read off that users row, never the payload.
  const named = await OU.orgUser(req.user.orgId, assignedTo);
  if (!named.ok) return OU.refuse(res, "assignedTo");

  const id = "d_" + uuid().slice(0, 8);
  let selfName = assignedToName;
  if (!assignedTo && !selfName) {
    const uRow = await query("SELECT name FROM users WHERE id = ?", [req.user.userId]);
    selfName = uRow[0]?.name || req.user.email;
  }
  const finalAssignedTo = assignedTo || req.user.userId;
  const finalAssignedToName = assignedTo ? (named.user.name || assignedToName || "") : selfName;
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,assigned_to,assigned_to_name,created_by,created_by_name,person_types)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    // BUILD-80 Part 10 — the quick form's typed amount carries NO date: a
    // last_gift_date of "today" was a fiction that un-drifted the donor.
    [id, req.user.orgId, name, email || "", phone || "", status || "new", stage || "prospect",
     lastAmount || 0, lastAmount || 0, null, lastAmount ? 1 : 0,
     JSON.stringify(tags || []), notes || "", finalAssignedTo, finalAssignedToName, actor(req).id, actor(req).name,
     JSON.stringify(types)]
  );
  // NUMBERS-2: a typed amount with no gift behind it is kept as its own figure.
  if (lastAmount) await keepImportedTotals(query, req.user.orgId, [id], "an amount typed in when they were added");
  const rows = await query("SELECT * FROM donors WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

// AGENT-2: CHANGE HOW TO REACH SOMEBODY, AND ONLY THAT. PUT /donors/:id
// replaces the whole record (a missing stage there becomes "cultivate"), so a
// new email, phone or address arrives here instead: only the fields given
// change, an email must look like one, and an address change is kept in
// donor_address_history beside the tidy-up's own.
app.patch("/donors/:id/contact", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../contactInputs").checkContact(req.body || {}, { email: ["email"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const orgId = req.user.orgId, b = req.body || {};
  const [d] = await query("SELECT id, name, email, phone, address, address2, city, state, zip FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const FIELDS = ["email", "phone", "address", "address2", "city", "state", "zip"];
  const next = {};
  for (const f of FIELDS) if (b[f] !== undefined && b[f] !== null) next[f] = String(b[f]).trim().slice(0, f === "address" || f === "address2" ? 200 : 120);
  if (next.email !== undefined) {
    next.email = next.email.toLowerCase();
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) return res.status(400).json({ error: "bad_email", message: "That does not look like an email address." });
  }
  const keys = Object.keys(next).filter(k => String(d[k] || "") !== next[k]);
  if (!keys.length) return res.json({ id: d.id, changed: [], unchanged: true, sentence: `${d.name}'s record already says that.` });
  if (keys.some(k => ["address", "address2", "city", "state", "zip"].includes(k))) {
    const was = { address: d.address, address2: d.address2, city: d.city, state: d.state, zip: d.zip };
    const now = { ...was }; for (const k of keys) if (k in now) now[k] = next[k];
    await run(`INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)`,
      ["dah_" + uuid().slice(0, 12), orgId, d.id, "edit", JSON.stringify(was), JSON.stringify(now), actor(req).id, actor(req).name]);
  }
  await run(`UPDATE donors SET ${keys.map(k => `${k}=?`).join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...keys.map(k => next[k] || null), d.id, orgId]);
  if (keys.some(k => ["address", "city", "state", "zip"].includes(k))) {
    try { await markDonorsForGeocoding(orgId, { donorIds: [d.id] }); } catch (e) { console.error("[geocode] mark after contact edit failed:", e.message); }
  }
  res.json({ id: d.id, changed: keys, before: Object.fromEntries(keys.map(k => [k, d[k] ?? null])),
    sentence: `${d.name}'s ${keys.map(k => k === "address2" ? "address" : k).filter((x, i, a) => a.indexOf(x) === i).join(", ")} ${keys.length === 1 ? "is" : "are"} changed.` });
}));

app.put("/donors/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../contactInputs").checkContact(req.body || {}, { email: ["email", "email2"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const { email, phone, status, stage, tags, notes, city, state, zip, employer } = req.body;
  if (!(await ItemRefs.links()).realName(req.body.name)) return res.status(400).json({ error: "Name required" });   // THREAD-2
  const name = String(req.body.name).replace(/\s+/g, " ").trim();
  // FIX-1 D — DONOR IS SET BY GIVING, on this door too. Checked BEFORE any
  // write, so a refused change leaves the whole record untouched.
  if (req.body.personTypes !== undefined) {
    const refused = await donorRemovalProblem(req.user.orgId, req.params.id, req.body.personTypes);
    if (refused) return res.status(409).json(refused);
  }
  // PARITY-3 6a — the birthday, read once and refused before any write. Only
  // touched when the request carries it, so older callers never clear one.
  // { month, day, year? }, a typed cell ("May 22"), or null / "" to clear.
  let birthday;
  if (req.body.birthday !== undefined) {
    const B = await birthdayMod();
    const v = req.body.birthday;
    if (v === null || v === "" || (typeof v === "object" && !v.month && !v.day && !v.year)) birthday = null;
    else if (typeof v === "object") {
      const year = v.year === "" || v.year == null ? null : Number(v.year);
      if (!B.validBirthday(Number(v.month), Number(v.day), year))
        return res.status(400).json({ error: "A birthday needs a real month and day. The year is optional." });
      birthday = { month: Number(v.month), day: Number(v.day), year };
    } else {
      birthday = B.parseBirthday(v);
      if (!birthday) return res.status(400).json({ error: "A birthday needs a real month and day, like May 22. The year is optional." });
    }
  }

  // FIX-33: the client never sees an internal flag (donorTags.js), so the
  // list it sends back is kept with the row's own flags, never erasing them.
  const [tagRow] = await query("SELECT tags FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  const keptTags = DTAGS.keepInternal(tagRow ? tagRow.tags : "[]", tags || []);
  const affected = await run(
    `UPDATE donors SET name=?,email=?,phone=?,status=?,stage=?,tags=?,notes=?,city=?,state=?,zip=?,employer=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, email || "", phone || "", status, stage || "cultivate", JSON.stringify(keptTags), notes || "",
     city || null, state || null, zip || null, employer || null,
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  if (birthday !== undefined) {
    await run(`UPDATE donors SET birth_month=?, birth_day=?, birth_year=? WHERE id=? AND org_id=?`,
      [birthday ? birthday.month : null, birthday ? birthday.day : null, birthday ? birthday.year : null,
       req.params.id, req.user.orgId]);
  }

  // BUILD-94 Part 2 — the person's type(s). Only touched when the request
  // carries the field, so every existing caller leaves it alone; a caller that
  // does send it cannot clear it to nothing (normalizeTypes floors at
  // ["other"]) and cannot invent a fifth type.
  if (req.body.personTypes !== undefined) {
    const [wasRow] = await query(`SELECT person_types FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    const next = PT.normalizeTypes(req.body.personTypes);
    await run(`UPDATE donors SET person_types = ?::jsonb WHERE id=? AND org_id=?`,
      [JSON.stringify(next), req.params.id, req.user.orgId]);
    // BUILD-94 Part 3 — ADDED AS VOLUNTEER is a trigger, and it fires on the
    // transition, never on a save that leaves them a volunteer they already
    // were. (Enrollment is idempotent anyway, but firing on every save would
    // put a wrong line in the log.)
    if (!PT.hasType(wasRow || {}, "volunteer") && next.includes("volunteer")) {
      enrollInSequences(req.user.orgId, req.params.id, "added_volunteer", {}, actor(req))
        .catch(e => console.error("[seq] volunteer trigger:", e.message));
    }
  }

  // BUILD-58 Part 2 — the deceased / do-not-contact flags (only touched when
  // the request carries them, so older callers never clobber a stored flag).
  if (req.body.deceased !== undefined || req.body.doNotContact !== undefined) {
    await run(
      `UPDATE donors SET deceased = COALESCE(?, deceased), do_not_contact = COALESCE(?, do_not_contact) WHERE id=? AND org_id=?`,
      [req.body.deceased === undefined ? null : !!req.body.deceased,
       req.body.doNotContact === undefined ? null : !!req.body.doNotContact,
       req.params.id, req.user.orgId]
    );
  }

  // BUILD-84 P0-4 — an address change is the only other thing that makes a
  // donor need geocoding. Marked here, looked up on the tick, never on read.
  try { await markDonorsForGeocoding(req.user.orgId, { donorIds: [req.params.id] }); }
  catch (e) { console.error("[geocode] mark after donor edit failed:", e.message); }

  const rows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  const d = rows[0];
  d.tags = DTAGS.visibleTags(d.tags);
  d.matching_gift = lookupMatchingGift(d.employer);
  res.json(d);
}));

// Managed-stage changes are a Team (major-gifts) capability — the pipeline is
// purely Team (BUILD-19; donor-profile Core/Team split FIX). Core sees stage
// read-only; changing it (single or bulk) requires the Team plan. This
// reverses the earlier "per-donor stage dropdown is Core-fine" note.
app.patch("/donors/:id/stage", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { stage, prevStage } = req.body;
  const valid = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
  if (!valid.includes(stage)) return res.status(400).json({ error: "Invalid stage" });

  const donorRow = await query("SELECT stage FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorRow.length) return res.status(404).json({ error: "Donor not found" });
  const oldStage = prevStage || donorRow[0].stage;

  const affected = await run(
    `UPDATE donors SET stage=?,updated_at=NOW() WHERE id=? AND org_id=?`,
    [stage, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });

  // Log stage change
  try {
    const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const userName = userRow[0]?.name || "";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_"+uuid().slice(0,8), req.user.orgId, req.params.id, "stage_change",
       `Stage moved from ${oldStage || "Not set"} → ${stage}`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, userName]   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
    );
  } catch(e) { console.error("Stage change log:", e.message); }

  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.json({ success: true, stage });
}));

// Soft delete — same trash model as POST /donors/bulk-delete. A hard DELETE
// here threw FK violations for any donor with gifts/interactions/etc.;
// permanent deletion is POST /donors/purge-trash's job (FK-safe child order).
// THREAD-3 · A PERSON WITH A LIVE MONTHLY PLAN IS NOT DELETED.
// Deleting the record would leave a card being charged every month for
// somebody Steward no longer shows, and Steward never cancels a Stripe plan as
// a side effect of anything. So delete is refused while a plan is live, with
// the two ways out said plainly: cancel the plan first, or archive the person
// (they leave the lists and the plan keeps running).
const LIVE_PLAN_STATUSES = GR.ACTIVE_RECURRING_STATUSES.concat(["paused"]);
async function livePlansFor(orgId, ids) {
  return query(
    `SELECT rs.id, rs.donor_id, rs.amount, rs.interval, d.name FROM recurring_subscriptions rs
       JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id
      WHERE rs.org_id = ? AND rs.donor_id = ANY(?::text[]) AND rs.status = ANY(?::text[])
      ORDER BY d.name, rs.id`, [orgId, ids, LIVE_PLAN_STATUSES]);
}
function livePlanSentence(p) {
  const amt = "$" + Number(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: Number(p.amount) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const per = p.interval === "year" ? "yearly" : p.interval === "week" ? "weekly" : "monthly";
  return `${p.name} has a ${amt} ${per} plan. Cancel it first, or archive them instead.`;
}

app.delete("/donors/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [plan] = await livePlansFor(req.user.orgId, [req.params.id]);
  if (plan) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    return res.status(409).json({ error: "active_plan", sentence: livePlanSentence(plan), planId: plan.id, canArchive: true });
  }
  const result = await run(
    "UPDATE donors SET deleted_at=NOW() WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.id, req.user.orgId]
  );
  if (!result.changes) return res.status(404).json({ error: "Donor not found" });
  // FIX-22: a donor delete is already soft (deleted_at), so Undo only has to
  // clear the stamp. The trash row records that, and nothing else.
  const who = actor(req);
  const undoId = "del_" + uuid().slice(0, 12);
  await run(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
             VALUES (?, ?, 'donors', ?, '{"__soft":true}'::jsonb, ?, ?)`,
    [undoId, req.user.orgId, req.params.id, who.id, who.name]);
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// THREAD-3 · ARCHIVE. The person leaves the Donors list and every Group, and
// nothing else changes: their monthly plan keeps charging, their gifts keep
// counting, and the record opens from search or a link with an Archived mark.
// Unarchive is the Undo.
app.post("/donors/:id/archive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const r = await query(`UPDATE donors SET archived_at=NOW(), archived_by=?, updated_at=NOW()
                          WHERE id=? AND org_id=? AND deleted_at IS NULL AND archived_at IS NULL RETURNING id, name`,
    [actor(req).id, req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found, or already archived" });
  res.json({ archived: true, sentence: `${r[0].name} is archived. They are off your lists, and anything they give keeps arriving.` });
}));
app.post("/donors/:id/unarchive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const r = await query(`UPDATE donors SET archived_at=NULL, archived_by=NULL, updated_at=NOW()
                          WHERE id=? AND org_id=? AND deleted_at IS NULL AND archived_at IS NOT NULL RETURNING id, name`,
    [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found, or not archived" });
  res.json({ archived: false, sentence: `${r[0].name} is back on your lists.` });
}));

app.patch("/donors/:id/assign", requireAuth, requireAdmin, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { assignedTo } = req.body;
  // Assignment IS pipeline membership (BUILD-30): assigning an officer puts the
  // donor in that officer's portfolio AND on their board immediately; unassigning
  // (assignedTo null) removes them from the board and back to the Directory only.
  //
  // BUILD-99 (major gifts) Part 2 — THREE THINGS THIS ROUTE WAS NOT DOING, and
  // `/donors/bulk-assign` one screen over was doing all three:
  //   · the officer id was never checked against THIS org, so a foreign user id
  //     landed on the row and that person appeared as the owner of a donor they
  //     cannot see;
  //   · the owner's NAME came off the payload, so a caller could write any name
  //     beside any id — an identity the row then asserts on every screen;
  //   · there was no actor, so "why is this person on my list" had no answer.
  // The name is now read from the users row and the actor is stamped, which is
  // the BUILD-75 rule this table was already inside.
  let officerId = null, officerName = null;
  if (assignedTo) {
    const { ok, user: u } = await OU.orgUser(req.user.orgId, assignedTo);
    if (!ok) return OU.refuse(res, "assignedTo");
    officerId = u.id; officerName = u.name;
  }
  // THE NAME ON THE STAMP IS A NAME, NOT A LOGIN. `actor(req).name` is the
  // caller's EMAIL — right for an audit column, wrong the moment a screen reads
  // it back as "assigned by …". This is the third appearance of that class
  // (BUILD-98 Part 2 caught it on "who thanked them"), so the id stays the
  // actor's and the name is read off the users row.
  const byName = (await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]))[0]?.name
    || actor(req).name;
  const affected = await run(
    `UPDATE donors SET assigned_to=?, assigned_to_name=?,
       assigned_by=?, assigned_by_name=?, assigned_at=CASE WHEN ?::text IS NULL THEN NULL ELSE NOW() END,
       pending_assignee_invite_id=NULL, pending_assignee_name=NULL, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [officerId, officerName, officerId ? actor(req).id : null, officerId ? byName : null,
     officerId, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  res.json({ success: true, assignedTo: officerId, assignedToName: officerName });
}));

// ── Bulk donor operations ──────────────────────────────────────────────────
// Future: restore-from-trash view + permanent-purge scheduled job can be
// built on deleted_at — the column is stable and org-scoped.

app.patch("/donors/bulk-stage", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { ids, stage } = req.body;
  const VALID = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!VALID.includes(stage)) return res.status(400).json({ error: "Invalid stage" });

  // Verify every id belongs to the caller's org — reject the whole batch on any mismatch
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  const result = await run(
    "UPDATE donors SET stage=?, updated_at=NOW() WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [stage, ids, req.user.orgId]
  );
  res.json({ updated: result.changes });
}));

app.patch("/donors/bulk-assign", requireAuth, requireAdmin, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { ids, assignedTo } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!assignedTo) return res.status(400).json({ error: "assignedTo required" });

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  // BUILD-36 B2: the owner is either a real active user in this org, or a PENDING
  // invite ("invite:<id>") — held until that officer accepts, exactly like the
  // import owner-routing (pending-invitee rules). A pending assignment clears any
  // real owner and does NOT put the donor on a board yet (assigned_to stays NULL);
  // /auth/invite/accept later resolves it to the new user + their board.
  if (String(assignedTo).startsWith("invite:")) {
    const inviteId = String(assignedTo).slice("invite:".length);
    const inv = await query(
      "SELECT id, email FROM invites WHERE id=? AND org_id=? AND accepted_at IS NULL AND expires_at > NOW()",
      [inviteId, req.user.orgId]);
    if (!inv.length) return res.status(400).json({ error: "Invite not found or no longer pending" });
    const pendingName = inviteeDisplayName(inv[0].email);
    const result = await run(
      `UPDATE donors SET assigned_to=NULL, assigned_to_name=NULL,
         pending_assignee_invite_id=?, pending_assignee_name=?, updated_at=NOW()
       WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
      [inviteId, pendingName, ids, req.user.orgId]);
    return res.json({ updated: result.changes, pending: true, assignedToName: pendingName });
  }

  const named = await OU.orgUser(req.user.orgId, assignedTo);
  if (!named.ok) return OU.refuse(res, "assignedTo");
  const assignedToName = named.user.name;
  // BUILD-99 Part 2 — the stamp's NAME is a name; see /donors/:id/assign.
  const bulkByName = (await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]))[0]?.name
    || actor(req).name;

  // Bulk-assigning to an officer puts the batch in that officer's portfolio AND
  // on their board — assignment IS membership (BUILD-30), no separate flag. Any
  // prior pending-invite hold is cleared.
  const result = await run(
    `UPDATE donors SET assigned_to=?, assigned_to_name=?,
       assigned_by=?, assigned_by_name=?, assigned_at=NOW(),
       pending_assignee_invite_id=NULL, pending_assignee_name=NULL, updated_at=NOW()
     WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [assignedTo, assignedToName, actor(req).id, bulkByName, ids, req.user.orgId]);
  res.json({ updated: result.changes, assignedToName });
}));

app.post("/donors/bulk-delete", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ error: "ids array required" });
  // FIX-54 · "Select all N matching", then Delete, deletes exactly N. The
  // screen sends the N it showed in the confirm; a selection that no longer
  // holds that many people is refused whole, so the number she agreed to is
  // the number that goes.
  const ids = [...new Set(req.body.ids.map(String))];
  const expect = req.body.count;
  if (expect !== undefined && Number(expect) !== ids.length) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    return res.status(409).json({ error: "count_changed", sentence: `You confirmed ${Number(expect).toLocaleString("en-US")}, and the selection holds ${ids.length.toLocaleString("en-US")}. Nobody was deleted.` });
  }

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });
  // THREAD-3: nobody with a live plan is deleted, in a batch either. The
  // whole batch is refused so nothing half-happens; the sentence names them.
  const plans = await livePlansFor(req.user.orgId, ids);
  if (plans.length) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    const people = [...new Set(plans.map(p => p.donor_id))];
    return res.status(409).json({ error: "active_plan", donorIds: people,
      sentence: people.length === 1 ? livePlanSentence(plans[0])
        : `${people.length} of these people have a monthly plan (${livePlanSentence(plans[0]).replace(/\. Cancel.*$/, "")}, and others). Cancel their plans first, or archive them instead.` });
  }

  // WIRE-1: one trash row per person, exactly as DELETE /donors/:id writes,
  // so the shared Undo toast can bring the whole batch back.
  const who = actor(req);
  const { changes, undoIds } = await withTransaction(async (client) => {
    const gone = await queryTx(client,
      "UPDATE donors SET deleted_at=NOW() WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL RETURNING id",
      [ids, req.user.orgId]);
    // one trash row each, written 500 at a time (a whole org is one click now)
    const undoIds = gone.map(() => "del_" + uuid().slice(0, 12));
    for (let k = 0; k < gone.length; k += 500) {
      const b = gone.slice(k, k + 500);
      await runTx(client, `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
                 VALUES ${b.map(() => `(?, ?, 'donors', ?, '{"__soft":true}'::jsonb, ?, ?)`).join(",")}`,
        b.flatMap((g, i) => [undoIds[k + i], req.user.orgId, g.id, who.id, who.name]));
    }
    return { changes: gone.length, undoIds };
  });
  require("./dataHealth").recheckSoon(req.user.orgId, "delete");   // FIX-59: Data health is current
  res.json({ deleted: changes, undoIds, undoSeconds: UNDO_SECONDS });
}));

// The "permanent-purge" the comment above bulk-delete anticipated: hard-
// deletes every trashed (deleted_at IS NOT NULL) donor in the org, plus all
// rows that exist only because those donors did. WIRE-1: it walks EVERY person
// pointer in Data health's MERGE_REFS, so a column added for the merge is
// covered here in the same commit and nothing is left pointing at a person
// who is gone:
//   · the person's own records (gifts, receipts, pledges, notes, tasks,
//     memberships and the rest) are deleted, child rows first in FK-safe order
//   · a money, ledger or history row that is not theirs to take with them
//     (a bookkeeping line, a POS sale, an auction item, another donor's gift
//     in their honour, a household they headed, the portal log) keeps the row
//     and loses the pointer
//   · a meeting drops them from its people, and goes only if nobody is left
// One transaction: a mid-purge failure leaves nothing half-deleted.
// Admin-only; like all DELETE-shaped routes, never checkWriteAccess-gated (a
// lapsed org can still empty its trash).
const PURGE_KEEP_ROW = new Set([
  "fin_transactions.donor_id", "pos_sales.person_id", "households.primary_donor_id", "grants.funder_donor_id",
  "grant_sends.funder_donor_id", "gifts.tribute_donor_id", "gifts.match_employer_id", "auction_items.donor_id",
  "auction_refund_flags.donor_id", "peer_fundraisers.person_id", "recurring_change_log.donor_id",
  "portal_audit_log.donor_id", "custom_field_events.entity_id", "volunteers.donor_id", "event_attendees.donor_id",
  "survey_responses.donor_id", "volunteer_applications.person_id", "volunteer_groups.contact_person_id",
]);
// The person's own rows with a plain FK to donors (or to their gifts), in the
// order they must go: receipts and pledges point at gifts, gifts last.
const PURGE_CHILD_TABLES = [
  "receipts", "pledges", "memberships", "milestone_drafts", "note_reminders", "donor_materials",
  "planned_gifts", "custom_field_values", "sequence_enrollments",
  "payment_recovery_events", "recurring_subscriptions",
  "tasks", "interaction_attachments", "interactions", "gifts",
];
// FIX-55 · EMPTY TRASH (Settings, Imports). People deleted by hand, older than
// the days she chose (or all), are deleted for good, so they never match an
// import again. Someone merged into another record is not in the trash (the
// merge's Undo needs them). The count comes first (GET .../preview) and the
// write needs a second confirm (`confirm: "empty"`). The audit row says that a
// delete happened and how many, never who.
async function purgeableIds(orgId, olderThanDays) {
  const days = olderThanDays == null || olderThanDays === "" ? null : Math.max(0, Math.floor(Number(olderThanDays)));
  if (days != null && !Number.isFinite(days)) return null;
  return (await query(`SELECT d.id FROM donors d WHERE d.org_id=? AND d.deleted_at IS NOT NULL
                         ${days != null ? "AND d.deleted_at < NOW() - make_interval(days => ?)" : ""}
                         AND NOT EXISTS (SELECT 1 FROM donor_merges m WHERE m.org_id=d.org_id AND m.merged_id=d.id AND m.undone_at IS NULL)`,
    days != null ? [orgId, days] : [orgId])).map(r => r.id);
}
const trashSentence = (n, days) => n
  ? `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} deleted ${days != null && days !== "" ? `more than ${days} ${Number(days) === 1 ? "day" : "days"} ago` : "from Steward"} will be deleted for good. They will never match an import again, and this cannot be undone.`
  : "Nobody in the trash matches that.";
app.get("/donors/purge-trash/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const ids = await purgeableIds(req.user.orgId, req.query.olderThanDays);
  if (!ids) return res.status(400).json({ error: "bad_days", sentence: "Choose a number of days, or all." });
  res.json({ count: ids.length, sentence: trashSentence(ids.length, req.query.olderThanDays) });
}));
app.post("/donors/purge-trash", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  if (b.confirm !== "empty") return res.status(400).json({ error: "confirm_required", sentence: "Confirm emptying the trash first." });
  const ids = await purgeableIds(orgId, b.olderThanDays);
  if (!ids) return res.status(400).json({ error: "bad_days", sentence: "Choose a number of days, or all." });
  if (req.audit) req.audit.summary(`Emptied the trash: ${ids.length} ${ids.length === 1 ? "person" : "people"} deleted for good`, { count: ids.length, entityType: "donors" });
  if (!ids.length) return res.json({ purged: 0, children: {}, unlinked: {}, sentence: "The trash had nobody to delete." });
  const { MERGE_REFS, REF_SHAPE } = require("./dataHealth");
  const whereAny = (t, c) => { const w = (REF_SHAPE[`${t}.${c}`] || {}).where; return `${c} = ANY(?)${w ? ` AND ${w}` : ""}`; };
  const { purged, children, unlinked } = await withTransaction(async (client) => {
    const children = {}, unlinked = {};
    // 1. Rows that stay, unlinked.
    for (const [t, c] of MERGE_REFS) {
      if (!PURGE_KEEP_ROW.has(`${t}.${c}`)) continue;
      const r = await runTx(client, `UPDATE ${t} SET ${c}=NULL WHERE org_id=? AND ${whereAny(t, c)}`, [orgId, ids]);
      if (r.changes) unlinked[`${t}.${c}`] = r.changes;
    }
    // Another donor's pledge marked paid by one of these gifts stays a pledge.
    await runTx(client, `UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=? AND fulfilled_gift_id IN (SELECT id FROM gifts WHERE org_id=? AND donor_id = ANY(?))`, [orgId, orgId, ids]);
    // 2. Meetings: a meeting only these people were on goes; the rest drop them.
    const gone = await runTx(client, `DELETE FROM calendar_events WHERE org_id=? AND cardinality(person_ids) > 0 AND person_ids <@ ?::text[]`, [orgId, ids]);
    if (gone.changes) children.calendar_events = gone.changes;
    const left = await runTx(client,
      `UPDATE calendar_events SET person_ids = ARRAY(SELECT p FROM unnest(person_ids) WITH ORDINALITY u(p, n) WHERE p <> ALL(?::text[]) ORDER BY n)
        WHERE org_id=? AND person_ids && ?::text[]`, [ids, orgId, ids]);
    if (left.changes) unlinked["calendar_events.person_ids"] = left.changes;
    // 3. The person's own rows, FK-safe order.
    for (const t of PURGE_CHILD_TABLES) {
      const r = await runTx(client, `DELETE FROM ${t} WHERE org_id=? AND donor_id = ANY(?)`, [orgId, ids]);
      if (r.changes) children[t] = r.changes;
    }
    // 4. Every other pointer: a row that exists only because the person did.
    for (const [t, c] of MERGE_REFS) {
      const k = `${t}.${c}`;
      if (PURGE_KEEP_ROW.has(k) || (REF_SHAPE[k] || {}).array || (c === "donor_id" && PURGE_CHILD_TABLES.includes(t))) continue;
      const r = await runTx(client, `DELETE FROM ${t} WHERE org_id=? AND ${whereAny(t, c)}`, [orgId, ids]);
      if (r.changes) children[t] = (children[t] || 0) + r.changes;
    }
    // the trash's own copies go too, so no Undo or Recent change offers them back
    const tr = await runTx(client, "DELETE FROM deleted_records WHERE org_id=? AND table_name='donors' AND record_id = ANY(?)", [orgId, ids]);
    if (tr.changes) children.deleted_records = tr.changes;
    const d = await runTx(client, "DELETE FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, ids]);
    return { purged: d.changes, children, unlinked };
  });
  res.json({ purged, children, unlinked, sentence: `${purged.toLocaleString("en-US")} ${purged === 1 ? "person was" : "people were"} deleted for good.` });
}));

// ── Duplicate merge (BUILD-08 Phase C) ─────────────────────────────────────
// Staff-level (any staff member can clean duplicates — matches the everyday-
// hygiene bar of POST /note-reminders/:id/send, not the admin bar of purge),
// checkWriteAccess-gated (it's a data edit, and it soft-deletes — the DELETE-
// routes-ungated convention covers routes whose PURPOSE is deletion; this
// one's purpose is consolidation). Reference pattern: Givebutter Data
// Hygiene — merge into the chosen primary, keep the non-primary's data.
// One transaction: reassign every donor-scoped child, fill the primary's
// blank fields from the secondary, soft-delete the secondary, log a merge
// note as an interaction on the primary. Aggregates recalced after commit.
app.post("/donors/merge", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // CLEAN-1: the one merge is Data health's (routes/dataHealth.js): every
  // column in db.js that points at a person, the money footed to the cent, and
  // undo for 30 days. This older entry point keeps its request and response
  // shape and its rule (the primary's values win; its blanks fill from the
  // other record).
  const { primaryId, secondaryId } = req.body || {};
  const orgId = req.user.orgId;
  if (!primaryId || !secondaryId) return res.status(400).json({ error: "primaryId and secondaryId required" });
  if (primaryId === secondaryId) return res.status(400).json({ error: "Cannot merge a donor into itself" });
  const rows = await query("SELECT * FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [orgId, [primaryId, secondaryId]]);
  const primary = rows.find(d => d.id === primaryId), secondary = rows.find(d => d.id === secondaryId);
  if (!primary || !secondary) return res.status(404).json({ error: "Donor not found" });
  const DH = require("../dataHealth");
  const blank = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const choices = Object.fromEntries(DH.MERGE_FIELDS.map(([f]) => [f, blank(primary[f]) && !blank(secondary[f]) ? "other" : "kept"]));
  const addrBlank = blank(primary.address) && blank(primary.city) && blank(primary.zip);
  for (const f of DH.ADDRESS_GROUP) choices[f] = addrBlank ? "other" : "kept";
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  let out;
  try {
    out = await require("./dataHealth").mergePeople(orgId, primaryId, secondaryId,
      { choices, me: { id: req.user.userId, name: (u && u.name) || req.user.email || "" } });
  } catch (e) {
    if (e && e.sentence) return res.status(e.status || 409).json({ error: "merge_refused", sentence: e.sentence });
    throw e;
  }
  try { await markDonorsForGeocoding(orgId, { donorIds: [primaryId] }); }
  catch (e) { console.error("[geocode] mark after merge failed:", e.message); }
  const reassigned = Object.fromEntries(out.moved.map(m => [m.table, m.rows]));
  res.json({ merged: true, primaryId, secondaryId, reassigned, mergeId: out.mergeId });
}));

// ── Interactions ───────────────────────────────────────────────────────────
app.post("/donors/:id/interactions", requireAuth, wrap(async (req, res) => {
  const { type, note, date, metadata } = req.body;
  if (!type) return res.status(400).json({ error: "Interaction type required" });

  const donorExists = await query(
    "SELECT id FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const userName = userRow[0]?.name || "";
  const id = "int_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type, note || "",
     // FIX-14 Part 1 — no date means the ORG's today (this was the UTC day).
     /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : orgToday(await orgTz(req.user.orgId)), req.user.userId,   // ORG_TZ_SEAM_OK
     userName, metadata ? JSON.stringify(metadata) : null]
  );
  const rows = await query("SELECT * FROM interactions WHERE id = ?", [id]);
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  // LIVE-1 — a logged touch is a change to the person: the after-change step.
  await require("../afterChange").afterChange(req.user.orgId, [req.params.id], { door: "logged_touch", recalc: false });
  res.status(201).json(rows[0]);
}));
// A meeting from a connected calendar: its time and place belong to the
// calendar. Steward never edits the event; it says where to change it.
function calendarDayUrl(provider, date) {
  const d = String(date || "").slice(0, 10).replace(/-/g, "/");
  return provider === "outlook" || provider === "microsoft"
    ? `https://outlook.office.com/calendar/view/day/${d}`
    : `https://calendar.google.com/calendar/r/day/${d}`;
}
const parseMeta = m => { try { return (typeof m === "string" ? JSON.parse(m || "{}") : m) || {}; } catch { return {}; } };
const EDITABLE_TYPES = new Set(["meeting", "call", "email", "note", "visit", "event", "other", "letter", "text", "stewardship", "ask"]);

app.put("/interactions/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [row] = await query("SELECT * FROM interactions WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!row) return res.status(404).json({ error: "Interaction not found" });
  if (!(await mayEditLogged(req, row))) return res.status(403).json(NOT_YOURS);
  if (row.type === "gift" || row.gift_id) {
    return res.status(409).json({ error: "gift_entry", sentence: "A gift is changed on the gift itself, in Giving." });
  }
  const meta = parseMeta(row.metadata);
  const b = req.body || {};
  const sets = [], vals = [];
  const fromCalendar = !!meta.calendar_event_id;
  // SECURE-3: a sealed email is edited as she sees it (opened), and sealed again.
  const shown = SEALED_MAIL.openInteraction(row);
  if (shown.body_unreadable && b.note !== undefined) return res.status(409).json({ error: "sealed_unreadable", sentence: SEALED_MAIL.UNREADABLE });
  if (b.type !== undefined && b.type !== row.type) {
    if (fromCalendar) return res.status(409).json({ error: "calendar_owned", sentence: "This meeting came from a calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
    if (!EDITABLE_TYPES.has(String(b.type))) return res.status(400).json({ error: "Unknown conversation type" });
    sets.push("type=?"); vals.push(String(b.type));
  }
  if (b.date !== undefined && b.date !== row.date) {
    if (fromCalendar) return res.status(409).json({ error: "calendar_owned", sentence: "The time and place come from your calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    sets.push("date=?"); vals.push(b.date);
  }
  if (b.note !== undefined && String(b.note) !== String(shown.note || "")) {
    if (!String(b.note).trim()) return res.status(400).json({ error: "The note cannot be empty. Delete the entry instead." });
    if (row.body_sealed) {
      const cols = SEALED_MAIL.resealEdited(orgId, row.id, String(b.note).slice(0, 20000));
      sets.push("note=?", "body_sealed=?", "body_key_id=?"); vals.push(cols.note, cols.body_sealed, cols.body_key_id);
    } else { sets.push("note=?"); vals.push(String(b.note).slice(0, 20000)); }
  }
  if (b.donorId !== undefined && b.donorId !== row.donor_id) {
    if (!(await orgOwns("donors", b.donorId, orgId))) return res.status(404).json({ error: "Donor not found" });
    sets.push("donor_id=?"); vals.push(b.donorId);
  }
  if (b.metadata && typeof b.metadata === "object") {
    const next = { ...meta };
    for (const k of ["location", "attendees", "next_step"]) {
      if (b.metadata[k] === undefined) continue;
      if (fromCalendar && k === "location" && String(b.metadata[k] || "") !== String(meta.location || "")) {
        return res.status(409).json({ error: "calendar_owned", sentence: "The time and place come from your calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
      }
      next[k] = b.metadata[k] === "" ? null : String(b.metadata[k]).slice(0, 500);
    }
    if (JSON.stringify(next) !== JSON.stringify(meta)) { sets.push("metadata=?"); vals.push(JSON.stringify(next)); }
  }
  if (!sets.length) return res.json({ ...shown, unchanged: true });
  const [u] = await query("SELECT name FROM users WHERE id=?", [userId]);
  sets.push("edited_at=NOW()", "edited_by=?", "edited_by_name=?");
  vals.push(userId, u?.name || req.user.email || "");
  await run(`UPDATE interactions SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, [...vals, req.params.id, orgId]);
  // A calendar meeting's note lives on the meeting too: keep the two saying
  // the same thing (Steward's own part only; the event is never touched).
  if (fromCalendar && b.note !== undefined) {
    const title = String(row.note || "").split("\n\n")[0];
    const own = String(b.note).startsWith(title + "\n\n") ? String(b.note).slice(title.length + 2) : String(b.note);
    await run("UPDATE calendar_events SET note=?, updated_at=NOW() WHERE id=? AND org_id=?", [own || null, meta.calendar_event_id, orgId]).catch(() => {});
  }
  const [out] = await query("SELECT * FROM interactions WHERE id = ?", [req.params.id]);
  if (out.donor_id) calcWealthScore(out.donor_id, orgId).catch(e => console.error("score recalc:", e.message));
  res.json(SEALED_MAIL.openInteraction(out));
}));
const RESTORE_WITH = {
  interactions: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.calendar_event_ids) && x.calendar_event_ids.length) {
      await runTx(client, "UPDATE calendar_events SET interaction_id = ?, updated_at = NOW() WHERE id = ANY(?) AND org_id = ? AND interaction_id IS NULL",
        [recordId, x.calendar_event_ids, orgId]);
    }
  },
  pledges: async (client, x) => {
    if (x && Array.isArray(x.installments) && x.installments.length) {
      await runTx(client, "INSERT INTO pledge_installments SELECT * FROM jsonb_populate_recordset(NULL::pledge_installments, ?::jsonb)",
        [JSON.stringify(x.installments)]);
    }
  },
  campaigns: async (client, x) => {
    if (x && Array.isArray(x.recipients) && x.recipients.length) {
      await runTx(client, "INSERT INTO campaign_recipients SELECT * FROM jsonb_populate_recordset(NULL::campaign_recipients, ?::jsonb) ON CONFLICT DO NOTHING",
        [JSON.stringify(x.recipients)]);
    }
  },
  saved_dashboards: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.schedule_ids) && x.schedule_ids.length) {
      await runTx(client, "UPDATE board_pack_schedules SET dashboard_id = ? WHERE id = ANY(?) AND org_id = ? AND dashboard_id IS NULL",
        [recordId, x.schedule_ids, orgId]);
    }
  },
  // A member who joined another household since is left where they are.
  households: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.member_ids) && x.member_ids.length) {
      await runTx(client, "UPDATE donors SET household_id = ? WHERE id = ANY(?) AND org_id = ? AND household_id IS NULL",
        [recordId, x.member_ids, orgId]);
    }
  },
};
const TRASH_ENTITY = { interactions: "interaction", threads: "next step", tasks: "task", donor_relationships: "relationship",
  pledges: "pledge", opportunities: "proposal", households: "household",
  planned_gifts: "planned_gift", donor_materials: "material", impact_metrics: "impact_metric",
  event_attendees: "event_attendee", saved_dashboards: "saved_dashboard", campaigns: "campaign" };
// The audit row's picture of a record: a relationship carries its first
// person as donor_id (so that person's History finds it) and a household
// carries its members' ids, so "Removed X from the household" can be said.
async function auditShape(table, row, orgId) {
  if (!row) return row;
  if (table === "donor_relationships") return { ...row, donor_id: row.donor_id_a };
  if (table === "households") {
    const m = await query("SELECT id FROM donors WHERE household_id = ? AND org_id = ? ORDER BY id", [row.id, orgId]);
    return { ...row, member_ids: m.map(d => d.id) };
  }
  return row;
}

// DELETE /interactions/:id — remove a mis-logged touchpoint. Per convention,
// DELETE routes get no checkWriteAccess. Gmail-synced rows are deliberately
// deletable too: the message id is recorded in gmail_sync_exclusions first so
// syncGmail's dedup step doesn't re-insert the same message on its next pass.
// FIX-14 Part 2: only whoever logged it, or an admin; and the row is moved,
// not destroyed, so Undo can put it back.
app.delete("/interactions/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT id, metadata, created_by FROM interactions WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Interaction not found" });
  if (!(await mayEditLogged(req, rows[0]))) return res.status(403).json(NOT_YOURS);

  const meta = parseMeta(rows[0].metadata);
  if (meta?.gmail_message_id) {
    await run(
      "INSERT INTO gmail_sync_exclusions (id, org_id, gmail_message_id) VALUES (?,?,?) ON CONFLICT (org_id, gmail_message_id) DO NOTHING",
      ["gse_" + uuid().slice(0, 8), req.user.orgId, meta.gmail_message_id]
    );
  }

  const undoId = await trashRow("interactions", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Interaction not found" });
  res.json({ deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// HARDEN-1: THE UNDO OF A BULK DELETE IS ONE STEP, like the delete. The toast
// used to put people back ten requests at a time; a dropped network (or a
// closed tab) half way left some back and some not, and pressing Undo again
// hit "already back" on the first ten and stopped, so the rest could never
// come back from the toast. One transaction now: all of them, or none. A
// person already back counts as back, so a second press finishes the job.
app.post("/deleted-records/restore-people", requireAuth, wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
  if (!ids.length || ids.length > 100000) return res.status(400).json({ error: "ids array required" });
  const orgId = req.user.orgId;
  const rows = await query("SELECT id, record_id, restored_at, created_by FROM deleted_records WHERE org_id = ? AND table_name = 'donors' AND id = ANY(?)", [orgId, ids]);
  if (rows.length !== ids.length) return res.status(404).json({ error: "not_found", sentence: "Some of these are no longer in Recent changes. Nobody was put back." });
  if (rows.some(t => t.created_by !== req.user.userId) && !(await mayEditLogged(req, {}))) return res.status(403).json(NOT_YOURS);
  const waiting = rows.filter(t => !t.restored_at);
  await withTransaction(async client => {
    if (!waiting.length) return;
    // HARDEN-2: one door back for a person; it closes every open deletion record of theirs.
    await require("../personTrash").bringPeopleBack(orgId, waiting.map(t => t.record_id), { client });
    await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE org_id = ? AND id = ANY(?) AND restored_at IS NULL", [orgId, waiting.map(t => t.id)]);
  });
  if (req.audit) req.audit.entity("donor", waiting.length === 1 ? waiting[0].record_id : null);
  res.json({ restored: rows.length, newlyRestored: waiting.length, alreadyBack: rows.length - waiting.length });
}));

// UNDO. Puts the row back exactly as it was. Allowed to whoever deleted it,
// or an admin, and only once.
app.post("/deleted-records/:id/restore", requireAuth, wrap(async (req, res) => {
  const [t] = await query("SELECT * FROM deleted_records WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.restored_at) return res.status(409).json({ error: "already_restored", sentence: "That is already back." });
  if (t.created_by !== req.user.userId && !(await mayEditLogged(req, {}))) return res.status(403).json(NOT_YOURS);
  // A soft-deleted donor comes back by clearing deleted_at (FIX-22).
  if (t.table_name === "donors") {
    // HARDEN-2: one door back for a person; it closes every open deletion record of theirs.
    await withTransaction(async client => {
      await require("../personTrash").bringPeopleBack(req.user.orgId, [t.record_id], { client });
      await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE id = ? AND restored_at IS NULL", [t.id]);
    });
    const [d] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [t.record_id, req.user.orgId]);
    if (req.audit) { req.audit.entity("donor", t.record_id); req.audit.after(d || null); }
    return res.json({ restored: true, table: "donors", record: d || null });
  }
  if (!RESTORABLE.has(t.table_name)) return res.status(400).json({ error: "Cannot restore this" });
  try {
    await withTransaction(async client => {
      await runTx(client, `INSERT INTO ${t.table_name} SELECT * FROM jsonb_populate_record(NULL::${t.table_name}, ?::jsonb)`,
        [JSON.stringify(t.row_data)]);
      const data = typeof t.row_data === "string" ? JSON.parse(t.row_data) : t.row_data;
      if (RESTORE_WITH[t.table_name]) await RESTORE_WITH[t.table_name](client, data && data.__with, t.record_id, req.user.orgId);
      // FIX-45: any picture the row names comes back out of the retention window with it.
      const assetIds = [...new Set(JSON.stringify(data || {}).match(/pa_[a-f0-9]{24}/g) || [])];
      if (assetIds.length) await runTx(client, "UPDATE portal_assets SET deleted_at = NULL WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NOT NULL", [req.user.orgId, assetIds]);
      await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE id = ?", [t.id]);
    });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "conflict", sentence: "It could not come back, because something now stands in its place (an open next step, most likely)." });
    throw e;
  }
  const [row] = await query(`SELECT * FROM ${t.table_name} WHERE id = ? AND org_id = ?`, [t.record_id, req.user.orgId]);
  // The audit row is about the record that came back, not the trash row.
  if (req.audit) {
    req.audit.entity(TRASH_ENTITY[t.table_name], t.record_id);
    req.audit.after(row ? await auditShape(t.table_name, row, req.user.orgId) : null);
  }
  res.json({ restored: true, table: t.table_name, record: row || null });
}));

// THE PREVIOUS VERSIONS of one logged entry: its audit rows, newest first.
// Not admin-only, because "Edited" on a card has to open for whoever can see
// the card; it shows only rows about this one record, never the whole log.
app.get("/records/:id/history", requireAuth, wrap(async (req, res) => {
  // The record must be this organisation's (live, or waiting in the trash);
  // anything else is the same 404, so the route is no oracle for other orgs.
  const [own] = await query(
    `SELECT 1 FROM interactions WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM threads WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM tasks WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM pledges WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM opportunities WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM households WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM donor_relationships WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM deleted_records WHERE record_id = ? AND org_id = ? LIMIT 1`,
    [req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId,
     req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId]);
  if (!own) return res.status(404).json({ error: "Not found" });
  const rows = await auditMw.resolveAuditNames(await query(
    `SELECT id, created_at, user_id, user_name, actor_kind, action, entity_type, entity_id, entity_label, summary,
            record_count, request_method, request_path, changes, before_fields, after_fields
       FROM fin_audit_log WHERE org_id = ? AND entity_id = ? AND (status_code IS NULL OR status_code < 400)
      ORDER BY created_at DESC, id DESC LIMIT 100`, [req.user.orgId, req.params.id]), req.user.orgId);
  const out = await auditDescribe(rows, req.user.orgId);
  res.json({ timezone: await orgTzName(req.user.orgId), rows: out });
}));

app.post("/donors/:id/gifts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, pledgeId } = req.body;
  // Accept both spellings for back-compat: the touchpoint modal sends `fundId`,
  // the Add-Gift form sends `fund_id`. Same for the campaign reference.
  const fundId = req.body.fundId || req.body.fund_id || null;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  // FIX-11 Part 1 — and the payment method, in BOTH spellings, for the same
  // reason as the two above. This route read only `paymentMethod`, while the
  // gift form, the gift EDIT route and the bookkeeper export all speak
  // `payment_method` — so a gift typed with a method chosen was stored with
  // none, and came out of the export as one of the blank-method rows Part 3
  // is about. Found by walking the browser, not by any test of the route.
  const paymentMethodIn = req.body.paymentMethod || req.body.payment_method || null;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }

  const donorExists = await query(
    "SELECT id, stage FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });
  const preGiftStage = donorExists[0].stage;  // BUILD-22 auto-unlapse

  // Optional fund designation (the client's "Finance Fund" selector). Validated
  // org-scoped so a foreign fund id can't be pinned onto this gift's ledger row.
  // BUILD-21 Part 3: the gift carries its own fund and stamps the ledger ONCE
  // with it — replacing the old client behavior that logged the gift AND made a
  // second manual /finance/transactions call (the double-stamp bug).
  if (fundId && !(await orgOwns("fin_funds", fundId, req.user.orgId))) {
    return res.status(404).json({ error: "Fund not found" });
  }

  // BUILD-32 — real campaign attribution. `campaign_id` is the structured
  // reference a thermometer/roll-up reads (fundraisingCampaignRows matches
  // campaign_id OR the legacy free-text campaign name). Validated org-scoped so
  // a foreign campaign id can't be pinned on. Optional (a gift may be
  // unattributed). We also copy the campaign NAME into the legacy `campaign`
  // text column so name-based reports/exports stay consistent.
  let campaignName = campaign || "";
  let effectiveCampaignId = campaignId;

  // Optional: this gift is a payment against a specific pledge — the "gift
  // recorded against it" stop condition (see processPledgeReminders()).
  // Validated up front so a stale/foreign pledgeId 400s before any insert.
  //
  // BUILD-72 Part 3 — an ALREADY-FULFILLED pledge still accepts payments. The
  // old `status='open'` filter rejected them, which is one of the three ways a
  // donor's money could fail to land: a final payment arriving after the pledge
  // was completed by an earlier one is a real event, and the brief is explicit
  // that an overpayment is neither capped nor rejected. It becomes surplus.
  // A WRITTEN-OFF pledge is still refused: that is a deliberate human decision
  // and a payment against it should be recorded as a plain gift instead.
  let pledgeRow = null;
  if (pledgeId) {
    const pledgeRows = await query(
      "SELECT * FROM pledges WHERE id=? AND donor_id=? AND org_id=? AND status IN ('open','fulfilled')",
      [pledgeId, req.params.id, req.user.orgId]
    );
    if (!pledgeRows.length) return res.status(400).json({ error: "This pledge is not open for this donor." });
    pledgeRow = pledgeRows[0];
    // Attribution FIX — a payment against a campaign-attributed pledge
    // inherits the pledge's campaign automatically (an explicit campaignId on
    // the gift still wins). This is how a pledge converts from the campaign's
    // "pledged" figure into its "raised" figure as payments arrive — the
    // pledge itself is never summed into raised.
    if (!effectiveCampaignId && pledgeRow.campaign_id) effectiveCampaignId = pledgeRow.campaign_id;
  }

  if (effectiveCampaignId) {
    const camp = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE id=? AND org_id=?", [effectiveCampaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
    // NUMBERS-1 · a gift counts toward a campaign only inside its dates. A
    // campaign somebody chose is refused with the sentence; one inherited from
    // a pledge is simply not inherited, because nobody chose it.
    const refusal = normalizeGiftDate(date) ? NUM.campaignWindowRefusal(camp[0], normalizeGiftDate(date)) : null;
    if (refusal && campaignId) return res.status(400).json({ error: refusal, code: "campaign_window" });
    if (refusal) effectiveCampaignId = null;
    else campaignName = camp[0].name;
  }

  const giftId = "g_" + uuid().slice(0, 8);
  const giftDate = normalizeGiftDate(date);              // enforce ISO YYYY-MM-DD
  if (!giftDate) return res.status(400).json({ error: "A valid gift date (YYYY-MM-DD) is required, an unparseable date is an error, never today's date." });
  // BUILD-73 Part 2 — the money seam. The comment that used to sit here said
  // "INTEGER column", which stopped being true at the cover-fees migration and
  // is the likeliest reason the rounding outlived its justification.
  let amt;
  try { amt = toDollars(parseMoneyOrThrow(amount, "amount")); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  // §1.1 F-3 — client-generated idempotency key, enforced by uq_gifts_idem at
  // the DATABASE (not an app-layer check). A double-tapped Save, a replayed
  // request, or 50 parallel identical submits produce exactly one gift row;
  // every replay returns the original gift with duplicate:true and runs ZERO
  // side effects (no donor delta, no ledger stamp, no interaction, no
  // workflow fire, no pledge application).
  const idemKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 128) : null;

  // BUILD-98 Part 1 — soft credits, a tribute, an expected match. All checked
  // before the gift exists: a refused extra refuses the gift.
  let giftExtras = null;
  if (req.body.softCredits || req.body.tribute || req.body.match) {
    const ck = await checkGiftExtras(req.user.orgId, req.params.id, Math.round(amt * 100),
      { softCredits: req.body.softCredits, tribute: req.body.tribute, match: req.body.match });
    if (ck.notFound) return res.status(404).json({ error: "Donor not found" });
    if (ck.errors) return res.status(400).json({ error: ck.errors.join("; ") });
    giftExtras = ck.extras;
  }

  // BUILD-88a A.1 — THROUGH THE ONE FUNCTION. The insert, the donor rollup,
  // the ledger stamp and the timeline entry all lived here as four separate
  // statements, each with its own idea of a gift; they are recordGift's now.
  const written = await recordGift({
    orgId: req.user.orgId, donorId: req.params.id, giftId, amount: amt, date: giftDate,
    type: type || "cash", campaign: campaignName || "", campaignId: effectiveCampaignId || null,
    notes: notes || "", fundId: fundId || null, paymentMethod: paymentMethodIn,
    pledgeId: pledgeRow ? pledgeRow.id : null, idempotencyKey: idemKey, conflict: "idempotency",
    actorId: actor(req).id, actorName: actor(req).name, source: "gift_form",
    extras: giftExtras,
  });
  if (written.duplicate) {
    const dupGift = await query("SELECT * FROM gifts WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idemKey]);
    const dupDonor = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    return res.status(200).json({ gift: dupGift[0] || null, donor: dupDonor[0] || null, duplicate: true });
  }
  if (pledgeRow) {
    // §1.2 F-5 — apply the PAID amount against the pledge balance; a partial
    // payment leaves the pledge open with an honest remaining balance.
    await recalcPledgePayment(pledgeRow.id, req.user.orgId);
  }
  const giftRows  = [written.gift];
  const donorRows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  // BUILD-22 — a lapsed donor who just gave auto-moves out of Lapsed to Steward
  // (logged move + timeline entry, editable). No-op unless they were lapsed.
  await autoUnlapseOnGift(req.user.orgId, req.params.id, preGiftStage).catch(e => console.error("[smart-move] unlapse:", e.message));
  // BUILD-13 workflows — a manually-logged gift fires gift_received too (new-
  // donor + major-gift recipes). gift_count===1 after this insert means it was
  // the donor's first gift. Idempotent per giftId; fire-and-forget.
  fireWorkflows(req.user.orgId, "gift_received", {
    dedupKey: `gift:${giftId}`, donorId: req.params.id, giftId, amount: amt,
    isFirstGift: (donorRows[0]?.gift_count || 0) === 1, entityType: "gift", entityId: giftId,
  }).catch(e => console.error("[workflow] gift_received:", e.message));
  const fulfilledPledgeRows = pledgeRow ? await query(
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance,
            GREATEST(COALESCE(pp.paid,0) - p.amount, 0) AS surplus
     FROM pledges p
     LEFT JOIN ${require("../shared/numbers/pledges").PAID_BY_PLEDGE} pp
       ON pp.pledge_id = p.id
     WHERE p.id=?`, [req.user.orgId, pledgeRow.id]) : [];
  // BUILD-72 Part 3 — the response a payment returns says what the payment DID:
  // remaining balance, or the surplus if the donor overpaid.
  const fp = fulfilledPledgeRows[0] || null;
  const fpOut = fp ? (() => {
    const paid = round2(parseFloat(fp.paid_amount) || 0);
    const amount = round2(parseFloat(fp.amount) || 0);
    const surplus = round2(parseFloat(fp.surplus) || 0);
    return { ...fp, paid, balance: round2(parseFloat(fp.balance) || 0), surplus, overpaid: surplus > 0,
             displayStatus: pledgeDisplayStatus(paid, amount, fp.status) };
  })() : null;
  // BUILD-81 — a live gift is a touch: it opens a thread whose next step is
  // "Thank" (+2 days) unless the donor already has one open. Fire-and-forget
  // beside the response like the score recalc — the gift itself never waits.
  openGiftThread(req.user.orgId, req.params.id, {
    giftId: giftRows[0]?.id, actorId: req.user.userId, actorName: actor(req).name,
  }).catch(() => {});
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0], pledge: fpOut });
}));

app.put("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, fund_id, payment_method, acknowledgement_sent } = req.body;
  const campaignId = req.body.campaignId !== undefined ? req.body.campaignId
                   : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  // §1 tenant isolation: a foreign fund id must not be pinned onto this gift
  // (it would surface another org's fund name in fund-affinity/reports JOINs).
  if (!(await orgOwns("fin_funds", fund_id, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
  const g = existing[0];
  // BUILD-32 — campaign attribution editable. A non-null campaignId is validated
  // org-scoped; passing "" / null explicitly clears attribution. Undefined leaves
  // the existing value untouched. When set, the legacy name column is kept in sync.
  let newCampaignId = g.campaign_id, newCampaign = campaign !== undefined ? campaign : g.campaign;
  if (campaignId !== undefined) {
    if (campaignId) {
      const camp = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      // NUMBERS-1 · choosing a campaign for a gift dated outside it is refused
      // with the sentence. A date edit alone keeps the attribution, and the
      // gift then counts toward nothing (campaignMatch.js).
      const refusal = NUM.campaignWindowRefusal(camp[0], (date && normalizeGiftDate(date)) || g.date);
      if (refusal) return res.status(400).json({ error: refusal, code: "campaign_window" });
      newCampaignId = camp[0].id; newCampaign = camp[0].name;
    } else {
      // BUILD-43 (state-diff harness finding): an explicit clear must clear
      // the legacy NAME column too — the read side matches `campaign_id OR
      // campaign=name`, so leaving the synced name behind kept the gift
      // attributed forever and made clearing impossible. A caller that
      // deliberately sends a free-text `campaign` name alongside keeps it.
      newCampaignId = null;
      if (campaign === undefined) newCampaign = null;
    }
  }
  // BUILD-73 Part 2 — THIS is the path the audit was written for: it rounds any
  // gift, including one carrying a stripe_payment_id, so a $33.33 online gift
  // whose campaign was corrected in the UI came back out as $33.
  let newAmt = g.amount;
  if (amount !== undefined) {
    try { newAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }
  const newDate = date ? normalizeGiftDate(date) : g.date;                       // enforce ISO
  if (date && !newDate) return res.status(400).json({ error: "A valid gift date (YYYY-MM-DD) is required, an unparseable date is an error, never today's date." });
  // BUILD-27 concurrency (concurrency2 "torn write" fix): serialize this gift's
  // edit → donor-recalc → ledger-stamp trio under a per-gift advisory lock, the
  // same primitive the import/webhook-donor dedup paths use. recalcDonorSummary
  // is a read-modify-write (SELECT SUM → UPDATE donors) and the ledger UPDATE is
  // a bare write, so two simultaneous edits to the SAME gift could interleave
  // into gift=900 / donor=900 / ledger=700 (the three writes torn apart). With
  // the lock the last writer wins all three, so donor total AND the ledger stamp
  // always equal the winning gift amount. NB a single user's double-tapped Save
  // is safe without this (both requests carry the same amount → they converge);
  // the torn state needs two DIFFERENT target amounts, i.e. two concurrent
  // editors — a P1 coherence race, not P0 single-user corruption.
  const rows = await withAdvisoryLock(`gift:${req.params.id}`, async () => {
    await run(
      `UPDATE gifts SET amount=?,date=?,type=?,campaign=?,campaign_id=?,notes=?,fund_id=?,payment_method=?,acknowledgement_sent=?,
              acknowledgement_sent_at = CASE WHEN ? IS TRUE THEN COALESCE(acknowledgement_sent_at, NOW()) ELSE NULL END
        WHERE id=? AND org_id=?`,
      [newAmt, newDate, type||g.type, newCampaign, newCampaignId,
       notes!==undefined?notes:g.notes, fund_id!==undefined?fund_id:g.fund_id,
       payment_method!==undefined?payment_method:g.payment_method,
       acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,
       acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,   // A.5 — the same value drives the stamp
       req.params.id, req.user.orgId]
    );
    // NUMBERS-1: a soft credit follows the gift's new amount.
    for (const sql of require("../donorSummary").SOFT_CREDIT_RESIZE) await run(sql, [req.params.id, req.user.orgId]);
    // Full recalc replaces the old delta — delta was wrong when editing a non-latest gift's amount
    await recalcDonorSummary(g.donor_id, req.user.orgId);
    // BUILD-43 (state-diff harness finding): the gift's LEDGER STAMP must move
    // with it. Editing a stamped gift's amount/date left fin_transactions at the
    // old figures — Cash on Hand permanently disagreed with the gift record and
    // (unlike receipts) no mismatch queue ever surfaced it. Same sync the
    // partial-refund webhook already does by hand; fund follows when provided.
    await run(
      `UPDATE fin_transactions SET amount=?, date=?, fund_id=COALESCE(?, fund_id)
        WHERE gift_id=? AND org_id=?`,
      // NUMBERS-2: a fund cleared on the gift moves its ledger stamp to the
      // general fund, where recordGift puts a gift with no fund (the old
      // COALESCE kept the money in the fund that was cleared).
      [newAmt, newDate, fund_id !== undefined ? (fund_id || (await ensureOrgLedger(req.user.orgId, { heal: true })).genFundId) : null, req.params.id, req.user.orgId]
    );
    // F-5: an amount edit on a pledge-linked payment changes the pledge's paid
    // total — recompute (may fulfill, may reopen; canceled never resurrected).
    if (g.pledge_id) await recalcPledgePayment(g.pledge_id, req.user.orgId);
    return query("SELECT * FROM gifts WHERE id=?", [req.params.id]);
  });
  res.json(rows[0]);
}));

app.delete("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  const g = existing[0];
  // SECURE-1: a gift is money. The person who entered it may take it back, and
  // so may an admin; nobody else (the pledge delete below already worked so).
  if (!(await mayEditLogged(req, g))) return res.status(403).json(NOT_YOURS);

  // A receipt is a legal artifact — a gift with an ACTIVE receipt can't be
  // silently deleted out from under it (was an unhandled FK violation).
  // Void the receipt first (POST /receipts/:id/void), then delete.
  const activeReceipts = await query(
    "SELECT receipt_number FROM receipts WHERE gift_id=? AND org_id=? AND type='gift' AND voided_at IS NULL",
    [req.params.id, req.user.orgId]
  );
  if (activeReceipts.length) {
    return res.status(409).json({
      error: "receipt_active",
      message: `This gift has an issued tax receipt (#${activeReceipts[0].receipt_number}). Void the receipt first, then delete the gift.`,
    });
  }

  // FIX-10 Part C — how many of this gift's own tasks the delete voided, so the
  // timeline note can say it. Declared above the block that assigns it.
  let voidedTaskCount = 0;
  // BUILD-27 concurrency: serialize the whole delete → donor-recalc under the
  // SAME per-gift advisory lock PUT /gifts/:id takes, so a concurrent edit and
  // delete of the SAME gift can't tear the donor total apart from the ledger.
  await withAdvisoryLock(`gift:${req.params.id}`, async () => {
  await withTransaction(async (client) => {
    // Voided receipts keep their frozen `snapshot`/`pdf_data` record — just
    // detach the gift reference so the FK doesn't block deletion (same
    // tolerated-dangling pattern as gifts.giving_page_id, except here the FK
    // is real so it must be NULLed, not left dangling).
    await runTx(client, "UPDATE receipts SET gift_id=NULL WHERE gift_id=? AND org_id=?", [req.params.id, req.user.orgId]);
    // Clear the fulfilled_gift_id FK before the gift row goes (F-5: whether
    // the pledge actually reopens is decided AFTER the delete by
    // recalcPledgePayment — remaining payments may still cover it).
    await runTx(client,
      `UPDATE pledges SET fulfilled_gift_id=NULL, updated_at=NOW()
       WHERE fulfilled_gift_id=? AND org_id=?`,
      [req.params.id, req.user.orgId]);
    // BUILD-33: the gift's own ledger stamp goes with it. "Every gift stamps
    // fin_transactions exactly once" (uq_fin_txns_gift) — zero gifts, zero
    // stamps; leaving the row would inflate Cash on Hand with money from a
    // gift that no longer exists anywhere. Manual/expense rows (gift_id NULL)
    // are untouched.
    await runTx(client, "DELETE FROM fin_transactions WHERE gift_id=? AND org_id=?", [req.params.id, req.user.orgId]);
    // ── FIX-10 Part C · RECORDS STAY CLEAN ──────────────────────────────────
    // A gift's arrival creates tasks ("Thank Ruth, $500 just came in", the
    // stewardship alert). Deleting the gift used to leave them standing,
    // pointing at money that no longer exists anywhere, and a director had no
    // way to tell them from a task she had typed herself. They are VOIDED
    // here: off every list, still a row, with the reason on it.
    //
    // The predicate is source_gift_id, never the donor and never the title.
    // That is what makes "tasks a person wrote by hand are never touched" true
    // by construction rather than by luck: a hand-written task has no
    // source_gift_id, so this UPDATE cannot reach it.
    //
    // Inside the SAME transaction as the gift row's delete: a void that
    // committed without the delete would cancel a thank-you for a gift that
    // still exists.
    // FIX-31: the next step the gift opened (its thank-you) is dismissed with
    // it, so its task is closed and voided below with the gift's others.
    await runTx(client,
      "UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='gift_deleted' WHERE org_id=? AND opening_gift_id=? AND closed_at IS NULL",
      [req.user.orgId, req.params.id]);
    const voided = await runTx(client,
      "UPDATE tasks SET voided_at=NOW(), voided_reason='gift_deleted', updated_at=NOW() WHERE org_id=? AND source_gift_id=? AND voided_at IS NULL",
      [req.user.orgId, req.params.id]);
    voidedTaskCount = Number(voided?.changes ?? voided?.rowCount ?? 0) || 0;
    await runTx(client, "DELETE FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  });
  // Full recalc: old delta left last_gift_date and last_gift_amount stale when deleting the most recent gift
  await recalcDonorSummary(g.donor_id, req.user.orgId);
  // F-5: this gift may have been paying down a pledge — recompute honestly
  // (reopens only if remaining payments no longer cover the pledge amount).
  if (g.pledge_id) await recalcPledgePayment(g.pledge_id, req.user.orgId);
  }); // end withAdvisoryLock(gift:…) — delete + recalc serialized per gift
  // FIX-10 Part C — the timeline says what happened, in one line, on the
  // donor's own record. A task that vanishes without a trace is how a director
  // comes to believe she already thanked someone she never thanked. Written
  // after the transaction commits, so the note can never describe a void that
  // rolled back.
  if (voidedTaskCount > 0 && g.donor_id) {
    const _a = actor(req);
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,'note',?,?,?,?)",
      ["i_" + uuid().slice(0, 8), req.user.orgId, g.donor_id,
       `Gift removed, thank-you cancelled. ${voidedTaskCount === 1 ? "One task" : `${voidedTaskCount} tasks`} Steward had created for this gift ${voidedTaskCount === 1 ? "was" : "were"} voided.`,
       orgToday(await orgTz(req.user.orgId)), _a.id, _a.name]
    ).catch(e => console.error("[gift-delete] timeline note:", e.message));
  }
  res.json({ ok: true, voidedTasks: voidedTaskCount });
}));

// ── Pledges ──────────────────────────────────────────────────────────────
// A donor's promise to give $X by a future date — separate from `gifts`
// (money already received) and `planned_gifts` (bequests/trusts, no due
// date). See db.js's pledges comment. The reminder cadence that fires
// against these (processPledgeReminders, below) deliberately mirrors the
// recurring-gift dunning engine's architecture.
app.get("/donors/:id/pledges", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  // F-5: every pledge read carries the honest paid/balance figures, derived
  // live from linked payment gifts — never a stored counter.
  // BUILD-72 Part 3 adds the SURPLUS on an overpaid pledge and the DERIVED
  // display status (open / partially_fulfilled / fulfilled), so no surface has
  // to re-derive either and get it subtly different.
  const rows = await query(
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance,
            GREATEST(COALESCE(pp.paid,0) - p.amount, 0) AS surplus
     FROM pledges p
     LEFT JOIN ${require("../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id=p.id
     WHERE p.donor_id=? AND p.org_id=? ORDER BY p.due_date ASC`,
    [req.user.orgId, req.params.id, req.user.orgId]
  );
  // FIX-55: a pledge over several years says this year's installments and the
  // open total, so the profile never shows one number without saying which
  // FUNDRAISING-2: "this year" is the fiscal year, to the day Home and
  // Fundraising's Pledges count to (numbers.pledgeSummary).
  const yearEnd = orgTime.orgPeriodBounds(await orgForYears(req.user.orgId), "fiscal_year", 0).end;   // ORG_TZ_SEAM_OK
  const inst = rows.length ? await query(
    `SELECT pledge_id, COUNT(*)::int AS n, MIN(LEFT(due_date,4)) AS y0, MAX(LEFT(due_date,4)) AS y1,
            COALESCE(SUM(amount) FILTER (WHERE paid_gift_id IS NULL AND due_date <= ?),0) AS due_this_year
       FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?) GROUP BY pledge_id`, [yearEnd, req.user.orgId, rows.map(r => r.id)]) : [];
  const instBy = new Map(inst.map(x => [x.pledge_id, x]));
  // IMPORT-5: each installment with its state, for the open pledge up top
  const instRows = rows.length ? await query(
    `SELECT pledge_id, seq, due_date, amount, paid_gift_id FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?) ORDER BY pledge_id, seq`,
    [req.user.orgId, rows.map(r => r.id)]) : [];
  const listBy = new Map();
  for (const i of instRows) (listBy.get(i.pledge_id) || listBy.set(i.pledge_id, []).get(i.pledge_id))
    .push({ seq: i.seq, dueDate: i.due_date ? String(i.due_date).slice(0, 10) : null, amount: round2(parseFloat(i.amount) || 0), paid: !!i.paid_gift_id });
  res.json(rows.map(r => {
    const paid = round2(parseFloat(r.paid_amount) || 0);
    const amount = round2(parseFloat(r.amount) || 0);
    const surplus = round2(parseFloat(r.surplus) || 0);
    const balance = round2(parseFloat(r.balance) || 0);
    const ix = instBy.get(r.id);
    const years = ix ? Number(ix.y1) - Number(ix.y0) + 1 : 1;
    const dueThisYear = r.status !== "open" ? 0 : ix ? Math.min(balance, round2(parseFloat(ix.due_this_year) || 0))
      : (String(r.due_date || "").slice(0, 10) <= yearEnd ? balance : 0);
    return {
      ...r,
      paid, balance,
      surplus, overpaid: surplus > 0,
      displayStatus: pledgeDisplayStatus(paid, amount, r.status),
      installmentCount: ix ? ix.n : 1, years, dueThisYear,
      installments: listBy.get(r.id) || [],
      // the open-pledge figure opens Fundraising's own rows for this person
      openSource: { key: "pledges-open", params: { donor: r.donor_id } },
    };
  }));
}));

app.post("/donors/:id/pledges", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, dueDate, notes } = req.body;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  // BUILD-88b B.2 — THE GUARD READS THE MONEY SEAM, not `Number()`. A pledge
  // typed as "1,000.00" — which is how a person writes a thousand pounds — was
  // refused as "A positive amount is required", because Number("1,000.00") is
  // NaN and the guard ran BEFORE the seam that knows better. Found by this
  // part's own suite on its first run.
  if (amount === undefined || amount === null || String(amount).trim() === "") {
    return res.status(400).json({ error: "A positive amount is required" });
  }
  { let probe; try { probe = parseMoneyOrThrow(amount, "amount"); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (probe <= 0) return res.status(400).json({ error: "A positive amount is required" }); }
  if (!dueDate) return res.status(400).json({ error: "A due date is required" });

  const donorExists = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  // Attribution FIX — a pledge attributes at pledge time (capital campaigns
  // are mostly pledges). Org-scoped: a foreign campaign id 404s, no row
  // planted. The campaign's "pledged" figure shows this while open; payments
  // against it inherit the campaign and count toward raised as they arrive.
  if (campaignId) {
    const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
  }

  // BUILD-72 Part 2 — idempotency, same seam as gifts. The client mints a key
  // when the pledge form opens and rotates it only on a successful save, so a
  // double-tapped Save (or a browser retry on hotel wifi in front of a
  // prospect) replays the SAME key and gets the SAME pledge back — 200, not a
  // second row and not an error. The DB unique is the fix; a disabled button is
  // cosmetic and does not survive a flaky connection.
  const idemKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 128) : null;

  // BUILD-73 Part 2 — the money seam; was Math.round(Number(amount)) inline in
  // the parameter list, where a bad value became NaN and a cents value became
  // a whole dollar with nothing said about either.
  let pledgeAmt;
  try { pledgeAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  // SWEEP-4 / FIX-60: the pledge and its installments are written by the one
  // writer (pledgeWrite.js). A schedule that does not sum to the pledge is
  // refused BEFORE the pledge is written. An explicit schedule is honoured; a
  // stated cadence (frequency + count) generates one, the remainder on the
  // first installment so it SUMS to the pledge; neither is one installment of
  // the whole on its due date.
  const id = "pl_" + uuid().slice(0, 8);
  let wrote;
  try {
    wrote = await PW.writePledge({ id, orgId: req.user.orgId, donorId: req.params.id, amountCents: parseMoneyOrThrow(pledgeAmt, "amount"),
      dueDate, notes: notes || "", campaignId, idempotencyKey: idemKey, createdBy: actor(req).id, createdByName: actor(req).name,
      plan: { schedule: req.body.installments, frequency: req.body.frequency, count: req.body.installmentCount, firstDue: dueDate } },
      { door: "pledge" });
  } catch (e) {
    if (e.code === "schedule_does_not_sum") return res.status(400).json({ error: e.message, code: e.code });
    throw e;
  }
  if (!wrote.created && idemKey) {
    // A replay. Return the ORIGINAL pledge with 200 — never a second row, and
    // never an error the user has to interpret mid-demo.
    const dup = await query("SELECT * FROM pledges WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idemKey]);
    if (dup.length) return res.status(200).json({ ...dup[0], duplicate: true });
  }

  // WIRE-1: the promise is on the person's timeline the day it is made.
  { const who = await staffWho(req);
    await TL.timelineLine({ orgId: req.user.orgId, donorId: req.params.id,
      note: `Pledged ${TL.lineMoney(pledgeAmt)}${dueDate ? `, due ${String(dueDate).slice(0, 10)}` : ""}.`,
      actorId: who.id, actorName: who.name, key: `pledge_created:${id}`, metadata: { via: "pledge", pledge_id: id } }); }

  const rows = await query("SELECT * FROM pledges WHERE id=?", [id]);
  const insts = await query("SELECT id, seq, due_date, amount::float AS amount FROM pledge_installments WHERE pledge_id=? ORDER BY seq", [id]);
  res.status(201).json({ ...rows[0], installments: insts });
}));

// A pledge's schedule, REWRITTEN: a schedule edit and the shell-pledge repair
// in B.2. A new pledge is written with its schedule by pledgeWrite.js (FIX-60);
// both plan through the same planner, so "what a schedule is" is decided
// once. Never rewrites an instalment that has already been PAID: a payment is
// a fact and a new schedule is a plan.
async function writePledgeInstallments(orgId, pledgeId, opts) {
  const rows = await PW.planInstallments(opts);
  if (!rows.length) return { installments: 0 };
  const { frequency } = opts;
  const paid = await query("SELECT seq FROM pledge_installments WHERE pledge_id=? AND paid_gift_id IS NOT NULL", [pledgeId]);
  const paidSeqs = new Set(paid.map(p => p.seq));
  await run("DELETE FROM pledge_installments WHERE org_id=? AND pledge_id=? AND paid_gift_id IS NULL", [orgId, pledgeId]);
  for (const r of rows) {
    if (paidSeqs.has(r.seq)) continue;
    await run(
      `INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount)
       VALUES (?,?,?,?,?,?) ON CONFLICT (pledge_id, seq) DO NOTHING`,
      ["pli_" + uuid().slice(0, 10), orgId, pledgeId, r.seq, r.dueDate, money.toDollars(r.amountCents)]);
  }
  await run("UPDATE pledges SET frequency=COALESCE(?,frequency), installment_count=? WHERE id=? AND org_id=?",
    [frequency || null, rows.length, pledgeId, orgId]);
  return { installments: rows.length };
}
// GET /pledges/:id/installments — the schedule, with what has paid each one.
app.get("/pledges/:id/installments", requireAuth, wrap(async (req, res) => {
  const [p] = await query("SELECT id, amount::float AS amount, status, is_shell FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Pledge not found" });
  const rows = await query(
    `SELECT i.id, i.seq, i.due_date, i.amount::float AS amount, i.paid_gift_id, i.paid_at,
            g.date AS paid_date, g.amount::float AS paid_amount
       FROM pledge_installments i LEFT JOIN gifts g ON g.id = i.paid_gift_id
      WHERE i.pledge_id=? AND i.org_id=? ORDER BY i.seq`, [req.params.id, req.user.orgId]);
  res.json({ pledge: p, installments: rows,
             // A pledge with no schedule is not late — it is unfinished, and it
             // says which part is missing rather than chasing a donor for a
             // number nobody wrote down.
             needsSchedule: rows.length === 0 });
}));

// PUT /pledges/:id/installments — set or regenerate the schedule.
app.put("/pledges/:id/installments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [p] = await query("SELECT id, amount FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Pledge not found" });
  // A schedule EDIT says what the schedule is; the one-installment default is
  // for a pledge being made, not for an edit that said nothing.
  if (!(Array.isArray(req.body.installments) && req.body.installments.length) && !(req.body.frequency && req.body.installmentCount))
    return res.status(400).json({ error: "no_schedule", message: "Give a schedule, or a frequency and a number of installments." });
  try {
    const out = await writePledgeInstallments(req.user.orgId, req.params.id, {
      amountCents: money.toCents(p.amount) ?? 0,
      schedule: req.body.installments, frequency: req.body.frequency,
      count: req.body.installmentCount, firstDue: req.body.firstDue,
    });
    if (!out.installments) return res.status(400).json({ error: "no_schedule", message: "Give a schedule, or a frequency and a number of installments." });
    // A pledge that now has a schedule is no longer a shell.
    await run("UPDATE pledges SET is_shell=false WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  } catch (e) {
    if (e.code === "schedule_does_not_sum") return res.status(400).json({ error: e.code, message: e.message });
    throw e;
  }
  const rows = await query("SELECT id, seq, due_date, amount::float AS amount, paid_gift_id FROM pledge_installments WHERE pledge_id=? ORDER BY seq", [req.params.id]);
  res.json({ installments: rows });
}));

app.put("/pledges/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Pledge not found" });
  const p = existing[0];
  // FIX-14 Part 2b: whoever recorded the pledge, or an admin.
  if (!(await mayEditLogged(req, p))) return res.status(403).json(NOT_YOURS);
  const { amount, dueDate, notes, status } = req.body;
  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  const campaignIdRaw = req.body.campaignId !== undefined ? req.body.campaignId
    : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  let newCampaignId = p.campaign_id;
  if (campaignIdRaw !== undefined) {
    if (campaignIdRaw) {
      const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignIdRaw, req.user.orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      newCampaignId = campaignIdRaw;
    } else {
      newCampaignId = null;
    }
  }

  // BUILD-72 Part 3 — the two drift vectors this route used to carry are closed.
  //
  //  (1) Changing `amount` did NOT recompute the status, so raising a fulfilled
  //      $1,000 pledge to $5,000 left it reading "fulfilled" with $3,300
  //      outstanding.
  //  (2) `status` was directly settable, so a pledge with $0 paid could be
  //      stored as 'fulfilled' — an independent flag drifting from the money.
  //
  // Now: `written_off` is the ONLY status a human sets, because it is the only
  // one that is a decision rather than a fact. open/fulfilled are FACTS about
  // the payment total and are always derived by recalcPledgePayment() below.
  const HUMAN_SETTABLE = ["written_off", "open"];   // 'open' = un-write-off
  let newStatus = p.status;
  if (status && HUMAN_SETTABLE.includes(status)) newStatus = status;
  else if (status === "fulfilled") {
    // Refused deliberately: a pledge becomes fulfilled by being PAID. Marking
    // it fulfilled by hand is what let the flag drift from the money.
    return res.status(400).json({
      error: "status_derived",
      message: "A pledge is fulfilled by its payments, not by hand. Record the payment against it, or write it off.",
    });
  }
  const stopping = newStatus !== "open" && p.status === "open";

  // BUILD-73 Part 2 — the money seam; was Math.round(Number(amount)).
  let pledgeNewAmt = p.amount;
  if (amount !== undefined) {
    try { pledgeNewAmt = toDollars(parseMoneyOrThrow(amount, "amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }

  await run(
    `UPDATE pledges SET amount=?, due_date=?, notes=?, status=?, campaign_id=?,
       next_reminder_at = CASE WHEN ? THEN NULL ELSE next_reminder_at END,
       updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [
      pledgeNewAmt,
      dueDate || p.due_date,
      notes !== undefined ? notes : p.notes,
      newStatus,
      newCampaignId,
      stopping,
      req.params.id, req.user.orgId,
    ]
  );
  // FIX-14 Part 2b — "Edited by, when", only when something a person typed moved.
  if (!auditTrailMod.sameValue(p.amount, pledgeNewAmt) || !auditTrailMod.sameValue(p.due_date, dueDate || p.due_date)
      || (notes !== undefined && !auditTrailMod.sameValue(p.notes, notes)) || newStatus !== p.status || newCampaignId !== p.campaign_id) {
    await run("UPDATE pledges SET edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?",
      [...(await editStamp(req)), req.params.id, req.user.orgId]);
  }
  // ALWAYS recompute against the payment total — this is what closes drift (1).
  // A changed amount, or a write-off being lifted, re-derives open/fulfilled and
  // the surplus from the gifts actually linked to this pledge.
  const recomputed = await recalcPledgePayment(req.params.id, req.user.orgId);
  const rows = await query("SELECT * FROM pledges WHERE id=?", [req.params.id]);
  res.json({ ...rows[0], ...(recomputed || {}) });
}));

// FIX-14 Part 2b — a pledge with money applied to it is not deleted: the
// payments would point at nothing and the balance would lie. Write it off
// instead. One with no payments is moved to the trash, so Undo can bring it
// back with its instalments, exactly as it was.
app.delete("/pledges/:id", requireAuth, wrap(async (req, res) => {
  const [p] = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!p) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  if (!(await mayEditLogged(req, p))) return res.status(403).json(NOT_YOURS);
  const [paid] = await query(
    `SELECT (SELECT COUNT(*)::int FROM gifts WHERE pledge_id=? AND org_id=?)
          + (SELECT COUNT(*)::int FROM pledge_installments WHERE pledge_id=? AND org_id=? AND paid_gift_id IS NOT NULL) AS n`,
    [req.params.id, req.user.orgId, req.params.id, req.user.orgId]);
  if (paid && paid.n > 0) {
    return res.status(409).json({ error: "pledge_has_payments",
      sentence: "This pledge has payments applied to it, so it cannot be deleted. Write it off instead." });
  }
  const undoId = await trashRow("pledges", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

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

// Re-sends the exact already-issued PDF (never regenerates) — used by
// POST /gifts/:id/receipt?resend and POST /donors/:id/receipts (manual
// resend from DonorProfile), so a resend is always byte-identical to what
// was originally issued.
// SEND-GATE-1: a resend is a person's click, the confirm for this one receipt.
async function resendReceiptEmail(receipt, org, donor, by) {
  if (!donor.email) return false;
  const decision = await donorMailDecision("receipt", donor.email, org.id);
  if (!decision.send) return false;
  const pdfBuffer = Buffer.from(receipt.pdf_data, "base64");
  const filename = receipt.type === "year_end" ? `${receipt.tax_year}-giving-statement.pdf` : `receipt-${receipt.receipt_number}.pdf`;
  const extra = by ? { _stewardConfirm: await SEND_GATE.recordStaffConfirm({ orgId: org.id, to: donor.email, what: "Receipt", by }) } : {};
  const sent = await sendReceiptEmail(org, donor, receipt.snapshot, pdfBuffer, filename, extra);
  if (sent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, receipt.id]);
  return sent;
}

// Aggregates a donor's calendar-year gifts into one consolidated statement.
// Supersedes (voids) any prior active statement for the same donor+year
// before inserting the new one, since the partial-unique index only allows
// one active statement per (org_id, donor_id, tax_year).
async function issueYearEndStatement(org, donor, year, { send = true, by = SYS_AUTO } = {}) {
  const gifts = await query(
    `SELECT * FROM gifts WHERE org_id=? AND donor_id=? AND (is_sample IS NOT TRUE)
       AND date >= ? AND date <= ? ORDER BY date ASC`,
    [org.id, donor.id, `${year}-01-01`, `${year}-12-31`]
  );
  if (!gifts.length) return { skipped: "no_gifts" };

  await run(
    `UPDATE receipts SET voided_at=NOW(), void_reason='Superseded by a newly generated statement'
     WHERE org_id=? AND donor_id=? AND tax_year=? AND type='year_end' AND voided_at IS NULL`,
    [org.id, donor.id, year]
  );

  // COMMS-2 — the money is statementTotals.js's, in cents: deductible never
  // above what was given (a partial refund), a lost dispute off the statement.
  const ST = require("../statementTotals").statementLines(gifts, { year: true });
  const lineItems = ST.lines.map(l => ({
    date: l.date ? orgTime.formatCivil(l.date) : "", // civil date formatted from its own Y/M/D — never round-tripped through new Date()
    amount: toDollars(l.amountCents),
    deductibleAmount: toDollars(l.deductibleCents),
    paymentMethod: l.paymentMethod,
  }));
  const totalAmount = ST.totalAmount;
  const totalDeductible = ST.totalDeductible;
  // COMMS-2 §3 — "your year with us": hours given and events attended that
  // year, unless the org turned the section off. Facts, not money: nothing in
  // it touches a total.
  let yourYear = null;
  if (org.statement_your_year !== false) {
    const [h] = await query(`SELECT COALESCE(SUM(ROUND(hours * 100)), 0)::int AS hh, COUNT(*)::int AS n FROM volunteer_shifts
                               WHERE org_id=? AND person_id=? AND LEFT(date, 4) = ?`, [org.id, donor.id, String(year)]);
    const evs = await query(`SELECT e.name, e.date::text AS date FROM event_attendees a JOIN events e ON e.id = a.event_id
                               WHERE a.org_id=? AND a.donor_id=? AND (a.status='attended' OR a.checked_in_at IS NOT NULL)
                                 AND EXTRACT(YEAR FROM e.date) = ? ORDER BY e.date`, [org.id, donor.id, year]);
    const hours = (h && h.hh) ? h.hh / 100 : 0;
    if (hours > 0 || evs.length) yourYear = { volunteerHours: hours, shifts: h ? h.n : 0, events: evs.map(e => e.name) };
  }

  const receiptNumber = await allocateReceiptNumber(org.id);
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null); // BUILD-64: shared resolver, frozen at issue
  const snapshot = {
    type: "year_end",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,      // BUILD-64: portal primary, never Steward green
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),      // BUILD-65: from object storage, not base64-only
    orgEin: org.ein || "",
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    taxLanguage: org.tax_language || null,   // COMMS-2: the brand kit's tax language
    receiptNumber,
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))), // ORG_TZ_SEAM_OK
    donorName: donor.name,
    taxYear: year,
    lineItems, totalAmount, totalDeductible,
    yourYear,
  };
  // BUILD-65 Part 5: the "create your free giving account" CTA has LEFT the PDF.
  // A year-end statement may be handed to an accountant or attached to a filing;
  // a marketing link inside it is the one place it stops looking like a receipt.
  // The account CTA stays in the receipt/statement EMAIL (sendReceiptEmail,
  // in the org's palette, where it reads as a service the org offers) — this
  // only removes it from the document. (BUILD-49 had stamped it into the frozen
  // snapshot; we no longer set snapshot.givingAccountUrl at all.)
  if (TF.isDemoOrg(org)) snapshot.demo = true;   // WHY-1 Part 8: a demo statement says so on every page
  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = "rcpt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, snapshot, pdf_data, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, null, "year_end", year, receiptNumber, totalAmount, totalDeductible, JSON.stringify(snapshot), pdfBuffer.toString("base64"), by.id, by.name]
  );

  let emailSent = false;
  if (send && donor.email) {
    // W-4: year-end statements are TRANSACTIONAL (tax paperwork, not outreach).
    const decision = await donorMailDecision("year_end", donor.email, org.id);
    if (decision.send) {
      emailSent = await sendReceiptEmail(org, donor, snapshot, pdfBuffer, `${year}-giving-statement.pdf`);
      if (emailSent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, id]);
    }
  }
  const rows = await query("SELECT * FROM receipts WHERE id=?", [id]);
  return { receipt: rows[0], created: true, emailSent, giftCount: gifts.length, totalAmount, totalDeductible };
}

// Literal routes declared before /receipts/:id/... siblings (matches the
// existing POST /sequences/process convention) — not currently a real
// collision risk since these have different segment counts, but kept
// consistent with the codebase's own established defensive ordering.
app.get("/receipts/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  // Nothing stored, nothing sent — placeholder text fills in any settings
  // fields not yet configured, so this stays useful as a "here's what's
  // missing" preview even before receipts_enabled can be flipped on.
  const fakeDonor = { name: "Jordan Sample", email: null };
  const fakeGiftDate = orgToday(await orgTz(org.id)); // ORG_TZ_SEAM_OK
  // BUILD-65 Part 2 sweep: the preview also assumed base64 (org.brand_accent /
  // org.logo_data) — a modern org's Settings preview showed Steward-green + no
  // logo. Read the SAME resolver + object-storage logo the issued receipt does.
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null);
  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),
    orgEin: org.ein || "XX-XXXXXXX",
    orgAddress: org.receipt_address || "123 Main St, Anytown, ST 00000",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, fakeDonor),
    taxLanguage: org.tax_language || null,
    receiptNumber: `${orgToday(await orgTz(org.id)).slice(0, 4)}-PREVIEW`, // ORG_TZ_SEAM_OK — the preview shows the number an issue would mint
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))),
    donorName: fakeDonor.name,
    giftDate: orgTime.formatCivil(fakeGiftDate),
    amount: 250,
    deductibleAmount: 250,
    paymentMethod: "Credit Card",
    quidProQuoDesc: null,
    quidProQuoValue: null,
  };
  const pdfBuffer = await renderReceiptPdf(snapshot);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-preview.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));

// Bulk — every donor with ≥1 real gift in {year}. No cron; the org triggers
// this deliberately each January (see CLAUDE.md "Tax receipting").
app.post("/receipts/year-end-run", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { year, dryRun } = req.body;
  const taxYear = parseInt(year, 10);
  if (!taxYear) return res.status(400).json({ error: "year required" });
  const orgId = req.user.orgId;
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet." });

  const donorRows = await query(
    `SELECT DISTINCT d.id, d.name, d.email FROM donors d
     JOIN gifts g ON g.donor_id = d.id
     WHERE d.org_id=? AND g.org_id=? AND (g.is_sample IS NOT TRUE) AND g.date >= ? AND g.date <= ? AND d.deleted_at IS NULL`,
    [orgId, orgId, `${taxYear}-01-01`, `${taxYear}-12-31`]
  );

  if (dryRun) {
    const missingEmailCount = donorRows.filter(d => !d.email).length;
    const giftCountRows = await query(
      `SELECT COUNT(*) AS count FROM gifts WHERE org_id=? AND (is_sample IS NOT TRUE) AND date >= ? AND date <= ?`,
      [orgId, `${taxYear}-01-01`, `${taxYear}-12-31`]
    );
    return res.json({ dryRun: true, donorCount: donorRows.length, giftCount: parseInt(giftCountRows[0]?.count, 10) || 0, missingEmailCount });
  }

  // Real run: sequential with a small delay between sends so a large donor
  // list doesn't blast Resend's API all at once.
  let generated = 0, emailed = 0, skipped = 0;
  for (const donorRow of donorRows) {
    try {
      const result = await issueYearEndStatement(org, donorRow, taxYear, { send: true, by: actor(req) });
      if (result.skipped) { skipped++; continue; }
      generated++;
      if (result.emailSent) emailed++;
    } catch (e) {
      console.error(`[receipts] year-end-run failed for donor ${donorRow.id}:`, e.message);
      skipped++;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  res.json({ dryRun: false, donorCount: donorRows.length, generated, emailed, skipped });
}));

app.get("/receipts/:id/pdf", requireAuth, wrap(async (req, res) => {
  const [receipt] = await query("SELECT id, receipt_number, type, tax_year, pdf_data FROM receipts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!receipt || !receipt.pdf_data) return res.status(404).json({ error: "Receipt not found" });
  const buf = Buffer.from(receipt.pdf_data, "base64");
  const filename = receipt.type === "year_end" ? `${receipt.tax_year}-giving-statement.pdf` : `receipt-${receipt.receipt_number}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}));

// Void, never delete — receipts are legal artifacts. Matches the DELETE-
// routes-stay-ungated convention everywhere else in this app; voiding is
// this record type's equivalent removal action, so it's requireAdmin (like
// other irreversible-ish admin actions) rather than checkWriteAccess.
app.post("/receipts/:id/void", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { reason } = req.body;
  const existing = await query("SELECT id FROM receipts WHERE id=? AND org_id=? AND voided_at IS NULL", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Active receipt not found" });
  await run("UPDATE receipts SET voided_at=NOW(), void_reason=? WHERE id=?", [reason || null, req.params.id]);
  const rows = await query(
    "SELECT id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, sent_to, sent_at, voided_at, void_reason, created_at FROM receipts WHERE id=?",
    [req.params.id]
  );
  res.json(rows[0]);
}));

// Manual per-gift issue/resend — the one-click path for offline gifts
// (which never auto-receipt) and the "Send receipt" button in DonorProfile.
app.post("/gifts/:id/receipt", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [gift] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!gift) return res.status(404).json({ error: "Gift not found" });
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet, set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [gift.donor_id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const existingRows = await query("SELECT * FROM receipts WHERE gift_id=? AND voided_at IS NULL AND type='gift'", [gift.id]);
  if (existingRows.length) {
    if (req.query.resend !== undefined) {
      const emailSent = await resendReceiptEmail(existingRows[0], org, donor, actor(req));
      const rows = await query("SELECT * FROM receipts WHERE id=?", [existingRows[0].id]);
      return res.json({ receipt: rows[0], emailSent, resent: true });
    }
    return res.status(409).json({ error: "This gift already has an active receipt.", receipt: existingRows[0] });
  }

  const result = await issueGiftReceipt(gift, org, donor, { send: true, by: actor(req), manual: true });
  if (result.skipped === "undated_gift") return res.status(409).json({ error: "undated_gift",
    message: "This gift has no date, and a tax receipt names the day a gift was given. Set the date on the gift, then send the receipt." });
  if (result.skipped) return res.status(400).json({ error: `Could not issue receipt: ${result.skipped}` });
  res.status(201).json(result.receipt);
}));

// List for DonorProfile's Gifts & Pledges tab — no pdf_data in the list
// response (board_reports pattern), fetched separately via
// GET /receipts/:id/pdf only when actually downloading one.
app.get("/donors/:id/receipts", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const rows = await query(
    `SELECT id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, sent_to, sent_at, voided_at, void_reason, created_at
     FROM receipts WHERE donor_id=? AND org_id=? ORDER BY created_at DESC`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

app.post("/donors/:id/year-end-statement", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { year, send } = req.body;
  const taxYear = parseInt(year, 10);
  if (!taxYear) return res.status(400).json({ error: "year required" });
  const orgId = req.user.orgId;
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet, set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const result = await issueYearEndStatement(org, donor, taxYear, { send: send !== false, by: actor(req) });
  if (result.skipped) return res.status(400).json({ error: `No gifts found for ${taxYear}.` });
  res.status(201).json(result.receipt);
}));

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

app.get("/donors/:id/materials", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  // PROSPECT-1 — a prospect brief is for admins and major gifts staff only.
  const mg = await require("../prospect").canSee(req.user.userId);
  const rows = await query(`SELECT id,org_id,donor_id,file_name,file_type,file_url,notes,uploaded_by,uploaded_at,major_gifts_only FROM donor_materials
      WHERE donor_id=? AND org_id=?${mg ? "" : " AND COALESCE(major_gifts_only,false) = false"} ORDER BY uploaded_at DESC`, [req.params.id, req.user.orgId]);
  // FIX-45: the photograph of a check is this person's file too. It lives on
  // the gift (gifts.cheque_asset_id, written by To confirm and by "attach the
  // check"), so it is listed here beside the uploads, read-only: it is the
  // gift's evidence and is removed with the gift, never from this list.
  const checks = await query(`SELECT id, amount, date, cheque_asset_id, created_by_name, created_at FROM gifts
      WHERE donor_id=? AND org_id=? AND cheque_asset_id IS NOT NULL`, [req.params.id, req.user.orgId]);
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; };
  const files = rows.concat(checks.map(g => ({
    id: "check:" + g.id, kind: "check_image", gift_id: g.id, donor_id: req.params.id,
    file_name: `Check for the $${Number(g.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gift on ${day(g.date)}`,
    file_type: "image/webp", file_url: donorPhotoUrl(req.user.orgId, g.cheque_asset_id),
    notes: "Attached to the gift.", uploaded_by: g.created_by_name || null, uploaded_at: g.created_at,
  })));
  files.sort((x, y) => new Date(y.uploaded_at) - new Date(x.uploaded_at));
  res.json(files);
}));

// Server-side backstop for donor material uploads. The client only checks
// file.size<1MB before base64-encoding — trivially bypassed by calling the
// API directly, so it's not a real limit on its own. The MIME allowlist is
// the actual fix for the stored-XSS risk: file_type is attacker/uploader-
// controlled and the frontend's viewMaterial() trusts it verbatim to build a
// Blob it opens via window.open(URL.createObjectURL(...)) — if file_type
// were ever "text/html" or "image/svg+xml", that blob would execute as
// script in the browser. That path isn't reachable today only because
// GET /donors/:id/materials happens to exclude file_data from its SELECT
// (an apparently unrelated bug that also makes the "View" button do nothing
// for base64 uploads) — an accident, not a real control. Constraining
// file_type to genuinely inert formats at write time closes the actual gap,
// so it stays closed even if that unrelated bug gets "fixed" later by
// someone adding file_data back to a read response.
const MATERIAL_MAX_BYTES = 1024 * 1024; // 1MB, matches the documented convention
const MATERIAL_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/octet-stream",
]);

app.post("/donors/:id/materials", requireAuth, wrap(async (req, res) => {
  const { file_name, file_type, file_url, file_data, notes } = req.body;
  if (!file_name) return res.status(400).json({ error: "file_name required" });
  if (file_type && !MATERIAL_ALLOWED_MIME_TYPES.has(file_type)) {
    return res.status(400).json({ error: `Unsupported file type: ${file_type}` });
  }
  if (file_data && Buffer.byteLength(file_data, "base64") > MATERIAL_MAX_BYTES) {
    return res.status(400).json({ error: "File too large. Maximum size is 1MB." });
  }
  const donorCheck = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const id = "mat_" + uuid().slice(0,8);
  await run(
    "INSERT INTO donor_materials (id,org_id,donor_id,file_name,file_type,file_url,file_data,notes,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, file_name, file_type||"", file_url||null, file_data||null, notes||"", userRow[0]?.name||""]
  );
  const rows = await query("SELECT id,org_id,donor_id,file_name,file_type,file_url,notes,uploaded_by,uploaded_at FROM donor_materials WHERE id=?", [id]);
  // Log interaction
  try {
    const ext = file_type ? file_type.split("/").pop() : "file";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_"+uuid().slice(0,8), req.user.orgId, req.params.id, "material",
       `Material added: ${file_name} (${ext})`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, userRow[0]?.name||""]   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
    );
  } catch(e) { console.error("Material log:", e.message); }
  res.status(201).json(rows[0]);
}));

app.delete("/materials/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM donor_materials WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  if (existing[0].major_gifts_only && !(await require("../prospect").canSee(req.user.userId))) return res.status(404).json({ error: "Not found" });
  const undoId = await trashRow("donor_materials", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// ── Households / soft credit (BUILD-14) ────────────────────────────────────
// A household groups 2+ constituents. HARD CREDIT NEVER MOVES: donors.
// total_giving stays each donor's own gift sum, org hard total = SUM(all
// gifts) regardless of grouping. Combined giving and soft credit are DERIVED
// (never stored counters), so they cannot double-count. See db.js migration.
function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : "";
}

// Full derived view of a household: members (with per-member hard credit +
// primary flag), combined giving, member count. Combined = SUM(members'
// hard credit) — a pure aggregation over the same gift rows.
async function householdView(householdId, orgId) {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [householdId, orgId]);
  if (!hh.length) return null;
  const members = await query(
    `SELECT id, name, email, phone, total_giving, gift_count, last_gift_date, last_gift_amount,
            stage, status, assigned_to, assigned_to_name
     FROM donors WHERE household_id=? AND org_id=? AND deleted_at IS NULL
     ORDER BY total_giving DESC, id`, [householdId, orgId]);
  // REPORTS-4: combined giving is the `household-giving` source's value (the
  // same members, added in cents), so it opens onto them and foots exactly.
  const combinedSource = { key: "household-giving", params: { household: householdId } };
  const combinedGiving = (await figureSources.figureValue(orgId, combinedSource)).value;
  const combinedGiftCount = members.reduce((s, m) => s + (parseInt(m.gift_count, 10) || 0), 0);
  return {
    ...hh[0],
    members: members.map(m => ({
      ...m,
      total_giving: parseFloat(m.total_giving) || 0,
      last_gift_amount: parseFloat(m.last_gift_amount) || 0,
      gift_count: parseInt(m.gift_count, 10) || 0,
      is_primary: m.id === hh[0].primary_donor_id,
      // per-member soft credit = combined − own hard credit = other members' gifts
      soft_credit: (Math.round(combinedGiving * 100) - Math.round((parseFloat(m.total_giving) || 0) * 100)) / 100,
      source: { key: "household-giving", params: { household: householdId, only: m.id } },
    })),
    member_count: members.length,
    combined_giving: combinedGiving,
    combined_source: combinedSource,
    combined_gift_count: combinedGiftCount,
  };
}

app.get("/households", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT h.id, h.name, h.primary_donor_id, h.joint_acknowledgment, h.created_at,
            COUNT(d.id)::int AS member_count, COALESCE(SUM(d.total_giving),0) AS combined_giving
     FROM households h
     LEFT JOIN donors d ON d.household_id = h.id AND d.org_id = h.org_id AND d.deleted_at IS NULL
     WHERE h.org_id=?
     GROUP BY h.id
     ORDER BY combined_giving DESC, h.name`, [req.user.orgId]);
  res.json(rows.map(r => ({ ...r, member_count: parseInt(r.member_count, 10) || 0, combined_giving: parseFloat(r.combined_giving) || 0 })));
}));

app.get("/households/:id", requireAuth, wrap(async (req, res) => {
  const view = await householdView(req.params.id, req.user.orgId);
  if (!view) return res.status(404).json({ error: "Household not found" });
  // Combined giving history — all members' gifts merged, newest first
  const gifts = await query(
    `SELECT g.id, g.donor_id, d.name AS donor_name, g.amount, g.date, g.type, g.campaign
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     WHERE d.household_id=? AND g.org_id=? AND d.deleted_at IS NULL
     ORDER BY g.date DESC NULLS LAST, g.id DESC LIMIT 200`, [req.params.id, req.user.orgId]);
  view.giving_history = gifts.map(g => ({ ...g, amount: parseFloat(g.amount) || 0 }));
  res.json(view);
}));

async function validateHouseholdMembers(memberIds, primaryDonorId, orgId, allowHouseholdId) {
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds.filter(Boolean))] : [];
  if (ids.length < 2) return { status: 400, error: "A household needs at least two members." };
  const members = await query(
    "SELECT id, name, kind, household_id FROM donors WHERE id = ANY(?) AND org_id=? AND deleted_at IS NULL",
    [ids, orgId]);
  if (members.length !== ids.length) return { status: 404, error: "One or more donors not found in this organization." };
  const foreign = members.find(m => m.household_id && m.household_id !== allowHouseholdId);
  if (foreign) return { status: 400, error: "A donor is already in another household." };
  // BUILD-97 Part 2 — a household is people. Checked on the MEMBER LIST rather
  // than at either route, so the create path and the edit path cannot disagree.
  const orgMember = members.find(m => m.kind === "organisation" || m.kind === "anonymous");
  if (orgMember) return { status: 400, error: PERSON_ONLY_SENTENCE("be part of a household", orgMember.name) };
  const primary = primaryDonorId && ids.includes(primaryDonorId) ? primaryDonorId : ids[0];
  return { ids, primary };
}

app.post("/households", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, memberIds, primaryDonorId, jointAcknowledgment } = req.body;
  const v = await validateHouseholdMembers(memberIds, primaryDonorId, req.user.orgId, null);
  if (v.error) return res.status(v.status).json({ error: v.error });
  // Default name: "The {primary's last name} Household"
  let hhName = (name && String(name).trim()) || "";
  if (!hhName) {
    const primaryRow = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [v.primary, req.user.orgId]);
    const ln = lastName(primaryRow[0]?.name);
    hhName = ln ? `The ${ln} Household` : "Household";
  }
  const id = "hh_" + uuid().slice(0, 8);
  await withTransaction(async (client) => {
    await runTx(client, "INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)",
      [id, req.user.orgId, hhName, v.primary, jointAcknowledgment !== false, actor(req).id, actor(req).name]);
    await runTx(client, "UPDATE donors SET household_id=? WHERE id = ANY(?) AND org_id=?", [id, v.ids, req.user.orgId]);
  });
  await householdLines(req, hhName, id, v.ids, []);   // WIRE-1
  res.status(201).json(await householdView(id, req.user.orgId));
}));

app.put("/households/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
  // FIX-14 Part 2b: whoever made the household, or an admin. The audit row
  // carries the members before and after, so it can say who was removed.
  if (!(await mayEditLogged(req, hh[0]))) return res.status(403).json(NOT_YOURS);
  const hhBefore = await auditShape("households", hh[0], req.user.orgId);
  const { name, memberIds, primaryDonorId, jointAcknowledgment } = req.body;
  let ids = null, primary = hh[0].primary_donor_id;
  if (memberIds !== undefined) {
    const v = await validateHouseholdMembers(memberIds, primaryDonorId, req.user.orgId, req.params.id);
    if (v.error) return res.status(v.status).json({ error: v.error });
    ids = v.ids; primary = v.primary;
  } else if (primaryDonorId) {
    // primary change without member change — must be an existing member
    const m = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND household_id=?", [primaryDonorId, req.user.orgId, req.params.id]);
    if (!m.length) return res.status(400).json({ error: "New primary must be a member of the household." });
    primary = primaryDonorId;
  }
  const membersBefore = ids ? (await query("SELECT id FROM donors WHERE household_id=? AND org_id=?", [req.params.id, req.user.orgId])).map(r => r.id) : [];
  await withTransaction(async (client) => {
    if (ids) {
      // drop members no longer in the set, then (re)attach the set
      await runTx(client, "UPDATE donors SET household_id=NULL WHERE household_id=? AND org_id=? AND NOT (id = ANY(?))", [req.params.id, req.user.orgId, ids]);
      await runTx(client, "UPDATE donors SET household_id=? WHERE id = ANY(?) AND org_id=?", [req.params.id, ids, req.user.orgId]);
    }
    await runTx(client,
      "UPDATE households SET name=COALESCE(?,name), primary_donor_id=?, joint_acknowledgment=COALESCE(?,joint_acknowledgment), updated_at=NOW() WHERE id=? AND org_id=?",
      [name && String(name).trim() ? String(name).trim() : null, primary,
       jointAcknowledgment === undefined ? null : (jointAcknowledgment !== false), req.params.id, req.user.orgId]);
  });
  const [hhRow] = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (ids) await householdLines(req, hhRow?.name || "the household", req.params.id,
    ids.filter(x => !membersBefore.includes(x)), membersBefore.filter(x => !ids.includes(x)));   // WIRE-1
  const hhAfter = await auditShape("households", hhRow, req.user.orgId);
  if (auditTrailMod.diffFields(hhBefore, hhAfter)) {
    await run("UPDATE households SET edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?",
      [...(await editStamp(req)), req.params.id, req.user.orgId]);
  }
  if (req.audit) { req.audit.before(hhBefore); req.audit.after(hhAfter); }
  res.json(await householdView(req.params.id, req.user.orgId));
}));

// WIRE-1 · joining or leaving a household is a line on the person.
async function householdLines(req, hhName, householdId, joined, left) {
  const who = await staffWho(req);
  for (const [list, word] of [[joined, "Joined"], [left, "Left"]]) {
    for (const donorId of list || []) {
      await TL.timelineLine({ orgId: req.user.orgId, donorId, note: `${word} ${hhName}.`,
        actorId: who.id, actorName: who.name, metadata: { via: "household", household_id: householdId, change: word.toLowerCase() } });
    }
  }
}

// FIX-14 Part 2b: the household goes to the trash with its member list, and
// Undo re-links every member who has not joined another household since.
app.delete("/households/:id", requireAuth, wrap(async (req, res) => {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
  if (!(await mayEditLogged(req, hh[0]))) return res.status(403).json(NOT_YOURS);
  if (req.audit) req.audit.before(await auditShape("households", hh[0], req.user.orgId));
  const undoId = await trashRow("households", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Household not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// Per-donor soft-credit breakdown: hard = own gifts, soft = other household
// members' gifts, combined = the household total. Derived, no stored counter.
app.get("/donors/:id/soft-credit", requireAuth, wrap(async (req, res) => {
  const d = await query("SELECT id, household_id, total_giving FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  const hardCredit = parseFloat(d[0].total_giving) || 0;
  const householdId = d[0].household_id || null;
  let householdCombined = hardCredit, softCredit = 0;
  if (householdId) {
    const agg = await query(
      "SELECT COALESCE(SUM(total_giving),0) AS combined FROM donors WHERE household_id=? AND org_id=? AND deleted_at IS NULL",
      [householdId, req.user.orgId]);
    householdCombined = parseFloat(agg[0].combined) || 0;
    softCredit = (Math.round(householdCombined * 100) - Math.round(hardCredit * 100)) / 100;
  }
  // REPORTS-4: the household panel's three figures open their members.
  const householdSources = householdId ? {
    hardCredit: { key: "household-giving", params: { household: householdId, only: req.params.id } },
    softCredit: { key: "household-giving", params: { household: householdId, except: req.params.id } },
    householdCombined: { key: "household-giving", params: { household: householdId } },
  } : null;
  // BUILD-98 Part 1 — the soft credits on OTHER people's gifts, which is a
  // different thing from the household view above: a DAF recommender, the
  // spouse on a joint cheque, the board member who asked. Hard stays hard;
  // "with soft credit" is its own figure, beside it and labelled.
  // FIX-7 Part 1 — the PAGE a peer-to-peer soft credit came through, so the
  // record can say "raised $1,900 for Harbor Run" in the one sentence a
  // fundraiser would use. A soft credit is never this person's giving: it
  // does not move their lifetime total, their last gift, their drift, their
  // LYBUNT or their retention, and every one of those reads `gifts` alone.
  const scRows = await query(
    `SELECT sc.id, sc.amount, sc.pct, sc.role, g.id AS gift_id, g.date, g.amount AS gift_amount,
            dg.id AS giver_id, dg.name AS giver_name,
            gp.id AS page_id, gp.title AS page_title
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors dg ON dg.id = g.donor_id AND dg.org_id = g.org_id
       LEFT JOIN giving_pages gp ON gp.id = g.giving_page_id AND gp.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? ORDER BY g.date DESC NULLS LAST LIMIT 200`, [req.user.orgId, req.params.id]);
  // NUMBERS-2: the totals are added up over EVERY soft credit, not the 200
  // newest the list shows (a busy peer-to-peer fundraiser has more).
  const scAgg = await query(
    `SELECT sc.role, gp.id AS page_id, gp.title AS page_title, MAX(g.date) AS newest,
            COALESCE(SUM(ROUND(sc.amount * 100)), 0)::bigint AS cents, COUNT(*)::int AS n
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors dg ON dg.id = g.donor_id AND dg.org_id = g.org_id
       LEFT JOIN giving_pages gp ON gp.id = g.giving_page_id AND gp.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? GROUP BY sc.role, gp.id, gp.title`, [req.user.orgId, req.params.id]);
  // FIX-51: the census lines read donorCreditTotals, the header's own two
  // figures: their own giving is Lifetime (no credit rows), and soft credit
  // is the one Soft credit figure (others' gifts and their own credit rows).
  const credit = await donorCreditTotals(req.user.orgId, req.params.id);
  const giftSoftCents = credit.softCents;
  // One line per page they raised for, newest gift first, in cents.
  const raisedFor = scAgg.filter(r => r.role === "peer_fundraiser" && r.page_id)
    .sort((a, b) => (String(b.newest) > String(a.newest) ? 1 : -1))
    .map(r => ({ pageId: r.page_id, pageTitle: r.page_title, amountCents: Number(r.cents), giftCount: r.n }));
  res.json({ donorId: d[0].id, householdId, hardCredit, softCredit, householdCombined, householdSources,
    giftSoftCredit: giftSoftCents / 100,
    ownGiving: credit.hardCents / 100,
    hardPlusGiftSoft: credit.hardPlusSoftCents / 100,
    raisedFor,
    raisedForSentence: "Money other people gave through their fundraiser page. It is recognition, not their own giving, and it changes nothing about their record.",
    giftSoftCredits: scRows.map(r => ({ id: r.id, amount: Number(r.amount), pct: r.pct == null ? null : Number(r.pct), role: r.role,
      giftId: r.gift_id, date: r.date, giftAmount: Number(r.gift_amount), giverId: r.giver_id, giverName: r.giver_name,
      pageId: r.page_id || null, pageTitle: r.page_title || null })) });
}));
// ── BUILD-98 Part 1 — a gift's soft credits, tribute and match ─────────────
app.get("/gifts/:id/extras", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, donor_id, amount, tribute_type, tribute_donor_id, tribute_name, match_employer_id, match_pledge_id FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Gift not found" });
  const [soft, notice, match] = await Promise.all([
    query(`SELECT sc.donor_id, sc.amount, sc.pct, sc.role, d.name FROM gift_soft_credits sc
             JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id
            WHERE sc.gift_id=? AND sc.org_id=? ORDER BY d.name`, [g.id, orgId]),
    query("SELECT id, status, notify_name, notify_email, notify_address, body FROM tribute_notices WHERE gift_id=? AND org_id=?", [g.id, orgId]),
    g.match_pledge_id ? query(
      `SELECT p.id, p.amount, p.status, p.due_date, d.name AS employer_name, COALESCE(pp.paid,0) AS paid
         FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
         LEFT JOIN ${require("../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
        WHERE p.id=? AND p.org_id=?`, [orgId, g.match_pledge_id, orgId]) : [],
  ]);
  res.json({
    softCredits: soft.map(r => ({ donorId: r.donor_id, name: r.name, amount: Number(r.amount), pct: r.pct == null ? null : Number(r.pct), role: r.role })),
    tribute: g.tribute_type ? { type: g.tribute_type, donorId: g.tribute_donor_id, name: g.tribute_name } : null,
    tributeNotice: notice[0] || null,
    match: match[0] ? { pledgeId: match[0].id, employerId: g.match_employer_id, employerName: match[0].employer_name,
      expected: Number(match[0].amount), received: Number(match[0].paid), status: match[0].status, dueDate: match[0].due_date } : null,
  });
}));

// Add or change them after the gift exists. Soft credits are REPLACED as a set;
// a tribute is set; a match is added once (a second one is refused by the
// database, not by an if-statement).
app.put("/gifts/:id/extras", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Gift not found" });
  const ck = await checkGiftExtras(orgId, g.donor_id, Math.round(Number(g.amount) * 100),
    { softCredits: req.body?.softCredits, tribute: req.body?.tribute, match: req.body?.match });
  if (ck.notFound) return res.status(404).json({ error: "Donor not found" });
  if (ck.errors) return res.status(400).json({ error: ck.errors.join("; ") });
  const extras = { ...ck.extras };
  if (!Array.isArray(req.body?.softCredits)) delete extras.softCredits;   // absent means "leave them"
  const result = await writeGiftExtras(orgId, g, extras, { actorId: actor(req).id, actorName: actor(req).name });
  res.json({ ok: true, ...result });
}));

// ── Constituent designations (BUILD-14) ────────────────────────────────────
// First-class, filterable, reportable gift-vehicle / planned-giving flags.
// Filter the donor list via GET /donors?designation=<kind>.
const DESIGNATION_KINDS = {
  estate: "Estate giving",
  planned_confirmed: "Planned gift confirmed",
  planned_prospect: "Planned-giving prospect",
};

app.get("/donors/:id/designations", requireAuth, wrap(async (req, res) => {
  const d = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  const rows = await query("SELECT kind, created_at FROM donor_designations WHERE donor_id=? AND org_id=? ORDER BY created_at", [req.params.id, req.user.orgId]);
  res.json(rows.map(r => ({ kind: r.kind, label: DESIGNATION_KINDS[r.kind] || r.kind, created_at: r.created_at })));
}));

app.post("/donors/:id/designations", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { kind } = req.body;
  if (!DESIGNATION_KINDS[kind]) return res.status(400).json({ error: "Unknown designation. Must be one of: " + Object.keys(DESIGNATION_KINDS).join(", ") });
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  await run(
    "INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES (?,?,?,?) ON CONFLICT (donor_id, kind) DO NOTHING",
    ["dsg_" + uuid().slice(0, 8), req.user.orgId, req.params.id, kind]);
  res.status(201).json({ ok: true, kind, label: DESIGNATION_KINDS[kind] });
}));

app.delete("/donors/:id/designations/:kind", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  await run("DELETE FROM donor_designations WHERE donor_id=? AND org_id=? AND kind=?", [req.params.id, req.user.orgId, req.params.kind]);
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

// ── BUILD-99 (major gifts) Part 4 — THE PROSPECT BRIEF ─────────────────────
// "Brief me" on a person: one page an officer reads in the car, written from the
// organisation's own rows, every sentence citing one.
//
// THE GUARANTEE IS THE SCHEMA, NOT THE PROMPT. shared/briefShape.js has no
// numeric field anywhere in it, so a model that wanted to assert a capacity has
// nowhere to put it; every figure on the finished page is rendered HERE from the
// rows. A prompt is a request; this is the absence of a place to say it.
async function briefShapeMod() { return import("../shared/briefShape.js"); }

// WHAT THE MODEL IS HANDED, AND NOTHING ELSE. Each row goes over as a line with
// a `kind:id` reference, and Steward keeps the same reference set to validate the
// citations against — so a cited row it never saw cannot survive.
async function briefRowsFor(orgId, donorId) {
  const P = await proposalMod();
  const V = await import("../shared/vocabulary.js");
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const t = V.makeT(org && org.vocabulary_json);
  const [donor] = await query(
    `SELECT id, name, email, kind, stage, suggested_stage, total_giving, gift_count, first_gift_date,
            last_gift_date, last_gift_amount, notes, assigned_to_name, household_id, deceased, do_not_contact
       FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!donor) return null;

  const refs = new Set([`person:${donor.id}`]);
  const lines = [];
  const money = require("../money");
  const givingWord = t("giver_singular") || "donor";

  lines.push(`person:${donor.id} · ${donor.name}${donor.kind === "organisation" ? " (an organization)" : ""}, `
    + `${money.formatCentsPlain(toCents(donor.total_giving) || 0)} given in total across ${Number(donor.gift_count) || 0} gifts, `
    + `first on ${donor.first_gift_date || "no recorded date"}, most recently on ${donor.last_gift_date || "no recorded date"}`
    + `${donor.stage ? `, at the stage "${donor.stage}"` : ""}. This organization calls somebody like this a ${givingWord}.`);

  // GIFTS — the last twelve, each its own row, with its fund and how it came in.
  const gifts = await query(
    `SELECT g.id, g.amount, g.date, g.type, g.payment_method, g.campaign, f.name AS fund_name
       FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id=? AND g.donor_id=? AND g.is_sample IS NOT TRUE
      ORDER BY g.date DESC NULLS LAST, g.id LIMIT 12`, [orgId, donorId]);
  for (const g of gifts) {
    refs.add(`gift:${g.id}`);
    lines.push(`gift:${g.id} · ${money.formatCentsPlain(toCents(g.amount) || 0)} on ${g.date}`
      + `${g.fund_name ? ` to ${t("fund_singular") || "fund"} "${g.fund_name}"` : ""}`
      + `${g.campaign ? `, appeal "${g.campaign}"` : ""}${g.payment_method ? `, by ${g.payment_method}` : ""}.`);
  }

  // PLEDGES — a promise is not money, and the brief must not read it as one.
  for (const p of await query(
    `SELECT id, amount, due_date, status FROM pledges WHERE org_id=? AND donor_id=? ORDER BY due_date DESC NULLS LAST LIMIT 6`, [orgId, donorId])) {
    refs.add(`pledge:${p.id}`);
    lines.push(`pledge:${p.id}, a pledge of ${money.formatCentsPlain(toCents(p.amount) || 0)} due ${p.due_date}, currently ${p.status}. A pledge is a promise, not money received.`);
  }

  // HOUSEHOLD AND RELATED PEOPLE.
  if (donor.household_id) {
    const [h] = await query("SELECT id, name FROM households WHERE id=? AND org_id=?", [donor.household_id, orgId]);
    if (h) {
      refs.add(`household:${h.id}`);
      const members = await query("SELECT name FROM donors WHERE org_id=? AND household_id=? AND id<>? AND deleted_at IS NULL", [orgId, h.id, donorId]);
      lines.push(`household:${h.id}, in the household "${h.name}"${members.length ? `, with ${members.map(m => m.name).join(" and ")}` : ""}.`);
    }
  }
  // SOFT CREDITS (BUILD-98 Part 1) — gifts that were somebody else's money.
  for (const sc of await query(
    `SELECT sc.id, sc.role, g.id AS gift_id, g.amount, g.date, d.name AS giver
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? ORDER BY g.date DESC NULLS LAST LIMIT 6`, [orgId, donorId]).catch(() => [])) {
    refs.add(`softcredit:${sc.id}`);
    lines.push(`softcredit:${sc.id}: soft-credited for ${money.formatCentsPlain(toCents(sc.amount) || 0)} given by ${sc.giver} on ${sc.date}`
      + `${sc.role ? ` as ${sc.role}` : ""}. The money was ${sc.giver}'s; this is recognition, not their own giving.`);
  }

  // THE OPEN PROPOSAL.
  for (const o of await query(
    `SELECT o.id, o.name, o.target_amount, o.proposal_stage, o.probability, o.notes, f.name AS fund_name,
            to_char(o.expected_close,'YYYY-MM-DD') AS expected_close_civil
       FROM opportunities o LEFT JOIN fin_funds f ON f.id = o.fund_id AND f.org_id = o.org_id
      WHERE o.org_id=? AND o.donor_id=? AND o.proposal_stage = ANY(?::text[])
      ORDER BY o.expected_close NULLS LAST LIMIT 3`, [orgId, donorId, P.OPEN_STAGE_KEYS])) {
    refs.add(`proposal:${o.id}`);
    lines.push(`proposal:${o.id}: an open ask of ${money.formatCentsPlain(toCents(o.target_amount) || 0)} for "${o.name}"`
      + `${o.fund_name ? ` (${o.fund_name})` : ""}, at stage "${P.stageLabel(o.proposal_stage)}"`
      + `${o.probability != null ? `, which the officer put at ${o.probability} per cent` : ", with no probability set"}`
      + `${o.expected_close_civil ? `, expected to close ${o.expected_close_civil}` : ""}`
      + `${o.notes ? `. The officer's note on it: "${String(o.notes).slice(0, 400)}"` : "."}`);
  }

  // THE LAST FIVE CONVERSATIONS, QUOTED.
  for (const i of await query(
    `SELECT id, type, date, note, logged_by_name FROM interactions
      WHERE org_id=? AND donor_id=? AND type = ANY(ARRAY['call','meeting','email','ask','note','stewardship'])
        AND COALESCE(note,'') <> '' ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 5`, [orgId, donorId])) {
    refs.add(`conversation:${i.id}`);
    lines.push(`conversation:${i.id} · ${i.type} on ${i.date}${i.logged_by_name ? ` logged by ${i.logged_by_name}` : ""}: "${String(i.note).slice(0, 500)}"`);
  }

  // THE PLAN'S NEXT STEP.
  const [plan] = await query("SELECT id, template_name FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active'", [orgId, donorId]);
  if (plan) {
    refs.add(`plan:${plan.id}`);
    const [openStep] = await query("SELECT seq, label, due_date FROM cultivation_plan_steps WHERE plan_id=? AND status='open'", [plan.id]);
    const [nextStep] = await query("SELECT seq, label, due_date FROM cultivation_plan_steps WHERE plan_id=? AND status='pending' ORDER BY seq LIMIT 1", [plan.id]);
    const s = openStep || nextStep;
    lines.push(`plan:${plan.id}: on the cultivation plan "${plan.template_name}"`
      + (s ? `; ${openStep ? "the open step" : "the next step"} is "${s.label}", due ${s.due_date}.` : "; every step is closed."));
  }

  // WHAT THE OFFICER WROTE.
  if (String(donor.notes || "").trim()) {
    refs.add(`note:${donor.id}`);
    lines.push(`note:${donor.id}: the note on their record reads: "${String(donor.notes).slice(0, 1200)}"`);
  }

  // The grounded numeric set: every figure that genuinely appears in the rows,
  // so `ungroundedClaims` can tell a fact from an invented rule.
  // THE MONEY SEAM, not Math.round — `tests/money-cents.test.js` is right that a
  // bare `Math.round(Number(x))` on a dollars value is the banned shape wherever
  // it appears, and "it is only feeding a text check" is not an exemption: the
  // next person to copy this line will not be feeding a text check.
  const grounded = [];
  for (const g of gifts) { const c = toCents(g.amount); if (c != null) grounded.push(toDollars(c), c); }
  grounded.push(Number(donor.gift_count) || 0);
  { const c = toCents(donor.total_giving); if (c != null) grounded.push(toDollars(c), c); }
  for (const l of lines) for (const m of String(l).matchAll(/\d+(?:\.\d+)?/g)) grounded.push(Number(m[0]));

  return { donor, org, t, refs, lines, grounded: [...new Set(grounded)], giftCount: gifts.length };
}

// GET /donors/:id/brief-rows — EXACTLY what the model would be handed, and
// nothing else. This is not a test seam: the brief's promise is that every line
// rests on a row you can open, and this is that list. It also means the row
// gathering — which is Steward's code, not a model's — is provable with no key
// configured at all.
app.get("/donors/:id/brief-rows", requireAuth, requireCrm, wrap(async (req, res) => {
  const ctx = await briefRowsFor(req.user.orgId, req.params.id);
  if (!ctx) return res.status(404).json({ error: "Donor not found" });
  res.json({
    donorId: ctx.donor.id, donorName: ctx.donor.name,
    refs: [...ctx.refs], lines: ctx.lines, groundedValues: ctx.grounded,
  });
}));

// POST /donors/:id/brief — write it, validate it, log it as an agent run.
app.post("/donors/:id/brief", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const TH = await thresholdsMod();
  const orgId = req.user.orgId;
  // THE DONOR IS CHECKED FIRST, AND THAT ORDER IS THE POINT. The gate below
  // answers 503 when no key is configured, and running it first meant a probe
  // with ANOTHER ORG's donor id got 503 instead of 404 — breaking "404 is the one
  // answer" for a cross-tenant read and telling the caller both that the route
  // exists and what Steward's key state is. Found by tenant-matrix §3.
  const ctx = await briefRowsFor(orgId, req.params.id);
  if (!ctx) return res.status(404).json({ error: "Donor not found" });

  const gate = await agentGate(orgId);
  // THE ABSENCE HAS A NAME. No key configured is Steward's state, not the org's,
  // and the honest answer is that the control is unavailable — never a 500 and
  // never an invented brief.
  if (!gate.ok) return res.status(503).json({ error: "brief_unavailable", reason: gate.reason,
    message: gate.reason === "ai_disabled" ? AI_OFF_MESSAGE
      : "Not set up yet. Steward support can turn on AI drafting for this server, then an admin switches it on in Settings, Data." });

  const runId = "arun_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_runs (id,org_id,status,plan,read_summary) VALUES (?,?,?,?,?)`,
    [runId, orgId, "running", JSON.stringify({ kind: "prospect_brief", donorId: ctx.donor.id }),
     `${ctx.refs.size} rows on ${ctx.donor.name}`]);

  const system = [
    "You are writing a one-page brief for a fundraiser who is about to go and see somebody.",
    "",
    "You are given ROWS from this organization's own records. Each row starts with a reference of the form kind:id.",
    "Write short, plain sentences about what those rows say. Every sentence must cite the references it rests on, exactly as given.",
    "",
    "RULES, and the first one is the whole job:",
    "- You may say NOTHING about this person that is not in the rows. No capacity, no wealth, no means, no guess about what they could give.",
    "- Use no figure that is not in the rows you were handed. Never state a rule about how giving works (no 'donors who give twice usually…').",
    "- A pledge is a promise, not money received. A soft credit is recognition, not their own giving. Say so if you mention them.",
    "- Quote a conversation rather than summarizing away the words the officer chose.",
    "- Leave a section out if the rows say nothing about it. Do not pad.",
    "- Use this organization's own vocabulary where the rows give it.",
    "- The headline names who this is and why she is reading it, and contains no figure.",
  ].join("\n");
  const user = [`The rows, on ${ctx.donor.name}:`, "", ...ctx.lines, "", "Write the brief."].join("\n");

  let raw = null, err = null;
  try {
    const client = anthropicFor(orgId);
    const msg = await client.messages.create({
      model: AGENT_MODEL, max_tokens: 2000, system,
      tools: [{ name: "brief", description: "The one-page brief she reads in the car.", strict: true, input_schema: B.BRIEF_SCHEMA }],
      tool_choice: { type: "tool", name: "brief" },
      messages: [{ role: "user", content: user }],
    });
    raw = (msg.content || []).find(b => b.type === "tool_use" && b.name === "brief")?.input || null;
  } catch (e) { err = e.message || String(e); }

  if (!raw) {
    await run("UPDATE agent_runs SET status='failed', finished_at=NOW(), error=? WHERE id=?", [err || "no brief returned", runId]);
    return res.status(502).json({ error: "The brief could not be written just now.", runId });
  }

  const checked = B.validateBrief(raw, {
    rows: ctx.refs,
    ungrounded: (text, opts) => TH.ungroundedClaims(text, opts),
    groundedValues: ctx.grounded,
  });
  await run(
    `UPDATE agent_runs SET status='done', finished_at=NOW(), actions=?, declined=?, withheld=?, withheld_reason=? WHERE id=?`,
    [JSON.stringify({ brief: checked, donorId: ctx.donor.id }), checked.dropped.length, checked.dropped.length,
     checked.dropped.length ? B.droppedSentence(checked.dropped) : null, runId]);

  res.json({
    runId, donorId: ctx.donor.id, donorName: ctx.donor.name,
    headline: checked.headline, sections: checked.sections,
    dropped: checked.dropped, droppedSentence: B.droppedSentence(checked.dropped),
    rowsRead: ctx.refs.size, footer: B.BRIEF_FOOTER,
  });
}));

// GET /briefs/:runId — read one back. It is an agent run, so it is on the
// Activity screen with everything else the agent did.
app.get("/briefs/:runId", requireAuth, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const [r] = await query("SELECT * FROM agent_runs WHERE id=? AND org_id=?", [req.params.runId, req.user.orgId]);
  if (!r || !r.actions || !r.actions.brief) return res.status(404).json({ error: "Brief not found" });
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [r.actions.donorId, req.user.orgId]);
  res.json({
    runId: r.id, donorId: r.actions.donorId, donorName: d ? d.name : "",
    ...r.actions.brief, droppedSentence: B.droppedSentence(r.actions.brief.dropped || []),
    writtenAt: r.finished_at, rowsRead: r.read_summary, footer: B.BRIEF_FOOTER,
  });
}));

// GET /briefs/:runId/pdf — the page she prints for the car, on the org's
// letterhead, through the same renderer discipline the acknowledgment letters use.
app.get("/briefs/:runId/pdf", requireAuth, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const [r] = await query("SELECT * FROM agent_runs WHERE id=? AND org_id=?", [req.params.runId, req.user.orgId]);
  if (!r || !r.actions || !r.actions.brief) return res.status(404).json({ error: "Brief not found" });
  const [org] = await query("SELECT name, legal_name, receipt_address, brand_accent, logo_data FROM orgs WHERE id=?", [req.user.orgId]);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [r.actions.donorId, req.user.orgId]);
  const pdf = await renderBriefPdf({
    org: { display: org.legal_name || org.name, receipt_address: org.receipt_address,
           brand_accent: org.brand_accent, logo_data: org.logo_data },
    donorName: d ? d.name : "",
    brief: r.actions.brief,
    footer: B.BRIEF_FOOTER,
    droppedSentence: B.droppedSentence(r.actions.brief.dropped || []),
    sectionTitle: B.sectionTitle,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="brief-${(d ? d.name : "prospect").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.pdf"`);
  res.send(pdf);
}));

// ONE page, the org's letterhead, and the footer that says what this is. The
// letterhead block is deliberately the same shape as renderLettersPdf's (BUILD-98
// Part 2) rather than a second idea about where an org's name goes.
function renderBriefPdf({ org, donorName, brief, footer, droppedSentence, sectionTitle }) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 46, left: 72, right: 72 }, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0f1a12", SUB = "#5a554f";
    const accent = org.brand_accent || "#0d5c3a";
    let logo = null;
    if (org.logo_data && /^data:image\/(png|jpe?g);base64,/.test(org.logo_data)) {
      try { logo = Buffer.from(org.logo_data.split(",")[1], "base64"); } catch { logo = null; }
    }
    doc.addPage();
    const PW = doc.page.width;
    doc.rect(0, 0, PW, 6).fill(accent);
    if (logo) { try { doc.image(logo, PW - 72 - 60, 22, { fit: [60, 44] }); } catch { /* a logo that will not draw costs the logo, not the page */ } }
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(org.display || "", 72, 26, { width: PW - 220, lineBreak: false });
    if (org.receipt_address) doc.font("Helvetica").fontSize(8.5).fillColor(SUB).text(org.receipt_address, 72, 44, { width: PW - 220 });

    let y = 92;
    doc.font("Times-Bold").fontSize(19).fillColor(INK).text(donorName || "Prospect brief", 72, y, { width: PW - 144 });
    y = doc.y + 4;
    if (brief.headline) {
      doc.font("Times-Italic").fontSize(11.5).fillColor(SUB).text(brief.headline, 72, y, { width: PW - 144 });
      y = doc.y + 10;
    }
    const bottom = doc.page.height - 84;
    for (const sec of (brief.sections || [])) {
      if (y > bottom - 40) break;                 // held to ONE page, never spilled
      doc.font("Helvetica-Bold").fontSize(9).fillColor(accent)
        .text(String(sectionTitle(sec.key) || sec.key).toUpperCase(), 72, y, { width: PW - 144, characterSpacing: 0.8 });
      y = doc.y + 4;
      for (const s of sec.sentences) {
        if (y > bottom - 14) break;
        doc.font("Times-Roman").fontSize(10.5).fillColor(INK)
          .text(s.text, 72, y, { width: PW - 144, lineGap: 2, height: bottom - y, ellipsis: true });
        y = doc.y + 3;
      }
      y += 7;
    }
    let fy = doc.page.height - 74;
    if (droppedSentence) {
      doc.font("Helvetica").fontSize(8).fillColor(SUB).text(droppedSentence, 72, fy, { width: PW - 144, height: 12 });
      fy += 12;
    }
    doc.font("Helvetica").fontSize(8).fillColor(SUB).text(footer, 72, fy, { width: PW - 144, height: 26 });
    doc.end();
  });
}

// ── Donor-to-donor relationships (household/spouse/family/employer_match) ──
// Manual linking only — no auto-detection (matching last name, address,
// etc.) in this pass, see CLAUDE.md. One row per pair regardless of which
// donor is A vs B; both directions are queried here so either donor's
// profile shows the same link.
const DONOR_RELATIONSHIP_TYPES = ["spouse", "household", "family", "employer_match"];
// Only these two types pool into a shared "household total" — family and
// employer_match are relationship context, not a shared giving pool.
const HOUSEHOLD_RELATIONSHIP_TYPES = ["spouse", "household"];

app.get("/donors/:id/relationships", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const { orgId } = req.user;
  const donorId = req.params.id;
  const rows = await query(
    `SELECT dr.id, dr.relationship_type, dr.notes, dr.created_at,
            CASE WHEN dr.donor_id_a = ? THEN dr.donor_id_b ELSE dr.donor_id_a END AS related_donor_id
     FROM donor_relationships dr
     WHERE dr.org_id = ? AND (dr.donor_id_a = ? OR dr.donor_id_b = ?)
     ORDER BY dr.created_at ASC`,
    [donorId, orgId, donorId, donorId]
  );
  if (!rows.length) return res.json({ relationships: [], householdTotal: null });

  const relatedIds = rows.map(r => r.related_donor_id);
  const relatedDonors = await query(
    `SELECT id, name, total_giving FROM donors WHERE org_id = ? AND id = ANY(?)`,
    [orgId, relatedIds]
  );
  const donorMap = Object.fromEntries(relatedDonors.map(d => [d.id, d]));

  const relationships = rows.map(r => ({
    id: r.id,
    relationshipType: r.relationship_type,
    notes: r.notes,
    relatedDonorId: r.related_donor_id,
    relatedDonorName: donorMap[r.related_donor_id]?.name || "(deleted donor)",
    relatedDonorTotalGiving: Number(donorMap[r.related_donor_id]?.total_giving) || 0,
  }));

  // FIX-49 decision 8: the household record is the only grouping. The total
  // is the household's combined giving (`household-giving`, the household
  // panel's own figure), never a second sum over spouse links.
  let householdTotal = null, householdTotalSource = null;
  const [me] = await query("SELECT household_id FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]);
  if (me && me.household_id) {
    householdTotalSource = { key: "household-giving", params: { household: me.household_id } };
    householdTotal = (await figureSources.figureValue(orgId, householdTotalSource)).value;
  }

  res.json({ relationships, householdTotal, householdTotalSource });
}));

app.post("/donors/:id/relationships", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const donorId = req.params.id;
  const { relatedDonorId, relationshipType, notes } = req.body;
  if (!relatedDonorId || !DONOR_RELATIONSHIP_TYPES.includes(relationshipType)) {
    return res.status(400).json({ error: "relatedDonorId and a valid relationshipType are required" });
  }
  if (relatedDonorId === donorId) return res.status(400).json({ error: "A donor can't be linked to themselves" });

  const bothRows = await query(
    "SELECT id FROM donors WHERE org_id = ? AND id IN (?, ?) AND deleted_at IS NULL",
    [orgId, donorId, relatedDonorId]
  );
  if (bothRows.length < 2) return res.status(404).json({ error: "Donor not found" });

  // Order-agnostic dedup — a link already stored as (B,A) shouldn't allow a
  // second (A,B) row for the same pair.
  const existing = await query(
    `SELECT id FROM donor_relationships WHERE org_id = ?
       AND ((donor_id_a = ? AND donor_id_b = ?) OR (donor_id_a = ? AND donor_id_b = ?))`,
    [orgId, donorId, relatedDonorId, relatedDonorId, donorId]
  );
  if (existing.length) return res.status(409).json({ error: "These donors are already linked" });

  const id = "drel_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)",
    [id, orgId, donorId, relatedDonorId, relationshipType, notes || null, actor(req).id, actor(req).name]
  );
  if (req.audit) {
    const [r] = await query("SELECT * FROM donor_relationships WHERE id = ?", [id]);
    req.audit.after(await auditShape("donor_relationships", r, orgId));
  }
  // FIX-49 decision 8: a spouse or household link puts the two in one
  // household record, the one grouping (db.js householdsFromLinks).
  if (HOUSEHOLD_RELATIONSHIP_TYPES.includes(relationshipType)) await require("../db").householdsFromLinks(orgId).catch(e => console.error("[fix-49] household:", e.message));
  res.status(201).json({ id });
}));

// FIX-15 Part 4 — a relationship from BEFORE FIX-14, or one an import or the
// system made, has no person who "linked them" to defer to. Those belong to
// whoever can edit the donor (the same gate as PUT /donors/:id: signed in, with
// write access). One made since FIX-14 by a person stays theirs, or an admin's.
const FIX14_SHIPPED = "2026-10-02T05:09:42Z";
async function mayEditRelationship(req, r) {
  const humanMade = r.created_by && !String(r.created_by).startsWith("system:");
  const legacy = !humanMade || (r.created_at && new Date(r.created_at) < new Date(FIX14_SHIPPED));
  if (legacy) return true;
  return mayEditLogged(req, r);
}

// FIX-14 Part 2b — edit a relationship's kind and its note. Whoever linked
// the two, or an admin (FIX-15: or anyone who can edit the donor, for a legacy one).
app.put("/donor-relationships/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const [r] = await query("SELECT * FROM donor_relationships WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (!(await mayEditRelationship(req, r))) return res.status(403).json(NOT_YOURS);
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.relationshipType !== undefined && b.relationshipType !== r.relationship_type) {
    if (!DONOR_RELATIONSHIP_TYPES.includes(b.relationshipType)) return res.status(400).json({ error: "A valid relationshipType is required" });
    sets.push("relationship_type=?"); vals.push(b.relationshipType);
  }
  if (b.notes !== undefined && String(b.notes || "") !== String(r.notes || "")) {
    sets.push("notes=?"); vals.push(String(b.notes || "").slice(0, 2000) || null);
  }
  if (!sets.length) return res.json({ ...r, unchanged: true });
  sets.push("edited_at=NOW()", "edited_by=?", "edited_by_name=?");
  vals.push(...(await editStamp(req)));
  await run(`UPDATE donor_relationships SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, [...vals, req.params.id, orgId]);
  const [out] = await query("SELECT * FROM donor_relationships WHERE id = ?", [req.params.id]);
  if (req.audit) { req.audit.before(await auditShape("donor_relationships", r, orgId)); req.audit.after(await auditShape("donor_relationships", out, orgId)); }
  res.json(out);
}));

// FIX-14 Part 2b: whoever linked them, or an admin; to the trash, so Undo works.
app.delete("/donor-relationships/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [r] = await query("SELECT * FROM donor_relationships WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  if (!(await mayEditRelationship(req, r))) return res.status(403).json(NOT_YOURS);
  if (req.audit) req.audit.before(await auditShape("donor_relationships", r, req.user.orgId));
  const undoId = await trashRow("donor_relationships", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));
async function hasHistory(orgId, donorId) {
  const [r] = await query(
    `SELECT (EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=? AND i.donor_id=? AND i.type <> ALL(?::text[])
                       AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%')
          OR EXISTS (SELECT 1 FROM calendar_events c WHERE c.org_id=? AND ? = ANY(c.person_ids))) AS has`,
    [orgId, donorId, NOT_HISTORY_TYPES, orgId, donorId]);
  return !!(r && r.has);
}

// ── ENGAGE-1 — A DONOR'S TWO SCORES ────────────────────────────────────────
// What the profile rail shows: engagement with its band and reason, generosity,
// every part with its points (they add to the score), the explanation from the
// one weights file, and the suggested ask from their own gifts. A donor the
// compute has not reached yet (added a second ago) gets the org computed now.
app.get("/donors/:id/scores", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  let [row] = await query("SELECT * FROM donor_scores WHERE org_id=? AND donor_id=?", [orgId, d.id]);
  if (!row) { await recomputeScoresForOrg(orgId); [row] = await query("SELECT * FROM donor_scores WHERE org_id=? AND donor_id=?", [orgId, d.id]); }
  const W = await engagementMod.weights();
  const parts = (typeof row?.parts === "string" ? JSON.parse(row.parts) : row?.parts) || { engagement: [], generosity: [] };
  const band0 = W.bandFor(row ? row.engagement : 0);
  // FIX-34 · ONE STATUS. A Distant score beside a green "On track" line was two
  // answers on one profile; the band word is the closeness word (PARITY-1:
  // "the band in words"), read on the gifts as they are now.
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const cl = await engagementMod.closenessNow(query, orgId, d.id, today, band0.key);
  const band = cl.key === band0.key ? band0 : { key: cl.key, label: W.CLOSENESS.find(c => c.key === cl.key).label };
  res.json({
    donorId: d.id,
    engagement: row ? row.engagement : 0, generosity: row ? row.generosity : 0,
    // IMPORT-2: no conversation, note or meeting on file. The screen says "No
    // history yet" here, never "0, Distant", which would call a person Steward
    // knows nothing about cold.
    noHistory: !(await hasHistory(orgId, d.id)),
    // FIX-24 2b: "the most recent touch N days ago" said for today, not for the day the scores ran.
    band: band.key, bandLabel: band.label, reason: row ? engagementMod.reasonFor(row, orgToday(await orgTz(orgId))) : null,   // ORG_TZ_SEAM_OK
    computedFor: row ? row.computed_for : null, computedAt: row ? row.computed_at : null,
    parts: {
      engagement: parts.engagement.map(x => ({ ...x, label: W.TOUCH_POINTS[x.key].label, how: W.TOUCH_POINTS[x.key].how, one: W.TOUCH_POINTS[x.key].one, many: W.TOUCH_POINTS[x.key].many,
        source: { key: "donor-engagement-part", params: { donor: d.id, part: x.key } } })),
      generosity: parts.generosity.map(x => ({ ...x, label: W.GENEROSITY_PARTS[x.key].label, how: W.GENEROSITY_PARTS[x.key].how,
        weight: W.GENEROSITY_PARTS[x.key].weight,
        source: { key: "donor-generosity-part", params: { donor: d.id, part: x.key } } })),
    },
    explanation: W.EXPLANATION,
    bands: W.BANDS,
    // PROSPECT-1 — screening results move the ask only for someone who may see them.
    suggestedAsk: await engagementMod.suggestedAsk(query, orgId, d.id,
      (await require("../prospect").canSee(req.user.userId)) ? { screening: (await require("../prospect").latestScreening(orgId, [d.id])).get(d.id) || null } : {}),
  });
}));

// Recompute now (an admin, or a suite that cannot wait for the debounce).
app.post("/scores/recompute", requireAuth, requireAdmin, wrap(async (req, res) => {
  const n = await recomputeScoresForOrg(req.user.orgId);
  req.audit.skip("scores are derived from data already on file");
  res.json({ ok: true, people: n });
}));

// Wealth/capacity scoring is part of the Team major-gifts layer — Core sees a
// stored score read-only (behind glass) but can't compute/recompute it.
app.post("/donors/:id/score", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const result = await calcWealthScore(req.params.id, req.user.orgId);
  if (!result) return res.status(404).json({ error: "Donor not found" });
  res.json(result);
}));

app.get("/donors/:id/fund-affinity", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const donorCheck = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const totalGiving = donorCheck[0].total_giving || 0;

  // Gifts with a fund_id
  const fundGifts = await query(
    `SELECT g.fund_id, COALESCE(f.name,'Unknown Fund') as fund_name,
            COALESCE(f.restricted,false) as restricted,
            COUNT(*) as gift_count, SUM(g.amount) as total,
            MAX(g.date) as last_date
     FROM gifts g
     LEFT JOIN fin_funds f ON f.id=g.fund_id
     WHERE g.donor_id=? AND g.org_id=? AND g.fund_id IS NOT NULL AND g.fund_id != '' AND ${NUMBERS.money.MONEY("g")}
     GROUP BY g.fund_id, f.name, f.restricted
     ORDER BY total DESC`,
    [req.params.id, orgId]
  );

  // Unrestricted (no fund_id)
  const unrestrictedGifts = await query(
    // NUMBERS-4: the fund split is money (shared/numbers/money.js), as Lifetime
    // is, so a soft or matching credit row no longer sits in a fund's share.
    `SELECT COALESCE(SUM(g.amount),0) as total, COUNT(*) as gift_count FROM gifts g WHERE g.donor_id=? AND g.org_id=? AND (g.fund_id IS NULL OR g.fund_id='') AND ${NUMBERS.money.MONEY("g")}`,
    [req.params.id, orgId]
  );
  const unrestrictedTotal = parseFloat(unrestrictedGifts[0]?.total || 0);
  const restrictedTotal = fundGifts.filter(f => f.restricted).reduce((s, f) => s + parseFloat(f.total), 0);

  // Active fin_funds for suggested asks
  const activeFunds = await query("SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name ASC", [orgId]);

  const affinityRows = fundGifts.map(f => ({
    fundId: f.fund_id,
    fundName: f.fund_name,
    restricted: f.restricted,
    total: parseFloat(f.total),
    giftCount: parseInt(f.gift_count),
    lastDate: f.last_date,
    pct: totalGiving > 0 ? Math.round(parseFloat(f.total) / totalGiving * 100) : 0,
  }));

  res.json({
    affinity: affinityRows,
    unrestrictedTotal,
    restrictedTotal,
    totalGiving,
    activeFunds,
  });
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

// ── PARITY-1 Part B — A FILE ON A CONVERSATION OR A NOTE ──────────────────
// interactionFiles.js holds the types, the byte checks and the signed door.
// The bytes go through the asset seam (assetStore.js) under kind 'ixfile'.
// There is NO virus scan (the host offers none): see that module's header and
// docs/decisions/people-and-records.md. (IXF is required with the imports.)

function ixAttachmentRow(r, orgId) {
  return {
    id: r.id, interactionId: r.interaction_id, donorId: r.donor_id,
    fileName: r.filename, mime: r.mime, bytes: Number(r.bytes) || 0,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdByName: r.created_by_name || "",
    interactionType: r.interaction_type || null,
    interactionDate: r.interaction_date ? String(r.interaction_date instanceof Date ? orgTime.civilOf(r.interaction_date) : r.interaction_date).slice(0, 10) : null,
    // Minted PER READ, thirty minutes. A stored URL outlives its reason.
    url: IXF.signFileUrl({ orgId, assetId: r.asset_id }),
  };
}

// POST /interactions/:id/attachments — one file, on an entry that exists.
app.post("/interactions/:id/attachments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [ix] = await query("SELECT id, donor_id FROM interactions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ix || !ix.donor_id) return res.status(404).json({ error: "Interaction not found" });

  const m = /^data:([a-zA-Z0-9.+/-]*);base64,(.+)$/s.exec(String(req.body.file || ""));
  if (!m) return res.status(400).json({ code: "no_file", error: "Attach a file." });
  const mime = IXF.resolveMime(m[1], req.body.fileName);
  if (!IXF.mimeAllowed(mime)) {
    return res.status(400).json({ code: "bad_file_type",
      error: `Steward stores ${IXF.TYPES_SENTENCE}. It refuses anything that can carry a script.` });
  }
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); }
  catch { return res.status(400).json({ code: "no_file", error: "That file could not be read." }); }
  if (!buffer.length) return res.status(400).json({ code: "no_file", error: "That file is empty." });
  if (buffer.length > IXF.FILE_MAX_BYTES) {
    return res.status(400).json({ code: "file_too_large",
      error: `That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, over the ${IXF.FILE_MAX_BYTES / 1024 / 1024} MB limit.` });
  }
  // THE BYTES DECIDE, before anything is stored.
  if (!IXF.bytesMatchMime(buffer, mime)) {
    return res.status(400).json({ code: "file_type_mismatch",
      error: `That file does not look like a ${IXF.extensionFor(mime) || mime}. Check you attached what you meant to.` });
  }
  const asset = await putThemeAsset({ orgId, kind: IXF.FILE_ASSET_KIND, buffer, contentType: mime });
  const id = "iatt_" + uuid().replace(/-/g, "").slice(0, 12);
  const who = actor(req);
  const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [who.id, orgId]);
  await run(
    `INSERT INTO interaction_attachments (id,org_id,interaction_id,donor_id,asset_id,filename,mime,bytes,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, ix.id, ix.donor_id, asset.id, IXF.sanitizeFilename(req.body.fileName, mime), mime, buffer.length,
     who.id, (u && u.name) || who.name]);
  await recordAssetPointerHistory(orgId, "interaction.attachment", id, null, asset.id, req.user);
  const [row] = await query("SELECT * FROM interaction_attachments WHERE id=?", [id]);
  if (req.audit) { req.audit.entity("interaction_attachment", id, row.filename); req.audit.after({ ...row, asset_id: undefined }); }
  res.status(201).json(ixAttachmentRow(row, orgId));
}));

// GET /donors/:id/attachments — every live file on this person's entries,
// newest first. An entry in the trash hides its files until it is restored.
app.get("/donors/:id/attachments", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (!(await orgOwns("donors", req.params.id, orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    `SELECT a.*, i.type AS interaction_type, i.date AS interaction_date
       FROM interaction_attachments a
       JOIN interactions i ON i.id = a.interaction_id AND i.org_id = a.org_id
      WHERE a.org_id=? AND a.donor_id=? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC`, [orgId, req.params.id]);
  const attachments = rows.map(r => ixAttachmentRow(r, orgId));
  const n = attachments.length;
  res.json({ attachments,
    sentence: n ? `${n} ${n === 1 ? "file" : "files"} attached to conversations and notes with this person.`
                : "No files attached to conversations or notes yet." });
}));

// DELETE /interactions/:id/attachments — body { attachmentId }. SOFT: the row
// keeps who attached it and who removed it; the bytes age out of the asset
// store's 90-day retention. Ungated, per the DELETE convention. Whoever logged
// the entry, whoever attached the file, or an admin may remove it.
app.delete("/interactions/:id/attachments", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [ix] = await query("SELECT id, created_by FROM interactions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ix) return res.status(404).json({ error: "Interaction not found" });
  const attId = String((req.body && req.body.attachmentId) || req.query.attachmentId || "");
  const [a] = await query(
    "SELECT * FROM interaction_attachments WHERE id=? AND interaction_id=? AND org_id=? AND deleted_at IS NULL",
    [attId, ix.id, orgId]);
  if (!a) return res.status(404).json({ error: "Attachment not found" });
  if (a.created_by !== req.user.userId && !(await mayEditLogged(req, ix))) return res.status(403).json(NOT_YOURS);
  await run("UPDATE interaction_attachments SET deleted_at=NOW(), deleted_by=? WHERE id=? AND org_id=?",
    [actor(req).id, a.id, orgId]);
  await recordAssetPointerHistory(orgId, "interaction.attachment", a.id, a.asset_id, null, req.user);
  await pruneUnreferencedAssets(orgId, IXF.FILE_ASSET_KIND, []);
  if (req.audit) { req.audit.entity("interaction_attachment", a.id, a.filename); req.audit.before({ ...a, asset_id: undefined }); }
  res.json({ ok: true, id: a.id });
}));

// GET /interaction-files/:id — the signed, expiring, PRIVATE door. No auth
// header (a browser fetches a file with none); the URL carries its signature,
// minted only for signed-in staff of the org, and the org comes from the
// STORED ROW. A removed attachment stops serving even inside its thirty minutes.
// FIX-20 Part 0: and a signed-in user of that org, as /grant-documents.
app.get("/interaction-files/:id", fileLimiter, requireAuth404, wrap(async (req, res) => {
  const id = String(req.params.id || "");
  if (!ASSET_ID_RE.test(id)) return res.status(404).json({ error: "not_found" });
  const [row] = await query(
    `SELECT org_id FROM portal_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL`, [id, IXF.FILE_ASSET_KIND]);
  if (!row || row.org_id !== req.user.orgId) return res.status(404).json({ error: "not_found" });
  const v = IXF.verifyFileUrl({ orgId: row.org_id, assetId: id, e: req.query.e, s: req.query.s });
  if (!v.ok) return res.status(403).json({ error: "link_expired" });
  const [meta] = await query(
    "SELECT filename FROM interaction_attachments WHERE asset_id=? AND org_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [id, row.org_id]);
  if (!meta) return res.status(404).json({ error: "not_found" });
  const asset = await getThemeAsset(id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  res.set("Content-Type", asset.contentType);
  // Never rendered inline in our origin: no scan has looked at these bytes.
  const safeName = IXF.sanitizeFilename(meta.filename, asset.contentType);
  res.set("Content-Disposition", `attachment; filename="${safeName.replace(/"/g, "")}"`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", `private, max-age=${Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))}`);
  res.send(asset.buffer);
}));

// The volunteer's own link — signed, expiring, and it names ONE person in ONE
// org. The signature covers both, so a token cannot be pointed at somebody
// else. It is a link staff hand over; Steward never emails it on its own.
function signVolunteerToken(orgId, personId, exp) {
  const body = `${orgId}.${personId}.${exp}`;
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update("volunteer-log:" + body).digest("base64url");
  return Buffer.from(body).toString("base64url") + "." + sig;
}

// ── PARITY-3 Part 1 · THE VOLUNTEER RECORD ON THE PROFILE ─────────────────
// The hours log, filtered by date range and opportunity; this year and
// lifetime, each opening its rows through the one `volunteer-hours` figure
// source; the opportunities to log against; and the plain glance line
// ("44 hours since 2023, last served May 22"). Hours are read from
// volunteer_shifts and nowhere else.
const VOL_LOG_MAX = 1000;
async function volunteerLog(orgId, personId, q = {}) {
  const where = ["v.org_id=?", "v.person_id=?"], args = [orgId, personId];
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  if (ok(q.from)) { where.push("v.date >= ?"); args.push(String(q.from)); }
  if (ok(q.to)) { where.push("v.date <= ?"); args.push(String(q.to)); }
  if (q.opportunityId) { where.push("v.opportunity_id = ?"); args.push(String(q.opportunityId)); }
  return query(
    `SELECT v.id, v.date, v.hours, v.role, v.note, v.via, v.created_at, v.updated_at,
            COALESCE(u.name, v.created_by_name) AS created_by_name,
            v.opportunity_id, v.slot_id, v.start_time, v.end_time, o.name AS opportunity_name
       FROM volunteer_shifts v LEFT JOIN volunteer_opportunities o ON o.id=v.opportunity_id AND o.org_id=v.org_id
       LEFT JOIN users u ON u.id = v.created_by AND u.org_id = v.org_id
      WHERE ${where.join(" AND ")} ORDER BY v.date DESC NULLS LAST, v.created_at DESC LIMIT ${VOL_LOG_MAX}`, args);
}
const VIA_WORD = { staff: "Staff", self: "The volunteer, from their own link", import: "An import" };

app.get("/donors/:id/volunteer-hours", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const shifts = await volunteerLog(orgId, d.id, req.query || {});
  // VOL-1 — the shifts they are SIGNED UP FOR, beside the hours they have
  // already given. The record answers both questions a person opening it
  // asks: what have they done, and when will I see them next.
  const upcoming = await query(
    `SELECT s.date, s.start_time, s.end_time, COALESCE(s.name, o.name) AS opp_name, su.status
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id
      WHERE su.org_id=? AND su.person_id=? AND su.status IN ('confirmed','waitlisted')
        AND s.cancelled_at IS NULL AND s.date >= ?
      ORDER BY s.date, s.start_time LIMIT 6`, [orgId, d.id, today]).catch(() => []);
  const sum = await volunteerSummary(orgId, d.id);
  const [yr] = await query(`SELECT COALESCE(SUM(ROUND(hours*100)),0)::bigint AS h FROM volunteer_shifts WHERE org_id=? AND person_id=? AND date >= ? AND date <= ?`,
    [orgId, d.id, today.slice(0, 4) + "-01-01", today]);
  const opps = await query(`SELECT id, name FROM volunteer_opportunities WHERE org_id=? AND archived_at IS NULL ORDER BY name`, [orgId]);
  const lifeFrom = "1900-01-01", lifeTo = "2999-12-31";
  const first = sum.firstShift ? String(sum.firstShift).slice(0, 10) : null, last = sum.lastShift ? String(sum.lastShift).slice(0, 10) : null;
  const dd = iso => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))); return t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + (iso.slice(0, 4) !== today.slice(0, 4) ? `, ${iso.slice(0, 4)}` : ""); };
  res.json({ ...sum,
    sentence: "Every shift logged for this person, by staff at check-in or by hand, by the volunteer from their link, or from an import.",
    thisYear: { hours: Number(yr.h || 0) / 100, label: `Hours in ${today.slice(0, 4)}`,
      sentence: `Every volunteer shift dated January 1 to today, ${today.slice(0, 4)}, added up.`,
      source: { key: "volunteer-hours", params: { from: today.slice(0, 4) + "-01-01", to: today, donor: d.id } } },
    lifetime: { hours: sum.totalHours, label: "Hours in all",
      sentence: "Every volunteer shift ever logged for this person, added up.",
      source: { key: "volunteer-hours", params: { from: lifeFrom, to: lifeTo, donor: d.id } } },
    glanceLine: sum.shiftCount ? `${sum.totalHours} ${sum.totalHours === 1 ? "hour" : "hours"} since ${first.slice(0, 4)}, last served ${dd(last)}` : null,
    opportunities: opps,
    upcoming: upcoming.map(u => ({
      when: `${u.opp_name}, ${u.date}${u.status === "waitlisted" ? " (waiting list)" : ""}`,
      date: u.date, status: u.status })),
    filtered: !!(req.query.from || req.query.to || req.query.opportunityId),
    shifts: shifts.map(s => ({ id: s.id, date: s.date, hours: Number(s.hours), role: s.role, note: s.note,
      opportunityId: s.opportunity_id || null, opportunityName: s.opportunity_name || null, slotId: s.slot_id || null,
      startTime: s.start_time || null, endTime: s.end_time || null,
      enteredAt: s.created_at, enteredBy: s.created_by_name || VIA_WORD[s.via] || "", via: s.via, editedAt: s.updated_at || null })) });
}));

// The same filtered log, as a file.
app.get("/donors/:id/volunteer-hours.csv", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const rows = await volunteerLog(orgId, d.id, req.query || {});
  const cell = v => { const t = v == null ? "" : String(v); const g = /^[=+\-@]/.test(t) ? "'" + t : t; return /[",\n\r]/.test(g) || g !== t ? `"${g.replace(/"/g, '""')}"` : g; };
  const lines = [["Person", "Opportunity", "Date", "Hours", "Start", "End", "Entered", "Entered by", "Notes"].join(",")];
  for (const r of rows) lines.push([d.name, r.opportunity_name || r.role || "", r.date, Number(r.hours), r.start_time || "", r.end_time || "",
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ") : "", r.created_by_name || VIA_WORD[r.via] || "", r.note || ""].map(cell).join(","));
  const total = rows.reduce((a, r) => a + Math.round(Number(r.hours) * 100), 0) / 100;
  lines.push(["Total", "", "", total, "", "", "", "", ""].map(cell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="volunteer-hours.csv"`);
  res.send(lines.join("\r\n") + "\r\n");
}));

app.post("/donors/:id/volunteer-hours", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const b = req.body || {};
  let opp = null;
  if (b.opportunityId) {
    [opp] = await query("SELECT id, name FROM volunteer_opportunities WHERE id=? AND org_id=?", [String(b.opportunityId), orgId]);
    if (!opp) return res.status(404).json({ error: "That opportunity is not one of yours." });
  }
  const v = VH.validateShift({ ...b, role: b.role || (opp && opp.name) || null });
  if (!v.ok) return res.status(400).json({ error: `A shift needs ${v.errors.join("; ")}.` });
  const id = await insertShift(orgId, d.id, { ...v.shift, opportunityId: opp ? opp.id : null }, { via: "staff", who: actor(req) });
  res.status(201).json({ id, ...(await volunteerSummary(orgId, d.id)) });
}));

// What a volunteer is qualified for and what they told you: tags, skills and
// certifications; the background check and waiver with their state and
// expiry; the answers on their application; and the coordinator's notes,
// internal and the ones the volunteer can see, kept apart.
app.get("/donors/:id/volunteer-profile", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const VS = await import("../shared/volunteerShifts.js");
  const quals = await query(`SELECT id, kind, name, expires_on, created_by_name, created_at FROM volunteer_qualifications
                              WHERE org_id=? AND person_id=? ORDER BY kind, lower(name)`, [orgId, d.id]);
  const creds = await query(`SELECT DISTINCT ON (kind) kind, signed_on, expires_on, reference FROM volunteer_credentials
                              WHERE org_id=? AND person_id=? AND superseded_at IS NULL ORDER BY kind, signed_on DESC`, [orgId, d.id]);
  const apps = await query(`SELECT id, status, answers, availability, submitted_at, decided_at, decided_by_name, hours_per_week, roles, via FROM volunteer_applications
                             WHERE org_id=? AND person_id=? ORDER BY submitted_at DESC LIMIT 5`, [orgId, d.id]).catch(() => []);
  const notes = await query(`SELECT id, kind, body, note_date, visibility, created_by_name, created_at FROM volunteer_notes
                              WHERE org_id=? AND person_id=? ORDER BY created_at DESC LIMIT 100`, [orgId, d.id]);
  const parse = v => { try { return typeof v === "string" ? JSON.parse(v) : (v || null); } catch { return null; } };
  res.json({
    qualifications: quals.map(q => ({ id: q.id, kind: q.kind, name: q.name, expiresOn: q.expires_on || null,
      expired: !!(q.expires_on && q.expires_on < today), addedBy: q.created_by_name || "" })),
    credentials: creds.map(c => ({ kind: c.kind, signedOn: c.signed_on, expiresOn: c.expires_on || null, reference: c.reference || null,
      ...VS.credentialState({ kind: c.kind, signedOn: c.signed_on, expiresOn: c.expires_on }, today) })),
    applications: apps.map(a => ({ id: a.id, status: a.status, answers: parse(a.answers) || [], availability: parse(a.availability) || [],
      submittedAt: a.submitted_at, decidedAt: a.decided_at, decidedBy: a.decided_by_name || "",
      hoursPerWeek: a.hours_per_week != null ? Number(a.hours_per_week) : null, roles: parse(a.roles) || [], via: a.via || "page" })),
    // FIX-24 Part 1: their volunteer record (makeVolunteer): the approved
    // application, or null when they have none and are not on Volunteers yet.
    record: (() => { const a = apps.find(x => x.status === "approved"); return a ? { id: a.id,
      hoursPerWeek: a.hours_per_week != null ? Number(a.hours_per_week) : null, availability: parse(a.availability) || [],
      roles: parse(a.roles) || [], via: a.via || "page", since: a.decided_at } : null; })(),
    notes: notes.map(n => ({ id: n.id, kind: n.kind, body: n.body, date: n.note_date, visibility: n.visibility || "internal",
      by: n.created_by_name || "", at: n.created_at })),
    sentences: {
      qualifications: "Skills, certifications and tags you keep for this volunteer. A certification can carry the date it runs out.",
      notes: "Internal notes are for staff only. A note marked for the volunteer shows on their own page.",
    },
  });
}));

app.post("/donors/:id/volunteer-qualifications", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const kind = String(req.body?.kind || ""), name = String(req.body?.name || "").trim().slice(0, 80);
  const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.expiresOn || "")) ? String(req.body.expiresOn) : null;
  if (!["skill", "certification", "tag"].includes(kind)) return res.status(400).json({ error: "That is a skill, a certification or a tag." });
  if (!name) return res.status(400).json({ error: "Give it a name." });
  const id = "vq_" + uuid().slice(0, 10);
  const r = await query(`INSERT INTO volunteer_qualifications (id,org_id,person_id,kind,name,expires_on,created_by,created_by_name)
                         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`, [id, orgId, d.id, kind, name, kind === "certification" ? expiresOn : null, who.id, who.name]);
  if (!r.length) return res.status(409).json({ error: `They already have ${name}.` });
  res.status(201).json({ id });
}));
app.delete("/volunteer-qualifications/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM volunteer_qualifications WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// The link staff hand to a volunteer so they can log their own hours.
app.post("/donors/:id/volunteer-link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const exp = Date.now() + VH.SELF_LOG_DAYS * 86400000;
  res.json({ url: `${publicAppUrl()}/volunteer/log?token=${signVolunteerToken(req.user.orgId, d.id, exp)}`,
    expiresInDays: VH.SELF_LOG_DAYS,
    sentence: `Anyone with this link can log hours for this person for the next ${VH.SELF_LOG_DAYS} days. Steward does not send it; you do.` });
}));
// ── INT-5 · THE KEY WALL, THE RATE LIMIT AND THE CALL LOG ─────────────────
// One place, because all three are about the same request and separating them
// is how a call gets rate-limited but not logged, or logged but not scoped.
const apiScopesMod = () => import("../shared/apiScopes.js");
// Per-key, one minute wide. Per KEY rather than per org so one noisy
// integration cannot starve another. SCALE-1: counted in Postgres (one upsert,
// rateLimitStore.js), because a count in this process's memory is a count per
// replica, and a second replica would double every key's allowance.
async function apiRateHit(keyId, perMinute) {
  const r = await require("../rateLimitStore").hit("apiKey", keyId, 60000);
  if (r.totalHits > perMinute) return { ok: false, retryAfter: Math.max(1, Math.ceil((r.resetTime.getTime() - Date.now()) / 1000)) };
  return { ok: true };
}

/**
 * THE CALL LOG WRITES ON THE WAY OUT, WHATEVER HAPPENED.
 *
 * Hooked to the response rather than called at each return, because a log that
 * has to be remembered at twenty return statements is a log that is missing the
 * twenty-first — and the refusals are the rows somebody debugging most needs.
 */
function logApiCall(req, res, { keyId, orgId, scope }) {
  const started = Date.now();
  res.on("finish", () => {
    run(`INSERT INTO api_call_log (id,org_id,key_id,method,path,status,scope_required,entity_id,ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ["acl_" + uuid().slice(0, 12), orgId, keyId || null, req.method,
       // The ROUTE, not the filled path: a log of "/api/v1/people/d_abc123"
       // is a list of donor ids in a table nobody guards. The id, when it
       // matters, is its own column.
       String(req.route?.path || req.path || "").slice(0, 200),
       res.statusCode, scope || null,
       String(req.params?.id || "").slice(0, 64) || null,
       Date.now() - started]).catch(() => {});
  });
}

async function requireApiKey(req, res, next) {
  try {
    const raw = String(req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim();
    const refuse = () => res.status(401).json({ error: "invalid_api_key", message: "That API key is not valid." });
    if (!raw.startsWith(API_KEY_PREFIX) || raw.length < 20) return refuse();
    const [k] = await query(`SELECT id, org_id, name, scopes, last_used_at FROM api_keys WHERE key_hash=? AND revoked_at IS NULL`, [hashApiKey(raw)]);
    if (!k) return refuse();
    const S = await apiScopesMod();
    const stored = Array.isArray(k.scopes) ? k.scopes : ["read"];
    req.apiKey = { id: k.id, orgId: k.org_id, name: k.name,
                   scopes: S.effectiveScopes(stored), stored };
    logApiCall(req, res, { keyId: k.id, orgId: k.org_id, scope: req.requiredScope });
    const hit = await apiRateHit(k.id, S.RATE_LIMIT_PER_MINUTE);
    if (!hit.ok) {
      res.set("Retry-After", String(hit.retryAfter));
      return res.status(429).json(S.rateLimitBody(hit.retryAfter));
    }
    // Stamp use at most once a minute — a busy integration must not turn
    // every read into a write.
    if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60000)
      run(`UPDATE api_keys SET last_used_at=NOW() WHERE id=?`, [k.id]).catch(() => {});
    next();
  } catch (e) { next(e); }
}

/**
 * THE SCOPE WALL. `requireScope("write:gifts")` after `requireApiKey`.
 *
 * It fails CLOSED on an unknown scope name, so a typo in a route definition
 * refuses every call rather than allowing every call, which is the direction a
 * mistake here has to fail in.
 */
function requireScope(needed) {
  return async function (req, res, next) {
    req.requiredScope = needed;
    const S = await apiScopesMod();
    if (!req.apiKey) return res.status(401).json({ error: "invalid_api_key", message: "That API key is not valid." });
    if (!S.allows(req.apiKey.stored, needed)) return res.status(403).json(S.refusalFor(needed));
    next();
  };
}

// ── Staff side: make, list and revoke keys (admin only) ────────────────────
app.get("/api-keys", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await query(`SELECT id, name, prefix, scopes, created_by_name, created_at, last_used_at, revoked_at
                              FROM api_keys WHERE org_id=? ORDER BY created_at DESC`, [req.user.orgId]);
  res.json({ keys: rows.map(r => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, createdBy: r.created_by_name,
    createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at })) });
}));
app.post("/api-keys", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const S = await apiScopesMod();
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Give the key a name, so you can tell it apart later (for example, Zapier)." });
  // INT-5 — SCOPES ARE CHOSEN, NEVER DEFAULTED TO EVERYTHING. A caller that
  // sends none gets the read set, which is what every key issued before this
  // build already had: the default may narrow over time, never widen.
  const asked = req.body?.scopes === undefined ? S.READ_SCOPES : req.body.scopes;
  const v = S.validateScopes(asked);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const secret = API_KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
  const prefix = secret.slice(0, 10);
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  const id = "ak_" + uuid().slice(0, 12);
  await run(`INSERT INTO api_keys (id,org_id,name,prefix,key_hash,scopes,created_by,created_by_name) VALUES (?,?,?,?,?,?::jsonb,?,?)`,
    [id, req.user.orgId, name, prefix, hashApiKey(secret), JSON.stringify(v.value), who.id, me?.name || who.name]);
  await writeAuditLog(req.user.orgId, who.id, me?.name || who.name, "api_key_created", "api_key", id,
    { scopes: v.value }).catch(() => {});
  res.json({ id, name, prefix, scopes: v.value, key: secret,
    sentence: "This is the only time the whole key is shown. Copy it now; Steward keeps only a fingerprint of it." });
}));

// WHAT A KEY MAY BE GIVEN, for the screen that makes one.
app.get("/api-keys/scopes", requireAuth, requireAdmin, wrap(async (req, res) => {
  const S = await apiScopesMod();
  res.json({
    scopes: S.SCOPE_KEYS.map(k => S.SCOPES[k]),
    defaults: S.READ_SCOPES,
    rateLimitSentence: S.RATE_LIMIT_SENTENCE,
    callLogSentence: S.CALL_LOG_SENTENCE,
    legacySentence: "A key made before permissions existed can read everything it always could, and cannot write. Make a new key to grant writing.",
  });
}));

// THE CALL LOG FOR ONE KEY. Thirty days, ids only.
app.get("/api-keys/:id/calls", requireAuth, requireAdmin, wrap(async (req, res) => {
  const S = await apiScopesMod();
  const [k] = await query(`SELECT id, name FROM api_keys WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!k) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT method, path, status, scope_required, entity_id, ms, created_at
       FROM api_call_log WHERE key_id=? AND org_id=? AND created_at > NOW() - INTERVAL '${S.CALL_LOG_DAYS} days'
      ORDER BY created_at DESC LIMIT 200`, [req.params.id, req.user.orgId]);
  res.json({
    key: { id: k.id, name: k.name },
    calls: rows.map(r => ({
      method: r.method, path: r.path, status: r.status, at: r.created_at, ms: r.ms,
      entityId: r.entity_id || null,
      sentence: S.statusSentence(r.status, r.scope_required),
    })),
    definition: S.CALL_LOG_SENTENCE,
  });
}));
// Revoking is never write-gated: a lapsed org must always be able to shut a door.
app.delete("/api-keys/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const r = await query(`UPDATE api_keys SET revoked_at=COALESCE(revoked_at, NOW()) WHERE id=? AND org_id=? RETURNING id`, [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// ── FIX-11 Part 1 — THE AUDIT LOG SCREEN'S ROUTES ─────────────────────────
// One read for the whole organisation's history, newest first, and one CSV of
// the same rows. The old /finance/audit-log stays where it is and keeps the
// Finance tab working; it is the same table, filtered to nothing in
// particular, and this is the screen that covers everything.
//
// OWNERS AND ADMINS ONLY, and that is a boundary rather than a preference: the
// log names who signed in, whose role changed and who downloaded a donor file.
// Showing it to everybody would turn an accountability record into a
// surveillance feed.
const AUDIT_COLS = `id, created_at, user_id, user_name, actor_kind, action, entity_type, entity_id,
  entity_label, summary, record_count, request_method, request_path, status_code, changes,
  before_fields, after_fields`;

// What the log covers, in one sentence, at the top of the screen. It lives
// here so the screen, the CSV header and anything printed later say the same
// thing: every number has a sentence, and so does a history.
const AUDIT_COVERAGE = "Every change anyone makes in Steward: gifts, pledges and refunds; donors, "
  + "people and merges; receipts and emails sent; funds, campaigns and pages; events, volunteers and "
  + "shifts; imports and undos; downloads of donor data; users, roles and sign-ins; connections, API "
  + "keys and settings; and every action an agent took and who approved it. Rows cannot be edited or "
  + "removed, and they are kept for at least seven years.";

async function auditQuery(req, q0 = req.query) {
  const { actor, entityType, action, from, to, q: search } = q0;
  const limit = Math.max(1, Math.min(2000, parseInt(q0.limit, 10) || 200));
  const offset = Math.max(0, parseInt(q0.offset, 10) || 0);
  let sql = `SELECT ${AUDIT_COLS} FROM fin_audit_log WHERE org_id = ?`;
  const params = [req.user.orgId];
  // FIX-12 Part 4: rows from FIX-12 on carry the actor's id, not a name, so a
  // name chosen in the filter also matches the ids of the people it names.
  if (actor) {
    sql += " AND (user_id = ? OR user_name = ? OR user_id IN (SELECT id FROM users WHERE org_id = ? AND (name = ? OR email = ?)))";
    params.push(actor, actor, req.user.orgId, actor, actor);
  }
  if (entityType) { sql += " AND entity_type = ?"; params.push(entityType); }
  if (action) { sql += " AND action = ?"; params.push(action); }
  // FIX-14 Part 2 — BY PERSON OR BY RECORD. A person is everything about
  // them: their own record, and every conversation, step, task and gift that
  // carries their id. A record is one entity id exactly.
  if (q0.person) {
    sql += ` AND (entity_id = ? OR after_fields->>'donor_id' = ? OR before_fields->>'donor_id' = ?
                  OR changes->'record'->>'donor_id' = ?)`;
    const pid = String(q0.person);
    params.push(pid, pid, pid, pid);
  }
  if (q0.record) { sql += " AND entity_id = ?"; params.push(String(q0.record)); }
  if (from) { sql += ` AND ${inOrgDays("created_at", "org_id", "?", null)}`; params.push(from); }
  // `to` is inclusive of the whole day somebody typed, which is what a person
  // filtering "up to the 30th" means. An exclusive bound silently drops that
  // day's rows and reads as a missing record.
  if (to) { sql += ` AND ${inOrgDays("created_at", "org_id", null, "?")}`; params.push(to); }
  // SEARCH BY DONOR NAME is the one a fundraiser actually needs, so it matches
  // the label the row carries (the donor's name) as well as the person who
  // acted and the record id, rather than making her know which field it is in.
  if (search && String(search).trim()) {
    sql += ` AND (entity_label ILIKE ? OR user_name ILIKE ? OR entity_id = ? OR summary ILIKE ?
                  OR after_fields::text ILIKE ? OR before_fields::text ILIKE ?
                  OR entity_id IN (SELECT id FROM donors WHERE org_id = ? AND erased_at IS NULL AND name ILIKE ?)
                  OR user_id IN (SELECT id FROM users WHERE org_id = ? AND (name ILIKE ? OR email ILIKE ?)))`;
    const like = "%" + String(search).trim() + "%";
    params.push(like, like, String(search).trim(), like, like, like, req.user.orgId, like, req.user.orgId, like, like);
  }
  sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return auditMw.resolveAuditNames(await query(sql, params), req.user.orgId);
}

// Which record a row opens. A voided gift and a deleted donor still open,
// read-only, because the row whose history this is may well be the one
// somebody is trying to account for.
function auditRecordLink(r) {
  const t = String(r.entity_type || "");
  const id = r.entity_id;
  if (!id) return null;
  // FIX-14 Part 2: a conversation, next step or task opens the person it is about.
  const donorId = auditTrailMod.auditDonorId({ ...r, changes: auditJson(r.changes, {}),
    before: auditJson(r.before_fields, null), after: auditJson(r.after_fields, null) });
  if (/^(interaction|conversation|touchpoint|thread|next step|task|relationship|donor relationship|pledge|proposal)$/.test(t) && donorId) {
    return { tab: "donors", donorId };
  }
  if (/^user_/.test(String(id))) return { tab: "settings", section: "team" };
  if (/^(donor|person|people|organisation|organization|stage)$/.test(t)) return { tab: "donors", donorId: id };
  if (/^(gift|pledge|receipt|refund|soft credit)$/.test(t)) return { tab: "donors", giftId: id };
  if (/^(user|invite|role)$/.test(t)) return { tab: "settings", section: "team" };
  if (/^(fund|account|transaction|budget)$/.test(t)) return { tab: "finance", recordId: id };
  if (/^(campaign|appeal|giving page|form|widget)$/.test(t)) return { tab: "fundraising", recordId: id };
  if (/^(event|ticket|guest|table|seat)$/.test(t)) return { tab: "events", recordId: id };
  if (/^(volunteer|shift|hour|waiver)$/.test(t)) return { tab: "volunteers", recordId: id };
  if (/^(grant|funder|milestone)$/.test(t)) return { tab: "grants", recordId: id };
  if (/^(import|export)$/.test(t)) return { tab: "settings", section: "imports" };
  if (/^(connection|api key|webhook|mailbox)$/.test(t)) return { tab: "settings", section: "connections" };
  return { tab: "settings", section: "audit", recordId: id };
}

function auditJson(v, dflt) {
  if (typeof v === "string") { try { return JSON.parse(v || "null") ?? dflt; } catch { return dflt; } }
  return v || dflt;
}
const auditRowOut = (r, people) => {
  const o = {
    ...r,
    changes: auditJson(r.changes, {}),
    before: auditJson(r.before_fields, null),
    after: auditJson(r.after_fields, null),
    sentence: auditTrailMod.rowSentence(r),
    link: auditRecordLink(r),
  };
  // FIX-14 Part 2: the Description, in a plain sentence. Never a dash.
  o.description = auditTrailMod.describeAuditRow(o, { people: people || new Map() });
  o.record_name = auditTrailMod.auditRecordName(o, { people: people || new Map() });
  return o;
};
// The names the sentences need, read live (FIX-12: the row holds ids). An
// erased person reads "Erased person", as everywhere else in the log.
async function auditPeople(rows, orgId) {
  const ids = new Set();
  for (const r of rows) {
    // FIX-14 Part 2b: both sides of a relationship and a household's members too.
    for (const id of auditTrailMod.auditPeopleIds({ ...r, changes: auditJson(r.changes, {}),
      before: auditJson(r.before_fields, null), after: auditJson(r.after_fields, null) })) ids.add(String(id));
  }
  const people = new Map();
  if (ids.size) {
    const ds = await query("SELECT id, name, erased_at FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, [...ids]]).catch(() => []);
    for (const d of ds) people.set(d.id, d.erased_at ? "Erased person" : (d.name || "a person with no name"));
  }
  // FIX-14 Part 2b: a household's name, live, or as it was when it was deleted.
  const hhIds = [...new Set(rows.filter(r => r.entity_type === "household" && r.entity_id).map(r => String(r.entity_id)))];
  if (hhIds.length) {
    const hs = await query(
      `SELECT id, name FROM households WHERE org_id=? AND id = ANY(?)
       UNION ALL SELECT record_id, row_data->>'name' FROM deleted_records WHERE org_id=? AND table_name='households' AND record_id = ANY(?)`,
      [orgId, hhIds, orgId, hhIds]).catch(() => []);
    for (const h of hs) if (h.name && !people.has("hh:" + h.id)) people.set("hh:" + h.id, h.name);
  }
  return people;
}
async function auditDescribe(rows, orgId) {
  const people = await auditPeople(rows, orgId);
  return rows.map(r => auditRowOut(r, people));
}

app.get("/audit/log", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditQuery(req);
  // The filter choices come from the rows that exist, so a dropdown never
  // offers a type this organisation has never produced.
  const [facets] = await query(
    `SELECT
       (SELECT COALESCE(JSON_AGG(DISTINCT entity_type), '[]') FROM fin_audit_log WHERE org_id=? AND entity_type IS NOT NULL) AS types,
       (SELECT COALESCE(JSON_AGG(DISTINCT action),      '[]') FROM fin_audit_log WHERE org_id=? AND action IS NOT NULL) AS actions,
       (SELECT COALESCE(JSON_AGG(DISTINCT n), '[]') FROM (
          SELECT user_name AS n FROM fin_audit_log WHERE org_id=? AND user_name IS NOT NULL
          UNION SELECT COALESCE(u.name, u.email) FROM users u
           WHERE u.org_id=? AND u.id IN (SELECT user_id FROM fin_audit_log WHERE org_id=? AND user_name IS NULL)) x) AS actors`,
    [req.user.orgId, req.user.orgId, req.user.orgId, req.user.orgId, req.user.orgId]);
  res.json({
    coverage: AUDIT_COVERAGE,
    // Times are shown in the organisation's zone, and the zone is named.
    timezone: await orgTzName(req.user.orgId),
    rows: await auditDescribe(rows, req.user.orgId),
    facets: {
      entityTypes: (facets?.types || []).filter(Boolean).sort(),
      actions: (facets?.actions || []).filter(Boolean).sort(),
      actors: (facets?.actors || []).filter(Boolean).sort(),
    },
  });
}));

// ONE ROW of history, for the "what changed?" panel. Scoped to the org like
// everything else.
app.get("/audit/log/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditMw.resolveAuditNames(await query(`SELECT ${AUDIT_COLS} FROM fin_audit_log WHERE id=? AND org_id=?`,
    [req.params.id, req.user.orgId]), req.user.orgId);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json((await auditDescribe(rows, req.user.orgId))[0]);
}));

// FIX-14 Part 2 — ONE PERSON'S HISTORY, on their profile: every audit row
// about them (their record, and every conversation, step, task and gift that
// carries their id), newest first. Open to anyone who can open the profile,
// because it shows only what happened to this one record.
app.get("/donors/:id/history", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await auditQuery(req, { person: req.params.id, limit: req.query.limit || 200 });
  res.json({ timezone: await orgTzName(req.user.orgId), rows: await auditDescribe(rows, req.user.orgId) });
}));

// The export of the log is itself a download of who-did-what, so it is logged
// like any other download: the middleware sees Content-Disposition and writes
// the row. Nothing here calls the audit layer by hand.
app.get("/audit/log.csv", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditQuery(req);
  const cell = v => {
    const s = v === null || v === undefined ? ""
      : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const people = await auditPeople(rows, req.user.orgId);
  const head = ["When", "Who", "In what capacity", "Description", "Action", "Record type", "Record",
                "Record id", "What changed (before)", "What changed (after)", "Summary",
                "Records touched", "Request", "Result"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const o = auditRowOut(r, people);
    lines.push([
      new Date(r.created_at).toISOString(), r.user_name || "System", r.actor_kind || "", o.description,
      r.action || "", r.entity_type || "", r.entity_label || "", r.entity_id || "",
      o.before, o.after, r.summary || "", r.record_count == null ? "" : r.record_count,
      `${r.request_method || ""} ${r.request_path || ""}`.trim(), r.status_code == null ? "" : r.status_code,
    ].map(cell).join(","));
  }
  const name = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send("﻿" + lines.join("\n") + "\n");
}));

// ── Key side: /api/v1, read only ───────────────────────────────────────────
const apiPage = q => ({ limit: Math.max(1, Math.min(100, parseInt(q.limit, 10) || 50)), offset: Math.max(0, parseInt(q.offset, 10) || 0) });
const apiPerson = d => ({
  id: d.id, name: d.name, email: d.email || null, phone: d.phone || null,
  city: d.city || null, state: d.state || null, zip: d.zip || null,
  types: Array.isArray(d.person_types) ? d.person_types : ["donor"],
  lifetimeGiving: Number(d.total_giving || 0), giftCount: Number(d.gift_count || 0),
  lastGiftDate: d.last_gift_date || null, stage: d.stage || null,
  wealthScreen: d.wealth_screen_source ? { source: d.wealth_screen_source, rating: d.wealth_screen_rating || null,
    capacity: d.wealth_screen_capacity || null, date: d.wealth_screen_date || null } : null,
  sample: !!d.is_sample, createdAt: d.created_at,
});
const API_PERSON_COLS = `id,name,email,phone,city,state,zip,person_types,total_giving,gift_count,last_gift_date,stage,
  wealth_screen_source,wealth_screen_rating,wealth_screen_capacity,wealth_screen_date,is_sample,created_at`;
// `/me` needs no scope: it is how a caller finds out what their key may do,
// and a key that cannot ask that has no way to discover it has been narrowed.
app.get("/api/v1/me", apiLimiter, requireApiKey, wrap(async (req, res) => {
  const [o] = await query(`SELECT name FROM orgs WHERE id=?`, [req.apiKey.orgId]);
  res.json({ organization: o?.name || null, key: req.apiKey.name, scopes: req.apiKey.scopes });
}));
app.get("/api/v1/people", apiLimiter, requireApiKey, requireScope("read:people"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE org_id=? AND deleted_at IS NULL
                             ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(apiPerson), limit, offset });
}));
app.get("/api/v1/people/:id", apiLimiter, requireApiKey, requireScope("read:people"), wrap(async (req, res) => {
  const [d] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, req.apiKey.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json({ data: apiPerson(d) });
}));
app.get("/api/v1/gifts", apiLimiter, requireApiKey, requireScope("read:gifts"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(
    `SELECT g.id, g.donor_id, g.amount, g.date, g.type, g.payment_method, g.created_at, g.is_sample,
            f.name AS fund_name, COALESCE(c.name, g.campaign) AS campaign_name
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.deleted_at IS NULL
       LEFT JOIN fin_funds f ON f.id=g.fund_id AND f.org_id=g.org_id
       LEFT JOIN campaigns c ON c.id=g.campaign_id AND c.org_id=g.org_id
      WHERE g.org_id=? ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?`, [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(g => ({ id: g.id, personId: g.donor_id, amount: Number(g.amount), date: g.date, type: g.type || null,
    paymentMethod: g.payment_method || null, fund: g.fund_name || null, campaign: g.campaign_name || null,
    sample: !!g.is_sample, createdAt: g.created_at })), limit, offset });
}));
// FIX-13: THE FUNDS A GIFT CAN GO TO, so an integration can offer a list of
// names instead of asking for an id somebody has to go and find (the Zapier
// fund dropdown). Id and name only, this org only, behind its own read scope.
app.get("/api/v1/funds", apiLimiter, requireApiKey, requireScope("read:funds"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(`SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`,
    [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(f => ({ id: f.id, name: f.name })), limit, offset });
}));

// ── INT-5 · WEBHOOKS OUT ──────────────────────────────────────────────────
//
// Steward telling somebody else that something happened. Signed with a
// per-endpoint secret and a timestamp, retried with backoff for a day, and
// every ATTEMPT kept so "it failed four times and then worked" is visible.
const webhookMod = () => import("../shared/webhookOut.js");

app.get("/webhooks", requireAuth, requireAdmin, wrap(async (req, res) => {
  const W = await webhookMod();
  const rows = await query(
    `SELECT id,url,description,events,paused_at,consecutive_failures,last_delivered_at,last_status,created_at
       FROM webhook_endpoints WHERE org_id=? ORDER BY created_at DESC`, [req.user.orgId]);
  res.json({
    endpoints: rows.map(r => ({
      id: r.id, url: r.url, description: r.description,
      events: Array.isArray(r.events) ? r.events : [],
      paused: !!r.paused_at, consecutiveFailures: r.consecutive_failures || 0,
      lastDeliveredAt: r.last_delivered_at, lastStatus: r.last_status, createdAt: r.created_at,
      sentence: r.paused_at
        ? W.pauseSentence(r.url, r.consecutive_failures || 0)
        : r.last_delivered_at ? `Delivering. Last answered ${r.last_status}.`
        : "Added. Nothing has been sent to it yet.",
    })),
    // The secret is NEVER returned after creation, not even to an admin: it is
    // shown once, exactly like an API key, because a secret a screen can
    // re-display is a secret in every screenshot and support ticket.
    events: W.EVENT_KEYS.map(k => W.EVENTS[k]),
    verifySnippet: W.VERIFY_SNIPPET,
    signatureHeader: W.SIGNATURE_HEADER,
    definition: "Where Steward should post when something happens here. Each delivery is signed with that endpoint's own secret and a timestamp, and retried for a day if it fails.",
  });
}));

app.post("/webhooks", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const W = await webhookMod();
  const v = W.validateEndpoint(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const id = "whe_" + uuid().slice(0, 12);
  const secret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  const who = actor(req);
  await run(
    `INSERT INTO webhook_endpoints (id,org_id,url,description,events,secret,created_by,created_by_name)
     VALUES (?,?,?,?,?::jsonb,?,?,?)`,
    [id, req.user.orgId, v.value.url, v.value.description, JSON.stringify(v.value.events), secret, who.id, who.name]);
  await writeAuditLog(req.user.orgId, who.id, who.name, "webhook_endpoint_created", "webhook", id,
    { url: v.value.url, events: v.value.events }).catch(() => {});
  res.status(201).json({ id, url: v.value.url, events: v.value.events, secret,
    sentence: "This is the only time the signing secret is shown. Copy it now: Steward signs every delivery with it, and cannot show it again." });
}));

app.delete("/webhooks/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const r = await run(`DELETE FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, sentence: "Removed. Steward will not post there again, and its delivery history has gone with it." });
}));

// Turning a paused endpoint back on, and resending what is still waiting.
app.post("/webhooks/:id/resume", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [e] = await query(`SELECT id FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!e) return res.status(404).json({ error: "Not found" });
  await run(`UPDATE webhook_endpoints SET paused_at=NULL, consecutive_failures=0, updated_at=NOW() WHERE id=?`, [e.id]);
  const r = await run(
    `UPDATE webhook_deliveries SET next_attempt_at=NOW(), gave_up_at=NULL
      WHERE endpoint_id=? AND delivered_at IS NULL`, [e.id]);
  res.json({ ok: true, requeued: (r && r.changes) || 0,
    sentence: "Back on. Anything that was still waiting will be tried again within the minute." });
}));

// THE DELIVERY LOG, every attempt.
app.get("/webhooks/:id/deliveries", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [e] = await query(`SELECT id, url FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!e) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT id,event,attempt,status,outcome,error,created_at,delivered_at,gave_up_at,next_attempt_at
       FROM webhook_deliveries WHERE endpoint_id=? AND org_id=? ORDER BY created_at DESC LIMIT 200`,
    [e.id, req.user.orgId]);
  res.json({
    endpoint: { id: e.id, url: e.url },
    deliveries: rows.map(r => ({
      id: r.id, event: r.event, attempt: r.attempt, status: r.status, outcome: r.outcome,
      error: r.error, at: r.created_at, deliveredAt: r.delivered_at,
      gaveUpAt: r.gave_up_at, nextAttemptAt: r.next_attempt_at,
      sentence: r.delivered_at ? `Delivered on attempt ${r.attempt}.`
        : r.gave_up_at ? `Gave up after ${r.attempt} attempts.`
        : `Attempt ${r.attempt} answered ${r.status || "nothing"}. Trying again.`,
    })),
  });
}));

// RESEND ONE, by hand.
app.post("/webhooks/deliveries/:id/resend", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [d] = await query(
    `SELECT id, endpoint_id, event, payload FROM webhook_deliveries WHERE id=? AND org_id=?`,
    [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const id = "whd_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO webhook_deliveries (id,org_id,endpoint_id,event,payload,attempt,next_attempt_at)
     VALUES (?,?,?,?,?::jsonb,0,NOW())`,
    [id, req.user.orgId, d.endpoint_id, d.event, JSON.stringify(d.payload)]);
  res.status(201).json({ ok: true, id, sentence: "Queued. Steward will try it again within the minute." });
}));

// ── INT-5 · THE WRITE HALF OF THE PUBLIC API ──────────────────────────────
//
// EVERY WRITE GOES THROUGH THE FUNCTION THE APP USES. Not "similar code": the
// same `recordGift`, the same person rules. A second writer would eventually
// disagree with the first about a fund, a rollup, a receipt or a duplicate,
// and the half that lost would be the one nobody was watching.
//
// A key is scoped per verb and per thing, so "record gifts" does not carry
// "add people" with it.
app.post("/api/v1/people", apiLimiter, requireApiKey, requireScope("write:people"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200) || null;
  if (!name) return res.status(422).json({ error: "invalid_request", message: "A person needs a name." });
  if (email && !email.includes("@")) return res.status(422).json({ error: "invalid_request", message: "That email address is not usable." });

  // AN EXISTING PERSON IS UPDATED, NOT DUPLICATED. An integration posting the
  // same supporter every night must not build a thousand records, so the match
  // is on email within this org, which is the same rule the importer uses.
  if (email) {
    const [existing] = await query(
      `SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL LIMIT 1`, [orgId, email]);
    if (existing) {
      await run(`UPDATE donors SET name=COALESCE(NULLIF(?, ''), name), phone=COALESCE(?, phone),
                        city=COALESCE(?, city), state=COALESCE(?, state), zip=COALESCE(?, zip)
                  WHERE id=? AND org_id=?`,
        [name, req.body?.phone || null, req.body?.city || null, req.body?.state || null,
         req.body?.zip || null, existing.id, orgId]);
      await emitWebhook(orgId, "person.updated", { personId: existing.id, email }).catch(() => {});
      const [row] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=?`, [existing.id]);
      return res.status(200).json({ data: apiPerson(row), created: false });
    }
  }
  const id = "d_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,city,state,zip,stage,person_types,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?, 'prospect', '["donor"]'::jsonb, ?, ?)`,
    [id, orgId, name, email, req.body?.phone || null, req.body?.city || null,
     req.body?.state || null, req.body?.zip || null,
     // THE ACTOR STAMP, and it names the KEY: "which integration created this
     // person" is the first question anybody asks of a record they did not
     // expect, and `system:api` alone cannot answer it.
     `system:api/${req.apiKey.id}`, `API key: ${req.apiKey.name}`]);
  await emitWebhook(orgId, "person.created", { personId: id, email }).catch(() => {});
  const [row] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=?`, [id]);
  res.status(201).json({ data: apiPerson(row), created: true });
}));

app.post("/api/v1/gifts", apiLimiter, requireApiKey, requireScope("write:gifts"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const personId = String(req.body?.personId || "").trim();
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date || "").slice(0, 10);
  if (!personId) return res.status(422).json({ error: "invalid_request", message: "A gift needs a personId." });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(422).json({ error: "invalid_request", message: "A gift needs a positive amount." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(422).json({ error: "invalid_request", message: "A gift needs a date as YYYY-MM-DD." });
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [personId, orgId]);
  if (!d) return res.status(404).json({ error: "not_found", message: "Steward has no such person for this organization." });

  // IDEMPOTENT BY THE CALLER'S OWN KEY. An integration that retries after a
  // timeout must not record the gift twice, and the caller is the only party
  // who knows the two requests were the same intent.
  const idemKey = String(req.body?.idempotencyKey || "").trim().slice(0, 120) || null;
  const written = await recordGift({
    orgId, donorId: personId, amount, date,
    type: String(req.body?.type || "cash").slice(0, 40),
    campaign: String(req.body?.campaign || "").slice(0, 120),
    notes: String(req.body?.notes || "").slice(0, 2000),
    fundId: req.body?.fundId || null,
    paymentMethod: req.body?.paymentMethod || null,
    idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : undefined,
    actorId: `system:api/${req.apiKey.id}`, actorName: `API key: ${req.apiKey.name}`,
    source: "public_api",
  });
  if (written.duplicate) {
    const [dup] = await query(`SELECT id, amount, date FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]);
    return res.status(200).json({ data: dup ? { id: dup.id, personId, amount: Number(dup.amount), date: dup.date } : null, duplicate: true });
  }
  const g = written.gift;
  await emitWebhook(orgId, "gift.created", { giftId: g.id, personId, amount: Number(g.amount), date: g.date }).catch(() => {});
  res.status(201).json({ data: { id: g.id, personId, amount: Number(g.amount), date: g.date } });
}));

app.post("/api/v1/notes", apiLimiter, requireApiKey, requireScope("write:notes"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const personId = String(req.body?.personId || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 4000);
  if (!personId || !note) return res.status(422).json({ error: "invalid_request", message: "A note needs a personId and a note." });
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [personId, orgId]);
  if (!d) return res.status(404).json({ error: "not_found", message: "Steward has no such person for this organization." });
  const type = ["call", "meeting", "email", "note"].includes(String(req.body?.type)) ? req.body.type : "note";
  const id = "int_" + uuid().slice(0, 8);
  await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)`,
    [id, orgId, personId, type, note,
     String(req.body?.date || "").slice(0, 10) || orgToday(await orgTz(orgId)),   // ORG_TZ_SEAM_OK
     `system:api/${req.apiKey.id}`]);
  res.status(201).json({ data: { id, personId, type } });
}));

// POST /donors/:id/conversations — THE write path of the Thread. Logs the
// touch (one line, an interactions row with the BUILD-75 actor), and the
// next-step decision travels IN THE SAME REQUEST: {type, due} opens the next
// thread, {skipped:true} is recorded as skipped on the interaction (the
// BUILD-76 rule — never as nothing). If the donor had an open thread, this
// conversation IS its outcome: the thread closes pointing at this
// interaction, and the next-step prompt's answer decides whether another
// opens. One request, one transaction — no half-logged state.
app.post("/donors/:id/conversations", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [donor] = await query(
    "SELECT id, assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const shape = await threadShapeMod();
  const touch = shape.touchTypeFor(String(req.body?.touch || ""));
  if (!touch) return res.status(400).json({ error: "Unknown touch type" });
  const line = typeof req.body?.line === "string" ? req.body.line.trim().slice(0, 8000) : "";
  if (!line) return res.status(400).json({ error: "The one line is required, what happened?" });
  // FIX-14 Part 1 — where it happened, for a meeting or a visit. The card is
  // titled by it ("Meeting at Starbucks").
  const place = typeof req.body?.place === "string" ? req.body.place.trim().slice(0, 200) : "";

  const org = await orgTz(orgId);
  const today = orgToday(org);                          // ORG_TZ_SEAM_OK
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || "")) ? req.body.date : today;

  const ns = req.body?.nextStep;
  const nsSkipped = !!(ns && ns.skipped === true);
  let step = null;
  if (!nsSkipped) {
    const typeLabel = shape.nextStepLabelFor(ns?.type);
    if (!ns || !typeLabel) return res.status(400).json({ error: "nextStep must be {type, due} from the offered set, or {skipped:true}: a skip is recorded, silence is not accepted" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ns.due || ""))) return res.status(400).json({ error: "nextStep.due must be a date (YYYY-MM-DD)" });
    // The label is the user's own sentence when they wrote one (a note-derived
    // step, or one they retyped in the row); the type's label otherwise. A
    // suggestion the user has to retype costs time instead of saving it.
    const label = shape.sanitizeStepLabel(ns.label) || typeLabel;
    // BUILD-84 FEATURE — the optional time. A 2:00 reminder does not forgive
    // being an hour off, so it is refused outright for an org whose timezone
    // is still Steward's default guess rather than a choice someone made.
    let time = shape.sanitizeStepTime(ns.time);
    if (ns.time != null && ns.time !== "" && !time)
      return res.status(400).json({ error: "nextStep.time must be a 24-hour HH:MM, or omitted for a date-only step" });
    if (time && !org.timezone_confirmed_at) {
      return res.status(400).json({ error: "timezone_unset",
        message: "Set your organization's timezone in Settings before scheduling a reminder at a specific time, Steward will not fire one at a guessed hour." });
    }
    step = { type: ns.type, label, due: ns.due, time };
  }
  // Which rule produced the proposal — "note" or "touch" — recorded with the
  // conversation so a wrong guess can be found later, not just corrected once.
  const nsSource = ["note", "touch"].includes(String(req.body?.nextStep?.source || "")) ? req.body.nextStep.source : null;
  // JOURNEYS-4 — how it ended, if she picked one. Anything else is dropped.
  const outcome = (await journeyMod()).TASK_OUTCOME_KEYS.includes(String(req.body?.outcome || "")) ? String(req.body.outcome) : null;

  const userRow = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRow[0]?.name || "";

  // ── BUILD-88a A.1 — THE OPTIONAL AMOUNT ──────────────────────────────────
  // A gift mentioned in a conversation IS a gift: it is written as a gift row,
  // through the one function, with its fund and method inline. It defaults to
  // the org's unrestricted fund and to "Needs you" as the method — a blank
  // reads the same as "nobody has looked", and this one is worth asking about.
  // The gift is written BEFORE the conversation, because the money must land
  // even if the follow-up write fails; the idempotency key is this exact
  // conversation, so a retried save cannot mint a second gift.
  let giftWritten = null;
  const giftIn = req.body && req.body.gift;
  if (giftIn && giftIn.amount != null && String(giftIn.amount).trim() !== "") {
    let giftAmt;
    try { giftAmt = toDollars(parseMoneyOrThrow(giftIn.amount, "gift.amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (!(giftAmt > 0)) return res.status(400).json({ error: "A gift on a conversation must be more than zero, leave it blank if there was none." });
    if (giftIn.fundId && !(await orgOwns("fin_funds", giftIn.fundId, orgId)))
      return res.status(404).json({ error: "Fund not found" });
    giftWritten = await recordGift({
      orgId, donorId: req.params.id, amount: giftAmt, date, type: "cash",
      fundId: giftIn.fundId || null, paymentMethod: giftIn.paymentMethod,
      notes: line, timeline: false,          // the conversation IS the timeline entry
      idempotencyKey: `conversation:${req.params.id}:${date}:${giftAmt}:${line}`.slice(0, 128),
      conflict: "idempotency",
      actorId: userId, actorName: userName, source: "conversation",
    });
  }
  const giftIdForTimeline = giftWritten && giftWritten.gift ? giftWritten.gift.id : null;

  const out = await withTransaction(async (client) => {
    const intId = "int_" + uuid().slice(0, 8);
    await runTx(client,
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [intId, orgId, req.params.id, touch.interactionType, line, date, userId, userName, giftIdForTimeline,
       JSON.stringify({ via: "thread_log", touch: touch.key, next_step: nsSkipped ? "skipped" : "set", ...(place ? { location: place } : {}),
                        ...(step ? { next_step_label: step.label } : {}), ...(nsSource ? { next_step_source: nsSource } : {}),
                        ...(outcome ? { outcome } : {}) })]);

    // An open thread on this donor closes on this conversation — the outcome.
    const closedRows = await queryTx(client,
      `UPDATE threads SET closed_at = NOW(), close_kind = 'outcome', closing_interaction_id = ?
        WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL RETURNING id`,
      [intId, orgId, req.params.id]);

    let thread = null;
    if (step) {
      // The meeting/visit chain: when the user KEPT the thank-you-note
      // default, the second thread (Follow up, +14 from the touch) rides
      // along and prefills the prompt when this one closes. A changed type
      // is the user's decision replacing the plan — no follow-on.
      const def = shape.NEXT_STEP_DEFAULTS[touch.key];
      const followon = def?.followon && step.type === def.type && step.label === def.label
        ? { type: def.followon.type, label: def.followon.label, due: shape.addCivilDays(date, def.followon.plusDays) }
        : null;
      thread = await openThreadTx(client, {
        orgId, donorId: req.params.id, step, openedOn: today,
        ownerId: donor.assigned_to || userId, ownerName: donor.assigned_to ? donor.assigned_to_name : userName,
        actorId: userId, actorName: userName, openingInteractionId: intId, followon,
      });
    }
    return { interactionId: intId, closedThreadId: closedRows[0]?.id || null, thread };
  });

  calcWealthScore(req.params.id, orgId).catch(e => console.error("score recalc:", e.message));
  // JOURNEYS-4 — a call or meeting logged on the Thread closes its step's task
  // (FIX-31), and that task is the one finished with this outcome.
  if (outcome && out.closedThreadId && ["call", "meeting"].includes(touch.interactionType)) {
    await run(`UPDATE tasks SET outcome=?, completed_at=COALESCE(completed_at, NOW()) WHERE thread_id=? AND org_id=? AND done=1`,
      [outcome, out.closedThreadId, orgId]).catch(e => console.error("[journey] task outcome:", e.message));
  }
  // FIX-14 Part 2 — the audit row names the conversation that was logged
  // (the response's first object is the thread, which is the wrong record),
  // and carries it, so the log can say "Logged a meeting with ...".
  if (req.audit) {
    const [logged] = await query("SELECT * FROM interactions WHERE id = ?", [out.interactionId]);
    req.audit.entity("interaction", out.interactionId);
    req.audit.after(logged ? { ...logged, next_step: step ? { label: step.label, due: step.due } : "skipped" } : null);
  }
  // BUILD-99 Part 3 — A PLAN STEP IS DONE WHEN ITS THREAD CLOSES, and the next
  // one opens. Called AFTER the transaction, so the plan reads the thread rows
  // this conversation actually committed. It is idempotent and self-healing: if
  // the officer's own next step already took the donor's one open thread slot,
  // the plan's next step stays PENDING and the next close advances it — which is
  // what makes this work with no background tick (production has none).
  await advanceCultivationPlan(orgId, req.params.id, {
    actorId: actor(req).id, actorName: actor(req).name, today: date,
  }).catch(e => console.error("[plan] advance:", e.message));
  // A.1 — the gift the conversation carried, named in the response so the
  // screen can say what it recorded instead of the user going to look.
  const giftOut = giftWritten && giftWritten.gift
    ? { id: giftWritten.gift.id, amount: round2(parseFloat(giftWritten.gift.amount) || 0),
        fundId: giftWritten.fundId, paymentMethod: giftWritten.paymentMethod }
    : (giftWritten && giftWritten.duplicate ? { duplicate: true } : null);
  // LIVE-1 — the conversation (and any gift it carried) is a change to the
  // person: the after-change step. A gift written above ran it already with
  // the gift form's name; this is the touch's own call.
  await require("../afterChange").afterChange(orgId, [req.params.id], { door: "logged_touch", recalc: false });
  res.status(201).json({ ...out, skipped: nsSkipped, gift: giftOut });
}));

// ── FIX-14 Part 1 — WHAT STEWARD HEARD IN A LOGGED CONVERSATION ────────────
// The FIX-12 after-meeting engine, for a conversation logged by hand: the
// Agent engine reads the note through the one AI door (aiClient.js asks the
// org's switch), and shared/meetingNote.js's simple reader is the fallback.
// Three chips, and NOTHING is recorded until a person says yes:
//   next     sets the profile's next step: the donor's one open Thread step
//   spouse   links the spouse named in the note into one household, matching
//            a person already on file by name or adding them (the one person
//            record: a row in donors, person type "other")
//   planned  marks the record a planned-giving prospect (the designation)
// A chip answered either way is remembered on the interaction
// (metadata.chips_done), so it is offered once.
const CONVO_CHIP_TTL_MS = 10 * 60 * 1000;
const _convoChipCache = new Map();   // interaction id + note → the engine's chips, briefly
async function loggedConversation(orgId, id) {
  const [i] = await query(
    `SELECT i.id, i.donor_id, i.type, i.note, i.date, i.metadata, d.name AS donor_name, d.household_id
       FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.id = ? AND i.org_id = ? AND d.deleted_at IS NULL`, [id, orgId]);
  if (!i) return null;
  i.meta = typeof i.metadata === "string" ? (() => { try { return JSON.parse(i.metadata); } catch { return {}; } })() : (i.metadata || {});
  i.done = Array.isArray(i.meta.chips_done) ? i.meta.chips_done : [];
  return i;
}
async function spouseCandidate(orgId, i, name) {
  const given = String(name || "").trim();
  const ln = lastName(i.donor_name);
  const full = given.includes(" ") || !ln ? given : `${given} ${ln}`;
  const rows = await query(
    `SELECT id, name, household_id FROM donors WHERE org_id = ? AND deleted_at IS NULL AND id <> ?
        AND (LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?)) ORDER BY (LOWER(name) = LOWER(?)) DESC LIMIT 2`,
    [orgId, i.donor_id, full, given, full]);
  return { full, match: rows.length >= 1 && (rows.length === 1 || rows[0].name.toLowerCase() === full.toLowerCase()) ? rows[0] : null };
}

app.post("/interactions/:id/suggest", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (req.audit) req.audit.skip("reads a note and writes nothing");
  const i = await loggedConversation(orgId, req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const N = await import("../shared/meetingNote.js");
  const note = String(i.note || "").slice(0, 4000);
  const ctx = { date: String(i.date || "").slice(0, 10) };
  let suggestions = null, source = "reader", aiOff = false;
  const ck = i.id + "\u0000" + note;
  const hit = _convoChipCache.get(ck);
  if (hit && hit.until > Date.now()) { suggestions = hit.chips; source = "agent"; }
  else if (note.trim()) {
    try {
      const r = await anthropicFor(orgId).messages.create({
        model: AGENT_MODEL, max_tokens: 600, system: N.CONVERSATION_CHIP_SYSTEM,
        messages: [{ role: "user", content: `Her note:\n"""${note}"""` }],
        tools: [N.CONVERSATION_CHIP_TOOL], tool_choice: { type: "tool", name: N.CONVERSATION_CHIP_TOOL.name } });
      const use = (r.content || []).find(c => c.type === "tool_use");
      const chips = N.validateConversationChips(use && use.input && use.input.chips, note, ctx);
      if (chips.length) { suggestions = chips; source = "agent"; _convoChipCache.set(ck, { chips, until: Date.now() + CONVO_CHIP_TTL_MS }); }
    } catch (e) {
      if (e instanceof AiOffError) aiOff = e.reason === "ai_disabled";
      else console.error("[conversation-chips] engine:", e.message);
    }
  }
  if (!suggestions) suggestions = N.suggestFromConversation(note, ctx);
  // Only what is not already true, and not already answered.
  const out = [];
  for (const c of suggestions) {
    if (i.done.includes(c.kind)) continue;
    if (c.kind === "planned") {
      const [has] = await query(`SELECT 1 FROM donor_designations WHERE org_id = ? AND donor_id = ? AND kind IN ('planned_prospect','planned_confirmed','estate')`, [orgId, i.donor_id]);
      if (has) continue;
    }
    if (c.kind === "spouse") {
      const { full, match } = await spouseCandidate(orgId, i, c.name);
      if (match && i.household_id && match.household_id === i.household_id) continue;
      out.push({ ...c, fullName: full, matchId: match ? match.id : null,
        label: match ? `Link ${match.name} to the household` : `Add ${full} and link the household` });
      continue;
    }
    if (c.kind === "next") {
      const [open] = await query(`SELECT due_date FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL`, [orgId, i.donor_id]);
      if (open && open.due_date === c.due) continue;
    }
    out.push(c);
  }
  res.json({ suggestions: out, source,
    sentence: aiOff ? AI_OFF_MESSAGE + ". These come from Steward's simple reader. Nothing changes until you say yes."
      : "Read from the note. Nothing changes until you say yes." });
}));

app.post("/interactions/:id/chips", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const i = await loggedConversation(orgId, req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const kind = String(req.body?.kind || "");
  if (!["next", "spouse", "planned"].includes(kind)) return res.status(400).json({ error: "kind must be next, spouse or planned" });
  const answer = req.body?.answer === "no" ? "no" : "yes";
  const who = actor(req);
  let sentence = "Fine. Steward will not offer that again for this note.";
  if (answer === "yes" && kind === "next") {
    const shape = await threadShapeMod();
    const label = shape.sanitizeStepLabel(req.body?.label) || "Follow up";
    const due = String(req.body?.due || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "due must be a date (YYYY-MM-DD)" });
    const [donor] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ?", [i.donor_id, orgId]);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const [open] = await query("SELECT id FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL", [orgId, i.donor_id]);
    if (open) {
      // One open step per person: her yes replaces what it says and when.
      await run("UPDATE threads SET next_step_type = ?, next_step_label = ?, due_date = ?, snoozed_until = NULL WHERE id = ? AND org_id = ?",
        [shape.nextStepTypeForLabel(label), label, due, open.id, orgId]);
    } else {
      await withTransaction(client => openThreadTx(client, {
        orgId, donorId: i.donor_id, step: { type: shape.nextStepTypeForLabel(label), label, due, time: null }, openedOn: today,
        ownerId: donor?.assigned_to || userId, ownerName: donor?.assigned_to ? donor.assigned_to_name : who.name,
        actorId: who.id, actorName: who.name, openingInteractionId: i.id,
      }));
    }
    sentence = `Next step set: ${label}, due ${(await import("../shared/displayDate.js")).displayDay(due, today) || due}.`;
  } else if (answer === "yes" && kind === "spouse") {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "name is required" });
    let spouseId = null;
    if (req.body?.matchId) {
      const [m] = await query("SELECT id, household_id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [String(req.body.matchId), orgId]);
      if (!m) return res.status(404).json({ error: "That person is not on file." });
      if (m.household_id && i.household_id && m.household_id !== i.household_id)
        return res.status(400).json({ error: "That person is already in another household." });
      spouseId = m.id;
    }
    await withTransaction(async client => {
      if (!spouseId) {
        // THE ONE PERSON RECORD: a spouse is a row in donors, not a field.
        spouseId = "d_" + uuid().slice(0, 8);
        await runTx(client,
          `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,gift_count,tags,notes,created_by,created_by_name,person_types)
           VALUES (?,?,?,'','','new','prospect',0,0,0,'[]','',?,?,?)`,
          [spouseId, orgId, name, who.id, who.name, JSON.stringify(["other"])]);
      }
      let hh = i.household_id;
      if (!hh) {
        const [sp] = await queryTx(client, "SELECT household_id FROM donors WHERE id = ? AND org_id = ?", [spouseId, orgId]);
        hh = sp && sp.household_id;
      }
      if (!hh) {
        hh = "hh_" + uuid().slice(0, 8);
        const ln = lastName(i.donor_name);
        await runTx(client, "INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)",
          [hh, orgId, ln ? `The ${ln} Household` : "Household", i.donor_id, true, who.id, who.name]);
      }
      await runTx(client, "UPDATE donors SET household_id = ? WHERE org_id = ? AND id = ANY(?)", [hh, orgId, [i.donor_id, spouseId]]);
    });
    sentence = `${name} is linked to ${i.donor_name}'s household.`;
  } else if (answer === "yes" && kind === "planned") {
    await run("INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES (?,?,?,?) ON CONFLICT (donor_id, kind) DO NOTHING",
      ["dsg_" + uuid().slice(0, 8), orgId, i.donor_id, "planned_prospect"]);
    sentence = `${i.donor_name} is marked as a planned-giving prospect.`;
  }
  await run(`UPDATE interactions SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('chips_done', ?::jsonb)
              WHERE id = ? AND org_id = ?`, [JSON.stringify([...new Set([...i.done, kind])]), i.id, orgId]);
  if (req.audit) { req.audit.entity("donor", i.donor_id); req.audit.action(answer === "yes" ? `confirmed the ${kind} suggestion` : `declined the ${kind} suggestion`); }
  res.json({ ok: true, kind, answer, sentence });
}));

// ── Public org slug list (diagnostic) ─────────────────────────────────────
app.get("/org/public-list", wrap(async (req, res) => {
  const orgs = await query("SELECT id, name, org_slug FROM orgs ORDER BY name ASC");
  res.json(orgs.map(o => ({ id: o.id, name: o.name, slug: o.org_slug, url: `/give/${o.org_slug}` })));
}));

// ── Public donation page ───────────────────────────────────────────────────
// POLISH-3 · ONE PAYLOAD FOR THE ORG'S OWN PAGE AND ITS PREVIEW, as GIVE-3
// did for giving pages: the public read and the editor's preview of the
// org-wide Donation form build it here, so the page and the preview cannot be
// handed two different shapes. The org's facts ride along for the trust panel.
const orgPageSql = where => `SELECT o.id, o.name, o.org_slug, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          o.legal_name, o.ein, o.receipt_address, o.stripe_account_id, o.stripe_connected, o.receipts_enabled,
          ${GIVE_THEME_COLS}
     FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE ${where}`;
async function orgPagePublicPayload(org, orgSlug, { draftForm = null } = {}) {
  org.donor_facing_name = String(org.display_name || "").trim() || org.name;
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = $1 ORDER BY name ASC", [org.id]);
  // BUILD-49 entry point (c): the post-donation thank-you screen offers the
  // giving account only for listed orgs (givingAccountEntry — the one gate).
  // Listing is already public via the directory, so this reveals nothing new.
  const gaEntry = await givingAccountEntry({ id: org.id, org_slug: orgSlug });
  // BUILD-60 — the give page is the ORG's page: it carries the org's own theme.
  // PARITY-2 Part 1: the give hub: the org's other open doors (waysToGive.js).
  const ways = await waysToGive(org.id, orgSlug);
  const theme = giveThemePayload(org);
  // The editor's preview draws the drafted amounts, as Publish will set them.
  if (draftForm) {
    if (Array.isArray(draftForm.onetimeAmounts) && draftForm.onetimeAmounts.length) theme.onetimeAmounts = draftForm.onetimeAmounts.map(Number);
    if (Array.isArray(draftForm.monthlyAmounts) && draftForm.monthlyAmounts.length) theme.monthlyAmounts = draftForm.monthlyAmounts.map(Number);
  }
  return { org: { name: org.donor_facing_name, mission: org.mission, slug: orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!gaEntry, theme, portalSignIn: org.portal_enabled === true, ways,
    // GIVE-3's trust panel, on the org's own page too (shared/givingPageDesign.js decides which lines show).
    facts: { orgName: org.donor_facing_name, legalName: org.legal_name || "", ein: org.ein || "",
             contactEmail: org.give_contact || "", address: org.receipt_address || "", stripe: !!org.stripe_account_id } }, funds };
}
app.get("/org/:orgSlug/public", wrap(async (req, res) => {
  // BUILD-58 W-2 — the give page is a DONOR-FACING money surface: it shows
  // the org's white-label display name (portal_settings.display_name) when
  // set, never the staff-side orgs.name (e.g. "CREO Arts (Demo)").
  const orgs = await query(orgPageSql("o.org_slug = $1"), [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  // FIX-58: the org's own donation form is gated like its giving pages: until
  // payments are connected it is not open, and its address says so. The
  // memberships page reads the same payload for the org's brand and asks with
  // ?memberships=1; a membership's checkout is refused by donateHandler on its
  // own until payments are connected, so that page never takes money either.
  const org = orgs[0];
  if (req.query.memberships !== "1" && !orgTakesGifts(org)) {
    const name = String(org.display_name || "").trim() || org.name;
    return res.status(404).json({ notOpen: true, orgName: name, error: `${name}'s giving page isn't open yet. Please check back soon.` });
  }
  res.json(await orgPagePublicPayload(org, req.params.orgSlug));
}));
// The editor's preview of the org's own Donation form: the same payload, with
// the drafted amounts. A GET: nothing is written.
app.get("/org-form/page/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgs = await query(orgPageSql("o.id = $1"), [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "not_found" });
  const [d] = await query("SELECT form_draft FROM portal_settings WHERE org_id = $1", [req.user.orgId]);
  const draft = d && d.form_draft && typeof d.form_draft === "object" ? d.form_draft : null;
  res.json(await orgPagePublicPayload(orgs[0], orgs[0].org_slug, { draftForm: draft }));
}));

// Public — org info + giving page + real live progress. Same shape as
// GET /org/:orgSlug/public, plus the page's own title/story/image/goal and
// the real computed raised total (never a manually-set counter).
// BUILD-98 (switch) Part 4 — an event's tickets, for the public giving page.
// Public by slug like every /org/:orgSlug/…/public read: it shows what a
// flyer would, and nothing about who has registered beyond places left.
app.get("/org/:orgSlug/event/:eventId/public", wrap(async (req, res) => {
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [ev] = await query("SELECT id, name, date, location, description FROM events WHERE id=? AND org_id=? AND status <> 'cancelled' AND is_sample IS NOT TRUE", [req.params.eventId, org.id]);
  if (!ev) return res.status(404).json({ error: "Not found" });
  const levels = await query("SELECT * FROM event_levels WHERE event_id=? AND org_id=? AND retired_at IS NULL ORDER BY kind DESC, position, price", [ev.id, org.id]);
  const out = [];
  for (const l of levels) out.push(eventLevelPayload(l, await levelTaken(l.id)));
  res.json({ orgName: await donorFacingOrgName(org.id, org.name).catch(() => org.name),
    event: { id: ev.id, name: ev.name, date: orgTime.civilOf(ev.date), location: ev.location, description: ev.description },
    levels: out });
}));

// ── VOL-PAGE-1 · THE PUBLIC VOLUNTEER PAGE ─────────────────────────────────
// The giving page's read for a page of kind volunteer: the same brand, the
// same widget resolver, plus everything the volunteer blocks read (roles,
// shifts with filled of needed, impact numbers), all from records. A GET, so
// it writes nothing: the page counts its own view with POST /forms/:id/event.
// A quote without its volunteer's permission never leaves the server.
app.get("/org/:orgSlug/volunteer-page/:pageSlug/public", donateLimiter, wrap(async (req, res) => {
  const VP = require("../volunteerPage");
  const [org] = await query(`SELECT o.id, o.name, o.org_slug, ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug = ?`,
    [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "not_found", message: "This page could not be found." });
  const [page] = await query(`SELECT id, title, slug, published, image_url, image_meta FROM giving_pages
     WHERE org_id = ? AND slug = ? AND page_kind = ? AND status = 'active' AND published IS NOT NULL`, [org.id, req.params.pageSlug, VP.KIND]);
  if (!page || !Array.isArray(page.published) || !page.published.length) return res.status(404).json({ error: "not_found", message: "This page could not be found." });
  const widgets = (await resolveWidgetsPublic(org, page.published, { pageId: page.id, today: orgToday(await orgTz(org.id)) }))   // ORG_TZ_SEAM_OK
    .filter(w => w.type !== "volquote" || (w.permission === true && w.text && w.name));
  const data = await VP.pageData(org.id, page.published);
  res.json({ org: { id: org.id, name: String(org.display_name || "").trim() || org.name, slug: org.org_slug },
    theme: giveThemePayload(org), page: { id: page.id, title: page.title, slug: page.slug,
      cover: page.image_url ? { url: page.image_url, ...(page.image_meta || {}) } : null }, widgets, data });   // FIX-41
}));

// The same data for the editor's live preview, before anything is published.
app.get("/giving-pages/:id/volunteer-data", requireAuth, wrap(async (req, res) => {
  const VP = require("../volunteerPage");
  const [page] = await query("SELECT id, draft FROM giving_pages WHERE id = ? AND org_id = ? AND page_kind = ?", [req.params.id, req.user.orgId, VP.KIND]);
  if (!page) return res.status(404).json({ error: "not_found" });
  res.json(await VP.pageData(req.user.orgId, page.draft || []));
}));

// GIVE-3 · ONE PAYLOAD FOR THE PAGE AND ITS PREVIEW. The public read and the
// editor's preview (GET /giving-pages/:id/page/preview) select the same rows
// and build the same payload in givingPagePublicPayload, so the component
// that draws them cannot be handed two different shapes.
const gpOrgSql = where => `SELECT o.id, o.name, o.org_slug, o.legal_name, o.ein, o.receipt_address, o.stripe_account_id, o.stripe_connected, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE ${where}`;
const gpPageSql = where => `SELECT gp.*, f.name AS fund_name, c.name AS campaign_name, c.goal_amount AS campaign_goal,
       to_char(c.end_date,'YYYY-MM-DD') AS campaign_end_date, c.match_cents AS campaign_match_cents,
       to_char(gp.ends_on,'YYYY-MM-DD') AS page_ends_on,
       COALESCE((SELECT SUM(amount) FROM gifts WHERE giving_page_id = gp.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         0   -- FIX-49: filled below by numbers.publicBarRaised, the one public-bar rule
       END AS campaign_raised,
       -- PARITY-2 Part 2: THE DONOR COUNT BESIDE THE BAR, over the SAME rows
       -- the bar sums (the page's, or its campaign's when it counts toward
       -- one): each person once, however many gifts they made.
       (SELECT COUNT(DISTINCT donor_id)::int FROM gifts WHERE giving_page_id = gp.id AND amount > 0 AND ${NOT_DELETED("gifts")}) AS page_donors,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         (SELECT COUNT(DISTINCT g.donor_id)::int FROM gifts g WHERE g.org_id = gp.org_id AND g.amount > 0 AND ${CAMPAIGN_GIFT_MATCH("g", "c")})
       END AS campaign_donors
     FROM giving_pages gp
     LEFT JOIN fin_funds f ON f.id = gp.fund_id
     LEFT JOIN campaigns c ON c.id = gp.campaign_id AND c.org_id = gp.org_id
     WHERE ${where}`;
app.get("/org/:orgSlug/giving-page/:pageSlug/public", wrap(async (req, res) => {
  const orgs = await query(gpOrgSql("o.org_slug = ?"), [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  const pageRows = await query(gpPageSql("gp.org_id = ? AND gp.slug = ? AND gp.status = 'active' AND COALESCE(gp.page_kind,'give') = 'give'"),
    [org.id, req.params.pageSlug]);
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  // FUNDRAISING-2: a page is not open to the public until the org can take
  // money through it. Until payments are connected it is a draft, and its
  // address says so kindly instead of showing a form that cannot work.
  if (!orgTakesGifts(org)) return res.status(404).json({ notOpen: true, orgName: org.name,
    error: `${org.name}'s giving page isn't open yet. Please check back soon.` });
  res.json(await givingPagePublicPayload(org, pageRows[0], req.query));
}));

// GIVE-3 · THE EDITOR'S PREVIEW: the draft, through the very same payload.
// The page row is read by id (a draft page need not be live yet) and the
// draft's own fields and blocks stand in for the published ones.
app.get("/giving-pages/:id/page/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgs = await query(gpOrgSql("o.id = ?"), [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "not_found" });
  const [row] = await query(gpPageSql("gp.org_id = ? AND gp.id = ? AND COALESCE(gp.page_kind,'give') = 'give'"), [req.user.orgId, req.params.id]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const d = row.draft_settings && typeof row.draft_settings === "object" ? row.draft_settings : null;
  const page = { ...row, published: Array.isArray(row.draft) ? row.draft : row.published };
  if (d) {
    Object.assign(page, {
      title: d.title ?? row.title, story: d.story ?? row.story, image_url: d.imageUrl ?? row.image_url,
      image_meta: d.imageMeta ?? row.image_meta, show_goal: d.showGoal ?? row.show_goal,
      goal_amount: d.goalAmount !== undefined ? d.goalAmount : row.goal_amount,
      fund_id: d.fundId !== undefined ? d.fundId : row.fund_id,
      campaign_id: d.campaignId !== undefined ? d.campaignId : row.campaign_id,
      design: d.design ?? row.design,
    });
    // Publish writes the form only when it changed (GIVE-EDIT-1), so the
    // preview takes the drafted form by the same rule: an unchanged form stays
    // the page's original one-step form here too.
    if (d.form) {
      const GPE = require("../givingPageEdit");
      const F = await formConfigMod();
      const fundIds = (await query("SELECT id FROM fin_funds WHERE org_id = ?", [req.user.orgId])).map(f => String(f.id));
      if (!GPE.sameJson(GPE.settingsOf(row, F, fundIds).form, d.form)) page.form_config = d.form;
    }
  }
  res.json(await givingPagePublicPayload(orgs[0], page, req.query));
}));

async function givingPagePublicPayload(org, page, reqQuery) {
  const req = { query: reqQuery || {}, params: { orgSlug: org.org_slug } };
  org.donor_facing_name = String(org.display_name || "").trim() || org.name; // W-2 white-label
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = ? ORDER BY name ASC", [org.id]);
  // GIVE-3 · THE GOAL BAR FOOTS. A page that counts toward a campaign shows
  // the campaign's own total from NUMBERS-1's one query (numbers.campaignGiftTotals,
  // CAMPAIGN_GIFT_MATCH: inside the campaign's dates, deleted people out), the
  // number Fundraising shows. Read by the page's campaign id, so a draft that
  // points at another campaign previews that campaign's bar.
  if (page.campaign_id) {
    const [c] = await query("SELECT name, goal_amount, to_char(end_date,'YYYY-MM-DD') AS end_date FROM campaigns WHERE id = ? AND org_id = ?", [page.campaign_id, org.id]);
    if (c) {
      const tot = (await require("../numbers").campaignGiftTotals(query, org.id)).find(r => r.cid === page.campaign_id);
      Object.assign(page, { campaign_name: c.name, campaign_goal: c.goal_amount, campaign_end_date: c.end_date });
      if (tot) { page.campaign_raised = tot.raised; page.campaign_donors = Number(tot.donor_count) || 0; }
      // FIX-49: the bar counts the campaign's gifts and, unless the campaign says
      // "Leave grants off the public bar", its awarded grants.
      page.campaign_raised = await require("../numbers").publicBarRaised(query, org.id, page.campaign_id);
    } else page.campaign_id = null;
  }
  const GD = await import("../shared/givingPageDesign.js");
  const pageToday = orgToday(await orgTz(org.id));   // ORG_TZ_SEAM_OK: days left is the org's own day
  const daysLeft = page.campaign_end_date
    ? Math.max(0, Math.round((Date.parse(page.campaign_end_date + "T00:00:00Z") - Date.parse(pageToday + "T00:00:00Z")) / 86400000)) : null;

  // BUILD-95 §5B — the built page, if she has published one.
  const { normalizeFormPosition } = await widgetMod();
  const formPos = normalizeFormPosition(page.form_position);
  // CAMPAIGN-2 — the page's own id and its campaign's end date travel with the
  // widgets, so a countdown, a match and a recent-gifts list resolve against the
  // campaign this page IS rather than against a date somebody typed twice.
  const builtWidgets = Array.isArray(page.published) && page.published.length
    ? await resolveWidgetsPublic(org, page.published, {
        pageId: page.id,
        campaignId: page.campaign_id || null,
        campaignEndDate: page.campaign_end_date || null,
        today: orgToday(await orgTz(org.id)),           // ORG_TZ_SEAM_OK — a countdown is the org's own day
      })
    : null;

  // Rollup + leaderboard — cheap once peer gifts always carry the parent's
  // giving_page_id (see gifts.peer_fundraiser_id comment in db.js): the
  // page's own raised_amount above already includes every peer gift with no
  // extra logic, and this is just the same SUM one level down, grouped by
  // fundraiser. Live every call, never cached, same rule as raised_amount.
  const fundraiserRows = await query(
    `SELECT pf.id, pf.name, pf.slug,
       COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount
     FROM peer_fundraisers pf
     WHERE pf.giving_page_id = ? AND pf.status = 'active'
     ORDER BY raised_amount DESC, pf.created_at ASC`,
    [page.id]
  );
  // PARITY-2 Part 2: the teams board and the campaign's own countdown, only
  // on a peer-to-peer page. The board is the same helper the "See all" read
  // uses, so the top ten and the full list cannot rank differently.
  const p2pOn = page.p2p_enabled === true;
  const P2Pm = p2pOn ? await import("../shared/p2p.js") : null;
  const teamBoard = p2pOn ? await p2pTeamBoard(org.id, page.id) : [];
  const p2pEndDate = page.campaign_end_date || page.page_ends_on || null;
  const p2pToday = orgToday(await orgTz(org.id));                 // ORG_TZ_SEAM_OK: a countdown is the org's own day
  const shownDonors = page.campaign_id && page.campaign_donors != null ? Number(page.campaign_donors) : Number(page.page_donors || 0);

  return {
    org: { name: org.donor_facing_name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!(await givingAccountEntry({ id: org.id, org_slug: req.params.orgSlug })), theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true,
      // GIVE-3: the org's own facts the trust panel and "other ways to give"
      // may state (shared/givingPageDesign.js decides which lines show).
      facts: { orgName: org.donor_facing_name, legalName: org.legal_name || "", ein: org.ein || "",
               contactEmail: org.give_contact || "", address: org.receipt_address || "", stripe: !!org.stripe_account_id } },
    givingPage: {
      id: page.id, slug: page.slug, title: page.title, story: page.story, imageUrl: page.image_url,
      // FIX-41: the cover with its words and focal point (pictures.js).
      cover: page.image_url ? { url: page.image_url, ...(page.image_meta || {}) } : null,
      goalAmount: page.goal_amount != null ? parseFloat(page.goal_amount) : null,
      raisedAmount: parseFloat(page.raised_amount) || 0,
      // GIVE-EDIT-1: the goal bar's switch, set in the page editor.
      showGoal: page.show_goal !== false,
      // GIVE-3: how the page looks, and the campaign figures its goal bar draws.
      design: GD.normalizeDesign(page.design),
      campaignDonors: page.campaign_id && page.campaign_donors != null ? Number(page.campaign_donors) : null,
      campaignDaysLeft: daysLeft,
      fundId: page.fund_id, fundName: page.fund_name || null,
      // "Counts toward" linkage (attribution FIX) — when set, the public
      // thermometer shows the campaign's progress, not a second page-local goal.
      campaignId: page.campaign_id || null,
      campaignName: page.campaign_name || null,
      campaignGoal: page.campaign_goal != null ? parseFloat(page.campaign_goal) : null,
      campaignRaised: page.campaign_raised != null ? parseFloat(page.campaign_raised) : null,
      // ── CAMPAIGN-2 · THE SENTENCE UNDER THE GOAL BAR ─────────────────────
      // Every number has a sentence, and a thermometer is the number a stranger
      // is most likely to doubt. It says WHAT IT COUNTS, including the two
      // things people assume it does not: a cheque somebody posted (an offline
      // gift counts the moment staff record it, like any other) and a gift given
      // through a supporter's own fundraising page.
      //
      // It is computed from the same two figures the bar is drawn from, in one
      // function, so the bar and its sentence cannot disagree.
      goalSentence: await (async () => {
        const CP = await campaignPageMod();
        const linked = !!page.campaign_id;
        const raised = linked && page.campaign_raised != null ? parseFloat(page.campaign_raised) : parseFloat(page.raised_amount || 0);
        const goal = linked ? (page.campaign_goal != null ? parseFloat(page.campaign_goal) : 0) : parseFloat(page.goal_amount || 0);
        return CP.goalBarSentence({
          raisedCents: Math.round((raised || 0) * 100),
          goalCents: Math.round((goal || 0) * 100),
          hasPeerPages: page.p2p_enabled === true,
        });
      })(),
      // BUILD-95 §5B — the BUILT page, resolved through the ONE pipeline the
      // portal uses. PUBLISHED only: a draft is what she is still arranging,
      // and a donor arriving from a QR code must never land in the middle of
      // an afternoon's rearranging.
      //
      // null means "never built", and the page falls back to its title, story
      // and image exactly as before — an org that has not opened the builder
      // sees no change at all, which is what makes this safe to ship.
      page: builtWidgets,
      formPosition: formPos,
      // BUILD-102 Part 1 — THE FORM THE DONOR IS OFFERED, from the same
      // `formSpec` the editor's preview renders. Not a second shape derived from
      // the same row: the same function, so the two cannot drift.
      // GIVE-2 §3 — AND THE AMOUNTS THE FORM OFFERS THIS VISITOR. The one
      // place a computed ladder replaces a typed one, so the editor's preview,
      // the embedded form and the page a stranger opens from a QR code cannot
      // disagree about which answer the donor is reading. A form with
      // `smartAmounts` off, or with too few gifts to tell, comes back
      // byte-for-byte as `formSpec` built it.
      //
      // The browser walk caught this: `/forms/:id/public` had it and THIS
      // payload did not, so the public giving page — the one a donor actually
      // opens — still showed Steward's $25/$50/$100/$250 guess.
      form: await withSmartAmounts(
        (await formConfigMod()).specForVariant(page.form_config, page.ab_test, req.query.v, {
          funds: funds.map(f => ({ id: f.id, name: f.name })),
          orgName: org.donor_facing_name,
        }),
        { orgId: org.id, givingPageId: page.id,
          personalToken: req.query.reconnect || req.query.r || null }),
      // BUILD-102 Part 6 — whether a test is running, so a first-time visitor can
      // be assigned a side WITHOUT a cookie being set on every form that has none.
      // A cookie nobody needs is a cookie somebody has to explain in a policy.
      abRunning: !!(page.ab_test && page.ab_test.running !== false && page.ab_test.b),
      // BUILD-102 Part 2 — the org's threshold, so the page can ask the shared
      // rule rather than carry a copy of it. The RULE stays in
      // shared/formConfig.js; this is only the org's number.
      upsellThresholdCents: org.form_upsell_threshold_cents != null
        ? Number(org.form_upsell_threshold_cents)
        : (await formConfigMod()).UPSELL_DEFAULT_THRESHOLD_CENTS,
      // GIVE-2 §6 — and the monthly amount the org suggests, when it named one.
      // Null keeps a third of the gift, which is what every org had before.
      upsellMonthlyCents: org.form_upsell_monthly_cents != null
        ? Number(org.form_upsell_monthly_cents) : null,
    },
    funds,
    peerFundraisers: {
      count: fundraiserRows.length,
      leaderboard: fundraiserRows.slice(0, 10).map(f => ({ id: f.id, name: f.name, slug: f.slug, raisedAmount: parseFloat(f.raised_amount) || 0 })),
    },
    // PARITY-2 Part 2: everything the public peer-to-peer page draws beyond
    // the bar: the donor count and its sentence, the countdown, the teams
    // board, and whether a new page waits for approval. Absent (null) on a
    // page that is not peer-to-peer, so nothing on it changes.
    p2p: p2pOn ? {
      enabled: true,
      donorCount: shownDonors,
      donorCountLine: P2Pm.donorCountLine(shownDonors),
      donorCountSentence: P2Pm.DONOR_COUNT_SENTENCE,
      endDate: p2pEndDate,
      countdown: p2pEndDate ? (await campaignPageMod()).countdownSentence(p2pEndDate, p2pToday) : null,
      requiresApproval: page.p2p_requires_approval === true,
      teamCount: teamBoard.length,
      teams: teamBoard.slice(0, 10),
      leaderboardSentence: P2Pm.LEADERBOARD_SENTENCE,
    } : null,
  };
}

// ── PARITY-2 Part 2 · THE PUBLIC LEADERBOARDS ────────────────────────────
// One query per board, used by the page (top ten) and by "See all" (every
// active row), so the two can never rank differently. Raised is the
// donor-intended amount (net of a covered fee), the same SUM the page's own
// bar uses. A team's total is every gift through its members' pages, live,
// never a stored counter (forms.md, BUILD-103); members listed are the active
// ones only.
async function p2pTeamBoard(orgId, pageId) {
  const rows = await query(
    `SELECT t.id, t.name, t.slug, t.goal_amount,
            (SELECT COUNT(*)::int FROM peer_fundraisers pf WHERE pf.team_id = t.id AND pf.org_id = t.org_id AND pf.status = 'active') AS members,
            COALESCE((SELECT SUM(g.amount) FROM gifts g
                        JOIN peer_fundraisers pf ON pf.id = g.peer_fundraiser_id AND pf.org_id = g.org_id
                       WHERE pf.team_id = t.id AND g.org_id = t.org_id), 0)::float AS raised
       FROM p2p_teams t
      WHERE t.org_id = ? AND t.giving_page_id = ? AND t.status = 'active'
      ORDER BY raised DESC, t.name LIMIT 500`, [orgId, pageId]);
  return rows.map(t => ({ id: t.id, name: t.name, slug: t.slug, members: t.members,
    raisedAmount: Math.round(Number(t.raised) * 100) / 100,
    goalAmount: t.goal_amount != null ? Number(t.goal_amount) : null }));
}
async function p2pIndividualBoard(orgId, pageId) {
  const rows = await query(
    `SELECT pf.id, pf.name, pf.slug, t.name AS team_name, t.slug AS team_slug,
            COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND org_id = pf.org_id AND ${NOT_DELETED("gifts")}), 0)::float AS raised
       FROM peer_fundraisers pf
       LEFT JOIN p2p_teams t ON t.id = pf.team_id AND t.org_id = pf.org_id AND t.status = 'active'
      WHERE pf.org_id = ? AND pf.giving_page_id = ? AND pf.status = 'active'
      ORDER BY raised DESC, pf.created_at ASC LIMIT 500`, [orgId, pageId]);
  return rows.map(f => ({ id: f.id, name: f.name, slug: f.slug, teamName: f.team_name || null, teamSlug: f.team_slug || null,
    raisedAmount: Math.round(Number(f.raised) * 100) / 100 }));
}
async function p2pPublicPage(orgSlug, pageSlug) {
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [orgSlug]);
  if (!org) return null;
  const [pg] = await query(`SELECT id, slug, title FROM giving_pages WHERE org_id=? AND slug=? AND status='active' AND p2p_enabled = true`,
    [org.id, pageSlug]);
  return pg ? { org, pg } : null;
}

// "See all": every active fundraiser or team on the board, in order. Public:
// a name, a slug, a team and what was raised. Never an email, never a donor.
app.get("/org/:orgSlug/giving-page/:pageSlug/leaderboard", donateLimiter, wrap(async (req, res) => {
  const hit = await p2pPublicPage(req.params.orgSlug, req.params.pageSlug);
  if (!hit) return res.status(404).json({ error: "This giving page could not be found." });
  const kind = req.query.kind === "teams" ? "teams" : "individuals";
  const P2Pm = await import("../shared/p2p.js");
  const rows = kind === "teams" ? await p2pTeamBoard(hit.org.id, hit.pg.id) : await p2pIndividualBoard(hit.org.id, hit.pg.id);
  res.json({ kind, rows, sentence: P2Pm.LEADERBOARD_SENTENCE });
}));

// A TEAM'S OWN PAGE (`/give/:org/:page?team=<slug>` on the client): its
// captain, its members and what each has raised, and the team's total
// against its goal. Public, and the roster is names only: a stranger reading
// a team page is shown who is raising, never who gave.
app.get("/org/:orgSlug/giving-page/:pageSlug/team/:teamSlug/public", donateLimiter, wrap(async (req, res) => {
  const hit = await p2pPublicPage(req.params.orgSlug, req.params.pageSlug);
  if (!hit) return res.status(404).json({ error: "This team could not be found." });
  const [t] = await query(`SELECT id, name, slug, goal_amount, captain_fundraiser_id FROM p2p_teams
                            WHERE org_id=? AND giving_page_id=? AND slug=? AND status='active'`,
    [hit.org.id, hit.pg.id, String(req.params.teamSlug).slice(0, 80)]);
  if (!t) return res.status(404).json({ error: "This team could not be found." });
  const P2Pm = await import("../shared/p2p.js");
  const members = (await p2pIndividualBoard(hit.org.id, hit.pg.id)).filter(f => f.teamSlug === t.slug);
  const board = await p2pTeamBoard(hit.org.id, hit.pg.id);
  const mine = board.find(b => b.id === t.id) || { raisedAmount: 0 };
  const raisedCents = Math.round(mine.raisedAmount * 100);
  const goalCents = t.goal_amount != null ? Math.round(Number(t.goal_amount) * 100) : null;
  const captain = members.find(m => m.id === t.captain_fundraiser_id) || null;
  res.json({
    orgName: await donorFacingOrgName(hit.org.id, hit.org.name).catch(() => hit.org.name),
    givingPage: { slug: hit.pg.slug, title: hit.pg.title },
    team: {
      id: t.id, name: t.name, slug: t.slug,
      raisedAmount: raisedCents / 100, goalAmount: goalCents != null ? goalCents / 100 : null,
      captain: captain ? { name: captain.name, slug: captain.slug } : null,
      members: members.map(m => ({ name: m.name, slug: m.slug, raisedAmount: m.raisedAmount, isCaptain: m.id === t.captain_fundraiser_id })),
      sentence: P2Pm.teamSentence({ teamName: t.name, raisedCents, goalCents, memberCount: members.length })
        + " It is every gift given through its members' pages, summed live.",
    },
  });
}));

// ── Peer-to-peer fundraising ────────────────────────────────────────────────
// A supporter's own personal fundraiser under a parent Giving Page — see
// peer_fundraisers in db.js. Slug uniqueness is scoped to one giving page,
// not the whole org (mirrors uniqueGivingPageSlug above, one level down).
async function uniquePeerFundraiserSlug(givingPageId, base, excludeId) {
  let slug = base, n = 1;
  while (true) {
    const rows = excludeId
      ? await query("SELECT id FROM peer_fundraisers WHERE giving_page_id=? AND slug=? AND id<>?", [givingPageId, slug, excludeId])
      : await query("SELECT id FROM peer_fundraisers WHERE giving_page_id=? AND slug=?", [givingPageId, slug]);
    if (!rows.length) return slug;
    n++;
    slug = `${base}-${n}`;
  }
}

// Same shape as invites.token (two concatenated stripped UUIDs, 64 hex
// chars) — this codebase's existing convention for "a long random value,
// stored and looked up directly, that IS the entire auth for one action."
// See CLAUDE.md's recovery-token pattern for the HMAC-signed alternative;
// this is the simpler stored-token sibling, used here because (unlike a
// card-update link generated server-side on a schedule) this token also
// needs to double as the durable "your account" credential the supporter
// holds onto indefinitely, not a short-lived one-off.
function generateEditToken() {
  return uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
}

// BUILD-103 Part 5: ONE PERSON RECORD, shared by the public sign-up and the
// staff "Add a fundraiser" (FIX-28). Exact email, never name; nobody known
// becomes a person typed volunteer; two matches link to neither.
async function fundraiserPerson(orgId, name, cleanEmail, who) {
  const matched = await query(
    `SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 2`,
    [orgId, cleanEmail]);
  if (matched.length === 1) return matched[0].id;
  if (matched.length) return null;
  const personId = "d_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
     VALUES (?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
    [personId, orgId, name, cleanEmail, who.id, who.name]);
  return personId;
}

async function sendFundraiserManageEmail(org, fundraiser, givingPage, manageUrl, { pending = false } = {}) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const from = await donorFromAddress(org.id); // BUILD-64: the org's name in the inbox
    // PARITY-2 Part 2: a page that waits for approval says so, rather than
    // telling somebody their page is live when it is not yet.
    const { error } = await resend.emails.send({
      from, _stewardOrgId: org.id, _stewardKind: "fundraiser_manage",   // MAIL-1: the org's mail policy applies
      to: fundraiser.email,
      subject: pending ? `Your fundraiser for ${displayNameCase(org.name)} is waiting for approval`
                       : `Your fundraiser for ${displayNameCase(org.name)} is live!`,
      html: `<p>Hi ${escapeHtml(fundraiser.name)},</p>
             <p>Thanks for starting a personal fundraiser for <strong>${escapeHtml(givingPage.title)}</strong> on behalf of <strong>${escapeHtml(org.name)}</strong>! ${pending ? `${escapeHtml(org.name)} looks at every new page before it goes live, and yours will be public as soon as they approve it. You can write your story in the meantime.` : "Your page is live and ready to share."}</p>
             <p><a href="${manageUrl}" style="background:#c9a84c;color:#0f1a12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Manage Your Fundraiser</a></p>
             <p>Use that link any time to update your story, goal, or photo, bookmark it, since there's no password to reset it with.</p>`,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("Fundraiser manage email send failed:", err.message);
    return false;
  }
}

// BUILD-103 Part 1 — the teams on this campaign, for the sign-up screen.
// Public, and it returns a name, a slug and what the team has raised. Never a
// member list and never an email: a stranger reading a campaign page is not
// entitled to the roster.
app.get("/org/:orgSlug/giving-page/:pageSlug/teams", donateLimiter, wrap(async (req, res) => {
  const [org] = await query("SELECT id FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [pg] = await query(`SELECT id FROM giving_pages WHERE org_id=? AND slug=? AND status='active' AND p2p_enabled = true`,
    [org.id, req.params.pageSlug]);
  if (!pg) return res.json({ teams: [] });
  const rows = await query(
    `SELECT t.id, t.name, t.slug, t.goal_amount,
            (SELECT COUNT(*)::int FROM peer_fundraisers pf WHERE pf.team_id=t.id AND pf.status='active') AS members,
            COALESCE((SELECT SUM(g.amount) FROM gifts g JOIN peer_fundraisers pf ON pf.id=g.peer_fundraiser_id
                       WHERE pf.team_id=t.id AND g.amount > 0),0)::float AS raised
       FROM p2p_teams t WHERE t.giving_page_id=? AND t.org_id=? AND t.status='active'
      ORDER BY raised DESC, t.name LIMIT 200`, [pg.id, org.id]);
  res.json({ teams: rows.map(t => ({ id: t.id, name: t.name, slug: t.slug, members: t.members,
    raisedCents: Math.round(Number(t.raised) * 100),
    goalCents: t.goal_amount != null ? Math.round(Number(t.goal_amount) * 100) : null })) });
}));

// Public — a supporter starting a fundraiser from a live Giving Page. No
// auth (this is the entire point — spur-of-the-moment, zero account setup),
// rate-limited the same as the donation route it sits next to since it's
// the same abuse surface (public, unauthenticated, org-costs-nothing-to-spam
// concern). Only succeeds against an *active* parent page — same rule
// POST /donate/:orgSlug already enforces for donations themselves.
app.post("/org/:orgSlug/giving-page/:pageSlug/fundraisers", donateLimiter, wrap(async (req, res) => {
  const { name, email, personalGoalAmount, story, imageUrl } = req.body;
  if (!name || !name.trim() || !email || !email.trim()) return res.status(400).json({ error: "Name and email are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: "Please enter a valid email address." });
  if (name.trim().length > 200) return res.status(400).json({ error: "Name is too long." });
  if (email.trim().length > 320) return res.status(400).json({ error: "Email is too long." });
  if (story && story.length > 5000) return res.status(400).json({ error: "Story is too long (5,000 character max)." });
  if (imageUrl && imageUrl.length > 2000) return res.status(400).json({ error: "Image URL is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "Personal goal must be a positive number." });

  const orgs = await query("SELECT id, name FROM orgs WHERE org_slug = ?", [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];

  const pageRows = await query("SELECT * FROM giving_pages WHERE org_id=? AND slug=? AND status='active'", [org.id, req.params.pageSlug]);
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const givingPage = pageRows[0];
  // BUILD-103 — a peer-to-peer campaign is a giving page with the switch on.
  // A page that is not one does not take fundraisers, and says so in the same
  // words it would use for a page that is not there.
  if (givingPage.p2p_enabled !== true) return res.status(404).json({ error: "This giving page could not be found." });

  // BUILD-103 Part 1 — JOIN A TEAM, OR START ONE. A team belongs to this page
  // and is looked up under it, so a team id from another org's campaign finds
  // nothing rather than being refused by a check somebody could forget.
  const P2Pm = await import("../shared/p2p.js");
  let teamId = null;
  let startedTeam = false;   // PARITY-2 Part 2: whoever starts a team at sign-up is its captain
  if (req.body?.teamId) {
    const [t] = await query(`SELECT id FROM p2p_teams WHERE id=? AND giving_page_id=? AND org_id=? AND status='active'`,
      [String(req.body.teamId), givingPage.id, org.id]);
    if (!t) return res.status(404).json({ error: "That team is not on this campaign." });
    teamId = t.id;
  } else if (String(req.body?.teamName || "").trim()) {
    const v = P2Pm.validateTeam({ name: req.body.teamName, goalAmount: req.body.teamGoalAmount });
    if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
    const [existing] = await query(`SELECT id FROM p2p_teams WHERE giving_page_id=? AND slug=?`, [givingPage.id, v.team.slug]);
    if (existing) teamId = existing.id;
    else {
      startedTeam = true;
      teamId = "pt_" + uuid().slice(0, 10);
      await run(`INSERT INTO p2p_teams (id,org_id,giving_page_id,name,slug,goal_amount,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,'system:p2p-signup','The fundraiser, from the sign-up page')`,
        [teamId, org.id, givingPage.id, v.team.name, v.team.slug, v.team.goalCents == null ? null : v.team.goalCents / 100]);
    }
  }

  // BUILD-103 Part 5: ONE PERSON RECORD. The fundraiser is matched to the
  // CRM by EXACT EMAIL, never by name, and somebody nobody has heard of
  // becomes a person typed VOLUNTEER — not a donor. They are not a donor
  // until they give, and typing them as one would put somebody who has never
  // given a penny into every donor list the office reads.
  const cleanEmail = email.trim().toLowerCase();
  const personId = await fundraiserPerson(org.id, name.trim(), cleanEmail,
    { id: "system:p2p-signup", name: "The fundraiser, from the sign-up page" });

  const base = slugifyGivingPage(name);
  const id = "pf_" + uuid().slice(0, 8);
  const editToken = generateEditToken();
  const editTokenHash = require("crypto").createHash("sha256").update(editToken).digest("hex");

  // uniquePeerFundraiserSlug's own SELECT check has a narrow TOCTOU window
  // against a second near-simultaneous submission slugifying to the same
  // base — the unique index (giving_page_id, slug) is the real guarantee,
  // this retry loop just turns that rare race into a friendly re-slug
  // instead of a raw 500.
  let slug = await uniquePeerFundraiserSlug(givingPage.id, base);
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    try {
      await run(
        // The token is stored as its SHA-256 and nowhere else (BUILD-103): the
        // manage link is the whole auth model, so it is held the way every
        // other credential in this codebase is held.
        // PARITY-2 Part 2: a page that asks for approval writes the new
        // fundraiser 'pending': not public and taking no gifts until a staff
        // member approves it. Off by default, so 'active' as before.
        `INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, personal_goal_amount, story, image_url, status, edit_token, edit_token_hash, team_id, person_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
        [id, org.id, givingPage.id, name.trim(), cleanEmail, slug, personalGoalAmount ? parseFloat(personalGoalAmount) : null, story || "", imageUrl || "",
         givingPage.p2p_requires_approval === true ? "pending" : "active", editTokenHash, teamId, personId]
      );
      inserted = true;
    } catch (e) {
      if (attempt === 2) throw e;
      slug = await uniquePeerFundraiserSlug(givingPage.id, `${base}-${Date.now().toString(36).slice(-4)}`);
    }
  }

  // WIRE-1: starting a page is a line on the fundraiser's own timeline.
  await TL.timelineLine({ orgId: org.id, donorId: personId, note: `Started a fundraising page: ${givingPage.title}.`,
    actorId: "system:p2p-signup", actorName: "The fundraiser, from the sign-up page", key: `p2p_page:${id}`,
    metadata: { via: "peer_fundraiser", fundraiser_id: id, giving_page_id: givingPage.id } });

  // PARITY-2 Part 2: the person who starts a team is its captain. Staff can
  // change it from the P2P screen.
  if (startedTeam && teamId) {
    await run(`UPDATE p2p_teams SET captain_fundraiser_id=?, updated_at=NOW() WHERE id=? AND org_id=? AND captain_fundraiser_id IS NULL`,
      [id, teamId, org.id]);
  }
  const pending = givingPage.p2p_requires_approval === true;
  // WIRE-1: a page waiting for approval is a task for an admin, linked to the
  // person, so it is somebody's job and not a row nobody opens.
  if (pending && openAdminTask) {
    await openAdminTask(org.id, {
      title: `Approve ${name.trim()}'s fundraising page for ${givingPage.title || "a giving page"}`, priority: "high",
      donorId: personId || null, actorId: "system:p2p-signup", actorName: "The fundraiser, from the sign-up page",
    }).catch(e => console.error("[p2p] approval task:", e.message));
  }

  const frontendUrl = publicAppUrl();
  const publicUrl = `${frontendUrl}/give/${req.params.orgSlug}/${req.params.pageSlug}/${slug}`;
  const manageUrl = `${frontendUrl}/fundraiser/manage/${editToken}`;

  // manageUrl/editToken are deliberately NOT returned here. invites.token
  // is the same "long random value, stored, looked up directly" shape, but
  // invites are minted by an authenticated admin (requireAuth+requireAdmin)
  // for someone they're accountable for, so returning the link in that
  // response is safe. This route is fully public and unauthenticated —
  // returning the token directly would let anyone submit a stranger's real
  // name+email and get durable control of a fundraiser attributed to them
  // instantly, with the stranger left holding an unsolicited email and no
  // recourse (no password to reset). Email is the only legitimate channel;
  // the frontend redirects to publicUrl and surfaces emailSent so a failed
  // send is visible instead of silently stranding the supporter.
  const emailSent = await sendFundraiserManageEmail(org, { name: name.trim(), email: email.trim() }, givingPage, manageUrl, { pending });

  // FIX-7 Part 6.2 — the demonstration org mails nobody. The sign-up still
  // works and the page still exists; the screen says what would have arrived
  // and where, rather than showing a failed send or nothing at all.
  const demoNote = await demoMailNote(org.id, { what: "the link to their fundraiser dashboard", to: cleanEmail });
  res.status(201).json({ id, slug, publicUrl, emailSent, teamId, pending,
    ...(pending ? { pendingSentence: `${displayNameCase(org.name)} looks at every new page before it goes live. Yours is waiting for them now, and the link to manage it is in your email.` } : {}),
    ...(demoNote ? { demoNote } : {}) });
}));

// FIX-28: STAFF ADD A FUNDRAISER FOR SOMEBODY. The same person match and the
// same token shape as the public sign-up, but nobody is emailed: the manage
// link comes back to the staff member who made the page (an admin accountable
// for it, the way an invite link does), and they decide how to pass it on.
// Staff made it, so it is live at once whatever the approval setting.
app.post("/giving-pages/:id/fundraisers", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { name, email, personalGoalAmount } = req.body || {};
  if (!name || !String(name).trim() || !email || !String(email).trim()) return res.status(400).json({ error: "A name and an email are needed. The email is how Steward finds the person." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: "That email does not look right." });
  if (String(name).trim().length > 200 || String(email).trim().length > 320) return res.status(400).json({ error: "The name or email is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "The goal must be a positive number." });
  const [page] = await query("SELECT id, slug, title, p2p_enabled FROM giving_pages WHERE id=? AND org_id=? AND status='active'", [req.params.id, orgId]);
  if (!page) return res.status(404).json({ error: "That campaign could not be found." });
  if (page.p2p_enabled !== true) return res.status(400).json({ error: "Turn peer-to-peer on for this campaign first." });
  let teamId = null;
  if (req.body.teamId) {
    const [t] = await query("SELECT id FROM p2p_teams WHERE id=? AND giving_page_id=? AND org_id=? AND status='active'", [String(req.body.teamId), page.id, orgId]);
    if (!t) return res.status(404).json({ error: "That team is not on this campaign." });
    teamId = t.id;
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const personId = await fundraiserPerson(orgId, String(name).trim(), cleanEmail, actor(req));
  const [o] = await query("SELECT org_slug FROM orgs WHERE id=?", [orgId]);
  const id = "pf_" + uuid().slice(0, 8);
  const editToken = generateEditToken();
  const editTokenHash = require("crypto").createHash("sha256").update(editToken).digest("hex");
  const base = slugifyGivingPage(String(name));
  let slug = await uniquePeerFundraiserSlug(page.id, base);
  for (let attempt = 0; ; attempt++) {
    try {
      await run(
        `INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, personal_goal_amount, story, image_url, status, edit_token, edit_token_hash, team_id, person_id)
         VALUES (?,?,?,?,?,?,?,'','','active',NULL,?,?,?)`,
        [id, orgId, page.id, String(name).trim(), cleanEmail, slug, personalGoalAmount ? parseFloat(personalGoalAmount) : null, editTokenHash, teamId, personId]);
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      slug = await uniquePeerFundraiserSlug(page.id, `${base}-${Date.now().toString(36).slice(-4)}`);
    }
  }
  { const who = await staffWho(req);   // WIRE-1: on the fundraiser's timeline
    await TL.timelineLine({ orgId, donorId: personId, note: `Started a fundraising page: ${page.title}.`,
      actorId: who.id, actorName: who.name, key: `p2p_page:${id}`,
      metadata: { via: "peer_fundraiser", fundraiser_id: id, giving_page_id: page.id } }); }
  const frontendUrl = publicAppUrl();
  res.status(201).json({ id, slug, teamId, personId,
    publicUrl: `${frontendUrl}/give/${o?.org_slug || ""}/${page.slug}/${slug}`,
    manageUrl: `${frontendUrl}/fundraiser/manage/${editToken}`,
    sentence: `${String(name).trim()}'s page is live. Nobody was emailed; copy their manage link and send it to them yourself.` });
}));

// Public — fundraiser's own page: name/image/story/goal + real live
// progress computed the same way the parent page's is (never a manually-set
// number). Includes the parent givingPage's fund designation so the shared
// Donate.jsx form's "hide fund selector when the page already designates
// one" logic keeps working unmodified one level down. A fundraiser 404s the
// same way an archived/nonexistent giving page does (indistinguishable from
// "never existed") if either the fundraiser OR its parent page is archived —
// a fundraiser cannot outlive its campaign's own availability.
app.get("/org/:orgSlug/giving-page/:pageSlug/fundraiser/:fundraiserSlug/public", wrap(async (req, res) => {
  const orgs = await query(`SELECT o.id, o.name, o.mission, o.cover_fees_enabled, o.form_upsell_threshold_cents,
          o.form_upsell_monthly_cents,
          o.fee_rate_card_pct, o.fee_rate_card_flat_cents,
          o.fee_rate_ach_pct, o.fee_rate_ach_flat_cents, o.fee_rate_ach_cap_cents,
          ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug = ?`, [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  org.donor_facing_name = String(org.display_name || "").trim() || org.name; // W-2 white-label

  const pageRows = await query(
    `SELECT gp.*, to_char(gp.ends_on,'YYYY-MM-DD') AS page_ends_on, f.name AS fund_name FROM giving_pages gp LEFT JOIN fin_funds f ON f.id = gp.fund_id
     WHERE gp.org_id = ? AND gp.slug = ? AND gp.status = 'active'`,
    [org.id, req.params.pageSlug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const page = pageRows[0];

  const fRows = await query(
    `SELECT pf.*, COALESCE((SELECT SUM(amount) FROM gifts WHERE peer_fundraiser_id = pf.id AND ${NOT_DELETED("gifts")}), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.giving_page_id=? AND pf.slug=? AND pf.status='active'`,
    [page.id, req.params.fundraiserSlug]
  );
  if (!fRows.length) return res.status(404).json({ error: "This fundraiser could not be found." });
  const f = fRows[0];

  // PARITY-2 Part 2: what a fundraiser's own page shows beyond the bar: the
  // team it belongs to, the recent donors (a first name only where the donor
  // chose to show it publicly, otherwise Anonymous, and the amount), the
  // share links with their UTM tags and the campaign's countdown.
  const P2Pm = await import("../shared/p2p.js");
  const CPm = await campaignPageMod();
  const [team] = f.team_id ? await query(`SELECT name, slug FROM p2p_teams WHERE id=? AND org_id=? AND status='active'`, [f.team_id, org.id]) : [];
  const recentRows = await query(
    `SELECT g.date, g.amount, g.cover_fee_amount, g.show_name_publicly, d.name AS donor_name
       FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND g.peer_fundraiser_id = ? AND g.amount > 0
      ORDER BY g.date DESC NULLS LAST, g.created_at DESC LIMIT 10`, [org.id, f.id]);
  const [{ n: donorN } = { n: 0 }] = await query(
    `SELECT COUNT(DISTINCT donor_id)::int AS n FROM gifts WHERE org_id = ? AND peer_fundraiser_id = ? AND amount > 0`, [org.id, f.id]);
  const [camp] = page.campaign_id ? await query(`SELECT to_char(end_date,'YYYY-MM-DD') AS end_date FROM campaigns WHERE id=? AND org_id=?`, [page.campaign_id, org.id]) : [];
  const endDate = camp?.end_date || page.page_ends_on || null;
  const raisedCents = Math.round((parseFloat(f.raised_amount) || 0) * 100);
  const goalCents = f.personal_goal_amount != null ? Math.round(Number(f.personal_goal_amount) * 100) : null;
  const shareUrl = `${publicAppUrl()}/give/${req.params.orgSlug}/${page.slug}/${f.slug}`;

  res.json({
    org: { name: org.donor_facing_name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false, ...(await coverFeePayload(org)), givingAccount: !!(await givingAccountEntry({ id: org.id, org_slug: req.params.orgSlug })), theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true },
    givingPage: { id: page.id, slug: page.slug, title: page.title, fundId: page.fund_id, fundName: page.fund_name || null, p2pEnabled: page.p2p_enabled === true },
    peerFundraiser: {
      id: f.id, slug: f.slug, name: f.name, story: f.story, imageUrl: f.image_url,
      cover: f.image_url ? { url: f.image_url, ...(f.image_meta || {}) } : null,
      personalGoalAmount: f.personal_goal_amount != null ? parseFloat(f.personal_goal_amount) : null,
      raisedAmount: parseFloat(f.raised_amount) || 0,
      raisedSentence: P2Pm.publicRaisedSentence({ name: f.name, raisedCents, goalCents }),
      donorCount: donorN,
      donorCountLine: P2Pm.donorCountLine(donorN),
      team: team ? { name: team.name, slug: team.slug } : null,
      recentDonors: recentRows.map(r => CPm.publicGiftLine({
        donorName: r.donor_name,
        amountCents: Math.round(Number(r.amount) * 100),   // FIX-49: the full gift, a covered fee included
        showName: r.show_name_publicly === true, date: r.date }, { showAmounts: true })),
      recentDonorsSentence: P2Pm.RECENT_DONORS_SENTENCE,
      share: P2Pm.shareLinks({ link: shareUrl, fundraiserSlug: f.slug,
        text: `I'm raising money for ${page.title || org.donor_facing_name}.` }),
      endDate,
      countdown: endDate ? CPm.countdownSentence(endDate, orgToday(await orgTz(org.id))) : null,   // ORG_TZ_SEAM_OK: the org's own day
    },
    funds: [],
  });
}));

// POST /photos/run — drive the queue for the caller's org NOW. The ops/test
// hook, same bar as /geocode/run: admin, org-scoped, and the only way a suite
// gets a deterministic drain without waiting on a tick.
app.post("/photos/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await processPhotoQueue({ orgId: req.user.orgId, limit: Math.min(parseInt(req.body?.limit, 10) || PHOTO_FETCH_BUDGET, 1000) }));
}));

// POST /geocode/run — drive the queue for the caller's org NOW. The ops/test
// hook, same bar as POST /nudges/run. {mark:true} re-derives every donor's
// key first (what an import does); {limit} caps the spend.
app.post("/geocode/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const marked = req.body && req.body.mark ? await markDonorsForGeocoding(req.user.orgId) : null;
  const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || GEOCODE_TICK_BUDGET, 1), 5000);
  const out = await processGeocodeQueue({ limit, orgId: req.user.orgId });
  res.json({ marked, ...out });
}));

// GET /geocode/status — what the map needs to describe itself in a sentence:
// the counts by status and whether a provider is configured at all. A read
// path, and it makes NO provider call.
app.get("/geocode/status", requireAuth, wrap(async (req, res) => {
  const cfg = geocode.providerConfig();
  const rows = await query(
    `SELECT COALESCE(geocode_status, 'pending') AS s, COUNT(*)::int AS c
       FROM donors WHERE org_id = ? AND deleted_at IS NULL GROUP BY 1`, [req.user.orgId]);
  const counts = Object.fromEntries(geocode.GEOCODE_STATUSES.map(s => [s, 0]));
  for (const r of rows) counts[r.s] = (counts[r.s] || 0) + r.c;
  res.json({ provider: cfg.name, reason: cfg.reason || null, counts,
             total: Object.values(counts).reduce((a, b) => a + b, 0) });
}));

// ── Voice memos ──────────────────────────────────────────────────────────────
// Two-step, human-in-the-loop flow: /transcribe uploads + transcribes audio
// and runs one narrow AI extraction pass, but saves NOTHING — the officer
// reviews the transcript and suggestions client-side and only /save persists
// anything (the interaction, and optionally the extracted detail/task, only
// if the officer confirmed each). Requires OPENAI_API_KEY (Whisper) — if
// unset, returns a clear error rather than failing silently or falling back
// to a stub.
app.post("/voice-memos/transcribe", requireAuth, wrap(async (req, res) => {
  const { donorId, audioBase64, mimeType } = req.body;
  if (!donorId || !audioBase64) return res.status(400).json({ error: "A donor and a recording are both needed." });
  if (!process.env.OPENAI_API_KEY) {
    console.error("[voice-memo] transcription refused: no transcription key is configured on this server");
    return res.status(503).json({ error: "Voice notes aren't available yet. We'll let you know when they are." });
  }

  const donorRows = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });

  let transcript;
  // FIX-12 Part 3: the recording goes to OpenAI only through the one AI door,
  // which refuses when the org has AI turned off.
  try { await requireAi(req.user.orgId, "openai"); }
  catch (e) { if (e instanceof AiOffError) return res.status(403).json({ error: AI_OFF_MESSAGE, code: "ai_off" }); throw e; }
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const ext = (mimeType || "").includes("mp4") ? "mp4" : (mimeType || "").includes("wav") ? "wav" : "webm";
    const whisperResp = await transcribeAudio(req.user.orgId, { audioBuffer, mimeType, ext });
    if (!whisperResp.ok) {
      const errText = await whisperResp.text();
      console.error("[voice-memo] Whisper error:", whisperResp.status, errText);
      return res.status(502).json({ error: "Transcription failed, please try again." });
    }
    const whisperJson = await whisperResp.json();
    transcript = (whisperJson.text || "").trim();
  } catch (e) {
    console.error("[voice-memo] transcription failed:", e.message);
    return res.status(502).json({ error: "Transcription failed: " + e.message });
  }

  if (!transcript) return res.json({ transcript: "", suggestedDetail: null, suggestedAction: null });

  // Single narrow extraction pass — not a general chatbot, one specific job.
  let suggestedDetail = null, suggestedAction = null;
  try {
    const client = anthropicFor(req.user.orgId);
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      thinking: { type: "disabled" },   // FIX-28: a short extraction needs no thinking (the ASK-3 rule)
      system: `Extract from a voice memo a nonprofit development officer just recorded about a donor. Return ONLY valid JSON: {"personalDetail":"..." or null,"suggestedAction":"..." or null}, no markdown, no explanation. personalDetail: one short, specific, worth-remembering fact about the donor (family, interests, preferences, life event) mentioned in the memo, null if nothing like that was mentioned. suggestedAction: one short, concrete next step implied by the memo (e.g. "Send the gala invite", "Follow up after their trip in March"), null if none is implied.`,
      messages: [{ role: "user", content: `Donor: ${donorRows[0].name}\nTranscript: ${transcript}` }],
    });
    // FIX-28: an unfinished reply suggests nothing.
    const text = msg.stop_reason && msg.stop_reason !== "end_turn" ? ""
      : (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      suggestedDetail = parsed.personalDetail || null;
      suggestedAction = parsed.suggestedAction || null;
    }
  } catch (e) {
    console.error("[voice-memo] extraction failed (non-fatal, transcript still returned):", e.message);
  }

  res.json({ transcript, suggestedDetail, suggestedAction });
}));

app.post("/voice-memos/save", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { donorId, transcript, addDetailToNotes, detailText, createFollowUpTask, actionText } = req.body;
  if (!donorId || !transcript) return res.status(400).json({ error: "donorId and transcript required" });
  const donorRows = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });
  const donor = donorRows[0];

  const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)",
    ["i_" + uuid().slice(0, 8), req.user.orgId, donorId, "voice_memo", transcript, today, req.user.userId]
  );

  // Both of these are opt-in — the officer explicitly confirmed each one
  // client-side before this request was sent. Nothing AI-inferred is saved
  // to the donor record without that confirmation.
  if (addDetailToNotes && detailText && detailText.trim()) {
    const updatedNotes = donor.notes ? `${donor.notes}\n\n${detailText.trim()}` : detailText.trim();
    await run("UPDATE donors SET notes=? WHERE id=? AND org_id=?", [updatedNotes, donorId, req.user.orgId]);
  }

  let taskId = null;
  if (createFollowUpTask && actionText && actionText.trim()) {
    taskId = "t_" + uuid().slice(0, 8);
    const due = new Date(); due.setDate(due.getDate() + 7);
    await run(
      "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name) VALUES (?,?,?,?,?,?,0,?,?,?)",
      [taskId, req.user.orgId, actionText.trim(), due.toISOString().slice(0, 10), "medium", "donor", donorId, actor(req).id, actor(req).name]
    );
  }

  res.json({ success: true, taskId });
}));
const cfDefOut = d => ({
  id: d.id, entity: d.entity, key: d.key, label: d.label, type: d.type,
  options: Array.isArray(d.options) ? d.options : JSON.parse(d.options || "[]"),
  position: d.position, showInDirectory: !!d.show_in_directory,
  archivedAt: d.archived_at || null, createdBy: d.created_by || null,
  createdByName: d.created_by_name || null, createdSource: d.created_source || null,
  createdAt: d.created_at,
});

app.get("/custom-fields", requireAuth, wrap(async (req, res) => {
  const entity = String(req.query.entity || "donor").toLowerCase();
  if (!CF_ENTITIES.includes(entity)) return res.status(400).json({ error: "entity must be donor or gift" });
  const defs = await loadCfDefs(entity, req.user.orgId, { includeArchived: req.query.includeArchived === "1" });
  res.json(defs.map(cfDefOut));
}));

// BUILD-80 Part 10 — the KEPT-RAW surface (BUILD-78's named gap): every
// stored custom value that does not coerce under its field's current type,
// listed with donor, field and value so an admin can fix it in place (the
// fix goes through the normal validated donor-update path). The population
// is a frozen migration artifact — no write path can add to it — but it must
// not sit there quietly forever.
app.get("/custom-fields/kept-raw", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { coerceCustomValue } = await cfShape();
  const orgId = req.user.orgId;
  const defs = await loadCfDefs("donor", orgId, {});
  const byKey = new Map(defs.map(d => [d.key, d]));
  const rows = await query(
    "SELECT id, name, custom_fields FROM donors WHERE org_id=? AND deleted_at IS NULL AND custom_fields IS NOT NULL", [orgId]);
  const keptRaw = [];
  for (const r of rows) {
    let cf = r.custom_fields;
    if (typeof cf === "string") { try { cf = JSON.parse(cf); } catch { continue; } }
    if (!cf || typeof cf !== "object") continue;
    for (const [k, v] of Object.entries(cf)) {
      const def = byKey.get(k);
      if (!def) { keptRaw.push({ donorId: r.id, donorName: r.name, key: k, label: k, value: v, problem: "no field definition" }); continue; }
      const c = coerceCustomValue(def, v);
      if (!c.ok) keptRaw.push({ donorId: r.id, donorName: r.name, key: k, label: def.label, type: def.type, value: v, problem: c.errors?.[0] || "does not match the field's type" });
    }
    if (keptRaw.length >= 500) break;
  }
  res.json({ keptRaw, count: keptRaw.length });
}));

// The fix-in-place: one donor, one key, one corrected value — validated
// through the SAME seam every other custom-field write uses.
app.put("/custom-fields/kept-raw/:donorId", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  const [donor] = await query("SELECT id, custom_fields FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.donorId, orgId]);
  if (!donor) return res.status(404).json({ error: "donor not found" });
  const v = await validateCustomFields("donor", orgId, { [key]: value });
  if (!v.ok) return res.status(422).json({ error: "invalid value", details: v.errors });
  let cf = donor.custom_fields;
  if (typeof cf === "string") { try { cf = JSON.parse(cf); } catch { cf = {}; } }
  cf = { ...(cf || {}), ...v.values };
  if (value === "" || value === null) delete cf[key];
  await run("UPDATE donors SET custom_fields=?, updated_at=NOW() WHERE id=?", [JSON.stringify(cf), donor.id]);
  res.json({ ok: true, stored: v.values[key] ?? null });
}));

app.post("/custom-fields", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { CF_TYPES, CF_LIMITS, generateFieldKey } = await cfShape();
  const entity = String(req.body.entity || "donor").toLowerCase();
  if (!CF_ENTITIES.includes(entity)) return res.status(400).json({ error: "entity must be donor or gift" });
  const label = String(req.body.label || "").trim();
  const type = String(req.body.type || req.body.fieldType || "").trim();
  if (!label) return res.status(400).json({ error: "label required" });
  if (label.length > CF_LIMITS.LABEL_MAX) return res.status(400).json({ error: `label is over the ${CF_LIMITS.LABEL_MAX}-character limit` });
  if (!CF_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${CF_TYPES.join(", ")}` });
  const wantsOptions = type === "select" || type === "multi_select";
  const options = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(o => String(o).trim()).filter(Boolean))];
  if (wantsOptions && !options.length) return res.status(400).json({ error: "select fields need at least one option" });
  if (!wantsOptions && options.length) return res.status(400).json({ error: `a ${type} field does not take options` });
  if (options.length > CF_LIMITS.OPTIONS_PER_SELECT)
    return res.status(400).json({ error: `that is ${options.length} options, the limit is ${CF_LIMITS.OPTIONS_PER_SELECT}. Past that a select is free text wearing a costume; consider a text field.` });

  // The 40-field cap counts LIVE fields; archiving frees a slot, and restore
  // is never blocked by the cap (restore must always work — spec 1.6).
  const live = await query(`SELECT COUNT(*)::int AS n FROM custom_field_defs WHERE org_id=? AND entity=? AND archived_at IS NULL`, [req.user.orgId, entity]);
  if (live[0].n >= CF_LIMITS.FIELDS_PER_ENTITY)
    return res.status(400).json({ error: `this org already has ${live[0].n} ${entity} fields, the limit is ${CF_LIMITS.FIELDS_PER_ENTITY}. Archive fields you no longer use to make room.` });

  const existingKeys = (await query(`SELECT key FROM custom_field_defs WHERE org_id=? AND entity=?`, [req.user.orgId, entity])).map(r => r.key);
  const key = generateFieldKey(label, existingKeys);   // immutable forever from here
  const maxPos = await query(`SELECT COALESCE(MAX(position),0) AS mp FROM custom_field_defs WHERE org_id=? AND entity=?`, [req.user.orgId, entity]);
  const id = "cfd_" + uuid().slice(0, 12);
  const source = req.body.source ? String(req.body.source).slice(0, 200) : null;
  await run(
    `INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,position,created_by,created_by_name,created_source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, entity, key, label, type, JSON.stringify(options), (maxPos[0]?.mp || 0) + 1,
     actor(req).id, actor(req).name, source]
  );
  await cfEvent(req, req.user.orgId, entity, "definition_created", { fieldId: id, detail: { key, label, type, source } });
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [id]);
  res.json(cfDefOut(field));
}));

// reorder MUST be before /:id
app.put("/custom-fields/reorder", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { ids } = req.body;
  const entity = String(req.body.entity || "donor").toLowerCase();
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  for (let i = 0; i < ids.length; i++) {
    await run(`UPDATE custom_field_defs SET position=? WHERE id=? AND org_id=? AND entity=?`, [i + 1, ids[i], req.user.orgId, entity]);
  }
  await cfEvent(req, req.user.orgId, entity, "definition_reordered", { detail: { ids } });
  res.json({ ok: true });
}));

app.put("/custom-fields/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { CF_LIMITS } = await cfShape();
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  // Type is IMMUTABLE after creation (spec 5.3): changing a type is a data
  // migration wearing a dropdown, and the honest version of it is out of
  // scope. The key never changes, period (1.2).
  if ((req.body.type || req.body.fieldType) && String(req.body.type || req.body.fieldType) !== field.type)
    return res.status(400).json({ error: "a field's type cannot change after creation, archive this field and create a new one" });
  if (req.body.key && req.body.key !== field.key)
    return res.status(400).json({ error: "a field's key never changes" });

  const label = req.body.label !== undefined ? String(req.body.label || "").trim() : field.label;
  if (!label) return res.status(400).json({ error: "label required" });
  if (label.length > CF_LIMITS.LABEL_MAX) return res.status(400).json({ error: `label is over the ${CF_LIMITS.LABEL_MAX}-character limit` });

  let options = Array.isArray(field.options) ? field.options : JSON.parse(field.options || "[]");
  if (req.body.options !== undefined) {
    const next = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(o => String(o).trim()).filter(Boolean))];
    if (field.type !== "select" && field.type !== "multi_select") {
      if (next.length) return res.status(400).json({ error: `a ${field.type} field does not take options` });
    } else {
      // Options can be ADDED, never removed or renamed here — a removed
      // option orphans every value that holds it. (An honest option
      // migration is future work; recorded in the findings.)
      const missing = options.filter(o => !next.includes(o));
      if (missing.length) return res.status(400).json({ error: `options cannot be removed: ${missing.join(", ")}: stored values still point at them` });
      if (next.length > CF_LIMITS.OPTIONS_PER_SELECT)
        return res.status(400).json({ error: `that is ${next.length} options: the limit is ${CF_LIMITS.OPTIONS_PER_SELECT}` });
      options = next;
    }
  }
  const showInDirectory = req.body.showInDirectory !== undefined ? !!req.body.showInDirectory : field.show_in_directory;
  await run(`UPDATE custom_field_defs SET label=?, options=?, show_in_directory=? WHERE id=? AND org_id=?`,
    [label, JSON.stringify(options), showInDirectory, req.params.id, req.user.orgId]);
  if (label !== field.label)
    await cfEvent(req, req.user.orgId, field.entity, "definition_renamed", { fieldId: field.id, detail: { from: field.label, to: label, key: field.key } });
  else
    await cfEvent(req, req.user.orgId, field.entity, "definition_updated", { fieldId: field.id, detail: { key: field.key } });
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));
}));

app.post("/custom-fields/:id/archive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  if (!field.archived_at) {
    await run(`UPDATE custom_field_defs SET archived_at=NOW() WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    await cfEvent(req, req.user.orgId, field.entity, "definition_archived", { fieldId: field.id, detail: { key: field.key, label: field.label } });
  }
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));
}));

app.post("/custom-fields/:id/restore", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  if (field.archived_at) {
    await run(`UPDATE custom_field_defs SET archived_at=NULL WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    await cfEvent(req, req.user.orgId, field.entity, "definition_restored", { fieldId: field.id, detail: { key: field.key, label: field.label } });
  }
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));   // restored — every value comes back with it, because none ever left
}));

// (the pre-BUILD-78 DELETE /custom-fields/:id is deliberately GONE — it
// deleted every stored value with the definition. Archive, never delete.)

app.get("/donors/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered
  const [donor] = await query(`SELECT custom_fields FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  const vals = donor?.custom_fields || {};
  const defs = await loadCfDefs("donor", req.user.orgId);
  res.json(defs.map(d => ({ ...cfDefOut(d), value: vals[d.key] !== undefined ? vals[d.key] : null })));
}));

app.put("/donors/:id/custom-fields", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [donor] = await query(`SELECT id, custom_fields FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });
  const v = await validateCustomFields("donor", req.user.orgId, req.body.values || {});
  if (!v.ok) return res.status(422).json({ error: "some values were refused", errors: v.errors });
  const merged = mergeCustomValues(donor.custom_fields, v.values);
  await run(`UPDATE donors SET custom_fields=?::jsonb WHERE id=? AND org_id=?`, [JSON.stringify(merged), req.params.id, req.user.orgId]);
  await cfEvent(req, req.user.orgId, "donor", "values_written", { entityId: req.params.id, detail: { keys: Object.keys(v.values) } });
  res.json({ ok: true, customFields: merged });
}));

app.get("/gifts/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("gifts", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Gift not found" });
  const [gift] = await query(`SELECT custom_fields FROM gifts WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  const vals = gift?.custom_fields || {};
  const defs = await loadCfDefs("gift", req.user.orgId);
  res.json(defs.map(d => ({ ...cfDefOut(d), value: vals[d.key] !== undefined ? vals[d.key] : null })));
}));

app.put("/gifts/:id/custom-fields", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [gift] = await query(`SELECT id, custom_fields FROM gifts WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!gift) return res.status(404).json({ error: "Gift not found" });
  const v = await validateCustomFields("gift", req.user.orgId, req.body.values || {});
  if (!v.ok) return res.status(422).json({ error: "some values were refused", errors: v.errors });
  const merged = mergeCustomValues(gift.custom_fields, v.values);
  await run(`UPDATE gifts SET custom_fields=?::jsonb WHERE id=? AND org_id=?`, [JSON.stringify(merged), req.params.id, req.user.orgId]);
  await cfEvent(req, req.user.orgId, "gift", "values_written", { entityId: req.params.id, detail: { keys: Object.keys(v.values) } });
  res.json({ ok: true, customFields: merged });
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

// Per-donor health record for the DonorProfile status chip (Active/Payment
// failed/Recovering/Recovered/Canceled) — null if this donor never had a
// recurring gift that's failed a payment (donors.stripe_subscription_status
// alone can't distinguish "recovering" from "past_due").
app.get("/donors/:id/recurring-subscription", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const rows = await query(
    `SELECT id, stripe_subscription_id, amount, interval, status, failure_count, first_failed_at, last_failed_at, recovered_at, canceled_at
     FROM recurring_subscriptions WHERE donor_id=? AND org_id=? ORDER BY created_at DESC LIMIT 1`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows[0] || null);
}));

app.post("/pledges/process-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await processPledgeReminders();
  // FIX-45: how many of THIS org's pledges the sweep picked (never another org's ids).
  res.json({ success: true, picked: ((out && out.picked) || []).filter(r => r.orgId === req.user.orgId).length });
}));

// Everyday staff action, matching POST /recurring/:donorId/resend — resends
// the current step's reminder on demand without touching reminder_step/
// next_reminder_at, so a manual nudge never interferes with the automatic
// cadence.
app.post("/pledges/:id/resend", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT p.*, d.name AS donor_name, d.email AS donor_email
     FROM pledges p JOIN donors d ON d.id = p.donor_id
     WHERE p.id=? AND p.org_id=? AND p.status='open'`,
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "This pledge is not open." });
  const p = rows[0];
  if (!p.donor_email) return res.status(400).json({ error: "This donor has no email on file." });

  const decision = await donorMailDecision("pledge_reminder", p.donor_email, req.user.orgId);
  if (!decision.send) return res.status(400).json({ error: `Cannot send, ${decision.reason === "deceased" ? "this donor is marked deceased" : decision.reason === "do_not_contact" ? "this donor is marked do-not-contact" : `this donor's email is suppressed (${decision.reason})`}.` });

  const orgRows = await query(
    "SELECT id, name, org_slug, pledge_reminder_subject, pledge_reminder_body FROM orgs WHERE id=?", [req.user.orgId]
  );
  // FIX-15 Part 3: the provider's answer, not an assumed "Sent".
  // SEND-GATE-1: she pressed Send now; that press is the confirm for this one reminder.
  const confirm = await SEND_GATE.recordStaffConfirm({ orgId: req.user.orgId, to: p.donor_email, what: "Pledge reminder", by: actor(req) });
  const { sent } = await sendPledgeReminderEmail(orgRows[0], { name: p.donor_name, email: p.donor_email }, p, { _stewardConfirm: confirm });
  if (!sent) return res.status(502).json({ sent: false, error: "The email provider did not accept the reminder, so it was not sent. Try again in a few minutes." });
  res.json({ sent: true });
}));

// POST /gmail/auth-url — returns OAuth URL for frontend to redirect to
// ── INT-4 · THE OLD GMAIL HANDSHAKE IS GONE ────────────────────────────────
//
// What used to be here was `/gmail/auth-url` and a public `GET /gmail/callback`,
// and it had three problems that INT-OAUTH had already solved for every other
// provider:
//
//   1. THE STATE WAS THE BARE USER ID, UNSIGNED, and the callback trusted it.
//      Whoever completed a Google consent decided, by typing a different id in
//      the URL, whose Steward record the mailbox was filed against. Nothing
//      proved the person finishing the flow was the person who started it.
//   2. IT WROTE ON A GET, against the standing rule, from a route with no
//      session at all.
//   3. IT ASKED FOR `gmail.send`, a permission this product must never use.
//
// The flow now runs through `shared/oauth.js` like everything else: a signed
// state carrying the org, the user and a nonce; the provider lands the person
// on the APP; the app finishes with an authenticated POST; the tokens are
// sealed. Connect and disconnect are `/oauth/google/start`, `/oauth/google/complete`
// and `/oauth/google/disconnect`; the rest of the mailbox lives under /mailbox.
//
// `/gmail/status` and `/gmail/sync` are kept as thin readers over the new table
// so the Settings screen and the manual button keep working.
// THE OLD REDIRECT URI STILL WORKS, AND WRITES NOTHING.
//
// `GOOGLE_REDIRECT_URI` and the Google console both still name this path, and a
// deploy that broke every existing Gmail connection because a URL moved would
// be a self-inflicted outage. So this stays as a FORWARD-ONLY route: it reads
// nothing, writes nothing, and hands the query to the app, which finishes the
// handshake with an authenticated POST exactly as it does for every other
// provider. The token exchange replays the same redirect_uri that was stored
// when the flow started, so the value Google sees never disagrees with itself.
app.get("/gmail/callback", wrap(async (req, res) => {
  res.redirect(302, require("../publicUrl").oauthLandingUrl("google", req.query));
}));

app.get("/gmail/status", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    `SELECT address, status, paused, last_synced_at FROM mailbox_connections
      WHERE user_id=? AND org_id=? AND provider='google' AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId]);
  res.json({
    connected: !!row, email: row?.address || null, status: row?.status || null,
    paused: row?.paused === true, lastSyncedAt: row?.last_synced_at || null,
  });
}));

app.post("/gmail/sync", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    `SELECT id, paused FROM mailbox_connections
      WHERE user_id=? AND org_id=? AND provider='google' AND status='active'`,
    [req.user.userId, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "No Gmail connection found" });
  if (row.paused === true) return res.status(400).json({ error: "paused",
    sentence: "Logging is paused. Turn it back on and Steward will pick up from where it stopped." });
  syncGmail(req.user.userId, req.user.orgId).catch(e => console.error("[gmail-manual-sync]", e.message));
  res.json({ ok: true, message: "Sync started" });
}));

app.delete("/gmail/disconnect", requireAuth, wrap(async (req, res) => {
  const r = await run(
    `UPDATE mailbox_connections SET status='disconnected', credentials_sealed=NULL, token_expires_at=NULL,
            paused=false, updated_at=NOW()
      WHERE user_id=? AND org_id=? AND provider='google' AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId]);
  if (r && r.changes === 0) return res.status(404).json({ error: "No Gmail connection found" });
  res.json({ ok: true,
    sentence: "Disconnected. Steward will not read anything else from that mailbox, and the conversations already logged are still on the records." });
}));

// GET /gmail/thread/:donorId — last 20 email interactions for AI context
app.get("/gmail/thread/:donorId", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B
  // SECURE-3: her own screen's email history, so it opens (the one reader).
  const rows = SEALED_MAIL.openInteractions(await query(
    `SELECT id, org_id, type, note, body_sealed, body_key_id, date, created_at, metadata FROM interactions WHERE org_id=? AND donor_id=? AND type='email' ORDER BY created_at DESC LIMIT 20`,
    [req.user.orgId, req.params.donorId]
  ));
  res.json(rows.map(r => {
    const meta = r.metadata ? (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) : {};
    const m = (r.note || "").match(/^Subject: (.+?)(?:\n\n([\s\S]*))?$/);
    return {
      id: r.id,
      date: r.date,
      created_at: r.created_at,
      subject: m ? m[1] : "",
      snippet: m ? (m[2] || "").slice(0, 200) : (r.note || "").slice(0, 200),
      direction: meta.direction || "inbound",
      note: r.note || "",
    };
  }));
}));
function membershipLevelPayload(l, counts = null) {
  const priceCents = mbCents(l.price), fmvCents = mbCents(l.fmv);
  return { id: l.id, name: l.name, price: priceCents / 100, fmv: fmvCents / 100, deductible: (priceCents - fmvCents) / 100,
    term: l.term, termLabel: MB ? MB.TERM_LABEL[l.term] : l.term, scope: l.scope,
    picture: l.picture || null,   // FIX-41
    benefits: Array.isArray(l.benefits) ? l.benefits : [], active: l.active !== false,
    // PARITY-2 Part 1: the card's words, whether it is on the public page,
    // where it sorts, and the one frequency it may renew on by itself.
    description: l.description || "", hidden: l.hidden === true, position: Number(l.position) || 0,
    priceSuffix: MB ? MB.TERM_PRICE_SUFFIX[l.term] || "" : "",
    autoRenewFrequency: MB ? MB.autoRenewFrequency(l.term) : null,
    fmvSentence: MB ? MB.fmvSentence({ priceCents, fmvCents }) : null, counts };
}

app.get("/membership-levels", requireAuth, wrap(async (req, res) => {
  await MB_READY;
  const levels = await query(`SELECT * FROM membership_levels WHERE org_id=? ORDER BY active DESC, position, price`, [req.user.orgId]);
  const counts = await query(`SELECT level_id, status, COUNT(*)::int n FROM memberships WHERE org_id=? GROUP BY 1,2`, [req.user.orgId]);
  const by = {};
  for (const c of counts) (by[c.level_id] ||= { active: 0, grace: 0, lapsed: 0, cancelled: 0 })[c.status] = c.n;
  res.json({ levels: levels.map(l => membershipLevelPayload(l, by[l.id] || { active: 0, grace: 0, lapsed: 0, cancelled: 0 })) });
}));

// Prices and the value of benefits are the org's policy: admins set them.
app.post("/membership-levels", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  await MB_READY;
  const v = MB.validateLevel(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level, id = "mbl_" + uuid().slice(0, 8), who = actor(req);
  // A new level sorts last on the public page until somebody moves it.
  const [last] = await query(`SELECT COALESCE(MAX(position), 0)::int AS p FROM membership_levels WHERE org_id=?`, [req.user.orgId]);
  await run(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term,scope,benefits,description,hidden,position,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?)`,
    [id, req.user.orgId, L.name, L.priceCents / 100, L.fmvCents / 100, L.term, L.scope, JSON.stringify(L.benefits),
     L.description || null, L.hidden, (last?.p || 0) + 1, who.id, who.name]);
  res.status(201).json({ id, sentence: MB.fmvSentence(L) });
}));

// PARITY-2 Part 1: THE ORDER OF THE PUBLIC PAGE, in one write. Admin-only,
// like every other change to what is for sale. The body is every level id in
// the order wanted; an id that is not this org's is refused, not skipped.
// Registered ABOVE `/membership-levels/:id` so "order" is never read as an id.
app.put("/membership-levels/order", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
    return res.status(400).json({ error: "Send every level id once, in the order wanted." });
  const mine = await query(`SELECT id FROM membership_levels WHERE org_id=? AND id = ANY(?)`, [req.user.orgId, ids]);
  if (mine.length !== ids.length) return res.status(404).json({ error: "Not found" });
  const [all] = await query(`SELECT COUNT(*)::int AS n FROM membership_levels WHERE org_id=?`, [req.user.orgId]);
  if (all.n !== ids.length) return res.status(400).json({ error: "Send every level id once, in the order wanted." });
  await withTransaction(async client => {
    for (let i = 0; i < ids.length; i++)
      await runTx(client, `UPDATE membership_levels SET position=? WHERE id=? AND org_id=?`, [i + 1, ids[i], req.user.orgId]);
  });
  res.json({ ok: true, ids });
}));

// The words on a level (name, description, benefits) and whether it shows on
// the public page are anybody's with write access. What it COSTS, what it is
// worth, its term, scope and whether it is for sale at all stay admin-only:
// those are the org's policy and they change what a receipt says.
app.put("/membership-levels/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await MB_READY;
  const [l] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!l) return res.status(404).json({ error: "Not found" });
  const cur = membershipLevelPayload(l);
  const v = MB.validateLevel({ ...cur, ...req.body });
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level;
  const active = typeof req.body?.active === "boolean" ? req.body.active : l.active !== false;
  const policyChanged = L.priceCents !== mbCents(l.price) || L.fmvCents !== mbCents(l.fmv) || L.term !== l.term
    || L.scope !== l.scope || active !== (l.active !== false);
  if (policyChanged) {
    const [u] = await query(`SELECT role FROM users WHERE id=?`, [req.user.userId]);
    if (!u || u.role !== "admin") return res.status(403).json({ error: "Only an admin changes a level's price, value, term or whether it is for sale." });
  }
  await run(`UPDATE membership_levels SET name=?, price=?, fmv=?, term=?, scope=?, benefits=?::jsonb, active=?, description=?, hidden=?
              WHERE id=? AND org_id=?`,
    [L.name, L.priceCents / 100, L.fmvCents / 100, L.term, L.scope, JSON.stringify(L.benefits), active,
     L.description || null, L.hidden, l.id, req.user.orgId]);
  res.json({ ok: true, sentence: MB.fmvSentence(L) });
}));

// A level somebody has held cannot vanish from under their receipt; retire it
// (active=false) instead.
app.delete("/membership-levels/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [used] = await query(`SELECT COUNT(*)::int n FROM memberships WHERE level_id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (used?.n) return res.status(409).json({ error: "level_in_use", message: "People have held this level. It can be retired, not removed." });
  const { changes } = await run(`DELETE FROM membership_levels WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

app.post("/donors/:id/memberships", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [level] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [String(req.body?.levelId || ""), orgId]);
  if (!level) return res.status(404).json({ error: "Level not found" });
  if (level.active === false) return res.status(400).json({ error: `${level.name} is retired. Choose a current level.` });
  const startsOn = req.body?.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startsOn) ? req.body.startsOn : null;
  const idem = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 128) : null;
  try {
    const r = await enrollMembership({ orgId, donorId: req.params.id, level, startsOn, paid: req.body?.paid !== false,
      paymentMethod: req.body?.paymentMethod || null, idemKey: idem, who: actor(req) });
    res.status(r.duplicate ? 200 : 201).json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || e.message, message: e.message });
    throw e;
  }
}));

app.get("/donors/:id/memberships", requireAuth, wrap(async (req, res) => {
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT m.id, m.status, m.joined_on, m.starts_on, m.expires_on, m.gift_id, m.payment_method, m.source,
            l.id AS level_id, l.name AS level_name, l.term, l.scope
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id
      WHERE m.donor_id=? AND m.org_id=? ORDER BY m.starts_on DESC, m.created_at DESC`, [d.id, req.user.orgId]);
  res.json({ memberships: rows, current: rows.find(r => r.status === "active" || r.status === "grace") || null,
    sentence: "Memberships are counted apart from giving: the payment is a gift, and the part that bought benefits is not deductible." });
}));

// BUILD-101 Part 5 — THE MEMBER CARD. MEMBERS-2 moved the renderer to
// ../memberCard.js, because the member downloads the same card from their own
// page and two renderers is how the staff copy and the member's copy end up
// disagreeing about one membership.
const { renderMemberCardPdf } = require("../memberCard");

app.get("/memberships/:id/card.pdf", requireAuth, wrap(async (req, res) => {
  const [m] = await query(
    `SELECT m.*, l.name AS level_name, d.name AS donor_name FROM memberships m
       JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
      WHERE m.id=? AND m.org_id=?`, [req.params.id, req.user.orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  const theme = await resolveOrgBrandTheme(req.user.orgId).catch(() => null);
  let logo = null;
  if (theme?.logoDataUri && /^data:image\/(png|jpe?g);base64,/.test(theme.logoDataUri)) { try { logo = Buffer.from(theme.logoDataUri.split(",")[1], "base64"); } catch { logo = null; } }
  const pdf = await renderMemberCardPdf({ orgName: theme?.displayName || "", accent: theme?.band, logo,
    memberName: m.donor_name, levelName: m.level_name, expiresOn: m.expires_on, memberSince: m.joined_on });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="member-card-${m.id}.pdf"`);
  res.send(pdf);
}));

app.get("/memberships/lapsed", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT m.id, m.donor_id, d.name AS donor_name, l.name AS level_name, m.expires_on,
            COALESCE(m.status_changed_on, m.expires_on) AS lapsed_on,
            (SELECT COUNT(*)::int FROM memberships t WHERE t.org_id=m.org_id AND t.donor_id=m.donor_id
               AND t.status IN ('active','grace','lapsed','renewed')) AS membership_years,
            (SELECT MAX(g.date) FROM gifts g WHERE g.org_id=m.org_id AND g.donor_id=m.donor_id
               AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.org_id=g.org_id AND x.gift_id=g.id)) AS last_gift_date
       FROM memberships m
       JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
       JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND d.deleted_at IS NULL
      WHERE m.org_id=? AND m.status='lapsed' AND ${LAPSED_MEMBER_SQL}
      ORDER BY lapsed_on DESC, d.name LIMIT 1000`, [orgId]);
  res.json({
    members: rows.map(r => ({ ...r, lastGiftDate: r.last_gift_date ? String(r.last_gift_date).slice(0, 10) : null })),
    sentence: "People whose most recent membership has lapsed and who hold none now. Membership years counts the terms they held. A gift here means a gift that was not a membership payment, so someone can be a lapsed member and a current donor at once.",
  });
}));

app.get("/memberships", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const where = ["m.org_id=?"], args = [orgId];
  if (req.query.status && ["active", "grace", "lapsed", "cancelled"].includes(String(req.query.status))) { where.push("m.status=?"); args.push(String(req.query.status)); }
  // "Lapsed" means a PERSON who lapsed, once: their latest membership lapsed
  // and they hold none now (BUILD-101 Part 3 — the same predicate as the
  // Lapsed list, so the count and the list cannot disagree).
  if (req.query.status === "lapsed") where.push(LAPSED_MEMBER_SQL);
  if (req.query.levelId) { where.push("m.level_id=?"); args.push(String(req.query.levelId)); }
  const dir = req.query.sort === "expiry_desc" ? "DESC" : "ASC";
  const rows = await query(
    `SELECT m.id, m.donor_id, d.name AS donor_name, m.status, m.joined_on, m.starts_on, m.expires_on, m.gift_id,
            l.id AS level_id, l.name AS level_name, l.term,
            d.your_page_sent_at AS "yourPageSentAt", d.your_page_opened_at AS "yourPageOpenedAt"
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id JOIN donors d ON d.id=m.donor_id
      WHERE ${where.join(" AND ")} ORDER BY m.expires_on ${dir} NULLS LAST, d.name LIMIT 1000`, args);
  // REPORTS-4: each status count is the `members` source's value, so it
  // opens onto the memberships it counts. Before, the counts included deleted
  // people's memberships and the rows did not.
  const byStatus = {}, byStatusSource = {};
  for (const st of ["active", "grace", "lapsed", "cancelled"]) {
    byStatusSource[st] = { key: "members", params: { status: st } };
    byStatus[st] = (await figureSources.figureValue(orgId, byStatusSource[st])).value;
  }
  res.json({ members: rows, byStatus, byStatusSource,
    sentence: "Each person counts once per membership. Active and in-grace members hold a current membership; lapsed ones have passed their grace period. Their page says whether they have opened the page that holds their card, their renewal and their receipts." });
}));

// Cancelling stops a membership; it does not refund the gift (a refund is its
// own act on the gift). Never write-gated: a lapsed org can always stop one.
app.post("/memberships/:id/cancel", requireAuth, wrap(async (req, res) => {
  const r = await query(`UPDATE memberships SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
                          WHERE id=? AND org_id=? AND status IN ('active','grace') RETURNING id, donor_id, level_id`, [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  // WIRE-1: the cancel is on the member's timeline.
  const [lv] = await query("SELECT name FROM membership_levels WHERE id=? AND org_id=?", [r[0].level_id, req.user.orgId]);
  const who = await staffWho(req);
  await TL.timelineLine({ orgId: req.user.orgId, donorId: r[0].donor_id,
    note: `${lv ? lv.name + " membership" : "Membership"} cancelled.`, actorId: who.id, actorName: who.name,
    key: `membership_cancelled:${r[0].id}`, metadata: { via: "membership", membership_id: r[0].id } });
  res.json({ ok: true });
}));

// Public by slug, like the event tickets read: what a flyer would show, and
// what the receipt will call deductible, before she pays.
app.get("/org/:orgSlug/membership/:levelId/public", wrap(async (req, res) => {
  await MB_READY;
  const [org] = await query("SELECT id, name FROM orgs WHERE org_slug=?", [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const [l] = await query("SELECT * FROM membership_levels WHERE id=? AND org_id=? AND active IS NOT FALSE", [req.params.levelId, org.id]);
  if (!l) return res.status(404).json({ error: "Not found" });
  res.json({ orgName: await donorFacingOrgName(org.id, org.name).catch(() => org.name),
    level: publicLevelPayload(l) });
}));

// The public face of a level: what the card and the checkout state, and
// nothing about who holds it. One shape for the single-level page and the
// membership page, so the two cannot describe one level differently.
function publicLevelPayload(l) {
  const p = membershipLevelPayload(l);
  return { id: p.id, name: p.name, price: p.price, fmv: p.fmv, deductible: p.deductible, term: p.term, termLabel: p.termLabel,
           priceSuffix: p.priceSuffix, description: p.description, scope: p.scope, benefits: p.benefits,
           autoRenew: !!p.autoRenewFrequency, autoRenewFrequency: p.autoRenewFrequency, picture: p.picture };
}

// PARITY-2 Part 1: THE MEMBERSHIP PAGE (`/give/:orgSlug?memberships`). Every
// level that is for sale and not hidden, in the org's order, with the org's
// own theme so the page is theirs. Public by slug, like the single level.
app.get("/org/:orgSlug/memberships/public", wrap(async (req, res) => {
  await MB_READY;
  const [org] = await query(
    `SELECT o.id, o.name, ps.membership_cover, ${GIVE_THEME_COLS} FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.org_slug=?`,
    [req.params.orgSlug]);
  if (!org) return res.status(404).json({ error: "Not found" });
  const levels = await query(
    `SELECT * FROM membership_levels WHERE org_id=? AND active IS NOT FALSE AND hidden IS NOT TRUE
      ORDER BY position, price, name`, [org.id]);
  res.json({ orgName: String(org.display_name || "").trim() || org.name, slug: req.params.orgSlug,
    theme: giveThemePayload(org), portalSignIn: org.portal_enabled === true,
    cover: org.membership_cover || null,   // FIX-41: the membership page's cover photo
    levels: levels.map(publicLevelPayload) });
}));

app.post("/memberships/:id/renew", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const idem = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 128) : null;
  try {
    const r = await renewMembership({ orgId: req.user.orgId, membershipId: req.params.id, levelId: req.body?.levelId || null,
      paymentMethod: req.body?.paymentMethod || null, idemKey: idem, who: actor(req) });
    res.status(r.duplicate ? 200 : 201).json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || e.message, message: e.message });
    throw e;
  }
}));

// Ops/test hook (the /pledges/run-reminders bar). A pinned {today} is honoured
// only under TEST_MODE: production's tick passes no clock (the BUILD-94 rule).
app.post("/memberships/run-sweep", requireAuth, requireAdmin, wrap(async (req, res) => {
  const pinned = process.env.TEST_MODE && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.today || "")) ? String(req.body.today) : null;
  res.json(await processMembershipRenewals({ orgId: req.user.orgId, today: pinned }));
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

// ── Data export ────────────────────────────────────────────────────────────
// ═══ TRUST-2 · ONE PERSON'S DATA ════════════════════════════════════════════
// Owners and admins only. The export is a download, so the audit trail logs it
// as a disclosure. The erasure is audited as WHO erased WHOM and WHEN, and the
// row deliberately carries none of the erased details: the before/after the
// trail would otherwise copy off the record is replaced with a marker.
app.get("/donors/:id/export-data", requireAuth, requireAdmin, wrap(async (req, res) => {
  const PD = require("../personData");
  const data = await PD.exportPerson(req.user.orgId, req.params.id);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="person-${req.params.id}.json"`);
  res.send(JSON.stringify(data, null, 2));
}));
app.post("/donors/:id/erase", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const PD = require("../personData");
  if (req.body?.confirm !== "ERASE") return res.status(400).json({ error: "confirm_required", message: "Type ERASE to confirm. This cannot be undone." });
  req.audit.before({ erased: true }); req.audit.after({ erased: true });
  req.audit.entity("person", req.params.id, "A person (details erased)");
  req.audit.action("erased a person at their request");
  const out = await PD.erasePerson(req.user.orgId, req.params.id);
  if (!out) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, sentence: "Erased. Their gifts stay as anonymous gifts, so every total still matches. Nothing else about them is left." });
}));

// SECURE-1: the whole organization's data leaves with an admin, never with a
// staff login (the CSV and full exports below were already admin's).
app.get("/org/export", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date

  // BUILD-78: defs are the authority; values ride the rows (JSONB, keyed by
  // the immutable field key — a rename never changes what an export means).
  // Archived fields are excluded and their stored values untouched (6.3).
  const cfDonorDefs = await loadCfDefs("donor", orgId);
  const cfGiftDefs = await loadCfDefs("gift", orgId);
  const liveCf = (row, defs) => {
    const live = new Set(defs.map(f => f.key));
    const out = {};
    for (const f of defs) out[f.key] = row.custom_fields && row.custom_fields[f.key] !== undefined && live.has(f.key) ? row.custom_fields[f.key] : null;
    return out;
  };

  const [donors, gifts, pledges, grants, txns, events, attendees, campaigns, interactions, volunteers, board, tasks] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY name", [orgId]),
    query("SELECT g.*, d.name as donor_name FROM gifts g LEFT JOIN donors d ON d.id=g.donor_id WHERE g.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY g.date DESC NULLS LAST", [orgId]),
    query("SELECT pg.*, d.name as donor_name FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id WHERE pg.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY pg.created_at DESC", [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query("SELECT * FROM fin_transactions WHERE org_id=? ORDER BY date DESC NULLS LAST", [orgId]),
    query("SELECT * FROM events WHERE org_id=? ORDER BY date DESC NULLS LAST", [orgId]),
    query("SELECT ea.*, d.name as donor_name, e.name as event_name FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id LEFT JOIN events e ON e.id=ea.event_id WHERE ea.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY ea.created_at DESC", [orgId]),
    query("SELECT * FROM campaigns WHERE org_id=? ORDER BY created_at DESC", [orgId]),
    // SECURE-3: the org's own export is its whole record, so a synced email is
    // opened through the one reader, as it was in the clear before sealing.
    query("SELECT i.*, d.name as donor_name FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id WHERE i.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY i.date DESC NULLS LAST", [orgId]).then(rs => SEALED_MAIL.openInteractions(rs)),
    query("SELECT * FROM volunteers WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT * FROM board_members WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT t.*, d.name as donor_name FROM tasks t LEFT JOIN donors d ON d.id=t.donor_id WHERE t.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY t.due", [orgId]),
  ]);

  const donorsEnriched = donors.map(d => ({ ...d, custom_fields: liveCf(d, cfDonorDefs) }));
  const giftsEnriched = gifts.map(g => (g.custom_fields ? { ...g, custom_fields: liveCf(g, cfGiftDefs) } : g));

  // SECURE-2 item 8: the audit row says how many rows left, every table counted.
  if (req.audit) req.audit.rows([donors, gifts, pledges, grants, txns, events, attendees, campaigns, interactions, volunteers, board, tasks].reduce((n, a) => n + a.length, 0));
  res.setHeader("Content-Disposition", `attachment; filename="steward-export-${orgSlug}-${date}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    org: orgRows[0] || {},
    custom_field_defs: [...cfDonorDefs, ...cfGiftDefs].map(f => ({
      id: f.id, entity: f.entity, key: f.key, label: f.label, type: f.type, options: f.options, position: f.position,
    })),
    donors: donorsEnriched,
    gifts: giftsEnriched,
    planned_gifts: pledges,
    grants,
    transactions: txns,
    events,
    event_attendees: attendees,
    campaigns,
    interactions,
    volunteers,
    board_members: board,
    tasks,
  });
}));

// Full-file CSV builder for the org export zip — same cell encoding as the
// report CSVs (reportCsvCell: RFC-4180 quoting + formula-injection guard),
// plus a UTF-8 BOM so Excel opens accented donor names correctly. Columns
// are [label, getter] pairs; a getter is a row key or a function.
function toCsv(columns, rows) {
  // node-pg hands timestamptz columns back as Date objects, which String()
  // as "Fri Jun 12 2026 16:53:52 GMT+0000 (...)" \u2014 ISO is what a spreadsheet
  // (and any re-import) actually wants.
  const cell = v => reportCsvCell(v instanceof Date ? v.toISOString() : v);
  const header = columns.map(c => cell(c[0])).join(",");
  const lines = rows.map(r =>
    columns.map(c => cell(typeof c[1] === "function" ? c[1](r) : r[c[1]])).join(",")
  );
  return "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";
}

// The "your data is yours" export: one zip of clean, spreadsheet-openable
// CSVs of everything, streamed (archiver pipes straight to the response, so
// a big org never buffers a whole zip in memory). Admin-gated — this is a
// full-org PII dump, matching the billing/org-settings convention; staff can
// already export the per-view slices they see on screen. NEVER
// checkWriteAccess-gated: a lapsed (read_only) org must always be able to
// leave with its data — that's the whole point of the feature.
// Sample rows are INCLUDED, identified by an is_sample column where the
// table has one — honest and reversible (filter the column in a spreadsheet)
// beats silently dropping rows from "everything".
// ── BUILD-98 (switch) Part 8 — EVERYTHING, ONE BUTTON ──────────────────────
// Every table that carries this org's id, found by asking the database rather
// than by a list somebody has to remember to extend: a table added next month
// is in the export the day it exists. The org's own row comes first.
// NEVER write-gated (a lapsed org must always be able to leave with its data).
// Credentials, tokens and hashes are LEFT OUT by column name, and the ids of
// other organisations cannot appear because every read is `WHERE org_id = ?`.
const EXPORT_WITHHELD_COLUMN = /password|token|secret|sealed|(^|_)hash($|_)|api_key|credential|pdf_data/i;
app.get("/org/export/full", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const tables = (await query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' GROUP BY table_name ORDER BY table_name`)).map(r => r.table_name);
  const strip = row => { const o = {}; for (const [k, v] of Object.entries(row)) if (!EXPORT_WITHHELD_COLUMN.test(k)) o[k] = v; return o; };
  const [org] = await query(`SELECT * FROM orgs WHERE id=?`, [orgId]);
  const stamp = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="steward-everything-${(org && org.org_slug) || orgId}-${stamp}.json"`);
  res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"organization":${JSON.stringify(strip(org || {}))},` +
            `"withheld":${JSON.stringify("Passwords, sign-in secrets, tokens, key fingerprints and stored receipt PDFs are left out; the receipts themselves are in the tables.")},"tables":{`);
  let first = true, total = 0;
  for (const t of tables) {
    const rows = await query(`SELECT * FROM "${t.replace(/"/g, "")}" WHERE org_id=?`, [orgId]);
    res.write(`${first ? "" : ","}${JSON.stringify(t)}:${JSON.stringify(rows.map(strip))}`);
    first = false; total += rows.length;
  }
  if (req.audit) req.audit.rows(total);   // SECURE-2 item 8
  res.end("}}");
}));

app.get("/org/export/csv", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { ZipArchive } = require("archiver"); // archiver v8 API — class export, not a factory function
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date

  // BUILD-78: custom columns come from the defs table (live fields only,
  // headed with the current label) and the row JSONB, rendered per type.
  const cfDonorDefs = await loadCfDefs("donor", orgId);
  const cfGiftDefs = await loadCfDefs("gift", orgId);
  const { renderCustomValue } = await cfShape();

  const [donors, gifts, interactions, grants, pledges, plannedGifts, recurring, givingPages, peerFundraisers, receipts] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY name", [orgId]),
    query(`SELECT g.*, d.name AS donor_name, d.email AS donor_email,
             f.name AS fund_name, COALESCE(c.name, g.campaign) AS campaign_name,
             gp.title AS giving_page_title, pf.name AS peer_fundraiser_name
           FROM gifts g
           LEFT JOIN donors d ON d.id=g.donor_id
           LEFT JOIN fin_funds f ON f.id=g.fund_id
           LEFT JOIN campaigns c ON c.id=g.campaign_id
           LEFT JOIN giving_pages gp ON gp.id=g.giving_page_id
           LEFT JOIN peer_fundraisers pf ON pf.id=g.peer_fundraiser_id
           WHERE g.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY g.date DESC NULLS LAST`, [orgId]),
    query(`SELECT i.*, d.name AS donor_name, d.email AS donor_email, i.metadata->>'direction' AS direction
           FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id
           WHERE i.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY i.date DESC NULLS LAST`, [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query(`SELECT p.*, d.name AS donor_name, d.email AS donor_email
           FROM pledges p LEFT JOIN donors d ON d.id=p.donor_id
           WHERE p.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY p.due_date`, [orgId]),
    query(`SELECT pg.*, d.name AS donor_name, d.email AS donor_email
           FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id
           WHERE pg.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY pg.created_at DESC`, [orgId]),
    query(`SELECT r.*, d.name AS donor_name, d.email AS donor_email
           FROM recurring_subscriptions r LEFT JOIN donors d ON d.id=r.donor_id
           WHERE r.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY r.created_at DESC`, [orgId]),
    query(`SELECT gp.*, f.name AS fund_name FROM giving_pages gp
           LEFT JOIN fin_funds f ON f.id=gp.fund_id
           WHERE gp.org_id=? ORDER BY gp.created_at DESC`, [orgId]),
    // Explicit column list — edit_token is a supporter's own credential and
    // never leaves the system (same rule as the admin fundraiser routes).
    query(`SELECT pf.id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.status, pf.created_at,
             gp.title AS giving_page_title
           FROM peer_fundraisers pf LEFT JOIN giving_pages gp ON gp.id=pf.giving_page_id
           WHERE pf.org_id=? ORDER BY pf.created_at DESC`, [orgId]),
    query(`SELECT r.receipt_number, r.type, r.tax_year, r.amount, r.deductible_amount,
             r.sent_to, r.sent_at, r.voided_at, r.void_reason, r.created_at,
             d.name AS donor_name, d.email AS donor_email, g.date AS gift_date
           FROM receipts r LEFT JOIN donors d ON d.id=r.donor_id LEFT JOIN gifts g ON g.id=r.gift_id
           WHERE r.org_id=? ORDER BY r.created_at DESC`, [orgId]),
  ]);

  const joinTags = t => { try { return (Array.isArray(t) ? t : JSON.parse(t || "[]")).join("|"); } catch { return String(t || ""); } };

  const files = {
    "donors.csv": toCsv([
      ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
      ["City", "city"], ["State", "state"], ["Zip", "zip"], ["Country", "country"], ["Employer", "employer"],
      ["Stage", "stage"], ["Status (giving tier)", "status"],
      ["Total giving", "total_giving"], ["Last gift date", "last_gift_date"], ["Last gift amount", "last_gift_amount"],
      ["Gift count", "gift_count"], ["First gift date", "first_gift_date"],
      ["Assigned to", "assigned_to_name"], ["Planned giving", "planned_giving"],
      ["Wealth score", "wealth_score"], ["Capacity tier", "capacity_tier"],
      ["Tags", r => joinTags(r.tags)], ["Notes", "notes"], ["Sample data", "is_sample"], ["Created", "created_at"],
      ...cfDonorDefs.map(f => [f.label, r => renderCustomValue(f, (r.custom_fields || {})[f.key])]),
    ], donors),
    "gifts.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Date", "date"], ["Amount", "amount"], ["Type", "type"], ["Payment method", "payment_method"],
      ["Fund", "fund_name"], ["Campaign", "campaign_name"], ["Giving page", "giving_page_title"],
      ["Peer fundraiser", "peer_fundraiser_name"], ["Acknowledged", "acknowledgement_sent"],
      ["Notes", "notes"], ["Sample data", "is_sample"],
      ...cfGiftDefs.map(f => [f.label, r => renderCustomValue(f, (r.custom_fields || {})[f.key])]),
    ], gifts),
    "interactions.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Type", "type"], ["Date", "date"], ["Note", "note"],
      ["Logged by", "logged_by_name"], ["Direction", "direction"], ["Sample data", "is_sample"],
    ], interactions),
    "grants.csv": toCsv([
      ["Funder", "funder"], ["Program", "program"], ["Amount", "amount"], ["Received", "received"],
      ["Status", "status"], ["Deadline", "deadline"], ["Report due", "report_due"], ["Officer", "officer"],
      ["Description", "description"], ["Requirements", "requirements"], ["Notes", "notes"],
      ["Sample data", "is_sample"], ["Created", "created_at"],
    ], grants),
    "pledges.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Amount", "amount"], ["Due date", "due_date"], ["Status", "status"],
      ["Fulfilled by gift", "fulfilled_gift_id"], ["Fulfilled at", "fulfilled_at"],
      ["Notes", "notes"], ["Created", "created_at"],
    ], pledges),
    "planned_gifts.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Type", "type"], ["Estimated value", "estimated_value"], ["Date indicated", "date_indicated"],
      ["Notes", "notes"], ["Created", "created_at"],
    ], plannedGifts),
    "recurring.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Amount", "amount"], ["Interval", "interval"], ["Status", "status"],
      ["Failure count", "failure_count"], ["First failed", "first_failed_at"],
      ["Card fixed", "recovered_at"], ["Canceled", "canceled_at"],
      ["Stripe subscription", "stripe_subscription_id"], ["Created", "created_at"],
    ], recurring),
    "giving_pages.csv": toCsv([
      ["Title", "title"], ["Slug", "slug"], ["Goal", "goal_amount"], ["Fund", "fund_name"],
      ["Status", "status"], ["Story", "story"], ["Created", "created_at"],
    ], givingPages),
    "peer_fundraisers.csv": toCsv([
      ["Name", "name"], ["Email", "email"], ["Slug", "slug"], ["Giving page", "giving_page_title"],
      ["Personal goal", "personal_goal_amount"], ["Status", "status"], ["Story", "story"], ["Created", "created_at"],
    ], peerFundraisers),
    "receipts.csv": toCsv([
      ["Receipt number", "receipt_number"], ["Type", "type"], ["Tax year", "tax_year"],
      ["Donor name", "donor_name"], ["Donor email", "donor_email"], ["Gift date", "gift_date"],
      ["Amount", "amount"], ["Deductible amount", "deductible_amount"],
      ["Sent to", "sent_to"], ["Sent at", "sent_at"], ["Voided at", "voided_at"], ["Void reason", "void_reason"],
      ["Created", "created_at"],
    ], receipts),
  };

  const counts = { donors, gifts, interactions, grants, pledges, planned_gifts: plannedGifts, recurring, giving_pages: givingPages, peer_fundraisers: peerFundraisers, receipts };
  const readme = [
    `Steward data export · ${orgRows[0]?.name || orgId}`,
    `Exported: ${new Date().toISOString()}`,
    "",
    "This zip contains your organization's complete data as CSV files you can",
    "open in any spreadsheet, import into another system, or archive. Rows",
    "flagged in a \"Sample data\" column came from Steward's demo dataset and",
    "can be filtered out. Your data is yours, this export is available",
    "anytime, including after a subscription ends.",
    "",
    "Row counts:",
    ...Object.entries(counts).map(([k, rows]) => `  ${k}.csv: ${rows.length}`),
    "",
  ].join("\n");

  // Headers go on only after every query has succeeded, so a DB error still
  // returns a clean JSON 500 instead of a half-written zip.
  if (req.audit) req.audit.rows(Object.values(counts).reduce((n, rows) => n + rows.length, 0));   // SECURE-2 item 8
  res.setHeader("Content-Type", "application/zip");
  const filename = `steward-export-${orgSlug}-${date}.zip`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // ── FIX-6 item 4 · THE SCREEN CAN SAY WHAT LEFT ──────────────────────────
  // The export worked and said nothing: the button read "Building export…",
  // the browser saved a file somewhere, and the button went back to its label.
  // Whether anything had happened was unknowable from the screen. The counts
  // already exist here for the README, so they ride out on a header and the
  // screen reports the same numbers the zip contains. Exposed for CORS, or the
  // browser hands the page a response it cannot read the header of.
  res.setHeader("X-Steward-Export-Counts", JSON.stringify(
    Object.fromEntries(Object.entries(counts).map(([k, rows]) => [k, rows.length]))));
  res.setHeader("X-Steward-Export-Filename", filename);
  res.setHeader("Access-Control-Expose-Headers", "X-Steward-Export-Counts, X-Steward-Export-Filename");
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", err => { console.error("[export/csv] archive error:", err); res.destroy(err); });
  archive.pipe(res);
  archive.append(readme, { name: "README.txt" });
  for (const [name, csv] of Object.entries(files)) archive.append(csv, { name });
  await archive.finalize();
}));


// ══ BUILD-94 Part 1 — A FACE ON EVERY PROFILE ══════════════════════════════
// The bytes ride the BUILD-51 asset seam; the URL does NOT ride the public
// /portal-assets door. See personPhoto.js for why, and for the tenant
// guarantee: the signature covers the org id ON THE STORED ROW, so a URL
// minted in org A recomputes to a different digest against org B's row.

// The URL a payload carries for one donor. Null when there is no photo —
// which is the signal the shared mark uses to draw initials instead.
function donorPhotoUrl(orgId, photoAssetId) {
  if (!photoAssetId || !ASSET_ID_RE.test(String(photoAssetId))) return null;
  return personPhoto.signPhotoUrl({ orgId, assetId: photoAssetId });
}

app.get("/person-photos/:id", wrap(async (req, res) => {
  const id = String(req.params.id || "");
  if (!ASSET_ID_RE.test(id)) return res.status(404).json({ error: "not_found" });
  // The org comes from the STORED ROW, never from the request. This is the
  // whole isolation argument (BUILD-37 B9 applied to a GET).
  const [row] = await query(
    `SELECT org_id FROM portal_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL`,
    [id, personPhoto.PHOTO_ASSET_KIND]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const v = personPhoto.verifyPhotoUrl({ orgId: row.org_id, assetId: id, e: req.query.e, s: req.query.s });
  // One answer for expired and for wrong-org alike: a probe must not be able
  // to tell "this photo exists in another tenant" from "this link is old".
  if (!v.ok) return res.status(403).json({ error: "link_expired" });
  const asset = await getThemeAsset(id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  res.set("Content-Type", asset.contentType);
  res.set("X-Content-Type-Options", "nosniff");                                    // SECURE-1
  res.set("Content-Security-Policy", require("../assetStore").ASSET_CSP);
  // PRIVATE, and never longer than the signature it rode in on. Content
  // addressing still makes the bytes immutable, so a shared cache is the only
  // thing being refused here — correctly, for a photograph of a person.
  res.set("Cache-Control", `private, max-age=${Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))}`);
  res.set("ETag", `"${asset.id}"`);
  res.send(asset.buffer);
}));

// Every donor in the org that HAS a photo, as { donorId: signedUrl }. One
// request feeds every row surface in the product (Thread rows, Drift, the
// recipient preview, search results, household members) — the alternative was
// threading a signed URL through seven separate payload builders, each of
// which would then be a place for the photo to silently go missing.
// Donors WITHOUT a photo are absent from the map, so an org that has uploaded
// four faces ships four entries, not 25,000.
const PHOTO_MAP_CAP = 5000;
app.get("/people/photos", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, photo_asset_id FROM donors
      WHERE org_id = ? AND photo_asset_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT ${PHOTO_MAP_CAP + 1}`, [req.user.orgId]);
  const photos = {};
  for (const r of rows.slice(0, PHOTO_MAP_CAP)) {
    const u = donorPhotoUrl(req.user.orgId, r.photo_asset_id);
    if (u) photos[r.id] = u;
  }
  // Past the cap the ROW surfaces fall back to initials; the profile header
  // always signs its own URL, so no record is ever without its face.
  res.json({ photos, capped: rows.length > PHOTO_MAP_CAP, cap: PHOTO_MAP_CAP });
}));

// ── FIX-1 D — PEOPLE, WITHOUT THE LECTURE ─────────────────────────────────
// The model does not move: one person, one record, even when they are two
// things (BUILD-94 Part 2, `donors.person_types`). These are the doors the
// screen needs now that Donors shows donors:
//
//   GET /people?role=…      the people carrying one role (the volunteer roster,
//                           the staff and board list under Settings)
//   GET /people/:id         what a person is, and whether Donor may come off
//   PUT /people/:id/roles   one chip, one write — turn a role on or off
//
// Registered AFTER /people/photos so `/people/:id` never shadows it.
//
// DONOR IS SET BY GIVING. Somebody with a gift on file is a donor because money
// of theirs is on the ledger; taking the word off would drop real gifts out of
// every total that reads donors (donorOnlySql) while the gifts stayed. So the
// removal is REFUSED here and — through donorRemovalProblem — on the older
// PUT /donors/:id personTypes path too. A guard with a side door is not a guard.

// Whether Donor may come off this person, and the sentence when it may not.
// Counted from the gifts table itself, or the rollup when an imported history
// carried a count with no rows behind it — either one is money of theirs.
async function donorLock(orgId, row) {
  const [g] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=?`, [orgId, row.id]);
  const n = Math.max((g && g.n) || 0, Number(row.gift_count) || 0);
  if (!n) return { locked: false, reason: null, giftCount: 0 };
  const isOrg = row.kind === "organisation" || row.kind === "organization";
  const who = isOrg ? (String(row.name || "").trim() || "This organization")
                    : (String(row.name || "").trim().split(/\s+/)[0] || "This person");
  return {
    locked: true, giftCount: n,
    reason: `${who} has ${n === 1 ? "a gift" : n + " gifts"} on file, so ${isOrg ? "it stays" : "they stay"} a donor. Donor is set by giving.`,
  };
}

// null when a personTypes change is fine, otherwise the refusal body. Only a
// change that REMOVES donor from somebody with gifts can be refused.
async function donorRemovalProblem(orgId, donorId, nextTypes) {
  const [row] = await query(
    `SELECT id, name, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!row) return null;                        // the caller's own 404 answers it
  if (!PT.typesOf(row).includes("donor") || PT.normalizeTypes(nextTypes).includes("donor")) return null;
  const lock = await donorLock(orgId, row);
  return lock.locked ? { error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount } : null;
}

const personOut = (row, lock) => ({
  id: row.id, name: row.name, email: row.email || null, kind: row.kind || null,
  person_types: PT.typesOf(row),
  labels: PT.typeLabels(row),
  donorLocked: !!(lock && lock.locked),
  donorLockedReason: lock && lock.locked ? lock.reason : null,
});

app.get("/people", requireAuth, wrap(async (req, res) => {
  const role = String(req.query.role || "");
  if (!PEOPLE_ROLES.includes(role))
    return res.status(400).json({ error: "role_required", sentence: "Ask for donors, volunteers, or staff and board." });
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.phone, d.kind, d.person_types, d.gift_count, d.total_giving, d.last_gift_date
       FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND ${PT.typeSql(role, "d")}
      ORDER BY lower(d.name), d.id
      LIMIT 5000`, [req.user.orgId]);
  res.json({
    role,
    people: rows.map(r => ({
      ...personOut(r, null),
      phone: r.phone || null,
      // Whether they also give is the DONOR ROLE, not a gift count: a
      // volunteer marked donor with no gift yet is a prospect, and says so.
      gives: PT.typesOf(r).includes("donor"),
      giftCount: Number(r.gift_count) || 0,
      totalGiving: Number(r.total_giving) || 0,
      lastGiftDate: r.last_gift_date || null,
    })),
  });
}));

app.get("/people/:id", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    `SELECT id, name, email, kind, person_types, gift_count, first_gift_date
       FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [req.params.id, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "Person not found" });
  // FIX-8 Part B.2 — the roles line reads "Donor since 2021", and the year is
  // a fact about the person, so it travels with the person rather than being
  // dug out of a gift list the header does not have.
  res.json({ ...personOut(row, await donorLock(req.user.orgId, row)),
             first_gift_date: row.first_gift_date || null,
             // IMPORT-4: gifts on file but none dated reads "Donor since: unknown".
             gift_count: Number(row.gift_count) || 0 });
}));

// One chip, one write: the person's own row, person_types, nothing else. Adding
// Volunteer puts them on the roster (GET /people?role=volunteer) that moment.
app.put("/people/:id/roles", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const role = String(req.body?.role || "");
  const on = req.body?.on === true;
  if (!PEOPLE_ROLES.includes(role)) return res.status(400).json(UNKNOWN_ROLE);
  const [row] = await query(
    `SELECT id, name, email, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [req.params.id, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "Person not found" });

  const was = PT.typesOf(row);
  const next = PT.normalizeTypes(on ? [...was.filter(t => t !== "other"), role] : was.filter(t => t !== role));
  if (role === "donor" && !on && was.includes("donor")) {
    const lock = await donorLock(req.user.orgId, row);
    if (lock.locked) return res.status(409).json({ error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount });
  }
  if (JSON.stringify(next) !== JSON.stringify(was)) {
    await run(`UPDATE donors SET person_types = ?::jsonb, updated_at = NOW() WHERE id=? AND org_id=?`,
      [JSON.stringify(next), row.id, req.user.orgId]);
    // Who changed it, in the audit log (the row has no updated_by).
    writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "person_roles", row.id, { from: was, to: next });
    // BUILD-94 Part 3 — ADDED AS VOLUNTEER is a trigger, on the transition only.
    if (!was.includes("volunteer") && next.includes("volunteer")) {
      enrollInSequences(req.user.orgId, row.id, "added_volunteer", {}, actor(req))
        .catch(e => console.error("[seq] volunteer trigger:", e.message));
    }
  }
  const fresh = { ...row, person_types: next };
  res.json(personOut(fresh, await donorLock(req.user.orgId, fresh)));
}));

// Store a photograph on a donor record. Type is checked by CONTENT (the magic
// number must agree with the declared mime — BUILD-86's rule), capped at 10MB
// of decoded image, and resized to a 512 square WebP with the original
// discarded: nothing keeps the full-resolution upload, here or in S3.
async function storeDonorPhoto({ orgId, donorId, dataUri, actorUser }) {
  const m = typeof dataUri === "string" ? dataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
  if (!m) return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  if (dataUri.length > personPhoto.PHOTO_MAX_STR) {
    return { error: "That photo is larger than 10 MB. A normal photo from a phone is well within that." };
  }
  const declared = m[1];
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { buffer = null; }
  if (!buffer || !buffer.length) return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  if (buffer.length > personPhoto.PHOTO_MAX_BYTES) {
    return { error: "That photo is larger than 10 MB. A normal photo from a phone is well within that." };
  }
  // SVG is excluded on purpose: it is a script-bearing document, and nobody's
  // headshot is a vector.
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(declared) || !imageBytesMatchMime(declared, buffer)) {
    return { error: "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, or WebP photo." };
  }
  let out;
  try {
    const sharp = require("sharp");
    const r = await sharp(buffer, { failOn: "none" })
      .rotate()                                     // honour EXIF orientation
      .resize(personPhoto.PHOTO_SIZE, personPhoto.PHOTO_SIZE, { fit: "cover", position: "attention", withoutEnlargement: false })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out = { buffer: r.data, width: r.info.width, height: r.info.height };
  } catch (e) {
    // Unlike the theme path, this does NOT fall back to storing the original:
    // a 10MB master masquerading as a 512 thumbnail is the thing the cap and
    // the resize exist to prevent, and a real photograph always decodes.
    console.error("[person-photo] resize failed:", e.message);
    return { error: "We couldn't process that photo. Try re-exporting it as a JPEG or PNG." };
  }
  const [existing] = await query(`SELECT photo_asset_id FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
  if (!existing) return { error: "Donor not found", status: 404 };
  const asset = await putThemeAsset({
    orgId, kind: personPhoto.PHOTO_ASSET_KIND,
    buffer: out.buffer, contentType: "image/webp", width: out.width, height: out.height,
  });
  await run(`UPDATE donors SET photo_asset_id = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`, [asset.id, donorId, orgId]);
  await recordAssetPointerHistory(orgId, "donor.photo", donorId, existing.photo_asset_id || null, asset.id, actorUser);
  // Soft-delete any photo this org has that no donor points at any more — the
  // replaced face falls into the 90-day retention window, not out of history.
  await pruneUnreferencedAssets(orgId, personPhoto.PHOTO_ASSET_KIND, []).catch(e =>
    console.error("[person-photo] prune:", e.message));
  return { assetId: asset.id, url: donorPhotoUrl(orgId, asset.id) };
}

// ── BUILD-95 — A PICTURE OF THE CHEQUE ─────────────────────────────────────
// Stored through the SAME seam as a donor photo, and served through the same
// signed, expiring, private door — a cheque image carries a name, an amount, a
// bank, an account number and a signature, and is the most sensitive picture
// this product will ever hold. It is NOT a 512 square: a cheque cropped square
// is a cheque you cannot read, so it keeps its shape and is capped on the long
// edge instead.
// BUILD-96 Part 5 — how many photographs ONE REQUEST may carry. Not how many
// she may add: the screen chunks a folder into requests this size and adds up
// the answers, because a folder of two hundred headshots is hundreds of
// megabytes and fits in no request at all.
//
// Paired with the 24mb body limit registered for this path above. Twenty
// photographs of a few megabytes each sit inside that with room to spare, and
// a single photo is still capped at the same 10MB a one-at-a-time upload is.
const PHOTO_BULK_MAX = 20;

// One cheque image, attached to a gift that already exists.
app.post("/gifts/:id/cheque", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [g] = await query(`SELECT id, cheque_asset_id FROM gifts WHERE id = ? AND org_id = ?`,
    [req.params.id, req.user.orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const r = await storeChequeImage({ orgId: req.user.orgId, dataUri: req.body && req.body.image });
  if (r.error) return res.status(400).json({ error: "invalid_photo", message: r.error });
  await run(`UPDATE gifts SET cheque_asset_id = ? WHERE id = ? AND org_id = ?`, [r.assetId, g.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "gift.cheque", g.id, g.cheque_asset_id || null, r.assetId, req.user);
  res.json({ ok: true, chequeUrl: donorPhotoUrl(req.user.orgId, r.assetId) });
}));

app.post("/donors/:id/photo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await storeDonorPhoto({
    orgId: req.user.orgId, donorId: req.params.id,
    dataUri: req.body && req.body.image, actorUser: req.user,
  });
  if (r.error) return res.status(r.status || 400).json({ error: "invalid_photo", message: r.error });
  res.json({ ok: true, photoUrl: r.url });
}));

// ── BUILD-96 Part 5 — A FOLDER OF PHOTOS ───────────────────────────────────
// She arrives with a folder of headshots off the old system. One at a time is
// not a feature for 200 people.
//
// Every photo goes through the SAME storeDonorPhoto seam a single upload uses
// — same cap, same type check, same resize, same asset history, same prune —
// because a bulk path with its own quieter rules is how a 10 MB master or a
// renamed PDF gets in. The only thing this route adds is deciding WHO.
//
// And it decides conservatively: shared/photoMatch.js attaches only when the
// file name identifies exactly one person, by email, then legacy id, then
// exact full name. Anything else comes back by file name for her to place.
// Nothing is guessed on a partial name — a wrong face is not an error anyone
// reviews, because a photo that "worked" is never looked at again.
app.post("/photos/bulk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const pm = await import("../shared/photoMatch.js");
  const orgId = req.user.orgId;
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ error: "no_files" });
  if (files.length > PHOTO_BULK_MAX)
    return res.status(400).json({ error: "too_many", message: `Add at most ${PHOTO_BULK_MAX} photos at a time.` });

  // The roster, once. A per-file lookup would be N queries and would also let
  // two files race each other onto the same person.
  const people = (await query(
    `SELECT id, name, email, external_donor_id, external_donor_ids
       FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]))
    .map(r => ({
      id: r.id, name: r.name, email: r.email,
      externalId: r.external_donor_id,
      externalIds: Array.isArray(r.external_donor_ids) ? r.external_donor_ids : [],
    }));
  const index = pm.buildIndex(people);

  let attached = 0;
  const needsYou = [];
  // A file name is the only thing shown back to her, so it is the only thing
  // echoed — never the image, and never a path from her machine beyond the
  // last segment.
  const shown = f => String(f || "").split(/[\\/]/).pop().slice(0, 200);

  for (const f of files) {
    const fileName = shown(f?.fileName);
    const m = pm.matchOne(fileName, index);

    if (m.status === "bad_type") {
      needsYou.push({ fileName, reason: "not_a_photo",
        message: `${fileName} isn't a photo Steward can use.` });
      continue;
    }
    if (m.status === "ambiguous") {
      needsYou.push({ fileName, reason: "ambiguous", matchedBy: m.rule,
        candidates: m.candidates.slice(0, 8).map(p => ({ id: p.id, name: p.name, email: p.email })),
        message: `${fileName} could be more than one person.` });
      continue;
    }
    if (m.status === "unmatched") {
      needsYou.push({ fileName, reason: "no_match",
        message: `${fileName} doesn't match anyone on file.` });
      continue;
    }

    // Matched. The same seam as one-at-a-time, and a store failure is reported
    // per file rather than failing the batch: 199 good photos should not be
    // lost to one bad one.
    const r = await storeDonorPhoto({
      orgId, donorId: m.person.id, dataUri: f?.image, actorUser: req.user,
    });
    if (r.error) {
      needsYou.push({ fileName, reason: "rejected", message: `${fileName}: ${r.error}` });
      continue;
    }
    attached++;
  }

  res.json({
    ok: true, attached, needsYou,
    sentence: pm.photoReport({ attached, needsYou: needsYou.length }),
  });
}));

app.delete("/donors/:id/photo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [d] = await query(`SELECT photo_asset_id FROM donors WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  await run(`UPDATE donors SET photo_asset_id = NULL, updated_at = NOW() WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "donor.photo", req.params.id, d.photo_asset_id || null, null, req.user);
  await pruneUnreferencedAssets(req.user.orgId, personPhoto.PHOTO_ASSET_KIND, []).catch(e =>
    console.error("[person-photo] prune:", e.message));
  res.json({ ok: true, photoUrl: null });
}));

// GET /settings/inbound-email — the address, the held messages, the drop count.
// Readable with the flag OFF: the Settings card has to be able to say "this is
// not switched on yet" rather than 404 at the surface a human is reading.
app.get("/settings/inbound-email", requireAuth, wrap(async (req, res) => {
  const IE = await inboundMod();
  const orgRows = await query(
    "SELECT org_slug, inbound_email_enabled FROM orgs WHERE id = ?", [req.user.orgId]);
  const slug = orgRows[0]?.org_slug || "";
  const address = INBOUND_EMAIL_DOMAIN ? IE.loggingAddress(slug, INBOUND_EMAIL_DOMAIN) : "";
  const held = await query(
    `SELECT id, kind, from_email, to_emails, subject, body, message_date, candidates, created_at
       FROM inbound_email_unmatched WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`,
    [req.user.orgId]);
  const drops = await query(
    "SELECT COUNT(*)::int AS n FROM inbound_email_drops WHERE org_id = ?", [req.user.orgId]);
  // FIX-11 Part 5 — TWO gates, reported separately, because "off" for a
  // deployment reason and "off because this organisation is the demo" are
  // different sentences to put on a screen.
  const orgOn = orgRows[0]?.inbound_email_enabled !== false;
  res.json({
    enabled: INBOUND_EMAIL_ENABLED && orgOn,
    deploymentEnabled: INBOUND_EMAIL_ENABLED,
    orgEnabled: orgOn,
    address,
    // ONE address for the organisation, and Steward knows which staff member
    // sent a message because the sender has to be one of its users. Said out
    // loud so nobody BCCs it expecting a private inbox.
    sentence: !INBOUND_EMAIL_ENABLED
      ? "BCC logging is not switched on for this Steward yet."
      : !orgOn
        ? "BCC logging is off for this organization."
        : `BCC ${address} on an email to a donor and Steward files it on their record. `
          + "It is one address for the whole organization, and Steward knows it came from you because you sent it. "
          + "A message that names nobody on file is held for you to place, or stored nowhere at all.",
    unmatched: held.map(h => ({
      id: h.id, kind: h.kind, from: h.from_email, to: h.to_emails, subject: h.subject,
      body: h.body, date: h.message_date,
      candidates: Array.isArray(h.candidates) ? h.candidates : [],
      receivedAt: h.created_at,
    })),
    droppedCount: drops[0]?.n || 0,
  });
}));

// POST /settings/inbound-email/assign — a human files a held message on a
// donor. The id travels in the BODY, not the path: no new parameterized route,
// and the org scope is in both WHERE clauses, which is where it belongs.
app.post("/settings/inbound-email/assign", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { id, donorId } = req.body || {};
  const rows = await query("SELECT * FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [String(id || ""), req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const donors = await query("SELECT id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [String(donorId || ""), req.user.orgId]);
  if (!donors.length) return res.status(404).json({ error: "Not found" });
  const m = rows[0];
  const iid = "int_" + uuid().slice(0, 8);
  const note = (m.subject || "") + (m.body ? "\n\n" + m.body : "");
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
    // ORG_TZ_SEAM_OK (BUILD-72 Part 4) — the fallback day is the ORG's civil
    // today, never the process clock's.
    [iid, req.user.orgId, donors[0].id, "email", note, m.message_date || orgToday(await orgTz(req.user.orgId)),
     req.user.userId, userRow[0]?.name || "",
     JSON.stringify({ via: "inbound_email", from: m.from_email, to: m.to_emails, subject: m.subject, direction: "outbound" })]
  );
  await run("DELETE FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [m.id, req.user.orgId]);
  res.json({ ok: true, interactionId: iid, donorId: donors[0].id });
}));

// POST /settings/inbound-email/discard — the message was not worth filing.
app.post("/settings/inbound-email/discard", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { id } = req.body || {};
  const rows = await query("SELECT id FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [String(id || ""), req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [rows[0].id, req.user.orgId]);
  res.json({ ok: true });
}));

// FIX-1 — what a gift a PERSON recorded sets off after recordGift, for the
// other doors that record one (Agent → confirm). Filled once, here, when the
// functions exist; the gift form above calls them directly.
giftHooks.autoUnlapseOnGift = autoUnlapseOnGift;
giftHooks.calcWealthScore = calcWealthScore;
}

module.exports = { routers, mount: mountAll, giftHooks, reportHooks };
