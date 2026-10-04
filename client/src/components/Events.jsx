import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api";
import { T, fmtFull, SC, Pill, Card, PageTitle, Modal } from "./shared";
import { offerUndo } from "./EditHistory";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { RecordLink, useUrlWriter } from "./RecordLink";
import { tabHref, urlParam } from "../lib/appUrls";
import { EventPageEditor } from "./EventPageEditor";
import { eventProgress, attendanceRate, seatingChart, nameTags, parties, seatFit, EVENT_FIGURES } from "../../../shared/eventShape";

// PARITY-4: one chair on the drawn seating chart, in px (the phone tap target).
const CHAIR = 44;

const EVENT_TYPES = {
  gala:          { label: "Gala",           icon: "•", color: T.ink },
  cultivation:   { label: "Cultivation",    icon: "•", color: T.greenDk },
  site_visit:    { label: "Site Visit",     icon: "•", color: T.greenDk },
  board_meeting: { label: "Board Meeting",  icon: "•", color: T.greenDk },
  volunteer:     { label: "Volunteer Day",  icon: "•", color: T.gold500 },
  webinar:       { label: "Webinar",        icon: "•", color: T.terracotta },
  other:         { label: "Other",          icon: "•", color: T.ink3 },
};

const STATUS_COLORS = { upcoming: T.greenDk, completed: T.greenDk, cancelled: T.ink3 };

const ATT_COLORS = {
  invited: T.ink3, confirmed: T.greenDk, attended: T.greenDk,
  no_show: T.terracotta, cancelled: T.ink3,
};
const ATT_LABELS = {
  invited: "Invited", confirmed: "Confirmed", attended: "Attended",
  no_show: "No Show", cancelled: "Cancelled",
};

function fmtDate(d) {
  if (!d) return "—";
  return displayDate(d) || "—"; // FIX-2 finding 10 — the one formatter
}

function StatusBadge({ status, small }) {
  const color = STATUS_COLORS[status] || T.ink3;
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
  const color = ATT_COLORS[status] || T.ink3;
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
    } catch(e) { alert(errorMessage(e)); }
    setSaving(false);
  };

  return (
    <div className="fullscreen-takeover" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: T.ink+"aa" }} />
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
          <button onClick={save} disabled={saving || !form.name.trim()} style={{ flex: 1, background: form.name.trim() ? T.greenDk : T.bg3, border: "none", borderRadius: 10, padding: "12px", color: T.white, fontSize: 14, fontWeight: 700, cursor: form.name.trim() ? "pointer" : "not-allowed" }}>
            {saving ? "Saving…" : "Create Event →"}
          </button>
          <button onClick={onClose} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Event Card ──────────────────────────────────────────────────────────────
