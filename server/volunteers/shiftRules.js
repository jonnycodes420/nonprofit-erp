// server/volunteers/shiftRules.js · STALE-2. THE SCHEDULE'S RULES THE QA
// FLEET FOUND MISSING (7 Nov, W-1107-Volunteers-09X/09Y and Area 4).
//
//   1. A sign-up that clashes warns first, naming the clash. Placing somebody
//      on a shift that overlaps one they already hold answers 409 with "Tomas
//      Reyes is already on Kitchen, Sat Nov 8, 9am to 12pm, which overlaps
//      this shift." The person confirms (overlapOk: true) or doesn't. A
//      clash can be meant, so it is a question, never a wall.
//   2. Conflicts are computed from the places as they stand, never stored.
//      CONFLICT_PLACES_SQL is the one read of "who holds a place on these
//      days", and a deleted person holds none: before this, a deleted
//      volunteer's two overlapping places kept "1 conflict" on the schedule.
//   3. A draft shift nobody signed up for can be deleted outright. A published
//      shift, or one anybody has been on, is cancelled instead (its history
//      is somebody's), exactly as before.
//
// The overlap gate is the sign-up route's own first step; the draft delete is
// mounted through routes/crm.js.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const VS_READY = import("../../shared/volunteerShifts.js");

// Every place that counts toward a conflict on these days: confirmed or done,
// on a shift not cancelled, held by a person who is not deleted.
const CONFLICT_PLACES_SQL = `SELECT su.person_id AS "personId", su.slot_id AS "slotId", s.date, s.start_time AS "startTime", s.end_time AS "endTime"
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id AND s.org_id = su.org_id
       JOIN donors d ON d.id = su.person_id AND d.org_id = su.org_id AND d.deleted_at IS NULL
      WHERE su.org_id = ? AND su.status IN ('confirmed','completed') AND s.cancelled_at IS NULL AND s.date = ANY(?)`;

const dayWords = iso => {
  const t = new Date(Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10)));
  return t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

// The shifts this person already holds that overlap `slotId`. [] when none.
async function clashesFor(query, orgId, personId, slotId) {
  const VS = await VS_READY;
  const [slot] = await query("SELECT id, date, start_time, end_time FROM volunteer_slots WHERE id = ? AND org_id = ? AND cancelled_at IS NULL", [slotId, orgId]);
  if (!slot) return [];
  const mine = { date: slot.date, startTime: slot.start_time, endTime: slot.end_time };
  const rows = await query(
    `SELECT s.id, s.date, s.start_time, s.end_time, COALESCE(s.name, o.name) AS name
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id AND s.org_id = su.org_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
      WHERE su.org_id = ? AND su.person_id = ? AND su.status IN ('confirmed','completed')
        AND s.cancelled_at IS NULL AND s.date = ? AND s.id <> ?`, [orgId, personId, slot.date, slot.id]);
  return rows.filter(r => VS.overlaps(mine, { date: r.date, startTime: r.start_time, endTime: r.end_time }))
    .map(r => ({ slotId: r.id, name: r.name, when: `${dayWords(r.date)}, ${VS.timeRangeWords(r.start_time, r.end_time)}` }));
}

function clashSentence(name, clashes) {
  const list = clashes.map(c => `${c.name}, ${c.when}`).join("; and ");
  return `${name} is already on ${list}, which ${clashes.length === 1 ? "overlaps" : "overlap"} this shift.`;
}

// 1. THE SIGN-UP DOOR ASKS ABOUT A CLASH FIRST: the first step of POST
// /volunteer-hub/signups (routes/volunteerScheduling.js).
function overlapGate(query) {
  return (req, res, next) => (async () => {
    const b = req.body || {};
    if (b.overlapOk === true) return next();
    const orgId = req.user.orgId, personId = String(b.personId || ""), slotId = String(b.slotId || "");
    const [p] = await query("SELECT name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [personId, orgId]);
    if (!p) return next();   // the sign-up route says not found in its own words
    const [had] = await query("SELECT 1 FROM volunteer_signups WHERE slot_id = ? AND org_id = ? AND person_id = ? AND status <> 'cancelled'", [slotId, orgId, personId]);
    if (had) return next();   // already on it: nothing new to clash
    const clashes = await clashesFor(query, orgId, personId, slotId);
    if (!clashes.length) return next();
    res.status(409).json({ error: "overlap", clashes, message: clashSentence(p.name, clashes) });
  })().catch(next);
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap } = ctx;
  const app = routers.r1;

  // 3. A DRAFT SHIFT NOBODY SIGNED UP FOR, DELETED.
  app.delete("/volunteer-hub/slots/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [s] = await query(
      `SELECT s.id, s.published, s.date,
              -- FLOWS-5 (W-1110-Volunteers-08X): people still on it; a cancelled sign-up is nobody.
              (SELECT COUNT(*)::int FROM volunteer_signups su WHERE su.slot_id = s.id AND su.org_id = s.org_id AND su.status <> 'cancelled') AS signups,
              (SELECT COUNT(*)::int FROM volunteer_shifts v WHERE v.slot_id = s.id AND v.org_id = s.org_id) AS logged
         FROM volunteer_slots s WHERE s.id = ? AND s.org_id = ?`, [req.params.id, orgId]);
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.published !== false || s.signups > 0 || s.logged > 0) {
      return res.status(409).json({ error: "not_a_bare_draft",
        message: s.published !== false ? "This shift is published, so it can be cancelled but not deleted."
          : s.signups > 0 ? `${s.signups === 1 ? "1 person is" : `${s.signups} people are`} signed up for this shift, so it can be cancelled but not deleted.`
          : "Hours are logged against this shift, so it can be cancelled but not deleted." });
    }
    await run("DELETE FROM volunteer_slot_roles WHERE slot_id = ? AND org_id = ?", [s.id, orgId]);
    await run("DELETE FROM volunteer_slots WHERE id = ? AND org_id = ?", [s.id, orgId]);
    res.json({ ok: true, message: "The draft shift is deleted." });
  }));
  return {};
}

module.exports = { routers, mount, overlapGate, CONFLICT_PLACES_SQL, clashesFor, clashSentence };
