// routes/finance.js — FIX-1 E. The Finance routes FIX-1 touched, moved out of
// server.js by the work that needed them (the start of the server.js split).
//
// server.js calls mount(app, deps) exactly where these routes used to be
// declared, so route ORDER is unchanged. Everything a route needs arrives in
// `deps` — this module opens no database pool and builds no Stripe client of
// its own, which is what keeps the donation client and its test seam
// (STRIPE_API_BASE) singular.
//
//   GET /finance/stripe-summary        live balance + recent payouts (moved, unchanged
//                                      except that it now says why a $0 balance is normal)
//   GET /finance/payouts/:payoutId     WHICH GIFTS MADE UP THIS PAYOUT — every
//                                      charge, refund and fee behind it, linked to
//                                      its gift and donor, reconciled in cents
//
// Both are READ paths: never write-gated (a lapsed org can always see where its
// money went), always org-scoped by the caller's OWN orgs.stripe_account_id —
// never an account id from the request.

const STRIPE_SUMMARY_TTL = 5 * 60 * 1000;
const PAYOUT_CACHE_TTL = 5 * 60 * 1000;
// A payout older than a year has hundreds of lines at most for the orgs this
// product serves; the cap is a guard against a runaway loop, and a payout that
// hits it SAYS so rather than reconciling a truncated list.
const MAX_BALANCE_TXNS = 2000;

let reconcileMod = null;
const payoutReconcile = () => reconcileMod || (reconcileMod = import("../shared/payoutReconcile.js"));

function mount(app, { stripe, query, requireAuth, wrap }) {
  const stripeSummaryCache = new Map(); // orgId -> { at, data }
  const payoutCache = new Map();        // orgId:payoutId -> { at, data }

  // ── Money in: balance + recent payouts (moved from server.js, BUILD-09) ──
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
      // stripeAccount rides the OPTIONS argument, never params (stripe-node v22).
      const [balance, payouts] = await Promise.all([
        stripe.balance.retrieve({}, { stripeAccount: acct }),
        stripe.payouts.list({ limit: 10 }, { stripeAccount: acct }),
      ]);
      const sumCents = arr => (arr || []).reduce((s, b) => s + (b.amount || 0), 0);
      const availableCents = sumCents(balance.available), pendingCents = sumCents(balance.pending);
      const data = {
        connected: true,
        balance: { available: availableCents / 100, pending: pendingCents / 100 },
        // A $0 Stripe balance beside a large cash-on-hand figure reads as a
        // discrepancy. It is not one: Stripe pays the balance out to the bank.
        balanceSentence: (availableCents === 0 && pendingCents === 0)
          ? "Stripe shows $0 because it has already paid everything out to your bank. That is normal."
          : null,
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
      const data = { connected: false, error: "stripe_unavailable" };
      stripeSummaryCache.set(orgId, { at: Date.now(), data });
      res.json(data);
    }
  }));

  // ── Which gifts made up this payout ─────────────────────────────────────
  app.get("/finance/payouts/:payoutId", requireAuth, wrap(async (req, res) => {
    const { orgId } = req.user;
    const payoutId = String(req.params.payoutId || "");
    if (!/^po_[A-Za-z0-9_]{3,64}$/.test(payoutId)) return res.status(404).json({ error: "Payout not found" });

    const key = orgId + ":" + payoutId;
    const cached = payoutCache.get(key);
    if (cached && Date.now() - cached.at < PAYOUT_CACHE_TTL) return res.json(cached.data);

    const [org] = await query("SELECT stripe_account_id FROM orgs WHERE id=?", [orgId]);
    const acct = org?.stripe_account_id;
    if (!acct || !stripe) return res.status(404).json({ error: "Payout not found" });

    let payout;
    try {
      payout = await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: acct });
    } catch (e) {
      // Another org's payout id asked of THIS org's account is simply not
      // there — Stripe answers 404 and so do we, the same as a made-up id.
      if (e && (e.statusCode === 404 || e.code === "resource_missing")) return res.status(404).json({ error: "Payout not found" });
      console.error("[finance] payout retrieve failed:", e && e.message);
      return res.status(503).json({ error: "stripe_unavailable", sentence: "Stripe did not answer, so Steward cannot open this payout right now." });
    }

    const txns = [];
    let truncated = false;
    try {
      let starting_after;
      for (;;) {
        const page = await stripe.balanceTransactions.list(
          { payout: payoutId, limit: 100, expand: ["data.source"], ...(starting_after ? { starting_after } : {}) },
          { stripeAccount: acct });
        const data = page.data || [];
        txns.push(...data);
        if (!page.has_more || !data.length) break;
        if (txns.length >= MAX_BALANCE_TXNS) { truncated = true; break; }
        starting_after = data[data.length - 1].id;
      }
    } catch (e) {
      console.error("[finance] payout balance transactions failed:", e && e.message);
      return res.status(503).json({ error: "stripe_unavailable", sentence: "Stripe did not answer, so Steward cannot open this payout right now." });
    }

    const R = await payoutReconcile();
    const pis = [...new Set(txns.map(R.paymentIntentOf).filter(Boolean))];
    const giftsByPi = {};
    if (pis.length) {
      // Org-scoped by the gift's own org_id: a payment intent id that happens
      // to be on another org's gift links to nothing here.
      const rows = await query(
        `SELECT g.id, g.stripe_payment_id, g.donor_id, g.amount, d.name AS donor_name
           FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
          WHERE g.org_id = ? AND g.stripe_payment_id = ANY(?::text[])`, [orgId, pis]);
      for (const r of rows) giftsByPi[r.stripe_payment_id] = {
        giftId: r.id, donorId: r.donor_id, donorName: r.donor_name,
        amountCents: Math.round(Number(r.amount || 0) * 100),
      };
    }

    const rec = R.reconcilePayout(payout, txns, giftsByPi);
    const data = {
      ...rec,
      status: payout.status,
      arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
      truncated,
      ...(truncated ? { reconciled: false, sentence: `This payout has more than ${MAX_BALANCE_TXNS} lines, so Steward shows the first ${txns.length} and will not claim the rest add up.` } : {}),
    };
    payoutCache.set(key, { at: Date.now(), data });
    res.json(data);
  }));
}

module.exports = { mount };
