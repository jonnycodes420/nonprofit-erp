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
// ── BUILD-78 Part 2 — the ask gate is not extensible ───────────────────────
// A custom field may NEVER be the source of an ask-gate decision. These
// probes detect exclusion-shaped COLUMNS (by header, and by content for the
// belt-and-braces case) so the mapper can route them to the core flag family
// and refuse to park them in a custom field. Conservative like
// detectNoteMarkers: anchored patterns, normalized for trailing whitespace,
// case, NBSP and smart apostrophes. "Do not include in vendor mailing"
// (BUILD-77's deliberate non-match) stays a non-match — the patterns require
// the do-not phrase to BE the header, not appear inside one.
export const normalizeHeaderText = h => String(h || "")
  .replace(/ /g, " ")            // NBSP
  .replace(/[‘’ʼ]/g, "'") // smart apostrophes
  .replace(/\s+/g, " ")
  .trim().toLowerCase();

const EXCLUSION_HDR_PROBES = [
  [/^(is )?deceased\??$/, "deceased"],
  [/^deceased('s)? date\??$/, "deceasedDate"],
  [/^date (of )?deceased\??$/, "deceasedDate"],
  [/^date of death\??$/, "deceasedDate"],
  [/^(do ?not ?solicit|no solicitation|dns)\??$/, "doNotSolicit"],
  [/^(do ?not ?contact|no (further )?contact|dnc)\??$/, "doNotContact"],
  [/^(do ?not ?mail|no mail(ings?)?)\??$/, "doNotMail"],
  [/^(do ?not ?e ?-?mail|no e ?-?mail)\??$/, "doNotEmail"],
  [/^opt(ed)?[ -]?out\??$/, "doNotSolicit"],
  // the smart-apostrophe family — normalizeHeaderText folds ’ to ' first
  [/^don't solicit\??$/, "doNotSolicit"],
  [/^don't contact\??$/, "doNotContact"],
  [/^don't mail\??$/, "doNotMail"],
  [/^don't e ?-?mail\??$/, "doNotEmail"],
];

// classifyExclusionHeader(header) → 'deceased' | 'deceasedDate' |
// 'doNotSolicit' | 'doNotContact' | 'doNotMail' | 'doNotEmail' | null
// BUILD-80 Part 8 — a Frequency column maps to the RECURRING surface (the
// builder reads it as a cadence claim the gift pattern can override); it is
// never a custom select.
export function isFrequencyHeader(header) {
  return /^(gift\s*)?frequency$/i.test(normalizeHeaderText(header));
}

export function classifyExclusionHeader(header) {
  const h = normalizeHeaderText(header);
  if (!h) return null;
  for (const [re, flag] of EXCLUSION_HDR_PROBES) if (re.test(h)) return flag;
  return null;
}

// detectExclusionColumn(header, values) → null, or
//   { flag, via: 'header'|'content', matchedValues: [...], matchedCount, nonblank }
// The content probe is a backstop for a header the family missed whose VALUES
// literally say the state ("Do not solicit", "DECEASED") — the same phrase
// logic as detectNoteMarkers, applied cell-wise, and only when EVERY
// non-blank cell matches (a mixed column is not an exclusion column).
const EXCLUSION_VALUE_RE = /^(deceased|passed away|do not (solicit|contact|mail|e-?mail)|dns|dnc)$/i;
export function detectExclusionColumn(header, values = []) {
  const nonblank = values.filter(v => String(v ?? "").trim() !== "");
  const flag = classifyExclusionHeader(header);
  if (flag) {
    const matched = nonblank.filter(v => flag === "deceasedDate" || parseBoolValue(v) !== null);
    return { flag, via: "header", matchedCount: matched.length, nonblank: nonblank.length,
             matchedValues: [...new Set(matched.map(v => String(v).trim()))].slice(0, 8) };
  }
  if (nonblank.length >= 3 && nonblank.every(v => EXCLUSION_VALUE_RE.test(String(v).trim()))) {
    const first = String(nonblank[0]).trim().toLowerCase();
    const contentFlag = /deceased|passed/.test(first) ? "deceased"
      : /mail\b|mailing/.test(first) ? "doNotMail"
      : /e-?mail/.test(first) ? "doNotEmail"
      : /contact|dnc/.test(first) ? "doNotContact" : "doNotSolicit";
    return { flag: contentFlag, via: "content", matchedCount: nonblank.length, nonblank: nonblank.length,
             matchedValues: [...new Set(nonblank.map(v => String(v).trim()))].slice(0, 8) };
  }
  // BUILD-80 Part 4.2 — the VALUE-FAMILY tally. A real Solicit Code column is
  // mostly OK/Active with exclusion codes scattered through it; a real Status
  // column is mostly Active with Deceased scattered through it. Two or more
  // exclusion-family cells, with ≥90% of the non-blank cells recognized
  // (exclusion + neutral + informational), makes the column exclusion-shaped
  // — value-routed to the flag family, never storable as a custom field.
  if (nonblank.length >= 2) {
    let excl = 0, neutral = 0, informational = 0;
    const matched = new Set();
    for (const v of nonblank) {
      const p = parseExclusionValue(v);
      if (Object.keys(p.flags).length) { excl++; matched.add(String(v).trim()); }
      else if (p.neutral) neutral++;
      else if (p.status) informational++;
    }
    if (excl >= 2 && (excl + neutral + informational) / nonblank.length >= 0.9) {
      return { flag: "exclusion", via: "values", matchedCount: excl, nonblank: nonblank.length,
               matchedValues: [...matched].slice(0, 8) };
    }
  }
  return null;
}

// BUILD-80 Part 4.2 — a column is exclusion-shaped when its VALUES match the
// family, regardless of header. "Solicit Code" (DNS, DNM, DEC, "Do Not
// Solicit", "D.N.S.", "DNS;DNM", "Newsletter only") and "Status" (Deceased,
// Inactive, Lost) were offered as custom fields and ACCEPTED — fifteen
// deceased donors were invisible to the BUILD-79 run because the test
// asserted on headers when it needed to assert on values.
// parseExclusionValue(raw) reads ONE cell: compounds split on ; , / ; dots
// stripped (D.N.S.); a dash-suffix annotation kept ("DNS - spouse request"
// is DNS). Families: deceased (DEC, DECEASED, d., died, passed) ·
// do-not-solicit (DNS, Do Not Solicit) · no-contact (NC, No Contact, DNC) ·
// do-not-mail (DNM, NO MAIL) · do-not-email (DNE, unsubscribed, no email) ·
// "Newsletter only" (do-not-solicit with mail explicitly LEFT ON — not the
// same as do-not-mail). Inactive/Lost/Moved are INFORMATIONAL: shown as the
// donor's status, never acted on. Anything else in an exclusion column is
// unrecognized — a question for a human, never a guess.
export function parseExclusionValue(raw) {
  const s0 = String(raw ?? "").replace(/\u00A0/g, " ").trim();
  const out = { flags: {}, status: null, neutral: false, newsletterOnly: false, unrecognized: [], blank: !s0 };
  if (!s0) return out;
  if (/^newsletter only$/i.test(s0)) { out.flags.doNotSolicit = true; out.newsletterOnly = true; return out; }
  for (const tok of s0.split(/[;,\/]/).map(t => t.trim()).filter(Boolean)) {
    const tl = tok.replace(/\./g, "").trim().toLowerCase();
    if (/^(ok|active|current|normal|living|ok to contact|solicit ok|yes|y)$/.test(tl)) { out.neutral = true; continue; }
    if (/^(dec|deceased|died|passed( away)?|d)$/.test(tl)) { out.flags.deceased = true; continue; }
    if (/^dns\b/.test(tl) || /^do not solicit\b/.test(tl) || /^no solicitation/.test(tl)) { out.flags.doNotSolicit = true; continue; }
    if (/^(nc|dnc|no contact|do not contact)$/.test(tl)) { out.flags.doNotContact = true; continue; }
    if (/^(dnm|no mail|do not mail)$/.test(tl)) { out.flags.doNotMail = true; continue; }
    if (/^(dne|do not e-?mail|no e-?mail|unsubscribed?)$/.test(tl)) { out.flags.doNotEmail = true; continue; }
    if (/^(inactive|lost|moved)$/.test(tl)) { out.status = tl; continue; }
    out.unrecognized.push(tok);
  }
  return out;
}

// Cell-level boolean read for a FLAG column (wider than the checkbox type's
// strict set on the truthy side — "deceased" in a Deceased? column is a yes —
// but still explicit; null = unrecognized, and an unrecognized flag value is
// surfaced, never guessed).
export function parseBoolValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (CHECKBOX_TRUTHY.includes(s) || ["deceased", "do not contact", "do not solicit", "do not mail", "do not email", "dnc", "dns"].includes(s)) return true;
  if (CHECKBOX_FALSY.includes(s) || ["living", "active", "ok to contact", "ok"].includes(s)) return false;
  return null;
}

// ── BUILD-78 Part 4.1 — proposal, never auto-creation ──────────────────────
// proposeCustomField(header, values, opts) → { label, type, options?,
//   evidence: { nonblank, parsed, failed, distinct, sample } }
// The guess is shown WITH its evidence ("1,987 of 2,483 values parse as a
// date. 496 do not."); the user accepts, changes, routes to core, or
// discards. Nothing is created without an explicit accept.
export function proposeCustomField(header, values = [], opts = {}) {
  const nonblankRaw = values.map(v => String(v ?? "").trim()).filter(Boolean);
  const nonblank = nonblankRaw.slice(0, 3000);
  const label = String(header || "").trim().slice(0, CF_LIMITS.LABEL_MAX) || "Imported field";
  const n = nonblank.length;
  // BUILD-82 Part 4.4 — the evidence SAYS its sample: totalNonblank rides so
  // "3,000 of 3,000 parse" on a 36,050-row column reads "of the first 3,000".
  const ev = extra => ({ nonblank: n, totalNonblank: nonblankRaw.length, sample: nonblank.slice(0, 3), ...extra });
  if (!n) return { label, type: "text", evidence: ev({ parsed: 0, failed: 0 }) };

  // checkbox: virtually every value in the explicit sets
  const boolish = nonblank.filter(v => {
    const l = v.toLowerCase();
    return CHECKBOX_TRUTHY.includes(l) || CHECKBOX_FALSY.includes(l);
  }).length;
  if (boolish / n >= 0.95) return { label, type: "checkbox", evidence: ev({ parsed: boolish, failed: n - boolish }) };

  // date: majority parse through the nine explicit formats
  const dateParsed = nonblank.filter(v => normalizeDate(v, { currentYear: opts.currentYear }).value != null).length;
  if (dateParsed / n >= 0.6) return { label, type: "date", evidence: ev({ parsed: dateParsed, failed: n - dateParsed }) };

  // money vs number: parseable through the money seam's separator handling
  const moneyParsed = nonblank.filter(v => { const m = normalizeMoney(v); return !m.blank && m.value != null; }).length;
  if (moneyParsed / n >= 0.9) {
    const currencyish = nonblank.filter(v => /[$]|^[A-Za-z]{3}\s+\d|\.\d{2}$/.test(v)).length;
    const type = currencyish / n >= 0.5 ? "money" : "number";
    return { label, type, evidence: ev({ parsed: moneyParsed, failed: n - moneyParsed }) };
  }

  // select: genuine low cardinality — never a high-cardinality code column
  // (Appeal Code is the pinned trap: many distinct values must land as text)
  const canon = new Map(); // case-folded → first-seen casing
  for (const v of nonblank) { const k = v.toLowerCase(); if (!canon.has(k)) canon.set(k, v); }
  const distinct = canon.size;
  if (n >= 12 && distinct <= 12 && distinct / n <= 0.34 && [...canon.values()].every(o => o.length <= 40))
    return { label, type: "select", options: [...canon.values()], evidence: ev({ parsed: n, failed: 0, distinct }) };

  // long text: real prose
  if (nonblank.some(v => v.length > 200) || nonblank.reduce((s, v) => s + v.length, 0) / n > 120)
    return { label, type: "long_text", evidence: ev({ parsed: n, failed: 0 }) };

  return { label, type: "text", evidence: ev({ parsed: n, failed: 0, distinct }) };
}

// One sentence of evidence for the proposal card — app copy lives with the
// guess so every consumer says the same thing.
export function proposalEvidenceText(type, evidence) {
  const n = evidence.nonblank || 0;
  const total = evidence.totalNonblank || n;
  // Part 4.4 — a capped scan must say so: "of the first 3,000" on a 36,050-row column.
  const ofN = total > n ? `of the first ${n.toLocaleString()} (of ${total.toLocaleString()})` : `of ${n.toLocaleString()}`;
  const word = { checkbox: "read as yes/no", date: "parse as a date", money: "parse as an amount", number: "parse as a number" }[type];
  if (word) {
    const failed = evidence.failed || 0;
    return `${(evidence.parsed || 0).toLocaleString()} ${ofN} values ${word}.` + (failed ? ` ${failed.toLocaleString()} do not.` : "");
  }
  if (type === "select") return `${n.toLocaleString()} values, only ${evidence.distinct} distinct — looks like a fixed set of choices.`;
  if (type === "long_text") return `Long free-text values — stored up to ${CF_LIMITS.LONG_TEXT_MAX.toLocaleString()} characters.`;
  return `Free text.` + (evidence.distinct ? ` ${evidence.distinct.toLocaleString()} distinct values across ${n.toLocaleString()}.` : "");
}

// ── BUILD-78 Part 3 — the column axis of the invariant ─────────────────────
// countPhysicalColumns(rawText, parsedRows) — the LEFT side of the column
// equation, taken ONCE at parse entry from the physical header line (via the
// same CSV grammar the row parser uses), plus any orphan cell positions body
// rows carry beyond the header width (a malformed row's overflow cells are
// columns the file physically has). NEVER derived from the mapping.
export function parseCsvHeaderLine(text) {
  const cells = []; let cell = "", q = false, i = 0;
  const t = String(text || "");
  for (; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { cells.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") break;
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

export function countPhysicalColumns(rawText, parsedRows = []) {
  const headerCells = parseCsvHeaderLine(rawText);
  // Papa parks cells beyond the header width in __parsed_extra.
  let maxOverflow = 0, overflowRows = 0;
  for (const r of parsedRows) {
    const extra = r && r.__parsed_extra ? r.__parsed_extra.length : 0;
    if (extra > 0) { overflowRows++; if (extra > maxOverflow) maxOverflow = extra; }
  }
  return { headerCells, headerCount: headerCells.length, orphanColumns: maxOverflow, overflowRows,
           total: headerCells.length + maxOverflow };
}

// The closed disposition set (3.2). Exactly one per column; the ledger is a
// separate structure from the header parse, so the two sides can disagree —
// which is the entire point of having both.
export const COLUMN_DISPOSITIONS = ["core", "custom-existing", "custom-new", "flag", "discarded", "refused"];

// summarizeColumnLedger(total, ledger) → the 3.3 line, LEFT side from the
// physical parse, RIGHT side summed independently from the ledger.
export function summarizeColumnLedger(total, ledger = []) {
  const counts = { core: 0, "custom-existing": 0, "custom-new": 0, flag: 0, discarded: 0, refused: 0, invalid: 0 };
  for (const e of ledger) {
    if (e && COLUMN_DISPOSITIONS.includes(e.disposition)) counts[e.disposition]++;
    else counts.invalid++;
  }
  const accounted = ledger.length;
  return { inFile: total, accounted, counts,
           balanced: accounted === total && counts.invalid === 0 };
}
// ── BUILD-78 Parts 2+3+4 — the mapper plan ─────────────────────────────────
// buildMapperPlan({...}) → one entry per PHYSICAL column with a starting
// status the user can override — the pure, Node-testable core of the mapping
// screen. The golden suite drives THIS, not the React component.
//
// Statuses (map 1:1 onto the 3.2 dispositions at import time):
//   core            — claimed by the role mapping (txMap)
//   flag            — exclusion-shaped (Part 2): routed to the ask-gate flag
//                     family; CANNOT be parked in a custom field
//   custom-existing — resolves to a field that already exists (saved mapping
//                     by field id first — a renamed label still resolves —
//                     then a current-label match)
//   custom-proposed — a guessed NEW field awaiting the user's explicit
//                     accept; never created without one (4.1)
//   unmapped        — nothing claimed it; the user stores it as custom,
//                     maps it to core, or discards it with an acknowledgement
//   refused         — physically unmappable, with a reason (blank header,
//                     orphan overflow cells)
export function buildMapperPlan({ headers = [], fields = [], rows = [], txMap = {}, existingDefs = { donor: [], gift: [] }, savedMappings = [], orphanColumns = 0, overflowRows = 0, currentYear } = {}) {
  const roleByField = {};
  Object.entries(txMap).forEach(([role, h]) => { if (h && roleByField[h] === undefined) roleByField[h] = role; });
  const savedByHeader = new Map(savedMappings.map(m => [`${m.entity}|${normalizeHeaderText(m.header)}`, m.fieldId]));
  const defsById = new Map([...existingDefs.donor, ...existingDefs.gift].map(d => [d.id, d]));
  const defByLabel = ent => new Map((existingDefs[ent] || []).map(d => [normalizeHeaderText(d.label), d]));
  const labelMaps = { donor: defByLabel("donor"), gift: defByLabel("gift") };

  // donor identity per row (email-else-name, the grouping key the builder
  // uses) — powers the donor-vs-gift entity guess: a column constant within
  // each donor is donor-shaped; one that varies inside a donor is gift-shaped.
  const keyOf = r => {
    const email = txMap.donorEmail ? String(r[txMap.donorEmail] || "").trim().toLowerCase() : "";
    if (email.includes("@")) return email;
    return txMap.donorName ? String(r[txMap.donorName] || "").trim().toLowerCase() : "";
  };

  // A stray header row echoed into the body (page-break export artifact)
  // must not pollute the evidence scan — it would add a literal "Gift Level"
  // to a select's options. Same probe the accounted builder uses.
  const scanRows = txMap.donorName
    ? rows.filter(r => String(r[txMap.donorName] ?? "").trim() !== txMap.donorName)
    : rows;
  const columns = [];
  headers.forEach((rawHeader, index) => {
    const field = fields[index] !== undefined ? fields[index] : rawHeader; // Papa's (possibly deduped) accessor
    const headerTrim = String(rawHeader).trim();
    const values = scanRows.map(r => r[field]);
    const base = { index, header: rawHeader, field, values: undefined };

    if (!headerTrim) {
      const nonblank = values.filter(v => String(v ?? "").trim() !== "").length;
      columns.push({ ...base, status: "refused", reason: "no header", nonblank });
      return;
    }
    if (roleByField[field] !== undefined) {
      columns.push({ ...base, status: "core", role: roleByField[field] });
      return;
    }
    // BUILD-80 Part 8 — Frequency → the recurring surface, never a custom
    // select. The builder consumes it as a cadence claim.
    if (isFrequencyHeader(base.field)) {
      columns.push({ ...base, status: "flag", flag: "frequency", via: "header",
        matchedValues: [], evidenceText: "maps to the recurring surface — a cadence claim the gift pattern can override" });
      return;
    }
    // Part 2 — the trap. Detected exclusion shape routes to the flag family
    // and is NOT offered as a custom destination, full stop.
    const excl = detectExclusionColumn(rawHeader, values);
    if (excl) {
      columns.push({ ...base, status: "flag", flag: excl.flag, via: excl.via,
                     matchedValues: excl.matchedValues, matchedCount: excl.matchedCount, nonblankCount: excl.nonblank });
      return;
    }
    // custom resolution: saved mapping by FIELD ID outranks everything —
    // rename every label and the mapping still resolves (4.4)
    const proposal = proposeCustomField(rawHeader, values, { currentYear });
    for (const entity of ["donor", "gift"]) {
      const savedId = savedByHeader.get(`${entity}|${normalizeHeaderText(rawHeader)}`);
      const def = savedId && defsById.get(savedId);
      if (def && !def.archivedAt && !def.archived_at) {
        columns.push({ ...base, status: "custom-existing", entity, def, via: "saved-mapping", proposal });
        return;
      }
    }
    for (const entity of ["donor", "gift"]) {
      const def = labelMaps[entity].get(normalizeHeaderText(rawHeader));
      if (def && !def.archivedAt && !def.archived_at) {
        columns.push({ ...base, status: "custom-existing", entity, def, via: "label-match", proposal });
        return;
      }
    }
    // entity guess for the proposal: constant-within-donor → donor field
    let entity = "donor";
    if (txMap.donorEmail || txMap.donorName) {
      const perDonor = new Map();
      let varies = false, donorsWithValue = 0;
      for (const r of scanRows) {
        const k = keyOf(r); if (!k) continue;
        const v = String(r[field] ?? "").trim(); if (!v) continue;
        if (!perDonor.has(k)) { perDonor.set(k, v); donorsWithValue++; }
        else if (perDonor.get(k) !== v) { varies = true; break; }
      }
      if (varies) entity = "gift";
      void donorsWithValue;
    }
    columns.push({ ...base, status: "custom-proposed", entity, proposal });
  });

  // Orphan overflow cells are physical columns with no header and no mapping
  // surface at all — refused, with the reason and the row count.
  for (let i = 0; i < orphanColumns; i++) {
    columns.push({ index: headers.length + i, header: "", field: null,
                   status: "refused", reason: `overflow cells beyond the header row (${overflowRows} row${overflowRows === 1 ? "" : "s"})` });
  }
  return { columns };
}

// buildColumnLedger(plan, decisions) — fold the user's decisions over the
// plan into the final disposition ledger (3.2): exactly one disposition per
// physical column, a SEPARATE structure from the physical count.
// decisions: { [index]: { action: 'accept'|'existing'|'core'|'discard'|'flag',
//                         entity?, type?, label?, options?, delimiter?, fieldId?, role? } }
export function buildColumnLedger(plan, decisions = {}) {
  return plan.columns.map(c => {
    const d = decisions[c.index] || {};
    const entry = { index: c.index, header: c.header };
    const action = d.action
      || (c.status === "core" ? "core"
        : c.status === "flag" ? "flag"
        : c.status === "custom-existing" ? "existing"
        : c.status === "refused" ? "refused"
        : "unmapped");
    switch (action) {
      case "core": return { ...entry, disposition: "core", role: c.role || d.role };
      case "flag": return { ...entry, disposition: "flag", flag: c.flag || d.flag };
      case "existing": return { ...entry, disposition: "custom-existing", entity: d.entity || c.entity, fieldId: d.fieldId || (c.def && c.def.id) };
      case "accept": return { ...entry, disposition: "custom-new", entity: d.entity || c.entity,
                              type: d.type || c.proposal.type, label: d.label || c.proposal.label,
                              options: d.options || c.proposal.options, delimiter: d.delimiter };
      case "discard": return { ...entry, disposition: "discarded" };
      case "refused": return { ...entry, disposition: "refused", reason: c.reason };
      default: return { ...entry, disposition: null }; // unmapped and undecided — the ledger does not balance
    }
  });
}
