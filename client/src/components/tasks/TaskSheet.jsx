// client/src/components/tasks/TaskSheet.jsx · EDIT-1. THE TASK, OPENED: ONE SHEET, WHEREVER A TASK IS SHOWN.
//
// A customer (Nov 18): "I put in a task for Dec 2 … I want to edit it. Can I do that?? It doesn't
// seem like I can click into it?" On the Tasks page a task's title opened this sheet; on a
// person's profile (Coming up, the timeline, the Tasks tab) the title was plain text. The sheet
// moved here, out of Tasks.jsx, so the Tasks page and the profile open the SAME sheet and save
// through the same call (PATCH /tasks/:id). A done task opens too, so details can be added after
// it is ticked, with Reopen offered. Read-only shows the task with every field disabled and no
// Save. Escape closes it (the shared Modal).
import { useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { offerUndo } from "../EditHistory";
import { errorMessage } from "../../lib/domainError";
import { TASK_KINDS, recurPhrase } from "../../../../shared/taskShape.js";
import DateInput from "../inputs/LazyDateInput";

// Shared styles, above every line that reads them (the TDZ rule).
const inp = { background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "9px 11px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: T.ink3 };
const outlineBtn = { background: T.white, border: `1px solid ${T.ink}`, borderRadius: 8, padding: "5px 12px", minHeight: 44, fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const textBtn = { background: "none", border: "none", padding: "5px 8px", minHeight: 44, minWidth: 44, fontSize: 12, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" };
const RECUR_KNOWN = [`{"every":"week"}`, `{"every":"month"}`, `{"every":"month","nth":1,"weekday":1}`, `{"every":"quarter"}`, `{"every":"year"}`];

// The one save of an opened task. Both the Tasks page and the profile reach PATCH /tasks/:id here.
export const saveTaskEdit = (id, body) => apiFetch(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

// t: the row GET /tasks/:id answers. onFinish(t): Mark done; onReopen(t): a done task opened again.
export function TaskSheet({ t, team = [], onClose, onChanged, onError, onFinish, onReopen = null, isReadOnly }) {
  const [f, setF] = useState({ title: t.title, due: (t.due || "").slice(0, 10), time: t.due_time || "", priority: t.priority === "high" ? "high" : "medium",
    kind: t.kind, notes: t.notes || "", checklist: Array.isArray(t.checklist) ? t.checklist : [], recur: t.recur || null,
    assignedTo: t.assigned_to || "", reassignNote: "" });
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");   // said inside the sheet, where she is looking
  const fail = e => { setErr((e && e.sentence) || errorMessage(e, "That did not save.")); if (onError) onError(e); };
  const linked = !!t.link_kind;
  const done = Number(t.done) === 1 || t.done === true;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = { due: f.due, dueTime: f.time || null, priority: f.priority, kind: f.kind, notes: f.notes, checklist: f.checklist, recur: f.recur };
      if (!linked) body.title = f.title;
      if ((f.assignedTo || "") !== (t.assigned_to || "")) { body.assignedTo = f.assignedTo || null; body.reassignNote = f.reassignNote; }
      const row = await saveTaskEdit(t.id, body);
      await onChanged(row); onClose();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const del = async () => {
    try {
      const r = await apiFetch(`/tasks/${t.id}`, { method: "DELETE" });
      await onChanged(); onClose();
      offerUndo({ ...r, message: `Deleted: ${t.title}.`, onRestored: onChanged }, t.title);
    } catch (e) { fail(e); }
  };
  const addItem = () => { if (newItem.trim()) { setF({ ...f, checklist: [...f.checklist, { text: newItem.trim(), done: false }] }); setNewItem(""); } };
  return (
    <Modal onClose={onClose} title={linked ? t.title : "Task"} width={520}
      footer={<div data-testid="task-sheet" data-task-id={t.id} style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {!isReadOnly && !done && <button onClick={() => onFinish(t)} style={outlineBtn} data-testid="sheet-done">Mark done</button>}
          {!isReadOnly && done && onReopen && <button onClick={() => onReopen(t)} style={outlineBtn} data-testid="sheet-reopen">Reopen</button>}
          {!isReadOnly && (!linked || done) && <button onClick={del} data-testid="sheet-delete" style={textBtn}>Delete</button>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={textBtn}>{isReadOnly ? "Close" : "Cancel"}</button>
          {!isReadOnly && <button onClick={save} disabled={busy} data-testid="sheet-save" style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{busy ? "Saving…" : "Save"}</button>}
        </div>
      </div>}>
      <fieldset disabled={!!isReadOnly} style={{ border: "none", margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {done && <div data-testid="sheet-done-line" style={{ fontSize: 12.5, color: T.ink3 }}>This task is done. You can still add notes{isReadOnly ? "" : ", or Reopen it"}.</div>}
        {linked
          ? <div style={{ fontSize: 12.5, color: T.ink3 }}>{t.link_kind === "next_step" ? "This is a next step on the Thread. Its day moves the step too." : "This is a grant deadline. Its day moves the deadline too."}</div>
          : <label style={lbl}>Task<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} data-testid="sheet-title" style={inp} /></label>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...lbl, flex: "1 1 140px" }}>Day<DateInput value={f.due} onChange={e => setF({ ...f, due: e.target.value })} data-testid="sheet-due" style={inp} /></label>
          <label style={{ ...lbl, flex: "1 1 100px" }}>Time<input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} style={inp} /></label>
          <label style={{ ...lbl, flex: "1 1 110px" }}>Kind
            <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} style={inp}>{TASK_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          </label>
          <label style={{ ...lbl, flex: "1 1 110px" }}>Priority
            <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} style={inp}><option value="medium">Normal</option><option value="high">High</option></select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...lbl, flex: "1 1 180px" }}>Owner
            <select value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: e.target.value })} data-testid="sheet-owner" style={inp}>
              <option value="">Nobody yet</option>
              {/* The owner shows even before the team list arrives. */}
              {t.assigned_to && !team.some(u => u.id === t.assigned_to) && <option value={t.assigned_to}>{t.assigned_to_name || "Their owner"}</option>}
              {team.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </label>
          {!linked && <label style={{ ...lbl, flex: "1 1 180px" }}>Repeats
            <select value={f.recur ? JSON.stringify(f.recur) : ""} onChange={e => setF({ ...f, recur: e.target.value ? JSON.parse(e.target.value) : null })} style={inp}>
              <option value="">Does not repeat</option>
              <option value={RECUR_KNOWN[0]}>Every week</option>
              <option value={RECUR_KNOWN[1]}>Every month, same day</option>
              <option value={RECUR_KNOWN[2]}>Every month, first Monday</option>
              <option value={RECUR_KNOWN[3]}>Every quarter</option>
              <option value={RECUR_KNOWN[4]}>Every year, same date</option>
              {f.recur && !RECUR_KNOWN.includes(JSON.stringify(f.recur)) && <option value={JSON.stringify(f.recur)}>{recurPhrase(f.recur)}</option>}
            </select>
          </label>}
        </div>
        {(f.assignedTo || "") !== (t.assigned_to || "") && (
          <label style={lbl}>A note for them<input value={f.reassignNote} onChange={e => setF({ ...f, reassignNote: e.target.value })} placeholder="She asked for you by name." style={inp} /></label>
        )}
        {t.reassign_note && <div style={{ fontSize: 12.5, color: T.ink2 }}>Handed over with: {t.reassign_note}</div>}
        <label style={lbl}>Notes<textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} rows={3} data-testid="sheet-notes" style={{ ...inp, resize: "vertical" }} /></label>
        <div style={lbl}>Checklist
          {f.checklist.map((i, n) => (
            <label key={n} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              <input type="checkbox" checked={!!i.done} onChange={() => setF({ ...f, checklist: f.checklist.map((x, m) => m === n ? { ...x, done: !x.done } : x) })} />
              <span style={{ flex: 1, textDecoration: i.done ? "line-through" : "none" }}>{i.text}</span>
              {!isReadOnly && <button onClick={() => setF({ ...f, checklist: f.checklist.filter((_, m) => m !== n) })} aria-label={`Remove ${i.text}`} style={textBtn}>Remove</button>}
            </label>
          ))}
          {!isReadOnly && <div style={{ display: "flex", gap: 6 }}>
            <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add an item"
              onKeyDown={e => { if (e.key === "Enter") addItem(); }} style={inp} />
            <button onClick={addItem} style={outlineBtn}>Add</button>
          </div>}
        </div>
        {err && <div role="alert" data-testid="sheet-error" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
      </fieldset>
    </Modal>
  );
}
