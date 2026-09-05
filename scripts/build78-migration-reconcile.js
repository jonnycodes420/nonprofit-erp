// BUILD-78 — INDEPENDENT MIGRATION RECONCILIATION (read-only).
//
// The honest answer to "was the EAV→JSONB migration really zero-loss?" — the
// one the migration's own stats.values CANNOT give, because that counter is
// incremented inside the write loop (left side derived from the right side,
// the "Balanced" defect this whole build exists to distrust).
//
// This reads the SURVIVING legacy tables (the migration never drops them) and
// the donors.custom_fields JSONB, and reconciles from BOTH ends independently:
//   • every legacy DEF must have its deterministic cfd_<id> counterpart
//   • every legacy non-blank VALUE must, after coercing per the def's declared
//     type, be PRESENT under its key in that donor's JSONB — UNLESS coercion
//     legitimately reads it as blank (those keys are absent by design)
//   • a MISSING key is unambiguous LOSS (red); a DIFFERING value is reported
//     as a warning only (it may be a legitimate post-migration edit — without
//     a timestamp we cannot call it loss, and we do not pretend to)
//   • RAW-kept values (didn't coerce cleanly) are counted and LISTED — the
//     "kept raw where not" population, so an operator can see exactly which
//     values never typed instead of trusting they sit fine
//
// Read-only: no INSERT/UPDATE/DELETE. Safe to run against prod
//   DATABASE_URL=<prod> node scripts/build78-migration-reconcile.js
// Exits non-zero if any real loss is found.
const { query } = require("../db.js");

(async () => {
  const shape = await import("../shared/customFieldShape.js");
  const { coerceCustomValue } = shape;
  const { toCents } = require("../money.js");

  const legacyDefs = await query(`SELECT * FROM custom_fields`, []);
  const newDefs = await query(`SELECT id, org_id, key, type, options FROM custom_field_defs`, []);
  const newById = new Map(newDefs.map(d => [d.id, { ...d, options: Array.isArray(d.options) ? d.options : JSON.parse(d.options || "[]") }]));

  let defLoss = 0, valueLoss = 0, valueDiff = 0, keptRaw = 0, checked = 0, blankByDesign = 0;
  const lossRows = [], diffRows = [], rawRows = [], orphanDefs = [];

  // ── defs: every legacy def must have its cfd_<id> counterpart ──
  const defKey = new Map(); // legacy field_id → { key, type, options }
  for (const od of legacyDefs) {
    const nd = newById.get(`cfd_${od.id}`);
    if (!nd) { defLoss++; orphanDefs.push({ org: od.org_id, id: od.id, label: od.label }); continue; }
    defKey.set(od.id, nd);
  }

  // ── values: reconcile from the legacy side ──
  const legacyVals = await query(
    `SELECT donor_id, field_id, value FROM custom_field_values WHERE value IS NOT NULL AND value <> ''`, []);
  // one JSONB read per donor that has a legacy value
  const donorIds = [...new Set(legacyVals.map(v => v.donor_id))];
  const jsonbByDonor = new Map();
  const CHUNK = 500;
  for (let i = 0; i < donorIds.length; i += CHUNK) {
    const slice = donorIds.slice(i, i + CHUNK);
    const rows = await query(`SELECT id, custom_fields FROM donors WHERE id = ANY(?)`, [slice]);
    for (const r of rows) jsonbByDonor.set(r.id, r.custom_fields || {});
  }

  for (const v of legacyVals) {
    const def = defKey.get(v.field_id);
    if (!def) { defLoss++; continue; }            // value points at a def that never migrated
    const r = coerceCustomValue(def, v.value);
    if (r.ok && r.blank) { blankByDesign++; continue; } // legitimately no key
    checked++;
    const jsonb = jsonbByDonor.get(v.donor_id);
    const present = jsonb && Object.prototype.hasOwnProperty.call(jsonb, def.key);
    if (!present) { valueLoss++; lossRows.push({ donor: v.donor_id, key: def.key, value: v.value }); continue; }
    const got = jsonb[def.key];
    if (r.ok) {
      const expected = def.type === "money" ? toCents(r.value) : r.value;
      if (JSON.stringify(got) !== JSON.stringify(expected)) { valueDiff++; diffRows.push({ donor: v.donor_id, key: def.key, expected, got }); }
    } else {
      keptRaw++;
      if (JSON.stringify(got) !== JSON.stringify(String(v.value))) { valueDiff++; diffRows.push({ donor: v.donor_id, key: def.key, expectedRaw: String(v.value), got }); }
      else rawRows.push({ donor: v.donor_id, key: def.key, value: String(v.value) });
    }
  }

  console.log("── BUILD-78 migration reconciliation (read-only, independent) ──");
  console.log(`legacy defs:                 ${legacyDefs.length}`);
  console.log(`legacy non-blank values:     ${legacyVals.length}`);
  console.log(`  blank after coercion:      ${blankByDesign}  (keys absent BY DESIGN)`);
  console.log(`  reconciled (must be present):${checked}`);
  console.log(`  kept RAW (didn't type):    ${keptRaw}`);
  console.log("");
  console.log(`DEF LOSS (legacy def with no cfd_ counterpart):   ${defLoss}`);
  console.log(`VALUE LOSS (key missing from donor JSONB):        ${valueLoss}`);
  console.log(`value differs (edit OR loss — cannot tell):       ${valueDiff}`);
  if (orphanDefs.length) console.log("orphan defs:", JSON.stringify(orphanDefs.slice(0, 10)));
  if (lossRows.length)   console.log("LOSS rows:", JSON.stringify(lossRows.slice(0, 20)));
  if (diffRows.length)   console.log("diff rows (sample):", JSON.stringify(diffRows.slice(0, 10)));
  if (rawRows.length)    console.log("kept-raw rows (sample):", JSON.stringify(rawRows.slice(0, 10)));

  const hardLoss = defLoss + valueLoss;
  console.log("");
  console.log(hardLoss === 0
    ? "✓ NO LOSS: every legacy def and every non-blank value is accounted for in the JSONB."
    : `✗ LOSS DETECTED: ${hardLoss} — investigate before trusting the migration.`);
  process.exit(hardLoss === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
