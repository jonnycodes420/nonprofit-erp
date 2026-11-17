// server/smartMoves/marks.js · SCALE-5. WHICH ORGS CHANGED SINCE THE LAST PASS.
//
// Smart moves (the automatic Lapsed, and back to Stewardship on a pledge or a
// giving unit's gift) read donors, gifts, opportunities, moves, pledges,
// pledge instalments and relationships. Steward already records every write
// to a table that carries org_id, by any door, in org_changes (orgSummary.js:
// a statement trigger, in the writer's own transaction, stamped with its
// transaction id). So "did this org change since the last pass" is read from
// there, not from a second list of doors that someone must remember to extend.
//
// THE MARK. Each tick takes the oldest transaction still open when it starts
// (pg_snapshot_xmin) and keeps it. The next tick asks, per org, for a change
// row with xid at or above the kept mark: a write that was still open when
// the last tick began is at or above it, so it is never missed (a sequence
// number would be: ids are handed out before commit). A change can be seen
// twice; a second pass that finds nothing moves nobody.
//
// Housekeeping (orgSummary.housekeep) deletes change rows below an org's floor.
// When an org's floor rose past the kept mark, rows we had not read may be
// gone, so that org counts as changed.
//
// Tables (additive, built at boot with lock_timeout and a retry; no org_id
// column, so writing them is not itself a change in org_changes):
//   smart_move_state   k = 'tick': the kept mark
//   smart_move_sweeps  org_key: the org's last full (nightly) sweep, by its own day
"use strict";

const TABLES = ["donors", "gifts", "opportunities", "moves", "pledges", "pledge_installments", "donor_relationships", "orgs"];
const LOCK_TIMEOUT = "1s";
const RETRIES = 20;

async function withRetry(client, sql) {
  for (let attempt = 1; ; attempt++) {
    try { return await client.query(sql); }
    catch (e) {
      if (e.code !== "55P03" || attempt >= RETRIES) throw e;   // lock_not_available
      await new Promise(r => setTimeout(r, Math.min(3000, 200 * attempt)));
    }
  }
}

async function ensureSmartMoveTables(pool) {
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await withRetry(client, `CREATE TABLE IF NOT EXISTS smart_move_state (
        k TEXT PRIMARY KEY, mark XID8 NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await withRetry(client, `CREATE TABLE IF NOT EXISTS smart_move_sweeps (
        org_key TEXT PRIMARY KEY, swept_on TEXT NOT NULL, swept_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    return { ok: true };
  } finally {
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
}

// The mark to keep for the next tick: taken BEFORE this tick reads anything.
async function markNow(query) {
  const [r] = await query(`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS m`);
  return r.m;
}
async function keptMark(query, k = "tick") {
  const [r] = await query(`SELECT mark::text AS m FROM smart_move_state WHERE k = ?`, [k]);
  return r ? r.m : null;
}
async function keepMark(run, mark, k = "tick") {
  await run(`INSERT INTO smart_move_state (k, mark, at) VALUES (?, ?::xid8, NOW())
             ON CONFLICT (k) DO UPDATE SET mark = EXCLUDED.mark, at = NOW()`, [k, mark]);
}
// Of `orgIds`, those with a change to a table smart moves read since `mark`.
// One statement; each org is an index probe on org_changes (org_key, xid).
async function changedSince(query, orgIds, mark) {
  if (!orgIds.length) return [];
  const rows = await query(
    `SELECT k AS org_id FROM unnest(?::text[]) AS k
      WHERE EXISTS (SELECT 1 FROM org_changes c WHERE c.org_key = k AND c.xid >= ?::xid8 AND c.tbl = ANY(?::text[]))
         OR EXISTS (SELECT 1 FROM org_changes_floor f WHERE f.org_key = k AND f.xid > ?::xid8)
      ORDER BY k`, [orgIds, mark, TABLES, mark]);
  return rows.map(r => r.org_id);
}

module.exports = { ensureSmartMoveTables, markNow, keptMark, keepMark, changedSince, TABLES };
