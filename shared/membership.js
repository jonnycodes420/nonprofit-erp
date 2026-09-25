// shared/membership.js — BUILD-101. MEMBERSHIPS.
//
// A membership is not a donation, even when the same person pays for both.
// This module holds the rules that make the difference exact:
//
//   · A LEVEL has a price and a FAIR-MARKET VALUE the org states for its
//     benefits. FMV may not exceed the price (the BUILD-98 event-level rule:
//     a negative deductible is a typo, not a tax position), and Steward never
//     estimates it. An FMV of $0 means the whole membership is deductible on
//     the receipt, and the level screen says so in a sentence.
//   · A membership's EXPIRY is worked out from its start and the level's term,
//     as civil dates (YYYY-MM-DD), never instants.
//   · A RENEWAL extends from the old expiry, not from today, so paying early
//     never costs a member time (Part 2).
//
// Pure: no DB, no network, no clock, no JSX. Money is integer cents.

export const TERMS = ["12_months", "calendar_year", "lifetime"];
export const TERM_LABEL = { "12_months": "12 months", calendar_year: "Calendar year", lifetime: "Lifetime" };
export const SCOPES = ["individual", "household"];
export const STATUSES = ["active", "grace", "lapsed", "cancelled"];
// A person HOLDS a membership while it is active or in its grace period; that
// is what the one-per-person index guards.
export const CURRENT_STATUSES = ["active", "grace"];
export const MAX_BENEFITS = 20;

const toCents = v => Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);

export function validateLevel(raw) {
  const errors = [];
  const name = String(raw?.name || "").trim().slice(0, 120);
  if (!name) errors.push("a level needs a name");
  const priceCents = toCents(raw?.price);
  if (!Number.isFinite(priceCents) || priceCents <= 0) errors.push("a price greater than zero");
  const fmvCents = raw?.fmv === undefined || raw?.fmv === null || raw?.fmv === "" ? 0 : toCents(raw.fmv);
  if (!Number.isFinite(fmvCents) || fmvCents < 0) errors.push("a fair-market value of zero or more");
  if (Number.isFinite(priceCents) && Number.isFinite(fmvCents) && fmvCents > priceCents)
    errors.push("the fair-market value cannot be more than the price — the deductible part would be negative");
  const term = TERMS.includes(raw?.term) ? raw.term : null;
  if (!term) errors.push(`a term: ${TERMS.map(t => TERM_LABEL[t]).join(", ")}`);
  const scope = SCOPES.includes(raw?.scope) ? raw.scope : "individual";
  const lines = Array.isArray(raw?.benefits) ? raw.benefits : String(raw?.benefits || "").split("\n");
  const benefits = lines.map(b => String(b || "").trim().slice(0, 200)).filter(Boolean);
  if (benefits.length > MAX_BENEFITS) errors.push(`no more than ${MAX_BENEFITS} benefit lines`);
  return errors.length ? { ok: false, errors }
    : { ok: true, level: { name, priceCents, fmvCents, term, scope, benefits } };
}

// The one sentence the level screen owes an org about what its receipts say.
export function fmvSentence({ priceCents, fmvCents }) {
  const usd = c => "$" + (c / 100).toFixed(2).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!fmvCents) return `No fair-market value is set, so receipts will call the whole ${usd(priceCents)} deductible. Set the value of the benefits if members receive anything.`;
  return `Receipts will say ${usd(fmvCents)} of each ${usd(priceCents)} membership bought benefits, and ${usd(priceCents - fmvCents)} is deductible.`;
}

// ── CIVIL-DATE ARITHMETIC ──────────────────────────────────────────────────
const parse = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "")); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const fmt = (y, mo, d) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
export function addDaysCivil(d, n) {
  const p = parse(d); if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
// One year on, clamped: 29 Feb + 1 year is 28 Feb.
function addYear(d) {
  const p = parse(d); if (!p) return null;
  const y = p.y + 1; return fmt(y, p.mo, Math.min(p.d, daysIn(y, p.mo)));
}

// The last day a membership that begins on `startsOn` is valid. A 12-month
// membership bought on 15 March runs THROUGH 14 March next year; a calendar-
// year one through 31 December of its year; a lifetime one has no expiry.
export function expiryFor({ term, startsOn }) {
  if (term === "lifetime") return null;
  const p = parse(startsOn); if (!p) return null;
  if (term === "calendar_year") return fmt(p.y, 12, 31);
  return addDaysCivil(addYear(startsOn), -1);
}

// Part 2 — a renewal's new term starts the day after the OLD expiry when that
// is still ahead of today (or within grace), so paying early never costs time.
// A membership already lapsed starts again from today.
export function renewalStart({ oldExpires, today, lapsed = false }) {
  if (!oldExpires || lapsed) return today;
  const next = addDaysCivil(oldExpires, 1);
  return next;
}

export function quidProQuoDescription({ levelName, benefits = [] }) {
  const b = benefits.filter(Boolean);
  return `${levelName} membership benefits${b.length ? " (" + b.slice(0, 3).join("; ") + (b.length > 3 ? "; …" : "") + ")" : ""}`;
}
