// SPLIT-2: moved VERBATIM from server.js (the statements from lines 6914-12645, in order). server.js requires the boot modules in
// order: every helpers-N first (a function existed from the start, as hoisting made it), then
// steps-1, steps-2 … in the order the statements ran. Each "SPLIT-2 server.js piece N" block is
// server.js's own text; tests read server.js through readSource("server.js"), which puts the
// pieces back in order. The lines outside the blocks are the wiring: this module's copy of each
// server.js name it reads (bind), and __boot.share() after a declaration or a write, which
// refreshes every module's copy.
// eslint-disable-next-line no-var, no-global-assign
var __dirname = require("path").join(__dirname, "..", "..");   // server.js's folder, as the moved code expects
const __boot = require("./share");
const __share = __boot.share;
let ACK_READY, AGENT_MODEL, AiOffError, BILLING_PLAN_VALUES, CAL_READY, CANONICAL_APP_URL, CLOSE_PLANS, DUNNING_SCHEDULE_DAYS, FISCAL_READY, GC_READY, GREET_READY, PRICING, PT_READY, RB_READY, RECOVERY_SECRET, SYS_AUTO, Sentry, SvixWebhook, UNSUB_SECRET, VH_READY, VOL_DAYS_READY, actor, app, applyAgreedBandMoves, backgroundTicksDisabled, bcrypt, billingConfigError, billingCustomerColumn, billingStripe, billingStripeMode, bootGate, bumpFormEvent, checkAllRecordBands, checkBillingPriceModes, checkGiftExtras, checkPlanLimit, checkRecordBand, checkVolunteerFields, checkWebhookSubscriptions, checkWriteAccess, checkoutSessionParams, closePlan, closeThreadStepForContact, computeTrialEnd, countRecords, crypto, displayNameCase, donateLimiter, donorByNameOrCreate, donorFacingOrgName, donorFromAddress, donorMailDecision, donorSendOpts, effectivePlanLimits, einLookup, enrollMembership, ensureOrgLedger, escapeHtml, express, filterBySegment, fireWorkflows, firstChargeSentence, formatChargeDate, getOrgAccessState, grantBalanceFrom, grantMoneyRows, inboundMod, insertShift, inviteeDisplayName, ipKeyGenerator, issueGiftReceipt, linkEmailToAccounts, logRecoveryEvent, logRecurringChange, loginAccountLimiter, loginIpLimiter, mailboxAccessToken, makeVolunteer, markVolunteer, maybeStartJourneyFromServer, mfaVerifyForUser, money, newId, openGiftThread, openSustainerLapseThread, opsAlert, orgMailGateCache, orgMaySendEmail, orgOwns, orgPlanTier, orgSendingIdentity, orgTime, orgToday, orgTz, orgTzName, orgUnrestrictedFundId, otherBillingMode, parseMoneyOrThrow, passwordResetLimiter, planAmountUsd, planFromSubscription, portalTimeline, processNetworkGate, processRecordBands, processTrialReminders, provisionNewOrgWorkflows, publicAppUrl, purgeExpiredAssets, pushStewardDates, query, rateLimit, rateLimitDisabled, rateLimitHandler, recalcDonorSummary, recalcPledgePayment, reconcileStripeVsGifts, recordAutoMove, recordGift, recordTick, refreshAssetFallbackCount, refreshRetentionCounts, registerForEvent, registerLimiter, renewMembership, requireAdmin, requireAuth, requireSuperAdmin, resend, resolvePublicAppUrl, resolveSegmentSpec, restrictedMod, retryFailedNotifications, run, runTx, sampleDataMod, scheduleBillingModeCheck, sessionCache, signToken, stripe, stripeChargesEnabled, syncCalendar, syncMailbox, testMode, toCents, toDollars, unsubscribeEmailFooterHtml, unsubscribeHeaders, uuid, validateCloseLink, validateOrgClose, volunteerRecordSentence, volunteerSummary, withAdvisoryLock, withTransaction, wrap, writeAuditLog, writeGiftExtras;
__boot.register(c => {
  if ("ACK_READY" in c) ACK_READY = c.ACK_READY;
  if ("AGENT_MODEL" in c) AGENT_MODEL = c.AGENT_MODEL;
  if ("AiOffError" in c) AiOffError = c.AiOffError;
  if ("BILLING_PLAN_VALUES" in c) BILLING_PLAN_VALUES = c.BILLING_PLAN_VALUES;
  if ("CAL_READY" in c) CAL_READY = c.CAL_READY;
  if ("CANONICAL_APP_URL" in c) CANONICAL_APP_URL = c.CANONICAL_APP_URL;
  if ("CLOSE_PLANS" in c) CLOSE_PLANS = c.CLOSE_PLANS;
  if ("DUNNING_SCHEDULE_DAYS" in c) DUNNING_SCHEDULE_DAYS = c.DUNNING_SCHEDULE_DAYS;
  if ("FISCAL_READY" in c) FISCAL_READY = c.FISCAL_READY;
  if ("GC_READY" in c) GC_READY = c.GC_READY;
  if ("GREET_READY" in c) GREET_READY = c.GREET_READY;
  if ("PRICING" in c) PRICING = c.PRICING;
  if ("PT_READY" in c) PT_READY = c.PT_READY;
  if ("RB_READY" in c) RB_READY = c.RB_READY;
  if ("RECOVERY_SECRET" in c) RECOVERY_SECRET = c.RECOVERY_SECRET;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("Sentry" in c) Sentry = c.Sentry;
  if ("SvixWebhook" in c) SvixWebhook = c.SvixWebhook;
  if ("UNSUB_SECRET" in c) UNSUB_SECRET = c.UNSUB_SECRET;
  if ("VH_READY" in c) VH_READY = c.VH_READY;
  if ("VOL_DAYS_READY" in c) VOL_DAYS_READY = c.VOL_DAYS_READY;
  if ("actor" in c) actor = c.actor;
  if ("app" in c) app = c.app;
  if ("applyAgreedBandMoves" in c) applyAgreedBandMoves = c.applyAgreedBandMoves;
  if ("backgroundTicksDisabled" in c) backgroundTicksDisabled = c.backgroundTicksDisabled;
  if ("bcrypt" in c) bcrypt = c.bcrypt;
  if ("billingConfigError" in c) billingConfigError = c.billingConfigError;
  if ("billingCustomerColumn" in c) billingCustomerColumn = c.billingCustomerColumn;
  if ("billingStripe" in c) billingStripe = c.billingStripe;
  if ("billingStripeMode" in c) billingStripeMode = c.billingStripeMode;
  if ("bootGate" in c) bootGate = c.bootGate;
  if ("bumpFormEvent" in c) bumpFormEvent = c.bumpFormEvent;
  if ("checkAllRecordBands" in c) checkAllRecordBands = c.checkAllRecordBands;
  if ("checkBillingPriceModes" in c) checkBillingPriceModes = c.checkBillingPriceModes;
  if ("checkGiftExtras" in c) checkGiftExtras = c.checkGiftExtras;
  if ("checkPlanLimit" in c) checkPlanLimit = c.checkPlanLimit;
  if ("checkRecordBand" in c) checkRecordBand = c.checkRecordBand;
  if ("checkVolunteerFields" in c) checkVolunteerFields = c.checkVolunteerFields;
  if ("checkWebhookSubscriptions" in c) checkWebhookSubscriptions = c.checkWebhookSubscriptions;
  if ("checkWriteAccess" in c) checkWriteAccess = c.checkWriteAccess;
  if ("checkoutSessionParams" in c) checkoutSessionParams = c.checkoutSessionParams;
  if ("closePlan" in c) closePlan = c.closePlan;
  if ("closeThreadStepForContact" in c) closeThreadStepForContact = c.closeThreadStepForContact;
  if ("computeTrialEnd" in c) computeTrialEnd = c.computeTrialEnd;
  if ("countRecords" in c) countRecords = c.countRecords;
  if ("crypto" in c) crypto = c.crypto;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donateLimiter" in c) donateLimiter = c.donateLimiter;
  if ("donorByNameOrCreate" in c) donorByNameOrCreate = c.donorByNameOrCreate;
  if ("donorFacingOrgName" in c) donorFacingOrgName = c.donorFacingOrgName;
  if ("donorFromAddress" in c) donorFromAddress = c.donorFromAddress;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("donorSendOpts" in c) donorSendOpts = c.donorSendOpts;
  if ("effectivePlanLimits" in c) effectivePlanLimits = c.effectivePlanLimits;
  if ("einLookup" in c) einLookup = c.einLookup;
  if ("enrollMembership" in c) enrollMembership = c.enrollMembership;
  if ("ensureOrgLedger" in c) ensureOrgLedger = c.ensureOrgLedger;
  if ("escapeHtml" in c) escapeHtml = c.escapeHtml;
  if ("express" in c) express = c.express;
  if ("filterBySegment" in c) filterBySegment = c.filterBySegment;
  if ("fireWorkflows" in c) fireWorkflows = c.fireWorkflows;
  if ("firstChargeSentence" in c) firstChargeSentence = c.firstChargeSentence;
  if ("formatChargeDate" in c) formatChargeDate = c.formatChargeDate;
  if ("getOrgAccessState" in c) getOrgAccessState = c.getOrgAccessState;
  if ("grantBalanceFrom" in c) grantBalanceFrom = c.grantBalanceFrom;
  if ("grantMoneyRows" in c) grantMoneyRows = c.grantMoneyRows;
  if ("inboundMod" in c) inboundMod = c.inboundMod;
  if ("insertShift" in c) insertShift = c.insertShift;
  if ("inviteeDisplayName" in c) inviteeDisplayName = c.inviteeDisplayName;
  if ("ipKeyGenerator" in c) ipKeyGenerator = c.ipKeyGenerator;
  if ("issueGiftReceipt" in c) issueGiftReceipt = c.issueGiftReceipt;
  if ("linkEmailToAccounts" in c) linkEmailToAccounts = c.linkEmailToAccounts;
  if ("logRecoveryEvent" in c) logRecoveryEvent = c.logRecoveryEvent;
  if ("logRecurringChange" in c) logRecurringChange = c.logRecurringChange;
  if ("loginAccountLimiter" in c) loginAccountLimiter = c.loginAccountLimiter;
  if ("loginIpLimiter" in c) loginIpLimiter = c.loginIpLimiter;
  if ("mailboxAccessToken" in c) mailboxAccessToken = c.mailboxAccessToken;
  if ("makeVolunteer" in c) makeVolunteer = c.makeVolunteer;
  if ("markVolunteer" in c) markVolunteer = c.markVolunteer;
  if ("maybeStartJourneyFromServer" in c) maybeStartJourneyFromServer = c.maybeStartJourneyFromServer;
  if ("mfaVerifyForUser" in c) mfaVerifyForUser = c.mfaVerifyForUser;
  if ("money" in c) money = c.money;
  if ("newId" in c) newId = c.newId;
  if ("openGiftThread" in c) openGiftThread = c.openGiftThread;
  if ("openSustainerLapseThread" in c) openSustainerLapseThread = c.openSustainerLapseThread;
  if ("opsAlert" in c) opsAlert = c.opsAlert;
  if ("orgMailGateCache" in c) orgMailGateCache = c.orgMailGateCache;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("orgOwns" in c) orgOwns = c.orgOwns;
  if ("orgPlanTier" in c) orgPlanTier = c.orgPlanTier;
  if ("orgSendingIdentity" in c) orgSendingIdentity = c.orgSendingIdentity;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("orgTzName" in c) orgTzName = c.orgTzName;
  if ("orgUnrestrictedFundId" in c) orgUnrestrictedFundId = c.orgUnrestrictedFundId;
  if ("otherBillingMode" in c) otherBillingMode = c.otherBillingMode;
  if ("parseMoneyOrThrow" in c) parseMoneyOrThrow = c.parseMoneyOrThrow;
  if ("passwordResetLimiter" in c) passwordResetLimiter = c.passwordResetLimiter;
  if ("planAmountUsd" in c) planAmountUsd = c.planAmountUsd;
  if ("planFromSubscription" in c) planFromSubscription = c.planFromSubscription;
  if ("portalTimeline" in c) portalTimeline = c.portalTimeline;
  if ("processNetworkGate" in c) processNetworkGate = c.processNetworkGate;
  if ("processRecordBands" in c) processRecordBands = c.processRecordBands;
  if ("processTrialReminders" in c) processTrialReminders = c.processTrialReminders;
  if ("provisionNewOrgWorkflows" in c) provisionNewOrgWorkflows = c.provisionNewOrgWorkflows;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("purgeExpiredAssets" in c) purgeExpiredAssets = c.purgeExpiredAssets;
  if ("pushStewardDates" in c) pushStewardDates = c.pushStewardDates;
  if ("query" in c) query = c.query;
  if ("rateLimit" in c) rateLimit = c.rateLimit;
  if ("rateLimitDisabled" in c) rateLimitDisabled = c.rateLimitDisabled;
  if ("rateLimitHandler" in c) rateLimitHandler = c.rateLimitHandler;
  if ("recalcDonorSummary" in c) recalcDonorSummary = c.recalcDonorSummary;
  if ("recalcPledgePayment" in c) recalcPledgePayment = c.recalcPledgePayment;
  if ("reconcileStripeVsGifts" in c) reconcileStripeVsGifts = c.reconcileStripeVsGifts;
  if ("recordAutoMove" in c) recordAutoMove = c.recordAutoMove;
  if ("recordGift" in c) recordGift = c.recordGift;
  if ("recordTick" in c) recordTick = c.recordTick;
  if ("refreshAssetFallbackCount" in c) refreshAssetFallbackCount = c.refreshAssetFallbackCount;
  if ("refreshRetentionCounts" in c) refreshRetentionCounts = c.refreshRetentionCounts;
  if ("registerForEvent" in c) registerForEvent = c.registerForEvent;
  if ("registerLimiter" in c) registerLimiter = c.registerLimiter;
  if ("renewMembership" in c) renewMembership = c.renewMembership;
  if ("requireAdmin" in c) requireAdmin = c.requireAdmin;
  if ("requireAuth" in c) requireAuth = c.requireAuth;
  if ("requireSuperAdmin" in c) requireSuperAdmin = c.requireSuperAdmin;
  if ("resend" in c) resend = c.resend;
  if ("resolvePublicAppUrl" in c) resolvePublicAppUrl = c.resolvePublicAppUrl;
  if ("resolveSegmentSpec" in c) resolveSegmentSpec = c.resolveSegmentSpec;
  if ("restrictedMod" in c) restrictedMod = c.restrictedMod;
  if ("retryFailedNotifications" in c) retryFailedNotifications = c.retryFailedNotifications;
  if ("run" in c) run = c.run;
  if ("runTx" in c) runTx = c.runTx;
  if ("sampleDataMod" in c) sampleDataMod = c.sampleDataMod;
  if ("scheduleBillingModeCheck" in c) scheduleBillingModeCheck = c.scheduleBillingModeCheck;
  if ("sessionCache" in c) sessionCache = c.sessionCache;
  if ("signToken" in c) signToken = c.signToken;
  if ("stripe" in c) stripe = c.stripe;
  if ("stripeChargesEnabled" in c) stripeChargesEnabled = c.stripeChargesEnabled;
  if ("syncCalendar" in c) syncCalendar = c.syncCalendar;
  if ("syncMailbox" in c) syncMailbox = c.syncMailbox;
  if ("testMode" in c) testMode = c.testMode;
  if ("toCents" in c) toCents = c.toCents;
  if ("toDollars" in c) toDollars = c.toDollars;
  if ("unsubscribeEmailFooterHtml" in c) unsubscribeEmailFooterHtml = c.unsubscribeEmailFooterHtml;
  if ("unsubscribeHeaders" in c) unsubscribeHeaders = c.unsubscribeHeaders;
  if ("uuid" in c) uuid = c.uuid;
  if ("validateCloseLink" in c) validateCloseLink = c.validateCloseLink;
  if ("validateOrgClose" in c) validateOrgClose = c.validateOrgClose;
  if ("volunteerRecordSentence" in c) volunteerRecordSentence = c.volunteerRecordSentence;
  if ("volunteerSummary" in c) volunteerSummary = c.volunteerSummary;
  if ("withAdvisoryLock" in c) withAdvisoryLock = c.withAdvisoryLock;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
  if ("wrap" in c) wrap = c.wrap;
  if ("writeAuditLog" in c) writeAuditLog = c.writeAuditLog;
  if ("writeGiftExtras" in c) writeGiftExtras = c.writeGiftExtras;
  if ("SEQ" in c) SEQ = c.SEQ;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("billingModeStatus" in c) billingModeStatus = c.billingModeStatus;
  if ("mailboxSyncHealth" in c) mailboxSyncHealth = c.mailboxSyncHealth;
  if ("EV" in c) EV = c.EV;
  if ("MB" in c) MB = c.MB;
  if ("_supporterSession" in c) _supporterSession = c._supporterSession;
});

