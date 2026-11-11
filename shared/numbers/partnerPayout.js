// shared/numbers/partnerPayout.js · SALES-1 Part B. WHAT A PARTNER IS OWED, MONTH BY MONTH.
//
// The one home for a channel partner's payout. The MRR it multiplies is the
// figure the Onboarding tab shows (server/onboard/signals.js mrrNowCents, the
// live subscription's monthly bill); this module never computes MRR itself.
//
//   termOf(term, override)      the term that applies on one deal: the partner's
//                               term with any per-deal override laid over it
//   owedByMonth(term, months, mrrCents)
//        months: ["2026-09", "2026-10", ...], the deal's paying months in order
//        (month 1 is the first). Each month: a percent of MRR, or a flat amount;
//        recurring every month, or one-time (month 1 only); only while the
//        month is within `months` (null: no end); never past `cap_cents` in all.
//
// THE PLANTED DEFECT (SALES1_PLANT=duration, tests only): a term pays one month
// past its duration. tests/sales1-partners.test.js §13 goes red.
"use strict";

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES1_PLANT || "" : "";
const num = v => (v == null || v === "" ? null : Number(v));

function termOf(term, override = {}) {
  const o = override || {};
  const pick = (a, b) => (num(a) != null ? num(a) : num(b));
  return {
    percent: pick(o.override_percent, term.percent),
    flatCents: pick(o.override_flat_cents, term.flat_cents),
    recurring: term.recurring !== false,
    months: o.override_months != null ? num(o.override_months) : num(term.months),
    capCents: o.override_cap_cents != null ? num(o.override_cap_cents) : num(term.cap_cents),
  };
}

// One month's amount before the cap: percent of MRR (rounded to the cent) or the flat amount.
function monthAmount(t, mrrCents) {
  if (t.percent != null) return Math.round((Number(mrrCents || 0) * t.percent) / 100);
  return Math.round(Number(t.flatCents || 0));
}

function inDuration(t, i) {
  if (!t.recurring) return i === 0;
  if (t.months == null) return true;
  return PLANT === "duration" ? i <= t.months : i < t.months;   // i is 0-based: month 1 is i = 0
}

function owedByMonth(t, months, mrrCents) {
  let paidSoFar = 0;
  return months.map((month, i) => {
    let cents = inDuration(t, i) ? monthAmount(t, mrrCents) : 0;
    let capped = false;
    if (t.capCents != null && paidSoFar + cents > t.capCents) { cents = Math.max(0, t.capCents - paidSoFar); capped = true; }
    paidSoFar += cents;
    return { month, n: i + 1, cents, capped, ended: !inDuration(t, i) };
  });
}

const SENTENCE = "What a partner is owed each month: the deal's term (a percent of the org's MRR now, the Onboarding tab's figure, or a flat amount), every month or once, only within the term's months, and never more than its cap in all.";

module.exports = { termOf, owedByMonth, monthAmount, SENTENCE };
