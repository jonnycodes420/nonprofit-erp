// server/volunteers/volunteerRecord.js · VOL-3 items 1 and 2. THE VOLUNTEER RECORD, AND ITS STATUS.
//
// "Volunteer" was only a person_types entry with an application row beside it: there was no
// status, so nothing could end, pause or edit it, and Add filled the gap by writing an Approved
// application nobody sent. A volunteer now has one volunteer_records row (vol3.js):
//
//   · what Add asked for: hours a week, the days they can come, the roles they take. Editable
//     on the profile's Volunteer tab, and never an application. Applications are only what came
//     through the volunteer page.
//   · their status, Active, Paused or Former, with the org's day it was set and who set it. The
//     status before it is kept beside it, so Undo puts back exactly that (its day and its setter
//     too), never "Active, today, by me".
//
// This module is the ONLY writer of volunteer_records (makeVolunteer, the profile, the role
// toggle and Undo all come here). Marking somebody former never touches their hours, shifts,
// notes or the Volunteer role on the record: their history stays where it is, and the roster's
// first number counts Active (shared/numbers/volunteerStatus.js).
//
// A record made before VOL-3 lived on an approved application with `via` staff or agent. Until
// scripts/ops/vol3-staff-records.js moves them, readRecord falls back to that row, so nothing a
// coordinator typed disappears.
"use strict";
const { query, run, queryTx, runTx } = require("../../db");
const orgTime = require("../../orgTime");
const { newId } = require("../shared/newId");
const VST = require("../../shared/numbers/volunteerStatus");

const DAYS_LIST = () => import("../../shared/volunteerApply.js").then(m => m.AVAILABILITY);

const parse = v => { try { return typeof v === "string" ? JSON.parse(v) : (v || []); } catch { return []; } };

async function orgDay(orgId, q = query) {
  const [o] = await q("SELECT timezone FROM orgs WHERE id=?", [orgId]).catch(() => []);
  return orgTime.orgToday({ timezone: o && o.timezone });
}

// The fields Add (and the profile's Edit) may set. A field left out keeps what it had.
async function checkFields(opts = {}) {
  const DAYS = await DAYS_LIST();
  const errors = [];
  let hoursPerWeek = null;
  if (opts.hoursPerWeek !== undefined && opts.hoursPerWeek !== null && String(opts.hoursPerWeek).trim() !== "") {
    const n = Number(String(opts.hoursPerWeek).trim());
    if (!Number.isFinite(n) || n <= 0 || n > 80) errors.push("Hours a week is a number from 1 to 80.");
    else hoursPerWeek = Math.round(n * 100) / 100;
  }
  const availability = [...new Set((Array.isArray(opts.availability) ? opts.availability : []).map(String).filter(a => DAYS.includes(a)))];
  const rawRoles = Array.isArray(opts.roles) ? opts.roles : String(opts.roles || "").split(",");
  const roles = [...new Set(rawRoles.map(r => String(r).trim().slice(0, 60)).filter(Boolean))].slice(0, 10);
  return { errors, hoursPerWeek, availability, roles };
}

// POLISH-11 item 2 (W-1125-Volunteers-T2): a status change can be undone for a day, and the record
// says until when, so Undo is there again when she comes back to the person (and in Recent changes).
const STATUS_UNDO_HOURS = 24;
const undoUntilOf = r => {
  if (!r || !r.prev_status || !r.status_changed_at) return null;
  const until = new Date(new Date(r.status_changed_at).getTime() + STATUS_UNDO_HOURS * 3600e3);
  return until > new Date() ? until.toISOString() : null;
};

function shape(r) {
  if (!r) return null;
  return {
    id: r.id, hoursPerWeek: r.hours_per_week != null ? Number(r.hours_per_week) : null,
    availability: parse(r.availability), roles: parse(r.roles),
    status: r.status || "active", statusWord: VST.STATUS_WORDS[r.status || "active"],
    statusOn: r.status_on || null, statusBy: r.status_by_name || null,
    previous: r.prev_status ? { status: r.prev_status, statusWord: VST.STATUS_WORDS[r.prev_status], statusOn: r.prev_status_on || null, statusBy: r.prev_status_by_name || null } : null,
    legacy: !!r.legacy,
    undoUntil: undoUntilOf(r),
  };
}

