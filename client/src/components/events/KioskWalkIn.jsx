// client/src/components/events/KioskWalkIn.jsx · EVENTS-4 item 3, moved out of
// Events.jsx's EventKiosk whole (Events.jsx stays under its size baseline).
//
// WALK-INS at the door: somebody on the event's waiting list (added by email,
// so the person on file is the one added), a person already on file, or a new
// name. A new name with an email is matched on file by that email first
// (POST /events/:id/attendees, WIRE-1), so the door never makes a second person.
import { T } from "../shared";
import { GuestOfPicker } from "./GuestOfPicker";

export default function KioskWalkIn({ term, guests, waitingHits, offList, addWalkIn, walkGuestOf, setWalkGuestOf, walkEmail, setWalkEmail }) {
  return (
    <div data-testid="ev-kiosk-walkin" style={{ borderTop: "1px solid " + T.bg3, marginTop: 8, paddingTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>Walk-in, not on the list</div>
      <div style={{ marginBottom: 8 }}><GuestOfPicker guests={guests} value={walkGuestOf} onChange={setWalkGuestOf} testid="ev-kiosk-guest-of" /></div>
      {waitingHits.map(w => (
        <button key={w.id} type="button" data-testid="ev-kiosk-waiting" onClick={() => addWalkIn({ name: w.name, email: w.email })}
          style={{ width: "100%", textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", marginBottom: 6, minHeight: 48, cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, color: T.ink, fontWeight: 600 }}>{w.name} <span style={{ fontSize: 12, color: T.ink3, fontWeight: 500 }}>· on the waiting list{w.level_name ? ` for ${w.level_name}` : ""}</span></span>
          <span style={{ fontSize: 12, color: T.greenDk, fontWeight: 700 }}>Add and check in</span>
        </button>
      ))}
      {offList.map(d => (
        <button key={d.id} type="button" data-testid="ev-kiosk-walkin-person" onClick={() => addWalkIn({ donorId: d.id })}
          style={{ width: "100%", textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 13px", marginBottom: 6, minHeight: 48, cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, color: T.ink, fontWeight: 600 }}>{d.name}</span>
          <span style={{ fontSize: 12, color: T.greenDk, fontWeight: 700 }}>Add and check in</span>
        </button>
      ))}
      <input data-testid="ev-kiosk-walkin-email" type="email" value={walkEmail} onChange={e => setWalkEmail(e.target.value)}
        placeholder="Their email, if they have one (finds them if they're on file)" aria-label="Walk-in's email"
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 15, fontFamily: "inherit", color: T.ink, marginBottom: 6 }} />
      <button type="button" data-testid="ev-kiosk-walkin-new" onClick={() => {
        const t = term.trim(), typedEmail = t.includes("@") ? t : "";
        return addWalkIn({ name: typedEmail ? t.split("@")[0] : t, email: walkEmail.trim() || typedEmail });
      }}
        style={{ width: "100%", textAlign: "left", background: T.white, border: "1.5px dashed " + T.bg3, borderRadius: 10, padding: "11px 13px", minHeight: 48, cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: T.ink }}>
        Add "{term.trim()}" as a new guest and check them in
      </button>
    </div>
  );
}
