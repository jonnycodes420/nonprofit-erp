// server/admin/sales/cadences.js · SALES-2 items 9 and 10. CADENCES.
//
// A cadence is a named list of steps, each a day offset and an action: call, email (a
// template), LinkedIn touch, or a custom task. Enrolling a contact makes each step a TASK on its
// day. Steps are tasks Jonathan does; nothing is ever sent or dialled by Steward.
//
// A cadence ENDS for a contact, and its remaining tasks are closed, when:
//   a reply from them is captured by the mailbox (email.capture)       reason "reply"
//   a call with them ends Connected, or a meeting is booked            reason "connected" / "meeting"
//   they (or their organization) are marked Do not contact              reason "dnc"
//   Jonathan ends it by hand                                            reason "ended"
// A closed task keeps its row (done_at set, outcome "cadence_ended"), so the timeline still shows
// what was planned.
//
// The two defaults are read from here under fixed ids until the first write stores them (a GET
// never writes): "New prospect (14 days)", and the built-in "Customer asks", started for a deal's
// people when the deal reaches a won stage (Paying).
//
// THE PLANTED DEFECT (SALES2_PLANT=cadencereply on the server, tests only): a captured reply ends
// the cadence but leaves its later tasks open. tests/sales2-inbound.test.js §9 goes red.
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");
const ACT = require("./activities");
const { civil, addDays } = require("./today");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const TZ = "America/New_York";
const ACTIONS = ["call", "email", "linkedin", "custom"];
const DEFAULTS = [
  { id: "scd_new_prospect", name: "New prospect (14 days)", builtin: null, steps: [
    { day: 0, action: "call" }, { day: 0, action: "email", template: "stp_intro" }, { day: 2, action: "call" },
    { day: 5, action: "call", text: "Call, and leave a voicemail" }, { day: 8, action: "email" },
    { day: 14, action: "call" }, { day: 14, action: "email", text: "Breakup email" }] },
  { id: "scd_customer_asks", name: "Customer asks", builtin: "customer_asks", steps: [
    { day: 30, action: "custom", text: "Ask for a testimonial" }, { day: 45, action: "custom", text: "Ask for two referrals" },
    { day: 90, action: "call", text: "Check-in call" }] },
];
const WORDS = { call: "Call", email: "Email", linkedin: "LinkedIn touch", custom: "Task" };

function cleanSteps(steps) {
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    const day = Math.round(Number(s.day));
    if (!Number.isFinite(day) || day < 0 || day > 365 || !ACTIONS.includes(s.action)) return { error: "Each step is a day (0 to 365) and an action: call, email, LinkedIn touch or a task." };
    if (s.action === "custom" && !M.clean(s.text)) return { error: "A task step says what to do." };
    out.push({ day, action: s.action, ...(s.template ? { template: String(s.template).slice(0, 40) } : {}), ...(M.clean(s.text) ? { text: M.clean(s.text).slice(0, 200) } : {}) });
  }
  if (!out.length) return { error: "A cadence has at least one step." };
  return { steps: out.sort((a, b) => a.day - b.day) };
}

