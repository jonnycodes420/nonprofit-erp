// SameAsLast.jsx · QUICKADD-1. THE DATE, METHOD AND FUND CARRIED FROM THE LAST GIFT.
//
// One chip per carried value, "Same as last: Nov 9", each cleared with ×
// (clearing puts the field back to its own default). The campaign, appeal and
// fundraiser carry their chips inside their own fields (AttributionField).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { displayDate } from "../../../../shared/displayDate";
import { stickyWord } from "../../lib/stickyGift";

const ORDER = [["date", "Date"], ["method", "Method"], ["fund", "Fund"]];

export default function SameAsLast({ carried, onClear, testid }) {
  const [funds, setFunds] = useState([]);
  const wantFund = !!(carried && carried.fund);
  useEffect(() => { if (wantFund) apiFetch("/finance/funds").then(r => setFunds(Array.isArray(r) ? r : [])).catch(() => setFunds([])); }, [wantFund]);
  const shown = ORDER.filter(([k]) => carried && !!carried[k]);   // false / "" / null: nothing carried
  if (!shown.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink3 }}>Same as last:</span>
      {shown.map(([k, label]) => {
        const fundName = k === "fund" ? ((funds.find(f => f.id === carried.fund.fund_id) || {}).name || "") : "";
        return (
          <span key={k} data-testid={`${testid}-${k}-same`} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 99, padding: "3px 10px", fontSize: 12, color: T.ink }}>
            <span style={{ color: T.ink3 }}>{label}</span> {stickyWord(k, carried[k], { fundName, dateWord: displayDate })}
            <button type="button" aria-label={`Clear the carried ${label.toLowerCase()}`} onClick={() => onClear(k)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: T.ink3, fontSize: 14, lineHeight: 1 }}>×</button>
          </span>);
      })}
    </div>
  );
}
