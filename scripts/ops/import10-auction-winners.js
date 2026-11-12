#!/usr/bin/env node
// IMPORT-10 item 7 · IMPORTED AUCTION PURCHASES THAT LEFT THEIR ITEMS UNSOLD.
//
// Before IMPORT-10 an auction sheet's purchases became paid gifts and placed
// items, but no winner and no winning bid, so the auction page said Raised
// $57,934 beside Won $0, Items sold 0, Items unsold 251, Bidders 0 (Won, Items
// sold and Bidders read bids). The import now records each winner
// (server/events/auctionImport.js recordWinners); this finds the items
// imported before it: placed by an import (import_id), paid by a gift that
// still exists, with no bid at all.
// Only org ids, auction ids and counts are printed, never names.
//
// DRY RUN BY DEFAULT. --apply records each winner exactly as the import now
// does (the gift's donor as a bidder, a winning bid of what the gift paid),
// tagged with the item's own import, so Undo of that import removes them with
// it; one audit row per org (actor system:scripts/ops/import10-auction-winners).
// --undo=<audit id> removes the bids and the bidders that run made.
// A second run changes nothing (an item with a bid is skipped).
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import10-auction-winners.js            # dry run
//   DATABASE_URL=… node scripts/ops/import10-auction-winners.js --apply
//   DATABASE_URL=… node scripts/ops/import10-auction-winners.js --undo=al_…
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const { recordWinners } = require("../../server/events/auctionImport");
const { newId } = require("../../server/shared/newId");

const ACTOR = { id: "system:scripts/ops/import10-auction-winners", name: "Fix: imported auction purchases recorded as won", kind: "system" };
const PATH = "scripts/ops/import10-auction-winners.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LIST_SQL = `
  SELECT i.org_id, i.auction_id, i.import_id, i.id AS item_id, i.paid_gift_id AS gift_id, ROUND(g.amount * 100)::bigint AS cents
    FROM auction_items i
    JOIN gifts g ON g.id = i.paid_gift_id AND g.org_id = i.org_id
   WHERE i.import_id IS NOT NULL AND i.retired_at IS NULL
     AND ($1::text IS NULL OR i.org_id = $1) AND i.org_id <> 'org_creo'
     AND NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.item_id = i.id)
   ORDER BY i.org_id, i.auction_id, i.import_id, i.position, i.id`;

// db.js-style `?` placeholders on a pg client
const qmark = sql => { let n = 0; return sql.replace(/\?/g, () => "$" + (++n)); };
const adapters = client => ({
  query: async (sql, params) => (await client.query(qmark(sql), params)).rows,
  run: async (sql, params) => client.query(qmark(sql), params),
  newId,
});

async function list(client, orgArg) {
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const byOrg = new Map();
  for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
  return byOrg;
}

async function apply(client, orgId, rows) {
  await client.query("BEGIN");
  try {
    const A = adapters(client);
    const groups = new Map();
    for (const r of rows) { const k = `${r.auction_id}|${r.import_id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const mine = async t => new Set((await client.query(`SELECT id FROM ${t} WHERE org_id=$1 AND created_by=$2`, [orgId, ACTOR.id])).rows.map(r => r.id));
    const bidsBefore = await mine("auction_bids"), biddersBefore = await mine("auction_bidders");
    const before = (await client.query(`SELECT COUNT(*)::int n FROM auction_bids WHERE org_id=$1`, [orgId])).rows[0].n;
    let won = 0;
    for (const [k, list] of groups) {
      const [auctionId, importId] = k.split("|");
      won += await recordWinners(A, orgId, auctionId, { importId, who: ACTOR,
        placedItems: list.map(r => ({ itemId: r.item_id, giftId: r.gift_id, cents: Number(r.cents) })) });
    }
    const bids = [...await mine("auction_bids")].filter(id => !bidsBefore.has(id));
    const bidders = [...await mine("auction_bidders")].filter(id => !biddersBefore.has(id));
    const auditId = rid("al_");
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'auction winners recorded','auction_items',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
      [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ bids, bidders, items: rows.map(r => r.item_id) }),
       JSON.stringify({ bids: before }), JSON.stringify({ bids: before + won }),
       `${won} imported auction purchases recorded as won by their buyers`, won, PATH]);
    await client.query("COMMIT");
    return { auditId, count: won };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'auction winners recorded'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    const gone = (await client.query(`DELETE FROM auction_bids WHERE org_id=$1 AND id = ANY($2) AND created_by=$3 RETURNING id`, [a.org_id, ch.bids || [], ACTOR.id])).rowCount;
    await client.query(`DELETE FROM auction_bidders bd WHERE bd.org_id=$1 AND bd.id = ANY($2) AND bd.created_by=$3
                          AND NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.bidder_id = bd.id)`, [a.org_id, ch.bidders || [], ACTOR.id]);
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'auction winners removed','auction_items',NULL,$6,'{}'::jsonb,'{}'::jsonb,$7,$8,'SCRIPT',$9)`,
      [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ undoes: auditId }), `${gone} recorded winning bids removed: the script's run ${auditId} undone`, gone, PATH]);
    await client.query("COMMIT");
    return { orgId: a.org_id, count: gone };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main(argv = process.argv) {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = argv.includes("--apply");
  const undoId = (argv.find(a => a.startsWith("--undo=")) || "").slice(7) || null;
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  if (orgArg === "org_creo") throw new Error("org_creo is never touched.");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (undoId) { const r = await undo(client, undoId); console.log(`${r.orgId}: ${r.count} winning bids removed.`); return; }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    const byOrg = await list(client, orgArg);
    let total = 0;
    for (const [orgId, rows] of byOrg) {
      const auctions = new Set(rows.map(r => r.auction_id)).size;
      if (!APPLY) { console.log(`${orgId}: ${rows.length} imported purchases with no winner, in ${auctions} ${auctions === 1 ? "auction" : "auctions"}`); total += rows.length; continue; }
      const r = await apply(client, orgId, rows);
      console.log(`${orgId}: ${r.count} recorded as won (audit ${r.auditId}; undo with --undo=${r.auditId})`);
      total += r.count;
    }
    console.log(`\n${total} ${total === 1 ? "purchase" : "purchases"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "recorded as won" : "would be recorded as won"}.`);
  } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL, main };
