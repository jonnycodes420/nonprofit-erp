#!/usr/bin/env node
// FIX-30 Part 1 · PUT BACK THE POSTAL STATES THE AGENT OVERWROTE WITH "runs".
//
// Before HARDEN-1, an Agent contact update wrote the step's run state ("runs")
// into the person's postal state. The code is fixed; the rows it wrote are not.
// The Agent's undo ledger (`agent_writes`) kept what each row looked like
// BEFORE the write, so the true value is known and nothing is guessed.
//
// DRY RUN BY DEFAULT. It prints, per org, the count and one line per person:
// "now runs, restore to X". It writes only with --apply, inside ONE
// transaction, and every restore leaves one audit row (actor
// system:scripts/repair-runs-state) on the person's History, with the before
// and after. --undo puts back exactly what an --apply changed, and logs that too.
//
// It never touches a state somebody changed after the Agent's write. Those are
// listed separately, as are people whose state reads "runs" with no Agent
// write behind it: both are a person's call, not a script's.
//
// Usage:
//   DATABASE_URL=… node scripts/repair-runs-state.js            # dry run, every org
//   DATABASE_URL=… node scripts/repair-runs-state.js --apply    # write
//   DATABASE_URL=… node scripts/repair-runs-state.js --undo     # reverse an --apply
//   --org=org_x narrows any of them to one organisation.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).

const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/repair-runs-state", name: "Repair: Agent postal state", kind: "system" };
const ACTION = "repair runs state";
const UNDO_ACTION = "undo repair runs state";
const RUNS = "runs";

// The whole decision, with no database in it, so the suite can read it too.
// `writes` are one person's update_contact ledger rows that set "runs", oldest
// first. `nowState` is what the record says today. `laterHumanEdit` is true
// when anybody but the Agent touched the state after the last of those writes;
// `repaired` when this script already put it back.
function decide({ writes, nowState, laterHumanEdit, repaired }) {
  if (!writes.length) return { kind: "no_agent_write" };
  // The oldest write's "before" is the value from before the Agent ever
  // touched it. A later write's "before" is only the earlier "runs".
  const first = writes[0];
  const before = first.before_row && typeof first.before_row === "object" ? first.before_row : {};
  const restoreTo = Object.prototype.hasOwnProperty.call(before, "state") ? before.state : undefined;
  if (String(nowState || "").trim().toLowerCase() !== RUNS) {
    return repaired ? { kind: "already_repaired" } : { kind: "changed_after", nowState };
  }
  if (laterHumanEdit) return { kind: "changed_after", nowState };
  if (restoreTo === undefined || String(restoreTo || "").trim().toLowerCase() === RUNS) return { kind: "no_before_value" };
  return { kind: "restore", restoreTo: restoreTo == null || restoreTo === "" ? null : String(restoreTo) };
}

const show = v => (v == null || v === "" ? "(blank)" : v);

