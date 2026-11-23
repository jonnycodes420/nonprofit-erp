// components/events/EventVolunteerTeam.jsx · VOL-3 item 5. AN EVENT HAS A VOLUNTEER TEAM.
//
// The event page shows its shifts and who is on each (GET /events/:id/volunteer-team), and a
// shift can be made right here. It is made through the one shift write (POST /volunteer-hub/slots
// with the event's id), so it is the same shift the Volunteers schedule, the public page and
// check-in see. With no opportunity picked, one is made named after the event.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import { RecordLink } from "../RecordLink";
import { tabHref } from "../../lib/appUrls";
import DateInput from "../inputs/LazyDateInput";
import TimeInput from "../inputs/TimeInput";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", marginBottom: 14 };
const label = { fontSize: 10, fontWeight: 800, color: T.ink3 };
const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const btnPrimary = { background: T.greenDk, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", fontFamily: "inherit" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

const blank = d => ({ opportunityId: "", date: d || "", startTime: "", endTime: "", capacity: "" });

export function EventVolunteerTeam({ eventId }) {
  const [data, setData] = useState(null);
  const [opps, setOpps] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiFetch(`/events/${eventId}/volunteer-team`).then(setData).catch(() => setData(null)), [eventId]);
  useEffect(() => { load(); }, [load]);
  const open = () => {
    setMsg(""); setForm(blank(data && data.event.date));
    apiFetch("/volunteer-hub/opportunities").then(d => setOpps(d.opportunities || [])).catch(() => setOpps([]));
  };
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      let opportunityId = form.opportunityId;
      if (!opportunityId) {
        const o = await apiFetch("/volunteer-hub/opportunities", { method: "POST", body: JSON.stringify({ name: data.event.name }) });
        opportunityId = o.id;
      }
      await apiFetch("/volunteer-hub/slots", { method: "POST", body: JSON.stringify({
        opportunityId, eventId, date: form.date, startTime: form.startTime, endTime: form.endTime,
        capacity: form.capacity === "" ? null : form.capacity, name: data.event.name }) });
      setForm(null); setMsg("Shift added. It is on the Volunteers schedule too.");
      load();
    } catch (e) { setMsg(errorMessage(e, "That shift was not added.")); }
    finally { setBusy(false); }
  };
  if (!data) return null;
  const person = p => <RecordLink key={p.id} to={tabHref("volunteers", { volunteerId: p.id })} data-record-link="volunteer">{p.name}</RecordLink>;
  return (
    <div data-testid="ev-volunteer-team" style={card}>
      <div style={{ ...label, marginBottom: 6 }}>Volunteer team</div>
      <div data-testid="ev-volunteer-sentence" style={{ fontSize: 13, color: T.ink, marginBottom: 10 }}>{data.sentence}</div>
      {data.shifts.map(s => (
        <div key={s.id} data-testid="ev-volunteer-shift" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{s.name}</span>
            <span style={{ fontSize: 12.5, color: T.ink3 }}>{displayDate(s.date)}, {s.startTime} to {s.endTime}{s.published ? "" : " · draft"}</span>
            <span style={{ fontSize: 12.5, color: s.needed != null && s.filled < s.needed ? T.gold700 : T.ink3 }}>{s.sentence}</span>
          </div>
          <div style={{ fontSize: 13, color: T.ink, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.people.length ? s.people.map((p, i) => <span key={p.id}>{person(p)}{p.role ? ` (${p.role})` : ""}{i < s.people.length - 1 ? "," : ""}</span>)
              : <span style={{ color: T.ink3 }}>Nobody on it yet.</span>}
          </div>
          {s.waiting.length > 0 && <div style={{ fontSize: 12.5, color: T.ink3 }}>Waiting: {s.waiting.map(p => `${p.position ? `#${p.position} ` : ""}${p.name}`).join(", ")}</div>}
        </div>))}
      {!form ? (
        <button type="button" style={{ ...btnQuiet, marginTop: 6 }} onClick={open} data-testid="ev-volunteer-add">Add a shift</button>
      ) : (
        <div data-testid="ev-volunteer-form" style={{ background: T.bg, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Opportunity" value={form.opportunityId} onChange={e => setForm({ ...form, opportunityId: e.target.value })} style={inp}>
              <option value="">New opportunity: {data.event.name}</option>
              {opps.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <DateInput aria-label="Date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} />
            <TimeInput aria-label="Start time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} style={inp} />
            <TimeInput aria-label="End time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} style={inp} />
            <input aria-label="How many people" inputMode="numeric" placeholder="How many" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} style={{ ...inp, width: 90 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={busy || !form.date || !form.startTime || !form.endTime} onClick={save} data-testid="ev-volunteer-save">{busy ? "Adding…" : "Add the shift"}</button>
            <button type="button" style={btnLink} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
