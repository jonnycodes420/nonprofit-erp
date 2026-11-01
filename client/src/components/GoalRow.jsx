// client/src/components/GoalRow.jsx · PERF-2. One goal's row: raised, of the
// goal, the percent, a bar and the pace, each figure opening its rows. Drawn by
// the Fundraising dashboard (Dashboards.jsx) and by Home's calls card
// (CallsToMake.jsx), out of Dashboards.jsx so Home does not load the dashboards
// to draw it. Every number here is a <Figure> with its source (FIX-2), and the
// number census scans this file with Dashboards.jsx.
import { T } from "./shared";
import { Figure } from "./Figure";

export function GoalRow({ r, first }) {
  const goal = (r.also || []).find(a => a.key === "goal"), pct = (r.also || []).find(a => a.key === "percent");
  const bar = pct && pct.value != null ? Math.min(100, Math.max(0, pct.value)) : 0;
  return (
    <div style={{ padding: "12px 0", borderTop: first ? "none" : "1px solid " + T.bg2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{r.label}</span>
        <span style={{ fontSize: 13.5, color: T.ink }}>
          <Figure variant="cell" figureKey={"raised-" + r.label} value={r.value} kind="money" label={`Raised · ${r.label}`}
            definition="Every gift given to this goal, less any fee the donor covered, and every grant awarded toward it." source={r.source} />
          {goal && <> of <Figure variant="cell" figureKey={"goal-" + r.label} value={goal.value} kind="money" label={`${goal.label} · ${r.label}`}
            definition={goal.definition} source={goal.source} /></>}
          {pct && <> · <Figure variant="cell" figureKey={"pct-" + r.label} value={pct.value} kind="percent" label={`${pct.label} · ${r.label}`}
            definition={pct.definition} source={pct.source} /></>}
        </span>
      </div>
      <div style={{ height: 6, background: T.bg2, borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
        <div style={{ height: "100%", width: bar + "%", background: T.greenDk, borderRadius: 99 }} />
      </div>
      {r.pace && <div style={{ fontSize: 12, color: T.ink3, marginTop: 5 }}>{r.pace === "met" ? "Goal met" : r.pace === "behind" ? "Behind an even pace through the period" : "On an even pace through the period"}</div>}
    </div>
  );
}
