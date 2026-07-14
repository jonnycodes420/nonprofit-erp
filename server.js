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
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const { getDb, query, run, uuid, seedOrgData, withTransaction, queryTx, runTx } = require("./db");
const { signToken, requireAuth, requireSuperAdmin } = require("./auth");
const Stripe = require("stripe");
const { google } = require("googleapis");
const { Webhook: SvixWebhook } = require("svix");

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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
app.use(cors({ origin: corsOrigins }));

// ── Rate limiting ────────────────────────────────────────────────────────
// Shared 429 handler: explicit Retry-After header + a body shape that can't be
// mistaken for a generic error (client code can key off error === "rate_limited").
function rateLimitHandler(req, res) {
  const resetMs = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 60000;
  res.set("Retry-After", String(Math.max(1, Math.ceil(resetMs / 1000))));
  res.status(429).json({ error: "rate_limited", message: "Too many requests. Please try again later." });
}

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
  skip: (req) => req.path === "/health" || req.path === "/stripe/webhook" || req.path === "/billing/webhook",
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
});
// Per-account+IP: stops repeated brute force against one specific account.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").toLowerCase()}`,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const donateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
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
      const campaignId = pi.metadata?.campaign_id || null;
      const donorName = pi.metadata?.donor_name || "";

      if (email && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.length) {
          const orgId = orgRow[0].id;
          let donorRow = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
          if (!donorRow.length && donorName) {
            const newDonorId = "d_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count)
               VALUES ($1,$2,$3,$4,'active','steward',0,0)`,
              [newDonorId, orgId, donorName, email.toLowerCase()]
            );
            donorRow = [{ id: newDonorId }];
          }
          if (donorRow.length) {
            const donorId = donorRow[0].id;
            const giftId = "g_" + uuid().slice(0, 8);
            const today = new Date().toISOString().slice(0, 10);
            // Check if donor was lapsed before updating stage
            const donorPreRow = await query("SELECT stage FROM donors WHERE id=$1", [donorId]);
            const wasLapsed = donorPreRow[0]?.stage === 'lapsed';
            await run(
              `INSERT INTO gifts (id, org_id, donor_id, amount, date, notes, stripe_payment_id, campaign_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [giftId, orgId, donorId, amount, today, "Online payment via Stripe", pi.id, campaignId]
            );
            await run(
              `UPDATE donors SET
                 total_giving = total_giving + $1,
                 gift_count = gift_count + 1,
                 last_gift_date = GREATEST(COALESCE(last_gift_date,'0001-01-01')::date, $2::date)::text,
                 last_gift_amount = CASE WHEN ($2::date >= COALESCE(last_gift_date,'0001-01-01')::date) THEN $3 ELSE last_gift_amount END,
                 stage = CASE WHEN stage = 'lapsed' THEN 'qualify' WHEN stage IN ('prospect','cultivate') THEN 'steward' ELSE stage END
               WHERE id = $4`,
              [amount, today, amount, donorId]
            );
            // Log gift interaction
            await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'gift',$4,$5)",
              ["i_"+uuid().slice(0,8), orgId, donorId, `Online donation: $${amount} via Steward Giving Page`, today]
            ).catch(()=>{});
            // Re-engagement task for previously lapsed donors
            if (wasLapsed) {
              await run(
                "INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES ($1,$2,$3,'high',false,$4)",
                ["t_"+uuid().slice(0,8), orgId, `Re-engaged via online gift — follow up with ${donorName||email} within 48 hours`,
                 new Date(Date.now()+2*24*60*60*1000).toISOString().slice(0,10)]
              ).catch(()=>{});
            }
            const acctRow = await query("SELECT id FROM accounts WHERE org_id=$1 AND code='4010' LIMIT 1", [orgId]);
            const genFundRow = await query("SELECT id FROM fin_funds WHERE org_id=$1 AND restricted=false ORDER BY created_at ASC LIMIT 1", [orgId]);
            if (acctRow.length) {
              const txnId = "ft_" + uuid().slice(0, 8);
              await run(
                "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id) VALUES (?,?,?,?,?,?,?,?,?)",
                [txnId, orgId, today, "Online gift via Stripe", donorName || email, amount, "income", acctRow[0].id, genFundRow.length ? genFundRow[0].id : null]
              );
            }
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at)
               VALUES ($1,$2,$3,$4,$5,NOW())`,
              [taskId, orgId, `Send personal thank-you to ${donorName || email} for $${amount} online gift`, "high", false]
            );
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
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at) VALUES ($1,$2,$3,'high',false,NOW())`,
              [taskId, orgId, `Welcome ${donorName} as a ${frequency} recurring donor — send personal thank-you`]
            );
            // Health record for the failed-payment recovery system — created
            // 'active' up front so every recurring gift has one from day one,
            // not just the ones that eventually fail (see recurring_subscriptions
            // in CLAUDE.md). ON CONFLICT covers a redelivered webhook.
            const recurAmount = session.amount_total != null ? session.amount_total / 100 : null;
            await run(
              `INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount, interval, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
               ON CONFLICT (stripe_subscription_id) DO NOTHING`,
              ["rsub_" + uuid().slice(0, 8), orgId, donorId, session.subscription, session.customer || null, recurAmount, frequency === "annual" ? "year" : "month"]
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
        }
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      if (inv.subscription && !(await recoveryEventAlreadyProcessed(event.id))) {
        const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [inv.subscription]);
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
            await logRecoveryEvent(rs.org_id, rs.donor_id, sub.id, "payment_recovered", event.id, { source: "subscription.updated" });
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
app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.metadata?.orgId) {
        let periodEnd = null;
        if (session.subscription && stripe) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
          } catch {}
        }
        await run(
          "UPDATE orgs SET plan=?, subscription_status='active', stripe_subscription_id=?, current_period_end=?, grace_until=NULL WHERE id=?",
          [session.metadata.plan || "growth", session.subscription, periodEnd, session.metadata.orgId]
        );
      }
    } else if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      const orgRow = await query("SELECT id FROM orgs WHERE stripe_customer_id=?", [inv.customer]);
      if (orgRow.length) {
        const periodEnd = inv.lines?.data?.[0]?.period?.end
          ? new Date(inv.lines.data[0].period.end * 1000).toISOString()
          : null;
        await run(
          "UPDATE orgs SET subscription_status='active', current_period_end=?, grace_until=NULL WHERE id=?",
          [periodEnd, orgRow[0].id]
        );
      }
    } else if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      const orgRow = await query("SELECT id FROM orgs WHERE stripe_customer_id=?", [inv.customer]);
      if (orgRow.length) {
        await run(
          "UPDATE orgs SET subscription_status='past_due', grace_until=NOW() + INTERVAL '7 days' WHERE id=?",
          [orgRow[0].id]
        );
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const orgId = sub.metadata?.orgId;
      if (orgId) {
        await run(
          "UPDATE orgs SET subscription_status='canceled', plan='trial', grace_until=NOW() + INTERVAL '3 days' WHERE id=?",
          [orgId]
        );
      }
    }
  } catch (err) {
    console.error("Billing webhook error:", err);
  }

  res.json({ received: true });
});

