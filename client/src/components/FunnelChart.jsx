import { STAGES, T, fmt } from "./shared";

// ── Shared funnel math ───────────────────────────────────────────────────────
// Both <FunnelChart> and DonorKanban's conversion strip need "what % of
// donors in stage A made it to stage B" computed from the same real counts —
// factored out here so it's written once, not once per component.
export function computeStageConversions(counts, stages) {
  return stages.slice(0, -1).map((s, i) => {
    const next = stages[i + 1];
    const fromCount = counts[s.id]?.count || 0;
    const toCount = counts[next.id]?.count || 0;
    const pct = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : null;
    return { fromId: s.id, toId: next.id, fromLabel: s.label, toLabel: next.label, pct };
  });
}

// Proportional "how wide should this stage be" weights (0..1, floor-clamped
// so a near-empty stage never collapses to invisible/undroppable) — reused
// for the funnel's taper widths and for DonorKanban's column widths. Returns
// the weights plus the max/valueOf used to compute them, so a caller can
// weigh an out-of-band stage (e.g. Lapsed) against the same denominator.
export function computeStageWeights(counts, stages, metric = "count", floor = 0.08) {
  const valueOf = s => metric === "value" ? (counts[s.id]?.total || 0) : (counts[s.id]?.count || 0);
  const max = Math.max(1, ...stages.map(valueOf));
  const weights = {};
  stages.forEach(s => { weights[s.id] = Math.max(floor, valueOf(s) / max); });
  return { weights, max, valueOf };
}

// A real tapering funnel: each stage is a trapezoid band whose top width
// matches its own share of donors/value and whose bottom width tapers to the
// next stage's share, so bands visually "pour" toward Steward. Lapsed is
// rendered as a separate branch below — a leak out of the funnel, not the
// next step in it.
export default function FunnelChart({ counts, metric = "count", onStageClick, showLapsed = true, bandHeight = 40 }) {
  const coreStages = STAGES.filter(s => s.id !== "lapsed");
  const lapsedStage = STAGES.find(s => s.id === "lapsed");
  const { weights, max, valueOf } = computeStageWeights(counts, coreStages, metric);
  const conversions = computeStageConversions(counts, coreStages);
  const widthPct = id => Math.round(weights[id] * 100);
  const lapsedWidthPct = lapsedStage ? Math.round(Math.max(0.08, valueOf(lapsedStage) / max) * 100) : 0;

  const valueLabel = s => {
    const c = counts[s.id]?.count || 0;
    const t = counts[s.id]?.total || 0;
    return `${c} · ${t > 0 ? fmt(t) : "—"}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {coreStages.map((s, i) => {
        const topW = widthPct(s.id);
        const bottomW = i < coreStages.length - 1 ? widthPct(coreStages[i + 1].id) : topW;
        const topInset = (100 - topW) / 2;
        const bottomInset = (100 - bottomW) / 2;
        const clip = `polygon(${topInset}% 0%, ${100 - topInset}% 0%, ${100 - bottomInset}% 100%, ${bottomInset}% 100%)`;
        const conv = conversions[i];
        return (
          <div key={s.id} onClick={onStageClick ? () => onStageClick(s.id) : undefined} style={{ cursor: onStageClick ? "pointer" : "default" }}>
            {/* Label sits above the band, not inside it — a narrow taper
                (near the floor width) would otherwise clip the label text
                along with the trapezoid's clip-path. */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
              <span style={{ fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</span>
              <span style={{ color: T.ink3 }}>{valueLabel(s)}</span>
            </div>
            <div style={{ height: bandHeight, background: s.color, clipPath: clip, transition: "clip-path 0.4s ease" }} />
            {conv && (
              <div style={{ textAlign: "center", fontSize: 10, color: T.ink3, padding: "3px 0", fontWeight: 700 }}>
                {conv.pct == null ? "—" : `${conv.pct}%`} {conv.fromLabel.toLowerCase()} → {conv.toLabel.toLowerCase()}
              </div>
            )}
          </div>
        );
      })}

      {showLapsed && lapsedStage && (
        <div
          onClick={onStageClick ? () => onStageClick("lapsed") : undefined}
          style={{ marginTop: 10, paddingTop: 12, borderTop: "1px dashed " + T.bg3, cursor: onStageClick ? "pointer" : "default" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
            <span style={{ fontWeight: 800, color: lapsedStage.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>↘ Leaking Out — Lapsed</span>
            <span style={{ color: T.ink3 }}>{valueLabel(lapsedStage)}</span>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, height: 16, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${lapsedWidthPct}%`, background: lapsedStage.color, borderRadius: 6 }} />
          </div>
        </div>
      )}
    </div>
  );
}
