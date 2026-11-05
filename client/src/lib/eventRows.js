// COUNTS-1 · AN EVENT'S PANELS RE-READ WHEN ITS GUEST ROWS CHANGE.
//
// The event page has four readers of the same attendee rows: the guest list,
// After the event (Invited, Came, Registered), Tables and seating, and the
// door. Each read once, when the page opened, so a guest added or marked as
// come in one panel left "Invited 0, Came 0" in the next one. Any write to an
// event's guests says so here, and every panel that shows them re-reads.
import { useEffect, useState } from "react";

const EV = "steward:event-rows";
export function eventRowsChanged(eventId) {
  try { window.dispatchEvent(new CustomEvent(EV, { detail: { eventId } })); } catch { /* no window */ }
}
// A number that moves each time this event's guest rows change; put it in a
// read's dependencies.
export function useEventRowsRev(eventId) {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const on = e => { if (!e.detail || !e.detail.eventId || e.detail.eventId === eventId) setRev(r => r + 1); };
    window.addEventListener(EV, on);
    return () => window.removeEventListener(EV, on);
  }, [eventId]);
  return rev;
}