async function all(query) {
  const rows = await query(`SELECT id, name, steps, builtin FROM sales_cadences WHERE deleted_at IS NULL ORDER BY builtin NULLS FIRST, name`);
  const have = new Set((await query(`SELECT id FROM sales_cadences`)).map(r => r.id));
  return [...DEFAULTS.filter(d => !have.has(d.id)), ...rows];
}
async function ensureDefaults(ctx, who) {
  for (const d of DEFAULTS) {
    await ctx.run(`INSERT INTO sales_cadences (id, name, steps, builtin, created_by, created_by_name) VALUES (?, ?, ?::jsonb, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [d.id, d.name, JSON.stringify(d.steps), d.builtin, who.id, who.name]);
  }
}
async function save(ctx, id, b, who) {
  await ensureDefaults(ctx, who);
  const name = M.clean(b.name);
  if (!name) return { error: "invalid", message: "Name the cadence." };
  const c = cleanSteps(b.steps);
  if (c.error) return { error: "invalid", message: c.error };
  if (id) {
    const r = await ctx.run(`UPDATE sales_cadences SET name = ?, steps = ?::jsonb, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [name, JSON.stringify(c.steps), who.id, who.name, id]);
    return r.changes ? { ok: true, id } : { error: "not_found" };
  }
  const nid = newId("scd");
  await ctx.run(`INSERT INTO sales_cadences (id, name, steps, created_by, created_by_name) VALUES (?, ?, ?::jsonb, ?, ?)`, [nid, name, JSON.stringify(c.steps), who.id, who.name]);
  return { ok: true, id: nid };
}
async function remove(ctx, id, who) {
  await ensureDefaults(ctx, who);
  const r = await ctx.run(`UPDATE sales_cadences SET deleted_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL AND builtin IS NULL`, [who.id, who.name, id]);
  return r.changes ? { ok: true } : { error: "not_found", message: "That cadence doesn't exist, or it is built in." };
}

