// JOBS-1 · THE TWO SCORES (ENGAGE-1), RECOMPUTED ON THE QUEUE.
//
// After a gift or a touch the after-change step asks for a recompute of the
// org's scores (a percentile is relative, so one person's change can move
// everyone's). One job waits per org, a moment after the first ask, so a batch
// of twenty gifts is one recompute; a failure is tried again with a backoff and
// shows as stopped after its last try. It used to be a timer inside the web
// process, which is where ARCH-1's score-recompute crash started.
//
// Idempotent: a recompute replaces the org's rows as a set.
"use strict";
const JQ = require("../../../jobQueue");
const OUTBOX = require("../../shared/outbox");

const DEBOUNCE_MS = () => Number(process.env.SCORE_DEBOUNCE_MS || 3000);
JQ.handle("handler:scores", async (p) => { await OUTBOX.dep("recomputeScoresForOrg")(p.orgId); });

function schedule(orgId) {
  if (!orgId) return;
  JQ.enqueue({ name: "handler:scores", orgId, key: `scores:${orgId}`, payload: { orgId }, runAfterMs: DEBOUNCE_MS() })
    .catch(e => console.error("[scores] enqueue:", e.message));
}

module.exports = { schedule };
