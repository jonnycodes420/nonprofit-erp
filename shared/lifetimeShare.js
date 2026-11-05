// shared/lifetimeShare.js · MOPUP-1. A FUND'S SHARE OF SOMEONE'S LIFETIME, IN WORDS.
//
// The profile's "What they support" read "$250 · 0% of lifetime": a whole
// percent rounds a real $250 down to nothing. Under 1% reads "under 1% of
// lifetime", and 0% shows only when the amount is $0.

// cents: the fund's total; lifetimeCents: the person's Lifetime; pct: the
// whole percent the split gave it (fundSplit.wholePercents).
export function lifetimeShareWords(cents, lifetimeCents, pct) {
  const c = Math.round(Number(cents) || 0), life = Math.round(Number(lifetimeCents) || 0);
  if (c <= 0) return "0% of lifetime";
  if (life > 0 && c * 100 < life) return "under 1% of lifetime";
  return `${Math.max(1, Math.round(Number(pct) || 0))}% of lifetime`;
}
