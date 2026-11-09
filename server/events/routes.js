// server/events/routes.js — events: the list, levels, guests, tables and seating, check-in, the report and follow-up.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const TL = require("../../timelineLine");
const AL = require("./attendanceLines");   // STALE-2: a guest's timeline lines follow the guest row
const MY = require("./missedYou");   // FLOWS-4: "Missed you" follows the guest list as it stands
const DL = require("../../shared/numbers/donorLabel");   // WALKB-2: who is a donor, the profile's rule
const PM = require("../../personMatch");   // WIRE-1 rule 1: one record per person   // WIRE-1 rule 2: every act lands on the timeline
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  EV_PUBLIC_READY, EV_READY, UNDO_SECONDS, actor, brandEmailHeaderHtml, checkThemeImageDimensions,
  checkWriteAccess, demoMailNote, donorFacingOrgName, escapeHtml, eventLevelPayload, eventPageHtml,
  figureSources, fromWithDisplayName, levelTaken, logEventRegistered, maybeStartJourney, normalizeUploadImage,
  orgOwns, orgTime, orgToday, orgTz, orgTzName, pruneUnreferencedAssets, publicAppUrl, putThemeAsset, query,
  recordAssetPointerHistory, recordGift, registerForEvent, requireAuth, run, sendDonorLifecycleEmail,
  staffWho, trashRow, uploadImageError, uuid, wrap,
} = ctx;
let EV = null;
EV_READY.then(m => { EV = m; });
// PARITY-2 Part 3: the page's own rules (times, video, share row, gallery).
let EPG = null;
const EPG_READY = import("../../shared/eventPage.js").then(m => { EPG = m; return m; });

// Find the person by id, or by email, or create them — the same shape a
// staff member registering a walk-up guest needs.
async function eventDonorFor(orgId, body, who) {
  if (body?.donorId) {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(body.donorId), orgId]);
    return d ? d.id : null;
  }
  const name = String(body?.name || "").trim().slice(0, 200);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  if (!name && !email) return null;
  const known = await PM.findPersonId(orgId, { email, name });   // WIRE-1 rule 1
  if (known) return known;
  const id = newId("d");
  await run(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name) VALUES (?,?,?,?,'prospect','active','[]',?,?)`,
    [id, orgId, name || email, email || null, who.id, who.name]);
  return id;
}
let app = routers.r1;

// ── EVENT ROUTES (levels, registration, tables, attendance) ─────────────────
app.get("/events/:id/levels", requireAuth, wrap(async (req, res) => {
  const [ev] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const levels = await query("SELECT * FROM event_levels WHERE event_id=? AND org_id=? ORDER BY kind DESC, position, price", [ev.id, req.user.orgId]);
  const out = [];
  for (const l of levels) out.push(eventLevelPayload(l, await levelTaken(l.id)));
  res.json({ levels: out });
}));

app.post("/events/:id/levels", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EV_READY;
  const [ev] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const v = EV.validateLevel(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level, id = newId("evl");
  await run(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,member_price,capacity,recognition,benefits,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?)`,
    [id, req.user.orgId, ev.id, L.kind, L.name, L.priceCents / 100, L.fmvCents / 100,
     L.memberPriceCents == null ? null : L.memberPriceCents / 100, L.capacity, L.recognition, JSON.stringify(L.benefits), actor(req).id, actor(req).name]);
  res.status(201).json({ id });
}));

