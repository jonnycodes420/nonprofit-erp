// middleware/analyzeAfterImport.js · PARITY-3 Part 6b. AN IMPORT ENDS WITH ANALYZE.
//
// Postgres plans a query from statistics it gathers by sampling a table, and
// it gathers them on its own schedule (autovacuum), not when a file lands. On
// a freshly imported or seeded database it has none, guesses that each table
// holds one row, and picks a nested loop that re-runs the giving-level
// aggregate once per gift. Harborlight's Mid group page took 31.8 seconds that
// way and 0.13 seconds after one ANALYZE.
//
// So every import write that succeeds is followed by ANALYZE on the tables an
// import touches. One seam, mounted beside the audit write, so an import route
// added tomorrow is covered without its author doing anything. A preview, an
// undo and a failed import write nothing worth re-planning, and are skipped.
// db is required when the first ANALYZE runs, not at load, so the demo seed
// can read TABLES without opening the server's pool.

const TABLES = ["donors", "gifts", "interactions", "donor_scores", "volunteer_shifts",
  "volunteer_credentials", "grants", "pledges"];
const IMPORT_WRITE = /^\/(donors\/import|donors\/import-combined|donors\/import-semantics|imports|gifts\/import-history|grants\/import|volunteer-hours\/import|volunteer-hub\/import)\/?$/;

let running = null;
async function analyzeImportTables() {
  // One at a time: two imports finishing together need one ANALYZE, not two
  // racing for the same locks.
  if (running) return running;
  const { run } = require("../db");
  running = (async () => {
    for (const t of TABLES) {
      try { await run(`ANALYZE ${t}`); } catch (e) { console.error(`[analyze] ${t}:`, e.message); }
    }
  })().finally(() => { running = null; });
  return running;
}

// LIST-2 · THE TABLES THE NEXT SCREEN READS, AT THE END OF AN IMPORT. A big
// file is most of a new org the planner has never seen; the Donors list read
// right after it planned the drift read as if the org had one person (8 to 54 s
// locally, 146 s on prod). The background sheet import and the combined import
// call this when their writing is done. Each ANALYZE runs on its own
// connection with a statement and lock timeout, so it can never block the
// import, a screen or autovacuum: one that can't run now is skipped, in words.
const AFTER_IMPORT_TABLES = ["gifts", "donors", "donor_drift", "donor_scores"];
async function analyzeAfterImportGuarded(tag, tables = AFTER_IMPORT_TABLES) {
  const { withClient } = require("../db");
  return withClient(async c => {
    await c.query("SET statement_timeout = '20s'");
    await c.query("SET lock_timeout = '2s'");
    try {
      for (const t of tables) {
        try { await c.query(`ANALYZE ${t}`); } catch (e) { console.warn(`[analyze] ${tag}: ${t} skipped (${e.message})`); }
      }
    } finally {
      await c.query("RESET statement_timeout").catch(() => {});
      await c.query("RESET lock_timeout").catch(() => {});
    }
  }).catch(e => console.warn(`[analyze] ${tag}:`, e.message));
}

function analyzeAfterImport() {
  return (req, res, next) => {
    if (req.method === "POST" && IMPORT_WRITE.test(req.path)) {
      res.on("finish", () => {
        if (res.statusCode < 400) analyzeImportTables().catch(() => {});
      });
    }
    next();
  };
}

module.exports = { analyzeAfterImport, analyzeImportTables, analyzeAfterImportGuarded, AFTER_IMPORT_TABLES, TABLES, IMPORT_WRITE };
