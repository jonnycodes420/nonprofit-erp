// TIDY-1 · THE RHYTHM WRITE SKIPS ITSELF WHEN THE GIFTS MOVED UNDER IT.
//
// afterChange.js reads a person's gifts, computes their rhythm, and writes it.
// Two calls for one person can overlap (MONEY-3's named window): the first
// reads, a second gift lands and the second call reads and writes, then the
// first writes its older answer over the newer one. The write now carries a
// print of the gifts it read and lands only while the gifts still print the
// same, in the same statement. A skipped person is not lost: whoever changed
// the gifts also called the after-change step, and that call reads fresh.
//
// The print is every gift row of the person, whole (`g::text`), so an added,
// removed or edited row (amount, date, credit type, anything) changes it.
"use strict";

// SQL: the print of person `donorExpr`'s gift rows in org `orgExpr`.
const PRINT_OF = (orgExpr, donorExpr) =>
  `(SELECT md5(COALESCE(string_agg(g::text, ',' ORDER BY g.id), '')) FROM gifts g
     WHERE g.org_id = ${orgExpr} AND g.donor_id = ${donorExpr})`;

// The print of each person's gifts, as read now: Map donorId -> md5.
async function readPrints(query, orgId, ids) {
  if (!ids.length) return new Map();
  const rows = await query(
    `SELECT d.id AS donor_id, ${PRINT_OF("?", "d.id")} AS print
       FROM unnest(?::text[]) AS d(id)`, [orgId, ids]);
  return new Map(rows.map(r => [r.donor_id, r.print]));
}

// The guarded upsert: `tuples` rows of 14 values, the 13 donor_rhythm columns
// then the print. A row whose print no longer matches is not written.
// Resolves the donor ids written.
const COLS = `org_id, donor_id, rhythm, cadence_days, expected_next, drift_state,
         giving_this_year, giving_last_year, largest_gift, last_door, computed_for, created_by, created_by_name`;
const TUPLE = "(?::text,?::text,?::text,?::int,?::text,?::text,?::numeric,?::numeric,?::numeric,?::text,?::text,?::text,?::text,?::text)";
async function writeGuarded(query, vals, count) {
  const written = [];
  for (let i = 0; i < count; i += 2000) {
    const n = Math.min(2000, count - i);
    const rows = await query(
      `INSERT INTO donor_rhythm (${COLS})
       SELECT ${COLS.split(",").map(c => "v." + c.trim()).join(", ")}
         FROM (VALUES ${Array(n).fill(TUPLE).join(",")}) AS v(${COLS}, print)
        WHERE v.print = ${PRINT_OF("v.org_id", "v.donor_id")}
       ON CONFLICT (org_id, donor_id) DO UPDATE SET
         rhythm = EXCLUDED.rhythm, cadence_days = EXCLUDED.cadence_days, expected_next = EXCLUDED.expected_next,
         state_changed_at = CASE WHEN donor_rhythm.drift_state IS DISTINCT FROM EXCLUDED.drift_state
                                 THEN NOW() ELSE donor_rhythm.state_changed_at END,
         drift_state = EXCLUDED.drift_state,
         giving_this_year = EXCLUDED.giving_this_year, giving_last_year = EXCLUDED.giving_last_year,
         largest_gift = EXCLUDED.largest_gift, last_door = EXCLUDED.last_door,
         computed_for = EXCLUDED.computed_for, computed_at = NOW()
       RETURNING donor_id`,
      vals.slice(i * 14, (i + n) * 14));
    for (const r of rows || []) written.push(r.donor_id);
  }
  return written;
}

module.exports = { PRINT_OF, readPrints, writeGuarded };
