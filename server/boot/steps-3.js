// SPLIT-2: moved VERBATIM from server.js (the statements from lines 4974-11789, in order). server.js requires the boot modules in
// order: every helpers-N first (a function existed from the start, as hoisting made it), then
// steps-1, steps-2 … in the order the statements ran. Each "SPLIT-2 server.js piece N" block is
// server.js's own text; tests read server.js through readSource("server.js"), which puts the
// pieces back in order. The lines outside the blocks are the wiring: this module's copy of each
// server.js name it reads (bind), and __boot.share() after a declaration or a write, which
// refreshes every module's copy.
// eslint-disable-next-line no-var, no-global-assign
var __dirname = require("path").join(__dirname, "..", "..");   // server.js's folder, as the moved code expects
const __boot = require("./share");
const __share = __boot.share;
let PRICING, backgroundTicksDisabled, billingStripeMode, bootGate, displayNameCase, ipKeyGenerator, publicAppUrl, purgeExpiredAssets, rateLimit, rateLimitDisabled, rateLimitHandler, refreshAssetFallbackCount, refreshRetentionCounts;
__boot.register(c => {
  if ("PRICING" in c) PRICING = c.PRICING;
  if ("backgroundTicksDisabled" in c) backgroundTicksDisabled = c.backgroundTicksDisabled;
  if ("billingStripeMode" in c) billingStripeMode = c.billingStripeMode;
  if ("bootGate" in c) bootGate = c.bootGate;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("ipKeyGenerator" in c) ipKeyGenerator = c.ipKeyGenerator;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("purgeExpiredAssets" in c) purgeExpiredAssets = c.purgeExpiredAssets;
  if ("rateLimit" in c) rateLimit = c.rateLimit;
  if ("rateLimitDisabled" in c) rateLimitDisabled = c.rateLimitDisabled;
  if ("rateLimitHandler" in c) rateLimitHandler = c.rateLimitHandler;
  if ("refreshAssetFallbackCount" in c) refreshAssetFallbackCount = c.refreshAssetFallbackCount;
  if ("refreshRetentionCounts" in c) refreshRetentionCounts = c.refreshRetentionCounts;
  if ("_fiveXXWindow" in c) _fiveXXWindow = c._fiveXXWindow;
  if ("RB" in c) RB = c.RB;
  if ("SEQ" in c) SEQ = c.SEQ;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("billingModeStatus" in c) billingModeStatus = c.billingModeStatus;
  if ("mailboxSyncHealth" in c) mailboxSyncHealth = c.mailboxSyncHealth;
  if ("EV" in c) EV = c.EV;
  if ("MB" in c) MB = c.MB;
});

// SPLIT-2 server.js piece 412

// Trailing window for recovered/lost recovery-rate math (see GET /recurring/health).
const RECOVERY_RATE_WINDOW_DAYS = 90;
// SPLIT-2 end
__share({ RECOVERY_RATE_WINDOW_DAYS });
// SPLIT-2 server.js piece 420

// ── BUILD-57 — recurring movement ledger + staff-change notifications ──────
// One writer for the append-only recurring_change_log (the MRR waterfall's
// source of truth). KINDS: created · amount_up · amount_down · paused ·
// resumed · canceled_voluntary · canceled_involuntary · recovered ·
// fund_changed. The voluntary/involuntary split is decided HERE, at write
// time, when the caller knows why — a sustainer manager needs the two never
// collapsed (one is a technical problem, the other a relationship problem).
const RECURRING_CHANGE_KINDS = new Set([
  "created", "amount_up", "amount_down", "paused", "resumed",
  "canceled_voluntary", "canceled_involuntary", "recovered", "fund_changed",
]);
// SPLIT-2 end
__share({ RECURRING_CHANGE_KINDS });
// SPLIT-2 server.js piece 424

// ── THE ONE PLACE STEWARD MAILS JONATHAN ───────────────────────────────────
// Deliberately narrow. Three triggers, named in the brief: a send to a real
// mailbox provider from a demo org, a tick failure, a 5xx burst. It rides the
// RAW client, not the wrapped one, because an alert about mail must not depend
// on the thing it is alerting about — and it is de-duplicated per hour per
// kind, because an alert that arrives forty times is an alert nobody reads.
const _opsAlertSent = new Map();
// SPLIT-2 end
__share({ _opsAlertSent });
// SPLIT-2 server.js piece 426

// A 5xx burst. Counted from the tick log's failures plus the process's own
// counter, so it does not need an APM.
let _fiveXXWindow = [];
// SPLIT-2 end
__share({ _fiveXXWindow });
// SPLIT-2 server.js piece 434

// FIX-26: WHO A CAMPAIGN REACHES, AND WHO IT LEAVES OUT, ANSWERED ONCE.
// The builder used to count the segment in the browser from /donors/summaries,
// which carries no person_types, so every volunteer and event guest with an
// email counted as a donor (1,198 against the server's 1,158 on the demo). And
// the server's own count stopped at "has an email", while the send then
// skipped the unsubscribed, the bounced, the deceased and do-not-contact one
// by one. Now the count is the send's own decision for every person in the
// segment (donorMailDecisions -> donorMailDecision), so the number on the
// button is the number of messages the send creates.
//
// `orgGate` is reported apart from the people: when the organisation itself
// sends no mail (the demonstration org, or mail switched off) nobody gets it,
// and the screen says that once instead of listing every person as left out.
const AUDIENCE_REASON_ORDER = ["no_email", "deceased", "do_not_contact", "unsubscribed", "bounced", "complained", "blocked_address", "sample_donor", "donor_never", "skipped", "not_chosen", "type_off"];
// SPLIT-2 end
__share({ AUDIENCE_REASON_ORDER });
// SPLIT-2 server.js piece 436

// The background send loop — one recipient at a time: suppression check,
// token replacement, tracking pixel, unsubscribe footer/headers, per-row
// campaign_recipients bookkeeping, then finalize the campaign row. Extracted
// from the send route (BUILD-06 Phase C) so processScheduledCampaigns() can
// use the identical path — before that job existed, a scheduled campaign
// sat in status='scheduled' forever and never sent.
// EMAIL-1: the seam that renders a template for one person (emailCompose.js).
const emailCompose = require("../../emailCompose");
// SPLIT-2 end
__share({ emailCompose });
// SPLIT-2 server.js piece 437
emailCompose.configure({ displayNameCase });
// SPLIT-2 end
// SPLIT-2 server.js piece 450

// Same dollar-figure rate-limit budget as donateLimiter (public, unauth,
// abuse surface) but its own instance — a fundraiser owner editing their
// own page shouldn't be able to get rate-limited out of it just because
// other donors on the same shared/NAT'd IP have been actively giving
// through POST /donate/:orgSlug, which would exhaust a shared limiter.
const fundraiserManageLimiter = rateLimit("fundraiserManageLimiter", {
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
// SPLIT-2 end
__share({ fundraiserManageLimiter });
// SPLIT-2 server.js piece 451
// NUMBERS-3: finPeriodBounds (a third copy of the fiscal-year boundary) is
// gone; a fiscal or calendar year is NUMBERS.fiscalYear.period(org, yearMode, offset).

// ── Reports (BUILD-02) ──────────────────────────────────────────────────────
// Six fixed, parameterized, table-first reports — deliberately NOT an
// Analytics revival (no charts, no custom builder). All aggregation happens
// in SQL, org-scoped on every query; every report also serves ?format=csv.
// Declared AFTER the /reports/board routes above so Express matches "board"
// there first and this :key route never shadows it.

const REPORT_KEYS = ["giving-summary", "by-group", "lybunt", "sybunt", "retention", "top-donors"];
// SPLIT-2 end
__share({ REPORT_KEYS });
// SPLIT-2 server.js piece 454

// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD
// ════════════════════════════════════════════════════════════════════════════
// shared/reportBuilder.js is the catalogue and the compiler: a field is a NAME
// looked up there, never a string of SQL, and every value is a bound
// parameter. This block adds the org scope, runs it, and keeps what she saved.
// The twelve standard reports that Reports already answers CALL Reports' own
// handler through reportToCsv's own shaping, so a saved LYBUNT and the Reports
// tab's LYBUNT are one computation.
let RB = null;
// SPLIT-2 end
__share({ RB });
// SPLIT-2 server.js piece 455
const RB_READY = import("../../shared/reportBuilder.js").then(m => { RB = m; __share({ RB }); return m; });
// SPLIT-2 end
__share({ RB_READY });
// SPLIT-2 server.js piece 458

const rbCents = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ rbCents });
// SPLIT-2 server.js piece 465

