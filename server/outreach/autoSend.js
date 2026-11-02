// server/outreach/autoSend.js — a journey step sent automatically (AUTO-1), what sends tomorrow, and journey sends.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const TL = require("../../timelineLine");
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  AUTO_ACTOR, AUTO_WINDOW, actor, advanceCultivationPlan, autoStepOn, bulkSendAddressGate, checkWriteAccess,
  donorMailDecision, journeyTemplateDraft, nextAutoSendDay, openAdminTask, orgSendClock, orgTime, orgToday,
  orgTz, query, registerJourneyNudge, requireAdmin, requireAuth, run, runJourneySweep, runLifecycleTriggers,
  sendStaffWrittenEmail, testMode, uuid, wrap,
} = ctx;
const AUTO_DAILY_CAP = () => Math.max(1, Number(process.env.AUTO_SEND_DAILY_CAP) || 200);
const AUTO_GIFT_QUIET_DAYS = 3;
const AUTO_TOUCH_DAYS = 7;
const AUTO_SKIP_WORDS = {
  client: "they are marked as a client, and privacy mode never writes to clients",
  unsubscribed: "they unsubscribed", bounced: "their email bounced", no_email: "there is no email address on file",
  do_not_contact: "they are marked do not contact", do_not_email: "they are marked do not email", deceased: "they are marked deceased",
  touched_this_week: "they already had a journey email this week", gave_recently: `they gave in the last ${AUTO_GIFT_QUIET_DAYS} days, so an ask must not cross a thank-you`,
  skipped_by_person: "somebody here skipped it", switched_off: "the step was switched off before it went",
  words_changed: "its words changed after it was turned on", step_closed: "the step was already done",
};
const AUTO_ORG_REASONS = new Set(["not_onboarded", "org_emails_disabled", "demo_org", "org_not_found", "org_gate_unreadable", "no_org"]);
Object.assign(AUTO_SKIP_WORDS, { blocked_address: "the address is on Steward's never-mail list", sample_donor: "they are sample data" });
const crypto_ = require("crypto");
const wordsHash = t => crypto_.createHash("sha256").update(String(t.subject || "") + "\u0000" + JSON.stringify(t.blocks || [])).digest("hex").slice(0, 32);
const inAutoWindow = c => !!c && AUTO_WINDOW.days.includes(c.weekday) && c.hour >= AUTO_WINDOW.startHour && c.hour < AUTO_WINDOW.endHour;
async function autoTimeline(orgId, donorId, send, note) {
  await TL.timelineLine({ orgId, donorId, actorId: AUTO_ACTOR.id, actorName: AUTO_ACTOR.name, note,
    key: `journey-auto:${send.id}:${send.status}`, metadata: { via: "journey_auto", send_id: send.id, step_id: send.step_id } }).catch(e => console.error("[auto-send] timeline:", e.message));
}

// The person's own reasons not to send, in the order the brief names them.
async function autoSkipReason(orgId, donor, priv, today) {
  if (!donor) return "step_closed";
  if (priv.on && (priv.clientIds.has(donor.id) || (donor.email && priv.clientEmails && priv.clientEmails.has(String(donor.email).toLowerCase())))) return "client";
  if (donor.deceased === true) return "deceased";
  if (donor.do_not_contact === true) return "do_not_contact";
  if (donor.do_not_email === true) return "do_not_email";
  if (!donor.email) return "no_email";
  const d = await donorMailDecision("sequence", donor.email, orgId);
  if (!d.send) {
    // The org's own mail being off is not this person's answer: it waits.
    if (AUTO_ORG_REASONS.has(d.reason)) return "org_wait";
    return AUTO_SKIP_WORDS[d.reason] ? d.reason : /bounc|unreach|complain/.test(String(d.reason)) ? "bounced" : "unsubscribed";
  }
  const [touch] = await query(`SELECT 1 FROM journey_sends WHERE org_id=? AND donor_id=? AND status='sent' AND sent_at > NOW() - INTERVAL '${AUTO_TOUCH_DAYS} days' LIMIT 1`, [orgId, donor.id]);
  if (touch) return "touched_this_week";
  const [gift] = await query(`SELECT 1 FROM gifts WHERE org_id=? AND donor_id=? AND amount > 0 AND LEFT(date,10) >= ? LIMIT 1`, [orgId, donor.id, orgTime.addDays(today, -AUTO_GIFT_QUIET_DAYS)]);
  if (gift) return "gave_recently";
  return null;
}

