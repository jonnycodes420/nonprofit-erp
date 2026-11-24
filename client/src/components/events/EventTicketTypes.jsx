// client/src/components/events/EventTicketTypes.jsx · EVENTS-4 item 1.
//
// "No ticket-type creation UI is reachable on staging" (fleet, 22 Nov). The
// ticket types lived only on Fundraising > Tickets & sponsors, and a $0 price
// was refused, so with no payments connected nothing could be made. This is
// the one ticket-types card, on the Events page and on Fundraising alike
// (moved from EventsDesk.jsx, nothing else changed in it but the free ticket):
// a ticket may be $0 (free, no gift is recorded); a paid one can be made and
// saved with no payments, and says it goes on sale once they are connected.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../api";
import { T, fmtFull, Card } from "../shared";
import { errorMessage } from "../../lib/domainError";
import RemoveMenu from "../RemoveMenu";
import PhotoField from "../PhotoField";
import Picture from "../Picture";
import { isFreeLevel } from "../../../../shared/eventShape";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink, cursor: "pointer" });
const h = { fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 8 };
const BLANK = { kind: "ticket", name: "", price: "", fmv: "", memberPrice: "", capacity: "", recognition: "", benefits: "" };

// FIX-41: a ticket type's or sponsorship level's optional small picture. The
// thumbnail (or "Add a picture") opens the one picture control; it saves at once.
function LevelPicture({ level, disabled, onSaved }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const save = async p => {
    setErr("");
    try { await apiFetch(`/pictures/event_level/${level.id}`, { method: "PUT", body: JSON.stringify({ picture: p }) }); onSaved && onSaved(); }
    catch (e) { setErr(errorMessage(e, "That photo did not save.")); }
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} data-testid="event-level-picture"
        aria-label={level.picture ? `Change the picture for ${level.name}` : `Add a picture for ${level.name}`}
        style={{ width: 36, height: 36, padding: 0, borderRadius: 7, overflow: "hidden", border: "1px dashed " + T.bg3, background: T.bg, cursor: disabled ? "default" : "pointer", fontSize: 9, fontWeight: 700, color: T.ink3, fontFamily: "inherit", lineHeight: 1.1 }}>
        {level.picture ? <Picture value={level.picture} alt={level.name} ratio="1 / 1" radius={0} width={120} /> : "Add a photo"}
      </button>
      {open && !disabled && <span style={{ width: 160 }}><PhotoField variant="small" name={level.name} value={level.picture} onChange={save} testid="event-level-photo" /></span>}
      {err && <span role="alert" style={{ fontSize: 11.5, color: T.ink }}>{err}</span>}
    </span>
  );
}