// The sentence each figure answers to. ONE string, read by the email and by the
// People dashboard — the BUILD-86 C.3 rule, applied to the activity report.
const ACTIVITY_DEFINITIONS = {
  conversationsLogged: "Calls, meetings, emails, asks and notes somebody logged in this window. A timeline entry Steward wrote itself is not one.",
  giftsReceived: "Gifts dated inside this window, counted and summed. Imported history counts on the date the file gave it.",
  thankYousMarkedSent: "Gifts marked acknowledged inside this window. A gift acknowledged before Steward began stamping the moment carries no date and is counted in no week.",
  threadsClosedByOutcome: "Follow-ups closed because the conversation happened.",
  threadsDismissed: "Follow-ups closed without one, with the reason recorded.",
};
// SPLIT-2 end
__share({ ACTIVITY_DEFINITIONS });
// SPLIT-2 server.js piece 468

// ── Digest HTML rendering (branded header + Steward frame) ──────────────────
const digestEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// SPLIT-2 end
__share({ digestEsc });
// SPLIT-2 server.js piece 469
const digestMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
// SPLIT-2 end
__share({ digestMoney });
// SPLIT-2 server.js piece 474

const digestNudgeHtml = (line, linkLabel) =>
  `<div style="margin-top:16px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;line-height:1.6;">
    ${line}
    <div style="margin-top:10px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">${linkLabel} →</a></div>
  </div>`;
// SPLIT-2 end
__share({ digestNudgeHtml });
// SPLIT-2 server.js piece 480

// ── BUILD-84 P0-4 — GEOCODING IS A WRITE-TIME JOB ───────────────────────────
// The map used to geocode at render, in the browser, one address per request,
// storing nothing (geocode.js's header has the full account). Coordinates are
// donor data now: written once, re-read forever, re-computed only when the
// address itself changes.
//
// Three entry points and no others:
//   markDonorsForGeocoding()  — a write said an address may have changed
//   processGeocodeQueue()     — the 5-minute tick drains `pending`
//   POST /geocode/run         — the ops/test hook that drives it NOW
// Nothing on a read path may call any of them.

// A DONOR-SIDED job budget. Every tick states how many provider requests it
// spent for how many addresses, the same way the import states its write
// round trips — a cost you cannot see is a cost nobody manages.
const GEOCODE_TICK_BUDGET = Number(process.env.GEOCODE_TICK_BUDGET) || 500;
// SPLIT-2 end
__share({ GEOCODE_TICK_BUDGET });
// SPLIT-2 server.js piece 482


// ── BUILD-94 Part 1 — THE IMPORT PHOTO QUEUE ───────────────────────────────
// Same shape as the BUILD-84 geocode queue, for the same reason: the network
// does not belong inside an import transaction. A mapped photo column lands as
// photo_source_url + photo_fetch_status='pending'; this drains it.
//
// EVERY row leaves with a terminal status and, on failure, a reason ON THE ROW
// — "it just has no photo" is the outcome nobody can debug, and BUILD-84's
// rule stands: a catch may not blame the data for a bug.

// The one place a spreadsheet's URL becomes an outbound request.
const PHOTO_FETCH_BUDGET = 200;   // rows per tick
// SPLIT-2 end
__share({ PHOTO_FETCH_BUDGET });
// SPLIT-2 server.js piece 483
const PHOTO_FETCH_CONCURRENCY = 4;
// SPLIT-2 end
__share({ PHOTO_FETCH_CONCURRENCY });
// SPLIT-2 server.js piece 492

// STAFF-MAIL-1 · EACH PERSON'S OWN MORNING. The person picks what goes in it
// (briefSettings: steps, tasks, meetings, readouts, and the team roll-up for an
// admin), the hour it comes, and weekdays or every day. `nowHour` is the org's
// wall-clock hour, passed by the tick: a person is sent to from their hour
// until six hours after it, and the day's ledger makes it once. Called without
// `nowHour` (the ops hook and the suites) the hour is not checked; `force`
// also skips the day check, as the hook always did for the weekday rule.
const BRIEF_CATCH_UP_HOURS = 6;
// SPLIT-2 end
__share({ BRIEF_CATCH_UP_HOURS });
// SPLIT-2 server.js piece 497

// ── STAFF-MAIL-2 — YOUR WEEK: THE ONE STAFF EMAIL A NEW PERSON STARTS WITH ──
// Jonathan, 31 Oct 2026: everyone new starts with this ON and every other
// staff email off, the daily morning email included (`notify_weekly` defaults
// to true; people who existed before keep NULL, which reads off). Monday at
// 7 AM in the org's time zone: the week ahead, then last week in a few lines.
//
// BUILT FROM PARTS THAT ALREADY ANSWER ELSEWHERE, so its numbers cannot drift:
//   steps due        the morning email's ranked queue, run to Sunday
//   follow-ups due   the morning email's task list, run to Sunday
//   pledge payments  unpaid pledge installments due this week
//   events           events dated this week
//   gifts in         the `gifts` figure (Home, Atlas and every report read it)
//   thank-yous owed  the `unthanked` figure, from Home's own start date
//   who lapsed       donorStatus's lapsed rule (the Directory's), whose lapse
//                    day (last gift + 365) fell last week
// A week with nothing in it still sends: one line, and the link to Home.
const WEEKLY_HOUR = 7;
// SPLIT-2 end
__share({ WEEKLY_HOUR });
// SPLIT-2 server.js piece 498
const WEEKLY_CATCH_UP_HOURS = 6;
// SPLIT-2 end
__share({ WEEKLY_CATCH_UP_HOURS });
// SPLIT-2 server.js piece 499
const WEEKLY_LIST_CAP = 5;
// SPLIT-2 end
__share({ WEEKLY_LIST_CAP });
// SPLIT-2 server.js piece 503

// The same kind of follow-up is one line with its count. A task Steward opened
// itself carries its kind in its actor (`system:<path>/<id>`); its path is the
// kind. A kind that counts something says its total; any other shows its first
// title and how many more. A task a person wrote is its own line.
const WEEKLY_TASK_KINDS = {
  "system:data-health/import": {
    count: t => Number((String(t.title).match(/\d+/) || [1])[0]) || 1,
    line: n => `Review ${n} possible ${n === 1 ? "duplicate" : "duplicates"} from the import in Data health`,
  },
};
// SPLIT-2 end
__share({ WEEKLY_TASK_KINDS });
// SPLIT-2 server.js piece 507

const weeklyIsEmpty = w => !w.stepCount && !w.taskCount && !w.pledges.length && !w.events.length
  && !w.giftCount && !w.unthanked && !w.lapsed.length;
// SPLIT-2 end
__share({ weeklyIsEmpty });
// SPLIT-2 server.js piece 517

