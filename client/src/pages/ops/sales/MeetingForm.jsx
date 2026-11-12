// SALES-2 item 6 · booking a meeting: day, time (New York), a place or Zoom link, and who's
// attending. From a deal or an organization it books directly; call mode hands the same
// fields to its "Meeting booked" outcome. Steward sends no invite: a task to send it is made.
import { useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { CREAM, says, btn, quiet, box, brassTag, failureWords } from "./salesBits";

export default function MeetingForm({ dealId = null, orgId = null, contactIds = [], attendeesHint = "", onSubmit = null, onDone, onCancel }) {
  const [m, setM] = useState({ date: "", time: "10:00", place: "", attendees: attendeesHint });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setM(x => ({ ...x, [k]: v }));
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = onSubmit ? await onSubmit(m) : await apiFetch("/ops/sales/meetings", { method: "POST", body: JSON.stringify({ dealId, orgId, contactIds, ...m }) });
      onDone(r);
    } catch (e) { setErr(failureWords(e, "The meeting was not booked.")); }
    setBusy(false);
  };
  const lab = { fontSize: 12, fontWeight: 700, opacity: 0.7, display: "block", marginBottom: 2 };
  return <div style={{ background: CREAM, borderRadius: 8, padding: 12, marginTop: 8 }} data-sales-meeting-form="1">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
      <label><span style={lab}>Day</span><DateInput value={m.date} onChange={e => set("date", e.target.value)} style={{ ...box, width: "100%" }} aria-label="Meeting day" data-meeting-date="1" /></label>
      <label><span style={lab}>Time (Eastern)</span><input type="time" value={m.time} onChange={e => set("time", e.target.value)} style={{ ...box, width: "100%" }} aria-label="Meeting time" data-meeting-time="1" /></label>
      <label style={{ gridColumn: "1 / -1" }}><span style={lab}>Place or Zoom link</span><input value={m.place} onChange={e => set("place", e.target.value)} style={{ ...box, width: "100%" }} aria-label="Place or Zoom link" data-meeting-place="1" /></label>
      <label style={{ gridColumn: "1 / -1" }}><span style={lab}>Who's attending</span><input value={m.attendees} onChange={e => set("attendees", e.target.value)} style={{ ...box, width: "100%" }} aria-label="Who's attending" data-meeting-attendees="1" /></label>
    </div>
    <p style={{ ...says, marginTop: 8 }}>Booking moves the deal to Meeting booked and adds a task to send the calendar invite. Steward sends nothing; you send the invite.</p>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" style={btn} onClick={go} disabled={busy || !m.date || !m.time || !m.place.trim()} data-meeting-book="1">{busy ? "Booking…" : "Book the meeting"}</button>
      <button type="button" style={quiet} onClick={onCancel}>Cancel</button>
    </div>
    {err ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not booked</span> {err}</p> : null}
  </div>;
}
