#!/usr/bin/env node
// MOPUP-1 item 1 · OLD WHOLE-AWARD INCOME ROWS, TAKEN OFF THE LEDGER.
//
// Before GRANTS-FIX, moving a grant into Awarded (POST /grants created
// Awarded, or the edit's PUT /grants/:id) wrote the whole award to the ledger
// as income: one fin_transactions row, source='grant', grant_id set, no
// gift_id (the old stampGrantAward). Since GIFTS-1 the payments recorded on
// the award are the income, each through recordGift, so a payment on such a
// grant counts the money twice: a $15,000 award stamp plus a $10,000 payment
// reads $25,000 of income where $10,000 came in.
//
// An award is a pledge, and an ordinary pledge writes nothing to the ledger
// (pledgeWrite.js has no fin_transactions write; LEDGER-2). So --apply
// removes each stamp. Every row it removes is kept whole in ONE audit row per
// org (fin_audit_log, before_fields.rows), and --undo=<audit id> puts those
// rows back exactly as they were.
//
// Touches only source='grant' rows with no gift_id. A row with a gift_id is a
// gift's own booking and is never read for change; a treasurer's manual row
// adopted as an award (source='manual', grant_id set) is never touched.
// Skips sample rows, org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo). Prints org ids, counts and totals
// only, never a name. A second --apply finds nothing and changes nothing.
//
// Usage:
//   node scripts/ops/mopup1-award-stamps.js                            # dry run, every org
//   node scripts/ops/mopup1-award-stamps.js --org=<org_id>             # one org
//   node scripts/ops/mopup1-award-stamps.js --apply [--i-know-this-is-prod]
//   node scripts/ops/mopup1-award-stamps.js --undo=<audit id> [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/mopup1-award-stamps", name: "Fix: old whole-award income rows taken off the ledger", kind: "system" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];
const SCRIPT = "scripts/ops/mopup1-award-stamps.js";

const c = v => Math.round((Number(v) || 0) * 100);
const usd = n => "$" + (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The old award stamps, per org: count and total. Ids only.
async function stampsByOrg(client, orgId = null) {
  const { rows } = await client.query(
    `SELECT org_id, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
       FROM fin_transactions
      WHERE source = 'grant' AND gift_id IS NULL AND is_sample IS NOT TRUE
        AND NOT (org_id = ANY($1::text[])) AND ($2::text IS NULL OR org_id = $2)
      GROUP BY org_id ORDER BY org_id`, [SKIP_ORGS, orgId]);
  return rows.map(r => ({ orgId: r.org_id, count: r.n, cents: c(r.total) }));
}

async function audit(client, orgId, action, ids, before, after, summary) {
  const id = "al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await client.query(
    `INSERT INTO fin_audit_log
       (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
        changes, before_fields, after_fields, summary, record_count, request_method, request_path)
     VALUES ($1,$2,$3,$4,$5,$6,'transaction',NULL,$7,$8,$9,$10,$11,'SCRIPT',$12)`,
    [id, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, JSON.stringify({ ids }),
     JSON.stringify(before), JSON.stringify(after), summary, ids.length, SCRIPT]);
  return id;
}

async function run({ client, apply = false, orgId = null, log = console.log }) {
  const out = { orgs: [], removed: 0, removedCents: 0, audits: [] };
  const list = await stampsByOrg(client, orgId);
  if (!list.length) log("No old award income rows. Nothing to change.");
  for (const o of list) {
    log(`  ${o.orgId}: ${o.count} row(s), ${usd(o.cents)}${apply ? "" : " (would be removed)"}`);
    out.orgs.push(o);
    if (!apply) continue;
    await client.query("BEGIN");
    try {
      // Locked and re-read inside the transaction; the WHERE is the same one.
      const { rows } = await client.query(
        `SELECT * FROM fin_transactions
          WHERE org_id = $1 AND source = 'grant' AND gift_id IS NULL AND is_sample IS NOT TRUE
          ORDER BY id FOR UPDATE`, [o.orgId]);
      const ids = rows.map(r => r.id);
      const cents = rows.reduce((s, r) => s + c(r.amount), 0);
      await client.query(`DELETE FROM fin_transactions WHERE org_id = $1 AND id = ANY($2::text[]) AND gift_id IS NULL`, [o.orgId, ids]);
      const aid = await audit(client, o.orgId, "deleted", ids, { rows }, {},
        `Took ${ids.length} whole-award income row(s) (${usd(cents)}) off the ledger: an award is a pledge, and its payments are the income. Undo: node ${SCRIPT} --undo=<this audit id>.`);
      await client.query("COMMIT");
      log(`    removed ${ids.length}, audit ${aid}`);
      out.removed += ids.length; out.removedCents += cents; out.audits.push(aid);
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  }
  const n = out.orgs.reduce((s, o) => s + o.count, 0), t = out.orgs.reduce((s, o) => s + o.cents, 0);
  log(`\n${out.orgs.length} org(s), ${n} row(s), ${usd(t)} ${apply ? "removed" : "would be removed"}.`);
  return out;
}

// Puts back exactly the rows one --apply audit row removed.
async function undo({ client, auditId, log = console.log }) {
  const { rows: [a] } = await client.query(
    `SELECT org_id, before_fields FROM fin_audit_log WHERE id = $1 AND request_path = $2 AND action = 'deleted'`, [auditId, SCRIPT]);
  if (!a) throw new Error(`No ${SCRIPT} removal with audit id ${auditId}`);
  const rows = (a.before_fields && a.before_fields.rows) || [];
  await client.query("BEGIN");
  try {
    const ins = await client.query(
      `INSERT INTO fin_transactions SELECT * FROM jsonb_populate_recordset(NULL::fin_transactions, $1::jsonb)
       ON CONFLICT DO NOTHING RETURNING id`, [JSON.stringify(rows)]);
    const ids = ins.rows.map(r => r.id);
    await audit(client, a.org_id, "restored", ids, {}, { from_audit: auditId },
      `Put back ${ids.length} whole-award income row(s) removed by ${SCRIPT} (audit ${auditId}).`);
    await client.query("COMMIT");
    log(`${a.org_id}: put back ${ids.length} of ${rows.length} row(s).`);
    return { restored: ids.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const APPLY = process.argv.includes("--apply");
  const undoId = (process.argv.find(a => a.startsWith("--undo=")) || "").slice(7) || null;
  const writes = APPLY || !!undoId;
  const DB_URL = writes ? writerDbUrl() : (process.env.DATABASE_URL || writerDbUrl());
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  let code = 0;
  try {
    if (undoId) { console.log("MODE: UNDO\n"); await undo({ client, auditId: undoId }); }
    else {
      console.log(APPLY ? "MODE: APPLY (removes each old award income row; one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to remove)\n");
      await run({ client, apply: APPLY, orgId: orgArg });
    }
  } catch (e) { console.error(e.message); code = 1; }
  finally { client.release(); await pool.end(); }
  process.exit(code);
}

if (require.main === module) main();
module.exports = { run, undo, stampsByOrg, SKIP_ORGS };
