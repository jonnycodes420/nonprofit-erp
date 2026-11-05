// SPLIT-2: moved VERBATIM from server.js (its functions from lines 2287-3768). server.js requires the boot modules in
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
let AFTER, AUTO_MOVE_OFFICER, BUILD_SHA, CROSS_SOURCE_DAY_WINDOW, DB_NAME, DONOR_SUMMARY_UPDATE, GREET, HISTORY, LAPSE_DAYS, PRODUCT_ID, SKIPPED_KEPT, SKIP_LISTED_REASONS, SOURCE_AUTH_SENTENCE, SOURCE_PERMISSION_SENTENCE, SOURCE_SYNC_MAX_PAGES, SOURCE_SYNC_RESYNC_DAYS, SYS_AUTO, SYS_SOURCE, THANK_YOU_PLEDGE_FLOOR_CENTS, TOTP, _ROMAN_SUFFIX, assetHealth, billingModeStatus, dbReady, givingSourcesMod, guardFailures, guardState, guardsOk, ledgerChartSelfHeals, mailboxSyncHealth, maybeStartJourneyFromServer, money, newId, notifyFailedPending, openSourceCredentials, openThreadTx, orgTime, orgToday, orgTz, query, raiseToldFailures, reconciliationHealth, recordGift, refreshRecurringForDonors, resolvePublicAppUrl, run, signToken, sourceAdapters, sourceConfig, sweepMissedRecurring, webhookSubHealth, withAdvisoryLock, withTransaction;
__boot.register(c => {
  if ("AFTER" in c) AFTER = c.AFTER;
  if ("AUTO_MOVE_OFFICER" in c) AUTO_MOVE_OFFICER = c.AUTO_MOVE_OFFICER;
  if ("BUILD_SHA" in c) BUILD_SHA = c.BUILD_SHA;
  if ("CROSS_SOURCE_DAY_WINDOW" in c) CROSS_SOURCE_DAY_WINDOW = c.CROSS_SOURCE_DAY_WINDOW;
  if ("DB_NAME" in c) DB_NAME = c.DB_NAME;
  if ("DONOR_SUMMARY_UPDATE" in c) DONOR_SUMMARY_UPDATE = c.DONOR_SUMMARY_UPDATE;
  if ("GREET" in c) GREET = c.GREET;
  if ("HISTORY" in c) HISTORY = c.HISTORY;
  if ("LAPSE_DAYS" in c) LAPSE_DAYS = c.LAPSE_DAYS;
  if ("PRODUCT_ID" in c) PRODUCT_ID = c.PRODUCT_ID;
  if ("SKIPPED_KEPT" in c) SKIPPED_KEPT = c.SKIPPED_KEPT;
  if ("SKIP_LISTED_REASONS" in c) SKIP_LISTED_REASONS = c.SKIP_LISTED_REASONS;
  if ("SOURCE_AUTH_SENTENCE" in c) SOURCE_AUTH_SENTENCE = c.SOURCE_AUTH_SENTENCE;
  if ("SOURCE_PERMISSION_SENTENCE" in c) SOURCE_PERMISSION_SENTENCE = c.SOURCE_PERMISSION_SENTENCE;
  if ("SOURCE_SYNC_MAX_PAGES" in c) SOURCE_SYNC_MAX_PAGES = c.SOURCE_SYNC_MAX_PAGES;
  if ("SOURCE_SYNC_RESYNC_DAYS" in c) SOURCE_SYNC_RESYNC_DAYS = c.SOURCE_SYNC_RESYNC_DAYS;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("SYS_SOURCE" in c) SYS_SOURCE = c.SYS_SOURCE;
  if ("THANK_YOU_PLEDGE_FLOOR_CENTS" in c) THANK_YOU_PLEDGE_FLOOR_CENTS = c.THANK_YOU_PLEDGE_FLOOR_CENTS;
  if ("TOTP" in c) TOTP = c.TOTP;
  if ("_ROMAN_SUFFIX" in c) _ROMAN_SUFFIX = c._ROMAN_SUFFIX;
  if ("assetHealth" in c) assetHealth = c.assetHealth;
  if ("billingModeStatus" in c) billingModeStatus = c.billingModeStatus;
  if ("dbReady" in c) dbReady = c.dbReady;
  if ("givingSourcesMod" in c) givingSourcesMod = c.givingSourcesMod;
  if ("guardFailures" in c) guardFailures = c.guardFailures;
  if ("guardState" in c) guardState = c.guardState;
  if ("guardsOk" in c) guardsOk = c.guardsOk;
  if ("ledgerChartSelfHeals" in c) ledgerChartSelfHeals = c.ledgerChartSelfHeals;
  if ("mailboxSyncHealth" in c) mailboxSyncHealth = c.mailboxSyncHealth;
  if ("maybeStartJourneyFromServer" in c) maybeStartJourneyFromServer = c.maybeStartJourneyFromServer;
  if ("money" in c) money = c.money;
  if ("newId" in c) newId = c.newId;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("openSourceCredentials" in c) openSourceCredentials = c.openSourceCredentials;
  if ("openThreadTx" in c) openThreadTx = c.openThreadTx;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("query" in c) query = c.query;
  if ("raiseToldFailures" in c) raiseToldFailures = c.raiseToldFailures;
  if ("reconciliationHealth" in c) reconciliationHealth = c.reconciliationHealth;
  if ("recordGift" in c) recordGift = c.recordGift;
  if ("refreshRecurringForDonors" in c) refreshRecurringForDonors = c.refreshRecurringForDonors;
  if ("resolvePublicAppUrl" in c) resolvePublicAppUrl = c.resolvePublicAppUrl;
  if ("run" in c) run = c.run;
  if ("signToken" in c) signToken = c.signToken;
  if ("sourceAdapters" in c) sourceAdapters = c.sourceAdapters;
  if ("sourceConfig" in c) sourceConfig = c.sourceConfig;
  if ("sweepMissedRecurring" in c) sweepMissedRecurring = c.sweepMissedRecurring;
  if ("webhookSubHealth" in c) webhookSubHealth = c.webhookSubHealth;
  if ("withAdvisoryLock" in c) withAdvisoryLock = c.withAdvisoryLock;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
});

// SPLIT-2 server.js piece 234

