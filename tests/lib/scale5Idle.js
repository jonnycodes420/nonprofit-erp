// SCALE-5 · a worker that knows one job type, for tests/scale5.test.js §4.
// It sits idle so the suite can count how often an empty queue is asked, and
// runs `scale5:probe` (stamping when it began) so the suite can see a new row
// wake it at once. On "stats" (a line on stdin) it prints its idle figures.
"use strict";
const JQ = require("../../jobQueue");
const { run } = require("../../db");

JQ.handle("scale5:probe", async (p, job) => {
  await run(`UPDATE job_queue SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('began', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint) WHERE id = ?`, [job.id]);
});
JQ.start({ scheduler: false, build: "scale5-idle" });
console.log("scale5 idle ready");
process.stdin.on("data", d => { if (/stats/.test(String(d))) console.log("STATS " + JSON.stringify(JQ.idle())); });
process.on("SIGTERM", () => JQ.stop({ graceMs: 100 }).finally(() => process.exit(0)));
