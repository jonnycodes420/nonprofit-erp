// RecordGiftDialog.jsx · GIFTS-1. RECORD A GIFT FROM WHERE YOU ARE.
//
// The event page's "Record a gift" (the attendee menu prefills the person and
// the event; the page's own button prefills only the event) and a grant's
// "Record a payment received" (the funder and the award pledge fixed). Every
// one saves through POST /donors/:id/gifts, the gift form's own route, so the
// gift is recorded, receipted, put on the ledger and waiting for its deposit
// exactly as one typed on the profile. Nothing here counts anything: the
// event's Raised, the attendee's row and the grant's Received re-read.
import { useRef, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { orgTodayCivil } from "../../lib/orgToday";
import { personNamed } from "../../lib/people";
import { PeopleDatalist } from "../PeopleDatalist";
import EventField from "./EventField";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
const lbl = { fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

// person: { id, name } or null (then she types a name on file); eventId: the
// event, or "" for none; pledgeId: the pledge this pays (a grant's award);
// title: the dialog's name.
export default function RecordGiftDialog({ person = null, eventId = "", pledgeId = null, title = "Record a gift", fixedPerson = false, onClose, onSaved, testid = "record-gift" }) {
  const [who, setWho] = useState(person ? person.name : "");
  const [f, setF] = useState({ amount: "", date: orgTodayCivil(), method: "Check", eventId: eventId || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idem = useRef(null);
  const save = async () => {
    setErr("");
    if (!(Number(f.amount) > 0)) { setErr("Type the amount."); return; }
    const p = person && who === person.name ? person : await personNamed(who.trim()).catch(() => null);
    if (!p) { setErr(`${who.trim() || "That name"} is not on file. Choose someone from your records.`); return; }
    setBusy(true);
    if (!idem.current) idem.current = crypto.randomUUID();
    try {
      const r = await apiFetch(`/donors/${p.id}/gifts`, { method: "POST", body: JSON.stringify({
        amount: f.amount, date: f.date, type: "cash", payment_method: f.method || null,
        eventId: f.eventId || undefined, pledgeId: pledgeId || undefined, idempotencyKey: idem.current }) });
      idem.current = null;
      onSaved && onSaved(r, p);
      onClose();
    } catch (e) { setErr(errorMessage(e, "The gift could not be saved.")); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={460} ariaLabel={title}>
      <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{title}</div>
        <label><span style={lbl}>From</span>
          {fixedPerson ? <div data-testid={testid + "-who"} style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}>{who}</div>
            : <><input list="record-gift-people" value={who} onChange={e => setWho(e.target.value)} placeholder="A person on file" data-testid={testid + "-who"} style={inp} />
              <PeopleDatalist id="record-gift-people" text={who} /></>}
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label><span style={lbl}>Amount ($)</span>
            <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} data-testid={testid + "-amount"} style={inp} autoFocus /></label>
          <label><span style={lbl}>Date</span>
            <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} data-testid={testid + "-date"} style={inp} /></label>
          <label><span style={lbl}>Method</span>
            <select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} data-testid={testid + "-method"} style={inp}>
              {["Check", "Cash", "Card", "ACH / bank transfer", "Wire", "Other"].map(m => <option key={m} value={m}>{m}</option>)}
            </select></label>
        </div>
        {!pledgeId && <label><span style={lbl}>Event</span>
          <EventField value={f.eventId} onChange={id => setF({ ...f, eventId: id })} testid={testid + "-event"} /></label>}
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
          <button type="button" style={btn(true)} onClick={save} disabled={busy} data-testid={testid + "-save"}>{busy ? "Saving…" : "Save the gift"}</button>
        </div>
      </div>
    </Modal>
  );
}
