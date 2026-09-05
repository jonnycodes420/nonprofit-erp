// customFields.js — BUILD-78: the ONE server-side custom-field seam.
//
// Two jobs, both here so they exist exactly once:
//
//  1. validateCustomFields(entity, orgId, values, opts) — EVERY write path
//     calls this: import, manual entry on the donor record, manual entry on
//     the gift record, the API, and anything an agent proposes. A second
//     implementation of validation, anywhere, for any reason, is the defect
//     (spec 1.4). If a call site needs different behaviour, this seam takes
//     a parameter.
//
//  2. migrateLegacyCustomFields() — the one-shot move from the pre-BUILD-78
//     EAV skeleton (custom_fields + custom_field_values, donor-only) into
//     custom_field_defs + the donors.custom_fields JSONB column. Guarded by
//     a schema_flags row at the server-boot call site; idempotent in itself
//     (deterministic def ids, value merge only fills missing keys) so the
//     suite can drive it directly.
//
// The type rules themselves live in shared/customFieldShape.js (ESM,
// shared byte-for-byte with the client mapper); this file only adds what the
// server owns: the defs lookup, the money-seam cents conversion, and the DB
// writes. CJS↔ESM: the shape module is loaded once via dynamic import.

const { query, run } = require("./db.js");
const { toCents } = require("./money.js");

let _shapePromise = null;
function shape() {
  _shapePromise ||= import("./shared/customFieldShape.js");
  return _shapePromise;
}

// Live (non-archived) definitions for one entity. `opts.includeArchived` for
// the settings list; everything else sees live fields only.
async function loadDefs(entity, orgId, opts = {}) {
  const rows = await query(
    `SELECT * FROM custom_field_defs WHERE org_id=? AND entity=?${opts.includeArchived ? "" : " AND archived_at IS NULL"}
     ORDER BY position ASC, created_at ASC`,
    [orgId, entity]
  );
  return rows.map(r => ({ ...r, options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || "[]") }));
}

// validateCustomFields(entity, orgId, values, opts) →
//   { ok, values: {key: storable|null}, errors: [{key, error, raw}] }
// `values` is {key: raw}. A blank raw means "no value": stored as null (the
// caller's JSON merge drops the key). An unknown or archived key is an ERROR
// — nothing falls through to a default, and a value can never land on a field
// the org cannot see. Money coerces through the money seam to integer cents
// (the ONLY place that conversion happens for custom fields).
// opts: { defs (preloaded, for bulk), delimiters: {key: str}, currentYear }
async function validateCustomFields(entity, orgId, values, opts = {}) {
  const { coerceCustomValue } = await shape();
  if (entity !== "donor" && entity !== "gift") return { ok: false, values: {}, errors: [{ key: null, error: `unknown entity '${entity}'` }] };
  const defs = opts.defs || await loadDefs(entity, orgId);
  const byKey = new Map(defs.map(d => [d.key, d]));
  const out = {}, errors = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const def = byKey.get(key);
    if (!def) { errors.push({ key, error: "no such field", raw }); continue; }
    if (def.archived_at) { errors.push({ key, error: "field is archived", raw }); continue; }
    const r = coerceCustomValue(def, raw, {
      delimiter: opts.delimiters ? opts.delimiters[key] : undefined,
      currentYear: opts.currentYear,
    });
    if (!r.ok) { errors.push({ key, error: r.error, raw }); continue; }
    if (r.blank) { out[key] = null; continue; }
    out[key] = def.type === "money" ? toCents(r.value) : r.value;
  }
  return { ok: errors.length === 0, values: out, errors };
}

// Merge validated values into the row's JSONB. null clears a key; everything
// else overwrites. Returns the merged object (for callers that show it back).
function mergeCustomValues(existing, validated) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  for (const [k, v] of Object.entries(validated || {})) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