function EventCard({ event, onManage, onAddAttendees, onOpenRows }) {
  const t = EVENT_TYPES[event.event_type] || EVENT_TYPES.other;
  const attended = parseInt(event.attendee_count) || 0;
  const invited = parseInt(event.invited_count) || 0;
  const goal = parseFloat(event.goal_amount) || 0;
  const raised = parseFloat(event.raised) || 0;
  const registered = parseInt(event.registered_count) || 0;
  const progress = eventProgress({ raisedCents: Math.round(raised * 100),
                                   goalCents: goal ? Math.round(goal * 100) : null });

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden", borderLeft: `3px solid ${t.color}`, display: "flex", flexDirection: "column", boxShadow: T.shadow }}>
      <div style={{ padding: "16px 18px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{t.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <RecordLink to={tabHref("events", { eventId: event.id })} onOpen={() => onManage(event)} data-record-link="event">{event.name}</RecordLink>
              </div>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
                {fmtDate(event.date)}{event.location ? ` · ${event.location}` : ""}
              </div>
            </div>
          </div>
          <StatusBadge status={event.status} small />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <TypeBadge type={event.event_type} />
        </div>

        {/* ── EVENTS-1 item 1 · THE THREE NUMBERS ON A CARD ──────────────
            Goal, raised and registered, and every one of them opens its own
            rows. RAISED is summed from the gifts stamped with this event, not
            from the `revenue` figure somebody typed: the card's number and
            the list behind it are one query. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 10 }}>
          {[
            ["Goal", goal ? fmtFull(goal) : "None set", null, "The amount this event is aiming at."],
            ["Raised", fmtFull(raised), "raised", "Every gift attributed to this event, at its full amount."],
            ["Registered", String(registered), "registered", "People on the list who have not cancelled. A ticket for two counts as two."],
          ].map(([label, value, rowsKey, sentence]) => (
            <button key={label} data-testid={"ev-card-" + label.toLowerCase()} title={sentence}
              onClick={e => { e.stopPropagation(); if (rowsKey && onOpenRows) onOpenRows(event, rowsKey, label, sentence); }}
              disabled={!rowsKey}
              style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 9px",
                       textAlign: "left", fontFamily: "inherit", cursor: rowsKey ? "pointer" : "default" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.25 }}>{value}</div>
            </button>
          ))}
        </div>

        {goal > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.ink3, marginBottom: 4 }}>
              <span>{progress.sentence}</span>
            </div>
            <div style={{ height: 5, background: T.bg2, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, progress.percent || 0)}%`,
                            background: progress.met ? T.greenDk : t.color, borderRadius: 3, transition: "width 0.4s" }} />
            </div>
          </div>
        )}

        {attended > 0 && (
          <div style={{ fontSize: 11.5, color: T.ink3, marginBottom: 6 }}>{attended} came{invited ? ` of ${invited} on the list` : ""}</div>
        )}
      </div>

      <div style={{ borderTop: "1px solid " + T.bg2, padding: "10px 14px", display: "flex", gap: 6 }}>
        <button onClick={() => onManage(event)} style={{ flex: 2, background: T.greenDk, border: "none", borderRadius: 7, padding: "7px 0", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
    } catch(e) { alert(errorMessage(e)); }
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} width={440} zIndex={400} blur={false} padding="28px 28px 24px"
      ariaLabel="Create follow-up tasks">
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 4 }}>Create Follow-up Tasks</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 20 }}>Creates tasks for all <strong>Attended</strong> donors from {eventName}</div>

        {result !== null ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: T.greenDk, marginBottom: 8 }}>{result}</div>
            <div style={{ fontSize: 14, color: T.ink3, marginBottom: 20 }}>tasks created ✓</div>
            <button onClick={onDone} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "10px 24px", color: T.white, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done</button>
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
              <button onClick={create} disabled={saving} style={{ flex: 1, background: T.greenDk, border: "none", borderRadius: 10, padding: "12px", color: T.white, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Creating…" : "Create Tasks →"}
              </button>
              <button onClick={onClose} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVENTS-1 · THE THREE PANELS THE NIGHT NEEDS
// ═══════════════════════════════════════════════════════════════════════════

// ── item 6 · AFTER THE EVENT ───────────────────────────────────────────────
// Raised against goal, attended against registered, first-time givers and
// sponsors. Every figure opens its rows, and the caveat is in the payload
// rather than in a caption somebody can delete: an event is not the reason
// anybody gave, and a report that implies it is a report that flatters itself.
function EventReport({ eventId, onOpenRows }) {
  const [r, setR] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch(`/events/${eventId}/report`).then(setR).catch(() => setR(null)); }, [eventId]);
  const thanks = async () => {
    setBusy(true); setMsg("");
    try { const out = await apiFetch(`/events/${eventId}/sponsor-thanks`, { method: "POST", body: "{}" }); setMsg(out.sentence); }
    catch (e) { setMsg(errorMessage(e, "Those drafts were not written.")); }
    setBusy(false);
  };
  if (!r) return null;
  return (
    <div data-testid="ev-report" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3, marginBottom: 10 }}>After the event</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {r.figures.map(f => (
          <button key={f.key} data-testid={"ev-fig-" + f.key} title={f.sentence}
            onClick={() => onOpenRows(f.key, f.label, f.sentence)}
            style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 11, padding: "10px 13px",
                     cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 120 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{f.label}</div>
            <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: T.ink, lineHeight: 1.15 }}>
              {f.money ? fmtFull(f.value) : f.value}
            </div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, marginBottom: 4 }}>{r.progress.sentence}</div>
      <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.6 }}>{r.attendance.sentence}</div>
      <p data-testid="ev-report-caveat" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.55, margin: "10px 0 0", maxWidth: 620 }}>{r.caveat}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={thanks} disabled={busy} data-testid="ev-sponsor-thanks"
          style={{ background: T.greenDk, border: "none", borderRadius: 9, padding: "9px 15px", color: T.white, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Writing…" : "Draft a thank-you per sponsor"}
        </button>
        {msg && <span role="status" data-testid="ev-thanks-result" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{msg}</span>}
      </div>
    </div>
  );
}

// ── item 4 · THE SEATING CHART ────────────────────────────────────────────
// FIX-11 Part 2 — REWRITTEN, because on a real gala this card said "Drag a
// name onto a table to seat them" over a single "No seat yet" box and two
// Print buttons. There were no tables, no way to make one, and a guest called
// Jon had nowhere to go. Drag was also the only way to seat anybody, which is
// no way at all on a phone.
//
// A table is a row now, with a number of seats, so a table can be empty and
// still exist. What changed on the screen:
//   · empty states that say the next thing to do rather than describing a
//     gesture there is nothing to perform it on
//   · tables added, renamed, resized and removed in place
//   · seat by TAP: pick guests, "Seat at…" lists the tables with room. Drag
//     stays as a desktop shortcut, and both go through the same route
//   · a party on one ticket moves together and only where they all fit
//   · "Seat everyone", shown as a plan before it touches anything, with undo
//   · the Print buttons say why they are off instead of printing nothing
function EventSeating({ eventId }) {
  const [data, setData] = useState(null);
  const [drag, setDrag] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState([]);       // guests ticked for "Seat at…"
  const [seatMenu, setSeatMenu] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ count: 10, seats: 8 });
  const [namedForm, setNamedForm] = useState({ label: "", seats: 8, sponsorName: "" });
  const [editing, setEditing] = useState(null);    // { id, label, seats, sponsorName }
  const [plan, setPlan] = useState(null);          // the Seat everyone preview
  const [undo, setUndo] = useState(null);          // { label, moves }
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(null);  // PARITY-4: "chart" | "list", the sheet print media shows

  const load = () => apiFetch(`/events/${eventId}/guests`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [eventId]);

  // Every write lands here, so one place clears the message, keeps the undo
  // the server handed back, and refreshes from the response rather than
  // guessing what the new state is.
  const write = async (path, opts, { undoLabel } = {}) => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await apiFetch(path, opts);
      if (r && r.guests) setData(d => ({ ...(d || {}), guests: r.guests, tables: r.tables || (d && d.tables) || [] }));
      else await load();
      if (r && r.sentence) setMsg(r.sentence);
      if (undoLabel && r && Array.isArray(r.undo) && r.undo.length) setUndo({ label: undoLabel, moves: r.undo });
      setBusy(false);
      return r;
    } catch (e) { setErr(errorMessage(e, "That did not go through.")); setBusy(false); return null; }
  };

  // PARITY-4: `chair` is the numbered chair at that table; left out, the
  // server gives the lowest free one. A party moves with its host either way.
  const move = (attendeeId, table, chair) =>
    write(`/events/${eventId}/seat`, { method: "POST", body: JSON.stringify({ attendeeIds: [attendeeId], table, seat: chair || undefined }) },
      { undoLabel: table ? "Put them back" : "Seat them again" });

  const seatPicked = (table, chair) => {
    setSeatMenu(false);
    const ids = picked.slice();
    setPicked([]);
    return write(`/events/${eventId}/seat`, { method: "POST", body: JSON.stringify({ attendeeIds: ids, table, seat: chair || undefined }) },
      { undoLabel: "Undo" });
  };

  // THE TAP PATH, which is also the keyboard path: a chair is a button. With
  // somebody picked, an empty chair seats them there. With nobody picked, a
  // filled chair picks the person on it, so they can be moved.
  const tapChair = (t, chair, g) => {
    if (picked.length) {
      if (g && !picked.includes(g.id)) { setErr(`Chair ${chair} at ${t.label} is ${g.name}'s. Pick an empty chair.`); return; }
      if (g && picked.includes(g.id)) { setPicked(p => p.filter(x => x !== g.id)); return; }
      return seatPicked(t.label, chair);
    }
    if (g) setPicked([g.id]);
  };

  const toggleVip = async g => {
    setErr("");
    try {
      await apiFetch(`/events/${eventId}/attendees/${g.id}`, { method: "PATCH", body: JSON.stringify({ vip: !g.vip }) });
      setMsg(g.vip ? `${g.name} is no longer marked VIP.` : `${g.name} is marked VIP.`);
      await load();
    } catch (e) { setErr(errorMessage(e, "That did not go through.")); }
  };

  const addTables = () =>
    write(`/events/${eventId}/tables`, { method: "POST", body: JSON.stringify({ count: addForm.count, seats: addForm.seats }) })
      .then(r => { if (r) { setAddOpen(false); setMsg(`${r.created} ${r.created === 1 ? "table" : "tables"} of ${addForm.seats} seats.`); } });

  const addNamed = () => {
    if (!namedForm.label.trim()) return;
    return write(`/events/${eventId}/tables`, { method: "POST", body: JSON.stringify(namedForm) })
      .then(r => { if (r) { setNamedForm({ label: "", seats: 8, sponsorName: "" }); setMsg("Added."); } });
  };

  const saveTable = () => {
    if (!editing) return;
    return write(`/events/${eventId}/tables/${editing.id}`, { method: "PUT", body: JSON.stringify(editing) })
      .then(r => { if (r) setEditing(null); });
  };

  const removeTable = t =>
    write(`/events/${eventId}/tables/${t.id}`, { method: "DELETE" }, { undoLabel: "Put the table back" })
      .then(r => { if (r && Array.isArray(r.undo) && r.undo.length) setUndo({ label: "Put the table back", restore: { ...r.undo[0] }, moves: r.undo }); });

  const previewEveryone = () =>
    apiFetch(`/events/${eventId}/seat-everyone`, { method: "POST", body: JSON.stringify({}) })
      .then(setPlan).catch(e => setErr(errorMessage(e, "Could not work out a plan.")));

  const applyEveryone = () => {
    setPlan(null);
    return write(`/events/${eventId}/seat-everyone`, { method: "POST", body: JSON.stringify({ apply: true }) },
      { undoLabel: "Undo seating everyone" });
  };

  const doUndo = async () => {
    if (!undo) return;
    const u = undo; setUndo(null);
    // A removed table has to come back before its guests can sit at it again.
    if (u.restore && u.restore.label) {
      await write(`/events/${eventId}/tables`, { method: "POST",
        body: JSON.stringify({ label: u.restore.label, seats: u.restore.seats, sponsorName: u.restore.sponsorName || "" }) });
    }
    await write(`/events/${eventId}/seat`, { method: "POST", body: JSON.stringify({ moves: u.moves, withParty: false }) });
    setMsg("Put back.");
  };

  if (!data) return null;
  const guests = (data.guests || []).filter(g => g.status !== "cancelled");
  const tableRows = data.tables || [];
  const chart = seatingChart(data.guests || [], { tables: tableRows });
  const tags = nameTags(data.guests || []);
  const pickedGuests = guests.filter(g => picked.includes(g.id));
  // A party moves together, so the count the button shows is the count that
  // will actually move.
  const partyOf = ids => {
    const keys = new Set(ids);
    for (const g of guests) if (keys.has(g.id) && g.guest_of) keys.add(g.guest_of);
    return guests.filter(g => keys.has(g.id) || (g.guest_of && keys.has(g.guest_of)));
  };
  const movingParty = picked.length ? partyOf(picked) : [];

  const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 };
  const label = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };
  const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };
  const go = { ...btn, background: T.greenDk, border: "none", color: T.white };
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12.5, outline: "none", fontFamily: "inherit" };

  const print = (title, rows) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<title>${title}</title><style>
      body{font-family:'DM Sans',system-ui,sans-serif;color:#0F1A12;padding:28px}
      h1{font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 4px}
      .sub{color:#5a554f;font-size:13px;margin-bottom:22px}
      .t{break-inside:avoid;margin-bottom:18px}
      .t h2{font-size:14px;margin:0 0 6px;letter-spacing:.06em;text-transform:uppercase;color:#5a554f}
      .t div{font-size:14px;line-height:1.7}
      .tag{border:1px solid #d4cfc6;border-radius:10px;padding:16px 18px;margin:0 8px 8px 0;display:inline-block;width:250px;break-inside:avoid}
      .tag b{display:block;font-size:19px;font-family:Georgia,serif;font-weight:400}
      .tag span{font-size:12px;color:#5a554f}
    </style>${rows}`);
    w.document.close(); w.focus(); w.print();
  };
  // PARITY-4: THE CHART AND THE LIST PRINT FROM THIS PAGE, not a popup: the
  // sheet below is mounted into <body>, hidden on screen, and is the only thing
  // print media shows. One page for the room, then a guest-by-table list.
  const printSheet = kind => {
    setPrinting(kind);
    setTimeout(() => { try { window.print(); } catch { /* the sheet is still there for the browser's own Print */ } }, 80);
  };
  // A name tag carries a name and the table to find, and nothing else: a badge
  // that prints somebody's giving level is a badge that tells the room what
  // they gave.
  const printTags = () => print(`${data.event.name} name tags`,
    tags.map(t => `<div class="tag"><b>${t.name}</b><span>${t.table || "Please see the desk"}</span></div>`).join(""));

  // THE PRINT BUTTONS SAY WHY THEY ARE OFF. Printing a chart with no tables on
  // it produced a blank page, which reads as a broken button.
  const chartWhy = !guests.length ? "There are no guests to print yet."
    : !chart.tables.length ? "There are no tables yet, so there is no chart to print."
    : chart.seated === 0 ? "Nobody has a seat yet, so the chart would be empty."
    : null;
  const tagsWhy = !guests.length ? "There are no guests to print tags for yet." : null;

  const registrationUrl = data.event && data.event.public_slug
    ? `${window.location.origin}/e/${encodeURIComponent(data.event.public_slug)}` : null;

  // ── THE TWO EMPTY STATES ────────────────────────────────────────────────
  if (!guests.length) {
    return (
      <div data-testid="ev-seating" style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Tables and seating</div>
        <div data-testid="ev-seating-empty-guests" style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>No guests yet.</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 14, maxWidth: 420 }}>
          Guests show up here once people register or you add them.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button data-testid="ev-add-guest" onClick={() => {
            const panel = document.querySelector('[data-testid="ev-guest-panel"]') || document.querySelector('[data-testid="ev-attendees"]');
            if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
            setMsg("Add a guest in the panel on the right.");
          }} style={go}>Add a guest</button>
          {registrationUrl
            ? <button data-testid="ev-share-reg" onClick={() => {
                navigator.clipboard?.writeText(registrationUrl).then(() => setMsg("The registration link is on your clipboard."),
                  () => setMsg(registrationUrl));
              }} style={btn}>Share the registration page</button>
            : <span style={{ fontSize: 12, color: T.ink3, alignSelf: "center" }}>
                Give this event a public page (below) to take registrations.
              </span>}
        </div>
        {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink3, marginTop: 10 }}>{msg}</div>}
      </div>
    );
  }

  const TableAdder = ({ testid }) => (
    <div data-testid={testid} style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 11, padding: "12px 14px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: T.ink }}>How many</span>
        <input data-testid="ev-tables-count" type="number" min="1" max="60" value={addForm.count}
          onChange={e => setAddForm(f => ({ ...f, count: e.target.value }))} style={{ ...inp, width: 68 }} aria-label="How many tables" />
        <span style={{ fontSize: 12.5, color: T.ink }}>seats each</span>
        <input data-testid="ev-tables-seats" type="number" min="1" max="60" value={addForm.seats}
          onChange={e => setAddForm(f => ({ ...f, seats: e.target.value }))} style={{ ...inp, width: 68 }} aria-label="Seats at each table" />
        <button data-testid="ev-tables-add" onClick={addTables} disabled={busy} style={go}>Add tables</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <input value={namedForm.label} onChange={e => setNamedForm(f => ({ ...f, label: e.target.value }))}
          placeholder="Or name one: Sponsor table, Smith Co." style={{ ...inp, flex: "1 1 220px" }} aria-label="Name one table" />
        <input type="number" min="1" max="60" value={namedForm.seats}
          onChange={e => setNamedForm(f => ({ ...f, seats: e.target.value }))} style={{ ...inp, width: 68 }} aria-label="Seats" />
        <input value={namedForm.sponsorName} onChange={e => setNamedForm(f => ({ ...f, sponsorName: e.target.value }))}
          placeholder="Held for (optional)" style={{ ...inp, width: 150 }} aria-label="Held for" />
        <button onClick={addNamed} disabled={busy || !namedForm.label.trim()} style={btn}>Add</button>
      </div>
    </div>
  );

  if (!chart.tables.length) {
    return (
      <div data-testid="ev-seating" style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Tables and seating</div>
        <div data-testid="ev-seating-empty-tables" style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>
          You have {guests.length} {guests.length === 1 ? "guest" : "guests"} and no tables yet.
        </div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 14, maxWidth: 440 }}>
          Lay the room out first. Ten tables of eight is the usual shape for a gala.
        </div>
        <TableAdder testid="ev-tables-adder" />
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700, marginTop: 10 }}>{err}</div>}
        {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink3, marginTop: 10 }}>{msg}</div>}
      </div>
    );
  }

  // ── THE CHART ───────────────────────────────────────────────────────────
  const openTables = chart.tables.filter(t => seatFit({ table: t, party: Math.max(1, movingParty.length) }).ok);

  return (
    <div data-testid="ev-seating" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={label}>Tables and seating</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={previewEveryone} disabled={busy || !chart.unseated.length}
            data-testid="ev-seat-everyone"
            title={chart.unseated.length ? undefined : "Everybody already has a seat."}
            style={{ ...btn, opacity: chart.unseated.length ? 1 : 0.45, cursor: chart.unseated.length ? "pointer" : "not-allowed" }}>
            Seat everyone
          </button>
          <button onClick={chartWhy ? undefined : () => printSheet("chart")} data-testid="ev-print-chart"
            disabled={!!chartWhy} title={chartWhy || undefined}
            style={{ ...btn, opacity: chartWhy ? 0.45 : 1, cursor: chartWhy ? "not-allowed" : "pointer" }}>Print the chart</button>
          <button onClick={chartWhy ? undefined : () => printSheet("list")} data-testid="ev-print-list"
            disabled={!!chartWhy} title={chartWhy || undefined}
            style={{ ...btn, opacity: chartWhy ? 0.45 : 1, cursor: chartWhy ? "not-allowed" : "pointer" }}>Print guests by table</button>
          <button onClick={tagsWhy ? undefined : printTags} data-testid="ev-print-tags"
            disabled={!!tagsWhy} title={tagsWhy || undefined}
            style={{ ...btn, opacity: tagsWhy ? 0.45 : 1, cursor: tagsWhy ? "not-allowed" : "pointer" }}>Print name tags</button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 4 }} data-testid="ev-seating-sentence">{chart.sentence}</div>
      {(chartWhy || tagsWhy) && (
        <div data-testid="ev-print-why" style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{chartWhy || tagsWhy}</div>
      )}
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12 }}>
        Tap a guest, then tap an empty chair (or Seat at). On a computer you can also drag a name onto a chair or a table.
        A brass ring is a VIP; a green chair is somebody already through the door.
      </div>
      <style>{`
        .ev-table-long { grid-column: span 2; }
        @media (max-width: 760px) { .ev-seating-grid { grid-template-columns: minmax(0,1fr) !important; } .ev-room { grid-template-columns: minmax(0,1fr) !important; } .ev-table-long { grid-column: auto !important; } }
        .ev-print-sheet { display: none; }
        @media print {
          body > *:not(.ev-print-sheet) { display: none !important; }
          .ev-print-sheet { display: block !important; }
        }
      `}</style>
      {printing && createPortal(<SeatingPrintSheet kind={printing} event={data.event} chart={chart} />, document.body)}

      {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700, marginBottom: 8 }}>{err}</div>}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>{msg}</span>
        {undo && <button data-testid="ev-undo" onClick={doUndo} style={{ ...btn, padding: "4px 10px" }}>{undo.label}</button>}
      </div>}

      {/* THE PLAN, BEFORE IT TOUCHES ANYTHING. A chart somebody has worked on
          for an hour is not a thing to rearrange without asking. */}
      {plan && (
        <div data-testid="ev-plan" style={{ background: T.bg, border: "1px solid " + T.greenDk + "40", borderRadius: 11, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{plan.sentence}</div>
          <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 12.5, color: T.ink, lineHeight: 1.7, marginBottom: 8 }}>
            {plan.moves.map(m => <div key={m.attendeeId}>{m.name} to {m.table}</div>)}
            {plan.refused.map((r, i) => (
              <div key={"r" + i} style={{ color: T.gold700 }}>{r.name} ({r.size}): {r.reason}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button data-testid="ev-plan-apply" onClick={applyEveryone} disabled={!plan.moves.length} style={go}>Seat them</button>
            <button onClick={() => setPlan(null)} style={btn}>Leave it as it is</button>
          </div>
        </div>
      )}

      {/* SEAT AT… the tables that have room for everyone picked. */}
      {picked.length > 0 && (
        <div data-testid="ev-seat-bar" style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 11, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 700 }}>
              {movingParty.length} {movingParty.length === 1 ? "guest" : "guests"} picked
              {movingParty.length > picked.length ? " (a party moves together)" : ""}
            </span>
            <button data-testid="ev-seat-at" onClick={() => setSeatMenu(v => !v)} aria-expanded={seatMenu} style={go}>Seat at…</button>
            <button onClick={() => seatPicked("")} style={btn}>Not seated</button>
            {pickedGuests.length === 1 && (
              <button data-testid="ev-vip-toggle" onClick={() => toggleVip(pickedGuests[0])} aria-pressed={!!pickedGuests[0].vip}
                style={{ ...btn, borderColor: T.gold500 }}>{pickedGuests[0].vip ? "Not VIP" : "Mark VIP"}</button>
            )}
            <span style={{ fontSize: 12, color: T.ink3 }}>or tap an empty chair</span>
            <button onClick={() => { setPicked([]); setSeatMenu(false); }} style={{ ...btn, border: "none", background: "transparent", color: T.ink3 }}>Clear</button>
          </div>
          {seatMenu && (
            <div data-testid="ev-seat-menu" role="menu" style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {openTables.length === 0
                ? <span style={{ fontSize: 12.5, color: T.gold700 }}>
                    No table has {movingParty.length} {movingParty.length === 1 ? "seat" : "seats"} open together. Add a table or make one bigger.
                  </span>
                : openTables.map(t => (
                    <button key={t.label} role="menuitem" onClick={() => seatPicked(t.label)} style={btn}>
                      {t.label} · {t.open} open
                    </button>
                  ))}
            </div>
          )}
        </div>
      )}

      <div className="ev-seating-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,3fr)", gap: 12 }}>
        {/* NOT SEATED, at the side, because the people without a seat are the
            ones this screen exists to find. */}
        <div data-testid="ev-unseated" onDragOver={e => e.preventDefault()} onDrop={() => drag && move(drag, "")}
          style={{ background: T.white, border: "1.5px dashed " + T.bg3, borderRadius: 11, padding: "10px 12px", minHeight: 96, alignSelf: "start", minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>Not seated · {chart.unseated.length}</div>
          {chart.unseated.length === 0 && <div style={{ fontSize: 12.5, color: T.ink3, fontStyle: "italic" }}>Everybody has a seat.</div>}
          {chart.unseated.map(g => (
            <GuestChip key={g.id} g={g} picked={picked.includes(g.id)}
              onToggle={() => setPicked(p => p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id])}
              onDragStart={() => setDrag(g.id)} onDragEnd={() => setDrag(null)} />
          ))}
        </div>

        {/* PARITY-4 · THE ROOM. Each table drawn as it stands, round or long,
            with its chairs round it. A chair is a button: drop a name on it,
            or pick a name and tap it. The table itself takes a drop too, for
            "anywhere at this table". */}
        <div data-testid="ev-room" className="ev-room" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10, alignContent: "start", minWidth: 0 }}>
          {chart.tables.map(t => (
            <div key={t.label} data-testid="ev-table" data-table-full={t.full ? "1" : "0"} data-shape={t.shape}
              className={t.shape === "long" && t.capacity > 8 ? "ev-table-long" : undefined}
              onDragOver={e => e.preventDefault()} onDrop={() => drag && move(drag, t.label)}
              style={{ background: T.bg, border: "1px solid " + (t.full ? T.gold500 : T.bg3), borderRadius: 11, padding: "10px 12px", minHeight: 96, minWidth: 0 }}>
              {editing && editing.id === t.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input value={editing.label} onChange={e => setEditing(v => ({ ...v, label: e.target.value }))} style={inp} aria-label="Table name" />
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: T.ink3 }}>Seats</span>
                    <input type="number" min="1" max="60" value={editing.seats}
                      onChange={e => setEditing(v => ({ ...v, seats: e.target.value }))} style={{ ...inp, width: 64 }} aria-label="Seats" />
                    <select value={editing.shape || "round"} onChange={e => setEditing(v => ({ ...v, shape: e.target.value }))} style={inp} aria-label="Shape">
                      <option value="round">Round</option>
                      <option value="long">Long</option>
                    </select>
                  </div>
                  <input value={editing.sponsorName || ""} onChange={e => setEditing(v => ({ ...v, sponsorName: e.target.value }))}
                    placeholder="Held for (optional)" style={inp} aria-label="Held for" />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={saveTable} disabled={busy} style={{ ...go, padding: "5px 10px" }}>Save</button>
                    <button onClick={() => setEditing(null)} style={{ ...btn, padding: "5px 10px" }}>Cancel</button>
                    <button data-testid="ev-table-delete" onClick={() => { setEditing(null); removeTable(t); }}
                      style={{ ...btn, padding: "5px 10px", color: T.terra700, marginLeft: "auto" }}>Remove</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
                    <div data-testid="ev-table-head" style={{ fontSize: 11.5, fontWeight: 800, color: t.full ? T.gold700 : T.ink }}>
                      {t.sentence}{t.shape === "long" ? " · long" : ""}
                    </div>
                    {t.id && <button onClick={() => setEditing({ id: t.id, label: t.label, seats: t.capacity, sponsorName: t.sponsorName || "", shape: t.shape })}
                      aria-label={`Edit ${t.label}`}
                      style={{ background: "none", border: "none", color: T.ink3, fontSize: 11, cursor: "pointer", padding: 0 }}>Edit</button>}
                  </div>
                  {t.sponsorName && <div style={{ fontSize: 11, color: T.gold700, marginBottom: 4 }}>Held for {t.sponsorName}</div>}
                  <TableDrawing t={t} picked={picked} busy={busy}
                    onChair={(chair, g) => tapChair(t, chair, g)}
                    onCentre={() => { if (picked.length) seatPicked(t.label); }}
                    onDropChair={chair => { if (drag) move(drag, t.label, chair); }}
                    onDragGuest={id => setDrag(id)} onDragEnd={() => setDrag(null)} />
                  {t.seats.length === 0 && <div style={{ fontSize: 12.5, color: T.ink3, fontStyle: "italic" }}>Empty</div>}
                  {t.places.map((g, i) => g && (
                    <GuestChip key={g.id} g={g} chair={i < t.capacity ? i + 1 : null} picked={picked.includes(g.id)}
                      onToggle={() => setPicked(p => p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id])}
                      onDragStart={() => setDrag(g.id)} onDragEnd={() => setDrag(null)} />
                  ))}
                  {!t.declared && (
                    <div style={{ fontSize: 10.5, color: T.gold700, marginTop: 4 }}>From an older chart. Edit to give it seats.</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}><TableAdder testid="ev-tables-adder" /></div>
    </div>
  );
}

