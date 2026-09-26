require("dotenv").config();
const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
}

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

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]:", reason);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
});

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
// 2026-09-24 — addresses Steward must never email, from any org (mailBlock.js).
const { blockedRecipientIn, isBlockedAddress } = require("./mailBlock");
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
// It LOGS. It does not gate — the two gates (`orgMaySendEmail` and
// `donorMailDecision`) stay exactly where they are, above the send paths that
// matter, because a gate at the client would have no idea which donor a message
// is for. What this buys is the OTHER half the incident needed: an outside
// observer. On 22 September the only way to find out what had been sent was to
// read the Resend console.
//
// RECIPIENT DOMAIN, NEVER THE ADDRESS. A super-admin needs to see that mail
// went to yahoo.com from a demo org; they do not need a list of donors'
// email addresses in an ops table (steward-data-handling.md).
const _rawResend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_LOG_RETENTION_DAYS = 30;

// The org this send belongs to is taken from an explicit `_stewardOrgId` on the
// options when a call site knows it, and is otherwise null. A null org is
// honest — some sends (a password reset, the MIGC contact form) genuinely have
// no tenant — and it is better than a guess, because the whole point of this
// table is telling the truth about what left the building.
function _logOutboundEmail(opts, result, err, statusOverride) {
  const to = Array.isArray(opts && opts.to) ? opts.to[0] : (opts && opts.to);
  const domain = String(to || "").split("@")[1] || "";
  const row = [
    "eml_" + uuid().slice(0, 12),
    (opts && opts._stewardOrgId) || null,
    domain.toLowerCase().slice(0, 120),
    String((opts && opts._stewardKind) || "").slice(0, 60) || null,
    String((opts && opts.subject) || "").slice(0, 200),
    statusOverride || (err ? "failed" : "sent"),
    err ? String(err.message || err).slice(0, 300) : null,
  ];
  // Never let logging break a send, and never let it throw into a caller that
  // is already handling a provider failure.
  run(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status,error)
       VALUES (?,?,?,?,?,?,?)`, row).catch(() => {});
}

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
            try { _logOutboundEmail(opts, null, { message: why }, "blocked"); } catch (_) { /* ignore */ }
            return { data: null, error: { name: "blocked_address", message: why } };
          }
          // An org-tagged send (donorSendOpts tags it) whose org has mail OFF
          // is refused here too — the second lock behind donorMailDecision.
          const orgId = opts && opts._stewardOrgId;
          if (orgId) {
            const gate = await orgMaySendEmail(orgId);
            if (!gate.send) {
              const why = "org_mail_off: " + gate.reason;
              console.warn(`[mail-gate] REFUSED at the client: org ${orgId} (${gate.reason}), kind=${opts._stewardKind || "?"}`);
              try { _logOutboundEmail(opts, null, { message: why }, "blocked"); } catch (_) { /* ignore */ }
              return { data: null, error: { name: "org_mail_off", message: why } };
            }
          }
          // Steward's own tags never reach the provider.
          const wire = {};
          for (const k of Object.keys(opts || {})) if (!k.startsWith("_steward")) wire[k] = opts[k];
          let out, thrown = null;
          try {
            out = await eTarget.send(wire);
          } catch (e) { thrown = e; }
          // The log must never break a send, and never swallow a provider
          // failure the caller is already handling.
          try { _logOutboundEmail(opts, out, thrown || (out && out.error)); } catch (_) { /* ignore */ }
          if (thrown) throw thrown;
          return out;
        };
      },
    });
  },
});
const { getDb, query, run, uuid, seedOrgData, withTransaction, withAdvisoryLock, queryTx, runTx } = require("./db");
// BUILD-89S - the provider adapter registry and the read-only HTTP guard.
const sourceAdapters = require("./sources/index.js");
const { signToken, requireAuth, requireSuperAdmin: requireSuperAdminJwt } = require("./auth");
const { sessionCache } = require("./sessionCache");
const { normalizeAccent, normalizeTint } = require("./branding");
const { lookupMatchingGift } = require("./matchingGifts");
const Stripe = require("stripe");
const { google } = require("googleapis");
const { Webhook: SvixWebhook } = require("svix");
const { donationStripeKey, billingStripeKey, billingStripeMode, billingConfigError, otherBillingMode } = require("./stripeKeys");
const { CANONICAL_APP_URL, resolvePublicAppUrl, publicAppUrl } = require("./publicUrl");
const { DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff } = require("./stripeEvents");
const { putThemeAsset, getThemeAsset, pruneThemeAssets, pruneUnreferencedAssets, refreshAssetFallbackCount, refreshRetentionCounts, purgeExpiredAssets, assetHealth, ASSET_ID_RE } = require("./assetStore");
// BUILD-94 Part 1 — the signed, expiring front door for a donor photograph
// (a person's face is not theme imagery; see personPhoto.js's header).
const personPhoto = require("./personPhoto");
const { computeGuardsOk } = require("./guards");
// BUILD-96 Part 2 — the ONE definition of what sample data is. The guard, the
// counts and the delete all read from it; three lists would disagree, and the
// way they would disagree is by deleting something real.
const sampleDataMod = require("./sampleData");
const { PRODUCT_ID } = require("./product");
// BUILD-72 Part 4 — THE date seam. Every civil-date boundary in the product
// goes through here, computed in the ORGANIZATION's timezone. See orgTime.js
// for the type discipline (instants vs civil dates) and why it exists.
const geocode = require("./geocode"); // BUILD-84 P0-4 — the ONE seam an address becomes coordinates through; never called from a read path
const orgTime = require("./orgTime");
// BUILD-73 Part 2 — THE MONEY SEAM. Every money value that crosses into or out
// of storage goes through here, and nothing else in this file converts between
// dollars and cents. See money.js for why the eight Math.round() sites this
// replaces were each a chance to be wrong in the same direction.
const { toCents, toDollars, parseMoneyOrThrow, hasCents } = require("./money");
// The same seam, as a namespace — BUILD-87 Part 1's stored-import invariant
// reads several of its helpers at once and naming them one by one buys nothing.
const money = require("./money");
// BUILD-87 Part 4 — the one rule that gates the bookkeeper's file, stated as
// a pure function so it can be proven able to fire without a database.
const { bookkeeperRefusals, bookkeeperRefusalMessage } = require("./bookkeeper");
const { loadDefs: loadCfDefs, validateCustomFields, mergeCustomValues, migrateLegacyCustomFields } = require("./customFields");
const { orgToday, orgIsOverdue, orgDaysOverdue, orgPeriodBounds, orgFiscalYearStart, orgReportYear } = orgTime;
// BUILD-76 Part 1 — THE DRIFT ENGINE. One pure module defines "drifting"
// (past the donor's OWN expected next gift, not yet lapsed); every surface —
// the home list, the headline dollars, the funnel row, every badge — reads
// computeDriftForDonors() below, which is the only caller. drift.js never
// reads a clock; `today` goes in through the org-timezone seam.
const driftEngine = require("./drift");

// Resolve an org's timezone for the seam. Cached briefly: every date-bounded
// read needs it, and it changes about once in an organization's lifetime.
const _tzCache = new Map();
// BUILD-84 — the suites reuse fixed org ids and delete/recreate them rapidly,
// so a 30-second cache serves the DELETED org's confirmation state to the next
// run. `SESSION_CACHE_TTL_MS=0` is already the flag that says "this process is
// a test boot, do not cache identity"; the org's timezone confirmation is the
// same kind of fact, so it rides the same switch. Prod leaves it unset → 30s.
const TZ_CACHE_MS = process.env.SESSION_CACHE_TTL_MS === "0" ? 0 : 30000;
async function orgTz(orgId) {
  const hit = TZ_CACHE_MS ? _tzCache.get(orgId) : null;
  if (hit && hit.until > Date.now()) return hit.value;
  let tz = orgTime.DEFAULT_TZ, confirmed = null;
  try {
    const r = await query("SELECT timezone, timezone_confirmed_at FROM orgs WHERE id=?", [orgId]);
    tz = orgTime.normalizeTimezone(r[0]?.timezone);
    // BUILD-84 — the timezone column is NOT NULL with a default, so "has a
    // timezone" has always been true for every org and means nothing. This is
    // the timezone a HUMAN chose, and it is what the timed reminder requires:
    // a morning digest forgives being an hour off, a 2:00 reminder does not.
    confirmed = r[0]?.timezone_confirmed_at || null;
  } catch { /* pre-migration boot — the default is correct */ }
  _tzCache.set(orgId, { value: { timezone: tz, timezone_confirmed_at: confirmed }, until: Date.now() + TZ_CACHE_MS });
  return { timezone: tz, timezone_confirmed_at: confirmed };
}
// The zone NAME alone. `orgTz` returns {timezone, timezone_confirmed_at} — a
// caller that wants an Intl option and passes the whole object gets a
// RangeError, which is how the first close-link welcome email failed to send.
async function orgTzName(orgId) {
  try { return (await orgTz(orgId)).timezone; } catch { return orgTime.DEFAULT_TZ; }
}

// ── BUILD-75 C.1 — THE ACTOR ON EVERY WRITE ─────────────────────────────────
// Every row that represents something someone DID records who did it — an
// IDENTITY, never a boolean: a user id for a human, or a system identity
// string for a non-human path. "Who logged this note" and "who imported these
// four hundred rows" are questions a development office asks constantly, and
// they are unanswerable retroactively — the information exists only at write
// time. This is also what makes agent oversight free the day something
// non-human writes: the actor column is already there, already honest.
// tests/actor-stamp.test.js pins that every INSERT into the actor tables
// carries these two values.
function actor(req) {
  return { id: (req && req.user && req.user.userId) || null, name: (req && req.user && req.user.email) || null };
}
// MOVED UP HERE FROM THE AGENT SECTION (BUILD-99 Part 4). The prospect brief is
// declared ~5,000 lines before the agent block and reads this, and `scripts/
// tdz-scan.js --all` rightly flagged it as a read-above-declaration. It happens
// to be legal (a route handler body runs long after module evaluation), and the
// standing TDZ rule says to move it anyway: relying on call order is how the next
// one of these gets written. ONE model name for everything the agent does.
const AGENT_MODEL = "claude-opus-5";
const SYS_AUTO = { id: "system:auto", name: "Steward (automatic)" };
const sysWorkflow = recipe => ({ id: `system:workflow:${recipe}`, name: `Steward (workflow: ${recipe})` });
const { imageSize } = require("image-size");
const { computeTrialEnd, computeReminderAt, isReminderDue, TRIAL_DAYS, REMINDER_LEAD_DAYS } = require("./trialEnd");
const { CLOSE_PLANS, closePlan, validateCloseLink, validateOrgClose, checkoutSessionParams,
        firstChargeSentence, formatChargeDate, usd: usdWhole } = require("./closeLink");

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
const stripe = donationStripeKey() ? new Stripe(donationStripeKey(), stripeTestBaseOpts) : null;
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
const billingStripe = billingStripeKey() ? new Stripe(billingStripeKey(), billingTestBaseOpts) : null;

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "https://nonprofit-erp-production.up.railway.app/gmail/callback"
  );
}

const app = express();

// Railway terminates TLS and proxies every request through a single edge hop,
// setting X-Forwarded-For itself. Trusting exactly 1 hop lets express-rate-limit
// (and req.ip generally) see the real client IP without trusting the full,
// client-spoofable X-Forwarded-For chain that `trust proxy: true` would allow.
app.set("trust proxy", 1);

// MIGC — Mission Increase Gulf Coast client-website API (routes/migc.js).
// Mounted BEFORE the SaaS CORS/limiter/body-parsing stack on purpose: the
// client site is a different browser origin with its own allowlist
// (MIGC_SITE_ORIGIN), own JSON parsing, and own per-route rate limits, all
// self-contained in the router — so Steward's own cross-origin policy below
// stays byte-identical and the global cors() never terminates a /api/migc
// preflight before the router's policy can answer it.
app.use("/api/migc", require("./routes/migc").router);

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
const extraCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim()).filter(Boolean)
  : [];
const corsOrigins = [...new Set([...DEFAULT_CORS_ORIGINS, ...extraCorsOrigins])];
// credentials:true is required for the donor portal's HttpOnly session cookie
// in LOCAL dev (SPA on :4173 → API on :5601 — same-site on loopback, but the
// fetch must opt in). In production the portal API is SAME-ORIGIN via the
// vercel.json /portal-api proxy, so no cross-origin cookie ever flows. The
// origin list stays the explicit allowlist — never "*" with credentials.
app.use(cors({ origin: corsOrigins, credentials: true }));

// ── Rate limiting ────────────────────────────────────────────────────────
// Shared 429 handler: explicit Retry-After header + a body shape that can't be
// mistaken for a generic error (client code can key off error === "rate_limited").
function rateLimitHandler(req, res) {
  const resetMs = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 60000;
  res.set("Retry-After", String(Math.max(1, Math.ceil(resetMs / 1000))));
  res.status(429).json({ error: "rate_limited", message: "Too many requests. Please try again later." });
}

// BUILD-75 — TEST_MODE=1 is the test-boot switch this flag actually became:
// it turns limiters off (the original load-test purpose), arms the x-test-*
// and sabotage seams, and disables the automatic notification-retry timers —
// "DISABLE_RATE_LIMIT" stopped describing it several builds ago. The old env
// var stays accepted as a deprecated alias so existing boots and CI keep
// working; new recipes set TEST_MODE=1. Never set either in production.
const testMode = () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1";
const rateLimitDisabled = testMode; // deprecated alias — the limiter skips below read it

// Test-boot switch: DISABLE_BACKGROUND_TICKS=1 turns off every periodic
// setTimeout/setInterval job (digests, sweeps, dunning, sequences, …) so a
// test run never has a background tick fire mid-suite (mail-sink pollution,
// surprise auto-lapse). Every sweep stays reachable via its ops route
// (/workflows/run-sweeps, /pipeline/run-auto-lapse, /digests/run, …).
// Never set in production.
const backgroundTicksDisabled = () => process.env.DISABLE_BACKGROUND_TICKS === "1";

// Loose baseline across the whole API — catches scraping/volumetric abuse
// without interfering with normal SPA usage (a dashboard load fires many
// parallel fetches from one IP).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Webhooks are server-to-server (Stripe) and health checks are polled
  // frequently by design — neither should share budget with browser traffic.
  skip: (req) => rateLimitDisabled() || req.path === "/health" || req.path === "/stripe/webhook" || req.path === "/billing/webhook",
});
app.use(generalLimiter);

// Per-IP: stops one attacker from spraying attempts across many different
// accounts (each account-scoped limiter below would look "clean" individually).
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled,
});
// Per-account+IP: stops repeated brute force against one specific account.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").toLowerCase()}`,
  skip: rateLimitDisabled,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // local scripted suites create fixture orgs (see tests/)
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // consistent with the other limiters; local suites drive the reset flow
});

const donateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled, // local scripted suites exercise /donate repeatedly (tests/cover-fees.test.js)
});

// Public "Request an invitation" form (invitation pivot, 2026-08-06). A human
// fills this once; anything past this budget from one IP is a bot.
const invitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: rateLimitDisabled,
});
app.use(require("./routes/webhooks").routers.r0);

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
const { BILLING_PLAN_VALUES, planFromSubscription } = require("./billingPlans");

// Import routes accept large one-shot payloads — a 25k-donor CSV with gift
// history serializes to ~12.6MB of JSON (measured, BUILD-05 load test), which
// the global 5mb cap below was rejecting outright: a mid-size org could not
// physically complete onboarding step 2. body-parser marks parsed requests
// (req._body), so the global parser skips bodies these already handled; the
// 5mb cap stays in force for every other route.
// BUILD-82 — a whole workbook (25,300 donors + 92,682 gift rows) arrives as ONE
// request so the existing one-transaction wrapper makes the import all-or-nothing.
app.use(["/donors/import-combined", "/donors/import", "/gifts/import-history"], express.json({ limit: "64mb" }));
// BUILD-65 Part 1 — image-upload routes accept a real camera photo (~15MB of
// image ≈ 20MB of base64 + JSON). The global 5mb cap below still guards every
// other route. Without this a phone photo is rejected by the body parser
// BEFORE any of the friendly validation/resize logic runs.
app.use(["/portal-settings", "/portal-page", "/impact-updates", "/fundraising/campaigns"], express.json({ limit: "22mb" }));
// BUILD-94 Part 1 — a donor photo is capped at 10MB of DECODED image, which is
// ~13.7MB of base64 plus the JSON around it. Matched by path rather than
// mounted on "/donors" so the rest of the donor family keeps the 5mb cap.
app.use((req, res, next) =>
  /^\/donors\/[^/]+\/photo$/.test(req.path)
    ? express.json({ limit: "16mb" })(req, res, next)
    : next());
// BUILD-96 Part 5 — a HANDFUL of photos per request, not a folder. A folder of
// two hundred headshots is hundreds of megabytes and fits in no request at
// all, so the screen sends it in chunks and this is the size of one chunk. The
// cap here and PHOTO_BULK_MAX below are one decision in two places: raising
// either alone gets a PayloadTooLargeError, which surfaces as a bare 500 with
// nothing useful in it — this route's first version did exactly that, and the
// test that caught it is the oversize leg in build96-photos-folder.
app.use("/photos/bulk", express.json({ limit: "24mb" }));
// BUILD-100 (grants) Part 3 — a grant document is capped at 20MB of DECODED
// file (grantDocs.DOC_MAX_BYTES), which is ~27.4MB of base64 plus the JSON
// around it. Matched by path so the rest of the /grants family keeps the 5mb
// cap. THIS LIMIT AND THAT CAP ARE ONE DECISION — see the note on
// DOC_MAX_BYTES; raising either alone gives a PayloadTooLargeError that
// surfaces as a bare 500.
app.use((req, res, next) =>
  /^\/grants\/[^/]+\/documents$/.test(req.path)
    ? express.json({ limit: "30mb" })(req, res, next)
    : next());
app.use(express.json({ limit: "5mb" }));

// Gzip the heavy whole-org read payloads (BUILD-06 Phase A). Scoped to the
// donor-list family rather than app-wide so the SSE stream (/ai/stream) and
// webhook routes are never buffered by the compressor. Mounting on "/donors"
// prefix-matches the whole family (list, summaries, export, :id).
app.use("/donors", compression());

// ── BUILD-94 Part 2 — the person-type module, eagerly ──────────────────────
// shared/personType.js is ESM (the shared/ convention) but its predicate is
// needed SYNCHRONOUSLY inside WHERE-clause builders that are not async. It is
// pure, dependency-free and tiny, so it is loaded once at module evaluation
// and awaited by the readiness guard below — never imported per request.
let PT = null;
const PT_READY = import("./shared/personType.js").then(m => { PT = m; return m; });
// Every money surface that must exclude a volunteer splices THIS, and there is
// exactly one of it. See shared/personType.js for why it is NULL-tolerant.
const donorOnly = (alias = "") => `(${alias ? alias + "." : ""}person_types IS NULL OR ${alias ? alias + "." : ""}person_types @> '["donor"]'::jsonb)`;

// ── DB readiness guard ─────────────────────────────────────────────────────
let dbReady = false;
let DB_NAME = null;  // the actual connected database, surfaced on /health for the identity guard
getDb()
  .then(async () => {
    dbReady = true;
    try { const r = await query("SELECT current_database() AS d"); DB_NAME = r[0] && r[0].d; } catch { /* non-fatal: /health reports database:null */ }
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
  .catch(err => { console.error("Database init failed:", err); process.exit(1); });

app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: "Database initializing" });
  next();
});

// ── Async error wrapper ────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  // BUILD-97 Part 5 — every route's failure already passes through here, so
  // this is where a 5xx burst is countable without an APM and without missing
  // a route. It only NOTES; noteServerError rate-limits the alert itself.
  try { noteServerError(); } catch (_) { /* never let telemetry break an error path */ }
  next(err);
});

// ── Admin guard ────────────────────────────────────────────────────────────
// Revalidates the caller's role against the DB, NOT the (stateless, 7-day) JWT.
// The token bakes `role` in at login, so a demoted or removed user would keep
// admin power until the token expired — up to a week. Re-reading the live row
// makes a role revocation or account removal take effect on the next request.
// (Audit BUILD-37 §A5/§C4 — stale-JWT privilege retention; proven exploitable.)
// Admin routes are low-frequency, so the extra indexed lookup is not on the
// read hot path.
const requireAdmin = wrap(async (req, res, next) => {
  const rows = await query("SELECT role FROM users WHERE id = ?", [req.user.userId]);
  if (!rows.length) return res.status(401).json({ error: "user_not_found", message: "Your account no longer exists" });
  if (rows[0].role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
});

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
// BUILD-65 Part 6 — the DENOMINATOR for accountsChecked: how many orgs have a
// connected Stripe account at all (the count the sweep SHOULD be reading). When
// Brian's orgs connect and it should read 6, a stuck accountsChecked:1 then
// looks wrong instead of looking fine. Cached (refreshed on boot + each sweep)
// so /health stays synchronous.
let reconcileAccountsWithStripe = null;
async function refreshReconcileDenominator() {
  try {
    const [r] = await query("SELECT COUNT(*)::int AS n FROM orgs WHERE stripe_account_id IS NOT NULL");
    reconcileAccountsWithStripe = r ? r.n : 0;
  } catch { /* leave prior value */ }
  return reconcileAccountsWithStripe;
}
function reconciliationHealth() {
  return {
    unrecordedCharges: reconciliation.unrecordedCharges,
    orphanGifts: reconciliation.orphanGifts,
    checkedAt: reconciliation.checkedAt,
    oldestUnrecordedAgeMin: reconciliation.oldestUnrecordedAgeMin,
    // BUILD-63 — accountsErrored > 0 means the guard could NOT read some
    // connected accounts (e.g. a restricted key without connected-account
    // charge access): a "clean" unrecordedCharges is not trustworthy while this
    // is non-zero. Watch it alongside unrecordedCharges.
    accountsChecked: reconciliation.accountsChecked ?? null,
    accountsErrored: reconciliation.accountsErrored ?? null,
    accountsWithStripe: reconcileAccountsWithStripe,   // BUILD-65 Part 6 — the denominator
  };
}

// BUILD-65 Part 6 — a single field that is true ONLY when every guard is both
// clean AND fresh. Nothing may report a clean zero for a check that has not
// run. Small-fix #1: a boot grace so a not-yet-run check doesn't read false the
// instant after a deploy (which opened a UptimeRobot incident on every deploy).
// The decision logic is the pure computeGuardsOk (guards.js), unit-tested for
// the boot-grace and dead-tick cases in tests/guards.test.js.
const guardBootAt = Date.now();
function guardsOk() {
  return computeGuardsOk({
    bootAt: guardBootAt,
    reconciliation,
    webhook: webhookSubStatus,
    chartSelfHeals: ledgerChartSelfHeals,
    dbFallbackRows: assetHealth().dbFallbackRows,
    failedPending: notifyFailedPending,
  });
}

// ── BUILD-63 Part 2 — the event-manifest vs live-subscription diff ───────────
// A handler that grows a `case` nobody subscribed becomes SILENT working code
// (the BUILD-58 refund/dispute class). This caches the diff between the manifest
// (stripeEvents.js, pinned to the handler by tests/webhook-manifest.test.js) and
// the LIVE endpoint's subscribed event list, so /health surfaces the count.
// missingCount > 0 = handled events that will never arrive — go subscribe them.
let webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] };
function webhookSubHealth() {
  return { missingCount: webhookSubStatus.missingCount, checked: webhookSubStatus.checked };
}

async function ensureOrgLedger(orgId, { heal = false } = {}) {
  const probe = async () => {
    const [contrib] = await query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [orgId]);
    const [grant] = await query("SELECT id FROM accounts WHERE org_id = ? AND type = 'revenue' AND subtype = 'grants' ORDER BY code ASC LIMIT 1", [orgId]);
    const [fund] = await query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]);
    return { contribAcctId: contrib?.id || null, grantAcctId: grant?.id || contrib?.id || null, genFundId: fund?.id || null };
  };
  let ids = await probe();
  if (ids.contribAcctId && ids.genFundId) return ids;

  // Missing pieces — provision under an advisory lock so two concurrent
  // stamps (e.g. parallel webhook deliveries) can't double-build the chart.
  await withAdvisoryLock("orgledger:" + orgId, async () => {
    const existing = await query("SELECT id FROM accounts WHERE org_id = ? LIMIT 1", [orgId]);
    if (!existing.length) {
      await seedOrgData(orgId); // full standard chart + General Operating fund
    } else {
      // A partial chart (org built its own accounts): add only what's missing.
      const partial = await probe();
      if (!partial.contribAcctId) {
        await run("INSERT INTO accounts (id, org_id, code, name, type, subtype) VALUES (?,?,?,?,?,?)",
          ["acc_" + uuid().slice(0, 8), orgId, "4010", "Individual Contributions", "revenue", "contributions"]);
      }
      const funds = await query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false LIMIT 1", [orgId]);
      if (!funds.length) {
        await run("INSERT INTO fin_funds (id, org_id, name, description, restricted) VALUES (?,?,?,?,false)",
          ["ff_" + uuid().slice(0, 8), orgId, "General Operating", "General unrestricted operating fund", false]);
      }
    }
  });
  ids = await probe();
  if (heal) {
    // Reaching here from a STAMP means an org existed without a usable ledger
    // — the provisioning gap W-3 found. The stamp still lands (self-healed),
    // but the gap is surfaced, never swallowed.
    ledgerChartSelfHeals++;
    console.error(`[ledger] CRITICAL: org ${orgId} had no usable chart of accounts at stamp time — provisioned on the spot (self-heal #${ledgerChartSelfHeals}). An org-creation path is not provisioning.`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`ledger chart self-heal for org ${orgId}`, "error"); } catch { /* surfacing must never fail the stamp */ }
  }
  return ids;
}

// ── BUILD-88a A.1 — ONE GIFT, ONE PATH ────────────────────────────────────
// A gift typed anywhere — the gift form, Log a conversation, an event's
// attendee row, a Stripe charge, and later the deposit sheet — is written ONCE,
// as a gift row, through this function. Before it there were five inserts, and
// they disagreed about what a gift IS: two wrote no fund, four wrote no payment
// method, three bumped the donor's totals with their own UPDATE, and each wrote
// its own timeline sentence with the AMOUNT COPIED INTO THE TEXT. That copy is
// the Renee Castillo defect: the profile drew the gift once from the gift row
// and once from the sentence beside it, and the record showed one $5,000 gift
// twice.
//
// THREE RULES, and they are the whole of it.
//  1. A gift row always carries a fund and a payment method. With no fund
//     chosen it takes the org's unrestricted fund; with no method it says
//     "Needs you" rather than nothing, because a blank is indistinguishable
//     from "nobody has looked".
//  2. The timeline entry LINKS to the gift (interactions.gift_id) and holds no
//     copy of the amount. Every reader — the header total, Giving this year,
//     Drift, the bookkeeper's export, receipts, the Finance ledger — reads the
//     gift row.
//  3. The ledger is posted under the BUILD-83 rule: imported history never
//     posts; a live gift posts if the org keeps posting on.
//
// The caller owns everything that is not writing the gift: attribution,
// pledges, receipts, workflows, threads, tasks. Those are decisions ABOUT a
// gift; this is the gift.
const GIFT_METHOD_UNKNOWN = "Needs you";

async function orgUnrestrictedFundId(orgId) {
  const ids = await ensureOrgLedger(orgId, { heal: true });
  return ids.genFundId || null;
}

// recordGift(o) → { gift, duplicate } — `duplicate` means the conflict key had
// already claimed this gift and NOTHING was written a second time (no donor
// delta, no ledger stamp, no timeline entry). Every caller must honour it.
async function recordGift(o) {
  const orgId = o.orgId;
  const amount = round2(Number(o.amount) || 0);
  const date = o.date;
  const giftId = o.giftId || ("g_" + uuid().slice(0, 8));
  const actorId = o.actorId || null, actorName = o.actorName || null;
  // Rule 1 — a fund and a method, always. A fund the caller names is honoured
  // only if it belongs to this org (never trust an id off a webhook payload).
  //
  // TWO CASES, and they are not the same case (BUILD-88a A.3 walk):
  //  · A STAFF MEMBER typed this gift with a fund picker in front of them and
  //    left it alone. The org's unrestricted fund is the honest reading of that
  //    choice, and a blank there is indistinguishable from "nobody looked".
  //  · A DONOR gave online and designated nothing. Nobody at the organisation
  //    has said where that money goes, and a fund is an accounting fact rather
  //    than a default — it stays undesignated (`defaultFund: false`).
  // And a fund id that was REFUSED never silently becomes a different fund:
  // that would turn a rejected (possibly cross-org) designation into one that
  // LOOKS deliberate, which is worse than none at all.
  let fundId = o.fundId || null;
  let fundRefused = false;
  if (fundId) {
    const okFund = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
    if (!okFund.length) { fundId = null; fundRefused = true; console.error(`[gift] refused a fund id that is not this org's: ${o.fundId}`); }
  }
  // BUILD-100 (grants) Part 4 — A PAYMENT AGAINST A RESTRICTED AWARD MAY NOT
  // FALL BACK TO THE UNRESTRICTED FUND. The award is a pledge on the funder
  // (Part 1), so a payment carries `pledgeId`; if that pledge is a grant award
  // and the grant names a fund, THAT is the fund. Without this wire a $10,000
  // program-restricted award's payments post to General Operating and the
  // restriction is lost at the ledger — silently, since every other figure
  // still adds up.
  if (!fundId && !fundRefused && o.pledgeId) {
    const [gf] = await query(
      `SELECT g.fund_id FROM grants g
        WHERE g.org_id = ? AND g.award_pledge_id = ? AND g.fund_id IS NOT NULL
          AND g.restriction IN ('program_restricted','capital','time_restricted')`,
      [orgId, o.pledgeId]);
    if (gf && gf.fund_id) fundId = gf.fund_id;
  }
  if (!fundId && !fundRefused && o.defaultFund !== false) fundId = await orgUnrestrictedFundId(orgId);
  const paymentMethod = String(o.paymentMethod || "").trim() || GIFT_METHOD_UNKNOWN;

  const cols = ["id", "org_id", "donor_id", "amount", "date", "type", "campaign", "campaign_id",
                "notes", "fund_id", "payment_method", "pledge_id", "external_id", "idempotency_key",
                "stripe_payment_id", "giving_page_id", "peer_fundraiser_id", "cover_fee_amount",
                "recurring_subscription_id", "created_by", "created_by_name",
                // BUILD-89S 89a — a gift that came in through a connected giving
                // source remembers which one, what the provider took (NOT the
                // donor-covers-fee amount above it), and the provider's own
                // subscription id. They belong in THIS insert and nowhere else:
                // a second UPDATE after the fact is a second write path.
                "giving_source_id", "processor_fee_amount", "provider_recurring_ref",
                // BUILD-95 — the photograph of the cheque this gift came on.
                // In THIS insert for the same reason as the source columns
                // above: a second UPDATE after the fact is a second write path.
                "cheque_asset_id",
                // BUILD-98 (switch) Part 4 — a gift that bought something (a
                // gala ticket) carries what it bought and what that was worth,
                // so the receipt states the deductible part. Absent means
                // nothing was received in exchange, which is every other gift.
                "deductible_amount", "quid_pro_quo_desc", "quid_pro_quo_value",
                // BUILD-102 Part 5 — which email brought this gift in. In THIS
                // insert for the same reason as every column above it: a second
                // UPDATE after the fact is a second write path, and the one thing
                // that must never happen to an attribution is that it lands on
                // some gifts and not others depending on which door they came in.
                "utm_source", "utm_medium", "utm_campaign"];
  const vals = [giftId, orgId, o.donorId, amount, date, o.type || "cash", o.campaign || "",
                o.campaignId || null, o.notes || "", fundId, paymentMethod, o.pledgeId || null,
                o.externalId || null, o.idempotencyKey || null, o.stripePaymentId || null,
                o.givingPageId || null, o.peerFundraiserId || null, o.coverFeeAmount || 0,
                o.recurringSubscriptionId || null, actorId, actorName,
                o.givingSourceId || null, round2(Number(o.processorFeeAmount) || 0), o.providerRecurringRef || null,
                o.chequeAssetId || null,
                o.quidProQuoValue != null ? round2(Math.max(0, amount - Number(o.quidProQuoValue))) : null,
                o.quidProQuoValue != null ? String(o.quidProQuoDesc || "").slice(0, 300) : null,
                o.quidProQuoValue != null ? round2(Number(o.quidProQuoValue)) : null,
                o.utmSource || null, o.utmMedium || null, o.utmCampaign || null];
  // The conflict key is the caller's, because what makes a gift the SAME gift
  // differs by door: Stripe's payment intent, the form's idempotency key, the
  // source system's gift id. One of them, never a guess at (donor, amount, date)
  // — forty $100 Sunday gifts are forty gifts.
  const conflict = o.conflict === "stripe" ? "ON CONFLICT (org_id, stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING"
    : o.conflict === "idempotency" ? "ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"
    : o.conflict === "external" ? "ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING"
    : "";
  const inserted = await query(
    `INSERT INTO gifts (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) ${conflict} RETURNING id`,
    vals);
  if (!inserted.length) return { gift: null, duplicate: true };

  // The donor's rollup, in one place. `last_gift_*` only move when this gift is
  // at least as recent as the one on file — a back-dated gift is history, not
  // the latest news.
  // NULLIF guards the empty string: `''::date` throws, and a donor whose
  // last_gift_date was never set carries '' on some legacy rows.
  const LAST_GIFT_IS_NEWER = "COALESCE(NULLIF(last_gift_date,''),'0001-01-01')::date <= ?::date";
  // BUILD-94 Part 2 — A VOLUNTEER WHO GIVES BECOMES A DONOR TOO, on the SAME
  // record. Never a second row: the same person twice is the thing a CRM
  // exists to prevent. The `person_types` CASE below lives here, in the ONE
  // place every money path already rolls up through (BUILD-88a), so no giving
  // route can forget it. "other" means "we do not know what they are" — a gift
  // answers that, so it is REPLACED rather than accumulated beside "donor".
  await run(
    `UPDATE donors
        SET total_giving = total_giving + ?,
            gift_count = gift_count + 1,
            last_gift_amount = CASE WHEN ${LAST_GIFT_IS_NEWER} THEN ? ELSE last_gift_amount END,
            last_gift_date   = CASE WHEN ${LAST_GIFT_IS_NEWER} THEN ? ELSE last_gift_date END,
            status = CASE WHEN total_giving + ? > 20000 THEN 'major'
                          WHEN total_giving + ? > 5000  THEN 'mid'
                          ELSE status END,
            person_types = CASE
              WHEN person_types IS NULL THEN '["donor"]'::jsonb
              WHEN person_types @> '["donor"]'::jsonb THEN person_types
              ELSE (person_types - 'other') || '["donor"]'::jsonb
            END,
            updated_at = NOW()
      WHERE id = ? AND org_id = ?`,
    [amount, date, amount, date, date, amount, amount, o.donorId, orgId]);

  // Rule 3 — the ledger.
  let posted = false;
  if (o.post !== false) {
    try {
      const [orgRow] = await query("SELECT ledger_posting_enabled FROM orgs WHERE id=?", [orgId]);
      if (!orgRow || orgRow.ledger_posting_enabled !== false) {
        const ledgerIds = await ensureOrgLedger(orgId, { heal: true });
        const [dn] = await query("SELECT name FROM donors WHERE id=?", [o.donorId]);
        await run(
          `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
          ["ft_" + uuid().slice(0, 8), orgId, date, o.ledgerDescription || `Gift from ${dn?.name || "Donor"}`,
           dn?.name || "", amount, "income", ledgerIds.contribAcctId, fundId || ledgerIds.genFundId,
           o.donorId, o.ledgerSource || "gift", giftId, actorId, actorName]);
        posted = true;
      }
    } catch (e) { console.error("[gift] ledger stamp:", e.message); }
  }

  // Rule 2 — ONE timeline entry, linked, with no copy of the amount. When the
  // gift came out of a conversation the conversation's own line is the note;
  // otherwise the gift's note, or nothing at all. The screen reads the money
  // off the gift this row points at.
  let interactionId = null;
  if (o.timeline !== false) {
    interactionId = "int_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [interactionId, orgId, o.donorId, "gift", String(o.timelineNote || o.notes || "").slice(0, 2000),
       date, actorId, actorName, giftId,
       o.source ? JSON.stringify({ via: o.source }) : null]);
  }

  const [gift] = await query("SELECT * FROM gifts WHERE id=?", [giftId]);

  // ── BUILD-88b B.2 — A PAYMENT THAT MATCHES AN INSTALMENT APPLIES ──────────
  // Automatically, from EVERY door, because this is the one place every gift
  // passes through. A caller that already named an instalment (the deposit
  // sheet, which asked her) is left alone; anything else is matched by donor
  // and amount against the open schedule, oldest due first. WITHIN ten per
  // cent is deliberately NOT matched here — that is a question, and a
  // background path has nobody to ask, so a near miss stays a plain gift.
  let appliedInstallment = null;
  if (o.installmentId === undefined && o.applyInstallment !== false) {
    try {
      const [inst] = await query(
        `SELECT i.id, i.pledge_id FROM pledge_installments i
           JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
          WHERE i.org_id=? AND p.donor_id=? AND i.paid_gift_id IS NULL
            AND p.status='open' AND round(i.amount::numeric * 100)::bigint = ?
          ORDER BY i.due_date ASC, i.seq ASC LIMIT 1`,
        [orgId, o.donorId, Math.round(amount * 100)]).catch(() => []);
      if (inst) {
        const upd = await query(
          `UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW()
            WHERE id=? AND org_id=? AND paid_gift_id IS NULL RETURNING id`, [giftId, inst.id, orgId]);
        if (upd.length) {
          await run("UPDATE gifts SET pledge_id=COALESCE(pledge_id,?), type=CASE WHEN type='cash' THEN 'pledge payment' ELSE type END WHERE id=?", [inst.pledge_id, giftId]);
          appliedInstallment = { installmentId: inst.id, pledgeId: inst.pledge_id };
          await recalcPledgePayment(inst.pledge_id, orgId).catch(e => console.error("[pledge] recalc:", e.message));
          await onPledgeSettled(orgId, inst.pledge_id).catch(e => console.error("[pledge] settle:", e.message));
        }
      }
    } catch (e) { console.error("[pledge] instalment auto-apply:", e.message); }
  } else if (o.pledgeId) {
    await onPledgeSettled(orgId, o.pledgeId).catch(e => console.error("[pledge] settle:", e.message));
  }

  // ── BUILD-101 Part 2 — A PAYMENT THAT IS A MEMBERSHIP RENEWAL ─────────────
  // From every door, for the same reason as the instalment above: a gift of
  // exactly the level's price from someone whose membership is due IS the
  // renewal. Not for a payment that already said what it bought (an explicit
  // membership or ticket carries its own quid pro quo) or one that just paid
  // an instalment.
  let appliedMembership = null;
  if (o.membershipRenewal !== false && !appliedInstallment && o.quidProQuoValue == null && !o.recurring) {
    appliedMembership = await applyGiftAsMembershipRenewal({ orgId, donorId: o.donorId, giftId, amount, actorId, actorName })
      .catch(e => { console.error("[membership] renewal auto-apply:", e.message); return null; });
  }

  // ── BUILD-88b B.3 — THE THANK-YOU IS DRAFTED, NEVER SENT ──────────────────
  // Every gift through this path earns a draft in her queue. The exclusions are
  // the ones that would make a thank-you wrong rather than merely unnecessary.
  //
  // AFTER the instalment apply, on purpose: the small-pledge-payment exclusion
  // reads the gift's TYPE, and a gift that arrives as "cash" and is recognised
  // as an instalment a line later is a pledge payment. Queueing first meant the
  // floor never applied to the very payments it exists for.
  if (o.thankYou !== false) {
    await queueThankYouDraft(orgId, { giftId, donorId: o.donorId, cents: Math.round(amount * 100),
                                      fundId, type: appliedInstallment ? "pledge payment" : (o.type || "cash") })
      .catch(e => console.error("[thank-you] draft:", e.message));
  }

  // ── BUILD-94 Part 3 — THE TRIGGERS FIRE HERE, AND NOWHERE ELSE ───────────
  // FIRST GIFT EVER is a fact about the rollup that just happened: gift_count
  // reached 1. Reading it here, from the row the rollup wrote, is the only
  // place it is unambiguous — a route that checks "is this their first gift"
  // before the rollup races itself. ENROLLMENT IS NEVER RETROACTIVE, and this
  // is what that means mechanically: the only way in is the event itself.
  try {
    const [after] = await query(
      `SELECT gift_count, stripe_subscription_status FROM donors WHERE id = ? AND org_id = ?`, [o.donorId, orgId]);
    if (after && Number(after.gift_count) === 1) {
      const ctx = { amount, recurring: !!o.recurring || !!after.stripe_subscription_status,
                    fund: o.fundName || null, source: o.source || null };
      await enrollInSequences(orgId, o.donorId, "first_gift", ctx);
    }
    if (o.recurring === true && after) {
      const [priorRec] = await query(
        `SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=? AND id <> ?
           AND (notes ILIKE '%recurring%' OR type = 'recurring')`, [orgId, o.donorId, giftId]);
      if (!priorRec || priorRec.n === 0) {
        await enrollInSequences(orgId, o.donorId, "first_recurring",
          { amount, recurring: true, fund: o.fundName || null, source: o.source || null });
      }
    }
  } catch (e) { console.error("[seq] gift trigger:", e.message); }


  // BUILD-98 Part 1 — soft credits, a tribute, an expected match. Checked by
  // the caller BEFORE the gift was written (checkGiftExtras); written here so
  // every door that passes them lands them the same way.
  let extras = null;
  if (o.extras) {
    try { extras = await writeGiftExtras(orgId, gift, o.extras, { actorId, actorName }); }
    catch (e) { console.error("[gift] extras:", e.message); }
  }

  return { gift, duplicate: false, interactionId, fundId, paymentMethod, posted, appliedInstallment, appliedMembership, extras };
}

// ── BUILD-98 Part 1 — SOFT CREDITS, TRIBUTES, MATCHES ──────────────────────
// shared/giftCredit.js holds the rule; these are its only writers. Every id a
// caller names is checked against THIS org before anything is written, and a
// gift's extras are checked BEFORE the gift is written, so a refused soft
// credit refuses the gift rather than leaving half of it behind.
let GC = null;
const GC_READY = import("./shared/giftCredit.js").then(m => { GC = m; return m; });

async function orgDonorIds(orgId, ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return new Set();
  const rows = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND id = ANY(?)", [orgId, list]);
  return new Set(rows.map(r => r.id));
}

// Checks a gift's extras against the org and the amount. Returns the normalised
// extras, or the reasons (400) / the foreign ids (404, never planted).
async function checkGiftExtras(orgId, hardDonorId, giftCents, raw = {}) {
  await GC_READY;
  const out = { softCredits: [], tribute: null, match: null };
  const errors = [];
  const soft = Array.isArray(raw.softCredits) ? raw.softCredits : [];
  const trib = raw.tribute && typeof raw.tribute === "object" ? raw.tribute : null;
  const match = raw.match && typeof raw.match === "object" ? raw.match : null;
  const named = [...soft.map(s => s?.donorId), trib?.donorId, match?.employerId].filter(Boolean);
  const owned = await orgDonorIds(orgId, named);
  const foreign = named.filter(id => !owned.has(String(id)));
  if (foreign.length) return { notFound: true };
  if (soft.length) {
    const v = GC.validateSoftCredits(giftCents, hardDonorId, soft);
    if (!v.ok) errors.push(...v.errors); else out.softCredits = v.rows;
  }
  if (trib) {
    const type = GC.TRIBUTE_TYPES.includes(trib.type) ? trib.type : GC.normaliseTributeType(trib.type);
    const name = String(trib.name || "").trim().slice(0, 200);
    if (!type) errors.push("a tribute is in honour of someone or in memory of someone");
    else if (!trib.donorId && !name) errors.push("a tribute names the person it honours");
    else out.tribute = {
      type, donorId: trib.donorId ? String(trib.donorId) : null, name,
      notifyName: String(trib.notifyName || "").trim().slice(0, 200) || null,
      notifyEmail: String(trib.notifyEmail || "").trim().slice(0, 200) || null,
      notifyAddress: String(trib.notifyAddress || "").trim().slice(0, 500) || null,
    };
  }
  if (match) {
    if (!match.employerId) errors.push("a match names the employer");
    else if (String(match.employerId) === hardDonorId) errors.push("a person cannot match their own gift");
    else {
      const c = GC.expectedMatchCents(giftCents, match);
      if (c.error) errors.push(c.error);
      else out.match = { employerId: String(match.employerId), cents: c.cents, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(match.dueDate || "") ? match.dueDate : null };
    }
  }
  return errors.length ? { errors } : { extras: out };
}

// Writes the extras for a gift that now exists. Idempotent per gift: soft
// credits are REPLACED as a set, a tribute notice is one per gift, a match
// pledge is one per gift (uq_pledges_matches_gift).
async function writeGiftExtras(orgId, gift, extras, { actorId = null, actorName = null } = {}) {
  await GC_READY;
  const result = { softCredits: 0, tributeNotice: null, matchPledgeId: null };
  if (!gift || !extras) return result;
  if (Array.isArray(extras.softCredits)) {
    await run("DELETE FROM gift_soft_credits WHERE gift_id=? AND org_id=?", [gift.id, orgId]);
    for (const s of extras.softCredits) {
      await run(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,pct,role,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id, donor_id) DO NOTHING`,
        ["gsc_" + uuid().slice(0, 10), orgId, gift.id, s.donorId, s.cents / 100, s.pct, s.role, actorId, actorName]);
      result.softCredits++;
    }
  }
  if (extras.tribute) {
    const t = extras.tribute;
    let honouree = t.name;
    if (t.donorId) {
      const [h] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [t.donorId, orgId]);
      honouree = h?.name || honouree;
    }
    await run("UPDATE gifts SET tribute_type=?, tribute_donor_id=?, tribute_name=? WHERE id=? AND org_id=?",
      [t.type, t.donorId, honouree, gift.id, orgId]);
    // The family gets a notice only when somebody named who to tell. It is a
    // DRAFT: Steward never sends a letter to a grieving family.
    if (t.notifyName || t.notifyEmail || t.notifyAddress) {
      const [donor] = await query("SELECT name, kind FROM donors WHERE id=? AND org_id=?", [gift.donor_id, orgId]);
      const [org] = await query("SELECT name, receipt_signature_name FROM orgs WHERE id=?", [orgId]);
      const orgName = await donorFacingOrgName(orgId, org?.name || "").catch(() => org?.name || "");
      const body = GC.tributeNoticeBody({
        notifyName: t.notifyName, donorName: donor?.kind === "anonymous" ? null : donor?.name,
        honoureeName: honouree, type: t.type, orgName, signer: org?.receipt_signature_name || null,
      });
      const id = "tn_" + uuid().slice(0, 10);
      const ins = await query(
        `INSERT INTO tribute_notices (id,org_id,gift_id,donor_id,tribute_type,honouree_name,notify_name,notify_email,notify_address,body,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (gift_id) DO UPDATE SET tribute_type=EXCLUDED.tribute_type, honouree_name=EXCLUDED.honouree_name,
           notify_name=EXCLUDED.notify_name, notify_email=EXCLUDED.notify_email, notify_address=EXCLUDED.notify_address,
           body=EXCLUDED.body WHERE tribute_notices.status='waiting'
         RETURNING id`,
        [id, orgId, gift.id, gift.donor_id, t.type, honouree, t.notifyName, t.notifyEmail, t.notifyAddress, body, actorId, actorName]);
      result.tributeNotice = ins[0]?.id || null;
    }
  }
  if (extras.match) {
    const m = extras.match;
    const due = m.dueDate || orgTime.addDays(String(gift.date).slice(0, 10), 90);
    const pid = "pl_" + uuid().slice(0, 8);
    const ins = await query(
      `INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,notes,is_match,matches_gift_id,created_by,created_by_name)
       VALUES (?,?,?,?,?,'open',?,true,?,?,?) ON CONFLICT (matches_gift_id) WHERE matches_gift_id IS NOT NULL DO NOTHING RETURNING id`,
      [pid, orgId, m.employerId, m.cents / 100, due, "Expected matching gift", gift.id, actorId, actorName]);
    if (ins.length) {
      // One instalment for the whole match, so the existing rule in recordGift
      // applies the employer's cheque to it from any door, to the cent.
      await run(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES (?,?,?,1,?,?)`,
        ["pi_" + uuid().slice(0, 8), orgId, pid, due, m.cents / 100]);
      await run("UPDATE gifts SET match_employer_id=?, match_pledge_id=? WHERE id=? AND org_id=?", [m.employerId, pid, gift.id, orgId]);
      result.matchPledgeId = pid;
      // The match may ALREADY be here — an import carries the employee's gift
      // and the company's cheque in the same file, or staff record the match
      // after the fact. An employer gift for exactly the expected amount, on or
      // after this gift, not already paying another pledge, is that match.
      const [already] = await query(
        `SELECT id FROM gifts WHERE org_id=? AND donor_id=? AND pledge_id IS NULL
           AND round(amount::numeric * 100)::bigint = ? AND date >= ? ORDER BY date ASC, id LIMIT 1`,
        [orgId, m.employerId, m.cents, String(gift.date).slice(0, 10)]);
      if (already) {
        await run("UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW() WHERE pledge_id=? AND org_id=? AND paid_gift_id IS NULL", [already.id, pid, orgId]);
        await run("UPDATE gifts SET pledge_id=? WHERE id=? AND org_id=?", [pid, already.id, orgId]);
        await recalcPledgePayment(pid, orgId).catch(e => console.error("[match] recalc:", e.message));
        result.matchAlreadyReceived = already.id;
      }
    } else {
      const [existing] = await query("SELECT id FROM pledges WHERE matches_gift_id=? AND org_id=?", [gift.id, orgId]);
      result.matchPledgeId = existing?.id || null;
    }
  }
  return result;
}

// One donor's credit: hard is the gift rows, soft is the rows pointing at
// other people's gifts. The second is never added into the first anywhere
// except on the line that says it is "with soft credit".
async function donorCreditTotals(orgId, donorId) {
  const [[h], [s]] = await Promise.all([
    query("SELECT COALESCE(SUM(amount),0)::numeric AS t, COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=?", [orgId, donorId]),
    query(`SELECT COALESCE(SUM(sc.amount),0)::numeric AS t, COUNT(*)::int AS n FROM gift_soft_credits sc
             JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
            WHERE sc.org_id=? AND sc.donor_id=?`, [orgId, donorId]),
  ]);
  const hardCents = Math.round(Number(h?.t || 0) * 100);
  const softCents = Math.round(Number(s?.t || 0) * 100);
  return { ...GC.creditTotals(hardCents, softCents), hardCount: h?.n || 0, softCount: s?.n || 0 };
}


// ---- BUILD-89S 89a - GIVING SOURCES: THE RUNNER --------------------------
//
// "Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a
// dollar." Everything below is downstream of that sentence.
//
// syncSource() takes the rows an adapter returns and writes every one of them
// through recordGift - the A.1 path, never a second INSERT. That is not
// tidiness: the fund rule, the payment-method rule, the ledger rule, the
// instalment match, the thank-you draft and the actor stamp all live in
// recordGift, and a gift that arrived from PayPal is a gift.
//
// THE RULES, AND WHY EACH ONE IS THE WAY IT IS
//
// DE-DUPLICATION is on provider + the provider's own id, org-scoped, through
// the `external_id` unique index recordGift already honours. Namespaced
// ("paypal:8XN...") so the PayPal CSV a bookkeeper uploads (89d) and the
// PayPal API reading the same transaction land on ONE gift, and so two
// providers reusing a short numeric id can never collide. Running a sync
// twice writes nothing the second time, and that is asserted, not assumed.
//
// DONOR MATCH is exact email, or a new donor. It is NEVER a name match: a
// guessed merge is a lost donor. A name that matches somebody already on file
// with a different or missing email lands on a NEW person and is REPORTED -
// the pair surfaces in /donors/duplicates, which is the one-tap merge that
// already exists, and the run summary says how many there were so nobody has
// to go looking. One tap, never zero, and never none.
//
// FUND is the source's default if an admin set one, otherwise nothing -
// `defaultFund: false`, which is recordGift's donor-initiated case. A memo
// reading "building fund" is not a designation; a designation is an
// accounting fact somebody at the organisation is accountable for.
//
// FEES: the gift is the GROSS. The donor gave the gross. The fee is stored
// beside it and never shows as the gift amount.
//
// THE LEDGER follows BUILD-83: the FIRST read of a source is import history
// and never posts. Everything after it is a live gift and posts if the org
// keeps posting on. `backfilled_at` on the source row is the whole mechanism.
//
// ONLY MONEY IN. Transfers to the bank, payouts, fees billed as their own
// line, purchases: dropped at the adapter and again at normalizeRow, which
// refuses a non-positive amount. No part of this runner knows what a payout
// is.
//
// REFUNDS ARE NOT REVERSED IN THIS BUILD, ON PURPOSE. 89a's brief says to use
// whatever refund path exists today and, if there is none, to skip the row,
// count it and say so rather than invent refund accounting. What exists today
// is the Stripe webhook's inline full-refund branch, and it DELETES the gift -
// which on this path would be actively wrong: the provider still returns the
// original payment as a completed row, so the next sync would re-create the
// gift it had just deleted, forever. So:
//   - a row that arrives ALREADY refunded is not written at all (money that
//     came in and went back out is not a gift), and is counted;
//   - a row that reads refunded and whose gift IS already on file is counted
//     and NAMED on the run summary, so a human is told exactly which gift to
//     look at rather than a number being silently wrong.
// Named for its own build at the time.
const SOURCE_SYNC_MAX_PAGES = 400;
const SOURCE_SYNC_RESYNC_DAYS = 3;   // providers publish late; re-read and let dedupe work
const SYS_SOURCE = { id: "system:giving-source", name: "Connected giving source" };

async function givingSourcesMod() { return import("./shared/givingSources.js"); }

function sourceConfig(source) {
  const v = source && source.config;
  if (!v) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}
async function secretBoxMod() { return import("./shared/secretBox.js"); }

// The credentials for one source, opened and bound to its org. A blob that
// will not open is a hard stop, never an empty object: continuing with no
// credentials would call a provider unauthenticated and report "no gifts
// found", which reads like a quiet morning rather than a broken connection.
async function openSourceCredentials(source) {
  if (!source.credentials_sealed) return {};
  const { openBag } = await secretBoxMod();
  return openBag(source.credentials_sealed, { aad: source.org_id });
}

function firstNameOfDonor(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// A MISSED RECURRING PAYMENT BECOMES A PERSON'S JOB.
// Same shape and the same reasoning as openSustainerLapseThread (the dunning
// path): a donor, an open next step, a due date, owned by whoever owns the
// donor, ranked by threadRank like everything else. The person-surface gate is
// the same one - a sample, deceased, do-not-contact or non-person record never
// gets one.
async function openMissedRecurringThread(orgId, donorId, { amountCents, provider, expectedNext, interval = "month", day = null }) {
  try {
    const [d] = await query(
      `SELECT id, name, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = day || orgToday(org);                       // ORG_TZ_SEAM_OK
    const { sanitizeStepLabel } = await threadShapeMod();
    const { missedPhrase } = await givingSourcesMod();
    const label = sanitizeStepLabel(missedPhrase({
      firstName: firstNameOfDonor(d.name), amountCents, provider, expectedNext, interval,
    })) || "Check on their recurring gift";
    // Due TODAY. By the time this fires the payment is already five days past
    // the date it was expected; a +N-day default would be the product
    // hesitating twice about the same fact.
    return await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: "follow_up", label, due: today },
      openedOn: today,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));
  } catch (e) { console.error("[giving-source] missed thread:", e.message); return null; }
}

// RECOGNISING A COMMITMENT.
// Runs over the donors a sync actually touched, never the whole org: the
// pattern can only have changed for somebody who just received a gift.
async function refreshRecurringForDonors(orgId, sourceId, provider, donorIds, today) {
  if (!donorIds.length) return { created: 0, updated: 0 };
  const { detectCommitments } = await givingSourcesMod();
  let created = 0, updated = 0;
  for (const donorId of donorIds) {
    const gifts = await query(
      `SELECT external_id, date, round(amount::numeric * 100)::bigint AS cents, provider_recurring_ref
         FROM gifts
        WHERE org_id=? AND donor_id=? AND giving_source_id=?
        ORDER BY date ASC`, [orgId, donorId, sourceId]);
    const rows = gifts.map(g => ({
      externalId: g.external_id, occurredAt: String(g.date).slice(0, 10),
      amountCents: Number(g.cents), recurringRef: g.provider_recurring_ref || null,
      status: "completed",
    }));
    for (const c of detectCommitments(rows, { today })) {
      // The two identities, matching the two partial unique indexes: a
      // provider-named subscription is identified by its ref; an inferred
      // pattern by the donor and the amount.
      const existing = c.recurringRef
        ? await query(`SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND recurring_ref=?`,
                      [orgId, sourceId, c.recurringRef])
        : await query(`SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND donor_id=? AND amount_cents=? AND recurring_ref IS NULL`,
                      [orgId, sourceId, donorId, c.amountCents]);
      if (existing.length) {
        // A commitment that was 'missed' and has just been paid is active
        // again, and `missed_for` clears so a LATER miss raises a new Thread.
        await run(
          `UPDATE giving_recurring
              SET gift_count=?, first_gift_on=?, last_gift_on=?, expected_next=?,
                  amount_cents=?, status='active',
                  missed_for = CASE WHEN ? > COALESCE(missed_for,'') THEN NULL ELSE missed_for END,
                  updated_at=NOW()
            WHERE id=? AND org_id=?`,
          [c.giftCount, c.firstGiftOn, c.lastGiftOn, c.expectedNext, c.amountCents,
           c.lastGiftOn, existing[0].id, orgId]);
        updated++;
      } else {
        await run(
          `INSERT INTO giving_recurring
             (id,org_id,donor_id,source_id,provider,amount_cents,interval,confidence,recurring_ref,
              gift_count,first_gift_on,last_gift_on,expected_next,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active')
           ON CONFLICT DO NOTHING`,
          ["gr_" + uuid().slice(0, 10), orgId, donorId, sourceId, provider, c.amountCents,
           c.interval, c.confidence, c.recurringRef, c.giftCount, c.firstGiftOn, c.lastGiftOn, c.expectedNext]);
        created++;
      }
    }
  }
  // ---- A LATE PAYMENT STILL SATISFIES THE COMMITMENT ----------------------
  // THE WINDOW DECIDES WHAT BECOMES A COMMITMENT. IT DOES NOT DECIDE WHAT
  // KEEPS ONE.
  //
  // detectCommitments only groups gifts 27 to 34 days apart, which is the
  // right rule for RECOGNISING a monthly donor out of a pile of gifts. It is
  // the wrong rule for maintaining one that is already recognised: a card that
  // soft-declined and retried eight days later lands 39 days after the last
  // gift, falls outside the window, and would leave the commitment frozen on
  // an expected date that has already passed - raising a Thread about a
  // payment that actually arrived, which is the exact failure this whole
  // feature exists to prevent.
  //
  // So once a commitment exists, the next gift of the same amount through the
  // same source satisfies it WHENEVER it lands, and the expectation moves on
  // from there. `missed_for` clears, so a genuinely missed payment next month
  // raises a new Thread.
  for (const donorId of donorIds) {
    const open = await query(
      `SELECT id, amount_cents, recurring_ref, last_gift_on FROM giving_recurring
        WHERE org_id=? AND source_id=? AND donor_id=? AND status <> 'ended'`,
      [orgId, sourceId, donorId]);
    for (const r of open) {
      const [latest] = await query(
        `SELECT MAX(date) AS on_date, COUNT(*)::int AS n FROM gifts
          WHERE org_id=? AND donor_id=? AND giving_source_id=?
            AND round(amount::numeric * 100)::bigint = ?
            AND (?::text IS NULL OR provider_recurring_ref = ?)`,
        [orgId, donorId, sourceId, r.amount_cents, r.recurring_ref, r.recurring_ref]);
      const on = latest?.on_date ? String(latest.on_date).slice(0, 10) : null;
      if (!on || !r.last_gift_on || on <= r.last_gift_on) continue;
      const { addCivilMonths } = await givingSourcesMod();
      await run(
        `UPDATE giving_recurring
            SET last_gift_on=?, expected_next=?, gift_count=?, status='active',
                missed_for=NULL, updated_at=NOW()
          WHERE id=? AND org_id=?`,
        [on, addCivilMonths(on, 1), latest.n, r.id, orgId]);
      updated++;
    }
  }

  return { created, updated };
}

// THE MISSED SWEEP.
// ONE Thread per missed payment, never one per day. `missed_for` stores the
// expected date already raised, so the second pass over the same unpaid month
// finds nothing to do - which is a property of the data, not of how often the
// sweep happens to run.
async function sweepMissedRecurring(orgId, { today = null, sourceId = null } = {}) {
  const { isMissed } = await givingSourcesMod();
  const org = await orgTz(orgId);
  const day = today || orgToday(org);                  // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT r.*, s.display_name, s.status AS source_status
       FROM giving_recurring r
       JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
      WHERE r.org_id=? AND r.status='active' AND r.expected_next IS NOT NULL
        AND (?::text IS NULL OR r.source_id = ?)`,
    [orgId, sourceId, sourceId]);
  let opened = 0;
  for (const r of rows) {
    // A disconnected source stops producing work. She switched it off.
    if (r.source_status === "disconnected") continue;
    if (!isMissed(r.expected_next, day)) continue;
    if (r.missed_for === r.expected_next) continue;    // already raised, exactly once
    const thread = await openMissedRecurringThread(orgId, r.donor_id, {
      amountCents: Number(r.amount_cents), provider: r.provider,
      expectedNext: r.expected_next, interval: r.interval, day,
    });
    // `missed_for` is stamped whether or not a thread was actually opened: the
    // donor may already have an open thread (the one-open-per-donor rule), and
    // re-attempting every six hours forever would be the loop this column
    // exists to prevent.
    await run(`UPDATE giving_recurring SET status='missed', missed_for=?, missed_thread_id=?, updated_at=NOW()
                WHERE id=? AND org_id=?`,
              [r.expected_next, thread?.id || null, r.id, orgId]);
    if (thread) opened++;
  }
  return { opened, considered: rows.length };
}

// THE PROVIDER TOLD US. Stripe reports a failed invoice on a subscription;
// Givebutter reports a plan that failed, was canceled or was paused. Both
// arrive as a `failed` contract row carrying the provider's own recurring
// reference, and both mean the same thing: this is not a payment running late,
// it is a payment that did not happen.
//
// `missed_for` is stamped with the commitment's OWN expected date - the same
// value the ordinary sweep would use - so the two paths can never raise two
// Threads about one missed month.
async function raiseToldFailures(orgId, source, failures, day) {
  let opened = 0;
  for (const f of failures || []) {
    const [r] = await query(
      `SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND recurring_ref=?`,
      [orgId, source.id, f.ref]);
    // Nothing recognised under that reference yet, so there is no commitment
    // to say anything about. A first-ever payment that fails is not a donor
    // who stopped giving.
    if (!r) continue;
    if (r.status === 'ended') continue;
    const key = r.expected_next || f.on || day;
    if (r.missed_for === key) continue;
    const thread = await openMissedRecurringThread(orgId, r.donor_id, {
      amountCents: Number(r.amount_cents) || f.amountCents,
      provider: source.provider, expectedNext: key, interval: r.interval,
    });
    await run(`UPDATE giving_recurring SET status='missed', missed_for=?, missed_thread_id=?, updated_at=NOW()
                WHERE id=? AND org_id=?`, [key, thread?.id || null, r.id, orgId]);
    if (thread) opened++;
  }
  return opened;
}

// syncSource(orgId, sourceId) - the one entry point. Returns a run summary;
// never throws for a provider problem (that becomes `last_error` and a
// sentence a human can act on).
async function syncSource(orgId, sourceId, { today = null, adapter = null, actor = null, reason = "scheduled", fetchImpl = undefined } = {}) {
  const { normalizeRow, externalKey } = await givingSourcesMod();
  const [source] = await query("SELECT * FROM giving_sources WHERE id=? AND org_id=?", [sourceId, orgId]);
  if (!source) return { ok: false, error: "source_not_found" };
  if (source.status === "disconnected") return { ok: false, error: "source_disconnected" };

  const org = await orgTz(orgId);
  const day = today || orgToday(org);                  // ORG_TZ_SEAM_OK
  const actorId = actor?.id || SYS_SOURCE.id, actorName = actor?.name || SYS_SOURCE.name;
  const isBackfill = !source.backfilled_at;
  const summary = {
    sourceId, provider: source.provider, reason, isBackfill,
    rowsRead: 0, giftsCreated: 0, duplicates: 0, donorsCreated: 0,
    centsCreated: 0, feeCents: 0,
    refundsSkipped: 0, refundsOnFile: [], failedSkipped: 0, failedRecurring: [],
    dropped: {}, nameCollisions: [], notices: [],
    // BUILD-92 A3 — two counters, deliberately separate. `duplicateQuestions`
    // is money Steward did NOT write and a human still has to answer for;
    // `ridesOnTop` is money the shortcut resolved without asking. Summing them
    // would hide which of the two happened, which is the only thing that
    // matters when the totals look wrong.
    duplicateQuestions: 0, ridesOnTop: 0,
  };
  const touchedDonors = new Set();

  // Serialized per source: "Check now" pressed during a scheduled run must not
  // double the work. Dedupe makes a double run harmless to the DATA; the lock
  // keeps the counters and the cursor honest.
  return await withAdvisoryLock(`givingsource:${sourceId}`, async () => {
    try {
      const use = adapter || sourceAdapters.getAdapter(source.provider);
      if (!use) throw Object.assign(new Error(`no adapter for ${source.provider}`), { code: "NO_ADAPTER" });
      const credentials = await openSourceCredentials(source);
      const http = sourceAdapters.readOnlyHttp(source.provider, fetchImpl ? { fetchImpl } : {});

      // The window. A backfill walks as far back as the provider allows (the
      // adapter decides how, because only it knows the provider's limit); an
      // incremental sync re-reads the last few days because providers publish
      // late, and lets de-duplication absorb the overlap.
      // ORG_TZ_SEAM_OK — the window start is a CIVIL date in the org's own
      // calendar, read through the one seam. A UTC slice of the last-sync
      // instant would put the boundary on the wrong day for every org west of
      // Greenwich, which is most of them.
      const lastSyncedDay = source.last_synced_at ? orgToday(org, new Date(source.last_synced_at)) : day;
      const since = isBackfill ? null : orgTime.addDays(lastSyncedDay, -SOURCE_SYNC_RESYNC_DAYS);

      let cursor = isBackfill ? null : source.sync_cursor || null;
      let page = 0, done = false;
      while (!done && page < SOURCE_SYNC_MAX_PAGES) {
        // BUILD-95 §5A — `config` is what the ORGANISATION told this source
        // (which Square locations are giving). An adapter that does not need
        // to be told anything ignores it.
        const out = await use.fetchRows({ credentials, since, until: day, cursor, http, today: day,
                                          backfill: isBackfill, config: sourceConfig(source) });
        page++;
        for (const n of out?.notices || []) summary.notices.push(n);
        for (const raw of out?.rows || []) {
          summary.rowsRead++;
          const norm = normalizeRow(raw, { provider: source.provider });
          if (!norm.ok) { summary.dropped[norm.reason] = (summary.dropped[norm.reason] || 0) + 1; continue; }
          await writeSourceRow(orgId, source, norm.row, {
            day, actorId, actorName, isBackfill, summary, touchedDonors, externalKey,
          });
        }
        cursor = out?.cursor ?? null;
        done = out?.done !== false || !cursor;
      }
      if (page >= SOURCE_SYNC_MAX_PAGES) summary.notices.push(`Stopped after ${SOURCE_SYNC_MAX_PAGES} pages; the next check will continue.`);

      const rec = await refreshRecurringForDonors(orgId, sourceId, source.provider, [...touchedDonors], day);
      summary.recurring = rec;
      const swept = await sweepMissedRecurring(orgId, { today: day, sourceId });
      const told = await raiseToldFailures(orgId, source, summary.failedRecurring, day);
      summary.threadsOpened = swept.opened + told;

      const runId = await recordSourceRun(orgId, source, summary, { actorId, actorName, day });
      await run(
        `UPDATE giving_sources
            SET last_synced_at=NOW(), last_tried_at=NOW(), sync_cursor=?, last_error=NULL, last_error_at=NULL,
                last_error_status=NULL, last_error_provider_code=NULL,
                status='active', last_run_id=?, backfilled_at=COALESCE(backfilled_at, NOW()), updated_at=NOW()
          WHERE id=? AND org_id=?`, [cursor, runId, sourceId, orgId]);
      summary.ok = true; summary.runId = runId;
      console.log(`[giving-source] ${source.provider} org=${orgId} read=${summary.rowsRead} new=${summary.giftsCreated} dupes=${summary.duplicates}`);
      return summary;
    } catch (e) {
      // An error reads as a sentence with what to do, never a code - 89f shows
      // this string verbatim on the Settings row.
      const sentence = sourceErrorSentence(e, source);
      // BUILD-92 A2 — the two facts that used to be thrown away land BESIDE
      // the sentence (never replacing it): the HTTP status the provider
      // answered with, and the provider's own error code. They are what an
      // administrator needs when the sentence is not enough, and they are what
      // proves which branch of the auth/permission split actually fired.
      const { kind, status, providerCode } = classifySourceError(e);
      await run(`UPDATE giving_sources
                    SET status='error', last_error=?, last_error_at=NOW(), last_tried_at=NOW(),
                        last_error_status=?, last_error_provider_code=?, updated_at=NOW()
                  WHERE id=? AND org_id=?`,
        [sentence, status, providerCode, sourceId, orgId]).catch(() => {});
      console.error(`[giving-source] ${source.provider} org=${orgId}: ${kind}`,
        { status, providerCode, message: e.message });
      return { ...summary, ok: false, error: e.code || "sync_failed", message: sentence };
    }
  });
}

// ── BUILD-92 A3 — THE SAME GIFT FROM TWO PLACES ────────────────────────────
//
// De-duplication is per source, by the provider's own id, and that is right:
// forty $100 Sunday gifts are forty gifts, and only the provider can say which
// two rows are one payment. But Donorbox runs on the ORGANISATION'S OWN Stripe
// and PayPal. Connect all three and the same money arrives three times, under
// three ids, and every figure in the product trebles.
//
// THE RULE: a row from source B that matches a gift already on file from a
// DIFFERENT source on
//   · the amount, to the cent,
//   · the date, within two days (Cowork's window - a provider settles and
//     reports on its own schedule, and the two rarely land the same day),
//   · and the donor (the same donor record, or the same email address)
// is NOT written. It becomes ONE LINE that asks, with two answers.
//
// It is never silently dropped and never silently doubled. The provider's
// whole row is kept on the question, so "Keep both" can write it later
// without going back to the provider.
//
// CROSS-SOURCE ONLY. Two genuine same-day $50 gifts from one donor inside ONE
// source are two gifts and always were; this rule cannot see them.
const CROSS_SOURCE_DAY_WINDOW = 2;

// Does one of these two sources ride on the other? THE ONE SHORTCUT, per
// source, set by a human who knows their own stack ("Donorbox sits on top of
// Stripe"). Either direction counts: the relationship is about the money
// being the same money, not about which row was typed first.
function sourcesRideTogether(a, b) {
  if (!a || !b) return false;
  return a.sits_on_top_of === b.id || b.sits_on_top_of === a.id;
}

// The gift already on file that this provider row looks like, or null.
// Ordered by how close the dates are, so the nearest candidate is the one a
// human is asked about.
async function findCrossSourceGift(orgId, source, row, donor) {
  const rows = await query(
    `SELECT g.id, g.amount, g.date, g.external_id, g.giving_source_id,
            s.id AS src_id, s.display_name AS src_name, s.provider AS src_provider,
            s.sits_on_top_of AS src_sits_on_top_of
       FROM gifts g
       JOIN giving_sources s ON s.id = g.giving_source_id AND s.org_id = g.org_id
      WHERE g.org_id = ?
        AND g.giving_source_id <> ?
        AND ROUND(g.amount * 100) = ?
        AND g.date::date BETWEEN ?::date - ?::int AND ?::date + ?::int
        AND g.donor_id IN (
              SELECT d.id FROM donors d
               WHERE d.org_id = ? AND d.deleted_at IS NULL
                 AND (d.id = ? OR (COALESCE(d.email,'') <> '' AND LOWER(d.email) = LOWER(?)))
            )
      ORDER BY ABS(g.date::date - ?::date), g.id
      LIMIT 1`,
    [orgId, source.id, row.amountCents,
     row.occurredAt, CROSS_SOURCE_DAY_WINDOW, row.occurredAt, CROSS_SOURCE_DAY_WINDOW,
     // resolveSourceDonor returns { id, name } - the address to match on is the
     // one the PROVIDER reported, which is also the one it resolved the donor
     // by. The sentinel makes the email arm dead rather than matching blanks
     // when a provider row carries no address at all.
     orgId, donor.id, (row.donorEmail || "").trim() || "\u0000no-email",
     row.occurredAt]);
  return rows[0] || null;
}

// The line a human reads. One sentence, the money and the place it already
// came from, because that is what makes the answer obvious.
function crossSourceSentence(amountCents, otherSourceName, otherDate) {
  // money.js is the ONE renderer. A whole-dollar amount drops the ".00" by
  // TRIMMING THE RENDERED STRING - never by rounding the number, which is the
  // fingerprint tests/money-cents.test.js §5 exists to refuse and which caught
  // the first draft of this line.
  const dollars = money.formatCents(amountCents).replace(/\.00$/, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(otherDate || ""));
  const MONTHS = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const when = m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : String(otherDate || "");
  return `Looks like the same ${dollars} gift already here from ${otherSourceName} on ${when}.`;
}

// ONE contract row -> at most one gift, through recordGift.
async function writeSourceRow(orgId, source, row, ctx) {
  const { day, actorId, actorName, isBackfill, summary, touchedDonors, externalKey } = ctx;
  const key = externalKey(source.provider, row.externalId);

  if (row.status === "failed") {
    summary.failedSkipped++;
    // A PROVIDER SAYING A RECURRING PAYMENT DID NOT HAPPEN IS BETTER EVIDENCE
    // THAN THE ABSENCE OF ONE. The five-day grace exists because an absence is
    // ambiguous - the money may simply be late, or published late. A named
    // failure on a named subscription is not ambiguous, so it raises the
    // Thread the same day rather than waiting the grace out. This is also the
    // one channel a stopped Givebutter plan travels down: the contract already
    // had a place for it, so there is no second path to keep in step.
    if (row.recurringRef) {
      summary.failedRecurring.push({ ref: row.recurringRef, on: row.occurredAt, amountCents: row.amountCents });
    }
    return;
  }
  if (row.status === "refunded") {
    // See the refund note at the top of this section. A refund whose gift is
    // already on file is NAMED, not silently miscounted.
    const [onFile] = await query("SELECT id, amount, donor_id FROM gifts WHERE org_id=? AND external_id=?", [orgId, key]);
    if (onFile) {
      const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [onFile.donor_id, orgId]);
      summary.refundsOnFile.push({ giftId: onFile.id, donor: d?.name || "", amount: Number(onFile.amount) || 0 });
    } else summary.refundsSkipped++;
    return;
  }

  // BUILD-92 A3 — a row this org has ALREADY ANSWERED about, or already been
  // asked about, says nothing new. Checked before the donor is resolved so a
  // re-sync of an answered row cannot create a donor record either.
  const [answered] = await query(
    `SELECT id FROM gifts WHERE org_id=? AND also_external_ids @> ?::jsonb LIMIT 1`,
    [orgId, JSON.stringify([key])]);
  if (answered) { summary.duplicates++; return; }
  const [standing] = await query(
    `SELECT id, status FROM gift_duplicate_questions WHERE org_id=? AND external_key=?`, [orgId, key]);
  if (standing && standing.status === "open") { summary.duplicateQuestions++; return; }
  if (standing && standing.status === "same_gift") { summary.duplicates++; return; }

  const donor = await resolveSourceDonor(orgId, source, row, { actorId, actorName, summary });
  if (!donor) { summary.dropped.no_donor_identity = (summary.dropped.no_donor_identity || 0) + 1; return; }
  touchedDonors.add(donor.id);

  // …and only now, with a donor, can the cross-source question be asked.
  // `standing.status === "kept_both"` falls straight through: that gift was
  // written with this external id and recordGift's own dedupe holds it.
  if (!standing) {
    const other = await findCrossSourceGift(orgId, source, row, donor);
    if (other) {
      const otherSource = { id: other.src_id, sits_on_top_of: other.src_sits_on_top_of };
      if (sourcesRideTogether(source, otherSource)) {
        // THE SHORTCUT. Somebody has already said these two are one stack, so
        // the second id goes onto the gift and nobody is asked anything.
        await run(
          `UPDATE gifts SET also_external_ids = COALESCE(also_external_ids, '[]'::jsonb) || ?::jsonb
            WHERE id=? AND org_id=?`, [JSON.stringify([key]), other.id, orgId]);
        summary.ridesOnTop++;
        return;
      }
      const sentence = crossSourceSentence(row.amountCents, other.src_name || other.src_provider, other.date);
      await run(
        `INSERT INTO gift_duplicate_questions
           (id,org_id,source_id,existing_gift_id,existing_source_id,external_key,donor_id,
            amount_cents,occurred_at,sentence,candidate,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?)
         ON CONFLICT (org_id, external_key) DO NOTHING`,
        ["gdq_" + uuid().slice(0, 10), orgId, source.id, other.id, other.src_id, key, donor.id,
         row.amountCents, row.occurredAt, sentence, JSON.stringify(row), actorId, actorName]);
      summary.duplicateQuestions++;
      return;
    }
  }

  const written = await recordGift({
    orgId, donorId: donor.id,
    amount: row.amountCents / 100,                 // the GROSS. Always the gross.
    date: row.occurredAt,
    type: "cash",
    notes: row.memo || "",
    // The source's default fund if an admin set one, otherwise nothing.
    // `defaultFund: false` is recordGift's donor-initiated case: nobody at the
    // organisation has said where this money goes, so it is not designated.
    fundId: source.default_fund_id || null,
    defaultFund: false,
    // The bookkeeper's export shows "PayPal" on the row, which is the point.
    paymentMethod: source.display_name,
    externalId: key,
    conflict: "external",
    givingSourceId: source.id,
    processorFeeAmount: row.feeCents / 100,
    providerRecurringRef: row.recurringRef || null,
    // BUILD-83 - the first read of a source is import history and never posts.
    post: !isBackfill,
    source: `giving-source:${source.provider}`,
    actorId, actorName,
    // A backfill of three years of history does not open three years of
    // thank-you drafts. Live gifts arriving on a later sync do.
    thankYou: !isBackfill,
  });
  if (written.duplicate) { summary.duplicates++; return; }
  summary.giftsCreated++;
  summary.centsCreated += row.amountCents;
  summary.feeCents += row.feeCents;
}

// THE DONOR.
// Exact email attaches. No email match creates. A NAME that matches somebody
// already on file never merges - it lands on a new person and is reported.
async function resolveSourceDonor(orgId, source, row, { actorId, actorName, summary }) {
  const email = (row.donorEmail || "").trim().toLowerCase();
  const name = (row.donorName || "").trim();
  if (!email && !name) return null;

  if (email) {
    const [hit] = await query("SELECT id, name FROM donors WHERE org_id=? AND email ILIKE ? AND deleted_at IS NULL LIMIT 1", [orgId, email]);
    if (hit) return hit;
  }
  // Serialized per (org, email) for the same reason the Stripe webhook is:
  // two parallel syncs seeing the same new donor must not both insert.
  return await withAdvisoryLock(`donor:${orgId}:${email || name.toLowerCase()}`, async () => {
    if (email) {
      const [again] = await query("SELECT id, name FROM donors WHERE org_id=? AND email ILIKE ? AND deleted_at IS NULL LIMIT 1", [orgId, email]);
      if (again) return again;
    }
    // THE COLLISION. Somebody of this name is already on file under a
    // different (or no) email. Steward does NOT merge them - a guessed merge
    // is a lost donor, and two people do share a name. The gift lands on a new
    // record and the pair is reported: it is already a one-tap merge in
    // Donors -> duplicates (the "Same name" tier), and the run summary says
    // how many so nobody has to go looking for it.
    if (name) {
      const [clash] = await query(
        `SELECT id, name, email FROM donors
          WHERE org_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?))
            AND (email IS NULL OR email='' OR NOT (email ILIKE ?)) LIMIT 1`,
        [orgId, name, email || " never"]);
      if (clash) summary.nameCollisions.push({ name, existingDonorId: clash.id, existingEmail: clash.email || null });
    }
    const id = "d_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count, created_by, created_by_name)
       VALUES (?,?,?,?,'active','steward',0,0,?,?)`,
      [id, orgId, name || email, email || null, actorId, actorName]);
    summary.donorsCreated++;
    return { id, name: name || email };
  });
}

// THE RUN LANDS ON THE IMPORTS PAGE, beside the file imports, because from
// where she sits they are the same thing: money arriving with a receipt saying
// where it came from and what it did. shape='source' so the page can tell them
// apart without a second table.
async function recordSourceRun(orgId, source, summary, { actorId, actorName, day }) {
  const { providerLabel } = await givingSourcesMod();
  const id = "imp_" + uuid().slice(0, 10);
  const setAside = summary.failedSkipped + summary.refundsSkipped +
    Object.values(summary.dropped || {}).reduce((a, b) => a + b, 0);
  await run(
    `INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,committed_at,
                          rows_in,gifts_created,donors_created,donors_merged,rows_set_aside,rows_errored,
                          dollars_in,dollars_created,actor_user_id,actor_user_name,summary_json)
     VALUES (?,?,?,?,'source',NOW(),NOW(),?,?,?,0,?,0,?,?,?,?,?)`,
    [id, orgId, `${providerLabel(source.provider)} - checked ${day}`, null,
     summary.rowsRead, summary.giftsCreated, summary.donorsCreated, setAside,
     summary.centsCreated / 100, summary.centsCreated / 100,
     actorId, actorName, JSON.stringify(summary)]);
  return id;
}

// An error a human can act on. Never a code, never a stack, and never
// "something went wrong" - she needs to know whether to wait, to re-paste a
// key, or to call somebody.
//
// BUILD-92 A2 — AUTHENTICATION AND PERMISSION ARE DIFFERENT PROBLEMS.
// Found 20 September: Jonathan connected his own PayPal, the token step
// answered 401 `invalid_client`, and the screen said "Steward could not finish
// reading this source. The next check will try again." — which is the sentence
// for a blip. He was told to wait for something that was never going to happen.
//
// The cause was that this function tested `/401|403|unauthor|invalid_client|
// permission/` against the MESSAGE ONLY, and the message was "PayPal refused
// the credentials: Client Authentication failed", which contains none of those
// tokens. `e.status` was 401 and sitting right there unused.
//
// So the STEP is now declared by the adapter at the moment it knows it
// (sources/*.js attach `step: "auth" | "permission" | "read"`), because the
// adapter is the only place that knows whether a call was the token step or
// the reporting call. Prose matching survives as the FALLBACK for errors
// Steward does not control — but it can no longer be the thing that decides.
//
// `classifySourceError` is exported to the suite so the split can be tested
// without a provider.
function classifySourceError(e) {
  const code = e?.code || "";
  const status = Number(e?.status) || null;
  const msg = String(e?.message || "");
  const providerCode = e?.providerCode || e?.stripeCode || null;
  if (code) return { kind: code, status, providerCode };
  // 1. What the adapter declared. Always believed over prose.
  if (e?.step === "auth") return { kind: "auth", status, providerCode };
  if (e?.step === "permission") return { kind: "permission", status, providerCode };
  // 2. Then the status, which is a fact even when the prose is not.
  if (status === 401) return { kind: "auth", status, providerCode };
  if (status === 403) return { kind: "permission", status, providerCode };
  if (status === 429) return { kind: "rate", status, providerCode };
  // 3. Prose last, for anything thrown by code Steward does not own.
  if (/invalid_client|client authentication failed|refused the credentials|unauthoriz|invalid api key|invalid key/i.test(msg))
    return { kind: "auth", status, providerCode };
  if (/permission|forbidden|not allowed|insufficient/i.test(msg))
    return { kind: "permission", status, providerCode };
  if (/429|rate limit/i.test(msg)) return { kind: "rate", status, providerCode };
  if (/timeout|abort|ENOTFOUND|ECONN/i.test(msg)) return { kind: "unreachable", status, providerCode };
  return { kind: "unknown", status, providerCode };
}

// The sentence for a refused CREDENTIAL, per provider. It names the exact
// fields the person pasted, because "the key was refused" leaves them looking
// at four boxes wondering which one. Kept in the voice of PROVIDERS[].help.
const SOURCE_AUTH_SENTENCE = {
  paypal: "PayPal did not accept this Client ID and Secret. Copy them again from your PayPal app and make sure the app is on Live.",
  zeffy: "Zeffy did not accept this API key. Copy it again from Settings, then Integrations, then API.",
  stripe: "Stripe did not accept this restricted key. Copy it again from Developers, then API keys, and make sure it has not been rolled.",
  givebutter: "Givebutter did not accept this API key. Copy it again from Account, then Integrations, then API.",
};
// The sentence for a key that IS the right key but has not been allowed yet.
// PayPal's is the only one that can honestly promise a delay: Transaction
// Search really is a switch that takes time to come into effect.
const SOURCE_PERMISSION_SENTENCE = {
  paypal: "PayPal has not allowed this yet. A newly enabled Transaction Search permission can take up to a day. Steward will keep trying.",
  zeffy: "Zeffy accepted this key but has not allowed it to read payments. Ask a Zeffy administrator to give the key payment access.",
  stripe: "Stripe accepted this key but it does not have permission to read charges. Edit the restricted key and give it read access to Charges, Subscriptions, Invoices and Customers.",
  givebutter: "Givebutter accepted this key but has not allowed it to read transactions. Check the key's permissions in Account, then Integrations, then API.",
};

function sourceErrorSentence(e, source) {
  const provider = source?.provider || "";
  const { kind } = classifySourceError(e);
  if (kind === "CREDENTIAL_KEY_MISSING") return "Steward cannot open the stored credentials for this source. Nothing was read and nothing was changed, and this needs an administrator.";
  if (kind === "SEALED_OPEN_FAILED") return "The saved key for this source could not be read. Disconnect it and connect it again with a fresh key.";
  if (kind === "NO_ADAPTER") return `Steward does not read ${source?.display_name || provider} automatically yet.`;
  if (kind === "PROVIDER_WRITE_REFUSED") return "Steward stopped a request that was not a read. Nothing was sent. This is a bug in Steward, not a problem with your account.";
  if (kind === "auth") {
    return SOURCE_AUTH_SENTENCE[provider]
      || "The key for this source was refused. Check it is still active in the provider's settings, then paste it again.";
  }
  if (kind === "permission") {
    return SOURCE_PERMISSION_SENTENCE[provider]
      || "The provider accepted this key but has not allowed it to read yet. Check the key's permissions in the provider's settings.";
  }
  if (kind === "rate") return "The provider asked Steward to slow down. The next check will pick up where this one stopped.";
  if (kind === "unreachable") return "Steward could not reach the provider. The next check will try again.";
  return "Steward could not finish reading this source. The next check will try again.";
}

// ── BUILD-88b B.3 — THE THANK-YOU QUEUE ───────────────────────────────────
// Every gift through the one path earns a DRAFT. Steward never sends it: it
// writes one, she opens it, copies it, and it leaves from her own mail where
// she can read it as the donor will.
//
// FOUR EXCLUSIONS, and each is a case where a thank-you would be WRONG rather
// than merely unnecessary:
//   · a pledge payment under $100 — she thanked them for the pledge; thanking
//     them again every month for the instalment is a receipt pretending to be
//     a letter. A LARGE instalment still earns one.
//   · anonymous — there is nobody to write to, and guessing is worse.
//   · do-not-contact, and deceased — the no-ask family. A thank-you is outbound
//     mail, and the flags exist so nobody has to remember.
//   · a sample donor — demo fiction never generates work.
// Receipts are untouched: a §170 acknowledgment is a legal document on its own
// path, and this is a letter.
const THANK_YOU_PLEDGE_FLOOR_CENTS = 10000;

async function queueThankYouDraft(orgId, { giftId, donorId, cents, fundId = null, type = "cash", reason = "gift", force = false, replace = false }) {
  const [d] = await query(
    `SELECT id, name, kind, deceased, do_not_contact, is_sample FROM donors
      WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return null;
  if (d.is_sample) return null;
  if (d.deceased || d.do_not_contact) return null;
  if (d.kind === "anonymous") return null;
  if (!force && /pledge payment/i.test(String(type)) && (cents || 0) < THANK_YOU_PLEDGE_FLOOR_CENTS) return null;

  const [org] = await query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const [fund] = fundId ? await query("SELECT name FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]) : [];
  const draftMod = await import("./shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  const draft = reason === "pledge_completed"
    ? (() => { const t = draftMod.thankYouDraft({ donorName: d.name, giftCents: cents, fundName: fund?.name || null, orgName: org?.name, voice });
               return { ...t, body: t.body.replace("Thank you for your gift of", "Thank you for finishing your pledge of") }; })()
    : draftMod.thankYouDraft({ donorName: d.name, giftCents: cents, fundName: fund?.name || null, orgName: org?.name, voice });
  // ONE DRAFT PER GIFT. `replace` is for the one case where Steward has a
  // better thing to say about a gift it has already drafted (a final pledge
  // payment that COMPLETED the pledge) — and it never overwrites a letter she
  // has already sent or deliberately skipped.
  const conflict = replace
    ? `ON CONFLICT (org_id, gift_id) DO UPDATE SET body=EXCLUDED.body, voice=EXCLUDED.voice
        WHERE thank_you_drafts.sent_at IS NULL AND thank_you_drafts.skipped_at IS NULL`
    : "ON CONFLICT (org_id, gift_id) DO NOTHING";
  const rows = await query(
    `INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice)
     VALUES (?,?,?,?,?,?) ${conflict} RETURNING id`,
    ["ty_" + uuid().slice(0, 10), orgId, donorId, giftId, draft.body, draft.voice]);
  return rows[0] ? { id: rows[0].id, voice: draft.voice } : null;
}

// ── BUILD-88b B.2 — THIRTY DAYS PAST DUE ──────────────────────────────────
// An instalment thirty days past due with no payment opens EXACTLY ONE thread
// on the donor, with the step "Pledge instalment reminder" and a note already
// written in her voice. The thirty days is the point: a fortnight is the post,
// and chasing a donor who has already said yes is how a yes becomes a last gift.
//
// FOUR THINGS THIS DOES NOT DO, each for a reason:
//   · it never opens a SECOND thread on a donor who already has one open (the
//     `threads_one_open` index makes that structural, not a check);
//   · it never touches a deceased or do-not-contact donor;
//   · a SHELL pledge (BUILD-88a A.7, inferred from payments) has no schedule
//     and NEVER goes late — it is unfinished, not overdue, and it says which
//     part is missing;
//   · it sends nothing. The draft waits on the thread.
async function processPledgeInstallmentReminders(opts = {}) {
  const out = { opened: 0, skipped: 0, orgs: 0, rows: [] };
  const orgs = opts.orgId
    ? await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE id=?", [opts.orgId])
    : await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE onboarding_complete=1", []);
  const draftMod = await import("./shared/draftNote.js");
  for (const org of orgs) {
    out.orgs++;
    const today = opts.today || orgToday(org);                    // ORG_TZ_SEAM_OK
    const cutoff = orgTime.addDays(today, -draftMod.PLEDGE_LATE_DAYS);
    const late = await query(
      `SELECT i.id, i.pledge_id, i.due_date, i.amount, p.donor_id, p.amount AS pledge_amount,
              d.name AS donor_name, d.assigned_to, d.assigned_to_name,
              COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.pledge_id = p.id), 0) AS paid
         FROM pledge_installments i
         JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE i.org_id = ? AND i.paid_gift_id IS NULL AND i.due_date <= ?
          AND i.reminder_thread_id IS NULL
          AND p.status = 'open' AND COALESCE(p.is_shell,false) = false AND COALESCE(p.is_match,false) = false
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
          AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE
          AND d.do_not_solicit IS NOT TRUE
          AND (d.kind IS NULL OR d.kind = 'person')
        ORDER BY i.due_date ASC`,
      [org.id, cutoff]);
    const samples = Array.isArray(org.voice_samples) ? org.voice_samples
      : (typeof org.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
    const voice = draftMod.voiceFrom(samples);
    const seenDonor = new Set();
    for (const i of late) {
      // ONE per donor per sweep, before the database is even asked: two late
      // instalments on one pledge are one conversation.
      if (seenDonor.has(i.donor_id)) { out.skipped++; continue; }
      seenDonor.add(i.donor_id);
      const instCents = money.toCents(i.amount) ?? 0;
      const draft = draftMod.pledgeReminderDraft({
        donorName: i.donor_name, installmentCents: instCents, dueDate: i.due_date,
        pledgeCents: money.toCents(i.pledge_amount) ?? null, paidCents: money.toCents(i.paid) ?? 0,
        orgName: org.name, voice,
      });
      const thread = await withTransaction(client => openThreadTx(client, {
        orgId: org.id, donorId: i.donor_id,
        step: { type: draftMod.PLEDGE_REMINDER_STEP.type, label: draftMod.PLEDGE_REMINDER_STEP.label, due: today },
        openedOn: today, ownerId: i.assigned_to || null, ownerName: i.assigned_to_name || null,
        actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
      }));
      if (!thread) { out.skipped++; continue; }   // a thread is already open on this donor
      await run("UPDATE threads SET draft_note=? WHERE id=?", [draft.body, thread.id]);
      await run("UPDATE pledge_installments SET reminder_thread_id=? WHERE id=? AND org_id=?", [thread.id, i.id, org.id]);
      out.opened++;
      out.rows.push({ orgId: org.id, donorId: i.donor_id, installmentId: i.id, threadId: thread.id, dueDate: i.due_date });
    }
  }
  return out;
}
app.use(require("./routes/crm").routers.r0);

// ── BUILD-88b B.2 — A FULLY PAID PLEDGE CLOSES ITSELF ─────────────────────
// `recalcPledgePayment` already decides fulfilment from the payment total (the
// BUILD-72 rule: status is DERIVED, never an independent flag). This is what
// happens next: the donor finished what they promised, which is the single best
// moment to say thank you, and nobody was telling her.
async function onPledgeSettled(orgId, pledgeId) {
  const [p] = await query("SELECT id, donor_id, amount, status FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!p || p.status !== "fulfilled") return null;
  // Its open instalments close with it: a pledge that is paid cannot be late.
  await run(`UPDATE pledge_installments SET paid_at=COALESCE(paid_at, NOW())
              WHERE org_id=? AND pledge_id=? AND paid_gift_id IS NULL
                AND EXISTS (SELECT 1 FROM pledges q WHERE q.id=? AND q.status='fulfilled')`,
    [orgId, pledgeId, pledgeId]);
  const [last] = await query(
    "SELECT id FROM gifts WHERE org_id=? AND pledge_id=? ORDER BY date DESC, id DESC LIMIT 1", [orgId, pledgeId]);
  if (!last) return null;
  // ONE DRAFT PER GIFT is the queue's rule, so this does not add a second
  // letter — it REPLACES the one the final payment already earned with the
  // better thing to say. She sends one letter, and it is about the promise
  // they finished rather than the last instalment of it.
  const upgraded = await queueThankYouDraft(orgId, { giftId: last.id, donorId: p.donor_id,
    cents: money.toCents(p.amount) ?? 0, fundId: null, type: "pledge completed",
    reason: "pledge_completed", force: true, replace: true }).catch(() => null);
  return { pledgeId, closed: true, thankYou: upgraded?.id || null };
}

app.get("/health", (req, res) => {
  // billing.ok is the cached mode-consistency result (booleans/mode only — no
  // secrets): true = all configured prices resolve under the billing key's mode,
  // false = a test/live mismatch (loud warning already logged), null = not yet
  // checked or nothing to check. Full detail is at /admin/billing-diagnostic.
  // publicUrl: the resolved base every outbound email link uses (non-secret).
  // fromEnv:false means FRONTEND_URL is unset or was rejected as a deployment
  // host and links are riding the canonical fallback — post-deploy this is the
  // one-glance check that reset/invite links carry stewardapp.dev.
  const pu = resolvePublicAppUrl();
  res.json({
    // product + database are the IDENTITY guard: a write script asserts both
    // against what it intended before writing, so it can never write to a
    // different product or database that merely shares a loopback host/port.
    product: PRODUCT_ID, database: DB_NAME,
    status: "ok", version: "1.1.0", buildSha: BUILD_SHA, db: dbReady, sentry: !!process.env.SENTRY_DSN,
    billing: { mode: billingModeStatus.mode, ok: billingModeStatus.ok, checked: billingModeStatus.checked },
    publicUrl: { url: pu.url, fromEnv: pu.fromEnv },
    // BUILD-45 (F-2): non-secret count of internal notifications the email
    // provider rejected and that are pending retry (or exhausted). A non-zero
    // value that stays high = a delivery problem to look at — this figure is
    // the SURFACING that F-2 was missing. Cached (refreshed by the retry sweep),
    // so /health stays a cheap synchronous check.
    notifications: { failedPending: notifyFailedPending },
    // BUILD-58 W-3: how many times a ledger stamp found no usable chart of
    // accounts and had to provision one on the spot. Non-zero = an
    // org-creation path is skipping provisioning — investigate, don't ignore.
    ledger: { chartSelfHeals: ledgerChartSelfHeals },
    // BUILD-51: which theme-asset driver is live — s3:true means uploads go to
    // the bucket; s3:false (env unset) means bytes land in Postgres.
    // BUILD-51b: dbFallbackRows counts assets sitting in Postgres WHILE S3 is
    // configured — every one is a failed S3 put (also Sentry-reported). A
    // non-zero value that grows = the silent-fallback failure mode; null when
    // S3 isn't configured (DB storage is then by design).
    themeAssets: assetHealth(),
    // BUILD-62 Part 3: the reconciliation guard. unrecordedCharges > 0 means a
    // real charge settled at Stripe with NO gift row behind it — a donor was
    // charged and Steward has no record. This is the paging signal (watch it in
    // UptimeRobot alongside themeAssets.dbFallbackRows). orphanGifts is the
    // reverse (a gift with no succeeded charge). checkedAt null = not yet run.
    reconciliation: reconciliationHealth(),
    // BUILD-63 Part 2: manifest-vs-subscription diff. missingCount > 0 means the
    // handler processes event types the live endpoint does NOT subscribe — code
    // wired to nothing. Watch alongside reconciliation. null = not yet checked.
    webhookSubscriptions: webhookSubHealth(),
    // BUILD-65 Part 6: the aggregate. true ONLY when every guard above is both
    // clean AND fresh (a null/stale counter fails it). One field to page on.
    guardsOk: guardsOk(),
  });
});
app.use(require("./routes/give").routers.r0);
app.use(require("./routes/billing").routers.r0);

// B2 (BUILD-26) — tidy a name arriving from a messy spreadsheet WITHOUT destroying
// signal. Three safe, reversible transforms: (1) collapse runs of whitespace +
// trim; (2) flip a single "Last, First" into "First Last"; (3) re-case a name ONLY
// when the WHOLE string is entirely upper OR entirely lower (ELEANOR FITZGERALD →
// Eleanor Fitzgerald) — any internal mixed case means a human already cased it, so
// it is preserved verbatim (McKinney, O'Brien, van der Berg). Roman-numeral
// suffixes (II/III/IV…) stay upper. The value stays fully editable after import.
// MUST stay in lock-step with normalizeName in shared/importShape.js
// (asserted by tests/name-normalize.test.js parity sweep).
const _ROMAN_SUFFIX = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)$/i;
function _titleCaseWord(w) {
  if (_ROMAN_SUFFIX.test(w)) return w.toUpperCase();               // III, IV, VIII…
  return w.toLowerCase().replace(/(^|[’'\-.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// Display-name casing for EMAIL headers/subjects (BUILD-35 Part 2). The
// conservative HALF of normalizeName: re-case ONLY a wholly-lower/upper string
// ("atkinson" → "Atkinson", "jon" → "Jon"); any internal mixed case means a
// human already cased it ("CREO Arts", "McKinney") and is preserved verbatim.
// Deliberately NO "Last, First" flip — this is for org/user display strings,
// not imported donor rows. Applied where org/user names enter outbound email
// (branded header, digest subjects/headings, invites) so raw signup casing
// never renders in a big green band.
function displayNameCase(raw) {
  if (raw == null) return raw;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return s;
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const allUpper = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (allUpper || allLower) return s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*/g, w => _titleCaseWord(w));
  return s;
}

// ── Donor summary recalculation ────────────────────────────────────────────
// Recomputes total_giving, gift_count, last_gift_date, last_gift_amount
// from the gifts table (source of truth). Replace delta adjustments on
// edit/delete with this — it's correct even after complex edits.
// Note: amounts stored as INTEGER (whole dollars, no cents). If sub-dollar
// precision is ever needed, gifts.amount and donors.total_giving would need
// a schema migration to NUMERIC.
// Tenant-isolation guard (SECURITY §1): confirms a client-supplied foreign-key
// id belongs to the caller's org BEFORE it's stored or joined. Closes the
// cross-tenant IDOR class where a foreign account/fund/etc. id supplied in a
// request body is accepted and its label echoed back (or planted into the
// caller's own ledger). `table` is always an internal constant, never user
// input, so the interpolation is safe. A null/blank id is allowed (these
// columns are nullable) and passes.
async function orgOwns(table, id, orgId) {
  if (id === undefined || id === null || id === "") return true;
  const rows = await query(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`, [id, orgId]);
  return rows.length > 0;
}

// ── Plan tiers (BUILD-14, cutover BUILD-24) ────────────────────────────────
// Steward's up-market features (officer portfolios, moves/major-gifts, per-
// officer reports) gate to the "team" tier. Tier is DERIVED from the org's
// plan + subscription. BUILD-24 made Core/Team first-class plan values (the
// $249/$499 commercial model actually charged via Stripe); the legacy
// seed/growth/impact enum is still recognized so pre-cutover orgs and any
// in-flight subscription keep their tier without a destructive migration:
//   team  = { team, growth, impact }  OR any live trial (full-feature trial)
//   core  = { core, seed, founding }  OR lapsed/canceled (team features re-lock)
// `founding` is the private $99 founding-partner price — a core-tier discount,
// so it maps to core. See "Platform billing (BUILD-24)" in CLAUDE.md.
const TEAM_PLANS = new Set(["team", "growth", "impact"]);
function orgPlanTier(org) {
  // BUILD-46: the network Portal tier is its own tier and is NEVER
  // trial-elevated — a network signup gets the portal product, not a free
  // Team trial of the CRM. Checked before the trialing shortcut on purpose.
  if (org.plan === "portal") return "portal";
  if ((org.subscription_status || "trialing") === "trialing") return "team"; // full-feature trial
  return TEAM_PLANS.has(org.plan) ? "team" : "core";
}
function requirePlan(tier) {
  return async (req, res, next) => {
    try {
      const rows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
      if (!rows.length) return res.status(404).json({ error: "Org not found" });
      if (tier === "team" && orgPlanTier(rows[0]) !== "team") {
        return res.status(403).json({ error: "plan_required", requiredPlan: "team", message: "Officer portfolios are available on the Team plan." });
      }
    } catch (e) { console.error("requirePlan error:", e); return res.status(500).json({ error: "server_error" }); }
    next();
  };
}

// ── BUILD-46 §3.1 — the Portal tier is NOT the CRM ─────────────────────────
// A plan='portal' org gets: its donor portal, gift recording, receipts, and
// impact updates. The CRM route families below are gated here with ONE
// middleware (mounted before the routes) instead of touching ~40 route
// definitions. Team-only surfaces are already excluded by requirePlan("team")
// (orgPlanTier('portal') !== 'team'). The one carve-out: the basic
// giving-summary report stays available ("no reports beyond basic giving").
// Enforced-and-pinned by tests/network-gate.test.js.
const PORTAL_TIER_BLOCKED_PREFIXES = [
  "/reports", "/campaigns", "/sequences", "/workflows", "/gmail",
  "/board", "/events", "/volunteers", "/grants", "/milestone-drafts",
  "/note-reminders", "/digests",
];
const jwt46 = require("jsonwebtoken");
app.use(PORTAL_TIER_BLOCKED_PREFIXES, wrap(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return next(); // route's own auth 401s
  let payload;
  try { payload = jwt46.verify(auth.slice(7), process.env.JWT_SECRET); } catch { return next(); }
  if (!payload || !payload.orgId) return next();
  const rows = await query("SELECT plan FROM orgs WHERE id=?", [payload.orgId]);
  if (!rows.length || rows[0].plan !== "portal") return next();
  if (req.baseUrl === "/reports" && req.path.startsWith("/giving-summary")) return next();
  return res.status(403).json({
    error: "portal_tier",
    message: "This is part of the Steward CRM. Your Portal plan covers the donor portal, gift recording, receipts, and impact updates — upgrade to Core to unlock the CRM.",
  });
}));

// ── Moves management & prospect pipeline (BUILD-15) ────────────────────────
// The pipeline reuses the canonical donor-stage set (no second stage field).
// prospect→steward is the forward major-gifts pipeline; lapsed is a trailing
// re-engagement state, not a forward stage. Per-org custom stage editing is a
// deliberately deferred stage on this same field (like the workflow visual
// canvas) — the enum is used app-wide (validation, Kanban, Reports), so it
// stays fixed here.
const PIPELINE_STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward"];
const ALL_PIPELINE_STAGES = [...PIPELINE_STAGES, "lapsed"];

// Insert one move row (system of record for the pipeline). Description is
// required and validated at the route; this just writes.
async function recordMove(orgId, donorId, officerId, officerName, fromStage, toStage, description) {
  const id = "mv_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description) VALUES (?,?,?,?,?,?,?,?)",
    [id, orgId, donorId, officerId || null, officerName || "", fromStage || null, toStage, description]);
  return id;
}

// ── Smart moves (BUILD-22) ─────────────────────────────────────────────────
// Jonathan's rule: the officer owns stage. The software SUGGESTS every stage
// move and never auto-advances a judgment stage — with ONE exception. Lapsed is
// a fact about giving recency, not a judgment, so it's set automatically (and
// stays editable). LAPSE_DAYS is the SINGLE lapse definition, matching
// inferStage's `> 365` band and the pipeline "Lapsed" column — do not invent a
// second lapse rule.
const LAPSE_DAYS = 365;
// System-authored moves (auto-lapse / auto-unlapse) carry a null officer_id and
// this name, so they're visibly automatic in the timeline and distinguishable
// from human moves (the override-wins guard keys off officer_id IS NOT NULL).
const AUTO_MOVE_OFFICER = "Steward (automatic)";

// Log an auto-move: a moves row (transparent history) + a stage_change
// interaction (donor timeline), never a silent stage change.
async function recordAutoMove(orgId, donorId, fromStage, toStage, description) {
  await recordMove(orgId, donorId, null, AUTO_MOVE_OFFICER, fromStage, toStage, description);
  try {
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name) VALUES (?,?,?,?,?,?,?)",
      ["int_" + uuid().slice(0, 8), orgId, donorId, "stage_change",
       `Moved ${fromStage} → ${toStage}: ${description}`,
       new Date().toISOString().slice(0, 10), AUTO_MOVE_OFFICER]);
  } catch (e) { console.error("[smart-move] interaction log:", e.message); }
}

// Auto-lapse sweep for ONE org. Automatic (no suggestion) — Lapsed is a fact.
// Guards make it safe: only donors with PRIOR GIVING (a no-gift prospect is a
// prospect, not lapsed); never a donor being actively solicited (stage
// 'solicit') or with an OPEN ASK (mid-cultivation); and never one an officer
// has deliberately placed forward SINCE their last gift (officer override
// wins). Returns the count moved. Editable afterward regardless.
async function autoLapseOrg(orgId) {
  const cutoff = new Date(Date.now() - LAPSE_DAYS * 86400000).toISOString().slice(0, 10);
  const rows = await query(
    `SELECT d.id, d.stage, d.last_gift_date FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL
        AND d.imported_sustainer IS NOT TRUE
        AND d.gift_count > 0
        AND d.last_gift_date IS NOT NULL AND d.last_gift_date <> ''
        AND d.last_gift_date::date < ?::date
        AND d.stage NOT IN ('lapsed','solicit')
        AND NOT EXISTS (SELECT 1 FROM opportunities o
                          WHERE o.org_id=d.org_id AND o.donor_id=d.id AND o.status='open')
        AND NOT EXISTS (SELECT 1 FROM moves m
                          WHERE m.org_id=d.org_id AND m.donor_id=d.id
                            AND m.officer_id IS NOT NULL AND m.to_stage <> 'lapsed'
                            AND m.created_at::date > d.last_gift_date::date)
      LIMIT 200`,
    [orgId, cutoff]);
  let moved = 0;
  const months = Math.round(LAPSE_DAYS / 30);
  for (const d of rows) {
    // Guard on stage again in the UPDATE so a human move landing between the
    // SELECT and here isn't clobbered.
    const upd = await query(
      "UPDATE donors SET stage='lapsed', updated_at=NOW() WHERE id=? AND org_id=? AND stage=? RETURNING id",
      [d.id, orgId, d.stage]);
    if (!upd.length) continue;
    await recordAutoMove(orgId, d.id, d.stage, "lapsed", `Auto: lapsed — no gift in ${months} months`);
    moved++;
  }
  return moved;
}

async function recalcDonorSummary(donorId, orgId) {
  const agg = await query(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt, MAX(date) AS last_date
     FROM gifts WHERE donor_id=? AND org_id=?`,
    [donorId, orgId]
  );
  const total    = parseFloat(agg[0].total) || 0; // NUMERIC since the cover-fees migration
  const cnt      = parseInt(agg[0].cnt,   10) || 0;
  const lastDate = agg[0].last_date || null;

  let lastAmt = 0;
  if (lastDate) {
    // If two gifts share the same latest date, take the one inserted last
    const lr = await query(
      `SELECT amount FROM gifts WHERE donor_id=? AND org_id=? AND date=?
       ORDER BY created_at DESC LIMIT 1`,
      [donorId, orgId, lastDate]
    );
    lastAmt = parseFloat(lr[0]?.amount) || 0; // amounts carry cents since the cover-fees migration
  }

  await run(
    `UPDATE donors
     SET total_giving=?, gift_count=?, last_gift_date=?, last_gift_amount=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [total, cnt, lastDate, lastAmt, donorId, orgId]
  );
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
app.use(require("./routes/billing").routers.r1);

// ── BUILD-98 (switch) Part 8 — TWO-STEP SIGN-IN: THE ROUTES ─────────────────
const TOTP = require("./totp");
async function mfaVerifyForUser(user, code) {
  if (!user.mfa_secret_sealed) return null;
  const { open } = await import("./shared/secretBox.js");
  let secret;
  try { secret = open(user.mfa_secret_sealed, { aad: "mfa:" + user.org_id + ":" + user.id }); }
  catch (e) { console.error("[mfa] could not open the sealed secret for", user.id, e.message); return null; }
  const ctr = TOTP.verify(secret, code, { lastCounter: user.mfa_last_counter == null ? -1 : Number(user.mfa_last_counter) });
  if (ctr === null) return null;
  // Single use: a code accepted once is dead, by the counter, atomically.
  const r = await query(`UPDATE users SET mfa_last_counter=? WHERE id=? AND (mfa_last_counter IS NULL OR mfa_last_counter < ?) RETURNING id`, [ctr, user.id, ctr]);
  return r.length ? ctr : null;
}
app.use(require("./routes/crm").routers.r1);

// Display name for a pending invitee (no users row yet) — derived from the
// invite email's local-part ("jonathan.atkinson@x" → "Jonathan Atkinson") so the
// officer-mapping UI can collapse "jonathan"/"Jonathan Atkinson"/"jonathan@x"
// spellings onto ONE person, and the Directory can show "· pending" with a real
// name. Falls back to the raw email if the local-part is empty.
function inviteeDisplayName(email) {
  const local = String(email || "").split("@")[0] || "";
  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(email || "").trim() || null;
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
// Money here is dollars-and-cents, so every accumulation rounds to 2dp rather
// than letting binary floating point drift the equation off by 1e-13 and abort
// a perfectly good import.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ── Combined import: new donors + their year-column gift history in one pass ─
// Donor IDs are generated in JS before any DB write so gift rows can reference
// them without a round trip. Both donor and gift inserts are bulk (one statement
// per batch), matching the pattern in /donors/import and matching the gift+
// interaction format that /gifts/import-history and the single-gift route use.
// BUILD-83 FIX — THE ROUND-TRIP BUDGET. Batch size is not a memory knob, it is
// the number of times an import talks to the database, and at workbook scale
// that is the whole cost: every gift batch costs four trips (SAVEPOINT · INSERT
// gifts RETURNING · INSERT interactions · RELEASE). 90,523 gifts at 200/batch
// was 453 batches ≈ 1,800 trips — invisible on a local socket (the write
// measured 16s) and three to four minutes against a hosted database, which is
// the 221.4s measured on production against the same file. Postgres caps a
// statement at 65,535 bound parameters; donors bind 46 and gifts 13, so these
// sizes sit at 46,000 and 26,000 — inside the cap with room, and ~10× fewer
// trips. Raise them only against that cap, and re-measure.
const IMPORT_DONOR_BATCH = Number(process.env.IMPORT_DONOR_BATCH) || 1000;
const IMPORT_GIFT_BATCH = Number(process.env.IMPORT_GIFT_BATCH) || 2000;

// ── Gifts ──────────────────────────────────────────────────────────────────
// §1.2 F-5 — the ONE pledge-payment reconciler. Paid = Σ gifts linked by
// gifts.pledge_id (derived, never a stored counter — race-safe: two parallel
// payments both recompute and converge on the same SUM). Fulfills only when
// paid ≥ pledge amount; a partial payment leaves the pledge OPEN with an
// honest remaining balance. Reopens a fulfilled pledge whose payments fell
// back below the amount (gift deleted/refunded/shrunk). Canceled pledges are
// never resurrected. Returns {paid, balance} or null.
// BUILD-72 Part 3 — pledge status is DERIVED, never an independent flag.
//   applied_total <  amount  → partially_fulfilled (open), remaining shown
//   applied_total == amount  → fulfilled
//   applied_total >  amount  → fulfilled, and the SURPLUS is recorded and
//                              flagged rather than swallowed. A donor who
//                              overpays a pledge is a good problem, and the
//                              money must still appear.
// `pledges.status` remains a column because reminder cadence, reporting and
// `written_off` all read it — but it is now RECOMPUTED FROM THE PAYMENT TOTAL
// on every write that can move it, and `pledgeStatusFor` is the only thing that
// decides it. Nothing may set it independently (see PUT /pledges/:id).
function pledgeStatusFor(paid, amount, currentStatus) {
  // A cancelled / written-off pledge is never resurrected by arithmetic.
  if (currentStatus === "written_off" || currentStatus === "cancelled") return currentStatus;
  if (amount > 0 && paid >= amount) return "fulfilled";
  return "open";
}
// `partially_fulfilled` is a DISPLAY state, not a stored one: storing it would
// give the drift a second place to hide. Anything reading a pledge derives it.
function pledgeDisplayStatus(paid, amount, storedStatus) {
  if (storedStatus === "written_off" || storedStatus === "cancelled") return storedStatus;
  if (amount > 0 && paid >= amount) return "fulfilled";
  if (paid > 0) return "partially_fulfilled";
  return "open";
}

async function recalcPledgePayment(pledgeId, orgId) {
  const rows = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!rows.length) return null;
  const p = rows[0];
  const paidRows = await query(
    "SELECT COALESCE(SUM(amount),0) AS paid FROM gifts WHERE pledge_id=? AND org_id=?",
    [pledgeId, orgId]);
  const paid = round2(parseFloat(paidRows[0].paid) || 0);
  const amount = round2(parseFloat(p.amount) || 0);
  const status = pledgeStatusFor(paid, amount, p.status);
  const surplus = round2(Math.max(0, paid - amount));

  if (status === "fulfilled") {
    const lastGift = await query(
      "SELECT id FROM gifts WHERE pledge_id=? AND org_id=? ORDER BY date DESC, id DESC LIMIT 1",
      [pledgeId, orgId]);
    await run(
      `UPDATE pledges SET status='fulfilled', fulfilled_gift_id=?, fulfilled_at=COALESCE(fulfilled_at, NOW()),
              next_reminder_at=NULL, surplus_amount=?, updated_at=NOW()
       WHERE id=? AND org_id=? AND status IN ('open','fulfilled')`,
      [lastGift[0]?.id || null, surplus, pledgeId, orgId]);
  } else {
    await run(
      `UPDATE pledges SET status=CASE WHEN status='fulfilled' THEN 'open' ELSE status END,
              fulfilled_gift_id=NULL, fulfilled_at=NULL, surplus_amount=0, updated_at=NOW()
       WHERE id=? AND org_id=?`,
      [pledgeId, orgId]);
  }
  return {
    paid, balance: round2(Math.max(0, amount - paid)),
    surplus, overpaid: surplus > 0,
    status: pledgeDisplayStatus(paid, amount, status),
  };
}

// Reusable "open pledges with honest remaining balances" aggregate — remaining
// = amount − paid, so a partially-paid pledge counts only what is still
// committed-but-unpaid (F-5). Every "pledged" figure reads this, not SUM(amount).
const OPEN_PLEDGE_REMAINING_JOIN = `
  LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pledge_paid
    ON pledge_paid.pledge_id = pledges.id`;

// Atomic — UPDATE...RETURNING, never SELECT MAX(n)+1, so two concurrent
// receipt issues for the same org can never allocate the same number.
// Uses query() (not run()) because db.js's run() only returns rowCount and
// discards the RETURNING data.
async function allocateReceiptNumber(orgId) {
  const rows = await query(
    "UPDATE orgs SET receipt_counter = receipt_counter + 1 WHERE id = ? RETURNING receipt_counter",
    [orgId]
  );
  const n = rows[0].receipt_counter;
  // ORG_TZ_SEAM_OK — the year prefix is the ORG's civil year at issue, never
  // the process clock's. In UTC production those disagree from 19:00 EST every
  // Dec 31: the highest-volume hours of the highest-volume giving day would
  // stamp tax documents with next year's prefix (BUILD-75 Phase 0.1 measured
  // the exposure — half of all receipts to date were allocated inside the
  // nightly disagreement window; only the year boundary hadn't been crossed).
  const year = orgToday(await orgTz(orgId)).slice(0, 4);
  return `${year}-${String(n).padStart(5, "0")}`;
}

function applyReceiptTokens(str, org, donor) {
  if (!str) return "";
  return String(str).replace(/\{\{donor_name\}\}/g, donor.name || "").replace(/\{\{org_name\}\}/g, org.name || "");
}

// One PDF renderer for both a single-gift receipt and a year-end statement
// (snapshot.type distinguishes them) rather than two near-duplicate layouts
// — reuses the exact buffer-to-Promise + bufferedPageRange footer pattern
// from the Board Report / Impact Summary PDFs. The footer text MUST pass an
// explicit `height` option — text drawn at y = page.height - N without one
// sits below pdfkit's default maxY and silently triggers an extra page
// break per footer .text() call (bit the Impact Summary and Board Report
// PDFs both, independently, before this).
async function renderReceiptPdf(snapshot) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // The header band uses the org's brand accent when set (BUILD-13),
    // falling back to Steward green. The amount stays green (money = green in
    // the palette semantics). `fg` is the accessible foreground the accent was
    // normalized against, so header text is always legible on the band.
    const GREEN = "#1a6b4a", INK = "#1a1a1a", INK3 = "#6b7280", BG = "#f5f5f0";
    const HEADER = snapshot.orgAccent || GREEN;
    const HEADER_FG = snapshot.orgAccentFg || "#ffffff";
    const HEADER_SUB = HEADER_FG === "#ffffff" ? "#ffffffcc" : "#0f1a12aa";
    const PW = doc.page.width;
    const fmtD = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isYearEnd = snapshot.type === "year_end";

    doc.rect(0, 0, PW, 90).fill(HEADER);
    // Optional logo, right-aligned in the band.
    let logoBuf = null;
    if (snapshot.orgLogo && /^data:image\/(png|jpe?g);base64,/.test(snapshot.orgLogo)) {
      try { logoBuf = Buffer.from(snapshot.orgLogo.split(",")[1], "base64"); } catch { logoBuf = null; }
    }
    if (logoBuf) { try { doc.image(logoBuf, PW - 50 - 54, 18, { fit: [54, 54], align: "right" }); } catch {} }
    doc.font("Helvetica").fontSize(9).fillColor(HEADER_SUB).text(isYearEnd ? "Y E A R - E N D   G I V I N G   S T A T E M E N T" : "D O N A T I O N   R E C E I P T", 50, 24);
    doc.font("Helvetica-Bold").fontSize(19).fillColor(HEADER_FG).text(snapshot.orgLegalName, 50, 40, { width: PW - 120 });
    doc.font("Helvetica").fontSize(9).fillColor(HEADER_SUB).text(`EIN: ${snapshot.orgEin || "—"}`, 50, 68);

    let y = 112;
    doc.font("Helvetica").fontSize(9).fillColor(INK3).text(`Receipt #${snapshot.receiptNumber}`, 50, y);
    doc.text(`Issued ${snapshot.issueDate}`, PW - 220, y, { width: 170, align: "right" });
    y += 22;

    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(snapshot.donorName || "Valued Donor", 50, y); y = doc.y + 4;
    if (snapshot.orgAddress) {
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(snapshot.orgAddress, 50, y, { width: PW - 100 }); y = doc.y;
    }
    y += 14;

    if (!isYearEnd) {
      doc.rect(50, y, PW - 100, 66).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("GIFT DATE", 62, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.giftDate, 62, y + 22);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("AMOUNT", 230, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(fmtD(snapshot.amount), 230, y + 22);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("PAYMENT METHOD", 390, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.paymentMethod || "—", 390, y + 22);
      y += 84;

      if (snapshot.quidProQuoDesc) {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(
          `In exchange for this contribution, ${snapshot.orgLegalName} provided: ${snapshot.quidProQuoDesc} (estimated fair market value ${fmtD(snapshot.quidProQuoValue)}). Only the amount of your contribution in excess of that value — ${fmtD(snapshot.deductibleAmount)} — is tax-deductible.`,
          50, y, { width: PW - 100, lineGap: 2 }
        );
      } else {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text("No goods or services were provided in exchange for this contribution.", 50, y, { width: PW - 100 });
      }
      y = doc.y + 16;
    } else {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`Tax Year ${snapshot.taxYear} Giving Summary`, 50, y); y += 18;
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("DATE", 58, y);
      doc.text("PAYMENT METHOD", 170, y);
      doc.text("AMOUNT", PW - 150, y, { width: 100, align: "right" });
      y += 12;
      snapshot.lineItems.forEach((item, i) => {
        doc.rect(50, y, PW - 100, 18).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(item.date, 58, y + 5, { width: 100 });
        doc.fillColor(INK3).text(item.paymentMethod || "—", 170, y + 5, { width: 150 });
        doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(item.amount), PW - 150, y + 5, { width: 100, align: "right" });
        y += 18;
      });
      y += 10;
      doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 12;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Total tax-deductible contributions", 50, y);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text(fmtD(snapshot.totalDeductible), PW - 200, y - 2, { width: 150, align: "right" });
      y = doc.y + 18;
      doc.font("Helvetica").fontSize(9).fillColor(INK).text("No goods or services were provided in exchange for these contributions, unless otherwise noted on the individual gift receipt for a specific contribution.", 50, y, { width: PW - 100, lineGap: 2 });
      y = doc.y + 16;
    }

    if (snapshot.customMessage) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(INK).text(snapshot.customMessage, 50, y, { width: PW - 100, lineGap: 2 });
      y = doc.y + 18;
    }

    y += 14;
    if (snapshot.signatureName) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(snapshot.signatureName, 50, y); y = doc.y + 2;
      if (snapshot.signatureTitle) doc.font("Helvetica").fontSize(9).fillColor(INK3).text(snapshot.signatureTitle, 50, y);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // BUILD-65 Part 5: the receipt/statement footer is the legal tax line
      // ONLY. The "see all your giving" account CTA was removed from the PDF —
      // a document handed to an accountant should not carry a marketing link
      // (the CTA lives in the cover EMAIL instead). Legacy already-issued
      // receipts may still carry snapshot.givingAccountUrl frozen in; we simply
      // no longer render it.
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af").text(
        `${snapshot.orgLegalName} is a tax-exempt organization. EIN: ${snapshot.orgEin || "—"}. This receipt is provided for your tax records. Please retain it. No portion of this document constitutes tax advice.`,
        50, doc.page.height - 40, { width: PW - 100, height: 30, align: "left" }
      );
    }

    doc.end();
  });
}

// ── BUILD-49 — the donor front door's entry-point gate ─────────────────────
// One predicate for every donor-touching surface that may mention the /giving
// account: the org must be portal-enabled AND network_listed (the same
// listing predicate as the directory/dashboard queries) and the accounts flag
// must be on. Unlisted orgs' donors NEVER see any of it. Returns the org
// slug for from=<slug> links, or null.
async function givingAccountEntry(org) {
  if (!DONOR_ACCOUNTS_ENABLED || !org || !org.org_slug) return null;
  const rows = await query(
    `SELECT 1 FROM portal_settings WHERE org_id = ? AND enabled = true AND network_listed = true`, [org.id]);
  return rows.length ? { slug: org.org_slug } : null;
}
const {
  brandEmailHeaderHtml, consumerEmailHtml, donorFromAddress, donorMailDecision, linkAccountEmail,
  linkEmailToAccounts, orgMaySendEmail, sendCardExpiringEmail, sendDigestEmail, sendDunningEmail,
  sendGiftAlertEmail, sendPledgeReminderEmail, sendRawEmail, sendReceiptEmail, sendWorkflowEmail,
  trialReminderEmailHtml, unsubscribeEmailFooterHtml, unsubscribeHeaders, userWantsEmail,
} = require("./routes/email");

// Single choke point for issuing a per-gift receipt — used by both the
// webhook (fire-and-forget) and the manual "Send receipt" route, so
// idempotency/suppression/sample-skip logic lives in exactly one place.
async function issueGiftReceipt(gift, org, donor, { send = true, by = SYS_AUTO } = {}) {
  if (!org.receipts_enabled) return { skipped: "receipts_disabled" };
  if (gift.is_sample) return { skipped: "sample_gift" };

  // Idempotency — a redelivered Stripe event (or a double-click) must never
  // create a second active receipt for the same gift. Enforced here AND by
  // the DB's own partial-unique index (receipts_active_gift_uk) as a
  // second line of defense against a race between this check and the
  // INSERT below.
  const existing = await query("SELECT * FROM receipts WHERE gift_id=? AND voided_at IS NULL AND type='gift'", [gift.id]);
  if (existing.length) return { skipped: "already_issued", receipt: existing[0] };

  const deductibleAmount = gift.deductible_amount != null ? parseFloat(gift.deductible_amount) : parseFloat(gift.amount);
  const receiptNumber = await allocateReceiptNumber(org.id);
  // BUILD-64: the receipt's brand surface (band color + logo) comes from the
  // SAME resolver as the portal/give page — frozen into the snapshot at issue
  // time, so a later theme change never alters an already-issued receipt.
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null);

  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,      // BUILD-64: portal primary, never Steward green
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),      // BUILD-65: from object storage, not base64-only
    orgEin: org.ein || "",
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    receiptNumber,
    // ORG_TZ_SEAM_OK — the issue date printed on a tax document is the org's
    // civil date, and the gift date is a stored civil date formatted from its
    // own Y/M/D (never round-tripped through new Date(), which shifts it a day
    // in any process timezone west of UTC).
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))),
    donorName: donor.name,
    giftDate: gift.date ? orgTime.formatCivil(gift.date) : "",
    giftDateRaw: gift.date || null, // ISO, alongside the display-formatted giftDate above — lets the /dashboard/today mismatch-detection query compare against gifts.date directly without reparsing a formatted string
    amount: parseFloat(gift.amount),
    deductibleAmount,
    paymentMethod: gift.payment_method || "",
    quidProQuoDesc: gift.quid_pro_quo_desc || null,
    quidProQuoValue: gift.quid_pro_quo_value != null ? parseFloat(gift.quid_pro_quo_value) : null,
  };

  // BUILD-54 §2 — org-authored campaign copy for the cover email, frozen into
  // the snapshot at issue time like everything else (a later campaign edit
  // never changes what an already-issued receipt said). Present ONLY when the
  // gift is campaign-attributed AND the campaign carries donor-facing
  // content — a campaign with no content adds nothing (never fabricate).
  if (gift.campaign_id || gift.campaign) {
    const [c] = await query(
      `SELECT COALESCE(donor_facing_name, name) AS name, donor_description FROM campaigns
       WHERE org_id = ? AND (id = ? OR name = ?) AND donor_description IS NOT NULL LIMIT 1`,
      [org.id, gift.campaign_id || "", gift.campaign || ""]);
    if (c) snapshot.campaignNote = { name: c.name, description: c.donor_description };
  }

  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = "rcpt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, receipt_number, amount, deductible_amount, snapshot, pdf_data, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, gift.id, "gift", receiptNumber, snapshot.amount, deductibleAmount, JSON.stringify(snapshot), pdfBuffer.toString("base64"), by.id, by.name]
  );

  let emailSent = false;
  if (send && donor.email) {
    // W-4: a receipt is TRANSACTIONAL — the marketing suppression list does
    // not apply (deceased still blocks, via the one policy).
    const decision = await donorMailDecision("receipt", donor.email, org.id);
    if (decision.send) {
      emailSent = await sendReceiptEmail(org, donor, snapshot, pdfBuffer, `receipt-${receiptNumber}.pdf`);
      if (emailSent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, id]);
    }
  }

  // acknowledgement_sent reflects "a written acknowledgment now exists for
  // this gift" (satisfying the IRS contemporaneous-acknowledgment
  // requirement the moment the PDF is generated), not "the email definitely
  // arrived" — even on a suppressed address or a failed send, the PDF is
  // stored and staff can download + mail it manually from DonorProfile.
  // A.5 — the moment, not just the fact.
  await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()) WHERE id=?", [gift.id]);

  const rows = await query("SELECT * FROM receipts WHERE id=?", [id]);
  return { receipt: rows[0], created: true, emailSent };
}
app.use(require("./routes/give").routers.r1);

async function processGivingSources({ orgId = null } = {}) {
  try {
    const sources = await query(
      `SELECT id, org_id FROM giving_sources
        WHERE status <> 'disconnected' AND credentials_sealed IS NOT NULL
          AND (?::text IS NULL OR org_id = ?)
        ORDER BY COALESCE(last_synced_at, '1970-01-01'::timestamptz) ASC`, [orgId, orgId]);
    for (const s of sources) {
      await syncSource(s.org_id, s.id, { reason: "scheduled" })
        .catch(e => console.error("[giving-source] sync", s.id, e.message));
    }
    const orgs = await query(
      `SELECT DISTINCT org_id FROM giving_recurring WHERE status='active' AND (?::text IS NULL OR org_id = ?)`,
      [orgId, orgId]);
    let opened = 0;
    for (const o of orgs) {
      const out = await sweepMissedRecurring(o.org_id, {}).catch(e => {
        console.error("[giving-source] sweep", o.org_id, e.message); return { opened: 0 };
      });
      opened += out.opened;
    }
    if (opened) console.log(`[giving-source] ${opened} missed-payment thread(s) opened`);
    return { sources: sources.length, threadsOpened: opened };
  } catch (e) { console.error("[giving-source] processGivingSources:", e.message); return { sources: 0, threadsOpened: 0 }; }
}

async function donorIsOrganisation(donorId, orgId) {
  const rows = await query("SELECT id, name, kind FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
  if (!rows.length) return null;                       // caller answers 404 as it already does
  return { ...rows[0], isOrg: rows[0].kind === "organisation" || rows[0].kind === "anonymous" };
}

// ── ONE RESOLVE-OR-CREATE BY NAME ──────────────────────────────────────────
// Extracted from importGiftExtras in BUILD-102 Part 3 so the donation form and
// the importer cannot drift apart about what an employer is. A second copy would
// eventually mean a form creating a PERSON called "Acme Corp" while the importer
// creates an organisation, and the two would never merge.
//
// `made` is an out-parameter the caller counts, because "how many people did this
// create" is a figure both callers report and neither may guess at.
async function donorByNameOrCreate(orgId, name, { create = false, kind = null, who = null, cache = null, made = null } = {}) {
  const nm = String(name || "").trim();
  if (!nm) return null;
  const key = (kind || "p") + ":" + nm.toLowerCase();
  if (cache && cache.has(key)) return cache.get(key);
  const rows = await query(
    "SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) ORDER BY created_at, id LIMIT 2",
    [orgId, nm]);
  let id = rows.length ? rows[0].id : null;
  if (!id && create) {
    id = "d_" + uuid().slice(0, 10);
    await run(
      `INSERT INTO donors (id,org_id,name,stage,status,tags,kind,person_types,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)`,
      [id, orgId, nm, "prospect", "active", "[]", kind || "person", '["donor"]',
       (who && who.id) || null, (who && who.name) || null]);
    if (made) made.count++;
  }
  if (cache) cache.set(key, id);
  return id;
}


// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT
// ════════════════════════════════════════════════════════════════════════════
// shared/ackLetter.js holds the rules (merge fields refused at save, a field
// with no value named rather than printed blank, amounts summed in cents). This
// is the stack of paper: the backlog, the batch PDF with the address where a
// #10 window is, the labels, and the stamp that says who thanked whom, when
// and how. Steward prints; a person posts. Nothing here sends anything.
let ACK = null;
const ACK_READY = import("./shared/ackLetter.js").then(m => { ACK = m; return m; });


// ── BUILD-100 (grants) Part 2 — DEADLINES THAT COME AND FIND YOU ───────────
// A milestone, when its lead time arrives, IS a BUILD-81 thread on the
// officer. shared/grantMilestones.js holds every rule and the reason the
// middle state exists; these routes are its writers and the sweep.
async function grantMsMod() { return import("./shared/grantMilestones.js"); }

async function orgLeadDays(orgId) {
  const M = await grantMsMod();
  const [o] = await query("SELECT grant_lead_days FROM orgs WHERE id=?", [orgId]);
  return M.normalizeLeadDays(o && o.grant_lead_days);
}

// THE ONE PLACE A MILESTONE BECOMES A THREAD.
// Returns "raised" | "waiting" | null, and the WAITING answer is not a
// failure — it is the `threads_one_open` index doing its job, recorded so the
// screen can say why and the next close can advance it.
async function raiseGrantMilestone(orgId, ms, { today }) {
  const M = await grantMsMod();
  try {
    // The funder must still be an organisation on file. A milestone whose
    // funder record was deleted has nobody to hang a thread on; it stays
    // pending and is reported rather than silently dropped.
    const [g] = await query(
      `SELECT g.id, g.funder_donor_id, g.program, g.officer_id, g.status,
              d.name AS funder_name, d.assigned_to, d.assigned_to_name
         FROM grants g
         LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
                           AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
        WHERE g.id = ? AND g.org_id = ?`, [ms.grant_id, orgId]);
    if (!g || !g.funder_donor_id || !g.funder_name) return null;
    if (!M.grantWantsMilestones(g.status)) return null;

    const { sanitizeStepLabel } = await threadShapeMod();
    const label = sanitizeStepLabel(M.milestoneStepLabel({
      kind: ms.kind, funderName: g.funder_name, program: g.program,
    })) || "Follow up on the grant";

    // The officer who owns the GRANT owns the deadline; otherwise whoever owns
    // the funder record. A deadline is one person's commitment.
    let ownerId = g.officer_id || g.assigned_to || null, ownerName = g.assigned_to_name || null;
    if (ownerId) {
      const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [ownerId, orgId]);
      if (u) ownerName = u.name; else { ownerId = null; ownerName = null; }
    }

    const thread = await withTransaction(client => openThreadTx(client, {
      orgId, donorId: g.funder_donor_id,
      // DUE ON THE MILESTONE'S OWN DATE, not today + the lead. The lead decides
      // WHEN the officer is told; the deadline is still the deadline.
      step: { type: "follow_up", label, due: ms.due_date },
      openedOn: today, ownerId, ownerName,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));

    if (thread && thread.id) {
      await run(`UPDATE grant_milestones SET state='raised', thread_id=?, raised_at=NOW(), updated_at=NOW()
                  WHERE id=? AND org_id=?`, [thread.id, ms.id, orgId]);
      return "raised";
    }
    // openThreadTx declines when the donor already holds an open thread. That
    // is the constraint, not an error: the milestone waits its turn.
    await run(`UPDATE grant_milestones SET state='waiting', updated_at=NOW()
                WHERE id=? AND org_id=? AND state <> 'raised'`, [ms.id, orgId]);
    return "waiting";
  } catch (e) {
    console.error("[grant-milestone] raise:", e.message);
    return null;
  }
}

// THE SWEEP. Idempotent and self-healing, in the BUILD-99 shape: it re-reads
// `pending` AND `waiting` every pass, so a funder whose thread closed today
// gets their next deadline raised with no second mechanism, and a pass that
// was missed yesterday loses nothing (`dueWithinLead` stays true once true).
async function processGrantMilestones(onlyOrgId = null, { today: pinnedToday = null } = {}) {
  const M = await grantMsMod();
  const orgs = onlyOrgId
    ? await query("SELECT id FROM orgs WHERE id=?", [onlyOrgId])
    : await query(`SELECT DISTINCT org_id AS id FROM grant_milestones
                    WHERE state IN ('pending','waiting') AND org_id IS NOT NULL`);
  const summary = { raised: 0, waiting: 0, checked: 0 };
  for (const o of orgs) {
    try {
      const org = await orgTz(o.id);
      const today = pinnedToday && testMode() ? pinnedToday : orgToday(org);   // ORG_TZ_SEAM_OK
      const leadDays = await orgLeadDays(o.id);
      const rows = await query(
        `SELECT m.* FROM grant_milestones m
           JOIN grants g ON g.id = m.grant_id AND g.org_id = m.org_id
          WHERE m.org_id=? AND m.state IN ('pending','waiting')
            AND g.is_sample IS NOT TRUE
          ORDER BY m.due_date ASC`, [o.id]);
      for (const ms of rows) {
        summary.checked++;
        if (!M.dueWithinLead({ kind: ms.kind, dueDate: ms.due_date }, today, leadDays)) continue;
        const r = await raiseGrantMilestone(o.id, ms, { today });
        if (r === "raised") summary.raised++;
        else if (r === "waiting") summary.waiting++;
      }
    } catch (e) { console.error(`[grant-milestone] sweep org=${o.id}:`, e.message); }
  }
  return summary;
}


// ── BUILD-100 (grants) Part 3 — THE FILES A GRANT CARRIES ──────────────────
// grantDocs.js holds the types, the byte checks and the signed door.
const grantDocs = require("./grantDocs.js");


// ── BUILD-100 (grants) Part 4 — WHERE RESTRICTED MONEY ACTUALLY IS ─────────
// shared/restrictedMoney.js holds the four figures, their definitions, and the
// reason "remaining" excludes what the funder still owes.
async function restrictedMod() { return import("./shared/restrictedMoney.js"); }

// ONE query for a grant's money, so the balance can never be assembled two
// ways. `received` is the payments APPLIED TO THE AWARD PLEDGE — not every gift
// the funder ever sent, which would fold an unrelated donation into a
// restricted balance.
async function grantMoneyRows(orgId, where = "", args = []) {
  return query(
    `SELECT g.id, g.restriction, g.restricted_until, g.fund_id, g.status, g.program,
            g.amount_awarded, g.award_pledge_id,
            d.name AS funder_name, f.name AS fund_name, f.restricted AS fund_restricted,
            COALESCE((SELECT SUM(gi.amount) FROM gifts gi
                       WHERE gi.org_id = g.org_id AND gi.pledge_id = g.award_pledge_id), 0) AS received,
            COALESCE((SELECT SUM(s.amount) FROM grant_spend s
                       WHERE s.org_id = g.org_id AND s.grant_id = g.id), 0) AS spent
       FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id = ? AND g.is_sample IS NOT TRUE ${where}`, [orgId, ...args]);
}

function grantBalanceFrom(R, r, today) {
  const b = R.grantBalance({
    awardedCents: toCents(r.amount_awarded) || 0,
    receivedCents: toCents(r.received) || 0,
    spentCents: toCents(r.spent) || 0,
    restriction: r.restriction, restrictedUntil: r.restricted_until, today,
  });
  return {
    grantId: r.id, funderName: r.funder_name || "", program: r.program || "",
    grantStatus: r.status, fundId: r.fund_id || null, fundName: r.fund_name || null,
    fundIsRestricted: r.fund_restricted === true,
    ...b,
    awarded: toDollars(b.awardedCents), received: toDollars(b.receivedCents),
    spent: toDollars(b.spentCents), outstanding: toDollars(b.outstandingCents),
    remaining: toDollars(b.remainingCents),
    sentence: R.balanceSentence(b, money.formatCentsPlain),
  };
}
app.use(require("./routes/finance").routers.r0);

// ── Volunteers ─────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS
// ════════════════════════════════════════════════════════════════════════════
// shared/volunteerHours.js holds the rules (hundredths, a 24-hour ceiling, an
// import key). Hours live on the PERSON (donors row, BUILD-94's person types),
// so a volunteer who gives is one record with both roles. Not scheduling.
let VH = null;
const VH_READY = import("./shared/volunteerHours.js").then(m => { VH = m; return m; });

// A person who logged a shift IS a volunteer, on the same record — the
// recordGift rule for "donor", applied to hours. "other" means "we do not know"
// and a shift answers that.
async function markVolunteer(orgId, personId) {
  await run(`UPDATE donors SET person_types = CASE
      WHEN person_types IS NULL THEN '["donor","volunteer"]'::jsonb
      WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
      ELSE (person_types - 'other') || '["volunteer"]'::jsonb END
    WHERE id=? AND org_id=?`, [personId, orgId]);
}

async function insertShift(orgId, personId, shift, { via, importKey = null, who }) {
  const rows = await query(
    `INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,note,via,import_key,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, import_key) WHERE import_key IS NOT NULL DO NOTHING RETURNING id`,
    ["vs_" + uuid().slice(0, 10), orgId, personId, shift.date, shift.hundredths / 100, shift.role, shift.note || null,
     via, importKey, who.id, who.name]);
  if (rows.length) await markVolunteer(orgId, personId);
  return rows[0]?.id || null;
}

async function volunteerSummary(orgId, personId) {
  const [t] = await query(`SELECT COALESCE(SUM(round(hours*100)),0)::bigint AS h, COUNT(*)::int AS n, MIN(date) AS first, MAX(date) AS last
                             FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, personId]);
  return { hundredths: Number(t?.h || 0), totalHours: Number(t?.h || 0) / 100, shiftCount: t?.n || 0, firstShift: t?.first || null, lastShift: t?.last || null };
}
app.use(require("./routes/volunteer").routers.r0);

// ── BUILD-98 (switch) Part 6 — THE PUBLIC API: A KEY THAT OPENS ONE ORG ────
// Read scopes first. The rules:
//   1. A key is shown ONCE, stored as its SHA-256, and names its org on the
//      STORED ROW — nothing the caller sends can pick the org (BUILD-37 B9).
//   2. A key opens /api/v1 and NOTHING ELSE. requireAuth never accepts one,
//      and requireApiKey never accepts a staff JWT — two doors, two locks.
//   3. Revoked is a 401 that reads exactly like a key that never existed.
//   4. The list endpoints are newest-first with an id, which is what a Zapier
//      POLLING trigger needs ("new person", "new gift"): Zapier dedupes by id.
const API_KEY_PREFIX = "stw_";
const hashApiKey = k => crypto.createHash("sha256").update(String(k)).digest("hex");
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: rateLimitDisabled,
  keyGenerator: req => {
    const k = String(req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    return k.startsWith(API_KEY_PREFIX) ? "key:" + hashApiKey(k).slice(0, 16) : ipKeyGenerator(req.ip);
  },
});

// ── BUILD-81 — THE THREAD ───────────────────────────────────────────────────
// A thread is a donor plus an open next step: the last touch, the next step
// with a due date, days open, and who owns it. One open thread per donor
// (partial unique index threads_one_open). The engine is BUILD-76's byproduct
// logging with a name and a place: logging a conversation IS creating the
// follow-up — nothing here asks anyone to create a task.
//
// Ways out of a thread, and silent is not one of them (threads_close_honest
// CHECK in db.js — the DATABASE refuses a close with no outcome and no
// reason): an outcome logged (one line, and the next-step prompt runs again)
// or a dismissal with a reason. "Not now, revisit on [date]" is a SNOOZE on
// an open thread, deliberately not a close.
//
// Threads are NEVER inferred from imported data — a Last Contact column in a
// file is history, not an open loop. The only non-human opener is a LIVE gift
// landing (webhook / manual entry), whose next step is "Thank".
async function threadShapeMod() { return import("./shared/threadShape.js"); }
// BUILD-85 — the ordering. Pure module, same ESM-from-CJS door as above.
async function threadRankMod() { return import("./shared/threadRank.js"); }

// Open a thread inside a caller-held transaction. Returns the row, or null
// when the donor already has an open thread (the one-open-thread rule — the
// partial unique index decides under a race, not a check-then-insert).
async function openThreadTx(client, { orgId, donorId, step, openedOn, ownerId, ownerName, actorId, actorName, openingInteractionId = null, openingGiftId = null, followon = null }) {
  const id = "th_" + uuid().slice(0, 8);
  const rows = await queryTx(client,
    `INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,due_time,opened_on,
                          opening_interaction_id,opening_gift_id,owner_id,owner_name,
                          created_by,created_by_name,followon_type,followon_label,followon_due)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, donor_id) WHERE closed_at IS NULL DO NOTHING
     RETURNING *`,
    [id, orgId, donorId, step.type, step.label, step.due, step.time || null, openedOn,
     openingInteractionId, openingGiftId, ownerId || null, ownerName || null,
     actorId || null, actorName || null,
     followon?.type || null, followon?.label || null, followon?.due || null]);
  return rows[0] || null;
}

// A LIVE gift opens a thread whose next step is "Thank" (+2 days) — the
// "gift received" row of the defaults table, applied on the server so a gift
// not yet thanked IS a thread rather than a parallel computation. Gated the
// way every person surface is: never for sample/deceased/do-not-contact
// donors or non-person records (orgs/DAFs/anonymous), never for recurring
// renewals (their thank-you path is transactional and automatic), and never
// from an import (imports call bulk inserts, not this).
async function openGiftThread(orgId, donorId, { giftId, giftDate, actorId, actorName }) {
  try {
    const [d] = await query(
      `SELECT id, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = orgToday(org);                       // ORG_TZ_SEAM_OK
    const { nextStepSuggestion } = await threadShapeMod();
    const step = nextStepSuggestion("gift", today);
    return await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: step.type, label: step.label, due: step.due },
      openedOn: today, openingGiftId: giftId || null,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId, actorName,
    }));
  } catch (e) { console.error("[thread] gift thread:", e.message); return null; }
}

// ── A SUSTAINER THE AUTOMATION COULD NOT SAVE BECOMES A PERSON'S JOB ───────
// (2026-09-11) The dunning cadence is four emails over fourteen days. When it
// runs out, `next_dunning_at` goes NULL and the subscription was left to
// Stripe's own retries and eventual cancellation — with nobody told. A monthly
// donor of six years stopped being a donor and no human ever heard about it.
//
// That is the exact moment this product exists for: the follow-up that was
// meant and never happened. So exhausting the automation opens a THREAD — a
// donor, an open next step, a due date — owned by whoever owns the donor.
//
// Deliberately a thread and not a task: BUILD-81 made the thread the spine,
// one open per donor, closed only by a logged outcome or a stated reason. The
// `ON CONFLICT (org_id, donor_id) WHERE closed_at IS NULL DO NOTHING` in
// openThreadTx is what makes this safe to call from both of its two callers
// (cadence exhaustion, and involuntary cancellation for orgs that never dunned)
// without ever producing a second thread.
//
// NOTE: the person-surface gate is copied from openGiftThread verbatim, so a
// sample/deceased/do-not-contact/non-person record never gets one. BUILD-84
// gave organisations a `contact_name`, which arguably makes them callable now —
// that is a change to BUILD-80 Part 7's contract and belongs to its own
// decision, not to this one.
async function openSustainerLapseThread(orgId, donorId, { amount = null, interval = "month", reason = "dunning_exhausted" } = {}) {
  try {
    const [d] = await query(
      `SELECT id, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = orgToday(org);                       // ORG_TZ_SEAM_OK
    const { sanitizeStepLabel } = await threadShapeMod();
    // The label says the money and the cadence, because "follow up" on its own
    // tells the officer nothing about what they are walking into.
    const amt = amount != null && Number(amount) > 0
      ? "$" + Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " : "";
    const per = interval === "year" ? "yearly" : "monthly";
    const label = sanitizeStepLabel(`Call about their ${amt}${per} gift — the card failed and our emails did not reach them`)
      || "Call about their recurring gift";
    // Due TODAY: by the time this fires the gift has already been failing for
    // a fortnight. A +N-day default would be the automation stalling twice.
    const thread = await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: "follow_up", label, due: today },
      openedOn: today,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));
    if (thread) console.log(`[recurring] sustainer handed to a human: org=${orgId} donor=${donorId} reason=${reason}`);
    return thread;
  } catch (e) { console.error("[thread] sustainer lapse thread:", e.message); return null; }
}


// ══ BUILD-94 Part 5 — PUT IT ON MY CALENDAR ════════════════════════════════
// Three outputs, ONE builder. Outlook and Google are deep links to their
// compose screens; the .ics is a file. Nothing is written to any calendar by
// Steward and nothing comes back — NOT_SYNC_NOTE is the sentence that says so,
// and it ships beside the button.
//
// The three MUST agree: same subject, same start time in the org's timezone,
// and a UID that is stable across two generations so re-downloading UPDATES
// the appointment rather than duplicating it.
let CAL = null;
const CAL_READY = import("./shared/calendarLinks.js").then(m => { CAL = m; return m; });

// ── BUILD-85 — DOES THE ENGINE RUN? ────────────────────────────────────────
// Drift snapshots log_capture_rate. The Thread snapshotted NOTHING, so the
// product's central claim — log a conversation and the next step comes back —
// was untested in the only way that counts. The number that answers it is
// CONTINUATION: of the threads closed as an outcome, how many had their
// closing conversation open the next one. A high open count with a low
// continuation rate is a list being cleared, not a relationship being kept.
async function computeThreadHealth(orgId, { days = 30 } = {}) {
  const [row = {}] = await query(
    `WITH closed AS (
       SELECT t.id, t.close_kind, t.closing_interaction_id, t.opened_on,
              GREATEST(0, (t.closed_at AT TIME ZONE 'UTC')::date - t.opened_on::date) AS days_to_close
         FROM threads t
        WHERE t.org_id = ? AND t.closed_at IS NOT NULL
          AND t.closed_at >= NOW() - (? || ' days')::interval
     )
     SELECT COUNT(*)::int AS closed_count,
            COUNT(*) FILTER (WHERE close_kind = 'outcome')::int AS outcome_count,
            COUNT(*) FILTER (WHERE close_kind = 'dismissed')::int AS dismissed_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_close) AS median_days
       FROM closed`, [orgId, String(days)]);
  // Continuation: an outcome-closed thread whose closing interaction is the
  // OPENING interaction of another thread. That join IS the chain.
  const [cont = {}] = await query(
    `SELECT COUNT(*)::int AS n
       FROM threads a
       JOIN threads b ON b.org_id = a.org_id AND b.opening_interaction_id = a.closing_interaction_id
      WHERE a.org_id = ? AND a.close_kind = 'outcome' AND a.closing_interaction_id IS NOT NULL
        AND a.closed_at >= NOW() - (? || ' days')::interval`, [orgId, String(days)]);
  const outcome = row.outcome_count || 0;
  const [{ n: open } = { n: 0 }] = await query(
    `SELECT COUNT(*)::int AS n FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL`, [orgId]);
  return {
    windowDays: days, open,
    closed: row.closed_count || 0,
    outcome, dismissed: row.dismissed_count || 0,
    medianDaysToClose: row.median_days == null ? null : Math.round(parseFloat(row.median_days)),
    // THIN DATA IS SAID, NOT SMOOTHED (the BUILD-76 retention rule): a rate
    // over three threads is an artifact, so it is returned as null with the
    // count beside it rather than as a confident percentage.
    continued: cont.n || 0,
    continuationRate: outcome >= 5 ? Math.round((cont.n || 0) / outcome * 100) : null,
    thinData: outcome < 5,
  };
}
app.use(require("./routes/agent").routers.r0);

// ── AI — donor propensity scoring ──────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── SMTP settings ──────────────────────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── SMTP test endpoint ─────────────────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── Email suppression & unsubscribe ─────────────────────────────────────────
// Signed, no-login-required unsubscribe tokens. HMAC (not full JWT) is enough
// here — the payload only needs tamper-proofing, not the extra claims/expiry
// machinery a JWT brings. Reuses the same secret auth.js signs session tokens
// with (same dev-only fallback, gated the same way) rather than introducing a
// second secret to provision.
const UNSUB_SECRET = process.env.JWT_SECRET || "nonprofit_erp_secret_dev";

// CAN-SPAM requires the sender's physical postal address in commercial email,
// so the footer carries it alongside the unsubscribe link. Sourced live from
// the org's tax-receipt settings (orgs.receipt_address, BUILD-01) so there is
// exactly one address to maintain; async because it looks the org up itself —
// one pk lookup per send, trivial next to the Resend HTTP call, and it means
// no send path can miss the address by forgetting a column in its org SELECT.
// An org that hasn't filled in receipt_address yet degrades to the old
// unsubscribe-only footer (Communications shows admins a Settings prompt
// until they add it).
// ── BUILD-94 Part 4 — NO ADDRESS, NO SEND ──────────────────────────────────
// Commercial email must carry the sender's physical postal address (CAN-SPAM
// §7704(a)(5)); Gmail and Yahoo's bulk-sender rules assume it too. BUILD-81
// already made the digest refuse to go without one. This extends that refusal
// to CAMPAIGNS and SEQUENCES — the two things that actually go out in bulk.
//
// It is a REFUSAL, not a warning, and deliberately so: a warning on a screen
// somebody dismissed is how an organisation ends up sending 4,000 unlawful
// emails, and the fix is ninety seconds of typing in Settings.
async function bulkSendAddressGate(orgId) {
  const [org] = await query("SELECT name, receipt_address FROM orgs WHERE id = ?", [orgId]).catch(() => []);
  const addr = String(org?.receipt_address || "").trim();
  if (addr) return { ok: true, address: addr };
  return {
    ok: false,
    reason: "no_mailing_address",
    message: "Every bulk email has to carry your organisation's mailing address — it is the law for " +
             "commercial email, and Gmail and Yahoo both require it. Add it in Settings → Tax Receipts " +
             "and it appears in every footer from then on.",
  };
}

// ── BUILD-64 — ONE theme resolver for every donor-facing artifact ──────────
// The give page and the portal read the org's identity from portal_settings
// (portalCardTheme + display_name). Before BUILD-64 the EMAIL header band and
// the receipt PDF read a SECOND, unrelated copy — orgs.brand_accent (the old
// BUILD-13 white-label), which was unset on the demo orgs and fell back to
// Steward green. Result: a terracotta org's receipt arrived with a green band.
// resolveOrgBrandTheme is now THE resolver every off-web artifact reads, so an
// org's mail and documents carry the same colors, logo and white-label name as
// its portal — never a second copy, never Steward's mark. (Legal fields — the
// receipt's legal_name/EIN — stay on orgs; only the BRAND surface moves here.)
async function resolveOrgBrandTheme(orgId) {
  const rows = await query(
    `SELECT o.name, o.legal_name, o.logo_data AS org_logo,
            ps.display_name, ps.primary_color, ps.accent_color, ps.button_color,
            ps.background_tint, ps.type_pairing, ps.card_style,
            ps.logo_data AS ps_logo_data, ps.logo_url AS ps_logo_url
       FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id
      WHERE o.id = ?`, [orgId]);
  const r = rows[0] || {};
  const card = portalCardTheme(r); // primary/accent/fg from portal_settings, designed-neutral default when unset
  const isData = v => typeof v === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(v);
  // A logo we can embed inline (email <img>, PDF doc.image) MUST be base64.
  const logoDataUri = [r.ps_logo_data, r.org_logo].find(isData) || null;
  // An asset-URL logo (portal_settings.logo_url, e.g. /portal-assets/pa_…) can
  // ride an email as an absolute src, but can't be embedded in the PDF.
  const logoAbsUrl = (!logoDataUri && typeof r.ps_logo_url === "string" && r.ps_logo_url)
    ? (r.ps_logo_url.startsWith("http") ? r.ps_logo_url : publicAppUrl() + r.ps_logo_url) : null;
  const displayName = displayNameCase(String(r.display_name || "").trim() || r.name || "");
  return {
    band: card.primary, bandFg: card.primaryFg,
    accent: card.accent, accentFg: card.accentFg,
    logoDataUri, logoAbsUrl,
    displayName,
    legalName: r.legal_name || r.name || displayName,
  };
}

// ── BUILD-65 Part 2 — a PDF-embeddable logo, from OBJECT STORAGE ────────────
// renderReceiptPdf can only embed PNG/JPEG bytes (pdfkit's constraint). Since
// BUILD-51 a modern org's logo lives in object storage — portal_settings
// .logo_url = /portal-assets/<id> — so resolveOrgBrandTheme's logoDataUri
// (base64 only) is NULL for it, and every real org's tax receipt rendered with
// NO logo while the legacy demo data (base64 in the row) worked fine. This
// fetches the asset bytes and returns a png/jpeg data URI the PDF can embed —
// converting WebP/SVG/GIF to PNG (which also fixes legacy base64 WebP logos the
// old png|jpeg-only check silently dropped). Async + only called on the
// (low-frequency) PDF-issue paths, so resolveOrgBrandTheme stays cheap for the
// hot email paths. Returns null on any failure — a missing logo is never fatal.
async function resolvePdfLogo(brand) {
  if (!brand) return null;
  let buffer = null, ct = null;
  try {
    const dm = typeof brand.logoDataUri === "string" ? brand.logoDataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
    if (dm) { buffer = Buffer.from(dm[2], "base64"); ct = dm[1]; }
    else if (typeof brand.logoAbsUrl === "string") {
      const idm = brand.logoAbsUrl.match(/(pa_[a-f0-9]{24})/);
      if (idm) { const a = await getThemeAsset(idm[1]); if (a) { buffer = a.buffer; ct = a.contentType; } }
    }
  } catch (e) { console.error("[pdf-logo] fetch failed:", e.message); return null; }
  if (!buffer || !buffer.length) return null;
  if (ct === "image/png" || ct === "image/jpeg" || ct === "image/jpg") {
    return `data:${ct};base64,${buffer.toString("base64")}`;
  }
  try {
    const sharp = require("sharp");
    const png = await sharp(buffer, { failOn: "none" }).png().toBuffer();
    return "data:image/png;base64," + png.toString("base64");
  } catch (e) { console.error("[pdf-logo] convert failed:", e.message); return null; }
}

// The donor-facing "From" — the org's name in the inbox, so a receipt reads as
// coming from "CREO Arts", not a bare unfamiliar domain (BUILD-64 Part 2, the
// "Now" half of sender identity; per-org sending DOMAINS are scoped separately
// in the per-org sending-domain write-up). Header-injection-safe: no CR/LF/quotes/angles
// in the display name. The address itself is unchanged (noreply@stewardapp.dev).
const DONOR_MAIL_ADDR = () => process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
function fromWithDisplayName(displayName, addr) {
  const clean = String(displayName || "").replace(/[\r\n"<>]/g, "").trim().slice(0, 78);
  return clean ? `${clean} <${addr}>` : addr;
}

// ── BUILD-88c C.1 — THE ONE PLACE A SENDING IDENTITY IS DECIDED ───────────
// Every donor-facing send asks this, and nothing else decides it. Two answers:
//
//   VERIFIED — the org published Resend's DNS records for a domain it controls,
//   Steward checked, and it holds. From is a PERSON at that domain
//   ("Ada Trelawney <ada@sparrowmissions.org>"), Reply-To is the same address,
//   and the List-Unsubscribe mailto is on their domain too. Nothing the
//   recipient's inbox shows them says "steward".
//
//   NOT VERIFIED — exactly today's behaviour, unchanged: the org's NAME in the
//   display slot over Steward's shared address, with the user's address as
//   Reply-To. Nobody is ever blocked from sending by a DNS record they have not
//   published yet, and the screen says which of the two is in force.
//
// A verified domain is a fact about the ORG, so this reads the org row and
// never a request parameter: a caller cannot ask to send as somebody else.
async function orgSendingIdentity(orgId, { replyTo = null } = {}) {
  const [org] = await query(
    `SELECT name, sending_domain, sending_domain_status, sending_from_email, sending_domain_verified_at
       FROM orgs WHERE id=?`, [orgId]).catch(() => []);
  const theme = await resolveOrgBrandTheme(orgId).catch(() => null);
  const displayName = (theme && theme.displayName) || (org && org.name) || "";
  const verified = !!(org && org.sending_domain && org.sending_domain_status === "verified"
                      && org.sending_from_email
                      && String(org.sending_from_email).toLowerCase().endsWith("@" + String(org.sending_domain).toLowerCase()));
  const addr = verified ? org.sending_from_email : DONOR_MAIL_ADDR();
  // ON THE SHARED DOMAIN A REPLY HAS TO REACH A HUMAN. It did not: donor-facing
  // mail carried no Reply-To at all, so a donor answering a receipt or an
  // appeal was writing to `noreply@stewardapp.dev`, and the answer went nowhere.
  // The org's chosen sending address if it has one, else its first admin.
  let reply = null;
  if (!verified) {
    reply = replyTo || (org && org.sending_from_email) || null;
    if (!reply) {
      const [admin] = await query(
        "SELECT email FROM users WHERE org_id=? AND email IS NOT NULL AND role='admin' ORDER BY created_at ASC, id ASC LIMIT 1",
        [orgId]).catch(() => []);
      reply = admin?.email || null;
    }
  }
  return {
    verified,
    domain: verified ? org.sending_domain : null,
    verifiedAt: verified ? org.sending_domain_verified_at : null,
    address: addr,
    from: fromWithDisplayName(displayName, addr),
    // On the org's own domain the From IS a human at their own address, and a
    // second header saying the same thing is noise.
    replyTo: reply,
    displayName,
  };
}

// The three headers every donor-facing send needs, resolved together so they
// cannot disagree about which identity is in force. ONE call site per send.
// NOTE, and it cost this build an assertion to find: the Resend SDK maps
// `payload.replyTo` onto the wire's `reply_to` and IGNORES a `reply_to` key
// passed in. Three call sites in this file were passing the snake_case one and
// silently sending no Reply-To at all — including the founder's onboarding
// drip. Every one of them is `replyTo` now.
async function donorSendOpts(orgId, donorEmail, source = "campaign") {
  const identity = await orgSendingIdentity(orgId);
  return {
    from: identity.from,
    ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
    headers: unsubscribeHeaders(donorEmail, orgId, source, identity),
    // Read by the client proxy (logged per org, refused if the org's mail is
    // off) and stripped before the provider sees the payload.
    _stewardOrgId: orgId, _stewardKind: source,
  };
}

// ── BUILD-58 W-4 — ONE place decides suppressibility ───────────────────────
// Every donor-facing message kind is classified transactional | marketing.
// TRANSACTIONAL = service mail about the donor's own money or account
// (failed-card recovery, receipts, year-end statements, recurring-gift
// changes). A donor who unsubscribed from a newsletter has NOT opted out of
// being told their card failed — transactional mail NEVER consults the
// marketing suppression list. MARKETING = org-authored outreach; the
// suppression list and the donor's do_not_contact flag both apply.
// `deceased` blocks everything.
//
// The raw probe above (getSuppressionReason) may be called ONLY by
// donorMailDecision — pinned by tests/mail-suppression.test.js source scan —
// so a new send site cannot quietly consult the wrong list. An UNCLASSIFIED
// kind fails CLOSED: classify it here before it can send.
//
// NB the transactional-vs-marketing line is a legal judgment as well as a
// product one — flagged for attorney review in NEEDS-JONATHAN.md §7; this table
// is the product's best-faith classification, not a legal conclusion.
// W-2 white-label sweep: the name a DONOR sees is the portal display name
// when the org set one, never the staff-side orgs.name ("CREO Arts (Demo)").
// Used by the transactional donor-mail family + the public give payloads.
async function donorFacingOrgName(orgId, fallbackName) {
  const rows = await query("SELECT display_name FROM portal_settings WHERE org_id = ?", [orgId]).catch(() => []);
  const dn = String(rows[0]?.display_name || "").trim();
  return dn || displayNameCase(fallbackName || "");
}
const orgMailGateCache = new Map();
app.use(require("./routes/webhooks").routers.r1);

// ── Recurring gift recovery (failed-payment dunning) — shared helpers ──────
// Nonprofits lose 20-30% of recurring giving to involuntary churn (expired/
// declined cards) with nobody ever noticing. This detects it on the donor's
// CONNECTED Stripe account (event.account below — a separate concern from
// /billing/webhook, which is Steward's OWN platform subscription), emails the
// donor a secure card-update link, and tracks recovery. See CLAUDE.md
// "Recurring gift recovery" for the full design.
//
// Same signed, no-login HMAC pattern as the unsubscribe token above. A
// separate secret (falling back to the same one if unset) so the two token
// families can be rotated independently later without sharing a blast radius.
const RECOVERY_SECRET = process.env.RECOVERY_SECRET || UNSUB_SECRET;

// Dunning cadence: days since the subscription's FIRST failure at which to
// send the next reminder — fixed checkpoints, not "N days after the last
// send," so the schedule doesn't drift if a send is delayed. After the final
// step, Steward stops sending; an unresolved subscription eventually reaches
// customer.subscription.deleted, handled below as the "lost" outcome.
const DUNNING_SCHEDULE_DAYS = [0, 3, 7, 14];

// Trailing window for recovered/lost recovery-rate math (see GET /recurring/health).
const RECOVERY_RATE_WINDOW_DAYS = 90;

function signRecoveryToken(subscriptionId, orgId) {
  const payload = Buffer.from(JSON.stringify({ subscriptionId, orgId })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function buildCardUpdateUrl(subscriptionId, orgId) {
  // Canonical domain via the vercel.json /recurring/update-card proxy rewrite
  // — the failed-card recovery email is exactly where a suspicious-looking
  // host would cost a recovery. See buildUnsubscribeUrl.
  return `${publicAppUrl()}/recurring/update-card?token=${signRecoveryToken(subscriptionId, orgId)}`;
}

async function logRecoveryEvent(orgId, donorId, subscriptionId, type, stripeEventId, detail) {
  await run(
    `INSERT INTO payment_recovery_events (id, org_id, donor_id, subscription_id, type, stripe_event_id, detail)
     VALUES (?,?,?,?,?,?,?)`,
    ["pre_" + uuid().slice(0, 8), orgId, donorId || null, subscriptionId || null, type, stripeEventId || null, JSON.stringify(detail || {})]
  );
}

// ── BUILD-57 — recurring movement ledger + staff-change notifications ──────
// One writer for the append-only recurring_change_log (the MRR waterfall's
// source of truth). KINDS: created · amount_up · amount_down · paused ·
// resumed · canceled_voluntary · canceled_involuntary · recovered ·
// fund_changed. The voluntary/involuntary split is decided HERE, at write
// time, when the caller knows why — a sustainer manager needs the two never
// collapsed (one is a technical problem, the other a relationship problem).
const RECURRING_CHANGE_KINDS = new Set([
  "created", "amount_up", "amount_down", "paused", "resumed",
  "canceled_voluntary", "canceled_involuntary", "recovered", "fund_changed",
]);
async function logRecurringChange(orgId, subscriptionId, donorId, kind, { oldAmount = null, newAmount = null, interval = null, actor = "system", actorName = null } = {}) {
  if (!RECURRING_CHANGE_KINDS.has(kind)) return;
  await run(
    `INSERT INTO recurring_change_log (id, org_id, subscription_id, donor_id, kind, old_amount, new_amount, sub_interval, actor, actor_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["rcl_" + uuid().slice(0, 8), orgId, subscriptionId || null, donorId || null, kind, oldAmount, newAmount, interval, actor, actorName]
  ).catch(e => console.error("[recurring] change-log write failed:", e.message));
}

// Recovered / (recovered + lost) over a trailing window, computed from the
// append-only payment_recovery_events log — shared by GET /recurring/health
// and the daily metric_snapshots snapshot below.
async function computeRecoveryRate(orgId) {
  const windowStart = new Date(Date.now() - RECOVERY_RATE_WINDOW_DAYS * 86400000).toISOString();
  const recoveredCount = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='payment_recovered' AND created_at >= ?",
    [orgId, windowStart]
  ))[0]?.c || 0;
  const lostCount = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='subscription_canceled' AND created_at >= ?",
    [orgId, windowStart]
  ))[0]?.c || 0;
  const rate = (recoveredCount + lostCount) > 0 ? Math.round((recoveredCount / (recoveredCount + lostCount)) * 100) : null;
  return { rate, recoveredCount, lostCount };
}

// ── BUILD-97 Part 5 — OBSERVABILITY, BECAUSE YOU CANNOT RUN WHAT YOU CANNOT
// SEE ──────────────────────────────────────────────────────────────────────
// The 22 September incident ran for TWELVE DAYS. It was found in a Resend log
// at eleven at night, by somebody who went looking because three delivered
// messages had turned up. The brief's own sentence: "The incident on the 22nd
// would have shown here in one line at 3 PM instead of in a Resend log at 11."
//
// One page, super-admin only. Everything on it is a READ.

// A tick that throws is a console line on a server nobody is reading. This
// wraps one, records it, and never changes what the tick does.
async function recordTick(name, fn) {
  const id = "tick_" + uuid().slice(0, 10);
  await run(`INSERT INTO tick_log (id,name) VALUES (?,?)`, [id, name]).catch(() => {});
  try {
    const detail = await fn();
    await run(`UPDATE tick_log SET finished_at=NOW(), ok=TRUE, detail=? WHERE id=?`,
      [typeof detail === "string" ? detail.slice(0, 300) : null, id]).catch(() => {});
    return detail;
  } catch (e) {
    await run(`UPDATE tick_log SET finished_at=NOW(), ok=FALSE, error=? WHERE id=?`,
      [String(e && e.message || e).slice(0, 400), id]).catch(() => {});
    // A TICK FAILURE IS AN ALERT, not just a row. It is one of the three things
    // the brief says Jonathan hears about.
    opsAlert("tick_failed", `Background job "${name}" failed`,
      `${name} threw: ${String(e && e.message || e).slice(0, 400)}`).catch(() => {});
    throw e;
  }
}

// ── THE ONE PLACE STEWARD MAILS JONATHAN ───────────────────────────────────
// Deliberately narrow. Three triggers, named in the brief: a send to a real
// mailbox provider from a demo org, a tick failure, a 5xx burst. It rides the
// RAW client, not the wrapped one, because an alert about mail must not depend
// on the thing it is alerting about — and it is de-duplicated per hour per
// kind, because an alert that arrives forty times is an alert nobody reads.
const _opsAlertSent = new Map();
async function opsAlert(kind, subject, body) {
  const to = process.env.FOUNDER_EMAIL;
  if (!to) return { skipped: "no_founder_email" };
  // This one send uses the raw client, so the permanent block is checked here too.
  if (isBlockedAddress(to)) { console.warn("[mail-block] REFUSED an ops alert to a blocked address"); return { skipped: "blocked_address" }; }
  const hourKey = kind + ":" + new Date().toISOString().slice(0, 13);
  if (_opsAlertSent.has(hourKey)) return { skipped: "already_alerted_this_hour" };
  _opsAlertSent.set(hourKey, true);
  if (_opsAlertSent.size > 200) _opsAlertSent.clear();
  console.error(`[ops-alert] ${kind}: ${subject}`);
  try {
    await _rawResend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to, subject: `[Steward] ${subject}`,
      html: `<p>${String(body).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p>`,
    });
    return { sent: true };
  } catch (e) { return { failed: String(e && e.message || e) }; }
}

// A 5xx burst. Counted from the tick log's failures plus the process's own
// counter, so it does not need an APM.
let _fiveXXWindow = [];
function noteServerError() {
  const now = Date.now();
  _fiveXXWindow = _fiveXXWindow.filter(t => now - t < 10 * 60000);
  _fiveXXWindow.push(now);
  if (_fiveXXWindow.length >= 25) {
    opsAlert("5xx_burst", "Steward is returning server errors",
      `${_fiveXXWindow.length} 5xx responses in the last ten minutes.`).catch(() => {});
    _fiveXXWindow = [];
  }
}
async function thresholdsMod() { return import("./shared/thresholds.js"); }

// ── BUILD-96 Part 3 — THE ONE GATE IN FRONT OF ANTHROPIC ───────────────────
// Two features send an organisation's own data to a third party: cheque
// reading sends a photograph of a cheque, and the agent sends rows and
// vocabulary. They are named together in steward-data-handling.md and in the
// customer agreement's subprocessor table because they are one disclosure, so
// they are gated together here for the same reason — two gates would
// eventually disagree, and the way they would disagree is by one of them
// sending something after an organisation said not to.
//
// Two conditions, and the reason says WHICH:
//   ai_no_key   — no ANTHROPIC_API_KEY. Nothing is configured; this is
//                 Steward's state, not the org's, and the control is ABSENT
//                 rather than broken (MANUAL-STEPS §12).
//   ai_disabled — the org turned it off in Settings. Its choice, per org.
async function aiGate(orgId) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "ai_no_key" };
  const [org] = await query("SELECT ai_enabled FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ok: false, reason: "org_not_found" };
  // A column added by a migration that has not run yet reads undefined, and
  // undefined must mean ON — the same direction as the DEFAULT.
  if (org.ai_enabled === false) return { ok: false, reason: "ai_disabled" };
  return { ok: true, reason: null };
}

// One place decides whether the agent may act for this org, and it answers with
// a REASON rather than a boolean, because a quiet screen has to say why.
async function agentGate(orgId) {
  const ai = await aiGate(orgId);
  if (!ai.ok) return { ok: false, reason: ai.reason === "ai_no_key" ? "agent_unavailable" : ai.reason };
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ok: false, reason: "org_not_found" };
  if (org.agent_paused_at) return { ok: false, reason: "agent_paused" };
  return { ok: true, reason: null };
}

// BUILD-97 — a SAVED audience is a name over one of these same segments, so
// it is resolved to its stored segment here and then filtered by the one
// implementation below. Deliberately NOT recursive: an audience cannot be
// built on another audience, so there is no cycle to guard and no chain of
// indirection between "the screen said Sponsors" and who actually got mail.
async function resolveSegmentSpec(segment, orgId) {
  if (segment && segment.mode === "audience") {
    const [row] = await query("SELECT segment FROM audiences WHERE id=? AND org_id=?",
      [segment.audienceId, orgId]).catch(() => [null]);
    if (!row) return { mode: "manual", donorIds: [] };   // a deleted audience is NOBODY, never everybody
    const inner = typeof row.segment === "string" ? JSON.parse(row.segment || "{}") : (row.segment || {});
    return inner && inner.mode === "audience" ? { mode: "manual", donorIds: [] } : inner;
  }
  return segment;
}

// PURE. Extracted from resolveCampaignRecipients so the hub can count every
// audience from ONE donor query instead of one query per audience — on a
// 25,000-donor org that was the difference between a screen and a stall. The
// filtering rules are unchanged and there is still only one copy of them.
function filterBySegment(allDonors, segment) {
  let donors = allDonors;
  const mode = segment.mode || "legacy";
  if (mode === "major") {
    donors = donors.filter(d => Number(d.total_giving) >= 10000);
  } else if (mode === "lapsed") {
    donors = donors.filter(d => d.stage === "lapsed");
  // AN EMPTY SELECTION SELECTS NOBODY. Each of these three used to fall
  // THROUGH to the unfiltered list when its list was empty, so a campaign that
  // named no stages, no tiers or no people went to EVERY donor with an email
  // address. That is the exact thing C.2's rule forbids: nothing goes to a
  // donor she did not press send on. An empty explicit segment is zero people.
  } else if (mode === "byStage") {
    donors = (segment.stages || []).length ? donors.filter(d => segment.stages.includes(d.stage)) : [];
  } else if (mode === "byTier") {
    donors = (segment.tiers || []).length ? donors.filter(d => segment.tiers.includes(d.capacity_tier)) : [];
  } else if (mode === "manual") {
    donors = (segment.donorIds || []).length ? donors.filter(d => segment.donorIds.includes(d.id)) : [];
  // ── BUILD-94 Part 2 — the four segments that let Mailchimp go ────────────
  // Allie's volunteers, staff and board are on this table now, so the
  // audience picker has to be able to name them. "Everyone with an email" is
  // the one segment in the product that deliberately crosses every type —
  // it is the Mailchimp audience, and it is why she is paying them.
  } else if (mode === "everyone") {
    /* already every person with an email — no type filter at all */
  } else if (mode === "volunteers") {
    donors = donors.filter(d => PT.hasType(d, "volunteer"));
  } else if (mode === "staff_board") {
    donors = donors.filter(d => PT.hasType(d, "staff_board"));
  } else if (mode === "donors") {
    donors = donors.filter(d => PT.isDonor(d));
  } else {
    // "all" or legacy format.
    // BUILD-94 Part 2 — and "all" MEANS ALL DONORS, which is what the picker
    // has always called it. Before this build every person was a donor so the
    // two were the same set; now they are not, and leaving it unfiltered would
    // quietly send an appeal to the volunteer coordinator's whole roster.
    donors = donors.filter(d => PT.isDonor(d));
    if (segment.stages && segment.stages.length) donors = donors.filter(d => segment.stages.includes(d.stage));
    if (segment.statuses && segment.statuses.length) donors = donors.filter(d => segment.statuses.includes(d.status));
  }
  return donors;
}

async function resolveCampaignRecipients(campaign, orgId) {
  const raw = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});
  const segment = await resolveSegmentSpec(raw, orgId);
  const donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
  );
  return filterBySegment(donors, segment);
}

// The background send loop — one recipient at a time: suppression check,
// token replacement, tracking pixel, unsubscribe footer/headers, per-row
// campaign_recipients bookkeeping, then finalize the campaign row. Extracted
// from the send route (BUILD-06 Phase C) so processScheduledCampaigns() can
// use the identical path — before that job existed, a scheduled campaign
// sat in status='scheduled' forever and never sent.
async function runCampaignSend(campaign, org, donors) {
  const BACKEND_URL = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";
  {
    console.log(`[campaign:${campaign.id}] background send starting — ${donors.length} recipients`);
    let sentCount = 0;
    let failCount = 0;

    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      const smtpFrom     = process.env.DEMO_SMTP_FROM;

      if (!resendApiKey || !smtpFrom) {
        console.log(`[campaign:${campaign.id}] RESEND_API_KEY=${resendApiKey?"set":"MISSING"} DEMO_SMTP_FROM=${smtpFrom||"MISSING"} — recording sends without emailing`);
      } else {
        console.log(`[campaign:${campaign.id}] Resend HTTP API configured — from=${smtpFrom}`);
      }

      const year = orgToday(await orgTz(org.id)).slice(0, 4); // ORG_TZ_SEAM_OK (BUILD-75 A.5) — the {{year}} token is the org's civil year
      const brandHeader = await brandEmailHeaderHtml(org.id); // BUILD-13 — once per send, not per recipient
      const campaignFrom = smtpFrom ? fromWithDisplayName((await resolveOrgBrandTheme(org.id).catch(() => null))?.displayName, smtpFrom) : smtpFrom; // BUILD-64: org name in the inbox, resolved once

      for (const donor of donors) {
        const decision = await donorMailDecision("campaign", donor.email, org.id);
        if (!decision.send) {
          console.log(`[campaign:${campaign.id}] skipping ${donor.email} (${decision.reason})`);
          await run(
            "INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,failure_reason) VALUES (?,?,?,?,?,?)",
            ["cr_" + uuid().slice(0, 8), org.id, campaign.id, donor.id, donor.email, `suppressed: ${decision.reason}`]
          ).catch(() => {});
          continue;
        }

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
          .replace(/{{org_name}}/g,     displayNameCase(org.name))
          .replace(/{{gift_amount}}/g,  giftAmount)
          .replace(/{{total_giving}}/g, totalGiving)
          .replace(/{{year}}/g,         year);

        const pixel    = `<img src="${BACKEND_URL}/track/${recipientId}/open.gif" width="1" height="1" style="display:none">`;
        const footer   = await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
        const htmlFull = brandHeader + bodyHtml + footer + pixel;
        const textBody = bodyHtml.replace(/<[^>]+>/g, "");

        try {
          if (resendApiKey && smtpFrom) {
            const { error: sendError } = await resend.emails.send({
              // BUILD-88c C.1 — the org's own identity, resolved per recipient
              // so the From, the Reply-To and the List-Unsubscribe mailto
              // cannot disagree about which domain is in force.
              ...(await donorSendOpts(org.id, donor.email, "campaign")),
              to: donor.email,
              subject: campaign.subject || "",
              html: htmlFull,
            });
            if (sendError) throw new Error(sendError.message);
          }
          await run("UPDATE campaign_recipients SET sent_at=NOW() WHERE id=?", [recipientId]);
          // ── BUILD-88c C.2 — AN APPEAL IS A CONVERSATION ──────────────────
          // A campaign left no trace on anybody's record, so the timeline never
          // showed it and DRIFT — which measures silence — counted a donor as
          // untouched in the same week the organisation wrote to them. One
          // interaction per recipient, written only after a REAL delivery (the
          // BUILD-85 W-4 rule: no timeline entry claims an email that never
          // left), and only once, because `campaign_recipients` is unique per
          // recipient and this sits inside that same successful branch.
          await run(
            `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            ["int_" + uuid().slice(0, 8), org.id, donor.id, "email",
             `Sent "${(campaign.name || "a campaign").slice(0, 120)}".`,
             orgToday(await orgTz(org.id)),                          // ORG_TZ_SEAM_OK
             campaign.created_by || SYS_AUTO.id, campaign.created_by_name || SYS_AUTO.name,
             JSON.stringify({ via: "campaign", campaignId: campaign.id, recipientId })]
          ).catch(e => console.error(`[campaign:${campaign.id}] timeline entry failed for ${donor.id}:`, e.message));
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
  }
}

// ── Giving Pages ────────────────────────────────────────────────────────────
// Campaign-specific donation pages, e.g. /give/:orgSlug/:pageSlug — distinct
// from the org-wide /give/:orgSlug page above, and NOT the same concept as
// the `campaigns` table (email campaigns). See db.js giving_pages comment.
function slugifyGivingPage(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
}

// ── BUILD-102 (Steward Give) Part 6 — THE FUNNEL, COUNTED NOT TRACKED ──────
// Views, starts and completions per form per day. NOTHING about who: no person id,
// no session id, no IP, no user agent, no cookie id — and the SHAPE is the
// guarantee rather than a promise in a policy, because `form_events` has nowhere to
// put one.
//
// Every counter is an ATOMIC UPSERT on (form, day, variant). A read-modify-write
// would lose counts the moment two people opened the form in the same second, and
// the first thing anybody would notice is a completion rate over 100%.
async function bumpFormEvent(orgId, formId, field, { variant = null, cents = 0, today = null } = {}) {
  if (!["views", "starts", "completions"].includes(field)) return;
  const org = await orgTz(orgId);
  const day = today || orgToday(org);                                  // ORG_TZ_SEAM_OK
  const v = variant === "a" || variant === "b" ? variant : null;
  await run(
    `INSERT INTO form_events (id,org_id,form_id,day,variant,${field},completed_cents)
     VALUES (?,?,?,?,?,1,?)
     ON CONFLICT (form_id, day, COALESCE(variant,''))
     DO UPDATE SET ${field} = form_events.${field} + 1,
                   completed_cents = form_events.completed_cents + ?,
                   updated_at = NOW()`,
    ["fe_" + uuid().slice(0, 10), orgId, formId, day, v, Math.max(0, Math.trunc(cents) || 0),
     Math.max(0, Math.trunc(cents) || 0)]);
}

// ── BUILD-102 (Steward Give) Part 1 — A FORM IS A GIVING PAGE WITH A CONFIG ──
// shared/formConfig.js is the ONE validator and the ONE spec builder. The editor
// and the page a stranger opens from a QR code derive their form from the SAME
// function — not two components fed similar props — so a preview cannot show a
// field the donor will not get.
async function formConfigMod() { return import("./shared/formConfig.js"); }

// Caller-supplied name/story/org/page title get interpolated into a raw
// HTML email body below — escape them so a submitted name like
// `<img src=x onerror=...>` can't inject markup into the manage-link email.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Same dollar-figure rate-limit budget as donateLimiter (public, unauth,
// abuse surface) but its own instance — a fundraiser owner editing their
// own page shouldn't be able to get rate-limited out of it just because
// other donors on the same shared/NAT'd IP have been actively giving
// through POST /donate/:orgSlug, which would exhaust a shared limiter.
const fundraiserManageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
function finPeriodBounds(yearMode, offset = 0, org = null) {
  // ORG_TZ_SEAM_OK — the fiscal/calendar boundary in the org's own calendar.
  // (BUILD-75 A.6: the old `now = { getMonth: … }` shim over this value read
  // like a process clock and hid from the line-level taint scan's accessor
  // check — read the civil parts directly instead of dressing them as a Date.)
  const _today = orgTime.parseCivil(orgToday(org || {}));
  if (yearMode === "fiscal") {
    const curFyStart = _today.m - 1 < 6 ? _today.y - 1 : _today.y;
    const fyStart = curFyStart + offset;
    return {
      start: `${fyStart}-07-01`,
      end: `${fyStart + 1}-06-30`,
      periodLabel: `Jul ${fyStart} – Jun ${fyStart + 1}`,
      chartLabel: `FY ${fyStart}–${String(fyStart + 1).slice(2)}`,
      // month buckets in basis order: Jul..Dec of fyStart, then Jan..Jun of fyStart+1
      months: [...Array(6)].map((_, i) => ({ y: fyStart, m: 6 + i }))
        .concat([...Array(6)].map((_, i) => ({ y: fyStart + 1, m: i }))),
    };
  }
  const year = _today.y + offset;
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    periodLabel: `Jan – Dec ${year}`,
    chartLabel: `${year}`,
    months: [...Array(12)].map((_, m) => ({ y: year, m })),
  };
}

// ── Reports (BUILD-02) ──────────────────────────────────────────────────────
// Six fixed, parameterized, table-first reports — deliberately NOT an
// Analytics revival (no charts, no custom builder). All aggregation happens
// in SQL, org-scoped on every query; every report also serves ?format=csv.
// Declared AFTER the /reports/board routes above so Express matches "board"
// there first and this :key route never shadows it.

const REPORT_KEYS = ["giving-summary", "by-group", "lybunt", "sybunt", "retention", "top-donors"];

// Fiscal year N = Jul 1 (N-1) through Jun 30 N — same July-1 boundary as
// /dashboard/my-stats and /finance/summary. A gift on 2025-12-15 is FY2026
// and CY2025.
function reportYearBounds(year, yearMode) {
  return yearMode === "fiscal"
    ? { from: `${year - 1}-07-01`, to: `${year}-06-30` }
    : { from: `${year}-01-01`, to: `${year}-12-31` };
}
// The year currently in progress (fiscal label year is the June-30 end year).
// ORG_TZ_SEAM_OK — which year a report calls "current" is a civil-calendar
// question, answered in the ORG's timezone. On Dec 31 at 8pm in New York the
// server's UTC clock is already next year, so an org opening Reports on New
// Year's Eve used to be shown the wrong year by default.
function reportCurrentYear(yearMode, org = null) {
  return orgReportYear(org || {}, yearMode);
}

// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD
// ════════════════════════════════════════════════════════════════════════════
// shared/reportBuilder.js is the catalogue and the compiler: a field is a NAME
// looked up there, never a string of SQL, and every value is a bound
// parameter. This block adds the org scope, runs it, and keeps what she saved.
// The twelve standard reports that Reports already answers CALL Reports' own
// handler through reportToCsv's own shaping, so a saved LYBUNT and the Reports
// tab's LYBUNT are one computation.
let RB = null;
const RB_READY = import("./shared/reportBuilder.js").then(m => { RB = m; return m; });

async function rbCustomDefs(orgId) {
  return query("SELECT key, label, type, entity FROM custom_field_defs WHERE org_id=? AND archived_at IS NULL", [orgId]).catch(() => []);
}

// The date words a stored definition may use, resolved on the org's own
// calendar every time it runs — a saved "this year" is this year.
async function rbTokens(orgId) {
  const org = await orgTz(orgId);
  const today = orgToday(org);                                 // ORG_TZ_SEAM_OK
  const fy = reportYearBounds(reportCurrentYear("fiscal", org), "fiscal");
  return { today, fyStart: fy.from, fyEnd: fy.to, twoYearsAgo: orgTime.addDays(today, -730) };
}

const rbCents = v => Math.round(Number(v) * 100);

// Run a builder definition for one org. Returns {columns, rows, totals, groups}.
// The compiled SQL carries its own $n placeholders and contains no `?`, so it
// passes through query()'s ?-to-$n rewrite untouched (asserted in the suite).
async function runBuilderDef(orgId, def) {
  await RB_READY;
  const c = RB.compile(RB.resolveDateTokens(def, await rbTokens(orgId)), { customDefs: await rbCustomDefs(orgId), paramStart: 2 });
  if (!c.ok) return { errors: c.errors };
  const where = [`${c.orgCol} = $1`, ...c.where].join(" AND ");
  const params = [orgId, ...c.params];
  // Totals are summed in the DATABASE over exactly the rows the filter names,
  // then read back to the cent — never re-added from a capped page.
  const sumSel = c.sums.map((s, i) => `COALESCE(SUM(${s.sql}),0) AS s${i}`).join(", ");
  const [tot] = await query(`SELECT COUNT(*)::int AS n${sumSel ? ", " + sumSel : ""} FROM ${c.from} WHERE ${where}`, params);
  const totals = { count: tot.n, sums: c.sums.map((s, i) => ({ key: s.key, label: s.label, cents: rbCents(tot["s" + i]) })) };
  if (c.group) {
    const gSel = c.sums.map((s, i) => `COALESCE(SUM(${s.sql}),0) AS s${i}`).join(", ");
    const rows = await query(
      `SELECT ${c.group.sql} AS g, COUNT(*)::int AS n${gSel ? ", " + gSel : ""} FROM ${c.from} WHERE ${where}
        GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT ${c.limit}`, params);
    const columns = [{ key: "group", label: c.group.label, type: "text" }, { key: "count", label: "Count", type: "number" },
      ...c.sums.map((s, i) => ({ key: "s" + i, label: s.label, type: "money" }))];
    return { columns, rows: rows.map(r => ({ group: r.g ?? "(blank)", count: r.n, ...Object.fromEntries(c.sums.map((s, i) => ["s" + i, rbCents(r["s" + i]) / 100])) })), totals, grouped: true };
  }
  const sel = c.columns.map((f, i) => `${f.sql} AS c${i}`).join(", ");
  const order = c.sort ? `${c.sort.sql} ${c.sort.dir} NULLS LAST` : "1";
  const rows = await query(`SELECT ${sel} FROM ${c.from} WHERE ${where} ORDER BY ${order} LIMIT ${c.limit}`, params);
  return {
    columns: c.columns.map((f, i) => ({ key: "c" + i, label: f.label, type: f.type })),
    rows: rows.map(r => Object.fromEntries(c.columns.map((f, i) => ["c" + i, f.type === "money" ? rbCents(r["c" + i]) / 100 : r["c" + i]]))),
    totals, capped: totals.count > rows.length,
  };
}

function rbFormatCell(v, type) {
  if (v === null || v === undefined) return "";
  if (type === "money") return "$" + (rbCents(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "bool") return v ? "Yes" : "No";
  return String(v);
}

// ── THE WEEKLY EMAIL ───────────────────────────────────────────────────────
// Monday morning, org-local, ONCE per report per week: saved_report_sends is
// reserved BEFORE the send (the digest_sends discipline) and released if the
// send fails. It goes to the report's OWNER — staff mail, branded, no donor
// footer — and its only link opens the report in Steward, a plain GET that
// changes nothing.
async function runSavedReportScheduleForOrg(org, { weekKey, force = false } = {}) {
  const reps = await query("SELECT * FROM saved_reports WHERE org_id=? AND schedule='weekly'", [org.id]);
  let sent = 0, skipped = 0;
  for (const r of reps) {
    const reserved = await query(
      "INSERT INTO saved_report_sends (id,org_id,report_id,period_key) VALUES (?,?,?,?) ON CONFLICT (report_id, period_key) DO NOTHING RETURNING id",
      ["rps_" + uuid().slice(0, 10), org.id, r.id, weekKey]);
    if (!reserved.length) { skipped++; continue; }
    const [owner] = await query("SELECT email, name FROM users WHERE id=? AND org_id=?", [r.owner_id, org.id]);
    if (!owner?.email) { skipped++; continue; }
    const out = await runBuilderDef(org.id, asJson(r.definition, {}));
    if (out.errors) { await run("DELETE FROM saved_report_sends WHERE id=?", [reserved[0].id]); skipped++; continue; }
    const link = `${publicAppUrl()}/dashboard?report=${encodeURIComponent(r.id)}`;
    const head = out.columns.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e8e4db;font-size:12px">${escapeHtml(c.label)}</th>`).join("");
    const body = out.rows.slice(0, 20).map(row => `<tr>${out.columns.map(c => `<td style="padding:4px 8px;font-size:12px">${escapeHtml(rbFormatCell(row[c.key], c.type))}</td>`).join("")}</tr>`).join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#0f1a12"><p style="font-size:15px"><strong>${escapeHtml(r.name)}</strong>: ${out.totals.count.toLocaleString("en-US")} ${out.totals.count === 1 ? "row" : "rows"} this week.</p>
      <table style="border-collapse:collapse">${head ? `<tr>${head}</tr>` : ""}${body}</table>
      ${out.totals.count > 20 ? `<p style="font-size:12px;color:#5a554f">and ${out.totals.count - 20} more.</p>` : ""}
      <p><a href="${link}">Open the report in Steward</a></p></div>`;
    const ok = await sendGiftAlertEmail(org, owner.email, `${r.name} — your weekly report`, html);
    if (!ok) { await run("DELETE FROM saved_report_sends WHERE id=?", [reserved[0].id]); skipped++; continue; }
    await run("UPDATE saved_reports SET last_sent_at=NOW() WHERE id=?", [r.id]);
    sent++;
  }
  return { sent, skipped, force };
}

// ══ Development reporting cadence — digests (BUILD-17) ══════════════════════
// The oversight rhythm that runs a development office. Two scheduled emails —
// a weekly "Week in Review" (ED + every team member) and a monthly per-officer
// report — composed from the BUILD-14/15/16 feeds and sent through the SAME
// 5-min tick as scheduled campaigns/dunning (no second scheduler). Idempotent
// per (org, digest_type, period_key, recipient) via digest_sends' unique index:
// a row is RESERVED before sending, so re-ticking within the week never
// double-sends. A double-send is a trust disaster; the reservation is
// non-negotiable, exactly like workflow_runs.

// (digestYmd deleted, BUILD-75 A.5 — its last caller now reads orgToday; a
// process-clock date formatter kept around is a tainted helper waiting for a
// new caller, which is exactly the class the reachability guard exists for.)
// Monday-based week. offset 0 = the week containing `now`; -1 = the prior
// (most-recently-completed) week. key is stable per Monday.
// BUILD-72 Part 4 — both delegate to the seam. They used to build windows from
// the SERVER's local clock (UTC in prod), so a gift entered Sunday evening in
// New York landed outside the week the product called "this week". `org` is
// {timezone} from orgTz(orgId); omitting it falls back to the default zone
// rather than to the server's, which is the whole point. ORG_TZ_SEAM_OK
function weekBounds(offset = 0, org = null, atInstant = new Date()) {
  return orgPeriodBounds(org || {}, "week", offset, atInstant);
}
function monthBounds(offset = 0, org = null, atInstant = new Date()) {
  return orgPeriodBounds(org || {}, "month", offset, atInstant);
}

// ── BUILD-88a A.5 — THE WEEK IN REVIEW IS THE ACTIVITY REPORT ──────────────
// The weekly email listed gifts, asks, moves and past-due tasks: what the money
// did and what was still owed. It did not say what anyone DID. A fundraiser's
// week is conversations logged, gifts received, thank-yous sent, and follow-ups
// closed or let go — and that report existed nowhere, so nobody could answer
// "what happened last week?" without reading the database.
//
// ONE COUNTER, used by the weekly email AND by the People dashboard's "This
// week", so the two can never disagree. It takes a WINDOW rather than a period
// name, which is what makes the arithmetic checkable: the seven single-day
// windows of a week sum to the week, in cents, and tests/build88a-week.test.js
// asserts exactly that. A number you cannot take apart is a number nobody can
// audit.
//
// `userId` scopes to one person's work (the conversations they logged, the
// gifts on their donors, the threads they own); org-wide otherwise.
async function composeActivityReport(orgId, win, userId = null) {
  const { start, end } = win;
  const byUser = !!userId;
  // A conversation is a TOUCH, not every interaction: an automatic timeline
  // entry (a gift landing, a stage change) is not something a person did.
  const CONVERSATION_TYPES = ["call", "meeting", "email", "ask", "note", "stewardship"];
  const [conv, gifts, thanks, closed] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n FROM interactions i
         JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
        WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.date >= ? AND i.date <= ?
          AND i.type = ANY(?) ${byUser ? "AND i.created_by = ?" : ""}`,
      byUser ? [orgId, start, end, CONVERSATION_TYPES, userId] : [orgId, start, end, CONVERSATION_TYPES]),
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(g.amount),0) AS v FROM gifts g
         JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
          ${byUser ? "AND d.assigned_to = ?" : ""}`,
      byUser ? [orgId, start, end, userId] : [orgId, start, end]),
    // The stamp, not the flag: a gift acknowledged before A.5 carries no date
    // and belongs to no week rather than to this one.
    query(
      `SELECT COUNT(*)::int AS n FROM gifts g
         JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND d.deleted_at IS NULL
          AND g.acknowledgement_sent_at IS NOT NULL
          AND g.acknowledgement_sent_at >= ?::date AND g.acknowledgement_sent_at < (?::date + 1)
          ${byUser ? "AND d.assigned_to = ?" : ""}`,
      byUser ? [orgId, start, end, userId] : [orgId, start, end]),
    query(
      `SELECT t.close_kind, COUNT(*)::int AS n FROM threads t
         JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND d.deleted_at IS NULL AND t.closed_at IS NOT NULL
          AND t.closed_at >= ?::date AND t.closed_at < (?::date + 1)
          ${byUser ? "AND t.owner_id = ?" : ""}
        GROUP BY 1`,
      byUser ? [orgId, start, end, userId] : [orgId, start, end]),
  ]);
  const byKind = Object.fromEntries(closed.map(r => [r.close_kind, r.n]));
  // CENTS, through the one money seam. The week is compared against the sum of
  // its days and floats do not survive that comparison.
  const giftCents = money.toCents(gifts[0]?.v) ?? 0;
  return {
    window: { start, end }, scope: byUser ? "user" : "org", userId: userId || null,
    conversationsLogged: conv[0]?.n || 0,
    giftsReceived: gifts[0]?.n || 0,
    giftCents,
    giftDollars: money.toDollars(giftCents),
    thankYousMarkedSent: thanks[0]?.n || 0,
    threadsClosedByOutcome: byKind.outcome || 0,
    threadsDismissed: byKind.dismissed || 0,
  };
}

// The sentence each figure answers to. ONE string, read by the email and by the
// People dashboard — the BUILD-86 C.3 rule, applied to the activity report.
const ACTIVITY_DEFINITIONS = {
  conversationsLogged: "Calls, meetings, emails, asks and notes somebody logged in this window. A timeline entry Steward wrote itself is not one.",
  giftsReceived: "Gifts dated inside this window, counted and summed. Imported history counts on the date the file gave it.",
  thankYousMarkedSent: "Gifts marked acknowledged inside this window. A gift acknowledged before Steward began stamping the moment carries no date and is counted in no week.",
  threadsClosedByOutcome: "Follow-ups closed because the conversation happened.",
  threadsDismissed: "Follow-ups closed without one, with the reason recorded.",
};

// Compose the Week-in-Review sections for a window. officerId != null scopes
// every section to that officer's portfolio (their assigned donors + their
// tasks); org-wide otherwise. today gates the past-due-tasks section.
async function composeWeekInReview(orgId, win, officerId = null) {
  const { start, end } = win;
  const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75 A.5) — past-due gating on the ORG's civil date
  const dFilter = officerId ? "AND d.assigned_to = ?" : "";
  const dParam = officerId ? [officerId] : [];
  const gifts = await query(
    `SELECT g.amount, d.name AS donor_name, d.id AS donor_id FROM gifts g
     JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? ${dFilter}
     ORDER BY g.amount DESC`, [orgId, start, end, ...dParam]);
  const asks = await query(
    `SELECT o.name AS opp_name, o.target_amount, o.officer_name, d.name AS donor_name, d.id AS donor_id FROM opportunities o
     JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND d.deleted_at IS NULL AND o.created_at >= ? AND o.created_at < (?::date + 1) ${dFilter}
     ORDER BY o.target_amount DESC`, [orgId, start, end, ...dParam]);
  const moves = await query(
    `SELECT m.from_stage, m.to_stage, m.description, m.officer_name, d.name AS donor_name, d.id AS donor_id FROM moves m
     JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
     WHERE m.org_id = ? AND d.deleted_at IS NULL AND m.created_at >= ? AND m.created_at < (?::date + 1) ${dFilter}
     ORDER BY m.created_at DESC`, [orgId, start, end, ...dParam]);
  const tFilter = officerId ? "AND t.assigned_to = ?" : "";
  const pastDueTasks = await query(
    `SELECT t.title, t.due, t.assigned_to_name, d.name AS donor_name, d.id AS donor_id FROM tasks t
     LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
     WHERE t.org_id = ? AND t.done = 0 AND t.due IS NOT NULL AND t.due <> '' AND LEFT(t.due,10) < ? ${tFilter}
     ORDER BY t.due ASC`, [orgId, today, ...(officerId ? [officerId] : [])]);
  // BUILD-88a A.5 — the activity report rides with the sections, from the ONE
  // counter the People dashboard reads.
  const activity = await composeActivityReport(orgId, win, officerId);
  return {
    activity, activityDefinitions: ACTIVITY_DEFINITIONS,
    gifts: gifts.map(g => ({ donorId: g.donor_id, donorName: g.donor_name, amount: Number(g.amount) })),
    asks: asks.map(a => ({ donorId: a.donor_id, donorName: a.donor_name, name: a.opp_name, targetAmount: Number(a.target_amount || 0), officerName: a.officer_name })),
    moves: moves.map(m => ({ donorId: m.donor_id, donorName: m.donor_name, fromStage: m.from_stage, toStage: m.to_stage, description: m.description, officerName: m.officer_name })),
    pastDueTasks: pastDueTasks.map(t => ({ title: t.title, due: t.due, donorName: t.donor_name, assignedToName: t.assigned_to_name })),
    totals: {
      giftCount: gifts.length, giftTotal: gifts.reduce((s, g) => s + Number(g.amount), 0),
      askCount: asks.length, askTotal: asks.reduce((s, a) => s + Number(a.target_amount || 0), 0),
      moveCount: moves.length, pastDueCount: pastDueTasks.length,
    },
  };
}

// Compose one officer's monthly report: asks made, moves made, gifts closed,
// portfolio progress — the management-oversight artifact.
async function composeOfficerMonthly(orgId, win, officer) {
  const { start, end } = win;
  const [made] = await query(
    "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt FROM opportunities WHERE org_id=? AND officer_id=? AND created_at >= ? AND created_at < (?::date + 1)",
    [orgId, officer.id, start, end]);
  const [movesMade] = await query(
    "SELECT COUNT(*)::int AS cnt FROM moves WHERE org_id=? AND officer_id=? AND created_at >= ? AND created_at < (?::date + 1)",
    [orgId, officer.id, start, end]);
  const [won] = await query(
    "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt FROM opportunities WHERE org_id=? AND officer_id=? AND status='won' AND closed_at >= ? AND closed_at < (?::date + 1)",
    [orgId, officer.id, start, end]);
  const [portfolio] = await query(
    "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE org_id=? AND assigned_to=? AND deleted_at IS NULL",
    [orgId, officer.id]);
  return {
    officerId: officer.id, officerName: officer.name,
    asksMade: made.cnt, asksMadeAmount: Number(made.amt),
    movesMade: movesMade.cnt,
    giftsClosed: won.cnt, giftsClosedAmount: Number(won.amt),
    portfolioCount: portfolio.cnt, portfolioValue: Number(portfolio.val),
  };
}

// ── Digest HTML rendering (branded header + Steward frame) ──────────────────
const digestEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const digestMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
function digestSectionHtml(title, rowsHtml, emptyLine) {
  return `<div style="margin:22px 0 0;">
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1a6b4a;margin-bottom:8px;">${digestEsc(title)}</div>
    ${rowsHtml || `<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:13px;color:#8fa896;">${digestEsc(emptyLine)}</div>`}
  </div>`;
}
function renderWeekInReviewBody(sec, win, headingName) {
  // BUILD-88a A.5 — WHAT ANYBODY ACTUALLY DID. Every figure carries the
  // sentence it answers to, from the same constant the People dashboard reads.
  const a = sec.activity || {};
  const defs = sec.activityDefinitions || {};
  const actRow = (label, value, key) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee7d8;">
      <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;">${label}<span style="float:right;color:#0d5c3a;font-weight:800;">${value}</span></div>
      <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:11.5px;color:#6b7d70;margin-top:2px;max-width:420px;">${digestEsc(defs[key] || "")}</div>
    </td></tr>`;
  const activityBlock = `<div style="margin:22px 0 0;">
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1a6b4a;margin-bottom:8px;">What happened</div>
    <table style="border-collapse:collapse;width:100%;">
      ${actRow("Conversations logged", a.conversationsLogged || 0, "conversationsLogged")}
      ${actRow("Gifts received", `${a.giftsReceived || 0} · ${digestMoney(a.giftDollars || 0)}`, "giftsReceived")}
      ${actRow("Thank-yous marked sent", a.thankYousMarkedSent || 0, "thankYousMarkedSent")}
      ${actRow("Follow-ups closed by outcome", a.threadsClosedByOutcome || 0, "threadsClosedByOutcome")}
      ${actRow("Follow-ups dismissed", a.threadsDismissed || 0, "threadsDismissed")}
    </table>
  </div>`;
  const row = (a2, b) => `<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;padding:5px 0;border-bottom:1px solid #eee7d8;">${a2}${b ? `<span style="float:right;color:#0d5c3a;font-weight:700;">${b}</span>` : ""}</div>`;
  const gifts = sec.gifts.map(g => row(digestEsc(g.donorName), digestMoney(g.amount))).join("");
  const asks = sec.asks.map(a => row(`${digestEsc(a.donorName)}${a.name ? ` — ${digestEsc(a.name)}` : ""}`, digestMoney(a.targetAmount))).join("");
  const moves = sec.moves.map(m => row(`${digestEsc(m.donorName)} · ${digestEsc(m.fromStage || "—")} → ${digestEsc(m.toStage)}<div style="font-size:12px;color:#6b7d70;">${digestEsc(m.description)}</div>`, "")).join("");
  const tasks = sec.pastDueTasks.map(t => row(`${digestEsc(t.title)}${t.donorName ? ` · ${digestEsc(t.donorName)}` : ""}`, `due ${digestEsc((t.due || "").slice(0, 10))}`)).join("");
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Week in Review</div>
    <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(win.start)} – ${digestEsc(win.end)}${headingName ? ` · ${digestEsc(headingName)}` : ""}</div>
    <div style="margin:16px 0;padding:14px 16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;">
      <span style="font-weight:800;color:#0d5c3a;">${digestMoney(sec.totals.giftTotal)}</span> in ${sec.totals.giftCount} gift${sec.totals.giftCount === 1 ? "" : "s"} ·
      ${sec.totals.askCount} ask${sec.totals.askCount === 1 ? "" : "s"} ·
      ${sec.totals.moveCount} move${sec.totals.moveCount === 1 ? "" : "s"} ·
      <span style="color:${sec.totals.pastDueCount ? "#b8593f" : "#6b7d70"};font-weight:700;">${sec.totals.pastDueCount} past-due task${sec.totals.pastDueCount === 1 ? "" : "s"}</span>
    </div>
    ${activityBlock}
    ${digestSectionHtml("Gifts received", gifts, "No gifts recorded this week.")}
    ${digestSectionHtml("Asks / pledges made", asks, "No new asks logged this week.")}
    ${digestSectionHtml("Moves", moves, "No pipeline moves this week.")}
    ${digestSectionHtml("Past-due tasks", tasks, "Nothing past due — nice.")}
  </div>`;
}
function renderOfficerMonthlyBody(rep, win) {
  const stat = (l, v) => `<div style="display:inline-block;min-width:130px;margin:6px 14px 6px 0;"><div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6b7d70;">${l}</div><div style="font-size:20px;font-weight:800;color:#0f1a12;">${v}</div></div>`;
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Monthly Report — ${digestEsc(displayNameCase(rep.officerName))}</div>
    <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(win.start)} – ${digestEsc(win.end)}</div>
    <div style="margin-top:16px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;">
      ${stat("Asks made", `${rep.asksMade} · ${digestMoney(rep.asksMadeAmount)}`)}
      ${stat("Moves made", rep.movesMade)}
      ${stat("Gifts closed", `${rep.giftsClosed} · ${digestMoney(rep.giftsClosedAmount)}`)}
      ${stat("Portfolio", `${rep.portfolioCount} · ${digestMoney(rep.portfolioValue)}`)}
    </div>
  </div>`;
}

// "Due for a touch" — the real-data nudge behind an otherwise-empty digest
// (BUILD-35 Part 2): assigned (or org-wide) donors with no interaction in the
// last 30 days. An all-zero stat row shames and spams; a computed nudge tells
// the officer the one useful thing their data actually says.
async function countDonorsDueForTouch(orgId, officerId = null) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const oFilter = officerId ? "AND d.assigned_to = ?" : "";
  const [row] = await query(
    `SELECT COUNT(*)::int AS n FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE ${oFilter}
       AND NOT EXISTS (SELECT 1 FROM interactions i
                       WHERE i.donor_id = d.id AND i.org_id = d.org_id AND LEFT(i.date,10) >= ?)`,
    officerId ? [orgId, officerId, cutoff] : [orgId, cutoff]);
  return row.n;
}

const digestNudgeHtml = (line, linkLabel) =>
  `<div style="margin-top:16px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;line-height:1.6;">
    ${line}
    <div style="margin-top:10px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">${linkLabel} →</a></div>
  </div>`;

// Reserve one recipient's digest (idempotency choke point). Returns the row id
// if newly reserved, or null if it was already sent this period.
async function reserveDigest(orgId, digestType, periodKey, recipientUserId, recipientEmail, scope, meta) {
  const id = "dg_" + uuid().slice(0, 8);
  const reserved = await query(
    `INSERT INTO digest_sends (id,org_id,digest_type,period_key,recipient_user_id,recipient_email,scope,meta)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id,digest_type,period_key,recipient_user_id) DO NOTHING
     RETURNING id`,
    [id, orgId, digestType, periodKey, recipientUserId, recipientEmail || null, scope || null, JSON.stringify(meta || {})]);
  return reserved.length ? id : null;
}

// Run both digests for one org for the given windows. send=false → compose
// only (preview/dry-run), reserving nothing. Returns what was sent + skipped.
async function runDigestsForOrg(org, { wk, mo, types = ["weekly", "monthly"], send = true }) {
  const tier = orgPlanTier(org);
  const out = { weekly: { sent: [], skipped: [] }, monthly: { sent: [], skipped: [] } };
  // Checked before anything is RESERVED, not just before it is sent: a
  // reserved period is a promise never to retry it, so reserving for an org
  // that may not send would silently burn the week it would have reported on
  // once mail is turned back on. send=false (dry-run/preview) is composition
  // only and stays allowed — looking at what a digest WOULD say is how you
  // check an org is safe to re-enable.
  if (send) {
    const gate = await orgMaySendEmail(org && org.id);
    if (!gate.send) {
      out.gated = gate.reason;
      return out;
    }
  }
  const users = await query("SELECT id, name, email, role FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);

  // ── Weekly Week-in-Review — every user. On Team, an admin/ED sees org-wide;
  //    an officer sees their own portfolio + a team roll-up. On Core (incl.
  //    single-user), everyone gets the whole org-wide digest.
  if (types.includes("weekly")) {
    const orgWide = await composeWeekInReview(org.id, wk, null);
    for (const u of users) {
      const isOfficerScope = tier === "team" && u.role !== "admin";
      const sec = isOfficerScope ? await composeWeekInReview(org.id, wk, u.id) : orgWide;
      const scope = isOfficerScope ? "officer" : "org";
      const teamRollup = isOfficerScope ? orgWide.totals : null;
      const payload = { recipientUserId: u.id, email: u.email, scope, periodKey: wk.key, sections: sec, teamRollup };
      if (!send) { out.weekly.sent.push(payload); continue; }
      // A fully-empty week never sends four "No X this week" sections
      // (BUILD-35 Part 2): if real data offers a nudge (donors due for a
      // touch), send that instead; if there's genuinely nothing actionable,
      // reserve the period (so the tick never retries) and send nothing.
      const wkEmpty = sec.totals.giftCount === 0 && sec.totals.askCount === 0 && sec.totals.moveCount === 0 && sec.totals.pastDueCount === 0;
      const wkDue = wkEmpty ? await countDonorsDueForTouch(org.id, isOfficerScope ? u.id : null) : 0;
      const rid = await reserveDigest(org.id, "weekly", wk.key, u.id, u.email, scope, wkEmpty ? { ...sec.totals, empty: true, dueForTouch: wkDue, suppressed: wkDue === 0 } : sec.totals);
      if (!rid) { out.weekly.skipped.push({ recipientUserId: u.id }); continue; }
      if (wkEmpty && wkDue === 0) { out.weekly.skipped.push({ recipientUserId: u.id, suppressed: true }); continue; }
      const rollupLine = teamRollup ? `<div style="padding:0 22px 22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#6b7d70;">Team roll-up: ${digestMoney(teamRollup.giftTotal)} · ${teamRollup.giftCount} gifts · ${teamRollup.moveCount} moves org-wide.</div>` : "";
      const body = wkEmpty
        ? `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
            <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Week in Review</div>
            <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(wk.start)} – ${digestEsc(wk.end)}${isOfficerScope ? ` · ${digestEsc(displayNameCase(u.name))}` : ""}</div>
            ${digestNudgeHtml(`A quiet week — nothing logged. <strong>${wkDue}</strong> donor${wkDue === 1 ? "" : "s"} ${isOfficerScope ? "in your portfolio " : ""}${wkDue === 1 ? "is" : "are"} due for a touch — a call or note this week keeps them from drifting.`, "Open Steward")}
          </div>` + rollupLine
        : renderWeekInReviewBody(sec, wk, isOfficerScope ? displayNameCase(u.name) : null) + rollupLine;
      await sendDigestEmail(org, u.email, `Week in Review — ${displayNameCase(org.name)}`, body);
      out.weekly.sent.push(payload);
    }
  }

  // ── Monthly per-officer report — [Team] only. One email per officer.
  if (types.includes("monthly") && tier === "team") {
    for (const u of users) {
      const rep = await composeOfficerMonthly(org.id, mo, u);
      const payload = { recipientUserId: u.id, email: u.email, periodKey: mo.key, report: rep };
      if (!send) { out.monthly.sent.push(payload); continue; }
      // An all-zero month must never render "0 asks · 0 moves · 0 gifts" at an
      // officer (BUILD-35 Part 2). If their portfolio offers a real nudge,
      // send that; if nothing is actionable either, reserve the period (no
      // tick retries) and send nothing this month.
      const allZero = rep.asksMade === 0 && rep.movesMade === 0 && rep.giftsClosed === 0;
      const moDue = allZero ? await countDonorsDueForTouch(org.id, u.id) : 0;
      const rid = await reserveDigest(org.id, "monthly", mo.key, u.id, u.email, "officer",
        allZero ? { asksMade: 0, giftsClosed: 0, empty: true, dueForTouch: moDue, suppressed: moDue === 0 } : { asksMade: rep.asksMade, giftsClosed: rep.giftsClosed });
      if (!rid) { out.monthly.skipped.push({ recipientUserId: u.id }); continue; }
      if (allZero && moDue === 0) { out.monthly.skipped.push({ recipientUserId: u.id, suppressed: true }); continue; }
      const body = allZero
        ? `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
            <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Monthly Report — ${digestEsc(displayNameCase(rep.officerName))}</div>
            <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(mo.start)} – ${digestEsc(mo.end)}</div>
            ${digestNudgeHtml(`No moves logged this month — <strong>${moDue}</strong> prospect${moDue === 1 ? "" : "s"} in your portfolio ${moDue === 1 ? "is" : "are"} due for a touch. One conversation this week is next month's ask.`, "Open your pipeline")}
          </div>`
        : renderOfficerMonthlyBody(rep, mo);
      await sendDigestEmail(org, u.email, `Your Monthly Report — ${displayNameCase(org.name)}`, body);
      out.monthly.sent.push(payload);
    }
  }
  return out;
}

async function composeDailyTaskReminder(orgId, userId, today) {
  const rows = await query(
    `SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id=t.donor_id AND d.org_id=t.org_id
      WHERE t.org_id=? AND t.assigned_to=? AND t.done=0
        AND t.due IS NOT NULL AND t.due <> '' AND LEFT(t.due,10) <= ?
      ORDER BY t.due ASC`,
    [orgId, userId, today]);
  const overdue = rows.filter(r => String(r.due).slice(0, 10) < today);
  const dueToday = rows.filter(r => String(r.due).slice(0, 10) === today);
  return { rows, overdue, dueToday, count: rows.length };
}

function renderDailyTaskReminderBody(digest, org, user, today) {
  const li = t => {
    const badge = String(t.due).slice(0, 10) < today
      ? `<span style="color:#8a3a24;font-weight:700;">Overdue</span>`
      : `<span style="color:#8a6d1f;font-weight:700;">Today</span>`;
    const donor = t.donor_name ? ` · ${digestEsc(displayNameCase(t.donor_name))}` : "";
    return `<li style="margin:6px 0;color:#0f1a12;">${digestEsc(t.title)} <span style="color:#6b7d70;">— ${badge}<span style="color:#6b7d70;"> ${digestEsc(String(t.due).slice(0, 10))}${donor}</span></span></li>`;
  };
  const overdueBlock = digest.overdue.length
    ? `<div style="font-weight:700;color:#8a3a24;margin-top:12px;">Overdue (${digest.overdue.length})</div><ul style="margin:4px 0 0;padding-left:18px;">${digest.overdue.map(li).join("")}</ul>` : "";
  const todayBlock = digest.dueToday.length
    ? `<div style="font-weight:700;color:#8a6d1f;margin-top:12px;">Due today (${digest.dueToday.length})</div><ul style="margin:4px 0 0;padding-left:18px;">${digest.dueToday.map(li).join("")}</ul>` : "";
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Your tasks for today</div>
      <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(displayNameCase(user.name || ""))} · ${digestEsc(today)}</div>
      ${todayBlock}${overdueBlock}
      <div style="margin-top:16px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">Open your tasks →</a></div>
    </div>`;
}

// Run the daily reminder for one org. send=false → compose only (preview),
// reserving nothing. Non-empty is required to send. Returns sent/skipped.
// BUILD-85 — there is ONE morning sender now. This name survives because the
// ops route and the suites call it; underneath, it is the brief, which carries
// the task section this function used to send on its own. Both ticks land
// here, and the digest_sends reservations make the second one a no-op.
async function runDailyTaskRemindersForOrg(org, opts) { return runMorningBriefForOrg(org, opts); }

// ── BUILD-84 P0-4 — GEOCODING IS A WRITE-TIME JOB ───────────────────────────
// The map used to geocode at render, in the browser, one address per request,
// storing nothing (geocode.js's header has the full account). Coordinates are
// donor data now: written once, re-read forever, re-computed only when the
// address itself changes.
//
// Three entry points and no others:
//   markDonorsForGeocoding()  — a write said an address may have changed
//   processGeocodeQueue()     — the 5-minute tick drains `pending`
//   POST /geocode/run         — the ops/test hook that drives it NOW
// Nothing on a read path may call any of them.

// A DONOR-SIDED job budget. Every tick states how many provider requests it
// spent for how many addresses, the same way the import states its write
// round trips — a cost you cannot see is a cost nobody manages.
const GEOCODE_TICK_BUDGET = Number(process.env.GEOCODE_TICK_BUDGET) || 500;

// processGeocodeQueue(opts) — drain `pending`, oldest org first, up to the
// tick's budget. Batched: one provider request per 1,000 addresses on Geocodio.
// Every row leaves with a TERMINAL status, so "still processing" can never be
// a permanent state that the map has to paper over.
async function processGeocodeQueue({ limit = GEOCODE_TICK_BUDGET, orgId = null } = {}) {
  const cfg = geocode.providerConfig();
  if (cfg.name === "unconfigured") return { provider: cfg.name, reason: cfg.reason, looked_up: 0, requests: 0 };
  const scope = orgId ? " AND org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const rows = await query(
    `SELECT id, org_id, address, address2, city, state, zip, country, geocode_key
       FROM donors WHERE geocode_status = 'pending' AND deleted_at IS NULL${scope}
      ORDER BY updated_at ASC, id ASC LIMIT ?`, params);
  if (!rows.length) return { provider: cfg.name, looked_up: 0, requests: 0 };

  // De-duplicate by KEY before spending a request: an org with 400 donors in
  // one town is one lookup, not 400. This is the other half of the caching
  // requirement, and the reason a real first import costs far less than its
  // row count suggests.
  const byKey = new Map();
  for (const d of rows) {
    const k = d.geocode_key || geocode.addressKey(d);
    if (!byKey.has(k)) byKey.set(k, { query: geocode.addressQuery(d), ids: [] });
    byKey.get(k).ids.push(d.id);
  }
  const keys = [...byKey.keys()];
  const t0 = Date.now();
  const { results, requests, provider } = await geocode.geocodeAddresses(keys.map(k => byKey.get(k).query), { config: cfg });

  const buckets = { ok: [], not_found: [], failed: [] };
  const coords = new Map();
  keys.forEach((k, i) => {
    const r = results[i] || { status: "failed", error: "no result" };
    const ids = byKey.get(k).ids;
    (buckets[r.status] || buckets.failed).push(...ids);
    if (r.status === "ok") for (const id of ids) coords.set(id, r);
  });
  for (const [status, ids] of Object.entries(buckets)) {
    if (!ids.length) continue;
    if (status === "ok") {
      await run(`UPDATE donors SET geocode_status='ok', geocoded_at=NOW(), geocode_provider=?,
                   latitude=v.lat::double precision, longitude=v.lng::double precision
                   FROM (SELECT * FROM UNNEST(?::text[], ?::text[], ?::text[]) AS t(id, lat, lng)) AS v
                  WHERE donors.id = v.id`,
                [provider, ids, ids.map(id => String(coords.get(id).lat)), ids.map(id => String(coords.get(id).lng))]);
    } else {
      await run(`UPDATE donors SET geocode_status=?, geocoded_at=NOW(), geocode_provider=?,
                   latitude=NULL, longitude=NULL WHERE id = ANY(?)`, [status, provider, ids]);
    }
  }
  const out = { provider, looked_up: rows.length, distinct: keys.length, requests,
                ok: buckets.ok.length, not_found: buckets.not_found.length, failed: buckets.failed.length,
                ms: Date.now() - t0 };
  console.log(`[geocode] provider=${provider} rows=${out.looked_up} distinct=${out.distinct} requests=${out.requests} ` +
              `ok=${out.ok} not_found=${out.not_found} failed=${out.failed} ${out.ms}ms`);
  return out;
}


// ── BUILD-94 Part 1 — THE IMPORT PHOTO QUEUE ───────────────────────────────
// Same shape as the BUILD-84 geocode queue, for the same reason: the network
// does not belong inside an import transaction. A mapped photo column lands as
// photo_source_url + photo_fetch_status='pending'; this drains it.
//
// EVERY row leaves with a terminal status and, on failure, a reason ON THE ROW
// — "it just has no photo" is the outcome nobody can debug, and BUILD-84's
// rule stands: a catch may not blame the data for a bug.

// The one place a spreadsheet's URL becomes an outbound request.
const PHOTO_FETCH_BUDGET = 200;   // rows per tick
const PHOTO_FETCH_CONCURRENCY = 4;

// Fetch ONE remote image under the BUILD-37 G5 rules. Returns
// { buffer, contentType } or { error }. Never throws.
async function fetchRemoteImage(rawUrl) {
  const check = personPhoto.checkRemoteImageUrl(rawUrl);
  if (!check.ok) return { error: check.reason };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), personPhoto.PHOTO_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(check.url, { redirect: "follow", signal: ac.signal, headers: { accept: "image/*" } });
    if (!r.ok) return { error: `http ${r.status}` };
    // A redirect can land somewhere the string check could not see. `r.url` is
    // the FINAL URL after following, so re-running the guard on it closes the
    // "https://example.org/x → http://169.254.169.254/" hop.
    const after = personPhoto.checkRemoteImageUrl(r.url || check.url);
    if (!after.ok) return { error: `redirected to ${after.reason}` };
    const len = Number(r.headers.get("content-length") || 0);
    if (len > personPhoto.PHOTO_MAX_BYTES) return { error: "larger than 10 MB" };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { error: "empty response" };
    if (buf.length > personPhoto.PHOTO_MAX_BYTES) return { error: "larger than 10 MB" };
    // Type by CONTENT, never by the header or the extension — the same rule
    // the upload route follows.
    const ct = ["image/png", "image/jpeg", "image/gif", "image/webp"]
      .find(m => imageBytesMatchMime(m, buf));
    if (!ct) return { error: "not an image" };
    return { buffer: buf, contentType: ct };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timed out after 10s" : (e.message || "fetch failed") };
  } finally { clearTimeout(timer); }
}

async function processPhotoQueue({ limit = PHOTO_FETCH_BUDGET, orgId = null } = {}) {
  const scope = orgId ? " AND org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const rows = await query(
    `SELECT id, org_id, photo_source_url FROM donors
      WHERE photo_fetch_status = 'pending' AND deleted_at IS NULL${scope}
      ORDER BY updated_at ASC, id ASC LIMIT ?`, params);
  if (!rows.length) return { fetched: 0, failed: 0, scanned: 0 };

  let fetched = 0, failed = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const got = await fetchRemoteImage(row.photo_source_url);
      if (got.error) {
        failed++;
        // Logged per row, and kept on the row. Never fatal.
        console.error(`[person-photo] import row ${row.id}: ${got.error}`);
        await run(`UPDATE donors SET photo_fetch_status='failed', photo_fetch_error=? WHERE id=?`,
          [String(got.error).slice(0, 200), row.id]).catch(() => {});
        continue;
      }
      try {
        let out;
        const sharp = require("sharp");
        const r = await sharp(got.buffer, { failOn: "none" }).rotate()
          .resize(personPhoto.PHOTO_SIZE, personPhoto.PHOTO_SIZE, { fit: "cover", position: "attention" })
          .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        out = { buffer: r.data, width: r.info.width, height: r.info.height };
        const asset = await putThemeAsset({
          orgId: row.org_id, kind: personPhoto.PHOTO_ASSET_KIND,
          buffer: out.buffer, contentType: "image/webp", width: out.width, height: out.height,
        });
        await run(`UPDATE donors SET photo_asset_id=?, photo_fetch_status='ok', photo_fetch_error=NULL WHERE id=?`,
          [asset.id, row.id]);
        fetched++;
      } catch (e) {
        failed++;
        console.error(`[person-photo] import row ${row.id}: store failed:`, e.message);
        await run(`UPDATE donors SET photo_fetch_status='failed', photo_fetch_error=? WHERE id=?`,
          [("could not store: " + e.message).slice(0, 200), row.id]).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PHOTO_FETCH_CONCURRENCY, rows.length) }, worker));
  return { fetched, failed, scanned: rows.length };
}

// ── BUILD-81 Part 2 — THE NUDGE LEAVES THE APP ──────────────────────────────
// A reminder in a dashboard nobody opens is not a reminder. ONE email per
// user per weekday morning, listing every open thread that is due or
// overdue, oldest first. Nothing on weekends by default (org toggle
// thread_nudge_weekends). NO email when nothing is due, and an empty morning
// reserves nothing. The SUBJECT is what escalates ("2 threads open · Bill
// Harmon, day 3" becomes "… day 11"); the body doesn't nag, the number does.
// Links open the donor's log-one-line screen in the app — a GET changes
// NOTHING (mail clients prefetch links); Done and Snooze happen there, after
// a page load, as POSTs. Idempotent per (org, user, day) via digest_sends
// ('thread_nudge', day:YYYY-MM-DD); per-user off switch notify_thread_nudge
// (default on); rides the existing 5-minute tick — never a second scheduler.

// Weekday check on the ORG's civil day (orgTime.dayOfWeek: 0=Mon … 6=Sun).
function threadNudgeDayOk(org, todayStr) {
  const dow = orgTime.dayOfWeek(todayStr);
  if (dow === null) return false;
  return dow < 5 || !!org.thread_nudge_weekends;
}

// BUILD-85 — Every open thread due or overdue on `today` THAT THIS PERSON
// OWNS. BUILD-81 selected the whole org and handed the identical list to
// everybody: at a two-person shop that is invisible, and at six officers it is
// the classic failure — if it is everyone's list it is no one's. Unowned
// threads ride the ADMIN's list (a backstop, so nothing is orphaned) and
// nobody else's. Ranked and capped by shared/threadRank.js, so the ten rows
// an email can carry are the right ten.
async function composeThreadNudge(orgId, today, { userId = null, isAdmin = false } = {}) {
  const ownerClause = !userId ? ""
    : (isAdmin ? "AND (t.owner_id = ? OR t.owner_id IS NULL)" : "AND t.owner_id = ?");
  const rows = await query(
    `SELECT t.id, t.donor_id, d.name AS donor_name, t.next_step_type, t.next_step_label,
            t.due_date, t.due_time, t.opened_on, d.total_giving, d.gift_count, t.opening_gift_id
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
        AND t.due_date <= ? ${ownerClause}
      ORDER BY t.opened_on ASC, t.due_date ASC`,
    userId ? [orgId, today, today, userId] : [orgId, today, today]);
  // BUILD-84 FEATURE — PRECEDENCE, read from the ONE function that states it
  // (shared/threadShape.js digestShouldSkip): a task with a time sends its own
  // email at that time and is out of the digest ON ITS DUE DATE ONLY. Left
  // open, it rejoins the next morning as overdue, counted like everything
  // else. No task is ever reported twice on the same day.
  const { digestShouldSkip } = await threadShapeMod();
  const rank = await threadRankMod();
  const eligible = rows.filter(r => !digestShouldSkip(r, today));
  if (!eligible.length) return [];

  // The same rank signals the queue uses, read in batches for exactly the
  // donors on this person's list — never one query per row.
  const donorIds = [...new Set(eligible.map(r => r.donor_id))];
  const ph = donorIds.map(() => "?").join(",");
  const asks = {}; const atRisk = new Set();
  for (const a of await query(
    `SELECT donor_id, COALESCE(SUM(target_amount),0) AS amt FROM opportunities
      WHERE org_id = ? AND status = 'open' AND donor_id IN (${ph}) GROUP BY donor_id`,
    [orgId, ...donorIds])) asks[a.donor_id] = parseFloat(a.amt) || 0;
  for (const r of await query(
    `SELECT DISTINCT donor_id FROM recurring_subscriptions
      WHERE org_id = ? AND donor_id IN (${ph}) AND status IN ('past_due','recovering')`,
    [orgId, ...donorIds])) atRisk.add(r.donor_id);
  const [{ p90 } = {}] = await query(
    `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_giving) AS p90
       FROM donors WHERE org_id = ? AND deleted_at IS NULL AND total_giving > 0`, [orgId]);
  const majorThreshold = parseFloat(p90) || 0;

  const shaped = eligible.map(r => ({
    id: r.id, donorId: r.donor_id,
    donorName: displayNameCase(r.donor_name || ""),
    stepLabel: r.next_step_label, due: r.due_date,
    nextStep: { due: r.due_date },
    daysOpen: Math.max(0, orgTime.daysBetween(r.opened_on, today) ?? 0),
    dueDate: r.due_date, stepType: r.next_step_type, stepLabel: r.next_step_label,
    openAskAmount: asks[r.donor_id] || 0,
    recurringAtRisk: atRisk.has(r.donor_id),
    isFirstGift: !!r.opening_gift_id && Number(r.gift_count) === 1,
    lifetimeGiving: parseFloat(r.total_giving) || 0,
    majorThreshold,
  }));
  const q = rank.buildQueue(shaped, today, { cap: rank.EMAIL_CAP });
  return q.list.map(t => ({
    id: t.id, donorId: t.donorId, donorName: t.donorName, stepLabel: t.stepLabel,
    due: t.due, daysOpen: t.daysOpen, why: t.rank.why, band: t.band,
  }));
}

// The same list plus what the cap left behind, for the email's "and N more".
async function composeThreadNudgeQueue(orgId, today, opts) {
  const list = await composeThreadNudge(orgId, today, opts);
  const rank = await threadRankMod();
  // buildQueue already capped; `total` is recoverable from the unranked count,
  // which is cheaper to ask for again than to thread through the composer.
  const ownerClause = !opts?.userId ? ""
    : (opts.isAdmin ? "AND (t.owner_id = ? OR t.owner_id IS NULL)" : "AND t.owner_id = ?");
  const [{ n } = { n: 0 }] = await query(
    `SELECT COUNT(*)::int AS n FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?) AND t.due_date <= ? ${ownerClause}`,
    opts?.userId ? [orgId, today, today, opts.userId] : [orgId, today, today]);
  return { list, total: n, more: Math.max(0, n - list.length), cap: rank.EMAIL_CAP };
}

// BUILD-85 — ONE subject for ONE email. The count is everything waiting on
// this person (threads AND tasks); the escalation is still the oldest thread,
// named, with its day count — the BUILD-81 line that made the subject do the
// work. A brief with no threads falls back to the task sentence rather than
// inventing a thread that is not there.
function morningBriefSubject(threads, taskCount, org) {
  const total = threads.length + taskCount;
  if (threads.length === 0) {
    return `${taskCount} task${taskCount === 1 ? "" : "s"} need${taskCount === 1 ? "s" : ""} you today — ${displayNameCase(org.name || "")}`;
  }
  // BUILD-86 FIX — the escalation names the thread the QUEUE says to do first,
  // not the one that has been open longest. `threads` arrives rank-ordered
  // (shared/threadRank.js), so threads[0] is that one.
  //
  // Picking the oldest was BUILD-81's idea and it was right when nothing was
  // ranked. It stopped being right the moment a thread could be deliberately
  // deferred: a revisit-snoozed thread carries a huge `daysOpen` and would own
  // the subject line of every morning email for as long as it was open. The
  // day count still rides along, because a number in the subject is what made
  // the line work.
  const lead = threads[0];
  return `${total} waiting on you · ${lead.donorName}, day ${lead.daysOpen}`;
}

// BUILD-85 — the brief's body. Threads first (the spine), then the tasks that
// were a second email until today, then — for an admin at a multi-officer shop
// — a roll-up of counts, never everyone's rows.
//
// EVERY THREAD ROW CARRIES ITS REASON. shared/threadRank.js decided the order;
// this prints the sentence that order was built from, so the list can always
// answer "why am I looking at this one first?" without the reader guessing.
function renderMorningBriefBody({ threads, more, tasks, org, user, today, team }) {
  const INK = "#0f1a12", SAGE = "#6b7d70", EMERALD = "#0d5c3a", BRASS = "#c9a84c", TERRA = "#8a3a24";
  const row = t => {
    const url = `${publicAppUrl()}/donors/${encodeURIComponent(t.donorId)}?conversation=1`;
    const late = t.band === "overdue";
    return `<tr><td style="padding:9px 0;border-bottom:1px solid #e4e0d6;">
      <div style="font-size:14px;color:${INK};">
        <a href="${url}" style="color:${EMERALD};font-weight:700;text-decoration:underline;">${digestEsc(t.donorName)}</a>
        <span style="color:${SAGE};"> · ${digestEsc(t.stepLabel)} · day ${t.daysOpen}</span>
      </div>
      ${t.why ? `<div style="font-size:12px;color:${late ? TERRA : SAGE};margin-top:2px;">${digestEsc(t.why)}</div>` : ""}
    </td></tr>`;
  };
  const threadBlock = threads.length ? `
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:19px;color:${INK};margin-top:4px;">These are waiting on you.</div>
    <div style="font-size:12.5px;color:${SAGE};margin-top:2px;">Each name opens the donor's record. Log what happened there, and the next step comes back when it is due.</div>
    <table style="margin-top:10px;border-collapse:collapse;width:100%;">${threads.map(row).join("")}</table>
    ${more > 0 ? `<div style="font-size:12px;color:${SAGE};margin-top:8px;">and ${more} more open · <a href="${publicAppUrl()}/dashboard" style="color:${EMERALD};">see the whole list</a></div>` : ""}` : "";

  const taskLi = t => {
    const late = String(t.due).slice(0, 10) < today;
    const donor = t.donor_name ? ` · ${digestEsc(displayNameCase(t.donor_name))}` : "";
    return `<tr><td style="padding:7px 0;font-size:13.5px;color:${INK};">
      ${digestEsc(t.title)}<span style="color:${late ? TERRA : SAGE};font-weight:700;"> · ${late ? "Overdue" : "Due today"}</span><span style="color:${SAGE};">${donor}</span></td></tr>`;
  };
  // BUILD-88a A.2 — DUE TODAY GOES FIRST. The late list led, so the thing she
  // has to do TODAY sat underneath the things she is already late for, and the
  // list she cannot fix pushed the one she can down the screen. (A JS comment,
  // not an HTML one: a comment inside the body would be text in the email, and
  // a word in it can make an assertion about the email's own ORDER read wrong —
  // which is exactly what happened when this one was written the other way.)
  const taskBlock = tasks.count ? `
    <div style="margin-top:22px;padding-top:14px;border-top:2px solid ${BRASS};">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${INK};">Your tasks</div>
      <table style="margin-top:6px;border-collapse:collapse;width:100%;">${[...tasks.dueToday, ...tasks.overdue].map(taskLi).join("")}</table>
    </div>` : "";

  const teamBlock = team && team.length ? `
    <div style="margin-top:22px;padding-top:14px;border-top:1px solid #dcd8cd;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${SAGE};">Across the team</div>
      <table style="margin-top:6px;border-collapse:collapse;">${team.map(r =>
        `<tr><td style="padding:3px 0;font-size:13px;color:${INK};">${digestEsc(displayNameCase(r.who))}<span style="color:${SAGE};"> · ${r.n} open${r.overdue ? ` · ${r.overdue} overdue` : ""}</span></td></tr>`).join("")}</table>
    </div>` : "";

  // CAN-SPAM: the org's mailing address in the footer. No address on file →
  // the email SAYS SO and links to add it, never a footer that pretends.
  const addr = org.receipt_address && String(org.receipt_address).trim();
  const footer = addr
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:${SAGE};">${digestEsc(displayNameCase(org.legal_name || org.name || ""))} · ${digestEsc(addr)}</div>`
    : `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:${SAGE};">Steward has no mailing address on file for ${digestEsc(displayNameCase(org.name || ""))}, so this footer cannot carry one yet. <a href="${publicAppUrl()}/dashboard" style="color:${EMERALD};">Add it in Settings</a> and it will.</div>`;

  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-size:11.5px;letter-spacing:0.1em;text-transform:uppercase;color:${SAGE};">${digestEsc(displayNameCase(user?.name || ""))} · ${digestEsc(today)}</div>
      ${threadBlock}${taskBlock}${teamBlock}${footer}
    </div>`;
}

// ── BUILD-85 — THE MORNING BRIEF: ONE EMAIL ────────────────────────────────
// Before this, `processDailyTaskReminders` and `processThreadNudges` shared
// the SAME [6,12) window and sent two separate emails to the same person, with
// two different scoping rules — the Thread was meant to end the tasks battle
// and was instead standing next to it. This is the one sender.
//
// IT RESERVES BOTH LEDGERS. `thread_nudge` and `daily_tasks` each keep their
// own digest_sends key, so whichever tick arrives first sends the combined
// brief and the other finds the reservations taken and does nothing. Two
// timers, one email, and neither idempotency ledger had to be rewritten.
//
// BOTH PREFERENCES STILL MEAN SOMETHING. A user opted out of `daily_tasks`
// gets a brief with no task section; opted out of `thread_nudge`, no thread
// section; opted out of both, no email at all and nothing reserved.
async function runMorningBriefForOrg(org, { today, send = true }) {
  const out = { sent: [], skipped: [] };
  const users = await query("SELECT id, name, email, role FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);

  // The team roll-up an ADMIN gets beneath their own list: counts per officer,
  // never everyone's rows. Oversight is a shape, not a longer list.
  const teamRows = await query(
    `SELECT COALESCE(t.owner_name, 'Unassigned') AS who, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE t.due_date < ?)::int AS overdue
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
      GROUP BY 1 ORDER BY 2 DESC`, [today, org.id, today]);
  const multiOfficer = teamRows.filter(r => r.who !== "Unassigned").length >= 2;

  for (const u of users) {
    const isAdmin = u.role === "admin";
    const wantsThreads = await userWantsEmail(u.id, "thread_nudge");
    const wantsTasks   = await userWantsEmail(u.id, "daily_tasks");

    // THE WEEKEND RULE IS THE THREAD SECTION'S, not the email's. A list of
    // open threads on a Saturday is an intrusion nobody asked for; a task the
    // user dated Saturday is a commitment they made. So the brief can still
    // go out on a weekend carrying tasks, and simply has no thread section.
    const threadsAllowedToday = threadNudgeDayOk(org, today);
    // Compose FIRST, apply the preference SECOND. Doing it the other way round
    // cannot tell "this person has a clear morning" from "this person turned
    // the notification off and is missing three overdue threads" — and those
    // are the two facts whoever reads this report most needs apart.
    const tqAll = threadsAllowedToday ? await composeThreadNudgeQueue(org.id, today, { userId: u.id, isAdmin }) : { list: [], more: 0, total: 0 };
    const taskAll = await composeDailyTaskReminder(org.id, u.id, today);
    const suppressed = (!wantsThreads && tqAll.list.length > 0) || (!wantsTasks && taskAll.count > 0);
    const tq = wantsThreads ? tqAll : { list: [], more: 0, total: 0 };
    const taskDigest = wantsTasks ? taskAll : { rows: [], overdue: [], dueToday: [], count: 0 };
    if (tq.list.length === 0 && taskDigest.count === 0) {
      // WHY there is no email matters to whoever is reading this report: a
      // person who turned both notifications off is not the same as a person
      // with a clear morning, and reporting both as "empty" hides a setting
      // somebody may not have meant to leave that way.
      out.skipped.push({ recipientUserId: u.id, reason: suppressed ? "opted_out" : "empty" });
      continue;
    }

    const subject = morningBriefSubject(tq.list, taskDigest.count, org);
    const payload = { recipientUserId: u.id, email: u.email, subject,
                      threads: tq.list.length, tasks: taskDigest.count, count: tq.list.length + taskDigest.count };
    if (!send) { out.sent.push(payload); continue; }

    // Reserve only the ledgers whose section this brief actually carries. A
    // section whose day is already reserved is DROPPED from the body, not
    // re-sent — so a second tick can never repeat a line the user has read.
    let threads = tq.list, more = tq.more, tasks = taskDigest;
    if (threads.length && !(await reserveDigest(org.id, "thread_nudge", "day:" + today, u.id, u.email, "user", { count: threads.length, oldestDays: threads[0].daysOpen }))) { threads = []; more = 0; }
    if (tasks.count && !(await reserveDigest(org.id, "daily_tasks", "day:" + today, u.id, u.email, "user", { count: tasks.count, overdue: tasks.overdue.length }))) tasks = { rows: [], overdue: [], dueToday: [], count: 0 };
    if (threads.length === 0 && tasks.count === 0) { out.skipped.push({ recipientUserId: u.id, reason: "already_sent" }); continue; }

    const body = renderMorningBriefBody({ threads, more, tasks, org, user: u, today,
                                          team: isAdmin && multiOfficer ? teamRows : null });
    await sendDigestEmail(org, u.email, morningBriefSubject(threads, tasks.count, org), body);
    out.sent.push({ ...payload, threads: threads.length, tasks: tasks.count });
  }
  return out;
}

// Kept as the name the ops route and the suites call. One sender underneath.
async function runThreadNudgesForOrg(org, opts) { return runMorningBriefForOrg(org, opts); }

// ── BUILD-84 FEATURE — A TASK WITH A TIME ON IT EMAILS AT THAT TIME ─────────
//
// A next step set for Monday at 2:00 sends ONE email Monday at 2:00, carrying
// the task, the donor, and a button into that donor's log-one-line screen. Not
// a reminder that it exists — a reminder at the moment the person said they
// would do it. The morning digest is the weaker form of the same promise: she
// reads it at eight, the call is at two, and by two the email is four screens
// up. This is the one notification that arrives while it can still change what
// she does.
//
// PRECEDENCE lives in shared/threadShape.js (digestShouldSkip /
// stepReminderDue), read by BOTH this sender and the digest, so a task can
// never be reported twice on the same day.
//
// THE WEEKEND RULE INVERTS HERE. The digest is weekday-only by default because
// a list of open threads on a Saturday is an intrusion nobody asked for. A
// time is a commitment to a MOMENT, so a timed step fires on weekends
// regardless of `orgs.thread_nudge_weekends`. There is deliberately no
// weekday gate below — that absence is the rule.
//
// TIMEZONE. The org's, always, and only when a human CHOSE it
// (`timezone_confirmed_at`). An org still carrying Steward's America/New_York
// default cannot set a time at all (the conversations route refuses it and the
// form says why), so this loop can never fire at a guessed hour.
//
// The button is a plain navigation to the donor's log-one-line screen,
// prefilled with the task. BUILD-81's rule stands unchanged and is the reason
// it stands: mail clients prefetch links, so a GET must never change state.
// Done and Snooze happen on the page, after a load, as POSTs.

// Every open, unsnoozed, timed step due TODAY for this org, with its donor.
async function composeStepReminders(orgId, today) {
  return await query(
    `SELECT t.id, t.donor_id, d.name AS donor_name, t.next_step_label, t.due_date, t.due_time,
            t.owner_id, t.owner_name, t.created_by, t.opened_on
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND t.due_time IS NOT NULL AND t.due_date = ?
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
      ORDER BY t.due_time ASC, t.id ASC`,
    [orgId, today, today]);
}

function stepReminderSubject(t, timeLabel) {
  return `${timeLabel} — ${t.next_step_label} · ${displayNameCase(t.donor_name || "")}`;
}

function renderStepReminderBody(t, org, timeLabel) {
  // The one button: the donor's LOG-ONE-LINE screen, prefilled with the task —
  // not the plain profile. She opens it to record what happened, which is the
  // action the email exists to produce.
  const url = `${publicAppUrl()}/donors/${encodeURIComponent(t.donor_id)}?conversation=1&step=${encodeURIComponent(t.next_step_label)}`;
  const addr = org.receipt_address && String(org.receipt_address).trim();
  const footer = addr
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:#6b7d70;">${digestEsc(displayNameCase(org.legal_name || org.name || ""))} · ${digestEsc(addr)}</div>`
    : `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:#6b7d70;">Steward has no mailing address on file for ${digestEsc(displayNameCase(org.name || ""))}, so this footer cannot carry one yet. <a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;">Add it in Settings</a> and it will.</div>`;
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:20px;color:#0f1a12;">${digestEsc(timeLabel)}. ${digestEsc(t.next_step_label)}.</div>
      <div style="font-size:14px;color:#0f1a12;margin-top:6px;">${digestEsc(displayNameCase(t.donor_name || ""))}</div>
      <div style="font-size:12.5px;color:#6b7d70;margin-top:2px;">This is the time you set for it.</div>
      <div style="margin-top:16px;">
        <a href="${url}" style="display:inline-block;background:#0d5c3a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Log what happened →</a>
      </div>
      ${footer}
    </div>`;
}

// Run the timed reminders for one org at `nowHHMM` (the org's wall clock).
// send=false → compose only, reserving nothing.
async function runStepRemindersForOrg(org, { today, nowHHMM, send = true, force = false }) {
  const out = { sent: [], skipped: [] };
  const { stepReminderDue } = await threadShapeMod();
  const rows = await composeStepReminders(org.id, today);
  if (!rows.length) return out;
  const users = await query("SELECT id, name, email FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);
  for (const t of rows) {
    if (!force && !stepReminderDue(t, today, nowHHMM)) { out.skipped.push({ threadId: t.id, reason: "not_yet" }); continue; }
    const timeLabel = formatOrgStepTime(t.due_time);
    const subject = stepReminderSubject(t, timeLabel);
    const body = renderStepReminderBody(t, org, timeLabel);
    // Who hears about it: the thread's OWNER when it has one (the officer who
    // set the time), otherwise whoever created it, otherwise the org — the
    // same escalation the notification matrix uses. Never everyone: a time is
    // one person's commitment, not the org's.
    const targets = t.owner_id ? users.filter(u => u.id === t.owner_id)
                  : t.created_by ? users.filter(u => u.id === t.created_by)
                  : users;
    for (const u of (targets.length ? targets : users)) {
      if (!send) { out.sent.push({ threadId: t.id, recipientUserId: u.id, email: u.email, subject }); continue; }
      if (!(await userWantsEmail(u.id, "step_reminder"))) { out.skipped.push({ threadId: t.id, recipientUserId: u.id, reason: "opted_out" }); continue; }
      // ONE email per thread per user per day — the digest_sends idempotency
      // the nudge already uses, keyed on the thread so a step moved to a new
      // time on a later day is a new reminder and a re-run is not.
      const rid = await reserveDigest(org.id, "step_reminder", `step:${t.id}:${today}`, u.id, u.email, "user",
        { threadId: t.id, donorId: t.donor_id, due: t.due_date, time: t.due_time });
      if (!rid) { out.skipped.push({ threadId: t.id, recipientUserId: u.id, reason: "already_sent" }); continue; }
      await sendDigestEmail(org, u.email, subject, body);
      out.sent.push({ threadId: t.id, recipientUserId: u.id, email: u.email, subject });
    }
  }
  return out;
}

function formatOrgStepTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = +m[1], mi = +m[2];
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, "0")} ${ampm}`;
}

async function processSequences() {
  try {
    const enrollments = await query(
      `SELECT se.*, s.name AS seq_name, s.org_id, s.trigger AS seq_trigger
       FROM sequence_enrollments se
       JOIN sequences s ON se.sequence_id = s.id
       WHERE se.status = 'active' AND se.next_send_at <= NOW()`,
      []
    );
    for (const enr of enrollments) {
      try {
        const steps = await query(
          "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC",
          [enr.sequence_id]
        );
        const step = steps[enr.current_step];
        if (!step) {
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        // Onboarding sequences store user_id in donor_id — look up users table instead of donors
        let recipient;
        if (enr.seq_trigger === "onboarding") {
          const rows = await query("SELECT id, name, email FROM users WHERE id = ? AND org_id = ?", [enr.donor_id, enr.org_id]);
          recipient = rows[0];
        } else {
          const rows = await query("SELECT id, name, email FROM donors WHERE id = ? AND org_id = ?", [enr.donor_id, enr.org_id]);
          recipient = rows[0];
        }
        // "Write a note" reminders are handled before the email-presence
        // check below — they're an in-app nudge for staff to write a real
        // note, not an email send, so a donor without an email on file can
        // still get one.
        if (enr.seq_trigger === "milestone") {
          const metaRaw0 = enr.metadata;
          const meta0 = metaRaw0 ? (typeof metaRaw0 === "string" ? JSON.parse(metaRaw0) : metaRaw0) : {};
          if (isNoteMoment(meta0.milestone_key)) {
            try {
              const points = await computeNoteTalkingPoints(enr.donor_id, enr.org_id, meta0);
              if (points) {
                await run(
                  `INSERT INTO note_reminders (id, org_id, donor_id, sequence_enrollment_id, milestone_key, talking_points, status)
                   VALUES (?,?,?,?,?,?,'pending')`,
                  ["note_" + uuid().slice(0, 8), enr.org_id, enr.donor_id, enr.id, meta0.milestone_key || null, JSON.stringify(points)]
                );
                console.log(`[note-reminder] queued for donor ${enr.donor_id} (${meta0.milestone_key})`);
              }
            } catch (e) { console.error("[note-reminder] failed:", e.message); }
            await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
            continue;
          }
        }
        if (!recipient || !recipient.email) {
          const nxt = steps[enr.current_step + 1];
          if (nxt) {
            await run(
              `UPDATE sequence_enrollments SET current_step = current_step + 1, next_send_at = NOW() + INTERVAL '${parseInt(nxt.delay_days, 10)} days' WHERE id = ?`,
              [enr.id]
            );
          } else {
            await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          }
          continue;
        }
        const seqDecision = await donorMailDecision("sequence", recipient.email, enr.org_id);
        if (!seqDecision.send) {
          console.log(`[seq] skipping recipient ${recipient.email} (${seqDecision.reason}) — enrollment ${enr.id}`);
          await run(
            `UPDATE sequence_enrollments SET status=?, completed_at=NOW() WHERE id=?`,
            // bounced stays bounced; every other refusal (unsubscribe, donor
            // flags) closes the enrollment as unsubscribed.
            [seqDecision.reason === "bounced" ? "bounced" : "unsubscribed", enr.id]
          );
          continue;
        }
        // Only non-note milestone moments reach here — note moments already
        // branched off and `continue`d above. Milestone emails default to
        // staff review rather than auto-send — the
        // AI drafts it, it lands in milestone_drafts for a human to approve/edit
        // (see POST /milestone-drafts/:id/send), and the enrollment is marked
        // complete here so the engine doesn't keep re-processing it. This is a
        // deliberate product decision, not a technical limitation: a tone-deaf
        // auto-sent milestone email is a real trust risk, matching the
        // human-in-the-loop pattern the AI daily briefing already uses
        // elsewhere in Steward (AI informs, staff acts). Flipping to fully
        // automatic sending later is a small change — swap the block below for
        // the same subject/body/send logic the rest of this function already uses.
        if (enr.seq_trigger === "milestone") {
          try {
            const metaRaw = enr.metadata;
            const meta = metaRaw ? (typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw) : {};
            const draft = await generateMilestoneDraft(recipient, enr.org_id, meta);
            if (draft) {
              await run(
                `INSERT INTO milestone_drafts (id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status)
                 VALUES (?,?,?,?,?,?,?,'pending_review')`,
                ["mdraft_" + uuid().slice(0, 8), enr.org_id, enr.donor_id, enr.id, meta.milestone_key || null, draft.subject, draft.body]
              );
              console.log(`[milestone] queued draft for donor ${enr.donor_id} (${meta.milestone_key}) — pending review`);
            } else {
              console.error(`[milestone] draft generation returned nothing for enrollment ${enr.id}`);
            }
          } catch (e) { console.error("[milestone] draft generation failed:", e.message); }
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        // Same human-in-the-loop pattern as the milestone branch above:
        // AI drafts a re-engagement email, it lands in milestone_drafts
        // (milestone_key='at_risk') for staff review, never auto-sent. See
        // computeAtRiskCandidates/autoEnroll's 'at_risk' branch below.
        if (enr.seq_trigger === "at_risk") {
          try {
            const draft = await generateAtRiskDraft(recipient, enr.org_id);
            if (draft) {
              await run(
                `INSERT INTO milestone_drafts (id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status)
                 VALUES (?,?,?,?,?,?,?,'pending_review')`,
                ["mdraft_" + uuid().slice(0, 8), enr.org_id, enr.donor_id, enr.id, "at_risk", draft.subject, draft.body]
              );
              console.log(`[at-risk] queued re-engagement draft for donor ${enr.donor_id} — pending review`);
            } else {
              console.error(`[at-risk] draft generation returned nothing for enrollment ${enr.id}`);
            }
          } catch (e) { console.error("[at-risk] draft generation failed:", e.message); }
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [enr.org_id]);
        const orgName = displayNameCase(orgRows[0]?.name) || "";
        const firstName = recipient.name ? recipient.name.trim().split(/\s+/)[0] : "";
        const applyTokens = str => (str || "")
          .replace(/{{donor_name}}/g, recipient.name)
          .replace(/{{user_name}}/g, recipient.name)
          .replace(/{{first_name}}/g, firstName)
          .replace(/{{org_name}}/g, orgName);
        const subject = applyTokens(step.subject);
        const bodyRaw = applyTokens(step.body);
        const bodyHtml = (bodyRaw.includes("<") ? bodyRaw
          : `<p>${bodyRaw.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`)
          + await unsubscribeEmailFooterHtml(recipient.email, enr.org_id, "sequence");
        const founderEmail = process.env.FOUNDER_EMAIL || "noreply@stewardapp.dev";
        // BUILD-64: a donor-facing sequence carries the org's name in the inbox;
        // the onboarding drip is founder→staff mail and keeps the founder From.
        const smtpFrom = enr.seq_trigger === "onboarding"
          ? founderEmail
          : await donorFromAddress(enr.org_id);
        // W-4 log honesty: the "Sequence: … Step N" interaction and the step
        // advance happen ONLY after a real delivery. A provider failure skips
        // both — next_send_at is untouched, so the next tick retries, and no
        // timeline entry claims an email that never left.
        let seqDelivered = true; // no API key configured = nothing to deliver
        if (process.env.RESEND_API_KEY && smtpFrom) {
          seqDelivered = false;
          try {
            // BUILD-88c C.1 — a DONOR-facing sequence carries the org's own
            // identity; the onboarding drip is founder-to-staff mail and keeps
            // the founder's From and Reply-To.
            const sendOpts = enr.seq_trigger === "onboarding"
              ? { from: smtpFrom, to: recipient.email, subject, html: bodyHtml,
                  headers: unsubscribeHeaders(recipient.email, enr.org_id, "sequence"),
                  replyTo: founderEmail }
              : { ...(await donorSendOpts(enr.org_id, recipient.email, "sequence")),
                  to: recipient.email, subject, html: bodyHtml };
            const { error: sendErr } = await resend.emails.send(sendOpts);
            if (sendErr) console.error("[seq] send error:", sendErr.message);
            else seqDelivered = true;
          } catch (e) { console.error("[seq] resend error:", e.message); }
        }
        if (!seqDelivered) { console.error(`[seq] delivery failed for enrollment ${enr.id} — will retry next tick`); continue; }
        // Only log donor interactions for non-onboarding sequences (donor_id is a user_id for onboarding)
        if (enr.seq_trigger !== "onboarding") {
          const intId = "i_" + uuid().slice(0, 8);
          const today = new Date().toISOString().slice(0, 10);
          await run(
            "INSERT INTO interactions (id, org_id, donor_id, type, note, date) VALUES (?, ?, ?, 'email', ?, ?)",
            [intId, enr.org_id, enr.donor_id, `Sequence: ${enr.seq_name} — Step ${enr.current_step + 1}: ${step.subject}`, today]
          );
        }
        const nextStep = steps[enr.current_step + 1];
        if (nextStep) {
          await run(
            `UPDATE sequence_enrollments SET current_step = current_step + 1, next_send_at = NOW() + INTERVAL '${parseInt(nextStep.delay_days, 10)} days' WHERE id = ?`,
            [enr.id]
          );
        } else {
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW(), current_step=current_step+1 WHERE id=?", [enr.id]);
        }
      } catch (e) { console.error("[seq] enrollment", enr.id, e.message); }
    }
  } catch (e) { console.error("[seq] processSequences:", e.message); }
}

// ── Stewardship: milestone & anniversary detection ──────────────────────────
// Fixed checkpoints for "just crossed a round-number cumulative giving total"
// detection — separate from impact_metrics, which is org-configured content
// for what to SAY once a milestone fires, not when one fires.
const MILESTONE_THRESHOLDS = [10000, 5000, 2500, 1000, 500];

// Finds donors who just crossed a threshold (via their most recent gift) or
// just hit a giving anniversary. Each candidate carries a milestoneKey that
// uniquely identifies THIS specific milestone (e.g. "threshold_1000",
// "anniversary_year_3") so autoEnroll can tell a genuinely new milestone
// apart from one it already handled, without needing a separate table.
async function computeMilestoneCandidates(orgId) {
  const candidates = [];

  const recentGiftDonors = await query(
    `SELECT id, total_giving, last_gift_amount FROM donors
     WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
       AND last_gift_date IS NOT NULL AND last_gift_date::date >= NOW() - INTERVAL '2 days'`,
    [orgId]
  );
  for (const d of recentGiftDonors) {
    const total = Number(d.total_giving) || 0;
    const lastAmt = Number(d.last_gift_amount) || 0;
    const priorTotal = total - lastAmt;
    for (const t of MILESTONE_THRESHOLDS) {
      if (priorTotal < t && total >= t) {
        candidates.push({ donorId: d.id, milestoneKey: `threshold_${t}`, milestoneType: "threshold", threshold: t });
        break; // only the highest threshold crossed by this one gift
      }
    }
  }

  const anniversaryDonors = await query(
    `SELECT id, first_gift_date FROM donors
     WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND first_gift_date IS NOT NULL`,
    [orgId]
  );
  // ORG_TZ_SEAM_OK (BUILD-75 A.5) — anniversary math is CIVIL-date arithmetic
  // in the org's timezone: the org's today vs the stored first-gift civil date,
  // both as Y/M/D. The old form compared process-clock parts to a
  // new Date(str) parse (UTC midnight re-read in the process zone), which near
  // month boundaries in the UTC evening put "today" a day/month ahead.
  const today = orgTime.parseCivil(orgToday(await orgTz(orgId)));
  for (const d of anniversaryDonors) {
    const first = orgTime.parseCivil(d.first_gift_date);
    if (!first) continue;
    const dayDiff = Math.abs(today.d - first.d);
    const inWindow = dayDiff <= 3 || dayDiff >= 27; // loose +/-3 day window, tolerates month-length wraparound
    const monthsSince = (today.y - first.y) * 12 + (today.m - first.m);
    if (monthsSince === 6 && inWindow) {
      candidates.push({ donorId: d.id, milestoneKey: "anniversary_6mo", milestoneType: "anniversary", label: "6-month" });
      continue;
    }
    const yearsSince = today.y - first.y;
    if (yearsSince >= 1 && today.m === first.m && inWindow) {
      candidates.push({ donorId: d.id, milestoneKey: `anniversary_year_${yearsSince}`, milestoneType: "anniversary", label: `${yearsSince}-year` });
    }
  }
  return candidates;
}

// Donors still in an active stage who've drifted past the earliest,
// most-recoverable risk window — the exact rule that used to live only as
// an inline "isLapsing" boolean in GET /dashboard/today. Promoted to a
// shared function so the dashboard display and the 'at_risk' auto-enroll
// trigger (see autoEnroll() below) can never drift into two different
// definitions of "at risk". Thresholds are hardcoded to match what
// /dashboard/today already used — not org-configurable yet. Requires an
// email on file (like computeMilestoneCandidates) since the output feeds an
// AI-drafted email, not just an in-app nudge.
async function computeAtRiskCandidates(orgId) {
  return query(
    `SELECT id, name, email, total_giving, last_gift_date, last_gift_amount
     FROM donors d
     WHERE org_id = ? AND deleted_at IS NULL
       AND stage NOT IN ('prospect', 'lapsed')
       AND email IS NOT NULL AND email != ''
       AND ${solicitableSql("d")} AND ${donorOnly("d")}
       AND d.imported_sustainer IS NOT TRUE
       AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '300 days'
       AND total_giving >= 5000`,
    [orgId]
  );
}

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
async function computeDriftForDonors(orgId, { donorIds = null } = {}) {
  const org = await orgTz(orgId);
  const today = orgToday(org);                              // ORG_TZ_SEAM_OK
  const idFilter = donorIds ? " AND d.id = ANY(?)" : "";
  const idParams = donorIds ? [donorIds] : [];
  const [donors, giftAgg, recurringRows, pledgeRows, contactRows] = await Promise.all([
    query(`SELECT d.id, d.name, d.total_giving, d.deceased, d.do_not_contact, d.do_not_solicit,
                  d.imported_sustainer, d.tags, d.kind,
                  d.assigned_to, d.assigned_to_name, d.stripe_subscription_status,
                  d.created_at::date::text AS created_date
             FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL
                                AND ${donorOnly("d")}${idFilter}`, [orgId, ...idParams]),
    // One compact row per donor — dates+amounts as parallel arrays, so the
    // whole org's cadence math is a single round trip, not an N+1. The
    // pledge marker (BUILD-77 Part 1d): a gift whose note marks it a
    // scheduled pledge payment — or that pays a pledge row — inside the
    // trailing 24 months means the donor's cadence is CONTRACTUAL, not
    // voluntary, and drift has nothing to say about it.
    query(`SELECT g.donor_id,
                  array_agg(g.date::text ORDER BY g.date) AS dates,
                  array_agg(g.amount ORDER BY g.date) AS amounts,
                  bool_or((g.notes ~* 'pledge (payment|installment)' OR g.pledge_id IS NOT NULL)
                          AND g.date::date >= ?::date - INTERVAL '730 days') AS pledge_recent
             FROM gifts g JOIN donors d ON d.id = g.donor_id
            WHERE g.org_id = ? AND d.deleted_at IS NULL${idFilter}
            GROUP BY g.donor_id`, [today, orgId, ...idParams]),
    // Every status that means "this donor is ON a subscription": active,
    // failing (past_due/recovering — the failed-payment path owns those),
    // recovered (billing again), and paused (a deliberate, known state with
    // its own portal-drift signal — not QUIET drift). Only canceled/lost
    // return a donor to voluntary cadence.
    query(`SELECT DISTINCT donor_id FROM recurring_subscriptions
            WHERE org_id = ? AND status IN ('active','past_due','recovering','recovered','paused')`, [orgId]),
    query(`SELECT DISTINCT donor_id FROM pledges WHERE org_id = ? AND status = 'open'`, [orgId]),
    // Last meaningful contact — powers HANDLED (the list stops resurfacing
    // someone already called; the badge is untouched, they are still drifting).
    query(`SELECT donor_id, MAX(date) AS last_contact FROM interactions
            WHERE org_id = ? AND type IN ${MEANINGFUL_CONTACT_TYPES} GROUP BY donor_id`, [orgId]),
  ]);
  const onSubscription = new Set(recurringRows.map(r => r.donor_id));
  const onPledge = new Set(pledgeRows.map(r => r.donor_id));
  const lastContact = new Map(contactRows.map(r => [r.donor_id, String(r.last_contact).slice(0, 10)]));
  const giftsByDonor = new Map(giftAgg.map(r => [r.donor_id, r]));
  const handledCutoff = orgTime.addDays(today, -driftEngine.DRIFT.HANDLED_SNOOZE_DAYS);

  const map = new Map();
  for (const d of donors) {
    const agg0 = giftsByDonor.get(d.id);
    let excludedReason = null;
    // BUILD-80 Part 7 — a grant cycle is not a giving cadence: organisations
    // (and the anonymous holding record) are off every person surface.
    if (d.kind === "organisation" || d.kind === "anonymous") excludedReason = "organisation";
    else if (d.deceased) excludedReason = "deceased";
    else if (d.do_not_contact) excludedReason = "do_not_contact";
    else if (d.do_not_solicit) excludedReason = "do_not_solicit";           // BUILD-77 — an ask list may never carry a no-ask donor
    else if (onSubscription.has(d.id) || d.stripe_subscription_status === "active") excludedReason = "active_recurring";
    else if (d.imported_sustainer) excludedReason = "unlinked_sustainer";  // BUILD-77 Part 5 — their card stopped, they did not; the recurring surface owns them
    else if (onPledge.has(d.id) || (agg0 && agg0.pledge_recent)) excludedReason = "pledge_cadence";
    if (excludedReason) {
      map.set(d.id, { state: "excluded", excludedReason, donorId: d.id });
      continue;
    }
    const agg = giftsByDonor.get(d.id);
    const gifts = agg
      ? agg.dates.map((date, i) => ({ date: String(date).slice(0, 10), amount: parseFloat(agg.amounts[i]) || 0 }))
      : [];
    // BUILD-80 Part 2.4 — the import stamps has-refused-rows:N; a refused row
    // caps this donor's drift confidence until it is resolved.
    let refusedRows = 0;
    try {
      const tags = Array.isArray(d.tags) ? d.tags : JSON.parse(d.tags || "[]");
      for (const tg of tags) { const m = /^has-refused-rows:(\d+)$/.exec(String(tg)); if (m) refusedRows += Number(m[1]); }
    } catch { /* unreadable tags never break drift */ }
    const a = driftEngine.assessDrift(gifts, today, { refusedRows });
    a.donorId = d.id;
    a.donorName = d.name;
    a.assignedTo = d.assigned_to || null;
    a.assignedToName = d.assigned_to_name || null;
    a.donorCreatedDate = d.created_date || null;   // the quiet_past_pattern live-transition guard reads this
    const lc = lastContact.get(d.id);
    a.handled = !!(lc && orgTime.compareCivil(lc, handledCutoff) >= 0);
    map.set(d.id, a);
  }
  return { map, today };
}

// Lazily provisions one "at_risk" sequence per org — unlike milestone
// sequences, this isn't gated on any org-level config (impact_metrics),
// since detecting a donor who's quietly drifted needs no configured content.
async function ensureAtRiskSequence() {
  const orgs = await query("SELECT id FROM orgs", []);
  for (const o of orgs) {
    const existing = await query("SELECT id FROM sequences WHERE org_id = ? AND trigger = 'at_risk'", [o.id]);
    if (existing.length) continue;
    const seqId = "seq_" + uuid().slice(0, 8);
    await run(
      "INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES (?,?,?,?,'active',?,?)",
      [seqId, o.id, "At-Risk Re-Engagement", "at_risk", SYS_AUTO.id, SYS_AUTO.name]
    );
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?,?,?,?,?,?)",
      ["ss_" + uuid().slice(0, 8), seqId, 0, 0, "At-risk re-engagement email (AI-drafted per donor)", ""]
    );
  }
}

// Lazily provisions one "milestone" sequence per org that has opted in by
// configuring at least one active impact_metrics row. A single dummy step is
// enough — milestone content is generated per-donor by generateMilestoneDraft(),
// not from sequence_steps.body like other trigger types.
async function ensureMilestoneSequences() {
  const orgs = await query("SELECT DISTINCT org_id FROM impact_metrics WHERE active = true", []);
  for (const o of orgs) {
    const existing = await query("SELECT id FROM sequences WHERE org_id = ? AND trigger = 'milestone'", [o.org_id]);
    if (existing.length) continue;
    const seqId = "seq_" + uuid().slice(0, 8);
    await run(
      "INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES (?,?,?,?,'active',?,?)",
      [seqId, o.org_id, "Milestone & Anniversary Emails", "milestone", SYS_AUTO.id, SYS_AUTO.name]
    );
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?,?,?,?,?,?)",
      ["ss_" + uuid().slice(0, 8), seqId, 0, 0, "Milestone email (AI-drafted per donor)", ""]
    );
  }
}

// Which milestones get a human-written "write a note" nudge instead of an
// AI-drafted email: the two highest dollar thresholds (real major-gift
// moments) and every giving anniversary (inherently personal/relational —
// worth a genuine handwritten touch regardless of dollar amount). Everything
// smaller/routine ($500/$1,000/$2,500 crossings) keeps the existing
// AI-drafted-email flow, which is efficient and already staff-reviewed
// before sending. This is a product judgment call, not a technical one —
// see the Phase 2 commit message for the full reasoning.
const NOTE_MILESTONE_KEYS = new Set(["threshold_10000", "threshold_5000"]);
function isNoteMoment(milestoneKey) {
  if (!milestoneKey) return false;
  return NOTE_MILESTONE_KEYS.has(milestoneKey) || milestoneKey.startsWith("anniversary_");
}

// Computes exactly 3 short, specific, real-data talking points for a
// "write a note" reminder. Deliberately NOT an AI call — no note content is
// ever generated here, only facts pulled straight from the donor record for
// a staff member to write their own note from.
async function computeNoteTalkingPoints(donorId, orgId, meta) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const totalGiving = Number(donor.total_giving) || 0;
  const points = [];

  // 1. The milestone itself
  if (meta.milestone_type === "anniversary") {
    points.push(`This marks their ${meta.label || "giving"} anniversary with your organization.`);
  } else {
    points.push(`Just crossed $${(meta.threshold || 0).toLocaleString()} in total lifetime giving ($${totalGiving.toLocaleString()} total).`);
  }

  // 2. A personal detail — donor.notes first, else the most recent
  // interaction note on file
  let personalDetail = donor.notes && donor.notes.trim() ? donor.notes.trim() : null;
  if (!personalDetail) {
    const lastNoteRows = await query(
      "SELECT note FROM interactions WHERE donor_id = ? AND org_id = ? AND note IS NOT NULL AND note != '' ORDER BY date DESC LIMIT 1",
      [donorId, orgId]
    );
    personalDetail = lastNoteRows[0]?.note || null;
  }
  points.push(personalDetail
    ? `From their file: "${personalDetail.slice(0, 140)}${personalDetail.length > 140 ? "…" : ""}"`
    : "No personal notes on file yet — worth asking what first drew them to this cause.");

  // 3. Something time-relevant — when the milestone itself is already an
  // anniversary (point 1), use recency of their last gift here instead so
  // this point doesn't just repeat "X years" a second time.
  if (meta.milestone_type === "anniversary") {
    points.push(donor.last_gift_date
      ? `Most recent gift: $${(Number(donor.last_gift_amount) || 0).toLocaleString()} on ${new Date(donor.last_gift_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
      : `${donor.gift_count || 0} gift(s) total.`);
  } else if (donor.first_gift_date) {
    const first = new Date(donor.first_gift_date);
    if (!isNaN(first.getTime())) {
      const years = Math.floor((Date.now() - first.getTime()) / (365.25 * 86400000));
      points.push(years >= 1
        ? `They've been giving for ${years} year${years === 1 ? "" : "s"} — since ${first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`
        : `They made their first gift on ${first.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`);
    }
  }
  if (points.length < 3) {
    points.push(donor.last_gift_date
      ? `Last gift: $${(Number(donor.last_gift_amount) || 0).toLocaleString()} on ${new Date(donor.last_gift_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
      : `${donor.gift_count || 0} gift(s) total.`);
  }

  return points.slice(0, 3);
}

// Generates a warm, specific, non-gamified thank-you draft for one milestone.
// The dollar math ({n} = floor(total / dollar_threshold)) is computed here in
// JS, not left to the model — only the prose is AI-written. Returns null on
// any failure so the caller can skip gracefully rather than queue garbage.
async function generateMilestoneDraft(recipient, orgId, meta) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [recipient.id, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
  const orgName = displayNameCase(orgRows[0]?.name) || "";
  const totalGiving = Number(donor.total_giving) || 0;

  const metricRows = await query(
    "SELECT * FROM impact_metrics WHERE org_id = ? AND active = true AND dollar_threshold <= ? ORDER BY dollar_threshold DESC LIMIT 1",
    [orgId, totalGiving]
  );
  let impactLine = null;
  if (metricRows.length) {
    const m = metricRows[0];
    const n = Math.max(1, Math.floor(totalGiving / Number(m.dollar_threshold)));
    impactLine = String(m.outcome_template || "")
      .replace(/\{amount\}/g, totalGiving.toLocaleString())
      .replace(/\{n\}/g, n);
  }

  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "there";
  const sinceMonth = donor.first_gift_date ? new Date(donor.first_gift_date).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : null;
  const milestoneDesc = meta.milestone_type === "anniversary"
    ? `This marks their ${meta.label || "giving"} anniversary with your organization.`
    : `They just crossed $${(meta.threshold || 0).toLocaleString()} in total lifetime giving.`;

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: `You write short, warm donor thank-you emails for a nonprofit development team. The donor just reached a real giving milestone. Rules: no hype, no exclamation-point overload, absolutely no gamification language — never say "tier", "level up", "unlock", "badge", "milestone reward", "leaderboard", or "you're so close to your next milestone". Write like a staff member who personally noticed and cared, not an app tracking progress. 3-5 sentences, plain language, specific, genuine. Return ONLY valid JSON: {"subject":"...","body":"..."} — no markdown, no code fences, no explanation.`,
      messages: [{
        role: "user",
        content: `Donor first name: ${firstName}
Organization: ${orgName}
Total given to date: $${totalGiving.toLocaleString()}
${sinceMonth ? `Donor's first gift was in ${sinceMonth}.` : ""}
Milestone: ${milestoneDesc}
${impactLine ? `Concrete impact to reference naturally (weave it in, don't just paste it verbatim): "${impactLine}"` : "No specific impact figure is configured for this giving level — keep it a genuine, specific thank-you about their giving without inventing outcome numbers."}

Write the email now.`,
      }],
    });
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    return { subject: String(parsed.subject), body: String(parsed.body) };
  } catch (e) {
    console.error("[milestone] generateMilestoneDraft failed:", e.message);
    return null;
  }
}

// Generates a warm "thinking of you" re-engagement draft for a donor who
// just crossed into the earliest at-risk window (see
// computeAtRiskCandidates). Mirrors generateMilestoneDraft's shape and trust
// model — AI drafts, staff reviews/sends, never auto-sent — just a
// different prompt frame: a quiet drift to gently reconnect on, not a
// milestone worth celebrating. Returns null on any failure so the caller can
// skip gracefully rather than queue garbage.
async function generateAtRiskDraft(recipient, orgId) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [recipient.id, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
  const orgName = displayNameCase(orgRows[0]?.name) || "";
  const totalGiving = Number(donor.total_giving) || 0;
  const daysSinceGift = donor.last_gift_date
    ? Math.floor((Date.now() - new Date(donor.last_gift_date).getTime()) / 86400000) : null;
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "there";

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: `You write short, warm "checking in" emails for a nonprofit development team to a longtime donor who has quietly gone a while without giving. Rules: no guilt trip, no hard ask, no gamification language — never say "tier", "level up", "unlock", "badge", "lapsed", "at risk", or "we noticed you stopped giving". Write like a staff member who genuinely thought of them and wanted to reconnect, not a system flagging inactivity. 3-5 sentences, plain language, specific, genuine. Return ONLY valid JSON: {"subject":"...","body":"..."} — no markdown, no code fences, no explanation.`,
      messages: [{
        role: "user",
        content: `Donor first name: ${firstName}
Organization: ${orgName}
Total given to date: $${totalGiving.toLocaleString()}
${daysSinceGift ? `Days since their last gift: ${daysSinceGift}` : ""}

Write the email now.`,
      }],
    });
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    return { subject: String(parsed.subject), body: String(parsed.body) };
  } catch (e) {
    console.error("[at-risk] generateAtRiskDraft failed:", e.message);
    return null;
  }
}

async function autoEnroll() {
  try {
    await ensureMilestoneSequences();
    await ensureAtRiskSequence();
    const seqs = await query(
      "SELECT * FROM sequences WHERE status = 'active' AND trigger NOT IN ('manual', 'stage_change', 'onboarding')",
      []
    );
    for (const seq of seqs) {
      let donors = [];
      if (seq.trigger === "lapsed_90") {
        donors = await query(
          `SELECT id FROM donors d WHERE org_id = ? AND stage = 'lapsed' AND deleted_at IS NULL AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.imported_sustainer IS NOT TRUE AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '90 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "lapsed_180") {
        donors = await query(
          `SELECT id FROM donors d WHERE org_id = ? AND stage = 'lapsed' AND deleted_at IS NULL AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.imported_sustainer IS NOT TRUE AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '180 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "new_donor") {
        donors = await query(
          `SELECT id FROM donors d WHERE org_id = ? AND gift_count = 1 AND deleted_at IS NULL AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND last_gift_date IS NOT NULL AND last_gift_date::date > NOW() - INTERVAL '7 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "at_risk") {
        // Unlike milestone below, "at risk" isn't a repeating-with-variations
        // event, so the plain existing-enrollment-row check + ON CONFLICT DO
        // NOTHING in the generic loop further down (same as lapsed_90/180) is
        // sufficient — no per-donor key tracking needed.
        donors = await computeAtRiskCandidates(seq.org_id);
      } else if (seq.trigger === "milestone") {
        // Distinct handling: each donor can hit MANY different milestones over
        // time (crossing $500, then later $1000, then a 1-year anniversary...),
        // which the plain ON CONFLICT DO NOTHING enrollment below can't express
        // for a single (sequence_id, donor_id) row. Instead, reuse/reset that one
        // row per donor and track WHICH milestone it currently represents via
        // metadata.milestone_key — a re-detected key that matches what's already
        // there is skipped (already handled); a different key means a genuinely
        // new milestone, so the row is reset and re-enrolled.
        const candidates = await computeMilestoneCandidates(seq.org_id);
        for (const c of candidates) {
          const existing = await query(
            "SELECT id, metadata FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
            [seq.id, c.donorId]
          );
          const existingMeta = existing[0]?.metadata
            ? (typeof existing[0].metadata === "string" ? JSON.parse(existing[0].metadata) : existing[0].metadata)
            : null;
          if (existing.length && existingMeta?.milestone_key === c.milestoneKey) continue;
          const metaJson = JSON.stringify({
            milestone_key: c.milestoneKey, milestone_type: c.milestoneType,
            threshold: c.threshold || null, label: c.label || null,
          });
          if (existing.length) {
            await run(
              `UPDATE sequence_enrollments SET status='active', current_step=0, enrolled_at=NOW(), completed_at=NULL, next_send_at=NOW(), metadata=? WHERE id=?`,
              [metaJson, existing[0].id]
            );
          } else {
            await run(
              `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at, metadata)
               VALUES (?, ?, ?, ?, 0, 'active', NOW(), ?)`,
              ["se_" + uuid().slice(0, 8), seq.id, seq.org_id, c.donorId, metaJson]
            );
          }
        }
        continue;
      }
      for (const donor of donors) {
        const existing = await query(
          "SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
          [seq.id, donor.id]
        );
        if (existing.length) continue;
        const steps = await query(
          "SELECT delay_days FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1",
          [seq.id]
        );
        const firstDelay = parseInt(steps[0]?.delay_days || 0, 10);
        const enrId = "se_" + uuid().slice(0, 8);
        await run(
          `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at)
           VALUES (?, ?, ?, ?, 0, 'active', NOW() + INTERVAL '${firstDelay} days')
           ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
          [enrId, seq.id, seq.org_id, donor.id]
        );
      }
    }
  } catch (e) { console.error("[seq] autoEnroll:", e.message); }
}


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
const SEQ_READY = import("./shared/sequenceShape.js").then(m => { SEQ = m; return m; });

// The values a step's merge fields render from: the person's OWN data, the
// org's OWN words (BUILD-86 vocabulary), and every custom field on the record.
// NOTHING here is generated — every value is a column somebody typed or a gift
// somebody gave.
async function sequenceMergeValues(donor, orgId) {
  const [org] = await query("SELECT name, vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const V = await import("./shared/vocabulary.js");
  let vocab = null;
  try { vocab = org?.vocabulary_json ? JSON.parse(org.vocabulary_json) : null; } catch { /* default words */ }
  const t = V.makeT(vocab);
  const words = String(donor.name || "").trim().split(/\s+/).filter(Boolean);
  const values = {
    first: words[0] || "",
    last: words.length > 1 ? words[words.length - 1] : "",
    name: donor.name || "",
    last_gift_amount: Number(donor.last_gift_amount) > 0 ? fmtMoneyPlain(donor.last_gift_amount) : "",
    last_gift_date: donor.last_gift_date || "",
    fund: donor.__fund || "",
    // BUILD-86 Part B — a shop that says "sponsors" gets "sponsor" here. The
    // brief's {{sponsor_name}} is THAT word, not a second person's name.
    sponsor_name: t("giver", 1),
    gift: t("gift", 1),
    org_name: displayNameCase(org?.name || ""),
  };
  // Every custom field on the person, by key. A field she made is a field she
  // can write with.
  const cf = donor.custom_fields && typeof donor.custom_fields === "object" ? donor.custom_fields : {};
  for (const [k, v] of Object.entries(cf)) {
    if (values[k] === undefined) values[k] = Array.isArray(v) ? v.join(", ") : (v == null ? "" : String(v));
  }
  return values;
}
const fmtMoneyPlain = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// The closed STOP set, evaluated for one enrollment at send time. Returns a
// stop key or null. A LOGGED CONVERSATION IS NOT HERE, deliberately — see
// SEQ.STOP_NOT_A_STOP, which is the sentence the settings screen shows so
// nobody assumes otherwise.
async function sequenceStopFor(enr, donor, step) {
  if (!donor) return "removed";
  if (donor.deceased === true) return "deceased";
  if (donor.do_not_email === true) return "do_not_email";
  const decision = await donorMailDecision("sequence", donor.email, enr.org_id);
  if (!decision.send) return decision.reason === "bounced" ? "bounced" : "unsubscribed";
  // A SECOND GIFT DURING A FIRST-GIFT SEQUENCE skips what is left — a welcome
  // series must not ask for a gift the week after one arrived. A step marked
  // "send even after another gift" (the thank-you) still goes.
  if (enr.gift_count_at_enroll != null && Number(donor.gift_count || 0) > Number(enr.gift_count_at_enroll)
      && !step.send_even_after_gift) {
    return "another_gift";
  }
  return null;
}

// Is this org allowed to run sequences at all? BUILD-84's timezone rule: the
// column has a default, so what this needs is a zone A HUMAN CHOSE.
async function sequenceTimezoneGate(orgId) {
  await SEQ_READY;
  const tz = await orgTz(orgId);
  return { ...SEQ.timezoneGate(tz), timezone: tz.timezone };
}

// The org's local clock as { weekday, hour, date } — the send window's input.
async function orgSendClock(orgId, at = new Date()) {
  const tz = await orgTz(orgId);
  const c = orgTime.orgClock(tz, at);                       // ORG_TZ_SEAM_OK
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date);
  const weekday = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : new Date(at).getUTCDay();
  return { ...c, weekday, timezone: tz.timezone };
}

// ── ENROLLMENT ─────────────────────────────────────────────────────────────
// ENROLLMENT IS NEVER RETROACTIVE. Every call site passes the event that just
// happened; nothing here looks backwards.
async function enrollInSequences(orgId, donorId, triggerKey, context = {}, actor = null) {
  await SEQ_READY;
  const gate = await sequenceTimezoneGate(orgId);
  if (!gate.ok) return { enrolled: 0, reason: gate.reason };
  const seqs = await query(
    `SELECT * FROM sequences WHERE org_id = ? AND status = 'active' AND trigger = ? AND tracks IS NOT NULL`,
    [orgId, triggerKey]);
  let enrolled = 0;
  for (const seq of seqs) {
    try {
      const tracks = Array.isArray(seq.tracks) ? seq.tracks : JSON.parse(seq.tracks || "[]");
      const track = SEQ.chooseTrack(tracks, context);
      // validateSequence refuses to save a sequence whose last track is not
      // "everyone else", so this can only be null for a row written before
      // that rule — it is a refusal to enroll, logged, never a silent pass.
      if (!track) { console.error(`[seq] ${seq.id}: nobody's track matched — not enrolling ${donorId}`); continue; }
      const steps = await query(
        `SELECT * FROM sequence_steps WHERE sequence_id = ? AND track_key = ? ORDER BY step_order ASC`,
        [seq.id, track.key]);
      if (!steps.length) { console.error(`[seq] ${seq.id}: track ${track.key} has no steps`); continue; }
      const [d] = await query(`SELECT gift_count FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
      const firstDelay = parseInt(steps[0].delay_days, 10) || 0;
      const r = await run(
        `INSERT INTO sequence_enrollments
           (id, sequence_id, org_id, donor_id, current_step, status, next_send_at, track_key,
            enrolled_by, enrolled_by_name, gift_count_at_enroll)
         VALUES (?,?,?,?,0,'active', NOW() + INTERVAL '${firstDelay} days', ?,?,?,?)
         ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
        ["se_" + uuid().slice(0, 8), seq.id, orgId, donorId, track.key,
         actor?.id || "system:sequence", actor?.name || null, d ? Number(d.gift_count || 0) : null]);
      if (r.changes) enrolled++;
    } catch (e) { console.error(`[seq] enroll ${seq.id}/${donorId}:`, e.message); }
  }
  return { enrolled };
}

// ── THE SEND ───────────────────────────────────────────────────────────────
// Batched under Resend's rate limit, idempotent on (person, sequence, step)
// because the claim row IS the unique index — not a flag somebody remembered
// to check. A retried job finds the row taken and sends nothing.
const SEQ_RATE_PER_SECOND = 8;     // Resend's documented floor, with headroom
const SEQ_TICK_BUDGET = 200;

async function processTrackedSequences({ orgId = null, limit = SEQ_TICK_BUDGET, now = new Date() } = {}) {
  await SEQ_READY;
  const scope = orgId ? " AND se.org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const due = await query(
    `SELECT se.*, s.name AS seq_name, s.turned_on_by_name, s.turned_on_at, s.trigger AS seq_trigger
       FROM sequence_enrollments se
       JOIN sequences s ON s.id = se.sequence_id
      WHERE se.status = 'active' AND se.track_key IS NOT NULL
        AND s.status = 'active' AND se.next_send_at <= NOW()${scope}
      ORDER BY se.next_send_at ASC LIMIT ?`, params);
  const out = { sent: 0, skipped: 0, stopped: 0, failed: 0, waited: 0, due: due.length };
  // Group by org so the window and the clock are read once per org, not once
  // per enrollment.
  const byOrg = new Map();
  for (const e of due) { if (!byOrg.has(e.org_id)) byOrg.set(e.org_id, []); byOrg.get(e.org_id).push(e); }

  for (const [oid, list] of byOrg) {
    const gate = await sequenceTimezoneGate(oid);
    if (!gate.ok) { out.skipped += list.length; continue; }
    // BUILD-94 Part 4 — NO ADDRESS, NO SEND, for sequences too. Nothing is
    // consumed and nothing is failed: next_send_at is untouched, so the day
    // she types the address the whole queue goes.
    const addr = await bulkSendAddressGate(oid);
    if (!addr.ok) {
      console.error(`[seq] ${oid}: no mailing address on file — ${list.length} sends held`);
      out.skipped += list.length; out.noAddress = (out.noAddress || 0) + list.length;
      continue;
    }
    const clock = await orgSendClock(oid, now);
    // WEEKDAY MORNINGS WHERE SHE IS. Outside the window nothing sends and
    // nothing is consumed — next_send_at moves to the next window's morning.
    if (!SEQ.inSendWindow(clock)) {
      const days = SEQ.daysUntilNextWindow(clock.weekday, clock.hour);
      await run(
        `UPDATE sequence_enrollments SET next_send_at = NOW() + INTERVAL '${Math.max(days, 0)} days' + INTERVAL '1 hour'
          WHERE id = ANY(?) AND status='active'`, [list.map(e => e.id)]);
      out.waited += list.length;
      continue;
    }
    let inSecond = 0, secondStart = Date.now();
    for (const enr of list) {
      try {
        const steps = await query(
          `SELECT * FROM sequence_steps WHERE sequence_id = ? AND track_key = ? ORDER BY step_order ASC`,
          [enr.sequence_id, enr.track_key]);
        const step = steps[enr.current_step];
        if (!step) { await closeEnrollment(enr.id, "completed", null); continue; }

        const [donor] = await query(
          `SELECT id, name, email, deceased, do_not_email, gift_count, last_gift_amount, last_gift_date, custom_fields
             FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [enr.donor_id, oid]);
        const stop = await sequenceStopFor(enr, donor, step);
        if (stop === "another_gift") {
          // The REMAINING steps are skipped, not the enrollment failed: she
          // asked for a welcome series, and it ends when the welcome is over.
          await closeEnrollment(enr.id, "completed", "another_gift");
          out.stopped++; continue;
        }
        if (stop) { await closeEnrollment(enr.id, "stopped", stop); out.stopped++; continue; }

        // ── THE CLAIM. Before the provider call, never after. ─────────────
        const claimId = "ss_" + uuid().slice(0, 12);
        const claim = await run(
          `INSERT INTO sequence_sends (id, org_id, sequence_id, donor_id, step_order, status, subject, attempts)
           VALUES (?,?,?,?,?, 'claimed', ?, 1)
           ON CONFLICT (sequence_id, donor_id, step_order) DO NOTHING`,
          [claimId, oid, enr.sequence_id, enr.donor_id, step.step_order, step.subject]);
        if (!claim.changes) {
          // Somebody already has this step — a retried job, or a concurrent
          // tick. Advance past it rather than sending a second copy.
          await advanceEnrollment(enr, steps);
          out.skipped++; continue;
        }

        const values = await sequenceMergeValues(donor, oid);
        const subj = SEQ.renderMerge(step.subject, values);
        const body = SEQ.renderMerge(step.body, values);
        const html = (body.text.includes("<") ? body.text
          : `<p>${body.text.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`)
          + await unsubscribeEmailFooterHtml(donor.email, oid, "sequence");

        // Rate limit: a simple per-second gate, because a burst is how a
        // provider starts refusing an org's mail.
        if (++inSecond >= SEQ_RATE_PER_SECOND) {
          const elapsed = Date.now() - secondStart;
          if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
          inSecond = 0; secondStart = Date.now();
        }

        let delivered = true, errText = null;
        if (process.env.RESEND_API_KEY) {
          delivered = false;
          try {
            const opts = { ...(await donorSendOpts(oid, donor.email, "sequence")),
                           to: donor.email, subject: subj.text, html };
            const { error: sendErr } = await resend.emails.send(opts);
            if (sendErr) errText = sendErr.message || String(sendErr);
            else delivered = true;
          } catch (e) { errText = e.message; }
        }

        if (!delivered) {
          // NEVER SWALLOWED (BUILD-37 H2). The row keeps the reason and the
          // sequence line on Home says how many could not be sent.
          out.failed++;
          console.error(`[seq] send failed for ${enr.donor_id} step ${step.step_order}: ${errText}`);
          await run(`UPDATE sequence_sends SET status='failed', error=? WHERE id=?`,
            [String(errText || "unknown").slice(0, 300), claimId]);
          // next_send_at untouched: the next tick retries, and the claim row
          // is reused (attempts bumped) rather than duplicating.
          continue;
        }

        await run(`UPDATE sequence_sends SET status='sent', sent_at=NOW(), error=NULL WHERE id=?`, [claimId]);
        // ONE email conversation on the person's timeline, per send, saying
        // who turned this on and when. "Why did this donor get this" has an
        // answer that is a person and a date.
        const civilOn = enr.turned_on_at ? new Date(enr.turned_on_at).toISOString().slice(0, 10) : null;
        await run(
          `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by)
           VALUES (?,?,?,'email',?,?,?)`,
          ["i_" + uuid().slice(0, 8), oid, enr.donor_id,
           `${SEQ.sendActorLine({ sequenceName: enr.seq_name, stepNumber: enr.current_step + 1,
                                  turnedOnByName: enr.turned_on_by_name, turnedOnAt: civilOn })} — ${subj.text}`,
           clock.date, "system:sequence"]);
        await advanceEnrollment(enr, steps);
        out.sent++;
      } catch (e) { console.error("[seq] enrollment", enr.id, e.message); out.failed++; }
    }
  }
  return out;
}

async function advanceEnrollment(enr, steps) {
  const next = steps[enr.current_step + 1];
  if (!next) {
    await run(`UPDATE sequence_enrollments SET status='completed', completed_at=NOW(), current_step=current_step+1 WHERE id=?`, [enr.id]);
    return;
  }
  // The offset is from ENROLLMENT, not from the previous send — that is what a
  // "day offset" means, and it keeps a slow tick from pushing a whole series
  // later and later.
  const offset = parseInt(next.delay_days, 10) || 0;
  await run(
    `UPDATE sequence_enrollments SET current_step = current_step + 1,
            next_send_at = enrolled_at + INTERVAL '${offset} days' WHERE id = ?`, [enr.id]);
}
async function closeEnrollment(id, status, reason) {
  await run(`UPDATE sequence_enrollments SET status=?, stop_reason=?, completed_at=NOW() WHERE id=?`,
    [status, reason || null, id]);
}

// ── Recurring gift recovery: dunning engine ─────────────────────────────────
// Follows the same shape as processSequences()/autoEnroll() above: a
// module-level async function run on startup and on an interval, also
// exposed as an admin-only manual-trigger route.
async function processDunning() {
  try {
    const rows = await query(
      `SELECT rs.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_subscriptions rs
       JOIN donors d ON d.id = rs.donor_id
       WHERE rs.status IN ('past_due','recovering') AND rs.next_dunning_at <= NOW()`,
      []
    );
    for (const rs of rows) {
      try {
        const orgRows = await query(
          "SELECT id, name, recurring_dunning_enabled, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE id=?",
          [rs.org_id]
        );
        const org = orgRows[0];
        if (!org || !rs.donor_email) continue;
        // Org turned this off — leave the cadence/step where it is (so it
        // picks back up correctly if re-enabled) but don't send.
        if (org.recurring_dunning_enabled === false) continue;

        // W-4 log honesty: dunning_sent is logged ONLY after a real delivery.
        // A permanent policy refusal (deceased) logs dunning_skipped and
        // advances the cadence (retrying is pointless); a provider failure
        // logs nothing and leaves next_dunning_at alone so the next tick
        // retries — the absence of a row is the truth.
        const dunningResult = await sendDunningEmail(org, { name: rs.donor_name, email: rs.donor_email }, rs);
        if (dunningResult.sent) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_sent", null, { step: rs.dunning_step });
        } else if (dunningResult.refused) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_skipped", null, { step: rs.dunning_step, reason: dunningResult.refused });
        } else {
          console.error(`[dunning] delivery failed for sub ${rs.id} — will retry next tick`);
          continue;
        }

        const nextStep = rs.dunning_step + 1;
        const nextDelayDays = DUNNING_SCHEDULE_DAYS[nextStep];
        const nextDunningAt = nextDelayDays != null
          ? new Date(new Date(rs.first_failed_at).getTime() + nextDelayDays * 86400000).toISOString()
          : null; // exhausted the cadence — Stripe's own retries continue, but WE stop emailing
        await run(
          `UPDATE recurring_subscriptions SET status='recovering', dunning_step=?, next_dunning_at=?, updated_at=NOW() WHERE id=?`,
          [nextStep, nextDunningAt, rs.id]
        );
        // …and the automation handing the donor to a human is the whole point:
        // four emails over a fortnight did not reach them, so someone calls.
        if (nextDunningAt === null) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_exhausted", null, { steps: nextStep });
          await openSustainerLapseThread(rs.org_id, rs.donor_id, {
            amount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, reason: "dunning_exhausted" });
        }
      } catch (e) { console.error("[dunning] subscription", rs.id, e.message); }
    }
  } catch (e) { console.error("[dunning] processDunning:", e.message); }
}

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
const CARD_CHECK_BUDGET = Number(process.env.CARD_CHECK_BUDGET) || 200;

// The expiry period is 'YYYY-MM' — a card is dead after the LAST day of its
// expiry month, so the month is the whole unit and the notice is keyed to it.
const cardPeriod = (y, m) => (y && m) ? `${y}-${String(m).padStart(2, "0")}` : null;

// refreshCardsOnFile — pull brand/last4/expiry for live subscriptions whose
// stored copy is missing or stale. Returns a job budget the way the import and
// the geocoder do: a cost you cannot see is a cost nobody manages.
async function refreshCardsOnFile({ limit = CARD_CHECK_BUDGET, orgId = null } = {}) {
  const scope = orgId ? " AND rs.org_id = ?" : "";
  const params = orgId
    ? [CARD_RECHECK_DAYS, orgId, limit]
    : [CARD_RECHECK_DAYS, limit];
  const rows = await query(
    `SELECT rs.id, rs.org_id, rs.stripe_subscription_id, o.stripe_account_id
       FROM recurring_subscriptions rs JOIN orgs o ON o.id = rs.org_id
      WHERE rs.status IN ('active','past_due','recovering')
        AND rs.stripe_subscription_id IS NOT NULL
        AND o.stripe_account_id IS NOT NULL
        AND (rs.card_checked_at IS NULL OR rs.card_checked_at < NOW() - (? || ' days')::interval)${scope}
      ORDER BY rs.card_checked_at ASC NULLS FIRST, rs.id ASC
      LIMIT ?`, params);
  const out = { checked: 0, requests: 0, withCard: 0, failed: 0 };
  const t0 = Date.now();
  for (const r of rows) {
    out.requests++;
    try {
      // ONE call gets the subscription and the card behind it. A subscription
      // with no default of its own inherits the customer's, so both are
      // expanded — reading only the first would leave those rows blank forever.
      const sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id,
        { expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"] },
        { stripeAccount: r.stripe_account_id });
      const pm = (sub.default_payment_method && typeof sub.default_payment_method === "object")
        ? sub.default_payment_method
        : (sub.customer && sub.customer.invoice_settings && typeof sub.customer.invoice_settings.default_payment_method === "object"
            ? sub.customer.invoice_settings.default_payment_method : null);
      const card = pm && pm.card ? pm.card : null;
      await run(
        `UPDATE recurring_subscriptions
            SET card_payment_method_id=?, card_brand=?, card_last4=?, card_exp_month=?, card_exp_year=?,
                card_checked_at=NOW(), updated_at=NOW()
          WHERE id=?`,
        [pm ? pm.id : null, card ? card.brand : null, card ? card.last4 : null,
         card ? card.exp_month : null, card ? card.exp_year : null, r.id]);
      out.checked++;
      if (card) out.withCard++;
    } catch (e) {
      // A failed READ is not a fact about the card. Stamp the check so one
      // broken subscription cannot monopolise every tick's budget, but leave
      // the stored card alone rather than blanking it on a network blip.
      out.failed++;
      await run(`UPDATE recurring_subscriptions SET card_checked_at=NOW() WHERE id=?`, [r.id]).catch(() => {});
      console.error(`[card-expiry] read failed for ${r.stripe_subscription_id}:`, e.message);
    }
  }
  out.ms = Date.now() - t0;
  if (out.requests) console.log(`[card-expiry] refresh org=${orgId || "all"} requests=${out.requests} checked=${out.checked} withCard=${out.withCard} failed=${out.failed} ${out.ms}ms`);
  return out;
}

// The subscriptions whose card dies this month or next, that have not already
// been told about THIS expiry. Two months of warning is the window that still
// leaves time to act before the next charge without being so early it reads as
// noise.
async function expiringCardRows(orgId, { today = new Date() } = {}) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const periods = [cardPeriod(y, m), cardPeriod(next.y, next.m)];
  return await query(
    `SELECT rs.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_subscriptions rs JOIN donors d ON d.id = rs.donor_id
      WHERE rs.org_id = ? AND rs.status IN ('active','past_due','recovering')
        AND rs.card_exp_year IS NOT NULL AND rs.card_exp_month IS NOT NULL
        AND (rs.card_exp_year || '-' || LPAD(rs.card_exp_month::text, 2, '0')) = ANY(?)
        AND d.deleted_at IS NULL
      ORDER BY rs.card_exp_year ASC, rs.card_exp_month ASC, rs.id ASC`,
    [orgId, periods]);
}

// notifyExpiringCards — one notice per subscription per expiry month. The
// stamp is the EXPIRY period, not a date: a card re-read, a network update, or
// a re-run can never produce a second email about the same expiry, and a
// genuinely new expiry (the donor updated the card) is eligible again by
// construction because the period changed.
async function notifyExpiringCards(org, { send = true, today = new Date() } = {}) {
  const out = { notified: [], skipped: [] };
  // The org-level switch for failed-card mail governs this too: an org that
  // turned off recovery email does not want an earlier version of it. If that
  // ever needs to be separable it is one column, not a rethink.
  if (org.recurring_dunning_enabled === false) return { ...out, disabled: true };
  const rows = await expiringCardRows(org.id, { today });
  for (const rs of rows) {
    const period = cardPeriod(rs.card_exp_year, rs.card_exp_month);
    if (rs.card_expiry_notified_for === period) { out.skipped.push({ id: rs.id, reason: "already_notified" }); continue; }
    if (!rs.donor_email) { out.skipped.push({ id: rs.id, reason: "no_email" }); continue; }
    if (!send) { out.notified.push({ id: rs.id, donorId: rs.donor_id, period, last4: rs.card_last4 }); continue; }
    const r = await sendCardExpiringEmail(org, { name: rs.donor_name, email: rs.donor_email }, rs);
    if (r.sent) {
      // Stamped only after a REAL delivery, the W-4 rule: a provider failure
      // leaves the stamp off so the next tick tries again.
      await run(`UPDATE recurring_subscriptions SET card_expiry_notified_for=?, updated_at=NOW() WHERE id=?`, [period, rs.id]);
      await logRecoveryEvent(org.id, rs.donor_id, rs.stripe_subscription_id, "card_expiring_notice", null, { period, last4: rs.card_last4 });
      out.notified.push({ id: rs.id, donorId: rs.donor_id, period, last4: rs.card_last4 });
    } else if (r.refused) {
      await run(`UPDATE recurring_subscriptions SET card_expiry_notified_for=?, updated_at=NOW() WHERE id=?`, [period, rs.id]);
      out.skipped.push({ id: rs.id, reason: r.refused });
    } else {
      out.skipped.push({ id: rs.id, reason: "delivery_failed" });
    }
  }
  return out;
}

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
    name: "Failed recurring gift → recovery email + task",
    description: "When a donor's recurring card fails, email them a warm branded card-update link in your name and create a task to follow up.",
    trigger: "recurring_failed",
    conditions: [],
    actions: [
      { type: "send_email", template: "recovery" },
      // A.2 — the label is the step, not the word "follow-up" and a name.
      { type: "create_task", title: "Call {donor} about the monthly gift that failed", priority: "high", dueDays: 2 },
    ],
    defaultConfig: {},
  },
  {
    key: "new_donor_welcome",
    name: "New donor's first gift → thank-you + task",
    description: "The moment a brand-new donor gives for the first time, send a branded thank-you and queue a personal welcome call.",
    trigger: "gift_received",
    conditions: [{ field: "is_first_gift", op: "eq", value: true }],
    actions: [
      { type: "send_email", template: "thankyou" },
      { type: "create_task", title: "Personal welcome call: {donor}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "lapsing_reengage",
    name: "Lapsing donor → re-engagement task",
    description: "When a donor crosses your lapse window with no gift, tag them and create a re-engagement task (optionally email them).",
    trigger: "donor_lapsed",
    conditions: [],
    actions: [
      { type: "add_tag", tag: "lapsing" },
      { type: "create_task", title: "Re-engage {donor} — lapsing", priority: "medium", dueDays: 7 },
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
    description: "The instant a gift comes in, alert the executive director and/or the donor's assigned officer — in-app and by email — so a thank-you goes out fast. Set an amount threshold to only be pinged above a certain size.",
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
    description: "When a donor goes meaningfully past their own giving rhythm — the same drift computation the home screen shows, high confidence only — create a task for their relationship owner carrying the reason. Earlier and more personal than the fixed lapse window.",
    trigger: "donor_drifting",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "{donor} is drifting — {reason}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "pledge_due_soon",
    name: "Pledge payment coming due → task for their officer",
    description: "A set number of days before an open pledge's due date, create a task for the donor's relationship owner so the ask never slips. Internal task only — the donor-facing pledge reminder emails are configured separately.",
    trigger: "pledge_due",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "Pledge due {dueDate}: {donor} — {amount} outstanding", priority: "medium", dueDays: 0 },
    ],
    defaultConfig: { leadDays: 14 },
  },
];
const WORKFLOW_RECIPE_MAP = Object.fromEntries(WORKFLOW_RECIPES.map(r => [r.key, r]));

// Lazily provision the recipe rows for an org (disabled by default — nothing
// auto-runs until a human toggles it on). Idempotent via the org+recipe unique.
async function ensureWorkflows(orgId) {
  for (const r of WORKFLOW_RECIPES) {
    await run(
      `INSERT INTO workflows (id,org_id,recipe_key,name,trigger,conditions,actions,config,enabled)
       VALUES (?,?,?,?,?,?,?,?,false)
       ON CONFLICT (org_id,recipe_key) DO NOTHING`,
      ["wf_" + uuid().slice(0, 8), orgId, r.key, r.name, r.trigger,
       JSON.stringify(r.conditions), JSON.stringify(r.actions), JSON.stringify(r.defaultConfig || {})]
    );
  }
}

const asJson = (v, fb) => v == null ? fb : (typeof v === "object" ? v : (() => { try { return JSON.parse(v); } catch { return fb; } })());

// Evaluate a workflow's conditions against the event ctx, honoring config
// overrides (e.g. the major-gift threshold slider maps onto the amount>=X
// condition; the lapse window onto donor_lapsed).
function workflowConditionsPass(conditions, config, ctx) {
  for (const c of conditions) {
    if (c.field === "amount") {
      const threshold = Number(config.threshold ?? c.value);
      if (!(Number(ctx.amount) >= threshold)) return false;
    } else if (c.field === "is_first_gift") {
      if (Boolean(ctx.isFirstGift) !== Boolean(c.value)) return false;
    }
  }
  return true;
}

const escHtmlWf = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Send AT MOST ONE internal email to (org, eventKey, userId). Reserves the
// notification_sends row FIRST (the cross-recipe, per-event dedup — so
// gift-notify and the major-gift owner alert can never both email one person
// for the same gift, A4), then sends. A pref opt-out reserves NOTHING, so a
// different, opted-in notification for the same event can still win. Internal
// staff mail via sendGiftAlertEmail (branded header, NEVER a donor footer).
//
// BUILD-45 (fixes F-2): a REAL send failure is no longer swallowed — the
// reservation is RELEASED (so the alert is not reserved-to-silence) and the
// send is queued in notification_failures for retry on the 5-min tick. Before
// this, a provider outage lost the alert permanently AND any re-trigger of the
// same event deduped to nothing.
async function notifyUserOnce({ org, userId, email, eventKey, channel, prefKind, subject, bodyHtml }) {
  if (!org || !userId || !email || !eventKey) return { sent: false, reason: "no_recipient" };
  if (prefKind && !(await userWantsEmail(userId, prefKind))) return { sent: false, reason: "opted_out" };
  const id = "ns_" + uuid().slice(0, 8);
  const reserved = await query(
    `INSERT INTO notification_sends (id,org_id,event_key,recipient_user_id,channel)
     VALUES (?,?,?,?,?)
     ON CONFLICT (org_id,event_key,recipient_user_id) DO NOTHING
     RETURNING id`,
    [id, org.id, eventKey, userId, channel || null]);
  if (!reserved.length) return { sent: false, reason: "duplicate" };
  const ok = await sendGiftAlertEmail(org, email, subject, bodyHtml);
  if (!ok) {
    // Release the dedup reservation and durably queue the send for retry. Best
    // effort: if the release/queue itself fails we still don't crash the caller
    // (notifications are fire-and-forget), but the loud log makes it visible.
    try {
      await run(`DELETE FROM notification_sends WHERE id=?`, [reserved[0].id]);
      await run(
        `INSERT INTO notification_failures (id,org_id,event_key,recipient_user_id,recipient_email,channel,subject,body_html,attempts,last_error,next_retry_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,NOW())`,
        ["nf_" + uuid().slice(0, 8), org.id, eventKey, userId, email, channel || null, subject || null, bodyHtml || null, "send_rejected"]);
      notifyFailedPending++;
    } catch (e) { console.error("[notify] failed to queue a failed send for retry:", e.message); }
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true };
}

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
// Send-or-queue: every donor-account lifecycle email goes through here. A
// failed send lands in notification_failures (retried on the 5-min tick,
// surfaced on /health.notifications.failedPending) — never fire-and-forget:
// a silently-lost reset email locks a donor out.
async function sendDonorLifecycleEmail(kind, toEmail, subject, html, fromOverride) {
  const ok = await sendRawEmail(toEmail, subject, html, fromOverride);
  if (ok) return true;
  try {
    await run(
      `INSERT INTO notification_failures (id,org_id,event_key,recipient_user_id,recipient_email,channel,subject,body_html,attempts,last_error,next_retry_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,NOW())`,
      ["nf_" + uuid().slice(0, 8), DONOR_EMAIL_ORG, kind + ":" + Date.now(), "donor", toEmail,
       "donor_" + kind, subject, html, "send_rejected"]);
    notifyFailedPending++;
  } catch (e) { console.error("[donor-email] failed to queue for retry:", e.message); }
  return false;
}

const MAX_NOTIFY_ATTEMPTS = 5;
// Cached count of pending/exhausted failed notifications, surfaced on /health
// so the read path stays synchronous. Refreshed by every retry sweep (incl.
// the 50s-after-boot one) and bumped when a new failure is queued.
let notifyFailedPending = 0;
async function refreshNotifyFailedCount() {
  try { notifyFailedPending = Number((await query(`SELECT COUNT(*) c FROM notification_failures`))[0]?.c || 0); }
  catch { /* table not ready yet — leave the last known value */ }
}
async function retryFailedNotifications({ force = false } = {}) {
  const due = await query(
    `SELECT * FROM notification_failures
       WHERE attempts < ? AND (? OR next_retry_at <= NOW())
       ORDER BY next_retry_at ASC LIMIT 100`,
    [MAX_NOTIFY_ATTEMPTS, force]);
  let delivered = 0, stillFailing = 0;
  for (const f of due) {
    // Donor-account lifecycle rows: resend the stored html raw (no org
    // context, no staff dedup reservation) — see DONOR_EMAIL_ORG above.
    if (f.org_id === DONOR_EMAIL_ORG) {
      const okD = await sendRawEmail(f.recipient_email, f.subject, f.body_html);
      if (okD) { await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]); delivered++; }
      else {
        const attemptsD = (f.attempts || 1) + 1;
        await run(
          `UPDATE notification_failures SET attempts=?, last_error=?, next_retry_at = NOW() + (INTERVAL '5 minutes' * ?) WHERE id=?`,
          [attemptsD, "send_rejected", attemptsD, f.id]);
        stillFailing++;
      }
      continue;
    }
    const orgRows = await query("SELECT id, name FROM orgs WHERE id=?", [f.org_id]);
    if (!orgRows.length) { await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]).catch(() => {}); continue; }
    const org = orgRows[0];
    const ok = await sendGiftAlertEmail(org, f.recipient_email, f.subject, f.body_html);
    if (ok) {
      // re-reserve the dedup row (so a later same-event trigger still dedups),
      // then clear the failure. The re-reserve is best-effort — the ON CONFLICT
      // makes a concurrent reservation a no-op.
      await run(
        `INSERT INTO notification_sends (id,org_id,event_key,recipient_user_id,channel)
         VALUES (?,?,?,?,?) ON CONFLICT (org_id,event_key,recipient_user_id) DO NOTHING`,
        ["ns_" + uuid().slice(0, 8), f.org_id, f.event_key, f.recipient_user_id, f.channel || null]).catch(() => {});
      await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]);
      delivered++;
    } else {
      const attempts = (f.attempts || 1) + 1;
      await run(
        `UPDATE notification_failures SET attempts=?, last_error=?, next_retry_at = NOW() + (INTERVAL '5 minutes' * ?) WHERE id=?`,
        [attempts, "send_rejected", attempts, f.id]);
      stillFailing++;
    }
  }
  await refreshNotifyFailedCount();
  return { delivered, stillFailing, considered: due.length };
}

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
const RECONCILE_INTERVAL_MIN = Math.max(5, parseInt(process.env.RECONCILE_INTERVAL_MIN || "20", 10) || 20);
async function reconcileStripeVsGifts() {
  if (!stripe) return reconciliation;
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - RECONCILE_WINDOW_HOURS * 3600;
  const sinceDate = new Date(sinceSec * 1000).toISOString().slice(0, 10);
  const divergences = [];
  let unrecorded = 0, orphans = 0, oldestAgeMin = null, accountsChecked = 0, accountsErrored = 0;
  // Only orgs with a connected account can have taken a donation.
  const orgs = await query(
    "SELECT id, stripe_account_id FROM orgs WHERE stripe_account_id IS NOT NULL LIMIT 500");
  for (const org of orgs) {
    const acct = org.stripe_account_id;
    let charges;
    try {
      charges = await stripe.charges.list({ created: { gte: sinceSec }, limit: 100 }, { stripeAccount: acct });
      accountsChecked++;
    } catch (e) {
      // BUILD-63 — a guard that can't SEE must not report "clean." A read
      // failure here (e.g. a restricted key without connected-account charge
      // access, or a revoked application grant) previously just `continue`d,
      // so the account silently contributed 0 divergences and /health read
      // all-clear while the guard was blind. Count it and surface it: a
      // non-zero accountsErrored means unrecordedCharges:0 is NOT trustworthy.
      accountsErrored++;
      console.error(`[reconcile] charges.list failed for ${acct} — guard BLIND for this account: ${e.message}`);
      continue;
    }
    const seenPIs = new Set();
    for (const ch of (charges?.data || [])) {
      if (ch.status !== "succeeded") continue;
      const net = (ch.amount || 0) - (ch.amount_refunded || 0);
      const piId = ch.payment_intent || null;
      if (piId) seenPIs.add(piId);
      if (net <= 0) {
        // BUILD-63 Part 3 — a fully-refunded charge should have had its gift
        // reversed by the charge.refunded handler. If a gift STILL exists, the
        // handler never ran — either charge.refunded raced ahead of the gift's
        // own payment_intent.succeeded (so there was nothing to reverse when it
        // fired), or the event type isn't subscribed. Surface it; a refunded
        // donation still sitting as a live gift is real divergence.
        if (piId) {
          const staleGift = await query("SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [org.id, piId]);
          if (staleGift.length) {
            orphans++;
            divergences.push({ kind: "refunded_charge_with_live_gift", chargeId: ch.id, paymentIntent: piId,
              account: acct, orgId: org.id, amount: (ch.amount_refunded || 0) / 100 });
          }
        }
        continue;                                   // otherwise: fully refunded, correctly reversed
      }
      if (!piId) continue;                          // donations always ride a PaymentIntent
      const giftRows = await query(
        "SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [org.id, piId]);
      if (!giftRows.length) {
        unrecorded++;
        const ageMin = Math.round((nowSec - (ch.created || nowSec)) / 60);
        if (oldestAgeMin == null || ageMin > oldestAgeMin) oldestAgeMin = ageMin;
        divergences.push({ kind: "charge_without_gift", chargeId: ch.id, paymentIntent: piId,
          account: acct, orgId: org.id, amount: net / 100, ageMin });
      }
    }
    // Reverse: recent online gifts whose PI isn't among the live succeeded
    // charges — retrieve-confirm (capped) so a windowed-list miss can't
    // false-positive.
    const recentGifts = await query(
      "SELECT id, stripe_payment_id FROM gifts WHERE org_id=$1 AND stripe_payment_id LIKE 'pi_%' AND date >= $2 LIMIT 200",
      [org.id, sinceDate]);
    let reverseChecked = 0;
    for (const g of recentGifts) {
      if (seenPIs.has(g.stripe_payment_id)) continue;   // has a live succeeded charge
      if (reverseChecked >= 25) break;
      reverseChecked++;
      let status = "missing";
      try {
        const pi = await stripe.paymentIntents.retrieve(g.stripe_payment_id, {}, { stripeAccount: acct });
        if (pi && pi.status === "succeeded") continue;   // fine — just outside the charge window
        status = pi?.status || "missing";
      } catch { status = "retrieve_failed"; }
      orphans++;
      divergences.push({ kind: "gift_without_charge", giftId: g.id, paymentIntent: g.stripe_payment_id,
        account: acct, orgId: org.id, status });
    }
  }
  reconciliation = {
    unrecordedCharges: unrecorded, orphanGifts: orphans, checkedAt: new Date().toISOString(),
    oldestUnrecordedAgeMin: oldestAgeMin, accountsChecked, accountsErrored, divergences: divergences.slice(0, 50),
  };
  reconcileAccountsWithStripe = orgs.length;   // BUILD-65 Part 6 — the denominator, in sync with this sweep
  if (unrecorded > 0) {
    console.error(`[reconcile] ALERT: ${unrecorded} Stripe charge(s) with NO gift in Steward (oldest ${oldestAgeMin}m) — ${JSON.stringify(divergences.filter(d => d.kind === "charge_without_gift").slice(0, 10))}`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`reconciliation: ${unrecorded} unrecorded Stripe charge(s)`, "error"); } catch { /* surfacing must never throw */ }
  }
  if (accountsErrored > 0) {
    console.error(`[reconcile] ${accountsErrored} connected account(s) could not be read — the guard is BLIND for them; unrecordedCharges:${unrecorded} is not a clean bill of health.`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`reconciliation: guard blind for ${accountsErrored} account(s)`, "warning"); } catch { /* never throw */ }
  }
  return reconciliation;
}

// ── BUILD-63 Part 2 — refresh the manifest-vs-live-subscription diff ─────────
// Lists the platform's webhook endpoints, finds the donation (/stripe/webhook)
// and billing (/billing/webhook) endpoints by URL, and diffs each endpoint's
// subscribed event list against its manifest. Caches missingCount for /health.
// Read-only. Cheap (one list call), so it runs at boot + hourly.
async function checkWebhookSubscriptions() {
  if (!stripe) { webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] }; return webhookSubStatus; }
  try {
    const eps = await stripe.webhookEndpoints.list({ limit: 100 });
    const byManifest = [
      { route: "/stripe/webhook", manifest: DONATION_WEBHOOK_EVENTS },
      { route: "/billing/webhook", manifest: BILLING_WEBHOOK_EVENTS },
    ];
    const endpoints = [];
    let totalMissing = 0;
    for (const { route, manifest } of byManifest) {
      const ep = (eps?.data || []).find(e => typeof e.url === "string" && e.url.endsWith(route) && e.status !== "disabled");
      if (!ep) { endpoints.push({ route, found: false, missing: manifest.slice(), extra: [] }); totalMissing += manifest.length; continue; }
      const diff = webhookEventDiff(manifest, ep.enabled_events || []);
      endpoints.push({ route, found: true, endpointId: ep.id, missing: diff.missing, extra: diff.extra, wildcard: diff.wildcard });
      totalMissing += diff.missing.length;
    }
    webhookSubStatus = { missingCount: totalMissing, checked: true, checkedAt: new Date().toISOString(), endpoints };
    if (totalMissing > 0) {
      console.error(`[webhook-manifest] ${totalMissing} handled event type(s) NOT subscribed on the live endpoint(s): ${JSON.stringify(endpoints.filter(e => e.missing.length))}`);
      try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`webhook manifest: ${totalMissing} handled event(s) unsubscribed`, "warning"); } catch { /* surfacing must never throw */ }
    }
  } catch (e) {
    console.error("[webhook-manifest] subscription check failed:", e.message);
    // leave the last known value; mark unchecked only if never checked
    if (!webhookSubStatus.checked) webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] };
  }
  return webhookSubStatus;
}

// BUILD-36 A2 — email a task's assignee when someone ELSE (or a workflow)
// assigned it. NO email for a self-assigned task. Deduped/idempotent via
// notifyUserOnce: default eventKey = taskassign:<taskId>:<assigneeId> (so
// reassigning to a NEW person notifies once), but a gift-fired workflow passes
// the gift event key so the assignment email collapses with gift-notify (A4).
async function notifyTaskAssignment(task, { org, actorUserId = null, eventKey = null }) {
  const assigneeId = task && task.assigned_to;
  if (!assigneeId) return { sent: false, reason: "unassigned" };
  if (actorUserId && assigneeId === actorUserId) return { sent: false, reason: "self_assigned" };
  const urows = await query("SELECT id, name, email FROM users WHERE id=? AND org_id=?", [assigneeId, org.id]);
  if (!urows.length || !urows[0].email) return { sent: false, reason: "no_recipient" };
  const assignee = urows[0];
  const donorName = task.donor_id
    ? (await query("SELECT name FROM donors WHERE id=? AND org_id=?", [task.donor_id, org.id]))[0]?.name
    : null;
  let actorName = null;
  if (actorUserId) {
    const ar = await query("SELECT name FROM users WHERE id=? AND org_id=?", [actorUserId, org.id]);
    actorName = ar[0]?.name || null;
  }
  const context = actorName
    ? `${displayNameCase(actorName)} assigned you a task`
    : `A new task is waiting for you`;
  const donorLine = donorName ? `<p style="margin:4px 0;color:#0f1a12;">Donor: <strong>${escHtmlWf(displayNameCase(donorName))}</strong></p>` : "";
  const dueLine = task.due ? `<p style="margin:4px 0;color:#6b7d70;">Due ${escHtmlWf(String(task.due).slice(0, 10))}</p>` : "";
  const body = `<p>${escHtmlWf(context)} in ${escHtmlWf(displayNameCase(org.name))}.</p>
<p style="font-size:16px;margin:12px 0 2px;color:#0f1a12;"><strong>${escHtmlWf(task.title)}</strong></p>
${donorLine}${dueLine}
<p style="margin-top:14px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">Open Steward →</a></p>`;
  return notifyUserOnce({
    org, userId: assignee.id, email: assignee.email,
    eventKey: eventKey || `taskassign:${task.id}:${assignee.id}`,
    channel: "task_assignment", prefKind: "task_assignments",
    subject: `New task: ${task.title}`, bodyHtml: body,
  });
}

// BUILD-36 A1 — provision a NEW org's workflow recipes with instant_gift_thanks
// ON by default (ED & assigned officer). Hearing about a gift is the product
// working, not a setting to discover. Called only at org creation, so existing
// orgs are never re-created and their toggles stay untouched.
async function provisionNewOrgWorkflows(orgId) {
  await ensureWorkflows(orgId);
  await run(
    "UPDATE workflows SET enabled=true, config=? WHERE org_id=? AND recipe_key='instant_gift_thanks'",
    [JSON.stringify({ notify: "both", threshold: 0 }), orgId]);
}

// Execute one action. Returns a summary object for the run log, or null.
async function runWorkflowAction(action, { org, donor, ctx, config, recipeKey }) {
  const wfActor = sysWorkflow(recipeKey || "unknown"); // BUILD-75 C.1 — the workflow IS the actor
  const firstName = donor?.name ? donor.name.trim().split(/\s+/)[0] : "there";
  const amtStr = ctx.amount != null ? `$${Number(ctx.amount).toLocaleString()}` : "";
  const fill = s => String(s || "").replace(/{donor}/g, donor?.name || "the donor").replace(/{amount}/g, amtStr)
    .replace(/{reason}/g, ctx.reason || "past their own giving pattern")   // BUILD-76 — the drift reason, the donor's own words-worthy sentence
    .replace(/{dueDate}/g, ctx.dueDate ? orgTime.formatCivil(ctx.dueDate) : "soon");
  switch (action.type) {
    case "create_task":
    case "notify_owner": {
      // BUILD-76 Part 7 — assignToOwner lets a plain create_task land with the
      // donor's relationship owner (same ED fallback + recorded flag).
      const isOwner = action.type === "notify_owner" || action.assignToOwner === true;
      // The alert lands with the donor's relationship owner. BUILD-25 A1.4: a
      // major-gift donor with NO assigned owner must degrade gracefully — the
      // alert falls back to the ED (first org admin) rather than becoming an
      // orphaned, unassigned task nobody sees. A silently dropped major-gift
      // alert is exactly the failure mode this recipe exists to prevent. The
      // fallback is recorded in the run summary (assignedFallback) so the run
      // log tells the truth about who was actually alerted.
      let owner = isOwner && donor?.assigned_to ? { id: donor.assigned_to, name: donor.assigned_to_name || "" } : null;
      let assignedFallback = false;
      if (isOwner && !owner) {
        const admins = await query("SELECT id, name FROM users WHERE org_id=? AND role='admin' ORDER BY created_at ASC LIMIT 1", [org.id]);
        if (admins.length) { owner = { id: admins[0].id, name: admins[0].name || "" }; assignedFallback = true; }
      }
      // BUILD-76 Part 7 (D.3 §2) — the default owner-alert title carries the
      // donor's context: lifetime and last gift, so the officer can pick up
      // the phone without opening the record first. An explicit action.title
      // (the new recipes) wins and is placeholder-filled.
      const lifetime = donor && Number(donor.total_giving) > 0 ? `$${Number(donor.total_giving).toLocaleString()} lifetime` : null;
      const lastGift = donor?.last_gift_date ? `last gift ${orgTime.formatCivil(String(donor.last_gift_date).slice(0, 10))}` : null;
      const donorCtxStr = [lifetime, lastGift].filter(Boolean).join(", ");
      const title = action.title
        ? fill(action.title)
        : isOwner
          ? `Stewardship alert: ${donor?.name || "a major donor"} gave ${amtStr || "a major gift"}${donorCtxStr ? ` (${donorCtxStr})` : ""}`
          : "Follow up";
      const due = action.dueDays != null ? new Date(Date.now() + action.dueDays * 86400000).toISOString().slice(0, 10) : "";
      const taskId = "t_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW(),?,?)",
        [taskId, org.id, title, due, action.priority || "medium", donor?.id || null, owner?.id || null, owner?.name || null, wfActor.id, wfActor.name]
      );
      // BUILD-36 A2/A4: a workflow that assigns a task to someone emails them.
      // For a gift-fired workflow the event key is the gift, so this collapses
      // with gift-notify (one email per person per gift). notify_owner is the
      // "major-gift owner alert" A4 names explicitly.
      if (owner?.id) {
        await notifyTaskAssignment(
          { id: taskId, org_id: org.id, title, due, donor_id: donor?.id || null, assigned_to: owner.id, assigned_to_name: owner.name },
          { org, actorUserId: null, eventKey: ctx.giftId ? `gift:${ctx.giftId}` : `taskwf:${taskId}` }
        ).catch(e => console.error("[workflow] task-assign email:", e.message));
      }
      return { type: action.type, taskId, title, ...(isOwner ? { assignedTo: owner?.id || null, assignedFallback } : {}) };
    }
    case "notify_gift": {
      // Resolve who to notify: ED = org admins, owner = the donor's assigned
      // officer. config.notify ∈ ed|owner|both (default both).
      const mode = ["ed", "owner", "both"].includes(config.notify) ? config.notify : "both";
      const wantEd = mode === "ed" || mode === "both";
      const wantOwner = mode === "owner" || mode === "both";
      const recipients = []; // { id, name, email }
      const seen = new Set();
      const push = u => { if (u && u.id && !seen.has(u.id)) { seen.add(u.id); recipients.push(u); } };
      let owner = null;
      if (wantOwner && donor?.assigned_to) {
        const or = await query("SELECT id, name, email FROM users WHERE id=? AND org_id=?", [donor.assigned_to, org.id]);
        if (or.length) { owner = or[0]; push(or[0]); }
      }
      if (wantEd) {
        const admins = await query("SELECT id, name, email FROM users WHERE org_id=? AND role='admin' ORDER BY created_at ASC", [org.id]);
        admins.forEach(push);
      }
      // The task lands with whoever should own the thank-you: the assigned
      // officer if there is one, else the first admin (the ED).
      const taskOwner = owner || recipients[0] || null;
      const title = `Thank ${donor?.name || "a donor"} — ${amtStr || "a gift"} just came in`;
      const due = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
      const taskId = "t_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW(),?,?)",
        [taskId, org.id, title, due, "high", donor?.id || null, taskOwner?.id || null, taskOwner?.name || null, wfActor.id, wfActor.name]
      );
      // Email each distinct recipient (internal, no donor footer).
      const emailBody = `<p>A gift just came in — a good moment to say thank you.</p>
<p style="font-size:16px"><strong>${escHtmlWf(donor?.name || "A donor")}</strong> gave <strong>${escHtmlWf(amtStr || "a gift")}</strong> to ${escHtmlWf(displayNameCase(org.name))}.</p>
<p>Open Steward to send a thank-you while it's fresh — a fast, personal thank-you is the single biggest driver of a donor giving again.</p>`;
      // BUILD-36 A4: route through notifyUserOnce — respects the recipient's
      // per-user toggle AND dedups per gift event, so this gift-notify and the
      // major-gift owner alert never both email the same person for one gift.
      const giftEventKey = ctx.giftId ? `gift:${ctx.giftId}` : `giftnotify:${ctx.dedupKey}`;
      for (const r of recipients) {
        if (r.email) await notifyUserOnce({
          org, userId: r.id, email: r.email, eventKey: giftEventKey, channel: "gift",
          prefKind: "portfolio_gifts",
          subject: `New gift: ${donor?.name || "a donor"} gave ${amtStr || "a gift"}`, bodyHtml: emailBody,
        });
      }
      return { type: "notify_gift", taskId, notified: recipients.map(r => r.name || r.email).filter(Boolean), mode };
    }
    case "add_tag": {
      if (!donor?.id) return null;
      const tags = asJson(donor.tags, []);
      if (!tags.includes(action.tag)) {
        tags.push(action.tag);
        await run("UPDATE donors SET tags=?, updated_at=NOW() WHERE id=? AND org_id=?", [JSON.stringify(tags), donor.id, org.id]);
      }
      return { type: "add_tag", tag: action.tag };
    }
    case "send_email": {
      if (!donor) return null;
      if (action.template === "recovery") {
        // W-4 log honesty: actions_taken records what actually happened, not
        // what was attempted — sent:false rows are visible in the run log.
        const r = ctx.subscriptionRow ? await sendDunningEmail(org, donor, ctx.subscriptionRow) : { sent: false, refused: "no_subscription" };
        return { type: "send_email", template: "recovery", sent: r.sent === true, ...(r.refused ? { refused: r.refused } : {}) };
      }
      if (action.template === "thankyou") {
        const body = `<p>Hi ${escHtmlWf(firstName)},</p>
<p>Thank you for your first gift to ${escHtmlWf(displayNameCase(org.name))} — welcome to our community. Gifts like yours are exactly what make our work possible, and we're so glad you're part of it.</p>
<p>You'll hear from a real person here soon. In the meantime, just reply if there's anything you'd like to know.</p>
<p>With gratitude,<br/>${escHtmlWf(displayNameCase(org.name))}</p>`;
        const sentTy = await sendWorkflowEmail(org, donor, `Thank you from ${displayNameCase(org.name)}`, body);
        return { type: "send_email", template: "thankyou", sent: sentTy === true };
      }
      if (action.template === "reengage") {
        const body = `<p>Hi ${escHtmlWf(firstName)},</p>
<p>It's been a while, and we've missed you at ${escHtmlWf(displayNameCase(org.name))}. Your past support made a real difference — and there's more good work ahead we'd love for you to be part of.</p>
<p>If now's a good time to come back, we'd be grateful. And if not, thank you all the same.</p>
<p>Warmly,<br/>${escHtmlWf(displayNameCase(org.name))}</p>`;
        const sentRe = await sendWorkflowEmail(org, donor, `We've missed you at ${displayNameCase(org.name)}`, body);
        return { type: "send_email", template: "reengage", sent: sentRe === true };
      }
      return null;
    }
    default:
      return null;
  }
}

// Fire all enabled workflows for (org, trigger). ctx: { dedupKey, donorId,
// giftId, amount, isFirstGift, subscriptionRow, entityType, entityId,
// extraActions }. Idempotent per (workflow, dedupKey). Returns what ran so a
// caller (the dunning webhook) can coordinate — e.g. avoid a double day-0 send.
async function fireWorkflows(orgId, trigger, ctx) {
  const wfs = await query("SELECT * FROM workflows WHERE org_id=? AND trigger=? AND enabled=true", [orgId, trigger]);
  const ran = [];
  if (!wfs.length) return { ran };
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ran };
  const donorRows = ctx.donorId ? await query("SELECT * FROM donors WHERE id=? AND org_id=?", [ctx.donorId, orgId]) : [];
  const donor = donorRows[0] || null;

  for (const wf of wfs) {
    const conditions = asJson(wf.conditions, []);
    let actions = asJson(wf.actions, []);
    const config = asJson(wf.config, {});
    if (!workflowConditionsPass(conditions, config, ctx)) continue;
    // Config can toggle the optional re-engagement email on the lapse recipe.
    if (wf.recipe_key === "lapsing_reengage" && config.sendEmail && !actions.some(a => a.type === "send_email")) {
      actions = [...actions, { type: "send_email", template: "reengage" }];
    }

    // Reserve the run row FIRST — the unique (workflow_id, dedup_key) makes a
    // redelivered event a no-op (RETURNING is empty on conflict).
    const runId = "wfr_" + uuid().slice(0, 8);
    const reserved = await query(
      `INSERT INTO workflow_runs (id,org_id,workflow_id,recipe_key,trigger,dedup_key,entity_type,entity_id,donor_id,actions_taken)
       VALUES (?,?,?,?,?,?,?,?,?,'[]')
       ON CONFLICT (workflow_id,dedup_key) DO NOTHING
       RETURNING id`,
      [runId, orgId, wf.id, wf.recipe_key, trigger, ctx.dedupKey, ctx.entityType || null, ctx.entityId || null, ctx.donorId || null]
    );
    if (!reserved.length) continue; // already ran for this event

    const taken = [];
    for (const a of actions) {
      try { const res = await runWorkflowAction(a, { org, donor, ctx, config, recipeKey: wf.recipe_key }); if (res) taken.push(res); }
      catch (e) { console.error(`[workflow:${wf.recipe_key}] action ${a.type} failed:`, e.message); }
    }
    await run("UPDATE workflow_runs SET actions_taken=? WHERE id=?", [JSON.stringify(taken), runId]);
    ran.push({ workflowId: wf.id, recipeKey: wf.recipe_key, actions: taken });
  }
  return { ran };
}

// Scheduled sweep for the donor_lapsed trigger (no webhook fires it). Runs on
// the existing 5-min tick. Only touches orgs that have the recipe enabled;
// dedup is per donor + their current last_gift_date so a given lapse fires once.
// Optional onlyOrgId scopes the sweep to one org (the ops/test trigger route).
async function processWorkflowSweeps(onlyOrgId = null) {
  const orgRows = onlyOrgId
    ? await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_lapsed' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_lapsed' AND enabled=true");
  for (const { org_id: orgId } of orgRows) {
    try {
      const wfRows = await query("SELECT config FROM workflows WHERE org_id=? AND recipe_key='lapsing_reengage' AND enabled=true", [orgId]);
      const lapseDays = Number(asJson(wfRows[0]?.config, {}).lapseDays ?? 365);
      const cutoff = new Date(Date.now() - lapseDays * 86400000).toISOString().slice(0, 10);
      // BUILD-25 A0 (P0): the lapse sweep fires ONLY for a lapse that crossed the
      // window WHILE the donor was live in Steward — never for a historical record
      // imported (or backfilled) already-lapsed. A donor whose last gift predates
      // their own created_at by more than the lapse window was loaded already-past
      // the boundary; that is history, not a live event, so it must not blast a
      // re-engagement email/task. The crossing date = last_gift_date + lapseDays;
      // we fire only when that date is on/after created_at (the transition happened
      // in-system). A donor imported while still active who later crosses the
      // window DOES fire — that's a genuine live transition. This is the
      // "recipes act on new live events, not records being loaded" guarantee,
      // enforced in SQL so no import path can slip past it.
      const lapsing = await query(
        `SELECT id, last_gift_date FROM donors d
          WHERE org_id=? AND deleted_at IS NULL AND gift_count > 0
            AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.imported_sustainer IS NOT TRUE
            AND last_gift_date IS NOT NULL AND last_gift_date <> '' AND last_gift_date < ?
            AND created_at::date <= (last_gift_date::date + INTERVAL '${parseInt(lapseDays, 10)} days')
          LIMIT 200`,
        [orgId, cutoff]
      );
      for (const d of lapsing) {
        await fireWorkflows(orgId, "donor_lapsed", {
          dedupKey: `lapsed:${d.id}:${d.last_gift_date}`,
          donorId: d.id, entityType: "donor", entityId: d.id,
        });
      }
    } catch (e) { console.error("[workflow-sweep] org", orgId, e.message); }
  }

  // ── BUILD-76 Part 7 — quiet_past_pattern: THE drift engine, as a trigger ──
  // Not a second definition: the sweep reads computeDriftForDonors (the same
  // one function the home list and every badge read). High confidence only —
  // an officer sent to call for a wrong reason once discounts the list
  // forever. Dedup per (donor, last_gift_date): one drift episode fires once;
  // a new gift starts a new episode. The BUILD-25 live-transition guarantee:
  // the drift must have STARTED on/after the donor's created_at — a file
  // imported already-drifting is history, not an event.
  const driftOrgRows = onlyOrgId
    ? await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_drifting' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_drifting' AND enabled=true");
  for (const { org_id: orgId } of driftOrgRows) {
    try {
      const { map } = await computeDriftForDonors(orgId);
      let fired = 0;
      for (const a of map.values()) {
        if (fired >= 200) break;   // same per-sweep cap as the lapse sweep
        if (a.state !== "drifting" || a.confidence !== "high") continue;
        if (!a.driftStartDate || !a.donorCreatedDate) continue;
        if (orgTime.compareCivil(a.driftStartDate, a.donorCreatedDate) < 0) continue; // drifted before we ever knew them — history, not an event
        await fireWorkflows(orgId, "donor_drifting", {
          dedupKey: `drift:${a.donorId}:${a.lastGiftDate}`,
          donorId: a.donorId, entityType: "donor", entityId: a.donorId,
          reason: a.reason,
        });
        fired++;
      }
    } catch (e) { console.error("[workflow-sweep drift] org", orgId, e.message); }
  }

  // ── BUILD-76 Part 7 — pledge_due_soon: a task leadDays before due ────────
  // Open pledges only (status='open' IS "remaining balance > 0" — the
  // partial-payment recompute keeps that true), inside [today, today+lead]
  // on the ORG's calendar. Dedup per (pledge, due_date). Task only — the
  // donor-facing pledge reminder machinery is separate and untouched (C.2).
  const pledgeOrgRows = onlyOrgId
    ? await query("SELECT org_id, config FROM workflows WHERE trigger='pledge_due' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT org_id, config FROM workflows WHERE trigger='pledge_due' AND enabled=true");
  for (const { org_id: orgId, config } of pledgeOrgRows) {
    try {
      const leadDays = Math.max(1, parseInt(asJson(config, {}).leadDays, 10) || 14);
      const org = await orgTz(orgId);
      const todayStr = orgToday(org);                                  // ORG_TZ_SEAM_OK
      const horizon = orgTime.addDays(todayStr, leadDays);
      const due = await query(
        `SELECT p.id, p.donor_id, p.amount, p.due_date,
                COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.pledge_id = p.id AND g.org_id = p.org_id), 0) AS paid
           FROM pledges p
          WHERE p.org_id = ? AND p.status = 'open'
            AND p.due_date >= ? AND p.due_date <= ?
          LIMIT 200`,
        [orgId, todayStr, horizon]);
      for (const p of due) {
        const remaining = Math.max(0, (parseFloat(p.amount) || 0) - (parseFloat(p.paid) || 0));
        if (remaining <= 0) continue;
        await fireWorkflows(orgId, "pledge_due", {
          dedupKey: `pledgedue:${p.id}:${p.due_date}`,
          donorId: p.donor_id, entityType: "pledge", entityId: p.id,
          amount: remaining, dueDate: String(p.due_date).slice(0, 10),
        });
      }
    } catch (e) { console.error("[workflow-sweep pledge] org", orgId, e.message); }
  }
}
// BUILD-51b — keep /health's themeAssets.dbFallbackRows fresh (failed-S3-put
// visibility); same 5-min cadence, never a second scheduler. BUILD-56 adds
// the softDeleted (restorable) count on the same tick.
if (!backgroundTicksDisabled()) {
  setTimeout(() => refreshAssetFallbackCount().catch(console.error), 20000);
  setInterval(() => refreshAssetFallbackCount().catch(console.error), 5 * 60 * 1000);
  setTimeout(() => refreshRetentionCounts().catch(console.error), 20000);
  setInterval(() => refreshRetentionCounts().catch(console.error), 5 * 60 * 1000);
  // BUILD-56 Part 4 — the retention purge: destroys objects soft-deleted more
  // than ASSET_RETENTION_DAYS ago (never a referenced one; every destruction
  // logged in asset_purge_log). 6-hour cadence like checkTrialExpiry.
  setTimeout(() => purgeExpiredAssets().catch(console.error), 90000);
  setInterval(() => purgeExpiredAssets().catch(console.error), 6 * 60 * 60 * 1000);
} else {
  // Ticks off (test boot): populate the /health counters once at load — a
  // read-only count, no mail/state side effects — so the fields aren't stale.
  refreshAssetFallbackCount().catch(console.error);
  refreshRetentionCounts().catch(console.error);
}

// ── Recurring gift recovery: staff-facing routes ────────────────────────────
// ── BUILD-83 Part 5.1 — ONE DEFINITION OF THE FILE'S OWN SUSTAINER FACTS. ──
// Home, the Recurring tab's headline, its exception tiles and the setup
// checklist all read THIS. Before it, Home said "100 stopped" while the tab
// said "160" and "0 giving" on the same file — three code paths for one fact,
// which is the thing this build forbids.
//   fromFile  every sustainer the org's own file names
//   stopped   the ones who have stopped giving: a failed card OR a "still
//             Active" claim the gift pattern contradicts (the file's Status
//             column is stale; the pattern is the truth — BUILD-82 Part 5)
//   giving    the rest. Connection to a payment method HERE is a separate axis.
async function sustainerFileFacts(orgId, today) {
  // ONE definition of "stopped giving": a monthly donor whose giving has
  // actually stopped — their last sustainer gift is older than the window — or
  // whom the file itself flags as stopped (a failed card, or a "still Active"
  // claim the gift pattern contradicts). The two halves agree on real files;
  // keeping both means neither a flagless silence nor a flagged-but-recent row
  // can slip past. STOPPED_DAYS is the same 60-day window /recurring/unlinked
  // has always used.
  const STOPPED_DAYS = 60;
  const cutoff = orgTime.addDays(today || orgToday(await orgTz(orgId)), -STOPPED_DAYS);   // ORG_TZ_SEAM_OK
  const STOPPED_SQL = `(COALESCE(tags::text,'') LIKE '%card-failed%'
                     OR COALESCE(tags::text,'') LIKE '%stale-frequency%'
                     OR (imported_sustainer_last_gift IS NOT NULL AND imported_sustainer_last_gift < ?))`;
  const rows = await query(
    `SELECT COUNT(*)::int AS from_file,
            COUNT(*) FILTER (WHERE ${STOPPED_SQL})::int AS stopped,
            COUNT(*) FILTER (WHERE stripe_subscription_id IS NOT NULL)::int AS connected,
            COUNT(*) FILTER (WHERE ${STOPPED_SQL} AND COALESCE(email,'') = '')::int AS stopped_no_email
       FROM donors WHERE org_id=? AND deleted_at IS NULL AND imported_sustainer IS TRUE`,
    [cutoff, cutoff, orgId]);
  const f = rows[0] || {};
  const fromFile = f.from_file || 0, stopped = f.stopped || 0;
  return { fromFile, stopped, giving: Math.max(0, fromFile - stopped),
           connected: f.connected || 0, stoppedWithoutEmail: f.stopped_no_email || 0 };
}

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

async function processPledgeReminders() {
  try {
    // Step 1 — the trigger. Recurring dunning's cadence is initialized by a
    // Stripe webhook (invoice.payment_failed); a pledge due date has no
    // equivalent external event, so this scan IS the trigger: any open
    // pledge whose due date has just passed starts its cadence at "day 0"
    // (fires immediately, same as a fresh payment failure does).
    // ORG_TZ_SEAM_OK — "the due date has passed" is a comparison of TWO CIVIL
    // DATES in the org's own calendar. CURRENT_DATE is the Postgres session
    // zone, so a pledge in a western org used to start its dunning cadence
    // hours early — a reminder email about money, sent on the wrong day.
    const _overdueOrgs = await query("SELECT id, timezone FROM orgs", []);
    for (const _o of _overdueOrgs) {
      await run(
        `UPDATE pledges SET first_overdue_at=NOW(), next_reminder_at=NOW(), updated_at=NOW()
         WHERE org_id=? AND status='open' AND first_overdue_at IS NULL AND due_date::date < ?::date
           AND COALESCE(is_match,false) = false`,
        [_o.id, orgToday(_o)]
      );
    }

    // Step 2 — send whatever's due, exactly like processDunning().
    const rows = await query(
      `SELECT p.*, d.name AS donor_name, d.email AS donor_email
       FROM pledges p
       JOIN donors d ON d.id = p.donor_id
       WHERE p.status = 'open' AND p.next_reminder_at <= NOW()
         AND COALESCE(p.is_match,false) = false`
    );
    for (const p of rows) {
      try {
        const orgRows = await query(
          "SELECT id, name, org_slug, pledge_reminder_enabled, pledge_reminder_subject, pledge_reminder_body FROM orgs WHERE id=?",
          [p.org_id]
        );
        const org = orgRows[0];
        if (!org || !p.donor_email) continue;
        // Org turned this off — leave the cadence/step where it is (so it
        // picks back up correctly if re-enabled) but don't send.
        if (org.pledge_reminder_enabled === false) continue;

        await sendPledgeReminderEmail(org, { name: p.donor_name, email: p.donor_email }, p);
        await run(
          "INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata) VALUES (?,?,?,?,?,?,?)",
          ["int_" + uuid().slice(0, 8), p.org_id, p.donor_id, "pledge_reminder",
           `Pledge reminder sent — $${Number(p.amount).toLocaleString()} pledge due ${new Date(p.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
           new Date().toISOString().split("T")[0], JSON.stringify({ pledge_id: p.id, step: p.reminder_step })]
        );

        const nextStep = p.reminder_step + 1;
        const nextDelayDays = PLEDGE_REMINDER_SCHEDULE_DAYS[nextStep];
        const nextReminderAt = nextDelayDays != null
          ? new Date(new Date(p.first_overdue_at).getTime() + nextDelayDays * 86400000).toISOString()
          : null; // exhausted the cadence — stop sending; stays 'open' until fulfilled/written off manually
        await run(
          `UPDATE pledges SET reminder_step=?, next_reminder_at=?, updated_at=NOW() WHERE id=?`,
          [nextStep, nextReminderAt, p.id]
        );
      } catch (e) { console.error("[pledge-reminder] pledge", p.id, e.message); }
    }
  } catch (e) { console.error("[pledge-reminder] processPledgeReminders:", e.message); }
}

// ── Billing helpers ────────────────────────────────────────────────────────
function getOrgAccessState(org) {
  const status = org.subscription_status || "trialing";
  const now = Date.now();
  const graceUntil = org.grace_until ? new Date(org.grace_until).getTime() : null;
  if (status === "active" || status === "trialing") return "full";
  if (status === "past_due" || status === "canceled" || status === "cancelled") {
    if (graceUntil && now < graceUntil) return "warning";
    return "read_only";
  }
  if (status === "trial_expired") return "read_only";
  return "full";
}

async function checkWriteAccess(req, res, next) {
  try {
    const orgs = await query("SELECT subscription_status, grace_until FROM orgs WHERE id=?", [req.user.orgId]);
    if (orgs.length && getOrgAccessState(orgs[0]) === "read_only") {
      return res.status(402).json({ error: "subscription_required", message: "Your account is in read-only mode. Reactivate your subscription to make changes." });
    }
  } catch (e) { console.error("checkWriteAccess error:", e); }
  next();
}

// ── Billing ────────────────────────────────────────────────────────────────

// The orgs column that holds the platform billing customer for the CURRENT
// Stripe mode. A customer created in test mode doesn't exist under a live key
// (and vice-versa), so each mode gets its own column — stripe_customer_id is the
// LIVE customer (existing prod values are live), stripe_customer_id_test the
// test one. Never overwrite the other mode's column.
function billingCustomerColumn() {
  return billingStripeMode() === "test" ? "stripe_customer_id_test" : "stripe_customer_id";
}

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

async function checkBillingPriceModes() {
  const mode = billingStripeMode();
  const configured = Object.entries(PLAN_PRICE_ENV)
    .map(([plan, envName]) => ({ plan, envName, id: process.env[envName] }))
    .filter(p => p.id);
  const status = { mode, checked: false, ok: null, prices: [], checkedAt: new Date().toISOString() };
  if (!billingStripe || !mode || !configured.length) { billingModeStatus = status; return status; }
  status.checked = true;
  let anyMismatch = false;
  for (const p of configured) {
    try {
      await billingStripe.prices.retrieve(p.id);
      status.prices.push({ plan: p.plan, env: p.envName, ok: true });
    } catch (err) {
      const cls = billingConfigError(err);
      const reason = cls ? cls.type : (err.code || err.type || "error");
      if (cls) anyMismatch = true;               // resource_missing on the price = wrong mode / bad id
      status.prices.push({ plan: p.plan, env: p.envName, ok: false, reason });
    }
  }
  status.ok = !anyMismatch;
  billingModeStatus = status;
  return status;
}

// Run the check once shortly after boot (non-blocking) and log loudly on a mismatch.
function scheduleBillingModeCheck() {
  if (!billingStripe) return;
  setTimeout(() => {
    checkBillingPriceModes().then(s => {
      if (!s.checked) return;
      if (s.ok) {
        console.log(`[billing] mode check OK — billing key is ${String(s.mode).toUpperCase()}; all ${s.prices.length} configured price(s) resolve.`);
      } else {
        const bad = s.prices.filter(p => !p.ok).map(p => `${p.env} (${p.reason})`).join(", ");
        console.error(
          `[billing] ============================================================\n` +
          `[billing] MODE MISMATCH: billing key is ${String(s.mode).toUpperCase()} but these ` +
          `price ids do NOT resolve in that mode: ${bad}.\n` +
          `[billing] Align STRIPE_BILLING_SECRET_KEY, the STRIPE_PRICE_* ids, the billing ` +
          `webhook secret, and the Customer Portal config to the SAME Stripe mode, or upgrades will fail.\n` +
          `[billing] ============================================================`
        );
      }
    }).catch(e => console.error("[billing] mode check failed:", e && e.message));
  }, 8000);
}

// Which STRIPE_PRICE_* env var backs each plan — used only for a precise server
// log ("billing key is TEST but STRIPE_PRICE_TEAM is a LIVE price").
const PLAN_PRICE_ENV = {
  core: "STRIPE_PRICE_CORE", team: "STRIPE_PRICE_TEAM", founding: "STRIPE_PRICE_FOUNDING",
  seed: "STRIPE_PRICE_SEED", growth: "STRIPE_PRICE_GROWTH", impact: "STRIPE_PRICE_IMPACT",
};

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
function signCancelToken(orgId) {
  const payload = Buffer.from(JSON.stringify({ cancelOrgId: orgId })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update("cancel:" + payload).digest("base64url");
  return `${payload}.${sig}`;
}

// Find every org whose charge is seven days out and warn it once.
// `now` is injectable so the suite can stand on day 23 without waiting.
async function processTrialReminders({ now = Date.now(), send = true } = {}) {
  const out = { considered: 0, sent: [], skipped: [] };
  const orgs = await query(
    `SELECT id, name, plan, trial_ends_at, billing_card_brand, billing_card_last4, stripe_subscription_id
       FROM orgs
      WHERE subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_reminder_sent_at IS NULL
        -- NO SUBSCRIPTION, NO CHARGE, NO WARNING. This email names an amount,
        -- a date and a card's last four digits. An org with no Stripe
        -- subscription behind it — a manual super-admin grant, a demo org, a
        -- legacy trial that never went through Checkout — has nothing coming,
        -- and telling it otherwise would be a lie about money.
        AND stripe_subscription_id IS NOT NULL`, []);
  for (const org of orgs) {
    if (!isReminderDue(org.trial_ends_at, now)) continue;
    out.considered++;
    const plan = closePlan(org.plan);
    if (!plan) { out.skipped.push({ id: org.id, reason: "no_priced_plan" }); continue; }
    const admins = await query(
      "SELECT email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL ORDER BY created_at ASC LIMIT 1", [org.id]);
    const to = admins[0]?.email;
    if (!to) { out.skipped.push({ id: org.id, reason: "no_admin" }); continue; }
    const tz = await orgTzName(org.id);
    const sentence = firstChargeSentence({ monthlyUsd: plan.monthlyUsd, firstChargeAt: org.trial_ends_at, tz });
    // Canonical domain via the vercel.json /billing/cancel proxy rewrite — a
    // cancel link is exactly where an unfamiliar host would read as a phish.
    const cancelUrl = `${publicAppUrl()}/billing/cancel/${signCancelToken(org.id)}`;
    const from = process.env.FOUNDER_EMAIL || process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
    let delivered = false;
    if (!send) {
      delivered = true;
    } else if (process.env.RESEND_API_KEY) {
      try {
        const { error } = await resend.emails.send({
          from, to, replyTo: from,
          subject: `Your first Steward charge is ${formatChargeDate(org.trial_ends_at, tz)}`,
          html: trialReminderEmailHtml({
            orgName: org.name, sentence,
            cardBrand: org.billing_card_brand, cardLast4: org.billing_card_last4, cancelUrl,
          }),
        });
        if (error) throw new Error(error.message);
        delivered = true;
      } catch (e) { console.error("[trial-reminder] send failed for", org.id, e.message); }
    } else {
      console.warn("[trial-reminder] RESEND_API_KEY not set — no email sent for", org.id);
    }
    if (!delivered) { out.skipped.push({ id: org.id, reason: "delivery_failed" }); continue; }
    // Stamped only after a delivered send, so a Resend outage retries next tick
    // instead of silently eating the one warning she gets.
    if (send) await run("UPDATE orgs SET trial_reminder_sent_at=NOW() WHERE id=?", [org.id]);
    out.sent.push({ id: org.id, to, trialEndsAt: org.trial_ends_at, amount: plan.monthlyUsd });
  }
  return out;
}

// 999999999 used for "unlimited" — Infinity serializes to null in JSON
// trial gets Team limits: limits only engage once trial converts to paid.
// Core/Team bands (BUILD-24) are INFORMATIONAL for launch — the numbers shown
// on the pricing page — but NOT hard-enforced (see SOFT_BAND_PLANS below).
// When bands are eventually enforced they must count ACTIVE donors (gave within
// ~3 years), not every record, or the pricing page's claim becomes false.
const PLAN_LIMITS = {
  core:     { seats: 3,         records: 5000,      extraSeatPrice: null },
  team:     { seats: 10,        records: 25000,     extraSeatPrice: null },
  founding: { seats: 3,         records: 5000,      extraSeatPrice: null },
  seed:     { seats: 1,         records: 1000,      extraSeatPrice: null },
  growth:   { seats: 5,         records: 10000,     extraSeatPrice: 25   },
  impact:   { seats: 999999999, records: 999999999, extraSeatPrice: null },
  trial:    { seats: 10,        records: 25000,     extraSeatPrice: null },
  portal:   { seats: 3,         records: 25000,     extraSeatPrice: null }, // BUILD-46 network tier (soft)
};

// Core/Team/founding bands are kept SOFT for launch — informational only, never
// a hard 403. Legacy seed/growth/impact keep their existing hard enforcement so
// no pre-cutover org's behavior changes.
const SOFT_BAND_PLANS = new Set(["core", "team", "founding", "portal"]);

// Returns the limits actually in effect for an org, accounting for trial state
function effectivePlanLimits(org) {
  const status = org.subscription_status || "trialing";
  if (status === "trialing") return PLAN_LIMITS.trial; // Team limits during trial
  return PLAN_LIMITS[org.plan] || PLAN_LIMITS.core;
}

async function checkPlanLimit(org, dimension) {
  const limits = effectivePlanLimits(org);
  const limit = limits[dimension];
  let current = 0;
  if (dimension === "seats") {
    const rows = await query("SELECT COUNT(*) AS c FROM users WHERE org_id=? AND deactivated_at IS NULL", [org.id]); // removed users free their seat (BUILD-75 C.3)
    current = Number(rows[0]?.c) || 0;
  } else if (dimension === "records") {
    const rows = await query("SELECT COUNT(*) AS c FROM donors WHERE org_id=? AND deleted_at IS NULL", [org.id]);
    current = Number(rows[0]?.c) || 0;
  }
  const isTrial = (org.subscription_status || "trialing") === "trialing";
  // Soft bands: a paid Core/Team org is never hard-blocked at the band for
  // launch (brief BUILD-24 §5). Still returns current/limit for display.
  if (!isTrial && SOFT_BAND_PLANS.has(org.plan)) return { allowed: true, current, limit, isTrial: false, soft: true };
  return { allowed: current < limit, current, limit, isTrial };
}

// ── Gmail integration ──────────────────────────────────────────────────────

async function syncGmail(userId, orgId) {
  const conns = await query("SELECT * FROM gmail_connections WHERE user_id=? AND status='active'", [userId]);
  if (!conns.length) return;
  const conn = conns[0];

  const oauth2Client = makeOAuth2Client();
  oauth2Client.setCredentials({
    access_token:  conn.access_token,
    refresh_token: conn.refresh_token,
    expiry_date:   conn.token_expiry ? new Date(conn.token_expiry).getTime() : undefined,
  });

  // Persist refreshed tokens automatically
  oauth2Client.on("tokens", async (tokens) => {
    const sets = [];
    const vals = [];
    if (tokens.access_token) { sets.push("access_token=?"); vals.push(tokens.access_token); }
    if (tokens.expiry_date)  { sets.push("token_expiry=?");  vals.push(new Date(tokens.expiry_date).toISOString()); }
    if (sets.length) { vals.push(conn.id); await run(`UPDATE gmail_connections SET ${sets.join(",")} WHERE id=?`, vals); }
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // Get all donor emails for this org
  const donors = await query(
    "SELECT id, email FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
  );
  if (!donors.length) return;

  const donorByEmail = {};
  donors.forEach(d => { donorByEmail[d.email.toLowerCase().trim()] = d; });
  const donorEmails = Object.keys(donorByEmail);

  // Messages whose interaction a staff member deleted — never re-insert
  // (see DELETE /interactions/:id).
  const exclusionRows = await query(
    "SELECT gmail_message_id FROM gmail_sync_exclusions WHERE org_id=?",
    [orgId]
  );
  const excludedMsgIds = new Set(exclusionRows.map(r => r.gmail_message_id));

  // Process in chunks of 20 emails to stay within query length limits
  const CHUNK = 20;
  for (let i = 0; i < donorEmails.length; i += CHUNK) {
    const chunk = donorEmails.slice(i, i + CHUNK);
    const q = chunk.map(e => `from:${e} OR to:${e}`).join(" OR ");

    let pageToken;
    let fetched = 0;
    do {
      let listRes;
      try {
        listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
      } catch (e) {
        // A revoked/expired refresh token surfaces from the token endpoint as
        // invalid_grant with HTTP 400 (message "invalid_grant", not a 401) —
        // catch it alongside a genuine 401 so it stops being retried forever.
        const isInvalidGrant = e.message === "invalid_grant" || e.response?.data?.error === "invalid_grant";
        if (e.code === 401 || e.status === 401 || isInvalidGrant) {
          await run("UPDATE gmail_connections SET status='disconnected' WHERE id=?", [conn.id]);
          if (isInvalidGrant) {
            console.error(`[gmail-sync] Connection ${conn.id} (${conn.email || conn.user_id}) refresh token revoked (invalid_grant) — marked disconnected, will not retry until reconnected.`);
          }
          throw new Error("Gmail token revoked");
        }
        throw e;
      }

      pageToken = listRes.data.nextPageToken;
      const messages = listRes.data.messages || [];
      fetched += messages.length;

      for (const { id: msgId } of messages) {
        // Staff-deleted message — deletion sticks, never resync
        if (excludedMsgIds.has(msgId)) continue;
        // Idempotency: skip if already logged
        const existing = await query(
          "SELECT id FROM interactions WHERE org_id=? AND metadata->>'gmail_message_id'=?",
          [orgId, msgId]
        );
        if (existing.length) continue;

        let msgRes;
        try {
          msgRes = await gmail.users.messages.get({
            userId: "me", id: msgId, format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          });
        } catch { continue; }

        const headers = msgRes.data.payload?.headers || [];
        const hdr = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
        const from    = hdr("From");
        const to      = hdr("To");
        const subject = hdr("Subject") || "(no subject)";
        const dateStr = hdr("Date");
        const snippet = (msgRes.data.snippet || "").slice(0, 500);

        // Parse bare email from "Name <email@example.com>" format
        const parseAddr = (s) => { const m = s.match(/<([^>]+)>/); return (m ? m[1] : s).toLowerCase().trim(); };
        const fromEmail = parseAddr(from);
        const toEmails  = to.split(",").map(parseAddr);

        // Match to donor (from = inbound, to = outbound)
        let matchedDonor = donorByEmail[fromEmail];
        let direction    = "inbound";
        if (!matchedDonor) {
          for (const te of toEmails) {
            if (donorByEmail[te]) { matchedDonor = donorByEmail[te]; direction = "outbound"; break; }
          }
        }
        if (!matchedDonor) continue;

        // Parse message date
        let msgDate = new Date(dateStr);
        if (isNaN(msgDate.getTime())) msgDate = new Date();
        const dateIso = msgDate.toISOString().split("T")[0];

        await run(
          `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_at, metadata)
           VALUES (?, ?, ?, 'email', ?, ?, ?, ?)`,
          [
            `int_${uuid().slice(0, 8)}`,
            orgId,
            matchedDonor.id,
            `Subject: ${subject}\n\n${snippet}`,
            dateIso,
            msgDate.toISOString(),
            JSON.stringify({ gmail_message_id: msgId, from, to, subject, direction }),
          ]
        );
      }

      if (fetched >= 100) break; // Safety cap per chunk
    } while (pageToken);
  }

  await run("UPDATE gmail_connections SET last_synced_at=NOW() WHERE id=?", [conn.id]);
}

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
const EV_READY = import("./shared/eventShape.js").then(m => { EV = m; return m; });
const rbCentsEv = v => Math.round(Number(v) * 100);

async function levelTaken(levelId) {
  const [r] = await query("SELECT COALESCE(SUM(quantity),0)::int AS n FROM event_attendees WHERE level_id=? AND status <> 'cancelled'", [levelId]);
  return r?.n || 0;
}

// The one registration writer. `giftId` is passed when the money already
// exists (the Stripe webhook wrote it); otherwise this writes the gift, or the
// sponsor's pledge, itself. Returns the attendee row.
async function registerForEvent({ orgId, event, level, donorId, qty, paid = true, giftId = null,
                                  paymentMethod = null, date = null, idemKey = null, who }) {
  await EV_READY;
  const split = EV.ticketSplit({ priceCents: rbCentsEv(level.price), fmvCents: rbCentsEv(level.fmv), qty });
  const [donor] = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
  if (!donor) throw Object.assign(new Error("Donor not found"), { status: 404 });
  if (level.capacity != null && !giftId) {
    const taken = await levelTaken(level.id);
    if (taken + split.qty > level.capacity)
      throw Object.assign(new Error(`${level.name} has ${Math.max(0, level.capacity - taken)} places left.`), { status: 409 });
  }
  const day = date || orgToday(await orgTz(orgId));           // ORG_TZ_SEAM_OK
  let pledgeId = null;
  if (!giftId && (paid || level.kind === "ticket")) {
    // A ticket is always money (it cannot be pledged); a sponsorship may be.
    const written = await recordGift({
      orgId, donorId, amount: split.totalCents / 100, date: day, type: "cash",
      campaign: event.name, notes: `${split.qty} × ${level.name}, ${event.name}`,
      paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
      quidProQuoValue: split.fmvCents / 100,
      quidProQuoDesc: EV.quidProQuoDescription({ eventName: event.name, levelName: level.name, qty: split.qty, kind: level.kind }),
      actorId: who.id, actorName: who.name, source: "event",
      ledgerDescription: `${level.name}, ${event.name}`,
      timelineNote: `${level.kind === "sponsor" ? "Sponsored" : "Bought " + (split.qty === 1 ? "a ticket" : split.qty + " tickets")} for ${event.name}`,
    });
    if (written.duplicate) {
      const [g] = await query("SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?", [orgId, idemKey]);
      giftId = g?.id || null;
    } else giftId = written.gift.id;
  } else if (!giftId) {
    // An unpaid sponsorship is a promise: a pledge due on the event day,
    // attributed to nothing but itself. It is NOT money until it arrives.
    pledgeId = "pl_" + uuid().slice(0, 8);
    await run(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,notes,created_by,created_by_name)
               VALUES (?,?,?,?,?,'open',?,?,?)`,
      [pledgeId, orgId, donorId, split.totalCents / 100, String(event.date).slice(0, 10) > day ? String(event.date).slice(0, 10) : day,
       `Sponsorship: ${level.name}, ${event.name}`, who.id, who.name]);
    await run(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES (?,?,?,1,?,?)`,
      ["pi_" + uuid().slice(0, 8), orgId, pledgeId, String(event.date).slice(0, 10) > day ? String(event.date).slice(0, 10) : day, split.totalCents / 100]);
  }
  const recognition = level.kind === "sponsor" ? EV.recognitionLine({ donorName: donor.name, levelName: level.name, recognition: level.recognition }) : null;
  const id = "att_" + uuid().slice(0, 8);
  const rows = await query(
    `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,registration_gift_id,sponsor_pledge_id,recognition,gift_amount)
     VALUES (?,?,?,?,?,?,'registered',?,?,?,?,?,?)
     ON CONFLICT (event_id, donor_id) DO UPDATE SET
       level_id=EXCLUDED.level_id, quantity=event_attendees.quantity + EXCLUDED.quantity,
       registration_gift_id=COALESCE(EXCLUDED.registration_gift_id, event_attendees.registration_gift_id),
       sponsor_pledge_id=COALESCE(EXCLUDED.sponsor_pledge_id, event_attendees.sponsor_pledge_id),
       recognition=COALESCE(EXCLUDED.recognition, event_attendees.recognition),
       status=CASE WHEN event_attendees.status='cancelled' THEN 'registered' ELSE event_attendees.status END
     RETURNING *`,
    [id, event.id, orgId, donorId, donor.name, donor.email || "", level.id, split.qty, giftId, pledgeId, recognition, split.totalCents / 100]);
  return { attendee: rows[0], giftId, pledgeId, split };
}

// ── BUILD-101 — MEMBERSHIPS ───────────────────────────────────────────────
// A membership is one person on one level. Its payment is a GIFT through
// recordGift with the level's fair-market value as the quid-pro-quo, so the
// existing receipt states the deductible split and the ledger posts once:
// membership money and donation money are the same rows, and the split is a
// fact on the gift, never a second total.
let MB = null;
const MB_READY = import("./shared/membership.js").then(m => { MB = m; return m; });
const mbCents = v => Math.round(Number(v) * 100);

// Put a person on a level. The membership row is CLAIMED FIRST, so the
// one-current-membership index — not an if-statement — refuses a second one
// before any money is written; if the gift then fails, the claim is released.
async function enrollMembership({ orgId, donorId, level, startsOn = null, paid = true, paymentMethod = null,
                                  idemKey = null, source = "staff", who, existingGiftId = null }) {
  await MB_READY;
  const [donor] = await query(`SELECT id, name, household_id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!donor) throw Object.assign(new Error("Donor not found"), { status: 404 });
  if (idemKey) {
    const [prior] = await query(`SELECT m.* FROM memberships m JOIN gifts g ON g.id=m.gift_id WHERE m.org_id=? AND g.idempotency_key=?`, [orgId, idemKey]);
    if (prior) return { membership: prior, duplicate: true };
  }
  const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK
  const start = startsOn || today;
  const expires = MB.expiryFor({ term: level.term, startsOn: start });
  const id = "mb_" + uuid().slice(0, 10);
  try {
    await run(`INSERT INTO memberships (id,org_id,donor_id,household_id,level_id,joined_on,starts_on,expires_on,status,payment_method,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
      [id, orgId, donorId, level.scope === "household" ? donor.household_id || null : null, level.id, start, start, expires,
       paid ? paymentMethod : "complimentary", source, who.id, who.name]);
  } catch (e) {
    if (e.code !== "23505") throw e;
    const [cur] = await query(`SELECT m.expires_on, l.name FROM memberships m JOIN membership_levels l ON l.id=m.level_id
                                WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace')`, [orgId, donorId]);
    throw Object.assign(new Error(`${donor.name} already holds a ${cur ? cur.name : "current"} membership${cur && cur.expires_on ? ", through " + cur.expires_on : ""}. Renew it rather than adding a second.`),
      { status: 409, code: "membership_current" });
  }
  let giftId = existingGiftId;
  if (existingGiftId) {
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [existingGiftId, id, orgId]);
  } else if (paid) {
    try {
      const written = await recordGift({
        orgId, donorId, amount: mbCents(level.price) / 100, date: today, type: "cash",
        notes: `${level.name} membership`, paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
        quidProQuoValue: mbCents(level.fmv) / 100, membershipRenewal: false,
        quidProQuoDesc: MB.quidProQuoDescription({ levelName: level.name, benefits: level.benefits || [] }),
        actorId: who.id, actorName: who.name, source: "membership",
        ledgerDescription: `${level.name} membership`,
        timelineNote: `Joined as a ${level.name} member${expires ? ", through " + expires : ""}`,
      });
      giftId = written.duplicate ? (await query(`SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]))[0]?.id || null
                                 : written.gift.id;
    } catch (e) {
      await run(`DELETE FROM memberships WHERE id=? AND org_id=?`, [id, orgId]).catch(() => {});
      throw e;
    }
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [giftId, id, orgId]);
  }
  const [m] = await query(`SELECT * FROM memberships WHERE id=?`, [id]);
  return { membership: m, giftId };
}

// ── BUILD-101 Part 2 — RENEWALS THAT COME AROUND ──────────────────────────
// Expiry drives everything. The org's two numbers (how early the renewal
// thread opens, how long an expired membership sits in grace) are read here,
// once, with their defaults.
async function membershipSettings(orgId) {
  await MB_READY;
  const [o] = await query("SELECT membership_renewal_days, membership_grace_days FROM orgs WHERE id=?", [orgId]);
  const n = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365 ? Number(v) : d);
  return { renewalDays: n(o?.membership_renewal_days, MB.DEFAULT_RENEWAL_DAYS), graceDays: n(o?.membership_grace_days, MB.DEFAULT_GRACE_DAYS) };
}

// THE ONE PLACE A MEMBERSHIP IS RENEWED. The old row becomes 'renewed' and a
// new term begins the day after the OLD expiry while it is still current or in
// grace — so paying early never costs a member time — or today once it has
// lapsed. Serialised per person, because two doors can take the same cheque.
// `attachGift` is either an existing gift (a payment recordGift recognised as
// this renewal) or null, in which case this writes the payment itself.
async function renewMembership({ orgId, membershipId, levelId = null, paymentMethod = null, idemKey = null,
                                 existingGiftId = null, who, source = "staff" }) {
  await MB_READY;
  const [old] = await query(`SELECT * FROM memberships WHERE id=? AND org_id=?`, [membershipId, orgId]);
  if (!old) throw Object.assign(new Error("Not found"), { status: 404 });
  const [level] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [levelId || old.level_id, orgId]);
  if (!level) throw Object.assign(new Error("Level not found"), { status: 404 });
  if (level.active === false) throw Object.assign(new Error(`${level.name} is retired. Choose a current level.`), { status: 400 });
  if (level.term === "lifetime" && old.status !== "lapsed")
    throw Object.assign(new Error("A lifetime membership does not renew."), { status: 400 });
  if (idemKey) {
    const [prior] = await query(`SELECT m.* FROM memberships m JOIN gifts g ON g.id=m.gift_id WHERE m.org_id=? AND g.idempotency_key=?`, [orgId, idemKey]);
    if (prior) return { membership: prior, duplicate: true };
  }
  return withAdvisoryLock(`membership:${orgId}:${old.donor_id}`, async () => {
    const [cur] = await query(`SELECT status, expires_on FROM memberships WHERE id=? AND org_id=?`, [old.id, orgId]);
    if (cur.status === "renewed" || cur.status === "cancelled")
      throw Object.assign(new Error(`This membership was already ${cur.status}.`), { status: 409, code: "membership_" + cur.status });
    const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
    const continuing = cur.status === "active" || cur.status === "grace";
    const start = MB.renewalStart({ oldExpires: cur.expires_on, today, lapsed: !continuing });
    const expires = MB.expiryFor({ term: level.term, startsOn: start });
    const id = "mb_" + uuid().slice(0, 10);
    if (continuing) await run(`UPDATE memberships SET status='renewed', status_changed_on=?, updated_at=NOW() WHERE id=? AND org_id=?`, [today, old.id, orgId]);
    try {
      await run(`INSERT INTO memberships (id,org_id,donor_id,household_id,level_id,joined_on,starts_on,expires_on,status,payment_method,source,renewed_from,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?,?)`,
        [id, orgId, old.donor_id, old.household_id, level.id, continuing ? old.joined_on : start, start, expires,
         paymentMethod, source, old.id, who.id, who.name]);
    } catch (e) {
      if (continuing) await run(`UPDATE memberships SET status=?, updated_at=NOW() WHERE id=? AND org_id=?`, [cur.status, old.id, orgId]);
      if (e.code === "23505") throw Object.assign(new Error("This person already holds a current membership. Renew that one."), { status: 409, code: "membership_current" });
      throw e;
    }
    const undo = async () => {
      await run(`DELETE FROM memberships WHERE id=? AND org_id=?`, [id, orgId]).catch(() => {});
      if (continuing) await run(`UPDATE memberships SET status=?, updated_at=NOW() WHERE id=? AND org_id=?`, [cur.status, old.id, orgId]).catch(() => {});
    };
    const fmv = mbCents(level.fmv) / 100;
    const qpqDesc = MB.quidProQuoDescription({ levelName: level.name, benefits: level.benefits || [] });
    let giftId = existingGiftId;
    try {
      if (existingGiftId) {
        // A payment that arrived through another door and was recognised as
        // this renewal. It bought the same benefits a renewal buys, so it
        // carries the same split — and says so on the timeline.
        await run(`UPDATE gifts SET quid_pro_quo_value=?, quid_pro_quo_desc=?, deductible_amount=GREATEST(0, amount - ?)
                    WHERE id=? AND org_id=?`, [fmv, qpqDesc, fmv, existingGiftId, orgId]);
      } else {
        const written = await recordGift({
          orgId, donorId: old.donor_id, amount: mbCents(level.price) / 100, date: today, type: "cash",
          notes: `${level.name} membership renewal`, paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
          quidProQuoValue: fmv, quidProQuoDesc: qpqDesc, membershipRenewal: false,
          actorId: who.id, actorName: who.name, source: "membership",
          ledgerDescription: `${level.name} membership renewal`,
          timelineNote: `Renewed the ${level.name} membership${expires ? ", through " + expires : ""}`,
        });
        giftId = written.duplicate ? (await query(`SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]))[0]?.id || null
                                   : written.gift.id;
      }
    } catch (e) { await undo(); throw e; }
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [giftId, id, orgId]);
    // The renewal thread closes as an OUTCOME, on the payment's own timeline
    // line — the honest close (threads_close_honest), because the thing the
    // thread asked for happened.
    if (old.renewal_thread_id && giftId) {
      const [line] = await query(`SELECT id FROM interactions WHERE org_id=? AND gift_id=? ORDER BY created_at LIMIT 1`, [orgId, giftId]);
      if (line) await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
                            WHERE id=? AND org_id=? AND closed_at IS NULL`, [line.id, old.renewal_thread_id, orgId]);
    }
    const [m] = await query(`SELECT * FROM memberships WHERE id=?`, [id]);
    return { membership: m, giftId, startsOn: start, expiresOn: expires,
             sentence: continuing ? `The new term starts the day after the old one ends (${start}), so renewing early cost no time.`
                                  : `The membership had lapsed, so the new term starts today.` };
  });
}

// Called from recordGift, the door every payment passes through: a gift of
// EXACTLY a level's price from a person whose membership at that level is due
// (inside the renewal window, or in grace) IS that renewal. Within a few
// dollars is deliberately NOT matched — the pledge-instalment rule: a near
// miss is a question, and a background path has nobody to ask.
async function applyGiftAsMembershipRenewal({ orgId, donorId, giftId, amount, actorId, actorName }) {
  await MB_READY;
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) return null;
  const { renewalDays } = await membershipSettings(orgId);
  const today = orgToday(await orgTz(orgId));                   // ORG_TZ_SEAM_OK
  const [m] = await query(
    `SELECT m.id FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
      WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace') AND m.expires_on IS NOT NULL
        AND l.active IS NOT FALSE AND round(l.price::numeric * 100)::bigint = ?
        AND (m.status='grace' OR m.expires_on <= ?)
      LIMIT 1`, [orgId, donorId, cents, MB.addDaysCivil(today, renewalDays)]);
  if (!m) return null;
  return renewMembership({ orgId, membershipId: m.id, existingGiftId: giftId, source: "payment",
                           who: { id: actorId || SYS_AUTO.id, name: actorName || SYS_AUTO.name } });
}

// The sweep. Two jobs, both idempotent by construction:
//   1. write down each membership's status from its dates (active → grace →
//      lapsed); the status is DERIVED, this only records it;
//   2. open ONE renewal thread per membership whose expiry is inside the
//      window, with the note already drafted in the org's voice. Recorded
//      against that expiry (`renewal_thread_for`), so a second sweep over the
//      same date opens nothing; `threads_one_open` means a person with a thread
//      already open is left alone and tried again next time. It sends nothing.
async function processMembershipRenewals(opts = {}) {
  await MB_READY;
  const out = { orgs: 0, toGrace: 0, toLapsed: 0, opened: 0, skipped: 0, rows: [] };
  const orgs = opts.orgId
    ? await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE id=?", [opts.orgId])
    : await query(`SELECT DISTINCT o.id, o.name, o.timezone, o.voice_samples FROM orgs o JOIN memberships m ON m.org_id=o.id
                    WHERE o.onboarding_complete=1 AND m.status IN ('active','grace')`, []);
  const draftMod = await import("./shared/draftNote.js");
  for (const org of orgs) {
    out.orgs++;
    const today = opts.today || orgToday(org);                    // ORG_TZ_SEAM_OK
    const { renewalDays, graceDays } = await membershipSettings(org.id);
    const g = await query(`UPDATE memberships SET status='grace', status_changed_on=?, updated_at=NOW()
                            WHERE org_id=? AND status='active' AND expires_on IS NOT NULL AND expires_on < ? RETURNING id`, [today, org.id, today]);
    const l = await query(`UPDATE memberships SET status='lapsed', status_changed_on=?, updated_at=NOW()
                            WHERE org_id=? AND status='grace' AND expires_on < ? RETURNING id`, [today, org.id, MB.addDaysCivil(today, -graceDays)]);
    out.toGrace += g.length; out.toLapsed += l.length;
    const due = await query(
      `SELECT m.id, m.donor_id, m.expires_on, l.name AS level_name, l.price, d.name AS donor_name, d.kind,
              d.assigned_to, d.assigned_to_name
         FROM memberships m
         JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
         JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
        WHERE m.org_id=? AND m.status='active' AND m.expires_on BETWEEN ? AND ?
          AND m.renewal_thread_for IS DISTINCT FROM m.expires_on
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
          AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND d.do_not_solicit IS NOT TRUE
        ORDER BY m.expires_on`, [org.id, today, MB.addDaysCivil(today, renewalDays)]);
    const samples = Array.isArray(org.voice_samples) ? org.voice_samples
      : (typeof org.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
    const voice = draftMod.voiceFrom(samples);
    const displayName = await donorFacingOrgName(org.id, org.name).catch(() => org.name);
    for (const m of due) {
      const isPerson = !m.kind || m.kind === "person";
      const draft = draftMod.membershipRenewalDraft({ donorName: m.donor_name, levelName: m.level_name,
        expiresOnLong: MB.civilLong(m.expires_on), priceCents: mbCents(m.price), orgName: displayName, voice });
      const thread = await withTransaction(client => openThreadTx(client, {
        orgId: org.id, donorId: m.donor_id,
        step: { type: draftMod.MEMBERSHIP_RENEWAL_STEP.type,
                label: MB.renewalLabel({ donorName: m.donor_name, levelName: m.level_name, expiresOn: m.expires_on, isPerson }),
                due: today },
        openedOn: today, ownerId: m.assigned_to || null, ownerName: m.assigned_to_name || null,
        actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
      }));
      if (!thread) { out.skipped++; continue; }
      await run("UPDATE threads SET draft_note=? WHERE id=?", [draft.body, thread.id]);
      await run("UPDATE memberships SET renewal_thread_id=?, renewal_thread_for=?, updated_at=NOW() WHERE id=? AND org_id=?",
        [thread.id, m.expires_on, m.id, org.id]);
      out.opened++;
      out.rows.push({ orgId: org.id, membershipId: m.id, donorId: m.donor_id, threadId: thread.id, expiresOn: m.expires_on });
    }
  }
  return out;
}

// §5 — the theme a donor's browser receives. Colors are normalized to WCAG-
// legible values at SAVE time (normalizeAccent, the one contrast impl shared
// with org branding); this re-checks at render and falls back to the designed
// neutral default rather than ever shipping an unreadable portal.
const PORTAL_DEFAULT_THEME = { primary: "#1a6b4a", primaryFg: "#ffffff", accent: "#c9a84c", accentFg: "#0f1a12" };

// BUILD-48 theme-depth ENUMS. Type pairing keys resolve to font stacks in
// client/src/lib/portalTheme.js (fixed client code — the org supplies only a
// validated KEY, never a font string/URL, so theming is not a CSS/font
// injection surface; parity with the client map is pinned by
// tests/theme-depth.test.js). Card style is the same shape: one enum.
const PORTAL_TYPE_PAIRINGS = ["dm", "classic", "editorial", "literary", "modern"];
const PORTAL_CARD_STYLES = ["rounded", "square", "soft-shadow"];

// The theme fragment shared by the portal config payload and the donor
// dashboard's per-org cards (BUILD-48 takeover). Colors are normalized at
// SAVE time; this re-checks at render and falls back to the designed default
// rather than ever shipping an unreadable surface. `row` carries the raw
// portal_settings column names (background_tint, button_color, …).
function portalCardTheme(row) {
  const prim = row.primary_color ? normalizeAccent(row.primary_color) : null;
  const acc = row.accent_color ? normalizeAccent(row.accent_color) : null;
  const btn = row.button_color ? normalizeAccent(row.button_color) : null;
  const tint = row.background_tint ? normalizeTint(row.background_tint) : null;
  return {
    primary: prim ? prim.accent : PORTAL_DEFAULT_THEME.primary,
    primaryFg: prim ? prim.fg : PORTAL_DEFAULT_THEME.primaryFg,
    accent: acc ? acc.accent : PORTAL_DEFAULT_THEME.accent,
    accentFg: acc ? acc.fg : PORTAL_DEFAULT_THEME.accentFg,
    // Button/link color falls back to primary — the pre-BUILD-48 button color,
    // so existing portals render byte-identically until an org sets one.
    buttonColor: btn ? btn.accent : (prim ? prim.accent : PORTAL_DEFAULT_THEME.primary),
    buttonFg: btn ? btn.fg : (prim ? prim.fg : PORTAL_DEFAULT_THEME.primaryFg),
    backgroundTint: tint ? tint.tint : null,
    typePairing: PORTAL_TYPE_PAIRINGS.includes(row.type_pairing) ? row.type_pairing : "dm",
    cardStyle: PORTAL_CARD_STYLES.includes(row.card_style) ? row.card_style : "rounded",
  };
}

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
const GIVE_MONTHLY_DEFAULT = [10, 25, 50, 100, 250];
function parseAmountLadder(raw, fallback) {
  if (raw == null) return fallback.slice();
  let arr = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return fallback.slice(); } }
  if (!Array.isArray(arr)) return fallback.slice();
  const clean = arr.map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 1 && n <= 1000000);
  return (clean.length >= 3 && clean.length <= 6) ? clean : fallback.slice();
}

// A normalized crop rectangle {x,y,w,h} (each 0..1) or null. Non-destructive:
// it only ever describes which part of the original asset a slot shows. Shared
// by giveThemePayload + portalThemePayload so the give page and the portal read
// the exact same crop.
function parseCrop(raw) {
  if (raw == null) return null;
  let c = raw;
  if (typeof raw === "string") { try { c = JSON.parse(raw); } catch { return null; } }
  if (!c || typeof c !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const x = n(c.x), y = n(c.y), w = n(c.w), h = n(c.h);
  if ([x, y, w, h].some(v => v == null)) return null;
  if (w <= 0 || h <= 0 || w > 1 || h > 1 || x < 0 || y < 0 || x + w > 1.005 || y + h > 1.005) return null;
  return { x, y, w, h };
}

function giveThemePayload(org) {
  const clean = (v, cap) => (typeof v === "string" ? v.slice(0, cap) : null);
  const clamp01 = (n, d) => Math.min(1, Math.max(0, Number(n ?? d) || d));
  return {
    displayName: clean(org.display_name, 120) || displayNameCase(org.name),
    logo: org.give_logo || null,
    headerImage: org.give_header_image || null,
    headerFocal: { x: clamp01(org.header_focal_x, 0.5), y: clamp01(org.header_focal_y, 0.5) },
    headerCrop: parseCrop(org.header_crop),
    // colors/type/card — the shared portal theme resolver (normalized at save,
    // re-checked here, designed-neutral fallback when unset).
    ...portalCardTheme(org),
    footerText: clean(org.give_footer, 500),
    contactEmail: clean(org.give_contact, 200),
    einLine: clean(org.give_ein, 200),
    // "Powered by Steward" is OFF by default (white-label). A flag so it can be
    // turned on network-wide later without a rebuild — see BUILD-60 decision.
    poweredBy: org.powered_by === true,
    onetimeAmounts: parseAmountLadder(org.onetime_amounts, GIVE_ONETIME_DEFAULT),
    monthlyAmounts: parseAmountLadder(org.monthly_amounts, GIVE_MONTHLY_DEFAULT),
  };
}

// The theme columns every public /give endpoint selects from portal_settings.
// Aliased to the names portalCardTheme + giveThemePayload read.
const GIVE_THEME_COLS = `ps.display_name,
  COALESCE(ps.logo_url, ps.logo_data) AS give_logo,
  COALESCE(ps.header_image_url, ps.header_image_data) AS give_header_image,
  ps.header_focal_x, ps.header_focal_y, ps.header_crop,
  ps.primary_color, ps.accent_color, ps.button_color, ps.background_tint,
  ps.type_pairing, ps.card_style,
  ps.footer_text AS give_footer, ps.contact_email AS give_contact, ps.ein_line AS give_ein,
  ps.powered_by, ps.onetime_amounts, ps.monthly_amounts`;

// ── Rate limits (P-3/S-5) ──────────────────────────────────────────────────
// The x-test-* headers are honored ONLY under DISABLE_RATE_LIMIT=1 (the local
// scratch stack): they let the scripted-burst suite exercise the REAL limiter
// while every other suite stays unthrottled. Production ignores them entirely.
const portalLimiterSkip = (req) => rateLimitDisabled() && !req.headers["x-test-enforce-limits"];
const portalLimiterIpKey = (req) =>
  (rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : ipKeyGenerator(req.ip);
const portalLinkIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-ip:" + portalLimiterIpKey(req),
});
const portalLinkEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-em:" + String(req.body?.email || "").toLowerCase().trim().slice(0, 200),
});
const portalMutationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "pmut:" + portalLimiterIpKey(req),
});

// CRM timeline event for every portal action that matters (low-priority
// signal — recorded, never alerted, per §6.3).
async function portalTimeline(orgId, donorId, note, portalEvent) {
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name,metadata)
     VALUES (?,?,?,?,?,?,?,?)`,
    ["int_" + uuid().slice(0, 8), orgId, donorId, "note", note,
     new Date().toISOString().slice(0, 10), "Donor portal", JSON.stringify({ portal_event: portalEvent })]
  ).catch(e => console.error("[portal] timeline:", e.message));
}

const PORTAL_IMG_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

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
function imageBytesMatchMime(contentType, buffer) {
  const check = IMAGE_MAGIC[contentType];
  if (!check) return false;                 // an unlisted mime never gets in
  try { return !!check(buffer); } catch { return false; }
}

function checkThemeImageDimensions(kind, contentType, buffer) {
  if (!imageBytesMatchMime(contentType, buffer)) {
    return { ok: false, message: "That file doesn't parse as an image — try re-exporting it as PNG or JPEG." };
  }
  if (contentType === "image/svg+xml") return { ok: true, width: null, height: null };
  let d;
  try { d = imageSize(buffer); } catch { d = null; }
  if (!d || !d.width || !d.height) {
    return { ok: false, message: "That file doesn't parse as an image — try re-exporting it as PNG or JPEG." };
  }
  if (kind === "header") {
    if (d.height >= d.width) {
      return { ok: false, message: "Header images render as a wide banner — this image is as tall as it is wide and would crop badly. Use a landscape image (at least 1200×300 works well)." };
    }
    if (d.width < 600) {
      return { ok: false, message: "Header images need to be at least 600px wide to look sharp as a banner." };
    }
  }
  // BUILD-65: we resize down on ingest, so a large photo is fine — only reject
  // genuinely absurd dimensions (a decompression-bomb guard, not a size limit).
  if (d.width > 12000 || d.height > 12000) {
    return { ok: false, message: "That image is unusually large. Please use a photo under about 12,000 pixels on a side." };
  }
  return { ok: true, width: d.width, height: d.height };
}

function validPortalImage(dataUri, capBytes) {
  if (dataUri == null || dataUri === "") return true;
  if (typeof dataUri !== "string" || dataUri.length > capBytes) return false;
  const m = dataUri.match(/^data:([^;]+);base64,/);
  return !!m && PORTAL_IMG_MIMES.includes(m[1]);
}

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
const MAX_UPLOAD_STR = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 1024; // its base64 length + slack
// The largest each slot actually renders at. We cap the LONG edge here so the
// stored master is never bigger than the biggest place it's shown; the ?w=
// route still serves smaller responsive variants on demand (each cached once).
const UPLOAD_LONG_EDGE = { header: 2560, campaign: 2560, widget: 2560, impact: 2000, logo: 1200 };

// Returns an actionable message if this data URI can't be accepted, else null.
// (Call sites already handle ""/null as "clear" before reaching here.)
function uploadImageError(dataUri) {
  if (typeof dataUri !== "string") return "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, WebP, or SVG image.";
  const m = dataUri.match(/^data:([^;]+);base64,/);
  if (!m || !PORTAL_IMG_MIMES.includes(m[1])) return "That file isn't an image we can use. Please upload a PNG, JPEG, GIF, WebP, or SVG image.";
  if (dataUri.length > MAX_UPLOAD_STR) return "That image is unusually large. Please use a photo under 15 MB — a normal photo from a phone or camera is well within that.";
  return null;
}

// Resize + compress a validated raster on ingest. SVG (vector) and GIF
// (possibly animated → sharp would flatten it) pass through untouched; a raster
// over the slot's long-edge cap is scaled DOWN (never up — upscaling is the
// grain complaint) and re-encoded (WebP for photos; PNG for a logo, to keep
// crisp edges + transparency). Returns { buffer, contentType, width, height }
// or { error, message } if the bytes won't process as an image.
async function normalizeUploadImage(kind, contentType, buffer) {
  if (contentType === "image/svg+xml" || contentType === "image/gif") {
    return { buffer, contentType, width: null, height: null };
  }
  const cap = UPLOAD_LONG_EDGE[kind] || 2560;
  try {
    const sharp = require("sharp");
    let pipe = sharp(buffer, { failOn: "none" }).rotate() // honor EXIF orientation
      .resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true });
    pipe = (kind === "logo") ? pipe.png({ compressionLevel: 9 }) : pipe.webp({ quality: 82 });
    const out = await pipe.toBuffer({ resolveWithObject: true });
    return {
      buffer: out.data,
      contentType: kind === "logo" ? "image/png" : "image/webp",
      width: out.info.width, height: out.info.height,
    };
  } catch (e) {
    // sharp couldn't process these bytes. checkThemeImageDimensions already
    // parsed the header (via image-size) and the mime already validated, so
    // rather than block the upload we store the original untouched — the pre-
    // BUILD-65 behavior. A genuine photo always decodes; this path is for the
    // odd header-only/edge-case buffer, not a resize failure on a real image.
    console.error("[upload] normalize skipped (storing original):", e.message);
    return { buffer, contentType, width: null, height: null };
  }
}

// ── BUILD-56 Part 1 — pointer history ───────────────────────────────────────
// Retained bytes are useless if nothing records which hash WAS the banner.
// Every mutation of a row that points at a content-addressed asset appends a
// history row: entity, from → to, when, actor. No-op when nothing changed.
// Rows are tiny and kept INDEFINITELY — they are the index into recovery.
async function recordAssetPointerHistory(orgId, entity, entityId, fromVal, toVal, actor) {
  const f = fromVal === undefined ? null : fromVal;
  const t = toVal === undefined ? null : toVal;
  if (JSON.stringify(f) === JSON.stringify(t)) return;
  await run(
    `INSERT INTO asset_pointer_history (id, org_id, entity, entity_id, from_value, to_value, actor_user_id, actor_email)
     VALUES (?,?,?,?,?,?,?,?)`,
    ["aph_" + uuid().slice(0, 8), orgId, entity, entityId, JSON.stringify(f), JSON.stringify(t),
     actor?.userId || null, actor?.email || null]);
}

// ── BUILD-54 §2 — donor-facing campaign content helpers ────────────────────
// The campaign STORY is sanitized structured text — a validated block array,
// never HTML/CSS/JS and never paste-in embed code. Unknown block types,
// oversized content, or non-string leaves reject the whole payload (400), so
// nothing unvalidated can ever reach a donor's browser. React renders the
// strings as text nodes (escaped by construction).
const STORY_BLOCK_TYPES = ["p", "h2", "ul"];
function validateStoryBlocks(raw) {
  if (raw == null) return { blocks: null };                 // field not being set
  if (raw === "" || (Array.isArray(raw) && raw.length === 0)) return { blocks: [] }; // explicit clear
  if (!Array.isArray(raw) || raw.length > 40) return { error: "bad_story" };
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== "object" || !STORY_BLOCK_TYPES.includes(b.type)) return { error: "bad_story" };
    if (b.type === "ul") {
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) return { error: "bad_story" };
      const items = b.items.map(i => typeof i === "string" ? i.trim().slice(0, 500) : null);
      if (items.some(i => i == null || i === "")) return { error: "bad_story" };
      out.push({ type: "ul", items });
    } else {
      if (typeof b.text !== "string" || !b.text.trim()) return { error: "bad_story" };
      out.push({ type: b.type, text: b.text.trim().slice(0, b.type === "h2" ? 200 : 2000) });
    }
  }
  return { blocks: out };
}

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
const widgetMod = () => import("./shared/pageWidgets.js");

// BUILD-95 §5B — the per-widget resolution, shared by the portal page and
// every giving page. ONE pipeline: a widget that resolves differently on two
// surfaces is a widget that eventually shows different numbers on them.
async function resolveWidgetsPublic(org, widgets) {
  // BUILD-54 §1 discipline: the per-widget resolution queries are independent
  // reads — resolve them in PARALLEL (this is the donor's first paint; a
  // sequential loop re-created the exact round-trip stacking §1 removed).
  const out = await Promise.all(widgets.map(async (w) => {
    const r = { ...w };
    if (w.type === "funds" && w.fundIds?.length) {
      // BUILD-55 — cards render in the WIDGET's fundIds order (the org's manual
      // sort; the first fund leads), not whatever order the DB returns.
      const rows = await query(
        `SELECT id, name, restricted, description FROM fin_funds WHERE org_id = ? AND id = ANY(?)`,
        [org.id, w.fundIds]);
      const byId = new Map(rows.map(f => [f.id, f]));
      r.funds = w.fundIds.map(id => byId.get(id)).filter(Boolean)
        .map(f => ({ id: f.id, name: f.name, description: f.description || null }));
    }
    if (w.type === "campaign") {
      const [c] = await query(
        `SELECT id, COALESCE(donor_facing_name, name) AS name, donor_description, donor_story, hero_image_url, hero_crop, hero_focal_x, hero_focal_y,
                goal_progress_public, goal_amount,
                CASE WHEN goal_progress_public THEN
                  COALESCE((SELECT SUM(g2.amount - COALESCE(g2.cover_fee_amount,0)) FROM gifts g2
                            WHERE g2.org_id = campaigns.org_id AND (g2.campaign_id = campaigns.id OR g2.campaign = campaigns.name)), 0)
                + COALESCE((SELECT SUM(gr.amount) FROM grants gr
                            WHERE gr.org_id = campaigns.org_id AND gr.campaign_id = campaigns.id AND gr.awarded_at IS NOT NULL), 0)
                END AS raised
         FROM campaigns WHERE id = ? AND org_id = ?`, [w.campaignId, org.id]);
      r.campaign = c ? {
        id: c.id, name: c.name, description: c.donor_description || null,
        story: Array.isArray(c.donor_story) ? c.donor_story : null,
        heroImage: c.hero_image_url || null,
        heroCrop: parseCrop(c.hero_crop),
        heroFocal: { x: Math.min(1, Math.max(0, Number(c.hero_focal_x ?? 0.5) || 0.5)), y: Math.min(1, Math.max(0, Number(c.hero_focal_y ?? 0.5) || 0.5)) },
        goal: c.goal_progress_public === true ? {
          amount: parseFloat(c.goal_amount) || 0, raised: parseFloat(c.raised) || 0,
          percent: (parseFloat(c.goal_amount) || 0) > 0
            ? Math.min(100, Math.round(((parseFloat(c.raised) || 0) / parseFloat(c.goal_amount)) * 100)) : null,
        } : null,
      } : null;
    }
    if (w.type === "impact") {
      // Public view: ORG-WIDE published updates only (targeted updates need
      // gift attribution, which needs a session — the signed-in client
      // substitutes its matched /me feed).
      r.updates = (await query(
        `SELECT id, title, body, photos, photo_crops, created_at FROM impact_updates
         WHERE org_id = ? AND status = 'published' AND org_wide = true
         ORDER BY created_at DESC LIMIT 6`, [org.id]))
        .map(u => ({ id: u.id, title: u.title, body: u.body, photos: Array.isArray(u.photos) ? u.photos : [], photoCrops: Array.isArray(u.photo_crops) ? u.photo_crops : [], date: u.created_at }));
    }
    return r;
  }));
  return out;
}

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
const NETWORK_SIGNUP_ENABLED = process.env.NETWORK_SIGNUP_ENABLED === "1";
// A disabled surface is INVISIBLE, not "403 coming soon" — same body as the
// global 404 so the routes' existence leaks nothing pre-launch.
const requireFlag = (on) => (req, res, next) => on ? next() : res.status(404).json({ error: "Not found" });
const foldEmail = (e) => String(e || "").trim().toLowerCase();

async function donorAudit(accountId, email, action, req, meta) {
  await run(
    `INSERT INTO donor_account_audit (id,account_id,email,action,ip,meta) VALUES (?,?,?,?,?,?)`,
    ["daa_" + uuid().slice(0, 10), accountId || null, email || null, action,
     (req && req.ip) || null, meta ? JSON.stringify(meta) : null]
  ).catch(e => console.error("[account] audit:", e.message));
}

// ── §1.1 rate limits (same x-test seam discipline as the portal limiters) ──
const accountIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-ip:" + portalLimiterIpKey(req),
});
const accountEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "acct-em:" + foldEmail(req.body?.email).slice(0, 200),
});

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

const directorySearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "dir:" + ((rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : (req.donorAccount?.id || portalLimiterIpKey(req))),
});
const addOrgLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "diradd:" + ((rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : (req.donorAccount?.id || portalLimiterIpKey(req))),
});
async function einLookup(ein) {
  const rows = await query(`SELECT ein, name, status FROM ein_registry WHERE ein = ?`, [ein]);
  if (!rows.length) return { found: false };
  return { found: true, name: rows[0].name, status: rows[0].status };
}
const networkSignupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "netsignup:" + portalLimiterIpKey(req),
});

// BUILD-58 (W-1) — "Stripe onboarding complete" is a fact we ask STRIPE for,
// never our own flag: /stripe/connect sets stripe_connected=true at LINK
// creation, before any onboarding happens, so trusting it let a reviewer
// approve an org whose Express onboarding was never finished (its Give page
// would take gifts Stripe refuses). `definitive` distinguishes a real answer
// from an unreachable Stripe: the approval gate refuses either way (verify or
// don't approve), the auto-delist sweep acts only on a definitive false.
async function stripeChargesEnabled(accountId) {
  if (!accountId) return { ok: false, definitive: true, reason: "no_account" };
  if (!stripe) return { ok: false, definitive: false, reason: "stripe_not_configured" };
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    return { ok: acct.charges_enabled === true, definitive: true, reason: acct.charges_enabled === true ? null : "charges_disabled" };
  } catch (e) {
    return { ok: false, definitive: false, reason: "stripe_unreachable" };
  }
}

// ── §3.2(5) auto-delist sweep — EIN dropped/revoked or Stripe gone ─────────
// Portal stays up for existing donors; the listing and NEW gifts stop; the
// admin is alerted through the queued path. Registry-empty guard: an unloaded
// registry delists nobody (no data ≠ everyone revoked).
async function processNetworkGate() {
  const approved = await query(
    `SELECT na.id, na.org_id, na.ein, na.decisions, o.name, o.stripe_account_id, o.stripe_connected
     FROM network_applications na JOIN orgs o ON o.id = na.org_id WHERE na.status = 'approved'`);
  if (!approved.length) return { checked: 0, delisted: 0 };
  const [{ c: registryCount }] = await query(`SELECT COUNT(*)::int c FROM ein_registry`);
  let delisted = 0;
  for (const a of approved) {
    let reason = null;
    if (Number(registryCount) > 0) {
      const found = await einLookup(a.ein);
      if (!found.found || found.status !== "ok") reason = `EIN ${a.ein} ${found.found ? "status: " + found.status : "no longer on the IRS list"}`;
    }
    if (!reason) {
      // W-1: the sweep asks Stripe, not our link-creation flag. Fail-safe:
      // an UNREACHABLE Stripe delists nobody (an outage ≠ every org revoked)
      // — only a definitive charges_enabled=false (or no account) delists.
      if (!a.stripe_account_id) reason = "Stripe account disconnected/restricted";
      else {
        const chk = await stripeChargesEnabled(a.stripe_account_id);
        if (chk.definitive && !chk.ok) reason = "Stripe account disconnected/restricted (charges disabled)";
      }
    }
    if (!reason) continue;
    const decisions = (typeof a.decisions === "string" ? JSON.parse(a.decisions || "[]") : (a.decisions || []));
    decisions.push({ at: new Date().toISOString(), by: "system", action: "delisted", reason });
    await run(`UPDATE network_applications SET status = 'delisted', decisions = ?, updated_at = NOW() WHERE id = ?`, [JSON.stringify(decisions), a.id]);
    await run(`UPDATE portal_settings SET network_listed = false, updated_at = NOW() WHERE org_id = ?`, [a.org_id]);
    delisted++;
    await sendDonorLifecycleEmail("admin_delist", process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev",
      `Network delisting — ${a.name}`,
      consumerEmailHtml(`<p><strong>${escHtmlWf(a.name)}</strong> (org ${escHtmlWf(a.org_id)}) was auto-delisted from donor dashboards.</p><p>Reason: ${escHtmlWf(reason)}.</p><p>Its portal stays up for existing donors; new gifts are blocked until re-approval.</p>`));
  }
  return { checked: approved.length, delisted };
}

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
const INBOUND_EMAIL_DOMAIN = (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase();
async function inboundMod() { return import("./shared/inboundEmail.js"); }

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ───────────────────────────────────────────────────
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`Steward backend running on port ${PORT}`);
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
// BUILD-77 Part 1f — THE ASK GATE, one predicate for every surface with an
// action button. deceased blocks everything; do_not_contact blocks all
// outreach; do_not_solicit blocks ASKS (drift, re-engage, at-risk,
// suggested outreach, ask-automations) while stewardship thank-yous and
// transactional mail may continue. One excluded donor reaching one
// actionable surface is a bug (tests/import-messy.test.js §4).
const solicitableSql = (a = "d") => `${a}.deceased IS NOT TRUE AND ${a}.do_not_contact IS NOT TRUE AND ${a}.do_not_solicit IS NOT TRUE`;

// Per-donor breakdown behind the stewardship_debt headline number — every
// donor's exact contribution to the aggregate, sorted by who's driving it
// most. computeStewardshipDebt() below just sums this same list, so the
// headline number and the drill-down list (GET /dashboard/stewardship-debt/
// breakdown) can never drift into two different computations. Pass
// `userId` to scope to just that user's assigned donors (same assigned_to
// pattern as GET /dashboard/today) — omit for the org-wide figure.
async function computeStewardshipDebtBreakdown(orgId, { userId } = {}) {
  // One LEFT JOIN + GROUP BY instead of a correlated MAX() subquery per donor —
  // at 25k donors × 150k interactions the subquery plan was 25k sequential
  // scans (~6 min per call, measured; see LOADTEST_REPORT.md). MAX over zero
  // joined rows is NULL, so the COALESCE fallback to first_gift_date is
  // byte-identical to the old subquery's behavior. GROUP BY d.id is enough —
  // the other selected columns are functionally dependent on the PK.
  const rows = await query(
    `SELECT d.id, d.name, d.total_giving, d.first_gift_date,
       COALESCE(MAX(i.date), d.first_gift_date) AS last_contact
     FROM donors d
     LEFT JOIN interactions i ON i.donor_id = d.id AND i.type IN ${MEANINGFUL_CONTACT_TYPES}
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.total_giving > 0 ${userId ? "AND d.assigned_to = ?" : ""}
     GROUP BY d.id`,
    userId ? [orgId, userId] : [orgId]
  );
  const today = Date.now();
  const breakdown = [];
  for (const d of rows) {
    if (!d.last_contact) continue; // no gift and no contact — nothing to weight yet
    const daysSinceContact = Math.max(0, Math.min(1000, Math.floor((today - new Date(d.last_contact).getTime()) / 86400000)));
    const totalGiving = Number(d.total_giving) || 0;
    const significance = totalGiving / 1000;
    const contribution = (daysSinceContact / 30) * significance;
    breakdown.push({ donorId: d.id, donorName: d.name, totalGiving, daysSinceContact, contribution });
  }
  breakdown.sort((a, b) => b.contribution - a.contribution);
  return breakdown;
}

async function computeStewardshipDebt(orgId, opts = {}) {
  const breakdown = await computeStewardshipDebtBreakdown(orgId, opts);
  return Math.round(breakdown.reduce((sum, d) => sum + d.contribution, 0));
}

async function computeFirstTouchDelay(orgId) {
  // Same correlated-subquery → LEFT JOIN + GROUP BY rewrite as
  // computeStewardshipDebtBreakdown above (same reason, same measurement —
  // see LOADTEST_REPORT.md). MIN over zero joined rows is NULL, matching the
  // old subquery's "no first touch yet" result exactly.
  const rows = await query(
    `SELECT d.id, d.name, d.first_gift_date, MIN(i.date) AS first_touch_date
     FROM donors d
     LEFT JOIN interactions i ON i.donor_id = d.id
       AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date >= d.first_gift_date
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.first_gift_date IS NOT NULL
     GROUP BY d.id`,
    [orgId]
  );
  let totalDays = 0, touched = 0, untouched = 0;
  // The specific donors this average is actually about — newest first-gift
  // first, since a brand-new donor still waiting on a human touch is more
  // actionable than one who's been waiting for months (that's a lost cause,
  // not a "get to them today" item).
  const untouchedDonors = [];
  for (const d of rows) {
    if (!d.first_touch_date) {
      untouched++;
      untouchedDonors.push({ donorId: d.id, donorName: d.name, firstGiftDate: d.first_gift_date });
      continue;
    }
    const days = Math.max(0, Math.floor((new Date(d.first_touch_date) - new Date(d.first_gift_date)) / 86400000));
    totalDays += days;
    touched++;
  }
  untouchedDonors.sort((a, b) => new Date(b.firstGiftDate) - new Date(a.firstGiftDate));
  return {
    avgDays: touched > 0 ? Math.round(totalDays / touched) : null,
    sampleSize: touched,
    untouchedCount: untouched,
    newestUntouched: untouchedDonors.slice(0, 3),
  };
}

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
for (const k of Object.keys(RETENTION_FLOOR)) {
  const env = process.env["RETENTION_" + k];
  if (env !== undefined && env !== "" && Number.isFinite(Number(env))) RETENTION_FLOOR[k] = Number(env);
}

// Cohort year-over-year donor retention: what % of last year's donors gave
// again this year. This is a real, correct metric fundraisers already
// benchmark against — unlike stewardship_debt's invented composite score.
// Originally computed inline only inside GET /annual-fund; extracted here so
// /annual-fund and the Home dashboard's retention metric call the exact same
// code, not two copies that can drift. Deliberately preserves /annual-fund's
// exact original logic (fetch all gifts, bucket by calendar year via JS
// `Date.getFullYear()`) rather than rewriting as a SQL date-range query —
// a rewrite risks a subtle timezone-parsing mismatch that would make the two
// callers disagree. Pass `gifts` when the caller already has the org's full
// gift list (e.g. /annual-fund) to avoid fetching it twice. Pass `userId` to
// scope retention to just that user's assigned donors (same assigned_to
// pattern as GET /dashboard/today) — /annual-fund never passes this, so its
// behavior is unchanged.
async function computeRetentionRate(orgId, { year = null, gifts, userId } = {}) {
  // ORG_TZ_SEAM_OK (BUILD-75 A.4) — the default "this year" is the ORG's civil
  // year, not the process clock's. From 19:00 EST every Dec 31 the UTC default
  // bucketed by a year that hadn't started locally: retention against a
  // nearly-empty new year, snapshotted into metric_snapshots as a cliff.
  if (year == null) year = orgTime.parseCivil(orgToday(await orgTz(orgId))).y;
  const prevYear = year - 1;
  // Only donor_id + date are read below — SELECT * was shipping every column
  // of 200k+ rows (~70MB heap churn per call at load-test scale). The JS
  // year-bucketing itself deliberately stays (see comment above).
  let allGifts = gifts || await query("SELECT donor_id, date FROM gifts WHERE org_id = ?", [orgId]);
  if (userId) {
    const assignedRows = await query("SELECT id FROM donors WHERE org_id = ? AND assigned_to = ? AND deleted_at IS NULL", [orgId, userId]);
    const assignedIds = new Set(assignedRows.map(r => r.id));
    allGifts = allGifts.filter(g => assignedIds.has(g.donor_id));
  }
  // ORG_TZ_SEAM_OK (BUILD-75 A.6) — year-bucket by the stored CIVIL date's own
  // Y, never a new Date() round-trip: `new Date("2026-01-01")` read back through
  // a non-UTC process zone lands on Dec 31 and buckets every New Year's Day
  // gift into the prior year. parseCivil is zone-independent and byte-identical
  // to the old behavior on the UTC production runtime.
  const civilYear = g => { const c = orgTime.parseCivil(g.date); return c ? c.y : null; };
  const thisYearGifts = allGifts.filter(g => civilYear(g) === year);
  const prevYearGifts = allGifts.filter(g => civilYear(g) === prevYear);
  const thisYearDonorIds = new Set(thisYearGifts.map(g => g.donor_id));
  const prevYearDonorIds = new Set(prevYearGifts.map(g => g.donor_id));
  const retained = [...thisYearDonorIds].filter(id => prevYearDonorIds.has(id)).length;
  const retentionRate = prevYearDonorIds.size > 0 ? Math.round(retained / prevYearDonorIds.size * 100) : null;
  // BUILD-76 follow-up — the confidence floor (see RETENTION_FLOOR): a rate
  // computed over too few prior-year donors, or too little history, is a
  // thin-data artifact and every consumer must know it. Civil-string compare
  // is safe for YYYY-MM-DD; span measured to the org's own today.
  const firstGiftDate = allGifts.reduce((min, g) => {
    const d = g.date ? String(g.date).slice(0, 10) : null;
    return d && (!min || d < min) ? d : min;
  }, null);
  const historyDays = firstGiftDate
    ? (orgTime.daysBetween(firstGiftDate, orgToday(await orgTz(orgId))) ?? 0)
    : 0;
  const thinData = prevYearDonorIds.size < RETENTION_FLOOR.MIN_PRIOR_YEAR_DONORS
    || historyDays < RETENTION_FLOOR.MIN_HISTORY_DAYS;
  return {
    retentionRate, retained,
    thisYearDonorIds, prevYearDonorIds,
    thisYearCount: thisYearDonorIds.size, prevYearCount: prevYearDonorIds.size,
    year, prevYear,
    thinData, historyDays,
    floor: { minPriorYearDonors: RETENTION_FLOOR.MIN_PRIOR_YEAR_DONORS, minHistoryDays: RETENTION_FLOOR.MIN_HISTORY_DAYS },
  };
}

async function snapshotMetricsForOrg(orgId) {
  const today = new Date().toISOString().slice(0, 10);
  const debt = await computeStewardshipDebt(orgId);
  const { avgDays } = await computeFirstTouchDelay(orgId);
  await run(
    `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
     ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
    ["ms_" + uuid().slice(0, 8), orgId, "stewardship_debt", debt, today]
  );
  if (avgDays != null) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, "first_touch_delay", avgDays, today]
    );
  }
  const { rate: recoveryRate } = await computeRecoveryRate(orgId);
  if (recoveryRate != null) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, "recovery_rate", recoveryRate, today]
    );
  }
  // ── BUILD-85 — DOES THE FOLLOW-UP ENGINE RUN? ──────────────────────────
  // The Thread's central claim is that closing one conversation opens the
  // next. Nothing counted it, so the claim was untestable. These three do:
  // how much is open, how fast it clears, and — the one that matters — the
  // rate at which a close becomes the next commitment. A rising open count
  // with a falling continuation rate is a list being cleared, not a set of
  // relationships being kept, and only the trend can tell those apart.
  try {
    const th = await computeThreadHealth(orgId, { days: 30 });
    const put = async (key, val) => run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, key, val, today]);
    await put("threads_open", th.open);
    if (th.medianDaysToClose != null) await put("thread_days_to_close", th.medianDaysToClose);
    // THIN DATA IS NEVER SNAPSHOTTED (the BUILD-76 retention rule): a rate
    // over four closes is an artifact that would outlive the thinness that
    // made it and sit in the trend line forever.
    if (th.continuationRate != null) await put("thread_continuation_rate", th.continuationRate);
  } catch (e) { console.error("[metrics] thread health:", e.message); }

  const { retentionRate, thinData: retentionThin } = await computeRetentionRate(orgId);
  // BUILD-76 follow-up: a thin-data rate is never snapshotted — a 100%-on-16-
  // donors artifact in the trend line would outlive the thin data that made it.
  if (retentionRate != null && !retentionThin) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, "retention_rate", retentionRate, today]
    );
  }
  // BUILD-76 Part 4 — log_capture_rate: of the drift items marked done in the
  // trailing 30 days, what share carried a line. This is the funnel metric
  // that tells BUILD-77 whether the logging-as-a-byproduct loop actually
  // works on the pilot — skips are RECORDED (metadata.skipped), so an honest
  // denominator exists. Only snapshotted once anyone has used the loop.
  const capture = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE metadata->>'skipped' = 'false')::int AS with_note
       FROM interactions
      WHERE org_id = ? AND metadata->>'via' = 'drift_done'
        AND created_at > NOW() - INTERVAL '30 days'`, [orgId]);
  if ((capture[0]?.total || 0) > 0) {
    const rate = Math.round((capture[0].with_note / capture[0].total) * 100);
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, "log_capture_rate", rate, today]
    );
  }
  return debt;
}

// ── FIX-1 split: register the moved routes (every binding exists by now) ──
require("./routes/webhooks").mount({
  BILLING_PLAN_VALUES, DUNNING_SCHEDULE_DAYS, EV_READY, GC_READY, INBOUND_EMAIL_DOMAIN,
  INBOUND_EMAIL_ENABLED, MB_READY, Sentry, SvixWebhook, UNSUB_SECRET, bcrypt, billingCustomerColumn,
  billingStripe, bumpFormEvent, checkGiftExtras, closePlan, computeTrialEnd, crypto,
  displayNameCase, donorByNameOrCreate, donorFacingOrgName, donorFromAddress, donorMailDecision,
  donorSendOpts, enrollMembership, ensureOrgLedger, express, fireWorkflows, firstChargeSentence,
  inboundMod, inviteeDisplayName, issueGiftReceipt, linkEmailToAccounts, logRecoveryEvent,
  logRecurringChange, mbCents, money, openGiftThread, openSustainerLapseThread, orgToday, orgTz,
  orgTzName, planFromSubscription, portalTimeline, provisionNewOrgWorkflows, publicAppUrl, query,
  recalcDonorSummary, recalcPledgePayment, recordAutoMove, recordGift, registerForEvent,
  renewMembership, requireAdmin, requireAuth, requireFlag, resend, run, runTx, stripe, toCents,
  unsubscribeEmailFooterHtml, uuid, withAdvisoryLock, withTransaction, wrap, writeGiftExtras,
});
require("./routes/billing").mount({
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
  validateOrgClose, wrap,
});
require("./routes/finance").mount({
  actor, checkWriteAccess, finPeriodBounds, grantBalanceFrom, grantMoneyRows, money, orgOwns,
  orgTime, orgToday, orgTz, orgUnrestrictedFundId, parseMoneyOrThrow, query, requireAdmin,
  requireAuth, restrictedMod, run, stripe, toDollars, uuid, wrap, writeAuditLog,
});
require("./routes/volunteer").mount({
  SYS_AUTO, VH_READY, actor, checkWriteAccess, crypto, donateLimiter, donorFacingOrgName,
  escapeHtml, express, insertShift, orgToday, orgTz, query, requireAuth, run, uuid,
  volunteerSummary, wrap, markVolunteer, publicAppUrl,
});
require("./routes/agent").mount({
  AGENT_MODEL, ALL_PIPELINE_STAGES, Anthropic, SEQ_READY, WORKFLOW_RECIPE_MAP, actor, agentGate,
  aiGate, asJson, autoEnroll, checkWriteAccess, donorOnly, enrollInSequences, ensureWorkflows,
  fireWorkflows, orgOwns, orgTime, orgToday, orgTz, processSequences, processTrackedSequences,
  processWorkflowSweeps, query, requireAdmin, requireAuth, requirePlan, run, runTx,
  sequenceMergeValues, sequenceTimezoneGate, thresholdsMod, uuid, withTransaction, wrap,
});
require("./routes/give").mount({
  ASSET_ID_RE, CARD_CHECK_BUDGET, DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, GIVE_MONTHLY_DEFAULT,
  GIVE_ONETIME_DEFAULT, GIVE_THEME_COLS, NETWORK_SIGNUP_ENABLED, PORTAL_CARD_STYLES,
  PORTAL_TYPE_PAIRINGS, RECOVERY_SECRET, accountEmailLimiter, accountIpLimiter, actor,
  addOrgLimiter, bcrypt, brandEmailHeaderHtml, buildCardUpdateUrl, bumpFormEvent,
  checkThemeImageDimensions, checkWriteAccess, classifySourceError, computeRecoveryRate,
  consumerEmailHtml, crypto, directorySearchLimiter, displayNameCase, donateLimiter, donorAudit,
  donorFacingOrgName, donorFromAddress, donorMailDecision, donorSendOpts, einLookup,
  ensureOrgLedger, escHtmlWf, escapeHtml, express, foldEmail, formConfigMod, fromWithDisplayName,
  fundraiserManageLimiter, getThemeAsset, giveThemePayload, invitationLimiter, linkAccountEmail,
  logRecoveryEvent, logRecurringChange, networkSignupLimiter, normalizeAccent, normalizeTint,
  normalizeUploadImage, notifyExpiringCards, notifyUserOnce, orgOwns, orgSendingIdentity, orgTime,
  orgToday, orgTz, parseCrop, portalCardTheme, portalLinkEmailLimiter, portalLinkIpLimiter,
  portalMutationLimiter, portalTimeline, processDunning, processGivingSources, pruneThemeAssets,
  pruneUnreferencedAssets, publicAppUrl, purgeExpiredAssets, putThemeAsset, query,
  recordAssetPointerHistory, recordGift, refreshCardsOnFile, requireAdmin, requireAuth, requireFlag,
  resend, resolveWidgetsPublic, run, sendDonorLifecycleEmail, sendDunningEmail, signToken,
  slugifyGivingPage, sourceAdapters, sourceConfig, sourceErrorSentence, stripe,
  stripeChargesEnabled, sustainerFileFacts, sweepMissedRecurring, syncSource, testMode, toCents,
  toDollars, uploadImageError, uuid, validateStoryBlocks, widgetMod, withAdvisoryLock, wrap,
});
require("./routes/crm").mount({
  ACK_READY, ACTIVITY_DEFINITIONS, AGENT_MODEL, ALL_PIPELINE_STAGES, API_KEY_PREFIX, ASSET_ID_RE,
  Anthropic, CAL_READY, EV_READY, GC_READY, GEOCODE_TICK_BUDGET, GIVE_THEME_COLS,
  IMPORT_DONOR_BATCH, IMPORT_GIFT_BATCH, INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_ENABLED, LAPSE_DAYS,
  MB_READY, MEANINGFUL_CONTACT_TYPES, MILESTONE_THRESHOLDS, PHOTO_FETCH_BUDGET, PT_READY, RB_READY,
  SYS_AUTO, TOTP, VH_READY, _titleCaseWord, _tzCache, actor, agentGate, aiGate,
  allocateReceiptNumber, apiLimiter, applyReceiptTokens, asJson, autoLapseOrg,
  bookkeeperRefusalMessage, bookkeeperRefusals, brandEmailHeaderHtml, bulkSendAddressGate,
  checkGiftExtras, checkPlanLimit, checkThemeImageDimensions, checkWriteAccess,
  composeActivityReport, composeOfficerMonthly, composeWeekInReview, computeAtRiskCandidates,
  computeDriftForDonors, computeFirstTouchDelay, computeRetentionRate, computeStewardshipDebt,
  computeStewardshipDebtBreakdown, computeThreadHealth, crypto, displayNameCase, donateLimiter,
  donorByNameOrCreate, donorFacingOrgName, donorFromAddress, donorMailDecision, donorOnly,
  donorSendOpts, driftEngine, enrollInSequences, enrollMembership, ensureOrgLedger, escapeHtml,
  filterBySegment, finPeriodBounds, fireWorkflows, formConfigMod, geocode, getOrgAccessState,
  getThemeAsset, giveThemePayload, givingAccountEntry, givingSourcesMod, google, grantBalanceFrom,
  grantDocs, grantMoneyRows, grantMsMod, hashApiKey, imageBytesMatchMime, inboundMod, insertShift,
  inviteeDisplayName, issueGiftReceipt, levelTaken, loadCfDefs, lookupMatchingGift,
  makeOAuth2Client, mbCents, membershipSettings, mergeCustomValues, mfaVerifyForUser, money,
  monthBounds, normalizeAccent, normalizeUploadImage, notifyTaskAssignment, openGiftThread,
  openThreadTx, orgDaysOverdue, orgFiscalYearStart, orgLeadDays, orgOwns, orgPeriodBounds,
  orgPlanTier, orgSendingIdentity, orgTime, orgToday, orgTz, orgTzName, parseCrop,
  parseMoneyOrThrow, personPhoto, pledgeDisplayStatus, processGeocodeQueue, processGrantMilestones,
  processMembershipRenewals, processPhotoQueue, processPledgeInstallmentReminders,
  processPledgeReminders, pruneUnreferencedAssets, publicAppUrl, putThemeAsset, query, queryTx,
  raiseGrantMilestone, rateLimitDisabled, rbCents, rbCentsEv, rbCustomDefs, rbFormatCell,
  recalcDonorSummary, recalcPledgePayment, recordAssetPointerHistory, recordAutoMove, recordGift,
  recordMove, registerForEvent, renderReceiptPdf, renewMembership, reportCurrentYear,
  reportYearBounds, requireAdmin, requireAuth, requirePlan, resend, resolveCampaignRecipients,
  resolveOrgBrandTheme, resolvePdfLogo, resolveWidgetsPublic, restrictedMod, round2, run,
  runBuilderDef, runCampaignSend, runDailyTaskRemindersForOrg, runDigestsForOrg,
  runSavedReportScheduleForOrg, runStepRemindersForOrg, runThreadNudgesForOrg, runTx, sampleDataMod,
  seedOrgData, sendPledgeReminderEmail, sendReceiptEmail, signToken, slugifyGivingPage,
  snapshotMetricsForOrg, solicitableSql, sustainerFileFacts, syncGmail, testMode, threadNudgeDayOk,
  threadRankMod, threadShapeMod, thresholdsMod, toCents, toDollars, unsubscribeEmailFooterHtml,
  uploadImageError, uuid, validateCustomFields, validateStoryBlocks, volunteerSummary, weekBounds,
  widgetMod, withAdvisoryLock, withTransaction, wrap, writeAuditLog, writeGiftExtras,
});
require("./routes/jobs").mount({
  RECONCILE_INTERVAL_MIN, autoEnroll, autoLapseOrg, backgroundTicksDisabled, bulkSendAddressGate,
  checkWebhookSubscriptions, getOrgAccessState, monthBounds, notifyExpiringCards, orgTime,
  processDunning, processGeocodeQueue, processGivingSources, processGrantMilestones,
  processMembershipRenewals, processNetworkGate, processPhotoQueue,
  processPledgeInstallmentReminders, processPledgeReminders, processSequences,
  processTrackedSequences, processTrialReminders, processWorkflowSweeps, query, rateLimitDisabled,
  reconcileStripeVsGifts, recordTick, refreshCardsOnFile, refreshReconcileDenominator,
  resolveCampaignRecipients, retryFailedNotifications, run, runCampaignSend,
  runDailyTaskRemindersForOrg, runDigestsForOrg, runSavedReportScheduleForOrg,
  runStepRemindersForOrg, runThreadNudgesForOrg, snapshotMetricsForOrg, syncGmail, threadNudgeDayOk,
  weekBounds,
});
require("./routes/email").mount({
  DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, PORTAL_DEFAULT_THEME, UNSUB_SECRET, buildCardUpdateUrl,
  crypto, displayNameCase, donorAudit, donorFacingOrgName, donorSendOpts, escHtmlWf, escapeHtml,
  foldEmail, givingAccountEntry, isBlockedAddress, orgMailGateCache, orgSendingIdentity,
  publicAppUrl, query, resend, resolveOrgBrandTheme, uuid,
});

module.exports = app;
