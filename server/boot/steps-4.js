// SPLIT-2: moved VERBATIM from server.js (the statements from lines 11856-12909, in order). server.js requires the boot modules in
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
let ACK_READY, ACTIVITY_DEFINITIONS, AFTER, AGENT_MODEL, ALL_PIPELINE_STAGES, API_KEY_PREFIX, ASSET_ID_RE, AiOffError, BILLING_PLAN_VALUES, BUILD_SHA, CAL_READY, CANONICAL_APP_URL, CARD_CHECK_BUDGET, CLOSE_PLANS, DB_READY, DONOR_MAIL_ADDR, DUNNING_SCHEDULE_DAYS, EV_READY, FISCAL_READY, GC_READY, GEOCODE_TICK_BUDGET, GIFT_METHOD_UNKNOWN, GIVE_MONTHLY_DEFAULT, GIVE_ONETIME_DEFAULT, GIVE_THEME_COLS, GREET_READY, IMPORT_DONOR_BATCH, IMPORT_GIFT_BATCH, LAPSE_DAYS, MB_READY, MILESTONE_THRESHOLDS, PHOTO_FETCH_BUDGET, PLAN_LIMITS, PLAN_PRICE_ENV, PORTAL_CARD_STYLES, PORTAL_DEFAULT_THEME, PORTAL_TYPE_PAIRINGS, PRICING, PT_READY, RB_READY, RECONCILE_INTERVAL_MIN, RECOVERY_SECRET, SEQ_READY, SYS_AUTO, Sentry, SvixWebhook, TOTP, UNSUB_SECRET, VH_READY, VOL_DAYS_READY, WORKFLOW_RECIPE_MAP, _sendDraft, _titleCaseWord, _tzCache, _volunteerReminders, _volunteerSignUp, actor, agentGate, agentTrialAllowance, aiGate, allocateReceiptNumber, anthropicFor, apiLimiter, app, applyAgreedBandMoves, applyGiftAsMembershipRenewal, applyReceiptTokens, asJson, autoEnroll, autoLapseOrg, backgroundTicksDisabled, bcrypt, billingConfigError, billingCustomerColumn, billingStripe, billingStripeMode, bookkeeperRefusalMessage, bookkeeperRefusals, bootGate, brandEmailHeaderHtml, buildCardUpdateUrl, bulkSendAddressGate, bumpFormEvent, campaignAudience, campaignPageMod, checkAllRecordBands, checkBillingPriceModes, checkGiftExtras, checkPlanLimit, checkRecordBand, checkThemeImageDimensions, checkVolunteerFields, checkWebhookSubscriptions, checkWriteAccess, checkoutSessionParams, classifySourceError, closePlan, closeThreadStepForContact, composeActivityReport, composeOfficerMonthly, composeWeekInReview, computeAtRiskCandidates, computeDriftForDonors, computeFirstTouchDelay, computeRecoveryRate, computeRetentionRate, computeStewardshipDebt, computeStewardshipDebtBreakdown, computeThreadHealth, computeTrialEnd, consumerEmailHtml, countRecords, coverFeePayload, crypto, deliverWebhooks, demoMailNote, displayNameCase, donateLimiter, donorAudit, donorByNameOrCreate, donorCreditTotals, donorFacingOrgName, donorFromAddress, donorMailDecision, donorOnly, donorSendOpts, driftEngine, effectivePlanLimits, einLookup, emailCompose, emitWebhook, employerMatchMod, engagementMod, enrollInSequences, enrollMembership, ensureOrgLedger, ensureWorkflows, escHtmlWf, escapeHtml, express, filterBySegment, fireWorkflows, firstChargeSentence, footingMod, formConfigMod, formatChargeDate, fromWithDisplayName, fundraiserManageLimiter, geocode, getOrgAccessState, getThemeAsset, giveThemePayload, givingAccountEntry, givingSourcesMod, google, grantBalanceFrom, grantDocs, grantMoneyRows, grantMsMod, hashApiKey, healthBody, imageBytesMatchMime, inboundMod, ingestPosSale, insertShift, invitationLimiter, inviteeDisplayName, isBlockedAddress, issueGiftReceipt, legacyCampaignBody, levelTaken, linkAccountEmail, linkEmailToAccounts, loadCfDefs, logRecoveryEvent, logRecurringChange, loginAccountLimiter, loginIpLimiter, lookupMatchingGift, mailboxAccessToken, makeOAuth2Client, makeVolunteer, markVolunteer, maybeStartJourneyFromServer, mbCents, membershipSettings, mergeCustomValues, mfaVerifyForUser, money, monthBounds, newId, normalizeAccent, normalizeTint, normalizeUploadImage, notifyExpiringCards, notifyTaskAssignment, notifyUserOnce, onPledgeSettled, openAdminTask, openCareThread, openGiftThread, openSustainerLapseThread, openThreadTx, opsAlert, orgDaysOverdue, orgFiscalYearStart, orgLeadDays, orgMailGateCache, orgMaySendEmail, orgOwns, orgPeriodBounds, orgPlanTier, orgSendClock, orgSendingIdentity, orgTime, orgToday, orgTz, orgTzName, orgUnrestrictedFundId, otherBillingMode, parseCrop, parseMoneyOrThrow, passwordResetLimiter, personPhoto, planAmountUsd, planFromSubscription, pledgeDisplayStatus, portalCardTheme, portalLimiterIpKey, portalLimiterSkip, portalLinkEmailLimiter, portalLinkIpLimiter, portalMutationLimiter, portalTimeline, processAuctionUnpaid, processDunning, processGeocodeQueue, processGivingSources, processGrantMilestones, processMembershipRenewals, processNetworkGate, processPhotoQueue, processPledgeInstallmentReminders, processPledgeReminders, processRecordBands, processSequences, processTrackedSequences, processTrialReminders, processUnansweredMail, processWorkflowSweeps, provisionNewOrgWorkflows, pruneThemeAssets, pruneUnreferencedAssets, publicAppUrl, purgeExpiredAssets, pushStewardDates, putThemeAsset, query, queryTx, queueThankYouDraft, raiseGrantMilestone, rateLimit, rateLimitDisabled, rateLimitHandler, ratesMod, rbCents, rbCentsEv, rbCustomDefs, rbFormatCell, recalcDonorSummary, recalcPledgePayment, recomputeAllScores, recomputeScoresForOrg, reconcileStripeVsGifts, recordAiFallback, recordAssetPointerHistory, recordAutoMove, recordGift, recordMove, recordTick, refreshCardsOnFile, refreshMailboxSyncHealth, refreshReconcileDenominator, registerForEvent, registerJourneyEngine, registerJourneyNudge, registerLimiter, renderReceiptPdf, renewMembership, reportCurrentYear, reportYearBounds, requireAdmin, requireAuth, requireCrm, requireSuperAdmin, resend, resolveCampaignRecipients, resolveOrgBrandTheme, resolvePdfLogo, resolvePublicAppUrl, resolveSegmentSpec, resolveWidgetsPublic, restrictedMod, retryFailedNotifications, round2, run, runBuilderDef, runCampaignSend, runDailyTaskRemindersForOrg, runDigestsForOrg, runSavedReportScheduleForOrg, runStepRemindersForOrg, runThreadNudgesForOrg, runTx, runWeeklyEmailForOrg, sampleDataMod, scheduleBillingModeCheck, scheduleScores, seedOrgData, sendBoardPackEmail, sendDonorLifecycleEmail, sendDunningEmail, sendPledgeReminderEmail, sendReceiptEmail, sendStaffWrittenEmail, sequenceMergeValues, sequenceTimezoneGate, sessionCache, signReconnectToken, signToken, slugifyGivingPage, smartAmountsMod, snapshotMetricsForOrg, sourceAdapters, sourceConfig, sourceErrorSentence, storeAuctionPhoto, stripe, stripeChargesEnabled, sustainerFileFacts, sweepMissedRecurring, sweepQuietConnections, syncCalendar, syncGmail, syncMailbox, syncSource, testMode, threadNudgeDayOk, threadRankMod, threadShapeMod, thresholdsMod, toCents, toDollars, unsubscribeEmailFooterHtml, unsubscribeHeaders, uploadImageError, uuid, validateCloseLink, validateCustomFields, validateOrgClose, validateStoryBlocks, verifyReconnectToken, videoLimiter, volunteerRecordSentence, volunteerSummary, weekBounds, whyAskLimiter, withAdvisoryLock, withSmartAmounts, withTransaction, wrap, writeAuditLog, writeGiftExtras;
__boot.register(c => {
  if ("ACK_READY" in c) ACK_READY = c.ACK_READY;
  if ("ACTIVITY_DEFINITIONS" in c) ACTIVITY_DEFINITIONS = c.ACTIVITY_DEFINITIONS;
  if ("AFTER" in c) AFTER = c.AFTER;
  if ("AGENT_MODEL" in c) AGENT_MODEL = c.AGENT_MODEL;
  if ("ALL_PIPELINE_STAGES" in c) ALL_PIPELINE_STAGES = c.ALL_PIPELINE_STAGES;
  if ("API_KEY_PREFIX" in c) API_KEY_PREFIX = c.API_KEY_PREFIX;
  if ("ASSET_ID_RE" in c) ASSET_ID_RE = c.ASSET_ID_RE;
  if ("AiOffError" in c) AiOffError = c.AiOffError;
  if ("BILLING_PLAN_VALUES" in c) BILLING_PLAN_VALUES = c.BILLING_PLAN_VALUES;
  if ("BUILD_SHA" in c) BUILD_SHA = c.BUILD_SHA;
  if ("CAL_READY" in c) CAL_READY = c.CAL_READY;
  if ("CANONICAL_APP_URL" in c) CANONICAL_APP_URL = c.CANONICAL_APP_URL;
  if ("CARD_CHECK_BUDGET" in c) CARD_CHECK_BUDGET = c.CARD_CHECK_BUDGET;
  if ("CLOSE_PLANS" in c) CLOSE_PLANS = c.CLOSE_PLANS;
  if ("DB_READY" in c) DB_READY = c.DB_READY;
  if ("DONOR_MAIL_ADDR" in c) DONOR_MAIL_ADDR = c.DONOR_MAIL_ADDR;
  if ("DUNNING_SCHEDULE_DAYS" in c) DUNNING_SCHEDULE_DAYS = c.DUNNING_SCHEDULE_DAYS;
  if ("EV_READY" in c) EV_READY = c.EV_READY;
  if ("FISCAL_READY" in c) FISCAL_READY = c.FISCAL_READY;
  if ("GC_READY" in c) GC_READY = c.GC_READY;
  if ("GEOCODE_TICK_BUDGET" in c) GEOCODE_TICK_BUDGET = c.GEOCODE_TICK_BUDGET;
  if ("GIFT_METHOD_UNKNOWN" in c) GIFT_METHOD_UNKNOWN = c.GIFT_METHOD_UNKNOWN;
  if ("GIVE_MONTHLY_DEFAULT" in c) GIVE_MONTHLY_DEFAULT = c.GIVE_MONTHLY_DEFAULT;
  if ("GIVE_ONETIME_DEFAULT" in c) GIVE_ONETIME_DEFAULT = c.GIVE_ONETIME_DEFAULT;
  if ("GIVE_THEME_COLS" in c) GIVE_THEME_COLS = c.GIVE_THEME_COLS;
  if ("GREET_READY" in c) GREET_READY = c.GREET_READY;
  if ("IMPORT_DONOR_BATCH" in c) IMPORT_DONOR_BATCH = c.IMPORT_DONOR_BATCH;
  if ("IMPORT_GIFT_BATCH" in c) IMPORT_GIFT_BATCH = c.IMPORT_GIFT_BATCH;
  if ("LAPSE_DAYS" in c) LAPSE_DAYS = c.LAPSE_DAYS;
  if ("MB_READY" in c) MB_READY = c.MB_READY;
  if ("MILESTONE_THRESHOLDS" in c) MILESTONE_THRESHOLDS = c.MILESTONE_THRESHOLDS;
  if ("PHOTO_FETCH_BUDGET" in c) PHOTO_FETCH_BUDGET = c.PHOTO_FETCH_BUDGET;
  if ("PLAN_LIMITS" in c) PLAN_LIMITS = c.PLAN_LIMITS;
  if ("PLAN_PRICE_ENV" in c) PLAN_PRICE_ENV = c.PLAN_PRICE_ENV;
  if ("PORTAL_CARD_STYLES" in c) PORTAL_CARD_STYLES = c.PORTAL_CARD_STYLES;
  if ("PORTAL_DEFAULT_THEME" in c) PORTAL_DEFAULT_THEME = c.PORTAL_DEFAULT_THEME;
  if ("PORTAL_TYPE_PAIRINGS" in c) PORTAL_TYPE_PAIRINGS = c.PORTAL_TYPE_PAIRINGS;
  if ("PRICING" in c) PRICING = c.PRICING;
  if ("PT_READY" in c) PT_READY = c.PT_READY;
  if ("RB_READY" in c) RB_READY = c.RB_READY;
  if ("RECONCILE_INTERVAL_MIN" in c) RECONCILE_INTERVAL_MIN = c.RECONCILE_INTERVAL_MIN;
  if ("RECOVERY_SECRET" in c) RECOVERY_SECRET = c.RECOVERY_SECRET;
  if ("SEQ_READY" in c) SEQ_READY = c.SEQ_READY;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("Sentry" in c) Sentry = c.Sentry;
  if ("SvixWebhook" in c) SvixWebhook = c.SvixWebhook;
  if ("TOTP" in c) TOTP = c.TOTP;
  if ("UNSUB_SECRET" in c) UNSUB_SECRET = c.UNSUB_SECRET;
  if ("VH_READY" in c) VH_READY = c.VH_READY;
  if ("VOL_DAYS_READY" in c) VOL_DAYS_READY = c.VOL_DAYS_READY;
  if ("WORKFLOW_RECIPE_MAP" in c) WORKFLOW_RECIPE_MAP = c.WORKFLOW_RECIPE_MAP;
  if ("_sendDraft" in c) _sendDraft = c._sendDraft;
  if ("_titleCaseWord" in c) _titleCaseWord = c._titleCaseWord;
  if ("_tzCache" in c) _tzCache = c._tzCache;
  if ("_volunteerReminders" in c) _volunteerReminders = c._volunteerReminders;
  if ("_volunteerSignUp" in c) _volunteerSignUp = c._volunteerSignUp;
  if ("actor" in c) actor = c.actor;
  if ("agentGate" in c) agentGate = c.agentGate;
  if ("agentTrialAllowance" in c) agentTrialAllowance = c.agentTrialAllowance;
  if ("aiGate" in c) aiGate = c.aiGate;
  if ("allocateReceiptNumber" in c) allocateReceiptNumber = c.allocateReceiptNumber;
  if ("anthropicFor" in c) anthropicFor = c.anthropicFor;
  if ("apiLimiter" in c) apiLimiter = c.apiLimiter;
  if ("app" in c) app = c.app;
  if ("applyAgreedBandMoves" in c) applyAgreedBandMoves = c.applyAgreedBandMoves;
  if ("applyGiftAsMembershipRenewal" in c) applyGiftAsMembershipRenewal = c.applyGiftAsMembershipRenewal;
  if ("applyReceiptTokens" in c) applyReceiptTokens = c.applyReceiptTokens;
  if ("asJson" in c) asJson = c.asJson;
  if ("autoEnroll" in c) autoEnroll = c.autoEnroll;
  if ("autoLapseOrg" in c) autoLapseOrg = c.autoLapseOrg;
  if ("backgroundTicksDisabled" in c) backgroundTicksDisabled = c.backgroundTicksDisabled;
  if ("bcrypt" in c) bcrypt = c.bcrypt;
  if ("billingConfigError" in c) billingConfigError = c.billingConfigError;
  if ("billingCustomerColumn" in c) billingCustomerColumn = c.billingCustomerColumn;
  if ("billingStripe" in c) billingStripe = c.billingStripe;
  if ("billingStripeMode" in c) billingStripeMode = c.billingStripeMode;
  if ("bookkeeperRefusalMessage" in c) bookkeeperRefusalMessage = c.bookkeeperRefusalMessage;
  if ("bookkeeperRefusals" in c) bookkeeperRefusals = c.bookkeeperRefusals;
  if ("bootGate" in c) bootGate = c.bootGate;
  if ("brandEmailHeaderHtml" in c) brandEmailHeaderHtml = c.brandEmailHeaderHtml;
  if ("buildCardUpdateUrl" in c) buildCardUpdateUrl = c.buildCardUpdateUrl;
  if ("bulkSendAddressGate" in c) bulkSendAddressGate = c.bulkSendAddressGate;
  if ("bumpFormEvent" in c) bumpFormEvent = c.bumpFormEvent;
  if ("campaignAudience" in c) campaignAudience = c.campaignAudience;
  if ("campaignPageMod" in c) campaignPageMod = c.campaignPageMod;
  if ("checkAllRecordBands" in c) checkAllRecordBands = c.checkAllRecordBands;
  if ("checkBillingPriceModes" in c) checkBillingPriceModes = c.checkBillingPriceModes;
  if ("checkGiftExtras" in c) checkGiftExtras = c.checkGiftExtras;
  if ("checkPlanLimit" in c) checkPlanLimit = c.checkPlanLimit;
  if ("checkRecordBand" in c) checkRecordBand = c.checkRecordBand;
  if ("checkThemeImageDimensions" in c) checkThemeImageDimensions = c.checkThemeImageDimensions;
  if ("checkVolunteerFields" in c) checkVolunteerFields = c.checkVolunteerFields;
  if ("checkWebhookSubscriptions" in c) checkWebhookSubscriptions = c.checkWebhookSubscriptions;
  if ("checkWriteAccess" in c) checkWriteAccess = c.checkWriteAccess;
  if ("checkoutSessionParams" in c) checkoutSessionParams = c.checkoutSessionParams;
  if ("classifySourceError" in c) classifySourceError = c.classifySourceError;
  if ("closePlan" in c) closePlan = c.closePlan;
  if ("closeThreadStepForContact" in c) closeThreadStepForContact = c.closeThreadStepForContact;
  if ("composeActivityReport" in c) composeActivityReport = c.composeActivityReport;
  if ("composeOfficerMonthly" in c) composeOfficerMonthly = c.composeOfficerMonthly;
  if ("composeWeekInReview" in c) composeWeekInReview = c.composeWeekInReview;
  if ("computeAtRiskCandidates" in c) computeAtRiskCandidates = c.computeAtRiskCandidates;
  if ("computeDriftForDonors" in c) computeDriftForDonors = c.computeDriftForDonors;
  if ("computeFirstTouchDelay" in c) computeFirstTouchDelay = c.computeFirstTouchDelay;
  if ("computeRecoveryRate" in c) computeRecoveryRate = c.computeRecoveryRate;
  if ("computeRetentionRate" in c) computeRetentionRate = c.computeRetentionRate;
  if ("computeStewardshipDebt" in c) computeStewardshipDebt = c.computeStewardshipDebt;
  if ("computeStewardshipDebtBreakdown" in c) computeStewardshipDebtBreakdown = c.computeStewardshipDebtBreakdown;
  if ("computeThreadHealth" in c) computeThreadHealth = c.computeThreadHealth;
  if ("computeTrialEnd" in c) computeTrialEnd = c.computeTrialEnd;
  if ("consumerEmailHtml" in c) consumerEmailHtml = c.consumerEmailHtml;
  if ("countRecords" in c) countRecords = c.countRecords;
  if ("coverFeePayload" in c) coverFeePayload = c.coverFeePayload;
  if ("crypto" in c) crypto = c.crypto;
  if ("deliverWebhooks" in c) deliverWebhooks = c.deliverWebhooks;
  if ("demoMailNote" in c) demoMailNote = c.demoMailNote;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donateLimiter" in c) donateLimiter = c.donateLimiter;
  if ("donorAudit" in c) donorAudit = c.donorAudit;
  if ("donorByNameOrCreate" in c) donorByNameOrCreate = c.donorByNameOrCreate;
  if ("donorCreditTotals" in c) donorCreditTotals = c.donorCreditTotals;
  if ("donorFacingOrgName" in c) donorFacingOrgName = c.donorFacingOrgName;
  if ("donorFromAddress" in c) donorFromAddress = c.donorFromAddress;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("donorOnly" in c) donorOnly = c.donorOnly;
  if ("donorSendOpts" in c) donorSendOpts = c.donorSendOpts;
  if ("driftEngine" in c) driftEngine = c.driftEngine;
  if ("effectivePlanLimits" in c) effectivePlanLimits = c.effectivePlanLimits;
  if ("einLookup" in c) einLookup = c.einLookup;
  if ("emailCompose" in c) emailCompose = c.emailCompose;
  if ("emitWebhook" in c) emitWebhook = c.emitWebhook;
  if ("employerMatchMod" in c) employerMatchMod = c.employerMatchMod;
  if ("engagementMod" in c) engagementMod = c.engagementMod;
  if ("enrollInSequences" in c) enrollInSequences = c.enrollInSequences;
  if ("enrollMembership" in c) enrollMembership = c.enrollMembership;
  if ("ensureOrgLedger" in c) ensureOrgLedger = c.ensureOrgLedger;
  if ("ensureWorkflows" in c) ensureWorkflows = c.ensureWorkflows;
  if ("escHtmlWf" in c) escHtmlWf = c.escHtmlWf;
  if ("escapeHtml" in c) escapeHtml = c.escapeHtml;
  if ("express" in c) express = c.express;
  if ("filterBySegment" in c) filterBySegment = c.filterBySegment;
  if ("fireWorkflows" in c) fireWorkflows = c.fireWorkflows;
  if ("firstChargeSentence" in c) firstChargeSentence = c.firstChargeSentence;
  if ("footingMod" in c) footingMod = c.footingMod;
  if ("formConfigMod" in c) formConfigMod = c.formConfigMod;
  if ("formatChargeDate" in c) formatChargeDate = c.formatChargeDate;
  if ("fromWithDisplayName" in c) fromWithDisplayName = c.fromWithDisplayName;
  if ("fundraiserManageLimiter" in c) fundraiserManageLimiter = c.fundraiserManageLimiter;
  if ("geocode" in c) geocode = c.geocode;
  if ("getOrgAccessState" in c) getOrgAccessState = c.getOrgAccessState;
  if ("getThemeAsset" in c) getThemeAsset = c.getThemeAsset;
  if ("giveThemePayload" in c) giveThemePayload = c.giveThemePayload;
  if ("givingAccountEntry" in c) givingAccountEntry = c.givingAccountEntry;
  if ("givingSourcesMod" in c) givingSourcesMod = c.givingSourcesMod;
  if ("google" in c) google = c.google;
  if ("grantBalanceFrom" in c) grantBalanceFrom = c.grantBalanceFrom;
  if ("grantDocs" in c) grantDocs = c.grantDocs;
  if ("grantMoneyRows" in c) grantMoneyRows = c.grantMoneyRows;
  if ("grantMsMod" in c) grantMsMod = c.grantMsMod;
  if ("hashApiKey" in c) hashApiKey = c.hashApiKey;
  if ("healthBody" in c) healthBody = c.healthBody;
  if ("imageBytesMatchMime" in c) imageBytesMatchMime = c.imageBytesMatchMime;
  if ("inboundMod" in c) inboundMod = c.inboundMod;
  if ("ingestPosSale" in c) ingestPosSale = c.ingestPosSale;
  if ("insertShift" in c) insertShift = c.insertShift;
  if ("invitationLimiter" in c) invitationLimiter = c.invitationLimiter;
  if ("inviteeDisplayName" in c) inviteeDisplayName = c.inviteeDisplayName;
  if ("isBlockedAddress" in c) isBlockedAddress = c.isBlockedAddress;
  if ("issueGiftReceipt" in c) issueGiftReceipt = c.issueGiftReceipt;
  if ("legacyCampaignBody" in c) legacyCampaignBody = c.legacyCampaignBody;
  if ("levelTaken" in c) levelTaken = c.levelTaken;
  if ("linkAccountEmail" in c) linkAccountEmail = c.linkAccountEmail;
  if ("linkEmailToAccounts" in c) linkEmailToAccounts = c.linkEmailToAccounts;
  if ("loadCfDefs" in c) loadCfDefs = c.loadCfDefs;
  if ("logRecoveryEvent" in c) logRecoveryEvent = c.logRecoveryEvent;
  if ("logRecurringChange" in c) logRecurringChange = c.logRecurringChange;
  if ("loginAccountLimiter" in c) loginAccountLimiter = c.loginAccountLimiter;
  if ("loginIpLimiter" in c) loginIpLimiter = c.loginIpLimiter;
  if ("lookupMatchingGift" in c) lookupMatchingGift = c.lookupMatchingGift;
  if ("mailboxAccessToken" in c) mailboxAccessToken = c.mailboxAccessToken;
  if ("makeOAuth2Client" in c) makeOAuth2Client = c.makeOAuth2Client;
  if ("makeVolunteer" in c) makeVolunteer = c.makeVolunteer;
  if ("markVolunteer" in c) markVolunteer = c.markVolunteer;
  if ("maybeStartJourneyFromServer" in c) maybeStartJourneyFromServer = c.maybeStartJourneyFromServer;
  if ("mbCents" in c) mbCents = c.mbCents;
  if ("membershipSettings" in c) membershipSettings = c.membershipSettings;
  if ("mergeCustomValues" in c) mergeCustomValues = c.mergeCustomValues;
  if ("mfaVerifyForUser" in c) mfaVerifyForUser = c.mfaVerifyForUser;
  if ("money" in c) money = c.money;
  if ("monthBounds" in c) monthBounds = c.monthBounds;
  if ("newId" in c) newId = c.newId;
  if ("normalizeAccent" in c) normalizeAccent = c.normalizeAccent;
  if ("normalizeTint" in c) normalizeTint = c.normalizeTint;
  if ("normalizeUploadImage" in c) normalizeUploadImage = c.normalizeUploadImage;
  if ("notifyExpiringCards" in c) notifyExpiringCards = c.notifyExpiringCards;
  if ("notifyTaskAssignment" in c) notifyTaskAssignment = c.notifyTaskAssignment;
  if ("notifyUserOnce" in c) notifyUserOnce = c.notifyUserOnce;
  if ("onPledgeSettled" in c) onPledgeSettled = c.onPledgeSettled;
  if ("openAdminTask" in c) openAdminTask = c.openAdminTask;
  if ("openCareThread" in c) openCareThread = c.openCareThread;
  if ("openGiftThread" in c) openGiftThread = c.openGiftThread;
  if ("openSustainerLapseThread" in c) openSustainerLapseThread = c.openSustainerLapseThread;
  if ("openThreadTx" in c) openThreadTx = c.openThreadTx;
  if ("opsAlert" in c) opsAlert = c.opsAlert;
  if ("orgDaysOverdue" in c) orgDaysOverdue = c.orgDaysOverdue;
  if ("orgFiscalYearStart" in c) orgFiscalYearStart = c.orgFiscalYearStart;
  if ("orgLeadDays" in c) orgLeadDays = c.orgLeadDays;
  if ("orgMailGateCache" in c) orgMailGateCache = c.orgMailGateCache;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("orgOwns" in c) orgOwns = c.orgOwns;
  if ("orgPeriodBounds" in c) orgPeriodBounds = c.orgPeriodBounds;
  if ("orgPlanTier" in c) orgPlanTier = c.orgPlanTier;
  if ("orgSendClock" in c) orgSendClock = c.orgSendClock;
  if ("orgSendingIdentity" in c) orgSendingIdentity = c.orgSendingIdentity;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("orgTzName" in c) orgTzName = c.orgTzName;
  if ("orgUnrestrictedFundId" in c) orgUnrestrictedFundId = c.orgUnrestrictedFundId;
  if ("otherBillingMode" in c) otherBillingMode = c.otherBillingMode;
  if ("parseCrop" in c) parseCrop = c.parseCrop;
  if ("parseMoneyOrThrow" in c) parseMoneyOrThrow = c.parseMoneyOrThrow;
  if ("passwordResetLimiter" in c) passwordResetLimiter = c.passwordResetLimiter;
  if ("personPhoto" in c) personPhoto = c.personPhoto;
  if ("planAmountUsd" in c) planAmountUsd = c.planAmountUsd;
  if ("planFromSubscription" in c) planFromSubscription = c.planFromSubscription;
  if ("pledgeDisplayStatus" in c) pledgeDisplayStatus = c.pledgeDisplayStatus;
  if ("portalCardTheme" in c) portalCardTheme = c.portalCardTheme;
  if ("portalLimiterIpKey" in c) portalLimiterIpKey = c.portalLimiterIpKey;
  if ("portalLimiterSkip" in c) portalLimiterSkip = c.portalLimiterSkip;
  if ("portalLinkEmailLimiter" in c) portalLinkEmailLimiter = c.portalLinkEmailLimiter;
  if ("portalLinkIpLimiter" in c) portalLinkIpLimiter = c.portalLinkIpLimiter;
  if ("portalMutationLimiter" in c) portalMutationLimiter = c.portalMutationLimiter;
  if ("portalTimeline" in c) portalTimeline = c.portalTimeline;
  if ("processAuctionUnpaid" in c) processAuctionUnpaid = c.processAuctionUnpaid;
  if ("processDunning" in c) processDunning = c.processDunning;
  if ("processGeocodeQueue" in c) processGeocodeQueue = c.processGeocodeQueue;
  if ("processGivingSources" in c) processGivingSources = c.processGivingSources;
  if ("processGrantMilestones" in c) processGrantMilestones = c.processGrantMilestones;
  if ("processMembershipRenewals" in c) processMembershipRenewals = c.processMembershipRenewals;
  if ("processNetworkGate" in c) processNetworkGate = c.processNetworkGate;
  if ("processPhotoQueue" in c) processPhotoQueue = c.processPhotoQueue;
  if ("processPledgeInstallmentReminders" in c) processPledgeInstallmentReminders = c.processPledgeInstallmentReminders;
  if ("processPledgeReminders" in c) processPledgeReminders = c.processPledgeReminders;
  if ("processRecordBands" in c) processRecordBands = c.processRecordBands;
  if ("processSequences" in c) processSequences = c.processSequences;
  if ("processTrackedSequences" in c) processTrackedSequences = c.processTrackedSequences;
  if ("processTrialReminders" in c) processTrialReminders = c.processTrialReminders;
  if ("processUnansweredMail" in c) processUnansweredMail = c.processUnansweredMail;
  if ("processWorkflowSweeps" in c) processWorkflowSweeps = c.processWorkflowSweeps;
  if ("provisionNewOrgWorkflows" in c) provisionNewOrgWorkflows = c.provisionNewOrgWorkflows;
  if ("pruneThemeAssets" in c) pruneThemeAssets = c.pruneThemeAssets;
  if ("pruneUnreferencedAssets" in c) pruneUnreferencedAssets = c.pruneUnreferencedAssets;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("purgeExpiredAssets" in c) purgeExpiredAssets = c.purgeExpiredAssets;
  if ("pushStewardDates" in c) pushStewardDates = c.pushStewardDates;
  if ("putThemeAsset" in c) putThemeAsset = c.putThemeAsset;
  if ("query" in c) query = c.query;
  if ("queryTx" in c) queryTx = c.queryTx;
  if ("queueThankYouDraft" in c) queueThankYouDraft = c.queueThankYouDraft;
  if ("raiseGrantMilestone" in c) raiseGrantMilestone = c.raiseGrantMilestone;
  if ("rateLimit" in c) rateLimit = c.rateLimit;
  if ("rateLimitDisabled" in c) rateLimitDisabled = c.rateLimitDisabled;
  if ("rateLimitHandler" in c) rateLimitHandler = c.rateLimitHandler;
  if ("ratesMod" in c) ratesMod = c.ratesMod;
  if ("rbCents" in c) rbCents = c.rbCents;
  if ("rbCentsEv" in c) rbCentsEv = c.rbCentsEv;
  if ("rbCustomDefs" in c) rbCustomDefs = c.rbCustomDefs;
  if ("rbFormatCell" in c) rbFormatCell = c.rbFormatCell;
  if ("recalcDonorSummary" in c) recalcDonorSummary = c.recalcDonorSummary;
  if ("recalcPledgePayment" in c) recalcPledgePayment = c.recalcPledgePayment;
  if ("recomputeAllScores" in c) recomputeAllScores = c.recomputeAllScores;
  if ("recomputeScoresForOrg" in c) recomputeScoresForOrg = c.recomputeScoresForOrg;
  if ("reconcileStripeVsGifts" in c) reconcileStripeVsGifts = c.reconcileStripeVsGifts;
  if ("recordAiFallback" in c) recordAiFallback = c.recordAiFallback;
  if ("recordAssetPointerHistory" in c) recordAssetPointerHistory = c.recordAssetPointerHistory;
  if ("recordAutoMove" in c) recordAutoMove = c.recordAutoMove;
  if ("recordGift" in c) recordGift = c.recordGift;
  if ("recordMove" in c) recordMove = c.recordMove;
  if ("recordTick" in c) recordTick = c.recordTick;
  if ("refreshCardsOnFile" in c) refreshCardsOnFile = c.refreshCardsOnFile;
  if ("refreshMailboxSyncHealth" in c) refreshMailboxSyncHealth = c.refreshMailboxSyncHealth;
  if ("refreshReconcileDenominator" in c) refreshReconcileDenominator = c.refreshReconcileDenominator;
  if ("registerForEvent" in c) registerForEvent = c.registerForEvent;
  if ("registerJourneyEngine" in c) registerJourneyEngine = c.registerJourneyEngine;
  if ("registerJourneyNudge" in c) registerJourneyNudge = c.registerJourneyNudge;
  if ("registerLimiter" in c) registerLimiter = c.registerLimiter;
  if ("renderReceiptPdf" in c) renderReceiptPdf = c.renderReceiptPdf;
  if ("renewMembership" in c) renewMembership = c.renewMembership;
  if ("reportCurrentYear" in c) reportCurrentYear = c.reportCurrentYear;
  if ("reportYearBounds" in c) reportYearBounds = c.reportYearBounds;
  if ("requireAdmin" in c) requireAdmin = c.requireAdmin;
  if ("requireAuth" in c) requireAuth = c.requireAuth;
  if ("requireCrm" in c) requireCrm = c.requireCrm;
  if ("requireSuperAdmin" in c) requireSuperAdmin = c.requireSuperAdmin;
  if ("resend" in c) resend = c.resend;
  if ("resolveCampaignRecipients" in c) resolveCampaignRecipients = c.resolveCampaignRecipients;
  if ("resolveOrgBrandTheme" in c) resolveOrgBrandTheme = c.resolveOrgBrandTheme;
  if ("resolvePdfLogo" in c) resolvePdfLogo = c.resolvePdfLogo;
  if ("resolvePublicAppUrl" in c) resolvePublicAppUrl = c.resolvePublicAppUrl;
  if ("resolveSegmentSpec" in c) resolveSegmentSpec = c.resolveSegmentSpec;
  if ("resolveWidgetsPublic" in c) resolveWidgetsPublic = c.resolveWidgetsPublic;
  if ("restrictedMod" in c) restrictedMod = c.restrictedMod;
  if ("retryFailedNotifications" in c) retryFailedNotifications = c.retryFailedNotifications;
  if ("round2" in c) round2 = c.round2;
  if ("run" in c) run = c.run;
  if ("runBuilderDef" in c) runBuilderDef = c.runBuilderDef;
  if ("runCampaignSend" in c) runCampaignSend = c.runCampaignSend;
  if ("runDailyTaskRemindersForOrg" in c) runDailyTaskRemindersForOrg = c.runDailyTaskRemindersForOrg;
  if ("runDigestsForOrg" in c) runDigestsForOrg = c.runDigestsForOrg;
  if ("runSavedReportScheduleForOrg" in c) runSavedReportScheduleForOrg = c.runSavedReportScheduleForOrg;
  if ("runStepRemindersForOrg" in c) runStepRemindersForOrg = c.runStepRemindersForOrg;
  if ("runThreadNudgesForOrg" in c) runThreadNudgesForOrg = c.runThreadNudgesForOrg;
  if ("runTx" in c) runTx = c.runTx;
  if ("runWeeklyEmailForOrg" in c) runWeeklyEmailForOrg = c.runWeeklyEmailForOrg;
  if ("sampleDataMod" in c) sampleDataMod = c.sampleDataMod;
  if ("scheduleBillingModeCheck" in c) scheduleBillingModeCheck = c.scheduleBillingModeCheck;
  if ("scheduleScores" in c) scheduleScores = c.scheduleScores;
  if ("seedOrgData" in c) seedOrgData = c.seedOrgData;
  if ("sendBoardPackEmail" in c) sendBoardPackEmail = c.sendBoardPackEmail;
  if ("sendDonorLifecycleEmail" in c) sendDonorLifecycleEmail = c.sendDonorLifecycleEmail;
  if ("sendDunningEmail" in c) sendDunningEmail = c.sendDunningEmail;
  if ("sendPledgeReminderEmail" in c) sendPledgeReminderEmail = c.sendPledgeReminderEmail;
  if ("sendReceiptEmail" in c) sendReceiptEmail = c.sendReceiptEmail;
  if ("sendStaffWrittenEmail" in c) sendStaffWrittenEmail = c.sendStaffWrittenEmail;
  if ("sequenceMergeValues" in c) sequenceMergeValues = c.sequenceMergeValues;
  if ("sequenceTimezoneGate" in c) sequenceTimezoneGate = c.sequenceTimezoneGate;
  if ("sessionCache" in c) sessionCache = c.sessionCache;
  if ("signReconnectToken" in c) signReconnectToken = c.signReconnectToken;
  if ("signToken" in c) signToken = c.signToken;
  if ("slugifyGivingPage" in c) slugifyGivingPage = c.slugifyGivingPage;
  if ("smartAmountsMod" in c) smartAmountsMod = c.smartAmountsMod;
  if ("snapshotMetricsForOrg" in c) snapshotMetricsForOrg = c.snapshotMetricsForOrg;
  if ("sourceAdapters" in c) sourceAdapters = c.sourceAdapters;
  if ("sourceConfig" in c) sourceConfig = c.sourceConfig;
  if ("sourceErrorSentence" in c) sourceErrorSentence = c.sourceErrorSentence;
  if ("storeAuctionPhoto" in c) storeAuctionPhoto = c.storeAuctionPhoto;
  if ("stripe" in c) stripe = c.stripe;
  if ("stripeChargesEnabled" in c) stripeChargesEnabled = c.stripeChargesEnabled;
  if ("sustainerFileFacts" in c) sustainerFileFacts = c.sustainerFileFacts;
  if ("sweepMissedRecurring" in c) sweepMissedRecurring = c.sweepMissedRecurring;
  if ("sweepQuietConnections" in c) sweepQuietConnections = c.sweepQuietConnections;
  if ("syncCalendar" in c) syncCalendar = c.syncCalendar;
  if ("syncGmail" in c) syncGmail = c.syncGmail;
  if ("syncMailbox" in c) syncMailbox = c.syncMailbox;
  if ("syncSource" in c) syncSource = c.syncSource;
  if ("testMode" in c) testMode = c.testMode;
  if ("threadNudgeDayOk" in c) threadNudgeDayOk = c.threadNudgeDayOk;
  if ("threadRankMod" in c) threadRankMod = c.threadRankMod;
  if ("threadShapeMod" in c) threadShapeMod = c.threadShapeMod;
  if ("thresholdsMod" in c) thresholdsMod = c.thresholdsMod;
  if ("toCents" in c) toCents = c.toCents;
  if ("toDollars" in c) toDollars = c.toDollars;
  if ("unsubscribeEmailFooterHtml" in c) unsubscribeEmailFooterHtml = c.unsubscribeEmailFooterHtml;
  if ("unsubscribeHeaders" in c) unsubscribeHeaders = c.unsubscribeHeaders;
  if ("uploadImageError" in c) uploadImageError = c.uploadImageError;
  if ("uuid" in c) uuid = c.uuid;
  if ("validateCloseLink" in c) validateCloseLink = c.validateCloseLink;
  if ("validateCustomFields" in c) validateCustomFields = c.validateCustomFields;
  if ("validateOrgClose" in c) validateOrgClose = c.validateOrgClose;
  if ("validateStoryBlocks" in c) validateStoryBlocks = c.validateStoryBlocks;
  if ("verifyReconnectToken" in c) verifyReconnectToken = c.verifyReconnectToken;
  if ("videoLimiter" in c) videoLimiter = c.videoLimiter;
  if ("volunteerRecordSentence" in c) volunteerRecordSentence = c.volunteerRecordSentence;
  if ("volunteerSummary" in c) volunteerSummary = c.volunteerSummary;
  if ("weekBounds" in c) weekBounds = c.weekBounds;
  if ("whyAskLimiter" in c) whyAskLimiter = c.whyAskLimiter;
  if ("withAdvisoryLock" in c) withAdvisoryLock = c.withAdvisoryLock;
  if ("withSmartAmounts" in c) withSmartAmounts = c.withSmartAmounts;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
  if ("wrap" in c) wrap = c.wrap;
  if ("writeAuditLog" in c) writeAuditLog = c.writeAuditLog;
  if ("writeGiftExtras" in c) writeGiftExtras = c.writeGiftExtras;
  if ("_supporterSession" in c) _supporterSession = c._supporterSession;
});