app.put("/event-levels/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EV_READY;
  const [l] = await query("SELECT * FROM event_levels WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!l) return res.status(404).json({ error: "Not found" });
  const v = EV.validateLevel({ ...eventLevelPayload(l), ...req.body });
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const L = v.level;
  await run("UPDATE event_levels SET kind=?, name=?, price=?, fmv=?, member_price=?, capacity=?, recognition=?, benefits=?::jsonb WHERE id=? AND org_id=?",
    [L.kind, L.name, L.priceCents / 100, L.fmvCents / 100,
     L.memberPriceCents == null ? null : L.memberPriceCents / 100, L.capacity, L.recognition, JSON.stringify(L.benefits), l.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.delete("/event-levels/:id", requireAuth, wrap(async (req, res) => {
  // A level somebody bought cannot vanish from under their receipt.
  const [used] = await query("SELECT COUNT(*)::int AS n FROM event_attendees WHERE level_id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (used?.n) return res.status(409).json({ error: "level_in_use", message: "People have registered at this level. It can be edited, not removed." });
  const { changes } = await run("DELETE FROM event_levels WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// Staff-side registration: a person, a level, how many, and whether it is paid.
app.post("/events/:id/register", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EV_READY;
  const orgId = req.user.orgId;
  const [event] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const [level] = await query("SELECT * FROM event_levels WHERE id=? AND event_id=? AND org_id=?", [String(req.body?.levelId || ""), event.id, orgId]);
  if (!level) return res.status(404).json({ error: "Level not found" });
  if (level.retired_at) return res.status(400).json({ error: `${level.name} is retired. Choose a current ticket type.` });
  const qty = Number(req.body?.quantity || 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > EV.MAX_QTY) return res.status(400).json({ error: `quantity is 1 to ${EV.MAX_QTY}` });
  const who = actor(req);
  const donorId = await eventDonorFor(orgId, req.body, who);
  if (!donorId) return res.status(req.body?.donorId ? 404 : 400).json({ error: req.body?.donorId ? "Donor not found" : "Who is registering? A person on file, or a name and email." });
  const idem = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 128) : null;
  try {
    const r = await registerForEvent({ orgId, event, level, donorId, qty, paid: req.body?.paid !== false,
      paymentMethod: req.body?.paymentMethod || null, idemKey: idem, who });
    res.status(201).json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

// The guest list: who, what level, which table, whether they came.
//
// FIX-11 Part 2 — and THE TABLES, which are rows now rather than whatever
// strings happened to be on the guests. An event with twelve empty tables has
// twelve tables, and that is what made the old card unusable: it could only
// show a table once somebody was already sitting at it.
const eventGuestCols = `a.id, a.donor_id, a.name, a.email, a.status, a.quantity, a.table_label,
            a.table_id, a.seat_no, a.vip, a.recognition, a.dietary, a.guest_of, a.checked_in_at,
            a.registration_gift_id, a.sponsor_pledge_id, l.name AS level_name, l.kind AS level_kind`;

async function eventGuestsPayload(eventId, orgId) {
  const guests = await query(
    `SELECT ${eventGuestCols}
       FROM event_attendees a LEFT JOIN event_levels l ON l.id = a.level_id
      WHERE a.event_id=? AND a.org_id=? AND ${figureSources.EVENT_GUEST_LIVE("a")}   -- FIX-59: a deleted person has no seat
      ORDER BY a.table_label NULLS LAST, a.name`, [eventId, orgId]);
  const tables = await query(
    `SELECT id, label, seats, sponsor_name, sort, shape FROM event_tables
      WHERE event_id=? AND org_id=? ORDER BY sort NULLS LAST, label`, [eventId, orgId]);
  return { guests, tables };
}

app.get("/events/:id/guests", requireAuth, wrap(async (req, res) => {
  // public_slug is here so the "no guests yet" empty state can offer the
  // registration page as the other way guests arrive.
  const [event] = await query("SELECT id, name, date, public_slug FROM events WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const { guests, tables } = await eventGuestsPayload(event.id, req.user.orgId);
  res.json({ event, guests, tables,
    // The label→names map the first version of this route returned, kept for
    // anything still reading it. The chart is built from `tables` now.
    tablesByLabel: guests.reduce((m, g) => { if (g.table_label) (m[g.table_label] ||= []).push(g.name); return m; }, {}),
    recognition: guests.filter(g => g.recognition && g.status !== "cancelled").map(g => g.recognition) });
}));

// ── THE TABLES ────────────────────────────────────────────────────────────
// Add them in a batch ("how many and seats each", which is how a gala is laid
// out) or one at a time with a name ("Sponsor table, Smith Co."). Labels are
// unique per event, so adding "10 tables of 8" twice does not make twenty
// tables called the same ten things.
function nextTableNumber(existing) {
  let max = 0;
  for (const t of existing) {
    const m = String(t.label || "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

app.post("/events/:id/tables", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const seats = Math.max(1, Math.min(60, parseInt(req.body?.seats, 10) || 8));
  const howMany = Math.max(1, Math.min(60, parseInt(req.body?.count, 10) || 1));
  const label = String(req.body?.label || "").trim().slice(0, 80);
  const sponsorName = String(req.body?.sponsorName || "").trim().slice(0, 120) || null;
  const shape = req.body?.shape === "long" ? "long" : "round";   // PARITY-4
  if (label && howMany > 1) {
    return res.status(400).json({ error: "Name one table, or ask for a number of them, not both." });
  }
  const existing = await query("SELECT label, sort FROM event_tables WHERE event_id=? AND org_id=?", [event.id, orgId]);
  let n = nextTableNumber(existing);
  let sort = existing.reduce((m, t) => Math.max(m, Number(t.sort) || 0), 0);
  const who = actor(req);
  const made = [];
  for (let i = 0; i < howMany; i++) {
    const thisLabel = label || `Table ${n++}`;
    const id = newId("etb");
    const r = await query(
      `INSERT INTO event_tables (id, org_id, event_id, label, seats, sponsor_name, sort, shape, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (event_id, label) DO NOTHING RETURNING id, label, seats`,
      [id, orgId, event.id, thisLabel, seats, sponsorName, ++sort, shape, who.id, who.name]);
    if (r.length) made.push(r[0]);
    else if (label) return res.status(409).json({ error: `This event already has a table called ${thisLabel}.` });
  }
  req.audit && req.audit.summary && req.audit.summary(
    `${made.length} ${made.length === 1 ? "table" : "tables"} of ${seats} seats`, { count: made.length });
  const { guests, tables } = await eventGuestsPayload(event.id, orgId);
  res.status(201).json({ ok: true, created: made.length, tables, guests });
}));

app.put("/events/:id/tables/:tableId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM event_tables WHERE id=? AND event_id=? AND org_id=?",
    [req.params.tableId, req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Table not found" });
  const label = req.body?.label !== undefined ? String(req.body.label || "").trim().slice(0, 80) : t.label;
  if (!label) return res.status(400).json({ error: "A table needs a name." });
  const seats = req.body?.seats !== undefined
    ? Math.max(1, Math.min(60, parseInt(req.body.seats, 10) || t.seats)) : t.seats;
  const sponsorName = req.body?.sponsorName !== undefined
    ? (String(req.body.sponsorName || "").trim().slice(0, 120) || null) : t.sponsor_name;
  const shape = req.body?.shape !== undefined ? (req.body.shape === "long" ? "long" : "round") : (t.shape || "round");

  // SHRINKING A TABLE BELOW THE PEOPLE AT IT is refused rather than silently
  // leaving it over-full: the seats number is what every other refusal in this
  // screen is measured against, and one that lies makes all of them lie.
  const [{ n: sitting }] = await query(
    "SELECT COUNT(*)::int AS n FROM event_attendees WHERE table_id=? AND event_id=? AND org_id=? AND status <> 'cancelled'",
    [t.id, req.params.id, orgId]);
  if (seats < sitting) {
    return res.status(400).json({
      error: `${sitting} ${sitting === 1 ? "guest is" : "guests are"} at ${t.label}. Move somebody first, or give it at least ${sitting} seats.` });
  }
  if (label !== t.label) {
    const [clash] = await query("SELECT id FROM event_tables WHERE event_id=? AND org_id=? AND label=? AND id <> ?",
      [req.params.id, orgId, label, t.id]);
    if (clash) return res.status(409).json({ error: `This event already has a table called ${label}.` });
  }
  await run("UPDATE event_tables SET label=?, seats=?, sponsor_name=?, shape=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [label, seats, sponsorName, shape, t.id, orgId]);
  // A smaller table drops the chair numbers past its end; those guests take
  // the lowest free chairs (seatPlaces) the next time anybody looks.
  await run("UPDATE event_attendees SET seat_no=NULL WHERE table_id=? AND org_id=? AND seat_no > ?", [t.id, orgId, seats]);
  // The label the guests carry moves WITH the table. Every reader that was
  // written before tables were rows (the print chart, the name tags, the
  // kiosk, the guest export) reads `table_label`, and none of them has to
  // learn about table ids for a rename to work.
  if (label !== t.label) {
    await run("UPDATE event_attendees SET table_label=? WHERE table_id=? AND event_id=? AND org_id=?",
      [label, t.id, req.params.id, orgId]);
  }
  const { guests, tables } = await eventGuestsPayload(req.params.id, orgId);
  res.json({ ok: true, tables, guests });
}));

app.delete("/events/:id/tables/:tableId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM event_tables WHERE id=? AND event_id=? AND org_id=?",
    [req.params.tableId, req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Table not found" });
  // The guests do not go with it. They go back to Not seated, and the response
  // says who moved so the screen can offer to put them back.
  const moved = await query(
    `UPDATE event_attendees SET table_id=NULL, table_label=NULL, seat_no=NULL
      WHERE table_id=? AND event_id=? AND org_id=? RETURNING id, name`, [t.id, req.params.id, orgId]);
  await run("DELETE FROM event_tables WHERE id=? AND org_id=?", [t.id, orgId]);
  const { guests, tables } = await eventGuestsPayload(req.params.id, orgId);
  res.json({
    ok: true, tables, guests,
    undo: moved.map(m => ({ attendeeId: m.id, label: t.label, seats: t.seats, sponsorName: t.sponsor_name })),
    sentence: moved.length
      ? `${t.label} is gone. ${moved.length} ${moved.length === 1 ? "guest" : "guests"} went back to Not seated.`
      : `${t.label} is gone.`,
  });
}));

// ── SEATING ───────────────────────────────────────────────────────────────
// ONE route moves people, whether it is one guest tapped on a phone, a party
// on one ticket, several ticked at once, or the whole plan "Seat everyone"
// drew. Capacity and the never-split-a-party rule are checked HERE, from the
// same `seatFit` the screen uses, so what the screen offers and what the
// server allows cannot drift apart.
//
// Moving somebody to "" is unseating them, which always has room.
async function applySeating(req, res, { moves, orgId, eventId }) {
  await EV_READY;
  const [event] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [eventId, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const { guests, tables } = await eventGuestsPayload(event.id, orgId);
  const byId = new Map(guests.map(g => [g.id, g]));
  const tableRows = tables;
  const byLabel = new Map(tableRows.map(t => [t.label, t]));

  // Validate the WHOLE batch against a running copy of the chart before
  // writing anything, so a batch never half-applies.
  const chart = EV.seatingChart(guests, { tables: tableRows });
  const openBy = new Map(chart.tables.map(t => [t.label, t.open]));
  const planned = [];
  for (const m of moves) {
    const g = byId.get(String(m.attendeeId));
    if (!g) return res.status(404).json({ error: "That guest is not on this list." });
    const want = EV.tableLabel(m.table);
    if (!want) { planned.push({ g, label: null, tableId: null }); continue; }
    const row = byLabel.get(want);
    if (!row) return res.status(404).json({ error: `This event has no table called ${want}. Add it first.` });
    const from = EV.tableLabel(g.table_label);
    if (from === want) { planned.push({ g, label: want, tableId: row.id, seat: m.seat, near: m.near }); continue; }
    const open = openBy.get(want) ?? 0;
    if (open < 1) {
      return res.status(409).json({ error: `${want} is full.`, table: want });
    }
    openBy.set(want, open - 1);
    if (from) openBy.set(from, (openBy.get(from) ?? 0) + 1);
    planned.push({ g, label: want, tableId: row.id, seat: m.seat, near: m.near });
  }

  // PARITY-4: THE CHAIR. Who is on which chair now, by the same seatPlaces
  // the drawn room uses; everybody in this batch gets up first, then each
  // sits on the chair they were dropped on, or the lowest free one. A chair
  // somebody NOT in this batch is sitting on is refused by name, never
  // silently swapped, because the other person did not ask to move.
  const moving = new Set(planned.map(p => p.g.id));
  const chairs = new Map();   // label -> array of guest id | null
  const sittingOn = new Map(); // guest id -> the chair they are on now
  for (const t of chart.tables) {
    const capacity = Number(t.capacity) || 0;
    t.places.slice(0, capacity).forEach((x, i) => { if (x) sittingOn.set(x.id, i + 1); });
    chairs.set(t.label, t.places.slice(0, capacity).map(x => (x && !moving.has(x.id) ? x.id : null)));
  }
  for (const p of planned) {
    if (!p.label) { p.seatNo = null; continue; }
    const list = chairs.get(p.label) || [];
    const askedRaw = p.seat;
    const asked = askedRaw === undefined || askedRaw === null || askedRaw === "" ? null : parseInt(askedRaw, 10);
    if (asked !== null) {
      if (!Number.isInteger(asked) || asked < 1 || asked > list.length) {
        return res.status(400).json({ error: `${p.label} has chairs 1 to ${list.length}.` });
      }
      const holder = list[asked - 1];
      if (holder && holder !== p.g.id) {
        const who = byId.get(holder);
        return res.status(409).json({ error: `Chair ${asked} at ${p.label} is ${who ? who.name + "'s" : "taken"}. Move them first.`, table: p.label });
      }
      if (!holder) { list[asked - 1] = p.g.id; p.seatNo = asked; continue; }
    }
    // No chair named, or a party member after the first: the next free chair,
    // starting from the one asked for so a party sits side by side.
    // Staying at the same table with no chair named keeps the chair they had.
    const stay = EV.tableLabel(p.g.table_label) === p.label ? sittingOn.get(p.g.id) : null;
    const near = parseInt(p.near != null ? p.near : stay, 10);
    const start = asked ? asked - 1 : (Number.isInteger(near) && near >= 1 && near <= list.length ? near - 1 : 0);
    let at = -1;
    for (let i = 0; i < list.length; i++) { const k = (start + i) % list.length; if (!list[k]) { at = k; break; } }
    if (at === -1) return res.status(409).json({ error: `${p.label} is full.`, table: p.label });
    list[at] = p.g.id; p.seatNo = at + 1;
  }

  for (const p of planned) {
    await run("UPDATE event_attendees SET table_id=?, table_label=?, seat_no=? WHERE id=? AND event_id=? AND org_id=?",
      [p.tableId, p.label, p.seatNo, p.g.id, event.id, orgId]);
  }
  const after = await eventGuestsPayload(event.id, orgId);
  const seatedCount = planned.filter(p => p.label).length;
  return res.json({
    ok: true, tables: after.tables, guests: after.guests,
    moved: planned.length,
    // What it was before, so the screen can offer a real undo rather than a
    // guess at one.
    undo: planned.map(p => ({ attendeeId: p.g.id, table: p.g.table_label || "", seat: p.g.seat_no || null })),
    sentence: planned.length === 0 ? "Nothing to move."
      : seatedCount === 0
        ? `${planned.length} ${planned.length === 1 ? "guest" : "guests"} went back to Not seated.`
        : `${seatedCount} ${seatedCount === 1 ? "guest" : "guests"} seated.`,
  });
}

// One guest, by drag or by tap. Unchanged in shape so the old caller still works.
app.put("/events/:id/attendees/:attendeeId/table", requireAuth, checkWriteAccess, wrap(async (req, res) =>
  applySeating(req, res, {
    moves: [{ attendeeId: req.params.attendeeId, table: req.body?.table }],
    orgId: req.user.orgId, eventId: req.params.id })));

// Several at once: "Seat at…" on a phone, a party on one ticket, or an undo.
app.post("/events/:id/seat", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EV_READY;
  const raw = Array.isArray(req.body?.moves) ? req.body.moves : null;
  if (raw) {
    if (raw.length > 500) return res.status(400).json({ error: "Too many at once." });
    return applySeating(req, res, { moves: raw, orgId: req.user.orgId, eventId: req.params.id });
  }
  // The common shape: these people, that table. A party is expanded here so
  // the caller does not have to know who is on whose ticket.
  const ids = (Array.isArray(req.body?.attendeeIds) ? req.body.attendeeIds : []).map(String);
  if (!ids.length) return res.status(400).json({ error: "Choose at least one guest." });
  const table = req.body?.table;
  const { guests } = await eventGuestsPayload(req.params.id, req.user.orgId);
  const chosen = new Set(ids);
  if (req.body?.withParty !== false) {
    for (const g of guests) {
      if (chosen.has(EV.partyKey(g)) || (g.guest_of && chosen.has(g.guest_of))) chosen.add(g.id);
      if (chosen.has(g.id) && g.guest_of) chosen.add(g.guest_of);
    }
  }
  // PARITY-4: a chair: the first guest named sits on it, the rest of the
  // party take the next free chairs round from there.
  const seat = req.body?.seat;
  const order = [...ids, ...[...chosen].filter(id => !ids.includes(id))];
  return applySeating(req, res, {
    moves: order.map((id, i) => (i === 0 ? { attendeeId: id, table, seat } : { attendeeId: id, table, near: seat })),
    orgId: req.user.orgId, eventId: req.params.id });
}));

// SEAT EVERYONE. A preview by default, because a chart somebody has been
// working on for an hour is not a thing to rearrange without asking. `apply`
// performs the plan it just showed.
app.post("/events/:id/seat-everyone", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EV_READY;
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const { guests, tables } = await eventGuestsPayload(event.id, orgId);
  const plan = EV.seatEveryonePlan(guests, tables);
  if (!req.body?.apply) {
    req.audit && req.audit.skip && req.audit.skip("a preview changes nothing");
    return res.json({ preview: true, ...plan });
  }
  if (!plan.moves.length) return res.json({ ok: true, ...plan, moved: 0, undo: [] });
  return applySeating(req, res, {
    moves: plan.moves.map(m => ({ attendeeId: m.attendeeId, table: m.table })),
    orgId, eventId: event.id });
}));

// After the event: who came and who did not. Each person's timeline gets ONE
// line for this event, however many times the list is saved.
app.post("/events/:id/attendance", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id, name, date FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const came = new Set((Array.isArray(req.body?.attended) ? req.body.attended : []).map(String));
  const missed = new Set((Array.isArray(req.body?.noShow) ? req.body.noShow : []).map(String));
  const ids = [...came, ...missed];
  if (!ids.length) return res.status(400).json({ error: "Mark who came and who did not." });
  const rows = await query("SELECT * FROM event_attendees WHERE event_id=? AND org_id=? AND id = ANY(?)", [event.id, orgId, ids]);
  const who = actor(req);
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  // FEEL-1: events.date is a DATE, which pg hands back as a Date; String() of it
  // sliced was "Fri Nov 06", stored on the timeline and read back as 2001.
  const day = orgTime.civilOf(event.date) || orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  let logged = 0;
  for (const a of rows) {
    const status = came.has(a.id) ? "attended" : "no_show";
    await run("UPDATE event_attendees SET status=? WHERE id=? AND org_id=?", [status, a.id, orgId]);
    if (await logEventAttendance(orgId, a, event, status, { id: who.id, name: u?.name || who.name }, day)) logged++;
    // STALE-2: a guest already marked the other way has their line rewritten.
    else if (a.status !== status) await AL.syncAttendanceLine(orgId, a.id);
  }
  // THREAD-3: the people who did not come are one task for this event.
  // FLOWS-4: its drafts follow the list as saved (server/events/missedYou.js).
  const noShowTaskId = await MY.refresh(orgId, event.id, { id: who.id, name: u?.name || who.name }, { make: missed.size > 0 });
  res.json({ updated: rows.length, timelineLines: logged, noShowTaskId });
}));

// THREAD-3 · AN EVENT'S NO-SHOWS ARE ONE TASK, WITH A DRAFT EACH. FLOWS-4 moved
// it to server/events/missedYou.js, where the audience is read from the guest
// list as it stands (Registered and not Attended) and a person marked as come
// afterwards has their waiting draft retired.
// WIRE-1 · THE ONE ATTENDANCE LINE. Every door that marks a guest as having
// come (the attendance list, the guest PATCH, the door check-in, the QR scan)
// runs this: it claims `attendance_logged_at` first, so whichever door is
// second finds the claim taken and writes nothing, then writes "Came to X."
// and fires the attended_event journey keyed to THIS event (FIX-4 1c, and
// journeyEventKey holds it to one start per event). A no-show writes its own
// line and starts nothing: a no-show is not a moment somebody stepped closer.
async function logEventAttendance(orgId, attendee, event, status, who, day) {
  if (!attendee || !attendee.donor_id || !event) return false;
  const claimed = await query("UPDATE event_attendees SET attendance_logged_at=NOW() WHERE id=? AND org_id=? AND attendance_logged_at IS NULL RETURNING id", [attendee.id, orgId]);
  if (!claimed.length) return false;
  const date = orgTime.civilOf(day) || orgTime.civilOf(event.date) || orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK — FEEL-1: always YYYY-MM-DD
  await TL.writeTimelineLine({ orgId, donorId: attendee.donor_id, type: "event",
    note: status === "attended" ? `Came to ${event.name}.` : `Registered for ${event.name} and did not come.`,
    date, actorId: who.id, actorName: who.name,
    metadata: { via: "event_attendance", event_id: event.id, attendee_id: attendee.id, status } });
  if (status === "attended") {
    // FLOWS-4: whichever door marked them as come, a "Missed you" waiting for them is retired.
    await MY.refresh(orgId, event.id, who, { make: false }).catch(e => console.error("[event] missed-you refresh:", e.message));
    await maybeStartJourney(orgId, attendee.donor_id, "attended_event", { eventId: event.id })
      .catch(e => console.error("[journey] attended_event:", e.message));
    // JOURNEYS-3 — the first event they ever came to starts its own journey.
    const [n] = await query(`SELECT COUNT(DISTINCT event_id)::int n FROM event_attendees
                              WHERE org_id=? AND donor_id=? AND lower(coalesce(status,''))='attended'`, [orgId, attendee.donor_id]);
    if (Number(n && n.n) === 1) {
      await maybeStartJourney(orgId, attendee.donor_id, "first_event", { eventId: event.id })
        .catch(e => console.error("[journey] first_event:", e.message));
    }
  }
  // LIVE-1 — coming (or not) is a change to the person: the after-change step.
  require("../../afterChange").afterChangeSoon(orgId, [attendee.donor_id], { door: "event_checkin", recalc: false });
  return true;
}

// EDITOR-1 · THE EVENT PAGE, IN THE EDITOR. The same page /e/:slug sends, drawn
// for the staff editor with its name and description marked to be typed in
// place and its photo marked to be clicked. Org-scoped, reading only, and
// drawn whether or not the page has an address yet.
app.get("/events/:id/page/preview", requireAuth, wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const [e] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!e) return res.status(404).json({ error: "Event not found" });
  res.json({ html: await eventPageHtml(e, {}, { editable: true }) });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  EVENTS-1 · AFTER THE NIGHT
// ═══════════════════════════════════════════════════════════════════════════
//
// The four questions an ED is asked the morning after, each with the sentence
// that says what it counts and the rows behind it. Nothing here is typed: the
// money is summed from gifts, the attendance from the list somebody marked,
// and the first-time givers from whose FIRST gift this event was.
//
// EVERY NUMBER OPENS. `GET /events/:id/rows?rows=<key>` re-runs the SAME SQL
// the figure was built from, so a count and its list cannot drift.
const EVENT_ROW_SQL = {
  // SWEEP-4: a deleted person is in no figure (the truth check), so none of
  // these three counts them: First-time givers said 63 with a deleted giver in it.
  raised: `SELECT g.id, g.amount::float AS amount, g.date, d.id AS donor_id, d.name
             FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
            WHERE g.org_id=? AND g.event_id=?
            ORDER BY g.amount DESC`,
  // EVENTS-3: First-time givers and Sponsors are figure sources now
  // (event-first-time, event-sponsors); this is their one SQL.
  firstTime: figureSources.EVENT_FIRST_TIME_SQL,
  sponsors: figureSources.EVENT_SPONSORS_SQL,
};

app.get("/events/:id/report", requireAuth, wrap(async (req, res) => {
  await EV_READY;
  const orgId = req.user.orgId;
  const [event] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const counts = {};
  for (const [key, sql] of Object.entries(EVENT_ROW_SQL)) {
    counts[key] = await query(sql, [orgId, event.id]);
  }
  // HOME-3: raised is received + pledged for the event's year, from the one
  // function the card, the first look and Reports read (numbers.eventsRaised).
  const [money] = await require("../../numbers").eventsRaised(orgId, { ids: [event.id] });
  const raisedCents = money ? money.raisedCents : 0;
  // EVENTS-3: every guest count is shared/numbers/events.js, by PARTY (a
  // household once), with its people beside it: "172 came · 252 people". The
  // story, Home's Grow moves, Ask and the Events list read the same answer.
  const EVF = require("../../shared/numbers/events");
  const [guests] = await EVF.eventFigures(query, orgId, { ids: [event.id], asOf: orgToday(await orgTz(orgId)) });   // ORG_TZ_SEAM_OK
  const G = guests || { lists: Object.fromEntries(EVF.LIST_KEYS.map(k => [k, []])), counts: Object.fromEntries(EVF.LIST_KEYS.map(k => [k, { parties: 0, people: 0 }])),
                        cameNoGift: [], cameGave: [], invitedNoShow: [], came: 0, registered: 0, past: true, definitions: EVF.EVENT_GUEST_WORDS };
  const progress = EV.eventProgress({ raisedCents,
    goalCents: event.goal_amount == null ? null : Math.round(Number(event.goal_amount) * 100) });
  const attendance = EV.attendanceRate({ registered: G.registered, attended: G.came });
  const gsrc = list => ({ key: "event-guests", params: { event: event.id, list } });
  const story = await require("../../numbers").eventStory(orgId, event.id);
  const guestFig = (key, label, list, source, sentence) => {
    const c = G.counts[list];
    return { key, label, value: c.parties, count: c.parties, people: c.people, peopleWords: EVF.peopleWords(c),
             sentence: sentence || G.definitions[list], source: source || gsrc(list) };
  };
  const evSrc = key => ({ key, params: { event: event.id } });
  const nNoGift = G.counts.cameNoGift.parties;

  res.json({
    event: { id: event.id, name: event.name, date: String(event.date).slice(0, 10), location: event.location,
             goalAmount: event.goal_amount == null ? null : Number(event.goal_amount) },
    progress, attendance, money,
    guests: { past: G.past, cameNoGift: G.cameNoGift, cameGave: G.cameGave, invitedNoShow: G.invitedNoShow,
              sentence: nNoGift ? `${nNoGift.toLocaleString("en-US")} came and didn't give. Thank them for coming; the ask can wait.` : null },
    // FUNDRAISING-2: the night's story, each count opening its parties.
    story,
    figures: [
      { key: "raised", label: "Raised", value: raisedCents / 100, money: true,
        count: counts.raised.length, sentence: EV.EVENT_FIGURES.raised + " " + progress.sentence, source: evSrc("event-raised") },
      guestFig("invited", "Invited", "invited"),
      guestFig("registered", "Registered", "registered"),
      guestFig("attended", "Came", "came", evSrc("event-attended"), G.definitions.came + " " + attendance.sentence),
      guestFig("declined", "Declined", "declined"),
      guestFig("noReply", "No reply", "noReply"),
      guestFig("cameNoGift", "Came, didn't give", "cameNoGift"),
      guestFig("cameGave", "Came, gave", "cameGave"),
      ...(G.past ? [guestFig("invitedNoShow", "Said yes, didn't come", "invitedNoShow")] : []),
      // FIX-58: Gave = Came, gave + Gave, didn't come
      guestFig("gave", "Gave", "gave", evSrc("event-gave")),
      guestFig("gaveNotCame", "Gave, didn't come", "gaveNotCame", { key: "event-gave", params: { event: event.id, came: "no" } }),
      guestFig("gaveNotInvited", "Gave, not invited", "gaveNotInvited"),
      { key: "firstTime", label: "First-time givers", value: counts.firstTime.length,
        count: counts.firstTime.length, sentence: EV.EVENT_FIGURES.firstTime, source: evSrc("event-first-time") },
      { key: "sponsors", label: "Sponsors", value: counts.sponsors.length,
        count: counts.sponsors.length, sentence: EV.EVENT_FIGURES.sponsors, source: evSrc("event-sponsors") },
    ],
    // WHAT THIS REPORT DOES NOT CLAIM. An event is not the reason somebody
    // gave, and a report that implies it is a report that flatters the event.
    caveat: "These are the gifts attributed to this event and the people marked as having come. "
      + "Nothing here claims the event CAUSED a gift, and nobody is counted as attending until somebody said they did.",
  });
}));

app.get("/events/:id/rows", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const key = String(req.query.rows || "");
  // FIX-59 + EVENTS-3: the guest lists open the same answer their figures
  // count (shared/numbers/events.js), one row per party with its people.
  const EVF = require("../../shared/numbers/events");
  const list = key === "attended" ? "came" : key;
  if (EVF.LIST_KEYS.includes(list)) {
    const [g] = await EVF.eventFigures(query, orgId, { ids: [event.id], asOf: orgToday(await orgTz(orgId)) });   // ORG_TZ_SEAM_OK
    const rows = g ? g.lists[list] : [];
    return res.json({ eventId: event.id, rows: key, count: rows.length,
      donors: rows.map(p => ({ donor_id: p.donorId, name: p.name, people: p.people.map(x => ({ donor_id: x.noRecord ? null : x.id, name: x.name })) })) });
  }
  const sql = EVENT_ROW_SQL[key];
  if (!sql) return res.status(400).json({ error: "unknown_rows",
    message: `There is no set of rows called "${key}". Ask for one of: ${["attended", ...EVF.LIST_KEYS, ...Object.keys(EVENT_ROW_SQL)].join(", ")}.` });
  const rows = await query(sql, [orgId, event.id]);
  res.json({ eventId: event.id, rows: key, count: rows.length, donors: rows.slice(0, 1000) });
}));

// ── EVENTS-1 item 6 · A THANK-YOU PER SPONSOR, FOR A PERSON TO SEND ──────
// A DRAFT, never a send: it writes into `thank_you_drafts`, which is the queue
// FIX-6 gave an Approve button, so a sponsor thank-you goes out the same way
// every other one does and through the same human press.
app.post("/events/:id/sponsor-thanks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const [event] = await query("SELECT * FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const [org] = await query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  const sponsors = await query(EVENT_ROW_SQL.sponsors, [orgId, event.id]);
  const out = { drafted: 0, alreadyThere: 0, noGift: 0, sponsors: sponsors.length };
  for (const sp of sponsors) {
    if (!sp.donor_id) continue;
    const [g] = await query(
      `SELECT id, amount, date FROM gifts WHERE org_id=? AND event_id=? AND donor_id=?
        ORDER BY amount DESC LIMIT 1`, [orgId, event.id, sp.donor_id]);
    // A sponsor who has only PLEDGED has no gift to thank them for yet, and
    // thanking somebody for money that has not arrived is the one mistake a
    // sponsor notices.
    if (!g) { out.noGift++; continue; }
    const [dupe] = await query("SELECT id FROM thank_you_drafts WHERE org_id=? AND gift_id=?", [orgId, g.id]);
    if (dupe) { out.alreadyThere++; continue; }
    const t = draftMod.thankYouDraft({
      donorName: sp.name, giftCents: Math.round(Number(g.amount) * 100),
      fundName: null, campaignName: event.name, orgName: org?.name, voice, date: g.date || null,
    });
    await run(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice) VALUES (?,?,?,?,?,?)`,
      [newId("ty"), orgId, sp.donor_id, g.id, t.body, t.voice]);
    out.drafted++;
  }
  res.json({ ...out,
    sentence: out.drafted
      ? `${out.drafted} thank-you${out.drafted === 1 ? "" : "s"} drafted and waiting for you on the Agent's queue. Steward sends none of them.`
      : out.alreadyThere
        ? `Every sponsor already has a draft waiting. Nothing was written twice.`
        : `No sponsor has paid yet, so there is nothing to thank anybody for.` });
}));

// ── EVENTS-1 item 5 · CHECK-IN, ON A TABLET AT THE DOOR ──────────────────
// The kiosk shape VOL-1 built for volunteers, for a guest list: search a name,
// tap to check in, and a walk-in who pays at the door becomes a registration
// through the SAME writer as every other one, so their money is a gift with
// the same deductible split and their name is on the same list.
// The time somebody came through the door, in the org's own zone, said the
// way a person at the door would say it ("7:02 PM").
async function doorTime(orgId, at) {
  try {
    const tz = await orgTzName(orgId);
    return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  } catch { return "earlier"; }
}

app.get("/events/:id/kiosk", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id, name, date, location FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const guests = await query(
    `SELECT a.id, a.name, a.email, a.status, a.quantity, a.table_label, a.checked_in_at, a.dietary, a.vip, a.donor_id,
            l.name AS level_name, l.kind AS level_kind
       FROM event_attendees a LEFT JOIN event_levels l ON l.id=a.level_id
      WHERE a.org_id=? AND a.event_id=? AND ${figureSources.EVENT_REGISTERED("a")} AND ${figureSources.EVENT_GUEST_LIVE("a")}
      ORDER BY a.name`, [orgId, event.id]);
  const levels = await query(
    "SELECT id, name, kind, price::float AS price, fmv::float AS fmv FROM event_levels WHERE org_id=? AND event_id=? ORDER BY position, price", [orgId, event.id]);
  // FIX-59: IN IS CAME. Somebody marked as attending (by an import, by hand)
  // is in, the same people the event's Came counts; expected is Registered
  // (the list, declined apart). "0 of 552 checked in" beside "Came 249" was
  // two answers to one question.
  // EVENTS-3: the count is the event page's own, by party (a household once),
  // from shared/numbers/events.js; the people are said beside it.
  for (const g of guests) g.in = g.status === "attended" || !!g.checked_in_at;
  const [F] = await require("../../shared/numbers/events").eventFigures(query, orgId, { ids: [event.id] });
  const inCount = F ? F.counts.came.parties : 0, expected = F ? F.counts.registered.parties : 0;
  const inPeople = F ? F.counts.came.people : 0, expectedPeople = F ? F.counts.registered.people : 0;
  const noDoor = guests.filter(g => g.in && !g.checked_in_at).length;
  res.json({ event, guests, levels, checkedIn: inCount, expected, people: { checkedIn: inPeople, expected: expectedPeople },
    sentence: `${inCount} of ${expected} checked in${expectedPeople !== expected ? ` (${inPeople} of ${expectedPeople} people)` : ""}.`
      + (noDoor ? ` ${noDoor === inCount ? (noDoor === 1 ? "They were" : "All of them were") : `${noDoor} of them ${noDoor === 1 ? "was" : "were"}`} marked as attending without a time at the door, from an import or by hand.` : "") });
}));

app.post("/events/:id/check-in", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id, name, date FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const undo = req.body?.undo === true;
  // PARITY-4: A SECOND CHECK-IN IS A WARNING, not a quiet success: two
  // people through the door on one name is the thing the door is there for.
  if (!undo) {
    const [was] = await query(
      `SELECT id, name, table_label, checked_in_at FROM event_attendees WHERE id=? AND event_id=? AND org_id=?`,
      [String(req.body?.attendeeId || ""), event.id, orgId]);
    if (was && was.checked_in_at) {
      req.audit && req.audit.skip && req.audit.skip("already checked in; nothing changed");
      return res.json({ ok: false, already: true, reason: "already_in", attendee: was,
        sentence: `${was.name} is already checked in, since ${await doorTime(orgId, was.checked_in_at)}.` });
    }
  }
  const rows = await query(
    undo
      // FIX-59: out again is not attending either, or Came would still count them
      ? `UPDATE event_attendees SET checked_in_at=NULL, status=CASE WHEN status='attended' THEN 'registered' ELSE status END
          WHERE id=? AND event_id=? AND org_id=? RETURNING id, name, checked_in_at`
      : `UPDATE event_attendees SET checked_in_at=COALESCE(checked_in_at, NOW()), status='attended'
          WHERE id=? AND event_id=? AND org_id=? RETURNING id, name, checked_in_at, donor_id`,
    [String(req.body?.attendeeId || ""), event.id, orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  // WIRE-1: through the door is "Came to X." on the person, once.
  if (!undo) await logEventAttendance(orgId, rows[0], event, "attended", await staffWho(req));
  // STALE-2: out again takes the "Came to" line back off (FIX-59 made them Registered).
  else await AL.syncAttendanceLine(orgId, rows[0].id);
  delete rows[0].donor_id;
  res.json({ ok: true, attendee: rows[0],
    sentence: undo ? `${rows[0].name} is not checked in.` : `${rows[0].name} is in.` });
}));

