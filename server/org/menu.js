// server/org/menu.js · NAV-1 (menu, 10 Nov). THE ORG'S SIDEBAR AND ITS MAJOR GIFTS TABS.
//
// Jonathan, 10 Nov: the menu is customizable per org, every entry on by default
// (Auctions and Peer-to-peer included), and "I only want Top 100 in Major
// Gifts for Allie's org". So two org settings, each a switch and never an org id:
//
//   orgs.nav_layout  the org's sidebar, [{ id, visible }] in order. NULL means
//                    every entry shown (client/src/lib/navGroups.js orgNavLayout).
//                    Each person's own layout (users.nav_layout, /me/nav-layout)
//                    sits on top: they may hide more and reorder, never show
//                    what the org hid. Hiding is the menu only; every route and
//                    link still works and nothing is deleted.
//   orgs.mg_views    which Major Gifts tabs show. NULL means all four.
//
//   GET  /org/menu                 anyone signed in (the shell reads it)
//   PUT  /org/menu                 admins: { layout?: [...] | null, mgViews?: [...] | null }
//   GET  /admin/orgs/:id/menu      super admin
//   POST /admin/orgs/:id/menu      super admin; audited in THAT org's log as Steward support
//
// The audit row is written by middleware/auditTrail.js; these routes only name it.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };

const MG_VIEW_IDS = ["top100", "portfolios", "pipeline", "plans"];
// Home and Settings: hiding either leaves somebody with no way back (navGroups.js NEVER_HIDDEN).
const ALWAYS_VISIBLE = new Set(["dashboard", "settings"]);

// [{ id, visible }] → the same, deduped, or null when it is not that shape.
function normalizeLayout(layout) {
  if (!Array.isArray(layout) || layout.length > 60) return null;
  const out = [], seen = new Set();
  for (const row of layout) {
    if (!row || typeof row.id !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(row.id)) return null;
    if (typeof row.visible !== "boolean") return null;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, visible: ALWAYS_VISIBLE.has(row.id) ? true : row.visible });
  }
  return out;
}

// ["top100", …] → the known ids in canonical order, at least one; null otherwise.
function normalizeViews(views) {
  if (!Array.isArray(views)) return null;
  const want = new Set(views.filter(v => typeof v === "string"));
  const out = MG_VIEW_IDS.filter(v => want.has(v));
  return out.length ? out : null;
}

const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// What the shell needs: the org's layout (null = defaults), its Major Gifts
// tabs (always a list), and whether it has a peer-to-peer page (Fundraising
// shows that part only then).
async function orgMenu(query, orgId) {
  const [o] = await query("SELECT nav_layout, mg_views FROM orgs WHERE id=?", [orgId]);
  if (!o) return null;
  const [p] = await query("SELECT COUNT(*)::int AS n FROM giving_pages WHERE org_id=? AND p2p_enabled=true", [orgId]);
  return {
    layout: normalizeLayout(parse(o.nav_layout)),
    mgViews: normalizeViews(parse(o.mg_views)) || MG_VIEW_IDS.slice(),
    hasP2p: !!(p && p.n > 0),
  };
}

// The body's two optional fields → the SET clause, or an error sentence.
function changesFrom(body) {
  const sets = [], vals = [];
  if (body && "layout" in body) {
    if (body.layout === null) { sets.push("nav_layout = NULL"); }
    else {
      const l = normalizeLayout(body.layout);
      if (!l) return { error: "layout must be a list of {id, visible}" };
      sets.push("nav_layout = ?"); vals.push(JSON.stringify(l));
    }
  }
  if (body && "mgViews" in body) {
    if (body.mgViews === null) { sets.push("mg_views = NULL"); }
    else {
      const v = normalizeViews(body.mgViews);
      if (!v) return { error: "Major Gifts needs at least one of Top 100, Portfolios, Pipeline and Plans" };
      // All four is stored as NULL, so a fifth tab added later reaches everybody.
      if (v.length === MG_VIEW_IDS.length) sets.push("mg_views = NULL");
      else { sets.push("mg_views = ?"); vals.push(JSON.stringify(v)); }
    }
  }
  if (!sets.length) return { error: "nothing to change: send layout or mgViews" };
  return { sets, vals };
}

function mount(ctx) {
  const { query, run, requireAuth, wrap } = ctx;
  // Guards this router's mount context may not carry: the boot share has them
  // by the time routes mount (server/boot/steps-2.js; requireSuperAdmin is a
  // list of two middlewares, which Express takes as it is).
  const shared = require("../boot/share").ctx;
  const requireAdmin = ctx.requireAdmin || shared.requireAdmin;
  const requireSuperAdmin = ctx.requireSuperAdmin || shared.requireSuperAdmin;
  const checkWriteAccess = ctx.checkWriteAccess || shared.checkWriteAccess;
  if (!requireAdmin || !requireSuperAdmin || !checkWriteAccess) throw new Error("server/org/menu.js: a guard is missing at mount");
  const app = routers.r1;
  const save = (orgId, ch) => run(`UPDATE orgs SET ${ch.sets.join(", ")} WHERE id=?`, [...ch.vals, orgId]);

  app.get("/org/menu", requireAuth, wrap(async (req, res) => {
    const m = await orgMenu(query, req.user.orgId);
    if (!m) return res.status(404).json({ error: "Not found" });
    res.json(m);
  }));

  app.put("/org/menu", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const ch = changesFrom(req.body);
    if (ch.error) return res.status(400).json({ error: ch.error });
    await save(req.user.orgId, ch);
    req.audit.entity("org setting", req.user.orgId, "Menu");
    res.json(await orgMenu(query, req.user.orgId));
  }));

  app.get("/admin/orgs/:id/menu", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const m = await orgMenu(query, req.params.id);
    if (!m) return res.status(404).json({ error: "Org not found" });
    res.json(m);
  }));

  app.post("/admin/orgs/:id/menu", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const [o] = await query("SELECT id FROM orgs WHERE id=?", [req.params.id]);
    if (!o) return res.status(404).json({ error: "Org not found" });
    const ch = changesFrom(req.body);
    if (ch.error) return res.status(400).json({ error: ch.error });
    await save(o.id, ch);
    const { SUPPORT_ACTOR } = await import("../../shared/clientSafe.js");
    req.audit.forOrg(o.id);
    req.audit.actor({ kind: "support", id: "support:" + req.user.userId, name: SUPPORT_ACTOR });
    req.audit.entity("org setting", o.id, "Menu");
    res.json(await orgMenu(query, o.id));
  }));
}

module.exports = { routers, mount, orgMenu, normalizeLayout, normalizeViews, MG_VIEW_IDS };