app.use(express.json({ limit: "5mb" }));

// ── DB readiness guard ─────────────────────────────────────────────────────
let dbReady = false;
getDb()
  .then(() => { dbReady = true; console.log("✅ Database ready"); })
  .catch(err => { console.error("❌ Database init failed:", err); process.exit(1); });

app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: "Database initializing" });
  next();
});

// ── Async error wrapper ────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Admin guard ────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
};

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.1.0", db: dbReady });
});

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

// ── Donor summary recalculation ────────────────────────────────────────────
// Recomputes total_giving, gift_count, last_gift_date, last_gift_amount
// from the gifts table (source of truth). Replace delta adjustments on
// edit/delete with this — it's correct even after complex edits.
// Note: amounts stored as INTEGER (whole dollars, no cents). If sub-dollar
// precision is ever needed, gifts.amount and donors.total_giving would need
// a schema migration to NUMERIC.
async function recalcDonorSummary(donorId, orgId) {
  const agg = await query(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt, MAX(date) AS last_date
     FROM gifts WHERE donor_id=? AND org_id=?`,
    [donorId, orgId]
  );
  const total    = parseInt(agg[0].total, 10) || 0;
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
    lastAmt = parseInt(lr[0]?.amount, 10) || 0;
  }

  await run(
    `UPDATE donors
     SET total_giving=?, gift_count=?, last_gift_date=?, last_gift_amount=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [total, cnt, lastDate, lastAmt, donorId, orgId]
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
  await run("INSERT INTO orgs (id, name, mission, ein, onboarding_complete, org_slug) VALUES (?,?,?,?,0,?)",
    [orgId, orgName, orgMission || "", ein || "", orgSlug]);
  const hash = bcrypt.hashSync(password, 12);
  await run("INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, orgId, normalizedEmail, hash, name || email, "admin"]);

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

  const frontendUrl = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
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
        <!-- Header -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <table cellpadding="0" cellspacing="0" style="display:inline-flex;align-items:center;gap:8px;margin:0 auto;">
            <tr>
              <td style="width:32px;height:32px;background:#0f1a12;border-radius:9px;text-align:center;vertical-align:middle;">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;">
                  <path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" stroke-width="1.5" fill="none"/>
                  <circle cx="8" cy="8" r="2" fill="#f0ede6"/>
                </svg>
              </td>
              <td style="padding-left:8px;font-size:17px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</td>
            </tr>
          </table>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;line-height:1.2;">Reset your password</h1>
          <p style="margin:0 0 28px;font-size:15px;color:#6b7c72;line-height:1.6;">Click the button below to reset your password. This link expires in <strong style="color:#0f1a12;">1 hour</strong>.</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="border-radius:10px;background:#10b981;">
              <a href="${resetLink}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;">Reset Password →</a>
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
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
  if (stripe) {
    try {
      const customer = await stripe.customers.create({
        email: normalizedEmail,
        name: orgName,
        metadata: { orgId },
      });
      stripeCustomerId = customer.id;
      await run("UPDATE orgs SET stripe_customer_id=? WHERE id=?", [stripeCustomerId, orgId]);
    } catch (err) {
      console.error("Stripe customer creation failed:", err.message);
    }
  }

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
  const users = await query("SELECT id, email, name, role FROM users WHERE id = ?", [req.user.userId]);
  const orgs  = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  if (!users.length || !orgs.length) return res.status(404).json({ error: "Not found" });
  res.json({ user: users[0], org: orgs[0] });
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

app.patch("/orgs/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (req.user.orgId !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  const { name, mission, focusArea, annualBudget, foundedYear, website } = req.body;
  // name is optional — only the new onboarding flow's "org basics" step
  // sends it (letting a fresh org tweak the name they typed at signup);
  // Settings' org-profile form never has, so it must stay opt-in rather
  // than overwriting a real org's name with null on every other caller.
  if (name && name.trim()) {
    await run(`UPDATE orgs SET name=? WHERE id=?`, [name.trim(), req.params.id]);
  }
  await run(
    `UPDATE orgs SET mission=?, focus_area=?, annual_budget=?, founded_year=?, website=? WHERE id=?`,
    [mission || null, focusArea || null, annualBudget || null, foundedYear ? parseInt(foundedYear, 10) : null, website || null, req.params.id]
  );
  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.params.id]);
  res.json(orgs[0]);
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

  const FRONTEND_URL = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
  const inviteLink = `${FRONTEND_URL}/invite/${token}`;

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
        subject: `You've been invited to join ${org.name} on Steward`,
        html: `<p>You've been invited to join <strong>${org.name}</strong> on Steward as a <strong>${validRole}</strong>.</p>
               <p><a href="${inviteLink}" style="background:#10b981;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Accept Invitation</a></p>
               <p>This link expires in 7 days.</p>`,
      });
      if (error) throw new Error(error.message);
      emailSent = true;
    } catch (err) {
      console.error("Invite email send failed:", err.message);
    }
  }

  res.json({ success: true, inviteLink, emailSent });
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
app.get("/donors", requireAuth, wrap(async (req, res) => {
  const [donors, touchpoints] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id = ? AND deleted_at IS NULL ORDER BY total_giving DESC", [req.user.orgId]),
    query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
  ]);
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  const result = donors.map(d => ({
    ...d,
    tags: JSON.parse(d.tags || "[]"),
    last_touchpoint: tpMap[d.id] || null,
  }));
  res.json(result);
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

  // ── Importer identity (assigned_to default) ──
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";

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
      params.push(
        "d_" + uuid().slice(0, 8), req.user.orgId,
        String(d.name).trim(),
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
        req.user.userId,
        importerName
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });

    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO donors
             (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
              last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name)
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

  // Email dedup (same bulk-Set approach as /donors/import)
  const existingEmailRows = await query(
    "SELECT LOWER(email) AS e FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
  );
  const existingEmails = new Set(existingEmailRows.map(r => r.e));
  const seenEmails = new Set();

  // Generate all donor IDs in JS before inserting — gifts reference these IDs directly,
  // no extra round trip needed.
  let duplicates = 0;
  const donorsToInsert = [];
  const indexToId = {}; // donorIndex → pre-generated id (only non-deduped donors)

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
  });

  // ── Bulk-insert donors (500/batch, one multi-row INSERT per batch) ──
  const DONOR_BATCH = 500;
  let created = 0;
  const batchErrors = [];
  const failedIds = new Set(); // IDs whose batch failed — drop their gifts too

  for (let bi = 0; bi < donorsToInsert.length; bi += DONOR_BATCH) {
    const batch = donorsToInsert.slice(bi, bi + DONOR_BATCH);
    const params = [];
    const tuples = batch.map(d => {
      params.push(
        d._id, orgId, String(d.name).trim(), d.email||"", d.phone||"",
        d.status||"new", d.stage||"prospect",
        Math.round(parseFloat(d.total)||0), Math.round(parseFloat(d.lastAmount)||0),
        d.lastGift||null, parseInt(d.gifts)||(d.total?1:0),
        JSON.stringify(Array.isArray(d.tags)?d.tags:[]),
        d.notes||"", d.city||null, d.state||null, importerId, importerName
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });
    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO donors
             (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
              last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name)
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

  // ── Build gift+interaction records ──
  // Filter to gifts whose donor was actually inserted (not deduped or batch-failed).
  const giftFingerprints = new Set(); // within-import dedup
  const giftsToInsert = [];
  for (const g of gifts) {
    const donorId = indexToId[g.donorIndex];
    if (!donorId || failedIds.has(donorId)) continue;
    const amt  = Math.round(Number(g.amount) || 0);
    if (amt <= 0) continue;
    const date = normalizeGiftDate(g.date);
    const fp   = `${donorId}|${amt}|${date}`;
    if (giftFingerprints.has(fp)) continue;
    giftFingerprints.add(fp);
    giftsToInsert.push({ donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", notes:g.notes||"" });
  }

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
    const giftParams = [], intParams = [], giftTuples = [], intTuples = [];
    const ftParams = [], ftTuples = [];
    batch.forEach(g => {
      const intNote = `Gift received: $${g.amount.toLocaleString()} (${g.type})${g.notes?" — "+g.notes:""}`;
      giftParams.push("g_"+uuid().slice(0,8), orgId, g.donorId, g.amount, g.date, g.type, g.campaign, null, g.notes);
      giftTuples.push("(?,?,?,?,?,?,?,?,?)");
      intParams.push("int_"+uuid().slice(0,8), orgId, g.donorId, "gift", intNote, g.date, importerId, importerName);
      intTuples.push("(?,?,?,?,?,?,?,?)");
      affectedDonorIds.add(g.donorId);
      // Accumulate fin_transactions for current-FY gifts — same shape as single-gift route
      if (contribAcctId && g.date >= fyStart) {
        const dName = donorNameMap[g.donorId] || "Donor";
        ftParams.push("ft_"+uuid().slice(0,8), orgId, g.date,
          `Gift from ${dName}`, dName, g.amount, "income", contribAcctId, genFundId);
        ftTuples.push("(?,?,?,?,?,?,?,?,?)");
      }
    });
    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id,notes) VALUES ${giftTuples.join(",")}`,
          giftParams
        );
        await runTx(client,
          `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ${intTuples.join(",")}`,
          intParams
        );
        // One bulk INSERT for FY fin_transactions — same tx as gifts, rolls back together
        if (ftTuples.length) {
          await runTx(client,
            `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id)
             VALUES ${ftTuples.join(",")}`,
            ftParams
          );
        }
      });
      giftsInserted += batch.length;
      financeSynced += ftTuples.length;
    } catch (e) {
      console.error(`[combined-import] gift batch ${bi}–${bi+batch.length} failed:`, e.message);
      batchErrors.push({ error: e.message });
    }
  }

  // recalcDonorSummary for every donor that had gifts inserted
  for (const donorId of affectedDonorIds) {
    try { await recalcDonorSummary(donorId, orgId); }
    catch (e) { console.error(`[combined-import] recalc failed for ${donorId}:`, e.message); }
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

  // Infer pipeline stage from recalculated giving data.
  // No prospect-only guardrail here: new donors land as 'cultivate' (DB default),
  // so the guardrail would match zero rows. Combined-import only creates NEW donors —
  // no human-set stages to protect. SQL mirrors client-side inferStage() exactly,
  // including its qualify/solicit bands — see Donors.jsx's inferStage for the
  // reasoning (a donor with no gift history but an email/phone on file gets a
  // reachable path to 'qualify'; a substantial gift 90-180 days ago reads as
  // 'solicit' rather than folding into the generic 'cultivate' bucket).
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
           AND deleted_at IS NULL`,
        [orgId, [...affectedDonorIds]]
      );
    } catch (e) { console.error(`[combined-import] stage inference failed:`, e.message); }
  }

  res.json({ created, giftsInserted, duplicates, donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors });
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
  res.json(d);
}));