// SPLIT-2 server.js piece 505

const weeklyIsEmpty = w => !w.stepCount && !w.taskCount && !w.pledges.length && !w.events.length
  && !w.giftCount && !w.unthanked && !w.lapsed.length;
// SPLIT-2 end
__share({ weeklyIsEmpty });
// SPLIT-2 server.js piece 515

// ── Stewardship: milestone & anniversary detection ──────────────────────────
// Fixed checkpoints for "just crossed a round-number cumulative giving total"
// detection — separate from impact_metrics, which is org-configured content
// for what to SAY once a milestone fires, not when one fires.
const MILESTONE_THRESHOLDS = [10000, 5000, 2500, 1000, 500];
// SPLIT-2 end
__share({ MILESTONE_THRESHOLDS });
// SPLIT-2 server.js piece 518

// ── BUILD-76 Part 1 — drift, computed for real ──────────────────────────────
// The ONE integration point over the pure engine in drift.js. Computed on
// READ, never stored (the Part 3.4 decision, audit/BUILD-76-FINDINGS.md): a
// gift that lands via webhook or manual entry is reflected the next time any
// drift surface is read, because every surface calls this fresh. NB
// computeAtRiskCandidates above is a DIFFERENT, older signal (feeds the
// at_risk re-engagement EMAIL trigger); it is deliberately untouched — drift
// is the day-view/badge truth, not a mail trigger.
//
// Exclusions (brief §1.4 — what a real file is full of; each has its own
// assertion in tests/drift.test.js): deceased · do-not-contact · active
// recurring (a monthly donor's failed card is a failed payment, not drift —
// status active/past_due/recovering all count as "on subscription") · open
// pledges (contractual cadence, not voluntary) · single-gift donors (the
// engine returns not_eligible — no cadence exists).
// SCALE-2 · DRIFT READS WHAT'S STORED. The part of a donor's Drift answer that
// comes from their gifts (the assessment, yesterday's state, the recent-pledge
// marker) is stored per person in donor_drift for one org calendar day, and
// Home and Drift read it instead of rebuilding every donor's gift array on
// each visit. A write to gifts deletes the stored answer for the people it
// touched (a statement trigger, so no door can skip it); the after-change step
// recomputes them at once and the nightly job recomputes the org for the new
// day. What is still read live is everything that is not gifts: the person's
// flags, subscriptions, open pledges and last contact, which are each one
// cheap read and decide exclusions and "handled" exactly as before.
const DRIFT_STORE_OFF = () => process.env.DRIFT_STORE_OFF === "1";
// SPLIT-2 end
__share({ DRIFT_STORE_OFF });
// SPLIT-2 server.js piece 524

// Which milestones get a human-written "write a note" nudge instead of an
// AI-drafted email: the two highest dollar thresholds (real major-gift
// moments) and every giving anniversary (inherently personal/relational —
// worth a genuine handwritten touch regardless of dollar amount). Everything
// smaller/routine ($500/$1,000/$2,500 crossings) keeps the existing
// AI-drafted-email flow, which is efficient and already staff-reviewed
// before sending. This is a product judgment call, not a technical one —
// see the Phase 2 commit message for the full reasoning.
const NOTE_MILESTONE_KEYS = new Set(["threshold_10000", "threshold_5000"]);
// SPLIT-2 end
__share({ NOTE_MILESTONE_KEYS });
// SPLIT-2 server.js piece 531


// ══ BUILD-94 Part 3 — SEQUENCES ════════════════════════════════════════════
//
// THE RULE THIS BUILD CHANGES, AND HOW FAR. Since BUILD-88c: nothing goes to a
// donor she did not press send on. Sequences change it to this, and no
// further: SHE WROTE EVERY WORD, SHE TURNED IT ON, AND EACH SEND IS HERS.
// Steward still writes nothing to a donor — every sentence that reaches an
// inbox came out of a step SHE typed, personalised only by merge fields
// reading her own data. There is no model on this path.
//
// The rules themselves live in shared/sequenceShape.js (pure, unit-tested);
// this is the half that touches the database, the clock and Resend.

