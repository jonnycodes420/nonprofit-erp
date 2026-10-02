// BUILD-86 C.3 — DASHBOARDS, PLURAL. A left rail of four, each one question.
// FIX-2 A — …each ANSWERED in a sentence at the top, and every number on them
// opens.
//
// Nothing on any of these screens appears without a one-sentence definition,
// available on hover and printed in the PDF footnote. The definition comes
// from shared/dashboards.js over the wire, so the sentence a board member
// reads here and the one printed in the packet are the same string rather
// than two copies that drift.
//
// EVERY NUMBER OPENS (FIX-2). Each figure is drawn by <Figure> with the
// `source` the server computed it from, and clicking it opens the rows that
// make it. This file draws no number any other way: it is in the number
// census's FIGURE_SOURCE_SCOPE, which fails the battery on a figure here
// without a source (scripts/build97-number-census.js).
//
// Every number is a number a board can define. That is the whole rule, and it
// is why "stewardship debt" is not on any of them.
import { useEffect, useState } from "react";
import { apiFetch, API } from "../api";
import { T, Spin, activeMark } from "./shared";
import { makeT } from "../../../shared/vocabulary";
import { displayDate } from "../../../shared/displayDate";
import { Figure, FigureContext } from "./Figure";
import { DonorLink } from "./RecordLink";

const DASH_CSS = `
.dash-page{display:flex;gap:24px;align-items:flex-start}
.dash-rail{flex:0 0 200px;display:flex;flex-direction:column;gap:2px}
.dash-main{flex:1 1 auto;min-width:0}
.dash-two{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;margin-top:16px;align-items:start}
.dash-two.even{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.dash-tiles{display:flex;flex-wrap:wrap;gap:12px}
.dash-tiles>.fig-tile{flex:1 1 150px}
.dash-tiles.wide>.fig-tile{flex-basis:200px}
.dash-card{background:${T.bgCard};border:1px solid ${T.bg2};border-radius:14px;padding:18px 20px;min-width:0}
.dash-answer{font-family:'DM Serif Display',Georgia,serif;font-size:32px;line-height:1.2;color:${T.ink};margin:4px 0 8px;overflow-wrap:anywhere}
@media (max-width:1100px){.dash-two,.dash-two.even{grid-template-columns:minmax(0,1fr)}}
@media (max-width:860px){.dash-page{flex-direction:column;gap:14px}.dash-rail{flex:none;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px}.dash-answer{font-size:25px}.dash-card{padding:14px 14px}}
`;

// The definition, on hover and reachable by keyboard. A tooltip nobody can
// reach is a definition that does not exist for half the people who need it.
export function Def({ text }) {
  return (
    <span tabIndex={0} title={text} aria-label={text}
      style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: T.ink3, border: "1px solid " + T.bg3,
               borderRadius: 99, width: 15, height: 15, display: "inline-flex", alignItems: "center",
               justifyContent: "center", cursor: "help", verticalAlign: "middle" }}>?</span>
  );
}

export const Eyebrow = ({ children }) => (
  <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, fontWeight: 700, marginBottom: 10 }}>{children}</div>
);

// A headline figure: a tile that opens.
export const Tile = ({ m, sub }) => m ? (
  <Figure variant="tile" figureKey={m.key} value={m.value} kind={m.kind} label={m.label}
    definition={m.definition} source={m.source} blank={m.blank} blankShort={m.blankShort} sub={sub} />
) : null;

// A card of rows, each row's figure opening its own rows.
export function RowsCard({ m, empty, children }) {
  if (!m) return null;
  const rows = Array.isArray(m.value) ? m.value : [];
  return (
    <section className="dash-card">
      <Eyebrow>{m.label}<Def text={m.definition} /></Eyebrow>
      {rows.length === 0
        ? <div style={{ fontSize: 13, color: T.ink3 }}>{empty || "Nothing here yet."}</div>
        : rows.map((r, i) => children ? children(r, i) : <Row key={i} r={r} first={i === 0} />)}
    </section>
  );
}

