// server/outreach/journeys.js — journeys: the list, editing, preview, apply and undo, the lifecycle sweep, and a person's journeys.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { orgTzSql, orgTodaySql, orgDateOfSql } = require("../../orgTime");   // CLOCK-1: the org's day, not the database's
const DTAGS = require("../../donorTags");   // FIX-33: internal flags never reach a screen as tags
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");
const { withoutInternalNotes } = require("../../shared/giftWords.js");   // FEEL-1: no build's note in her copy
const JBO = require("./journeyBatchOptions");   // FLOWS-1: who of the checked people can start each journey
const JA = require("./journeyActive");          // FLOWS-3: only an Active journey starts people
const JBP = require("./journeyBatchPeople");    // FLOWS-3: the batch preview, person by person

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  GR, JOURNEY_ACTOR, OU, actor, advanceCultivationPlan, audienceClauses, checkWriteAccess, journeyMod,
  journeyTouchGap, lifecycleRows, maybeStartJourney, orgOwns, orgTime, orgToday, orgTz, planMod, query,
  requireAdmin, requireAuth, run, runJourneySweep, sentenceMoney, uuid, wrap,
} = ctx;

// JOURNEYS-4 · A TRIGGER WITH NOTHING TO READ STAYS OFF. Only the email
// trigger can be in this state: no opens or clicks on file, from Steward or
// Mailchimp. Switching it on is refused with the sentence that says why.
async function journeyCannotRun(orgId, trigger) {
  if (trigger !== "email_engaged_no_gift") return null;
  const a = await emailOpenAvailability(orgId);
  return a.ok ? null : { error: "no_open_data", message: a.sentence };
}

// A journey may name a group, a fund or a campaign. Each must be this org's,
// or the save is refused as not found (the tenant rule: never confirm another
// org's id exists).
async function journeyRefsRefused(orgId, v) {
  const tf = v.triggerFilters || {};
  for (const gid of [tf.groupId, (v.audience || {}).groupId].filter(Boolean)) {
    if (!(await GR.groupById(orgId, gid))) return { error: "group_not_found", message: "That group is not one of yours." };
  }
  if (tf.fundId && !(await orgOwns("fin_funds", tf.fundId, orgId))) return { error: "fund_not_found", message: "That fund is not one of yours." };
  if (tf.campaignId && !(await orgOwns("campaigns", tf.campaignId, orgId)))
    return { error: "campaign_not_found", message: "That campaign is not one of yours." };
  // EMAIL-1 — a step's draft that names a template names one of THIS org's.
  for (const st of v.steps || []) {
    const tid = String(st.draft || "").startsWith("template:") ? String(st.draft).slice(9) : null;
    if (tid && !(await emailCompose.templateFor(orgId, tid)))
      return { error: "template_not_found", message: "A step names an email template that is not one of yours." };
  }
  return null;
}
// Switching on a "joins a group" journey on a group by rule: today's members
// are the starting line, so it fires on people who join from now on and not
// on everybody already in it.
async function baselineJourneyGroup(orgId, v) {
  if (v.trigger !== "joined_group" || !(v.triggerFilters || {}).groupId) return;
  const g = await GR.groupById(orgId, v.triggerFilters.groupId);
  if (g && g.kind === "dynamic") await GR.baselineGroup(orgId, g).catch(e => console.error("[journey] group baseline:", e.message));
}
// JOURNEYS-4 · DOES THIS ORG HAVE ANY OPENS TO READ?
async function emailOpenAvailability(orgId) {
  const J = await journeyMod();
  const [r] = await query(
    `SELECT (SELECT COUNT(*) FROM campaign_recipients WHERE org_id=? AND opened_at IS NOT NULL)::int AS steward,
            (SELECT COUNT(*) FROM email_marketing_activity WHERE org_id=? AND (opened OR clicked))::int AS mailchimp`,
    [orgId, orgId]).catch(() => [{ steward: 0, mailchimp: 0 }]);
  return J.emailTriggerAvailability({ stewardOpens: r.steward, mailchimpOpens: r.mailchimp });
}
let app = routers.r1;

// PARITY-3 6a — the morning look, run now for the caller's own org only, so
// a birthday or anniversary journey can be checked without waiting an hour.
// It starts only what the hourly sweep would start anyway (every plan holds
// its event key, so running it twice starts nothing twice).
app.post("/journeys/run-sweep", requireAuth, requireAdmin, wrap(async (req, res) => {
  // DATES-1 — TEST_MODE only: `now` (an instant) pins the clock, so a suite can
  // run the morning look on Nov 30 and Dec 1 in the org's own zone.
  const at = process.env.TEST_MODE === "1" && req.body && req.body.now && !isNaN(Date.parse(String(req.body.now)))
    ? new Date(String(req.body.now)) : undefined;
  const fired = await runJourneySweep(req.user.orgId, { at });
  res.json({ fired });
}));

// ── THREAD-2a · THE JOURNEY ROUTES ────────────────────────────────────────
// Journeys live at Settings → Journeys and are reachable from Fundraising.
// They read and write `cultivation_templates`, because a journey IS one.

// The catalogue: the five presets, the triggers, and what this org has armed.
app.get("/journeys", requireAuth, wrap(async (req, res) => {
  const J = await journeyMod();
  const rows = await query(
    `SELECT * FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY priority DESC, name`,
    [req.user.orgId]);
  // How many people are in each one right now, and how the steps are going.
  const counts = await query(
    `SELECT p.template_id,
            COUNT(*) FILTER (WHERE p.status='active')                       AS active,
            COUNT(*) FILTER (WHERE p.status='done')                         AS completed,
            COUNT(*) FILTER (WHERE p.status='abandoned')                    AS exited,
            COUNT(*)                                                        AS ever
       FROM cultivation_plans p WHERE p.org_id=? AND p.template_id IS NOT NULL
      GROUP BY p.template_id`, [req.user.orgId]);
  const byTpl = new Map(counts.map(c => [c.template_id, c]));
  // AUTO-1: what each journey sent on its own, and what waits to.
  const autoCounts = new Map((await query(
    `SELECT template_id, COUNT(*) FILTER (WHERE status='sent')::int AS sent, COUNT(*) FILTER (WHERE status='scheduled')::int AS waiting,
            COUNT(*) FILTER (WHERE status IN ('skipped','held'))::int AS skipped
       FROM journey_sends WHERE org_id=? GROUP BY template_id`, [req.user.orgId]).catch(() => [])).map(r => [r.template_id, r]));
  const autoOnBy = new Map();
  for (const r of await query(`SELECT template_id, seq FROM journey_auto_steps WHERE org_id=? AND turned_off_at IS NULL ORDER BY seq`, [req.user.orgId]).catch(() => [])) {
    if (!autoOnBy.has(r.template_id)) autoOnBy.set(r.template_id, []);
    autoOnBy.get(r.template_id).push(Number(r.seq));
  }
  // "Nothing is sent without you" stops being true the moment a step sends itself.
  const autoSentence = seqs => `${seqs.length === 1 ? "Step" : "Steps"} ${seqs.map(x => x + 1).join(" and ")} ${seqs.length === 1 ? "sends itself" : "send themselves"} on weekday mornings; nothing else is sent without you.`;
  // FIX-4 1c — the stages and tags this org actually uses, so the audience
  // controls offer what is on file rather than a list somebody has to type
  // from memory. Read here, once, beside the filters they belong to.
  const stageRows = await query(
    `SELECT DISTINCT stage FROM donors WHERE org_id=? AND deleted_at IS NULL AND stage IS NOT NULL AND stage <> '' ORDER BY stage`,
    [req.user.orgId]).catch(() => []);
  const tagRows = await query(
    `SELECT DISTINCT btrim(tg) AS tag FROM donors d,
       LATERAL jsonb_array_elements_text(
         CASE WHEN coalesce(d.tags,'') ~ '^\\s*\\[' THEN d.tags::jsonb ELSE '[]'::jsonb END) AS tg
      WHERE d.org_id=? AND d.deleted_at IS NULL AND btrim(tg) <> '' ORDER BY 1 LIMIT 200`,
    [req.user.orgId]).catch(() => []);
  // FIX-5 — who a step may name as its owner. The same list Settings shows, so
  // "a named person" means somebody who can actually be handed a step.
  const teamRows = await query(
    `SELECT id, name FROM users WHERE org_id=? AND deactivated_at IS NULL ORDER BY name`,
    [req.user.orgId]).catch(() => []);
  // PARITY-1 Part D — what a trigger or an audience may be narrowed to: this
  // org's groups, funds and campaigns, offered rather than typed.
  const groupOpts = (await GR.listGroups(req.user.orgId).catch(() => [])).map(g => ({ id: g.id, name: g.name, kind: g.kind }));
  const fundOpts = await query(`SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name`, [req.user.orgId]).catch(() => []);
  const campaignOpts = await query(`SELECT id, name FROM campaigns WHERE org_id=? ORDER BY created_at DESC LIMIT 200`, [req.user.orgId]).catch(() => []);
  res.json({
    triggers: J.TRIGGERS,
    // DATES-1 — the triggers grouped as people think of them, the yearly-date
    // audiences, and the org's today for "First runs Dec 1, 2026".
    triggerGroups: J.TRIGGER_GROUPS,
    yearlyAudiences: J.YEARLY_AUDIENCES,
    today: orgToday(await orgTz(req.user.orgId)),                 // ORG_TZ_SEAM_OK
    states: J.STATES,
    // JOURNEYS-3 — Journey settings: the touch gap, and the milestones.
    touchGapDays: await journeyTouchGap(req.user.orgId),
    touchGap: { min: J.TOUCH_GAP_MIN, max: J.TOUCH_GAP_MAX, default: J.TOUCH_GAP_DEFAULT },
    hourMilestones: J.HOUR_MILESTONES,
    // JOURNEYS-4 — the outcomes a call or meeting can end with, and whether the
    // email trigger has anything to read in this org.
    taskOutcomes: J.TASK_OUTCOMES,
    triggerAvailability: { email_engaged_no_gift: await emailOpenAvailability(req.user.orgId) },
    groups: groupOpts,
    funds: fundOpts.map(f => ({ id: f.id, name: f.name })),
    campaigns: campaignOpts.map(c => ({ id: c.id, name: c.name })),
    audienceFilters: J.AUDIENCE_FILTERS,
    timingUnits: J.TIMING_UNITS,
    timingFrom: J.TIMING_FROM,
    draftKinds: J.DRAFT_KINDS,
    // EMAIL-1 — a step's draft may start from one of the org's email templates.
    emailTemplates: (await query(`SELECT id, name FROM email_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name`,
      [req.user.orgId]).catch(() => [])).map(t => ({ id: t.id, name: t.name })),
    priority: { min: J.PRIORITY_MIN, max: J.PRIORITY_MAX, default: J.PRIORITY_DEFAULT },
    stages: stageRows.map(r => r.stage),
    // POLISH-2: a machine flag (has-refused-rows:N, shares-id:X) is never a
    // tag she can pick; donorTags.js is the one list of them.
    tags: tagRows.map(r => r.tag).filter(t => !DTAGS.isInternalTag(t)),
    presets: J.PRESETS.map(p => ({ ...p, touches: J.touchesSentence(p.steps) })),
    // FIX-5 — the team, so a step can name a person as its owner instead of
    // always falling to the relationship owner.
    team: teamRows.map(u => ({ id: u.id, name: u.name })),
    journeys: rows.map(t => ({
      id: t.id, name: t.name, description: withoutInternalNotes(t.description || ""), steps: t.steps, trigger: t.trigger_key,
      amountCents: t.trigger_amount_cents, priority: t.priority,
      audience: t.audience || {},
      audienceSentence: J.audienceSentence(t.audience || {}),
      presetKey: t.preset_key, enabled: !!t.journey_enabled,
      olderTemplate: require("./olderTemplate").olderTemplateNote(t, J.PRESETS, J.touchesSentence),   // POLISH-9
      touches: autoOnBy.has(t.id) ? J.touchesSentence(t.steps || []).replace("Nothing is sent without you.", autoSentence(autoOnBy.get(t.id))) : J.touchesSentence(t.steps || []),
      autoSteps: autoOnBy.get(t.id) || [],
      // FIX-5 item 2 — arriving on Journeys opens one, and this is how the page
      // knows which: the most recently edited. `updated_at` is set on every
      // PATCH already, so nothing new has to be recorded for it.
      updatedAt: t.updated_at,
      inIt: Number((byTpl.get(t.id) || {}).active) || 0,
      everIn: Number((byTpl.get(t.id) || {}).ever) || 0,
      // PARITY-1 Part D — entered, in it, exited and completed, and the state.
      completed: Number((byTpl.get(t.id) || {}).completed) || 0,
      exited: Number((byTpl.get(t.id) || {}).exited) || 0,
      sentAutomatically: Number((autoCounts.get(t.id) || {}).sent) || 0,
      autoWaiting: Number((autoCounts.get(t.id) || {}).waiting) || 0,
      autoSkipped: Number((autoCounts.get(t.id) || {}).skipped) || 0,
      triggerFilters: t.trigger_filters || {},
      exclusive: !!t.exclusive,
      state: J.journeyState({ enabled: !!t.journey_enabled, everEnabled: !!t.ever_enabled,
        archived: !!t.archived_at, everIn: Number((byTpl.get(t.id) || {}).ever) || 0 }),
    })),
  });
}));

