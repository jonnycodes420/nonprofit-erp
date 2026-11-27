// VOL-3 items 1 and 2 · A VOLUNTEER'S STATUS, AND WHAT ADD ASKED FOR, EDITABLE.
//
// Status: Active, Paused or Former, with the day it was set and who set it, through the one
// writer (POST /donors/:id/volunteer-status). Marking somebody former keeps the Volunteer role,
// their hours and their history; Undo (POST …/volunteer-status/undo) puts back the status before
// it, with its own day and setter.
// The record: hours a week, the days they can come and their roles, the same fields Add a
// volunteer asks for, edited in place (PATCH /donors/:id/volunteer-record). Never an application.
import { useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { AVAILABILITY } from "../../../../shared/volunteerApply.js";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import { askConfirm } from "../ConfirmDialog";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const eyebrow = { fontSize: 10, fontWeight: 800, color: T.ink3 };

export function VolunteerStatusRecord({ donor, record, isReadOnly, onChanged }) {
  const [msg, setMsg] = useState("");
  // POLISH-11 item 2: Undo is open while the record says so (a day after the change), on every visit.
  const [undo, setUndo] = useState(!!(record && record.undoUntil && Date.parse(record.undoUntil) > Date.now()));
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const rec = record || { status: "active", statusWord: "Active", availability: [], roles: [], hoursPerWeek: null };
  const call = async (path, body, method = "POST") => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch(path, { method, body: JSON.stringify(body || {}) }); onChanged && onChanged(); return r; }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); return null; }
    finally { setBusy(false); }
  };
  const setStatus = async status => {
    const r = await call(`/donors/${donor.id}/volunteer-status`, { status });
    if (r) { setMsg(r.sentence); setUndo(!!r.undo); }
  };
  const doUndo = async () => {
    const r = await call(`/donors/${donor.id}/volunteer-status/undo`);
    if (r) { setMsg(r.sentence); setUndo(false); }
  };
  const saveEdit = async () => {
    // FRESH-4 item 4 (W-1126-Volunteers-01): an emptied Hours a week clears what was said. Ask first, never silently.
    if (rec.hoursPerWeek != null && String(edit.hoursPerWeek || "").trim() === "") {
      const ok = await askConfirm({ title: "Clear hours a week?", body: `${donor.name || "They"} said ${rec.hoursPerWeek} ${rec.hoursPerWeek === 1 ? "hour" : "hours"} a week. Saving with the box empty clears it.`, yes: "Clear it", no: "Keep it" });
      if (!ok) return;
    }
    const r = await call(`/donors/${donor.id}/volunteer-record`, { hoursPerWeek: edit.hoursPerWeek, availability: edit.availability, roles: edit.roles }, "PATCH");
    if (r) { setEdit(null); setMsg("Saved. " + r.sentence); setUndo(false); }
  };
  const toggleDay = d => setEdit(e => ({ ...e, availability: e.availability.includes(d) ? e.availability.filter(x => x !== d) : [...e.availability, d] }));
  const said = [rec.hoursPerWeek != null ? `${rec.hoursPerWeek} ${rec.hoursPerWeek === 1 ? "hour" : "hours"} a week` : null,
    rec.availability.length ? rec.availability.join(", ") : null,
    (rec.roles || []).length ? `as ${rec.roles.join(", ")}` : null].filter(Boolean).join(" · ");
  const others = ["active", "paused", "former"].filter(s => s !== rec.status);
  const ACT = { active: "Make active", paused: "Pause", former: "Mark as former" };
  return (
    <div data-testid="volunteer-status-record" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={eyebrow}>Status</span>
        <span data-testid="volunteer-status" data-status={rec.status} style={{ fontSize: 13, fontWeight: 700, color: rec.status === "active" ? T.ink : T.gold700 }}>{rec.statusWord}</span>
        <span data-testid="volunteer-status-since" style={{ fontSize: 12.5, color: T.ink3 }}>
          {rec.statusOn ? `since ${displayDate(rec.statusOn)}${rec.statusBy ? `, set by ${rec.statusBy}` : ""}` : "Nobody has changed it, so they count as active."}
        </span>
        {!isReadOnly && others.map(s => (
          <button key={s} type="button" style={btnLink} disabled={busy} data-testid={`volunteer-status-${s}`} onClick={() => setStatus(s)}>{ACT[s]}</button>))}
      </div>
      {!edit ? (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={eyebrow}>Can give</span>
          <span data-testid="volunteer-record-line" style={{ fontSize: 13, color: said ? T.ink : T.ink3 }}>{said || "Nothing said yet: hours a week, days or roles."}</span>
          {!isReadOnly && <button type="button" style={btnLink} data-testid="volunteer-record-edit"
            onClick={() => { setMsg(""); setEdit({ hoursPerWeek: rec.hoursPerWeek != null ? String(rec.hoursPerWeek) : "", availability: [...rec.availability], roles: (rec.roles || []).join(", ") }); }}>Edit</button>}
        </div>
      ) : (
        <div data-testid="volunteer-record-form" style={{ background: T.bg, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Hours a week
            <input aria-label="Hours a week" inputMode="decimal" value={edit.hoursPerWeek} onChange={e => setEdit({ ...edit, hoursPerWeek: e.target.value })} style={{ ...inp, width: 80 }} />
          </label>
          <div role="group" aria-label="When they can come" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: T.ink }}>When they can come</span>
            {AVAILABILITY.map(d => (
              <label key={d} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 99, padding: "3px 9px", cursor: "pointer", background: T.white }}>
                <input type="checkbox" checked={edit.availability.includes(d)} onChange={() => toggleDay(d)} />{d}
              </label>))}
          </div>
          <label style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Roles
            <input aria-label="Roles" value={edit.roles} placeholder="Food drive, Driver" onChange={e => setEdit({ ...edit, roles: e.target.value })} style={{ ...inp, flex: "1 1 200px" }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btnQuiet} disabled={busy} onClick={saveEdit} data-testid="volunteer-record-save">Save</button>
            <button type="button" style={btnLink} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && (
        <div role="status" data-testid="volunteer-status-msg" style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <span>{msg}</span>
          {undo && !isReadOnly && <button type="button" style={btnLink} disabled={busy} onClick={doUndo} data-testid="volunteer-status-undo">Undo</button>}
        </div>)}
    </div>
  );
}
