// server/admin/sales/fit.js · SALES-2 item 2. FIT, AS PLAIN RULES JONATHAN SETS.
//
// A fit rule is a checklist of properties, kept in sales_settings under "fit". Each
// organization is checked against every line, and its answer is "Fits 4 of 5" with the
// misses named. Arithmetic on fields, never a score from a model. Change the rule and
// every org's answer changes on its next read (it is computed, never stored).
//
// A check is one of:
//   { field, op: "in", values: [..] }        the field's value is one of these (case and
//                                            spaces ignored; "spreadsheet" also matches
//                                            "Spreadsheets")
//   { field, op: "between", min, max }       a number, inclusive (revenue in dollars)
//   { field: "has_ed" | "has_dd" | "has_phone" | "has_email", op: "yes" }
// `field` is a core org field or props.<key>. An unknown value is a miss, named as such.
"use strict";

const DEFAULT_FIT = {
  checks: [
    { field: "state", op: "in", values: ["KY", "OH", "TN"] },
    { field: "revenue", op: "between", min: 100000, max: 2000000 },
    { field: "current_crm", op: "in", values: ["none", "spreadsheet"] },
    { field: "has_dd", op: "yes" },
    { field: "has_phone", op: "yes" },
  ],
};
const FLAGS = {
  has_ed: "Has an executive director", has_dd: "Has a development director",
  has_phone: "Has a phone", has_email: "Has an email",
};
const FIELD_WORDS = { state: "State", revenue: "Revenue", current_crm: "Current CRM", city: "City", nonprofit_type: "Type", revenue_band: "Revenue band" };
const OPS = ["in", "between", "yes"];

const norm = v => String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
const money = n => (n >= 1000000 ? `$${+(n / 1000000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`);
const fieldWords = (f, props = []) => FLAGS[f] || FIELD_WORDS[f] || (f.startsWith("props.") ? ((props.find(p => p.key === f.slice(6)) || {}).label || f.slice(6)) : f.replace(/_/g, " "));

// The words for one check: "State is KY, OH or TN".
function checkWords(c, props = []) {
  if (c.op === "yes") return FLAGS[c.field] || `${fieldWords(c.field, props)} is set`;
  if (c.op === "between") {
    const lo = Number.isFinite(Number(c.min)) && c.min !== null && c.min !== "" ? Number(c.min) : null;
    const hi = Number.isFinite(Number(c.max)) && c.max !== null && c.max !== "" ? Number(c.max) : null;
    const w = fieldWords(c.field, props);
    return lo != null && hi != null ? `${w} ${money(lo)}–${money(hi)}` : lo != null ? `${w} at least ${money(lo)}` : `${w} at most ${money(hi)}`;
  }
  const vals = (c.values || []).map(String);
  return `${fieldWords(c.field, props)} is ${vals.length > 1 ? `${vals.slice(0, -1).join(", ")} or ${vals.at(-1)}` : vals[0] || "–"}`;
}

// A rule as stored → a rule that can be read (bad lines dropped, never thrown).
function cleanRule(rule) {
  const checks = (rule && Array.isArray(rule.checks) ? rule.checks : []).filter(c => c && typeof c.field === "string" && OPS.includes(c.op))
    .slice(0, 20).map(c => (c.op === "in" ? { field: c.field, op: "in", values: (Array.isArray(c.values) ? c.values : String(c.values || "").split(",")).map(x => String(x).trim()).filter(Boolean).slice(0, 50) }
      : c.op === "between" ? { field: c.field, op: "between", min: c.min === "" || c.min == null ? null : Number(c.min), max: c.max === "" || c.max == null ? null : Number(c.max) }
      : { field: c.field, op: "yes" }));
  return { checks };
}

// org: a list row (lists.rowsFor) carrying has_ed / has_dd / has_phone / has_email.
// → { met, total, misses: [words], line: "Fits 4 of 5" }
function fitOf(org, rule, props = []) {
  const checks = cleanRule(rule).checks;
  const misses = [];
  for (const c of checks) {
    const raw = c.field.startsWith("props.") ? (org.props || {})[c.field.slice(6)] : org[c.field];
    const unknown = raw == null || raw === "" || (Array.isArray(raw) && !raw.length);
    let met;
    if (c.op === "yes") met = raw === true;
    else if (unknown) { misses.push(`${fieldWords(c.field, props)} not known`); continue; }
    else if (c.op === "between") {
      const n = Number(String(raw).replace(/[$,\s]/g, ""));
      met = Number.isFinite(n) && (c.min == null || n >= c.min) && (c.max == null || n <= c.max);
    } else {
      const v = norm(Array.isArray(raw) ? raw.join(" ") : raw);
      met = c.values.some(x => { const w = norm(x); return v === w || v.startsWith(w); });
    }
    if (!met) misses.push(c.op === "yes" ? `No ${FLAGS[c.field] ? FLAGS[c.field].replace(/^Has an? /, "").toLowerCase() : fieldWords(c.field, props)}` : `${checkWords(c, props)} (it's ${c.op === "between" ? money(Number(String(raw).replace(/[$,\s]/g, ""))) : raw})`);
  }
  const total = checks.length, met = total - misses.length;
  return { met, total, misses, line: total ? `Fits ${met} of ${total}` : "No fit rule" };
}

module.exports = { DEFAULT_FIT, FLAGS, cleanRule, fitOf, checkWords };
