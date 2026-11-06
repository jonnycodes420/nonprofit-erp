// COUNTS-1 · AN EVENT'S PANELS RE-READ WHEN ITS GUEST ROWS CHANGE.
//
// The event page has four readers of the same attendee rows: the guest list,
// After the event (Invited, Came, Registered), Tables and seating, and the
// door. Each read once, when the page opened, so a guest added or marked as
// come in one panel left "Invited 0, Came 0" in the next one. Any write to an
// event's guests says so here, and every panel that shows them re-reads.
//
// STALE-1: said and heard through the one channel (lib/changes.js), so a gift
// recorded for this event anywhere (the profile, Fundraising, Atlas) moves the
// panels and the Raised figure too, not only a write from this page.
import { announce, useChangeRev } from "./changes";

export function eventRowsChanged(eventId) {
  announce({ kinds: ["event"], ids: eventId ? { event: new Set([String(eventId)]) } : {}, source: "event-page" });
}
// A number that moves each time this event's guest rows or gifts change; put
// it in a read's dependencies.
export function useEventRowsRev(eventId) {
  return useChangeRev(["event"], eventId ? { event: eventId } : null);
}
