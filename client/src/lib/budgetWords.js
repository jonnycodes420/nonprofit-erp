// FIX-60 · HOW A BUDGET LINE READS.
//
// A variance of nothing read "+$0", a sign on no difference at all. Zero (to
// the cent) reads "on budget"; anything else keeps its sign and its dollars.
// Pure: the caller passes the money formatter it draws with.
// POLISH-4: with the line's section it reads in words, the right way round.
// The variance is budget − actual for both sections, so revenue ahead of its
// budget is negative: "$1,750 ahead", never "-$1,750" in red. Expense: "$300
// under" or "$300 over".
export function budgetVarianceText(variance, money, section = null) {
  const cents = Math.round(Number(variance || 0) * 100);
  if (cents === 0) return "on budget";
  if (section === "revenue") return `${money(Math.abs(cents) / 100)} ${cents < 0 ? "ahead" : "short"}`;
  if (section === "expense") return `${money(Math.abs(cents) / 100)} ${cents < 0 ? "over" : "under"}`;
  return `${cents > 0 ? "+" : ""}${money(cents / 100)}`;
}

// How many months of the budget's own year have gone by on `today` (a civil
// date): a fiscal year that began in July is four months in at the end of
// October, not ten. A year not begun is 0, a finished one 12.
export function budgetMonthsElapsed(periodStart, periodEnd, today) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? { y: +m[1], m: +m[2] } : null; };
  const a = p(periodStart), b = p(periodEnd), t = p(today);
  if (!a || !b || !t) return 0;
  const idx = x => x.y * 12 + x.m;
  if (idx(t) < idx(a)) return 0;
  if (idx(t) > idx(b)) return 12;
  return Math.min(12, idx(t) - idx(a) + 1);
}