// ── EVENTS-2 · THE DOOR READS A CODE ─────────────────────────────────────
// One scanner, two kinds of code: a ticket for this event, or a member card.
// A member card is not a ticket, so scanning one does NOT invent a
// registration — it says who this is and whether they are on the list, and
// the person at the door decides. Anything it cannot read, it says so in
// words somebody standing up holding a phone can act on.
//
// Every answer names a PERSON, because the thing the door actually needs is a
// name to say out loud.
app.post("/events/:id/scan", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id, name, date FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const PASS = await import("../../shared/passCode.js");
  const read = PASS.readPassCode(String(req.body?.code || ""), { secret: process.env.JWT_SECRET || "", orgId });
  if (!read.ok) {
    return res.json({ ok: false, reason: read.reason, sentence: PASS.PASS_REASON_WORDS[read.reason] || "That code did not read." });
  }
  if (read.kind === "ticket") {
    // PARITY-4: THE SECOND SCAN. The same ticket shown twice is warned on by
    // name and time, and nothing is written: the first scan stands.
    const [was] = await query(
      `SELECT id, name, table_label, quantity, checked_in_at FROM event_attendees
        WHERE id=? AND event_id=? AND org_id=? AND status <> 'cancelled'`, [read.id, event.id, orgId]);
    if (was && was.checked_in_at) {
      req.audit && req.audit.skip && req.audit.skip("already checked in; nothing changed");
      return res.json({ ok: false, kind: "ticket", reason: "already_in", already: true, attendee: was,
        sentence: `Already scanned. ${was.name} came in at ${await doorTime(orgId, was.checked_in_at)}${was.table_label ? `, ${was.table_label}` : ""}.` });
    }
    const rows = await query(
      `UPDATE event_attendees SET checked_in_at=COALESCE(checked_in_at, NOW()), status='attended'
        WHERE id=? AND event_id=? AND org_id=? AND status <> 'cancelled'
        RETURNING id, name, table_label, quantity, checked_in_at, donor_id`,
      [read.id, event.id, orgId]);
    if (!rows.length) {
      // A real, signed ticket for a DIFFERENT event: say which, rather than
      // "invalid", because the person is standing there holding it.
      const [other] = await query(
        `SELECT a.name, e.name AS event_name FROM event_attendees a JOIN events e ON e.id=a.event_id
          WHERE a.id=? AND a.org_id=?`, [read.id, orgId]);
      return res.json({ ok: false, reason: "wrong_event",
        sentence: other ? `That ticket is ${other.name}'s, for ${other.event_name}. Not this one.`
                        : "That ticket is not on this event's list." });
    }
    const a = rows[0];
    await logEventAttendance(orgId, a, event, "attended", await staffWho(req));   // WIRE-1
    delete a.donor_id;
    return res.json({ ok: true, kind: "ticket", attendee: a,
      sentence: `${a.name} is in${a.table_label ? `, ${a.table_label}` : ""}${Number(a.quantity) > 1 ? ` · ${a.quantity} places` : ""}.` });
  }
  if (read.kind === "membership") {
    const [m] = await query(
      `SELECT m.id, m.status, m.expires_on, d.id AS donor_id, d.name, l.name AS level_name
         FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
         JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
        WHERE m.id=? AND m.org_id=?`, [read.id, orgId]);
    if (!m) return res.json({ ok: false, reason: "unknown", sentence: "That card is not one of ours." });
    const [att] = await query(
      `SELECT id, name, table_label, checked_in_at FROM event_attendees
        WHERE org_id=? AND event_id=? AND donor_id=? AND status <> 'cancelled' LIMIT 1`, [orgId, event.id, m.donor_id]);
    if (!att) {
      // A member with no ticket is not turned away and is not checked in
      // either. The door says who they are and the person decides.
      return res.json({ ok: false, kind: "membership", reason: "not_registered", member: m,
        sentence: `${m.name} is a ${m.level_name} member${m.status === "active" ? "" : ", " + m.status} but is not on the list for ${event.name}. Add them or take a payment.` });
    }
    const rows = await query(
      `UPDATE event_attendees SET checked_in_at=COALESCE(checked_in_at, NOW()), status='attended'
        WHERE id=? AND org_id=? RETURNING id, name, table_label`, [att.id, orgId]);
    return res.json({ ok: true, kind: "membership", attendee: rows[0], member: m,
      sentence: `${rows[0].name} is in${rows[0].table_label ? `, table ${rows[0].table_label}` : ""} · ${m.level_name} member.` });
  }
  res.json({ ok: false, reason: "unreadable", sentence: PASS.PASS_REASON_WORDS.unreadable });
}));

