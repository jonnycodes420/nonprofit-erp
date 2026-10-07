// routes/search.js · WIRE-1, SEARCH-2. ⌘K FINDS EVERYTHING.
//
//   GET /search?q=           the one search behind the top bar and the phone header
//   GET /search?q=&kinds=a,b "see all": only those kinds, up to fifty of each
//
// Every kind of record Steward keeps, from this org only: people (by name,
// email, phone or an organisation's contact person), households, campaigns and
// appeals, events, giving pages, peer-to-peer pages, grants, auctions,
// membership levels, open tasks, saved reports, saved dashboards, past board
// reports, documents by file name, and (SEARCH-2) gifts, monthly plans,
// pledges, journeys, meetings, emails, notes and imports.
//
// SEARCH-2 reads a few kinds of words as more than words (searchTerms.js):
// "$500" is gifts, pledges and plans of $500; "Oct 3" is that day's gifts and
// meetings; "Rafael gift" is Rafael's gifts. Everything else is matched as
// words: % and _ are escaped, so "100%" finds "100%" and "_" is not a
// wildcard. Fewer than two characters finds nothing.
//
// ONE STATEMENT. Every kind is a sub-select of a single query, so the whole
// search is one round trip to the database (prod's is about 65ms), however
// many kinds there are. Twenty-three side-by-side queries would queue on a
// pool of ten. Each kind reads one more row than it shows, so the answer can
// say a group has more ("see all").
//
// Deleted records never show: gifts, pledges, notes and emails are deleted
// for real, and a person who was deleted takes their gifts, plans, pledges,
// meetings, emails and notes out of search with them (every one of those
// joins the person and asks for deleted_at IS NULL). An archived journey is
// left out.
//
// A GET, and it writes nothing.
//
// A volunteer coordinator never reaches this route: auth.js refuses it (it is
// not on the coordinator's allowlist), because almost every kind here carries
// giving. The check below says the same thing a second time, so a change to
// the allowlist cannot quietly open it.
"use strict";
const express = require("express");
const { readSearch } = require("../searchTerms");
const { meetingsSql } = require("../meetings");

const routers = { r0: express.Router() };
const PER_KIND = 5;      // shown in a group: three; one more says "see all"
const SEE_ALL = 50;

// A LIKE pattern from what somebody typed, with its own wildcards escaped.
function likePattern(q) {
  return "%" + String(q).replace(/[\\%_]/g, ch => "\\" + ch) + "%";
}

const KINDS = ["people", "personGifts", "households", "campaigns", "events", "pages", "p2p", "grants", "auctions",
  "levels", "tasks", "reports", "dashboards", "boardFiles", "files", "grantFiles",
  "gifts", "plans", "pledges", "journeys", "meetings", "emails", "notes", "imports"];

