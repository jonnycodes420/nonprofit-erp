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
// tasks, the thank-you draft, scores) none of them reads. So the change's event
// (JOBS-1) asks for it as it is relayed, beside the after-change step and not
// behind it: this org's refresh is queued at once, and that job recomputes the
// answers that name their tables, the quickest first.
// One refresh per org at a time (the queued job below), and any changes while it runs
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

// Folded per org, like the slower refresh: the job's key holds one waiting
// at most, and a key never runs twice at once, so any number of changes while
// one runs are ONE more pass after it, never one each (an import's events
// would otherwise queue a pass apiece). orgSummary.refreshOrg skips what is current.
function refreshNow(orgId) {
  if (!orgId) return Promise.resolve(0);
  return require("../../orgSummary").refreshOrg(orgId, { named: true });
}

require("../../jobQueue").handle(NAME, (payload) => refreshNow(payload && payload.orgId));
// Asked for when the relay moves an org's gift or person events: once per org
// each time, never a job per event (an import writes a gift.recorded for every
// gift: 2,125 in one file), and never a `handler:` job, which every write's
// follow-up waits on (tests/lib/drainQueue.js). As a handler it made import9
// take 42 s, not 7, and import8, import9 and integrity1 pass their 300 s
// deadline in CI.
OUTBOX.onRelayed(["gift.recorded", "donor.changed"], (orgId) => schedule(orgId));

module.exports = { NAME, schedule, refreshNow };
