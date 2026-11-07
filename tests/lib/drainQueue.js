// JOBS-1 · WAIT FOR WHAT FOLLOWS A CHANGE, NEVER FOR A FIXED TIME.
//
// What follows a gift or a change (the thank-you draft, sequences, journeys,
// the after-change step, the scores) runs on the queue after the request
// answers. A suite that reads it waits here until it has run: every ready
// event relayed, and every handler job that is due (or, with `scores`, every
// handler job at all, the scores' short wait included) done with its first
// try. A job backing off after a failure is not waited for: it has run, and
// failed, and that is what a test of failure looks at.
//
// `q` is the suite's own database helper. Resolves { drained, waiting }.
// TIDY-1: and the background jobs a request leaves behind it that are not
// handlers: an import's recent gifts (importRecent) write the stored rhythm a
// check reads right after the import answers.
const BACKGROUND = ["importRecent"];

async function drainQueue(q, { orgId = null, scores = false, timeout = 30000, interval = 25 } = {}) {
  const t0 = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - t0) / 1e6;
  for (;;) {
    const [r] = await q(
      `SELECT (SELECT COUNT(*) FROM events_outbox e
                WHERE e.relayed_at IS NULL AND e.ready AND ($1::text IS NULL OR e.org_id = $1))::int
            + (SELECT COUNT(*) FROM job_queue j
                WHERE (j.name LIKE 'handler:%' OR j.name = ANY($3::text[])) AND ($1::text IS NULL OR j.org_id = $1)
                  AND (j.status = 'running'
                       OR (j.status = 'waiting' AND j.attempts = 0 AND ($2::boolean OR j.run_after <= NOW()))))::int AS n`,
      [orgId, !!scores, BACKGROUND]).catch(e => (/does not exist/.test(e.message) ? [{ n: 0 }] : Promise.reject(e)));
    if (!r || r.n === 0) return { drained: true, waiting: 0 };
    if (elapsedMs() >= timeout) return { drained: false, waiting: r.n };
    await new Promise(res => setTimeout(res, interval));
  }
}

module.exports = { drainQueue, BACKGROUND };