// Enroll contacts: each step becomes a task on its day. → { enrolled, skipped: [{ id, says }] }
async function enroll(ctx, cadenceId, contactIds, who, now = Date.now(), { dealId = null } = {}) {
  await ensureDefaults(ctx, who);
  const [cad] = await ctx.query(`SELECT id, name, steps FROM sales_cadences WHERE id = ? AND deleted_at IS NULL`, [cadenceId]);
  if (!cad) return { error: "not_found", message: "That cadence doesn't exist." };
  const ids = [...new Set((contactIds || []).map(String))].slice(0, 2000);
  if (!ids.length) return { error: "invalid", message: "Choose at least one contact." };
  const today = civil(now, TZ);
  const tpls = await require("./templates").all(ctx.query);
  let enrolled = 0; const skipped = [];
  for (const cid of ids) {
    const [c] = await ctx.query(`SELECT c.id, c.first_name, c.last_name, c.emails, c.dnc_at,
                                        (SELECT l.b_id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL WHERE l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org' ORDER BY l.is_primary DESC LIMIT 1) AS org_id,
                                        (SELECT bool_or(o.dnc_at IS NOT NULL) FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id WHERE l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org') AS org_dnc
                                   FROM sales_contacts c WHERE c.id = ? AND c.deleted_at IS NULL`, [cid]);
    if (!c) { skipped.push({ id: cid, says: "doesn't exist" }); continue; }
    const name = M.nameOf("contact", c);
    if (c.dnc_at || c.org_dnc) { skipped.push({ id: cid, says: `${name} is marked Do not contact` }); continue; }
    const [on] = await ctx.query(`SELECT id FROM sales_cadence_enrollments WHERE cadence_id = ? AND contact_id = ? AND ended_at IS NULL`, [cad.id, cid]);
    if (on) { skipped.push({ id: cid, says: `${name} is already in it` }); continue; }
    const eid = newId("sce");
    await ctx.run(`INSERT INTO sales_cadence_enrollments (id, cadence_id, contact_id, deal_id, started_on, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [eid, cad.id, cid, dealId, today, who.id, who.name]);
    const records = [{ type: "contact", id: cid }, ...(c.org_id ? [{ type: "org", id: c.org_id }] : []), ...(dealId ? [{ type: "deal", id: dealId }] : [])];
    for (const s of cad.steps) {
      const tpl = s.template ? tpls.find(t => t.id === s.template) : null;
      const what = s.text || (tpl ? `${WORDS[s.action]}: ${tpl.name}` : WORDS[s.action]);
      const t = await ACT.create(ctx, { kind: "task", body: `${what} · ${name} (${cad.name}, day ${s.day})`, due_on: addDays(today, s.day), records }, who);
      if (t.ok) await ctx.run(`UPDATE sales_activities SET enrollment_id = ?, step_action = ? WHERE id = ?`, [eid, s.action, t.id]);
    }
    enrolled++;
  }
  return { ok: true, enrolled, skipped };
}

// End every running cadence of these contacts and close their remaining step tasks.
async function endFor(ctx, contactIds, reason, who) {
  const ids = [...new Set((contactIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ended: 0, closed: 0 };
  const live = await ctx.query(`SELECT id FROM sales_cadence_enrollments WHERE contact_id = ANY(?) AND ended_at IS NULL`, [ids]);
  if (!live.length) return { ended: 0, closed: 0 };
  const eids = live.map(e => e.id);
  await ctx.run(`UPDATE sales_cadence_enrollments SET ended_at = NOW(), end_reason = ? WHERE id = ANY(?)`, [reason, eids]);
  const closed = PLANT === "cadencereply" && reason === "reply" ? { changes: 0 }
    : await ctx.run(`UPDATE sales_activities SET done_at = NOW(), outcome = 'cadence_ended', updated_at = NOW(), updated_by = ?, updated_by_name = ?
                      WHERE enrollment_id = ANY(?) AND kind = 'task' AND done_at IS NULL AND deleted_at IS NULL`, [who.id, who.name, eids]);
  return { ended: eids.length, closed: closed.changes };
}
async function endForOrg(ctx, orgId, reason, who) {
  const people = await ctx.query(`SELECT a_id FROM sales_links WHERE a_type = 'contact' AND b_type = 'org' AND b_id = ?`, [orgId]);
  return endFor(ctx, people.map(p => p.a_id), reason, who);
}

// A deal reached a won stage: its people start "Customer asks" (once per deal).
async function onWon(ctx, dealId, who, now = Date.now()) {
  const [had] = await ctx.query(`SELECT id FROM sales_cadence_enrollments WHERE deal_id = ? AND cadence_id = 'scd_customer_asks'`, [dealId]);
  if (had) return { ok: true, already: true };
  const people = await ctx.query(`SELECT b_id FROM sales_links WHERE a_type = 'deal' AND a_id = ? AND b_type = 'contact'`, [dealId]);
  if (!people.length) return { ok: true, enrolled: 0 };
  return enroll(ctx, "scd_customer_asks", people.map(p => p.b_id), who, now, { dealId });
}

// Running enrollments, for a contact's page and the cadence list.
async function running(query, { contactId = null } = {}) {
  return query(`SELECT e.id, e.cadence_id, c.name AS cadence, e.contact_id, e.started_on::text AS started_on, e.ended_at, e.end_reason,
                       (SELECT COUNT(*)::int FROM sales_activities a WHERE a.enrollment_id = e.id AND a.done_at IS NULL AND a.deleted_at IS NULL) AS open_steps
                  FROM sales_cadence_enrollments e JOIN sales_cadences c ON c.id = e.cadence_id
                 WHERE ${contactId ? "e.contact_id = ?" : "e.ended_at IS NULL"} ORDER BY e.created_at DESC LIMIT 500`, contactId ? [contactId] : []);
}

// Call mode's "today's cadence calls": contacts with an open call step due today or earlier.
async function dueCalls(query, today) {
  return query(`SELECT l.record_id AS contact_id, MIN(a.due_on)::text AS due_on FROM sales_activities a
                  JOIN sales_activity_links l ON l.activity_id = a.id AND l.record_type = 'contact'
                 WHERE a.enrollment_id IS NOT NULL AND a.step_action = 'call' AND a.kind = 'task' AND a.done_at IS NULL AND a.deleted_at IS NULL AND a.due_on <= ?::date
                 GROUP BY l.record_id ORDER BY MIN(a.due_on), l.record_id`, [today]);
}

module.exports = { ACTIONS, DEFAULTS, cleanSteps, all, ensureDefaults, save, remove, enroll, endFor, endForOrg, onWon, running, dueCalls, PLANT };
