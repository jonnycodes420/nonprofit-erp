import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull, SC, Pill, Card, PageTitle } from "./shared";

const EVENT_TYPES = {
  gala:          { label: "Gala",           icon: "•", color: "#8b5cf6" },
  cultivation:   { label: "Cultivation",    icon: "•", color: "#10b981" },
  site_visit:    { label: "Site Visit",     icon: "•", color: "#3b82f6" },
  board_meeting: { label: "Board Meeting",  icon: "•", color: "#0d5c3a" },
  volunteer:     { label: "Volunteer Day",  icon: "•", color: "#f59e0b" },
  webinar:       { label: "Webinar",        icon: "•", color: "#ec4899" },
  other:         { label: "Other",          icon: "•", color: "#6b7280" },
};

const STATUS_COLORS = { upcoming: "#3b82f6", completed: "#10b981", cancelled: "#6b7280" };

const ATT_COLORS = {
  invited: "#6b7280", confirmed: "#3b82f6", attended: "#10b981",
  no_show: "#ef4444", cancelled: "#6b7280",
};
const ATT_LABELS = {
  invited: "Invited", confirmed: "Confirmed", attended: "Attended",
  no_show: "No Show", cancelled: "Cancelled",
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status, small }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 99, padding: small ? "2px 8px" : "3px 10px",
      fontSize: small ? 10 : 11, fontWeight: 700, letterSpacing: "0.04em",
      textTransform: "capitalize",
    }}>{status}</span>
  );
}

function AttBadge({ status }) {
  const color = ATT_COLORS[status] || "#6b7280";
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 700,
    }}>{ATT_LABELS[status] || status}</span>
  );
}

function TypeBadge({ type }) {
  const t = EVENT_TYPES[type] || EVENT_TYPES.other;
  return (
    <span style={{
      background: t.color + "22", color: t.color, border: `1px solid ${t.color}44`,
      borderRadius: 99, padding: "2px 10px", fontSize: 10, fontWeight: 700,
    }}>{t.icon} {t.label}</span>
  );
}

