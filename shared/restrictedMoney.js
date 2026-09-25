// shared/restrictedMoney.js — BUILD-100 (grants) Part 4. WHERE RESTRICTED
// MONEY ACTUALLY IS.
//
// ── THE FOUR FIGURES, AND WHY "REMAINING" MEANS WHAT IT MEANS ─────────────
// The brief asks for awarded, received, spent, remaining. Three of those are
// unambiguous. "Remaining" is not, and the choice matters to a treasurer:
//
//   remaining = RECEIVED − SPENT      ← what this module means
//   remaining = AWARDED − SPENT       ← rejected
//
// A restricted balance answers "how much money am I holding that I am only
// allowed to spend on this programme". Money a funder has promised but not yet
// paid is not in the bank and cannot be spent, so counting it as remaining
// would overstate the restricted balance by exactly the amount still owed —
// and an org that spent against that figure would be spending money it did not
// have. The promised-but-unpaid half is its OWN figure, `outstanding`, on its
// own line. Two honest numbers beat one ambiguous one.
//
// Every figure carries a one-sentence DEFINITION (the BUILD-86 C.3 rule):
// nothing reaches a screen without one, and the definition is ONE string from
// this registry to the hover and to any export — never a copy.
//
// ALL ARITHMETIC IN INTEGER CENTS. A restricted balance is the figure an
// auditor reconciles; floating-point dollars are how it comes out a penny
// wrong and nobody can say why.
//
// Pure: no DB, no clock, no JSX. `today` is always a parameter.

export const RESTRICTED_METRICS = [
  { key: "awarded", label: "Awarded",
    definition: "What the funder said yes to, in the award letter." },
  { key: "received", label: "Received",
    definition: "Payments from this funder that have actually arrived and are applied to this award." },
  { key: "outstanding", label: "Still owed",
    definition: "Awarded but not yet paid. Promised money, not money you are holding." },
  { key: "spent", label: "Spent",
    definition: "Spending recorded against this award by hand. It is not read from a bank feed." },
  { key: "remaining", label: "Remaining to spend",
    definition: "Received minus spent — the restricted money you are holding right now. It deliberately excludes what the funder still owes, because you cannot spend that." },
];
export const RESTRICTED_METRIC_KEYS = RESTRICTED_METRICS.map(m => m.key);
export function metricDefinition(key) {
  const m = RESTRICTED_METRICS.find(x => x.key === key);
  return m ? m.definition : null;
}
// The registry test's teeth: a metric added without a definition, or with one
// that is not a sentence, cannot reach a screen.
export function definitionProblems() {
  const out = [];
  for (const m of RESTRICTED_METRICS) {
    if (!m.definition || m.definition.length < 25) out.push(`${m.key}: definition too short to mean anything`);
    else if (!/\.$/.test(m.definition)) out.push(`${m.key}: definition is not a sentence`);
    if (!m.label) out.push(`${m.key}: no label`);
  }
  return out;
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const int = v => Math.trunc(Number(v) || 0);

// ── THE BALANCE FOR ONE GRANT ─────────────────────────────────────────────
// Inputs are already cents. `restriction` decides whether this is restricted
// money at all: an unrestricted award posts as unrestricted and has no
// restricted balance to report, which is a real answer rather than a zero.
export function grantBalance({
  awardedCents = 0, receivedCents = 0, spentCents = 0,
  restriction = null, restrictedUntil = null, today = null,
} = {}) {
  const awarded = int(awardedCents), received = int(receivedCents), spent = int(spentCents);
  const outstanding = Math.max(0, awarded - received);
  const remaining = received - spent;                 // MAY go negative — see below
  const restricted = restriction === "program_restricted"
    || restriction === "capital" || restriction === "time_restricted";
  // A release date only exists for time-restricted money, and "released" is a
  // fact about the calendar, not a judgement.
  let releaseDate = null, released = null;
  if (restriction === "time_restricted" && CIVIL.test(String(restrictedUntil || ""))) {
    releaseDate = String(restrictedUntil);
    if (CIVIL.test(String(today || ""))) released = String(today) >= releaseDate;
  }
  return {
    awardedCents: awarded, receivedCents: received, spentCents: spent,
    outstandingCents: outstanding, remainingCents: remaining,
    restricted, restriction: restriction || null, releaseDate, released,
    // OVERSPENT IS SAID OUT LOUD, never clamped to zero. Spending more against
    // a restricted award than the funder has paid is precisely the finding this
    // screen exists to surface; hiding it behind a floor would make the screen
    // worse than no screen.
    overspent: remaining < 0,
  };
}

// The sentence beside the balance. `formatMoney` takes cents.
export function balanceSentence(b, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!b) return "";
  if (!b.restricted) {
    return `${fm(b.awardedCents)} awarded, unrestricted — the organisation decides where it goes.`;
  }
  if (b.overspent) {
    return `${fm(-b.remainingCents)} more has been spent against this award than the funder has paid. Check the spending entries or the payments.`;
  }
  const parts = [`${fm(b.remainingCents)} of restricted money still to spend`];
  if (b.outstandingCents > 0) parts.push(`${fm(b.outstandingCents)} still owed by the funder`);
  if (b.releaseDate) {
    parts.push(b.released
      ? `released on ${b.releaseDate}`
      : `not spendable until ${b.releaseDate}`);
  }
  return parts.join(", ") + ".";
}

