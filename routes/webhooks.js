// routes/webhooks.js — Stripe, Resend, billing and inbound-email webhooks, and unsubscribe.
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

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
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
} = ctx;
// server.js loads these ESM modules at boot and sets its own binding when each
// arrives; the code below reads them only after awaiting the same promise, so
// this module keeps its own binding, set from that promise the same way.
let GC = null;
GC_READY.then(m => { GC = m; });
let MB = null;
MB_READY.then(m => { MB = m; });
let app = routers.r0;
const SYS_STRIPE = { id: "system:stripe-webhook", name: "Stripe (online)" };

// BUILD-57 §2a — event-shape normalizers. Server-side RETRIEVES ride the
// pinned stripe-node API version (old shapes), but WEBHOOK payloads ride the
// endpoint/CLI API version: on 2025+ versions `invoice.subscription` moved to
// `invoice.parent.subscription_details.subscription` (metadata beside it),
// the line's price.recurring moved under `pricing`, and the PaymentIntent
// lost its `invoice` field entirely. Every handler reads through these so
// both generations of payload work.
const invoiceSubscriptionId = inv =>
  inv?.subscription || inv?.parent?.subscription_details?.subscription || null;
const invoiceSubMetadata = inv =>
  inv?.subscription_details?.metadata || inv?.parent?.subscription_details?.metadata || null;
