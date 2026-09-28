import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull, SC, Pill, Card, PageTitle, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { eventProgress, attendanceRate, seatingChart, nameTags, EVENT_FIGURES } from "../../../shared/eventShape";

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
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
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
// Drag a guest onto a table. The unseated stay in their own column rather than
// being hidden, because the people without a seat are the ones this screen
// exists to find. Printing gives the chart and the name tags, and a name tag
// carries a name and a table and nothing else: a badge that prints somebody's
// giving level is a badge that tells the room what they gave.
function EventSeating({ eventId }) {
  const [data, setData] = useState(null);
  const [drag, setDrag] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/events/${eventId}/guests`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [eventId]);
  const move = async (attendeeId, table) => {
    setMsg("");
    try {
      await apiFetch(`/events/${eventId}/attendees/${attendeeId}/table`, { method: "PUT", body: JSON.stringify({ table }) });
      load();
    } catch (e) { setMsg(errorMessage(e, "That guest did not move.")); }
  };
  if (!data) return null;
  const chart = seatingChart(data.guests || []);
  const tags = nameTags(data.guests || []);
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
  const printChart = () => print(`${data.event.name} — seating`,
    `<h1>${data.event.name}</h1><div class="sub">${chart.sentence}</div>`
    + chart.tables.map(t => `<div class="t"><h2>${t.label} · ${t.count}</h2>${t.seats.map(g => `<div>${g.name}${g.dietary ? ` <span style="color:#8a6d1f">(${g.dietary})</span>` : ""}</div>`).join("")}</div>`).join("")
    + (chart.unseated.length ? `<div class="t"><h2>Not yet seated · ${chart.unseated.length}</h2>${chart.unseated.map(g => `<div>${g.name}</div>`).join("")}</div>` : ""));
  const printTags = () => print(`${data.event.name} — name tags`,
    tags.map(t => `<div class="tag"><b>${t.name}</b><span>${t.table || "Please see the desk"}</span></div>`).join(""));

  return (
    <div data-testid="ev-seating" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 }}>Tables and seating</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={printChart} data-testid="ev-print-chart" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" }}>Print the chart</button>
          <button onClick={printTags} data-testid="ev-print-tags" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" }}>Print name tags</button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 12 }}>{chart.sentence} Drag a name onto a table to seat them.</div>
      {msg && <div role="alert" style={{ fontSize: 12.5, color: T.terra700, marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
        {chart.tables.map(t => (
          <div key={t.label} data-testid="ev-table"
            onDragOver={e => e.preventDefault()} onDrop={() => drag && move(drag, t.label)}
            style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 11, padding: "10px 12px", minHeight: 96 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.ink, marginBottom: 6 }}>{t.label} · {t.count}</div>
            {t.seats.map(g => (
              <div key={g.id} draggable onDragStart={() => setDrag(g.id)} onDragEnd={() => setDrag(null)}
                style={{ fontSize: 12.5, color: T.ink, padding: "2px 0", cursor: "grab" }}>
                {g.name}{g.dietary ? <span style={{ color: T.gold700 }}> · {g.dietary}</span> : null}
              </div>
            ))}
          </div>
        ))}
        <div data-testid="ev-unseated" onDragOver={e => e.preventDefault()} onDrop={() => drag && move(drag, "")}
          style={{ background: T.white, border: "1.5px dashed " + T.bg3, borderRadius: 11, padding: "10px 12px", minHeight: 96 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>No seat yet · {chart.unseated.length}</div>
          {chart.unseated.map(g => (
            <div key={g.id} draggable onDragStart={() => setDrag(g.id)} onDragEnd={() => setDrag(null)}
              style={{ fontSize: 12.5, color: T.ink, padding: "2px 0", cursor: "grab" }}>{g.name}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── item 5 · CHECK-IN, AT THE DOOR ────────────────────────────────────────
// The kiosk shape VOL-1 built, for a guest list: type a few letters, tap the
// name, and they are in. It is deliberately one big list and one big box,
// because it is used standing up, on a tablet, by somebody holding a pen.
function EventKiosk({ eventId }) {
  const [data, setData] = useState(null);
  const [term, setTerm] = useState("");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanOk, setScanOk] = useState(false);
  const load = () => apiFetch(`/events/${eventId}/kiosk`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [eventId]);
  // The code is handed to the server whole. Nothing here reads or trusts what
  // is inside it: the signature is checked on the server, against this org.
  const scan = async () => {
    const c = code.trim();
    if (!c) return;
    setScanMsg(""); setCode("");
    try {
      const r = await apiFetch(`/events/${eventId}/scan`, { method: "POST", body: JSON.stringify({ code: c }) });
      setScanOk(!!r.ok); setScanMsg(r.sentence || (r.ok ? "In." : "That code did not read."));
      if (r.ok) load();
    } catch (e) { setScanOk(false); setScanMsg(errorMessage(e, "That code did not read.")); }
  };
  const tap = async (g) => {
    setMsg("");
    try {
      const r = await apiFetch(`/events/${eventId}/check-in`, {
        method: "POST", body: JSON.stringify({ attendeeId: g.id, undo: !!g.checked_in_at }) });
      setMsg(r.sentence); load();
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  if (!data) return null;
  const q = term.trim().toLowerCase();
  const shown = q ? data.guests.filter(g => (g.name || "").toLowerCase().includes(q)) : data.guests;
  return (
    <div data-testid="ev-kiosk" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>Check-in</div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }} data-testid="ev-kiosk-count">{data.sentence}</div>
      {/* EVENTS-2 — the scanner. A phone camera reads the QR into a text box
          (any scanner app or a Bluetooth reader types into the focused field),
          and the server decides what it means. Two kinds of code arrive here:
          a ticket for this event, and a member card. A member card is NOT a
          ticket, so it never invents a registration — it says who this is and
          whether they are on the list, and the person at the door decides. */}
      <form onSubmit={e => { e.preventDefault(); scan(); }} style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input data-testid="ev-kiosk-scan" value={code} onChange={e => setCode(e.target.value)}
          placeholder="Scan a ticket or a member card" autoComplete="off"
          style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: "1.5px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", color: T.ink }} />
        <button type="submit" disabled={!code.trim()} data-testid="ev-kiosk-scan-go"
          style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 800, cursor: code.trim() ? "pointer" : "not-allowed", opacity: code.trim() ? 1 : 0.5, fontFamily: "inherit" }}>Scan</button>
      </form>
      {scanMsg && <div role="status" data-testid="ev-kiosk-scan-msg"
        style={{ fontSize: 14, fontWeight: 700, color: scanOk ? T.greenDk : T.ink, background: scanOk ? T.green100 : T.bg,
                 border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", marginBottom: 10 }}>{scanMsg}</div>}
      <input data-testid="ev-kiosk-search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Type a name"
        style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", color: T.ink, marginBottom: 10 }} />
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginBottom: 8 }}>{msg}</div>}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {shown.slice(0, 200).map(g => (
          <button key={g.id} data-testid="ev-kiosk-row" onClick={() => tap(g)}
            style={{ width: "100%", textAlign: "left", background: g.checked_in_at ? T.green100 : T.white,
                     border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", marginBottom: 6,
                     cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14.5, color: T.ink, fontWeight: 600 }}>{g.name}</span>
            <span style={{ fontSize: 12, color: g.checked_in_at ? T.greenDk : T.ink3, whiteSpace: "nowrap" }}>
              {g.checked_in_at ? "In" : g.table_label || "No seat"}{g.dietary ? ` · ${g.dietary}` : ""}
            </span>
          </button>
        ))}
        {!shown.length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody by that name on the list.</div>}
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
      <div style={{ background: T.ink, borderBottom: "1px solid "+T.bgElevated, padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
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
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
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
  const [selectedId, setSelectedId] = useState(null);
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
