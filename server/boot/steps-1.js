// SPLIT-2: moved VERBATIM from server.js (the statements from lines 1-1051, in order). server.js requires the boot modules in
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
let _logOutboundEmail, noteServerError, orgMaySendEmail, rateLimitHandler, syncCalendar, syncMailbox;
__boot.register(c => {
  if ("_logOutboundEmail" in c) _logOutboundEmail = c._logOutboundEmail;
  if ("noteServerError" in c) noteServerError = c.noteServerError;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("rateLimitHandler" in c) rateLimitHandler = c.rateLimitHandler;
  if ("syncCalendar" in c) syncCalendar = c.syncCalendar;
  if ("syncMailbox" in c) syncMailbox = c.syncMailbox;
  if ("_journeyNudge" in c) _journeyNudge = c._journeyNudge;
  if ("PT" in c) PT = c.PT;
  if ("dbReady" in c) dbReady = c.dbReady;
  if ("DB_NAME" in c) DB_NAME = c.DB_NAME;
  if ("ledgerChartSelfHeals" in c) ledgerChartSelfHeals = c.ledgerChartSelfHeals;
  if ("reconciliation" in c) reconciliation = c.reconciliation;
  if ("reconcileAccountsWithStripe" in c) reconcileAccountsWithStripe = c.reconcileAccountsWithStripe;
});

// SPLIT-2 server.js piece 1
require("dotenv").config();
// SPLIT-2 end
// SPLIT-2 server.js piece 2
// SECURE-2 item 1: every log line and every Sentry event goes through one
// redactor (redact.js) — no donor or staff details, tokens, cookies or bodies.
require("../../redact").install();
// SPLIT-2 end
// SPLIT-2 server.js piece 3
const Sentry = require("@sentry/node");
// SPLIT-2 end
__share({ Sentry });
// SPLIT-2 server.js piece 4
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// SPLIT-2 end
__share({ newId });
// SPLIT-2 server.js piece 5
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
    ...require("../../redact").sentryOptions(),
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 6

// Sentry.setupExpressErrorHandler(app) (registered near the bottom of this file)
// only sees errors that flow through Express's request/response cycle — anything
// synchronous outside a route handler, or a rejected promise nobody attached a
// .catch() to (a background setInterval job, the Gmail sync loop, the sequence
// processor, etc.) never reaches it and was previously silent: caught nowhere,
// reported nowhere. These two process-level handlers are that backstop.
//
// Different exit behavior is deliberate, not an oversight:
// - uncaughtException means the process is in a state Node's own docs say you
//   should not trust to keep serving requests from — report, then exit and let
//   Railway restart the process clean.
// - unhandledRejection here is overwhelmingly a rejected promise in a
//   fire-and-forget background job (most of which already have their own
//   .catch(console.error)) — killing the whole API over one of those would be
//   a worse outcome than the bug itself, so this reports and keeps running.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] — process will exit:", err);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
    Sentry.close(2000).finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
// SPLIT-2 end
// SPLIT-2 server.js piece 7

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]:", reason);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
});
// SPLIT-2 end
// SPLIT-2 server.js piece 8

const express = require("express");
// SPLIT-2 end
__share({ express });
// SPLIT-2 server.js piece 9
const cors = require("cors");
// SPLIT-2 end
__share({ cors });
// SPLIT-2 server.js piece 10
const compression = require("compression");
// SPLIT-2 end
__share({ compression });
// SPLIT-2 server.js piece 11
// SCALE-1: every limiter counts in Postgres, shared by every web replica (rateLimitStore.js).
const { rateLimit, ipKeyGenerator } = require("../../rateLimitStore");
// SPLIT-2 end
__share({ rateLimit, ipKeyGenerator });
// SPLIT-2 server.js piece 12
const bcrypt = require("bcryptjs");
// SPLIT-2 end
__share({ bcrypt });
// SPLIT-2 server.js piece 13
const crypto = require("crypto");
// SPLIT-2 end
__share({ crypto });
// SPLIT-2 server.js piece 14
// FIX-12 Part 3: every model call goes through aiClient.js, which asks the org's AI switch first.
const { aiGate, anthropicFor, AiOffError, recordAiFallback } = require("../../aiClient");
// SPLIT-2 end
__share({ aiGate, anthropicFor, AiOffError, recordAiFallback });
// SPLIT-2 server.js piece 15
const { Resend } = require("resend");
// SPLIT-2 end
__share({ Resend });
// SPLIT-2 server.js piece 16
// 2026-09-24 — addresses Steward must never email, from any org (mailBlock.js).
const { blockedRecipientIn, isBlockedAddress } = require("../../mailBlock");
// SPLIT-2 end
__share({ blockedRecipientIn, isBlockedAddress });
// SPLIT-2 server.js piece 17
// ── BUILD-97 Part 5 — THE CHOKE POINT THAT DID NOT EXIST ───────────────────
// The incident write-up's last open item, verbatim: "server.js still has ~20
// separate resend.emails.send( call sites. The two gates cover every one that
// matters today, but there is no single choke point, and the next send path
// added will not automatically pass through either gate."
//
// There are 26 of them. Rewriting 26 call sites is a refactor with 26 chances
// to get one wrong, and it would still not stop the 27th. Wrapping the CLIENT
// does: `emails.send` is one method on one object, so every existing call site
// and every future one is logged BY CONSTRUCTION, including ones written by
// somebody who never read this comment.
//
// It LOGS, and since SEND-GATE-1 it is also where donor mail is GATED: the
// recipient address says which person a message is for, and sendGate.js asks
// that person's automatic-email switch (or a staff click recorded for this one
// message). `orgMaySendEmail` and `donorMailDecision` stay above the send paths
// as before. What the log buys is the OTHER half the incident needed: an outside
// observer. On 22 September the only way to find out what had been sent was to
// read the Resend console.
//
// RECIPIENT DOMAIN, NEVER THE ADDRESS. A super-admin needs to see that mail
// went to yahoo.com from a demo org; they do not need a list of donors'
// email addresses in an ops table (steward-data-handling.md).
const _rawResend = new Resend(process.env.RESEND_API_KEY);
// SPLIT-2 end
__share({ _rawResend });
// SPLIT-2 server.js piece 18
const mailPolicy = require("../../mailPolicy");   // MAIL-1: the one mail policy, by family of mail
// SPLIT-2 end
__share({ mailPolicy });
// SPLIT-2 server.js piece 19
const mailRefusal = require("../../mailRefusal"); // FIX-48: a refused send is failed once, never retried
// SPLIT-2 end
__share({ mailRefusal });
// SPLIT-2 server.js piece 20
const SEND_GATE = require("../../sendGate");      // SEND-GATE-1: the one gate for mail to a donor
// SPLIT-2 end
__share({ SEND_GATE });
// SPLIT-2 server.js piece 21
const EMAIL_LOG_RETENTION_DAYS = 30;
// SPLIT-2 end
__share({ EMAIL_LOG_RETENTION_DAYS });
// SPLIT-2 server.js piece 23

