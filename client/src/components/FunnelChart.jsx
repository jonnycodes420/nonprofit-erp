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
// for the funnel's bar widths and for DonorKanban's column widths. Returns
// the weights plus the max/valueOf used to compute them, so a caller can
// weigh an out-of-band stage (e.g. Lapsed) against the same denominator.
export function computeStageWeights(counts, stages, metric = "count", floor = 0.08) {
  const valueOf = s => metric === "value" ? (counts[s.id]?.total || 0) : (counts[s.id]?.count || 0);
  const max = Math.max(1, ...stages.map(valueOf));
  const weights = {};
  stages.forEach(s => { weights[s.id] = Math.max(floor, valueOf(s) / max); });
  return { weights, max, valueOf };
}

// A structured, geometric treatment: every stage is its own clean horizontal
// bar row — consistent height, width proportional to its share, generous
// gap between rows — not a tapering silhouette. This replaced an earlier
// organic-curve version (Catmull-Rom/bezier, smoothly tapering between
// stages) that read as "wonky"/"goofy" in practice rather than the intended
// "professional." Precision and aligned rows read as professional here more
// reliably than an organic curve, and a bar-per-stage layout has no trouble
// with non-monotonic data (a middle stage smaller than both its neighbors)
// — each bar is independent, so there's no silhouette shape that has to
// visually resolve the bump. Lapsed keeps the same bar treatment (it always
// used one) but stays a separate branch below — a leak out of the funnel,
// not the next step in it.
// BUILD-76 Part 2 — `drift` ({count, amount, onClick}) renders the FEATURED
// out-flow row: drifting is the window where a call still works, so it leads;
// lapsed (the failure state, after the window closed) stays below it,
// smaller. The row renders only when count > 0 — a featured row proudly
// reading zero is the exact mistake the old lapsed row made.
export default function FunnelChart({ counts, metric = "count", onStageClick, showLapsed = true, bandHeight = 40, drift = null }) {
  const [hovered, setHovered] = useState(null);
  const coreStages = STAGES.filter(s => s.id !== "lapsed");
  const lapsedStage = STAGES.find(s => s.id === "lapsed");
  const { weights, max, valueOf } = computeStageWeights(counts, coreStages, metric);
  const pipelineShare = computeStagePipelineShare(counts, coreStages);
  const lapsedWidthPct = lapsedStage ? Math.round(Math.max(0.08, valueOf(lapsedStage) / max) * 100) : 0;

  const baseLabel = s => {
    const c = counts[s.id]?.count || 0;
    const t = counts[s.id]?.total || 0;
    return `${c} · ${t > 0 ? fmt(t) : "—"}`;
  };
  const valueLabel = s => `${baseLabel(s)} · ${pipelineShare[s.id]}% of pipeline`;

  const barHeight = Math.max(10, Math.round(bandHeight * 0.32));
  const rowGap = Math.max(8, Math.round(bandHeight * 0.34));

  const Chevron = ({ color, show }) => (
    <span style={{ color, fontWeight: 800, opacity: show ? 1 : 0, transition: "opacity 0.15s ease" }}>›</span>
  );

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: rowGap }}>
      {coreStages.map(s => {
        const widthPct = Math.round(weights[s.id] * 100);
        const isHover = hovered === s.id;
        return (
          <div
            key={s.id}
            onClick={onStageClick ? () => onStageClick(s.id) : undefined}
            onMouseEnter={() => setHovered(s.id)}
            onMouseLeave={() => setHovered(h => h === s.id ? null : h)}
            style={{
              cursor: onStageClick ? "pointer" : "default", borderRadius: 8,
              padding: "4px 6px", margin: "-4px -6px",
              background: isHover ? s.color + "0d" : "transparent", transition: "background 0.15s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {s.label}
              </span>
              <span style={{ fontSize: 11, color: T.ink3, display: "flex", alignItems: "center", gap: 5 }}>
                {valueLabel(s)}
                <Chevron color={s.color} show={isHover} />
              </span>
            </div>
            <div style={{ background: T.bg, borderRadius: 5, height: barHeight, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${widthPct}%`, background: s.color, borderRadius: 5,
                transition: "width 0.4s ease, filter 0.15s ease", filter: isHover ? "brightness(1.12)" : "none",
              }} />
            </div>
          </div>
        );
      })}

      {drift && drift.count > 0 && (
        <div
          onClick={drift.onClick || undefined}
          onMouseEnter={() => setHovered("drift")}
          onMouseLeave={() => setHovered(h => h === "drift" ? null : h)}
          style={{
            marginTop: 2, borderTop: "1px dashed " + T.bg3,
            cursor: drift.onClick ? "pointer" : "default", borderRadius: 8,
            padding: `${rowGap}px 6px 4px`, margin: "2px -6px 0",
            background: hovered === "drift" ? T.gold500 + "14" : "transparent", transition: "background 0.15s ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, marginBottom: 5 }}>
            <span style={{ fontWeight: 800, color: T.gold600, textTransform: "uppercase", letterSpacing: "0.06em" }}>◉ Drifting — Still Reachable</span>
            <span style={{ color: T.ink3, display: "flex", alignItems: "center", gap: 5 }}>
              {drift.count} · {drift.amount > 0 ? fmt(drift.amount) : "—"} at risk
              <Chevron color={T.gold600} show={hovered === "drift"} />
            </span>
          </div>
          <div style={{ background: T.bg, borderRadius: 5, height: barHeight, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(Math.max(0.08, Math.min(1, drift.count / max)) * 100)}%`, background: T.gold500, borderRadius: 5, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}

      {showLapsed && lapsedStage && (
        <div
          onClick={onStageClick ? () => onStageClick("lapsed") : undefined}
          onMouseEnter={() => setHovered("lapsed")}
          onMouseLeave={() => setHovered(h => h === "lapsed" ? null : h)}
          style={{
            marginTop: 2, paddingTop: rowGap, borderTop: "1px dashed " + T.bg3,
            cursor: onStageClick ? "pointer" : "default", borderRadius: 8,
            padding: `${rowGap}px 6px 4px`, margin: "2px -6px -4px",
            background: hovered === "lapsed" ? lapsedStage.color + "0d" : "transparent", transition: "background 0.15s ease",
          }}
        >
          {/* Demoted whenever the drifting row leads (BUILD-76): lapsed is the
              after-the-window failure state — kept, below, smaller. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: drift && drift.count > 0 ? 10 : 11, marginBottom: 5 }}>
            <span style={{ fontWeight: 800, color: lapsedStage.color, textTransform: "uppercase", letterSpacing: "0.06em", opacity: drift && drift.count > 0 ? 0.75 : 1 }}>↘ Lapsed — Window Closed</span>
            <span style={{ color: T.ink3, display: "flex", alignItems: "center", gap: 5 }}>
              {baseLabel(lapsedStage)}
              <Chevron color={lapsedStage.color} show={hovered === "lapsed"} />
            </span>
          </div>
          <div style={{ background: T.bg, borderRadius: 5, height: drift && drift.count > 0 ? Math.max(6, Math.round(barHeight * 0.55)) : barHeight, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${lapsedWidthPct}%`, background: lapsedStage.color, borderRadius: 5, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}
