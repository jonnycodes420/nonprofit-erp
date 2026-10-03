// jobAudit.js — FIX-11 Part 6 tail. THE SAME GUARANTEE ROUTES HAVE.
//
// Part 1 put one audit write in the middleware every request passes through,
// so a route cannot forget to leave a trail. Its census named the hole that
// left: background jobs do not go through Express. Webhooks are POSTs and are
// covered; a periodic sweep is not. The dunning sweep and the card-expiry
// sweep happen to call `writeAuditLog` by hand, which means the next sweep
// somebody writes will happen not to.
//
// So: `recordTick` (server.js) is the one seam every job passes through, and a
// job must be declared here as one that WRITES or one that only READS. A job
// in neither list throws rather than running, which is the property that makes
// this hold: forgetting is not a silent option.
//
// A WRITING JOB RETURNS ITS ORGS. One audit row per organisation it changed,
// because an audit row is scoped to an org and a row with no org has nowhere
// honest to live. A job that writes and returns no orgs wrote to none, and
// says so by returning none.

// Jobs that change donor data, money, or send mail. Each one says WHAT it
// writes, because the next person to read this list should not have to guess.
const JOB_WRITES = {
  processDunning:                    "retries a failed recurring charge and records the attempt",
  processCardExpiry:                 "notes a card about to expire and drafts the note",
  processGivingSources:              "imports gifts from a connected giving source",
  processScheduledCampaigns:         "sends a campaign the org scheduled",
  processEmailMarketing:             "syncs an audience out and campaign activity back in",
  processQboAutoSync:                "sends waiting gifts to QuickBooks for orgs that turned auto-sync on",
  processTrackedSequences:           "advances a donor through a sequence the org turned on",
  processSmartMoves:                 "moves a donor's stage and logs the move",
  processThreadNudges:               "opens or nudges a Thread step",
  processStepReminders:              "reminds a staff member about a step they own",
  processDailyTaskReminders:         "sends the daily task reminder",
  processDigests:                    "sends the digest",
  processGrantMilestones:            "raises a grant milestone and drafts its report",
  processMembershipRenewals:         "renews a membership and charges or drafts for it",
  processPledgeInstallmentReminders: "reminds a donor about a pledge instalment",
  processSavedReportSchedule:        "sends a saved report on its schedule",
  processBoardPackSchedule:          "sends the board pack to the org's staff and board addresses",
  processWorkflowSweeps:             "runs the workflow recipes that are due",
  deliverWebhooks:                   "delivers a queued webhook to the org's endpoint",
  retryFailedNotifications:          "retries a notification that failed to send",
};

// Jobs that only read, compute or clean up after themselves. Nothing here
// changes a donor, moves money or reaches anybody, so there is nothing for an
// audit row to be about. Each one says why it is here.
const JOB_READS_ONLY = {
  processGeocodeQueue:    "turns an address already on file into coordinates; no donor field a human entered changes",
  processPhotoQueue:      "resizes a photo already uploaded",
  processNetworkGate:     "recomputes a gate from data that is already there",
  processTrialReminders:  "reads trial dates and reminds Steward's own founder, not an org's people",
  refreshCardsOnFile:     "recounts cards on file",
  refreshReconcileDenominator: "recomputes a denominator",
  reconcileStripeVsGifts: "compares two numbers and reports the difference",
  snapshotMetrics:        "writes a metric snapshot of figures already computed",
  runDataHealthNightly:   "CLEAN-1: counts what Data health shows and stores the counts; it suggests, and no donor field changes",
  recomputeScores:        "ENGAGE-1: recomputes the engagement and generosity scores from gifts and touches already on file; no field a person entered changes",
};

function jobKind(name) {
  const n = String(name || "");
  if (Object.prototype.hasOwnProperty.call(JOB_WRITES, n)) return "writes";
  if (Object.prototype.hasOwnProperty.call(JOB_READS_ONLY, n)) return "reads";
  return null;
}

// The sentence a job's audit row reads as. "Steward (nightly: dunning)" is the
// actor; this is the action.
function jobActor(name) {
  return { id: `system:job:${name}`, name: `Steward (background job: ${name})`, kind: "system" };
}

// What a job must return for its orgs to be recorded. A plain string is the
// old shape and still works: it means "nothing to record per organisation".
function normalizeJobResult(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const orgs = Array.isArray(result.orgs) ? result.orgs.filter(Boolean).map(String) : [];
    return {
      detail: typeof result.detail === "string" ? result.detail : null,
      orgs: [...new Set(orgs)],
      summary: typeof result.summary === "string" ? result.summary : null,
      counts: result.counts && typeof result.counts === "object" ? result.counts : null,
    };
  }
  return { detail: typeof result === "string" ? result : null, orgs: [], summary: null, counts: null };
}

module.exports = { JOB_WRITES, JOB_READS_ONLY, jobKind, jobActor, normalizeJobResult };
