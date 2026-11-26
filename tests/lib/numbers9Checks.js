// tests/lib/numbers9Checks.js · NUMBERS-9. THE TRUTH CHECK'S PAIRS FOR THIS BUILD.
//
//   · a fund's card, the dialog it opens and Finance's Posted headline (W-1122-Finance-F7): the card's
//     and the dialog's "why the two figures differ" line are one sentence; gifts on the books less
//     transactions in = card fees covered + other gifts whose row differs - income entered by hand,
//     to the cent; each of those lines = the rows it opens; the funds' gifts on the books add up to
//     Finance's Posted (ledger-status, posted) headline.
"use strict";

async function numbers9Checks({ get, agree, skip }) {
  if (skip && skip.has("numbers9")) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const fd = await get("/finance/funds-detail").catch(() => null);
  let postedAll = 0;
  for (const f of (fd && fd.funds) || []) {
    const d = await get(`/finance/funds-detail/rows?fund=${encodeURIComponent(f.id)}`).catch(() => null);
    if (!d) continue;
    postedAll += Number(d.postedCents) || 0;
    agree(`numbers9 fund ${f.name}: the gap line`, [["the fund card", f.gapWords || ""], ["its dialog", d.gapWords || ""]], String);
    const line = k => ((d.gapLines || []).find(l => l.kind === k) || { cents: 0 }).cents;
    agree(`numbers9 fund ${f.name}: gifts on the books less transactions in`,
      [["the dialog's two figures", (Number(d.postedCents) || 0) - (Number(d.inCents) || 0)], ["its lines (fees + other - by hand)", line("fee") + line("other") - line("manual")]], money);
    for (const l of f.gapLines || []) {
      const open = await get(`/figures/fund-books-gap/rows?fund=${encodeURIComponent(f.id)}&kind=${l.kind}&pageSize=1`).catch(() => null);
      agree(`numbers9 fund ${f.name}: ${l.label}`, [["the card's line", l.cents], ["the rows it opens", open ? cents(open.value) : undefined]], money);
    }
  }
  if (fd && (fd.funds || []).length) {
    const posted = await get("/figures/ledger-status/rows?status=posted&pageSize=1").catch(() => null);
    if (posted) agree("numbers9 funds' gifts on the books = Finance's Posted", [["the fund cards, added", postedAll], ["Finance's Posted", cents(posted.value)]], money);
  }
}

module.exports = { numbers9Checks };