// The one row, made if it is not there yet. `client` is a transaction's connection, when given.
async function ensureRow(orgId, personId, who, client) {
  const q = (sql, p) => client ? queryTx(client, sql, p) : query(sql, p);
  const w = (sql, p) => client ? runTx(client, sql, p) : run(sql, p);
  const [had] = await q("SELECT * FROM volunteer_records WHERE org_id=? AND person_id=?", [orgId, personId]);
  if (had) return { row: had, created: false };
  // A record kept on an approved staff application before VOL-3 starts the row, so its fields stay.
  const [legacy] = await q(`SELECT hours_per_week, availability, roles FROM volunteer_applications
                             WHERE org_id=? AND person_id=? AND status='approved' AND via IN ('staff','agent')
                             ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [orgId, personId]).catch(() => []);
  await w(`INSERT INTO volunteer_records (id,org_id,person_id,hours_per_week,availability,roles,status,created_by,created_by_name)
           VALUES (?,?,?,?,?::jsonb,?::jsonb,'active',?,?) ON CONFLICT (org_id, person_id) DO NOTHING`,
    [newId("vrec"), orgId, personId, legacy ? legacy.hours_per_week : null,
     JSON.stringify(legacy ? parse(legacy.availability) : []), JSON.stringify(legacy ? parse(legacy.roles) : []), who.id, who.name || null]);
  const [row] = await q("SELECT * FROM volunteer_records WHERE org_id=? AND person_id=?", [orgId, personId]);
  return { row, created: true };
}

// Hours a week, days and roles. Only the fields given change.
async function writeFields(orgId, personId, opts, who, client = null) {
  const f = await checkFields(opts);
  if (f.errors.length) return { error: "bad_fields", message: f.errors[0] };
  const w = (sql, p) => client ? runTx(client, sql, p) : run(sql, p);
  const { row, created } = await ensureRow(orgId, personId, who, client);
  await w(`UPDATE volunteer_records SET
             hours_per_week = CASE WHEN ? THEN ?::numeric ELSE hours_per_week END,
             availability = CASE WHEN ? THEN ?::jsonb ELSE availability END,
             roles = CASE WHEN ? THEN ?::jsonb ELSE roles END,
             updated_at = NOW()
           WHERE id=? AND org_id=?`,
    [opts.hoursPerWeek !== undefined, f.hoursPerWeek, opts.availability !== undefined, JSON.stringify(f.availability),
     opts.roles !== undefined, JSON.stringify(f.roles), row.id, orgId]);
  const q = (sql, p) => client ? queryTx(client, sql, p) : query(sql, p);
  const [now] = await q("SELECT * FROM volunteer_records WHERE id=? AND org_id=?", [row.id, orgId]);
  return { created, record: shape(now) };
}

// THE ONE STATUS WRITE. Active, Paused or Former, dated the org's today, stamped with who.
async function setStatus(orgId, personId, status, who, client = null) {
  if (!VST.STATUSES.includes(status)) return { error: "bad_status", message: "A volunteer is Active, Paused or Former." };
  const q = (sql, p) => client ? queryTx(client, sql, p) : query(sql, p);
  const w = (sql, p) => client ? runTx(client, sql, p) : run(sql, p);
  const { row } = await ensureRow(orgId, personId, who, client);
  if (row.status === status) return { unchanged: true, record: shape(row) };
  const today = await orgDay(orgId, q);
  await w(`UPDATE volunteer_records SET prev_status=status, prev_status_on=status_on, prev_status_by=status_by, prev_status_by_name=status_by_name,
             status=?, status_on=?, status_by=?, status_by_name=?, status_changed_at=NOW(), updated_at=NOW()
           WHERE id=? AND org_id=?`, [status, today, who.id, who.name || null, row.id, orgId]);
  const [now] = await q("SELECT * FROM volunteer_records WHERE id=? AND org_id=?", [row.id, orgId]);
  return { record: shape(now) };
}

// Undo the last status change: the status before it comes back with its own day and setter.
async function undoStatus(orgId, personId, client = null) {
  const q = (sql, p) => client ? queryTx(client, sql, p) : query(sql, p);
  const w = (sql, p) => client ? runTx(client, sql, p) : run(sql, p);
  const [row] = await q("SELECT * FROM volunteer_records WHERE org_id=? AND person_id=?", [orgId, personId]);
  if (!row || !row.prev_status) return { error: "nothing_to_undo", message: "There is no status change to undo." };
  await w(`UPDATE volunteer_records SET status=prev_status, status_on=prev_status_on, status_by=prev_status_by, status_by_name=prev_status_by_name,
             prev_status=NULL, prev_status_on=NULL, prev_status_by=NULL, prev_status_by_name=NULL, status_changed_at=NULL, updated_at=NOW()
           WHERE id=? AND org_id=?`, [row.id, orgId]);
  const [now] = await q("SELECT * FROM volunteer_records WHERE id=? AND org_id=?", [row.id, orgId]);
  return { record: shape(now), undid: row.status };
}

// Their record as a screen reads it: the row, or the pre-VOL-3 staff application, or null.
async function readRecord(orgId, personId, q = query) {
  const [row] = await q("SELECT * FROM volunteer_records WHERE org_id=? AND person_id=?", [orgId, personId]).catch(() => []);
  if (row) return shape(row);
  const [legacy] = await q(`SELECT id, hours_per_week, availability, roles FROM volunteer_applications
                             WHERE org_id=? AND person_id=? AND status='approved' AND via IN ('staff','agent')
                             ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [orgId, personId]).catch(() => []);
  return legacy ? shape({ ...legacy, status: "active", legacy: true }) : null;
}

// The sentence a status change says, with its Undo beside it on the screen.
function statusSentence(name, rec) {
  const who = name || "They";
  if (rec.status === "former") return `${who} is marked as a former volunteer. Their hours and history stay on their record, and they are not counted as active.`;
  if (rec.status === "paused") return `${who} is paused. They stay on the roster, are not counted as active, and their hours stay on their record.`;
  return `${who} is an active volunteer again.`;
}

module.exports = { checkFields, writeFields, setStatus, undoStatus, readRecord, statusSentence, ensureRow, STATUS_UNDO_HOURS };