// ── FIX-5 item 6 · WHAT A BIG GIFT IS HERE, FROM THEIR OWN FILE ───────────
// The Major donor journey needs a number and there is no universal one, so the
// old screen refused to save and printed the refusal in terracotta — an error
// for not yet having answered a question nobody had been asked. The question is
// asked up front instead, with a SUGGESTION from this organisation's own gifts:
// the 90th percentile single gift, which is the size the top tenth of their
// gifts start at. Every number opens, so the rows behind it come back with it.
//
// A GET, and it writes nothing.
app.get("/journeys/suggest-big-gift", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [agg] = await query(
    `SELECT COUNT(*)::int n,
            percentile_disc(0.9) WITHIN GROUP (ORDER BY amount)::float p90,
            MAX(amount)::float top
       FROM gifts WHERE org_id=? AND amount > 0`, [orgId]);
  const n = Number(agg?.n) || 0;
  // A file with almost nothing in it cannot suggest anything honestly. $1,000
  // is offered as a STARTING POINT and said to be one, rather than dressed up
  // as something read out of their data.
  if (n < 20) {
    return res.json({
      cents: 100000, fromTheirData: false, gifts: 0,
      sentence: "There are not enough gifts on file yet to read a number out of them, so this is a common starting point. Change it to whatever a big gift is for you.",
      rows: [],
    });
  }
  // Rounded to a number a person would say out loud. $2,647 is arithmetic;
  // $2,500 is an answer.
  const p90 = Number(agg.p90) || 0;
  const step = p90 >= 25000 ? 5000 : p90 >= 10000 ? 2500 : p90 >= 2500 ? 500 : p90 >= 500 ? 100 : 25;
  // Rounded on purpose, and it is not a gift: it is a THRESHOLD being offered
  // for her to accept or type over, and it is carried in cents from here on.
  const suggested = Math.max(step, Math.round(p90 / step) * step);
  const DDp = await import("../../shared/displayDate.js");
  const rows = await query(
    `SELECT g.id, g.amount::float amount, g.date, d.id AS donor_id, d.name AS donor_name
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND g.amount >= ? AND d.deleted_at IS NULL
      ORDER BY g.amount DESC LIMIT 200`, [orgId, suggested]);
  res.json({
    cents: Math.round(suggested * 100), fromTheirData: true, gifts: n,
    sentence: `The top tenth of your ${n.toLocaleString("en-US")} gifts start at about $${suggested.toLocaleString("en-US")}. `
      + `${rows.length} gift${rows.length === 1 ? "" : "s"} on file ${rows.length === 1 ? "is" : "are"} that size or larger.`,
    // sentenceMoney, not Math.round: these are real gifts, and a gift of
    // $4,000.50 shown as $4,001 in the rows behind a number is the whole
    // reason the money seam exists.
    rows: rows.map(r => ({ id: r.donor_id, giftId: r.id, name: r.donor_name,
      reason: `${sentenceMoney(r.amount)} on ${DDp.displayDate(r.date)}` })),
  });
}));

// Create one, from a preset or from scratch. `presetKey` fills the steps; the
// body may then override any of them, which is what "pick a preset, adjust"
// means in the onboarding step.
app.post("/journeys", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const J = await journeyMod();
  const b = req.body || {};
  const preset = b.presetKey ? J.presetByKey(String(b.presetKey)) : null;
  if (b.presetKey && !preset) return res.status(400).json({ error: "unknown_preset", message: "There is no preset by that name." });

  // ── FIX-10 Part C · RE-RUNNING ONBOARDING NEVER CLONES A JOURNEY ─────────
  // Onboarding's preset picker POSTs here the first time a preset is tapped
  // and caches the new id in memory. Walk the wizard a second time and that
  // cache is gone, so the same tap made a SECOND row from the same preset:
  // two journeys, same trigger, same steps, and whichever got armed would fire
  // beside its twin. The preset key is the identity. If a live journey already
  // came from this preset, that journey IS the answer, and "Use this one"
  // opens it. The ORIGINAL, by created_at, so a deliberate duplicate (which
  // carries the preset key too) never shadows the one onboarding made.
  //
  // Only the preset path is affected: a hand-built journey has no preset key,
  // so POSTing two of those still makes two, which is what the button says.
  if (preset) {
    const [already] = await query(
      `SELECT * FROM cultivation_templates WHERE org_id=? AND preset_key=? AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC LIMIT 1`, [req.user.orgId, preset.key]);
    // POLISH-9: a never-used draft copied from an older version takes the template's steps now.
    if (already && require("./olderTemplate").olderTemplateOf(already, J.PRESETS)) {
      await run("UPDATE cultivation_templates SET steps=?::jsonb, updated_at=NOW() WHERE id=? AND org_id=?", [JSON.stringify(preset.steps), already.id, req.user.orgId]);
      already.steps = preset.steps;
    }
    if (already) {
      return res.json({
        id: already.id, name: already.name, description: withoutInternalNotes(already.description),
        trigger: already.trigger_key, priority: already.priority,
        steps: already.steps, amountCents: already.trigger_amount_cents,
        audience: already.audience || {}, presetKey: already.preset_key,
        enabled: !!already.journey_enabled,
        touches: J.touchesSentence(already.steps || []),
        existing: true,
        sentence: `You already have "${already.name}" from this one. Opening it instead of making a second.`,
      });
    }
  }

  const input = {
    name: b.name || (preset && preset.name),
    description: b.description !== undefined ? b.description : (preset && preset.blurb),
    trigger: b.trigger || (preset && preset.trigger),
    priority: b.priority !== undefined ? b.priority : (preset && preset.priority),
    amountCents: b.amountCents,
    audience: b.audience,
    triggerFilters: b.triggerFilters || (preset && preset.triggerFilters),
    steps: Array.isArray(b.steps) && b.steps.length ? b.steps : (preset && preset.steps),
    exclusive: b.exclusive !== undefined ? b.exclusive === true : !!(preset && preset.exclusive),
  };
  // JOURNEYS-3 — a ready-made step that names an EMAIL-1 starter drafts from
  // the org's own copy of that email, saved from the starter if it has none.
  if (Array.isArray(input.steps)) {
    input.steps = await Promise.all(input.steps.map(async st => {
      if (!st || !st.starter || st.draft) return st;
      const tid = await require("../../routes/emailTemplates").ensureStarterTemplate(req.user.orgId, st.starter, actor(req)).catch(() => null);
      return tid ? { ...st, draft: `template:${tid}` } : st;
    }));
  }
  const v = J.validateJourney(input);
  if (!v.ok) return res.status(400).json({ error: "invalid_journey", errors: v.errors, message: v.errors[0].message });
  // FIX-19: a step owned by a named person names an active user of this org.
  const stepOwners = await OU.orgUsers(req.user.orgId, v.steps.map(st => st.ownerId));
  if (!stepOwners.ok) return OU.refuse(res, "steps.ownerId");

  const refused = await journeyRefsRefused(req.user.orgId, v);
  if (refused) return res.status(404).json(refused);
  const offRefusal = b.enabled === true ? await journeyCannotRun(req.user.orgId, v.trigger) : null;
  if (offRefusal) return res.status(409).json(offRefusal);

  const id = newId("ct");
  await run(
    `INSERT INTO cultivation_templates (id,org_id,name,description,steps,trigger_key,trigger_amount_cents,priority,audience,preset_key,journey_enabled,created_by,created_by_name,trigger_filters,ever_enabled,exclusive)
     VALUES (?,?,?,?,?::jsonb,?,?,?,?::jsonb,?,?,?,?,?::jsonb,?,?)`,
    [id, req.user.orgId, v.name, v.description, JSON.stringify(v.steps), v.trigger, v.amountCents, v.priority,
     JSON.stringify(v.audience),
     preset ? preset.key : null,
     // ARMED ONLY IF ASKED. Creating a journey and having it start firing at
     // people in the same breath is not a thing anybody wants by surprise.
     b.enabled === true, actor(req).id, actor(req).name, JSON.stringify(v.triggerFilters || {}), b.enabled === true, v.exclusive]);
  if (b.enabled === true) await baselineJourneyGroup(req.user.orgId, v);
  const [row] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=?", [id, req.user.orgId]);
  res.status(201).json({ id, name: v.name, description: v.description, trigger: v.trigger, priority: v.priority,
    steps: v.steps, audience: v.audience, enabled: !!row.journey_enabled, exclusive: !!row.exclusive, touches: J.touchesSentence(v.steps) });
}));

// ── FIX-5 item 5 · DUPLICATE A WHOLE JOURNEY ─────────────────────────────
// The way an org gets its second journey: copy the one that works and change
// two things. The copy arrives OFF, whatever the original was — two journeys
// firing on the same trigger the moment you press "duplicate" is the surprise
// this build exists to remove.
app.post("/journeys/:id/duplicate", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const J = await journeyMod();
  const [cur] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!cur) return res.status(404).json({ error: "Not found" });
  // "New donor, first year (copy)", then "(copy 2)" — a name nobody has to
  // think about, and never a silent second row with the identical name.
  const existing = (await query(
    `SELECT name FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL`, [req.user.orgId]))
    .map(r => String(r.name || "").toLowerCase());
  let name = `${cur.name} (copy)`;
  for (let n = 2; existing.includes(name.toLowerCase()); n++) name = `${cur.name} (copy ${n})`;

  const v = J.validateJourney({ name, description: cur.description, trigger: cur.trigger_key,
    priority: cur.priority, amountCents: cur.trigger_amount_cents, audience: cur.audience, steps: cur.steps,
    triggerFilters: cur.trigger_filters || {} });
  if (!v.ok) return res.status(400).json({ error: "invalid_journey", errors: v.errors, message: v.errors[0].message });
  const id = newId("ct");
  await run(
    `INSERT INTO cultivation_templates (id,org_id,name,description,steps,trigger_key,trigger_amount_cents,priority,audience,preset_key,journey_enabled,created_by,created_by_name,trigger_filters,exclusive)
     VALUES (?,?,?,?,?::jsonb,?,?,?,?::jsonb,?,false,?,?,?::jsonb,?)`,
    [id, req.user.orgId, v.name, v.description, JSON.stringify(v.steps), v.trigger, v.amountCents, v.priority,
     JSON.stringify(v.audience), cur.preset_key, actor(req).id, actor(req).name, JSON.stringify(v.triggerFilters || {}), !!cur.exclusive]);
  res.status(201).json({ id, name: v.name, copiedFrom: cur.id, enabled: false,
    sentence: `"${v.name}" is a copy of "${cur.name}" and it is off. Nothing starts until you turn it on.` });
}));

// ── FIX-5 item 5 · DELETE, WITH AN UNDO ──────────────────────────────────
// Archived, never deleted: applied plans point at this id and a plan whose
// origin vanished is a record with a hole in it. Archiving also makes the undo
// trivial and exact — it is the same row, put back.
app.delete("/journeys/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [cur] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!cur) return res.status(404).json({ error: "Not found" });
  const [inIt] = await query(
    `SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=? AND template_id=? AND status='active'`,
    [req.user.orgId, req.params.id]);
  // Turned OFF as well as archived, so restoring cannot quietly re-arm it.
  await run(`UPDATE cultivation_templates SET archived_at=NOW(), journey_enabled=false, updated_at=NOW()
              WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  res.json({ id: req.params.id, name: cur.name, deleted: true, undoable: true, inIt: Number(inIt?.n) || 0,
    sentence: Number(inIt?.n) > 0
      ? `"${cur.name}" is gone from the list. The ${inIt.n} ${Number(inIt.n) === 1 ? "person" : "people"} already in it keep the steps they entered with.`
      : `"${cur.name}" is gone from the list.` });
}));

app.post("/journeys/:id/restore", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { changes } = await run(
    `UPDATE cultivation_templates SET archived_at=NULL, updated_at=NOW()
      WHERE id=? AND org_id=? AND archived_at IS NOT NULL`, [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  const [row] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ id: row.id, name: row.name, restored: true, enabled: false,
    sentence: `"${row.name}" is back, and it is off.` });
}));

// ── FIX-5 item 5 · WHO A CHANGE REACHES, BEFORE IT IS SAVED ──────────────
// A GET that writes nothing, and it tells the truth rather than the reassuring
// version. Saving a journey does NOT rewrite the people already in it — their
// steps were copied when they entered, on purpose, so somebody three touches
// into seven cannot silently acquire two more. So the honest sentence is "these
// people are in it, and saving leaves them where they are", plus the count that
// WOULD move if she asks for it (`retimeExisting` on the PATCH).
app.get("/journeys/:id/affects", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT d.id, d.name, p.applied_on,
            (SELECT COUNT(*) FROM cultivation_plan_steps s WHERE s.plan_id=p.id AND s.status='pending')::int pending,
            (SELECT MIN(s.due_date) FROM cultivation_plan_steps s WHERE s.plan_id=p.id AND s.status='pending') next_due
       FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
      WHERE p.org_id=? AND p.template_id=? AND p.status='active' AND d.deleted_at IS NULL
      ORDER BY d.name LIMIT 500`, [orgId, t.id]);
  const movable = rows.filter(r => Number(r.pending) > 0);
  res.json({
    journeyId: t.id, name: t.name, inIt: rows.length, movable: movable.length,
    enabled: !!t.journey_enabled,
    sentence: rows.length === 0
      ? "Nobody is in this journey yet, so this change only affects people who enter it from now on."
      : `${rows.length} ${rows.length === 1 ? "person is" : "people are"} in this journey. `
        + `Their steps were copied when they entered, so saving leaves them where they are. `
        + `It changes what happens to everybody who enters from now on.`,
    moveSentence: movable.length
      ? `This moves ${movable.length} ${movable.length === 1 ? "person's" : "people's"} next step.`
      : "There is no step still to come on anybody in it, so there is nothing to move.",
    donors: movable.map(r => ({ id: r.id, name: r.name,
      reason: `${r.pending} step${Number(r.pending) === 1 ? "" : "s"} still to come${r.next_due ? `, next on ${r.next_due}` : ""}` })),
  });
}));

app.patch("/journeys/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const J = await journeyMod();
  const [cur] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!cur) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const v = J.validateJourney({
    name: b.name !== undefined ? b.name : cur.name,
    description: withoutInternalNotes(b.description !== undefined ? b.description : cur.description),
    trigger: b.trigger !== undefined ? b.trigger : cur.trigger_key,
    priority: b.priority !== undefined ? b.priority : cur.priority,
    amountCents: b.amountCents !== undefined ? b.amountCents : cur.trigger_amount_cents,
    audience: b.audience !== undefined ? b.audience : cur.audience,
    triggerFilters: b.triggerFilters !== undefined ? b.triggerFilters : cur.trigger_filters,
    steps: b.steps !== undefined ? b.steps : cur.steps,
  });
  if (!v.ok) return res.status(400).json({ error: "invalid_journey", errors: v.errors, message: v.errors[0].message });
  // FIX-19: a step owned by a named person names an active user of this org.
  const stepOwners = await OU.orgUsers(req.user.orgId, v.steps.map(st => st.ownerId));
  if (!stepOwners.ok) return OU.refuse(res, "steps.ownerId");
  const refused = await journeyRefsRefused(req.user.orgId, v);
  if (refused) return res.status(404).json(refused);
  const enabledNow = b.enabled !== undefined ? b.enabled === true : !!cur.journey_enabled;
  const exclusiveNow = b.exclusive !== undefined ? b.exclusive === true : !!cur.exclusive;
  const offRefusal = enabledNow ? await journeyCannotRun(req.user.orgId, v.trigger) : null;
  if (offRefusal) return res.status(409).json(offRefusal);
  await run(
    `UPDATE cultivation_templates SET name=?, description=?, steps=?::jsonb, trigger_key=?, trigger_amount_cents=?,
       priority=?, audience=?::jsonb, journey_enabled=?, trigger_filters=?::jsonb,
       ever_enabled = (ever_enabled OR ?), exclusive=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [v.name, v.description, JSON.stringify(v.steps), v.trigger, v.amountCents, v.priority,
     JSON.stringify(v.audience),
     enabledNow, JSON.stringify(v.triggerFilters || {}), enabledNow, exclusiveNow,
     req.params.id, req.user.orgId]);
  if (enabledNow) await baselineJourneyGroup(req.user.orgId, v);

  // CHANGING A JOURNEY DOES NOT REWRITE THE PEOPLE ALREADY IN IT. Their steps
  // were copied when they entered, exactly as a plan's are — somebody who has
  // already had three of seven touches must not silently acquire two more.
  //
  // FIX-5 — UNLESS SHE ASKS. `retimeExisting` is the opt-in the confirm dialog
  // offers after showing her exactly who it reaches, and it moves PENDING steps
  // only: a step that is open, done or skipped has already happened to somebody
  // and is not ours to rewrite. The dates are recomputed from each plan's own
  // `applied_on`, so two people who entered in different weeks stay in their own
  // weeks rather than being dragged onto a shared date.
  let moved = 0, movedPeople = 0;
  if (b.retimeExisting === true) {
    const plans = await query(
      `SELECT id, applied_on FROM cultivation_plans
        WHERE org_id=? AND template_id=? AND status='active'`, [req.user.orgId, req.params.id]);
    for (const p of plans) {
      let any = false;
      for (let i = 0; i < v.steps.length; i++) {
        const due = orgTime.addDays(String(p.applied_on).slice(0, 10), Number(v.steps[i].offsetDays) || 0);
        const { changes } = await run(
          `UPDATE cultivation_plan_steps SET due_date=?, label=?, step_type=?
            WHERE plan_id=? AND org_id=? AND seq=? AND status='pending'`,
          [due, v.steps[i].label, v.steps[i].type, p.id, req.user.orgId, i + 1]);
        if (changes) { moved += changes; any = true; }
      }
      if (any) movedPeople++;
    }
  }

  res.json({ id: req.params.id, name: v.name, description: v.description, trigger: v.trigger, priority: v.priority,
    steps: v.steps, audience: v.audience, exclusive: exclusiveNow, touches: J.touchesSentence(v.steps),
    movedPeople, movedSteps: moved,
    note: b.retimeExisting === true
      ? `${movedPeople} ${movedPeople === 1 ? "person's" : "people's"} steps still to come were moved to the new timing. Steps already done were left alone.`
      : "People already in this journey keep the steps they entered with." });
}));

// Who would qualify right now — the count the "apply to people who already
// qualify" offer opens. A GET, and it writes nothing.
//
// JOURNEYS-3 · COUNTED HONESTLY BEFORE THE CLICK. One read of who qualifies,
// one read of the journeys they are already in, and the split is done here:
// who will join, who is already in this one, who is in a journey marked "only
// one of these at a time" that ranks the same or higher (they stay), and who
// is in other journeys (they join too, spaced a week apart, unless she says
// leave them where they are). The apply route uses the same split, so the
// button's number and the result cannot disagree.
async function applySplit(orgId, t, days, audience, joinOthers = true) {
  const ids = (await qualifyingDonors(orgId, t, days, audience)).map(r => r.id);
  const out = { qualify: ids.length, willJoin: [], alreadyIn: [], blocked: [], inOthers: [], noContact: [], noAsk: [] };
  if (!ids.length) return out;
  const J = await journeyMod();
  const asks = J.journeyAsks(t.steps);
  const [people, plans] = await Promise.all([
    query(`SELECT id, name, deceased, do_not_contact, do_not_solicit FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL`, [orgId, ids]),
    query(`SELECT p.donor_id, p.template_id, p.template_name, p.priority, COALESCE(ct.exclusive, false) AS exclusive
             FROM cultivation_plans p LEFT JOIN cultivation_templates ct ON ct.id = p.template_id AND ct.org_id = p.org_id
            WHERE p.org_id=? AND p.status='active' AND p.donor_id = ANY(?::text[])`, [orgId, ids]),
  ]);
  const nameOf = new Map(people.map(d => [d.id, d.name]));
  const flagsOf = new Map(people.map(d => [d.id, d]));
  const byDonor = new Map();
  for (const p of plans) (byDonor.get(p.donor_id) || byDonor.set(p.donor_id, []).get(p.donor_id)).push(p);
  for (const id of ids) {
    if (!nameOf.has(id)) continue;
    const mine = byDonor.get(id) || [];
    const row = { id, name: nameOf.get(id), journeys: mine.map(p => p.template_name) };
    // JOURNEYS-4 — the engine's own entry rules, so the preview counts the
    // people the apply would actually put in.
    const f = flagsOf.get(id) || {};
    if (f.deceased === true || f.do_not_contact === true) { out.noContact.push(row); continue; }
    if (asks && f.do_not_solicit === true) { out.noAsk.push(row); continue; }
    if (mine.some(p => p.template_id === t.id)) { out.alreadyIn.push(row); continue; }
    const higher = t.exclusive && mine.find(p => p.exclusive && Number(p.priority) >= Number(t.priority));
    if (higher) { out.blocked.push({ ...row, journeys: [higher.template_name] }); continue; }
    if (mine.length) { out.inOthers.push(row); if (joinOthers) out.willJoin.push(row); continue; }
    out.willJoin.push(row);
  }
  return out;
}
function applySentence(split, joinOthers) {
  const n = k => `${k} ${k === 1 ? "person" : "people"}`;
  const parts = [`${split.qualify} qualify.`, `${split.willJoin.length} will join.`];
  if (split.noContact && split.noContact.length) parts.push(`${n(split.noContact.length)} ${split.noContact.length === 1 ? "is" : "are"} deceased or asked not to be contacted, and will not join.`);
  if (split.noAsk && split.noAsk.length) parts.push(`${n(split.noAsk.length)} ${split.noAsk.length === 1 ? "is" : "are"} marked do not solicit, and this journey asks for money, so they will not join.`);
  if (split.alreadyIn.length) parts.push(`${n(split.alreadyIn.length)} ${split.alreadyIn.length === 1 ? "is" : "are"} already in it.`);
  if (split.blocked.length) parts.push(`${split.blocked.length} ${split.blocked.length === 1 ? "is" : "are"} already in a journey that ranks higher.`);
  if (split.inOthers.length) parts.push(joinOthers
    ? `${split.inOthers.length} ${split.inOthers.length === 1 ? "is" : "are"} in another journey and will join too, with touches spaced out.`
    : `${split.inOthers.length} ${split.inOthers.length === 1 ? "is" : "are"} in another journey and will be left where they are.`);
  return parts.join(" ");
}
app.get("/journeys/:id/qualifying", requireAuth, wrap(async (req, res) => {
  const J = await journeyMod();
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
  // FIX-4 1c — the audience arrives as a JSON query parameter so this stays a
  // GET that writes nothing. A parameter that will not parse is treated as no
  // filter at all, which is the wider set and therefore the honest failure:
  // the count says more people than it should rather than fewer.
  let audience = {};
  try { audience = J.validateAudience(req.query.audience ? JSON.parse(String(req.query.audience)) : {}); }
  catch { audience = {}; }
  const joinOthers = String(req.query.joinOthers || "true") !== "false";
  const split = await applySplit(req.user.orgId, t, days, audience, joinOthers);
  res.json({ journeyId: t.id, name: t.name, days, audience, joinOthers,
    count: split.qualify, willJoin: split.willJoin.length,
    donorIds: split.willJoin.map(r => r.id).slice(0, 2000),
    alreadyIn: split.alreadyIn.slice(0, 200), blocked: split.blocked.slice(0, 200), inOthers: split.inOthers.slice(0, 200),
    audienceSentence: J.audienceSentence(audience),
    filters: J.AUDIENCE_FILTERS,
    sentence: applySentence(split, joinOthers),
    window: `Their trigger happened in the last ${days} days.` });
}));

// ── THREAD-2b 1 · THE LIVE PREVIEW, ON A REAL DONOR ─────────────────────
// The builder shows what this journey would do to somebody who actually
// exists, with the dates it would actually produce. Invented dates on an
// invented person would let a retiming mistake look fine right up until it
// reached a real record.
//
// WHICH DONOR: the most recent one whose trigger genuinely applies — the
// newest first-time giver for a first_gift journey, the newest big gift for
// gift_over. Falling back to "any donor" would be a preview of something
// that would never happen to them.
//
// A GET, and it writes NOTHING. No plan, no steps, no thread. It is
// arithmetic on a date.
app.get("/journeys/:id/preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const J = await journeyMod();
  const PL = await planMod();
  const DD = await import("../../shared/displayDate.js");

  // The donor, and the DATE THE TRIGGER WOULD HAVE FIRED ON — which is what
  // the offsets count from, not today. A first gift in October means month 3
  // is January, and a preview that said "three months from today" would be
  // showing a different journey from the one that runs.
  let donor = null, basis = null, from = null;
  const newestGift = async (minCents) => (await query(
    `SELECT d.id, d.name, g.date, g.amount FROM donors d
       JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
      WHERE d.org_id=? AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> ''
        ${minCents ? "AND ROUND(g.amount*100) >= " + Number(minCents) : ""}
      ORDER BY g.date DESC NULLS LAST LIMIT 1`, [orgId]))[0] || null;

  if (t.trigger_key === "first_gift") {
    const [r] = await query(
      `SELECT d.id, d.name, MIN(g.date) AS date, MAX(g.amount) AS amount
         FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
        WHERE d.org_id=? AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> ''
        GROUP BY d.id, d.name HAVING COUNT(g.id)=1
        ORDER BY MIN(g.date) DESC LIMIT 1`, [orgId]);
    if (r) { donor = r; from = String(r.date).slice(0, 10);
             basis = `First gift $${Number(r.amount).toLocaleString("en-US")} · ${DD.displayDate(from)}`; }
  } else if (t.trigger_key === "gift_over") {
    const r = await newestGift(Number(t.trigger_amount_cents) || 0);
    if (r) { donor = r; from = String(r.date).slice(0, 10);
             basis = `Gift $${Number(r.amount).toLocaleString("en-US")} · ${DD.displayDate(from)}`; }
  }
  if (!donor) {
    const r = await newestGift(0);
    if (r) { donor = r; from = String(r.date).slice(0, 10); basis = `Most recent gift · ${DD.displayDate(from)}`; }
  }
  // DATES-1 — a date every year counts from the next time that date comes
  // round, in the org's own calendar, not from anybody's gift.
  if (t.trigger_key === "yearly_date") {
    const tf = t.trigger_filters || {};
    const TS = await import("../../shared/taskShape.js");
    const today0 = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
    if (J.validMonthDay(Number(tf.month), Number(tf.day))) {
      from = TS.nextYearlyOn(Number(tf.month), Number(tf.day), today0);
      if (!donor) { const [any] = await query(`SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId]); donor = any || null; }
      basis = `${J.firstRunSentence(Number(tf.month), Number(tf.day), today0).replace(/\.$/, "")}`;
    }
  }
  // SENDS-1 (W-1107-Fundraising-27X): a birthday journey counts from the day the
  // sweep would start it (shared/birthday.js birthdayJourneyStart, the run's own
  // rule), for the person whose birthday comes round first. Never a gift or join date.
  if (t.trigger_key === "birthday") {
    const B = await import("../../shared/birthday.js");
    const today0 = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
    const lead = Number((t.trigger_filters || {}).daysBefore) || 0;
    const born = await query(`SELECT id, name, birth_month, birth_day FROM donors WHERE org_id=? AND deleted_at IS NULL
                                AND birth_month IS NOT NULL AND birth_day IS NOT NULL LIMIT 5000`, [orgId]);
    let best = null;
    for (const r of born) {
      const s = B.birthdayJourneyStart(Number(r.birth_month), Number(r.birth_day), today0, lead);
      if (s && (!best || s < best.start)) best = { r, start: s };
    }
    if (best) {
      donor = { id: best.r.id, name: best.r.name }; from = best.start;
      basis = `Birthday ${B.birthdayLabel(Number(best.r.birth_month), Number(best.r.birth_day))} · starts ${DD.displayDate(from)}${lead ? `, ${lead} ${lead === 1 ? "day" : "days"} before` : ""}`;
    } else { donor = null; from = null; }
    if (!donor) return res.json({ donor: null, steps: [], why: "Nobody on file has a birthday yet, so there is no one to preview this on." });
  }
  if (!donor) return res.json({ donor: null, steps: [], why: "Nobody on file yet to preview this on." });

  // ── FIX-5 · THE CHAIN'S STATES COME FROM A REAL PLAN WHEN THERE IS ONE ──
  // The chain shows done, today and still-to-come at a glance, and those words
  // have to MEAN something. So the preview prefers somebody who is ACTUALLY in
  // this journey: their real steps, with the real statuses the Thread engine
  // set. Only when nobody is in it does it fall back to the arithmetic above,
  // and then a step is "past", "today" or "upcoming" by its date, never "done"
  // — because nothing has been done, and the caption says which it is showing.
  const today = orgToday(await orgTz(orgId));                           // ORG_TZ_SEAM_OK
  const [live] = await query(
    `SELECT p.id, p.applied_on, d.id AS donor_id, d.name
       FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
      WHERE p.org_id=? AND p.template_id=? AND p.status='active' AND d.deleted_at IS NULL
      ORDER BY p.applied_on DESC LIMIT 1`, [orgId, t.id]);
  if (live) {
    const real = await query(
      `SELECT seq, label, due_date, status FROM cultivation_plan_steps
        WHERE org_id=? AND plan_id=? ORDER BY seq`, [orgId, live.id]);
    if (real.length) {
      return res.json({
        donor: { id: live.donor_id, name: live.name,
                 basis: `In this journey since ${DD.displayDate(String(live.applied_on).slice(0, 10))}` },
        from: String(live.applied_on).slice(0, 10),
        live: true,
        steps: real.map(s => ({
          seq: s.seq, label: s.label, dueDate: s.due_date,
          // done and skipped both read as behind them; open is what they are on
          // now, and it is the step the emerald ring belongs to.
          state: s.status === "done" || s.status === "skipped" ? "done"
               : s.status === "open" || s.due_date === today ? "today"
               : s.due_date < today ? "past" : "upcoming",
        })),
        legend: "This is somebody really in it. Filled steps are behind them, the ring is where they are now.",
        touches: J.touchesSentence(t.steps || []),
      });
    }
  }

  const v = J.validateJourney({ name: t.name, trigger: t.trigger_key, priority: t.priority,
                                amountCents: t.trigger_amount_cents, steps: t.steps, triggerFilters: t.trigger_filters || {} });
  const steps = PL.planFromTemplate({ steps: v.steps, today: from }, orgTime.addDays);
  res.json({
    donor: { id: donor.id, name: donor.name, basis },
    from,
    live: false,
    steps: steps.map((s, i) => ({ seq: s.seq, label: s.label, dueDate: s.dueDate,
      draft: (v.steps[i] || {}).draft || null,
      state: s.dueDate === today ? "today" : s.dueDate < today ? "past" : "upcoming" })),
    legend: "Nobody is in this journey yet, so these are the dates it would have produced for this person. Change a step and they move.",
    touches: J.touchesSentence(v.steps),
  });
}));

// ── THREAD-2b 6 · HOW A JOURNEY IS GOING, AND WHAT IT DOES NOT CLAIM ─────
//
// Four numbers per journey: how many people are in it, how its steps are
// going (on time / late / skipped), and how many donors gave a SECOND gift
// within twelve months of entering.
//
// THE LAST ONE IS NOT A CLAIM THAT THE JOURNEY CAUSED IT, and the route says
// so in the payload rather than leaving it to a caption somebody might
// delete. Nothing here is a comparison against donors who were not in it,
// because Steward is not running an experiment and a number that looks like
// a lift, without a control, is a lie with a decimal point on it.
//
// ── FIX-4 2 · WHAT THIS JOURNEY WOULD DO TO THIS PERSON ──────────────────
// The rail's "Add to a journey" shows the FIRST STEP AND ITS DATE before
// anybody presses anything, so the confirm is a confirm to something real
// rather than to a name. The dates are the organisation's civil dates, the
// same arithmetic the apply itself will do — computed by planShape from the
// org's own today, never from a UTC instant.
//
// A GET, and it writes nothing: no plan, no step, no thread.
app.get("/donors/:id/journey-preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const DDj = await import("../../shared/displayDate.js");
  const PL = await planMod();
  const J = await journeyMod();
  const [donor] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [String(req.query.journeyId || ""), orgId]);
  if (!t) return res.status(404).json({ error: "Not found", message: "That journey no longer exists." });

  const v = PL.validateTemplate({ name: t.name, steps: t.steps });
  if (!v.ok) return res.status(400).json({ error: "invalid_journey", message: v.errors[0].message });
  const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
  // FLOWS-3: the same day the start counts from (a dated journey's own date).
  const JR = await import("../../shared/journeyStartRule.js");
  const [born] = await query("SELECT birth_month, birth_day FROM donors WHERE id=? AND org_id=?", [donor.id, orgId]);
  const anchor = JR.journeyAnchor(t, born || {}, today);
  const steps = PL.planFromTemplate({ steps: v.steps, today: anchor }, orgTime.addDays);
  const first = steps[0] || null;
  const state = await JA.journeyStateOf(query, J, orgId, t);

  // Somebody already in a plan is the one case where this cannot just say
  // yes, so it says so here rather than at the confirm.
  const inNow = await query(
    "SELECT template_id, template_name FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active' ORDER BY priority DESC", [orgId, donor.id]);
  const open = inNow.find(p => p.template_id === t.id) || null;

  res.json({
    journeyId: t.id, name: t.name, donorId: donor.id, donorName: donor.name,
    touches: J.touchesSentence(t.steps || []),
    firstStep: first ? { label: first.label, dueDate: first.dueDate, type: first.type } : null,
    steps: steps.map(s => ({ seq: s.seq, label: s.label, dueDate: s.dueDate })),
    alreadyIn: open ? open.template_name : null,
    state, canStart: JR.canStartState(state), notActive: JR.canStartState(state) ? null : JR.notActiveWhy(state),
    firstStepLine: first ? `First step ${DDj.displayDate(first.dueDate).replace(/, \d{4}$/, "")}` : null,
    anchorNote: anchor !== today && first ? `It counts from ${DDj.displayDate(anchor)}, the journey's own date, not from today.` : null,
    // JOURNEYS-3 — the other journeys they are in; they can be in this one too.
    alsoIn: inNow.filter(p => p.template_id !== t.id).map(p => p.template_name),
    sentence: first
      ? `${donor.name} would start with "${first.label}", due ${DDj.displayDate(first.dueDate)}. Nothing is sent. Every step waits for you.`
      : "That journey has no steps yet.",
  });
}));

// EVERY NUMBER OPENS. Each figure carries the `rows` key that
// GET /journeys/:id/rows re-fetches, so the number on the screen and the
// donors behind it are one query and cannot drift.
app.get("/journeys/:id/stats", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const stats = await journeyStats(orgId, t);
  res.json(stats);
}));

// The rows behind one of those numbers. A GET, and it writes nothing.
app.get("/journeys/:id/rows", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const key = String(req.query.rows || "");
  const sql = JOURNEY_ROW_SQL[key];
  if (!sql) return res.status(400).json({ error: "unknown_rows",
    message: `There is no set of rows called "${key}". Ask for one of: ${Object.keys(JOURNEY_ROW_SQL).join(", ")}.` });
  const rows = await query(sql, [orgId, t.id]);
  res.json({ journeyId: t.id, rows: key, count: rows.length, donors: rows.slice(0, 1000) });
}));

// ONE definition per number, written once, used by the figure AND by the
// drill-through. A second copy is how a count stops matching its own rows.
const JOURNEY_ROW_SQL = {
  entered: `SELECT d.id, d.name, p.applied_on AS entered
              FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
             WHERE p.org_id=? AND p.template_id=? AND d.deleted_at IS NULL
             ORDER BY p.applied_on DESC`,
  exited: `SELECT d.id, d.name, p.applied_on AS entered, p.replaced_reason AS reason
             FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
            WHERE p.org_id=? AND p.template_id=? AND p.status='abandoned' AND d.deleted_at IS NULL
            ORDER BY p.closed_at DESC NULLS LAST`,
  completed: `SELECT d.id, d.name, p.applied_on AS entered
                FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
               WHERE p.org_id=? AND p.template_id=? AND p.status='done' AND d.deleted_at IS NULL
               ORDER BY p.closed_at DESC NULLS LAST`,
  inIt: `SELECT d.id, d.name, p.applied_on AS entered
           FROM cultivation_plans p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
          WHERE p.org_id=? AND p.template_id=? AND p.status='active' AND d.deleted_at IS NULL
          ORDER BY p.applied_on DESC`,
  onTime: `SELECT DISTINCT d.id, d.name
             FROM cultivation_plan_steps st
             JOIN cultivation_plans p ON p.id=st.plan_id
             JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
            WHERE p.org_id=? AND p.template_id=? AND st.status='done'
              AND st.closed_at IS NOT NULL AND ${orgDateOfSql("st.closed_at", orgTzSql("p.org_id"))} <= st.due_date::date
            ORDER BY d.name`,
  late: `SELECT DISTINCT d.id, d.name
           FROM cultivation_plan_steps st
           JOIN cultivation_plans p ON p.id=st.plan_id
           JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
          WHERE p.org_id=? AND p.template_id=?
            AND ((st.status='done' AND ${orgDateOfSql("st.closed_at", orgTzSql("p.org_id"))} > st.due_date::date)
                 OR (st.status IN ('open','pending') AND st.due_date::date < ${orgTodaySql(orgTzSql("p.org_id"))}))
          ORDER BY d.name`,
  skipped: `SELECT DISTINCT d.id, d.name, st.skip_reason AS reason
              FROM cultivation_plan_steps st
              JOIN cultivation_plans p ON p.id=st.plan_id
              JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
             WHERE p.org_id=? AND p.template_id=? AND st.status='skipped'
             ORDER BY d.name`,
  // DATES-1 · somebody in a yearly-date journey's audience who did not start
  // on its day, with the reason on the row.
  skippedOnDate: `SELECT d.id, d.name, s.sentence AS reason, s.on_day AS entered
                    FROM journey_start_skips s JOIN donors d ON d.id=s.donor_id AND d.org_id=s.org_id
                   WHERE s.org_id=? AND s.template_id=? AND d.deleted_at IS NULL
                   ORDER BY s.on_day DESC, d.name`,
  // A SECOND GIFT WITHIN TWELVE MONTHS OF ENTERING. Not "because of" — after.
  secondGift: `SELECT DISTINCT d.id, d.name, p.applied_on AS entered
                 FROM cultivation_plans p
                 JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
                WHERE p.org_id=? AND p.template_id=? AND d.deleted_at IS NULL
                  AND EXISTS (SELECT 1 FROM gifts g
                               WHERE g.donor_id=d.id AND g.org_id=d.org_id
                                 AND g.date IS NOT NULL AND g.date <> ''
                                 AND g.date::date >  p.applied_on::date
                                 AND g.date::date <= (p.applied_on::date + INTERVAL '12 months'))
                ORDER BY d.name`,
};

// The four figures, each with the sentence that defines it (the "every number
// has a sentence" rule) and the `rows` key that opens it.
async function journeyStats(orgId, t) {
  const one = async key => (await query(JOURNEY_ROW_SQL[key], [orgId, t.id])).length;
  const [inIt, onTime, late, skipped, secondGift] = await Promise.all(
    ["inIt", "onTime", "late", "skipped", "secondGift"].map(one));
  const [everRow] = await query(
    `SELECT COUNT(*)::int AS c FROM cultivation_plans WHERE org_id=? AND template_id=?`, [orgId, t.id]);
  const [entered, exited, completed] = await Promise.all(["entered", "exited", "completed"].map(one));
  return {
    journeyId: t.id, name: t.name,
    figures: [
      // PARITY-1 Part D — the four counts every journey shows.
      { key: "entered", label: "Entered", value: entered, rows: "entered",
        sentence: "Everyone who has ever gone into this journey, however it ended." },
      { key: "exited", label: "Exited", value: exited, rows: "exited",
        sentence: "People who left before the end: stopped by a person, or moved to a journey that outranks it." },
      { key: "completed", label: "Completed", value: completed, rows: "completed",
        sentence: "People who reached the end, every step done or skipped." },
      { key: "inIt", label: "In it now", value: inIt, rows: "inIt",
        sentence: "People whose journey is still running. Someone who finished, or was moved to another journey, is not counted here." },
      { key: "onTime", label: "Steps on time", value: onTime, rows: "onTime",
        sentence: "People who have completed at least one step on or before the day it was due." },
      { key: "late", label: "Steps late", value: late, rows: "late",
        sentence: "People with a step completed after its due date, or still waiting past it. Late is okay. It isn't failure." },
      { key: "skipped", label: "Steps skipped", value: skipped, rows: "skipped",
        sentence: "People where somebody decided not to do a step and said why. The reason is on each row." },
      { key: "secondGift", label: "Gave again within a year", value: secondGift, rows: "secondGift",
        sentence: "People who gave another gift within twelve months of entering this journey." },
    ].concat(t.trigger_key === "yearly_date" ? [(await yearlySkipFigure(orgId, t)).skippedOnDate] : []),
    everIn: Number(everRow && everRow.c) || 0,
    // SAID BY THE ROUTE, not by a caption a redesign could drop.
    caveat: "These are counts of what happened, not a measure of what the journey caused. "
          + "Steward is not running an experiment: there is no comparison group, so none of "
          + "these numbers can tell you what would have happened without the journey.",
  };
}

