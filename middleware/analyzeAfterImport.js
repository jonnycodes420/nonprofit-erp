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

module.exports = { analyzeAfterImport, analyzeImportTables, TABLES, IMPORT_WRITE };
