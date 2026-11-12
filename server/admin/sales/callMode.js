// server/admin/sales/callMode.js · SALES-2 item 3. CALL MODE.
//
// "Start calling" on any list or view opens one screen with one person to call at a time.
//   buildQueue(input, today)    pure: the queue, one entry per organization, in the view's order
//   loadQueue(query, opts)      reads that input in a fixed number of statements
//   logOutcome(ctx, b, who)     one click: logs the call with its outcome, then sets the next
//                               step by the outcome's rule (sales_settings "call_rules")
//
// WHO IS OFFERED. For each organization of the view, in order: its executive director or
// development director (anyone else only when neither can be called) who has a number left
// (a number marked bad is not), whoever was tried least recently first. The queue SKIPS:
//   anyone marked Do not contact (the person, or their organization)
//   anyone with an open task due after today (the person or their organization): a
//     "call again in 2 days" waits for its day
//   anyone already called today
//   an organization closed as Not a fit, and one already worked this session (`done`)
//   an organization with a meeting ahead, or where someone was reached today (a Connected
//     or Meeting booked outcome): its other person isn't called on top of that
// An organization whose people can't be called but which has a main line is offered on that
// line, asking for its ED or DD.
//
// THE PLANTED DEFECT (SALES2_PLANT=dnc on the server, tests only): a contact marked Do not
// contact is still offered. tests/sales2-prospecting.test.js §3 goes red.
"use strict";
const M = require("./model");
const LISTS = require("./lists");
const ACT = require("./activities");
const REC = require("./records");
const LINKS = require("./links");
const PIPES = require("./pipelines");
const { civil, addDays } = require("./today");
const { phonesLeft } = require("./prospectRows");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const TZ = "America/New_York";

// The eight outcomes, in the order of the buttons. `connect`: counted as a conversation.
const OUTCOMES = [
  { key: "no_answer", label: "No answer" },
  { key: "voicemail", label: "Left voicemail" },
  { key: "gatekeeper", label: "Gatekeeper" },
  { key: "not_now", label: "Connected – not now", connect: true },
  { key: "interested", label: "Connected – interested", connect: true },
  { key: "meeting_booked", label: "Meeting booked", connect: true, meeting: true },
  { key: "not_a_fit", label: "Not a fit", lost: true },
  { key: "bad_number", label: "Bad number", flagPhone: true },
];
const OUTCOME_KEYS = OUTCOMES.map(o => o.key);
// Each outcome's next step. callAgainDays: a "call again" task that many business days on
// (null: none). emailToday: an "email them" task due today. stage: the deal's stage after.
const DEFAULT_CALL_RULES = {
  no_answer: { callAgainDays: 2, emailToday: false, stage: null },
  voicemail: { callAgainDays: 3, emailToday: true, stage: null },
  gatekeeper: { callAgainDays: 2, emailToday: false, stage: null },
  not_now: { callAgainDays: 20, emailToday: false, stage: "Contacted" },
  interested: { callAgainDays: 2, emailToday: true, stage: "Contacted" },
  meeting_booked: { callAgainDays: null, emailToday: false, stage: "Meeting booked" },
  not_a_fit: { callAgainDays: null, emailToday: false, stage: "Lost" },
  bad_number: { callAgainDays: null, emailToday: false, stage: null },
};

