// client/src/lib/attributionMatch.js · LETTERS-1 item 4, POLISH-11 item 3. ONE NAME, AND WHEN TO OFFER A NEW ONE.
// One campaign name ignores case and spacing. A typed name that only starts another ("Spring" beside a
// draft "Spring mwtwyt8w") is a suggestion, and Create is still offered: only a campaign named exactly
// what she typed takes Create away (W-1125-Finance-T1).
export const keyOf = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
export function attributionChoices(names, typed) {
  const t = keyOf(typed);
  const exact = !!t && (names || []).some(n => keyOf(n) === t);
  const close = t && !exact ? (names || []).find(n => keyOf(n).startsWith(t)) || null : null;
  return { exact, close, offerCreate: !!t && !exact };
}