// ── Stewardship: milestone & anniversary detection ──────────────────────────
// Fixed checkpoints for "just crossed a round-number cumulative giving total"
// detection — separate from impact_metrics, which is org-configured content
// for what to SAY once a milestone fires, not when one fires.
const MILESTONE_THRESHOLDS = [10000, 5000, 2500, 1000, 500];
// SPLIT-2 end
__share({ MILESTONE_THRESHOLDS });
// SPLIT-2 server.js piece 520

// ── BUILD-76 Part 1 — drift, computed for real ──────────────────────────────
// The ONE integration point over the pure engine in drift.js. Computed on
// READ, never stored (the Part 3.4 decision, audit/BUILD-76-FINDINGS.md): a
// gift that lands via webhook or manual entry is reflected the next time any
// drift surface is read, because every surface calls this fresh. NB
// computeAtRiskCandidates above is a DIFFERENT, older signal (feeds the
// at_risk re-engagement EMAIL trigger); it is deliberately untouched — drift
// is the day-view/badge truth, not a mail trigger.
//
// Exclusions (brief §1.4 — what a real file is full of; each has its own
// assertion in tests/drift.test.js): deceased · do-not-contact · active
// recurring (a monthly donor's failed card is a failed payment, not drift —
// status active/past_due/recovering all count as "on subscription") · open
// pledges (contractual cadence, not voluntary) · single-gift donors (the
// engine returns not_eligible — no cadence exists).
// SCALE-2 · DRIFT READS WHAT'S STORED. The part of a donor's Drift answer that
// comes from their gifts (the assessment, yesterday's state, the recent-pledge
// marker) is stored per person in donor_drift for one org calendar day, and
// Home and Drift read it instead of rebuilding every donor's gift array on
// each visit. A write to gifts deletes the stored answer for the people it
// touched (a statement trigger, so no door can skip it); the after-change step
// recomputes them at once and the nightly job recomputes the org for the new
// day. What is still read live is everything that is not gifts: the person's
// flags, subscriptions, open pledges and last contact, which are each one
// cheap read and decide exclusions and "handled" exactly as before.
const DRIFT_STORE_OFF = () => process.env.DRIFT_STORE_OFF === "1";
// SPLIT-2 end
__share({ DRIFT_STORE_OFF });
// SPLIT-2 server.js piece 526

// Which milestones get a human-written "write a note" nudge instead of an
// AI-drafted email: the two highest dollar thresholds (real major-gift
// moments) and every giving anniversary (inherently personal/relational —
// worth a genuine handwritten touch regardless of dollar amount). Everything
// smaller/routine ($500/$1,000/$2,500 crossings) keeps the existing
// AI-drafted-email flow, which is efficient and already staff-reviewed
// before sending. This is a product judgment call, not a technical one —
// see the Phase 2 commit message for the full reasoning.
const NOTE_MILESTONE_KEYS = new Set(["threshold_10000", "threshold_5000"]);
// SPLIT-2 end
__share({ NOTE_MILESTONE_KEYS });
// SPLIT-2 server.js piece 533


// ══ BUILD-94 Part 3 — SEQUENCES ════════════════════════════════════════════
//
// THE RULE THIS BUILD CHANGES, AND HOW FAR. Since BUILD-88c: nothing goes to a
// donor she did not press send on. Sequences change it to this, and no
// further: SHE WROTE EVERY WORD, SHE TURNED IT ON, AND EACH SEND IS HERS.
// Steward still writes nothing to a donor — every sentence that reaches an
// inbox came out of a step SHE typed, personalised only by merge fields
// reading her own data. There is no model on this path.
//
// The rules themselves live in shared/sequenceShape.js (pure, unit-tested);
// this is the half that touches the database, the clock and Resend.

let SEQ = null;
// SPLIT-2 end
__share({ SEQ });
// SPLIT-2 server.js piece 534
const SEQ_READY = import("../../shared/sequenceShape.js").then(m => { SEQ = m; __share({ SEQ }); return m; });
// SPLIT-2 end
__share({ SEQ_READY });
// SPLIT-2 server.js piece 536
const fmtMoneyPlain = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
// SPLIT-2 end
__share({ fmtMoneyPlain });
// SPLIT-2 server.js piece 541

// ── THE SEND ───────────────────────────────────────────────────────────────
// Batched under Resend's rate limit, idempotent on (person, sequence, step)
// because the claim row IS the unique index — not a flag somebody remembered
// to check. A retried job finds the row taken and sends nothing.
const SEQ_RATE_PER_SECOND = 8;     // Resend's documented floor, with headroom
// SPLIT-2 end
__share({ SEQ_RATE_PER_SECOND });
// SPLIT-2 server.js piece 542
const SEQ_TICK_BUDGET = 200;
// SPLIT-2 end
__share({ SEQ_TICK_BUDGET });
// SPLIT-2 server.js piece 549

// ── THE CARD THAT IS GOING TO DIE, BEFORE IT DIES (2026-09-11) ─────────────
//
// Every path above this one begins at `invoice.payment_failed` — after the
// gift is already lost and the donor has already had an apology. Card expiry
// is the most predictable cause of involuntary churn and the one thing that
// can be seen coming, so this reads what Stripe knows about the card on file
// and asks BEFORE it fails. Same Checkout link, two weeks earlier, sent to an
// intact relationship rather than a broken one.
//
// WHY A POLL AND NOT A WEBHOOK. Stripe's `customer.source.expiring` fires only
// for legacy Card/Source objects; its own event reference says it does not
// occur for PaymentMethod integrations, which is what Steward uses (setup-mode
// Checkout → setupIntent.payment_method → subscriptions.update). Checked, not
// assumed. So the expiry date has to be fetched and stored, and this is the
// same shape as the BUILD-84 geocoding queue: a budgeted background sweep, an
// answer stored on the row, nothing at read time.
//
// The re-read is cheap and bounded: one Stripe call per subscription at most
// every CARD_RECHECK_DAYS, capped per tick. A card that has not been re-read
// recently is the only thing this ever looks at.
const CARD_RECHECK_DAYS = Number(process.env.CARD_RECHECK_DAYS) || 7;
// SPLIT-2 end
__share({ CARD_RECHECK_DAYS });
// SPLIT-2 server.js piece 550
const CARD_CHECK_BUDGET = Number(process.env.CARD_CHECK_BUDGET) || 200;
// SPLIT-2 end
__share({ CARD_CHECK_BUDGET });
// SPLIT-2 server.js piece 551

// The expiry period is 'YYYY-MM' — a card is dead after the LAST day of its
// expiry month, so the month is the whole unit and the notice is keyed to it.
const cardPeriod = (y, m) => (y && m) ? `${y}-${String(m).padStart(2, "0")}` : null;
// SPLIT-2 end
__share({ cardPeriod });
// SPLIT-2 server.js piece 555