export function Row({ r, first, indent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "9px 0",
                  borderTop: first ? "none" : "1px solid " + T.bg2, paddingLeft: indent ? 14 : 0 }}>
      <span style={{ fontSize: 13.5, color: T.ink, fontWeight: r.group ? 700 : 400, minWidth: 0, overflowWrap: "anywhere" }}>
        {r.label}{r.definition ? <Def text={r.definition} /> : null}
        {r.whenLabel ? <span style={{ color: T.ink3 }}> · due {r.whenLabel}</span> : null}
      </span>
      <span style={{ fontSize: 14, color: T.ink, flexShrink: 0 }}>
        <Figure variant="cell" figureKey={r.key || r.label} value={r.value} kind={r.kind || "count"} label={r.label}
          definition={r.definition} source={r.source} />
      </span>
    </div>
  );
}

// THE BOARD'S LINE. Giving added up month by month, this year against last,
// in the two colours that mean something here: emerald for this year, brass
// for last. Every point is a figure and opens the gifts that make it.
export function GivingLine({ m }) {
  const pts = Array.isArray(m?.value) ? m.value : [];
  if (!pts.length) return null;
  const W = 640, H = 210, L = 12, R = 12, TOP = 14, BOT = 30;
  // PARITY-1 Part C — a third year (the year before last) when the series
  // carries one, in ink's grey, dotted, under the other two.
  const third = pts.some(p => p.yearBefore);
  const max = Math.max(1, ...pts.flatMap(p => [p.thisYear?.value || 0, p.lastYear?.value || 0, p.yearBefore?.value || 0]));
  const x = i => L + (i * (W - L - R)) / Math.max(1, pts.length - 1);
  const y = v => TOP + (H - TOP - BOT) * (1 - (Number(v) || 0) / max);
  const line = key => pts.map((p, i) => (p[key] ? `${x(i)},${y(p[key].value)}` : null)).filter(Boolean).join(" ");
  // Where the two years meet, last year's point sat under this year's and no
  // pointer could reach it — a number that could not open (the FIX-2 walk).
  // Two points closer than a finger apart are drawn side by side instead.
  const split = p => (p.thisYear && p.lastYear && Math.abs(y(p.thisYear.value) - y(p.lastYear.value)) < 12 ? 6 : 0);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 12, color: T.ink3, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: T.ink }}>{m.label}<Def text={m.definition} /></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 3, background: T.greenDk, display: "inline-block", borderRadius: 2 }} />This year
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 3, background: T.gold, display: "inline-block", borderRadius: 2 }} />Last year
        </span>
        {third && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 0, borderTop: "2px dotted " + T.ink3, display: "inline-block" }} />The year before
        </span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={m.definition} style={{ display: "block", overflow: "visible" }}>
        <line x1={L} x2={W - R} y1={H - BOT} y2={H - BOT} stroke={T.bg3} strokeWidth={1} />
        {third && <polyline points={line("yearBefore")} fill="none" stroke={T.ink3} strokeWidth={2} strokeDasharray="2 4" />}
        <polyline points={line("lastYear")} fill="none" stroke={T.gold} strokeWidth={2.5} strokeDasharray="6 5" />
        <polyline points={line("thisYear")} fill="none" stroke={T.greenDk} strokeWidth={3} />
        {pts.map((p, i) => (
          <text key={p.month} x={x(i)} y={H - 10} textAnchor="middle" fontSize={12} fill={T.ink3}>{p.label}</text>
        ))}
        {pts.map((p, i) => p.yearBefore && (
          <Figure key={"b" + p.month} variant="point" figureKey={"before-" + p.month} cx={x(i) + 2 * split(p)} cy={y(p.yearBefore.value)} r={4}
            color={T.ink3} value={p.yearBefore.value} kind="money" label={p.yearBefore.label} definition={m.definition} source={p.yearBefore.source} />
        ))}
        {pts.map((p, i) => p.lastYear && (
          <Figure key={"l" + p.month} variant="point" figureKey={"last-" + p.month} cx={x(i) + split(p)} cy={y(p.lastYear.value)} r={4.5}
            color={T.gold} value={p.lastYear.value} kind="money" label={p.lastYear.label} definition={m.definition} source={p.lastYear.source} />
        ))}
        {pts.map((p, i) => p.thisYear && (
          <Figure key={"t" + p.month} variant="point" figureKey={"this-" + p.month} cx={x(i) - split(p)} cy={y(p.thisYear.value)} r={5.5}
            color={T.greenDk} value={p.thisYear.value} kind="money" label={p.thisYear.label} definition={m.definition} source={p.thisYear.source} />
        ))}
      </svg>
    </div>
  );
}

