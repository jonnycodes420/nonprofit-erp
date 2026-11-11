// server/admin/sales/links.js · SALES-1. ASSOCIATIONS, MANY TO MANY.
//
// A contact belongs to one or more organizations (one primary); a deal links to
// one primary organization and any number of contacts. Every link may carry a
// label ("Decision maker", "Champion"). Each pair is stored once, in one order
// (PAIRS), so associating from either side writes the same row.
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");

// The stored order of each pair: [a, b].
const PAIRS = { "contact|org": ["contact", "org"], "org|contact": ["contact", "org"], "deal|org": ["deal", "org"], "org|deal": ["deal", "org"],
  "deal|contact": ["deal", "contact"], "contact|deal": ["deal", "contact"] };
// A primary is one per a-record across b's of that type: a contact's primary org, a deal's primary org.
const HAS_PRIMARY = new Set(["contact|org", "deal|org"]);

function orient(t1, id1, t2, id2) {
  const p = PAIRS[`${t1}|${t2}`];
  if (!p) return null;
  return p[0] === t1 ? { a_type: t1, a_id: id1, b_type: t2, b_id: id2 } : { a_type: t2, a_id: id2, b_type: t1, b_id: id1 };
}

async function associate(ctx, t1, id1, t2, id2, { label = null, primary = null } = {}, who, importId = null) {
  const o = orient(t1, id1, t2, id2);
  if (!o) return { error: "invalid", message: `A ${t1} can't be linked to a ${t2}.` };
  for (const [t, id] of [[t1, id1], [t2, id2]]) {
    const [r] = await ctx.query(`SELECT id FROM ${M.OBJECTS[t].table} WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!r) return { error: "not_found", message: `That ${M.OBJECTS[t].label.toLowerCase()} doesn't exist.` };
  }
  const key = `${o.a_type}|${o.b_type}`;
  const [{ n }] = HAS_PRIMARY.has(key)
    ? await ctx.query(`SELECT COUNT(*)::int AS n FROM sales_links l JOIN ${M.OBJECTS[o.b_type].table} b ON b.id = l.b_id AND b.deleted_at IS NULL
                        WHERE l.a_type = ? AND l.a_id = ? AND l.b_type = ? AND l.is_primary`, [o.a_type, o.a_id, o.b_type])
    : [{ n: 1 }];
  // The first org a contact or a deal is linked to is its primary unless told otherwise.
  const isPrimary = HAS_PRIMARY.has(key) && (primary === true || (primary == null && n === 0));
  if (isPrimary) await ctx.run(`UPDATE sales_links SET is_primary = false WHERE a_type = ? AND a_id = ? AND b_type = ?`, [o.a_type, o.a_id, o.b_type]);
  await ctx.run(`INSERT INTO sales_links (id, a_type, a_id, b_type, b_id, label, is_primary, import_id, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (a_type, a_id, b_type, b_id) DO UPDATE SET label = COALESCE(EXCLUDED.label, sales_links.label),
                   is_primary = sales_links.is_primary OR EXCLUDED.is_primary`,
    [newId("sli"), o.a_type, o.a_id, o.b_type, o.b_id, M.clean(label), isPrimary, importId, who.id, who.name]);
  return { ok: true };
}

async function unassociate(ctx, t1, id1, t2, id2) {
  const o = orient(t1, id1, t2, id2);
  if (!o) return { error: "invalid" };
  const r = await ctx.run(`DELETE FROM sales_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`, [o.a_type, o.a_id, o.b_type, o.b_id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

async function relabel(ctx, t1, id1, t2, id2, { label, primary }) {
  const o = orient(t1, id1, t2, id2);
  if (!o) return { error: "invalid" };
  if (primary === true) await ctx.run(`UPDATE sales_links SET is_primary = false WHERE a_type = ? AND a_id = ? AND b_type = ?`, [o.a_type, o.a_id, o.b_type]);
  const sets = [], vals = [];
  if (label !== undefined) { sets.push("label = ?"); vals.push(M.clean(label)); }
  if (primary !== undefined) { sets.push("is_primary = ?"); vals.push(!!primary && HAS_PRIMARY.has(`${o.a_type}|${o.b_type}`)); }
  if (!sets.length) return { ok: true };
  const r = await ctx.run(`UPDATE sales_links SET ${sets.join(", ")} WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`, [...vals, o.a_type, o.a_id, o.b_type, o.b_id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// What one record is linked to, live records only: { org: [...], contact: [...], deal: [...] }.
async function linkedOf(query, type, id) {
  const rows = await query(`SELECT a_type, a_id, b_type, b_id, label, is_primary FROM sales_links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`, [type, id, type, id]);
  const want = { org: new Set(), contact: new Set(), deal: new Set() };
  const meta = new Map();
  for (const r of rows) {
    const [ot, oid] = r.a_type === type && r.a_id === id ? [r.b_type, r.b_id] : [r.a_type, r.a_id];
    if (!want[ot]) continue;   // a partner's link to an org (Part B) is drawn by the partner's own section
    want[ot].add(oid); meta.set(`${ot}:${oid}`, { label: r.label, primary: r.is_primary });
  }
  const out = { org: [], contact: [], deal: [] };
  const [orgs, contacts, deals] = await Promise.all([
    want.org.size ? query(`SELECT id, name, domain, city, state FROM sales_orgs WHERE id = ANY(?) AND deleted_at IS NULL`, [[...want.org]]) : [],
    want.contact.size ? query(`SELECT id, first_name, last_name, title, emails, role FROM sales_contacts WHERE id = ANY(?) AND deleted_at IS NULL`, [[...want.contact]]) : [],
    want.deal.size ? query(`SELECT d.id, d.name, d.value_cents, d.stage_id, s.name AS stage_name, s.kind AS stage_kind FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id WHERE d.id = ANY(?) AND d.deleted_at IS NULL`, [[...want.deal]]) : [],
  ]);
  for (const [t, list] of [["org", orgs], ["contact", contacts], ["deal", deals]]) {
    out[t] = list.map(r => ({ ...r, value_cents: r.value_cents != null ? Number(r.value_cents) : undefined, displayName: M.nameOf(t, r), ...meta.get(`${t}:${r.id}`) }))
      .sort((x, y) => (y.primary - x.primary) || x.displayName.localeCompare(y.displayName));
  }
  return out;
}

module.exports = { PAIRS, orient, associate, unassociate, relabel, linkedOf };
