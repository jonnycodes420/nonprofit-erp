// SPLIT-2: moved VERBATIM from db.js (the query helpers). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { pool, LIMITS, once, onceNoJit } = require("./pool");
const { toQuery } = require("./sql");   // REDTEAM-2

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
    const result = await ambientTx.run(st, () => LIMITS.holding(fn, client));   // PROFILE-SPEED-1: what it asks for besides is nested (requestLimits)
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
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  return (await once(pool, sql.replace(/\?/g, () => `$${++i}`), params)).rows;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 24
async function runOutside(sql, params = []) {
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  return { changes: (await once(pool, sql.replace(/\?/g, () => `$${++i}`), params)).rowCount };
}
// SPLIT-2 end
// PROFILE-SPEED-1: which statements a bundle may answer once. A plain read
// only (SELECT or WITH, nothing that writes, locks or moves a sequence), with
// values that are plain JSON; and a copy per caller, so one route changing its
// rows can never change another's.
const MEMO_MS = 1000;   // how long a bundle shares one statement's answer (query() below)
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;
const NOT_A_PLAIN_READ = /\b(INSERT|UPDATE|DELETE|MERGE|FOR\s+(UPDATE|SHARE|NO\s+KEY|KEY)|nextval|setval|pg_advisory\w*|pg_sleep|random|clock_timestamp|txid_\w+|set_config)\b/i;
function memoKey(text, params) {
  if (!READ_ONLY.test(text) || NOT_A_PLAIN_READ.test(text)) return null;
  try {
    return text + "\u0000" + JSON.stringify(params, (k, v) => {
      if (typeof v === "bigint" || (v && typeof v === "object" && (Buffer.isBuffer(v) || v instanceof Uint8Array))) throw new Error("not plain");
      return v;
    });
  } catch { return null; }
}
const copyRows = list => list.map(r => {
  const o = {};
  for (const k in r) {
    const v = r[k];
    o[k] = v instanceof Date ? new Date(v.getTime()) : Buffer.isBuffer(v) ? Buffer.from(v) : v && typeof v === "object" ? structuredClone(v) : v;
  }
  return o;
});
// SPLIT-2 db.js piece 25

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ... positional params
async function query(sql, params = []) {
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const tx = ambient();
  const memo = !tx && LIMITS.memoFor();   // PROFILE-SPEED-1: inside a bundle, one answer per statement (requestLimits memoize)
  const key = memo && memoKey(pgSql, params);
  if (key) {
    // An answer is shared for MEMO_MS from when it was asked, then the next ask
    // goes to the database. A route that reads again to see a change (the
    // insights store's wait for its build, server/insights/store.js; the
    // outbox's) sees it within that bound. Shared for the whole request, that
    // wait was handed its first answer every 100 ms for 30 s and the profile
    // never drew (stale1, hotfix1-profile, CI 13 Nov).
    let got = memo.get(key);
    if (got && Date.now() - got.at >= MEMO_MS) got = null;
    if (!got) {
      if (TEST_LATENCY_MS) await roundTrip();
      noteTrip();
      const rows = once(pool, pgSql, params).then(r => r.rows);
      const made = { rows, at: Date.now() };
      memo.set(key, made);
      rows.catch(() => { if (memo.get(key) === made) memo.delete(key); });
      got = made;
    }
    return copyRows(await got.rows);
  }
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  if (!tx) return (await once(pool, pgSql, params)).rows;
  LIMITS.guard();
  try { return (await tx.query(pgSql, params)).rows; } catch (e) { throw LIMITS.translate(e); }
}
// REPORTS-SPEED-2: query() for one big read that must not be JIT-compiled
// (server/db/pool.js onceNoJit). Inside an ambient transaction it is query().
async function queryNoJit(sql, params = []) {
  if (ambient()) return query(sql, params);
  [sql, params] = toQuery(sql, params);
  if (TEST_LATENCY_MS) await roundTrip();
  noteTrip();
  let i = 0;
  return (await onceNoJit(sql.replace(/\?/g, () => `$${++i}`), params)).rows;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 26

async function run(sql, params = []) {
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
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
  try { return await LIMITS.holding(() => fn(client), client); } catch (e) { throw LIMITS.translate(e); } finally { LIMITS.release(client); }
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
    const result = await LIMITS.holding(() => fn(client), client);   // PROFILE-SPEED-1
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
// RACE-1 · A WAITER DOES NOT SIT ON A POOL CONNECTION. The pool is 10. Ten
// callers queued on one key each held a connection inside pg_advisory_lock,
// and the holder could not get one for its own queries: ten first gifts of a
// new org at once (ensureOrgLedger's lock) ended in nine statement timeouts.
// A waiter now asks with a short lock_timeout and hands its connection back
// between tries. `giveUpMs` 0 waits as long as it takes, as before.
const LOCK_TRY_MS = 150;
async function lockAdvisory(key, { giveUpMs = 0 } = {}) {
  const deadline = giveUpMs ? Date.now() + giveUpMs : Infinity;
  for (;;) {
    const client = await LIMITS.checkout(pool);
    let got = false;
    try {
      await client.query(`SET lock_timeout = '${LOCK_TRY_MS}ms'`);
      try { await client.query("SELECT pg_advisory_lock(hashtext($1))", [String(key)]); got = true; }
      catch (e) { if (e.code !== "55P03") throw e; }          // lock_not_available: try again
      await client.query("RESET lock_timeout");
    } catch (e) {
      if (got) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]).catch(() => {});
      LIMITS.release(client);
      throw e;
    }
    if (got) return client;
    LIMITS.release(client);
    if (Date.now() > deadline) throw new Error(`advisory lock ${key} not free after ${giveUpMs} ms`);
    await new Promise(r => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
  }
}
async function unlockAdvisory(client, key) {
  try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]); } catch {}
  LIMITS.release(client);
}
async function withAdvisoryLock(key, fn) {
  const client = await lockAdvisory(key);
  try { return await LIMITS.holding(fn, client); } finally { await unlockAdvisory(client, key); }   // PROFILE-SPEED-1
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
    return await LIMITS.holding(fn, client);   // PROFILE-SPEED-1
  } finally {
    if (got) { try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]); } catch {} }
    LIMITS.release(client);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 32