// ════════════════════════════════════════════════════════════════════════════
// Workflows engine (BUILD-13 Part 3) — retention recipes on a builder-ready
// trigger → conditions → actions data model. v1 ships four pre-built recipes;
// a future visual builder is a UI over this same schema, not a rewrite.
// Every action keys off a dedup token (workflow_runs UNIQUE(workflow_id,
// dedup_key)) so re-processing a trigger event is a strict no-op — an
// automation that double-sends is a trust disaster. Every run is logged.
// ════════════════════════════════════════════════════════════════════════════
const WORKFLOW_RECIPES = [
  {
    key: "failed_recurring_recovery",
    name: "Failed recurring gift → recovery note to review + task",
    description: "When a donor's recurring card fails, Steward drafts a personal note for you to review and send, and creates a task to follow up. Steward drafts it. You send it. (The card-update link itself goes out in the automatic payment-failed email.)",
    trigger: "recurring_failed",
    conditions: [],
    actions: [
      { type: "draft_email", template: "recovery" },
      // A.2 — the label is the step, not the word "follow-up" and a name.
      { type: "create_task", title: "Call {donor} about the monthly gift that failed", priority: "high", dueDays: 2 },
    ],
    defaultConfig: {},
  },
  {
    key: "new_donor_welcome",
    name: "New donor's first gift → thank-you to review + task",
    description: "The moment a brand-new donor gives for the first time, Steward drafts a thank-you for you to review and send, and queues a personal welcome call. Steward drafts it. You send it.",
    trigger: "gift_received",
    conditions: [{ field: "is_first_gift", op: "eq", value: true }],
    actions: [
      { type: "draft_email", template: "thankyou" },
      { type: "create_task", title: "Personal welcome call: {donor}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "lapsing_reengage",
    name: "Lapsing donor → re-engagement task",
    description: "When a donor crosses your lapse window with no gift, tag them and create a re-engagement task (optionally draft a note for you to review and send. Steward drafts it. You send it.).",
    trigger: "donor_lapsed",
    conditions: [],
    actions: [
      { type: "add_tag", tag: "lapsing" },
      { type: "create_task", title: "Re-engage {donor}: lapsing", priority: "medium", dueDays: 7 },
    ],
    defaultConfig: { lapseDays: 365, sendEmail: false },
  },
  {
    key: "major_gift_alert",
    name: "Major gift → stewardship alert to owner",
    description: "When a gift lands over your major-gift threshold, alert the donor's relationship owner and create a stewardship task.",
    trigger: "gift_received",
    conditions: [{ field: "amount", op: "gte", value: 1000 }],
    actions: [
      { type: "notify_owner" },
      { type: "create_task", title: "Steward major gift: {donor} gave {amount}", priority: "high", dueDays: 2 },
    ],
    defaultConfig: { threshold: 1000 },
  },
  // BUILD-16 Part 3 — real-time stewardship: the instant ANY gift lands, alert
  // the people who thank donors (ED and/or the assigned officer) in-app AND by
  // email, so thanks go out fast. Different from major_gift_alert (which only
  // fires over a big threshold and only pings the owner) — this is the
  // every-gift "someone just gave, thank them now" signal. Idempotent per gift.
  {
    key: "instant_gift_thanks",
    name: "Gift received → notify the team to thank them",
    description: "The instant a gift comes in, alert the executive director and/or the donor's assigned officer, in-app and by email, so a thank-you goes out fast. Set an amount threshold to only be pinged above a certain size.",
    trigger: "gift_received",
    conditions: [{ field: "amount", op: "gte", value: 0 }],
    actions: [
      { type: "notify_gift" },
    ],
    defaultConfig: { notify: "both", threshold: 0 },
  },
  // ── BUILD-76 Part 7 — two of the three canned automations (the third is
  // major_gift_alert above, which Part 7 TUNES rather than duplicates).
  // Neither may ever email a donor (C.2) — create_task only, pinned at the
  // source by workflows-e2e §B76.
  {
    key: "quiet_past_pattern",
    name: "Donor quiet past their own pattern → task for their officer",
    description: "When a donor goes meaningfully past their own giving rhythm, the same drift computation the home screen shows, high confidence only, create a task for their relationship owner carrying the reason. Earlier and more personal than the fixed lapse window.",
    trigger: "donor_drifting",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "{donor} is drifting: {reason}", priority: "medium", dueDays: 5 },
    ],
    defaultConfig: {},
  },
  {
    key: "pledge_due_soon",
    name: "Pledge payment coming due → task for their officer",
    description: "A set number of days before an open pledge's due date, create a task for the donor's relationship owner so the ask never slips. Internal task only, the donor-facing pledge reminder emails are configured separately.",
    trigger: "pledge_due",
    conditions: [],
    actions: [
      { type: "create_task", assignToOwner: true, title: "Pledge due {dueDate}: {donor}: {amount} outstanding", priority: "medium", dueDays: 0 },
    ],
    defaultConfig: { leadDays: 14 },
  },
];
// SPLIT-2 end
__share({ WORKFLOW_RECIPES });
// SPLIT-2 server.js piece 556
const WORKFLOW_RECIPE_MAP = Object.fromEntries(WORKFLOW_RECIPES.map(r => [r.key, r]));
// SPLIT-2 end
__share({ WORKFLOW_RECIPE_MAP });
// SPLIT-2 server.js piece 558

const asJson = (v, fb) => v == null ? fb : (typeof v === "object" ? v : (() => { try { return JSON.parse(v); } catch { return fb; } })());
// SPLIT-2 end
__share({ asJson });
// SPLIT-2 server.js piece 560

const escHtmlWf = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// SPLIT-2 end
__share({ escHtmlWf });
// SPLIT-2 server.js piece 562

// BUILD-45 (F-2) — retry queued notification sends. Runs on the existing 5-min
// tick (NOT a second scheduler) and via POST /admin/notifications/retry (ops/
// test hook). Re-reserves the dedup row and re-sends; deletes the failure row
// on success. After MAX_NOTIFY_ATTEMPTS it stops retrying and leaves the row as
// a permanent, surfaced record (counted on /health.notifications.failedPending)
// so a delivery problem is visible instead of silent. Backoff is coarse
// (attempts × 5 min) — internal alerts are time-sensitive but not sub-minute.
// ── BUILD-46 §1.1 — donor-account emails ride the SAME failure-visible path ─
// Rows queued with this sentinel org_id are donor-facing lifecycle emails
// (verification, reset, alias/email-change confirmation, magic links): the
// stored body_html is the FINAL rendered email, so the retry resends it raw —
// no org lookup, no notification_sends dedup (these are per-request emails).
const DONOR_EMAIL_ORG = "donor-network";
// SPLIT-2 end
__share({ DONOR_EMAIL_ORG });
// SPLIT-2 server.js piece 564

const MAX_NOTIFY_ATTEMPTS = 5;
// SPLIT-2 end
__share({ MAX_NOTIFY_ATTEMPTS });
// SPLIT-2 server.js piece 565
// Cached count of pending/exhausted failed notifications, surfaced on /health
// so the read path stays synchronous. Refreshed by every retry sweep (incl.
// the 50s-after-boot one) and bumped when a new failure is queued.
let notifyFailedPending = 0;
// SPLIT-2 end
__share({ notifyFailedPending });
// SPLIT-2 server.js piece 568

