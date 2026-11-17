// server/admin/sales/calendar.js · SALES-4 item 2. MEETINGS LOG THEMSELVES.
//
// The sales mailbox's calendar is read with the customers' own engine (helpers-7
// fetchCalendarEvents, on the same consent: Outlook's Calendars.ReadWrite, Gmail's
// calendar.events), under the customers' rule (shared/calendarLog.js), tightened for sales:
//
//   AN EVENT IS KEPT ONLY IF AN ATTENDEE IS A SALES CONTACT (by address). Every other event is
//   dropped in memory: no row, no title, no count, no log line. A kept event stores its title,
//   start, place and the matched contacts. Never its description, its link or anyone else's address.
//   Steward never writes to this calendar.
//
// A kept event becomes a meeting activity (kind 'meeting', source 'calendar') on the contacts,
// their organizations and their open deals; a second read finds it by its event id and updates
// it. A NEW meeting moves each open deal that sits before Meeting booked to Meeting booked, and
// records the move in sales_auto_moves so Now and the deal page offer Undo.
//
// THE PLANTED DEFECT (SALES4_PLANT=nomove on the server, tests only): the meeting is logged but the
// deal's stage is left where it was. tests/sales4.test.js §2 goes red.
"use strict";
const { newId } = require("../../shared/newId");
const MAIL = require("./email");
const PIPES = require("./pipelines");
const REC = require("./records");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES4_PLANT || "" : "";
const WHO = { id: "system:sales-calendar", name: "Steward (sales calendar read)" };
const PAST_DAYS = 30, AHEAD_DAYS = 60;
const TARGET = "Meeting booked";
const WHAT_IT_READS = [
  "Mail to or from a sales contact's address, or at a prospect domain you listed: the subject, who, when, and the body (kept encrypted).",
  "Calendar meetings where an attendee is a sales contact: the title, the time, the place, and which contacts are in it.",
];
const NEVER_TOUCHES = [
  "Any other email or event: nothing is kept, counted or logged.",
  "A meeting's description, its video link, or any other attendee's address.",
  "Sending: Steward never sends mail and never writes to your calendar.",
];

// Pure: which events to keep, and the contacts each names. events: the fetcher's
// { id, status, title, startsAt, endsAt, location, attendees: [email] }.
function keepEvents(events, scope) {
  const out = [];
  for (const e of events || []) {
    if (!e || !e.id || String(e.status || "").toLowerCase() === "cancelled") continue;
    const people = (e.attendees || []).map(a => String(a || "").trim().toLowerCase()).filter(a => a && a !== scope.own);
    const contactIds = [...new Set(people.flatMap(a => scope.byAddr.get(a) || []))];
    const startsAt = e.startsAt ? new Date(e.startsAt) : null;
    if (!contactIds.length || !startsAt || Number.isNaN(startsAt.getTime())) continue;
    out.push({ id: String(e.id), title: String(e.title || "").trim().slice(0, 300) || "Meeting", startsAt: startsAt.toISOString(),
      location: String(e.location || "").trim().slice(0, 300) || null, contactIds });
  }
  return out;
}

