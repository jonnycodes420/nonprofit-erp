// components/majorGifts/CarePlan.jsx · TOP100-1. THE PLAN OF CARE.
//
// One panel, on the person's profile (the rail, for admins and staff with the
// major gifts permission) and opened from a Top 100 row. The goal, the ask,
// the ask-by day, the owner and the stage, then the planned touches. Each
// touch is a real task: it shows in Tasks and on Home, and Done here is the
// same Done as everywhere (POST /tasks/:id/complete). A call, a visit, a tour
// or an ask asks how it went first, like any call or meeting, so Done on one
// of those opens Tasks.
//
// An Atlas proposal ("Make a plan of care for #4") waits here, for one press.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, fmtFull, stageName } from "../shared";
import { errorMessage } from "../../lib/domainError";
import DateInput from "../inputs/LazyDateInput";
import { useCanMajorGifts } from "../../lib/majorGifts";
import { touchesFromTemplate, touchKind } from "../../../../shared/careShape.js";

const NEEDS_OUTCOME = new Set(["call", "meeting"]);
const HEALTH_TINT = {
  behind: { bg: T.gold100, fg: T.gold700 }, on_track: { bg: T.green100, fg: T.greenDk },
  no_plan: { bg: T.bg2, fg: T.ink3 }, no_next: { bg: T.bg2, fg: T.ink2 },
};
export function HealthChip({ health }) {
  if (!health) return null;
  const t = HEALTH_TINT[health.key] || HEALTH_TINT.no_plan;
  return <span data-testid="care-health" title={health.sentence} style={{ background: t.bg, color: t.fg, borderRadius: 99, padding: "3px 10px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{health.label}</span>;
}
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
export function dayLabel(s) {
  if (!CIVIL.test(String(s || ""))) return "no date";
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
const dollarsToCents = v => { const n = Number(String(v || "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && String(v).trim() !== "" ? Math.round(n * 100) : null; };
const readProposal = donorId => {
  try { const p = JSON.parse(sessionStorage.getItem("steward.careProposal") || "null"); return p && p.donorId === donorId ? p : null; } catch { return null; }
};
const dropProposal = () => { try { sessionStorage.removeItem("steward.careProposal"); } catch { /* nothing kept */ } };

const btn = { background: T.green, border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer" };
const quiet = { background: "none", border: "1px solid " + T.bg3, borderRadius: 9, padding: "6px 12px", fontSize: 12, color: T.ink2, cursor: "pointer" };
const inp = { padding: "7px 9px", border: "1px solid " + T.bg3, borderRadius: 8, fontSize: 12.5, background: T.white, color: T.ink, boxSizing: "border-box" };
const lbl = { fontSize: 10.5, fontWeight: 800, color: T.ink3, display: "block", marginBottom: 3 };

export function CarePlanPanel({ donorId, isReadOnly, onChanged, onNavigate, compact = false }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ goal: "", ask: "", askBy: "" });
  const [touch, setTouch] = useState({ type: "visit", due: "", ownerId: "" });
  const [tplId, setTplId] = useState("builtin:quarterly");
  const [proposal, setProposal] = useState(() => readProposal(donorId));
  const [saveName, setSaveName] = useState(null);

  const load = useCallback(() => apiFetch(`/donors/${encodeURIComponent(donorId)}/care-plan`).then(r => {
    setD(r);
    setForm({ goal: r.plan?.goal || "", ask: r.plan?.askCents != null ? String(r.plan.askCents / 100) : "", askBy: r.plan?.askBy || "" });
  }).catch(e => setErr(errorMessage(e, "The plan of care did not load."))), [donorId]);
  useEffect(() => { load(); }, [load]);
  const changed = r => { if (r && r.donorId) setD(r); onChanged && onChanged(); };

  if (!d) return <div style={{ fontSize: 12, color: T.ink3, padding: 6 }}>{err || "Loading the plan of care…"}</div>;

  const act = async (fn, fallback) => {
    setErr(""); setMsg("");
    try { await fn(); } catch (e) { setErr(errorMessage(e, fallback)); }
  };
  const addToList = () => act(async () => {
    const r = await apiFetch("/top100/members", { method: "POST", body: JSON.stringify({ donorIds: [donorId] }) });
    setMsg(r.sentence || "Added."); await load(); onChanged && onChanged();
  }, "That person could not be added.");
  const savePlan = () => act(async () => {
    const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/care-plan`, { method: "PUT",
      body: JSON.stringify({ goal: form.goal, askCents: dollarsToCents(form.ask), askBy: form.askBy || null }) });
    setEditing(false); changed(r);
  }, "The plan could not be saved.");
  const addTouch = () => act(async () => {
    if (!touch.due) throw new Error("Pick the day for this touch.");
    const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/care-plan/touches`, { method: "POST", body: JSON.stringify(touch) });
    setTouch(t => ({ ...t, due: "" })); changed(r);
  }, "That touch could not be added.");
  const applyTemplate = id => act(async () => {
    const r = await apiFetch(`/donors/${encodeURIComponent(donorId)}/care-plan/template`, { method: "POST", body: JSON.stringify({ templateId: id }) });
    setMsg(`Added ${r.added} ${r.added === 1 ? "touch" : "touches"}. Each one is a task in Tasks.`);
    if (proposal) { dropProposal(); setProposal(null); }
    changed(r);
  }, "The template could not be applied.");
  const saveTemplate = () => act(async () => {
    const r = await apiFetch("/care-templates", { method: "POST", body: JSON.stringify({ name: saveName, fromDonorId: donorId }) });
    setSaveName(null); setMsg(`Saved "${r.template.name}" with ${r.template.touches.length} touches.`); await load();
  }, "The template could not be saved.");
  const done = t => act(async () => {
    if (!t.done && NEEDS_OUTCOME.has(touchKind(t.type))) {
      // A call or a visit is finished by saying how it went, where Tasks asks it.
      if (onNavigate) onNavigate("tasks", {}); else throw new Error("Finish a call or a visit in Tasks, where it asks how it went.");
      return;
    }
    await apiFetch(`/tasks/${encodeURIComponent(t.taskId)}/complete`, { method: "POST", body: JSON.stringify({ done: !t.done }) });
    await load(); onChanged && onChanged();
  }, "That touch could not be updated.");

  const tpl = (d.templates || []).find(t => t.id === (proposal ? proposal.templateId : tplId));
  const preview = proposal && tpl ? touchesFromTemplate(tpl, d.today) : [];

  return (
    <div data-testid="care-plan-panel" style={{ display: "flex", flexDirection: "column", gap: 12, color: T.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {d.onList
          ? <span data-testid="care-rank" style={{ fontSize: 13, fontWeight: 800 }}>#{d.rank} on {d.list.name}</span>
          : !isReadOnly && <button data-testid="add-to-top100" onClick={addToList} style={btn}>Add to {d.list.name}</button>}
        <HealthChip health={d.health} />
      </div>
      {d.health && <div style={{ fontSize: 11.5, color: T.ink3, marginTop: -6 }}>{d.health.sentence}</div>}

      {proposal && tpl && (
        <div data-testid="care-proposal" style={{ background: T.gold100, border: "1px solid " + T.gold500, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Atlas proposed {tpl.name}</div>
          <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>{preview.map(p => `${p.label} ${dayLabel(p.due)}`).join(" · ")}. Nothing is added until you say so.</div>
          {!isReadOnly && <div style={{ display: "flex", gap: 8 }}>
            <button data-testid="care-proposal-accept" onClick={() => applyTemplate(tpl.id)} style={btn}>Add these {preview.length} touches</button>
            <button onClick={() => { dropProposal(); setProposal(null); }} style={quiet}>Not now</button>
          </div>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit,minmax(150px,1fr))", gap: 8, fontSize: 12.5 }}>
        <div><span style={lbl}>Goal</span>{d.plan?.goal || <span style={{ color: T.ink3 }}>Not set</span>}</div>
        <div><span style={lbl}>Ask</span>{d.plan?.askCents != null ? fmtFull(d.plan.askCents / 100) : <span style={{ color: T.ink3 }}>Not set</span>}{d.plan?.askBy ? ` by ${dayLabel(d.plan.askBy)}` : ""}</div>
        <div><span style={lbl}>Owner</span>{d.owner ? d.owner.name : <span style={{ color: T.ink3 }}>Nobody yet</span>}</div>
        <div><span style={lbl}>Stage</span>{d.stage ? stageName(d.stage) : <span style={{ color: T.ink3 }}>Not placed</span>}</div>
      </div>
      {!isReadOnly && (editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label><span style={lbl}>Goal</span><input data-testid="care-goal" style={{ ...inp, width: "100%" }} value={form.goal} placeholder="Ask for $50,000 toward the arena by June 2027" onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} /></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label><span style={lbl}>Ask amount</span><input data-testid="care-ask" style={{ ...inp, width: 120 }} value={form.ask} placeholder="50,000" onChange={e => setForm(f => ({ ...f, ask: e.target.value }))} /></label>
            <label><span style={lbl}>Ask by</span><DateInput style={{ ...inp, width: 140 }} value={form.askBy} onChange={e => setForm(f => ({ ...f, askBy: e.target.value }))} /></label>
          </div>
          <div style={{ fontSize: 11, color: T.ink3 }}>The owner and the stage are the person's own: change them on the profile or the pipeline.</div>
          <div style={{ display: "flex", gap: 8 }}><button data-testid="care-save" onClick={savePlan} style={btn}>Save</button><button onClick={() => setEditing(false)} style={quiet}>Cancel</button></div>
        </div>
      ) : <div><button data-testid="care-edit" onClick={() => setEditing(true)} style={quiet}>{d.plan?.goal || d.plan?.askCents != null ? "Change the goal or ask" : "Set the goal and ask"}</button></div>)}

      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>Planned touches</div>
        {d.touches.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>None yet. Start from a template or add one below.</div>}
        {d.touches.map(t => (
          <div key={t.taskId} data-testid="care-touch" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid " + T.bg3 }}>
            <input type="checkbox" aria-label={`${t.label} done`} checked={t.done} disabled={isReadOnly} onChange={() => done(t)} />
            <span style={{ flex: 1, fontSize: 12.5, textDecoration: t.done ? "line-through" : "none", color: t.done ? T.ink3 : T.ink }}>
              {t.label} · {dayLabel(t.due)}{t.owner ? ` · ${t.owner.name}` : ""}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: t.status === "overdue" ? T.gold700 : T.ink3 }}>{t.status === "overdue" ? "Overdue" : t.status === "done" ? "Done" : "Planned"}</span>
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label><span style={lbl}>Touch</span>
              <select data-testid="care-touch-type" style={inp} value={touch.type} onChange={e => setTouch(t => ({ ...t, type: e.target.value }))}>
                {d.touchTypes.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select></label>
            <label><span style={lbl}>Day</span><DateInput style={{ ...inp, width: 130 }} value={touch.due} onChange={e => setTouch(t => ({ ...t, due: e.target.value }))} /></label>
            <label><span style={lbl}>Owner</span>
              <select style={inp} value={touch.ownerId} onChange={e => setTouch(t => ({ ...t, ownerId: e.target.value }))}>
                <option value="">{d.owner ? `${d.owner.name} (owner)` : "Me"}</option>
                {(d.owners || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></label>
            <button data-testid="care-add-touch" onClick={addTouch} style={btn}>Add touch</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select data-testid="care-template" style={inp} value={tplId} onChange={e => setTplId(e.target.value)}>
              {(d.templates || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button data-testid="care-apply-template" onClick={() => applyTemplate(tplId)} style={quiet}>Start from this template</button>
            {d.touches.length > 0 && (saveName == null
              ? <button onClick={() => setSaveName("")} style={quiet}>Save as a template</button>
              : <><input style={{ ...inp, width: 150 }} value={saveName} placeholder="Template name" onChange={e => setSaveName(e.target.value)} />
                  <button onClick={saveTemplate} style={btn}>Save</button></>)}
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: T.greenDk }}>{msg}</div>}
      {err && <div role="alert" style={{ fontSize: 12, color: T.gold700 }}>{err}</div>}
    </div>
  );
}

// The profile's rail: only for admins and staff with the major gifts permission.
// Folded like the cultivation plan, and open when Atlas left a proposal on it.
export function CarePlanRail({ donorId, isReadOnly, RailSection }) {
  const can = useCanMajorGifts();
  if (!can) return null;
  const pending = !!readProposal(donorId);
  return (
    <RailSection title="Plan of care" testid="dp-rail-care-plan" fold={!pending} foldOpenLabel="Hide" foldShutLabel="Show">
      <CarePlanPanel donorId={donorId} isReadOnly={isReadOnly} compact />
    </RailSection>
  );
}
