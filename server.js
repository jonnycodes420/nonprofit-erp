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
const resend = new Resend(process.env.RESEND_API_KEY);
const { getDb, query, run, uuid, seedOrgData, withTransaction, withAdvisoryLock, queryTx, runTx } = require("./db");
const { signToken, requireAuth, requireSuperAdmin: requireSuperAdminJwt } = require("./auth");
const { sessionCache } = require("./sessionCache");
// BUILD-38 Part 1 — kill all of a user's live sessions: stamp sessions_valid_after
// (auth.js rejects any token issued before it) and evict this instance's cache
// entry so revocation is immediate locally (other instances expire within TTL).
// Call on password reset/change, role change, removal, and deactivation. A future
// role-change/removal/deactivation route MUST call this.
async function invalidateUserSessions(userId) {
  await run("UPDATE users SET sessions_valid_after = NOW() WHERE id = ?", [userId]);
  sessionCache.evict(userId);
}
const { normalizeAccent } = require("./branding");
const { lookupMatchingGift } = require("./matchingGifts");
const Stripe = require("stripe");
const { google } = require("googleapis");
const { Webhook: SvixWebhook } = require("svix");
const { donationStripeKey, billingStripeKey, billingStripeMode, billingConfigError, otherBillingMode } = require("./stripeKeys");
const { CANONICAL_APP_URL, resolvePublicAppUrl, publicAppUrl } = require("./publicUrl");
const { computeTrialEnd } = require("./trialEnd");

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
const billingStripe = billingStripeKey() ? new Stripe(billingStripeKey()) : null;

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

// Load-test hook only: DISABLE_RATE_LIMIT=1 turns limiters off so a local
// benchmark measures route cost, not limiter 429s (see LOADTEST_REPORT.md).
// Never set in production — Railway env does not define it.
const rateLimitDisabled = () => process.env.DISABLE_RATE_LIMIT === "1";

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
      let campaignId = pi.metadata?.campaign_id || null;
      let givingPageId = pi.metadata?.giving_page_id || null;
      const peerFundraiserId = pi.metadata?.peer_fundraiser_id || null;
      const donorName = pi.metadata?.donor_name || "";
      // Donor-covers-fees (attribution FIX): the charged total IS the gift
      // (receipt/ledger/donor totals record it), but the cover portion is
      // remembered so campaign/page goal progress can count what the donor
      // intended for the mission (amount − cover_fee_amount). Server-derived
      // at /donate; here we just read back our own metadata.
      let coverFeeAmount = 0;
      if (pi.metadata?.cover_fees === "true" && pi.metadata?.base_amount_cents) {
        const base = parseInt(pi.metadata.base_amount_cents, 10);
        if (Number.isFinite(base) && base > 0 && amount > base / 100) coverFeeAmount = amount - base / 100;
      }

      if (email && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.length) {
          const orgId = orgRow[0].id;
          // BUILD-23 — idempotency guard. Stripe redelivers/retries webhook events
          // (on any non-2xx, timeout, or at-least-once redelivery), and this
          // handler previously inserted a fresh gift on every call — so a single
          // online donation could be recorded 2+ times (doubling the gift row,
          // the fin_transactions stamp, and donor total_giving/gift_count). The
          // payment_intent id is Stripe's natural per-charge key: if a gift for
          // this pi.id already exists in the org, this is a redelivery — no-op
          // (still 200 so Stripe stops retrying). Mirrors the
          // recoveryEventAlreadyProcessed(event.id) guard used elsewhere here.
          // BUILD-27 Part C (scenario 2): resolve-or-create the donor under a
          // per-(org,email) advisory lock so two PARALLEL webhooks for the SAME new
          // donor email can't both SELECT-nothing and both INSERT a donor (which
          // would split the gift/total across two rows). The lock serializes only
          // same-email concurrent creates; everything else stays parallel.
          let donorRow = await withAdvisoryLock(`donor:${orgId}:${(email || "").toLowerCase()}`, async () => {
            let dr = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
            if (!dr.length && donorName) {
              const newDonorId = "d_" + uuid().slice(0, 8);
              await run(
                `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count)
                 VALUES ($1,$2,$3,$4,'active','steward',0,0)`,
                [newDonorId, orgId, donorName, email.toLowerCase()]
              );
              dr = [{ id: newDonorId }];
            }
            return dr;
          });
          if (donorRow.length) {
            const donorId = donorRow[0].id;
            const giftId = "g_" + uuid().slice(0, 8);
            const today = new Date().toISOString().slice(0, 10);
            // Recurring RENEWAL attribution (attribution FIX): an invoice-generated
            // PI carries none of the checkout metadata, so a renewal charge through
            // a giving page used to land unattributed after the first month. The
            // subscription's own recurring_subscriptions row remembers its
            // page/campaign (stamped at checkout.session.completed). Resolve the
            // exact subscription via the PI's invoice when Stripe is reachable;
            // otherwise fall back to the donor's single attributed subscription —
            // ambiguity (2+ subs with different attributions) attributes nothing
            // rather than guessing (same never-mis-assign discipline as imports).
            if (!campaignId && !givingPageId && pi.invoice) {
              try {
                let rsRow = null;
                try {
                  const invObj = await stripe.invoices.retrieve(pi.invoice, { stripeAccount: accountId });
                  if (invObj?.subscription) {
                    const rows = await query(
                      "SELECT campaign_id, giving_page_id, cover_fee_amount FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2",
                      [invObj.subscription, orgId]
                    );
                    rsRow = rows[0] || null;
                  }
                } catch { /* unreachable Stripe (local/test) — donor-level fallback below */ }
                if (!rsRow) {
                  const rows = await query(
                    `SELECT campaign_id, giving_page_id, cover_fee_amount FROM recurring_subscriptions
                      WHERE org_id=$1 AND donor_id=$2 AND status <> 'canceled'
                        AND (campaign_id IS NOT NULL OR giving_page_id IS NOT NULL)`,
                    [orgId, donorId]
                  );
                  const distinct = new Set(rows.map(r => `${r.campaign_id || ""}|${r.giving_page_id || ""}`));
                  if (distinct.size === 1) rsRow = rows[0];
                }
                if (rsRow) {
                  campaignId = rsRow.campaign_id || null;
                  givingPageId = rsRow.giving_page_id || null;
                  const rsCover = parseFloat(rsRow.cover_fee_amount) || 0;
                  if (!coverFeeAmount && rsCover > 0 && rsCover < amount) coverFeeAmount = rsCover;
                }
              } catch (e) { console.error("[stripe] renewal attribution lookup failed:", e.message); }
            }
            // Check if donor was lapsed before updating stage
            const donorPreRow = await query("SELECT stage, gift_count FROM donors WHERE id=$1", [donorId]);
            const wasLapsed = donorPreRow[0]?.stage === 'lapsed';
            const wasFirstGift = (donorPreRow[0]?.gift_count || 0) === 0;
            // BUILD-27 Part C (scenario 2): RESERVE the gift by its Stripe pi.id
            // atomically. Under a PARALLEL webhook redelivery, exactly one INSERT
            // wins the uq_gifts_stripe_pi unique; the loser's RETURNING is empty and
            // it does ZERO money side-effects (no donor total bump, no ledger row).
            // Replaces the old check-then-insert dedup that raced. Still 200 so
            // Stripe stops retrying.
            const reservedGift = pi.id
              ? await query(
                  `INSERT INTO gifts (id, org_id, donor_id, amount, date, notes, stripe_payment_id, campaign_id, giving_page_id, peer_fundraiser_id, cover_fee_amount)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT (org_id, stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING
                   RETURNING id`,
                  [giftId, orgId, donorId, amount, today, "Online payment via Stripe", pi.id, campaignId, givingPageId, peerFundraiserId, coverFeeAmount]
                )
              : await query(
                  `INSERT INTO gifts (id, org_id, donor_id, amount, date, notes, stripe_payment_id, campaign_id, giving_page_id, peer_fundraiser_id, cover_fee_amount)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
                  [giftId, orgId, donorId, amount, today, "Online payment via Stripe", pi.id, campaignId, givingPageId, peerFundraiserId, coverFeeAmount]
                );
            if (!reservedGift.length) {
              console.log(`[stripe] payment_intent.succeeded ${pi.id} already recorded — skipping duplicate (race-safe)`);
              return res.json({ received: true, duplicate: true });
            }
            await run(
              `UPDATE donors SET
                 total_giving = total_giving + $1,
                 gift_count = gift_count + 1,
                 last_gift_date = GREATEST(COALESCE(last_gift_date,'0001-01-01')::date, $2::date)::text,
                 last_gift_amount = CASE WHEN ($2::date >= COALESCE(last_gift_date,'0001-01-01')::date) THEN $3 ELSE last_gift_amount END,
                 stage = CASE WHEN stage = 'lapsed' THEN 'steward' WHEN stage IN ('prospect','cultivate') THEN 'steward' ELSE stage END
               WHERE id = $4`,
              [amount, today, amount, donorId]
            );
            // Log gift interaction
            await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'gift',$4,$5)",
              ["i_"+uuid().slice(0,8), orgId, donorId, `Online donation: $${amount} via Steward Giving Page`, today]
            ).catch(()=>{});
            // BUILD-22 — auto-unlapse is logged as a move + timeline entry so a
            // lapsed→steward jump on an online gift is transparent, not silent.
            if (wasLapsed) {
              await recordAutoMove(orgId, donorId, "lapsed", "steward", "Auto: re-engaged — new gift").catch(e => console.error("[smart-move] webhook unlapse:", e.message));
            }
            // Re-engagement task for previously lapsed donors
            if (wasLapsed) {
              await run(
                "INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES ($1,$2,$3,'high',0,$4)",
                ["t_"+uuid().slice(0,8), orgId, `Re-engaged via online gift — follow up with ${donorName||email} within 48 hours`,
                 new Date(Date.now()+2*24*60*60*1000).toISOString().slice(0,10)]
              ).catch(()=>{});
            }
            const acctRow = await query("SELECT id FROM accounts WHERE org_id=$1 AND code='4010' LIMIT 1", [orgId]);
            const genFundRow = await query("SELECT id FROM fin_funds WHERE org_id=$1 AND restricted=false ORDER BY created_at ASC LIMIT 1", [orgId]);
            if (acctRow.length) {
              const txnId = "ft_" + uuid().slice(0, 8);
              await run(
                "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING",
                [txnId, orgId, today, "Online gift via Stripe", donorName || email, amount, "income", acctRow[0].id, genFundRow.length ? genFundRow[0].id : null, donorId, "online", giftId]
              );
            }
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at)
               VALUES ($1,$2,$3,$4,$5,NOW())`,
              [taskId, orgId, `Send personal thank-you to ${donorName || email} for $${amount} online gift`, "high", 0]
            );

            // Tax receipt — fire-and-forget, must never fail/500 the
            // webhook itself (Stripe would retry the whole event on a
            // 500; issueGiftReceipt's own idempotency guard already makes
            // a retry safe regardless, so there's nothing gained by
            // blocking the response on this). No-ops cleanly if the org
            // hasn't enabled receipts yet.
            (async () => {
              try {
                const [orgFull] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
                const [donorFull] = await query("SELECT * FROM donors WHERE id=?", [donorId]);
                const [giftFull] = await query("SELECT * FROM gifts WHERE id=?", [giftId]);
                if (orgFull && donorFull && giftFull) await issueGiftReceipt(giftFull, orgFull, donorFull, { send: true });
              } catch (e) { console.error("[receipts] webhook issueGiftReceipt failed:", e.message); }
            })().catch(console.error);

            // BUILD-13 workflows — gift_received (covers new-donor + major-gift
            // recipes). Fire-and-forget; must never 500 the webhook (Stripe
            // retries on 500, and fireWorkflows is idempotent per giftId anyway).
            fireWorkflows(orgId, "gift_received", {
              dedupKey: `gift:${giftId}`, donorId, giftId, amount, isFirstGift: wasFirstGift,
              entityType: "gift", entityId: giftId,
            }).catch(e => console.error("[workflow] gift_received:", e.message));
          }
        }
      }
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription") {
        const email = session.customer_email || session.customer_details?.email;
        const accountId = event.account;
        if (email && accountId) {
          const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
          if (orgRow.length) {
            const orgId = orgRow[0].id;
            const donorName = session.metadata?.donor_name || email;
            let donorRow = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
            let donorId;
            if (donorRow.length) {
              donorId = donorRow[0].id;
            } else {
              donorId = "d_" + uuid().slice(0, 8);
              await run(
                `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count)
                 VALUES ($1,$2,$3,$4,'active','steward',0,0)`,
                [donorId, orgId, donorName, email.toLowerCase()]
              );
            }
            const frequency = session.metadata?.frequency || "monthly";
            await run(
              `UPDATE donors SET stripe_subscription_id=$1, stripe_subscription_status='active', stripe_customer_id=$2,
               stage = CASE WHEN stage IN ('prospect','cultivate','lapsed') THEN 'steward' ELSE stage END
               WHERE id=$3`,
              [session.subscription, session.customer || null, donorId]
            );
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at) VALUES ($1,$2,$3,'high',0,NOW())`,
              [taskId, orgId, `Welcome ${donorName} as a ${frequency} recurring donor — send personal thank-you`]
            );
            // Health record for the failed-payment recovery system — created
            // 'active' up front so every recurring gift has one from day one,
            // not just the ones that eventually fail (see recurring_subscriptions
            // in CLAUDE.md). ON CONFLICT covers a redelivered webhook.
            const recurAmount = session.amount_total != null ? session.amount_total / 100 : null;
            // Attribution FIX — remember the subscription's page/campaign (and
            // any donor-covered-fee portion) so RENEWAL charges attribute too:
            // an invoice-generated PI carries no checkout metadata, so the
            // payment_intent.succeeded handler reads these columns back for
            // every renewal (see the renewal-attribution block above).
            const subCampaignId = session.metadata?.campaign_id || null;
            const subGivingPageId = session.metadata?.giving_page_id || null;
            let subCoverFee = 0;
            if (session.metadata?.cover_fees === "true" && session.metadata?.base_amount_cents && recurAmount != null) {
              const base = parseInt(session.metadata.base_amount_cents, 10);
              if (Number.isFinite(base) && base > 0 && recurAmount > base / 100) subCoverFee = recurAmount - base / 100;
            }
            await run(
              `INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount, interval, status, campaign_id, giving_page_id, cover_fee_amount)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10)
               ON CONFLICT (stripe_subscription_id) DO NOTHING`,
              ["rsub_" + uuid().slice(0, 8), orgId, donorId, session.subscription, session.customer || null, recurAmount, frequency === "annual" ? "year" : "month", subCampaignId, subGivingPageId, subCoverFee]
            );
          }
        }
      }

      // Donor card-update flow completing (mode:"setup" — see GET
      // /recurring/update-card). Chose Checkout setup mode over the Stripe
      // Billing Customer Portal because the Portal requires its own
      // per-connected-account configuration across 100+ orgs; a setup-mode
      // Checkout Session is self-contained, so this branch handles it
      // directly rather than routing through the Portal's own webhook shape.
      if (session.mode === "setup" && session.setup_intent && event.account
          && !(await recoveryEventAlreadyProcessed(event.id))) {
        try {
          const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent, { stripeAccount: event.account });
          const subscriptionId = setupIntent.metadata?.subscription_id;
          const recOrgId = setupIntent.metadata?.org_id;
          const paymentMethodId = setupIntent.payment_method;
          if (subscriptionId && recOrgId && paymentMethodId) {
            // Attach the new card as the subscription's default so future
            // renewals use it, then try to pay the currently open invoice
            // right away — this is what makes "update card" feel instant to
            // the donor instead of waiting for Stripe's next scheduled retry.
            await stripe.subscriptions.update(subscriptionId, { default_payment_method: paymentMethodId }, { stripeAccount: event.account });

            const rsRows = await query("SELECT donor_id FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2", [subscriptionId, recOrgId]);
            await logRecoveryEvent(recOrgId, rsRows[0]?.donor_id || null, subscriptionId, "card_updated", event.id, {});

            try {
              const subObj = await stripe.subscriptions.retrieve(subscriptionId, { stripeAccount: event.account });
              if (subObj.latest_invoice) {
                const invoice = await stripe.invoices.retrieve(subObj.latest_invoice, { stripeAccount: event.account });
                if (invoice.status === "open") {
                  // The resulting invoice.payment_succeeded event (if this
                  // succeeds) flows through the handler below and does the
                  // recovered/thank-you bookkeeping — nothing else to do here.
                  await stripe.invoices.pay(subObj.latest_invoice, {}, { stripeAccount: event.account });
                }
              }
            } catch (e) { console.error("[recovery] invoice pay-now after card update failed:", e.message); }
          }
        } catch (e) { console.error("[recovery] setup-mode checkout.session.completed error:", e.message); }
      }
    }

    // ── Refunds reverse attribution everywhere (attribution FIX) ───────────
    // A refunded online gift must move every surface BACK — campaign raised,
    // roll-up, Home hero, this-week, Reports, Finance. Because every one of
    // those is a live SUM over gift rows (never a stored counter), reversing
    // the gift row reverses them all at once. Idempotent BY CONSTRUCTION: the
    // remaining amount is recomputed from the charge itself (amount −
    // amount_refunded), so a redelivered event converges on the same state,
    // and a fully-reversed gift simply no longer resolves (no-op).
    if (event.type === "charge.refunded") {
      const ch = event.data.object;
      const accountId = event.account;
      const piId = ch.payment_intent;
      if (piId && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.length) {
          const orgId = orgRow[0].id;
          const giftRows = await query("SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [orgId, piId]);
          if (giftRows.length) {
            const g = giftRows[0];
            const remaining = Math.max(0, ((ch.amount || 0) - (ch.amount_refunded || 0)) / 100);
            const refunded = (ch.amount_refunded || 0) / 100;
            const today = new Date().toISOString().slice(0, 10);
            if (remaining <= 0) {
              // FULL refund — the gift's net effect becomes zero everywhere,
              // exactly once. A refund is a fact about the money, so an active
              // receipt is auto-VOIDED (the acknowledgment no longer describes a
              // real gift), never left active; the voided record survives.
              // BUILD-27 concurrency: serialize this refund's gift/ledger mutation
              // + donor recalc under the SAME per-gift lock PUT/DELETE take, so a
              // refund landing while the same gift is being edited can't tear the
              // donor total apart from the ledger stamp (rare — the webhook is
              // idempotent on the Stripe id — but on the same recalc+stamp path).
              await withAdvisoryLock(`gift:${g.id}`, async () => {
              await withTransaction(async (client) => {
                await runTx(client,
                  `UPDATE receipts SET voided_at=NOW(), void_reason='Gift refunded via Stripe', gift_id=NULL
                   WHERE gift_id=$1 AND org_id=$2 AND type='gift' AND voided_at IS NULL`,
                  [g.id, orgId]);
                await runTx(client, "UPDATE receipts SET gift_id=NULL WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
                await runTx(client,
                  `UPDATE pledges SET fulfilled_gift_id=NULL, updated_at=NOW()
                   WHERE fulfilled_gift_id=$1 AND org_id=$2`,
                  [g.id, orgId]);
                await runTx(client, "DELETE FROM fin_transactions WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
                await runTx(client, "DELETE FROM gifts WHERE id=$1 AND org_id=$2", [g.id, orgId]);
              });
              // F-5: recompute the pledge this gift was paying down (reopens
              // only if the remaining payments no longer cover it).
              if (g.pledge_id) await recalcPledgePayment(g.pledge_id, orgId).catch(() => {});
              if (g.donor_id) {
                await recalcDonorSummary(g.donor_id, orgId);
                await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                  ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Refund: $${refunded.toLocaleString()} online gift fully refunded via Stripe — gift reversed`, today]
                ).catch(() => {});
              }
              }); // end withAdvisoryLock(gift:…) — full-refund reversal serialized per gift
              console.log(`[stripe] charge.refunded ${ch.id} — gift ${g.id} fully reversed ($${refunded})`);
            } else if (parseFloat(g.amount) !== remaining) {
              // PARTIAL refund — the gift shrinks to what the org actually kept;
              // its single ledger stamp shrinks with it. The cover-fee portion is
              // capped at the new amount so net attribution never goes negative.
              // An issued receipt is deliberately NOT auto-edited (a receipt is a
              // legal record of what was sent) — the existing receipt_mismatch
              // queue surfaces it for a human, same as a manual gift edit.
              // BUILD-27 concurrency: same per-gift lock as the full-refund branch
              // and PUT/DELETE — serialize the shrink + ledger sync + recalc.
              await withAdvisoryLock(`gift:${g.id}`, async () => {
              await withTransaction(async (client) => {
                await runTx(client,
                  "UPDATE gifts SET amount=$1, cover_fee_amount=LEAST(COALESCE(cover_fee_amount,0), $1) WHERE id=$2 AND org_id=$3",
                  [remaining, g.id, orgId]);
                await runTx(client, "UPDATE fin_transactions SET amount=$1 WHERE gift_id=$2 AND org_id=$3", [remaining, g.id, orgId]);
              });
              // F-5: a shrunk payment may drop a pledge back below fulfilled.
              if (g.pledge_id) await recalcPledgePayment(g.pledge_id, orgId).catch(() => {});
              if (g.donor_id) {
                await recalcDonorSummary(g.donor_id, orgId);
                await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                  ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Refund: $${refunded.toLocaleString()} of an online gift refunded via Stripe — gift adjusted to $${remaining.toLocaleString()}`, today]
                ).catch(() => {});
              }
              }); // end withAdvisoryLock(gift:…) — partial-refund adjust serialized per gift
              console.log(`[stripe] charge.refunded ${ch.id} — gift ${g.id} adjusted to $${remaining}`);
            }
          }
        }
      }
    }

    // ── Recurring gift recovery: failed-payment detection & dunning ────────
    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      if (inv.subscription && !(await recoveryEventAlreadyProcessed(event.id))) {
        let subMeta = null;
        try {
          const subObj = await stripe.subscriptions.retrieve(inv.subscription, { stripeAccount: event.account });
          subMeta = subObj.metadata;
        } catch (e) { console.error("[recovery] could not retrieve subscription for payment_failed:", e.message); }

        const resolved = await resolveOrgAndDonorForSubscription(event.account, inv.subscription, subMeta);
        if (resolved?.donor) {
          const { org, donor } = resolved;
          const amount = inv.amount_due != null ? inv.amount_due / 100 : null;
          const interval = inv.lines?.data?.[0]?.price?.recurring?.interval || null;

          const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [inv.subscription]);
          const isNewCycle = !existingRows.length || !["past_due", "recovering"].includes(existingRows[0].status);

          if (!existingRows.length) {
            await run(
              `INSERT INTO recurring_subscriptions
                 (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount, interval, status, failure_count, first_failed_at, last_failed_at, dunning_step, next_dunning_at)
               VALUES (?,?,?,?,?,?,?,'past_due',1,NOW(),NOW(),0,NOW())`,
              ["rsub_" + uuid().slice(0, 8), org.id, donor.id, inv.subscription, inv.customer || null, amount, interval]
            );
          } else if (isNewCycle) {
            // Previously active/recovered/canceled — this is a genuinely new
            // failure cycle, so restart the dunning cadence from day 0.
            await run(
              `UPDATE recurring_subscriptions SET
                 status='past_due', failure_count = failure_count + 1,
                 first_failed_at = NOW(), last_failed_at = NOW(),
                 recovered_at = NULL, canceled_at = NULL,
                 dunning_step = 0, next_dunning_at = NOW(),
                 amount = COALESCE(?, amount), interval = COALESCE(?, interval),
                 stripe_customer_id = COALESCE(?, stripe_customer_id),
                 updated_at = NOW()
               WHERE stripe_subscription_id=?`,
              [amount, interval, inv.customer || null, inv.subscription]
            );
          } else {
            // Already mid-cycle (past_due/recovering) — this is Stripe's own
            // retry of the same invoice, not a new problem. Track it, but
            // don't reset our independent dunning cadence: next_dunning_at is
            // already scheduled relative to the original first_failed_at.
            await run(
              `UPDATE recurring_subscriptions SET
                 failure_count = failure_count + 1, last_failed_at = NOW(),
                 amount = COALESCE(?, amount), interval = COALESCE(?, interval),
                 stripe_customer_id = COALESCE(?, stripe_customer_id),
                 updated_at = NOW()
               WHERE stripe_subscription_id=?`,
              [amount, interval, inv.customer || null, inv.subscription]
            );
          }
          await run("UPDATE donors SET stripe_subscription_status='past_due' WHERE id=? AND org_id=?", [donor.id, org.id]);
          await logRecoveryEvent(org.id, donor.id, inv.subscription, "payment_failed", event.id, { amount, invoiceId: inv.id });

          // BUILD-13 workflows — recipe #1 (failed_recurring_recovery). Fire
          // only on a genuinely NEW failure cycle (not each Stripe retry),
          // deduped per subscription cycle. If the recipe is ON and sent the
          // recovery email, advance the dunning cadence past its own day-0 so
          // the always-on dunning engine doesn't ALSO send a day-0 email.
          if (isNewCycle) {
            try {
              const [subRow] = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [inv.subscription]);
              const result = await fireWorkflows(org.id, "recurring_failed", {
                dedupKey: `failed:${inv.subscription}:${subRow?.first_failed_at || event.id}`,
                donorId: donor.id, amount, subscriptionRow: subRow,
                entityType: "subscription", entityId: inv.subscription,
              });
              const sentRecovery = result.ran.some(r => r.actions.some(a => a.type === "send_email" && a.template === "recovery"));
              if (sentRecovery && subRow) {
                const next = new Date(new Date(subRow.first_failed_at || Date.now()).getTime() + DUNNING_SCHEDULE_DAYS[1] * 86400000);
                await run("UPDATE recurring_subscriptions SET dunning_step=1, next_dunning_at=? WHERE stripe_subscription_id=?", [next.toISOString(), inv.subscription]);
              }
            } catch (e) { console.error("[workflow] recurring_failed:", e.message); }
          }
        }
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      if (inv.subscription && !(await recoveryEventAlreadyProcessed(event.id))) {
        const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [inv.subscription]);
        // BUILD-45 R-3: a PAUSED schedule that charges again means Stripe's
        // pause_collection auto-resume (resumes_at) fired — flip it active and
        // clear the pause bookkeeping. Not a "recovery" (no failure cycle).
        if (existingRows.length && existingRows[0].status === "paused") {
          const rsP = existingRows[0];
          await run(
            `UPDATE recurring_subscriptions SET status='active', paused_at=NULL, resume_at=NULL, updated_at=NOW() WHERE id=?`,
            [rsP.id]);
          await run("UPDATE donors SET stripe_subscription_status='active' WHERE id=? AND org_id=?", [rsP.donor_id, rsP.org_id]).catch(() => {});
          await portalTimeline(rsP.org_id, rsP.donor_id, "Portal: paused recurring gift auto-resumed on schedule", "recurring_autoresume").catch(() => {});
        }
        if (existingRows.length && ["past_due", "recovering"].includes(existingRows[0].status)) {
          const rs = existingRows[0];
          const orgRows = await query(
            "SELECT id, name, recurring_dunning_enabled FROM orgs WHERE id=?", [rs.org_id]
          );
          const org = orgRows[0];
          const donorRows = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
          const donor = donorRows[0];

          await run(
            `UPDATE recurring_subscriptions SET status='recovered', recovered_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
            [rs.id]
          );
          if (donor) await run("UPDATE donors SET stripe_subscription_status='active' WHERE id=? AND org_id=?", [donor.id, rs.org_id]);
          await logRecoveryEvent(rs.org_id, rs.donor_id, inv.subscription, "payment_recovered", event.id, {
            amount: inv.amount_paid != null ? inv.amount_paid / 100 : null,
          });
          // A recovered renewal is still a real gift — that's recorded by the
          // existing payment_intent.succeeded handler above (fired separately
          // by Stripe for the invoice's underlying charge), not duplicated here.
          if (org && donor?.email && org.recurring_dunning_enabled !== false) {
            await sendRecoveredThankYouEmail(org, donor, rs);
          }
        }
      }
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      if (!(await recoveryEventAlreadyProcessed(event.id))) {
        const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [sub.id]);
        if (existingRows.length) {
          const rs = existingRows[0];
          // Stripe's subscription.status is the source of truth for whether
          // billing itself thinks things are healthy; our own status also
          // tracks the dunning lifecycle (recovering/recovered), which Stripe
          // has no concept of. invoice.payment_succeeded above is the primary
          // path for flipping past_due->recovered (and sends the thank-you
          // email) — this is a safety net for the rare case Stripe's own
          // retry resolves things without that event landing first, so it
          // only updates bookkeeping/logs, never re-sends the thank-you.
          if (sub.status === "active" && ["past_due", "recovering"].includes(rs.status)) {
            await run(
              `UPDATE recurring_subscriptions SET status='recovered', recovered_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
              [rs.id]
            );
            await run("UPDATE donors SET stripe_subscription_status='active' WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
            // Record the recurring gift amount so the recovered-dollars figure
            // (GET /impact) stays complete even when recovery lands via this
            // safety-net path (no invoice, so we use the subscription's own
            // tracked amount — the gift that was actually won back).
            await logRecoveryEvent(rs.org_id, rs.donor_id, sub.id, "payment_recovered", event.id, {
              source: "subscription.updated",
              amount: rs.amount != null ? parseFloat(rs.amount) : null,
            });
          }
          const amount = sub.items?.data?.[0]?.price?.unit_amount != null ? sub.items.data[0].price.unit_amount / 100 : null;
          if (amount != null) {
            await run("UPDATE recurring_subscriptions SET amount=?, updated_at=NOW() WHERE id=?", [amount, rs.id]);
          }
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      if (!(await recoveryEventAlreadyProcessed(event.id))) {
        const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [sub.id]);
        if (existingRows.length) {
          const rs = existingRows[0];
          await run(
            `UPDATE recurring_subscriptions SET status='canceled', canceled_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
            [rs.id]
          );
          await run("UPDATE donors SET stripe_subscription_status='canceled' WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
          await logRecoveryEvent(rs.org_id, rs.donor_id, sub.id, "subscription_canceled", event.id, {});
        } else if (event.account) {
          // No health record ever existed (subscription never failed a
          // payment before being canceled) — still mirror the donor-level
          // status so the UI doesn't show a stale "active" subscription.
          const orgRows = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [event.account]);
          if (orgRows.length) {
            await run("UPDATE donors SET stripe_subscription_status='canceled' WHERE org_id=? AND stripe_subscription_id=?", [orgRows[0].id, sub.id]);
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  res.json({ received: true });
});

// Resend delivery-event webhook (bounce/complaint) — Svix-signed, must receive
// raw body like the Stripe webhook above, so it's also registered BEFORE express.json().
app.post("/resend/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!process.env.RESEND_WEBHOOK_SECRET) return res.status(503).json({ error: "Resend webhook not configured" });

  let event;
  try {
    const wh = new SvixWebhook(process.env.RESEND_WEBHOOK_SECRET);
    event = wh.verify(req.body, {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    });
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    const type = event?.type;
    if (type === "email.bounced" || type === "email.complained") {
      const reason = type === "email.bounced" ? "bounced" : "complained";
      const rawTo = event?.data?.to;
      const recipients = Array.isArray(rawTo) ? rawTo : (rawTo ? [rawTo] : []);
      for (const rawEmail of recipients) {
        const email = String(rawEmail).toLowerCase().trim();
        if (!email) continue;
        // Global: a bounce/complaint is a shared-domain reputation issue, not an
        // org-specific preference, so it suppresses sends from every org.
        await run(
          "INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES (?,?,?,?,?)",
          ["sup_" + uuid().slice(0, 8), null, email, reason, "webhook"]
        );
        // sequence_enrollments only models unsubscribed|bounced (no 'complained'
        // value) — a complaint is functionally "stop sending", so map it to bounced.
        await run(
          `UPDATE sequence_enrollments SET status='bounced', completed_at=NOW()
           WHERE status='active' AND donor_id IN (
             SELECT id FROM donors WHERE email IS NOT NULL AND LOWER(email) = ?
           )`,
          [email]
        );
        console.log(`[resend-webhook] ${type} for ${email} — suppressed globally`);
      }
    }
    // Other event types (delivered, opened, clicked, etc.) are no-ops for now.
    res.json({ received: true });
  } catch (err) {
    console.error("[resend-webhook] handling error:", err.message);
    res.status(500).json({ error: "Internal error processing webhook" });
  }
});

// Billing webhook (platform subscriptions) must also receive raw body — same
// reason as /stripe/webhook above. This route previously lived much further
// down the file, AFTER app.use(express.json(...)), which meant the global
// JSON parser had already consumed the request stream by the time this
// route's own express.raw() ran: stripe.webhooks.constructEvent() received a
// parsed object instead of a Buffer and threw on every real delivery. Moved
// here so it's registered before the global parser, matching /stripe/webhook.
// ── Platform billing webhook (BUILD-24) ────────────────────────────────────
// Steward's OWN subscription (the org pays Steward $149/$299). This is a
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

// Idempotency: reserve the Stripe event id BEFORE mutating anything. Returns
// true if this event was already processed (redelivery/retry) → caller no-ops.
async function billingEventAlreadyProcessed(eventId, type, orgId) {
  if (!eventId) return false;
  const rows = await query(
    "INSERT INTO billing_webhook_events (event_id, type, org_id) VALUES (?,?,?) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
    [eventId, type || null, orgId || null]
  );
  return rows.length === 0; // no row returned = conflict = already processed
}

// Resolve the org this platform event belongs to: prefer metadata.orgId
// (we stamp it on both the checkout session and the subscription), fall back to
// customer-id lookup for invoice events that carry neither.
async function resolveBillingOrgId(obj) {
  if (obj?.metadata?.orgId) return obj.metadata.orgId;
  if (obj?.customer) {
    // The customer id may live in either mode's column (test vs live).
    const rows = await query(
      "SELECT id FROM orgs WHERE stripe_customer_id=? OR stripe_customer_id_test=?",
      [obj.customer, obj.customer]);
    if (rows.length) return rows[0].id;
  }
  return null;
}

app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!billingStripe) return res.status(503).json({ error: "Stripe not configured" });
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = billingStripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  // We only care about a small set of platform-subscription events. Anything
  // else (including any donation event type that somehow lands here) is ignored
  // WITHOUT reserving an idempotency row — belt-and-braces separation from the
  // donation flow.
  const HANDLED = new Set([
    "checkout.session.completed", "invoice.payment_succeeded",
    "invoice.payment_failed", "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (!HANDLED.has(event.type)) return res.json({ received: true, ignored: event.type });

  const obj = event.data.object;
  const orgId = await resolveBillingOrgId(obj);

  // Idempotency gate — redelivered/retried events no-op.
  if (await billingEventAlreadyProcessed(event.id, event.type, orgId)) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      if (orgId) {
        const plan = BILLING_PLAN_VALUES.has(obj.metadata?.plan) ? obj.metadata.plan : "core";
        let periodEnd = null;
        if (obj.subscription) {
          try {
            const sub = await billingStripe.subscriptions.retrieve(obj.subscription);
            periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
          } catch {}
        }
        await run(
          "UPDATE orgs SET plan=?, subscription_status='active', stripe_subscription_id=?, current_period_end=?, grace_until=NULL WHERE id=?",
          [plan, obj.subscription || null, periodEnd, orgId]
        );
      }
    } else if (event.type === "invoice.payment_succeeded") {
      if (orgId) {
        const periodEnd = obj.lines?.data?.[0]?.period?.end
          ? new Date(obj.lines.data[0].period.end * 1000).toISOString()
          : null;
        await run(
          "UPDATE orgs SET subscription_status='active', current_period_end=?, grace_until=NULL WHERE id=?",
          [periodEnd, orgId]
        );
      }
    } else if (event.type === "invoice.payment_failed") {
      if (orgId) {
        await run(
          "UPDATE orgs SET subscription_status='past_due', grace_until=NOW() + INTERVAL '7 days' WHERE id=?",
          [orgId]
        );
      }
    } else if (event.type === "customer.subscription.updated") {
      // Sync plan (metadata) + status on plan changes / cancel-at-period-end.
      // Stripe statuses we care about: active/trialing (→ active), past_due,
      // canceled/unpaid (→ downgrade + re-lock, mirrors .deleted).
      if (orgId) {
        const s = obj.status;
        const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;
        if (s === "active" || s === "trialing") {
          // Derive from the live price so a Customer-Portal plan switch
          // (Core ↔ Team) flips the tier even though metadata.plan is stale.
          const plan = planFromSubscription(obj);
          if (plan) {
            await run("UPDATE orgs SET plan=?, subscription_status='active', current_period_end=?, grace_until=NULL WHERE id=?", [plan, periodEnd, orgId]);
          } else {
            await run("UPDATE orgs SET subscription_status='active', current_period_end=?, grace_until=NULL WHERE id=?", [periodEnd, orgId]);
          }
        } else if (s === "past_due") {
          await run("UPDATE orgs SET subscription_status='past_due', grace_until=NOW() + INTERVAL '7 days' WHERE id=?", [orgId]);
        } else if (s === "canceled" || s === "unpaid") {
          // Downgrade to core so Team features re-lock on read surfaces too
          // (planTier is plan-driven once status is not trialing).
          await run("UPDATE orgs SET subscription_status='canceled', plan='core', grace_until=NOW() + INTERVAL '3 days' WHERE id=?", [orgId]);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      if (orgId) {
        // Revert tier + re-lock: plan → core (base tier), read-only after grace.
        await run(
          "UPDATE orgs SET subscription_status='canceled', plan='core', grace_until=NOW() + INTERVAL '3 days' WHERE id=?",
          [orgId]
        );
      }
    }
  } catch (err) {
    console.error("Billing webhook error:", err);
  }

  res.json({ received: true });
});

// Import routes accept large one-shot payloads — a 25k-donor CSV with gift
// history serializes to ~12.6MB of JSON (measured, BUILD-05 load test), which
// the global 5mb cap below was rejecting outright: a mid-size org could not
// physically complete onboarding step 2. body-parser marks parsed requests
// (req._body), so the global parser skips bodies these already handled; the
// 5mb cap stays in force for every other route.
app.use(["/donors/import-combined", "/donors/import", "/gifts/import-history"], express.json({ limit: "30mb" }));
app.use(express.json({ limit: "5mb" }));

// Gzip the heavy whole-org read payloads (BUILD-06 Phase A). Scoped to the
// donor-list family rather than app-wide so the SSE stream (/ai/stream) and
// webhook routes are never buffered by the compressor. Mounting on "/donors"
// prefix-matches the whole family (list, summaries, export, :id).
app.use("/donors", compression());

// ── DB readiness guard ─────────────────────────────────────────────────────
let dbReady = false;
getDb()
  .then(() => { dbReady = true; console.log("Database ready"); })
  .catch(err => { console.error("Database init failed:", err); process.exit(1); });

app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: "Database initializing" });
  next();
});

// ── Async error wrapper ────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
    status: "ok", version: "1.1.0", buildSha: BUILD_SHA, db: dbReady, sentry: !!process.env.SENTRY_DSN,
    billing: { mode: billingModeStatus.mode, ok: billingModeStatus.ok, checked: billingModeStatus.checked },
    publicUrl: { url: pu.url, fromEnv: pu.fromEnv },
    // BUILD-45 (F-2): non-secret count of internal notifications the email
    // provider rejected and that are pending retry (or exhausted). A non-zero
    // value that stays high = a delivery problem to look at — this figure is
    // the SURFACING that F-2 was missing. Cached (refreshed by the retry sweep),
    // so /health stays a cheap synchronous check.
    notifications: { failedPending: notifyFailedPending },
  });
});

// ── Request an invitation (public — invitation pivot, 2026-08-06) ──────────
// The landing/invitation form. No CAPTCHA by design (trust cost on a
// credibility page): a hidden honeypot field + a minimum-fill-time check
// stand in for it. Both bot signals return the SAME success response as a
// real submission — never tip a bot off that it was filtered — they just
// store nothing and email no one.
app.post("/invitation-request", invitationLimiter, wrap(async (req, res) => {
  const { name, email, organization, role, donorBand, hardestPart, website, elapsedMs } = req.body || {};
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = clean(name, 120), e = clean(email, 200), org = clean(organization, 200);
  if (!n || !e || !org) return res.status(400).json({ error: "name, email, and organization are required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: "That email doesn't look right" });

  // Honeypot: `website` is a visually-hidden field no human sees. Timing: the
  // client reports ms since the form rendered; a sub-3s fill is not a person.
  const isBot = !!clean(website, 500) || (elapsedMs !== undefined && Number(elapsedMs) < 3000);
  if (!isBot) {
    const id = "invreq_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO invitation_requests (id, name, email, organization, role, donor_band, hardest_part)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, n, e, org, clean(role, 120) || null, clean(donorBand, 40) || null, clean(hardestPart, 2000) || null]
    );
    // Notify the founder — fire-and-forget; the stored row is the source of
    // truth, a mail failure must never fail the request.
    if (process.env.RESEND_API_KEY) {
      const founderEmail = process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev";
      const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      resend.emails.send({
        from: "Steward <noreply@stewardapp.dev>",
        to: founderEmail,
        reply_to: e,
        subject: `Invitation request — ${org}`,
        html: `<div style="font-family:Georgia,serif;line-height:1.7;color:#0f1a12">
          <p><strong>${esc(n)}</strong> (${esc(e)})<br/>${esc(org)}${role ? " · " + esc(clean(role, 120)) : ""}</p>
          <p>Donor database: ${esc(clean(donorBand, 40) || "not answered")}</p>
          <p>Hardest part of keeping donors: ${esc(clean(hardestPart, 2000) || "—")}</p>
        </div>`,
      }).catch(err => console.error("invitation-request notify failed:", err?.message || err));
    }
  }
  res.json({ received: true });
}));

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

// ── Gift date normalization ────────────────────────────────────────────────
// Enforces ISO YYYY-MM-DD so MAX(date) string comparison = chronological order.
function normalizeGiftDate(raw) {
  if (!raw) return new Date().toISOString().split("T")[0];
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;          // already ISO
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().split("T")[0];   // parse → ISO
  return new Date().toISOString().split("T")[0];          // fallback to today
}

// B2 (BUILD-26) — tidy a name arriving from a messy spreadsheet WITHOUT destroying
// signal. Three safe, reversible transforms: (1) collapse runs of whitespace +
// trim; (2) flip a single "Last, First" into "First Last"; (3) re-case a name ONLY
// when the WHOLE string is entirely upper OR entirely lower (ELEANOR FITZGERALD →
// Eleanor Fitzgerald) — any internal mixed case means a human already cased it, so
// it is preserved verbatim (McKinney, O'Brien, van der Berg). Roman-numeral
// suffixes (II/III/IV…) stay upper. The value stays fully editable after import.
// MUST stay in lock-step with normalizeName in client/src/lib/importShape.js
// (asserted by tests/name-normalize.test.js parity sweep).
const _ROMAN_SUFFIX = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)$/i;
// A "Last, First" flip must NOT eat a corporate name like "Acme, Inc." → "Inc. Acme".
const _CORP_SUFFIX = /^(inc|llc|l\.l\.c|llp|ltd|co|corp|company|foundation|fdn|trust|fund|society|assn|association|partners|group|plc|gmbh|nfp)\.?$/i;
function _titleCaseWord(w) {
  if (_ROMAN_SUFFIX.test(w)) return w.toUpperCase();               // III, IV, VIII…
  return w.toLowerCase().replace(/(^|[’'\-.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}
function normalizeName(raw) {
  if (raw == null) return raw;
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return s;
  const parts = s.split(",");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim() && !_CORP_SUFFIX.test(parts[1].trim()))
    s = parts[1].trim() + " " + parts[0].trim();
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const allUpper = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (allUpper || allLower) s = s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*/g, w => _titleCaseWord(w));
  return s;
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
// $149/$299 commercial model actually charged via Stripe); the legacy
// seed/growth/impact enum is still recognized so pre-cutover orgs and any
// in-flight subscription keep their tier without a destructive migration:
//   team  = { team, growth, impact }  OR any live trial (full-feature trial)
//   core  = { core, seed, founding }  OR lapsed/canceled (team features re-lock)
// `founding` is the private $99 founding-partner price — a core-tier discount,
// so it maps to core. See "Platform billing (BUILD-24)" in CLAUDE.md.
const TEAM_PLANS = new Set(["team", "growth", "impact"]);
function orgPlanTier(org) {
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

// ── Moves management & prospect pipeline (BUILD-15) ────────────────────────
// The pipeline reuses the canonical donor-stage set (no second stage field).
// prospect→steward is the forward major-gifts pipeline; lapsed is a trailing
// re-engagement state, not a forward stage. Per-org custom stage editing is a
// deliberately deferred stage on this same field (like the workflow visual
// canvas) — the enum is used app-wide (validation, Kanban, Reports), so it
// stays fixed here.
const PIPELINE_STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward"];
const ALL_PIPELINE_STAGES = [...PIPELINE_STAGES, "lapsed"];
// Stage-weighted forecast: a donor's current stage is a rough close-probability
// for their open asks. Solicit is near the ask; prospect is far off.
const STAGE_WEIGHT = { prospect: 0.1, qualify: 0.2, cultivate: 0.4, solicit: 0.7, steward: 0.9, lapsed: 0.05 };

// ── assignment = portfolio = pipeline membership (BUILD-30, the ONE definition) ─
// A donor assigned to an officer IS in that officer's portfolio, and a donor in
// a portfolio IS on that officer's pipeline board. Assignment is the single
// membership state — there is NO separate "on the board" flag (the old
// `in_pipeline` column is retired/dormant; nothing reads or writes it). Every
// count, label, and board render for portfolio/pipeline derives from this one
// helper, so Home's Portfolio card, Home's Pipeline card, the Pipeline board,
// and the Donors "My Pipeline"/Team views can never disagree again.
//
// Returns a SQL WHERE fragment (using the given table alias) + params selecting
// an officer's portfolio, org-scoped. Unassigned donors match NOTHING here —
// they live in the Directory only and never appear on any board (preserving the
// "the board is not the whole donor list" guarantee). scope:
//   'mine'      → the caller's own assigned donors (assigned_to = userId)
//   'all'       → every assigned donor in the org (assigned_to IS NOT NULL)
//   assignedTo  → one specific officer's portfolio (overrides scope)
function portfolioMembership({ orgId, userId, scope = "mine", assignedTo = null, alias = "d" }) {
  const a = alias ? alias + "." : "";
  // stage ∈ the 6 canonical pipeline stages — every real donor has one (validation
  // only permits these), so for real data "assigned" ⟺ "member". The clause is a
  // belt-and-braces guard so a donor in some non-pipeline stage can never make the
  // Portfolio card, the Pipeline card, and the board disagree — all three exclude
  // it identically. It also keeps the board's per-stage columns exhaustive.
  const clauses = [`${a}org_id = ?`, `${a}deleted_at IS NULL`, `${a}stage = ANY(?)`];
  const params = [orgId, ALL_PIPELINE_STAGES];
  if (assignedTo) {
    clauses.push(`${a}assigned_to = ?`); params.push(String(assignedTo));
  } else if (scope === "all") {
    clauses.push(`${a}assigned_to IS NOT NULL`);
  } else {
    clauses.push(`${a}assigned_to = ?`); params.push(String(userId));
  }
  return { where: clauses.join(" AND "), params };
}

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
  await recordAutoMove(orgId, donorId, "lapsed", "steward", "Auto: re-engaged — new gift");
  return true;
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

// Scheduled sweep — runs on the existing 5-min cadence (same pattern as
// processWorkflowSweeps / processDigests; NOT a second scheduler). Auto-lapse
// applies to EVERY onboarded org (it's a core smart-move, not gated on a
// workflow recipe being enabled).
async function processSmartMoves() {
  try {
    const orgs = await query("SELECT id FROM orgs WHERE onboarding_complete=1");
    for (const { id } of orgs) {
      try { await autoLapseOrg(id); }
      catch (e) { console.error("[smart-move] org", id, e.message); }
    }
  } catch (e) { console.error("[smart-move] sweep:", e.message); }
}
setTimeout(() => processSmartMoves().catch(console.error), 40000);
setInterval(() => processSmartMoves().catch(console.error), 5 * 60 * 1000);

// Signal-based move SUGGESTIONS for a donor (never auto-applied). The officer
// reviews and one-click accepts (which applies via the normal move route) or
// dismisses. Pure function over the donor row + light context.
function computeMoveSuggestions(donor, ctx = {}) {
  const out = [];
  const stage = donor.stage;
  const giftCount = Number(donor.gift_count) || 0;
  const lastGift = donor.last_gift_date && donor.last_gift_date !== "" ? donor.last_gift_date : null;
  const daysSinceGift = lastGift ? Math.floor((Date.now() - new Date(lastGift)) / 86400000) : null;
  // First gift in hand but still parked at prospect → qualify them.
  if (giftCount >= 1 && stage === "prospect") {
    out.push({ signal: "first_gift", toStage: "qualify",
      reason: "First gift received — qualify this donor and start cultivating." });
  }
  // A gift landed while being solicited → the ask effectively closed; steward.
  if (stage === "solicit" && daysSinceGift != null && daysSinceGift <= 90) {
    out.push({ signal: "gift_after_solicit", toStage: "steward",
      reason: "A gift landed after your solicitation — move to Stewardship." });
  }
  // In active cultivation but gone quiet (not yet lapsed) → take a look.
  if (["qualify", "cultivate"].includes(stage) && daysSinceGift != null
      && daysSinceGift > 180 && daysSinceGift < LAPSE_DAYS) {
    out.push({ signal: "going_quiet", toStage: null,
      reason: `No gift in ${Math.round(daysSinceGift / 30)} months — reach out before they lapse.` });
  }
  return out;
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

// Set-based recalc for MANY donors in ONE query — the import hang fix. The
// per-donor recalcDonorSummary loop was ~2 round trips per donor; at 1,500+
// donors that's thousands of sequential queries whose latency (small locally,
// large against a remote Supabase) made a big import appear to hang on
// "Importing…". This computes total/count/last-gift-date and the amount of the
// most-recent gift (tie-break by created_at) for the whole set at once, matching
// recalcDonorSummary's semantics exactly. No-op on an empty set.
async function recalcDonorSummaryBatch(donorIds, orgId) {
  const ids = [...new Set(donorIds)].filter(Boolean);
  if (!ids.length) return;
  await run(
    `WITH agg AS (
       SELECT donor_id,
              COALESCE(SUM(amount),0) AS total,
              COUNT(*) AS cnt,
              MAX(date) AS last_date
       FROM gifts WHERE org_id=? AND donor_id = ANY(?)
       GROUP BY donor_id
     ),
     last_amt AS (
       SELECT DISTINCT ON (donor_id) donor_id, amount
       FROM gifts WHERE org_id=? AND donor_id = ANY(?)
       ORDER BY donor_id, date DESC, created_at DESC
     )
     UPDATE donors d
        SET total_giving     = agg.total,
            gift_count       = agg.cnt,
            last_gift_date   = agg.last_date,
            last_gift_amount = COALESCE(last_amt.amount, 0),
            updated_at       = NOW()
       FROM agg LEFT JOIN last_amt ON last_amt.donor_id = agg.donor_id
      WHERE d.id = agg.donor_id AND d.org_id = ?`,
    [orgId, ids, orgId, ids, orgId]
  );
}

// ── Wealth Score ────────────────────────────────────────────────────────────
async function calcWealthScore(donorId, orgId) {
  try {
    const [donorRows, gifts, interactions] = await Promise.all([
      query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]),
      query("SELECT amount FROM gifts WHERE donor_id = ? AND org_id = ? ORDER BY date DESC", [donorId, orgId]),
      query("SELECT type, note FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC", [donorId, orgId]),
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
      "UPDATE donors SET wealth_score=?,capacity_tier=?,score_confidence=?,score_last_updated=NOW(),score_rationale=? WHERE id=? AND org_id=?",
      [finalScore, capacityTier, confidence, rationale, donorId, orgId]
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
app.post("/auth/login", loginIpLimiter, loginAccountLimiter, wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const users = await query("SELECT * FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (!users.length) return res.status(401).json({ error: "Invalid credentials" });

  const user = users[0];
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [user.org_id]);
  const org = orgs[0];
  const isSuperAdmin = !!user.is_super_admin;
  const token = signToken({ userId: user.id, orgId: user.org_id, email: user.email, role: user.role, isSuperAdmin });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin }, org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 } });
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
  // BUILD-50 item 1: this legacy route previously set no trial_ends_at (→ NULL →
  // never expires). Give it the same free-through-2026 trial as register-org so
  // every self-serve path honors the public promise consistently.
  const trialEndsAt = computeTrialEnd(Date.now()).toISOString();
  await run("INSERT INTO orgs (id, name, mission, ein, onboarding_complete, org_slug, plan, subscription_status, trial_ends_at) VALUES (?,?,?,?,0,?,'trial','trialing',?)",
    [orgId, orgName, orgMission || "", ein || "", orgSlug, trialEndsAt]);
  const hash = bcrypt.hashSync(password, 12);
  await run("INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, orgId, normalizedEmail, hash, name || email, "admin"]);
  // BUILD-36 A1: new org → instant_gift_thanks ON by default.
  await provisionNewOrgWorkflows(orgId).catch(e => console.error("[org] provision workflows:", e.message));

  const token = signToken({ userId, orgId, email: normalizedEmail, role: "admin" });
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
  const { orgName, userName, email, password } = req.body;
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
  // BUILD-50 item 1: honor the public "Free through December 31, 2026" promise.
  // Orgs created in 2026 get a trial ending EOD 2026-12-31 (UTC fallback — no
  // per-org timezone column yet); orgs created 2027+ get the standard 30 days.
  const trialEndsAt = computeTrialEnd(Date.now()).toISOString();

  await run(
    "INSERT INTO orgs (id, name, onboarding_complete, org_slug, plan, subscription_status, trial_ends_at) VALUES (?,?,0,?,'trial','trialing',?)",
    [orgId, orgName, orgSlug, trialEndsAt]
  );
  const hash = bcrypt.hashSync(password, 12);
  await run(
    "INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
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

  const token = signToken({ userId, orgId, email: normalizedEmail, role: "admin" });
  res.status(201).json({
    token,
    user: { id: userId, email: normalizedEmail, name: userName, role: "admin" },
    org: { id: orgId, name: orgName, onboarding_complete: 0, plan: "trial", subscription_status: "trialing", trial_ends_at: trialEndsAt },
    stripeCustomerId,
  });
  sendOnboardingSequence(orgId, userId, userName, normalizedEmail).catch(e =>
    console.error("[onboarding] failed to start sequence:", e.message)
  );
}));

// ── Me ─────────────────────────────────────────────────────────────────────
app.get("/me", requireAuth, wrap(async (req, res) => {
  const users = await query("SELECT id, email, name, role, notify_portfolio_gifts, notify_task_assignments, notify_daily_tasks FROM users WHERE id = ?", [req.user.userId]);
  const orgs  = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!users.length || !orgs.length) return res.status(404).json({ error: "Not found" });
  const u = users[0];
  res.json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role },
    org: orgs[0],
    notifications: mapNotifyPrefs(u),
  });
}));

// PUT /me/notification-prefs (BUILD-36 A4) — per-user email toggles: "Email me
// about: portfolio gifts / task assignments / daily task reminder". Default on.
app.put("/me/notification-prefs", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const map = { portfolioGifts: "notify_portfolio_gifts", taskAssignments: "notify_task_assignments", dailyTasks: "notify_daily_tasks" };
  const sets = [], params = [];
  for (const [k, col] of Object.entries(map)) {
    if (typeof b[k] === "boolean") { sets.push(`${col}=?`); params.push(b[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: "No valid preferences provided" });
  params.push(req.user.userId);
  await run(`UPDATE users SET ${sets.join(",")} WHERE id=?`, params);
  const rows = await query("SELECT notify_portfolio_gifts, notify_task_assignments, notify_daily_tasks FROM users WHERE id=?", [req.user.userId]);
  res.json({ notifications: mapNotifyPrefs(rows[0]) });
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
  res.json({ ...org, accessState: getOrgAccessState(org) });
}));

// ── BUILD-35: "Set up Steward" activation checklist ─────────────────────────
// Every item's done-state is COMPUTED live from the actual org data — never
// stored per-step — so an item checks itself off however the underlying thing
// became true (wizard, Settings, a teammate). No checklist state can drift
// out of sync with reality (the count-matches-destination lesson applied to
// setup). Only the card's dismissal preference is stored (orgs.setup_card_state).
const SETUP_DONOR_THRESHOLD = 5; // >5 real donors = "imported" (matches the sample-data loader's real-org bar)

app.get("/org/setup-status", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = orgs[0];
  const tier = orgPlanTier(org);

  const [donorRow, pageRow, wfRow, userRow, inviteRow] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND deleted_at IS NULL AND is_sample IS NOT TRUE`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM giving_pages WHERE org_id = ? AND status = 'active'`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM workflows WHERE org_id = ? AND enabled = TRUE`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM users WHERE org_id = ?`, [orgId]),
    query(`SELECT COUNT(*)::int AS n FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > NOW()`, [orgId]),
  ]);
  const donorCount = donorRow[0].n;

  // In value order. `key` is stable (the client owns labels/why-lines/deep
  // links); `done` is the live computation. The invite item exists only on
  // Team tier — plan-graceful means HIDDEN on Core, not shown-and-locked.
  const items = [
    { key: "donors", done: donorCount > SETUP_DONOR_THRESHOLD, count: donorCount },
    { key: "stripe", done: !!org.stripe_account_id },
    { key: "address", done: !!(org.receipt_address && String(org.receipt_address).trim()) },
    { key: "givingPage", done: pageRow[0].n > 0 },
    { key: "workflow", done: wfRow[0].n > 0 },
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
  if (req.user.orgId !== req.params.id) return res.status(403).json({ error: "Forbidden" });
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
    await run(
      `UPDATE orgs SET mission=?, focus_area=?, annual_budget=?, founded_year=?, website=? WHERE id=?`,
      [mission || null, focusArea || null, annualBudget || null, foundedYear ? parseInt(foundedYear, 10) : null, website || null, req.params.id]
    );
  }

  // Donor-covers-fees switch — only touched when the request includes it
  // (Settings' Giving section sends it; no other PATCH caller does).
  if (req.body.coverFeesEnabled !== undefined) {
    await run(`UPDATE orgs SET cover_fees_enabled=? WHERE id=?`, [!!req.body.coverFeesEnabled, req.params.id]);
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
    if (typeof logoData !== "string" || !/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/.test(logoData))
      return res.status(400).json({ error: "Logo must be a PNG, JPEG, GIF, WebP, or SVG image." });
    if (Buffer.byteLength(logoData, "utf8") > LOGO_MAX_BYTES)
      return res.status(400).json({ error: "Logo is too large — please use an image under 350KB." });
    sets.push("logo_data=?"); params.push(logoData);
  }

  if (sets.length) {
    params.push(req.user.orgId);
    await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, params);
  }
  const orgs = await query("SELECT id, name, logo_data, brand_accent, brand_accent_fg FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ ...orgs[0], adjusted: !!(normalized && normalized.adjusted) });
}));

// ── Sample data ────────────────────────────────────────────────────────────
app.get("/org/sample-data-status", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND is_sample=true",
    [req.user.orgId]
  );
  const sampleDonorCount = parseInt(rows[0].cnt || 0);
  res.json({ hasSampleData: sampleDonorCount > 0, sampleDonorCount });
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

  const today = new Date();
  function dAgo(n) {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }

  // Insert 3 sample funds
  const fGen = "fund_smpl_general", fEdu = "fund_smpl_edu", fCap = "fund_smpl_capital";
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
      `INSERT INTO donors (id,org_id,name,email,phone,stage,total_giving,last_gift_amount,last_gift_date,gift_count,city,state,zip,assigned_to,assigned_to_name,is_sample)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [d.id,orgId,d.name,d.email,d.phone,d.stage,d.total,d.last,d.lastGift,d.giftCount,d.city,d.state,d.zip,userId,userName]
    );
  }

  // Gifts for donors with giving history
  for (const d of donors.filter(x => x.total > 0)) {
    const n = d.id.replace("smpl_d","");
    const fundId = d.stage==="steward" ? fEdu : fGen;
    const method = (d.stage==="steward"||d.stage==="solicit") ? "check" : "credit_card";
    await run(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      ["smpl_g"+n, orgId, d.id, d.last, d.lastGift, "cash", fundId, method]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample) VALUES (?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      ["smpl_ftx"+n, orgId, d.lastGift, `Gift — ${d.name}`, d.name, d.last, "income", null, fundId]
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
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [g.id,orgId,g.donor,g.amount,g.date,"cash",g.fund,g.method]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample) VALUES (?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [g.id+"_ftx",orgId,g.date,`Historical gift`,donors.find(d=>d.id===g.donor)?.name||"",g.amount,"income",null,g.fund]
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
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample) VALUES (?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [e.id,orgId,e.date,e.desc,e.vendor,e.amount,"expense",null,e.fund]
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
      `INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,notes,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [g.id,orgId,g.funder,g.program,g.amount,g.status,g.deadline,g.notes]
    );
  }

  // 2 events
  const ev1 = "smpl_ev1", ev2 = "smpl_ev2";
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
    [ev1,orgId,"Annual Spring Gala","gala",dAgo(30),dAgo(30),"The Plaza Hotel, NYC","Our signature annual fundraising gala celebrating 10 years of impact.",200,"completed",185000,42000]
  );
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
    [ev2,orgId,"Fall Cultivation Dinner","cultivation",dAgo(-60),dAgo(-60),"Private Dining Room, One World Trade","Intimate dinner for prospective major donors.",30,"upcoming",0,8500]
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
      [a.aId,ev1,orgId,a.dId,dn.name,dn.email,"attended",a.gift]
    );
  }

  // 1 email campaign
  await run(
    `INSERT INTO campaigns (id,org_id,name,subject,body,status,briefing,goal_amount,raised_amount,start_date,end_date,is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
    ["smpl_camp1",orgId,"Year-End Giving Appeal","Make a difference before December 31st",
     "Dear {{first_name}},\n\nAs the year draws to a close, we reflect on the incredible impact your support has made possible. This year, our students performed on stages across New York City, received 47 scholarships, and logged over 12,000 hours of instruction.\n\nYour gift today — doubled by a board matching challenge — will fund another year of transformative programming.\n\nWith gratitude,\n{{user_name}}",
     "sent",
     "Lead with the 3 scholarship recipient stories. Emphasize the 2:1 board match — expires Dec 31. Subject line A/B: test urgency vs. impact angle. Send to all active donors + lapsed within 2 years.",
     200000,142000,dAgo(45),dAgo(-20)]
  );

  // 15 interactions
  const interactions = [
    {id:"smpl_i1",donor:"smpl_d1",type:"meeting",note:"Stewardship lunch at Per Se. Discussed Capital Campaign leadership gift opportunity. Very enthusiastic about naming the rehearsal hall. Will bring husband to site visit next month.",date:dAgo(15)},
    {id:"smpl_i2",donor:"smpl_d1",type:"call",note:"Called to thank for $150k Annual Fund renewal. She mentioned interest in an endowed scholarship. Will follow up with proposal.",date:dAgo(45)},
    {id:"smpl_i3",donor:"smpl_d2",type:"meeting",note:"Portfolio review with James and Carol. Carol is particularly interested in scholarship outcomes. James wants to see facility plans for capital campaign.",date:dAgo(25)},
    {id:"smpl_i4",donor:"smpl_d3",type:"call",note:"Discovery call — board member referral. David runs a PE firm, has significant capacity. Deep interest in youth workforce development. Scheduled site visit for next week.",date:dAgo(8)},
    {id:"smpl_i5",donor:"smpl_d3",type:"meeting",note:"Site visit to after-school program. Deeply moved by student presentations. Ask conversation: mid-six figures for endowed scholarship. Strategy session with ED scheduled.",date:dAgo(45)},
    {id:"smpl_i6",donor:"smpl_d4",type:"email",note:"Subject: Follow-up on proposal\n\nSent $20k proposal documents as discussed. Patricia confirmed receipt and said she would review with her financial advisor this month.",date:dAgo(30)},
    {id:"smpl_i7",donor:"smpl_d5",type:"meeting",note:"Met at Kennedy Center gala. Strong connection to arts education mission — has given to 3 similar organizations. Invited to Fall Cultivation Dinner.",date:dAgo(18)},
    {id:"smpl_i8",donor:"smpl_d6",type:"call",note:"Follow-up after proposal submission. Linda said the grants committee meets next month. Asked about a board matching gift opportunity.",date:dAgo(12)},
    {id:"smpl_i9",donor:"smpl_d8",type:"event",note:"Attended Spring Gala with spouse. Made $3,500 gift at the event. Very engaged during student performances — a strong cultivation prospect.",date:dAgo(30)},
    {id:"smpl_i10",donor:"smpl_d9",type:"call",note:"Cold outreach from board referral. Michael is a real estate developer, new to NYC philanthropy. Invited to a site visit. Very responsive.",date:dAgo(22)},
    {id:"smpl_i11",donor:"smpl_d21",type:"email",note:"Subject: Reconnecting — 2 years since your last gift\n\nSent personalized re-engagement email. Arthur's company was recently acquired. New email confirmed by EA.",date:dAgo(40)},
    {id:"smpl_i12",donor:"smpl_d22",type:"call",note:"Left voicemail — 3rd attempt this quarter. Meredith has not responded to outreach since her major gift 3 years ago. May need board member warm intro.",date:dAgo(60)},
    {id:"smpl_i13",donor:"smpl_d1",type:"stewardship",note:"Mailed annual impact report with personal handwritten note. Highlighted the scholarship recipients she funded this year.",date:dAgo(20)},
    {id:"smpl_i14",donor:"smpl_d2",type:"gift",note:"Received $75,000 annual fund gift via wire transfer. Acknowledgement letter sent same day.",date:dAgo(60)},
    {id:"smpl_i15",donor:"smpl_d3",type:"meeting",note:"Strategy session with ED and board chair. Confirmed ask of $75,000 for named scholarship fund. Meeting scheduled for next week.",date:dAgo(5)},
  ];
  for (const i of interactions) {
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [i.id,orgId,i.donor,i.type,i.note,i.date,userId,userName]
    );
  }

  // 5 tasks
  const tasks = [
    {id:"smpl_t1",title:"Call David Okonkwo — schedule formal ask meeting",priority:"high",due:dAgo(-3),donor:"smpl_d3"},
    {id:"smpl_t2",title:"Draft MacArthur Foundation full proposal",priority:"high",due:dAgo(-14),donor:null},
    {id:"smpl_t3",title:"Send Fall Cultivation Dinner invitations to Prospect-stage donors",priority:"medium",due:dAgo(-7),donor:null},
    {id:"smpl_t4",title:"Prepare NEA mid-year grant report",priority:"medium",due:dAgo(-30),donor:null},
    {id:"smpl_t5",title:"Follow up with Arthur Blake — re-engagement email",priority:"low",due:dAgo(-2),donor:"smpl_d21"},
  ];
  for (const t of tasks) {
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,is_sample) VALUES (?,?,?,?,?,?,0,?,true) ON CONFLICT (id) DO NOTHING`,
      [t.id,orgId,t.title,t.due,t.priority,"donor",t.donor]
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
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,notes,is_sample) VALUES (?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [v.id,orgId,v.name,v.email,v.hours,v.skills,v.notes]
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
      `INSERT INTO board_members (id,org_id,name,role,giving_level,committees,is_sample) VALUES (?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [b.id,orgId,b.name,b.role,b.giving_level,b.committees]
    );
  }

  res.json({ ok: true, donorCount: donors.length });
}));

app.post("/org/clear-sample-data", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  await run("DELETE FROM event_attendees WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM events WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM interactions WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  // Receipts never issue for is_sample gifts (issueGiftReceipt skips them
  // outright) — this is belt-and-braces cleanup, not expected to find rows.
  await run("DELETE FROM receipts WHERE org_id=? AND gift_id IN (SELECT id FROM gifts WHERE org_id=? AND is_sample=true)", [orgId, orgId]).catch(()=>{});
  await run("DELETE FROM gifts WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM fin_transactions WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM donors WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM grants WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM campaigns WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM tasks WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM volunteers WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM board_members WHERE org_id=? AND is_sample=true", [orgId]).catch(()=>{});
  await run("DELETE FROM fin_funds WHERE org_id=? AND id IN (?,?,?)", [orgId,"fund_smpl_general","fund_smpl_edu","fund_smpl_capital"]).catch(()=>{});
  res.json({ ok: true });
}));

// ── One-time backfill: create missing gift touchpoints ────────────────────
// For gifts that pre-date the touchpoint-creation code in the history importer.
// Safe to re-run: skips any gift that already has a type='gift' interaction
// whose note contains the same dollar amount (donor_id + date + amount match).
app.post("/org/backfill-gift-touchpoints", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;

  const toBackfill = await query(
    `SELECT g.id, g.donor_id, g.amount, g.date, g.type, g.notes
     FROM gifts g
     WHERE g.org_id = ?
     AND NOT EXISTS (
       SELECT 1 FROM interactions i
       WHERE i.org_id = ?
       AND i.type = 'gift'
       AND i.donor_id = g.donor_id
       AND i.date = g.date
       AND i.note LIKE '%$' || to_char(g.amount, 'FM999,999,999') || '%'
     )
     ORDER BY g.donor_id, g.date`,
    [orgId, orgId]
  );

  let created = 0;
  for (const g of toBackfill) {
    const fundNote = g.type || "cash";
    const amt = Number(g.amount);
    const intNote = `Gift received: $${amt.toLocaleString()} (${fundNote})${g.notes ? " — " + g.notes : ""}`;
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_"+uuid().slice(0,8), orgId, g.donor_id, "gift", intNote, g.date, req.user.userId, "Import Backfill"]
    );
    created++;
  }

  res.json({
    found: toBackfill.length,
    backfilled: created,
    gifts: toBackfill.map(g => ({ donor_id: g.donor_id, amount: g.amount, date: g.date }))
  });
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
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await query("SELECT id FROM users WHERE lower(email) = lower(btrim(?))", [email]);
  if (existing.length) return res.status(409).json({ error: "A user with that email already exists" });

  // Seat limit: count active users + pending unexpired invites
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const seatCheck = await checkPlanLimit(orgForLimit[0], "seats");
    if (!seatCheck.isTrial && seatCheck.limit !== 999999999) {
      const pendingRow = await query(
        "SELECT COUNT(*) AS c FROM invites WHERE org_id=? AND accepted_at IS NULL AND expires_at > NOW()",
        [req.user.orgId]
      );
      const totalWithPending = seatCheck.current + Number(pendingRow[0]?.c || 0);
      if (totalWithPending >= seatCheck.limit) {
        return res.status(403).json({ error: "seat_limit", message: "You've reached your seat limit.", current: totalWithPending, limit: seatCheck.limit, plan: orgForLimit[0].plan, isTrial: false });
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
  const jwtToken = signToken({ userId, orgId: invite.org_id, email: invite.email, role: invite.role });
  res.status(201).json({
    token: jwtToken,
    user: { id: userId, email: invite.email, name, role: invite.role },
    org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 },
  });
}));

// ── Donors ─────────────────────────────────────────────────────────────────
// Server-side filtering/pagination (BUILD-06 Phase A). Shared between
// GET /donors and GET /donors/export/csv so the export always matches the
// same query the Directory ran. Sort is a whitelist — never interpolate
// user input into ORDER BY.
const DONOR_SORTS = {
  total_giving:   "total_giving DESC",
  name:           "lower(name) ASC",
  last_gift_date: "last_gift_date DESC NULLS LAST",
  created_at:     "created_at DESC",
};
function buildDonorListFilter(req) {
  const where = ["org_id = ?", "deleted_at IS NULL"];
  const params = [req.user.orgId];
  const { search, stage, status, assignedTo, designation, household } = req.query;
  if (search && String(search).trim()) {
    const s = "%" + String(search).trim().toLowerCase() + "%";
    where.push("(lower(name) LIKE ? OR lower(email) LIKE ?)");
    params.push(s, s);
  }
  if (stage)      { where.push("stage = ?");       params.push(String(stage)); }
  if (status)     { where.push("status = ?");      params.push(String(status)); }
  if (assignedTo) { where.push("assigned_to = ?"); params.push(String(assignedTo)); }
  // Designation filter (BUILD-14) — planned-giving / estate segments are
  // first-class and filterable everywhere the donor list is. EXISTS keeps it
  // a single query; donors.id is safe (both callers use unaliased FROM donors).
  if (designation) {
    where.push("EXISTS (SELECT 1 FROM donor_designations dd WHERE dd.donor_id = donors.id AND dd.kind = ?)");
    params.push(String(designation));
  }
  // Household filter: `household=<id>` scopes to one household's members;
  // `household=any` / `household=none` filter by membership presence.
  if (household === "none")      { where.push("household_id IS NULL"); }
  else if (household === "any")  { where.push("household_id IS NOT NULL"); }
  else if (household)            { where.push("household_id = ?"); params.push(String(household)); }
  // ", id" tiebreak keeps page boundaries stable when many donors share a value
  const orderBy = (DONOR_SORTS[req.query.sort] || DONOR_SORTS.total_giving) + ", id";
  return { whereSql: where.join(" AND "), params, orderBy };
}

// GET /donors — unpaginated legacy shape (plain array) when `limit` is
// absent, so every pre-pagination caller keeps working; `{donors, total}`
// when `limit` is present. Filters (search/stage/status/assignedTo/sort)
// are honored in both modes.
app.get("/donors", requireAuth, wrap(async (req, res) => {
  const { whereSql, params, orderBy } = buildDonorListFilter(req);
  const mapDonor = tpMap => d => ({
    ...d,
    tags: JSON.parse(d.tags || "[]"),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
  });

  if (req.query.limit === undefined) {
    const [donors, touchpoints] = await Promise.all([
      query(`SELECT * FROM donors WHERE ${whereSql} ORDER BY ${orderBy}`, params),
      query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
    ]);
    const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
    return res.json(donors.map(mapDonor(tpMap)));
  }

  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const [donors, cnt] = await Promise.all([
    query(`SELECT * FROM donors WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset]),
    query(`SELECT COUNT(*) AS c FROM donors WHERE ${whereSql}`, params),
  ]);
  // Touchpoints only for the page's donors — not the org-wide GROUP BY
  const ids = donors.map(d => d.id);
  const touchpoints = ids.length
    ? await query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? AND donor_id = ANY(?) GROUP BY donor_id", [req.user.orgId, ids])
    : [];
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  res.json({ donors: donors.map(mapDonor(tpMap)), total: parseInt(cnt[0].c, 10) });
}));

// Lightweight whole-org list for consumers that need every donor but not the
// heavy text columns (notes, score_rationale — the bulk of GET /donors'
// 21.7MB payload at 25k donors). Feeds the app shell's shared donor state:
// Kanban/team/re-engage/map views, onboarding snapshot, Communications
// audience counts, AI context builders. Column names match GET /donors so
// adaptDonor works unchanged on the subset.
app.get("/donors/summaries", requireAuth, wrap(async (req, res) => {
  const [donors, touchpoints] = await Promise.all([
    query(`SELECT id, name, email, phone, stage, status, total_giving, last_gift_date,
                  last_gift_amount, gift_count, assigned_to, assigned_to_name,
                  pending_assignee_invite_id, pending_assignee_name,
                  city, state, zip, tags, wealth_score, capacity_tier, planned_giving,
                  employer, stripe_subscription_status
           FROM donors WHERE org_id = ? AND deleted_at IS NULL ORDER BY total_giving DESC, id`, [req.user.orgId]),
    query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
  ]);
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  res.json(donors.map(d => ({
    ...d,
    tags: JSON.parse(d.tags || "[]"),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
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
    groups.push({ tier: "email", reason: `Same email — ${e}`, donors: list.map(donorOut) });
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
    groups.push({ tier: "name", reason: `Same name — "${list[0].name}"`, donors: list.map(donorOut) });
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
        groups.push({ tier: "name", reason: `Similar names — "${a.name}" / "${b.name}"`, donors: [a, b].map(donorOut) });
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
  const { whereSql, params, orderBy } = buildDonorListFilter(req);
  const donors = await query(`SELECT * FROM donors WHERE ${whereSql} ORDER BY ${orderBy}`, params);
  const columns = [
    ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
    ["Stage", "stage"], ["Status", "status"],
    ["Total giving", "total_giving"], ["Last gift date", "last_gift_date"],
    ["Last gift amount", "last_gift_amount"], ["Gift count", "gift_count"],
    ["Assigned to", d => d.assigned_to_name || ""],
    ["City", d => d.city || ""], ["State", d => d.state || ""],
    ["Tags", d => JSON.parse(d.tags || "[]").join("|")],
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="donors-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(toCsv(columns, donors));
}));

app.get("/donors/my", requireAuth, wrap(async (req, res) => {
  const [donors, touchpoints] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id = ? AND assigned_to = ? AND deleted_at IS NULL ORDER BY total_giving DESC", [req.user.orgId, req.user.userId]),
    query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
  ]);
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  const result = donors.map(d => ({
    ...d,
    tags: JSON.parse(d.tags || "[]"),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
  }));
  res.json(result);
}));

app.get("/donors/custom-field-values/all", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT donor_id, field_id, value FROM custom_field_values WHERE org_id = ?",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({ donorId: r.donor_id, fieldId: r.field_id, value: r.value })));
}));

// Pipeline stage counts — reuses the same grouping the Dashboard's Donor
// Pipeline/funnel widgets compute, exposed as its own callable endpoint.
app.get("/donors/stage-counts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT stage, COUNT(*) as count, COALESCE(SUM(total_giving),0) as total FROM donors WHERE org_id = ? AND deleted_at IS NULL GROUP BY stage",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({ stage: r.stage || "cultivate", count: parseInt(r.count, 10), total: parseFloat(r.total) || 0 })));
}));

app.get("/donors/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });

  const d = rows[0];
  d.tags = JSON.parse(d.tags || "[]");
  d.interactions = await query("SELECT * FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC", [d.id, req.user.orgId]);
  d.gifts = await query("SELECT * FROM gifts WHERE donor_id = ? ORDER BY date DESC", [d.id]);
  d.matching_gift = lookupMatchingGift(d.employer);
  res.json(d);
}));

app.post("/donors", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, email, phone, status, stage, tags, notes, lastAmount, assignedTo, assignedToName } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999 && recordCheck.current >= recordCheck.limit) {
      return res.status(403).json({ error: "record_limit", message: `You've reached your donor record limit of ${recordCheck.limit}.`, current: recordCheck.current, limit: recordCheck.limit, plan: orgForLimit[0].plan, isTrial: false });
    }
  }

  const id = "d_" + uuid().slice(0, 8);
  const today = new Date().toISOString().split("T")[0];
  let selfName = assignedToName;
  if (!assignedTo && !selfName) {
    const uRow = await query("SELECT name FROM users WHERE id = ?", [req.user.userId]);
    selfName = uRow[0]?.name || req.user.email;
  }
  const finalAssignedTo = assignedTo || req.user.userId;
  const finalAssignedToName = assignedTo ? (assignedToName || "") : selfName;
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,assigned_to,assigned_to_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, email || "", phone || "", status || "new", stage || "prospect",
     lastAmount || 0, lastAmount || 0, today, lastAmount ? 1 : 0,
     JSON.stringify(tags || []), notes || "", finalAssignedTo, finalAssignedToName]
  );
  const rows = await query("SELECT * FROM donors WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

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

// buildAssigneeResolver — for a Team org, validate the per-donor `assignedTo`
// the import payload carries (from the client's owner-column mapping) and return
// a resolver donor→{ id, name, pendingInviteId, pendingName }. Two kinds of
// assignee are honored:
//   - a real user id in THIS org → { id, name }               (lands on the board)
//   - "invite:<id>" for a PENDING invite in this org → { pendingInviteId,
//     pendingName } (held until the officer accepts — see /auth/invite/accept)
// Core/lapsed orgs (not team tier) get a no-op resolver, so a Core import always
// lands UNASSIGNED regardless of payload. An `assignedTo` that matches neither a
// real user nor a live pending invite resolves to all-null (never silently
// mis-assigns across orgs or to a stale/expired id).
async function buildAssigneeResolver(donors, orgId, isTeam) {
  const NONE = { id: null, name: null, pendingInviteId: null, pendingName: null };
  if (!isTeam) return () => NONE;
  const raw = [...new Set(donors.map(d => d && d.assignedTo).filter(Boolean).map(String))];
  const userIds = raw.filter(v => !v.startsWith("invite:"));
  const inviteIds = raw.filter(v => v.startsWith("invite:")).map(v => v.slice("invite:".length)).filter(Boolean);

  const validUsers = new Map();
  if (userIds.length) {
    const rows = await query("SELECT id, name FROM users WHERE id = ANY(?) AND org_id = ?", [userIds, orgId]);
    rows.forEach(r => validUsers.set(r.id, r.name));
  }
  const validInvites = new Map();
  if (inviteIds.length) {
    const rows = await query(
      "SELECT id, email FROM invites WHERE id = ANY(?) AND org_id = ? AND accepted_at IS NULL AND expires_at > NOW()",
      [inviteIds, orgId]
    );
    rows.forEach(r => validInvites.set(r.id, inviteeDisplayName(r.email)));
  }
  return (d) => {
    const v = d && d.assignedTo ? String(d.assignedTo) : null;
    if (!v) return NONE;
    if (v.startsWith("invite:")) {
      const inviteId = v.slice("invite:".length);
      if (!validInvites.has(inviteId)) return NONE;
      return { id: null, name: null, pendingInviteId: inviteId, pendingName: d.assignedToName || validInvites.get(inviteId) || null };
    }
    if (!validUsers.has(v)) return NONE;
    return { id: v, name: d.assignedToName || validUsers.get(v) || null, pendingInviteId: null, pendingName: null };
  };
}

app.post("/donors/import", requireAuth, wrap(async (req, res) => {
  const { donors } = req.body;
  if (!Array.isArray(donors) || donors.length === 0)
    return res.status(400).json({ error: "donors array required" });

  // ── Plan limit check (unchanged — keep 403 + UpgradeModal flow exactly) ──
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999) {
      const validCount = donors.filter(d => d.name).length;
      const remaining = recordCheck.limit - recordCheck.current;
      if (remaining <= 0 || validCount > remaining) {
        return res.status(403).json({
          error: "record_limit",
          message: remaining <= 0
            ? `You've reached your donor record limit of ${recordCheck.limit}.`
            : `This import would add ${validCount} records but you can only add ${remaining} more (limit: ${recordCheck.limit}).`,
          current: recordCheck.current,
          limit: recordCheck.limit,
          allowed: Math.max(0, remaining),
          plan: orgForLimit[0].plan,
          isTrial: false,
        });
      }
    }
  }

  // ── Owner-column assignment (Team only) ──
  // A Team org's import may carry per-donor `assignedTo` (mapped from an owner/
  // officer column on the client). Validate + resolve; Core orgs → no-op (land
  // unassigned). An assigned donor also joins the working board (in_pipeline).
  const isTeamOrg = orgForLimit.length ? orgPlanTier(orgForLimit[0]) === "team" : false;
  const resolveAssignee = await buildAssigneeResolver(donors, req.user.orgId, isTeamOrg);

  // ── Dedup by email against existing donors (case-insensitive) ──
  // Comment: future option is merge/update rather than skip.
  const existingEmailRows = await query(
    "SELECT LOWER(email) AS e FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [req.user.orgId]
  );
  const existingEmails = new Set(existingEmailRows.map(r => r.e));
  const seenEmails = new Set(); // within-import dedup

  let duplicates = 0;
  const donorsToInsert = [];

  for (const d of donors) {
    if (!d.name || !String(d.name).trim()) continue;
    const emailLower = (d.email || "").toLowerCase().trim();
    if (emailLower) {
      if (existingEmails.has(emailLower) || seenEmails.has(emailLower)) { duplicates++; continue; }
      seenEmails.add(emailLower);
    }
    donorsToInsert.push(d);
  }

  // ── Batched bulk INSERTs (500/batch, one statement per batch) ──
  // 17 columns × 500 rows = 8,500 params — well under PG's 65,535 placeholder limit.
  // runTx's ?→$n substitution handles the flat positional array correctly.
  const BATCH = 500;
  let created = 0;
  const batchErrors = [];

  for (let bi = 0; bi < donorsToInsert.length; bi += BATCH) {
    const batch = donorsToInsert.slice(bi, bi + BATCH);

    // Build one flat params array and matching VALUE tuples in a single pass
    // so column order and param order are always in sync.
    const params = [];
    const tuples = batch.map(d => {
      const a = resolveAssignee(d);
      params.push(
        "d_" + uuid().slice(0, 8), req.user.orgId,
        normalizeName(d.name),
        d.email   || "",
        d.phone   || "",
        d.status  || "new",
        d.stage   || "prospect",
        Math.round(parseFloat(d.total)      || 0),
        Math.round(parseFloat(d.lastAmount) || 0),
        d.lastGift || null,
        parseInt(d.gifts) || (d.total ? 1 : 0),
        JSON.stringify(Array.isArray(d.tags) ? d.tags : []),
        d.notes || "",
        d.city  || null,
        d.state || null,
        a.id,               // assigned_to — a mapped owner column → real user (Team), else null.
        a.name,             // assigned_to_name. Assignment IS board membership (BUILD-30) —
                            // an assigned donor is in the officer's portfolio AND on their board.
        a.pendingInviteId,  // pending_assignee_invite_id — held for an invited-but-not-accepted officer
        a.pendingName       // pending_assignee_name — display label until they accept
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });

    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO donors
             (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
              last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name,
              pending_assignee_invite_id,pending_assignee_name)
           VALUES ${tuples.join(",")}`,
          params
        );
      });
      created += batch.length;
    } catch (e) {
      const rowStart = bi + 1;
      const rowEnd   = bi + batch.length;
      console.error(`[import] batch rows ${rowStart}–${rowEnd} failed:`, e.message);
      batchErrors.push({ rows: `${rowStart}–${rowEnd}`, error: e.message });
    }
  }

  res.json({ created, duplicates, batchErrors });
}));

// ── Combined import: new donors + their year-column gift history in one pass ─
// Donor IDs are generated in JS before any DB write so gift rows can reference
// them without a round trip. Both donor and gift inserts are bulk (one statement
// per batch), matching the pattern in /donors/import and matching the gift+
// interaction format that /gifts/import-history and the single-gift route use.
app.post("/donors/import-combined", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { donors, gifts } = req.body;
  if (!Array.isArray(donors) || !donors.length)
    return res.status(400).json({ error: "donors array required" });
  if (!Array.isArray(gifts))
    return res.status(400).json({ error: "gifts array required" });

  const orgId = req.user.orgId;

  // Plan limit check (same as /donors/import)
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999) {
      const validCount = donors.filter(d => d.name).length;
      const remaining = recordCheck.limit - recordCheck.current;
      if (remaining <= 0 || validCount > remaining) {
        return res.status(403).json({
          error: "record_limit",
          message: remaining <= 0
            ? `You've reached your donor record limit of ${recordCheck.limit}.`
            : `This import would add ${validCount} records but you can only add ${remaining} more.`,
          current: recordCheck.current, limit: recordCheck.limit,
          allowed: Math.max(0, remaining), plan: orgForLimit[0].plan, isTrial: false,
        });
      }
    }
  }

  // Importer identity
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";
  const importerId   = req.user.userId;

  // Owner-column assignment (Team only) — mirrors /donors/import. Per-donor
  // `assignedTo` from a mapped owner column routes each donor to its officer's
  // portfolio (in_pipeline). Core orgs → no-op (imported unassigned).
  const isTeamOrg = orgForLimit.length ? orgPlanTier(orgForLimit[0]) === "team" : false;
  const resolveAssignee = await buildAssigneeResolver(donors, orgId, isTeamOrg);

  // BUILD-27 Part C (scenario 3): serialize the email dedup + donor insert for
  // THIS org so two parallel imports can't both pre-load the email set, both miss
  // each other's in-flight rows, and both insert an overlapping donor. The
  // advisory lock makes the check-then-insert dedup atomic per org (different orgs
  // still import fully in parallel) WITHOUT a hard UNIQUE(email) the product can't
  // have — duplicate emails are legitimately possible and the merge tool handles
  // them. Shared results are hoisted out so the gift-attach step below can use them.
  let duplicates = 0;
  let created = 0;
  const donorsToInsert = [];
  const indexToId = {}; // donorIndex → pre-generated id (only non-deduped donors)
  const explicitStageIds = []; // donors whose file had an explicit stage column — never re-inferred over
  const batchErrors = [];
  const failedIds = new Set(); // IDs whose batch failed — drop their gifts too
  const DONOR_BATCH = 500;

  await withAdvisoryLock(`import:${orgId}`, async () => {
  // Email dedup (same bulk-Set approach as /donors/import)
  const existingEmailRows = await query(
    "SELECT LOWER(email) AS e FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
  );
  const existingEmails = new Set(existingEmailRows.map(r => r.e));
  const seenEmails = new Set();

  // Generate all donor IDs in JS before inserting — gifts reference these IDs directly,
  // no extra round trip needed.
  donors.forEach((d, idx) => {
    if (!d.name || !String(d.name).trim()) return;
    const emailLower = (d.email || "").toLowerCase().trim();
    if (emailLower) {
      if (existingEmails.has(emailLower) || seenEmails.has(emailLower)) { duplicates++; return; }
      seenEmails.add(emailLower);
    }
    const id = "d_" + uuid().slice(0, 8);
    indexToId[idx] = id;
    donorsToInsert.push({ ...d, _id: id });
    if (d._stageExplicit) explicitStageIds.push(id);
  });

  // ── Bulk-insert donors (500/batch, one multi-row INSERT per batch) ──
  for (let bi = 0; bi < donorsToInsert.length; bi += DONOR_BATCH) {
    const batch = donorsToInsert.slice(bi, bi + DONOR_BATCH);
    const params = [];
    const tuples = batch.map(d => {
      const a = resolveAssignee(d);
      params.push(
        d._id, orgId, normalizeName(d.name), d.email||"", d.phone||"",
        d.status||"new", d.stage||"prospect",
        Math.round(parseFloat(d.total)||0), Math.round(parseFloat(d.lastAmount)||0),
        d.lastGift||null, parseInt(d.gifts)||(d.total?1:0),
        JSON.stringify(Array.isArray(d.tags)?d.tags:[]),
        d.notes||"", d.city||null, d.state||null,
        a.id, a.name,   // assigned_to / assigned_to_name — Team owner-column routing.
        // Assignment IS board membership (BUILD-30): no separate in_pipeline flag.
        a.pendingInviteId, a.pendingName   // pending assignment held for an invited-but-not-accepted officer
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });
    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO donors
             (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
              last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name,
              pending_assignee_invite_id,pending_assignee_name)
           VALUES ${tuples.join(",")}`,
          params
        );
      });
      created += batch.length;
    } catch (e) {
      console.error(`[combined-import] donor batch ${bi}–${bi+batch.length} failed:`, e.message);
      batchErrors.push({ rows:`${bi+1}–${bi+batch.length}`, error:e.message });
      batch.forEach(d => failedIds.add(d._id));
    }
  }
  }); // end withAdvisoryLock(import:orgId) — donor dedup+insert now atomic per org

  // ── Build gift+interaction records ──
  // Filter to gifts whose donor was actually inserted (not deduped or batch-failed).
  // §1.2 F-4 — (donor, amount, date) is NEVER a dedup key: forty $100 Sunday
  // gifts in a transaction export are forty gifts, and the old silent collapse
  // here dropped 39 of them. The ONLY gift-level dedup is an explicit
  // external-ID column from the source system (unique per org at the DB —
  // uq_gifts_external — so a re-run with IDs is also cross-run idempotent).
  // Same-(donor,amount,date) twins WITHOUT an external ID are all inserted and
  // COUNTED into duplicateCandidates so a human can review the report — never
  // silently collapsed.
  const seenExternalIds = new Set(); // within-file external-ID dedup
  const fpCounts = new Map();        // informational twin report, NOT a filter
  const giftsToInsert = [];
  let externalIdDupes = 0;
  for (const g of gifts) {
    const donorId = indexToId[g.donorIndex];
    if (!donorId || failedIds.has(donorId)) continue;
    const amt  = Math.round(Number(g.amount) || 0);
    if (amt <= 0) continue;
    const date = normalizeGiftDate(g.date);
    const externalId = (g.externalId || g.external_id || "").toString().trim().slice(0, 128) || null;
    if (externalId) {
      if (seenExternalIds.has(externalId)) { externalIdDupes++; continue; }
      seenExternalIds.add(externalId);
    } else {
      const fp = `${donorId}|${amt}|${date}`;
      fpCounts.set(fp, (fpCounts.get(fp) || 0) + 1);
    }
    giftsToInsert.push({ donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", notes:g.notes||"", externalId });
  }
  const duplicateCandidates = {
    withinFile: [...fpCounts.values()].filter(n => n > 1).reduce((s, n) => s + (n - 1), 0),
    samples: [...fpCounts.entries()].filter(([, n]) => n > 1).slice(0, 10)
      .map(([fp, n]) => { const [dId, amount, date] = fp.split("|"); return { donor: donorNameById(dId), amount: Number(amount), date, count: n }; }),
  };
  function donorNameById(dId) { const d = donorsToInsert.find(x => x._id === dId); return d ? String(d.name).trim() : dId; }

  // ── Finance sync setup (Gap 1) ───────────────────────────────────────────
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const _fyNow = new Date();
  const fyStart = _fyNow.getMonth() < 6
    ? new Date(_fyNow.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(_fyNow.getFullYear(), 6, 1).toISOString().split("T")[0];

  const [contribAcctRowsC, genFundRowsC] = await Promise.all([
    query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [orgId]),
    query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]),
  ]);
  const contribAcctId = contribAcctRowsC[0]?.id || null;
  const genFundId     = genFundRowsC[0]?.id     || null;
  // Donor names map: built from the already-prepared donorsToInsert list (no extra query)
  const donorNameMap = Object.fromEntries(donorsToInsert.map(d => [d._id, String(d.name).trim()]));

  // ── Bulk-insert gifts + interactions (200/batch, both in same transaction) ──
  const GIFT_BATCH = 200;
  let giftsInserted = 0, financeSynced = 0;
  const affectedDonorIds = new Set();

  for (let bi = 0; bi < giftsToInsert.length; bi += GIFT_BATCH) {
    const batch = giftsToInsert.slice(bi, bi + GIFT_BATCH);
    const giftParams = [], giftTuples = [];
    const rowByGid = new Map();
    batch.forEach(g => {
      const gid = "g_"+uuid().slice(0,8);
      rowByGid.set(gid, g);
      giftParams.push(gid, orgId, g.donorId, g.amount, g.date, g.type, g.campaign, null, g.notes, g.externalId || null);
      giftTuples.push("(?,?,?,?,?,?,?,?,?,?)");
      affectedDonorIds.add(g.donorId);
    });
    try {
      let keptCount = 0, ftCount = 0;
      await withTransaction(async (client) => {
        // F-4: the external-ID partial unique (uq_gifts_external) is the ONE
        // cross-run gift dedup — a re-imported file with source IDs is a
        // strict no-op at the DB. RETURNING tells us which rows genuinely
        // landed so interactions + ledger stamps are only written for those
        // (a skipped gift must not orphan an interaction or a ledger row).
        const kept = await queryTx(client,
          `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id,notes,external_id)
           VALUES ${giftTuples.join(",")}
           ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
           RETURNING id`,
          giftParams
        );
        const intParams = [], intTuples = [], ftParams = [], ftTuples = [];
        for (const r of kept) {
          const g = rowByGid.get(r.id);
          if (!g) continue;
          const intNote = `Gift received: $${g.amount.toLocaleString()} (${g.type})${g.notes?" — "+g.notes:""}`;
          intParams.push("int_"+uuid().slice(0,8), orgId, g.donorId, "gift", intNote, g.date, importerId, importerName);
          intTuples.push("(?,?,?,?,?,?,?,?)");
          // Accumulate fin_transactions for current-FY gifts — same shape as single-gift
          // route, carrying gift_id so the stamp is idempotent (BUILD-21 Part 3).
          if (contribAcctId && g.date >= fyStart) {
            const dName = donorNameMap[g.donorId] || "Donor";
            ftParams.push("ft_"+uuid().slice(0,8), orgId, g.date,
              `Gift from ${dName}`, dName, g.amount, "income", contribAcctId, genFundId, g.donorId, "import", r.id);
            ftTuples.push("(?,?,?,?,?,?,?,?,?,?,?,?)");
          }
        }
        if (intTuples.length) {
          await runTx(client,
            `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ${intTuples.join(",")}`,
            intParams
          );
        }
        // One bulk INSERT for FY fin_transactions — same tx as gifts, rolls back together
        if (ftTuples.length) {
          await runTx(client,
            `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id)
             VALUES ${ftTuples.join(",")} ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
            ftParams
          );
        }
        keptCount = kept.length; ftCount = ftTuples.length;
      });
      giftsInserted += keptCount;
      financeSynced += ftCount;
    } catch (e) {
      console.error(`[combined-import] gift batch ${bi}–${bi+batch.length} failed:`, e.message);
      batchErrors.push({ error: e.message });
    }
  }

  // Recalc every donor that had gifts inserted — ONE set-based query (import
  // hang fix), not a per-donor loop.
  if (affectedDonorIds.size) {
    try { await recalcDonorSummaryBatch([...affectedDonorIds], orgId); }
    catch (e) { console.error(`[combined-import] batch recalc failed:`, e.message); }
  }

  // Gap 2: Promote donor status — same thresholds as single-gift route
  // (total_giving > 20000 → 'major', > 5000 → 'mid', ELSE keep existing)
  // Runs after recalcDonorSummary so total_giving is accurate before promotion.
  if (affectedDonorIds.size > 0) {
    try {
      await run(
        `UPDATE donors
         SET status = CASE
           WHEN total_giving > 20000 THEN 'major'
           WHEN total_giving > 5000  THEN 'mid'
           ELSE status
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`,
        [orgId, [...affectedDonorIds]]
      );
    } catch (e) { console.error(`[combined-import] status promotion failed:`, e.message); }
  }

  // Infer pipeline stage from recalculated giving data — the authoritative
  // inference happens HERE (after gifts load + totals recalc), not on the client
  // guess, so a wide file with year-column gifts but no total/last-gift column is
  // still staged correctly. An EXPLICIT stage column in the file always wins:
  // donors flagged `_stageExplicit` are excluded so their mapped stage survives.
  // SQL mirrors client-side inferStage() exactly, including its qualify/solicit
  // bands — see Donors.jsx's inferStage for the reasoning (a donor with no gift
  // history but an email/phone on file gets a reachable path to 'qualify'; a
  // substantial gift 90-180 days ago reads as 'solicit' rather than folding into
  // the generic 'cultivate' bucket).
  if (affectedDonorIds.size > 0) {
    try {
      const stageParams = [orgId, [...affectedDonorIds]];
      let excludeClause = "";
      if (explicitStageIds.length) { excludeClause = " AND id <> ALL(?)"; stageParams.push(explicitStageIds); }
      await run(
        `UPDATE donors
         SET stage = CASE
           WHEN total_giving = 0 AND last_gift_date IS NULL
                AND (COALESCE(email,'') != '' OR COALESCE(phone,'') != '') THEN 'qualify'
           WHEN total_giving = 0 AND last_gift_date IS NULL            THEN 'prospect'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) > 365        THEN 'lapsed'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) < 90
                AND total_giving > 0                                   THEN 'steward'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) BETWEEN 90 AND 180
                AND total_giving >= 1000                                THEN 'solicit'
           WHEN total_giving > 0                                        THEN 'cultivate'
           ELSE 'prospect'
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?)${excludeClause}
           AND deleted_at IS NULL`,
        stageParams
      );
    } catch (e) { console.error(`[combined-import] stage inference failed:`, e.message); }
  }

  res.json({ created, giftsInserted, duplicates, donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors,
             duplicateCandidates, externalIdDupes });
}));

app.put("/donors/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, email, phone, status, stage, tags, notes, city, state, zip, employer } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const affected = await run(
    `UPDATE donors SET name=?,email=?,phone=?,status=?,stage=?,tags=?,notes=?,city=?,state=?,zip=?,employer=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, email || "", phone || "", status, stage || "cultivate", JSON.stringify(tags || []), notes || "",
     city || null, state || null, zip || null, employer || null,
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });

  const rows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  const d = rows[0];
  d.tags = JSON.parse(d.tags || "[]");
  d.matching_gift = lookupMatchingGift(d.employer);
  res.json(d);
}));

// Managed-stage changes are a Team (major-gifts) capability — the pipeline is
// purely Team (BUILD-19; donor-profile Core/Team split FIX). Core sees stage
// read-only; changing it (single or bulk) requires the Team plan. This
// reverses the earlier "per-donor stage dropdown is Core-fine" note.
app.patch("/donors/:id/stage", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
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
       `Stage moved from ${oldStage} → ${stage}`,
       new Date().toISOString().split("T")[0], req.user.userId, userName]
    );
  } catch(e) { console.error("Stage change log:", e.message); }

  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.json({ success: true, stage });
}));

// Soft delete — same trash model as POST /donors/bulk-delete. A hard DELETE
// here threw FK violations for any donor with gifts/interactions/etc.;
// permanent deletion is POST /donors/purge-trash's job (FK-safe child order).
app.delete("/donors/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const result = await run(
    "UPDATE donors SET deleted_at=NOW() WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.id, req.user.orgId]
  );
  if (!result.changes) return res.status(404).json({ error: "Donor not found" });
  res.json({ success: true });
}));

app.patch("/donors/:id/assign", requireAuth, requireAdmin, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const { assignedTo, assignedToName } = req.body;
  // Assignment IS pipeline membership (BUILD-30): assigning an officer puts the
  // donor in that officer's portfolio AND on their board immediately; unassigning
  // (assignedTo null) removes them from the board and back to the Directory only.
  const affected = await run(
    `UPDATE donors SET assigned_to=?, assigned_to_name=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [assignedTo || null, assignedToName || null, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  res.json({ success: true });
}));

// ── Bulk donor operations ──────────────────────────────────────────────────
// Future: restore-from-trash view + permanent-purge scheduled job can be
// built on deleted_at — the column is stable and org-scoped.

app.patch("/donors/bulk-stage", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
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

app.patch("/donors/bulk-assign", requireAuth, requireAdmin, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
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

  const userRow = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [assignedTo, req.user.orgId]);
  if (!userRow.length) return res.status(400).json({ error: "User not found in your org" });
  const assignedToName = userRow[0].name;

  // Bulk-assigning to an officer puts the batch in that officer's portfolio AND
  // on their board — assignment IS membership (BUILD-30), no separate flag. Any
  // prior pending-invite hold is cleared.
  const result = await run(
    `UPDATE donors SET assigned_to=?, assigned_to_name=?,
       pending_assignee_invite_id=NULL, pending_assignee_name=NULL, updated_at=NOW()
     WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [assignedTo, assignedToName, ids, req.user.orgId]);
  res.json({ updated: result.changes, assignedToName });
}));

app.post("/donors/bulk-delete", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  const result = await run(
    "UPDATE donors SET deleted_at=NOW() WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  res.json({ deleted: result.changes });
}));

// The "permanent-purge" the comment above bulk-delete anticipated: hard-
// deletes every trashed (deleted_at IS NOT NULL) donor in the org, plus all
// rows that exist only because those donors did — child tables first, in
// FK-safe order (same convention as DELETE /admin/orgs/:id). Volunteers are
// deliberately NOT deleted: a volunteer who was linked to a purged donor
// keeps their own row, just unlinked. event_attendees keep the attendance
// record with the donor link nulled (ON DELETE SET NULL); donor_relationships
// and campaign_recipients clean themselves up (ON DELETE CASCADE). One
// transaction — a mid-purge failure leaves nothing half-deleted. Admin-only;
// like all DELETE-shaped routes, never checkWriteAccess-gated (a lapsed org
// can still empty its trash).
app.post("/donors/purge-trash", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const trashed = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NOT NULL", [orgId]);
  const ids = trashed.map(r => r.id);
  if (!ids.length) return res.json({ purged: 0, children: {} });

  // receipts/pledges first (they FK both donors AND gifts), then the rest of
  // the donor-scoped children, then gifts, then the donors themselves.
  // fin_transactions is deliberately absent: it has no donor_id column (only
  // a vendor_donor text name — the CLAUDE.md claim of a donor_id there was
  // stale), and it's org bookkeeping history either way.
  const CHILD_TABLES = [
    "receipts", "pledges", "milestone_drafts", "note_reminders", "donor_materials",
    "planned_gifts", "custom_field_values", "sequence_enrollments",
    "payment_recovery_events", "recurring_subscriptions",
    "tasks", "interactions", "gifts",
  ];
  const { purged, children } = await withTransaction(async (client) => {
    await runTx(client, "UPDATE volunteers SET donor_id=NULL WHERE org_id=? AND donor_id = ANY(?)", [orgId, ids]);
    const children = {};
    for (const t of CHILD_TABLES) {
      const r = await runTx(client, `DELETE FROM ${t} WHERE org_id=? AND donor_id = ANY(?)`, [orgId, ids]);
      if (r.changes) children[t] = r.changes;
    }
    const d = await runTx(client, "DELETE FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, ids]);
    return { purged: d.changes, children };
  });
  res.json({ purged, children });
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
  const { primaryId, secondaryId } = req.body;
  const orgId = req.user.orgId;
  if (!primaryId || !secondaryId) return res.status(400).json({ error: "primaryId and secondaryId required" });
  if (primaryId === secondaryId) return res.status(400).json({ error: "Cannot merge a donor into itself" });

  const rows = await query("SELECT * FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [orgId, [primaryId, secondaryId]]);
  const primary = rows.find(d => d.id === primaryId);
  const secondary = rows.find(d => d.id === secondaryId);
  if (!primary || !secondary) return res.status(404).json({ error: "Donor not found" });

  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const userName = userRow[0]?.name || "";
  const today = new Date().toISOString().split("T")[0];

  // Straight donor_id reassigns — no unique constraint on donor_id in these.
  const PLAIN_CHILD_TABLES = [
    "gifts", "interactions", "pledges", "receipts", "milestone_drafts",
    "note_reminders", "donor_materials", "planned_gifts",
    "payment_recovery_events", "recurring_subscriptions", "tasks",
    "volunteers", "campaign_recipients",
  ];
  // UNIQUE(x, donor_id) tables: the primary's own row wins a conflict, the
  // secondary's duplicate is dropped, non-conflicting rows are reassigned.
  const UNIQUE_CHILD_TABLES = [
    ["custom_field_values", "field_id"],
    ["sequence_enrollments", "sequence_id"],
    ["event_attendees", "event_id"],
  ];

  const reassigned = {};
  await withTransaction(async (client) => {
    for (const t of PLAIN_CHILD_TABLES) {
      const r = await runTx(client, `UPDATE ${t} SET donor_id=? WHERE org_id=? AND donor_id=?`, [primaryId, orgId, secondaryId]);
      if (r.changes) reassigned[t] = r.changes;
    }
    for (const [t, keyCol] of UNIQUE_CHILD_TABLES) {
      await runTx(client,
        `DELETE FROM ${t} WHERE org_id=? AND donor_id=? AND ${keyCol} IN
           (SELECT ${keyCol} FROM ${t} WHERE org_id=? AND donor_id=?)`,
        [orgId, secondaryId, orgId, primaryId]);
      const r = await runTx(client, `UPDATE ${t} SET donor_id=? WHERE org_id=? AND donor_id=?`, [primaryId, orgId, secondaryId]);
      if (r.changes) reassigned[t] = r.changes;
    }
    // Relationships: both sides, then drop any now-self-referencing row.
    await runTx(client, "UPDATE donor_relationships SET donor_id_a=? WHERE org_id=? AND donor_id_a=?", [primaryId, orgId, secondaryId]);
    await runTx(client, "UPDATE donor_relationships SET donor_id_b=? WHERE org_id=? AND donor_id_b=?", [primaryId, orgId, secondaryId]);
    await runTx(client, "DELETE FROM donor_relationships WHERE org_id=? AND donor_id_a=donor_id_b", [orgId]);

    // Fill the primary's blanks from the secondary (never overwrite a
    // non-empty primary value — the officer chose the primary for a reason).
    const FILL_FIELDS = [
      "email", "phone", "city", "state", "zip", "country", "employer",
      "assigned_to", "assigned_to_name", "notes",
      "stripe_customer_id", "stripe_subscription_id", "stripe_subscription_status",
      "wealth_score", "capacity_tier", "score_confidence", "score_last_updated", "score_rationale",
      "first_gift_date",
    ];
    const sets = [], vals = [];
    for (const f of FILL_FIELDS) {
      const pv = primary[f], sv = secondary[f];
      if ((pv === null || pv === undefined || pv === "") && sv !== null && sv !== undefined && sv !== "") {
        sets.push(`${f}=?`); vals.push(sv);
      }
    }
    const parseTags = v => { try { const t = typeof v === "string" ? JSON.parse(v || "[]") : v; return Array.isArray(t) ? t : []; } catch { return []; } };
    const pTags = parseTags(primary.tags), sTags = parseTags(secondary.tags);
    const unionTags = [...new Set([...pTags, ...sTags])];
    if (unionTags.length > pTags.length) { sets.push("tags=?"); vals.push(JSON.stringify(unionTags)); }
    if (!primary.planned_giving && secondary.planned_giving) { sets.push("planned_giving=?"); vals.push(true); }
    if (sets.length) await runTx(client, `UPDATE donors SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...vals, primaryId, orgId]);

    // Soft-delete the secondary — recoverable via trash until purge, like
    // bulk-delete. Hard deletion stays purge-trash's job.
    await runTx(client, "UPDATE donors SET deleted_at=NOW() WHERE id=? AND org_id=?", [secondaryId, orgId]);

    const movedSummary = Object.entries(reassigned).map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`).join(", ") || "no linked records";
    await runTx(client,
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_" + uuid().slice(0, 8), orgId, primaryId, "note",
       `Merged duplicate record "${secondary.name}"${secondary.email ? ` <${secondary.email}>` : ""} into this record (${movedSummary} reassigned).`,
       today, req.user.userId, userName]);
  });

  await recalcDonorSummary(primaryId, orgId);
  res.json({ merged: true, primaryId, secondaryId, reassigned });
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
     date || new Date().toISOString().split("T")[0], req.user.userId,
     userName, metadata ? JSON.stringify(metadata) : null]
  );
  const rows = await query("SELECT * FROM interactions WHERE id = ?", [id]);
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.status(201).json(rows[0]);
}));

// DELETE /interactions/:id — remove a mis-logged touchpoint. Per convention,
// DELETE routes get no checkWriteAccess. Gmail-synced rows are deliberately
// deletable too: the message id is recorded in gmail_sync_exclusions first so
// syncGmail's dedup step doesn't re-insert the same message on its next pass.
app.delete("/interactions/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT id, metadata FROM interactions WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Interaction not found" });

  const meta = typeof rows[0].metadata === "string"
    ? JSON.parse(rows[0].metadata || "null")
    : rows[0].metadata;
  if (meta?.gmail_message_id) {
    await run(
      "INSERT INTO gmail_sync_exclusions (id, org_id, gmail_message_id) VALUES (?,?,?) ON CONFLICT (org_id, gmail_message_id) DO NOTHING",
      ["gse_" + uuid().slice(0, 8), req.user.orgId, meta.gmail_message_id]
    );
  }

  const result = await run(
    "DELETE FROM interactions WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!result.changes) return res.status(404).json({ error: "Interaction not found" });
  res.json({ deleted: result.changes });
}));

// ── Gifts ──────────────────────────────────────────────────────────────────
// §1.2 F-5 — the ONE pledge-payment reconciler. Paid = Σ gifts linked by
// gifts.pledge_id (derived, never a stored counter — race-safe: two parallel
// payments both recompute and converge on the same SUM). Fulfills only when
// paid ≥ pledge amount; a partial payment leaves the pledge OPEN with an
// honest remaining balance. Reopens a fulfilled pledge whose payments fell
// back below the amount (gift deleted/refunded/shrunk). Canceled pledges are
// never resurrected. Returns {paid, balance} or null.
async function recalcPledgePayment(pledgeId, orgId) {
  const rows = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!rows.length) return null;
  const p = rows[0];
  const paidRows = await query(
    "SELECT COALESCE(SUM(amount),0) AS paid FROM gifts WHERE pledge_id=? AND org_id=?",
    [pledgeId, orgId]);
  const paid = parseFloat(paidRows[0].paid) || 0;
  const amount = parseFloat(p.amount) || 0;
  if (paid >= amount && amount > 0) {
    const lastGift = await query(
      "SELECT id FROM gifts WHERE pledge_id=? AND org_id=? ORDER BY date DESC, id DESC LIMIT 1",
      [pledgeId, orgId]);
    await run(
      `UPDATE pledges SET status='fulfilled', fulfilled_gift_id=?, fulfilled_at=COALESCE(fulfilled_at, NOW()),
              next_reminder_at=NULL, updated_at=NOW()
       WHERE id=? AND org_id=? AND status IN ('open','fulfilled')`,
      [lastGift[0]?.id || null, pledgeId, orgId]);
  } else {
    await run(
      `UPDATE pledges SET status=CASE WHEN status='fulfilled' THEN 'open' ELSE status END,
              fulfilled_gift_id=NULL, fulfilled_at=NULL, updated_at=NOW()
       WHERE id=? AND org_id=?`,
      [pledgeId, orgId]);
  }
  return { paid, balance: Math.max(0, amount - paid) };
}

// Reusable "open pledges with honest remaining balances" aggregate — remaining
// = amount − paid, so a partially-paid pledge counts only what is still
// committed-but-unpaid (F-5). Every "pledged" figure reads this, not SUM(amount).
const OPEN_PLEDGE_REMAINING_JOIN = `
  LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pledge_paid
    ON pledge_paid.pledge_id = pledges.id`;

app.post("/donors/:id/gifts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, pledgeId } = req.body;
  // Accept both spellings for back-compat: the touchpoint modal sends `fundId`,
  // the Add-Gift form sends `fund_id`. Same for the campaign reference.
  const fundId = req.body.fundId || req.body.fund_id || null;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
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

  // Optional: this gift fulfills a specific open pledge — the "gift
  // recorded against it" stop condition (see processPledgeReminders()).
  // Validated up front so a stale/foreign pledgeId 400s before any insert.
  let pledgeRow = null;
  if (pledgeId) {
    const pledgeRows = await query(
      "SELECT * FROM pledges WHERE id=? AND donor_id=? AND org_id=? AND status='open'",
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
    const camp = await query("SELECT id, name FROM campaigns WHERE id=? AND org_id=?", [effectiveCampaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
    campaignName = camp[0].name;
  }

  const giftId = "g_" + uuid().slice(0, 8);
  const giftDate = normalizeGiftDate(date);              // enforce ISO YYYY-MM-DD
  const amt = Math.round(Number(amount));                // round, not truncate; INTEGER column

  // §1.1 F-3 — client-generated idempotency key, enforced by uq_gifts_idem at
  // the DATABASE (not an app-layer check). A double-tapped Save, a replayed
  // request, or 50 parallel identical submits produce exactly one gift row;
  // every replay returns the original gift with duplicate:true and runs ZERO
  // side effects (no donor delta, no ledger stamp, no interaction, no
  // workflow fire, no pledge application).
  const idemKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 128) : null;

  const insertedRows = await query(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id,notes,fund_id,pledge_id,idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [giftId, req.user.orgId, req.params.id, amt, giftDate, type || "cash", campaignName || "",
     effectiveCampaignId || null, notes || "", fundId || null, pledgeRow ? pledgeRow.id : null, idemKey]
  );
  if (!insertedRows.length) {
    const dupGift = await query("SELECT * FROM gifts WHERE org_id=? AND idempotency_key=?", [req.user.orgId, idemKey]);
    const dupDonor = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    return res.status(200).json({ gift: dupGift[0] || null, donor: dupDonor[0] || null, duplicate: true });
  }
  if (pledgeRow) {
    // §1.2 F-5 — apply the PAID amount against the pledge balance; a partial
    // payment leaves the pledge open with an honest remaining balance.
    await recalcPledgePayment(pledgeRow.id, req.user.orgId);
  }
  // Delta kept here (correct for a fresh gift) so status tier promotion fires.
  // PUT/DELETE use recalcDonorSummary instead — see those routes.
  await run(
    `UPDATE donors
     SET total_giving     = total_giving + ?,
         last_gift_amount = ?,
         last_gift_date   = CASE WHEN last_gift_date IS NULL OR ? >= last_gift_date THEN ? ELSE last_gift_date END,
         gift_count       = gift_count + 1,
         status           = CASE
           WHEN total_giving + ? > 20000 THEN 'major'
           WHEN total_giving + ? > 5000  THEN 'mid'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = ?`,
    [amt, amt, giftDate, giftDate, amt, amt, req.params.id]
  );

  const giftRows  = await query("SELECT * FROM gifts  WHERE id = ?", [giftId]);
  const donorRows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  // Auto-sync gift to Finance ledger
  try {
    const [contribAcct, genFund] = await Promise.all([
      query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [req.user.orgId]),
      query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [req.user.orgId]),
    ]);
    // The gift's own fund (if the officer chose one) wins; otherwise the general
    // unrestricted fund. ON CONFLICT makes the stamp idempotent per gift.
    const stampFund = fundId || (genFund.length ? genFund[0].id : null);
    if (contribAcct.length) {
      await run(
        "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING",
        ["ft_"+uuid().slice(0,8), req.user.orgId, giftDate,
         `Gift from ${donorRows[0]?.name || "Donor"}`, donorRows[0]?.name || "",
         amt, "income", contribAcct[0].id, stampFund, req.params.id, "gift", giftId]
      );
    }
  } catch(e) { console.error("Finance sync:", e.message); }
  // Log gift interaction
  try {
    const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const userName = userRow[0]?.name || "";
    const fundNote = type || "cash";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_"+uuid().slice(0,8), req.user.orgId, req.params.id, "gift",
       `Gift received: $${amt.toLocaleString()} (${fundNote})${notes ? " — " + notes : ""}`,
       giftDate, req.user.userId, userName]
    );
  } catch(e) { console.error("Gift interaction log:", e.message); }
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
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance
     FROM pledges p
     LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id=? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp
       ON pp.pledge_id = p.id
     WHERE p.id=?`, [req.user.orgId, pledgeRow.id]) : [];
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0], pledge: fulfilledPledgeRows[0] || null });
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
      const camp = await query("SELECT id, name FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
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
  const newAmt  = amount !== undefined ? Math.round(Number(amount)) : g.amount; // round, not truncate
  const newDate = date ? normalizeGiftDate(date) : g.date;                       // enforce ISO
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
      `UPDATE gifts SET amount=?,date=?,type=?,campaign=?,campaign_id=?,notes=?,fund_id=?,payment_method=?,acknowledgement_sent=? WHERE id=? AND org_id=?`,
      [newAmt, newDate, type||g.type, newCampaign, newCampaignId,
       notes!==undefined?notes:g.notes, fund_id!==undefined?fund_id:g.fund_id,
       payment_method!==undefined?payment_method:g.payment_method,
       acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,
       req.params.id, req.user.orgId]
    );
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
      [newAmt, newDate, fund_id !== undefined ? fund_id : null, req.params.id, req.user.orgId]
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
    await runTx(client, "DELETE FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  });
  // Full recalc: old delta left last_gift_date and last_gift_amount stale when deleting the most recent gift
  await recalcDonorSummary(g.donor_id, req.user.orgId);
  // F-5: this gift may have been paying down a pledge — recompute honestly
  // (reopens only if remaining payments no longer cover the pledge amount).
  if (g.pledge_id) await recalcPledgePayment(g.pledge_id, req.user.orgId);
  }); // end withAdvisoryLock(gift:…) — delete + recalc serialized per gift
  res.json({ ok: true });
}));

// ── Pledges ──────────────────────────────────────────────────────────────
// A donor's promise to give $X by a future date — separate from `gifts`
// (money already received) and `planned_gifts` (bequests/trusts, no due
// date). See db.js's pledges comment. The reminder cadence that fires
// against these (processPledgeReminders, below) deliberately mirrors the
// recurring-gift dunning engine's architecture.
app.get("/donors/:id/pledges", requireAuth, wrap(async (req, res) => {
  // F-5: every pledge read carries the honest paid/balance figures, derived
  // live from linked payment gifts — never a stored counter.
  const rows = await query(
    `SELECT p.*, COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance
     FROM pledges p
     LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id=? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id=p.id
     WHERE p.donor_id=? AND p.org_id=? ORDER BY p.due_date ASC`,
    [req.user.orgId, req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

app.post("/donors/:id/pledges", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, dueDate, notes } = req.body;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }
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

  const id = "pl_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id) VALUES (?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, Math.round(Number(amount)), dueDate, notes || "", campaignId]
  );
  const rows = await query("SELECT * FROM pledges WHERE id=?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/pledges/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Pledge not found" });
  const p = existing[0];
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

  // Marking fulfilled/written_off (manually, with no specific gift to link —
  // see POST /donors/:id/gifts' pledgeId param for the "linked a gift"
  // path) is the same stop condition either way: clear the cadence so
  // processPledgeReminders() has nothing left to send.
  const validStatuses = ["open", "fulfilled", "written_off"];
  const newStatus = status && validStatuses.includes(status) ? status : p.status;
  const stopping = newStatus !== "open" && p.status === "open";
  const nowFulfilled = newStatus === "fulfilled" && p.status !== "fulfilled";

  await run(
    `UPDATE pledges SET amount=?, due_date=?, notes=?, status=?, campaign_id=?,
       fulfilled_at = CASE WHEN ? THEN NOW() ELSE fulfilled_at END,
       next_reminder_at = CASE WHEN ? THEN NULL ELSE next_reminder_at END,
       updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [
      amount !== undefined ? Math.round(Number(amount)) : p.amount,
      dueDate || p.due_date,
      notes !== undefined ? notes : p.notes,
      newStatus,
      newCampaignId,
      nowFulfilled,
      stopping,
      req.params.id, req.user.orgId,
    ]
  );
  const rows = await query("SELECT * FROM pledges WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/pledges/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM pledges WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ ok: true });
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
  return `${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;
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
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af").text(
        `${snapshot.orgLegalName} is a tax-exempt organization. EIN: ${snapshot.orgEin || "—"}. This receipt is provided for your tax records. Please retain it. No portion of this document constitutes tax advice.`,
        50, doc.page.height - 40, { width: PW - 100, height: 30, align: "left" }
      );
    }

    doc.end();
  });
}

async function sendReceiptEmail(org, donor, snapshot, pdfBuffer, filename) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
    // Subject names the artifact honestly (a year-end statement is not a
    // "donation receipt") and the cover carries the branded org header like
    // every other donor-facing email — both live-test findings, 2026-08-05.
    const artifact = snapshot.type === "year_end" ? "year-end giving statement" : "donation receipt";
    const subject = `Your ${artifact} from ${displayNameCase(org.name)}`;
    const html = await brandEmailHeaderHtml(org.id)
      + `<p>Hi ${escapeHtml(donor.name || "there")},</p>
      <p>Thank you for your generous gift to <strong>${escapeHtml(displayNameCase(org.name))}</strong> — your official ${snapshot.type === "year_end" ? "year-end giving statement" : "tax receipt"} is attached.</p>
      <p style="color:#8fa896;font-size:13px">Receipt #${escapeHtml(snapshot.receiptNumber)}</p>`;
    // Transactional (not a campaign/sequence send) — deliberately no
    // unsubscribe link/List-Unsubscribe headers, but still skips suppressed
    // addresses (below, before this is ever called) to protect the shared
    // stewardapp.dev sending domain's reputation.
    const { error } = await resend.emails.send({
      from, to: donor.email, subject, html,
      attachments: [{ filename, content: pdfBuffer }],
    });
    if (error) { console.error("[receipts] email send failed:", error.message || JSON.stringify(error)); return false; }
    return true;
  } catch (err) {
    console.error("[receipts] email send threw:", err.message);
    return false;
  }
}

// Single choke point for issuing a per-gift receipt — used by both the
// webhook (fire-and-forget) and the manual "Send receipt" route, so
// idempotency/suppression/sample-skip logic lives in exactly one place.
async function issueGiftReceipt(gift, org, donor, { send = true } = {}) {
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

  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: org.brand_accent || null,       // BUILD-13: branded receipt header
    orgAccentFg: org.brand_accent_fg || null,
    orgLogo: org.logo_data || null,
    orgEin: org.ein || "",
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    receiptNumber,
    issueDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    donorName: donor.name,
    giftDate: gift.date ? new Date(gift.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "",
    giftDateRaw: gift.date || null, // ISO, alongside the display-formatted giftDate above — lets the /dashboard/today mismatch-detection query compare against gifts.date directly without reparsing a formatted string
    amount: parseFloat(gift.amount),
    deductibleAmount,
    paymentMethod: gift.payment_method || "",
    quidProQuoDesc: gift.quid_pro_quo_desc || null,
    quidProQuoValue: gift.quid_pro_quo_value != null ? parseFloat(gift.quid_pro_quo_value) : null,
  };

  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = "rcpt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, receipt_number, amount, deductible_amount, snapshot, pdf_data)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, gift.id, "gift", receiptNumber, snapshot.amount, deductibleAmount, JSON.stringify(snapshot), pdfBuffer.toString("base64")]
  );

  let emailSent = false;
  if (send && donor.email) {
    const suppressReason = await getSuppressionReason(donor.email, org.id);
    if (!suppressReason) {
      emailSent = await sendReceiptEmail(org, donor, snapshot, pdfBuffer, `receipt-${receiptNumber}.pdf`);
      if (emailSent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, id]);
    }
  }

  // acknowledgement_sent reflects "a written acknowledgment now exists for
  // this gift" (satisfying the IRS contemporaneous-acknowledgment
  // requirement the moment the PDF is generated), not "the email definitely
  // arrived" — even on a suppressed address or a failed send, the PDF is
  // stored and staff can download + mail it manually from DonorProfile.
  await run("UPDATE gifts SET acknowledgement_sent=true WHERE id=?", [gift.id]);

  const rows = await query("SELECT * FROM receipts WHERE id=?", [id]);
  return { receipt: rows[0], created: true, emailSent };
}

// Re-sends the exact already-issued PDF (never regenerates) — used by
// POST /gifts/:id/receipt?resend and POST /donors/:id/receipts (manual
// resend from DonorProfile), so a resend is always byte-identical to what
// was originally issued.
async function resendReceiptEmail(receipt, org, donor) {
  if (!donor.email) return false;
  const suppressReason = await getSuppressionReason(donor.email, org.id);
  if (suppressReason) return false;
  const pdfBuffer = Buffer.from(receipt.pdf_data, "base64");
  const filename = receipt.type === "year_end" ? `${receipt.tax_year}-giving-statement.pdf` : `receipt-${receipt.receipt_number}.pdf`;
  const sent = await sendReceiptEmail(org, donor, receipt.snapshot, pdfBuffer, filename);
  if (sent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, receipt.id]);
  return sent;
}

// Aggregates a donor's calendar-year gifts into one consolidated statement.
// Supersedes (voids) any prior active statement for the same donor+year
// before inserting the new one, since the partial-unique index only allows
// one active statement per (org_id, donor_id, tax_year).
async function issueYearEndStatement(org, donor, year, { send = true } = {}) {
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

  const lineItems = gifts.map(g => ({
    date: g.date ? new Date(g.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "",
    amount: parseFloat(g.amount),
    deductibleAmount: g.deductible_amount != null ? parseFloat(g.deductible_amount) : parseFloat(g.amount),
    paymentMethod: g.payment_method || "",
  }));
  const totalAmount = lineItems.reduce((s, i) => s + i.amount, 0);
  const totalDeductible = lineItems.reduce((s, i) => s + i.deductibleAmount, 0);

  const receiptNumber = await allocateReceiptNumber(org.id);
  const snapshot = {
    type: "year_end",
    orgLegalName: org.legal_name || org.name,
    orgAccent: org.brand_accent || null,       // BUILD-13: branded receipt header
    orgAccentFg: org.brand_accent_fg || null,
    orgLogo: org.logo_data || null,
    orgEin: org.ein || "",
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    receiptNumber,
    issueDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    donorName: donor.name,
    taxYear: year,
    lineItems, totalAmount, totalDeductible,
  };
  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = "rcpt_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, snapshot, pdf_data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, null, "year_end", year, receiptNumber, totalAmount, totalDeductible, JSON.stringify(snapshot), pdfBuffer.toString("base64")]
  );

  let emailSent = false;
  if (send && donor.email) {
    const suppressReason = await getSuppressionReason(donor.email, org.id);
    if (!suppressReason) {
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
  const fakeGiftDate = new Date().toISOString().slice(0, 10);
  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: org.brand_accent || null,       // BUILD-13: branded receipt header
    orgAccentFg: org.brand_accent_fg || null,
    orgLogo: org.logo_data || null,
    orgEin: org.ein || "XX-XXXXXXX",
    orgAddress: org.receipt_address || "123 Main St, Anytown, ST 00000",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, fakeDonor),
    receiptNumber: `${new Date().getFullYear()}-PREVIEW`,
    issueDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    donorName: fakeDonor.name,
    giftDate: new Date(fakeGiftDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
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
      const result = await issueYearEndStatement(org, donorRow, taxYear, { send: true });
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
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet — set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [gift.donor_id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const existingRows = await query("SELECT * FROM receipts WHERE gift_id=? AND voided_at IS NULL AND type='gift'", [gift.id]);
  if (existingRows.length) {
    if (req.query.resend !== undefined) {
      const emailSent = await resendReceiptEmail(existingRows[0], org, donor);
      const rows = await query("SELECT * FROM receipts WHERE id=?", [existingRows[0].id]);
      return res.json({ receipt: rows[0], emailSent, resent: true });
    }
    return res.status(409).json({ error: "This gift already has an active receipt.", receipt: existingRows[0] });
  }

  const result = await issueGiftReceipt(gift, org, donor, { send: true });
  if (result.skipped) return res.status(400).json({ error: `Could not issue receipt: ${result.skipped}` });
  res.status(201).json(result.receipt);
}));

// List for DonorProfile's Gifts & Pledges tab — no pdf_data in the list
// response (board_reports pattern), fetched separately via
// GET /receipts/:id/pdf only when actually downloading one.
app.get("/donors/:id/receipts", requireAuth, wrap(async (req, res) => {
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
  if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet — set it up in Settings first." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const result = await issueYearEndStatement(org, donor, taxYear, { send: send !== false });
  if (result.skipped) return res.status(400).json({ error: `No gifts found for ${taxYear}.` });
  res.status(201).json(result.receipt);
}));

// ── Gift history bulk import ───────────────────────────────────────────────
// Accepts pre-matched gifts (donorId already resolved by frontend) and inserts
// them transactionally, then recalcs each affected donor's summary. Deduplicates
// by exact (donor_id, amount, date) fingerprint so re-running is safe.
app.post("/gifts/import-history", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { gifts } = req.body;
  if (!Array.isArray(gifts) || !gifts.length)
    return res.status(400).json({ error: "gifts array required" });

  const orgId = req.user.orgId;

  // Validate all provided donorIds belong to this org
  const donorIds = [...new Set(gifts.map(g => g.donorId).filter(Boolean))];
  if (!donorIds.length)
    return res.status(400).json({ error: "All gifts must have a donorId" });

  const orgDonors = await query(
    "SELECT id FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL",
    [orgId, donorIds]
  );
  const validDonorIds = new Set(orgDonors.map(d => d.id));

  // §1.2 F-4 — (donor, amount, date) is NEVER a silent dedup key. The rules:
  //   · A row with an explicit external ID (source-system gift/transaction id)
  //     dedupes on THAT — within the file here, cross-run at the DB
  //     (uq_gifts_external, ON CONFLICT DO NOTHING below).
  //   · A row WITHOUT an external ID that matches an EXISTING gift on
  //     (donor, amount, date) is HELD for human review — returned in
  //     heldForReview, not inserted, never silently dropped. Re-submitting
  //     with includeDuplicates:true imports the held rows (the human decided).
  //   · Same-(donor,amount,date) twins WITHIN the file are all inserted
  //     (forty $100 Sunday gifts are forty gifts) and counted in
  //     duplicateCandidates.withinFile as an informational report.
  const includeDuplicates = req.body.includeDuplicates === true;
  const existingRows = await query(
    "SELECT donor_id, amount, date FROM gifts WHERE org_id = ? AND donor_id = ANY(?)",
    [orgId, donorIds]
  );
  const existingFps = new Set(existingRows.map(g => `${g.donor_id}|${Math.round(parseFloat(g.amount))}|${g.date}`));

  // Importer identity — used in interaction logged_by_name, same pattern as single-gift route
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";
  const importerId   = req.user.userId;

  let invalid = 0, externalIdDupes = 0;
  const seenExternalIds = new Set();
  const fileFpCounts = new Map();
  const heldForReview = [];
  const toInsert = [];
  for (const g of gifts) {
    if (!g.donorId || !validDonorIds.has(g.donorId)) { invalid++; continue; }
    const amt = Math.round(Number(g.amount) || 0);
    if (amt <= 0) { invalid++; continue; }
    const date = normalizeGiftDate(g.date);
    const externalId = (g.externalId || g.external_id || "").toString().trim().slice(0, 128) || null;
    if (externalId) {
      if (seenExternalIds.has(externalId)) { externalIdDupes++; continue; }
      seenExternalIds.add(externalId);
    } else {
      const fp = `${g.donorId}|${amt}|${date}`;
      if (existingFps.has(fp) && !includeDuplicates) {
        heldForReview.push({ donorId: g.donorId, amount: amt, date, type: g.type || "cash", notes: g.notes || "" });
        continue;
      }
      fileFpCounts.set(fp, (fileFpCounts.get(fp) || 0) + 1);
    }
    toInsert.push({ donorId:g.donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", fund_id:g.fund_id||null, notes:g.notes||"", externalId });
  }
  const duplicateCandidates = {
    withinFile: [...fileFpCounts.values()].filter(n => n > 1).reduce((s, n) => s + (n - 1), 0),
  };

  // ── Finance sync setup (Gap 1) ───────────────────────────────────────────
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const _fyNow = new Date();
  const fyStart = _fyNow.getMonth() < 6
    ? new Date(_fyNow.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(_fyNow.getFullYear(), 6, 1).toISOString().split("T")[0];

  // Donor names needed for fin_transactions description / vendor_donor (bulk, one query)
  const dnRows = await query(
    "SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?)",
    [orgId, donorIds]
  );
  const donorNameMap = Object.fromEntries(dnRows.map(d => [d.id, d.name]));

  // Same account + fund the single-gift route uses
  const [contribAcctRowsH, genFundRowsH] = await Promise.all([
    query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [orgId]),
    query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]),
  ]);
  const contribAcctId = contribAcctRowsH[0]?.id || null;
  const genFundId     = genFundRowsH[0]?.id     || null;

  const BATCH = 200;
  let inserted = 0, financeSynced = 0;
  const affectedDonorIds = new Set();
  const batchErrors = [];

  for (let bi = 0; bi < toInsert.length; bi += BATCH) {
    const batch = toInsert.slice(bi, bi + BATCH);
    const ftParams = [], ftTuples = []; // fin_transactions rows for current-FY gifts in this batch
    let keptInBatch = 0;
    try {
      await withTransaction(async (client) => {
        for (const g of batch) {
          const id = "g_" + uuid().slice(0, 8);
          // F-4: external-ID rows are cross-run idempotent at the DB — a
          // conflicted (already-imported) row inserts nothing, and its
          // interaction + ledger stamp are skipped with it.
          const kept = await queryTx(client,
            `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id,notes,external_id) VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
            [id, orgId, g.donorId, g.amount, g.date, g.type, g.campaign, g.fund_id, g.notes, g.externalId || null]
          );
          if (!kept.length) { externalIdDupes++; continue; }
          keptInBatch++;
          const intNote = `Gift received: $${g.amount.toLocaleString()} (${g.type})${g.notes ? " — " + g.notes : ""}`;
          await runTx(client,
            "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
            ["int_"+uuid().slice(0,8), orgId, g.donorId, "gift", intNote, g.date, importerId, importerName]
          );
          affectedDonorIds.add(g.donorId);
          // Accumulate fin_transactions for current-FY gifts — same shape as single-gift
          // route, carrying gift_id so the stamp is idempotent (BUILD-21 Part 3).
          if (contribAcctId && g.date >= fyStart) {
            const dName = donorNameMap[g.donorId] || "Donor";
            ftParams.push("ft_"+uuid().slice(0,8), orgId, g.date,
              `Gift from ${dName}`, dName, g.amount, "income", contribAcctId, genFundId, g.donorId, "import", id);
            ftTuples.push("(?,?,?,?,?,?,?,?,?,?,?,?)");
          }
        }
        // One bulk INSERT for all FY fin_transactions in this batch — same tx as gifts
        if (ftTuples.length) {
          await runTx(client,
            `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id)
             VALUES ${ftTuples.join(",")} ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
            ftParams
          );
        }
      });
      inserted += keptInBatch;
      financeSynced += ftTuples.length;
    } catch (e) {
      console.error(`[gift-import] batch ${bi}–${bi+batch.length} failed:`, e.message);
      batchErrors.push({ error: e.message });
    }
  }

  // Recalc donor summaries — always full recalc from gifts table, never delta.
  // ONE set-based query (import hang fix), not a per-donor loop.
  if (affectedDonorIds.size) {
    try { await recalcDonorSummaryBatch([...affectedDonorIds], orgId); }
    catch (e) { console.error(`[gift-import] batch recalc failed:`, e.message); }
  }

  // Gap 2: Promote donor status — same thresholds as single-gift route
  // (total_giving > 20000 → 'major', > 5000 → 'mid', ELSE keep existing)
  // Runs after recalcDonorSummary so total_giving is accurate before promotion.
  if (affectedDonorIds.size > 0) {
    try {
      await run(
        `UPDATE donors
         SET status = CASE
           WHEN total_giving > 20000 THEN 'major'
           WHEN total_giving > 5000  THEN 'mid'
           ELSE status
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`,
        [orgId, [...affectedDonorIds]]
      );
    } catch (e) { console.error(`[gift-import] status promotion failed:`, e.message); }
  }

  // Infer pipeline stage — same logic as combined import (see its comment
  // for the qualify/solicit reasoning), same guardrail.
  if (affectedDonorIds.size > 0) {
    try {
      await run(
        `UPDATE donors
         SET stage = CASE
           WHEN total_giving = 0 AND last_gift_date IS NULL
                AND (COALESCE(email,'') != '' OR COALESCE(phone,'') != '') THEN 'qualify'
           WHEN total_giving = 0 AND last_gift_date IS NULL            THEN 'prospect'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) > 365        THEN 'lapsed'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) < 90
                AND total_giving > 0                                   THEN 'steward'
           WHEN last_gift_date IS NOT NULL
                AND (CURRENT_DATE - last_gift_date::date) BETWEEN 90 AND 180
                AND total_giving >= 1000                                THEN 'solicit'
           WHEN total_giving > 0                                        THEN 'cultivate'
           ELSE 'prospect'
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?)
           AND stage = 'prospect'
           AND deleted_at IS NULL`,
        [orgId, [...affectedDonorIds]]
      );
    } catch (e) { console.error(`[gift-import] stage inference failed:`, e.message); }
  }

  res.json({ inserted, duplicates: heldForReview.length + externalIdDupes, invalid,
             donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors,
             heldForReview, duplicateCandidates, externalIdDupes });
}));

app.get("/donors/:id/planned-gifts", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM planned_gifts WHERE donor_id=? AND org_id=? ORDER BY created_at DESC", [req.params.id, req.user.orgId]);
  res.json(rows);
}));

app.post("/donors/:id/planned-gifts", requireAuth, wrap(async (req, res) => {
  const { type, estimated_value, date_indicated, notes } = req.body;
  if (!type) return res.status(400).json({ error: "type required" });
  const donorCheck = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const id = "pg_" + uuid().slice(0,8);
  await run(
    "INSERT INTO planned_gifts (id,org_id,donor_id,type,estimated_value,date_indicated,notes) VALUES (?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type, estimated_value||null, date_indicated||null, notes||""]
  );
  if (!donorCheck[0].planned_giving) {
    await run("UPDATE donors SET planned_giving=true WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  }
  const rows = await query("SELECT * FROM planned_gifts WHERE id=?", [id]);
  // Log interaction
  try {
    const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const userName = userRow[0]?.name || "";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_"+uuid().slice(0,8), req.user.orgId, req.params.id, "planned_gift",
       `Planned gift indicated: ${type.replace(/_/g," ")}${estimated_value ? " (est. $" + Number(estimated_value).toLocaleString() + ")" : ""}`,
       new Date().toISOString().split("T")[0], req.user.userId, userName]
    );
  } catch(e) { console.error("Planned gift log:", e.message); }
  res.status(201).json(rows[0]);
}));

app.put("/planned-gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM planned_gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  const pg = existing[0];
  const { type, estimated_value, date_indicated, notes } = req.body;
  await run(
    "UPDATE planned_gifts SET type=?,estimated_value=?,date_indicated=?,notes=? WHERE id=? AND org_id=?",
    [type||pg.type, estimated_value!==undefined?estimated_value:pg.estimated_value,
     date_indicated!==undefined?date_indicated:pg.date_indicated, notes!==undefined?notes:pg.notes,
     req.params.id, req.user.orgId]
  );
  const rows = await query("SELECT * FROM planned_gifts WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/planned-gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM planned_gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM planned_gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.get("/donors/:id/materials", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT id,org_id,donor_id,file_name,file_type,file_url,notes,uploaded_by,uploaded_at FROM donor_materials WHERE donor_id=? AND org_id=? ORDER BY uploaded_at DESC", [req.params.id, req.user.orgId]);
  res.json(rows);
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
       new Date().toISOString().split("T")[0], req.user.userId, userRow[0]?.name||""]
    );
  } catch(e) { console.error("Material log:", e.message); }
  res.status(201).json(rows[0]);
}));

app.delete("/materials/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM donor_materials WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM donor_materials WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ ok: true });
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
  const combinedGiving = members.reduce((s, m) => s + (parseFloat(m.total_giving) || 0), 0);
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
      soft_credit: combinedGiving - (parseFloat(m.total_giving) || 0),
    })),
    member_count: members.length,
    combined_giving: combinedGiving,
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
     ORDER BY g.date DESC, g.id DESC LIMIT 200`, [req.params.id, req.user.orgId]);
  view.giving_history = gifts.map(g => ({ ...g, amount: parseFloat(g.amount) || 0 }));
  res.json(view);
}));

// Validate a proposed member set: all ids exist in this org, none already in
// a DIFFERENT household. Returns { error } (with status) or { ids, primary }.
async function validateHouseholdMembers(memberIds, primaryDonorId, orgId, allowHouseholdId) {
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds.filter(Boolean))] : [];
  if (ids.length < 2) return { status: 400, error: "A household needs at least two members." };
  const members = await query(
    "SELECT id, household_id FROM donors WHERE id = ANY(?) AND org_id=? AND deleted_at IS NULL",
    [ids, orgId]);
  if (members.length !== ids.length) return { status: 404, error: "One or more donors not found in this organization." };
  const foreign = members.find(m => m.household_id && m.household_id !== allowHouseholdId);
  if (foreign) return { status: 400, error: "A donor is already in another household." };
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
    await runTx(client, "INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment) VALUES (?,?,?,?,?)",
      [id, req.user.orgId, hhName, v.primary, jointAcknowledgment !== false]);
    await runTx(client, "UPDATE donors SET household_id=? WHERE id = ANY(?) AND org_id=?", [id, v.ids, req.user.orgId]);
  });
  res.status(201).json(await householdView(id, req.user.orgId));
}));

app.put("/households/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
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
  res.json(await householdView(req.params.id, req.user.orgId));
}));

app.delete("/households/:id", requireAuth, wrap(async (req, res) => {
  const hh = await query("SELECT id FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
  await withTransaction(async (client) => {
    await runTx(client, "UPDATE donors SET household_id=NULL WHERE household_id=? AND org_id=?", [req.params.id, req.user.orgId]);
    await runTx(client, "DELETE FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  });
  res.json({ ok: true });
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
    softCredit = householdCombined - hardCredit;
  }
  res.json({ donorId: d[0].id, householdId, hardCredit, softCredit, householdCombined });
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

// ── Officer portfolios + color (BUILD-14, Team plan) ───────────────────────
// Read is ungated (a Core org still sees its officers), but returns `tier` +
// `single_user` so the UI locks the color feature and hides it for a
// one-person shop. Assigning a color is Team-only and admin-gated.
app.get("/portfolio/officers", requireAuth, wrap(async (req, res) => {
  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";
  // portfolio_count/giving use the SAME definition as Home's cards + the board
  // (BUILD-30): assigned donors in a pipeline stage. The stage guard lives in the
  // JOIN so a non-pipeline-stage donor can't inflate the legend past the board.
  const officers = await query(
    `SELECT u.id, u.name, u.email, u.role, u.portfolio_color,
            COUNT(d.id)::int AS portfolio_count, COALESCE(SUM(d.total_giving),0) AS portfolio_giving
     FROM users u
     LEFT JOIN donors d ON d.assigned_to = u.id AND d.org_id = u.org_id AND d.deleted_at IS NULL AND d.stage = ANY(?)
     WHERE u.org_id=? GROUP BY u.id ORDER BY portfolio_giving DESC, u.name`, [ALL_PIPELINE_STAGES, req.user.orgId]);
  // Pending invitees (invited, not yet accepted, unexpired) are surfaced too so
  // the import officer-mapping screen can match + assign donors to them BEFORE
  // they accept (the assignment resolves into their portfolio on acceptance).
  // Includes each invite's held pending-donor count so the UI can show it.
  const invites = await query(
    `SELECT i.id, i.email,
            COUNT(d.id)::int AS pending_count
       FROM invites i
       LEFT JOIN donors d ON d.pending_assignee_invite_id = i.id AND d.org_id = i.org_id AND d.deleted_at IS NULL
      WHERE i.org_id=? AND i.accepted_at IS NULL AND i.expires_at > NOW()
      GROUP BY i.id, i.email ORDER BY i.created_at DESC`, [req.user.orgId]);
  res.json({
    tier,
    single_user: officers.length <= 1,
    officers: officers.map(o => ({
      ...o,
      portfolio_count: parseInt(o.portfolio_count, 10) || 0,
      portfolio_giving: parseFloat(o.portfolio_giving) || 0,
    })),
    invites: invites.map(i => ({ id: i.id, email: i.email, name: inviteeDisplayName(i.email), pending_count: parseInt(i.pending_count, 10) || 0 })),
  });
}));

app.put("/portfolio/officers/:userId/color", requireAuth, requireAdmin, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const { color } = req.body;
  if (color && !/^#[0-9a-fA-F]{6}$/.test(String(color))) return res.status(400).json({ error: "Color must be a 6-digit hex like #1a6b4a." });
  const u = await query("SELECT id FROM users WHERE id=? AND org_id=?", [req.params.userId, req.user.orgId]);
  if (!u.length) return res.status(404).json({ error: "Officer not found" });
  await run("UPDATE users SET portfolio_color=? WHERE id=? AND org_id=?", [color || null, req.params.userId, req.user.orgId]);
  res.json({ ok: true, userId: req.params.userId, color: color || null });
}));

// ── Moves management & prospect pipeline (BUILD-15, Team plan) ─────────────
// The whole pipeline is a staffed-office capability → Team. Reads return a
// `tier`/`locked` flag rather than 403'ing so a Core org renders a graceful
// "upgrade to manage a major-gifts pipeline" state, not a broken tab. Every
// WRITE (move, opportunity) is hard requirePlan('team') + checkWriteAccess.

// GET /pipeline — the board: prospects grouped by stage, officer color map,
// ask amount + stage age + next task per card, and the forecast. Batched
// queries only (no N+1). Optional ?assignedTo= (portfolio) and ?designation=.
app.get("/pipeline", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";
  const stages = ALL_PIPELINE_STAGES.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
  // Core orgs get a READ-only locked preview populated with their OWN data
  // (the board derives entirely from donors.stage / opportunities / moves /
  // tasks — all org-scoped reads a Core user already has). Writes stay hard-
  // gated on POST /pipeline/:donorId/move (requirePlan('team') → 403), so this
  // only softens the read presentation; it does not open a write path.
  const locked = tier !== "team";

  const officers = await query(
    "SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const single_user = officers.length <= 1;

  // BUILD-32 Part 4 — the "My portfolio / All portfolios" toggle (and the
  // officer filter) is meaningless unless 2+ officers actually have donors to
  // work. Count distinct officers with ≥1 ASSIGNED donor in a pipeline stage
  // (the same membership definition the board uses). `multiOfficer` drives
  // hiding the single-value pickers client-side; `canViewAll` still gates on
  // admin (a lone admin sees no toggle even though they could "view all").
  const distinctOfficers = await query(
    `SELECT COUNT(DISTINCT assigned_to)::int AS c FROM donors
       WHERE org_id=? AND assigned_to IS NOT NULL AND deleted_at IS NULL
         AND stage = ANY(?)`, [orgId, ALL_PIPELINE_STAGES]);
  const multiOfficer = (distinctOfficers[0]?.c || 0) >= 2;

  // ── The board is a PORTFOLIO, not the donor list ─────────────────────────
  // Membership = ASSIGNMENT (BUILD-30): a donor assigned to an officer is on
  // that officer's board, full stop. There is no separate "on the board" flag.
  // Unassigned (e.g. bulk-imported) donors match nothing here — they live in
  // the Directory with their stage LABEL and never flood this board. `scope`
  // defaults to the caller's own portfolio; a specific `assignedTo` overrides.
  // The exact same `portfolioMembership` helper feeds Home's Portfolio and
  // Pipeline cards, so all three counts are one number by construction.
  // Cross-officer visibility ("All portfolios", or filtering to another officer)
  // is an ADMIN/ED oversight view — the whole-shop forecast Team sells. An
  // individual officer only ever sees their OWN portfolio (BUILD-31 Part 4).
  // Enforced server-side, not just hidden in the UI: a non-admin's scope=all or
  // foreign assignedTo is downgraded to their own portfolio.
  const isAdmin = req.user.role === "admin";
  let scope = req.query.scope === "all" ? "all" : "mine";
  let assignedTo = req.query.assignedTo || null;
  if (!isAdmin) {
    scope = "mine";
    if (assignedTo && assignedTo !== userId) assignedTo = null;
  }
  const membership = portfolioMembership({ orgId, userId, scope, assignedTo, alias: "d" });
  const filters = [membership.where];
  const params = [...membership.params];
  if (req.query.designation) {
    filters.push("EXISTS (SELECT 1 FROM donor_designations dd WHERE dd.donor_id = d.id AND dd.org_id = d.org_id AND dd.kind = ?)");
    params.push(req.query.designation);
  }
  if (req.query.search && String(req.query.search).trim()) {
    filters.push("LOWER(d.name) LIKE ?"); params.push("%" + String(req.query.search).trim().toLowerCase() + "%");
  }
  const minGiving = parseFloat(req.query.minGiving);
  if (Number.isFinite(minGiving) && minGiving > 0) { filters.push("d.total_giving >= ?"); params.push(minGiving); }

  const donors = await query(
    `SELECT d.id, d.name, d.stage, d.total_giving, d.last_gift_date, d.assigned_to, d.assigned_to_name, d.updated_at, d.created_at
       FROM donors d WHERE ${filters.join(" AND ")}`, params);

  // Open asks aggregated per donor (org-wide, joined in JS).
  const oppAgg = await query(
    `SELECT donor_id, COALESCE(SUM(target_amount),0) AS ask, COUNT(*)::int AS cnt
       FROM opportunities WHERE org_id=? AND status='open' GROUP BY donor_id`, [orgId]);
  const askByDonor = Object.fromEntries(oppAgg.map(o => [o.donor_id, { ask: parseFloat(o.ask) || 0, cnt: o.cnt }]));

  // Most recent move INTO the donor's current stage → stage age.
  const lastMoves = await query(
    `SELECT DISTINCT ON (donor_id, to_stage) donor_id, to_stage, created_at
       FROM moves WHERE org_id=? ORDER BY donor_id, to_stage, created_at DESC`, [orgId]);
  const moveInto = {};
  for (const m of lastMoves) moveInto[m.donor_id + "|" + m.to_stage] = m.created_at;

  // Next open task per donor (earliest due).
  const nextTasks = await query(
    `SELECT DISTINCT ON (donor_id) donor_id, title, due FROM tasks
       WHERE org_id=? AND done=0 AND donor_id IS NOT NULL
       ORDER BY donor_id, (NULLIF(due,'')) ASC NULLS LAST`, [orgId]);
  const taskByDonor = Object.fromEntries(nextTasks.map(t => [t.donor_id, { title: t.title, due: t.due }]));

  const now = Date.now();
  const columns = {}; ALL_PIPELINE_STAGES.forEach(s => { columns[s] = []; });
  let forecastOpen = 0, forecastWeighted = 0, openCount = 0;
  for (const d of donors) {
    const a = askByDonor[d.id] || { ask: 0, cnt: 0 };
    forecastOpen += a.ask; openCount += a.cnt;
    forecastWeighted += a.ask * (STAGE_WEIGHT[d.stage] || 0);
    const enteredStage = moveInto[d.id + "|" + d.stage] || d.updated_at || d.created_at;
    const stageAge = enteredStage ? Math.max(0, Math.floor((now - new Date(enteredStage).getTime()) / 86400000)) : null;
    (columns[d.stage] = columns[d.stage] || []).push({
      donorId: d.id, name: d.name, stage: d.stage,
      totalGiving: parseFloat(d.total_giving) || 0,
      lastGiftDate: d.last_gift_date || null,
      assignedTo: d.assigned_to, assignedToName: d.assigned_to_name,
      askAmount: a.ask, openOppCount: a.cnt, stageAge,
      nextTask: taskByDonor[d.id] || null,
    });
  }

  // Sort each column + cap the payload so a large portfolio never ships (or
  // renders) hundreds of cards. counts[stage] carries the TRUE size so the UI
  // can show "showing N of M". Sorts: value (default), last gift, stage age.
  const sort = ["value", "last_gift", "stage_age"].includes(req.query.sort) ? req.query.sort : "value";
  const cmp = {
    value: (a, b) => (b.totalGiving - a.totalGiving) || (b.askAmount - a.askAmount),
    last_gift: (a, b) => (b.lastGiftDate ? Date.parse(b.lastGiftDate) : 0) - (a.lastGiftDate ? Date.parse(a.lastGiftDate) : 0),
    stage_age: (a, b) => (b.stageAge || 0) - (a.stageAge || 0),
  }[sort];
  const PER_COLUMN_CAP = 200;
  const counts = {};
  for (const s of ALL_PIPELINE_STAGES) {
    counts[s] = columns[s].length;
    columns[s].sort(cmp);
    if (columns[s].length > PER_COLUMN_CAP) columns[s] = columns[s].slice(0, PER_COLUMN_CAP);
  }

  // Won this quarter (period) — a coarse pipeline health figure.
  const { start } = finPeriodBounds("fiscal", 0);
  const wonAgg = await query(
    `SELECT COALESCE(SUM(gift_amount),0) AS amt, COUNT(*)::int AS cnt FROM opportunities
       WHERE org_id=? AND status='won' AND closed_at >= ?`, [orgId, start]);
  res.json({
    tier, locked, single_user, multiOfficer, stages, scope, sort, canViewAll: isAdmin,
    officers: officers.map(o => ({ id: o.id, name: o.name, color: o.portfolio_color })),
    columns, counts, total: donors.length, cap: PER_COLUMN_CAP,
    forecast: {
      open: Math.round(forecastOpen), weighted: Math.round(forecastWeighted), openCount,
      wonThisPeriod: parseFloat(wonAgg[0].amt) || 0, wonCount: wonAgg[0].cnt,
    },
  });
}));

// POST /pipeline/add — the deliberate act that puts prospects on the working
// board (single or bulk via `ids`). Assignment IS membership (BUILD-30), so
// "add to my pipeline" = assign to the caller (donors nobody owns yet land on
// the caller's own board; already-owned donors stay with their owner). No
// separate flag. Cross-officer assignment stays the admin `/donors/bulk-assign`.
// Team + write-gated.
app.post("/pipeline/add", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "ids array required" });
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL", [ids, req.user.orgId]);
  if (owned.length !== ids.length) return res.status(404).json({ error: "One or more donors not found in your org" });
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const myName = userRow[0]?.name || "";
  const result = await run(
    `UPDATE donors
        SET assigned_to      = COALESCE(assigned_to, ?),
            assigned_to_name = COALESCE(assigned_to_name, ?),
            updated_at = NOW()
      WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [req.user.userId, myName, ids, req.user.orgId]);
  res.json({ added: result.changes });
}));

// POST /pipeline/remove — take a donor OFF the working board (single or bulk).
// Assignment IS membership (BUILD-30), so removing from the board = unassigning;
// the donor stays in the Directory with its stage label untouched. Team +
// write-gated (a curation write, not a delete).
app.post("/pipeline/remove", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "ids array required" });
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL", [ids, req.user.orgId]);
  if (owned.length !== ids.length) return res.status(404).json({ error: "One or more donors not found in your org" });
  const result = await run(
    `UPDATE donors SET assigned_to = NULL, assigned_to_name = NULL, updated_at = NOW()
      WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [ids, req.user.orgId]);
  res.json({ removed: result.changes });
}));

// POST /pipeline/:donorId/move — the managed stage change. Description REQUIRED.
app.post("/pipeline/:donorId/move", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const { toStage, description } = req.body;
  if (!ALL_PIPELINE_STAGES.includes(toStage)) return res.status(400).json({ error: "Invalid stage" });
  if (!description || !String(description).trim()) return res.status(400).json({ error: "A description of the move is required." });
  const rows = await query("SELECT stage FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.donorId, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });
  const fromStage = rows[0].stage;
  if (fromStage === toStage) return res.status(400).json({ error: "Donor is already in that stage." });

  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const officerName = userRow[0]?.name || "";
  await run("UPDATE donors SET stage=?, updated_at=NOW() WHERE id=? AND org_id=?", [toStage, req.params.donorId, req.user.orgId]);
  const moveId = await recordMove(req.user.orgId, req.params.donorId, req.user.userId, officerName, fromStage, toStage, String(description).trim());
  // Keep the donor timeline consistent with the legacy stage_change path.
  try {
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      ["int_" + uuid().slice(0, 8), req.user.orgId, req.params.donorId, "stage_change",
       `Moved ${fromStage} → ${toStage}: ${String(description).trim()}`,
       new Date().toISOString().split("T")[0], req.user.userId, officerName]);
  } catch (e) { console.error("move interaction log:", e.message); }
  res.status(201).json({ ok: true, moveId, stage: toStage, fromStage });
}));

// GET /donors/:id/move-suggestions — signal-based suggestions (BUILD-22).
// A read: never changes stage. The officer accepts (→ POST /pipeline/:id/move)
// or dismisses. Org-scoped; foreign donor → 404.
app.get("/donors/:id/move-suggestions", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });
  res.json({ suggestions: computeMoveSuggestions(rows[0]) });
}));

// POST /pipeline/run-auto-lapse — run the auto-lapse sweep for the caller's org
// now (drives the exact scheduled path; for ops + tests). Admin-only, same bar
// as /sequences/process and /recurring/process-dunning.
app.post("/pipeline/run-auto-lapse", requireAuth, requireAdmin, wrap(async (req, res) => {
  const moved = await autoLapseOrg(req.user.orgId);
  res.json({ moved });
}));

// GET /donors/:id/moves — full move history for a constituent.
app.get("/donors/:id/moves", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    "SELECT id, officer_id, officer_name, from_stage, to_stage, description, created_at FROM moves WHERE org_id=? AND donor_id=? ORDER BY created_at DESC",
    [req.user.orgId, req.params.id]);
  res.json(rows);
}));

// GET /donors/:id/opportunities — asks on a prospect.
app.get("/donors/:id/opportunities", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    "SELECT * FROM opportunities WHERE org_id=? AND donor_id=? ORDER BY (status='open') DESC, created_at DESC",
    [req.user.orgId, req.params.id]);
  res.json(rows.map(o => ({ ...o, target_amount: parseFloat(o.target_amount) || 0, gift_amount: o.gift_amount == null ? null : parseFloat(o.gift_amount) })));
}));

app.post("/donors/:id/opportunities", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const { name, targetAmount, expectedClose } = req.body;
  const amt = parseFloat(targetAmount);
  if (!(amt > 0)) return res.status(400).json({ error: "A positive target ask amount is required." });
  const d = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d.length) return res.status(404).json({ error: "Donor not found" });
  // Officer = the donor's relationship owner; falls back to the creating user.
  let officerId = d[0].assigned_to, officerName = d[0].assigned_to_name;
  if (!officerId) { officerId = req.user.userId; const u = await query("SELECT name FROM users WHERE id=?", [req.user.userId]); officerName = u[0]?.name || ""; }
  const id = "opp_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,officer_id,officer_name,expected_close) VALUES (?,?,?,?,?,'open',?,?,?)",
    [id, req.user.orgId, req.params.id, (name || "").trim() || "Ask", amt, officerId, officerName || "", expectedClose || null]);
  const rows = await query("SELECT * FROM opportunities WHERE id=?", [id]);
  res.status(201).json({ ...rows[0], target_amount: parseFloat(rows[0].target_amount) || 0 });
}));

// PUT /opportunities/:id — edit, or close won/lost. Closing 'won' links the
// real gift and records the actual gift amount (the ask-vs-gift accountability).
app.put("/opportunities/:id", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM opportunities WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Opportunity not found" });
  const { name, targetAmount, expectedClose, status, giftId, giftAmount } = req.body;
  const sets = [], params = [];
  if (name !== undefined) { sets.push("name=?"); params.push((name || "").trim() || "Ask"); }
  if (targetAmount !== undefined) { const a = parseFloat(targetAmount); if (!(a > 0)) return res.status(400).json({ error: "Target ask amount must be positive." }); sets.push("target_amount=?"); params.push(a); }
  if (expectedClose !== undefined) { sets.push("expected_close=?"); params.push(expectedClose || null); }
  if (status !== undefined) {
    if (!["open", "won", "lost"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    sets.push("status=?"); params.push(status);
    if (status === "won") {
      let amt = giftAmount != null ? parseFloat(giftAmount) : null;
      let gId = giftId || null;
      if (gId) {
        const g = await query("SELECT amount FROM gifts WHERE id=? AND org_id=?", [gId, req.user.orgId]);
        if (!g.length) return res.status(404).json({ error: "Linked gift not found" });
        if (amt == null) amt = parseFloat(g[0].amount) || 0;
      }
      sets.push("gift_id=?", "gift_amount=?", "closed_at=NOW()"); params.push(gId, amt);
    } else if (status === "lost") {
      sets.push("gift_id=NULL", "gift_amount=NULL", "closed_at=NOW()");
    } else { // reopen
      sets.push("gift_id=NULL", "gift_amount=NULL", "closed_at=NULL");
    }
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(req.params.id, req.user.orgId);
  await run(`UPDATE opportunities SET ${sets.join(",")} WHERE id=? AND org_id=?`, params);
  const rows = await query("SELECT * FROM opportunities WHERE id=?", [req.params.id]);
  res.json({ ...rows[0], target_amount: parseFloat(rows[0].target_amount) || 0, gift_amount: rows[0].gift_amount == null ? null : parseFloat(rows[0].gift_amount) });
}));

app.delete("/opportunities/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM opportunities WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// GET /pipeline/officer-activity — per-officer moves/asks/gifts over a period.
// The raw data BUILD-17's per-officer reports read; just recorded cleanly here.
app.get("/pipeline/officer-activity", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const from = req.query.from || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const officers = await query("SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const moves = await query(
    "SELECT officer_id, COUNT(*)::int AS cnt FROM moves WHERE org_id=? AND created_at >= ? AND created_at < (?::date + 1) GROUP BY officer_id", [orgId, from, to]);
  const asks = await query(
    "SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt FROM opportunities WHERE org_id=? AND created_at >= ? AND created_at < (?::date + 1) GROUP BY officer_id", [orgId, from, to]);
  const won = await query(
    "SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt FROM opportunities WHERE org_id=? AND status='won' AND closed_at >= ? AND closed_at < (?::date + 1) GROUP BY officer_id", [orgId, from, to]);
  const mv = Object.fromEntries(moves.map(r => [r.officer_id, r.cnt]));
  const ak = Object.fromEntries(asks.map(r => [r.officer_id, r]));
  const wn = Object.fromEntries(won.map(r => [r.officer_id, r]));
  res.json({
    from, to,
    officers: officers.map(o => ({
      officerId: o.id, name: o.name, color: o.portfolio_color,
      movesMade: mv[o.id] || 0,
      asksMade: ak[o.id]?.cnt || 0, asksAmount: parseFloat(ak[o.id]?.amt) || 0,
      giftsClosed: wn[o.id]?.cnt || 0, giftsAmount: parseFloat(wn[o.id]?.amt) || 0,
    })),
  });
}));

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

  let householdTotal = null;
  const householdLinks = relationships.filter(r => HOUSEHOLD_RELATIONSHIP_TYPES.includes(r.relationshipType));
  if (householdLinks.length) {
    const selfRow = await query("SELECT total_giving FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]);
    const selfTotal = Number(selfRow[0]?.total_giving) || 0;
    householdTotal = selfTotal + householdLinks.reduce((sum, r) => sum + r.relatedDonorTotalGiving, 0);
  }

  res.json({ relationships, householdTotal });
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
    "INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes) VALUES (?,?,?,?,?,?)",
    [id, orgId, donorId, relatedDonorId, relationshipType, notes || null]
  );
  res.status(201).json({ id });
}));

app.delete("/donor-relationships/:id", requireAuth, wrap(async (req, res) => {
  await run("DELETE FROM donor_relationships WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// Wealth/capacity scoring is part of the Team major-gifts layer — Core sees a
// stored score read-only (behind glass) but can't compute/recompute it.
app.post("/donors/:id/score", requireAuth, requirePlan("team"), checkWriteAccess, wrap(async (req, res) => {
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
     WHERE g.donor_id=? AND g.org_id=? AND g.fund_id IS NOT NULL AND g.fund_id != ''
     GROUP BY g.fund_id, f.name, f.restricted
     ORDER BY total DESC`,
    [req.params.id, orgId]
  );

  // Unrestricted (no fund_id)
  const unrestrictedGifts = await query(
    `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as gift_count FROM gifts WHERE donor_id=? AND org_id=? AND (fund_id IS NULL OR fund_id='')`,
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

// ── Grants ─────────────────────────────────────────────────────────────────
// Optional ?search= (lower LIKE on funder/program) + ?limit= for the top-bar
// global search; no params → unchanged full list (plain array either way).
app.get("/grants", requireAuth, wrap(async (req, res) => {
  const where = ["org_id = ?"];
  const params = [req.user.orgId];
  if (req.query.search && String(req.query.search).trim()) {
    const s = "%" + String(req.query.search).trim().toLowerCase() + "%";
    where.push("(lower(funder) LIKE ? OR lower(program) LIKE ?)");
    params.push(s, s);
  }
  let sql = `SELECT * FROM grants WHERE ${where.join(" AND ")} ORDER BY deadline ASC`;
  const limit = parseInt(req.query.limit, 10);
  if (limit > 0) { sql += " LIMIT ?"; params.push(Math.min(limit, 50)); }
  const grants = await query(sql, params);
  res.json(grants.map(g => ({ ...g, history: JSON.parse(g.history || "[]") })));
}));

// Finance entity-routing FIX (2026-08-04) — the ONE grant-award → ledger stamp.
// source='grant' (badged in the unified ledger), grant_id + the partial-unique
// uq_fin_txns_grant (db.js) make it idempotent BY CONSTRUCTION: re-award after
// un-award, a redundant awarded→awarded PUT, or a manual row already adopted as
// this grant's stamp (grant_id taken) can never double-insert. Fund matching is
// the original BUILD-09 heuristic (funder/program-named fund, else the first
// unrestricted fund).
async function stampGrantAward(orgId, grantId, funder, program, amount) {
  const matchFund = await query(
    "SELECT id FROM fin_funds WHERE org_id=? AND (name ILIKE ? OR name ILIKE ?) LIMIT 1",
    [orgId, `%${funder}%`, `%${program || ""}%`]
  );
  const genFund = matchFund.length ? matchFund : await query(
    "SELECT id FROM fin_funds WHERE org_id=? AND restricted=false ORDER BY created_at ASC LIMIT 1", [orgId]
  );
  const acct = await query("SELECT id FROM accounts WHERE org_id=? LIMIT 1", [orgId]);
  await run(
    `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,grant_id,source)
     VALUES (?,?,?,?,?,?,'income',?,?,?,'grant')
     ON CONFLICT (grant_id) WHERE grant_id IS NOT NULL DO NOTHING`,
    ["ft_" + uuid().slice(0, 8), orgId, new Date().toISOString().slice(0, 10),
     `Grant awarded: ${funder} — ${program || ""}`, funder,
     parseFloat(amount) || 0, acct[0]?.id || null, genFund[0]?.id || null, grantId]
  ).catch(() => {});
}

app.post("/grants", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, status, deadline, reportDue, officer, notes } = req.body;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  // Attribution FIX — optional campaign link (org-scoped; foreign → 404).
  // The awarded amount counts toward the linked campaign's raised once the
  // grant is AWARDED (awarded_at) — general-operating grants stay unattributed.
  if (campaignId) {
    const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
  }

  const id = "gr_" + uuid().slice(0, 8);
  const isAwarded = (status || "prospecting") === "awarded";
  await run(
    "INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,report_due,officer,notes,campaign_id,awarded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, funder, program || "", amount || 0,
     status || "prospecting", deadline || "", reportDue || "", officer || "", notes || "",
     campaignId, isAwarded ? new Date().toISOString() : null]
  );
  // A grant created directly IN 'awarded' books its income too (this path
  // previously never stamped the ledger — only the PUT transition did).
  if (isAwarded) await stampGrantAward(req.user.orgId, id, funder, program, amount);
  const rows = await query("SELECT * FROM grants WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/grants/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, received, status, deadline, reportDue, officer, notes, description, requirements, adoptTxnId } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });
  const orgId = req.user.orgId;

  // Capture previous status/attribution before update
  const prevRows = await query("SELECT status, campaign_id, awarded_at FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!prevRows.length) return res.status(404).json({ error: "Grant not found" });
  const prevStatus = prevRows[0]?.status;

  // Finance entity-routing FIX — the award-side double-count guard's "link,
  // don't double-book" arm. `adoptTxnId` names an EXISTING manual money-in row
  // (org-scoped, source='manual', type='income', not already a grant's stamp)
  // that IS this award's money: instead of inserting a second income row, that
  // row becomes the award stamp (grant_id set, source→'grant'). Validated up
  // front so a foreign/wrong-shaped id 404s before any state changes — never
  // silently double-books.
  if (adoptTxnId !== undefined && adoptTxnId !== null && adoptTxnId !== "") {
    if (status !== "awarded") return res.status(400).json({ error: "adoptTxnId only applies when marking a grant awarded" });
    const adoptRows = await query(
      "SELECT id FROM fin_transactions WHERE id=? AND org_id=? AND source='manual' AND type='income' AND grant_id IS NULL",
      [adoptTxnId, orgId]
    );
    if (!adoptRows.length) return res.status(404).json({ error: "Transaction not found or not adoptable" });
  }

  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  const campaignIdRaw = req.body.campaignId !== undefined ? req.body.campaignId
    : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  let newCampaignId = prevRows[0]?.campaign_id || null;
  if (campaignIdRaw !== undefined) {
    if (campaignIdRaw) {
      const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignIdRaw, orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      newCampaignId = campaignIdRaw;
    } else {
      newCampaignId = null;
    }
  }

  // awarded_at is the attribution fact (see db.js): stamped entering
  // 'awarded' (the same moment as the ledger income stamp below), kept while
  // the grant moves through active/closed, cleared if it moves BACK to a
  // still-pursuing or rejected status (an un-award — the thermometer reverses).
  let newAwardedAt = prevRows[0]?.awarded_at || null;
  if (status === "awarded" && prevStatus !== "awarded" && !newAwardedAt) newAwardedAt = new Date().toISOString();
  if (["prospecting", "loi", "applied", "submitted", "draft", "pending", "rejected"].includes(status)) newAwardedAt = null;

  const affected = await run(
    `UPDATE grants
     SET funder=?,program=?,amount=?,received=?,status=?,deadline=?,report_due=?,officer=?,notes=?,description=?,requirements=?,campaign_id=?,awarded_at=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [funder, program || "", amount || 0, received || 0, status, deadline || "",
     reportDue || "", officer || "", notes || "", description || "", requirements || "",
     newCampaignId, newAwardedAt,
     req.params.id, orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Grant not found" });

  // Grant awarded → the ledger income books EXACTLY ONCE (uq_fin_txns_grant).
  // Either by adopting the caller-named manual row as the stamp (the money was
  // already logged — link it, don't double-book) or by inserting the auto
  // stamp. Adoption keeps the treasurer's own date/fund/account and re-badges
  // the row source='grant'.
  if (status === 'awarded' && prevStatus !== 'awarded') {
    let adopted = false;
    if (adoptTxnId) {
      // Adoption keeps source='manual' (it stays the treasurer's own entry —
      // un-award UNLINKS it rather than deleting user-entered data); grant_id
      // is what marks it as the award's single ledger booking.
      const upd = await run(
        `UPDATE fin_transactions SET grant_id=?
         WHERE id=? AND org_id=? AND source='manual' AND type='income' AND grant_id IS NULL`,
        [req.params.id, adoptTxnId, orgId]
      ).catch(() => ({ changes: 0 }));
      adopted = !!upd.changes;
      if (adopted) writeAuditLog(orgId, req.user.userId, req.user.email, "updated", "transaction", adoptTxnId, {
        description: `Linked existing manual income to grant award: ${funder} — ${program || ""} (books once, not twice)`,
        new: { grant_id: req.params.id },
      }).catch(() => {});
    }
    if (!adopted) await stampGrantAward(orgId, req.params.id, funder, program, amount);
  }

  // Un-award (awarded_at cleared — the grant moved BACK to a pursuing or
  // rejected status): the income reverses out of the ledger too, same
  // discipline as a voided/refunded gift removing its stamp. The AUTO stamp
  // (source='grant') is deleted; an ADOPTED manual row is unlinked back to a
  // plain manual entry (never delete treasurer-entered data on a status move).
  if (newAwardedAt === null && prevRows[0]?.awarded_at) {
    await run("DELETE FROM fin_transactions WHERE org_id=? AND grant_id=? AND source='grant'", [orgId, req.params.id]).catch(() => {});
    await run("UPDATE fin_transactions SET grant_id=NULL WHERE org_id=? AND grant_id=?", [orgId, req.params.id]).catch(() => {});
  }

  // Grant closed/rejected → follow-up task in 6 months
  if ((status === 'closed' || status === 'rejected') && prevStatus !== status) {
    const sixMonths = new Date(Date.now() + 180*24*60*60*1000).toISOString().slice(0, 10);
    await run(
      "INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES (?,?,?,'medium',0,?)",
      ["t_"+uuid().slice(0,8), orgId, `Follow up with ${funder} re: next cycle`, sixMonths]
    ).catch(() => {});
  }

  const rows = await query("SELECT * FROM grants WHERE id = ?", [req.params.id]);
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  res.json(g);
}));

// Finance entity-routing FIX — award-side double-count guard, the DETECTION
// arm. Before marking a grant awarded, the client asks: is there a recent
// MANUAL money-in already in the ledger that looks like this grant's money
// (funder name in vendor/description, or the exact grant amount)? Read-only,
// org-scoped (foreign grant → 404); the human decides via the prompt whether
// to link (PUT adoptTxnId) or book separately. 180-day window, newest first.
app.get("/grants/:id/manual-match", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT id, funder, program, amount, status FROM grants WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Grant not found" });
  const g = rows[0];
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const funder = String(g.funder || "").trim().toLowerCase();
  const amt = parseFloat(g.amount) || 0;
  const matches = await query(
    `SELECT id, date, description, vendor_donor, amount, fund_id
     FROM fin_transactions
     WHERE org_id=? AND source='manual' AND type='income' AND grant_id IS NULL AND date >= ?
       AND (
         (vendor_donor <> '' AND (lower(vendor_donor) LIKE ? OR ? LIKE '%' || lower(vendor_donor) || '%'))
         OR lower(description) LIKE ?
         OR (? > 0 AND amount = ?)
       )
     ORDER BY date DESC LIMIT 5`,
    [req.user.orgId, cutoff, `%${funder}%`, funder, `%${funder}%`, amt, amt]
  );
  res.json({ grantId: g.id, funder: g.funder, program: g.program || "", amount: amt, matches: matches.map(m => ({ ...m, amount: parseFloat(m.amount) })) });
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

app.post("/volunteers", requireAuth, checkWriteAccess, wrap(async (req, res) => {
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

app.put("/volunteers/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, email, hours, skills, employer, notes, convertPotential } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  // Capture old hours before update to detect 20-hour threshold crossing
  const prevRows = await query("SELECT hours FROM volunteers WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  const prevHours = parseFloat(prevRows[0]?.hours || 0);
  const newHours = parseFloat(hours || 0);

  const affected = await run(
    "UPDATE volunteers SET name=?,email=?,hours=?,skills=?,employer=?,notes=?,convert_potential=? WHERE id=? AND org_id=?",
    [name, email || "", newHours, JSON.stringify(skills || []),
     employer || "", notes || "", convertPotential || "medium", req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Volunteer not found" });

  // 20-hour threshold: auto-create donor prospect + task
  if (prevHours < 20 && newHours >= 20 && email) {
    const orgId = req.user.orgId;
    const existing = await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [orgId, email]);
    if (!existing.length) {
      const donorId = "d_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO donors (id,org_id,name,email,stage,notes,gift_count,total_giving) VALUES (?,?,?,?,'prospect',?,0,0)",
        [donorId, orgId, name, email.toLowerCase(), "Auto-created from volunteer record. 20+ hours logged."]
      ).catch(() => {});
      const today = new Date().toISOString().slice(0, 10);
      await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES (?,?,?,'note',?,?)",
        ["i_"+uuid().slice(0,8), orgId, donorId, "Volunteer prospect — 20+ hours logged", today]).catch(() => {});
    }
    const dueDate = new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0, 10);
    await run("INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES (?,?,?,'high',0,?)",
      ["t_"+uuid().slice(0,8), orgId, `Cultivate volunteer ${name} as donor prospect — 20+ hours logged`, dueDate]).catch(() => {});
  }

  const rows = await query("SELECT * FROM volunteers WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.get("/volunteers/donor-prospects", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const vols = await query(
    "SELECT * FROM volunteers WHERE org_id=? AND hours >= 20 ORDER BY hours DESC",
    [orgId]
  );
  const result = await Promise.all(vols.map(async v => {
    const donor = v.email
      ? await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [orgId, v.email])
      : [];
    return { ...v, skills: JSON.parse(v.skills || "[]"), hasDonorRecord: donor.length > 0 };
  }));
  res.json(result.filter(v => !v.hasDonorRecord));
}));

// ── Tasks ──────────────────────────────────────────────────────────────────
// Tasks — the daily-driver follow-up surface (BUILD-13). A task links an
// optional donor; the linked donor is now RENDERED in the UI, so donorId must
// be org-verified (orgOwns) — a foreign id would otherwise leak a donor
// name/link across tenants (the §1 resurfacing threat model note).
app.get("/tasks", requireAuth, wrap(async (req, res) => {
  // scope=mine → only the caller's own tasks (assigned_to = me), matching Home's
  // Tasks command-card count exactly so "Tasks: N" always lands on N (BUILD-30
  // class audit: every stat card lands on a view showing its number). Default
  // (no scope / scope=all) is the whole org, unchanged.
  const mine = req.query.scope === "mine";
  const tasks = await query(
    `SELECT t.*, d.name AS donor_name
       FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? ${mine ? "AND t.assigned_to = ?" : ""}
      ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.due ASC`,
    mine ? [req.user.orgId, req.user.userId] : [req.user.orgId]
  );
  res.json(tasks);
}));

// A donor's own open tasks — surfaced on the donor profile.
app.get("/donors/:id/tasks", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });
  const tasks = await query(
    `SELECT * FROM tasks WHERE org_id = ? AND donor_id = ?
      ORDER BY done ASC, due ASC NULLS LAST, created_at DESC`,
    [req.user.orgId, req.params.id]
  );
  res.json(tasks);
}));

app.post("/tasks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, donorId, assignedTo, assignedToName } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  // Tenant guard: a linked donor must belong to the caller's org.
  if (!(await orgOwns("donors", donorId, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });

  // Owner defaults to the creator; may target a teammate (validated to the org).
  const ownerTargetId = assignedTo || req.user.userId;
  const u = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [ownerTargetId, req.user.orgId]);
  if (assignedTo && !u.length) return res.status(404).json({ error: "Assignee not found" });
  const ownerId = u.length ? u[0].id : req.user.userId;
  const ownerName = (u.length && u[0].name) || assignedToName || "";

  const id = "t_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,NOW())",
    [id, req.user.orgId, String(title).trim(), due || "", priority || "medium", type || "donor",
     donorId || null, ownerId, ownerName]
  );
  const rows = await query(
    `SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id WHERE t.id = ?`, [id]);
  // BUILD-36 A2: if this task was assigned to someone OTHER than the creator,
  // email the assignee (no email for a self-assigned task). Fire-and-forget.
  if (rows[0]?.assigned_to && rows[0].assigned_to !== req.user.userId) {
    queueTaskAssignmentEmail(rows[0], req.user.userId).catch(e => console.error("[task] assign email:", e.message));
  }
  res.status(201).json(rows[0]);
}));

app.put("/tasks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, done, donorId, assignedTo } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  if (donorId !== undefined && !(await orgOwns("donors", donorId, req.user.orgId)))
    return res.status(404).json({ error: "Donor not found" });

  // Reassignment (BUILD-36 A2): validate a new assignee to the org, capture the
  // prior owner so we only notify on a genuine change to a NEW person.
  const priorRows = await query("SELECT assigned_to FROM tasks WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!priorRows.length) return res.status(404).json({ error: "Task not found" });
  const priorAssignee = priorRows[0].assigned_to;
  let newAssignee, newAssigneeName;
  if (assignedTo !== undefined) {
    if (assignedTo) {
      const u = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [assignedTo, req.user.orgId]);
      if (!u.length) return res.status(404).json({ error: "Assignee not found" });
      newAssignee = u[0].id; newAssigneeName = u[0].name || "";
    } else { newAssignee = null; newAssigneeName = null; }
  }

  const sets = ["title=?", "due=?", "priority=?", "type=?", "done=?", "updated_at=NOW()"];
  const params = [String(title).trim(), due || "", priority || "medium", type || "donor", done ? 1 : 0];
  if (donorId !== undefined) { sets.push("donor_id=?"); params.push(donorId || null); }
  if (assignedTo !== undefined) { sets.push("assigned_to=?", "assigned_to_name=?"); params.push(newAssignee, newAssigneeName); }
  params.push(req.params.id, req.user.orgId);

  const affected = await run(
    `UPDATE tasks SET ${sets.join(",")} WHERE id=? AND org_id=?`, params);
  if (!affected.changes) return res.status(404).json({ error: "Task not found" });
  const rows = await query(
    `SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id WHERE t.id = ?`, [req.params.id]);
  // Notify only on a genuine reassignment to a NEW person who isn't the actor.
  if (assignedTo !== undefined && newAssignee && newAssignee !== priorAssignee && newAssignee !== req.user.userId) {
    queueTaskAssignmentEmail(rows[0], req.user.userId).catch(e => console.error("[task] reassign email:", e.message));
  }
  res.json(rows[0]);
}));

// One-click complete/reopen — the primary Tasks action (write-gated).
app.post("/tasks/:id/complete", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const done = req.body.done === false ? 0 : 1;
  const affected = await run(
    "UPDATE tasks SET done=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [done, req.params.id, req.user.orgId]);
  if (!affected.changes) return res.status(404).json({ error: "Task not found" });
  const rows = await query(
    `SELECT t.*, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id WHERE t.id = ?`, [req.params.id]);
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

app.post("/board", requireAuth, checkWriteAccess, wrap(async (req, res) => {
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

// ── Dashboard ──────────────────────────────────────────────────────────────
// GET /donors (the list route App.jsx's loadData() uses) never embeds
// interactions — only GET /donors/:id does, joined lazily when a profile
// opens. adaptData() hardcodes donors[].interactions to [], so the
// Dashboard's Recent Activity feed had no real data source. This gives it
// one directly, org-wide, instead of relying on the per-donor shape.
app.get("/dashboard/recent-activity", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT i.id, i.type, i.note, i.date, i.donor_id, d.name AS donor_name
     FROM interactions i
     JOIN donors d ON d.id = i.donor_id
     WHERE i.org_id = ? AND d.deleted_at IS NULL
     ORDER BY i.date DESC, i.created_at DESC
     LIMIT 10`,
    [req.user.orgId]
  );
  res.json(rows);
}));

app.get("/dashboard/my-stats", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const now = new Date();
  const fyStart = now.getMonth() < 6
    ? new Date(now.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(now.getFullYear(), 6, 1).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  const [portfolioRows, visitsRows, movesRows, giftsRows, pipelineRows, lapsedRows, orgInteractionRows, orgGiftHistoryRows] = await Promise.all([
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND deleted_at IS NULL", [orgId, userId]),
    query("SELECT COUNT(*) as cnt FROM interactions WHERE org_id=? AND created_by=? AND type='meeting' AND date>=?", [orgId, userId, fyStart]),
    // "Moves Made" = every meaningful-contact interaction (call/meeting/
    // email/stewardship — the same MEANINGFUL_CONTACT_TYPES used by
    // Stewardship Debt/First-Touch Delay), NOT literally every interactions
    // row with created_by=userId. Previously unfiltered by type, which
    // silently counted 'gift' rows (auto-logged by /donors/:id/gifts and the
    // bulk history importer) and 'stage_change' rows (auto-logged by a
    // Kanban drag) as if they were outreach — a bulk gift import or a stage
    // drag inflated a fundraiser's own activity count without them actually
    // contacting anyone. This makes Visits YTD a true subset of Moves Made
    // (meeting ⊂ meaningful contact) instead of two counts with an unclear
    // relationship, and lets GET /dashboard/my-stats/moves/breakdown below
    // return a list that actually matches what's being counted.
    query(`SELECT COUNT(*) as cnt FROM interactions WHERE org_id=? AND created_by=? AND type IN ${MEANINGFUL_CONTACT_TYPES} AND date>=?`, [orgId, userId, fyStart]),
    query("SELECT COALESCE(SUM(g.amount),0) as total FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE d.org_id=? AND d.assigned_to=? AND g.date>=?", [orgId, userId, fyStart]),
    query("SELECT COALESCE(SUM(total_giving),0) as total FROM donors WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL", [orgId, userId]),
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL", [orgId, userId]),
    // Org-wide (not user-scoped) signals for the Home dashboard's empty-state
    // copy: distinguishes "you have real donor/gift history but genuinely
    // haven't logged any outreach yet" (show explanatory first-run copy)
    // from "this org has no donors at all" (a different, existing empty state).
    // Deliberately scoped to MEANINGFUL_CONTACT_TYPES, not any interaction row:
    // a fresh onboarding import creates 'gift' interactions as a side effect
    // of recording each gift (see /donors/import-combined), which is real
    // data but not outreach — counting it here would hide the "log your
    // first call" prompt on Day 1 for every org that imported gift history.
    query(`SELECT COUNT(*) as cnt FROM interactions WHERE org_id=? AND type IN ${MEANINGFUL_CONTACT_TYPES}`, [orgId]),
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND deleted_at IS NULL AND gift_count>0", [orgId]),
  ]);

  res.json({
    portfolioCount: parseInt(portfolioRows[0]?.cnt || 0),
    visitsYtd: parseInt(visitsRows[0]?.cnt || 0),
    madeYtd: parseInt(movesRows[0]?.cnt || 0),
    giftsYtd: parseInt(giftsRows[0]?.total || 0),
    pipelineValue: parseInt(pipelineRows[0]?.total || 0),
    lapsedCount: parseInt(lapsedRows[0]?.cnt || 0),
    orgHasInteractions: parseInt(orgInteractionRows[0]?.cnt || 0) > 0,
    orgHasGiftHistory: parseInt(orgGiftHistoryRows[0]?.cnt || 0) > 0,
  });
}));

// BUILD-16 Part 1 — the Home command center. Four headers a fundraiser opens
// the app to see: Portfolio [Team], Tasks [Core], Need to Do [Core], Pipeline
// [Team]. First-touch-delay / stewardship-debt are demoted to secondary chips
// (still served by /metrics/stewardship-summary), never headline cards. Plan-
// graceful: a Core org gets Tasks + a giving snapshot, no broken Team headers.
// The Need-to-do LIST itself is the existing /dashboard/today queue (the client
// already fetches it) — this endpoint returns the four headers' summary data.
app.get("/dashboard/home", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const scope = req.query.scope === "all" ? "all" : "mine";
  const today = new Date().toISOString().split("T")[0];

  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";

  // BUILD-32 Part 4 — the Home "My donors / Whole org" scope toggle is a single-
  // value picker unless 2+ officers actually have assigned donors (then "mine"
  // and "all" differ). Same signal the Pipeline board uses; drives hiding it.
  const distinctOfficers = await query(
    `SELECT COUNT(DISTINCT assigned_to)::int AS c FROM donors
       WHERE org_id=? AND assigned_to IS NOT NULL AND deleted_at IS NULL`, [orgId]);
  const multiOfficer = (distinctOfficers[0]?.c || 0) >= 2;

  // Tasks buckets [Core] — open tasks, scoped to the user (mine) or org (all).
  const taskScope = scope === "mine" ? "AND assigned_to=?" : "";
  const taskRows = await query(
    `SELECT
       COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND due < ?) AS overdue,
       COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND left(due,10) = ?) AS today,
       COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND due > ? AND left(due,10) <> ?) AS upcoming,
       COUNT(*) FILTER (WHERE due = '' OR due IS NULL) AS no_date,
       COUNT(*) AS total
     FROM tasks WHERE org_id=? AND done=0 ${taskScope}`,
    scope === "mine" ? [today, today, today, today, orgId, userId] : [today, today, today, today, orgId]
  );
  const tRow = taskRows[0] || {};
  const tasks = {
    overdue: parseInt(tRow.overdue, 10) || 0,
    today: parseInt(tRow.today, 10) || 0,
    upcoming: parseInt(tRow.upcoming, 10) || 0,
    noDate: parseInt(tRow.no_date, 10) || 0,
    total: parseInt(tRow.total, 10) || 0,
  };

  // Portfolio [Team] — the officer's assigned constituents + their lifetime
  // value + the officer's color. Null on Core (the header is hidden).
  let portfolio = null;
  if (tier === "team") {
    // The officer's own portfolio (always "mine"), via the ONE membership helper.
    const m = portfolioMembership({ orgId, userId, scope: "mine", alias: "" });
    const [pRows, cRows] = await Promise.all([
      query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE ${m.where}`, m.params),
      query("SELECT portfolio_color FROM users WHERE id=? AND org_id=?", [userId, orgId]),
    ]);
    portfolio = {
      count: parseInt(pRows[0]?.cnt, 10) || 0,
      value: parseFloat(pRows[0]?.val) || 0,
      color: cRows[0]?.portfolio_color || null,
    };
  }

  // Pipeline [Team] — SAME membership as the board + Portfolio card (the ONE
  // definition via portfolioMembership), broken out per stage for the compact
  // summary. total/value are computed over the whole portfolio so they equal the
  // Portfolio card and the board exactly; the per-stage rows are the display
  // breakdown. The open-ask forecast is scoped to the SAME portfolio donors the
  // board sums, so Home's forecast and the board's asks agree. Null on Core.
  let pipeline = null;
  if (tier === "team") {
    const m = portfolioMembership({ orgId, userId, scope, alias: "" });
    const [totRows, stageRows] = await Promise.all([
      query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE ${m.where}`, m.params),
      query(`SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val
               FROM donors WHERE ${m.where} GROUP BY stage`, m.params),
    ]);
    const byStage = Object.fromEntries(stageRows.map(r => [r.stage, r]));
    const stages = ALL_PIPELINE_STAGES.map(s => ({
      stage: s,
      count: parseInt(byStage[s]?.cnt, 10) || 0,
      value: parseFloat(byStage[s]?.val) || 0,
    }));
    // Open asks belonging to THIS portfolio's donors only (matches the board).
    const owner = scope === "mine" ? "assigned_to = ?" : "assigned_to IS NOT NULL";
    const oppParams = scope === "mine" ? [orgId, orgId, userId] : [orgId, orgId];
    const oppRows = await query(
      `SELECT COALESCE(SUM(target_amount),0) AS ask, COUNT(*) AS cnt
         FROM opportunities WHERE org_id=? AND status='open'
           AND donor_id IN (SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND ${owner})`, oppParams);
    pipeline = {
      total: parseInt(totRows[0]?.cnt, 10) || 0,
      value: parseFloat(totRows[0]?.val) || 0,
      stages,
      forecastOpen: Math.round(parseFloat(oppRows[0]?.ask) || 0),
      openOppCount: parseInt(oppRows[0]?.cnt, 10) || 0,
    };
  }

  res.json({ tier, scope, portfolio, tasks, pipeline, multiOfficer });
}));

// Per-stat drill-downs behind the My Portfolio bar. Each mirrors the exact
// filter its headline count above uses (same fyStart boundary, same type
// filters), so the number shown and the list you get from clicking it can
// never disagree. Rows are shaped for MetricBreakdownPanel — visits/moves/
// gifts are one row per logged event (a donor can appear more than once, so
// each row carries its own `id`), pipeline/lapsed are one row per donor.
app.get("/dashboard/my-stats/visits/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const now = new Date();
  const fyStart = now.getMonth() < 6
    ? new Date(now.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(now.getFullYear(), 6, 1).toISOString().split("T")[0];
  const PAGE_SIZE = 50;
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT i.id, i.donor_id, d.name AS donor_name, i.date FROM interactions i
       JOIN donors d ON d.id = i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type='meeting' AND i.date>=? AND d.deleted_at IS NULL
       ORDER BY i.date DESC LIMIT ?`,
      [orgId, userId, fyStart, PAGE_SIZE]
    ),
    query(
      `SELECT COUNT(*) as cnt FROM interactions i JOIN donors d ON d.id=i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type='meeting' AND i.date>=? AND d.deleted_at IS NULL`,
      [orgId, userId, fyStart]
    ),
  ]);
  res.json({
    count: parseInt(countRow[0]?.cnt || 0),
    rows: rows.map(r => ({
      id: r.id, donorId: r.donor_id, donorName: r.donor_name,
      detail: "Meeting logged",
      value: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    })),
  });
}));

app.get("/dashboard/my-stats/moves/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const now = new Date();
  const fyStart = now.getMonth() < 6
    ? new Date(now.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(now.getFullYear(), 6, 1).toISOString().split("T")[0];
  const PAGE_SIZE = 50;
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT i.id, i.donor_id, d.name AS donor_name, i.date, i.type FROM interactions i
       JOIN donors d ON d.id = i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date>=? AND d.deleted_at IS NULL
       ORDER BY i.date DESC LIMIT ?`,
      [orgId, userId, fyStart, PAGE_SIZE]
    ),
    query(
      `SELECT COUNT(*) as cnt FROM interactions i JOIN donors d ON d.id=i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date>=? AND d.deleted_at IS NULL`,
      [orgId, userId, fyStart]
    ),
  ]);
  const TYPE_LABEL = { call: "Call", meeting: "Meeting", email: "Email", stewardship: "Stewardship" };
  res.json({
    count: parseInt(countRow[0]?.cnt || 0),
    rows: rows.map(r => ({
      id: r.id, donorId: r.donor_id, donorName: r.donor_name,
      detail: TYPE_LABEL[r.type] || r.type,
      value: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    })),
  });
}));

app.get("/dashboard/my-stats/gifts/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const now = new Date();
  const fyStart = now.getMonth() < 6
    ? new Date(now.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
    : new Date(now.getFullYear(), 6, 1).toISOString().split("T")[0];
  const PAGE_SIZE = 50;
  const [rows, totalRow] = await Promise.all([
    query(
      `SELECT g.id, g.donor_id, d.name AS donor_name, g.date, g.amount FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       WHERE d.org_id=? AND d.assigned_to=? AND g.date>=? AND d.deleted_at IS NULL
       ORDER BY g.amount DESC LIMIT ?`,
      [orgId, userId, fyStart, PAGE_SIZE]
    ),
    query(
      `SELECT COALESCE(SUM(g.amount),0) as total, COUNT(*) as cnt FROM gifts g
       JOIN donors d ON d.id=g.donor_id
       WHERE d.org_id=? AND d.assigned_to=? AND g.date>=? AND d.deleted_at IS NULL`,
      [orgId, userId, fyStart]
    ),
  ]);
  res.json({
    total: Math.round(Number(totalRow[0]?.total || 0)),
    count: parseInt(totalRow[0]?.cnt || 0),
    rows: rows.map(r => ({
      id: r.id, donorId: r.donor_id, donorName: r.donor_name,
      detail: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      value: "$" + Number(r.amount).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/my-stats/pipeline/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const [rows, totalRow] = await Promise.all([
    query(
      `SELECT id, name, stage, total_giving FROM donors
       WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL
       ORDER BY total_giving DESC LIMIT ?`,
      [orgId, userId, PAGE_SIZE]
    ),
    query(
      `SELECT COALESCE(SUM(total_giving),0) as total, COUNT(*) as cnt FROM donors
       WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL`,
      [orgId, userId]
    ),
  ]);
  res.json({
    total: Math.round(Number(totalRow[0]?.total || 0)),
    count: parseInt(totalRow[0]?.cnt || 0),
    rows: rows.map(d => ({
      donorId: d.id, donorName: d.name,
      detail: d.stage ? d.stage[0].toUpperCase() + d.stage.slice(1) : "",
      value: "$" + Number(d.total_giving || 0).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/my-stats/lapsed/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT id, name, total_giving, last_gift_date FROM donors
       WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL
       ORDER BY total_giving DESC LIMIT ?`,
      [orgId, userId, PAGE_SIZE]
    ),
    query(
      "SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL",
      [orgId, userId]
    ),
  ]);
  res.json({
    count: parseInt(countRow[0]?.cnt || 0),
    rows: rows.map(d => ({
      donorId: d.id, donorName: d.name,
      detail: d.last_gift_date ? `Last gave ${new Date(d.last_gift_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "No gift date on file",
      value: "$" + Number(d.total_giving || 0).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/today", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const ninetyDaysAgo = new Date(today - 90 * 86400000).toISOString().split("T")[0];
  const items = [];
  const [orgReceiptRow] = await query("SELECT receipts_enabled FROM orgs WHERE id=?", [orgId]);
  const receiptsEnabled = !!orgReceiptRow?.receipts_enabled;

  // Ownership scoping — defaults to "this is MY job today" (the logged-in
  // user's own assigned donors), matching the existing assigned_to pattern
  // already used by GET /donors/my and /dashboard/my-stats. ?scope=all opts
  // into the previous org-wide behavior for anyone who legitimately needs
  // it (admins/directors) — additive, not a removal of that capability.
  // Every donor-touching bucket below applies the same `scopeClause`/
  // `scopeParams` fragment so the whole unified queue honors one rule.
  const scope = req.query.scope === "all" ? "all" : "mine";
  const scopeClause = scope === "mine" ? "AND d.assigned_to = ?" : "";
  const scopeParams = scope === "mine" ? [userId] : [];
  // Each bucket below can produce a reason for a donor another bucket
  // already claimed. The queue is meant to be one ranked, unified list, so
  // the higher-priority reason should always win regardless of which
  // bucket happened to run first — not whichever bucket got there first.
  const upsertItem = item => {
    const existingIdx = items.findIndex(i => i.donorId === item.donorId);
    if (existingIdx === -1) items.push(item);
    else if (items[existingIdx].priority < item.priority) items[existingIdx] = item;
  };

  // Single source of truth for "at risk" — shared with the 'at_risk'
  // auto-enroll trigger (see computeAtRiskCandidates/autoEnroll in
  // server.js) so this display flag and the real-time draft trigger can
  // never drift into two different definitions of the same thing.
  const atRiskDonorIds = new Set((await computeAtRiskCandidates(orgId)).map(x => x.id));

  // Donors in active stages with no recent contact
  const noContact = await query(`
    SELECT d.id, d.name, d.total_giving, d.last_gift_date, d.last_gift_amount, d.stage,
           MAX(i.date) AS last_contact
    FROM donors d
    LEFT JOIN interactions i ON i.donor_id = d.id AND i.type != 'email_open'
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.stage NOT IN ('prospect','lapsed') ${scopeClause}
    GROUP BY d.id, d.name, d.total_giving, d.last_gift_date, d.last_gift_amount, d.stage
    HAVING MAX(i.date) < ? OR MAX(i.date) IS NULL
    ORDER BY COALESCE(d.total_giving, 0) DESC
    LIMIT 20
  `, [orgId, ...scopeParams, ninetyDaysAgo]);

  for (const d of noContact) {
    const daysSinceContact = d.last_contact
      ? Math.floor((today - new Date(d.last_contact)) / 86400000) : null;
    const daysSinceGift = d.last_gift_date
      ? Math.floor((today - new Date(d.last_gift_date)) / 86400000) : null;
    const totalGiving = parseFloat(d.total_giving) || 0;
    const lastAmt = parseFloat(d.last_gift_amount) || 0;

    const isLapsing = atRiskDonorIds.has(d.id);
    let reason, action;
    if (isLapsing) {
      reason = `Gave $${lastAmt.toLocaleString()} — last gift ${daysSinceGift} days ago, lapsing risk`;
      action = "call";
    } else if (daysSinceContact) {
      const prefix = totalGiving > 0 ? `Gave $${totalGiving.toLocaleString()} total — ` : "";
      reason = `${prefix}no contact in ${daysSinceContact} days`;
      action = totalGiving >= 5000 ? "call" : "email";
    } else {
      reason = d.stage === "qualify"
        ? "New prospect — no contact yet. First outreach sets the tone."
        : "In your portfolio — no outreach logged yet. Make a strong first impression.";
      action = "call";
    }

    const priority = Math.min(50, totalGiving / 5000)
      + (isLapsing ? 30 : 0)
      + (daysSinceContact && daysSinceContact > 180 ? 20 : 0);

    upsertItem({ donorId: d.id, donorName: d.name, reason, priority, action, totalGiving, isLapsing });
  }

  // Lapsed donors — explicitly excluded from the no-contact bucket above
  // (which only looks at active stages), but the queue is meant to unify
  // lapsed/no-contact/overdue-task/milestone in one ranked list, so they
  // need their own bucket rather than never appearing at all.
  const lapsedDonorRows = await query(`
    SELECT id, name, total_giving, last_gift_date
    FROM donors d
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.stage = 'lapsed' ${scopeClause}
    ORDER BY total_giving DESC
    LIMIT 5
  `, [orgId, ...scopeParams]);
  for (const l of lapsedDonorRows) {
    const daysSince = l.last_gift_date ? Math.floor((today - new Date(l.last_gift_date)) / 86400000) : null;
    const totalGiving = parseFloat(l.total_giving) || 0;
    const lapsedItem = {
      donorId: l.id, donorName: l.name,
      reason: `Lapsed — ${daysSince != null ? `last gift ${daysSince} days ago` : "no gift on record"}${totalGiving > 0 ? `, $${totalGiving.toLocaleString()} lifetime value` : ""}`,
      priority: 60 + Math.min(20, totalGiving / 5000), action: "lapsed",
      totalGiving, isLapsing: true,
    };
    upsertItem(lapsedItem);
  }

  // Unacknowledged recent gifts (need a thank-you)
  const unacked = await query(`
    SELECT g.id AS gift_id, g.amount, g.date, d.id AS donor_id, d.name AS donor_name, d.total_giving
    FROM gifts g
    JOIN donors d ON d.id = g.donor_id
    WHERE d.org_id = ?
      AND (g.acknowledgement_sent = false OR g.acknowledgement_sent IS NULL)
      AND g.date >= ? ${scopeClause}
    ORDER BY g.amount DESC
    LIMIT 5
  `, [orgId, ninetyDaysAgo, ...scopeParams]);

  for (const g of unacked) {
    const giftDate = new Date(g.date).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    upsertItem({
      donorId: g.donor_id, donorName: g.donor_name,
      reason: `Gave $${Number(g.amount).toLocaleString()} on ${giftDate} — not yet thanked`,
      priority: 75, action: "thank",
      totalGiving: parseFloat(g.total_giving) || 0,
    });
  }

  // Tax receipts — $250+ gifts with no acknowledgment yet (see CLAUDE.md
  // "Tax receipting"), org has receipts enabled, gift within the last 60
  // days. Online gifts auto-receipt near-instantly via the webhook (which
  // sets acknowledgement_sent=true), so in practice this bucket only ever
  // surfaces offline/manually-entered gifts, which never auto-receipt.
  // Deliberately priority 76, not 75 — one point above the "not yet
  // thanked" bucket above, so a legally-required receipt wins the
  // upsertItem tie (strict `<` — equal priorities keep whichever bucket
  // ran first) when both could apply to the same offline gift.
  if (receiptsEnabled) {
    const sixtyDaysAgo = new Date(today - 60 * 86400000).toISOString().split("T")[0];
    const needsReceipt = await query(`
      SELECT g.id AS gift_id, g.amount, g.date, d.id AS donor_id, d.name AS donor_name, d.total_giving
      FROM gifts g
      JOIN donors d ON d.id = g.donor_id
      WHERE d.org_id = ?
        AND g.amount >= 250
        AND (g.acknowledgement_sent = false OR g.acknowledgement_sent IS NULL)
        AND (g.is_sample IS NOT TRUE)
        AND g.date >= ? ${scopeClause}
      ORDER BY g.amount DESC
      LIMIT 5
    `, [orgId, sixtyDaysAgo, ...scopeParams]);

    for (const g of needsReceipt) {
      const giftDate = new Date(g.date).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      upsertItem({
        donorId: g.donor_id, donorName: g.donor_name,
        reason: `Gift of $${Number(g.amount).toLocaleString()} on ${giftDate} needs a tax receipt`,
        priority: 76, action: "receipt", giftId: g.gift_id,
        totalGiving: parseFloat(g.total_giving) || 0,
      });
    }

    // Receipt/gift mismatch — a gift was edited (amount or date) or
    // deleted after its receipt already issued. See PUT/DELETE /gifts/:id:
    // deliberately never auto-voided, staff reviews and voids+reissues on
    // purpose, since a receipt is a legal record of what was actually
    // sent — not something that should silently change to match an edit.
    // LEFT JOIN (not JOIN) so a deleted gift (g.id IS NULL) is caught too,
    // not just an amount/date edit on a gift that still exists.
    const mismatched = await query(`
      SELECT r.id AS receipt_id, r.receipt_number, r.amount AS receipt_amount,
             g.amount AS gift_amount, d.id AS donor_id, d.name AS donor_name, d.total_giving
      FROM receipts r
      LEFT JOIN gifts g ON g.id = r.gift_id
      JOIN donors d ON d.id = r.donor_id
      WHERE r.org_id = ? AND r.type = 'gift' AND r.voided_at IS NULL
        AND (g.id IS NULL OR r.amount != g.amount OR (r.snapshot->>'giftDateRaw') != g.date)
        ${scopeClause}
      LIMIT 5
    `, [orgId, ...scopeParams]);

    for (const m of mismatched) {
      const reason = m.gift_amount == null
        ? `Receipt #${m.receipt_number} — the gift it was issued for has been deleted — review`
        : `Receipt #${m.receipt_number} no longer matches its gift ($${Number(m.receipt_amount).toLocaleString()} receipted vs. $${Number(m.gift_amount).toLocaleString()} now on the gift) — review`;
      upsertItem({
        donorId: m.donor_id, donorName: m.donor_name,
        reason, priority: 70, action: "receipt_mismatch", receiptId: m.receipt_id,
        totalGiving: parseFloat(m.total_giving) || 0,
      });
    }
  }

  // Overdue donor-linked tasks
  const dueTasks = await query(`
    SELECT t.id, t.title, t.due, t.priority AS task_priority, t.type AS task_type, t.donor_id, d.name AS donor_name, d.total_giving
    FROM tasks t
    JOIN donors d ON d.id = t.donor_id
    WHERE t.org_id = ? AND done=0 AND t.due <= ? ${scopeClause}
    ORDER BY t.due ASC
    LIMIT 5
  `, [orgId, todayStr, ...scopeParams]);

  for (const t of dueTasks) {
    const daysOverdue = t.due && t.due < todayStr
      ? Math.floor((today - new Date(t.due)) / 86400000) : 0;
    upsertItem({
      donorId: t.donor_id, donorName: t.donor_name,
      reason: `Task: "${t.title}"`,
      priority: 90, action: "call",
      totalGiving: parseFloat(t.total_giving) || 0,
      daysOverdue,
      taskId: t.id, taskTitle: t.title, taskDue: t.due, taskPriority: t.task_priority, taskType: t.task_type,
    });
  }

  // Milestone-ready donors — pending AI-drafted stewardship emails awaiting
  // staff review (see milestone_drafts / retention feature). Unified into
  // the same ranked queue as lapsed/no-contact/overdue-task reasons so this
  // one endpoint is the single source for "needs your attention".
  const milestoneRows = await query(`
    SELECT md.id AS draft_id, md.donor_id, md.subject, md.created_at, d.name AS donor_name, d.total_giving
    FROM milestone_drafts md
    JOIN donors d ON d.id = md.donor_id
    WHERE md.org_id = ? AND md.status = 'pending_review' ${scopeClause}
    ORDER BY md.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]);

  for (const m of milestoneRows) {
    const milestoneItem = {
      donorId: m.donor_id, donorName: m.donor_name,
      reason: `Milestone email drafted — "${m.subject}" ready for review`,
      priority: 80, action: "milestone",
      totalGiving: parseFloat(m.total_giving) || 0,
      draftId: m.draft_id,
    };
    upsertItem(milestoneItem);
  }

  // At-risk re-engagement drafts — pending, unreviewed AI-drafted emails
  // queued by the 'at_risk' auto-enroll trigger (see computeAtRiskCandidates
  // / autoEnroll below) for a donor who just crossed into the earliest,
  // most-recoverable risk window. These share the milestone_drafts table
  // (milestone_key='at_risk') and so are already caught by the generic
  // bucket above with the generic "Milestone email drafted" reason — this
  // bucket re-upserts the same donor with a distinct reason and a priority
  // just above it (81 > 80) so staff can tell "just flagged today, draft
  // ready" apart from a plain milestone draft or a bare no-contact reason.
  const atRiskDraftRows = await query(`
    SELECT md.id AS draft_id, md.donor_id, d.name AS donor_name, d.total_giving
    FROM milestone_drafts md
    JOIN donors d ON d.id = md.donor_id
    WHERE md.org_id = ? AND md.status = 'pending_review' AND md.milestone_key = 'at_risk' ${scopeClause}
    ORDER BY md.created_at DESC
    LIMIT 10
  `, [orgId, ...scopeParams]);

  for (const a of atRiskDraftRows) {
    upsertItem({
      donorId: a.donor_id, donorName: a.donor_name,
      reason: "Flagged today — AI-drafted re-engagement email ready for review",
      priority: 81, action: "milestone",
      totalGiving: parseFloat(a.total_giving) || 0,
      draftId: a.draft_id, isLapsing: true,
    });
  }

  // Personal-note reminders — the "write a note" sibling of the milestone
  // drafts above. Priority 82: a hair above milestone-drafted emails (80),
  // since these represent the org's highest-value/most-personal moments by
  // design (see isNoteMoment()).
  const noteReminderRows = await query(`
    SELECT nr.id AS reminder_id, nr.donor_id, nr.talking_points, nr.created_at, d.name AS donor_name, d.total_giving
    FROM note_reminders nr
    JOIN donors d ON d.id = nr.donor_id
    WHERE nr.org_id = ? AND nr.status = 'pending' ${scopeClause}
    ORDER BY nr.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]);

  for (const n of noteReminderRows) {
    const points = typeof n.talking_points === "string" ? JSON.parse(n.talking_points) : n.talking_points;
    upsertItem({
      donorId: n.donor_id, donorName: n.donor_name,
      reason: "Worth a personal note — see talking points",
      priority: 82, action: "note",
      totalGiving: parseFloat(n.total_giving) || 0,
      reminderId: n.reminder_id, talkingPoints: points || [],
    });
  }

  // At-risk recurring gifts — failed/retrying donor subscriptions. This is
  // real, already-identified revenue actively draining away that the
  // nonprofit would otherwise never notice (see CLAUDE.md "Recurring gift
  // recovery"), so it's folded into the same ranked queue rather than living
  // only on a separate report.
  const atRiskSubs = await query(`
    SELECT rs.donor_id, rs.stripe_subscription_id, rs.amount, rs.interval, d.name AS donor_name, d.total_giving
    FROM recurring_subscriptions rs
    JOIN donors d ON d.id = rs.donor_id
    WHERE rs.org_id = ? AND rs.status IN ('past_due','recovering') ${scopeClause}
    ORDER BY rs.amount DESC NULLS LAST
    LIMIT 5
  `, [orgId, ...scopeParams]);
  for (const rs of atRiskSubs) {
    const amountStr = rs.amount != null ? `$${Number(rs.amount).toLocaleString()}/${rs.interval === "year" ? "yr" : "mo"}` : "a recurring gift";
    upsertItem({
      donorId: rs.donor_id, donorName: rs.donor_name,
      reason: `Recurring gift failed — ${amountStr} at risk`,
      priority: 85, action: "recurring",
      totalGiving: parseFloat(rs.total_giving) || 0,
      subscriptionId: rs.stripe_subscription_id,
    });
  }

  // BUILD-45 §6.3 drift wire — a donor who canceled or paused their recurring
  // gift FROM THE PORTAL in the last 7 days is a "needs you today" item. A
  // cancellation the org learns about in minutes is a save opportunity; one it
  // discovers at month-end is a lapse statistic. Outranks the failed-card
  // bucket (85): this donor made a deliberate choice minutes-to-days ago.
  const portalDrift = await query(`
    SELECT DISTINCT ON (pal.donor_id) pal.donor_id, pal.action, pal.created_at,
           d.name AS donor_name, d.total_giving,
           rs.amount, rs.interval
    FROM portal_audit_log pal
    JOIN donors d ON d.id = pal.donor_id AND d.org_id = pal.org_id AND d.deleted_at IS NULL
    LEFT JOIN recurring_subscriptions rs ON rs.id = (pal.meta->>'subId') AND rs.org_id = pal.org_id
    WHERE pal.org_id = ? AND pal.action IN ('recurring_cancel','recurring_pause')
      AND pal.created_at > NOW() - INTERVAL '7 days' ${scopeClause}
    ORDER BY pal.donor_id, pal.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]).catch(() => []);
  for (const pd of portalDrift) {
    const verb = pd.action === "recurring_cancel" ? "canceled" : "paused";
    const amountStr = pd.amount != null ? `$${Number(pd.amount).toLocaleString()}/${pd.interval === "year" ? "yr" : "mo"}` : "their recurring gift";
    upsertItem({
      donorId: pd.donor_id, donorName: pd.donor_name,
      reason: `${verb === "canceled" ? "Canceled" : "Paused"} ${amountStr} via the portal — reach out today, thank them, learn what changed`,
      priority: 88, action: "call",
      totalGiving: parseFloat(pd.total_giving) || 0,
    });
  }

  // Matching-gift opportunities — a recent donor whose employer has a known
  // matching-gift program (see matchingGifts.js), real dollar upside for a
  // simple ask. Low priority relative to everything above (failed payments,
  // overdue tasks, drafted emails): this is a nice-to-have opportunity, not
  // time-sensitive, so it should never crowd out those. Only considered for
  // donors not already claimed by a higher-priority bucket above — computed
  // as a hard exclusion (not just a priority contest), matching "isn't
  // already flagged for something else."
  const alreadyFlaggedIds = new Set(items.map(i => i.donorId));
  const employerDonorRows = await query(`
    SELECT d.id, d.name, d.employer, d.total_giving, d.last_gift_amount, d.last_gift_date
    FROM donors d
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.employer IS NOT NULL AND d.employer <> '' AND d.last_gift_date >= ? ${scopeClause}
    ORDER BY d.last_gift_date DESC
    LIMIT 30
  `, [orgId, ninetyDaysAgo, ...scopeParams]);
  let matchingGiftCount = 0;
  for (const d of employerDonorRows) {
    if (matchingGiftCount >= 5) break;
    if (alreadyFlaggedIds.has(d.id)) continue;
    const match = lookupMatchingGift(d.employer);
    if (!match) continue;
    upsertItem({
      donorId: d.id, donorName: d.name,
      reason: `${match.companyName} matches employee gifts ${match.ratio} — ask about submitting a match request`,
      priority: 30, action: "matching_gift",
      totalGiving: parseFloat(d.total_giving) || 0,
      matchCompany: match.companyName, matchRatio: match.ratio,
    });
    matchingGiftCount++;
  }

  items.sort((a, b) => b.priority - a.priority);
  res.json(items.slice(0, 10));
}));

// ── Fundraising goals (home screen goal banner) ─────────────────────────────
app.get("/goals/active", requireAuth, wrap(async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const rows = await query(
    "SELECT * FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY created_at DESC LIMIT 1",
    [req.user.orgId, today, today]
  );
  if (!rows.length) return res.json(null);
  const goal = rows[0];
  const goalAmount = parseFloat(goal.goal_amount) || 0;

  let currentAmount = 0;
  if (goal.goal_type === "lapsed_recovery") {
    // A gift counts toward recovery when it's a donor's most recent gift in
    // the period AND it followed a gap of more than 365 days since their
    // prior gift — i.e. it's the gift that actually pulled them back from
    // lapsed, reconstructed from gift history rather than a stage-history
    // table (which doesn't exist).
    const rows2 = await query(
      `SELECT COALESCE(SUM(g.amount),0) AS total
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       WHERE g.org_id = ? AND g.date >= ? AND g.date <= ? AND g.date = d.last_gift_date
         AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date) IS NOT NULL
         AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date)::date > 365`,
      [req.user.orgId, goal.period_start, goal.period_end]
    );
    currentAmount = parseFloat(rows2[0]?.total) || 0;
  } else {
    const rows2 = await query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?",
      [req.user.orgId, goal.period_start, goal.period_end]
    );
    currentAmount = parseFloat(rows2[0]?.total) || 0;
  }

  const percent = goalAmount > 0 ? Math.min(100, Math.round((currentAmount / goalAmount) * 100)) : 0;
  // Uncapped truth + overage, so the Home hero reads a beaten goal as a win
  // ("Goal met · 302% · $50k over") instead of a misleading flat 100%.
  const rawPercent = goalAmount > 0 ? Math.round((currentAmount / goalAmount) * 100) : 0;
  const over = goalAmount > 0 && currentAmount > goalAmount ? currentAmount - goalAmount : 0;

  // Trailing-7-day slice of the same real activity above — powers the Home
  // hero banner's "what's driving this" hint with actual recent gifts
  // instead of an invented/decorative line. Bounded to stay inside the
  // goal's own period so it never reaches back before period_start.
  let recentAmount = 0, recentDonorCount = 0;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
  const recentStart = sevenDaysAgoStr > goal.period_start ? sevenDaysAgoStr : goal.period_start;
  if (recentStart <= today) {
    if (goal.goal_type === "lapsed_recovery") {
      const rows3 = await query(
        `SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(DISTINCT g.donor_id) AS donors
         FROM gifts g
         JOIN donors d ON d.id = g.donor_id
         WHERE g.org_id = ? AND g.date >= ? AND g.date <= ? AND g.date = d.last_gift_date
           AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date) IS NOT NULL
           AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date)::date > 365`,
        [req.user.orgId, recentStart, today]
      );
      recentAmount = parseFloat(rows3[0]?.total) || 0;
      recentDonorCount = parseInt(rows3[0]?.donors, 10) || 0;
    } else {
      const rows3 = await query(
        "SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT donor_id) AS donors FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?",
        [req.user.orgId, recentStart, today]
      );
      recentAmount = parseFloat(rows3[0]?.total) || 0;
      recentDonorCount = parseInt(rows3[0]?.donors, 10) || 0;
    }
  }

  res.json({
    label: goal.label, goalType: goal.goal_type, goalAmount, currentAmount, percent, rawPercent, over,
    periodStart: goal.period_start, periodEnd: goal.period_end,
    recentAmount, recentDonorCount,
  });
}));

app.post("/goals", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { label, goalAmount, goalType, periodStart, periodEnd } = req.body;
  if (!label || !goalAmount || !goalType || !periodStart || !periodEnd) {
    return res.status(400).json({ error: "label, goalAmount, goalType, periodStart, and periodEnd required" });
  }
  if (!["lapsed_recovery", "total_raised"].includes(goalType)) {
    return res.status(400).json({ error: "goalType must be lapsed_recovery or total_raised" });
  }
  const id = "goal_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label) VALUES (?,?,?,?,?,?,?)",
    [id, req.user.orgId, periodStart, periodEnd, goalType, parseFloat(goalAmount), label]
  );
  res.status(201).json({ id });
}));

// Computes both metrics live (so the number shown is never stale), persists
// today's snapshot for this org (so the trend line fills in as the page
// gets viewed, on top of the periodic background job), and returns the
// last 30 days of history for each.
// Wipes the org's own metric-trend history and re-snapshots today from live
// data. Built for baseline pollution (BUILD-06 Phase E): after a mass
// purge-trash (e.g. the CREO 3,905-test-donor cleanup), the Home trends
// compared real data against snapshots of deleted test data ("↓1,153 vs 3
// weeks ago"). Org-scoped + admin — an org resetting its own analytics
// baseline is its own business; trends read "no trend data yet" until real
// history re-accumulates, which is the honest state.
app.post("/metrics/reset-baselines", requireAuth, requireAdmin, wrap(async (req, res) => {
  const del = await run("DELETE FROM metric_snapshots WHERE org_id = ?", [req.user.orgId]);
  await snapshotMetricsForOrg(req.user.orgId);
  res.json({ deleted: del.changes, resnapshotted: true });
}));

app.get("/metrics/stewardship-summary", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // ?scope=mine (default) scopes Debt/Retention to the logged-in user's own
  // assigned donors, same as GET /dashboard/today; ?scope=all is org-wide.
  // Only the "current" figures are scoped — the trend/sparkline history
  // below stays org-wide (metric_snapshots has no per-user dimension, and
  // building one is out of scope here), and a scoped read is never persisted
  // as a snapshot, so one user's "mine" view can't pollute the org's daily
  // trend. First-Touch Delay is intentionally left unscoped.
  const scope = req.query.scope === "all" ? "all" : "mine";
  const debt = scope === "all" ? await snapshotMetricsForOrg(orgId) : await computeStewardshipDebt(orgId, { userId });
  const firstTouch = await computeFirstTouchDelay(orgId);
  const retention = scope === "all" ? await computeRetentionRate(orgId) : await computeRetentionRate(orgId, { userId });

  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const debtTrend = await query(
    "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='stewardship_debt' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
    [orgId, sinceStr]
  );
  const touchTrend = await query(
    "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='first_touch_delay' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
    [orgId, sinceStr]
  );
  const retentionTrend = await query(
    "SELECT snapshot_date, value FROM metric_snapshots WHERE org_id=? AND metric_key='retention_rate' AND snapshot_date >= ? ORDER BY snapshot_date ASC",
    [orgId, sinceStr]
  );

  const trendDelta = trend => trend.length >= 2 ? Math.round(Number(trend[trend.length - 1].value) - Number(trend[0].value)) : null;

  res.json({
    stewardshipDebt: { current: debt, trend: debtTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(debtTrend) },
    firstTouchDelay: { current: firstTouch.avgDays, sampleSize: firstTouch.sampleSize, untouchedCount: firstTouch.untouchedCount, newestUntouched: firstTouch.newestUntouched, trend: touchTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(touchTrend) },
    retentionRate: {
      current: retention.retentionRate, sectorAverage: SECTOR_AVG_RETENTION_RATE,
      retained: retention.retained, prevYearCount: retention.prevYearCount,
      // Lets the client tell "0% because nothing has been logged this year
      // yet" (day-one org, too early to measure) apart from a genuine 0%.
      thisYearCount: retention.thisYearCount,
      trend: retentionTrend.map(r => ({ date: r.snapshot_date, value: Number(r.value) })), deltaVsTrendStart: trendDelta(retentionTrend),
    },
  });
}));

// Ranked, per-donor drill-down behind the Stewardship Debt headline number —
// every donor with total_giving > 0 has a precise, individually-attributable
// contribution to that aggregate (see computeStewardshipDebtBreakdown), so
// this surfaces it directly instead of leaving it as one opaque figure.
// Capped at a page size since a large org could have hundreds of qualifying
// donors; `count` is the true total so the UI can say "top 50 of 214".
app.get("/dashboard/stewardship-debt/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const scope = req.query.scope === "all" ? "all" : "mine";
  const breakdown = await computeStewardshipDebtBreakdown(orgId, scope === "mine" ? { userId } : {});
  const total = breakdown.reduce((sum, d) => sum + d.contribution, 0);
  const rows = breakdown.slice(0, PAGE_SIZE).map(d => ({
    donorId: d.donorId,
    donorName: d.donorName,
    totalGiving: d.totalGiving,
    daysSinceContact: d.daysSinceContact,
    contribution: Math.round(d.contribution * 10) / 10,
    percentOfTotal: total > 0 ? Math.round((d.contribution / total) * 1000) / 10 : 0,
  }));
  res.json({ total: Math.round(total), count: breakdown.length, rows });
}));

// Ranked drill-down behind the Retention Rate headline number — the actual
// donors who gave last year but haven't given again this year, i.e. the
// specific list dragging the rate down. Shares computeRetentionRate's exact
// donor-set math (thisYearDonorIds/prevYearDonorIds) so the headline % and
// this list can never disagree: nonRetained.length always equals
// prevYearCount - retained by construction (set difference vs set
// intersection of the same two sets).
app.get("/dashboard/retention/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const scope = req.query.scope === "all" ? "all" : "mine";
  const retention = await computeRetentionRate(orgId, scope === "mine" ? { userId } : {});
  const nonRetainedIds = [...retention.prevYearDonorIds].filter(id => !retention.thisYearDonorIds.has(id));

  let rows = [];
  if (nonRetainedIds.length) {
    const donorRows = await query(
      `SELECT id, name, last_gift_amount, last_gift_date FROM donors
       WHERE org_id = ? AND deleted_at IS NULL AND id IN (${nonRetainedIds.map(() => "?").join(",")})`,
      [orgId, ...nonRetainedIds]
    );
    rows = donorRows
      .sort((a, b) => new Date(b.last_gift_date || 0) - new Date(a.last_gift_date || 0))
      .slice(0, PAGE_SIZE)
      .map(d => ({
        donorId: d.id,
        donorName: d.name,
        lastGiftAmount: Number(d.last_gift_amount) || 0,
        lastGiftDate: d.last_gift_date,
      }));
  }

  res.json({
    retentionRate: retention.retentionRate, sectorAverage: SECTOR_AVG_RETENTION_RATE,
    retained: retention.retained, prevYearCount: retention.prevYearCount,
    year: retention.year, prevYear: retention.prevYear,
    nonRetainedCount: nonRetainedIds.length, rows,
  });
}));

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
    "SELECT * FROM donors WHERE org_id=? AND status='lapsed' AND deleted_at IS NULL ORDER BY last_gift_date ASC LIMIT 5",
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
      content: `Map these CSV column headers to donor fields. Available target fields: name, _firstName, _lastName, email, phone, total, lastAmount, lastGift, gifts, status, city, state, notes. Use empty string to skip a column. Use _firstName/_lastName when separate first/last name columns are present instead of a single name column.

RULES — follow these strictly:
1. Negation/flag columns: if a header signals a negation or opt-out ("do not email", "do not call", "do not mail", "opt out", "unsubscribe", "do not contact", or any similar phrasing), map it to "" (skip) or "notes" — NEVER to the contact field it negates (email, phone, etc.).
2. Email shape check: only map a column to "email" if the sample values actually look like email addresses (contain "@"). If the sample values are "Yes", "No", blank, or anything without "@", map to "" instead.
3. Phone shape check: only map a column to "phone" if the sample values contain digits that look like phone numbers.
4. Use the sample row values below to verify these shape rules before assigning a field.

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
  const donors = await query("SELECT * FROM donors WHERE org_id = ? AND deleted_at IS NULL", [req.user.orgId]);
  const scored = donors.map(d => {
    let score = 0;

    if      (d.total_giving > 20000) score += 35;
    else if (d.total_giving > 5000)  score += 22;
    else if (d.total_giving > 1000)  score += 12;
    else                             score += 5;

    // Unguarded new Date(null) silently evaluates to the 1970 epoch (a huge,
    // wrong "days since" value that happened to fall through all three bands
    // below without erroring) — null-guard so a missing last_gift_date just
    // skips the recency bonus instead of relying on that coincidence.
    const days = d.last_gift_date ? Math.floor((Date.now() - new Date(d.last_gift_date)) / 86_400_000) : null;
    if (days !== null) {
      if      (days < 90)  score += 30;
      else if (days < 180) score += 22;
      else if (days < 365) score += 12;
    }

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
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.DEMO_SMTP_FROM;
  const to     = process.env.DEMO_NOTIFY_EMAIL;

  const cfg = {
    host: "smtp.resend.com", port: 465, user: "resend",
    pass: apiKey ? "set" : "MISSING",
    from: from || "MISSING",
    to:   to   || "MISSING",
  };

  if (!apiKey) return res.json({ success: false, error: "RESEND_API_KEY env var not set", config: cfg });
  if (!from)   return res.json({ success: false, error: "DEMO_SMTP_FROM env var not set (verified-domain from address)", config: cfg });
  if (!to)     return res.json({ success: false, error: "DEMO_NOTIFY_EMAIL env var not set", config: cfg });

  try {
    console.log("[test-smtp] sending via Resend HTTP API…", cfg);
    const { data, error } = await resend.emails.send({
      from, to,
      subject: "Steward SMTP test",
      html: "<p>SMTP is working. This is a test from your <strong>Steward ERP</strong>.</p>",
    });
    if (error) throw new Error(error.message);
    console.log("[test-smtp] sent OK — id:", data.id);
    res.json({ success: true, id: data.id, from, to, config: cfg });
  } catch (err) {
    console.error("[test-smtp] FAILED:", err.message);
    res.json({ success: false, error: { message: err.message }, config: cfg });
  }
}));

// ── Email suppression & unsubscribe ─────────────────────────────────────────
// Signed, no-login-required unsubscribe tokens. HMAC (not full JWT) is enough
// here — the payload only needs tamper-proofing, not the extra claims/expiry
// machinery a JWT brings. Reuses the same secret auth.js signs session tokens
// with (same dev-only fallback, gated the same way) rather than introducing a
// second secret to provision.
const UNSUB_SECRET = process.env.JWT_SECRET || "nonprofit_erp_secret_dev";

function signUnsubscribeToken(email, orgId, source) {
  const payload = Buffer.from(JSON.stringify({
    email: String(email).toLowerCase(),
    orgId: orgId || null,
    source: source === "sequence" ? "sequence" : "campaign",
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", UNSUB_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", UNSUB_SECRET).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!decoded.email) return null;
    return decoded;
  } catch { return null; }
}

function buildUnsubscribeUrl(email, orgId, source) {
  // The canonical domain, NOT the raw API host: /unsubscribe is proxied to
  // this server by the vercel.json rewrite, so the link a donor sees (and
  // hovers) is stewardapp.dev. Same rule as every other email link.
  return `${publicAppUrl()}/unsubscribe?token=${signUnsubscribeToken(email, orgId, source)}`;
}

// CAN-SPAM requires the sender's physical postal address in commercial email,
// so the footer carries it alongside the unsubscribe link. Sourced live from
// the org's tax-receipt settings (orgs.receipt_address, BUILD-01) so there is
// exactly one address to maintain; async because it looks the org up itself —
// one pk lookup per send, trivial next to the Resend HTTP call, and it means
// no send path can miss the address by forgetting a column in its org SELECT.
// An org that hasn't filled in receipt_address yet degrades to the old
// unsubscribe-only footer (Communications shows admins a Settings prompt
// until they add it).
async function unsubscribeEmailFooterHtml(email, orgId, source) {
  const url = buildUnsubscribeUrl(email, orgId, source);
  let addressLine = "";
  const orgRows = await query("SELECT name, legal_name, receipt_address FROM orgs WHERE id = ?", [orgId]);
  const org = orgRows[0];
  if (org?.receipt_address) {
    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const address = esc(org.receipt_address).replace(/\r?\n+/g, ", ");
    addressLine = `<div style="margin-bottom:6px;">${esc(org.legal_name || org.name || "")} · ${address}</div>`;
  }
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#8fa896;">
    ${addressLine}<a href="${url}" style="color:#8fa896;text-decoration:underline;">Unsubscribe</a> from these emails.
  </div>`;
}

// Branded email header band (BUILD-13 Part 2) — the org's logo + name on its
// accent color, above the message body. Tasteful: one slim band, still inside
// Steward's typographic frame. Falls back to a plain org-name band (Steward
// green) when no accent is set, and to nothing if the org can't be resolved.
// async (a DB lookup), like unsubscribeEmailFooterHtml — every caller awaits.
async function brandEmailHeaderHtml(orgId) {
  const rows = await query("SELECT name, legal_name, logo_data, brand_accent, brand_accent_fg FROM orgs WHERE id = ?", [orgId]);
  const org = rows[0];
  if (!org) return "";
  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const accent = org.brand_accent || "#1a6b4a";
  const fg = org.brand_accent_fg || "#ffffff";
  const name = esc(displayNameCase(org.legal_name || org.name || ""));
  const logo = (org.logo_data && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(org.logo_data))
    ? `<img src="${org.logo_data}" alt="${name}" height="34" style="height:34px;max-width:150px;vertical-align:middle;border:0;display:inline-block;margin-right:10px;" />`
    : "";
  return `<div style="background:${accent};padding:16px 22px;border-radius:12px 12px 0 0;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <span style="display:inline-block;vertical-align:middle;">${logo}</span><span style="color:${fg};font-size:17px;font-weight:700;vertical-align:middle;">${name}</span>
  </div>`;
}

// List-Unsubscribe headers (RFC 8058) so Gmail/Outlook render a native
// one-click unsubscribe button. The mailto: address isn't monitored/processed —
// it's included only to satisfy the two-part format some older clients expect;
// modern one-click support (Gmail/Outlook) relies on the https: URL + POST below.
function unsubscribeHeaders(email, orgId, source) {
  const url = buildUnsubscribeUrl(email, orgId, source);
  return {
    "List-Unsubscribe": `<mailto:unsubscribe@stewardapp.dev>, <${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Returns the suppression reason ('unsubscribed'|'bounced'|'complained') if this
// address is suppressed for this org — either a global row (org_id IS NULL,
// from a bounce/complaint) or an org-scoped row (that org's own unsubscribe).
async function getSuppressionReason(email, orgId) {
  if (!email) return null;
  const rows = await query(
    `SELECT reason FROM email_suppressions
     WHERE LOWER(email) = LOWER(?) AND (org_id IS NULL OR org_id = ?)
     ORDER BY created_at DESC LIMIT 1`,
    [email, orgId || null]
  );
  return rows[0]?.reason || null;
}

async function recordUnsubscribe(email, orgId, source) {
  await run(
    "INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES (?,?,?,?,?)",
    ["sup_" + uuid().slice(0, 8), orgId || null, email.toLowerCase(), "unsubscribed", source === "sequence" ? "sequence" : "campaign"]
  );
  // Org-scoped unsubscribe only stops that org's sends; a global (webhook-sourced)
  // suppression stops sends from every org — mirror that scope in enrollment status.
  if (orgId) {
    await run(
      `UPDATE sequence_enrollments SET status='unsubscribed', completed_at=NOW()
       WHERE org_id = ? AND status='active' AND donor_id IN (
         SELECT id FROM donors WHERE org_id = ? AND email IS NOT NULL AND LOWER(email) = ?
       )`,
      [orgId, orgId, email.toLowerCase()]
    );
  } else {
    await run(
      `UPDATE sequence_enrollments SET status='unsubscribed', completed_at=NOW()
       WHERE status='active' AND donor_id IN (
         SELECT id FROM donors WHERE email IS NOT NULL AND LOWER(email) = ?
       )`,
      [email.toLowerCase()]
    );
  }
}

function unsubscribeHtml({ ok, email }) {
  const message = ok
    ? `<h1>You're unsubscribed</h1><p>${email ? `<strong>${email}</strong> ` : ""}won't receive any more emails from this list. It can take a few minutes to fully take effect.</p>`
    : `<h1>Link expired</h1><p>This unsubscribe link is invalid or has expired. If you're still receiving unwanted emails, reply to any message and ask to be removed.</p>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Unsubscribed — Steward</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:#f0ede6; font-family:'DM Sans',Helvetica,Arial,sans-serif; color:#0f1a12; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#ffffff; border-radius:16px; padding:40px; max-width:440px; width:100%; box-shadow:0 2px 20px rgba(15,26,18,0.08); text-align:center; }
  h1 { font-family:'DM Serif Display',Georgia,serif; font-size:26px; font-weight:400; margin:0 0 12px; letter-spacing:-0.02em; }
  p { font-size:15px; color:#6b7c72; line-height:1.6; margin:0; }
  .badge { width:48px; height:48px; background:#0f1a12; border-radius:12px; margin:0 auto 20px; display:flex; align-items:center; justify-content:center; }
  .badge span { font-family:'DM Serif Display',Georgia,'Times New Roman',serif; font-size:28px; font-weight:400; color:#f0ede6; line-height:1; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge"><span>S</span></div>
      ${message}
    </div>
  </div>
</body>
</html>`;
}

// GET — a human clicking the footer link in the email; renders a confirmation page.
app.get("/unsubscribe", wrap(async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.query.token);
  res.set("Content-Type", "text/html");
  if (!decoded) return res.status(400).send(unsubscribeHtml({ ok: false }));
  await recordUnsubscribe(decoded.email, decoded.orgId, decoded.source);
  res.send(unsubscribeHtml({ ok: true, email: decoded.email }));
}));

// POST — RFC 8058 one-click unsubscribe: Gmail/Outlook POST here silently
// (no page render) when the recipient taps the native unsubscribe button.
app.post("/unsubscribe", wrap(async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.query.token);
  if (!decoded) return res.status(400).end();
  await recordUnsubscribe(decoded.email, decoded.orgId, decoded.source);
  res.status(200).end();
}));

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

function verifyRecoveryToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!decoded.subscriptionId || !decoded.orgId) return null;
    return decoded;
  } catch { return null; }
}

function buildCardUpdateUrl(subscriptionId, orgId) {
  // Canonical domain via the vercel.json /recurring/update-card proxy rewrite
  // — the failed-card recovery email is exactly where a suspicious-looking
  // host would cost a recovery. See buildUnsubscribeUrl.
  return `${publicAppUrl()}/recurring/update-card?token=${signRecoveryToken(subscriptionId, orgId)}`;
}

// Idempotency for every recovery webhook path: Stripe's event.id is unique
// per logical event (a redelivered attempt reuses the same id), so checking
// whether it's already been logged is enough to make each handler a safe
// no-op on a duplicate delivery — no separate "processed events" table needed
// since payment_recovery_events already logs one row per meaningful thing
// that happened, keyed by that same id.
async function recoveryEventAlreadyProcessed(stripeEventId) {
  if (!stripeEventId) return false;
  const rows = await query("SELECT id FROM payment_recovery_events WHERE stripe_event_id=? LIMIT 1", [stripeEventId]);
  return rows.length > 0;
}

async function logRecoveryEvent(orgId, donorId, subscriptionId, type, stripeEventId, detail) {
  await run(
    `INSERT INTO payment_recovery_events (id, org_id, donor_id, subscription_id, type, stripe_event_id, detail)
     VALUES (?,?,?,?,?,?,?)`,
    ["pre_" + uuid().slice(0, 8), orgId, donorId || null, subscriptionId || null, type, stripeEventId || null, JSON.stringify(detail || {})]
  );
}

// Finds the org + donor for a Connect subscription/invoice event. Primary
// match is donors.stripe_subscription_id (set at subscription creation, see
// checkout.session.completed below); falls back to the donor_email carried
// in the subscription's own metadata for the edge case where a subscription's
// first-ever webhook is itself the failure (e.g. a pre-existing subscription
// from before this feature shipped, whose donor row was never linked).
async function resolveOrgAndDonorForSubscription(accountId, stripeSubscriptionId, subscriptionMetadata) {
  if (!accountId) return null;
  const orgRows = await query(
    "SELECT id, name, org_slug, recurring_dunning_enabled, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE stripe_account_id=?",
    [accountId]
  );
  if (!orgRows.length) return null;
  const org = orgRows[0];

  let donorRows = await query(
    "SELECT id, name, email FROM donors WHERE org_id=? AND stripe_subscription_id=?",
    [org.id, stripeSubscriptionId]
  );
  if (!donorRows.length && subscriptionMetadata?.donor_email) {
    donorRows = await query(
      "SELECT id, name, email FROM donors WHERE org_id=? AND email ILIKE ?",
      [org.id, subscriptionMetadata.donor_email]
    );
  }
  return { org, donor: donorRows[0] || null };
}

const DEFAULT_DUNNING_SUBJECT = "A quick fix to keep your support going";
// {{donor_name}}/{{first_name}}/{{org_name}}/{{amount}}/{{update_url}} tokens,
// same replacement convention as campaign/sequence bodies. Deliberately no
// "tier"/"level"/"badge"/"leaderboard" language anywhere — this is a
// stewardship touch, not a collections notice (see CLAUDE.md "Strategic pivot").
const DEFAULT_DUNNING_BODY = `<p>Hi {{first_name}},</p>
<p>Thank you again for your ongoing gift of {{amount}} to {{org_name}} — support like yours is what makes our work possible.</p>
<p>We tried to process your latest gift and the card on file didn't go through. This happens most often when a card has expired or been reissued, and it only takes a minute to fix.</p>
<p style="text-align:center;margin:28px 0;"><a href="{{update_url}}" style="background:#1a6b4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Update my card</a></p>
<p>If you have any questions, just reply to this email — we're glad to help.</p>
<p>With gratitude,<br/>{{org_name}}</p>`;

function applyDunningTokens(str, { donor, org, amount, updateUrl }) {
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  return (str || "")
    .replace(/{{donor_name}}/g, donor.name || "")
    .replace(/{{first_name}}/g, firstName)
    .replace(/{{org_name}}/g, displayNameCase(org.name) || "")
    .replace(/{{amount}}/g, amount != null ? `$${Number(amount).toLocaleString()}` : "your gift")
    .replace(/{{update_url}}/g, updateUrl);
}

// Sends the dunning email if the address isn't suppressed. The
// recurring_dunning_enabled org-level kill switch is checked by callers
// (processDunning / the manual resend route), not here, since a manual staff
// resend should still work even if an org has paused the automatic cadence.
async function sendDunningEmail(org, donor, subscriptionRow) {
  const suppressReason = await getSuppressionReason(donor.email, org.id);
  if (suppressReason) {
    console.log(`[dunning] skipping suppressed address ${donor.email} (${suppressReason})`);
    return false;
  }
  const updateUrl = buildCardUpdateUrl(subscriptionRow.stripe_subscription_id, org.id);
  const tokenCtx = { donor, org, amount: subscriptionRow.amount, updateUrl };
  const subject = applyDunningTokens(org.recurring_dunning_subject || DEFAULT_DUNNING_SUBJECT, tokenCtx);
  // BUILD-45 §6.3 — when the org's donor portal is enabled, the recovery email
  // also links the donor into their portal (magic-link sign-in — no staff, no
  // password) so they can fix the card or manage the gift themselves.
  let portalLine = "";
  try {
    const [ps] = await query(`SELECT ps.enabled, o.org_slug FROM portal_settings ps JOIN orgs o ON o.id = ps.org_id WHERE ps.org_id = ?`, [org.id]);
    if (ps && ps.enabled === true && ps.org_slug) {
      portalLine = `<p style="font-size:13px;color:#555;text-align:center;">Prefer to manage everything yourself? <a href="${publicAppUrl()}/portal/${ps.org_slug}">Sign in to your donor portal</a> — no password needed.</p>`;
    }
  } catch { /* portal line is optional */ }
  const bodyHtml = await brandEmailHeaderHtml(org.id)
    + applyDunningTokens(org.recurring_dunning_body || DEFAULT_DUNNING_BODY, tokenCtx)
    + portalLine
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        from: smtpFrom, to: donor.email, subject, html: bodyHtml,
        headers: unsubscribeHeaders(donor.email, org.id, "campaign"),
      });
      if (sendErr) console.error("[dunning] send error:", sendErr.message);
    } catch (e) { console.error("[dunning] resend error:", e.message); }
  }
  return true;
}

// Short "you're all set" note — a warm confirmation, not another ask.
async function sendRecoveredThankYouEmail(org, donor, subscriptionRow) {
  const suppressReason = await getSuppressionReason(donor.email, org.id);
  if (suppressReason) return;
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  const amountStr = subscriptionRow.amount != null ? `$${Number(subscriptionRow.amount).toLocaleString()}` : "your";
  const subject = "You're all set — thank you!";
  const bodyHtml = `<p>Hi ${firstName},</p>
<p>Great news — your card on file worked, and your ${amountStr} gift to ${org.name} went through. Your recurring support is active again, and we're so grateful for it.</p>
<p>Thank you for sticking with us.</p>
<p>With gratitude,<br/>${org.name}</p>`
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        from: smtpFrom, to: donor.email, subject, html: bodyHtml,
        headers: unsubscribeHeaders(donor.email, org.id, "campaign"),
      });
      if (sendErr) console.error("[dunning] recovered-email send error:", sendErr.message);
    } catch (e) { console.error("[dunning] recovered-email resend error:", e.message); }
  }
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

app.post("/campaigns", requireAuth, checkWriteAccess, wrap(async (req, res) => {
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

app.put("/campaigns/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
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

app.put("/campaigns/:id/briefing", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { briefing, goal_amount, start_date, end_date } = req.body;
  const existing = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  await run(
    `UPDATE campaigns SET briefing=?,goal_amount=?,start_date=?,end_date=?,updated_at=NOW() WHERE id=? AND org_id=?`,
    [briefing||null, goal_amount||null, start_date||null, end_date||null, req.params.id, req.user.orgId]
  );
  const rows = await query("SELECT id,name,briefing,goal_amount,start_date,end_date,status FROM campaigns WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.get("/campaigns/:id/progress", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Campaign not found" });
  const c = rows[0];
  // Same raised definition as fundraisingCampaignRows (one definition):
  // gift payments net of donor-covered fees + awarded grants; open pledges
  // are a SEPARATE pledged figure, never summed into raised.
  const [giftSum, pledgeSum, grantSum] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(amount - COALESCE(cover_fee_amount,0)),0) as total, COUNT(DISTINCT donor_id) as donor_count FROM gifts WHERE org_id=? AND (campaign=? OR campaign_id=?)`,
      [req.user.orgId, c.name, c.id]
    ),
    // F-5: pledged = honest REMAINING balance (amount − payments already
    // linked via gifts.pledge_id), so a partially-paid pledge counts only
    // what is still committed-but-unpaid.
    query(
      `SELECT COALESCE(SUM(p.amount - COALESCE(pp.paid,0)),0) AS total
       FROM pledges p
       LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id=? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id=p.id
       WHERE p.org_id=? AND p.campaign_id=? AND p.status='open'`,
      [req.user.orgId, req.user.orgId, c.id]),
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM grants WHERE org_id=? AND campaign_id=? AND awarded_at IS NOT NULL`, [req.user.orgId, c.id]),
  ]);
  const grantAwarded = parseFloat(grantSum[0]?.total || 0);
  const raised = parseFloat(giftSum[0]?.total || 0) + grantAwarded;
  const donorCount = parseInt(giftSum[0]?.donor_count || 0);
  const daysRemaining = c.end_date ? Math.ceil((new Date(c.end_date) - new Date()) / 86400000) : null;
  res.json({
    goal: parseFloat(c.goal_amount || 0),
    raised,
    grantAwarded,
    pledged: parseFloat(pledgeSum[0]?.total || 0),
    donorCount,
    daysRemaining,
    startDate: c.start_date,
    endDate: c.end_date,
    briefing: c.briefing || "",
  });
}));

// ── Fundraising (BUILD-11) ──────────────────────────────────────────────────
// The Fundraising tab is a home over primitives that already exist: org-level
// goals (fundraising_goals), campaigns that carry a goal (campaigns.goal_amount),
// and giving pages. Nothing here stores a "raised" total — every figure is a
// live SUM over gifts, so a thermometer can never drift from reality. A
// "fundraising campaign" is simply a campaigns row with goal_amount set; the
// email lifecycle (campaigns.status) is untouched — fundraising lifecycle is
// derived from the campaign's dates instead.
//
// computeFundraisingPace: shared pace/thermometer math. Degrades gracefully —
// no goal → no thermometer (percent null); no dates → progress with no
// "days left"/pace; goal met → celebratory state. Never invents a number.
function computeFundraisingPace(raised, goal, startDate, endDate) {
  const g = parseFloat(goal) || 0;
  const r = parseFloat(raised) || 0;
  // `percent` stays capped at 100 (thermometer bar width). `rawPercent` is the
  // true, UNCAPPED figure so the UI can honestly say "302% · $50k over" instead
  // of a misleading flat 100% when a goal is exceeded. `over` = dollars past goal.
  const percent = g > 0 ? Math.min(100, Math.round((r / g) * 100)) : null;
  const rawPercent = g > 0 ? Math.round((r / g) * 100) : null;
  const over = g > 0 && r > g ? r - g : 0;
  const now = new Date();
  let daysLeft = null, lifecycle = "active";
  if (startDate && new Date(startDate) > now) lifecycle = "upcoming";
  if (endDate) {
    daysLeft = Math.ceil((new Date(endDate) - now) / 86400000);
    if (daysLeft < 0) { lifecycle = "ended"; daysLeft = 0; }
  }
  // Pace only when we have a goal, a start, an end, and time has elapsed.
  let paceState = null, expected = null;
  if (g > 0 && startDate && endDate) {
    const total = new Date(endDate) - new Date(startDate);
    const elapsed = Math.max(0, Math.min(total, now - new Date(startDate)));
    if (total > 0) {
      expected = g * (elapsed / total);
      if (r >= g) paceState = "met";
      else if (r >= expected * 0.98) paceState = "on_track";
      else paceState = "behind";
    }
  } else if (g > 0 && r >= g) {
    paceState = "met";
  }
  return { percent, rawPercent, over, daysLeft, lifecycle, paceState, expected };
}

// Live totals for a set of campaigns, matched the same way
// /campaigns/:id/progress matches: campaign_id OR the legacy campaign-name text
// column. One query per component, grouped, so the list view never N+1s.
//
// Attribution completeness (FIX, 2026-08-04) — what "raised" MEANS here:
//   raised = giftRaised + grantAwarded
//   · giftRaised   = Σ attributed gift PAYMENTS RECEIVED, net of any donor-
//     covered fee portion (amount − cover_fee_amount): goal progress counts
//     what the donor intended for the mission; the charged total stays in
//     Reports/Finance/receipts.
//   · grantAwarded = Σ attributed grants' amounts once AWARDED (awarded_at
//     set) — a real capital campaign counts foundation money toward its
//     target. If grant money ALSO arrives as a gift from the foundation
//     donor, attribute ONE of the two, never both (documented, surfaced in
//     the grant UI helper text).
//   · pledged      = Σ attributed OPEN pledges — committed-but-unpaid, a
//     SEPARATE figure. NEVER summed into raised: a pledge's payments arrive
//     as gifts (which inherit the pledge's campaign), so pledge+payments in
//     one number would double-count and a treasurer would catch it.
async function fundraisingCampaignRows(orgId) {
  const campaigns = await query(
    `SELECT id, name, goal_amount, start_date, end_date, status, type, goal_category, parent_goal_id, created_at
     FROM campaigns WHERE org_id = ? AND goal_amount IS NOT NULL AND goal_amount > 0
     ORDER BY created_at DESC`,
    [orgId]
  );
  if (!campaigns.length) return [];
  const [sums, pledgeSums, grantSums] = await Promise.all([
    query(
      `SELECT c.id AS cid,
              COALESCE(SUM(g.amount - COALESCE(g.cover_fee_amount, 0)), 0) AS raised,
              COUNT(DISTINCT g.donor_id) AS donor_count
         FROM campaigns c
         LEFT JOIN gifts g ON g.org_id = c.org_id AND (g.campaign_id = c.id OR g.campaign = c.name)
        WHERE c.org_id = ? AND c.goal_amount IS NOT NULL AND c.goal_amount > 0
        GROUP BY c.id`,
      [orgId]
    ),
    query(
      `SELECT p.campaign_id AS cid,
              COALESCE(SUM(p.amount - COALESCE(pp.paid,0)), 0) AS pledged,
              COUNT(*) AS pledge_count
         FROM pledges p
         LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id = p.id
        WHERE p.org_id = ? AND p.campaign_id IS NOT NULL AND p.status = 'open'
        GROUP BY p.campaign_id`,
      [orgId, orgId]
    ),
    query(
      `SELECT campaign_id AS cid, COALESCE(SUM(amount), 0) AS grant_awarded, COUNT(*) AS grant_count
         FROM grants WHERE org_id = ? AND campaign_id IS NOT NULL AND awarded_at IS NOT NULL
        GROUP BY campaign_id`,
      [orgId]
    ),
  ]);
  const byId = Object.fromEntries(sums.map(s => [s.cid, s]));
  const pledgeById = Object.fromEntries(pledgeSums.map(s => [s.cid, s]));
  const grantById = Object.fromEntries(grantSums.map(s => [s.cid, s]));
  return campaigns.map(c => {
    const s = byId[c.id] || {};
    const giftRaised = parseFloat(s.raised) || 0;
    const grantAwarded = parseFloat(grantById[c.id]?.grant_awarded) || 0;
    const raised = giftRaised + grantAwarded;
    const pledged = parseFloat(pledgeById[c.id]?.pledged) || 0;
    const pace = computeFundraisingPace(raised, c.goal_amount, c.start_date, c.end_date);
    return {
      id: c.id,
      name: c.name,
      goalAmount: parseFloat(c.goal_amount) || 0,
      raised,
      giftRaised,
      grantAwarded,
      grantCount: parseInt(grantById[c.id]?.grant_count, 10) || 0,
      pledged,
      pledgeCount: parseInt(pledgeById[c.id]?.pledge_count, 10) || 0,
      donorCount: parseInt(s.donor_count, 10) || 0,
      startDate: c.start_date,
      endDate: c.end_date,
      type: c.type,
      goalCategory: GOAL_CATEGORIES.includes(c.goal_category) ? c.goal_category : "project",
      parentGoalId: c.parent_goal_id || null,
      ...pace,
    };
  });
}

// BUILD-16 Part 2 — typed, multiple, roll-up goals. A "goal" is a goal'd
// campaign; several run at once, each with its own category (annual/project/
// capital). An overarching goal is a campaign that other campaigns name as
// their parent_goal_id — its progress rolls up its children's live raised. The
// roll-up is a live SUM over the same gift rows (never a stored counter), so it
// can't drift. Returns the goal portfolio + an org-wide roll-up header figure.
const GOAL_CATEGORIES = ["annual", "project", "capital"];
function fundraisingGoalsPortfolio(rows) {
  // rows = fundraisingCampaignRows output.
  // Child raised/goal rolled up onto each parent.
  const childrenByParent = {};
  for (const r of rows) {
    if (r.parentGoalId) (childrenByParent[r.parentGoalId] = childrenByParent[r.parentGoalId] || []).push(r);
  }
  const goals = rows.map(r => {
    const kids = childrenByParent[r.id] || [];
    const isOverarching = kids.length > 0;
    const childRaised = kids.reduce((s, k) => s + k.raised, 0);
    const childGoal = kids.reduce((s, k) => s + k.goalAmount, 0);
    // An overarching goal shows its children's combined progress toward its own
    // target (the roll-up); a leaf goal shows its own SUM(gifts).
    const rolledRaised = isOverarching ? childRaised : r.raised;
    const rolled = isOverarching ? computeFundraisingPace(childRaised, r.goalAmount, r.startDate, r.endDate) : null;
    return {
      ...r,
      isOverarching,
      childCount: kids.length,
      childRaised, childGoal,
      childIds: kids.map(k => k.id),
      // Pledged rolls up alongside raised but stays a SEPARATE figure —
      // committed-but-unpaid is never summed into a raised number.
      rolledPledged: (r.pledged || 0) + kids.reduce((s, k) => s + (k.pledged || 0), 0),
      rolledRaised,
      rolledPercent: isOverarching ? rolled.percent : r.percent,
      rolledRawPercent: isOverarching ? rolled.rawPercent : r.rawPercent,
      rolledOver: isOverarching ? rolled.over : r.over,
      rolledPaceState: isOverarching ? rolled.paceState : r.paceState,
    };
  });
  // Org roll-up header: total raised vs total goal across ACTIVE top-level goals
  // only (a child's raised is already inside its parent's roll-up — counting
  // both would double-count). Top-level = has no parent_goal_id; active = not
  // ended. Computed over the ENRICHED goals (so rolledRaised is present).
  const topActive = goals.filter(g => !g.parentGoalId && g.lifecycle !== "ended");
  const totalGoal = topActive.reduce((s, g) => s + g.goalAmount, 0);
  const totalRaised = topActive.reduce((s, g) => s + g.rolledRaised, 0);
  const rollup = topActive.length ? {
    totalRaised, totalGoal,
    percent: totalGoal > 0 ? Math.min(100, Math.round((totalRaised / totalGoal) * 100)) : null,
    rawPercent: totalGoal > 0 ? Math.round((totalRaised / totalGoal) * 100) : null,
    over: totalGoal > 0 && totalRaised > totalGoal ? totalRaised - totalGoal : 0,
    activeGoalCount: topActive.length,
  } : null;
  return { goals: goals.map(g => ({ ...g, isTopLevel: !g.parentGoalId })), rollup };
}

// Overview — the money-moving command view. Everything the Fundraising home
// needs in one call: the active org goal with pace, this-period momentum vs
// the prior period (same FY/calendar basis as Finance — one source of truth),
// campaign + giving-page rollups, and recent real gifts.
app.get("/fundraising/overview", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const yearMode = req.query.yearMode === "calendar" ? "calendar" : "fiscal";
  const cur = finPeriodBounds(yearMode, 0);
  const prior = finPeriodBounds(yearMode, -1);
  const today = new Date().toISOString().split("T")[0];
  // BUILD-32 Part 3 — the Home hero's "this week's giving" figure. A true
  // Monday-based calendar week (weekBounds), independent of the fiscal/calendar
  // period above, so the hero shows a number that genuinely moves week to week.
  const wk = weekBounds(0);

  const [goalRows, curRows, priorRows, weekRows, recentGifts, campaigns, givingPages] = await Promise.all([
    query(
      "SELECT * FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY created_at DESC LIMIT 1",
      [orgId, today, today]
    ),
    // BUILD-33: period totals exclude soft-deleted (trashed) donors' gifts —
    // same JOIN + deleted_at IS NULL predicate as Reports' giving-summary, so
    // Fundraising and Reports report the SAME period number (the BUILD-23
    // cross-surface invariant). Trashing a donor hides them from Reports; the
    // Fundraising header must not keep counting them.
    query("SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(*) AS gifts, COUNT(DISTINCT g.donor_id) AS donors FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?", [orgId, cur.start, cur.end]),
    query("SELECT COALESCE(SUM(g.amount),0) AS total FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?", [orgId, prior.start, prior.end]),
    query("SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(*) AS gifts FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?", [orgId, wk.start, wk.end]),
    query(
      `SELECT g.id, g.amount, g.date, g.stripe_payment_id, g.campaign, g.donor_id, d.name AS donor_name
         FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id
        WHERE g.org_id = ? AND d.deleted_at IS NULL ORDER BY g.date DESC, g.id DESC LIMIT 8`,
      [orgId]
    ),
    fundraisingCampaignRows(orgId),
    query(
      `SELECT gp.id, gp.title, gp.slug, gp.goal_amount, gp.status,
              COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised
         FROM giving_pages gp WHERE gp.org_id = ? ORDER BY gp.created_at DESC`,
      [orgId]
    ),
  ]);

  // Active org goal with pace (reuses the goal-progress math shape).
  let goal = null;
  if (goalRows.length) {
    const gr = goalRows[0];
    const goalAmount = parseFloat(gr.goal_amount) || 0;
    let currentAmount = 0;
    if (gr.goal_type === "lapsed_recovery") {
      const r2 = await query(
        `SELECT COALESCE(SUM(g.amount),0) AS total FROM gifts g JOIN donors d ON d.id = g.donor_id
          WHERE g.org_id = ? AND g.date >= ? AND g.date <= ? AND g.date = d.last_gift_date
            AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date) IS NOT NULL
            AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = d.id AND g2.date < g.date)::date > 365`,
        [orgId, gr.period_start, gr.period_end]
      );
      currentAmount = parseFloat(r2[0]?.total) || 0;
    } else {
      const r2 = await query("SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?", [orgId, gr.period_start, gr.period_end]);
      currentAmount = parseFloat(r2[0]?.total) || 0;
    }
    const pace = computeFundraisingPace(currentAmount, goalAmount, gr.period_start, gr.period_end);
    goal = {
      id: gr.id, label: gr.label, goalType: gr.goal_type, goalAmount, currentAmount,
      periodStart: gr.period_start, periodEnd: gr.period_end, ...pace,
    };
  }

  const periodTotal = parseFloat(curRows[0]?.total) || 0;
  const priorTotal = parseFloat(priorRows[0]?.total) || 0;
  const activePages = givingPages.filter(p => p.status === "active");

  // BUILD-16 Part 2 — the goal portfolio + roll-up header replaces the single
  // org goal as the Fundraising Overview centerpiece.
  const portfolio = fundraisingGoalsPortfolio(campaigns);

  res.json({
    yearMode,
    periodLabel: cur.chartLabel,
    goal,
    rollup: portfolio.rollup,
    goals: portfolio.goals,
    period: {
      raised: periodTotal,
      giftCount: parseInt(curRows[0]?.gifts, 10) || 0,
      donorCount: parseInt(curRows[0]?.donors, 10) || 0,
      priorRaised: priorTotal,
      delta: periodTotal - priorTotal,
    },
    thisWeek: {
      raised: parseFloat(weekRows[0]?.total) || 0,
      giftCount: parseInt(weekRows[0]?.gifts, 10) || 0,
      // Week bounds exposed so the Home hero's "This week" chip can deep-link
      // to a gifts view filtered to EXACTLY this window (the chip's number and
      // its destination must agree — count-matches-destination rule).
      start: wk.start,
      end: wk.end,
    },
    campaigns: {
      count: campaigns.length,
      activeCount: campaigns.filter(c => c.lifecycle === "active").length,
      raised: campaigns.reduce((s, c) => s + c.raised, 0),
      top: campaigns.slice().sort((a, b) => b.raised - a.raised)[0] || null,
    },
    givingPages: {
      count: activePages.length,
      raised: activePages.reduce((s, p) => s + (parseFloat(p.raised) || 0), 0),
      pages: activePages.map(p => ({ id: p.id, title: p.title, slug: p.slug, goalAmount: p.goal_amount != null ? parseFloat(p.goal_amount) : null, raised: parseFloat(p.raised) || 0 })),
    },
    recentGifts: recentGifts.map(g => ({
      id: g.id, amount: parseFloat(g.amount) || 0, date: g.date,
      source: g.stripe_payment_id ? "online" : "offline", campaign: g.campaign || null,
      donorId: g.donor_id || null,
      donorName: g.donor_name || "Anonymous",
    })),
  });
}));

app.get("/fundraising/campaigns", requireAuth, wrap(async (req, res) => {
  res.json(await fundraisingCampaignRows(req.user.orgId));
}));

// BUILD-16 Part 2 — the typed goal portfolio + org roll-up header.
app.get("/fundraising/goals", requireAuth, wrap(async (req, res) => {
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.json(fundraisingGoalsPortfolio(rows));
}));

app.post("/fundraising/campaigns", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, goalAmount, startDate, endDate, goalCategory, parentGoalId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  const goal = parseFloat(goalAmount);
  if (!Number.isFinite(goal) || goal <= 0) return res.status(400).json({ error: "Goal amount must be a positive number" });
  const category = GOAL_CATEGORIES.includes(goalCategory) ? goalCategory : "project";
  // A parent goal, if given, must be another goal'd campaign in this org.
  let parent = null;
  if (parentGoalId) {
    const p = await query("SELECT id FROM campaigns WHERE id=? AND org_id=? AND goal_amount IS NOT NULL AND goal_amount > 0", [parentGoalId, req.user.orgId]);
    if (!p.length) return res.status(400).json({ error: "parentGoalId must be an existing goal in this org" });
    parent = parentGoalId;
  }
  const id = "cmp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,goal_amount,start_date,end_date,goal_category,parent_goal_id,recipient_count,open_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)`,
    [id, req.user.orgId, name.trim(), "appeal", "", "", "draft", JSON.stringify({}), goal, startDate || null, endDate || null, category, parent]
  );
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.status(201).json(rows.find(r => r.id === id) || { id });
}));

app.put("/fundraising/campaigns/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, goalAmount, startDate, endDate, goalCategory, parentGoalId } = req.body;
  const existing = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  if (goalAmount !== undefined) {
    const goal = parseFloat(goalAmount);
    if (!Number.isFinite(goal) || goal <= 0) return res.status(400).json({ error: "Goal amount must be a positive number" });
  }
  if (goalCategory !== undefined && !GOAL_CATEGORIES.includes(goalCategory)) {
    return res.status(400).json({ error: "goalCategory must be annual, project, or capital" });
  }
  // A goal can't be its own parent, and the parent must exist in this org.
  let parentUpdate = null, parentProvided = parentGoalId !== undefined;
  if (parentProvided && parentGoalId) {
    if (parentGoalId === req.params.id) return res.status(400).json({ error: "A goal cannot be its own parent" });
    const p = await query("SELECT id FROM campaigns WHERE id=? AND org_id=? AND goal_amount IS NOT NULL AND goal_amount > 0", [parentGoalId, req.user.orgId]);
    if (!p.length) return res.status(400).json({ error: "parentGoalId must be an existing goal in this org" });
    parentUpdate = parentGoalId;
  }
  await run(
    `UPDATE campaigns SET name=COALESCE(?,name), goal_amount=COALESCE(?,goal_amount),
       start_date=?, end_date=?, goal_category=COALESCE(?,goal_category),
       parent_goal_id=CASE WHEN ? THEN ? ELSE parent_goal_id END, updated_at=NOW() WHERE id=? AND org_id=?`,
    [name || null, goalAmount !== undefined ? parseFloat(goalAmount) : null,
     startDate || null, endDate || null, goalCategory || null,
     parentProvided, parentUpdate, req.params.id, req.user.orgId]
  );
  const rows = await fundraisingCampaignRows(req.user.orgId);
  res.json(rows.find(r => r.id === req.params.id) || { id: req.params.id });
}));

// Segment → recipient list. Shared by the manual send route and the
// scheduled-campaign job (BUILD-06 Phase C) so both resolve audiences
// identically. Note the predicates read d.stage — the DB column — matching
// what the client's SegmentPicker previews (fixed same pass; it read a
// nonexistent d.pipeline_stage and showed 0 for stage segments).
async function resolveCampaignRecipients(campaign, orgId) {
  const segment = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});
  let donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
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
  return donors;
}

app.post("/campaigns/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const campaigns = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });
  const campaign = campaigns[0];
  if (campaign.status === "sent") return res.status(400).json({ error: "Campaign already sent" });

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];
  const donors = await resolveCampaignRecipients(campaign, req.user.orgId);

  // Mark as sending and respond immediately (non-blocking)
  await run("UPDATE campaigns SET status='sending', updated_at=NOW() WHERE id=?", [campaign.id]);
  res.json({ queued: true, recipientCount: donors.length });

  setImmediate(() => runCampaignSend(campaign, org, donors));
}));

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

      const year = String(new Date().getFullYear());
      const brandHeader = await brandEmailHeaderHtml(org.id); // BUILD-13 — once per send, not per recipient

      for (const donor of donors) {
        const suppressReason = await getSuppressionReason(donor.email, org.id);
        if (suppressReason) {
          console.log(`[campaign:${campaign.id}] skipping suppressed address ${donor.email} (${suppressReason})`);
          await run(
            "INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,failure_reason) VALUES (?,?,?,?,?,?)",
            ["cr_" + uuid().slice(0, 8), org.id, campaign.id, donor.id, donor.email, `suppressed: ${suppressReason}`]
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
              from: smtpFrom, to: donor.email,
              subject: campaign.subject || "",
              html: htmlFull,
              headers: unsubscribeHeaders(donor.email, org.id, "campaign"),
            });
            if (sendError) throw new Error(sendError.message);
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
  }
}

// Fires due scheduled campaigns (status='scheduled', scheduled_at passed)
// through the exact same send path as the manual route. The claim UPDATE is
// conditional on status so two overlapping ticks can't double-send. A
// read_only (lapsed) org's scheduled campaign is moved back to draft rather
// than sent — matching checkWriteAccess on the manual route — or retried
// forever.
async function processScheduledCampaigns() {
  try {
    const due = await query(
      "SELECT * FROM campaigns WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()", []
    );
    for (const campaign of due) {
      try {
        const orgs = await query("SELECT * FROM orgs WHERE id = ?", [campaign.org_id]);
        if (!orgs.length) continue;
        const org = orgs[0];
        if (getOrgAccessState(org) === "read_only") {
          await run("UPDATE campaigns SET status='draft', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
          console.log(`[campaign-scheduler] org ${org.id} is read_only — campaign ${campaign.id} moved back to draft`);
          continue;
        }
        const claimed = await run("UPDATE campaigns SET status='sending', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
        if (!claimed.changes) continue; // another tick got it
        const donors = await resolveCampaignRecipients(campaign, campaign.org_id);
        console.log(`[campaign-scheduler] sending scheduled campaign ${campaign.id} (${donors.length} recipients, was due ${campaign.scheduled_at})`);
        await runCampaignSend(campaign, org, donors);
      } catch (e) { console.error("[campaign-scheduler]", campaign.id, e.message); }
    }
  } catch (e) { console.error("[campaign-scheduler]", e.message); }
}
setTimeout(() => processScheduledCampaigns().catch(console.error), 20000);
setInterval(() => processScheduledCampaigns().catch(console.error), 5 * 60 * 1000);

// ── Tracking pixel (no auth) ───────────────────────────────────────────────
app.get("/track/:recipientId/open.gif", wrap(async (req, res) => {
  const { recipientId } = req.params;
  const wasAlreadyOpen = await query("SELECT opened_at FROM campaign_recipients WHERE id=?", [recipientId]);
  const alreadyOpened = wasAlreadyOpen[0]?.opened_at != null;
  await run("UPDATE campaign_recipients SET opened_at = NOW() WHERE id = ? AND opened_at IS NULL", [recipientId]);
  // Count UNIQUE opens only — this counter is divided by recipient_count as
  // "open rate" in the UI, so counting every pixel refetch inflated rates
  // (and could push them past 100%). BUILD-06 Phase C fix.
  if (!alreadyOpened) {
    await run(
      `UPDATE campaigns SET open_count = open_count + 1
       WHERE id = (SELECT campaign_id FROM campaign_recipients WHERE id = ?)`,
      [recipientId]
    );
  }

  // Log interaction + engagement intelligence (fire-and-forget)
  if (!alreadyOpened) {
    (async () => {
      try {
        const recRows = await query(
          `SELECT cr.email, cr.donor_id, c.name AS campaign_name, c.org_id
           FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id WHERE cr.id=?`,
          [recipientId]
        );
        if (!recRows.length) return;
        const rec = recRows[0];
        const donorId = rec.donor_id || (rec.email
          ? (await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [rec.org_id, rec.email]))[0]?.id
          : null);
        if (!donorId) return;
        const today = new Date().toISOString().slice(0, 10);
        await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES (?,?,?,'email',?,?)",
          ["i_"+uuid().slice(0,8), rec.org_id, donorId, `Opened campaign: ${rec.campaign_name}`, today]);
        // Check last 3 email interactions for engagement signals
        const recent = await query(
          "SELECT note FROM interactions WHERE donor_id=? AND org_id=? AND type='email' ORDER BY date DESC, created_at DESC LIMIT 3",
          [donorId, rec.org_id]
        );
        const opens = recent.filter(r => r.note?.startsWith("Opened"));
        if (opens.length >= 2) {
          await run(`UPDATE donors SET notes = CASE WHEN notes NOT LIKE '%High engagement%'
            THEN TRIM(COALESCE(notes||' | ','') || 'High engagement — opened last 2+ emails')
            ELSE notes END WHERE id=? AND org_id=?`, [donorId, rec.org_id]);
        } else if (opens.length === 0 && recent.length >= 3) {
          await run(`UPDATE donors SET notes = CASE WHEN notes NOT LIKE '%Low email engagement%'
            THEN TRIM(COALESCE(notes||' | ','') || 'Low email engagement — consider phone outreach')
            ELSE notes END WHERE id=? AND org_id=?`, [donorId, rec.org_id]);
        }
      } catch (e) { /* non-critical */ }
    })();
  }

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
       JOIN grants g ON g.id = pg.grant_id AND g.org_id = ?
       WHERE pg.program_id = ? AND pg.org_id = ?`,
      [req.user.orgId, p.id, req.user.orgId]
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

  const grantExists = await query(
    "SELECT id FROM grants WHERE id = ? AND org_id = ?",
    [grantId, req.user.orgId]
  );
  if (!grantExists.length) return res.status(404).json({ error: "Grant not found" });

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
    "DELETE FROM program_grants WHERE program_id = ? AND grant_id = ? AND org_id = ?",
    [req.params.id, req.params.grantId, req.user.orgId]
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

  // Shared with the Home dashboard's Retention Rate metric (see
  // computeRetentionRate) so the two can never disagree — pass the
  // already-fetched allGifts through rather than querying twice.
  const retentionResult = await computeRetentionRate(orgId, { year, gifts: allGifts });
  const totalDonors    = retentionResult.thisYearCount;
  const retained       = retentionResult.retained;
  const acquired       = totalDonors - retained;
  const retentionRate  = retentionResult.retentionRate ?? 0;

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
    (await query("SELECT id FROM donors WHERE org_id = ? AND status = 'lapsed' AND deleted_at IS NULL", [orgId])).map(d => d.id)
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

  const frontendUrl = publicAppUrl();
  console.log("[stripe/connect] frontendUrl resolved to:", frontendUrl);

  let account;
  try {
    account = await stripe.accounts.create({
      type: "express",
      country: "US",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    console.log("[stripe/connect] created account:", account.id);
  } catch (err) {
    console.error("[stripe/connect] accounts.create failed:", JSON.stringify({ message: err.message, type: err.type, code: err.code, param: err.param, raw: err.raw }));
    const statusCode = err.statusCode || err.raw?.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Stripe error", type: err.type, code: err.code, param: err.param });
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${frontendUrl}/dashboard`,
      return_url: `${frontendUrl}/dashboard?stripe_connected=true`,
      type: "account_onboarding",
    });
    console.log("[stripe/connect] accountLink created:", accountLink.url);

    await run(
      `UPDATE orgs SET stripe_account_id=$1, stripe_connected=TRUE, stripe_connected_at=NOW() WHERE id=$2`,
      [account.id, req.user.orgId]
    );

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error("[stripe/connect] accountLinks.create failed:", JSON.stringify({ message: err.message, type: err.type, code: err.code, param: err.param, raw: err.raw }));
    const statusCode = err.statusCode || err.raw?.statusCode || 500;
    res.status(statusCode).json({ error: err.message || "Stripe error", type: err.type, code: err.code, param: err.param });
  }
}));

app.post("/stripe/donation-page", requireAuth, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { donorName, donorEmail, amount } = req.body;
  if (!donorName || !donorEmail) return res.status(400).json({ error: "donorName and donorEmail required" });

  const orgRow = await query("SELECT stripe_account_id, stripe_connected, name FROM orgs WHERE id=$1", [req.user.orgId]);
  const org = orgRow[0];
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
  const org = orgRow[0];
  res.json({
    connected: !!org?.stripe_connected,
    accountId: org?.stripe_account_id || null,
    connectedAt: org?.stripe_connected_at || null,
  });
}));

// ── Public org slug list (diagnostic) ─────────────────────────────────────
app.get("/org/public-list", wrap(async (req, res) => {
  const orgs = await query("SELECT id, name, org_slug FROM orgs ORDER BY name ASC");
  res.json(orgs.map(o => ({ id: o.id, name: o.name, slug: o.org_slug, url: `/give/${o.org_slug}` })));
}));

// ── Public donation page ───────────────────────────────────────────────────
app.get("/org/:orgSlug/public", wrap(async (req, res) => {
  const orgs = await query(
    "SELECT id, name, mission, cover_fees_enabled FROM orgs WHERE org_slug = $1",
    [req.params.orgSlug]
  );
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = $1 ORDER BY name ASC", [org.id]);
  res.json({ org: { name: org.name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false }, funds });
}));

// ── Giving Pages ────────────────────────────────────────────────────────────
// Campaign-specific donation pages, e.g. /give/:orgSlug/:pageSlug — distinct
// from the org-wide /give/:orgSlug page above, and NOT the same concept as
// the `campaigns` table (email campaigns). See db.js giving_pages comment.
function slugifyGivingPage(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
}
async function uniqueGivingPageSlug(orgId, base, excludeId) {
  let slug = base, n = 1;
  while (true) {
    const rows = excludeId
      ? await query("SELECT id FROM giving_pages WHERE org_id=? AND slug=? AND id<>?", [orgId, slug, excludeId])
      : await query("SELECT id FROM giving_pages WHERE org_id=? AND slug=?", [orgId, slug]);
    if (!rows.length) return slug;
    n++;
    slug = `${base}-${n}`;
  }
}

// Admin list — includes the same real, live SUM(gifts.amount) used by the
// public page's progress bar, so the manager list never shows a number that
// could drift from the public one.
app.get("/giving-pages", requireAuth, wrap(async (req, res) => {
  // raised_amount counts what donors INTENDED for the page's ask (amount −
  // cover_fee_amount) — the donor-covers-fees rule; the charged total lives in
  // Reports/Finance/receipts. campaign_* expose the "counts toward" linkage
  // (attribution FIX): a linked page's public thermometer tracks the CAMPAIGN's
  // progress (one goal concept), so the manager list carries the same figures.
  const rows = await query(
    `SELECT gp.*, f.name AS fund_name, c.name AS campaign_name, c.goal_amount AS campaign_goal,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised_amount,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         COALESCE((SELECT SUM(g.amount - COALESCE(g.cover_fee_amount,0)) FROM gifts g WHERE g.org_id = gp.org_id AND (g.campaign_id = gp.campaign_id OR g.campaign = c.name)), 0)
       END AS campaign_raised
     FROM giving_pages gp
     LEFT JOIN fin_funds f ON f.id = gp.fund_id
     LEFT JOIN campaigns c ON c.id = gp.campaign_id AND c.org_id = gp.org_id
     WHERE gp.org_id = ?
     ORDER BY gp.created_at DESC`,
    [req.user.orgId]
  );
  res.json(rows);
}));

// Same length/amount limits as the public peer-fundraiser creation route
// below (POST /org/:orgSlug/giving-page/:pageSlug/fundraisers) — that
// sibling route validates these; this one didn't, which was an
// inconsistency within the same feature rather than a real exposure (this
// route is admin+org-scoped, so a bad value only ever lands in the caller's
// own org), but a negative/non-finite goalAmount would still render a
// nonsensical progress-bar percentage on the public page.
function validateGivingPageFields(title, story, imageUrl, goalAmount) {
  if (title !== undefined && title.trim().length > 200) return "Title is too long.";
  if (story && story.length > 5000) return "Story is too long (5,000 character max).";
  if (imageUrl && imageUrl.length > 2000) return "Image URL is too long.";
  if (goalAmount && (!Number.isFinite(parseFloat(goalAmount)) || parseFloat(goalAmount) <= 0)) return "Goal amount must be a positive number.";
  return null;
}

app.post("/giving-pages", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { title, goalAmount, story, imageUrl, fundId, slug, campaignId } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
  const validationErr = validateGivingPageFields(title, story, imageUrl, goalAmount);
  if (validationErr) return res.status(400).json({ error: validationErr });
  if (fundId) {
    const fundRow = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, req.user.orgId]);
    if (!fundRow.length) return res.status(400).json({ error: "Invalid fund" });
  }
  // Attribution FIX — org-scoped validation so a page from org A can never
  // attribute to org B's campaign. Optional: a general page stays unattributed.
  if (campaignId) {
    const campRow = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!campRow.length) return res.status(400).json({ error: "Invalid campaign" });
  }
  const base = slugifyGivingPage(slug || title);
  const finalSlug = await uniqueGivingPageSlug(req.user.orgId, base);
  const id = "gp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO giving_pages (id, org_id, slug, title, goal_amount, story, image_url, fund_id, status, campaign_id)
     VALUES (?,?,?,?,?,?,?,?,'active',?)`,
    [id, req.user.orgId, finalSlug, title.trim(), goalAmount ? parseFloat(goalAmount) : null, story || "", imageUrl || "", fundId || null, campaignId || null]
  );
  const rows = await query("SELECT *, 0 AS raised_amount FROM giving_pages WHERE id=?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/giving-pages/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const existingRows = await query("SELECT * FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existingRows.length) return res.status(404).json({ error: "Not found" });
  const existing = existingRows[0];
  const { title, goalAmount, story, imageUrl, fundId, slug, status, campaignId } = req.body;
  const validationErr = validateGivingPageFields(title, story, imageUrl, goalAmount);
  if (validationErr) return res.status(400).json({ error: validationErr });
  if (fundId) {
    const fundRow = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, req.user.orgId]);
    if (!fundRow.length) return res.status(400).json({ error: "Invalid fund" });
  }
  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  if (campaignId) {
    const campRow = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!campRow.length) return res.status(400).json({ error: "Invalid campaign" });
  }
  // Only touches the slug when the request actually included one (the full
  // edit form always sends it; a partial update like the archive toggle,
  // which sends only {status}, must not silently regenerate a custom slug
  // from the title).
  let finalSlug = existing.slug;
  if (slug !== undefined) {
    const requestedSlug = slugifyGivingPage(slug || title || existing.title);
    if (requestedSlug !== existing.slug) {
      finalSlug = await uniqueGivingPageSlug(req.user.orgId, requestedSlug, existing.id);
    }
  }
  await run(
    `UPDATE giving_pages SET title=?, goal_amount=?, story=?, image_url=?, fund_id=?, slug=?, status=?, campaign_id=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [
      title?.trim() || existing.title,
      goalAmount !== undefined ? (goalAmount ? parseFloat(goalAmount) : null) : existing.goal_amount,
      story !== undefined ? story : existing.story,
      imageUrl !== undefined ? imageUrl : existing.image_url,
      fundId !== undefined ? (fundId || null) : existing.fund_id,
      finalSlug,
      status && ["active", "archived"].includes(status) ? status : existing.status,
      campaignId !== undefined ? (campaignId || null) : existing.campaign_id,
      req.params.id, req.user.orgId,
    ]
  );
  const rows = await query(
    `SELECT gp.*, COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised_amount
     FROM giving_pages gp WHERE gp.id=?`,
    [req.params.id]
  );
  res.json(rows[0]);
}));

// Hard delete — separate from archive (status='active'|'archived' above),
// which is the reversible day-to-day "stop accepting gifts on this page"
// action. This is for removing a mistake/duplicate/test page outright.
// gifts.giving_page_id has no FK constraint (see db.js), so this never
// errors on existing gifts; a gift that already came through a deleted page
// simply keeps a giving_page_id that no longer resolves, same tolerated
// pattern as other dangling-reference cases in this codebase (see "Admin
// data integrity" in CLAUDE.md). DELETE routes are intentionally never
// checkWriteAccess-gated, consistent with every other DELETE in this app.
app.delete("/giving-pages/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// Public — org info + giving page + real live progress. Same shape as
// GET /org/:orgSlug/public, plus the page's own title/story/image/goal and
// the real computed raised total (never a manually-set counter).
app.get("/org/:orgSlug/giving-page/:pageSlug/public", wrap(async (req, res) => {
  const orgs = await query("SELECT id, name, mission, cover_fees_enabled FROM orgs WHERE org_slug = ?", [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  // raised_amount counts the donor-intended amount (net of covered fees) —
  // the goal-progress rule; campaign_* carry the "counts toward" linkage so a
  // linked page's thermometer tracks the CAMPAIGN's live progress (one goal
  // concept — the page never maintains a second goal system beside it).
  const pageRows = await query(
    `SELECT gp.*, f.name AS fund_name, c.name AS campaign_name, c.goal_amount AS campaign_goal,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised_amount,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         COALESCE((SELECT SUM(g.amount - COALESCE(g.cover_fee_amount,0)) FROM gifts g WHERE g.org_id = gp.org_id AND (g.campaign_id = gp.campaign_id OR g.campaign = c.name)), 0)
       END AS campaign_raised
     FROM giving_pages gp
     LEFT JOIN fin_funds f ON f.id = gp.fund_id
     LEFT JOIN campaigns c ON c.id = gp.campaign_id AND c.org_id = gp.org_id
     WHERE gp.org_id = ? AND gp.slug = ? AND gp.status = 'active'`,
    [org.id, req.params.pageSlug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const page = pageRows[0];
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = ? ORDER BY name ASC", [org.id]);

  // Rollup + leaderboard — cheap once peer gifts always carry the parent's
  // giving_page_id (see gifts.peer_fundraiser_id comment in db.js): the
  // page's own raised_amount above already includes every peer gift with no
  // extra logic, and this is just the same SUM one level down, grouped by
  // fundraiser. Live every call, never cached, same rule as raised_amount.
  const fundraiserRows = await query(
    `SELECT pf.id, pf.name, pf.slug,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf
     WHERE pf.giving_page_id = ? AND pf.status = 'active'
     ORDER BY raised_amount DESC, pf.created_at ASC`,
    [page.id]
  );

  res.json({
    org: { name: org.name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false },
    givingPage: {
      id: page.id, slug: page.slug, title: page.title, story: page.story, imageUrl: page.image_url,
      goalAmount: page.goal_amount != null ? parseFloat(page.goal_amount) : null,
      raisedAmount: parseFloat(page.raised_amount) || 0,
      fundId: page.fund_id, fundName: page.fund_name || null,
      // "Counts toward" linkage (attribution FIX) — when set, the public
      // thermometer shows the campaign's progress, not a second page-local goal.
      campaignId: page.campaign_id || null,
      campaignName: page.campaign_name || null,
      campaignGoal: page.campaign_goal != null ? parseFloat(page.campaign_goal) : null,
      campaignRaised: page.campaign_raised != null ? parseFloat(page.campaign_raised) : null,
    },
    funds,
    peerFundraisers: {
      count: fundraiserRows.length,
      leaderboard: fundraiserRows.slice(0, 10).map(f => ({ id: f.id, name: f.name, slug: f.slug, raisedAmount: parseFloat(f.raised_amount) || 0 })),
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

// Caller-supplied name/story/org/page title get interpolated into a raw
// HTML email body below — escape them so a submitted name like
// `<img src=x onerror=...>` can't inject markup into the manage-link email.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendFundraiserManageEmail(org, fundraiser, givingPage, manageUrl) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const from = process.env.DEMO_SMTP_FROM || "onboarding@resend.dev";
    const { error } = await resend.emails.send({
      from,
      to: fundraiser.email,
      subject: `Your fundraiser for ${displayNameCase(org.name)} is live!`,
      html: `<p>Hi ${escapeHtml(fundraiser.name)},</p>
             <p>Thanks for starting a personal fundraiser for <strong>${escapeHtml(givingPage.title)}</strong> on behalf of <strong>${escapeHtml(org.name)}</strong>! Your page is live and ready to share.</p>
             <p><a href="${manageUrl}" style="background:#c9a84c;color:#0f1a12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Manage Your Fundraiser</a></p>
             <p>Use that link any time to update your story, goal, or photo — bookmark it, since there's no password to reset it with.</p>`,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("Fundraiser manage email send failed:", err.message);
    return false;
  }
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

  const base = slugifyGivingPage(name);
  const id = "pf_" + uuid().slice(0, 8);
  const editToken = generateEditToken();

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
        `INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, personal_goal_amount, story, image_url, status, edit_token)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?)`,
        [id, org.id, givingPage.id, name.trim(), email.trim().toLowerCase(), slug, personalGoalAmount ? parseFloat(personalGoalAmount) : null, story || "", imageUrl || "", editToken]
      );
      inserted = true;
    } catch (e) {
      if (attempt === 2) throw e;
      slug = await uniquePeerFundraiserSlug(givingPage.id, `${base}-${Date.now().toString(36).slice(-4)}`);
    }
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
  const emailSent = await sendFundraiserManageEmail(org, { name: name.trim(), email: email.trim() }, givingPage, manageUrl);

  res.status(201).json({ id, slug, publicUrl, emailSent });
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
  const orgs = await query("SELECT id, name, mission, cover_fees_enabled FROM orgs WHERE org_slug = ?", [req.params.orgSlug]);
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];

  const pageRows = await query(
    `SELECT gp.*, f.name AS fund_name FROM giving_pages gp LEFT JOIN fin_funds f ON f.id = gp.fund_id
     WHERE gp.org_id = ? AND gp.slug = ? AND gp.status = 'active'`,
    [org.id, req.params.pageSlug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "This giving page could not be found." });
  const page = pageRows[0];

  const fRows = await query(
    `SELECT pf.*, COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.giving_page_id=? AND pf.slug=? AND pf.status='active'`,
    [page.id, req.params.fundraiserSlug]
  );
  if (!fRows.length) return res.status(404).json({ error: "This fundraiser could not be found." });
  const f = fRows[0];

  res.json({
    org: { name: org.name, mission: org.mission, slug: req.params.orgSlug, coverFeesEnabled: org.cover_fees_enabled !== false },
    givingPage: { id: page.id, slug: page.slug, title: page.title, fundId: page.fund_id, fundName: page.fund_name || null },
    peerFundraiser: {
      id: f.id, slug: f.slug, name: f.name, story: f.story, imageUrl: f.image_url,
      personalGoalAmount: f.personal_goal_amount != null ? parseFloat(f.personal_goal_amount) : null,
      raisedAmount: parseFloat(f.raised_amount) || 0,
    },
    funds: [],
  });
}));

// Public, token-authenticated — the entire "manage your fundraiser" auth
// model for v1 (see db.js comment). GET loads current editable fields; PUT
// saves them. Deliberately cannot touch status/slug/email — status is
// admin-only (takedown, below), and slug/email changes would break the
// link the supporter already shared or the one they received this token
// through, defeating the point of a durable bookmarkable link.
app.get("/peer-fundraisers/manage/:token", fundraiserManageLimiter, wrap(async (req, res) => {
  const rows = await query(
    `SELECT pf.*, gp.title AS giving_page_title, gp.slug AS giving_page_slug, o.name AS org_name, o.org_slug
     FROM peer_fundraisers pf
     JOIN giving_pages gp ON gp.id = pf.giving_page_id
     JOIN orgs o ON o.id = gp.org_id
     WHERE pf.edit_token = ?`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: "This link is invalid or has expired." });
  const f = rows[0];
  const raisedRow = await query("SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE peer_fundraiser_id=?", [f.id]);
  res.json({
    name: f.name, slug: f.slug, story: f.story, imageUrl: f.image_url,
    personalGoalAmount: f.personal_goal_amount != null ? parseFloat(f.personal_goal_amount) : null,
    status: f.status,
    raisedAmount: parseFloat(raisedRow[0]?.total) || 0,
    orgName: f.org_name, givingPageTitle: f.giving_page_title,
    publicUrl: `${publicAppUrl()}/give/${f.org_slug}/${f.giving_page_slug}/${f.slug}`,
  });
}));

app.put("/peer-fundraisers/manage/:token", fundraiserManageLimiter, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM peer_fundraisers WHERE edit_token = ?", [req.params.token]);
  if (!rows.length) return res.status(404).json({ error: "This link is invalid or has expired." });
  const existing = rows[0];
  const { name, personalGoalAmount, story, imageUrl } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: "Name cannot be empty." });
  if (name !== undefined && name.trim().length > 200) return res.status(400).json({ error: "Name is too long." });
  if (story && story.length > 5000) return res.status(400).json({ error: "Story is too long (5,000 character max)." });
  if (imageUrl && imageUrl.length > 2000) return res.status(400).json({ error: "Image URL is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "Personal goal must be a positive number." });
  await run(
    `UPDATE peer_fundraisers SET name=?, personal_goal_amount=?, story=?, image_url=?, updated_at=NOW() WHERE id=?`,
    [
      name !== undefined ? name.trim() : existing.name,
      personalGoalAmount !== undefined ? (personalGoalAmount ? parseFloat(personalGoalAmount) : null) : existing.personal_goal_amount,
      story !== undefined ? story : existing.story,
      imageUrl !== undefined ? imageUrl : existing.image_url,
      existing.id,
    ]
  );
  res.json({ success: true });
}));

// Staff-level read (requireAuth only, matches GET /giving-pages and the
// donor-list convention — donor/fundraiser PII is visible to any
// authenticated staff member throughout this app, not gated to admins;
// only the takedown mutation below is admin-only). org_id is filtered
// directly (see db.js comment on why peer_fundraisers carries its own
// org_id rather than relying solely on the giving_page_id join). Column
// list is explicit and deliberately omits edit_token — that's the
// fundraiser owner's own credential (see generateEditToken comment); the
// admin UI never needs it and has no legitimate reason to see it, so it's
// left out of the response rather than trusted to nobody reading pf.*.
app.get("/giving-pages/:id/fundraisers", requireAuth, wrap(async (req, res) => {
  const pageRows = await query("SELECT id FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!pageRows.length) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT pf.id, pf.giving_page_id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.image_url, pf.status, pf.created_at, pf.updated_at,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.giving_page_id=? AND pf.org_id=? ORDER BY raised_amount DESC, pf.created_at DESC`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

// Admin takedown — the safety valve: anyone can spin up a public page under
// an org's name, so staff need to be able to pull one down immediately.
// Status-only by design (not a general edit route) — content edits are the
// fundraiser owner's own business via their edit_token above; this route's
// entire job is the active/archived switch. Archiving here has the exact
// same effect as archiving a Giving Page itself: the public fundraiser page
// 404s and POST /donate/:orgSlug rejects new donations against it (both
// enforced by the WHERE status='active' clauses in the routes above).
app.put("/peer-fundraisers/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { status } = req.body;
  if (!status || !["active", "archived"].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'archived'" });
  const rows = await query("SELECT id FROM peer_fundraisers WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  await run("UPDATE peer_fundraisers SET status=?, updated_at=NOW() WHERE id=?", [status, req.params.id]);
  const updated = await query(
    `SELECT pf.id, pf.giving_page_id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.image_url, pf.status, pf.created_at, pf.updated_at,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.id=?`,
    [req.params.id]
  );
  res.json(updated[0]);
}));

// Donor-covers-fees gross-up (BUILD-08 Phase B): the amount to charge so the
// org nets approximately the intended gift after Stripe's standard card fee
// (2.9% + 30¢): gross = (net + 30) / (1 - 0.029). Standard published rate
// only — orgs on negotiated/nonprofit rates net slightly more, never less.
// The client computes the same number for DISPLAY; this server-side
// derivation is the one that gets charged (client math is never trusted).
const COVER_FEES_PCT = 0.029;
const COVER_FEES_FLAT_CENTS = 30;
function coverFeesGrossUpCents(netCents) {
  return Math.ceil((netCents + COVER_FEES_FLAT_CENTS) / (1 - COVER_FEES_PCT));
}

app.post("/donate/:orgSlug", donateLimiter, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { amount, fundId, frequency, firstName, lastName, email, campaignId, coverFees } = req.body;
  let { givingPageId, peerFundraiserId } = req.body;
  if (!amount || !firstName || !lastName || !email) return res.status(400).json({ error: "All fields required" });

  const orgs = await query(
    "SELECT id, name, stripe_account_id, stripe_connected, cover_fees_enabled FROM orgs WHERE org_slug = $1",
    [req.params.orgSlug]
  );
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  if (!org.stripe_connected || !org.stripe_account_id) {
    return res.status(400).json({ error: "This organization is not set up to accept online donations yet." });
  }

  const baseCents = Math.round(parseFloat(amount) * 100);
  if (baseCents < 100) return res.status(400).json({ error: "Minimum donation is $1" });

  // Re-derived server-side from the base amount — the client sends only the
  // boolean, never its own total. The full charged amount IS the donation
  // (gifts + receipts record what was actually charged; no fee itemization).
  const feesCovered = !!coverFees && org.cover_fees_enabled !== false;
  const amountCents = feesCovered ? coverFeesGrossUpCents(baseCents) : baseCents;

  const donorName = `${firstName} ${lastName}`.trim();
  const isRecurring = frequency === "monthly" || frequency === "annual";
  const frontendUrl = publicAppUrl();

  let fundName = "";
  if (fundId) {
    const fundRow = await query("SELECT name FROM fin_funds WHERE id=$1 AND org_id=$2", [fundId, org.id]);
    if (fundRow.length) fundName = fundRow[0].name;
  }

  // Peer-fundraiser donations always resolve givingPageId from the
  // fundraiser row itself, not whatever the client sent — the fundraiser
  // record is the source of truth for which campaign it belongs to (see
  // "no such thing as a fundraiser not tied to a campaign" in db.js), so
  // this can never end up with a peer_fundraiser_id/giving_page_id pair
  // that disagree. A fundraiser whose parent page has since been archived
  // is treated as unavailable too — a fundraiser can't outlive its campaign.
  let fundraiserSlug = "";
  let fundraiserName = "";
  if (peerFundraiserId) {
    const fRow = await query(
      `SELECT pf.slug, pf.name, pf.giving_page_id FROM peer_fundraisers pf
       JOIN giving_pages gp ON gp.id = pf.giving_page_id
       WHERE pf.id=? AND pf.status='active' AND gp.org_id=? AND gp.status='active'`,
      [peerFundraiserId, org.id]
    );
    if (!fRow.length) return res.status(400).json({ error: "This fundraiser is no longer available." });
    fundraiserSlug = fRow[0].slug;
    fundraiserName = fRow[0].name;
    givingPageId = fRow[0].giving_page_id;
  } else {
    peerFundraiserId = null;
  }

  // Independent of campaignId (email-campaign attribution) — validated
  // against this org so a stale/foreign givingPageId can't get tagged onto
  // a gift. Determines the return URL (back to the specific giving page,
  // not the org-wide one) as well as the metadata thread.
  let givingPageSlug = "";
  let pageTitle = "";
  let pageCampaignId = null;
  if (givingPageId) {
    const pageRow = await query("SELECT slug, title, campaign_id FROM giving_pages WHERE id=? AND org_id=? AND status='active'", [givingPageId, org.id]);
    if (!pageRow.length) return res.status(400).json({ error: "This giving page is no longer available." });
    givingPageSlug = pageRow[0].slug;
    pageTitle = pageRow[0].title;
    pageCampaignId = pageRow[0].campaign_id || null;
  }

  // Attribution FIX — a page configured to count toward a campaign stamps that
  // campaign into the charge metadata, so the webhook writes gifts.campaign_id
  // and the thermometer moves with no human touch. The page's own configured
  // campaign WINS over any client-sent campaignId (an email-campaign ref):
  // the admin explicitly declared where this page's money counts. Validated by
  // construction — pageCampaignId was written through the org-scoped
  // POST/PUT /giving-pages validation, never trusted raw from this request.
  const effectiveCampaignId = pageCampaignId || campaignId || "";

  const productName = peerFundraiserId
    ? `Donation to ${org.name} — ${pageTitle} (via ${fundraiserName}'s fundraiser)`
    : givingPageId
      ? `Donation to ${org.name} — ${pageTitle}`
      : `Donation to ${org.name}${fundName ? ` — ${fundName}` : ""}`;
  const metadata = {
    donor_email: email,
    donor_name: donorName,
    fund_id: fundId || "",
    frequency,
    campaign_id: effectiveCampaignId,
    giving_page_id: givingPageId || "",
    peer_fundraiser_id: peerFundraiserId || "",
    org_id: org.id,
    // Reference only — the gift/receipt record the full charged amount.
    cover_fees: feesCovered ? "true" : "",
    base_amount_cents: feesCovered ? String(baseCents) : "",
  };

  const returnPath = peerFundraiserId
    ? `/give/${req.params.orgSlug}/${givingPageSlug}/${fundraiserSlug}`
    : givingPageId
      ? `/give/${req.params.orgSlug}/${givingPageSlug}`
      : `/give/${req.params.orgSlug}`;

  const sessionParams = {
    payment_method_types: ["card"],
    mode: isRecurring ? "subscription" : "payment",
    customer_email: email,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: productName },
        unit_amount: amountCents,
        ...(isRecurring && { recurring: { interval: frequency === "annual" ? "year" : "month" } }),
      },
      quantity: 1,
    }],
    metadata,
    success_url: `${frontendUrl}${returnPath}?donated=true`,
    cancel_url: `${frontendUrl}${returnPath}`,
    ...(isRecurring
      ? { subscription_data: { metadata } }
      : {
          payment_intent_data: {
            receipt_email: email,
            metadata,
            statement_descriptor: org.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 22),
          },
        }
    ),
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: org.stripe_account_id,
  });
  res.json({ url: session.url });
}));

// ── Campaign donation link ─────────────────────────────────────────────────
app.post("/stripe/campaign-link", requireAuth, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { campaignId, campaignName } = req.body;

  const orgRow = await query(
    "SELECT stripe_account_id, stripe_connected, name FROM orgs WHERE id=$1",
    [req.user.orgId]
  );
  const org = orgRow[0];
  if (!org?.stripe_connected || !org.stripe_account_id) {
    return res.status(400).json({ error: "Connect Stripe in Settings before generating donation links." });
  }

  const stripeOpts = { stripeAccount: org.stripe_account_id };
  const product = await stripe.products.create(
    { name: `Donation to ${org.name}${campaignName ? ` — ${campaignName}` : ""}` },
    stripeOpts
  );
  const price = await stripe.prices.create(
    { currency: "usd", product: product.id, custom_unit_amount: { enabled: true } },
    stripeOpts
  );
  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      payment_intent_data: { metadata: { campaign_id: campaignId || "", org_id: req.user.orgId } },
    },
    stripeOpts
  );
  res.json({ url: link.url });
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
  res.json(result.map(r => ({
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

app.post("/finance/accounts", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
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

app.put("/finance/accounts/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
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

app.post("/finance/funds", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
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

app.put("/finance/funds/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
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
  const { year, fund, account, donor_id } = req.query;
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
  if (donor_id) { sql += " AND ft.donor_id = ?"; params.push(donor_id); }
  sql += " ORDER BY ft.date DESC, ft.created_at DESC";
  const rows = await query(sql, params);
  res.json(rows);
}));

app.post("/finance/transactions", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { date, description, vendorDonor, amount, type, accountId, fundId, notes, donorId } = req.body;
  if (!date || !description || !amount || !type) {
    return res.status(400).json({ error: "date, description, amount, and type required" });
  }
  // §1 tenant isolation: a foreign account/fund/donor id must not be accepted
  // (would echo another org's label back in the response JOIN and pin a
  // cross-org reference into this org's ledger).
  if (!(await orgOwns("accounts", accountId, req.user.orgId))) return res.status(404).json({ error: "Account not found" });
  if (!(await orgOwns("fin_funds", fundId, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
  if (!(await orgOwns("donors", donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const id = "ft_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,notes,donor_id,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual')",
    [id, req.user.orgId, date, description, vendorDonor || "", parseFloat(amount), type, accountId || null, fundId || null, notes || "", donorId || null]
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

app.post("/finance/budgets", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { accountId, year, amount } = req.body;
  if (!accountId || !year) return res.status(400).json({ error: "accountId and year required" });
  // §1 tenant isolation: reject a foreign account id (would leak another org's
  // account code/name into this org's audit log).
  if (!(await orgOwns("accounts", accountId, req.user.orgId))) return res.status(404).json({ error: "Account not found" });
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

// ── Finance: period bounds ─────────────────────────────────────────────────
// Single source of the app's fiscal-year rule (July 1 boundary — identical to
// /dashboard/my-stats and Reports; `now.getMonth() < 6`). offset 0 = current
// period, -1 = the immediately-preceding period of the same basis. Returns
// ISO date bounds + labels the client renders verbatim, so the FY definition
// lives in exactly one place.
const FIN_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function finPeriodBounds(yearMode, offset = 0) {
  const now = new Date();
  if (yearMode === "fiscal") {
    const curFyStart = now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
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
  const year = now.getFullYear() + offset;
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    periodLabel: `Jan – Dec ${year}`,
    chartLabel: `${year}`,
    months: [...Array(12)].map((_, m) => ({ y: year, m })),
  };
}

// ── Finance: Summary ───────────────────────────────────────────────────────
// Everything the Finance Overview needs, computed server-side so the client
// never juggles cross-calendar-year transaction loads for the fiscal basis and
// every number shares one period definition:
//   cashOnHand   — ALL-TIME ledger net (Σ income − Σ expense). Reconciles with
//                  the ledger by construction; labeled "All-time" on the card.
//   ytd*/net     — CURRENT period (basis-aware).
//   prior*       — the immediately-preceding period, same basis (headline delta).
//   monthly      — current-period months in basis order (Jul-first under fiscal).
//   fundBalances — ALL-TIME per-fund net (a fund balance is cumulative, not per-year).
//   activeFundCount — funds with ≥1 transaction in the CURRENT period.
app.get("/finance/summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const { yearMode = "calendar" } = req.query;
  const cur = finPeriodBounds(yearMode, 0);
  const prior = finPeriodBounds(yearMode, -1);

  const [ytdRows, priorRows, allRows, monthRows, fundRows, activeFundRows, giftHistRows, ledgerGiftRows] = await Promise.all([
    query(`SELECT type, SUM(amount) as total FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type`, [orgId, cur.start, cur.end]),
    query(`SELECT type, SUM(amount) as total FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type`, [orgId, prior.start, prior.end]),
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type", [orgId]),
    query(`SELECT date, type, amount FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ?`, [orgId, cur.start, cur.end]),
    query(`SELECT f.id, f.name, f.restricted,
                  COALESCE(SUM(CASE WHEN ft.type='income' THEN ft.amount
                                    WHEN ft.type='expense' THEN -ft.amount ELSE 0 END), 0) AS balance
           FROM fin_funds f
           LEFT JOIN fin_transactions ft ON ft.fund_id = f.id AND ft.org_id = f.org_id
           WHERE f.org_id = ?
           GROUP BY f.id, f.name, f.restricted
           ORDER BY f.restricted ASC, f.name ASC`, [orgId]),
    query(`SELECT COUNT(DISTINCT fund_id) AS cnt FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? AND fund_id IS NOT NULL`, [orgId, cur.start, cur.end]),
    // B1 — the org's whole giving history (all gifts) vs what actually reached the
    // ledger as gift income. Imported HISTORICAL giving deliberately never stamps
    // fin_transactions (it's records being loaded, not money moving through
    // Steward — see "Imported gifts vs the ledger" in CLAUDE.md). The gap is real
    // and must be EXPLAINED, never left to read as "$0 raised" next to a Reports
    // page showing years of giving.
    // BUILD-33: same deleted_at IS NULL predicate as Reports — this figure's
    // whole job is "your giving history lives in Reports", so it must equal
    // what Reports actually shows (trashed donors' gifts excluded).
    query("SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE g.org_id = ? AND d.deleted_at IS NULL", [orgId]),
    query("SELECT COALESCE(SUM(amount),0) AS total FROM fin_transactions WHERE org_id = ? AND type='income' AND source IN ('gift','import','online','event')", [orgId]),
  ]);

  const ytd   = Object.fromEntries(ytdRows.map(r => [r.type, parseFloat(r.total)]));
  const prev  = Object.fromEntries(priorRows.map(r => [r.type, parseFloat(r.total)]));
  const all   = Object.fromEntries(allRows.map(r => [r.type, parseFloat(r.total)]));

  const ytdRevenue    = ytd.income  || 0;
  const ytdExpenses   = ytd.expense || 0;
  const priorRevenue  = prev.income  || 0;
  const priorExpenses = prev.expense || 0;
  const cashOnHand    = (all.income || 0) - (all.expense || 0);

  // Bucket current-period txns into the basis-ordered month list.
  const monthly = cur.months.map(({ y, m }) => ({
    key: `${y}-${String(m + 1).padStart(2, "0")}`, label: FIN_MONTHS[m], income: 0, expense: 0,
  }));
  const monIdx = Object.fromEntries(monthly.map((mm, i) => [mm.key, i]));
  for (const r of monthRows) {
    const i = monIdx[(r.date || "").slice(0, 7)];
    if (i === undefined) continue;
    if (r.type === "income") monthly[i].income += parseFloat(r.amount);
    else if (r.type === "expense") monthly[i].expense += parseFloat(r.amount);
  }

  // Giving history vs ledger. `unledgeredGiving` = giving that lives in Reports
  // but NOT in the ledger (imported historical gifts). `hasUnledgeredGiving` tells
  // the Finance UI to render the "your giving history lives in Reports" explainer
  // + cross-link instead of implying $0 was ever raised. $1 epsilon so cent-level
  // rounding never trips it.
  const giftHistoryTotal = parseFloat(giftHistRows[0]?.total || 0);
  const giftHistoryCount = parseInt(giftHistRows[0]?.n || 0);
  const ledgerGiftTotal  = parseFloat(ledgerGiftRows[0]?.total || 0);
  const unledgeredGiving = Math.max(0, giftHistoryTotal - ledgerGiftTotal);

  res.json({
    cashOnHand,
    ytdRevenue, ytdExpenses, netSurplus: ytdRevenue - ytdExpenses,
    priorRevenue, priorExpenses, priorNet: priorRevenue - priorExpenses,
    yearMode,
    periodLabel: cur.periodLabel,
    monthlyLabel: cur.chartLabel,
    monthly,
    activeFundCount: parseInt(activeFundRows[0]?.cnt || 0),
    fundBalances: fundRows.map(f => ({
      id: f.id, name: f.name, restricted: f.restricted, balance: parseFloat(f.balance) || 0,
    })),
    giftHistoryTotal, giftHistoryCount, ledgerGiftTotal,
    unledgeredGiving, hasUnledgeredGiving: unledgeredGiving > 1,
  });
}));

// ── Finance: Stripe summary (connected-account money in) ────────────────────
// Live balance + recent payouts for the org's OWN connected Stripe account —
// never Steward's platform billing (that's /billing/*). Org-scoped strictly by
// the caller's orgs.stripe_account_id, never from client input. Cached 5 min
// per org so a Home-adjacent load can't hammer Stripe. Degrades to
// {connected:false} on no account / no Stripe key / any Stripe error — the
// Finance Overview shows a warm connect prompt in that case, never an error.
const STRIPE_SUMMARY_TTL = 5 * 60 * 1000;
const stripeSummaryCache = new Map(); // orgId -> { at, data }
app.get("/finance/stripe-summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const cached = stripeSummaryCache.get(orgId);
  if (cached && Date.now() - cached.at < STRIPE_SUMMARY_TTL) return res.json(cached.data);

  const [org] = await query("SELECT stripe_account_id FROM orgs WHERE id=?", [orgId]);
  const acct = org?.stripe_account_id;
  if (!acct || !stripe) {
    const data = { connected: false };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    return res.json(data);
  }
  try {
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve({ stripeAccount: acct }),
      stripe.payouts.list({ limit: 5 }, { stripeAccount: acct }),
    ]);
    const sumCents = arr => (arr || []).reduce((s, b) => s + (b.amount || 0), 0);
    const data = {
      connected: true,
      balance: {
        available: sumCents(balance.available) / 100,
        pending: sumCents(balance.pending) / 100,
      },
      payouts: (payouts.data || []).map(p => ({
        id: p.id,
        amount: (p.amount || 0) / 100,
        status: p.status,
        arrival_date: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      })),
    };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error("[finance] stripe-summary failed:", e.message);
    // Don't 500 the Finance tab over a Stripe hiccup — treat as not-connected.
    const data = { connected: false, error: "stripe_unavailable" };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    res.json(data);
  }
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

  // Send notification email via Resend HTTP API
  const notifyTo = process.env.DEMO_NOTIFY_EMAIL;
  if (notifyTo && process.env.RESEND_API_KEY) {
    try {
      const from = process.env.DEMO_SMTP_FROM || "onboarding@resend.dev";
      const { error } = await resend.emails.send({
        from,
        to: notifyTo,
        subject: `New Steward demo request — ${name} (${orgName || "unknown org"})`,
        html: `<p><strong>New demo request:</strong></p>
               <p>Name: ${name}<br>Email: ${email}<br>Org: ${orgName}<br>Size: ${orgSize}<br>Challenge: ${challenge}</p>`,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      console.error("Demo notify email failed:", e.message);
    }
  }

  res.json({ success: true });
}));

// ── Board Reports ──────────────────────────────────────────────────────────
const BOARD_REPORTS_DDL = `
  CREATE TABLE IF NOT EXISTS board_reports (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    quarter INTEGER,
    year INTEGER,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    generated_by TEXT,
    generated_by_name TEXT,
    metrics TEXT,
    pdf_data TEXT
  )`;
const BOARD_REPORTS_MIGRATE = `ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS pdf_data TEXT`;

app.get("/reports/board", requireAuth, wrap(async (req, res) => {
  await run(BOARD_REPORTS_DDL).catch(() => {});
  await run(BOARD_REPORTS_MIGRATE).catch(() => {});
  const rows = await query(
    "SELECT id, quarter, year, generated_at, generated_by_name, metrics FROM board_reports WHERE org_id = ? ORDER BY generated_at DESC LIMIT 20",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({
    ...r,
    metrics: typeof r.metrics === "string" ? JSON.parse(r.metrics || "{}") : (r.metrics || {}),
  })));
}));

app.get("/reports/board/:id/pdf", requireAuth, wrap(async (req, res) => {
  const [report] = await query(
    "SELECT id, quarter, year, pdf_data FROM board_reports WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!report || !report.pdf_data) return res.status(404).json({ error: "Report not found" });
  const buf = Buffer.from(report.pdf_data, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="board-report-q${report.quarter}-${report.year}.pdf"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}));

app.post("/reports/board", requireAuth, wrap(async (req, res) => {
  console.log("[board-report] START — orgId:", req.user.orgId);

  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
    console.log("[board-report] step 1: pdfkit loaded OK");
  } catch(e) {
    console.error("[board-report] FAIL step 1: pdfkit not found —", e.message);
    return res.status(500).json({ error: "pdfkit module missing: " + e.message });
  }

  const { orgId, userId, email } = req.user;

  await run(BOARD_REPORTS_DDL).catch(e => console.error("[board-report] DDL warn:", e.message));
  await run(BOARD_REPORTS_MIGRATE).catch(() => {});

  // Date helpers — toDs safely converts Date objects OR strings to YYYY-MM-DD
  const now = new Date();
  const yr = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  const qMs = new Date(yr, (q - 1) * 3, 1).toISOString().slice(0, 10);
  const qMe = new Date(yr, q * 3, 0).toISOString().slice(0, 10);
  const pqMs = new Date(yr, (q - 2) * 3, 1).toISOString().slice(0, 10);
  const pqMe = new Date(yr, (q - 1) * 3, 0).toISOString().slice(0, 10);
  const ytdS = `${yr}-01-01`;
  const ytdE = `${yr}-12-31`;
  const today = now.toISOString().slice(0, 10);
  const toDs = d => d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : "";

  console.log("[board-report] step 2: dates — q:", q, "yr:", yr, "qMs:", qMs, "qMe:", qMe);

  // Fetch raw data
  console.log("[board-report] step 3: fetching core data...");
  const [org, allDonors, allGrants, allTasks, allCampaigns] = await Promise.all([
    query("SELECT * FROM orgs WHERE id = ?", [orgId]).then(r => r[0]),
    query("SELECT id,name,total_giving,stage,created_at FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]),
    query("SELECT * FROM grants WHERE org_id = ?", [orgId]),
    query("SELECT done,due FROM tasks WHERE org_id = ?", [orgId]),
    query("SELECT * FROM campaigns WHERE org_id = ?", [orgId]),
  ]);
  console.log("[board-report] step 3: core data OK — donors:", allDonors.length, "grants:", allGrants.length, "tasks:", allTasks.length, "campaigns:", allCampaigns.length);

  // Finance
  console.log("[board-report] step 4: fetching finance data...");
  const [ytdFinRows, allFinRows, topExpRows, budgetRows] = await Promise.all([
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type", [orgId, ytdS, ytdE]),
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type", [orgId]),
    query(
      `SELECT a.name, SUM(ft.amount) as total FROM fin_transactions ft
       LEFT JOIN accounts a ON a.id = ft.account_id
       WHERE ft.org_id = ? AND ft.type = 'expense' AND ft.date >= ? AND ft.date <= ?
       GROUP BY a.name ORDER BY total DESC LIMIT 5`,
      [orgId, ytdS, ytdE]
    ),
    query(
      `SELECT a.name, COALESCE(b.amount, 0) as budget, COALESCE(SUM(ft.amount), 0) as actual
       FROM accounts a
       LEFT JOIN budgets b ON b.account_id = a.id AND b.year = ?
       LEFT JOIN fin_transactions ft ON ft.account_id = a.id AND ft.type = 'expense' AND ft.date >= ? AND ft.date <= ?
       WHERE a.org_id = ? AND a.type = 'expense' AND a.active = TRUE
       GROUP BY a.name, b.amount ORDER BY actual DESC LIMIT 8`,
      [yr, ytdS, ytdE, orgId]
    ),
  ]);

  console.log("[board-report] step 4: finance OK — ytdFinRows:", ytdFinRows.length, "budgetRows:", budgetRows.length);
  const ytdFin = Object.fromEntries(ytdFinRows.map(r => [r.type, parseFloat(r.total) || 0]));
  const allFin = Object.fromEntries(allFinRows.map(r => [r.type, parseFloat(r.total) || 0]));
  const ytdRevenue  = ytdFin.income  || 0;
  const ytdExpenses = ytdFin.expense || 0;
  const netSurplus  = ytdRevenue - ytdExpenses;
  const cashOnHand  = (allFin.income || 0) - (allFin.expense || 0);
  const totalBudget = budgetRows.reduce((s, r) => s + (parseFloat(r.budget) || 0), 0);
  const totalActual = budgetRows.reduce((s, r) => s + (parseFloat(r.actual) || 0), 0);
  const budgetVariance = totalBudget - totalActual;

  // Donors
  const totalDonors  = allDonors.length;
  const lapsedDonors = allDonors.filter(d => d.stage === "lapsed").length;
  const newDonorsQ   = allDonors.filter(d => toDs(d.created_at) >= qMs && toDs(d.created_at) <= qMe).length;
  const top10        = [...allDonors].sort((a, b) => (b.total_giving || 0) - (a.total_giving || 0)).slice(0, 10);

  console.log("[board-report] step 5: fetching gift retention rows...");
  const [thisYrRows, prevYrRows, qGiftRows, pqGiftRows] = await Promise.all([
    query("SELECT DISTINCT donor_id FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?", [orgId, ytdS, ytdE]),
    query("SELECT DISTINCT donor_id FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?", [orgId, `${yr - 1}-01-01`, `${yr - 1}-12-31`]),
    query("SELECT COALESCE(SUM(amount),0) as total FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?", [orgId, qMs, qMe]),
    query("SELECT COALESCE(SUM(amount),0) as total FROM gifts WHERE org_id = ? AND date >= ? AND date <= ?", [orgId, pqMs, pqMe]),
  ]);
  console.log("[board-report] step 5: retention OK — thisYr:", thisYrRows.length, "prevYr:", prevYrRows.length);
  const prevYrIds     = new Set(prevYrRows.map(r => r.donor_id));
  const thisYrIds     = new Set(thisYrRows.map(r => r.donor_id));
  const retained      = [...thisYrIds].filter(id => prevYrIds.has(id)).length;
  const retentionRate = prevYrIds.size > 0 ? Math.round(retained / prevYrIds.size * 100) : 0;
  const raisedThisQ   = parseFloat(qGiftRows[0]?.total) || 0;
  const raisedLastQ   = parseFloat(pqGiftRows[0]?.total) || 0;

  // Grants
  const activeGrants    = allGrants.filter(g => g.status === "active");
  const pipelineGrants  = allGrants.filter(g => ["prospecting", "pending"].includes(g.status));
  const wonThisQ        = allGrants.filter(g => g.status === "active" && toDs(g.updated_at) >= qMs);
  const thirty          = new Date(now); thirty.setDate(thirty.getDate() + 30);
  const upcomingDL      = allGrants.filter(g => {
    if (!g.deadline || g.status === "closed") return false;
    const d = new Date(g.deadline); return d >= now && d <= thirty;
  });
  const pipelineValue = pipelineGrants.reduce((s, g) => s + (g.amount || 0), 0);
  const awardedYTD    = activeGrants.reduce((s, g) => s + (g.received || 0), 0);

  // Communications
  const sentQ        = allCampaigns.filter(c => c.status === "sent" && toDs(c.sent_at) >= qMs && toDs(c.sent_at) <= qMe);
  const avgOpenRate  = sentQ.length > 0
    ? Math.round(sentQ.reduce((s, c) => s + ((c.open_count || 0) / Math.max(c.recipient_count || 1, 1) * 100), 0) / sentQ.length)
    : 0;
  const totalReached = sentQ.reduce((s, c) => s + (c.recipient_count || 0), 0);

  // Tasks
  const completedQ = allTasks.filter(t => t.done && (t.due || "") >= qMs && (t.due || "") <= qMe).length;
  const overdue    = allTasks.filter(t => !t.done && t.due && t.due < today).length;

  console.log("[board-report] step 6: computed — totalDonors:", totalDonors, "activeGrants:", activeGrants.length, "pipelineValue:", pipelineValue, "raisedThisQ:", raisedThisQ, "completedQ:", completedQ, "overdue:", overdue);

  // AI Executive Summary
  console.log("[board-report] step 7: calling Claude API...");
  const client = new Anthropic();
  let execSummary = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `Write an executive summary for a nonprofit board of directors. Exactly 3 paragraphs. Confident, board-appropriate, factual tone. No bullet points. No headers. Prose only.

Paragraph 1 — Financial Health: YTD Revenue $${ytdRevenue.toLocaleString()}, Expenses $${ytdExpenses.toLocaleString()}, Net Surplus $${netSurplus.toLocaleString()}, Cash on Hand $${cashOnHand.toLocaleString()}, Budget Variance ${budgetVariance >= 0 ? "favorable" : "unfavorable"} by $${Math.abs(budgetVariance).toLocaleString()}. Top expense category: ${topExpRows[0]?.name || "operations"}.

Paragraph 2 — Donor & Fundraising Momentum: ${totalDonors} total donors, ${newDonorsQ} new this quarter, ${lapsedDonors} lapsed, ${retentionRate}% retention rate vs prior year. Raised $${raisedThisQ.toLocaleString()} this quarter vs $${raisedLastQ.toLocaleString()} last quarter. ${sentQ.length} campaigns sent with ${avgOpenRate}% average open rate.

Paragraph 3 — Grants & Opportunities: ${activeGrants.length} active grants, $${pipelineValue.toLocaleString()} in pipeline, $${awardedYTD.toLocaleString()} awarded YTD. ${wonThisQ.length} grants won this quarter. ${upcomingDL.length} deadline(s) in the next 30 days${upcomingDL.length > 0 ? " (" + upcomingDL.slice(0, 3).map(g => g.funder).join(", ") + ")" : ""}. ${overdue} overdue tasks.

Organization: ${org.name}. Mission: ${org.mission || "not specified"}. Period: Q${q} ${yr}.`,
      }],
    });
    execSummary = msg.content[0].text.trim();
    console.log("[board-report] step 7: Claude OK —", execSummary.length, "chars");
  } catch(e) {
    console.error("[board-report] step 7: Claude FAILED (using fallback) —", e.message);
    execSummary = `${org.name} concludes Q${q} ${yr} with year-to-date revenue of $${ytdRevenue.toLocaleString()} and expenses of $${ytdExpenses.toLocaleString()}, producing a net ${netSurplus >= 0 ? "surplus" : "deficit"} of $${Math.abs(netSurplus).toLocaleString()}. Cash on hand stands at $${cashOnHand.toLocaleString()}, with a budget variance that is ${budgetVariance >= 0 ? "favorable" : "unfavorable"} by $${Math.abs(budgetVariance).toLocaleString()}.\n\nThe donor base comprises ${totalDonors} constituents, with ${newDonorsQ} new donors acquired this quarter and a year-over-year retention rate of ${retentionRate}%. The organization raised $${raisedThisQ.toLocaleString()} this quarter compared to $${raisedLastQ.toLocaleString()} in the prior quarter. ${sentQ.length} email campaigns reached ${totalReached} donors with an average open rate of ${avgOpenRate}%.\n\nThe grant portfolio includes ${activeGrants.length} active grants with $${pipelineValue.toLocaleString()} in the pipeline and $${awardedYTD.toLocaleString()} awarded year to date. ${wonThisQ.length > 0 ? wonThisQ.length + " grant(s) were secured this quarter. " : ""}${upcomingDL.length} deadline(s) fall within the next 30 days, requiring board awareness and organizational follow-through.`;
  }

  // Generate PDF
  console.log("[board-report] step 8: generating PDF...");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  const pdfBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#1a6b4a";
    const INK   = "#1a1a1a";
    const INK3  = "#6b7280";
    const BG    = "#f5f5f0";
    const PW    = doc.page.width;
    const fmtD  = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const ql    = `Q${q} ${yr}`;
    const genDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // ── PAGE 1: Cover ──────────────────────────────────────────────────────
    doc.rect(0, 0, PW, doc.page.height).fill("#0d1117");
    doc.rect(0, 0, PW, 5).fill(GREEN);
    doc.rect(0, doc.page.height - 5, PW, 5).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(30).fillColor("#ffffff").text(org.name, 0, 250, { align: "center", width: PW });
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280").text("B O A R D   R E P O R T", 0, doc.y + 10, { align: "center" });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(GREEN).text(ql, 0, doc.y + 10, { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(genDate, 0, doc.y + 8, { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#374151").text("CONFIDENTIAL — FOR BOARD USE ONLY", 0, doc.y + 40, { align: "center", characterSpacing: 1.5 });

    // ── PAGE 2: Executive Summary ──────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Executive Summary", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql + " · " + org.name, 50, 42);

    let y = 76;
    execSummary.split(/\n+/).filter(Boolean).forEach((para, i) => {
      if (i > 0) y += 12;
      doc.font("Helvetica").fontSize(11).fillColor(INK).text(para.trim(), 50, y, { width: PW - 100, lineGap: 5 });
      y = doc.y + 2;
    });

    // ── PAGE 3: Financial Snapshot ─────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Financial Snapshot", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(`Year to Date ${yr}`, 50, 42);

    y = 76;
    const mw = (PW - 100) / 4;
    [
      ["YTD Revenue",  fmtD(ytdRevenue),  "#1a6b4a"],
      ["YTD Expenses", fmtD(ytdExpenses), "#dc2626"],
      ["Net Surplus",  fmtD(netSurplus),  netSurplus >= 0 ? "#1a6b4a" : "#dc2626"],
      ["Cash on Hand", fmtD(cashOnHand),  cashOnHand >= 0 ? "#1a6b4a" : "#dc2626"],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * mw;
      doc.rect(x, y, mw - 6, 60).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: mw - 18 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(color).text(value, x + 8, y + 24, { width: mw - 18 });
    });
    y += 72;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Budget vs. Actuals — Expense Accounts", 50, y); y += 18;
    doc.rect(50, y, PW - 100, 22).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#fff");
    doc.text("Account", 58, y + 7, { width: 195 });
    doc.text("Budget", 260, y + 7, { width: 85, align: "right" });
    doc.text("Actual YTD", 352, y + 7, { width: 85, align: "right" });
    doc.text("Variance", 444, y + 7, { width: 78, align: "right" });
    y += 22;

    budgetRows.forEach((row, i) => {
      const bgt  = parseFloat(row.budget) || 0;
      const act  = parseFloat(row.actual) || 0;
      const vari = bgt - act;
      doc.rect(50, y, PW - 100, 20).fill(i % 2 === 0 ? "#ffffff" : BG);
      doc.font("Helvetica").fontSize(8).fillColor(INK).text(row.name || "Uncategorized", 58, y + 6, { width: 195 });
      doc.text(bgt > 0 ? fmtD(bgt) : "—", 260, y + 6, { width: 85, align: "right" });
      doc.text(fmtD(act), 352, y + 6, { width: 85, align: "right" });
      doc.font("Helvetica-Bold").fillColor(vari >= 0 ? "#1a6b4a" : "#dc2626").text((vari >= 0 ? "+" : "") + fmtD(vari), 444, y + 6, { width: 78, align: "right" });
      y += 20;
    });

    doc.rect(50, y, PW - 100, 22).fill("#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text("TOTAL", 58, y + 7, { width: 195 });
    doc.text(fmtD(totalBudget), 260, y + 7, { width: 85, align: "right" });
    doc.text(fmtD(totalActual), 352, y + 7, { width: 85, align: "right" });
    doc.fillColor(budgetVariance >= 0 ? "#1a6b4a" : "#dc2626").text((budgetVariance >= 0 ? "+" : "") + fmtD(budgetVariance), 444, y + 7, { width: 78, align: "right" });
    y += 30;

    if (topExpRows.length > 0) {
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(
        `Largest expense category: ${topExpRows[0].name} (${fmtD(topExpRows[0].total)})`, 50, y
      );
    }

    // ── PAGE 4: Donor Dashboard ────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Donor Dashboard", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql, 50, 42);

    y = 76;
    [
      ["Total Donors",      String(totalDonors),  INK],
      ["New This Quarter",  String(newDonorsQ),   "#1a6b4a"],
      ["Lapsed Donors",     String(lapsedDonors), "#dc2626"],
      ["Retention Rate",    retentionRate + "%",  retentionRate >= 70 ? "#1a6b4a" : retentionRate >= 50 ? "#f59e0b" : "#dc2626"],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * mw;
      doc.rect(x, y, mw - 6, 60).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: mw - 18 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(color).text(value, x + 8, y + 24, { width: mw - 18 });
    });
    y += 72;

    const qChange = raisedLastQ > 0 ? ((raisedThisQ - raisedLastQ) / raisedLastQ * 100).toFixed(1) : null;
    doc.rect(50, y, PW - 100, 44).fill(BG);
    doc.font("Helvetica").fontSize(8).fillColor(INK3).text("RAISED THIS QUARTER", 62, y + 9);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(GREEN).text(fmtD(raisedThisQ), 62, y + 22);
    doc.font("Helvetica").fontSize(9).fillColor(INK3).text(`vs ${fmtD(raisedLastQ)} prior quarter`, 215, y + 26);
    if (qChange !== null) {
      const dir = parseFloat(qChange) >= 0 ? "▲" : "▼";
      doc.font("Helvetica-Bold").fontSize(12)
        .fillColor(parseFloat(qChange) >= 0 ? "#1a6b4a" : "#dc2626")
        .text(`${dir} ${Math.abs(parseFloat(qChange)).toFixed(1)}%`, 375, y + 22);
    }
    y += 56;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Top 10 Donors — Lifetime Giving", 50, y); y += 18;
    doc.rect(50, y, PW - 100, 22).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#fff");
    doc.text("#", 58, y + 7, { width: 18 });
    doc.text("Donor", 82, y + 7, { width: 235 });
    doc.text("Stage", 324, y + 7, { width: 90 });
    doc.text("Lifetime Giving", 422, y + 7, { width: 100, align: "right" });
    y += 22;

    top10.forEach((d, i) => {
      const parts   = (d.name || "").trim().split(" ");
      const display = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
      doc.rect(50, y, PW - 100, 20).fill(i % 2 === 0 ? "#ffffff" : BG);
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(String(i + 1), 58, y + 6, { width: 18 });
      doc.fillColor(INK).text(display, 82, y + 6, { width: 235 });
      doc.fillColor(INK3).text(d.stage || "—", 324, y + 6, { width: 90 });
      doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(d.total_giving), 422, y + 6, { width: 100, align: "right" });
      y += 20;
    });

    // ── PAGE 5: Grants + Communications + Tasks ────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Grants & Operations", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql, 50, 42);

    y = 76;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Grant Portfolio", 50, y); y += 18;
    const gmw = (PW - 100) / 5;
    [
      ["Active Grants",  String(activeGrants.length)],
      ["Pipeline Value", fmtD(pipelineValue)],
      ["Awarded YTD",    fmtD(awardedYTD)],
      ["Won This Qtr",   String(wonThisQ.length)],
      ["Due in 30 Days", String(upcomingDL.length)],
    ].forEach(([label, value], i) => {
      const x = 50 + i * gmw;
      doc.rect(x, y, gmw - 5, 52).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 7, y + 8, { width: gmw - 16 });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(GREEN).text(value, x + 7, y + 22, { width: gmw - 16 });
    });
    y += 64;

    if (upcomingDL.length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Upcoming Grant Deadlines (Next 30 Days)", 50, y); y += 16;
      upcomingDL.slice(0, 5).forEach((g, i) => {
        const days = Math.round((new Date(g.deadline) - now) / 86400000);
        doc.rect(50, y, PW - 100, 19).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(g.funder, 58, y + 5, { width: 200 });
        doc.fillColor(INK3).text(g.program || "—", 264, y + 5, { width: 140 });
        doc.font("Helvetica-Bold").fillColor(days <= 14 ? "#dc2626" : "#f59e0b").text(days + "d", 415, y + 5, { width: 100, align: "right" });
        y += 19;
      });
      y += 12;
    }

    doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Communications — Q" + q + " Activity", 50, y); y += 18;
    const cw = (PW - 100) / 3;
    [
      ["Campaigns Sent", String(sentQ.length)],
      ["Avg Open Rate",  avgOpenRate + "%"],
      ["Donors Reached", String(totalReached)],
    ].forEach(([label, value], i) => {
      const x = 50 + i * cw;
      doc.rect(x, y, cw - 6, 50).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: cw - 18 });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(value, x + 8, y + 22, { width: cw - 18 });
    });
    y += 62;

    doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Task Summary", 50, y); y += 18;
    [
      ["Completed This Qtr", String(completedQ),                        "#1a6b4a"],
      ["Overdue Tasks",      String(overdue),                           overdue > 0 ? "#dc2626" : "#1a6b4a"],
      ["Total Open",         String(allTasks.filter(t => !t.done).length), INK],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * cw;
      doc.rect(x, y, cw - 6, 50).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: cw - 18 });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(color).text(value, x + 8, y + 22, { width: cw - 18 });
    });

    // Page numbers + footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
        .text(`${org.name}  ·  ${ql} Board Report  ·  Confidential`, 50, doc.page.height - 28, { width: PW - 130, height: 20, align: "left" })
        .text(`${i - range.start + 1} / ${range.count}`, PW - 80, doc.page.height - 28, { width: 30, height: 20, align: "right" });
    }

    doc.end();
  });

  console.log("[board-report] step 8: PDF OK —", pdfBuffer.length, "bytes");

  // Save report record
  const reportId = "br_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO board_reports (id,org_id,quarter,year,generated_by,generated_by_name,metrics,pdf_data) VALUES (?,?,?,?,?,?,?,?)",
    [reportId, orgId, q, yr, userId, email, JSON.stringify({
      ytdRevenue, ytdExpenses, netSurplus, cashOnHand,
      totalDonors, newDonorsQ, lapsedDonors, retentionRate,
      raisedThisQ, raisedLastQ,
      activeGrants: activeGrants.length, pipelineValue, awardedYTD,
      sentCampaigns: sentQ.length, avgOpenRate, totalReached,
      completedQ, overdue,
    }), pdfBuffer.toString("base64")]
  ).catch(e => console.error("[board-report] step 9 WARN: save failed —", e.message));
  console.log("[board-report] step 9: record saved —", reportId);

  const safeOrg  = org.name.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
  const filename = `${safeOrg}-board-report-q${q}-${yr}.pdf`;
  console.log("[board-report] DONE — sending", filename, pdfBuffer.length, "bytes");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));

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
function reportCurrentYear(yearMode, now = new Date()) {
  return yearMode === "fiscal"
    ? (now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1)
    : now.getFullYear();
}

function parseReportParams(q) {
  const bad = msg => { const e = new Error(msg); e.status = 400; return e; };
  const p = {};

  p.yearMode = q.yearMode || "fiscal";
  if (!["fiscal", "calendar"].includes(p.yearMode)) throw bad("yearMode must be 'fiscal' or 'calendar'");

  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

  if (q.year !== undefined) {
    p.year = parseInt(q.year, 10);
    if (!Number.isInteger(p.year) || p.year < 1970 || p.year > 2100) throw bad("year must be an integer between 1970 and 2100");
    const b = reportYearBounds(p.year, p.yearMode);
    p.from = b.from; p.to = b.to;
  } else if (q.from || q.to) {
    if (!q.from || !isDate(q.from)) throw bad("from must be YYYY-MM-DD");
    if (!q.to || !isDate(q.to)) throw bad("to must be YYYY-MM-DD");
    p.from = q.from; p.to = q.to;
    p.year = reportCurrentYear(p.yearMode); // for reports that need a year anyway
  } else {
    p.year = reportCurrentYear(p.yearMode);
    const b = reportYearBounds(p.year, p.yearMode);
    p.from = b.from; p.to = b.to;
  }
  if (p.from > p.to) throw bad("from must be on or before to");
  if (Date.parse(p.to) - Date.parse(p.from) > 10 * 366 * 86400000) throw bad("Date range too large — 10 years max");

  if (q.fundId) p.fundId = String(q.fundId);
  if (q.campaignId) p.campaignId = String(q.campaignId);

  p.groupBy = q.groupBy || "funds";
  if (!["funds", "campaigns", "giving_pages"].includes(p.groupBy)) throw bad("groupBy must be funds, campaigns, or giving_pages");

  p.scope = q.scope === "lifetime" ? "lifetime" : "period";
  p.limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);
  p.view = q.view === "household" ? "household" : "individual"; // top-donors grouping (BUILD-14)
  p.format = q.format === "csv" ? "csv" : "json";
  return p;
}

// Shared WHERE fragment for gift-level queries: org-scoped, soft-deleted
// donors excluded (matching the app-wide `deleted_at IS NULL` convention),
// optional fund/campaign filters. is_sample rows are deliberately included —
// they're org data, and real orgs won't have any.
function reportGiftWhere(p, orgId, params) {
  let sql = " g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?";
  params.push(orgId, p.from, p.to);
  if (p.fundId) { sql += " AND g.fund_id = ?"; params.push(p.fundId); }
  if (p.campaignId) { sql += " AND g.campaign_id = ?"; params.push(p.campaignId); }
  return sql;
}
const REPORT_GIFT_FROM = "FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE";

async function reportGivingSummary(orgId, p) {
  const tParams = [];
  const where = reportGiftWhere(p, orgId, tParams);
  const [totals] = await query(
    `SELECT COUNT(*)::int AS gift_count,
            COALESCE(SUM(g.amount),0) AS total,
            COUNT(DISTINCT g.donor_id)::int AS unique_donors,
            COALESCE(AVG(g.amount),0) AS avg_gift,
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY g.amount),0) AS median_gift,
            COALESCE(SUM(CASE WHEN g.stripe_payment_id IS NOT NULL THEN g.amount ELSE 0 END),0) AS online_total,
            COUNT(*) FILTER (WHERE g.stripe_payment_id IS NOT NULL)::int AS online_count
     ${REPORT_GIFT_FROM} ${where}`, tParams);

  // New donors = first-ever gift (any fund/campaign) falls inside the period.
  const nParams = [];
  const nWhere = reportGiftWhere(p, orgId, nParams);
  const [newSplit] = await query(
    `WITH period_donors AS (SELECT DISTINCT g.donor_id ${REPORT_GIFT_FROM} ${nWhere}),
          firsts AS (SELECT donor_id, MIN(date) AS fg FROM gifts WHERE org_id = ? GROUP BY donor_id)
     SELECT COUNT(*) FILTER (WHERE f.fg >= ? AND f.fg <= ?)::int AS new_donors, COUNT(*)::int AS period_donors
     FROM period_donors pd JOIN firsts f ON f.donor_id = pd.donor_id`,
    [...nParams, orgId, p.from, p.to]);

  const mParams = [];
  const mWhere = reportGiftWhere(p, orgId, mParams);
  const monthly = await query(
    `SELECT LEFT(g.date, 7) AS month, COUNT(*)::int AS gifts,
            COALESCE(SUM(g.amount),0) AS total, COUNT(DISTINCT g.donor_id)::int AS donors
     ${REPORT_GIFT_FROM} ${mWhere} GROUP BY 1 ORDER BY 1`, mParams);

  // Prior period of equal length, for the narrative compare line.
  const spanDays = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  const dayShift = (iso, days) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const prior = { ...p, from: dayShift(p.from, -spanDays), to: dayShift(p.from, -1) };
  const pParams = [];
  const pWhere = reportGiftWhere(prior, orgId, pParams);
  const [priorTotals] = await query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total
     ${REPORT_GIFT_FROM} ${pWhere}`, pParams);

  return {
    from: p.from, to: p.to,
    total: Number(totals.total),
    giftCount: totals.gift_count,
    uniqueDonors: totals.unique_donors,
    avgGift: Math.round(Number(totals.avg_gift) * 100) / 100,
    medianGift: Number(totals.median_gift),
    newDonors: newSplit.new_donors,
    returningDonors: newSplit.period_donors - newSplit.new_donors,
    onlineTotal: Number(totals.online_total),
    onlineCount: totals.online_count,
    offlineTotal: Number(totals.total) - Number(totals.online_total),
    offlineCount: totals.gift_count - totals.online_count,
    prior: { from: prior.from, to: prior.to, total: Number(priorTotals.total), giftCount: priorTotals.gift_count },
    monthly: monthly.map(m => ({ month: m.month, gifts: m.gifts, total: Number(m.total), donors: m.donors })),
  };
}

async function reportByGroup(orgId, p) {
  // One query family, parameterized by groupBy. Campaigns honor the legacy
  // dual attribution (gifts.campaign_id OR the older gifts.campaign name
  // column); dangling ids (deleted fund/page) fall into the "No X" bucket —
  // the tolerated-dangling-reference pattern.
  const JOINS = {
    funds: { join: "LEFT JOIN fin_funds x ON x.id = g.fund_id AND x.org_id = g.org_id", name: "COALESCE(x.name, 'No fund')" },
    campaigns: { join: "LEFT JOIN campaigns x ON x.id = g.campaign_id AND x.org_id = g.org_id", name: "COALESCE(x.name, NULLIF(g.campaign, ''), 'No campaign')" },
    giving_pages: { join: "LEFT JOIN giving_pages x ON x.id = g.giving_page_id AND x.org_id = g.org_id", name: "COALESCE(x.title, 'No giving page')" },
  };
  const cfg = JOINS[p.groupBy];
  const params = [];
  const where = reportGiftWhere(p, orgId, params);
  const rows = await query(
    `SELECT ${cfg.name} AS name, COALESCE(SUM(g.amount),0) AS total,
            COUNT(*)::int AS gift_count, COUNT(DISTINCT g.donor_id)::int AS unique_donors
     FROM gifts g JOIN donors d ON d.id = g.donor_id ${cfg.join}
     WHERE ${where} GROUP BY 1 ORDER BY total DESC`, params);
  const grand = rows.reduce((s, r) => s + Number(r.total), 0);
  return {
    from: p.from, to: p.to, groupBy: p.groupBy, grandTotal: grand,
    rows: rows.map(r => ({
      name: r.name, total: Number(r.total), giftCount: r.gift_count,
      uniqueDonors: r.unique_donors,
      pct: grand > 0 ? Math.round(Number(r.total) / grand * 1000) / 10 : 0,
    })),
  };
}

// LYBUNT = gift in the prior year, none in the selected year.
// SYBUNT = any gift ever before the selected year, none in the selected year.
// Both predicates live here in SQL and nowhere else.
async function reportBuntList(orgId, p, kind) {
  const cur = reportYearBounds(p.year, p.yearMode);
  const prior = reportYearBounds(p.year - 1, p.yearMode);
  const gaveBeforeSql = kind === "lybunt"
    ? "EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.date >= ? AND g.date <= ?)"
    : "EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.date < ?)";
  const gaveBeforeParams = kind === "lybunt" ? [prior.from, prior.to] : [cur.from];
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.assigned_to_name,
            COALESCE(d.total_giving, 0) AS total_giving, d.last_gift_date, d.last_gift_amount,
            (SELECT COALESCE(SUM(g.amount),0) FROM gifts g
              WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.date >= ? AND g.date <= ?) AS prior_year_total
     FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL
       AND ${gaveBeforeSql}
       AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.date >= ? AND g.date <= ?)
     ORDER BY COALESCE(d.total_giving, 0) DESC`,
    [prior.from, prior.to, orgId, ...gaveBeforeParams, cur.from, cur.to]);
  return {
    year: p.year, yearMode: p.yearMode, currentPeriod: cur, priorPeriod: prior,
    rows: rows.map(r => ({
      id: r.id, name: r.name, email: r.email, assignedTo: r.assigned_to_name,
      lifetimeGiving: Number(r.total_giving), lastGiftDate: r.last_gift_date,
      lastGiftAmount: Number(r.last_gift_amount || 0), priorYearTotal: Number(r.prior_year_total),
    })),
  };
}

async function reportRetention(orgId, p) {
  // Last 3 COMPLETED years (per year mode). Retention for year Y = donors
  // who gave in Y-1 and gave again in Y; dollar retention = Y dollars from
  // those retained donors / total Y-1 dollars; first-year retention = the
  // same, restricted to donors whose first-ever gift was in Y-1.
  const lastCompleted = reportCurrentYear(p.yearMode) - 1;
  const years = [lastCompleted - 2, lastCompleted - 1, lastCompleted];
  const rows = [];
  for (const y of years) {
    const cur = reportYearBounds(y, p.yearMode);
    const prior = reportYearBounds(y - 1, p.yearMode);
    const [r] = await query(
      `WITH prior AS (SELECT g.donor_id, SUM(g.amount) AS amt FROM gifts g JOIN donors d ON d.id = g.donor_id
                      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? GROUP BY g.donor_id),
            cur AS (SELECT g.donor_id, SUM(g.amount) AS amt FROM gifts g JOIN donors d ON d.id = g.donor_id
                    WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? GROUP BY g.donor_id),
            firsts AS (SELECT donor_id, MIN(date) AS fg FROM gifts WHERE org_id = ? GROUP BY donor_id)
       SELECT (SELECT COUNT(*) FROM prior)::int AS prior_donors,
              (SELECT COUNT(*) FROM prior pr WHERE EXISTS (SELECT 1 FROM cur c WHERE c.donor_id = pr.donor_id))::int AS retained_donors,
              (SELECT COALESCE(SUM(amt),0) FROM prior) AS prior_dollars,
              (SELECT COALESCE(SUM(c.amt),0) FROM cur c WHERE EXISTS (SELECT 1 FROM prior pr WHERE pr.donor_id = c.donor_id)) AS retained_dollars,
              (SELECT COUNT(*) FROM prior pr JOIN firsts f ON f.donor_id = pr.donor_id WHERE f.fg >= ? AND f.fg <= ?)::int AS first_year_donors,
              (SELECT COUNT(*) FROM prior pr JOIN firsts f ON f.donor_id = pr.donor_id
                WHERE f.fg >= ? AND f.fg <= ? AND EXISTS (SELECT 1 FROM cur c WHERE c.donor_id = pr.donor_id))::int AS first_year_retained`,
      [orgId, prior.from, prior.to, orgId, cur.from, cur.to, orgId, prior.from, prior.to, prior.from, prior.to]);
    const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : null;
    rows.push({
      year: y, label: p.yearMode === "fiscal" ? `FY${y}` : String(y),
      priorDonors: r.prior_donors, retainedDonors: r.retained_donors,
      retentionRate: pct(r.retained_donors, r.prior_donors),
      priorDollars: Number(r.prior_dollars), retainedDollars: Number(r.retained_dollars),
      dollarRetentionRate: r.prior_dollars > 0 ? Math.round(Number(r.retained_dollars) / Number(r.prior_dollars) * 1000) / 10 : null,
      firstYearDonors: r.first_year_donors, firstYearRetained: r.first_year_retained,
      firstYearRetentionRate: pct(r.first_year_retained, r.first_year_donors),
    });
  }
  return { yearMode: p.yearMode, rows };
}

async function reportTopDonors(orgId, p) {
  if (p.scope === "lifetime") {
    // Donor columns, not SUM(gifts) — imported giving history often has
    // total_giving set with no individual gifts rows behind it.
    const rows = await query(
      `SELECT id, name, COALESCE(total_giving,0) AS total, COALESCE(gift_count,0) AS gift_count, last_gift_date
       FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(total_giving,0) > 0
       ORDER BY COALESCE(total_giving,0) DESC LIMIT ?`, [orgId, p.limit]);
    return { scope: "lifetime", rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, total: Number(r.total), giftCount: Number(r.gift_count), lastGiftDate: r.last_gift_date })) };
  }
  const params = [];
  const where = reportGiftWhere(p, orgId, params);
  if (p.view === "household") {
    // Household view: group the SAME gift rows by household (solo donors are
    // their own group via COALESCE(household_id, donor_id)). This is a pure
    // GROUP BY re-key — SUM over groups === SUM over individuals === org hard
    // total, so grouping by household can NEVER inflate totals. That
    // invariant is asserted in tests/households.test.js.
    const rows = await query(
      `SELECT COALESCE(d.household_id, d.id) AS group_id,
              COALESCE(h.name, d.name) AS name,
              (h.id IS NOT NULL) AS is_household,
              COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count,
              MAX(g.date) AS last_gift_date, COUNT(DISTINCT d.id)::int AS member_count
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
       WHERE ${where}
       GROUP BY COALESCE(d.household_id, d.id), COALESCE(h.name, d.name), h.id
       ORDER BY total DESC LIMIT ?`, [...params, p.limit]);
    return { scope: "period", view: "household", from: p.from, to: p.to,
      rows: rows.map((r, i) => ({ rank: i + 1, id: r.group_id, name: r.name, isHousehold: !!r.is_household, memberCount: r.member_count, total: Number(r.total), giftCount: r.gift_count, lastGiftDate: r.last_gift_date })) };
  }
  const rows = await query(
    `SELECT d.id, d.name, COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count, MAX(g.date) AS last_gift_date
     ${REPORT_GIFT_FROM} ${where} GROUP BY d.id, d.name
     ORDER BY total DESC LIMIT ?`, [...params, p.limit]);
  return { scope: "period", view: "individual", from: p.from, to: p.to, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, total: Number(r.total), giftCount: r.gift_count, lastGiftDate: r.last_gift_date })) };
}

// ── BUILD-17 reporting-cadence reports ─────────────────────────────────────
// 3-year donor giving comparison [Core]: per-donor giving this year vs last
// vs prior (YoYoY), plus the org-level 3-year trend. Reuses reportYearBounds /
// yearMode — one FY definition with the rest of Reports/Finance.
async function reportThreeYear(orgId, p) {
  const y0 = reportYearBounds(p.year, p.yearMode);       // most recent (selected) year
  const y1 = reportYearBounds(p.year - 1, p.yearMode);
  const y2 = reportYearBounds(p.year - 2, p.yearMode);   // oldest
  const label = y => p.yearMode === "fiscal" ? `FY${y}` : String(y);
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.assigned_to_name,
            COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0) AS y0,
            COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0) AS y1,
            COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0) AS y2
     FROM donors d JOIN gifts g ON g.donor_id = d.id AND g.org_id = d.org_id
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
     GROUP BY d.id, d.name, d.email, d.assigned_to_name
     ORDER BY (COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0)
             + COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0)
             + COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ? AND g.date <= ?),0)) DESC`,
    [y0.from, y0.to, y1.from, y1.to, y2.from, y2.to, orgId, y2.from, y0.to,
     y0.from, y0.to, y1.from, y1.to, y2.from, y2.to]);
  const donors = rows.map(r => {
    const c0 = Number(r.y0), c1 = Number(r.y1), c2 = Number(r.y2);
    return {
      id: r.id, name: r.name, email: r.email, assignedTo: r.assigned_to_name,
      y0: c0, y1: c1, y2: c2,
      // YoY change on the two most recent years, the number that matters most.
      changePct: c1 > 0 ? Math.round((c0 - c1) / c1 * 1000) / 10 : (c0 > 0 ? null : 0),
      trend: c0 > c1 ? "up" : c0 < c1 ? "down" : "flat",
    };
  });
  const sum = k => donors.reduce((s, d) => s + d[k], 0);
  const t0 = sum("y0"), t1 = sum("y1"), t2 = sum("y2");
  return {
    yearMode: p.yearMode,
    years: [{ year: p.year - 2, label: label(p.year - 2), total: t2, donors: donors.filter(d => d.y2 > 0).length },
            { year: p.year - 1, label: label(p.year - 1), total: t1, donors: donors.filter(d => d.y1 > 0).length },
            { year: p.year, label: label(p.year), total: t0, donors: donors.filter(d => d.y0 > 0).length }],
    orgGrowthPct: t1 > 0 ? Math.round((t0 - t1) / t1 * 1000) / 10 : null,
    labels: { y0: label(p.year), y1: label(p.year - 1), y2: label(p.year - 2) },
    rows: donors,
  };
}

// Annual report [Core]: the year-end summary. Total giving, gift/donor counts,
// new vs returning, growth vs prior year, donor retention for the year, and
// the by-fund / by-campaign breakdown — one page a board wants at year end.
async function reportAnnual(orgId, p) {
  const cur = reportYearBounds(p.year, p.yearMode);
  const prior = reportYearBounds(p.year - 1, p.yearMode);
  const [totals] = await query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
            COUNT(DISTINCT g.donor_id)::int AS unique_donors,
            COALESCE(AVG(g.amount),0) AS avg_gift
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?`,
    [orgId, cur.from, cur.to]);
  const [priorT] = await query(
    `SELECT COUNT(*)::int AS gift_count, COALESCE(SUM(g.amount),0) AS total,
            COUNT(DISTINCT g.donor_id)::int AS unique_donors
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?`,
    [orgId, prior.from, prior.to]);
  const [split] = await query(
    `WITH period_donors AS (SELECT DISTINCT g.donor_id FROM gifts g JOIN donors d ON d.id = g.donor_id
                            WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?),
          firsts AS (SELECT donor_id, MIN(date) AS fg FROM gifts WHERE org_id = ? GROUP BY donor_id)
     SELECT COUNT(*) FILTER (WHERE f.fg >= ? AND f.fg <= ?)::int AS new_donors, COUNT(*)::int AS period_donors
     FROM period_donors pd JOIN firsts f ON f.donor_id = pd.donor_id`,
    [orgId, cur.from, cur.to, orgId, cur.from, cur.to]);
  // Retention: donors who gave in the prior year and gave again this year.
  const [ret] = await query(
    `WITH prior AS (SELECT DISTINCT g.donor_id FROM gifts g JOIN donors d ON d.id = g.donor_id
                    WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?)
     SELECT (SELECT COUNT(*) FROM prior)::int AS prior_donors,
            (SELECT COUNT(*) FROM prior pr WHERE EXISTS
               (SELECT 1 FROM gifts g WHERE g.org_id=? AND g.donor_id=pr.donor_id AND g.date >= ? AND g.date <= ?))::int AS retained`,
    [orgId, prior.from, prior.to, orgId, cur.from, cur.to]);
  const byFund = await query(
    `SELECT COALESCE(x.name,'No fund') AS name, COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     LEFT JOIN fin_funds x ON x.id = g.fund_id AND x.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
     GROUP BY 1 ORDER BY total DESC`, [orgId, cur.from, cur.to]);
  const byCampaign = await query(
    `SELECT COALESCE(x.name, NULLIF(g.campaign,''), 'No campaign') AS name, COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS gift_count
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     LEFT JOIN campaigns x ON x.id = g.campaign_id AND x.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
     GROUP BY 1 ORDER BY total DESC`, [orgId, cur.from, cur.to]);
  const total = Number(totals.total), priorTotal = Number(priorT.total);
  const grand = arr => arr.reduce((s, r) => s + Number(r.total), 0);
  return {
    year: p.year, yearMode: p.yearMode, label: p.yearMode === "fiscal" ? `FY${p.year}` : String(p.year),
    priorLabel: p.yearMode === "fiscal" ? `FY${p.year - 1}` : String(p.year - 1),
    total, giftCount: totals.gift_count, uniqueDonors: totals.unique_donors,
    avgGift: Math.round(Number(totals.avg_gift) * 100) / 100,
    priorTotal, priorGiftCount: priorT.gift_count, priorUniqueDonors: priorT.unique_donors,
    growthPct: priorTotal > 0 ? Math.round((total - priorTotal) / priorTotal * 1000) / 10 : null,
    newDonors: split.new_donors, returningDonors: split.period_donors - split.new_donors,
    priorDonors: ret.prior_donors, retainedDonors: ret.retained,
    retentionRate: ret.prior_donors > 0 ? Math.round(ret.retained / ret.prior_donors * 1000) / 10 : null,
    byFund: byFund.map(r => ({ name: r.name, total: Number(r.total), giftCount: r.gift_count, pct: total > 0 ? Math.round(Number(r.total) / total * 1000) / 10 : 0 })),
    byCampaign: byCampaign.map(r => ({ name: r.name, total: Number(r.total), giftCount: r.gift_count, pct: total > 0 ? Math.round(Number(r.total) / total * 1000) / 10 : 0 })),
  };
}

// Robust solicitations report [Team]: the marquee oversight artifact. Open
// asks by stage + stage-weighted forecast, asks vs closes by officer over the
// period, and aging prospects (open asks whose donor has stalled in-stage).
async function reportSolicitations(orgId, p) {
  // Open asks grouped by the donor's current pipeline stage.
  const stageRows = await query(
    `SELECT d.stage AS stage, COUNT(*)::int AS cnt, COALESCE(SUM(o.target_amount),0) AS ask
     FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND o.status = 'open' AND d.deleted_at IS NULL
     GROUP BY d.stage`, [orgId]);
  const stageMap = Object.fromEntries(stageRows.map(r => [r.stage, r]));
  let openTotal = 0, weightedTotal = 0;
  const byStage = ALL_PIPELINE_STAGES.map(st => {
    const ask = Number(stageMap[st]?.ask || 0), cnt = stageMap[st]?.cnt || 0;
    const weight = STAGE_WEIGHT[st] ?? 0;
    openTotal += ask; weightedTotal += ask * weight;
    return { stage: st, count: cnt, ask, weight, weighted: Math.round(ask * weight * 100) / 100 };
  });
  // Asks vs closes by officer, over the report period (p.from..p.to).
  const officers = await query("SELECT id, name, portfolio_color FROM users WHERE org_id=? ORDER BY name", [orgId]);
  const openByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='open' GROUP BY officer_id`, [orgId]);
  const madeByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND created_at >= ? AND created_at < (?::date + 1) GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  const wonByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='won' AND closed_at >= ? AND closed_at < (?::date + 1) GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  // Lost asks decided in the window — the OTHER half of the win-rate denominator.
  // Symmetric with won (marking an ask lost stamps closed_at=NOW(), like won).
  const lostByOfficer = await query(
    `SELECT officer_id, COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt
     FROM opportunities WHERE org_id=? AND status='lost' AND closed_at >= ? AND closed_at < (?::date + 1) GROUP BY officer_id`,
    [orgId, p.from, p.to]);
  const idx = rows => Object.fromEntries(rows.map(r => [r.officer_id, r]));
  const op = idx(openByOfficer), md = idx(madeByOfficer), wn = idx(wonByOfficer), ls = idx(lostByOfficer);
  const byOfficer = officers.map(o => {
    const asksMade = md[o.id]?.cnt || 0, giftsClosed = wn[o.id]?.cnt || 0, giftsLost = ls[o.id]?.cnt || 0;
    const decided = giftsClosed + giftsLost;
    return {
      officerId: o.id, name: o.name, color: o.portfolio_color,
      openAsks: op[o.id]?.cnt || 0, openAskAmount: Number(op[o.id]?.amt || 0),
      asksMade, asksMadeAmount: Number(md[o.id]?.amt || 0),
      giftsClosed, giftsClosedAmount: Number(wn[o.id]?.amt || 0),
      lostAsks: giftsLost, lostAskAmount: Number(ls[o.id]?.amt || 0),
      decidedAsks: decided,
      // Win rate = won / (won + lost) — DECIDED asks only. Open asks are NOT
      // losses (an unclosed ask isn't a loss), so they never dilute the rate.
      // null when nothing is decided yet → the UI shows "—"/"No decided asks yet".
      winRate: decided > 0 ? Math.round(giftsClosed / decided * 1000) / 10 : null,
    };
  });
  // Aging prospects: open asks whose donor's most recent move into their
  // current stage is oldest — the stalled solicitations that need a nudge.
  const aging = await query(
    `SELECT d.id, d.name, d.stage, d.assigned_to_name, o.target_amount, o.name AS opp_name,
            (SELECT MAX(m.created_at) FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id AND m.to_stage=d.stage) AS last_move,
            GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(
              (SELECT MAX(m.created_at) FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id AND m.to_stage=d.stage),
              d.updated_at, d.created_at))::int) AS stage_age
     FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND o.status='open' AND d.deleted_at IS NULL
     ORDER BY stage_age DESC LIMIT 25`, [orgId]);
  // Attribution FIX — open PLEDGES alongside open asks: both are
  // committed-but-unpaid forward-looking money (the ask-vs-gift model), so the
  // oversight artifact shows them side by side. Never merged into a raised
  // figure anywhere — a pledge's payments count when they arrive, as gifts.
  const pledgeRow = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(p.amount - COALESCE(pp.paid,0)),0) AS amt
     FROM pledges p
     LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id=? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id=p.id
     WHERE p.org_id=? AND p.status='open'`, [orgId, orgId]);
  return {
    from: p.from, to: p.to,
    forecast: { open: Math.round(openTotal * 100) / 100, weighted: Math.round(weightedTotal * 100) / 100 },
    openPledges: { count: pledgeRow[0]?.cnt || 0, total: Number(pledgeRow[0]?.amt || 0) },
    byStage, byOfficer,
    aging: aging.map(r => ({ id: r.id, name: r.name, stage: r.stage, assignedTo: r.assigned_to_name,
      ask: Number(r.target_amount || 0), oppName: r.opp_name, stageAge: Number(r.stage_age) || 0 })),
  };
}

// CSV with proper quoting + formula-injection guard: a leading = + - or @ in
// a TEXT cell gets a ' prefix so Excel/Sheets treat it as literal text, not
// a formula (numbers pass through untouched — a negative total isn't an
// injection). These exports land in real spreadsheets at real orgs.
function reportCsvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function sendReportCsv(res, filename, headers, rows) {
  const body = [headers, ...rows].map(r => r.map(reportCsvCell).join(",")).join("\r\n") + "\r\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

function reportToCsv(key, data) {
  switch (key) {
    case "giving-summary": {
      const headers = ["Month", "Gifts", "Total", "Unique donors"];
      const rows = data.monthly.map(m => [m.month, m.gifts, m.total, m.donors]);
      rows.push(["TOTAL", data.giftCount, data.total, data.uniqueDonors]);
      return { headers, rows };
    }
    case "by-group":
      return {
        headers: ["Name", "Total", "Gifts", "Unique donors", "% of total"],
        rows: data.rows.map(r => [r.name, r.total, r.giftCount, r.uniqueDonors, r.pct]),
      };
    case "lybunt": case "sybunt":
      return {
        headers: ["Name", "Email", "Assigned to", "Last gift date", "Last gift amount", `Gave ${data.yearMode === "fiscal" ? "FY" + (data.year - 1) : data.year - 1}`, "Lifetime giving"],
        rows: data.rows.map(r => [r.name, r.email, r.assignedTo, r.lastGiftDate, r.lastGiftAmount, r.priorYearTotal, r.lifetimeGiving]),
      };
    case "retention":
      return {
        headers: ["Year", "Prior-year donors", "Retained", "Retention %", "Prior-year dollars", "Retained dollars", "Dollar retention %", "First-year donors", "First-year retained", "First-year retention %"],
        rows: data.rows.map(r => [r.label, r.priorDonors, r.retainedDonors, r.retentionRate, r.priorDollars, r.retainedDollars, r.dollarRetentionRate, r.firstYearDonors, r.firstYearRetained, r.firstYearRetentionRate]),
      };
    case "top-donors":
      return {
        headers: ["Rank", "Name", "Total", "Gifts", "Last gift date"],
        rows: data.rows.map(r => [r.rank, r.name, r.total, r.giftCount, r.lastGiftDate]),
      };
    case "three-year":
      return {
        headers: ["Donor", "Email", "Assigned to", data.labels.y2, data.labels.y1, data.labels.y0, "YoY change %"],
        rows: data.rows.map(r => [r.name, r.email, r.assignedTo, r.y2, r.y1, r.y0, r.changePct === null ? "new" : r.changePct]),
      };
    case "annual": {
      const rows = [
        ["Total giving", data.total], ["Gifts", data.giftCount], ["Unique donors", data.uniqueDonors],
        ["Average gift", data.avgGift], ["New donors", data.newDonors], ["Returning donors", data.returningDonors],
        ["Growth vs prior year %", data.growthPct === null ? "n/a" : data.growthPct],
        ["Donor retention %", data.retentionRate === null ? "n/a" : data.retentionRate],
        ["", ""], ["BY FUND", ""],
        ...data.byFund.map(f => [f.name, f.total]),
        ["", ""], ["BY CAMPAIGN", ""],
        ...data.byCampaign.map(c => [c.name, c.total]),
      ];
      return { headers: ["Metric", "Value"], rows };
    }
    case "solicitations": {
      const rows = [
        ["FORECAST — open asks", data.forecast.open], ["FORECAST — stage-weighted", data.forecast.weighted],
        ["", ""], ["OPEN ASKS BY STAGE", ""],
        ...data.byStage.map(s => [s.stage, `${s.count} asks · ${s.ask}`]),
        ["", ""], ["BY OFFICER (open / made / closed)", ""],
        ...data.byOfficer.map(o => [o.name, `open ${o.openAsks} ($${o.openAskAmount}) · made ${o.asksMade} · closed ${o.giftsClosed} ($${o.giftsClosedAmount})`]),
      ];
      return { headers: ["", ""], rows };
    }
  }
}

const REPORT_HANDLERS = {
  "giving-summary": reportGivingSummary,
  "by-group": reportByGroup,
  "lybunt": (orgId, p) => reportBuntList(orgId, p, "lybunt"),
  "sybunt": (orgId, p) => reportBuntList(orgId, p, "sybunt"),
  "retention": reportRetention,
  "top-donors": reportTopDonors,
  "three-year": reportThreeYear,
  "annual": reportAnnual,
  "solicitations": reportSolicitations,
};
// [Team]-gated reports — the pipeline/solicitation oversight artifacts. A Core
// org gets 403 plan_required (the client renders an upgrade state).
const TEAM_ONLY_REPORTS = new Set(["solicitations"]);

// Reports are read paths — requireAuth only, never checkWriteAccess (a
// read_only org keeps full report access, consistent with GETs/exports
// everywhere else).
app.get("/reports/:key", requireAuth, wrap(async (req, res) => {
  const { key } = req.params;
  if (!REPORT_HANDLERS[key]) return res.status(404).json({ error: "Unknown report" });
  // Team-only reports on a Core org: return a READ-only locked preview built
  // from the org's OWN data (a report is a pure read), flagged `locked:true`
  // so the client dims it behind the LockedFeature glass — a bare 403 card is
  // replaced by a real preview. CSV EXPORT of a locked report is still refused
  // (403) — you can look, but pulling the team artifact out is Team-only.
  let reportLocked = false;
  if (TEAM_ONLY_REPORTS.has(key)) {
    const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
    reportLocked = !orgRows.length || orgPlanTier(orgRows[0]) !== "team";
    if (reportLocked && req.query.format === "csv")
      return res.status(403).json({ error: "plan_required", requiredPlan: "team", message: "The solicitations report is available on the Team plan." });
  }
  let p;
  try { p = parseReportParams(req.query); }
  catch (e) { return res.status(e.status === 400 ? 400 : 500).json({ error: e.message }); }
  const data = await REPORT_HANDLERS[key](req.user.orgId, p);
  if (reportLocked && data && typeof data === "object" && !Array.isArray(data)) data.locked = true;
  if (p.format === "csv") {
    const { headers, rows } = reportToCsv(key, data);
    const suffix = key === "retention" ? p.yearMode
      : key === "top-donors" && p.scope === "lifetime" ? "lifetime"
      : ["lybunt", "sybunt", "annual", "three-year"].includes(key) ? `${p.yearMode === "fiscal" ? "fy" : "cy"}${p.year}`
      : `${p.from}_${p.to}`;
    return sendReportCsv(res, `${key}-${suffix}.csv`, headers, rows);
  }
  res.json(data);
}));

// ══ Development reporting cadence — digests (BUILD-17) ══════════════════════
// The oversight rhythm that runs a development office. Two scheduled emails —
// a weekly "Week in Review" (ED + every team member) and a monthly per-officer
// report — composed from the BUILD-14/15/16 feeds and sent through the SAME
// 5-min tick as scheduled campaigns/dunning (no second scheduler). Idempotent
// per (org, digest_type, period_key, recipient) via digest_sends' unique index:
// a row is RESERVED before sending, so re-ticking within the week never
// double-sends. A double-send is a trust disaster; the reservation is
// non-negotiable, exactly like workflow_runs.

function digestYmd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Monday-based week. offset 0 = the week containing `now`; -1 = the prior
// (most-recently-completed) week. key is stable per Monday.
function weekBounds(offset = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(d); monday.setDate(d.getDate() - dow + offset * 7);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start: digestYmd(monday), end: digestYmd(sunday), key: "wk:" + digestYmd(monday) };
}
function monthBounds(offset = 0, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { start: digestYmd(start), end: digestYmd(end),
    key: `mo:${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}` };
}

// Compose the Week-in-Review sections for a window. officerId != null scopes
// every section to that officer's portfolio (their assigned donors + their
// tasks); org-wide otherwise. today gates the past-due-tasks section.
async function composeWeekInReview(orgId, win, officerId = null) {
  const { start, end } = win;
  const today = digestYmd(new Date());
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
  return {
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
  const row = (a, b) => `<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;padding:5px 0;border-bottom:1px solid #eee7d8;">${a}${b ? `<span style="float:right;color:#0d5c3a;font-weight:700;">${b}</span>` : ""}</div>`;
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

async function sendDigestEmail(org, toEmail, subject, bodyHtml) {
  if (!toEmail) return false;
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml; // internal staff mail — no donor unsubscribe footer
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
      if (error) console.error("[digest] email error:", error.message);
    } catch (e) { console.error("[digest] email threw:", e.message); }
  }
  return true;
}

// Run both digests for one org for the given windows. send=false → compose
// only (preview/dry-run), reserving nothing. Returns what was sent + skipped.
async function runDigestsForOrg(org, { wk, mo, types = ["weekly", "monthly"], send = true }) {
  const tier = orgPlanTier(org);
  const out = { weekly: { sent: [], skipped: [] }, monthly: { sent: [], skipped: [] } };
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

// The tick — runs both digests for every onboarded org for the most-recently-
// COMPLETED week/month. Reuses the existing 5-min scheduler cadence (NOT a
// second scheduler). Idempotency means a digest for a completed period goes out
// exactly once, on the first tick after that period rolls over.
async function processDigests(now = new Date()) {
  try {
    const wk = weekBounds(-1, now), mo = monthBounds(-1, now);
    const orgs = await query("SELECT id, name, plan, subscription_status FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      await runDigestsForOrg(org, { wk, mo }).catch(e => console.error("[digest]", org.id, e.message));
    }
  } catch (e) { console.error("[digest] processDigests:", e.message); }
}
setTimeout(() => processDigests().catch(console.error), 30000);
setInterval(() => processDigests().catch(console.error), 5 * 60 * 1000);

// ── BUILD-36 A3 — the daily due/overdue task reminder ────────────────────────
// One email per user per day (digest_sends idempotency: digest_type
// 'daily_tasks', period_key day:YYYY-MM-DD), listing their OPEN tasks due today
// + overdue, deep-linked. Sends ONLY when non-empty — no tasks, no email, and
// nothing reserved, so if tasks appear later the same morning it still goes.
// Gated to a morning window so it reads as a morning brief, not a 2 AM ping.
// Reuses the existing 5-min tick — NOT a second scheduler.
const DAILY_REMINDER_WINDOW = [6, 12]; // send when the local hour is in [6, 12)
function inDailyReminderWindow(now) { const h = now.getHours(); return h >= DAILY_REMINDER_WINDOW[0] && h < DAILY_REMINDER_WINDOW[1]; }
function localDateKey(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
      ${overdueBlock}${todayBlock}
      <div style="margin-top:16px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">Open your tasks →</a></div>
    </div>`;
}

// Run the daily reminder for one org. send=false → compose only (preview),
// reserving nothing. Non-empty is required to send. Returns sent/skipped.
async function runDailyTaskRemindersForOrg(org, { today, send = true }) {
  const out = { sent: [], skipped: [] };
  const users = await query("SELECT id, name, email FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);
  for (const u of users) {
    const digest = await composeDailyTaskReminder(org.id, u.id, today);
    if (digest.count === 0) { out.skipped.push({ recipientUserId: u.id, reason: "empty" }); continue; }
    const payload = { recipientUserId: u.id, email: u.email, count: digest.count, overdue: digest.overdue.length, dueToday: digest.dueToday.length };
    if (!send) { out.sent.push(payload); continue; }
    if (!(await userWantsEmail(u.id, "daily_tasks"))) { out.skipped.push({ recipientUserId: u.id, reason: "opted_out" }); continue; }
    const rid = await reserveDigest(org.id, "daily_tasks", "day:" + today, u.id, u.email, "user", { count: digest.count, overdue: digest.overdue.length });
    if (!rid) { out.skipped.push({ recipientUserId: u.id, reason: "already_sent" }); continue; }
    const subject = `${digest.count} task${digest.count === 1 ? "" : "s"} need${digest.count === 1 ? "s" : ""} you today — ${displayNameCase(org.name)}`;
    await sendDigestEmail(org, u.email, subject, renderDailyTaskReminderBody(digest, org, u, today));
    out.sent.push(payload);
  }
  return out;
}

async function processDailyTaskReminders(now = new Date(), { force = false } = {}) {
  try {
    if (!force && !inDailyReminderWindow(now)) return;
    const today = localDateKey(now);
    const orgs = await query("SELECT id, name FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      await runDailyTaskRemindersForOrg(org, { today }).catch(e => console.error("[daily-tasks]", org.id, e.message));
    }
  } catch (e) { console.error("[daily-tasks] processDailyTaskReminders:", e.message); }
}
setTimeout(() => processDailyTaskReminders().catch(console.error), 45000);
setInterval(() => processDailyTaskReminders().catch(console.error), 5 * 60 * 1000);

// POST /digests/run-daily (requireAuth + requireAdmin) — drive the daily
// reminder for the caller's org NOW (ops/test hook, same bar as /digests/run).
// {today?, dryRun?} pin the date / preview without sending.
app.post("/digests/run-daily", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const today = (req.body && req.body.today) || localDateKey(new Date());
  const out = await runDailyTaskRemindersForOrg(org, { today, send: !(req.body && req.body.dryRun) });
  res.json({ today, ...out });
}));

// GET /digests/preview — compose (never send) the caller's current digest, for
// the in-app "Week in Review" view. Scope follows the caller's role/plan.
app.get("/digests/preview", requireAuth, wrap(async (req, res) => {
  const type = req.query.type === "monthly" ? "monthly" : "weekly";
  const orgRows = await query("SELECT id, name, plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "Org not found" });
  const tier = orgPlanTier(org);
  const [me] = await query("SELECT id, name, role FROM users WHERE id=?", [req.user.userId]);
  // Preview the most-recently-completed period (what actually gets emailed),
  // matching the tick — offset -1.
  if (type === "monthly") {
    // Core: return the caller's own monthly report as a READ-only locked
    // preview (their own gifts/portfolio — a pure read), flagged locked so the
    // client dims it behind LockedFeature instead of a bare 403 card.
    const mo = monthBounds(-1);
    const report = await composeOfficerMonthly(org.id, mo, { id: me.id, name: me.name });
    return res.json({ type, window: mo, report, locked: tier !== "team" });
  }
  const wk = weekBounds(-1);
  const isOfficerScope = tier === "team" && me.role !== "admin";
  const sections = await composeWeekInReview(org.id, wk, isOfficerScope ? me.id : null);
  const teamRollup = isOfficerScope ? (await composeWeekInReview(org.id, wk, null)).totals : null;
  res.json({ type, window: wk, scope: isOfficerScope ? "officer" : "org", tier, sections, teamRollup });
}));

// POST /digests/run — actually reserve + send the caller's org digests now
// (requireAuth + requireAdmin). Drives the same path the tick uses, for ops
// and for the committed test suite. Optional window overrides pin the period
// (so tests can seed a specific week/month); dryRun composes without sending.
app.post("/digests/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgRows = await query("SELECT id, name, plan, subscription_status FROM orgs WHERE id=?", [req.user.orgId]);
  const org = orgRows[0];
  if (!org) return res.status(404).json({ error: "Org not found" });
  const { weekStart, monthStart, type, dryRun } = req.body || {};
  const types = type === "weekly" || type === "monthly" ? [type] : ["weekly", "monthly"];
  // Build windows: explicit override (a Monday / month-start date) or the
  // most-recently-completed period.
  const wk = weekStart ? weekBounds(0, new Date(weekStart + "T12:00:00")) : weekBounds(-1);
  const mo = monthStart ? monthBounds(0, new Date(monthStart + "T12:00:00")) : monthBounds(-1);
  const result = await runDigestsForOrg(org, { wk, mo, types, send: !dryRun });
  res.json({ windows: { weekly: wk, monthly: mo }, ...result });
}));

// ── Sequence Engine ─────────────────────────────────────────────────────────
async function sendOnboardingSequence(orgId, userId, userName, userEmail) {
  console.log("[onboarding] creating sequence for", orgId, userId, userEmail);
  try {
    const seqId = "seq_" + uuid().slice(0, 8);
    await run(
      "INSERT INTO sequences (id, org_id, name, trigger, status) VALUES (?, ?, 'Onboarding', 'onboarding', 'active')",
      [seqId, orgId]
    );
    const steps = [
      {
        delay_days: 0,
        subject: "You just made a great decision for your mission",
        body: `Hi {{first_name}},\n\nWelcome to Steward. I'm Jonathan — I built this.\n\nI built Steward because a nonprofit I cared about was managing their entire donor relationships in Google Sheets. They were spending hours every week on things that should take minutes — tracking who gave what, remembering who to follow up with, pulling together board reports.\n\nSound familiar?\n\nOver the next few days I'm going to show you exactly how to get the most out of Steward. But first — one question:\n\nWhat's the #1 thing eating your time in fundraising right now?\n\nJust reply to this email. I read every response personally.\n\n— Jonathan\nFounder, Steward`,
      },
      {
        delay_days: 2,
        subject: "The spreadsheet problem (and how to fix it in 10 minutes)",
        body: `Hi {{first_name}},\n\nMost development officers I talk to manage donors in one of three ways:\n\n1. Google Sheets (the classic)\n2. A CRM they barely use because it's too complicated\n3. Their own memory (terrifying)\n\nAll three have the same problem: they don't tell you what to do next.\n\nSteward does.\n\nToday's task: import your donor list.\n\nIf you have a spreadsheet with donor names, emails, and giving history — you can import it in about 10 minutes. Steward will automatically score each donor, assign them a stage, and tell you who to call first.\n\nHere's how:\n1. Go to Donors → Import\n2. Upload your CSV\n3. Map your columns (takes 2 minutes)\n4. Done — your whole donor list is in Steward\n\nTomorrow I'll show you something that development officers tell me saves them 2 hours a week.\n\n— Jonathan`,
      },
      {
        delay_days: 4,
        subject: `What if your CRM texted you "call Sarah today"?`,
        body: `Hi {{first_name}},\n\nEvery morning when you open Steward, you get a daily briefing.\n\nIt reads your donor data overnight and tells you:\n- Who you haven't contacted in too long\n- Who just gave and needs a thank you\n- Which grant deadline is coming up\n- What your one priority action is for the day\n\nIt's like having a chief of staff who never sleeps and never forgets anything.\n\nTo generate your first briefing:\n1. Go to Dashboard\n2. Hit "Generate briefing"\n3. Read it. Do the first thing it says.\n\n— Jonathan\n\nP.S. — If you haven't imported your donors yet, do that first. The briefing gets dramatically smarter when it has real data to work with.`,
      },
      {
        delay_days: 7,
        subject: "Your board report used to take how long?",
        body: `Hi {{first_name}},\n\nI asked a development director at an arts organization how long it took her to put together a quarterly board report.\n\n"Two days," she said. "Sometimes three."\n\nTwo days. Every quarter. Just compiling data that already existed in five different places.\n\nSteward generates your board report in about 45 seconds.\n\nIt pulls your YTD giving, grant status, top donors, pipeline summary, and key metrics — formats it into a PDF — and it's ready to email to your board.\n\nTry it:\n1. Go to Board tab\n2. Hit "Generate Board Report"\n3. Download the PDF\n\nThat's time you could spend actually talking to donors.\n\n— Jonathan`,
      },
      {
        delay_days: 10,
        subject: "The donors you're about to lose (and how to keep them)",
        body: `Hi {{first_name}},\n\nHere's a number most development officers don't know off the top of their head:\n\nTheir donor retention rate.\n\nThe nonprofit sector average is about ${SECTOR_AVG_RETENTION_RATE}%. That means for every 100 donors you had last year, ${100 - SECTOR_AVG_RETENTION_RATE} didn't give again.\n\nSteward tracks this automatically. It flags donors who are at risk of lapsing and puts them in a Re-engage queue so nothing falls through the cracks.\n\nGo to Donors → Re-engage and see who's there.\n\nIf you've set up email sequences, Steward will also automatically reach out to lapsed donors on your behalf — a warm, personal email that goes out without you having to remember to send it.\n\nRetaining one major donor is worth more than acquiring ten new ones. This is where the money is.\n\n— Jonathan`,
      },
      {
        delay_days: 18,
        subject: "Quick question",
        body: `Hi {{first_name}},\n\nYou've been using Steward for a couple weeks now.\n\nQuick question — what's one thing you wish it did that it doesn't?\n\nI'm building this in real time and I read every reply. The features on the roadmap right now came directly from conversations with users like you.\n\nWhat would make Steward a no-brainer for your org?\n\n— Jonathan`,
      },
      {
        delay_days: 28,
        subject: "A month in with Steward",
        body: `Hi {{first_name}},\n\nYou've been using Steward for about a month now.\n\nHere's the deal on cost, plainly: Steward is free for you through December 31, 2026. After that, plans are $149/month — no platform fee on your donations, no donor tips, and your gifts always settle in your own Stripe account.\n\nhttps://stewardapp.dev/pricing\n\nIf Steward has saved you time, helped you stay on top of your donors, or made one thing easier — I'd love for you to keep using it. If the timing isn't right or you have questions, just reply to this email. I read every one.\n\nEither way — thank you for trying Steward. Building software for people doing meaningful work is the best job I've ever had.\n\n— Jonathan\nFounder, Steward\nstewardapp.dev`,
      },
    ];
    for (let i = 0; i < steps.length; i++) {
      const stepId = "ss_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
        [stepId, seqId, i, steps[i].delay_days, steps[i].subject, steps[i].body]
      );
    }
    const enrId = "se_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at)
       VALUES (?, ?, ?, ?, 0, 'active', NOW())
       ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
      [enrId, seqId, orgId, userId]
    );
    // Send email 1 immediately — don't wait for the hourly engine tick
    const firstName = userName ? userName.trim().split(/\s+/)[0] : "";
    const applyTokens = str => (str || "")
      .replace(/{{first_name}}/g, firstName)
      .replace(/{{user_name}}/g, userName)
      .replace(/{{donor_name}}/g, userName);
    const step0 = steps[0];
    const subject0 = applyTokens(step0.subject);
    const body0 = applyTokens(step0.body);
    const bodyHtml0 = `<p>${body0.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>` + await unsubscribeEmailFooterHtml(userEmail, orgId, "sequence");
    const founderEmail = process.env.FOUNDER_EMAIL || "noreply@stewardapp.dev";
    const suppressReason0 = await getSuppressionReason(userEmail, orgId);
    if (suppressReason0) {
      console.log(`[onboarding] skipping suppressed address ${userEmail} (${suppressReason0})`);
    } else if (process.env.RESEND_API_KEY) {
      try {
        const { error: sendErr } = await resend.emails.send({
          from: founderEmail, to: userEmail, subject: subject0, html: bodyHtml0, reply_to: founderEmail,
          headers: unsubscribeHeaders(userEmail, orgId, "sequence"),
        });
        if (sendErr) console.error("[onboarding] email 1 send error:", sendErr.message);
        else console.log("[onboarding] email 1 sent to", userEmail);
      } catch (e) { console.error("[onboarding] email 1 resend error:", e.message); }
    }
    // Advance enrollment past step 0 — engine picks up from step 1 (delay_days: 2)
    await run(
      `UPDATE sequence_enrollments SET current_step = 1, next_send_at = NOW() + INTERVAL '2 days' WHERE id = ?`,
      [enrId]
    );
    console.log(`[onboarding] sequence created for org ${orgId}, user ${userId} (${userEmail})`);
  } catch (e) {
    console.error("[onboarding] sendOnboardingSequence error:", e.message);
  }
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
        const suppressReason = await getSuppressionReason(recipient.email, enr.org_id);
        if (suppressReason) {
          console.log(`[seq] skipping suppressed recipient ${recipient.email} (${suppressReason}) — enrollment ${enr.id}`);
          await run(
            `UPDATE sequence_enrollments SET status=?, completed_at=NOW() WHERE id=?`,
            [suppressReason === "unsubscribed" ? "unsubscribed" : "bounced", enr.id]
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
        const smtpFrom = enr.seq_trigger === "onboarding"
          ? founderEmail
          : (process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev");
        if (process.env.RESEND_API_KEY && smtpFrom) {
          try {
            const sendOpts = {
              from: smtpFrom, to: recipient.email, subject, html: bodyHtml,
              headers: unsubscribeHeaders(recipient.email, enr.org_id, "sequence"),
            };
            if (enr.seq_trigger === "onboarding") sendOpts.reply_to = founderEmail;
            const { error: sendErr } = await resend.emails.send(sendOpts);
            if (sendErr) console.error("[seq] send error:", sendErr.message);
          } catch (e) { console.error("[seq] resend error:", e.message); }
        }
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
     WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email != '' AND first_gift_date IS NOT NULL`,
    [orgId]
  );
  const today = new Date();
  for (const d of anniversaryDonors) {
    const first = new Date(d.first_gift_date);
    if (isNaN(first.getTime())) continue;
    const dayDiff = Math.abs(today.getDate() - first.getDate());
    const inWindow = dayDiff <= 3 || dayDiff >= 27; // loose +/-3 day window, tolerates month-length wraparound
    const monthsSince = (today.getFullYear() - first.getFullYear()) * 12 + (today.getMonth() - first.getMonth());
    if (monthsSince === 6 && inWindow) {
      candidates.push({ donorId: d.id, milestoneKey: "anniversary_6mo", milestoneType: "anniversary", label: "6-month" });
      continue;
    }
    const yearsSince = today.getFullYear() - first.getFullYear();
    if (yearsSince >= 1 && today.getMonth() === first.getMonth() && inWindow) {
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
     FROM donors
     WHERE org_id = ? AND deleted_at IS NULL
       AND stage NOT IN ('prospect', 'lapsed')
       AND email IS NOT NULL AND email != ''
       AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '300 days'
       AND total_giving >= 5000`,
    [orgId]
  );
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
      "INSERT INTO sequences (id, org_id, name, trigger, status) VALUES (?,?,?,?,'active')",
      [seqId, o.id, "At-Risk Re-Engagement", "at_risk"]
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
      "INSERT INTO sequences (id, org_id, name, trigger, status) VALUES (?,?,?,?,'active')",
      [seqId, o.org_id, "Milestone & Anniversary Emails", "milestone"]
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

// One-page printable/mailable "Impact Summary" for a single donor — cumulative
// giving, milestones reached, and org-configured impact translations. Reuses
// the pdfkit pattern from POST /reports/board (same require, buffer-to-Promise
// approach, page-footer loop) rather than a new rendering system.
app.get("/donors/:id/impact-summary/pdf", requireAuth, wrap(async (req, res) => {
  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
  } catch (e) {
    return res.status(500).json({ error: "pdfkit module missing: " + e.message });
  }

  const { orgId } = req.user;
  const [donor] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });
  const [org] = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);

  const totalGiving = Number(donor.total_giving) || 0;
  const giftCount = Number(donor.gift_count) || 0;
  const now = new Date();

  const thresholdsReached = MILESTONE_THRESHOLDS.filter(t => totalGiving >= t).sort((a, b) => a - b);

  let yearsGiving = null;
  let firstGiftLabel = null;
  if (donor.first_gift_date) {
    const first = new Date(donor.first_gift_date);
    if (!isNaN(first.getTime())) {
      yearsGiving = now.getFullYear() - first.getFullYear() - ((now.getMonth() < first.getMonth() || (now.getMonth() === first.getMonth() && now.getDate() < first.getDate())) ? 1 : 0);
      firstGiftLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }

  const metricRows = await query(
    "SELECT * FROM impact_metrics WHERE org_id = ? AND active = true AND dollar_threshold <= ? ORDER BY dollar_threshold ASC",
    [orgId, totalGiving]
  );
  const impactLines = metricRows.map(m => {
    const n = Math.max(1, Math.floor(totalGiving / Number(m.dollar_threshold)));
    return String(m.outcome_template || "")
      .replace(/\{amount\}/g, totalGiving.toLocaleString())
      .replace(/\{n\}/g, n);
  });

  const recentGifts = await query(
    "SELECT amount, date, campaign FROM gifts WHERE donor_id = ? AND org_id = ? ORDER BY date DESC LIMIT 5",
    [donor.id, orgId]
  );

  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  const pdfBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#1a6b4a";
    const INK   = "#1a1a1a";
    const INK3  = "#6b7280";
    const BG    = "#f5f5f0";
    const PW    = doc.page.width;
    const fmtD  = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const genDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    doc.rect(0, 0, PW, 96).fill(GREEN);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text("I M P A C T   S U M M A R Y", 50, 22);
    doc.font("Helvetica-Bold").fontSize(24).fillColor("#fff").text(donor.name || "Valued Donor", 50, 38);
    doc.font("Helvetica").fontSize(10).fillColor("#d1fae5").text(org.name, 50, 70);

    let y = 128;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Giving Summary", 50, y); y += 20;
    const boxes = [
      ["Total Given", fmtD(totalGiving)],
      ["Gifts Given", String(giftCount)],
      ["Donor Since", firstGiftLabel || "—"],
      ["Years Giving", yearsGiving != null ? String(Math.max(yearsGiving, 0)) : "—"],
    ];
    const bw = (PW - 100) / boxes.length;
    boxes.forEach(([label, value], i) => {
      const x = 50 + i * bw;
      doc.rect(x, y, bw - 8, 56).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 10, y + 10, { width: bw - 26 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(GREEN).text(value, x + 10, y + 26, { width: bw - 26 });
    });
    y += 76;

    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Milestones Reached", 50, y); y += 18;
    const milestoneLabels = [
      ...thresholdsReached.map(t => `Crossed $${t.toLocaleString()} in lifetime giving`),
      ...(yearsGiving != null && yearsGiving >= 1 ? [`${yearsGiving} year${yearsGiving === 1 ? "" : "s"} of continuous giving`] : []),
    ];
    if (milestoneLabels.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(INK3).text("No milestones reached yet.", 50, y); y = doc.y + 10;
    } else {
      milestoneLabels.forEach(label => {
        doc.font("Helvetica").fontSize(10).fillColor(INK).text("•  " + label, 50, y, { width: PW - 100 });
        y = doc.y + 4;
      });
      y += 8;
    }

    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Your Impact", 50, y); y += 18;
    if (impactLines.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(INK3).text("Impact translations will appear here once configured for this organization.", 50, y, { width: PW - 100 }); y = doc.y + 10;
    } else {
      impactLines.forEach(line => {
        doc.font("Helvetica").fontSize(10).fillColor(INK).text("•  " + line, 50, y, { width: PW - 100, lineGap: 2 });
        y = doc.y + 6;
      });
      y += 8;
    }

    if (recentGifts.length > 0) {
      doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Recent Gifts", 50, y); y += 18;
      recentGifts.forEach((g, i) => {
        const d = g.date ? new Date(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
        doc.rect(50, y, PW - 100, 19).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(d, 58, y + 5, { width: 90 });
        doc.fillColor(INK3).text(g.campaign || "General", 155, y + 5, { width: 250 });
        doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(g.amount), PW - 150, y + 5, { width: 100, align: "right" });
        y += 19;
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
        .text(`${org.name}  ·  Impact Summary  ·  Generated ${genDate}`, 50, doc.page.height - 28, { width: PW - 130, height: 20, align: "left" })
        .text(`${i - range.start + 1} / ${range.count}`, PW - 80, doc.page.height - 28, { width: 30, height: 20, align: "right" });
    }

    doc.end();
  });

  const safeDonor = (donor.name || "donor").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeDonor}-impact-summary.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));

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
          `SELECT id FROM donors WHERE org_id = ? AND stage = 'lapsed' AND deleted_at IS NULL AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '90 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "lapsed_180") {
        donors = await query(
          `SELECT id FROM donors WHERE org_id = ? AND stage = 'lapsed' AND deleted_at IS NULL AND last_gift_date IS NOT NULL AND last_gift_date::date < NOW() - INTERVAL '180 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "new_donor") {
        donors = await query(
          `SELECT id FROM donors WHERE org_id = ? AND gift_count = 1 AND deleted_at IS NULL AND last_gift_date IS NOT NULL AND last_gift_date::date > NOW() - INTERVAL '7 days'`,
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

// ── Sequence routes ─────────────────────────────────────────────────────────
app.post("/sequences/process", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processSequences();
  await autoEnroll();
  res.json({ success: true });
}));

app.get("/sequences", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT s.*,
     (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) AS step_count,
     (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') AS active_enrollments
     FROM sequences s
     WHERE s.org_id = ?
     ORDER BY s.created_at DESC`,
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/sequences", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, trigger, triggerStage, steps = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const id = "seq_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO sequences (id, org_id, name, trigger, trigger_stage) VALUES (?, ?, ?, ?, ?)",
    [id, req.user.orgId, name, trigger || "manual", triggerStage || null]
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
      ["ss_" + uuid().slice(0, 8), id, i + 1, parseInt(s.delayDays || 0, 10), s.subject || "", s.body || ""]
    );
  }
  const created = await query("SELECT * FROM sequences WHERE id = ?", [id]);
  res.status(201).json(created[0]);
}));

app.get("/sequences/:id/steps", requireAuth, wrap(async (req, res) => {
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Not found" });
  const steps = await query("SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC", [req.params.id]);
  res.json(steps);
}));

app.get("/sequences/:id/enrollments", requireAuth, wrap(async (req, res) => {
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT se.*, d.name AS donor_name, d.email AS donor_email,
     (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = se.sequence_id) AS total_steps
     FROM sequence_enrollments se
     JOIN donors d ON se.donor_id = d.id AND d.org_id = ?
     WHERE se.sequence_id = ? AND se.org_id = ?
     ORDER BY se.enrolled_at DESC`,
    [req.user.orgId, req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

// Enrolling a donor in a sequence from the profile is part of the Team
// portfolio/officer layer (donor-profile Core/Team split FIX). Viewing/CRUD of
// sequences in Communications is unaffected; only the per-donor enroll is gated.
app.post("/sequences/:id/enroll", requireAuth, requirePlan("team"), wrap(async (req, res) => {
  const { donorId } = req.body;
  if (!donorId) return res.status(400).json({ error: "donorId required" });
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Sequence not found" });
  const donorCheck = await query("SELECT id FROM donors WHERE id = ? AND org_id = ?", [donorId, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const existing = await query(
    "SELECT id, status FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
    [req.params.id, donorId]
  );
  if (existing.length && existing[0].status === "active") return res.status(409).json({ error: "Already enrolled" });
  const steps = await query(
    "SELECT delay_days FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1",
    [req.params.id]
  );
  const firstDelay = parseInt(steps[0]?.delay_days || 0, 10);
  if (existing.length) {
    await run(
      `UPDATE sequence_enrollments SET status='active', current_step=0, enrolled_at=NOW(), completed_at=NULL, next_send_at=NOW() + INTERVAL '${firstDelay} days' WHERE id=?`,
      [existing[0].id]
    );
  } else {
    const enrId = "se_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at)
       VALUES (?, ?, ?, ?, 0, 'active', NOW() + INTERVAL '${firstDelay} days')`,
      [enrId, req.params.id, req.user.orgId, donorId]
    );
  }
  res.json({ success: true });
}));

app.post("/sequences/:id/unenroll", requireAuth, wrap(async (req, res) => {
  const { donorId } = req.body;
  await run(
    "UPDATE sequence_enrollments SET status='unsubscribed' WHERE sequence_id=? AND donor_id=? AND org_id=?",
    [req.params.id, donorId, req.user.orgId]
  );
  res.json({ success: true });
}));

app.put("/sequences/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { name, trigger, triggerStage, status, steps } = req.body;
  const existing = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run(
    "UPDATE sequences SET name=?, trigger=?, trigger_stage=?, status=? WHERE id=? AND org_id=?",
    [name, trigger || "manual", triggerStage || null, status || "active", req.params.id, req.user.orgId]
  );
  if (Array.isArray(steps)) {
    await run("DELETE FROM sequence_steps WHERE sequence_id=?", [req.params.id]);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await run(
        "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
        ["ss_" + uuid().slice(0, 8), req.params.id, i + 1, parseInt(s.delayDays || 0, 10), s.subject || "", s.body || ""]
      );
    }
  }
  const updated = await query("SELECT * FROM sequences WHERE id = ?", [req.params.id]);
  res.json(updated[0]);
}));

app.patch("/sequences/:id/status", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { status } = req.body;
  if (!["active", "paused"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const affected = await run(
    "UPDATE sequences SET status=? WHERE id=? AND org_id=?",
    [status, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
}));

app.delete("/sequences/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const existing = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM sequence_enrollments WHERE sequence_id=?", [req.params.id]);
  await run("DELETE FROM sequences WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Impact metrics (org-configured milestone/anniversary email content) ────
app.get("/impact-metrics", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM impact_metrics WHERE org_id=? ORDER BY dollar_threshold ASC", [req.user.orgId]);
  res.json(rows);
}));

app.post("/impact-metrics", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, dollarThreshold, outcomeTemplate } = req.body;
  if (!name || !dollarThreshold || !outcomeTemplate) return res.status(400).json({ error: "name, dollarThreshold, and outcomeTemplate required" });
  const id = "im_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO impact_metrics (id,org_id,name,dollar_threshold,outcome_template) VALUES (?,?,?,?,?)",
    [id, req.user.orgId, name, parseFloat(dollarThreshold), outcomeTemplate]
  );
  const rows = await query("SELECT * FROM impact_metrics WHERE id=?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/impact-metrics/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, dollarThreshold, outcomeTemplate, active } = req.body;
  const affected = await run(
    "UPDATE impact_metrics SET name=?, dollar_threshold=?, outcome_template=?, active=? WHERE id=? AND org_id=?",
    [name, parseFloat(dollarThreshold), outcomeTemplate, active !== false, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found" });
  const rows = await query("SELECT * FROM impact_metrics WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/impact-metrics/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM impact_metrics WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

// ── Milestone drafts (AI-drafted, staff-reviewed before sending — see
// processSequences()'s 'milestone' branch for why this isn't auto-sent) ────
app.get("/milestone-drafts", requireAuth, wrap(async (req, res) => {
  const status = req.query.status || "pending_review";
  const rows = await query(
    `SELECT md.*, d.name AS donor_name, d.email AS donor_email, d.total_giving AS donor_total_giving
     FROM milestone_drafts md
     JOIN donors d ON d.id = md.donor_id
     WHERE md.org_id = ? AND md.status = ?
     ORDER BY md.created_at DESC`,
    [req.user.orgId, status]
  );
  res.json(rows);
}));

app.put("/milestone-drafts/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { subject, body } = req.body;
  if (!subject || !body) return res.status(400).json({ error: "subject and body required" });
  const affected = await run(
    "UPDATE milestone_drafts SET subject=?, body=? WHERE id=? AND org_id=? AND status='pending_review'",
    [subject, body, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already sent" });
  const rows = await query("SELECT * FROM milestone_drafts WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.post("/milestone-drafts/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const affected = await run(
    "UPDATE milestone_drafts SET status='dismissed' WHERE id=? AND org_id=? AND status='pending_review'",
    [req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already sent" });
  res.json({ success: true });
}));

app.post("/milestone-drafts/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const drafts = await query(
    "SELECT * FROM milestone_drafts WHERE id=? AND org_id=? AND status='pending_review'",
    [req.params.id, req.user.orgId]
  );
  if (!drafts.length) return res.status(404).json({ error: "Not found or already sent" });
  const draft = drafts[0];

  const donorRows = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [draft.donor_id, req.user.orgId]);
  const donor = donorRows[0];
  if (!donor || !donor.email) return res.status(400).json({ error: "Donor has no email on file" });

  const suppressReason = await getSuppressionReason(donor.email, req.user.orgId);
  if (suppressReason) return res.status(400).json({ error: `Cannot send — this donor is suppressed (${suppressReason})` });

  const smtpFrom = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    const bodyHtml = `<p>${draft.body.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
      + await unsubscribeEmailFooterHtml(donor.email, req.user.orgId, "sequence");
    try {
      const { error: sendErr } = await resend.emails.send({
        from: smtpFrom, to: donor.email, subject: draft.subject, html: bodyHtml,
        headers: unsubscribeHeaders(donor.email, req.user.orgId, "sequence"),
      });
      if (sendErr) return res.status(502).json({ error: `Send failed: ${sendErr.message}` });
    } catch (e) {
      return res.status(502).json({ error: `Send failed: ${e.message}` });
    }
  }

  await run(
    "UPDATE milestone_drafts SET status='sent', sent_at=NOW(), reviewed_by=? WHERE id=?",
    [req.user.userId, draft.id]
  );
  const today = new Date().toISOString().slice(0, 10);
  await run(
    "INSERT INTO interactions (id, org_id, donor_id, type, note, date) VALUES (?, ?, ?, 'email', ?, ?)",
    ["i_" + uuid().slice(0, 8), req.user.orgId, draft.donor_id, `Milestone email: ${draft.subject}`, today]
  ).catch(() => {});

  res.json({ success: true });
}));

// ── Personal-note reminders (non-AI-drafted sibling of milestone_drafts) ───
app.get("/note-reminders", requireAuth, wrap(async (req, res) => {
  const status = req.query.status || "pending";
  const rows = await query(
    `SELECT nr.*, d.name AS donor_name, d.email AS donor_email, d.total_giving AS donor_total_giving
     FROM note_reminders nr
     JOIN donors d ON d.id = nr.donor_id
     WHERE nr.org_id = ? AND nr.status = ?
     ORDER BY nr.created_at DESC`,
    [req.user.orgId, status]
  );
  res.json(rows.map(r => ({ ...r, talking_points: typeof r.talking_points === "string" ? JSON.parse(r.talking_points) : r.talking_points })));
}));

// Marks the reminder sent and logs a stewardship interaction confirming a
// personal note went out — never generates or stores any note content.
app.post("/note-reminders/:id/send", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM note_reminders WHERE id=? AND org_id=? AND status='pending'",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found or already handled" });
  const reminder = rows[0];
  const points = typeof reminder.talking_points === "string" ? JSON.parse(reminder.talking_points) : reminder.talking_points;

  await run(
    "UPDATE note_reminders SET status='sent', sent_at=NOW(), sent_by=? WHERE id=?",
    [req.user.userId, reminder.id]
  );
  const today = new Date().toISOString().slice(0, 10);
  await run(
    "INSERT INTO interactions (id, org_id, donor_id, type, note, date, metadata) VALUES (?, ?, ?, 'stewardship', ?, ?, ?)",
    ["i_" + uuid().slice(0, 8), req.user.orgId, reminder.donor_id, "Personal note sent", today,
     JSON.stringify({ stewardship_type: "personal_note", detail: (points || []).join(" · ") })]
  ).catch(() => {});

  res.json({ success: true });
}));

app.post("/note-reminders/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const affected = await run(
    "UPDATE note_reminders SET status='dismissed' WHERE id=? AND org_id=? AND status='pending'",
    [req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already handled" });
  res.json({ success: true });
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
  if (!donorId || !audioBase64) return res.status(400).json({ error: "donorId and audioBase64 required" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Voice transcription is not configured (missing OPENAI_API_KEY)." });

  const donorRows = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });

  let transcript;
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const ext = (mimeType || "").includes("mp4") ? "mp4" : (mimeType || "").includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: mimeType || "audio/webm" }), `memo.${ext}`);
    form.append("model", "whisper-1");
    const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!whisperResp.ok) {
      const errText = await whisperResp.text();
      console.error("[voice-memo] Whisper error:", whisperResp.status, errText);
      return res.status(502).json({ error: "Transcription failed — please try again." });
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
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: `Extract from a voice memo a nonprofit development officer just recorded about a donor. Return ONLY valid JSON: {"personalDetail":"..." or null,"suggestedAction":"..." or null} — no markdown, no explanation. personalDetail: one short, specific, worth-remembering fact about the donor (family, interests, preferences, life event) mentioned in the memo — null if nothing like that was mentioned. suggestedAction: one short, concrete next step implied by the memo (e.g. "Send the gala invite", "Follow up after their trip in March") — null if none is implied.`,
      messages: [{ role: "user", content: `Donor: ${donorRows[0].name}\nTranscript: ${transcript}` }],
    });
    const text = msg.content[0].text.trim();
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

  const today = new Date().toISOString().slice(0, 10);
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
      "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id) VALUES (?,?,?,?,?,?,0,?)",
      [taskId, req.user.orgId, actionText.trim(), due.toISOString().slice(0, 10), "medium", "donor", donorId]
    );
  }

  res.json({ success: true, taskId });
}));

// ── Custom Fields ───────────────────────────────────────────────────────────
app.get("/custom-fields", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM custom_fields WHERE org_id=? ORDER BY field_order ASC, created_at ASC",
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/custom-fields", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { label, fieldType, options, required } = req.body;
  if (!label || !fieldType) return res.status(400).json({ error: "label and fieldType required" });
  const maxOrder = await query(
    "SELECT COALESCE(MAX(field_order),0) AS mo FROM custom_fields WHERE org_id=?",
    [req.user.orgId]
  );
  const nextOrder = (maxOrder[0]?.mo || 0) + 1;
  const id = "cf_" + Date.now();
  await run(
    "INSERT INTO custom_fields (id,org_id,label,field_type,options,required,field_order) VALUES (?,?,?,?,?,?,?)",
    [id, req.user.orgId, label, fieldType, JSON.stringify(options || []), required ? 1 : 0, nextOrder]
  );
  const [field] = await query("SELECT * FROM custom_fields WHERE id=?", [id]);
  res.json(field);
}));

// reorder MUST be before /:id
app.put("/custom-fields/reorder", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { ids } = req.body; // ordered array of field ids
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  for (let i = 0; i < ids.length; i++) {
    await run(
      "UPDATE custom_fields SET field_order=? WHERE id=? AND org_id=?",
      [i, ids[i], req.user.orgId]
    );
  }
  res.json({ ok: true });
}));

app.put("/custom-fields/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { label, fieldType, options, required, showInDirectory } = req.body;
  await run(
    "UPDATE custom_fields SET label=?,field_type=?,options=?,required=?,show_in_directory=? WHERE id=? AND org_id=?",
    [label, fieldType, JSON.stringify(options || []), required ? 1 : 0, showInDirectory ? true : false, req.params.id, req.user.orgId]
  );
  const [field] = await query("SELECT * FROM custom_fields WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  res.json({ ...field, options: typeof field.options === "string" ? JSON.parse(field.options||"[]") : field.options });
}));

app.delete("/custom-fields/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM custom_field_values WHERE field_id=? AND org_id=?", [req.params.id, req.user.orgId]);
  await run("DELETE FROM custom_fields WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.get("/donors/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT cf.id AS field_id, cf.label, cf.field_type, cf.options, cf.required, cf.field_order,
            cfv.value
     FROM custom_fields cf
     LEFT JOIN custom_field_values cfv ON cfv.field_id=cf.id AND cfv.donor_id=? AND cfv.org_id=?
     WHERE cf.org_id=?
     ORDER BY cf.field_order ASC, cf.created_at ASC`,
    [req.params.id, req.user.orgId, req.user.orgId]
  );
  res.json(rows.map(r => ({
    fieldId: r.field_id,
    label: r.label,
    fieldType: r.field_type,
    options: r.options || [],
    required: r.required,
    fieldOrder: r.field_order,
    value: r.value || null,
  })));
}));

app.post("/donors/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  const { fieldId, value } = req.body;
  if (!fieldId) return res.status(400).json({ error: "fieldId required" });
  const donorCheck = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const valId = "cfv_" + Date.now();
  await run(
    `INSERT INTO custom_field_values (id,org_id,donor_id,field_id,value,updated_at)
     VALUES (?,?,?,?,?,NOW())
     ON CONFLICT (donor_id,field_id) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [valId, req.user.orgId, req.params.id, fieldId, value]
  );
  res.json({ ok: true });
}));

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

        await sendDunningEmail(org, { name: rs.donor_name, email: rs.donor_email }, rs);
        await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_sent", null, { step: rs.dunning_step });

        const nextStep = rs.dunning_step + 1;
        const nextDelayDays = DUNNING_SCHEDULE_DAYS[nextStep];
        const nextDunningAt = nextDelayDays != null
          ? new Date(new Date(rs.first_failed_at).getTime() + nextDelayDays * 86400000).toISOString()
          : null; // exhausted the cadence — stop sending, leave it for Stripe's own retries/eventual cancellation
        await run(
          `UPDATE recurring_subscriptions SET status='recovering', dunning_step=?, next_dunning_at=?, updated_at=NOW() WHERE id=?`,
          [nextStep, nextDunningAt, rs.id]
        );
      } catch (e) { console.error("[dunning] subscription", rs.id, e.message); }
    }
  } catch (e) { console.error("[dunning] processDunning:", e.message); }
}
setTimeout(() => processDunning().catch(console.error), 5000);
setInterval(() => processDunning().catch(console.error), 60 * 60 * 1000);

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
      { type: "create_task", title: "Follow up: recurring gift failed for {donor}", priority: "high", dueDays: 2 },
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

// Send a branded one-off workflow email (thank-you / re-engagement). Reuses the
// BUILD-13 branded header + the CAN-SPAM footer, and honors suppression. No-ops
// cleanly without RESEND_API_KEY (local tests) — the run is still logged.
async function sendWorkflowEmail(org, donor, subject, bodyHtml) {
  if (!donor?.email) return false;
  if (await getSuppressionReason(donor.email, org.id)) return false;
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({ from, to: donor.email, subject, html, headers: unsubscribeHeaders(donor.email, org.id, "campaign") });
      if (error) console.error("[workflow] email error:", error.message);
    } catch (e) { console.error("[workflow] email threw:", e.message); }
  }
  return true;
}

// Internal staff notification (BUILD-16 Part 3) — a gift-alert email to a team
// member (ED / assigned officer), NOT the donor. So it carries the branded
// header but never the donor unsubscribe/CAN-SPAM footer (that's for donor
// mail). No-ops cleanly without RESEND_API_KEY; the run is still logged.
// Returns TRUE only when the send actually succeeded (BUILD-45 / F-2 fix — it
// used to swallow every provider error and always return true, so callers
// could never tell a delivery failed). No RESEND_API_KEY configured = "nothing
// to deliver" is a success (don't queue retries in an env with no email).
async function sendGiftAlertEmail(org, toEmail, subject, bodyHtml) {
  if (!toEmail) return false;
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml;
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (!process.env.RESEND_API_KEY) return true; // email not configured — no failure to record
  try {
    const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
    if (error) { console.error("[notify] gift-alert email error:", error.message); return false; }
    return true;
  } catch (e) { console.error("[notify] gift-alert email threw:", e.message); return false; }
}

// ── BUILD-36 A4: internal-notification dedup + per-user email toggles ────────
// prefKind → the users.notify_* column. NULL / missing column is treated as ON
// (default true) — a pre-existing user keeps hearing about their donors/tasks.
const NOTIFY_PREF_COLUMN = {
  portfolio_gifts: "notify_portfolio_gifts",
  task_assignments: "notify_task_assignments",
  daily_tasks: "notify_daily_tasks",
};
async function userWantsEmail(userId, prefKind) {
  const col = NOTIFY_PREF_COLUMN[prefKind];
  if (!col) return true;
  const rows = await query(`SELECT ${col} AS p FROM users WHERE id=?`, [userId]);
  return rows.length ? rows[0].p !== false : true; // NULL → ON
}
function mapNotifyPrefs(row) {
  return {
    portfolioGifts: row?.notify_portfolio_gifts !== false,
    taskAssignments: row?.notify_task_assignments !== false,
    dailyTasks: row?.notify_daily_tasks !== false,
  };
}

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
// The AUTOMATIC retry timers are disabled under DISABLE_RATE_LIMIT (the
// local/test-env signal the rate limiters already use): during a deterministic
// test run this background sweep would otherwise replay previously-failed
// notifications into whichever suite's capture sink is currently listening on
// the shared mail port, skewing exact-count assertions. The function and the
// POST /admin/notifications/retry ops hook stay fully live, so notify-delivery
// drives retry explicitly and production (DISABLE_RATE_LIMIT unset) retries on
// the tick as designed.
if (!rateLimitDisabled()) {
  setTimeout(() => retryFailedNotifications().catch(console.error), 50000);
  setInterval(() => retryFailedNotifications().catch(console.error), 5 * 60 * 1000);
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

// Fire-and-forget wrapper for the task routes: load the org + fire the
// assignment email. actorUserId = who triggered the assignment (null = workflow).
async function queueTaskAssignmentEmail(task, actorUserId, eventKey = null) {
  if (!task || !task.assigned_to) return;
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [task.org_id]);
  if (!org) return;
  await notifyTaskAssignment(task, { org, actorUserId, eventKey });
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
async function runWorkflowAction(action, { org, donor, ctx, config }) {
  const firstName = donor?.name ? donor.name.trim().split(/\s+/)[0] : "there";
  const amtStr = ctx.amount != null ? `$${Number(ctx.amount).toLocaleString()}` : "";
  const fill = s => String(s || "").replace(/{donor}/g, donor?.name || "the donor").replace(/{amount}/g, amtStr);
  switch (action.type) {
    case "create_task":
    case "notify_owner": {
      const isOwner = action.type === "notify_owner";
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
      const title = isOwner
        ? `Stewardship alert: ${donor?.name || "a major donor"} gave ${amtStr || "a major gift"}`
        : fill(action.title || "Follow up");
      const due = action.dueDays != null ? new Date(Date.now() + action.dueDays * 86400000).toISOString().slice(0, 10) : "";
      const taskId = "t_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW())",
        [taskId, org.id, title, due, action.priority || "medium", donor?.id || null, owner?.id || null, owner?.name || null]
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
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW())",
        [taskId, org.id, title, due, "high", donor?.id || null, taskOwner?.id || null, taskOwner?.name || null]
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
        if (ctx.subscriptionRow) await sendDunningEmail(org, donor, ctx.subscriptionRow);
        return { type: "send_email", template: "recovery" };
      }
      if (action.template === "thankyou") {
        const body = `<p>Hi ${escHtmlWf(firstName)},</p>
<p>Thank you for your first gift to ${escHtmlWf(displayNameCase(org.name))} — welcome to our community. Gifts like yours are exactly what make our work possible, and we're so glad you're part of it.</p>
<p>You'll hear from a real person here soon. In the meantime, just reply if there's anything you'd like to know.</p>
<p>With gratitude,<br/>${escHtmlWf(displayNameCase(org.name))}</p>`;
        await sendWorkflowEmail(org, donor, `Thank you from ${displayNameCase(org.name)}`, body);
        return { type: "send_email", template: "thankyou" };
      }
      if (action.template === "reengage") {
        const body = `<p>Hi ${escHtmlWf(firstName)},</p>
<p>It's been a while, and we've missed you at ${escHtmlWf(displayNameCase(org.name))}. Your past support made a real difference — and there's more good work ahead we'd love for you to be part of.</p>
<p>If now's a good time to come back, we'd be grateful. And if not, thank you all the same.</p>
<p>Warmly,<br/>${escHtmlWf(displayNameCase(org.name))}</p>`;
        await sendWorkflowEmail(org, donor, `We've missed you at ${displayNameCase(org.name)}`, body);
        return { type: "send_email", template: "reengage" };
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
      try { const res = await runWorkflowAction(a, { org, donor, ctx, config }); if (res) taken.push(res); }
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
        `SELECT id, last_gift_date FROM donors
          WHERE org_id=? AND deleted_at IS NULL AND gift_count > 0
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
}
setTimeout(() => processWorkflowSweeps().catch(console.error), 25000);
setInterval(() => processWorkflowSweeps().catch(console.error), 5 * 60 * 1000);

// ── Workflow routes ─────────────────────────────────────────────────────────
app.get("/workflows", requireAuth, wrap(async (req, res) => {
  await ensureWorkflows(req.user.orgId);
  const rows = await query("SELECT * FROM workflows WHERE org_id=? ORDER BY created_at ASC", [req.user.orgId]);
  // Attach recent run counts + last run per workflow.
  const runCounts = await query(
    "SELECT workflow_id, COUNT(*)::int AS n, MAX(created_at) AS last FROM workflow_runs WHERE org_id=? GROUP BY workflow_id",
    [req.user.orgId]
  );
  const byWf = Object.fromEntries(runCounts.map(r => [r.workflow_id, r]));
  res.json(rows.map(w => ({
    ...w,
    conditions: asJson(w.conditions, []), actions: asJson(w.actions, []), config: asJson(w.config, {}),
    description: WORKFLOW_RECIPE_MAP[w.recipe_key]?.description || "",
    runCount: byWf[w.id]?.n || 0, lastRun: byWf[w.id]?.last || null,
  })));
}));

app.get("/workflows/:id/runs", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("workflows", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Workflow not found" });
  const runs = await query(
    "SELECT * FROM workflow_runs WHERE workflow_id=? AND org_id=? ORDER BY created_at DESC LIMIT 50",
    [req.params.id, req.user.orgId]
  );
  res.json(runs.map(r => ({ ...r, actions_taken: asJson(r.actions_taken, []) })));
}));

app.put("/workflows/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM workflows WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Workflow not found" });
  const { enabled, config } = req.body;
  const sets = [], params = [];
  if (enabled !== undefined) { sets.push("enabled=?"); params.push(!!enabled); }
  if (config !== undefined && config && typeof config === "object") {
    // Merge onto existing config; validate the two numeric knobs.
    const merged = { ...asJson(rows[0].config, {}), ...config };
    if (merged.threshold !== undefined) merged.threshold = Math.max(0, Number(merged.threshold) || 0);
    if (merged.lapseDays !== undefined) merged.lapseDays = Math.max(1, parseInt(merged.lapseDays, 10) || 365);
    if (merged.notify !== undefined && !["ed", "owner", "both"].includes(merged.notify)) merged.notify = "both";
    sets.push("config=?"); params.push(JSON.stringify(merged));
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  sets.push("updated_at=NOW()");
  params.push(req.params.id, req.user.orgId);
  await run(`UPDATE workflows SET ${sets.join(", ")} WHERE id=? AND org_id=?`, params);
  const updated = await query("SELECT * FROM workflows WHERE id=?", [req.params.id]);
  const w = updated[0];
  res.json({ ...w, conditions: asJson(w.conditions, []), actions: asJson(w.actions, []), config: asJson(w.config, {}) });
}));

// Manual trigger for tests/ops — simulate one trigger event (admin-only).
app.post("/workflows/simulate", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { trigger, donorId, amount, isFirstGift, dedupKey } = req.body || {};
  if (!trigger) return res.status(400).json({ error: "trigger required" });
  if (donorId && !(await orgOwns("donors", donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const result = await fireWorkflows(req.user.orgId, trigger, {
    dedupKey: dedupKey || `${trigger}:${donorId || "none"}:${Date.now()}`,
    donorId: donorId || null, amount, isFirstGift, entityType: donorId ? "donor" : null, entityId: donorId || null,
  });
  res.json(result);
}));

app.post("/recurring/process-dunning", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processDunning();
  res.json({ success: true });
}));

// Ops/test hook — run the donor_lapsed workflow sweep for the caller's org NOW
// (drives the exact scheduled path; same bar as /pipeline/run-auto-lapse and
// /sequences/process). Lets the P0 "imports fire zero workflows" guarantee be
// verified deterministically instead of waiting on the 5-min tick.
app.post("/workflows/run-sweeps", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processWorkflowSweeps(req.user.orgId);
  res.json({ success: true });
}));

// Public — a donor clicking the "Update my card" button in a dunning email.
// No login: verified via the signed recovery token. Checkout "setup" mode
// chosen over the Stripe Billing Customer Portal because the Portal requires
// its own per-connected-account configuration (branding, enabled features)
// across every one of Steward's connected orgs, which isn't something
// Steward can provision centrally at signup time; a setup-mode Checkout
// Session is fully self-contained per request, so it's the simpler and safer
// choice here even though the Portal is Stripe's more "official" tool for
// letting a customer manage a payment method on file.
app.get("/recurring/update-card", wrap(async (req, res) => {
  if (!stripe) return res.status(503).send("Payments are not configured.");
  const decoded = verifyRecoveryToken(req.query.token);
  if (!decoded) return res.status(400).send("This link is invalid or has expired.");

  const orgRows = await query("SELECT id, name, org_slug, stripe_account_id FROM orgs WHERE id=?", [decoded.orgId]);
  const org = orgRows[0];
  if (!org || !org.stripe_account_id) return res.status(404).send("This organization could not be found.");

  const rsRows = await query(
    "SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=? AND org_id=?",
    [decoded.subscriptionId, org.id]
  );
  const rs = rsRows[0];
  if (!rs) return res.status(404).send("This subscription could not be found.");

  const frontendUrl = publicAppUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    payment_method_types: ["card"],
    ...(rs.stripe_customer_id ? { customer: rs.stripe_customer_id } : {}),
    setup_intent_data: { metadata: { subscription_id: rs.stripe_subscription_id, org_id: org.id } },
    success_url: `${frontendUrl}/give/${org.org_slug}?card_updated=true`,
    cancel_url: `${frontendUrl}/give/${org.org_slug}`,
  }, { stripeAccount: org.stripe_account_id });

  res.redirect(303, session.url);
}));

// ── Recurring gift recovery: staff-facing routes ────────────────────────────
app.get("/recurring/health", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const summaryRows = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('active','recovering'))::int AS active_count,
       COUNT(*) FILTER (WHERE status IN ('past_due','recovering'))::int AS at_risk_count,
       COALESCE(SUM(amount) FILTER (WHERE status IN ('past_due','recovering')), 0) AS mrr_at_risk
     FROM recurring_subscriptions WHERE org_id=?`,
    [orgId]
  );
  const s = summaryRows[0] || {};

  const { rate: recoveryRate } = await computeRecoveryRate(orgId);

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const recoveredThisMonth = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='payment_recovered' AND created_at >= ?",
    [orgId, monthStart.toISOString()]
  ))[0]?.c || 0;
  const lostThisMonth = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='subscription_canceled' AND created_at >= ?",
    [orgId, monthStart.toISOString()]
  ))[0]?.c || 0;

  res.json({
    activeCount: s.active_count || 0,
    atRiskCount: s.at_risk_count || 0,
    mrrAtRisk: parseFloat(s.mrr_at_risk) || 0,
    recoveredThisMonth,
    lostThisMonth,
    recoveryRate,
  });
}));

// GET /impact — the honest "what Steward has done for you" number, for
// retention (the subscription visibly pays for itself) and the sales demo.
// NON-NEGOTIABLE: only ATTRIBUTABLE amounts. We never present total giving as
// "Steward raised" — that would betray the whole honest-design brand. Two real
// figures + one clearly-labeled estimate:
//
//   (1) recoveredAmount — the hero, a HARD number: dollars the failed-card
//       recovery workflow actually won back, computed ONLY from the
//       payment_recovery_events the workflow itself recorded (type=
//       'payment_recovered', summing the tracked per-event amount). These are
//       recurring gifts that were in a failed/dunning state and then charged
//       successfully — money that, at most orgs, would have silently lapsed.
//       100% attributable, never estimated. Reconciles with the recovery log.
//   (2) platformFeesPaid — FACTUAL, 0 by construction: Steward processes
//       donations on the org's OWN Stripe account at a 0% platform fee, so the
//       org kept 100% of every gift. Not an assumption.
//   (3) estimatedFeesElsewhere — OPTIONAL, secondary, ALWAYS carries its
//       assumption inline (feeAssumptionPct): what a typical platform charging
//       ~3% would have skimmed off that same online giving. An estimate about
//       the counterfactual, clearly labeled — never a claim about Steward.
//
// Org-scoped. New org with nothing recovered yet → recoveredAmount 0 +
// watchingRecurringCount, so the client can show a forward-looking line
// ("watching N recurring donors for failed cards") instead of a fake number.
app.get("/impact", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;

  // (1) Recovered recurring giving — tracked recoveries ONLY, never total gifts.
  // Sum the per-event amount recorded by the recovery workflow. Each
  // payment_recovered event is one real gift won back from a failed state; a
  // subscription can appear across multiple failure/recovery cycles over time,
  // and every one of those is genuinely-recovered money, so we sum all of them
  // (not COUNT DISTINCT subscription like the recovery-RATE math).
  const recRows = await query(
    `SELECT COUNT(*)::int AS c,
            COALESCE(SUM((detail->>'amount')::numeric), 0) AS amt
       FROM payment_recovery_events
      WHERE org_id=? AND type='payment_recovered' AND (detail->>'amount') IS NOT NULL`,
    [orgId]
  );
  const recoveredCount = recRows[0]?.c || 0;
  const recoveredAmount = parseFloat(recRows[0]?.amt) || 0;

  // (1b) BUILD-32 Part 2 — RE-ENGAGED giving: gifts from donors who were LAPSED
  // and gave again. This is a SEPARATE, precisely-labelled number — it is NOT
  // "recovered" (that word is reserved for the failed-card recovery workflow
  // above; overclaiming it would betray the honest-design brand). "Re-engaged"
  // is a gift that followed a >365-day gap since the donor's prior gift — the
  // SAME lapse definition (LAPSE_DAYS) as inferStage / the auto-lapse sweep /
  // the win-back goal, so it's a real, measurable event, not an estimate. We
  // count EVERY such re-engagement gift (not only a donor's current last gift),
  // so a donor who lapsed, came back, then lapsed and came back again is counted
  // for each genuine return. reengagedDonorCount = distinct donors who came back.
  const reengRows = await query(
    `SELECT COALESCE(SUM(g.amount),0) AS amt, COUNT(DISTINCT g.donor_id)::int AS donors
       FROM gifts g
      WHERE g.org_id = ?
        AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = g.donor_id AND g2.date < g.date) IS NOT NULL
        AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = g.donor_id AND g2.date < g.date)::date > 365`,
    [orgId]
  );
  const reengagedAmount = parseFloat(reengRows[0]?.amt) || 0;
  const reengagedDonorCount = reengRows[0]?.donors || 0;

  // (1c) The donors BEHIND the re-engaged number — the Home hero chip drills
  // into exactly these rows (every aggregate drills into its source; the
  // destination must show the same count/amount the chip claimed). Same
  // >365-day-gap predicate as (1b), grouped per donor, capped at 50.
  const reengagedDonors = await query(
    `SELECT g.donor_id AS id, d.name, COALESCE(SUM(g.amount),0) AS amount,
            COUNT(*)::int AS gift_count, MAX(g.date) AS last_return_date
       FROM gifts g JOIN donors d ON d.id = g.donor_id
      WHERE g.org_id = ?
        AND (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = g.donor_id AND g2.date < g.date) IS NOT NULL
        AND g.date::date - (SELECT MAX(g2.date) FROM gifts g2 WHERE g2.donor_id = g.donor_id AND g2.date < g.date)::date > 365
      GROUP BY g.donor_id, d.name
      ORDER BY amount DESC
      LIMIT 50`,
    [orgId]
  );

  // (2) Fees kept — factual. Base = online giving processed through Steward
  // (own-Stripe donations, stripe_payment_id set), which the org kept 100% of.
  const givingRows = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM gifts WHERE org_id=? AND stripe_payment_id IS NOT NULL`,
    [orgId]
  );
  const onlineGivingProcessed = parseFloat(givingRows[0]?.total) || 0;

  // (3) Optional labeled estimate — assumption shown inline, secondary.
  const FEE_ASSUMPTION_PCT = 3;
  const estimatedFeesElsewhere =
    Math.round(onlineGivingProcessed * (FEE_ASSUMPTION_PCT / 100) * 100) / 100;

  // Forward-looking honest empty state: how many recurring donors Steward is
  // actively watching for failed cards (so a new org sees a real promise, not
  // a fabricated $0-dressed-as-something number).
  const watchRows = await query(
    `SELECT COUNT(*)::int AS c FROM recurring_subscriptions
      WHERE org_id=? AND status IN ('active', 'recovering', 'past_due')`,
    [orgId]
  );
  const watchingRecurringCount = watchRows[0]?.c || 0;

  const orgRows = await query("SELECT plan FROM orgs WHERE id=?", [orgId]);
  const plan = orgRows[0]?.plan || "trial";
  const planMonthlyCost = PLAN_MONTHLY_COST[plan] ?? null;

  res.json({
    recoveredAmount,               // hero, hard, attributable (failed-card workflow)
    recoveredCount,
    reengagedAmount,               // SURFACED, separate — lapsed donors who came back
    reengagedDonorCount,
    reengagedDonors: reengagedDonors.map(r => ({
      id: r.id, name: r.name, amount: parseFloat(r.amount) || 0,
      giftCount: r.gift_count, lastReturnDate: r.last_return_date,
    })),
    platformFeesPaid: 0,           // factual — 0% platform fee, own Stripe
    onlineGivingProcessed,         // base for the fee estimate
    estimatedFeesElsewhere,        // ESTIMATE — see feeAssumptionPct
    feeAssumptionPct: FEE_ASSUMPTION_PCT,
    watchingRecurringCount,        // forward-looking empty state
    plan,
    planMonthlyCost,
  });
}));

// Everyday staff action from the home-screen queue — re-sends the CURRENT
// dunning step's email on demand. Not gated by requireAdmin (matches
// POST /note-reminders/:id/send, the other "queue nudge" action any staff
// member can trigger) and doesn't touch dunning_step/next_dunning_at, so it
// never interferes with the automatic cadence.
app.post("/recurring/:donorId/resend", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const donorRows = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [req.params.donorId, orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });
  const donor = donorRows[0];
  if (!donor.email) return res.status(400).json({ error: "This donor has no email on file." });

  const rsRows = await query(
    "SELECT * FROM recurring_subscriptions WHERE org_id=? AND donor_id=? AND status IN ('past_due','recovering') ORDER BY last_failed_at DESC LIMIT 1",
    [orgId, donor.id]
  );
  if (!rsRows.length) return res.status(400).json({ error: "This donor has no recurring gift currently at risk." });
  const rs = rsRows[0];

  const suppressReason = await getSuppressionReason(donor.email, orgId);
  if (suppressReason) return res.status(400).json({ error: `This donor's email is suppressed (${suppressReason}).` });

  const orgRows = await query(
    "SELECT id, name, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE id=?", [orgId]
  );
  await sendDunningEmail(orgRows[0], donor, rs);
  await logRecoveryEvent(orgId, donor.id, rs.stripe_subscription_id, "dunning_sent", null, { manual: true });
  res.json({ sent: true });
}));

// Per-donor health record for the DonorProfile status chip (Active/Payment
// failed/Recovering/Recovered/Canceled) — null if this donor never had a
// recurring gift that's failed a payment (donors.stripe_subscription_status
// alone can't distinguish "recovering" from "past_due").
app.get("/donors/:id/recurring-subscription", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT stripe_subscription_id, amount, interval, status, failure_count, first_failed_at, last_failed_at, recovered_at, canceled_at
     FROM recurring_subscriptions WHERE donor_id=? AND org_id=? ORDER BY created_at DESC LIMIT 1`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows[0] || null);
}));

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

const DEFAULT_PLEDGE_REMINDER_SUBJECT = "A quick reminder about your pledge to {{org_name}}";
// {{donor_name}}/{{first_name}}/{{org_name}}/{{amount}}/{{due_date}}/{{give_url}}
// tokens, same replacement convention as the dunning templates. No "Update
// my card" CTA here — a pledge has no payment method on file to fix, so the
// call to action is simply the org's existing public donation page.
const DEFAULT_PLEDGE_REMINDER_BODY = `<p>Hi {{first_name}},</p>
<p>Thank you again for your generous pledge of {{amount}} to {{org_name}}. We wanted to check in — that pledge was due {{due_date}}, and we don't show a matching gift yet.</p>
<p>If you've already sent it, thank you — please disregard this note, it may have just crossed paths with your gift. If not, you can fulfill your pledge here:</p>
<p style="text-align:center;margin:28px 0;"><a href="{{give_url}}" style="background:#1a6b4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Fulfill my pledge</a></p>
<p>If you have any questions, just reply to this email — we're glad to help.</p>
<p>With gratitude,<br/>{{org_name}}</p>`;

function applyPledgeReminderTokens(str, { donor, org, amount, dueDate, giveUrl }) {
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  return (str || "")
    .replace(/{{donor_name}}/g, donor.name || "")
    .replace(/{{first_name}}/g, firstName)
    .replace(/{{org_name}}/g, displayNameCase(org.name) || "")
    .replace(/{{amount}}/g, amount != null ? `$${Number(amount).toLocaleString()}` : "your pledge")
    .replace(/{{due_date}}/g, dueDate ? new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "")
    .replace(/{{give_url}}/g, giveUrl);
}

async function sendPledgeReminderEmail(org, donor, pledgeRow) {
  const suppressReason = await getSuppressionReason(donor.email, org.id);
  if (suppressReason) {
    console.log(`[pledge-reminder] skipping suppressed address ${donor.email} (${suppressReason})`);
    return false;
  }
  const frontendUrl = publicAppUrl();
  const giveUrl = `${frontendUrl}/give/${org.org_slug}`;
  const tokenCtx = { donor, org, amount: pledgeRow.amount, dueDate: pledgeRow.due_date, giveUrl };
  const subject = applyPledgeReminderTokens(org.pledge_reminder_subject || DEFAULT_PLEDGE_REMINDER_SUBJECT, tokenCtx);
  const bodyHtml = applyPledgeReminderTokens(org.pledge_reminder_body || DEFAULT_PLEDGE_REMINDER_BODY, tokenCtx)
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        from: smtpFrom, to: donor.email, subject, html: bodyHtml,
        headers: unsubscribeHeaders(donor.email, org.id, "campaign"),
      });
      if (sendErr) console.error("[pledge-reminder] send error:", sendErr.message);
    } catch (e) { console.error("[pledge-reminder] resend error:", e.message); }
  }
  return true;
}

async function processPledgeReminders() {
  try {
    // Step 1 — the trigger. Recurring dunning's cadence is initialized by a
    // Stripe webhook (invoice.payment_failed); a pledge due date has no
    // equivalent external event, so this scan IS the trigger: any open
    // pledge whose due date has just passed starts its cadence at "day 0"
    // (fires immediately, same as a fresh payment failure does).
    await run(
      `UPDATE pledges SET first_overdue_at=NOW(), next_reminder_at=NOW(), updated_at=NOW()
       WHERE status='open' AND first_overdue_at IS NULL AND due_date::date < CURRENT_DATE`
    );

    // Step 2 — send whatever's due, exactly like processDunning().
    const rows = await query(
      `SELECT p.*, d.name AS donor_name, d.email AS donor_email
       FROM pledges p
       JOIN donors d ON d.id = p.donor_id
       WHERE p.status = 'open' AND p.next_reminder_at <= NOW()`
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
setTimeout(() => processPledgeReminders().catch(console.error), 5000);
setInterval(() => processPledgeReminders().catch(console.error), 60 * 60 * 1000);

app.post("/pledges/process-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processPledgeReminders();
  res.json({ success: true });
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

  const suppressReason = await getSuppressionReason(p.donor_email, req.user.orgId);
  if (suppressReason) return res.status(400).json({ error: `This donor's email is suppressed (${suppressReason}).` });

  const orgRows = await query(
    "SELECT id, name, org_slug, pledge_reminder_subject, pledge_reminder_body FROM orgs WHERE id=?", [req.user.orgId]
  );
  await sendPledgeReminderEmail(orgRows[0], { name: p.donor_name, email: p.donor_email }, p);
  res.json({ sent: true });
}));

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

app.get("/billing/status", requireAuth, wrap(async (req, res) => {
  const orgs = await query("SELECT plan, subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, grace_until, current_period_end FROM orgs WHERE id=?", [req.user.orgId]);
  if (!orgs.length) return res.status(404).json({ error: "Org not found" });
  const org = orgs[0];
  const plan = org.plan || "trial";
  const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000)) : null;
  const isTrial = (org.subscription_status || "trialing") === "trialing";

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
  });
}));

// Which STRIPE_PRICE_* env var backs each plan — used only for a precise server
// log ("billing key is TEST but STRIPE_PRICE_TEAM is a LIVE price").
const PLAN_PRICE_ENV = {
  core: "STRIPE_PRICE_CORE", team: "STRIPE_PRICE_TEAM", founding: "STRIPE_PRICE_FOUNDING",
  seed: "STRIPE_PRICE_SEED", growth: "STRIPE_PRICE_GROWTH", impact: "STRIPE_PRICE_IMPACT",
};

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
  const { plan } = req.body;
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
  // Validation ordered BEFORE any Stripe API call so it's testable without keys.
  if (!(plan in priceMap)) return res.status(400).json({ error: "Invalid plan. Must be core or team." });
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

    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: publicAppUrl() + "/dashboard?subscribed=true",
      cancel_url:  publicAppUrl() + "/pricing",
      metadata: { orgId: req.user.orgId, plan },
      subscription_data: subData,
      customer: customerId,
    };

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

// ── Admin (super admin only) ───────────────────────────────────────────────
const PLAN_MRR = { core: 149, team: 299, founding: 99, seed: 99, growth: 249, impact: 499, trial: 0 };

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
};

// Core/Team/founding bands are kept SOFT for launch — informational only, never
// a hard 403. Legacy seed/growth/impact keep their existing hard enforcement so
// no pre-cutover org's behavior changes.
const SOFT_BAND_PLANS = new Set(["core", "team", "founding"]);

// Published monthly price per plan (USD) — mirrors pages/Pricing.jsx's
// CHECKOUT_PLANS/BILLING_PLANS. Used ONLY to render the ROI comparison
// ("your plan is $149/mo") next to Steward's recovered-dollars figure; not a
// billing source of truth. trial → null (nothing charged yet).
const PLAN_MONTHLY_COST = {
  core: 149, team: 299, founding: 99, seed: 99, growth: 249, impact: 499,
};

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
    const rows = await query("SELECT COUNT(*) AS c FROM users WHERE org_id=?", [org.id]);
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
    query("SELECT id, name, email, role, created_at FROM users WHERE org_id=? ORDER BY created_at ASC", [req.params.id]),
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
  const { plan } = req.body;
  const valid = ["trial", "core", "team", "founding", "seed", "growth", "impact"];
  if (!valid.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const status = plan === "trial" ? "trialing" : "active";
  await run("UPDATE orgs SET plan=?, subscription_status=? WHERE id=?", [plan, status, req.params.id]);
  const orgs = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  res.json(orgs[0]);
}));

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
  await run("DELETE FROM fin_audit_log WHERE org_id=?", [orgId]).catch(() => {});
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
  await run("DELETE FROM ai_log WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM gmail_connections WHERE org_id=?", [orgId]).catch(() => {});
  await run("DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id=?)", [orgId]).catch(() => {});
  await run("DELETE FROM users WHERE org_id=?", [orgId]).catch(() => {});
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
  { table: "fin_audit_log", col: "user_id" },
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

async function syncAllGmail() {
  const connections = await query("SELECT * FROM gmail_connections WHERE status='active'");
  for (const conn of connections) {
    await syncGmail(conn.user_id, conn.org_id).catch(e => console.error("[gmail-sync]", e.message));
  }
}

// POST /gmail/auth-url — returns OAuth URL for frontend to redirect to
app.post("/gmail/auth-url", requireAuth, wrap(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Gmail not configured" });
  const oauth2Client = makeOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    state: req.user.userId,
    prompt: "consent",
  });
  res.json({ url });
}));

// GET /gmail/callback — OAuth callback from Google (public)
app.get("/gmail/callback", wrap(async (req, res) => {
  const { code, state: userId, error } = req.query;
  const frontendUrl = publicAppUrl();
  if (error || !code) return res.redirect(`${frontendUrl}/dashboard?gmailError=access_denied`);

  try {
    const oauth2Client = makeOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail   = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email   = profile.data.emailAddress;

    // Look up the user to get their org
    const users = await query("SELECT id, org_id FROM users WHERE id=?", [userId]);
    if (!users.length) return res.redirect(`${frontendUrl}/dashboard?gmailError=user_not_found`);
    const orgId = users[0].org_id;

    await run(
      `INSERT INTO gmail_connections (id, org_id, user_id, email, access_token, refresh_token, token_expiry, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT (user_id) DO UPDATE SET
         email=EXCLUDED.email, access_token=EXCLUDED.access_token,
         refresh_token=EXCLUDED.refresh_token, token_expiry=EXCLUDED.token_expiry,
         status='active'`,
      [
        `gc_${uuid().slice(0, 8)}`,
        orgId,
        userId,
        email,
        tokens.access_token,
        tokens.refresh_token || "",
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      ]
    );

    // Kick off an initial sync in the background
    syncGmail(userId, orgId).catch(e => console.error("[gmail-connect-sync]", e.message));

    res.redirect(`${frontendUrl}/dashboard?gmailConnected=true`);
  } catch (e) {
    console.error("[gmail-callback]", e.message);
    res.redirect(`${frontendUrl}/dashboard?gmailError=callback_failed`);
  }
}));

// GET /gmail/status — returns connection info for current user
app.get("/gmail/status", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT email, status, last_synced_at FROM gmail_connections WHERE user_id=?",
    [req.user.userId]
  );
  if (!rows.length) return res.json({ connected: false });
  const c = rows[0];
  res.json({
    connected: c.status === "active",
    disconnected: c.status === "disconnected",
    email: c.email,
    lastSyncedAt: c.last_synced_at,
  });
}));

// DELETE /gmail/disconnect — revokes token and removes connection
app.delete("/gmail/disconnect", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM gmail_connections WHERE user_id=?", [req.user.userId]);
  if (!rows.length) return res.json({ ok: true });
  const conn = rows[0];
  try {
    const oauth2Client = makeOAuth2Client();
    await oauth2Client.revokeToken(conn.access_token);
  } catch { /* ignore revocation errors */ }
  await run("DELETE FROM gmail_connections WHERE user_id=?", [req.user.userId]);
  res.json({ ok: true });
}));

// POST /gmail/sync — manually trigger sync for current user
app.post("/gmail/sync", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT status FROM gmail_connections WHERE user_id=?", [req.user.userId]);
  if (!rows.length) return res.status(404).json({ error: "No Gmail connection found" });
  if (rows[0].status !== "active") return res.status(400).json({ error: "Gmail connection is not active" });
  // Run sync async — respond immediately
  syncGmail(req.user.userId, req.user.orgId).catch(e => console.error("[gmail-manual-sync]", e.message));
  res.json({ ok: true, message: "Sync started" });
}));

// POST /gmail/send — send email via user's connected Gmail and log to interactions
app.post("/gmail/send", requireAuth, wrap(async (req, res) => {
  const { donorId, to, subject, body } = req.body;
  if (donorId) {
    const donorCheck = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
    if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  }
  const conns = await query("SELECT * FROM gmail_connections WHERE user_id=? AND status='active'", [req.user.userId]);
  if (!conns.length) return res.status(400).json({ error: "Gmail not connected" });
  const conn = conns[0];

  const oauth2Client = makeOAuth2Client();
  oauth2Client.setCredentials({
    access_token: conn.access_token,
    refresh_token: conn.refresh_token,
    expiry_date: conn.token_expiry ? new Date(conn.token_expiry).getTime() : undefined,
  });
  oauth2Client.on("tokens", async (tokens) => {
    const sets = [], vals = [];
    if (tokens.access_token) { sets.push("access_token=?"); vals.push(tokens.access_token); }
    if (tokens.expiry_date) { sets.push("token_expiry=?"); vals.push(new Date(tokens.expiry_date).toISOString()); }
    if (sets.length) { vals.push(conn.id); await run(`UPDATE gmail_connections SET ${sets.join(",")} WHERE id=?`, vals); }
  });

  const emailLines = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset=utf-8`, ``, body];
  const raw = Buffer.from(emailLines.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  let sendResp;
  try {
    sendResp = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch (e) {
    if (e.code === 401) {
      try {
        await oauth2Client.refreshAccessToken();
        sendResp = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      } catch {
        await run("UPDATE gmail_connections SET status='disconnected' WHERE id=?", [conn.id]);
        return res.status(401).json({ error: "Failed to send — reconnect Gmail in Settings" });
      }
    } else throw e;
  }

  const msgId = sendResp.data.id;
  if (donorId) {
    const id = Math.random().toString(36).slice(2);
    const note = `Subject: ${subject}\n\n${body.slice(0, 500)}`;
    const metadata = JSON.stringify({ gmail_message_id: msgId, from: conn.email, to, subject, direction: "outbound" });
    await run(
      `INSERT INTO interactions (id, org_id, donor_id, type, note, date, metadata, created_at) VALUES (?, ?, ?, 'email', ?, ?, ?, NOW())`,
      [id, req.user.orgId, donorId, note, new Date().toISOString().split("T")[0], metadata]
    );
  }
  res.json({ success: true, messageId: msgId });
}));

// GET /gmail/thread/:donorId — last 20 email interactions for AI context
app.get("/gmail/thread/:donorId", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, type, note, date, created_at, metadata FROM interactions WHERE org_id=? AND donor_id=? AND type='email' ORDER BY created_at DESC LIMIT 20`,
    [req.user.orgId, req.params.donorId]
  );
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

// ── Events ────────────────────────────────────────────────────────────────────

app.get("/events", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const rows = await query(`
      SELECT e.*,
        COUNT(CASE WHEN ea.status='attended' THEN 1 END)::int AS attendee_count,
        COUNT(CASE WHEN ea.status='confirmed' THEN 1 END)::int AS confirmed_count,
        COUNT(CASE WHEN ea.status='no_show' THEN 1 END)::int AS no_show_count,
        COUNT(ea.id)::int AS invited_count,
        COALESCE(SUM(ea.gift_amount),0) AS total_revenue
      FROM events e
      LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE e.org_id = $1
      GROUP BY e.id
      ORDER BY e.date DESC
    `, [orgId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/events", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { name, eventType, date, endDate, location, description, capacity, cost } = req.body;
    if (!name || !eventType || !date) return res.status(400).json({ error: "name, eventType, date required" });
    const id = "evt_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO events (id, org_id, name, event_type, date, end_date, location, description, capacity, cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, orgId, name, eventType, date, endDate || null, location || null, description || null, capacity || null, parseFloat(cost) || 0]
    );
    const [row] = await query("SELECT * FROM events WHERE id=$1", [id]);
    res.json({ ...row, attendee_count: 0, confirmed_count: 0, no_show_count: 0, invited_count: 0, total_revenue: 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/events/:id", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { name, eventType, date, endDate, location, description, capacity, status, revenue, cost, notes } = req.body;
    const affected = await run(
      `UPDATE events SET name=$1, event_type=$2, date=$3, end_date=$4, location=$5,
       description=$6, capacity=$7, status=$8, revenue=$9, cost=$10, notes=$11
       WHERE id=$12 AND org_id=$13`,
      [name, eventType, date, endDate || null, location || null, description || null,
       capacity || null, status || 'upcoming', parseFloat(revenue) || 0, parseFloat(cost) || 0,
       notes || null, req.params.id, orgId]
    );
    if (!affected.changes) return res.status(404).json({ error: "Event not found" });
    const rows = await query(`
      SELECT e.*, COUNT(CASE WHEN ea.status='attended' THEN 1 END)::int AS attendee_count,
        COUNT(CASE WHEN ea.status='confirmed' THEN 1 END)::int AS confirmed_count,
        COUNT(CASE WHEN ea.status='no_show' THEN 1 END)::int AS no_show_count,
        COUNT(ea.id)::int AS invited_count,
        COALESCE(SUM(ea.gift_amount),0) AS total_revenue
      FROM events e LEFT JOIN event_attendees ea ON ea.event_id=e.id
      WHERE e.id=$1 AND e.org_id=$2 GROUP BY e.id
    `, [req.params.id, orgId]);
    res.json(rows[0] || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/events/:id", requireAuth, async (req, res) => {
  try {
    await run("DELETE FROM events WHERE id=$1 AND org_id=$2", [req.params.id, req.user.orgId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/events/:id", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const evts = await query(`
      SELECT e.*, COUNT(CASE WHEN ea.status='attended' THEN 1 END)::int AS attendee_count,
        COUNT(CASE WHEN ea.status='confirmed' THEN 1 END)::int AS confirmed_count,
        COUNT(CASE WHEN ea.status='invited' THEN 1 END)::int AS invited_count_raw,
        COUNT(CASE WHEN ea.status='no_show' THEN 1 END)::int AS no_show_count,
        COUNT(ea.id)::int AS total_count,
        COALESCE(SUM(ea.gift_amount),0) AS total_revenue
      FROM events e LEFT JOIN event_attendees ea ON ea.event_id=e.id
      WHERE e.id=$1 AND e.org_id=$2 GROUP BY e.id
    `, [req.params.id, orgId]);
    if (!evts.length) return res.status(404).json({ error: "Not found" });
    const attendees = await query(`
      SELECT ea.*, d.stage, d.total_giving, d.assigned_to_name
      FROM event_attendees ea
      LEFT JOIN donors d ON d.id = ea.donor_id
      WHERE ea.event_id=$1
      ORDER BY ea.created_at ASC
    `, [req.params.id]);
    res.json({ ...evts[0], attendees });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/events/:id/attendees", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const eventId = req.params.id;
    const evts = await query("SELECT id FROM events WHERE id=$1 AND org_id=$2", [eventId, orgId]);
    if (!evts.length) return res.status(404).json({ error: "Event not found" });
    const { donorIds, name, email, notes } = req.body;
    const added = [];
    if (donorIds && Array.isArray(donorIds)) {
      for (const donorId of donorIds) {
        const dr = await query("SELECT id, name, email FROM donors WHERE id=$1 AND org_id=$2", [donorId, orgId]);
        if (!dr.length) continue;
        const d = dr[0];
        const attId = "att_" + uuid().slice(0, 8);
        try {
          await run(
            `INSERT INTO event_attendees (id, event_id, org_id, donor_id, name, email)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id, donor_id) DO NOTHING`,
            [attId, eventId, orgId, donorId, d.name, d.email || ""]
          );
          added.push(d.name);
        } catch { /* skip */ }
      }
    } else {
      if (!name) return res.status(400).json({ error: "name required" });
      const attId = "att_" + uuid().slice(0, 8);
      await run(
        `INSERT INTO event_attendees (id, event_id, org_id, donor_id, name, email, notes)
         VALUES ($1,$2,$3,NULL,$4,$5,$6)`,
        [attId, eventId, orgId, name, email || "", notes || ""]
      );
      added.push(name);
    }
    res.json({ added: added.length, names: added });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/events/:id/attendees/:attendeeId", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { status, giftAmount, notes } = req.body;
    const rows = await query("SELECT * FROM event_attendees WHERE id=$1 AND org_id=$2", [req.params.attendeeId, orgId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const att = rows[0];
    const newStatus = status !== undefined ? status : att.status;
    const newGift = giftAmount !== undefined ? (parseFloat(giftAmount) || 0) : (parseFloat(att.gift_amount) || 0);
    const newNotes = notes !== undefined ? notes : att.notes;
    await run(
      "UPDATE event_attendees SET status=$1, gift_amount=$2, notes=$3 WHERE id=$4 AND org_id=$5",
      [newStatus, newGift, newNotes, req.params.attendeeId, orgId]
    );
    // If attended + gift > 0 + has a donor, log the gift
    if (newStatus === 'attended' && newGift > 0 && att.donor_id) {
      const evtRows = await query("SELECT * FROM events WHERE id=$1", [att.event_id]);
      const evt = evtRows[0];
      const today = new Date().toISOString().slice(0, 10);
      const giftId = "g_" + uuid().slice(0, 8);
      await run(
        `INSERT INTO gifts (id, org_id, donor_id, amount, date, type, campaign, notes)
         VALUES ($1,$2,$3,$4,$5,'cash',$6,$7)
         ON CONFLICT DO NOTHING`,
        [giftId, orgId, att.donor_id, newGift, today, evt?.name || "Event", `Gift at ${evt?.name || "event"}`]
      );
      await run(
        `UPDATE donors SET total_giving=total_giving+$1, last_gift_amount=$1,
         last_gift_date=$2, gift_count=gift_count+1 WHERE id=$3 AND org_id=$4`,
        [newGift, today, att.donor_id, orgId]
      );
      const funds = await query("SELECT id FROM fin_funds WHERE org_id=$1 AND restricted=false LIMIT 1", [orgId]);
      const accts = await query("SELECT id FROM accounts WHERE org_id=$1 AND type='revenue' LIMIT 1", [orgId]);
      if (funds.length && accts.length) {
        await run(
          `INSERT INTO fin_transactions (id, org_id, date, description, vendor_donor, amount, type, account_id, fund_id, donor_id, source, gift_id)
           VALUES ($1,$2,$3,$4,$5,$6,'income',$7,$8,$9,'gift',$10)
           ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
          ["ft_" + uuid().slice(0,8), orgId, today, `Event Gift — ${evt?.name||"event"}`, att.name, newGift, accts[0].id, funds[0].id, att.donor_id, giftId]
        );
      }
    }
    // On attendance: +5 wealth score, log interaction, advance prospect/qualify stage
    if (newStatus === 'attended' && att.donor_id) {
      const evtInfoRows = await query("SELECT name FROM events WHERE id=$1", [att.event_id]);
      const evtName = evtInfoRows[0]?.name || "event";
      const today = new Date().toISOString().slice(0, 10);
      await run(`UPDATE donors SET wealth_score = LEAST(COALESCE(wealth_score,0)+5, 99) WHERE id=$1 AND org_id=$2`, [att.donor_id, orgId]).catch(() => {});
      await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'event',$4,$5)",
        ["i_"+uuid().slice(0,8), orgId, att.donor_id, `Attended: ${evtName}`, today]).catch(() => {});
      await run(`UPDATE donors SET stage = CASE WHEN stage='prospect' THEN 'qualify' WHEN stage='qualify' THEN 'cultivate' ELSE stage END WHERE id=$1 AND org_id=$2 AND stage IN ('prospect','qualify')`,
        [att.donor_id, orgId]).catch(() => {});
    }
    const updated = await query("SELECT ea.*, d.stage, d.total_giving FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id WHERE ea.id=$1", [req.params.attendeeId]);
    res.json(updated[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/events/:id/attendees/:attendeeId", requireAuth, async (req, res) => {
  try {
    await run("DELETE FROM event_attendees WHERE id=$1 AND org_id=$2", [req.params.attendeeId, req.user.orgId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/events/:id/follow-up", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { taskTitle, dueDate, priority } = req.body;
    const evts = await query("SELECT name FROM events WHERE id=$1 AND org_id=$2", [req.params.id, orgId]);
    if (!evts.length) return res.status(404).json({ error: "Event not found" });
    const eventName = evts[0].name;
    const attendees = await query(
      "SELECT * FROM event_attendees WHERE event_id=$1 AND status='attended' AND donor_id IS NOT NULL",
      [req.params.id]
    );
    let count = 0;
    for (const att of attendees) {
      const title = (taskTitle || "Follow up with {{event_name}} attendee")
        .replace("{{event_name}}", eventName);
      await run(
        `INSERT INTO tasks (id, org_id, title, due, priority, type, donor_id)
         VALUES ($1,$2,$3,$4,$5,'donor',$6)`,
        ["tsk_" + uuid().slice(0, 8), orgId, title, dueDate || null, priority || 'medium', att.donor_id]
      );
      count++;
    }
    res.json({ count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/donors/:id/events", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const rows = await query(`
      SELECT e.id, e.name, e.event_type, e.date, e.status, ea.status AS attendee_status
      FROM event_attendees ea
      JOIN events e ON e.id = ea.event_id
      WHERE ea.donor_id = $1 AND ea.org_id = $2
      ORDER BY e.date DESC
    `, [req.params.id, orgId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Data export ────────────────────────────────────────────────────────────
app.get("/org/export", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = new Date().toISOString().split("T")[0];

  const cfDefs = await query("SELECT id, label FROM custom_fields WHERE org_id=? ORDER BY field_order", [orgId]);
  const cfVals = await query("SELECT donor_id, field_id, value FROM custom_field_values WHERE org_id=?", [orgId]);
  const cfByDonor = {};
  for (const v of cfVals) {
    if (!cfByDonor[v.donor_id]) cfByDonor[v.donor_id] = {};
    cfByDonor[v.donor_id][v.field_id] = v.value;
  }

  const [donors, gifts, pledges, grants, txns, events, attendees, campaigns, interactions, volunteers, board, tasks] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY name", [orgId]),
    query("SELECT g.*, d.name as donor_name FROM gifts g LEFT JOIN donors d ON d.id=g.donor_id WHERE g.org_id=? ORDER BY g.date DESC", [orgId]),
    query("SELECT pg.*, d.name as donor_name FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id WHERE pg.org_id=? ORDER BY pg.created_at DESC", [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query("SELECT * FROM fin_transactions WHERE org_id=? ORDER BY date DESC", [orgId]),
    query("SELECT * FROM events WHERE org_id=? ORDER BY date DESC", [orgId]),
    query("SELECT ea.*, d.name as donor_name, e.name as event_name FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id LEFT JOIN events e ON e.id=ea.event_id WHERE ea.org_id=? ORDER BY ea.created_at DESC", [orgId]),
    query("SELECT * FROM campaigns WHERE org_id=? ORDER BY created_at DESC", [orgId]),
    query("SELECT i.*, d.name as donor_name FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id WHERE i.org_id=? ORDER BY i.date DESC", [orgId]),
    query("SELECT * FROM volunteers WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT * FROM board_members WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT t.*, d.name as donor_name FROM tasks t LEFT JOIN donors d ON d.id=t.donor_id WHERE t.org_id=? ORDER BY t.due", [orgId]),
  ]);

  const donorsEnriched = donors.map(d => ({
    ...d,
    custom_fields: cfDefs.reduce((acc, f) => { acc[f.label] = cfByDonor[d.id]?.[f.id] ?? null; return acc; }, {}),
  }));

  res.setHeader("Content-Disposition", `attachment; filename="steward-export-${orgSlug}-${date}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    org: orgRows[0] || {},
    donors: donorsEnriched,
    gifts,
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
app.get("/org/export/csv", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { ZipArchive } = require("archiver"); // archiver v8 API — class export, not a factory function
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = new Date().toISOString().split("T")[0];

  const cfDefs = await query("SELECT id, label FROM custom_fields WHERE org_id=? ORDER BY field_order", [orgId]);
  const cfVals = await query("SELECT donor_id, field_id, value FROM custom_field_values WHERE org_id=?", [orgId]);
  const cfByDonor = {};
  for (const v of cfVals) {
    if (!cfByDonor[v.donor_id]) cfByDonor[v.donor_id] = {};
    cfByDonor[v.donor_id][v.field_id] = v.value;
  }

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
           WHERE g.org_id=? ORDER BY g.date DESC`, [orgId]),
    query(`SELECT i.*, d.name AS donor_name, d.email AS donor_email, i.metadata->>'direction' AS direction
           FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id
           WHERE i.org_id=? ORDER BY i.date DESC`, [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query(`SELECT p.*, d.name AS donor_name, d.email AS donor_email
           FROM pledges p LEFT JOIN donors d ON d.id=p.donor_id
           WHERE p.org_id=? ORDER BY p.due_date`, [orgId]),
    query(`SELECT pg.*, d.name AS donor_name, d.email AS donor_email
           FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id
           WHERE pg.org_id=? ORDER BY pg.created_at DESC`, [orgId]),
    query(`SELECT r.*, d.name AS donor_name, d.email AS donor_email
           FROM recurring_subscriptions r LEFT JOIN donors d ON d.id=r.donor_id
           WHERE r.org_id=? ORDER BY r.created_at DESC`, [orgId]),
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
      ...cfDefs.map(f => [f.label, r => (cfByDonor[r.id] ? cfByDonor[r.id][f.id] : null)]),
    ], donors),
    "gifts.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Date", "date"], ["Amount", "amount"], ["Type", "type"], ["Payment method", "payment_method"],
      ["Fund", "fund_name"], ["Campaign", "campaign_name"], ["Giving page", "giving_page_title"],
      ["Peer fundraiser", "peer_fundraiser_name"], ["Acknowledged", "acknowledgement_sent"],
      ["Notes", "notes"], ["Sample data", "is_sample"],
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
      ["Recovered", "recovered_at"], ["Canceled", "canceled_at"],
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
    `Steward data export — ${orgRows[0]?.name || orgId}`,
    `Exported: ${new Date().toISOString()}`,
    "",
    "This zip contains your organization's complete data as CSV files you can",
    "open in any spreadsheet, import into another system, or archive. Rows",
    "flagged in a \"Sample data\" column came from Steward's demo dataset and",
    "can be filtered out. Your data is yours — this export is available",
    "anytime, including after a subscription ends.",
    "",
    "Row counts:",
    ...Object.entries(counts).map(([k, rows]) => `  ${k}.csv: ${rows.length}`),
    "",
  ].join("\n");

  // Headers go on only after every query has succeeded, so a DB error still
  // returns a clean JSON 500 instead of a half-written zip.
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="steward-export-${orgSlug}-${date}.zip"`);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", err => { console.error("[export/csv] archive error:", err); res.destroy(err); });
  archive.pipe(res);
  archive.append(readme, { name: "README.txt" });
  for (const [name, csv] of Object.entries(files)) archive.append(csv, { name });
  await archive.finalize();
}));

// ══════════════════════════════════════════════════════════════════════════
// BUILD-45 — DONOR PORTAL (public, money-moving, PII-bearing; §2–§6)
//
// Tenancy is path-based: /portal/:orgSlug (production reaches these routes
// same-origin through the vercel.json /portal-api proxy, so the SameSite=Lax
// HttpOnly session cookie flows; custom CNAME domains are BLOCKED-custom-
// domains.md). Donors never get passwords — magic link only (P-1). Portal
// sessions are a separate cookie + separate table from staff JWTs (P-4):
// requirePortalSession reads ONLY the cookie (never Authorization), and every
// staff route reads ONLY Authorization (never a cookie), so neither credential
// can cross. Every session-create, link-request, and mutation writes a
// portal_audit_log row (P-7). No donor-facing route ever logs email/token to
// console (S-7).
// ══════════════════════════════════════════════════════════════════════════

const PORTAL_COOKIE = "steward_portal";
const sha256hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function parsePortalCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setPortalCookie(res, token, maxAgeSec) {
  // HttpOnly + Secure + SameSite=Lax, 30-day max-age (P-4). Path=/ because in
  // production the browser-visible path is /portal-api/* (the proxy prefix).
  // Secure is unconditional: browsers treat the loopback origin as trustworthy,
  // so local dev still works, and production can never downgrade.
  res.append("Set-Cookie",
    [`${PORTAL_COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/",
     `Max-Age=${maxAgeSec}`].join("; "));
}

// One org lookup for every portal route: slug → org row + portal settings.
// Returns null for unknown slug OR a disabled portal (indistinguishable).
async function portalOrgBySlug(slug) {
  if (!slug || typeof slug !== "string" || slug.length > 120) return null;
  const rows = await query(
    `SELECT o.*, ps.enabled AS portal_enabled, ps.display_name AS portal_display_name,
            ps.logo_data AS portal_logo, ps.header_image_data AS portal_header_image,
            ps.primary_color, ps.accent_color, ps.footer_text AS portal_footer,
            ps.contact_email AS portal_contact, ps.ein_line AS portal_ein,
            ps.powered_by, ps.min_recurring_cents
     FROM orgs o JOIN portal_settings ps ON ps.org_id = o.id
     WHERE o.org_slug = ? AND ps.enabled = true`, [slug]);
  return rows[0] || null;
}

// §5 — the theme a donor's browser receives. Colors are normalized to WCAG-
// legible values at SAVE time (normalizeAccent, the one contrast impl shared
// with org branding); this re-checks at render and falls back to the designed
// neutral default rather than ever shipping an unreadable portal.
const PORTAL_DEFAULT_THEME = { primary: "#1a6b4a", primaryFg: "#ffffff", accent: "#c9a84c", accentFg: "#0f1a12" };
function portalThemePayload(org) {
  const clean = (v, cap) => (typeof v === "string" ? v.slice(0, cap) : null);
  const prim = org.primary_color ? normalizeAccent(org.primary_color) : null;
  const acc = org.accent_color ? normalizeAccent(org.accent_color) : null;
  return {
    orgSlug: org.org_slug,
    displayName: clean(org.portal_display_name, 120) || displayNameCase(org.name),
    logo: org.portal_logo || org.logo_data || null,
    headerImage: org.portal_header_image || null,
    primary: prim ? prim.accent : PORTAL_DEFAULT_THEME.primary,
    primaryFg: prim ? prim.fg : PORTAL_DEFAULT_THEME.primaryFg,
    accent: acc ? acc.accent : PORTAL_DEFAULT_THEME.accent,
    accentFg: acc ? acc.fg : PORTAL_DEFAULT_THEME.accentFg,
    footerText: clean(org.portal_footer, 500),
    contactEmail: clean(org.portal_contact, 200),
    einLine: clean(org.portal_ein, 200),
    poweredBy: org.powered_by === true,
    minRecurringCents: Number(org.min_recurring_cents) || 500,
    giveSlug: org.stripe_account_id ? org.org_slug : null, // R-6: reuse the existing public giving page
  };
}

async function portalAudit(orgId, donorId, email, action, req, meta) {
  await run(
    `INSERT INTO portal_audit_log (id,org_id,donor_id,email,action,ip,meta) VALUES (?,?,?,?,?,?,?)`,
    ["pal_" + uuid().slice(0, 12), orgId, donorId || null, email || null, action,
     (req && req.ip) || null, meta ? JSON.stringify(meta) : null]
  ).catch(e => console.error("[portal] audit write failed:", e.message));
}

// The donor records a portal session may see: exact-email matches in THAT org
// only (P-6). Multiple records for one email all belong to the session.
async function portalDonorsFor(orgId, email) {
  return query(
    `SELECT * FROM donors WHERE org_id = ? AND LOWER(email) = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    [orgId, String(email).toLowerCase()]);
}

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

// ── Session middleware (P-4) ───────────────────────────────────────────────
// Cookie-only. A staff JWT in Authorization is IGNORED here, exactly as the
// portal cookie is ignored by requireAuth — proven by the differential sweep.
function requirePortalSession(req, res, next) {
  (async () => {
    const raw = parsePortalCookies(req)[PORTAL_COOKIE];
    if (!raw || raw.length > 300) return res.status(401).json({ error: "portal_auth" });
    const rows = await query(
      `SELECT * FROM portal_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
      [sha256hex(raw)]);
    if (!rows.length) return res.status(401).json({ error: "portal_auth" });
    const sess = rows[0];
    const org = await portalOrgBySlug(req.params.orgSlug);
    // Tenant pinning: a session is scoped to ONE org — a valid session used
    // against another org's slug is a 401, never a data leak (S-2).
    if (!org || org.id !== sess.org_id) return res.status(401).json({ error: "portal_auth" });
    req.portal = { session: sess, org, email: sess.email };
    run(`UPDATE portal_sessions SET last_seen_at = NOW() WHERE id = ?`, [sess.id]).catch(() => {});
    next();
  })().catch(next);
}

// ── Magic-link email ───────────────────────────────────────────────────────
async function sendPortalMagicLinkEmail(org, email, token) {
  const theme = portalThemePayload(org);
  const link = `${publicAppUrl()}/portal/${org.org_slug}/verify#token=${token}`; // fragment: never sent in Referer (S-4)
  const orgName = escHtmlWf(theme.displayName);
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>Here is your secure sign-in link for your giving history with ${orgName}:</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:${theme.primary};color:${theme.primaryFg};text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">View my giving</a>
      </p>
      <p style="font-size:13px;color:#555;">This link works once and expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
      ${theme.contactEmail ? `<p style="font-size:13px;color:#555;">Questions? Write to <a href="mailto:${escHtmlWf(theme.contactEmail)}">${escHtmlWf(theme.contactEmail)}</a>.</p>` : ""}
    </div>`;
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { error: sendErr } = await resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to: email, subject: `Your sign-in link — ${theme.displayName}`, html,
    });
    if (sendErr) console.error("[portal] magic-link send error:", sendErr.message);
  } catch (e) { console.error("[portal] magic-link send failed:", e.message); }
}

// Donor-facing confirmation for every money mutation (R-8). Transactional —
// sent on the ORG's letterhead, no unsubscribe footer, suppression does not
// block it (a donor must always learn their schedule changed).
async function sendPortalMutationEmail(org, email, subject, bodyText) {
  if (!process.env.RESEND_API_KEY) return;
  const theme = portalThemePayload(org);
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>${escHtmlWf(bodyText)}</p>
      <p style="font-size:13px;color:#555;">You can review your giving anytime: <a href="${publicAppUrl()}/portal/${org.org_slug}">${escHtmlWf(theme.displayName)} donor portal</a>.</p>
      ${theme.contactEmail ? `<p style="font-size:13px;color:#555;">Questions? Write to <a href="mailto:${escHtmlWf(theme.contactEmail)}">${escHtmlWf(theme.contactEmail)}</a>.</p>` : ""}
    </div>`;
  try {
    const { error: sendErr } = await resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to: email, subject: `${subject} — ${theme.displayName}`, html,
    });
    if (sendErr) console.error("[portal] mutation email error:", sendErr.message);
  } catch (e) { console.error("[portal] mutation email failed:", e.message); }
}

// ── §6.3 drift wire — cancel/pause → the org hears about it in minutes ─────
async function portalDriftAlert(org, donor, sub, action, detail) {
  try {
    const officers = await query(
      `SELECT id, name, email FROM users WHERE org_id = ? AND id = ?`, [org.id, donor.assigned_to || ""]);
    let officer = officers[0];
    if (!officer) {
      const admins = await query(
        `SELECT id, name, email FROM users WHERE org_id = ? AND role = 'admin' ORDER BY created_at ASC LIMIT 1`, [org.id]);
      officer = admins[0];
    }
    if (!officer) return;
    const verb = action === "recurring_cancel" ? "canceled" : "paused";
    const amt = sub.amount != null ? `$${Number(sub.amount).toLocaleString()}/${sub.interval || "month"}` : "a recurring gift";
    // High-priority task due TODAY, donor-linked — the "needs you today" item.
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,donor_id,assigned_to,assigned_to_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ["t_" + uuid().slice(0, 8), org.id,
       `${donor.name} ${verb} their ${amt} recurring gift — reach out today`,
       localDateKey(new Date()), "high", "donor", donor.id, officer.id, officer.name || ""]);
    const subj = `${donor.name} ${verb} their recurring gift`;
    const body = `<p><strong>${escHtmlWf(donor.name)}</strong> just ${verb} their ${escHtmlWf(amt)} recurring gift from the donor portal${detail ? " — " + escHtmlWf(detail) : ""}.</p>
      <p>A cancellation the org learns about in minutes is a save opportunity. Suggested next step: a personal call or note today — thank them for their giving, ask nothing, and learn what changed.</p>`;
    await notifyUserOnce({
      org, userId: officer.id, email: officer.email,
      eventKey: `portal:${action}:${sub.id}`, channel: "portal_drift",
      prefKind: "notify_portfolio_gifts", subject: subj, bodyHtml: body,
    });
  } catch (e) { console.error("[portal] drift alert:", e.message); }
}

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

// ── Public: portal config (the login page's theme) ─────────────────────────
app.get("/portal/:orgSlug/config", wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  res.json({ theme: portalThemePayload(org) });
}));

// ── P-1/P-2/P-3: request a magic link ──────────────────────────────────────
app.post("/portal/:orgSlug/request-link", portalLinkIpLimiter, portalLinkEmailLimiter, wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  const email = String(req.body?.email || "").trim().toLowerCase();
  // P-2 — identical response AND timing for known and unknown emails: respond
  // first, do the lookup + send asynchronously.
  res.json({ received: true, message: "If we have this address on file, a sign-in link is on its way." });
  if (!email || email.length > 320 || !email.includes("@")) return;
  (async () => {
    const donors = await portalDonorsFor(org.id, email);
    await portalAudit(org.id, donors[0]?.id || null, email, "link_requested", req, { matched: donors.length > 0 });
    if (!donors.length) return;
    // Re-request invalidates any live prior link (P-1).
    await run(
      `UPDATE portal_magic_links SET superseded_at = NOW()
       WHERE org_id = ? AND email = ? AND used_at IS NULL AND superseded_at IS NULL`, [org.id, email]);
    const token = crypto.randomBytes(32).toString("base64url"); // 256-bit CSPRNG
    await run(
      `INSERT INTO portal_magic_links (id,org_id,email,token_hash,expires_at,requested_ip)
       VALUES (?,?,?,?, NOW() + INTERVAL '15 minutes', ?)`,
      ["pml_" + uuid().slice(0, 10), org.id, email, sha256hex(token), req.ip || null]);
    await sendPortalMagicLinkEmail(org, email, token);
  })().catch(e => console.error("[portal] link request failed:", e.message));
}));

// ── S-4: token is POST-consumed, atomically single-use ─────────────────────
app.post("/portal/:orgSlug/verify", portalLinkIpLimiter, wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  // Atomic consume: UPDATE … RETURNING wins exactly once even under a
  // parallel replay of the same link.
  const rows = await query(
    `UPDATE portal_magic_links SET used_at = NOW()
     WHERE token_hash = ? AND org_id = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
     RETURNING email`,
    [sha256hex(token), org.id]);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used. Request a fresh one." });
  const email = rows[0].email;
  const sessToken = crypto.randomBytes(32).toString("base64url");
  const maxAgeSec = 30 * 24 * 3600;
  await run(
    `INSERT INTO portal_sessions (id,org_id,email,token_hash,expires_at,ip)
     VALUES (?,?,?,?, NOW() + INTERVAL '30 days', ?)`,
    ["psn_" + uuid().slice(0, 10), org.id, email, sha256hex(sessToken), req.ip || null]);
  setPortalCookie(res, sessToken, maxAgeSec);
  const donors = await portalDonorsFor(org.id, email);
  await portalAudit(org.id, donors[0]?.id || null, email, "session_created", req);
  for (const d of donors) await portalTimeline(org.id, d.id, "Portal: donor signed in", "login");
  res.json({ ok: true });
}));

app.post("/portal/:orgSlug/logout", wrap(async (req, res) => {
  const raw = parsePortalCookies(req)[PORTAL_COOKIE];
  if (raw) await run(`UPDATE portal_sessions SET revoked_at = NOW() WHERE token_hash = ?`, [sha256hex(raw)]).catch(() => {});
  res.append("Set-Cookie", `${PORTAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));

app.get("/portal/:orgSlug/session", requirePortalSession, wrap(async (req, res) => {
  res.json({ email: req.portal.email });
}));

// ── §3 — the dashboard: every figure from the SAME gifts ledger the CRM
//    reports read (org-scoped, live SUMs; no parallel computation) ──────────
app.get("/portal/:orgSlug/me", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  if (!donors.length) return res.json({ email, theme: portalThemePayload(org), empty: true });
  const donorIds = donors.map(d => d.id);

  const [byYearRows, totalsRow, gifts, receipts, recurring, pledges, household] = await Promise.all([
    query(
      `SELECT LEFT(date, 4) AS year, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count
       FROM gifts WHERE org_id = ? AND donor_id = ANY(?) GROUP BY LEFT(date, 4) ORDER BY year DESC`,
      [org.id, donorIds]),
    query(
      `SELECT COALESCE(SUM(amount),0) AS lifetime, COUNT(*)::int AS count,
              MIN(date) AS first_gift, MAX(amount) AS largest
       FROM gifts WHERE org_id = ? AND donor_id = ANY(?)`,
      [org.id, donorIds]),
    query(
      `SELECT g.id, g.date, g.amount, g.type, COALESCE(c.name, g.campaign) AS campaign,
              f.name AS fund, g.stripe_payment_id IS NOT NULL AS online,
              r.id AS receipt_id, r.receipt_number
       FROM gifts g
       LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
       LEFT JOIN receipts r ON r.gift_id = g.id AND r.org_id = g.org_id AND r.voided_at IS NULL AND r.type = 'gift'
       WHERE g.org_id = ? AND g.donor_id = ANY(?)
       ORDER BY g.date DESC, g.id DESC LIMIT 500`,
      [org.id, donorIds]),
    query(
      `SELECT id, type, receipt_number, amount, tax_year, created_at, gift_id
       FROM receipts WHERE org_id = ? AND donor_id = ANY(?) AND voided_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
      [org.id, donorIds]),
    query(
      `SELECT id, donor_id, amount, interval, status, failure_count, paused_at, resume_at,
              canceled_at, stripe_subscription_id, created_at
       FROM recurring_subscriptions WHERE org_id = ? AND donor_id = ANY(?) ORDER BY created_at DESC`,
      [org.id, donorIds]),
    query(
      `SELECT p.id, p.amount, p.due_date, p.status, p.notes,
              COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance
       FROM pledges p
       LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp
         ON pp.pledge_id = p.id
       WHERE p.org_id = ? AND p.donor_id = ANY(?) ORDER BY p.due_date ASC`,
      [org.id, org.id, donorIds]),
    (async () => {
      // P-6 — household/soft-credit renders in a SEPARATE labeled section:
      // the family's combined giving, never mixed into the donor's own totals.
      const hhIds = [...new Set(donors.map(d => d.household_id).filter(Boolean))];
      if (!hhIds.length) return null;
      const [hh] = await query(`SELECT id, name FROM households WHERE id = ? AND org_id = ?`, [hhIds[0], org.id]);
      if (!hh) return null;
      const [sum] = await query(
        `SELECT COALESCE(SUM(g.amount),0) AS combined
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         WHERE g.org_id = ? AND d.household_id = ? AND d.deleted_at IS NULL`,
        [org.id, hh.id]);
      return { name: hh.name, combined: parseFloat(sum.combined) || 0 };
    })(),
  ]);

  // Stripe display details (card last-4, next charge) — display-only, and the
  // dashboard degrades gracefully when Stripe is unreachable.
  const recurringOut = [];
  for (const s of recurring) {
    let last4 = null, nextCharge = null;
    if (stripe && org.stripe_account_id && ["active", "past_due", "recovering", "recovered", "paused"].includes(s.status)) {
      try {
        const sub = await stripe.subscriptions.retrieve(s.stripe_subscription_id,
          { expand: ["default_payment_method"] }, { stripeAccount: org.stripe_account_id });
        last4 = sub.default_payment_method?.card?.last4 || null;
        if (sub.current_period_end && !["canceled", "paused"].includes(s.status)) {
          nextCharge = new Date(sub.current_period_end * 1000).toISOString().slice(0, 10);
        }
      } catch { /* display-only — omit */ }
    }
    recurringOut.push({
      id: s.id, amount: parseFloat(s.amount) || 0, interval: s.interval || "month",
      status: s.status, pausedAt: s.paused_at, resumeAt: s.resume_at, canceledAt: s.canceled_at,
      cardLast4: last4, nextChargeDate: nextCharge,
      paymentHistory: gifts.filter(g => g.online).slice(0, 12)
        .map(g => ({ date: g.date, amount: parseFloat(g.amount) || 0 })),
    });
  }

  const t = totalsRow[0] || {};
  const nowYear = String(new Date().getFullYear());
  const byYear = byYearRows.map(r => ({ year: r.year, total: parseFloat(r.total) || 0, count: r.count }));
  await portalAudit(org.id, donorIds[0], email, "dashboard_viewed", req);
  res.json({
    email,
    theme: portalThemePayload(org),
    donorName: displayNameCase(donors[0].name),
    giving: {
      ytd: byYear.find(y => y.year === nowYear)?.total || 0,
      byYear,
      lifetime: parseFloat(t.lifetime) || 0,
      giftCount: t.count || 0,
      firstGiftDate: t.first_gift || null,
      largestGift: parseFloat(t.largest) || 0,
    },
    gifts: gifts.map(g => ({
      id: g.id, date: g.date, amount: parseFloat(g.amount) || 0, type: g.type,
      campaign: g.campaign || null, fund: g.fund || null, online: g.online === true,
      receiptId: g.receipt_id || null, receiptNumber: g.receipt_number || null,
    })),
    receipts: receipts.map(r => ({
      id: r.id, type: r.type, number: r.receipt_number, amount: parseFloat(r.amount) || 0,
      taxYear: r.tax_year, date: r.created_at,
    })),
    recurring: recurringOut,
    pledges: pledges.map(p => ({
      id: p.id, amount: parseFloat(p.amount) || 0, dueDate: p.due_date, status: p.status,
      paid: parseFloat(p.paid_amount) || 0, balance: parseFloat(p.balance) || 0,
    })),
    household,
    impact: await matchImpactUpdates(org.id, donorIds),
  });
}));

// ── §6.2 — deterministic impact matching over EXISTING gift attribution ────
async function matchImpactUpdates(orgId, donorIds) {
  const updates = await query(
    `SELECT id, title, body, photos, targets, org_wide, created_at
     FROM impact_updates WHERE org_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 50`, [orgId]);
  if (!updates.length) return [];
  const attrib = await query(
    `SELECT DISTINCT fund_id, campaign_id FROM gifts
     WHERE org_id = ? AND donor_id = ANY(?) AND date >= (CURRENT_DATE - INTERVAL '24 months')::text`,
    [orgId, donorIds]);
  const funds = new Set(attrib.map(a => a.fund_id).filter(Boolean));
  const camps = new Set(attrib.map(a => a.campaign_id).filter(Boolean));
  const targeted = [], orgWide = [];
  for (const u of updates) {
    const targets = Array.isArray(u.targets) ? u.targets : [];
    const hit = targets.some(tg => (tg.kind === "fund" && funds.has(tg.id)) || (tg.kind === "campaign" && camps.has(tg.id)));
    const row = { id: u.id, title: u.title, body: u.body, photos: Array.isArray(u.photos) ? u.photos : [], date: u.created_at, matched: hit };
    if (hit) targeted.push(row);
    else if (u.org_wide) orgWide.push(row);
  }
  return [...targeted, ...orgWide].slice(0, 12);
}

// Engagement signal: viewed an impact update — timeline only, never an alert.
app.post("/portal/:orgSlug/impact/:updateId/viewed", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const [u] = await query(`SELECT id, title FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.updateId, org.id]);
  if (!u) return res.status(404).json({ error: "not_found" });
  const donors = await portalDonorsFor(org.id, email);
  for (const d of donors) await portalTimeline(org.id, d.id, `Portal: viewed impact update — ${u.title}`, "impact_view");
  res.json({ ok: true });
}));

// ── S-9 — receipts stream the EXISTING stored PDF, session-scoped ──────────
app.get("/portal/:orgSlug/receipts/:id/pdf", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  const donorIds = donors.map(d => d.id);
  const [r] = await query(
    `SELECT * FROM receipts WHERE id = ? AND org_id = ? AND donor_id = ANY(?) AND voided_at IS NULL`,
    [req.params.id, org.id, donorIds.length ? donorIds : [""]]);
  if (!r || !r.pdf_data) return res.status(404).json({ error: "not_found" });
  await portalAudit(org.id, r.donor_id, email, "receipt_downloaded", req, { receiptId: r.id });
  const buf = Buffer.from(r.pdf_data, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="receipt-${r.receipt_number || r.id}.pdf"`);
  res.send(buf);
}));

// ── §4 — recurring self-service. Every mutation is a D-series money path:
//    Stripe-FIRST (if Stripe fails the mutation fails — Steward must never
//    claim a schedule changed while Stripe keeps charging), serialized per
//    subscription (R-7), audit-logged, confirmed by email, mirrored into the
//    CRM timeline, drift-wired to the org (§6.3). ─────────────────────────
async function portalOwnedSub(req) {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  const donorIds = donors.map(d => d.id);
  if (!donorIds.length) return { error: 404 };
  const [sub] = await query(
    `SELECT * FROM recurring_subscriptions WHERE id = ? AND org_id = ? AND donor_id = ANY(?)`,
    [req.params.subId, org.id, donorIds]);
  if (!sub) return { error: 404 }; // foreign/unknown → indistinguishable 404 (S-2)
  const donor = donors.find(d => d.id === sub.donor_id) || donors[0];
  return { sub, donor };
}

// R-2 — pause (optional auto-resume date). Stripe pause_collection produces
// zero charges while paused; dunning already excludes non-past_due statuses.
app.post("/portal/:orgSlug/recurring/:subId/pause", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  let resumeAt = null;
  if (req.body?.resumeDate) {
    const d = new Date(String(req.body.resumeDate));
    if (isNaN(d) || d <= new Date() || d > new Date(Date.now() + 366 * 86400e3)) {
      return res.status(400).json({ error: "bad_resume_date", message: "Resume date must be in the next 12 months." });
    }
    resumeAt = d;
  }
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || !["active", "recovered", "past_due", "recovering"].includes(cur.status)) {
      return res.status(409).json({ error: "not_pausable", message: "This gift can't be paused in its current state." });
    }
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      pause_collection: { behavior: "void", ...(resumeAt ? { resumes_at: Math.floor(resumeAt.getTime() / 1000) } : {}) },
    }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='paused', paused_at=NOW(), resume_at=?, next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [resumeAt, sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_pause", req, { subId: sub.id, resumeAt });
    await portalTimeline(org.id, donor.id, `Portal: paused their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${resumeAt ? ` until ${resumeAt.toISOString().slice(0, 10)}` : ""}`, "recurring_pause");
    portalDriftAlert(org, donor, sub, "recurring_pause", resumeAt ? `auto-resumes ${resumeAt.toISOString().slice(0, 10)}` : "no resume date set").catch(() => {});
    sendPortalMutationEmail(org, email, "Your recurring gift is paused",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is paused${resumeAt ? ` and will resume automatically on ${resumeAt.toISOString().slice(0, 10)}` : ""}. No charges will occur while paused.`).catch(() => {});
    res.json({ ok: true, status: "paused", resumeAt });
  });
}));

// R-3 — resume (explicit; Stripe-side auto-resume also lands here via webhook).
app.post("/portal/:orgSlug/recurring/:subId/resume", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || cur.status !== "paused") return res.status(409).json({ error: "not_paused" });
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: "" }, { stripeAccount: org.stripe_account_id });
    await run(`UPDATE recurring_subscriptions SET status='active', paused_at=NULL, resume_at=NULL, updated_at=NOW() WHERE id=?`, [sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_resume", req, { subId: sub.id });
    await portalTimeline(org.id, donor.id, `Portal: resumed their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift`, "recurring_resume");
    sendPortalMutationEmail(org, email, "Your recurring gift has resumed",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is active again. Thank you for your continued support.`).catch(() => {});
    res.json({ ok: true, status: "active" });
  });
}));

// R-1 — change amount. Server re-prices authoritatively: integer minor units
// end-to-end, floored at the org's configured minimum; effective next charge
// (proration_behavior none — no proration in v1).
app.post("/portal/:orgSlug/recurring/:subId/amount", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  const cents = Number(req.body?.amountCents);
  const minCents = Number(org.min_recurring_cents) || 500;
  if (!Number.isInteger(cents) || cents < minCents || cents > 10000000) {
    return res.status(400).json({ error: "bad_amount", message: `Amount must be at least $${(minCents / 100).toFixed(2)}.` });
  }
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status, amount FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || !["active", "recovered", "paused"].includes(cur.status)) {
      return res.status(409).json({ error: "not_editable", message: "This gift can't be changed in its current state." });
    }
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {}, { stripeAccount: org.stripe_account_id });
    const item = stripeSub.items?.data?.[0];
    if (!item) return res.status(409).json({ error: "not_editable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: item.id, price_data: {
        currency: item.price?.currency || "usd",
        product_data: { name: `${displayNameCase(org.name)} recurring gift` },
        recurring: { interval: (sub.interval === "year" ? "year" : "month") },
        unit_amount: cents,
      } }],
      proration_behavior: "none",
    }, { stripeAccount: org.stripe_account_id });
    const oldAmt = parseFloat(cur.amount) || 0;
    const newAmt = cents / 100;
    await run(`UPDATE recurring_subscriptions SET amount=?, updated_at=NOW() WHERE id=?`, [newAmt, sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_amount", req, { subId: sub.id, from: oldAmt, to: newAmt });
    await portalTimeline(org.id, donor.id, `Portal: changed their recurring gift from $${oldAmt.toLocaleString()} to $${newAmt.toLocaleString()}/${sub.interval || "month"}`, "recurring_amount");
    sendPortalMutationEmail(org, email, "Your recurring gift amount changed",
      `Your recurring gift is now $${newAmt.toLocaleString()}/${sub.interval || "month"} (was $${oldAmt.toLocaleString()}). The new amount takes effect on your next scheduled charge.`).catch(() => {});
    res.json({ ok: true, amount: newAmt });
  });
}));

// R-4 — cancel. One optional, skippable reason; NO retention dark patterns.
// The org hears about it in minutes (§6.3) — that is the retention mechanism.
app.post("/portal/:orgSlug/recurring/:subId/cancel", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || cur.status === "canceled") return res.status(409).json({ error: "already_canceled" });
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='canceled', canceled_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [sub.id]);
    await run(`UPDATE donors SET stripe_subscription_status='canceled', updated_at=NOW() WHERE id=? AND org_id=?`, [donor.id, org.id]).catch(() => {});
    await portalAudit(org.id, donor.id, email, "recurring_cancel", req, { subId: sub.id, reason });
    await portalTimeline(org.id, donor.id, `Portal: canceled their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${reason ? ` — reason: ${reason}` : ""}`, "recurring_cancel");
    portalDriftAlert(org, donor, sub, "recurring_cancel", reason).catch(() => {});
    sendPortalMutationEmail(org, email, "Your recurring gift is canceled",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is canceled. You won't be charged again. Thank you for everything you've given.`).catch(() => {});
    res.json({ ok: true, status: "canceled" });
  });
}));

// R-5 — update payment method: the EXISTING setup-mode Checkout flow (card
// data never touches Steward). Returns the signed card-update URL.
app.post("/portal/:orgSlug/recurring/:subId/update-card", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  await portalAudit(org.id, donor.id, email, "card_update_started", req, { subId: sub.id });
  res.json({ url: buildCardUpdateUrl(sub.stripe_subscription_id, org.id) });
}));

// ══ Staff-side portal admin (portal settings + impact updates) ═════════════
// Org admins configure the portal in the existing CRM (staff JWT auth — the
// OTHER side of the P-4 wall).

app.get("/portal-settings", requireAuth, wrap(async (req, res) => {
  await run(`INSERT INTO portal_settings (org_id) VALUES (?) ON CONFLICT (org_id) DO NOTHING`, [req.user.orgId]);
  const [ps] = await query(`SELECT * FROM portal_settings WHERE org_id = ?`, [req.user.orgId]);
  const [org] = await query(`SELECT org_slug FROM orgs WHERE id = ?`, [req.user.orgId]);
  res.json({ ...ps, org_slug: org?.org_slug || null, portal_url: `${publicAppUrl()}/portal/${org?.org_slug}` });
}));

const PORTAL_IMG_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
function validPortalImage(dataUri, capBytes) {
  if (dataUri == null || dataUri === "") return true;
  if (typeof dataUri !== "string" || dataUri.length > capBytes) return false;
  const m = dataUri.match(/^data:([^;]+);base64,/);
  return !!m && PORTAL_IMG_MIMES.includes(m[1]);
}

app.put("/portal-settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  await run(`INSERT INTO portal_settings (org_id) VALUES (?) ON CONFLICT (org_id) DO NOTHING`, [req.user.orgId]);
  const updates = [], params = [];
  const setStr = (col, v, cap) => { updates.push(`${col} = ?`); params.push(v == null || v === "" ? null : String(v).slice(0, cap)); };
  let adjusted = false;
  if (b.enabled !== undefined) { updates.push("enabled = ?"); params.push(b.enabled === true); }
  if (b.poweredBy !== undefined) { updates.push("powered_by = ?"); params.push(b.poweredBy === true); }
  if (b.displayName !== undefined) setStr("display_name", b.displayName, 120);
  if (b.footerText !== undefined) setStr("footer_text", b.footerText, 500);
  if (b.contactEmail !== undefined) setStr("contact_email", b.contactEmail, 200);
  if (b.einLine !== undefined) setStr("ein_line", b.einLine, 200);
  if (b.minRecurringCents !== undefined) {
    const c = Number(b.minRecurringCents);
    if (!Number.isInteger(c) || c < 100 || c > 1000000) return res.status(400).json({ error: "bad_min" });
    updates.push("min_recurring_cents = ?"); params.push(c);
  }
  // §5 contrast guard — the ONE normalizeAccent implementation (branding.js):
  // an illegible brand color is deepened along its own hue to WCAG AA, and the
  // admin is told why, rather than shipping an unreadable portal.
  for (const [key, col] of [["primaryColor", "primary_color"], ["accentColor", "accent_color"]]) {
    if (b[key] !== undefined) {
      if (b[key] === "" || b[key] == null) { updates.push(`${col} = NULL`); continue; }
      const norm = normalizeAccent(String(b[key]));
      if (!norm) return res.status(400).json({ error: "bad_color", message: `${key} is not a valid hex color.` });
      if (norm.adjusted) adjusted = true;
      updates.push(`${col} = ?`); params.push(norm.accent);
    }
  }
  for (const [key, col] of [["logoData", "logo_data"], ["headerImageData", "header_image_data"]]) {
    if (b[key] !== undefined) {
      if (!validPortalImage(b[key], 500000)) return res.status(400).json({ error: "bad_image", message: "Images must be PNG/JPEG/GIF/WebP/SVG under ~350KB." });
      updates.push(`${col} = ?`); params.push(b[key] || null);
    }
  }
  if (updates.length) {
    updates.push("updated_at = NOW()");
    await run(`UPDATE portal_settings SET ${updates.join(", ")} WHERE org_id = ?`, [...params, req.user.orgId]);
  }
  const [ps] = await query(`SELECT * FROM portal_settings WHERE org_id = ?`, [req.user.orgId]);
  res.json({ ...ps, adjusted, ...(adjusted ? { message: "Your color was deepened slightly so text stays readable (WCAG AA)." } : {}) });
}));

// Impact Updates CRUD (§6.1) — same upload validation + org-scoping rules.
app.get("/impact-updates", requireAuth, wrap(async (req, res) => {
  res.json(await query(`SELECT * FROM impact_updates WHERE org_id = ? ORDER BY created_at DESC`, [req.user.orgId]));
}));

async function validImpactTargets(targets, orgId) {
  if (targets === undefined) return [];
  if (!Array.isArray(targets) || targets.length > 20) return null;
  const out = [];
  for (const t of targets) {
    if (!t || typeof t !== "object") return null;
    if (t.kind === "fund") {
      if (!(await orgOwns("fin_funds", t.id, orgId))) return null;
    } else if (t.kind === "campaign") {
      if (!(await orgOwns("campaigns", t.id, orgId))) return null;
    } else return null;
    out.push({ kind: t.kind, id: t.id });
  }
  return out;
}

app.post("/impact-updates", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: "title_required" });
  const body = String(b.body || "").slice(0, 20000);
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 4) : [];
  for (const p of photos) if (!validPortalImage(p, 500000)) return res.status(400).json({ error: "bad_image" });
  const targets = await validImpactTargets(b.targets, req.user.orgId);
  if (targets === null) return res.status(404).json({ error: "bad_targets", message: "Each target must be a fund or campaign in your organization." });
  const id = "imp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO impact_updates (id,org_id,title,body,photos,targets,org_wide,status,created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, title, body, JSON.stringify(photos), JSON.stringify(targets),
     b.orgWide === true || targets.length === 0, b.status === "draft" ? "draft" : "published", req.user.userId]);
  res.status(201).json((await query(`SELECT * FROM impact_updates WHERE id = ?`, [id]))[0]);
}));

app.put("/impact-updates/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [ex] = await query(`SELECT * FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!ex) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title || "").trim().slice(0, 200) : ex.title;
  if (!title) return res.status(400).json({ error: "title_required" });
  const body = b.body !== undefined ? String(b.body || "").slice(0, 20000) : ex.body;
  let photos = ex.photos;
  if (b.photos !== undefined) {
    photos = Array.isArray(b.photos) ? b.photos.slice(0, 4) : [];
    for (const p of photos) if (!validPortalImage(p, 500000)) return res.status(400).json({ error: "bad_image" });
  }
  let targets = ex.targets;
  if (b.targets !== undefined) {
    targets = await validImpactTargets(b.targets, req.user.orgId);
    if (targets === null) return res.status(404).json({ error: "bad_targets" });
  }
  await run(
    `UPDATE impact_updates SET title=?, body=?, photos=?, targets=?, org_wide=?, status=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [title, body, JSON.stringify(photos), JSON.stringify(targets),
     b.orgWide !== undefined ? b.orgWide === true : ex.org_wide,
     b.status !== undefined ? (b.status === "draft" ? "draft" : "published") : ex.status,
     req.params.id, req.user.orgId]);
  res.json((await query(`SELECT * FROM impact_updates WHERE id = ?`, [req.params.id]))[0]);
}));

app.delete("/impact-updates/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const result = await run(`DELETE FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!result.changes) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
}));

// Staff read of the portal audit trail (P-7 visibility).
app.get("/portal-audit", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await query(
    `SELECT * FROM portal_audit_log WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`, [req.user.orgId]));
}));


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

// Run sequence engine on startup (5s delay) then every hour
setTimeout(() => {
  processSequences().catch(console.error);
  autoEnroll().catch(console.error);
}, 5000);
setInterval(() => {
  processSequences().catch(console.error);
  autoEnroll().catch(console.error);
}, 60 * 60 * 1000);

// Run Gmail sync on startup (10s delay) then every 15 min
setTimeout(() => syncAllGmail().catch(console.error), 10000);
setInterval(() => syncAllGmail().catch(console.error), 15 * 60 * 1000);

// Check trial expiry on startup (15s delay) then every 6 hours
async function checkTrialExpiry() {
  try {
    await run(
      `UPDATE orgs SET subscription_status = 'trial_expired' WHERE subscription_status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`,
      []
    );
  } catch (e) { console.error("checkTrialExpiry error:", e); }
}
setTimeout(() => checkTrialExpiry(), 15000);
setInterval(() => checkTrialExpiry(), 6 * 60 * 60 * 1000);

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
const SECTOR_AVG_RETENTION_RATE = 43;

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
async function computeRetentionRate(orgId, { year = new Date().getFullYear(), gifts, userId } = {}) {
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
  const thisYearGifts = allGifts.filter(g => new Date(g.date).getFullYear() === year);
  const prevYearGifts = allGifts.filter(g => new Date(g.date).getFullYear() === prevYear);
  const thisYearDonorIds = new Set(thisYearGifts.map(g => g.donor_id));
  const prevYearDonorIds = new Set(prevYearGifts.map(g => g.donor_id));
  const retained = [...thisYearDonorIds].filter(id => prevYearDonorIds.has(id)).length;
  const retentionRate = prevYearDonorIds.size > 0 ? Math.round(retained / prevYearDonorIds.size * 100) : null;
  return {
    retentionRate, retained,
    thisYearDonorIds, prevYearDonorIds,
    thisYearCount: thisYearDonorIds.size, prevYearCount: prevYearDonorIds.size,
    year, prevYear,
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
  const { retentionRate } = await computeRetentionRate(orgId);
  if (retentionRate != null) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      ["ms_" + uuid().slice(0, 8), orgId, "retention_rate", retentionRate, today]
    );
  }
  return debt;
}

async function snapshotAllOrgMetrics() {
  try {
    const orgs = await query("SELECT id FROM orgs", []);
    for (const o of orgs) {
      try { await snapshotMetricsForOrg(o.id); } catch (e) { console.error(`[metrics] snapshot failed for org ${o.id}:`, e.message); }
    }
  } catch (e) { console.error("[metrics] snapshotAllOrgMetrics error:", e.message); }
}
setTimeout(() => snapshotAllOrgMetrics(), 20000);
setInterval(() => snapshotAllOrgMetrics(), 6 * 60 * 60 * 1000);

module.exports = app;