// A guest, tappable and draggable and reachable by keyboard. It is a BUTTON so
// the phone, the mouse and the Tab key all reach it the same way; drag is an
// extra on top rather than the only means.
function GuestChip({ g, picked, onToggle, onDragStart, onDragEnd, chair = null }) {
  return (
    <button type="button" data-testid="ev-guest" aria-pressed={picked}
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onToggle}
      style={{
        display: "block", width: "100%", textAlign: "left", font: "inherit",
        background: picked ? T.greenDk + "16" : "transparent",
        border: picked ? "1px solid " + T.greenDk : "1px solid transparent",
        borderRadius: 7, padding: "3px 6px", margin: "1px 0", minHeight: 30,
        fontSize: 12.5, color: T.ink, cursor: "pointer", overflowWrap: "anywhere",
      }}>
      {chair ? <span style={{ color: T.ink3, fontVariantNumeric: "tabular-nums" }}>{chair} · </span> : null}
      {g.name}
      {g.vip ? <span data-testid="ev-vip-mark" style={{ color: T.gold700, fontWeight: 800 }}> · VIP</span> : null}
      {g.guest_of ? <span style={{ color: T.ink3 }}> · guest</span> : null}
      {g.dietary ? <span style={{ color: T.gold700 }}> · {g.dietary}</span> : null}
    </button>
  );
}