// `levels` and `onChanged` come from a screen that already reads the levels
// (Fundraising's desk); without them the card reads its own.
export default function EventTicketTypes({ eventId, isReadOnly, levels: given, onChanged, paymentsConnected }) {
  const [own, setOwn] = useState([]);
  const [lv, setLv] = useState(BLANK);
  const [editBenefits, setEditBenefits] = useState(null);   // { id, text }
  const [msg, setMsg] = useState("");
  const levels = given || own;
  const readOwn = useCallback(() => apiFetch(`/events/${eventId}/levels`).then(r => setOwn(r.levels || [])).catch(() => {}), [eventId]);
  useEffect(() => { if (!given) readOwn(); }, [given, readOwn]);
  const reload = () => { if (onChanged) onChanged(); if (!given) readOwn(); };
  const act = async (fn, okMsg) => { setMsg(""); try { await fn(); if (okMsg) setMsg(okMsg); reload(); } catch (e) { setMsg(errorMessage(e, "That did not save.")); } };
  const addLevel = () => act(() => apiFetch(`/events/${eventId}/levels`, { method: "POST", body: JSON.stringify(lv) }).then(() => setLv(BLANK)),
    lv.kind === "ticket" && String(lv.price).trim() !== "" && Number(lv.price) === 0 ? `${lv.name.trim() || "The ticket"} is free: people register with no payment, and no gift is recorded.` : "");
  const saveBenefits = () => act(() => apiFetch(`/event-levels/${editBenefits.id}`, { method: "PUT", body: JSON.stringify({ benefits: editBenefits.text }) })
    .then(() => setEditBenefits(null)), "Saved. The sponsor card on the page shows it now.");
  return (
    <Card style={{ padding: "16px 18px" }} data-testid="event-ticket-types">
      <div style={h}>Tickets and sponsorships</div>
      {levels.map(l => (
        <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 13, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
          <LevelPicture level={l} disabled={isReadOnly} onSaved={reload} />
          <strong style={{ minWidth: 160 }}>{l.name}</strong>
          <span data-testid="event-level-price">{isFreeLevel(l) ? "Free" : fmtFull(l.price)}</span>
          <span style={{ color: T.ink3 }}>{l.kind === "sponsor" ? "sponsorship"
            : isFreeLevel(l) ? (paymentsConnected === false ? "registers with no payments; no gift is recorded" : "no gift is recorded")
            : `worth ${fmtFull(l.fmv)}, so ${fmtFull(l.deductible)} deductible${paymentsConnected === false ? " · on sale once payments are connected" : ""}`}</span>
          {l.memberPrice != null && <span style={{ color: T.ink3 }} title="A current member of this organization pays this instead. Steward checks the membership against the email at checkout; the page never decides it.">members {fmtFull(l.memberPrice)}</span>}
          <span style={{ marginLeft: "auto", color: T.ink3 }}>{l.capacity == null ? `${l.taken} taken` : `${l.taken} of ${l.capacity} taken`}</span>
          {l.retired && <span data-testid="event-level-retired" style={{ fontSize: 11, fontWeight: 800, color: T.ink3, border: "1px solid " + T.bg3, borderRadius: 6, padding: "1px 7px" }}>Retired</span>}
          <RemoveMenu kind={l.kind === "sponsor" ? "sponsor_level" : "ticket_type"} id={l.id} disabled={isReadOnly || l.retired} onDone={reload} />
          {l.kind === "sponsor" && (editBenefits && editBenefits.id === l.id
            ? <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea value={editBenefits.text} onChange={e => setEditBenefits({ ...editBenefits, text: e.target.value })} rows={4}
                  placeholder={"What it comes with, one per line\nA table for ten\nYour name on the stage screen"} style={{ ...inp, fontFamily: "inherit" }} data-testid="event-level-benefits" />
                <span style={{ display: "flex", gap: 6 }}><button onClick={saveBenefits} style={btn(true)} data-testid="event-level-benefits-save">Save</button>
                  <button onClick={() => setEditBenefits(null)} style={btn(false)}>Cancel</button></span>
              </div>
            : <div style={{ flexBasis: "100%", fontSize: 12, color: T.ink3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <span>{(l.benefits || []).length ? (l.benefits || []).join(" · ") : "No benefits listed yet."}</span>
                {!isReadOnly && <button onClick={() => setEditBenefits({ id: l.id, text: (l.benefits || []).join("\n") })} style={{ ...btn(false), padding: "3px 9px", fontSize: 12 }}>
                  {(l.benefits || []).length ? "Edit benefits" : "Add benefits"}</button>}
              </div>)}
        </div>))}
      {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <select value={lv.kind} onChange={e => setLv({ ...lv, kind: e.target.value })} style={inp}><option value="ticket">Ticket</option><option value="sponsor">Sponsorship</option></select>
        <input placeholder="Name (e.g. Dinner ticket)" value={lv.name} onChange={e => setLv({ ...lv, name: e.target.value })} style={{ ...inp, width: 170 }} />
        <input placeholder={lv.kind === "ticket" ? "Price (0 = free)" : "Price"} aria-label="Price" type="number" min={0} value={lv.price} onChange={e => setLv({ ...lv, price: e.target.value })} style={{ ...inp, width: 80 }} />
        <input placeholder="Value received" type="number" value={lv.fmv} onChange={e => setLv({ ...lv, fmv: e.target.value })} style={{ ...inp, width: 110 }} title="What the guest receives, such as the dinner. The receipt says only the rest is deductible." />
        {lv.kind === "ticket" && <input placeholder="Member price" type="number" value={lv.memberPrice} onChange={e => setLv({ ...lv, memberPrice: e.target.value })} style={{ ...inp, width: 120 }} title="What a current member pays. Leave it empty and everybody pays the same. Steward checks the membership against the email at checkout, so the page never decides it." />}
        <input placeholder="Places" type="number" value={lv.capacity} onChange={e => setLv({ ...lv, capacity: e.target.value })} style={{ ...inp, width: 70 }} />
        {lv.kind === "sponsor" && <input placeholder="Recognition, e.g. {{name}}, Gold sponsor" value={lv.recognition} onChange={e => setLv({ ...lv, recognition: e.target.value })} style={{ ...inp, width: 240 }} />}
        {lv.kind === "sponsor" && <textarea placeholder={"What it comes with, one per line\nA table for ten\nYour name on the stage screen"} value={lv.benefits} onChange={e => setLv({ ...lv, benefits: e.target.value })} rows={3} style={{ ...inp, flexBasis: "100%", fontFamily: "inherit" }} />}
        <button onClick={addLevel} style={btn(false)} data-testid="event-add-level">Add</button>
      </div>}
      {msg && <div role="status" data-testid="event-level-msg" style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{msg}</div>}
    </Card>
  );
}