// ── EVENTS-2 · THE WAITING LIST, ON THE STAFF SIDE ───────────────────────
// A place is offered by a PERSON pressing a button, never by a sweep. The
// offer is an email with the event's own link on it; nothing is reserved and
// nothing is charged, because the person still has to buy the ticket.
app.get("/events/:id/waitlist", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  // Another org's event id gets the same answer a made-up one gets. An empty
  // list is still an answer, and "this id exists" is a thing worth not saying.
  const [ev] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const rows = await query(
    `SELECT w.id, w.name, w.email, w.qty, w.position, w.offered_at, w.taken_at, l.name AS level_name, l.id AS level_id
       FROM event_waitlist w JOIN event_levels l ON l.id=w.level_id AND l.org_id=w.org_id
      WHERE w.org_id=? AND w.event_id=? AND w.removed_at IS NULL
      ORDER BY l.position, w.position`, [orgId, req.params.id]);
  res.json({ waitlist: rows,
    sentence: "People who asked to be told if a place comes free, in the order they asked. Offering one sends them the event's link; it holds nothing and charges nothing." });
}));

app.post("/events/:id/waitlist/:wid/offer", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [event] = await query("SELECT id, name, public_slug FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const [w] = await query(`SELECT * FROM event_waitlist WHERE id=? AND org_id=? AND event_id=? AND removed_at IS NULL AND taken_at IS NULL`,
    [req.params.wid, orgId, event.id]);
  if (!w) return res.status(404).json({ error: "Not found" });
  const who = actor(req);
  await run(`UPDATE event_waitlist SET offered_at=NOW(), offered_by=? WHERE id=?`, [who.id, w.id]);
  const display = await donorFacingOrgName(orgId, null).catch(() => "");
  const link = `${publicAppUrl()}/e/${encodeURIComponent(event.public_slug || "")}`;
  const html = await brandEmailHeaderHtml(orgId) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>A place has come free for <strong>${escapeHtml(event.name)}</strong>, and you were next on the list.</p>
      <p style="text-align:center;margin:26px 0;"><a href="${link}" style="background:#0d5c3a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Take the place</a></p>
      <p style="font-size:13px;color:#555;">Nothing is held for you, so it is first come. If somebody else gets there first, you stay on the list.</p>
    </div>`;
  // FIX-15 Part 3: the provider's answer decides the sentence (a refused
  // offer is queued for retry by the lifecycle helper).
  const offerSent = await sendDonorLifecycleEmail("event_waitlist_offer", w.email, `A place has come free at ${event.name}`,
    html, fromWithDisplayName(display || event.name, DONOR_MAIL_ADDR()), orgId).catch(e => { console.error("[event] waitlist offer:", e.message); return false; });
  // FIX-7 Part 6.2 — the demonstration org sends no ticket email; the screen
  // says what would have gone out and to whom rather than implying it did.
  const demoNote = await demoMailNote(orgId, { what: "the offer of a place, with the event's link", to: w.email });
  res.json({ ok: true, demo: !!demoNote,
    sent: !demoNote && !!offerSent,
    sentence: demoNote || (offerSent
      ? `Offered to ${w.name}. Nothing is held and nothing is charged: they still have to buy the ticket.`
      : `Marked as offered to ${w.name}, but the email provider did not take the message just now. Steward will try again in a few minutes.`) });
}));

app.get("/events", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    // EVENTS-1 — RAISED IS SUMMED FROM THE GIFTS, never from a typed figure
    // and never from `gift_amount` on the attendee row, which is a copy. The
    // card's number and the rows behind it are one query.
    // EVENTS-3: no count of guests here. The list's numbers are the event
    // page's own (shared/numbers/events.js): parties, with their people.
    const rows = await query(`SELECT e.* FROM events e WHERE e.org_id = $1 ORDER BY e.date DESC NULLS LAST`, [orgId]);
    // HOME-3: raised the way she says it (received + pledged for the event's
    // year), one function for the card, the event page, the first look and Reports.
    const money = new Map((await require("../../numbers").eventsRaised(orgId, { ids: rows.map(r => r.id) })).map(m => [m.id, m]));
    const counts = await eventCounts(orgId, rows.map(r => r.id));
    res.json(rows.map(r => ({ ...r, ...counts.get(r.id), money: money.get(r.id) || null })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// EVENTS-3 · an event's guest counts on its row, by party, with the people
// beside them (shared/numbers/events.js). One id gives that event's counts;
// a list of ids gives a Map.
async function eventCounts(orgId, ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const evs = await require("../../shared/numbers/events").eventFigures(query, orgId, { ids: list });
  const out = new Map(evs.map(g => {
    const c = k => g.counts[k];
    return [g.id, { attendee_count: c("came").parties, registered_count: c("registered").parties, checked_in_count: c("came").parties,
      invited_count: c("invited").parties, declined_count: c("declined").parties,
      people: { came: c("came").people, registered: c("registered").people, invited: c("invited").people } }];
  }));
  return Array.isArray(ids) ? out : (out.get(ids) || {});
}

app.post("/events", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { name, eventType, date, endDate, location, description, capacity, cost, goalAmount } = req.body;
    if (!name || !eventType || !date) return res.status(400).json({ error: "name, eventType, date required" });
    const id = newId("evt");
    await run(
      `INSERT INTO events (id, org_id, name, event_type, date, end_date, location, description, capacity, cost, goal_amount, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, orgId, name, eventType, date, endDate || null, location || null, description || null, capacity || null, parseFloat(cost) || 0,
       goalAmount === undefined || goalAmount === null || goalAmount === "" ? null : parseFloat(goalAmount) || null,
       actor(req).id, actor(req).name]
    );
    // PARITY-2 Part 3: a start and an end time may come with the new event.
    const { goalAmount: _g, publicSlug: _s, ...pageBody } = req.body || {};
    const pageErr = await saveEventPageFields(orgId, id, pageBody);
    if (pageErr) console.error("[events] new event's page fields:", pageErr.error);
    // EDITOR-1 · THERE IS ALWAYS A PHOTO: a new event's page starts with one
    // of Steward's, matched to the org's mission and marked stock until it is
    // replaced. Only at creation, and only when the event has no picture.
    const pic = await require("../../routes/stockPhotos").stockPictureForOrg(orgId, id);
    if (pic) await run(`UPDATE events SET hero_image_url=$1, hero_meta=$2::jsonb WHERE id=$3 AND org_id=$4 AND hero_image_url IS NULL`,
      [pic.url, JSON.stringify({ alt: pic.alt, fx: pic.fx, fy: pic.fy, stock: true }), id, orgId]);
    const [row] = await query("SELECT * FROM events WHERE id=$1", [id]);
    res.json({ ...row, attendee_count: 0, confirmed_count: 0, no_show_count: 0, invited_count: 0, total_revenue: 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/events/:id", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { name, eventType, date, endDate, location, description, capacity, status, revenue, cost, notes } = req.body;
    const [exists] = await query("SELECT id FROM events WHERE id=$1 AND org_id=$2", [req.params.id, orgId]);
    if (!exists) return res.status(404).json({ error: "Event not found" });
    // PARITY-2 Part 3: the public page's fields, each written only when the
    // request names it, so a screen that saves the notes does not clear the
    // page somebody published from another. Checked and written FIRST: a
    // refused time or address leaves the whole event as it was.
    const pageErr = await saveEventPageFields(orgId, req.params.id, req.body || {});
    if (pageErr) return res.status(pageErr.status || 400).json({ error: pageErr.error, code: pageErr.code });
    // The event's own fields are a whole-form save, as they always were. A
    // request that carries no name is a page-only save and leaves them alone.
    if (name !== undefined) {
      await run(
        `UPDATE events SET name=$1, event_type=$2, date=$3, end_date=$4, location=$5,
         description=$6, capacity=$7, status=$8, revenue=$9, cost=$10, notes=$11
         WHERE id=$12 AND org_id=$13`,
        [name, eventType, date, endDate || null, location || null, description || null,
         capacity || null, status || 'upcoming', parseFloat(revenue) || 0, parseFloat(cost) || 0,
         notes || null, req.params.id, orgId]
      );
    }
    const rows = await query(`SELECT e.* FROM events e WHERE e.id=$1 AND e.org_id=$2`, [req.params.id, orgId]);
    res.json(rows[0] ? { ...rows[0], ...(await eventCounts(orgId, rows[0].id)) } : {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PARITY-2 Part 3 · THE PUBLIC PAGE, FROM THE STAFF SIDE ─────────────────
// Times, the film, the goal and the page address ride PUT /events/:id; the
// pictures have their own routes because a camera photo is bigger than the
// 5mb every other JSON body is held to (server.js gives these 22mb, the same
// cap the campaign hero has).
async function saveEventPageFields(orgId, eventId, b) {
  await EPG_READY;
  const sets = [], params = [];
  for (const [key, col] of [["startTime", "start_time"], ["endTime", "end_time"]]) {
    const t = EPG.parseEventTime(b[key]);
    if (t === undefined) continue;
    if (t && t.error) return { error: t.error, code: "bad_time" };
    sets.push(`${col}=?`); params.push(t);
  }
  if (b.heroVideoUrl !== undefined) {
    const raw = String(b.heroVideoUrl || "").trim();
    const v = raw ? EPG.parseEventVideo(raw) : null;
    if (raw && !v) return { error: `That video link is not one Steward can show. ${EPG.VIDEO_HOSTS_SENTENCE}`, code: "bad_video" };
    sets.push("hero_video_url=?"); params.push(v ? v.watchUrl : null);
  }
  if (b.goalAmount !== undefined) {
    const g = b.goalAmount === null || b.goalAmount === "" ? null : Number(b.goalAmount);
    if (g !== null && !(Number.isFinite(g) && g >= 0)) return { error: "A goal is an amount of zero or more.", code: "bad_goal" };
    sets.push("goal_amount=?"); params.push(g);
  }
  if (b.publicSlug !== undefined) {
    const n = EPG.normalizeEventSlug(b.publicSlug);
    if (n.error) return { error: n.error, code: "bad_slug" };
    const [cur] = await query("SELECT public_slug, previous_slug FROM events WHERE id=? AND org_id=?", [eventId, orgId]);
    if (n.slug && n.slug !== (cur && cur.public_slug)) {
      // /e/:slug carries no organisation, so an address held by ANY org, now
      // or as the old name a poster still prints, is taken (FIX-7 Part 2).
      const [clash] = await query(
        `SELECT id FROM events WHERE id <> ? AND (public_slug=? OR previous_slug=?) LIMIT 1`, [eventId, n.slug, n.slug]);
      if (clash) return { status: 409, error: `/e/${n.slug} is already taken. Try adding the year or the town.`, code: "slug_taken" };
    }
    if (n.slug !== (cur && cur.public_slug)) {
      // A RENAMED ADDRESS KEEPS THE OLD ONE (EVENTS-2): /e/<old> 301s here.
      // Taking the page down keeps nothing, so the old address stops too.
      let previous = null;
      if (n.slug && cur && cur.public_slug) previous = cur.public_slug;
      else if (n.slug && cur && cur.previous_slug !== n.slug) previous = cur.previous_slug || null;
      sets.push("public_slug=?", "previous_slug=?");
      params.push(n.slug, previous);
    }
  }
  if (!sets.length) return null;
  await run(`UPDATE events SET ${sets.join(", ")} WHERE id=? AND org_id=?`, [...params, eventId, orgId]);
  return null;
}

// One photograph onto the asset seam, kind 'event'. A stored /portal-assets/
// path echoes back unchanged.
async function storeEventImage(orgId, dataUri) {
  if (typeof dataUri === "string" && /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(dataUri)) return { url: dataUri };
  const uerr = uploadImageError(dataUri);
  if (uerr) return { error: "bad_image", message: uerr };
  const m = String(dataUri).match(/^data:([^;]+);base64,(.*)$/s);
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "bad_image", message: "That image did not decode." }; }
  const dims = checkThemeImageDimensions("event", m[1], buffer);
  if (!dims.ok) return { error: "bad_image_dimensions", message: dims.message };
  const norm = await normalizeUploadImage("event", m[1], buffer);
  if (norm.error) return { error: norm.error, message: norm.message };
  const asset = await putThemeAsset({ orgId, kind: "event", isPublic: true, buffer: norm.buffer, contentType: norm.contentType,
    width: norm.width ?? dims.width, height: norm.height ?? dims.height });
  return { url: asset.path };
}
// Every event photo still pointed at stays; the rest go into the 90-day
// retention window, never straight to deletion (assetStore.js).
async function pruneEventAssets(orgId) {
  const keep = [];
  const id = v => { const m = /^\/portal-assets\/(pa_[a-f0-9]{24})$/.exec(String(v || "")); if (m) keep.push(m[1]); };
  for (const r of await query("SELECT hero_image_url, gallery FROM events WHERE org_id=?", [orgId])) {
    id(r.hero_image_url);
    for (const ph of (Array.isArray(r.gallery) ? r.gallery : [])) id(ph && ph.path);
  }
  await pruneUnreferencedAssets(orgId, "event", keep);
}

app.post("/events/:id/hero", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [ev] = await query("SELECT id, hero_image_url FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const v = req.body?.image;
  let url = null;
  if (v) {
    const stored = await storeEventImage(req.user.orgId, v);
    if (stored.error) return res.status(400).json({ error: stored.error, message: stored.message });
    url = stored.url;
  }
  await run("UPDATE events SET hero_image_url=? WHERE id=? AND org_id=?", [url, ev.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "event.hero", ev.id, ev.hero_image_url || null, url, req.user);
  await pruneEventAssets(req.user.orgId);
  res.json({ heroImageUrl: url });
}));

app.post("/events/:id/photos", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await EPG_READY;
  const [ev] = await query("SELECT id, gallery FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const gallery = Array.isArray(ev.gallery) ? ev.gallery : [];
  if (gallery.length >= EPG.MAX_GALLERY) return res.status(400).json({ error: "too_many", message: `A gallery holds ${EPG.MAX_GALLERY} photographs. Remove one to add another.` });
  const stored = await storeEventImage(req.user.orgId, req.body?.image);
  if (stored.error) return res.status(400).json({ error: stored.error, message: stored.message });
  if (gallery.some(p => p && p.path === stored.url)) return res.json({ gallery });
  const next = [...gallery, { path: stored.url, caption: String(req.body?.caption || "").trim().slice(0, 200) }];
  await run("UPDATE events SET gallery=?::jsonb WHERE id=? AND org_id=?", [JSON.stringify(next), ev.id, req.user.orgId]);
  res.status(201).json({ gallery: next });
}));

app.post("/events/:id/photos/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [ev] = await query("SELECT id, gallery FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ev) return res.status(404).json({ error: "Event not found" });
  const gallery = Array.isArray(ev.gallery) ? ev.gallery : [];
  const path = String(req.body?.path || "");
  const next = gallery.filter(p => !(p && p.path === path));
  if (next.length === gallery.length) return res.status(404).json({ error: "That photograph is not in this gallery." });
  await run("UPDATE events SET gallery=?::jsonb WHERE id=? AND org_id=?", [JSON.stringify(next), ev.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "event.gallery", ev.id, path, null, req.user);
  await pruneEventAssets(req.user.orgId);
  res.json({ gallery: next });
}));