const invoiceLineInterval = inv => {
  const line = inv?.lines?.data?.[0];
  return line?.price?.recurring?.interval
    || line?.pricing?.price_details?.recurring?.interval
    || (line?.parent?.subscription_item_details ? (line?.plan?.interval || null) : null)
    || line?.plan?.interval || null;
};

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
      // `email`/`donorName` are `let` because the BUILD-62 fallback below can
      // fill them from Stripe's own customer object when a subscription
      // charge's PI carries neither (invoice-generated PIs are empty).
      let email = pi.receipt_email || pi.metadata?.donor_email;
      const amount = pi.amount_received / 100;
      const accountId = event.account;
      let campaignId = pi.metadata?.campaign_id || null;
      let givingPageId = pi.metadata?.giving_page_id || null;
      // BUILD-55 — the donor's chosen designation (/donate stamps fund_id into
      // the charge metadata; it previously never reached the gift row, so every
      // online gift landed undesignated and the ledger stamp routed to the org's
      // first unrestricted fund regardless of what the donor picked).
      let fundId = pi.metadata?.fund_id || null;
      const peerFundraiserId = pi.metadata?.peer_fundraiser_id || null;
      let donorName = pi.metadata?.donor_name || "";
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

      // BUILD-57 §2a — REAL-STRIPE FIX. A subscription charge's PI is
      // INVOICE-generated: it carries no receipt_email and no metadata (those
      // ride the checkout session / one-time payment_intent_data only). The
      // old `email &&` guard silently skipped the whole gift path for every
      // real recurring charge — first and renewal alike — while the mock
      // fixtures always stamped an email onto the PI, so three builds of
      // recurring plumbing proved a path real Stripe never takes. When the
      // email is absent, resolve the DONOR through the invoice's
      // subscription → recurring_subscriptions row instead.
      let subResolvedDonorId = null;
      if (!email && accountId && (pi.invoice || pi.customer)) {
        try {
          const orgRow0 = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
          if (orgRow0.length) {
            if (pi.invoice) {
              const invObj = await stripe.invoices.retrieve(pi.invoice, {}, { stripeAccount: accountId });
              const invSub = invoiceSubscriptionId(invObj);
              if (invSub) {
                const rsRows0 = await query(
                  "SELECT donor_id FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2",
                  [invSub, orgRow0[0].id]);
                if (rsRows0.length) subResolvedDonorId = rsRows0[0].donor_id;
              }
            }
            if (!subResolvedDonorId && pi.customer) {
              // 2025+ API: the PI event has no invoice field at all — the
              // customer is the only linkage. Only ever ONE non-canceled
              // subscription per customer resolves; ambiguity resolves
              // nothing (never mis-assign).
              const rsRows0 = await query(
                "SELECT donor_id FROM recurring_subscriptions WHERE stripe_customer_id=$1 AND org_id=$2 AND status <> 'canceled'",
                [pi.customer, orgRow0[0].id]);
              if (rsRows0.length === 1) subResolvedDonorId = rsRows0[0].donor_id;
            }
            // BUILD-62 — the live-charge-that-left-no-trace fix. The two
            // lookups above both need a recurring_subscriptions row, and that
            // row is written by checkout.session.completed — a DIFFERENT
            // event that Stripe emits ~2s AFTER this one and delivers
            // concurrently. On a brand-new subscription the row does not exist
            // yet when this handler runs, so BOTH lookups miss, the donor is
            // unresolved, and the first real recurring charge is dropped
            // (money taken, no gift, 200 returned — Stripe never retries).
            // A money-recording handler must never depend on a SIBLING event
            // having been processed first: resolve the donor straight from
            // Stripe's own customer object, which always exists by the time
            // its PaymentIntent succeeds. (3-arg retrieve — stripe-node 22
            // does not read {stripeAccount} from the params position.)
            if (!subResolvedDonorId && !email && pi.customer) {
              try {
                const cust = await stripe.customers.retrieve(pi.customer, {}, { stripeAccount: accountId });
                if (cust && !cust.deleted && cust.email) {
                  email = cust.email;
                  if (!donorName) donorName = cust.name || cust.email;
                }
              } catch (e) { console.error("[stripe] customer→donor fallback failed:", e.message); }
            }
          }
        } catch (e) { console.error("[stripe] invoice→donor resolution failed:", e.message); }
      }

      if ((email || subResolvedDonorId) && accountId) {
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
          let donorRow = subResolvedDonorId
            ? await query("SELECT id FROM donors WHERE id=$1 AND org_id=$2", [subResolvedDonorId, orgId])
            : await withAdvisoryLock(`donor:${orgId}:${(email || "").toLowerCase()}`, async () => {
            let dr = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
            if (!dr.length && donorName) {
              const newDonorId = "d_" + uuid().slice(0, 8);
              await run(
                `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count, created_by, created_by_name)
                 VALUES ($1,$2,$3,$4,'active','steward',0,0,$5,$6)`,
                [newDonorId, orgId, donorName, email.toLowerCase(), SYS_STRIPE.id, SYS_STRIPE.name]
              );
              dr = [{ id: newDonorId }];
            }
            return dr;
          });
          if (donorRow.length) {
            const donorId = donorRow[0].id;
            // BUILD-46 §1.2 — a gift under an email a verified donor account
            // holds attaches to that account (idempotent, fire-and-forget;
            // no-op with accounts off or no matching account).
            if (email) linkEmailToAccounts(orgId, email).catch(() => {});
            const giftId = "g_" + uuid().slice(0, 8);
            // ORG_TZ_SEAM_OK (BUILD-75) — the gift DATE is the org's civil date.
            // The UTC slice dated a 9pm-ET Dec-31 gift as Jan 1: the wrong TAX
            // YEAR on the row every year-end statement and receipt reads.
            const today = orgToday(await orgTz(orgId));
            // Recurring RENEWAL attribution (attribution FIX): an invoice-generated
            // PI carries none of the checkout metadata, so a renewal charge through
            // a giving page used to land unattributed after the first month. The
            // subscription's own recurring_subscriptions row remembers its
            // page/campaign (stamped at checkout.session.completed). Resolve the
            // exact subscription via the PI's invoice when Stripe is reachable;
            // otherwise fall back to the donor's single attributed subscription —
            // ambiguity (2+ subs with different attributions) attributes nothing
            // rather than guessing (same never-mis-assign discipline as imports).
            // BUILD-57 — resolve the subscription behind ANY invoice-backed PI
            // (not only when attribution is missing): the gift row links back
            // to its subscription so the roster's "total given on this
            // subscription" is a real SUM over gift rows.
            let recurringSubDbId = null;
            if (pi.invoice || pi.customer) {
              try {
                let rsRow = null;
                try {
                  if (pi.invoice) {
                    const invObj = await stripe.invoices.retrieve(pi.invoice, {}, { stripeAccount: accountId });
                    const invSub = invoiceSubscriptionId(invObj);
                    if (invSub) {
                      const rows = await query(
                        "SELECT id, campaign_id, giving_page_id, cover_fee_amount, fund_id FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2",
                        [invSub, orgId]
                      );
                      rsRow = rows[0] || null;
                    }
                  }
                } catch { /* unreachable Stripe (local/test) — donor-level fallback below */ }
                if (!rsRow && pi.customer) {
                  // 2025+ API: no pi.invoice — the stored checkout customer is
                  // the linkage; unique non-canceled sub or nothing.
                  const rows = await query(
                    "SELECT id, campaign_id, giving_page_id, cover_fee_amount, fund_id FROM recurring_subscriptions WHERE stripe_customer_id=$1 AND org_id=$2 AND status <> 'canceled'",
                    [pi.customer, orgId]
                  );
                  if (rows.length === 1) rsRow = rows[0];
                }
                if (!rsRow) {
                  // Donor-level fallback: only when it's UNAMBIGUOUS. For the
                  // gift↔subscription LINK the bar is any single non-canceled
                  // sub; for ATTRIBUTION it stays "one distinct attribution"
                  // (2+ subs with different attributions attribute nothing).
                  const rows = await query(
                    `SELECT id, campaign_id, giving_page_id, cover_fee_amount, fund_id FROM recurring_subscriptions
                      WHERE org_id=$1 AND donor_id=$2 AND status <> 'canceled'`,
                    [orgId, donorId]
                  );
                  if (rows.length === 1) rsRow = rows[0];
                  else if (!campaignId && !givingPageId && !fundId) {
                    const attributed = rows.filter(r => r.campaign_id || r.giving_page_id || r.fund_id);
                    const distinct = new Set(attributed.map(r => `${r.campaign_id || ""}|${r.giving_page_id || ""}|${r.fund_id || ""}`));
                    if (distinct.size === 1) rsRow = attributed[0];
                  }
                }
                if (rsRow) {
                  recurringSubDbId = rsRow.id;
                  if (!campaignId && !givingPageId && !fundId) {
                    campaignId = rsRow.campaign_id || null;
                    givingPageId = rsRow.giving_page_id || null;
                    // BUILD-56 — the sub's FUND designation carries onto every
                    // renewal (validated org-owned below with the gift insert's
                    // own fund guard).
                    fundId = rsRow.fund_id || null;
                    const rsCover = parseFloat(rsRow.cover_fee_amount) || 0;
                    if (!coverFeeAmount && rsCover > 0 && rsCover < amount) coverFeeAmount = rsCover;
                  }
                }
              } catch (e) { console.error("[stripe] renewal attribution lookup failed:", e.message); }
            }
            // Check if donor was lapsed before updating stage
            const donorPreRow = await query("SELECT stage, gift_count, name FROM donors WHERE id=$1", [donorId]);
            const wasLapsed = donorPreRow[0]?.stage === 'lapsed';
            const wasFirstGift = (donorPreRow[0]?.gift_count || 0) === 0;
            // Walk finding W-7: on the subscription-resolved path (§2a) both
            // donorName and email are empty — the thank-task read "undefined".
            const thankName = donorName || email || donorPreRow[0]?.name || "donor";
            // BUILD-27 Part C (scenario 2): RESERVE the gift by its Stripe pi.id
            // atomically. Under a PARALLEL webhook redelivery, exactly one INSERT
            // wins the uq_gifts_stripe_pi unique; the loser's RETURNING is empty and
            // it does ZERO money side-effects (no donor total bump, no ledger row).
            // Replaces the old check-then-insert dedup that raced. Still 200 so
            // Stripe stops retrying.
            // Designation must be a real fund of THIS org — metadata is our own
            // /donate stamp, but validate anyway (never trust webhook payloads).
            if (fundId) {
              const fundOk = await query("SELECT id FROM fin_funds WHERE id=$1 AND org_id=$2", [fundId, orgId]);
              if (!fundOk.length) fundId = null;
            }
            // BUILD-88a A.1 — THROUGH THE ONE FUNCTION. The reservation, the
            // donor rollup, the ledger stamp and the timeline entry were four
            // statements here; the conflict key is still Stripe's payment
            // intent, which is what makes a redelivery a no-op. A card gift
            // knows its payment method, and used to write none.
            // BUILD-98 (switch) Part 4 — a ticket bought online. The level is
            // re-read here (org-scoped), never trusted from the metadata's
            // amounts, and the fair-market split rides on the gift so the
            // auto-issued receipt states the deductible part.
            let evLevel = null, evRow = null;
            const evQty = Math.max(1, parseInt(pi.metadata?.event_qty || "1", 10) || 1);
            if (pi.metadata?.event_level_id) {
              [evLevel] = await query("SELECT * FROM event_levels WHERE id=? AND org_id=?", [pi.metadata.event_level_id, orgId]);
              if (evLevel) [evRow] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [evLevel.event_id, orgId]);
              if (!evRow) evLevel = null;
            }
            const EVm = evLevel ? await EV_READY : null;
            // BUILD-101 Part 4 — a membership bought online, or a renewal charge
            // on an auto-renewing one (its level rides the subscription row).
            // Re-read org-scoped; the metadata's word is never the price.
            let memLevel = null;
            if (!evLevel) {
              let memLevelId = pi.metadata?.membership_level_id || null;
              if (!memLevelId && recurringSubDbId) {
                const [rsm] = await query("SELECT membership_level_id FROM recurring_subscriptions WHERE id=$1 AND org_id=$2", [recurringSubDbId, orgId]);
                memLevelId = rsm?.membership_level_id || null;
              }
              if (memLevelId) [memLevel] = await query("SELECT * FROM membership_levels WHERE id=? AND org_id=?", [memLevelId, orgId]);
            }
            const MBm = memLevel ? await MB_READY : null;
            const written = await recordGift({
              ...(memLevel ? {
                quidProQuoValue: Math.min(Number(memLevel.fmv), amount),
                quidProQuoDesc: MBm.quidProQuoDescription({ levelName: memLevel.name, benefits: memLevel.benefits || [] }),
                membershipRenewal: false,
              } : {}),
              ...(evLevel ? {
                quidProQuoValue: Math.min(Number(evLevel.fmv) * evQty, amount),
                quidProQuoDesc: EVm.quidProQuoDescription({ eventName: evRow.name, levelName: evLevel.name, qty: evQty, kind: evLevel.kind }),
                campaign: evRow.name,
              } : {}),
              orgId, donorId, giftId, amount, date: today,
              // BUILD-102 Part 5 — stored ON THE GIFT, so "which email brought
              // this in" is answered by the report builder over the same rows
              // every money figure comes from.
              utmSource: pi.metadata?.utm_source || null,
              utmMedium: pi.metadata?.utm_medium || null,
              utmCampaign: pi.metadata?.utm_campaign || null,
              type: "cash", notes: evLevel ? `${evQty} × ${evLevel.name}, ${evRow.name}` : memLevel ? `${memLevel.name} membership` : "Online payment via Stripe",
              paymentMethod: "Card", fundId, campaignId, givingPageId,
              peerFundraiserId, coverFeeAmount, recurringSubscriptionId: recurringSubDbId,
              stripePaymentId: pi.id || null, conflict: pi.id ? "stripe" : null,
              // A donor who designated nothing has designated nothing.
              defaultFund: false,
              actorId: SYS_STRIPE.id, actorName: SYS_STRIPE.name,
              ledgerDescription: "Online gift via Stripe", ledgerSource: "online",
              timelineNote: "Online donation via the giving page",
              source: "stripe",
            });
            if (written.duplicate) {
              console.log(`[stripe] payment_intent.succeeded ${pi.id} already recorded — skipping duplicate (race-safe)`);
              return res.json({ received: true, duplicate: true });
            }
            // BUILD-102 Part 3 — the form's tribute, employer and answers. Runs
            // only for a gift the duplicate guard just let through, so a
            // redelivered webhook writes no second tribute draft and no second
            // match pledge. Its failure is logged and costs the donation nothing.
            const formMeta = pi.metadata || {};
            if (formMeta.tribute_type || formMeta.employer || Object.keys(formMeta).some(k => k.startsWith("q_"))) {
              await applyFormAsks(orgId, written.gift, formMeta, SYS_STRIPE)
                .catch(e => console.error("[form] applying what the form asked:", e.message));
            }
            // BUILD-102 Part 6 — the COMPLETION, counted here and nowhere else. A
            // page reports a view and a start; only the webhook knows money moved,
            // and it runs inside the duplicate guard, so a redelivered event cannot
            // count a second gift. The money is the CHARGED amount, which is what
            // "average gift through this form" honestly means.
            if (givingPageId) {
              await bumpFormEvent(orgId, givingPageId, "completions",
                { variant: formMeta.variant || null, cents: Math.round(amount * 100) })
                .catch(e => console.error("[forms] counting a completion:", e.message));
            }
            if (evLevel) {
              await registerForEvent({ orgId, event: evRow, level: evLevel, donorId, qty: evQty, giftId,
                who: SYS_STRIPE }).catch(e => console.error("[event] webhook registration:", e.message));
            }
            if (memLevel) {
              await attachOnlineMembership({ orgId, donorId, levelId: memLevel.id, giftId })
                .catch(e => console.error("[membership] webhook attach:", e.message));
            }
            // Stage promotion is a decision ABOUT the gift, not the gift.
            await run(
              `UPDATE donors SET
                 stage = CASE WHEN stage = 'lapsed' THEN 'steward' WHEN stage IN ('prospect','cultivate') THEN 'steward' ELSE stage END
               WHERE id = $1`, [donorId]
            );
            // BUILD-22 — auto-unlapse is logged as a move + timeline entry so a
            // lapsed→steward jump on an online gift is transparent, not silent.
            if (wasLapsed) {
              await recordAutoMove(orgId, donorId, "lapsed", "steward", "Auto: new gift after a year-long gap").catch(e => console.error("[smart-move] webhook unlapse:", e.message));
            }
            // Re-engagement task for previously lapsed donors
            if (wasLapsed) {
              await run(
                "INSERT INTO tasks (id,org_id,title,priority,done,due,created_by,created_by_name) VALUES ($1,$2,$3,'high',0,$4,$5,$6)",
                ["t_"+uuid().slice(0,8), orgId, `Gave again after a year-long gap — follow up with ${donorName||email} within 48 hours`,
                 new Date(Date.now()+2*24*60*60*1000).toISOString().slice(0,10), SYS_STRIPE.id, SYS_STRIPE.name]
              ).catch(()=>{});
            }
            // The ledger stamp is recordGift's — one place, BUILD-58 W-3's
            // self-healing chart included, under the BUILD-83 posting rule.
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at, created_by, created_by_name)
               VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7)`,
              [taskId, orgId, `Send personal thank-you to ${thankName} for $${amount} online gift`, "high", 0, SYS_STRIPE.id, SYS_STRIPE.name]
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
                if (orgFull && donorFull && giftFull) await issueGiftReceipt(giftFull, orgFull, donorFull, { send: true, by: SYS_STRIPE });
              } catch (e) { console.error("[receipts] webhook issueGiftReceipt failed:", e.message); }
            })().catch(console.error);

            // BUILD-13 workflows — gift_received (covers new-donor + major-gift
            // recipes). Fire-and-forget; must never 500 the webhook (Stripe
            // retries on 500, and fireWorkflows is idempotent per giftId anyway).
            fireWorkflows(orgId, "gift_received", {
              dedupKey: `gift:${giftId}`, donorId, giftId, amount, isFirstGift: wasFirstGift,
              entityType: "gift", entityId: giftId,
            }).catch(e => console.error("[workflow] gift_received:", e.message));

            // BUILD-81 — a live one-time gift opens a thread (next step
            // "Thank", +2 days). Recurring charges are excluded: their
            // thank-you path is transactional and automatic, and a thread
            // per renewal would be noise, not remembering.
            if (!recurringSubDbId) {
              openGiftThread(orgId, donorId, {
                giftId, actorId: SYS_STRIPE.id, actorName: SYS_STRIPE.name,
              }).catch(() => {});
            }
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
            // BUILD-75 — the SAME per-(org,email) advisory lock the
            // payment_intent.succeeded handler uses (BUILD-27 scenario 2).
            // Stripe delivers checkout.session.completed and the PI event
            // CONCURRENTLY for a new subscription's first charge; this
            // resolve-or-create was the one bare check-then-insert left on
            // the pair, so the race minted TWO donor rows for one brand-new
            // donor (caught as a ~1-in-3 flake of webhook-ordering's "Q2
            // simultaneous" case — a flaky race test is a race, not a flake).
            const donorId = await withAdvisoryLock(`donor:${orgId}:${(email || "").toLowerCase()}`, async () => {
              // BUILD-77 Part 6 — a reconnect stitches to the EXISTING donor
              // by the signed id, then by email, then by name. It must NEVER
              // create a second record (the 26-months-of-history-stays-attached
              // guarantee); the negative — a reconnect matching nothing —
              // falls through to the normal resolve and creates a donor.
              const reconnectId = session.metadata?.reconnect_donor_id;
              if (reconnectId) {
                const rr = await query("SELECT id FROM donors WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL", [reconnectId, orgId]);
                if (rr.length) return rr[0].id;
              }
              const dr = await query("SELECT id FROM donors WHERE org_id=$1 AND email ILIKE $2", [orgId, email]);
              if (dr.length) return dr[0].id;
              const newId = "d_" + uuid().slice(0, 8);
              await run(
                `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count, created_by, created_by_name)
                 VALUES ($1,$2,$3,$4,'active','steward',0,0,$5,$6)`,
                [newId, orgId, donorName, email.toLowerCase(), SYS_STRIPE.id, SYS_STRIPE.name]
              );
              return newId;
            });
            const frequency = session.metadata?.frequency || "monthly";
            await run(
              `UPDATE donors SET stripe_subscription_id=$1, stripe_subscription_status='active', stripe_customer_id=$2,
               stage = CASE WHEN stage IN ('prospect','cultivate','lapsed') THEN 'steward' ELSE stage END
               WHERE id=$3`,
              [session.subscription, session.customer || null, donorId]
            );
            // BUILD-77 Part 6 — the donor is now LINKED: clear the imported
            // (unlinked) sustainer state, and if this completed a reconnect,
            // stamp the ledger (real event → the migration recovery number).
            const recurAmt77 = session.amount_total != null ? session.amount_total / 100 : null;
            await run(`UPDATE donors SET imported_sustainer=false WHERE id=$1 AND org_id=$2`, [donorId, orgId]).catch(() => {});
            // A reconnection is counted whether or not a reconnect link was
            // recorded first (a donor may complete a link forwarded to them,
            // or reconnect on their own) — UPSERT so the recovery number
            // reflects every sustainer who came back, stamped from THIS real
            // event, never an estimate.
            if (session.metadata?.reconnect_donor_id) {
              await run(
                `INSERT INTO reconnect_sends (id, org_id, donor_id, historical_interval, reconnected_at, new_subscription_id, reconnected_amount)
                 VALUES ($1,$2,$3,'month',NOW(),$4,$5)
                 ON CONFLICT (org_id, donor_id) DO UPDATE SET
                   reconnected_at = COALESCE(reconnect_sends.reconnected_at, NOW()),
                   new_subscription_id = EXCLUDED.new_subscription_id,
                   reconnected_amount = EXCLUDED.reconnected_amount`,
                ["rcs_" + uuid().slice(0, 8), orgId, donorId, session.subscription, recurAmt77]
              ).catch(() => {});
            }
            const taskId = "t_" + uuid().slice(0, 8);
            await run(
              `INSERT INTO tasks (id, org_id, title, priority, done, created_at, created_by, created_by_name) VALUES ($1,$2,$3,'high',0,NOW(),$4,$5)`,
              [taskId, orgId, `Welcome ${donorName} as a ${frequency} recurring donor — send personal thank-you`, SYS_STRIPE.id, SYS_STRIPE.name]
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
            // BUILD-56 — the FUND designation rides the sub row too (validated
            // org-owned, like the gift-insert guard: never trust webhook
            // payloads even though the metadata is our own /donate stamp).
            let subFundId = session.metadata?.fund_id || null;
            if (subFundId) {
              const fOk = await query("SELECT id FROM fin_funds WHERE id=$1 AND org_id=$2", [subFundId, orgId]);
              if (!fOk.length) subFundId = null;
            }
            let subCoverFee = 0;
            if (session.metadata?.cover_fees === "true" && session.metadata?.base_amount_cents && recurAmount != null) {
              const base = parseInt(session.metadata.base_amount_cents, 10);
              if (Number.isFinite(base) && base > 0 && recurAmount > base / 100) subCoverFee = recurAmount - base / 100;
            }
            const subInterval = frequency === "annual" ? "year" : "month";
            // BUILD-101 Part 4 — an auto-renewing membership's level, validated org-owned.
            let subMemLevel = session.metadata?.membership_level_id || null;
            if (subMemLevel) {
              const lOk = await query("SELECT id FROM membership_levels WHERE id=$1 AND org_id=$2", [subMemLevel, orgId]);
              if (!lOk.length) subMemLevel = null;
            }
            const insertedSub = await query(
              `INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount, interval, status, campaign_id, giving_page_id, cover_fee_amount, fund_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11)
               ON CONFLICT (stripe_subscription_id) DO NOTHING
               RETURNING id`,
              ["rsub_" + uuid().slice(0, 8), orgId, donorId, session.subscription, session.customer || null, recurAmount, subInterval, subCampaignId, subGivingPageId, subCoverFee, subFundId]
            );
            // BUILD-57 — movement ledger: log 'created' only when the row was
            // genuinely reserved (a redelivered webhook logs nothing).
            if (insertedSub.length) {
              await logRecurringChange(orgId, insertedSub[0].id, donorId, "created",
                { newAmount: recurAmount, interval: subInterval, actor: "donor" });
            } else {
              // BUILD-63 Part 3 — the checkout LOST the insert race. When a
              // brand-new subscription's FIRST charge declines,
              // invoice.payment_failed pre-creates the recurring_subscriptions
              // row on the fly — but it carries NO attribution (campaign / page /
              // fund / cover-fee), so with ON CONFLICT DO NOTHING the designation
              // this checkout knows would be lost forever, and every recovered
              // renewal would attribute to nothing. Backfill the attribution
              // columns that are still null (COALESCE never clobbers a value the
              // row already has). Idempotent, order-independent.
              await run(
                `UPDATE recurring_subscriptions SET
                   campaign_id = COALESCE(campaign_id, ?),
                   giving_page_id = COALESCE(giving_page_id, ?),
                   fund_id = COALESCE(fund_id, ?),
                   cover_fee_amount = COALESCE(NULLIF(cover_fee_amount, 0), ?),
                   stripe_customer_id = COALESCE(stripe_customer_id, ?),
                   updated_at = NOW()
                 WHERE stripe_subscription_id = ? AND org_id = ?`,
                [subCampaignId, subGivingPageId, subFundId, subCoverFee, session.customer || null, session.subscription, orgId]
              ).catch(() => {});
            }
            if (subMemLevel) {
              await run(`UPDATE recurring_subscriptions SET membership_level_id=COALESCE(membership_level_id, ?) WHERE stripe_subscription_id=? AND org_id=?`,
                [subMemLevel, session.subscription, orgId]);
              // The first charge's payment event may have arrived FIRST, before
              // this row existed to say it was a membership. That gift is the
              // most recent card gift of exactly this amount from this person
              // with no membership yet; attach is keyed on it, so it happens once.
              const [sub] = await query("SELECT id FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2", [session.subscription, orgId]);
              const [first] = await query(
                `SELECT g.id FROM gifts g WHERE g.org_id=$1 AND g.donor_id=$2 AND g.stripe_payment_id IS NOT NULL
                    AND round(g.amount::numeric * 100)::bigint = $3
                    AND (g.recurring_subscription_id IS NULL OR g.recurring_subscription_id=$4)
                    AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=g.org_id AND m.gift_id=g.id)
                  ORDER BY g.created_at DESC LIMIT 1`, [orgId, donorId, Math.round((recurAmount || 0) * 100), sub?.id || null]);
              if (first) {
                if (sub) await run("UPDATE gifts SET recurring_subscription_id=COALESCE(recurring_subscription_id, $1) WHERE id=$2", [sub.id, first.id]);
                await attachOnlineMembership({ orgId, donorId, levelId: subMemLevel, giftId: first.id })
                  .catch(e => console.error("[membership] checkout attach:", e.message));
              }
            }
            // BUILD-57 — a staff proposal completed by the donor on Stripe.
            // The proposal id rode our own checkout metadata; mark it done so
            // "pending donor action" clears on both staff surfaces.
            if (session.metadata?.proposal_id) {
              await run(
                `UPDATE recurring_proposals SET status='completed', completed_at=NOW(), updated_at=NOW()
                  WHERE id=$1 AND org_id=$2 AND status='pending'`,
                [session.metadata.proposal_id, orgId]
              ).catch(() => {});
            }
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
          const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent, {}, { stripeAccount: event.account });
          const subscriptionId = setupIntent.metadata?.subscription_id;
          const recOrgId = setupIntent.metadata?.org_id;
          const paymentMethodId = setupIntent.payment_method;
          if (subscriptionId && recOrgId && paymentMethodId) {
            // Attach the new card as the subscription's default so future
            // renewals use it, then try to pay the currently open invoice
            // right away — this is what makes "update card" feel instant to
            // the donor instead of waiting for Stripe's next scheduled retry.
            await stripe.subscriptions.update(subscriptionId, { default_payment_method: paymentMethodId }, { stripeAccount: event.account });

            const rsRows = await query("SELECT id, donor_id FROM recurring_subscriptions WHERE stripe_subscription_id=$1 AND org_id=$2", [subscriptionId, recOrgId]);
            await logRecoveryEvent(recOrgId, rsRows[0]?.donor_id || null, subscriptionId, "card_updated", event.id, {});
            // BUILD-57 — a card-update PROPOSAL completes when the setup
            // session lands (by id if our metadata carried one, else any
            // pending card_update proposal on this subscription).
            if (setupIntent.metadata?.proposal_id) {
              await run(
                `UPDATE recurring_proposals SET status='completed', completed_at=NOW(), updated_at=NOW()
                  WHERE id=$1 AND org_id=$2 AND status='pending'`,
                [setupIntent.metadata.proposal_id, recOrgId]).catch(() => {});
            } else if (rsRows[0]) {
              await run(
                `UPDATE recurring_proposals SET status='completed', completed_at=NOW(), updated_at=NOW()
                  WHERE org_id=$1 AND subscription_id=$2 AND kind='card_update' AND status='pending'`,
                [recOrgId, rsRows[0].id]).catch(() => {});
            }

            try {
              const subObj = await stripe.subscriptions.retrieve(subscriptionId, {}, { stripeAccount: event.account });
              if (subObj.latest_invoice) {
                const invoice = await stripe.invoices.retrieve(subObj.latest_invoice, {}, { stripeAccount: event.account });
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
            const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75)
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

    // ── BUILD-58 Part 3 — DISPUTES / chargebacks (the boundary drill found
    // this unhandled everywhere) ───────────────────────────────────────────
    // A dispute is not a refund: the money is HELD pending resolution and the
    // org may win. So on creation the gift is FLAGGED and staff are alerted
    // LOUDLY (never a silent hit to the ledger a treasurer discovers at
    // year-end) — but nothing is reversed. Only a LOST dispute reverses the
    // gift the same way a full refund does; a WON dispute just clears the flag.
    // Idempotent: created is a no-op once flagged; closed converges on status.
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
      const dispute = event.data.object;
      const accountId = event.account;
      const piId = dispute.payment_intent || null;
      if (piId && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.length) {
          const orgId = orgRow[0].id;
          const giftRows = await query("SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [orgId, piId]);
          if (giftRows.length) {
            const g = giftRows[0];
            const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75)
            const amt = parseFloat(g.amount) || (dispute.amount || 0) / 100;
            const closed = event.type === "charge.dispute.closed";
            const lost = closed && dispute.status === "lost";
            const won = closed && (dispute.status === "won" || dispute.status === "warning_closed");
            const uiStatus = lost ? "lost" : won ? "won" : (dispute.status === "under_review" ? "under_review" : "needs_response");

            await withAdvisoryLock(`gift:${g.id}`, async () => {
              if (lost) {
                // Lost — the money is gone. Reverse exactly like a full refund:
                // void the receipt, drop the ledger stamp + gift, recalc.
                // BUILD-65 Part 7: a lost dispute can be WON BACK on appeal
                // (charge.dispute.funds_reinstated). Snapshot what we're about
                // to reverse — keyed on the payment_intent — so it can be
                // restored byte-for-byte instead of staying reversed forever.
                const [rcptToVoid] = await query(
                  "SELECT id FROM receipts WHERE gift_id=$1 AND org_id=$2 AND type='gift' AND voided_at IS NULL", [g.id, orgId]);
                await run(
                  `INSERT INTO dispute_reversals (id,org_id,stripe_payment_id,dispute_id,gift_snapshot,receipt_id)
                   VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (org_id, stripe_payment_id) DO UPDATE
                     SET gift_snapshot=EXCLUDED.gift_snapshot, receipt_id=EXCLUDED.receipt_id, dispute_id=EXCLUDED.dispute_id, created_at=NOW()`,
                  ["drev_" + uuid().slice(0, 8), orgId, piId, dispute.id, JSON.stringify(g), rcptToVoid?.id || null]).catch(e => console.error("[stripe] reversal snapshot failed:", e.message));
                await withTransaction(async (client) => {
                  await runTx(client,
                    `UPDATE receipts SET voided_at=NOW(), void_reason='Gift lost to a Stripe dispute/chargeback', gift_id=NULL
                     WHERE gift_id=$1 AND org_id=$2 AND type='gift' AND voided_at IS NULL`, [g.id, orgId]);
                  await runTx(client, "UPDATE receipts SET gift_id=NULL WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
                  await runTx(client, "UPDATE pledges SET fulfilled_gift_id=NULL, updated_at=NOW() WHERE fulfilled_gift_id=$1 AND org_id=$2", [g.id, orgId]);
                  await runTx(client, "DELETE FROM fin_transactions WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
                  await runTx(client, "DELETE FROM gifts WHERE id=$1 AND org_id=$2", [g.id, orgId]);
                });
                if (g.pledge_id) await recalcPledgePayment(g.pledge_id, orgId).catch(() => {});
                if (g.donor_id) {
                  await recalcDonorSummary(g.donor_id, orgId);
                  await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                    ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Dispute LOST: $${amt.toLocaleString()} online gift charged back via Stripe — gift reversed`, today]).catch(() => {});
                }
                console.log(`[stripe] dispute LOST ${dispute.id} — gift ${g.id} reversed ($${amt})`);
              } else {
                // Created / updated / won — keep the gift, just track state.
                const firstFlag = !g.disputed_at;
                await run("UPDATE gifts SET disputed_at=COALESCE(disputed_at, NOW()), dispute_status=$1 WHERE id=$2 AND org_id=$3", [uiStatus, g.id, orgId]);
                if (won && g.donor_id) {
                  await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                    ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Dispute WON: $${amt.toLocaleString()} online gift dispute resolved in your favor — funds reinstated`, today]).catch(() => {});
                } else if (firstFlag && event.type === "charge.dispute.created") {
                  // LOUD: a high-priority staff task + a donor timeline note. A
                  // dispute has a Stripe response deadline; silence loses it by
                  // default. (The day-view + Finance surface disputed gifts too.)
                  const due = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10) : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
                  await run("INSERT INTO tasks (id,org_id,title,priority,done,due,donor_id,created_by,created_by_name) VALUES ($1,$2,$3,'high',0,$4,$5,$6,$7)",
                    ["t_" + uuid().slice(0, 8), orgId, `Payment disputed — $${amt.toLocaleString()} charged back${dispute.reason ? " (" + String(dispute.reason).replace(/_/g, " ") + ")" : ""}. Respond in Stripe before ${due} or the funds are lost.`, due, g.donor_id || null, SYS_STRIPE.id, SYS_STRIPE.name]).catch(() => {});
                  if (g.donor_id) {
                    await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                      ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Dispute opened: $${amt.toLocaleString()} online gift was disputed via the donor's bank${dispute.reason ? " (" + String(dispute.reason).replace(/_/g, " ") + ")" : ""} — respond in Stripe`, today]).catch(() => {});
                  }
                  console.log(`[stripe] dispute CREATED ${dispute.id} — gift ${g.id} flagged + staff task ($${amt})`);
                }
              }
            });
          }
        }
      }
    }

    // ── BUILD-65 Part 7 — a dispute WON BACK on appeal (funds reinstated) ────
    // The full lifecycle, not just the loss: charge.dispute.funds_reinstated
    // means Stripe returned the money. If the gift is still live (a clean win),
    // just mark it won. If it was REVERSED by an earlier lost close, RESTORE it
    // byte-for-byte from the reversal snapshot — gift row, ledger stamp, receipt
    // — so the ledger isn't short and the donor's history isn't wrong forever.
    // Idempotent: a redelivery finds the gift already present and no-ops.
    if (event.type === "charge.dispute.funds_reinstated") {
      const dispute = event.data.object;
      const accountId = event.account;
      const piId = dispute.payment_intent || null;
      if (piId && accountId) {
        const orgRow = await query("SELECT id FROM orgs WHERE stripe_account_id=$1", [accountId]);
        if (orgRow.length) {
          const orgId = orgRow[0].id;
          const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75)
          const live = await query("SELECT id, donor_id, dispute_status, amount FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [orgId, piId]);
          if (live.length) {
            // Never reversed — a clean win. Just record the outcome.
            const g = live[0];
            await withAdvisoryLock(`gift:${g.id}`, async () => {
              if (g.dispute_status !== "won") {
                await run("UPDATE gifts SET dispute_status='won', disputed_at=COALESCE(disputed_at,NOW()) WHERE id=$1 AND org_id=$2", [g.id, orgId]);
                if (g.donor_id) await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                  ["i_" + uuid().slice(0, 8), orgId, g.donor_id, `Dispute WON: $${(parseFloat(g.amount) || 0).toLocaleString()} online gift dispute resolved in your favor — funds reinstated`, today]).catch(() => {});
              }
            });
            console.log(`[stripe] dispute funds_reinstated ${dispute.id} — gift ${g.id} kept, marked won`);
          } else {
            // Reversed by an earlier loss — restore from the snapshot.
            const [rev] = await query("SELECT * FROM dispute_reversals WHERE org_id=$1 AND stripe_payment_id=$2", [orgId, piId]);
            if (rev) {
              const snap = typeof rev.gift_snapshot === "string" ? JSON.parse(rev.gift_snapshot) : rev.gift_snapshot;
              await withAdvisoryLock(`gift:${snap.id}`, async () => {
                if ((await query("SELECT id FROM gifts WHERE id=$1", [snap.id])).length) return; // already restored
                snap.dispute_status = "won";
                // Re-insert the gift verbatim (every column the reversal froze).
                const cols = Object.keys(snap).filter(k => snap[k] !== undefined);
                const ph = cols.map((_, i) => "$" + (i + 1)).join(",");
                await run(`INSERT INTO gifts (${cols.join(",")}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`, cols.map(k => snap[k]));
                // Re-stamp the ledger through the ONE ledger helper (same as the
                // online-gift path); idempotent on gift_id.
                try {
                  const ledgerG = await ensureOrgLedger(orgId, { heal: true });
                  const [dn] = await query("SELECT name FROM donors WHERE id=$1", [snap.donor_id]);
                  await run(
                    "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING",
                    ["ft_" + uuid().slice(0, 8), orgId, snap.date, `Gift from ${dn?.name || "Donor"}`, dn?.name || "",
                     snap.amount, "income", ledgerG.contribAcctId, snap.fund_id || ledgerG.genFundId, snap.donor_id, "online", snap.id, SYS_STRIPE.id, SYS_STRIPE.name]);
                } catch (e) { console.error("[stripe] reinstate ledger stamp failed:", e.message); }
                // Un-void + re-link the receipt that was voided on the loss.
                if (rev.receipt_id) await run("UPDATE receipts SET voided_at=NULL, void_reason=NULL, gift_id=$1 WHERE id=$2 AND org_id=$3", [snap.id, rev.receipt_id, orgId]).catch(() => {});
                // Reopen the pledge link if this gift fulfilled one.
                if (snap.pledge_id) {
                  await run("UPDATE pledges SET fulfilled_gift_id=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3", [snap.id, snap.pledge_id, orgId]).catch(() => {});
                  await recalcPledgePayment(snap.pledge_id, orgId).catch(() => {});
                }
                if (snap.donor_id) {
                  await recalcDonorSummary(snap.donor_id, orgId);
                  await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ($1,$2,$3,'note',$4,$5)",
                    ["i_" + uuid().slice(0, 8), orgId, snap.donor_id, `Dispute WON on appeal: $${(parseFloat(snap.amount) || 0).toLocaleString()} online gift reinstated — the reversed gift, ledger entry and receipt were restored`, today]).catch(() => {});
                }
                await run("DELETE FROM dispute_reversals WHERE org_id=$1 AND stripe_payment_id=$2", [orgId, piId]);
                console.log(`[stripe] dispute funds_reinstated ${dispute.id} — gift ${snap.id} RESTORED ($${snap.amount})`);
              });
            } else {
              console.error(`[stripe] dispute funds_reinstated for ${piId} but no gift and no reversal snapshot — manual review needed`);
            }
          }
        }
      }
    }

    // ── Recurring gift recovery: failed-payment detection & dunning ────────
    // BUILD-57 §2a (real-Stripe finding): API 2025+ event payloads moved
    // `invoice.subscription` to `invoice.parent.subscription_details.
    // subscription` — the old top-level read made EVERY invoice-keyed handler
    // (the entire failed-card recovery family) a silent no-op on modern
    // events. Normalize both shapes; same for the line's recurring interval
    // (price.recurring moved under pricing on new payloads).
    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      const invSubId = invoiceSubscriptionId(inv);
      if (invSubId && !(await recoveryEventAlreadyProcessed(event.id))) {
        let subMeta = invoiceSubMetadata(inv);
        if (!subMeta) {
          try {
            const subObj = await stripe.subscriptions.retrieve(invSubId, {}, { stripeAccount: event.account });
            subMeta = subObj.metadata;
          } catch (e) { console.error("[recovery] could not retrieve subscription for payment_failed:", e.message); }
        }

        const resolved = await resolveOrgAndDonorForSubscription(event.account, invSubId, subMeta);
        if (resolved?.donor) {
          const { org, donor } = resolved;
          const amount = inv.amount_due != null ? inv.amount_due / 100 : null;
          const interval = invoiceLineInterval(inv);

          const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [invSubId]);
          const isNewCycle = !existingRows.length || !["past_due", "recovering"].includes(existingRows[0].status);

          if (!existingRows.length) {
            await run(
              `INSERT INTO recurring_subscriptions
                 (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount, interval, status, failure_count, first_failed_at, last_failed_at, dunning_step, next_dunning_at)
               VALUES (?,?,?,?,?,?,?,'past_due',1,NOW(),NOW(),0,NOW())`,
              ["rsub_" + uuid().slice(0, 8), org.id, donor.id, invSubId, inv.customer || null, amount, interval]
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
              [amount, interval, inv.customer || null, invSubId]
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
              [amount, interval, inv.customer || null, invSubId]
            );
          }
          await run("UPDATE donors SET stripe_subscription_status='past_due' WHERE id=? AND org_id=?", [donor.id, org.id]);
          await logRecoveryEvent(org.id, donor.id, invSubId, "payment_failed", event.id, { amount, invoiceId: inv.id });

          // BUILD-13 workflows — recipe #1 (failed_recurring_recovery). Fire
          // only on a genuinely NEW failure cycle (not each Stripe retry),
          // deduped per subscription cycle. If the recipe is ON and sent the
          // recovery email, advance the dunning cadence past its own day-0 so
          // the always-on dunning engine doesn't ALSO send a day-0 email.
          if (isNewCycle) {
            try {
              const [subRow] = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [invSubId]);
              const result = await fireWorkflows(org.id, "recurring_failed", {
                dedupKey: `failed:${invSubId}:${subRow?.first_failed_at || event.id}`,
                donorId: donor.id, amount, subscriptionRow: subRow,
                entityType: "subscription", entityId: invSubId,
              });
              const sentRecovery = result.ran.some(r => r.actions.some(a => a.type === "send_email" && a.template === "recovery"));
              if (sentRecovery && subRow) {
                const next = new Date(new Date(subRow.first_failed_at || Date.now()).getTime() + DUNNING_SCHEDULE_DAYS[1] * 86400000);
                await run("UPDATE recurring_subscriptions SET dunning_step=1, next_dunning_at=? WHERE stripe_subscription_id=?", [next.toISOString(), invSubId]);
              }
            } catch (e) { console.error("[workflow] recurring_failed:", e.message); }
          }
        }
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      const invSubId = invoiceSubscriptionId(inv);
      if (invSubId && !(await recoveryEventAlreadyProcessed(event.id))) {
        const existingRows = await query("SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=?", [invSubId]);
        // BUILD-57 §2a (real-Stripe finding): customer.subscription.updated
        // does NOT fire at creation, so the roster's "next charge" stayed
        // NULL until some later mutation. Every real subscription invoice
        // carries the paid-through period on its line — sync it here, the
        // event that fires on every cycle including the first.
        const paidThrough = inv.lines?.data?.[0]?.period?.end || null;
        if (existingRows.length && paidThrough) {
          await run("UPDATE recurring_subscriptions SET current_period_end=to_timestamp(?), updated_at=NOW() WHERE id=?",
            [paidThrough, existingRows[0].id]).catch(() => {});
        }
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
          await logRecurringChange(rsP.org_id, rsP.id, rsP.donor_id, "resumed",
            { newAmount: rsP.amount != null ? parseFloat(rsP.amount) : null, interval: rsP.interval, actor: "system" });
        }
        if (existingRows.length && ["past_due", "recovering"].includes(existingRows[0].status)) {
          const rs = existingRows[0];
          // BUILD-63 Part 3 — the recovery flip is a COMPARE-AND-SWAP. Both
          // invoice.payment_succeeded AND customer.subscription.updated fire on a
          // recovery and are DIFFERENT events (the event.id dedup can't cross
          // them), so an unconditional check-then-update would let BOTH log
          // 'recovered' and BOTH send the donor thank-you under concurrency. The
          // conditional UPDATE … WHERE status IN (past_due,recovering) RETURNING
          // lets exactly one win; the loser gets zero rows and does no side-effects.
          const flipped = await query(
            `UPDATE recurring_subscriptions SET status='recovered', recovered_at=NOW(), next_dunning_at=NULL, updated_at=NOW()
               WHERE id=? AND status IN ('past_due','recovering') RETURNING id`,
            [rs.id]
          );
          if (flipped.length) {
            const orgRows = await query("SELECT id, name, recurring_dunning_enabled FROM orgs WHERE id=?", [rs.org_id]);
            const org = orgRows[0];
            const donorRows = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
            const donor = donorRows[0];
            if (donor) await run("UPDATE donors SET stripe_subscription_status='active' WHERE id=? AND org_id=?", [donor.id, rs.org_id]);
            await logRecoveryEvent(rs.org_id, rs.donor_id, invSubId, "payment_recovered", event.id, {
              amount: inv.amount_paid != null ? inv.amount_paid / 100 : null,
            });
            await logRecurringChange(rs.org_id, rs.id, rs.donor_id, "recovered",
              { newAmount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, actor: "system" });
            // A recovered renewal is still a real gift — that's recorded by the
            // existing payment_intent.succeeded handler above (fired separately
            // by Stripe for the invoice's underlying charge), not duplicated here.
            if (org && donor?.email && org.recurring_dunning_enabled !== false) {
              await sendRecoveredThankYouEmail(org, donor, rs);
            }
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
            // BUILD-63 Part 3 — COMPARE-AND-SWAP (see the twin in
            // invoice.payment_succeeded). These two DIFFERENT events both fire on
            // a recovery; the atomic conditional flip lets exactly one win, so
            // the movement-log row and the donor thank-you happen once even when
            // both events are processed concurrently on different workers. The
            // old comment "both guard on past_due/recovering, so exactly one can"
            // described the INTENT — the check-then-update didn't enforce it.
            const flipped = await query(
              `UPDATE recurring_subscriptions SET status='recovered', recovered_at=NOW(), next_dunning_at=NULL, updated_at=NOW()
                 WHERE id=? AND status IN ('past_due','recovering') RETURNING id`,
              [rs.id]
            );
            if (flipped.length) {
              await run("UPDATE donors SET stripe_subscription_status='active' WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
              // Record the recurring gift amount so the recovered-dollars figure
              // (GET /impact) stays complete even when recovery lands via this
              // safety-net path (no invoice, so we use the subscription's own
              // tracked amount — the gift that was actually won back).
              await logRecoveryEvent(rs.org_id, rs.donor_id, sub.id, "payment_recovered", event.id, {
                source: "subscription.updated",
                amount: rs.amount != null ? parseFloat(rs.amount) : null,
              });
              await logRecurringChange(rs.org_id, rs.id, rs.donor_id, "recovered",
                { newAmount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, actor: "system" });
              try {
                const [orgT] = await query("SELECT id, name, org_slug, recurring_dunning_enabled, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE id=?", [rs.org_id]);
                const [donorT] = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [rs.donor_id, rs.org_id]);
                if (orgT && donorT?.email && orgT.recurring_dunning_enabled !== false) {
                  await sendRecoveredThankYouEmail(orgT, donorT, rs);
                }
              } catch (e) { console.error("[recovery] safety-net thank-you failed:", e.message); }
            }
          }
          const amount = sub.items?.data?.[0]?.price?.unit_amount != null ? sub.items.data[0].price.unit_amount / 100
            : sub.items?.data?.[0]?.pricing?.unit_amount != null ? sub.items.data[0].pricing.unit_amount / 100 : null;
          if (amount != null) {
            // BUILD-57 — an amount that actually MOVED here changed outside
            // Steward's own paths (those sync rs.amount before this event
            // lands, so old == new and nothing is double-logged).
            const oldAmount = rs.amount != null ? parseFloat(rs.amount) : null;
            if (oldAmount != null && Math.abs(amount - oldAmount) >= 0.005) {
              await logRecurringChange(rs.org_id, rs.id, rs.donor_id,
                amount > oldAmount ? "amount_up" : "amount_down",
                { oldAmount, newAmount: amount, interval: rs.interval, actor: "system" });
            }
            await run("UPDATE recurring_subscriptions SET amount=?, updated_at=NOW() WHERE id=?", [amount, rs.id]);
          }
          // BUILD-57 — sync the roster's "next charge" from Stripe's own
          // current_period_end (this event fires on every renewal cycle).
          // API 2025+ moved it from the subscription onto its ITEMS.
          const cpe = sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
          if (cpe) {
            await run("UPDATE recurring_subscriptions SET current_period_end=to_timestamp(?), updated_at=NOW() WHERE id=?",
              [cpe, rs.id]).catch(() => {});
          }
        }
      }
    }

    // ── THE NETWORK FIXED THE CARD BY ITSELF (2026-09-11) ───────────────────
    // Stripe's Card Account Updater silently replaces an expired or reissued
    // card at the network, and `payment_method.automatically_updated` is how it
    // says so. Without listening for it, the expiry sweep above would email
    // donors whose card was never going to fail — which is worse than not
    // emailing, because it invents a problem and asks them to fix it.
    //
    // So: store the new details, and CLEAR the expiry notice stamp. Clearing is
    // the point. The stamp is keyed to an expiry period; the card now has a new
    // one, and if that one ever approaches the donor should hear about it.
    if (event.type === "payment_method.automatically_updated") {
      const pm = event.data.object;
      const card = pm && pm.card ? pm.card : null;
      if (pm && pm.id && !(await recoveryEventAlreadyProcessed(event.id))) {
        const affected = await query(
          `UPDATE recurring_subscriptions
              SET card_brand=?, card_last4=?, card_exp_month=?, card_exp_year=?,
                  card_checked_at=NOW(), card_expiry_notified_for=NULL, updated_at=NOW()
            WHERE card_payment_method_id=? RETURNING id, org_id, donor_id, stripe_subscription_id`,
          [card ? card.brand : null, card ? card.last4 : null,
           card ? card.exp_month : null, card ? card.exp_year : null, pm.id]);
        for (const rs of affected) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "card_auto_updated", event.id,
            { last4: card ? card.last4 : null, exp: card ? `${card.exp_month}/${card.exp_year}` : null });
        }
        if (affected.length) console.log(`[card-expiry] network updated ${pm.id} → ${affected.length} subscription(s); expiry notice cleared`);
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
          // BUILD-57 — the churn SPLIT, decided where the context lives:
          // a subscription that died while past_due/recovering was lost to a
          // failed card (involuntary — a technical problem); one deleted from
          // 'active'/'paused' was a choice made outside Steward (voluntary).
          // A row already 'canceled' was logged by the portal/staff cancel
          // path that initiated it — logging again would double-count churn.
          if (rs.status !== "canceled") {
            const churnKind = ["past_due", "recovering"].includes(rs.status)
              ? "canceled_involuntary" : "canceled_voluntary";
            await logRecurringChange(rs.org_id, rs.id, rs.donor_id, churnKind,
              { oldAmount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, actor: "system" });
            // An INVOLUNTARY loss gets a human too. This is the second caller
            // and it is not redundant: an org with recurring_dunning_enabled
            // off never runs a cadence to exhaust, so without this branch its
            // failed sustainers would die with nobody told. One open thread per
            // donor means the two callers can never stack.
            if (churnKind === "canceled_involuntary") {
              await openSustainerLapseThread(rs.org_id, rs.donor_id, {
                amount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, reason: "canceled_involuntary" });
            }
          }
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
// ── BUILD-94 Part 4 — resolving the org from what WE verified ──────────────
// Never from the payload. The From address on a Resend event is compared to
// the sending identities this product actually configured: an org's verified
// sending domain, or (on the shared domain) nothing — a shared-domain From
// identifies Steward, not a tenant, and guessing would mark the wrong person.
async function orgIdForVerifiedFrom(rawFrom) {
  const m = /<([^>]+)>\s*$/.exec(String(rawFrom || "").trim());
  const addr = String(m ? m[1] : rawFrom || "").trim().toLowerCase();
  if (!addr || !addr.includes("@")) return null;
  const domain = addr.split("@")[1];
  if (!domain) return null;
  const rows = await query(
    `SELECT id FROM orgs
      WHERE sending_domain_status = 'verified'
        AND LOWER(sending_domain) = ?
        AND LOWER(sending_from_email) = ?
      LIMIT 2`, [domain, addr]).catch(() => []);
  // Exactly one, or nobody. Two orgs claiming one verified address is a
  // configuration fault, and marking a person on a coin flip is worse than
  // marking nobody.
  return rows.length === 1 ? rows[0].id : null;
}

