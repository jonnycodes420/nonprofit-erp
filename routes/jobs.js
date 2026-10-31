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
  deliverWebhooks, syncMailbox, syncCalendar, pushStewardDates, refreshMailboxSyncHealth, mailboxAccessToken,
  checkWebhookSubscriptions, getOrgAccessState, monthBounds, notifyExpiringCards, orgTime,
  processDunning, processGeocodeQueue, processGivingSources, processGrantMilestones,
  processMembershipRenewals, processNetworkGate, processPhotoQueue, processAuctionUnpaid, processUnansweredMail,
  processPledgeInstallmentReminders, processPledgeReminders, processSequences,
  processTrackedSequences, processTrialReminders, processRecordBands, processWorkflowSweeps, query, rateLimitDisabled,
  reconcileStripeVsGifts, recordTick, refreshCardsOnFile, refreshReconcileDenominator,
  resolveCampaignRecipients, retryFailedNotifications, run, runCampaignSend,
  runDigestsForOrg, runSavedReportScheduleForOrg,
  runStepRemindersForOrg, runThreadNudgesForOrg, snapshotMetricsForOrg, syncGmail,
  weekBounds, recomputeAllScores,
} = ctx;

// SCALE-1 · A PERIODIC JOB IS A ROW ON THE QUEUE, NOT A TIMER IN THIS PROCESS.
// `every(name, everyMs, run, firstMs)` replaces the old setTimeout + setInterval
// pair: the first run is due `firstMs` after the job is first seen, then every
// `everyMs`. Which process runs it is jobQueue.js's business (STEWARD_PROCESS).
// `run` returns its promise and lets errors through, so a failure is retried.
const Q = require("../jobQueue");
const bootGate = require("../bootGate");   // FIX-51: boot jobs wait for the migrations
const every = (name, everyMs, fn, firstMs, opts = {}) => Q.define(name, { everyMs, firstMs, run: fn, ...opts });

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
  every("processSmartMoves", 5 * 60 * 1000, () => recordTick("processSmartMoves", processSmartMoves), 40000);
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
  every("processGivingSources", GIVING_SOURCE_SYNC_INTERVAL_MS, () => recordTick("processGivingSources", processGivingSources), 90000);
}

// ── INT-5 · WEBHOOK DELIVERY ───────────────────────────────────────────────
// Every minute, because a "recurring gift failed" that arrives six hours late
// is not the same product as one that arrives now. It rides the existing tick
// machinery; INT-5 adds no second scheduler.
if (!backgroundTicksDisabled()) {
  every("deliverWebhooks", 60 * 1000, () => recordTick("deliverWebhooks", deliverWebhooks));
}

// ── INT-3 · THE DAILY PULL FROM THE EMAIL TOOL ─────────────────────────────
// Campaign activity and unsubscribes, once a day. A newsletter's opens do not
// change by the hour, and Mailchimp's rate limit is a shared resource that a
// keener schedule would spend for nothing. Mailchimp also pushes unsubscribe
// and cleaned events as they happen, so this pull is the reconciliation, not
// the only path.
const EMAIL_MARKETING_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (!backgroundTicksDisabled()) {
  const runEmailMarketing = () => require("./finance").processEmailMarketing();
  every("processEmailMarketing", EMAIL_MARKETING_SYNC_INTERVAL_MS, () => recordTick("processEmailMarketing", runEmailMarketing), 120000);
}

// PARITY-2 Part 5: QUICKBOOKS AUTO-SYNC, hourly, and only for orgs whose
// admin turned it on. Off, nothing goes to QuickBooks until a person presses
// Sync. The tick is the same engine as the button, as `system:qbo/auto-sync`.
if (!backgroundTicksDisabled()) {
  const runQboAutoSync = () => require("./finance").processQboAutoSync();
  every("processQboAutoSync", 60 * 60 * 1000, () => recordTick("processQboAutoSync", runQboAutoSync));
}

// QBO-IN: THE AUTOMATIC QUICKBOOKS READ, hourly, only for orgs whose admin
// turned on "Read new gifts automatically" after a reviewed first save. It
// reads QuickBooks and writes nothing there.
if (!backgroundTicksDisabled()) {
  const runQboAutoRead = () => require("./finance").processQboAutoRead();
  every("processQboAutoRead", 60 * 60 * 1000, () => recordTick("processQboAutoRead", runQboAutoRead));
}

