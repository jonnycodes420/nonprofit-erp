// server/volunteers/toSend.js · SENDS-2 items 1, 3 and 4. VOLUNTEERS, TO SEND.
//
// The drafts Steward writes for volunteers (reminders, thank-yous, messages)
// wait in milestone_drafts until a person sends them. Three rules live here:
//
//   · A REMINDER IS ONLY A REMINDER WHILE ITS SHIFT IS TOMORROW (org time). On
//     22 Nov a walk found 33 "Reminder for tomorrow" drafts for shifts already
//     past: the draft was keyed by sign-up and nothing ever expired it. Now the
//     hourly volunteer sweep sets one `expired` once its shift is not tomorrow,
//     the list never shows one, and a send refuses one even when asked by id.
//   · Every other volunteer draft older than 14 days is listed under Older drafts.
//   · More than one at a time goes through a send plan (server/mail/sendPlan.js,
//     kind "volunteer"): she sees every name before anything goes.
const SEND_PLAN = require("../mail/sendPlan");
const orgTime = require("../../orgTime");

const VOL_SOURCES = ["volunteer_reminder", "volunteer_thanks", "volunteer_message",
  "volunteer_confirm", "volunteer_miss_you", "volunteer_group_leader"];   // VOL-PAGE-1
const OLDER_DAYS = 14;
const AGE_RULE = `A reminder is listed only while its shift is tomorrow, and is set aside once the shift has passed. Any other draft older than ${OLDER_DAYS} days moves to Older drafts.`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = iso => { const [, m, d] = String(iso).split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "This volunteer";

// The shift date of a reminder draft: its slot, or the slot of the sign-up in
// its key (vol:reminder:<signup id>). SQL, so a list and a sweep read one rule.
const SHIFT_DATE_SQL = `(SELECT s.date FROM volunteer_slots s
   WHERE s.org_id = md.org_id AND s.id = COALESCE(md.slot_id,
     (SELECT su.slot_id FROM volunteer_signups su WHERE su.org_id = md.org_id AND su.id = substring(md.milestone_key from 14))))`;

async function tomorrowFor(ctx, orgId) {
  const today = ctx.orgToday(await ctx.orgTz(orgId));   // ORG_TZ_SEAM_OK
  return { today, tomorrow: orgTime.addDays(today, 1) };
}

// Why a reminder may not go, or null. `shiftDate` null (the shift is gone) is out of date too.
function reminderWhy(d, tomorrow, today) {
  if (d.source !== "volunteer_reminder") return null;
  if (d.shift_date === tomorrow) return null;
  const who = firstName(d.name);
  if (!d.shift_date) return `${who}'s shift is no longer on the schedule, so this reminder is out of date.`;
  return d.shift_date <= today
    ? `${who}'s shift was ${shortDate(d.shift_date)}, so this reminder is out of date.`
    : `${who}'s shift is ${shortDate(d.shift_date)}, not tomorrow, so this reminder is out of date.`;
}

// Drafts by id, with the person and (for a reminder) the shift date.
async function readDrafts(ctx, orgId, ids) {
  if (!ids.length) return [];
  return ctx.query(
    `SELECT md.id, md.donor_id, md.subject, md.body, md.source, md.status, md.created_at, d.name, d.email,
            CASE WHEN md.source = 'volunteer_reminder' THEN ${SHIFT_DATE_SQL} END AS shift_date
       FROM milestone_drafts md JOIN donors d ON d.id = md.donor_id AND d.org_id = md.org_id
      WHERE md.org_id = ? AND md.id = ANY(?) AND md.source = ANY(?)
      ORDER BY md.created_at, md.id`, [orgId, ids, VOL_SOURCES]);
}

// Refusals for a set of drafts about to go: Map(id → sentence).
async function refusals(ctx, orgId, drafts) {
  const { today, tomorrow } = await tomorrowFor(ctx, orgId);
  const out = new Map();
  for (const d of drafts) {
    const why = reminderWhy(d, tomorrow, today);
    if (why) out.set(d.id, why);
  }
  return out;
}

// The sweep: every waiting reminder whose shift is not tomorrow is set expired.
async function expireReminders(ctx, orgId) {
  const { tomorrow } = await tomorrowFor(ctx, orgId);
  const { changes } = await ctx.run(
    `UPDATE milestone_drafts md SET status = 'expired'
      WHERE md.org_id = ? AND md.status = 'pending_review' AND md.source = 'volunteer_reminder'
        AND ${SHIFT_DATE_SQL} IS DISTINCT FROM ?`, [orgId, tomorrow]);
  return changes || 0;
}
// The orgs with a reminder waiting, so a past shift's reminder expires even
// where no shift is near.
async function orgsWithReminders(ctx) {
  return (await ctx.query(`SELECT DISTINCT org_id AS id FROM milestone_drafts WHERE status = 'pending_review' AND source = 'volunteer_reminder'`, [])).map(r => r.id);
}

const fp = d => SEND_PLAN.fingerprint(d.subject, d.body, d.status, d.donor_id, d.email);

// The plan kind. `sendOne(req, draftRow)` is the route's one send (with its
// "not sent is not sent" bookkeeping), so a plan and a single press agree.
function registerPlanKind(ctx, sendOne) {
  SEND_PLAN.register("volunteer", {
    admin: false,
    noun: items => items.length && items.every(i => i.source === "volunteer_reminder") ? ["reminder", "reminders"]
      : items.length && items.every(i => i.source === "volunteer_thanks") ? ["thank-you", "thank-yous"] : ["email", "emails"],
    async build(req, ids) {
      const drafts = await readDrafts(ctx, req.user.orgId, ids);
      const why = await refusals(ctx, req.user.orgId, drafts);
      const items = [], refused = [];
      for (const d of drafts) {
        if (d.status !== "pending_review") refused.push({ ref: d.id, name: d.name, email: d.email, why: "Already sent or set aside." });
        else if (!d.email) refused.push({ ref: d.id, name: d.name, email: null, why: "There is no email address on this record." });
        else if (why.get(d.id)) refused.push({ ref: d.id, name: d.name, email: d.email, why: why.get(d.id) });
        else items.push({ ref: d.id, donorId: d.donor_id, name: d.name, email: d.email, subject: d.subject, source: d.source, fp: fp(d) });
      }
      return { items, refused };
    },
    async changed(req, items) {
      const now = await readDrafts(ctx, req.user.orgId, items.map(i => i.ref));
      const by = new Map(now.map(d => [d.id, d]));
      const why = await refusals(ctx, req.user.orgId, now);
      const out = new Map();
      for (const i of items) {
        const d = by.get(i.ref);
        if (!d || d.status !== "pending_review") out.set(i.ref, "it was sent, discarded or set aside since.");
        else if (why.get(d.id)) out.set(i.ref, why.get(d.id));
        else if (fp(d) !== i.fp) out.set(i.ref, "its words or address changed after you looked.");
      }
      return out;
    },
    async send(req, item) {
      const [d] = await ctx.query(`SELECT * FROM milestone_drafts WHERE org_id = ? AND id = ? AND status = 'pending_review'`, [req.user.orgId, item.ref]);
      if (!d) return { ok: false, error: "Already sent." };
      const r = await sendOne(req, d);
      return r.status === 200 ? { ok: true } : { ok: false, error: r.error };
    },
  });
}

module.exports = { VOL_SOURCES, OLDER_DAYS, AGE_RULE, SHIFT_DATE_SQL, reminderWhy, readDrafts, refusals, expireReminders, orgsWithReminders, registerPlanKind, tomorrowFor };
