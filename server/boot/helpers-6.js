// SPLIT-2: moved VERBATIM from server.js (its functions from lines 7850-9308). server.js requires the boot modules in
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
let BILLING_WEBHOOK_EVENTS, CARD_CHECK_BUDGET, CARD_RECHECK_DAYS, DONATION_WEBHOOK_EVENTS, DONOR_EMAIL_ORG, DUNNING_SCHEDULE_DAYS, ItemRefs, MAX_NOTIFY_ATTEMPTS, RECONCILE_WINDOW_HOURS, SEQ, SEQ_RATE_PER_SECOND, SEQ_READY, SEQ_TICK_BUDGET, Sentry, WORKFLOW_RECIPES, asJson, bulkSendAddressGate, cardPeriod, computeAtRiskCandidates, computeDriftForDonors, computeMilestoneCandidates, displayNameCase, donorMailDecision, donorOnly, donorSendOpts, ensureAtRiskSequence, ensureMilestoneSequences, escHtmlWf, fmtMoneyPlain, greetFor, logRecoveryEvent, mailPolicy, newId, notifyFailedPending, openSustainerLapseThread, openingLine, orgMaySendEmail, orgTime, orgToday, orgTz, publicAppUrl, query, reconcileAccountsWithStripe, reconciliation, resend, run, sendCardExpiringEmail, sendDunningEmail, sendGiftAlertEmail, sendRawEmail, solicitableSql, stripe, sysWorkflow, unsubscribeEmailFooterHtml, userWantsEmail, webhookEventDiff, webhookSubStatus;
__boot.register(c => {
  if ("BILLING_WEBHOOK_EVENTS" in c) BILLING_WEBHOOK_EVENTS = c.BILLING_WEBHOOK_EVENTS;
  if ("CARD_CHECK_BUDGET" in c) CARD_CHECK_BUDGET = c.CARD_CHECK_BUDGET;
  if ("CARD_RECHECK_DAYS" in c) CARD_RECHECK_DAYS = c.CARD_RECHECK_DAYS;
  if ("DONATION_WEBHOOK_EVENTS" in c) DONATION_WEBHOOK_EVENTS = c.DONATION_WEBHOOK_EVENTS;
  if ("DONOR_EMAIL_ORG" in c) DONOR_EMAIL_ORG = c.DONOR_EMAIL_ORG;
  if ("DUNNING_SCHEDULE_DAYS" in c) DUNNING_SCHEDULE_DAYS = c.DUNNING_SCHEDULE_DAYS;
  if ("ItemRefs" in c) ItemRefs = c.ItemRefs;
  if ("MAX_NOTIFY_ATTEMPTS" in c) MAX_NOTIFY_ATTEMPTS = c.MAX_NOTIFY_ATTEMPTS;
  if ("RECONCILE_WINDOW_HOURS" in c) RECONCILE_WINDOW_HOURS = c.RECONCILE_WINDOW_HOURS;
  if ("SEQ" in c) SEQ = c.SEQ;
  if ("SEQ_RATE_PER_SECOND" in c) SEQ_RATE_PER_SECOND = c.SEQ_RATE_PER_SECOND;
  if ("SEQ_READY" in c) SEQ_READY = c.SEQ_READY;
  if ("SEQ_TICK_BUDGET" in c) SEQ_TICK_BUDGET = c.SEQ_TICK_BUDGET;
  if ("Sentry" in c) Sentry = c.Sentry;
  if ("WORKFLOW_RECIPES" in c) WORKFLOW_RECIPES = c.WORKFLOW_RECIPES;
  if ("asJson" in c) asJson = c.asJson;
  if ("bulkSendAddressGate" in c) bulkSendAddressGate = c.bulkSendAddressGate;
  if ("cardPeriod" in c) cardPeriod = c.cardPeriod;
  if ("computeAtRiskCandidates" in c) computeAtRiskCandidates = c.computeAtRiskCandidates;
  if ("computeDriftForDonors" in c) computeDriftForDonors = c.computeDriftForDonors;
  if ("computeMilestoneCandidates" in c) computeMilestoneCandidates = c.computeMilestoneCandidates;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("donorOnly" in c) donorOnly = c.donorOnly;
  if ("donorSendOpts" in c) donorSendOpts = c.donorSendOpts;
  if ("ensureAtRiskSequence" in c) ensureAtRiskSequence = c.ensureAtRiskSequence;
  if ("ensureMilestoneSequences" in c) ensureMilestoneSequences = c.ensureMilestoneSequences;
  if ("escHtmlWf" in c) escHtmlWf = c.escHtmlWf;
  if ("fmtMoneyPlain" in c) fmtMoneyPlain = c.fmtMoneyPlain;
  if ("greetFor" in c) greetFor = c.greetFor;
  if ("logRecoveryEvent" in c) logRecoveryEvent = c.logRecoveryEvent;
  if ("mailPolicy" in c) mailPolicy = c.mailPolicy;
  if ("newId" in c) newId = c.newId;
  if ("notifyFailedPending" in c) notifyFailedPending = c.notifyFailedPending;
  if ("openSustainerLapseThread" in c) openSustainerLapseThread = c.openSustainerLapseThread;
  if ("openingLine" in c) openingLine = c.openingLine;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("reconcileAccountsWithStripe" in c) reconcileAccountsWithStripe = c.reconcileAccountsWithStripe;
  if ("reconciliation" in c) reconciliation = c.reconciliation;
  if ("resend" in c) resend = c.resend;
  if ("run" in c) run = c.run;
  if ("sendCardExpiringEmail" in c) sendCardExpiringEmail = c.sendCardExpiringEmail;
  if ("sendDunningEmail" in c) sendDunningEmail = c.sendDunningEmail;
  if ("sendGiftAlertEmail" in c) sendGiftAlertEmail = c.sendGiftAlertEmail;
  if ("sendRawEmail" in c) sendRawEmail = c.sendRawEmail;
  if ("solicitableSql" in c) solicitableSql = c.solicitableSql;
  if ("stripe" in c) stripe = c.stripe;
  if ("sysWorkflow" in c) sysWorkflow = c.sysWorkflow;
  if ("unsubscribeEmailFooterHtml" in c) unsubscribeEmailFooterHtml = c.unsubscribeEmailFooterHtml;
  if ("userWantsEmail" in c) userWantsEmail = c.userWantsEmail;
  if ("webhookEventDiff" in c) webhookEventDiff = c.webhookEventDiff;
  if ("webhookSubStatus" in c) webhookSubStatus = c.webhookSubStatus;
});

// SPLIT-2 server.js piece 532

