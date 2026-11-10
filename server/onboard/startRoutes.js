// server/onboard/startRoutes.js · ONBOARD-1 Stage 1. THE START LINK'S ROUTES.
//
//   POST /admin/orgs/:id/start-links     super-admin: raise one (returns /start/<token>)
//   GET  /admin/orgs/:id/start-links     super-admin: the org's links and its paper state
//   GET  /public/start/:token            the page's data: org, logo, the rendered order form
//   POST /public/start/:token/sign       typed name + title + "I agree" -> the click-wrap
//                                        record, then a Stripe Checkout URL
//   GET  /billing/agreement              Settings → Billing: the signed order form
//   GET  /billing/agreement/pdf          the same, as a PDF
//
// A GET never changes state. The token is single use: one signature per link,
// and the link is dead 14 days after it was raised. After she signs, the same
// link only hands back a fresh Checkout (a closed tab must not cost her the
// card step) until Stripe says the card went in; then it is used.
//
// Nothing is charged: Checkout runs in subscription mode on the org's existing
// Stripe customer with trial_end = the first charge date, or in setup mode
// when the price is $0. Prices, Stripe products and the thirty-day rule are
// untouched: a band link quotes the band's configured price, and a custom
// price rides on the band's own product as an inline amount.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");
const SL = require("./startLink");
const PRICING = require("../../pricing");

const routers = { r1: express.Router() };
const SIGNER_ACTOR = "system:onboard/start-link";

