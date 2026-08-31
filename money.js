// money.js — THE MONEY SEAM. BUILD-73 Part 2.
//
// Built the same way orgTime.js was built in BUILD-72 Part 4: the two kinds of
// a thing meet in exactly one file, and nowhere else is allowed to convert
// between them.
//
// ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
// Eight call sites in server.js each made their own rounding decision:
//
//     const amt = Math.round(Number(amount));     // $33.33 -> 33
//
// Eight decisions is eight chances to be wrong, and they were wrong in the same
// direction: every one rounded to a WHOLE DOLLAR. `$33.33` stored as `33`.
// `$33.67` stored as `34` — the defect invents money as readily as it loses it,
// which is why nothing here ever nets two errors against each other.
//
// The cast was never in the database. `gifts.amount`, `donors.total_giving` and
// `donors.last_gift_amount` stopped being INTEGER in the cover-fees migration
// (db.js, INTEGER -> NUMERIC); `pledges.amount`, `fin_transactions.amount` and
// `recurring_subscriptions.amount` were NUMERIC from creation. Every money
// column could already hold cents. The comment at the manual-entry site still
// read "INTEGER column" — stale by one migration, and that stale comment is
// probably why the rounding outlived its own justification.
//
// ── THE TWO KINDS ───────────────────────────────────────────────────────────
//
//   CENTS    an integer. The ONLY representation money is ever computed in.
//            Addition, subtraction and comparison of cents are exact. There is
//            no such thing as half a cent in this system.
//
//   DOLLARS  a NUMERIC(12,2) column, and the JSON number every API response and
//            every existing read path already expects. Exact to 2dp — NUMERIC
//            is arbitrary-precision decimal, not binary floating point, so
//            storing dollars is not the defect and converting the whole schema
//            to integer-cents columns would buy no accuracy while breaking
//            every `parseFloat(row.amount)` in the codebase.
//
// THE RULE: parse to cents at the edge, compute in cents, convert back exactly
// once when writing. Never round money to a whole dollar. Never let a float
// carry a money value across a function boundary.
//
// Pinned by tests/money-cents.test.js and by the source scan in
// scripts/build73-money-audit.js, which is run BY that suite — so a new
// Math.round() on a money value fails the build rather than waiting for a
// donor to notice.

// The largest gift this system will accept, in cents. $100,000,000.00 — above
// any real single gift and below the point where integer arithmetic in JS gets
// interesting (Number.MAX_SAFE_INTEGER is ~9e15 cents).
const MAX_CENTS = 100_000_000_00;

// Parse ANYTHING that arrived from outside — a JSON body, a CSV cell, a Stripe
// payload, a form field — into an integer number of cents.
//
// Returns null for input that is not a usable money value, so a caller must
// decide what to do about it. It never silently becomes 0: a row whose amount
// could not be read is not a $0.00 gift, and BUILD-72 Part 1's whole point is
// that a row must never leave the pipeline without being recorded.
//
// Accepts: 33.33 · "33.33" · "$33.33" · "1,234.56" · " 33.33 " · 33 · "33"
function toCents(input) {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return clamp(roundHalfUp(input * 100));
  }
  if (typeof input !== "string") return null;
  // Strip currency symbols, thousands separators and surrounding whitespace.
  // A leading minus survives — refunds and adjustments are real.
  const cleaned = input.trim().replace(/[$\s,]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return clamp(roundHalfUp(n * 100));
}

// `n * 100` is the one place binary floating point can bite: 33.33 * 100 is
// 3332.9999999999995, and Math.round saves it, but 1.005 * 100 is
// 100.49999999999999 and Math.round does NOT. Nudging by an epsilon
// proportional to the magnitude makes half-cent inputs round half-up the way a
// person reading the number expects.
function roundHalfUp(cents) {
  const eps = Math.abs(cents) * Number.EPSILON * 4;
  return Math.round(cents + (cents >= 0 ? eps : -eps));
}

function clamp(cents) {
  if (!Number.isFinite(cents)) return null;
  if (Math.abs(cents) > MAX_CENTS) return null;
  return cents;
}

// Cents -> the exact 2dp dollars figure that goes into a NUMERIC column or a
// JSON response. `3333 -> 33.33`. This is the ONLY conversion back.
function toDollars(cents) {
  if (cents === null || cents === undefined) return null;
  const c = Math.trunc(Number(cents));
  if (!Number.isFinite(c)) return null;
  // Divide, then snap to 2dp: 3333/100 is exactly 33.33 in IEEE-754 terms only
  // after the round, and the DB column is NUMERIC(12,2) either way.
  return Math.round(c) / 100;
}

// Read a money value BACK out of the database (or any dollars-shaped source)
// into cents, for arithmetic. A NUMERIC column arrives from `pg` as a STRING,
// which is exactly why this exists: `parseFloat` on it is how money arithmetic
// silently becomes float arithmetic.
function fromDollars(value) {
  return toCents(value);
}

// Sum a list of dollars-shaped values EXACTLY, returning cents. Every "add up
// the gifts" in this codebase should end here rather than reducing floats.
function sumDollars(values) {
  let total = 0;
  for (const v of values) {
    const c = toCents(v);
    if (c === null) continue;
    total += c;
  }
  return total;
}

// Display. `3333 -> "$33.33"`. Always two decimal places — a receipt reading
// "$33.3" is a receipt nobody trusts.
function formatCents(cents, { symbol = "$" } = {}) {
  const c = Math.trunc(Number(cents) || 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const s = `${symbol}${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return neg ? `-${s}` : s;
}

// True when a dollars-shaped value carries a non-zero cents component. Used by
// the import invariant and by the audit script.
function hasCents(value) {
  const c = toCents(value);
  return c !== null && c % 100 !== 0;
}

// The guard for a WRITE path. Parses to cents and refuses anything unusable,
// naming the field, so a route returns a typed 400 instead of writing a 0 or a
// NaN. This is the function the eight former Math.round() sites call.
function parseMoneyOrThrow(input, field = "amount") {
  const cents = toCents(input);
  if (cents === null) {
    const err = new Error(`${field} is not a valid money amount: ${JSON.stringify(input)}`);
    err.code = "invalid_money";
    err.field = field;
    throw err;
  }
  return cents;
}

module.exports = {
  MAX_CENTS,
  toCents, toDollars, fromDollars, sumDollars,
  formatCents, hasCents, parseMoneyOrThrow,
};
