// goingOut.js · SEND-GATE-2. WHAT IS GOING OUT: BEFORE AND AFTER.
//
//   nextDays   every automatic email Steward will send in the next 7 days if
//              nothing changes, grouped by email, with the people and the
//              day. Read from the same due dates the sweeps read (journey_sends
//              .send_on, sequence_enrollments.next_send_at, the pledge cadence,
//              campaigns.scheduled_at), and put through the same rule the gate
//              applies (mailTypes.holdReason), so a person this would not reach
//              is not listed. tests/send-gate-2.test.js moves the clock 7 days
//              and checks that exactly these send.
//   sentRows   every automatic email that went (auto_mail_sent), with what it said.
//   heldRows   every one Steward did not send (mail_blocked), and why.
//
// What it cannot see ahead, it says: receipts, card notes, confirmations and
// links depend on what donors do, so they are not counted before they happen.
"use strict";
const TYPES = require("./mailTypes");

const DAY = 86400000;
const PLEDGE_SCHEDULE_DAYS = [0, 3, 7, 14];   // server.js PLEDGE_REMINDER_SCHEDULE_DAYS
const civil = d => new Date(d).toISOString().slice(0, 10);
const NOT_AHEAD = "Receipts, card notes, confirmations and page links go when a donor does something, so Steward can't count them ahead. They show under Sent once they go. A journey step is skipped if the person gives first.";

// The journey runner's own skip rule (routes/crm.js autoSkipReason), handed in
// by crm.js so this file never restates it.
let journeySkip = null;
function setJourneySkip(fn) { journeySkip = fn; }

async function orgState(query, orgId) {
  const [o] = await query(`SELECT emails_enabled, timezone FROM orgs WHERE id = ?`, [orgId]);
  const types = new Map((await query(`SELECT type_key, is_on, audience FROM org_mail_types WHERE org_id = ?`, [orgId]))
    .map(r => [r.type_key, { on: r.is_on === true, audience: r.audience }]));
  const skips = new Set((await query(`SELECT type_key || ':' || donor_id AS k FROM mail_skips WHERE org_id = ? AND until > NOW()`, [orgId])).map(r => r.k));
  return { mailOn: !!o && o.emails_enabled === true, tz: (o && o.timezone) || "America/New_York", types, skips };
}

