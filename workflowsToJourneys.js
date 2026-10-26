// FIX-49 Part 5 · WORKFLOWS BECOME JOURNEYS.
//
// AGENT-5 took the Workflows screen away, and the recipes an org had turned on
// kept running with no page of their own. A journey is the one place an
// automation lives now, so each running recipe becomes the journey that does
// the same thing, and the recipe stops. A recipe with no journey equivalent is
// kept running and recorded as kept, with the reason, so nobody loses a
// reminder they relied on without a person deciding it.
//
//   failed_recurring_recovery  -> "Monthly gift failed" (recurring_failed):
//                                 the update-your-card note to review, then a call
//   new_donor_welcome          -> "First gift welcome" (first_gift):
//                                 the thank-you to review, then a welcome call
//   major_gift_alert           -> "Major gift" (gift_over, the recipe's threshold):
//                                 a stewardship call for their officer
//   lapsing_reengage           -> "Stopped giving" (lapsed, the one lapse rule):
//                                 a re-engagement call (and the note to review
//                                 when the recipe drafted one)
//   instant_gift_thanks        kept: it tells the team a gift came in. A
//                                 journey reaches a donor's thread, not staff
//                                 inboxes, so there is no journey that does this.
//   quiet_past_pattern         kept: no journey trigger reads Drift's rhythm.
//   pledge_due_soon            kept: the pledge triggers are late or paid, not
//                                 due soon.
//
// Every outcome is a row in `workflow_conversions` (org, recipe, journey,
// outcome, reason), which is how "which orgs had any on" is answered without
// anybody reading an org's data, and one log line per org on the boot that did it.
//
// Idempotent: only rows still enabled are read, a converted row is switched
// off in the same transaction its journey is written, and an org that already
// has a running journey on the same trigger keeps it (the recipe joins it
// rather than starting a twin beside it).
const { query, withTransaction, queryTx, runTx, withTryAdvisoryLock, uuid } = require("./db");

const ACTOR = { id: "system:fix49-workflows", name: "Steward (workflows moved to journeys)" };
const asJson = (v, fb) => v == null ? fb : (typeof v === "object" ? v : (() => { try { return JSON.parse(v); } catch { return fb; } })());

// What each convertible recipe becomes. `steps(config)` mirrors the recipe's
// own actions: a drafted email becomes a step that drafts for her to review
// (never a send), a task becomes a call step on the person's thread.
const JOURNEY_FOR = {
  failed_recurring_recovery: {
    name: "Monthly gift failed", trigger: "recurring_failed", priority: 80, exclusive: true, preset: "recurring_failed",
    description: "A card did not go through. Help them fix it, kindly, and call if it stays stuck. (Was the Workflows recipe of the same kind.)",
    steps: () => [
      { type: "send", label: "Send the update-your-card note", offsetDays: 0, starter: "failed_card" },
      { type: "follow_up", label: "Call about the monthly gift that failed", offsetDays: 2 },
    ],
  },
  new_donor_welcome: {
    name: "First gift welcome", trigger: "first_gift", priority: 50,
    description: "Someone gave for the first time. Thank them, then call to say welcome. (Was the Workflows recipe of the same kind.)",
    steps: () => [
      { type: "send", label: "Send the thank-you", offsetDays: 0, draft: "thank_you" },
      { type: "thank", label: "Personal welcome call", offsetDays: 5 },
    ],
  },
  major_gift_alert: {
    name: "Major gift", trigger: "gift_over", priority: 90,
    description: "A gift over your major-gift amount came in. Their officer calls the same week. (Was the Workflows recipe of the same kind.)",
    amountCents: config => Math.max(1, Math.round((Number(config.threshold) > 0 ? Number(config.threshold) : 1000) * 100)),
    steps: () => [
      { type: "thank", label: "Steward the major gift: call them", offsetDays: 2 },
    ],
  },
  lapsing_reengage: {
    name: "Stopped giving", trigger: "lapsed", priority: 60,
    description: "Someone who gave before has given nothing in the last 12 months. Call before asking again. (Was the Workflows recipe of the same kind.)",
    steps: config => [
      ...(config.sendEmail ? [{ type: "send", label: "Send the we've-missed-you note", offsetDays: 0, draft: "impact_report" }] : []),
      { type: "follow_up", label: "Re-engage: call them", offsetDays: 7 },
    ],
  },
};
const KEPT = {
  instant_gift_thanks: "It tells your team a gift came in. A journey works on a donor's thread, not your team's inboxes, so it keeps running as your gift alert.",
  quiet_past_pattern: "No journey trigger reads Drift's giving rhythm yet, so it keeps running.",
  pledge_due_soon: "The pledge journey triggers are late or paid in full, not coming due, so it keeps running.",
};
const CONVERTIBLE = Object.keys(JOURNEY_FOR);

let Jmod = null;
const journeyShape = async () => (Jmod = Jmod || await import("./shared/journeyShape.js"));

// One recipe row to one journey. Returns the conversion row it wrote.
async function convertOne(wf, J) {
  const spec = JOURNEY_FOR[wf.recipe_key];
  const config = asJson(wf.config, {});
  let steps = spec.steps(config);
  // A step that names an EMAIL-1 starter drafts from the org's own copy of it.
  steps = await Promise.all(steps.map(async st => {
    if (!st.starter) return st;
    const tid = await require("./routes/emailTemplates").ensureStarterTemplate(wf.org_id, st.starter, ACTOR).catch(() => null);
    const { starter, ...rest } = st;
    return tid ? { ...rest, draft: `template:${tid}` } : rest;
  }));
  const v = J.validateJourney({ name: spec.name, description: spec.description, trigger: spec.trigger, priority: spec.priority,
    amountCents: spec.amountCents ? spec.amountCents(config) : undefined, steps, exclusive: !!spec.exclusive });
  if (!v.ok) return keep(wf, `It could not become a journey: ${v.errors[0].message}`);
  return withTransaction(async client => {
    // Re-read under the transaction: another replica may have done it.
    const [still] = await queryTx(client, `SELECT enabled FROM workflows WHERE id=? AND org_id=? FOR UPDATE`, [wf.id, wf.org_id]);
    if (!still || still.enabled !== true) return null;
    // A running journey on the same trigger (and amount) already does this.
    const [twin] = await queryTx(client,
      `SELECT id FROM cultivation_templates WHERE org_id=? AND trigger_key=? AND journey_enabled=true AND archived_at IS NULL
          AND (trigger_amount_cents IS NOT DISTINCT FROM ?) ORDER BY created_at ASC LIMIT 1`,
      [wf.org_id, v.trigger, v.amountCents]);
    let journeyId = twin && twin.id, outcome = "joined";
    if (!journeyId) {
      journeyId = "ct_" + uuid().slice(0, 10);
      outcome = "converted";
      await runTx(client,
        `INSERT INTO cultivation_templates (id,org_id,name,description,steps,trigger_key,trigger_amount_cents,priority,audience,preset_key,journey_enabled,created_by,created_by_name,trigger_filters,ever_enabled,exclusive)
         VALUES (?,?,?,?,?::jsonb,?,?,?,?::jsonb,?,true,?,?,?::jsonb,true,?)`,
        [journeyId, wf.org_id, v.name, v.description, JSON.stringify(v.steps), v.trigger, v.amountCents, v.priority,
         JSON.stringify(v.audience || {}), spec.preset || null, ACTOR.id, ACTOR.name, JSON.stringify(v.triggerFilters || {}), !!v.exclusive]);
    }
    await runTx(client,
      `UPDATE workflows SET enabled=false, config = COALESCE(config,'{}'::jsonb) || jsonb_build_object('became_journey', ?::text), updated_at=NOW()
        WHERE id=? AND org_id=?`, [journeyId, wf.id, wf.org_id]);
    const row = { id: "wfc_" + uuid().slice(0, 10), org_id: wf.org_id, workflow_id: wf.id, recipe_key: wf.recipe_key, journey_id: journeyId, outcome,
      reason: outcome === "joined" ? "A running journey already starts on the same event, so the recipe now runs as that journey." : `Now the journey "${v.name}".` };
    await runTx(client,
      `INSERT INTO workflow_conversions (id,org_id,workflow_id,recipe_key,journey_id,outcome,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,
      [row.id, row.org_id, row.workflow_id, row.recipe_key, row.journey_id, row.outcome, row.reason, ACTOR.id, ACTOR.name]);
    return row;
  });
}

// A recipe that stays: recorded once, so the list of what was kept is complete.
async function keep(wf, reason) {
  const [seen] = await query(`SELECT id FROM workflow_conversions WHERE org_id=? AND workflow_id=? AND outcome='kept'`, [wf.org_id, wf.id]);
  if (seen) return null;
  const row = { id: "wfc_" + uuid().slice(0, 10), org_id: wf.org_id, workflow_id: wf.id, recipe_key: wf.recipe_key, journey_id: null, outcome: "kept", reason };
  await query(`INSERT INTO workflow_conversions (id,org_id,workflow_id,recipe_key,journey_id,outcome,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.id, row.org_id, row.workflow_id, row.recipe_key, null, "kept", reason, ACTOR.id, ACTOR.name]);
  return row;
}

// Every enabled recipe (of one org, or all), once. Never fires a recipe or a
// journey: it writes the journey switched on, and the journey's own trigger
// starts people from the next event on (BUILD-25: never from a migration).
async function convertWorkflows(onlyOrgId = null) {
  const out = await withTryAdvisoryLock("fix49:workflows-to-journeys", async () => {
    const J = await journeyShape();
    const rows = await query(
      `SELECT w.* FROM workflows w JOIN orgs o ON o.id = w.org_id WHERE w.enabled = true ${onlyOrgId ? "AND w.org_id = ?" : ""}
        ORDER BY w.org_id, w.created_at`, onlyOrgId ? [onlyOrgId] : []);
    const done = [];
    for (const wf of rows) {
      try {
        const r = CONVERTIBLE.includes(wf.recipe_key) ? await convertOne(wf, J)
          : await keep(wf, KEPT[wf.recipe_key] || "Steward does not know this recipe, so it keeps running.");
        if (r) done.push(r);
      } catch (e) { console.error(`[workflows-to-journeys] ${wf.org_id} ${wf.recipe_key}:`, e.message); }
    }
    const byOrg = {};
    for (const r of done) (byOrg[r.org_id] = byOrg[r.org_id] || []).push(`${r.recipe_key} ${r.outcome}`);
    for (const [org, list] of Object.entries(byOrg)) console.log(`[workflows-to-journeys] ${org}: ${list.join(", ")}`);
    return done;
  });
  return Array.isArray(out) ? out : [];
}

module.exports = { convertWorkflows, JOURNEY_FOR, KEPT, CONVERTIBLE };