let SEQ = null;
// SPLIT-2 end
__share({ SEQ });
// SPLIT-2 server.js piece 532
const SEQ_READY = import("../../shared/sequenceShape.js").then(m => { SEQ = m; __share({ SEQ }); return m; });
// SPLIT-2 end
__share({ SEQ_READY });
// SPLIT-2 server.js piece 534
const fmtMoneyPlain = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
// SPLIT-2 end
__share({ fmtMoneyPlain });
// SPLIT-2 server.js piece 539

// ── THE SEND ───────────────────────────────────────────────────────────────
// Batched under Resend's rate limit, idempotent on (person, sequence, step)
// because the claim row IS the unique index — not a flag somebody remembered
// to check. A retried job finds the row taken and sends nothing.
const SEQ_RATE_PER_SECOND = 8;     // Resend's documented floor, with headroom
// SPLIT-2 end
__share({ SEQ_RATE_PER_SECOND });
// SPLIT-2 server.js piece 540
const SEQ_TICK_BUDGET = 200;
// SPLIT-2 end
__share({ SEQ_TICK_BUDGET });
// SPLIT-2 server.js piece 547

// ── THE CARD THAT IS GOING TO DIE, BEFORE IT DIES (2026-09-11) ─────────────
//
// Every path above this one begins at `invoice.payment_failed` — after the
// gift is already lost and the donor has already had an apology. Card expiry
// is the most predictable cause of involuntary churn and the one thing that
// can be seen coming, so this reads what Stripe knows about the card on file
// and asks BEFORE it fails. Same Checkout link, two weeks earlier, sent to an
// intact relationship rather than a broken one.
//
// WHY A POLL AND NOT A WEBHOOK. Stripe's `customer.source.expiring` fires only
// for legacy Card/Source objects; its own event reference says it does not
// occur for PaymentMethod integrations, which is what Steward uses (setup-mode
// Checkout → setupIntent.payment_method → subscriptions.update). Checked, not
// assumed. So the expiry date has to be fetched and stored, and this is the
// same shape as the BUILD-84 geocoding queue: a budgeted background sweep, an
// answer stored on the row, nothing at read time.
//
// The re-read is cheap and bounded: one Stripe call per subscription at most
// every CARD_RECHECK_DAYS, capped per tick. A card that has not been re-read
// recently is the only thing this ever looks at.
const CARD_RECHECK_DAYS = Number(process.env.CARD_RECHECK_DAYS) || 7;
// SPLIT-2 end
__share({ CARD_RECHECK_DAYS });
// SPLIT-2 server.js piece 548
const CARD_CHECK_BUDGET = Number(process.env.CARD_CHECK_BUDGET) || 200;
// SPLIT-2 end
__share({ CARD_CHECK_BUDGET });
// SPLIT-2 server.js piece 549

// The expiry period is 'YYYY-MM' — a card is dead after the LAST day of its
// expiry month, so the month is the whole unit and the notice is keyed to it.
const cardPeriod = (y, m) => (y && m) ? `${y}-${String(m).padStart(2, "0")}` : null;
// SPLIT-2 end
__share({ cardPeriod });
// SPLIT-2 server.js piece 553

// ════════════════════════════════════════════════════════════════════════════
// Workflows engine (BUILD-13 Part 3) — retention recipes on a builder-ready
// trigger → conditions → actions data model. v1 ships four pre-built recipes;
// a future visual builder is a UI over this same schema, not a rewrite.
// Every action keys off a dedup token (workflow_runs UNIQUE(workflow_id,
// dedup_key)) so re-processing a trigger event is a strict no-op — an
// automation that double-sends is a trust disaster. Every run is logged.
// ════════════════════════════════════════════════════════════════════════════
const WORKFLOW_RECIPES = [
  {
    key: "failed_recurring_recovery",
    name: "Failed recurring gift → recovery note to review + task",
    description: "When a donor's recurring card fails, Steward drafts a personal note for you to review and send, and creates a task to follow up. Steward drafts it. You send it. (The card-update link itself goes out in the automatic payment-failed email.)",
    trigger: "recurring_failed",
    conditions: [],
    actions: [
      { type: "draft_email", template: "recovery" },
      // A.2 — the label is the step, not the word "follow-up" and a name.
      { type: "create_task", title: "Call {donor} about the monthly gift that failed", priority: "high", dueDays: 2 },
    ],
    defaultConfig: {},
  },
  {
    key: "new_donor_welcome",
    name: "New donor's first gift → thank-you to review + task",
    description: "The moment a brand-new donor gives for the first time, Steward drafts a thank-you for you to review and send, and queues a personal welcome call. Steward drafts it. You send it.",
    trigger: "gift_received",
    conditions: [{ field: "is_first_gift", op: "eq", value: true }],
    actions: [
      { type: "draft_email", template: "thankyou" },
      { type: "create_task", title: "Personal welcome call: {donor}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "lapsing_reengage",
    name: "Lapsing donor → re-engagement task",
    description: "When a donor crosses your lapse window with no gift, tag them and create a re-engagement task (optionally draft a note for you to review and send. Steward drafts it. You send it.).",
    trigger: "donor_lapsed",
    conditions: [],
    actions: [
      { type: "add_tag", tag: "lapsing" },
      { type: "create_task", title: "Re-engage {donor}: lapsing", priority: "medium", dueDays: 7 },
    ],
    defaultConfig: { lapseDays: 365, sendEmail: false },
  },
  {
    key: "major_gift_alert",
    name: "Major gift → stewardship alert to owner",
    description: "When a gift lands over your major-gift threshold, alert the donor's relationship owner and create a stewardship task.",
    trigger: "gift_received",
    conditions: [{ field: "amount", op: "gte", value: 1000 }],
    actions: [
      { type: "notify_owner" },
      { type: "create_task", title: "Steward major gift: {donor} gave {amount}", priority: "high", dueDays: 2 },
    ],
    defaultConfig: { threshold: 1000 },
  },
  // BUILD-16 Part 3 — real-time stewardship: the instant ANY gift lands, alert
  // the people who thank donors (ED and/or the assigned officer) in-app AND by
  // email, so thanks go out fast. Different from major_gift_alert (which only
  // fires over a big threshold and only pings the owner) — this is the
  // every-gift "someone just gave, thank them now" signal. Idempotent per gift.
  {
    key: "instant_gift_thanks",
    name: "Gift received → notify the team to thank them",
    description: "The instant a gift comes in, alert the executive director and/or the donor's assigned officer, in-app and by email, so a thank-you goes out fast. Set an amount threshold to only be pinged above a certain size.",
    trigger: "gift_received",
    conditions: [{ field: "amount", op: "gte", value: 0 }],
    actions: [
      { type: "notify_gift" },
    ],
    defaultConfig: { notify: "both", threshold: 0 },
  },
  // ── BUILD-76 Part 7 — two of the three canned automations (the third is
  // major_gift_alert above, which Part 7 TUNES rather than duplicates).
  // Neither may ever email a donor (C.2) — create_task only, pinned at the
  // source by workflows-e2e §B76.
  {
    key: "quiet_past_pattern",
    name: "Donor quiet past their own pattern → task for their officer",
    description: "When a donor goes meaningfully past their own giving rhythm, the same drift computation the home screen shows, high confidence only, create a task for their relationship owner carrying the reason. Earlier and more personal than the fixed lapse window.",
    trigger: "donor_drifting",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "{donor} is drifting: {reason}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "pledge_due_soon",
    name: "Pledge payment coming due → task for their officer",
    description: "A set number of days before an open pledge's due date, create a task for the donor's relationship owner so the ask never slips. Internal task only, the donor-facing pledge reminder emails are configured separately.",
    trigger: "pledge_due",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "Pledge due {dueDate}: {donor}: {amount} outstanding", priority: "medium", dueDays: 0 },
    ],
    defaultConfig: { leadDays: 14 },
  },
];
// SPLIT-2 end
__share({ WORKFLOW_RECIPES });
// SPLIT-2 server.js piece 554
const WORKFLOW_RECIPE_MAP = Object.fromEntries(WORKFLOW_RECIPES.map(r => [r.key, r]));
// SPLIT-2 end
__share({ WORKFLOW_RECIPE_MAP });
// SPLIT-2 server.js piece 556

const asJson = (v, fb) => v == null ? fb : (typeof v === "object" ? v : (() => { try { return JSON.parse(v); } catch { return fb; } })());
// SPLIT-2 end
__share({ asJson });
// SPLIT-2 server.js piece 558

const escHtmlWf = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// SPLIT-2 end
__share({ escHtmlWf });
// SPLIT-2 server.js piece 560

// BUILD-45 (F-2) — retry queued notification sends. Runs on the existing 5-min
// tick (NOT a second scheduler) and via POST /admin/notifications/retry (ops/
// test hook). Re-reserves the dedup row and re-sends; deletes the failure row
// on success. After MAX_NOTIFY_ATTEMPTS it stops retrying and leaves the row as
// a permanent, surfaced record (counted on /health.notifications.failedPending)
// so a delivery problem is visible instead of silent. Backoff is coarse
// (attempts × 5 min) — internal alerts are time-sensitive but not sub-minute.
// ── BUILD-46 §1.1 — donor-account emails ride the SAME failure-visible path ─
// Rows queued with this sentinel org_id are donor-facing lifecycle emails
// (verification, reset, alias/email-change confirmation, magic links): the
// stored body_html is the FINAL rendered email, so the retry resends it raw —
// no org lookup, no notification_sends dedup (these are per-request emails).
const DONOR_EMAIL_ORG = "donor-network";
// SPLIT-2 end
__share({ DONOR_EMAIL_ORG });
// SPLIT-2 server.js piece 562

const MAX_NOTIFY_ATTEMPTS = 5;
// SPLIT-2 end
__share({ MAX_NOTIFY_ATTEMPTS });
// SPLIT-2 server.js piece 563
// Cached count of pending/exhausted failed notifications, surfaced on /health
// so the read path stays synchronous. Refreshed by every retry sweep (incl.
// the 50s-after-boot one) and bumped when a new failure is queued.
let notifyFailedPending = 0;
// SPLIT-2 end
__share({ notifyFailedPending });
// SPLIT-2 server.js piece 566

