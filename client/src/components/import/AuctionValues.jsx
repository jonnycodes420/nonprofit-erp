// ASKS-1 item 3 · AN AUCTION SHEET'S VALUES (shared/auctionSheet.js).
// The reader asks "What were these items worth?" when the file gives no value
// for an item, and holds Import until each has one, or she says $0. With the
// values in hand, the preview says what the purchases come to: paid, value
// received, deductible, each the sum of the rows below it.
import { useEffect, useState } from "react";
import { T } from "../shared";
import { auctionItemKey, auctionLine } from "../../../../shared/auctionSheet";

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = on => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: on ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "6px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });

export function AuctionValues({ u, answers, setAnswers, disabled }) {
  const q = u ? u.questions.find(x => x.id === "auctionValue") : null;
  const sold = u ? (u.gifts || []).filter(g => g.auction) : [];
  const [typed, setTyped] = useState(() => ({ ...(answers.itemValues || {}) }));
  useEffect(() => { setTyped(t => ({ ...(answers.itemValues || {}), ...t })); }, [answers.itemValues]);
  if (!sold.length) return null;
  const valued = sold.filter(g => g.auction.fmvCents != null);
  const paid = valued.reduce((a, g) => a + g.cents, 0);
  const value = valued.reduce((a, g) => a + g.auction.fmvCents, 0);
  const deductible = valued.reduce((a, g) => a + Math.max(0, g.cents - g.auction.fmvCents), 0);   // each row's, added up
  const choose = v => setAnswers(a => ({ ...a, auctionValue: v }));
  const keep = () => setAnswers(a => ({ ...a, itemValues: { ...typed } }));
  return (
    <div style={{ ...box, borderColor: q && q.missing ? T.gold500 : T.bg3 }} data-testid="sheet-auction">
      <div style={h3}>{sold.length === 1 ? "1 auction purchase" : `${sold.length.toLocaleString("en-US")} auction purchases`}</div>
      <div style={small}>Each is a gift of what was paid. Only the part over the item's value is deductible, and each receipt says so.</div>
      {q && (
        <div style={{ borderTop: "1px solid " + T.bg2, marginTop: 8, paddingTop: 8 }} data-testid="sheet-auction-question">
          <div style={{ fontSize: 13, fontWeight: 700 }}>{q.text}</div>
          <div style={small}>{q.hint}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {q.options.map(o => (
              <button type="button" key={o.key} data-testid={`sheet-auction-${o.key}`} aria-pressed={q.answer === o.key} disabled={disabled}
                style={btn(q.answer === o.key)} onClick={() => choose(o.key)}>{o.label}</button>
            ))}
          </div>
          {q.answer === "enter" && (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {q.items.map(x => (
                <label key={x.key} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                  <span style={{ flex: "1 1 200px", minWidth: 0 }}>{x.item}<span style={small}> · row {x.line}, {x.who}</span></span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>$
                    <input inputMode="decimal" data-testid="sheet-auction-value" aria-label={`What ${x.item} was worth`} disabled={disabled}
                      value={typed[auctionItemKey(x.item)] ?? ""} onBlur={keep}
                      onKeyDown={e => { if (e.key === "Enter") keep(); }}
                      onChange={e => setTyped(t => ({ ...t, [auctionItemKey(x.item)]: e.target.value }))}
                      style={{ width: 100, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px", fontFamily: "inherit", fontSize: 13 }} />
                  </span>
                </label>
              ))}
              {q.missing > 0 && <div style={small}>{q.missing === 1 ? "1 purchase still needs" : `${q.missing} purchases still need`} a value. Import waits for it.</div>}
            </div>
          )}
        </div>
      )}
      {valued.length > 0 && (!q || !q.missing) && (
        <div style={{ fontSize: 13, marginTop: 8 }} data-testid="sheet-auction-total">{auctionLine(paid, value, deductible)}.</div>
      )}
    </div>
  );
}
