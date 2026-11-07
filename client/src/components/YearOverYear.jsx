// components/YearOverYear.jsx · HISTORY-1. REPORTS' "YEAR OVER YEAR".
// One row per fiscal year for the whole org, newest first: the Giving
// summary's total, gifts and largest gift for that year, the change on the
// year before, and its donors cut three ways (new, retained, reactivated,
// which add up to donors), with retention. The year still running is "so far"
// and has a "same point last year" column, so a part year is never set against
// a whole one. Every figure opens the people or gifts behind it. The numbers
// are the server's (GET /reports/year-over-year, shared/numbers/byYear.js).
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { YearBars } from "./profile/ByYear";
import { displayDate } from "../../../shared/displayDate";

const th = { textAlign: "right", fontSize: 10.5, fontWeight: 800, color: T.ink3, padding: "6px 8px", whiteSpace: "nowrap", verticalAlign: "bottom" };
const td = { textAlign: "right", fontSize: 13, color: T.ink, padding: "8px 8px", borderTop: "1px solid " + T.bg3, whiteSpace: "nowrap" };
const pct = r => (r == null ? "—" : `${Math.round(r * 1000) / 10}%`);

export function yoyView(d) {
  const years = d.years || [];
  const empty = years.every(y => !y.giftCount);
  const cur = years[0], sp = d.samePoint;
  const M = (v, label, source) => <Figure variant="cell" kind="money" value={v} label={label} source={source} />;
  const C = (v, label, source) => <Figure variant="cell" kind="count" value={v} label={label} source={source} />;
  const narrative = cur ? <>
    This fiscal year so far, <strong>{M(cur.total, `Given in ${cur.label}, so far`, cur.sources.total)}</strong> from{" "}
    <strong>{C(cur.donors, `Donors in ${cur.label}, so far`, cur.sources.donors)}</strong> {cur.donors === 1 ? "donor" : "donors"}
    {sp ? <>; at the same point last year, {M(sp.total, "Given at the same point last year", sp.sources.total)} from {C(sp.donors, "Donors at the same point last year", sp.sources.donors)}</> : null}.
    {" "}{cur.change && sp ? <>That is {cur.change}.</> : null} Each row is one fiscal year; every number opens the gifts or people behind it.
  </> : null;
  const table = <>
    <div style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <YearBars years={years} label="Giving by fiscal year" />
    </div>
    <div style={{ overflowX: "auto" }}>
      <table data-testid="yoy-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
        <thead><tr>
          <th style={{ ...th, textAlign: "left" }}>Fiscal year</th>
          <th style={th}>Total</th><th style={th}>Gifts</th><th style={th}>Largest gift</th>
          <th style={{ ...th, textAlign: "left" }}>Change</th>
          <th style={th}>Donors</th><th style={th}>New</th><th style={th}>Retained</th><th style={th}>Reactivated</th><th style={th}>Retention</th>
          <th style={{ ...th, borderLeft: `1px solid ${T.bg3}` }}>Same point<br />last year</th>
        </tr></thead>
        <tbody>
          {years.map(y => <tr key={y.key} data-testid="yoy-row" data-year={y.key}>
            <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{y.label}{y.current && <span style={{ fontWeight: 600, color: T.ink3 }}> · so far</span>}</td>
            <td style={td}>{M(y.total, `Given in ${y.label}`, y.sources.total)}</td>
            <td style={td}>{C(y.giftCount, `Gifts in ${y.label}`, y.sources.giftCount)}</td>
            <td style={td}>{y.largestCents ? M(y.largest, `Largest gift in ${y.label}`, y.sources.largest) : "—"}</td>
            <td style={{ ...td, textAlign: "left", color: /^down/.test(y.change) ? T.gold600 : T.ink3 }} data-testid="yoy-change">{y.change}</td>
            <td style={td}>{C(y.donors, `Donors in ${y.label}`, y.sources.donors)}</td>
            <td style={td}>{C(y.newDonors, `New donors in ${y.label}`, y.sources.newDonors)}</td>
            <td style={td}>{C(y.retained, `Retained donors in ${y.label}`, y.sources.retained)}</td>
            <td style={td}>{C(y.reactivated, `Reactivated donors in ${y.label}`, y.sources.reactivated)}</td>
            <td style={td}>{y.retentionRate == null ? "—" : <Figure variant="cell" kind="percent" value={Math.round(y.retentionRate * 1000) / 10} label={`Retention in ${y.label}`} source={y.sources.retentionRate} />}</td>
            <td style={{ ...td, borderLeft: `1px solid ${T.bg3}`, color: T.ink3 }} data-testid={y.current ? "yoy-same-point" : undefined}>
              {y.current && sp ? <>{M(sp.total, "Given at the same point last year", sp.sources.total)}<div style={{ fontSize: 11 }}>{C(sp.giftCount, "Gifts at the same point last year", sp.sources.giftCount)} gifts · {C(sp.donors, "Donors at the same point last year", sp.sources.donors)} donors</div><div style={{ fontSize: 10.5 }}>to {displayDate(sp.to)}</div></> : ""}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div data-testid="yoy-sentence" style={{ fontSize: 11.5, color: T.ink3, marginTop: 10, lineHeight: 1.5, maxWidth: 820 }}>
      {d.sentence} Retention {pct(cur && cur.retentionRate)} this year so far is counted against all of last year's donors, so it rises as the year goes on.
    </div>
  </>;
  return { narrative, table, empty };
}