// A hard bounce makes the ADDRESS unreachable, with the date and reason on the
// profile. A complaint makes the PERSON unsubscribed — somebody pressed "this
// is spam", which is the strongest opt-out signal there is. Both write a
// timeline line, because "why did we stop emailing them" has to be answerable.
async function markEmailEvent(orgId, email, reason, event) {
  const rows = await query(
    `SELECT id, name FROM donors WHERE org_id = ? AND LOWER(email) = ? AND deleted_at IS NULL`,
    [orgId, email]);
  if (!rows.length) return 0;
  const detail = String(event?.data?.bounce?.message || event?.data?.reason || "").slice(0, 200) || null;
  for (const d of rows) {
    if (reason === "bounced") {
      await run(
        `UPDATE donors SET email_unreachable = true, email_unreachable_at = NOW(),
                           email_unreachable_reason = ? WHERE id = ?`, [detail, d.id]);
    } else {
      await run(`UPDATE donors SET do_not_email = true WHERE id = ?`, [d.id]);
    }
    await run(
      `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by)
       VALUES (?,?,?,'email',?,?,?)`,
      ["i_" + uuid().slice(0, 8), orgId, d.id,
       reason === "bounced"
         ? `Email to ${email} hard-bounced and will not be tried again${detail ? ` — ${detail}` : ""}`
         : `${email} marked this as spam — removed from every list`,
       new Date().toISOString().slice(0, 10), "system:resend-webhook"]);
  }
  return rows.length;
}

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
        // ── BUILD-94 Part 4 — MARK THE PERSON, IN THE RIGHT ORG ────────────
        // THE ORG COMES FROM THE VERIFIED ACCOUNT MAPPING, NEVER THE PAYLOAD
        // (BUILD-37 B9). A webhook body is attacker-shaped input; the only
        // trustworthy org signal in it is the FROM address, and even that is
        // only trustworthy because we look it up against the sending domains
        // WE verified. An unrecognised From marks nobody — a bounce that
        // cannot be attributed is still suppressed globally above, which is
        // the reputation half and is what actually matters.
        const orgIdForEvent = await orgIdForVerifiedFrom(event?.data?.from);
        if (orgIdForEvent) {
          await markEmailEvent(orgIdForEvent, email, reason, event);
        } else {
          console.log(`[resend-webhook] ${type} for ${email} — no verified sender mapping, suppressed globally only`);
        }
        console.log(`[resend-webhook] ${type} for ${email} — suppressed globally${orgIdForEvent ? ` + marked in ${orgIdForEvent}` : ""}`);
      }
    }
    // Other event types (delivered, opened, clicked, etc.) are no-ops for now.
    res.json({ received: true });
  } catch (err) {
    console.error("[resend-webhook] handling error:", err.message);
    res.status(500).json({ error: "Internal error processing webhook" });
  }
});

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
      // BUILD-90 90a — A CLOSE-LINK COMPLETION HAS NO ORG YET. This is the one
      // Checkout that CREATES the customer rather than belonging to one: the
      // org, its first admin and its subscription are all born here, which is
      // why nothing exists until Stripe says the card went in.
      if (!orgId && obj.metadata?.closeLinkId) {
        await provisionOrgFromCloseLink(obj);
      } else if (orgId) {
        const plan = BILLING_PLAN_VALUES.has(obj.metadata?.plan) ? obj.metadata.plan : "core";
        let periodEnd = null;
        // BUILD-90: a checkout that starts in a TRIAL must leave the org
        // `trialing`, not `active` — otherwise Settings stops showing the date
        // she was promised on the very screen she was promised it.
        let status = "active";
        let trialEnd = null;
        if (obj.subscription) {
          try {
            const sub = await billingStripe.subscriptions.retrieve(obj.subscription);
            periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
            if (sub.status === "trialing") {
              status = "trialing";
              trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
            }
          } catch {}
        }
        await run(
          `UPDATE orgs SET plan=?, subscription_status=?, stripe_subscription_id=?, current_period_end=?,
                  trial_ends_at=COALESCE(?, trial_ends_at), grace_until=NULL WHERE id=?`,
          [plan, status, obj.subscription || null, periodEnd, trialEnd, orgId]
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
          // BUILD-90: Stripe's `trialing` stays OUR `trialing`. It used to be
          // flattened to `active`, which meant a card update during the trial
          // silently erased the trial from Settings. The trial END is re-read
          // from the same event: Stripe holds the date the contract names, and
          // NOTHING inside Steward writes it — not an import, not a second
          // import, not a rescheduled onboarding meeting.
          const trialing = s === "trialing";
          const status = trialing ? "trialing" : "active";
          const trialEnd = trialing && obj.trial_end ? new Date(obj.trial_end * 1000).toISOString() : null;
          if (obj.id) await refreshBillingCard(orgId, obj.id).catch(() => {});
          if (plan) {
            await run("UPDATE orgs SET plan=?, subscription_status=?, current_period_end=?, trial_ends_at=COALESCE(?, trial_ends_at), grace_until=NULL WHERE id=?", [plan, status, periodEnd, trialEnd, orgId]);
          } else {
            await run("UPDATE orgs SET subscription_status=?, current_period_end=?, trial_ends_at=COALESCE(?, trial_ends_at), grace_until=NULL WHERE id=?", [status, periodEnd, trialEnd, orgId]);
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

// ── BUILD-102 (Steward Give) Part 3 — WHAT THE FORM ASKED, APPLIED ─────────
// A tribute rides BUILD-98 Part 1's `writeGiftExtras`, so a tribute notice is a
// DRAFT and Steward never sends it; the employer opens BUILD-98's match pledge on
// the employer's own record; an answer lands in the BUILD-78 custom-field value
// the report builder already reads. Three existing seams, no fourth.
//
// NOTHING HERE IS A SECOND GIFT PATH. The gift already exists when this runs, and
// this only hangs the answers off it — so a failure costs the tribute draft, never
// the donation.
async function applyFormAsks(orgId, gift, meta, who) {
  await GC_READY;
  const out = { tribute: false, tributeNotice: false, matchPledgeId: null, answers: 0, created: 0, unresolved: [] };
  const md = meta || {};
  const cache = new Map(), made = { count: 0 };
  const raw = {};

  const tributeType = GC.normaliseTributeType(md.tribute_type || "");
  const tributeName = String(md.tribute_name || "").trim();
  if (tributeType && tributeName) {
    // THE HONOUREE IS A RECORD WHEN THERE IS ONE AND A NAME WHEN THERE IS NOT —
    // the BUILD-98 rule. A form never invents a record for a memorial: somebody
    // who has died is not a prospect, and creating one would put them on a
    // mailing list.
    const hid = await donorByNameOrCreate(orgId, tributeName, { create: false, cache });
    raw.tribute = { type: tributeType, donorId: hid, name: tributeName,
                    notifyName: String(md.notify_name || "").trim() || null,
                    notifyEmail: String(md.notify_email || "").trim() || null };
  }

  const employer = String(md.employer || "").trim();
  if (employer) {
    // AN EMPLOYER IS AN ORGANISATION, found or created as one — the same call the
    // importer makes, so a form and a spreadsheet cannot disagree about it.
    const eid = await donorByNameOrCreate(orgId, employer, { create: true, kind: "organisation", who, cache, made });
    if (eid && eid !== gift.donor_id) raw.match = { employerId: eid };
    out.created = made.count;
  }

  if (raw.tribute || raw.match) {
    const cents = money.toCents(gift.amount) ?? 0;
    const ck = await checkGiftExtras(orgId, gift.donor_id, cents, raw);
    if (ck.errors || ck.notFound) {
      out.unresolved.push({ kind: "extras", why: (ck.errors || ["not found"]).join("; ") });
    } else {
      const r = await writeGiftExtras(orgId, gift, ck.extras, { actorId: who.id, actorName: who.name });
      out.tribute = !!ck.extras.tribute;
      out.tributeNotice = !!r.tributeNotice;
      out.matchPledgeId = r.matchPledgeId || null;
    }
  }

  // THE ANSWERS. `custom_field_defs` + `donors.custom_fields` is the pair the
  // report builder reads (`d.custom_fields->>'key'`), which is what makes an
  // answer filterable in a saved report like any other field. An answer to a
  // question whose definition has since been archived is DROPPED rather than
  // written somewhere nothing can see it.
  const answers = Object.entries(md).filter(([k]) => k.startsWith("q_"))
    .map(([k, v]) => [k.slice(2), v]).filter(([k]) => k);
  if (answers.length) {
    const defs = await query(
      "SELECT key, type FROM custom_field_defs WHERE org_id=? AND entity='donor' AND archived_at IS NULL", [orgId]);
    const known = new Map(defs.map(d => [d.key, d.type]));
    const patch = {};
    for (const [k, v] of answers) {
      const t = known.get(k);
      if (!t) { out.unresolved.push({ kind: "answer", name: k, why: "no field on file" }); continue; }
      patch[k] = t === "checkbox" ? (String(v) === "yes") : String(v);
    }
    if (Object.keys(patch).length) {
      // Merged, never replaced: a donor who answered a different form last year
      // keeps that answer.
      await run(
        `UPDATE donors SET custom_fields = COALESCE(custom_fields,'{}'::jsonb) || ?::jsonb, updated_at=NOW()
          WHERE id=? AND org_id=?`, [JSON.stringify(patch), gift.donor_id, orgId]);
      out.answers = Object.keys(patch).length;
    }
  }
  return out;
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

// ── BUILD-94 Part 4 — A GET NEVER CHANGES STATE ────────────────────────────
// This page used to unsubscribe ON GET. That is the standing rule broken in
// the one place it costs a real person something: every corporate link
// scanner, every mail-client prefetcher and every "check this link is safe"
// proxy follows links in mail, and each one of them was silently unsubscribing
// somebody who had not clicked anything. Gmail's own RFC 8058 one-click POSTs,
// which is why the POST half was already correct — the GET was the leak.
//
// So: GET RENDERS. It says which organisation it is about (a person on four
// nonprofits' lists cannot answer "unsubscribe from what?"), and it carries
// ONE button that POSTs. Three states, one page.
function unsubscribeHtml({ ok, email, orgName, token, done }) {
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const who = orgName ? `<strong>${esc(orgName)}</strong>` : "this organisation";
  const message = !ok
    ? `<h1>Link expired</h1><p>This unsubscribe link is invalid or has expired. If you're still receiving unwanted emails, reply to any message and ask to be removed.</p>`
    : done
      ? `<h1>You're unsubscribed</h1><p>${email ? `<strong>${esc(email)}</strong> ` : ""}won't receive any more emails from ${who}. It can take a few minutes to fully take effect.</p>`
      : `<h1>Unsubscribe from ${esc(orgName || "these emails")}?</h1>
         <p>${email ? `<strong>${esc(email)}</strong> ` : "You "}will stop receiving emails from ${who}.
            Receipts for gifts you make will still be sent — those are records, not mail.</p>
         <form method="POST" action="/unsubscribe?token=${encodeURIComponent(token || "")}">
           <button type="submit" class="go">Unsubscribe me</button>
         </form>`;
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
  form { margin:22px 0 0; }
  .go { font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff;
        background:#0d5c3a; border:none; border-radius:10px; padding:12px 26px; cursor:pointer; }
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
// The name to put on the unsubscribe page. The portal display name when the
// org set one (the W-2 white-label rule — a donor sees "CREO Arts", never the
// staff-side "CREO Arts (Demo)"), and the org's own name otherwise. It must
// never come back empty: "unsubscribe from what?" is unanswerable for someone
// on four nonprofits' lists, which is the whole reason the name is here.
async function unsubscribeOrgName(orgId) {
  const [o] = await query("SELECT name FROM orgs WHERE id = ?", [orgId]).catch(() => []);
  return await donorFacingOrgName(orgId, o?.name || "").catch(() => o?.name || "") || o?.name || "";
}
app = routers.r1;

// GET RENDERS AND CHANGES NOTHING (BUILD-94 Part 4). One click, on the page,
// POSTs. No login: a person who wants out must not have to make an account.
app.get("/unsubscribe", wrap(async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.query.token);
  res.set("Content-Type", "text/html");
  if (!decoded) return res.status(400).send(unsubscribeHtml({ ok: false }));
  const orgName = await unsubscribeOrgName(decoded.orgId);
  res.send(unsubscribeHtml({ ok: true, email: decoded.email, orgName, token: req.query.token, done: false }));
}));

// POST — the one click, and RFC 8058's one-click too: Gmail/Outlook POST here
// silently when the recipient taps the native unsubscribe button. Both land on
// the same line, which is why there is only one of them.
app.post("/unsubscribe", wrap(async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.query.token);
  if (!decoded) return res.status(400).end();
  await recordUnsubscribe(decoded.email, decoded.orgId, decoded.source);
  // A mail client's one-click POST wants a bare 200; a person who pressed the
  // button on the page wants to be told it worked.
  if (!/text\/html/.test(String(req.headers.accept || ""))) return res.status(200).end();
  const orgName = await unsubscribeOrgName(decoded.orgId);
  res.set("Content-Type", "text/html");
  res.send(unsubscribeHtml({ ok: true, email: decoded.email, orgName, done: true }));
}));

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

// Short "you're all set" note — a warm confirmation, not another ask.
// TRANSACTIONAL (W-4): rides the same policy as dunning.
async function sendRecoveredThankYouEmail(org, donor, subscriptionRow) {
  const decision = await donorMailDecision("recovered_thankyou", donor.email, org.id);
  if (!decision.send) return;
  const dfName = await donorFacingOrgName(org.id, org.name); // W-2 white-label
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  const amountStr = subscriptionRow.amount != null ? `$${Number(subscriptionRow.amount).toLocaleString()}` : "your";
  const subject = "You're all set — thank you!";
  const bodyHtml = `<p>Hi ${firstName},</p>
<p>Great news — your card on file worked, and your ${amountStr} gift to ${dfName} went through. Your recurring support is active again, and we're so grateful for it.</p>
<p>Thank you for sticking with us.</p>
<p>With gratitude,<br/>${dfName}</p>`
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = await donorFromAddress(org.id); // BUILD-64: the org's name in the inbox
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        ...(await donorSendOpts(org.id, donor.email, "campaign")),
        to: donor.email, subject, html: bodyHtml,
      });
      if (sendErr) console.error("[dunning] recovered-email send error:", sendErr.message);
    } catch (e) { console.error("[dunning] recovered-email resend error:", e.message); }
  }
}

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

  const amountCents = amount ? toCents(amount) : null;   // BUILD-73: the money seam
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

