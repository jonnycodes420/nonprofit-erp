// IMPORT-10 · "NOT READ, CHECK THESE" (shared/totalRows.js).
// A row that looks like a total ("Total", "Subtotal - October") but whose
// amount is not what the rows above it add up to is never dropped quietly:
// it is listed here, each with Include, and counted in the headline. Include
// reads it as an ordinary row (answers.includeRows); Leave it out undoes that.
import { T } from "../shared";

const box = { background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 9, padding: "4px 10px",
  fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const money = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

export function TotalChecks({ u, answers, setAnswers, disabled }) {
  const checks = (u && u.totalChecks) || [];
  const included = answers.includeRows || [];
  if (!checks.length && !included.length) return null;
  const toggle = key => setAnswers(a => {
    const cur = new Set(a.includeRows || []);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    return { ...a, includeRows: [...cur] };
  });
  const where = k => { const [sheet, line] = [k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1)]; return `Row ${line}${sheet !== "Sheet1" ? ` of ${sheet}` : ""}`; };
  return (
    <div style={box} data-testid="sheet-total-checks">
      {checks.length > 0 && <>
        <div style={h3}>Not read, check these</div>
        <div style={small}>{checks.length === 1 ? "This row looks" : "These rows look"} like a total, but the amount is not what the rows above add up to. Include a row if it is a gift.</div>
        {checks.map(c => (
          <div key={c.key} data-testid="sheet-total-check" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg2, padding: "6px 0", fontSize: 13 }}>
            <span style={{ flex: "1 1 240px", overflowWrap: "anywhere" }}>
              {where(c.key)}: "{c.label}", {money(c.statedCents)} for "{c.column}". The rows above it add up to {money(c.sumCents)}.
              <span style={{ ...small, display: "block" }}>{c.cells.join(" · ")}</span>
            </span>
            <button type="button" data-testid="sheet-total-include" disabled={disabled} style={btn} onClick={() => toggle(c.key)}>Include</button>
          </div>
        ))}
      </>}
      {included.map(k => (
        <div key={k} data-testid="sheet-total-included" style={{ ...small, color: T.ink, display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <span>{where(k)}: you included it, so it is read as an ordinary row.</span>
          <button type="button" disabled={disabled} style={btn} onClick={() => toggle(k)}>Leave it out</button>
        </div>
      ))}
    </div>
  );
}
