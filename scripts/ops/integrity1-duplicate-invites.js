#!/usr/bin/env node
// INTEGRITY-1 · PENDING INVITES TO ONE ADDRESS, MORE THAN ONCE (W-1107-Atlas-27X).
//
// WALKB-2's guard checked for a waiting invite and then wrote one, so two
// presses at once (and invites from before the guard) left two pending
// invites to one address. INTEGRITY-1 adds the unique index
// invites_one_pending_per_email (server/db/race1Indexes.js), which the boot
// builds only once no address repeats. This script clears the repeats:
// per org and address, every pending invite (not accepted, not revoked) but
// the newest is revoked. Only org ids and counts are printed, never addresses.
//
// DRY RUN BY DEFAULT. --apply revokes them, one transaction and ONE audit row
// per org (actor system:scripts/ops/integrity1-duplicate-invites) naming the
// invites. --undo=<audit id> un-revokes exactly those invites, with its own
// audit row. A second run of either changes nothing. The next boot after
// --apply builds the index.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/integrity1-duplicate-invites.js              # dry run
//   DATABASE_URL=… node scripts/ops/integrity1-duplicate-invites.js --apply      # write
//   DATABASE_URL=… node scripts/ops/integrity1-duplicate-invites.js --undo=al_…  # reverse one org's run
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/integrity1-duplicate-invites", name: "Fix: two pending invites to one address", kind: "system" };
const PATH = "scripts/ops/integrity1-duplicate-invites.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LIST_SQL = `
  SELECT org_id, id FROM (
    SELECT i.org_id, i.id, ROW_NUMBER() OVER (PARTITION BY i.org_id, lower(i.email) ORDER BY i.created_at DESC, i.id DESC) AS k
      FROM invites i
     WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
       AND ($1::text IS NULL OR i.org_id = $1) AND i.org_id <> 'org_creo') x
   WHERE k > 1 ORDER BY org_id, id`;

const audit = (client, orgId, action, changes, summary, n) => client.query(
  `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
   VALUES ($1,$2,$3,$4,$5,$6,'invite',NULL,$7,'{}'::jsonb,'{}'::jsonb,$8,$9,'SCRIPT',$10) RETURNING id`,
  [rid("al_"), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, JSON.stringify(changes), summary, n, PATH]);

async function apply(client, orgId, ids) {
  await client.query("BEGIN");
  try {
    const done = (await client.query(`UPDATE invites SET revoked_at = NOW() WHERE org_id = $1 AND id = ANY($2) AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
      [orgId, ids])).rows.map(r => r.id);
    const { rows: [a] } = await audit(client, orgId, "revoke invite", { invites: done },
      `${done.length} repeated pending invites revoked; the newest to each address stays`, done.length);
    await client.query("COMMIT");
    return { auditId: a.id, count: done.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'revoke invite'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    // the index allows one pending invite per address: a revoked one comes back
    // only while no other invite to its address is pending
    const back = (await client.query(
      `UPDATE invites i SET revoked_at = NULL WHERE i.org_id = $1 AND i.id = ANY($2) AND i.revoked_at IS NOT NULL AND i.accepted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM invites o WHERE o.org_id = i.org_id AND lower(o.email) = lower(i.email) AND o.id <> i.id
                           AND o.accepted_at IS NULL AND o.revoked_at IS NULL)
        RETURNING i.id`, [a.org_id, ch.invites || []])).rows.map(r => r.id);
    if (back.length) await audit(client, a.org_id, "restore invite", { invites: back, undoes: auditId }, `${back.length} invites restored: the script's run ${auditId} undone`, back.length);
    await client.query("COMMIT");
    return { orgId: a.org_id, count: back.length, held: (ch.invites || []).length - back.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main(argv = process.argv) {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = argv.includes("--apply");
  const undoId = (argv.find(x => x.startsWith("--undo=")) || "").slice(7) || null;
  const orgArg = (argv.find(x => x.startsWith("--org=")) || "").slice(6) || null;
  if (orgArg === "org_creo") throw new Error("org_creo is never touched.");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (undoId) {
      const r = await undo(client, undoId);
      console.log(`${r.orgId}: ${r.count} restored${r.held ? ` (${r.held} not: another invite to that address is pending)` : ""}.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    const byOrg = new Map();
    for (const r of (await client.query(LIST_SQL, [orgArg])).rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r.id); }
    let total = 0;
    for (const [orgId, ids] of byOrg) {
      if (!APPLY) { console.log(`${orgId}: ${ids.length}`); total += ids.length; continue; }
      const r = await apply(client, orgId, ids);
      console.log(`${orgId}: ${r.count} revoked (audit ${r.auditId}; undo with --undo=${r.auditId})`);
      total += r.count;
    }
    console.log(`\n${total} repeated pending ${total === 1 ? "invite" : "invites"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "revoked" : "would be revoked"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL };
