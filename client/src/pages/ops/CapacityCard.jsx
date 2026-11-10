// SCALE-3 · THE CAPACITY CARD on /ops's Machine tab. Pure: it draws
// GET /ops's `capacity` (server/perf/capacity.js summarize) and fetches nothing.
// Each line is green, amber or red against the threshold written beside it,
// and the sentence at the top says what to do. Red is a word on an ink pill,
// not a red colour (the four-colour rule); amber is brass, green is emerald.

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const card = { background: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18, border: "1px solid rgba(15,26,18,0.08)" };
const h2 = { fontSize: 17, fontWeight: 700, margin: "0 0 4px" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 12px" };
const cell = { padding: "6px 10px 6px 0", fontSize: 13, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const PILL = { green: [EMERALD, WHITE], amber: [BRASS, INK], red: [INK, WHITE] };
const pill = c => ({ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600,
  background: (PILL[c] || [CREAM])[0], color: (PILL[c] || [CREAM, INK])[1], whiteSpace: "nowrap" });

const shown = (v, unit) => (v == null ? "no samples" : typeof v === "string" ? v : `${v}${unit === "%" || unit === "% of the pool" ? "%" : unit ? ` ${unit}` : ""}`);
function Value({ v, unit, colour, testid }) {
  return <span data-testid={testid}>{colour ? <span style={pill(colour)}>{colour}</span> : null} {shown(v, unit)}</span>;
}

export default function CapacityCard({ c }) {
  if (!c) return null;
  return <section style={card} data-testid="ops-capacity">
    <h2 style={h2}>Capacity</h2>
    <p data-testid="ops-capacity-advice" style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px", color: INK }}>{c.sentence}</p>
    <p style={says}>{c.definition} The replica and worker steps are in docs/needs-jonathan/SCALE-3.md; do them only when this sentence says so.</p>
    <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
      <tr><td style={cell} /><td style={{ ...cell, fontWeight: 600 }}>Last 24 hours</td><td style={{ ...cell, fontWeight: 600 }}>Last 7 days</td>
        <td style={{ ...cell, fontWeight: 600 }}>Threshold</td></tr>
      {c.lines.map((l, i) => <tr key={l.key + i} data-testid={`ops-capacity-${l.key}`}>
        <td style={{ ...cell, fontWeight: 600, width: 260 }}>{l.label}</td>
        <td style={cell} colSpan={l.key === "load" ? 2 : 1}><Value v={l.day} unit={l.unit} colour={l.dayColour} testid={`ops-capacity-${l.key}-day`} /></td>
        {l.key === "load" ? null : <td style={cell}><Value v={l.week} unit={l.unit} colour={l.weekColour} testid={`ops-capacity-${l.key}-week`} /></td>}
        <td style={{ ...cell, opacity: 0.7 }}>{l.threshold}{l.unit && l.key !== "load" ? (l.unit === "%" || l.unit === "% of the pool" ? "%" : ` ${l.unit}`) : ""}</td>
      </tr>)}
    </tbody></table>
  </section>;
}
