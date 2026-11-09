// shared/dupeNames.js · POLISH-8 (W-1109-Fundraising-16X). TWO OF ONE NAME.
//
// "General appeal" was listed twice as a draft, twice as a template and twice
// in the Reports filter, with nothing to tell them apart. A list that holds two
// or more rows with the same name (case and spacing ignored) shows each one's
// disambiguator: when it was made and its status, e.g. "made Nov 3, 2026 · draft".
// A name used once shows nothing extra. Pure: the screens and the tests read it.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_WORD = { draft: "draft", awaiting_approval: "waiting for approval", scheduled: "scheduled", sending: "sending", sent: "sent", failed: "failed", archived: "archived", active: "active" };

export const nameKey = n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().toLowerCase();

function madeOn(v) {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === "string" ? v : new Date(v).toISOString());
  return m ? `made ${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "";
}

// The set of name keys used more than once in `rows`.
export function dupeKeys(rows, nameOf = r => r.name) {
  const seen = new Map();
  for (const r of rows || []) { const k = nameKey(nameOf(r)); if (k) seen.set(k, (seen.get(k) || 0) + 1); }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

// The words that tell one row from its namesakes, or "" when its name is unique.
export function disambiguator(row, rows, { nameOf = r => r.name, madeOf = r => r.created_at || r.createdAt, statusOf = r => r.status } = {}) {
  if (!row || !dupeKeys(rows, nameOf).has(nameKey(nameOf(row)))) return "";
  const st = statusOf(row);
  return [madeOn(madeOf(row)), st ? (STATUS_WORD[String(st).toLowerCase()] || String(st).toLowerCase()) : ""].filter(Boolean).join(" · ");
}

// A label for a <select> option: the name, then the disambiguator in brackets.
export function optionLabel(row, rows, opts) {
  const d = disambiguator(row, rows, opts);
  const name = (opts && opts.nameOf ? opts.nameOf(row) : row.name) || "";
  return d ? `${name} (${d})` : name;
}
