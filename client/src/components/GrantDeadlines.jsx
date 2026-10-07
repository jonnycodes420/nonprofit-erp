// BUILD-100 (grants) Part 7 — DEADLINES, ON SCREEN.
//
// Two surfaces over the ONE read, GET /grants/deadlines:
//   · DeadlinesView is Grants → Deadlines: the line Home also says, twelve
//     months (every month present, so an empty one is visibly empty — the
//     server's calendarFromMilestones), the open deadlines in date order, and
//     the org's own lead times.
//   · GrantDeadlinesPanel sits on a grant: its own deadlines, add one, move
//     one, mark one done.
// Nothing here computes a band, a timing sentence or a window — the server
// sends them from shared/grantMilestones.js, and this only draws them.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { deadlinesInWindow, HOME_WINDOW_DAYS } from "../../../shared/grantMilestones";
import { grantDeadlineSentence } from "../../../shared/homeNote";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const dayLabel = iso => { const c = civil(iso); return c ? `${c.d} ${MONTHS[c.mo - 1]}` : "Not set"; };
const monthLabel = ym => { const c = civil(ym + "-01"); return c ? `${MONTHS[c.mo - 1]} ${c.y}` : ym; };
const BAND_COLOR = { overdue: T.gold500, soon: T.greenDk, later: T.bg3 };
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };

function MilestoneRow({ m, onDone, onOpenGrant, isReadOnly, showGrant = true }) {
  return (
    <div data-testid="deadline-row" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: BAND_COLOR[m.band] || T.bg3 }} />
      <div style={{ minWidth: 64, fontSize: 13, fontWeight: 700, color: T.ink }}>{dayLabel(m.dueDate)}</div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>
          {m.kindLabel}
          {showGrant && <span style={{ fontWeight: 400, color: T.ink3 }}> · {m.funderName}{m.program ? ` · ${m.program}` : ""}</span>}
        </div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{m.sentence}</div>
        {m.waitingSentence && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{m.waitingSentence}</div>}
        {m.balance && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{m.balance.sentence}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        {showGrant && onOpenGrant && <button style={quietBtn} onClick={() => onOpenGrant(m.grantId)}>Open grant</button>}
        {!isReadOnly && <button style={quietBtn} data-testid="deadline-done" onClick={() => onDone(m)}>Done</button>}
      </div>
    </div>
  );
}

// ── Grants → Deadlines ──────────────────────────────────────────────────────
export function DeadlinesView({ isReadOnly, isAdmin, onOpenGrant }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [lead, setLead] = useState(null);
  const [headsUp, setHeadsUp] = useState(14);   // FIX-31: the "Start the proposal" task, days ahead; 0 is off
  const load = () => apiFetch("/grants/deadlines").then(d => { setData(d); setLead(d.leadDays); setHeadsUp(d.headsUpDays ?? 14); })
    .catch(e => { setMsg(errorMessage(e, "The deadlines could not be loaded.")); setData({ milestones: [], calendar: [], milestoneTypes: [] }); });
  useEffect(() => { load(); }, []);
  const done = async m => {
    setMsg("");
    try {
      await apiFetch(`/grants/milestones/${m.id}/done`, { method: "POST", body: "{}" }); load();
      offerUndo({ message: `Marked ${m.kindLabel || "the deadline"} done.`, undoAction: async () => { const x = await apiFetch(`/grants/milestones/${m.id}/reopen`, { method: "POST", body: "{}" }); load(); return x; } }, "deadline");
    }
    catch (e) { setMsg(errorMessage(e, "That deadline could not be marked done.")); }
  };
  const saveLead = async () => {
    setMsg("");
    try { const r = await apiFetch("/org/grant-lead-days", { method: "PUT", body: JSON.stringify({ leadDays: lead, headsUpDays: headsUp }) }); setLead(r.leadDays); setMsg("Lead times saved."); load(); }
    catch (e) { setMsg(errorMessage(e, "The lead times did not save.")); }
  };
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  const types = data.milestoneTypes || [];
  return (
    <div data-testid="deadlines-view" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div data-testid="deadlines-line" style={{ fontSize: 15, color: T.ink, lineHeight: 1.5 }}>
        {/* The SAME sentence Home says, over the same window function. */}
        {grantDeadlineSentence(deadlinesInWindow(data.milestones, data.today).length, HOME_WINDOW_DAYS) || "No grant deadline falls in the next two weeks."}
        {data.overdue > 0 && <span style={{ color: T.ink3 }}> {data.overdue === 1 ? "One is" : data.overdue + " are"} past the date and still open.</span>}
      </div>

      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, color: T.ink }}>The next twelve months</h3>
        <div data-testid="deadlines-calendar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {(data.calendar || []).map(mo => (
            <div key={mo.month} data-testid="calendar-month" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", minHeight: 84 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{monthLabel(mo.month)}</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>{mo.count || ""}</span>
              </div>
              {mo.items.length === 0 && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Nothing due</div>}
              {mo.items.slice(0, 4).map(it => (
                <button key={it.id} onClick={() => onOpenGrant && onOpenGrant(it.grantId)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "3px 0", cursor: onOpenGrant ? "pointer" : "default", fontSize: 12, color: T.ink, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{civil(it.dueDate)?.d}</span> {it.kindLabel} · <span style={{ color: T.ink3 }}>{it.funderName}</span>
                </button>))}
              {mo.items.length > 4 && <div style={{ fontSize: 12, color: T.ink3 }}>and {mo.items.length - 4} more</div>}
            </div>))}
        </div>
      </section>

      <section>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: T.ink }}>Open deadlines</h3>
        {!data.milestones.length && <div style={{ fontSize: 13, color: T.ink3 }}>No open deadlines. Add them from a grant, and Steward opens a follow-up when each comes close.</div>}
        {data.milestones.map(m => <MilestoneRow key={m.id} m={m} onDone={done} onOpenGrant={onOpenGrant} isReadOnly={isReadOnly} />)}
      </section>

      {lead && (
        <section data-testid="lead-days">
          <h3 style={{ margin: "0 0 4px", fontSize: 16, color: T.ink }}>How early Steward reminds you</h3>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }}>A follow-up opens this many days before each kind of deadline, owned by the grant's officer.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {types.map(t => (
              <label key={t.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink2 }}>
                {t.label}
                <input type="number" min="0" max="365" value={lead[t.key] ?? ""} disabled={!isAdmin || isReadOnly}
                  onChange={e => setLead({ ...lead, [t.key]: e.target.value === "" ? "" : Number(e.target.value) })} style={{ ...inp, width: 90 }} />
              </label>))}
          </div>
          <label data-testid="heads-up-days" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink2, marginTop: 12, flexWrap: "wrap" }}>
            A task to start each proposal, LOI and report
            <input type="number" min="0" max="90" value={headsUp} disabled={!isAdmin || isReadOnly}
              onChange={e => setHeadsUp(e.target.value === "" ? 0 : Number(e.target.value))} style={{ ...inp, width: 70 }} aria-label="Days ahead for the start task" />
            days ahead (0 turns it off)
          </label>
          {isAdmin && !isReadOnly && <button style={{ ...primaryBtn, marginTop: 10 }} onClick={saveLead}>Save lead times</button>}
        </section>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

