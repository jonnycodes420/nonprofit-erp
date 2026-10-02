import { useEffect, useState } from "react";
import { T, Spin, Modal, fmtFull } from "./shared";
import { apiFetch } from "../api";
import { DonorLink } from "./RecordLink";
import { donorHref, rowClick } from "../lib/appUrls";

// THE ONE DRILL-THROUGH PANEL. Every number that opens, opens here.
//
// It has two ways in, and there is one panel, not two:
//
// 1. FIX-2 A — `source` (what <Figure> passes). The panel fetches the rows
//    behind the figure from GET /figures/:source/rows — the same definition the
//    figure was computed from, so the rows and the number cannot disagree — and
//    shows the sentence that defines the figure, the rows (paginated; a row
//    that names a person opens that person), and a total that foots to the
//    number on screen to the cent. A percentage shows its numerator's rows and
//    its denominator's rows. A blank ("—") shows the sentence saying exactly
//    what is missing and when it will appear.
//
// 2. The older caller-supplied mode (Home's Stewardship Debt, retention, money
//    at risk and portfolio drill-downs): title, explanation, and rows the
//    caller already has.
//      rows: [{ id, donorId, donorName, detail, value, percentOfTotal }]
//        - id: optional, only needed when a donor can appear more than once.
//        - detail: caller-formatted secondary line.
//        - value: caller-formatted primary number for this row.
//
// BUILD-87 F.1 — the portal, the Escape handler and the focus round-trip are
// the shared Modal's job. The reason they once lived here is worth keeping:
// the Dashboard's root retained a `transform` from `.fade-in`'s fill-mode,
// which made it the containing block for every position:fixed descendant and
// dropped this panel at the vertical middle of the whole tall page.
const UNITS = { months: "months", days: "days" };
const PAGE_SIZE = 50;
const qs = params => Object.entries(params || {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const centsOf = v => Math.round((Number(v) || 0) * 100);

// One page of a source's rows, with its own paging. A ratio's two halves are
// each one of these.
export function SourceRows({ source, initial, onSelectDonor, heading }) {
  const [data, setData] = useState(initial || null);
  const [page, setPage] = useState(initial?.page || 1);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (initial && page === (initial.page || 1)) { setData(initial); setLoading(false); return; }
    let live = true;
    setLoading(true);
    apiFetch(`/figures/${encodeURIComponent(source.key)}/rows?${qs({ ...source.params, page, pageSize: PAGE_SIZE })}`)
      .then(r => { if (live) { setData(r); setError(null); } })
      .catch(e => { if (live) setError(e?.message || "The rows could not be read."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key, JSON.stringify(source.params), page]);

  const rows = data?.rows || [];
  const total = data?.totalRows || 0;
  const first = total ? (page - 1) * (data?.pageSize || PAGE_SIZE) + 1 : 0;
  const last = Math.min(total, first + rows.length - 1);
  // PROFILE-1 — a source may measure something that is not money. `months`
  // was the first (recurring-months); `days` is the second (the profile's
  // "Last contact", where the figure is the gap and only the most recent
  // conversation carries it, so the rows still add to it). A row with no
  // amount renders BLANK, never 0 — a zero there would read as "nothing on
  // that day" instead of "this row is not what the number counts".
  const unit = UNITS[data?.amountKind];
  const amount = r => r.amount === null || r.amount === undefined ? ""
    : unit ? `${Math.round(r.amount)} ${unit}` : fmtFull(r.amount);
  return (
    <div data-figure-part={heading ? heading.role : undefined}>
      {heading && (
        <div style={{ padding: "14px 24px 6px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline",
                      borderTop: "1px solid " + T.bg2, background: T.bg }}>
          <div style={{ fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>
            {heading.roleWord} · {heading.label}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }} data-figure-part-total
            data-cents={heading.measure === "sum" ? String(centsOf(heading.value)) : undefined} data-value={String(heading.value)}>
            {heading.measure === "sum" ? fmtFull(heading.value) : Number(heading.value).toLocaleString("en-US")}
          </div>
        </div>
      )}
      {data?.sentence && <div style={{ padding: "8px 24px 4px", fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{data.sentence}</div>}
      {loading && <div style={{ padding: "22px 24px", color: T.ink3, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><Spin />Reading the rows…</div>}
      {error && <div style={{ padding: "16px 24px", color: T.ink, fontSize: 13 }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: "18px 24px", color: T.ink3, fontSize: 13 }}>No rows. That is why this reads zero.</div>
      )}
      {!loading && rows.map(r => {
        const main = (
          <>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{r.name || "Unnamed"}</div>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
                {[r.dateLabel, r.detail].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, flexShrink: 0, textAlign: "right" }}>{amount(r)}</div>
          </>
        );
        const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 24px",
                           borderBottom: "1px solid " + T.bg, width: "100%", textAlign: "left", background: "transparent",
                           border: "none", borderTop: "none", font: "inherit" };
        // FIX-13 Part 6 — a person's row is a real link to them even where the
        // page gave no handler: a plain click then goes through the router.
        return r.donorId
          ? <DonorLink key={r.id} id={r.donorId} data-figure-row data-person-row={r.donorId}
              onOpen={onSelectDonor ? () => onSelectDonor({ donorId: r.donorId, donorName: r.name }) : undefined}
              title={`Open ${r.name}`} style={{ ...rowStyle, cursor: "pointer", borderBottom: "1px solid " + T.bg }}>{main}</DonorLink>
          : <div key={r.id} data-figure-row style={{ ...rowStyle, borderBottom: "1px solid " + T.bg }}>{main}</div>;
      })}
      {total > (data?.pageSize || PAGE_SIZE) && (
        <div style={{ padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: T.ink3 }}>
          <span>Showing {first}–{last} of {total.toLocaleString("en-US")}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={pagerBtn(page <= 1)}>Previous</button>
            <button type="button" disabled={last >= total} onClick={() => setPage(p => p + 1)} style={pagerBtn(last >= total)}>Next</button>
          </span>
        </div>
      )}
    </div>
  );
}
const pagerBtn = off => ({ background: T.bgCard, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 11px",
  fontSize: 12.5, color: off ? T.ink3 : T.ink, cursor: off ? "default" : "pointer" });

const ROLE_WORD = { numerator: "Counted", denominator: "Out of", plus: "This year", minus: "Less last year" };

// The figure's own foot: the total of every row, which IS the number on screen.
export function Foot({ data, figure }) {
  const box = { padding: "14px 24px", borderTop: "2px solid " + T.ink, display: "flex", justifyContent: "space-between",
                alignItems: "baseline", gap: 12, background: T.bgCard };
  if (data.value === null || data.value === undefined) return null;
  if (data.measure === "ratio") {
    const [n, d] = data.parts || [];
    return (
      <div style={box} data-figure-total data-value={String(data.value)}>
        <span style={{ fontSize: 13, color: T.ink3 }}>
          {data.formula === "change"
            ? `(${n.measure === "sum" ? fmtFull(n.value) : n.value} − ${d.measure === "sum" ? fmtFull(d.value) : d.value}) ÷ ${d.measure === "sum" ? fmtFull(d.value) : d.value}`
            : `${Number(n.value).toLocaleString("en-US")} of ${Number(d.value).toLocaleString("en-US")}`}
        </span>
        <strong style={{ fontSize: 18, color: T.ink }}>{`${data.value}%`}</strong>
      </div>
    );
  }
  if (data.measure === "difference") {
    const [a, b] = data.parts || [];
    return (
      <div style={box} data-figure-total data-cents={String(data.cents)}>
        <span style={{ fontSize: 13, color: T.ink3 }}>{fmtFull(a.value)} − {fmtFull(b.value)}</span>
        <strong style={{ fontSize: 18, color: T.ink }}>{fmtFull(data.value)}</strong>
      </div>
    );
  }
  const totUnit = UNITS[data.amountKind];
  const word = data.measure === "sum" ? "Total of every row" : data.measure === "avg" ? "Average of every row" : "Rows";
  const shown = data.measure === "sum" ? (totUnit ? `${Math.round(data.value)} ${totUnit}` : fmtFull(data.value))
    : data.measure === "avg" ? `${data.value}${totUnit ? " " + totUnit : ""}`
    : Number(data.value).toLocaleString("en-US");
  const matches = figure && figure.value !== null && figure.value !== undefined
    && (data.measure === "sum" ? centsOf(figure.value) === data.cents : Number(figure.value) === data.value);
  return (
    <div style={box} data-figure-total data-cents={data.measure === "sum" ? String(data.cents) : undefined} data-value={String(data.value)}>
      <span style={{ fontSize: 13, color: T.ink3 }}>{word}{matches ? ", the number on screen" : ""}</span>
      <strong style={{ fontSize: 18, color: T.ink }}>{shown}</strong>
    </div>
  );
}

export function SourcePanel({ source, figure, onSelectDonor }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch(`/figures/${encodeURIComponent(source.key)}/rows?${qs({ ...source.params, page: 1, pageSize: PAGE_SIZE })}`)
      .then(r => { if (live) setData(r); })
      .catch(e => { if (live) setError(e?.message || "The rows could not be read."); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key, JSON.stringify(source.params)]);
  if (error) return <div style={{ padding: "24px", fontSize: 13, color: T.ink }}>{error}</div>;
  if (!data) return <div style={{ padding: "32px 24px", color: T.ink3, fontSize: 13, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}><Spin />Reading the rows…</div>;
  const blank = (figure && (figure.value === null || figure.value === undefined)) || data.value === null ? (data.blank || figure?.blank) : null;
  return (
    <div data-figure-panel={source.key}>
      {blank && (
        <div style={{ margin: "14px 24px 4px", padding: "12px 14px", borderLeft: "3px solid " + T.gold, background: T.bg, fontSize: 13.5, color: T.ink, lineHeight: 1.55 }}
          data-figure-blank>{blank}</div>
      )}
      {data.parts
        ? <>
            {data.sentence && <div style={{ padding: "10px 24px 4px", fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{data.sentence}</div>}
            {data.parts.map(p => (
              <SourceRows key={p.role} source={p.source} initial={p} onSelectDonor={onSelectDonor}
                heading={{ role: p.role, roleWord: ROLE_WORD[p.role] || p.role, label: p.label, value: p.value, measure: p.measure }} />
            ))}
          </>
        : <SourceRows source={source} initial={data} onSelectDonor={onSelectDonor} />}
      <Foot data={data} figure={figure} />
    </div>
  );
}

export default function MetricBreakdownPanel({ open, onClose, title, explanation, total, totalLabel, totalCount, rows = [], loading = false, onSelectDonor, source, figure }) {
  if (!open) return null;
  const isSource = !!(source && source.key);
  const shownFigure = isSource && figure && figure.value !== null && figure.value !== undefined
    ? (figure.kind === "money" ? fmtFull(figure.value) : figure.kind === "percent" ? `${figure.value}%` : Number(figure.value).toLocaleString("en-US"))
    : null;
  return (
    <Modal onClose={onClose} width={660} ariaLabel={title || "Details"}
      backdrop="rgba(15,26,18,0.5)" blur={false} padding={0}
      dialogStyle={{ borderRadius: T.radiusLg, maxHeight: "86vh" }}
      header={(
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid " + T.bg3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontFamily: "'DM Serif Display',serif", color: T.ink, marginBottom: 4 }}>{title}</div>
              {shownFigure && <div style={{ fontSize: 28, fontFamily: "'DM Serif Display',serif", color: T.ink, lineHeight: 1.15 }}>{shownFigure}</div>}
              {!isSource && total != null && (
                <div style={{ fontSize: 13, color: T.ink3 }}>
                  {totalLabel || "Total"}: <strong style={{ color: T.ink }}>{total}</strong>
                  {totalCount != null && rows.length < totalCount && <span> · showing top {rows.length} of {totalCount}</span>}
                </div>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
          </div>
          {explanation && <div style={{ fontSize: 13, color: T.ink2, marginTop: 10, lineHeight: 1.55 }}>{explanation}</div>}
        </div>
      )}>
        {isSource ? <SourcePanel source={source} figure={figure} onSelectDonor={onSelectDonor} /> : (
        <div>
          {loading ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: T.ink3, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Spin/>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: T.ink3, fontSize: 13 }}>Nothing to show yet.</div>
          ) : rows.map((r, i) => (
            <div
              key={r.id || r.donorId || i}
              onClick={onSelectDonor && r.donorId ? rowClick(donorHref(r.donorId), () => onSelectDonor(r)) : onSelectDonor ? () => onSelectDonor(r) : undefined}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 24px", borderBottom: "1px solid " + T.bg, cursor: onSelectDonor ? "pointer" : "default" }}
            >
              <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: T.ink3 }}>#{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donorId ? <DonorLink id={r.donorId} onOpen={onSelectDonor ? () => onSelectDonor(r) : undefined}>{r.donorName}</DonorLink> : r.donorName}</div>
                  {r.detail && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{r.detail}</div>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{r.value}</div>
                {r.percentOfTotal != null && <div style={{ fontSize: 11, color: T.ink3 }}>{r.percentOfTotal}% of total</div>}
              </div>
            </div>
          ))}
        </div>)}
    </Modal>
  );
}
