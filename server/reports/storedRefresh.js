// server/reports/storedRefresh.js · SPEED-4. A STORED REPORT IS CURRENT AGAIN
// WITHIN A MOMENT OF A GIFT.
//
// Annual and SYBUNT were served from the store on 84% and 88% of asks in the
// load run, not 95%: a gift makes them stale (it changes what they read), and
// the refresh that recomputes them waited for the after-change step on the
// worker, then 2 s more (orgSummary.scheduleRefresh folds a burst into one),
// then for the org's other stale answers. A read in that gap, 2.6 to 4.3 s on
// a quiet laptop and 5 to 6 s under the load, computed the whole report on the
// person's request.
//
// What those reports read is written in the change's own request (the gift,
// the person's totals); what the after-change step writes later (the rhythm,
// tasks, the thank-you draft, scores) none of them reads. So this is a handler
// of its own on the change's event (JOBS-1), beside the after-change step and
// not behind it, and it recomputes the answers that name their tables itself,
// the quickest first. (A first version queued a job of its own from the
// handler: under the load that second wait for a lane was 0.1 to 2.4 s more.)
// One refresh per org at a time in a process, and any changes while it runs
// fold into one more pass (orgSummary.refreshOrg skips what is current).
//
// The slower refresh (orgSummaryRefresh) still follows for everything else and
// leaves these to this one; whatever asks for it asks for this one too (the
// queued job below), so a door with no event is covered.
//
// It never serves anything: a read in the moment before the refresh lands
// still finds the answer stale and computes it fresh (orgSummary.cached).
"use strict";
const OUTBOX = require("../shared/outbox");

const NAME = "storedReportsRefresh";

function schedule(orgId) {
  if (!orgId || process.env.ORG_SUMMARY_OFF === "1") return null;
  return require("../../jobQueue").enqueue({ name: NAME, orgId, key: `${NAME}:${orgId}`, payload: { orgId }, runAfterMs: 0, priority: 3 });
}

// Folded per org, like the slower refresh: while one runs, any number of
// changes ask for ONE more pass after it, never one each (an import's events
// would otherwise queue a pass apiece).
const running = new Map();   // orgId -> { done, again }
function refreshNow(orgId) {
  if (!orgId) return Promise.resolve(0);
  const cur = running.get(orgId);
  if (cur) { cur.again = true; return cur.done; }
  const st = { again: false, done: null };
  st.done = (async () => {
    let n = 0;
    try {
      do { st.again = false; n += await require("../../orgSummary").refreshOrg(orgId, { named: true }); } while (st.again);
    } finally { running.delete(orgId); }
    return n;
  })();
  running.set(orgId, st);
  return st.done;
}

require("../../jobQueue").handle(NAME, (payload) => refreshNow(payload && payload.orgId));
OUTBOX.on("gift.recorded", "storedReports", async (p) => { await refreshNow(p.orgId); });
OUTBOX.on("donor.changed", "storedReports", async (p) => { await refreshNow(p.orgId); });

module.exports = { NAME, schedule, refreshNow };
