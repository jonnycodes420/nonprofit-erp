// tests/lib/ledger3Checks.js · LEDGER-3. THE FUNDS PASS OF THE TRUTH CHECK.
//
// For every fund Finance lists (/finance/funds-detail):
//   · "Received this fiscal year (gifts)" = Reports' Gifts by fund row for the
//     same days = the rows that figure opens, to the cent;
//   · "Waiting to post" = the rows that figure opens;
// and for the org: the waiting gifts by fund (plus any with no fund and no
// default to wait on) = Finance's Waiting to post = what Post to the books
// lists (its deposits plus the undated gifts that cannot post).
"use strict";

async function ledger3Checks({ get, agree, skip }) {
  if (skip && skip.has("funds")) return;
  const fd = await get("/finance/funds-detail").catch(() => null);
  if (!fd || !Array.isArray(fd.funds)) return;
  const funds = fd.funds.filter(f => f.received && f.waiting);
  if (!funds.length) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const p = funds[0].received.source.params;
  const byFund = await get(`/reports/by-group?groupBy=funds&from=${p.from}&to=${p.to}`).catch(() => null);
  const rows = (byFund && byFund.rows) || [];
  let waitingSum = 0;
  for (const f of funds) {
    const rp = f.received.source.params;
    const row = rows.find(r => r.source && r.source.params && r.source.params.fund === f.id);
    const open = await get(`/figures/gifts/rows?from=${rp.from}&to=${rp.to}&fund=${encodeURIComponent(f.id)}&pageSize=1`).catch(() => null);
    agree(`ledger3 fund ${f.name}: received this fiscal year`, [["Finance's fund card", f.received.cents],
      ["Reports' Gifts by fund row", row ? cents(row.total) : (rows.some(r => r.name === f.name) ? undefined : 0)],
      ["the figure's rows", open ? cents(open.value) : undefined]], money);
    const w = await get(`/figures/ledger-status/rows?status=waiting&fund=${encodeURIComponent(f.id)}&pageSize=1`).catch(() => null);
    agree(`ledger3 fund ${f.name}: waiting to post`, [["Finance's fund card", f.waiting.cents], ["the figure's rows", w ? cents(w.value) : undefined]], money);
    waitingSum += f.waiting.cents;
  }
  const sum = await get("/finance/summary").catch(() => null);
  const lp = await get("/finance/ledger-post").catch(() => null);
  const ls = sum && sum.ledgerStatus && sum.ledgerStatus.waiting;
  if (ls && fd.defaultFundId) agree("ledger3 waiting to post, every fund", [["Finance's Waiting to post", Number(ls.cents)], ["the funds' waiting, added up", waitingSum]], money);
  if (ls && lp && !lp.postingOff) agree("ledger3 waiting to post, Post to the books", [["Finance's Waiting to post", Number(ls.cents)],
    ["Post to the books (deposits + undated)", Number(lp.waiting.cents) + Number(lp.undated.cents)]], money);
}

module.exports = { ledger3Checks };