async function autoEnroll({ orgId = null } = {}) {
  try {
    await ensureMilestoneSequences({ orgId });
    await ensureAtRiskSequence({ orgId });
    const seqs = await query(
      `SELECT * FROM sequences WHERE status = 'active' AND trigger NOT IN ('manual', 'stage_change', 'onboarding')${orgId ? " AND org_id = ?" : ""}`,
      orgId ? [orgId] : []
    );
    for (const seq of seqs) {
      let donors = [];
      if (seq.trigger === "lapsed_90" || seq.trigger === "lapsed_180") {
        // FIX-51: both lapsed triggers are the one lapse rule (lapseRule.js),
        // 12 months and more since the last gift, in the org's own day. The
        // old 90- and 180-day clocks are gone; the stage still has to say it.
        const lapsedNow = require("../../shared/numbers/lapse").sql("lapsed", "last_gift_date", orgToday(await orgTz(seq.org_id)), "d.id");   // FIX-60: a pledge holds them
        donors = await query(
          `SELECT id FROM donors d WHERE org_id = ? AND stage = 'lapsed' AND deleted_at IS NULL AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.imported_sustainer IS NOT TRUE AND last_gift_date IS NOT NULL AND last_gift_date <> '' AND ${lapsedNow.sql}`,
          [seq.org_id, ...lapsedNow.args]
        );
      } else if (seq.trigger === "new_donor") {
        donors = await query(
          `SELECT id FROM donors d WHERE org_id = ? AND gift_count = 1 AND deleted_at IS NULL AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND last_gift_date IS NOT NULL AND last_gift_date::date > NOW() - INTERVAL '7 days'`,
          [seq.org_id]
        );
      } else if (seq.trigger === "at_risk") {
        // Unlike milestone below, "at risk" isn't a repeating-with-variations
        // event, so the plain existing-enrollment-row check + ON CONFLICT DO
        // NOTHING in the generic loop further down (same as lapsed_90/180) is
        // sufficient — no per-donor key tracking needed.
        donors = await computeAtRiskCandidates(seq.org_id);
      } else if (seq.trigger === "milestone") {
        // Distinct handling: each donor can hit MANY different milestones over
        // time (crossing $500, then later $1000, then a 1-year anniversary...),
        // which the plain ON CONFLICT DO NOTHING enrollment below can't express
        // for a single (sequence_id, donor_id) row. Instead, reuse/reset that one
        // row per donor and track WHICH milestone it currently represents via
        // metadata.milestone_key — a re-detected key that matches what's already
        // there is skipped (already handled); a different key means a genuinely
        // new milestone, so the row is reset and re-enrolled.
        const candidates = await computeMilestoneCandidates(seq.org_id);
        for (const c of candidates) {
          const existing = await query(
            "SELECT id, metadata FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
            [seq.id, c.donorId]
          );
          const existingMeta = existing[0]?.metadata
            ? (typeof existing[0].metadata === "string" ? JSON.parse(existing[0].metadata) : existing[0].metadata)
            : null;
          if (existing.length && existingMeta?.milestone_key === c.milestoneKey) continue;
          const metaJson = JSON.stringify({
            milestone_key: c.milestoneKey, milestone_type: c.milestoneType,
            threshold: c.threshold || null, label: c.label || null,
          });
          if (existing.length) {
            await run(
              `UPDATE sequence_enrollments SET status='active', current_step=0, enrolled_at=NOW(), completed_at=NULL, next_send_at=NOW(), metadata=? WHERE id=?`,
              [metaJson, existing[0].id]
            );
          } else {
            await run(
              `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at, metadata)
               VALUES (?, ?, ?, ?, 0, 'active', NOW(), ?)`,
              [newId("se"), seq.id, seq.org_id, c.donorId, metaJson]
            );
          }
        }
        continue;
      }
      for (const donor of donors) {
        const existing = await query(
          "SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND donor_id = ?",
          [seq.id, donor.id]
        );
        if (existing.length) continue;
        const steps = await query(
          "SELECT delay_days FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1",
          [seq.id]
        );
        const firstDelay = parseInt(steps[0]?.delay_days || 0, 10);
        const enrId = newId("se");
        await run(
          `INSERT INTO sequence_enrollments (id, sequence_id, org_id, donor_id, current_step, status, next_send_at)
           VALUES (?, ?, ?, ?, 0, 'active', NOW() + INTERVAL '${firstDelay} days')
           ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
          [enrId, seq.id, seq.org_id, donor.id]
        );
      }
    }
  } catch (e) { console.error("[seq] autoEnroll:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 535

// The values a step's merge fields render from: the person's OWN data, the
// org's OWN words (BUILD-86 vocabulary), and every custom field on the record.
// NOTHING here is generated — every value is a column somebody typed or a gift
// somebody gave.
async function sequenceMergeValues(donor, orgId) {
  const [org] = await query("SELECT name, vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const V = await import("../../shared/vocabulary.js");
  let vocab = null;
  try { vocab = org?.vocabulary_json ? JSON.parse(org.vocabulary_json) : null; } catch { /* default words */ }
  const t = V.makeT(vocab);
  const words = String(donor.name || "").trim().split(/\s+/).filter(Boolean);
  const values = {
    first: words[0] || "",
    last: words.length > 1 ? words[words.length - 1] : "",
    name: donor.name || "",
    last_gift_amount: Number(donor.last_gift_amount) > 0 ? fmtMoneyPlain(donor.last_gift_amount) : "",
    last_gift_date: donor.last_gift_date || "",
    fund: donor.__fund || "",
    // BUILD-86 Part B — a shop that says "sponsors" gets "sponsor" here. The
    // brief's {{sponsor_name}} is THAT word, not a second person's name.
    sponsor_name: t("giver", 1),
    gift: t("gift", 1),
    org_name: displayNameCase(org?.name || ""),
  };
  // Every custom field on the person, by key. A field she made is a field she
  // can write with.
  const cf = donor.custom_fields && typeof donor.custom_fields === "object" ? donor.custom_fields : {};
  for (const [k, v] of Object.entries(cf)) {
    if (values[k] === undefined) values[k] = Array.isArray(v) ? v.join(", ") : (v == null ? "" : String(v));
  }
  return values;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 537

// The closed STOP set, evaluated for one enrollment at send time. Returns a
// stop key or null. A LOGGED CONVERSATION IS NOT HERE, deliberately — see
// SEQ.STOP_NOT_A_STOP, which is the sentence the settings screen shows so
// nobody assumes otherwise.
async function sequenceStopFor(enr, donor, step) {
  if (!donor) return "removed";
  if (donor.deceased === true) return "deceased";
  if (donor.do_not_email === true) return "do_not_email";
  const decision = await donorMailDecision("sequence", donor.email, enr.org_id, { donorId: donor.id || enr.donor_id });
  if (!decision.send) return decision.reason === "bounced" ? "bounced" : "unsubscribed";
  // A SECOND GIFT DURING A FIRST-GIFT SEQUENCE skips what is left — a welcome
  // series must not ask for a gift the week after one arrived. A step marked
  // "send even after another gift" (the thank-you) still goes.
  if (enr.gift_count_at_enroll != null && Number(donor.gift_count || 0) > Number(enr.gift_count_at_enroll)
      && !step.send_even_after_gift) {
    return "another_gift";
  }
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 538

// Is this org allowed to run sequences at all? BUILD-84's timezone rule: the
// column has a default, so what this needs is a zone A HUMAN CHOSE.
async function sequenceTimezoneGate(orgId) {
  await SEQ_READY;
  const tz = await orgTz(orgId);
  return { ...SEQ.timezoneGate(tz), timezone: tz.timezone };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 539

// The org's local clock as { weekday, hour, date } — the send window's input.
async function orgSendClock(orgId, at = new Date()) {
  const tz = await orgTz(orgId);
  const c = orgTime.orgClock(tz, at);                       // ORG_TZ_SEAM_OK
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date);
  const weekday = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : new Date(at).getUTCDay();
  return { ...c, weekday, timezone: tz.timezone };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 540

// ── ENROLLMENT ─────────────────────────────────────────────────────────────
// ENROLLMENT IS NEVER RETROACTIVE. Every call site passes the event that just
// happened; nothing here looks backwards.
async function enrollInSequences(orgId, donorId, triggerKey, context = {}, actor = null) {
  await SEQ_READY;
  const gate = await sequenceTimezoneGate(orgId);
  if (!gate.ok) return { enrolled: 0, reason: gate.reason };
  const seqs = await query(
    `SELECT * FROM sequences WHERE org_id = ? AND status = 'active' AND trigger = ? AND tracks IS NOT NULL AND NOT EXISTS (SELECT 1 FROM donors x WHERE x.id = ? AND x.org_id = ? AND x.deceased IS TRUE)`,   // PEOPLE-1: none start for the deceased
    [orgId, triggerKey, donorId, orgId]);
  let enrolled = 0;
  const errors = [];   // JOBS-1: the handler tries again on these
  for (const seq of seqs) {
    try {
      const tracks = Array.isArray(seq.tracks) ? seq.tracks : JSON.parse(seq.tracks || "[]");
      const track = SEQ.chooseTrack(tracks, context);
      // validateSequence refuses to save a sequence whose last track is not
      // "everyone else", so this can only be null for a row written before
      // that rule — it is a refusal to enroll, logged, never a silent pass.
      if (!track) { console.error(`[seq] ${seq.id}: nobody's track matched — not enrolling ${donorId}`); continue; }
      const steps = await query(
        `SELECT * FROM sequence_steps WHERE sequence_id = ? AND track_key = ? ORDER BY step_order ASC`,
        [seq.id, track.key]);
      if (!steps.length) { console.error(`[seq] ${seq.id}: track ${track.key} has no steps`); continue; }
      const [d] = await query(`SELECT gift_count FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
      const firstDelay = parseInt(steps[0].delay_days, 10) || 0;
      const r = await run(
        `INSERT INTO sequence_enrollments
           (id, sequence_id, org_id, donor_id, current_step, status, next_send_at, track_key,
            enrolled_by, enrolled_by_name, gift_count_at_enroll)
         VALUES (?,?,?,?,0,'active', NOW() + INTERVAL '${firstDelay} days', ?,?,?,?)
         ON CONFLICT (sequence_id, donor_id) DO NOTHING`,
        [newId("se"), seq.id, orgId, donorId, track.key,
         actor?.id || "system:sequence", actor?.name || null, d ? Number(d.gift_count || 0) : null]);
      if (r.changes) enrolled++;
    } catch (e) { console.error(`[seq] enroll ${seq.id}/${donorId}:`, e.message); errors.push(`${seq.id}: ${e.message}`); }
  }
  return { enrolled, errors };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 543

// AUTO-1 · THE ONE SENDER for words a person on staff wrote and turned on:
// a tracked sequence's step and a journey's automatic email step. Merge, the
// unsubscribe footer, the org's sending identity and the provider call live
// here once, so the two engines differ only in what they claim and log.
// Returns { delivered, errText, subject, missing } and never throws.
async function sendStaffWrittenEmail(orgId, donor, subjectTpl, bodyTpl, source) {
  const values = await sequenceMergeValues(donor, orgId);
  const subj = SEQ.renderMerge(subjectTpl, values);
  // ATLAS-4: a never-giver is not told "we are asking the people who have given before" (shared/giftSentence.js).
  const hasGift = Number(donor.total_giving) > 0 || Number(donor.last_gift_amount) > 0 || Number(donor.gift_count) > 0;
  const body = SEQ.renderMerge((await import("../../shared/giftSentence.js")).withoutGivenBefore(bodyTpl, { hasGift, orgName: values.org_name }), values);
  const html = (body.text.includes("<") ? body.text
    : `<p>${body.text.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`)
    + await unsubscribeEmailFooterHtml(donor.email, orgId, source);
  let delivered = true, errText = null;
  if (process.env.RESEND_API_KEY) {
    delivered = false;
    try {
      const opts = { ...(await donorSendOpts(orgId, donor.email, source)), to: donor.email, subject: subj.text, html };
      const { error: sendErr } = await resend.emails.send(opts);
      if (sendErr) errText = sendErr.message || String(sendErr);
      else delivered = true;
    } catch (e) { errText = e.message; }
  }
  return { delivered, errText, subject: subj.text, missing: [...new Set([...(subj.missing || []), ...(body.missing || [])])] };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 544
// The merge, without sending: which fields this person cannot fill.
async function staffWrittenMissing(orgId, donor, subjectTpl, bodyTpl) {
  const values = await sequenceMergeValues(donor, orgId);
  return [...new Set([...(SEQ.renderMerge(subjectTpl, values).missing || []), ...(SEQ.renderMerge(bodyTpl, values).missing || [])])];
}
// SPLIT-2 end
// SPLIT-2 server.js piece 545

async function processTrackedSequences({ orgId = null, limit = SEQ_TICK_BUDGET, now = new Date() } = {}) {
  await SEQ_READY;
  const scope = orgId ? " AND se.org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const due = await query(
    `SELECT se.*, s.name AS seq_name, s.turned_on_by_name, s.turned_on_at, s.trigger AS seq_trigger
       FROM sequence_enrollments se
       JOIN sequences s ON s.id = se.sequence_id
       JOIN orgs o ON o.id = se.org_id
      WHERE se.status = 'active' AND se.track_key IS NOT NULL
        AND s.status = 'active' AND se.next_send_at <= NOW()${scope}
        AND ${mailPolicy.orgSendsSql("o")}
      ORDER BY se.next_send_at ASC LIMIT ?`, params);
  const out = { sent: 0, skipped: 0, stopped: 0, failed: 0, waited: 0, due: due.length };
  // Group by org so the window and the clock are read once per org, not once
  // per enrollment.
  const byOrg = new Map();
  for (const e of due) { if (!byOrg.has(e.org_id)) byOrg.set(e.org_id, []); byOrg.get(e.org_id).push(e); }

  for (const [oid, list] of byOrg) {
    const gate = await sequenceTimezoneGate(oid);
    if (!gate.ok) { out.skipped += list.length; continue; }
    // BUILD-94 Part 4 — NO ADDRESS, NO SEND, for sequences too. Nothing is
    // consumed and nothing is failed: next_send_at is untouched, so the day
    // she types the address the whole queue goes.
    const addr = await bulkSendAddressGate(oid);
    if (!addr.ok) {
      console.error(`[seq] ${oid}: no mailing address on file — ${list.length} sends held`);
      out.skipped += list.length; out.noAddress = (out.noAddress || 0) + list.length;
      continue;
    }
    const clock = await orgSendClock(oid, now);
    // WEEKDAY MORNINGS WHERE SHE IS. Outside the window nothing sends and
    // nothing is consumed — next_send_at moves to the next window's morning.
    if (!SEQ.inSendWindow(clock)) {
      const days = SEQ.daysUntilNextWindow(clock.weekday, clock.hour);
      await run(
        `UPDATE sequence_enrollments SET next_send_at = NOW() + INTERVAL '${Math.max(days, 0)} days' + INTERVAL '1 hour'
          WHERE id = ANY(?) AND status='active'`, [list.map(e => e.id)]);
      out.waited += list.length;
      continue;
    }
    let inSecond = 0, secondStart = Date.now();
    for (const enr of list) {
      try {
        const steps = await query(
          `SELECT * FROM sequence_steps WHERE sequence_id = ? AND track_key = ? ORDER BY step_order ASC`,
          [enr.sequence_id, enr.track_key]);
        const step = steps[enr.current_step];
        if (!step) { await closeEnrollment(enr.id, "completed", null); continue; }

        const [donor] = await query(
          `SELECT id, name, email, deceased, do_not_email, gift_count, last_gift_amount, last_gift_date, custom_fields
             FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [enr.donor_id, oid]);
        const stop = await sequenceStopFor(enr, donor, step);
        if (stop === "another_gift") {
          // The REMAINING steps are skipped, not the enrollment failed: she
          // asked for a welcome series, and it ends when the welcome is over.
          await closeEnrollment(enr.id, "completed", "another_gift");
          out.stopped++; continue;
        }
        if (stop) { await closeEnrollment(enr.id, "stopped", stop); out.stopped++; continue; }

        // ── THE CLAIM. Before the provider call, never after. ─────────────
        const claimId = newId("ss");
        const claim = await run(
          `INSERT INTO sequence_sends (id, org_id, sequence_id, donor_id, step_order, status, subject, attempts)
           VALUES (?,?,?,?,?, 'claimed', ?, 1)
           ON CONFLICT (sequence_id, donor_id, step_order) DO NOTHING`,
          [claimId, oid, enr.sequence_id, enr.donor_id, step.step_order, step.subject]);
        if (!claim.changes) {
          // Somebody already has this step — a retried job, or a concurrent
          // tick. Advance past it rather than sending a second copy.
          await advanceEnrollment(enr, steps);
          out.skipped++; continue;
        }

        // Rate limit: a simple per-second gate, because a burst is how a
        // provider starts refusing an org's mail.
        if (++inSecond >= SEQ_RATE_PER_SECOND) {
          const elapsed = Date.now() - secondStart;
          if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
          inSecond = 0; secondStart = Date.now();
        }
        const { delivered, errText, subject: subjText } = await sendStaffWrittenEmail(oid, donor, step.subject, step.body, "sequence");
        const subj = { text: subjText };

        if (!delivered) {
          // NEVER SWALLOWED (BUILD-37 H2). The row keeps the reason and the
          // sequence line on Home says how many could not be sent.
          out.failed++;
          console.error(`[seq] send failed for ${enr.donor_id} step ${step.step_order}: ${errText}`);
          await run(`UPDATE sequence_sends SET status='failed', error=? WHERE id=?`,
            [String(errText || "unknown").slice(0, 300), claimId]);
          // next_send_at untouched: the next tick retries, and the claim row
          // is reused (attempts bumped) rather than duplicating.
          continue;
        }

        await run(`UPDATE sequence_sends SET status='sent', sent_at=NOW(), error=NULL WHERE id=?`, [claimId]);
        // ONE email conversation on the person's timeline, per send, saying
        // who turned this on and when. "Why did this donor get this" has an
        // answer that is a person and a date.
        const civilOn = enr.turned_on_at ? new Date(enr.turned_on_at).toISOString().slice(0, 10) : null;
        await run(
          `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by)
           VALUES (?,?,?,'email',?,?,?)`,
          [newId("i"), oid, enr.donor_id,
           `${SEQ.sendActorLine({ sequenceName: enr.seq_name, stepNumber: enr.current_step + 1,
                                  turnedOnByName: enr.turned_on_by_name, turnedOnAt: civilOn })} · ${subj.text}`,
           clock.date, "system:sequence"]);
        await advanceEnrollment(enr, steps);
        out.sent++;
      } catch (e) { console.error("[seq] enrollment", enr.id, e.message); out.failed++; }
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 546

async function advanceEnrollment(enr, steps) {
  const next = steps[enr.current_step + 1];
  if (!next) {
    await run(`UPDATE sequence_enrollments SET status='completed', completed_at=NOW(), current_step=current_step+1 WHERE id=?`, [enr.id]);
    return;
  }
  // The offset is from ENROLLMENT, not from the previous send — that is what a
  // "day offset" means, and it keeps a slow tick from pushing a whole series
  // later and later.
  const offset = parseInt(next.delay_days, 10) || 0;
  await run(
    `UPDATE sequence_enrollments SET current_step = current_step + 1,
            next_send_at = enrolled_at + INTERVAL '${offset} days' WHERE id = ?`, [enr.id]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 547
async function closeEnrollment(id, status, reason) {
  await run(`UPDATE sequence_enrollments SET status=?, stop_reason=?, completed_at=NOW() WHERE id=?`,
    [status, reason || null, id]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 548

// ── Recurring gift recovery: dunning engine ─────────────────────────────────
// Follows the same shape as processSequences()/autoEnroll() above: a
// module-level async function run on startup and on an interval, also
// exposed as an admin-only manual-trigger route.
async function processDunning({ orgId = null } = {}) {   // TRUST-1: a request passes its org; only the hourly job runs all orgs
  const picked = [];
  try {
    // FIX-45: never a demo org's or a sample person's card (orgSendsSql).
    const rows = await query(
      `SELECT rs.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_subscriptions rs
       JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id
       JOIN orgs o ON o.id = rs.org_id
       WHERE rs.status IN ('past_due','recovering') AND rs.next_dunning_at <= NOW()
         AND d.is_sample IS NOT TRUE AND ${mailPolicy.orgSendsSql("o")}${orgId ? " AND rs.org_id = ?" : ""}`,
      orgId ? [orgId] : []
    );
    picked.push(...rows.map(r => ({ orgId: r.org_id, subscriptionId: r.id })));
    for (const rs of rows) {
      try {
        const orgRows = await query(
          "SELECT id, name, recurring_dunning_enabled, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE id=?",
          [rs.org_id]
        );
        const org = orgRows[0];
        if (!org || !rs.donor_email) continue;
        // Org turned this off — leave the cadence/step where it is (so it
        // picks back up correctly if re-enabled) but don't send.
        if (org.recurring_dunning_enabled === false) continue;

        // W-4 log honesty: dunning_sent is logged ONLY after a real delivery.
        // A permanent policy refusal (deceased) logs dunning_skipped and
        // advances the cadence (retrying is pointless); a provider failure
        // logs nothing and leaves next_dunning_at alone so the next tick
        // retries — the absence of a row is the truth.
        const dunningResult = await sendDunningEmail(org, { name: rs.donor_name, email: rs.donor_email }, rs);
        if (dunningResult.sent) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_sent", null, { step: rs.dunning_step });
        } else if (dunningResult.refused) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_skipped", null, { step: rs.dunning_step, reason: dunningResult.refused });
        } else {
          console.error(`[dunning] delivery failed for sub ${rs.id} — will retry next tick`);
          continue;
        }

        const nextStep = rs.dunning_step + 1;
        const nextDelayDays = DUNNING_SCHEDULE_DAYS[nextStep];
        const nextDunningAt = nextDelayDays != null
          ? new Date(new Date(rs.first_failed_at).getTime() + nextDelayDays * 86400000).toISOString()
          : null; // exhausted the cadence — Stripe's own retries continue, but WE stop emailing
        await run(
          `UPDATE recurring_subscriptions SET status='recovering', dunning_step=?, next_dunning_at=?, updated_at=NOW() WHERE id=?`,
          [nextStep, nextDunningAt, rs.id]
        );
        // …and the automation handing the donor to a human is the whole point:
        // four emails over a fortnight did not reach them, so someone calls.
        if (nextDunningAt === null) {
          await logRecoveryEvent(rs.org_id, rs.donor_id, rs.stripe_subscription_id, "dunning_exhausted", null, { steps: nextStep });
          await openSustainerLapseThread(rs.org_id, rs.donor_id, {
            amount: rs.amount != null ? parseFloat(rs.amount) : null, interval: rs.interval, reason: "dunning_exhausted" });
        }
      } catch (e) { console.error("[dunning] subscription", rs.id, e.message); }
    }
  } catch (e) { console.error("[dunning] processDunning:", e.message); }
  return { picked };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 552

// refreshCardsOnFile — pull brand/last4/expiry for live subscriptions whose
// stored copy is missing or stale. Returns a job budget the way the import and
// the geocoder do: a cost you cannot see is a cost nobody manages.
async function refreshCardsOnFile({ limit = CARD_CHECK_BUDGET, orgId = null } = {}) {
  const scope = orgId ? " AND rs.org_id = ?" : "";
  const params = orgId
    ? [CARD_RECHECK_DAYS, orgId, limit]
    : [CARD_RECHECK_DAYS, limit];
  const rows = await query(
    `SELECT rs.id, rs.org_id, rs.stripe_subscription_id, o.stripe_account_id
       FROM recurring_subscriptions rs JOIN orgs o ON o.id = rs.org_id
      WHERE rs.status IN ('active','past_due','recovering')
        AND rs.stripe_subscription_id IS NOT NULL
        AND o.stripe_account_id IS NOT NULL
        AND (rs.card_checked_at IS NULL OR rs.card_checked_at < NOW() - (? || ' days')::interval)${scope}
      ORDER BY rs.card_checked_at ASC NULLS FIRST, rs.id ASC
      LIMIT ?`, params);
  const out = { checked: 0, requests: 0, withCard: 0, failed: 0 };
  const t0 = Date.now();
  for (const r of rows) {
    out.requests++;
    try {
      // ONE call gets the subscription and the card behind it. A subscription
      // with no default of its own inherits the customer's, so both are
      // expanded — reading only the first would leave those rows blank forever.
      const sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id,
        { expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"] },
        { stripeAccount: r.stripe_account_id });
      const pm = (sub.default_payment_method && typeof sub.default_payment_method === "object")
        ? sub.default_payment_method
        : (sub.customer && sub.customer.invoice_settings && typeof sub.customer.invoice_settings.default_payment_method === "object"
            ? sub.customer.invoice_settings.default_payment_method : null);
      const card = pm && pm.card ? pm.card : null;
      await run(
        `UPDATE recurring_subscriptions
            SET card_payment_method_id=?, card_brand=?, card_last4=?, card_exp_month=?, card_exp_year=?,
                card_checked_at=NOW(), updated_at=NOW()
          WHERE id=?`,
        [pm ? pm.id : null, card ? card.brand : null, card ? card.last4 : null,
         card ? card.exp_month : null, card ? card.exp_year : null, r.id]);
      out.checked++;
      if (card) out.withCard++;
    } catch (e) {
      // A failed READ is not a fact about the card. Stamp the check so one
      // broken subscription cannot monopolise every tick's budget, but leave
      // the stored card alone rather than blanking it on a network blip.
      out.failed++;
      await run(`UPDATE recurring_subscriptions SET card_checked_at=NOW() WHERE id=?`, [r.id]).catch(() => {});
      console.error(`[card-expiry] read failed for ${r.stripe_subscription_id}:`, e.message);
    }
  }
  out.ms = Date.now() - t0;
  if (out.requests) console.log(`[card-expiry] refresh org=${orgId || "all"} requests=${out.requests} checked=${out.checked} withCard=${out.withCard} failed=${out.failed} ${out.ms}ms`);
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 553

// The subscriptions whose card dies this month or next, that have not already
// been told about THIS expiry. Two months of warning is the window that still
// leaves time to act before the next charge without being so early it reads as
// noise.
async function expiringCardRows(orgId, { today = new Date() } = {}) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const periods = [cardPeriod(y, m), cardPeriod(next.y, next.m)];
  return await query(
    `SELECT rs.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_subscriptions rs JOIN donors d ON d.id = rs.donor_id
      WHERE rs.org_id = ? AND rs.status IN ('active','past_due','recovering')
        AND rs.card_exp_year IS NOT NULL AND rs.card_exp_month IS NOT NULL
        AND (rs.card_exp_year || '-' || LPAD(rs.card_exp_month::text, 2, '0')) = ANY(?)
        AND d.deleted_at IS NULL
      ORDER BY rs.card_exp_year ASC, rs.card_exp_month ASC, rs.id ASC`,
    [orgId, periods]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 554

// notifyExpiringCards — one notice per subscription per expiry month. The
// stamp is the EXPIRY period, not a date: a card re-read, a network update, or
// a re-run can never produce a second email about the same expiry, and a
// genuinely new expiry (the donor updated the card) is eligible again by
// construction because the period changed.
async function notifyExpiringCards(org, { send = true, today = new Date() } = {}) {
  const out = { notified: [], skipped: [] };
  // The org-level switch for failed-card mail governs this too: an org that
  // turned off recovery email does not want an earlier version of it. If that
  // ever needs to be separable it is one column, not a rethink.
  if (org.recurring_dunning_enabled === false) return { ...out, disabled: true };
  const rows = await expiringCardRows(org.id, { today });
  for (const rs of rows) {
    const period = cardPeriod(rs.card_exp_year, rs.card_exp_month);
    if (rs.card_expiry_notified_for === period) { out.skipped.push({ id: rs.id, reason: "already_notified" }); continue; }
    if (!rs.donor_email) { out.skipped.push({ id: rs.id, reason: "no_email" }); continue; }
    if (!send) { out.notified.push({ id: rs.id, donorId: rs.donor_id, period, last4: rs.card_last4 }); continue; }
    const r = await sendCardExpiringEmail(org, { name: rs.donor_name, email: rs.donor_email }, rs);
    if (r.sent) {
      // Stamped only after a REAL delivery, the W-4 rule: a provider failure
      // leaves the stamp off so the next tick tries again.
      await run(`UPDATE recurring_subscriptions SET card_expiry_notified_for=?, updated_at=NOW() WHERE id=?`, [period, rs.id]);
      await logRecoveryEvent(org.id, rs.donor_id, rs.stripe_subscription_id, "card_expiring_notice", null, { period, last4: rs.card_last4 });
      out.notified.push({ id: rs.id, donorId: rs.donor_id, period, last4: rs.card_last4 });
    } else if (r.refused) {
      await run(`UPDATE recurring_subscriptions SET card_expiry_notified_for=?, updated_at=NOW() WHERE id=?`, [period, rs.id]);
      out.skipped.push({ id: rs.id, reason: r.refused });
    } else {
      out.skipped.push({ id: rs.id, reason: "delivery_failed" });
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 557

// Lazily provision the recipe rows for an org (disabled by default — nothing
// auto-runs until a human toggles it on). Idempotent via the org+recipe unique.
async function ensureWorkflows(orgId) {
  for (const r of WORKFLOW_RECIPES) {
    await run(
      `INSERT INTO workflows (id,org_id,recipe_key,name,trigger,conditions,actions,config,enabled)
       VALUES (?,?,?,?,?,?,?,?,false)
       ON CONFLICT (org_id,recipe_key) DO NOTHING`,
      [newId("wf"), orgId, r.key, r.name, r.trigger,
       JSON.stringify(r.conditions), JSON.stringify(r.actions), JSON.stringify(r.defaultConfig || {})]
    );
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 559

// Evaluate a workflow's conditions against the event ctx, honoring config
// overrides (e.g. the major-gift threshold slider maps onto the amount>=X
// condition; the lapse window onto donor_lapsed).
function workflowConditionsPass(conditions, config, ctx) {
  for (const c of conditions) {
    if (c.field === "amount") {
      const threshold = Number(config.threshold ?? c.value);
      if (!(Number(ctx.amount) >= threshold)) return false;
    } else if (c.field === "is_first_gift") {
      if (Boolean(ctx.isFirstGift) !== Boolean(c.value)) return false;
    }
  }
  return true;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 561

// Send AT MOST ONE internal email to (org, eventKey, userId). Reserves the
// notification_sends row FIRST (the cross-recipe, per-event dedup — so
// gift-notify and the major-gift owner alert can never both email one person
// for the same gift, A4), then sends. A pref opt-out reserves NOTHING, so a
// different, opted-in notification for the same event can still win. Internal
// staff mail via sendGiftAlertEmail (branded header, NEVER a donor footer).
//
// BUILD-45 (fixes F-2): a REAL send failure is no longer swallowed — the
// reservation is RELEASED (so the alert is not reserved-to-silence) and the
// send is queued in notification_failures for retry on the 5-min tick. Before
// this, a provider outage lost the alert permanently AND any re-trigger of the
// same event deduped to nothing.
async function notifyUserOnce({ org, userId, email, eventKey, channel, prefKind, subject, bodyHtml }) {
  if (!org || !userId || !email || !eventKey) return { sent: false, reason: "no_recipient" };
  if (prefKind && !(await userWantsEmail(userId, prefKind))) return { sent: false, reason: "opted_out" };
  // MAIL-1: staff mail waits for onboarding. Asked before anything is reserved
  // or queued, so a refusal leaves no retry behind it.
  const gate = await orgMaySendEmail(org.id, mailPolicy.CATEGORY.STAFF);
  if (!gate.send) { console.log(`[mail-policy] staff notice ${eventKey} not sent for org ${org.id} (${gate.reason})`); return { sent: false, reason: gate.reason }; }
  const id = newId("ns");
  const reserved = await query(
    `INSERT INTO notification_sends (id,org_id,event_key,recipient_user_id,channel)
     VALUES (?,?,?,?,?)
     ON CONFLICT (org_id,event_key,recipient_user_id) DO NOTHING
     RETURNING id`,
    [id, org.id, eventKey, userId, channel || null]);
  if (!reserved.length) return { sent: false, reason: "duplicate" };
  const ok = await sendGiftAlertEmail(org, email, subject, bodyHtml);
  if (!ok) {
    // Release the dedup reservation and durably queue the send for retry. Best
    // effort: if the release/queue itself fails we still don't crash the caller
    // (notifications are fire-and-forget), but the loud log makes it visible.
    try {
      await run(`DELETE FROM notification_sends WHERE id=?`, [reserved[0].id]);
      await run(
        `INSERT INTO notification_failures (id,org_id,event_key,recipient_user_id,recipient_email,channel,subject,body_html,attempts,last_error,next_retry_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,NOW())`,
        [newId("nf"), org.id, eventKey, userId, email, channel || null, subject || null, bodyHtml || null, "send_rejected"]);
      notifyFailedPending++; __share({ notifyFailedPending });
    } catch (e) { console.error("[notify] failed to queue a failed send for retry:", e.message); }
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 563
// Send-or-queue: every donor-account lifecycle email goes through here. A
// failed send lands in notification_failures (retried on the 5-min tick,
// surfaced on /health.notifications.failedPending) — never fire-and-forget:
// a silently-lost reset email locks a donor out.
// MAIL-1: an org-to-supporter kind passes `orgId`; a refusal by the org's mail
// policy is a decision, not a failure, so it is never queued for retry.
async function sendDonorLifecycleEmail(kind, toEmail, subject, html, fromOverride, orgId = null, confirm = null) {
  if (orgId) {
    const gate = await orgMaySendEmail(orgId, mailPolicy.CATEGORY.DONOR);
    if (!gate.send) { console.log(`[mail-policy] ${kind} not sent for org ${orgId} (${gate.reason})`); return false; }
  }
  const tag = orgId ? { orgId, kind, confirm } : null;
  const ok = await sendRawEmail(toEmail, subject, html, fromOverride, tag);
  if (ok) return true;
  // SEND-GATE-1: a person whose automatic emails are off is an answer, not an
  // outage. The message waits on their profile, never in this retry queue.
  if (tag && tag.refused) return false;
  try {
    await run(
      `INSERT INTO notification_failures (id,org_id,event_key,recipient_user_id,recipient_email,channel,subject,body_html,attempts,last_error,next_retry_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,NOW())`,
      // SEND-GATE-1: the org rides in the key, so the retry is gated like the first try.
      [newId("nf"), DONOR_EMAIL_ORG, kind + (orgId ? "@" + orgId : "") + ":" + Date.now(), "donor", toEmail,
       "donor_" + kind, subject, html, "send_rejected"]);
    notifyFailedPending++; __share({ notifyFailedPending });
  } catch (e) { console.error("[donor-email] failed to queue for retry:", e.message); }
  return false;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 566
async function refreshNotifyFailedCount() {
  try { notifyFailedPending = Number((await query(`SELECT COUNT(*) c FROM notification_failures`))[0]?.c || 0); __share({ notifyFailedPending }); }
  catch { /* table not ready yet — leave the last known value */ }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 567
async function retryFailedNotifications({ force = false } = {}) {
  const due = await query(
    `SELECT * FROM notification_failures
       WHERE attempts < ? AND (? OR next_retry_at <= NOW())
       ORDER BY next_retry_at ASC LIMIT 100`,
    [MAX_NOTIFY_ATTEMPTS, force]);
  let delivered = 0, stillFailing = 0;
  for (const f of due) {
    // Donor-account lifecycle rows: resend the stored html raw (no org
    // context, no staff dedup reservation) — see DONOR_EMAIL_ORG above.
    if (f.org_id === DONOR_EMAIL_ORG) {
      const km = String(f.event_key || "").match(/^([^@:]+)@([^:]+):/);
      const okD = await sendRawEmail(f.recipient_email, f.subject, f.body_html, null, km ? { orgId: km[2], kind: km[1] } : null);
      if (okD) { await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]); delivered++; }
      else {
        const attemptsD = (f.attempts || 1) + 1;
        await run(
          `UPDATE notification_failures SET attempts=?, last_error=?, next_retry_at = NOW() + (INTERVAL '5 minutes' * ?) WHERE id=?`,
          [attemptsD, "send_rejected", attemptsD, f.id]);
        stillFailing++;
      }
      continue;
    }
    const orgRows = await query("SELECT id, name FROM orgs WHERE id=?", [f.org_id]);
    if (!orgRows.length) { await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]).catch(() => {}); continue; }
    const org = orgRows[0];
    const ok = await sendGiftAlertEmail(org, f.recipient_email, f.subject, f.body_html);
    if (ok) {
      // re-reserve the dedup row (so a later same-event trigger still dedups),
      // then clear the failure. The re-reserve is best-effort — the ON CONFLICT
      // makes a concurrent reservation a no-op.
      await run(
        `INSERT INTO notification_sends (id,org_id,event_key,recipient_user_id,channel)
         VALUES (?,?,?,?,?) ON CONFLICT (org_id,event_key,recipient_user_id) DO NOTHING`,
        [newId("ns"), f.org_id, f.event_key, f.recipient_user_id, f.channel || null]).catch(() => {});
      await run(`DELETE FROM notification_failures WHERE id=?`, [f.id]);
      delivered++;
    } else {
      const attempts = (f.attempts || 1) + 1;
      await run(
        `UPDATE notification_failures SET attempts=?, last_error=?, next_retry_at = NOW() + (INTERVAL '5 minutes' * ?) WHERE id=?`,
        [attempts, "send_rejected", attempts, f.id]);
      stillFailing++;
    }
  }
  await refreshNotifyFailedCount();
  return { delivered, stillFailing, considered: due.length };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 570
async function reconcileStripeVsGifts() {
  if (!stripe) return reconciliation;
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - RECONCILE_WINDOW_HOURS * 3600;
  const sinceDate = new Date(sinceSec * 1000).toISOString().slice(0, 10);
  const divergences = [];
  let unrecorded = 0, orphans = 0, oldestAgeMin = null, accountsChecked = 0, accountsErrored = 0;
  // Only orgs with a connected account can have taken a donation.
  const orgs = await query(
    "SELECT id, stripe_account_id FROM orgs WHERE stripe_account_id IS NOT NULL LIMIT 500");
  for (const org of orgs) {
    const acct = org.stripe_account_id;
    let charges;
    try {
      charges = await stripe.charges.list({ created: { gte: sinceSec }, limit: 100 }, { stripeAccount: acct });
      accountsChecked++;
    } catch (e) {
      // BUILD-63 — a guard that can't SEE must not report "clean." A read
      // failure here (e.g. a restricted key without connected-account charge
      // access, or a revoked application grant) previously just `continue`d,
      // so the account silently contributed 0 divergences and /health read
      // all-clear while the guard was blind. Count it and surface it: a
      // non-zero accountsErrored means unrecordedCharges:0 is NOT trustworthy.
      accountsErrored++;
      console.error(`[reconcile] charges.list failed for ${acct} — guard BLIND for this account: ${e.message}`);
      continue;
    }
    const seenPIs = new Set();
    for (const ch of (charges?.data || [])) {
      if (ch.status !== "succeeded") continue;
      const net = (ch.amount || 0) - (ch.amount_refunded || 0);
      const piId = ch.payment_intent || null;
      if (piId) seenPIs.add(piId);
      if (net <= 0) {
        // BUILD-63 Part 3 — a fully-refunded charge should have had its gift
        // reversed by the charge.refunded handler. If a gift STILL exists, the
        // handler never ran — either charge.refunded raced ahead of the gift's
        // own payment_intent.succeeded (so there was nothing to reverse when it
        // fired), or the event type isn't subscribed. Surface it; a refunded
        // donation still sitting as a live gift is real divergence.
        if (piId) {
          const staleGift = await query("SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [org.id, piId]);
          if (staleGift.length) {
            orphans++;
            divergences.push({ kind: "refunded_charge_with_live_gift", chargeId: ch.id, paymentIntent: piId,
              account: acct, orgId: org.id, amount: (ch.amount_refunded || 0) / 100 });
          }
        }
        continue;                                   // otherwise: fully refunded, correctly reversed
      }
      if (!piId) continue;                          // donations always ride a PaymentIntent
      const giftRows = await query(
        "SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [org.id, piId]);
      // FIX-48: a LOST dispute reverses the gift on purpose (the money went
      // back to the card) but Stripe still lists the charge as succeeded with
      // nothing refunded, so every sweep for the next 72 hours called it a
      // charge with no gift and /health read reconciliation.unclean. The
      // reversal is on file (dispute_reversals, the snapshot an appeal
      // restores from), so that charge is accounted for.
      if (!giftRows.length && ch.disputed) {
        const [rev] = await query("SELECT 1 AS x FROM dispute_reversals WHERE org_id=$1 AND stripe_payment_id=$2", [org.id, piId]);
        if (rev) continue;
      }
      if (!giftRows.length) {
        unrecorded++;
        const ageMin = Math.round((nowSec - (ch.created || nowSec)) / 60);
        if (oldestAgeMin == null || ageMin > oldestAgeMin) oldestAgeMin = ageMin;
        divergences.push({ kind: "charge_without_gift", chargeId: ch.id, paymentIntent: piId,
          account: acct, orgId: org.id, amount: net / 100, ageMin });
      }
    }
    // Reverse: recent online gifts whose PI isn't among the live succeeded
    // charges — retrieve-confirm (capped) so a windowed-list miss can't
    // false-positive.
    const recentGifts = await query(
      "SELECT id, stripe_payment_id FROM gifts WHERE org_id=$1 AND stripe_payment_id LIKE 'pi_%' AND date >= $2 LIMIT 200",
      [org.id, sinceDate]);
    let reverseChecked = 0;
    for (const g of recentGifts) {
      if (seenPIs.has(g.stripe_payment_id)) continue;   // has a live succeeded charge
      if (reverseChecked >= 25) break;
      reverseChecked++;
      let status = "missing";
      try {
        const pi = await stripe.paymentIntents.retrieve(g.stripe_payment_id, {}, { stripeAccount: acct });
        if (pi && pi.status === "succeeded") continue;   // fine — just outside the charge window
        status = pi?.status || "missing";
      } catch { status = "retrieve_failed"; }
      orphans++;
      divergences.push({ kind: "gift_without_charge", giftId: g.id, paymentIntent: g.stripe_payment_id,
        account: acct, orgId: org.id, status });
    }
  }
  reconciliation = {
    unrecordedCharges: unrecorded, orphanGifts: orphans, checkedAt: new Date().toISOString(),
    oldestUnrecordedAgeMin: oldestAgeMin, accountsChecked, accountsErrored, divergences: divergences.slice(0, 50),
  }; __share({ reconciliation });
  reconcileAccountsWithStripe = orgs.length; __share({ reconcileAccountsWithStripe });   // BUILD-65 Part 6 — the denominator, in sync with this sweep
  if (unrecorded > 0) {
    console.error(`[reconcile] ALERT: ${unrecorded} Stripe charge(s) with NO gift in Steward (oldest ${oldestAgeMin}m) — ${JSON.stringify(divergences.filter(d => d.kind === "charge_without_gift").slice(0, 10))}`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`reconciliation: ${unrecorded} unrecorded Stripe charge(s)`, "error"); } catch { /* surfacing must never throw */ }
  }
  if (accountsErrored > 0) {
    console.error(`[reconcile] ${accountsErrored} connected account(s) could not be read — the guard is BLIND for them; unrecordedCharges:${unrecorded} is not a clean bill of health.`);
    try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`reconciliation: guard blind for ${accountsErrored} account(s)`, "warning"); } catch { /* never throw */ }
  }
  return reconciliation;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 571

// ── BUILD-63 Part 2 — refresh the manifest-vs-live-subscription diff ─────────
// Lists the platform's webhook endpoints, finds the donation (/stripe/webhook)
// and billing (/billing/webhook) endpoints by URL, and diffs each endpoint's
// subscribed event list against its manifest. Caches missingCount for /health.
// Read-only. Cheap (one list call), so it runs at boot + hourly.
async function checkWebhookSubscriptions() {
  if (!stripe) { webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] }; __share({ webhookSubStatus }); return webhookSubStatus; }
  try {
    const eps = await stripe.webhookEndpoints.list({ limit: 100 });
    const byManifest = [
      { route: "/stripe/webhook", manifest: DONATION_WEBHOOK_EVENTS },
      { route: "/billing/webhook", manifest: BILLING_WEBHOOK_EVENTS },
    ];
    const endpoints = [];
    let totalMissing = 0;
    for (const { route, manifest } of byManifest) {
      const ep = (eps?.data || []).find(e => typeof e.url === "string" && e.url.endsWith(route) && e.status !== "disabled");
      if (!ep) { endpoints.push({ route, found: false, missing: manifest.slice(), extra: [] }); totalMissing += manifest.length; continue; }
      const diff = webhookEventDiff(manifest, ep.enabled_events || []);
      endpoints.push({ route, found: true, endpointId: ep.id, missing: diff.missing, extra: diff.extra, wildcard: diff.wildcard });
      totalMissing += diff.missing.length;
    }
    webhookSubStatus = { missingCount: totalMissing, checked: true, checkedAt: new Date().toISOString(), endpoints }; __share({ webhookSubStatus });
    if (totalMissing > 0) {
      console.error(`[webhook-manifest] ${totalMissing} handled event type(s) NOT subscribed on the live endpoint(s): ${JSON.stringify(endpoints.filter(e => e.missing.length))}`);
      try { if (process.env.SENTRY_DSN) Sentry.captureMessage(`webhook manifest: ${totalMissing} handled event(s) unsubscribed`, "warning"); } catch { /* surfacing must never throw */ }
    }
  } catch (e) {
    console.error("[webhook-manifest] subscription check failed:", e.message);
    // leave the last known value; mark unchecked only if never checked
    if (!webhookSubStatus.checked) webhookSubStatus = { missingCount: null, checked: false, checkedAt: null, endpoints: [] }; __share({ webhookSubStatus });
  }
  return webhookSubStatus;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 572

// BUILD-36 A2 — email a task's assignee when someone ELSE (or a workflow)
// assigned it. NO email for a self-assigned task. Deduped/idempotent via
// notifyUserOnce: default eventKey = taskassign:<taskId>:<assigneeId> (so
// reassigning to a NEW person notifies once), but a gift-fired workflow passes
// the gift event key so the assignment email collapses with gift-notify (A4).
async function notifyTaskAssignment(task, { org, actorUserId = null, eventKey = null }) {
  const assigneeId = task && task.assigned_to;
  if (!assigneeId) return { sent: false, reason: "unassigned" };
  if (actorUserId && assigneeId === actorUserId) return { sent: false, reason: "self_assigned" };
  const urows = await query("SELECT id, name, email FROM users WHERE id=? AND org_id=?", [assigneeId, org.id]);
  if (!urows.length || !urows[0].email) return { sent: false, reason: "no_recipient" };
  const assignee = urows[0];
  const L = await ItemRefs.links(), base = publicAppUrl();
  const donorRow = task.donor_id
    ? (await query("SELECT name, email FROM donors WHERE id=? AND org_id=?", [task.donor_id, org.id]))[0] || null
    : null;
  const person = donorRow ? { kind: "person", id: task.donor_id, name: displayNameCase(donorRow.name || ""), email: donorRow.email } : null;
  const donorName = person ? L.refLabel(person) : null;
  let actorName = null;
  if (actorUserId) {
    const ar = await query("SELECT name FROM users WHERE id=? AND org_id=?", [actorUserId, org.id]);
    actorName = ar[0]?.name || null;
  }
  const context = actorName
    ? `${displayNameCase(actorName)} assigned you a task`
    : `A new task is waiting for you`;
  // THREAD-2 · the task, the person and the gift are links; the one button
  // opens the person (or the task when it is about nobody).
  const giftRef = task.source_gift_id && task.donor_id ? { kind: "gift", id: task.source_gift_id, donorId: task.donor_id } : null;
  const taskRef = { kind: "task", id: task.id, name: task.title, donorId: task.donor_id || null };
  const donorLine = person ? `<p style="margin:4px 0;color:#0f1a12;">Donor: <strong>${L.refLinkHtml(person, base)}</strong>${giftRef ? ` · ${L.refLinkHtml(giftRef, base, { label: "the gift" })}` : ""}</p>` : "";
  const dueLine = task.due ? `<p style="margin:4px 0;color:#6b7d70;">Due ${escHtmlWf(String(task.due).slice(0, 10))}</p>` : "";
  const body = `<p>${escHtmlWf(context)} in ${escHtmlWf(displayNameCase(org.name))}.</p>
<p style="font-size:16px;margin:12px 0 2px;color:#0f1a12;"><strong>${L.refLinkHtml(taskRef, base, { style: "color:#0f1a12;text-decoration:underline;" })}</strong></p>
${donorLine}${dueLine}
${person ? L.refButtonHtml(person, base) : L.refButtonHtml(taskRef, base, "Open the task")}`;
  return notifyUserOnce({
    org, userId: assignee.id, email: assignee.email,
    eventKey: eventKey || `taskassign:${task.id}:${assignee.id}`,
    channel: "task_assignment", prefKind: "task_assignments",
    subject: `New task: ${task.title}`, bodyHtml: body,
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 573

// BUILD-36 A1 — provision a NEW org's workflow recipes with instant_gift_thanks
// ON by default (ED & assigned officer). Hearing about a gift is the product
// working, not a setting to discover. Called only at org creation, so existing
// orgs are never re-created and their toggles stay untouched.
async function provisionNewOrgWorkflows(orgId) {
  await ensureWorkflows(orgId);
  await run(
    "UPDATE workflows SET enabled=true, config=? WHERE org_id=? AND recipe_key='instant_gift_thanks'",
    [JSON.stringify({ notify: "both", threshold: 0 }), orgId]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 574

// Execute one action. Returns a summary object for the run log, or null.
async function runWorkflowAction(action, { org, donor, ctx, config, recipeKey }) {
  const wfActor = sysWorkflow(recipeKey || "unknown"); // BUILD-75 C.1 — the workflow IS the actor
  const firstName = donor ? await greetFor(donor) : "there";
  const amtStr = ctx.amount != null ? `$${Number(ctx.amount).toLocaleString()}` : "";
  const fill = s => String(s || "").replace(/{donor}/g, donor?.name || "the donor").replace(/{amount}/g, amtStr)
    .replace(/{reason}/g, ctx.reason || "past their own giving pattern")   // BUILD-76 — the drift reason, the donor's own words-worthy sentence
    .replace(/{dueDate}/g, ctx.dueDate ? orgTime.formatCivil(ctx.dueDate) : "soon");
  switch (action.type) {
    case "create_task":
    case "notify_owner": {
      // BUILD-76 Part 7 — assignToOwner lets a plain create_task land with the
      // donor's relationship owner (same ED fallback + recorded flag).
      const isOwner = action.type === "notify_owner" || action.assignToOwner === true;
      // The alert lands with the donor's relationship owner. BUILD-25 A1.4: a
      // major-gift donor with NO assigned owner must degrade gracefully — the
      // alert falls back to the ED (first org admin) rather than becoming an
      // orphaned, unassigned task nobody sees. A silently dropped major-gift
      // alert is exactly the failure mode this recipe exists to prevent. The
      // fallback is recorded in the run summary (assignedFallback) so the run
      // log tells the truth about who was actually alerted.
      let owner = isOwner && donor?.assigned_to ? { id: donor.assigned_to, name: donor.assigned_to_name || "" } : null;
      let assignedFallback = false;
      if (isOwner && !owner) {
        const admins = await query("SELECT id, name FROM users WHERE org_id=? AND role='admin' ORDER BY created_at ASC LIMIT 1", [org.id]);
        if (admins.length) { owner = { id: admins[0].id, name: admins[0].name || "" }; assignedFallback = true; }
      }
      // BUILD-76 Part 7 (D.3 §2) — the default owner-alert title carries the
      // donor's context: lifetime and last gift, so the officer can pick up
      // the phone without opening the record first. An explicit action.title
      // (the new recipes) wins and is placeholder-filled.
      const lifetime = donor && Number(donor.total_giving) > 0 ? `$${Number(donor.total_giving).toLocaleString()} lifetime` : null;
      const lastGift = donor?.last_gift_date ? `last gift ${orgTime.formatCivil(String(donor.last_gift_date).slice(0, 10))}` : null;
      const donorCtxStr = [lifetime, lastGift].filter(Boolean).join(", ");
      const title = action.title
        ? fill(action.title)
        : isOwner
          ? `Stewardship alert: ${donor?.name || "a major donor"} gave ${amtStr || "a major gift"}${donorCtxStr ? ` (${donorCtxStr})` : ""}`
          : "Follow up";
      const due = action.dueDays != null ? new Date(Date.now() + action.dueDays * 86400000).toISOString().slice(0, 10) : "";
      const taskId = newId("t");
      // FIX-10 Part C — stamped with the gift whose arrival made this task, so
      // deleting that gift can void it and leave every hand-typed task alone.
      await run(
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,source_gift_id) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW(),?,?,?)",
        [taskId, org.id, title, due, action.priority || "medium", donor?.id || null, owner?.id || null, owner?.name || null, wfActor.id, wfActor.name, ctx.giftId || null]
      );
      // BUILD-36 A2/A4: a workflow that assigns a task to someone emails them.
      // For a gift-fired workflow the event key is the gift, so this collapses
      // with gift-notify (one email per person per gift). notify_owner is the
      // "major-gift owner alert" A4 names explicitly.
      if (owner?.id) {
        await notifyTaskAssignment(
          { id: taskId, org_id: org.id, title, due, donor_id: donor?.id || null, assigned_to: owner.id, assigned_to_name: owner.name, source_gift_id: ctx.giftId || null },
          { org, actorUserId: null, eventKey: ctx.giftId ? `gift:${ctx.giftId}` : `taskwf:${taskId}` }
        ).catch(e => console.error("[workflow] task-assign email:", e.message));
      }
      return { type: action.type, taskId, title, ...(isOwner ? { assignedTo: owner?.id || null, assignedFallback } : {}) };
    }
    case "notify_gift": {
      // Resolve who to notify: ED = org admins, owner = the donor's assigned
      // officer. config.notify ∈ ed|owner|both (default both).
      const mode = ["ed", "owner", "both"].includes(config.notify) ? config.notify : "both";
      const wantEd = mode === "ed" || mode === "both";
      const wantOwner = mode === "owner" || mode === "both";
      const recipients = []; // { id, name, email }
      const seen = new Set();
      const push = u => { if (u && u.id && !seen.has(u.id)) { seen.add(u.id); recipients.push(u); } };
      let owner = null;
      if (wantOwner && donor?.assigned_to) {
        const or = await query("SELECT id, name, email FROM users WHERE id=? AND org_id=?", [donor.assigned_to, org.id]);
        if (or.length) { owner = or[0]; push(or[0]); }
      }
      if (wantEd) {
        const admins = await query("SELECT id, name, email FROM users WHERE org_id=? AND role='admin' ORDER BY created_at ASC", [org.id]);
        admins.forEach(push);
      }
      // The task lands with whoever should own the thank-you: the assigned
      // officer if there is one, else the first admin (the ED).
      const taskOwner = owner || recipients[0] || null;
      const title = `Thank ${donor?.name || "a donor"} · ${amtStr || "a gift"} just came in`;
      const due = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
      const taskId = newId("t");
      // FIX-10 Part C — the "just came in" task, stamped with its gift.
      await run(
        "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,updated_at,created_by,created_by_name,source_gift_id) VALUES (?,?,?,?,?,'donor',0,?,?,?,NOW(),?,?,?)",
        [taskId, org.id, title, due, "high", donor?.id || null, taskOwner?.id || null, taskOwner?.name || null, wfActor.id, wfActor.name, ctx.giftId || null]
      );
      // Email each distinct recipient (internal, no donor footer).
      // THREAD-2 · the person and the gift are links, and the button opens her.
      const L = await ItemRefs.links(), base = publicAppUrl();
      const person = donor ? { kind: "person", id: donor.id, name: donor.name, email: donor.email } : null;
      const giftLink = ctx.giftId && donor ? L.refLinkHtml({ kind: "gift", id: ctx.giftId, donorId: donor.id }, base, { label: amtStr || "a gift" }) : escHtmlWf(amtStr || "a gift");
      const emailBody = `<p>A gift just came in, a good moment to say thank you.</p>
<p style="font-size:16px"><strong>${person ? L.refLinkHtml(person, base) : "A donor"}</strong> gave <strong>${giftLink}</strong> to ${escHtmlWf(displayNameCase(org.name))}.</p>
<p>Send a thank-you while it's fresh, a fast, personal thank-you is the single biggest driver of a donor giving again.</p>
${person ? L.refButtonHtml(person, base) : ""}`;
      // BUILD-36 A4: route through notifyUserOnce — respects the recipient's
      // per-user toggle AND dedups per gift event, so this gift-notify and the
      // major-gift owner alert never both email the same person for one gift.
      const giftEventKey = ctx.giftId ? `gift:${ctx.giftId}` : `giftnotify:${ctx.dedupKey}`;
      for (const r of recipients) {
        if (r.email) await notifyUserOnce({
          org, userId: r.id, email: r.email, eventKey: giftEventKey, channel: "gift",
          prefKind: "portfolio_gifts",
          subject: `New gift: ${donor ? L.nameOrFallback(donor.name, donor.email) : "a donor"} gave ${amtStr || "a gift"}`, bodyHtml: emailBody,
        });
      }
      return { type: "notify_gift", taskId, notified: recipients.map(r => r.name || r.email).filter(Boolean), mode };
    }
    case "add_tag": {
      if (!donor?.id) return null;
      const tags = asJson(donor.tags, []);
      if (!tags.includes(action.tag)) {
        tags.push(action.tag);
        await run("UPDATE donors SET tags=?, updated_at=NOW() WHERE id=? AND org_id=?", [JSON.stringify(tags), donor.id, org.id]);
      }
      return { type: "add_tag", tag: action.tag };
    }
    // FIX-12 Part 2 — STEWARD DRAFTS IT. YOU SEND IT. A recipe never emails a
    // donor. Its words land in the drafts queue (Communications → Drafts to
    // review), where a person reads, edits and sends each one. `send_email` is
    // the type every recipe row saved before FIX-12 carries; it is handled here
    // as a draft too, so an org whose row was not yet migrated cannot send.
    // Nothing in this branch may call a mail function.
    case "send_email":
    case "draft_email": {
      if (!donor) return null;
      const orgName = displayNameCase(org.name);
      const hi = await openingLine(donor, "Hi");   // POLISH-4
      const DRAFTS = {
        recovery: [`About your monthly gift to ${orgName}`,
          `${hi}\n\nYour monthly gift to ${orgName} didn't go through this time. It happens, usually because a card expired or was replaced. ${org.recurring_dunning_enabled === false ? "If you reply, I'll send you a secure link to update your card." : "We have sent you a separate email with a secure link to update your card."}\n\nThank you for giving every month. It makes a real difference, and if there's anything I can help with, just reply.\n\nWith thanks,\n${orgName}`],
        thankyou: [`Thank you from ${orgName}`,
          `${hi}\n\nThank you for your first gift to ${orgName}, and welcome. Gifts like yours are what make our work possible, and we're so glad you're part of it.\n\nYou'll hear from a real person here soon. In the meantime, just reply if there's anything you'd like to know.\n\nWith gratitude,\n${orgName}`],
        reengage: [`We've missed you at ${orgName}`,
          `${hi}\n\nIt's been a while, and we've missed you at ${orgName}. Your past support made a real difference, and there's more good work ahead we'd love for you to be part of.\n\nIf now's a good time to come back, we'd be grateful. And if not, thank you all the same.\n\nWarmly,\n${orgName}`],
      };
      const tpl = DRAFTS[action.template];
      if (!tpl) return null;
      const draftId = newId("md");
      await run(
        `INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,workflow_run_id,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,'pending_review',?,?,?,?)`,
        [draftId, org.id, donor.id, `workflow:${recipeKey}:${action.template}`, tpl[0], tpl[1],
         `workflow:${recipeKey}`, ctx.runId || null, wfActor.id, wfActor.name]);
      return { type: "draft_email", template: action.template, draftId, sent: false };
    }
    default:
      return null;
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 575

// Fire all enabled workflows for (org, trigger). ctx: { dedupKey, donorId,
// giftId, amount, isFirstGift, subscriptionRow, entityType, entityId,
// extraActions }. Idempotent per (workflow, dedupKey). Returns what ran so a
// caller (the dunning webhook) can coordinate — e.g. avoid a double day-0 send.
async function fireWorkflows(orgId, trigger, ctx) {
  const wfs = await query("SELECT * FROM workflows WHERE org_id=? AND trigger=? AND enabled=true", [orgId, trigger]);
  const ran = [];
  if (!wfs.length) return { ran };
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ran };
  const donorRows = ctx.donorId ? await query("SELECT * FROM donors WHERE id=? AND org_id=?", [ctx.donorId, orgId]) : [];
  const donor = donorRows[0] || null;

  for (const wf of wfs) {
    const conditions = asJson(wf.conditions, []);
    let actions = asJson(wf.actions, []);
    const config = asJson(wf.config, {});
    if (!workflowConditionsPass(conditions, config, ctx)) continue;
    // Config can toggle the optional re-engagement DRAFT on the lapse recipe
    // (the config key keeps its old name, sendEmail, so saved settings carry over).
    if (wf.recipe_key === "lapsing_reengage" && config.sendEmail && !actions.some(a => a.type === "send_email" || a.type === "draft_email")) {
      actions = [...actions, { type: "draft_email", template: "reengage" }];
    }

    // Reserve the run row FIRST — the unique (workflow_id, dedup_key) makes a
    // redelivered event a no-op (RETURNING is empty on conflict).
    const runId = newId("wfr");
    const reserved = await query(
      `INSERT INTO workflow_runs (id,org_id,workflow_id,recipe_key,trigger,dedup_key,entity_type,entity_id,donor_id,actions_taken)
       VALUES (?,?,?,?,?,?,?,?,?,'[]')
       ON CONFLICT (workflow_id,dedup_key) DO NOTHING
       RETURNING id`,
      [runId, orgId, wf.id, wf.recipe_key, trigger, ctx.dedupKey, ctx.entityType || null, ctx.entityId || null, ctx.donorId || null]
    );
    if (!reserved.length) continue; // already ran for this event

    const taken = [];
    for (const a of actions) {
      try { const res = await runWorkflowAction(a, { org, donor, ctx: { ...ctx, runId }, config, recipeKey: wf.recipe_key }); if (res) taken.push(res); }
      catch (e) { console.error(`[workflow:${wf.recipe_key}] action ${a.type} failed:`, e.message); }
    }
    await run("UPDATE workflow_runs SET actions_taken=? WHERE id=?", [JSON.stringify(taken), runId]);
    ran.push({ workflowId: wf.id, recipeKey: wf.recipe_key, actions: taken });
  }
  return { ran };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 576

// Scheduled sweep for the donor_lapsed trigger (no webhook fires it). Runs on
// the existing 5-min tick. Only touches orgs that have the recipe enabled;
// dedup is per donor + their current last_gift_date so a given lapse fires once.
// Optional onlyOrgId scopes the sweep to one org (the ops/test trigger route).
async function processWorkflowSweeps(onlyOrgId = null) {
  // FIX-49 · a recipe switched on since the last pass becomes its journey
  // first, so a converted recipe never fires again from here.
  await require("../../workflowsToJourneys").convertWorkflows(onlyOrgId).catch(e => console.error("[workflows-to-journeys]", e.message));
  const orgRows = onlyOrgId
    ? await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_lapsed' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_lapsed' AND enabled=true");
  for (const { org_id: orgId } of orgRows) {
    try {
      const wfRows = await query("SELECT config FROM workflows WHERE org_id=? AND recipe_key='lapsing_reengage' AND enabled=true", [orgId]);
      const lapseDays = Number(asJson(wfRows[0]?.config, {}).lapseDays ?? 365);
      const cutoff = new Date(Date.now() - lapseDays * 86400000).toISOString().slice(0, 10);
      // BUILD-25 A0 (P0): the lapse sweep fires ONLY for a lapse that crossed the
      // window WHILE the donor was live in Steward — never for a historical record
      // imported (or backfilled) already-lapsed. A donor whose last gift predates
      // their own created_at by more than the lapse window was loaded already-past
      // the boundary; that is history, not a live event, so it must not blast a
      // re-engagement email/task. The crossing date = last_gift_date + lapseDays;
      // we fire only when that date is on/after created_at (the transition happened
      // in-system). A donor imported while still active who later crosses the
      // window DOES fire — that's a genuine live transition. This is the
      // "recipes act on new live events, not records being loaded" guarantee,
      // enforced in SQL so no import path can slip past it.
      const lapsing = await query(
        `SELECT id, last_gift_date FROM donors d
          WHERE org_id=? AND deleted_at IS NULL AND gift_count > 0
            AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.imported_sustainer IS NOT TRUE
            AND last_gift_date IS NOT NULL AND last_gift_date <> '' AND last_gift_date < ?
            AND created_at::date <= (last_gift_date::date + INTERVAL '${parseInt(lapseDays, 10)} days')
          LIMIT 200`,
        [orgId, cutoff]
      );
      for (const d of lapsing) {
        await fireWorkflows(orgId, "donor_lapsed", {
          dedupKey: `lapsed:${d.id}:${d.last_gift_date}`,
          donorId: d.id, entityType: "donor", entityId: d.id,
        });
      }
    } catch (e) { console.error("[workflow-sweep] org", orgId, e.message); }
  }

  // ── BUILD-76 Part 7 — quiet_past_pattern: THE drift engine, as a trigger ──
  // Not a second definition: the sweep reads computeDriftForDonors (the same
  // one function the home list and every badge read). High confidence only —
  // an officer sent to call for a wrong reason once discounts the list
  // forever. Dedup per (donor, last_gift_date): one drift episode fires once;
  // a new gift starts a new episode. The BUILD-25 live-transition guarantee:
  // the drift must have STARTED on/after the donor's created_at — a file
  // imported already-drifting is history, not an event.
  const driftOrgRows = onlyOrgId
    ? await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_drifting' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT DISTINCT org_id FROM workflows WHERE trigger='donor_drifting' AND enabled=true");
  for (const { org_id: orgId } of driftOrgRows) {
    try {
      const { map } = await computeDriftForDonors(orgId);
      let fired = 0;
      for (const a of map.values()) {
        if (fired >= 200) break;   // same per-sweep cap as the lapse sweep
        if (a.state !== "drifting" || a.confidence !== "high") continue;
        if (!a.driftStartDate || !a.donorCreatedDate) continue;
        if (orgTime.compareCivil(a.driftStartDate, a.donorCreatedDate) < 0) continue; // drifted before we ever knew them — history, not an event
        await fireWorkflows(orgId, "donor_drifting", {
          dedupKey: `drift:${a.donorId}:${a.lastGiftDate}`,
          donorId: a.donorId, entityType: "donor", entityId: a.donorId,
          reason: a.reason,
        });
        fired++;
      }
    } catch (e) { console.error("[workflow-sweep drift] org", orgId, e.message); }
  }

  // ── BUILD-76 Part 7 — pledge_due_soon: a task leadDays before due ────────
  // Open pledges only (status='open' IS "remaining balance > 0" — the
  // partial-payment recompute keeps that true), inside [today, today+lead]
  // on the ORG's calendar. Dedup per (pledge, due_date). Task only — the
  // donor-facing pledge reminder machinery is separate and untouched (C.2).
  const pledgeOrgRows = onlyOrgId
    ? await query("SELECT org_id, config FROM workflows WHERE trigger='pledge_due' AND enabled=true AND org_id=?", [onlyOrgId])
    : await query("SELECT org_id, config FROM workflows WHERE trigger='pledge_due' AND enabled=true");
  for (const { org_id: orgId, config } of pledgeOrgRows) {
    try {
      const leadDays = Math.max(1, parseInt(asJson(config, {}).leadDays, 10) || 14);
      const org = await orgTz(orgId);
      const todayStr = orgToday(org);                                  // ORG_TZ_SEAM_OK
      const horizon = orgTime.addDays(todayStr, leadDays);
      const due = await query(
        `SELECT p.id, p.donor_id, p.amount, p.due_date,
                COALESCE(${require("../../shared/numbers/pledges").PAID_OF("p")}, 0) AS paid
           FROM pledges p
          WHERE p.org_id = ? AND p.status = 'open'
            AND p.due_date >= ? AND p.due_date <= ?
            AND p.import_id IS NULL   -- SEND-GATE-1: an import fires no trigger
          LIMIT 200`,
        [orgId, todayStr, horizon]);
      for (const p of due) {
        const remaining = Math.max(0, (parseFloat(p.amount) || 0) - (parseFloat(p.paid) || 0));
        if (remaining <= 0) continue;
        await fireWorkflows(orgId, "pledge_due", {
          dedupKey: `pledgedue:${p.id}:${p.due_date}`,
          donorId: p.donor_id, entityType: "pledge", entityId: p.id,
          amount: remaining, dueDate: String(p.due_date).slice(0, 10),
        });
      }
    } catch (e) { console.error("[workflow-sweep pledge] org", orgId, e.message); }
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 578

// ── Recurring gift recovery: staff-facing routes ────────────────────────────
// ── BUILD-83 Part 5.1 — ONE DEFINITION OF THE FILE'S OWN SUSTAINER FACTS. ──
// Home, the Recurring tab's headline, its exception tiles and the setup
// checklist all read THIS. Before it, Home said "100 stopped" while the tab
// said "160" and "0 giving" on the same file — three code paths for one fact,
// which is the thing this build forbids.
//   fromFile  every sustainer the org's own file names
//   stopped   the ones who have stopped giving: a failed card OR a "still
//             Active" claim the gift pattern contradicts (the file's Status
//             column is stale; the pattern is the truth — BUILD-82 Part 5)
//   giving    the rest. Connection to a payment method HERE is a separate axis.
async function sustainerFileFacts(orgId, today) {
  // ONE definition of "stopped giving": a monthly donor whose giving has
  // actually stopped — their last sustainer gift is older than the window — or
  // whom the file itself flags as stopped (a failed card, or a "still Active"
  // claim the gift pattern contradicts). The two halves agree on real files;
  // keeping both means neither a flagless silence nor a flagged-but-recent row
  // can slip past. STOPPED_DAYS is the same 60-day window /recurring/unlinked
  // has always used.
  const STOPPED_DAYS = 60;
  const cutoff = orgTime.addDays(today || orgToday(await orgTz(orgId)), -STOPPED_DAYS);   // ORG_TZ_SEAM_OK
  const STOPPED_SQL = `(COALESCE(tags::text,'') LIKE '%card-failed%'
                     OR COALESCE(tags::text,'') LIKE '%stale-frequency%'
                     OR (imported_sustainer_last_gift IS NOT NULL AND imported_sustainer_last_gift < ?))`;
  const rows = await query(
    `SELECT COUNT(*)::int AS from_file,
            COUNT(*) FILTER (WHERE ${STOPPED_SQL})::int AS stopped,
            COUNT(*) FILTER (WHERE stripe_subscription_id IS NOT NULL)::int AS connected,
            COUNT(*) FILTER (WHERE ${STOPPED_SQL} AND COALESCE(email,'') = '')::int AS stopped_no_email
       FROM donors WHERE org_id=? AND deleted_at IS NULL AND imported_sustainer IS TRUE`,
    [cutoff, cutoff, orgId]);
  const f = rows[0] || {};
  const fromFile = f.from_file || 0, stopped = f.stopped || 0;
  return { fromFile, stopped, giving: Math.max(0, fromFile - stopped),
           connected: f.connected || 0, stoppedWithoutEmail: f.stopped_no_email || 0 };
}
// SPLIT-2 end

__share({ autoEnroll, sequenceMergeValues, sequenceStopFor, sequenceTimezoneGate, orgSendClock, enrollInSequences, sendStaffWrittenEmail, staffWrittenMissing, processTrackedSequences, advanceEnrollment, closeEnrollment, processDunning, refreshCardsOnFile, expiringCardRows, notifyExpiringCards, ensureWorkflows, workflowConditionsPass, notifyUserOnce, sendDonorLifecycleEmail, refreshNotifyFailedCount, retryFailedNotifications, reconcileStripeVsGifts, checkWebhookSubscriptions, notifyTaskAssignment, provisionNewOrgWorkflows, runWorkflowAction, fireWorkflows, processWorkflowSweeps, sustainerFileFacts });