function cleanRules(stored) {
  const out = {};
  for (const k of OUTCOME_KEYS) {
    const d = DEFAULT_CALL_RULES[k], s = (stored && stored[k]) || {};
    const n = s.callAgainDays === null || s.callAgainDays === "" ? null : s.callAgainDays === undefined ? d.callAgainDays : Math.round(Number(s.callAgainDays));
    out[k] = { callAgainDays: n != null && Number.isFinite(n) && n >= 0 && n <= 365 ? n : null,
      emailToday: "emailToday" in s ? !!s.emailToday : d.emailToday,
      stage: "stage" in s ? (M.clean(s.stage) || null) : d.stage };
  }
  // Booking a meeting always moves the deal to Meeting booked; Not a fit always closes it as Lost.
  out.meeting_booked.stage = out.meeting_booked.stage || "Meeting booked";
  out.not_a_fit.stage = "Lost";
  return out;
}
async function rules(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'call_rules'`);
  return cleanRules(r ? r.value : null);
}

// A day plus n business days (Saturday and Sunday don't count).
function addBusinessDays(day, n) {
  let d = day, left = n;
  while (left > 0) { d = addDays(d, 1); const w = new Date(`${d}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return d;
}

const isLead = c => c.role === "ED" || c.role === "Development Director";
const nameOf = c => M.nameOf("contact", c);

// input: { orgs: [list rows, in order], contactsByOrg: Map(orgId → [contact]), lastCall: Map("contact:id"|"org:id" → iso),
//          blocked: Set("contact:id"|"org:id") (open task due after today), done: Set(orgId) }
function buildQueue(input, today, tz = TZ) {
  const calledToday = k => { const t = input.lastCall.get(k); return !!t && civil(t, tz) === today; };
  const out = [];
  for (const o of input.orgs) {
    if (o.dnc || o.lost_at || input.done.has(o.id) || input.blocked.has(`org:${o.id}`) || (input.orgBusy && input.orgBusy.has(o.id))) continue;
    const people = (input.contactsByOrg.get(o.id) || []).filter(c => (PLANT === "dnc" || !c.dnc_at) && !input.blocked.has(`contact:${c.id}`));
    const callable = people.filter(c => phonesLeft(c.phones, c.bad_phones).length && !calledToday(`contact:${c.id}`));
    const pool = callable.some(isLead) ? callable.filter(isLead) : callable;
    pool.sort((a, b) => {
      const x = input.lastCall.get(`contact:${a.id}`) || "", y = input.lastCall.get(`contact:${b.id}`) || "";
      return x.localeCompare(y) || (a.role === "ED" ? -1 : b.role === "ED" ? 1 : 0);
    });
    const pick = pool[0];
    if (pick) { out.push({ orgId: o.id, contactId: pick.id, phone: phonesLeft(pick.phones, pick.bad_phones)[0], line: "direct" }); continue; }
    // The main line, asking for the ED or DD.
    const main = phonesLeft(o.phone ? [o.phone] : [], o.bad_phones)[0];
    if (main && !calledToday(`org:${o.id}`) && !people.some(c => calledToday(`contact:${c.id}`))) {
      const ask = people.filter(isLead).sort((a, b) => (a.role === "ED" ? -1 : 1))[0] || null;
      out.push({ orgId: o.id, contactId: ask ? ask.id : null, phone: main, line: "main" });
    }
  }
  return out;
}

