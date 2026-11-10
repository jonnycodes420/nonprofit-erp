// server/donors/giftAttribution.js · QUICKADD-1. WHAT A GIFT CAME FROM.
//
// Allie Barnett (Justin's Place, beta) typed six Good Giving Challenge gifts
// and had nowhere to say "the Good Giving Challenge" or which fundraiser each
// one gave to. A gift now carries three answers, each searched from what the
// org already has:
//   · Campaign: the goal it counts toward (campaigns, the thermometer's rows).
//   · Appeal: the ask that brought it in (appeals, QUICKADD-1's own table).
//   · Fundraiser / giving page: the page it came through, or one person's
//     peer-to-peer page under it (giving_pages, peer_fundraisers).
// Campaign and Appeal can be made right there ("+ New campaign: …"). A giving
// page is made in Forms, where its slug and its story are set, never here.
//
//   GET  /gift-attribution/:kind?q=   kind = campaign | appeal | page
//   POST /gift-attribution/campaign   { name }   an existing name is handed back
//   POST /gift-attribution/appeal     { name, campaignId? }
//
// checkAttribution() is the one org-scope check for appealId / givingPageId /
// peerFundraiserId, read by the gift form's route and the deposit sheet.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };
const NAME_MAX = 120;
const cleanName = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const like = q => `%${String(q || "").trim().toLowerCase().replace(/[\\%_]/g, c => "\\" + c)}%`;
const day = v => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

async function checkAttribution(query, orgId, b) {
  const body = b || {};
  const appealIn = body.appealId || body.appeal_id || null;
  const pageIn = body.givingPageId || body.giving_page_id || null;
  const peerIn = body.peerFundraiserId || body.peer_fundraiser_id || null;
  const out = { appealId: null, givingPageId: null, peerFundraiserId: null };
  if (appealIn) {
    const [a] = await query("SELECT id FROM appeals WHERE id=? AND org_id=? AND archived_at IS NULL", [String(appealIn), orgId]);
    if (!a) return { status: 404, error: "Appeal not found" };
    out.appealId = a.id;
  }
  if (peerIn) {
    const [p] = await query("SELECT id, giving_page_id FROM peer_fundraisers WHERE id=? AND org_id=?", [String(peerIn), orgId]);
    if (!p) return { status: 404, error: "Fundraiser not found" };
    out.peerFundraiserId = p.id; out.givingPageId = p.giving_page_id;   // a fundraiser's page is the page it sits on
  }
  if (pageIn && !out.givingPageId) {
    const [g] = await query("SELECT id FROM giving_pages WHERE id=? AND org_id=?", [String(pageIn), orgId]);
    if (!g) return { status: 404, error: "Giving page not found" };
    out.givingPageId = g.id;
  }
  return out;
}

// The deposit sheet's lines, each with its own campaign, appeal and page (the
// sticky ones arrive filled in, the screen having carried them down). Checked
// before anything is written, like the line's event.
async function lineAttribution(query, orgId, lines, depositDate) {
  const NUM = require("../../campaignMatch");
  const byLine = new Map();
  for (const l of (Array.isArray(lines) ? lines : [])) {
    if (!l) continue;
    const a = await checkAttribution(query, orgId, l);
    if (a.error) return { status: a.status, error: a.error, line: Number(l.line) };
    let campaignId = null, campaignName = "";
    if (l.campaignId) {
      const [c] = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE id=? AND org_id=?", [String(l.campaignId), orgId]);
      if (!c) return { status: 404, error: "Campaign not found", line: Number(l.line) };
      const refusal = NUM.campaignWindowRefusal(c, depositDate);
      if (refusal) return { status: 400, error: refusal, code: "campaign_window", line: Number(l.line) };
      campaignId = c.id; campaignName = c.name;
    }
    // A new person's email, phone and address, typed on their line.
    const np = l.person && typeof l.person === "object" ? l.person : null;
    const person = np ? Object.fromEntries(["email", "phone", "address", "city", "state", "zip"].map(k =>
      [k, String(np[k] == null ? "" : np[k]).trim().slice(0, k === "address" ? 200 : 120) || null])) : null;
    byLine.set(Number(l.line), { ...a, campaignId, campaignName, person });
  }
  return { byLine };
}