// DELETE /events/:id is server/events/eventRemoval.js (WALKB-2): an event with gifts or guests is archived, never deleted.

app.get("/events/:id", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const evts = await query(`SELECT e.* FROM events e WHERE e.id=$1 AND e.org_id=$2`, [req.params.id, orgId]);
    if (!evts.length) return res.status(404).json({ error: "Not found" });
    Object.assign(evts[0], await eventCounts(orgId, evts[0].id));
    const attendees = await query(`
      SELECT ea.*, d.stage, d.total_giving, d.assigned_to_name, ${DL.HAS_GIVEN("d")} AS has_given
      FROM event_attendees ea
      LEFT JOIN donors d ON d.id = ea.donor_id
      WHERE ea.event_id=$1 AND (d.id IS NULL OR d.deleted_at IS NULL)
      ORDER BY ea.created_at ASC
    `, [req.params.id]);
    // WALKB-2: the guest's label is the profile's rule (shared/numbers/donorLabel.js), never the stage alone.
    for (const a of attendees) { a.has_given = !!a.has_given; a.donor_label = DL.donorLabel({ hasGiven: a.has_given, stage: a.stage }); }
    // FIX-59: each guest's Gift is what they gave for this event or pledged
    // at it, the rows "Gave or pledged at the event" (event-gave) sums, never
    // the amount typed onto the guest row.
    const given = new Map((await query(
      `SELECT x.donor_id, ROUND(SUM(x.amount)::numeric, 2)::float AS amount FROM (${figureSources.EVENT_GIVERS_SQL}) x GROUP BY x.donor_id`,
      [orgId, req.params.id, orgId, req.params.id])).map(r => [r.donor_id, r.amount]));
    for (const a of attendees) a.event_given = a.donor_id && given.has(a.donor_id) ? given.get(a.donor_id) : 0;
    // PARITY-2 Part 3: the page's address, built on the one public origin.
    const public_page_url = evts[0].public_slug ? `${publicAppUrl()}/e/${encodeURIComponent(evts[0].public_slug)}` : null;
    const [money] = await require("../../numbers").eventsRaised(orgId, { ids: [req.params.id] });
    // SWEEP-4: the public page is "Not open yet" until payments are connected
    const [pay] = await query("SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=$1", [orgId]);
    // STALE-2: seats left, from the count the add-guest door checks (server/events/capacity.js).
    const CAP = require("./capacity"), seats = CAP.seats(evts[0].capacity, await CAP.placesTaken(query, orgId, req.params.id));
    res.json({ ...evts[0], attendees, public_page_url, money: money || null, seats,
      payments_connected: !!(pay && pay.stripe_connected && pay.stripe_account_id),
      givenSource: { key: "event-gave", params: { event: req.params.id } },
      givenSentence: "What each person gave for this event or pledged at it, from the gifts and pledges themselves." });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/events/:id/attendees", requireAuth, checkWriteAccess, require("./capacity").gate(query), async (req, res) => {   // STALE-2: past capacity asks first
  try {
    const orgId = req.user.orgId;
    const eventId = req.params.id;
    const evts = await query("SELECT id, name FROM events WHERE id=$1 AND org_id=$2", [eventId, orgId]);
    if (!evts.length) return res.status(404).json({ error: "Event not found" });
    const { name, email, notes } = req.body;
    let { donorIds } = req.body;
    const added = [];
    const ids = [];   // PARITY-4: the door checks a walk-in in by id the moment they are added
    const who = await staffWho(req);
    // WIRE-1 rule 1: a name typed with an email that is already on file is
    // that person, not a stranger with no record.
    if (!(donorIds && Array.isArray(donorIds)) && name && String(email || "").trim()) {
      const known = await PM.findPersonId(orgId, { email });
      if (known) donorIds = [known];
    }
    // FLOWS-3 (W-1108-Volunteers-20): a typed guest with nobody on file is added
    // as a person (type guest), by + Add's own path, then added like anyone else.
    if (!(donorIds && Array.isArray(donorIds)) && name) {
      const g = await require("./typedGuest").typedGuestPerson(ctx, req, { name, email, notes });
      if (g.refused) return res.status(g.refused.status).json(g.refused.body);
      donorIds = [g.id];
    }
    if (donorIds && Array.isArray(donorIds)) {
      for (const donorId of donorIds) {
        const dr = await query("SELECT id, name, email FROM donors WHERE id=$1 AND org_id=$2", [donorId, orgId]);
        if (!dr.length) continue;
        const d = dr[0];
        const attId = newId("att");
        try {
          const ins = await query(
            `INSERT INTO event_attendees (id, event_id, org_id, donor_id, name, email, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id, donor_id) DO NOTHING RETURNING id`,
            [attId, eventId, orgId, donorId, d.name, d.email || "", notes || null]
          );
          if (ins.length) {
            ids.push(ins[0].id);
            await logEventRegistered(orgId, { id: ins[0].id, donor_id: donorId }, evts[0], who);   // WIRE-1
          } else {
            const [had] = await query("SELECT id FROM event_attendees WHERE event_id=$1 AND donor_id=$2 AND org_id=$3", [eventId, donorId, orgId]);
            if (had && !(req.body.donorIds && Array.isArray(req.body.donorIds))) ids.push(had.id);
          }
          added.push(d.name);
        } catch { /* skip */ }
      }
    } else {
      return res.status(400).json({ error: "name required" });
    }
    res.json({ added: added.length, names: added, ids });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/events/:id/attendees/:attendeeId", requireAuth, checkWriteAccess, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { status, giftAmount, notes } = req.body;
    const rows = await query("SELECT * FROM event_attendees WHERE id=$1 AND org_id=$2", [req.params.attendeeId, orgId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const att = rows[0];
    // PARITY-4: A VIP MARK ALONE touches nothing else. Running the rest of
    // this handler on an attended row would re-run its attendance side effects
    // (wealth score, stage) for a change that is only a mark for the room.
    const onlyVip = req.body.vip !== undefined && status === undefined && giftAmount === undefined
      && notes === undefined && req.body.guestOf === undefined;
    if (onlyVip) {
      await run("UPDATE event_attendees SET vip=$1 WHERE id=$2 AND org_id=$3", [req.body.vip === true, att.id, orgId]);
      const [row] = await query("SELECT * FROM event_attendees WHERE id=$1 AND org_id=$2", [att.id, orgId]);
      return res.json(row);
    }
    const newStatus = status !== undefined ? status : att.status;
    const newGift = giftAmount !== undefined ? (parseFloat(giftAmount) || 0) : (parseFloat(att.gift_amount) || 0);
    const newNotes = notes !== undefined ? notes : att.notes;
    // FIX-11 Part 2 — WHO BROUGHT THEM. `guest_of` existed but only a public
    // registration could set it, so a party the office typed in by hand was
    // four unrelated people and the seating screen would happily split them
    // across the room. Validated against this event, and never itself: a guest
    // who is their own host is a party with no end.
    let newGuestOf = att.guest_of;
    if (req.body.guestOf !== undefined) {
      const want = req.body.guestOf ? String(req.body.guestOf) : null;
      if (want === req.params.attendeeId) return res.status(400).json({ error: "Somebody cannot be their own host." });
      if (want) {
        const [host] = await query("SELECT id, guest_of FROM event_attendees WHERE id=$1 AND event_id=$2 AND org_id=$3",
          [want, att.event_id, orgId]);
        if (!host) return res.status(404).json({ error: "That host is not on this guest list." });
        if (host.guest_of) return res.status(400).json({ error: "That person is themselves somebody's guest. Name the person who registered." });
      }
      newGuestOf = want;
    }
    await run(
      "UPDATE event_attendees SET status=$1, gift_amount=$2, notes=$3, guest_of=$4 WHERE id=$5 AND org_id=$6",
      [newStatus, newGift, newNotes, newGuestOf, req.params.attendeeId, orgId]
    );
    // PARITY-4: a VIP mark is a mark for the room (who to greet, who sits
    // near the stage), never a giving level printed on a badge.
    if (req.body.vip !== undefined) {
      await run("UPDATE event_attendees SET vip=$1 WHERE id=$2 AND org_id=$3", [req.body.vip === true, req.params.attendeeId, orgId]);
    }
    // If attended + gift > 0 + has a donor, log the gift
    if (newStatus === 'attended' && newGift > 0 && att.donor_id) {
      const evtRows = await query("SELECT * FROM events WHERE id=$1", [att.event_id]);
      const evt = evtRows[0];
      const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75) — the gift date is the org's civil date
      // BUILD-88a A.1 — THROUGH THE ONE FUNCTION, and idempotent at last. This
      // wrote a gift with `ON CONFLICT DO NOTHING` and no conflict TARGET, so
      // every subsequent PATCH of an attended row minted another gift and
      // bumped the donor's lifetime total again. The attendee row is the key:
      // one attendee, one gift.
      const written = await recordGift({
        orgId, donorId: att.donor_id, amount: newGift, date: today, type: "cash",
        campaign: evt?.name || "Event", notes: `Gift at ${evt?.name || "event"}`,
        paymentMethod: req.body.paymentMethod, idempotencyKey: `event_attendee:${att.id}`,
        conflict: "idempotency",
        actorId: actor(req).id, actorName: actor(req).name,
        ledgerDescription: `Event Gift · ${evt?.name || "event"}`,
        timelineNote: `Gift at ${evt?.name || "event"}`, source: "event",
      });
      const giftId = written.gift ? written.gift.id : null;
      void giftId;
    }
    // On attendance: +5 wealth score, log interaction, advance prospect/qualify stage
    if (newStatus === 'attended' && att.donor_id) {
      const evtInfoRows = await query("SELECT name FROM events WHERE id=$1", [att.event_id]);
      const evtName = evtInfoRows[0]?.name || "event";
      const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
      await run(`UPDATE donors SET wealth_score = LEAST(COALESCE(wealth_score,0)+5, 99) WHERE id=$1 AND org_id=$2`, [att.donor_id, orgId]).catch(() => {});
      // BUILD-98 (switch) Part 4 — ONE attendance line per guest per event,
      // whichever door marked them: this PATCH and POST /events/:id/attendance
      // claim the same stamp, so saving the list twice writes one line.
      // WIRE-1: the same one writer every door uses (stamped, journey fired).
      await logEventAttendance(orgId, att, { id: att.event_id, name: evtName }, "attended", await staffWho(req), today)
        .catch(e => console.error("[event] attendance line:", e.message));
      await run(`UPDATE donors SET stage = CASE WHEN stage='prospect' THEN 'qualify' WHEN stage='qualify' THEN 'cultivate' ELSE stage END WHERE id=$1 AND org_id=$2 AND stage IN ('prospect','qualify')`,
        [att.donor_id, orgId]).catch(() => {});
    }
    // THREAD-3: a guest marked as not having come joins the event's one task.
    // FLOWS-4 (W-1109-Volunteers-01X): any change of status refreshes it, so a
    // guest marked No Show and then Attended has their "Missed you" retired.
    if (newStatus && newStatus !== att.status && att.donor_id) {
      const w = await staffWho(req);
      await MY.refresh(orgId, att.event_id, w, { make: newStatus === 'no_show' }).catch(e => console.error("[event] no-show task:", e.message));
    }
    // STALE-2 (W-1107-Volunteers-21): Attended → No Show (or back to
    // Registered) rewrites or removes the "Came to" line; it never stays behind.
    if (newStatus !== att.status) await AL.syncAttendanceLine(orgId, att.id);
    const updated = await query(`SELECT ea.*, d.stage, d.total_giving, ${DL.HAS_GIVEN("d")} AS has_given FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id WHERE ea.id=$1`, [req.params.attendeeId]);
    for (const a of updated) a.donor_label = DL.donorLabel({ hasGiven: !!a.has_given, stage: a.stage });   // WALKB-2
    res.json(updated[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/events/:id/attendees/:attendeeId", requireAuth, async (req, res) => {
  try {
    const [att] = await query("SELECT id FROM event_attendees WHERE id=$1 AND event_id=$2 AND org_id=$3", [req.params.attendeeId, req.params.id, req.user.orgId]);
    if (!att) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
    const undoId = await trashRow("event_attendees", att.id, req);
    if (!undoId) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SWEEP-4 · FOLLOW-UP TASKS FOR WHO CAME ─────────────────────────────────
// One task per person who came (each person once, a deleted person never), and
// never a second one for somebody who already has an open follow-up for this
// event, so a second press makes nothing new. The screen asks GET first and
// says the count before anything is made; POST answers with the batch, and the
// batch's Undo removes exactly those tasks while nobody has touched them.
// It made one task per attendee ROW, counted nobody first, made the whole set
// again on a second press, gave deleted people tasks, and had no Undo.
const FOLLOW_UP_LINK = "event_follow_up";
const followUpCameSql = `SELECT DISTINCT a.donor_id FROM event_attendees a JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id AND d.deleted_at IS NULL
                          WHERE a.org_id = ? AND a.event_id = ? AND a.donor_id IS NOT NULL AND ${figureSources.EVENT_CAME("a")}`;
const followUpOpenSql = `SELECT DISTINCT t.donor_id FROM tasks t WHERE t.org_id = ? AND t.event_id = ? AND t.link_kind = '${FOLLOW_UP_LINK}'
                          AND COALESCE(t.done, 0) = 0 AND t.voided_at IS NULL`;
async function followUpCounts(orgId, eventId) {
  const [c] = await query(`SELECT (SELECT COUNT(*) FROM (${followUpCameSql}) x)::int AS came,
                                  (SELECT COUNT(*) FROM (${followUpCameSql}) x WHERE x.donor_id IN (${followUpOpenSql}))::int AS already`,
    [orgId, eventId, orgId, eventId, orgId, eventId]);
  return { came: c.came, already: c.already, toCreate: c.came - c.already };
}
const followUpWords = ({ came, already, toCreate }) => !came
  ? "Nobody is marked as having come yet, so there is nobody to follow up with."
  : toCreate === 0
  ? `All ${came.toLocaleString("en-US")} ${came === 1 ? "person who came has" : "people who came have"} an open follow-up task already. Nothing new will be made.`
  : `This makes ${toCreate.toLocaleString("en-US")} ${toCreate === 1 ? "task" : "tasks"}, one for each person who came`
    + (already ? `. ${already.toLocaleString("en-US")} already ${already === 1 ? "has one" : "have one"} and ${already === 1 ? "is" : "are"} left as ${already === 1 ? "it is" : "they are"}.` : ".");

app.get("/events/:id/follow-up", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [e] = await query("SELECT id, name FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!e) return res.status(404).json({ error: "Event not found" });
  const n = await followUpCounts(orgId, e.id);
  res.json({ ...n, sentence: followUpWords(n), title: `Thank them for coming to ${e.name}` });
}));

app.post("/events/:id/follow-up", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { taskTitle, dueDate, priority } = req.body || {};
  const [e] = await query("SELECT id, name FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!e) return res.status(404).json({ error: "Event not found" });
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) return res.status(400).json({ error: "bad_due", message: "The due date is not a date." });
  const pr = ["high", "medium", "low"].includes(priority) ? priority : "medium";
  // {{event_name}} still works for anything that sent the old template
  const title = (String(taskTitle || "").trim() || `Thank them for coming to ${e.name}`).split("{{event_name}}").join(e.name).slice(0, 240);
  const who = actor(req);
  const made = await query(
    `INSERT INTO tasks (id, org_id, title, due, priority, type, donor_id, event_id, link_kind, created_by, created_by_name)
     SELECT 'tsk_' || LEFT(REPLACE(gen_random_uuid()::text, '-', ''), 12), ?, ?, ?, ?, 'donor', c.donor_id, ?, '${FOLLOW_UP_LINK}', ?, ?
       FROM (${followUpCameSql}) c WHERE c.donor_id NOT IN (${followUpOpenSql})
     RETURNING id, created_at::text AS batch`,
    [orgId, title, dueDate || null, pr, e.id, who.id, who.name, orgId, e.id, orgId, e.id]);
  const n = await followUpCounts(orgId, e.id);
  req.audit.action(`made ${made.length} follow-up tasks for ${e.name}`);
  res.json({ count: made.length, batch: made.length ? made[0].batch : null, already: n.already - made.length,
    sentence: made.length
      ? `${made.length.toLocaleString("en-US")} follow-up ${made.length === 1 ? "task is" : "tasks are"} on Tasks${dueDate ? `, due ${(await import("../../shared/displayDate.js")).displayDate(dueDate)}` : ""}.`
      : "Nothing new was made: everybody who came already has an open follow-up task." });
}));

app.post("/events/:id/follow-up/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const batch = String((req.body || {}).batch || "");
  const [e] = await query("SELECT id FROM events WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!e) return res.status(404).json({ error: "Event not found" });
  if (!batch) return res.status(400).json({ error: "no_batch", message: "Which set of tasks? Undo answers the batch it was given." });
  // Only the tasks still as they were made: one somebody ticked off or edited stays.
  const gone = await query(
    `DELETE FROM tasks WHERE org_id=? AND event_id=? AND link_kind='${FOLLOW_UP_LINK}' AND created_at = ?::timestamptz
        AND COALESCE(done, 0) = 0 AND edited_at IS NULL RETURNING id`, [orgId, e.id, batch]);
  res.json({ removed: gone.length, sentence: `${gone.length.toLocaleString("en-US")} follow-up ${gone.length === 1 ? "task" : "tasks"} taken back off Tasks.` });
}));

app.get("/donors/:id/events", requireAuth, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    if (!(await orgOwns("donors", req.params.id, orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B
    const rows = await query(`
      SELECT e.id, e.name, e.event_type, e.date, e.status, ea.status AS attendee_status
      FROM event_attendees ea
      JOIN events e ON e.id = ea.event_id
      WHERE ea.donor_id = $1 AND ea.org_id = $2
      ORDER BY e.date DESC NULLS LAST
    `, [req.params.id, orgId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
}

module.exports = { routers, mount };
