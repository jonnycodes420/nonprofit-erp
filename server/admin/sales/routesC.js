// server/admin/sales/routesC.js · SALES-3 Part A. QUOTES ON A DEAL, AND THE PRIVATE QUOTE PAGE.
//
// Behind the /ops door (super-admins only):
//   GET    /ops/sales/deals/:id/quotes              the deal's quote versions (newest first) and the plans
//   POST   /ops/sales/deals/:id/quotes              save a new version
//   POST   /ops/sales/quotes/:id/link               "Copy link": a new private link (shown once; the old one stops)
//   POST   /ops/sales/quotes/:id/schedule           schedule billing again after fixing what stopped it
//   GET    /ops/sales/quotes/:id/pdf                the signed agreement, as kept
//   GET    /ops/sales/plans   PUT /ops/sales/plans  the plans and add-ons a quote can name
// PUBLIC (a quote's page shows only its own quote; nothing here sends anything):
//   GET    /public/quote/:token                     the quote, or why the link no longer works
//   POST   /public/quote/:token/accept              { name, title, agree, sha256 }
//   POST   /public/quote/:token/card                a Stripe Checkout in setup mode (no charge)
//   POST   /public/quote/:token/card/confirm        { sessionId } back from Checkout (the webhook does the same)
"use strict";
const { rateLimit } = require("../../../rateLimitStore");
const Q = require("./quotes");

