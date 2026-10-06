// GrantWork.jsx · GRANTS-1. ON A GRANT: ITS CHECKLIST AND ITS AWARD.
//
// GrantChecklist: tasks with an owner and a due date (each is an ordinary
// task, so it is on the Calendar and in Tasks). GrantAwardPlan: the award's
// instalments, each linked to the gift that paid it when it arrived, and the
// received total that foots to those gifts. Every change offers Undo.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : ""; };
const money2 = c => "$" + ((Number(c) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit", boxSizing: "border-box" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" };
const eyebrow = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 6 };

export function GrantChecklist({ grantId, isReadOnly }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/grants/${grantId}/checklist`).then(setD).catch(e => setMsg(errorMessage(e, "The checklist did not load.")));
  useEffect(() => { load(); }, [grantId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const put = (id, body) => apiFetch(`/grants/checklist/${id}`, { method: "PUT", body: JSON.stringify(body) });
  const add = async () => {
    setMsg("");
    try {
      const r = await apiFetch(`/grants/${grantId}/checklist`, { method: "POST", body: JSON.stringify(form) });
      setForm({ title: "", due: "", assignedTo: form.assignedTo }); load();
      offerUndo({ message: `Added "${r.title}".`, undoAction: async () => { const x = await put(r.id, { removed: true }); load(); return x; } }, "checklist item");
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  const change = async (t, body, words) => {
    setMsg("");
    try {
      const r = await put(t.id, body); load();
      const back = {};
      for (const k of Object.keys(body)) back[k] = k === "removed" ? false : r.previous[k];
      offerUndo({ message: words, undoAction: async () => { const x = await put(t.id, back); load(); return x; } }, "checklist item");
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  if (!d) return null;
  return (
    <div data-testid="grant-checklist" style={card}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
        <div style={eyebrow}>Checklist</div>
        {!isReadOnly && !form && <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setForm({ title: "", due: "", assignedTo: "" })} data-testid="checklist-add">Add a task</button>}
      </div>
      {!d.items.length && !form && <div style={{ fontSize: 13, color: T.ink3 }}>Nothing on the list. Add the pieces this application needs, each with who and when; each shows on the Calendar.</div>}
      {d.items.map(t => (
        <div key={t.id} data-testid="checklist-item" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
          <input type="checkbox" aria-label={`Done: ${t.title}`} checked={t.done} disabled={isReadOnly} onChange={() => change(t, { done: !t.done }, t.done ? `"${t.title}" is open again.` : `Ticked "${t.title}".`)} />
          <span style={{ flex: "1 1 180px", fontSize: 13.5, color: t.done ? T.ink3 : T.ink, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
          <span style={{ fontSize: 12, color: T.ink3 }}>{t.assignedToName || "No owner"}{t.due ? ` · ${day(t.due)}` : ""}</span>
          {!isReadOnly && <button type="button" style={{ ...btn(false), padding: "3px 9px", fontSize: 12 }} onClick={() => change(t, { removed: true }, `Took "${t.title}" off the checklist.`)}>Take off</button>}
        </div>))}
      {form && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input aria-label="Task" placeholder="What needs doing" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ ...inp, flex: "1 1 200px" }} data-testid="checklist-title" />
          <select aria-label="Owner" value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })} style={inp}>
            <option value="">No owner</option>{d.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input aria-label="Due" type="date" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} style={inp} />
          <button type="button" style={btn(true)} onClick={add} disabled={!form.title.trim()} data-testid="checklist-save">Add</button>
          <button type="button" style={btn(false)} onClick={() => setForm(null)}>Close</button>
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
    </div>);
}

export function GrantAwardPlan({ grantId, isReadOnly, onChanged }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/grants/${grantId}/award-plan`).then(setD).catch(e => setMsg(errorMessage(e, "The award did not load.")));
  useEffect(() => { load(); }, [grantId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const record = async () => {
    setMsg("");
    try {
      await apiFetch(`/grants/${grantId}/award`, { method: "PUT", body: JSON.stringify({ amountAwarded: form.amount, installmentCount: Number(form.count) || 1, frequency: form.frequency, firstDue: form.firstDue || undefined }) });
      setForm(null); load(); onChanged && onChanged();
    } catch (e) { setMsg(errorMessage(e, "The award did not save.")); }
  };
  if (!d) return null;
  return (
    <div data-testid="grant-award" style={card}>
      <div style={eyebrow}>The award, paid in instalments</div>
      <div data-testid="grant-award-sentence" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{d.sentence}</div>
      {d.installments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {d.installments.map(i => (
            <div key={i.id} data-testid="grant-installment" style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid " + T.bg3, fontSize: 13, flexWrap: "wrap" }}>
              <span style={{ minWidth: 92, color: T.ink2 }}>{day(i.dueDate)}</span>
              <span style={{ minWidth: 92, fontWeight: 700 }}>{money2(i.amountCents)}</span>
              <span style={{ color: i.gift ? T.greenDk : T.ink3 }}>{i.gift ? `Paid by the gift of ${day(i.gift.date)}, ${money2(i.gift.amountCents)}` : "Not paid yet. The gift links itself when it arrives."}</span>
            </div>))}
        </div>)}
      {!d.pledge && d.canRecord && !isReadOnly && (form ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input aria-label="Amount awarded" type="number" placeholder="Awarded $" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ ...inp, width: 130 }} />
          <input aria-label="Instalments" type="number" min="1" max="24" value={form.count} onChange={e => setForm({ ...form, count: e.target.value })} style={{ ...inp, width: 80 }} />
          <select aria-label="How often" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} style={inp}>
            {[["monthly", "Monthly"], ["quarterly", "Quarterly"], ["semiannual", "Every six months"], ["annual", "Yearly"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input aria-label="First payment due" type="date" value={form.firstDue} onChange={e => setForm({ ...form, firstDue: e.target.value })} style={inp} />
          <button type="button" style={btn(true)} onClick={record} disabled={!(Number(form.amount) > 0)}>Record the award</button>
          <button type="button" style={btn(false)} onClick={() => setForm(null)}>Cancel</button>
        </div>
      ) : <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => setForm({ amount: "", count: 2, frequency: "semiannual", firstDue: "" })} data-testid="award-record">Record the award</button>)}
      {msg && <div role="status" style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
    </div>);
}
