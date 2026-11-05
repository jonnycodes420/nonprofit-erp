// SPLIT-2: moved VERBATIM from server.js (its functions from lines 9319-10773). server.js requires the boot modules in
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
let AFTER, AGENT_TRIAL_PLAN_ALLOWANCE, APIC, CAL_FULL_EVERY_MS, CANCEL_LINK_DAYS, CLIENT_SAFE, GMAIL_BASE, GRAPH_BASE, GRAPH_DELTA_FULL_MS, MBF, MONTHS_OVER_BEFORE_NOTE, PLAN_LIMITS, PLAN_PRICE_ENV, PLEDGE_REMINDER_SCHEDULE_DAYS, PRICING, PUSH_AHEAD_DAYS, PUSH_TYPES, RECOVERY_SECRET, SEALED_MAIL, SOFT_BAND_PLANS, SYNC_STALE_MS, TIER_NOTICE_DAYS, _logOutboundEmail, backedOff, billingConfigError, billingModeStatus, billingStripe, billingStripeMode, closePlan, closeThreadStepForContact, crypto, escapeHtml, fetchMailboxAttachments, firstChargeSentence, formatChargeDate, gmailToMessage, graphDeltaStart, graphToMessage, isReminderDue, mailPolicy, mailRefusal, mailboxSyncHealth, newId, orgTime, orgToday, orgTz, orgTzName, planAmountUsd, processUnansweredMail, providerFetch, publicAppUrl, query, resend, run, sendPledgeReminderEmail, syncLockKey, trialReminderEmailHtml, withTryAdvisoryLock;
__boot.register(c => {
  if ("AFTER" in c) AFTER = c.AFTER;
  if ("AGENT_TRIAL_PLAN_ALLOWANCE" in c) AGENT_TRIAL_PLAN_ALLOWANCE = c.AGENT_TRIAL_PLAN_ALLOWANCE;
  if ("APIC" in c) APIC = c.APIC;
  if ("CAL_FULL_EVERY_MS" in c) CAL_FULL_EVERY_MS = c.CAL_FULL_EVERY_MS;
  if ("CANCEL_LINK_DAYS" in c) CANCEL_LINK_DAYS = c.CANCEL_LINK_DAYS;
  if ("CLIENT_SAFE" in c) CLIENT_SAFE = c.CLIENT_SAFE;
  if ("GMAIL_BASE" in c) GMAIL_BASE = c.GMAIL_BASE;
  if ("GRAPH_BASE" in c) GRAPH_BASE = c.GRAPH_BASE;
  if ("GRAPH_DELTA_FULL_MS" in c) GRAPH_DELTA_FULL_MS = c.GRAPH_DELTA_FULL_MS;
  if ("MBF" in c) MBF = c.MBF;
  if ("MONTHS_OVER_BEFORE_NOTE" in c) MONTHS_OVER_BEFORE_NOTE = c.MONTHS_OVER_BEFORE_NOTE;
  if ("PLAN_LIMITS" in c) PLAN_LIMITS = c.PLAN_LIMITS;
  if ("PLAN_PRICE_ENV" in c) PLAN_PRICE_ENV = c.PLAN_PRICE_ENV;
  if ("PLEDGE_REMINDER_SCHEDULE_DAYS" in c) PLEDGE_REMINDER_SCHEDULE_DAYS = c.PLEDGE_REMINDER_SCHEDULE_DAYS;
  if ("PRICING" in c) PRICING = c.PRICING;
  if ("PUSH_AHEAD_DAYS" in c) PUSH_AHEAD_DAYS = c.PUSH_AHEAD_DAYS;
  if ("PUSH_TYPES" in c) PUSH_TYPES = c.PUSH_TYPES;
  if ("RECOVERY_SECRET" in c) RECOVERY_SECRET = c.RECOVERY_SECRET;
  if ("SEALED_MAIL" in c) SEALED_MAIL = c.SEALED_MAIL;
  if ("SOFT_BAND_PLANS" in c) SOFT_BAND_PLANS = c.SOFT_BAND_PLANS;
  if ("SYNC_STALE_MS" in c) SYNC_STALE_MS = c.SYNC_STALE_MS;
  if ("TIER_NOTICE_DAYS" in c) TIER_NOTICE_DAYS = c.TIER_NOTICE_DAYS;
  if ("_logOutboundEmail" in c) _logOutboundEmail = c._logOutboundEmail;
  if ("backedOff" in c) backedOff = c.backedOff;
  if ("billingConfigError" in c) billingConfigError = c.billingConfigError;
  if ("billingModeStatus" in c) billingModeStatus = c.billingModeStatus;
  if ("billingStripe" in c) billingStripe = c.billingStripe;
  if ("billingStripeMode" in c) billingStripeMode = c.billingStripeMode;
  if ("closePlan" in c) closePlan = c.closePlan;
  if ("closeThreadStepForContact" in c) closeThreadStepForContact = c.closeThreadStepForContact;
  if ("crypto" in c) crypto = c.crypto;
  if ("escapeHtml" in c) escapeHtml = c.escapeHtml;
  if ("fetchMailboxAttachments" in c) fetchMailboxAttachments = c.fetchMailboxAttachments;
  if ("firstChargeSentence" in c) firstChargeSentence = c.firstChargeSentence;
  if ("formatChargeDate" in c) formatChargeDate = c.formatChargeDate;
  if ("gmailToMessage" in c) gmailToMessage = c.gmailToMessage;
  if ("graphDeltaStart" in c) graphDeltaStart = c.graphDeltaStart;
  if ("graphToMessage" in c) graphToMessage = c.graphToMessage;
  if ("isReminderDue" in c) isReminderDue = c.isReminderDue;
  if ("mailPolicy" in c) mailPolicy = c.mailPolicy;
  if ("mailRefusal" in c) mailRefusal = c.mailRefusal;
  if ("mailboxSyncHealth" in c) mailboxSyncHealth = c.mailboxSyncHealth;
  if ("newId" in c) newId = c.newId;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("orgTzName" in c) orgTzName = c.orgTzName;
  if ("planAmountUsd" in c) planAmountUsd = c.planAmountUsd;
  if ("processUnansweredMail" in c) processUnansweredMail = c.processUnansweredMail;
  if ("providerFetch" in c) providerFetch = c.providerFetch;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("resend" in c) resend = c.resend;
  if ("run" in c) run = c.run;
  if ("sendPledgeReminderEmail" in c) sendPledgeReminderEmail = c.sendPledgeReminderEmail;
  if ("syncLockKey" in c) syncLockKey = c.syncLockKey;
  if ("trialReminderEmailHtml" in c) trialReminderEmailHtml = c.trialReminderEmailHtml;
  if ("withTryAdvisoryLock" in c) withTryAdvisoryLock = c.withTryAdvisoryLock;
});

// SPLIT-2 server.js piece 578

