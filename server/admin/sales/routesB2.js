// server/admin/sales/routesB2.js · SALES-2 Part B. INBOUND, PARTNERS, CADENCES, SCOREBOARD.
//
// Behind the /ops door (super-admins only):
//   GET    /ops/sales/cadences                         cadences, and who's running in each
//   POST   /ops/sales/cadences   PUT|DELETE /ops/sales/cadences/:id
//   POST   /ops/sales/cadences/:id/enroll              { contactIds, dealId? }
//   POST   /ops/sales/cadences/end                     { contactId } ends that contact's cadences by hand
//   GET    /ops/sales/contacts/:id/cadences            one contact's enrollments
//   POST   /ops/sales/partners/:id/referral-link       a new private link (shown once; the old one is revoked)
//   POST   /ops/sales/partners/:id/referral-link/revoke
//   GET    /ops/sales/partners/:id/referrals           links, and referrals in → meetings → won → MRR → owed
//   POST   /ops/sales/referrals                        a customer's referral { fromOrgId, orgName, contactName, email, phone, note }
//   GET    /ops/sales/scoreboard   GET /ops/sales/scoreboard/rows?metric=&week=|group=&key=   PUT /ops/sales/scoreboard/goals
// PUBLIC (the partner's referral page shows only its own form):
//   GET    /public/referral/:token                     the partner's name
//   POST   /public/referral/:token                     the form (rate-limited, honeypot "website")
"use strict";
const { rateLimit } = require("../../../rateLimitStore");
const CAD = require("./cadences");
const REF = require("./referrals");
const SB = require("./scoreboard");

const referralLimiter = rateLimit("salesReferralLimiter", {
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  const { withAmbientTransaction } = require("../../db/query");
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/cadences", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, cadences: await CAD.all(query), running: await CAD.running(query), actions: CAD.ACTIONS })));
  app.post("/ops/sales/cadences", salesLimiter, door, wrap(async (req, res) => send(res, await CAD.save(ctx, null, req.body || {}, whoOf(req)), 201)));
  app.put("/ops/sales/cadences/:id", salesLimiter, door, wrap(async (req, res) => send(res, await CAD.save(ctx, req.params.id, req.body || {}, whoOf(req)))));
  app.delete("/ops/sales/cadences/:id", salesLimiter, door, wrap(async (req, res) => send(res, await CAD.remove(ctx, req.params.id, whoOf(req)))));
  app.post("/ops/sales/cadences/:id/enroll", salesLimiter, door, wrap(async (req, res) => {
    const b = req.body || {};
    const r = await withAmbientTransaction(() => CAD.enroll(ctx, req.params.id, Array.isArray(b.contactIds) ? b.contactIds : [], whoOf(req), Date.now(), { dealId: b.dealId || null }));
    if (r.ok && req.audit) req.audit.label(`sales cadence: ${r.enrolled} enrolled`);
    send(res, r, 201);
  }));
  app.post("/ops/sales/cadences/end", salesLimiter, door, wrap(async (req, res) => send(res, { ok: true, ...(await CAD.endFor(ctx, [String((req.body || {}).contactId || "")], "ended", whoOf(req))) })));
  app.get("/ops/sales/contacts/:id/cadences", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, enrollments: await CAD.running(query, { contactId: req.params.id }) })));

  app.post("/ops/sales/partners/:id/referral-link", salesLimiter, door, wrap(async (req, res) => send(res, await REF.make(ctx, req.params.id, whoOf(req)), 201)));
  app.post("/ops/sales/partners/:id/referral-link/revoke", salesLimiter, door, wrap(async (req, res) => send(res, await REF.revoke(ctx, req.params.id))));
  app.get("/ops/sales/partners/:id/referrals", salesLimiter, door, wrap(async (req, res) => {
    const [p] = await query(`SELECT id, name FROM sales_partners WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "not_found" });
    const P = require("./partners");
    const { lines, rows } = await require("./routesB").ledgerFor(query, { partnerId: p.id });
    res.json({ ok: true, ...(await REF.partnerStats(query, p.id, P.report([p], lines, rows)[0])) });
  }));
  app.post("/ops/sales/referrals", salesLimiter, door, wrap(async (req, res) => send(res, await withAmbientTransaction(() => REF.fromCustomer(ctx, req.body || {}, whoOf(req))), 201)));

  app.get("/ops/sales/scoreboard", salesLimiter, door, wrap(async (req, res) => {
    const now = Date.now();
    const facts = await SB.load(query, now);
    const sb = SB.build(facts, now, "America/New_York", facts.goals);
    // The numbers only; the rows behind each open through /scoreboard/rows.
    const strip = c => (c && typeof c === "object" && "ids" in c ? c.n : c);
    res.json({ ok: true, ...sb, weeks: sb.weeks.map(w => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, strip(v)]))),
      bySource: sb.bySource.map(s => ({ key: s.key, deals: s.deals.length, met: s.met.length, won: s.won.length, meetingPct: s.meetingPct, wonPct: s.wonPct })),
      byList: sb.byList.map(s => ({ key: s.key, name: s.name, dials: s.dials.length, connects: s.connects.length, meetings: s.meetings.length, connectPct: s.connectPct, meetingPct: s.meetingPct })) });
  }));
  app.get("/ops/sales/scoreboard/rows", salesLimiter, door, wrap(async (req, res) => {
    const now = Date.now();
    const facts = await SB.load(query, now);
    const sb = SB.build(facts, now, "America/New_York", facts.goals);
    const sel = { metric: String(req.query.metric || ""), week: req.query.week ? String(req.query.week) : null, group: req.query.group ? String(req.query.group) : null, key: req.query.key != null ? String(req.query.key) : null };
    res.json({ ok: true, rows: await SB.rows(query, facts, sb, sel) });
  }));
  app.put("/ops/sales/scoreboard/goals", salesLimiter, door, wrap(async (req, res) => {
    const who = whoOf(req), g = SB.cleanGoals((req.body || {}).goals || {});
    await run(`INSERT INTO sales_settings (key, value, created_by, created_by_name, updated_by, updated_by_name) VALUES ('scoreboard_goals', ?::jsonb, ?, ?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`,
      [JSON.stringify(g), who.id, who.name, who.id, who.name]);
    res.json({ ok: true, goals: g });
  }));

  // PUBLIC: a partner's referral page. Only the partner's name and the form; a bad or revoked link is a 404.
  app.get("/public/referral/:token", referralLimiter, wrap(async (req, res) => {
    const r = await REF.publicRead(query, req.params.token);
    if (!r) return res.status(404).json({ error: "not_found", message: "This referral link isn't working. Ask the person who sent it for a new one." });
    res.json(r);
  }));
  app.post("/public/referral/:token", referralLimiter, wrap(async (req, res) => {
    const r = await withAmbientTransaction(() => REF.publicSubmit(ctx, req.params.token, req.body || {}));
    if (r.error === "not_found") return res.status(404).json({ error: "not_found", message: "This referral link isn't working. Ask the person who sent it for a new one." });
    if (r.error) return res.status(400).json({ error: r.error, field: r.field, message: r.message });
    res.status(201).json({ ok: true, message: "Thank you. Jonathan will be in touch with them soon." });
  }));
}

module.exports = { mount };