// ── BUILD-62 Part 3 — the reconciliation SWEEP ──────────────────────────────
// Donations settle in each org's OWN connected Stripe account (never the
// platform account, which only carries Steward's subscription billing). So the
// guard walks every connected account and asks, both directions:
//   1. Does every succeeded, not-fully-refunded charge have a gift row? A
//      charge with none = a donor was charged and Steward recorded NOTHING —
//      the exact failure BUILD-62 chased. This is an ALERT (count on /health +
//      Sentry), never a log line.
//   2. Does every recent online gift still have a succeeded charge behind it?
//      The reverse — a phantom/reversed gift.
// Read-only at Stripe and in Steward. Windowed + capped so it stays cheap.
const RECONCILE_WINDOW_HOURS = Math.max(1, parseInt(process.env.RECONCILE_WINDOW_HOURS || "72", 10) || 72);
// SPLIT-2 end
__share({ RECONCILE_WINDOW_HOURS });
// SPLIT-2 server.js piece 567
const RECONCILE_INTERVAL_MIN = Math.max(5, parseInt(process.env.RECONCILE_INTERVAL_MIN || "20", 10) || 20);
// SPLIT-2 end
__share({ RECONCILE_INTERVAL_MIN });
// SPLIT-2 server.js piece 575
// BUILD-51b — keep /health's themeAssets.dbFallbackRows fresh (failed-S3-put
// visibility); same 5-min cadence, never a second scheduler. BUILD-56 adds
// the softDeleted (restorable) count on the same tick.
if (!backgroundTicksDisabled()) {
  bootGate.afterMigrations(() => refreshAssetFallbackCount().catch(console.error), 20000);
  bootGate.everyAfterMigrations(() => refreshAssetFallbackCount().catch(console.error), 5 * 60 * 1000);
  bootGate.afterMigrations(() => refreshRetentionCounts().catch(console.error), 20000);
  bootGate.everyAfterMigrations(() => refreshRetentionCounts().catch(console.error), 5 * 60 * 1000);
  // BUILD-56 Part 4 — the retention purge: destroys objects soft-deleted more
  // than ASSET_RETENTION_DAYS ago (never a referenced one; every destruction
  // logged in asset_purge_log). 6-hour cadence like checkTrialExpiry.
  // SCALE-1: the purge writes, so it is a queue job and runs once, not per replica.
  require("../../jobQueue").define("purgeExpiredAssets", { everyMs: 6 * 60 * 60 * 1000, firstMs: 90000, run: () => purgeExpiredAssets() });
  // FIX-51 · an upload whose S3 put failed every try goes to the bucket on
  // the next pass (assetStore.moveFallbackAssetsToS3; never org_creo). A queue
  // job, so one replica does it, and only after the migrations.
  require("../../jobQueue").define("moveFallbackAssets", { everyMs: 30 * 60 * 1000, firstMs: 60000, run: () => require("../../assetStore").moveFallbackAssetsToS3() });
} else {
  // Ticks off (test boot): populate the /health counters once at load — a
  // read-only count, no mail/state side effects — so the fields aren't stale.
  bootGate.afterMigrations(() => refreshAssetFallbackCount().catch(console.error));
  bootGate.afterMigrations(() => refreshRetentionCounts().catch(console.error));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 577

// ── Pledge fulfillment reminders ────────────────────────────────────────────
// A pledge (donor promises $X by a future date) going unfulfilled past its
// due date is structurally the same problem as a recurring gift's failed
// payment: an expected payment that didn't happen, needing a proactive,
// time-staged nudge. This deliberately reuses the recurring-dunning engine's
// exact architecture above (same fixed-offset-from-first-event cadence math,
// same setTimeout/setInterval cron pattern, same suppression-check +
// unsubscribe-footer email plumbing) — only the trigger condition and the
// copy are pledge-specific. See db.js's pledges comment for why this needed
// its own minimal table first.
const PLEDGE_REMINDER_SCHEDULE_DAYS = [0, 3, 7, 14];
// SPLIT-2 end
__share({ PLEDGE_REMINDER_SCHEDULE_DAYS });
// SPLIT-2 server.js piece 583

// ── Billing mode-consistency self-diagnosis ─────────────────────────────────
// This class (billing key in one Stripe mode + STRIPE_PRICE_* ids from the
// OTHER mode) has now bitten twice and 500'd upgrades, so make it self-
// diagnosing: verify every configured price actually resolves under the current
// billing key's mode, log a LOUD warning on a mismatch, cache the result for
// /health, and expose a live re-check at /admin/billing-diagnostic.
//
// A price id doesn't encode its mode, so the only reliable check is to retrieve
// it with the billing key — `resource_missing` means it lives in the other mode
// (or doesn't exist). Runs once at boot; never on the hot /health path.
let billingModeStatus = { mode: billingStripeMode(), checked: false, ok: null, prices: [], checkedAt: null };
// SPLIT-2 end
__share({ billingModeStatus });
// SPLIT-2 server.js piece 586

// Which STRIPE_PRICE_* env var backs each plan — used only for a precise server
// log ("billing key is TEST but STRIPE_PRICE_TEAM is a LIVE price").
const PLAN_PRICE_ENV = {
  core: "STRIPE_PRICE_CORE", team: "STRIPE_PRICE_TEAM", founding: "STRIPE_PRICE_FOUNDING",
  seed: "STRIPE_PRICE_SEED", growth: "STRIPE_PRICE_GROWTH", impact: "STRIPE_PRICE_IMPACT",
};
// SPLIT-2 end
__share({ PLAN_PRICE_ENV });
// SPLIT-2 server.js piece 587
// GTM-1a — the tier prices join the mode check, so `/health.billing` reports a
// live price id sitting behind a test key (or the reverse) for the bands that
// are actually on sale, not only for the three legacy plans.
// PRICING-1: each record band's one-time setup price, and the GTM-1a bands
// orgs may still be on, are checked the same way.
for (const t of [...PRICING.TIERS, ...PRICING.LEGACY_TIERS]) {
  PLAN_PRICE_ENV[`${t.id}_monthly`] = t.envMonthly;
  PLAN_PRICE_ENV[`${t.id}_yearly`] = t.envYearly;
  if (t.envSetup) PLAN_PRICE_ENV[`${t.id}_setup`] = t.envSetup;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 588
PLAN_PRICE_ENV[PRICING.INTERNAL_TEST.id] = PRICING.INTERNAL_TEST.env;
// SPLIT-2 end
// SPLIT-2 server.js piece 589

// ── BUILD-90 90b · THE REMINDER AND THE CANCEL BUTTON ──────────────────────
// NOTHING MOVES THE TRIAL END. Not an import, not a second import, not a
// rescheduled onboarding meeting. `orgs.trial_ends_at` is written at signing
// and thereafter only ever re-read from the Stripe subscription that holds the
// same number — `tests/trial-billing.test.js` imports a donor file and proves
// the date is byte-identical afterwards.
//
// Seven days before the charge, ONE email from Jonathan's address: the date,
// the amount, the card's last four, and a one-click cancel. Settings → Billing
// shows the same date and the same button. Nobody has to ring anybody.

// The signed, no-login cancel token — the same HMAC shape as the unsubscribe
// and card-update families, with its own payload so it cannot be swapped for
// one of those. Carries the org, not the subscription, because the
// subscription id may change (a plan switch) while the org never does.
// SECURE-1: it expires. A link that cancels a plan with no sign-in must not
// work for ever from any old, forwarded email; thirty days covers the seven
// before the charge and the weeks after it, then Settings → Billing is the way.
const CANCEL_LINK_DAYS = 30;
// SPLIT-2 end
__share({ CANCEL_LINK_DAYS });
// SPLIT-2 server.js piece 591

// Find every org whose charge is seven days out and warn it once.
// `now` is injectable so the suite can stand on day 23 without waiting.
// ── GTM-1b 2 · WHAT THE AGENT COSTS DURING THE FREE THIRTY DAYS ───────────
//
// The Agent calls a paid model on somebody else's key, and thirty free days
// with no ceiling is an invoice waiting to happen. Twenty-five PLANS is the
// allowance — a plan is one instruction she wrote, which is the unit she
// actually thinks in, not tokens or requests — and it lifts entirely the
// moment the first charge lands.
//
// IT IS COUNTED PER ORG, FOR EVER, NOT PER DAY. A daily allowance would be
// twenty-five a day for thirty days, which is not an allowance. The count is
// rows in `agent_instructions`, so a plan she wrote and deleted still counts:
// it was still a model call, and letting deletes refund the allowance is how
// a cap becomes advisory.
//
// AFTER THE FIRST CHARGE THERE IS NO CAP. `subscription_status = 'active'`
// means Stripe has taken money, which is exactly the line the brief drew.
const AGENT_TRIAL_PLAN_ALLOWANCE = 25;
// SPLIT-2 end
__share({ AGENT_TRIAL_PLAN_ALLOWANCE });
// SPLIT-2 server.js piece 595

// THIRTY DAYS, from pricing.json. The agreement says a new price does not
// take effect for at least this long after the owner is told.
const TIER_NOTICE_DAYS = PRICING.BAND_MOVE.noticeDays;
// SPLIT-2 end
__share({ TIER_NOTICE_DAYS });
// SPLIT-2 server.js piece 596
const MONTHS_OVER_BEFORE_NOTE = PRICING.BAND_MOVE.monthsOverBeforeNote;
// SPLIT-2 end
__share({ MONTHS_OVER_BEFORE_NOTE });
// SPLIT-2 server.js piece 605

// FIX-10 F — UNLIMITED IS ONE NUMBER, AND shared/seats.js IS WHERE IT LIVES.
// This file is CommonJS and shared/ is ESM, so the value is written once here
// and CHECKED against the shared module at boot: a drift is a loud log rather
// than a silent cap on a plan that sells unlimited users.
const SEATS_UNLIMITED = 999999999;
// SPLIT-2 end
__share({ SEATS_UNLIMITED });
// SPLIT-2 server.js piece 606
import("../../shared/seats.js").then(m => {
  if (m.SEATS_UNLIMITED !== SEATS_UNLIMITED)
    console.error(`[plans] SEATS_UNLIMITED drift: server.js ${SEATS_UNLIMITED} vs shared/seats.js ${m.SEATS_UNLIMITED}`);
}).catch(() => {});
// SPLIT-2 end
// SPLIT-2 server.js piece 607
// SEATS_UNLIMITED used for "unlimited" — Infinity serializes to null in JSON
// trial gets Team limits: limits only engage once trial converts to paid.
// Core/Team bands (BUILD-24) are INFORMATIONAL for launch — the numbers shown
// on the pricing page — but NOT hard-enforced (see SOFT_BAND_PLANS below).
// When bands are eventually enforced they must count ACTIVE donors (gave within
// ~3 years), not every record, or the pricing page's claim becomes false.
// FIX-32: unlimited users on every plan, including the trial and the legacy
// Core/Team/founding prices. One plan; a seat count is not a gate.
const PLAN_LIMITS = {
  core:     { seats: SEATS_UNLIMITED, records: 5000,      extraSeatPrice: null },
  team:     { seats: SEATS_UNLIMITED, records: 25000,     extraSeatPrice: null },
  founding: { seats: SEATS_UNLIMITED, records: 5000,      extraSeatPrice: null },
  seed:     { seats: 1,         records: 1000,      extraSeatPrice: null },
  growth:   { seats: 5,         records: 10000,     extraSeatPrice: 25   },
  impact:   { seats: SEATS_UNLIMITED, records: 999999999, extraSeatPrice: null },
  trial:    { seats: SEATS_UNLIMITED, records: 25000,     extraSeatPrice: null },
  portal:   { seats: 3,         records: 25000,     extraSeatPrice: null }, // BUILD-46 network tier (soft)
};
// SPLIT-2 end
__share({ PLAN_LIMITS });
// SPLIT-2 server.js piece 608

// GTM-1a — UNLIMITED USERS, on every tier, because that is what the page
// sells. The record band is the tier's own donor band and it is INFORMATIONAL
// (every tier plan is in SOFT_BAND_PLANS below): going over it is a
// conversation and thirty days' notice, never a door that shuts. GTM-1b 1 is
// the notice.
// PRICING-1: the record bands, and the GTM-1a t-bands an org may still be on.
for (const p of require("../../closeLink").CLOSE_PLANS.filter(c => c.tierId)) {
  const tier = PRICING.tierForPlanValue(p.tierId);
  PLAN_LIMITS[p.id] = { seats: SEATS_UNLIMITED, records: tier ? tier.maxRecords : 999999999, extraSeatPrice: null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 609
PLAN_LIMITS.internal_test = { seats: SEATS_UNLIMITED, records: 999999999, extraSeatPrice: null };
// SPLIT-2 end
// SPLIT-2 server.js piece 610

// Core/Team/founding bands are kept SOFT for launch — informational only, never
// a hard 403. Legacy seed/growth/impact keep their existing hard enforcement so
// no pre-cutover org's behavior changes.
const TIER_PLAN_IDS = require("../../closeLink").CLOSE_PLANS.filter(c => c.tierId).map(p => p.id);
// SPLIT-2 end
__share({ TIER_PLAN_IDS });
// SPLIT-2 server.js piece 611
const SOFT_BAND_PLANS = new Set(["core", "team", "founding", "portal", "internal_test", ...TIER_PLAN_IDS]);
// SPLIT-2 end
__share({ SOFT_BAND_PLANS });
// SPLIT-2 server.js piece 614

// ── Gmail integration ──────────────────────────────────────────────────────

// ── INT-4 · ONE MAILBOX SYNC, FOR GMAIL AND OUTLOOK ────────────────────────
//
// THE DEFAULT IS THAT NOTHING IS STORED. The provider is asked only for
// messages involving an address that already belongs to somebody on file, and
// every message that comes back still has to pass `classifyMailboxMessage`
// before a single field of it is written. Her doctor, her children's school and
// her job applications are not merely filtered out of the record: they are
// never fetched, never counted and never named.
//
// What replaced the first version of this, and why:
//   · the tokens are SEALED now, not plaintext columns;
//   · the actor is stamped (`system:mailbox/<provider>/<userId>`), which the
//     old writer left NULL against the standing rule, and which is also what
//     makes "remove everything I logged" able to find her rows and only hers;
//   · the body is the real message with the quoted reply trimmed, not Gmail's
//     snippet, because a record of a conversation that stops at 100 characters
//     is not a record of the conversation;
//   · her never-log list and her pause switch are consulted every run.
// ── FIX-33 · EVERY RUN LEAVES A ROW ────────────────────────────────────────
// "Connected · not read yet" was all the card could say, because a run that
// threw, returned early or hung left no trace anywhere: last_synced_at was
// written only at the very end of a run that finished. Now every mail read,
// calendar read and push writes one mailbox_sync_runs row when it starts and
// closes it with what it found or the one plain sentence of what went wrong.
// The health panel, the reconnect banner, the error digest and the prod smoke
// read only these rows.
const SYNC_STALE_MS = 2 * 3600e3;
// SPLIT-2 end
__share({ SYNC_STALE_MS });
// SPLIT-2 server.js piece 615
let mailboxSyncHealth = { connections: null, stale: null, checkedAt: null };
// SPLIT-2 end
__share({ mailboxSyncHealth });
// SPLIT-2 server.js piece 620
// FIX-34 · ONE RUN PER CONNECTION AT A TIME, and a 429 is honoured. The lock
// is a Postgres advisory lock, so it also holds across two instances.
const APIC = require("../../apiCheck");
// SPLIT-2 end
__share({ APIC });
// SPLIT-2 server.js piece 621
const MBF = require("../../mailboxFetch");
// SPLIT-2 end
__share({ MBF });
// SPLIT-2 server.js piece 622
const CLIENT_SAFE = require("../../clientSafe");
// SPLIT-2 end
__share({ CLIENT_SAFE });
// SPLIT-2 server.js piece 623
const SEALED_MAIL = require("../mail/sealedMail");
// SPLIT-2 end
__share({ SEALED_MAIL });
// SPLIT-2 server.js piece 624
const syncLockKey = (kind, conn) => `mailboxsync:${kind}:${conn.id}`;
// SPLIT-2 end
__share({ syncLockKey });
// SPLIT-2 server.js piece 625
const backedOff = conn => conn.retry_after && new Date(conn.retry_after).getTime() > Date.now();
// SPLIT-2 end
__share({ backedOff });
// SPLIT-2 server.js piece 627
const PROVIDER_TIMEOUT_MS = 20000;
// SPLIT-2 end
__share({ PROVIDER_TIMEOUT_MS });
// SPLIT-2 server.js piece 628
const providerFetch = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
// SPLIT-2 end
__share({ providerFetch });
// SPLIT-2 server.js piece 637

// ── FIX-28 · STEWARD'S DATES ON HER OWN CALENDAR ───────────────────────────
// One way, and only when she turned it on (mailbox_connections.push_dates).
// The dated items that are HERS (a grant deadline she is the officer on, her
// next steps and tasks, her journey steps) for the next 60 days go onto her
// connected calendar as all-day entries. A moved item moves there, a finished
// or removed one comes off. Meetings are already on her calendar, and items
// with no one person (shifts, events, sends, pledges) stay on the Steward
// Calendar only. The entries carry no attendees, so the calendar read above
// drops them and they never come back as meetings.
const PUSH_TYPES = ["step", "deadline", "journey"];
// SPLIT-2 end
__share({ PUSH_TYPES });
// SPLIT-2 server.js piece 638
const PUSH_AHEAD_DAYS = 60;
// SPLIT-2 end
__share({ PUSH_AHEAD_DAYS });
// SPLIT-2 server.js piece 643
// FIX-34 · A CALENDAR RUN WITH NOTHING NEW IS ONE SMALL CALL. Google is asked
// whether anything changed (deletions included) since the last full read; if
// nothing did, the run stops there. A full read still happens at least every
// 6 hours so events sliding into the window are picked up.
const CAL_FULL_EVERY_MS = 6 * 3600e3;
// SPLIT-2 end
__share({ CAL_FULL_EVERY_MS });
// SPLIT-2 server.js piece 644
// FIX-34 · GRAPH DELTA AS THE "ANYTHING NEW?" QUESTION. Each folder keeps its
// deltaLink on the connection (graph_delta: { inbox, sent, calendar } each
// { link, at }). A stored link younger than 6 hours is asked once: no changes
// is one small call and the run stops. Otherwise the link is (re)made by
// paging a delta from now (mail) or over the calendar window, and the full
// read runs. A 410 (link gone) or any other refusal is a full read; a 429 waits.
const GRAPH_DELTA_FULL_MS = 6 * 3600e3;
// SPLIT-2 end
__share({ GRAPH_DELTA_FULL_MS });
// SPLIT-2 server.js piece 645
const graphDeltaStart = (key) => {
  const g = GRAPH_BASE() + "/v1.0/me";
  if (key === "calendar") {
    const CLW = { past: 30, ahead: 60 };   // shared/calendarLog.js WINDOW_PAST_DAYS / WINDOW_AHEAD_DAYS
    return `${g}/calendarView/delta?` + new URLSearchParams({ startDateTime: new Date(Date.now() - CLW.past * 864e5).toISOString(),
      endDateTime: new Date(Date.now() + CLW.ahead * 864e5).toISOString() });
  }
  const folder = key === "inbox" ? "Inbox" : "SentItems";
  return `${g}/mailFolders('${folder}')/messages/delta?` + new URLSearchParams({ $select: "id",
    $filter: `receivedDateTime ge ${new Date(Date.now() - 5 * 60e3).toISOString()}` });
};
// SPLIT-2 end
__share({ graphDeltaStart });
// SPLIT-2 server.js piece 653

/**
 * ONLY MESSAGES THAT ALREADY INVOLVE SOMEBODY ON FILE ARE ASKED FOR.
 * The query sent to the provider names the addresses; anything else in the
 * mailbox is never returned, so Steward never holds it even in memory.
 */
// The provider roots, read per call so a suite's stand-in (GMAIL_API_BASE,
// GRAPH_API_BASE) serves every mail URL, the attachments included.
const GMAIL_BASE = () => process.env.GMAIL_API_BASE || "https://gmail.googleapis.com";
// SPLIT-2 end
__share({ GMAIL_BASE });
// SPLIT-2 server.js piece 654
const GRAPH_BASE = () => process.env.GRAPH_API_BASE || "https://graph.microsoft.com";
// SPLIT-2 end
__share({ GRAPH_BASE });
// SPLIT-2 server.js piece 656

const addrOf = s => { const m = String(s || "").match(/<([^>]+)>/); return (m ? m[1] : String(s || "")).trim().toLowerCase(); };
// SPLIT-2 end
__share({ addrOf });
// SPLIT-2 server.js piece 657
// THREAD-3: the few headers that tell a person's email from a newsletter, a
// receipt or an automatic reply (shared/mailboxLog.js mailKind). Read, used to
// decide, and kept only as the one word the decision produced.
const MAIL_KIND_HEADERS = ["auto-submitted", "x-autoreply", "x-autorespond", "precedence", "list-unsubscribe", "list-id"];
// SPLIT-2 end
__share({ MAIL_KIND_HEADERS });
// SPLIT-2 server.js piece 667

// ── Events ────────────────────────────────────────────────────────────────────


// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA
// ════════════════════════════════════════════════════════════════════════════
// shared/eventShape.js holds the rule: a ticket is a gift that bought
// something, and the receipt says so. Levels carry price and fair-market
// value; registration writes the gift through recordGift with the split on it,
// so the EXISTING receipt path states "$90 deductible" with no second receipt
// renderer. A sponsor who has not paid yet is a PLEDGE, not money.
let EV = null;
// SPLIT-2 end
__share({ EV });
// SPLIT-2 server.js piece 668
const EV_READY = import("../../shared/eventShape.js").then(m => { EV = m; __share({ EV }); return m; });
// SPLIT-2 end
__share({ EV_READY });
// SPLIT-2 server.js piece 669
const rbCentsEv = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ rbCentsEv });
// SPLIT-2 server.js piece 673

// ── BUILD-101 — MEMBERSHIPS ───────────────────────────────────────────────
// A membership is one person on one level. Its payment is a GIFT through
// recordGift with the level's fair-market value as the quid-pro-quo, so the
// existing receipt states the deductible split and the ledger posts once:
// membership money and donation money are the same rows, and the split is a
// fact on the gift, never a second total.
let MB = null;
// SPLIT-2 end
__share({ MB });
// SPLIT-2 server.js piece 674
const MB_READY = import("../../shared/membership.js").then(m => { MB = m; __share({ MB }); return m; });
// SPLIT-2 end
__share({ MB_READY });
// SPLIT-2 server.js piece 675
const mbCents = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ mbCents });
// SPLIT-2 server.js piece 683