// BUILD-90 90b — THE CARD, AS SHE WOULD RECOGNISE IT.
// A warning seven days before a charge has to name the card it will hit, or it
// is asking her to go and look. Stored on the org and refreshed whenever the
// subscription changes, so /billing/status stays one query rather than a Stripe
// round trip on every page load.
function cardFromStripeObjects(sub, customer) {
  const pm = (sub && typeof sub.default_payment_method === "object" && sub.default_payment_method)
    || (customer && customer.invoice_settings && typeof customer.invoice_settings.default_payment_method === "object"
        && customer.invoice_settings.default_payment_method)
    || null;
  if (!pm || !pm.card) return null;
  return { brand: pm.card.brand || null, last4: pm.card.last4 || null };
}

async function refreshBillingCard(orgId, subscriptionId) {
  if (!billingStripe || !subscriptionId) return null;
  try {
    const sub = await billingStripe.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"],
    });
    const card = cardFromStripeObjects(sub, typeof sub.customer === "object" ? sub.customer : null);
    if (!card) return null;
    await run("UPDATE orgs SET billing_card_brand=?, billing_card_last4=? WHERE id=?", [card.brand, card.last4, orgId]);
    return card;
  } catch (e) {
    console.error("[billing] card refresh failed for", orgId, e.message);
    return null;
  }
}

