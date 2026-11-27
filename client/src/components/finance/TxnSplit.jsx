// components/finance/TxnSplit.jsx · FLOWS-11 (W-1114-Finance-05X). A SPLIT GIFT IN TRANSACTIONS.
//
// /finance/transactions answers one line per fund (server/finance/ledgerLines.js, the cut Fund
// Balances reads). A split gift's lines sit under one line for the gift; a fund filter shows only
// that fund's part. Under a fund filter, one line says what the lines net and the fund's balance.
import { useState, useEffect } from "react";
import { T, fmtFull } from "../shared";
import { displayDate } from "../../../../shared/displayDate";
import { apiFetch } from "../../api";

// [{ head, t, lines } | { t, line }] in the order the table draws them.
export function groupTxns(sortedTxns) {
  const byId = new Map(), seen = new Set(), out = [];
  for (const t of sortedTxns) (byId.get(t.id) || byId.set(t.id, []).get(t.id)).push(t);
  for (const t of sortedTxns) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const split = Number(t.split_lines) > 1, lines = byId.get(t.id);
    if (split) out.push({ head: true, t, lines });
    for (const l of lines) out.push({ t: l, line: split });
  }
  return out;
}

export function SplitGiftRow({ v, onDelete }) {
  const t = v.t;
  return (
    <tr data-testid="txn-split-gift" data-gift-id={t.gift_id || ""} style={{ borderTop: "1px solid " + T.bg3, background: T.white }}>
      <td style={{ padding: "10px 14px", color: T.ink3, whiteSpace: "nowrap" }}>{displayDate(t.date)}</td>
      <td style={{ padding: "10px 14px", fontWeight: 700, color: T.ink3, whiteSpace: "nowrap", textAlign: "right" }}>{fmtFull(parseFloat(t.row_amount))}</td>
      <td colSpan={3} style={{ padding: "10px 14px" }}>
        <span style={{ fontWeight: 600, color: T.ink }}>{t.description}</span>
        <span style={{ fontSize: 11, color: T.ink3, marginLeft: 8 }}>
          One gift, split across {t.split_lines} funds{v.lines.length < Number(t.split_lines) ? `. Showing the ${v.lines.map(l => l.fund_name).join(", ")} part.` : ":"}
        </span>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3, fontSize: 14 }}>×</button>
      </td>
    </tr>
  );
}

export function FundFootRow({ fund, txns, year }) {
  // NUMBERS-10 item 1 (W-1122-Finance-F7): the balance and the covered-fee words are the fund card's own
  // (/finance/funds-detail, shared/numbers/fundCard.js), so the list, the card and its dialog are one figure.
  const [card, setCard] = useState(null);
  const id = fund && fund.id;
  useEffect(() => {
    let alive = true;
    setCard(null);
    if (id) apiFetch("/finance/funds-detail").then(r => { if (alive) setCard((r.funds || []).find(f => f.id === id) || null); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  if (!fund) return null;
  // NUMBERS-8: the balance's own rule, income less expense (a row of another type is in no balance).
  const netCents = txns.reduce((s, t) => s + (t.type === "income" ? 1 : t.type === "expense" ? -1 : 0) * Math.round(parseFloat(t.amount) * 100), 0);
  const balance = card ? card.balance : fund.balance;
  const same = year === "all" && card && netCents === card.balanceCents;
  return (
    <tr data-testid="txn-fund-foot">
      <td colSpan={6} style={{ padding: "8px 14px", fontSize: 12, color: T.ink3 }}>
        {fund.name}: these lines net {fmtFull(netCents / 100)}{year === "all" ? "" : ` in ${year}`}. Its balance, every year, is {fmtFull(balance)}{same ? ", the same figure as its card." : "."}{year === "all" ? "" : " Choose All years to see every line behind it."}
        {card && card.feeWords ? <span data-testid="txn-fund-fees">{card.feeWords}</span> : null}
      </td>
    </tr>
  );
}