app.patch("/donors/:id/stage", requireAuth, wrap(async (req, res) => {
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

app.delete("/donors/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  await run("DELETE FROM donors WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  res.json({ success: true });
}));

app.patch("/donors/:id/assign", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { assignedTo, assignedToName } = req.body;
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

app.patch("/donors/bulk-stage", requireAuth, wrap(async (req, res) => {
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

app.patch("/donors/bulk-assign", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { ids, assignedTo } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!assignedTo) return res.status(400).json({ error: "assignedTo required" });

  const userRow = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [assignedTo, req.user.orgId]);
  if (!userRow.length) return res.status(400).json({ error: "User not found in your org" });
  const assignedToName = userRow[0].name;

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  const result = await run(
    "UPDATE donors SET assigned_to=?, assigned_to_name=?, updated_at=NOW() WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [assignedTo, assignedToName, ids, req.user.orgId]
  );
  res.json({ updated: result.changes });
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

// ── Gifts ──────────────────────────────────────────────────────────────────
app.post("/donors/:id/gifts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "A positive amount is required" });
  }

  const donorExists = await query(
    "SELECT id FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  const giftId = "g_" + uuid().slice(0, 8);
  const giftDate = normalizeGiftDate(date);              // enforce ISO YYYY-MM-DD
  const amt = Math.round(Number(amount));                // round, not truncate; INTEGER column

  await run(
    "INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes) VALUES (?,?,?,?,?,?,?,?)",
    [giftId, req.user.orgId, req.params.id, amt, giftDate, type || "cash", campaign || "", notes || ""]
  );
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
    if (contribAcct.length) {
      await run(
        "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id) VALUES (?,?,?,?,?,?,?,?,?)",
        ["ft_"+uuid().slice(0,8), req.user.orgId, giftDate,
         `Gift from ${donorRows[0]?.name || "Donor"}`, donorRows[0]?.name || "",
         amt, "income", contribAcct[0].id, genFund.length ? genFund[0].id : null]
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
  res.status(201).json({ gift: giftRows[0], donor: donorRows[0] });
}));

app.put("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const { amount, date, type, campaign, notes, fund_id, payment_method, acknowledgement_sent } = req.body;
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  const g = existing[0];
  const newAmt  = amount !== undefined ? Math.round(Number(amount)) : g.amount; // round, not truncate
  const newDate = date ? normalizeGiftDate(date) : g.date;                       // enforce ISO
  await run(
    `UPDATE gifts SET amount=?,date=?,type=?,campaign=?,notes=?,fund_id=?,payment_method=?,acknowledgement_sent=? WHERE id=? AND org_id=?`,
    [newAmt, newDate, type||g.type, campaign!==undefined?campaign:g.campaign,
     notes!==undefined?notes:g.notes, fund_id!==undefined?fund_id:g.fund_id,
     payment_method!==undefined?payment_method:g.payment_method,
     acknowledgement_sent!==undefined?acknowledgement_sent:g.acknowledgement_sent,
     req.params.id, req.user.orgId]
  );
  // Full recalc replaces the old delta — delta was wrong when editing a non-latest gift's amount
  await recalcDonorSummary(g.donor_id, req.user.orgId);
  const rows = await query("SELECT * FROM gifts WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Gift not found" });
  const g = existing[0];
  await run("DELETE FROM gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  // Full recalc: old delta left last_gift_date and last_gift_amount stale when deleting the most recent gift
  await recalcDonorSummary(g.donor_id, req.user.orgId);
  res.json({ ok: true });
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

  // Pre-load existing fingerprints for dedup check
  const existingRows = await query(
    "SELECT donor_id, amount, date FROM gifts WHERE org_id = ? AND donor_id = ANY(?)",
    [orgId, donorIds]
  );
  const fingerprints = new Set(existingRows.map(g => `${g.donor_id}|${g.amount}|${g.date}`));

  // Importer identity — used in interaction logged_by_name, same pattern as single-gift route
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";
  const importerId   = req.user.userId;

  let duplicates = 0, invalid = 0;
  const toInsert = [];
  for (const g of gifts) {
    if (!g.donorId || !validDonorIds.has(g.donorId)) { invalid++; continue; }
    const amt = Math.round(Number(g.amount) || 0);
    if (amt <= 0) { invalid++; continue; }
    const date = normalizeGiftDate(g.date);
    const fp   = `${g.donorId}|${amt}|${date}`;
    if (fingerprints.has(fp)) { duplicates++; continue; }
    fingerprints.add(fp); // within-import dedup
    toInsert.push({ donorId:g.donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", fund_id:g.fund_id||null, notes:g.notes||"" });
  }

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
    try {
      await withTransaction(async (client) => {
        for (const g of batch) {
          const id = "g_" + uuid().slice(0, 8);
          await runTx(client,
            "INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id,notes) VALUES (?,?,?,?,?,?,?,?,?)",
            [id, orgId, g.donorId, g.amount, g.date, g.type, g.campaign, g.fund_id, g.notes]
          );
          const intNote = `Gift received: $${g.amount.toLocaleString()} (${g.type})${g.notes ? " — " + g.notes : ""}`;
          await runTx(client,
            "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
            ["int_"+uuid().slice(0,8), orgId, g.donorId, "gift", intNote, g.date, importerId, importerName]
          );
          affectedDonorIds.add(g.donorId);
          // Accumulate fin_transactions for current-FY gifts — same shape as single-gift route
          if (contribAcctId && g.date >= fyStart) {
            const dName = donorNameMap[g.donorId] || "Donor";
            ftParams.push("ft_"+uuid().slice(0,8), orgId, g.date,
              `Gift from ${dName}`, dName, g.amount, "income", contribAcctId, genFundId);
            ftTuples.push("(?,?,?,?,?,?,?,?,?)");
          }
        }
        // One bulk INSERT for all FY fin_transactions in this batch — same tx as gifts
        if (ftTuples.length) {
          await runTx(client,
            `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id)
             VALUES ${ftTuples.join(",")}`,
            ftParams
          );
        }
      });
      inserted += batch.length;
      financeSynced += ftTuples.length;
    } catch (e) {
      console.error(`[gift-import] batch ${bi}–${bi+batch.length} failed:`, e.message);
      batchErrors.push({ error: e.message });
    }
  }

  // Recalc donor summaries — always full recalc from gifts table, never delta
  for (const donorId of affectedDonorIds) {
    try { await recalcDonorSummary(donorId, orgId); }
    catch (e) { console.error(`[gift-import] recalc failed for ${donorId}:`, e.message); }
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

  res.json({ inserted, duplicates, invalid, donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors });
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

app.post("/donors/:id/score", requireAuth, wrap(async (req, res) => {
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
app.get("/grants", requireAuth, wrap(async (req, res) => {
  const grants = await query(
    "SELECT * FROM grants WHERE org_id = ? ORDER BY deadline ASC",
    [req.user.orgId]
  );
  res.json(grants.map(g => ({ ...g, history: JSON.parse(g.history || "[]") })));
}));

app.post("/grants", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, status, deadline, reportDue, officer, notes } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  const id = "gr_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,report_due,officer,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, funder, program || "", amount || 0,
     status || "prospecting", deadline || "", reportDue || "", officer || "", notes || ""]
  );
  const rows = await query("SELECT * FROM grants WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/grants/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, received, status, deadline, reportDue, officer, notes, description, requirements } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });
  const orgId = req.user.orgId;

  // Capture previous status before update
  const prevRows = await query("SELECT status FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  const prevStatus = prevRows[0]?.status;

  const affected = await run(
    `UPDATE grants
     SET funder=?,program=?,amount=?,received=?,status=?,deadline=?,report_due=?,officer=?,notes=?,description=?,requirements=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [funder, program || "", amount || 0, received || 0, status, deadline || "",
     reportDue || "", officer || "", notes || "", description || "", requirements || "",
     req.params.id, orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Grant not found" });

  const today = new Date().toISOString().slice(0, 10);

  // Grant awarded → auto-post fin_transaction
  if (status === 'awarded' && prevStatus !== 'awarded') {
    const matchFund = await query(
      "SELECT id FROM fin_funds WHERE org_id=? AND (name ILIKE ? OR name ILIKE ?) LIMIT 1",
      [orgId, `%${funder}%`, `%${program||""}%`]
    );
    const genFund = matchFund.length ? matchFund : await query(
      "SELECT id FROM fin_funds WHERE org_id=? AND restricted=false ORDER BY created_at ASC LIMIT 1", [orgId]
    );
    const acct = await query("SELECT id FROM accounts WHERE org_id=? LIMIT 1", [orgId]);
    await run(
      "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id) VALUES (?,?,?,?,?,?,'income',?,?)",
      ["ft_"+uuid().slice(0,8), orgId, today, `Grant awarded: ${funder} — ${program||""}`, funder,
       parseFloat(amount)||0, acct[0]?.id||null, genFund[0]?.id||null]
    ).catch(() => {});
  }

  // Grant closed/rejected → follow-up task in 6 months
  if ((status === 'closed' || status === 'rejected') && prevStatus !== status) {
    const sixMonths = new Date(Date.now() + 180*24*60*60*1000).toISOString().slice(0, 10);
    await run(
      "INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES (?,?,?,'medium',false,?)",
      ["t_"+uuid().slice(0,8), orgId, `Follow up with ${funder} re: next cycle`, sixMonths]
    ).catch(() => {});
  }

  const rows = await query("SELECT * FROM grants WHERE id = ?", [req.params.id]);
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  res.json(g);
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
    await run("INSERT INTO tasks (id,org_id,title,priority,done,due) VALUES (?,?,?,'high',false,?)",
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
app.get("/tasks", requireAuth, wrap(async (req, res) => {
  const tasks = await query(
    `SELECT * FROM tasks WHERE org_id = ?
     ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due ASC`,
    [req.user.orgId]
  );
  res.json(tasks);
}));

app.post("/tasks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, donorId } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });

  const id = "t_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id) VALUES (?,?,?,?,?,?,0,?)",
    [id, req.user.orgId, title, due || "", priority || "medium", type || "donor", donorId || null]
  );
  const rows = await query("SELECT * FROM tasks WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/tasks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { title, due, priority, type, done } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });

  const affected = await run(
    "UPDATE tasks SET title=?,due=?,priority=?,type=?,done=? WHERE id=? AND org_id=?",
    [title, due || "", priority || "medium", type || "donor", done ? 1 : 0,
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Task not found" });
  const rows = await query("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
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

// ── Analytics ──────────────────────────────────────────────────────────────
app.get("/analytics", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const donors     = await query("SELECT * FROM donors     WHERE org_id = ? AND deleted_at IS NULL", [orgId]);
  const grants     = await query("SELECT * FROM grants     WHERE org_id = ?", [orgId]);
  const tasks      = await query("SELECT * FROM tasks      WHERE org_id = ?", [orgId]);
  const financials = await query("SELECT * FROM financials WHERE org_id = ?", [orgId]);

  const totalRaised   = donors.reduce((s, d) => s + d.total_giving, 0);
  const avgGift       = donors.length
    ? Math.round(donors.reduce((s, d) => s + d.last_gift_amount, 0) / donors.length)
    : 0;
  const retentionRate = donors.length
    ? Math.round(donors.filter(d => d.status !== "lapsed").length / donors.length * 100)
    : 0;

  const submittedGrants  = grants.filter(g => g.status !== "prospecting");
  const wonGrants        = grants.filter(g => ["active", "closed"].includes(g.status));
  const grantSuccessRate = submittedGrants.length
    ? Math.round(wonGrants.length / submittedGrants.length * 100)
    : 0;

  const ytdRevenue  = financials.reduce((s, m) => s + m.individual + m.grants + m.events + m.other_revenue, 0);
  const ytdExpenses = financials.reduce((s, m) => s + m.programs + m.admin + m.fundraising, 0);

  res.json({
    totalRaised, avgGift, retentionRate, grantSuccessRate, ytdRevenue, ytdExpenses,
    donorCount:       donors.length,
    lapsedCount:      donors.filter(d => d.status === "lapsed").length,
    majorDonorCount:  donors.filter(d => d.status === "major").length,
    activeGrantValue: grants.filter(g => g.status === "active").reduce((s, g) => s + g.amount, 0),
    pipelineValue:    grants.filter(g => ["pending", "prospecting"].includes(g.status)).reduce((s, g) => s + g.amount, 0),
    openTasks:        tasks.filter(t => !t.done).length,
    urgentTasks:      tasks.filter(t => !t.done && t.priority === "high").length,
  });
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
      reason: "🔥 Flagged today — AI-drafted re-engagement email ready for review",
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
    label: goal.label, goalType: goal.goal_type, goalAmount, currentAmount, percent,
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
  const backendUrl = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";
  return `${backendUrl}/unsubscribe?token=${signUnsubscribeToken(email, orgId, source)}`;
}

function unsubscribeEmailFooterHtml(email, orgId, source) {
  const url = buildUnsubscribeUrl(email, orgId, source);
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#8fa896;">
    <a href="${url}" style="color:#8fa896;text-decoration:underline;">Unsubscribe</a> from these emails.
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
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" stroke-width="1.5" fill="none"/>
          <circle cx="8" cy="8" r="2" fill="#f0ede6"/>
        </svg>
      </div>
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
  const backendUrl = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";
  return `${backendUrl}/recurring/update-card?token=${signRecoveryToken(subscriptionId, orgId)}`;
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
    .replace(/{{org_name}}/g, org.name || "")
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
  const bodyHtml = applyDunningTokens(org.recurring_dunning_body || DEFAULT_DUNNING_BODY, tokenCtx)
    + unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
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
    + unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
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
  // Sum gifts attributed to this campaign by campaign name match
  const giftSum = await query(
    `SELECT COALESCE(SUM(amount),0) as total, COUNT(DISTINCT donor_id) as donor_count FROM gifts WHERE org_id=? AND (campaign=? OR campaign_id=?)`,
    [req.user.orgId, c.name, c.id]
  );
  const raised = parseFloat(giftSum[0]?.total || 0);
  const donorCount = parseInt(giftSum[0]?.donor_count || 0);
  const daysRemaining = c.end_date ? Math.ceil((new Date(c.end_date) - new Date()) / 86400000) : null;
  res.json({
    goal: parseFloat(c.goal_amount || 0),
    raised,
    donorCount,
    daysRemaining,
    startDate: c.start_date,
    endDate: c.end_date,
    briefing: c.briefing || "",
  });
}));

app.post("/campaigns/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const BACKEND_URL = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";

  const campaigns = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });
  const campaign = campaigns[0];
  if (campaign.status === "sent") return res.status(400).json({ error: "Campaign already sent" });

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];

  const segment = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});

  let donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [req.user.orgId]
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

  // Mark as sending and respond immediately (non-blocking)
  await run("UPDATE campaigns SET status='sending', updated_at=NOW() WHERE id=?", [campaign.id]);
  res.json({ queued: true, recipientCount: donors.length });

  setImmediate(async () => {
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
          .replace(/{{org_name}}/g,     org.name)
          .replace(/{{gift_amount}}/g,  giftAmount)
          .replace(/{{total_giving}}/g, totalGiving)
          .replace(/{{year}}/g,         year);

        const pixel    = `<img src="${BACKEND_URL}/track/${recipientId}/open.gif" width="1" height="1" style="display:none">`;
        const footer   = unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
        const htmlFull = bodyHtml + footer + pixel;
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
  });
}));

// ── Tracking pixel (no auth) ───────────────────────────────────────────────
app.get("/track/:recipientId/open.gif", wrap(async (req, res) => {
  const { recipientId } = req.params;
  const wasAlreadyOpen = await query("SELECT opened_at FROM campaign_recipients WHERE id=?", [recipientId]);
  const alreadyOpened = wasAlreadyOpen[0]?.opened_at != null;
  await run("UPDATE campaign_recipients SET opened_at = NOW() WHERE id = ? AND opened_at IS NULL", [recipientId]);
  await run(
    `UPDATE campaigns SET open_count = open_count + 1
     WHERE id = (SELECT campaign_id FROM campaign_recipients WHERE id = ?)`,
    [recipientId]
  );

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

  const rawFrontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "https://client-five-tau-13.vercel.app";
  const frontendUrl = rawFrontendUrl.replace(/^http:\/\//i, "https://");
  console.log("[stripe/connect] frontendUrl resolved to:", frontendUrl);

  if (!frontendUrl.startsWith("https://")) {
    return res.status(500).json({ error: `Invalid FRONTEND_URL: "${frontendUrl}" — must start with https://` });
  }

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
    "SELECT id, name, mission FROM orgs WHERE org_slug = $1",
    [req.params.orgSlug]
  );
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  const funds = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = $1 ORDER BY name ASC", [org.id]);
  res.json({ org: { name: org.name, mission: org.mission, slug: req.params.orgSlug }, funds });
}));

app.post("/donate/:orgSlug", donateLimiter, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { amount, fundId, frequency, firstName, lastName, email, campaignId } = req.body;
  if (!amount || !firstName || !lastName || !email) return res.status(400).json({ error: "All fields required" });

  const orgs = await query(
    "SELECT id, name, stripe_account_id, stripe_connected FROM orgs WHERE org_slug = $1",
    [req.params.orgSlug]
  );
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  if (!org.stripe_connected || !org.stripe_account_id) {
    return res.status(400).json({ error: "This organization is not set up to accept online donations yet." });
  }

  const amountCents = Math.round(parseFloat(amount) * 100);
  if (amountCents < 100) return res.status(400).json({ error: "Minimum donation is $1" });

  const donorName = `${firstName} ${lastName}`.trim();
  const isRecurring = frequency === "monthly" || frequency === "annual";
  const rawFrontendUrl = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
  const frontendUrl = rawFrontendUrl.replace(/^http:\/\//i, "https://");

  let fundName = "";
  if (fundId) {
    const fundRow = await query("SELECT name FROM fin_funds WHERE id=$1 AND org_id=$2", [fundId, org.id]);
    if (fundRow.length) fundName = fundRow[0].name;
  }

  const productName = `Donation to ${org.name}${fundName ? ` — ${fundName}` : ""}`;
  const metadata = {
    donor_email: email,
    donor_name: donorName,
    fund_id: fundId || "",
    frequency,
    campaign_id: campaignId || "",
    org_id: org.id,
  };

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
    success_url: `${frontendUrl}/give/${req.params.orgSlug}?donated=true`,
    cancel_url: `${frontendUrl}/give/${req.params.orgSlug}`,
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

app.post("/finance/accounts", requireAuth, requireAdmin, wrap(async (req, res) => {
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

app.put("/finance/accounts/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
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

app.post("/finance/funds", requireAuth, requireAdmin, wrap(async (req, res) => {
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

app.put("/finance/funds/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
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

app.post("/finance/transactions", requireAuth, wrap(async (req, res) => {
  const { date, description, vendorDonor, amount, type, accountId, fundId, notes } = req.body;
  if (!date || !description || !amount || !type) {
    return res.status(400).json({ error: "date, description, amount, and type required" });
  }
  const id = "ft_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, date, description, vendorDonor || "", parseFloat(amount), type, accountId || null, fundId || null, notes || ""]
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

app.post("/finance/budgets", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { accountId, year, amount } = req.body;
  if (!accountId || !year) return res.status(400).json({ error: "accountId and year required" });
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

// ── Finance: Summary ───────────────────────────────────────────────────────
app.get("/finance/summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const { yearMode = "calendar" } = req.query;

  let dateStart, dateEnd, periodLabel;
  if (yearMode === "fiscal") {
    // Identical boundary to /dashboard/my-stats: July 1 fiscal year
    const now = new Date();
    dateStart = now.getMonth() < 6
      ? new Date(now.getFullYear() - 1, 6, 1).toISOString().split("T")[0]
      : new Date(now.getFullYear(), 6, 1).toISOString().split("T")[0];
    dateEnd = now.getMonth() < 6
      ? new Date(now.getFullYear(), 5, 30).toISOString().split("T")[0]
      : new Date(now.getFullYear() + 1, 5, 30).toISOString().split("T")[0];
    const fyStartYear = parseInt(dateStart.slice(0, 4));
    periodLabel = `Jul ${fyStartYear} – Jun ${fyStartYear + 1}`;
  } else {
    const year = new Date().getFullYear();
    dateStart   = `${year}-01-01`;
    dateEnd     = `${year}-12-31`;
    periodLabel = `Jan – Dec ${year}`;
  }

  const [ytdRows, allRows] = await Promise.all([
    query(
      `SELECT type, SUM(amount) as total FROM fin_transactions
       WHERE org_id = ? AND date >= ? AND date <= ?
       GROUP BY type`,
      [orgId, dateStart, dateEnd]
    ),
    query(
      "SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type",
      [orgId]
    ),
  ]);
  const ytd = Object.fromEntries(ytdRows.map(r => [r.type, parseFloat(r.total)]));
  const all = Object.fromEntries(allRows.map(r => [r.type, parseFloat(r.total)]));
  const ytdRevenue  = ytd.income  || 0;
  const ytdExpenses = ytd.expense || 0;
  const cashOnHand  = (all.income || 0) - (all.expense || 0);
  res.json({ cashOnHand, ytdRevenue, ytdExpenses, netSurplus: ytdRevenue - ytdExpenses, yearMode, periodLabel });
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
        subject: "Your trial ends in 2 days",
        body: `Hi {{first_name}},\n\nYour 30-day Steward trial ends in 2 days.\n\nIf Steward has saved you time, helped you stay on top of your donors, or made one thing easier — I'd love for you to keep using it.\n\nPlans start at $99/month. For context: that's less than what most nonprofits spend on office supplies in a month, and a fraction of what Bloomerang or Salesforce charge.\n\nhttps://stewardapp.dev/pricing\n\nIf the timing isn't right or you have questions, just reply to this email. I'm happy to extend your trial or hop on a 15-minute call.\n\nEither way — thank you for trying Steward. Building software for people doing meaningful work is the best job I've ever had.\n\n— Jonathan\nFounder, Steward\nstewardapp.dev`,
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
    const bodyHtml0 = `<p>${body0.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>` + unsubscribeEmailFooterHtml(userEmail, orgId, "sequence");
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
        const orgName = orgRows[0]?.name || "";
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
          + unsubscribeEmailFooterHtml(recipient.email, enr.org_id, "sequence");
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
  const orgName = orgRows[0]?.name || "";
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
  const orgName = orgRows[0]?.name || "";
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

app.post("/sequences/:id/enroll", requireAuth, wrap(async (req, res) => {
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
      + unsubscribeEmailFooterHtml(donor.email, req.user.orgId, "sequence");
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

app.post("/recurring/process-dunning", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processDunning();
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

  const rawFrontendUrl = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
  const frontendUrl = rawFrontendUrl.replace(/^http:\/\//i, "https://");

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

// Returns the org's stripe_customer_id, creating and persisting one on the
// fly if missing (e.g. orgs created via the legacy /auth/register route,
// which predates Stripe billing, or ones where inline creation at signup
// failed silently). Returns null only if the org itself doesn't exist.
async function ensureStripeCustomer(orgId, email) {
  const orgs = await query("SELECT name, stripe_customer_id FROM orgs WHERE id=?", [orgId]);
  if (!orgs.length) return null;
  if (orgs[0].stripe_customer_id) return orgs[0].stripe_customer_id;
  const customer = await stripe.customers.create({ email, name: orgs[0].name, metadata: { orgId } });
  await run("UPDATE orgs SET stripe_customer_id=? WHERE id=?", [customer.id, orgId]);
  return customer.id;
}

app.get("/billing/status", requireAuth, wrap(async (req, res) => {
  const orgs = await query("SELECT plan, subscription_status, trial_ends_at, stripe_customer_id, grace_until, current_period_end FROM orgs WHERE id=?", [req.user.orgId]);
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
    planLimits: PLAN_LIMITS[plan] || PLAN_LIMITS.seed,
    usage: { seats: Number(seatRow?.c) || 0, records: Number(recordRow?.c) || 0 },
    isTrial,
  });
}));

app.post("/billing/create-checkout", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { plan } = req.body;
  const priceMap = {
    seed:   process.env.STRIPE_PRICE_SEED,
    growth: process.env.STRIPE_PRICE_GROWTH,
    impact: process.env.STRIPE_PRICE_IMPACT,
  };
  const priceId = priceMap[plan];
  if (!priceId) return res.status(400).json({ error: "Invalid plan. Must be seed, growth, or impact." });

  const customerId = await ensureStripeCustomer(req.user.orgId, req.user.email);
  if (!customerId) return res.status(404).json({ error: "Org not found" });

  const sessionParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: (process.env.FRONTEND_URL || "https://stewardapp.dev") + "/dashboard?subscribed=true",
    cancel_url:  (process.env.FRONTEND_URL || "https://stewardapp.dev") + "/pricing",
    metadata: { orgId: req.user.orgId, plan },
    subscription_data: { metadata: { orgId: req.user.orgId, plan } },
    customer: customerId,
  };

  const session = await stripe.checkout.sessions.create(sessionParams);
  res.json({ url: session.url });
}));

app.post("/billing/create-portal", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const customerId = await ensureStripeCustomer(req.user.orgId, req.user.email);
  if (!customerId) return res.status(404).json({ error: "Org not found" });
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: (process.env.FRONTEND_URL || "https://stewardapp.dev") + "/dashboard",
  });
  res.json({ url: session.url });
}));

// ── Admin (super admin only) ───────────────────────────────────────────────
const PLAN_MRR = { seed: 99, growth: 249, impact: 499, trial: 0 };

// 999999999 used for "unlimited" — Infinity serializes to null in JSON
// trial gets Growth limits: limits only engage once trial converts to paid
const PLAN_LIMITS = {
  seed:   { seats: 1,         records: 1000,      extraSeatPrice: null },
  growth: { seats: 5,         records: 10000,     extraSeatPrice: 25   },
  impact: { seats: 999999999, records: 999999999, extraSeatPrice: null },
  trial:  { seats: 5,         records: 10000,     extraSeatPrice: null },
};

// Returns the limits actually in effect for an org, accounting for trial state
function effectivePlanLimits(org) {
  const status = org.subscription_status || "trialing";
  if (status === "trialing") return PLAN_LIMITS.trial; // Growth limits during trial
  return PLAN_LIMITS[org.plan] || PLAN_LIMITS.seed;
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
  const orgs = await query("SELECT * FROM orgs ORDER BY created_at DESC", []);
  const result = await Promise.all(orgs.map(orgWithMetrics));
  res.json(result);
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
      trial:  orgs.filter(o => !o.plan || o.plan === "trial").length,
      seed:   orgs.filter(o => o.plan === "seed" && o.subscription_status === "active").length,
      growth: orgs.filter(o => o.plan === "growth" && o.subscription_status === "active").length,
      impact: orgs.filter(o => o.plan === "impact" && o.subscription_status === "active").length,
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
  if (!days || isNaN(parseInt(days, 10))) return res.status(400).json({ error: "days required" });
  await pool.query(
    `UPDATE orgs SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + INTERVAL '${parseInt(days, 10)} days' WHERE id = $1`,
    [req.params.id]
  );
  const orgs = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  res.json(orgs[0]);
}));

app.post("/admin/orgs/:id/change-plan", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const { plan } = req.body;
  const valid = ["trial", "seed", "growth", "impact"];
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
  const frontendUrl = process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app";
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
          `INSERT INTO fin_transactions (id, org_id, date, description, vendor_donor, amount, type, account_id, fund_id)
           VALUES ($1,$2,$3,$4,$5,$6,'income',$7,$8)`,
          ["ft_" + uuid().slice(0,8), orgId, today, `Event Gift — ${evt?.name||"event"}`, att.name, newGift, accts[0].id, funds[0].id]
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
  console.log(`🚀 Steward backend running on port ${PORT}`);
  console.log(`   Demo login: admin@creoarts.org / demo1234`);
  if (!process.env.RESEND_DOMAIN_VERIFIED) {
    console.warn("[email] WARNING: RESEND_DOMAIN_VERIFIED not set — emails may land in spam");
  }
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
  const rows = await query(
    `SELECT d.id, d.name, d.total_giving,
       COALESCE(
         (SELECT MAX(i.date) FROM interactions i WHERE i.donor_id = d.id AND i.type IN ${MEANINGFUL_CONTACT_TYPES}),
         d.first_gift_date
       ) AS last_contact
     FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.total_giving > 0 ${userId ? "AND d.assigned_to = ?" : ""}`,
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
  const rows = await query(
    `SELECT d.id, d.name, d.first_gift_date,
       (SELECT MIN(i.date) FROM interactions i
        WHERE i.donor_id = d.id AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date >= d.first_gift_date) AS first_touch_date
     FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.first_gift_date IS NOT NULL`,
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
  let allGifts = gifts || await query("SELECT * FROM gifts WHERE org_id = ?", [orgId]);
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