// ── BUILD-62 Part 3 — the reconciliation SWEEP ──────────────────────────────
// Donations settle in each org's OWN connected Stripe account (never the
// platform account, which only carries Steward's subscription billing). So the
// guard walks every connected account and asks, both directions:
//   1. Does every succeeded, not-fully-refunded charge have a gift row? A
//      charge with none = a donor was charged and Steward recorded NOTHING —
//      the exact failure BUILD-62 chased. This is an ALERT (count on /health +
//      Sentry), never a log line.
//   2. Does every recent online gift still have a succeeded charge behind it?
//      The reverse — a phantom/reversed gift.
// Read-only at Stripe and in Steward. Windowed + capped so it stays cheap.
const RECONCILE_WINDOW_HOURS = Math.max(1, parseInt(process.env.RECONCILE_WINDOW_HOURS || "72", 10) || 72);
// SPLIT-2 end
__share({ RECONCILE_WINDOW_HOURS });
// SPLIT-2 server.js piece 569
const RECONCILE_INTERVAL_MIN = Math.max(5, parseInt(process.env.RECONCILE_INTERVAL_MIN || "20", 10) || 20);
// SPLIT-2 end
__share({ RECONCILE_INTERVAL_MIN });
// SPLIT-2 server.js piece 577
// BUILD-51b — keep /health's themeAssets.dbFallbackRows fresh (failed-S3-put
// visibility); same 5-min cadence, never a second scheduler. BUILD-56 adds
// the softDeleted (restorable) count on the same tick.
if (!backgroundTicksDisabled()) {
  bootGate.afterMigrations(() => refreshAssetFallbackCount().catch(console.error), 20000);
  bootGate.everyAfterMigrations(() => refreshAssetFallbackCount().catch(console.error), 5 * 60 * 1000);
  bootGate.afterMigrations(() => refreshRetentionCounts().catch(console.error), 20000);
  bootGate.everyAfterMigrations(() => refreshRetentionCounts().catch(console.error), 5 * 60 * 1000);
  // BUILD-56 Part 4 — the retention purge: destroys objects soft-deleted more
  // than ASSET_RETENTION_DAYS ago (never a referenced one; every destruction
  // logged in asset_purge_log). 6-hour cadence like checkTrialExpiry.
  // SCALE-1: the purge writes, so it is a queue job and runs once, not per replica.
  require("../../jobQueue").define("purgeExpiredAssets", { everyMs: 6 * 60 * 60 * 1000, firstMs: 90000, run: () => purgeExpiredAssets() });
  // FIX-51 · an upload whose S3 put failed every try goes to the bucket on
  // the next pass (assetStore.moveFallbackAssetsToS3; never org_creo). A queue
  // job, so one replica does it, and only after the migrations.
  require("../../jobQueue").define("moveFallbackAssets", { everyMs: 30 * 60 * 1000, firstMs: 60000, run: () => require("../../assetStore").moveFallbackAssetsToS3() });
} else {
  // Ticks off (test boot): populate the /health counters once at load — a
  // read-only count, no mail/state side effects — so the fields aren't stale.
  bootGate.afterMigrations(() => refreshAssetFallbackCount().catch(console.error));
  bootGate.afterMigrations(() => refreshRetentionCounts().catch(console.error));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 579

// ── Pledge fulfillment reminders ────────────────────────────────────────────
// A pledge (donor promises $X by a future date) going unfulfilled past its
// due date is structurally the same problem as a recurring gift's failed
// payment: an expected payment that didn't happen, needing a proactive,
// time-staged nudge. This deliberately reuses the recurring-dunning engine's
// exact architecture above (same fixed-offset-from-first-event cadence math,
// same setTimeout/setInterval cron pattern, same suppression-check +
// unsubscribe-footer email plumbing) — only the trigger condition and the
// copy are pledge-specific. See db.js's pledges comment for why this needed
// its own minimal table first.
const PLEDGE_REMINDER_SCHEDULE_DAYS = [0, 3, 7, 14];
// SPLIT-2 end
__share({ PLEDGE_REMINDER_SCHEDULE_DAYS });
// SPLIT-2 server.js piece 585

// ── Billing mode-consistency self-diagnosis ─────────────────────────────────
// This class (billing key in one Stripe mode + STRIPE_PRICE_* ids from the
// OTHER mode) has now bitten twice and 500'd upgrades, so make it self-
// diagnosing: verify every configured price actually resolves under the current
// billing key's mode, log a LOUD warning on a mismatch, cache the result for
// /health, and expose a live re-check at /admin/billing-diagnostic.
//
// A price id doesn't encode its mode, so the only reliable check is to retrieve
// it with the billing key — `resource_missing` means it lives in the other mode
// (or doesn't exist). Runs once at boot; never on the hot /health path.
let billingModeStatus = { mode: billingStripeMode(), checked: false, ok: null, prices: [], checkedAt: null };
// SPLIT-2 end
__share({ billingModeStatus });
// SPLIT-2 server.js piece 588

// Which STRIPE_PRICE_* env var backs each plan — used only for a precise server
// log ("billing key is TEST but STRIPE_PRICE_TEAM is a LIVE price").
const PLAN_PRICE_ENV = {
  core: "STRIPE_PRICE_CORE", team: "STRIPE_PRICE_TEAM", founding: "STRIPE_PRICE_FOUNDING",
  seed: "STRIPE_PRICE_SEED", growth: "STRIPE_PRICE_GROWTH", impact: "STRIPE_PRICE_IMPACT",
};
// SPLIT-2 end
__share({ PLAN_PRICE_ENV });
// SPLIT-2 server.js piece 589
// GTM-1a — the tier prices join the mode check, so `/health.billing` reports a
// live price id sitting behind a test key (or the reverse) for the bands that
// are actually on sale, not only for the three legacy plans.
// PRICING-1: each record band's one-time setup price, and the GTM-1a bands
// orgs may still be on, are checked the same way.
for (const t of [...PRICING.TIERS, ...PRICING.LEGACY_TIERS]) {
  PLAN_PRICE_ENV[`${t.id}_monthly`] = t.envMonthly;
  PLAN_PRICE_ENV[`${t.id}_yearly`] = t.envYearly;
  if (t.envSetup) PLAN_PRICE_ENV[`${t.id}_setup`] = t.envSetup;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 590
PLAN_PRICE_ENV[PRICING.INTERNAL_TEST.id] = PRICING.INTERNAL_TEST.env;
// SPLIT-2 end
// SPLIT-2 server.js piece 591

// ── BUILD-90 90b · THE REMINDER AND THE CANCEL BUTTON ──────────────────────
// NOTHING MOVES THE TRIAL END. Not an import, not a second import, not a
// rescheduled onboarding meeting. `orgs.trial_ends_at` is written at signing
// and thereafter only ever re-read from the Stripe subscription that holds the
// same number — `tests/trial-billing.test.js` imports a donor file and proves
// the date is byte-identical afterwards.
//
// Seven days before the charge, ONE email from Jonathan's address: the date,
// the amount, the card's last four, and a one-click cancel. Settings → Billing
// shows the same date and the same button. Nobody has to ring anybody.

// The signed, no-login cancel token — the same HMAC shape as the unsubscribe
// and card-update families, with its own payload so it cannot be swapped for
// one of those. Carries the org, not the subscription, because the
// subscription id may change (a plan switch) while the org never does.
// SECURE-1: it expires. A link that cancels a plan with no sign-in must not
// work for ever from any old, forwarded email; thirty days covers the seven
// before the charge and the weeks after it, then Settings → Billing is the way.
const CANCEL_LINK_DAYS = 30;
// SPLIT-2 end
__share({ CANCEL_LINK_DAYS });
// SPLIT-2 server.js piece 593

// Find every org whose charge is seven days out and warn it once.
// `now` is injectable so the suite can stand on day 23 without waiting.
// ── GTM-1b 2 · WHAT THE AGENT COSTS DURING THE FREE THIRTY DAYS ───────────
//
// The Agent calls a paid model on somebody else's key, and thirty free days
// with no ceiling is an invoice waiting to happen. Twenty-five PLANS is the
// allowance — a plan is one instruction she wrote, which is the unit she
// actually thinks in, not tokens or requests — and it lifts entirely the
// moment the first charge lands.
//
// IT IS COUNTED PER ORG, FOR EVER, NOT PER DAY. A daily allowance would be
// twenty-five a day for thirty days, which is not an allowance. The count is
// rows in `agent_instructions`, so a plan she wrote and deleted still counts:
// it was still a model call, and letting deletes refund the allowance is how
// a cap becomes advisory.
//
// AFTER THE FIRST CHARGE THERE IS NO CAP. `subscription_status = 'active'`
// means Stripe has taken money, which is exactly the line the brief drew.
const AGENT_TRIAL_PLAN_ALLOWANCE = 25;
// SPLIT-2 end
__share({ AGENT_TRIAL_PLAN_ALLOWANCE });
// SPLIT-2 server.js piece 597

// THIRTY DAYS, from pricing.json. The agreement says a new price does not
// take effect for at least this long after the owner is told.
const TIER_NOTICE_DAYS = PRICING.BAND_MOVE.noticeDays;
// SPLIT-2 end
__share({ TIER_NOTICE_DAYS });
// SPLIT-2 server.js piece 598
const MONTHS_OVER_BEFORE_NOTE = PRICING.BAND_MOVE.monthsOverBeforeNote;
// SPLIT-2 end
__share({ MONTHS_OVER_BEFORE_NOTE });
// SPLIT-2 server.js piece 607

// FIX-10 F — UNLIMITED IS ONE NUMBER, AND shared/seats.js IS WHERE IT LIVES.
// This file is CommonJS and shared/ is ESM, so the value is written once here
// and CHECKED against the shared module at boot: a drift is a loud log rather
// than a silent cap on a plan that sells unlimited users.
const SEATS_UNLIMITED = 999999999;
// SPLIT-2 end
__share({ SEATS_UNLIMITED });
// SPLIT-2 server.js piece 608
import("../../shared/seats.js").then(m => {
  if (m.SEATS_UNLIMITED !== SEATS_UNLIMITED)
    console.error(`[plans] SEATS_UNLIMITED drift: server.js ${SEATS_UNLIMITED} vs shared/seats.js ${m.SEATS_UNLIMITED}`);
}).catch(() => {});
// SPLIT-2 end
// SPLIT-2 server.js piece 609
// SEATS_UNLIMITED used for "unlimited" — Infinity serializes to null in JSON
// trial gets Team limits: limits only engage once trial converts to paid.
// Core/Team bands (BUILD-24) are INFORMATIONAL for launch — the numbers shown
// on the pricing page — but NOT hard-enforced (see SOFT_BAND_PLANS below).
// When bands are eventually enforced they must count ACTIVE donors (gave within
// ~3 years), not every record, or the pricing page's claim becomes false.
// FIX-32: unlimited users on every plan, including the trial and the legacy
// Core/Team/founding prices. One plan; a seat count is not a gate.
const PLAN_LIMITS = {
  core:     { seats: SEATS_UNLIMITED, records: 5000,      extraSeatPrice: null },
  team:     { seats: SEATS_UNLIMITED, records: 25000,     extraSeatPrice: null },
  founding: { seats: SEATS_UNLIMITED, records: 5000,      extraSeatPrice: null },
  seed:     { seats: 1,         records: 1000,      extraSeatPrice: null },
  growth:   { seats: 5,         records: 10000,     extraSeatPrice: 25   },
  impact:   { seats: SEATS_UNLIMITED, records: 999999999, extraSeatPrice: null },
  trial:    { seats: SEATS_UNLIMITED, records: 25000,     extraSeatPrice: null },
  portal:   { seats: 3,         records: 25000,     extraSeatPrice: null }, // BUILD-46 network tier (soft)
};
// SPLIT-2 end
__share({ PLAN_LIMITS });
// SPLIT-2 server.js piece 610

// GTM-1a — UNLIMITED USERS, on every tier, because that is what the page
// sells. The record band is the tier's own donor band and it is INFORMATIONAL
// (every tier plan is in SOFT_BAND_PLANS below): going over it is a
// conversation and thirty days' notice, never a door that shuts. GTM-1b 1 is
// the notice.
// PRICING-1: the record bands, and the GTM-1a t-bands an org may still be on.
for (const p of require("../../closeLink").CLOSE_PLANS.filter(c => c.tierId)) {
  const tier = PRICING.tierForPlanValue(p.tierId);
  PLAN_LIMITS[p.id] = { seats: SEATS_UNLIMITED, records: tier ? tier.maxRecords : 999999999, extraSeatPrice: null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 611
PLAN_LIMITS.internal_test = { seats: SEATS_UNLIMITED, records: 999999999, extraSeatPrice: null };
// SPLIT-2 end
// SPLIT-2 server.js piece 612

// Core/Team/founding bands are kept SOFT for launch — informational only, never
// a hard 403. Legacy seed/growth/impact keep their existing hard enforcement so
// no pre-cutover org's behavior changes.
const TIER_PLAN_IDS = require("../../closeLink").CLOSE_PLANS.filter(c => c.tierId).map(p => p.id);
// SPLIT-2 end
__share({ TIER_PLAN_IDS });
// SPLIT-2 server.js piece 613
const SOFT_BAND_PLANS = new Set(["core", "team", "founding", "portal", "internal_test", ...TIER_PLAN_IDS]);
// SPLIT-2 end
__share({ SOFT_BAND_PLANS });
// SPLIT-2 server.js piece 616

// ── Gmail integration ──────────────────────────────────────────────────────

// ── INT-4 · ONE MAILBOX SYNC, FOR GMAIL AND OUTLOOK ────────────────────────
//
// THE DEFAULT IS THAT NOTHING IS STORED. The provider is asked only for
// messages involving an address that already belongs to somebody on file, and
// every message that comes back still has to pass `classifyMailboxMessage`
// before a single field of it is written. Her doctor, her children's school and
// her job applications are not merely filtered out of the record: they are
// never fetched, never counted and never named.
//
// What replaced the first version of this, and why:
//   · the tokens are SEALED now, not plaintext columns;
//   · the actor is stamped (`system:mailbox/<provider>/<userId>`), which the
//     old writer left NULL against the standing rule, and which is also what
//     makes "remove everything I logged" able to find her rows and only hers;
//   · the body is the real message with the quoted reply trimmed, not Gmail's
//     snippet, because a record of a conversation that stops at 100 characters
//     is not a record of the conversation;
//   · her never-log list and her pause switch are consulted every run.
// ── FIX-33 · EVERY RUN LEAVES A ROW ────────────────────────────────────────
// "Connected · not read yet" was all the card could say, because a run that
// threw, returned early or hung left no trace anywhere: last_synced_at was
// written only at the very end of a run that finished. Now every mail read,
// calendar read and push writes one mailbox_sync_runs row when it starts and
// closes it with what it found or the one plain sentence of what went wrong.
// The health panel, the reconnect banner, the error digest and the prod smoke
// read only these rows.
const SYNC_STALE_MS = 2 * 3600e3;
// SPLIT-2 end
__share({ SYNC_STALE_MS });
// SPLIT-2 server.js piece 617
let mailboxSyncHealth = { connections: null, stale: null, checkedAt: null };
// SPLIT-2 end
__share({ mailboxSyncHealth });
// SPLIT-2 server.js piece 622
// FIX-34 · ONE RUN PER CONNECTION AT A TIME, and a 429 is honoured. The lock
// is a Postgres advisory lock, so it also holds across two instances.
const APIC = require("../../apiCheck");
// SPLIT-2 end
__share({ APIC });
// SPLIT-2 server.js piece 623
const MBF = require("../../mailboxFetch");
// SPLIT-2 end
__share({ MBF });
// SPLIT-2 server.js piece 624
const CLIENT_SAFE = require("../../clientSafe");
// SPLIT-2 end
__share({ CLIENT_SAFE });
// SPLIT-2 server.js piece 625
const SEALED_MAIL = require("../mail/sealedMail");
// SPLIT-2 end
__share({ SEALED_MAIL });
// SPLIT-2 server.js piece 626
const syncLockKey = (kind, conn) => `mailboxsync:${kind}:${conn.id}`;
// SPLIT-2 end
__share({ syncLockKey });
// SPLIT-2 server.js piece 627
const backedOff = conn => conn.retry_after && new Date(conn.retry_after).getTime() > Date.now();
// SPLIT-2 end
__share({ backedOff });
// SPLIT-2 server.js piece 629
const PROVIDER_TIMEOUT_MS = 20000;
// SPLIT-2 end
__share({ PROVIDER_TIMEOUT_MS });
// SPLIT-2 server.js piece 630
const providerFetch = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
// SPLIT-2 end
__share({ providerFetch });
// SPLIT-2 server.js piece 639

// ── FIX-28 · STEWARD'S DATES ON HER OWN CALENDAR ───────────────────────────
// One way, and only when she turned it on (mailbox_connections.push_dates).
// The dated items that are HERS (a grant deadline she is the officer on, her
// next steps and tasks, her journey steps) for the next 60 days go onto her
// connected calendar as all-day entries. A moved item moves there, a finished
// or removed one comes off. Meetings are already on her calendar, and items
// with no one person (shifts, events, sends, pledges) stay on the Steward
// Calendar only. The entries carry no attendees, so the calendar read above
// drops them and they never come back as meetings.
const PUSH_TYPES = ["step", "deadline", "journey"];
// SPLIT-2 end
__share({ PUSH_TYPES });
// SPLIT-2 server.js piece 640
const PUSH_AHEAD_DAYS = 60;
// SPLIT-2 end
__share({ PUSH_AHEAD_DAYS });
// SPLIT-2 server.js piece 645
// FIX-34 · A CALENDAR RUN WITH NOTHING NEW IS ONE SMALL CALL. Google is asked
// whether anything changed (deletions included) since the last full read; if
// nothing did, the run stops there. A full read still happens at least every
// 6 hours so events sliding into the window are picked up.
const CAL_FULL_EVERY_MS = 6 * 3600e3;
// SPLIT-2 end
__share({ CAL_FULL_EVERY_MS });
// SPLIT-2 server.js piece 646
// FIX-34 · GRAPH DELTA AS THE "ANYTHING NEW?" QUESTION. Each folder keeps its
// deltaLink on the connection (graph_delta: { inbox, sent, calendar } each
// { link, at }). A stored link younger than 6 hours is asked once: no changes
// is one small call and the run stops. Otherwise the link is (re)made by
// paging a delta from now (mail) or over the calendar window, and the full
// read runs. A 410 (link gone) or any other refusal is a full read; a 429 waits.
const GRAPH_DELTA_FULL_MS = 6 * 3600e3;
// SPLIT-2 end
__share({ GRAPH_DELTA_FULL_MS });
// SPLIT-2 server.js piece 647
const graphDeltaStart = (key) => {
  const g = GRAPH_BASE() + "/v1.0/me";
  if (key === "calendar") {
    const CLW = { past: 30, ahead: 60 };   // shared/calendarLog.js WINDOW_PAST_DAYS / WINDOW_AHEAD_DAYS
    return `${g}/calendarView/delta?` + new URLSearchParams({ startDateTime: new Date(Date.now() - CLW.past * 864e5).toISOString(),
      endDateTime: new Date(Date.now() + CLW.ahead * 864e5).toISOString() });
  }
  const folder = key === "inbox" ? "Inbox" : "SentItems";
  return `${g}/mailFolders('${folder}')/messages/delta?` + new URLSearchParams({ $select: "id",
    $filter: `receivedDateTime ge ${new Date(Date.now() - 5 * 60e3).toISOString()}` });
};
// SPLIT-2 end
__share({ graphDeltaStart });
// SPLIT-2 server.js piece 655

/**
 * ONLY MESSAGES THAT ALREADY INVOLVE SOMEBODY ON FILE ARE ASKED FOR.
 * The query sent to the provider names the addresses; anything else in the
 * mailbox is never returned, so Steward never holds it even in memory.
 */
// The provider roots, read per call so a suite's stand-in (GMAIL_API_BASE,
// GRAPH_API_BASE) serves every mail URL, the attachments included.
const GMAIL_BASE = () => process.env.GMAIL_API_BASE || "https://gmail.googleapis.com";
// SPLIT-2 end
__share({ GMAIL_BASE });
// SPLIT-2 server.js piece 656
const GRAPH_BASE = () => process.env.GRAPH_API_BASE || "https://graph.microsoft.com";
// SPLIT-2 end
__share({ GRAPH_BASE });
// SPLIT-2 server.js piece 658

const addrOf = s => { const m = String(s || "").match(/<([^>]+)>/); return (m ? m[1] : String(s || "")).trim().toLowerCase(); };
// SPLIT-2 end
__share({ addrOf });
// SPLIT-2 server.js piece 659
// THREAD-3: the few headers that tell a person's email from a newsletter, a
// receipt or an automatic reply (shared/mailboxLog.js mailKind). Read, used to
// decide, and kept only as the one word the decision produced.
const MAIL_KIND_HEADERS = ["auto-submitted", "x-autoreply", "x-autorespond", "precedence", "list-unsubscribe", "list-id"];
// SPLIT-2 end
__share({ MAIL_KIND_HEADERS });
// SPLIT-2 server.js piece 669

// ── Events ────────────────────────────────────────────────────────────────────


// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA
// ════════════════════════════════════════════════════════════════════════════
// shared/eventShape.js holds the rule: a ticket is a gift that bought
// something, and the receipt says so. Levels carry price and fair-market
// value; registration writes the gift through recordGift with the split on it,
// so the EXISTING receipt path states "$90 deductible" with no second receipt
// renderer. A sponsor who has not paid yet is a PLEDGE, not money.
let EV = null;
// SPLIT-2 end
__share({ EV });
// SPLIT-2 server.js piece 670
const EV_READY = import("../../shared/eventShape.js").then(m => { EV = m; __share({ EV }); return m; });
// SPLIT-2 end
__share({ EV_READY });
// SPLIT-2 server.js piece 671
const rbCentsEv = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ rbCentsEv });
// SPLIT-2 server.js piece 675

// ── BUILD-101 — MEMBERSHIPS ───────────────────────────────────────────────
// A membership is one person on one level. Its payment is a GIFT through
// recordGift with the level's fair-market value as the quid-pro-quo, so the
// existing receipt states the deductible split and the ledger posts once:
// membership money and donation money are the same rows, and the split is a
// fact on the gift, never a second total.
let MB = null;
// SPLIT-2 end
__share({ MB });
// SPLIT-2 server.js piece 676
const MB_READY = import("../../shared/membership.js").then(m => { MB = m; __share({ MB }); return m; });
// SPLIT-2 end
__share({ MB_READY });
// SPLIT-2 server.js piece 677
const mbCents = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ mbCents });
// SPLIT-2 server.js piece 685

