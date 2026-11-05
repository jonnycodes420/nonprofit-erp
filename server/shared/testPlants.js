// Routes and jobs that exist only in a TEST_MODE process a suite started,
// each behind its own switch. Moved out of server.js (LOAD-1) unchanged.
"use strict";

function plant(app, { testMode, requireAuth, wrap, query, run, newId }) {
  // The probe job scale1-queue drives: it records which process ran it and when,
  // and can be told to take a while or to fail. TEST_MODE only, and only in a
  // process that suite started (STEWARD_TEST_PROBE=1): the battery's shard server
  // shares the suite's database and runs lanes, and with this handler it raced
  // the suite's worker for the probes (FIX-58, red at 12:02 AM).
  if (testMode() && process.env.STEWARD_TEST_PROBE === "1") {
    require("../../jobQueue").handle("testProbe", async (p, job) => {
      const t0 = new Date();
      if (p.sleepMs) await new Promise(r => setTimeout(r, p.sleepMs));
      await run(`INSERT INTO tick_log (id, name, started_at, finished_at, ok, detail) VALUES (?,?,?,NOW(),?,?)`,
        [newId("tick"), "testProbe", t0.toISOString(), !p.fail,
         JSON.stringify({ key: job.key, org: job.org_id, pid: process.pid, attempt: job.attempts })]);
      if (p.fail) throw new Error("probe told to fail");
      if (p.failPoolFull) throw Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode, pool_size: 15"), { code: "XX000" });
    });
  }

  // LOAD-1 · the planted slow route tests/load1-no-jam.test.js abandons: one
  // statement that sleeps `s` seconds (STEWARD_TEST_SLOW_SQL=1).
  if (testMode() && process.env.STEWARD_TEST_SLOW_SQL === "1") {
    app.get("/test/slow-sql", requireAuth, wrap(async (req, res) => {
      await query(`SELECT pg_sleep(?) AS slept`, [Math.min(120, Number(req.query.s) || 60)]);
      res.json({ ok: true });
    }));
  }
}

module.exports = { plant };
