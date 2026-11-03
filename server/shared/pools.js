// POOL-1 · THE DATABASE CONNECTIONS ONE PROCESS MAY OPEN, and the set-wise
// pool (moved here from db.js, which requires this file and re-exports it).
"use strict";
const { Pool } = require("pg");

// POOL-1 · ONE CONNECTION BUDGET PER PROCESS. Prod reaches its database
// through Supabase's pooler in session mode, which holds a fixed number of
// clients across every process (docs/architecture/ARCHITECTURE.md, "The
// connection budget"). A process may open the main pool's DB_POOL_MAX plus
// the set-wise pool's share of it, and during a deploy two webs and the worker
// run at once. On 3 Nov the new web found the pooler full and its boot gave
// up. Every connection says whose it is (application_name), so the pooler's
// own list names the process and the build that holds it.
const POOL_MAX = Math.max(2, Number(process.env.DB_POOL_MAX) || 10);
const SET_POOL_MAX = Math.min(3, Math.max(1, Math.floor(POOL_MAX / 3)));
const PROCESS_NAME = process.env.STEWARD_PROCESS === "worker" ? "steward-worker" : "steward-web";
const SHORT_SHA = (() => {
  let sha = null;
  try { sha = require("fs").readFileSync(require("path").join(__dirname, "../../.build-sha"), "utf8").trim(); } catch { /* no stamp file */ }
  sha = sha || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_SHA || "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : "local";
})();
const APP_NAME = `${PROCESS_NAME}@${SHORT_SHA}`;
// The pooler's answer when it is full (Supavisor's code in the message), and
// Postgres's own. A try that meets one is worth repeating: a deploy's overlap
// ends within a minute and gives its connections back.
const isPoolFull = (e) => !!e && (e.code === "53300" || /EMAXCONNSESSION|max clients reached|too many clients/i.test(String(e.message || "")));

// FIX-21 · SET-WISE READS. A question about a whole set of people (a group's
// members, their gifts, every group's count) is read on its own small pool
// whose connections have nested loops switched off. The planner picks a
// nested loop when its statistics say an org has one row, which is what they
// say about every org that arrived after the last ANALYZE: on a 1,000-member
// group that turned a 20 ms read into 35 seconds. Hash joins cost the same
// whatever the statistics say. Only callers that read sets use this; a
// lookup by id stays on the main pool, where an index nested loop is right.
let _setPool = null;
function setPool() {
  return _setPool || (_setPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false },
    options: `-c steward.app_connection=on -c enable_nestloop=off -c application_name=${APP_NAME}`,
    // POOL-1: out of the same per-process budget (a third of DB_POOL_MAX, one
    // to three), and let go after five minutes idle. Kept open for good, its
    // three were the part of every process's thirteen that never came back.
    // Five minutes still spares most first clicks the fresh TLS connect (1 to
    // 2 seconds on prod) that a one-minute timeout paid. A connection the
    // server drops is reported here and replaced on the next read.
    max: SET_POOL_MAX,
    idleTimeoutMillis: 5 * 60 * 1000,
    allowExitOnIdle: true,
  }));
}
function setPoolReady() {
  const p = setPool();
  if (!p.listenerCount("error")) p.on("error", err => console.error("[db] set-wise pool connection dropped:", err.message));
  return p;
}
async function querySetwise(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await setPoolReady().query(pgSql, params);
  return result.rows;
}

// What /health says about this process's connections, from pg's own counters
// (no query): the main pool passed in, and the set-wise pool (0 open until its
// first read).
function stats(main) {
  return { max: POOL_MAX, total: main.totalCount, idle: main.idleCount, waiting: main.waitingCount,
    set: { max: SET_POOL_MAX, total: _setPool ? _setPool.totalCount : 0 }, name: PROCESS_NAME };
}

module.exports = { POOL_MAX, SET_POOL_MAX, PROCESS_NAME, APP_NAME, isPoolFull, setPool, setPoolReady, querySetwise, stats };