function mount(ctx) {
const { query, requireAuth, wrap, VOLUNTEER_COORDINATOR } = ctx;
const app = routers.r0;

app.get("/search", requireAuth, wrap(async (req, res) => {
  if (req.user.role === VOLUNTEER_COORDINATOR) {
    return res.status(403).json({ error: "coordinator_scope",
      message: "Your account covers volunteers and hours. Search the volunteer roster instead." });
  }
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 2) return res.json({ q, results: [], more: {} });
  const want = req.query.kinds ? new Set(String(req.query.kinds).split(",").filter(k => KINDS.includes(k))) : null;
  const orgId = req.user.orgId;
  const userId = req.user.userId;
  const p = likePattern(q);
  const digits = q.replace(/\D/g, "");
  const L = (want ? SEE_ALL : PER_KIND) + 1;
  const E = "ESCAPE '\\'";
  const read = readSearch(q);
  const amt = read.amount, day = read.date;
  // "Rafael gift": the money kinds match the name, not the whole phrase.
  const nameP = read.personGifts ? likePattern(read.personGifts) : p;
  // A day, on a YYYY-MM-DD text column: that exact day, or with no year that
  // month and day in any year.
  const dayOn = col => !day ? null : day.iso ? { sql: `${col} = ?`, args: [day.iso] }
    : { sql: `SUBSTRING(${col} FROM 6 FOR 5) = ?`, args: [day.monthDay] };
  // OR of the conditions that apply; FALSE when none do.
  const anyOf = conds => {
    const c = conds.filter(Boolean);
    return c.length ? { sql: "(" + c.map(x => x.sql).join(" OR ") + ")", args: c.flatMap(x => x.args) }
      : { sql: "FALSE", args: [] };
  };
  const money = col => amt ? { sql: `${col} = ?`, args: [amt.dollars] } : null;
  const nameMatch = { sql: `d.name ILIKE ? ${E}`, args: [nameP] };

  const reads = {
    people: {
      sql: `SELECT id, name, email, phone, kind, person_types, total_giving, contact_name
         FROM donors
        WHERE org_id = ? AND deleted_at IS NULL
          AND (name ILIKE ? ${E} OR email ILIKE ? ${E} OR contact_name ILIKE ? ${E} OR phone ILIKE ? ${E} OR mobile ILIKE ? ${E}
               ${digits.length >= 4 && !amt?.explicit ? "OR regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE ? OR regexp_replace(COALESCE(mobile,''), '\\D', '', 'g') LIKE ?" : ""})
        ORDER BY (lower(name) LIKE lower(?) ${E}) DESC, total_giving DESC NULLS LAST, id
        LIMIT ${L}`,
      args: [orgId, p, p, p, p, p, ...(digits.length >= 4 && !amt?.explicit ? ["%" + digits + "%", "%" + digits + "%"] : []),
        String(q).replace(/[\\%_]/g, ch => "\\" + ch) + "%"] },
    // "Rafael gift": the person, opened on their gifts.
    personGifts: read.personGifts ? {
      sql: `SELECT id, name, kind, total_giving FROM donors
        WHERE org_id = ? AND deleted_at IS NULL AND name ILIKE ? ${E}
        ORDER BY total_giving DESC NULLS LAST, id LIMIT ${L}`, args: [orgId, nameP] } : null,
    households: {
      sql: `SELECT h.id, h.name, h.primary_donor_id,
              (SELECT d.id FROM donors d WHERE d.org_id = h.org_id AND d.household_id = h.id AND d.deleted_at IS NULL ORDER BY d.total_giving DESC NULLS LAST, d.id LIMIT 1) AS member_id,
              (SELECT COUNT(*)::int FROM donors d WHERE d.org_id = h.org_id AND d.household_id = h.id AND d.deleted_at IS NULL) AS members
         FROM households h WHERE h.org_id = ? AND h.name ILIKE ? ${E} ORDER BY lower(h.name), h.id LIMIT ${L}`, args: [orgId, p] },
    campaigns: {
      sql: `SELECT id, name, type, status, goal_amount, start_date FROM campaigns
        WHERE org_id = ? AND (name ILIKE ? ${E} OR donor_facing_name ILIKE ? ${E})
        ORDER BY start_date DESC NULLS LAST, created_at DESC, id LIMIT ${L}`, args: [orgId, p, p] },
    events: {
      sql: `SELECT id, name, date, location FROM events
        WHERE org_id = ? AND (name ILIKE ? ${E} OR location ILIKE ? ${E})
        ORDER BY date DESC NULLS LAST, id LIMIT ${L}`, args: [orgId, p, p] },
    pages: {
      sql: `SELECT id, title, slug, status FROM giving_pages
        WHERE org_id = ? AND (title ILIKE ? ${E} OR slug ILIKE ? ${E})
        ORDER BY updated_at DESC NULLS LAST, id LIMIT ${L}`, args: [orgId, p, p] },
    p2p: {
      sql: `SELECT pf.id, pf.name, pf.slug, pf.status, gp.title AS page_title, pf.giving_page_id
         FROM peer_fundraisers pf LEFT JOIN giving_pages gp ON gp.id = pf.giving_page_id AND gp.org_id = pf.org_id
        WHERE pf.org_id = ? AND (pf.name ILIKE ? ${E} OR pf.slug ILIKE ? ${E})
        ORDER BY pf.created_at DESC, pf.id LIMIT ${L}`, args: [orgId, p, p] },
    grants: {
      sql: `SELECT id, funder, program, amount, status, funder_donor_id FROM grants
        WHERE org_id = ? AND (funder ILIKE ? ${E} OR program ILIKE ? ${E} OR cycle_name ILIKE ? ${E})
        ORDER BY created_at DESC, id LIMIT ${L}`, args: [orgId, p, p, p] },
    auctions: {
      sql: `SELECT a.id, a.title, a.status, a.closes_at,
              (SELECT COUNT(*)::int FROM auction_items i WHERE i.org_id = a.org_id AND i.auction_id = a.id AND i.title ILIKE ? ${E}) AS item_hits
         FROM auctions a
        WHERE a.org_id = ? AND (a.title ILIKE ? ${E}
              OR EXISTS (SELECT 1 FROM auction_items i WHERE i.org_id = a.org_id AND i.auction_id = a.id AND i.title ILIKE ? ${E}))
        ORDER BY a.created_at DESC, a.id LIMIT ${L}`, args: [p, orgId, p, p] },
    levels: {
      sql: `SELECT id, name, price, term FROM membership_levels
        WHERE org_id = ? AND name ILIKE ? ${E} ORDER BY position NULLS LAST, lower(name), id LIMIT ${L}`, args: [orgId, p] },
    tasks: {
      sql: `SELECT t.id, t.title, t.due, t.donor_id, d.name AS donor_name FROM tasks t
         LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND COALESCE(t.done,0) = 0 AND t.voided_at IS NULL AND t.title ILIKE ? ${E}
        ORDER BY t.due NULLS LAST, t.id LIMIT ${L}`, args: [orgId, p] },
    // Saved reports and dashboards: the ones this person may open (shared, or
    // their own), the same rule the Reports rail reads.
    reports: {
      sql: `SELECT id, name FROM saved_reports WHERE org_id = ? AND (shared = true OR owner_id = ?) AND name ILIKE ? ${E}
        ORDER BY lower(name), id LIMIT ${L}`, args: [orgId, userId, p] },
    dashboards: {
      sql: `SELECT id, name FROM saved_dashboards WHERE org_id = ? AND (shared = true OR owner_id = ?) AND name ILIKE ? ${E}
        ORDER BY lower(name), id LIMIT ${L}`, args: [orgId, userId, p] },
    boardFiles: {
      sql: `SELECT id, title, file_name, period_label FROM stored_sheets
        WHERE org_id = ? AND kind = 'board_report' AND removed_at IS NULL AND (title ILIKE ? ${E} OR file_name ILIKE ? ${E})
        ORDER BY created_at DESC, id LIMIT ${L}`, args: [orgId, p, p] },
    // Documents by file name: a file kept on somebody's timeline, and a
    // grant's documents.
    files: {
      sql: `SELECT a.id, a.filename AS file_name, a.donor_id, d.name AS donor_name FROM interaction_attachments a
         JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id AND d.deleted_at IS NULL
        WHERE a.org_id = ? AND a.deleted_at IS NULL AND a.filename ILIKE ? ${E}
        ORDER BY a.created_at DESC, a.id LIMIT ${L}`, args: [orgId, p] },
    grantFiles: {
      sql: `SELECT gd.id, gd.file_name, gd.grant_id, g.funder FROM grant_documents gd
         JOIN grants g ON g.id = gd.grant_id AND g.org_id = gd.org_id
        WHERE gd.org_id = ? AND gd.file_name ILIKE ? ${E}
        ORDER BY gd.uploaded_at DESC NULLS LAST, gd.id LIMIT ${L}`, args: [orgId, p] },
  };

  // ── SEARCH-2 · the records that hang off a person ──────────────────────────
  // Gifts: by amount, by the day, by cheque number, or by who gave.
  {
    const w = anyOf([money("g.amount"), dayOn("g.date"),
      amt && amt.digits ? { sql: "g.check_number = ?", args: [amt.digits] } : null,
      !amt && !day ? { sql: `g.check_number ILIKE ? ${E}`, args: [p] } : null,
      !amt && !day ? nameMatch : null]);
    reads.gifts = {
      sql: `SELECT g.id, g.amount, g.date, g.check_number, g.payment_method, g.donor_id, d.name AS donor_name
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
        WHERE g.org_id = ? AND ${w.sql}
        ORDER BY g.date DESC, g.created_at DESC, g.id LIMIT ${L}`, args: [orgId, ...w.args] };
  }
  // Monthly plans: by amount or by who gives.
  {
    const w = anyOf([money("r.amount"), !amt && !day ? nameMatch : null]);
    reads.plans = {
      sql: `SELECT r.id, r.amount, r.interval, r.status, r.donor_id, d.name AS donor_name
         FROM recurring_subscriptions r JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id AND d.deleted_at IS NULL
        WHERE r.org_id = ? AND ${w.sql}
        ORDER BY (r.status = 'canceled'), r.created_at DESC, r.id LIMIT ${L}`, args: [orgId, ...w.args] };
  }
  // Pledges: by amount, the day it is due, who promised it, or its note.
  {
    const w = anyOf([money("pl.amount"), dayOn("pl.due_date"),
      !amt && !day ? nameMatch : null, !amt && !day && !read.personGifts ? { sql: `pl.notes ILIKE ? ${E}`, args: [p] } : null]);
    reads.pledges = {
      sql: `SELECT pl.id, pl.amount, pl.due_date, pl.status, pl.donor_id, d.name AS donor_name
         FROM pledges pl JOIN donors d ON d.id = pl.donor_id AND d.org_id = pl.org_id AND d.deleted_at IS NULL
        WHERE pl.org_id = ? AND ${w.sql}
        ORDER BY pl.due_date DESC, pl.id LIMIT ${L}`, args: [orgId, ...w.args] };
  }
  // Journeys: by name or description; archived ones are gone.
  reads.journeys = {
    sql: `SELECT id, name, description, journey_enabled, jsonb_array_length(COALESCE(steps, '[]'::jsonb))::int AS step_count
       FROM cultivation_templates
      WHERE org_id = ? AND archived_at IS NULL AND (name ILIKE ? ${E} OR description ILIKE ? ${E})
      ORDER BY lower(name), id LIMIT ${L}`, args: [orgId, p, p] };
  // Meetings: the one meetings query (calendar and logged), by its title,
  // note or place, or by the day it was on.
  {
    const m = meetingsSql(orgId);
    const w = anyOf([dayOn("m.date"),
      !amt && !day ? { sql: `(m.title ILIKE ? ${E} OR m.note ILIKE ? ${E} OR m.location ILIKE ? ${E})`, args: [p, p, p] } : null]);
    reads.meetings = {
      sql: `SELECT m.id, m.kind, m.title, m.note, m.date, m.location, m.donor_id, d.name AS donor_name
         FROM (${m.sql}) m JOIN donors d ON d.id = m.donor_id AND d.org_id = ? AND d.deleted_at IS NULL
        WHERE ${w.sql}
        ORDER BY m.date DESC, m.id LIMIT ${L}`, args: [...m.args, orgId, ...w.args] };
  }
  // Emails: by subject, or by who sent it (the person for one they wrote, the
  // colleague for one we wrote). The sender's address is never stored, so a
  // person's own address finds the mail they sent.
  if (!amt && !day) {
    reads.emails = {
      sql: `SELECT i.id, i.date, i.donor_id, d.name AS donor_name, i.logged_by_name,
              COALESCE(NULLIF(i.metadata->>'subject', ''), split_part(i.note, E'\\n', 1)) AS subject,
              i.metadata->>'direction' AS direction
         FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id AND d.deleted_at IS NULL
        WHERE i.org_id = ? AND i.type = 'email'
          AND (COALESCE(NULLIF(i.metadata->>'subject', ''), split_part(i.note, E'\\n', 1)) ILIKE ? ${E}
               OR (COALESCE(i.metadata->>'direction', '') = 'outbound' AND i.logged_by_name ILIKE ? ${E})
               OR (COALESCE(i.metadata->>'direction', '') <> 'outbound' AND (d.name ILIKE ? ${E} OR d.email ILIKE ? ${E})))
        ORDER BY i.date DESC NULLS LAST, i.created_at DESC, i.id LIMIT ${L}`, args: [orgId, p, p, p, p] };
    // Notes: by their words.
    reads.notes = {
      sql: `SELECT i.id, i.date, i.note, i.donor_id, d.name AS donor_name
         FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id AND d.deleted_at IS NULL
        WHERE i.org_id = ? AND i.type = 'note' AND i.note ILIKE ? ${E}
        ORDER BY i.date DESC NULLS LAST, i.created_at DESC, i.id LIMIT ${L}`, args: [orgId, p] };
  }
  // Imports: by the name or file name, or the day it went in (the org's day).
  {
    const tzDay = `TO_CHAR(im.committed_at AT TIME ZONE (SELECT COALESCE(NULLIF(oz.timezone, ''), 'America/New_York') FROM orgs oz WHERE oz.id = im.org_id), 'YYYY-MM-DD')`;
    const w = anyOf([dayOn(tzDay), !amt && !day ? { sql: `(im.name ILIKE ? ${E} OR im.source_filename ILIKE ? ${E})`, args: [p, p] } : null]);
    reads.imports = {
      sql: `SELECT im.id, im.name, im.source_filename, ${tzDay} AS day, im.rows_in, im.gifts_created, im.reversed_at
         FROM imports im WHERE im.org_id = ? AND ${w.sql}
        ORDER BY im.committed_at DESC, im.id LIMIT ${L}`, args: [orgId, ...w.args] };
  }

  // The words-only kinds have nothing to say about an amount or a day.
  if (amt?.explicit || day) {
    for (const k of ["households", "campaigns", "pages", "p2p", "grants", "auctions", "levels", "tasks",
      "reports", "dashboards", "boardFiles", "files", "grantFiles", "journeys"]) delete reads[k];
  }

  // One statement: each kind a json array of its rows.
  const keys = Object.keys(reads).filter(k => reads[k] && (!want || want.has(k)));
  if (!keys.length) return res.json({ q, results: [], more: {} });
  const sql = "SELECT " + keys.map(k =>
    `(SELECT COALESCE(json_agg(t), '[]'::json) FROM (${reads[k].sql}) t) AS "${k}"`).join(",\n");
  const [row] = await query(sql, keys.flatMap(k => reads[k].args));
  const more = {};
  const r = {};
  for (const k of KINDS) {
    const rows = (row && row[k]) || [];
    if (rows.length >= L) more[k] = true;
    r[k] = rows.slice(0, L - 1);
  }

  const isOrg = k => k === "organisation" || k === "organization";
  const day10 = v => v ? String(v).slice(0, 10) : null;
  const results = [];
  for (const d of r.personGifts) {
    results.push({ kind: "personGifts", id: d.id, title: d.name, organization: isOrg(d.kind), personKind: d.kind || null,
      totalGiving: Number(d.total_giving) || 0 });
  }
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
  for (const e of r.events) results.push({ kind: "event", id: e.id, title: e.name, date: day10(e.date), location: e.location || "" });
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
  for (const g of r.gifts) results.push({ kind: "gift", id: g.id, title: g.donor_name, amount: Number(g.amount) || 0, date: day10(g.date),
    checkNumber: g.check_number || "", method: g.payment_method || "", donorId: g.donor_id });
  for (const s of r.plans) results.push({ kind: "plan", id: s.id, title: s.donor_name, amount: Number(s.amount) || 0,
    interval: s.interval || "month", status: s.status || null, donorId: s.donor_id });
  for (const s of r.pledges) results.push({ kind: "pledge", id: s.id, title: s.donor_name, amount: Number(s.amount) || 0,
    due: day10(s.due_date), status: s.status || null, donorId: s.donor_id });
  for (const j of r.journeys) results.push({ kind: "journey", id: j.id, title: j.name, steps: j.step_count || 0, on: !!j.journey_enabled });
  for (const m of r.meetings) results.push({ kind: "meeting", id: m.id, title: m.title || firstLine(m.note) || "Meeting", date: day10(m.date),
    logged: m.kind === "logged", location: m.location || "", donorId: m.donor_id, donorName: m.donor_name || "" });
  for (const e of r.emails) results.push({ kind: "email", id: e.id, title: firstLine(e.subject) || "Email", date: day10(e.date),
    from: e.direction === "outbound" ? (e.logged_by_name || "") : e.donor_name, donorId: e.donor_id, donorName: e.donor_name || "" });
  for (const n of r.notes) results.push({ kind: "note", id: n.id, title: snippet(n.note, q), date: day10(n.date), donorId: n.donor_id, donorName: n.donor_name || "" });
  for (const i of r.imports) results.push({ kind: "import", id: i.id, title: i.source_filename || i.name, name: i.name || "", date: i.day || null,
    rows: i.rows_in || 0, gifts: i.gifts_created || 0, undone: !!i.reversed_at });
  res.json({ q, results, more });
}));
}

function firstLine(s) {
  return String(s || "").split("\n")[0].trim().slice(0, 140);
}

// The words around the match, so a note found by its middle shows its middle.
function snippet(text, q) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const at = s.toLowerCase().indexOf(String(q).toLowerCase());
  if (at < 50 || s.length <= 120) return s.slice(0, 120);
  return "…" + s.slice(at - 40, at + 80);
}

module.exports = { routers, mount, likePattern, KINDS };