// CONNECT-2: XERO AUTO-SYNC, the same rule as QuickBooks. Hourly, only for
// orgs whose admin turned it on, and never while a fund is unmapped.
if (!backgroundTicksDisabled()) {
  const runXeroAutoSync = () => require("./finance").processXeroAutoSync();
  every("processXeroAutoSync", 60 * 60 * 1000, () => recordTick("processXeroAutoSync", runXeroAutoSync));
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
      // FIX-45: a demo org's scheduled campaign is never picked (mailPolicy.orgSendsSql).
      `SELECT c.* FROM campaigns c JOIN orgs o ON o.id = c.org_id
        WHERE c.status='scheduled' AND c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW()
          AND ${require("../mailPolicy").orgSendsSql("o")}`, []
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
        // EMAIL-1 — a template campaign the renderer would refuse goes back to
        // draft whole, never half-sent. (A campaign waiting for approval is
        // never here: this reads status='scheduled' only.)
        const pre = await require("../emailCompose").campaignPreflight(campaign, campaign.org_id);
        if (!pre.ok) {
          await run("UPDATE campaigns SET status='draft', updated_at=NOW() WHERE id=? AND status='scheduled'", [campaign.id]);
          console.error(`[campaign-scheduler] campaign ${campaign.id} back to draft: ${pre.message}`);
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
  every("processScheduledCampaigns", 5 * 60 * 1000, () => recordTick("processScheduledCampaigns", processScheduledCampaigns), 20000);
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
  every("processSavedReportSchedule", 5 * 60 * 1000, () => recordTick("processSavedReportSchedule", processSavedReportSchedule));
}

// REPORTS-3 — THE BOARD PACK, ON THE DAY SHE PICKED. The same 5-minute tick,
// never a second scheduler, and the same morning window the other scheduled
// mail uses so a pack arrives with the day's post rather than at 2 AM. Only
// orgs with an ENABLED schedule are even looked at, and the send itself is
// idempotent per period (board_pack_sends), so re-ticking inside the window
// cannot send twice.
async function processBoardPackSchedule() {
  try {
    const orgs = await query(
      `SELECT o.id, o.name, o.timezone FROM orgs o
         JOIN board_pack_schedules s ON s.org_id = o.id
        WHERE s.enabled = true`);
    const { reportHooks } = require("./crm");
    for (const org of orgs) {
      const clock = orgTime.orgClock(org);                     // ORG_TZ_SEAM_OK
      if (clock.hour < 6 || clock.hour >= 12) continue;         // morning, org-local
      await reportHooks.runBoardPackSchedule(org, { today: clock.date })
        .catch(e => console.error("[board-pack]", org.id, e.message));
    }
  } catch (e) { console.error("[board-pack] processBoardPackSchedule:", e.message); }
}
if (!backgroundTicksDisabled()) {
  every("processBoardPackSchedule", 5 * 60 * 1000, () => recordTick("processBoardPackSchedule", processBoardPackSchedule));
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
  every("processDigests", 5 * 60 * 1000, () => recordTick("processDigests", processDigests), 30000);
}

// ── BUILD-36 A3 / BUILD-85 — THE MORNING EMAIL ───────────────────────────────
// processDailyTaskReminders and processThreadNudges were two timers calling
// one sender (runMorningBriefForOrg) inside one [6,12) window. STAFF-MAIL-1
// keeps the one timer, below, and drops the shared window: each person picks
// their own hour and days in Settings → My email, and the sender reads them.
// The day and the hour are the ORGANIZATION's (ORG_TZ_SEAM_OK, BUILD-75 A.2).

if (!backgroundTicksDisabled()) {
  every("processGeocodeQueue", 5 * 60 * 1000, () => processGeocodeQueue(), 55000);
}

// BUILD-94 Part 1 — the import photo queue rides the same cadence as the
// geocoder, offset so the two network jobs do not start in the same second.
if (!backgroundTicksDisabled()) {
  every("processPhotoQueue", 5 * 60 * 1000, () => processPhotoQueue(), 70000);
}

// BUILD-100 (grants) Part 2 — the milestone sweep rides the EXISTING five-minute
// tick rather than a second scheduler (the standing rule since BUILD-13). It is
// offset from the photo queue so the two do not start in the same second, and it
// is idempotent: a pass that raised nothing is a pass that found nothing due.
if (!backgroundTicksDisabled()) {
  every("processGrantMilestones", 5 * 60 * 1000, () => recordTick("processGrantMilestones", () => processGrantMilestones()), 95000);
}

// WIRE-1: an auction item won and not paid for two days opens a step on the
// winner's Thread. Hourly is plenty; the sweep is idempotent per item.
if (!backgroundTicksDisabled()) {
  every("processAuctionUnpaid", 60 * 60 * 1000, () => recordTick("processAuctionUnpaid", () => processAuctionUnpaid()), 100000);
  // THREAD-3: an email that has waited a business day for a reply becomes a
  // step even when no new mail arrives to trigger a sync.
  every("processUnansweredMail", 60 * 60 * 1000, () => recordTick("processUnansweredMail", () => processUnansweredMail()));
}

// BUILD-94 Part 3 — the tracked-sequence engine. Every fifteen minutes is
// plenty: the send WINDOW is three hours wide on a weekday morning, so a tick
// that lands anywhere inside it is on time, and a tighter cadence would only
// spend queries discovering there is nothing to do.
if (!backgroundTicksDisabled()) {
  every("processTrackedSequences", 15 * 60 * 1000, () => recordTick("processTrackedSequences", processTrackedSequences), 90000);
}

async function processThreadNudges(now = new Date()) {
  try {
    // ORG_TZ_SEAM_OK — the hour and "today" are the ORGANIZATION's; whose
    // hour it is, and whose day, is each person's (STAFF-MAIL-1).
    const orgs = await query("SELECT id, name, legal_name, timezone, receipt_address, thread_nudge_weekends FROM orgs WHERE onboarding_complete=1", []);
    for (const org of orgs) {
      const clock = orgTime.orgClock(org, now);
      await runThreadNudgesForOrg(org, { today: clock.date, nowHour: clock.hour }).catch(e => console.error("[thread-nudge]", org.id, e.message));
    }
  } catch (e) { console.error("[thread-nudge] processThreadNudges:", e.message); }
}
if (!backgroundTicksDisabled()) {
  every("processThreadNudges", 5 * 60 * 1000, () => recordTick("processThreadNudges", processThreadNudges), 50000);
  // BUILD-88b B.2 — the late-instalment sweep rides the SAME timer family, not
  // a second scheduler. It opens threads and sends nothing, so it is safe to
  // run hourly: the `threads_one_open` index makes a repeat a no-op, and
  // `reminder_thread_id` makes it a no-op per instalment too.
  every("processPledgeInstallmentReminders", 60 * 60 * 1000, () => recordTick("processPledgeInstallmentReminders", processPledgeInstallmentReminders).then(o => o.opened && console.log(`[pledge] ${o.opened} late-installment thread(s) opened`)), 70000);
  // BUILD-101 Part 2 — memberships ride the same family. Opens threads, sends nothing.
  every("processMembershipRenewals", 60 * 60 * 1000, () => recordTick("processMembershipRenewals", processMembershipRenewals).then(o => o.opened && console.log(`[membership] ${o.opened} renewal thread(s) opened`)), 80000);
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
  every("processStepReminders", 5 * 60 * 1000, () => recordTick("processStepReminders", processStepReminders), 52000);
}
if (!backgroundTicksDisabled()) {
  every("processDunning", 60 * 60 * 1000, () => recordTick("processDunning", processDunning), 5000);
}

async function processCardExpiry() {
  try {
    await refreshCardsOnFile({});
    const orgs = await query(
      `SELECT DISTINCT o.id, o.name, o.recurring_dunning_enabled
         FROM orgs o JOIN recurring_subscriptions rs ON rs.org_id = o.id
        WHERE rs.status IN ('active','past_due','recovering') AND rs.card_exp_year IS NOT NULL
          AND ${require("../mailPolicy").orgSendsSql("o")}`, []);   // FIX-45: never a demo org
    for (const org of orgs) {
      await notifyExpiringCards(org, {}).catch(e => console.error("[card-expiry]", org.id, e.message));
    }
  } catch (e) { console.error("[card-expiry] processCardExpiry:", e.message); }
}
if (!backgroundTicksDisabled()) {
  every("processCardExpiry", 6 * 60 * 60 * 1000, () => recordTick("processCardExpiry", processCardExpiry), 65000);
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
  every("retryFailedNotifications", 5 * 60 * 1000, () => recordTick("retryFailedNotifications", retryFailedNotifications), 50000);
}
if (!backgroundTicksDisabled()) {
  // FIX-47: both answer /health from this process's memory, so each boot runs them (perBoot).
  every("reconcileStripeVsGifts", RECONCILE_INTERVAL_MIN * 60 * 1000, () => reconcileStripeVsGifts(), 90000, { perBoot: true });
}
// BUILD-65 Part 6 — surface the accountsChecked DENOMINATOR even before the
// first sweep (and even when background ticks are disabled), so /health can
// show "checked 1 of 6". Refreshed on boot + on the 5-min asset tick below.
bootGate.afterMigrations(() => refreshReconcileDenominator().catch(() => {}), 8000);   // FIX-51
bootGate.everyAfterMigrations(() => refreshReconcileDenominator().catch(() => {}), 5 * 60 * 1000);
if (!backgroundTicksDisabled()) {
  every("checkWebhookSubscriptions", 60 * 60 * 1000, () => checkWebhookSubscriptions(), 95000, { perBoot: true });
}
if (!backgroundTicksDisabled()) {
  every("processWorkflowSweeps", 5 * 60 * 1000, () => recordTick("processWorkflowSweeps", processWorkflowSweeps), 25000);
}
if (!backgroundTicksDisabled()) {
  every("processPledgeReminders", 60 * 60 * 1000, () => processPledgeReminders(), 5000);
}

if (!backgroundTicksDisabled()) {
  every("processTrialReminders", 6 * 60 * 60 * 1000, () => processTrialReminders(), 45000);
}
// PRICING-1: once a day, measure each banded org's records and apply only the
// band moves an owner agreed to. Never a price change on its own.
if (!backgroundTicksDisabled()) {
  every("processRecordBands", 24 * 60 * 60 * 1000, () => recordTick("processRecordBands", processRecordBands), 60000);
}

// INT-BUILD-1 — THE TICK READ THE WRONG TABLE. Since INT-4 every connection
// lives in `mailbox_connections`, but this still read `gmail_connections`, so
// a mailbox connected after INT-4 synced only when somebody pressed the
// button, and Outlook never synced at all. It reads the live table now, mail
// and calendar, for both providers. A row with no sealed token (a demo's
// example) has nothing to read and is skipped.
// FIX-34 · EVERY 5 MINUTES, AND NOT ONE AFTER ANOTHER. The FIX-33 tick read
// every connection in turn (mail, calendar, push, then the next connection),
// so one slow first read held every other connection, and /health's checkedAt
// was set only when the whole loop finished. Connections now run a few at a
// time; each read is guarded by its own advisory lock (server.js), so a tick
// that lands while the last one is still reading a connection skips it, and a
// 429 is honoured by skipping the connection until Retry-After.
// PUSH-1 · WHEN GOOGLE OR MICROSOFT TELLS STEWARD AT ONCE, THE TICK IS THE
// SAFETY NET. Mail (or the calendar) whose instant updates are on is read
// every 30 minutes instead of every 5; the rest exactly as before. If that
// 30-minute read finds a change no notice announced, instant updates are
// paused for that connection, the panel says so, and it is read every 5
// minutes again until a fresh channel is made (at most once an hour).
// The tick also renews every channel well before it expires (mailboxPush.js).
const MAILBOX_SYNC_INTERVAL_MS = Number(process.env.MAILBOX_TICK_MS) > 0 && process.env.TEST_MODE === "1" ? Number(process.env.MAILBOX_TICK_MS) : 5 * 60 * 1000;
const MAILBOX_SYNC_PARALLEL = 4;
const MP = require("../mailboxPush");
// A TEST_MODE tick can be held to one org, so push1-instant never reads
// another suite's leftover connections in a shared shard database.
const tickOrg = () => (process.env.TEST_MODE === "1" && process.env.MAILBOX_TICK_ORG) || null;
async function readWithPush(conn, rows, what) {
  const state = MP.pushState(conn, rows, what);
  if (!state.configured) {
    return what === "mail" ? syncMailbox(conn.user_id, conn.org_id, conn.provider) : syncCalendar(conn.user_id, conn.org_id, conn.provider);
  }
  const [last] = await query(`SELECT MAX(finished_at) AS t FROM mailbox_sync_runs WHERE user_id=? AND provider=? AND kind=? AND ok`,
    [conn.user_id, conn.provider, what]);
  const prevOk = last && last.t;
  if (!MP.readDue(state, prevOk)) return { skipped: "push_on" };
  const out = what === "mail" ? await syncMailbox(conn.user_id, conn.org_id, conn.provider) : await syncCalendar(conn.user_id, conn.org_id, conn.provider);
  if (out && MP.missedNotice(state, out.gatedChange, prevOk)) {
    console.error(`[push] ${conn.provider} ${what} for ${conn.id}: the safety read found a change no notice announced; instant updates paused`);
    await MP.pauseRows({ run }, state.rowIds, "stopped");
  }
  return out;
}
async function syncOneConnection(conn) {
  if (MP.config().base) {
    await MP.ensurePush(conn, { query, run, token: () => mailboxAccessToken(conn, conn.org_id, conn.provider) })
      .catch(e => console.error("[push] keeping channels:", e.message));
  }
  const rows = await query(`SELECT * FROM mailbox_push WHERE connection_id=?`, [conn.id]).catch(() => []);
  await readWithPush(conn, rows, "mail").catch(e => console.error("[mailbox-sync]", e.message));
  await readWithPush(conn, rows, "calendar").catch(e => console.error("[calendar-sync]", e.message));
  await pushStewardDates(conn.user_id, conn.org_id, conn.provider).catch(e => console.error("[calendar-push]", e.message));
}
async function syncAllGmail() {
  // A channel whose connection was disconnected or paused is forgotten: its
  // notices already read nothing, and the provider lets it lapse.
  await run(`DELETE FROM mailbox_push p USING mailbox_connections m
              WHERE m.id = p.connection_id AND (m.status <> 'active' OR m.paused IS TRUE)`).catch(() => {});
  const connections = await query(
    `SELECT * FROM mailbox_connections
      WHERE status='active' AND paused IS NOT TRUE AND credentials_sealed IS NOT NULL
        AND (retry_after IS NULL OR retry_after <= NOW())
        AND (?::text IS NULL OR org_id = ?::text)`, [tickOrg(), tickOrg()]);
  const queue = connections.slice();
  await Promise.all(Array.from({ length: Math.min(MAILBOX_SYNC_PARALLEL, queue.length) }, async () => {
    while (queue.length) await syncOneConnection(queue.shift());
  }));
  // FIX-33: the /health count and one error line per stale connection.
  await refreshMailboxSyncHealth({ log: true }).catch(e => console.error("[mailbox-stale] check failed:", e.message));
}
// SCALE-1: the queue's five-minute mailbox job. One round id for all of them,
// which is what /health's tick figure is measured over.
async function fanOutMailboxes() {
  await run(`DELETE FROM mailbox_push p USING mailbox_connections m
              WHERE m.id = p.connection_id AND (m.status <> 'active' OR m.paused IS TRUE)`).catch(() => {});
  const conns = await query(
    `SELECT id, org_id FROM mailbox_connections
      WHERE status='active' AND paused IS NOT TRUE AND credentials_sealed IS NOT NULL
        AND (retry_after IS NULL OR retry_after <= NOW())`);
  const round = "mailboxSync@" + Date.now();
  for (const c of conns) await Q.enqueue({ name: "mailboxSync", orgId: c.org_id, key: "mailboxSync:" + c.id, payload: { connectionId: c.id }, round });
  // The stale-connection count, after this round has had time to read.
  await Q.enqueue({ name: "mailboxSyncHealth", key: "mailboxSyncHealth", runAfterMs: 2 * 60 * 1000 });
}
if (!rateLimitDisabled() && !backgroundTicksDisabled()) {
  every("processNetworkGate", 6 * 60 * 60 * 1000, () => processNetworkGate());
}

// Run sequence engine on startup (5s delay) then every hour
if (!backgroundTicksDisabled()) {
  // Both halves run; one failing does not skip the other, and either failing
  // fails the job so the queue tries it again.
  every("processSequences", 60 * 60 * 1000, async () => {
    const out = await Promise.allSettled([processSequences(), autoEnroll()]);
    const bad = out.find(o => o.status === "rejected");
    if (bad) throw bad.reason;
  }, 5000);
}

// Mail and calendar read on startup (10s delay) then every 5 minutes. The
// health count is taken at boot too, so /health never says null for a tick.
// PUSH-1: a TEST_MODE server given MAILBOX_TICK_MS runs only this tick, that
// often, so push1-instant can watch the cadence without every other job.
// SCALE-1 · EACH CONNECTION IS ITS OWN JOB. The five-minute job only fans out:
// one `mailboxSync` row per live connection, keyed by the connection, so one
// slow mailbox no longer holds the others and a connection is never read by
// two workers at once. The PUSH-1 test cadence keeps the old in-process loop.
bootGate.afterMigrations(() => refreshMailboxSyncHealth().catch(() => {}), 3000);
if (process.env.TEST_MODE === "1" && Number(process.env.MAILBOX_TICK_MS) > 0) {
  bootGate.afterMigrations(() => syncAllGmail().catch(console.error), 10000);
  bootGate.everyAfterMigrations(() => syncAllGmail().catch(console.error), MAILBOX_SYNC_INTERVAL_MS);
} else if (!backgroundTicksDisabled()) {
  every("syncMailboxes", MAILBOX_SYNC_INTERVAL_MS, () => fanOutMailboxes(), 10000);
}
Q.handle("mailboxSync", async ({ connectionId }) => {
  const [conn] = await query(
    `SELECT * FROM mailbox_connections WHERE id=? AND status='active' AND paused IS NOT TRUE AND credentials_sealed IS NOT NULL
        AND (retry_after IS NULL OR retry_after <= NOW())`, [connectionId]);
  if (conn) await syncOneConnection(conn);
});
Q.handle("mailboxSyncHealth", () => refreshMailboxSyncHealth({ log: true }));
// SCALE-2 · A NEW CONNECTION'S FIRST READ IS A JOB, not part of the connect
// request: a 25,000-donor mailbox is a minute of searching, and the connect
// page answers at once. The read writes its progress as it goes; the card
// stops showing it when this job is done, however it ended.
Q.handle("mailboxFirstRead", async ({ connectionId }) => {
  const [conn] = await query(`SELECT * FROM mailbox_connections WHERE id=? AND status='active'`, [connectionId]);
  if (!conn) return;
  try {
    await syncMailbox(conn.user_id, conn.org_id, conn.provider, { trigger: "connect" });
    await run(`UPDATE mailbox_connections SET read_progress=NULL WHERE id=?`, [conn.id]);
    if (conn.calendar_granted) await syncCalendar(conn.user_id, conn.org_id, conn.provider, { trigger: "connect" });
  } finally {
    await run(`UPDATE mailbox_connections SET read_progress=NULL WHERE id=?`, [conn.id]).catch(() => {});
  }
});

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
  every("checkTrialExpiry", 6 * 60 * 60 * 1000, () => checkTrialExpiry(), 15000);
}

async function snapshotAllOrgMetrics() {
  try {
    const orgs = await query("SELECT id FROM orgs", []);
    for (const o of orgs) {
      try { await snapshotMetricsForOrg(o.id); } catch (e) { console.error(`[metrics] snapshot failed for org ${o.id}:`, e.message); }
    }
  } catch (e) { console.error("[metrics] snapshotAllOrgMetrics error:", e.message); }
}
// ENGAGE-1 — every org's engagement and generosity scores, from what is on
// file. A gift or a touch also recomputes its own org within seconds.
if (!backgroundTicksDisabled()) {
  every("recomputeScores", 6 * 60 * 60 * 1000, () => recordTick("recomputeScores", recomputeAllScores), 45000);
}
if (!backgroundTicksDisabled()) {
  every("snapshotAllOrgMetrics", 6 * 60 * 60 * 1000, () => snapshotAllOrgMetrics(), 20000);
}
}

module.exports = { mount };