// One planned email: { typeKey, donorId, name, day, what }.
async function plannedEmails(ctx, orgId, days) {
  const { query, orgToday } = ctx;
  const st = await orgState(query, orgId);
  const today = orgToday(st.tz);   // ORG_TZ_SEAM_OK
  const lastDay = civil(new Date(today + "T12:00:00Z").getTime() + days * DAY);
  const horizon = new Date(Date.now() + days * DAY);
  const out = [];
  // Journey steps set to send on their own (processJourneyAutoSends), unless
  // the organization paused them, and minus anyone the runner would skip.
  const [paused] = await query(`SELECT auto_send_paused_at FROM orgs WHERE id = ?`, [orgId]);
  if (!(paused && paused.auto_send_paused_at)) {
    for (const r of await query(
      `SELECT j.donor_id, d.name, j.send_on, j.subject FROM journey_sends j JOIN donors d ON d.id = j.donor_id AND d.org_id = j.org_id
        WHERE j.org_id = ? AND j.status IN ('scheduled','failed') AND j.attempts < 3 AND j.send_on <= ?
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE`, [orgId, lastDay]).catch(() => [])) {
      const day = r.send_on < today ? today : r.send_on;
      if (journeySkip) {
        const [donor] = await query(`SELECT * FROM donors WHERE id = ? AND org_id = ?`, [r.donor_id, orgId]);
        const why = await journeySkip(orgId, donor, day).catch(() => null);
        if (why && why !== "org_wait") continue;
      }
      out.push({ typeKey: "journey_steps", donorId: r.donor_id, name: r.name, day, what: r.subject || "Journey step" });
    }
  }
  // Sequence steps (processTrackedSequences).
  for (const r of await query(
    `SELECT e.donor_id, d.name, e.next_send_at, s.name AS seq FROM sequence_enrollments e
       JOIN sequences s ON s.id = e.sequence_id AND s.org_id = e.org_id
       JOIN donors d ON d.id = e.donor_id AND d.org_id = e.org_id
      WHERE e.org_id = ? AND e.status = 'active' AND s.status = 'active' AND e.next_send_at <= ?
        AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE`, [orgId, horizon]).catch(() => [])) {
    out.push({ typeKey: "journey_steps", donorId: r.donor_id, name: r.name, day: civil(Math.max(Date.now(), new Date(r.next_send_at).getTime())), what: `${r.seq} step` });
  }
  // Pledge reminders: the same cadence processPledgeReminders keeps, from the
  // day a pledge first went overdue (or today, for one about to).
  const [org] = await query(`SELECT pledge_reminder_enabled FROM orgs WHERE id = ?`, [orgId]);
  if (!org || org.pledge_reminder_enabled !== false) {
    for (const r of await query(
      `SELECT p.id, p.donor_id, d.name, p.amount, p.due_date, p.first_overdue_at, p.next_reminder_at, COALESCE(p.reminder_step, 0) AS step
         FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE p.org_id = ? AND p.status = 'open' AND COALESCE(p.is_match,false) = false AND p.import_id IS NULL
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE AND d.email IS NOT NULL
          AND ((p.first_overdue_at IS NOT NULL AND p.next_reminder_at IS NOT NULL) OR (p.first_overdue_at IS NULL AND p.due_date::date < ?::date))`,
      [orgId, lastDay]).catch(() => [])) {
      const start = r.first_overdue_at ? new Date(r.first_overdue_at).getTime()
        : Math.max(Date.now(), new Date(String(r.due_date).slice(0, 10) + "T12:00:00Z").getTime() + DAY);
      for (let s = r.first_overdue_at ? Number(r.step) : 0; s < PLEDGE_SCHEDULE_DAYS.length; s++) {
        let at = start + PLEDGE_SCHEDULE_DAYS[s] * DAY;
        if (s === Number(r.step) && r.next_reminder_at) at = new Date(r.next_reminder_at).getTime();
        if (at > horizon.getTime()) break;
        out.push({ typeKey: "pledge_reminder", donorId: r.donor_id, name: r.name, day: civil(Math.max(Date.now(), at)),
          what: `Reminder for a $${Number(r.amount || 0).toLocaleString("en-US")} pledge` });
      }
    }
  }
  // Scheduled campaigns: one line each; the people are its list when it sends.
  const campaigns = (await query(
    `SELECT id, name, scheduled_at FROM campaigns WHERE org_id = ? AND status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at`,
    [orgId, horizon]).catch(() => [])).map(c => ({ id: c.id, name: c.name, day: civil(c.scheduled_at) }));
  return { st, out, campaigns, today, lastDay };
}

