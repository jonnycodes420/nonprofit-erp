import { STAGES, T, fmt } from "./shared";

// ── Shared funnel math ───────────────────────────────────────────────────────
// Each stage's share of the total (non-lapsed) pipeline — an honest, always
// ≤100% number. This replaces an earlier "conversion rate" framing
// (nextStageCount / currentStageCount) that looked like a cohort conversion
// but wasn't one: donor stage is a snapshot, not a tracked historical
// transition (no time-boxed cohort data exists to support a real conversion
// rate — see computeStagePipelineShare's callers), and a downstream stage
// where donors sit long-term (Cultivate, Steward) routinely holds MORE
// donors than a faster-moving upstream stage, so that ratio routinely
// exceeded 100% on real data and was misleading, not just an edge case.
export function computeStagePipelineShare(counts, stages) {
  const total = stages.reduce((sum, s) => sum + (counts[s.id]?.count || 0), 0);
  const share = {};
  stages.forEach(s => {
    const c = counts[s.id]?.count || 0;
    share[s.id] = total > 0 ? Math.round((c / total) * 100) : 0;
  });
  return share;
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

const SHAPE_W = 88;

// A real tapering funnel: every band's bottom edge is exactly the next
// band's top edge (both come from the same precomputed `edgeWidths` array,
// not recomputed per band), and the bands are stacked with zero gap between
// them, so the stack reads as one continuous silhouette instead of
// independently-shaped triangles/diamonds per band. Labels live in a
// separate column beside the shape (not inside the clipped element) so a
// narrow taper never clips the text along with it. Lapsed is rendered as a
// separate branch below — a leak out of the funnel, not the next step in it.
export default function FunnelChart({ counts, metric = "count", onStageClick, showLapsed = true, bandHeight = 40 }) {
  const coreStages = STAGES.filter(s => s.id !== "lapsed");
  const lapsedStage = STAGES.find(s => s.id === "lapsed");
  const { weights, max, valueOf } = computeStageWeights(counts, coreStages, metric);
  const pipelineShare = computeStagePipelineShare(counts, coreStages);
  const lapsedWidthPct = lapsedStage ? Math.round(Math.max(0.08, valueOf(lapsedStage) / max) * 100) : 0;

  // One pass across the full stage list, computed before any rendering —
  // edgeWidths[i] is stage i's own width%. Band i's top = edgeWidths[i] and
  // its bottom = edgeWidths[i+1], the exact same value the next band uses as
  // its own top, so adjacent bands always share a seam instead of being
  // computed independently of their neighbor.
  const edgeWidths = coreStages.map(s => Math.round(weights[s.id] * 100));

  const baseLabel = s => {
    const c = counts[s.id]?.count || 0;
    const t = counts[s.id]?.total || 0;
    return `${c} · ${t > 0 ? fmt(t) : "—"}`;
  };
  const valueLabel = s => `${baseLabel(s)} · ${pipelineShare[s.id]}% of pipeline`;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {coreStages.map((s, i) => {
          const topW = edgeWidths[i];
          const bottomW = i < edgeWidths.length - 1 ? edgeWidths[i + 1] : topW;
          const topInset = (100 - topW) / 2;
          const bottomInset = (100 - bottomW) / 2;
          const clip = `polygon(${topInset}% 0%, ${100 - topInset}% 0%, ${100 - bottomInset}% 100%, ${bottomInset}% 100%)`;
          return (
            <div
              key={s.id}
              onClick={onStageClick ? () => onStageClick(s.id) : undefined}
              style={{ display: "flex", alignItems: "stretch", gap: 12, height: bandHeight, cursor: onStageClick ? "pointer" : "default" }}
            >
              <div style={{ width: SHAPE_W, flexShrink: 0, position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, background: s.color, clipPath: clip, transition: "clip-path 0.4s ease" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
                  {s.label}
                </span>
                <span style={{ fontSize: 11, color: T.ink3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                  {valueLabel(s)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {showLapsed && lapsedStage && (
        <div
          onClick={onStageClick ? () => onStageClick("lapsed") : undefined}
          style={{ marginTop: 10, paddingTop: 12, borderTop: "1px dashed " + T.bg3, cursor: onStageClick ? "pointer" : "default" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
            <span style={{ fontWeight: 800, color: lapsedStage.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>↘ Leaking Out — Lapsed</span>
            <span style={{ color: T.ink3 }}>{baseLabel(lapsedStage)}</span>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, height: 16, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${lapsedWidthPct}%`, background: lapsedStage.color, borderRadius: 6 }} />
          </div>
        </div>
      )}
    </div>
  );
}
