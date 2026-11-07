// tests/lib/importHold.js · FLAKE-2. HOLD AN IMPORT'S RECENT-GIFT WORK AT ITS
// FIRST STEP, SO A SUITE SEES IT PART WAY THROUGH EVERY TIME.
//
// holdImport(importId) takes the advisory lock server/imports/testHold.js waits
// on, from a database session of its own, BEFORE the import is sent. The job
// records its first batch, saves its progress, and waits there until
// release(). The server honours the key only under TEST_MODE.
//
//   const h = await holdImport(run);
//   ...import, read progress (running, done > 0), press Undo...
//   await h.release();
//
// release() is safe to call twice, and close() lets go whatever happened.
"use strict";

const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";

async function holdImport(importId) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  await c.connect();
  const key = `test-hold:import-recent:${importId}`;
  const [{ ok }] = (await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [key])).rows;
  if (!ok) { await c.end(); throw new Error(`importHold: ${key} is already held`); }
  let held = true;
  const release = async () => {
    if (!held) return;
    held = false;
    try { await c.query("SELECT pg_advisory_unlock(hashtext($1))", [key]); } finally { await c.end().catch(() => {}); }
  };
  return { key, release, close: release, get held() { return held; } };
}

module.exports = { holdImport };