async function search(query, orgId, kind, q) {
  const pat = like(q);
  if (kind === "campaign") {
    const rows = await query(
      `SELECT id, name, start_date, end_date FROM campaigns
        WHERE org_id=? AND LOWER(name) LIKE ? AND COALESCE(status,'') <> 'archived'
        ORDER BY created_at DESC NULLS LAST LIMIT 20`, [orgId, pat]);
    return rows.map(r => ({ id: r.id, name: r.name, startDate: day(r.start_date), endDate: day(r.end_date) }));
  }
  if (kind === "appeal") {
    const rows = await query(
      `SELECT a.id, a.name, a.campaign_id, c.name AS campaign_name FROM appeals a
         LEFT JOIN campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
        WHERE a.org_id=? AND a.archived_at IS NULL AND LOWER(a.name) LIKE ?
        ORDER BY a.created_at DESC LIMIT 20`, [orgId, pat]);
    return rows.map(r => ({ id: r.id, name: r.name, campaignId: r.campaign_id || null, sub: r.campaign_name || null }));
  }
  if (kind === "page") {
    const pages = await query(
      `SELECT id, title FROM giving_pages WHERE org_id=? AND LOWER(title) LIKE ?
        ORDER BY created_at DESC LIMIT 20`, [orgId, pat]);
    const peers = await query(
      `SELECT pf.id, pf.name, pf.giving_page_id, gp.title FROM peer_fundraisers pf
         JOIN giving_pages gp ON gp.id = pf.giving_page_id AND gp.org_id = pf.org_id
        WHERE pf.org_id=? AND (LOWER(pf.name) LIKE ? OR LOWER(gp.title) LIKE ?)
        ORDER BY pf.created_at DESC LIMIT 20`, [orgId, pat, pat]);
    return [
      ...pages.map(p => ({ id: "page:" + p.id, name: p.title, givingPageId: p.id, peerFundraiserId: null, sub: "Giving page" })),
      ...peers.map(p => ({ id: "peer:" + p.id, name: p.name, givingPageId: p.giving_page_id, peerFundraiserId: p.id, sub: `Fundraiser on ${p.title}` })),
    ];
  }
  return null;
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, actor } = ctx;
  const app = routers.r1;

  app.get("/gift-attribution/:kind", requireAuth, wrap(async (req, res) => {
    const rows = await search(query, req.user.orgId, req.params.kind, req.query.q);
    if (!rows) return res.status(404).json({ error: "Unknown kind" });
    res.json({ rows });
  }));

  // A name already on file is handed back rather than made twice: "Good
  // Giving Challenge" typed on the sixth gift is the campaign the first made.
  app.post("/gift-attribution/campaign", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: "Name the campaign." });
    const [had] = await query("SELECT id, name, start_date, end_date FROM campaigns WHERE org_id=? AND LOWER(name)=LOWER(?) ORDER BY created_at DESC LIMIT 1", [orgId, name]);
    if (had) return res.json({ id: had.id, name: had.name, startDate: day(had.start_date), endDate: day(had.end_date), existed: true });
    const id = newId("cmp");
    // No goal and no dates: a campaign made from a gift is a name to attribute
    // to. Its goal and its dates are set on Fundraising, where the thermometer is.
    await run(
      `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,recipient_count,open_count,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,0,0,?,?)`,
      [id, orgId, name, "appeal", "", "", "active", JSON.stringify({}), actor(req).id, actor(req).name]);
    res.status(201).json({ id, name, startDate: null, endDate: null, existed: false });
  }));

  app.post("/gift-attribution/appeal", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: "Name the appeal." });
    const campaignIn = req.body && req.body.campaignId ? String(req.body.campaignId) : null;
    if (campaignIn) {
      const [c] = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignIn, orgId]);
      if (!c) return res.status(404).json({ error: "Campaign not found" });
    }
    const [had] = await query("SELECT id, name, campaign_id FROM appeals WHERE org_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL", [orgId, name]);
    if (had) return res.json({ id: had.id, name: had.name, campaignId: had.campaign_id || null, existed: true });
    const id = newId("apl");
    await run(`INSERT INTO appeals (id,org_id,name,campaign_id,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
      [id, orgId, name, campaignIn, actor(req).id, actor(req).name]);
    res.status(201).json({ id, name, campaignId: campaignIn, existed: false });
  }));
}

module.exports = { routers, mount, checkAttribution, lineAttribution };
