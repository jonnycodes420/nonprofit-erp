// SPLIT-2: moved VERBATIM from server.js (its functions from lines 94-2282). server.js requires the boot modules in
// order: every helpers-N first (a function existed from the start, as hoisting made it), then
// steps-1, steps-2 … in the order the statements ran. Each "SPLIT-2 server.js piece N" block is
// server.js's own text; tests read server.js through readSource("server.js"), which puts the
// pieces back in order. The lines outside the blocks are the wiring: this module's copy of each
// server.js name it reads (bind), and __boot.share() after a declaration or a write, which
// refreshes every module's copy.
// eslint-disable-next-line no-var, no-global-assign
var __dirname = require("path").join(__dirname, "..", "..");   // server.js's folder, as the moved code expects
// STAGE-1: on staging (STEWARD_ENV=staging) refuse a live Stripe key and capture all mail, before anything else loads.
require("../shared/stagingEnv").install();
const __boot = require("./share");
const __share = __boot.share;
let DB_READY, DONOR_SUMMARY_UPDATE, GC, GC_READY, GIFT_METHOD_UNKNOWN, GREET, GREET_READY, HISTORY, ItemRefs, OUTBOX, PW, SYS_AUTO, SYS_SOURCE, Sentry, TZ_CACHE_MS, _journeyEngine, _journeyNudge, _scoreRuns, _tzCache, _volunteerReminders, applyGiftAsMembershipRenewal, assetHealth, computeDriftForDonors, computeGuardsOk, dbReady, donorFacingOrgName, engagementMod, google, guardBootAt, ledgerChartSelfHeals, newId, notifyFailedPending, notifyUserOnce, onPledgeSettled, openAdminTask, openThreadTx, orgTime, orgToday, publicAppUrl, query, recalcPledgePayment, reconcileAccountsWithStripe, reconciliation, round2, run, scheduleScores, seedOrgData, testMode, threadShapeMod, webhookSubStatus, withAdvisoryLock, withTransaction, withTryAdvisoryLock;
__boot.register(c => {
  if ("DB_READY" in c) DB_READY = c.DB_READY;
  if ("DONOR_SUMMARY_UPDATE" in c) DONOR_SUMMARY_UPDATE = c.DONOR_SUMMARY_UPDATE;
  if ("GC" in c) GC = c.GC;
  if ("GC_READY" in c) GC_READY = c.GC_READY;
  if ("GIFT_METHOD_UNKNOWN" in c) GIFT_METHOD_UNKNOWN = c.GIFT_METHOD_UNKNOWN;
  if ("GREET" in c) GREET = c.GREET;
  if ("GREET_READY" in c) GREET_READY = c.GREET_READY;
  if ("HISTORY" in c) HISTORY = c.HISTORY;
  if ("ItemRefs" in c) ItemRefs = c.ItemRefs;
  if ("OUTBOX" in c) OUTBOX = c.OUTBOX;
  if ("PW" in c) PW = c.PW;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("SYS_SOURCE" in c) SYS_SOURCE = c.SYS_SOURCE;
  if ("Sentry" in c) Sentry = c.Sentry;
  if ("TZ_CACHE_MS" in c) TZ_CACHE_MS = c.TZ_CACHE_MS;
  if ("_journeyEngine" in c) _journeyEngine = c._journeyEngine;
  if ("_journeyNudge" in c) _journeyNudge = c._journeyNudge;
  if ("_scoreRuns" in c) _scoreRuns = c._scoreRuns;
  if ("_tzCache" in c) _tzCache = c._tzCache;
  if ("_volunteerReminders" in c) _volunteerReminders = c._volunteerReminders;
  if ("applyGiftAsMembershipRenewal" in c) applyGiftAsMembershipRenewal = c.applyGiftAsMembershipRenewal;
  if ("assetHealth" in c) assetHealth = c.assetHealth;
  if ("computeDriftForDonors" in c) computeDriftForDonors = c.computeDriftForDonors;
  if ("computeGuardsOk" in c) computeGuardsOk = c.computeGuardsOk;
  if ("dbReady" in c) dbReady = c.dbReady;
  if ("donorFacingOrgName" in c) donorFacingOrgName = c.donorFacingOrgName;
  if ("engagementMod" in c) engagementMod = c.engagementMod;
  if ("google" in c) google = c.google;
  if ("guardBootAt" in c) guardBootAt = c.guardBootAt;
  if ("ledgerChartSelfHeals" in c) ledgerChartSelfHeals = c.ledgerChartSelfHeals;
  if ("newId" in c) newId = c.newId;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("notifyUserOnce" in c) notifyUserOnce = c.notifyUserOnce;
  if ("onPledgeSettled" in c) onPledgeSettled = c.onPledgeSettled;
  if ("openAdminTask" in c) openAdminTask = c.openAdminTask;
  if ("openThreadTx" in c) openThreadTx = c.openThreadTx;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("recalcPledgePayment" in c) recalcPledgePayment = c.recalcPledgePayment;
  if ("reconcileAccountsWithStripe" in c) reconcileAccountsWithStripe = c.reconcileAccountsWithStripe;
  if ("reconciliation" in c) reconciliation = c.reconciliation;
  if ("round2" in c) round2 = c.round2;
  if ("run" in c) run = c.run;
  if ("scheduleScores" in c) scheduleScores = c.scheduleScores;
  if ("seedOrgData" in c) seedOrgData = c.seedOrgData;
  if ("testMode" in c) testMode = c.testMode;
  if ("threadShapeMod" in c) threadShapeMod = c.threadShapeMod;
  if ("webhookSubStatus" in c) webhookSubStatus = c.webhookSubStatus;
  if ("withAdvisoryLock" in c) withAdvisoryLock = c.withAdvisoryLock;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
  if ("withTryAdvisoryLock" in c) withTryAdvisoryLock = c.withTryAdvisoryLock;
});

// SPLIT-2 server.js piece 22