// SPLIT-2 server.js piece 712

// ── BUILD-54 §2 — donor-facing campaign content helpers ────────────────────
// The campaign STORY is sanitized structured text — a validated block array,
// never HTML/CSS/JS and never paste-in embed code. Unknown block types,
// oversized content, or non-string leaves reject the whole payload (400), so
// nothing unvalidated can ever reach a donor's browser. React renders the
// strings as text nodes (escaped by construction).
const STORY_BLOCK_TYPES = ["p", "h2", "ul"];
// SPLIT-2 end
__share({ STORY_BLOCK_TYPES });
// SPLIT-2 server.js piece 714

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
// SPLIT-2 server.js piece 716

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
// SPLIT-2 server.js piece 717
const NETWORK_SIGNUP_ENABLED = process.env.NETWORK_SIGNUP_ENABLED === "1";
// SPLIT-2 end
__share({ NETWORK_SIGNUP_ENABLED });
// SPLIT-2 server.js piece 718
// A disabled surface is INVISIBLE, not "403 coming soon" — same body as the
// global 404 so the routes' existence leaks nothing pre-launch.
const requireFlag = (on) => (req, res, next) => on ? next() : res.status(404).json({ error: "Not found" });
// SPLIT-2 end
__share({ requireFlag });
// SPLIT-2 server.js piece 719
const foldEmail = (e) => String(e || "").trim().toLowerCase();
// SPLIT-2 end
__share({ foldEmail });
// SPLIT-2 server.js piece 721