async function main() {
  const { writerDbUrl } = require("./lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = process.argv.includes("--apply");
  const UNDO = process.argv.includes("--undo");
  const org = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
  if (APPLY && UNDO) { console.error("Pick one of --apply or --undo."); process.exit(1); }
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  try {
    if (UNDO) await undo(pool, org);
    else await repair(pool, org, APPLY);
  } finally { await pool.end(); }
}

// Every person the plan covers, grouped by org, with the decision for each.
async function plan(db, org) {
  const p = org ? [org] : [];
  const writes = (await db.query(
    `SELECT w.id, w.org_id, w.entity_id, w.before_row, w.created_at
       FROM agent_writes w
      WHERE w.tool = 'update_contact' AND w.entity_table = 'donors' AND w.undone_at IS NULL
        AND lower(btrim(w.after_row->>'state')) = 'runs' ${org ? "AND w.org_id = $1" : ""}
      ORDER BY w.org_id, w.entity_id, w.created_at, w.id`, p)).rows;
  const runsNow = (await db.query(
    `SELECT id, org_id FROM donors WHERE lower(btrim(state)) = 'runs' ${org ? "AND org_id = $1" : ""}`, p)).rows;
  const key = (o, d) => o + "\u0000" + d;
  const people = new Map();
  for (const w of writes) {
    const k = key(w.org_id, w.entity_id);
    if (!people.has(k)) people.set(k, { orgId: w.org_id, donorId: w.entity_id, writes: [] });
    people.get(k).writes.push(w);
  }
  for (const d of runsNow) {
    const k = key(d.org_id, d.id);
    if (!people.has(k)) people.set(k, { orgId: d.org_id, donorId: d.id, writes: [] });
  }
  const out = [];
  for (const person of people.values()) {
    const [d] = (await db.query("SELECT state FROM donors WHERE id = $1 AND org_id = $2", [person.donorId, person.orgId])).rows;
    if (!d) continue;   // the person is gone; nothing to put back
    const last = person.writes.length ? person.writes[person.writes.length - 1].created_at : null;
    let laterHumanEdit = false, repaired = false;
    if (last) {
      // Anything after the Agent's last write that touched the state. The
      // Agent's own route call is logged as actor_kind 'agent' and is skipped;
      // this script's rows are how a second run knows it already ran.
      const later = (await db.query(
        `SELECT action, actor_kind FROM fin_audit_log
          WHERE org_id = $1 AND entity_id = $2 AND created_at > $3
            AND (before_fields ? 'state' OR after_fields ? 'state' OR changes ? 'state')
          ORDER BY created_at DESC, id DESC`, [person.orgId, person.donorId, last])).rows;
      const mine = later.filter(r => r.action === ACTION || r.action === UNDO_ACTION);
      repaired = !!mine.length && mine[0].action === ACTION;
      laterHumanEdit = later.some(r => r.actor_kind !== "agent" && r.action !== ACTION && r.action !== UNDO_ACTION);
    }
    out.push({ ...person, nowState: d.state, ...decide({ writes: person.writes, nowState: d.state, laterHumanEdit, repaired }) });
  }
  out.sort((a, b) => a.orgId.localeCompare(b.orgId) || a.donorId.localeCompare(b.donorId));
  return out;
}

async function auditRow(db, { orgId, donorId, action, before, after, summary }) {
  await db.query(
    `INSERT INTO fin_audit_log
       (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
        changes, before_fields, after_fields, summary, record_count, request_method, request_path)
     VALUES ($1,$2,$3,$4,$5,$6,'donor',$7,$8,$9,$10,$11,1,'SCRIPT','scripts/repair-runs-state.js')`,
    ["al_" + crypto.randomUUID().slice(0, 12), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, donorId,
     JSON.stringify({ state: { from: before.state, to: after.state } }),
     JSON.stringify(before), JSON.stringify(after), summary]);
}

async function repair(pool, org, apply) {
  console.log(apply ? "MODE: APPLY (one transaction)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
  const client = await pool.connect();
  try {
    if (apply) await client.query("BEGIN");
    const rows = await plan(client, org);
    const byOrg = new Map();
    for (const r of rows) { if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, []); byOrg.get(r.orgId).push(r); }
    let restored = 0;
    const forJonathan = [];
    for (const [orgId, list] of byOrg) {
      const todo = list.filter(r => r.kind === "restore");
      if (!todo.length && !list.some(r => r.kind !== "already_repaired")) continue;
      console.log(`${orgId}: ${todo.length} to restore`);
      for (const r of todo) {
        console.log(`  ${r.donorId}  now runs, restore to ${show(r.restoreTo)}`);
        if (apply) {
          const u = await client.query(
            "UPDATE donors SET state = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 AND lower(btrim(state)) = 'runs'",
            [r.restoreTo, r.donorId, orgId]);
          if (u.rowCount !== 1) throw new Error(`${r.donorId} changed while the repair ran; nothing was written`);
          await auditRow(client, { orgId, donorId: r.donorId, action: ACTION,
            before: { state: r.nowState }, after: { state: r.restoreTo },
            summary: `Put back the postal state the Agent overwrote with "runs" (${show(r.restoreTo)}).` });
          restored++;
        }
      }
      for (const r of list) if (r.kind === "changed_after" || r.kind === "no_before_value" || r.kind === "no_agent_write") forJonathan.push(r);
    }
    if (forJonathan.length) {
      console.log("\nLEFT ALONE, for a person to decide:");
      for (const r of forJonathan) {
        const why = r.kind === "changed_after" ? `changed after the Agent's write; it now reads ${show(r.nowState)}`
          : r.kind === "no_before_value" ? "reads runs, and the ledger has no earlier value"
          : "reads runs, and no Agent write explains it";
        console.log(`  ${r.orgId}  ${r.donorId}  ${why}`);
      }
    }
    const total = rows.filter(r => r.kind === "restore").length;
    if (!total && !forJonathan.length) console.log("Nothing to repair: no postal state reads runs because of an Agent write.");
    else console.log(`\n${total} to restore across ${new Set(rows.filter(r => r.kind === "restore").map(r => r.orgId)).size} org(s); ${forJonathan.length} left alone.`);
    if (apply) { await client.query("COMMIT"); console.log(`Restored ${restored}. Each has an audit row on the person's History. --undo reverses them.`); }
  } catch (e) {
    if (apply) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

// Reverse every --apply restore that is still in place and not already undone.
async function undo(pool, org) {
  console.log("MODE: UNDO (one transaction)\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT DISTINCT ON (org_id, entity_id) org_id, entity_id, action, before_fields, after_fields
         FROM fin_audit_log
        WHERE action IN ($1, $2) ${org ? "AND org_id = $3" : ""}
        ORDER BY org_id, entity_id, created_at DESC, id DESC`, org ? [ACTION, UNDO_ACTION, org] : [ACTION, UNDO_ACTION])).rows
      .filter(r => r.action === ACTION);
    let n = 0;
    for (const r of rows) {
      const to = r.after_fields && r.after_fields.state, back = r.before_fields && r.before_fields.state;
      const u = await client.query(
        "UPDATE donors SET state = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 AND state IS NOT DISTINCT FROM $4",
        [back, r.entity_id, r.org_id, to]);
      if (u.rowCount !== 1) { console.log(`  ${r.org_id}  ${r.entity_id}  changed since the repair; left alone`); continue; }
      await auditRow(client, { orgId: r.org_id, donorId: r.entity_id, action: UNDO_ACTION,
        before: { state: to }, after: { state: back }, summary: "Undid the postal-state repair." });
      console.log(`  ${r.org_id}  ${r.entity_id}  back to ${show(back)}`);
      n++;
    }
    await client.query("COMMIT");
    console.log(`Undid ${n}.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

module.exports = { decide };
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
