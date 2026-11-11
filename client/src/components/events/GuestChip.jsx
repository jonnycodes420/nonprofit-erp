// components/events/GuestChip.jsx · one guest on the seating screen (PARITY-4),
// moved out of Events.jsx whole in CONNECT-1 so the file stays under its size baseline.
import { T } from "../shared";

// A guest, tappable and draggable and reachable by keyboard. It is a BUTTON so
// the phone, the mouse and the Tab key all reach it the same way; drag is an
// extra on top rather than the only means.
export function GuestChip({ g, picked, onToggle, onDragStart, onDragEnd, chair = null }) {
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
