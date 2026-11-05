// SPLIT-2: moved VERBATIM from server.js (the statements from lines 1070-6883, in order). server.js requires the boot modules in
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
let BUILD_SHA, DB_NAME, GR, OUTBOX, PRODUCT_ID, actor, app, assetHealth, backgroundTicksDisabled, billingModeStatus, bootGate, computeDriftForDonors, crypto, dbReady, displayNameCase, dpaViewer, enrollInSequences, guardFailures, guardState, guardsOk, ipKeyGenerator, ledgerChartSelfHeals, mailboxSyncHealth, maybeStartJourneyFromServer, newId, notifyFailedPending, openGiftThread, orgToday, orgTz, publicAppUrl, query, queueThankYouDraft, rateLimit, rateLimitDisabled, rateLimitHandler, recomputeScoresForOrg, reconciliationHealth, refreshStoredDrift, requireAuth, requireSuperAdmin, resolvePublicAppUrl, run, runVolunteerRemindersTick, signInternalToken, statusCheckOnce, unlapseHeldByPledge, webhookSubHealth, wrap;
__boot.register(c => {
  if ("BUILD_SHA" in c) BUILD_SHA = c.BUILD_SHA;
  if ("DB_NAME" in c) DB_NAME = c.DB_NAME;
  if ("GR" in c) GR = c.GR;
  if ("OUTBOX" in c) OUTBOX = c.OUTBOX;
  if ("PRODUCT_ID" in c) PRODUCT_ID = c.PRODUCT_ID;
  if ("actor" in c) actor = c.actor;
  if ("app" in c) app = c.app;
  if ("assetHealth" in c) assetHealth = c.assetHealth;
  if ("backgroundTicksDisabled" in c) backgroundTicksDisabled = c.backgroundTicksDisabled;
  if ("billingModeStatus" in c) billingModeStatus = c.billingModeStatus;
  if ("bootGate" in c) bootGate = c.bootGate;
  if ("computeDriftForDonors" in c) computeDriftForDonors = c.computeDriftForDonors;
  if ("crypto" in c) crypto = c.crypto;
  if ("dbReady" in c) dbReady = c.dbReady;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("dpaViewer" in c) dpaViewer = c.dpaViewer;
  if ("enrollInSequences" in c) enrollInSequences = c.enrollInSequences;
  if ("guardFailures" in c) guardFailures = c.guardFailures;
  if ("guardState" in c) guardState = c.guardState;
  if ("guardsOk" in c) guardsOk = c.guardsOk;
  if ("ipKeyGenerator" in c) ipKeyGenerator = c.ipKeyGenerator;
  if ("ledgerChartSelfHeals" in c) ledgerChartSelfHeals = c.ledgerChartSelfHeals;
  if ("mailboxSyncHealth" in c) mailboxSyncHealth = c.mailboxSyncHealth;
  if ("maybeStartJourneyFromServer" in c) maybeStartJourneyFromServer = c.maybeStartJourneyFromServer;
  if ("newId" in c) newId = c.newId;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("openGiftThread" in c) openGiftThread = c.openGiftThread;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("queueThankYouDraft" in c) queueThankYouDraft = c.queueThankYouDraft;
  if ("rateLimit" in c) rateLimit = c.rateLimit;
  if ("rateLimitDisabled" in c) rateLimitDisabled = c.rateLimitDisabled;
  if ("rateLimitHandler" in c) rateLimitHandler = c.rateLimitHandler;
  if ("recomputeScoresForOrg" in c) recomputeScoresForOrg = c.recomputeScoresForOrg;
  if ("reconciliationHealth" in c) reconciliationHealth = c.reconciliationHealth;
  if ("refreshStoredDrift" in c) refreshStoredDrift = c.refreshStoredDrift;
  if ("requireAuth" in c) requireAuth = c.requireAuth;
  if ("requireSuperAdmin" in c) requireSuperAdmin = c.requireSuperAdmin;
  if ("resolvePublicAppUrl" in c) resolvePublicAppUrl = c.resolvePublicAppUrl;
  if ("run" in c) run = c.run;
  if ("runVolunteerRemindersTick" in c) runVolunteerRemindersTick = c.runVolunteerRemindersTick;
  if ("signInternalToken" in c) signInternalToken = c.signInternalToken;
  if ("statusCheckOnce" in c) statusCheckOnce = c.statusCheckOnce;
  if ("unlapseHeldByPledge" in c) unlapseHeldByPledge = c.unlapseHeldByPledge;
  if ("webhookSubHealth" in c) webhookSubHealth = c.webhookSubHealth;
  if ("wrap" in c) wrap = c.wrap;
  if ("webhookSubStatus" in c) webhookSubStatus = c.webhookSubStatus;
  if ("_journeyEngine" in c) _journeyEngine = c._journeyEngine;
  if ("_volunteerReminders" in c) _volunteerReminders = c._volunteerReminders;
  if ("_sendDraft" in c) _sendDraft = c._sendDraft;
  if ("_volunteerSignUp" in c) _volunteerSignUp = c._volunteerSignUp;
  if ("GC" in c) GC = c.GC;
  if ("GREET" in c) GREET = c.GREET;
  if ("ACK" in c) ACK = c.ACK;
  if ("VH" in c) VH = c.VH;
  if ("VOL_DAYS" in c) VOL_DAYS = c.VOL_DAYS;
  if ("CAL" in c) CAL = c.CAL;
  if ("_fiveXXWindow" in c) _fiveXXWindow = c._fiveXXWindow;
  if ("RB" in c) RB = c.RB;
});

// SPLIT-2 server.js piece 176

// ── BUILD-63 Part 2 — the event-manifest vs live-subscription diff ───────────
// A handler that grows a `case` nobody subscribed becomes SILENT working code
// (the BUILD-58 refund/dispute class). This caches the diff between the manifest
// (stripeEvents.js, pinned to the handler by tests/webhook-manifest.test.js) and
// the LIVE endpoint's subscribed event list, so /health surfaces the count.
// missingCount > 0 = handled events that will never arrive — go subscribe them.
let webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] };
// SPLIT-2 end
__share({ webhookSubStatus });
// SPLIT-2 server.js piece 179

// ── BUILD-88a A.1 — ONE GIFT, ONE PATH ────────────────────────────────────
// A gift typed anywhere — the gift form, Log a conversation, an event's
// attendee row, a Stripe charge, and later the deposit sheet — is written ONCE,
// as a gift row, through this function. Before it there were five inserts, and
// they disagreed about what a gift IS: two wrote no fund, four wrote no payment
// method, three bumped the donor's totals with their own UPDATE, and each wrote
// its own timeline sentence with the AMOUNT COPIED INTO THE TEXT. That copy is
// the Renee Castillo defect: the profile drew the gift once from the gift row
// and once from the sentence beside it, and the record showed one $5,000 gift
// twice.
//
// THREE RULES, and they are the whole of it.
//  1. A gift row always carries a fund and a payment method. With no fund
//     chosen it takes the org's unrestricted fund; with no method it says
//     "Needs you" rather than nothing, because a blank is indistinguishable
//     from "nobody has looked".
//  2. The timeline entry LINKS to the gift (interactions.gift_id) and holds no
//     copy of the amount. Every reader — the header total, Giving this year,
//     Drift, the bookkeeper's export, receipts, the Finance ledger — reads the
//     gift row.
//  3. The ledger is posted under the BUILD-83 rule: imported history never
//     posts; a live gift posts if the org keeps posting on.
//
// The caller owns everything that is not writing the gift: attribution,
// pledges, receipts, workflows, threads, tasks. Those are decisions ABOUT a
// gift; this is the gift.
const GIFT_METHOD_UNKNOWN = "Needs you";
// SPLIT-2 end
__share({ GIFT_METHOD_UNKNOWN });
// SPLIT-2 server.js piece 181

