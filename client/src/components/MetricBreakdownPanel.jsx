import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { T, Spin } from "./shared";

// Generic "click a summary metric → ranked, donor-linked drill-down" modal.
// Built for Stewardship Debt but deliberately kept metric-agnostic (title,
// explanation, and row content are all caller-supplied) so First-Touch Delay
// or any future "name the vague anxiety as a number" metric can reuse it
// instead of getting a bespoke one-off panel.
//
// rows: [{ id, donorId, donorName, detail, value, percentOfTotal }]
//   - id: optional, only needed when a donor can appear more than once (an
//     event-log breakdown like "gifts this year" or "visits logged" — one
//     row per gift/interaction, not per donor). Falls back to donorId, which
//     is unique enough for the one-row-per-donor breakdowns (debt, retention).
//   - detail: caller-formatted secondary line (e.g. "$12,500 total · 210
//     days since contact") — metric-specific fields live here, not in props.
//   - value: caller-formatted primary number for this row (e.g. "18.4").
export default function MetricBreakdownPanel({ open, onClose, title, explanation, total, totalLabel, totalCount, rows = [], loading = false, onSelectDonor }) {
  const cardRef = useRef(null);
  const returnFocusRef = useRef(null);

  // Esc-to-close + focus management. The panel is portalled to <body> (below)
  // so it escapes the Dashboard's `fade-in` root — whose retained
  // `transform: translateY(0)` (animation-fill-mode:both) makes it the
  // containing block for position:fixed, which used to drop this modal at the
  // vertical middle of the whole tall page (below the fold). Portalling to
  // body restores true viewport-centred `position:fixed`.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    // Focus the panel so Esc/tab land here and screen readers announce it.
    const id = requestAnimationFrame(() => cardRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(id);
      // Return focus to whatever opened the panel.
      const el = returnFocusRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal((
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Details"}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.5)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{ background: T.white, borderRadius: T.radiusLg, maxWidth: 640, width: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: T.shadowLg, outline: "none" }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid " + T.bg3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontFamily: "'DM Serif Display',serif", color: T.ink, marginBottom: 4 }}>{title}</div>
              {total != null && (
                <div style={{ fontSize: 13, color: T.ink3 }}>
                  {totalLabel || "Total"}: <strong style={{ color: T.ink }}>{total}</strong>
                  {totalCount != null && rows.length < totalCount && <span> · showing top {rows.length} of {totalCount}</span>}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
          </div>
          {explanation && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 10, lineHeight: 1.5 }}>{explanation}</div>}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: T.ink3, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Spin/>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: T.ink3, fontSize: 13 }}>Nothing to show yet.</div>
          ) : rows.map((r, i) => (
            <div
              key={r.id || r.donorId || i}
              onClick={onSelectDonor ? () => onSelectDonor(r) : undefined}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 24px", borderBottom: "1px solid " + T.bg, cursor: onSelectDonor ? "pointer" : "default" }}
            >
              <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: T.ink3 }}>#{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donorName}</div>
                  {r.detail && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{r.detail}</div>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.greenDk, fontFamily: "'DM Serif Display',serif" }}>{r.value}</div>
                {r.percentOfTotal != null && <div style={{ fontSize: 11, color: T.ink3 }}>{r.percentOfTotal}% of total</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}
