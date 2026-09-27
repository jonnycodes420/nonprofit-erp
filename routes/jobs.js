// routes/jobs.js — the background timers: sweeps, digests, nudges, dunning,
// reconciliation, the geocode and photo queues.
//
// FIX-1 split: these timer registrations and the functions only they call were
// moved here VERBATIM from server.js. Nothing in them changed.
//
// server.js calls mount() once, at the end of boot, so every timer is set in the
// same order as before, within the same boot tick. `__dirname` is server.js's
// own; a relative require()/import() reads "../x" (it resolves against this
// file) and readSource reads it back as "./x".
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
function mount(ctx) {
const {
  RECONCILE_INTERVAL_MIN, autoEnroll, autoLapseOrg, backgroundTicksDisabled, bulkSendAddressGate,
  checkWebhookSubscriptions, getOrgAccessState, monthBounds, notifyExpiringCards, orgTime,
  processDunning, processGeocodeQueue, processGivingSources, processGrantMilestones,
  processMembershipRenewals, processNetworkGate, processPhotoQueue,
  processPledgeInstallmentReminders, processPledgeReminders, processSequences,
  processTrackedSequences, processTrialReminders, processWorkflowSweeps, query, rateLimitDisabled,
  reconcileStripeVsGifts, recordTick, refreshCardsOnFile, refreshReconcileDenominator,
  resolveCampaignRecipients, retryFailedNotifications, run, runCampaignSend,
  runDailyTaskRemindersForOrg, runDigestsForOrg, runSavedReportScheduleForOrg,
  runStepRemindersForOrg, runThreadNudgesForOrg, snapshotMetricsForOrg, syncGmail, threadNudgeDayOk,
  weekBounds,
} = ctx;

// Scheduled sweep — runs on the existing 5-min cadence (same pattern as
// processWorkflowSweeps / processDigests; NOT a second scheduler). Auto-lapse
// applies to EVERY onboarded org (it's a core smart-move, not gated on a
// workflow recipe being enabled).
async function processSmartMoves() {
  try {
    const orgs = await query("SELECT id FROM orgs WHERE onboarding_complete=1");
    for (const { id } of orgs) {
      try { await autoLapseOrg(id); }
      catch (e) { console.error("[smart-move] org", id, e.message); }
    }
  } catch (e) { console.error("[smart-move] sweep:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processSmartMoves().catch(console.error), 40000);
  setInterval(() => recordTick("processSmartMoves", processSmartMoves).catch(console.error), 5 * 60 * 1000);
}

// ---- THE SCHEDULE --------------------------------------------------------
// Every six hours per connected source, plus the "Check now" button above.
// Never the word "live": six hours is six hours, and PayPal itself can take
// hours to publish a transaction.
//
// The sweep for missed payments runs on the SAME tick for every org with a
// recurring commitment, not only for orgs whose sync just ran - a missed
// payment is an ABSENCE, and an absence is not discovered by reading rows
// that did not arrive.
const GIVING_SOURCE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
if (!backgroundTicksDisabled()) {
  setTimeout(() => processGivingSources().catch(console.error), 90000);
  setInterval(() => recordTick("processGivingSources", processGivingSources).catch(console.error), GIVING_SOURCE_SYNC_INTERVAL_MS);
}

// Fires due scheduled campaigns (status='scheduled', scheduled_at passed)
// through the exact same send path as the manual route. The claim UPDATE is
// conditional on status so two overlapping ticks can't double-send. A
// read_only (lapsed) org's scheduled campaign is moved back to draft rather
// than sent — matching checkWriteAccess on the manual route — or retried
// forever.
async function processScheduledCampaigns() {
  try {
    const due = await query(
      "SELECT * FROM campaigns WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()", []
    );
    for (const campaign of due) {
      try {
        const orgs = await query("SELECT * FROM orgs WHERE id = ?", [campaign.org_id]);
        if (!orgs.length) continue;
        const org = orgs[0];
        if (getOrgAccessState(org) === "read_only") {
          await run("UPDATE campaigns SET status='draft', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
          console.log(`[campaign-scheduler] org ${org.id} is read_only — campaign ${campaign.id} moved back to draft`);
          continue;
        }
        // BUILD-94 Part 4 — NO ADDRESS, NO SEND, on the scheduled path too.
        // Back to DRAFT rather than failed: the campaign is fine, the settings
        // are not, and she should find it where she left it.
        const schedAddr = await bulkSendAddressGate(campaign.org_id);
        if (!schedAddr.ok) {
          await run("UPDATE campaigns SET status='draft', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
          console.error(`[campaign-scheduler] org ${org.id} has no mailing address — campaign ${campaign.id} back to draft`);
          continue;
        }
        const claimed = await run("UPDATE campaigns SET status='sending', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
        if (!claimed.changes) continue; // another tick got it
        const donors = await resolveCampaignRecipients(campaign, campaign.org_id);
        console.log(`[campaign-scheduler] sending scheduled campaign ${campaign.id} (${donors.length} recipients, was due ${campaign.scheduled_at})`);
        await runCampaignSend(campaign, org, donors);
      } catch (e) { console.error("[campaign-scheduler]", campaign.id, e.message); }
    }
  } catch (e) { console.error("[campaign-scheduler]", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processScheduledCampaigns().catch(console.error), 20000);
  setInterval(() => recordTick("processScheduledCampaigns", processScheduledCampaigns).catch(console.error), 5 * 60 * 1000);
}

async function processSavedReportSchedule() {
  const orgs = await query("SELECT DISTINCT o.id, o.name, o.timezone FROM orgs o JOIN saved_reports r ON r.org_id = o.id WHERE r.schedule='weekly'");
  for (const org of orgs) {
    const clock = orgTime.orgClock(org);
    const dow = new Date(clock.date + "T12:00:00Z").getUTCDay();   // the org's civil date's weekday
    if (dow !== 1 || clock.hour < 6 || clock.hour >= 12) continue;  // Monday morning, org-local
    await runSavedReportScheduleForOrg(org, { weekKey: "wk:" + clock.date });
  }
}
if (!backgroundTicksDisabled()) {
  setInterval(() => recordTick("processSavedReportSchedule", processSavedReportSchedule).catch(console.error), 5 * 60 * 1000);
}

// The tick — runs both digests for every onboarded org for the most-recently-
// COMPLETED week/month. Reuses the existing 5-min scheduler cadence (NOT a
// second scheduler). Idempotency means a digest for a completed period goes out
// exactly once, on the first tick after that period rolls over.
async function processDigests(now = new Date()) {
  try {
    // ORG_TZ_SEAM_OK — windows are computed PER ORG. Two orgs in different
    // timezones complete a week on different days, so one shared window would
    // hand at least one of them somebody else's calendar.
    const orgs = await query("SELECT id, name, plan, subscription_status, timezone FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      const wk = weekBounds(-1, org, now), mo = monthBounds(-1, org, now);
      await runDigestsForOrg(org, { wk, mo }).catch(e => console.error("[digest]", org.id, e.message));
    }
  } catch (e) { console.error("[digest] processDigests:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processDigests().catch(console.error), 30000);
  setInterval(() => recordTick("processDigests", processDigests).catch(console.error), 5 * 60 * 1000);
}

// ── BUILD-36 A3 — the daily due/overdue task reminder ────────────────────────
// One email per user per day (digest_sends idempotency: digest_type
// 'daily_tasks', period_key day:YYYY-MM-DD), listing their OPEN tasks due today
// + overdue, deep-linked. Sends ONLY when non-empty — no tasks, no email, and
// nothing reserved, so if tasks appear later the same morning it still goes.
// Gated to a morning window so it reads as a morning brief, not a 2 AM ping.
// Reuses the existing 5-min tick — NOT a second scheduler.
const DAILY_REMINDER_WINDOW = [6, 12]; // send when the ORG-local hour is in [6, 12)
// ORG_TZ_SEAM_OK (BUILD-75 A.2) — the window and the day are the ORGANIZATION's,
// per org inside the loop. The old form read the PROCESS clock (UTC in prod):
// the documented "morning window [6,12) local" was 6am-noon UTC, and Phase 0.2
// measured the result — every daily_tasks send in production had fired at
// 02:00 America/New_York. One UTC `today` also served as both the task filter
// and the digest_sends dedup key for every org regardless of timezone.
// Transition note (recorded in audit/BUILD-75-FINDINGS.md §0.2 before this was
// written): because every recorded send fired at an hour where the UTC and
// org-local civil dates agree, the org-local key on the changeover day is
// string-identical to the UTC key already reserved — no double send, no skipped
// day, no migration. Policy if a future org's window ever spans a UTC-date
// disagreement: skip, never double.
function inDailyReminderWindow(orgClock) {
  return orgClock.hour >= DAILY_REMINDER_WINDOW[0] && orgClock.hour < DAILY_REMINDER_WINDOW[1];
}

async function processDailyTaskReminders(now = new Date(), { force = false } = {}) {
  try {
    // ORG_TZ_SEAM_OK — window and day are computed PER ORG (see the note on
    // DAILY_REMINDER_WINDOW above). Two orgs in different timezones are in
    // their morning at different instants, and "today" differs between them.
    const orgs = await query("SELECT id, name, legal_name, timezone, receipt_address, thread_nudge_weekends FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      const clock = orgTime.orgClock(org, now);
      if (!force && !inDailyReminderWindow(clock)) continue;
      await runDailyTaskRemindersForOrg(org, { today: clock.date }).catch(e => console.error("[daily-tasks]", org.id, e.message));
    }
  } catch (e) { console.error("[daily-tasks] processDailyTaskReminders:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processDailyTaskReminders().catch(console.error), 45000);
  setInterval(() => recordTick("processDailyTaskReminders", processDailyTaskReminders).catch(console.error), 5 * 60 * 1000);
}

if (!backgroundTicksDisabled()) {
  setTimeout(() => processGeocodeQueue().catch(e => console.error("[geocode]", e.message)), 55000);
  setInterval(() => processGeocodeQueue().catch(e => console.error("[geocode]", e.message)), 5 * 60 * 1000);
}

// BUILD-94 Part 1 — the import photo queue rides the same cadence as the
// geocoder, offset so the two network jobs do not start in the same second.
if (!backgroundTicksDisabled()) {
  setTimeout(() => processPhotoQueue().catch(e => console.error("[person-photo]", e.message)), 70000);
  setInterval(() => processPhotoQueue().catch(e => console.error("[person-photo]", e.message)), 5 * 60 * 1000);
}

// BUILD-100 (grants) Part 2 — the milestone sweep rides the EXISTING five-minute
// tick rather than a second scheduler (the standing rule since BUILD-13). It is
// offset from the photo queue so the two do not start in the same second, and it
// is idempotent: a pass that raised nothing is a pass that found nothing due.
if (!backgroundTicksDisabled()) {
  setTimeout(() => recordTick("processGrantMilestones", () => processGrantMilestones()).catch(console.error), 95000);
  setInterval(() => recordTick("processGrantMilestones", () => processGrantMilestones()).catch(console.error), 5 * 60 * 1000);
}

// BUILD-94 Part 3 — the tracked-sequence engine. Every fifteen minutes is
// plenty: the send WINDOW is three hours wide on a weekday morning, so a tick
// that lands anywhere inside it is on time, and a tighter cadence would only
// spend queries discovering there is nothing to do.
if (!backgroundTicksDisabled()) {
  setTimeout(() => processTrackedSequences().catch(e => console.error("[seq]", e.message)), 90000);
  setInterval(() => recordTick("processTrackedSequences", processTrackedSequences).catch(e => console.error("[seq]", e.message)), 15 * 60 * 1000);
}

async function processThreadNudges(now = new Date()) {
  try {
    // ORG_TZ_SEAM_OK — window, weekday, and "today" are the ORGANIZATION's.
    const orgs = await query("SELECT id, name, legal_name, timezone, receipt_address, thread_nudge_weekends FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      const clock = orgTime.orgClock(org, now);
      if (!inDailyReminderWindow(clock)) continue;
      if (!threadNudgeDayOk(org, clock.date)) continue;
      await runThreadNudgesForOrg(org, { today: clock.date }).catch(e => console.error("[thread-nudge]", org.id, e.message));
    }
  } catch (e) { console.error("[thread-nudge] processThreadNudges:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processThreadNudges().catch(console.error), 50000);
  setInterval(() => recordTick("processThreadNudges", processThreadNudges).catch(console.error), 5 * 60 * 1000);
  // BUILD-88b B.2 — the late-instalment sweep rides the SAME timer family, not
  // a second scheduler. It opens threads and sends nothing, so it is safe to
  // run hourly: the `threads_one_open` index makes a repeat a no-op, and
  // `reminder_thread_id` makes it a no-op per instalment too.
  setTimeout(() => processPledgeInstallmentReminders().then(o => o.opened && console.log(`[pledge] ${o.opened} late-instalment thread(s) opened`)).catch(console.error), 70000);
  setInterval(() => recordTick("processPledgeInstallmentReminders", processPledgeInstallmentReminders).then(o => o.opened && console.log(`[pledge] ${o.opened} late-instalment thread(s) opened`)).catch(console.error), 60 * 60 * 1000);
  // BUILD-101 Part 2 — memberships ride the same family. Opens threads, sends nothing.
  setTimeout(() => processMembershipRenewals().catch(console.error), 80000);
  setInterval(() => recordTick("processMembershipRenewals", processMembershipRenewals).then(o => o.opened && console.log(`[membership] ${o.opened} renewal thread(s) opened`)).catch(console.error), 60 * 60 * 1000);
}

async function processStepReminders(now = new Date()) {
  try {
    // ORG_TZ_SEAM_OK — "today" and the wall clock are the ORGANIZATION's.
    // No weekday gate: a time fires on a Saturday, deliberately (see header).
    const orgs = await query(
      "SELECT id, name, legal_name, timezone, receipt_address FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      const clock = orgTime.orgClock(org, now);
      const nowHHMM = `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
      await runStepRemindersForOrg(org, { today: clock.date, nowHHMM })
        .catch(e => console.error("[step-reminder]", org.id, e.message));
    }
  } catch (e) { console.error("[step-reminder] processStepReminders:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processStepReminders().catch(console.error), 52000);
  setInterval(() => recordTick("processStepReminders", processStepReminders).catch(console.error), 5 * 60 * 1000);
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processDunning().catch(console.error), 5000);
  setInterval(() => recordTick("processDunning", processDunning).catch(console.error), 60 * 60 * 1000);
}

async function processCardExpiry() {
  try {
    await refreshCardsOnFile({});
    const orgs = await query(
      `SELECT DISTINCT o.id, o.name, o.recurring_dunning_enabled
         FROM orgs o JOIN recurring_subscriptions rs ON rs.org_id = o.id
        WHERE rs.status IN ('active','past_due','recovering') AND rs.card_exp_year IS NOT NULL`, []);
    for (const org of orgs) {
      await notifyExpiringCards(org, {}).catch(e => console.error("[card-expiry]", org.id, e.message));
    }
  } catch (e) { console.error("[card-expiry] processCardExpiry:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processCardExpiry().catch(console.error), 65000);
  setInterval(() => recordTick("processCardExpiry", processCardExpiry).catch(console.error), 6 * 60 * 60 * 1000);
}
// The AUTOMATIC retry timers are disabled under DISABLE_RATE_LIMIT (the
// local/test-env signal the rate limiters already use): during a deterministic
// test run this background sweep would otherwise replay previously-failed
// notifications into whichever suite's capture sink is currently listening on
// the shared mail port, skewing exact-count assertions. The function and the
// POST /admin/notifications/retry ops hook stay fully live, so notify-delivery
// drives retry explicitly and production (DISABLE_RATE_LIMIT unset) retries on
// the tick as designed.
if (!rateLimitDisabled() && !backgroundTicksDisabled()) {
  setTimeout(() => retryFailedNotifications().catch(console.error), 50000);
  setInterval(() => recordTick("retryFailedNotifications", retryFailedNotifications).catch(console.error), 5 * 60 * 1000);
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => reconcileStripeVsGifts().catch(console.error), 90000);
  setInterval(() => reconcileStripeVsGifts().catch(console.error), RECONCILE_INTERVAL_MIN * 60 * 1000);
}
// BUILD-65 Part 6 — surface the accountsChecked DENOMINATOR even before the
// first sweep (and even when background ticks are disabled), so /health can
// show "checked 1 of 6". Refreshed on boot + on the 5-min asset tick below.
setTimeout(() => refreshReconcileDenominator().catch(() => {}), 8000);
setInterval(() => refreshReconcileDenominator().catch(() => {}), 5 * 60 * 1000);
if (!backgroundTicksDisabled()) {
  setTimeout(() => checkWebhookSubscriptions().catch(console.error), 95000);
  setInterval(() => checkWebhookSubscriptions().catch(console.error), 60 * 60 * 1000);
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processWorkflowSweeps().catch(console.error), 25000);
  setInterval(() => recordTick("processWorkflowSweeps", processWorkflowSweeps).catch(console.error), 5 * 60 * 1000);
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => processPledgeReminders().catch(console.error), 5000);
  setInterval(() => processPledgeReminders().catch(console.error), 60 * 60 * 1000);
}

if (!backgroundTicksDisabled()) {
  setTimeout(() => processTrialReminders().catch(console.error), 45000);
  setInterval(() => processTrialReminders().catch(console.error), 6 * 60 * 60 * 1000);
}

async function syncAllGmail() {
  const connections = await query("SELECT * FROM gmail_connections WHERE status='active'");
  for (const conn of connections) {
    await syncGmail(conn.user_id, conn.org_id).catch(e => console.error("[gmail-sync]", e.message));
  }
}
if (!rateLimitDisabled() && !backgroundTicksDisabled()) {
  setInterval(() => processNetworkGate().catch(console.error), 6 * 60 * 60 * 1000);
}

// Run sequence engine on startup (5s delay) then every hour
if (!backgroundTicksDisabled()) {
  setTimeout(() => {
    processSequences().catch(console.error);
    autoEnroll().catch(console.error);
  }, 5000);
  setInterval(() => {
    processSequences().catch(console.error);
    autoEnroll().catch(console.error);
  }, 60 * 60 * 1000);
}

// Run Gmail sync on startup (10s delay) then every 15 min
if (!backgroundTicksDisabled()) {
  setTimeout(() => syncAllGmail().catch(console.error), 10000);
  setInterval(() => syncAllGmail().catch(console.error), 15 * 60 * 1000);
}

// Check trial expiry on startup (15s delay) then every 6 hours
async function checkTrialExpiry() {
  try {
    await run(
      `UPDATE orgs SET subscription_status = 'trial_expired' WHERE subscription_status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()`,
      []
    );
  } catch (e) { console.error("checkTrialExpiry error:", e); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => checkTrialExpiry(), 15000);
  setInterval(() => checkTrialExpiry(), 6 * 60 * 60 * 1000);
}

async function snapshotAllOrgMetrics() {
  try {
    const orgs = await query("SELECT id FROM orgs", []);
    for (const o of orgs) {
      try { await snapshotMetricsForOrg(o.id); } catch (e) { console.error(`[metrics] snapshot failed for org ${o.id}:`, e.message); }
    }
  } catch (e) { console.error("[metrics] snapshotAllOrgMetrics error:", e.message); }
}
if (!backgroundTicksDisabled()) {
  setTimeout(() => snapshotAllOrgMetrics(), 20000);
  setInterval(() => snapshotAllOrgMetrics(), 6 * 60 * 60 * 1000);
}
}

module.exports = { mount };