// The org this send belongs to is taken from an explicit `_stewardOrgId` on the
// options when a call site knows it, and is otherwise null. A null org is
// honest — some sends (a password reset, the MIGC contact form) genuinely have
// no tenant — and it is better than a guess, because the whole point of this
// table is telling the truth about what left the building.
function _logOutboundEmail(opts, result, err, statusOverride) {
  const to = Array.isArray(opts && opts.to) ? opts.to[0] : (opts && opts.to);
  const domain = String(to || "").split("@")[1] || "";
  const row = [
    newId("eml"),
    (opts && opts._stewardOrgId) || null,
    domain.toLowerCase().slice(0, 120),
    String((opts && opts._stewardKind) || "").slice(0, 60) || null,
    String((opts && opts.subject) || "").slice(0, 200),
    statusOverride || (err ? "failed" : "sent"),
    err ? String(err.message || err).slice(0, 300) : null,
    (opts && opts._stewardGate) || null,
    (opts && Array.isArray(opts._stewardGateDonors) && opts._stewardGateDonors.length) ? opts._stewardGateDonors.slice(0, 50) : null,
  ];
  // Never let logging break a send, and never let it throw into a caller that
  // is already handling a provider failure. FIX-51: the write is returned (it
  // never rejects), so a caller that reads the log next, or that must not
  // finish before the row is in, awaits it.
  return run(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status,error,gate,donor_ids)
       VALUES (?,?,?,?,?,?,?,?,?)`, row).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 62
async function orgTz(orgId) {
  const hit = TZ_CACHE_MS ? _tzCache.get(orgId) : null;
  if (hit && hit.until > Date.now()) return hit.value;
  let tz = orgTime.DEFAULT_TZ, confirmed = null, fyStart = null;
  try {
    const r = await query("SELECT timezone, timezone_confirmed_at, vocabulary_json FROM orgs WHERE id=?", [orgId]);
    // NUMBERS-2: the org's own year rides with its clock, so every
    // orgFiscalYearStart(await orgTz(...)) is the year the org chose in
    // Settings, not July for everyone.
    fyStart = orgTime.orgFiscalStartMonth({ vocabulary_json: r[0]?.vocabulary_json });
    tz = orgTime.normalizeTimezone(r[0]?.timezone);
    // BUILD-84 — the timezone column is NOT NULL with a default, so "has a
    // timezone" has always been true for every org and means nothing. This is
    // the timezone a HUMAN chose, and it is what the timed reminder requires:
    // a morning digest forgives being an hour off, a 2:00 reminder does not.
    confirmed = r[0]?.timezone_confirmed_at || null;
  } catch { /* pre-migration boot — the default is correct */ }
  const value = { timezone: tz, timezone_confirmed_at: confirmed, fiscal_year_start_month: fyStart || orgTime.FISCAL_START_MONTH_DEFAULT };
  _tzCache.set(orgId, { value, until: Date.now() + TZ_CACHE_MS });
  return value;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 63
// The zone NAME alone. `orgTz` returns {timezone, timezone_confirmed_at} — a
// caller that wants an Intl option and passes the whole object gets a
// RangeError, which is how the first close-link welcome email failed to send.
async function orgTzName(orgId) {
  try { return (await orgTz(orgId)).timezone; } catch { return orgTime.DEFAULT_TZ; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 64

// ── BUILD-75 C.1 — THE ACTOR ON EVERY WRITE ─────────────────────────────────
// Every row that represents something someone DID records who did it — an
// IDENTITY, never a boolean: a user id for a human, or a system identity
// string for a non-human path. "Who logged this note" and "who imported these
// four hundred rows" are questions a development office asks constantly, and
// they are unanswerable retroactively — the information exists only at write
// time. This is also what makes agent oversight free the day something
// non-human writes: the actor column is already there, already honest.
// tests/actor-stamp.test.js pins that every INSERT into the actor tables
// carries these two values.
function actor(req) {
  // FIX-57: a change made in a support session is Steward support's, by name.
  if (req && req.user && req.user.support) return { id: req.user.userId, name: req.user.support.name };
  // FIX-57: the person's name ("Reviewed by Robin Lee"); the email only if she never set one.
  return { id: (req && req.user && req.user.userId) || null, name: (req && req.user && (req.user.name || req.user.email)) || null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 76

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "https://nonprofit-erp-production.up.railway.app/gmail/callback"
  );
}
// SPLIT-2 end
// SPLIT-2 server.js piece 92

// ── Rate limiting ────────────────────────────────────────────────────────
// Shared 429 handler: explicit Retry-After header + a body shape that can't be
// mistaken for a generic error (client code can key off error === "rate_limited").
// FIX-22 · the message says WHEN, in one sentence, because a screen that hits
// a limit quotes it (apiFetch carries `message`; App's load screen and every
// domain catch show it). "Please try again later" left a demo guessing.
function retryWords(sec) {
  if (sec <= 60) return "in a minute";
  const min = Math.ceil(sec / 60);
  return min >= 60 ? `in about ${Math.ceil(min / 60) === 1 ? "an hour" : Math.ceil(min / 60) + " hours"}` : `in ${min} minutes`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 93
function rateLimitHandler(req, res) {
  const resetMs = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 60000;
  const sec = Math.max(1, Math.ceil(resetMs / 1000));
  res.set("Retry-After", String(sec));
  res.status(429).json({ error: "rate_limited", retryAfter: sec,
    message: `Steward has had a lot of requests from you in a short time. Please try again ${retryWords(sec)}.` });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 122
function registerJourneyNudge(fn) { _journeyNudge = fn; __share({ _journeyNudge }); }
// SPLIT-2 end
// SPLIT-2 server.js piece 171
async function refreshReconcileDenominator() {
  try {
    const [r] = await query("SELECT COUNT(*)::int AS n FROM orgs WHERE stripe_account_id IS NOT NULL");
    reconcileAccountsWithStripe = r ? r.n : 0; __share({ reconcileAccountsWithStripe });
  } catch { /* leave prior value */ }
  return reconcileAccountsWithStripe;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 172
function reconciliationHealth() {
  return {
    unrecordedCharges: reconciliation.unrecordedCharges,
    orphanGifts: reconciliation.orphanGifts,
    checkedAt: reconciliation.checkedAt,
    oldestUnrecordedAgeMin: reconciliation.oldestUnrecordedAgeMin,
    // BUILD-63 — accountsErrored > 0 means the guard could NOT read some
    // connected accounts (e.g. a restricted key without connected-account
    // charge access): a "clean" unrecordedCharges is not trustworthy while this
    // is non-zero. Watch it alongside unrecordedCharges.
    accountsChecked: reconciliation.accountsChecked ?? null,
    accountsErrored: reconciliation.accountsErrored ?? null,
    accountsWithStripe: reconcileAccountsWithStripe,   // BUILD-65 Part 6 — the denominator
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 174
function guardState() {
  return {
    bootAt: guardBootAt,
    reconciliation,
    webhook: webhookSubStatus,
    chartSelfHeals: ledgerChartSelfHeals,
    dbFallbackRows: assetHealth().dbFallbackRows,
    failedPending: notifyFailedPending,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 175
function guardsOk() { return computeGuardsOk(guardState()); }
// SPLIT-2 end
// SPLIT-2 server.js piece 177
function webhookSubHealth() {
  return { missingCount: webhookSubStatus.missingCount, checked: webhookSubStatus.checked };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 178

async function ensureOrgLedger(orgId, { heal = false } = {}) {
  const probe = async () => {
    const [contrib] = await query("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [orgId]);
    const [grant] = await query("SELECT id FROM accounts WHERE org_id = ? AND type = 'revenue' AND subtype = 'grants' ORDER BY code ASC LIMIT 1", [orgId]);
    const [fund] = await query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]);
    return { contribAcctId: contrib?.id || null, grantAcctId: grant?.id || contrib?.id || null, genFundId: fund?.id || null };
  };
  let ids = await probe();
  if (ids.contribAcctId && ids.genFundId) return ids;

  // Missing pieces — provision under an advisory lock so two concurrent
  // stamps (e.g. parallel webhook deliveries) can't double-build the chart.
  await withAdvisoryLock("orgledger:" + orgId, async () => {
    const existing = await query("SELECT id FROM accounts WHERE org_id = ? LIMIT 1", [orgId]);
    if (!existing.length) {
      await seedOrgData(orgId); // full standard chart + General Operating fund
    } else {
      // A partial chart (org built its own accounts): add only what's missing.
      const partial = await probe();
      if (!partial.contribAcctId) {
        await run("INSERT INTO accounts (id, org_id, code, name, type, subtype) VALUES (?,?,?,?,?,?)",
          [newId("acc"), orgId, "4010", "Individual Contributions", "revenue", "contributions"]);
      }
      const funds = await query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false LIMIT 1", [orgId]);
      if (!funds.length) {
        // FIX-43: five values for five columns. `VALUES (?,?,?,?,false)` with a
        // fifth bound value threw on every org with accounts and no
        // unrestricted fund, which is where "Undo all of setup" leaves one.
        await run("INSERT INTO fin_funds (id, org_id, name, description, restricted) VALUES (?,?,?,?,?)",
          [newId("ff"), orgId, "General Operating", "General unrestricted operating fund", false]);
      }
    }
  });
  ids = await probe();
  if (heal) {
    // Reaching here from a STAMP means an org existed without a usable ledger
    // — the provisioning gap W-3 found. The stamp still lands (self-healed),
    // but the gap is surfaced, never swallowed.
    ledgerChartSelfHeals++; __share({ ledgerChartSelfHeals });
    console.error(`[ledger] CRITICAL: org ${orgId} had no usable chart of accounts at stamp time — provisioned on the spot (self-heal #${ledgerChartSelfHeals}). An org-creation path is not provisioning.`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`ledger chart self-heal for org ${orgId}`, "error"); } catch { /* surfacing must never fail the stamp */ }
  }
  return ids;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 180

async function orgUnrestrictedFundId(orgId) {
  const ids = await ensureOrgLedger(orgId, { heal: true });
  return ids.genFundId || null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 182
function registerJourneyEngine(fn) { _journeyEngine = fn; __share({ _journeyEngine }); }
// SPLIT-2 end
// SPLIT-2 server.js piece 186
// ── VOL-2 item 5 · THE SWEEP HAS A TIMER NOW ─────────────────────────────
// VOL-1 shipped the sweep and its admin route and left it driven by hand,
// which means a reminder the day before a shift only went out if somebody
// remembered to press something the day before a shift. That is not a
// reminder, it is a second thing to remember.
//
// NOTHING ABOUT WHO GETS MAIL CHANGES. The sweep itself is the gate and it is
// unchanged: it reads only orgs with `volunteer_reminders_enabled = TRUE`
// (OFF for every org until one turns it on), refuses the demo org outright,
// asks `orgMaySendEmail` after that, and CLAIMS each row before sending so a
// second pass cannot mail anybody twice. This adds the clock and nothing else.
//
// Hourly, not daily: the sweep sends for TOMORROW in each org's own timezone,
// and orgs are in different ones. An hourly pass is the cheapest way for every
// org to get its own "tomorrow" right, and the per-row claim makes the extra
// passes free.
async function runVolunteerRemindersTick() {
  if (typeof _volunteerReminders !== "function") return;
  try {
    const out = await _volunteerReminders();
    if (out && out.drafted) console.log(`[volunteer] reminders: ${out.drafted} drafted for staff to send`);
  } catch (e) { console.error("[volunteer] reminder sweep:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 188

async function maybeStartJourneyFromServer(orgId, donorId, trigger, opts) {
  if (typeof _journeyEngine !== "function") return { started: false, reason: "engine_not_mounted" };
  // LIVE-1 — a caller writing many gifts read once which triggers have a
  // journey switched on; a trigger with none cannot start anything, so it is
  // not asked again for every gift.
  if (opts && opts.armed && !opts.armed.has(trigger)) return { started: false, reason: "no_journey_for_trigger" };
  try { return await _journeyEngine(orgId, donorId, trigger, opts); }
  catch (e) { console.error(`[journey] ${trigger} for ${donorId}:`, e.message); return { started: false, reason: "error", detail: e.message }; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 189

async function recordGift(o) {
  const orgId = o.orgId;
  const amount = round2(Number(o.amount) || 0);
  // IMPORT-4: a gift with no date is written only when the caller says the
  // file gave none (`undated: true`, the import). Every other door needs a day.
  const undated = o.undated === true && (o.date == null || o.date === "");
  const date = undated ? null : o.date;
  if (!undated && (date == null || date === "")) throw new Error("recordGift: a gift needs a date");
  const giftId = o.giftId || (newId("g"));
  const actorId = o.actorId || null, actorName = o.actorName || null;
  // FIX-36: a gift a HISTORY READ brought in (`o.history`: a giving source's
  // first read, QuickBooks, an import) older than historyGifts.HISTORY_DAYS is
  // recorded and counted like any other, and starts nothing: no journey, no
  // sequence, no thank-you draft. A live gift never sets `history`.
  // An undated gift is history by definition: its day is not known, so it starts nothing.
  const oldHistory = undated || o.history === true
    && HISTORY.isOldHistory(date, o.today || orgToday(await orgTz(orgId)));   // ORG_TZ_SEAM_OK
  // FIX-37: an imported gift the organisation says was ALREADY THANKED in the
  // system it came from (importThanks.js) is recorded and counted, and gets no
  // thank-you draft and starts no gift journey or gift sequence: the thanking
  // happened, elsewhere.
  const thankedElsewhere = o.alreadyThanked === true;
  // SEND-GATE-1: a gift an IMPORT wrote (`o.importId`) fires no trigger: no
  // sequence, no journey, no group journey. (Its thank-you DRAFT, if the
  // import's own question asked for one, is a draft a person reviews.) A
  // QuickBooks read after the first one (`liveRead`) is new gifts arriving,
  // not an import, and fires triggers like any live gift.
  const fromImport = !!o.importId && o.liveRead !== true;
  // Rule 1 — a fund and a method, always. A fund the caller names is honoured
  // only if it belongs to this org (never trust an id off a webhook payload).
  //
  // TWO CASES, and they are not the same case (BUILD-88a A.3 walk):
  //  · A STAFF MEMBER typed this gift with a fund picker in front of them and
  //    left it alone. The org's unrestricted fund is the honest reading of that
  //    choice, and a blank there is indistinguishable from "nobody looked".
  //  · A DONOR gave online and designated nothing. Nobody at the organisation
  //    has said where that money goes, and a fund is an accounting fact rather
  //    than a default — it stays undesignated (`defaultFund: false`).
  // And a fund id that was REFUSED never silently becomes a different fund:
  // that would turn a rejected (possibly cross-org) designation into one that
  // LOOKS deliberate, which is worse than none at all.
  let fundId = o.fundId || null;
  let fundRefused = false;
  if (fundId) {
    const okFund = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
    if (!okFund.length) { fundId = null; fundRefused = true; console.error(`[gift] refused a fund id that is not this org's: ${o.fundId}`); }
  }
  // BUILD-100 (grants) Part 4 — A PAYMENT AGAINST A RESTRICTED AWARD MAY NOT
  // FALL BACK TO THE UNRESTRICTED FUND. The award is a pledge on the funder
  // (Part 1), so a payment carries `pledgeId`; if that pledge is a grant award
  // and the grant names a fund, THAT is the fund. Without this wire a $10,000
  // program-restricted award's payments post to General Operating and the
  // restriction is lost at the ledger — silently, since every other figure
  // still adds up.
  if (!fundId && !fundRefused && o.pledgeId) {
    const [gf] = await query(
      `SELECT g.fund_id FROM grants g
        WHERE g.org_id = ? AND g.award_pledge_id = ? AND g.fund_id IS NOT NULL
          AND g.restriction IN ('program_restricted','capital','time_restricted')`,
      [orgId, o.pledgeId]);
    if (gf && gf.fund_id) fundId = gf.fund_id;
  }
  if (!fundId && !fundRefused && o.defaultFund !== false) fundId = await orgUnrestrictedFundId(orgId);
  const paymentMethod = String(o.paymentMethod || "").trim() || GIFT_METHOD_UNKNOWN;

  const cols = ["id", "org_id", "donor_id", "amount", "date", "type", "campaign", "campaign_id",
                "notes", "fund_id", "payment_method", "pledge_id", "external_id", "idempotency_key",
                "stripe_payment_id", "giving_page_id", "peer_fundraiser_id", "cover_fee_amount",
                "recurring_subscription_id", "created_by", "created_by_name",
                // BUILD-89S 89a — a gift that came in through a connected giving
                // source remembers which one, what the provider took (NOT the
                // donor-covers-fee amount above it), and the provider's own
                // subscription id. They belong in THIS insert and nowhere else:
                // a second UPDATE after the fact is a second write path.
                // GIVE-2 §5 — and WHO SAID so. NULL means nobody has: a zero
                // fee that nobody stated is not the same fact as a gift that
                // cost nothing, and `shared/giftFooting.js` is the one place
                // that distinction is read.
                "giving_source_id", "processor_fee_amount", "processor_fee_source", "provider_recurring_ref",
                // BUILD-95 — the photograph of the cheque this gift came on.
                // In THIS insert for the same reason as the source columns
                // above: a second UPDATE after the fact is a second write path.
                "cheque_asset_id",
                // BUILD-98 (switch) Part 4 — a gift that bought something (a
                // gala ticket) carries what it bought and what that was worth,
                // so the receipt states the deductible part. Absent means
                // nothing was received in exchange, which is every other gift.
                "deductible_amount", "quid_pro_quo_desc", "quid_pro_quo_value",
                // BUILD-102 Part 5 — which email brought this gift in. In THIS
                // insert for the same reason as every column above it: a second
                // UPDATE after the fact is a second write path, and the one thing
                // that must never happen to an attribution is that it lands on
                // some gifts and not others depending on which door they came in.
                "utm_source", "utm_medium", "utm_campaign",
                // QBO-IN — a gift READ from the organisation's books: the run it
                // came in on (so the whole read undoes in one step), the cheque
                // number the bookkeeper typed, and the vendor it was read from,
                // which is what keeps the send side from posting it back.
                "import_id", "check_number", "read_from_vendor",
                // CAPTURE-1: when the gift came in (the check's date or the
                // email's arrival), for the gift-to-thanked clock. Only capture
                // states it; the clock reads created_at for every other door.
                "received_at",
                // CHECK-2: the check's memo line, as written.
                "memo",
                // IMPORT-3: the event a gift was given at (an event night's
                // sheet). In THIS insert, for the same reason as every column above.
                "event_id",
                // MONEY-4: a refund is a negative row linked to the gift it refunds, with why.
                "refund_of", "refund_reason",
                // QUICKADD-1: the appeal that brought the gift in (campaign is the goal).
                "appeal_id",
                // TRUTH-6: a gift dated after today is scheduled (shared/numbers/scheduled.js), by every door.
                "scheduled_on"];
  const vals = [giftId, orgId, o.donorId, amount, date, o.type || "cash", o.campaign || "",
                o.campaignId || null, o.notes || "", fundId, paymentMethod, o.pledgeId || null,
                o.externalId || null, o.idempotencyKey || null, o.stripePaymentId || null,
                o.givingPageId || null, o.peerFundraiserId || null, o.coverFeeAmount || 0,
                o.recurringSubscriptionId || null, actorId, actorName,
                o.givingSourceId || null, round2(Number(o.processorFeeAmount) || 0),
                // A gift through a connected giving source always arrives with
                // the provider's own fee stated, so it needs no caller to say
                // so — which also means every existing call site stays correct
                // without being touched.
                o.processorFeeSource || (o.givingSourceId ? "provider" : null),
                o.providerRecurringRef || null,
                o.chequeAssetId || null,
                o.quidProQuoValue != null ? round2(Math.max(0, amount - Number(o.quidProQuoValue))) : null,
                o.quidProQuoValue != null ? String(o.quidProQuoDesc || "").slice(0, 300) : null,
                o.quidProQuoValue != null ? round2(Number(o.quidProQuoValue)) : null,
                o.utmSource || null, o.utmMedium || null, o.utmCampaign || null,
                o.importId || null, o.checkNumber ? String(o.checkNumber).slice(0, 24) : null, o.readFromVendor || null,
                o.receivedAt || null, o.memo ? String(o.memo).slice(0, 300) : null, o.eventId || null,
                o.refundOf || null, o.refundOf ? String(o.refundReason || "").slice(0, 300) : null,
                o.appealId || null,
                date ? require("../../shared/numbers/scheduled").scheduledOn(date, o.today || orgToday(await orgTz(orgId))) : null];   // ORG_TZ_SEAM_OK
  // The conflict key is the caller's, because what makes a gift the SAME gift
  // differs by door: Stripe's payment intent, the form's idempotency key, the
  // source system's gift id. One of them, never a guess at (donor, amount, date)
  // — forty $100 Sunday gifts are forty gifts.
  const conflict = o.conflict === "stripe" ? "ON CONFLICT (org_id, stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING"
    : o.conflict === "idempotency" ? "ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"
    : o.conflict === "external" ? "ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING"
    : "";
  // JOBS-1 · THE GIFT AND ITS EVENT IN ONE STATEMENT. If the gift saves, the
  // event saves: what follows it (the thank-you draft, sequences, journeys,
  // the after-change step) is a handler on the queue (server/shared/outbox.js),
  // tried again when it fails, never a call here that logs and moves on.
  const ev = OUTBOX.rowFor(orgId, "gift.recorded", {
    giftId, donorId: o.donorId, amount, cents: Math.round(amount * 100), fundId, campaignId: o.campaignId || null,
    importId: o.importId || null, type: o.type || "cash", recurring: o.recurring === true,
    recurringSubscriptionId: o.recurringSubscriptionId || null, fundName: o.fundName || null, source: o.source || null,
    door: o.door || "gift_form", history: o.history === true, oldHistory, thankedElsewhere, fromImport,
    thankYou: o.thankYou !== false, afterChange: o.afterChange !== false,
    // BUILD-81: the door's "a live gift opens a thread", opened after the journeys.
    thread: o.thread ? { actorId: o.thread.id || null, actorName: o.thread.name || null } : null,
    tribute: o.extras && o.extras.tribute ? o.extras.tribute : null,
    armedSequences: o.armed && o.armed.sequences ? [...o.armed.sequences] : null,
    armedJourneys: o.armed && o.armed.journeys ? [...o.armed.journeys] : null,
  }, { donorIds: [o.donorId], ready: false, actor: actorId ? { id: actorId, name: actorName } : null });
  const n = cols.length;
  const inserted = await query(
    `WITH g AS (INSERT INTO gifts (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) ${conflict} RETURNING id)
     INSERT INTO events_outbox (id, org_id, type, payload, donor_ids, ready, created_by, created_by_name)
     SELECT $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}::jsonb, $${n + 5}::text[], FALSE, $${n + 6}, $${n + 7} FROM g RETURNING id`,
    [...vals, ev.id, ev.orgId, ev.type, ev.payload, ev.donorIds, ev.by, ev.byName]);
  if (!inserted.length) return { gift: null, duplicate: true };
  // A test proves the event survives the process dying right here (JOBS-1).
  if (testMode() && process.env.JOBS_TEST_CRASH_AFTER_OUTBOX === "1") process.exit(86);

  // The donor's rollup, in one place. NUMBERS-2: recomputed by the one
  // statement (donorSummary.js), never added to, so an imported total is kept
  // as its own figure and a gift its period already covers is not counted twice.
  // BUILD-94 Part 2 — A VOLUNTEER WHO GIVES BECOMES A DONOR TOO, on the SAME
  // record. Never a second row: the same person twice is the thing a CRM
  // exists to prevent. The `person_types` CASE below lives here, in the ONE
  // place every money path already rolls up through (BUILD-88a), so no giving
  // route can forget it. "other" means "we do not know what they are" — a gift
  // answers that, so it is REPLACED rather than accumulated beside "donor".
  await run(
    `UPDATE donors
        SET person_types = CASE
              WHEN person_types IS NULL THEN '["donor"]'::jsonb
              WHEN person_types @> '["donor"]'::jsonb THEN person_types
              ELSE (person_types - 'other') || '["donor"]'::jsonb
            END,
            updated_at = NOW()
      WHERE id = ? AND org_id = ?`,
    [o.donorId, orgId]);
  await run(DONOR_SUMMARY_UPDATE("AND d.id = $2"), [orgId, o.donorId]);
  // FIX-49 decision 7: the giving level is one rule (donorStatus.js, the
  // org's cut points over the last 12 months), read live. The lifetime
  // mid/major promotion that used to run here was a second rule.

  // Rule 3 — the ledger.
  let posted = false;
  if (o.post !== false && !undated) {
    try {
      const [orgRow] = await query("SELECT ledger_posting_enabled FROM orgs WHERE id=?", [orgId]);
      if (!orgRow || orgRow.ledger_posting_enabled !== false) {
        const ledgerIds = await ensureOrgLedger(orgId, { heal: true });
        const [dn] = await query("SELECT name FROM donors WHERE id=?", [o.donorId]);
        await run(
          `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
          [newId("ft"), orgId, date, o.ledgerDescription || `Gift from ${dn?.name || "Donor"}`,
           dn?.name || "", amount, "income", ledgerIds.contribAcctId, fundId || ledgerIds.genFundId,
           o.donorId, o.ledgerSource || "gift", giftId, actorId, actorName]);
        posted = true;
      }
    } catch (e) { console.error("[gift] ledger stamp:", e.message); }
  }

  // Rule 2 — ONE timeline entry, linked, with no copy of the amount. When the
  // gift came out of a conversation the conversation's own line is the note;
  // otherwise the gift's note, or nothing at all. The screen reads the money
  // off the gift this row points at.
  let interactionId = null;
  if (o.timeline !== false) {
    interactionId = newId("int");
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [interactionId, orgId, o.donorId, "gift", String(o.timelineNote || o.notes || "").slice(0, 2000),
       date, actorId, actorName, giftId,
       o.source ? JSON.stringify({ via: o.source }) : null]);
  }

  const [gift] = await query("SELECT * FROM gifts WHERE id=?", [giftId]);

  // ── BUILD-88b B.2 — A PAYMENT THAT MATCHES AN INSTALMENT APPLIES ──────────
  // Automatically, from EVERY door, because this is the one place every gift
  // passes through. A caller that already named an instalment (the deposit
  // sheet, which asked her) is left alone; anything else is matched by donor
  // and amount against the open schedule, oldest due first. WITHIN ten per
  // cent is deliberately NOT matched here — that is a question, and a
  // background path has nobody to ask, so a near miss stays a plain gift.
  let appliedInstallment = null;
  // PLEDGES-2 · A PAYMENT AGAINST A NAMED PLEDGE applies oldest due first and
  // any overage carries to the next installment(s) (server/donors/pledgePayments.js).
  // An amount that matched no installment flagged none, and $50 of a $150
  // payment on a $100 installment was lost to the schedule (W-1107-Finance-25X).
  if (o.installmentId === undefined && o.applyInstallment !== false && o.pledgeId && !o.applyToInstallmentId) {
    try {
      appliedInstallment = await require("../donors/pledgePayments").relay(orgId, o.pledgeId, giftId);
      if (appliedInstallment) await run("UPDATE gifts SET type=CASE WHEN type='cash' THEN 'pledge payment' ELSE type END WHERE id=?", [giftId]);
      await recalcPledgePayment(o.pledgeId, orgId).catch(e => console.error("[pledge] recalc:", e.message));
      await onPledgeSettled(orgId, o.pledgeId).catch(e => console.error("[pledge] settle:", e.message));
    } catch (e) { console.error("[pledge] payment apply:", e.message); }
  } else if (o.installmentId === undefined && o.applyInstallment !== false) {
    try {
      // CHECK-2: a check whose memo named the payment ("pledge pmt 2 of 4")
      // and that she confirmed onto it names the instalment; the amount may
      // differ from the schedule, because she said which one it is.
      const [inst] = o.applyToInstallmentId
        ? await query(
          `SELECT i.id, i.pledge_id FROM pledge_installments i
             JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
            WHERE i.org_id=? AND p.donor_id=? AND i.id=? AND i.paid_gift_id IS NULL AND p.status='open'`,
          [orgId, o.donorId, String(o.applyToInstallmentId)]).catch(() => [])
        : await query(
        `SELECT i.id, i.pledge_id FROM pledge_installments i
           JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
          WHERE i.org_id=? AND p.donor_id=? AND i.paid_gift_id IS NULL
            AND p.status='open' AND round(i.amount::numeric * 100)::bigint = ?
            AND (?::text IS NULL OR p.id = ?)
          ORDER BY i.due_date ASC, i.seq ASC LIMIT 1`,
        // GIFTS-1: a payment made against one pledge is applied to that
        // pledge's oldest unpaid installment, never another pledge's.
        [orgId, o.donorId, Math.round(amount * 100), o.pledgeId || null, o.pledgeId || null]).catch(() => []);
      if (inst) {
        const upd = await query(
          `UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW()
            WHERE id=? AND org_id=? AND paid_gift_id IS NULL RETURNING id`, [giftId, inst.id, orgId]);
        if (upd.length) {
          await run("UPDATE gifts SET pledge_id=COALESCE(pledge_id,?), type=CASE WHEN type='cash' THEN 'pledge payment' ELSE type END WHERE id=?", [inst.pledge_id, giftId]);
          appliedInstallment = { installmentId: inst.id, pledgeId: inst.pledge_id };
          await recalcPledgePayment(inst.pledge_id, orgId).catch(e => console.error("[pledge] recalc:", e.message));
          await onPledgeSettled(orgId, inst.pledge_id).catch(e => console.error("[pledge] settle:", e.message));
        }
      }
    } catch (e) { console.error("[pledge] installment auto-apply:", e.message); }
  } else if (o.pledgeId) {
    await onPledgeSettled(orgId, o.pledgeId).catch(e => console.error("[pledge] settle:", e.message));
  }

  // ── BUILD-101 Part 2 — A PAYMENT THAT IS A MEMBERSHIP RENEWAL ─────────────
  // From every door, for the same reason as the instalment above: a gift of
  // exactly the level's price from someone whose membership is due IS the
  // renewal. Not for a payment that already said what it bought (an explicit
  // membership or ticket carries its own quid pro quo) or one that just paid
  // an instalment.
  let appliedMembership = null;
  if (o.membershipRenewal !== false && !undated && !appliedInstallment && o.quidProQuoValue == null && !o.recurring) {
    appliedMembership = await applyGiftAsMembershipRenewal({ orgId, donorId: o.donorId, giftId, amount, actorId, actorName })
      .catch(e => { console.error("[membership] renewal auto-apply:", e.message); return null; });
  }

  // BUILD-88b B.3 — the thank-you is drafted, never sent: the handler
  // server/outreach/handlers/thankYouDraft.js (JOBS-1), off the gift.recorded event.

  // BUILD-98 Part 1 — soft credits, a tribute, an expected match. Checked by
  // the caller BEFORE the gift was written (checkGiftExtras); written here so
  // every door that passes them lands them the same way.
  let extras = null;
  if (o.extras) {
    try { extras = await writeGiftExtras(orgId, gift, o.extras, { actorId, actorName }); }
    catch (e) { console.error("[gift] extras:", e.message); }
  }

  // ── BUILD-103 Part 5 — THE FUNDRAISER'S SOFT CREDIT ──────────────────────
  // A gift given through somebody's own fundraiser page was BROUGHT IN by
  // them, and their record should say so. Hard credit stays on the donor and
  // nothing that totals money reads gift_soft_credits unless it is asked to,
  // so no giving total anywhere moves by a cent because of this row.
  //
  // It is written only when the fundraiser is a person in the CRM, matched by
  // EXACT EMAIL on sign-up and never by name — `peer_fundraisers.person_id`
  // is that match, made once, and this reads it rather than matching again.
  if (o.peerFundraiserId && amount > 0) {
    try {
      const [pf] = await query(
        `SELECT person_id, name FROM peer_fundraisers WHERE id=? AND org_id=?`, [o.peerFundraiserId, orgId]);
      if (pf && pf.person_id && pf.person_id !== o.donorId) {
        await run(
          `INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,pct,role,created_by,created_by_name)
           VALUES (?,?,?,?,?,100,'peer_fundraiser',?,?) ON CONFLICT (gift_id, donor_id) DO NOTHING`,
          [newId("gsc"), orgId, gift.id, pf.person_id, amount,
           actorId || SYS_AUTO.id, actorName || "Their own fundraiser page"]);
      }
    } catch (e) { console.error("[p2p] soft credit:", e.message); }
  }

  // ── JOBS-1 · WHAT FOLLOWS THE GIFT IS ITS EVENT'S HANDLERS ───────────────
  // The thank-you draft, the sequence and journey triggers (BUILD-94, THREAD-2a,
  // PARITY-1) and the after-change step (LIVE-1) are handlers of gift.recorded,
  // one file each under server/outreach/handlers/ and server/donors/handlers/.
  // Here the gift states the facts they are decided on, read once the rollup
  // has happened, exactly where the triggers used to read them: "first gift"
  // is gift_count reaching 1, "lapsed return" is a lapsed status at the moment
  // this gift landed. Then the event is ready and is relayed onto the queue.
  // FIX-45/57: a caller a person is waiting on (To confirm) passes
  // `deferTriggers`, and the relay waits for its start(), after the answer.
  const [after] = await query(
    `SELECT d.gift_count, d.stage, d.status, d.stripe_subscription_status,
            (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND x.id <> ?
                AND (x.notes ILIKE '%recurring%' OR x.type = 'recurring')) AS prior_recurring_noted,
            (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND x.id <> ? AND x.amount > 0
                AND (x.recurring_subscription_id IS NOT NULL OR x.type = 'recurring')) AS prior_recurring
       FROM donors d WHERE d.id = ? AND d.org_id = ?`, [giftId, giftId, o.donorId, orgId]);
  await OUTBOX.markReady(ev.id, {
    giftCount: after ? Number(after.gift_count) : null, status: after ? after.status : null, stage: after ? after.stage : null,
    subscriptionStatus: after ? after.stripe_subscription_status || null : null,
    priorRecurringNoted: after ? after.prior_recurring_noted : null, priorRecurring: after ? after.prior_recurring : null,
    appliedInstallment: !!appliedInstallment, appliedMembership: !!appliedMembership,
  });
  let later = null, start = null;
  if (o.deferTriggers === true) {
    later = new Promise(r => { start = r; }).then(() => OUTBOX.relay([ev.id]))
      .catch(e => console.error("[gift] after the response:", e.message));
  } else await OUTBOX.relay([ev.id]).catch(e => console.error("[gift] relay (the sweep will):", e.message));
  return { gift, duplicate: false, interactionId, fundId, paymentMethod, posted, appliedInstallment, appliedMembership, extras, later, start, eventId: ev.id };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 193
async function recomputeScoresForOrg(orgId, { wait = true } = {}) {
  if (!dbReady) await DB_READY;   // HARDEN-1: the boot race on donor_scores.pattern
  const prev = _scoreRuns.get(orgId) || Promise.resolve();
  const mine = prev.catch(() => {}).then(async () => {
    const [o] = await query("SELECT id, timezone FROM orgs WHERE id=?", [orgId]);
    if (!o) return 0;
    const runIt = () => engagementMod.recomputeOrgScores(query, orgId, orgTime.orgToday(o));
    if (wait) return withAdvisoryLock(`donor_scores:${orgId}`, runIt);
    const r = await withTryAdvisoryLock(`donor_scores:${orgId}`, runIt);
    return r && r.skipped ? (await scheduleScores(orgId, null, { laterMs: 30000 }), null) : r;
  });
  _scoreRuns.set(orgId, mine);
  mine.catch(() => {}).then(() => { if (_scoreRuns.get(orgId) === mine) _scoreRuns.delete(orgId); });
  return mine;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 199
async function signInternalToken(userId) {
  const [u] = await query("SELECT id, org_id, email, role, is_super_admin FROM users WHERE id = ?", [userId]);
  if (!u) return null;
  return require("../../auth").signInternalToken({ userId: u.id, orgId: u.org_id, email: u.email, role: u.role, isSuperAdmin: !!u.is_super_admin });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 203
// SCALE-2: the nightly Drift refresh: an org whose stored Drift answers are
// from an earlier day gets them recomputed for its new day, so the first visit
// of the morning reads stored rows too. Checked every six hours because each
// org's day turns over in its own timezone.
async function refreshStoredDrift() {
  const orgs = await query(`SELECT o.id FROM orgs o WHERE EXISTS (SELECT 1 FROM donors d WHERE d.org_id = o.id)`, []);
  let n = 0;
  for (const o of orgs) {
    const today = orgToday(await orgTz(o.id));   // ORG_TZ_SEAM_OK
    const [stale] = await query(`SELECT 1 FROM donor_drift WHERE org_id = ? AND computed_for <> ? LIMIT 1`, [o.id, today]);
    const [none] = await query(`SELECT 1 FROM donor_drift WHERE org_id = ? LIMIT 1`, [o.id]);
    if (!stale && none) continue;
    try { await computeDriftForDonors(o.id); n++; } catch (e) { console.error("[drift-store] nightly", o.id, e.message); }
  }
  return n;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 207
// SCORES-1: an org with people; one another run holds is asked again later.
async function recomputeAllScores() {
  const orgs = await query("SELECT o.id FROM orgs o WHERE EXISTS (SELECT 1 FROM donors d WHERE d.org_id = o.id)", []);
  for (const o of orgs) {
    try { await recomputeScoresForOrg(o.id, { wait: false }); } catch (e) { console.error(`[scores] ${o.id}:`, e.message); }
  }
  return [];
}
// SPLIT-2 end
// SPLIT-2 server.js piece 214
async function greetFor(person, fallback = "there") {
  await GREET_READY;
  return GREET.greetingName(person || {}) || fallback;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 215
// POLISH-4: the one opening line (greeting.js greetingLine): "Dear Ruth,",
// "Hi Desmond and Ruth,", and "Hello," only when there is no name to use.
async function openingLine(person, word = "Dear") {
  await GREET_READY;
  return GREET.greetingLine(person || {}, { word });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 216

async function orgDonorIds(orgId, ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return new Set();
  const rows = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND id = ANY(?)", [orgId, list]);
  return new Set(rows.map(r => r.id));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 217

// Checks a gift's extras against the org and the amount. Returns the normalised
// extras, or the reasons (400) / the foreign ids (404, never planted).
async function checkGiftExtras(orgId, hardDonorId, giftCents, raw = {}) {
  await GC_READY;
  const out = { softCredits: [], tribute: null, match: null };
  const errors = [];
  const soft = Array.isArray(raw.softCredits) ? raw.softCredits : [];
  const trib = raw.tribute && typeof raw.tribute === "object" ? raw.tribute : null;
  const match = raw.match && typeof raw.match === "object" ? raw.match : null;
  const named = [...soft.map(s => s?.donorId), trib?.donorId, match?.employerId].filter(Boolean);
  const owned = await orgDonorIds(orgId, named);
  const foreign = named.filter(id => !owned.has(String(id)));
  if (foreign.length) return { notFound: true };
  if (soft.length) {
    const v = GC.validateSoftCredits(giftCents, hardDonorId, soft);
    if (!v.ok) errors.push(...v.errors); else out.softCredits = v.rows;
  }
  if (trib) {
    const type = GC.TRIBUTE_TYPES.includes(trib.type) ? trib.type : GC.normaliseTributeType(trib.type);
    const name = String(trib.name || "").trim().slice(0, 200);
    if (!type) errors.push("a tribute is in honor of someone or in memory of someone");
    else if (!trib.donorId && !name) errors.push("a tribute names the person it honors");
    else out.tribute = {
      type, donorId: trib.donorId ? String(trib.donorId) : null, name,
      notifyName: String(trib.notifyName || "").trim().slice(0, 200) || null,
      notifyEmail: String(trib.notifyEmail || "").trim().slice(0, 200) || null,
      notifyAddress: String(trib.notifyAddress || "").trim().slice(0, 500) || null,
    };
  }
  if (match) {
    if (!match.employerId) errors.push("a match names the employer");
    else if (String(match.employerId) === hardDonorId) errors.push("a person cannot match their own gift");
    else {
      const c = GC.expectedMatchCents(giftCents, match);
      if (c.error) errors.push(c.error);
      else out.match = { employerId: String(match.employerId), cents: c.cents, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(match.dueDate || "") ? match.dueDate : null };
    }
  }
  return errors.length ? { errors } : { extras: out };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 218

// Writes the extras for a gift that now exists. Idempotent per gift: soft
// credits are REPLACED as a set, a tribute notice is one per gift, a match
// pledge is one per gift (uq_pledges_matches_gift).
async function writeGiftExtras(orgId, gift, extras, { actorId = null, actorName = null } = {}) {
  await GC_READY;
  const result = { softCredits: 0, tributeNotice: null, matchPledgeId: null };
  if (!gift || !extras) return result;
  if (Array.isArray(extras.softCredits)) {
    await run("DELETE FROM gift_soft_credits WHERE gift_id=? AND org_id=?", [gift.id, orgId]);
    for (const s of extras.softCredits) {
      await run(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,pct,role,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (gift_id, donor_id) DO NOTHING`,
        [newId("gsc"), orgId, gift.id, s.donorId, s.cents / 100, s.pct, s.role, actorId, actorName]);
      result.softCredits++;
    }
  }
  if (extras.tribute) {
    const t = extras.tribute;
    let honouree = t.name;
    if (t.donorId) {
      const [h] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [t.donorId, orgId]);
      honouree = h?.name || honouree;
    }
    await run("UPDATE gifts SET tribute_type=?, tribute_donor_id=?, tribute_name=? WHERE id=? AND org_id=?",
      [t.type, t.donorId, honouree, gift.id, orgId]);
    // The family gets a notice only when somebody named who to tell. It is a
    // DRAFT: Steward never sends a letter to a grieving family.
    if (t.notifyName || t.notifyEmail || t.notifyAddress) {
      const [donor] = await query("SELECT name, kind FROM donors WHERE id=? AND org_id=?", [gift.donor_id, orgId]);
      const [org] = await query("SELECT name, receipt_signature_name FROM orgs WHERE id=?", [orgId]);
      const orgName = await donorFacingOrgName(orgId, org?.name || "").catch(() => org?.name || "");
      const body = GC.tributeNoticeBody({
        notifyName: t.notifyName, donorName: donor?.kind === "anonymous" ? null : donor?.name,
        honoureeName: honouree, type: t.type, orgName, signer: org?.receipt_signature_name || null,
      });
      const id = newId("tn");
      const ins = await query(
        `INSERT INTO tribute_notices (id,org_id,gift_id,donor_id,tribute_type,honouree_name,notify_name,notify_email,notify_address,body,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (gift_id) DO UPDATE SET tribute_type=EXCLUDED.tribute_type, honouree_name=EXCLUDED.honouree_name,
           notify_name=EXCLUDED.notify_name, notify_email=EXCLUDED.notify_email, notify_address=EXCLUDED.notify_address,
           body=EXCLUDED.body WHERE tribute_notices.status='waiting'
         RETURNING id`,
        [id, orgId, gift.id, gift.donor_id, t.type, honouree, t.notifyName, t.notifyEmail, t.notifyAddress, body, actorId, actorName]);
      result.tributeNotice = ins[0]?.id || null;
    }
  }
  if (extras.match) {
    const m = extras.match;
    const due = m.dueDate || orgTime.addDays(String(gift.date).slice(0, 10), 90);
    // FIX-60 · THE ONE PLEDGE WRITER: one installment for the whole match, so
    // the existing rule in recordGift applies the employer's cheque to it from
    // any door, to the cent. The match may ALREADY be here (an import carries
    // the employee's gift and the company's cheque in the same file, or staff
    // record the match after the fact): an employer gift for exactly the
    // expected amount, on or after this gift, not already paying another
    // pledge, is that match, linked as it is written and its installment paid.
    let alreadyId = null;
    const w = await PW.writePledge({ orgId, donorId: m.employerId, amountCents: m.cents, dueDate: due,
      notes: "Expected matching gift", isMatch: true, matchesGiftId: gift.id, createdBy: actorId, createdByName: actorName,
      plan: { firstDue: due },
      link: async pledgeId => {
        const [already] = await query(
          `SELECT id FROM gifts WHERE org_id=? AND donor_id=? AND pledge_id IS NULL
             AND round(amount::numeric * 100)::bigint = ? AND date >= ? ORDER BY date ASC, id LIMIT 1`,
          [orgId, m.employerId, m.cents, String(gift.date).slice(0, 10)]);
        if (!already) return [];
        await run("UPDATE gifts SET pledge_id=? WHERE id=? AND org_id=?", [pledgeId, already.id, orgId]);
        alreadyId = already.id;
        return [already.id];
      } }, { door: "pledge" });
    if (w.created) {
      const pid = w.id;
      await run("UPDATE gifts SET match_employer_id=?, match_pledge_id=? WHERE id=? AND org_id=?", [m.employerId, pid, gift.id, orgId]);
      result.matchPledgeId = pid;
      if (alreadyId) {
        await recalcPledgePayment(pid, orgId).catch(e => console.error("[match] recalc:", e.message));
        result.matchAlreadyReceived = alreadyId;
      }
    } else {
      const [existing] = await query("SELECT id FROM pledges WHERE matches_gift_id=? AND org_id=?", [gift.id, orgId]);
      result.matchPledgeId = existing?.id || null;
    }
  }
  return result;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 223

async function givingSourcesMod() { return import("../../shared/givingSources.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 224

function sourceConfig(source) {
  const v = source && source.config;
  if (!v) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}
// SPLIT-2 end
// SPLIT-2 server.js piece 225
async function secretBoxMod() { return import("../../shared/secretBox.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 226

// The credentials for one source, opened and bound to its org. A blob that
// will not open is a hard stop, never an empty object: continuing with no
// credentials would call a provider unauthenticated and report "no gifts
// found", which reads like a quiet morning rather than a broken connection.
async function openSourceCredentials(source) {
  if (!source.credentials_sealed) return {};
  const { openBag } = await secretBoxMod();
  return openBag(source.credentials_sealed, { aad: source.org_id });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 227

function firstNameOfDonor(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 228

// A MISSED RECURRING PAYMENT BECOMES A PERSON'S JOB.
// Same shape and the same reasoning as openSustainerLapseThread (the dunning
// path): a donor, an open next step, a due date, owned by whoever owns the
// donor, ranked by threadRank like everything else. The person-surface gate is
// the same one - a sample, deceased, do-not-contact or non-person record never
// gets one.
async function openMissedRecurringThread(orgId, donorId, { amountCents, provider, expectedNext, interval = "month", day = null }) {
  try {
    const [d] = await query(
      `SELECT id, name, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = day || orgToday(org);                       // ORG_TZ_SEAM_OK
    const { sanitizeStepLabel } = await threadShapeMod();
    const { missedPhrase } = await givingSourcesMod();
    const label = sanitizeStepLabel(missedPhrase({
      firstName: firstNameOfDonor(d.name), amountCents, provider, expectedNext, interval,
    })) || "Check on their recurring gift";
    // Due TODAY. By the time this fires the payment is already five days past
    // the date it was expected; a +N-day default would be the product
    // hesitating twice about the same fact.
    return await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: "follow_up", label, due: today },
      openedOn: today,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));
  } catch (e) { console.error("[giving-source] missed thread:", e.message); return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 229

// RECOGNISING A COMMITMENT.
// Runs over the donors a sync actually touched, never the whole org: the
// pattern can only have changed for somebody who just received a gift.
async function refreshRecurringForDonors(orgId, sourceId, provider, donorIds, today) {
  if (!donorIds.length) return { created: 0, updated: 0 };
  const { detectCommitments } = await givingSourcesMod();
  let created = 0, updated = 0;
  for (const donorId of donorIds) {
    const gifts = await query(
      `SELECT external_id, date, round(amount::numeric * 100)::bigint AS cents, provider_recurring_ref
         FROM gifts
        WHERE org_id=? AND donor_id=? AND giving_source_id=?
        ORDER BY date ASC`, [orgId, donorId, sourceId]);
    const rows = gifts.map(g => ({
      externalId: g.external_id, occurredAt: String(g.date).slice(0, 10),
      amountCents: Number(g.cents), recurringRef: g.provider_recurring_ref || null,
      status: "completed",
    }));
    for (const c of detectCommitments(rows, { today })) {
      // The two identities, matching the two partial unique indexes: a
      // provider-named subscription is identified by its ref; an inferred
      // pattern by the donor and the amount.
      const existing = c.recurringRef
        ? await query(`SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND recurring_ref=?`,
                      [orgId, sourceId, c.recurringRef])
        : await query(`SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND donor_id=? AND amount_cents=? AND recurring_ref IS NULL`,
                      [orgId, sourceId, donorId, c.amountCents]);
      if (existing.length) {
        // A commitment that was 'missed' and has just been paid is active
        // again, and `missed_for` clears so a LATER miss raises a new Thread.
        await run(
          `UPDATE giving_recurring
              SET gift_count=?, first_gift_on=?, last_gift_on=?, expected_next=?,
                  amount_cents=?, status='active',
                  missed_for = CASE WHEN ? > COALESCE(missed_for,'') THEN NULL ELSE missed_for END,
                  updated_at=NOW()
            WHERE id=? AND org_id=?`,
          [c.giftCount, c.firstGiftOn, c.lastGiftOn, c.expectedNext, c.amountCents,
           c.lastGiftOn, existing[0].id, orgId]);
        updated++;
      } else {
        await run(
          `INSERT INTO giving_recurring
             (id,org_id,donor_id,source_id,provider,amount_cents,interval,confidence,recurring_ref,
              gift_count,first_gift_on,last_gift_on,expected_next,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active')
           ON CONFLICT DO NOTHING`,
          [newId("gr"), orgId, donorId, sourceId, provider, c.amountCents,
           c.interval, c.confidence, c.recurringRef, c.giftCount, c.firstGiftOn, c.lastGiftOn, c.expectedNext]);
        created++;
      }
    }
  }
  // ---- A LATE PAYMENT STILL SATISFIES THE COMMITMENT ----------------------
  // THE WINDOW DECIDES WHAT BECOMES A COMMITMENT. IT DOES NOT DECIDE WHAT
  // KEEPS ONE.
  //
  // detectCommitments only groups gifts 27 to 34 days apart, which is the
  // right rule for RECOGNISING a monthly donor out of a pile of gifts. It is
  // the wrong rule for maintaining one that is already recognised: a card that
  // soft-declined and retried eight days later lands 39 days after the last
  // gift, falls outside the window, and would leave the commitment frozen on
  // an expected date that has already passed - raising a Thread about a
  // payment that actually arrived, which is the exact failure this whole
  // feature exists to prevent.
  //
  // So once a commitment exists, the next gift of the same amount through the
  // same source satisfies it WHENEVER it lands, and the expectation moves on
  // from there. `missed_for` clears, so a genuinely missed payment next month
  // raises a new Thread.
  for (const donorId of donorIds) {
    const open = await query(
      `SELECT id, amount_cents, recurring_ref, last_gift_on FROM giving_recurring
        WHERE org_id=? AND source_id=? AND donor_id=? AND status <> 'ended'`,
      [orgId, sourceId, donorId]);
    for (const r of open) {
      const [latest] = await query(
        `SELECT MAX(date) AS on_date, COUNT(*)::int AS n FROM gifts
          WHERE org_id=? AND donor_id=? AND giving_source_id=?
            AND round(amount::numeric * 100)::bigint = ?
            AND (?::text IS NULL OR provider_recurring_ref = ?)`,
        [orgId, donorId, sourceId, r.amount_cents, r.recurring_ref, r.recurring_ref]);
      const on = latest?.on_date ? String(latest.on_date).slice(0, 10) : null;
      if (!on || !r.last_gift_on || on <= r.last_gift_on) continue;
      const { addCivilMonths } = await givingSourcesMod();
      await run(
        `UPDATE giving_recurring
            SET last_gift_on=?, expected_next=?, gift_count=?, status='active',
                missed_for=NULL, updated_at=NOW()
          WHERE id=? AND org_id=?`,
        [on, addCivilMonths(on, 1), latest.n, r.id, orgId]);
      updated++;
    }
  }

  return { created, updated };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 230

// THE MISSED SWEEP.
// ONE Thread per missed payment, never one per day. `missed_for` stores the
// expected date already raised, so the second pass over the same unpaid month
// finds nothing to do - which is a property of the data, not of how often the
// sweep happens to run.
async function sweepMissedRecurring(orgId, { today = null, sourceId = null } = {}) {
  const { isMissed } = await givingSourcesMod();
  const org = await orgTz(orgId);
  const day = today || orgToday(org);                  // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT r.*, s.display_name, s.status AS source_status
       FROM giving_recurring r
       JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
      WHERE r.org_id=? AND r.status='active' AND r.expected_next IS NOT NULL
        AND (?::text IS NULL OR r.source_id = ?)`,
    [orgId, sourceId, sourceId]);
  let opened = 0;
  for (const r of rows) {
    // A disconnected source stops producing work. She switched it off.
    if (r.source_status === "disconnected") continue;
    if (!isMissed(r.expected_next, day)) continue;
    if (r.missed_for === r.expected_next) continue;    // already raised, exactly once
    const thread = await openMissedRecurringThread(orgId, r.donor_id, {
      amountCents: Number(r.amount_cents), provider: r.provider,
      expectedNext: r.expected_next, interval: r.interval, day,
    });
    // `missed_for` is stamped whether or not a thread was actually opened: the
    // donor may already have an open thread (the one-open-per-donor rule), and
    // re-attempting every six hours forever would be the loop this column
    // exists to prevent.
    await run(`UPDATE giving_recurring SET status='missed', missed_for=?, missed_thread_id=?, updated_at=NOW()
                WHERE id=? AND org_id=?`,
              [r.expected_next, thread?.id || null, r.id, orgId]);
    if (thread) opened++;
  }
  return { opened, considered: rows.length };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 231

// THE PROVIDER TOLD US. Stripe reports a failed invoice on a subscription;
// Givebutter reports a plan that failed, was canceled or was paused. Both
// arrive as a `failed` contract row carrying the provider's own recurring
// reference, and both mean the same thing: this is not a payment running late,
// it is a payment that did not happen.
//
// `missed_for` is stamped with the commitment's OWN expected date - the same
// value the ordinary sweep would use - so the two paths can never raise two
// Threads about one missed month.
async function raiseToldFailures(orgId, source, failures, day) {
  let opened = 0;
  for (const f of failures || []) {
    const [r] = await query(
      `SELECT * FROM giving_recurring WHERE org_id=? AND source_id=? AND recurring_ref=?`,
      [orgId, source.id, f.ref]);
    // Nothing recognised under that reference yet, so there is no commitment
    // to say anything about. A first-ever payment that fails is not a donor
    // who stopped giving.
    if (!r) continue;
    if (r.status === 'ended') continue;
    const key = r.expected_next || f.on || day;
    if (r.missed_for === key) continue;
    const thread = await openMissedRecurringThread(orgId, r.donor_id, {
      amountCents: Number(r.amount_cents) || f.amountCents,
      provider: source.provider, expectedNext: key, interval: r.interval,
    });
    await run(`UPDATE giving_recurring SET status='missed', missed_for=?, missed_thread_id=?, updated_at=NOW()
                WHERE id=? AND org_id=?`, [key, thread?.id || null, r.id, orgId]);
    if (thread) opened++;
  }
  return opened;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 232

// ═══════════════════════════════════════════════════════════════════════════
//  INT-POS · WHAT HAPPENS TO A SALE
// ═══════════════════════════════════════════════════════════════════════════
//
// ONE FUNCTION, and it is the only way a register's money reaches Steward.
// Its whole job is the sentence "a sale is not a gift": it classifies every
// line against what the organisation said the item IS (shared/posItems.js),
// and only the lines classified as a DONATION are handed to recordGift. The
// rest are written to pos_sales as revenue, where no giving total, lifetime
// figure, drift computation, LYBUNT list or receipt reads them.
//
// WHY THE REST ARE WRITTEN AT ALL. A person who spends $200 a year at the gala
// and has never made a donation is invisible to a CRM that stores only gifts,
// and they are the most askable person in the file. "Buys or attends, has
// never given" is the reason this build exists, and it is answerable only
// because the non-gift money is kept.
//
// NOTHING IS MERGED WITHOUT A CONFIRM. A buyer is matched by email, then
// phone, then an exact name; anything less certain is stored with
// `needs_confirm` and a person decides. A buyer with no match becomes a GUEST
// — a person record typed guest, never a donor, because they have not given a
// penny.
async function ingestPosSale(orgId, sale, { sourceId = null, actorId = null, actorName = null, today = null } = {}) {
  const POS = await import("../../shared/posItems.js");
  const org = await orgTz(orgId);
  const day = today || orgToday(org);                               // ORG_TZ_SEAM_OK
  const externalId = String(sale?.externalId || "").trim();
  if (!externalId) return { ok: false, reason: "no_external_id" };

  // Asked once. A second read of the same night writes nothing twice.
  const [seen] = await query("SELECT id FROM pos_sales WHERE org_id=? AND external_id=?", [orgId, externalId]);
  if (seen) return { ok: true, duplicate: true, saleId: seen.id };

  const mapRows = await query(
    `SELECT item_key, item_class, event_id FROM pos_item_mappings
      WHERE org_id=? AND (source_id IS NULL OR source_id=?)`, [orgId, sourceId]);
  const mapping = new Map(mapRows.map(r => [r.item_key, { class: r.item_class, eventId: r.event_id }]));
  const events = await query(
    `SELECT id, date::text AS date, location FROM events WHERE org_id=? AND status <> 'cancelled'`, [orgId]);

  const occurredOn = String(sale.occurredAt || day).slice(0, 10);
  const classed = POS.classifySale({ lines: (sale.lines || []).map(l => ({ ...l, occurredAt: occurredOn,
    locationName: sale.locationName || l.locationName })) }, mapping, { events });

  // WHO BOUGHT IT. Never merged on a guess.
  const people = await query(
    `SELECT id, name, email, phone FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]);
  const match = POS.matchBuyer(sale.buyer || {}, people);
  let personId = match.confident ? match.personId : null;
  let needsConfirm = !match.confident && (match.candidates || []).length > 0;
  if (!personId && !needsConfirm && (sale.buyer?.name || sale.buyer?.email)) {
    // A stranger at the till becomes a GUEST. Typed guest, never donor: they
    // have not given a penny, and putting them in a donor list would be the
    // same mistake as typing a peer-to-peer fundraiser as a donor (BUILD-103).
    personId = newId("d");
    await run(
      `INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
       VALUES (?,?,?,?,?,'prospect','active','[]','["guest"]'::jsonb,?,?)`,
      [personId, orgId, String(sale.buyer.name || sale.buyer.email).slice(0, 200),
       sale.buyer.email || null, sale.buyer.phone || null,
       actorId || SYS_SOURCE.id, actorName || SYS_SOURCE.name]).catch(() => {});
  }

  // THE ONLY GIFT PATH. One gift for the donation lines of this sale, through
  // recordGift, with the fee. Never a second writer, and never for a line the
  // organisation did not call a donation.
  let giftId = null;
  if (classed.giftCents > 0 && personId) {
    const written = await recordGift({
      orgId, donorId: personId, amount: classed.giftCents / 100, date: occurredOn,
      type: "cash", paymentMethod: "Card",
      externalId: `pos:${externalId}`, conflict: "external",   // BUILD-92's dedupe: the same money arriving another way is not written twice
      givingSourceId: sourceId,
      processorFeeAmount: sale.feeCents ? sale.feeCents / 100 : 0,
      notes: `At the register${sale.locationName ? `, ${sale.locationName}` : ""}.`,
      actorId: actorId || SYS_SOURCE.id, actorName: actorName || SYS_SOURCE.name,
      defaultFund: false, door: "giving_source_read",
    }).catch(e => { console.error("[pos] gift:", e.message); return null; });
    giftId = written?.gift?.id || null;
  }

  const eventId = classed.lines.find(l => l.eventId)?.eventId || null;
  const id = newId("pos");
  await run(
    `INSERT INTO pos_sales (id,org_id,source_id,external_id,occurred_on,person_id,match_by,needs_confirm,
                            buyer_name,buyer_email,buyer_phone,location_name,event_id,
                            total_cents,gift_cents,event_cents,other_cents,unmapped_lines,lines,
                            created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, sourceId, externalId, occurredOn, personId, match.by || null, needsConfirm,
     sale.buyer?.name || null, sale.buyer?.email || null, sale.buyer?.phone || null,
     sale.locationName || null, eventId,
     classed.totalCents, classed.giftCents, classed.eventCents, classed.otherCents,
     classed.unmapped, JSON.stringify(classed.lines),
     actorId || SYS_SOURCE.id, actorName || SYS_SOURCE.name]);

  return { ok: true, saleId: id, giftId, personId, needsConfirm,
           giftCents: classed.giftCents, eventCents: classed.eventCents, otherCents: classed.otherCents,
           unmapped: classed.unmapped, sentence: classed.sentence };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 233

// ── INT-1 · WATCHING · A CONNECTION THAT GOES QUIET SAYS SO ────────────────
//
// A broken connection announces itself: the next check fails and the card goes
// red. A connection that has simply STOPPED SENDING looks identical to a quiet
// fortnight, and that is the one that costs an organisation real money — the
// PayPal key whose permission lapsed in March and was noticed in July.
//
// The judgement is shared/connections.js and it is the connection's OWN
// rhythm, never a fixed number of days: four gifts a week means twelve days of
// silence is wrong, and one gift a quarter means twelve WEEKS is fine.
//
// ONE INCIDENT, ONE EMAIL. `quiet_notified_at` is what makes this an incident
// rather than a six-hourly reminder, and `notifyUserOnce` dedupes underneath
// it as well, keyed on the incident. The moment money arrives again, both are
// cleared, so the NEXT time it goes quiet is a new incident that says so.
//
// The next step is a TASK, not a Thread row: a thread is keyed to a donor
// (`threads.donor_id` is NOT NULL, by design — a thread is a relationship with
// a person), and "PayPal has stopped sending" is work for the office, which is
// exactly what a task is.
async function sweepQuietConnections({ orgId = null, today = null, notify = true } = {}) {
  const C = await import("../../shared/connections.js");
  const { providerLabel } = await givingSourcesMod();
  const out = { checked: 0, quiet: 0, recovered: 0, tasksOpened: 0, emailed: 0 };
  const sources = await query(
    `SELECT * FROM giving_sources WHERE status <> 'disconnected'${orgId ? " AND org_id=?" : ""}`,
    orgId ? [orgId] : []);
  for (const s of sources) {
    out.checked++;
    const org = await orgTz(s.org_id);
    const day = today || orgToday(org);                            // ORG_TZ_SEAM_OK
    const rows = await query(
      `SELECT date::text AS d FROM gifts
        WHERE org_id=? AND giving_source_id=? AND amount > 0 AND date >= ?`,
      [s.org_id, s.id, orgTime.addDays(day, -C.RHYTHM_WINDOW_DAYS)]);
    const dates = rows.map(r => r.d);
    const last = dates.length ? dates.slice().sort().pop() : null;
    const a = C.assessConnection({ connected: true, lastError: s.last_error, lastGiftDate: last,
                                   giftDates: dates, today: day });

    // MONEY CAME BACK. The incident is over; clear it so the next silence is
    // its own incident with its own email rather than a permanently-set flag.
    if (a.status === "healthy") {
      if (s.quiet_notified_at) {
        await run(`UPDATE giving_sources SET quiet_notified_at=NULL, quiet_incident=NULL, updated_at=NOW()
                    WHERE id=?`, [s.id]);
        out.recovered++;
      }
      continue;
    }
    if (a.status !== "quiet" && a.status !== "broken") continue;
    out.quiet++;

    // The incident's identity: what went wrong, and the day it started. A
    // second sweep on the same day for the same reason is the same incident.
    const incident = `${a.status}:${last || "never"}`;
    if (s.quiet_incident === incident) continue;

    const label = providerLabel(s.provider) || s.display_name;
    const line = a.status === "broken"
      ? `${label} stopped working. ${a.sentence}`
      : `${label} has not sent a gift in ${a.silentDays} days. ${a.rhythm?.sentence || ""} Check the connection.`.trim();

    // The next step, as a task for whoever runs this office.
    const [admin] = await query(
      `SELECT id, name, email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL
        ORDER BY created_at ASC LIMIT 1`, [s.org_id]);
    if (admin) {
      // WIRE-1: this used to read tasks.completed and write tasks.due_date,
      // columns the table does not have (it has done and due), and the catch
      // swallowed the error, so the task was never made. One opener now.
      const made = await openAdminTask(s.org_id, { title: line, due: today || orgToday(org), priority: "high",   // ORG_TZ_SEAM_OK
        assignee: admin, actorId: SYS_SOURCE.id, actorName: SYS_SOURCE.name });
      if (made) out.tasksOpened++;
      if (notify) {
        const r = await notifyUserOnce({
          org: { id: s.org_id }, userId: admin.id, email: admin.email,
          eventKey: `connection:${s.id}:${incident}`, channel: "email", prefKind: "connection_alerts",
          subject: a.status === "broken" ? `${label} has stopped working` : `${label} has gone quiet`,
          bodyHtml: `<p>${line}</p><p>Connections shows what Steward last read and when.</p>${(await ItemRefs.links()).buttonHtml(`Open ${label}`, `${publicAppUrl()}/app/settings?section=connections`)}`,
        }).catch(() => ({ sent: false }));
        if (r && r.sent) out.emailed++;
      }
    }
    await run(`UPDATE giving_sources SET quiet_notified_at=NOW(), quiet_incident=?, updated_at=NOW() WHERE id=?`,
      [incident, s.id]);
  }
  return out;
}
// SPLIT-2 end

__share({ _logOutboundEmail, orgTz, orgTzName, actor, makeOAuth2Client, retryWords, rateLimitHandler, registerJourneyNudge, refreshReconcileDenominator, reconciliationHealth, guardState, guardsOk, webhookSubHealth, ensureOrgLedger, orgUnrestrictedFundId, registerJourneyEngine, runVolunteerRemindersTick, maybeStartJourneyFromServer, recordGift, recomputeScoresForOrg, signInternalToken, refreshStoredDrift, recomputeAllScores, greetFor, openingLine, orgDonorIds, checkGiftExtras, writeGiftExtras, givingSourcesMod, sourceConfig, secretBoxMod, openSourceCredentials, firstNameOfDonor, openMissedRecurringThread, refreshRecurringForDonors, sweepMissedRecurring, raiseToldFailures, ingestPosSale, sweepQuietConnections });
