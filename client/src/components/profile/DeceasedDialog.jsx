// components/profile/DeceasedDialog.jsx · PEOPLE-1. Mark someone deceased, with
// care, from the profile's More menu; undo it from the same menu; and the quiet
// banner the profile shows. The server (server/donors/deceased.js) does the
// rest in one step: no asks, no suggestions, no sends, journeys ended.
import { useEffect, useState } from "react";
import { Modal, T } from "../shared";
import { apiFetch } from "../../api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "March 3, 2026", "March 2026", "2026" (the server's diedWords, for the banner).
function diedWords(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(v || ""));
  if (!m) return null;
  if (!m[2]) return m[1];
  if (!m[3]) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

const label = { display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 6 };
const hint = { fontSize: 12, color: T.ink3, marginTop: 4, lineHeight: 1.5 };
const field = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", color: T.ink, background: T.white, boxSizing: "border-box" };
const primary = { background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "0 16px", minHeight: 40, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 9, padding: "0 14px", minHeight: 40, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

function MarkDeceasedModal({ donor, onClose, onDone, onClosed }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(false);
  const [partner, setPartner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  // Closing after a change re-reads the record, so every panel of the profile shows it.
  const close = () => { onClose(); if (done && onClosed) onClosed(); };
  useEffect(() => {
    apiFetch(`/donors/${donor.id}/deceased`).then(r => setPartner((r && r.partners && r.partners[0]) || null)).catch(() => {});
  }, [donor.id]);
  const diedOn = year ? [year, month && String(month).padStart(2, "0"), month && day && String(day).padStart(2, "0")].filter(Boolean).join("-") : "";
  const dateBad = (!year && (month || day)) || (year && !/^\d{4}$/.test(year)) || (day && !month);
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/donors/${donor.id}/deceased`, { method: "POST", body: JSON.stringify({ diedOn: diedOn || null, note, remind }) });
      setDone(r.sentence || "Marked deceased.");
      if (onDone) onDone(r);
    } catch (e) { setErr((e && (e.sentence || e.message)) || "That didn't save. Try again."); }
    setBusy(false);
  };
  const owner = donor.assignedToName || "you";
  return (
    <Modal onClose={close} width={520} title={`Mark ${donor.name} as deceased`}>
      {done ? <div data-testid="dp-deceased-done">
        <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 16px" }}>{done}</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={primary} onClick={close}>Done</button></div>
      </div> : <div data-testid="dp-deceased-dialog">
        <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 16px" }}>
          They won't be asked, suggested or sent anything again. Their giving history, receipts, tributes and household stay as they are.
        </p>
        <div style={{ marginBottom: 14 }}>
          <span style={label}>Date of death (optional)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label="Month" data-testid="dp-deceased-month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...field, flex: "1 1 140px" }}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input aria-label="Day" data-testid="dp-deceased-day" inputMode="numeric" placeholder="Day" value={day} onChange={e => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} style={{ ...field, width: 72 }} />
            <input aria-label="Year" data-testid="dp-deceased-year" inputMode="numeric" placeholder="Year" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ ...field, width: 90 }} />
          </div>
          <div style={hint}>A month and year is enough.</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="dp-deceased-note">A private note (optional)</label>
          <textarea id="dp-deceased-note" data-testid="dp-deceased-note" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} style={{ ...field, width: "100%", resize: "vertical" }} />
          <div style={hint}>Only your team sees this.</div>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, cursor: "pointer" }}>
          <input type="checkbox" data-testid="dp-deceased-remind" checked={remind} onChange={e => setRemind(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>Remind me each year on the anniversary</span>
            <span style={{ ...hint, display: "block" }}>A task for {owner}: a note to {partner ? partner.name : "their family"}. Steward never sends it.</span>
          </span>
        </label>
        {dateBad && <div role="alert" style={{ ...hint, color: T.ink, marginBottom: 10 }}>Give a year, a month and year, or a whole date.</div>}
        {err && <div role="alert" style={{ ...hint, color: T.ink, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={quiet} onClick={close}>Cancel</button>
          <button type="button" data-testid="dp-deceased-confirm" style={{ ...primary, opacity: busy || dateBad ? 0.6 : 1 }} disabled={busy || !!dateBad} onClick={save}>{busy ? "Saving…" : "Mark as deceased"}</button>
        </div>
      </div>}
    </Modal>
  );
}

function UndoDeceasedModal({ donor, onClose, onDone, onClosed }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // Closing after a change re-reads the record, so every panel of the profile shows it.
  const close = () => { onClose(); if (done && onClosed) onClosed(); };
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/donors/${donor.id}/not-deceased`, { method: "POST", body: "{}" });
      setDone(r.sentence || "Done.");
      if (onDone) onDone(r);
    } catch (e) { setErr((e && (e.sentence || e.message)) || "That didn't save. Try again."); }
    setBusy(false);
  };
  return (
    <Modal onClose={close} width={480} title="Undo: they're not deceased">
      <div data-testid="dp-not-deceased-dialog">
        <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 16px" }}>
          {done || `${donor.name} comes back into every list, and the asks that closed when they were marked reopen. Journeys that ended stay ended.`}
        </p>
        {err && <div role="alert" style={{ ...hint, color: T.ink, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {done ? <button type="button" style={primary} onClick={close}>Done</button> : <>
            <button type="button" style={quiet} onClick={close}>Cancel</button>
            <button type="button" data-testid="dp-not-deceased-confirm" style={primary} disabled={busy} onClick={go}>{busy ? "Saving…" : "They're not deceased"}</button>
          </>}
        </div>
      </div>
    </Modal>
  );
}

// The quiet line under the name: "In memory · died March 2026".
function DeceasedBanner({ donor }) {
  if (!donor || !donor.deceased) return null;
  const w = diedWords(donor.deceasedDate);
  return (
    <div data-testid="dp-in-memory" role="note" style={{ gridColumn: "2 / -1", gridRow: 5, marginTop: 10, justifySelf: "start", background: T.bg, color: T.ink, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600 }}>
      {w ? `In memory · died ${w}` : "In memory"}
    </div>
  );
}

export { MarkDeceasedModal, UndoDeceasedModal, DeceasedBanner, diedWords };
