// server/finance/qboPause.js · HONEST-4 item 2. QUICKBOOKS PAUSES RATHER THAN PILES UP.
//
// Jarvis, 27 Nov: "0 receipts ever sent, $0 this month, last sent Never, 273 gifts and $261,998.91
// waiting". A sync that fails and is tried again every hour piles failures into Pending and says
// nothing new. So a run in which nothing went and something failed is a failed try; three failed
// tries in a row stop the hourly auto-sync, and the card says "Needs attention: paused after 3 failed
// tries on Nov 25". Only a person pressing Try again (Sync, from the panel) clears the pause. A run
// that sends anything resets the count. Nothing here sends; qboSync.syncGifts calls these.
"use strict";

const PAUSE_AFTER = 3;
const LOCK_TIMEOUT = "1s";
const RETRIES = 20;

let READY = null;
async function ensureColumns(pool) {
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const sql of [
      `ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS sync_fail_streak INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS sync_paused_at TIMESTAMPTZ`]) {
      for (let attempt = 1; ; attempt++) {
        try { await client.query(sql); break; }
        catch (e) {
          if (e.code !== "55P03" || attempt >= RETRIES) throw e;   // lock_not_available
          await new Promise(r => setTimeout(r, Math.min(3000, 200 * attempt)));
        }
      }
    }
    return true;
  } finally {
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
}
function ready() {
  if (!READY) READY = ensureColumns(require("../db/pool").pool).catch(e => { READY = null; throw e; });
  return READY;
}

const isSystem = who => !!who && /^system:/.test(String(who.id || ""));
const monDay = (at, tz = "America/New_York") => { const d = new Date(at); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }); };

// The pause as the card and panel say it, or null.
function pausedOf(conn, tz) {
  if (!conn || !conn.sync_paused_at) return null;
  const n = Math.max(PAUSE_AFTER, Number(conn.sync_fail_streak) || PAUSE_AFTER);
  return { at: new Date(conn.sync_paused_at).toISOString(), tries: n,
    words: `paused after ${n} failed tries on ${monDay(conn.sync_paused_at, tz)}`,
    sentence: `Needs attention: paused after ${n} failed tries on ${monDay(conn.sync_paused_at, tz)}. Nothing is tried again until someone presses Try again.` };
}

// Before a run: the hourly auto-sync never runs over a pause; a person's press clears it.
async function beforeRun({ query, run }, conn, who) {
  await ready();
  const [row] = await query(`SELECT sync_paused_at, sync_fail_streak FROM bookkeeping_connections WHERE id=?`, [conn.id]);
  if (!row || !row.sync_paused_at) return { ok: true };
  if (isSystem(who)) return { ok: false, paused: pausedOf(row) };
  await run(`UPDATE bookkeeping_connections SET sync_paused_at=NULL, sync_fail_streak=0, updated_at=NOW() WHERE id=?`, [conn.id]);
  return { ok: true, resumed: true };
}

// After a run: count the try. `results` are syncGifts' per-gift outcomes; `threw` a run that stopped.
async function afterRun({ run }, conn, { results = [], threw = false } = {}) {
  await ready();
  const sent = results.some(r => r.status === "synced" || r.status === "already");
  const failed = threw || (results.length > 0 && results.every(r => r.status === "failed"));
  if (sent) return run(`UPDATE bookkeeping_connections SET sync_fail_streak=0 WHERE id=?`, [conn.id]);
  if (!failed) return null;
  return run(
    `UPDATE bookkeeping_connections SET sync_fail_streak = sync_fail_streak + 1,
            sync_paused_at = CASE WHEN sync_fail_streak + 1 >= ? THEN COALESCE(sync_paused_at, NOW()) ELSE sync_paused_at END
      WHERE id=?`, [PAUSE_AFTER, conn.id]);
}

module.exports = { PAUSE_AFTER, beforeRun, afterRun, pausedOf, ready, isSystem };