// §5 — the theme a donor's browser receives. Colors are normalized to WCAG-
// legible values at SAVE time (normalizeAccent, the one contrast impl shared
// with org branding); this re-checks at render and falls back to the designed
// neutral default rather than ever shipping an unreadable portal.
const PORTAL_DEFAULT_THEME = { primary: "#1a6b4a", primaryFg: "#ffffff", accent: "#c9a84c", accentFg: "#0f1a12" };
// SPLIT-2 end
__share({ PORTAL_DEFAULT_THEME });
// SPLIT-2 server.js piece 684

// BUILD-48 theme-depth ENUMS. Type pairing keys resolve to font stacks in
// client/src/lib/portalTheme.js (fixed client code — the org supplies only a
// validated KEY, never a font string/URL, so theming is not a CSS/font
// injection surface; parity with the client map is pinned by
// tests/theme-depth.test.js). Card style is the same shape: one enum.
const PORTAL_TYPE_PAIRINGS = ["dm", "classic", "editorial", "literary", "modern"];
// SPLIT-2 end
__share({ PORTAL_TYPE_PAIRINGS });
// SPLIT-2 server.js piece 685
const PORTAL_CARD_STYLES = ["rounded", "square", "soft-shadow"];
// SPLIT-2 end
__share({ PORTAL_CARD_STYLES });
// SPLIT-2 server.js piece 687

