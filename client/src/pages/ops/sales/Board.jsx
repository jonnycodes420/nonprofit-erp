// SALES-1 · the deals board: one column per stage of a pipeline, a deal is
// dragged to another stage (POST /ops/sales/deals/:id/stage, which keeps the
// history). A drop on Later asks for the revisit date and a drop on Lost for
// the reason, inline (no browser dialog). An open deal with no next step and
// no open task is marked in brass, the same rule as Today's line.
import { useRef, useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { INK, WHITE, CREAM, BRASS, says, btn, quiet, box, link, brassTag, usd, dayWords } from "./salesBits";

export default function Board({ rows, meta, open, onMoved }) {
  const [pipeId, setPipeId] = useState(meta.pipelines[0].id);
  const [drag, setDrag] = useState(null);   // only for the drop targets' outline
  const dragged = useRef(null);   // the deal in hand, read on drop (state may not have re-rendered yet)
  const [ask, setAsk] = useState(null);   // { deal, stage, value }
  const [msg, setMsg] = useState(null);
  const pipe = meta.pipelines.find(p => p.id === pipeId) || meta.pipelines[0];
  const deals = rows.filter(r => r.pipeline_id === pipe.id);

  const move = async (dealId, stage, extra = {}) => {
    setMsg(null);
    try { await apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/stage`, { method: "POST", body: JSON.stringify({ stage_id: stage.id, ...extra }) }); setAsk(null); onMoved(); }
    catch (e) { setMsg(e.message || "The deal did not move."); }
  };
  const drop = (e, stage) => {
    e.preventDefault();
    const id = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || (dragged.current && dragged.current.id);
    const d = deals.find(x => x.id === id) || null;
    dragged.current = null; setDrag(null);
    if (!d || d.stage_id === stage.id) return;
    if (stage.kind === "later" || stage.kind === "lost") { setAsk({ deal: d, stage, value: "" }); return; }
    move(d.id, stage);
  };

  return <div data-sales-board={pipe.id}>
    {meta.pipelines.length > 1 ? <select value={pipe.id} onChange={e => setPipeId(e.target.value)} style={{ ...box, marginBottom: 10 }} aria-label="Pipeline">
      {meta.pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : null}
    <p style={says}>Drag a deal to another stage. Brass: an open deal with no next step and no open task.</p>
    {msg ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not moved</span> {msg}</p> : null}
    {ask ? <div style={{ background: CREAM, padding: 10, borderRadius: 8, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-sales-board-ask={ask.stage.kind}>
      <b style={{ fontSize: 13 }}>Move {ask.deal.displayName} to {ask.stage.name}:</b>
      {ask.stage.kind === "later"
        ? <DateInput value={ask.value} onChange={e => setAsk(a => ({ ...a, value: e.target.value }))} style={box} aria-label="Revisit on" />
        : <input value={ask.value} onChange={e => setAsk(a => ({ ...a, value: e.target.value }))} placeholder="Why it was lost" style={{ ...box, minWidth: 240 }} aria-label="Lost reason" />}
      <button type="button" style={btn} disabled={!ask.value.trim()} onClick={() => move(ask.deal.id, ask.stage, ask.stage.kind === "later" ? { revisit_on: ask.value } : { lost_reason: ask.value })}>Move</button>
      <button type="button" style={quiet} onClick={() => setAsk(null)}>Cancel</button>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{ask.stage.kind === "later" ? "Later is not lost: it comes back in Today on this date." : "Lost needs a reason."}</span>
    </div> : null}
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
      {pipe.stages.map(s => {
        const here = deals.filter(d => d.stage_id === s.id);
        return <div key={s.id} data-board-stage={s.id} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, s)}
          style={{ flex: "1 1 0", minWidth: 118, background: CREAM, borderRadius: 10, padding: 8, minHeight: 180, outline: drag ? `1px dashed ${INK}33` : "none" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
          <div style={{ fontSize: 11.5, opacity: 0.65, marginBottom: 8 }}>{s.probability}% · {here.length} · {usd(here.reduce((n, d) => n + (d.value_cents || 0), 0))}</div>
          {here.map(d => {
            const bare = d.stage_kind === "open" && !d.next_step && !d.has_open_task;
            return <div key={d.id} draggable
              onDragStart={e => { dragged.current = d; if (e.dataTransfer) { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; } setDrag(d); }}
              onDragEnd={() => setDrag(null)}
              // The whole card opens the deal and drags it: a <button> inside would not start a drag in Chrome.
              role="button" tabIndex={0} aria-label={`${d.displayName}: open, or drag to another stage`}
              onClick={() => open("deal", d.id)} onKeyDown={e => { if (e.key === "Enter") open("deal", d.id); }} data-board-deal={d.id} data-bare={bare ? "1" : "0"}
              style={{ background: bare ? `${BRASS}33` : WHITE, border: `1px solid ${bare ? BRASS : `${INK}1a`}`, borderRadius: 8, padding: "8px 9px", marginBottom: 6, cursor: "grab" }}>
              <div style={{ ...link, fontSize: 13 }}>{d.displayName}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{usd(d.value_cents)}{d.primary_org_name ? ` · ${d.primary_org_name}` : ""}</div>
              <div style={{ fontSize: 11.5, marginTop: 2 }}>{d.stage_kind === "later" && d.revisit_on ? `Revisit ${dayWords(d.revisit_on)}` : d.stage_kind === "lost" ? (d.lost_reason || "") : d.next_step ? `Next: ${d.next_step}` : d.has_open_task ? "Has an open task" : bare ? "No next step" : ""}</div>
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
}
