// server/donors/cfSort.js · LIST-4. THE DONORS LIST SORTS BY A CUSTOM FIELD.
//
// A custom field column's header sorts the list by that field's value, the
// way its type reads, with the people who have no value last in both
// directions:
//
//   number, money   by the number (money is held in cents, BUILD-78's seam)
//   date            by the day
//   select          in the field's own option order (a 1-to-5 select reads
//                   1, 2, 3, 4, 5, never alphabetically); a value that is not
//                   one of the options comes after the options, before blanks
//   text            case-insensitively
//   checkbox        Yes first when descending, No first when ascending
//   multi_select    not sortable: it holds more than one choice
//
// The sort key travels as `cf:<key>`. The key is never written into SQL as it
// came in: it is looked up among THIS org's definitions, and only the stored
// key of a definition found there (checked again to be plain letters, digits
// and underscores) reaches the expression. Another org's key, or one that was
// never a field, is refused with a sentence. A field archived since a view was
// saved falls back to the list's own order, the way its column leaves quietly.
//
// No expression index. On a 25,000-person fixture, GET /donors sorted by a
// Number field answered in about 40 ms and by a Select in about 140 ms (the
// option's place is read per row); Lifetime takes about 70 ms. An index on the
// value would not help the Select's lookup (docs/history/LIST-4.md).
//
// The patterns carry no "?": the db layer reads every "?" as an argument.
"use strict";
const { query } = require("../../db");

const SORTABLE = new Set(["text", "long_text", "number", "money", "date", "select", "checkbox"]);
const NOT_SORTABLE_SENTENCE = "A multi-select can hold more than one choice, so the list can't sort by it.";
const SAFE_KEY = /^[A-Za-z0-9_]{1,80}$/;
const isCfSort = key => typeof key === "string" && key.startsWith("cf:");

// The org's definition for a `cf:<key>` sort: { def } | { archived: true } | { error }.
async function lookup(orgId, sortKey) {
  const key = String(sortKey || "").slice(3);
  if (!SAFE_KEY.test(key)) return { error: "Steward can't sort by that field." };
  const [def] = await query(`SELECT key, label, type, options, archived_at FROM custom_field_defs
                              WHERE org_id = ? AND entity = 'donor' AND key = ?`, [orgId, key]);
  if (!def || !SAFE_KEY.test(def.key)) return { error: "That field isn't one of your custom fields, so the list can't sort by it." };
  if (def.archived_at) return { archived: true };
  if (!SORTABLE.has(def.type)) return { error: NOT_SORTABLE_SENTENCE };
  return { def };
}

// The ORDER BY for one definition, over the unaliased `donors` row. No arguments:
// the only text written in is the definition's own checked key.
function orderFor(def, dir) {
  const d = dir === "asc" ? "ASC" : "DESC";
  const k = def.key;
  const val = `(donors.custom_fields ->> '${k}')`;
  const blank = `(NULLIF(trim(COALESCE(${val},'')),'') IS NULL)`;
  switch (def.type) {
    case "number": case "money":
      return `(CASE WHEN trim(${val}) ~ '^-{0,1}\\d+(\\.\\d+){0,1}$' THEN trim(${val})::numeric END) ${d} NULLS LAST, donors.id`;
    case "date":
      return `(CASE WHEN ${val} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(${val},10) END) ${d} NULLS LAST, donors.id`;
    case "checkbox":
      return `(CASE WHEN ${val} = 'true' THEN 1 WHEN ${val} = 'false' THEN 0 END) ${d} NULLS LAST, donors.id`;
    case "select": {
      // The option's place in the field's own list, read from the definition
      // row (the same org, the same key), so no option text is written in.
      const rank = `(SELECT o.n FROM custom_field_defs cfd
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cfd.options) = 'array' THEN cfd.options ELSE '[]'::jsonb END)
            WITH ORDINALITY AS o(e, n)
         WHERE cfd.org_id = donors.org_id AND cfd.entity = 'donor' AND cfd.key = '${k}'
           AND lower(trim(CASE jsonb_typeof(o.e) WHEN 'object' THEN COALESCE(o.e ->> 'value', o.e ->> 'label') ELSE o.e #>> '{}' END))
               = lower(trim(${val}))
         ORDER BY o.n LIMIT 1)`;
      return `${blank} ASC, ${rank} ${d} NULLS LAST, lower(trim(${val})) ${d}, donors.id`;
    }
    default:   // text, long_text
      return `NULLIF(lower(trim(COALESCE(${val},''))),'') ${d} NULLS LAST, donors.id`;
  }
}

// groups.buildDonorFilter's sort for a `cf:` key: { orderBy } | { fallback } | { error }.
async function cfSortSql(orgId, sortKey, dir) {
  const r = await lookup(orgId, sortKey);
  if (r.error) return { error: r.error };
  if (r.archived) return { fallback: true };
  return { orderBy: orderFor(r.def, dir) };
}

module.exports = { isCfSort, cfSortSql, lookup, orderFor, SORTABLE, NOT_SORTABLE_SENTENCE };