// ── BUILD-60 — the giving page is the ORG's page ────────────────────────────
// The public /give flow must be indistinguishable from the org's own site:
// the org's colors, logo, type pairing, banner and white-label display name —
// from the SAME portal theme the portal already uses (portalCardTheme), never
// Steward's mark or emerald. An org with no theme falls back to the designed
// neutral portal default (never a Steward brand color).
//
// Per-frequency amount ladders (Part 2): defaults live here; an org overrides
// them on portal_settings.onetime_amounts / monthly_amounts.
const GIVE_ONETIME_DEFAULT = [25, 50, 100, 250, 500];
// SPLIT-2 end
__share({ GIVE_ONETIME_DEFAULT });
// SPLIT-2 server.js piece 688
const GIVE_MONTHLY_DEFAULT = [10, 25, 50, 100, 250];
// SPLIT-2 end
__share({ GIVE_MONTHLY_DEFAULT });
// SPLIT-2 server.js piece 692

// The theme columns every public /give endpoint selects from portal_settings.
// Aliased to the names portalCardTheme + giveThemePayload read. LIST-3: the
// logo falls back to Settings → Branding's (orgs.logo_data), so a logo saved
// there reaches the giving page; every query here joins orgs as `o`.
const GIVE_THEME_COLS = `ps.display_name,
  COALESCE(ps.logo_url, ps.logo_data, o.logo_data) AS give_logo,
  COALESCE(ps.header_image_url, ps.header_image_data) AS give_header_image,
  ps.header_focal_x, ps.header_focal_y, ps.header_crop,
  ps.primary_color, ps.accent_color, ps.button_color, ps.background_tint,
  ps.type_pairing, ps.card_style,
  ps.footer_text AS give_footer, ps.contact_email AS give_contact, ps.ein_line AS give_ein,
  ps.powered_by, ps.onetime_amounts, ps.monthly_amounts,
  ps.enabled AS portal_enabled`;
// SPLIT-2 end
__share({ GIVE_THEME_COLS });
// SPLIT-2 server.js piece 693