// Move an open deal to Meeting booked if it sits before it, and keep the move for Undo.
async function moveIfEarlier(ctx, dealId, activityId, why, who = WHO, now = Date.now()) {
  const [d] = await ctx.query(`SELECT d.id, d.stage_id, d.pipeline_id, s.position, s.kind, s.name FROM sales_deals d JOIN sales_stages s ON s.id = d.stage_id
                                WHERE d.id = ? AND d.deleted_at IS NULL`, [dealId]);
  if (!d || d.kind !== "open") return null;
  const pipes = await PIPES.readAll(ctx.query);
  const p = pipes.find(x => x.id === d.pipeline_id) || pipes[0];
  const target = p.stages.find(s => s.name.toLowerCase() === TARGET.toLowerCase());
  if (!target || Number(d.position) >= Number(target.position)) return null;
  if (PLANT === "nomove") return null;
  const r = await REC.setStage(ctx, dealId, target.id, who);
  if (r.error || r.unchanged) return null;
  const id = newId("sam");
  await ctx.run(`INSERT INTO sales_auto_moves (id, deal_id, activity_id, from_stage_id, to_stage_id, from_name, to_name, why, created_at, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, dealId, activityId, d.stage_id, target.id, d.name, target.name, why, new Date(now).toISOString(), who.id, who.name]);
  return { id, dealId, from: d.name, to: target.name };
}

// Store the kept events. Returns { stored, updated, moved: [...] }.
async function capture(ctx, mailbox, events, now = Date.now()) {
  const scope = await MAIL.scopeOf(ctx.query, mailbox.address);
  const kept = keepEvents(events, scope);
  let stored = 0, updated = 0;
  const moved = [];
  for (const e of kept) {
    const [have] = await ctx.query(`SELECT id FROM sales_activities WHERE provider_event_id = ?`, [`${mailbox.id}:${e.id}`]);
    const body = `${e.title}${e.location ? ` · ${e.location}` : ""}`;
    if (have) {
      await ctx.run(`UPDATE sales_activities SET at = ?, body = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [e.startsAt, body, WHO.id, WHO.name, have.id]);
      updated++;
      continue;
    }
    const recs = await MAIL.linkTargets(ctx.query, e.contactIds, []);
    const id = newId("sac");
    // When it was booked: when first read, or its own time if that came first (a meeting found
    // after it happened was booked by then). The scoreboard counts "meetings booked" by this.
    const bookedAt = new Date(Math.min(now, new Date(e.startsAt).getTime())).toISOString();
    const ins = await ctx.query(`INSERT INTO sales_activities (id, kind, at, body, owner_id, provider_event_id, source, meeting, created_at, created_by, created_by_name, updated_by, updated_by_name)
                                 VALUES (?, 'meeting', ?, ?, ?, ?, 'calendar', ?::jsonb, ?, ?, ?, ?, ?) ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING RETURNING id`,
      [id, e.startsAt, body, mailbox.user_id || null, `${mailbox.id}:${e.id}`, JSON.stringify({ place: e.location || "", from: "calendar" }), bookedAt, WHO.id, WHO.name, WHO.id, WHO.name]);
    if (!ins.length) continue;
    stored++;
    for (const r of recs) await ctx.run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [id, r.type, r.id, WHO.id, WHO.name]);
    await require("./cadences").endFor(ctx, e.contactIds, "meeting", WHO);
    // Only a meeting still to come books anything; one already past is history.
    if (new Date(e.startsAt).getTime() > now - 86400000) {
      for (const r of recs.filter(x => x.type === "deal")) {
        const m = await moveIfEarlier(ctx, r.id, id, `Calendar: ${e.title}`, WHO, now);
        if (m) moved.push(m);
      }
    }
  }
  return { stored, updated, moved, dropped: (events || []).length - kept.length };
}

// Read the calendar of one sales mailbox now. The token is the mailbox's own (email.tokenFor).
async function readNow(ctx, mb, { fetcher = null, token = null, now = Date.now() } = {}) {
  const scope = await MAIL.scopeOf(ctx.query, mb.address);
  if (!scope.addresses.size) return { stored: 0, updated: 0, moved: [] };
  const tok = token || await MAIL.tokenFor(ctx, mb);
  if (!tok) return { error: "reconnect" };
  const fetchEvents = fetcher || require("../../boot/share").ctx.fetchCalendarEvents;
  let events;
  try { events = await fetchEvents(mb.provider, tok, new Date(now - PAST_DAYS * 86400000).toISOString(), new Date(now + AHEAD_DAYS * 86400000).toISOString()); }
  catch (e) { return { error: "read_failed", message: "The calendar could not be read just now. It tries again on its own." }; }
  return { ok: true, ...(await capture(ctx, mb, events, now)) };
}

// Undo one automatic move: the deal goes back, if it is still where the move put it.
async function undo(ctx, id, who) {
  const [m] = await ctx.query(`SELECT id, deal_id, from_stage_id, to_stage_id, undone_at FROM sales_auto_moves WHERE id = ?`, [id]);
  if (!m) return { error: "not_found" };
  if (m.undone_at) return { ok: true, already: true };
  const [d] = await ctx.query(`SELECT stage_id FROM sales_deals WHERE id = ? AND deleted_at IS NULL`, [m.deal_id]);
  if (!d) return { error: "not_found" };
  if (d.stage_id !== m.to_stage_id) return { error: "invalid", message: "The deal has moved since, so this can't be undone here. Move it on the board." };
  const r = await REC.setStage(ctx, m.deal_id, m.from_stage_id, who);
  if (r.error) return r;
  await ctx.run(`UPDATE sales_auto_moves SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ?`, [who.id, who.name, id]);
  return { ok: true };
}

// The automatic moves of the last 14 days, still standing.
async function recentMoves(query, dealId = null, now = Date.now()) {
  return query(`SELECT m.id, m.deal_id, m.from_name, m.to_name, m.why, m.created_at, d.name AS deal_name FROM sales_auto_moves m JOIN sales_deals d ON d.id = m.deal_id AND d.deleted_at IS NULL
                 WHERE m.undone_at IS NULL AND m.created_at > ? AND d.stage_id = m.to_stage_id ${dealId ? "AND m.deal_id = ?" : ""}
                 ORDER BY m.created_at DESC LIMIT 20`, [new Date(now - 14 * 86400000).toISOString(), ...(dealId ? [dealId] : [])]);
}

module.exports = { WHAT_IT_READS, NEVER_TOUCHES, keepEvents, moveIfEarlier, capture, readNow, undo, recentMoves, PLANT };