// A PROXY, NOT A REPLACEMENT. The first cut of this wrapper was an object
// literal with one method on it, which silently deleted the rest of the client
// — `resend.domains.create` became undefined, and the sending-domain claim
// route started answering "could not reach the mail provider". The full battery
// caught it (tests/build88c-domain.test.js) and it is the right lesson: a
// wrapper around somebody else's object has to pass through everything it did
// not come to change.
//
// So this forwards every property to the real client and overrides exactly one
// method. A Resend SDK upgrade that adds a new surface gets it for free, and
// still cannot add an unlogged send.
const resend = new Proxy(_rawResend, {
  get(target, prop, receiver) {
    if (prop !== "emails") return Reflect.get(target, prop, receiver);
    const emails = Reflect.get(target, prop, receiver);
    return new Proxy(emails, {
      get(eTarget, eProp, eReceiver) {
        if (eProp !== "send") {
          const v = Reflect.get(eTarget, eProp, eReceiver);
          return typeof v === "function" ? v.bind(eTarget) : v;
        }
        return async function send(opts) {
          // THE PERMANENT BLOCK (mailBlock.js). Checked HERE because every send
          // in this file passes through here, including ones written later.
          // Refused as an ERROR, not a throw: callers already treat a provider
          // error as "not delivered" and log it, which is exactly the truth.
          const blocked = blockedRecipientIn(opts);
          if (blocked) {
            const why = "blocked_address: recipient is on Steward's permanent block list";
            console.warn(`[mail-block] REFUSED a send to a blocked address (kind=${(opts && opts._stewardKind) || "?"}, org=${(opts && opts._stewardOrgId) || "none"})`);
            try { await _logOutboundEmail(opts, null, { message: why }, "blocked"); } catch (_) { /* ignore */ }
            return { data: null, error: { name: "blocked_address", message: why } };
          }
          // An org-tagged send (donorSendOpts tags it) whose org has mail OFF
          // is refused here too — the second lock behind donorMailDecision.
          // MAIL-1: the policy is per family (mailPolicy.js), taken from the
          // kind. The onboarding sequence is refused with or without an org.
          const orgId = opts && opts._stewardOrgId;
          const category = mailPolicy.categoryOf(opts && opts._stewardKind);
          if (orgId || category === mailPolicy.CATEGORY.ONBOARDING) {
            const gate = await orgMaySendEmail(orgId, category, opts && opts._stewardKind);
            if (!gate.send) {
              const why = "org_mail_off: " + gate.reason;
              console.warn(`[mail-gate] REFUSED at the client: org ${orgId} (${gate.reason}), kind=${opts._stewardKind || "?"}`);
              try { await _logOutboundEmail(opts, null, { message: why }, "blocked"); } catch (_) { /* ignore */ }
              // SEND-GATE-2: an automatic donor email held because the org's
              // email is off is a line in Going out's Held list, with why.
              if (orgId && category === mailPolicy.CATEGORY.DONOR && !opts._stewardConfirm
                  && (gate.reason === "org_emails_disabled" || gate.reason === "not_onboarded")) await SEND_GATE.recordOrgOff(opts);
              return { data: null, error: { name: "org_mail_off", message: why } };
            }
          }
          const deliver = async () => {
            // Steward's own tags never reach the provider.
            const wire = {};
            for (const k of Object.keys(opts || {})) if (!k.startsWith("_steward")) wire[k] = opts[k];
            let out, thrown = null;
            try {
              out = await eTarget.send(wire);
            } catch (e) { thrown = e; }
            // The log must never break a send, and never swallow a provider
            // failure the caller is already handling. FIX-51: awaited (it never
            // rejects), so the row is in before the caller hears the answer.
            try { await _logOutboundEmail(opts, out, thrown || (out && out.error)); } catch (_) { /* ignore */ }
            if (thrown) throw thrown;
            return out;
          };
          // SEND-GATE-1 · THE ONE GATE FOR MAIL TO A DONOR (sendGate.js). An
          // org's donor mail goes only to people whose automatic-email switch
          // is on, or by a staff click recorded for that one message.
          if (orgId && category === mailPolicy.CATEGORY.DONOR) {
            const out = await SEND_GATE.sendToDonor(opts, deliver);
            if (out && out.error && out.error.name === SEND_GATE.REFUSAL) {
              try { await _logOutboundEmail(opts, null, { message: out.error.message }, "blocked"); } catch (_) { /* ignore */ }
            }
            return out;
          }
          return deliver();
        };
      },
    });
  },
});
// SPLIT-2 end
__share({ resend });
// SPLIT-2 server.js piece 24
const { getDb, query, run, uuid, seedOrgData, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx } = require("../../db");
// SPLIT-2 end
__share({ getDb, query, run, uuid, seedOrgData, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx });
// SPLIT-2 server.js piece 25
const PW = require("../../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments
// SPLIT-2 end
__share({ PW });
// SPLIT-2 server.js piece 26
const { CAMPAIGN_GIFT_MATCH, PUBLIC_BAR_GRANTS } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
// SPLIT-2 end
__share({ CAMPAIGN_GIFT_MATCH, PUBLIC_BAR_GRANTS });
// SPLIT-2 server.js piece 27
const { DONOR_SUMMARY_UPDATE } = require("../../donorSummary");   // NUMBERS-1: the totals kept on a person
// SPLIT-2 end
__share({ DONOR_SUMMARY_UPDATE });
// SPLIT-2 server.js piece 28
// BUILD-89S - the provider adapter registry and the read-only HTTP guard.
const sourceAdapters = require("../../sources/index.js");
// SPLIT-2 end
__share({ sourceAdapters });
// SPLIT-2 server.js piece 29
const { signToken, tokenUserId, requireAuth, requireSuperAdmin: requireSuperAdminJwt } = require("../../auth");
// SPLIT-2 end
__share({ signToken, tokenUserId, requireAuth, requireSuperAdminJwt });
// SPLIT-2 server.js piece 30
const { sessionCache } = require("../../sessionCache");
// SPLIT-2 end
__share({ sessionCache });
// SPLIT-2 server.js piece 31
const { normalizeAccent, normalizeTint } = require("../../branding");
// SPLIT-2 end
__share({ normalizeAccent, normalizeTint });
// SPLIT-2 server.js piece 32
const { lookupMatchingGift } = require("../../matchingGifts");
// SPLIT-2 end
__share({ lookupMatchingGift });
// SPLIT-2 server.js piece 33
const Stripe = require("stripe");
// SPLIT-2 end
__share({ Stripe });
// SPLIT-2 server.js piece 34
const { google } = require("googleapis");
// SPLIT-2 end
__share({ google });
// SPLIT-2 server.js piece 35
const { Webhook: SvixWebhook } = require("svix");
// SPLIT-2 end
__share({ SvixWebhook });
// SPLIT-2 server.js piece 36
const { donationStripeKey, billingStripeKey, billingStripeMode, billingConfigError, otherBillingMode } = require("../../stripeKeys");
// SPLIT-2 end
__share({ donationStripeKey, billingStripeKey, billingStripeMode, billingConfigError, otherBillingMode });
// SPLIT-2 server.js piece 37
const { CANONICAL_APP_URL, resolvePublicAppUrl, publicAppUrl } = require("../../publicUrl");
// SPLIT-2 end
__share({ CANONICAL_APP_URL, resolvePublicAppUrl, publicAppUrl });
// SPLIT-2 server.js piece 38
const { DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff } = require("../../stripeEvents");
// SPLIT-2 end
__share({ DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff });
// SPLIT-2 server.js piece 39
const { putThemeAsset, getThemeAsset, pruneThemeAssets, pruneUnreferencedAssets, refreshAssetFallbackCount, refreshRetentionCounts, purgeExpiredAssets, assetHealth, ASSET_ID_RE } = require("../../assetStore");
// SPLIT-2 end
__share({ putThemeAsset, getThemeAsset, pruneThemeAssets, pruneUnreferencedAssets, refreshAssetFallbackCount, refreshRetentionCounts, purgeExpiredAssets, assetHealth, ASSET_ID_RE });
// SPLIT-2 server.js piece 40
// BUILD-94 Part 1 — the signed, expiring front door for a donor photograph
// (a person's face is not theme imagery; see personPhoto.js's header).
const personPhoto = require("../../personPhoto");
// SPLIT-2 end
__share({ personPhoto });
// SPLIT-2 server.js piece 41
const { safeFetch } = require("../../safeFetch");
// SPLIT-2 end
__share({ safeFetch });
// SPLIT-2 server.js piece 42
const { computeGuardsOk, guardFailures } = require("../../guards");
// SPLIT-2 end
__share({ computeGuardsOk, guardFailures });
// SPLIT-2 server.js piece 43
// BUILD-96 Part 2 — the ONE definition of what sample data is. The guard, the
// counts and the delete all read from it; three lists would disagree, and the
// way they would disagree is by deleting something real.
const sampleDataMod = require("../../sampleData");
// SPLIT-2 end
__share({ sampleDataMod });
// SPLIT-2 server.js piece 44
const { PRODUCT_ID } = require("../../product");
// SPLIT-2 end
__share({ PRODUCT_ID });
// SPLIT-2 server.js piece 45
// BUILD-72 Part 4 — THE date seam. Every civil-date boundary in the product
// goes through here, computed in the ORGANIZATION's timezone. See orgTime.js
// for the type discipline (instants vs civil dates) and why it exists.
const geocode = require("../../geocode"); // BUILD-84 P0-4 — the ONE seam an address becomes coordinates through; never called from a read path
// SPLIT-2 end
__share({ geocode });
// SPLIT-2 server.js piece 46
const orgTime = require("../../orgTime");
// SPLIT-2 end
__share({ orgTime });
// SPLIT-2 server.js piece 47
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
// SPLIT-2 end
__share({ NUMBERS });
// SPLIT-2 server.js piece 48
const HISTORY = require("../../historyGifts");   // FIX-36: the one rule for gifts a history read brought in
// SPLIT-2 end
__share({ HISTORY });
// SPLIT-2 server.js piece 49
const OUTBOX = require("../shared/outbox");   // JOBS-1: a change's event, written with its row, run by handlers
// SPLIT-2 end
__share({ OUTBOX });
// SPLIT-2 server.js piece 50
const TL = require("../../timelineLine");   // WIRE-1 rule 2: every act lands on the timeline
// SPLIT-2 end
__share({ TL });
// SPLIT-2 server.js piece 51
// BUILD-73 Part 2 — THE MONEY SEAM. Every money value that crosses into or out
// of storage goes through here, and nothing else in this file converts between
// dollars and cents. See money.js for why the eight Math.round() sites this
// replaces were each a chance to be wrong in the same direction.
const { toCents, toDollars, parseMoneyOrThrow, hasCents } = require("../../money");
// SPLIT-2 end
__share({ toCents, toDollars, parseMoneyOrThrow, hasCents });
// SPLIT-2 server.js piece 52
// The same seam, as a namespace — BUILD-87 Part 1's stored-import invariant
// reads several of its helpers at once and naming them one by one buys nothing.
const money = require("../../money");
// SPLIT-2 end
__share({ money });
// SPLIT-2 server.js piece 53
const DRAFT_CHECK = require("../../draftCheck");   // FIX-27 Part 7: a draft claims only what the record holds
// SPLIT-2 end
__share({ DRAFT_CHECK });
// SPLIT-2 server.js piece 54
// FIX-2 A — the one definition of every figure that opens (the rows behind it).
const figureSources = require("../../figureSources");
// SPLIT-2 end
__share({ figureSources });
// SPLIT-2 server.js piece 55
// PARITY-1 Part D: Groups (saved lists, static or by rule).
const GR = require("../../groups");
// SPLIT-2 end
__share({ GR });
// SPLIT-2 server.js piece 56
// BUILD-87 Part 4 — the one rule that gates the bookkeeper's file, stated as
// a pure function so it can be proven able to fire without a database.
const { bookkeeperRefusals, bookkeeperRefusalMessage } = require("../../bookkeeper");
// SPLIT-2 end
__share({ bookkeeperRefusals, bookkeeperRefusalMessage });
// SPLIT-2 server.js piece 57
const { loadDefs: loadCfDefs, validateCustomFields, mergeCustomValues, migrateLegacyCustomFields } = require("../../customFields");
// SPLIT-2 end
__share({ loadCfDefs, validateCustomFields, mergeCustomValues, migrateLegacyCustomFields });
// SPLIT-2 server.js piece 58
const { orgToday, orgIsOverdue, orgDaysOverdue, orgPeriodBounds, orgFiscalYearStart, orgReportYear } = orgTime;
// SPLIT-2 end
__share({ orgToday, orgIsOverdue, orgDaysOverdue, orgPeriodBounds, orgFiscalYearStart, orgReportYear });
// SPLIT-2 server.js piece 59
// BUILD-76 Part 1 — THE DRIFT ENGINE. One pure module defines "drifting"
// (past the donor's OWN expected next gift, not yet lapsed); every surface —
// the home list, the headline dollars, the funnel row, every badge — reads
// computeDriftForDonors() below, which is the only caller. drift.js never
// reads a clock; `today` goes in through the org-timezone seam.
const driftEngine = require("../../drift");
// SPLIT-2 end
__share({ driftEngine });
// SPLIT-2 server.js piece 60

// Resolve an org's timezone for the seam. Cached briefly: every date-bounded
// read needs it, and it changes about once in an organization's lifetime.
const _tzCache = new Map();
// SPLIT-2 end
__share({ _tzCache });
// SPLIT-2 server.js piece 61
// BUILD-84 — the suites reuse fixed org ids and delete/recreate them rapidly,
// so a 30-second cache serves the DELETED org's confirmation state to the next
// run. `SESSION_CACHE_TTL_MS=0` is already the flag that says "this process is
// a test boot, do not cache identity"; the org's timezone confirmation is the
// same kind of fact, so it rides the same switch. Prod leaves it unset → 30s.
const TZ_CACHE_MS = process.env.SESSION_CACHE_TTL_MS === "0" ? 0 : 30000;
// SPLIT-2 end
__share({ TZ_CACHE_MS });
// SPLIT-2 server.js piece 65
// MOVED UP HERE FROM THE AGENT SECTION (BUILD-99 Part 4). The prospect brief is
// declared ~5,000 lines before the agent block and reads this, and `scripts/
// tdz-scan.js --all` rightly flagged it as a read-above-declaration. It happens
// to be legal (a route handler body runs long after module evaluation), and the
// standing TDZ rule says to move it anyway: relying on call order is how the next
// one of these gets written. ONE model name for everything the agent does.
const AGENT_MODEL = "claude-opus-5";
// SPLIT-2 end
__share({ AGENT_MODEL });
// SPLIT-2 server.js piece 66
const SYS_AUTO = { id: "system:auto", name: "Steward (automatic)" };
// SPLIT-2 end
__share({ SYS_AUTO });
// SPLIT-2 server.js piece 67
const sysWorkflow = recipe => ({ id: `system:workflow:${recipe}`, name: `Steward (workflow: ${recipe})` });
// SPLIT-2 end
__share({ sysWorkflow });
// SPLIT-2 server.js piece 68
const { imageSize } = require("image-size");
// SPLIT-2 end
__share({ imageSize });
// SPLIT-2 server.js piece 69
const { computeTrialEnd, computeReminderAt, isReminderDue, TRIAL_DAYS, REMINDER_LEAD_DAYS } = require("../../trialEnd");
// SPLIT-2 end
__share({ computeTrialEnd, computeReminderAt, isReminderDue, TRIAL_DAYS, REMINDER_LEAD_DAYS });
// SPLIT-2 server.js piece 70
const PRICING = require("../../pricing");  // GTM-1b: the band a count falls in
// SPLIT-2 end
__share({ PRICING });
// SPLIT-2 server.js piece 71
const { CLOSE_PLANS, closePlan, validateCloseLink, validateOrgClose, checkoutSessionParams,
        firstChargeSentence, formatChargeDate, usd: usdWhole, planAmountUsd } = require("../../closeLink");
// SPLIT-2 end
__share({ CLOSE_PLANS, closePlan, validateCloseLink, validateOrgClose, checkoutSessionParams, firstChargeSentence, formatChargeDate, usdWhole, planAmountUsd });
// SPLIT-2 server.js piece 72

// `stripe` = DONATION processing (connected accounts + /stripe/webhook), on the
// LIVE STRIPE_SECRET_KEY. `billingStripe` = PLATFORM subscription billing
// (create-checkout/portal, the platform customer, /billing/webhook), on
// STRIPE_BILLING_SECRET_KEY when set — so billing can run in Stripe TEST mode
// without disturbing live donations — falling back to STRIPE_SECRET_KEY when it
// isn't. The two clients are deliberately independent; do not cross-wire them.
// BUILD-45 — STRIPE_API_BASE is a LOCAL-TEST seam only (the RESEND_BASE_URL
// pattern): when set, the donation client talks to a local mock so the portal
// money-mutation suites can drive Stripe-first paths without credentials or
// network. Never set in production — Railway env does not define it.
const stripeTestBaseOpts = (() => {
  if (!process.env.STRIPE_API_BASE) return {};
  const u = new URL(process.env.STRIPE_API_BASE);
  return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80"), protocol: u.protocol.replace(":", "") };
})();
// SPLIT-2 end
__share({ stripeTestBaseOpts });
// SPLIT-2 server.js piece 73
const stripe = donationStripeKey() ? new Stripe(donationStripeKey(), stripeTestBaseOpts) : null;
// SPLIT-2 end
__share({ stripe });
// SPLIT-2 server.js piece 74
// STRIPE_BILLING_API_BASE is the same LOCAL-TEST seam for the PLATFORM billing
// client (BUILD-90). The close link is the one billing path that makes an
// outbound Stripe call the battery has to drive end to end — create a session,
// then complete it — so it needs a mock the way the donation client already
// had one. Falls back to nothing: unset (production) means the real Stripe API.
const billingTestBaseOpts = (() => {
  if (!process.env.STRIPE_BILLING_API_BASE) return {};
  const u = new URL(process.env.STRIPE_BILLING_API_BASE);
  return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80"), protocol: u.protocol.replace(":", "") };
})();
// SPLIT-2 end
__share({ billingTestBaseOpts });
// SPLIT-2 server.js piece 75
const billingStripe = billingStripeKey() ? new Stripe(billingStripeKey(), billingTestBaseOpts) : null;
// SPLIT-2 end
__share({ billingStripe });
// SPLIT-2 server.js piece 77

const app = express();
// SPLIT-2 end
__share({ app });
// SPLIT-2 server.js piece 78

// Railway terminates TLS and proxies every request through a single edge hop,
// setting X-Forwarded-For itself. Trusting exactly 1 hop lets express-rate-limit
// (and req.ip generally) see the real client IP without trusting the full,
// client-spoofable X-Forwarded-For chain that `trust proxy: true` would allow.
app.set("trust proxy", 1);
// SPLIT-2 end
// SPLIT-2 server.js piece 79
app.disable("x-powered-by");
// SPLIT-2 end
// SPLIT-2 server.js piece 80
// SECURE-2 item 1: every request has an id (Railway's edge id when present),
// answered as X-Request-Id and printed on the error line, so a log line finds
// its request without carrying anything about the person who made it.
app.use((req, res, next) => {
  const edge = String(req.headers["x-railway-request-id"] || req.headers["x-request-id"] || "");
  req.id = /^[A-Za-z0-9_-]{6,64}$/.test(edge) ? edge : require("crypto").randomBytes(8).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  if (process.env.SENTRY_DSN) { try { Sentry.getIsolationScope().setTag("request_id", req.id); } catch { /* tagging never fails a request */ } }
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 81
app.use(require("../../db").requestLimits());   // LOAD-1: limits and cancel, above every route (server/shared/requestLimits.js)
// SPLIT-2 end
// SPLIT-2 server.js piece 82


// MIGC — Mission Increase Gulf Coast client-website API (routes/migc.js).
// Mounted BEFORE the SaaS CORS/limiter/body-parsing stack on purpose: the
// client site is a different browser origin with its own allowlist
// (MIGC_SITE_ORIGIN), own JSON parsing, and own per-route rate limits, all
// self-contained in the router — so Steward's own cross-origin policy below
// stays byte-identical and the global cors() never terminates a /api/migc
// preflight before the router's policy can answer it.
app.use("/api/migc", require("../../routes/migc").router);
// SPLIT-2 end
// SPLIT-2 server.js piece 83
// ONBOARD-1: the Riverbend demo's saved website and sample export, public and
// fictional, so "Set up Steward for me" can be shown live without reading a
// real organization's site. Static files only; nothing here reads the database.
app.use("/demo-site", express.static(require("path").join(__dirname, "scripts", "demo-sites"), { index: "index.html", dotfiles: "deny", fallthrough: true }));
// SPLIT-2 end
// SPLIT-2 server.js piece 84

// Fail closed: an explicit, comma-separated allowlist is required to enable
// cross-origin browser access. If CORS_ORIGIN is ever unset in the deploy
// environment, fall back to the known production frontend origins rather than "*".
//
// Both the apex (stewardapp.dev) and www subdomain are listed explicitly.
// Neither vercel.json in this repo configures a www<->apex redirect, and
// there's no redirect configured at the Vercel/DNS level either — confirmed
// by the 2026-07 production incident where browsers loaded the app directly
// under https://www.stewardapp.dev (if a redirect existed there, the app
// could never have loaded under that origin in the first place, since the
// redirect would fire before the page loaded). So this isn't defensive
// belt-and-suspenders — both origins are genuinely live and reachable today.
// If a canonical redirect is ever added in Vercel's dashboard, the losing
// origin becomes unreachable by browsers and could in principle be dropped
// from this list, but there is little cost to leaving both here.
//
// 2026-07 incident #2: CORS_ORIGIN was set on Railway to a stale/unrelated
// value, which under the previous "env var replaces the default entirely"
// logic silently locked out every real production origin — apex, www, AND
// the Vercel URL all got rejected, confirmed by direct curl against the
// live server (no Access-Control-Allow-Origin header for any of them,
// despite Vary: Origin proving the array-based check was active). The known
// production origins are no longer replaceable by the env var at all now —
// CORS_ORIGIN can only ADD extra origins (e.g. a staging domain), never
// remove/override the baseline ones. Whatever Railway's CORS_ORIGIN is
// currently set to, it can no longer take production down by itself.
const DEFAULT_CORS_ORIGINS = ["https://stewardapp.dev", "https://www.stewardapp.dev", "https://client-five-tau-13.vercel.app"];
// SPLIT-2 end
__share({ DEFAULT_CORS_ORIGINS });
// SPLIT-2 server.js piece 85
const extraCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim()).filter(Boolean)
  : [];
// SPLIT-2 end
__share({ extraCorsOrigins });
// SPLIT-2 server.js piece 86
const corsOrigins = [...new Set([...DEFAULT_CORS_ORIGINS, ...extraCorsOrigins])];
// SPLIT-2 end
__share({ corsOrigins });
// SPLIT-2 server.js piece 87
// credentials:true is required for the donor portal's HttpOnly session cookie
// in LOCAL dev (SPA on :4173 → API on :5601 — same-site on loopback, but the
// fetch must opt in). In production the portal API is SAME-ORIGIN via the
// vercel.json /portal-api proxy, so no cross-origin cookie ever flows. The
// origin list stays the explicit allowlist — never "*" with credentials.
// SECURE-1: maxAge lets a browser keep a preflight's answer for two hours
// (Chrome's ceiling), instead of asking again before every call: HARDEN-2
// counted about sixty preflights behind one donor profile.
app.use(cors({ origin: corsOrigins, credentials: true, maxAge: 7200, exposedHeaders: ["X-Steward-CSRF"] }));
// SPLIT-2 end
// SPLIT-2 server.js piece 88
// SECURE-3 item 1: the staff session cookie stands in for the Bearer header,
// and an answer that hands out a session sets the cookie (server/auth/sessionCookie.js).
app.use(require("../auth/sessionCookie").readCookieSession());
// SPLIT-2 end
// SPLIT-2 server.js piece 89
app.use(require("../auth/sessionCookie").deliverSessionCookie());
// SPLIT-2 end
// SPLIT-2 server.js piece 90

// SECURE-1 · THE HEADERS EVERY API ANSWER CARRIES. nosniff: a body is read as
// the type it says it is. Referrer-Policy: a link out of a Steward page never
// carries its path (a token can live in one). HSTS: this host is https only.
// frame-ancestors: a page this server renders may be framed by Steward's own
// app (every allowed origin) and nobody else. A page an org embeds on its own site (the event,
// survey and volunteer pages) replaces it with "frame-ancestors *", and a
// stored file replaces it with its sandbox policy (assetStore.ASSET_CSP).
const FRAME_ANCESTORS = "frame-ancestors 'self' " + corsOrigins.join(" ");
// SPLIT-2 end
__share({ FRAME_ANCESTORS });
// SPLIT-2 server.js piece 91
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 94

// BUILD-75 — TEST_MODE=1 is the test-boot switch this flag actually became:
// it turns limiters off (the original load-test purpose), arms the x-test-*
// and sabotage seams, and disables the automatic notification-retry timers —
// "DISABLE_RATE_LIMIT" stopped describing it several builds ago. The old env
// var stays accepted as a deprecated alias so existing boots and CI keep
// working; new recipes set TEST_MODE=1. Never set either in production.
const testMode = () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1";
// SPLIT-2 end
__share({ testMode });
// SPLIT-2 server.js piece 95
const rateLimitDisabled = testMode; // deprecated alias — the limiter skips below read it
// SPLIT-2 end
__share({ rateLimitDisabled });
// SPLIT-2 server.js piece 96

// Test-boot switch: DISABLE_BACKGROUND_TICKS=1 turns off every periodic
// setTimeout/setInterval job (digests, sweeps, dunning, sequences, …) so a
// test run never has a background tick fire mid-suite (mail-sink pollution,
// surprise auto-lapse). Every sweep stays reachable via its ops route
// (/workflows/run-sweeps, /pipeline/run-auto-lapse, /digests/run, …).
// Never set in production.
const backgroundTicksDisabled = () => process.env.DISABLE_BACKGROUND_TICKS === "1";
// SPLIT-2 end
__share({ backgroundTicksDisabled });
// SPLIT-2 server.js piece 97

// Loose baseline across the whole API — catches scraping/volumetric abuse
// without interfering with normal SPA usage (a dashboard load fires many
// parallel fetches from one IP).
//
// FIX-22 · TWO buckets. A signed-in request is limited PER USER, high enough
// that a fast human never meets it: an office on one wifi shares an IP, and a
// per-IP limit made the whole office one person (Muse's demo walks hit it
// twice). Everything without a valid token (forms, login, Lost & Found, the
// portal) keeps the per-IP limit, and the stricter per-route limiters below
// still apply on top.
const generalSkip = (req) => rateLimitDisabled() || req.path === "/health" || req.path === "/stripe/webhook" || req.path === "/billing/webhook" || req.path === "/resend/webhook";
// SPLIT-2 end
__share({ generalSkip });
// SPLIT-2 server.js piece 98
// per user per 15 minutes: ~400 a minute, sustained. SCALE-2: the load
// harness (scripts/load/env.sh) raises it, because twenty users with no pause
// between screens are a measure of the database, not of a person; prod never
// sets it.
const SIGNED_IN_LIMIT = Number(process.env.SIGNED_IN_LIMIT) || 6000;
// SPLIT-2 end
__share({ SIGNED_IN_LIMIT });
// SPLIT-2 server.js piece 99
const PUBLIC_IP_LIMIT = 1000; // per IP per 15 minutes, for requests with no valid token
// SPLIT-2 end
__share({ PUBLIC_IP_LIMIT });
// SPLIT-2 server.js piece 100
const signedInLimiter = rateLimit("signedInLimiter", {
  perReplica: true,   // SCALE-1: in memory on purpose, each replica its share (rateLimitStore.js)
  windowMs: 15 * 60 * 1000,
  limit: SIGNED_IN_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => "user:" + req._limitUser,
  skip: (req) => generalSkip(req) || !(req._limitUser = tokenUserId(req)),
});
// SPLIT-2 end
__share({ signedInLimiter });
// SPLIT-2 server.js piece 101
const generalLimiter = rateLimit("generalLimiter", {
  perReplica: true,   // SCALE-1: in memory on purpose, each replica its share (rateLimitStore.js)
  windowMs: 15 * 60 * 1000,
  limit: PUBLIC_IP_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Webhooks are server-to-server (Stripe) and health checks are polled
  // frequently by design — neither should share budget with browser traffic.
  // FIX-2 F: Resend's webhook has its own ceiling on its route (routes/webhooks.js).
  skip: (req) => generalSkip(req) || !!tokenUserId(req),
});
// SPLIT-2 end
__share({ generalLimiter });
// SPLIT-2 server.js piece 102
app.use(signedInLimiter);
// SPLIT-2 end
// SPLIT-2 server.js piece 103
app.use(generalLimiter);
// SPLIT-2 end
// SPLIT-2 server.js piece 104

// FIX-22 · Ask why writes a sentence with the model on every question. Its own
// ceiling, per user, is the one a person can meet only by trying: 60 an hour.
const whyAskLimiter = rateLimit("whyAskLimiter", {
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => "why:" + (tokenUserId(req) || ipKeyGenerator(req.ip)),
  skip: (req) => rateLimitDisabled() && !req.headers["x-test-enforce-limits"],
});
// SPLIT-2 end
__share({ whyAskLimiter });
// SPLIT-2 server.js piece 105
// Mounted on the route itself (routes/why.js), so the route inventory has one /why/ask.

// Per-IP: stops one attacker from spraying attempts across many different
// accounts (each account-scoped limiter below would look "clean" individually).
const loginIpLimiter = rateLimit("loginIpLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled,
});
// SPLIT-2 end
__share({ loginIpLimiter });
// SPLIT-2 server.js piece 106
// Per-account+IP: stops repeated brute force against one specific account.
const loginAccountLimiter = rateLimit("loginAccountLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").toLowerCase()}`,
  skip: rateLimitDisabled,
});
// SPLIT-2 end
__share({ loginAccountLimiter });
// SPLIT-2 server.js piece 107

const registerLimiter = rateLimit("registerLimiter", {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // local scripted suites create fixture orgs (see tests/)
});
// SPLIT-2 end
__share({ registerLimiter });
// SPLIT-2 server.js piece 108

const passwordResetLimiter = rateLimit("passwordResetLimiter", {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // consistent with the other limiters; local suites drive the reset flow
});
// SPLIT-2 end
__share({ passwordResetLimiter });
// SPLIT-2 server.js piece 109

const donateLimiter = rateLimit("donateLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // local scripted suites exercise /donate repeatedly (tests/cover-fees.test.js)
});
// SPLIT-2 end
__share({ donateLimiter });
// SPLIT-2 server.js piece 110

// PARITY-1 Part F: the video thank-you page and its stream. A video player
// asks for many byte ranges, so this budget is per IP and generous.
const videoLimiter = rateLimit("videoLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled,
});
// SPLIT-2 end
__share({ videoLimiter });
// SPLIT-2 server.js piece 111

// Public "Request an invitation" form (invitation pivot, 2026-08-06). A human
// fills this once; anything past this budget from one IP is a bot.
const invitationLimiter = rateLimit("invitationLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled,
});
// SPLIT-2 end
__share({ invitationLimiter });
// SPLIT-2 server.js piece 112
// SECURE-1 · THE THREE DOORS THAT HAD ONLY THE GENERAL LIMIT.
// An invitation link is opened once by one person: per IP, 30 looks in 15
// minutes is a person retrying and nothing else. Atlas writes with the model
// on every question (the AI budget caps cost, this caps a loop): per user, 120
// an hour. An import preview parses a whole file: per user, 60 an hour.
// `x-test-enforce-limits` lets the security suite prove each one with the
// test switch on, as whyAskLimiter does.
const enforcedSkip = (req) => rateLimitDisabled() && !req.headers["x-test-enforce-limits"];
// SPLIT-2 end
__share({ enforcedSkip });
// SPLIT-2 server.js piece 113
const inviteLinkLimiter = rateLimit("inviteLinkLimiter", {
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: enforcedSkip,
});
// SPLIT-2 end
__share({ inviteLinkLimiter });
// SPLIT-2 server.js piece 114
const atlasLimiter = rateLimit("atlasLimiter", {
  windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: enforcedSkip,
  keyGenerator: (req) => "atlas:" + (tokenUserId(req) || ipKeyGenerator(req.ip)),
});
// SPLIT-2 end
__share({ atlasLimiter });
// SPLIT-2 server.js piece 115
const importPreviewLimiter = rateLimit("importPreviewLimiter", {
  windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: enforcedSkip,
  keyGenerator: (req) => "imp:" + (tokenUserId(req) || ipKeyGenerator(req.ip)),
});
// SPLIT-2 end
__share({ importPreviewLimiter });
// SPLIT-2 server.js piece 116
// A middleware, not a route, so the route inventory keeps one entry per door.
const IMPORT_PREVIEWS = new Set(["/history-import/preview", "/grants/import/preview", "/screening/import/preview", "/volunteer-hub/import/preview", "/imports/thank-you-preview"]);
// SPLIT-2 end
__share({ IMPORT_PREVIEWS });
// SPLIT-2 server.js piece 117
app.use((req, res, next) => {
  const p = req.path;
  if ((req.method === "GET" && /^\/auth\/invite\/[^/]+$/.test(p)) || (req.method === "POST" && p === "/auth/invite/accept")) return inviteLinkLimiter(req, res, next);
  if (req.method === "POST" && (p === "/atlas" || /^\/atlas\/[^/]+\/answer$/.test(p))) return atlasLimiter(req, res, next);
  if (req.method === "POST" && IMPORT_PREVIEWS.has(p)) return importPreviewLimiter(req, res, next);
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 118

// ── FIX-11 Part 1 — THE AUDIT TRAIL, MOUNTED BEFORE EVERY ROUTER ──────────
// This line is the whole mechanism. It sits above the FIRST router mount in
// the file — above the raw-body webhook routers, which are mounted before
// express.json() — so there is no route in the application that a change can
// reach without passing through it. A route added tomorrow is logged by
// default and its author does nothing.
//
// It reads req.body only inside the res.on("finish") handler, which runs after
// the route, by which time whichever json parser applies has run. That is why
// mounting it here, before the parsers, costs nothing.
//
// Everything about WHAT a row says lives in auditTrail.js and
// middleware/auditTrail.js. Nothing about it lives in a route.
app.use(require("../../middleware/auditTrail").auditTrail());
// SPLIT-2 end
// SPLIT-2 server.js piece 119
// HARDEN-1: a write from a page painted for one org never lands in another
// (middleware/orgBound.js). Beside the audit write, above every router.
app.use(require("../../middleware/orgBound").orgBound());
// SPLIT-2 end
// SPLIT-2 server.js piece 120
// FIX-57: a "by" field that holds a staff email reads as her name (middleware/staffNames.js).
app.use(require("../../middleware/staffNames").staffNames({ query }));
// SPLIT-2 end
// SPLIT-2 server.js piece 121
// JOURNEYS-4: after a staff write succeeds, the journey triggers that read
// rows (an auction win, a no-show, a pledge, a finished call) are checked for
// that org at once, rather than waiting for the hourly sweep. routes/crm.js
// hands the checker back at mount time, like the journey engine below; a
// null checker is a no-op. It runs after the response and never delays it.
let _journeyNudge = null;
// SPLIT-2 end
__share({ _journeyNudge });
// SPLIT-2 server.js piece 123
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.on("finish", () => {
      if (res.statusCode < 400 && req.user && req.user.orgId && typeof _journeyNudge === "function") {
        try { _journeyNudge(req.user.orgId); } catch (e) { console.error("[journey] nudge:", e.message); }
      }
    });
  }
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 124
// PARITY-3 6b: an import that succeeds ends with ANALYZE (middleware/analyzeAfterImport.js).
app.use(require("../../middleware/analyzeAfterImport").analyzeAfterImport());
// SPLIT-2 end
// SPLIT-2 server.js piece 125

app.use(require("../../routes/webhooks").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 126

// Billing webhook (platform subscriptions) must also receive raw body — same
// reason as /stripe/webhook above. This route previously lived much further
// down the file, AFTER app.use(express.json(...)), which meant the global
// JSON parser had already consumed the request stream by the time this
// route's own express.raw() ran: stripe.webhooks.constructEvent() received a
// parsed object instead of a Buffer and threw on every real delivery. Moved
// here so it's registered before the global parser, matching /stripe/webhook.
// ── Platform billing webhook (BUILD-24) ────────────────────────────────────
// Steward's OWN subscription (the org pays Steward: Core $249 / Team $499,
// founding partners $199). This is a
// SEPARATE integration from donation processing: donations flow through each
// org's CONNECTED Stripe account on the /stripe/webhook endpoint (with its own
// idempotency + gift recording). The two never cross — different endpoints,
// different signing secrets, different Stripe accounts (platform vs connect).
// Do not merge them.
//
// Plan values + Stripe-price → plan mapping. Extracted to a pure module so the
// portal-switch case (price changes, metadata.plan goes stale) is unit-testable
// without a live server — see billingPlans.js.
const { BILLING_PLAN_VALUES, planFromSubscription } = require("../../billingPlans");
// SPLIT-2 end
__share({ BILLING_PLAN_VALUES, planFromSubscription });
// SPLIT-2 server.js piece 127

// Import routes accept large one-shot payloads — a 25k-donor CSV with gift
// history serializes to ~12.6MB of JSON (measured, BUILD-05 load test), which
// the global 5mb cap below was rejecting outright: a mid-size org could not
// physically complete onboarding step 2. body-parser marks parsed requests
// (req._body), so the global parser skips bodies these already handled; the
// 5mb cap stays in force for every other route.
// BUILD-82 — a whole workbook (25,300 donors + 92,682 gift rows) arrives as ONE
// request so the existing one-transaction wrapper makes the import all-or-nothing.
// SECURE-1 · A LARGE BODY IS READ ONLY FOR SOMEONE SIGNED IN.
// Every large parser below serves a staff upload or import, and each one used
// to run before the route's own sign-in check, so a stranger could make the
// server read and parse 64 MB per request. Now a request without a validly
// signed session token falls through to the global 5mb parser (and an
// oversized body is refused there, 413). requireAuth still decides whether the
// session is alive; this only decides how much a request may make us read.
const bigBody = parser => (req, res, next) => (tokenUserId(req) ? parser(req, res, next) : next());
// SPLIT-2 end
__share({ bigBody });
// SPLIT-2 server.js piece 128
const bigJson = limit => bigBody(express.json({ limit }));
// SPLIT-2 end
__share({ bigJson });
// SPLIT-2 server.js piece 129
app.use(["/donors/import-combined", "/donors/import", "/gifts/import-history"], bigJson("64mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 130
// IMPORT-2: a history file of up to 25 MB arrives as rows, which is larger as JSON.
app.use(["/history-import/preview", "/history-import/commit"], bigJson("64mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 131
// ONBOARD-1: setup carries every donor file at once, as text.
app.use(["/setup/runs", "/admin/orgs/:id/setup"], bigJson("64mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 132
// NUMBERS-5: "Import a spreadsheet" sends a workbook's cells as JSON; the
// 25,000-person workbook (messy-25k, 7.6 MB as xlsx) is 15 MB of cells, and a
// larger file of the same shape fits with room.
app.use(["/sheet-import/understand", "/sheet-import/commit"], bigJson("50mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 133
// BUILD-65 Part 1 — image-upload routes accept a real camera photo (~15MB of
// image ≈ 20MB of base64 + JSON). The global 5mb cap below still guards every
// other route. Without this a phone photo is rejected by the body parser
// BEFORE any of the friendly validation/resize logic runs.
app.use(["/portal-settings", "/portal-page", "/impact-updates", "/fundraising/campaigns"], bigJson("22mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 134
// EMAIL-1: a photo added to the media library is a camera photo too
// (routes/media.js PHOTO_MAX_BYTES, 15MB decoded). Move both or neither.
app.use("/media/photos", bigJson("22mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 135
// FIX-41: the one picture upload door takes a camera photo too (pictures.js).
app.use("/pictures/upload", bigJson("22mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 136
// CLEAN-1: a returned change-of-address file for a large file of people.
app.use("/data-health/ncoa/results", bigJson("20mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 137
// PARITY-2 Part 3: an event's hero and its gallery take a camera photo too.
app.use((req, res, next) =>
  req.method === "POST" && /^\/events\/[^/]+\/(hero|photos)$/.test(req.path)
    ? bigJson("22mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 138
// BUILD-94 Part 1 — a donor photo is capped at 10MB of DECODED image, which is
// ~13.7MB of base64 plus the JSON around it. Matched by path rather than
// mounted on "/donors" so the rest of the donor family keeps the 5mb cap.
app.use((req, res, next) =>
  /^\/donors\/[^/]+\/photo$/.test(req.path)
    ? bigJson("16mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 139
// BUILD-96 Part 5 — a HANDFUL of photos per request, not a folder. A folder of
// two hundred headshots is hundreds of megabytes and fits in no request at
// all, so the screen sends it in chunks and this is the size of one chunk. The
// cap here and PHOTO_BULK_MAX below are one decision in two places: raising
// either alone gets a PayloadTooLargeError, which surfaces as a bare 500 with
// nothing useful in it — this route's first version did exactly that, and the
// test that caught it is the oversize leg in build96-photos-folder.
app.use("/photos/bulk", bigJson("24mb"));
// SPLIT-2 end
// SPLIT-2 server.js piece 140
// BUILD-100 (grants) Part 3 — a grant document is capped at 20MB of DECODED
// file (grantDocs.DOC_MAX_BYTES), which is ~27.4MB of base64 plus the JSON
// around it. Matched by path so the rest of the /grants family keeps the 5mb
// cap. THIS LIMIT AND THAT CAP ARE ONE DECISION — see the note on
// DOC_MAX_BYTES; raising either alone gives a PayloadTooLargeError that
// surfaces as a bare 500.
app.use((req, res, next) =>
  /^\/grants\/[^/]+\/documents$/.test(req.path)
    ? bigJson("30mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 141
// SHEETS-1: a spreadsheet brought in arrives as its rows plus the original
// file (10MB decoded, routes/sheets.js SHEET_MAX_BYTES), so the grant import
// and the board-report store take 16mb. THIS LIMIT AND THAT CAP ARE ONE
// DECISION: move both or neither.
app.use((req, res, next) =>
  req.method === "POST" && /^\/(sheets\/read|sheets\/board-reports|grants\/import(\/preview)?)$/.test(req.path)
    ? bigJson("16mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 142
// REPORTS-5: an old report is up to 25MB of DECODED file (oldReports.js
// MAX_BYTES), ~33.4MB of base64, plus an Excel sheet's rows read in the
// browser. THIS LIMIT AND THAT CAP ARE ONE DECISION: move both or neither.
app.use((req, res, next) =>
  req.method === "POST" && /^\/old-reports\/(read|preview|batches\/[^/]+\/files)$/.test(req.path)
    ? bigJson("40mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 143
// CAPTURE-1: a batch of check photos (each <=10MB decoded, capture.js
// MAX_BYTES; the client scales photos down first) in one request. THIS LIMIT
// AND THAT CAP ARE ONE DECISION: move both or neither.
app.use((req, res, next) =>
  req.method === "POST" && req.path === "/capture/upload"
    ? bigJson("40mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 144
// PARITY-1 Part B — a file on a conversation or a note is capped at 10MB of
// DECODED file (interactionFiles.FILE_MAX_BYTES), ~13.7MB of base64 plus the
// JSON around it. THIS LIMIT AND THAT CAP ARE ONE DECISION: move both or neither.
app.use((req, res, next) =>
  /^\/interactions\/[^/]+\/attachments$/.test(req.path) && req.method === "POST"
    ? bigJson("16mb")(req, res, next)
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 145
// PARITY-1 Part F: a video thank-you arrives as the raw file (WebM or MP4,
// up to 60MB: routes/videoThanks.js VIDEO_MAX_BYTES). The two numbers are one
// decision; raising either alone gives a PayloadTooLargeError.
app.use((req, res, next) =>
  req.method === "POST" && /^\/donors\/[^/]+\/video-thanks$/.test(req.path)
    ? bigBody(express.raw({ type: ["video/webm", "video/mp4"], limit: "61mb" }))(req, res, err =>
        err && err.type === "entity.too.large"
          ? res.status(413).json({ error: "too_large", sentence: "That video is over 60 MB. Record a shorter one." })
          : next(err))
    : next());
// SPLIT-2 end
// SPLIT-2 server.js piece 146
// ── FIX-11 Part 5 — THE INBOUND WEBHOOK'S RAW BODY ────────────────────────
// Resend signs its webhooks the way every other Resend webhook here is
// verified: an Svix signature over the EXACT bytes. /inbound-email is mounted
// after this parser, so by the time it ran the bytes were gone and the only
// authentication it could offer was a shared secret in the URL — which works,
// and which lands in every proxy log between here and Resend.
//
// So the bytes are kept for this one path, and the route verifies the
// signature when one is present and falls back to the shared secret when it is
// not (which is what is wired live today, and what a provider that does not
// sign would use). Same pattern as /stripe/webhook and /resend/webhook, scoped
// to one path so nothing else changes.
app.use("/inbound-email", express.raw({ type: "*/*", limit: "5mb" }), (req, res, next) => {
  req.rawInbound = Buffer.isBuffer(req.body) ? req.body : null;
  if (req.rawInbound) {
    try { req.body = JSON.parse(req.rawInbound.toString("utf8") || "{}"); }
    catch { req.body = {}; }        // a malformed body is a dropped message, never a 500
  }
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 147

app.use(express.json({ limit: "5mb" }));
// SPLIT-2 end
// SPLIT-2 server.js piece 148
// SECURE-2 item 3: no text field longer than its cap, on any write (middleware/fieldCaps.js).
app.use(require("../../middleware/fieldCaps").fieldCaps());
// SPLIT-2 end
// SPLIT-2 server.js piece 149

// PUSH-1 · Google and Microsoft tell Steward when a mailbox or calendar
// changed (routes/push.js). The deps are read per notice: the sync functions
// are declared further down this file.
app.use(require("../../routes/push").router(() => ({ query, run, syncMailbox, syncCalendar })));
// SPLIT-2 end
// SPLIT-2 server.js piece 150

// Gzip the heavy whole-org read payloads (BUILD-06 Phase A). Scoped to the
// donor-list family rather than app-wide so the SSE stream (/ai/stream) and
// webhook routes are never buffered by the compressor. Mounting on "/donors"
// prefix-matches the whole family (list, summaries, export, :id).
app.use("/donors", compression());
// SPLIT-2 end
// SPLIT-2 server.js piece 151
// HARDEN-2 item 2: every read is compressed too. The app's boot reads and
// Home's bundles went out as raw JSON (65 KB for /tasks on a 2,000-person org),
// which on a phone is seconds. Reads only, and never an event stream, so the
// AI stream (a POST) and anything that streams events are never buffered.
app.use(compression({
  filter: (req, res) => (req.method === "GET" || req.method === "HEAD")
    && !/event-stream/i.test(String(res.getHeader("Content-Type") || ""))
    && compression.filter(req, res),
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 152

// ── BUILD-94 Part 2 — the person-type module, eagerly ──────────────────────
// shared/personType.js is ESM (the shared/ convention) but its predicate is
// needed SYNCHRONOUSLY inside WHERE-clause builders that are not async. It is
// pure, dependency-free and tiny, so it is loaded once at module evaluation
// and awaited by the readiness guard below — never imported per request.
let PT = null;
// SPLIT-2 end
__share({ PT });
// SPLIT-2 server.js piece 153
const PT_READY = import("../../shared/personType.js").then(m => { PT = m; __share({ PT }); return m; });
// SPLIT-2 end
__share({ PT_READY });
// SPLIT-2 server.js piece 154
// Every money surface that must exclude a volunteer splices THIS, and there is
// exactly one of it. See shared/personType.js for why it is NULL-tolerant.
const donorOnly = (alias = "") => `(${alias ? alias + "." : ""}person_types IS NULL OR ${alias ? alias + "." : ""}person_types @> '["donor"]'::jsonb)`;
// SPLIT-2 end
__share({ donorOnly });
// SPLIT-2 server.js piece 155

// ── DB readiness guard ─────────────────────────────────────────────────────
let dbReady = false;
// SPLIT-2 end
__share({ dbReady });
// SPLIT-2 server.js piece 156
// HARDEN-1: a background job waits for the schema. On 7 Oct the scores job ran
// in a new container while its schema migration was still waiting on a lock,
// and failed for every org on a column the migration had not added yet
// ("column pattern of relation donor_scores does not exist"). recordTick, the
// seam every job passes through, now awaits this before running.
// FIX-51: the promise lives in bootGate.js, so a boot job in any module waits
// for it (bootGate.afterMigrations) rather than a bare timer.
const bootGate = require("../../bootGate");
// SPLIT-2 end
__share({ bootGate });
// SPLIT-2 server.js piece 157
const markDbReady = bootGate.markReady;
// SPLIT-2 end
__share({ markDbReady });
// SPLIT-2 server.js piece 158
const DB_READY = bootGate.READY;
// SPLIT-2 end
__share({ DB_READY });
// SPLIT-2 server.js piece 159
let DB_NAME = null;  // the actual connected database, surfaced on /health for the identity guard
// SPLIT-2 end
__share({ DB_NAME });
// SPLIT-2 server.js piece 160
// DEPLOY-1: the whole chain, the custom-field step included, is the "database" need. POOL-1: after the pool's first connection (retried).
bootGate.need("database", require("../shared/lifecycle").poolReady().then(() => getDb())
  .then(async () => {
    dbReady = true; __share({ dbReady });
    markDbReady();
    try { const r = await query("SELECT current_database() AS d"); DB_NAME = r[0] && r[0].d; __share({ DB_NAME }); } catch { /* non-fatal: /health reports database:null */ }
    await PT_READY;            // BUILD-94 Part 2 — PT is bound before any request
    console.log("Database ready");
    // BUILD-78 — one-shot legacy custom-field migration (EAV → defs + JSONB).
    // Flag-guarded so it runs once; a failure does NOT mark the flag (next
    // boot retries) and is loud — legacy values stay invisible until it lands.
    try {
      const done = await query("SELECT 1 FROM schema_flags WHERE flag='b78_cf_jsonb_migration'");
      if (!done.length) {
        const stats = await migrateLegacyCustomFields();
        await run("INSERT INTO schema_flags (flag) VALUES ('b78_cf_jsonb_migration') ON CONFLICT (flag) DO NOTHING");
        console.log("[custom-fields] legacy EAV migrated:", JSON.stringify(stats));
      }
    } catch (e) { console.error("[custom-fields] CRITICAL: legacy migration failed — legacy custom-field values are not visible until this succeeds:", e); }
  })
  .catch(err => { console.error("Database init failed:", err); process.exit(1); }));
// SPLIT-2 end
// SPLIT-2 server.js piece 161
require("../shared/lifecycle").bootNeeds({ testMode });   // DEPLOY-1: a warm pool, the AI client
// SPLIT-2 end
// SPLIT-2 server.js piece 162

// FIX-20 Part 10: THE READINESS CHECK Railway's healthcheck points at
// (a service setting; see docs/decisions/tests-and-ci.md). It answers 200 only
// once schema init has finished and the database answers, so during a deploy the OLD instance keeps
// serving until this one is ready, and nobody sees "Database initializing".
// It sits above the gate on purpose: it is the one route that must answer
// while the gate is shut.
// DEPLOY-1: 200 only when every boot need has resolved (bootGate.js), 503
// again from SIGTERM on; it names the needs it waits for.
app.get("/ready", async (req, res) => {
  if (bootGate.isDraining()) return res.status(503).json({ ready: false, draining: true });
  if (!bootGate.servable()) return res.status(503).json({ ready: false, waitingFor: bootGate.waitingFor() });
  try { await query("SELECT 1"); res.json({ ready: true }); }
  catch { res.status(503).json({ ready: false, waitingFor: ["database"] }); }
});
// SPLIT-2 end
// SPLIT-2 server.js piece 163

// The gate (DEPLOY-1): until every need resolves, a 503 to retry, never a half-booted 500.
app.use((req, res, next) => {
  if (!bootGate.servable()) return res.status(503).json({ error: "Steward is starting up", retry: true });
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 164

// ── Async error wrapper ────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  // BUILD-97 Part 5 — every route's failure already passes through here, so
  // this is where a 5xx burst is countable without an APM and without missing
  // a route. It only NOTES; noteServerError rate-limits the alert itself.
  try { noteServerError(); } catch (_) { /* never let telemetry break an error path */ }
  next(err);
});
// SPLIT-2 end
__share({ wrap });
// SPLIT-2 server.js piece 165

// ── Admin guard ────────────────────────────────────────────────────────────
// Revalidates the caller's role against the DB, NOT the (stateless, 7-day) JWT.
// The token bakes `role` in at login, so a demoted or removed user would keep
// admin power until the token expired — up to a week. Re-reading the live row
// makes a role revocation or account removal take effect on the next request.
// (Audit BUILD-37 §A5/§C4 — stale-JWT privilege retention; proven exploitable.)
// Admin routes are low-frequency, so the extra indexed lookup is not on the
// read hot path.
const requireAdmin = wrap(async (req, res, next) => {
  // FIX-57: a support session acts as an admin of the org it was opened for
  // (its own users row is in another org); requireAuth already decided it.
  if (req.user && req.user.support) return next();
  const rows = await query("SELECT role FROM users WHERE id = ?", [req.user.userId]);
  if (!rows.length) return res.status(401).json({ error: "user_not_found", message: "Your account no longer exists" });
  if (rows[0].role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
});
// SPLIT-2 end
__share({ requireAdmin });
// SPLIT-2 server.js piece 166

// ── Super-admin guard ──────────────────────────────────────────────────────
// Same reasoning as requireAdmin, but the blast radius is worse: is_super_admin
// is baked into the JWT and grants CROSS-ORG access to every tenant. A revoked
// super-admin must lose that on the next request, not in up to 7 days. The JWT
// check runs first (cheap reject), then the live `is_super_admin` flag is
// re-read. (Audit BUILD-37 §A5/§B10.) All /admin/* usages call this wrapper.
const requireSuperAdmin = [requireSuperAdminJwt, wrap(async (req, res, next) => {
  const rows = await query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId]);
  if (!rows.length || rows[0].is_super_admin !== true) return res.status(403).json({ error: "Forbidden" });
  next();
})];
// SPLIT-2 end
__share({ requireSuperAdmin });
// SPLIT-2 server.js piece 167

// ── Health ─────────────────────────────────────────────────────────────────
// `sentry` is a non-secret boolean (is SENTRY_DSN configured?) so ops checks
// can confirm error monitoring is wired without dashboard access.
// `buildSha` (deploy rewire, 2026-08-11): the exact commit this build came
// from, resolved once at boot. The Actions deploy job writes .build-sha into
// the upload before `railway up`; a git-triggered Railway build carries
// RAILWAY_GIT_COMMIT_SHA instead. null = an unstamped local/dev boot.
const BUILD_SHA = (() => {
  try {
    const stamped = require("fs").readFileSync(__dirname + "/.build-sha", "utf8").trim();
    if (stamped) return stamped;
  } catch { /* no stamp file — fall through to env */ }
  return process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_SHA || null;
})();
// SPLIT-2 end
__share({ BUILD_SHA });
// SPLIT-2 server.js piece 168
// ── BUILD-58 W-3 — the ONE ledger-provisioning helper ──────────────────────
// Every org-creation path calls this at creation, and every gift/grant ledger
// stamp resolves its target accounts through it. If the chart of accounts is
// missing (a legacy org, or a creation path that somehow skipped provisioning)
// it SELF-HEALS — provisioning the chart on the spot — and says so loudly
// (CRITICAL log + Sentry + /health.ledger.chartSelfHeals). The class rule this
// pins: a financial write must never land nowhere and return success. The
// '4010' probe below is the only one in the codebase — stamp sites must go
// through here, never re-probe (pinned by tests/ledger-provisioning.test.js).
let ledgerChartSelfHeals = 0;
// SPLIT-2 end
__share({ ledgerChartSelfHeals });
// SPLIT-2 server.js piece 169

// ── BUILD-62 Part 3 — RECONCILIATION GUARD state ────────────────────────────
// The instance (BUILD-62) was a webhook race; the CLASS is "money can move at
// Stripe and leave no trace in Steward, and nothing notices." That has now
// happened twice, in two modes, and both times a human reading a page was the
// only thing that caught it. This state holds the last reconciliation result —
// SURFACED as counts on /health so UptimeRobot's keyword watch pages on it,
// exactly like themeAssets.dbFallbackRows. A donor charged with no record is
// the single worst thing this product can do; it should page within the hour,
// not wait for someone to open a portal. See reconcileStripeVsGifts() below.
// BUILD-65 Part 6 — the counters are NULL until the sweep has actually run.
// A `0` for a check that never happened is a "clean" zero that means "I didn't
// look" — the exact failure accountsErrored was added to prevent, left open one
// door down (right after a deploy, unrecordedCharges read 0 with checkedAt:null).
// null = unchecked; a number = a real result. guardsOk (below) treats null as
// NOT fresh.
let reconciliation = {
  unrecordedCharges: null, orphanGifts: null, checkedAt: null, oldestUnrecordedAgeMin: null,
  accountsChecked: null, accountsErrored: null, divergences: [],
};
// SPLIT-2 end
__share({ reconciliation });
// SPLIT-2 server.js piece 170
// BUILD-65 Part 6 — the DENOMINATOR for accountsChecked: how many orgs have a
// connected Stripe account at all (the count the sweep SHOULD be reading). When
// Brian's orgs connect and it should read 6, a stuck accountsChecked:1 then
// looks wrong instead of looking fine. Cached (refreshed on boot + each sweep)
// so /health stays synchronous.
let reconcileAccountsWithStripe = null;
// SPLIT-2 end
__share({ reconcileAccountsWithStripe });
// SPLIT-2 server.js piece 173

// BUILD-65 Part 6 — a single field that is true ONLY when every guard is both
// clean AND fresh. Nothing may report a clean zero for a check that has not
// run. Small-fix #1: a boot grace so a not-yet-run check doesn't read false the
// instant after a deploy (which opened a UptimeRobot incident on every deploy).
// The decision logic is the pure computeGuardsOk (guards.js), unit-tested for
// the boot-grace and dead-tick cases in tests/guards.test.js.
const guardBootAt = Date.now();
// SPLIT-2 end
__share({ guardBootAt });
