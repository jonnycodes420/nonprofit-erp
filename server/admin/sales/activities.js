// server/admin/sales/activities.js · SALES-1. CALLS, MEETINGS, NOTES AND TASKS.
//
// Each has a date, a body and an owner, and is logged on any record. One
// activity can link to several records at once (a meeting with two contacts
// about one deal shows on all three timelines: sales_activity_links). A task
// has a due day, and is open (an empty box) or done (a check and the day).
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function checkRecords(query, records) {
  const list = (Array.isArray(records) ? records : []).filter(r => r && M.OBJECTS[r.type] && r.id);
  if (!list.length) return { error: "invalid", message: "An activity is logged on at least one record." };
  for (const t of M.OBJECT_IDS) {
    const ids = [...new Set(list.filter(r => r.type === t).map(r => String(r.id)))];
    if (!ids.length) continue;
    const found = await query(`SELECT id FROM ${M.OBJECTS[t].table} WHERE id = ANY(?) AND deleted_at IS NULL`, [ids]);
    if (found.length !== ids.length) return { error: "not_found", message: `A ${M.OBJECTS[t].label.toLowerCase()} it names doesn't exist.` };
  }
  const seen = new Set();
  return { list: list.filter(r => { const k = `${r.type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

// { kind, at?, body, owner_id?, due_on?, records: [{type, id}] }
async function create(ctx, b, who) {
  if (!M.ACTIVITY_KINDS.includes(b.kind)) return { error: "invalid", message: "An activity is a call, a meeting, a note or a task." };
  const body = String(b.body || "").trim().slice(0, 20000);
  if (!body) return { error: "invalid", message: `Say what the ${b.kind} was about.` };
  if (b.due_on && !DAY_RE.test(String(b.due_on))) return { error: "invalid", message: "The due day is a day, like 2026-11-03." };
  const at = b.at ? new Date(b.at) : new Date();
  if (Number.isNaN(at.getTime())) return { error: "invalid", message: "The date isn't a date." };
  const recs = await checkRecords(ctx.query, b.records);
  if (recs.error) return recs;
  const id = newId("sac");
  await ctx.run(`INSERT INTO sales_activities (id, kind, at, body, owner_id, due_on, created_by, created_by_name, updated_by, updated_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, b.kind, at.toISOString(), body, b.owner_id || who.id, b.kind === "task" ? (b.due_on || null) : null, who.id, who.name, who.id, who.name]);
  for (const r of recs.list) {
    await ctx.run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, r.type, String(r.id), who.id, who.name]);
  }
  return { ok: true, id };
}

// { body?, at?, due_on?, owner_id?, done?: true|false, records?: [...] }
async function update(ctx, id, b, who) {
  const [a] = await ctx.query(`SELECT id, kind FROM sales_activities WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!a) return { error: "not_found" };
  const sets = [], vals = [];
  if ("body" in b) { const s = String(b.body || "").trim().slice(0, 20000); if (!s) return { error: "invalid", message: "The body can't be empty." }; sets.push("body = ?"); vals.push(s); }
  if ("at" in b) { const d = new Date(b.at); if (Number.isNaN(d.getTime())) return { error: "invalid", message: "The date isn't a date." }; sets.push("at = ?"); vals.push(d.toISOString()); }
  if ("owner_id" in b) { sets.push("owner_id = ?"); vals.push(b.owner_id || null); }
  if (a.kind === "task" && "due_on" in b) { if (b.due_on && !DAY_RE.test(String(b.due_on))) return { error: "invalid", message: "The due day is a day, like 2026-11-03." }; sets.push("due_on = ?"); vals.push(b.due_on || null); }
  if (a.kind === "task" && "done" in b) { sets.push(b.done ? "done_at = COALESCE(done_at, NOW())" : "done_at = NULL"); }
  if (sets.length) await ctx.run(`UPDATE sales_activities SET ${sets.join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [...vals, who.id, who.name, id]);
  if (Array.isArray(b.records)) {
    const recs = await checkRecords(ctx.query, b.records);
    if (recs.error) return recs;
    await ctx.run(`DELETE FROM sales_activity_links WHERE activity_id = ?`, [id]);
    for (const r of recs.list) await ctx.run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)`, [id, r.type, String(r.id), who.id, who.name]);
  }
  return { ok: true, id };
}

async function remove(ctx, id, who) {
  const r = await ctx.run(`UPDATE sales_activities SET deleted_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [who.id, who.name, id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// Activities with every record each one is on (names included), newest first.
async function withRecords(query, acts) {
  if (!acts.length) return [];
  const links = await query(`SELECT activity_id, record_type, record_id FROM sales_activity_links WHERE activity_id = ANY(?)`, [acts.map(a => a.id)]);
  const ids = { org: new Set(), contact: new Set(), deal: new Set() };
  for (const l of links) ids[l.record_type] && ids[l.record_type].add(l.record_id);
  const [orgs, contacts, deals] = await Promise.all([
    ids.org.size ? query(`SELECT id, name FROM sales_orgs WHERE id = ANY(?) AND deleted_at IS NULL`, [[...ids.org]]) : [],
    ids.contact.size ? query(`SELECT id, first_name, last_name, emails FROM sales_contacts WHERE id = ANY(?) AND deleted_at IS NULL`, [[...ids.contact]]) : [],
    ids.deal.size ? query(`SELECT id, name FROM sales_deals WHERE id = ANY(?) AND deleted_at IS NULL`, [[...ids.deal]]) : [],
  ]);
  const names = new Map([...orgs.map(r => [`org:${r.id}`, M.nameOf("org", r)]), ...contacts.map(r => [`contact:${r.id}`, M.nameOf("contact", r)]), ...deals.map(r => [`deal:${r.id}`, M.nameOf("deal", r)])]);
  return acts.map(a => ({ ...a, records: links.filter(l => l.activity_id === a.id && names.has(`${l.record_type}:${l.record_id}`))
    .map(l => ({ type: l.record_type, id: l.record_id, name: names.get(`${l.record_type}:${l.record_id}`) })) }));
}

const COLS = `a.id, a.kind, a.at, a.body, a.owner_id, a.due_on::text AS due_on, a.done_at, a.created_by_name, a.outcome, a.meeting`;
async function forRecord(query, type, id) {
  const acts = await query(`SELECT ${COLS} FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
                             WHERE l.record_type = ? AND l.record_id = ? AND a.deleted_at IS NULL ORDER BY a.at DESC`, [type, id]);
  return withRecords(query, acts);
}

// The Tasks sub-tab: { state: open|done|all, owner? }. Open first by due day, then done by when.
async function tasks(query, { state = "open", owner = null } = {}) {
  const where = ["a.kind = 'task'", "a.deleted_at IS NULL"], vals = [];
  if (state === "open") where.push("a.done_at IS NULL");
  if (state === "done") where.push("a.done_at IS NOT NULL");
  if (owner) { where.push("a.owner_id = ?"); vals.push(owner); }
  const acts = await query(`SELECT ${COLS} FROM sales_activities a WHERE ${where.join(" AND ")}
                             ORDER BY (a.done_at IS NOT NULL), a.due_on NULLS LAST, a.done_at DESC NULLS LAST, a.at DESC LIMIT 1000`, vals);
  return withRecords(query, acts);
}

module.exports = { create, update, remove, forRecord, tasks, withRecords };
