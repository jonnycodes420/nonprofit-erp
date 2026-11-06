// SPLIT-2: db.js is split by concern under server/db/ (the pool and request limits,
// the query helpers, the boot DDL, the seed). It keeps getDb and the one export
// list, so no caller changed. Tests read the whole as readSource("db.js").
const { uuid, pools, POOL_MAX, SET_POOL_MAX, APP_NAME, isPoolFull, setPool, querySetwise, pool, requestLimits } = require("./server/db/pool");
const { countedClient, countRoundTrips, withAmbientTransaction, queryOutside, runOutside, query, run, withClient, onThePool, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx } = require("./server/db/query");
const { initSchema } = require("./server/db/schema");
const { backfillLinkedTasks, householdsFromLinks, seedData, seedOrgData } = require("./server/db/seed");

// SPLIT-2 db.js piece 13

// ── FIX-11 Part 1 — THIS CONNECTION BELONGS TO THE APPLICATION ────────────
// Every connection the application takes out of the pool says so, once, when
// it is opened. The audit log's trigger (initSchema, below) refuses UPDATE and
// DELETE on a connection that has said so — which is what makes "no screen and
// no route edits or deletes an audit row" a fact about the database rather than
// a claim about which routes happen to exist today.
//
// THE POLARITY IS DELIBERATE. The alternative — refuse everything, and let the
// one legitimate purge announce itself — also stops the test harness and every
// maintenance script from clearing a scratch database, which is twenty
// teardowns' worth of churn for no extra safety: a direct psql session can
// drop the trigger either way. What matters is that the APPLICATION cannot
// touch history, and that is what this enforces.
//
// FIX-12: no application path deletes an audit row within seven years. The
// `steward.audit_purge` flag reaches only rows older than that, and closing an
// organisation's account (routes/billing.js) leaves its audit rows in place.
async function getDb() {
  const ranInit = await initSchema();
  // The demo seed must never take the API down: schema is required to serve,
  // org_creo's demo sugar is not. A seed failure logs CRITICAL and the server
  // boots anyway (found live 2026-08-05: a seed 23505 crash-looped boot).
  const seed = seedData().catch(err => console.error("[seed] CRITICAL: demo seed failed (server continues):", err.message));
  // FIX-20 Part 10: when the schema hash is unchanged the seed has already
  // run against this database, so the server opens at once and the seed
  // re-checks in the background (on prod it took ~30s of every deploy). A new
  // or changed schema still waits for it, so a fresh database never serves
  // before its fixture rows exist.
  if (ranInit) await seed;
  return pool;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 55

module.exports = { poolStats: () => pools.stats(pool), requestLimits, isPoolFull, POOL_MAX, SET_POOL_MAX, APP_NAME, setPool, countedClient, countRoundTrips, withClient, onThePool, getDb, query, querySetwise, run, withAmbientTransaction, queryOutside, runOutside, uuid, seedOrgData, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx, backfillLinkedTasks,
  householdsFromLinks: (orgId = null) => householdsFromLinks(pool, orgId) };
// SPLIT-2 end
