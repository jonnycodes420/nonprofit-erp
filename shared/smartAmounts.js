// shared/smartAmounts.js — GIVE-2 §3. WHICH AMOUNTS THE FORM OFFERS.
//
// ── THE DEFAULT LADDER IS A GUESS ABOUT SOMEBODY ELSE'S DONORS ─────────────
// `DEFAULT_AMOUNTS_CENTS` in formConfig.js is $25 / $50 / $100 / $250, which is
// a sensible guess and is nobody's actual data. Two things are known and are
// not being used:
//
//   · A RETURNING DONOR arriving by their own personal link has a gift history.
//     Their last gift is a far better first button than $25, and a step up from
//     it is the ask that raises more.
//   · AN ORG has a distribution. A food bank whose typical gift is $35 and a
//     capital campaign whose typical gift is $2,500 should not open on the same
//     four buttons.
//
// ── WHAT THIS MODULE MAY NOT DO ────────────────────────────────────────────
// It reads the DONOR'S OWN HISTORY and the ORG'S OWN GIFTS. Nothing else. No
// wealth screening, no capacity estimate, no third-party data — that is
// PROSPECT-1 and it is a different build with a different set of promises. A
// suggested amount here is arithmetic on money the org already received, and
// the sentence it shows says exactly that.
//
// ── AND THE ORG ALWAYS WINS ────────────────────────────────────────────────
// A form with its own `amountsCents` set keeps them. Smart amounts are opt-in
// per form (`smartAmounts: true`), and the settings screen states in words how
// the amounts are chosen when they are on. A fundraiser who typed four numbers
// is not overruled by a median.
//
// Pure: integer cents, no DB, no clock, no network.

// ── THE FRIENDLY AMOUNTS ───────────────────────────────────────────────────
// A ladder is only useful if its rungs are amounts a person recognises. $37
// computed from a median is a number a form should never print: it reads as a
// price, not an ask. Every suggestion is snapped to this list, which is the
// 1 / 2.5 / 5 progression most giving forms use, extended both ways.
// 1 / 1.5 / 2 / 2.5 / 3.5 / 5 / 7.5 in every decade, so the rungs stay evenly
// spaced all the way up. The gaps matter: the first cut skipped $2,000 and
// $3,000, and a donor whose largest gift was $2,000 was asked for $5,000 —
// one rung in the list is one ask, and a missing rung is a 150% jump.
export const FRIENDLY_CENTS = Object.freeze([
  500, 1000, 1500, 2000, 2500, 3500, 5000, 7500,
  10000, 15000, 20000, 25000, 35000, 50000, 75000,
  100000, 150000, 200000, 250000, 350000, 500000, 750000,
  1000000, 1500000, 2000000, 2500000, 3500000, 5000000, 7500000, 10000000,
]);

export const MIN_SUGGESTION_CENTS = FRIENDLY_CENTS[0];
export const MAX_SUGGESTION_CENTS = FRIENDLY_CENTS[FRIENDLY_CENTS.length - 1];

