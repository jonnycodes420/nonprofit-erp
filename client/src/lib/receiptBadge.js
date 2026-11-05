// POLISH-5 · THE TAX RECEIPTS BADGE READS THE SWITCHES. It said "Enabled"
// whenever the legal details were saved, even with both receipt switches
// (gift receipts, year-end statements) off, so nothing was going out. Now it
// says what is actually sent. JSX-free so a suite can import it.
//   detailsOn: the org's receipts_enabled (legal name, EIN and address saved)
//   types:     the mail types (lib/mailTypes.js); null while they load
export function receiptBadge(detailsOn, types) {
  if (!detailsOn) return { on: false, words: "Not set up" };
  if (!types) return { on: false, words: "Set up" };
  const on = key => !!(types.find(t => t.key === key) || {}).on;
  const gift = on("gift_receipt"), year = on("year_end");
  if (gift && year) return { on: true, words: "On" };
  if (gift) return { on: true, words: "Gift receipts on" };
  if (year) return { on: true, words: "Year-end on" };
  return { on: false, words: "Off: both switches are off" };
}