// DATES-1 · how many in a yearly-date journey's audience it skipped, and why,
// counted from the same rows the figure opens.
async function yearlySkipFigure(orgId, t) {
  if (t.trigger_key !== "yearly_date") return {};
  const J = await journeyMod();
  const rows = await query(`SELECT s.reason FROM journey_start_skips s JOIN donors d ON d.id=s.donor_id AND d.org_id=s.org_id
                             WHERE s.org_id=? AND s.template_id=? AND d.deleted_at IS NULL`, [orgId, t.id]);
  const by = {};
  for (const r of rows) by[r.reason] = (by[r.reason] || 0) + 1;
  const why = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, count: n, sentence: J.skipLine(reason, n) + "." }));
  return { skippedOnDate: { key: "skippedOnDate", label: "Skipped on the date", value: rows.length, rows: "skippedOnDate",
    sentence: "People in this journey's audience who did not start on its date, each with the reason: a journey that comes first, do not contact, and the like.",
    why } };
}

// Who qualifies for a journey's trigger inside a window, narrowed by the
// audience. One place, so the COUNT the offer shows and the rows the apply
// writes cannot disagree.
// PARITY-1 Part D · a Group in the audience narrows the same set: only the
// people in it now.
async function qualifyingDonors(orgId, t, days, audience = {}) {
  const rows = await qualifyingDonorsByTrigger(orgId, t, days, audience);
  if (!audience.groupId || !rows.length) return rows;
  const g = await GR.groupById(orgId, audience.groupId);
  const inGroup = new Set(g ? await GR.memberIds(orgId, g) : []);
  return rows.filter(r => inGroup.has(r.id));
}
async function qualifyingDonorsByTrigger(orgId, t, days, audience = {}) {
  const trigger = t.trigger_key;
  if (trigger === "by_hand") return [];
  const cut = `(${orgTodaySql(orgTzSql("d.org_id"))} - ${Number(days)})`;
  const a = audienceClauses(audience, "d");
  if (trigger === "first_gift") {
    return await query(
      `SELECT d.id FROM donors d
        WHERE d.org_id=? AND d.deleted_at IS NULL
          AND (SELECT COUNT(*) FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id) = 1
          AND EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id
                        AND g.date IS NOT NULL AND g.date <> '' AND g.date::date >= ${cut})${a.sql}`,
      [orgId, ...a.params]);
  }
  if (trigger === "gift_over") {
    const need = Number(t.trigger_amount_cents) || 0;
    if (!need) return [];
    return await query(
      `SELECT DISTINCT d.id FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
        WHERE d.org_id=? AND d.deleted_at IS NULL
          AND g.date IS NOT NULL AND g.date <> '' AND g.date::date >= ${cut}
          AND ROUND(g.amount*100) >= ?${a.sql}`, [orgId, need, ...a.params]);
  }
  if (trigger === "new_volunteer") {
    return await query(
      `SELECT DISTINCT d.id FROM donors d JOIN volunteers v ON v.person_id=d.id AND v.org_id=d.org_id
        WHERE d.org_id=? AND d.deleted_at IS NULL AND v.created_at >= NOW() - (? || ' days')::interval${a.sql}`,
      [orgId, String(days), ...a.params]).catch(() => []);
  }
  // FIX-4 1c — the two new triggers. Both are states with a DATE on them, so
  // unlike stage_change and lapsed_return they can honestly be looked back at.
  if (trigger === "attended_event") {
    return await query(
      `SELECT DISTINCT d.id FROM donors d
         JOIN event_attendees ea ON ea.donor_id=d.id AND ea.org_id=d.org_id
         JOIN events e ON e.id=ea.event_id
        WHERE d.org_id=? AND d.deleted_at IS NULL
          AND lower(coalesce(ea.status,'')) = 'attended'
          AND COALESCE(e.date::date, ${orgDateOfSql("ea.created_at", orgTzSql("d.org_id"))}) >= ${cut}${a.sql}`,
      [orgId, ...a.params]).catch(() => []);
  }
  if (trigger === "became_member") {
    return await query(
      `SELECT DISTINCT d.id FROM donors d
         JOIN memberships m ON m.donor_id=d.id AND m.org_id=d.org_id
        WHERE d.org_id=? AND d.deleted_at IS NULL
          AND m.status IN ('active','grace')
          AND m.joined_on IS NOT NULL AND m.joined_on <> '' AND m.joined_on::date >= ${cut}${a.sql}`,
      [orgId, ...a.params]).catch(() => []);
  }
  // JOURNEYS-3 — the new triggers look back with the sweep's own definition.
  const J = await journeyMod();
  if (J.SWEEP_TRIGGER_KEYS.includes(trigger) || trigger === "first_event") {
    const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
    const tf = t.trigger_filters || {};
    let ids = [...new Set((await lifecycleRows(orgId, trigger, today, days))
      .filter(r => trigger !== "volunteer_hours" || !tf.hours || (r.crossed || []).includes(Number(tf.hours)))
      .filter(r => trigger !== "task_outcome" || String(r.outcome || "") === String(tf.outcome || ""))
      .map(r => r.donor_id))];
    if (ids.length && a.sql) {
      const keep = new Set((await query(`SELECT d.id FROM donors d WHERE d.org_id=? AND d.id = ANY(?::text[])${a.sql}`,
        [orgId, ids, ...a.params])).map(r => r.id));
      ids = ids.filter(id => keep.has(id));
    }
    return ids.map(id => ({ id }));
  }
  // stage_change and lapsed_return are events rather than states: there is no
  // honest way to look backwards for them, so the offer says none rather than
  // guessing. They still fire forwards, which is what they are for.
  return [];
}

// Put somebody in a journey by hand. This is the `by_hand` trigger and the
// "apply to everyone who qualifies" button, and it goes through the SAME
// engine as every automatic trigger — one path in.
app.post("/journeys/:id/apply", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const J = await journeyMod();
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  if (await JA.refuseNotActive(res, query, J, req.user.orgId, t)) return;   // FLOWS-3

  const joinOthers = !(req.body && req.body.joinOthers === false);
  let ids = Array.isArray(req.body && req.body.donorIds) ? req.body.donorIds.map(String) : null;
  if (!ids && req.body && req.body.allQualifying === true) {
    const days = Math.min(365, Math.max(1, Number(req.body.days) || 90));
    // THE SAME AUDIENCE AND THE SAME SPLIT THE COUNT WAS TAKEN WITH. The
    // confirm said a number; this puts in exactly the people behind it.
    const audience = J.validateAudience(req.body.audience || {});
    ids = (await applySplit(req.user.orgId, t, days, audience, joinOthers)).willJoin.map(r => r.id);
  }
  if (!ids || !ids.length) return res.status(400).json({ error: "no_donors", message: "Name who should go in, or ask for everyone who qualifies." });
  if (ids.length > 2000) return res.status(400).json({ error: "too_many", message: "That is more than 2,000 people at once. Narrow it first." });

  const out = { started: [], skipped: [] };
  for (const id of ids) {
    // The engine is told the journey's OWN trigger, so a by-hand apply of a
    // gift_over journey still records the trigger it belongs to. `forceId`
    // pins the journey: this is a person choosing one, not a rule picking.
    const r = await maybeStartJourney(req.user.orgId, id, "by_hand", { forceJourneyId: t.id, joinOthers });
    (r.started ? out.started : out.skipped).push({ donorId: id, ...r });
  }
  const n = out.started.length;
  res.json({ journeyId: t.id, name: t.name, started: n,
    skipped: out.skipped.length, detail: out,
    planIds: out.started.map(r => r.planId),
    sentence: `${n} ${n === 1 ? "person" : "people"} joined ${t.name}.` });
}));

// JOURNEYS-3 · UNDO AN APPLY. Takes the plans that apply made back out: their
// steps, the threads and review drafts their steps opened, their timeline
// lines, and puts back any step another journey moved to make room and any
// exclusive journey they replaced. Then each person's soonest remaining step
// takes their thread again. Only plans of this journey, in this org, still
// running.
app.post("/journeys/:id/apply/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query("SELECT id, name FROM cultivation_templates WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const want = Array.isArray(req.body && req.body.planIds) ? req.body.planIds.map(String).slice(0, 2000) : [];
  const plans = want.length ? await query(
    `SELECT * FROM cultivation_plans WHERE org_id=? AND template_id=? AND status='active' AND id = ANY(?::text[])`,
    [orgId, t.id, want]) : [];
  if (!plans.length) return res.status(404).json({ error: "nothing_to_undo", sentence: "Those people are no longer in it, so there is nothing to undo." });
  const planIds = plans.map(p => p.id);
  const steps = await query(`SELECT id, thread_id, status FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?::text[])`, [orgId, planIds]);
  const stepIds = steps.map(s => s.id);
  // Steps of OTHER journeys that moved to make room go back to their dates,
  // and the lines that said they moved come off the timeline.
  const movedIds = (await query(`SELECT id FROM cultivation_plan_steps WHERE org_id=? AND moved_by_plan_id = ANY(?::text[])`,
    [orgId, planIds])).map(r => r.id);
  if (movedIds.length) await run(`DELETE FROM interactions WHERE org_id=? AND created_by=? AND metadata->>'via'='journey_spacing'
                                    AND metadata->>'step_id' = ANY(?::text[])`, [orgId, JOURNEY_ACTOR.id, movedIds]);
  await run(`UPDATE cultivation_plan_steps SET due_date=moved_from, moved_from=NULL, moved_reason=NULL, moved_by_plan_id=NULL
              WHERE org_id=? AND moved_by_plan_id = ANY(?::text[]) AND status='pending' AND moved_from IS NOT NULL`, [orgId, planIds]);
  for (const s of steps.filter(x => x.status === "open" && x.thread_id)) {
    await run(`DELETE FROM threads WHERE id=? AND org_id=? AND closed_at IS NULL`, [s.thread_id, orgId]);
  }
  if (stepIds.length) {
    await run(`DELETE FROM milestone_drafts WHERE org_id=? AND milestone_key = ANY(?::text[]) AND status='pending_review'`,
      [orgId, stepIds.map(id => `journey-step:${id}`)]);
    await run(`DELETE FROM interactions WHERE org_id=? AND created_by=? AND metadata->>'step_id' = ANY(?::text[])`,
      [orgId, JOURNEY_ACTOR.id, stepIds]);
  }
  const lineIds = plans.map(p => p.start_interaction_id).filter(Boolean);
  if (lineIds.length) await run(`DELETE FROM interactions WHERE org_id=? AND id = ANY(?::text[]) AND created_by=?`, [orgId, lineIds, JOURNEY_ACTOR.id]);
  // An exclusive journey these replaced is running again.
  for (const p of plans.filter(x => x.replaced_plan_id)) {
    await run(`UPDATE cultivation_plans SET status='active', closed_at=NULL, replaced_reason=NULL
                WHERE id=? AND org_id=? AND status='abandoned'`, [p.replaced_plan_id, orgId]).catch(() => null);
    await run(`UPDATE cultivation_plan_steps SET status='pending', closed_at=NULL, closed_by=NULL, closed_by_name=NULL, skip_reason=NULL, thread_id=NULL
                WHERE plan_id=? AND org_id=? AND status='skipped' AND closed_by=?`, [p.replaced_plan_id, orgId, JOURNEY_ACTOR.id]);
  }
  await run(`DELETE FROM cultivation_plans WHERE org_id=? AND id = ANY(?::text[])`, [orgId, planIds]);
  for (const donorId of [...new Set(plans.map(p => p.donor_id))]) {
    await advanceCultivationPlan(orgId, donorId, { actorId: actor(req).id, actorName: actor(req).name });
  }
  if (req.audit) req.audit.entity("journey", t.id, t.name);
  res.json({ journeyId: t.id, undone: plans.length,
    sentence: `${plans.length} ${plans.length === 1 ? "person was" : "people were"} taken back out of ${t.name}.` });
}));