// ── THE ORG'S RESTRICTED POSITION ─────────────────────────────────────────
// Summed over grants IN CENTS, and the sum is asserted against the rows rather
// than recomputed from dollars. A total that cannot disagree with its rows is
// not a check; this one can, and the suite makes it.
export function restrictedTotals(balances = []) {
  const only = balances.filter(b => b && b.restricted);
  const sum = k => only.reduce((s, b) => s + int(b[k]), 0);
  return {
    grants: only.length,
    awardedCents: sum("awardedCents"),
    receivedCents: sum("receivedCents"),
    spentCents: sum("spentCents"),
    outstandingCents: sum("outstandingCents"),
    remainingCents: sum("remainingCents"),
    overspentGrants: only.filter(b => b.overspent).length,
  };
}

export function totalsSentence(t, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!t || !t.grants) return "No restricted grant money on the books.";
  const bits = [`${fm(t.remainingCents)} of restricted money across ${t.grants} ${t.grants === 1 ? "grant" : "grants"}`];
  if (t.outstandingCents > 0) bits.push(`${fm(t.outstandingCents)} still owed`);
  if (t.overspentGrants > 0) {
    bits.push(`${t.overspentGrants} ${t.overspentGrants === 1 ? "grant is" : "grants are"} overspent`);
  }
  return bits.join(", ") + ".";
}

// ── A SPEND ENTRY ─────────────────────────────────────────────────────────
// Recorded BY HAND in this build. QuickBooks spend against a grant waits on
// 91f and the Intuit keys (the brief says so), and the screen must say that
// rather than implying a bank feed nobody connected.
export const SPEND_SOURCE_NOTE =
  "Spending is entered by hand. Steward does not read it from a bank feed or an accounting system yet.";

export function validateSpend({ amountCents, spentOn, description } = {}) {
  const errors = [];
  const c = Number(amountCents);
  if (!Number.isInteger(c) || c <= 0) {
    errors.push({ field: "amount", message: "A positive amount is required." });
  }
  if (!CIVIL.test(String(spentOn || ""))) {
    errors.push({ field: "spentOn", message: "The date must be YYYY-MM-DD." });
  }
  if (!String(description || "").trim()) {
    errors.push({ field: "description", message: "Say what the money was spent on — a restricted-spend line with no description cannot be defended in an audit." });
  }
  return { ok: errors.length === 0, errors };
}
