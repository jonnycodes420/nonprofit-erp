// components/events/GuestOfPicker.jsx · CONNECT-1. "GUEST OF…" WHEN A GUEST IS ADDED.
// A choice over the people already on this event's list. Choosing one sends
// guestOfDonorId with the add (POST /events/:id/attendees), which links the
// new guest to them (guest_of, with this event) on both profiles. Optional:
// left empty, the add is exactly what it was.
import { T } from "../shared";

export function GuestOfPicker({ guests = [], value = "", onChange, style = null, testid = "ev-guest-of" }) {
  const seen = new Set();
  const hosts = guests.filter(g => g && g.donor_id && !seen.has(g.donor_id) && seen.add(g.donor_id))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  if (!hosts.length) return null;
  return (
    <select data-testid={testid} aria-label="Guest of" value={value} onChange={e => onChange && onChange(e.target.value)}
      style={style || { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, fontFamily: "inherit", width: "100%" }}>
      <option value="">Guest of… (optional)</option>
      {hosts.map(g => <option key={g.donor_id} value={g.donor_id}>{`Guest of ${g.name}`}</option>)}
    </select>
  );
}
