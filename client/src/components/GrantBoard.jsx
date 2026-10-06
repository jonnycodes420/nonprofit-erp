// GrantBoard.jsx · GRANTS-1. THE PIPELINE, AS A BOARD AND AS A LIST.
//
// Eight stages, every one present so an empty stage is visibly empty. Each
// card is the ask, the funder and the next deadline. Dragging a card (or, on
// a phone, choosing a stage) moves it through PATCH /grants/:id/stage, and
// the shared Undo toast puts it back exactly. Moving to Declined asks why,
// from the closed list; moving to Closed plans the renewal, and Undo takes
// both back. The list view reads the same rows with the same filters.
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { RecordLink } from "./RecordLink";
import { tabHref } from "../lib/appUrls";

const money = c => "$" + Math.round((Number(c) || 0) / 100).toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : ""; };
const chip = on => ({ background: on ? T.ink : T.white, color: on ? T.white : T.ink, border: "1px solid " + T.bg3, borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" });
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const askCents = g => (["awarded", "reporting", "closed"].includes(g.status) && g.amountAwardedCents ? g.amountAwardedCents : g.amountRequestedCents) || 0;

export default function GrantBoard({ onOpenGrant, onAdd, isReadOnly, refreshKey }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState(() => { try { return window.localStorage.getItem("steward_grant_view") || "board"; } catch { return "board"; } });
  const [f, setF] = useState({ stages: [], officerId: "", cycle: "", program: "", funderType: "" });
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState("");
  const [declining, setDeclining] = useState(null);
  const [msg, setMsg] = useState("");
  const narrow = typeof window !== "undefined" && window.innerWidth < 760;

  const load = () => {
    const qs = new URLSearchParams();
    if (f.officerId) qs.set("officerId", f.officerId);
    if (f.cycle) qs.set("cycle", f.cycle);
    if (f.program) qs.set("program", f.program);
    apiFetch(`/grants/pipeline?${qs}`).then(setData).catch(e => setMsg(errorMessage(e, "The pipeline did not load.")));
  };
  useEffect(() => { load(); }, [f.officerId, f.cycle, f.program, refreshKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setViewKeep = v => { setView(v); try { window.localStorage.setItem("steward_grant_view", v); } catch { /* private mode */ } };

  const rows = useMemo(() => (data ? data.grants : []).filter(g =>
    (!f.stages.length || f.stages.includes(g.status)) && (!f.funderType || g.funderType === f.funderType)), [data, f.stages, f.funderType]);

  const move = async (g, status, extra = {}) => {
    if (g.status === status) return;
    setMsg("");
    try {
      const r = await apiFetch(`/grants/${g.id}/stage`, { method: "PATCH", body: JSON.stringify({ status, ...extra }) });
      load();
      const renewal = r.renewal && r.renewal.renewalGrantId ? r.renewal : null;
      offerUndo({
        message: renewal ? `${r.sentence} ${r.renewal.sentence}` : (r.renewal && r.renewal.sentence ? `${r.sentence} ${r.renewal.sentence}` : r.sentence),
        undoAction: async () => {
          if (renewal) await apiFetch(`/grants/${g.id}/renewal/undo`, { method: "POST", body: "{}" }).catch(() => {});
          const x = await apiFetch(`/grants/${g.id}/stage`, { method: "PATCH", body: JSON.stringify({ status: r.previous.status, awardedAt: r.previous.awardedAt, declineReason: r.previous.declineReason, planRenewal: false }) });
          load(); return x;
        },
      }, "stage");
    } catch (e) {
      if (e && e.error === "decline_reason" || (e && /decline/i.test(String(e.code || e.error || "")))) { setDeclining({ g, reasons: (data && data.declineReasons) || [] }); return; }
      setMsg((e && e.sentence) || errorMessage(e, "That grant did not move."));
    }
  };
  const tryMove = (g, status) => (status === "declined" ? setDeclining({ g, reasons: (data && data.declineReasons) || [] }) : move(g, status));

  if (!data) return <div style={{ padding: 30, color: T.ink3, fontSize: 13 }}>{msg || "Loading the pipeline…"}</div>;
  const stages = data.statuses || [];
  const tile = Object.fromEntries((data.byStatus || []).map(s => [s.status, s]));

  const card = g => (
    <div key={g.id} data-testid="grant-card" draggable={!isReadOnly && !narrow}
      onDragStart={() => setDrag(g)} onDragEnd={() => { setDrag(null); setOver(""); }}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "9px 10px", cursor: isReadOnly ? "default" : "grab", opacity: drag && drag.id === g.id ? 0.45 : 1 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>
          <RecordLink to={tabHref("grants", { grantId: g.id })} onOpen={() => onOpenGrant(g.id)} draggable={false} data-record-link="grant">{g.funderName}</RecordLink>
        </div>
        {g.program && <div style={{ fontSize: 12, color: T.ink3, marginTop: 1 }}>{g.program}</div>}
        <div style={{ fontSize: 14, fontWeight: 800, color: T.greenDk, marginTop: 6 }}>{money(askCents(g))}</div>
        {g.nextDeadline && !["closed", "declined"].includes(g.status) && <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 2 }}>{g.nextDeadlineLabel || "Due"} {day(g.nextDeadline)}</div>}
      </div>
      {!isReadOnly && narrow && (
        <select aria-label={`Move ${g.funderName}`} value={g.status} onChange={e => tryMove(g, e.target.value)} style={{ ...inp, marginTop: 8, width: "100%", fontSize: 12.5 }} data-testid="grant-card-stage">
          {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>)}
    </div>);

  return (
    <div data-testid="grant-board" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{data.openPipeline && data.openPipeline.sentence}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[["board", "Board"], ["list", "List"]].map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setViewKeep(k)} style={chip(view === k)}>{l}</button>)}
        </div>
        <select aria-label="Officer" value={f.officerId} onChange={e => setF({ ...f, officerId: e.target.value })} style={inp}>
          <option value="">Every officer</option>{(data.officers || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select aria-label="Funder type" value={f.funderType} onChange={e => setF({ ...f, funderType: e.target.value })} style={inp}>
          <option value="">Every kind of funder</option>{(data.funderTypes || []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {(data.cycles || []).length > 0 && <select aria-label="Cycle" value={f.cycle} onChange={e => setF({ ...f, cycle: e.target.value })} style={inp}>
          <option value="">Every cycle</option>{data.cycles.map(c => <option key={c} value={c}>{c}</option>)}
        </select>}
        <input aria-label="Program" placeholder="Program" value={f.program} onChange={e => setF({ ...f, program: e.target.value })} style={{ ...inp, width: 140 }} />
        {!isReadOnly && onAdd && <button type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={onAdd} data-testid="grant-add">Add a grant</button>}
      </div>
      {view === "list" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {stages.map(s => <button key={s.key} type="button" aria-pressed={f.stages.includes(s.key)} style={chip(f.stages.includes(s.key))}
            onClick={() => setF({ ...f, stages: f.stages.includes(s.key) ? f.stages.filter(x => x !== s.key) : [...f.stages, s.key] })}>{s.label}</button>)}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}

      {view === "board" ? (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
          {stages.map(s => {
            const items = rows.filter(g => g.status === s.key);
            const t = tile[s.key];
            return (
              <div key={s.key} data-testid={`grant-col-${s.key}`}
                onDragOver={e => { e.preventDefault(); setOver(s.key); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(""); }}
                onDrop={() => { const g = drag; setDrag(null); setOver(""); if (g) tryMove(g, s.key); }}
                style={{ minWidth: 132, flex: "1 1 132px", background: over === s.key ? "rgba(13,92,58,0.08)" : T.bg2, borderRadius: 12, padding: 10,
                  outline: over === s.key ? `2px dashed ${T.greenDk}` : "2px dashed transparent", outlineOffset: -2 }}>
                <div style={{ marginBottom: 8, padding: "0 2px" }} title={t ? t.sentence : ""}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{s.label}</div>
                  <div style={{ fontSize: 11.5, color: T.ink3 }}>{items.length}{t && t.cents ? ` · ${money(t.cents)}` : ""}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(card)}
                  {!items.length && <div style={{ fontSize: 12, color: T.ink3, padding: "4px 2px" }}>Nothing at {s.label}.</div>}
                </div>
              </div>);
          })}
        </div>
      ) : (
        <div data-testid="grant-list" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: T.ink3, fontSize: 11.5 }}>
              {["Funder", "Program", "Stage", "Ask", "Next deadline", "Officer"].map(h => <th key={h} style={{ padding: "10px 12px", fontWeight: 700, borderBottom: "1px solid " + T.bg3 }}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(g => (
              <tr key={g.id} style={{ borderTop: "1px solid " + T.bg3 }}>
                <td style={{ padding: "9px 12px", fontWeight: 700 }}><RecordLink to={tabHref("grants", { grantId: g.id })} onOpen={() => onOpenGrant(g.id)}>{g.funderName}</RecordLink></td>
                <td style={{ padding: "9px 12px", color: T.ink2 }}>{g.program}</td>
                <td style={{ padding: "9px 12px" }}>{isReadOnly ? (stages.find(s => s.key === g.status) || {}).label
                  : <select aria-label={`Stage for ${g.funderName}`} value={g.status} onChange={e => tryMove(g, e.target.value)} style={{ ...inp, padding: "4px 8px", fontSize: 12.5 }}>
                      {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}</td>
                <td style={{ padding: "9px 12px", fontWeight: 700 }}>{money(askCents(g))}</td>
                <td style={{ padding: "9px 12px", color: T.ink2 }}>{g.nextDeadline ? `${g.nextDeadlineLabel || "Due"} ${day(g.nextDeadline)}` : ""}</td>
                <td style={{ padding: "9px 12px", color: T.ink2 }}>{g.officerName || ""}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={6} style={{ padding: 16, color: T.ink3 }}>No grant matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>)}

      {declining && <DeclineAsk g={declining.g} reasons={declining.reasons} onClose={() => setDeclining(null)}
        onPick={reason => { const g = declining.g; setDeclining(null); move(g, "declined", { declineReason: reason }); }} />}
    </div>
  );
}

function DeclineAsk({ g, reasons, onClose, onPick }) {
  const [r, setR] = useState(reasons[0] ? reasons[0].key : "other");
  return (
    <Modal onClose={onClose} width={400} ariaLabel="Why they declined">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Why did {g.funderName} decline?</div>
        <div style={{ fontSize: 13, color: T.ink2 }}>Next year's ask starts from this.</div>
        <select value={r} onChange={e => setR(e.target.value)} style={inp} aria-label="Reason">
          {reasons.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn(true)} onClick={() => onPick(r)}>Move to Declined</button><button type="button" style={btn(false)} onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>);
}
