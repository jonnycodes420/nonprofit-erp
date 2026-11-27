// shared/numbers/fundCard.js · NUMBERS-8 item 1. A FUND'S CARD AND ITS DIALOG ARE ONE NUMBER.
//
// The fleet (W-1122-Finance-F7) read General Operating's card at "$5,936,090.34 in 3,483 gifts
// not on the books yet" and its dialog at "2000 gifts name this fund ... 1,351 waiting": the
// dialog counted the first 2,000 rows it listed (a LIMIT) and only the gifts that NAME the fund,
// while the card counted every waiting gift, including those with no fund, which post to the
// default fund. Two queries, two answers. This is the one function both read:
//
//   balance        the books: income less expense rows on this fund, every year (fundLines.js
//                  LEDGER_FUND_ROWS, a split gift by its lines). `rows` is how many rows that is.
//   received       gifts to this fund dated in the fiscal year, to today (fundBooks.js).
//   gifts          every gift that lands in this fund, any year, by where it stands with the books
//                  (ledgerStatus.js): posted, waiting, history. A gift that names no fund lands in
//                  the default fund, as it posts there; `noFundIn` says how many of them that is.
//                  `waiting` is the card's "not on the books yet", to the cent.
//
// A ledger row of any other type (neither income nor expense) is in no balance; it is counted in
// `otherRows` so a screen can say so rather than sign it.
//
// NUMBERS-10 item 1 (W-1122-Finance-F7, fifth night). THIS IS THE FUND TOTAL, AND THE ONLY ONE. The card,
// the dialog it opens, the transactions list's fund footer and Finance's fund balances all read
// `fundLedger` below (the transactions list's lines are the same LEDGER_FUND_ROWS, so they net to it).
// Every figure here counts a gift at what the donor was CHARGED: card fees donors covered are in
// (`feesInCents` says how much of "in" they are). A gift whose ledger row was posted before the fee
// leaves its fee out of "transactions in", and that figure then carries the fee line beside it (gap.fee,
// fundGap.js). Staging's Harborlight had four such rows from the demo seed; scripts/ops/numbers10-fee-rows.js
// moves them to the charge, and then gifts on the books and transactions in agree to the cent.
"use strict";
const { MONEY, LIVE } = require("./money");
const { COUNTED } = require("./giftCount");
const { GIFT_FUND_ROWS, LEDGER_FUND_ROWS } = require("./fundLines");
const LS = require("./ledgerStatus");
const { fundBooks } = require("./fundBooks");
const FG = require("./fundGap");   // NUMBERS-9 item 1: why gifts on the books and transactions in differ

const SENTENCES = {
  balance: "The books: every income row on this fund less every expense row, in every year. A gift's row counts what the donor was charged, so card fees donors covered are in. The dialog and Transactions list those same rows.",
  gap: FG.SENTENCE,
  gifts: "Every gift that lands in this fund, in any year, by where it stands with the books, at what the donor was charged (card fees donors covered are in). A gift that names no fund lands in the default fund, because that is where it posts.",
};

const EMPTY = () => ({
  balanceCents: 0, inCents: 0, outCents: 0, rows: 0, otherRows: 0, inPeriodCents: 0, outPeriodCents: 0, feesInCents: 0,
  receivedCents: 0, receivedCount: 0,
  gifts: { posted: { n: 0, cents: 0 }, waiting: { n: 0, cents: 0 }, history: { n: 0, cents: 0 }, total: { n: 0, cents: 0 }, noFundIn: 0 },
});

// THE LEDGER BY FUND, the one SQL every fund total reads. Map fundId -> { inCents, outCents,
// balanceCents, rows, otherRows, inPeriodCents, outPeriodCents, feesInCents }. `feesInCents`: the card fees
// donors covered inside "in" (a gift's row posted at the charge carries its gift's cover_fee_amount; a
// split gift's cut row carries its share). `month` may be omitted (period figures are then 0).
async function fundLedger(query, orgId, { month = null, fundId = null } = {}) {
  const one = fundId ? " AND f.id = ?" : "";
  const m = month || { from: "9999-12-31", to: "0001-01-01" };
  const rows = await query(
    `SELECT f.id AS fund_id,
            COALESCE(SUM(CASE WHEN ft.type='income'  THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS in_all,
            COALESCE(SUM(CASE WHEN ft.type='expense' THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS out_all,
            COALESCE(SUM(CASE WHEN ft.type='income'  AND ft.date >= ? AND ft.date <= ? THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS in_period,
            COALESCE(SUM(CASE WHEN ft.type='expense' AND ft.date >= ? AND ft.date <= ? THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS out_period,
            COUNT(ft.id) FILTER (WHERE ft.type IN ('income','expense'))::int AS n,
            COUNT(ft.id) FILTER (WHERE ft.type NOT IN ('income','expense'))::int AS other,
            COALESCE(SUM(CASE WHEN ft.type='income' AND fg.cover_fee_amount > 0 AND ROUND(fr.amount*100) = ROUND(fg.amount*100)
                              THEN ROUND(ROUND(fg.cover_fee_amount*100) * ft.amount / NULLIF(fr.amount, 0)) ELSE 0 END),0)::bigint AS fees_in
       FROM fin_funds f
       LEFT JOIN ${LEDGER_FUND_ROWS()} ft ON ft.fund_id = f.id AND ft.org_id = f.org_id
       LEFT JOIN fin_transactions fr ON fr.id = ft.id AND fr.org_id = ft.org_id
       LEFT JOIN gifts fg ON fg.id = ft.gift_id AND fg.org_id = ft.org_id
      WHERE f.org_id = ?${one}
      GROUP BY f.id`,
    [m.from, m.to, m.from, m.to, orgId, orgId, orgId, ...(fundId ? [fundId] : [])]);
  const out = new Map();
  for (const r of rows) {
    const inCents = Number(r.in_all), outCents = Number(r.out_all);
    out.set(r.fund_id, { inCents, outCents, balanceCents: inCents - outCents, inPeriodCents: Number(r.in_period), outPeriodCents: Number(r.out_period),
      rows: Number(r.n), otherRows: Number(r.other), feesInCents: Number(r.fees_in) });
  }
  return out;
}

