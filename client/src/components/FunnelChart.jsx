import { useState } from "react";
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

// Clamped Catmull-Rom → cubic Bezier conversion: for an ordered list of
// points, returns one bezier segment per consecutive pair, each shaped by
// its neighbors on both sides. This is what makes the boundary between two
// differently-sized stages read as one continuous flowing curve instead of
// a sharp straight-edge kink — it absorbs a non-monotonic bump (a middle
// stage smaller than both neighbors) gracefully instead of zigzagging.
function catmullRomSegments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    segs.push({
      p1, p2,
      cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    });
  }
  return segs;
}

// Widths are always centered on x=50, so a band's horizontal midpoint is
// always inside its own fill regardless of how narrow it tapers.
const leftX = w => (100 - w) / 2;
const rightX = w => 100 - leftX(w);

// A real tapering funnel rendered as one continuous SVG shape: every band is
// its own <path> (so each stage keeps its own fill color), but adjacent
// bands share bezier control points computed from the SAME global point
// list, so the seam between them reads as a smooth curve, not a stacked
// polygon edge — this holds even when the underlying counts aren't
// monotonically decreasing. Labels live in a column beside the shape (not
// overlaid on it) so a narrow taper never clips the text along with it.
// Lapsed is rendered as a separate branch below — a leak out of the funnel,
// not the next step in it.
export default function FunnelChart({ counts, metric = "count", onStageClick, showLapsed = true, bandHeight = 40 }) {
  const [hovered, setHovered] = useState(null);
  const coreStages = STAGES.filter(s => s.id !== "lapsed");
  const lapsedStage = STAGES.find(s => s.id === "lapsed");
  const { weights, max, valueOf } = computeStageWeights(counts, coreStages, metric);
  const pipelineShare = computeStagePipelineShare(counts, coreStages);
  const lapsedWidthPct = lapsedStage ? Math.round(Math.max(0.08, valueOf(lapsedStage) / max) * 100) : 0;

  // edgeWidths[i] is stage i's own top width%. boundaryWidths has one extra
  // entry — the bottom of the last stage repeats its own top width, since
  // there's no next stage to taper toward.
  const edgeWidths = coreStages.map(s => Math.round(weights[s.id] * 100));
  const boundaryWidths = [...edgeWidths, edgeWidths[edgeWidths.length - 1]];
  const totalHeight = coreStages.length * bandHeight;

  const leftPts = boundaryWidths.map((w, i) => ({ x: leftX(w), y: i * bandHeight }));
  const rightPts = boundaryWidths.map((w, i) => ({ x: rightX(w), y: i * bandHeight }));
  const leftSegs = catmullRomSegments(leftPts);
  const rightSegs = catmullRomSegments(rightPts);

  const baseLabel = s => {
    const c = counts[s.id]?.count || 0;
    const t = counts[s.id]?.total || 0;
    return `${c} · ${t > 0 ? fmt(t) : "—"}`;
  };
  const valueLabel = s => `${baseLabel(s)} · ${pipelineShare[s.id]}% of pipeline`;

  const setHover = id => onStageClick ? () => setHovered(id) : undefined;
  const clearHover = () => setHovered(null);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "stretch", gap: 18 }}>
        <svg
          width="100%" height={totalHeight} viewBox={`0 0 100 ${totalHeight}`} preserveAspectRatio="none"
          style={{ flex: "1 1 auto", minWidth: 140, display: "block", overflow: "visible" }}
        >
          {coreStages.map((s, i) => {
            const ls = leftSegs[i], rs = rightSegs[i];
            const d = `M ${ls.p1.x} ${ls.p1.y} C ${ls.cp1.x} ${ls.cp1.y}, ${ls.cp2.x} ${ls.cp2.y}, ${ls.p2.x} ${ls.p2.y} L ${rs.p2.x} ${rs.p2.y} C ${rs.cp2.x} ${rs.cp2.y}, ${rs.cp1.x} ${rs.cp1.y}, ${rs.p1.x} ${rs.p1.y} Z`;
            const isHover = hovered === s.id;
            const midY = (ls.p1.y + ls.p2.y) / 2;
            return (
              <g
                key={s.id}
                onMouseEnter={setHover(s.id)}
                onMouseLeave={onStageClick ? clearHover : undefined}
                onClick={onStageClick ? () => onStageClick(s.id) : undefined}
                style={{ cursor: onStageClick ? "pointer" : "default" }}
              >
                <path d={d} fill={s.color} opacity={isHover ? 1 : 0.88} style={{ transition: "opacity 0.15s ease" }} />
                {isHover && <path d={d} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.5} />}
                {onStageClick && (
                  <text x={50} y={midY + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff"
                    opacity={isHover ? 0.95 : 0} style={{ transition: "opacity 0.15s ease", pointerEvents: "none" }}>
                    ›
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div style={{ display: "flex", flexDirection: "column", flex: "0 0 180px", minWidth: 150 }}>
          {coreStages.map(s => (
            <div
              key={s.id}
              onClick={onStageClick ? () => onStageClick(s.id) : undefined}
              onMouseEnter={setHover(s.id)}
              onMouseLeave={onStageClick ? clearHover : undefined}
              style={{
                height: bandHeight, display: "flex", flexDirection: "column", justifyContent: "center",
                cursor: onStageClick ? "pointer" : "default", borderRadius: 6, padding: "0 8px", margin: "0 -8px",
                background: hovered === s.id ? s.color + "14" : "transparent", transition: "background 0.15s ease",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {s.label}
              </span>
              <span style={{ fontSize: 11, color: T.ink3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {valueLabel(s)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {showLapsed && lapsedStage && (
        <div
          onClick={onStageClick ? () => onStageClick("lapsed") : undefined}
          onMouseEnter={setHover("lapsed")}
          onMouseLeave={onStageClick ? clearHover : undefined}
          style={{
            marginTop: 10, paddingTop: 12, borderTop: "1px dashed " + T.bg3,
            cursor: onStageClick ? "pointer" : "default", borderRadius: 8,
            background: hovered === "lapsed" ? lapsedStage.color + "0d" : "transparent", transition: "background 0.15s ease",
            padding: "12px 6px 6px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
            <span style={{ fontWeight: 800, color: lapsedStage.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>↘ Leaking Out — Lapsed</span>
            <span style={{ color: T.ink3 }}>{baseLabel(lapsedStage)}</span>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, height: 16, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${lapsedWidthPct}%`, background: lapsedStage.color, borderRadius: 6, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}
