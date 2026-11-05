// SPLIT-2: moved VERBATIM from db.js (the query helpers). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { pool, LIMITS, once } = require("./pool");

// SPLIT-2 db.js piece 14

// FIX-52 · AN AMBIENT TRANSACTION. Inside withAmbientTransaction(fn), every
// query() and run() (recordGift's included, unchanged) goes to one client
// inside BEGIN/COMMIT, so a spreadsheet import either lands whole or not at
// all. When fn ends the scope closes: anything still holding the scope after
// that (a fire-and-forget) goes back to the pool. queryOutside/runOutside
// write past it, for progress a reader must see before the commit.
const { AsyncLocalStorage } = require("async_hooks");
// SPLIT-2 end
// SPLIT-2 db.js piece 15
const ambientTx = new AsyncLocalStorage();
// SPLIT-2 end
// SPLIT-2 db.js piece 16
function ambient() { const st = ambientTx.getStore(); return st && st.open ? st.client : null; }
// SPLIT-2 end
// SPLIT-2 db.js piece 17
// FIX-55 · A ROUND TRIP AS PROD PAYS IT. On prod every statement crosses the
// network to the database (about 17 ms on 27 Oct); on the scratch stack it is
// free, so a preview that asks one question per person looked fast here. With
// TEST_MODE and TEST_DB_LATENCY_MS set, each query/run waits that long first,
// and the preview budgets in tests/perf-app.spec.js are measured that way.
const TEST_LATENCY_MS = process.env.TEST_MODE === "1" ? Math.max(0, Number(process.env.TEST_DB_LATENCY_MS) || 0) : 0;
// SPLIT-2 end
// SPLIT-2 db.js piece 18
const roundTrip = () => (TEST_LATENCY_MS ? new Promise(r => setTimeout(r, TEST_LATENCY_MS)) : null);
// SPLIT-2 end
// SPLIT-2 db.js piece 19
// FIX-55: how many statements one piece of work sent (TEST_MODE only), so a
// budget can charge each one prod's round trip on a stack where they are free.
const tripCount = new AsyncLocalStorage();
// SPLIT-2 end
// SPLIT-2 db.js piece 20
function countRoundTrips(fn) {
  if (process.env.TEST_MODE !== "1") return fn().then(result => ({ result, trips: null }));
  const st = { n: 0 };
  return tripCount.run(st, fn).then(result => ({ result, trips: st.n }));
}
// SPLIT-2 end
// SPLIT-2 db.js piece 21
const noteTrip = () => { const st = tripCount.getStore(); if (st) st.n++; };
// SPLIT-2 end
// SPLIT-2 db.js piece 22
async function withAmbientTransaction(fn) {
  const client = await LIMITS.checkout(pool);
  const st = { client, open: true };
  try {
    await client.query("BEGIN");
    const result = await ambientTx.run(st, fn);
    st.open = false;
    await client.query("COMMIT");
    return result;
  } catch (e) {
    st.open = false;
    await client.query("ROLLBACK").catch(() => {});
    throw LIMITS.translate(e);
  } finally {
    st.open = false;
    LIMITS.release(client);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 23
// IMPORT-7: the progress and job writes outside the transaction cross the network too
async function queryOutside(sql, params = []) {
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  return (await once(pool, sql.replace(/\?/g, () => `$${++i}`), params)).rows;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 24
async function runOutside(sql, params = []) {
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  return { changes: (await once(pool, sql.replace(/\?/g, () => `$${++i}`), params)).rowCount };
}
// SPLIT-2 end
// SPLIT-2 db.js piece 25

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ... positional params
async function query(sql, params = []) {
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const tx = ambient();
  if (!tx) return (await once(pool, pgSql, params)).rows;
  LIMITS.guard();
  try { return (await tx.query(pgSql, params)).rows; } catch (e) { throw LIMITS.translate(e); }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 26

async function run(sql, params = []) {
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const tx = ambient();
  if (!tx) return { changes: (await once(pool, pgSql, params)).rowCount };
  LIMITS.guard();
  try { return { changes: (await tx.query(pgSql, params)).rowCount }; } catch (e) { throw LIMITS.translate(e); }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 27

// Transaction helper — acquire a dedicated client, run fn(client) inside BEGIN/COMMIT
// AGENT-2: a client with NO transaction: each statement commits on its own.
// The Agent's run writes through the same routes the screens use, which run on
// the pool; holding a transaction open around them would lock the rows those
// routes then wait for.
async function withClient(fn) {
  const client = await LIMITS.checkout(pool);
  try { return await fn(client); } catch (e) { throw LIMITS.translate(e); } finally { LIMITS.release(client); }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 28

// LOAD-1: a client-shaped handle (for queryTx/runTx) that takes a connection per statement, for code that
// must not hold one while it waits on something else, as the Agent's run waits on the screens' own routes.
function onThePool(fn) {
  return fn({ query: (text, params) => once(pool, text, params) });
}
// SPLIT-2 end
// SPLIT-2 db.js piece 29

async function withTransaction(fn) {
  const client = await LIMITS.checkout(pool);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw LIMITS.translate(e);
  } finally {
    LIMITS.release(client);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 30

// BUILD-27 Part C — serialize a critical section per key across concurrent
// requests using a Postgres SESSION-level advisory lock on a DEDICATED pooled
// client (acquire + release MUST be the same session). Different keys proceed in
// parallel; the same key serializes. Used to make check-then-insert dedup
// (parallel imports, the webhook donor resolve-or-create) race-safe WITHOUT a hard
// unique constraint — donor emails are legitimately non-unique in this product
// (the duplicate-merge tool exists precisely for that), so a UNIQUE(email) is the
// wrong primitive; an advisory lock closes the race without forbidding dupes or
// risking boot failure on already-duplicated data.
async function withAdvisoryLock(key, fn) {
  const client = await LIMITS.checkout(pool);
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [String(key)]);
    return await fn();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]); } catch {}
    LIMITS.release(client);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 31

// FIX-34 · NEVER TWO RUNS AT ONCE. Like withAdvisoryLock, but it does not
// wait: when another run (this instance or another one on the same database)
// holds the key, fn is not called and { skipped: true } comes back.
async function withTryAdvisoryLock(key, fn) {
  const client = await LIMITS.checkout(pool);
  let got = false;
  try {
    const r = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [String(key)]);
    got = r.rows[0] && r.rows[0].ok === true;
    if (!got) return { skipped: true };
    return await fn();
  } finally {
    if (got) { try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]); } catch {} }
    LIMITS.release(client);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 32

// Like query() / run() but bound to a specific pg client (for use inside withTransaction)
function queryTx(client, sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => r.rows);
}
// SPLIT-2 end
// SPLIT-2 db.js piece 33
function runTx(client, sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => ({ changes: r.rowCount }));
}
// SPLIT-2 end

module.exports = { countRoundTrips, withAmbientTransaction, queryOutside, runOutside, query, run, withClient, onThePool, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx };
