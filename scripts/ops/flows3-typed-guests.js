#!/usr/bin/env node
// scripts/ops/flows3-typed-guests.js · FLOWS-3 (W-1108-Volunteers-20). JONATHAN RUNS IT.
//
// Before FLOWS-3 a guest typed onto an event ("Add Guest", or a walk-in typed
// at the door) was a guest row with no person behind it (event_attendees
// .donor_id NULL): on that event's list and nowhere else. New ones are now
// people (server/events/typedGuest.js). This finds the ones made before, and
// gives each a person the way the live door does: the email first, then a
// name only one person has (personMatch.js's order); nobody matches, a new
// person typed "guest". The guest row then points at that person.
//
// SAFE BY DEFAULT: a dry run prints org ids and counts only, never a name or
// an email. --apply writes per org in one transaction with one audit row,
// whose `changes` list every person added and every guest row linked, so
// --undo=<audit id> unlinks those rows and removes the people it added. A
// guest whose matched person is already on that event is left as it is and
// counted. A second run finds none. org_creo is never touched.
//
//   node scripts/ops/flows3-typed-guests.js                 # dry run
//   node scripts/ops/flows3-typed-guests.js --org=org_x     # one org
//   node scripts/ops/flows3-typed-guests.js --apply         # write
//   node scripts/ops/flows3-typed-guests.js --undo=al_…     # put one org's run back
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const crypto = require("crypto");
const { Pool } = require("pg");
const { newId } = require("../../server/shared/newId");

const ACTOR = { id: "system:scripts/ops/flows3-typed-guests", name: "Repair: event guests typed in with no record", kind: "system" };
const PATH = "scripts/ops/flows3-typed-guests.js";
const ACTION = "give typed event guests a record";
const rid = p => p + crypto.randomBytes(8).toString("hex");

const WHERE = `a.donor_id IS NULL AND NULLIF(TRIM(a.name), '') IS NOT NULL
   AND EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id AND e.org_id = a.org_id)`;
const LIST_SQL = `
  SELECT a.org_id, COUNT(*)::int AS n FROM event_attendees a
   WHERE ${WHERE} AND a.org_id <> 'org_creo' AND ($1::text IS NULL OR a.org_id = $1::text)
   GROUP BY a.org_id ORDER BY a.org_id`;

async function list(client, orgArg = null) {
  return (await client.query(LIST_SQL, [orgArg])).rows;
}

// personMatch.findPersonId's order, in this client's transaction.
async function match(client, orgId, { name, email }) {
  const e = String(email || "").trim().toLowerCase();
  if (e) {
    const { rows } = await client.query(
      `SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND LOWER(TRIM(email))=$2 ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId, e]);
    if (rows.length) return rows[0].id;
  }
  const n = String(name || "").trim();
  const { rows } = await client.query(
    `SELECT id, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND LOWER(TRIM(name))=LOWER($2) LIMIT 2`, [orgId, n]);
  if (rows.length === 1) {
    const theirs = String(rows[0].email || "").trim().toLowerCase();
    if (!e || !theirs || theirs === e) return rows[0].id;
  }
  return null;
}

async function apply(client, orgId) {
  if (orgId === "org_creo") throw new Error("org_creo is never touched.");
  await client.query("BEGIN");
  try {
    const guests = (await client.query(
      `SELECT a.id, a.event_id, a.name, a.email FROM event_attendees a WHERE a.org_id = $1 AND ${WHERE} ORDER BY a.created_at NULLS LAST, a.id FOR UPDATE`, [orgId])).rows;
    const added = [], linked = [];
    let alreadyOn = 0;
    for (const g of guests) {
      let pid = await match(client, orgId, g);
      if (pid) {
        const { rows: on } = await client.query(`SELECT 1 FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id=$3`, [orgId, g.event_id, pid]);
        if (on.length) { alreadyOn++; continue; }
      } else {
        pid = newId("d");
        await client.query(
          `INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'prospect','new','[]','["guest"]'::jsonb,$5,$6)`,
          [pid, orgId, String(g.name).replace(/\s+/g, " ").trim().slice(0, 200), String(g.email || "").trim().toLowerCase(), ACTOR.id, ACTOR.name]);
        added.push(pid);
      }
      await client.query(`UPDATE event_attendees SET donor_id = $1 WHERE id = $2 AND org_id = $3`, [pid, g.id, orgId]);
      linked.push({ attendeeId: g.id, donorId: pid });
    }
    let auditId = null;
    if (linked.length) {
      auditId = rid("al_");
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,$6,'event_attendee',NULL,$7,$8,$9,$10,$11,'SCRIPT',$12)`,
        [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, ACTION, JSON.stringify({ added, linked }),
         JSON.stringify({ guestsWithNoRecord: linked.length }), JSON.stringify({ guestsWithNoRecord: 0 }),
         `${linked.length} typed event ${linked.length === 1 ? "guest" : "guests"} linked to a record (${added.length} new, typed guest)`, linked.length, PATH]);
    }
    await client.query("COMMIT");
    return { auditId, linked: linked.length, added: added.length, alreadyOn };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = $3`, [auditId, ACTOR.id, ACTION]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    let unlinked = 0, removed = 0;
    for (const l of ch.linked || []) {
      const r = await client.query(`UPDATE event_attendees SET donor_id = NULL WHERE id = $1 AND org_id = $2 AND donor_id = $3`, [l.attendeeId, a.org_id, l.donorId]);
      unlinked += r.rowCount;
    }
    for (const id of ch.added || []) {
      const r = await client.query(`DELETE FROM donors WHERE id = $1 AND org_id = $2 AND created_by = $3
         AND NOT EXISTS (SELECT 1 FROM event_attendees x WHERE x.org_id = $2 AND x.donor_id = $1)`, [id, a.org_id, ACTOR.id]);
      removed += r.rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'undo: give typed event guests a record','event_attendee',NULL,$6,NULL,NULL,$7,$8,'SCRIPT',$9)`,
      [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ undoes: auditId, unlinked, removed }),
       `${unlinked} event guests unlinked and ${removed} added records removed: the script's run ${auditId} undone`, unlinked, PATH]);
    await client.query("COMMIT");
    return { orgId: a.org_id, unlinked, removed };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main(argv = process.argv) {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const APPLY = argv.includes("--apply");
  const undoId = (argv.find(a => a.startsWith("--undo=")) || "").slice(7) || null;
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  if (orgArg === "org_creo") throw new Error("org_creo is never touched.");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (undoId) {
      const r = await undo(client, undoId);
      console.log(`${r.orgId}: ${r.unlinked} unlinked, ${r.removed} records removed.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org; --undo puts a run back)\n" : "MODE: DRY RUN (nothing is written; add --apply to link)\n");
    const orgs = await list(client, orgArg);
    let total = 0;
    for (const o of orgs) {
      if (!APPLY) { console.log(`${o.org_id}: ${o.n}`); total += o.n; continue; }
      const r = await apply(client, o.org_id);
      console.log(`${o.org_id}: ${r.linked} linked (${r.added} new guest ${r.added === 1 ? "record" : "records"})${r.alreadyOn ? `, ${r.alreadyOn} left: their person is already on that event` : ""}${r.auditId ? ` (audit ${r.auditId}; undo with --undo=${r.auditId})` : ""}`);
      total += r.linked;
    }
    console.log(`\n${total} typed event ${total === 1 ? "guest" : "guests"} with no record in ${orgs.length} ${orgs.length === 1 ? "org" : "orgs"} ${APPLY ? "linked" : "would be linked"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL, list, apply, undo, ACTOR };