// §5 — the theme a donor's browser receives. Colors are normalized to WCAG-
// legible values at SAVE time (normalizeAccent, the one contrast impl shared
// with org branding); this re-checks at render and falls back to the designed
// neutral default rather than ever shipping an unreadable portal.
const PORTAL_DEFAULT_THEME = { primary: "#1a6b4a", primaryFg: "#ffffff", accent: "#c9a84c", accentFg: "#0f1a12" };
// SPLIT-2 end
__share({ PORTAL_DEFAULT_THEME });
// SPLIT-2 server.js piece 686

// BUILD-48 theme-depth ENUMS. Type pairing keys resolve to font stacks in
// client/src/lib/portalTheme.js (fixed client code — the org supplies only a
// validated KEY, never a font string/URL, so theming is not a CSS/font
// injection surface; parity with the client map is pinned by
// tests/theme-depth.test.js). Card style is the same shape: one enum.
const PORTAL_TYPE_PAIRINGS = ["dm", "classic", "editorial", "literary", "modern"];
// SPLIT-2 end
__share({ PORTAL_TYPE_PAIRINGS });
// SPLIT-2 server.js piece 687
const PORTAL_CARD_STYLES = ["rounded", "square", "soft-shadow"];
// SPLIT-2 end
__share({ PORTAL_CARD_STYLES });
// SPLIT-2 server.js piece 689