// opts: { view, listId, done: [orgIds], now }
async function loadQueue(query, { view = {}, listId = null, done = [], now = Date.now() } = {}) {
  let v = view || {};
  if (listId) {
    const [l] = await query(`SELECT id, name, config FROM sales_lists WHERE id = ? AND deleted_at IS NULL`, [listId]);
    if (!l) return { error: "not_found", message: "That list doesn't exist." };
    v = require("./prospectLists").viewOf(l, v);
  }
  const today = civil(now, TZ);
  const orgs = LISTS.applyView(await LISTS.rowsFor(query, "org"), v);
  const ids = orgs.map(o => o.id);
  const CONNECT = OUTCOMES.filter(o => o.connect).map(o => o.key);
  const [contacts, calls, tasks, recent] = await Promise.all([
    ids.length ? query(`SELECT l.b_id AS org_id, c.id, c.first_name, c.last_name, c.title, c.role, c.phones, c.bad_phones, c.emails, c.dnc_at
                          FROM sales_links l JOIN sales_contacts c ON c.id = l.a_id AND c.deleted_at IS NULL
                         WHERE l.a_type = 'contact' AND l.b_type = 'org' AND l.b_id = ANY(?) ORDER BY c.created_at`, [ids]) : [],
    query(`SELECT l.record_type, l.record_id, MAX(a.at) AS t FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
            WHERE a.kind = 'call' AND a.deleted_at IS NULL AND l.record_type IN ('contact', 'org') GROUP BY l.record_type, l.record_id`),
    query(`SELECT DISTINCT l.record_type, l.record_id FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
            WHERE a.kind = 'task' AND a.done_at IS NULL AND a.deleted_at IS NULL AND a.due_on > ?::date AND l.record_type IN ('contact', 'org')`, [today]),
    // A meeting ahead, or a conversation in the last two days (read against today below).
    query(`SELECT a.kind, a.at, a.outcome, l.record_id AS org_id FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id AND l.record_type = 'org'
            WHERE a.deleted_at IS NULL AND ((a.kind = 'meeting' AND a.at > ?) OR (a.kind = 'call' AND a.outcome = ANY(?) AND a.at > ?))`,
      [new Date(now).toISOString(), CONNECT, new Date(now - 2 * 86400000).toISOString()]),
  ]);
  const orgBusy = new Set(recent.filter(r => r.kind === "meeting" || civil(r.at, TZ) === today).map(r => r.org_id));
  const contactsByOrg = new Map();
  for (const c of contacts) { if (!contactsByOrg.has(c.org_id)) contactsByOrg.set(c.org_id, []); contactsByOrg.get(c.org_id).push(c); }
  const lastCall = new Map(calls.map(r => [`${r.record_type}:${r.record_id}`, new Date(r.t).toISOString()]));
  const blocked = new Set(tasks.map(r => `${r.record_type}:${r.record_id}`));
  const queue = buildQueue({ orgs, contactsByOrg, lastCall, blocked, orgBusy, done: new Set(done.map(String)) }, today);
  const orgOf = new Map(orgs.map(o => [o.id, o]));
  const contactOf = new Map(contacts.map(c => [c.id, c]));
  const entry = e => {
    const o = orgOf.get(e.orgId), c = e.contactId ? contactOf.get(e.contactId) : null;
    return { ...e, org: { id: o.id, name: o.displayName, city: o.city, state: o.state, phone: o.phone, fit: { line: o.fit_line, misses: o.fit_misses || [] } },
      contact: c ? { id: c.id, name: nameOf(c), role: c.role, title: c.title, emails: c.emails || [] } : null };
  };
  const first = queue[0] ? entry(queue[0]) : null;
  if (first) {
    const recs = [["org", first.orgId], ...(first.contactId ? [["contact", first.contactId]] : [])];
    const acts = [];
    for (const [t, id] of recs) for (const a of await ACT.forRecord(query, t, id)) if (!acts.some(x => x.id === a.id)) acts.push(a);
    acts.sort((a, b) => new Date(b.at) - new Date(a.at));
    first.recent = acts.filter(a => a.kind !== "task").slice(0, 3).map(a => ({ id: a.id, kind: a.kind, at: a.at, body: a.body, outcome: a.outcome || null }));
    first.openTasks = acts.filter(a => a.kind === "task" && !a.done_at).slice(0, 3).map(a => ({ id: a.id, body: a.body, due_on: a.due_on }));
    first.deal = await openDealOf(query, first.orgId);
  }
  return { ok: true, today, total: queue.length, current: first, next: queue.slice(1, 6).map(entry),
    says: "One entry per organization, in the list's order. Skipped: Do not contact, an open task due after today, already called today, reached today, a meeting ahead, and Not a fit." };
}