// syncSource(orgId, sourceId) - the one entry point. Returns a run summary;
// never throws for a provider problem (that becomes `last_error` and a
// sentence a human can act on).
async function syncSource(orgId, sourceId, { today = null, adapter = null, actor = null, reason = "scheduled", fetchImpl = undefined } = {}) {
  const { normalizeRow, externalKey } = await givingSourcesMod();
  const [source] = await query("SELECT * FROM giving_sources WHERE id=? AND org_id=?", [sourceId, orgId]);
  if (!source) return { ok: false, error: "source_not_found" };
  if (source.status === "disconnected") return { ok: false, error: "source_disconnected" };

  const org = await orgTz(orgId);
  const day = today || orgToday(org);                  // ORG_TZ_SEAM_OK
  const actorId = actor?.id || SYS_SOURCE.id, actorName = actor?.name || SYS_SOURCE.name;
  const isBackfill = !source.backfilled_at;
  const summary = {
    sourceId, provider: source.provider, reason, isBackfill,
    // FIX-36: the one line a first read's summary says about what it started.
    historyNote: isBackfill ? HISTORY.HISTORY_NOTE : null,
    rowsRead: 0, giftsCreated: 0, duplicates: 0, donorsCreated: 0,
    centsCreated: 0, feeCents: 0,
    refundsSkipped: 0, refundsOnFile: [], failedSkipped: 0, failedRecurring: [],
    dropped: {}, nameCollisions: [], notices: [],
    // BUILD-92 A3 — two counters, deliberately separate. `duplicateQuestions`
    // is money Steward did NOT write and a human still has to answer for;
    // `ridesOnTop` is money the shortcut resolved without asking. Summing them
    // would hide which of the two happened, which is the only thing that
    // matters when the totals look wrong.
    duplicateQuestions: 0, ridesOnTop: 0,
    // CONNECT-2: every row that was skipped for a problem with the ROW (not
    // a payout or a pending payment, which are simply not gifts), with its
    // provider id and the reason in words. The card lists these.
    skipped: [],
  };
  const touchedDonors = new Set();

  // Serialized per source: "Check now" pressed during a scheduled run must not
  // double the work. Dedupe makes a double run harmless to the DATA; the lock
  // keeps the counters and the cursor honest.
  return await withAdvisoryLock(`givingsource:${sourceId}`, async () => {
    try {
      const use = adapter || sourceAdapters.getAdapter(source.provider);
      if (!use) throw Object.assign(new Error(`no adapter for ${source.provider}`), { code: "NO_ADAPTER" });
      let credentials = await openSourceCredentials(source);
      // CONNECT-2 · A SQUARE CONNECTED BY OAUTH RENEWS ITS TOKEN. Square's
      // access token lasts thirty days; a source that holds a refresh token
      // and an expiry asks the one token seam (routes/finance.js
      // accessTokenFor), which renews five minutes early and re-seals the
      // bag. A pasted personal token has no expiry and is used as it is.
      if (source.provider === "square" && source.token_expires_at && credentials.refreshToken) {
        const tok = await require("../../routes/finance").accessTokenFor(orgId, source, "square");
        if (!tok.ok) throw Object.assign(new Error(tok.body.sentence), { status: 401, step: "auth" });
        credentials = { ...credentials, accessToken: tok.accessToken };
      }
      const http = sourceAdapters.readOnlyHttp(source.provider, fetchImpl ? { fetchImpl } : {});

      // The window. A backfill walks as far back as the provider allows (the
      // adapter decides how, because only it knows the provider's limit); an
      // incremental sync re-reads the last few days because providers publish
      // late, and lets de-duplication absorb the overlap.
      // ORG_TZ_SEAM_OK — the window start is a CIVIL date in the org's own
      // calendar, read through the one seam. A UTC slice of the last-sync
      // instant would put the boundary on the wrong day for every org west of
      // Greenwich, which is most of them.
      const lastSyncedDay = source.last_synced_at ? orgToday(org, new Date(source.last_synced_at)) : day;
      const since = isBackfill ? null : orgTime.addDays(lastSyncedDay, -SOURCE_SYNC_RESYNC_DAYS);

      let cursor = isBackfill ? null : source.sync_cursor || null;
      let page = 0, done = false;
      while (!done && page < SOURCE_SYNC_MAX_PAGES) {
        // BUILD-95 §5A — `config` is what the ORGANISATION told this source
        // (which Square locations are giving). An adapter that does not need
        // to be told anything ignores it.
        const out = await use.fetchRows({ credentials, since, until: day, cursor, http, today: day,
                                          backfill: isBackfill, config: sourceConfig(source) });
        page++;
        for (const n of out?.notices || []) summary.notices.push(n);
        for (const k of out?.skipped || []) noteSkippedRow(summary, k, SKIP_LISTED_REASONS[k.reason] || String(k.reason || "").replace(/_/g, " "));
        for (const raw of out?.rows || []) {
          summary.rowsRead++;
          const norm = normalizeRow(raw, { provider: source.provider });
          if (!norm.ok) {
            summary.dropped[norm.reason] = (summary.dropped[norm.reason] || 0) + 1;
            if (SKIP_LISTED_REASONS[norm.reason]) noteSkippedRow(summary, raw, SKIP_LISTED_REASONS[norm.reason]);
            continue;
          }
          // CONNECT-2 · ONE BAD ROW NEVER BREAKS THE RUN (MAILCHIMP-1's rule,
          // for money). A row the database refuses used to throw out of this
          // loop: the whole check was recorded as failed, the card went
          // broken, and every gift after that row was never read. Now the row
          // is skipped and LISTED with the reason, and the run carries on.
          try {
            await writeSourceRow(orgId, source, norm.row, {
              day, actorId, actorName, isBackfill, summary, touchedDonors, externalKey,
            });
          } catch (rowErr) {
            console.error(`[giving-source] ${source.provider} org=${orgId} skipped one row: ${rowErr.code || rowErr.message}`);
            noteSkippedRow(summary, norm.row, "Steward could not save this row, so it was skipped. The rest of the check carried on.");
          }
        }
        cursor = out?.cursor ?? null;
        done = out?.done !== false || !cursor;
      }
      if (page >= SOURCE_SYNC_MAX_PAGES) summary.notices.push(`Stopped after ${SOURCE_SYNC_MAX_PAGES} pages; the next check will continue.`);

      const rec = await refreshRecurringForDonors(orgId, sourceId, source.provider, [...touchedDonors], day);
      summary.recurring = rec;
      const swept = await sweepMissedRecurring(orgId, { today: day, sourceId });
      const told = await raiseToldFailures(orgId, source, summary.failedRecurring, day);
      summary.threadsOpened = swept.opened + told;

      // LIVE-1 · the one after-change step for everybody this read touched,
      // then "what this told us". newGiftIds is not part of the stored summary.
      const newGiftIds = summary.newGiftIds || []; delete summary.newGiftIds;
      const ac = await AFTER.afterChangeNow(orgId, [...touchedDonors], { door: "giving_source_read", history: isBackfill,
        fire: (did, gid) => maybeStartJourneyFromServer(orgId, did, "joined_group", { groupId: gid }) });
      const runId = await recordSourceRun(orgId, source, summary, { actorId, actorName, day });
      if (newGiftIds.length) {
        await require("../../readout").writeReadout(orgId, {
          sourceKind: "giving_source", sourceId: runId || sourceId, sourceName: source.display_name || source.provider,
          giftIds: newGiftIds, donorIds: [...touchedDonors], crossings: ac.crossings, becameLate: ac.becameLate, today: day,
        }).catch(e => console.error("[readout] giving source:", e.message));
      }
      await run(
        `UPDATE giving_sources
            SET last_synced_at=NOW(), last_tried_at=NOW(), sync_cursor=?, last_error=NULL, last_error_at=NULL,
                last_error_status=NULL, last_error_provider_code=NULL,
                status='active', last_run_id=?, backfilled_at=COALESCE(backfilled_at, NOW()), updated_at=NOW()
          WHERE id=? AND org_id=?`, [cursor, runId, sourceId, orgId]);
      summary.ok = true; summary.runId = runId;
      console.log(`[giving-source] ${source.provider} org=${orgId} read=${summary.rowsRead} new=${summary.giftsCreated} dupes=${summary.duplicates}`);
      return summary;
    } catch (e) {
      // An error reads as a sentence with what to do, never a code - 89f shows
      // this string verbatim on the Settings row.
      const sentence = sourceErrorSentence(e, source);
      // BUILD-92 A2 — the two facts that used to be thrown away land BESIDE
      // the sentence (never replacing it): the HTTP status the provider
      // answered with, and the provider's own error code. They are what an
      // administrator needs when the sentence is not enough, and they are what
      // proves which branch of the auth/permission split actually fired.
      const { kind, status, providerCode } = classifySourceError(e);
      await run(`UPDATE giving_sources
                    SET status='error', last_error=?, last_error_at=NOW(), last_tried_at=NOW(),
                        last_error_status=?, last_error_provider_code=?, updated_at=NOW()
                  WHERE id=? AND org_id=?`,
        [sentence, status, providerCode, sourceId, orgId]).catch(() => {});
      console.error(`[giving-source] ${source.provider} org=${orgId}: ${kind}`,
        { status, providerCode, message: e.message });
      return { ...summary, ok: false, error: e.code || "sync_failed", message: sentence };
    }
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 237
function noteSkippedRow(summary, row, reason) {
  if (summary.skipped.length >= SKIPPED_KEPT) return;
  const r = row || {};
  summary.skipped.push({
    externalId: String(r.externalId ?? r.id ?? "").slice(0, 120) || null,
    occurredAt: r.occurredAt ? String(r.occurredAt).slice(0, 10) : null,
    donorName: String(r.donorName || "").replace(/\u0000/g, "").slice(0, 120) || null,
    amountCents: Number.isInteger(r.amountCents) ? r.amountCents : null,
    reason,
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 239

// Does one of these two sources ride on the other? THE ONE SHORTCUT, per
// source, set by a human who knows their own stack ("Donorbox sits on top of
// Stripe"). Either direction counts: the relationship is about the money
// being the same money, not about which row was typed first.
function sourcesRideTogether(a, b) {
  // A gift from Steward's own Stripe has no source row at all (id null), and
  // null === null must never read as "these two are one stack".
  if (!a || !b || !a.id || !b.id) return false;
  return a.sits_on_top_of === b.id || b.sits_on_top_of === a.id;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 240

// The gift already on file that this provider row looks like, or null.
// Ordered by how close the dates are, so the nearest candidate is the one a
// human is asked about.
//
// CONNECT-2: the other side may also be a gift Steward's OWN Stripe recorded
// (the donation webhook leaves no source and a payment id). Givebutter or
// Zeffy reporting money the org also took on its giving page through Stripe
// is the same money, and it is asked about once, never written twice.
async function findCrossSourceGift(orgId, source, row, donor) {
  const rows = await query(
    `SELECT g.id, g.amount, g.date, g.external_id, g.giving_source_id,
            s.id AS src_id, COALESCE(s.display_name, 'Stripe') AS src_name, COALESCE(s.provider, 'stripe') AS src_provider,
            s.sits_on_top_of AS src_sits_on_top_of
       FROM gifts g
       LEFT JOIN giving_sources s ON s.id = g.giving_source_id AND s.org_id = g.org_id
      WHERE g.org_id = ?
        AND ((g.giving_source_id IS NOT NULL AND g.giving_source_id <> ?)
             OR (g.giving_source_id IS NULL AND COALESCE(g.stripe_payment_id, '') <> ''))
        AND ROUND(g.amount * 100) = ?
        AND g.date::date BETWEEN ?::date - ?::int AND ?::date + ?::int
        AND g.donor_id IN (
              SELECT d.id FROM donors d
               WHERE d.org_id = ? AND d.deleted_at IS NULL
                 AND (d.id = ? OR (COALESCE(d.email,'') <> '' AND LOWER(d.email) = LOWER(?)))
            )
      ORDER BY ABS(g.date::date - ?::date), g.id
      LIMIT 1`,
    [orgId, source.id, row.amountCents,
     row.occurredAt, CROSS_SOURCE_DAY_WINDOW, row.occurredAt, CROSS_SOURCE_DAY_WINDOW,
     // resolveSourceDonor returns { id, name } - the address to match on is the
     // one the PROVIDER reported, which is also the one it resolved the donor
     // by. The sentinel makes the email arm dead rather than matching blanks
     // when a provider row carries no address at all. CONNECT-2: it was a NUL
     // byte, which Postgres refuses in any text parameter (22021), so EVERY
     // provider row without an email failed the whole check and left an
     // orphan donor behind. Spaces make it equally impossible as an address.
     orgId, donor.id, (row.donorEmail || "").trim() || "no email on this row",
     row.occurredAt]);
  return rows[0] || null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 241

// The line a human reads. One sentence, the money and the place it already
// came from, because that is what makes the answer obvious.
function crossSourceSentence(amountCents, otherSourceName, otherDate) {
  // money.js is the ONE renderer. A whole-dollar amount drops the ".00" by
  // TRIMMING THE RENDERED STRING - never by rounding the number, which is the
  // fingerprint tests/money-cents.test.js §5 exists to refuse and which caught
  // the first draft of this line.
  const dollars = money.formatCents(amountCents).replace(/\.00$/, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(otherDate || ""));
  const MONTHS = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const when = m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : String(otherDate || "");
  return `Looks like the same ${dollars} gift already here from ${otherSourceName} on ${when}.`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 242

// ONE contract row -> at most one gift, through recordGift.
async function writeSourceRow(orgId, source, row, ctx) {
  const { day, actorId, actorName, isBackfill, summary, touchedDonors, externalKey } = ctx;
  const key = externalKey(source.provider, row.externalId);

  if (row.status === "failed") {
    summary.failedSkipped++;
    // A PROVIDER SAYING A RECURRING PAYMENT DID NOT HAPPEN IS BETTER EVIDENCE
    // THAN THE ABSENCE OF ONE. The five-day grace exists because an absence is
    // ambiguous - the money may simply be late, or published late. A named
    // failure on a named subscription is not ambiguous, so it raises the
    // Thread the same day rather than waiting the grace out. This is also the
    // one channel a stopped Givebutter plan travels down: the contract already
    // had a place for it, so there is no second path to keep in step.
    if (row.recurringRef) {
      summary.failedRecurring.push({ ref: row.recurringRef, on: row.occurredAt, amountCents: row.amountCents });
    }
    return;
  }
  if (row.status === "refunded") {
    // See the refund note at the top of this section. A refund whose gift is
    // already on file is NAMED, not silently miscounted.
    const [onFile] = await query("SELECT id, amount, donor_id FROM gifts WHERE org_id=? AND external_id=?", [orgId, key]);
    if (onFile) {
      const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [onFile.donor_id, orgId]);
      summary.refundsOnFile.push({ giftId: onFile.id, donor: d?.name || "", amount: Number(onFile.amount) || 0 });
    } else summary.refundsSkipped++;
    return;
  }

  // BUILD-92 A3 — a row this org has ALREADY ANSWERED about, or already been
  // asked about, says nothing new. Checked before the donor is resolved so a
  // re-sync of an answered row cannot create a donor record either.
  const [answered] = await query(
    `SELECT id FROM gifts WHERE org_id=? AND also_external_ids @> ?::jsonb LIMIT 1`,
    [orgId, JSON.stringify([key])]);
  if (answered) { summary.duplicates++; return; }
  // CONNECT-2 · THE SAME PAYMENT FROM A FILE. An organisation that brought
  // its history in from the provider's own export (Zeffy's Payments export,
  // Givebutter's transactions file) has those gifts under the provider's BARE
  // id, because the import keeps the id column as it was. The API names the
  // same payment `zeffy:<id>`. Same bare id and the same amount to the cent is
  // the same payment: the API's key goes onto the imported gift and nothing
  // new is written.
  const [fromFile] = await query(
    `SELECT id FROM gifts WHERE org_id=? AND external_id=? AND giving_source_id IS NULL
        AND ROUND(amount * 100) = ? LIMIT 1`, [orgId, String(row.externalId), row.amountCents]);
  if (fromFile) {
    await run(`UPDATE gifts SET also_external_ids = COALESCE(also_external_ids, '[]'::jsonb) || ?::jsonb
                WHERE id=? AND org_id=?`, [JSON.stringify([key]), fromFile.id, orgId]);
    summary.duplicates++;
    return;
  }
  const [standing] = await query(
    `SELECT id, status FROM gift_duplicate_questions WHERE org_id=? AND external_key=?`, [orgId, key]);
  if (standing && standing.status === "open") { summary.duplicateQuestions++; return; }
  if (standing && standing.status === "same_gift") { summary.duplicates++; return; }

  const donor = await resolveSourceDonor(orgId, source, row, { actorId, actorName, summary });
  if (!donor) { summary.dropped.no_donor_identity = (summary.dropped.no_donor_identity || 0) + 1; return; }
  touchedDonors.add(donor.id);

  // …and only now, with a donor, can the cross-source question be asked.
  // `standing.status === "kept_both"` falls straight through: that gift was
  // written with this external id and recordGift's own dedupe holds it.
  if (!standing) {
    const other = await findCrossSourceGift(orgId, source, row, donor);
    if (other) {
      const otherSource = { id: other.src_id, sits_on_top_of: other.src_sits_on_top_of };
      if (sourcesRideTogether(source, otherSource)) {
        // THE SHORTCUT. Somebody has already said these two are one stack, so
        // the second id goes onto the gift and nobody is asked anything.
        await run(
          `UPDATE gifts SET also_external_ids = COALESCE(also_external_ids, '[]'::jsonb) || ?::jsonb
            WHERE id=? AND org_id=?`, [JSON.stringify([key]), other.id, orgId]);
        summary.ridesOnTop++;
        return;
      }
      const sentence = crossSourceSentence(row.amountCents, other.src_name || other.src_provider, other.date);
      await run(
        `INSERT INTO gift_duplicate_questions
           (id,org_id,source_id,existing_gift_id,existing_source_id,external_key,donor_id,
            amount_cents,occurred_at,sentence,candidate,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?)
         ON CONFLICT (org_id, external_key) DO NOTHING`,
        [newId("gdq"), orgId, source.id, other.id, other.src_id, key, donor.id,
         row.amountCents, row.occurredAt, sentence, JSON.stringify(row), actorId, actorName]);
      summary.duplicateQuestions++;
      return;
    }
  }

  const written = await recordGift({
    orgId, donorId: donor.id,
    amount: row.amountCents / 100,                 // the GROSS. Always the gross.
    date: row.occurredAt,
    type: "cash",
    notes: row.memo || "",
    // The source's default fund if an admin set one, otherwise nothing.
    // `defaultFund: false` is recordGift's donor-initiated case: nobody at the
    // organisation has said where this money goes, so it is not designated.
    fundId: source.default_fund_id || null,
    defaultFund: false,
    // The bookkeeper's export shows "PayPal" on the row, which is the point.
    paymentMethod: source.display_name,
    externalId: key,
    conflict: "external",
    givingSourceId: source.id,
    processorFeeAmount: row.feeCents / 100,
    providerRecurringRef: row.recurringRef || null,
    // BUILD-83 - the first read of a source is import history and never posts.
    post: !isBackfill,
    source: `giving-source:${source.provider}`,
    actorId, actorName,
    // FIX-36: the first read is a history read. A backfill of three years
    // does not open three years of thank-you drafts or start a journey for a
    // gift from last spring; the gifts of the last 30 days are new to the
    // donor and are treated as new (historyGifts.js). Later syncs are live.
    history: isBackfill, today: day,
    // LIVE-1 — the read calls the after-change step once, for everyone.
    door: "giving_source_read", afterChange: false,
  });
  if (written.duplicate) { summary.duplicates++; return; }
  (summary.newGiftIds = summary.newGiftIds || []).push(written.gift.id);
  summary.giftsCreated++;
  summary.centsCreated += row.amountCents;
  summary.feeCents += row.feeCents;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 243

// THE DONOR.
// Exact email attaches. No email match creates. A NAME that matches somebody
// already on file never merges - it lands on a new person and is reported.
async function resolveSourceDonor(orgId, source, row, { actorId, actorName, summary }) {
  const email = (row.donorEmail || "").trim().toLowerCase();
  const name = (row.donorName || "").trim();
  if (!email && !name) return null;

  if (email) {
    const [hit] = await query("SELECT id, name FROM donors WHERE org_id=? AND email ILIKE ? AND deleted_at IS NULL LIMIT 1", [orgId, email]);
    if (hit) return hit;
  }
  // Serialized per (org, email) for the same reason the Stripe webhook is:
  // two parallel syncs seeing the same new donor must not both insert.
  return await withAdvisoryLock(`donor:${orgId}:${email || name.toLowerCase()}`, async () => {
    if (email) {
      const [again] = await query("SELECT id, name FROM donors WHERE org_id=? AND email ILIKE ? AND deleted_at IS NULL LIMIT 1", [orgId, email]);
      if (again) return again;
    }
    // CONNECT-2 · EMAIL, THEN NAME. A row with no email (Zeffy and Square
    // often send none), or with an email nobody on file has, lands on THE one
    // person of that exact name when that person has no email of their own
    // to disagree with. One record per person: before this, every such gift
    // made a second Harriet Lowe for somebody to merge by hand. Two people of
    // that name, or one with a different email, is not a match, and falls
    // through to the collision below.
    if (name) {
      const same = await query(
        `SELECT id, name, email FROM donors
          WHERE org_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?)) LIMIT 2`, [orgId, name]);
      if (same.length === 1 && !String(same[0].email || "").trim()) return { id: same[0].id, name: same[0].name };
    }
    // THE COLLISION. Somebody of this name is already on file under a
    // different (or no) email. Steward does NOT merge them - a guessed merge
    // is a lost donor, and two people do share a name. The gift lands on a new
    // record and the pair is reported: it is already a one-tap merge in
    // Donors -> duplicates (the "Same name" tier), and the run summary says
    // how many so nobody has to go looking for it.
    if (name) {
      const [clash] = await query(
        `SELECT id, name, email FROM donors
          WHERE org_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?))
            AND (email IS NULL OR email='' OR NOT (email ILIKE ?)) LIMIT 1`,
        [orgId, name, email || " never"]);
      if (clash) summary.nameCollisions.push({ name, existingDonorId: clash.id, existingEmail: clash.email || null });
    }
    const id = newId("d");
    await run(
      `INSERT INTO donors (id, org_id, name, email, status, stage, total_giving, gift_count, created_by, created_by_name)
       VALUES (?,?,?,?,'active','steward',0,0,?,?)`,
      [id, orgId, name || email, email || null, actorId, actorName]);
    summary.donorsCreated++;
    return { id, name: name || email };
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 244

// THE RUN LANDS ON THE IMPORTS PAGE, beside the file imports, because from
// where she sits they are the same thing: money arriving with a receipt saying
// where it came from and what it did. shape='source' so the page can tell them
// apart without a second table.
async function recordSourceRun(orgId, source, summary, { actorId, actorName, day }) {
  const { providerLabel } = await givingSourcesMod();
  const id = newId("imp");
  const setAside = summary.failedSkipped + summary.refundsSkipped +
    Object.values(summary.dropped || {}).reduce((a, b) => a + b, 0);
  await run(
    `INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,committed_at,
                          rows_in,gifts_created,donors_created,donors_merged,rows_set_aside,rows_errored,
                          dollars_in,dollars_created,actor_user_id,actor_user_name,summary_json)
     VALUES (?,?,?,?,'source',NOW(),NOW(),?,?,?,0,?,0,?,?,?,?,?)`,
    [id, orgId, `${providerLabel(source.provider)} - checked ${day}`, null,
     summary.rowsRead, summary.giftsCreated, summary.donorsCreated, setAside,
     summary.centsCreated / 100, summary.centsCreated / 100,
     actorId, actorName, JSON.stringify(summary)]);
  require("../../routes/dataHealth").afterImport(orgId, id);   // CLEAN-1: Data health runs after every import
  return id;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 245

// An error a human can act on. Never a code, never a stack, and never
// "something went wrong" - she needs to know whether to wait, to re-paste a
// key, or to call somebody.
//
// BUILD-92 A2 — AUTHENTICATION AND PERMISSION ARE DIFFERENT PROBLEMS.
// Found 20 September: Jonathan connected his own PayPal, the token step
// answered 401 `invalid_client`, and the screen said "Steward could not finish
// reading this source. The next check will try again." — which is the sentence
// for a blip. He was told to wait for something that was never going to happen.
//
// The cause was that this function tested `/401|403|unauthor|invalid_client|
// permission/` against the MESSAGE ONLY, and the message was "PayPal refused
// the credentials: Client Authentication failed", which contains none of those
// tokens. `e.status` was 401 and sitting right there unused.
//
// So the STEP is now declared by the adapter at the moment it knows it
// (sources/*.js attach `step: "auth" | "permission" | "read"`), because the
// adapter is the only place that knows whether a call was the token step or
// the reporting call. Prose matching survives as the FALLBACK for errors
// Steward does not control — but it can no longer be the thing that decides.
//
// `classifySourceError` is exported to the suite so the split can be tested
// without a provider.
function classifySourceError(e) {
  const code = e?.code || "";
  const status = Number(e?.status) || null;
  const msg = String(e?.message || "");
  const providerCode = e?.providerCode || e?.stripeCode || null;
  if (code) return { kind: code, status, providerCode };
  // 1. What the adapter declared. Always believed over prose.
  if (e?.step === "auth") return { kind: "auth", status, providerCode };
  if (e?.step === "permission") return { kind: "permission", status, providerCode };
  // 2. Then the status, which is a fact even when the prose is not.
  if (status === 401) return { kind: "auth", status, providerCode };
  if (status === 403) return { kind: "permission", status, providerCode };
  if (status === 429) return { kind: "rate", status, providerCode };
  // 3. Prose last, for anything thrown by code Steward does not own.
  if (/invalid_client|client authentication failed|refused the credentials|unauthoriz|invalid api key|invalid key/i.test(msg))
    return { kind: "auth", status, providerCode };
  if (/permission|forbidden|not allowed|insufficient/i.test(msg))
    return { kind: "permission", status, providerCode };
  if (/429|rate limit/i.test(msg)) return { kind: "rate", status, providerCode };
  if (/timeout|abort|ENOTFOUND|ECONN/i.test(msg)) return { kind: "unreachable", status, providerCode };
  return { kind: "unknown", status, providerCode };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 248

function sourceErrorSentence(e, source) {
  const provider = source?.provider || "";
  const { kind } = classifySourceError(e);
  if (kind === "CREDENTIAL_KEY_MISSING") return "Steward cannot open the stored credentials for this source. Nothing was read and nothing was changed, and this needs an administrator.";
  if (kind === "SEALED_OPEN_FAILED") return "The saved key for this source could not be read. Disconnect it and connect it again with a fresh key.";
  if (kind === "NO_ADAPTER") return `Steward does not read ${source?.display_name || provider} automatically yet.`;
  if (kind === "PROVIDER_WRITE_REFUSED") return "Steward stopped a request that was not a read. Nothing was sent. This is a bug in Steward, not a problem with your account.";
  if (kind === "auth") {
    return SOURCE_AUTH_SENTENCE[provider]
      || "The key for this source was refused. Check it is still active in the provider's settings, then paste it again.";
  }
  if (kind === "permission") {
    return SOURCE_PERMISSION_SENTENCE[provider]
      || "The provider accepted this key but has not allowed it to read yet. Check the key's permissions in the provider's settings.";
  }
  if (kind === "rate") return "The provider asked Steward to slow down. The next check will pick up where this one stopped.";
  if (kind === "unreachable") return "Steward could not reach the provider. The next check will try again.";
  return "Steward could not finish reading this source. The next check will try again.";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 250

async function queueThankYouDraft(orgId, { giftId, donorId, cents, fundId = null, type = "cash", reason = "gift", force = false, replace = false, tribute = null }) {
  const [d] = await query(
    `SELECT id, name, kind, salutation, spouse_name, deceased, do_not_contact, is_sample FROM donors
      WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return null;
  if (d.is_sample) return null;
  if (d.deceased || d.do_not_contact) return null;
  if (d.kind === "anonymous") return null;
  if (!force && /pledge payment/i.test(String(type)) && (cents || 0) < THANK_YOU_PLEDGE_FLOOR_CENTS) return null;

  // FIX-45: the reads below do not depend on each other, so they go together:
  // a person is often waiting on this draft (To confirm shows it at once).
  const [[org], fundRows, [hist], thisGiftRows] = await Promise.all([
    query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]),
    fundId ? query("SELECT name, public_name FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]) : [],
    query(
      `SELECT COUNT(*)::int AS before,
              MAX(date) FILTER (WHERE date IS NOT NULL) AS last_date
         FROM gifts WHERE org_id=? AND donor_id=? AND id <> ? AND amount > 0`,
      [orgId, donorId, giftId || ""]),
    giftId ? query("SELECT date, recurring_subscription_id, campaign FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]) : [],
  ]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const [fund] = fundRows;
  // POLISH-2: a donor reads the fund's public name, or "where it's needed
  // most" for the org's general fund. Never the bookkeeping name of that one.
  const fundPublic = fund && String(fund.public_name || "").trim() || null;
  // The general fund is the org's oldest unrestricted fund, the same probe
  // ensureOrgLedger reads, but READ ONLY: drafting a letter never heals a
  // ledger or creates a fund (connect2-sources caught the healing version).
  const [gen] = fund && !fundPublic
    ? await query("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]) : [];
  const generalFund = !!gen && gen.id === fundId;
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  // ── FIX-6 follow-up 8 · THE FACTS THE DRAFT MAY REST ON ─────────────────
  // Read here and passed in, because shared/draftNote.js invents nothing: a
  // fact it is not given is a fact the letter does not mention. This is the
  // whole difference between three identical thank-yous and three that sound
  // like somebody looked at the record, and it needs no AI at all.
  //
  // `giftId` is EXCLUDED from the history (read above) so the gift being
  // thanked for is not counted as one that came before it.
  const [thisGift] = thisGiftRows;
  const monthsSince = hist && hist.last_date && thisGift && thisGift.date
    ? Math.max(0, Math.round((new Date(thisGift.date) - new Date(hist.last_date)) / (1000 * 60 * 60 * 24 * 30.44)))
    : null;
  const facts = {
    giftCountBefore: hist ? Number(hist.before) : null,
    isFirstGift: hist ? Number(hist.before) === 0 : null,
    isRecurring: thisGift ? !!thisGift.recurring_subscription_id : null,
    monthsSinceLastGift: monthsSince,
    campaignName: (thisGift && thisGift.campaign) || null,
    // CHECK-2: the tribute the gift carries ("in memory of Walter"), said gently.
    tribute: tribute && tribute.type && tribute.name ? { type: tribute.type, name: tribute.name } : null,
  };
  // FIX-45: the greeting reads the record's salutation or both names on it.
  const person = { salutation: d.salutation, spouseName: d.spouse_name, kind: d.kind };
  const draft = reason === "pledge_completed"
    ? (() => { const t = draftMod.thankYouDraft({ donorName: d.name, giftCents: cents, fundName: fundPublic || fund?.name || null, generalFund, orgName: org?.name, voice, person, date: thisGift?.date || null });
               return { ...t, body: t.body.replace("Thank you for your gift of", "Thank you for finishing your pledge of") }; })()
    : draftMod.thankYouDraft({ donorName: d.name, giftCents: cents, fundName: fundPublic || fund?.name || null, generalFund, orgName: org?.name, voice, person, date: thisGift?.date || null, ...facts });
  // ONE DRAFT PER GIFT. `replace` is for the one case where Steward has a
  // better thing to say about a gift it has already drafted (a final pledge
  // payment that COMPLETED the pledge) — and it never overwrites a letter she
  // has already sent or deliberately skipped.
  const conflict = replace
    ? `ON CONFLICT (org_id, gift_id) DO UPDATE SET body=EXCLUDED.body, voice=EXCLUDED.voice
        WHERE thank_you_drafts.sent_at IS NULL AND thank_you_drafts.skipped_at IS NULL`
    : "ON CONFLICT (org_id, gift_id) DO NOTHING";
  const rows = await query(
    `INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice)
     VALUES (?,?,?,?,?,?) ${conflict} RETURNING id`,
    [newId("ty"), orgId, donorId, giftId, draft.body, draft.voice]);
  return rows[0] ? { id: rows[0].id, voice: draft.voice } : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 251

// ── BUILD-88b B.2 — THIRTY DAYS PAST DUE ──────────────────────────────────
// An instalment thirty days past due with no payment opens EXACTLY ONE thread
// on the donor, with the step "Pledge instalment reminder" and a note already
// written in her voice. The thirty days is the point: a fortnight is the post,
// and chasing a donor who has already said yes is how a yes becomes a last gift.
//
// FOUR THINGS THIS DOES NOT DO, each for a reason:
//   · it never opens a SECOND thread on a donor who already has one open (the
//     `threads_one_open` index makes that structural, not a check);
//   · it never touches a deceased or do-not-contact donor;
//   · a SHELL pledge (BUILD-88a A.7, inferred from payments) has no schedule
//     and NEVER goes late — it is unfinished, not overdue, and it says which
//     part is missing;
//   · it sends nothing. The draft waits on the thread.
async function processPledgeInstallmentReminders(opts = {}) {
  const out = { opened: 0, skipped: 0, orgs: 0, rows: [] };
  const orgs = opts.orgId
    ? await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE id=?", [opts.orgId])
    : await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE onboarding_complete=1", []);
  const draftMod = await import("../../shared/draftNote.js");
  for (const org of orgs) {
    out.orgs++;
    const today = opts.today || orgToday(org);                    // ORG_TZ_SEAM_OK
    const cutoff = orgTime.addDays(today, -draftMod.PLEDGE_LATE_DAYS);
    const late = await query(
      `SELECT i.id, i.pledge_id, i.due_date, i.amount, p.donor_id, p.amount AS pledge_amount,
              d.name AS donor_name, d.salutation AS donor_salutation, d.spouse_name AS donor_spouse, d.kind AS donor_kind,
              d.assigned_to, d.assigned_to_name,
              COALESCE(${require("../../shared/numbers/pledges").PAID_OF("p")}, 0) AS paid
         FROM pledge_installments i
         JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE i.org_id = ? AND i.paid_gift_id IS NULL AND i.due_date <= ?
          AND i.reminder_thread_id IS NULL
          AND p.status = 'open' AND COALESCE(p.is_shell,false) = false AND COALESCE(p.is_match,false) = false
          -- SEND-GATE-1: an import fires no reminder for what was already due when it landed
          AND (p.import_id IS NULL OR i.due_date > to_char(p.created_at, 'YYYY-MM-DD'))
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
          AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE
          AND d.do_not_solicit IS NOT TRUE
          AND (d.kind IS NULL OR d.kind = 'person')
        ORDER BY i.due_date ASC`,
      [org.id, cutoff]);
    const samples = Array.isArray(org.voice_samples) ? org.voice_samples
      : (typeof org.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
    const voice = draftMod.voiceFrom(samples);
    const seenDonor = new Set();
    for (const i of late) {
      // ONE per donor per sweep, before the database is even asked: two late
      // instalments on one pledge are one conversation.
      if (seenDonor.has(i.donor_id)) { out.skipped++; continue; }
      seenDonor.add(i.donor_id);
      const instCents = money.toCents(i.amount) ?? 0;
      const draft = draftMod.pledgeReminderDraft({
        donorName: i.donor_name, installmentCents: instCents, dueDate: i.due_date,
        pledgeCents: money.toCents(i.pledge_amount) ?? null, paidCents: money.toCents(i.paid) ?? 0,
        orgName: org.name, voice, person: { salutation: i.donor_salutation, spouseName: i.donor_spouse, kind: i.donor_kind },
      });
      const thread = await withTransaction(client => openThreadTx(client, {
        orgId: org.id, donorId: i.donor_id,
        step: { type: draftMod.PLEDGE_REMINDER_STEP.type, label: draftMod.PLEDGE_REMINDER_STEP.label, due: today },
        openedOn: today, ownerId: i.assigned_to || null, ownerName: i.assigned_to_name || null,
        actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
      }));
      if (!thread) { out.skipped++; continue; }   // a thread is already open on this donor
      await run("UPDATE threads SET draft_note=? WHERE id=?", [draft.body, thread.id]);
      await run("UPDATE pledge_installments SET reminder_thread_id=? WHERE id=? AND org_id=?", [thread.id, i.id, org.id]);
      out.opened++;
      out.rows.push({ orgId: org.id, donorId: i.donor_id, installmentId: i.id, threadId: thread.id, dueDate: i.due_date });
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 259

// ── BUILD-88b B.2 — A FULLY PAID PLEDGE CLOSES ITSELF ─────────────────────
// `recalcPledgePayment` already decides fulfilment from the payment total (the
// BUILD-72 rule: status is DERIVED, never an independent flag). This is what
// happens next: the donor finished what they promised, which is the single best
// moment to say thank you, and nobody was telling her.
async function onPledgeSettled(orgId, pledgeId) {
  const [p] = await query("SELECT id, donor_id, amount, status FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!p || p.status !== "fulfilled") return null;
  // Its open instalments close with it: a pledge that is paid cannot be late.
  await run(`UPDATE pledge_installments SET paid_at=COALESCE(paid_at, NOW())
              WHERE org_id=? AND pledge_id=? AND paid_gift_id IS NULL
                AND EXISTS (SELECT 1 FROM pledges q WHERE q.id=? AND q.status='fulfilled')`,
    [orgId, pledgeId, pledgeId]);
  const [last] = await query(
    "SELECT id FROM gifts WHERE org_id=? AND pledge_id=? ORDER BY date DESC NULLS LAST, id DESC LIMIT 1", [orgId, pledgeId]);
  if (!last) return null;
  // ONE DRAFT PER GIFT is the queue's rule, so this does not add a second
  // letter — it REPLACES the one the final payment already earned with the
  // better thing to say. She sends one letter, and it is about the promise
  // they finished rather than the last instalment of it.
  const upgraded = await queueThankYouDraft(orgId, { giftId: last.id, donorId: p.donor_id,
    cents: money.toCents(p.amount) ?? 0, fundId: null, type: "pledge completed",
    reason: "pledge_completed", force: true, replace: true }).catch(() => null);
  return { pledgeId, closed: true, thankYou: upgraded?.id || null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 261
// DEVBOARD-1: /ops reads the same object in-process, so the page and /health never differ.
function healthBody() {
  // billing.ok is the cached mode-consistency result (booleans/mode only — no
  // secrets): true = all configured prices resolve under the billing key's mode,
  // false = a test/live mismatch (loud warning already logged), null = not yet
  // checked or nothing to check. Full detail is at /admin/billing-diagnostic.
  // publicUrl: the resolved base every outbound email link uses (non-secret).
  // fromEnv:false means FRONTEND_URL is unset or was rejected as a deployment
  // host and links are riding the canonical fallback — post-deploy this is the
  // one-glance check that reset/invite links carry stewardapp.dev.
  const pu = resolvePublicAppUrl();
  return {
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
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 263
async function statusCheckOnce() {
  const results = [];
  const put = (service, state, detail) => results.push({ service, state, detail: detail || null });
  try { await query(`SELECT 1`); put("app", "up"); } catch (e) { put("app", "down", "The database did not answer."); }
  try {
    await query(`SELECT id FROM users LIMIT 1`);
    const jwt = require("jsonwebtoken");
    const t = signToken({ userId: "status-probe", orgId: "status-probe" });
    jwt.verify(t, process.env.JWT_SECRET || "nonprofit_erp_secret_dev");
    put("signin", "up");
  } catch (e) { put("signin", "down", "Sign-in could not complete its own check."); }
  {
    const r = reconciliationHealth();
    const interval = Number(process.env.RECONCILE_INTERVAL_MIN || 60);
    if (!r.checkedAt) put("stripe", "unknown", "Not checked since the last restart.");
    else if (Date.now() - new Date(r.checkedAt).getTime() > 3 * interval * 60000) put("stripe", "degraded", "The reconciliation guard is overdue.");
    else if ((r.unrecordedCharges || 0) > 0) put("stripe", "degraded", "A charge reached Stripe without a gift; it is being looked at.");
    else put("stripe", "up");
  }
  const lastTick = async name => (await query(`SELECT ok, COALESCE(finished_at, started_at) AS at FROM tick_log WHERE name=? ORDER BY started_at DESC LIMIT 1`, [name]).catch(() => []))[0] || null;
  {
    const t = await lastTick("processGivingSources");
    if (!t) put("connections", "unknown", "No sync has run since the last restart.");
    else if (t.ok === false) put("connections", "degraded", "The latest sync stopped with an error.");
    // The giving-source sync runs every SIX hours (routes/jobs.js), so it is
    // overdue only past two of its own intervals. Three hours read every
    // healthy deploy as degraded on the public page (found on prod, TRUST-2).
    else if (Date.now() - new Date(t.at).getTime() > 13 * 3600e3) put("connections", "degraded", "The sync is overdue.");
    else put("connections", "up");
  }
  {
    if (!process.env.RESEND_API_KEY) put("email", "down", "Email is not configured.");
    else {
      const [f] = await query(`SELECT COUNT(*)::int AS n FROM notification_failures WHERE created_at > NOW() - INTERVAL '1 hour'`).catch(() => [{ n: 0 }]);
      put("email", f.n > 5 ? "degraded" : "up", f.n > 5 ? `${f.n} notifications are waiting to retry.` : null);
    }
  }
  {
    const rows = await query(`SELECT DISTINCT ON (name) name, ok, started_at, finished_at FROM tick_log
                               WHERE started_at > NOW() - INTERVAL '2 hours' ORDER BY name, started_at DESC`).catch(() => []);
    if (!rows.length) put("jobs", "unknown", "No scheduled job has run in the last two hours.");
    else {
      const bad = rows.filter(r => r.ok === false);
      put("jobs", bad.length ? "degraded" : "up", bad.length ? `${bad.length} job${bad.length === 1 ? "" : "s"} stopped with an error.` : null);
    }
  }
  for (const r of results) await run(`INSERT INTO status_checks (service,state,detail) VALUES (?,?,?)`, [r.service, r.state, r.detail]).catch(() => {});
  await run(`DELETE FROM status_checks WHERE checked_at < NOW() - INTERVAL '95 days'`).catch(() => {});
  return results;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 272
async function dpaViewer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer ")) return false;
  try {
    const p = require("jsonwebtoken").verify(h.slice(7), process.env.JWT_SECRET || "nonprofit_erp_secret_dev");
    const [u] = await query(`SELECT is_super_admin FROM users WHERE id=?`, [p.userId]);
    return !!(u && u.is_super_admin);
  } catch { return false; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 281
function _titleCaseWord(w) {
  if (_ROMAN_SUFFIX.test(w)) return w.toUpperCase();               // III, IV, VIII…
  return w.toLowerCase().replace(/(^|[’'\-.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}
// SPLIT-2 end
// SPLIT-2 server.js piece 282

// Display-name casing for EMAIL headers/subjects (BUILD-35 Part 2). The
// conservative HALF of normalizeName: re-case ONLY a wholly-lower/upper string
// ("atkinson" → "Atkinson", "jon" → "Jon"); any internal mixed case means a
// human already cased it ("CREO Arts", "McKinney") and is preserved verbatim.
// Deliberately NO "Last, First" flip — this is for org/user display strings,
// not imported donor rows. Applied where org/user names enter outbound email
// (branded header, digest subjects/headings, invites) so raw signup casing
// never renders in a big green band.
function displayNameCase(raw) {
  if (raw == null) return raw;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return s;
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const allUpper = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (allUpper || allLower) return s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*/g, w => _titleCaseWord(w));
  return s;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 283

// ── Donor summary recalculation ────────────────────────────────────────────
// Recomputes total_giving, gift_count, last_gift_date, last_gift_amount
// from the gifts table (source of truth). Replace delta adjustments on
// edit/delete with this — it's correct even after complex edits.
// Note: amounts stored as INTEGER (whole dollars, no cents). If sub-dollar
// precision is ever needed, gifts.amount and donors.total_giving would need
// a schema migration to NUMERIC.
// Tenant-isolation guard (SECURITY §1): confirms a client-supplied foreign-key
// id belongs to the caller's org BEFORE it's stored or joined. Closes the
// cross-tenant IDOR class where a foreign account/fund/etc. id supplied in a
// request body is accepted and its label echoed back (or planted into the
// caller's own ledger). `table` is always an internal constant, never user
// input, so the interpolation is safe. A null/blank id is allowed (these
// columns are nullable) and passes.
async function orgOwns(table, id, orgId) {
  if (id === undefined || id === null || id === "") return true;
  const rows = await query(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`, [id, orgId]);
  return rows.length > 0;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 284

// ── One plan, everything included (FIX-32) ──────────────────────────────
// There used to be a Core tier and a Team tier, and `orgPlanTier` decided
// which surfaces opened. GTM-1a made every price the same product, priced only
// on how many donors you work, but the gate stayed: an org whose subscription
// ended was rewritten to plan='core' and found its donor profile frosted over
// with "Unlock with Team". There is one plan now, so every CRM org is the full
// product whatever it pays and whatever its subscription is doing. Access to
// WRITE is decided by `checkWriteAccess` (billing state), never by a tier.
//
// The value "team" is kept as the name of "the full CRM" because the officer
// scoping below (portfolios, digests) reads it; it is no longer a price.
// BUILD-46: the network Portal tier is a different product, not the CRM, and
// stays its own tier.
function orgPlanTier(org) {
  if (org && org.plan === "portal") return "portal";
  return "team";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 285
// The one plan check left: a Portal-tier org has no CRM. Every other org has
// every route. (Was requireCrm, which 403'd a Core org.)
async function requireCrm(req, res, next) {
  try {
    const rows = await query("SELECT plan FROM orgs WHERE id=?", [req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: "Org not found" });
    if (orgPlanTier(rows[0]) === "portal") {
      return res.status(403).json({ error: "crm_not_included", message: "The donor network plan does not include the CRM." });
    }
  } catch (e) { console.error("requireCrm error:", e); return res.status(500).json({ error: "server_error" }); }
  next();
}
// SPLIT-2 end
// SPLIT-2 server.js piece 291

// Insert one move row (system of record for the pipeline). Description is
// required and validated at the route; this just writes.
async function recordMove(orgId, donorId, officerId, officerName, fromStage, toStage, description) {
  const id = newId("mv");
  await run(
    "INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description) VALUES (?,?,?,?,?,?,?,?)",
    [id, orgId, donorId, officerId || null, officerName || "", fromStage || null, toStage, description]);
  // THREAD-2a — the stage_change journey trigger. EVERY stage move goes
  // through this function (a human one from the pipeline, an automatic
  // lapse), so this is the one place the trigger can fire from and be sure it
  // fires exactly once. A move that did not change the stage is not a change.
  if (toStage && String(toStage) !== String(fromStage || "")) {
    maybeStartJourneyFromServer(orgId, donorId, "stage_change", { fromStage, toStage })
      .then(() => (String(toStage) === "prospect"
        // PARITY-1 Part D — becoming a prospect is its own trigger.
        ? maybeStartJourneyFromServer(orgId, donorId, "became_prospect", { fromStage, toStage }) : null))
      .catch(e => console.error("[journey] stage trigger:", e.message));
  }
  return id;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 295

// Log an auto-move: a moves row (transparent history) + a stage_change
// interaction (donor timeline), never a silent stage change.
async function recordAutoMove(orgId, donorId, fromStage, toStage, description) {
  await recordMove(orgId, donorId, null, AUTO_MOVE_OFFICER, fromStage, toStage, description);
  try {
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name) VALUES (?,?,?,?,?,?,?)",
      [newId("int"), orgId, donorId, "stage_change",
       `Moved ${fromStage || "Not set"} → ${toStage}: ${description}`,
       orgToday(await orgTz(orgId)), AUTO_MOVE_OFFICER]);   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  } catch (e) { console.error("[smart-move] interaction log:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 296

// Auto-lapse sweep for ONE org. Automatic (no suggestion) — Lapsed is a fact.
// Guards make it safe: only donors with PRIOR GIVING (a no-gift prospect is a
// prospect, not lapsed); never a donor being actively solicited (stage
// 'solicit') or with an OPEN ASK (mid-cultivation); and never one an officer
// has deliberately placed forward SINCE their last gift (officer override
// wins). Returns the count moved. Editable afterward regardless.
async function autoLapseOrg(orgId) {
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK (FIX-49: the org's day, not the server's)
  // POLISH-4: lapsed by the one rule (shared/numbers/lapse.js): a pledge, or
  // a gift from someone in their giving unit, holds them.
  const lapsedNow = require("../../shared/numbers/lapse").lapsedSql("d.last_gift_date", today, "d.id");
  const rows = await query(
    `SELECT d.id, d.stage, d.last_gift_date FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL
        AND d.imported_sustainer IS NOT TRUE
        AND d.gift_count > 0
        AND d.last_gift_date IS NOT NULL AND d.last_gift_date <> ''
        AND ${lapsedNow.sql}
        AND d.stage NOT IN ('lapsed','solicit')
        AND NOT EXISTS (SELECT 1 FROM opportunities o
                          WHERE o.org_id=d.org_id AND o.donor_id=d.id AND o.status='open')
        AND NOT EXISTS (SELECT 1 FROM moves m
                          WHERE m.org_id=d.org_id AND m.donor_id=d.id
                            AND m.officer_id IS NOT NULL AND m.to_stage <> 'lapsed'
                            AND m.created_at::date > d.last_gift_date::date)
      LIMIT 200`,
    [orgId, ...lapsedNow.args]);
  let moved = 0;
  const months = Math.round(LAPSE_DAYS / 30);
  for (const d of rows) {
    // Guard on stage again in the UPDATE so a human move landing between the
    // SELECT and here isn't clobbered.
    const upd = await query(
      "UPDATE donors SET stage='lapsed', updated_at=NOW() WHERE id=? AND org_id=? AND stage=? RETURNING id",
      [d.id, orgId, d.stage]);
    if (!upd.length) continue;
    await recordAutoMove(orgId, d.id, d.stage, "lapsed", `Auto: lapsed: no gift in the last ${months} months`);
    moved++;
  }
  await unlapseHeldByPledge(orgId);
  return moved;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 297

// FIX-60 · A PLEDGE UN-LAPSES. Somebody placed in Lapsed automatically who has
// since pledged (an open pledge, or one made in the last 12 months: lapseRule.js
// pledgeHold) is back to Stewardship, logged as an automatic move, exactly as
// a gift does (autoUnlapseOnGift). Only automatic lapses are undone: a person
// an officer moved to Lapsed by hand stays there. `ids` narrows it to the
// people one write touched (the after-change step); with none, the whole org.
async function unlapseHeldByPledge(orgId, ids = null) {
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  // POLISH-4: the people linked to the ones this write touched are in their giving unit.
  if (ids && ids.length) {
    const linked = await query(`SELECT donor_id_a, donor_id_b FROM donor_relationships WHERE org_id=? AND (donor_id_a = ANY(?) OR donor_id_b = ANY(?))
        AND relationship_type = ANY(?)`, [orgId, ids, ids, [...require("../../shared/numbers/lapse").UNIT_LINK_TYPES]]);
    ids = [...new Set([...ids, ...linked.flatMap(r => [r.donor_id_a, r.donor_id_b])])];
  }
  const hold = require("../../shared/numbers/lapse").holdSql("d.id", today);
  const rows = await query(
    `SELECT d.id FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.stage='lapsed'${ids ? " AND d.id = ANY(?)" : ""}
        AND ${hold.sql}
        AND NOT EXISTS (SELECT 1 FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id
                          AND m.officer_id IS NOT NULL AND m.to_stage='lapsed')
      LIMIT 200`,
    [orgId, ...(ids ? [ids] : []), ...hold.args]);
  // POLISH-4: and somebody Steward placed in Lapsed whose giving unit (the
  // business they own or work at, or its owner) has since given.
  // LEDGER-2: "Steward placed" is anyone an officer did not: an import or a
  // merge writes the stage with no move, and asking for an automatic move kept
  // them Lapsed beside a business that gave today.
  const lapsedNow = require("../../shared/numbers/lapse").lapsedSql("d.last_gift_date", today, "d.id");
  const unitRows = await query(
    `SELECT d.id FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.stage='lapsed'${ids ? " AND d.id = ANY(?)" : ""}
        AND NOT ${hold.sql} AND NOT ${lapsedNow.sql}
        AND (${require("../../shared/numbers/lapse").linkedLastSql("d.id")}) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id
                          AND m.officer_id IS NOT NULL AND m.to_stage='lapsed')
      LIMIT 200`,
    [orgId, ...(ids ? [ids] : []), ...hold.args, ...lapsedNow.args]);
  let moved = 0;
  for (const [d, why] of [...rows.map(r => [r, "Auto: they made a pledge"]), ...unitRows.map(r => [r, "Auto: someone they give with gave"])]) {
    const upd = await query("UPDATE donors SET stage='steward', updated_at=NOW() WHERE id=? AND org_id=? AND stage='lapsed' RETURNING id", [d.id, orgId]);
    if (!upd.length) continue;
    await recordAutoMove(orgId, d.id, "lapsed", "steward", why);
    moved++;
  }
  return moved;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 298

async function recalcDonorSummary(donorId, orgId) {
  // NUMBERS-1: the one statement (donorSummary.js). It counts gifts above zero
  // and breaks a same-day tie the way the profile's Last gift does.
  await run(DONOR_SUMMARY_UPDATE("AND d.id = $2"), [orgId, donorId]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 299

// ── The audit log helper the hand-placed calls still use ───────────────────
// FIX-11 Part 1 — it no longer inserts a row while a request is in flight.
// The middleware above (mounted before every router) is already writing one
// for that request, and a second insert is how one action came to appear
// twice. So inside a request this ENRICHES: the hand-written action name
// ("api_key_created", "oauth_tenant_chosen") replaces the one derived from the
// route pattern, and whatever the caller passed as `changes` rides along with
// the before/after the middleware read off the row.
//
// Outside a request there is nothing to enrich, which is the case for a
// background sweep, and then it inserts exactly as it always did. That is the
// seam the periodic jobs use: a sweep that writes data says so here.
async function writeAuditLog(orgId, userId, userName, action, entityType, entityId, changes) {
  try {
    const M = require("../../middleware/auditTrail");
    if (M.enrichFromLegacyCall(orgId, userId, userName, action, entityType, entityId, changes)) return;
    await M.insertAuditRow({
      orgId, actorId: userId, actorName: userName,
      actorKind: String(userId || "").startsWith("system:") ? "system" : (userId ? "user" : "system"),
      action: String(action || "changed").replace(/_/g, " "),
      entityType: String(entityType || "record").replace(/_/g, " "),
      entityId: entityId === undefined ? null : entityId,
      entityLabel: null, changes: changes || {}, before: null, after: null,
      summary: null, recordCount: null, method: null, path: null, status: null, ip: null,
    });
  } catch(e) { console.error("Audit log write:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 302
async function mfaVerifyForUser(user, code) {
  if (!user.mfa_secret_sealed) return null;
  const { open } = await import("../../shared/secretBox.js");
  let secret;
  try { secret = open(user.mfa_secret_sealed, { aad: "mfa:" + user.org_id + ":" + user.id }); }
  catch (e) { console.error("[mfa] could not open the sealed secret for", user.id, e.message); return null; }
  const ctr = TOTP.verify(secret, code, { lastCounter: user.mfa_last_counter == null ? -1 : Number(user.mfa_last_counter) });
  if (ctr === null) return null;
  // Single use: a code accepted once is dead, by the counter, atomically.
  const r = await query(`UPDATE users SET mfa_last_counter=? WHERE id=? AND (mfa_last_counter IS NULL OR mfa_last_counter < ?) RETURNING id`, [ctr, user.id, ctr]);
  return r.length ? ctr : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 304

// Display name for a pending invitee (no users row yet) — derived from the
// invite email's local-part ("jonathan.atkinson@x" → "Jonathan Atkinson") so the
// officer-mapping UI can collapse "jonathan"/"Jonathan Atkinson"/"jonathan@x"
// spellings onto ONE person, and the Directory can show "· pending" with a real
// name. Falls back to the raw email if the local-part is empty.
function inviteeDisplayName(email) {
  const local = String(email || "").split("@")[0] || "";
  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(email || "").trim() || null;
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
// SPLIT-2 end
// SPLIT-2 server.js piece 305
// Money here is dollars-and-cents, so every accumulation rounds to 2dp rather
// than letting binary floating point drift the equation off by 1e-13 and abort
// a perfectly good import.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// SPLIT-2 end
// SPLIT-2 server.js piece 308

// ── Gifts ──────────────────────────────────────────────────────────────────
// §1.2 F-5 — the ONE pledge-payment reconciler. Paid = Σ gifts linked by
// gifts.pledge_id (derived, never a stored counter — race-safe: two parallel
// payments both recompute and converge on the same SUM). Fulfills only when
// paid ≥ pledge amount; a partial payment leaves the pledge OPEN with an
// honest remaining balance. Reopens a fulfilled pledge whose payments fell
// back below the amount (gift deleted/refunded/shrunk). Canceled pledges are
// never resurrected. Returns {paid, balance} or null.
// BUILD-72 Part 3 — pledge status is DERIVED, never an independent flag.
//   applied_total <  amount  → partially_fulfilled (open), remaining shown
//   applied_total == amount  → fulfilled
//   applied_total >  amount  → fulfilled, and the SURPLUS is recorded and
//                              flagged rather than swallowed. A donor who
//                              overpays a pledge is a good problem, and the
//                              money must still appear.
// `pledges.status` remains a column because reminder cadence, reporting and
// `written_off` all read it — but it is now RECOMPUTED FROM THE PAYMENT TOTAL
// on every write that can move it, and `pledgeStatusFor` is the only thing that
// decides it. Nothing may set it independently (see PUT /pledges/:id).
function pledgeStatusFor(paid, amount, currentStatus) {
  // A cancelled / written-off pledge is never resurrected by arithmetic.
  if (currentStatus === "written_off" || currentStatus === "cancelled") return currentStatus;
  if (amount > 0 && paid >= amount) return "fulfilled";
  return "open";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 309
// `partially_fulfilled` is a DISPLAY state, not a stored one: storing it would
// give the drift a second place to hide. Anything reading a pledge derives it.
function pledgeDisplayStatus(paid, amount, storedStatus) {
  if (storedStatus === "written_off" || storedStatus === "cancelled") return storedStatus;
  if (amount > 0 && paid >= amount) return "fulfilled";
  if (paid > 0) return "partially_fulfilled";
  return "open";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 310

async function recalcPledgePayment(pledgeId, orgId) {
  const rows = await query("SELECT * FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!rows.length) return null;
  const p = rows[0];
  const paidRows = await query(
    `SELECT COALESCE(SUM(g.amount),0) AS paid FROM gifts g WHERE g.pledge_id=? AND g.org_id=? AND ${require("../../shared/numbers/money").MONEY("g")}`,   // NUMBERS-4: money pays a pledge
    [pledgeId, orgId]);
  const paid = round2(parseFloat(paidRows[0].paid) || 0);
  const amount = round2(parseFloat(p.amount) || 0);
  const status = pledgeStatusFor(paid, amount, p.status);
  const surplus = round2(Math.max(0, paid - amount));

  if (status === "fulfilled") {
    const lastGift = await query(
      "SELECT id FROM gifts WHERE pledge_id=? AND org_id=? ORDER BY date DESC NULLS LAST, id DESC LIMIT 1",
      [pledgeId, orgId]);
    await run(
      `UPDATE pledges SET status='fulfilled', fulfilled_gift_id=?, fulfilled_at=COALESCE(fulfilled_at, NOW()),
              next_reminder_at=NULL, surplus_amount=?, updated_at=NOW()
       WHERE id=? AND org_id=? AND status IN ('open','fulfilled')`,
      [lastGift[0]?.id || null, surplus, pledgeId, orgId]);
  } else {
    await run(
      `UPDATE pledges SET status=CASE WHEN status='fulfilled' THEN 'open' ELSE status END,
              fulfilled_gift_id=NULL, fulfilled_at=NULL, surplus_amount=0, updated_at=NOW()
       WHERE id=? AND org_id=?`,
      [pledgeId, orgId]);
  }
  return {
    paid, balance: round2(Math.max(0, amount - paid)),
    surplus, overpaid: surplus > 0,
    status: pledgeDisplayStatus(paid, amount, status),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 312

// Atomic — UPDATE...RETURNING, never SELECT MAX(n)+1, so two concurrent
// receipt issues for the same org can never allocate the same number.
// Uses query() (not run()) because db.js's run() only returns rowCount and
// discards the RETURNING data.
async function allocateReceiptNumber(orgId) {
  const rows = await query(
    "UPDATE orgs SET receipt_counter = receipt_counter + 1 WHERE id = ? RETURNING receipt_counter",
    [orgId]
  );
  const n = rows[0].receipt_counter;
  // ORG_TZ_SEAM_OK — the year prefix is the ORG's civil year at issue, never
  // the process clock's. In UTC production those disagree from 19:00 EST every
  // Dec 31: the highest-volume hours of the highest-volume giving day would
  // stamp tax documents with next year's prefix (BUILD-75 Phase 0.1 measured
  // the exposure — half of all receipts to date were allocated inside the
  // nightly disagreement window; only the year boundary hadn't been crossed).
  const year = orgToday(await orgTz(orgId)).slice(0, 4);
  return `${year}-${String(n).padStart(5, "0")}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 313

function applyReceiptTokens(str, org, donor) {
  if (!str) return "";
  // FIX-46: "Dear {{donor_name}}" greets (shared/greeting.js), loaded at boot.
  const greeted = GREET ? GREET.greetMerge(str, GREET.greetingName(donor || {})) : String(str);
  return greeted.replace(/\{\{donor_name\}\}/g, donor.name || "").replace(/\{\{org_name\}\}/g, org.name || "");
}
// SPLIT-2 end

__share({ syncSource, noteSkippedRow, sourcesRideTogether, findCrossSourceGift, crossSourceSentence, writeSourceRow, resolveSourceDonor, recordSourceRun, classifySourceError, sourceErrorSentence, queueThankYouDraft, processPledgeInstallmentReminders, onPledgeSettled, healthBody, statusCheckOnce, dpaViewer, _titleCaseWord, displayNameCase, orgOwns, orgPlanTier, requireCrm, recordMove, recordAutoMove, autoLapseOrg, unlapseHeldByPledge, recalcDonorSummary, writeAuditLog, mfaVerifyForUser, inviteeDisplayName, round2, pledgeStatusFor, pledgeDisplayStatus, recalcPledgePayment, allocateReceiptNumber, applyReceiptTokens });