// ── On a grant ──────────────────────────────────────────────────────────────
// FIX-28: any number of deadlines. Adding one leaves the form open for the
// next; each can be edited, moved, marked done or taken off, and every one of
// those offers Undo on the shared toast.
export function GrantDeadlinesPanel({ grantId, isReadOnly }) {
  const [all, setAll] = useState(null);
  const [doneList, setDoneList] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/grants/deadlines").then(d => {
    setAll((d.milestones || []).filter(m => m.grantId === grantId));
    setDoneList((d.doneMilestones || []).filter(m => m.grantId === grantId));
    setTypes(d.milestoneTypes || []);
  }).catch(e => { setAll([]); setMsg(errorMessage(e, "The deadlines could not be loaded.")); });
  useEffect(() => { load(); }, [grantId]);
  const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
  const put = (id, body) => apiFetch(`/grants/milestones/${id}`, { method: "PUT", body: JSON.stringify(body) });
  const nameOf = m => m.kindLabel || "Deadline";
  const add = async () => {
    setMsg("");
    try {
      const r = await post(`/grants/${grantId}/milestones`, form);
      setForm({ kind: form.kind, label: "", dueDate: "", notes: "" });
      setMsg(`${r.kindLabel || "Deadline"} added for ${dayLabel(r.dueDate)}. Add the next one, or close the form.`);
      offerUndo({ message: `Added ${r.kindLabel || "the deadline"}.`, undoAction: async () => { const x = await post(`/grants/milestones/${r.id}/remove`); load(); return x; } }, "deadline");
      load();
    } catch (e) { setMsg(errorMessage(e, "That deadline did not save.")); }
  };
  const saveEdit = async () => {
    setMsg("");
    const m = all.find(x => x.id === edit.id);
    try {
      await put(edit.id, { kind: edit.kind, label: edit.label, dueDate: edit.dueDate, notes: edit.notes });
      setEdit(null); load();
      offerUndo({ message: `Changed ${nameOf(m)}.`, undoAction: async () => { const x = await put(m.id, { kind: m.kind, label: m.label, dueDate: m.dueDate, notes: m.notes }); load(); return x; } }, "deadline");
    } catch (e) { setMsg(errorMessage(e, "That change did not save.")); }
  };
  const move = async (m, dueDate) => {
    setMsg("");
    try {
      await put(m.id, { dueDate }); load();
      offerUndo({ message: `Moved ${nameOf(m)} to ${dayLabel(dueDate)}.`, undoAction: async () => { const x = await put(m.id, { dueDate: m.dueDate }); load(); return x; } }, "deadline");
    } catch (e) { setMsg(errorMessage(e, "The date did not move.")); }
  };
  const done = async m => {
    setMsg("");
    try {
      await post(`/grants/milestones/${m.id}/done`); load();
      offerUndo({ message: `Marked ${nameOf(m)} done.`, undoAction: async () => { const x = await post(`/grants/milestones/${m.id}/reopen`); load(); return x; } }, "deadline");
    } catch (e) { setMsg(errorMessage(e, "That deadline could not be marked done.")); }
  };
  const reopen = async m => {
    setMsg("");
    try {
      await post(`/grants/milestones/${m.id}/reopen`); load();
      offerUndo({ message: `${nameOf(m)} is open again.`, undoAction: async () => { const x = await post(`/grants/milestones/${m.id}/done`); load(); return x; } }, "deadline");
    } catch (e) { setMsg(errorMessage(e, "That deadline could not be reopened.")); }
  };
  const remove = async m => {
    setMsg("");
    try {
      await post(`/grants/milestones/${m.id}/remove`); load();
      offerUndo({ message: `Took ${nameOf(m)} off this grant.`, undoAction: async () => { const x = await post(`/grants/milestones/${m.id}/reopen`); load(); return x; } }, "deadline");
    } catch (e) { setMsg(errorMessage(e, "That deadline could not be taken off.")); }
  };
  if (!all) return null;
  const kindFields = (v, set) => (<>
    <select value={v.kind} onChange={e => set({ ...v, kind: e.target.value })} style={inp} aria-label="Kind of deadline" data-testid="deadline-kind">
      {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>
    {v.kind === "custom" && <input placeholder="Name it, like Site visit" value={v.label} onChange={e => set({ ...v, label: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} aria-label="Deadline name" data-testid="deadline-label" />}
    <input type="date" value={v.dueDate} onChange={e => set({ ...v, dueDate: e.target.value })} style={inp} aria-label="Due date" data-testid="deadline-date" />
    <input placeholder="Notes (optional)" value={v.notes} onChange={e => set({ ...v, notes: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} aria-label="Notes" />
  </>);
  return (
    <div data-testid="grant-deadlines" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 }}>Deadlines Steward watches</div>
        {!isReadOnly && !form && <button style={{ ...quietBtn, marginLeft: "auto" }} data-testid="deadline-add"
          onClick={() => setForm({ kind: types[0]?.key || "", label: "", dueDate: "", notes: "" })}>Add a deadline</button>}
      </div>
      {/* FIX-31: "None yet" only when there are none; done ones are listed below. */}
      {!all.length && !form && <div data-testid="deadlines-empty" style={{ fontSize: 13, color: T.ink3 }}>{doneList.length
        ? "Nothing open. Add the next LOI, proposal, decision, report or renewal date."
        : "None yet. Add the LOI, proposal, decision, report or renewal date, or any other, and each shows on the Calendar and in Tasks."}</div>}
      {all.map(m => (
        <div key={m.id}>
          {edit && edit.id === m.id ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", padding: "10px 0", borderTop: "1px solid " + T.bg3 }}>
              {kindFields(edit, setEdit)}
              <button style={primaryBtn} onClick={saveEdit} disabled={!edit.dueDate} data-testid="deadline-edit-save">Save</button>
              <button style={quietBtn} onClick={() => setEdit(null)}>Cancel</button>
            </div>
          ) : <>
            <MilestoneRow m={m} onDone={done} isReadOnly={isReadOnly} showGrant={false} />
            {!isReadOnly && <div style={{ fontSize: 12, color: T.ink3, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingLeft: 16, paddingBottom: 6 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Move to
                <input type="date" key={m.dueDate} defaultValue={m.dueDate} onBlur={e => e.target.value && e.target.value !== m.dueDate && move(m, e.target.value)} style={inp} data-testid="deadline-move" /></label>
              <button style={quietBtn} data-testid="deadline-edit" onClick={() => setEdit({ id: m.id, kind: m.kind, label: m.label || "", dueDate: m.dueDate, notes: m.notes || "" })}>Edit</button>
              <button style={quietBtn} data-testid="deadline-remove" onClick={() => remove(m)}>Take off</button>
            </div>}
          </>}
        </div>))}
      {form && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          {kindFields(form, setForm)}
          <button style={primaryBtn} onClick={add} disabled={!form.dueDate || (form.kind === "custom" && !form.label.trim())} data-testid="deadline-save">Add</button>
          <button style={quietBtn} onClick={() => setForm(null)}>Close</button>
        </div>)}
      {doneList.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 2 }}>Done</div>
          {doneList.map(m => (
            <div key={m.id} data-testid="deadline-done-row" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: T.ink3, padding: "4px 0", flexWrap: "wrap" }}>
              <span style={{ minWidth: 64 }}>{dayLabel(m.dueDate)}</span>
              <span style={{ flex: "1 1 160px" }}>{m.kindLabel}{m.completedByName ? `, done by ${m.completedByName}` : ""}</span>
              {!isReadOnly && <button style={quietBtn} data-testid="deadline-reopen" onClick={() => reopen(m)}>Undo done</button>}
            </div>))}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