// The organization's open deal it's linked to (the newest), or null.
async function openDealOf(query, orgId) {
  const [d] = await query(`SELECT d.id, d.name, d.stage_id, s.name AS stage_name FROM sales_links l JOIN sales_deals d ON d.id = l.a_id AND d.deleted_at IS NULL
                             JOIN sales_stages s ON s.id = d.stage_id AND s.kind = 'open'
                            WHERE l.a_type = 'deal' AND l.b_type = 'org' AND l.b_id = ? ORDER BY d.updated_at DESC LIMIT 1`, [orgId]);
  return d || null;
}

// The stage of that name in the deal's pipeline (or the first pipeline).
async function stageNamed(query, name, pipelineId = null) {
  const pipes = await PIPES.readAll(query);
  const p = pipes.find(x => x.id === pipelineId) || pipes[0];
  return p.stages.find(s => s.name.toLowerCase() === String(name || "").toLowerCase()) || null;
}

// The org's open deal, or a new one in `stageName` named for the org.
async function ensureDeal(ctx, org, contactIds, who, { source = "Cold call", stageName = "Lead" } = {}) {
  const have = await openDealOf(ctx.query, org.id);
  if (have) return { id: have.id, created: false };
  await PIPES.ensureDefaults(ctx, who);
  const st = (await stageNamed(ctx.query, stageName)) || (await stageNamed(ctx.query, "Lead"));
  const r = await REC.create(ctx, "deal", { name: org.name, stage_id: st ? st.id : undefined, source }, who, { force: true });
  if (r.error) return r;
  await LINKS.associate(ctx, "deal", r.id, "org", org.id, { primary: true }, who);
  for (const c of contactIds) await LINKS.associate(ctx, "deal", r.id, "contact", c, {}, who);
  return { id: r.id, created: true };
}

async function moveDeal(ctx, dealId, stageName, who, extra = {}) {
  const [d] = await ctx.query(`SELECT pipeline_id FROM sales_deals WHERE id = ?`, [dealId]);
  const st = await stageNamed(ctx.query, stageName, d && d.pipeline_id);
  if (!st) return { error: "invalid", message: `There is no stage called "${stageName}". Change the rule in Sales settings.` };
  return REC.setStage(ctx, dealId, st.id, who, extra);
}

