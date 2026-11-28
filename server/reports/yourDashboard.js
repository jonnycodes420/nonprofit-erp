// server/reports/yourDashboard.js · REPORTS-6 item 4. A NEW ORG OPENS REPORTS ON A DASHBOARD THAT IS ALREADY THERE.
//
// "Your dashboard": nine reports that already exist, each a tile that opens
// the full report. "Add a report" opens a gallery of every report Steward
// has, each with one line and a preview, added in one click and removed in
// one. Nothing on a tile is computed here: each tile ASKS ITS REPORT through
// the report's own route (in process, as the person looking), so a tile's
// number is the report's number, and a report that is stored (SPEED-4:
// retention, SYBUNT, the giving summary) answers from its stored answer when
// nothing it reads has changed and computes fresh when anything has. A stale
// stored answer is never served, because the route's own rule decides.
"use strict";
const express = require("express");
const inProcess = require("../../inProcess");

const routers = { r1: express.Router() };
const DEFAULT_KEYS = ["giving", "retention", "lybunt", "sybunt", "first-time", "recurring", "by-fund", "by-month", "ack-backlog"];
const MAX_TILES = 24;

// Each tile: what it asks, and which of the answer's own figures it shows.
// `fy` is the org's fiscal year as Reports names it (orgReportYear), so the
// tile asks exactly what the report page asks when it opens.
const fig = (f, label, kind) => f ? { label, kind, value: f.value === undefined ? null : f.value, source: f.source || null,
  definition: f.definition || null, blank: f.blank || null } : null;
const TAB = {
  giving: { title: "Giving this year against last", opens: "giving-summary", path: () => "/reports/giving-summary?yearMode=fiscal",
    description: "Every gift this fiscal year, beside the same days of last year.",
    pick: d => [fig(d.figures && d.figures.total, "Giving this fiscal year", "money"), fig(d.comparison, d.comparison ? d.comparison.label : "Same point last year", "money")] },
  retention: { title: "Retention", opens: "retention", path: () => "/reports/retention?yearMode=fiscal",
    description: "Of last year's donors, the share who gave again this year.",
    pick: d => { const r = [...(d.rows || [])].reverse().find(x => x.retentionRate !== null);
      return r ? [fig(r.figures && r.figures.retentionRate, `Retention, ${r.label}`, "percent")]
        : [{ label: "Retention", kind: "percent", value: null, blank: "Not enough giving history yet to compute retention." }]; } },
  lybunt: { title: "LYBUNT", opens: "lybunt", path: fy => `/reports/lybunt?year=${fy}&yearMode=fiscal`,
    description: "People who gave last year and have not yet given this year.",
    pick: d => [fig(d.figures && d.figures.people, "Gave last year, not yet this year", "count"), fig(d.figures && d.figures.atStake, "Last year's giving at stake", "money")] },
  sybunt: { title: "SYBUNT", opens: "sybunt", path: fy => `/reports/sybunt?year=${fy}&yearMode=fiscal`,
    description: "People who gave in some earlier year, and not last year or this year.",
    pick: d => [fig(d.figures && d.figures.people, "Gave before, not last year or this", "count")] },
  "by-fund": { title: "Gifts by fund", opens: "std:by-fund", path: fy => `/reports/by-group?groupBy=funds&year=${fy}&yearMode=fiscal`,
    description: "This fiscal year's gifts, by the fund they were given to.",
    pick: d => { const top = [...(d.rows || [])].sort((a, b) => (b.total || 0) - (a.total || 0))[0];
      return [fig(d.figures && d.figures.grandTotal, "Every gift this fiscal year", "money"), top && top.source ? fig({ value: top.total, source: top.source }, `Largest: ${top.name}`, "money") : null]; } },
  "top-donors": { title: "Top donors", opens: "top-donors", path: fy => `/reports/top-donors?scope=period&limit=50&year=${fy}&yearMode=fiscal`,
    description: "The fifty people who gave the most this fiscal year.",
    pick: d => [fig(d.figures && d.figures.topTotal, "What the top fifty gave", "money")] },
  "three-year": { title: "Three-year comparison", opens: "three-year", path: fy => `/reports/three-year?year=${fy}&yearMode=fiscal`,
    description: "Each donor across the last three years, over the same days each year.",
    pick: d => [fig(d.figures && d.figures.t0, `Giving in ${(d.years || [])[2] ? d.years[2].label : "this year"}`, "money"), fig(d.figures && d.figures.growth, "Change on the year before", "percent")] },
  annual: { title: "Annual report", opens: "annual", path: fy => `/reports/annual?year=${fy}&yearMode=fiscal`,
    description: "The year in one page: received, donors, new and returning, by fund and campaign.",
    pick: d => [fig(d.figures && d.figures.total, `Received in ${d.label || "the year"}`, "money"), fig(d.figures && d.figures.uniqueDonors, "Donors", "count")] },
  "year-over-year": { title: "Year over year", opens: "year-over-year", path: fy => `/reports/year-over-year?year=${fy}&yearMode=fiscal`,
    description: "Each fiscal year beside the one before.",
    pick: d => { const y = (d.years || [])[0]; return y && y.figures ? [fig(y.figures.total || null, `Giving in ${y.label}`, "money")].filter(Boolean) : []; } },
};
const STD = {
  "first-time": { std: "first-time", title: "First-time givers", description: "People whose very first gift came this fiscal year.", countLabel: "First-time givers this year" },
  recurring: { std: "monthly-givers", title: "Recurring health", description: "Every monthly plan, its amount and whether its card is working.", countLabel: "Monthly plans" },
  "by-month": { std: "by-month", title: "Gifts by month", description: "Each month this year beside the same month last year.", noCount: true },
  "ack-backlog": { std: "ack-backlog", title: "Thank-you backlog", description: "Gifts nobody has thanked yet.",
    pick: d => [fig(d.figures && d.figures.count, "Gifts waiting for a thank-you", "count"), fig(d.figures && d.figures.total, "What they add up to", "money")] },
};