// ── The legacy migration ───────────────────────────────────────────────────
// Old model: custom_fields (label/field_type/options/field_order/
// show_in_directory/required) + custom_field_values (donor_id, field_id,
// value TEXT). Moves every def (donor entity; deterministic id cfd_<oldid>;
// generated immutable key) and folds every value into donors.custom_fields.
// Old values were untyped TEXT: a value the def's type coerces cleanly is
// stored typed; one it does not is stored AS THE RAW STRING — migration
// preserves, it never refuses and never drops (the import-time refusal rule
// is for new writes, not for data the org already owns). `required` is
// deliberately not carried (see audit/BUILD-78-FINDINGS.md Part 0 §8).
const LEGACY_TYPE_MAP = { text: "text", number: "number", date: "date", dropdown: "select", select: "select", checkbox: "checkbox" };

async function migrateLegacyCustomFields() {
  const { coerceCustomValue, generateFieldKey } = await shape();
  const oldDefs = await query(`SELECT * FROM custom_fields ORDER BY org_id, field_order ASC, created_at ASC`, []);
  const stats = { defs: 0, values: 0, donors: 0, keptRaw: 0 };
  if (!oldDefs.length) return stats;

  const existing = await query(`SELECT org_id, entity, key, id FROM custom_field_defs`, []);
  const keysByOrg = new Map();
  const migratedIds = new Set(existing.map(r => r.id));
  for (const r of existing) {
    if (!keysByOrg.has(r.org_id)) keysByOrg.set(r.org_id, new Set());
    keysByOrg.get(r.org_id).add(r.key);
  }

  const defById = new Map();
  for (const od of oldDefs) {
    const newId = `cfd_${od.id}`;
    if (migratedIds.has(newId)) {
      const row = (await query(`SELECT * FROM custom_field_defs WHERE id=?`, [newId]))[0];
      if (row) defById.set(od.id, { ...row, options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || "[]") });
      continue;
    }
    if (!keysByOrg.has(od.org_id)) keysByOrg.set(od.org_id, new Set());
    const orgKeys = keysByOrg.get(od.org_id);
    const key = generateFieldKey(od.label, [...orgKeys]);
    orgKeys.add(key);
    const type = LEGACY_TYPE_MAP[String(od.field_type || "").toLowerCase()] || "text";
    let options = [];
    try { options = Array.isArray(od.options) ? od.options : JSON.parse(od.options || "[]"); } catch { options = []; }
    await run(
      `INSERT INTO custom_field_defs (id, org_id, entity, key, label, type, options, position, show_in_directory, created_source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`,
      [newId, od.org_id, "donor", key, od.label, type, JSON.stringify(options), od.field_order || 0,
       od.show_in_directory === true, "legacy-migration", od.created_at]
    );
    stats.defs++;
    defById.set(od.id, { id: newId, org_id: od.org_id, entity: "donor", key, label: od.label, type, options });
  }

  const oldVals = await query(
    `SELECT donor_id, field_id, value FROM custom_field_values WHERE value IS NOT NULL AND value != ''`, []);
  const byDonor = new Map();
  for (const v of oldVals) {
    const def = defById.get(v.field_id);
    if (!def) continue;
    const r = coerceCustomValue(def, v.value);
    let stored;
    if (r.ok && !r.blank) stored = def.type === "money" ? toCents(r.value) : r.value;
    else if (r.ok && r.blank) continue;
    else { stored = String(v.value); stats.keptRaw++; }  // preserved verbatim, never dropped
    if (!byDonor.has(v.donor_id)) byDonor.set(v.donor_id, {});
    byDonor.get(v.donor_id)[def.key] = stored;
    stats.values++;
  }
  for (const [donorId, vals] of byDonor) {
    // Fill-missing merge: a key already present in the donor's JSONB (a
    // post-migration write) wins over the legacy value — re-running the
    // migration must never claw a record backwards.
    await run(
      `UPDATE donors SET custom_fields = ?::jsonb || COALESCE(custom_fields, '{}'::jsonb) WHERE id=?`,
      [JSON.stringify(vals), donorId]
    );
    stats.donors++;
  }
  return stats;
}

module.exports = { loadDefs, validateCustomFields, mergeCustomValues, migrateLegacyCustomFields };
