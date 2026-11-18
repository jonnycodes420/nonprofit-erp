// SALES-4 item 3 · the deal page's header: stage, value, next step and last touch at a glance,
// a proposed next step accepted with one click, and any stage move the calendar made, with Undo.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, EMERALD, BRASS, quiet, link, usd, dayWords, whenWords, failureWords } from "./salesBits";

export default function DealHeader({ id, reloadKey, onChanged }) {
  const [h, setH] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/deals/${encodeURIComponent(id)}/header`).then(d => setH(d.header)).catch(() => setH(null)), [id]);
  useEffect(() => { load(); }, [load, reloadKey]);
  if (!h) return null;
  const post = async (path, body) => { setMsg(null); try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body) }); setMsg(r.says || null); load(); onChanged(); } catch (e) { setMsg(failureWords(e, "Not done.")); } };
  const tile = (label, main, sub, testid, brass = false) => <div style={{ background: brass ? `${BRASS}33` : WHITE, borderRadius: 10, padding: "10px 12px", border: `1px solid ${brass ? BRASS : `${INK}14`}` }} data-deal-head={testid}>
    <div style={{ fontSize: 11.5, opacity: 0.65 }}>{label}</div><div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{main}</div>{sub ? <div style={{ fontSize: 12.5, opacity: 0.8 }}>{sub}</div> : null}</div>;
  const noNext = h.stageKind === "open" && !h.nextStep && !h.hasOpenTask;
  return <div style={{ background: CREAM, borderRadius: 12, padding: 12, marginBottom: 14 }} data-deal-header={id}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
      {tile("Stage", h.stage || "–", `${h.probability}% likely${h.org ? ` · ${h.org}` : ""}`, "stage")}
      {tile("Value", `${usd(h.valueCents)}/mo`, h.probability ? `${usd(Math.round((h.valueCents * h.probability) / 100))}/mo weighted` : null, "value")}
      {tile("Next step", h.nextStep || h.nextUp || "None", h.nextStepOn ? dayWords(h.nextStepOn) : h.nextUpOn ? `Task due ${dayWords(h.nextUpOn)}` : noNext ? "Nothing planned" : null, "next", noNext)}
      {tile("Last touch", h.lastTouch ? h.lastTouch.reason : "None yet", h.lastTouch ? `${whenWords(h.lastTouch.at)} · ${h.lastTouch.says || h.lastTouch.kind}` : h.sentences.lastTouch, "touch")}
    </div>
    {h.propose ? <div style={{ marginTop: 10, fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-deal-propose="1">
      <span style={{ opacity: 0.75 }}>Proposed next step:</span><b>{h.propose.body}, {dayWords(h.propose.due_on)}</b>
      <button type="button" style={{ ...quiet, minHeight: 28, padding: "3px 10px", borderColor: EMERALD, color: EMERALD }} onClick={() => post(`/ops/sales/deals/${encodeURIComponent(id)}/next-step`, h.propose)} data-deal-accept="1">Accept</button></div> : null}
    {h.moved.map(m => <div key={m.id} style={{ marginTop: 8, fontSize: 13 }} data-deal-moved={m.id}>{m.why}: moved from {m.from} to {m.to} on {whenWords(m.at)}.{" "}
      <button type="button" style={{ ...link, fontSize: 13 }} onClick={() => post(`/ops/sales/auto-moves/${encodeURIComponent(m.id)}/undo`, {})} data-deal-undo={m.id}>Undo</button></div>)}
    {msg ? <div style={{ marginTop: 6, fontSize: 12.5 }}>{msg}</div> : null}
  </div>;
}