function mount(ctx) {
  const { actor, checkWriteAccess, orgTime, orgTz, query, requireAuth, run, wrap } = ctx;
  const app = routers.r1;
  let RB = null;
  const rb = async () => (RB = RB || await import("../../shared/reportBuilder.js"));

  // Every report a tile can be: the named tiles above, then every standard report.
  async function catalog() {
    const R = await rb();
    const out = [];
    for (const [key, t] of Object.entries(TAB)) out.push({ key, title: t.title, description: t.description, opens: t.opens });
    for (const [key, t] of Object.entries(STD)) out.push({ key, title: t.title, description: t.description, opens: `std:${t.std}` });
    const covered = new Set(Object.values(STD).map(t => t.std).concat(["by-fund", "lybunt", "sybunt", "retention", "top-50"]));
    for (const s of R.STANDARD_REPORTS) if (!covered.has(s.key)) out.push({ key: `std:${s.key}`, title: s.name, description: s.question, opens: `std:${s.key}` });
    return out;
  }
  const known = async key => (await catalog()).find(c => c.key === key) || null;

  // One tile, through its report's own route, as the person looking.
  async function tile(req, key, fy) {
    const c = await known(key);
    if (!c) return null;
    const auth = { authorization: req.headers.authorization || "" };
    const ask = async path => {
      const r = await inProcess.get(path, { headers: auth });
      if (r.status !== 200) { let e = null; try { e = JSON.parse(r.body); } catch { /* not JSON */ } throw Object.assign(new Error((e && (e.error || e.message)) || "That report did not open."), { status: r.status }); }
      return { body: JSON.parse(r.body), stored: r.headers && r.headers["x-org-summary"] === "stored" };
    };
    try {
      if (TAB[key]) {
        const { body, stored } = await ask(TAB[key].path(fy));
        return { ...c, figures: TAB[key].pick(body).filter(Boolean), stored };
      }
      const stdKey = STD[key] ? STD[key].std : key.slice(4);
      const { body } = await ask(`/saved-reports/${encodeURIComponent("std:" + stdKey)}/run`);
      const t = STD[key] || {};
      if (t.pick) return { ...c, figures: t.pick(body).filter(Boolean) };
      // A report with no figure of its own: its row count and its totals, exactly as its foot reads.
      const tot = body.totals || { count: (body.rows || []).length, sums: [] };
      const figures = t.noCount ? [] : [{ label: t.countLabel || "Rows on the report", kind: "count", value: tot.count, opensReport: true }];
      for (const s of (tot.sums || []).slice(0, 2)) figures.push({ label: s.label, kind: "money", value: s.cents / 100, opensReport: true });
      return { ...c, figures };
    } catch (e) {
      return { ...c, figures: [], error: e.status === 403 ? "You do not have access to this report." : e.message };
    }
  }

  const fyOf = async orgId => {
    const [o] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
    return orgTime.orgReportYear({ ...(await orgTz(orgId)), vocabulary_json: o ? o.vocabulary_json : null }, "fiscal");
  };
  async function keysOf(orgId, userId) {
    const [r] = await query(`SELECT keys FROM report_dashboard_tiles WHERE org_id=? AND user_id=?`, [orgId, userId]);
    const k = r ? (typeof r.keys === "string" ? JSON.parse(r.keys) : r.keys) : null;
    return Array.isArray(k) ? k : DEFAULT_KEYS.slice();
  }
  async function saveKeys(req, keys) {
    const a = actor(req);
    await run(`INSERT INTO report_dashboard_tiles (org_id, user_id, keys, created_by, created_by_name) VALUES (?,?,?::jsonb,?,?)
               ON CONFLICT (org_id, user_id) DO UPDATE SET keys = EXCLUDED.keys, updated_at = NOW()`,
      [req.user.orgId, req.user.userId, JSON.stringify(keys), a.id, a.name]);
  }

  // GET, and it writes nothing: the tiles, each read through its report.
  app.get("/your-dashboard", requireAuth, wrap(async (req, res) => {
    const keys = await keysOf(req.user.orgId, req.user.userId);
    const fy = await fyOf(req.user.orgId);
    const tiles = [];
    for (const k of keys) { const t = await tile(req, k, fy); if (t) tiles.push(t); }
    const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM saved_reports WHERE org_id=? AND (shared = true OR owner_id = ?)`, [req.user.orgId, req.user.userId]);
    res.json({ tiles, keys, isDefault: JSON.stringify(keys) === JSON.stringify(DEFAULT_KEYS), opensFirst: n === 0,
      sentence: "Each tile is a report Steward already has. Open one to see every row behind it." });
  }));
  // The gallery: every report, with one line. A preview is asked for one at a time (GET /your-dashboard/preview/:key).
  app.get("/your-dashboard/gallery", requireAuth, wrap(async (req, res) => {
    const keys = new Set(await keysOf(req.user.orgId, req.user.userId));
    res.json({ reports: (await catalog()).map(c => ({ ...c, added: keys.has(c.key) })) });
  }));
  app.get("/your-dashboard/preview/:key", requireAuth, wrap(async (req, res) => {
    const t = await tile(req, String(req.params.key), await fyOf(req.user.orgId));
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  }));
  app.post("/your-dashboard/tiles", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const key = String((req.body && req.body.key) || "");
    const c = await known(key);
    if (!c) return res.status(400).json({ error: "That is not a report Steward has." });
    const keys = (await keysOf(req.user.orgId, req.user.userId)).filter(k => k !== key);
    const at = Number.isInteger(req.body.at) ? Math.max(0, Math.min(keys.length, req.body.at)) : keys.length;
    if (keys.length >= MAX_TILES) return res.status(400).json({ error: `A dashboard holds at most ${MAX_TILES} reports. Take one off first.` });
    keys.splice(at, 0, key);
    await saveKeys(req, keys);
    res.json({ keys, message: `Added ${c.title} to your dashboard.` });
  }));
  app.delete("/your-dashboard/tiles/:key", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const key = String(req.params.key);
    const before = await keysOf(req.user.orgId, req.user.userId);
    const at = before.indexOf(key);
    if (at < 0) return res.status(404).json({ error: "Not on your dashboard." });
    const keys = before.filter(k => k !== key);
    await saveKeys(req, keys);
    const c = await known(key);
    res.json({ keys, message: `Took ${c ? c.title : "that report"} off your dashboard.`,
      undo: { label: "Undo", path: "/your-dashboard/tiles", method: "POST", body: { key, at } } });
  }));
}

module.exports = { routers, mount, DEFAULT_KEYS };
