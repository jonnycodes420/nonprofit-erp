// server/donors/connections.js · CONNECT-1. HOW A PERSON CAME IN.
//
// Two directional links in donor_relationships, beside spouse, owner and the
// rest, in the same picker:
//   introduced_by   the newcomer was introduced by the connector
//   guest_of        the newcomer came as the connector's guest, at an event
//                   when one is named (donor_relationships.event_id)
// Stored newcomer first: donor_id_a is the newcomer, donor_id_b the connector,
// from whichever side the link was made. They are context only: they never
// pool giving, join a household or make a giving unit (lapse.js and
// households.js list the types that do, and these are not among them).
// The connector's credit is shared/numbers/broughtIn.js.
//
// Every door that writes one comes through addConnection: the profile's
// picker, an event's "Guest of…" when a guest is added, and the spreadsheet
// import (server/imports/connectionsImport.js). One link per newcomer,
// connector, type and event; a second ask for the same link answers the first.
"use strict";
const { newId } = require("../shared/newId");
const { CONNECT_TYPES } = require("../../shared/numbers/broughtIn");

const isConnectType = t => CONNECT_TYPES.includes(t);

// db: { query } (the app's `?` query). Returns { id, created } or { error, status }.
async function addConnection(db, orgId, { newcomerId, connectorId, type, eventId = null, actor, importId = null }) {
  if (!isConnectType(type)) return { error: "That is not a way somebody comes in.", status: 400 };
  if (!newcomerId || !connectorId) return { error: "Choose the person.", status: 400 };
  if (newcomerId === connectorId) return { error: "A donor can't be linked to themselves", status: 400 };
  if (eventId && type !== "guest_of") return { error: "Only a Guest of link names an event.", status: 400 };
  const people = await db.query(`SELECT id FROM donors WHERE org_id = ? AND id = ANY(?::text[]) AND deleted_at IS NULL`, [orgId, [newcomerId, connectorId]]);
  if (people.length < 2) return { error: "Donor not found", status: 404 };
  if (eventId) {
    const [ev] = await db.query(`SELECT id FROM events WHERE id = ? AND org_id = ?`, [eventId, orgId]);
    if (!ev) return { error: "Event not found", status: 404 };
  }
  const [had] = await db.query(
    `SELECT id FROM donor_relationships WHERE org_id = ? AND donor_id_a = ? AND donor_id_b = ? AND relationship_type = ?
        AND COALESCE(event_id, '') = COALESCE(?, '') LIMIT 1`, [orgId, newcomerId, connectorId, type, eventId || null]);
  if (had) return { id: had.id, created: false };
  const id = newId("drel");
  const who = actor || { id: "system:connections", name: "Steward" };
  await db.query(
    `INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, event_id, created_by, created_by_name, import_id)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
    [id, orgId, newcomerId, connectorId, type, eventId || null, who.id, who.name, importId]);
  return { id, created: true };
}

// The ends of a link made from `meId`'s profile: `side` says which end this
// record is ("newcomer", the default, or "connector").
function endsFrom(meId, otherId, side) {
  return side === "connector" ? { newcomerId: otherId, connectorId: meId } : { newcomerId: meId, connectorId: otherId };
}

// The link as this record reads it (its direction, and the event's name).
async function describe(query, orgId, rows, meId) {
  const evIds = [...new Set(rows.filter(r => r.event_id).map(r => r.event_id))];
  const evs = evIds.length ? await query(`SELECT id, name, date::text AS date FROM events WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, evIds]) : [];
  const evMap = new Map(evs.map(e => [e.id, e]));
  const out = new Map();
  for (const r of rows) {
    if (!isConnectType(r.relationship_type)) continue;
    const ev = r.event_id ? evMap.get(r.event_id) : null;
    out.set(r.id, { direction: r.mine_first ? "newcomer" : "connector", eventId: r.event_id || null, eventName: ev ? ev.name : null });
  }
  return out;
}

