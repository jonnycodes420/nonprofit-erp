// shared/pledgeWords.js · FIX-55 item 4. One sentence for pledge money, for
// the import preview and receipt (shared/sheetRead.js, routes/sheetImport.js),
// the donor profile and Fundraising.
//
// PLEDGE MONEY SAYS WHICH NUMBER IT IS. A multi-year pledge is never
// one bare number: this year's installments still to come, then the whole open
// total and how many years it runs. "$78,950 due this year · $104,050 over 3
// years". When everything open falls due this year, the one number says so.
// The preview, the receipt, the profile and Fundraising all read this.
export function pledgeMoneyWords({ dueThisYearCents = 0, openCents = 0, years = 1 } = {}, fmt = defaultFmt) {
  const due = `${fmt(dueThisYearCents || 0)} due this year`;
  if ((openCents || 0) <= (dueThisYearCents || 0)) return due;
  return `${due} · ${fmt(openCents)} ${years > 1 ? `over ${years} years` : "open in all"}`;
}

function defaultFmt(c) {
  return (c < 0 ? "-$" : "$") + (Math.abs(Math.round(c)) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
