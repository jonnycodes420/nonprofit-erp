// server/admin/sales/merge.js · SALES-1. MERGE TWO ORGANIZATIONS OR TWO CONTACTS.
//
// The kept record takes every association, every activity (and, from Part B,
// every captured email) of the one merged into it, and fills its own empty
// fields from it. The other is marked merged (merged_into, deleted_at), never
// erased, and sales_merges keeps a record: who, when, both ids, the merged
// record as it was, and what moved. One transaction.
"use strict";
const { newId } = require("../../shared/newId");
const { withAmbientTransaction } = require("../../db/query");
const M = require("./model");
const REC = require("./records");

async function merge(ctx, type, keptId, goneId, who) {
  if (type !== "org" && type !== "contact") return { error: "invalid", message: "Only two organizations or two contacts are merged." };
  if (keptId === goneId) return { error: "invalid", message: "Pick two different records." };
  return withAmbientTransaction(async () => {
    const def = M.OBJECTS[type];
    const kept = await REC.readRow(ctx.query, type, keptId);
    const gone = await REC.readRow(ctx.query, type, goneId);
    if (!kept || !gone) return { error: "not_found" };
    // Fill the kept record's empty fields; a contact keeps every email and phone of both.
    const sets = [], vals = [];
    for (const f of def.fields) {
      if (f.readOnly || !f.col || f.col === "owner_id") continue;
      if (f.type === "list") {
        const both = [...new Set([...(kept[f.col] || []), ...(gone[f.col] || [])])];
        sets.push(`${f.col} = ?::jsonb`); vals.push(JSON.stringify(both));
      } else if ((kept[f.col] == null || kept[f.col] === "") && gone[f.col] != null && gone[f.col] !== "") {
        sets.push(`${f.col} = ?`); vals.push(gone[f.col]);
      }
    }
    if (type === "org" && !kept.steward_org_id && gone.steward_org_id) { sets.push("steward_org_id = ?"); vals.push(gone.steward_org_id); }
    sets.push("props = ?::jsonb || props"); vals.push(JSON.stringify(gone.props || {}));   // kept's own values win
    await ctx.run(`UPDATE ${def.table} SET ${sets.join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [...vals, who.id, who.name, keptId]);

    // Associations: repoint each of gone's links to kept, unless kept already has that pair.
    const links = await ctx.query(`SELECT id, a_type, a_id, b_type, b_id FROM sales_links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`, [type, goneId, type, goneId]);
    let movedLinks = 0;
    for (const l of links) {
      const side = l.a_type === type && l.a_id === goneId ? "a" : "b";
      const clash = await ctx.query(`SELECT id FROM sales_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`,
        side === "a" ? [l.a_type, keptId, l.b_type, l.b_id] : [l.a_type, l.a_id, l.b_type, keptId]);
      if (clash.length) { await ctx.run(`DELETE FROM sales_links WHERE id = ?`, [l.id]); continue; }
      await ctx.run(`UPDATE sales_links SET ${side}_id = ?, is_primary = CASE WHEN ? = 'a' THEN false ELSE is_primary END WHERE id = ?`, [keptId, side, l.id]);
      movedLinks++;
    }
    // Activities: every timeline entry of gone now sits on kept.
    const acts = await ctx.query(`SELECT activity_id FROM sales_activity_links WHERE record_type = ? AND record_id = ?`, [type, goneId]);
    for (const a of acts) {
      await ctx.run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [a.activity_id, type, keptId, who.id, who.name]);
    }
    await ctx.run(`DELETE FROM sales_activity_links WHERE record_type = ? AND record_id = ?`, [type, goneId]);
    // Captured email (Part B) moves the same way, when its table exists.
    // (Checked first: a failed statement would end the transaction.)
    const [reg] = await ctx.query(`SELECT to_regclass('sales_email_links') IS NOT NULL AS ok`);
    const movedEmail = !reg.ok ? 0 : (await ctx.run(`UPDATE sales_email_links SET record_id = ? WHERE record_type = ? AND record_id = ?
                                        AND NOT EXISTS (SELECT 1 FROM sales_email_links k WHERE k.email_id = sales_email_links.email_id AND k.record_type = ? AND k.record_id = ?)`,
      [keptId, type, goneId, type, keptId])).changes;
    await ctx.run(`UPDATE ${def.table} SET merged_into = ?, deleted_at = NOW(), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [keptId, who.id, who.name, goneId]);
    const moved = { links: movedLinks, activities: acts.length, emails: movedEmail };
    await ctx.run(`INSERT INTO sales_merges (id, object, kept_id, gone_id, gone_snapshot, moved, created_by, created_by_name) VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [newId("smg"), type, keptId, goneId, JSON.stringify(gone), JSON.stringify(moved), who.id, who.name]);
    return { ok: true, id: keptId, moved };
  });
}

async function mergesOf(query, type, id) {
  return query(`SELECT id, gone_id, gone_snapshot, moved, created_at, created_by_name FROM sales_merges WHERE object = ? AND kept_id = ? ORDER BY created_at DESC`, [type, id]);
}

module.exports = { merge, mergesOf };