export function BoardBody({ get }) {
  const ret = get("retentionRate");
  const also = ret?.also || [];
  const retained = also.find(a => a.key === "retained"), prior = also.find(a => a.key === "prior");
  const cohort = retained && prior ? (
    <>
      <Figure variant="inline" figureKey="retention-retained" value={retained.value} kind="count" label={retained.label}
        definition={retained.definition} source={retained.source} /> of the{" "}
      <Figure variant="inline" figureKey="retention-prior" value={prior.value} kind="count" label={prior.label}
        definition={prior.definition} source={prior.source} /> people who gave last year have given again.
    </>
  ) : null;
  const des = get("byDesignation");
  return (
    <>
      <div className="dash-two">
        <section className="dash-card">
          <Eyebrow>Giving</Eyebrow>
          <div className="dash-tiles wide">
            <Tile m={get("revenueThisYear")} />
            <Tile m={get("revenueLastYear")} />
            <Tile m={get("revenueChangePct")} />
            <Tile m={get("otherIncomeThisYear")} />
          </div>
          <GivingLine m={get("givingByMonth")} />
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <RowsCard m={des} empty="No gifts yet this fiscal year.">
            {(r, i) => <Row key={i} r={r} first={i === 0} indent={!r.group} />}
          </RowsCard>
          <section className="dash-card">
            <Eyebrow>People</Eyebrow>
            <div className="dash-tiles">
              <Tile m={get("donorCount")} />
              <Tile m={ret} sub={cohort} />
            </div>
          </section>
        </div>
      </div>
      <section className="dash-card" style={{ marginTop: 16 }}>
        <Eyebrow>Monthly giving</Eyebrow>
        <div className="dash-tiles">
          <Tile m={get("recurringActive")} />
          <Tile m={get("recurringStopped")} />
          <Tile m={get("recurringRecovered")} />
        </div>
      </section>
    </>
  );
}

