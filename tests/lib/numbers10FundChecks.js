// tests/lib/numbers10FundChecks.js · NUMBERS-10 item 1 (W-1122-Finance-F7, fifth night). ONE FUND TOTAL.
//
// The fund card, the dialog it opens, the transactions list (every year, filtered to the fund) and
// Finance's fund balances must give one balance and one "in", to the cent, because they read one
// helper (shared/numbers/fundCard.js fundLedger; the list's lines are its LEDGER_FUND_ROWS). Covered
// card fees: the figure says they are in, and how much (ground truth from the rows: a gift's row posted
// at the charge carries the gift's cover_fee_amount); a row posted before the fee leaves its fee out of
// "transactions in", and the card then shows that fee line beside it.
"use strict";

async function numbers10FundChecks({ orgId, get, q, agree, skip }) {
  if (skip && skip.has("numbers10fund")) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const fd = await get("/finance/funds-detail").catch(() => null);
  if (!fd || !(fd.funds || []).length) return;
  const sum = await get("/finance/summary").catch(() => null);
  const list = await get("/finance/transactions?year=all").catch(() => null);
  // Ground truth, from the rows: covered fees inside each fund's income rows, and those left out.
  const truth = await q(
    `SELECT ft.fund_id,
            COALESCE(SUM(CASE WHEN ROUND(ft.amount*100) = ROUND(g.amount*100) THEN ROUND(g.cover_fee_amount*100) ELSE 0 END),0)::bigint AS fees_in,
            COALESCE(SUM(CASE WHEN ROUND(g.amount*100) - ROUND(ft.amount*100) = ROUND(g.cover_fee_amount*100) THEN ROUND(g.cover_fee_amount*100) ELSE 0 END),0)::bigint AS fees_out
       FROM fin_transactions ft JOIN gifts g ON g.id = ft.gift_id AND g.org_id = ft.org_id
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
      WHERE ft.org_id = $1 AND ft.type = 'income' AND COALESCE(g.cover_fee_amount,0) > 0
        AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)
      GROUP BY 1`, [orgId]).catch(() => []);
  const T = new Map(truth.map(r => [r.fund_id, { in: Number(r.fees_in), out: Number(r.fees_out) }]));
  for (const f of fd.funds) {
    const d = await get(`/finance/funds-detail/rows?fund=${encodeURIComponent(f.id)}`).catch(() => null);
    const lines = Array.isArray(list) ? list.filter(t => t.fund_id === f.id) : null;
    const lineIn = lines ? lines.filter(t => t.type === "income").reduce((s, t) => s + cents(t.amount), 0) : undefined;
    const lineNet = lines ? lines.reduce((s, t) => s + (t.type === "income" ? 1 : t.type === "expense" ? -1 : 0) * cents(t.amount), 0) : undefined;
    const sb = sum && (sum.fundBalances || []).find(x => x.id === f.id);
    agree(`numbers10 fund ${f.name}: balance`, [["the fund card", f.balanceCents], ["its dialog", d ? d.balanceCents : undefined],
      ["Transactions, every year, filtered to the fund", lineNet], ["Finance's fund balances", sb ? cents(sb.balance) : undefined]], money);
    agree(`numbers10 fund ${f.name}: transactions in`, [["the fund card", f.inCents], ["its dialog", d ? d.inCents : undefined], ["Transactions' income lines", lineIn]], money);
    const t = T.get(f.id) || { in: 0, out: 0 };
    agree(`numbers10 fund ${f.name}: card fees donors covered, inside "in"`, [["the rows", t.in], ["the fund card", f.feesInCents], ["its dialog", d ? d.feesInCents : undefined]], money);
    const said = String(f.feeWords || "");
    const words = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const feeLine = ((f.gapLines || []).find(l => l.kind === "fee") || { cents: 0 }).cents;
    agree(`numbers10 fund ${f.name}: covered fees left out of "in" (a row posted before the fee)`, [["the rows", t.out], ["the card's fee line", feeLine]], money);
    agree(`numbers10 fund ${f.name}: the card says whether covered fees are in`,
      [["the rows", `in:${t.in ? words(t.in) : "-"} out:${t.out ? words(t.out) : "-"}`],
       ["the card's words", `in:${t.in && said.includes(`are in: ${words(t.in)} of`) ? words(t.in) : (/are in:/.test(said) ? "other" : "-")} out:${t.out && said.includes(`${words(t.out)} of card fees`) ? words(t.out) : (/is not in it/.test(said) ? "other" : "-")}`]], String);
    if (d) agree(`numbers10 fund ${f.name}: the card's and the dialog's fee words`, [["the fund card", said], ["its dialog", String(d.feeWords || "")]], String);
  }
}

module.exports = { numbers10FundChecks };
