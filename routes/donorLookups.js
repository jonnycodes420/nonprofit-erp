// routes/donorLookups.js · SCALE-2 part 1. THE SHELL STOPS HOLDING EVERY DONOR.
//
// The app shell used to load GET /donors/summaries (every person in the org,
// 24 MB at 25,000 donors) on every sign-in, so that a picker, a count or a
// name lookup could read it from memory. These are those reads, asked of the
// database instead:
//
//   GET /donors/pick?q=&match=&limit=&status=   a few people for a picker
//   GET /donors/pick?exact=<name>&limit=        people whose name is exactly that
//   GET /donors/lookup?ids=a,b,c                 these people, by id
//   GET /donors/counts                           how many, and how many lapsed
//   GET /donors/birthdays-near                   birthdays from yesterday to a week out
//
// THE SAME ROWS AS THE LIST THEY REPLACE. Every read here is over exactly the
// set /donors/summaries returned (this org, not deleted, every kind of person,
// archived included), in exactly its order (total_giving DESC, id), with its
// columns, so a picker's first match and a count are what they were when the
// browser worked them out from the whole list.
//
// Declared ahead of crm.js's /donors/:id (Express order). GETs only; they
// write nothing. A volunteer coordinator never reaches /donors/* (auth.js).
"use strict";
const express = require("express");
const DTAGS = require("../donorTags");
const { orgToday, addDays } = require("../orgTime");

const routers = { r0: express.Router() };

// The columns /donors/summaries carries, so adaptDonor reads these rows the same.
const COLS = `id, name, email, phone, stage, status, total_giving, last_gift_date,
  last_gift_amount, gift_count, assigned_to, assigned_to_name,
  pending_assignee_invite_id, pending_assignee_name,
  city, state, zip, country, address, kind, contact_name,
  latitude, longitude, geocode_status,
  tags, wealth_score, capacity_tier, planned_giving,
  employer, stripe_subscription_status,
  deceased, do_not_contact, do_not_solicit, do_not_mail, do_not_email,
  imported_sustainer, imported_sustainer_amount, imported_sustainer_last_gift,
  birth_month, birth_day, birth_year`;
const SET = "org_id = ? AND deleted_at IS NULL";
const ORDER = "ORDER BY total_giving DESC, id";
const shape = d => ({ ...d, tags: DTAGS.visibleTags(d.tags) });
const clampLimit = (v, dflt, max) => Math.min(Math.max(parseInt(v, 10) || dflt, 1), max);

function mount(ctx) {
const { query, requireAuth, wrap } = ctx;
const app = routers.r0;

// A picker's people. `match` says what the typed text is matched against,
// because the pickers it replaces did not all agree:
//   concat  name and email run together (the Donors list's own search)
//   either  the name, or the email
//   name    the name only
// Matching is a plain lower-cased substring, never a pattern: % and _ are
// letters here, as they were in the browser.
app.get("/donors/pick", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const limit = clampLimit(req.query.limit, 20, 2000);
  const where = [SET]; const args = [orgId];
  const exact = req.query.exact != null ? String(req.query.exact).trim().toLowerCase() : null;
  const q = String(req.query.q || "").trim().toLowerCase();
  if (exact != null) {
    if (!exact) return res.json([]);
    // trimStored=1: the stored name's own surrounding spaces don't count either.
    where.push(req.query.trimStored === "1" ? "LOWER(BTRIM(COALESCE(name,''))) = ?" : "LOWER(COALESCE(name,'')) = ?");
    args.push(exact);
  } else if (q) {
    const m = req.query.match;
    if (m === "name") { where.push("strpos(LOWER(COALESCE(name,'')), ?) > 0"); args.push(q); }
    else if (m === "either") { where.push("(strpos(LOWER(COALESCE(name,'')), ?) > 0 OR strpos(LOWER(COALESCE(email,'')), ?) > 0)"); args.push(q, q); }
    else { where.push("strpos(LOWER(COALESCE(name,'') || COALESCE(email,'')), ?) > 0"); args.push(q); }
  }
  if (req.query.status) { where.push("status = ?"); args.push(String(req.query.status)); }
  if (req.query.withEmail === "1") where.push("COALESCE(email,'') <> ''");
  if (req.query.named === "1") where.push("COALESCE(name,'') <> ''");
  if (req.query.kind) { where.push("kind = ?"); args.push(String(req.query.kind)); }
  const rows = await query(`SELECT ${COLS} FROM donors WHERE ${where.join(" AND ")} ${ORDER} LIMIT ?`, [...args, limit]);
  res.json(rows.map(shape));
}));

// These people, by id: a rail, a deep link, a list of transactions.
app.get("/donors/lookup", requireAuth, wrap(async (req, res) => {
  const ids = [...new Set(String(req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean))].slice(0, 500);
  if (!ids.length) return res.json([]);
  const rows = await query(`SELECT ${COLS} FROM donors WHERE ${SET} AND id = ANY(?) ${ORDER}`, [req.user.orgId, ids]);
  res.json(rows.map(shape));
}));

// How many people, and the lapse counts the screens show. FIX-49: one rule
// (lapseRule.js, through donorStatus.js's tags), on the org's calendar:
//   lapsed        gave before, no gift in the last 12 months (it read a
//                 status nothing wrote, so it was always 0)
//   lapsing       last gift 9 to 12 months ago
//   reengage      the Re-engage tab's badge: the lapsed who may be asked (not
//                 deceased, do-not-contact, do-not-solicit or an imported
//                 sustainer), or anyone an officer moved to the lapsed stage.
app.get("/donors/counts", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const DS = require("../donorStatus");
  const today = await DS.todayFor(orgId);
  const st = DS.statusSql(orgId, today, await DS.cutsFor(orgId));
  const [r] = await query(`WITH s AS MATERIALIZED (${st.sql})
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s.lifecycle = 'lapsed')::int AS lapsed,
      COUNT(*) FILTER (WHERE s.lapsing)::int AS lapsing,
      COUNT(*) FILTER (WHERE deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND do_not_solicit IS NOT TRUE
        AND imported_sustainer IS NOT TRUE AND (stage = 'lapsed' OR s.lifecycle = 'lapsed'))::int AS reengage
    FROM donors LEFT JOIN s ON s.donor_id = donors.id WHERE ${SET}`, [...st.args, orgId]);
  res.json(r);
}));

// Birthdays from yesterday to seven days out, on the org's calendar. A wider
// window than Home shows, on purpose: the browser decides which of these fall
// this week (shared/birthday.js, Feb 29 on Feb 28 in a common year), from the
// org's today it already holds, so the two can never disagree about a day.
app.get("/donors/birthdays-near", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [org] = await query("SELECT timezone FROM orgs WHERE id = ?", [orgId]);
  const today = orgToday(org || {});
  const pairs = new Set();
  for (let n = -1; n <= 7; n++) {
    const [, m, d] = addDays(today, n).split("-").map(Number);
    pairs.add(`${m}-${d}`);
    if (m === 2 && d === 28) pairs.add("2-29");
  }
  const md = [...pairs].map(p => p.split("-").map(Number));
  const rows = await query(`SELECT ${COLS} FROM donors WHERE ${SET} AND deceased IS NOT TRUE
      AND (birth_month, birth_day) IN (SELECT * FROM unnest(?::int[], ?::int[])) ${ORDER}`,
    [orgId, md.map(x => x[0]), md.map(x => x[1])]);
  res.json(rows.map(shape));
}));
}

module.exports = { routers, mount };