// ── DATES-1 · MANY PEOPLE INTO ONE JOURNEY, FROM THE DONORS LIST ───────────
// The bulk bar's "Add to a journey". It is the profile's "Add to a journey"
// for each person, through the one start path (maybeStartJourney, by hand),
// and nothing else: the same rules, the same reasons. A preview first, which
// writes nothing; then the start, inline up to BATCH_INLINE_MAX people and on
// the queue above it, with progress; then one Undo for the whole batch, for
// BATCH_UNDO_DAYS days, that stops every journey it started.
const BATCH_INLINE_MAX = 2000;
const BATCH_MAX = 50000;
const BATCH_UNDO_DAYS = 30;
const BATCH_CHUNK = 25;
const JQ = require("../../jobQueue");

// Who the batch would start and who it would not, by the start path's own
// rules, in one read of the people and one of the journeys they are in.
// FLOWS-1: the split itself lives in journeyBatchOptions.js, so the dialog's
// per-journey rows and this preview and start use one set of rules.
async function batchSplit(orgId, t, ids, joinOthers = true) {
  const J = await journeyMod();
  return JBO.splitFor(J, t, ids, await JBO.loadFacts(query, orgId, ids), joinOthers);
}
// The lines under the count, largest first, in the shared words.
async function batchLines(skipCounts) {
  const J = await journeyMod();
  // Largest first; a tie keeps the one order SKIP_REASONS lists, so the
  // preview and the result read the same way round.
  const rank = k => { const i = Object.keys(J.SKIP_REASONS).indexOf(k); return i < 0 ? 99 : i; };
  return Object.entries(skipCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))
    .map(([reason, n]) => ({ reason, count: n, sentence: J.skipLine(reason, n) + "." }));
}
const countsOf = skips => Object.fromEntries(Object.entries(skips).map(([k, v]) => [k, Array.isArray(v) ? v.length : Number(v) || 0]));
const batchIdsFrom = body => {
  const raw = Array.isArray(body && body.donorIds) ? body.donorIds : [];
  return [...new Set(raw.map(x => String(x || "").trim()).filter(x => /^[A-Za-z0-9_-]{1,64}$/.test(x)))];
};
JBO.register(app, { query, journeyMod, requireAuth, wrap, batchIdsFrom, BATCH_MAX });   // FLOWS-1 item 1
async function batchJourney(orgId, id) {
  const [t] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL", [id, orgId]);
  return t || null;
}

// THE PREVIEW. A POST because the list can be thousands of ids long; it
// writes nothing.
app.post("/journeys/:id/batch/preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const t = await batchJourney(orgId, req.params.id);
  if (!t) return res.status(404).json({ error: "Not found", message: "That journey no longer exists." });
  const ids = batchIdsFrom(req.body);
  if (!ids.length) return res.status(400).json({ error: "no_donors", sentence: "Check at least one person first." });
  if (ids.length > BATCH_MAX) return res.status(400).json({ error: "too_many", sentence: `That is more than ${BATCH_MAX.toLocaleString("en-US")} people at once. Narrow the list first.` });
  const joinOthers = !(req.body && req.body.joinOthers === false);
  const PL = await planMod();
  const J = await journeyMod();
  if (await JA.refuseNotActive(res, query, J, orgId, t)) return;   // FLOWS-3
  const DDj = await import("../../shared/displayDate.js");
  const split = await batchSplit(orgId, t, ids, joinOthers);
  const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
  const v = PL.validateTemplate({ name: t.name, steps: t.steps });
  // FLOWS-3: per person, and from the journey's own date when it has one.
  const per = await JBP.batchPeople(query, orgId, t, ids, split, today);
  const first = v.ok ? PL.planFromTemplate({ steps: v.steps, today: per.anchor }, orgTime.addDays)[0] || null : null;
  const n = split.willStart.length;
  const lines = await batchLines(countsOf(split.skips));
  res.json({
    journeyId: t.id, name: t.name, asked: ids.length, willStart: n, joinOthers,
    firstStep: first ? { label: first.label, dueDate: first.dueDate, dueLabel: DDj.displayDate(first.dueDate) } : null,
    lines, runsAsJob: n > BATCH_INLINE_MAX, breakdown: per.breakdown, people: per.people, anchorNote: per.anchorNote,
    touches: J.touchesSentence(t.steps || []),
    sentence: `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} will start ${t.name}.`
      + (first ? ` The first step is "${first.label}", due ${DDj.displayDate(first.dueDate)}.` : "")
      + " Nothing is sent. Every step waits for you.",
  });
}));

// Run a batch from where it got to: each person through the one start path,
// the batch row updated every few people so the screen can show progress. A
// retried job picks up at `done`, and a person already in it is skipped by
// the start path itself, so nobody starts twice.
async function runBatch(orgId, batchId) {
  const [b] = await query("SELECT * FROM journey_batches WHERE id=? AND org_id=?", [batchId, orgId]);
  if (!b || b.status !== "running") return { skipped: true };
  const ids = Array.isArray(b.donor_ids) ? b.donor_ids : [];
  const skipCounts = { ...(b.skip_counts || {}) };
  let done = Number(b.done) || 0, started = Number(b.started) || 0, skipped = Number(b.skipped) || 0;
  for (let i = done; i < ids.length; i += BATCH_CHUNK) {
    const chunk = ids.slice(i, i + BATCH_CHUNK);
    const planIds = [];
    for (const id of chunk) {
      const r = await maybeStartJourney(orgId, id, "by_hand", { forceJourneyId: b.template_id, joinOthers: b.join_others !== false });
      if (r && r.started) { started++; planIds.push(r.planId); }
      else { skipped++; const k = (r && r.reason) || "could_not_start"; skipCounts[k] = (skipCounts[k] || 0) + 1; }
    }
    done = Math.min(ids.length, i + chunk.length);
    if (planIds.length) await run(`UPDATE cultivation_plans SET batch_id=? WHERE org_id=? AND id = ANY(?::text[])`, [batchId, orgId, planIds]);
    await run(`UPDATE journey_batches SET done=?, started=?, skipped=?, skip_counts=?::jsonb, plan_ids = plan_ids || ?::jsonb WHERE id=? AND org_id=?`,
      [done, started, skipped, JSON.stringify(skipCounts), JSON.stringify(planIds), batchId, orgId]);
  }
  await run(`UPDATE journey_batches SET status='done', finished_at=NOW(), donor_ids=NULL WHERE id=? AND org_id=? AND status='running'`, [batchId, orgId]);
  return { started, skipped };
}
JQ.handle("journeyBatch", async (payload) => {
  if (!payload || !payload.orgId || !payload.batchId) return { skipped: true };
  try { return await runBatch(payload.orgId, payload.batchId); }
  catch (e) {
    await run(`UPDATE journey_batches SET error=? WHERE id=? AND org_id=?`, [String(e.message || e).slice(0, 300), payload.batchId, payload.orgId]).catch(() => null);
    throw e;
  }
});

async function batchOut(orgId, b) {
  const lines = await batchLines(b.skip_counts || {});
  const undoUntil = b.created_at ? new Date(new Date(b.created_at).getTime() + BATCH_UNDO_DAYS * 86400000) : null;
  const canUndo = b.status === "done" && !b.undone_at && undoUntil && undoUntil > new Date();
  const n = Number(b.started) || 0;
  return {
    batchId: b.id, journeyId: b.template_id, name: b.template_name, status: b.undone_at ? "undone" : b.status,
    asked: Number(b.asked) || 0, done: Number(b.done) || 0, started: n, skipped: Number(b.skipped) || 0, lines,
    canUndo: !!canUndo, undoUntil: undoUntil ? undoUntil.toISOString() : null, error: b.error || null,
    sentence: b.undone_at ? `Undone. ${n.toLocaleString("en-US")} ${n === 1 ? "person was" : "people were"} taken out of ${b.template_name}.`
      : b.status === "running" ? `Starting ${b.template_name}: ${Number(b.done).toLocaleString("en-US")} of ${Number(b.asked).toLocaleString("en-US")} people so far.`
      : `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} started ${b.template_name}.`,
  };
}

// THE START. Up to BATCH_INLINE_MAX people answer in this request with the
// counts; more go to the queue and the screen follows the batch.
app.post("/journeys/:id/batch", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const t = await batchJourney(orgId, req.params.id);
  if (!t) return res.status(404).json({ error: "Not found", message: "That journey no longer exists." });
  const ids = batchIdsFrom(req.body);
  if (!ids.length) return res.status(400).json({ error: "no_donors", sentence: "Check at least one person first." });
  if (ids.length > BATCH_MAX) return res.status(400).json({ error: "too_many", sentence: `That is more than ${BATCH_MAX.toLocaleString("en-US")} people at once. Narrow the list first.` });
  const joinOthers = !(req.body && req.body.joinOthers === false);
  if (await JA.refuseNotActive(res, query, await journeyMod(), orgId, t)) return;   // FLOWS-3
  const batchId = "jb_" + uuid().replace(/-/g, "").slice(0, 16);
  await run(`INSERT INTO journey_batches (id, org_id, template_id, template_name, status, asked, donor_ids, join_others, created_by, created_by_name)
             VALUES (?,?,?,?, 'running', ?, ?::jsonb, ?, ?, ?)`,
    [batchId, orgId, t.id, t.name, ids.length, JSON.stringify(ids), joinOthers, actor(req).id, actor(req).name]);
  if (req.audit) { req.audit.entity("journey", t.id, t.name); req.audit.summary(`Started ${t.name} for ${ids.length} ${ids.length === 1 ? "person" : "people"} from the Donors list.`, { count: ids.length, batchId }); }
  if (ids.length > BATCH_INLINE_MAX) {
    const jobId = await JQ.enqueue({ name: "journeyBatch", orgId, key: `journeyBatch:${batchId}`, payload: { orgId, batchId } });
    await run(`UPDATE journey_batches SET job_id=? WHERE id=? AND org_id=?`, [jobId, batchId, orgId]);
    const [b] = await query("SELECT * FROM journey_batches WHERE id=? AND org_id=?", [batchId, orgId]);
    return res.status(202).json({ ...(await batchOut(orgId, b)), job: true });
  }
  await runBatch(orgId, batchId);
  const [b] = await query("SELECT * FROM journey_batches WHERE id=? AND org_id=?", [batchId, orgId]);
  res.json({ ...(await batchOut(orgId, b)), job: false });
}));

