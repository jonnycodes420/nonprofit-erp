// server/donors/mergeMoves.js · SPEED-2. THE MERGE MOVES EVERY POINTER IN A FEW STATEMENTS.
//
// The merge (routes/dataHealth.js mergeInTx) used to walk MERGE_REFS one table
// at a time: ask whether the table has an id column, read the merged person's
// rows, then a savepoint, an UPDATE and a release. About 250 statements for a
// typical pair, each paying prod's round trip to the database: Muse's walk sat
// on "Merging" for 10 s or more (6 Nov). Now:
//   1. every table's shape (id column, the unique keys a move could break) is
//      read once per process
//   2. the merged person's rows in EVERY pointer column come back in one
//      statement (UNION ALL), and are kept on the merge record exactly as before
//   3. every column whose move cannot break a unique key moves in one statement
//      (one data-modifying CTE per table; a table with two pointer columns
//      takes a second statement, since one statement may not change a row twice)
//   4. a column a unique key covers moves in one UPDATE under a savepoint, and
//      only if that key objects is it done row by row, setting the merged
//      person's twin aside (or refusing, for the "refuse" tables). That is the
//      rare case (both people hold the same keyed row), and it is unchanged.
// What moved and what was set aside are recorded in the same shape as before,
// so undo is untouched. tests/lib/mergeSpeedLeg.js holds the statement count.
"use strict";
const { queryTx, runTx } = require("../../db");

let shapeCache = null;   // the schema is built at boot; a table's shape does not change under a running process
async function tableShapes(client, tables) {
  if (shapeCache) return shapeCache;
  const ids = await queryTx(client, `SELECT table_name::text AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND table_name = ANY(?)`, [tables]);
  // Every unique index or exclusion constraint on these tables: its columns and
  // its expressions, so a pointer inside lower(...) or COALESCE(...) counts too.
  const keys = await queryTx(client, `
    SELECT c.relname::text AS t,
           ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY(i.indkey) AND a.attnum > 0) AS cols,
           COALESCE(pg_get_expr(i.indexprs, i.indrelid), '') AS expr
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND (i.indisunique OR i.indisexclusion) AND c.relname = ANY(?)`, [tables]);
  shapeCache = { withId: new Set(ids.map(r => r.t)), keys };
  return shapeCache;
}
function keyCovers(shapes, t, c) {
  const word = new RegExp(`\\b${c}\\b`);
  return shapes.keys.some(k => k.t === t && (k.cols.includes(c) || word.test(k.expr)));
}

// The rows behind every pointer column, for one person, in one statement.
// refMatch(t, c).sql has one "?" for the person id.
async function readRefs(client, orgId, personId, refs, refMatch) {
  const parts = refs.map(([t, c], k) => `SELECT ${k} AS k, to_jsonb(x.*) AS j FROM ${t} x WHERE x.org_id = $1 AND ${refMatch(t, c).sql.replace("?", "$2")}`);
  const r = await client.query(parts.join("\nUNION ALL\n"), [orgId, personId]);
  const byRef = new Map();
  for (const row of r.rows) (byRef.get(row.k) || byRef.set(row.k, []).get(row.k)).push(row.j);
  return byRef;
}

// How many rows a merge would move, per "table.column", for one person: one statement.
async function countRefs(query, orgId, personId, refs, refMatch) {
  const parts = refs.map(([t, c], k) => `SELECT ${k} AS k, COUNT(*)::int AS n FROM ${t} WHERE org_id = ? AND ${refMatch(t, c).sql}`);
  const rows = await query(parts.join("\nUNION ALL\n"), refs.flatMap(() => [orgId, personId]));
  const out = {};
  for (const r of rows) if (r.n) out[`${refs[r.k][0]}.${refs[r.k][1]}`] = r.n;
  return out;
}

const setSql = (t, c, ref) => ref.array
  ? `UPDATE ${t} SET ${c} = CASE WHEN $1 = ANY(${c}) THEN array_remove(${c}, $3) ELSE array_replace(${c}, $3, $1) END WHERE org_id = $2 AND ${ref.sql.replace("?", "$3")}`
  : `UPDATE ${t} SET ${c} = $1 WHERE org_id = $2 AND ${ref.sql.replace("?", "$3")}`;

