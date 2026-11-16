// SCALE-4 · a worker that knows only two job types, for tests/scale4.test.js §3.
// It claims nothing but its own (jobQueue claims only names it has handlers for).
//   scale4:long   long: true. Waits until its row's payload.hold_ms has passed.
//   scale4:short  returns at once.
// Each run writes its start and end into its own row (payload), so the suite
// reads when each job started and how many long jobs ran at once.
"use strict";
const JQ = require("../../jobQueue");
const { run } = require("../../db");

const stamp = (id, k) => run(`UPDATE job_queue SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(?::text, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint) WHERE id = ?`, [k, id]);
JQ.handle("scale4:long", async (p, job) => {
  await stamp(job.id, "began");
  await new Promise(r => setTimeout(r, Number(p.hold_ms) || 3000));
  await stamp(job.id, "ended");
}, { long: true });
JQ.handle("scale4:short", async (p, job) => { await stamp(job.id, "began"); await stamp(job.id, "ended"); });
JQ.start({ scheduler: false, build: "scale4-lanes" });
console.log("scale4 lanes ready");
process.on("SIGTERM", () => JQ.stop({ graceMs: 100 }).finally(() => process.exit(0)));
