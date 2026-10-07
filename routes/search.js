// routes/search.js · WIRE-1. ⌘K FINDS EVERYTHING.
//
//   GET /search?q=   the one search behind the top bar and the phone header
//
// Every kind of record Steward keeps, by its name, five of each, from this org
// only: people (by name, email, phone or an organisation's contact person),
// households, campaigns and appeals, events, giving pages, peer-to-peer
// pages, grants, auctions, membership levels, open tasks, saved reports,
// saved dashboards, past board reports, and documents by file name.
//
// The words typed are matched as words: % and _ are escaped, so "100%" finds
// "100%" and "_" is not a wildcard. Fewer than two characters finds nothing.
// A GET, and it writes nothing.
//
// A volunteer coordinator never reaches this route: auth.js refuses it (it is
// not on the coordinator's allowlist), because almost every kind here carries
// giving. The check below says the same thing a second time, so a change to
// the allowlist cannot quietly open it.
"use strict";
const express = require("express");

const routers = { r0: express.Router() };
const PER_KIND = 5;

// A LIKE pattern from what somebody typed, with its own wildcards escaped.
function likePattern(q) {
  return "%" + String(q).replace(/[\\%_]/g, ch => "\\" + ch) + "%";
}

function mount(ctx) {
const { query, requireAuth, wrap, VOLUNTEER_COORDINATOR } = ctx;
const app = routers.r0;

app.get("/search", requireAuth, wrap(async (req, res) => {
  if (req.user.role === VOLUNTEER_COORDINATOR) {
    return res.status(403).json({ error: "coordinator_scope",
      message: "Your account covers volunteers and hours. Search the volunteer roster instead." });
  }
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 2) return res.json({ q, results: [] });
  const orgId = req.user.orgId;
  const userId = req.user.userId;
  const p = likePattern(q);
  const digits = q.replace(/\D/g, "");
  const L = PER_KIND;
  const E = "ESCAPE '\\'";

  // Every read goes to the database side by side: one round trip of time,
  // not fifteen (prod's round trip is about 65ms).
  const reads = {
    people: query(
      `SELECT id, name, email, phone, kind, person_types, total_giving, contact_name
         FROM donors
        WHERE org_id = ? AND deleted_at IS NULL
          AND (name ILIKE ? ${E} OR email ILIKE ? ${E} OR contact_name ILIKE ? ${E} OR phone ILIKE ? ${E} OR mobile ILIKE ? ${E}
               ${digits.length >= 4 ? "OR regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE ? OR regexp_replace(COALESCE(mobile,''), '\\D', '', 'g') LIKE ?" : ""})
        ORDER BY (lower(name) LIKE lower(?) ${E}) DESC, total_giving DESC NULLS LAST, id
        LIMIT ${L}`,
      [orgId, p, p, p, p, p, ...(digits.length >= 4 ? ["%" + digits + "%", "%" + digits + "%"] : []),
       String(q).replace(/[\\%_]/g, ch => "\\" + ch) + "%"]),
    households: query(
      `SELECT h.id, h.name, h.primary_donor_id,
              (SELECT d.id FROM donors d WHERE d.org_id = h.org_id AND d.household_id = h.id AND d.deleted_at IS NULL ORDER BY d.total_giving DESC NULLS LAST, d.id LIMIT 1) AS member_id,
              (SELECT COUNT(*)::int FROM donors d WHERE d.org_id = h.org_id AND d.household_id = h.id AND d.deleted_at IS NULL) AS members
         FROM households h WHERE h.org_id = ? AND h.name ILIKE ? ${E} ORDER BY lower(h.name), h.id LIMIT ${L}`, [orgId, p]),
    campaigns: query(
      `SELECT id, name, type, status, goal_amount, start_date FROM campaigns
        WHERE org_id = ? AND (name ILIKE ? ${E} OR donor_facing_name ILIKE ? ${E})
        ORDER BY start_date DESC NULLS LAST, created_at DESC, id LIMIT ${L}`, [orgId, p, p]),
    events: query(
      `SELECT id, name, date, location FROM events
        WHERE org_id = ? AND (name ILIKE ? ${E} OR location ILIKE ? ${E})
        ORDER BY date DESC NULLS LAST, id LIMIT ${L}`, [orgId, p, p]),
    pages: query(
      `SELECT id, title, slug, status FROM giving_pages
        WHERE org_id = ? AND (title ILIKE ? ${E} OR slug ILIKE ? ${E})
        ORDER BY updated_at DESC NULLS LAST, id LIMIT ${L}`, [orgId, p, p]),
    p2p: query(
      `SELECT pf.id, pf.name, pf.slug, pf.status, gp.title AS page_title, pf.giving_page_id
         FROM peer_fundraisers pf LEFT JOIN giving_pages gp ON gp.id = pf.giving_page_id AND gp.org_id = pf.org_id
        WHERE pf.org_id = ? AND (pf.name ILIKE ? ${E} OR pf.slug ILIKE ? ${E})
        ORDER BY pf.created_at DESC, pf.id LIMIT ${L}`, [orgId, p, p]),
    grants: query(
      `SELECT id, funder, program, amount, status, funder_donor_id FROM grants
        WHERE org_id = ? AND (funder ILIKE ? ${E} OR program ILIKE ? ${E} OR cycle_name ILIKE ? ${E})
        ORDER BY created_at DESC, id LIMIT ${L}`, [orgId, p, p, p]),
    auctions: query(
      `SELECT a.id, a.title, a.status, a.closes_at,
              (SELECT COUNT(*)::int FROM auction_items i WHERE i.org_id = a.org_id AND i.auction_id = a.id AND i.title ILIKE ? ${E}) AS item_hits
         FROM auctions a
        WHERE a.org_id = ? AND (a.title ILIKE ? ${E}
              OR EXISTS (SELECT 1 FROM auction_items i WHERE i.org_id = a.org_id AND i.auction_id = a.id AND i.title ILIKE ? ${E}))
        ORDER BY a.created_at DESC, a.id LIMIT ${L}`, [p, orgId, p, p]),
    levels: query(
      `SELECT id, name, price, term FROM membership_levels
        WHERE org_id = ? AND name ILIKE ? ${E} ORDER BY position NULLS LAST, lower(name), id LIMIT ${L}`, [orgId, p]),
    tasks: query(
      `SELECT t.id, t.title, t.due, t.donor_id, d.name AS donor_name FROM tasks t
         LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND COALESCE(t.done,0) = 0 AND t.voided_at IS NULL AND t.title ILIKE ? ${E}
        ORDER BY t.due NULLS LAST, t.id LIMIT ${L}`, [orgId, p]),
    // Saved reports and dashboards: the ones this person may open (shared, or
    // their own), the same rule the Reports rail reads.
    reports: query(
      `SELECT id, name FROM saved_reports WHERE org_id = ? AND (shared = true OR owner_id = ?) AND name ILIKE ? ${E}
        ORDER BY lower(name), id LIMIT ${L}`, [orgId, userId, p]),
    dashboards: query(
      `SELECT id, name FROM saved_dashboards WHERE org_id = ? AND (shared = true OR owner_id = ?) AND name ILIKE ? ${E}
        ORDER BY lower(name), id LIMIT ${L}`, [orgId, userId, p]),
    boardFiles: query(
      `SELECT id, title, file_name, period_label FROM stored_sheets
        WHERE org_id = ? AND kind = 'board_report' AND removed_at IS NULL AND (title ILIKE ? ${E} OR file_name ILIKE ? ${E})
        ORDER BY created_at DESC, id LIMIT ${L}`, [orgId, p, p]),
    // Documents by file name: a file kept on somebody's timeline, and a
    // grant's documents.
    files: query(
      `SELECT a.id, a.filename AS file_name, a.donor_id, d.name AS donor_name FROM interaction_attachments a
         JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id AND d.deleted_at IS NULL
        WHERE a.org_id = ? AND a.deleted_at IS NULL AND a.filename ILIKE ? ${E}
        ORDER BY a.created_at DESC, a.id LIMIT ${L}`, [orgId, p]),
    grantFiles: query(
      `SELECT gd.id, gd.file_name, gd.grant_id, g.funder FROM grant_documents gd
         JOIN grants g ON g.id = gd.grant_id AND g.org_id = gd.org_id
        WHERE gd.org_id = ? AND gd.file_name ILIKE ? ${E}
        ORDER BY gd.uploaded_at DESC NULLS LAST, gd.id LIMIT ${L}`, [orgId, p]),
  };
  const keys = Object.keys(reads);
  const got = await Promise.all(keys.map(k => reads[k]));
  const r = Object.fromEntries(keys.map((k, i) => [k, got[i]]));

  const isOrg = k => k === "organisation" || k === "organization";
  const results = [];
  for (const d of r.people) {
    results.push({ kind: "person", id: d.id, title: d.name, email: d.email || "", phone: d.phone || "",
      contactName: d.contact_name || "", organization: isOrg(d.kind), personKind: d.kind || null,
      person_types: d.person_types || null, totalGiving: Number(d.total_giving) || 0 });
  }
  for (const h of r.households) {
    results.push({ kind: "household", id: h.id, title: h.name, members: h.members || 0,
      openDonorId: h.primary_donor_id || h.member_id || null });
  }
  for (const c of r.campaigns) {
    // A campaign with a goal lives in Fundraising; an email campaign with no
    // goal lives in Communications.
    results.push({ kind: "campaign", id: c.id, title: c.name, type: c.type || null, status: c.status || null,
      fundraising: Number(c.goal_amount) > 0 });
  }
  for (const e of r.events) results.push({ kind: "event", id: e.id, title: e.name, date: e.date ? String(e.date instanceof Date ? e.date.toISOString() : e.date).slice(0, 10) : null, location: e.location || "" });
  for (const g of r.pages) results.push({ kind: "page", id: g.id, title: g.title || g.slug, slug: g.slug || "", status: g.status || null });
  for (const f of r.p2p) results.push({ kind: "p2p", id: f.id, title: f.name, pageTitle: f.page_title || "", status: f.status || null });
  for (const g of r.grants) results.push({ kind: "grant", id: g.id, title: g.funder, program: g.program || "", amount: Number(g.amount) || 0, status: g.status || null });
  for (const a of r.auctions) results.push({ kind: "auction", id: a.id, title: a.title, status: a.status || null, itemHits: a.item_hits || 0 });
  for (const l of r.levels) results.push({ kind: "level", id: l.id, title: l.name, price: Number(l.price) || 0, term: l.term || "" });
  for (const t of r.tasks) results.push({ kind: "task", id: t.id, title: t.title, due: t.due || null, donorId: t.donor_id || null, donorName: t.donor_name || "" });
  for (const s of r.reports) results.push({ kind: "report", id: s.id, title: s.name });
  for (const s of r.dashboards) results.push({ kind: "dashboard", id: s.id, title: s.name });
  for (const s of r.boardFiles) results.push({ kind: "boardFile", id: s.id, title: s.title || s.file_name, fileName: s.file_name || "", period: s.period_label || "" });
  for (const f of r.files) results.push({ kind: "document", id: f.id, title: f.file_name, donorId: f.donor_id, donorName: f.donor_name || "" });
  for (const f of r.grantFiles) results.push({ kind: "grantDocument", id: f.id, title: f.file_name, grantId: f.grant_id, funder: f.funder || "" });
  res.json({ q, results });
}));
}

module.exports = { routers, mount, likePattern };