// Like query() / run() but bound to a specific pg client (for use inside withTransaction)
function queryTx(client, sql, params = []) {
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => r.rows);
}
// SPLIT-2 end
// SPLIT-2 db.js piece 33
function runTx(client, sql, params = []) {
  [sql, params] = toQuery(sql, params);   // REDTEAM-2: a Sql brings its own values (server/db/sql.js)
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => ({ changes: r.rowCount }));
}
// SPLIT-2 end

// SPEED-2: a transaction's statements cross the network too. countedClient
// wraps a transaction's client so each statement it sends waits
// TEST_DB_LATENCY_MS and is counted by countRoundTrips (TEST_MODE only; on
// prod it is the same client, untouched). The merge uses it, so the merge's
// budget in tests/perf-app.spec.js charges every statement it sends.
function countedClient(client) {
  if (process.env.TEST_MODE !== "1") return client;
  return { query: async (...a) => { if (TEST_LATENCY_MS) await roundTrip(); noteTrip(); return client.query(...a); } };
}

// RACE-1 · server/shared/personLock.js needs to know whether it is inside an ambient transaction.
function inAmbientTransaction() { return !!ambient(); }
module.exports = { queryNoJit, inAmbientTransaction, lockAdvisory, unlockAdvisory, countedClient, countRoundTrips, withAmbientTransaction, queryOutside, runOutside, query, run, withClient, onThePool, withTransaction, withAdvisoryLock, withTryAdvisoryLock, queryTx, runTx };