// Move every pointer from mergedId to keptId. Returns { moved, setAside } in
// MERGE_REFS order, the shape the merge record and undo read.
async function moveRefs(client, { orgId, keptId, mergedId, refs, refMatch, keyCols, refuse }) {
  const shapes = await tableShapes(client, [...new Set(refs.map(r => r[0]))]);
  const found = await readRefs(client, orgId, mergedId, refs, refMatch);
  const slots = new Array(refs.length).fill(null), setAside = [];
  const keysOf = (t, rows) => rows.map(j => Object.fromEntries((keyCols[t] || []).map(k => [k, j[k]])));
  const record = (k, rows) => {
    const [t, c] = refs[k], ref = refMatch(t, c), withId = shapes.withId.has(t);
    slots[k] = ref.array ? { table: t, column: c, ids: rows.map(j => j.id), arrays: rows.map(j => ({ id: j.id, before: j[c] })) }
      : { table: t, column: c, ids: withId ? rows.map(j => j.id) : null, keys: withId ? null : keysOf(t, rows) };
  };

  // Free columns: no unique key covers them, so nothing can object. One
  // statement per wave; a wave changes each table at most once.
  const free = [], keyed = [];
  refs.forEach(([t, c], k) => { if (found.has(k)) (keyCovers(shapes, t, c) ? keyed : free).push(k); });
  const waves = [];
  for (const k of free) {
    const t = refs[k][0];
    let w = waves.find(w => !w.some(x => refs[x][0] === t));
    if (!w) waves.push(w = []);
    w.push(k);
  }
  for (const w of waves) {
    const sql = `WITH ${w.map((k, i) => `m${i} AS (${setSql(refs[k][0], refs[k][1], refMatch(refs[k][0], refs[k][1]))} RETURNING 1)`).join(",\n")} SELECT 1`;
    await client.query("SAVEPOINT dh_wave");
    try {
      await client.query(sql, [keptId, orgId, mergedId]);
      await client.query("RELEASE SAVEPOINT dh_wave");
      for (const k of w) record(k, found.get(k));
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT dh_wave");
      if (e.code !== "23505") throw e;
      keyed.push(...w);   // a key the shapes did not show: the careful path
    }
  }

  // Keyed columns: one UPDATE under a savepoint; row by row only if a key objects.
  for (const k of keyed.sort((a, b) => a - b)) {
    const [t, c, mode] = refs[k], ref = refMatch(t, c), rows = found.get(k), withId = shapes.withId.has(t);
    await client.query("SAVEPOINT dh_bulk");
    try {
      await client.query(setSql(t, c, ref), [keptId, orgId, mergedId]);
      await client.query("RELEASE SAVEPOINT dh_bulk");
      record(k, rows);
      continue;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT dh_bulk");
      if (e.code !== "23505") throw e;
    }
    const kc = keyCols[t] || [];
    const match = j => withId ? { sql: "id=?", vals: [j.id] }
      : { sql: ["org_id=?", ...kc.map(x => `${x}=?`)].join(" AND "), vals: [orgId, ...kc.map(x => j[x])] };
    const ids = [], keys = [];
    for (const j of rows) {
      const m = match(j);
      await client.query("SAVEPOINT dh_row");
      try {
        await runTx(client, `UPDATE ${t} SET ${c}=? WHERE ${m.sql} AND ${c}=?`, [keptId, ...m.vals, mergedId]);
        await client.query("RELEASE SAVEPOINT dh_row");
        if (withId) ids.push(j.id); else keys.push(Object.fromEntries(kc.map(x => [x, j[x]])));
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT dh_row");
        if (e.code !== "23505") throw e;
        if (mode === "refuse") throw refuse(t);
        await runTx(client, `DELETE FROM ${t} WHERE ${m.sql} AND ${c}=?`, [...m.vals, mergedId]);
        setAside.push({ table: t, column: c, why: "the kept person already has this one", row: j });
      }
    }
    slots[k] = { table: t, column: c, ids: withId ? ids : null, keys: withId ? null : keys };
  }
  return { moved: slots.filter(Boolean), setAside };
}

module.exports = { moveRefs, countRefs, readRefs, tableShapes };
