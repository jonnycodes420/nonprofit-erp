// scripts/ops/demoTidy/journal.js · DEMO-TIDY-1. EVERY CHANGE, KEPT WHOLE, SO IT CAN BE PUT BACK.
//
// Each change the tidy makes is one entry: rows deleted (kept whole, with the
// rows a foreign key would cascade away), columns updated (their values before),
// or rows inserted (their ids). apply() writes one audit row per entry and one
// for the run; undo() reads the run's entries and reverses them newest first.
"use strict";
const crypto = require("crypto");

const rid = p => p + crypto.randomBytes(8).toString("hex");
const ident = t => { if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`Not a table name: ${t}`); return `"${t}"`; };

// The tables whose rows a delete from `table` cascades into, one column each.
async function cascadeChildren(c, table) {
  const { rows } = await c.query(
    `SELECT conrelid::regclass::text AS child, a.attname AS col, pa.attname AS pcol
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1 AND k.confdeltype IN ('c', 'n')`, [table]);
  return rows;
}

function journal(c, step) {
  const entries = [];
  const J = {
    entries,
    rid,
    // Delete rows of `table` matching `where` (params $1…), keeping them and what cascades with them.
    async del(table, where, params, label) {
      const rows = (await c.query(`SELECT * FROM ${ident(table)} WHERE ${where}`, params)).rows;
      if (!rows.length) return 0;
      const kids = [];
      for (const k of await cascadeChildren(c, table)) {
        const keys = rows.map(r => r[k.pcol]).filter(v => v != null).map(String);
        if (!keys.length) continue;
        const kr = (await c.query(`SELECT * FROM ${ident(k.child)} WHERE ${ident(k.col)}::text = ANY($1::text[])`, [keys])).rows;
        if (kr.length) kids.push({ table: k.child, rows: kr });
      }
      await c.query(`DELETE FROM ${ident(table)} WHERE ${where}`, params);
      entries.push({ step, op: "delete", table, rows, kids, label: label || `${rows.length} ${table}` });
      return rows.length;
    },
    // Set `set` on rows of `table` matching `where`, keeping each row's values before.
    // `key` names the row's key columns when it is not `id` (REPAIR-1: org_mail_types).
    async update(table, where, params, set, label, key = ["id"]) {
      const cols = Object.keys(set);
      const before = (await c.query(`SELECT ${key.map(ident).join(", ")}, ${cols.map(ident).join(", ")} FROM ${ident(table)} WHERE ${where}`, params)).rows;
      if (!before.length) return 0;
      const n = params.length;
      await c.query(`UPDATE ${ident(table)} SET ${cols.map((k, i) => `${ident(k)} = $${n + i + 1}`).join(", ")} WHERE ${where}`,
        [...params, ...cols.map(k => set[k])]);
      entries.push({ step, op: "update", table, before, after: set, label: label || `${before.length} ${table}`, ...(key.join() === "id" ? {} : { key }) });
      return before.length;
    },
    // Insert one row; the entry keeps its id.
    async insert(table, row, label) {
      const cols = Object.keys(row);
      await c.query(`INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        cols.map(k => (row[k] !== null && typeof row[k] === "object" && !(row[k] instanceof Date)) ? JSON.stringify(row[k]) : row[k]));
      entries.push({ step, op: "insert", table, ids: [row.id], label: label || `1 ${table}` });
    },
    // A row something else wrote (a gift through recordGift, a fund merge): how to take it back is named.
    note(entry) { entries.push({ step, ...entry }); },
  };
  return J;
}

const reinsert = async (c, table, rows) => {
  if (!rows.length) return;
  await c.query(`INSERT INTO ${ident(table)} SELECT * FROM jsonb_populate_recordset(NULL::${ident(table)}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
};

// Reverse one entry. `extra` handles the named kinds (gift, fund_merge).
async function reverse(c, e, extra) {
  if (e.op === "delete") {
    await reinsert(c, e.table, e.rows);
    for (const k of e.kids || []) await reinsert(c, k.table, k.rows);
  } else if (e.op === "update") {
    const key = e.key || ["id"];
    for (const b of e.before) {
      const cols = Object.keys(b).filter(k => !key.includes(k));
      const v = k => (b[k] !== null && typeof b[k] === "object" && !(b[k] instanceof Date)) ? JSON.stringify(b[k]) : b[k];
      await c.query(`UPDATE ${ident(e.table)} SET ${cols.map((k, i) => `${ident(k)} = $${key.length + i + 1}`).join(", ")}
                      WHERE ${key.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ")}`, [...key.map(k => b[k]), ...cols.map(v)]);
    }
  } else if (e.op === "insert") {
    await c.query(`DELETE FROM ${ident(e.table)} WHERE id = ANY($1::text[])`, [e.ids]);
  } else if (extra && extra[e.op]) {
    await extra[e.op](c, e);
  } else throw new Error(`Cannot undo a ${e.op} entry.`);
}

module.exports = { journal, reverse, rid };
