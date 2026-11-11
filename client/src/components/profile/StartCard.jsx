// components/profile/StartCard.jsx (PROFILE-3) · EMPTY IS CALM, NOT LOUD.
//
// A person with nothing logged used to get "Nothing due for Harold right now.",
// "Connect your inbox…" and "Nothing here yet." in a column of cream. Now the
// timeline's place holds one quiet card with the three first moves. It goes
// away once anything is logged (DonorProfile's `nothingLogged`).
import { T } from "../shared";

const BTN = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "0 16px", minHeight: 40, color: T.ink, fontSize: 13,
  fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

export function StartCard({ name, isReadOnly, onCall, onNote, onGift }) {
  return (
    <section data-testid="dp-start-card" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "24px 24px",
      display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 22, color: T.ink, lineHeight: 1.2 }}>
          {name ? `Start ${name}'s story` : "Start their story"}</h2>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgba(15,26,18,0.6)", lineHeight: 1.5 }}>
          Calls, notes and gifts show here, newest first, as you log them.</p>
      </div>
      {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" data-testid="dp-start-call" onClick={onCall} style={BTN}>Log a touch</button>
        <button type="button" data-testid="dp-start-note" onClick={onNote} style={BTN}>Add a note</button>
        <button type="button" data-testid="dp-start-gift" onClick={onGift} style={BTN}>Record a gift</button>
      </div>}
    </section>
  );
}
