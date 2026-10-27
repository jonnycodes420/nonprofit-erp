// FIX-51 · MIGRATIONS FINISH BEFORE ANY BOOT JOB RUNS.
//
// On a fresh database the workflow-to-journey conversion ran four seconds
// after listen, while initSchema was still creating tables, and logged
// `relation "workflow_conversions" does not exist`. Every job a module starts
// on a timer at boot goes through afterMigrations: its delay starts only once
// server.js has said the schema is in (markReady, the same moment as
// DB_READY). No requires, so any module can load it.
"use strict";

let markReady = null;
const READY = new Promise(resolve => { markReady = resolve; });

// fn after `ms`, counted from the end of the migrations. Returns nothing: a
// boot job is fire-and-forget, and its own .catch says what went wrong.
function afterMigrations(fn, ms = 0, { unref = false } = {}) {
  READY.then(() => { const t = setTimeout(fn, ms); if (unref && t.unref) t.unref(); });
}
// The same for a repeating job: the first tick is `everyMs` after the migrations.
function everyAfterMigrations(fn, everyMs, { unref = false } = {}) {
  READY.then(() => { const t = setInterval(fn, everyMs); if (unref && t.unref) t.unref(); });
}

module.exports = { READY, markReady: () => markReady(), afterMigrations, everyAfterMigrations };