// SEND-GATE-2: Going out asks the same question about a step that is due
// in the next 7 days, so what it lists is what this runner would send.
require("../../goingOut").setJourneySkip(async (orgId, donor, day) =>
  autoSkipReason(orgId, donor, await require("../../clientSafe").privacyFor(orgId), day));

async function skipAutoSend(orgId, send, reason, byName = null) {
  const took = await run(`UPDATE journey_sends SET status='skipped', reason=?, decided_by_name=?, updated_at=NOW() WHERE id=? AND org_id=? AND status IN ('scheduled','failed')`,
    [reason, byName, send.id, orgId]);
  if (!took || !took.changes) return false;
  await autoTimeline(orgId, send.donor_id, { ...send, status: "skipped" },
    `Journey email not sent automatically: ${AUTO_SKIP_WORDS[reason] || reason}.${byName ? ` Skipped by ${byName}.` : ""} The step stays on the Thread for you.`);
  return true;
}

// THE TICK. `now` is pinned only under TEST_MODE (the BUILD-94 rule).
async function processJourneyAutoSends({ orgId = null, now = new Date(), limit = 500, cap = null } = {}) {
  const MP = require("../../mailPolicy");
  const out = { sent: 0, skipped: 0, held: 0, waited: 0, failed: 0, capped: 0 };
  const due = await query(
    `SELECT js.*, o.auto_send_paused_at, o.timezone_confirmed_at FROM journey_sends js JOIN orgs o ON o.id = js.org_id
      WHERE js.status IN ('scheduled','failed') AND js.attempts < 3 ${orgId ? "AND js.org_id = ?" : ""} AND ${MP.orgSendsSql("o")}
      ORDER BY js.send_on, js.created_at LIMIT ${Number(limit) | 0}`, orgId ? [orgId] : []);
  const byOrg = new Map();
  for (const r of due) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
  for (const [oid, list] of byOrg) {
    if (list[0].auto_send_paused_at || !list[0].timezone_confirmed_at) { out.waited += list.length; continue; }
    const clock = await orgSendClock(oid, now);
    const ready = list.filter(s => String(s.send_on) <= clock.date);
    if (!ready.length) continue;
    if (!inAutoWindow(clock)) { out.waited += ready.length; continue; }
    if (!(await bulkSendAddressGate(oid)).ok) { out.waited += ready.length; continue; }
    const priv = await require("../../clientSafe").privacyFor(oid);
    const [{ n: sentToday }] = await query(`SELECT COUNT(*)::int AS n FROM journey_sends WHERE org_id=? AND status='sent' AND sent_day=?`, [oid, clock.date]);
    const dayCap = cap != null ? Number(cap) : AUTO_DAILY_CAP();
    let room = dayCap - sentToday;
    for (const send of ready) {
      try {
        const [step] = await query(`SELECT s.*, p.status AS plan_status, p.template_name FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id WHERE s.id=? AND s.org_id=?`, [send.step_id, oid]);
        if (!step || step.status !== "open" || step.plan_status !== "active") { await skipAutoSend(oid, send, "step_closed"); out.skipped++; continue; }
        const on = await autoStepOn(oid, send.template_id, send.seq);
        const t = await emailCompose.templateFor(oid, send.email_template_id);
        if (!on || on.id !== send.auto_step_id || !t) {
          await skipAutoSend(oid, send, "switched_off"); out.skipped++;
          await journeyTemplateDraft(oid, send.donor_id, step).catch(() => {});   // back to a draft she sends herself
          continue;
        }
        if (wordsHash(t) !== on.words_hash) {
          await skipAutoSend(oid, send, "words_changed"); out.skipped++;
          await journeyTemplateDraft(oid, send.donor_id, step).catch(() => {});
          continue;
        }
        const [donor] = await query(`SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [send.donor_id, oid]);
        const why = await autoSkipReason(oid, donor, priv, clock.date);
        if (why === "org_wait") { out.waited++; continue; }
        if (why) { await skipAutoSend(oid, send, why); out.skipped++; continue; }
        // AN EMPTY OR BROKEN MERGE FIELD: held for this person, and a task.
        const gaps = await emailCompose.templateMergeGaps(oid, t, donor);
        if (gaps.length) {
          const fieldList = gaps.map(g => `{{${g.token}}}`).join(", ");
          const took = await run(`UPDATE journey_sends SET status='held', reason=?, updated_at=NOW() WHERE id=? AND status IN ('scheduled','failed')`, [`merge:${gaps.map(g => g.token).join(",")}`, send.id]);
          if (took && took.changes) {
            await autoTimeline(oid, send.donor_id, { ...send, status: "held" }, `Journey email held, not sent: ${fieldList} ${gaps.length === 1 ? "is" : "are"} empty or unknown for this person. A task asks someone to write it by hand.`);
            if (openAdminTask) await openAdminTask(oid, { title: `Write to ${donor.name} by hand: the "${step.template_name}" email needs ${fieldList}, which their record does not have`,
              donorId: donor.id, actorId: AUTO_ACTOR.id, actorName: AUTO_ACTOR.name }).catch(() => {});
          }
          out.held++; continue;
        }
        // THE DAILY CAP: the rest wait for the next morning, and the owner hears once.
        if (room <= 0) {
          out.capped++;
          const [o] = await query(`SELECT auto_send_cap_noted_on FROM orgs WHERE id=?`, [oid]);
          if (o && o.auto_send_cap_noted_on !== clock.date) {
            await run(`UPDATE orgs SET auto_send_cap_noted_on=? WHERE id=?`, [clock.date, oid]);
            if (openAdminTask) await openAdminTask(oid, { title: `Steward sent ${dayCap} journey emails today, its daily limit. The rest wait for the next weekday morning.`,
              actorId: AUTO_ACTOR.id, actorName: AUTO_ACTOR.name }).catch(() => {});
          }
          continue;
        }
        // THE CLAIM, before the provider. A second tick finds it taken.
        const claim = await run(`UPDATE journey_sends SET status='claimed', attempts=attempts+1, updated_at=NOW() WHERE id=? AND status IN ('scheduled','failed')`, [send.id]);
        if (!claim || !claim.changes) continue;
        const words = await emailCompose.templateTextFor(oid, t, donor);
        const r = await sendStaffWrittenEmail(oid, donor, words.subject || step.label, words.body, "sequence");
        if (!r.delivered) {
          await run(`UPDATE journey_sends SET status='failed', error=?, updated_at=NOW() WHERE id=?`, [String(r.errText || "unknown").slice(0, 300), send.id]);
          console.error(`[auto-send] ${send.id} failed: ${r.errText}`);
          out.failed++; continue;
        }
        room--;
        const turnedOn = on.turned_on_at ? new Date(on.turned_on_at).toISOString().slice(0, 10) : "";
        const iid = "i_" + uuid().slice(0, 10);
        await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,'email',?,?,?,?,?)`,
          [iid, oid, donor.id, `Journey: ${step.template_name}, step ${Number(send.seq) + 1}, sent automatically, turned on by ${on.turned_on_by_name || "someone here"}${turnedOn ? ` on ${turnedOn}` : ""} · ${r.subject}`,
           clock.date, AUTO_ACTOR.id, AUTO_ACTOR.name, JSON.stringify({ via: "journey_auto", send_id: send.id, step_id: step.id, plan_id: step.plan_id, sent_automatically: true, direction: "outbound" })]);
        await run(`UPDATE journey_sends SET status='sent', sent_at=NOW(), sent_day=?, subject=?, interaction_id=?, error=NULL, updated_at=NOW() WHERE id=?`, [clock.date, r.subject, iid, send.id]);
        // The step is done, as a person's logged email makes it, and the next one opens.
        if (step.thread_id) await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=? WHERE id=? AND org_id=? AND closed_at IS NULL`, [iid, step.thread_id, oid]).catch(e => console.error("[auto-send] close:", e.message));
        await run(`UPDATE cultivation_plan_steps SET status='done', closed_at=NOW(), closed_by=?, closed_by_name=?, done_note=? WHERE id=? AND status='open'`,
          [AUTO_ACTOR.id, AUTO_ACTOR.name, "Sent automatically.", step.id]);
        await require("../../middleware/auditTrail").insertAuditRow({ orgId: oid, actorId: AUTO_ACTOR.id, actorName: AUTO_ACTOR.name, actorKind: "system",
          action: "send", entityType: "journey_send", entityId: send.id, entityLabel: step.template_name,
          summary: `Sent automatically: "${r.subject}" to one person, journey "${step.template_name}" step ${Number(send.seq) + 1}, turned on by ${on.turned_on_by_name || "someone here"}`,
          changes: { donor_id: donor.id }, method: "TICK", path: "processJourneyAutoSends", status: 200 }).catch(e => console.error("[auto-send] audit:", e.message));
        await advanceCultivationPlan(oid, donor.id, { actorId: AUTO_ACTOR.id, actorName: AUTO_ACTOR.name, today: clock.date }).catch(e => console.error("[auto-send] advance:", e.message));
        out.sent++;
      } catch (e) { console.error("[auto-send]", send.id, e.message); out.failed++; }
    }
  }
  return out;
}
if (process.env.DISABLE_BACKGROUND_TICKS !== "1") {
  require("../../jobQueue").define("processJourneyAutoSends", { everyMs: 5 * 60 * 1000, firstMs: 60000, run: () => processJourneyAutoSends() });
}

// ── AUTO-1 · THE ROUTES ────────────────────────────────────────────────────
// Who may turn a step on: an owner or admin of this org, signed in as
// themselves. Never a super-admin (support) and never the Agent.
// The person's own name for "turned on by" (actor() carries the sign-in email).
async function staffName(req) {
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]).catch(() => []);
  return (u && u.name) || actor(req).name;
}
function autoTurnOnRefusal(req) {
  if (req.user.isSuperAdmin) return { status: 403, body: { error: "turn_on_must_be_theirs", sentence: "Turning automatic sending on has to be done by an owner or admin of this organization." } };
  if (req.headers["x-steward-agent"]) return { status: 403, body: { error: "not_the_agent", sentence: "The Agent cannot turn automatic sending on. A person here has to." } };
  return null;
}
const dayWordsAuto = (day, today) => {
  if (day === orgTime.addDays(today, 1)) return "tomorrow";
  const d = new Date(day + "T12:00:00Z");
  return "on " + d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
};
async function journeyRow(orgId, id) {
  const [t] = await query(`SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL`, [id, orgId]);
  return t || null;
}
const stepsOf = t => (Array.isArray(t.steps) ? t.steps : (() => { try { return JSON.parse(t.steps || "[]"); } catch { return []; } })());
// What turning step `seq` on would mean: its words, who saved them, and roughly
// how many people it reaches in the next seven days.
async function autoStepState(orgId, t, seq) {
  const st = stepsOf(t)[seq];
  if (!st) return null;
  const tid = String(st.draft || "").startsWith("template:") ? String(st.draft).slice(9) : null;
  const on = await autoStepOn(orgId, t.id, seq);
  const out = { seq, label: st.label, email: !!tid, on: !!on, turnedOnByName: on ? on.turned_on_by_name : null, turnedOnAt: on ? on.turned_on_at : null };
  if (!tid) return { ...out, canTurnOn: false, reason: "Only a step that sends one of your email templates can send itself." };
  const tpl = await emailCompose.templateFor(orgId, tid);
  if (!tpl) return { ...out, canTurnOn: false, reason: "This step's email template is not there any more." };
  const [org] = await query(`SELECT timezone_confirmed_at, auto_send_paused_at, org_kind FROM orgs WHERE id=?`, [orgId]);
  const words = await emailCompose.templateTextFor(orgId, tpl, { id: null, name: "Margaret Chen", email: "" });
  const today = orgToday(await orgTz(orgId));
  const [{ n }] = await query(
    `SELECT COUNT(DISTINCT s.plan_id)::int AS n FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id JOIN donors d ON d.id = p.donor_id
      WHERE s.org_id=? AND p.template_id=? AND s.seq=? AND p.status='active' AND s.status IN ('pending','open') AND s.due_date <= ?
        AND d.deleted_at IS NULL AND COALESCE(d.email,'') <> ''`, [orgId, t.id, seq, orgTime.addDays(today, 7)]);
  const changed = on && on.words_hash !== wordsHash(tpl);
  let reason = null;
  if (!org || !org.timezone_confirmed_at) reason = "Confirm your organization's time zone in Settings first: automatic emails go on weekday mornings where you are.";
  else if (!tpl.words_saved_by) reason = `Open "${tpl.name}" and save its words yourself first. Only words someone here has saved can send automatically; starting words and drafted suggestions cannot.`;
  return { ...out, canTurnOn: !reason, reason, wordsChanged: !!changed,
    template: { id: tpl.id, name: tpl.name, savedByName: tpl.words_saved_by_name || null, savedAt: tpl.words_saved_at || null },
    words: { subject: words.subject, body: words.body, sampleName: "Margaret Chen" },
    aboutNext7Days: n, demo: require("../../mailPolicy").isDemoOrg(org || {}), paused: !!(org && org.auto_send_paused_at),
    sentence: `About ${n} ${n === 1 ? "person" : "people"} will get this in the next 7 days.` };
}
let app = routers.r1;

app.get("/journeys/:id/auto", requireAuth, wrap(async (req, res) => {
  const t = await journeyRow(req.user.orgId, req.params.id);
  if (!t) return res.status(404).json({ error: "Journey not found" });
  const steps = [];
  for (let i = 0; i < stepsOf(t).length; i++) steps.push(await autoStepState(req.user.orgId, t, i));
  res.json({ steps: steps.filter(Boolean) });
}));

app.post("/journeys/:id/steps/:seq/auto", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const no = autoTurnOnRefusal(req);
  if (no) return res.status(no.status).json(no.body);
  const t = await journeyRow(orgId, req.params.id);
  if (!t) return res.status(404).json({ error: "Journey not found" });
  const seq = Number(req.params.seq);
  const state = Number.isInteger(seq) ? await autoStepState(orgId, t, seq) : null;
  if (!state) return res.status(404).json({ error: "Step not found" });
  const who = { id: actor(req).id, name: await staffName(req) };
  if (req.body && req.body.on === true) {
    if (!state.canTurnOn) return res.status(409).json({ error: "cannot_turn_on", sentence: state.reason });
    if (req.body.confirm !== true) return res.status(400).json({ error: "confirm_first", sentence: "Read the email and confirm before turning this on." });
    const tpl = await emailCompose.templateFor(orgId, state.template.id);
    if (state.on) await run(`UPDATE journey_auto_steps SET turned_off_at=NOW(), turned_off_by_name=? WHERE org_id=? AND template_id=? AND seq=? AND turned_off_at IS NULL`, [who.name, orgId, t.id, seq]);
    await run(`INSERT INTO journey_auto_steps (id,org_id,template_id,seq,email_template_id,words_hash,turned_on_by,turned_on_by_name,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["jauto_" + uuid().slice(0, 10), orgId, t.id, seq, tpl.id, wordsHash(tpl), who.id, who.name, who.id, who.name]);
    if (req.audit) req.audit.summary(`Turned on automatic sending for "${t.name}" step ${seq + 1}: "${state.words.subject}". ${state.sentence}`);
  } else {
    await run(`UPDATE journey_auto_steps SET turned_off_at=NOW(), turned_off_by_name=? WHERE org_id=? AND template_id=? AND seq=? AND turned_off_at IS NULL`, [who.name, orgId, t.id, seq]);
    // What was waiting goes back to a draft she sends herself.
    const waiting = await query(`SELECT * FROM journey_sends WHERE org_id=? AND template_id=? AND seq=? AND status IN ('scheduled','failed')`, [orgId, t.id, seq]);
    for (const s of waiting) {
      if (await skipAutoSend(orgId, s, "switched_off", who.name)) {
        const [step] = await query(`SELECT * FROM cultivation_plan_steps WHERE id=? AND org_id=?`, [s.step_id, orgId]);
        if (step) await journeyTemplateDraft(orgId, s.donor_id, step).catch(() => {});
      }
    }
    if (req.audit) req.audit.summary(`Turned off automatic sending for "${t.name}" step ${seq + 1}`);
  }
  res.json({ step: await autoStepState(orgId, t, seq) });
}));