// ── PARITY-4 · ONE TABLE, DRAWN ───────────────────────────────────────────
// A round table is a circle with its chairs round it; a long table is a
// rectangle with chairs down both sides, numbered along the top and then the
// bottom. Every chair is a 44px button (the phone tap target), labelled for a
// screen reader with the table, the chair and who is on it.
function chairInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function TableDrawing({ t, picked, busy, onChair, onCentre, onDropChair, onDragGuest, onDragEnd }) {
  const n = Math.max(1, t.capacity);
  let w, h, spots, centre;
  if (t.shape === "long") {
    const top = Math.ceil(n / 2), bottom = n - top;
    const step = CHAIR + 6;
    w = Math.max(top, bottom, 1) * step + 12;
    const tableTop = CHAIR + 6, tableH = 52;
    h = tableTop + tableH + 6 + CHAIR;
    spots = [];
    for (let i = 0; i < top; i++) spots.push({ x: 6 + i * step, y: 0 });
    for (let i = 0; i < bottom; i++) spots.push({ x: 6 + i * step, y: tableTop + tableH + 6 });
    centre = { left: 4, top: tableTop, width: w - 8, height: tableH, radius: 8 };
  } else {
    const r = Math.max(70, Math.ceil((n * (CHAIR + 4)) / (2 * Math.PI)));
    w = h = 2 * r + CHAIR;
    spots = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      spots.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) });
    }
    const d = Math.max(64, 2 * r - CHAIR - 14);
    centre = { left: (w - d) / 2, top: (h - d) / 2, width: d, height: d, radius: "50%" };
  }
  return (
    <div style={{ display: "flex", justifyContent: "safe center", margin: "4px 0 8px", overflowX: "auto" }}>
      <div data-testid="ev-table-drawing" style={{ position: "relative", width: w, height: h, flexShrink: 0 }}>
        <button type="button" data-testid="ev-table-centre" onClick={onCentre} disabled={busy}
          aria-label={`${t.label}, ${t.count} of ${t.capacity} seats${picked.length ? ". Seat the picked guests here" : ""}`}
          style={{ position: "absolute", left: centre.left, top: centre.top, width: centre.width, height: centre.height,
                   borderRadius: centre.radius, background: T.white, border: "1.5px solid " + (t.full ? T.gold500 : T.bg3),
                   display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                   font: "inherit", color: T.ink, cursor: picked.length ? "pointer" : "default", padding: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.2, textAlign: "center" }}>{t.label}</span>
          <span style={{ fontSize: 11, color: t.full ? T.gold700 : T.ink3 }}>{t.count} of {t.capacity}</span>
        </button>
        {spots.map((p, i) => {
          const g = t.places[i] || null;
          const isPicked = g && picked.includes(g.id);
          const inside = g && g.checked_in_at;
          return (
            <button key={i} type="button" data-testid="ev-chair" data-chair={i + 1} data-filled={g ? "1" : "0"}
              draggable={!!g} onDragStart={() => g && onDragGuest(g.id)} onDragEnd={onDragEnd}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); onDropChair(i + 1); }}
              onClick={() => onChair(i + 1, g)} disabled={busy}
              title={g ? `${g.name}${g.vip ? " (VIP)" : ""}` : `Chair ${i + 1}, empty`}
              aria-label={`${t.label}, chair ${i + 1}: ${g ? g.name + (g.vip ? ", VIP" : "") + (inside ? ", checked in" : "") : "empty"}`}
              aria-pressed={!!isPicked}
              style={{ position: "absolute", left: p.x, top: p.y, width: CHAIR, height: CHAIR, borderRadius: "50%",
                       boxSizing: "border-box", padding: 0, font: "inherit", cursor: "pointer",
                       fontSize: g ? 12 : 10.5, fontWeight: g ? 800 : 600,
                       background: g ? (inside ? T.greenDk : T.bg2) : T.white,
                       color: g ? (inside ? T.white : T.ink) : T.ink3,
                       border: g ? (g.vip ? "3px solid " + T.gold500 : "1.5px solid " + T.bg3) : "1.5px dashed " + T.bg3,
                       boxShadow: isPicked ? "0 0 0 3px " + T.greenDk : "none" }}>
              {g ? chairInitials(g.name) : i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── PARITY-4 · THE PRINTED SHEETS ─────────────────────────────────────────
// "chart": the whole room on one landscape page, every table with its chairs
// numbered and named. "list": every guest A to Z with the table and chair to
// find, which is what the person at the door actually reads from. Only what
// the screen shows is printed: names, tables, chairs, VIP and dietary notes,
// never a giving level.
function SeatingPrintSheet({ kind, event, chart }) {
  const day = event && event.date ? displayDate(event.date) : "";
  const many = chart.tables.length > 12;
  const rows = [];
  for (const t of chart.tables) t.places.forEach((g, i) => { if (g) rows.push({ g, table: t.label, chair: i < t.capacity ? i + 1 : null }); });
  for (const g of chart.unseated) rows.push({ g, table: "Not seated", chair: null });
  rows.sort((a, b) => String(a.g.name).localeCompare(String(b.g.name)));
  const ink = "#0F1A12", grey = "#5a554f";
  return (
    <div className="ev-print-sheet" data-testid="ev-print-sheet" data-kind={kind}
      style={{ fontFamily: "'DM Sans',system-ui,sans-serif", color: ink, background: "#FFFFFF", padding: 0 }}>
      <style>{kind === "chart" ? "@page { size: landscape; margin: 10mm; }" : "@page { size: portrait; margin: 12mm; }"}</style>
      <div style={{ fontFamily: "Georgia,serif", fontSize: 22, marginBottom: 2 }}>{event && event.name}</div>
      <div style={{ fontSize: 11, color: grey, marginBottom: 10 }}>
        {day}{day ? " · " : ""}{kind === "chart" ? chart.sentence : `${rows.length} guests, A to Z, with the table and chair to find.`}
      </div>
      {kind === "chart" ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${many ? 6 : 4}, minmax(0,1fr))`, gap: 8 }}>
          {chart.tables.map(t => (
            <div key={t.label} style={{ border: "1px solid #d4cfc6", borderRadius: t.shape === "long" ? 4 : 14, padding: "6px 8px", breakInside: "avoid" }}>
              <div style={{ fontSize: many ? 9.5 : 11, fontWeight: 800, marginBottom: 3 }}>
                {t.label} <span style={{ fontWeight: 400, color: grey }}>· {t.count} of {t.capacity}{t.shape === "long" ? " · long" : ""}</span>
              </div>
              {t.places.slice(0, Math.max(t.capacity, t.places.length)).map((g, i) => (
                <div key={i} style={{ fontSize: many ? 8 : 9.5, lineHeight: 1.35, color: g ? ink : "#b9b2a6" }}>
                  {i + 1}. {g ? g.name : "open"}{g && g.vip ? " (VIP)" : ""}{g && g.dietary ? ` · ${g.dietary}` : ""}
                </div>
              ))}
            </div>
          ))}
          {chart.unseated.length > 0 && (
            <div style={{ border: "1px dashed #d4cfc6", borderRadius: 4, padding: "6px 8px" }}>
              <div style={{ fontSize: many ? 9.5 : 11, fontWeight: 800, marginBottom: 3 }}>Not yet seated · {chart.unseated.length}</div>
              {chart.unseated.map(g => <div key={g.id} style={{ fontSize: many ? 8 : 9.5, lineHeight: 1.35 }}>{g.name}</div>)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ columnCount: 2, columnGap: 24 }}>
          {rows.map(r => (
            <div key={r.g.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, lineHeight: 1.6, borderBottom: "1px solid #ece8e1", breakInside: "avoid" }}>
              <span>{r.g.name}{r.g.vip ? " (VIP)" : ""}</span>
              <span style={{ color: grey, whiteSpace: "nowrap" }}>{r.table}{r.chair ? `, chair ${r.chair}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── item 5 · CHECK-IN, AT THE DOOR ────────────────────────────────────────
// The kiosk shape VOL-1 built, for a guest list: type a few letters, tap the
// name, and they are in. It is deliberately one big list and one big box,
// because it is used standing up, on a phone, by somebody holding a pen.
//
// PARITY-4: SCAN WITH THE PHONE'S OWN CAMERA. The browser's BarcodeDetector
// reads the EVENTS-2 ticket QR (shared/passCode.js) straight off the camera,
// and the string goes to the server whole: the signature, the org and the
// ticket are checked there, never here. Where a browser has no detector, the
// code box below still takes a typed or Bluetooth-scanned code, and the name
// search still checks anybody in. The answer is a colour as well as words:
// emerald for in, brass for "already in", plain for anything else.
//
// FIX-26: Safari and Firefox have no BarcodeDetector, and most door
// volunteers hold an iPhone. Where it is missing, jsQR (pure JavaScript, no
// network fetch) reads the same frames. It is imported only when the camera
// is started on this screen, so no other screen downloads it. The detector it
// stands in for keeps the same shape: detect(video) -> [{ rawValue }].
async function jsqrDetector() {
  const mod = await import("jsqr");
  const jsQR = mod.default || mod;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    async detect(video) {
      const w = video && video.videoWidth, h = video && video.videoHeight;
      if (!w || !h || !ctx) return [];
      // A ticket fills the middle of the frame; 640 wide reads it and keeps
      // each look well under the 250ms between looks on an older phone.
      const scale = Math.min(1, 640 / w);
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      return hit && hit.data ? [{ rawValue: hit.data }] : [];
    },
  };
}

export function EventKiosk({ eventId }) {
  const [data, setData] = useState(null);
  const [term, setTerm] = useState("");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);      // { tone: "in"|"again"|"no", title, sentence }
  const [view, setView] = useState("all");          // "all" | "in": the count opens the rows behind it
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState("");
  const [walkins, setWalkins] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const lastRef = useRef({ code: "", at: 0 });
  const handleRef = useRef(null);
  const codeBoxRef = useRef(null);

  const load = () => apiFetch(`/events/${eventId}/kiosk`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [eventId]);

  const show = (r, fallback) => {
    if (r && r.ok) {
      setResult({ tone: "in", title: "Checked in", sentence: r.sentence || fallback });
      try { navigator.vibrate && navigator.vibrate(60); } catch { /* not every phone */ }
    } else if (r && (r.already || r.reason === "already_in")) {
      setResult({ tone: "again", title: "Already checked in", sentence: r.sentence });
      try { navigator.vibrate && navigator.vibrate([60, 80, 60]); } catch { /* not every phone */ }
    } else {
      setResult({ tone: "no", title: "Not checked in", sentence: (r && r.sentence) || fallback || "That code did not read." });
    }
  };

  // THE ONE HANDLER a code arrives at, from the camera or from the code box.
  // The same code seen twice inside three seconds is the camera still looking
  // at the same ticket, not a second scan, so it is ignored.
  const handleCode = async (raw, { fromCamera = false } = {}) => {
    const c = String(raw || "").trim();
    if (!c) return;
    const now = Date.now();
    if (fromCamera && lastRef.current.code === c && now - lastRef.current.at < 3000) return;
    lastRef.current = { code: c, at: now };
    try {
      const r = await apiFetch(`/events/${eventId}/scan`, { method: "POST", body: JSON.stringify({ code: c }) });
      show(r, "In.");
      if (r && r.ok) load();
    } catch (e) { setResult({ tone: "no", title: "Not checked in", sentence: errorMessage(e, "That code did not read.") }); }
  };
  handleRef.current = handleCode;

  const stopCamera = () => {
    const s = streamRef.current;
    if (s && s.getTracks) s.getTracks().forEach(tr => { try { tr.stop(); } catch { /* already stopped */ } });
    streamRef.current = null;
    setCamOn(false);
  };

  const startCamera = async () => {
    setCamErr("");
    const Detector = typeof window !== "undefined" ? window.BarcodeDetector : null;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setCamErr("This browser cannot open the camera. Type or paste the code below, or find the guest by name.");
      if (codeBoxRef.current) codeBoxRef.current.focus();
      return;
    }
    try {
      // The built-in reader where there is one (Chrome, Android); jsQR where
      // there is not (Safari on every iPhone, Firefox).
      let supported = [];
      try { supported = Detector && Detector.getSupportedFormats ? await Detector.getSupportedFormats() : []; } catch { supported = []; }
      detectorRef.current = Detector && supported.includes("qr_code")
        ? new Detector({ formats: ["qr_code"] })
        : await jsqrDetector();
    } catch {
      setCamErr("The code reader did not load. Check the connection and try again, or type the code below, or find the guest by name.");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setCamOn(true);
    } catch {
      setCamErr("The camera did not open. Allow the camera for this site, or type the code below, or find the guest by name.");
    }
  };

  // While the camera is on: show it, and look for a code four times a second.
  useEffect(() => {
    if (!camOn) return undefined;
    const v = videoRef.current;
    if (v && streamRef.current) {
      try { v.srcObject = streamRef.current; } catch { /* an older browser */ }
      const p = v.play && v.play();
      if (p && p.catch) p.catch(() => {});
    }
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const found = await detectorRef.current.detect(v);
        const hit = found && found.find(f => f && f.rawValue);
        if (hit && handleRef.current) await handleRef.current(hit.rawValue, { fromCamera: true });
      } catch { /* no frame yet */ }
      if (!stopped) timer = setTimeout(tick, 250);
    };
    timer = setTimeout(tick, 250);
    return () => { stopped = true; clearTimeout(timer); };
  }, [camOn]);
  useEffect(() => () => stopCamera(), []);

  const scanTyped = () => { const c = code; setCode(""); return handleCode(c); };

  const tap = async (g) => {
    setMsg("");
    try {
      const r = await apiFetch(`/events/${eventId}/check-in`, { method: "POST", body: JSON.stringify({ attendeeId: g.id }) });
      show(r, `${g.name} is in.`);
      if (r && r.ok) load();
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  const undoIn = async (g) => {
    try {
      const r = await apiFetch(`/events/${eventId}/check-in`, { method: "POST", body: JSON.stringify({ attendeeId: g.id, undo: true }) });
      setResult(null); setMsg(r.sentence); load();
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };

  // WALK-INS. Somebody at the door who is not on the list: find them in the
  // people already on file (one person record), or add the name as typed, and
  // check them in in the same tap.
  const q = term.trim().toLowerCase();
  useEffect(() => {
    if (q.length < 2) { setWalkins([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      apiFetch(`/donors?search=${encodeURIComponent(q)}&limit=5`)
        .then(r => { if (live) setWalkins((r && r.donors) || []); })
        .catch(() => { if (live) setWalkins([]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const addWalkIn = async ({ donorId, name }) => {
    setMsg("");
    try {
      const r = await apiFetch(`/events/${eventId}/attendees`, { method: "POST",
        body: JSON.stringify(donorId ? { donorIds: [donorId] } : { name }) });
      const id = r && r.ids && r.ids[0];
      if (!id) { setMsg("They are already on the list. Find them by name above."); return; }
      const c = await apiFetch(`/events/${eventId}/check-in`, { method: "POST", body: JSON.stringify({ attendeeId: id }) });
      show(c, "In.");
      setTerm("");
      load();
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };

  if (!data) return null;
  const guests = data.guests || [];
  const inCount = guests.filter(g => g.checked_in_at).length;
  const base = view === "in" ? guests.filter(g => g.checked_in_at) : guests;
  const shown = q ? base.filter(g => (g.name || "").toLowerCase().includes(q)) : base;
  const onList = new Set(guests.map(g => g.donor_id).filter(Boolean));
  const offList = walkins.filter(d => !onList.has(d.id));
  const tones = {
    in: { background: T.greenDk, color: T.white, border: T.greenDk },
    again: { background: T.gold500, color: T.ink, border: T.gold500 },
    no: { background: T.bg, color: T.ink, border: T.bg3 },
  };
  const big = { border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 800, fontFamily: "inherit", cursor: "pointer", minHeight: 48 };

  return (
    <div data-testid="ev-kiosk" id={`ev-kiosk-${eventId}`} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 }}>Check-in</div>
        {/* THE LIVE COUNT, and it opens: tap it for the people behind it. */}
        <button type="button" data-testid="ev-kiosk-count" onClick={() => setView(v => (v === "in" ? "all" : "in"))}
          aria-pressed={view === "in"} title="Checked in of everybody expected. Tap for the list."
          style={{ background: view === "in" ? T.green100 : T.white, border: "1.5px solid " + T.greenDk, borderRadius: 999,
                   padding: "8px 14px", fontFamily: "inherit", cursor: "pointer", color: T.ink, minHeight: 44 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: T.greenDk, fontVariantNumeric: "tabular-nums" }}>{inCount}</span>
          <span style={{ fontSize: 13 }}> of {guests.length} checked in</span>
        </button>
      </div>
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10 }} data-testid="ev-kiosk-sentence">
        {data.sentence} Checked in counts everybody marked in; expected is everybody on the list who has not cancelled.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {!camOn
          ? <button type="button" data-testid="ev-kiosk-camera" onClick={startCamera} style={{ ...big, flex: "1 1 160px", background: T.greenDk, color: T.white }}>Scan</button>
          : <button type="button" data-testid="ev-kiosk-camera-stop" onClick={stopCamera} style={{ ...big, flex: "1 1 160px", background: T.white, color: T.ink, border: "1.5px solid " + T.bg3 }}>Stop the camera</button>}
      </div>
      {camOn && (
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: T.ink, marginBottom: 10, aspectRatio: "4 / 3", maxHeight: 360 }}>
          <video ref={videoRef} data-testid="ev-kiosk-video" playsInline muted autoPlay
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <div aria-hidden="true" style={{ position: "absolute", inset: "18%", border: "3px solid " + T.white, borderRadius: 14, opacity: 0.85 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 8, textAlign: "center", color: T.white, fontSize: 13, fontWeight: 700 }}>
            Hold the ticket's code in the square
          </div>
        </div>
      )}
      {camErr && <div role="status" data-testid="ev-kiosk-camera-why" style={{ fontSize: 13, color: T.ink, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>{camErr}</div>}

      {result && (
        <div role="status" aria-live="polite" data-testid="ev-kiosk-result" data-tone={result.tone}
          style={{ ...tones[result.tone], border: "1px solid " + tones[result.tone].border, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{result.title}</div>
          <div data-testid="ev-kiosk-scan-msg" style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45 }}>{result.sentence}</div>
        </div>
      )}

      {/* The code box: a Bluetooth scanner or a scanner app types into it, and
          a code can be pasted or typed. Same handler as the camera. */}
      <form onSubmit={e => { e.preventDefault(); scanTyped(); }} style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input ref={codeBoxRef} data-testid="ev-kiosk-scan" value={code} onChange={e => setCode(e.target.value)}
          placeholder="Or type the code on the ticket" autoComplete="off" aria-label="Ticket or member card code"
          style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "1.5px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", color: T.ink }} />
        <button type="submit" disabled={!code.trim()} data-testid="ev-kiosk-scan-go"
          style={{ ...big, background: T.white, color: T.ink, border: "1.5px solid " + T.bg3, cursor: code.trim() ? "pointer" : "not-allowed", opacity: code.trim() ? 1 : 0.5 }}>Check</button>
      </form>

      <input data-testid="ev-kiosk-search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Find a guest or a walk-in by name"
        aria-label="Find a guest or a walk-in by name"
        style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", color: T.ink, marginBottom: 10 }} />
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginBottom: 8 }}>{msg}</div>}
      {view === "in" && (
        <div data-testid="ev-kiosk-in-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>Checked in · {inCount}</span>
          <button type="button" onClick={() => setView("all")} style={{ background: "none", border: "none", color: T.greenDk, fontWeight: 700, fontSize: 12.5, cursor: "pointer", minHeight: 44 }}>Show everyone</button>
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {shown.slice(0, 200).map(g => (
          <div key={g.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button data-testid="ev-kiosk-row" onClick={() => tap(g)}
              style={{ flex: 1, minWidth: 0, textAlign: "left", background: g.checked_in_at ? T.green100 : T.white,
                       border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", minHeight: 48,
                       cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14.5, color: T.ink, fontWeight: 600, overflowWrap: "anywhere" }}>
                {g.name}{g.vip ? <span style={{ color: T.gold700, fontWeight: 800 }}> · VIP</span> : null}
              </span>
              <span style={{ fontSize: 12, color: g.checked_in_at ? T.greenDk : T.ink3 }}>
                {g.checked_in_at ? "In" : g.table_label || "No seat"}{g.checked_in_at && g.table_label ? ` · ${g.table_label}` : ""}{g.dietary ? ` · ${g.dietary}` : ""}
              </span>
            </button>
            {g.checked_in_at && (
              <button type="button" onClick={() => undoIn(g)} aria-label={`Undo check-in for ${g.name}`}
                style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "0 12px", fontSize: 12, color: T.ink3, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>Undo</button>
            )}
          </div>
        ))}
        {!shown.length && <div style={{ fontSize: 13, color: T.ink3, marginBottom: 6 }}>{view === "in" && !q ? "Nobody is checked in yet." : "Nobody by that name on the list."}</div>}
      </div>
      {q.length >= 2 && (
        <div data-testid="ev-kiosk-walkin" style={{ borderTop: "1px solid " + T.bg3, marginTop: 8, paddingTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>Walk-in, not on the list</div>
          {offList.map(d => (
            <button key={d.id} type="button" data-testid="ev-kiosk-walkin-person" onClick={() => addWalkIn({ donorId: d.id })}
              style={{ width: "100%", textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", marginBottom: 6, minHeight: 48, cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14.5, color: T.ink, fontWeight: 600 }}>{d.name}</span>
              <span style={{ fontSize: 12, color: T.greenDk, fontWeight: 700 }}>Add and check in</span>
            </button>
          ))}
          <button type="button" data-testid="ev-kiosk-walkin-new" onClick={() => addWalkIn({ name: term.trim() })}
            style={{ width: "100%", textAlign: "left", background: T.white, border: "1.5px dashed " + T.bg3, borderRadius: 10, padding: "11px 13px", minHeight: 48, cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: T.ink }}>
            Add "{term.trim()}" as a new guest and check them in
          </button>
        </div>
      )}
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
  // EVENTS-1 — the rows behind a report figure, opened over the detail.
  const [detailRows, setDetailRows] = useState(null);

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
    } catch(e) { alert(errorMessage(e)); }
    setSavingAtt(null);
  };

  const removeAttendee = async (attId) => {
    const r = await apiFetch(`/events/${eventId}/attendees/${attId}`, { method: "DELETE" });
    setEvent(ev => ({ ...ev, attendees: ev.attendees.filter(a => a.id !== attId) }));
    offerUndo(r, "attendee", () => apiFetch(`/events/${eventId}`).then(ev => ev && ev.id && setEvent(ev)).catch(() => {}));
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
    } catch(e) { alert(errorMessage(e)); }
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
    } catch(e) { alert(errorMessage(e)); }
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
    } catch(e) { alert(errorMessage(e)); }
    setEditSaving(false);
  };

  if (loading || !event) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: T.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "rgba(240,237,230,0.7)", fontSize: 13 }}>Loading…</div>
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

  const INP_DARK = { background: T.ink, border: "1px solid "+T.green650, borderRadius: 8, padding: "8px 10px", color: T.inkInverse, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: T.ink, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: T.ink, borderBottom: "1px solid "+T.bgElevated, padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid "+T.green650, borderRadius: 8, padding: "6px 12px", color: "rgba(240,237,230,0.7)", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.inkInverse, fontFamily: "'DM Serif Display',serif", lineHeight: 1.2 }}>{event.name}</div>
            <TypeBadge type={event.event_type} />
            <StatusBadge status={event.status} small />
          </div>
          <div style={{ fontSize: 12, color: "rgba(240,237,230,0.7)", marginTop: 3 }}>
            {fmtDate(event.date)}{event.end_date ? ` – ${fmtDate(event.end_date)}` : ""}{event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          {/* PARITY-4: the door, one tap from the top on a phone. */}
          <button data-testid="ev-open-checkin" onClick={() => {
            const k = document.getElementById(`ev-kiosk-${eventId}`);
            if (k) k.scrollIntoView({ behavior: "smooth", block: "start" });
          }} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: 36 }}>
            Check-in
          </button>
          <button onClick={() => { setEditing(true); setEditForm({ name: event.name, eventType: event.event_type, date: event.date, endDate: event.end_date || "", location: event.location || "", description: event.description || "", capacity: event.capacity || "", status: event.status, revenue: event.revenue || 0, cost: event.cost || 0, notes: event.notes || "" }); }}
            style={{ background: T.bgElevated, border: "1px solid "+T.green650, borderRadius: 8, padding: "7px 14px", color: T.inkInverse, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Edit Event
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="event-detail-body" style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", overflow: "hidden" }}>

        {/* LEFT */}
        <div style={{ overflowY: "auto", padding: "20px 20px 32px 24px", display: "flex", flexDirection: "column", gap: 20, borderRight: "1px solid "+T.bgElevated }}>

          {/* ── EVENTS-1 · THE THREE PANELS ────────────────────────────
              The report first, because the morning after is when this screen
              is opened most; then the seating; then the door. */}
          <div>
            <EventReport eventId={eventId} onOpenRows={async (key, label, sentence) => {
              try {
                const r = await apiFetch(`/events/${eventId}/rows?rows=${key}`);
                setDetailRows({ ...r, label, sentence, eventName: event.name });
              } catch { setDetailRows({ label, sentence, eventName: event.name, donors: [], count: 0 }); }
            }} />
            <EventSeating eventId={eventId} />
            <EventKiosk eventId={eventId} />
            <EventPageEditor eventId={eventId} />
          </div>

          {/* Stat tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              ["Invited", totalCount, "rgba(240,237,230,0.7)"],
              ["Confirmed", confirmedCount, T.greenDk],
              ["Attended", attendedCount, T.greenDk],
              ["No Show", noShowCount, T.terracotta],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: T.bgElevated, border: "1px solid "+T.green650, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)", marginBottom: 4 }}>{l}</div>
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
              <div style={{ background: T.bgElevated, border: "1px solid "+T.green650, borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)", marginBottom: 12 }}>Revenue vs Cost</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[["Revenue", totalRev, T.greenDk], ["Cost", cost, T.terracotta]].map(([lbl, val, col]) => (
                    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 60, fontSize: 11, color: "rgba(240,237,230,0.7)", textAlign: "right", flexShrink: 0 }}>{lbl}</div>
                      <div style={{ flex: 1, height: 16, background: T.ink, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${val > 0 ? Math.max((val / maxVal) * 100, 4) : 0}%`, background: col, borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ width: 72, fontSize: 11, fontWeight: 700, color: T.inkInverse, textAlign: "right", flexShrink: 0 }}>{fmtFull(val)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid "+T.green650, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "rgba(240,237,230,0.7)" }}>Net</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: net >= 0 ? T.greenDk : T.terracotta, fontFamily: "'DM Serif Display',serif" }}>{net >= 0 ? "+" : ""}{fmtFull(net)}</span>
                </div>
              </div>
            );
          })()}

          {/* Notes */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)", marginBottom: 8 }}>
              Notes {notesSaved && <span style={{ color: T.greenDk, fontSize: 10, fontWeight: 600, marginLeft: 6 }}>Saved ✓</span>}
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
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)" }}>Attendees ({totalCount})</div>
              {attendedCount > 0 && (
                <button onClick={() => setShowFollowUp(true)} style={{ background: T.bgElevated, border: "1px solid "+T.green650, borderRadius: 8, padding: "5px 12px", color: T.gold500, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  ✦ Follow-up Tasks
                </button>
              )}
            </div>

            {/* Bulk mark attended */}
            {confirmedCount > 0 && (
              <button onClick={async () => {
                const confirmed = event.attendees.filter(a => a.status === "confirmed");
                for (const a of confirmed) await patchAttendee(a.id, { status: "attended" });
              }} style={{ background: T.greenDk+"22", border: "1px solid "+T.greenDk+"44", borderRadius: 8, padding: "6px 12px", color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
                ✓ Mark all confirmed as attended
              </button>
            )}

            {event.attendees?.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(240,237,230,0.7)", fontStyle: "italic", padding: "16px 0" }}>No attendees yet. Add guests from the panel on the right.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 80px 90px 80px 32px", gap: 6, padding: "6px 10px", borderRadius: 8, background: T.ink }}>
                  {["Name", "Email", "Stage", "Status", "Gift", ""].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "rgba(240,237,230,0.7)" }}>{h}</div>
                  ))}
                </div>
                {event.attendees.map(a => (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) 80px 90px 80px 32px", gap: 6, padding: "8px 10px", borderRadius: 8, background: T.bgElevated, border: "1px solid "+T.green650, alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.inkInverse, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(240,237,230,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email || "—"}</div>
                    <div>{a.stage ? <Pill label={a.stage} color={SC[a.stage] || T.ink3} /> : <span style={{ fontSize: 11, color: "rgba(240,237,230,0.7)" }}>—</span>}</div>
                    <div>
                      {savingAtt === a.id ? (
                        <span style={{ fontSize: 11, color: "rgba(240,237,230,0.7)" }}>Saving…</span>
                      ) : editingStatus === a.id ? (
                        <select
                          value={a.status}
                          onChange={async e => {
                            setEditingStatus(null);
                            await patchAttendee(a.id, { status: e.target.value });
                          }}
                          onBlur={() => setEditingStatus(null)}
                          autoFocus
                          style={{ background: T.ink, border: "1px solid "+T.green650, borderRadius: 6, padding: "3px 6px", color: T.inkInverse, fontSize: 11, outline: "none", cursor: "pointer" }}
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
                          style={{ background: T.ink, border: "1px solid "+T.green650, borderRadius: 6, padding: "3px 6px", color: T.inkInverse, fontSize: 11, width: 72, outline: "none" }}
                        />
                      ) : (
                        <button onClick={() => { setEditingGift(a.id); setGiftVal(a.gift_amount || ""); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: a.gift_amount ? T.greenDk : "rgba(240,237,230,0.7)", fontWeight: a.gift_amount ? 700 : 400 }}>
                          {a.gift_amount ? fmtFull(a.gift_amount) : "—"}
                        </button>
                      )}
                    </div>
                    <button onClick={() => removeAttendee(a.id)} style={{ background: "none", border: "none", color: T.terracotta+"66", fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ overflowY: "auto", padding: "20px 24px 32px 20px", display: "flex", flexDirection: "column", gap: 20, background: T.ink }}>

          {/* Quick stats */}
          <div style={{ background: T.bgElevated, border: "1px solid "+T.green650, borderRadius: 14, padding: "16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)", marginBottom: 12 }}>Event Stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["Conversion Rate", `${convRate}%`, convRate >= 70 ? T.greenDk : convRate >= 40 ? T.gold500 : "rgba(240,237,230,0.7)"],
                ["Avg Gift", avgGift > 0 ? fmtFull(avgGift) : "—", T.greenDk],
                ["Top Donor", topDonor ? topDonor.name : "—", T.gold500],
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(240,237,230,0.7)" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Add attendees */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(240,237,230,0.7)", marginBottom: 10 }}>Add Attendees</div>

            {/* Toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, background: T.bgElevated, borderRadius: 8, padding: 3 }}>
              {[["directory", "From Directory"], ["guest", "Add Guest"]].map(([mode, label]) => (
                <button key={mode} onClick={() => setAddMode(mode)} style={{ flex: 1, background: addMode === mode ? T.ink : "transparent", border: addMode === mode ? "1px solid "+T.green650 : "none", borderRadius: 6, padding: "5px 0", color: addMode === mode ? T.inkInverse : "rgba(240,237,230,0.7)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
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
                    })} style={{ display: "flex", alignItems: "center", gap: 8, background: selectedIds.has(d.id) ? T.greenDk+"22" : T.bgElevated, border: `1px solid ${selectedIds.has(d.id) ? T.greenDk : T.green650}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selectedIds.has(d.id) ? T.greenDk : T.green650}`, background: selectedIds.has(d.id) ? T.greenDk : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {selectedIds.has(d.id) && <span style={{ color: T.white, fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.inkInverse, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                        {d.lastAmount > 0 && <div style={{ fontSize: 10, color: "rgba(240,237,230,0.7)" }}>Last gift: {fmtFull(d.lastAmount)}</div>}
                      </div>
                      {d.stage && <Pill label={d.stage} color={SC[d.stage] || T.ink3} />}
                    </button>
                  ))}
                  {filteredDonors.length === 0 && <div style={{ fontSize: 12, color: "rgba(240,237,230,0.7)", padding: "12px 0", textAlign: "center" }}>No donors to add</div>}
                </div>
                {selectedIds.size > 0 && (
                  <button onClick={addFromDirectory} disabled={addingDonors} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {addingDonors ? "Adding…" : `Add ${selectedIds.size} donor${selectedIds.size > 1 ? "s" : ""} →`}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={guestForm.name} onChange={e => setGuestForm(f => ({ ...f, name: e.target.value }))} placeholder="Guest name *" style={INP_DARK} />
                <input value={guestForm.email} onChange={e => setGuestForm(f => ({ ...f, email: e.target.value }))} placeholder="Email (optional)" style={INP_DARK} />
                <button onClick={addGuest} disabled={addingGuest || !guestForm.name.trim()} style={{ background: guestForm.name.trim() ? T.greenDk : T.bgElevated, border: "none", borderRadius: 8, padding: "9px", color: T.white, fontSize: 12, fontWeight: 700, cursor: guestForm.name.trim() ? "pointer" : "not-allowed" }}>
                  {addingGuest ? "Adding…" : "Add Guest →"}
                </button>
              </div>
            )}
          </div>

          {/* Follow-up tasks call-to-action */}
          {attendedCount > 0 && (
            <div style={{ background: T.bgElevated, border: "1px solid "+T.gold500+"44", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.gold500, marginBottom: 8 }}>Follow-up Tasks</div>
              <div style={{ fontSize: 12, color: "rgba(240,237,230,0.7)", marginBottom: 10 }}>{attendedCount} donor{attendedCount !== 1 ? "s" : ""} attended — create follow-up tasks for each.</div>
              <button onClick={() => setShowFollowUp(true)} style={{ background: T.gold500+"22", border: "1px solid "+T.gold500+"44", borderRadius: 8, padding: "8px 14px", color: T.gold500, fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%" }}>
                ✦ Create Follow-up Tasks
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit event modal */}
      {editing && (
        <Modal onClose={()=>setEditing(null)} width={480} zIndex={400} blur={false} padding={28}
          ariaLabel="Edit event">
          <div>
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
              <button onClick={saveEdit} disabled={editSaving} style={{ flex: 1, background: T.greenDk, border: "none", borderRadius: 10, padding: "12px", color: T.white, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button onClick={() => setEditing(false)} style={{ background: T.bg, border: "none", borderRadius: 10, padding: "12px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {showFollowUp && (
        <FollowUpModal
          eventId={eventId}
          eventName={event.name}
          onDone={() => setShowFollowUp(false)}
          onClose={() => setShowFollowUp(false)}
        />
      )}

      {/* The rows behind a report figure. Same SQL as the figure. */}
      {detailRows && (
        <Modal onClose={() => setDetailRows(null)} width={620}
          title={`${detailRows.label} · ${detailRows.count}`}>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginTop: 0 }}>{detailRows.sentence}</p>
          <div style={{ maxHeight: 360, overflowY: "auto" }} data-testid="ev-report-rows">
            {(detailRows.donors || []).map((r, i) => (
              <div key={(r.id || r.donor_id || "") + i} style={{ padding: "8px 0", borderBottom: "1px solid " + T.bg3, display: "flex", gap: 10, justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: T.ink3, whiteSpace: "nowrap" }}>
                  {r.amount != null ? fmtFull(Number(r.amount)) : ""}
                  {r.level_name ? ` · ${r.level_name}` : ""}
                  {r.table_label ? ` · ${r.table_label}` : ""}
                </span>
              </div>
            ))}
            {!(detailRows.donors || []).length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody yet.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Main Events Component ───────────────────────────────────────────────────
export function Events({ data, isReadOnly }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("upcoming");
  // FIX-14 Part 5: an event is /app/events?event=<id>, so a fresh tab opens
  // on it, and opening or closing one here moves the address bar with it.
  const [selectedId, setSelectedIdRaw] = useState(() => urlParam("events", "event"));
  const goUrl = useUrlWriter();
  const setSelectedId = id => { setSelectedIdRaw(id); goUrl(tabHref("events", id ? { eventId: id } : undefined)); };
  const [showNew, setShowNew] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  // EVENTS-1 item 1 — every number on a card opens its rows.
  const [rowsPanel, setRowsPanel] = useState(null);
  const openRows = async (event, key, label, sentence) => {
    try {
      const r = await apiFetch(`/events/${event.id}/rows?rows=${key}`);
      setRowsPanel({ ...r, label, sentence, eventName: event.name });
    } catch { setRowsPanel({ label, sentence, eventName: event.name, donors: [], count: 0 }); }
  };

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
          ["Total Attendees", totalAttendees, T.greenDk],
          ["Event Revenue", fmtFull(totalRevenue), T.greenDk],
          ["Avg Attendance Rate", `${avgRate}%`, T.ink],
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
        <button onClick={() => setShowNew(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "9px 20px", color: T.white, fontSize: 13, fontWeight: 700, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>
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
          <button onClick={() => setShowNew(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "10px 24px", color: T.white, fontSize: 13, fontWeight: 700, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>Create Your First Event</button>
        </div>
      ) : (
        <div className="events-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {filtered.map(e => (
            <EventCard
              key={e.id}
              event={e}
              onManage={evt => setSelectedId(evt.id)}
              onAddAttendees={evt => setSelectedId(evt.id)}
              onOpenRows={openRows}
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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: T.ink+"aa" }} onClick={() => setAddTarget(null)} />
      )}

      {/* EVERY NUMBER OPENS ITS ROWS. The same SQL the figure was built from,
          re-run, so a count and its list cannot drift. */}
      {rowsPanel && (
        <Modal onClose={() => setRowsPanel(null)} width={620}
          title={`${rowsPanel.label} · ${rowsPanel.count} · ${rowsPanel.eventName}`}>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginTop: 0 }}>{rowsPanel.sentence}</p>
          <div style={{ maxHeight: 360, overflowY: "auto" }} data-testid="ev-rows">
            {(rowsPanel.donors || []).map((r, i) => (
              <div key={(r.id || r.donor_id || "") + i} style={{ padding: "8px 0", borderBottom: "1px solid " + T.bg3, display: "flex", gap: 10, justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: T.ink3, whiteSpace: "nowrap" }}>
                  {r.amount != null ? fmtFull(Number(r.amount)) : ""}
                  {r.level_name ? ` · ${r.level_name}` : ""}
                  {r.table_label ? ` · ${r.table_label}` : ""}
                  {r.quantity > 1 ? ` · ${r.quantity} places` : ""}
                </span>
              </div>
            ))}
            {!(rowsPanel.donors || []).length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody yet.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
