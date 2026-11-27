// reports/PagedReportHead.jsx · POLISH-14 item 6. A paged report's head: its
// count and total first (each a figure that opens its rows), the date range it
// covers (opening on Home's window), and the page it is on. The Acknowledgment
// backlog is the first report that answers with `paging`.
import { useState, useEffect } from "react";
import { T } from "../shared";
import { Figure } from "../Figure";

const inp = { padding: "5px 8px", border: "1px solid " + T.bg3, borderRadius: 6, fontSize: 12, fontFamily: "inherit" };
const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };

export function PagedReportHead({ out, onRange, onPage }) {
  const p = out.paging;
  const [from, setFrom] = useState(p.from);
  const [to, setTo] = useState(p.to);
  useEffect(() => { setFrom(p.from); setTo(p.to); }, [p.from, p.to]);
  const f = out.figures || {};
  return (
    <div data-testid="paged-report-head" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 6 }}>
        {f.count && <div><div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>Gifts waiting</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }} data-testid="paged-count"><Figure variant="inline" kind="count" value={f.count.value} label="Gifts waiting to be thanked" definition={f.count.definition} source={f.count.source} /></div></div>}
        {f.total && <div><div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>Their total</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }} data-testid="paged-total"><Figure variant="inline" kind="money" value={f.total.value} label="Waiting to be thanked, total" definition={f.total.definition} source={f.total.source} /></div></div>}
      </div>
      {out.summary && <div style={{ fontSize: 13, color: T.ink2, marginBottom: 8 }}>{out.summary}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: T.ink3 }}>
        <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} aria-label="From" data-testid="paged-from" /></label>
        <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} aria-label="To" data-testid="paged-to" /></label>
        <button type="button" style={btn} onClick={() => onRange(from, to)} disabled={!from || !to} data-testid="paged-apply">Show</button>
        {(p.from !== p.homeFrom || p.to !== p.today) && <button type="button" style={{ ...btn, border: "none", color: T.greenDk }} onClick={() => onRange(p.homeFrom, p.today)} data-testid="paged-home">Home's window</button>}
      </div>
      {p.pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12, color: T.ink3 }} data-testid="paged-pager">
          <button type="button" style={btn} disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}>Previous</button>
          <span>{`Page ${p.page} of ${p.pages}, ${p.pageSize} gifts a page`}</span>
          <button type="button" style={btn} disabled={p.page >= p.pages} onClick={() => onPage(p.page + 1)} data-testid="paged-next">Next</button>
        </div>
      )}
    </div>
  );
}