// ── BUILD-60 — the giving page is the ORG's page ────────────────────────────
// The public /give flow must be indistinguishable from the org's own site:
// the org's colors, logo, type pairing, banner and white-label display name —
// from the SAME portal theme the portal already uses (portalCardTheme), never
// Steward's mark or emerald. An org with no theme falls back to the designed
// neutral portal default (never a Steward brand color).
//
// Per-frequency amount ladders (Part 2): defaults live here; an org overrides
// them on portal_settings.onetime_amounts / monthly_amounts.
const GIVE_ONETIME_DEFAULT = [25, 50, 100, 250, 500];
// SPLIT-2 end
__share({ GIVE_ONETIME_DEFAULT });
// SPLIT-2 server.js piece 690
const GIVE_MONTHLY_DEFAULT = [10, 25, 50, 100, 250];
// SPLIT-2 end
__share({ GIVE_MONTHLY_DEFAULT });
// SPLIT-2 server.js piece 694

// The theme columns every public /give endpoint selects from portal_settings.
// Aliased to the names portalCardTheme + giveThemePayload read. LIST-3: the
// logo falls back to Settings → Branding's (orgs.logo_data), so a logo saved
// there reaches the giving page; every query here joins orgs as `o`.
const GIVE_THEME_COLS = `ps.display_name,
  COALESCE(ps.logo_url, ps.logo_data, o.logo_data) AS give_logo,
  COALESCE(ps.header_image_url, ps.header_image_data) AS give_header_image,
  ps.header_focal_x, ps.header_focal_y, ps.header_crop,
  ps.primary_color, ps.accent_color, ps.button_color, ps.background_tint,
  ps.type_pairing, ps.card_style,
  ps.footer_text AS give_footer, ps.contact_email AS give_contact, ps.ein_line AS give_ein,
  ps.powered_by, ps.onetime_amounts, ps.monthly_amounts,
  ps.enabled AS portal_enabled`;
