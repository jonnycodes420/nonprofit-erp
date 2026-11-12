// server/admin/sales/prospectLists.js · SALES-2 item 1. PROSPECT LISTS.
//
// A list is a saved view of organizations (config: { filters, sort }) plus its own
// membership (sales_list_members), so the same organization can be on several lists
// ("KY orgs $100K–$2M" and "Louisville arts"). An import lands its organizations in a
// named list; undoing the import takes them off it again. Opening a list is the
// Organizations list with "On the list is <this one>" ahead of the list's own filters.
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");

async function all(query) {
  return query(`SELECT l.id, l.name, l.config, l.created_at, l.created_by_name,
                       (SELECT COUNT(*)::int FROM sales_list_members m JOIN sales_orgs o ON o.id = m.sales_org_id AND o.deleted_at IS NULL WHERE m.list_id = l.id) AS orgs
                  FROM sales_lists l WHERE l.deleted_at IS NULL ORDER BY l.name`);
}

async function create(ctx, name, config, who) {
  const n = M.clean(name);
  if (!n) return { error: "invalid", message: "Name the list." };
  const [dup] = await ctx.query(`SELECT id FROM sales_lists WHERE deleted_at IS NULL AND lower(name) = lower(?)`, [n]);
  if (dup) return { error: "invalid", message: `There is already a list called "${n}".` };
  const id = newId("sls");
  await ctx.run(`INSERT INTO sales_lists (id, name, config, created_by, created_by_name, updated_by, updated_by_name) VALUES (?, ?, ?::jsonb, ?, ?, ?, ?)`,
    [id, n, JSON.stringify(config && typeof config === "object" ? config : {}), who.id, who.name, who.id, who.name]);
  return { ok: true, id, name: n };
}

// An import's `list`: { id } of a list, or { name } of a new one (or an existing one by name).
async function listFor(ctx, arg, who) {
  if (!arg) return null;
  if (arg.id) {
    const [l] = await ctx.query(`SELECT id, name FROM sales_lists WHERE id = ? AND deleted_at IS NULL`, [String(arg.id)]);
    return l || { error: "invalid", message: "That list doesn't exist." };
  }
  const n = M.clean(arg.name);
  if (!n) return null;
  const [l] = await ctx.query(`SELECT id, name FROM sales_lists WHERE deleted_at IS NULL AND lower(name) = lower(?)`, [n]);
  if (l) return l;
  const r = await create(ctx, n, {}, who);
  return r.error ? r : { id: r.id, name: r.name };
}

async function addMember(ctx, listId, orgId, who, importId = null) {
  await ctx.run(`INSERT INTO sales_list_members (list_id, sales_org_id, import_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT (list_id, sales_org_id) DO NOTHING`,
    [listId, orgId, importId, who.id, who.name]);
}

// { name?, config? }
async function update(ctx, id, b, who) {
  const sets = [], vals = [];
  if ("name" in b) { const n = M.clean(b.name); if (!n) return { error: "invalid", message: "Name the list." }; sets.push("name = ?"); vals.push(n); }
  if ("config" in b) { sets.push("config = ?::jsonb"); vals.push(JSON.stringify(b.config && typeof b.config === "object" ? b.config : {})); }
  if (!sets.length) return { error: "invalid" };
  const r = await ctx.run(`UPDATE sales_lists SET ${sets.join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [...vals, who.id, who.name, id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// Add or take off organizations by id.
async function members(ctx, id, { add = [], remove = [] }, who) {
  const [l] = await ctx.query(`SELECT id FROM sales_lists WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!l) return { error: "not_found" };
  const ids = [...new Set(add.map(String))].slice(0, 5000);
  const live = ids.length ? (await ctx.query(`SELECT id FROM sales_orgs WHERE id = ANY(?) AND deleted_at IS NULL`, [ids])).map(r => r.id) : [];
  for (const o of live) await addMember(ctx, id, o, who);
  const gone = remove.length ? await ctx.run(`DELETE FROM sales_list_members WHERE list_id = ? AND sales_org_id = ANY(?)`, [id, remove.map(String)]) : { changes: 0 };
  return { ok: true, added: live.length, removed: gone.changes };
}

// A list is deleted; its organizations stay.
async function remove(ctx, id, who) {
  const r = await ctx.run(`UPDATE sales_lists SET deleted_at = NOW(), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [who.id, who.name, id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// The view that shows one list: its membership first, then its own filters and sort.
function viewOf(list, extra = {}) {
  const c = list.config || {};
  return { ...c, ...extra, filters: [{ field: "list_ids", op: "in", value: [list.id] }, ...(c.filters || []), ...(extra.filters || [])], sort: extra.sort || c.sort };
}

module.exports = { all, create, listFor, addMember, update, members, remove, viewOf };
