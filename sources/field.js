// sources/field.js — BUILD-89S. READING A FIELD WHOSE NAME IS NOT CONFIRMED.
//
// Two of the four providers (Zeffy, Givebutter) publish an interactive API
// reference that cannot be read without an account, so the exact field names
// on a payment object are not confirmed. The answer is NOT to guess in the
// middle of a mapper: each adapter DECLARES its candidate paths per contract
// field, in priority order, and the mapper walks the declaration.
//
// The uncertainty then has a shape: it is visible, it is in one table per
// provider, each adapter's suite proves every declared candidate is actually
// read, and correcting it against a real payload is editing one line rather
// than hunting property reads. That is what "build the infrastructure so the
// API can be plugged in later" means in practice.

function readPath(obj, path) {
  let cur = obj;
  for (const part of String(path).split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

// The first candidate that resolves to something real. Null, undefined and
// the empty string all fall through — a provider that sends `"email": ""`
// has not told us an email.
function firstOf(obj, paths) {
  for (const p of paths || []) {
    const v = readPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// Money, in integer CENTS, or null when the value cannot be read as money.
// NEVER a guess: a gift written at the wrong scale is worse than a gift
// refused, because nothing downstream can tell it happened.
//
// `unit: "cents"` for a provider that already speaks in minor units (Stripe),
// "major" for one that sends dollars (most others).
function toCents(v, { unit = "major" } = {}) {
  if (v == null) return null;
  if (typeof v === "object") return toCents(v.amount ?? v.value ?? v.total, { unit });
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return unit === "cents" ? Math.round(n) : Math.round(n * 100);
}

// A civil date from whatever the provider sends: an ISO string, or a unix
// timestamp in seconds (Stripe, Givebutter). Returns null rather than a
// plausible-looking wrong day.
function toCivilDate(v) {
  if (v == null) return null;
  if (typeof v === "number" || /^\d{9,11}$/.test(String(v))) {
    const d = new Date(Number(v) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// "3 bank transfer, 1 pending" — the run summary's own words for what was
// read and deliberately not counted as a gift.
function dropNotice(provider, drops) {
  const parts = Object.entries(drops || {}).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`);
  return parts.length ? `${provider} rows not counted as gifts: ${parts.join(", ")}.` : null;
}

module.exports = { readPath, firstOf, toCents, toCivilDate, dropNotice };