// Map fundId -> the fund's figures above (every fund of the org, or only `fundId`). `.noFund` is
// this fiscal year's gifts that name no fund (fundBooks.js).
async function fundCard(query, orgId, { fyFrom, today, month, defaultId = null, fundId = null }) {
  const [ledger, gifts, books, gaps] = await Promise.all([
    fundLedger(query, orgId, { month, fundId }),
    query(
      `SELECT COALESCE(gf.fund_id, ?::text) AS fund_id, ${LS.STATUS("g")} AS status,
              COALESCE(SUM(ROUND(gf.amount * 100)), 0)::bigint AS cents,
              COUNT(*) FILTER (WHERE ${COUNTED("g")})::int AS n,
              COUNT(*) FILTER (WHERE gf.fund_id IS NULL AND ${COUNTED("g")})::int AS no_fund
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
        WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}${fundId ? " AND COALESCE(gf.fund_id, ?::text) = ?" : ""}
        GROUP BY 1, 2`,
      [defaultId, fyFrom, orgId, ...(fundId ? [defaultId, fundId] : [])]),
    fundBooks(query, orgId, { from: fyFrom, to: today, fyFrom, defaultId }),
    FG.fundGap(query, orgId, { defaultId, fundId }),
  ]);
  const out = new Map();
  const row = id => { if (!out.has(id)) out.set(id, EMPTY()); return out.get(id); };
  for (const [id, l] of ledger) Object.assign(row(id), l);
  for (const r of gifts) {
    if (!r.fund_id || (fundId && r.fund_id !== fundId)) continue;
    const g = row(r.fund_id).gifts;
    const slot = g[r.status] || g.waiting;
    slot.n += Number(r.n); slot.cents += Number(r.cents);
    g.total.n += Number(r.n); g.total.cents += Number(r.cents); g.noFundIn += Number(r.no_fund);
  }
  for (const [id, b] of books) {
    if (!out.has(id)) continue;
    Object.assign(out.get(id), { receivedCents: b.receivedCents, receivedCount: b.receivedCount });
  }
  for (const [id, g] of gaps) if (out.has(id)) out.get(id).gap = g;
  out.noFund = books.noFund;
  return out;
}

// The words for one fund's figures, the same on the card and in the dialog.
const usd = c => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const n = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;
function balanceWords(f) {
  return `${usd(f.balanceCents)} from ${n(f.rows, "transaction", "transactions")} (${usd(f.inCents)} in, ${usd(f.outCents)} out), every year.`
    + (f.otherRows ? ` ${n(f.otherRows, "row of another type is", "rows of another type are")} in no balance.` : "")
    + feeWords(f);
}
// NUMBERS-10 item 1: whether covered fees are in, said beside the figure. In: how much of "in" they are.
// Left out (a row posted before the fee): the fee line, the same words as the gap line's.
function feeWords(f) {
  const fee = f.gap && f.gap.fee && f.gap.fee.n ? f.gap.fee : null;
  const inWords = f.feesInCents ? ` Card fees donors covered are in: ${usd(f.feesInCents)} of the ${usd(f.inCents)} in.` : "";
  const outWords = fee ? ` ${usd(fee.cents)} of card fees donors covered on ${n(fee.n, "gift", "gifts")} is not in it: ${fee.n === 1 ? "that gift's row was" : "those gifts' rows were"} posted before the fee.` : "";
  return inWords + outWords;
}
function giftWords(f) {
  const g = f.gifts;
  if (!g.total.n && !g.total.cents) return "No gift lands in this fund yet.";
  const parts = [["posted", "on the books"], ["waiting", "waiting to post"], ["history", "history only"]]
    .filter(([k]) => g[k].n || g[k].cents).map(([k, w]) => `${g[k].n.toLocaleString("en-US")} ${w} (${usd(g[k].cents)})`);
  return `${n(g.total.n, "gift lands", "gifts land")} in this fund (${usd(g.total.cents)}), in every year: ${parts.join(", ")}.`
    + (g.noFundIn ? ` ${g.noFundIn === 1 ? "1 of them names no fund and posts" : `${g.noFundIn.toLocaleString("en-US")} of them name no fund and post`} here, the default fund.` : "");
}

// NUMBERS-9 item 1: the line that says why the two figures differ (fundGap.js), the same on card and dialog.
const gapWords = f => FG.gapWords(f);

module.exports = { fundCard, fundLedger, balanceWords, giftWords, gapWords, feeWords, SENTENCES };