function mount(ctx) {
  const { query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin, billingStripe,
          billingCustomerColumn, publicAppUrl, orgTzName, registerLimiter } = ctx;
  const app = routers.r1;
  const limiter = registerLimiter || ((req, res, next) => next());
  const tokenHash = t => SL.sha256("start:" + String(t || ""));

  async function linkByToken(token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) return null;
    const [l] = await query(`SELECT * FROM start_links WHERE token_hash=?`, [tokenHash(token)]);
    return l || null;
  }
  async function orgFor(id) {
    const [o] = await query(`SELECT id, name, plan, logo_data, custom_price_cents, custom_price_ends_on,
        stripe_subscription_id, subscription_status, paper_done_at, data_in_at, billing_card_last4, billing_card_brand,
        ${billingCustomerColumn()} AS billing_customer_id FROM orgs WHERE id=?`, [id]);
    return o || null;
  }
  const whoName = async req => {
    const [u] = await query(`SELECT name, email FROM users WHERE id=?`, [req.user.userId]);
    return (u && (u.name || u.email)) || req.user.email || "Steward";
  };

  // ── Jonathan raises a link ────────────────────────────────────────────────
  app.post("/admin/orgs/:id/start-links", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const org = await orgFor(req.params.id);
    if (!org) return res.status(404).json({ error: "org_not_found", message: "That organization does not exist." });
    if (org.stripe_subscription_id && !["canceled", "cancelled"].includes(org.subscription_status || "")) {
      return res.status(409).json({ error: "already_subscribed",
        message: `${org.name} already has a Stripe subscription. Cancel it in Settings → Billing before raising a start link.` });
    }
    const v = SL.validateStartLink(req.body || {}, org);
    if (!v.ok) return res.status(400).json(v);
    // One open link per org: two signed links would be two subscriptions.
    const open = await query(`SELECT id FROM start_links WHERE org_id=? AND status IN ('open','signed') AND expires_at > NOW()`, [org.id]);
    if (open.length && !(req.body || {}).replace) {
      return res.status(409).json({ error: "start_link_open", existingLinkId: open[0].id,
        message: `${org.name} already has an open start link. Send that one, or raise a new one with "replace" to retire it.` });
    }
    if (open.length) await run(`UPDATE start_links SET status='revoked' WHERE org_id=? AND status IN ('open','signed')`, [org.id]);
    const token = SL.newToken();
    const id = newId("stl");
    await run(`INSERT INTO start_links (id, org_id, token_hash, contact_name, contact_email, price_cents, price_basis, tier_id,
                 charge_mode, first_charge_on, note, status, expires_at, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'open', NOW() + make_interval(days => ?), ?, ?)`,
      [id, org.id, tokenHash(token), v.contactName, v.contactEmail, v.price.cents, v.price.basis, v.price.tierId,
       v.chargeMode, v.firstChargeOn, v.note, SL.EXPIRES_DAYS, req.user.userId, await whoName(req)]);
    const [row] = await query(`SELECT expires_at FROM start_links WHERE id=?`, [id]);
    res.status(201).json({
      id, url: `${publicAppUrl()}/start/${token}`, path: `/start/${token}`,
      orgName: org.name, contactName: v.contactName, contactEmail: v.contactEmail,
      priceUsd: v.price.cents / 100, priceBasis: v.price.basis, chargeMode: v.chargeMode,
      firstChargeOn: v.firstChargeOn, expiresAt: row.expires_at,
      sentence: `Single use, and it expires ${new Date(row.expires_at).toISOString().slice(0, 10)}. Nothing is charged when she signs.`,
    });
  }));

  app.get("/admin/orgs/:id/start-links", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const org = await orgFor(req.params.id);
    if (!org) return res.status(404).json({ error: "org_not_found" });
    const links = await query(`SELECT id, contact_name, contact_email, price_cents, price_basis, charge_mode, first_charge_on,
        status, expires_at, signed_at, completed_at, created_at, created_by_name FROM start_links WHERE org_id=? ORDER BY created_at DESC`, [org.id]);
    res.json({
      orgName: org.name, paperDoneAt: org.paper_done_at, dataInAt: org.data_in_at,
      customPriceUsd: org.custom_price_cents != null ? org.custom_price_cents / 100 : null,
      bands: PRICING.TIERS.map(t => ({ id: t.id, band: t.band, monthlyUsd: t.monthlyUsd })),
      links: links.map(l => ({ ...l, state: SL.linkState(l) })),
    });
  }));

  // ── The page ─────────────────────────────────────────────────────────────
  // The order form is rendered for THIS moment (a "30 days" link names today's
  // date) and its hash travels with it, so the sign step can prove the text
  // she agreed to is the text she was shown.
  async function pageFor(link) {
    const org = await orgFor(link.org_id);
    const tz = await orgTzName(link.org_id);
    const tier = PRICING.tierById(link.tier_id);
    const now = link.signed_at ? new Date(link.signed_at).getTime() : Date.now();
    const doc = SL.renderAgreement({
      orgName: org.name, priceCents: link.price_cents, priceBasis: link.price_basis, band: tier && tier.band,
      link, agreementVersion: require("../../customerAgreement").VERSION, now, tz,
    });
    return { org, tz, doc };
  }

  app.get("/public/start/:token", limiter, wrap(async (req, res) => {
    const link = await linkByToken(req.params.token);
    const state = SL.linkState(link);
    if (state === "missing") return res.status(404).json({ error: "not_found", message: "This start link does not exist. Ask Jonathan for a new one." });
    if (state === "expired" || state === "revoked") {
      return res.status(410).json({ error: state, message: state === "expired"
        ? "This start link has expired. Links last 14 days; ask Jonathan for a new one."
        : "This start link was replaced by a newer one. Use the latest link Jonathan sent." });
    }
    const { org, tz, doc } = await pageFor(link);
    let confirmation = null;
    if (link.signed_at) {
      const [sig] = await query(`SELECT price_cents, first_charge_at FROM start_signatures WHERE start_link_id=?`, [link.id]);
      if (sig) confirmation = SL.confirmationSentence({ priceCents: sig.price_cents, firstChargeAt: sig.first_charge_at, tz });
    }
    res.json({
      state, orgName: org.name, logo: org.logo_data || null,
      contactName: link.contact_name, contactEmail: link.contact_email,
      priceUsd: link.price_cents / 100, firstChargeDate: doc.firstChargeDate, chargeMode: link.charge_mode,
      agreement: { text: doc.text, sha256: doc.sha256, version: doc.version },
      expiresAt: link.expires_at, confirmation,
    });
  }));

  // ── She signs ────────────────────────────────────────────────────────────
  app.post("/public/start/:token/sign", limiter, wrap(async (req, res) => {
    const link = await linkByToken(req.params.token);
    const state = SL.linkState(link);
    if (state === "missing") return res.status(404).json({ error: "not_found" });
    if (state === "expired" || state === "revoked" || state === "completed") {
      return res.status(410).json({ error: state, message: state === "completed"
        ? "This start link has been used: the agreement is signed and the card is saved."
        : "This start link can no longer be used. Ask Jonathan for a new one." });
    }
    const b = req.body || {};
    const { org, tz, doc } = await pageFor(link);
    if (state === "open") {
      const name = String(b.name || "").trim().slice(0, 200);
      const title = String(b.title || "").trim().slice(0, 200);
      if (name.length < 2) return res.status(400).json({ error: "name_required", message: "Type your full name to sign." });
      if (!title) return res.status(400).json({ error: "title_required", message: "Type your title." });
      if (b.agree !== true) return res.status(400).json({ error: "agree_required", message: "Tick \"I agree\" to sign." });
      // The text she agreed to must be the text on her screen. A stale page
      // (the date rolled past midnight on a "30 days" link) re-reads it.
      if (String(b.sha256 || "") !== doc.sha256) {
        return res.status(409).json({ error: "agreement_changed", message: "The agreement on this page has changed since you opened it. It has been reloaded; read it again and sign.",
          agreement: { text: doc.text, sha256: doc.sha256, version: doc.version } });
      }
      const sigId = newId("sig");
      const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 100) || null;
      const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
      // Single use: the UPDATE claims the link, so two tabs cannot both sign.
      const claimed = await query(`UPDATE start_links SET status='signed', signed_at=NOW(), signature_id=?, first_charge_at=?
                                    WHERE id=? AND status='open' RETURNING id`, [sigId, doc.firstChargeAt.toISOString(), link.id]);
      if (!claimed.length) return res.status(409).json({ error: "already_signed", message: "This agreement has already been signed." });
      await run(`INSERT INTO start_signatures (id, org_id, start_link_id, signer_name, signer_title, signer_email, ip, user_agent,
                   agreement_version, text_sha256, rendered_text, price_cents, first_charge_at, created_by, created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [sigId, org.id, link.id, name, title, link.contact_email, ip, ua, doc.version, doc.sha256, doc.text,
         link.price_cents, doc.firstChargeAt.toISOString(), SIGNER_ACTOR, name]);
      if (req.audit) req.audit.summary = `${name} (${title}) signed the start agreement for ${org.name}`;
      link.status = "signed"; link.first_charge_at = doc.firstChargeAt;
    }
    // The card step. Fresh each time she asks, until Stripe says it is done.
    if (!billingStripe) return res.status(503).json({ error: "billing_unavailable", message: "Signed. The card step is not available right now; Jonathan will send you a link." });
    const [fresh] = await query(`SELECT * FROM start_links WHERE id=?`, [link.id]);
    const session = await billingStripe.checkout.sessions.create(
      await checkoutParams({ link: fresh, org, token: req.params.token, tz }));
    await run(`UPDATE start_links SET stripe_session_id=? WHERE id=?`, [session.id, link.id]);
    const [sig] = await query(`SELECT price_cents, first_charge_at FROM start_signatures WHERE start_link_id=?`, [link.id]);
    res.json({ ok: true, checkoutUrl: session.url,
      confirmation: SL.confirmationSentence({ priceCents: sig.price_cents, firstChargeAt: sig.first_charge_at, tz }) });
  }));

  // Subscription mode with trial_end on the org's own customer; setup mode at $0.
  async function checkoutParams({ link, org, token, tz }) {
    let customer = org.billing_customer_id || null;
    if (!customer) {
      const c = await billingStripe.customers.create({ email: link.contact_email, name: org.name, metadata: { orgId: org.id } });
      customer = c.id;
      await run(`UPDATE orgs SET ${billingCustomerColumn()}=? WHERE id=? AND ${billingCustomerColumn()} IS NULL`, [customer, org.id]);
    }
    const back = `${publicAppUrl()}/start/${token}`;
    const plan = `${link.tier_id}_monthly`;
    const metadata = { startLinkId: link.id, orgId: org.id, plan };
    const firstCharge = new Date(link.first_charge_at);
    const base = { customer, metadata, success_url: back + "?done=1", cancel_url: back };
    if (!(link.price_cents > 0)) {
      return { ...base, mode: "setup", payment_method_types: ["card"], setup_intent_data: { metadata } };
    }
    const tier = PRICING.tierById(link.tier_id);
    const priceId = tier && process.env[tier.envMonthly];
    if (!priceId) throw Object.assign(new Error(`No Stripe price is configured for ${link.tier_id} (${tier && tier.envMonthly}).`), { status: 400 });
    let lineItem;
    if (link.price_basis === "band") {
      lineItem = { price: priceId, quantity: 1 };
    } else {
      // A custom amount, on the band's own product: no new product, no new price.
      const p = await billingStripe.prices.retrieve(priceId);
      lineItem = { quantity: 1, price_data: { currency: "usd", product: typeof p.product === "string" ? p.product : p.product.id,
        unit_amount: link.price_cents, recurring: { interval: "month" } } };
    }
    return {
      ...base, mode: "subscription", line_items: [lineItem], payment_method_collection: "always",
      subscription_data: { trial_end: Math.floor(firstCharge.getTime() / 1000), metadata },
      custom_text: { submit: { message: SL.confirmationSentence({ priceCents: link.price_cents, firstChargeAt: firstCharge, tz })
        .replace(/^Signed\. /, "") } },
    };
  }

  // ── Settings → Billing: the signed order form ────────────────────────────
  async function latestSignature(orgId) {
    const [s] = await query(`SELECT id, signer_name, signer_title, signer_email, signed_at, agreement_version, text_sha256,
        rendered_text, price_cents, first_charge_at FROM start_signatures WHERE org_id=? ORDER BY signed_at DESC LIMIT 1`, [orgId]);
    return s || null;
  }
  app.get("/billing/agreement", requireAuth, requireAdmin, wrap(async (req, res) => {
    const s = await latestSignature(req.user.orgId);
    if (!s) return res.json({ agreement: null });
    const tz = await orgTzName(req.user.orgId);
    res.json({ agreement: {
      id: s.id, signerName: s.signer_name, signerTitle: s.signer_title, signerEmail: s.signer_email,
      signedAt: s.signed_at, version: s.agreement_version, sha256: s.text_sha256, text: s.rendered_text,
      priceUsd: s.price_cents / 100, firstChargeAt: s.first_charge_at,
      firstChargeDate: require("../../closeLink").formatChargeDate(s.first_charge_at, tz),
    } });
  }));
  app.get("/billing/agreement/pdf", requireAuth, requireAdmin, wrap(async (req, res) => {
    const s = await latestSignature(req.user.orgId);
    if (!s) return res.status(404).json({ error: "no_agreement" });
    const pdf = await require("./agreementPdf").render(s);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="steward-order-form-${String(s.signed_at.toISOString ? s.signed_at.toISOString() : s.signed_at).slice(0, 10)}.pdf"`);
    res.end(pdf);
  }));
}

module.exports = { routers, mount, SIGNER_ACTOR };