// The person's own setting, read once for everyone planned.
async function modes(query, orgId, donorIds) {
  if (!donorIds.length) return new Map();
  return new Map((await query(`SELECT id, auto_email, auto_email_never FROM donors WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, donorIds]))
    .map(r => [r.id, TYPES.modeOf(r)]));
}

async function nextDays(ctx, orgId, { days = 7, assumeMailOn = false } = {}) {
  const { st, out, campaigns, today, lastDay } = await plannedEmails(ctx, orgId, days);
  const m = await modes(ctx.query, orgId, [...new Set(out.map(o => o.donorId))]);
  const mailOn = assumeMailOn || st.mailOn;
  const going = out.filter(o => !TYPES.holdReason({ mailOn, type: st.types.get(o.typeKey) || null, mode: m.get(o.donorId) || "follows",
    skipped: st.skips.has(o.typeKey + ":" + o.donorId) }));
  const groups = [];
  for (const t of TYPES.TYPES) {
    const rows = going.filter(o => o.typeKey === t.key).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.name).localeCompare(String(b.name)));
    const camp = t.key === "campaign" && (st.types.get("campaign") || {}).on && mailOn ? campaigns : [];
    if (!rows.length && !camp.length) continue;
    groups.push({ typeKey: t.key, name: t.name, count: rows.length, people: rows, campaigns: camp });
  }
  return { from: today, to: lastDay, mailOn: st.mailOn, groups, total: groups.reduce((s, g) => s + g.count, 0), cantSee: NOT_AHEAD };
}

async function sentRows(ctx, orgId, { type = null, from = null, to = null, limit = 200 } = {}) {
  const rows = await ctx.query(
    `SELECT s.id, s.type_key, s.donor_id, s.subject, s.sent_at, d.name FROM auto_mail_sent s
       LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
      WHERE s.org_id = ? AND (?::text IS NULL OR s.type_key = ?) AND (?::date IS NULL OR s.sent_at >= ?::date)
        AND (?::date IS NULL OR s.sent_at < ?::date + 1)
      ORDER BY s.sent_at DESC LIMIT ?`, [orgId, type, type, from, from, to, to, limit]);
  return rows.map(r => ({ id: r.id, typeKey: r.type_key, typeName: (TYPES.BY_KEY[r.type_key] || {}).name || r.type_key,
    donorId: r.donor_id, name: r.name, subject: r.subject, sentAt: r.sent_at }));
}

async function heldRows(ctx, orgId, { limit = 200 } = {}) {
  const rows = await ctx.query(
    `SELECT b.id, b.kind, b.type_key, b.held_reason, b.what, b.subject, b.donor_id, b.created_at, d.name FROM mail_blocked b
       LEFT JOIN donors d ON d.id = b.donor_id AND d.org_id = b.org_id
      WHERE b.org_id = ? AND b.sent_at IS NULL ORDER BY b.created_at DESC LIMIT ?`, [orgId, limit]);
  return rows.map(r => {
    const t = TYPES.BY_KEY[r.type_key || TYPES.typeOfKind(r.kind)];
    return { id: r.id, typeKey: t ? t.key : null, typeName: t ? t.name : (TYPES.BY_HAND[r.kind] || "Email"),
      donorId: r.donor_id, name: r.name, what: r.what, subject: r.subject, at: r.created_at,
      reason: r.held_reason || "type_off", why: TYPES.reasonSentence(r.held_reason, t) };
  });
}

async function goingOut(ctx, orgId, filters = {}) {
  const [next, sent, held] = await Promise.all([nextDays(ctx, orgId), sentRows(ctx, orgId, filters), heldRows(ctx, orgId)]);
  return { next, sent, held, types: TYPES.TYPES.map(t => ({ key: t.key, name: t.name })) };
}

// A sample for the preview, when the org has not sent or held one yet.
const SAMPLES = {
  gift_receipt: ["Your donation receipt from {org}", "Thank you for your generous gift to {org}. Your official tax receipt is attached."],
  year_end: ["Your year-end giving statement from {org}", "Thank you for your generous gifts to {org} last year. Your year-end giving statement is attached."],
  recovered_thankyou: ["Thank you, your gift to {org} went through", "Your card worked this time, so your monthly gift to {org} is back on track. Thank you."],
  card_failed: ["Your gift to {org} didn't go through", "Your monthly gift to {org} was declined by your bank. You can update your card here in a minute."],
  card_expiring: ["Your card expires soon", "The card on your monthly gift to {org} expires soon. Nothing has gone wrong; update it here so your gift isn't interrupted."],
  recurring_change: ["Your monthly gift to {org} has changed", "This is to confirm the change to your monthly gift to {org}."],
  pledge_reminder: ["A quick reminder about your pledge to {org}", "Thank you again for your generous pledge to {org}. We wanted to check in: it was due recently, and we don't show a gift yet."],
  event_ticket: ["Your ticket for the event", "You're registered. Your ticket and the details are below."],
  waitlist_offer: ["A place has come free", "A place has come free at the event you were waiting for. It's yours if you'd like it."],
  auction_signin: ["Your auction sign-in link", "Here's your link to bid from this phone."],
  p2p_link: ["Your fundraising page for {org}", "Here's the link to manage your fundraising page for {org}."],
  journey_steps: ["A note from {org}", "The words of each step are the template you picked for it in the journey."],
  campaign: ["Your campaign's subject", "The words are the campaign you wrote."],
};
function sampleFor(key) {
  const [subject, body] = SAMPLES[key] || ["A note from {org}", ""];
  return { subject, html: `<div style="padding:22px;font-family:Helvetica,Arial,sans-serif;color:#0f1a12"><p>Hi Sam,</p><p>${body}</p><p>With gratitude,<br/>{org}</p></div>` };
}

module.exports = { setJourneySkip, nextDays, sentRows, heldRows, goingOut, sampleFor, plannedEmails, NOT_AHEAD };