async function processPledgeReminders({ orgId = null } = {}) {   // TRUST-1: a request passes its org; only the hourly job runs all orgs
  const picked = [];
  try {
    // Step 1 — the trigger. Recurring dunning's cadence is initialized by a
    // Stripe webhook (invoice.payment_failed); a pledge due date has no
    // equivalent external event, so this scan IS the trigger: any open
    // pledge whose due date has just passed starts its cadence at "day 0"
    // (fires immediately, same as a fresh payment failure does).
    // ORG_TZ_SEAM_OK — "the due date has passed" is a comparison of TWO CIVIL
    // DATES in the org's own calendar. CURRENT_DATE is the Postgres session
    // zone, so a pledge in a western org used to start its dunning cadence
    // hours early — a reminder email about money, sent on the wrong day.
    const _overdueOrgs = await query(`SELECT id, timezone FROM orgs${orgId ? " WHERE id = ?" : ""}`, orgId ? [orgId] : []);
    for (const _o of _overdueOrgs) {
      await run(
        `UPDATE pledges SET first_overdue_at=NOW(), next_reminder_at=NOW(), updated_at=NOW()
         WHERE org_id=? AND status='open' AND first_overdue_at IS NULL AND due_date::date < ?::date
           AND COALESCE(is_match,false) = false`,
        [_o.id, orgToday(_o)]
      );
    }

    // Step 2 — send whatever's due, exactly like processDunning().
    // FIX-45: a demo org's pledges and a sample person's are never picked:
    // the mail gate used to refuse them every hour, forever (orgSendsSql).
    const rows = await query(
      `SELECT p.*, d.name AS donor_name, d.email AS donor_email
       FROM pledges p
       JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
       JOIN orgs o ON o.id = p.org_id
       WHERE p.status = 'open' AND p.next_reminder_at <= NOW()
         AND COALESCE(p.is_match,false) = false
         AND p.import_id IS NULL   -- SEND-GATE-1: an imported pledge is never reminded
         AND d.is_sample IS NOT TRUE AND d.deleted_at IS NULL
         AND ${mailPolicy.orgSendsSql("o")}${orgId ? " AND p.org_id = ?" : ""}`, orgId ? [orgId] : []
    );
    picked.push(...rows.map(p => ({ orgId: p.org_id, pledgeId: p.id })));
    for (const p of rows) {
      try {
        const orgRows = await query(
          "SELECT id, name, org_slug, pledge_reminder_enabled, pledge_reminder_subject, pledge_reminder_body FROM orgs WHERE id=?",
          [p.org_id]
        );
        const org = orgRows[0];
        if (!org) continue;
        // Org turned this off — leave the cadence/step where it is (so it
        // picks back up correctly if re-enabled) but don't send.
        if (org.pledge_reminder_enabled === false) continue;

        // FIX-15 Part 3: no "Pledge reminder sent" line, and no step forward,
        // for a reminder that did not go.
        // FIX-48: and a refusal is not an outage. A reminder Resend refused,
        // or one this person will never get (a hard bounce, unsubscribed,
        // deceased, no address), is marked failed with its reason ONCE, in the
        // send log and on the pledge, and never tried again. Only an outage is
        // retried, and then a day later, not on every hourly tick. The org's
        // own mail being off is neither: the reminder waits for it.
        const r = p.donor_email
          ? await sendPledgeReminderEmail(org, { name: p.donor_name, email: p.donor_email }, p)
          : { sent: false, refused: "no_email", error: null };
        if (!r.sent) {
          const kind = r.refused ? mailRefusal.classifyDecision(r.refused) : mailRefusal.classifyProviderError(r.error);
          if (kind === "wait") continue;
          const why = r.refused || mailRefusal.reasonText(r.error);
          if (kind === "permanent") {
            await run(`UPDATE pledges SET reminder_failed_at=NOW(), reminder_error=?, next_reminder_at=NULL, updated_at=NOW() WHERE id=?`, [why, p.id]);
            // A provider refusal is already in the send log (the client proxy
            // writes it); a refusal decided here never reached the provider.
            if (r.refused) await _logOutboundEmail({ to: p.donor_email || "", _stewardOrgId: p.org_id, _stewardKind: "pledge_reminder", subject: "Pledge reminder" }, null, { message: "refused: " + why }, "failed");
            console.error(`[pledge-reminder] ${p.id} failed for good: ${why}`);
          } else {
            await run(`UPDATE pledges SET reminder_error=?, next_reminder_at=NOW() + INTERVAL '1 day', updated_at=NOW() WHERE id=?`, [why, p.id]);
          }
          continue;
        }
        if (p.reminder_error) await run(`UPDATE pledges SET reminder_error=NULL WHERE id=?`, [p.id]);
        await run(
          "INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata) VALUES (?,?,?,?,?,?,?)",
          [newId("int"), p.org_id, p.donor_id, "pledge_reminder",
           `Pledge reminder sent · $${Number(p.amount).toLocaleString()} pledge due ${orgTime.civilLocale(p.due_date, { month: "short", day: "numeric", year: "numeric" })}`,
           orgToday(await orgTz(p.org_id)), JSON.stringify({ pledge_id: p.id, step: p.reminder_step })]   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
        );

        const nextStep = p.reminder_step + 1;
        const nextDelayDays = PLEDGE_REMINDER_SCHEDULE_DAYS[nextStep];
        const nextReminderAt = nextDelayDays != null
          ? new Date(new Date(p.first_overdue_at).getTime() + nextDelayDays * 86400000).toISOString()
          : null; // exhausted the cadence — stop sending; stays 'open' until fulfilled/written off manually
        await run(
          `UPDATE pledges SET reminder_step=?, next_reminder_at=?, updated_at=NOW() WHERE id=?`,
          [nextStep, nextReminderAt, p.id]
        );
      } catch (e) { console.error("[pledge-reminder] pledge", p.id, e.message); }
    }
  } catch (e) { console.error("[pledge-reminder] processPledgeReminders:", e.message); }
  return { picked };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 579

// ── Billing helpers ────────────────────────────────────────────────────────
function trialCanceled(org) {
  const status = org.subscription_status || "";
  if (status !== "canceled" && status !== "cancelled") return false;
  const end = org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : null;
  return !!end && end > Date.now();
}
// SPLIT-2 end
// SPLIT-2 server.js piece 580
function getOrgAccessState(org) {
  const status = org.subscription_status || "trialing";
  const now = Date.now();
  const graceUntil = org.grace_until ? new Date(org.grace_until).getTime() : null;
  if (status === "active" || status === "trialing") return "full";
  // FIX-32: cancelled inside the free thirty days: nothing was charged and
  // nothing is taken away until the trial's own end date.
  if (trialCanceled(org)) return "full";
  if (status === "past_due" || status === "canceled" || status === "cancelled") {
    if (graceUntil && now < graceUntil) return "warning";
    return "read_only";
  }
  if (status === "trial_expired") return "read_only";
  return "full";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 581

async function checkWriteAccess(req, res, next) {
  try {
    const orgs = await query("SELECT subscription_status, grace_until, trial_ends_at FROM orgs WHERE id=?", [req.user.orgId]);
    if (orgs.length && getOrgAccessState(orgs[0]) === "read_only") {
      return res.status(402).json({ error: "subscription_required", message: "Your account is in read-only mode. Reactivate your subscription to make changes." });
    }
  } catch (e) { console.error("checkWriteAccess error:", e); }
  next();
}
// SPLIT-2 end
// SPLIT-2 server.js piece 582

// ── Billing ────────────────────────────────────────────────────────────────

// The orgs column that holds the platform billing customer for the CURRENT
// Stripe mode. A customer created in test mode doesn't exist under a live key
// (and vice-versa), so each mode gets its own column — stripe_customer_id is the
// LIVE customer (existing prod values are live), stripe_customer_id_test the
// test one. Never overwrite the other mode's column.
function billingCustomerColumn() {
  return billingStripeMode() === "test" ? "stripe_customer_id_test" : "stripe_customer_id";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 584

async function checkBillingPriceModes() {
  const mode = billingStripeMode();
  const configured = Object.entries(PLAN_PRICE_ENV)
    .map(([plan, envName]) => ({ plan, envName, id: process.env[envName] }))
    .filter(p => p.id);
  const status = { mode, checked: false, ok: null, prices: [], checkedAt: new Date().toISOString() };
  if (!billingStripe || !mode || !configured.length) { billingModeStatus = status; __share({ billingModeStatus }); return status; }
  status.checked = true;
  let anyMismatch = false;
  for (const p of configured) {
    try {
      await billingStripe.prices.retrieve(p.id);
      status.prices.push({ plan: p.plan, env: p.envName, ok: true });
    } catch (err) {
      const cls = billingConfigError(err);
      const reason = cls ? cls.type : (err.code || err.type || "error");
      if (cls) anyMismatch = true;               // resource_missing on the price = wrong mode / bad id
      status.prices.push({ plan: p.plan, env: p.envName, ok: false, reason });
    }
  }
  status.ok = !anyMismatch;
  billingModeStatus = status; __share({ billingModeStatus });
  return status;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 585

// Run the check once shortly after boot (non-blocking) and log loudly on a mismatch.
function scheduleBillingModeCheck() {
  if (!billingStripe) return;
  setTimeout(() => {
    checkBillingPriceModes().then(s => {
      if (!s.checked) return;
      if (s.ok) {
        console.log(`[billing] mode check OK — billing key is ${String(s.mode).toUpperCase()}; all ${s.prices.length} configured price(s) resolve.`);
      } else {
        const bad = s.prices.filter(p => !p.ok).map(p => `${p.env} (${p.reason})`).join(", ");
        console.error(
          `[billing] ============================================================\n` +
          `[billing] MODE MISMATCH: billing key is ${String(s.mode).toUpperCase()} but these ` +
          `price ids do NOT resolve in that mode: ${bad}.\n` +
          `[billing] Align STRIPE_BILLING_SECRET_KEY, the STRIPE_PRICE_* ids, the billing ` +
          `webhook secret, and the Customer Portal config to the SAME Stripe mode, or upgrades will fail.\n` +
          `[billing] ============================================================`
        );
      }
    }).catch(e => console.error("[billing] mode check failed:", e && e.message));
  }, 8000);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 590
function signCancelToken(orgId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ cancelOrgId: orgId, exp: now + CANCEL_LINK_DAYS * 86400000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update("cancel:" + payload).digest("base64url");
  return `${payload}.${sig}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 592

async function agentTrialAllowance(orgId) {
  const [org] = await query("SELECT subscription_status FROM orgs WHERE id=?", [orgId]);
  const status = (org && org.subscription_status) || "trialing";
  // Anything that is not still trialing is a paying (or formerly paying) org:
  // active, past_due, canceled. Only the free window is capped.
  if (status !== "trialing") return { capped: false, status };
  const [row] = await query("SELECT COUNT(*)::int AS c FROM agent_instructions WHERE org_id=?", [orgId]);
  const used = Number(row && row.c) || 0;
  return {
    capped: true, status, used, allowance: AGENT_TRIAL_PLAN_ALLOWANCE,
    left: Math.max(0, AGENT_TRIAL_PLAN_ALLOWANCE - used),
    exhausted: used >= AGENT_TRIAL_PLAN_ALLOWANCE,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 593

// ── PRICING-1 · RECORDS, AND THE BAND THEY PUT YOU IN ─────────────────────
//
// THE COUNT IS THE SENTENCE ON SIGNUP AND BILLING, IN SQL. `pricing.json`'s
// recordSentence says "a person or organization with at least one gift", and
// this is that and nothing else: a DISTINCT non-deleted donor row with at
// least one gift, any date. Prospects, volunteers and contacts with no gift
// never count. Four gifts from one person is one record.
async function countRecords(orgId) {
  const [row] = await query(
    `SELECT COUNT(*) AS c FROM donors d
      WHERE d.org_id = ? AND d.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = d.id AND g.org_id = d.org_id)`,
    [orgId]);
  return Number(row && row.c) || 0;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 594

// The band an org is PAYING for, read off its plan. A legacy plan (core, team,
// founding, and the GTM-1a t-bands) has no band in this catalogue and is never
// told it is over one: inventing a band for them would be inventing a bill.
function bandOfPlan(plan) {
  const id = String(plan || "");
  if (!id.includes("_")) return null;
  return PRICING.tierById(id.split("_")[0]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 597

// "2026-10" for an instant, in the org's own zone.
function monthKey(now, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/New_York", year: "numeric", month: "2-digit" })
      .formatToParts(new Date(now));
    return parts.find(p => p.type === "year").value + "-" + parts.find(p => p.type === "month").value;
  } catch { return new Date(now).toISOString().slice(0, 7); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 598
function prevMonthKey(key, back = 1) {
  let [y, m] = key.split("-").map(Number);
  m -= back; while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 599

// Count, record this month, compare, and, only when the org has been over its
// band for MONTHS_OVER_BEFORE_NOTE months running, record ONE open notice and
// tell the owner. Returns what it found either way.
//
// IT NEVER TOUCHES THE SUBSCRIPTION. Not the plan column, not Stripe, not the
// amount. The price moves only through applyAgreedBandMoves, after the notice
// period, and only when the owner said yes.
async function checkRecordBand(orgId, { send = true, now = Date.now() } = {}) {
  const [org] = await query(
    `SELECT id, name, plan, subscription_status, tier_notice_band, tier_notice_effective_at,
            custom_price_cents, custom_price_ends_on
       FROM orgs WHERE id=?`, [orgId]);
  if (!org) return { checked: false, reason: "org_not_found" };
  const count = await countRecords(orgId);

  // Existing deals hold: a custom price is never measured against a band.
  if (org.custom_price_cents != null) return { checked: false, reason: "custom_price", count, plan: org.plan };
  const band = bandOfPlan(org.plan);
  if (!band) return { checked: false, reason: "no_band_on_this_plan", count, plan: org.plan };

  const fits = count <= band.maxRecords;
  const shouldBe = PRICING.tierForRecordCount(count);   // null = above the top band
  const tz = await orgTzName(orgId);
  const month = monthKey(now, tz);
  await run(
    `INSERT INTO org_record_months (org_id, month, record_count, band_id, over, measured_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON CONFLICT (org_id, month) DO UPDATE SET record_count=EXCLUDED.record_count, band_id=EXCLUDED.band_id,
       over=EXCLUDED.over, measured_at=NOW()`,
    [orgId, month, count, band.id, !fits]);

  if (fits) {
    // Back inside the band they pay for: the open notice is withdrawn. A
    // warning that is no longer true is worse than no warning.
    if (org.tier_notice_band) {
      await run(`UPDATE orgs SET tier_notice_band=NULL, tier_notice_at=NULL, tier_notice_effective_at=NULL,
                   tier_notice_count=NULL, tier_notice_dismissed_at=NULL, tier_notice_agreed_at=NULL, tier_notice_agreed_by=NULL
                 WHERE id=?`, [orgId]);
      console.log(`[tier] ${orgId} is back inside ${band.band} (${count}): the open notice is withdrawn`);
    }
    return { checked: true, over: false, count, band: band.id, maxRecords: band.maxRecords, month };
  }

  // Over this month. Was it over for the months before, running?
  const want = [];
  for (let i = 1; i < MONTHS_OVER_BEFORE_NOTE; i++) want.push(prevMonthKey(month, i));
  const prior = want.length
    ? await query(`SELECT month FROM org_record_months WHERE org_id=? AND over=true AND month = ANY(?)`, [orgId, want])
    : [];
  const monthsOver = 1 + prior.length;
  const nextBandId = shouldBe ? shouldBe.id : PRICING.TALK_TO_US.id;
  if (monthsOver < MONTHS_OVER_BEFORE_NOTE) {
    return { checked: true, over: true, count, band: band.id, maxRecords: band.maxRecords, month,
             monthsOver, noted: false, nextBand: nextBandId };
  }

  // The SAME notice, not a new one: a second check that finds the same band
  // must not restart the thirty days or send a second note.
  if (org.tier_notice_band === nextBandId) {
    return { checked: true, over: true, count, band: band.id, maxRecords: band.maxRecords, month, monthsOver,
             nextBand: nextBandId, noted: true, alreadyNoticed: true, effectiveAt: org.tier_notice_effective_at };
  }

  const effectiveAt = new Date(now + TIER_NOTICE_DAYS * 24 * 60 * 60 * 1000);
  await run(
    `UPDATE orgs SET tier_notice_band=?, tier_notice_at=NOW(), tier_notice_effective_at=?,
       tier_notice_count=?, tier_notice_dismissed_at=NULL, tier_notice_agreed_at=NULL, tier_notice_agreed_by=NULL WHERE id=?`,
    [nextBandId, effectiveAt.toISOString(), count, orgId]);
  console.log(`[tier] ${orgId} (${org.name}) has ${count} records, over ${band.band} for ${monthsOver} months running. `
    + `Note raised for ${nextBandId}; nothing changes before ${effectiveAt.toISOString()} and nothing changes without the owner's yes.`);

  let mailed = { sent: false, skipped: "not_requested" };
  if (send) mailed = await sendTierNoticeEmail({ orgId, orgName: org.name, count, band, nextBandId, effectiveAt })
    .catch(e => ({ sent: false, failed: e.message }));

  return { checked: true, over: true, count, band: band.id, maxRecords: band.maxRecords, month, monthsOver,
           nextBand: nextBandId, noted: true, effectiveAt: effectiveAt.toISOString(), mailed };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 600

// Every priced org, once a day. Cheap: one COUNT per org with a band plan.
async function checkAllRecordBands({ now = Date.now() } = {}) {
  const orgs = await query(
    `SELECT id FROM orgs WHERE position('_' in COALESCE(plan, '')) > 0 AND custom_price_cents IS NULL
        AND COALESCE(org_kind, '') NOT IN ('demo', 'internal_test', 'fixture')`, []);
  const out = { checked: 0, noted: 0, orgs: [] };
  for (const o of orgs) {
    const r = await checkRecordBand(o.id, { now }).catch(e => ({ error: e.message }));
    if (r && r.checked) out.checked++;
    if (r && r.noted && !r.alreadyNoticed) { out.noted++; out.orgs.push(o.id); }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 601

// The daily job: measure every banded org, then apply only the moves an owner
// agreed to (up, after the notice) or asked for (down, at renewal).
async function processRecordBands({ now = Date.now() } = {}) {
  const checked = await checkAllRecordBands({ now });
  const moved = await applyAgreedBandMoves({ now });
  const orgs = [...new Set([...checked.orgs, ...moved.up.map(m => m.id), ...moved.down.map(m => m.id)])];
  return { orgs, detail: `${checked.checked} measured, ${checked.noted} noted, ${moved.up.length} up, ${moved.down.length} down, ${moved.skipped.length} skipped` };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 602

// THE ONLY PLACE A BAND PRICE MOVES. Up: the notice period has passed AND the
// owner said yes. Down: the owner asked AND the subscription has reached its
// renewal. Each swaps the subscription's one recurring price in Stripe with no
// proration, then writes orgs.plan. Nothing here runs for a custom price.
async function applyAgreedBandMoves({ now = Date.now(), orgId = null } = {}) {
  const out = { up: [], down: [], skipped: [] };
  const rows = await query(
    `SELECT id, plan, stripe_subscription_id, tier_notice_band, tier_notice_effective_at, tier_notice_agreed_at,
            band_down_to, current_period_end, custom_price_cents
       FROM orgs
      WHERE custom_price_cents IS NULL AND stripe_subscription_id IS NOT NULL AND (?::text IS NULL OR id = ?)
        AND ((tier_notice_agreed_at IS NOT NULL AND tier_notice_effective_at <= to_timestamp(? / 1000.0))
          OR (band_down_to IS NOT NULL AND current_period_end IS NOT NULL AND current_period_end <= to_timestamp(? / 1000.0)))`,
    [orgId, orgId, now, now]);
  for (const o of rows) {
    const up = o.tier_notice_agreed_at && new Date(o.tier_notice_effective_at).getTime() <= now;
    const toBand = up ? o.tier_notice_band : o.band_down_to;
    const tier = PRICING.tierById(toBand);
    if (!tier) { out.skipped.push({ id: o.id, reason: "no_price_for_" + toBand }); continue; }
    const interval = String(o.plan || "").endsWith("_yearly") ? "yearly" : "monthly";
    const priceId = PRICING.priceIdFor(tier.id, interval, process.env);
    if (!priceId) { out.skipped.push({ id: o.id, reason: "price_not_configured" }); continue; }
    try {
      const sub = await billingStripe.subscriptions.retrieve(o.stripe_subscription_id);
      const item = sub.items && sub.items.data && sub.items.data.find(i => i.price && i.price.recurring);
      if (!item) { out.skipped.push({ id: o.id, reason: "no_recurring_item" }); continue; }
      await billingStripe.subscriptions.update(o.stripe_subscription_id, {
        items: [{ id: item.id, price: priceId }], proration_behavior: "none",
        metadata: { plan: `${tier.id}_${interval}` },
      });
    } catch (e) { out.skipped.push({ id: o.id, reason: "stripe: " + e.message }); continue; }
    await run(
      `UPDATE orgs SET plan=?, tier_notice_band=NULL, tier_notice_at=NULL, tier_notice_effective_at=NULL, tier_notice_count=NULL,
         tier_notice_dismissed_at=NULL, tier_notice_agreed_at=NULL, tier_notice_agreed_by=NULL,
         band_down_to=NULL, band_down_requested_at=NULL WHERE id=?`,
      [`${tier.id}_${interval}`, o.id]);
    (up ? out.up : out.down).push({ id: o.id, to: `${tier.id}_${interval}` });
    console.log(`[tier] ${o.id} moved ${up ? "up" : "down"} to ${tier.id}_${interval}, ${up ? "with the owner's yes" : "at renewal, as the owner asked"}`);
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 603

// The email. To the org's own admin, through the org mail gate like every
// other org-addressed send — a new org has mail off until a super-admin turns
// it on, so this is correctly refused there and says so in the log. The
// IN-APP notice is what carries the message in that case, which is why the
// notice is recorded before the email is attempted.
async function sendTierNoticeEmail({ orgId, orgName, count, band, nextBandId, effectiveAt }) {
  const admins = await query(
    `SELECT email, name FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL
      ORDER BY created_at ASC LIMIT 1`, [orgId]);
  if (!admins.length) return { sent: false, skipped: "no_admin" };
  const to = admins[0].email;
  const tz = await orgTzName(orgId);
  const when = formatChargeDate(effectiveAt, tz);
  const next = PRICING.tierById(nextBandId);
  const priceLine = next
    ? `The next band is ${next.band}, at $${next.monthlyUsd} a month or $${next.yearlyUsd} a year.`
    : `You are above every published band, so the next step is a conversation rather than a price.`;
  const appUrl = publicAppUrl();

  const { sent, error } = await (async () => {
    const r = await resend.emails.send({
      _stewardOrgId: orgId, _stewardKind: "tier_notice",
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to, replyTo: process.env.FOUNDER_EMAIL || undefined,
      subject: `${orgName} has grown past its plan`,
      html: `<div style="font-family:Georgia,serif;font-size:15px;color:#0f1a12;line-height:1.7;max-width:520px">
  <p>Steward has counted more records than your plan covers for ${MONTHS_OVER_BEFORE_NOTE} months running: <strong>${count.toLocaleString("en-US")} records</strong> on ${escapeHtml(orgName)}.</p>
  <p>${escapeHtml(PRICING.RECORD_SENTENCE)}</p>
  <p>You are paying for ${escapeHtml(band.band)}. ${escapeHtml(priceLine)}</p>
  <p><strong>Nothing has changed, and nothing will change without your yes.</strong>
     Your card has not been charged differently and your plan has not moved. If you agree, the new price
     starts no sooner than ${escapeHtml(when)}; you can say yes in Settings, Billing (<a href="${appUrl}/settings#billing">${appUrl.replace(/^https?:\/\//, "")}/settings</a>).
     If the count looks wrong, it usually means a file imported more people than you expected: reply to this
     message and we will look at it together.</p>
  <p style="color:#5A554F;font-size:13px">Steward &middot; stewardapp.dev</p>
</div>`,
    });
    return { sent: !r.error, error: r.error };
  })();
  if (!sent) console.warn(`[tier] notice email to ${orgId} was not sent: ${error && error.message}`);
  return { sent, to, error: error ? error.name : null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 604

async function processTrialReminders({ now = Date.now(), send = true } = {}) {
  const out = { considered: 0, sent: [], skipped: [] };
  const orgs = await query(
    `SELECT id, name, plan, trial_ends_at, billing_card_brand, billing_card_last4, stripe_subscription_id
       FROM orgs
      WHERE subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_reminder_sent_at IS NULL
        -- NO SUBSCRIPTION, NO CHARGE, NO WARNING. This email names an amount,
        -- a date and a card's last four digits. An org with no Stripe
        -- subscription behind it, a manual super-admin grant, a demo org, a
        -- legacy trial that never went through Checkout, has nothing coming,
        -- and telling it otherwise would be a lie about money.
        AND stripe_subscription_id IS NOT NULL
        -- ADMIN-CLEAN: nobody at a demo, internal test or fixture org is charged.
        AND COALESCE(org_kind, '') NOT IN ('demo', 'internal_test', 'fixture')`, []);
  for (const org of orgs) {
    if (!isReminderDue(org.trial_ends_at, now)) continue;
    out.considered++;
    const plan = closePlan(org.plan);
    if (!plan) { out.skipped.push({ id: org.id, reason: "no_priced_plan" }); continue; }
    const admins = await query(
      "SELECT email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL ORDER BY created_at ASC LIMIT 1", [org.id]);
    const to = admins[0]?.email;
    if (!to) { out.skipped.push({ id: org.id, reason: "no_admin" }); continue; }
    const tz = await orgTzName(org.id);
    const sentence = firstChargeSentence({ monthlyUsd: planAmountUsd(plan), firstChargeAt: org.trial_ends_at, tz });
    // Canonical domain via the vercel.json /billing/cancel proxy rewrite — a
    // cancel link is exactly where an unfamiliar host would read as a phish.
    const cancelUrl = `${publicAppUrl()}/billing/cancel/${signCancelToken(org.id)}`;
    const from = process.env.FOUNDER_EMAIL || process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
    let delivered = false;
    if (!send) {
      delivered = true;
    } else if (process.env.RESEND_API_KEY) {
      try {
        const { error } = await resend.emails.send({
          from, to, replyTo: from,
          _stewardOrgId: org.id, _stewardKind: "trial_ending",   // MAIL-1: billing, sent before onboarding
          subject: `Your first Steward charge is ${formatChargeDate(org.trial_ends_at, tz)}`,
          html: trialReminderEmailHtml({
            orgName: org.name, sentence,
            cardBrand: org.billing_card_brand, cardLast4: org.billing_card_last4, cancelUrl,
          }),
        });
        if (error) throw new Error(error.message);
        delivered = true;
      } catch (e) { console.error("[trial-reminder] send failed for", org.id, e.message); }
    } else {
      console.warn("[trial-reminder] RESEND_API_KEY not set — no email sent for", org.id);
    }
    if (!delivered) { out.skipped.push({ id: org.id, reason: "delivery_failed" }); continue; }
    // Stamped only after a delivered send, so a Resend outage retries next tick
    // instead of silently eating the one warning she gets.
    if (send) await run("UPDATE orgs SET trial_reminder_sent_at=NOW() WHERE id=?", [org.id]);
    out.sent.push({ id: org.id, to, trialEndsAt: org.trial_ends_at, amount: planAmountUsd(plan) });
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 612

// Returns the limits actually in effect for an org, accounting for trial state
function effectivePlanLimits(org) {
  const status = org.subscription_status || "trialing";
  if (status === "trialing") return PLAN_LIMITS.trial; // Team limits during trial
  return PLAN_LIMITS[org.plan] || PLAN_LIMITS.core;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 613

async function checkPlanLimit(org, dimension) {
  const limits = effectivePlanLimits(org);
  const limit = limits[dimension];
  let current = 0;
  if (dimension === "seats") {
    const rows = await query("SELECT COUNT(*) AS c FROM users WHERE org_id=? AND deactivated_at IS NULL", [org.id]); // removed users free their seat (BUILD-75 C.3)
    current = Number(rows[0]?.c) || 0;
  } else if (dimension === "records") {
    const rows = await query("SELECT COUNT(*) AS c FROM donors WHERE org_id=? AND deleted_at IS NULL", [org.id]);
    current = Number(rows[0]?.c) || 0;
  }
  const isTrial = (org.subscription_status || "trialing") === "trialing";
  // Soft bands: a paid Core/Team org is never hard-blocked at the band for
  // launch (brief BUILD-24 §5). Still returns current/limit for display.
  if (!isTrial && SOFT_BAND_PLANS.has(org.plan)) return { allowed: true, current, limit, isTrial: false, soft: true };
  return { allowed: current < limit, current, limit, isTrial };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 616
// Refreshed after every mail read and on the 15-minute tick. A stale
// connection is also one ERROR line, which is what puts it in the daily
// error digest (HARDEN-1's error-digest.yml reads the Railway error lines).
async function refreshMailboxSyncHealth({ log = false } = {}) {
  const rows = await query(
    `SELECT m.id, m.provider, m.status, m.created_at,
            (SELECT MAX(r.finished_at) FROM mailbox_sync_runs r
              WHERE r.user_id = m.user_id AND r.provider = m.provider AND r.kind = 'mail' AND r.ok) AS last_ok
       FROM mailbox_connections m
      WHERE m.status IN ('active','error') AND m.paused IS NOT TRUE AND m.credentials_sealed IS NOT NULL`).catch(() => null);
  if (!rows) return mailboxSyncHealth;
  const now = Date.now();
  const stale = rows.filter(r => r.status === "error"
    || (r.last_ok ? now - new Date(r.last_ok).getTime() > SYNC_STALE_MS : now - new Date(r.created_at).getTime() > SYNC_STALE_MS));
  if (log) for (const r of stale)
    console.error(`[mailbox-stale] ${r.provider} connection ${r.id} has not read successfully since ${r.last_ok ? new Date(r.last_ok).toISOString() : "it was connected"}${r.status === "error" ? " (permission refused)" : ""}`);
  // FIX-47: each stale connection by provider and when it last read, so the
  // status script can say which one needs a reconnect. Never an address:
  // /health is public.
  mailboxSyncHealth = { connections: rows.length, stale: stale.length, checkedAt: new Date().toISOString(),
    staleList: stale.slice(0, 10).map(r => ({ provider: r.provider, lastReadAt: r.last_ok ? new Date(r.last_ok).toISOString() : null, refused: r.status === "error" })) }; __share({ mailboxSyncHealth });
  return mailboxSyncHealth;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 617
async function startSyncRun(conn, kind, trigger) {
  const runId = newId("msr");
  await run(`INSERT INTO mailbox_sync_runs (id,org_id,user_id,provider,kind,trigger) VALUES (?,?,?,?,?,?)`,
    [runId, conn.org_id, conn.user_id, conn.provider, kind, trigger || "tick"]).catch(() => {});
  return runId;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 618
async function finishSyncRun(runId, { ok, found = null, logged = null, error = null }) {
  await run(`UPDATE mailbox_sync_runs SET finished_at=NOW(), ok=?, found=?, logged=?, error=? WHERE id=?`,
    [!!ok, found, logged, error ? String(error).slice(0, 300) : null, runId]).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 619
// The sentence a person reads. Never a status code, never a stack.
// FIX-34: "did not answer" is said ONLY for a timeout; a refusal says it was
// refused and why (apiCheck.js holds the wording).
function syncErrorSentence(providerKey, what, e) {
  const label = providerKey === "google" ? (what === "calendar" ? "Google Calendar" : "Gmail") : "Outlook";
  if (e && e.code === "token_refused") return `${label} refused Steward's permission. Reconnect to keep it working.`;
  if (e && e.sentence) return e.sentence;
  return `Steward could not finish reading your ${what}. It tries again in 5 minutes.`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 626
async function noteRetryAfter(conn, e) {
  if (e && e.retryAfter) await run(`UPDATE mailbox_connections SET retry_after=? WHERE id=?`, [e.retryAfter.toISOString(), conn.id]).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 629

async function syncMailbox(userId, orgId, providerKey, { trigger = "tick" } = {}) {
  const [conn] = await query(
    `SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND provider=? AND status='active'`,
    [userId, orgId, providerKey]);
  if (!conn) return { logged: 0, reason: "not_connected" };
  if (conn.paused === true) return { logged: 0, reason: "paused" };
  if (backedOff(conn)) return { logged: 0, reason: "backed_off" };
  const locked = await withTryAdvisoryLock(syncLockKey("mail", conn), () => syncMailboxLocked(conn, userId, orgId, providerKey, trigger));
  return locked && locked.skipped ? { logged: 0, reason: "running" } : locked;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 630
async function syncMailboxLocked(conn, userId, orgId, providerKey, trigger) {
  const runId = await startSyncRun(conn, "mail", trigger);
  await run(`UPDATE mailbox_connections SET last_tried_at=NOW() WHERE id=?`, [conn.id]).catch(() => {});
  try {
    const out = await syncMailboxRun(conn, userId, orgId, providerKey, { progress: trigger === "connect" });
    await finishSyncRun(runId, { ok: true, found: out.found ?? null, logged: out.logged || 0 });
    await refreshMailboxSyncHealth().catch(() => {});
    return out;
  } catch (e) {
    const sentence = syncErrorSentence(providerKey, "mail", e);
    await noteRetryAfter(conn, e);
    console.error(`[mailbox] ${providerKey} sync for ${conn.id} failed:`, e.message);
    await finishSyncRun(runId, { ok: false, error: sentence });
    await run(`UPDATE mailbox_connections SET last_error=?, last_error_at=NOW() WHERE id=?`, [sentence, conn.id]).catch(() => {});
    await refreshMailboxSyncHealth().catch(() => {});
    return { logged: 0, reason: "failed", error: sentence };
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 631

// FIX-34 · A GMAIL RUN WITH NOTHING NEW IS ONE SMALL CALL. Gmail's history
// list from the last read's history id says whether anything arrived, was sent
// or was deleted since; if nothing, the run stops there. An expired or unknown
// id (404) falls back to the full read, which stores a fresh id.
async function gmailHistoryNow(token) {
  const r = await providerFetch(`${GMAIL_BASE()}/gmail/v1/users/me/profile`, { headers: { Authorization: "Bearer " + token } }).catch(() => null);
  const b = r && r.ok ? await r.json().catch(() => null) : null;
  return b && b.historyId ? String(b.historyId) : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 632
async function gmailUnchanged(conn, token) {
  if (!conn.gmail_history_id) return null;
  const r = await providerFetch(`${GMAIL_BASE()}/gmail/v1/users/me/history?` + new URLSearchParams({ startHistoryId: conn.gmail_history_id, maxResults: "1" }),
    { headers: { Authorization: "Bearer " + token } }).catch(() => null);
  if (!r) return null;
  if (!r.ok) {
    if (r.status === 429) throw APIC.providerError("google", "mail", 429, await r.json().catch(() => null),
      APIC.retryAfterDate(r.headers.get("retry-after")) || new Date(Date.now() + 5 * 60e3));
    return null;
  }
  const b = await r.json().catch(() => null);
  // Only a real history answer (it always carries the mailbox's historyId) can say "nothing new".
  // PUSH-1: and only a real answer with history in it says "something changed".
  if (!b || !b.historyId) return null;
  return b.history && b.history.length ? { changed: true } : { unchanged: true, historyId: String(b.historyId) };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 633

async function syncMailboxRun(conn, userId, orgId, providerKey, { progress = false } = {}) {
  const ML = await import("../../shared/mailboxLog.js");
  const token = await mailboxAccessToken(conn, orgId, providerKey);
  if (!token) throw Object.assign(new Error("token refused"), { code: "token_refused" });
  let historyId = null;
  // PUSH-1 · true only when the incremental check itself (history id, delta
  // link) said something changed: the tick uses it to notice a push that
  // stopped arriving. A first read, or a check that failed, is never one.
  let gatedChange = false;
  if (providerKey === "google") {
    const same = await gmailUnchanged(conn, token);
    gatedChange = !!(same && same.changed);
    if (same && same.unchanged) {
      await run(`UPDATE mailbox_connections SET last_synced_at=NOW(), last_tried_at=NOW(), last_logged_count=0, gmail_history_id=?,
                        last_error=NULL, last_error_at=NULL, retry_after=NULL, updated_at=NOW() WHERE id=?`, [same.historyId, conn.id]);
      return { logged: 0, found: 0, unchanged: true };
    }
    historyId = await gmailHistoryNow(token);   // taken BEFORE the read, so nothing that lands during it is skipped next time
  }
  // FIX-34 · OUTLOOK MAIL THROUGH GRAPH DELTA: one small call per folder
  // (Inbox, Sent Items) when nothing changed. Any change, a lost link (410) or
  // a link older than 6 hours means the full read below, as before.
  let graphLinks = null;
  if (providerKey === "microsoft") {
    const [inbox, sent] = [await graphDeltaGate(conn, "inbox", token), await graphDeltaGate(conn, "sent", token)];
    graphLinks = { inbox, sent };
    gatedChange = (inbox.gated && !inbox.unchanged) || (sent.gated && !sent.unchanged);
    if (inbox.unchanged && sent.unchanged) {
      await saveGraphDelta(conn, graphLinks);
      await run(`UPDATE mailbox_connections SET last_synced_at=NOW(), last_tried_at=NOW(), last_logged_count=0,
                        last_error=NULL, last_error_at=NULL, retry_after=NULL, updated_at=NOW() WHERE id=?`, [conn.id]);
      return { logged: 0, found: 0, unchanged: true };
    }
  }

  const donors = await query(
    `SELECT id, email FROM donors WHERE org_id=? AND email IS NOT NULL AND email <> '' AND deleted_at IS NULL`,
    [orgId]);
  if (!donors.length) {
    // Nobody on file with an email is a finished read, not a silent one.
    if (graphLinks) await saveGraphDelta(conn, graphLinks);
    await run(`UPDATE mailbox_connections SET last_synced_at=NOW(), last_logged_count=0, last_error=NULL, last_error_at=NULL,
                      updated_at=NOW() WHERE id=?`, [conn.id]);
    return { logged: 0, found: 0, reason: "no_people", gatedChange };
  }
  // CLIENT-SAFE-1: with privacy mode on, a person marked as a client is not
  // searched for, a message with one on it is never fetched, and anything that
  // still names one is dropped like a never-log address.
  const privacy = await CLIENT_SAFE.privacyFor(orgId);
  const donorsByEmail = new Map();
  for (const d of donors) if (!privacy.clientIds.has(d.id)) donorsByEmail.set(String(d.email).trim().toLowerCase(), d.id);

  const staffRows = await query(`SELECT email FROM users WHERE org_id=?`, [orgId]);
  const staffEmails = staffRows.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean);
  const neverRows = await query(`SELECT pattern FROM mailbox_never_log WHERE user_id=?`, [userId]);
  const neverLog = [...neverRows.map(r => r.pattern), ...privacy.clientEmails];
  // Both exclusion tables, so anything removed under the old integration stays
  // removed under this one.
  const exRows = await query(
    `SELECT message_id FROM mailbox_exclusions WHERE org_id=? AND provider=?
     UNION ALL SELECT gmail_message_id FROM gmail_sync_exclusions WHERE org_id=?`,
    [orgId, providerKey, orgId]);
  const excludedIds = exRows.map(r => r.message_id).filter(Boolean);

  // SCALE-2 · THE FIRST READ SAYS HOW FAR IT HAS GOT. Only the read a new
  // connection starts (routes/jobs.js mailboxFirstRead) writes it, at most
  // once a second, for the Connections card's "Reading your mailbox: 40%".
  let lastPct = -1, lastAt = 0;
  const onProgress = !progress ? null : async (done, total) => {
    const pct = Math.min(99, Math.floor(done * 100 / Math.max(1, total)));
    if (pct <= lastPct || Date.now() - lastAt < 1000) return;
    lastPct = pct; lastAt = Date.now();
    await run(`UPDATE mailbox_connections SET read_progress=? WHERE id=?`, [pct, conn.id]).catch(() => {});
  };
  const fetched = await fetchMailboxMessages(providerKey, token, [...donorsByEmail.keys()], { onProgress, clients: privacy.clientEmails });
  // Every request the provider refused, and none it answered: that is a
  // failed read, said so, never "nothing new".
  if (fetched.asked && fetched.refused === fetched.asked)
    throw APIC.providerError(providerKey, "mail", fetched.lastStatus, fetched.lastBody);
  const messages = fetched.messages;
  // FIX-14 Part 1 — an email is filed under the day it arrived IN THE ORG's
  // zone. The normalizers sliced the UTC day, so mail after 8pm in New York
  // landed on tomorrow.
  { const tzOrg = await orgTz(orgId);
    for (const m of messages) if (m && m.receivedAt && !isNaN(new Date(m.receivedAt).getTime())) m.date = orgToday(tzOrg, new Date(m.receivedAt)); }   // ORG_TZ_SEAM_OK
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const actorId = `system:mailbox/${providerKey}/${userId}`;
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [userId]);
  const staffName = me?.name || null;

  let logged = 0;
  const dropped = {};
  for (const m of messages) {
    const decision = ML.classifyMailboxMessage(m, {
      paused: false, neverLog, excludedIds, mailboxAddress: conn.address,
      staffEmails, donorsByEmail, today,
    });
    if (decision.action !== "log") { dropped[decision.reason] = (dropped[decision.reason] || 0) + 1; continue; }

    // Idempotent on the provider's own message id, per org.
    const seen = await query(
      `SELECT id FROM interactions WHERE org_id=? AND metadata->>'message_id'=? LIMIT 1`, [orgId, String(m.id)]);
    if (seen.length) continue;

    // CLIENT-SAFE-1: health sentences are replaced before anything is
    // written; with AI off only the date, direction, people and subject stay.
    const screened = await CLIENT_SAFE.screenForStore(orgId, { subject: decision.subject, body: decision.body }, privacy);
    decision.subject = screened.subject; decision.body = screened.body;
    const note = ML.conversationNote(decision, { staffName });
    // SECURE-3: `note` is the one line; the body is sealed with this row's id
    // (server/mail/sealedMail.js). No key throws, and the run fails loudly.
    for (const donorId of decision.donorIds) {
      const intId = newId("int");
      const sealedCols = SEALED_MAIL.sealedEmailColumns(orgId, intId, note, decision.body);
      await run(
        `INSERT INTO interactions (id, org_id, donor_id, type, note, body_sealed, body_key_id, date, created_at, created_by, logged_by_name, metadata)
         VALUES (?,?,?,'email',?,?,?,?,?,?,?,?)`,
        [intId, orgId, donorId, sealedCols.note, sealedCols.body_sealed, sealedCols.body_key_id, decision.date,
         m.receivedAt || new Date().toISOString(), actorId, staffName,
         JSON.stringify({ message_id: String(m.id), provider: providerKey, direction: decision.direction,
                          subject: decision.subject, attachments: decision.attachmentCount,
                          // THREAD-3: what kind of mail it is, so only a person's
                          // email can become a reply step (processUnansweredMail).
                          ...(decision.direction === "inbound" ? { mail_kind: ML.mailKind(m) } : {}),
                          ...(m.threadKey ? { thread_key: String(m.threadKey) } : {}),
                          ...(decision.attachmentCount && m.webLink ? { web_link: m.webLink } : {}),
                          ...(screened.held ? { held_back: "health" } : {}),
                          ...(screened.metadataOnly ? { metadata_only: true } : {}),
                          logged_by: userId })]);
      if (screened.held) await CLIENT_SAFE.recordHold(orgId, { donorIds: [donorId], interactionId: intId, source: "mailbox", actorId });
      logged++;
      // A CONVERSATION IS A TOUCH, AND NOTHING MORE. It can close a Thread
      // step that asked for exactly this contact. It does not move giving,
      // drift, LYBUNT, SYBUNT or the stage, and there is no code below that
      // could: the only write is to `interactions` and to an open thread step.
      await closeThreadStepForContact(orgId, donorId, decision.date, intId).catch(() => {});
      // LIVE-1 — the after-change step, once per sync for everyone it logged.
      AFTER.afterChangeSoon(orgId, [donorId], { door: "mail_calendar_sync", recalc: false });
    }

    // GRANTS-1 · A MESSAGE TO OR FROM A FUNDER CONTACT ALSO LANDS ON THE
    // FUNDER AND ITS GRANT, attachments included (routes/grantMail.js holds
    // the one rule, shared with the BCC path). Anybody else: nothing on any grant.
    await require("../../routes/grantMail").routeToFunderGrant({
      orgId, source: "mailbox", provider: providerKey, actorId, actorName: staffName,
      ownerAddress: conn.address, staffEmails, note, body: decision.body, sealAttachments: true, attachmentCount: m.attachmentCount,
      message: { id: String(m.id), from: m.from, to: m.to, cc: m.cc, subject: decision.subject,
                 sentOn: decision.date, receivedAt: m.receivedAt },
      loadAttachments: () => fetchMailboxAttachments(providerKey, token, m),
    }).catch(e => console.error("[mailbox] grant routing:", e.message));

    // CAPTURE-1 · A PLEDGE FORM OR A DAF LETTER FROM A PERSON STEWARD KNOWS
    // becomes a card in To confirm. Only a message logged to exactly one
    // person reaches here; its PDF and image attachments are read, and kept
    // only if they become a card (capture.js fromMailboxMessage).
    await require("../../capture").fromMailboxMessage(orgId, {
      donorIds: decision.donorIds, direction: decision.direction, attachmentCount: decision.attachmentCount,
      provider: providerKey, messageId: String(m.id), receivedAt: m.receivedAt, actorId, actorName: staffName,
      loadAttachments: () => fetchMailboxAttachments(providerKey, token, m),
    }).catch(e => console.error("[mailbox] capture:", e.message));
  }

  await run(
    `UPDATE mailbox_connections SET last_synced_at=NOW(), last_tried_at=NOW(), last_logged_count=?,
            last_error=NULL, last_error_at=NULL, retry_after=NULL, gmail_history_id=COALESCE(?, gmail_history_id), updated_at=NOW() WHERE id=?`,
    [logged, historyId, conn.id]);
  if (graphLinks) await saveGraphDelta(conn, graphLinks);
  // THREAD-3: an email from a donor nobody has answered becomes a step.
  const replies = await processUnansweredMail(orgId).catch(e => { console.error("[mailbox] needs reply:", e.message); return null; });
  return { logged, found: messages.length, dropped, replySteps: replies ? replies.opened + replies.tasks : 0, gatedChange };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 634

// ── INT-BUILD-1 Part 1 · THE CALENDAR, ON THE SAME CONNECTION ──────────────
//
// Read a window of her own calendar, keep the meetings that have somebody on
// file in them, and nothing else (shared/calendarLog.js holds the decision).
// An event with nobody on file is dropped in memory: no row, no count, no log
// line, and the return value says how many were KEPT, never how many were not.
async function syncCalendar(userId, orgId, providerKey, { trigger = "tick" } = {}) {
  const [conn] = await query(
    `SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND provider=? AND status='active'`,
    [userId, orgId, providerKey]);
  if (!conn || conn.calendar_granted !== true || conn.paused === true || !conn.credentials_sealed) return { kept: 0 };
  if (backedOff(conn)) return { kept: 0, reason: "backed_off" };
  const locked = await withTryAdvisoryLock(syncLockKey("calendar", conn), () => syncCalendarLocked(conn, userId, orgId, providerKey, trigger));
  return locked && locked.skipped ? { kept: 0, reason: "running" } : locked;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 635
async function syncCalendarLocked(conn, userId, orgId, providerKey, trigger) {
  const runId = await startSyncRun(conn, "calendar", trigger);
  await run(`UPDATE mailbox_connections SET calendar_tried_at=NOW() WHERE id=?`, [conn.id]).catch(() => {});
  try {
    const out = await syncCalendarRun(conn, userId, orgId, providerKey);
    await finishSyncRun(runId, { ok: true, found: out.found ?? null, logged: out.kept || 0 });
    await run(`UPDATE mailbox_connections SET calendar_error=NULL WHERE id=?`, [conn.id]).catch(() => {});
    return out;
  } catch (e) {
    const sentence = syncErrorSentence(providerKey, "calendar", e);
    await noteRetryAfter(conn, e);
    console.error(`[calendar] ${providerKey} sync for ${conn.id} failed:`, e.message);
    await finishSyncRun(runId, { ok: false, error: sentence });
    await run(`UPDATE mailbox_connections SET calendar_error=? WHERE id=?`, [sentence, conn.id]).catch(() => {});
    return { kept: 0, error: sentence };
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 636

async function syncCalendarRun(conn, userId, orgId, providerKey) {
  const CL = await import("../../shared/calendarLog.js");
  const ME = require("../../meetingEffects");
  const token = await mailboxAccessToken(conn, orgId, providerKey);
  if (!token) throw Object.assign(new Error("token refused"), { code: "token_refused" });
  const readStartedAt = new Date();
  // PUSH-1 · Google's sync token first; the FIX-34 "updated since" question
  // when there is none yet.
  const gGate = providerKey === "google" ? await googleCalendarGate(conn, token) : null;
  let gatedChange = !!(gGate && gGate.gated && gGate.changed);
  if (gGate && gGate.unchanged) {
    await run(`UPDATE mailbox_connections SET calendar_synced_at=NOW(), gcal_sync_token=COALESCE(?, gcal_sync_token) WHERE id=?`, [gGate.syncToken || null, conn.id]);
    return { kept: 0, found: 0, unchanged: true };
  }
  // FIX-34 · OUTLOOK CALENDAR THROUGH calendarView/delta, the same way.
  let calLinks = null;
  if (providerKey === "microsoft") {
    const g = await graphDeltaGate(conn, "calendar", token);
    calLinks = { calendar: g };
    gatedChange = !!(g.gated && !g.unchanged);
    if (g.unchanged) {
      await saveGraphDelta(conn, calLinks);
      await run(`UPDATE mailbox_connections SET calendar_synced_at=NOW() WHERE id=?`, [conn.id]);
      return { kept: 0, found: 0, unchanged: true };
    }
  }

  const people = await query(
    `SELECT id, name, email FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]);
  const donorsByEmail = new Map(people.filter(d => d.email && String(d.email).trim())
    .map(d => [String(d.email).trim().toLowerCase(), d.id]));
  const staffRows = await query(`SELECT email, name FROM users WHERE org_id=?`, [orgId]);
  const staffEmails = staffRows.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean);
  const staffNames = staffRows.map(r => r.name).filter(Boolean);
  // CLIENT-SAFE-1: a meeting with somebody marked as a client is not logged.
  const neverLog = [...(await query(`SELECT pattern FROM mailbox_never_log WHERE user_id=?`, [userId])).map(r => r.pattern),
    ...(await CLIENT_SAFE.privacyFor(orgId)).clientEmails];
  const excludedIds = (await query(
    `SELECT message_id FROM mailbox_exclusions WHERE org_id=? AND provider=?`, [orgId, providerKey + ":calendar"]))
    .map(r => r.message_id);

  const from = new Date(Date.now() - CL.WINDOW_PAST_DAYS * 864e5).toISOString();
  const to = new Date(Date.now() + CL.WINDOW_AHEAD_DAYS * 864e5).toISOString();
  // The provider refused: fetchCalendarEvents throws, what is stored is left alone, and the run says why.
  const events = await fetchCalendarEvents(providerKey, token, from, to);

  const actorId = `system:calendar/${providerKey}/${userId}`;
  const ctx = { paused: false, neverLog, excludedIds, mailboxAddress: conn.address, staffEmails, donorsByEmail, ownerUserId: userId,
                people: people.map(p => ({ id: p.id, name: p.name })), staffNames };
  const seen = new Set();
  let kept = 0;
  for (const ev of events) {
    const d = CL.classifyCalendarEvent(ev, ctx);
    if (d.action !== "store") continue;
    const r = d.row;
    seen.add(String(ev.id));
    // A person a human linked (or a visit booked in Steward) stays linked:
    // the sync never overwrites who a meeting is with once somebody said.
    const [row] = await query(
      `INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,
                                    candidate_ids,matched_by,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, owner_user_id, provider, provider_event_id)
       DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, location=EXCLUDED.location,
                     person_ids = CASE WHEN calendar_events.booked_in_steward OR calendar_events.matched_by = 'person'
                                       THEN calendar_events.person_ids ELSE EXCLUDED.person_ids END,
                     candidate_ids = CASE WHEN calendar_events.booked_in_steward OR calendar_events.matched_by = 'person'
                                       THEN calendar_events.candidate_ids ELSE EXCLUDED.candidate_ids END,
                     matched_by = CASE WHEN calendar_events.booked_in_steward OR calendar_events.matched_by = 'person'
                                       THEN calendar_events.matched_by ELSE EXCLUDED.matched_by END,
                     updated_at=NOW()
       RETURNING id`,
      [newId("cal"), orgId, userId, providerKey, String(ev.id), r.title, r.startsAt, r.endsAt,
       r.location, r.personIds, r.candidateIds || [], r.matchedBy || null, actorId, "Calendar sync"]);
    kept++;
    // FIX-33 Part 3: a meeting with somebody on file changes their record,
    // and a moved one moves what it changed.
    if (row) await ME.applyMeeting(row.id, { actorId, actorName: "Calendar sync" })
      .catch(e => console.error("[calendar] meeting effects:", e.message));
  }
  // A meeting that left her calendar (cancelled, moved out of the window, the
  // donor taken off it) leaves Steward too, UNLESS she already wrote down how
  // it went: her note is hers and outlives the invite. What it changed on the
  // record comes off first, so the step and the tasks follow the calendar.
  const gone = await query(
    `SELECT id FROM calendar_events WHERE org_id=? AND owner_user_id=? AND provider=? AND logged_at IS NULL
        AND starts_at BETWEEN ? AND ? AND NOT (provider_event_id = ANY(?))`,
    [orgId, userId, providerKey, from, to, [...seen]]);
  for (const g of gone) await ME.revertMeeting(g.id, { actorId, actorName: "Calendar sync" })
    .catch(e => console.error("[calendar] meeting revert:", e.message));
  if (gone.length) await run(`DELETE FROM calendar_events WHERE id = ANY(?)`, [gone.map(g => g.id)]);
  await run(`UPDATE mailbox_connections SET calendar_synced_at=NOW(), calendar_read_from=?, retry_after=NULL,
                    gcal_sync_token=CASE WHEN ? THEN ? ELSE gcal_sync_token END WHERE id=?`,
    [readStartedAt.toISOString(), !!gGate, gGate ? gGate.syncToken || null : null, conn.id]);
  if (calLinks) await saveGraphDelta(conn, calLinks);
  // KEPT only: how many events she has that are not meetings is not Steward's to know.
  return { kept, found: kept, gatedChange };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 639
async function pushStewardDates(userId, orgId, providerKey, { trigger = "tick" } = {}) {
  const [conn] = await query(
    `SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND provider=? AND status='active'`,
    [userId, orgId, providerKey]);
  if (!conn || conn.calendar_granted !== true || conn.paused === true || !conn.credentials_sealed) return { pushed: 0 };
  if (conn.push_dates !== true && !(await query(`SELECT 1 FROM calendar_pushes WHERE user_id=? AND provider=? LIMIT 1`, [userId, providerKey])).length)
    return { pushed: 0 };
  const runId = await startSyncRun(conn, "push", trigger);
  try {
    const out = await pushStewardDatesRun(conn, userId, orgId, providerKey);
    await finishSyncRun(runId, { ok: true, logged: out.pushed || 0 });
    return out;
  } catch (e) {
    const sentence = syncErrorSentence(providerKey, "calendar", e);
    await finishSyncRun(runId, { ok: false, error: sentence });
    return { pushed: 0, error: sentence };
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 640
async function pushStewardDatesRun(conn, userId, orgId, providerKey) {
  // Turned off: whatever Steward put there comes off, and nothing goes on.
  const on = conn.push_dates === true;
  const stored = await query(`SELECT * FROM calendar_pushes WHERE org_id=? AND user_id=? AND provider=?`, [orgId, userId, providerKey]);
  if (!on && !stored.length) return { pushed: 0 };
  const token = await mailboxAccessToken(conn, orgId, providerKey);
  if (!token) throw Object.assign(new Error("token refused"), { code: "token_refused" });
  const CALR = require("../../calendar");
  const tzRow = await orgTz(orgId);
  const tz = tzRow.timezone || orgTime.DEFAULT_TZ;
  const from = orgToday(tzRow), to = orgTime.addDays(from, PUSH_AHEAD_DAYS);   // ORG_TZ_SEAM_OK
  // A meeting step is the meeting, already on her calendar: never a second entry.
  const items = on ? (await CALR.calendarItems(orgId, { from, to, tz, userId, scope: "mine", types: PUSH_TYPES }))
    .filter(i => i.ownerId === userId && i.stepType !== "meeting" && !i.done) : [];   // FIX-31: a done deadline stays on Steward's calendar, not hers
  const byKey = new Map(stored.map(r => [r.item_key, r]));
  const google = providerKey === "google";
  const base = google ? `${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events`
    : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me/events`;
  const call = (method, url, body) => fetch(url, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) }).catch(() => null);
  const entry = (it, day) => {
    const next = orgTime.addDays(day, 1);
    const note = `From Steward: ${it.detail || "a dated item"}. Change it in Steward and it changes here.`;
    return google
      ? { summary: it.title, description: note, start: { date: day }, end: { date: next }, transparency: "transparent",
          extendedProperties: { private: { steward_item: it.id } } }
      : { subject: it.title, body: { contentType: "text", content: note }, isAllDay: true, showAs: "free",
          start: { dateTime: `${day}T00:00:00`, timeZone: tz }, end: { dateTime: `${next}T00:00:00`, timeZone: tz } };
  };
  let pushed = 0;
  const live = new Set();
  for (const it of items) {
    const day = String(it.start).slice(0, 10);
    live.add(it.id);
    const had = byKey.get(it.id);
    if (had && had.day === day && had.title === it.title) continue;
    if (had) {
      const r = await call("PATCH", `${base}/${encodeURIComponent(had.provider_event_id)}`, entry(it, day));
      if (r && r.ok) { await run(`UPDATE calendar_pushes SET day=?, title=?, updated_at=NOW() WHERE id=?`, [day, it.title, had.id]); pushed++; }
      continue;
    }
    const r = await call("POST", base, entry(it, day));
    const made = r && r.ok ? await r.json().catch(() => null) : null;
    if (!made || !made.id) continue;
    await run(`INSERT INTO calendar_pushes (id,org_id,user_id,provider,item_key,provider_event_id,day,title,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (user_id, provider, item_key) DO NOTHING`,
      [newId("cpush"), orgId, userId, providerKey, it.id, String(made.id), day, it.title,
       `system:calendar-push/${providerKey}/${userId}`, "Calendar sync"]);
    pushed++;
  }
  // Done, removed, reassigned or moved past the window: off her calendar.
  for (const r of stored) {
    if (live.has(r.item_key)) continue;
    const del = await call("DELETE", `${base}/${encodeURIComponent(r.provider_event_id)}`);
    if (del && (del.ok || del.status === 404 || del.status === 410)) await run(`DELETE FROM calendar_pushes WHERE id=?`, [r.id]);
  }
  return { pushed };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 641

// The provider is asked for the window, with the description masked out.
// Returns null when the provider refuses, so a revoked calendar never reads
// as "she has no meetings" and wipes what is stored.
async function fetchCalendarEvents(providerKey, token, from, to) {
  const CL = await import("../../shared/calendarLog.js");
  const out = [];
  try {
    if (providerKey === "google") {
      let pageToken = "";
      for (let i = 0; i < 5; i++) {
        const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime",
          maxResults: "250", fields: CL.GOOGLE_EVENT_FIELDS, ...(pageToken ? { pageToken } : {}) });
        const r = await providerFetch(`${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events?${q}`,
          { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) { console.error(`[calendar] google answered ${r.status}`); throw await calRefusal(r, "google"); }
        const body = await r.json();
        for (const it of body.items || []) out.push(CL.fromGoogle(it));
        if (!body.nextPageToken) break;
        pageToken = body.nextPageToken;
      }
    } else {
      let url = `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me/calendarView?` + new URLSearchParams({
        startDateTime: from, endDateTime: to, $select: CL.GRAPH_EVENT_SELECT, $top: "250" });
      for (let i = 0; i < 5 && url; i++) {
        const r = await providerFetch(url, { headers: { Authorization: "Bearer " + token, Prefer: 'outlook.timezone="UTC"' } });
        if (!r.ok) { console.error(`[calendar] microsoft answered ${r.status}`); throw await calRefusal(r, "microsoft"); }
        const body = await r.json();
        for (const it of body.value || []) out.push(CL.fromGraph(it));
        url = body["@odata.nextLink"] || null;
      }
    }
  } catch (e) {
    if (e && e.reason) throw e;
    console.error(`[calendar] ${providerKey} fetch:`, e.message);
    throw APIC.providerError(providerKey, "calendar", null, null);   // a timeout: the only "did not answer"
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 642
async function calRefusal(r, providerKey) {
  const body = await r.json().catch(() => null);
  return APIC.providerError(providerKey, "calendar", r.status, body, r.status === 429 ? APIC.retryAfterDate(r.headers.get("retry-after")) || new Date(Date.now() + 5 * 60e3) : null);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 646
async function graphDeltaWalk(url, token, pages, what = "mail") {
  let changed = 0;
  for (let i = 0; i < pages && url; i++) {
    const r = await providerFetch(url, { headers: { Authorization: "Bearer " + token, Prefer: "odata.maxpagesize=50" } }).catch(() => null);
    if (!r) return null;
    if (!r.ok) {
      if (r.status === 429) throw APIC.providerError("microsoft", what, 429, await r.json().catch(() => null),
        APIC.retryAfterDate(r.headers.get("retry-after")) || new Date(Date.now() + 5 * 60e3));
      return null;                                   // 410 and the rest: no link, full read
    }
    const b = await r.json().catch(() => null);
    if (!b) return null;
    changed += (b.value || []).length;
    if (b["@odata.deltaLink"]) return { link: b["@odata.deltaLink"], changed };
    url = b["@odata.nextLink"] || null;
  }
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 647
async function graphDeltaGate(conn, key, token) {
  const stored = (conn.graph_delta || {})[key];
  if (stored && stored.link && Date.now() - new Date(stored.at).getTime() < GRAPH_DELTA_FULL_MS) {
    const what = key === "calendar" ? "calendar" : "mail";
    const w = await graphDeltaWalk(stored.link, token, 20, what);
    if (w) return { unchanged: w.changed === 0, gated: true, link: w.link, at: stored.at };
  }
  // No usable link: make one now (before the full read, so nothing that lands during it is missed).
  const fresh = await graphDeltaWalk(graphDeltaStart(key), token, 40, key === "calendar" ? "calendar" : "mail");
  return { unchanged: false, link: fresh ? fresh.link : null, at: new Date().toISOString() };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 648
async function saveGraphDelta(conn, parts) {
  const cur = { ...(conn.graph_delta || {}) };
  for (const [k, v] of Object.entries(parts)) cur[k] = v && v.link ? { link: v.link, at: v.at } : null;
  conn.graph_delta = cur;
  await run(`UPDATE mailbox_connections SET graph_delta=? WHERE id=?`, [JSON.stringify(cur), conn.id]).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 649

async function calendarUnchanged(conn, providerKey, token) {
  if (providerKey !== "google" || !conn.calendar_read_from) return false;
  if (Date.now() - new Date(conn.calendar_read_from).getTime() > CAL_FULL_EVERY_MS) return false;
  const q = new URLSearchParams({ updatedMin: new Date(conn.calendar_read_from).toISOString(), showDeleted: "true",
    singleEvents: "true", maxResults: "1", fields: "kind,items(id)" });
  const r = await providerFetch(`${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events?${q}`,
    { headers: { Authorization: "Bearer " + token } }).catch(() => null);
  if (!r) return false;
  if (!r.ok) { if (r.status === 429) throw await calRefusal(r, "google"); return false; }
  const body = await r.json().catch(() => null);
  // Only a real events list (kind calendar#events) can say "nothing changed".
  return !!body && body.kind === "calendar#events" && Array.isArray(body.items) && body.items.length === 0;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 650
// PUSH-1 · GOOGLE CALENDAR'S INCREMENTAL SYNC TOKEN. Asked with the stored
// token, Google lists only what changed since (deletions included), and hands
// back the next token. Recurring events are asked for as series
// (singleEvents=false), so making the first token never expands a weekly
// meeting into years of copies, and only event ids are returned: what is
// read and stored is still decided by the window read below. An expired
// token (410) is made again. The token is saved only after a read finishes,
// and is taken BEFORE it, so nothing that lands during the read is skipped.
async function gcalTokenWalk(params, token, pages) {
  const base = `${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events?`;
  let pageToken = "", changed = 0;
  for (let i = 0; i < pages; i++) {
    const q = new URLSearchParams({ ...params, singleEvents: "false", maxResults: "2500",
      fields: "kind,nextPageToken,nextSyncToken,items(id)", ...(pageToken ? { pageToken } : {}) });
    const r = await providerFetch(base + q, { headers: { Authorization: "Bearer " + token } }).catch(() => null);
    if (!r) return null;
    if (!r.ok) { if (r.status === 429) throw await calRefusal(r, "google"); return null; }
    const b = await r.json().catch(() => null);
    if (!b || b.kind !== "calendar#events") return null;
    changed += (b.items || []).length;
    if (b.nextSyncToken) return { changed, syncToken: String(b.nextSyncToken) };
    if (!b.nextPageToken) return null;
    pageToken = b.nextPageToken;
  }
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 651
async function googleCalendarGate(conn, token) {
  const recent = conn.calendar_read_from && Date.now() - new Date(conn.calendar_read_from).getTime() <= CAL_FULL_EVERY_MS;
  if (conn.gcal_sync_token) {
    const w = await gcalTokenWalk({ syncToken: conn.gcal_sync_token }, token, 10);
    if (w) return { unchanged: !!recent && w.changed === 0, gated: true, changed: w.changed > 0, syncToken: w.syncToken };
  }
  if (await calendarUnchanged(conn, "google", token)) return { unchanged: true, gated: false };
  const made = await gcalTokenWalk({}, token, 20);
  return { unchanged: false, gated: false, syncToken: made ? made.syncToken : null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 652

// A mailbox token, refreshed through the same seam every other connection
// uses. Returns null rather than throwing so one broken mailbox never stops
// the tick for everybody else.
async function mailboxAccessToken(conn, orgId, providerKey) {
  try {
    const { openBag } = await import("../../shared/secretBox.js");
    const O = await import("../../shared/oauth.js");
    const bag = openBag(conn.credentials_sealed, { aad: orgId });
    const stale = O.needsRefresh(conn.token_expires_at ? new Date(conn.token_expires_at).toISOString() : null,
                                 new Date().toISOString());
    if (!stale) return bag.accessToken;
    if (!bag.refreshToken) throw new Error("no refresh token");
    const { values } = (() => {
      const names = O.ENV_VARS[providerKey] || {};
      const out = {};
      for (const [k, n] of Object.entries(names)) out[k] = process.env[n] || null;
      return { values: out };
    })();
    const spec = O.tokenRequest(providerKey, { refreshToken: bag.refreshToken,
      clientId: values.clientId, clientSecret: values.clientSecret });
    const r = await fetch(spec.url, { method: "POST",
      headers: { ...spec.headers, ...(spec.basic ? { Authorization: "Basic " + Buffer.from(spec.basic).toString("base64") } : {}) },
      body: spec.body });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error || `token endpoint ${r.status}`);
    const fresh = O.readTokens(body);
    if (!fresh) throw new Error("no access token");
    const { sealBag } = await import("../../shared/secretBox.js");
    const sealed = sealBag({ accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken || bag.refreshToken, scope: fresh.scope || null }, { aad: orgId });
    await run(`UPDATE mailbox_connections SET credentials_sealed=?, token_expires_at=?, updated_at=NOW() WHERE id=?`,
      [sealed, fresh.expiresInSeconds ? new Date(Date.now() + fresh.expiresInSeconds * 1000).toISOString() : null, conn.id]);
    return fresh.accessToken;
  } catch (e) {
    console.error(`[mailbox] ${providerKey} token for ${conn.id}:`, e.message);
    await run(`UPDATE mailbox_connections SET status='error', last_error=?, last_error_at=NOW() WHERE id=?`,
      ["That mailbox needs connecting again. Steward's permission was withdrawn or expired.", conn.id]).catch(() => {});
    return null;
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 655
async function fetchMailboxMessages(providerKey, token, donorEmails, { onProgress = null, clients = null } = {}) {
  const out = [];
  const seen = new Set();
  const CHUNK = 15, CAP = 120;
  let asked = 0, refused = 0, lastStatus = null, lastBody = null;
  const auth = { headers: { Authorization: "Bearer " + token } };
  // One request, counted: a refusal is a number the caller can act on, not a
  // null that reads as an empty mailbox.
  const ask = async (url, { soft = false } = {}) => {
    asked++;
    try {
      const r = await providerFetch(url, auth);
      // SCALE-2: a search Gmail found too long is split and asked again
      // (mailboxFetch.js), so it is neither an answer nor a refusal.
      if (soft && !r.ok && MBF.TOO_LONG.has(r.status)) { asked--; return { tooLong: true }; }
      if (!r.ok) {
        refused++; lastStatus = r.status; lastBody = await r.json().catch(() => null);
        console.error(`[mailbox] ${providerKey} answered ${r.status}`);
        // FIX-34: a 429 stops the run and the connection waits as long as it was told.
        if (r.status === 429) throw APIC.providerError(providerKey, "mail", 429, lastBody,
          APIC.retryAfterDate(r.headers.get("retry-after")) || new Date(Date.now() + 5 * 60e3));
        return null;
      }
      return await r.json();
    } catch (e) {
      if (e && e.reason) throw e;
      refused++; lastStatus = null; console.error(`[mailbox] ${providerKey} fetch:`, e.message); return null;
    }
  };
  const keep = m => { if (m && m.id && !seen.has(String(m.id)) && out.length < CAP) { seen.add(String(m.id)); out.push(m); } };
  const privacyGuard = !!(clients && clients.size);
  const addrIn = v => { const m = String(v || "").match(/<([^>]+)>/); return (m ? m[1] : String(v || "")).trim().toLowerCase(); };
  const involves = addrs => addrs.some(a => clients.has(addrIn(a)));
  const GRAPH_SELECT = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,hasAttachments,webLink,conversationId,internetMessageHeaders";
  if (providerKey === "google") {
    // Gmail's search covers every folder, so mail she SENT to a donor is in
    // this answer too; the SENT label is what marks it hers. SCALE-2: as many
    // addresses per search as Gmail will run, searches four ahead and message
    // fetches eight at a time, kept in the old order (mailboxFetch.js).
    // CLIENT-SAFE-1: with people marked as clients, each message's addresses
    // are read first and a message involving a client is never fetched.
    const allow = privacyGuard ? async id => {
      const h = await ask(`${GMAIL_BASE()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&fields=id,payload/headers`);
      if (!h) return false;
      return !involves((h.payload?.headers || []).filter(x => /^(from|to|cc)$/i.test(String(x.name || ""))).flatMap(x => String(x.value || "").split(",").map(addrIn)));
    } : null;
    for (const m of await MBF.readGmail({ ask, base: GMAIL_BASE(), emails: donorEmails, toMessage: gmailToMessage, cap: CAP, onProgress, allow })) keep(m);
    return { messages: out, asked, refused, lastStatus, lastBody };
  }
  // CLIENT-SAFE-1: Outlook lists addresses only, and the message itself is
  // fetched only when nobody on it is a client.
  const ADDR_SELECT = "id,from,toRecipients,ccRecipients";
  const listed = async (url, sent) => {
    const list = await ask(url.replace(`$select=${GRAPH_SELECT}`, `$select=${privacyGuard ? ADDR_SELECT : GRAPH_SELECT}`));
    for (const m of (list?.value || [])) {
      if (!privacyGuard) { keep(sent ? { ...graphToMessage(m), sent: true } : graphToMessage(m)); continue; }
      const addrs = [m.from?.emailAddress?.address, ...(m.toRecipients || []).map(r => r.emailAddress?.address), ...(m.ccRecipients || []).map(r => r.emailAddress?.address)].map(addrIn);
      if (involves(addrs) || out.length >= CAP || seen.has(String(m.id))) continue;
      const full = await ask(`${GRAPH_BASE()}/v1.0/me/messages/${encodeURIComponent(m.id)}?$select=${GRAPH_SELECT}`);
      if (full) keep(sent ? { ...graphToMessage(full), sent: true } : graphToMessage(full));
    }
  };
  for (let i = 0; i < donorEmails.length && out.length < CAP; i += CHUNK) {
    const chunk = donorEmails.slice(i, i + CHUNK);
    if (onProgress) await onProgress(i, donorEmails.length);
    {
      // FIX-33 · SENT MAIL LOGS TOO. Outlook was asked only for mail FROM a
      // person on file, so an email she sent a donor from Outlook was never
      // logged (GRANTS-1 found it). Sent Items is asked separately, by
      // RECIPIENT, so the provider still returns only messages that involve
      // somebody on file.
      const filter = chunk.map(e => `from/emailAddress/address eq '${e.replace(/'/g, "''")}'`).join(" or ");
      await listed(`${GRAPH_BASE()}/v1.0/me/messages?$top=40&$select=${GRAPH_SELECT}&$filter=${encodeURIComponent(filter)}`, false);
      const search = `"${chunk.map(e => `to:${e.replace(/"/g, "")}`).join(" OR ")}"`;
      await listed(`${GRAPH_BASE()}/v1.0/me/mailFolders/sentitems/messages?$top=40&$select=${GRAPH_SELECT}&$search=${encodeURIComponent(search)}`, true);
    }
  }
  return { messages: out, asked, refused, lastStatus, lastBody };
}
// SPLIT-2 end

__share({ processPledgeReminders, trialCanceled, getOrgAccessState, checkWriteAccess, billingCustomerColumn, checkBillingPriceModes, scheduleBillingModeCheck, signCancelToken, agentTrialAllowance, countRecords, bandOfPlan, monthKey, prevMonthKey, checkRecordBand, checkAllRecordBands, processRecordBands, applyAgreedBandMoves, sendTierNoticeEmail, processTrialReminders, effectivePlanLimits, checkPlanLimit, refreshMailboxSyncHealth, startSyncRun, finishSyncRun, syncErrorSentence, noteRetryAfter, syncMailbox, syncMailboxLocked, gmailHistoryNow, gmailUnchanged, syncMailboxRun, syncCalendar, syncCalendarLocked, syncCalendarRun, pushStewardDates, pushStewardDatesRun, fetchCalendarEvents, calRefusal, graphDeltaWalk, graphDeltaGate, saveGraphDelta, calendarUnchanged, gcalTokenWalk, googleCalendarGate, mailboxAccessToken, fetchMailboxMessages });