// The connector's line, from the two figure sources (one computation each,
// the same the drawer opens). Null when they brought nobody in.
async function broughtInFor(orgId, donorId) {
  const FS = require("../../figureSources");
  const peopleSource = { key: "brought-in-people", params: { donor: donorId } };
  const giftsSource = { key: "brought-in-gifts", params: { donor: donorId } };
  const people = await FS.figureValue(orgId, peopleSource);
  const n = Number(people.value) || 0;
  if (!n) return null;
  const gifts = await FS.figureValue(orgId, giftsSource);
  const cents = Number(gifts.cents != null ? gifts.cents : Math.round((Number(gifts.value) || 0) * 100)) || 0;
  const BI = require("../../shared/numbers/broughtIn");
  return { people: n, cents, value: Number(gifts.value) || 0, sentence: BI.words({ people: n, cents }),
    peopleSource, giftsSource, peopleDefinition: BI.PEOPLE_SENTENCE, giftsDefinition: BI.GIFTS_SENTENCE };
}

// ── THE DONORS LIST'S FILTERS (donorList.js) ────────────────────────────────
// "Introduced by…" and "Guest of…" pick from the people who have introduced or
// hosted someone (a short list, never the whole org); a Guest of choice may
// name the event too ("host|event"). "Brought people in" is broughtIn.js's
// own rule. Each compiles to SQL over the unaliased `donors` row.
async function filterChoices(query, orgId) {
  const rows = await query(
    `SELECT r.relationship_type AS type, r.donor_id_b AS id, c.name, r.event_id, ev.name AS event_name, ev.date::text AS event_date
       FROM donor_relationships r
       JOIN donors c ON c.id = r.donor_id_b AND c.org_id = r.org_id AND c.deleted_at IS NULL
       LEFT JOIN events ev ON ev.id = r.event_id AND ev.org_id = r.org_id
      WHERE r.org_id = ? AND r.relationship_type = ANY(?::text[])
      GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY lower(c.name), 6 DESC NULLS LAST LIMIT 1000`, [orgId, [...CONNECT_TYPES]]).catch(() => []);
  const intro = new Map(), guest = new Map();
  for (const r of rows) {
    if (r.type === "introduced_by") intro.set(r.id, { value: r.id, label: r.name });
    else {
      if (!guest.has(r.id)) guest.set(r.id, { value: r.id, label: `${r.name} (any event)` });
      if (r.event_id) guest.set(`${r.id}|${r.event_id}`, { value: `${r.id}|${r.event_id}`, label: `${r.name} at ${r.event_name}${r.event_date ? ` (${String(r.event_date).slice(0, 10)})` : ""}` });
    }
  }
  return { introduced_by: [...intro.values()], guest_of: [...guest.values()] };
}
function filterCond(field, op, value) {
  const v = String(value ?? "").trim();
  if (field === "brought_in") {
    const sql = require("../../shared/numbers/broughtIn").BROUGHT_ANY("donors");
    return op === "yes" ? { sql, args: [] } : op === "no" ? { sql: `NOT ${sql}`, args: [] } : null;
  }
  if (!v) return { error: `Pick the person for ${field === "guest_of" ? "Guest of" : "Introduced by"}.` };
  const [connector, eventId] = v.split("|");
  const type = field === "guest_of" ? "guest_of" : "introduced_by";
  return {
    sql: `EXISTS (SELECT 1 FROM donor_relationships rc WHERE rc.org_id = donors.org_id AND rc.donor_id_a = donors.id
             AND rc.relationship_type = ? AND rc.donor_id_b = ?${eventId ? " AND rc.event_id = ?" : ""})`,
    args: eventId ? [type, connector, eventId] : [type, connector],
  };
}

// FLAKE-5 (W-CONNECT-guest-filter): a guest usually hasn't given, so on the
// list's default view (role=auto, which is Donors once the org has a donor) a
// filter on how people came in searches Everyone, and the people switch says
// Everyone (groups.directoryRoles). A view that picked Donors keeps Donors.
const CONNECT_FIELDS = new Set(["introduced_by", "guest_of", "brought_in"]);
function namesConnection(rawWhere) {
  let w = rawWhere;
  if (typeof w === "string") { try { w = JSON.parse(w); } catch { return false; } }
  return !!(w && Array.isArray(w.conditions) && w.conditions.some(c => c && CONNECT_FIELDS.has(c.field)));
}

module.exports = { CONNECT_TYPES, isConnectType, addConnection, endsFrom, describe, broughtInFor, filterChoices, filterCond, namesConnection };
