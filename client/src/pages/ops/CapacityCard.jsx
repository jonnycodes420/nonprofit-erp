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
function Value({ v, unit, colour, testid, who }) {
  return <span data-testid={testid}>{colour ? <span style={pill(colour)}>{colour}</span> : null} {shown(v, unit)}{who ? <span style={{ opacity: 0.7 }}> ({who})</span> : null}</span>;
}

// SCALE-4: who held the database's connections, top 8 over the last 24 hours.
function Holders({ h }) {
  if (!h) return null;
  return <div data-testid="ops-capacity-holders" style={{ marginTop: 16 }}>
    <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Who held the database (last 24 hours)</h3>
    <p style={says}>{h.definition}</p>
    {!h.top.length ? <p style={says}>No holders recorded yet: each process writes its own with every sample.</p>
      : <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        <tr><td style={{ ...cell, fontWeight: 600 }}>Holder</td><td style={{ ...cell, fontWeight: 600 }}>Connection-seconds</td>
          <td style={{ ...cell, fontWeight: 600 }}>Share</td><td style={{ ...cell, fontWeight: 600 }}>Most at once</td><td style={{ ...cell, fontWeight: 600 }}>Where</td></tr>
        {h.top.map(r => <tr key={r.holder} data-testid="ops-capacity-holder">
          <td style={{ ...cell, fontFamily: "ui-monospace, monospace" }}>{r.holder}</td>
          <td style={cell}>{r.seconds.toLocaleString("en-US")}</td><td style={cell}>{r.sharePct}%</td>
          <td style={cell}>{r.peak}</td><td style={{ ...cell, opacity: 0.7 }}>{r.where}</td></tr>)}
      </tbody></table>}
  </div>;
}

export default function CapacityCard({ c }) {
  if (!c) return null;
  return <section style={card} data-testid="ops-capacity">
    <h2 style={h2}>Capacity</h2>
    <p data-testid="ops-capacity-advice" style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px", color: INK }}>{c.sentence}</p>
    <p style={says}>{c.definition} The replica and worker steps are in docs/needs-jonathan/SCALE-3.md, and what a replica needs first in SCALE-4.md; do them only when this sentence says so.</p>
    {c.budget ? <p data-testid="ops-capacity-budget" style={{ ...says, opacity: 0.85 }}>{c.budget.sentence}</p> : null}
    <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
      <tr><td style={cell} /><td style={{ ...cell, fontWeight: 600 }}>Last 24 hours</td><td style={{ ...cell, fontWeight: 600 }}>Last 7 days</td>
        <td style={{ ...cell, fontWeight: 600 }}>Threshold</td></tr>
      {c.lines.map((l, i) => <tr key={l.key + i} data-testid={`ops-capacity-${l.key}`}>
        <td style={{ ...cell, fontWeight: 600, width: 260 }}>{l.label}</td>
        <td style={cell} colSpan={l.key === "load" ? 2 : 1}>{l.folded ? <span style={{ opacity: 0.7 }}>not running</span> : <Value v={l.day} unit={l.unit} colour={l.dayColour} who={l.dayWho} testid={`ops-capacity-${l.key}-day`} />}</td>
        {l.key === "load" ? null : <td style={cell}><Value v={l.week} unit={l.unit} colour={l.weekColour} who={l.weekWho} testid={`ops-capacity-${l.key}-week`} /></td>}
        <td style={{ ...cell, opacity: 0.7 }}>{l.threshold}{l.unit && l.key !== "load" ? (l.unit === "%" || l.unit === "% of the pool" ? "%" : ` ${l.unit}`) : ""}</td>
      </tr>)}
    </tbody></table>
    <Holders h={c.holders} />
  </section>;
}