// ── BUILD-90 90a · THE CLOSE LINK ──────────────────────────────────────────
// Public signup is closed. This is the ONE door that creates an organisation,
// and only a super-admin may open it: Jonathan takes org name, contact email
// and plan, and hands the executive director a Stripe Checkout URL on his
// laptop or her phone. NOTHING is charged. The card is saved, a thirty-day
// trial starts the instant she completes Checkout, and the Checkout page
// itself states the first charge date and the promise that makes signing safe.
//
// Nothing exists in Steward until Stripe says the card went in — an unopened
// link leaves no org, no user and no subscription behind. The org, the first
// admin and the subscription are all created by the webhook (below).

// The email that reaches her the moment the org exists. It is a SET-PASSWORD
// link (the account is created with an unguessable random password she is
// never told), reusing the password_reset_tokens family with a seven-day life
// rather than the one-hour reset window — she may be signing on a Tuesday and
// sitting down with the product on Friday.
async function sendCloseWelcomeEmail({ userId, email, orgName, plan, trialEndsAt, tz }) {
  const token = crypto.randomBytes(32).toString("hex");
  await run(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL '7 days')`,
    ["prt_" + uuid().slice(0, 8), userId, token]
  );
  const link = `${publicAppUrl()}/reset-password?token=${token}`;
  const charge = firstChargeSentence({ monthlyUsd: plan.monthlyUsd, firstChargeAt: trialEndsAt, tz });
  const from = process.env.FOUNDER_EMAIL || process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (!process.env.RESEND_API_KEY) {
    console.warn("[close-link] RESEND_API_KEY not set — welcome email not sent to", email);
    return { sent: false, link };
  }
  try {
    const { error } = await resend.emails.send({
      from, to: email, replyTo: from,
      subject: `${displayNameCase(orgName)} is set up on Steward`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:40px 16px;">
    <tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:24px;text-align:center;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</span>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;line-height:1.2;">${displayNameCase(orgName)} is set up</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#5A554F;line-height:1.6;">Set your password and you're in. This link works for seven days.</p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border-radius:10px;background:#c9a84c;">
          <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#0f1a12;text-decoration:none;letter-spacing:-0.01em;">Set your password &rarr;</a>
        </td></tr></table>
        <p style="margin:0 0 8px;font-size:14px;color:#0f1a12;line-height:1.6;"><strong>${charge}</strong> Cancel any time before then and you pay nothing. After that it is month to month, and you can cancel any time from Settings.</p>
        <p style="margin:0;font-size:12px;color:#8a857f;">Or copy this link: <span style="color:#0f1a12;word-break:break-all;">${link}</span></p>
      </td></tr>
      <tr><td style="padding-top:20px;text-align:center;font-size:12px;color:#8a857f;">Steward &middot; stewardapp.dev</td></tr>
    </table></td></tr>
  </table>
</body></html>`,
    });
    if (error) throw new Error(error.message);
    return { sent: true, link };
  } catch (e) {
    console.error("[close-link] welcome email failed:", e.message);
    return { sent: false, link };
  }
}

