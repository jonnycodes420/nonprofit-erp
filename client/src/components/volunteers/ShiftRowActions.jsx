// STALE-2 (W-1107-Volunteers-12) · A LOGGED SHIFT CAN BE CHANGED WHERE IT IS
// LISTED. Recent shifts on the Volunteers page had Remove and nothing else, so
// a shift logged with the wrong hours had to be removed and logged again.
// Edit changes its hours, date and role in place (PATCH /volunteer-shifts/:id,
// the same door the profile's hours log uses); the audit trail records the
// before and after, as for every write.
import { useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

export default function ShiftRowActions({ s, onRemove, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");
  if (!edit) return (
    <span style={{ display: "inline-flex", gap: 10, whiteSpace: "nowrap" }}>
      <button data-testid="vol-shift-edit" onClick={() => { setMsg(""); setEdit({ date: String(s.date || "").slice(0, 10), hours: String(s.hours), role: s.role || "" }); }}
        style={btnLink} aria-label={`Change the shift on ${s.date}`}>Edit</button>
      <button onClick={() => onRemove(s.id)} style={{ ...btnLink, color: T.ink3, fontWeight: 600 }} aria-label={`Remove the shift on ${s.date}`}>Remove</button>
    </span>);
  const save = async () => {
    setMsg("");
    try {
      await apiFetch(`/volunteer-shifts/${s.id}`, { method: "PATCH", body: JSON.stringify({ date: edit.date, hours: edit.hours, role: edit.role }) });
      setEdit(null); onSaved();
    } catch (e) { setMsg(errorMessage(e, "That change did not save.")); }
  };
  return (
    <span data-testid="vol-shift-editing" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input aria-label="Date" type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} style={inp} />
      <input aria-label="Hours" type="number" step="0.25" min="0.25" max="24" value={edit.hours} onChange={e => setEdit({ ...edit, hours: e.target.value })} style={{ ...inp, width: 72 }} />
      <input aria-label="What they did" value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value })} style={{ ...inp, width: 130 }} />
      <button data-testid="vol-shift-save" onClick={save} disabled={!edit.date || !edit.hours} style={btnLink}>Save</button>
      <button onClick={() => setEdit(null)} style={{ ...btnLink, color: T.ink3, fontWeight: 600 }}>Cancel</button>
      {msg && <span role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</span>}
    </span>);
}