const quoteLimiter = rateLimit("salesQuoteLimiter", {
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send, billing }) {
  const ctx = { query, run };
  const { withAmbientTransaction } = require("../../db/query");
  const shape = q => ({ ...q, addons: q.addons || [], includes: q.includes || [], state: Q.linkState(q, Date.now()) });
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/deals/:id/quotes", salesLimiter, door, wrap(async (req, res) => {
    const [quotes, plans] = await Promise.all([Q.forDeal(query, req.params.id), Q.plansOf(query)]);
    res.json({ ok: true, quotes: quotes.map(shape), plans, terms: Q.TERMS, defaultStart: Q.DEFAULT_START,
      sentences: { price: "The monthly price in the quote. Below the list price it needs a reason, kept with the quote and not shown to the customer.",
        value: "When a quote is accepted, the deal's value becomes its monthly price." } });
  }));
  app.post("/ops/sales/deals/:id/quotes", salesLimiter, door, wrap(async (req, res) => {
    const r = await withAmbientTransaction(() => Q.save(ctx, req.params.id, req.body || {}, whoOf(req)));
    if (r.ok && req.audit) req.audit.label(`sales quote: version ${r.version} saved`);
    send(res, r, 201);
  }));
  app.post("/ops/sales/quotes/:id/link", salesLimiter, door, wrap(async (req, res) => send(res, await Q.makeLink(ctx, req.params.id, whoOf(req)), 201)));
  app.post("/ops/sales/quotes/:id/schedule", salesLimiter, door, wrap(async (req, res) => {
    const [q] = await query(`SELECT id, deal_id, status, price_cents, setup_fee_cents, tier_id, start_on::text AS start_on, steward_org_id, signer_email, stripe_subscription_id FROM sales_quotes WHERE id = ?`, [req.params.id]);
    if (!q) return res.status(404).json({ error: "not_found" });
    if (q.status !== "accepted") return res.status(400).json({ error: "invalid", message: "Only an accepted quote schedules billing." });
    if (q.stripe_subscription_id) return res.status(400).json({ error: "invalid", message: "Billing is already scheduled for this quote." });
    if (!q.steward_org_id) {
      const [o] = await query(`SELECT o.steward_org_id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL
                                WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'org' ORDER BY l.is_primary DESC, l.created_at LIMIT 1`, [q.deal_id]);
      if (!o || !o.steward_org_id) return res.status(400).json({ error: "invalid", message: "Link the deal's organization to its Steward org first." });
      await run(`UPDATE sales_quotes SET steward_org_id = ? WHERE id = ?`, [o.steward_org_id, q.id]);
      q.steward_org_id = o.steward_org_id;
    }
    const r = await Q.scheduleBilling(ctx, q, billing);
    send(res, r.ok ? r : { error: "invalid", message: r.message });
  }));
  app.get("/ops/sales/quotes/:id/pdf", salesLimiter, door, wrap(async (req, res) => {
    const [q] = await query(`SELECT pdf, version, accepted_at FROM sales_quotes WHERE id = ? AND pdf IS NOT NULL`, [req.params.id]);
    if (!q) return res.status(404).json({ error: "not_found" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="steward-quote-v${q.version}-signed-${new Date(q.accepted_at).toISOString().slice(0, 10)}.pdf"`);
    res.end(q.pdf);
  }));
  app.get("/ops/sales/plans", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, ...(await Q.plansOf(query)), defaults: Q.defaultPlans() })));
  app.put("/ops/sales/plans", salesLimiter, door, wrap(async (req, res) => {
    const who = whoOf(req), v = Q.cleanPlans(req.body || {});
    await run(`INSERT INTO sales_settings (key, value, created_by, created_by_name, updated_by, updated_by_name) VALUES ('plans', ?::jsonb, ?, ?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`,
      [JSON.stringify(v), who.id, who.name, who.id, who.name]);
    res.json({ ok: true, ...v });
  }));

  // PUBLIC: the quote's own page. A bad, replaced or expired link says so and shows nothing else.
  app.get("/public/quote/:token", quoteLimiter, wrap(async (req, res) => {
    const r = await Q.publicRead(query, req.params.token);
    if (r.gone) return res.status(r.state === "missing" ? 404 : 410).json({ error: r.state, message: r.message });
    res.setHeader("Cache-Control", "no-store");
    res.json(r);
  }));
  app.post("/public/quote/:token/accept", quoteLimiter, wrap(async (req, res) => {
    const reqInfo = { ip: String(req.ip || "").slice(0, 100) || null, ua: String(req.headers["user-agent"] || "").slice(0, 500) || null };
    const r = await Q.accept(ctx, req.params.token, req.body || {}, reqInfo, billing);
    if (r.error === "gone") return res.status(r.state === "missing" ? 404 : 410).json({ error: r.state, message: r.message });
    if (r.error) return res.status(r.error === "changed" ? 409 : 400).json(r);
    if (req.audit) req.audit.summary = `Quote ${r.id} accepted and signed`;
    res.json(r);
  }));
  app.post("/public/quote/:token/card", quoteLimiter, wrap(async (req, res) => {
    const r = await Q.cardStart(ctx, req.params.token, billing);
    if (r.error) return res.status(r.error === "gone" ? 410 : r.error === "unavailable" ? 503 : 400).json(r);
    res.json(r);
  }));
  app.post("/public/quote/:token/card/confirm", quoteLimiter, wrap(async (req, res) => {
    const pub = await Q.publicRead(query, req.params.token);
    if (pub.gone || pub.state !== "accepted") return res.status(410).json({ error: "gone" });
    const stripe = (billing() || {}).billingStripe;
    const sid = String((req.body || {}).sessionId || "");
    if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sid)) return res.status(400).json({ error: "invalid" });
    const session = await stripe.checkout.sessions.retrieve(sid);
    // The session must be this quote's: a session id from anywhere else changes nothing.
    const [mine] = await query(`SELECT id FROM sales_quotes WHERE token_hash = ? AND id = ?`, [Q.hash(req.params.token), String((session.metadata || {}).salesQuoteId || "")]);
    if (!mine || session.status !== "complete") return res.status(400).json({ error: "invalid", message: "That card step isn't finished." });
    await Q.cardSaved(ctx, session, billing);
    res.json({ ok: true, ...(await Q.publicRead(query, req.params.token)) });
  }));
}

module.exports = { mount };
