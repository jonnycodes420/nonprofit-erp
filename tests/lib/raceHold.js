// tests/lib/raceHold.js · RACE-1. HOLD A WRITE AT A NAMED POINT, AND WATCH WHO
// IS WAITING. The suite side of server/shared/raceHold.js.
//
//   const h = await hold(`journey-open:${donor}:${journeyId}`);   // before the write starts
//   ...start the write; await waitingOn(h.key)...
//   await h.release();
//
// Each hold is a database session of its own. The server honours the key only
// under TEST_MODE. waiters() counts advisory locks not yet granted in THIS
// database only (pg_locks is cluster-wide, and other shards share the cluster).
"use strict";

const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const ssl = () => (process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false });

async function hold(name) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: DB_URL, ssl: ssl() });
  await c.connect();
  const key = `test-hold:${name}`;
  const [{ ok }] = (await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [key])).rows;
  if (!ok) { await c.end(); throw new Error(`raceHold: ${key} is already held`); }
  let held = true;
  const release = async () => {
    if (!held) return;
    held = false;
    try { await c.query("SELECT pg_advisory_unlock(hashtext($1))", [key]); } finally { await c.end().catch(() => {}); }
  };
  return { key, release, get held() { return held; } };
}

// Advisory locks somebody is waiting for in this database; with `key`, only that one.
async function waiters(q, key = null) {
  const rows = await q(
    `SELECT COUNT(*)::int AS n FROM pg_locks l
      WHERE l.locktype = 'advisory' AND NOT l.granted
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        ${key ? "AND l.objsubid = 1 AND l.objid::text::bigint = (hashtext($1)::bigint & 4294967295)" : ""}`,
    key ? [key] : []);
  return rows[0].n;
}

// Wait until `pred()` is true, or `ms` pass. Returns whether it came true.
async function until(pred, ms = 5000, every = 10) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise(r => setTimeout(r, every));
  }
  return !!(await pred());
}

module.exports = { hold, waiters, until };