// A batch's progress and counts. A GET, and it writes nothing.
app.get("/journeys/batches/:batchId", requireAuth, wrap(async (req, res) => {
  const [b] = await query("SELECT * FROM journey_batches WHERE id=? AND org_id=?", [req.params.batchId, req.user.orgId]);
  if (!b) return res.status(404).json({ error: "Not found" });
  res.json(await batchOut(req.user.orgId, b));
}));
// The batches this org can still undo, newest first (the 30 days).
app.get("/journeys/batches", requireAuth, wrap(async (req, res) => {
  const rows = await query(`SELECT * FROM journey_batches WHERE org_id=? AND created_at > NOW() - (?::int * INTERVAL '1 day')
                             ORDER BY created_at DESC LIMIT 50`, [req.user.orgId, BATCH_UNDO_DAYS]);
  res.json({ batches: await Promise.all(rows.map(b => batchOut(req.user.orgId, b))) });
}));

// ONE UNDO FOR THE BATCH. Every journey it started is stopped: the steps not
// yet done are removed, with their open thread and any draft waiting for
// review, and steps already done stay done. A journey nobody has done a step
// of is taken back out entirely, as if it had not started. Anything the start
// moved or replaced is put back, and each person's soonest remaining step
// takes their thread again.
app.post("/journeys/batches/:batchId/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [b] = await query("SELECT * FROM journey_batches WHERE id=? AND org_id=?", [req.params.batchId, orgId]);
  if (!b) return res.status(404).json({ error: "Not found" });
  const out0 = await batchOut(orgId, b);
  if (b.undone_at) return res.status(409).json({ error: "already_undone", sentence: "This batch has already been undone." });
  if (b.status === "running") return res.status(409).json({ error: "still_running", sentence: "It is still starting people. Undo it when it finishes." });
  if (!out0.canUndo) return res.status(409).json({ error: "too_late", sentence: `A batch can be undone for ${BATCH_UNDO_DAYS} days. This one is older than that.` });
  const planIds = Array.isArray(b.plan_ids) ? b.plan_ids.map(String) : [];
  const plans = planIds.length ? await query(
    `SELECT * FROM cultivation_plans WHERE org_id=? AND id = ANY(?::text[]) AND batch_id=?`, [orgId, planIds, b.id]) : [];
  const live = plans.filter(p => p.status === "active");
  const liveIds = live.map(p => p.id);
  let stopped = 0, removed = 0;
  if (liveIds.length) {
    const steps = await query(`SELECT id, plan_id, thread_id, status FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?::text[])`, [orgId, liveIds]);
    const notDone = steps.filter(s => s.status === "pending" || s.status === "open");
    const notDoneIds = notDone.map(s => s.id);
    // Steps of other journeys moved to make room go back to their dates.
    const movedIds = (await query(`SELECT id FROM cultivation_plan_steps WHERE org_id=? AND moved_by_plan_id = ANY(?::text[])`, [orgId, liveIds])).map(r => r.id);
    if (movedIds.length) await run(`DELETE FROM interactions WHERE org_id=? AND created_by=? AND metadata->>'via'='journey_spacing'
                                      AND metadata->>'step_id' = ANY(?::text[])`, [orgId, JOURNEY_ACTOR.id, movedIds]);
    await run(`UPDATE cultivation_plan_steps SET due_date=moved_from, moved_from=NULL, moved_reason=NULL, moved_by_plan_id=NULL
                WHERE org_id=? AND moved_by_plan_id = ANY(?::text[]) AND status='pending' AND moved_from IS NOT NULL`, [orgId, liveIds]);
    const threadIds = notDone.filter(s => s.status === "open" && s.thread_id).map(s => s.thread_id);
    if (threadIds.length) await run(`DELETE FROM threads WHERE org_id=? AND id = ANY(?::text[]) AND closed_at IS NULL`, [orgId, threadIds]);
    if (notDoneIds.length) {
      await run(`DELETE FROM milestone_drafts WHERE org_id=? AND milestone_key = ANY(?::text[]) AND status='pending_review'`,
        [orgId, notDoneIds.map(id => `journey-step:${id}`)]);
      await run(`DELETE FROM interactions WHERE org_id=? AND created_by=? AND metadata->>'step_id' = ANY(?::text[])`, [orgId, JOURNEY_ACTOR.id, notDoneIds]);
      await run(`DELETE FROM cultivation_plan_steps WHERE org_id=? AND id = ANY(?::text[])`, [orgId, notDoneIds]);
    }
    // An exclusive journey these replaced runs again.
    for (const p of live.filter(x => x.replaced_plan_id)) {
      await run(`UPDATE cultivation_plans SET status='active', closed_at=NULL, replaced_reason=NULL
                  WHERE id=? AND org_id=? AND status='abandoned'`, [p.replaced_plan_id, orgId]).catch(() => null);
      await run(`UPDATE cultivation_plan_steps SET status='pending', closed_at=NULL, closed_by=NULL, closed_by_name=NULL, skip_reason=NULL, thread_id=NULL
                  WHERE plan_id=? AND org_id=? AND status='skipped' AND closed_by=?`, [p.replaced_plan_id, orgId, JOURNEY_ACTOR.id]);
    }
    const keptStep = new Set(steps.filter(s => s.status === "done" || s.status === "skipped").map(s => s.plan_id));
    const untouched = live.filter(p => !keptStep.has(p.id));
    const worked = live.filter(p => keptStep.has(p.id));
    if (untouched.length) {
      const lineIds = untouched.map(p => p.start_interaction_id).filter(Boolean);
      if (lineIds.length) await run(`DELETE FROM interactions WHERE org_id=? AND id = ANY(?::text[]) AND created_by=?`, [orgId, lineIds, JOURNEY_ACTOR.id]);
      await run(`DELETE FROM cultivation_plans WHERE org_id=? AND id = ANY(?::text[])`, [orgId, untouched.map(p => p.id)]);
      removed = untouched.length;
    }
    if (worked.length) {
      await run(`UPDATE cultivation_plans SET status='abandoned', closed_at=NOW(), replaced_reason=?
                  WHERE org_id=? AND id = ANY(?::text[]) AND status='active'`,
        [`Stopped when the batch that started it was undone by ${actor(req).name || "a person"}. Steps already done stay done.`, orgId, worked.map(p => p.id)]);
      stopped = worked.length;
    }
    // SENDS-1 (W-1107-Fundraising-29): Undo removes everything the batch made. The
    // steps' own Threads went above (and their tasks with them, by the thread's
    // trigger); this is the backstop for any journey Thread opened for these people
    // while the batch ran that no step points to any more, and for the batch's
    // scheduled journey emails, which would otherwise wait on a step that is gone.
    const batchDonors = [...new Set(live.map(p => p.donor_id))];
    await run(`DELETE FROM threads t WHERE t.org_id=? AND t.donor_id = ANY(?::text[]) AND t.closed_at IS NULL
                 AND t.opening_interaction_id IS NULL AND t.opening_gift_id IS NULL
                 AND t.created_at >= ? AND t.created_at <= COALESCE(?::timestamptz, NOW()) + INTERVAL '10 seconds'
                 AND NOT EXISTS (SELECT 1 FROM cultivation_plan_steps s WHERE s.org_id = t.org_id AND s.thread_id = t.id)`,
      [orgId, batchDonors, b.created_at, b.finished_at || null]).catch(e => console.error("[journey] undo backstop:", e.message));
    await run(`UPDATE journey_sends SET status='skipped', reason='batch_undone', updated_at=NOW() WHERE org_id=? AND plan_id = ANY(?::text[]) AND status IN ('scheduled','failed')`,
      [orgId, liveIds]).catch(e => console.error("[journey] undo sends:", e.message));
    for (const donorId of [...new Set(live.map(p => p.donor_id))]) {
      await advanceCultivationPlan(orgId, donorId, { actorId: actor(req).id, actorName: actor(req).name });
    }
  }
  await run(`UPDATE journey_batches SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?`,
    [actor(req).id, actor(req).name, b.id, orgId]);
  if (req.audit) { req.audit.entity("journey", b.template_id, b.template_name); req.audit.summary(`Undid adding ${live.length} ${live.length === 1 ? "person" : "people"} to ${b.template_name}.`, { batchId: b.id, count: live.length }); }
  const n = live.length;
  res.json({ batchId: b.id, undone: n, removed, stopped,
    sentence: `${n.toLocaleString("en-US")} ${n === 1 ? "person was" : "people were"} taken out of ${b.template_name}.`
      + (stopped ? ` ${stopped} had a step done already; that step stays done.` : "") });
}));

// JOURNEYS-3 · JOURNEY SETTINGS: the touch gap. No two steps from different
// journeys land within this many days for one person. 7 by default.
app.put("/journeys/settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const J = await journeyMod();
  const n = Number(req.body && req.body.touchGapDays);
  if (!Number.isInteger(n) || n < J.TOUCH_GAP_MIN || n > J.TOUCH_GAP_MAX) {
    return res.status(400).json({ error: "invalid_gap", sentence: `Pick a whole number of days from ${J.TOUCH_GAP_MIN} to ${J.TOUCH_GAP_MAX}.` });
  }
  await run(`UPDATE orgs SET journey_touch_gap_days=? WHERE id=?`, [n, req.user.orgId]);
  res.json({ touchGapDays: n, sentence: `No more than one touch every ${n} ${n === 1 ? "day" : "days"} for anyone, across all their journeys.` });
}));

// JOURNEYS-3 · EVERY JOURNEY A PERSON IS IN, with the next step from each.
// A GET, and it writes nothing.
app.get("/donors/:id/journeys", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (!(await orgOwns("donors", req.params.id, orgId))) return res.status(404).json({ error: "Donor not found" });
  const plans = await query(
    `SELECT p.id, p.template_id, p.template_name, p.priority, p.applied_on, COALESCE(ct.exclusive, false) AS exclusive
       FROM cultivation_plans p LEFT JOIN cultivation_templates ct ON ct.id = p.template_id AND ct.org_id = p.org_id
      WHERE p.org_id=? AND p.donor_id=? AND p.status='active' ORDER BY p.priority DESC, p.applied_on`, [orgId, req.params.id]);
  const steps = plans.length ? await query(
    `SELECT id, plan_id, seq, label, due_date, status, moved_reason FROM cultivation_plan_steps
      WHERE org_id=? AND plan_id = ANY(?::text[]) ORDER BY seq`, [orgId, plans.map(p => p.id)]) : [];
  res.json({
    touchGapDays: await journeyTouchGap(orgId),
    journeys: plans.map(p => {
      const mine = steps.filter(s => s.plan_id === p.id);
      const next = mine.find(s => s.status === "open") || mine.find(s => s.status === "pending") || null;
      return { planId: p.id, journeyId: p.template_id, name: p.template_name, priority: p.priority, exclusive: !!p.exclusive,
        enteredOn: p.applied_on, total: mine.length, done: mine.filter(s => s.status === "done" || s.status === "skipped").length,
        next: next ? { id: next.id, seq: next.seq, label: next.label, dueDate: next.due_date,
                       open: next.status === "open", movedReason: next.moved_reason || null } : null };
    }),
  });
}));
}

module.exports = { routers, mount };