// ── §1.1 rate limits (same x-test seam discipline as the portal limiters) ──
const accountIpLimiter = rateLimit("accountIpLimiter", {
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-ip:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ accountIpLimiter });
// SPLIT-2 server.js piece 722
const accountEmailLimiter = rateLimit("accountEmailLimiter", {
  windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-em:" + foldEmail(req.body?.email).slice(0, 200),
});
// SPLIT-2 end
__share({ accountEmailLimiter });
// SPLIT-2 server.js piece 723

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
// SPLIT-2 server.js piece 724
const addOrgLimiter = rateLimit("addOrgLimiter", {
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "diradd:" + ((rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : (req.donorAccount?.id || portalLimiterIpKey(req))),
});
// SPLIT-2 end
__share({ addOrgLimiter });
// SPLIT-2 server.js piece 726
const networkSignupLimiter = rateLimit("networkSignupLimiter", {
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "netsignup:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ networkSignupLimiter });
// SPLIT-2 server.js piece 729

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
// SPLIT-2 server.js piece 730
const INBOUND_EMAIL_DOMAIN = (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase();
// SPLIT-2 end
__share({ INBOUND_EMAIL_DOMAIN });
// SPLIT-2 server.js piece 732

require("../shared/testPlants").plant(app, { testMode, requireAuth, wrap, query, run, newId });   // TEST_MODE only
// SPLIT-2 end
// SPLIT-2 server.js piece 733
// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
// SPLIT-2 end
// SPLIT-2 server.js piece 734

// ── Global error handler ───────────────────────────────────────────────────
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
// SPLIT-2 end
// SPLIT-2 server.js piece 735
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
// SPLIT-2 server.js piece 736

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
// SPLIT-2 end
__share({ PORT });
// SPLIT-2 server.js piece 737
// DEPLOY-1: the shared modules routes bind on import are a boot need too.
bootGate.need("modules", Promise.all([PT_READY, GC_READY, GREET_READY, ACK_READY, FISCAL_READY, VH_READY, VOL_DAYS_READY,
  CAL_READY, RB_READY, SEQ_READY, EV_READY, MB_READY]));
// SPLIT-2 end
// SPLIT-2 server.js piece 738
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
// SPLIT-2 server.js piece 739
// DEPLOY-1: SIGTERM drains (server/shared/lifecycle.js).
require("../shared/lifecycle").install(httpServer, { jobs: require("../../jobQueue") });
// SPLIT-2 end
// SPLIT-2 server.js piece 740

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
// SPLIT-2 server.js piece 741
// BUILD-77 Part 1f — THE ASK GATE, one predicate for every surface with an
// action button. deceased blocks everything; do_not_contact blocks all
// outreach; do_not_solicit blocks ASKS (drift, re-engage, at-risk,
// suggested outreach, ask-automations) while stewardship thank-yous and
// transactional mail may continue. One excluded donor reaching one
// actionable surface is a bug (tests/import-messy.test.js §4).
const solicitableSql = (a = "d") => `${a}.deceased IS NOT TRUE AND ${a}.do_not_contact IS NOT TRUE AND ${a}.do_not_solicit IS NOT TRUE`;
// SPLIT-2 end
__share({ solicitableSql });
// SPLIT-2 server.js piece 745

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
// SPLIT-2 server.js piece 746
for (const k of Object.keys(RETENTION_FLOOR)) {
  const env = process.env["RETENTION_" + k];
  if (env !== undefined && env !== "" && Number.isFinite(Number(env))) RETENTION_FLOOR[k] = Number(env);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 749

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
// SPLIT-2 server.js piece 750
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
// SPLIT-2 server.js piece 751
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
// SPLIT-2 server.js piece 752
require("../../routes/volunteer").mount({
  SYS_AUTO, VH_READY, actor, checkWriteAccess, crypto, donateLimiter, donorFacingOrgName,
  escapeHtml, express, insertShift, orgToday, orgTz, query, requireAuth, run, uuid,
  volunteerSummary, wrap, markVolunteer, publicAppUrl, writeAuditLog, maybeStartJourneyFromServer,
  makeVolunteer, volunteerRecordSentence, checkVolunteerFields,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 753
// MEMBERS-2 — "Your page" owns the supporter session, and VOL-1's
// /volunteer/me exchanges an old volunteer link for one. It hands the minter
// out here rather than registering a second /volunteer/me of its own: two
// handlers on one path is a route the inventory counts once and the matrix
// probes once, and the one it does not probe is the one that leaks.
let _supporterSession = null;
// SPLIT-2 end
__share({ _supporterSession });
// SPLIT-2 server.js piece 754
require("../../routes/supporter").mount({
  registerSupporterSession: fns => { _supporterSession = fns; __share({ _supporterSession }); },
  volunteerSignUp: (...a) => _volunteerSignUp(...a),
  DONOR_MAIL_ADDR, actor, brandEmailHeaderHtml, checkWriteAccess, crypto, demoMailNote, donateLimiter,
  donorFacingOrgName, fromWithDisplayName, orgSendingIdentity, orgToday, orgTz, publicAppUrl,
  query, requireAuth, resend, resolveOrgBrandTheme, run, sendDonorLifecycleEmail, stripe, testMode,
  uuid, volunteerSummary, withAdvisoryLock, wrap, writeAuditLog,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 755
require("../../routes/templates").mount({
  actor, checkWriteAccess, money, orgTime, query, requireAdmin, requireAuth, run, uuid, volunteerSummary, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 756
require("../../routes/why").mount({
  whyAskLimiter, AGENT_MODEL, aiGate, anthropicFor, computeDriftForDonors, computeRetentionRate, orgTime, orgToday, orgTz, query, requireAuth, run, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 757
require("../../routes/prospect").mount({ checkWriteAccess, query, requireAdmin, requireAuth, run, uuid, wrap });
// SPLIT-2 end
// SPLIT-2 server.js piece 758
// GRANTS-1: one shared context for the four grant modules.
const GRANTS1_CTX = { actor, checkWriteAccess, query, run, requireAdmin, requireAuth, requireCrm, uuid, wrap, orgTz, orgToday, orgTime,
  grantMoneyRows, grantBalanceFrom, agentGate, withTransaction, testMode, putThemeAsset, recordAssetPointerHistory };
// SPLIT-2 end
__share({ GRANTS1_CTX });
// SPLIT-2 server.js piece 759
require("../../routes/grantSystem").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 760
require("../../routes/grantLibrary").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 761
require("../../routes/grantMail").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 762
require("../../routes/grantReports").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 763
require("../../routes/sheets").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 764
require("../../routes/emailsSent").mount({
  query, requireAuth, wrap, emailCompose, legacyCampaignBody, sequenceMergeValues, seqReady: SEQ_READY,
  orgSendingIdentity, orgToday, orgTz,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 765
require("../../routes/oldReports").mount(GRANTS1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 766
// CAPTURE-1: the cards in To confirm, and the one tap that records a gift.
require("../../capture").configure({ query, run, aiGate, anthropicFor, recordAiFallback, putThemeAsset,
  afterChange: (...a) => AFTER.afterChange(...a) });
// SPLIT-2 end
// SPLIT-2 server.js piece 767
require("../../routes/capture").mount({ ...GRANTS1_CTX, recordGift, openGiftThread, openThreadTx, aiGate, checkGiftExtras,
  giftHooks: require("../../routes/crm").giftHooks });
// SPLIT-2 end
// SPLIT-2 server.js piece 768
require("../../routes/setup").mount({ ...GRANTS1_CTX, requireSuperAdmin, aiGate, anthropicFor, recordAiFallback });
// SPLIT-2 end
// SPLIT-2 server.js piece 769
// EMAIL-1: the media library and email templates share the grant modules'
// context plus the mail seams they render and test-send through.
const EMAIL1_CTX = { ...GRANTS1_CTX, resolveOrgBrandTheme, portalCardTheme, normalizeUploadImage,
  unsubscribeEmailFooterHtml, orgSendingIdentity, resend, orgMaySendEmail, demoMailNote, videoLimiter, donorFacingOrgName };
// SPLIT-2 end
__share({ EMAIL1_CTX });
// SPLIT-2 server.js piece 770
require("../../routes/media").mount(EMAIL1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 771
require("../../routes/emailTemplates").mount(EMAIL1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 772
require("../../routes/stockPhotos").mount(EMAIL1_CTX);
// SPLIT-2 end
// SPLIT-2 server.js piece 773
require("../../routes/donorLookups").mount({ query, requireAuth, wrap });
// SPLIT-2 end
// SPLIT-2 server.js piece 774
require("../../routes/donorList").mount({ query, run, uuid, requireAuth, requireCrm, checkWriteAccess, wrap, actor });
require("../../routes/wealthScore").mount({ query, run, requireAuth, requireAdmin, checkWriteAccess, wrap, actor, rateLimitHandler, rateLimitDisabled });   // WEALTH-1
// SPLIT-2 end
// SPLIT-2 server.js piece 775
require("../../routes/mailTypes").mount({ query, run, uuid, requireAuth, requireAdmin, requireSuperAdmin, checkWriteAccess, wrap, actor, resend, orgToday, orgTz,
  brandEmailHeaderHtml, donorFacingOrgName });
// SPLIT-2 end
// SPLIT-2 server.js piece 776
require("../../routes/search").mount({ query, requireAuth, wrap, VOLUNTEER_COORDINATOR: require("../../auth").VOLUNTEER_COORDINATOR });
// SPLIT-2 end
// SPLIT-2 server.js piece 777
require("../../routes/historyImport").mount({ query, run, runTx, withTransaction, requireAuth, checkWriteAccess, wrap, uuid,
  recomputeScoresForOrg, orgToday, orgTz });
// SPLIT-2 end
// SPLIT-2 server.js piece 778
require("../../routes/sheetImport").mount({ query, run, requireAuth, checkWriteAccess, wrap, uuid, actor, recordGift, recalcPledgePayment,
  withAdvisoryLock, aiGate, anthropicFor, recordAiFallback, orgToday, orgTz, recalcDonorSummary, getOrgAccessState, recordGifts: list => require("../../recordGifts").recordGifts(list, { query, run, ensureOrgLedger, onPledgeSettled, applyGiftAsMembershipRenewal, orgToday, orgTz, GIFT_METHOD_UNKNOWN }) });   // IMPORT-7: recordGift's batch form
// SPLIT-2 end
// SPLIT-2 server.js piece 779
require("../../routes/groups").mount({
  actor, checkWriteAccess, maybeStartJourneyFromServer, orgTime, orgTz, query, requireAuth, run, uuid, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 780
require("../../routes/dataHealth").mount({
  backgroundTicksDisabled, checkWriteAccess, orgToday, orgTz, query, queryTx, recalcDonorSummary, recordTick,
  requireAuth, run, runTx, uuid, withAdvisoryLock, withTransaction, wrap,
  openAdminTask,   // WIRE-1: new duplicates from an import become one admin task
  markDonorsForGeocoding: (...a) => require("../../routes/crm").giftHooks.markDonorsForGeocoding(...a),
});
// SPLIT-2 end
// SPLIT-2 server.js piece 781
require("../../routes/profileStatus").mount({
  actor, checkWriteAccess, computeDriftForDonors, orgTime, query, requireAdmin, requireAuth, run, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 782
require("../../routes/homeBundle").mount({ requireAuth, testMode, wrap });
// SPLIT-2 end
// SPLIT-2 server.js piece 783
require("../../routes/homeLead").mount({ ...GRANTS1_CTX, meetingBrief: require("../../routes/finance").meetingBrief });
// SPLIT-2 end
// SPLIT-2 server.js piece 784
require("../../routes/insights").mount({ ...GRANTS1_CTX, queryTx, runTx, recalcDonorSummary });
// SPLIT-2 end
// SPLIT-2 server.js piece 785
require("../../routes/homeCalls").mount({
  actor, checkWriteAccess, orgTime, query, requireAdmin, requireAuth, run, uuid, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 786
require("../../routes/catchUp").mount({ query, requireAuth, wrap });   // LAG-1
require("../../routes/readouts").mount({
  actor, checkWriteAccess, orgToday, orgTz, query, queueThankYouDraft, requireAuth, run, testMode, uuid, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 787
require("../../routes/surveys").mount({
  actor, checkWriteAccess, donateLimiter, orgToday, orgTz, query, requireAuth, resolveOrgBrandTheme, run, uuid, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 789
// FIX-41 PICTURES · one upload door and one save door for every picture slot.
require("../../pictures").mount({ query, run, requireAuth, checkWriteAccess, wrap, putThemeAsset, normalizeUploadImage,
  checkThemeImageDimensions, uploadImageError, recordAssetPointerHistory, ASSET_ID_RE });
// SPLIT-2 end
// SPLIT-2 server.js piece 790
require("../../routes/removal").mount({
  actor, checkWriteAccess, query, queryTx, requireAuth, run, runTx, uuid, withTransaction, wrap,
  itemStates: require("../../auctionCore").itemStates,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 791
require("../../routes/auctions").mount({
  processAuctionUnpaid, requireAdmin,   // WIRE-1: the won-but-unpaid sweep's ops door
  processUnansweredMail,   // THREAD-3: the needs-a-reply sweep's ops door
  actor, brandEmailHeaderHtml, checkWriteAccess, donateLimiter, donorMailDecision, donorSendOpts, publicAppUrl,
  portalLinkEmailLimiter, portalLinkIpLimiter, query, queryTx, recordGift, requireAuth, resend, resolveOrgBrandTheme,
  run, runTx, storeAuctionPhoto, uuid, withTransaction, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 792
require("../../routes/videoThanks").mount({
  actor, checkWriteAccess, orgToday, orgTz, query, requireAuth, resolveOrgBrandTheme, run, uuid, videoLimiter, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 793
require("../../routes/volunteerScheduling").mount({
  actor, checkWriteAccess, crypto, donateLimiter, displayNameCase, donorFacingOrgName, escapeHtml,
  insertShift, markVolunteer, maybeStartJourneyFromServer, orgMaySendEmail, donorMailDecision, orgToday, orgTz,
  publicAppUrl, query, queryTx, requireAdmin, requireAuth, resend, resolveOrgBrandTheme, run, runTx, uuid,
  volunteerSummary, withTransaction, wrap, openCareThread,   // WIRE-1: a no-show opens a step
  // The reminder sweep registers itself here so the background tick can call
  // it without this file importing the router's internals.
  registerVolunteerReminders: fn => { _volunteerReminders = fn; __share({ _volunteerReminders }); },
  registerVolunteerSignUp: fn => { _volunteerSignUp = fn; __share({ _volunteerSignUp }); },
  sendDraft: (...a) => _sendDraft(...a),
  supporterSession: { mint: (...a) => _supporterSession.mint(...a), setCookie: (...a) => _supporterSession.setCookie(...a) },
});
// SPLIT-2 end
// SPLIT-2 server.js piece 794
require("../../routes/agent").mount({
  AGENT_MODEL, ALL_PIPELINE_STAGES, SEQ_READY, WORKFLOW_RECIPE_MAP, actor, agentGate, agentTrialAllowance,
  aiGate, asJson, autoEnroll, checkWriteAccess, donorOnly, enrollInSequences, ensureWorkflows,
  fireWorkflows, markVolunteer, orgOwns, orgTime, orgToday, orgTz, processSequences, processTrackedSequences,
  processWorkflowSweeps, query, recordGift, requireAdmin, requireAuth, requireCrm, run, runTx,
  sequenceMergeValues, sequenceTimezoneGate, thresholdsMod, uuid, withTransaction, wrap,
  // HELP-1 — Ask Steward, the question log and support tickets.
  requireSuperAdmin, resend,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 795
// VOICE-1: Tell Steward plans and undoes through the Agent's engine, so it mounts after it.
require("../../clientSafe").configure({ query, run, uuid, aiGate, anthropicFor, recordAiFallback });
// SPLIT-2 end
// SPLIT-2 server.js piece 796
require("../../routes/clientSafe").mount({ query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin, checkWriteAccess, actor, uuid, aiGate });
// SPLIT-2 end
// SPLIT-2 server.js piece 797
require("../../routes/supportAccess").mount({ query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin, uuid });   // FIX-57
// SPLIT-2 end
// SPLIT-2 server.js piece 798
require("../admin/opsRoutes").mount({ query, run, wrap, healthBody, buildSha: BUILD_SHA });   // DEVBOARD-1
// SPLIT-2 end
require("../perf/pageTiming").mount({ requireAuth });   // PERF-4
// SPLIT-2 server.js piece 799
require("../../routes/support").mount({ query, run, wrap, requireAuth, requireSuperAdmin, aiGate, anthropicFor, recordAiFallback, resend, uuid, actor, AGENT_MODEL });
// SPLIT-2 end
// SPLIT-2 server.js piece 800
require("../../routes/voice").mount({ query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, orgToday, agentGate, recordGift, AGENT_MODEL });
// SPLIT-2 end
// SPLIT-2 server.js piece 801
require("../../routes/atlas").mount({ query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, orgTz, orgToday, agentGate, AGENT_MODEL });   // AGENT-5
// SPLIT-2 end
// SPLIT-2 server.js piece 802
require("../../routes/give").mount({
  ASSET_ID_RE, CARD_CHECK_BUDGET, DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, GIVE_MONTHLY_DEFAULT,
  GIVE_ONETIME_DEFAULT, GIVE_THEME_COLS, NETWORK_SIGNUP_ENABLED, PORTAL_CARD_STYLES,
  PORTAL_TYPE_PAIRINGS, RECOVERY_SECRET, accountEmailLimiter, accountIpLimiter, actor,
  addOrgLimiter, bcrypt, brandEmailHeaderHtml, buildCardUpdateUrl, bumpFormEvent,
  checkThemeImageDimensions, checkWriteAccess, classifySourceError, computeRecoveryRate,
  consumerEmailHtml, crypto, directorySearchLimiter, displayNameCase, donateLimiter, donorAudit,
  donorFacingOrgName, donorFromAddress, donorMailDecision, donorSendOpts, einLookup,
  ensureOrgLedger, escHtmlWf, escapeHtml, express, foldEmail, footingMod, formConfigMod,
  fromWithDisplayName, employerMatchMod, ratesMod, smartAmountsMod, coverFeePayload, campaignPageMod,
  signReconnectToken, verifyReconnectToken, withSmartAmounts,
  fundraiserManageLimiter, getThemeAsset, giveThemePayload, invitationLimiter, linkAccountEmail,
  logRecoveryEvent, logRecurringChange, networkSignupLimiter, normalizeAccent, normalizeTint,
  normalizeUploadImage, notifyExpiringCards, notifyUserOnce, orgOwns, orgSendingIdentity, orgTime,
  orgToday, orgTz, parseCrop, portalCardTheme, portalLinkEmailLimiter, portalLinkIpLimiter,
  portalMutationLimiter, portalTimeline, processDunning, processGivingSources, pruneThemeAssets,
  pruneUnreferencedAssets, publicAppUrl, purgeExpiredAssets, putThemeAsset, query,
  recordAssetPointerHistory, recordGift, refreshCardsOnFile, requireAdmin, requireAuth, requireFlag,
  resend, resolveWidgetsPublic, run, sendDonorLifecycleEmail, sendDunningEmail, signToken,
  slugifyGivingPage, sourceAdapters, sourceConfig, sourceErrorSentence, stripe,
  ingestPosSale,
  stripeChargesEnabled, sustainerFileFacts, sweepMissedRecurring, sweepQuietConnections, syncSource, testMode, toCents,
  toDollars, uploadImageError, uuid, validateStoryBlocks, widgetMod, withAdvisoryLock, wrap,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 803
require("../../routes/crm").mount({
  sendStaffWrittenEmail, orgSendClock,   // AUTO-1: the one sender, and the org's clock for the send window
  openAdminTask,   // WIRE-1: a peer-to-peer page waiting for approval is a task for an admin
  registerDraftSender: fn => { _sendDraft = fn; __share({ _sendDraft }); },
  // INT-5 — queueing a webhook. It never posts inline: a gift must not fail
  // because somebody's endpoint is down.
  emitWebhook, queueThankYouDraft,   // LEDGER-1: an edited gift's unsent thank-you is redrafted
  ACK_READY, ACTIVITY_DEFINITIONS, FISCAL_READY, AGENT_MODEL, ALL_PIPELINE_STAGES, API_KEY_PREFIX, ASSET_ID_RE,
  CAL_READY, EV_READY, GC_READY, GEOCODE_TICK_BUDGET, GIVE_THEME_COLS,
  IMPORT_DONOR_BATCH, IMPORT_GIFT_BATCH, INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_ENABLED, LAPSE_DAYS,
  MB_READY, MEANINGFUL_CONTACT_TYPES, MILESTONE_THRESHOLDS, PHOTO_FETCH_BUDGET, PT_READY, RB_READY,
  SYS_AUTO, TOTP, VH_READY, _titleCaseWord, _tzCache, actor, agentGate, aiGate,
  allocateReceiptNumber, apiLimiter, applyReceiptTokens, asJson, autoLapseOrg,
  bookkeeperRefusalMessage, bookkeeperRefusals, brandEmailHeaderHtml, bulkSendAddressGate,
  sendDonorLifecycleEmail, fromWithDisplayName,
  checkRecordBand, countRecords, checkAllRecordBands, applyAgreedBandMoves, registerJourneyEngine, registerJourneyNudge, checkGiftExtras, checkPlanLimit, checkThemeImageDimensions, checkWriteAccess,
  composeActivityReport, composeOfficerMonthly, composeWeekInReview, computeAtRiskCandidates,
  computeDriftForDonors, computeFirstTouchDelay, computeRetentionRate, computeStewardshipDebt,
  computeStewardshipDebtBreakdown, computeThreadHealth, crypto, demoMailNote, displayNameCase, donateLimiter,
  donorByNameOrCreate, donorFacingOrgName, donorFromAddress, donorMailDecision, donorOnly,
  donorSendOpts, driftEngine, enrollInSequences, enrollMembership, ensureOrgLedger, escapeHtml,
  filterBySegment, resolveSegmentSpec, fireWorkflows, footingMod, formConfigMod, employerMatchMod,
  ratesMod, smartAmountsMod, coverFeePayload, campaignPageMod, geocode, getOrgAccessState,
  signReconnectToken, verifyReconnectToken, withSmartAmounts,
  getThemeAsset, giveThemePayload, givingAccountEntry, givingSourcesMod, google, grantBalanceFrom,
  grantDocs, grantMoneyRows, grantMsMod, hashApiKey, imageBytesMatchMime, inboundMod, insertShift,
  inviteeDisplayName, isBlockedAddress, issueGiftReceipt, levelTaken, loadCfDefs, lookupMatchingGift,
  makeOAuth2Client, mbCents, membershipSettings, mergeCustomValues, mfaVerifyForUser, money,
  monthBounds, normalizeAccent, normalizeUploadImage, notifyTaskAssignment, openGiftThread,
  openThreadTx, orgDaysOverdue, orgFiscalYearStart, orgLeadDays, orgOwns, orgPeriodBounds,
  orgPlanTier, orgSendingIdentity, orgTime, orgToday, orgTz, orgTzName, parseCrop,
  parseMoneyOrThrow, personPhoto, pledgeDisplayStatus, processGeocodeQueue, processGrantMilestones,
  processMembershipRenewals, processPhotoQueue, processPledgeInstallmentReminders,
  processPledgeReminders, pruneUnreferencedAssets, publicAppUrl, putThemeAsset, query, queryTx,
  raiseGrantMilestone, rateLimitDisabled, rbCents, rbCentsEv, rbCustomDefs, rbFormatCell,
  recalcDonorSummary, recalcPledgePayment, recordAssetPointerHistory, recordAutoMove, recordGift, stripe,   // MONEY-4: a Stripe gift's refund (server/donors/refunds.js)
  donorCreditTotals,   // FIX-51: the census lines' hard and soft credit
  recordMove, registerForEvent, renderReceiptPdf, renewMembership, reportCurrentYear,
  reportYearBounds, requireAdmin, requireAuth, requireCrm, resend, resolveCampaignRecipients, campaignAudience,
  resolveOrgBrandTheme, resolvePdfLogo, resolveWidgetsPublic, restrictedMod, round2, run,
  runBuilderDef, runCampaignSend, runDailyTaskRemindersForOrg, runDigestsForOrg,
  runSavedReportScheduleForOrg, runStepRemindersForOrg, runThreadNudgesForOrg, runWeeklyEmailForOrg, runTx, sampleDataMod,
  seedOrgData, sendBoardPackEmail, sendPledgeReminderEmail, sendReceiptEmail, signToken, slugifyGivingPage,
  scheduleScores, recomputeScoresForOrg, engagementMod,
  snapshotMetricsForOrg, solicitableSql, sustainerFileFacts, syncGmail, testMode, threadNudgeDayOk,
  threadRankMod, threadShapeMod, thresholdsMod, toCents, toDollars, unsubscribeEmailFooterHtml,
  uploadImageError, uuid, validateCustomFields, validateStoryBlocks, volunteerSummary, weekBounds,
  widgetMod, withAdvisoryLock, withTransaction, wrap, writeAuditLog, writeGiftExtras,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 804
// SCALE-1 · THE QUEUE STARTS once every job is defined (routes/jobs.js below,
// and the few defined beside their code). The scheduler is the background
// ticks, so a test boot (DISABLE_BACKGROUND_TICKS=1) enqueues nothing on a
// timer; the worker lanes still run, because an import's recent gifts are
// queued work, not a tick. STEWARD_PROCESS=web runs no lanes at all.
DB_READY.then(() => {
  const JQ = require("../../jobQueue");
  JQ.start({ scheduler: !backgroundTicksDisabled(), build: BUILD_SHA });
  const refresh = () => JQ.refreshHealth().catch(() => {});
  setTimeout(refresh, 5000).unref();
  setInterval(refresh, 15000).unref();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 805
require("../../routes/jobs").mount({
  // INT-5 — the webhook delivery pass, on the existing tick.
  deliverWebhooks,
  // ENGAGE-1 — the scores, recomputed on the six-hour tick.
  recomputeAllScores,
  // INT-BUILD-1 — every live mailbox, mail and calendar, on the 15-minute tick.
  syncMailbox, syncCalendar, pushStewardDates, refreshMailboxSyncHealth,
  // PUSH-1: the tick keeps each connection's instant-update channels alive.
  mailboxAccessToken,
  RECONCILE_INTERVAL_MIN, autoEnroll, autoLapseOrg, backgroundTicksDisabled, bulkSendAddressGate,
  checkWebhookSubscriptions, getOrgAccessState, monthBounds, notifyExpiringCards, orgTime,
  processDunning, processGeocodeQueue, processGivingSources, processGrantMilestones,
  processMembershipRenewals, processNetworkGate, processPhotoQueue, processAuctionUnpaid, processUnansweredMail,
  processPledgeInstallmentReminders, processPledgeReminders, processSequences,
  processTrackedSequences, processTrialReminders, processRecordBands, processWorkflowSweeps, query, rateLimitDisabled,
  reconcileStripeVsGifts, recordTick, refreshCardsOnFile, refreshReconcileDenominator,
  resolveCampaignRecipients, retryFailedNotifications, run, runCampaignSend,
  runDailyTaskRemindersForOrg, runDigestsForOrg, runSavedReportScheduleForOrg,
  runStepRemindersForOrg, runThreadNudgesForOrg, runWeeklyEmailForOrg, snapshotMetricsForOrg, syncGmail, threadNudgeDayOk,
  weekBounds,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 806
require("../../routes/email").mount({
  DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, PORTAL_DEFAULT_THEME, UNSUB_SECRET, buildCardUpdateUrl,
  crypto, displayNameCase, donorAudit, donorFacingOrgName, donorSendOpts, escHtmlWf, escapeHtml,
  foldEmail, givingAccountEntry, isBlockedAddress, orgMailGateCache, orgSendingIdentity,
  publicAppUrl, query, resend, resolveOrgBrandTheme, uuid,
});
// SPLIT-2 end
// SPLIT-2 server.js piece 807

// IMPORT-4: the in-process suites (numbers1-foot) record an undated gift
// through the one gift path, as the spreadsheet import does.
app.locals.recordGift = recordGift;
// SPLIT-2 end
// SPLIT-2 server.js piece 808
app.locals.recalcPledgePayment = recalcPledgePayment;   // GIFTS-1: scripts/ops/gifts1-grant-received.js applies its payment
// SPLIT-2 end
