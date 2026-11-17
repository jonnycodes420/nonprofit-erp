// server/admin/sales/routesF.js · SALES-4 Part B. LEADS TO WORK.
// Mounted by routes.js behind the same door (super-admins only; 404 to anyone else).
//
//   GET  /ops/sales/prospects/meta                  states, categories, the revenue range, what the data can't see
//   GET  /ops/sales/prospects/search?state=&category=&page=&q=&min=&max=
//                                                   one page of ProPublica's results, each with its fit and
//                                                   whether it is already in Sales
//   POST /ops/sales/prospects/csv                   { csv } the same, from a CSV of ProPublica results
//   POST /ops/sales/prospects/add                   { list: { id } | { name }, rows } add the picked rows
// Only ProPublica's API is fetched. Nothing is sent.
"use strict";
const PP = require("./propublica");
const ADD = require("./prospectAdd");
const FIT = require("./fit");
const PROSPECT = require("./prospectRows");

async function withFacts(query, rows, range) {
  const [rule, props, hits] = await Promise.all([PROSPECT.fitRule(query), query(`SELECT key, label FROM sales_properties WHERE object = 'org'`), PP.existing(query, rows)]);
  return rows.map((r, i) => {
    const offs = r.officers || [];
    const fit = FIT.fitOf({ ...r, has_ed: offs.some(o => o.role === "ED"), has_dd: offs.some(o => o.role === "Development Director"), has_phone: !!r.phone, has_email: false, props: {} }, rule, props);
    return { ...r, fit: { met: fit.met, total: fit.total, line: fit.line, misses: fit.misses }, inRange: range ? PP.inRange(r, range) : true, already: hits[i] };
  });
}
const rangeOf = q => {
  const n = v => (v === undefined || v === "" ? null : Number(v));
  const min = n(q.min), max = n(q.max);
  return { min: Number.isFinite(min) ? min : PP.DEFAULT_REVENUE.min, max: Number.isFinite(max) ? max : PP.DEFAULT_REVENUE.max };
};

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/prospects/meta", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, states: PP.STATES, categories: PP.CATEGORIES.map(c => ({ key: c.key, label: c.label, how: c.queries ? `Names with: ${c.queries.join(", ")}` : `NTEE codes starting ${c.prefixes.join(", ")}` })),
    range: PP.DEFAULT_REVENUE, sentences: PP.SENTENCES, lists: await require("./prospectLists").all(query) })));

  app.get("/ops/sales/prospects/search", salesLimiter, door, wrap(async (req, res) => {
    const range = rangeOf(req.query);
    const r = await PP.search({ state: req.query.state || "KY", category: req.query.category || "food", page: req.query.page || 0, q: req.query.q || "" });
    if (r.error) return res.status(503).json(r);
    const rows = await withFacts(query, r.rows, range);
    res.json({ ok: true, ...r, range, rows, shown: rows.filter(x => x.inRange).length, sentences: PP.SENTENCES });
  }));

  app.post("/ops/sales/prospects/csv", salesLimiter, door, wrap(async (req, res) => {
    const p = PP.fromCsv(String((req.body || {}).csv || "").slice(0, 3000000));
    if (p.error) return send(res, p);
    const range = (req.body || {}).range ? rangeOf(req.body.range) : null;
    const rows = await withFacts(query, p.rows.slice(0, ADD.MAX_ROWS), range);
    res.json({ ok: true, rows, shown: rows.filter(x => x.inRange).length, sentences: PP.SENTENCES });
  }));

  app.post("/ops/sales/prospects/add", salesLimiter, door, wrap(async (req, res) => {
    const r = await ADD.add(ctx, req.body || {}, whoOf(req));
    if (r.ok && req.audit) req.audit.label(`sales prospects: ${r.added.length} added to ${r.listName}`);
    send(res, r, 201);
  }));
}

module.exports = { mount };
