// server/admin/sales/routesG.js · ONBOARD-4 item 3. THE BOOKING PAGE AND PARTNER CODES.
//
// PUBLIC (the website's one action):
//   GET    /public/book/partner/:code     { name } for "Recommended by <name>"; 404 for an unknown code
//   GET    /public/book/times             BOOK-1, HONEST-4: three weeks of weekdays (?page= for later) and the open times
//                                         (calendlyTimes.js), or { source: "unavailable", link } when unread
//   POST   /public/book                   the form (rate-limited, honeypot "website") with her chosen time
//                                         (`slot`): the deal lands first, then Calendly books it or its
//                                         own page opens that time, prefilled, for her last click
// Behind the /ops door (super-admins only):
//   GET    /ops/sales/partner-codes       every code, its name, market and bookings so far
//   POST   /ops/sales/partner-codes       { code, name, market }
//   DELETE /ops/sales/partner-codes/:code
//   GET    /ops/sales/deals/:id/booking   the answers she gave, the partner and market, the file
//   GET    /ops/sales/bookings/:id/file   the file she sent (a download)
"use strict";
const { rateLimit } = require("../../../rateLimitStore");
const BOOK = require("./booking");
const TIMES = require("./calendlyTimes");

const bookLimiter = rateLimit("salesBookLimiter", {
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});
const SENT = "Thank you. Now pick a time below; the calendar sends you the invitation.";
const BOOKED = "You're booked. You'll get a calendar invite and a reminder. Nothing else.";
const OPEN = "One last click: confirm the time on the calendar. You'll get a calendar invite and a reminder. Nothing else.";

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  const { withAmbientTransaction } = require("../../db/query");

  app.get("/public/book/partner/:code", bookLimiter, wrap(async (req, res) => {
    const p = await BOOK.partnerByCode(query, req.params.code);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, name: p.name });
  }));
  // A read of Calendly's open times; no limiter beyond the cache (each week is kept five minutes).
  // HONEST-4 item 7: `?page=` pages through three weeks at a time; the first page is kept warm.
  TIMES.startWarm();
  app.get("/public/book/times", wrap(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await TIMES.times(new Date(), { page: Number(req.query.page) || 0 }));
  }));
  app.post("/public/book", bookLimiter, wrap(async (req, res) => {
    const r = await withAmbientTransaction(() => BOOK.submit(ctx, req.body || {}, { ip: req.ip }));
    if (r.error) return res.status(r.error === "too_large" ? 413 : 400).json({ error: r.error, field: r.field, message: r.message });
    if (req.audit && r.id) req.audit.label(`booking from the website${r.partner ? ` (recommended by ${r.partner})` : ""}`);
    // BOOK-1: her chosen time. The deal is already in; Calendly books the time (and sends the invite),
    // or its own page opens that time, prefilled, for her last click.
    const b = req.body || {};
    if (!r.honeypot && b.slot) {
      const t = await TIMES.book({ start: String(b.slot), name: String(b.name || "").trim(), email: String(b.email || "").trim().toLowerCase() });
      if (t.booked) return res.status(201).json({ ok: true, booked: true, message: BOOKED });
      if (t.open) return res.status(201).json({ ok: true, open: t.open, message: OPEN });
      if (t.error === "taken") return res.status(409).json({ error: "taken", message: t.message });
    }
    res.status(201).json({ ok: true, message: SENT });
  }));

  app.get("/ops/sales/partner-codes", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, partners: await BOOK.listPartners(query) })));
  app.post("/ops/sales/partner-codes", salesLimiter, door, wrap(async (req, res) => send(res, await BOOK.savePartner(ctx, req.body || {}, whoOf(req)), 201)));
  app.delete("/ops/sales/partner-codes/:code", salesLimiter, door, wrap(async (req, res) => send(res, await BOOK.removePartner(ctx, req.params.code))));
  app.get("/ops/sales/deals/:id/booking", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, ...(await BOOK.forDeal(query, req.params.id)) })));
  app.get("/ops/sales/bookings/:id/file", salesLimiter, door, wrap(async (req, res) => {
    const f = await BOOK.fileOf(query, req.params.id);
    if (!f) return res.status(404).json({ error: "not_found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${String(f.file_name).replace(/[^\w.\- ]/g, "_")}"`);
    res.send(f.file_data);
  }));
}

module.exports = { mount, SENT };