// ── New Event Form Panel ────────────────────────────────────────────────────
function NewEventPanel({ onSave, onClose }) {
  const [form, setForm] = useState({
    name: "", eventType: "gala", date: new Date().toISOString().slice(0, 10),
    endDate: "", location: "", description: "", capacity: "", cost: "",
  });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const INP = { width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const LBL = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4, display: "block" };

  const save = async () => {
    if (!form.name.trim() || !form.date) return;
    setSaving(true);
    try {
      const evt = await apiFetch("/events", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(), eventType: form.eventType, date: form.date,
          endDate: form.endDate || null, location: form.location || null,
          description: form.description || null,
          capacity: form.capacity ? parseInt(form.capacity) : null,
          cost: form.cost ? parseFloat(form.cost) : 0,
        }),
      });
      onSave(evt);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "#0f1a12aa" }} />
      <div style={{ position: "relative", width: 420, background: T.white, height: "100%", overflowY: "auto", padding: "28px 28px 40px", boxShadow: "-8px 0 40px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>New Event</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div><label style={LBL}>Event Name *</label><input value={form.name} onChange={set("name")} placeholder="e.g. Spring Gala 2026" style={INP} autoFocus /></div>
        <div>
          <label style={LBL}>Event Type *</label>
          <select value={form.eventType} onChange={set("eventType")} style={{ ...INP, cursor: "pointer" }}>
            {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={LBL}>Date *</label><input type="date" value={form.date} onChange={set("date")} style={INP} /></div>
          <div><label style={LBL}>End Date</label><input type="date" value={form.endDate} onChange={set("endDate")} style={INP} /></div>
        </div>
        <div><label style={LBL}>Location</label><input value={form.location} onChange={set("location")} placeholder="Venue name or address" style={INP} /></div>
        <div><label style={LBL}>Description</label><textarea value={form.description} onChange={set("description")} rows={3} placeholder="What is this event about?" style={{ ...INP, resize: "vertical" }} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={LBL}>Capacity</label><input type="number" value={form.capacity} onChange={set("capacity")} placeholder="Max guests" style={INP} /></div>
          <div><label style={LBL}>Est. Cost ($)</label><input type="number" value={form.cost} onChange={set("cost")} placeholder="0" style={INP} /></div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={save} disabled={saving || !form.name.trim()} style={{ flex: 1, background: form.name.trim() ? T.greenDk : T.bg3, border: "none", borderRadius: 10, padding: "12px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: form.name.trim() ? "pointer" : "not-allowed" }}>
            {saving ? "Saving…" : "Create Event →"}
          </button>
          <button onClick={onClose} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Event Card ──────────────────────────────────────────────────────────────
function EventCard({ event, onManage, onAddAttendees }) {
  const t = EVENT_TYPES[event.event_type] || EVENT_TYPES.other;
  const cap = event.capacity;
  const confirmed = parseInt(event.confirmed_count) || 0;
  const attended = parseInt(event.attendee_count) || 0;
  const invited = parseInt(event.invited_count) || 0;
  const revenue = parseFloat(event.total_revenue) || 0;
  const pct = cap ? Math.min(100, Math.round((confirmed / cap) * 100)) : null;

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden", borderLeft: `3px solid ${t.color}`, display: "flex", flexDirection: "column", boxShadow: T.shadow }}>
      <div style={{ padding: "16px 18px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{t.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.name}</div>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
                {fmtDate(event.date)}{event.location ? ` · ${event.location}` : ""}
              </div>
            </div>
          </div>
          <StatusBadge status={event.status} small />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <TypeBadge type={event.event_type} />
          <span style={{ fontSize: 11, color: T.ink3, background: T.bg2, borderRadius: 99, padding: "2px 8px" }}>
            {attended} attended · {invited} total
          </span>
        </div>

        {cap > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.ink3, marginBottom: 4 }}>
              <span>{confirmed} / {cap} confirmed</span>
              <span>{pct}%</span>
            </div>
            <div style={{ height: 5, background: T.bg2, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: t.color, borderRadius: 3, transition: "width 0.4s" }} />
            </div>
          </div>
        )}

        {revenue > 0 && (
          <div style={{ fontSize: 12, color: "#1a6b4a", fontWeight: 700, marginBottom: 6 }}>
            {fmtFull(revenue)} raised
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid " + T.bg2, padding: "10px 14px", display: "flex", gap: 6 }}>
        <button onClick={() => onManage(event)} style={{ flex: 2, background: T.greenDk, border: "none", borderRadius: 7, padding: "7px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Manage →
        </button>
        <button onClick={() => onAddAttendees(event)} style={{ flex: 1, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 7, padding: "7px 0", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          + Guests
        </button>
      </div>
    </div>
  );
}

// ── Follow-up Task Modal ────────────────────────────────────────────────────
function FollowUpModal({ eventId, eventName, onDone, onClose }) {
  const [taskTitle, setTaskTitle] = useState(`Follow up with {{event_name}} attendee`);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const INP = { width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };

  const create = async () => {
    setSaving(true);
    try {
      const r = await apiFetch(`/events/${eventId}/follow-up`, {
        method: "POST",
        body: JSON.stringify({ taskTitle, dueDate, priority }),
      });
      setResult(r.count);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "#0f1a12cc", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: T.white, borderRadius: 18, padding: "28px 28px 24px", width: "100%", maxWidth: 440, boxShadow: T.shadowLg }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 4 }}>Create Follow-up Tasks</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 20 }}>Creates tasks for all <strong>Attended</strong> donors from {eventName}</div>

        {result !== null ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#1a6b4a", marginBottom: 8 }}>{result}</div>
            <div style={{ fontSize: 14, color: T.ink3, marginBottom: 20 }}>tasks created ✓</div>
            <button onClick={onDone} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "10px 24px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4 }}>Task Title Template</div>
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} style={INP} />
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>Use {"{{event_name}}"} — it will be replaced with "{eventName}"</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4 }}>Due Date</div>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={INP} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4 }}>Priority</div>
                  <select value={priority} onChange={e => setPriority(e.target.value)} style={{ ...INP, cursor: "pointer" }}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={create} disabled={saving} style={{ flex: 1, background: T.greenDk, border: "none", borderRadius: 10, padding: "12px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Creating…" : "Create Tasks →"}
              </button>
              <button onClick={onClose} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Event Detail ────────────────────────────────────────────────────────────
function EventDetail({ eventId, donors: allDonors, onClose, onEventUpdated }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingStatus, setEditingStatus] = useState(null);
  const [editingGift, setEditingGift] = useState(null);
  const [giftVal, setGiftVal] = useState("");
  const [savingAtt, setSavingAtt] = useState(null);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [donorSearch, setDonorSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [addingDonors, setAddingDonors] = useState(false);
  const [guestForm, setGuestForm] = useState({ name: "", email: "" });
  const [addingGuest, setAddingGuest] = useState(false);
  const [addMode, setAddMode] = useState("directory");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  const reload = async () => {
    try {
      const d = await apiFetch(`/events/${eventId}`);
      setEvent(d);
      setNotes(d.notes || "");
    } catch { }
    setLoading(false);
  };

  useEffect(() => { reload(); }, [eventId]);

  const patchAttendee = async (attId, patch) => {
    setSavingAtt(attId);
    try {
      const updated = await apiFetch(`/events/${eventId}/attendees/${attId}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
      setEvent(ev => ({
        ...ev,
        attendees: ev.attendees.map(a => a.id === attId ? { ...a, ...updated } : a),
      }));
    } catch(e) { alert(e.message); }
    setSavingAtt(null);
  };

  const removeAttendee = async (attId) => {
    if (!confirm("Remove this attendee?")) return;
    await apiFetch(`/events/${eventId}/attendees/${attId}`, { method: "DELETE" });
    setEvent(ev => ({ ...ev, attendees: ev.attendees.filter(a => a.id !== attId) }));
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      await apiFetch(`/events/${eventId}`, {
        method: "PUT",
        body: JSON.stringify({ ...event, notes, eventType: event.event_type }),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch { }
    setNotesSaving(false);
  };

  const addFromDirectory = async () => {
    if (!selectedIds.size) return;
    setAddingDonors(true);
    try {
      await apiFetch(`/events/${eventId}/attendees`, {
        method: "POST", body: JSON.stringify({ donorIds: [...selectedIds] }),
      });
      setSelectedIds(new Set());
      setDonorSearch("");
      await reload();
      if (onEventUpdated) onEventUpdated();
    } catch(e) { alert(e.message); }
    setAddingDonors(false);
  };

  const addGuest = async () => {
    if (!guestForm.name.trim()) return;
    setAddingGuest(true);
    try {
      await apiFetch(`/events/${eventId}/attendees`, {
        method: "POST", body: JSON.stringify(guestForm),
      });
      setGuestForm({ name: "", email: "" });
      await reload();
      if (onEventUpdated) onEventUpdated();
    } catch(e) { alert(e.message); }
    setAddingGuest(false);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    try {
      const updated = await apiFetch(`/events/${eventId}`, {
        method: "PUT", body: JSON.stringify(editForm),
      });
      setEvent(ev => ({ ...ev, ...updated }));
      setEditing(false);
      if (onEventUpdated) onEventUpdated();
    } catch(e) { alert(e.message); }
    setEditSaving(false);
  };

  if (loading || !event) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "#0f1a12", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#8fa896", fontSize: 13 }}>Loading…</div>
    </div>
  );

  const t = EVENT_TYPES[event.event_type] || EVENT_TYPES.other;
  const invitedCount = event.attendees?.filter(a => a.status === "invited").length || 0;
  const confirmedCount = event.attendees?.filter(a => a.status === "confirmed").length || 0;
  const attendedCount = event.attendees?.filter(a => a.status === "attended").length || 0;
  const noShowCount = event.attendees?.filter(a => a.status === "no_show").length || 0;
  const totalCount = event.attendees?.length || 0;
  const convRate = totalCount > 0 ? Math.round((attendedCount / totalCount) * 100) : 0;
  const totalGifts = event.attendees?.reduce((s, a) => s + (parseFloat(a.gift_amount) || 0), 0) || 0;
  const avgGift = attendedCount > 0 && totalGifts > 0 ? totalGifts / attendedCount : 0;
  const topDonor = event.attendees?.filter(a => a.gift_amount > 0).sort((a, b) => b.gift_amount - a.gift_amount)[0];

  const existingDonorIds = new Set((event.attendees || []).filter(a => a.donor_id).map(a => a.donor_id));
  const filteredDonors = (allDonors || []).filter(d =>
    !existingDonorIds.has(d.id) &&
    (d.name?.toLowerCase().includes(donorSearch.toLowerCase()) ||
     d.email?.toLowerCase().includes(donorSearch.toLowerCase()))
  );

  const INP_DARK = { background: "#0f1a12", border: "1px solid #2d4a35", borderRadius: 8, padding: "8px 10px", color: "#f0ede6", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "#0f1a12", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#0f1a12", borderBottom: "1px solid #1a2e1f", padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #2d4a35", borderRadius: 8, padding: "6px 12px", color: "#8fa896", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f0ede6", fontFamily: "'DM Serif Display',serif", lineHeight: 1.2 }}>{event.name}</div>
            <TypeBadge type={event.event_type} />
            <StatusBadge status={event.status} small />
          </div>
          <div style={{ fontSize: 12, color: "#8fa896", marginTop: 3 }}>
            {fmtDate(event.date)}{event.end_date ? ` – ${fmtDate(event.end_date)}` : ""}{event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => { setEditing(true); setEditForm({ name: event.name, eventType: event.event_type, date: event.date, endDate: event.end_date || "", location: event.location || "", description: event.description || "", capacity: event.capacity || "", status: event.status, revenue: event.revenue || 0, cost: event.cost || 0, notes: event.notes || "" }); }}
            style={{ background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: 8, padding: "7px 14px", color: "#f0ede6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Edit Event
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="event-detail-body" style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", overflow: "hidden" }}>

        {/* LEFT */}
        <div style={{ overflowY: "auto", padding: "20px 20px 32px 24px", display: "flex", flexDirection: "column", gap: 20, borderRight: "1px solid #1a2e1f" }}>

          {/* Stat tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              ["Invited", totalCount, "#8fa896"],
              ["Confirmed", confirmedCount, "#3b82f6"],
              ["Attended", attendedCount, "#10b981"],
              ["No Show", noShowCount, "#ef4444"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: c, fontFamily: "'DM Serif Display',serif", lineHeight: 1 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Revenue vs Cost */}
          {(parseFloat(event.cost) > 0 || parseFloat(event.revenue) > 0 || totalGifts > 0) && (() => {
            const totalRev = totalGifts || parseFloat(event.revenue) || 0;
            const cost = parseFloat(event.cost) || 0;
            const net = totalRev - cost;
            const maxVal = Math.max(totalRev, cost, 1);
            return (
              <div style={{ background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896", marginBottom: 12 }}>Revenue vs Cost</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[["Revenue", totalRev, "#10b981"], ["Cost", cost, "#ef4444"]].map(([lbl, val, col]) => (
                    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 60, fontSize: 11, color: "#8fa896", textAlign: "right", flexShrink: 0 }}>{lbl}</div>
                      <div style={{ flex: 1, height: 16, background: "#0f1a12", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${val > 0 ? Math.max((val / maxVal) * 100, 4) : 0}%`, background: col, borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ width: 72, fontSize: 11, fontWeight: 700, color: "#f0ede6", textAlign: "right", flexShrink: 0 }}>{fmtFull(val)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2d4a35", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#8fa896" }}>Net</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: net >= 0 ? "#10b981" : "#ef4444", fontFamily: "'DM Serif Display',serif" }}>{net >= 0 ? "+" : ""}{fmtFull(net)}</span>
                </div>
              </div>
            );
          })()}

          {/* Notes */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896", marginBottom: 8 }}>
              Notes {notesSaved && <span style={{ color: "#10b981", fontSize: 10, fontWeight: 600, marginLeft: 6 }}>Saved ✓</span>}
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={saveNotes}
              rows={4}
              placeholder="Event notes, debrief, next steps…"
              style={{ ...INP_DARK, resize: "vertical", lineHeight: 1.6 }}
            />
          </div>

          {/* Attendee table */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896" }}>Attendees ({totalCount})</div>
              {attendedCount > 0 && (
                <button onClick={() => setShowFollowUp(true)} style={{ background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: 8, padding: "5px 12px", color: "#c9a84c", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  ✦ Follow-up Tasks
                </button>
              )}
            </div>

            {/* Bulk mark attended */}
            {confirmedCount > 0 && (
              <button onClick={async () => {
                const confirmed = event.attendees.filter(a => a.status === "confirmed");
                for (const a of confirmed) await patchAttendee(a.id, { status: "attended" });
              }} style={{ background: "#10b98122", border: "1px solid #10b98144", borderRadius: 8, padding: "6px 12px", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
                ✓ Mark all confirmed as attended
              </button>
            )}

            {event.attendees?.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8fa896", fontStyle: "italic", padding: "16px 0" }}>No attendees yet. Add guests from the panel on the right.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 80px 90px 80px 32px", gap: 6, padding: "6px 10px", borderRadius: 8, background: "#0f1a12" }}>
                  {["Name", "Email", "Stage", "Status", "Gift", ""].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8fa896" }}>{h}</div>
                  ))}
                </div>
                {event.attendees.map(a => (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 80px 90px 80px 32px", gap: 6, padding: "8px 10px", borderRadius: 8, background: "#1a2e1f", border: "1px solid #2d4a35", alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f0ede6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "#8fa896", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email || "—"}</div>
                    <div>{a.stage ? <Pill label={a.stage} color={SC[a.stage] || "#6b7280"} /> : <span style={{ fontSize: 11, color: "#8fa896" }}>—</span>}</div>
                    <div>
                      {savingAtt === a.id ? (
                        <span style={{ fontSize: 11, color: "#8fa896" }}>Saving…</span>
                      ) : editingStatus === a.id ? (
                        <select
                          value={a.status}
                          onChange={async e => {
                            setEditingStatus(null);
                            await patchAttendee(a.id, { status: e.target.value });
                          }}
                          onBlur={() => setEditingStatus(null)}
                          autoFocus
                          style={{ background: "#0f1a12", border: "1px solid #2d4a35", borderRadius: 6, padding: "3px 6px", color: "#f0ede6", fontSize: 11, outline: "none", cursor: "pointer" }}
                        >
                          {Object.keys(ATT_LABELS).map(s => <option key={s} value={s}>{ATT_LABELS[s]}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setEditingStatus(a.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                          <AttBadge status={a.status} />
                        </button>
                      )}
                    </div>
                    <div>
                      {editingGift === a.id ? (
                        <input
                          type="number" value={giftVal} onChange={e => setGiftVal(e.target.value)}
                          onBlur={async () => { setEditingGift(null); await patchAttendee(a.id, { giftAmount: parseFloat(giftVal) || 0 }); }}
                          onKeyDown={async e => { if (e.key === "Enter") { e.target.blur(); } }}
                          autoFocus
                          style={{ background: "#0f1a12", border: "1px solid #2d4a35", borderRadius: 6, padding: "3px 6px", color: "#f0ede6", fontSize: 11, width: 72, outline: "none" }}
                        />
                      ) : (
                        <button onClick={() => { setEditingGift(a.id); setGiftVal(a.gift_amount || ""); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: a.gift_amount ? "#10b981" : "#8fa896", fontWeight: a.gift_amount ? 700 : 400 }}>
                          {a.gift_amount ? fmtFull(a.gift_amount) : "—"}
                        </button>
                      )}
                    </div>
                    <button onClick={() => removeAttendee(a.id)} style={{ background: "none", border: "none", color: "#ef444466", fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ overflowY: "auto", padding: "20px 24px 32px 20px", display: "flex", flexDirection: "column", gap: 20, background: "#0f1a12" }}>

          {/* Quick stats */}
          <div style={{ background: "#1a2e1f", border: "1px solid #2d4a35", borderRadius: 14, padding: "16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896", marginBottom: 12 }}>Event Stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["Conversion Rate", `${convRate}%`, convRate >= 70 ? "#10b981" : convRate >= 40 ? "#f59e0b" : "#8fa896"],
                ["Avg Gift", avgGift > 0 ? fmtFull(avgGift) : "—", "#10b981"],
                ["Top Donor", topDonor ? topDonor.name : "—", "#c9a84c"],
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#8fa896" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Add attendees */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8fa896", marginBottom: 10 }}>Add Attendees</div>

            {/* Toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "#1a2e1f", borderRadius: 8, padding: 3 }}>
              {[["directory", "From Directory"], ["guest", "Add Guest"]].map(([mode, label]) => (
                <button key={mode} onClick={() => setAddMode(mode)} style={{ flex: 1, background: addMode === mode ? "#0f1a12" : "transparent", border: addMode === mode ? "1px solid #2d4a35" : "none", borderRadius: 6, padding: "5px 0", color: addMode === mode ? "#f0ede6" : "#8fa896", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>

            {addMode === "directory" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={donorSearch} onChange={e => setDonorSearch(e.target.value)}
                  placeholder="Search donors…"
                  style={INP_DARK}
                />
                <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {filteredDonors.slice(0, 40).map(d => (
                    <button key={d.id} onClick={() => setSelectedIds(s => {
                      const n = new Set(s);
                      n.has(d.id) ? n.delete(d.id) : n.add(d.id);
                      return n;
                    })} style={{ display: "flex", alignItems: "center", gap: 8, background: selectedIds.has(d.id) ? "#0d5c3a22" : "#1a2e1f", border: `1px solid ${selectedIds.has(d.id) ? "#10b981" : "#2d4a35"}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selectedIds.has(d.id) ? "#10b981" : "#2d4a35"}`, background: selectedIds.has(d.id) ? "#10b981" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {selectedIds.has(d.id) && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#f0ede6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                        {d.lastAmount > 0 && <div style={{ fontSize: 10, color: "#8fa896" }}>Last gift: {fmtFull(d.lastAmount)}</div>}
                      </div>
                      {d.stage && <Pill label={d.stage} color={SC[d.stage] || "#6b7280"} />}
                    </button>
                  ))}
                  {filteredDonors.length === 0 && <div style={{ fontSize: 12, color: "#8fa896", padding: "12px 0", textAlign: "center" }}>No donors to add</div>}
                </div>
                {selectedIds.size > 0 && (
                  <button onClick={addFromDirectory} disabled={addingDonors} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {addingDonors ? "Adding…" : `Add ${selectedIds.size} donor${selectedIds.size > 1 ? "s" : ""} →`}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={guestForm.name} onChange={e => setGuestForm(f => ({ ...f, name: e.target.value }))} placeholder="Guest name *" style={INP_DARK} />
                <input value={guestForm.email} onChange={e => setGuestForm(f => ({ ...f, email: e.target.value }))} placeholder="Email (optional)" style={INP_DARK} />
                <button onClick={addGuest} disabled={addingGuest || !guestForm.name.trim()} style={{ background: guestForm.name.trim() ? T.greenDk : "#1a2e1f", border: "none", borderRadius: 8, padding: "9px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: guestForm.name.trim() ? "pointer" : "not-allowed" }}>
                  {addingGuest ? "Adding…" : "Add Guest →"}
                </button>
              </div>
            )}
          </div>

          {/* Follow-up tasks call-to-action */}
          {attendedCount > 0 && (
            <div style={{ background: "#1a2e1f", border: "1px solid #c9a84c44", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#c9a84c", marginBottom: 8 }}>Follow-up Tasks</div>
              <div style={{ fontSize: 12, color: "#8fa896", marginBottom: 10 }}>{attendedCount} donor{attendedCount !== 1 ? "s" : ""} attended — create follow-up tasks for each.</div>
              <button onClick={() => setShowFollowUp(true)} style={{ background: "#c9a84c22", border: "1px solid #c9a84c44", borderRadius: 8, padding: "8px 14px", color: "#c9a84c", fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%" }}>
                ✦ Create Follow-up Tasks
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit event modal */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "#0f1a12cc", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: T.white, borderRadius: 18, padding: "28px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: T.shadowLg }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>Edit Event</div>
              <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", fontSize: 22, color: T.ink3, cursor: "pointer" }}>×</button>
            </div>
            {[
              ["name", "Event Name", "text"],
              ["date", "Date", "date"],
              ["endDate", "End Date", "date"],
              ["location", "Location", "text"],
              ["capacity", "Capacity", "number"],
              ["cost", "Cost ($)", "number"],
              ["revenue", "Revenue ($)", "number"],
            ].map(([k, lbl, type]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4 }}>{lbl}</div>
                <input type={type} value={editForm[k] || ""} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))}
                  style={{ width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                />
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3, marginBottom: 4 }}>Status</div>
              <select value={editForm.status || "upcoming"} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                style={{ width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink, outline: "none", cursor: "pointer", boxSizing: "border-box" }}>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={saveEdit} disabled={editSaving} style={{ flex: 1, background: T.greenDk, border: "none", borderRadius: 10, padding: "12px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button onClick={() => setEditing(false)} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showFollowUp && (
        <FollowUpModal
          eventId={eventId}
          eventName={event.name}
          onDone={() => setShowFollowUp(false)}
          onClose={() => setShowFollowUp(false)}
        />
      )}
    </div>
  );
}

// ── Main Events Component ───────────────────────────────────────────────────
export function Events({ data, isReadOnly }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("upcoming");
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [addTarget, setAddTarget] = useState(null);

  const reload = async () => {
    try {
      const rows = await apiFetch("/events");
      setEvents(Array.isArray(rows) ? rows : []);
    } catch { }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = events.filter(e => {
    if (filter === "upcoming") return e.status === "upcoming" || e.date >= today;
    if (filter === "past") return e.status === "completed" || e.status === "cancelled" || e.date < today;
    return true;
  });

  // Stats
  const currentYear = new Date().getFullYear();
  const thisYear = events.filter(e => e.date?.startsWith(String(currentYear)));
  const totalAttendees = thisYear.reduce((s, e) => s + (parseInt(e.attendee_count) || 0), 0);
  const totalRevenue = thisYear.reduce((s, e) => s + (parseFloat(e.total_revenue) || 0), 0);
  const avgRate = (() => {
    const valid = thisYear.filter(e => parseInt(e.invited_count) > 0);
    if (!valid.length) return 0;
    return Math.round(valid.reduce((s, e) => s + (parseInt(e.attendee_count) || 0) / (parseInt(e.invited_count) || 1), 0) / valid.length * 100);
  })();

  if (selectedId) {
    return (
      <EventDetail
        eventId={selectedId}
        donors={data?.donors || []}
        onClose={() => { setSelectedId(null); reload(); }}
        onEventUpdated={reload}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageTitle main="Your" accent="events." />

      {/* Stats strip */}
      <div className="events-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[
          ["Events This Year", thisYear.length, T.ink],
          ["Total Attendees", totalAttendees, "#3b82f6"],
          ["Event Revenue", fmtFull(totalRevenue), "#10b981"],
          ["Avg Attendance Rate", `${avgRate}%`, "#8b5cf6"],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: "14px 16px", boxShadow: T.shadow }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'DM Serif Display',serif", lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: T.bg2, borderRadius: 10, padding: 3 }}>
          {[["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ background: filter === v ? T.white : "transparent", border: filter === v ? "1px solid " + T.bg3 : "none", borderRadius: 7, padding: "6px 16px", color: filter === v ? T.ink : T.ink3, fontSize: 13, fontWeight: filter === v ? 700 : 400, cursor: "pointer", boxShadow: filter === v ? T.shadow : "none" }}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "9px 20px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>
          + New Event
        </button>
      </div>

      {/* Event grid */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.ink3, padding: "32px 0", textAlign: "center" }}>Loading events…</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 6 }}>No {filter === "all" ? "" : filter} events yet</div>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 20 }}>Track galas, cultivation dinners, site visits, and more.</div>
          <button onClick={() => setShowNew(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "10px 24px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>Create Your First Event</button>
        </div>
      ) : (
        <div className="events-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {filtered.map(e => (
            <EventCard
              key={e.id}
              event={e}
              onManage={evt => setSelectedId(evt.id)}
              onAddAttendees={evt => setSelectedId(evt.id)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewEventPanel
          onSave={evt => { setEvents(prev => [evt, ...prev]); setShowNew(false); setSelectedId(evt.id); }}
          onClose={() => setShowNew(false)}
        />
      )}

      {addTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#0f1a12aa" }} onClick={() => setAddTarget(null)} />
      )}
    </div>
  );
}