export function GoalRow({ r, first }) {
  const goal = (r.also || []).find(a => a.key === "goal"), pct = (r.also || []).find(a => a.key === "percent");
  const bar = pct && pct.value != null ? Math.min(100, Math.max(0, pct.value)) : 0;
  return (
    <div style={{ padding: "12px 0", borderTop: first ? "none" : "1px solid " + T.bg2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{r.label}</span>
        <span style={{ fontSize: 13.5, color: T.ink }}>
          <Figure variant="cell" figureKey={"raised-" + r.label} value={r.value} kind="money" label={`Raised · ${r.label}`}
            definition="Every gift given to this goal, less any fee the donor covered, and every grant awarded toward it." source={r.source} />
          {goal && <> of <Figure variant="cell" figureKey={"goal-" + r.label} value={goal.value} kind="money" label={`${goal.label} · ${r.label}`}
            definition={goal.definition} source={goal.source} /></>}
          {pct && <> · <Figure variant="cell" figureKey={"pct-" + r.label} value={pct.value} kind="percent" label={`${pct.label} · ${r.label}`}
            definition={pct.definition} source={pct.source} /></>}
        </span>
      </div>
      <div style={{ height: 6, background: T.bg2, borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
        <div style={{ height: "100%", width: bar + "%", background: T.greenDk, borderRadius: 99 }} />
      </div>
      {r.pace && <div style={{ fontSize: 12, color: T.ink3, marginTop: 5 }}>{r.pace === "met" ? "Goal met" : r.pace === "behind" ? "Behind an even pace through the period" : "On an even pace through the period"}</div>}
    </div>
  );
}

// PARITY-1 Part C · GIVING BY LEVEL. One bar per level, its length the share
// of the last 12 months' giving; the amount and the head count each open the
// donors at that level.
export function LevelBars({ m }) {
  if (!m) return null;
  const rows = Array.isArray(m.value) ? m.value : [];
  const total = rows.reduce((t, r) => t + Math.max(0, Number(r.value) || 0), 0);
  return (
    <section className="dash-card" data-testid="dash-giving-level">
      <Eyebrow>{m.label}<Def text={m.definition} /></Eyebrow>
      {rows.length === 0 || total === 0
        ? <div style={{ fontSize: 13, color: T.ink3 }}>Nobody has given in the last 12 months.</div>
        : rows.map((r, i) => {
          const n = (r.also || []).find(a => a.key === "count");
          const w = total > 0 ? Math.max(0, Math.min(100, (Math.max(0, Number(r.value) || 0) / total) * 100)) : 0;
          return (
            <div key={r.key} style={{ padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid " + T.bg2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{r.label}</span>
                <span style={{ fontSize: 13.5, color: T.ink }}>
                  <Figure variant="cell" figureKey={"level-" + r.key} value={r.value} kind="money" label={`${r.label} · given in the last 12 months`}
                    definition={r.definition} source={r.source} />
                  {n && <> · <Figure variant="cell" figureKey={"level-n-" + r.key} value={n.value} kind="count" label={n.label}
                    definition={n.definition} source={n.source} /> {n.value === 1 ? "person" : "people"}</>}
                </span>
              </div>
              <div style={{ height: 8, background: T.bg2, borderRadius: 99, marginTop: 7, overflow: "hidden" }}>
                <div style={{ height: "100%", width: w + "%", background: T.greenDk, borderRadius: 99 }} />
              </div>
            </div>
          );
        })}
    </section>
  );
}

// PARITY-1 Part C · RETENTION, WITH A CHOICE OF DEFINITION. The server sends
// all three; the selector only chooses which one is read. Each is a ratio
// figure, and its two halves open their people.
export function RetentionChoice({ m }) {
  const opts = Array.isArray(m?.value) ? m.value : [];
  const [pick, setPick] = useState(() => {
    try { return localStorage.getItem("steward.dash.retention") || "calendar"; } catch { return "calendar"; }
  });
  if (!opts.length) return null;
  const cur = opts.find(o => o.key === pick) || opts[0];
  const choose = k => { setPick(k); try { localStorage.setItem("steward.dash.retention", k); } catch { /* per-viewer only */ } };
  const kept = (cur.also || []).find(a => a.key === "kept"), prior = (cur.also || []).find(a => a.key === "prior");
  return (
    <section className="dash-card" data-testid="dash-retention-choice">
      <Eyebrow>{m.label}<Def text={m.definition} /></Eyebrow>
      <div role="radiogroup" aria-label="How retention is measured" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {opts.map(o => {
          const on = o.key === cur.key;
          return (
            <button key={o.key} role="radio" aria-checked={on} data-retention-def={o.key} onClick={() => choose(o.key)}
              style={{ border: "1px solid " + (on ? T.greenDk : T.bg3), background: on ? T.bg2 : "transparent", color: on ? T.greenDk : T.ink,
                       borderRadius: 99, padding: "5px 12px", fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
              {o.label}
            </button>
          );
        })}
      </div>
      <div className="dash-tiles">
        <Figure variant="tile" figureKey={"retention-" + cur.key} value={cur.value} kind="percent" label={`Retention · ${cur.label}`}
          definition={cur.definition} source={cur.source} blank={cur.blank} blankShort={cur.blankShort}
          sub={kept && prior && prior.value > 0 ? (
            <>
              <Figure variant="inline" figureKey={"ret-kept-" + cur.key} value={kept.value} kind="count" label={kept.label}
                definition={kept.definition} source={kept.source} /> of the{" "}
              <Figure variant="inline" figureKey={"ret-prior-" + cur.key} value={prior.value} kind="count" label={prior.label}
                definition={prior.definition} source={prior.source} /> people gave again.
            </>
          ) : null} />
      </div>
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 8, lineHeight: 1.5 }}>{cur.definition}</div>
    </section>
  );
}

export function FundraisingBody({ get }) {
  const funnel = get("pipelineFunnel");
  const each = get("givingEachMonth");
  return (
    <>
      <div className="dash-tiles">
        <Tile m={get("pledgedOutstanding")} />
        <Tile m={get("pledgedPaid")} />
      </div>
      {each && Array.isArray(each.value) && each.value.length > 0 && (
        <section className="dash-card" style={{ marginTop: 16 }}>
          <GivingLine m={each} />
        </section>
      )}
      <div className="dash-two even">
        <LevelBars m={get("byGivingLevel")} />
        <RetentionChoice m={get("retentionChoice")} />
      </div>
      <div className="dash-two">
        <RowsCard m={get("goals")} empty="No active goals. A goal set in Fundraising shows here with its pace.">
          {(r, i) => <GoalRow key={i} r={r} first={i === 0} />}
        </RowsCard>
        <RowsCard m={get("grantDeadlines")} empty="No grant deadlines in the next ninety days." />
      </div>
      {funnel && <div style={{ marginTop: 16 }}><RowsCard m={funnel} empty="Nobody is assigned to an officer yet." /></div>}
    </>
  );
}

export function PeopleBody({ get, openPerson }) {
  return (
    <>
      <div className="dash-tiles">
        <Tile m={get("driftingAmongTop")} />
        <Tile m={get("milestonesThisQuarter")} />
        <Tile m={get("giftsNotYetThanked")} />
      </div>
      <div className="dash-two">
        <RowsCard m={get("topDonors")} empty="Nobody has given yet this fiscal year.">
          {(r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "9px 0",
                                  borderTop: i === 0 ? "none" : "1px solid " + T.bg2 }}>
              <DonorLink id={r.id} onOpen={openPerson ? () => openPerson(r.id) : undefined}
                style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 13.5, color: T.ink, cursor: "pointer",
                         textAlign: "left", minWidth: 0, overflowWrap: "anywhere" }}>{r.label}</DonorLink>
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                <Figure variant="cell" figureKey={"top-" + r.id} value={r.value} kind="money" label={`${r.label} · given this year`}
                  definition="Every gift this person gave this fiscal year." source={r.source} />
              </span>
            </div>
          )}
        </RowsCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <RowsCard m={get("concentration")} empty="Nobody has given yet this fiscal year." />
          <RowsCard m={get("thisWeek")} />
        </div>
      </div>
    </>
  );
}

export function RecurringBody({ get }) {
  return (
    <>
      <div className="dash-tiles">
        <Tile m={get("mrr")} />
        <Tile m={get("mrrTrend")} />
        <Tile m={get("failuresCaught")} />
        <Tile m={get("failuresRecovered")} />
        <Tile m={get("avgMonthsOnFile")} />
        <Tile m={get("sourceRecurring")} />
        <Tile m={get("sourceRecurringUnconfirmed")} />
      </div>
      <div style={{ marginTop: 16 }}>
        <RowsCard m={get("byStatus")} empty="No monthly gifts on file yet." />
      </div>
    </>
  );
}

// NAV-1 §2 — DASHBOARDS LIVES INSIDE REPORTS NOW, as the first group of its
// one rail. When `dashKey` is given, the caller's rail is choosing which
// dashboard this is and this component draws no rail of its own: two left
// rails side by side would be exactly the scanning problem NAV-1 set out to
// fix. Called with no `dashKey` it is the screen it always was, rail and all,
// so nothing about it is deleted.
export function Dashboards({ data, onNavigate, dashKey }) {
  const [rail, setRail] = useState([]);
  const [ownKey, setOwnKey] = useState("board");
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const t = makeT(data?.org?.vocabulary);
  const ownRail = !dashKey;
  const key = dashKey || ownKey;

  useEffect(() => { if (ownRail) apiFetch("/dashboards").then(r => setRail(r.dashboards || [])).catch(() => {}); }, [ownRail]);
  useEffect(() => {
    setLoading(true);
    apiFetch(`/dashboards/${key}`).then(r => { setBoard(r); setLoading(false); }).catch(() => setLoading(false));
  }, [key]);

  const metrics = board?.metrics || [];
  const get = k => metrics.find(m => m.key === k) || null;
  // A person row opens that person, through the app's own navigation.
  const openPerson = id => { if (id && onNavigate) onNavigate("donors", { selectDonorId: id }); };

  async function exportPdf() {
    // The PDF is fetched, not linked: it rides the same Authorization header
    // as every other read, so a board packet is never a URL somebody can pass
    // around without a session.
    const r = await fetch(`${API}/dashboards/${key}/pdf`, { headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") } });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${key}-${board?.asOf || "dashboard"}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  const asOf = board ? (board.asOfLabel || displayDate(board.asOf)) : "";
  return (
    <FigureContext.Provider value={{ openPerson }}>
      <style>{DASH_CSS}</style>
      <div className="dash-page">
        {/* The rail is the SERVER's list, so it cannot drift from what exists.
            Its active item is cream's shade with a 3px emerald rule, never a
            solid green block (FIX-2 C's rule). */}
        {ownRail && <nav className="dash-rail" aria-label="Dashboards">
          {rail.map(d => {
            const on = key === d.key;
            return (
              <button key={d.key} data-dash-key={d.key} aria-current={on ? "page" : undefined} onClick={() => setOwnKey(d.key)}
                style={{ textAlign: "left", padding: "10px 12px 10px 15px", borderRadius: 8, cursor: "pointer", border: "none",
                         background: "transparent", color: T.ink, fontWeight: 400, ...activeMark(on, "left") }}>
                <div style={{ fontSize: 13.5, fontWeight: on ? 700 : 600 }}>{d.label}</div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 1 }}>{d.question}</div>
              </button>
            );
          })}
        </nav>}

        <div className="dash-main" data-dashboard={!loading && board ? board.key : undefined}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ minWidth: 0, flex: "1 1 420px" }}>
              <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>
                {board?.label || ""}{board?.question ? " · " + board.question : ""}
              </div>
              {/* THE ANSWER, in a sentence. A number in it is a figure too. */}
              <h1 className="dash-answer" data-dash-answer>
                {(board?.answer?.parts || []).map((p, i) => p.figure
                  ? <Figure key={i} variant="inline" abs figureKey={p.figure.key} value={p.figure.value} kind={p.figure.kind}
                      label={p.figure.label} definition={p.figure.definition} source={p.figure.source} />
                  : <span key={i}>{p.text}</span>)}
              </h1>
              <div style={{ fontSize: 12.5, color: T.ink3 }}>
                As of {asOf}{board?.fiscalYear?.label ? ` · fiscal year ${board.fiscalYear.label}` : ""}. Numbers a board can read, and every one opens: click it to see the rows behind it.
              </div>
            </div>
            <button onClick={exportPdf} disabled={!board}
              style={{ background: T.bgCard, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "8px 14px",
                       color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: board ? "pointer" : "not-allowed", flexShrink: 0 }}>
              Export PDF
            </button>
          </div>

          {loading && <div style={{ padding: 30 }}><Spin /></div>}
          {!loading && board?.key === "board" && <BoardBody get={get} />}
          {!loading && board?.key === "fundraising" && <FundraisingBody get={get} />}
          {!loading && board?.key === "people" && <PeopleBody get={get} openPerson={openPerson} />}
          {!loading && board?.key === "recurring" && <RecurringBody get={get} />}
          {!loading && board?.key === "people" && (
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 12, lineHeight: 1.6 }}>
              Drift watches every {t("giver", 1)}’s own giving pattern.{" "}
              <button onClick={() => onNavigate && onNavigate("dashboard")}
                style={{ background: "none", border: "none", color: T.greenDk, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                See who is drifting today
              </button>
            </div>
          )}
        </div>
      </div>
    </FigureContext.Provider>
  );
}
