// EventField.jsx · GIFTS-1. THE GIFT FORM'S EVENT FIELD.
//
// Optional. It searches the org's events, the most recent first
// (GET /event-choices), and hands back the event's id ("" for none). The
// same field sits on Add gift, a gift's edit, Snap a check's confirm, each
// deposit line and the event page's Record a gift.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { displayDate } from "../../../../shared/displayDate";

const base = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

export default function EventField({ value, onChange, style, testid = "gift-event", disabled = false, label = "Event (optional)" }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [named, setNamed] = useState(null);   // the chosen event, kept when a search hides it
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch(`/event-choices?q=${encodeURIComponent(q)}`).then(r => setList((r && r.events) || [])).catch(() => setList([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!value) { setNamed(null); return; }
    const hit = list.find(e => e.id === value);
    if (hit) setNamed(hit);
  }, [value, list]);
  const shown = named && !list.some(e => e.id === named.id) ? [named, ...list] : list;
  const words = e => `${e.name}${e.date ? ` · ${displayDate(e.date)}` : ""}`;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...(style || {}) }}>
      <input aria-label="Search events" placeholder="Search events" value={q} onChange={e => setQ(e.target.value)} disabled={disabled}
        data-testid={testid + "-search"} style={{ ...base, flex: "1 1 120px", minWidth: 0 }} />
      <select aria-label={label} value={value || ""} disabled={disabled} data-testid={testid}
        onChange={e => { const id = e.target.value; setNamed(shown.find(x => x.id === id) || null); onChange(id); }}
        style={{ ...base, flex: "2 1 180px", minWidth: 0 }}>
        <option value="">{label === "Event (optional)" ? "No event" : label}</option>
        {shown.map(e => <option key={e.id} value={e.id}>{words(e)}</option>)}
      </select>
    </div>
  );
}
