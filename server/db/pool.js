// SPLIT-2: moved VERBATIM from db.js (the pool and the request limits). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.

// SPLIT-2 db.js piece 1
require("dotenv").config();
// SPLIT-2 end
// SPLIT-2 db.js piece 2
const { Pool } = require("pg");
// SPLIT-2 end
// SPLIT-2 db.js piece 3
const { randomUUID: uuid } = require("crypto");
// SPLIT-2 end
// SPLIT-2 db.js piece 4
const bcrypt = require("bcryptjs");
// SPLIT-2 end
// SPLIT-2 db.js piece 5
const orgTime = require("../../orgTime"); // BUILD-75 A.5 — seed dates are CIVIL dates in the default org timezone, never UTC slices of the process clock
// SPLIT-2 end
// SPLIT-2 db.js piece 6
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// SPLIT-2 end
// SPLIT-2 db.js piece 7

// POOL-1: the per-process connection budget and the set-wise pool (server/shared/pools.js).
const pools = require("../shared/pools");
// SPLIT-2 end
// SPLIT-2 db.js piece 8
const { POOL_MAX, SET_POOL_MAX, APP_NAME, isPoolFull, setPool, querySetwise } = pools;
// SPLIT-2 end
// SPLIT-2 db.js piece 9
const pool = new Pool({
  // Default keeps prod behavior (Supabase requires SSL). DB_SSL=disable turns it
  // off for a plain, non-SSL Postgres — the stock image CI uses (BUILD-38 Part 2).
  // REDTEAM-2: with PGSSLROOTCERT_PEM/_PATH set, the server's certificate is checked (server/shared/dbTls.js).
  ...require("../shared/dbTls").poolTls(),
  // FIX-11 Part 1 — see the note below `getDb`. Set as a STARTUP option rather
  // than from a `connect` listener: a listener issues its SET while pg is still
  // finishing the handshake on that client, which pg rightly warns about and
  // which would leave the odd connection unmarked. A startup option is applied
  // by the server before the connection is handed over, every time.
  options: `-c steward.app_connection=on -c application_name=${APP_NAME}`,
  // SCALE-1: pg's default of 10 connections was busy 10 of 10 for the whole
  // 20-user load run. Raise it per process with DB_POOL_MAX only as far as the
  // database's own connection limit allows across every replica and the worker.
  max: POOL_MAX,
});
// SPLIT-2 end
// SPLIT-2 db.js piece 10
// LOAD-1: every connection handed out below goes through LIMITS.checkout, so a web request's
// statements stop at its limit and an abandoned read is cancelled (server/shared/requestLimits.js).
const LIMITS = require("../shared/requestLimits");
const LANE = require("../shared/reportLane");   // REPORTS-SPEED-2
// SPLIT-2 end
// SPLIT-2 db.js piece 11
const requestLimits = () => LIMITS.middleware(LIMITS.cancelWith(Pool, { ...require("../shared/dbTls").poolTls(), options: `-c steward.app_connection=on -c application_name=${APP_NAME}` }));
// SPLIT-2 end
// SPLIT-2 db.js piece 12
// One statement on its own connection, the way pool.query did it.
async function once(p, text, params) {
  // REPORTS-SPEED-2: a report's statement first takes a place in the report
  // lane (server/shared/reportLane.js), so reports never hold more than a
  // third of the main pool between them.
  if (p === pool && LANE.inLane()) return LANE.run(() => onceNow(p, text, params));
  return onceNow(p, text, params);
}
async function onceNow(p, text, params) {
  const client = await LIMITS.checkout(p);
  try { return await client.query(text, params); } catch (e) { throw LIMITS.translate(e); } finally { LIMITS.release(client); }
}
// REPORTS-SPEED-2: one big read with JIT off for it alone. A statement with
// many aggregates and a high cost estimate (year-over-year's one pass) costs
// Postgres seconds of CPU to JIT-compile where LLVM is built in (the
// postgres:16 image CI and the nightly run: 2.9 s against 0.19 s without it),
// and the read itself is a fraction of that. SET LOCAL ends with the
// transaction, so the connection goes back exactly as it came. In the report
// lane like any other statement.
async function onceNoJit(text, params) {
  const run = async () => {
    const client = await LIMITS.checkout(pool);
    try {
      await client.query("BEGIN; SET LOCAL jit = off");
      const r = await client.query(text, params);
      await client.query("COMMIT");
      return r;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw LIMITS.translate(e); }
    finally { LIMITS.release(client); }
  };
  return LANE.inLane() ? LANE.run(run) : run();
}
// SPLIT-2 end

module.exports = { Pool, uuid, bcrypt, orgTime, newId, pools, POOL_MAX, SET_POOL_MAX, APP_NAME, isPoolFull, setPool, querySetwise, pool, LIMITS, requestLimits, once, onceNoJit };