// recordGift(o) → { gift, duplicate } — `duplicate` means the conflict key had
// already claimed this gift and NOTHING was written a second time (no donor
// delta, no ledger stamp, no timeline entry). Every caller must honour it.
// ── THREAD-2a · THE ONE SEAM BETWEEN recordGift AND THE JOURNEY ENGINE ────
// `maybeStartJourney` lives in routes/crm.js, beside `advanceCultivationPlan`
// and the plan reader it is built on — moving it here would split the plan
// machinery across two files for no gain. But `recordGift` lives HERE and is
// the only honest place to know a gift was someone's first.
//
// So crm.js hands its engine back at mount time, and this is the holder. It
// is a function, not a direct import, because routes/crm.js is required AFTER
// this file's body has run; a top-level require would be a cycle.
//
// A NULL ENGINE IS A NO-OP, NOT A THROW. Suites that boot only part of the
// app, and the window between this file's body and mount(), must not turn a
// donation into a 500 because a journey could not start.
let _journeyEngine = null;
// SPLIT-2 end
__share({ _journeyEngine });
// SPLIT-2 server.js piece 183
// VOL-1 — the shift-reminder sweep, handed back by routes/volunteerScheduling
// at mount time, for the same reason the journey engine is: that file is
// required after this one's body has run.
let _volunteerReminders = null;
// SPLIT-2 end
__share({ _volunteerReminders });
// SPLIT-2 server.js piece 184
// PARITY-3 — two more seams of the same kind. The one draft sender (crm.js
// sendMilestoneDraft, every mail rule applied at the press), handed to the
// volunteer routes so a coordinator's "Send all" goes through it; and the one
// sign-up path (volunteerScheduling signUp), handed to Your page so a
// volunteer joining a shift there is decided by the same locked transaction.
let _sendDraft = null;
// SPLIT-2 end
__share({ _sendDraft });
// SPLIT-2 server.js piece 185
let _volunteerSignUp = null;
// SPLIT-2 end
__share({ _volunteerSignUp });
// SPLIT-2 server.js piece 187
if (!backgroundTicksDisabled()) {
  // SCALE-1: a queue job (jobQueue.js), so one replica runs it, not each.
  require("../../jobQueue").define("runVolunteerRemindersTick", { everyMs: 60 * 60 * 1000, firstMs: 60000, run: runVolunteerRemindersTick });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 190

// ── ENGAGE-1 — THE TWO SCORES ──────────────────────────────────────────────
// engagement.js computes; server/donors/handlers/scores.js is when (SCORES-1:
// the people a change touched, folded per org; the full pass every six hours
// and once after an import). Off the request path.
const engagementMod = require("../../engagement");
// SPLIT-2 end
__share({ engagementMod });
// SPLIT-2 server.js piece 191
const scheduleScores = (orgId, donorIds = null, opts = {}) => require("../donors/handlers/scores").schedule(orgId, donorIds, opts);
// SPLIT-2 end
__share({ scheduleScores });
// SPLIT-2 server.js piece 192
// ARCH-1: one full pass per org at a time, in this process and (the advisory
// lock) across processes. A caller that must see its own answer waits; the
// scheduled and queued passes (`wait: false`) give up and ask again later.
const _scoreRuns = new Map();
// SPLIT-2 end
__share({ _scoreRuns });
// SPLIT-2 server.js piece 194
// LIVE-1 — the after-change step's helpers, handed over once at boot.
const AFTER = require("../../afterChange");
// SPLIT-2 end
__share({ AFTER });
// SPLIT-2 server.js piece 195
AFTER.configure({ query, run, GR, orgToday, orgTz, scheduleScores, computeDriftForDonors, unlapseHeldByPledge });
// SPLIT-2 end
// SPLIT-2 server.js piece 196
// JOBS-1 — what the handlers call, handed over once; then the handlers, one file each.
OUTBOX.configure({ query, queueThankYouDraft, enrollInSequences, maybeStartJourneyFromServer, recomputeScoresForOrg, openGiftThread,
  afterChangeNow: AFTER.afterChangeNow });
// SPLIT-2 end
// SPLIT-2 server.js piece 197
for (const h of ["outreach/handlers/thankYouDraft", "outreach/handlers/sequences", "outreach/handlers/journeys",
                 "donors/handlers/afterChange", "donors/handlers/scores", "insights/store"]) require(`../${h}`);
// SPLIT-2 end
// SPLIT-2 server.js piece 198
// SCALE-2: the per-org summary (orgSummary.js) and the in-process door the
// Home bundle and the summary's refresh use (inProcess.js). An internal token
// is signed for one stored answer's recompute and never leaves this process.
require("../../inProcess").configure(app);
// SPLIT-2 end
// SPLIT-2 server.js piece 200
const ORG_SUMMARY = require("../../orgSummary");
// SPLIT-2 end
__share({ ORG_SUMMARY });
// SPLIT-2 server.js piece 201
ORG_SUMMARY.configure({ orgTz, orgToday, signInternalToken });
// SPLIT-2 end
// SPLIT-2 server.js piece 202
require("../../jobQueue").handle("orgSummaryRefresh", (payload) => ORG_SUMMARY.refreshOrg(payload && payload.orgId));
// SPLIT-2 end
// SPLIT-2 server.js piece 204
require("../../jobQueue").define("refreshStoredDrift", { everyMs: 6 * 60 * 60 * 1000, firstMs: 10 * 60 * 1000, run: () => refreshStoredDrift() });
// SPLIT-2 end
// SPLIT-2 server.js piece 205
require("../../jobQueue").define("orgSummaryCheck", { everyMs: 24 * 60 * 60 * 1000, firstMs: 20 * 60 * 1000, run: () => ORG_SUMMARY.checkAll() });
// SPLIT-2 end
// SPLIT-2 server.js piece 206
// FIX-33, and LIVE-1: a meeting synced from the calendar is a change to the
// people in it, so it runs the after-change step (which schedules the scores).
// SCORES-1: a change that names nobody waits for the six-hour pass.
require("../../meetingEffects").onChange = (orgId, ids) => {
  if (ids && ids.length) AFTER.afterChangeSoon(orgId, ids, { door: "mail_calendar_sync", recalc: false });
};
// SPLIT-2 end
// SPLIT-2 server.js piece 208

// ── BUILD-98 Part 1 — SOFT CREDITS, TRIBUTES, MATCHES ──────────────────────
// shared/giftCredit.js holds the rule; these are its only writers. Every id a
// caller names is checked against THIS org before anything is written, and a
// gift's extras are checked BEFORE the gift is written, so a refused soft
// credit refuses the gift rather than leaving half of it behind.
let GC = null;
// SPLIT-2 end
__share({ GC });
// SPLIT-2 server.js piece 209
const GC_READY = import("../../shared/giftCredit.js").then(m => { GC = m; __share({ GC }); return m; });
// SPLIT-2 end
__share({ GC_READY });
// SPLIT-2 server.js piece 210
// FIX-45: what a draft calls somebody (shared/greeting.js), so "Desmond &
// Ruth Okafor" is greeted as both of them. Read through greetFor below.
let GREET = null;
// SPLIT-2 end
__share({ GREET });
// SPLIT-2 server.js piece 211
// THREAD-2: every name in a staff email links into the app (shared/itemLinks.js).
const ItemRefs = require("../../itemRefs");
// SPLIT-2 end
__share({ ItemRefs });
// SPLIT-2 server.js piece 212
const staffLinks = () => ItemRefs.linksNow();
// SPLIT-2 end
__share({ staffLinks });
// SPLIT-2 server.js piece 213
const GREET_READY = import("../../shared/greeting.js").then(m => { GREET = m; __share({ GREET }); return m; });
// SPLIT-2 end
__share({ GREET_READY });
// SPLIT-2 server.js piece 219

// One donor's credit, the census lines' hard and soft figures (FIX-51).
const { donorCreditTotals } = require("../../creditTotals");
// SPLIT-2 end
__share({ donorCreditTotals });
// SPLIT-2 server.js piece 220


// ---- BUILD-89S 89a - GIVING SOURCES: THE RUNNER --------------------------
//
// "Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a
// dollar." Everything below is downstream of that sentence.
//
// syncSource() takes the rows an adapter returns and writes every one of them
// through recordGift - the A.1 path, never a second INSERT. That is not
// tidiness: the fund rule, the payment-method rule, the ledger rule, the
// instalment match, the thank-you draft and the actor stamp all live in
// recordGift, and a gift that arrived from PayPal is a gift.
//
// THE RULES, AND WHY EACH ONE IS THE WAY IT IS
//
// DE-DUPLICATION is on provider + the provider's own id, org-scoped, through
// the `external_id` unique index recordGift already honours. Namespaced
// ("paypal:8XN...") so the PayPal CSV a bookkeeper uploads (89d) and the
// PayPal API reading the same transaction land on ONE gift, and so two
// providers reusing a short numeric id can never collide. Running a sync
// twice writes nothing the second time, and that is asserted, not assumed.
//
// DONOR MATCH is exact email, or a new donor. It is NEVER a name match: a
// guessed merge is a lost donor. A name that matches somebody already on file
// with a different or missing email lands on a NEW person and is REPORTED -
// the pair surfaces in /donors/duplicates, which is the one-tap merge that
// already exists, and the run summary says how many there were so nobody has
// to go looking. One tap, never zero, and never none.
//
// FUND is the source's default if an admin set one, otherwise nothing -
// `defaultFund: false`, which is recordGift's donor-initiated case. A memo
// reading "building fund" is not a designation; a designation is an
// accounting fact somebody at the organisation is accountable for.
//
// FEES: the gift is the GROSS. The donor gave the gross. The fee is stored
// beside it and never shows as the gift amount.
//
// THE LEDGER follows BUILD-83: the FIRST read of a source is import history
// and never posts. Everything after it is a live gift and posts if the org
// keeps posting on. `backfilled_at` on the source row is the whole mechanism.
//
// ONLY MONEY IN. Transfers to the bank, payouts, fees billed as their own
// line, purchases: dropped at the adapter and again at normalizeRow, which
// refuses a non-positive amount. No part of this runner knows what a payout
// is.
//
// REFUNDS ARE NOT REVERSED IN THIS BUILD, ON PURPOSE. 89a's brief says to use
// whatever refund path exists today and, if there is none, to skip the row,
// count it and say so rather than invent refund accounting. What exists today
// is the Stripe webhook's inline full-refund branch, and it DELETES the gift -
// which on this path would be actively wrong: the provider still returns the
// original payment as a completed row, so the next sync would re-create the
// gift it had just deleted, forever. So:
//   - a row that arrives ALREADY refunded is not written at all (money that
//     came in and went back out is not a gift), and is counted;
//   - a row that reads refunded and whose gift IS already on file is counted
//     and NAMED on the run summary, so a human is told exactly which gift to
//     look at rather than a number being silently wrong.
// Named for its own build at the time.
const SOURCE_SYNC_MAX_PAGES = 400;
// SPLIT-2 end
__share({ SOURCE_SYNC_MAX_PAGES });
// SPLIT-2 server.js piece 221
const SOURCE_SYNC_RESYNC_DAYS = 3;   // providers publish late; re-read and let dedupe work
// SPLIT-2 end
__share({ SOURCE_SYNC_RESYNC_DAYS });
// SPLIT-2 server.js piece 222
const SYS_SOURCE = { id: "system:giving-source", name: "Connected giving source" };
// SPLIT-2 end
__share({ SYS_SOURCE });
// SPLIT-2 server.js piece 235

// CONNECT-2: the refusals that are about a broken ROW, and the words the
// card shows beside each one. Money going out, a pending payment and a
// refund are not problems and are counted, not listed.
const SKIP_LISTED_REASONS = {
  no_external_id: "The provider sent no id for this row, so Steward could not be sure it would not be read twice.",
  bad_date: "The date on this row could not be read, and Steward never guesses a date.",
  bad_amount: "The amount on this row could not be read as money.",
  bad_status: "The provider gave this row a status Steward does not recognize.",
  fee_exceeds_gross: "The fee on this row is larger than the gift, which means the provider's figures are the wrong way round.",
};
// SPLIT-2 end
__share({ SKIP_LISTED_REASONS });
// SPLIT-2 server.js piece 236
const SKIPPED_KEPT = 100;
// SPLIT-2 end
__share({ SKIPPED_KEPT });
// SPLIT-2 server.js piece 238

// ── BUILD-92 A3 — THE SAME GIFT FROM TWO PLACES ────────────────────────────
//
// De-duplication is per source, by the provider's own id, and that is right:
// forty $100 Sunday gifts are forty gifts, and only the provider can say which
// two rows are one payment. But Donorbox runs on the ORGANISATION'S OWN Stripe
// and PayPal. Connect all three and the same money arrives three times, under
// three ids, and every figure in the product trebles.
//
// THE RULE: a row from source B that matches a gift already on file from a
// DIFFERENT source on
//   · the amount, to the cent,
//   · the date, within two days (Cowork's window - a provider settles and
//     reports on its own schedule, and the two rarely land the same day),
//   · and the donor (the same donor record, or the same email address)
// is NOT written. It becomes ONE LINE that asks, with two answers.
//
// It is never silently dropped and never silently doubled. The provider's
// whole row is kept on the question, so "Keep both" can write it later
// without going back to the provider.
//
// CROSS-SOURCE ONLY. Two genuine same-day $50 gifts from one donor inside ONE
// source are two gifts and always were; this rule cannot see them.
const CROSS_SOURCE_DAY_WINDOW = 2;
// SPLIT-2 end
__share({ CROSS_SOURCE_DAY_WINDOW });
// SPLIT-2 server.js piece 246

// The sentence for a refused CREDENTIAL, per provider. It names the exact
// fields the person pasted, because "the key was refused" leaves them looking
// at four boxes wondering which one. Kept in the voice of PROVIDERS[].help.
const SOURCE_AUTH_SENTENCE = {
  paypal: "PayPal did not accept this Client ID and Secret. Copy them again from your PayPal app and make sure the app is on Live.",
  zeffy: "Zeffy did not accept this API key. Copy it again from Settings, then Integrations, then API.",
  stripe: "Stripe did not accept this restricted key. Copy it again from Developers, then API keys, and make sure it has not been rolled.",
  givebutter: "Givebutter did not accept this API key. Copy it again from Account, then Integrations, then API.",
};
// SPLIT-2 end
__share({ SOURCE_AUTH_SENTENCE });
// SPLIT-2 server.js piece 247
// The sentence for a key that IS the right key but has not been allowed yet.
// PayPal's is the only one that can honestly promise a delay: Transaction
// Search really is a switch that takes time to come into effect.
const SOURCE_PERMISSION_SENTENCE = {
  paypal: "PayPal has not allowed this yet. A newly enabled Transaction Search permission can take up to a day. Steward will keep trying.",
  zeffy: "Zeffy accepted this key but has not allowed it to read payments. Ask a Zeffy administrator to give the key payment access.",
  stripe: "Stripe accepted this key but it does not have permission to read charges. Edit the restricted key and give it read access to Charges, Subscriptions, Invoices and Customers.",
  givebutter: "Givebutter accepted this key but has not allowed it to read transactions. Check the key's permissions in Account, then Integrations, then API.",
};
// SPLIT-2 end
__share({ SOURCE_PERMISSION_SENTENCE });
// SPLIT-2 server.js piece 249

// ── BUILD-88b B.3 — THE THANK-YOU QUEUE ───────────────────────────────────
// Every gift through the one path earns a DRAFT. Steward never sends it: it
// writes one, she opens it, copies it, and it leaves from her own mail where
// she can read it as the donor will.
//
// FOUR EXCLUSIONS, and each is a case where a thank-you would be WRONG rather
// than merely unnecessary:
//   · a pledge payment under $100 — she thanked them for the pledge; thanking
//     them again every month for the instalment is a receipt pretending to be
//     a letter. A LARGE instalment still earns one.
//   · anonymous — there is nobody to write to, and guessing is worse.
//   · do-not-contact, and deceased — the no-ask family. A thank-you is outbound
//     mail, and the flags exist so nobody has to remember.
//   · a sample donor — demo fiction never generates work.
// Receipts are untouched: a §170 acknowledgment is a legal document on its own
// path, and this is a letter.
const THANK_YOU_PLEDGE_FLOOR_CENTS = 10000;
// SPLIT-2 end
__share({ THANK_YOU_PLEDGE_FLOOR_CENTS });
// SPLIT-2 server.js piece 252
// ENGAGE-1 — A TOUCH MOVES THE SCORES. Any successful staff write to a person,
// a gift, a conversation, an event, a shift, a meeting or a survey schedules
// a recompute of the people it names (SCORES-1, handlers/scores.js), never the
// org. Syncs that arrive without a request are picked up by the six-hour tick.
const SCORE_TOUCH_PATHS = /^\/(donors|gifts|interactions|conversations|threads|events|volunteer|calendar|meetings|recurring|surveys)/;
// SPLIT-2 end
__share({ SCORE_TOUCH_PATHS });
// SPLIT-2 server.js piece 253
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && SCORE_TOUCH_PATHS.test(req.path)) {
    res.on("finish", () => {
      if (res.statusCode >= 400 || !req.user || !req.user.orgId) return;
      const ids = require("../donors/handlers/scores").idsOfRequest(req);
      if (ids.length) scheduleScores(req.user.orgId, ids);
    });
  }
  next();
});
// SPLIT-2 end
// SPLIT-2 server.js piece 254
app.use(require("../../routes/grantMail").routers.r1);     // GRANTS-1 fixed /grants/* paths, ahead of crm's /grants/:id
// SPLIT-2 end
// SPLIT-2 server.js piece 255
app.use(require("../../routes/donorLookups").routers.r0); // SCALE-2: pickers, counts and lookups, ahead of crm's /donors/:id
// SPLIT-2 end
// SPLIT-2 server.js piece 256
app.use(require("../../routes/donorList").routers.r0);    // LIST-1: columns, views and the filter, ahead of crm's /donors/:id
// SPLIT-2 end
// SPLIT-2 server.js piece 257
app.use(require("../../routes/mailTypes").routers.r0);    // SEND-GATE-1/2: which emails Steward sends, the donor's own setting and held mail, ahead of /donors/:id
// SPLIT-2 end
// SPLIT-2 server.js piece 258
app.use(require("../../routes/crm").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 260

app.get("/health", (req, res) => {
  // billing.ok is the cached mode-consistency result (booleans/mode only — no
  // secrets): true = all configured prices resolve under the billing key's mode,
  // false = a test/live mismatch (loud warning already logged), null = not yet
  // checked or nothing to check. Full detail is at /admin/billing-diagnostic.
  // publicUrl: the resolved base every outbound email link uses (non-secret).
  // fromEnv:false means FRONTEND_URL is unset or was rejected as a deployment
  // host and links are riding the canonical fallback — post-deploy this is the
  // one-glance check that reset/invite links carry stewardapp.dev.
  const pu = resolvePublicAppUrl();
  res.json({
    // product + database are the IDENTITY guard: a write script asserts both
    // against what it intended before writing, so it can never write to a
    // different product or database that merely shares a loopback host/port.
    product: PRODUCT_ID, database: DB_NAME,
    status: "ok", version: "1.1.0", buildSha: BUILD_SHA, db: dbReady, sentry: !!process.env.SENTRY_DSN,
    billing: { mode: billingModeStatus.mode, ok: billingModeStatus.ok, checked: billingModeStatus.checked },
    publicUrl: { url: pu.url, fromEnv: pu.fromEnv },
    // BUILD-45 (F-2): non-secret count of internal notifications the email
    // provider rejected and that are pending retry (or exhausted). A non-zero
    // value that stays high = a delivery problem to look at — this figure is
    // the SURFACING that F-2 was missing. Cached (refreshed by the retry sweep),
    // so /health stays a cheap synchronous check.
    notifications: { failedPending: notifyFailedPending },
    // BUILD-58 W-3: how many times a ledger stamp found no usable chart of
    // accounts and had to provision one on the spot. Non-zero = an
    // org-creation path is skipping provisioning — investigate, don't ignore.
    ledger: { chartSelfHeals: ledgerChartSelfHeals },
    // BUILD-51: which theme-asset driver is live — s3:true means uploads go to
    // the bucket; s3:false (env unset) means bytes land in Postgres.
    // BUILD-51b: dbFallbackRows counts assets sitting in Postgres WHILE S3 is
    // configured — every one is a failed S3 put (also Sentry-reported). A
    // non-zero value that grows = the silent-fallback failure mode; null when
    // S3 isn't configured (DB storage is then by design).
    themeAssets: assetHealth(),
    // BUILD-62 Part 3: the reconciliation guard. unrecordedCharges > 0 means a
    // real charge settled at Stripe with NO gift row behind it — a donor was
    // charged and Steward has no record. This is the paging signal (watch it in
    // UptimeRobot alongside themeAssets.dbFallbackRows). orphanGifts is the
    // reverse (a gift with no succeeded charge). checkedAt null = not yet run.
    reconciliation: reconciliationHealth(),
    // BUILD-63 Part 2: manifest-vs-subscription diff. missingCount > 0 means the
    // handler processes event types the live endpoint does NOT subscribe — code
    // wired to nothing. Watch alongside reconciliation. null = not yet checked.
    webhookSubscriptions: webhookSubHealth(),
    // BUILD-65 Part 6: the aggregate. true ONLY when every guard above is both
    // clean AND fresh (a null/stale counter fails it). One field to page on.
    guardsOk: guardsOk(),
    // INT-PROD-1: which guard failed, by name only (never a value), so a
    // false guardsOk never needs a hunt again. [] when guardsOk is true.
    guardsFailed: guardFailures(guardState()),
    // FIX-33: every live mailbox connection, and how many have not read
    // successfully in two hours. Counts only, no address, no org. The prod
    // smoke fails on stale > 0; checkedAt null = no sync run since boot.
    mailboxSync: mailboxSyncHealth,
    // SCALE-1: the background queue (jobQueue.js) and the last five-minute
    // round of per-org syncs: how long it took and its slowest org, by id only.
    // Cached (refreshed every 15s), so /health stays a synchronous read.
    // DEPLOY-1: queue.oldestWaiting and queue.level; `worker` is the newest worker's heartbeat.
    queue: require("../../jobQueue").healthNow().queue,
    tick: require("../../jobQueue").healthNow().tick,
    worker: require("../../jobQueue").healthNow().worker || null,
    // POOL-1: this process's connections, from pg's own counters (server/shared/pools.js).
    pool: require("../../db").poolStats(),
  });
});
// SPLIT-2 end
// SPLIT-2 server.js piece 261
// ═══ TRUST-2 Part 1 · THE STATUS PAGE ═══════════════════════════════════════
// Six services, each with a check that measures something real. A service is
// only on the page because it is checked; a check with nothing to read yet
// says "unknown" and is left out of the percentage rather than counted as up.
// The page lives on this same Railway app, so it goes down with it: /health
// is the endpoint an OUTSIDE monitor should call.
const STATUS_SERVICES = [
  { key: "app", label: "The app", says: "A database read, every minute." },
  { key: "signin", label: "Sign-in", says: "Accounts readable and a session token signed and verified, every minute." },
  { key: "stripe", label: "Stripe gift sync", says: "The reconciliation guard ran recently and found no charge without a gift." },
  { key: "connections", label: "Other connection syncs", says: "The sync for PayPal, Square and the other giving sources ran recently without an error." },
  { key: "email", label: "Email delivery", says: "Resend is configured and no staff notification is stuck waiting to retry." },
  { key: "jobs", label: "Background jobs", says: "Every scheduled job ran within its window, and the latest run of each succeeded." },
];
// SPLIT-2 end
__share({ STATUS_SERVICES });
// SPLIT-2 server.js piece 263
if (!backgroundTicksDisabled()) {
  bootGate.afterMigrations(() => statusCheckOnce().catch(e => console.error("[status]", e.message)), 20000);
  bootGate.everyAfterMigrations(() => statusCheckOnce().catch(e => console.error("[status]", e.message)), 60 * 1000);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 264

// NUMBERS-1 · every number checked every night, counts only (numberCheck.js).
// The tick looks hourly and runs once a day after 05:00 UTC, before the Error
// digest reads the day's logs. The super-admin reads the latest night, and may
// run it now; neither returns a name, an amount or an id.
if (!backgroundTicksDisabled()) {
  bootGate.everyAfterMigrations(() => require("../../numberCheck").nightlyTick(require("../../numbers").screens).catch(e => console.error("[numbers]", e.message)), 60 * 60 * 1000);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 265
app.get("/admin/number-checks", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  res.json({ rows: await require("../../numberCheck").latest() });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 266
app.post("/admin/number-checks/run", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const out = await require("../../numberCheck").runAll({ screens: require("../../numbers").screens });
  res.json({ ranOn: out.ranOn, orgs: out.orgs, problems: out.problems, lines: out.lines });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 267

// PUBLIC. Current state, the last 90 days by day, the percentage computed from
// stored checks (and the date it starts from), and the incidents.
app.get("/status/summary", wrap(async (req, res) => {
  const services = [];
  for (const s of STATUS_SERVICES) {
    const [latest] = await query(`SELECT state, detail, checked_at FROM status_checks WHERE service=? ORDER BY checked_at DESC LIMIT 1`, [s.key]);
    const days = await query(
      `SELECT TO_CHAR(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE state <> 'unknown')::int AS measured,
              COUNT(*) FILTER (WHERE state = 'up')::int AS up,
              COUNT(*) FILTER (WHERE state = 'down')::int AS down
         FROM status_checks WHERE service=? AND checked_at > NOW() - INTERVAL '90 days' GROUP BY 1 ORDER BY 1`, [s.key]);
    const [first] = await query(`SELECT MIN(checked_at) AS since FROM status_checks WHERE service=? AND state <> 'unknown'`, [s.key]);
    const measured = days.reduce((a, d) => a + d.measured, 0), up = days.reduce((a, d) => a + d.up, 0);
    services.push({ ...s, state: latest?.state || "unknown", detail: latest?.detail || null, checkedAt: latest?.checked_at || null,
      days, uptime: measured ? Math.floor((up / measured) * 10000) / 100 : null, measuredChecks: measured,
      since: first?.since || null });
  }
  const incidents = await query(`SELECT id, title, affected, state, created_at, resolved_at FROM status_incidents
                                  WHERE resolved_at IS NULL OR resolved_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 20`);
  for (const i of incidents) i.updates = await query(`SELECT body, state, created_at FROM status_incident_updates WHERE incident_id=? ORDER BY created_at DESC`, [i.id]);
  res.set("Cache-Control", "no-store");
  res.json({ services, incidents, open: incidents.filter(i => !i.resolved_at).length,
    sentence: "Each bar is one day. The percentage is the share of checks that found the service working, counted from the first stored check; a check with nothing to measure is left out rather than counted as up." });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 268

// ═══ TRUST-2 Parts 2 and 3 · WHAT'S NEW AND THE DPA ═════════════════════════
// The entries themselves are files in docs/changelog/ the client bundles;
// the server keeps only which ones a super-admin hid.
app.get("/changelog/hidden", wrap(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ hidden: (await query(`SELECT entry_id FROM changelog_hidden`)).map(r => r.entry_id) });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 269
app.post("/admin/changelog/:id/hide", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const id = String(req.params.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 120);
  if (req.body?.hidden === false) await run(`DELETE FROM changelog_hidden WHERE entry_id=?`, [id]);
  else await run(`INSERT INTO changelog_hidden (entry_id, hidden_by) VALUES (?,?) ON CONFLICT (entry_id) DO NOTHING`, [id, req.user.userId]);
  res.json({ ok: true, hidden: req.body?.hidden !== false });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 270
// THE DPA. Published only when DPA_PUBLISHED=1, which is Jonathan's to set once
// an attorney has read it. Before that, only a super-admin reads the draft.
const dpaPublished = () => process.env.DPA_PUBLISHED === "1";
// SPLIT-2 end
__share({ dpaPublished });
// SPLIT-2 server.js piece 272
app.get("/legal/dpa", wrap(async (req, res) => {
  const D = await import("../../shared/dpa.js");
  const preview = !dpaPublished() && await dpaViewer(req);
  if (!dpaPublished() && !preview) return res.json({ published: false,
    sentence: "Our data processing agreement is with our attorney for review. Write to us and we will send you the draft and tell you when it is final." });
  res.json({ published: dpaPublished(), draft: !dpaPublished(), label: dpaPublished() ? null : D.DPA_DRAFT_LABEL, version: D.DPA_VERSION, sections: D.dpaSections() });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 273
app.get("/legal/dpa.pdf", wrap(async (req, res) => {
  const preview = !dpaPublished() && (await dpaViewer(req));
  if (!dpaPublished() && !preview) return res.status(404).json({ error: "The data processing agreement is not published yet." });
  const D = await import("../../shared/dpa.js");
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 56, size: "LETTER" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="steward-data-processing-agreement.pdf"`);
  doc.pipe(res);
  doc.font("Times-Bold").fontSize(20).text("Data Processing Agreement");
  doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#5a554f").text(`Steward · ${D.DPA_VERSION}${dpaPublished() ? "" : " · " + D.DPA_DRAFT_LABEL}`);
  doc.fillColor("#0f1a12").moveDown(1);
  for (const s of D.dpaSections()) {
    doc.font("Helvetica-Bold").fontSize(12).text(s.h).moveDown(0.3);
    for (const p of s.p || []) doc.font("Helvetica").fontSize(10.5).text(p, { lineGap: 2 }).moveDown(0.5);
    for (const li of s.list || []) doc.font("Helvetica").fontSize(10).text("• " + li, { indent: 8, lineGap: 1.5 }).moveDown(0.25);
    doc.moveDown(0.6);
  }
  doc.end();
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 274

// SUPER-ADMIN: incidents in plain language, updates, and resolve. And a way to
// run the checks now, for a deploy with the background ticks off.
app.post("/admin/status/run-checks", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  req.audit && req.audit.skip("a health check");
  res.json({ results: await statusCheckOnce() });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 275
app.post("/admin/incidents", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 200);
  const body = String(req.body?.body || "").trim().slice(0, 4000);
  const affected = (Array.isArray(req.body?.affected) ? req.body.affected : []).filter(k => STATUS_SERVICES.some(s => s.key === k));
  if (!title || !body) return res.status(400).json({ error: "Say what is affected, and what we are doing about it." });
  const id = newId("inc");
  const who = actor(req);
  await run(`INSERT INTO status_incidents (id,title,affected,created_by,created_by_name) VALUES (?,?,?,?,?)`, [id, title, affected, who.id, who.name]);
  await run(`INSERT INTO status_incident_updates (id,incident_id,body,state,created_by,created_by_name) VALUES (?,?,?,?,?,?)`, [newId("inu"), id, body, "investigating", who.id, who.name]);
  res.status(201).json({ id });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 276
app.post("/admin/incidents/:id/update", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const body = String(req.body?.body || "").trim().slice(0, 4000);
  const state = ["investigating", "identified", "monitoring", "resolved"].includes(req.body?.state) ? req.body.state : null;
  if (!body) return res.status(400).json({ error: "An update needs a sentence." });
  const [i] = await query(`SELECT id FROM status_incidents WHERE id=?`, [req.params.id]);
  if (!i) return res.status(404).json({ error: "No such incident." });
  const who = actor(req);
  await run(`INSERT INTO status_incident_updates (id,incident_id,body,state,created_by,created_by_name) VALUES (?,?,?,?,?,?)`, [newId("inu"), i.id, body, state, who.id, who.name]);
  if (state) await run(`UPDATE status_incidents SET state=?, resolved_at=${state === "resolved" ? "NOW()" : "NULL"} WHERE id=?`, [state, i.id]);
  res.json({ ok: true });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 277

app.use(require("../../routes/give").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 278
app.use(require("../../routes/billing").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 279

// B2 (BUILD-26) — tidy a name arriving from a messy spreadsheet WITHOUT destroying
// signal. Three safe, reversible transforms: (1) collapse runs of whitespace +
// trim; (2) flip a single "Last, First" into "First Last"; (3) re-case a name ONLY
// when the WHOLE string is entirely upper OR entirely lower (ELEANOR FITZGERALD →
// Eleanor Fitzgerald) — any internal mixed case means a human already cased it, so
// it is preserved verbatim (McKinney, O'Brien, van der Berg). Roman-numeral
// suffixes (II/III/IV…) stay upper. The value stays fully editable after import.
// MUST stay in lock-step with normalizeName in shared/importShape.js
// (asserted by tests/name-normalize.test.js parity sweep).
const _ROMAN_SUFFIX = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)$/i;
// SPLIT-2 end
__share({ _ROMAN_SUFFIX });
// SPLIT-2 server.js piece 285

// ── BUILD-46 §3.1 — the Portal tier is NOT the CRM ─────────────────────────
// A plan='portal' org gets: its donor portal, gift recording, receipts, and
// impact updates. The CRM route families below are gated here with ONE
// middleware (mounted before the routes) instead of touching ~40 route
// definitions. The pipeline and portfolio surfaces are already excluded by
// requireCrm (orgPlanTier('portal') === 'portal'). The one carve-out: the basic
// giving-summary report stays available ("no reports beyond basic giving").
// Enforced-and-pinned by tests/network-gate.test.js.
const PORTAL_TIER_BLOCKED_PREFIXES = [
  "/reports", "/campaigns", "/sequences", "/workflows", "/gmail",
  "/board", "/events", "/volunteers", "/grants", "/milestone-drafts",
  "/note-reminders", "/digests",
];
// SPLIT-2 end
__share({ PORTAL_TIER_BLOCKED_PREFIXES });
// SPLIT-2 server.js piece 286
const jwt46 = require("jsonwebtoken");
// SPLIT-2 end
__share({ jwt46 });
// SPLIT-2 server.js piece 287
app.use(PORTAL_TIER_BLOCKED_PREFIXES, wrap(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return next(); // route's own auth 401s
  let payload;
  try { payload = jwt46.verify(auth.slice(7), process.env.JWT_SECRET); } catch { return next(); }
  if (!payload || !payload.orgId) return next();
  const rows = await query("SELECT plan FROM orgs WHERE id=?", [payload.orgId]);
  if (!rows.length || rows[0].plan !== "portal") return next();
  if (req.baseUrl === "/reports" && req.path.startsWith("/giving-summary")) return next();
  return res.status(403).json({
    error: "portal_tier",
    message: "This is part of the Steward CRM. Your Portal plan covers the donor portal, gift recording, receipts, and impact updates, upgrade to Core to unlock the CRM.",
  });
}));
// SPLIT-2 end
// SPLIT-2 server.js piece 288

// ── Moves management & prospect pipeline (BUILD-15) ────────────────────────
// The pipeline reuses the canonical donor-stage set (no second stage field).
// prospect→steward is the forward major-gifts pipeline; lapsed is a trailing
// re-engagement state, not a forward stage. Per-org custom stage editing is a
// deliberately deferred stage on this same field (like the workflow visual
// canvas) — the enum is used app-wide (validation, Kanban, Reports), so it
// stays fixed here.
const PIPELINE_STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward"];
// SPLIT-2 end
__share({ PIPELINE_STAGES });
// SPLIT-2 server.js piece 289
const ALL_PIPELINE_STAGES = [...PIPELINE_STAGES, "lapsed"];
// SPLIT-2 end
__share({ ALL_PIPELINE_STAGES });
// SPLIT-2 server.js piece 291

// ── Smart moves (BUILD-22) ─────────────────────────────────────────────────
// Jonathan's rule: the officer owns stage. The software SUGGESTS every stage
// move and never auto-advances a judgment stage — with ONE exception. Lapsed is
// a fact about giving recency, not a judgment, so it's set automatically (and
// stays editable). FIX-49: the one lapse rule is lapseRule.js (no gift in the
// last 12 months after giving before, on the org's own calendar); every door
// reads it. LAPSE_DAYS is its day count, kept for the callers that import it.
const lapseRule = require("../../lapseRule");
// SPLIT-2 end
__share({ lapseRule });
// SPLIT-2 server.js piece 292
const LAPSE_DAYS = lapseRule.LAPSED_DAYS;
// SPLIT-2 end
__share({ LAPSE_DAYS });
// SPLIT-2 server.js piece 293
// System-authored moves (auto-lapse / auto-unlapse) carry a null officer_id and
// this name, so they're visibly automatic in the timeline and distinguishable
// from human moves (the override-wins guard keys off officer_id IS NOT NULL).
const AUTO_MOVE_OFFICER = "Steward (automatic)";
// SPLIT-2 end
__share({ AUTO_MOVE_OFFICER });
// SPLIT-2 server.js piece 299
app.use(require("../../routes/billing").routers.r1);
// SPLIT-2 end
// SPLIT-2 server.js piece 300

// ── BUILD-98 (switch) Part 8 — TWO-STEP SIGN-IN: THE ROUTES ─────────────────
const TOTP = require("../../totp");
// SPLIT-2 end
__share({ TOTP });
// SPLIT-2 server.js piece 302
app.use(require("../../routes/crm").routers.r1);
// SPLIT-2 end
// SPLIT-2 server.js piece 305

// ── Combined import: new donors + their year-column gift history in one pass ─
// Donor IDs are generated in JS before any DB write so gift rows can reference
// them without a round trip. Both donor and gift inserts are bulk (one statement
// per batch), matching the pattern in /donors/import and matching the gift+
// interaction format that /gifts/import-history and the single-gift route use.
// BUILD-83 FIX — THE ROUND-TRIP BUDGET. Batch size is not a memory knob, it is
// the number of times an import talks to the database, and at workbook scale
// that is the whole cost: every gift batch costs four trips (SAVEPOINT · INSERT
// gifts RETURNING · INSERT interactions · RELEASE). 90,523 gifts at 200/batch
// was 453 batches ≈ 1,800 trips — invisible on a local socket (the write
// measured 16s) and three to four minutes against a hosted database, which is
// the 221.4s measured on production against the same file. Postgres caps a
// statement at 65,535 bound parameters; donors bind 46 and gifts 13, so these
// sizes sit at 46,000 and 26,000 — inside the cap with room, and ~10× fewer
// trips. Raise them only against that cap, and re-measure.
const IMPORT_DONOR_BATCH = Number(process.env.IMPORT_DONOR_BATCH) || 1000;
// SPLIT-2 end
__share({ IMPORT_DONOR_BATCH });
// SPLIT-2 server.js piece 306
const IMPORT_GIFT_BATCH = Number(process.env.IMPORT_GIFT_BATCH) || 2000;
// SPLIT-2 end
__share({ IMPORT_GIFT_BATCH });
// SPLIT-2 server.js piece 310

// Reusable "open pledges with honest remaining balances" aggregate — remaining
// = amount − paid, so a partially-paid pledge counts only what is still
// committed-but-unpaid (F-5). Every "pledged" figure reads this, not SUM(amount).
const OPEN_PLEDGE_REMAINING_JOIN = `
  LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pledge_paid
    ON pledge_paid.pledge_id = pledges.id`;
// SPLIT-2 end
__share({ OPEN_PLEDGE_REMAINING_JOIN });
// SPLIT-2 server.js piece 315
const {
  brandEmailHeaderHtml, consumerEmailHtml, donorFromAddress, donorMailDecision, linkAccountEmail,
  demoMailNote, donorMailDecisions,
  linkEmailToAccounts, orgMaySendEmail, sendCardExpiringEmail, sendDigestEmail, sendDunningEmail, staffUnsubscribeUrl,
  sendBoardPackEmail,
  sendGiftAlertEmail, sendPledgeReminderEmail, sendRawEmail, sendReceiptEmail, sendWorkflowEmail,
  trialReminderEmailHtml, unsubscribeEmailFooterHtml, unsubscribeHeaders, userWantsEmail, briefSettings,
} = require("../../routes/email");
// SPLIT-2 end
__share({ brandEmailHeaderHtml, consumerEmailHtml, donorFromAddress, donorMailDecision, linkAccountEmail, demoMailNote, donorMailDecisions, linkEmailToAccounts, orgMaySendEmail, sendCardExpiringEmail, sendDigestEmail, sendDunningEmail, staffUnsubscribeUrl, sendBoardPackEmail, sendGiftAlertEmail, sendPledgeReminderEmail, sendRawEmail, sendReceiptEmail, sendWorkflowEmail, trialReminderEmailHtml, unsubscribeEmailFooterHtml, unsubscribeHeaders, userWantsEmail, briefSettings });
// SPLIT-2 server.js piece 317
app.use(require("../../routes/give").routers.r1);
// SPLIT-2 end
// SPLIT-2 server.js piece 321


// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT
// ════════════════════════════════════════════════════════════════════════════
// shared/ackLetter.js holds the rules (merge fields refused at save, a field
// with no value named rather than printed blank, amounts summed in cents). This
// is the stack of paper: the backlog, the batch PDF with the address where a
// #10 window is, the labels, and the stamp that says who thanked whom, when
// and how. Steward prints; a person posts. Nothing here sends anything.
let ACK = null;
// SPLIT-2 end
__share({ ACK });
// SPLIT-2 server.js piece 322
const ACK_READY = import("../../shared/ackLetter.js").then(m => { ACK = m; __share({ ACK }); return m; });
// SPLIT-2 end
__share({ ACK_READY });
// SPLIT-2 server.js piece 323
// FIX-10 Part B — the one fiscal-year label, shared with Reports so the server
// and the client cannot name the same year two ways. (NUMBERS-3: a server
// year's short name is shared/numbers/fiscalYear.js chartLabel, held equal to
// fyLabelFromStart by tests/numbers-home.test.js.)
const FISCAL_READY = import("../../shared/fiscalPeriod.js");
// SPLIT-2 end
__share({ FISCAL_READY });
// SPLIT-2 server.js piece 328


// ── BUILD-100 (grants) Part 3 — THE FILES A GRANT CARRIES ──────────────────
// grantDocs.js holds the types, the byte checks and the signed door.
const grantDocs = require("../../grantDocs.js");
// SPLIT-2 end
__share({ grantDocs });
// SPLIT-2 server.js piece 332
app.use(require("../../routes/finance").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 333

// ── Volunteers ─────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS
// ════════════════════════════════════════════════════════════════════════════
// shared/volunteerHours.js holds the rules (hundredths, a 24-hour ceiling, an
// import key). Hours live on the PERSON (donors row, BUILD-94's person types),
// so a volunteer who gives is one record with both roles. Not scheduling.
let VH = null;
// SPLIT-2 end
__share({ VH });
// SPLIT-2 server.js piece 334
const VH_READY = import("../../shared/volunteerHours.js").then(m => { VH = m; __share({ VH }); return m; });
// SPLIT-2 end
__share({ VH_READY });
// SPLIT-2 server.js piece 336

// ── FIX-24 Part 1 · MAKE A PERSON A VOLUNTEER ─────────────────────────────
// The ONE server function behind "Make a volunteer" (the profile's More menu),
// Volunteers > Add a volunteer when it links somebody already on file, and the
// Agent's volunteer step (AGENT-2). It never makes a person: it takes the one
// already on file, gives them the Volunteer role (markVolunteer), and keeps ONE
// volunteer record on them, an approved volunteer_applications row with their
// availability (hours a week, the days they can come) and roles. That row is
// what the Volunteers group's rule reads (volunteer=1), so they are on
// Volunteers the moment this returns. A second call updates that row.
// `client`: inside a transaction (the Agent's run), the same writes on it.
// Returns { error } or { personId, recordId, created, name, hoursPerWeek, availability, roles }.
let VOL_DAYS = null;
// SPLIT-2 end
__share({ VOL_DAYS });
// SPLIT-2 server.js piece 337
const VOL_DAYS_READY = import("../../shared/volunteerApply.js").then(m => { VOL_DAYS = m.AVAILABILITY; __share({ VOL_DAYS }); return m; });
// SPLIT-2 end
__share({ VOL_DAYS_READY });
// SPLIT-2 server.js piece 344
// MEMBERS-2 — "Your page". Mounted BEFORE the volunteer routers on purpose:
// it intercepts a live /volunteer/me?t=<token> and exchanges that token for a
// session on the new page, so every volunteer link already in somebody's
// inbox keeps working. An expired or unknown token falls through by next(),
// and the old page answers it with the words it always did.
app.use(require("../../routes/supporter").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 345
app.use(require("../../routes/volunteer").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 346
// VOL-1 — scheduling, capacity, waitlists, check-in and credentials. Mounted
// AFTER routes/volunteer so /volunteer/join and /volunteer/log keep their
// place; the catch-all /volunteer/:slug there defers to them by name.
app.use(require("../../routes/volunteerScheduling").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 347
app.use(require("../../routes/surveys").routers.r0);   // SURVEY-1
// SPLIT-2 end
// SPLIT-2 server.js piece 348
app.use(require("../../pictures").routers.r0);   // FIX-41: the one picture upload and save doors
// SPLIT-2 end
// SPLIT-2 server.js piece 349
app.use(require("../../routes/videoThanks").routers.r0);   // PARITY-1 Part F
// SPLIT-2 end
// SPLIT-2 server.js piece 350
app.use(require("../../routes/templates").routers.r0);   // COMMS-2
// SPLIT-2 end
// SPLIT-2 server.js piece 351
app.use(require("../../routes/why").routers.r0);         // WHY-1
// SPLIT-2 end
// SPLIT-2 server.js piece 352
app.use(require("../../routes/profileStatus").routers.r0); // PARITY-1
// SPLIT-2 end
// SPLIT-2 server.js piece 353
app.use(require("../../routes/dataHealth").routers.r0);    // CLEAN-1
// SPLIT-2 end
// SPLIT-2 server.js piece 354
app.use(require("../../routes/prospect").routers.r0);      // PROSPECT-1
// SPLIT-2 end
// SPLIT-2 server.js piece 355
app.use(require("../../routes/grantSystem").routers.r0);   // GRANTS-1 funders, pipeline, checklist, renewals
// SPLIT-2 end
// SPLIT-2 server.js piece 356
app.use(require("../../routes/grantLibrary").routers.r0);  // GRANTS-1 library, documents, reports, drafting
// SPLIT-2 end
// SPLIT-2 server.js piece 357
app.use(require("../../routes/grantMail").routers.r0);     // GRANTS-1 email in
// SPLIT-2 end
// SPLIT-2 server.js piece 358
app.use(require("../../routes/grantReports").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 359
app.use(require("../../routes/sheets").routers.r0);        // SHEETS-1 old spreadsheets
// SPLIT-2 end
// SPLIT-2 server.js piece 360
app.use(require("../../routes/emailsSent").routers.r0);    // FIX-40 every email as sent, and who it went to
// SPLIT-2 end
// SPLIT-2 server.js piece 361
app.use(require("../../routes/oldReports").routers.r0);    // REPORTS-5 old reports
// SPLIT-2 end
// SPLIT-2 server.js piece 362
app.use(require("../../routes/capture").routers.r0);       // CAPTURE-1 To confirm
// SPLIT-2 end
// SPLIT-2 server.js piece 363
app.use(require("../../routes/setup").routers.r0);         // ONBOARD-1 Set up Steward for me
// SPLIT-2 end
// SPLIT-2 server.js piece 364
app.use(require("../../routes/voice").routers.r0);         // VOICE-1 Tell Steward
// SPLIT-2 end
// SPLIT-2 server.js piece 365
app.use(require("../../routes/atlas").routers.r0);         // AGENT-5 Atlas
// SPLIT-2 end
// SPLIT-2 server.js piece 366
app.use(require("../../routes/clientSafe").routers.r0);    // CLIENT-SAFE-1 privacy mode
// SPLIT-2 end
// SPLIT-2 server.js piece 367
app.use(require("../../routes/support").routers.r0);      // SUPPORT-1 the support agent
// SPLIT-2 end
// SPLIT-2 server.js piece 368
app.use(require("../../routes/supportAccess").routers.r0);   // FIX-57 open as support, and the org's off switch
// SPLIT-2 end
// SPLIT-2 server.js piece 369
app.use(require("../../routes/media").routers.r0);         // EMAIL-1 the media library
// SPLIT-2 end
// SPLIT-2 server.js piece 370
app.use(require("../../routes/emailTemplates").routers.r0); // EMAIL-1 email templates  // GRANTS-1 the grants reports
// SPLIT-2 end
// SPLIT-2 server.js piece 371
app.use(require("../../routes/stockPhotos").routers.r0);   // EDITOR-1 the bundled stock photos
// SPLIT-2 end
// SPLIT-2 server.js piece 372
app.use(require("../../routes/homeLead").routers.r0);      // HOME-2 the lead slot at the top of Home
// SPLIT-2 end
// SPLIT-2 server.js piece 373
app.use(require("../../routes/insights").routers.r0);      // INSIGHTS-1 the ladder and the cards
// SPLIT-2 end
// SPLIT-2 server.js piece 374
app.use(require("../../routes/homeBundle").routers.r0);    // SCALE-2 Home's first reads in one request
// SPLIT-2 end
// SPLIT-2 server.js piece 375
app.use(require("../../routes/homeCalls").routers.r0);     // PARITY-1 Part C
// SPLIT-2 end
// SPLIT-2 server.js piece 376
app.use(require("../../routes/readouts").routers.r0);     // LIVE-1: what this told us
// SPLIT-2 end
// SPLIT-2 server.js piece 377
app.use(require("../../routes/groups").routers.r0);        // PARITY-1 Part D
// SPLIT-2 end
// SPLIT-2 server.js piece 378
app.use(require("../../routes/search").routers.r0);        // WIRE-1 the one search
// SPLIT-2 end
// SPLIT-2 server.js piece 379
app.use(require("../../routes/historyImport").routers.r0); // IMPORT-2 notes and history
// SPLIT-2 end
// SPLIT-2 server.js piece 380
app.use(require("../../routes/sheetImport").routers.r0);   // IMPORT-3 any spreadsheet
// SPLIT-2 end
// SPLIT-2 server.js piece 381
app.use(require("../../routes/auctions").routers.r0);      // PARITY-2 Part 4
// SPLIT-2 end
// SPLIT-2 server.js piece 382
app.use(require("../../routes/removal").routers.r0);       // FIX-41 the one remove
// SPLIT-2 end
// SPLIT-2 server.js piece 383

// ── BUILD-98 (switch) Part 6 — THE PUBLIC API: A KEY THAT OPENS ONE ORG ────
// Read scopes first. The rules:
//   1. A key is shown ONCE, stored as its SHA-256, and names its org on the
//      STORED ROW — nothing the caller sends can pick the org (BUILD-37 B9).
//   2. A key opens /api/v1 and NOTHING ELSE. requireAuth never accepts one,
//      and requireApiKey never accepts a staff JWT — two doors, two locks.
//   3. Revoked is a 401 that reads exactly like a key that never existed.
//   4. The list endpoints are newest-first with an id, which is what a Zapier
//      POLLING trigger needs ("new person", "new gift"): Zapier dedupes by id.
const API_KEY_PREFIX = "stw_";
// SPLIT-2 end
__share({ API_KEY_PREFIX });
// SPLIT-2 server.js piece 384
const hashApiKey = k => crypto.createHash("sha256").update(String(k)).digest("hex");
// SPLIT-2 end
__share({ hashApiKey });
// SPLIT-2 server.js piece 385
const apiLimiter = rateLimit("apiLimiter", {
  windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  handler: rateLimitHandler, skip: rateLimitDisabled,
  keyGenerator: req => {
    const k = String(req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    return k.startsWith(API_KEY_PREFIX) ? "key:" + hashApiKey(k).slice(0, 16) : ipKeyGenerator(req.ip);
  },
});
// SPLIT-2 end
__share({ apiLimiter });
// SPLIT-2 server.js piece 393


// ══ BUILD-94 Part 5 — PUT IT ON MY CALENDAR ════════════════════════════════
// Three outputs, ONE builder. Outlook and Google are deep links to their
// compose screens; the .ics is a file. Nothing is written to any calendar by
// Steward and nothing comes back — NOT_SYNC_NOTE is the sentence that says so,
// and it ships beside the button.
//
// The three MUST agree: same subject, same start time in the org's timezone,
// and a UID that is stable across two generations so re-downloading UPDATES
// the appointment rather than duplicating it.
let CAL = null;
// SPLIT-2 end
__share({ CAL });
// SPLIT-2 server.js piece 394
const CAL_READY = import("../../shared/calendarLinks.js").then(m => { CAL = m; __share({ CAL }); return m; });
// SPLIT-2 end
__share({ CAL_READY });
// SPLIT-2 server.js piece 396
app.use(require("../../routes/agent").routers.r0);
// SPLIT-2 end
// SPLIT-2 server.js piece 397

// ── AI — donor propensity scoring ──────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── SMTP settings ──────────────────────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── SMTP test endpoint ─────────────────────────────────────────────────────
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── Email suppression & unsubscribe ─────────────────────────────────────────
// Signed, no-login-required unsubscribe tokens. HMAC (not full JWT) is enough
// here — the payload only needs tamper-proofing, not the extra claims/expiry
// machinery a JWT brings. Reuses the same secret auth.js signs session tokens
// with (same dev-only fallback, gated the same way) rather than introducing a
// second secret to provision.
const UNSUB_SECRET = process.env.JWT_SECRET || "nonprofit_erp_secret_dev";
// SPLIT-2 end
__share({ UNSUB_SECRET });
// SPLIT-2 server.js piece 401

// The donor-facing "From" — the org's name in the inbox, so a receipt reads as
// coming from "CREO Arts", not a bare unfamiliar domain (BUILD-64 Part 2, the
// "Now" half of sender identity; per-org sending DOMAINS are scoped separately
// in the per-org sending-domain write-up). Header-injection-safe: no CR/LF/quotes/angles
// in the display name. The address itself is unchanged (noreply@stewardapp.dev).
const DONOR_MAIL_ADDR = () => process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
// SPLIT-2 end
__share({ DONOR_MAIL_ADDR });
// SPLIT-2 server.js piece 406
const orgMailGateCache = new Map();
// SPLIT-2 end
__share({ orgMailGateCache });
// SPLIT-2 server.js piece 407
app.use(require("../../routes/webhooks").routers.r1);
// SPLIT-2 end
// SPLIT-2 server.js piece 408

// ── Recurring gift recovery (failed-payment dunning) — shared helpers ──────
// Nonprofits lose 20-30% of recurring giving to involuntary churn (expired/
// declined cards) with nobody ever noticing. This detects it on the donor's
// CONNECTED Stripe account (event.account below — a separate concern from
// /billing/webhook, which is Steward's OWN platform subscription), emails the
// donor a secure card-update link, and tracks recovery. See CLAUDE.md
// "Recurring gift recovery" for the full design.
//
// Same signed, no-login HMAC pattern as the unsubscribe token above. A
// separate secret (falling back to the same one if unset) so the two token
// families can be rotated independently later without sharing a blast radius.
const RECOVERY_SECRET = process.env.RECOVERY_SECRET || UNSUB_SECRET;
// SPLIT-2 end
__share({ RECOVERY_SECRET });
// SPLIT-2 server.js piece 409

// Dunning cadence: days since the subscription's FIRST failure at which to
// send the next reminder — fixed checkpoints, not "N days after the last
// send," so the schedule doesn't drift if a send is delayed. After the final
// step, Steward stops sending; an unresolved subscription eventually reaches
// customer.subscription.deleted, handled below as the "lost" outcome.
const DUNNING_SCHEDULE_DAYS = [0, 3, 7, 14];
// SPLIT-2 end
__share({ DUNNING_SCHEDULE_DAYS });
// SPLIT-2 server.js piece 410

// Trailing window for recovered/lost recovery-rate math (see GET /recurring/health).
const RECOVERY_RATE_WINDOW_DAYS = 90;
// SPLIT-2 end
__share({ RECOVERY_RATE_WINDOW_DAYS });
// SPLIT-2 server.js piece 418

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
// SPLIT-2 server.js piece 422

// ── THE ONE PLACE STEWARD MAILS JONATHAN ───────────────────────────────────
// Deliberately narrow. Three triggers, named in the brief: a send to a real
// mailbox provider from a demo org, a tick failure, a 5xx burst. It rides the
// RAW client, not the wrapped one, because an alert about mail must not depend
// on the thing it is alerting about — and it is de-duplicated per hour per
// kind, because an alert that arrives forty times is an alert nobody reads.
const _opsAlertSent = new Map();
// SPLIT-2 end
__share({ _opsAlertSent });
// SPLIT-2 server.js piece 424

// A 5xx burst. Counted from the tick log's failures plus the process's own
// counter, so it does not need an APM.
let _fiveXXWindow = [];
// SPLIT-2 end
__share({ _fiveXXWindow });
// SPLIT-2 server.js piece 432

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
// SPLIT-2 server.js piece 434

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
// SPLIT-2 server.js piece 435
emailCompose.configure({ displayNameCase });
// SPLIT-2 end
// SPLIT-2 server.js piece 448

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
// SPLIT-2 server.js piece 449
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
// SPLIT-2 server.js piece 452

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
// SPLIT-2 server.js piece 453
const RB_READY = import("../../shared/reportBuilder.js").then(m => { RB = m; __share({ RB }); return m; });
// SPLIT-2 end
__share({ RB_READY });
// SPLIT-2 server.js piece 456

const rbCents = v => Math.round(Number(v) * 100);
// SPLIT-2 end
__share({ rbCents });
// SPLIT-2 server.js piece 463

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
// SPLIT-2 server.js piece 466

// ── Digest HTML rendering (branded header + Steward frame) ──────────────────
const digestEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// SPLIT-2 end
__share({ digestEsc });
// SPLIT-2 server.js piece 467
const digestMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
// SPLIT-2 end
__share({ digestMoney });
// SPLIT-2 server.js piece 472

const digestNudgeHtml = (line, linkLabel) =>
  `<div style="margin-top:16px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;line-height:1.6;">
    ${line}
    <div style="margin-top:10px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">${linkLabel} →</a></div>
  </div>`;
// SPLIT-2 end
__share({ digestNudgeHtml });
// SPLIT-2 server.js piece 478

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
// SPLIT-2 server.js piece 480


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
// SPLIT-2 server.js piece 481
const PHOTO_FETCH_CONCURRENCY = 4;
// SPLIT-2 end
__share({ PHOTO_FETCH_CONCURRENCY });
// SPLIT-2 server.js piece 490

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
// SPLIT-2 server.js piece 495

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
// SPLIT-2 server.js piece 496
const WEEKLY_CATCH_UP_HOURS = 6;
// SPLIT-2 end
__share({ WEEKLY_CATCH_UP_HOURS });
// SPLIT-2 server.js piece 497
const WEEKLY_LIST_CAP = 5;
// SPLIT-2 end
__share({ WEEKLY_LIST_CAP });
// SPLIT-2 server.js piece 501

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
