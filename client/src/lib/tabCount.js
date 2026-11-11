// lib/tabCount.js · FLOWS-6 (W-1109-Donors-18X). A TAB'S COUNT FOLLOWS ITS LIST.
//
// Re-engage's tab said 331 while the list under it, narrowed by the
// Directory's filters, said "No lapsed donors". A tab count now follows the
// same filters as the list: "0 of 331" when the list is filtered, or
// "331 (all)" while the filtered count is not known yet. Unfiltered, the
// count alone.
export function tabCountWords(total, shown, filtered) {
  const n = Number(total) || 0;
  if (!filtered) return n > 0 ? n.toLocaleString("en-US") : null;
  if (shown == null) return `${n.toLocaleString("en-US")} (all)`;
  return `${Number(shown).toLocaleString("en-US")} of ${n.toLocaleString("en-US")}`;
}
