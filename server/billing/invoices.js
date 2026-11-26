// server/billing/invoices.js · HONEST-2 item 3 (W-1126-Integrations-03). THE INVOICES, IN SETTINGS → BILLING.
//
// "Choose a plan" looped from Settings to the public pricing page and back to Organization, because
// there was no Billing tab. Settings → Billing now answers the questions a person comes with: the
// plan, the price, the next charge, the card on file (GET /billing/status), and the invoices (here).
//
// A GET never changes state: this reads the customer id already stored for the billing key's mode
// and never creates one (ensureStripeCustomer does that, on the way into Checkout). No customer, no
// billing key, or Stripe unreachable: an empty list and the sentence that says which.
"use strict";

const SAID = {
  none: "No invoices yet. Your first one appears here after your first charge.",
  manual: "No invoices: your plan was set by hand, so nothing is charged through Stripe.",
  off: "Invoices can't be read on this Steward: billing isn't connected to Stripe here.",
  failed: "Steward couldn't reach Stripe for your invoices just now. Try again in a minute.",
};

function shape(inv) {
  return {
    id: inv.id,
    number: inv.number || null,
    date: inv.created ? new Date(inv.created * 1000).toISOString().slice(0, 10) : null,
    amountCents: Number(inv.total != null ? inv.total : inv.amount_due) || 0,
    currency: String(inv.currency || "usd").toUpperCase(),
    status: inv.status || null,            // paid, open, void, uncollectible, draft
    url: inv.hosted_invoice_url || null,   // Stripe's own page for it
    pdf: inv.invoice_pdf || null,
  };
}

function mount(app, ctx) {
  const { requireAuth, requireAdmin, wrap, query, billingStripe, billingCustomerColumn } = ctx;
  app.get("/billing/invoices", requireAuth, requireAdmin, wrap(async (req, res) => {
    if (!billingStripe) return res.json({ invoices: [], sentence: SAID.off });
    const col = billingCustomerColumn();
    const [org] = await query(`SELECT ${col} AS customer_id, stripe_subscription_id FROM orgs WHERE id=?`, [req.user.orgId]);
    if (!org || !org.customer_id) return res.json({ invoices: [], sentence: org && !org.stripe_subscription_id ? SAID.manual : SAID.none });
    try {
      const list = await billingStripe.invoices.list({ customer: org.customer_id, limit: 24 });
      const invoices = (list && list.data || []).filter(i => i.status !== "draft").map(shape);
      res.json({ invoices, sentence: invoices.length ? null : SAID.none });
    } catch (e) {
      console.error("[billing] invoices:", e && e.code, String(e && e.message || e).slice(0, 160));
      res.json({ invoices: [], sentence: e && (e.code === "resource_missing" || e.statusCode === 404) ? SAID.none : SAID.failed });
    }
  }));
}

module.exports = { mount, shape, SAID };