// SPLIT-2 end
__share({ GIVE_THEME_COLS });
// SPLIT-2 server.js piece 695

// ── Rate limits (P-3/S-5) ──────────────────────────────────────────────────
// The x-test-* headers are honored ONLY under DISABLE_RATE_LIMIT=1 (the local
// scratch stack): they let the scripted-burst suite exercise the REAL limiter
// while every other suite stays unthrottled. Production ignores them entirely.
const portalLimiterSkip = (req) => rateLimitDisabled() && !req.headers["x-test-enforce-limits"];
// SPLIT-2 end
__share({ portalLimiterSkip });
// SPLIT-2 server.js piece 696
const portalLimiterIpKey = (req) =>
  (rateLimitDisabled() && req.headers["x-test-limit-bucket"])
    ? String(req.headers["x-test-limit-bucket"]) : ipKeyGenerator(req.ip);
// SPLIT-2 end
__share({ portalLimiterIpKey });
// SPLIT-2 server.js piece 697
const portalLinkIpLimiter = rateLimit("portalLinkIpLimiter", {
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-ip:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ portalLinkIpLimiter });
// SPLIT-2 server.js piece 698
const portalLinkEmailLimiter = rateLimit("portalLinkEmailLimiter", {
  windowMs: 15 * 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "plink-em:" + String(req.body?.email || "").toLowerCase().trim().slice(0, 200),
});
// SPLIT-2 end
__share({ portalLinkEmailLimiter });
// SPLIT-2 server.js piece 699
const portalMutationLimiter = rateLimit("portalMutationLimiter", {
  windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: portalLimiterSkip,
  keyGenerator: (req) => "pmut:" + portalLimiterIpKey(req),
});
// SPLIT-2 end
__share({ portalMutationLimiter });
// SPLIT-2 server.js piece 701

// SECURE-1 · no SVG. An SVG is a document that can carry script, and these
// bytes are served from the app's own domain, so a logo could have read a
// signed-in session. The browser draws an SVG as a PNG before it uploads
// (client/src/lib/imageResize.js svgToPng); a raw SVG is refused here.
const PORTAL_IMG_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// SPLIT-2 end
__share({ PORTAL_IMG_MIMES });
// SPLIT-2 server.js piece 702

// BUILD-51 — server-side dimension validation for theme images. SVGs are
// vectors (scale losslessly) and skip the raster rules; rasters must parse.
// The header rule exists because the takeover renders it as a ~5:1 banner
// crop: a portrait image can only decapitate its subject, so it's rejected
// outright (with the Settings crop preview showing WHY before upload).
// ── BUILD-86 FIX — THE BYTES MUST BE WHAT THE UPLOAD SAYS THEY ARE ────────
// Rejection of malformed uploads used to rest entirely on `imageSize` failing
// to parse them, which is a DEPENDENCY'S FAILURE MODE, not a check. Three junk
// bytes declared as PNG return {width:0,height:0,type:"tga"} on one machine
// and something else on another — so the same upload was refused locally and
// accepted in CI, and the suite that caught it (portal-page) was right both
// times. A guard that only works where its library happens to give up is not a
// guard.
//
// This is the deterministic half: the magic number has to agree with the MIME
// the caller declared. It is also strictly STRONGER than what it replaces,
// because it closes "declare PNG, send something else" — which parsed fine and
// was never refused at all.
const IMAGE_MAGIC = {
  "image/png":  b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif":  b => b.length >= 6 && (b.slice(0, 6).toString("latin1") === "GIF87a" || b.slice(0, 6).toString("latin1") === "GIF89a"),
  "image/webp": b => b.length >= 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP",
  // SVG is text: it must actually contain an <svg> element, not merely claim to.
  "image/svg+xml": b => /<svg[\s>]/i.test(b.slice(0, 2048).toString("utf8")),
};
// SPLIT-2 end
__share({ IMAGE_MAGIC });
// SPLIT-2 server.js piece 706

// ── BUILD-65 Part 1 — uploads should not make anyone think about bytes ──────
// The 350KB cap (validPortalImage's old 500000-char limit) was vestigial from
// the base64-in-the-row era: it existed because the image string was stored in
// a DB column and echoed in every payload. Since BUILD-51 the BYTES live behind
// the asset seam and only a /portal-assets/ URL rides payloads — so the only
// real limits are (a) don't accept a decompression bomb, (b) don't store a
// 15MB master. We RESIZE + COMPRESS on ingest instead of rejecting: a phone
// photo (3–5MB) is the case every org starts with, and it must just work.
//
// Accept up to ~15MB of actual image (≈ 20MB of base64 + JSON — the upload
// routes carry a 22mb body cap for this). Reject only non-images and genuinely
// absurd payloads, with words a nonprofit staffer can act on — never a byte
// count they have to satisfy in Photoshop.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;                 // ~15MB of decoded image
// SPLIT-2 end
__share({ MAX_UPLOAD_BYTES });
// SPLIT-2 server.js piece 707
const MAX_UPLOAD_STR = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 1024; // its base64 length + slack
// SPLIT-2 end
__share({ MAX_UPLOAD_STR });
// SPLIT-2 server.js piece 708
// The largest each slot actually renders at. We cap the LONG edge here so the
// stored master is never bigger than the biggest place it's shown; the ?w=
// route still serves smaller responsive variants on demand (each cached once).
const UPLOAD_LONG_EDGE = { header: 2560, campaign: 2560, widget: 2560, impact: 2000, logo: 1200 };
// SPLIT-2 end
__share({ UPLOAD_LONG_EDGE });