// b: { orgId, contactId?, outcome, notes?, phone?, listId?, meeting?: { date, time, place, attendees } }
async function logOutcome(ctx, b, who, now = Date.now()) {
  const o = OUTCOMES.find(x => x.key === b.outcome);
  if (!o) return { error: "invalid", message: `An outcome is one of: ${OUTCOMES.map(x => x.label).join(", ")}.` };
  const [org] = await ctx.query(`SELECT id, name, phone, bad_phones FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [String(b.orgId || "")]);
  if (!org) return { error: "not_found", message: "That organization doesn't exist." };
  let contact = null;
  if (b.contactId) {
    [contact] = await ctx.query(`SELECT id, first_name, last_name, emails, phones, bad_phones FROM sales_contacts WHERE id = ? AND deleted_at IS NULL`, [String(b.contactId)]);
    if (!contact) return { error: "not_found", message: "That contact doesn't exist." };
  }
  if (o.meeting) {
    const MEET = require("./meetings");
    const bad = MEET.checkMeeting(b.meeting || {});
    if (bad) return bad;
  }
  const rule = (await rules(ctx.query))[o.key];
  const today = civil(now, TZ);
  const who2 = contact ? nameOf(contact) : org.name;
  const notes = String(b.notes || "").trim().slice(0, 5000);
  let deal = await openDealOf(ctx.query, org.id);
  const recs = () => [{ type: "org", id: org.id }, ...(contact ? [{ type: "contact", id: contact.id }] : []), ...(deal ? [{ type: "deal", id: deal.id }] : [])];
  const call = await ACT.create(ctx, { kind: "call", at: new Date(now).toISOString(), body: `${o.label}${b.phone ? ` (${b.phone})` : ""}${notes ? `. ${notes}` : ""}`, records: recs() }, who);
  if (call.error) return call;
  await ctx.run(`UPDATE sales_activities SET outcome = ?, list_id = ? WHERE id = ?`, [o.key, b.listId ? String(b.listId) : null, call.id]);
  const did = [`Logged: ${o.label}.`];
  const tasks = [];
  const task = async (body, due) => {
    const t = await ACT.create(ctx, { kind: "task", body, due_on: due, records: recs() }, who);
    if (t.ok) tasks.push({ id: t.id, body, due_on: due });
  };

  if (o.flagPhone) {
    const num = String(b.phone || "").trim();
    const onOrg = !contact || (num && !(contact.phones || []).some(p => p.replace(/\D/g, "") === num.replace(/\D/g, "")));
    const row = onOrg ? org : contact;
    const bad = [...new Set([...(row.bad_phones || []), num || (onOrg ? org.phone : (contact.phones || [])[0])].filter(Boolean))];
    await ctx.run(`UPDATE ${onOrg ? "sales_orgs" : "sales_contacts"} SET bad_phones = ?::jsonb, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
      [JSON.stringify(bad), who.id, who.name, row.id]);
    did.push(`${num || "The number"} is marked bad; the other contact is next.`);
  }
  if (o.lost) {
    await ctx.run(`UPDATE sales_orgs SET lost_at = ?, lost_reason = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
      [new Date(now).toISOString(), notes ? `Not a fit: ${notes}` : "Not a fit", who.id, who.name, org.id]);
    const open = await ctx.query(`SELECT d.id FROM sales_links l JOIN sales_deals d ON d.id = l.a_id AND d.deleted_at IS NULL JOIN sales_stages s ON s.id = d.stage_id AND s.kind = 'open'
                                   WHERE l.a_type = 'deal' AND l.b_type = 'org' AND l.b_id = ?`, [org.id]);
    for (const d of open) await moveDeal(ctx, d.id, rule.stage, who, { lostReason: notes ? `Not a fit: ${notes}` : "Not a fit" });
    did.push(`${org.name} is closed as Not a fit${open.length ? `, with ${open.length === 1 ? "its deal" : `its ${open.length} deals`} in Lost` : ""}.`);
  } else if (o.meeting) {
    const MEET = require("./meetings");
    const m = await MEET.book(ctx, { orgId: org.id, dealId: deal ? deal.id : null, contactIds: contact ? [contact.id] : [], ...b.meeting, stageName: rule.stage }, who, now);
    if (m.error) return m;
    deal = { id: m.dealId };
    tasks.push(...m.tasks);
    did.push(m.says);
  } else if (rule.stage) {
    if (!deal) { const d = await ensureDeal(ctx, org, contact ? [contact.id] : [], who, { stageName: rule.stage }); if (d.error) return d; deal = { id: d.id }; await ctx.run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, 'deal', ?, ?, ?) ON CONFLICT DO NOTHING`, [call.id, d.id, who.id, who.name]); }
    const mv = await moveDeal(ctx, deal.id, rule.stage, who);
    if (mv.error) return mv;
    if (!mv.unchanged) did.push(`The deal is in ${rule.stage}.`);
  }
  if (rule.callAgainDays != null) {
    const due = addBusinessDays(today, rule.callAgainDays);
    await task(`Call ${who2} again`, due);
    did.push(`Next: call again on ${due}.`);
  }
  if (rule.emailToday) { await task(`Email ${who2}`, today); did.push("An email task is due today."); }
  return { ok: true, id: call.id, dealId: deal ? deal.id : null, tasks, says: did.join(" "), connect: !!o.connect, meeting: !!o.meeting };
}

module.exports = { OUTCOMES, OUTCOME_KEYS, DEFAULT_CALL_RULES, cleanRules, rules, addBusinessDays, buildQueue, loadQueue, logOutcome, openDealOf, ensureDeal, moveDeal, stageNamed, PLANT };
