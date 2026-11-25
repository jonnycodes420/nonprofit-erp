// server/onboard/startComplete.js · ONBOARD-1 Stage 1. STRIPE SAYS THE CARD WENT IN.
//
// Called from the billing webhook for a checkout.session.completed that names
// a start link. It attaches the subscription (or, at $0, the saved card) to
// the org the link was raised for, reads the trial end OFF STRIPE (BUILD-90:
// Stripe and Steward cannot disagree about the date the contract names), and
// then asks the one paper question: is there a signature AND a card? Only
// both together stamp `orgs.paper_done_at`, the signal ONBOARD-2 reads.
//
// Idempotent: a redelivered event finds the link completed and the stamp set.
"use strict";

let deps = null;
function configure(d) { deps = d; }

const iso = s => (s ? new Date(s * 1000).toISOString() : null);

async function cardFromPaymentMethod(pm) {
  return pm && typeof pm === "object" && pm.card ? { brand: pm.card.brand || null, last4: pm.card.last4 || null } : null;
}

// The one gate. Signature and card are one thing: either alone is not paper.
async function stampPaperDone(orgId) {
  const { run } = deps;
  await run(`UPDATE orgs SET paper_done_at = NOW()
              WHERE id=? AND paper_done_at IS NULL
                AND EXISTS (SELECT 1 FROM start_signatures s WHERE s.org_id = orgs.id)
                AND (billing_card_last4 IS NOT NULL OR billing_card_saved_at IS NOT NULL)`, [orgId]);
}

async function onCheckoutCompleted(session) {
  const { query, run, billingStripe, billingCustomerColumn } = deps;
  const linkId = session && session.metadata && session.metadata.startLinkId;
  if (!linkId) return null;
  const [link] = await query(`SELECT * FROM start_links WHERE id=?`, [linkId]);
  if (!link) { console.error(`[start-link] CRITICAL: session ${session.id} names start link ${linkId}, which does not exist`); return null; }
  if (session.metadata.orgId && session.metadata.orgId !== link.org_id) {
    console.error(`[start-link] CRITICAL: session ${session.id} names org ${session.metadata.orgId} but link ${linkId} is for ${link.org_id}. Nothing changed.`);
    return null;
  }
  const orgId = link.org_id;
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer && session.customer.id) || null;
  let card = null;

  if (session.mode === "setup") {
    // $0: the card is saved, nothing is scheduled.
    if (session.setup_intent && billingStripe) {
      try {
        const si = await billingStripe.setupIntents.retrieve(
          typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id, { expand: ["payment_method"] });
        card = await cardFromPaymentMethod(si.payment_method);
      } catch (e) { console.error("[start-link] setup intent read failed:", e.message); }
    }
    await run(`UPDATE orgs SET billing_card_saved_at = COALESCE(billing_card_saved_at, NOW()),
                 billing_card_brand = COALESCE(?, billing_card_brand), billing_card_last4 = COALESCE(?, billing_card_last4),
                 signed_at = COALESCE(signed_at, ?) ${customerId ? `, ${billingCustomerColumn()} = ?` : ""}
               WHERE id=?`, [card && card.brand, card && card.last4, link.signed_at, ...(customerId ? [customerId] : []), orgId]);
  } else {
    let sub = null;
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription && session.subscription.id;
    if (subId && billingStripe) {
      try { sub = await billingStripe.subscriptions.retrieve(subId, { expand: ["default_payment_method"] }); }
      catch (e) { console.error("[start-link] could not retrieve subscription:", e.message); }
    }
    card = sub ? await cardFromPaymentMethod(sub.default_payment_method) : null;
    const trialEnd = (sub && iso(sub.trial_end)) || new Date(link.first_charge_at).toISOString();
    const plan = (session.metadata && session.metadata.plan) || `${link.tier_id}_monthly`;
    await run(`UPDATE orgs SET plan=?, subscription_status='trialing', trial_ends_at=?, stripe_subscription_id=?,
                 signed_at = COALESCE(signed_at, ?), grace_until=NULL,
                 billing_card_saved_at = COALESCE(billing_card_saved_at, NOW()),
                 billing_card_brand = COALESCE(?, billing_card_brand), billing_card_last4 = COALESCE(?, billing_card_last4)
                 ${customerId ? `, ${billingCustomerColumn()} = ?` : ""}
               WHERE id=?`, [plan, trialEnd, subId || null, link.signed_at, card && card.brand, card && card.last4,
                             ...(customerId ? [customerId] : []), orgId]);
  }
  await run(`UPDATE start_links SET status='completed', completed_at=COALESCE(completed_at, NOW()) WHERE id=?`, [linkId]);
  await stampPaperDone(orgId);
  // ORDER-1: once. A redelivered event (or one after Stripe's 24-hour idempotency window) finds the link completed.
  if (link.order_json && link.status !== "completed") await afterOrderCard(link, session, card);
  console.log(`[start-link] ${linkId} completed for org ${orgId} (${session.mode || "subscription"}${card ? ", card " + card.last4 : ""})`);
  return orgId;
}

// ORDER-1 · the card went in on an order. The setup fee (when there is one) is an invoice
// item tied to the subscription, so it rides the first real invoice on the first charge
// date and never the $0 one Stripe makes today (the SALES-3 rule). Idempotent by key.
// Then the deal moves to Card on file.
async function afterOrderCard(link, session, card) {
  const { billingStripe } = deps;
  const fee = Number(link.order_json.setupFeeCents) || 0;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription && session.subscription.id;
  const customer = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
  if (fee > 0 && subId && customer && billingStripe) {
    try {
      await billingStripe.invoiceItems.create({ customer, subscription: subId, currency: "usd", amount: fee, description: `Steward setup fee (order ${link.order_number})`,
        metadata: { startLinkId: link.id, orgId: link.org_id, orderNumber: link.order_number } }, { idempotencyKey: `order-setup-${link.id}` });
    } catch (e) { console.error(`[order] CRITICAL: ${link.order_number}: the setup fee was not added to the first invoice:`, e.message); }
  }
  try {
    const DEAL = require("../admin/sales/orderDeal");
    const who = { id: "system:onboard/order", name: "Order link (Stripe)" };
    await DEAL.moveTo(deps, link.deal_id, "card", who);
    await DEAL.note(deps, link.deal_id, `Order ${link.order_number}: card on file${card && card.last4 ? ` (${card.brand || "card"} ending ${card.last4})` : ""}. Nothing charged today.`, who);
  } catch (e) { console.error(`[order] ${link.order_number}: the deal did not move to Card on file:`, e.message); }
}

module.exports = { configure, onCheckoutCompleted, stampPaperDone };
