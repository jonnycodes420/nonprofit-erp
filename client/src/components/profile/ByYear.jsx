// components/profile/ByYear.jsx · HISTORY-1. A PERSON'S GIVING BY FISCAL YEAR.
// One bar per fiscal year (the year still running marked "so far"), then one
// row per year, newest first: total, gifts, largest gift and the change on the
// year before. Soft credit is its own line under a year, never in its total.
// A total stated in an import is one row, Before Steward, not spread across
// years. Every number opens its rows. The numbers are the server's
// (GET /donors/:id/by-year, shared/numbers/byYear.js); nothing is added here.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { useChangeRev } from "../../lib/changes";
import { T, Spin, fmtFull } from "../shared";
import { Figure } from "../Figure";
import { countLabel } from "../../../../shared/countWords.js";
import { displayDate } from "../../../../shared/displayDate";

const th = { textAlign: "right", fontSize: 10.5, fontWeight: 800, color: T.ink3, padding: "6px 8px", whiteSpace: "nowrap" };
const td = { textAlign: "right", fontSize: 13, color: T.ink, padding: "7px 8px", borderTop: "1px solid " + T.bg3, whiteSpace: "nowrap" };

export function YearBars({ years, label = "Giving by year" }) {
  const span = [...(years || [])].reverse().slice(-12);
  if (!span.length) return null;
  const max = Math.max(...span.map(y => y.total), 1);
  const W = 640, H = 176, pad = { t: 18, r: 8, b: 34, l: 52 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const slot = pw / span.length, bw = Math.min(48, slot * 0.62);
  return <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, ${span[0].chartLabel} to ${span[span.length - 1].chartLabel}`} data-testid="by-year-chart" style={{ display: "block", overflow: "visible" }}>
    {[0, max / 2, max].map((v, i) => {
      const y = pad.t + ph - (v / max) * ph;
      return <g key={i}><line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke={i === 0 ? T.bg3 : T.bg2} />
        <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill={T.ink3}>{i === 0 ? "$0" : fmtFull(Math.round(v))}</text></g>;
    })}
    {span.map((y, i) => {
      const h = y.total > 0 ? Math.max(3, (y.total / max) * ph) : 0;
      const x = pad.l + i * slot + (slot - bw) / 2, top = pad.t + ph - h;
      return <g key={y.key} data-bar-year={y.key} data-so-far={y.current ? "1" : undefined}>
        {y.total > 0
          ? <rect x={x} y={top} width={bw} height={h} rx={3} fill={T.greenDk} fillOpacity={y.current ? 0.55 : 1} />
          : <rect x={x} y={pad.t + ph - 3} width={bw} height={3} rx={1.5} fill={T.bg3} />}
        {y.current && <text x={x + bw / 2} y={(y.total > 0 ? top : pad.t + ph - 3) - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill={T.ink}>so far</text>}
        <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize={10} fill={T.ink3}>{y.chartLabel}</text>
        <title>{y.total > 0 ? `${fmtFull(y.total)} in ${y.label}${y.current ? ", so far" : ""}` : `Nothing in ${y.label}`}</title>
      </g>;
    })}
  </svg>;
}

export default function ByYear({ donor, reloadKey }) {
  const [d, setD] = useState(null), [err, setErr] = useState("");
  // STALE-2 (W-1107-Finance-04X): and after any change to this person's gifts or
  // pledges, made anywhere (an edit or a refund keeps the count the key reads).
  const rev = useChangeRev(["gift", "pledge"], { person: donor.id });
  useEffect(() => {
    let dead = false;
    setErr("");
    apiFetch(`/donors/${donor.id}/by-year`).then(r => { if (!dead) setD(r); }).catch(e => { if (!dead) setErr(e.message || "Could not read the years."); });
    return () => { dead = true; };
  }, [donor.id, reloadKey, rev]);
  if (err) return <div data-testid="dp-by-year-error" style={{ fontSize: 12.5, color: T.ink3 }}>By year could not be read: {err}</div>;
  if (!d) return <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}><Spin /></div>;
  const years = d.years || [];
  const money = (v, label, source) => <Figure variant="cell" kind="money" value={v} label={label} source={source} />;
  return <div data-testid="dp-by-year">
    <YearBars years={years} />
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table data-testid="dp-by-year-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
        <thead><tr>
          <th style={{ ...th, textAlign: "left" }}>Fiscal year</th><th style={th}>Total</th><th style={th}>Gifts</th><th style={th}>Largest gift</th><th style={{ ...th, textAlign: "left" }}>Change</th>
        </tr></thead>
        <tbody>
          {years.map(y => [
            <tr key={y.key} data-testid="dp-by-year-row" data-year={y.key} data-cents={y.cents}>
              <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{y.label}{y.current && <span style={{ fontWeight: 600, color: T.ink3 }}> · so far</span>}</td>
              <td style={td}>{y.giftCount ? money(y.total, `Given in ${y.label}`, y.sources.total) : "—"}</td>
              <td style={td}>{y.giftCount ? <Figure variant="cell" kind="count" value={y.giftCount} label={`Gifts in ${y.label}`} source={y.sources.giftCount} /> : "0"}</td>
              <td style={td}>{y.largestCents ? money(y.largest, `Largest gift in ${y.label}`, y.sources.largest) : "—"}</td>
              <td style={{ ...td, textAlign: "left", color: /^down/.test(y.change) ? T.gold600 : T.ink3 }} data-testid="dp-by-year-change">
                {y.current && d.samePoint && y.giftCount
                  ? <>{y.change} ({money(d.samePoint.total, "The same point last year", d.samePoint.source)})</>
                  : y.change}
              </td>
            </tr>,
            y.softCents ? <tr key={y.key + ":soft"} data-testid="dp-by-year-soft">
              <td style={{ ...td, borderTop: "none", paddingTop: 0, textAlign: "left", fontSize: 12, color: T.ink3 }} colSpan={2}>
                Soft credit, not in the total: {money(y.softCredit, `Soft credit in ${y.label}`, y.sources.softCredit)}
              </td><td colSpan={3} style={{ borderTop: "none" }} />
            </tr> : null,
          ])}
          {(d.other || []).map(o => <tr key={o.key} data-testid="dp-by-year-other" data-cents={o.cents}>
            <td style={{ ...td, textAlign: "left" }}>{o.label}</td>
            <td style={td}>{money(o.total, o.label, o.source)}</td>
            <td style={td}>{countLabel(o.giftCount, "gift")}</td><td style={td} /><td style={td} />
          </tr>)}
          {d.before && <tr data-testid="dp-by-year-before" data-cents={d.before.cents}>
            <td style={{ ...td, textAlign: "left" }} colSpan={5}>
              Before Steward: <strong>{money(d.before.total, "Before Steward, stated in your import", d.before.figureSource)}</strong> (stated in your import{d.before.through ? `, to ${displayDate(d.before.through)}` : ""}). It is one total, not spread across years.
            </td>
          </tr>}
        </tbody>
      </table>
    </div>
    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 8, lineHeight: 1.5 }}>
      Each fiscal year: every gift dated in it, a refund taken off, soft credit on its own line. These rows add up to Lifetime, <Figure variant="inline" kind="money" value={d.lifetime} label="Lifetime giving" source={{ key: "donor-lifetime", params: { donor: donor.id } }} />. Every number opens its gifts.
    </div>
  </div>;
}