// ── Rate limits (P-3/S-5) ──────────────────────────────────────────────────
// The x-test-* headers are honored ONLY under DISABLE_RATE_LIMIT=1 (the local
// scratch stack): they let the scripted-burst suite exercise the REAL limiter
// while every other suite stays unthrottled. Production ignores them entirely.
const portalLimiterSkip = (req) => rateLimitDisabled() && !req.headers["x-test-enforce-limits"];
// SPLIT-2 end
__share({ portalLimiterSkip });
// SPLIT-2 server.js piece 694
const portalLimiterIpKey = (req) =>
  (rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : ipKeyGenerator(req.ip);
// SPLIT-2 end
__share({ portalLimiterIpKey });
// SPLIT-2 server.js piece 695
const portalLinkIpLimiter = rateLimit("portalLinkIpLimiter", {
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-ip:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ portalLinkIpLimiter });
// SPLIT-2 server.js piece 696
const portalLinkEmailLimiter = rateLimit("portalLinkEmailLimiter", {
  windowMs: 15 * 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-em:" + String(req.body?.email || "").toLowerCase().trim().slice(0, 200),
});
// SPLIT-2 end
__share({ portalLinkEmailLimiter });
// SPLIT-2 server.js piece 697
const portalMutationLimiter = rateLimit("portalMutationLimiter", {
  windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "pmut:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ portalMutationLimiter });
// SPLIT-2 server.js piece 699

// SECURE-1 · no SVG. An SVG is a document that can carry script, and these
// bytes are served from the app's own domain, so a logo could have read a
// signed-in session. The browser draws an SVG as a PNG before it uploads
// (client/src/lib/imageResize.js svgToPng); a raw SVG is refused here.
const PORTAL_IMG_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// SPLIT-2 end
__share({ PORTAL_IMG_MIMES });
// SPLIT-2 server.js piece 700

// BUILD-51 — server-side dimension validation for theme images. SVGs are
// vectors (scale losslessly) and skip the raster rules; rasters must parse.
// The header rule exists because the takeover renders it as a ~5:1 banner
// crop: a portrait image can only decapitate its subject, so it's rejected
// outright (with the Settings crop preview showing WHY before upload).
// ── BUILD-86 FIX — THE BYTES MUST BE WHAT THE UPLOAD SAYS THEY ARE ────────
// Rejection of malformed uploads used to rest entirely on `imageSize` failing
// to parse them, which is a DEPENDENCY'S FAILURE MODE, not a check. Three junk
// bytes declared as PNG return {width:0,height:0,type:"tga"} on one machine
// and something else on another — so the same upload was refused locally and
// accepted in CI, and the suite that caught it (portal-page) was right both
// times. A guard that only works where its library happens to give up is not a
// guard.
//
// This is the deterministic half: the magic number has to agree with the MIME
// the caller declared. It is also strictly STRONGER than what it replaces,
// because it closes "declare PNG, send something else" — which parsed fine and
// was never refused at all.
const IMAGE_MAGIC = {
  "image/png":  b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif":  b => b.length >= 6 && (b.slice(0, 6).toString("latin1") === "GIF87a" || b.slice(0, 6).toString("latin1") === "GIF89a"),
  "image/webp": b => b.length >= 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP",
  // SVG is text: it must actually contain an <svg> element, not merely claim to.
  "image/svg+xml": b => /<svg[\s>]/i.test(b.slice(0, 2048).toString("utf8")),
};
// SPLIT-2 end
__share({ IMAGE_MAGIC });
// SPLIT-2 server.js piece 704

// ── BUILD-65 Part 1 — uploads should not make anyone think about bytes ──────
// The 350KB cap (validPortalImage's old 500000-char limit) was vestigial from
// the base64-in-the-row era: it existed because the image string was stored in
// a DB column and echoed in every payload. Since BUILD-51 the BYTES live behind
// the asset seam and only a /portal-assets/ URL rides payloads — so the only
// real limits are (a) don't accept a decompression bomb, (b) don't store a
// 15MB master. We RESIZE + COMPRESS on ingest instead of rejecting: a phone
// photo (3–5MB) is the case every org starts with, and it must just work.
//
// Accept up to ~15MB of actual image (≈ 20MB of base64 + JSON — the upload
// routes carry a 22mb body cap for this). Reject only non-images and genuinely
// absurd payloads, with words a nonprofit staffer can act on — never a byte
// count they have to satisfy in Photoshop.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;                 // ~15MB of decoded image
// SPLIT-2 end
__share({ MAX_UPLOAD_BYTES });
// SPLIT-2 server.js piece 705
const MAX_UPLOAD_STR = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 1024; // its base64 length + slack
// SPLIT-2 end
__share({ MAX_UPLOAD_STR });
// SPLIT-2 server.js piece 706
// The largest each slot actually renders at. We cap the LONG edge here so the
// stored master is never bigger than the biggest place it's shown; the ?w=
// route still serves smaller responsive variants on demand (each cached once).
const UPLOAD_LONG_EDGE = { header: 2560, campaign: 2560, widget: 2560, impact: 2000, logo: 1200 };
// SPLIT-2 end
__share({ UPLOAD_LONG_EDGE });
// SPLIT-2 server.js piece 710

// ── BUILD-54 §2 — donor-facing campaign content helpers ────────────────────
// The campaign STORY is sanitized structured text — a validated block array,
// never HTML/CSS/JS and never paste-in embed code. Unknown block types,
// oversized content, or non-string leaves reject the whole payload (400), so
// nothing unvalidated can ever reach a donor's browser. React renders the
// strings as text nodes (escaped by construction).
const STORY_BLOCK_TYPES = ["p", "h2", "ul"];
// SPLIT-2 end
__share({ STORY_BLOCK_TYPES });
// SPLIT-2 server.js piece 712

// ═══ BUILD-54 §4 — the portal page: typed widget system ═════════════════════
// Widgets are TYPED FIELDS AND DESIGNED VARIANTS — never raw HTML, CSS, JS,
// or paste-in embed code. Every widget payload is validated field-by-field;
// hostile strings are inert data (React renders text nodes); images ride the
// BUILD-51 asset seam (kind 'widget'); video is stored as {provider, videoId}
// parsed server-side from an allowlist — a stored page can never contain a
// caller-supplied URL, tag, or script.
// BUILD-95 §5B — READ FROM THE ONE REGISTRY, never re-declared here. The list
// used to live in three files nothing kept in step; `tests/page-widgets.test.js`
// now walks all three back to `shared/pageWidgets.js`.
const widgetMod = () => import("../../shared/pageWidgets.js");
// SPLIT-2 end
__share({ widgetMod });
// SPLIT-2 server.js piece 714

// ═══════════════════════════════════════════════════════════════════════════
// BUILD-46 — GLOBAL DONOR ACCOUNTS & THE GIVING NETWORK
//
// THE WALL (the whole build's safety invariant): a donor may see across orgs;
// an org may never see across orgs. Nothing in this section may ever be
// reachable from an org-side (requireAuth) code path, and no org-side route
// may read donor_accounts / aliases / links / resets / donor_account_audit.
// Enforced by tests/org-blindness.test.js (S-13 byte-equality).
//
// FEATURE FLAGS (mid-run rule, 2026-08-12): everything donor-visible or
// signup-visible in this build is OFF in prod by default — built ≠ launched.
//   DONOR_ACCOUNTS_ENABLED=1  → /account/* routes + account-stamped sessions
//   NETWORK_SIGNUP_ENABLED=1  → POST /network/signup (the §3 surface)
// With both unset, prod behavior is byte-identical to BUILD-45.
// ═══════════════════════════════════════════════════════════════════════════
const DONOR_ACCOUNTS_ENABLED = process.env.DONOR_ACCOUNTS_ENABLED === "1";
// SPLIT-2 end
__share({ DONOR_ACCOUNTS_ENABLED });
// SPLIT-2 server.js piece 715
const NETWORK_SIGNUP_ENABLED = process.env.NETWORK_SIGNUP_ENABLED === "1";
// SPLIT-2 end
__share({ NETWORK_SIGNUP_ENABLED });
// SPLIT-2 server.js piece 716
// A disabled surface is INVISIBLE, not "403 coming soon" — same body as the
// global 404 so the routes' existence leaks nothing pre-launch.
const requireFlag = (on) => (req, res, next) => on ? next() : res.status(404).json({ error: "Not found" });
// SPLIT-2 end
__share({ requireFlag });
// SPLIT-2 server.js piece 717
const foldEmail = (e) => String(e || "").trim().toLowerCase();
// SPLIT-2 end
__share({ foldEmail });
// SPLIT-2 server.js piece 719

// ── §1.1 rate limits (same x-test seam discipline as the portal limiters) ──
const accountIpLimiter = rateLimit("accountIpLimiter", {
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-ip:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ accountIpLimiter });
// SPLIT-2 server.js piece 720
const accountEmailLimiter = rateLimit("accountEmailLimiter", {
  windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-em:" + foldEmail(req.body?.email).slice(0, 200),
});
// SPLIT-2 end
__share({ accountEmailLimiter });
// SPLIT-2 server.js piece 721

// ═══ BUILD-47 — find your nonprofits: directory + follows ══════════════════
// The directory reveals ONE fact: that a LISTED org is on the network — which
// listing opted into. Never anything about any donor, and never an unlisted,
// pending, or delisted org (all three fail the enabled+network_listed
// predicate by construction: pending applications ship disabled+unlisted,
// the delist sweep clears network_listed).
//
// Adding an org must never, by itself, reveal or imply giving history. The
// add flow runs ONE code path for every outcome and returns ONE response
// shape; what the donor sees comes from the dashboard refetch, which renders
// only what the verified-email link machinery entitles them to.

const directorySearchLimiter = rateLimit("directorySearchLimiter", {
  windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "dir:" + ((rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : (req.donorAccount?.id || portalLimiterIpKey(req))),
});
// SPLIT-2 end
__share({ directorySearchLimiter });
// SPLIT-2 server.js piece 722
const addOrgLimiter = rateLimit("addOrgLimiter", {
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "diradd:" + ((rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : (req.donorAccount?.id || portalLimiterIpKey(req))),
});
// SPLIT-2 end
__share({ addOrgLimiter });
// SPLIT-2 server.js piece 724
const networkSignupLimiter = rateLimit("networkSignupLimiter", {
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "netsignup:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ networkSignupLimiter });
// SPLIT-2 server.js piece 727

// ═══════════════════════════════════════════════════════════════════════════
// BUILD-87 PART 3 — EMAIL LOGGING BY BCC
//
// One logging address per org: log+<org_slug>@<INBOUND_EMAIL_DOMAIN>. BCC it
// on any email to a donor and the message lands on that donor's record.
//
// THE WHOLE SURFACE IS FLAGGED OFF (INBOUND_EMAIL_ENABLED=1 to turn it on), and
// off means 404 — the requireFlag convention: a disabled surface is invisible,
// not "403 coming soon". With the flag unset, production behaviour is
// byte-identical to the commit before this one.
//
// NO PROVIDER IS CHOSEN HERE, DELIBERATELY. Picking who receives the mail is a
// new subprocessor and a DNS change — a decision about what leaves the system
// — so the webhook takes a NORMALIZED payload any provider can be adapted to
// and the provider is decided (Resend) but not switched on — NEEDS-JONATHAN.md §9. All the
// parsing, matching and stripping is in shared/inboundEmail.js, pure, so this
// path is provable with no mail provider in existence.
//
// THE TENANT WALL, stated once: the org is the plus-address and NOTHING else,
// and the sender must be a user of that org. Both refusals are counted, not
// guessed at, and neither can be talked around by a From header — the shared
// secret below is what stops anyone who has seen a BCC line from writing into
// somebody's CRM.
// ═══════════════════════════════════════════════════════════════════════════
const INBOUND_EMAIL_ENABLED = process.env.INBOUND_EMAIL_ENABLED === "1";
// SPLIT-2 end
__share({ INBOUND_EMAIL_ENABLED });
// SPLIT-2 server.js piece 728
const INBOUND_EMAIL_DOMAIN = (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase();
// SPLIT-2 end
__share({ INBOUND_EMAIL_DOMAIN });
// SPLIT-2 server.js piece 730

require("../shared/testPlants").plant(app, { testMode, requireAuth, wrap, query, run, newId });   // TEST_MODE only
// SPLIT-2 end
// SPLIT-2 server.js piece 731
// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
// SPLIT-2 end
// SPLIT-2 server.js piece 732

// ── Global error handler ───────────────────────────────────────────────────
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
// SPLIT-2 end
// SPLIT-2 server.js piece 733
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // FIX-12 Part 3: a model call the org's AI switch refused is the org's
  // choice, not a crash. A route with a non-AI path catches it before here.
  if (err instanceof AiOffError) return res.status(err.reason === "ai_disabled" ? 403 : err.reason === "ai_budget" ? 429 : 503).json({ error: err.message, message: err.message, code: err.code, reason: err.reason });
  // HARDEN-1: the route PATTERN (not the URL, which carries ids) on the line,
  // so scripts/ci/error-digest.js can group a day of these by type and route.
  const route = (req.baseUrl || "") + ((req.route && req.route.path) || req.path || "");
  // FIX-58: an upload S3 refused every try is a 503 with its sentence, never a
  // 500 (and never a copy in Postgres; assetStore.putThemeAsset).
  if (require("../shared/requestLimits").answerError(err, req, res, route)) return;   // LOAD-1: too long, or abandoned
  if (err && err.code === "asset_store_unavailable") {
    console.error(`[503] ${req.method} ${route} asset store unavailable`);
    return res.status(503).json({ error: err.message, code: err.code });
  }
  // FIX-44: a body parser's own refusal (a body too large, JSON that does not
  // parse, a charset it cannot read) is the sender's mistake, answered with its
  // own 4xx, never a 500.
  if (err && typeof err.type === "string" && Number(err.status) >= 400 && Number(err.status) < 500) {
    console.warn(`[4xx] ${req.method} ${route} ${err.status} ${err.type}`);
    return res.status(Number(err.status)).json({ error: err.status === 413 ? "That request body is too large." : "That request body could not be read." });
  }
  // SECURE-2: the line keeps the request id, route and org; the error itself
  // goes through the redactor (redact.js) like every other log line.
  console.error("[500] %s %s rid=%s org=%s", req.method, route, req.id || "-", (req.user && req.user.orgId) || "-", err);
  res.status(500).json({ error: "Internal server error" });
});
// SPLIT-2 end
// SPLIT-2 server.js piece 734

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
// SPLIT-2 end
__share({ PORT });
// SPLIT-2 server.js piece 735
// DEPLOY-1: the shared modules routes bind on import are a boot need too.
bootGate.need("modules", Promise.all([PT_READY, GC_READY, GREET_READY, ACK_READY, FISCAL_READY, VH_READY, VOL_DAYS_READY,
  CAL_READY, RB_READY, SEQ_READY, EV_READY, MB_READY]));
// SPLIT-2 end
// SPLIT-2 server.js piece 736
const httpServer = app.listen(PORT, () => {
  console.log(`Steward backend running on port ${PORT}`);
  // FIX-49 Part 5 · the Workflows recipes still running become journeys, once,
  // on the first boot that has this code (idempotent; one replica does it).
  // Not on a test boot (ticks off): suites turn recipes on by hand and fire them.
  // FIX-51: four seconds after the migrations, never after listen alone.
  if (!backgroundTicksDisabled()) bootGate.afterMigrations(() => require("../../workflowsToJourneys").convertWorkflows().catch(e => console.error("[workflows-to-journeys]", e.message)), 4000);
  if (backgroundTicksDisabled()) {
    console.log("[boot] background ticks DISABLED (DISABLE_BACKGROUND_TICKS=1 — test boot)");
  }
  if (!process.env.RESEND_DOMAIN_VERIFIED) {
    console.warn("[email] WARNING: RESEND_DOMAIN_VERIFIED not set — emails may land in spam");
  }
  // Boot check for the canonical public URL every email link derives from.
  // Deliberately loud-but-not-fatal: the code-level fallback IS the canonical
  // domain, so links are correct even unset — crashing the API (donations,
  // webhooks) over a missing env var would be worse than the warning. The
  // same state is exposed at /health.publicUrl for post-deploy verification.
  {
    const pu = resolvePublicAppUrl();
    if (pu.rejected) {
      console.error(`[public-url] CRITICAL: FRONTEND_URL is set to a deployment host ("${pu.rejected}") — REJECTED. Email links use ${pu.url}. Set FRONTEND_URL=${CANONICAL_APP_URL}.`);
    } else if (!pu.fromEnv) {
      console.error(`[public-url] WARNING: FRONTEND_URL is unset — email links fall back to ${pu.url}. Set FRONTEND_URL=${CANONICAL_APP_URL} explicitly in production.`);
    } else {
      console.log(`[public-url] email/link base: ${pu.url}`);
    }
  }
  // Self-diagnose a billing key/price Stripe-mode mismatch on boot (non-blocking).
  scheduleBillingModeCheck();
});
// SPLIT-2 end
__share({ httpServer });
// SPLIT-2 server.js piece 737
// DEPLOY-1: SIGTERM drains (server/shared/lifecycle.js).
require("../shared/lifecycle").install(httpServer, { jobs: require("../../jobQueue") });
// SPLIT-2 end
// SPLIT-2 server.js piece 738

// ── "Name the vague anxiety as a number" metrics ────────────────────────────
// Design pattern (see CLAUDE.md): a fuzzy staff worry gets computed into one
// trackable, trending number instead of staying a vibe. Two examples so far,
// sharing the same metric_snapshots storage/trend mechanism rather than each
// getting a bespoke history table:
//   - stewardship_debt: donors weighted by (days since last meaningful
//     contact) x (giving significance), summed across the portfolio. Up =
//     donors are going quiet relative to what they've given; down = staff
//     are keeping pace with their most significant relationships.
//   - first_touch_delay: average days between a donor's first gift and the
//     first personal (non-gift) touch they received. Up = new donors are
//     waiting longer for a human response to their first gift, which donor
//     research consistently ties to weaker retention.
// "Meaningful contact" = call/meeting/email/stewardship interactions —
// deliberately excludes passive rows like email_open or gift/note/
// stage_change, which aren't a human reaching out.
const MEANINGFUL_CONTACT_TYPES = "('call','meeting','email','stewardship')";
// SPLIT-2 end
__share({ MEANINGFUL_CONTACT_TYPES });
// SPLIT-2 server.js piece 739
// BUILD-77 Part 1f — THE ASK GATE, one predicate for every surface with an
// action button. deceased blocks everything; do_not_contact blocks all
// outreach; do_not_solicit blocks ASKS (drift, re-engage, at-risk,
// suggested outreach, ask-automations) while stewardship thank-yous and
// transactional mail may continue. One excluded donor reaching one
// actionable surface is a bug (tests/import-messy.test.js §4).
const solicitableSql = (a = "d") => `${a}.deceased IS NOT TRUE AND ${a}.do_not_contact IS NOT TRUE AND ${a}.do_not_solicit IS NOT TRUE`;
// SPLIT-2 end
__share({ solicitableSql });
// SPLIT-2 server.js piece 743

// Sector benchmark line already used in the onboarding drip email (see
// sendOnboardingSequence's step-0 body) — pulled out as a named constant so
// both places read from one source instead of a second hardcoded "43".
// BUILD-80 Part 9 — the sector-average constant is GONE from every surface
// (BUILD-73's ban: no benchmarking an org on first contact, no unsourced
// sector statistics). Nothing reads it any more; removed rather than left
// as a temptation.

// BUILD-76 follow-up — THE RETENTION CONFIDENCE FLOOR. Below these, the card
// says "not enough history yet" instead of a percentage and drops the sector
// comparison entirely; the daily snapshot also skips, so thin-data artifacts
// never pollute the trend. "100% · 57pt above the sector average" on 16
// donors is arithmetically true and completely meaningless — a development
// director reads 100% as fake and then doubts everything else on the screen
// (the same failure family as the retired "$2M re-engaged" headline:
// presenting a thin-data artifact as an achievement). Same one-place,
// env-overridable pattern as drift.js's DRIFT constants; thresholds
// reasoning in audit/BUILD-76-FINDINGS.md.
const RETENTION_FLOOR = {
  MIN_PRIOR_YEAR_DONORS: 20,   // below ~20, each donor moves the rate ≥5pt — noise, not a rate
  MIN_HISTORY_DAYS: 548,       // ~18 months: a full prior year plus enough current year to compare
};
// SPLIT-2 end
__share({ RETENTION_FLOOR });
// SPLIT-2 server.js piece 744
for (const k of Object.keys(RETENTION_FLOOR)) {
  const env = process.env["RETENTION_" + k];
  if (env !== undefined && env !== "" && Number.isFinite(Number(env))) RETENTION_FLOOR[k] = Number(env);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 747

// ── FIX-1 split: register the moved routes (every binding exists by now) ──
require("../../routes/webhooks").mount({
  BILLING_PLAN_VALUES, DUNNING_SCHEDULE_DAYS, EV_READY, GC_READY, INBOUND_EMAIL_DOMAIN,
  INBOUND_EMAIL_ENABLED, MB_READY, Sentry, SvixWebhook, UNSUB_SECRET, bcrypt, billingCustomerColumn,
  billingStripe, bumpFormEvent, checkGiftExtras, closePlan, computeTrialEnd, crypto,
  displayNameCase, donorByNameOrCreate, donorFacingOrgName, donorFromAddress, donorMailDecision,
  donorSendOpts, enrollMembership, ensureOrgLedger, express, fireWorkflows, firstChargeSentence, planAmountUsd,
  inboundMod, inviteeDisplayName, issueGiftReceipt, linkEmailToAccounts, logRecoveryEvent,
  logRecurringChange, mbCents, money, openGiftThread, openSustainerLapseThread, orgToday, orgTz,
  orgTzName, planFromSubscription, portalTimeline, provisionNewOrgWorkflows, publicAppUrl, query,
  recalcDonorSummary, recalcPledgePayment, recordAutoMove, recordGift, registerForEvent,
  renewMembership, requireAdmin, requireAuth, requireFlag, resend, run, runTx, stripe, toCents,
  unsubscribeEmailFooterHtml, uuid, withAdvisoryLock, withTransaction, wrap, writeGiftExtras,
  rateLimitHandler, rateLimitDisabled,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 748
require("../../routes/billing").mount({
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
  validateOrgClose, wrap, orgSendingIdentity,
  // GTM-1a — the pricing catalogue, the amount/cadence helpers for a plan that
  // may be yearly, and the click-through agreement.
  PRICING,
  planAmountUsd: require("../../closeLink").planAmountUsd,
  planInterval: require("../../closeLink").planInterval,
  SELLABLE_CLOSE_PLANS: require("../../closeLink").SELLABLE_CLOSE_PLANS,
  customerAgreement: require("../../customerAgreement"),
  checkRecordBand, countRecords, checkAllRecordBands, applyAgreedBandMoves, processRecordBands,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 749
require("../../routes/finance").mount({
  AGENT_MODEL,
  recordGift, recalcDonorSummary, recalcPledgePayment,   // QBO-IN — the QuickBooks read   // FIX-12 Part 7b — the after-meeting chips use the Agent engine's model
  // INT-BUILD-1 — the first sync after a connect, and the calendar.
  syncMailbox, syncCalendar, pushStewardDates, mailboxAccessToken, closeThreadStepForContact,
  actor, checkWriteAccess, crypto, grantBalanceFrom, grantMoneyRows, money, orgOwns,
  orgTime, orgToday, orgTz, orgUnrestrictedFundId, parseMoneyOrThrow, query, requireAdmin,
  requireAuth, restrictedMod, run, stripe, toDollars, uuid, wrap, writeAuditLog,
  // INT-3 — the audience resolver the campaign sender already uses. Passed in
  // rather than reimplemented, because a second definition of "all donors"
  // would eventually disagree with the one that decides who gets a campaign,
  // and the half that lost would push somebody who asked to stop.
  resolveSegmentSpec, filterBySegment,
  // The ONE unsubscribe write. BUILD-94 put it in routes/webhooks.js; INT-3
  // calls that same function rather than writing `email_suppressions` a second
  // time, so an unsubscribe from Mailchimp and an unsubscribe from a Resend
  // complaint land identically.
  recordUnsubscribe: require("../../routes/webhooks").recordUnsubscribe,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 750
require("../../routes/volunteer").mount({
  SYS_AUTO, VH_READY, actor, checkWriteAccess, crypto, donateLimiter, donorFacingOrgName,
  escapeHtml, express, insertShift, orgToday, orgTz, query, requireAuth, run, uuid,
  volunteerSummary, wrap, markVolunteer, publicAppUrl, writeAuditLog, maybeStartJourneyFromServer,
  makeVolunteer, volunteerRecordSentence, checkVolunteerFields,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 751
// MEMBERS-2 — "Your page" owns the supporter session, and VOL-1's
// /volunteer/me exchanges an old volunteer link for one. It hands the minter
// out here rather than registering a second /volunteer/me of its own: two
// handlers on one path is a route the inventory counts once and the matrix
// probes once, and the one it does not probe is the one that leaks.
let _supporterSession = null;
// SPLIT-2 end
__share({ _supporterSession });