// SENDING TOMORROW: every send waiting for the next weekday morning.
async function sendingNext(orgId, templateId = null) {
  const today = orgToday(await orgTz(orgId));
  // The next morning anything goes: tomorrow, or the first later weekday a
  // waiting send is due on (a step due Friday shows as "on Friday").
  const soonest = nextAutoSendDay(today, null);
  const [m] = await query(`SELECT MIN(send_on) AS d FROM journey_sends WHERE org_id=? AND status='scheduled' ${templateId ? "AND template_id = ?" : ""}`,
    templateId ? [orgId, templateId] : [orgId]);
  const day = m && m.d && String(m.d) > soonest ? String(m.d) : soonest;
  const rows = await query(
    `SELECT js.id, js.donor_id, js.seq, js.send_on, js.template_id, d.name, t.name AS journey_name, et.subject AS subject
       FROM journey_sends js JOIN donors d ON d.id = js.donor_id JOIN cultivation_templates t ON t.id = js.template_id
       LEFT JOIN email_templates et ON et.id = js.email_template_id
      WHERE js.org_id=? AND js.status='scheduled' AND js.send_on <= ? ${templateId ? "AND js.template_id = ?" : ""}
      ORDER BY d.name`, templateId ? [orgId, day, templateId] : [orgId, day]);
  const [org] = await query(`SELECT auto_send_paused_at, auto_send_paused_by_name, org_kind FROM orgs WHERE id=?`, [orgId]);
  return { day, when: dayWordsAuto(day, today), time: "9 AM", paused: !!(org && org.auto_send_paused_at), pausedByName: org && org.auto_send_paused_by_name,
    demo: require("../../mailPolicy").isDemoOrg(org || {}),
    sends: await Promise.all(rows.map(async (r, i) => ({ id: r.id, donorId: r.donor_id, name: r.name, journey: r.journey_name, step: Number(r.seq) + 1,
      // Each person's own subject line, as it will read (the first hundred; past that, the template's).
      subject: i < 100 ? await subjectForPerson(orgId, r).catch(() => r.subject || "") : (r.subject || "") }))) };
}
async function subjectForPerson(orgId, r) {
  const [js] = await query(`SELECT email_template_id FROM journey_sends WHERE id=? AND org_id=?`, [r.id, orgId]);
  const t = js && await emailCompose.templateFor(orgId, js.email_template_id);
  const [d] = t ? await query(`SELECT * FROM donors WHERE id=? AND org_id=?`, [r.donor_id, orgId]) : [];
  return t && d ? (await emailCompose.templateTextFor(orgId, t, d)).subject : (r.subject || "");
}
app.get("/journeys/:id/sending-tomorrow", requireAuth, wrap(async (req, res) => {
  if (!(await journeyRow(req.user.orgId, req.params.id))) return res.status(404).json({ error: "Journey not found" });
  res.json(await sendingNext(req.user.orgId, req.params.id));
}));
app.post("/journey-sends/:id/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [s] = await query(`SELECT * FROM journey_sends WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (!(await skipAutoSend(req.user.orgId, s, "skipped_by_person", await staffName(req)))) return res.status(409).json({ error: "not_waiting", sentence: "This one is not waiting to send any more." });
  res.json({ ok: true, sentence: "Skipped. It will not send, and the step stays on the Thread." });
}));
app.post("/journeys/:id/sending-tomorrow/skip-all", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  if (!(await journeyRow(req.user.orgId, req.params.id))) return res.status(404).json({ error: "Journey not found" });
  const list = await sendingNext(req.user.orgId, req.params.id);
  let n = 0;
  for (const s of list.sends) {
    const [row] = await query(`SELECT * FROM journey_sends WHERE id=? AND org_id=?`, [s.id, req.user.orgId]);
    if (row && await skipAutoSend(req.user.orgId, row, "skipped_by_person", await staffName(req))) n++;
  }
  if (req.audit) req.audit.summary(`Skipped all ${n} automatic emails waiting to send`, { count: n });
  res.json({ ok: true, skipped: n, sentence: `Skipped ${n}. None of them will send.` });
}));
// The one line on the Thread the night before.
app.get("/journey-sends/notice", requireAuth, wrap(async (req, res) => {
  const s = await sendingNext(req.user.orgId);
  if (!s.sends.length) return res.json({ notice: null });
  const n = s.sends.length, em = n === 1 ? "email" : "emails";
  res.json({ notice: { count: n, sentence: s.demo ? `${n} journey ${em} would send ${s.when}, but this is a demonstration organization, so nothing is sent.`
    : s.paused ? `Automatic sending is paused: ${n} journey ${em} ${n === 1 ? "is" : "are"} waiting.`
    : `Steward will send ${n} ${em} ${s.when} at 9 AM.`, step: "See who" } });
}));
// PAUSE ALL AUTOMATIC SENDING. It takes effect at once: the tick reads it on
// every pass, before anything is claimed.
app.get("/auto-send/settings", requireAuth, wrap(async (req, res) => {
  const [o] = await query(`SELECT auto_send_paused_at, auto_send_paused_by_name FROM orgs WHERE id=?`, [req.user.orgId]);
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM journey_auto_steps WHERE org_id=? AND turned_off_at IS NULL`, [req.user.orgId]);
  res.json({ paused: !!(o && o.auto_send_paused_at), pausedAt: o && o.auto_send_paused_at, pausedByName: o && o.auto_send_paused_by_name, stepsOn: n });
}));
app.post("/auto-send/pause", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const paused = !!(req.body && req.body.paused);
  await run(`UPDATE orgs SET auto_send_paused_at=${paused ? "NOW()" : "NULL"}, auto_send_paused_by_name=? WHERE id=?`, [paused ? await staffName(req) : null, req.user.orgId]);
  if (req.audit) req.audit.summary(paused ? "Paused all automatic sending" : "Turned automatic sending back on");
  res.json({ paused, sentence: paused ? "All automatic sending is paused. Nothing sends until you turn it back on." : "Automatic sending is back on." });
}));
// The tick by hand. `now` is pinned only under TEST_MODE.
app.post("/journey-sends/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const pinned = (testMode() && req.body && req.body.now) ? new Date(req.body.now) : undefined;
  const cap = (testMode() && req.body && Number.isInteger(req.body.cap)) ? req.body.cap : null;   // a suite proves the cap without 201 people
  res.json(await processJourneyAutoSends({ orgId: req.user.orgId, ...(pinned ? { now: pinned } : {}), ...(cap != null ? { cap } : {}) }));
}));

// JOURNEYS-4 · AT ONCE, NOT AN HOUR LATER. A staff write (recording a winner,
// marking a no-show, finishing a call) checks this org's armed sweep triggers
// a moment later. Coalesced per org, so a burst of writes is one check. The
// event keys make it safe beside the hourly sweep: nothing enrols twice.
const _journeyNudges = new Map();
function nudgeJourneys(orgId) {
  if (!orgId || _journeyNudges.has(orgId)) return;
  const t = setTimeout(async () => {
    _journeyNudges.delete(orgId);
    try { await runLifecycleTriggers(orgId, orgToday(await orgTz(orgId))); }   // ORG_TZ_SEAM_OK
    catch (e) { console.error(`[journey] nudge ${orgId}:`, e.message); }
  }, 1200);
  if (t.unref) t.unref();
  _journeyNudges.set(orgId, t);
}
registerJourneyNudge(nudgeJourneys);
if (process.env.DISABLE_BACKGROUND_TICKS !== "1") {
  // SCALE-1: a queue job (jobQueue.js), so one replica runs it, not each.
  require("../../jobQueue").define("runJourneySweep", { everyMs: 60 * 60 * 1000, firstMs: 90000, run: () => runJourneySweep() });
}
}

module.exports = { routers, mount };
