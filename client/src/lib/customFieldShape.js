// BUILD-78 Part 1 — custom-field shape: the ONE implementation of the type
// rules. Pure, JSX/React-free (like importShape.js) so three consumers share
// it byte-for-byte: the client mapper (preview + evidence counts), the server
// validation seam (server.js dynamic-imports this at boot — Part 1.4: a
// second implementation of validation, anywhere, for any reason, is the
// defect), and the Node suites (tests/custom-fields.test.js).
//
// The closed type set (spec 1.3). Eight types, no formula, no lookup, no
// file, no relation. Every type has an explicit import coercion and an
// explicit export rendering; NOTHING falls through to a default — a failed
// parse is an error carried back to the caller with the raw value, never a
// silent false/today/empty-string. That is the BUILD-77 Part 2 rule applied
// to a wider surface.

import { normalizeDate, normalizeMoney } from "./importShape.js";

export const CF_TYPES = ["text", "long_text", "number", "money", "date", "select", "multi_select", "checkbox"];

export const CF_LIMITS = {
  FIELDS_PER_ENTITY: 40,   // an org with 90 custom fields has a schema nobody maintains
  OPTIONS_PER_SELECT: 100, // past that it is free text wearing a costume
  LONG_TEXT_MAX: 2000,     // notes belong in notes
  LABEL_MAX: 80,
};

// Checkbox: the explicit sets, declared in code (spec 1.3). Anything outside
// BOTH sets is an ERROR, not false — "maybe" in a Board Member column is a
// question for a human, not a no.
export const CHECKBOX_TRUTHY = ["y", "yes", "true", "t", "1", "x", "checked"];
export const CHECKBOX_FALSY  = ["n", "no", "false", "f", "0", "unchecked"];

// The multi-select delimiter is declared at mapping time (spec 1.3); this is
// only the default offered, and the join used on export.
export const MULTI_SELECT_DELIMITER = "; ";

// ── The key: generated once at creation, immutable forever ─────────────────
// NEVER derived from the label at read time — rename the label to anything,
// in any encoding, and every stored value and saved mapping still resolves.
export function generateFieldKey(label, existingKeys = []) {
  const taken = new Set(existingKeys);
  let base = String(label || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")   // é → e
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base || /^\d/.test(base)) base = ("f_" + base).slice(0, 40);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const k = `${base.slice(0, 36)}_${n}`;
    if (!taken.has(k)) return k;
  }
}

// Case-fold + trim for option matching (single AND multi select): "gold" and
// "Gold " both resolve to the stored option "Gold"; no match is an error the
// UI answers by offering to add the option — never by storing free text.
function matchOption(raw, options) {
  const want = String(raw).trim().toLowerCase();
  return options.find(o => String(o).trim().toLowerCase() === want);
}

// ── coerceCustomValue(def, raw, opts) — the import/write coercion (1.3) ────
// Returns exactly one of:
//   { ok: true, blank: true }        — no value (empty cell); nothing stored
//   { ok: true, value }              — the storable value
//   { ok: false, error }             — a named refusal; the row is refused,
//                                      never coerced, blanked, or defaulted
// Storable representations: text/long_text → trimmed string; number → Number;
// money → DOLLARS number with cents preserved (the server seam converts to
// integer cents via money.js toCents — the one place that conversion lives);
// date → ISO civil date string; select → the canonical option string;
// multi_select → array of canonical option strings; checkbox → boolean.
export function coerceCustomValue(def, raw, opts = {}) {
  const type = def.type;
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return { ok: true, blank: true };

  switch (type) {
    case "text":
      return { ok: true, value: s };
    case "long_text":
      if (s.length > CF_LIMITS.LONG_TEXT_MAX)
        return { ok: false, error: `over the ${CF_LIMITS.LONG_TEXT_MAX}-character limit (${s.length})` }; // an error, not a truncation
      return { ok: true, value: s };
    case "number": {
      const m = normalizeMoney(s); // the BUILD-73 separator handling; "n/a"-family reads as blank
      if (m.blank) return { ok: true, blank: true };
      if (m.value == null) return { ok: false, error: `not a number: '${s}'` };
      return { ok: true, value: m.value };
    }
    case "money": {
      const m = normalizeMoney(s);
      if (m.blank) return { ok: true, blank: true };
      if (m.value == null) return { ok: false, error: `not an amount: '${s}'` };
      return { ok: true, value: m.value };
    }
    case "date": {
      const d = normalizeDate(s, { currentYear: opts.currentYear });
      if (d.value == null) return { ok: false, error: `not a date: '${s}'` }; // nine formats, calendar-validated, no fallback, no || today
      return { ok: true, value: d.value };
    }
    case "select": {
      const hit = matchOption(s, def.options || []);
      if (hit == null) return { ok: false, error: `'${s}' is not one of this field's options`, unknownOption: s };
      return { ok: true, value: hit };
    }
    case "multi_select": {
      const delim = opts.delimiter || def.delimiter || MULTI_SELECT_DELIMITER;
      const parts = s.split(delim.trim() === "" ? delim : new RegExp(escapeRe(delim.trim()) + "\\s*")).map(p => p.trim()).filter(Boolean);
      const out = [];
      for (const p of parts) {
        const hit = matchOption(p, def.options || []);
        if (hit == null) return { ok: false, error: `'${p}' is not one of this field's options`, unknownOption: p };
        if (!out.includes(hit)) out.push(hit);
      }
      if (!out.length) return { ok: true, blank: true };
      return { ok: true, value: out };
    }
    case "checkbox": {
      const l = s.toLowerCase();
      if (CHECKBOX_TRUTHY.includes(l)) return { ok: true, value: true };
      if (CHECKBOX_FALSY.includes(l)) return { ok: true, value: false };
      return { ok: false, error: `'${s}' is neither yes nor no` }; // an error, not false
    }
    default:
      return { ok: false, error: `unknown field type '${type}'` };
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ── renderCustomValue(def, stored) — the export rendering (1.3) ────────────
// The stored value comes back out in the one declared shape per type; an
// export→reimport round trip through coerceCustomValue is a no-op. Money is
// stored as integer CENTS (the server seam's doing) and renders 2dp with no
// symbol; a legacy/migrated value that predates the seam may be a plain
// string and renders as stored rather than lying about its type.
export function renderCustomValue(def, stored) {
  if (stored === null || stored === undefined || stored === "") return "";
  switch (def.type) {
    case "money":
      if (typeof stored === "number" && Number.isInteger(stored)) return (stored / 100).toFixed(2);
      return String(stored); // migrated pre-seam value, rendered as stored
    case "number":
      return String(stored); // plain, no thousands separator
    case "checkbox":
      return stored === true ? "true" : stored === false ? "false" : String(stored);
    case "multi_select":
      return Array.isArray(stored) ? stored.join(MULTI_SELECT_DELIMITER) : String(stored);
    default:
      return String(stored); // text / long_text / date (ISO) / select label
  }
}