// The nearest friendly amount AT OR ABOVE the number handed in, because every
// use of this is an ask and an ask rounds up. The one exception is the donor's
// own last gift, which is snapped DOWN when it sits between rungs so the first
// button is never more than they gave last time (`snapDown`).
export function toFriendlyCents(cents, { snapDown = false } = {}) {
  const c = Math.round(Number(cents) || 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (c >= MAX_SUGGESTION_CENTS) return MAX_SUGGESTION_CENTS;
  if (c <= MIN_SUGGESTION_CENTS) return MIN_SUGGESTION_CENTS;
  if (snapDown) {
    let best = FRIENDLY_CENTS[0];
    for (const f of FRIENDLY_CENTS) { if (f <= c) best = f; else break; }
    return best;
  }
  return FRIENDLY_CENTS.find(f => f >= c) ?? MAX_SUGGESTION_CENTS;
}

// The next rung up, and the one after it. `steps` away.
function rungAbove(cents, steps = 1) {
  const i = FRIENDLY_CENTS.indexOf(cents);
  if (i < 0) return null;
  return FRIENDLY_CENTS[Math.min(FRIENDLY_CENTS.length - 1, i + steps)] ?? null;
}

const uniqAscending = list => [...new Set(list.filter(c => Number.isInteger(c) && c > 0))].sort((a, b) => a - b);

// ── A RETURNING DONOR'S OWN LADDER ─────────────────────────────────────────
// Their last gift, a step up, and a bigger step. Three buttons, not four: the
// point of arriving by a personal link is that the form already knows, and a
// fourth button is a fourth decision.
//
// `lastGiftCents` is THEIR OWN last gift through this org, which the caller
// looked up for the donor the personal link identified. Nothing is suggested
// from a gift of nothing.
export function ladderFromLastGift(lastGiftCents) {
  const exact = Math.round(Number(lastGiftCents) || 0);
  if (!Number.isFinite(exact) || exact < MIN_SUGGESTION_CENTS) return null;
  // THE FIRST BUTTON IS THEIR OWN NUMBER, not the nearest round one. "That, a
  // step up, and a bigger step" is what the brief asks for, and "that" means
  // the $120 they actually gave — snapping it to $100 both loses money and
  // loses the recognition, which is the whole point of a personal link. The
  // two steps above it come off the friendly ladder, so $120 reads
  // $120 / $150 / $200.
  const base = Math.min(exact, MAX_SUGGESTION_CENTS);
  const nextUp = FRIENDLY_CENTS.filter(c => c > base).slice(0, 2);
  const amounts = uniqAscending([base, ...nextUp]);
  if (amounts.length < 2) return null;         // already at the top of the ladder
  return {
    amountsCents: amounts,
    // THE SENTENCE. It names what it is built from, in the donor's own terms,
    // because a form that quietly knows your last gift and does not say so is a
    // form that feels like it has been reading your post.
    source: "donor_history",
    sentence: `These start from your last gift of ${dollars(lastGiftCents)}.`,
    defaultIndex: 1,                           // the step up is pre-selected, not the repeat
  };
}

// ── THE ORG'S OWN DISTRIBUTION ─────────────────────────────────────────────
// Four buttons from percentiles of the org's own recorded gifts through this
// form (or the org, when the form is new): the typical gift, and three asks
// above it. Percentiles rather than a mean, because one $50,000 gift moves a
// mean and moves nothing a form should do differently.
//
// `giftCentsList` is every gift the caller decided counts — already filtered,
// already in cents. Fewer than `MIN_SAMPLE` gifts is not a distribution, and
// the honest answer is to say so and let the default ladder stand.
export const MIN_SAMPLE = 8;

// The top suggested amount is at most this many times the first one.
export const MAX_LADDER_SPREAD = 10;

export function ladderFromDistribution(giftCentsList, { count = 4 } = {}) {
  const sorted = (giftCentsList || []).map(c => Math.round(Number(c) || 0)).filter(c => c > 0).sort((a, b) => a - b);
  if (sorted.length < MIN_SAMPLE) {
    return { amountsCents: null, source: "too_few", sampleSize: sorted.length,
             sentence: `Not enough gifts yet to tell. ${sorted.length === 1 ? "One gift" : `${sorted.length} gifts`} is not a pattern, so the form keeps the amounts you set.` };
  }
  const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  const median = at(0.5);
  const base = toFriendlyCents(median);
  if (!base) return { amountsCents: null, source: "too_few", sampleSize: sorted.length, sentence: "" };
  // The typical gift, then the 75th and 90th percentiles snapped up, then one
  // rung past the top of those. Duplicates collapse, which is correct: an org
  // whose gifts are nearly all $25 gets $25 / $35 / $50 / $75 from the rungs
  // rather than $25 four times.
  // ── THE LADDER MAY NOT SPAN THE WHOLE DISTRIBUTION ───────────────────────
  // The 90th percentile of a real nonprofit's gifts is a long way from the
  // middle one: Harborlight's median is $126 and its p90 is in the thousands,
  // so the first cut of this offered $150 / $500 / $3,500 / $5,000. That is not
  // a ladder, it is a list of four unrelated asks, and a donor meeting it
  // presses "Another amount". The browser walk on the year-end campaign page
  // found it.
  //
  // So the top rung is capped at ten times the first. Ten is the widest spread
  // that still reads as one ladder, and an org whose big gifts really are
  // thirty times its middle one is better served by the ask being plausible
  // than by the ask being its own 90th percentile.
  const ceiling = base * MAX_LADDER_SPREAD;
  const capped = c => (c != null && c > ceiling ? toFriendlyCents(ceiling, { snapDown: true }) : c);
  const wanted = uniqAscending([base, capped(toFriendlyCents(at(0.75))), capped(toFriendlyCents(at(0.9)))]);
  const amounts = [...wanted];
  let guard = 0;
  while (amounts.length < count && guard++ < 20) {
    const next = rungAbove(amounts[amounts.length - 1], 1);
    // AND THE FILLER OBEYS THE CEILING TOO. Capping the percentiles and then
    // padding past the cap is capping nothing: it produced $150 / $500 /
    // $1,500 / $2,000 off a $126 median, a thirteen-fold spread, on the first
    // run after the cap went in. Three buttons inside the ceiling beat four
    // that leave it.
    if (!next || amounts.includes(next) || next > ceiling) break;
    amounts.push(next);
  }
  return {
    amountsCents: uniqAscending(amounts).slice(0, count),
    source: "org_distribution",
    sampleSize: sorted.length,
    medianCents: median,
    sentence: `Chosen from this organisation's own gifts: the middle gift of the last ${sorted.length.toLocaleString("en-US")} was ${dollars(median)}.`,
    defaultIndex: 1,
  };
}

// ── THE ASK FROM A DONOR'S HISTORY ─────────────────────────────────────────
// GIVE-2 §3 is the form's ladder. This is the same arithmetic in the other
// direction and it belongs in the same file: the single amount a development
// director should ASK a donor for, shown with its working. ENGAGE-1 §3 owns the
// screen; the arithmetic is here so there is one place it lives.
//
// From the donor's OWN history only: their largest gift, the average of their
// last three, and whether that average is rising. Never from wealth or capacity
// data.
// PROSPECT-1 — the next friendly amount above this one (the ask, one step up).
export function nextFriendlyAbove(cents) { return rungAbove(toFriendlyCents(cents), 1) ?? cents; }

export function suggestedAskCents({ largestCents = 0, lastThreeCents = [] } = {}) {
  const three = (lastThreeCents || []).map(c => Math.round(Number(c) || 0)).filter(c => c > 0).slice(0, 3);
  const largest = Math.max(0, Math.round(Number(largestCents) || 0));
  if (!largest && !three.length) return null;
  const avgThree = three.length ? Math.round(three.reduce((a, b) => a + b, 0) / three.length) : 0;
  // RISING means the most recent of the three is above the oldest of them. The
  // caller hands them newest-first, which is the order every gift list in this
  // product is already in.
  const rising = three.length >= 2 && three[0] > three[three.length - 1];
  const anchor = Math.max(largest, avgThree);
  const base = toFriendlyCents(anchor);
  if (!base) return null;
  const ask = rising ? (rungAbove(base, 1) ?? base) : base;
  const bits = [];
  if (largest) bits.push(`Largest gift ${dollars(largest)}`);
  if (avgThree) bits.push(`last ${three.length === 1 ? "gift was" : `${three.length} averaged`} ${dollars(avgThree)}${rising ? " and rising" : ""}`);
  return {
    askCents: ask,
    // THE MATH IN ONE LINE, which is the brief's own requirement and the
    // difference between a suggestion a fundraiser trusts and a number a
    // computer produced.
    sentence: `${bits.join(", ")}: ask ${dollars(ask)}.`,
    largestCents: largest,
    avgLastThreeCents: avgThree,
    rising,
  };
}

// `en-US`, named. Whole dollars when the amount is whole, which every friendly
// rung is — a suggested ask of "$2,500.00" reads like an invoice.
export function dollars(cents) {
  const c = Math.round(Number(cents) || 0);
  const whole = c % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(c / 100);
}

// ── HOW THE AMOUNTS WERE CHOSEN, for the settings screen ───────────────────
// Named here rather than written on the screen, so the words a fundraiser reads
// and the words the public form shows cannot drift.
export const HOW_CHOSEN = Object.freeze({
  form: "The amounts you set on this form. Nothing is computed.",
  donor_history: "A returning donor arriving by their own personal link sees amounts starting from their own last gift. Their history, never anything bought from anybody.",
  org_distribution: "Everyone else sees amounts drawn from this organisation's own recorded gifts through this form: the middle gift, then three asks above it.",
  too_few: "Until there are eight gifts to look at, the form keeps the amounts you set.",
});
