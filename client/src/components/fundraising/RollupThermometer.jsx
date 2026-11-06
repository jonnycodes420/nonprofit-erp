// client/src/components/fundraising/RollupThermometer.jsx · moved VERBATIM out of
// Fundraising.jsx by FLOWS-2 (the file was over 1,500 lines).
import { T, fmtTotal } from "../shared";

// Roll-up thermometer — total raised across active goals vs total goal. FIX-2 C:
// it sits on a white card now (it was the dark pine hero), brass for progress.
export function RollupThermometer({ rollup }) {
  const pct = rollup.percent == null ? 0 : rollup.percent;
  const shown = rollup.rawPercent == null ? rollup.percent : rollup.rawPercent;
  const met = pct >= 100;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 30, color: T.ink, lineHeight: 1 }}>{fmtTotal(rollup.totalRaised)}</span>
          <span style={{ fontSize: 14, color: T.ink3 }}>of {fmtTotal(rollup.totalGoal)}{rollup.over > 0 ? ` · ${fmtTotal(rollup.over)} over` : ""}</span>
        </div>
        {shown != null && <span style={{ fontSize: 16, fontWeight: 800, color: T.gold700 }}>{shown}%</span>}
      </div>
      <div style={{ height: 14, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", borderRadius: 99, transition: "width 0.6s cubic-bezier(.22,1,.36,1)", background: met ? T.gold500 : T.gold600 }} />
      </div>
    </div>
  );
}