// The same moment, for an org that ALREADY HAS ACCOUNTS. Deliberately NOT the
// welcome email: there is no password to set, no seven-day link, and telling a
// customer who has been using Steward for months to "set your password and
// you're in" reads as though nobody knew who they were. This says the one thing
// that actually changed - what they are on, and when the first charge lands.
async function sendExistingOrgCloseEmail({ email, orgName, plan, trialEndsAt, tz }) {
  const charge = firstChargeSentence({ monthlyUsd: plan.monthlyUsd, firstChargeAt: trialEndsAt, tz });
  const from = process.env.FOUNDER_EMAIL || process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  const settings = `${publicAppUrl()}/settings`;
  if (!process.env.RESEND_API_KEY) {
    console.warn("[close-link] RESEND_API_KEY not set - confirmation not sent to", email);
    return { sent: false };
  }
  try {
    const { error } = await resend.emails.send({
      from, to: email, replyTo: from,
      subject: `${displayNameCase(orgName)} is on Steward ${plan.name}`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:40px 16px;">
    <tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:24px;text-align:center;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</span>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;line-height:1.2;">${displayNameCase(orgName)} is on ${plan.name}</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#5A554F;line-height:1.6;">Your card is on file. Nothing has been charged, and you sign in exactly as you always have.</p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f1a12;line-height:1.6;"><strong>${charge}</strong> Cancel any time before then and you pay nothing. After that it is month to month, and you can cancel any time from Settings.</p>
        <p style="margin:0;font-size:12px;color:#8a857f;">Billing lives in <span style="color:#0f1a12;word-break:break-all;">${settings}</span></p>
      </td></tr>
      <tr><td style="padding-top:20px;text-align:center;font-size:12px;color:#8a857f;">Steward &middot; stewardapp.dev</td></tr>
    </table></td></tr>
  </table>
</body></html>`,
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  } catch (e) {
    console.error("[close-link] confirmation email failed:", e.message);
    return { sent: false };
  }
}

// Turn a COMPLETED Checkout session into an organisation. Called only from the
// billing webhook. Idempotent: a redelivered event, or a refreshed success
// page, finds `close_links.org_id` already set and returns the same org rather
// than minting a second one.
async function provisionOrgFromCloseLink(session) {
  const closeLinkId = session?.metadata?.closeLinkId;
  if (!closeLinkId) return null;
  const rows = await query("SELECT * FROM close_links WHERE id=?", [closeLinkId]);
  if (!rows.length) {
    console.error(`[close-link] CRITICAL: session ${session.id} names close link ${closeLinkId}, which does not exist`);
    return null;
  }
  const link = rows[0];
  if (link.org_id) {
    console.log(`[close-link] ${closeLinkId} already provisioned org ${link.org_id} — no-op`);
    return link.org_id;
  }
  const plan = closePlan(link.plan) || closePlan("core");
  const email = String(link.contact_email).trim().toLowerCase();

  // A link minted against an org that ALREADY EXISTS attaches a subscription
  // and creates nothing. The clash check below is skipped for it on purpose:
  // the contact email is that org's own admin, so of course it has an account,
  // and that is the whole reason this path exists.
  const attachToOrgId = link.target_org_id || null;

  // A pre-existing account with this address means a NEW-org close link is
  // pointed at somebody who already has one. Do NOT half-provision and do NOT
  // move a user between organisations: leave the link OPEN and say so loudly,
  // so it is resolved by a human rather than by a guess.
  if (!attachToOrgId) {
    const clash = await query("SELECT id, org_id FROM users WHERE lower(email) = lower(btrim(?))", [email]);
    if (clash.length) {
      console.error(`[close-link] CRITICAL: ${closeLinkId} completed but ${email} already belongs to org ${clash[0].org_id}. ` +
        `No org created. Cancel the Stripe subscription or repoint the link by hand.`);
      if (process.env.SENTRY_DSN) Sentry.captureMessage(`close-link ${closeLinkId}: contact email already has an account`, "error");
      return null;
    }
  }

  // The subscription carries the dates. We READ the trial end off Stripe rather
  // than recomputing it, so Stripe and Steward cannot disagree about the one
  // date the contract names; trialEnd.js defines the same arithmetic and
  // tests/trial-end.test.js pins it.
  let sub = null;
  if (session.subscription && billingStripe) {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    try { sub = await billingStripe.subscriptions.retrieve(subId); }
    catch (e) { console.error("[close-link] could not retrieve subscription:", e.message); }
  }
  const signedAt = sub?.trial_start ? new Date(sub.trial_start * 1000) : new Date();
  const trialEndsAt = sub?.trial_end ? new Date(sub.trial_end * 1000) : computeTrialEnd(signedAt);

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const subId = sub?.id || (typeof session.subscription === "string" ? session.subscription : null);

  // ── THE ORG ALREADY EXISTS: ATTACH, DO NOT CREATE ────────────────────────
  // No org row, no user row, no workflow provisioning, no ledger - all of that
  // is already theirs and re-running it would either fail on a constraint or
  // quietly duplicate somebody's setup. The only thing a close changes about
  // an existing organisation is what it is paying and when it starts.
  if (attachToOrgId) {
    const existing = await query("SELECT id, name FROM orgs WHERE id=?", [attachToOrgId]);
    if (!existing.length) {
      console.error(`[close-link] CRITICAL: ${closeLinkId} targets org ${attachToOrgId}, which no longer exists. ` +
        `Nothing was changed. Cancel the Stripe subscription by hand.`);
      if (process.env.SENTRY_DSN) Sentry.captureMessage(`close-link ${closeLinkId}: target org vanished`, "error");
      return null;
    }
    await run(
      `UPDATE orgs SET plan=?, subscription_status='trialing', signed_at=?, trial_ends_at=?,
                       stripe_subscription_id=?, close_link_id=?, ${billingCustomerColumn()}=?
        WHERE id=?`,
      [plan.id, signedAt.toISOString(), trialEndsAt.toISOString(), subId, closeLinkId, customerId, attachToOrgId]
    );
    await run(
      `UPDATE close_links SET status='completed', org_id=?, stripe_customer_id=?, stripe_subscription_id=?, completed_at=NOW() WHERE id=?`,
      [attachToOrgId, customerId, subId, closeLinkId]
    );
    await refreshBillingCard(attachToOrgId, subId).catch(() => {});

    const tzExisting = await orgTzName(attachToOrgId);
    const mailExisting = await sendExistingOrgCloseEmail({
      email, orgName: existing[0].name, plan, trialEndsAt, tz: tzExisting,
    });
    console.log(`[close-link] ${closeLinkId} -> EXISTING org ${attachToOrgId} on ${plan.id}, trial ends ` +
      `${trialEndsAt.toISOString()} (confirmation ${mailExisting.sent ? "sent" : "NOT sent"})`);
    return attachToOrgId;
  }

  const orgId = "org_" + uuid().slice(0, 8);
  const userId = "user_" + uuid().slice(0, 8);
  const orgSlug = String(link.org_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + orgId.slice(4, 10);

  await run(
    `INSERT INTO orgs (id, name, onboarding_complete, org_slug, plan, subscription_status,
                       signed_at, trial_ends_at, stripe_subscription_id, close_link_id, ${billingCustomerColumn()}, emails_enabled)
     VALUES (?,?,0,?,?,'trialing',?,?,?,?,?,false)`,
    [orgId, link.org_name, orgSlug, plan.id, signedAt.toISOString(), trialEndsAt.toISOString(), subId, closeLinkId, customerId]
  );
  await ensureOrgLedger(orgId).catch(e => console.error("[close-link] ledger provisioning:", e.message));

  // The first admin. The password is random and never disclosed — she sets her
  // own through the link in the welcome email.
  const hash = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 12);
  await run(
    "INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,?)",
    [userId, orgId, email, hash, inviteeDisplayName(email), "admin"]
  );
  await provisionNewOrgWorkflows(orgId).catch(e => console.error("[close-link] provision workflows:", e.message));

  await run(
    `UPDATE close_links SET status='completed', org_id=?, stripe_customer_id=?, stripe_subscription_id=?, completed_at=NOW() WHERE id=?`,
    [orgId, customerId, subId, closeLinkId]
  );
  // The card she just put in, so the seven-day reminder can name it.
  await refreshBillingCard(orgId, subId).catch(() => {});

  const tz = await orgTzName(orgId);
  const mail = await sendCloseWelcomeEmail({ userId, email, orgName: link.org_name, plan, trialEndsAt, tz });
  console.log(`[close-link] ${closeLinkId} → org ${orgId}, admin ${email}, trial ends ${trialEndsAt.toISOString()} (welcome email ${mail.sent ? "sent" : "NOT sent"})`);
  return orgId;
}

// ── BUILD-101 Part 4 — A MEMBERSHIP BOUGHT ONLINE ─────────────────────────
// The ONE step that turns an online membership payment into a membership. It
// is keyed on the GIFT: the payment event and the checkout event for a new
// auto-renewing membership arrive in either order, and whichever gets here
// second finds the gift already carries its membership and does nothing. A
// person who already holds a membership is RENEWED (from the old expiry);
// anyone else joins.
async function attachOnlineMembership({ orgId, donorId, levelId, giftId }) {
  await MB_READY;
  if (!giftId || !levelId) return null;
  const [level] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [levelId, orgId]);
  if (!level) return null;
  return withAdvisoryLock(`membership-gift:${orgId}:${giftId}`, async () => {
    const [done] = await query(`SELECT id FROM memberships WHERE org_id=? AND gift_id=?`, [orgId, giftId]);
    if (done) return { membershipId: done.id, duplicate: true };
    // The benefits split rides the gift (the webhook set it from the level it
    // re-read; this makes sure of it for a gift written before the level was known).
    const fmv = mbCents(level.fmv) / 100;
    await run(`UPDATE gifts SET quid_pro_quo_value=LEAST(amount, ?), quid_pro_quo_desc=?, deductible_amount=GREATEST(0, amount - ?)
                WHERE id=? AND org_id=? AND quid_pro_quo_value IS NULL`,
      [fmv, MB.quidProQuoDescription({ levelName: level.name, benefits: level.benefits || [] }), fmv, giftId, orgId]);
    const [cur] = await query(`SELECT id FROM memberships WHERE org_id=? AND donor_id=? AND status IN ('active','grace')`, [orgId, donorId]);
    const r = cur
      ? await renewMembership({ orgId, membershipId: cur.id, levelId: level.id, existingGiftId: giftId, paymentMethod: "Card",
                                source: "online", who: SYS_STRIPE })
      : await enrollMembership({ orgId, donorId, level, existingGiftId: giftId, paymentMethod: "Card", source: "online", who: SYS_STRIPE });
    return { membershipId: r.membership.id };
  });
}

// The provider posts with this shared secret. Configuring it is part of
// turning the flag on: with the surface enabled and no secret set, the route
// answers 503 rather than accepting unauthenticated writes (the
// RESEND_WEBHOOK_SECRET precedent above).
function inboundSecretOk(req) {
  const want = process.env.INBOUND_EMAIL_SECRET || "";
  if (!want) return null; // unconfigured
  const got = String(req.headers["x-inbound-secret"] || req.query.secret || "");
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function recordInboundDrop(orgId, reason) {
  try {
    await run("INSERT INTO inbound_email_drops (id, org_id, reason) VALUES (?,?,?)",
      ["ied_" + uuid().slice(0, 8), orgId || null, reason]);
  } catch (e) { console.error("[inbound-email] drop count:", e.message); }
}

// POST /inbound-email — the provider-agnostic webhook.
// Body: { to, from, subject, text, html, date } (cc / envelopeTo / recipient
// are also read when a provider sends them — a BCC is invisible in the headers,
// so the logging address usually arrives only as an envelope recipient).
app.post("/inbound-email", requireFlag(INBOUND_EMAIL_ENABLED), wrap(async (req, res) => {
  const authed = inboundSecretOk(req);
  if (authed === null) return res.status(503).json({ error: "Inbound email not configured" });
  if (!authed) return res.status(401).json({ error: "Unauthorized" });
  if (!INBOUND_EMAIL_DOMAIN) return res.status(503).json({ error: "Inbound email not configured" });

  const IE = await inboundMod();
  const payload = req.body || {};

  // 1 · the org, from the plus-address only.
  const slug = IE.orgSlugFromPayload(payload, INBOUND_EMAIL_DOMAIN);
  if (!slug) { await recordInboundDrop(null, "no_org"); return res.json({ received: true, action: "drop" }); }
  const orgRows = await query("SELECT id, org_slug FROM orgs WHERE org_slug = ?", [slug]);
  if (!orgRows.length) { await recordInboundDrop(null, "unknown_org"); return res.json({ received: true, action: "drop" }); }
  const org = orgRows[0];

  // 2 · the sender must be a user of THAT org. Scoped by org_id in the query
  //     itself, so org B's staff mailing org A's address never even resolves.
  const from = IE.normalizeEmail(payload.from);
  const senderRows = from
    ? await query("SELECT id, name FROM users WHERE org_id = ? AND LOWER(email) = ?", [org.id, from])
    : [];
  if (!senderRows.length) { await recordInboundDrop(org.id, "sender_not_user"); return res.json({ received: true, action: "drop" }); }

  const userRows = await query("SELECT email FROM users WHERE org_id = ?", [org.id]);
  const donorRows = await query(
    "SELECT id, name, email FROM donors WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email <> ''",
    [org.id]);

  const decision = IE.classifyInbound(payload, {
    domain: INBOUND_EMAIL_DOMAIN,
    today: orgToday(await orgTz(org.id)),
    orgSlug: org.org_slug,
    senderIsUser: true,
    donors: donorRows,
    userEmails: userRows.map(u => u.email),
  });

  if (decision.action === "drop") {
    await recordInboundDrop(org.id, decision.reason);
    return res.json({ received: true, action: "drop" });
  }

  // 3 · exactly one donor → an `email` activity on that donor, now. Synchronous
  //     on the webhook, no queue: the director who BCCs a test wants to see it
  //     on the screen a minute later, and a background pass cannot promise that.
  //     The actor is the SYSTEM path that wrote it (BUILD-75 C.1) and the
  //     display name is the staff member whose mail it was.
  if (decision.action === "log") {
    const id = "int_" + uuid().slice(0, 8);
    const note = decision.subject + (decision.body ? "\n\n" + decision.body : "");
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, org.id, decision.donorId, "email", note, decision.date,
       "system:inbound-email", senderRows[0].name || from,
       JSON.stringify({ via: "inbound_email", from, to: decision.to, subject: decision.subject, direction: "outbound" })]
    );
    return res.json({ received: true, action: "log", donorId: decision.donorId });
  }

  // 4 · zero or several matches → held for a human. NEVER a new donor.
  const uid = "iem_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO inbound_email_unmatched (id,org_id,kind,from_email,to_emails,subject,body,message_date,candidates,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [uid, org.id, decision.kind, from, decision.to, decision.subject, decision.body, decision.date,
     JSON.stringify(decision.candidates || []), "system:inbound-email", senderRows[0].name || from]
  );
  res.json({ received: true, action: "hold", kind: decision.kind });
}));
}

module.exports = { routers, mount };
