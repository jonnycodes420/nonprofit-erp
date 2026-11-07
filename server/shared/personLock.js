// server/shared/personLock.js · RACE-1. ONE WRITER PER PERSON PER KIND OF THING.
//
// withPersonLock(kind, orgId, donorId, fn) runs fn while holding the Postgres
// advisory lock `<kind>:<orgId>:<donorId>`. Two callers for the same person and
// kind take turns; different people run side by side. The lock lives in
// Postgres, so it holds across the web process and the worker.
//
// WHY. FLAKE-2 left a journey race open: two journey starts for one person at
// once (the sweep, and the nudge a staff write sets off 1.2 s later, which
// did not take the sweep's lock) could each read the person's journeys before
// the other wrote. The lower exclusive journey opened its step's Thread after
// the higher one had replaced it, so the higher one's first step found the
// person's one open Thread taken and waited with none. Every journey write for
// a person now happens under this lock (shared/journeyStart.js).
//
// RE-ENTRANT. A start calls the advance inside it; the inner call, already
// holding the key in this async context, runs straight through.
//
// IT DOES NOT SIT ON A POOL CONNECTION WHILE IT WAITS (lockAdvisory in
// server/db/query.js), so ten callers queued on one person cannot starve the
// holder of the connections its own queries need.
//
// Inside an ambient transaction (an import, FIX-52) the lock is a transaction
// lock on that transaction's own connection, held until it commits, so a
// second writer cannot read the person before the import's rows are visible.
"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const held = new AsyncLocalStorage();
const GIVE_UP_MS = 60000;      // a lock held this long is a bug; say so, never hang

async function withPersonLock(kind, orgId, donorId, fn) {
  const key = `${kind}:${orgId}:${donorId}`;
  const mine = held.getStore();
  if (mine && mine.has(key)) return fn();
  const next = new Set(mine || []);
  next.add(key);
  const Q = require("../db/query");
  if (Q.inAmbientTransaction()) {
    await Q.query("SELECT pg_advisory_xact_lock(hashtext(?))", [key]);
    return held.run(next, fn);
  }
  const client = await Q.lockAdvisory(key, { giveUpMs: GIVE_UP_MS });
  try { return await held.run(next, fn); } finally { await Q.unlockAdvisory(client, key); }
}

module.exports = { withPersonLock };
