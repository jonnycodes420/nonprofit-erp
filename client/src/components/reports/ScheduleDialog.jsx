// REPORTS-6 item 1 · SEND THIS REPORT TO PEOPLE WHO HAVE NO STEWARD SEAT.
//
// One dialog for a saved report, the board pack and the board deck: weekly,
// monthly or quarterly, on a day and an hour in the organization's time, to
// the addresses she types. It says the next send date in words, shows the
// exact PDF that will be attached (the server's own preview, the same
// builder the send uses) and lists what went to whom. Remove has Undo.
import { useEffect, useState } from "react";
import { apiFetch, API, getToken } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { offerUndo } from "../EditHistory";

const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const GHOST = { background: T.white, color: T.greenDk, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const FIELD = { padding: "8px 10px", borderRadius: 8, border: "1px solid " + T.bg3, background: T.white, color: T.ink, fontSize: 13, boxSizing: "border-box" };
const LBL = { fontSize: 11, fontWeight: 700, color: T.ink3, display: "block", marginBottom: 4 };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourWords = h => (h === 0 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const FREQ_WORDS = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly (Jan, Apr, Jul, Oct)" };

// The preview is fetched with the session and opened as a file: never a link that opens data without one.
async function openPreview(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "The preview did not open."); }
  const url = URL.createObjectURL(await r.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function ScheduleButton({ target, label = "Send on a schedule", style }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" data-testid="schedule-open" onClick={() => setOpen(true)} style={{ ...GHOST, ...style }}>{label}</button>
    {open && <ScheduleDialog target={target} onClose={() => setOpen(false)} />}
  </>;
}

export function ScheduleDialog({ target, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);   // null: the list; {}: a new one; a schedule: that one
  const load = () => apiFetch(`/report-schedules?target=${encodeURIComponent(target)}`).then(setData).catch(e => setErr(errorMessage(e, "Could not load the schedules.")));
  useEffect(() => { load(); }, [target]);
  const remove = async s => {
    try {
      const r = await apiFetch(`/report-schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      load();
      offerUndo({ message: r.message, undoAction: async () => { const u = await apiFetch(r.undo.path, { method: "POST", body: "{}" }); load(); return u; } }, "schedule");
    } catch (e) { setErr(errorMessage(e, "That schedule was not removed.")); }
  };
  return (
    <Modal onClose={onClose} width={560} ariaLabel="Send on a schedule" dialogStyle={{ background: T.bg, borderRadius: 14 }}>
      <div data-testid="schedule-dialog">
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: T.ink }}>Send on a schedule</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3, lineHeight: 1.55 }}>
          Each email carries the report as a PDF, dated and with what every number means. Nothing in it needs a login, so it can go to your board, a funder contact or your bookkeeper. Staff and board only, never a donor.
        </div>
        {data?.staffMailOff && <div data-testid="schedule-mail-off" style={{ marginTop: 10, fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, padding: "4px 10px" }}>{data.staffMailOff}</div>}
        {err && <div style={{ marginTop: 10, fontSize: 13, color: T.ink }}>{err}</div>}
        {!data && !err && <div style={{ marginTop: 14, fontSize: 13, color: T.ink3 }}>Loading…</div>}
        {data && !editing && <>
          {data.schedules.length === 0 && <div style={{ marginTop: 14, fontSize: 13, color: T.ink2 }}>Nothing is scheduled for this report yet.</div>}
          {data.schedules.map(s => (
            <div key={s.id} data-testid="schedule-row" style={{ marginTop: 12, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{s.cadence}</div>
              <div data-testid="schedule-next" style={{ fontSize: 12.5, color: T.ink2, marginTop: 2 }}>{s.nextSendSentence}</div>
              <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>To {s.recipients.join(", ")}</div>
              {s.sends.length > 0 && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>
                {s.sends.map((x, i) => <div key={i}>Sent {new Date(x.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} to {x.sentTo.join(", ")}{x.held.length ? `. Not sent to ${x.held.map(h => `${h.email} (${h.reason})`).join(", ")}` : ""}.</div>)}
              </div>}
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" style={GHOST} onClick={() => openPreview(`/report-schedules/${encodeURIComponent(s.id)}/preview.pdf`).catch(e => setErr(e.message))}>Preview the PDF</button>
                <button type="button" style={GHOST} onClick={() => setEditing(s)}>Change</button>
                <button type="button" style={{ ...GHOST, color: T.ink, borderColor: T.bg3 }} onClick={() => remove(s)}>Remove</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" data-testid="schedule-new" style={BTN} onClick={() => setEditing({})}>Add a schedule</button>
            <button type="button" style={{ ...GHOST, color: T.ink, borderColor: T.bg3 }} onClick={onClose}>Close</button>
          </div>
        </>}
        {data && editing && <ScheduleForm target={target} data={data} schedule={editing.id ? editing : null}
          onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
      </div>
    </Modal>
  );
}

function ScheduleForm({ target, data, schedule, onDone, onCancel }) {
  const freqs = data.frequencies || ["weekly", "monthly", "quarterly"];
  const [frequency, setFrequency] = useState(schedule ? schedule.frequency : freqs.includes("monthly") ? "monthly" : freqs[0]);
  const [day, setDay] = useState(schedule ? schedule.day : 1);
  const [hour, setHour] = useState(schedule ? schedule.hour : 7);
  const [recipients, setRecipients] = useState(schedule ? schedule.recipients.join("\n") : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const weekly = frequency === "weekly";
  const dayOk = weekly ? day >= 0 && day <= 6 : day >= data.dayMin && day <= data.dayMax;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = JSON.stringify({ target, frequency, day: Number(day), hour: Number(hour), recipients });
      await apiFetch(schedule ? `/report-schedules/${encodeURIComponent(schedule.id)}` : "/report-schedules", { method: schedule ? "PUT" : "POST", body });
      onDone();
    } catch (e) { setErr(errorMessage(e, "That schedule did not save.")); }
    setBusy(false);
  };
  return (
    <div data-testid="schedule-form" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 150px" }}><span style={LBL}>How often</span>
          <select style={{ ...FIELD, width: "100%" }} value={frequency} data-testid="schedule-frequency"
            onChange={e => { const f = e.target.value; setFrequency(f); setDay(f === "weekly" ? 1 : 1); }}>
            {freqs.map(f => <option key={f} value={f}>{FREQ_WORDS[f] || f}</option>)}
          </select></label>
        <label style={{ flex: "1 1 120px" }}><span style={LBL}>{weekly ? "Day" : "Day of the month"}</span>
          <select style={{ ...FIELD, width: "100%" }} value={day} data-testid="schedule-day" onChange={e => setDay(Number(e.target.value))}>
            {weekly ? data.weekdays.map((w, i) => <option key={w} value={i}>{w}</option>)
              : Array.from({ length: data.dayMax - data.dayMin + 1 }, (_, i) => i + data.dayMin).map(d => <option key={d} value={d}>{d}</option>)}
          </select></label>
        <label style={{ flex: "1 1 110px" }}><span style={LBL}>Hour (your organization's time)</span>
          <select style={{ ...FIELD, width: "100%" }} value={hour} data-testid="schedule-hour" onChange={e => setHour(Number(e.target.value))}>
            {HOURS.map(h => <option key={h} value={h}>{hourWords(h)}</option>)}
          </select></label>
      </div>
      {!weekly && <div style={{ fontSize: 12, color: T.ink3 }}>Days run 1 to 28: the 29th, 30th and 31st are not in every month.</div>}
      <label><span style={LBL}>Send it to (one address a line; they do not need a Steward login)</span>
        <textarea data-testid="schedule-recipients" rows={4} style={{ ...FIELD, width: "100%", fontFamily: "inherit" }} value={recipients}
          onChange={e => setRecipients(e.target.value)} placeholder={"chair@example.org\ntreasurer@example.org"} /></label>
      {err && <div data-testid="schedule-error" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" data-testid="schedule-save" disabled={busy || !dayOk || !recipients.trim()} style={{ ...BTN, opacity: busy || !dayOk || !recipients.trim() ? 0.6 : 1 }} onClick={save}>{busy ? "Saving…" : "Save the schedule"}</button>
        <button type="button" data-testid="schedule-preview" style={GHOST}
          onClick={() => openPreview(`/report-schedules/preview.pdf?target=${encodeURIComponent(target)}&frequency=${frequency}`).catch(e => setErr(e.message))}>Preview the PDF</button>
        <button type="button" style={{ ...GHOST, color: T.ink, borderColor: T.bg3 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
