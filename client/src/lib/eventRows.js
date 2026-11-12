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
import { useEffect, useRef, useState } from "react";
import { announce, useChangeRev } from "./changes";

export function eventRowsChanged(eventId) {
  announce({ kinds: ["event"], ids: eventId ? { event: new Set([String(eventId)]) } : {}, source: "event-page" });
}
// A number that moves each time this event's guest rows or gifts change; put
// it in a read's dependencies.
export function useEventRowsRev(eventId) {
  return useChangeRev(["event"], eventId ? { event: eventId } : null);
}

// FLOWS-8 (W-1112-Volunteers-01X) · THE SCREEN AFTER AN ACTION NEVER PAINTS THE OLD COUNT.
// A write bumps the event's rev (apiFetch's own announce, then eventRowsChanged),
// so a panel's read runs twice and the answers can land in either order: the
// older one, landing last, put the count from before the action back on screen
// until the next visit. useLatestRead keeps only the answer for the newest
// deps, and says `pending` from the very render the deps change, so the panel
// shows "Updating…" rather than a number it knows is old.
// Pure: the newest ask wins, whatever order the answers come back in.
export function latestOnly() {
  let n = 0;
  return { next: () => ++n, isLatest: t => t === n };
}

export function useLatestRead(read, deps) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState({ key: null, value: null });
  const gate = useRef(null);
  if (!gate.current) gate.current = latestOnly();
  useEffect(() => {
    const t = gate.current.next();
    Promise.resolve().then(read).then(
      v => { if (gate.current.isLatest(t)) setState({ key, value: v }); },
      () => { if (gate.current.isLatest(t)) setState({ key, value: null }); });
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return [state.value, state.key !== key];
}

// FLOWS-8 (W-1112-Volunteers-21): a write that never answers stops being
// waited for. The request is not cancelled (a write is never cut off half way);
// the screen stops saying "Saving…", says what it knows, and re-reads.
export const WRITE_WAIT_MS = 20000;
export const NO_ANSWER_SENTENCE = "Steward didn't hear back within 20 seconds, so this may or may not have saved. The list now shows what is saved.";
export function withinWrite(promise, ms = WRITE_WAIT_MS) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("no_answer"), { sentence: NO_ANSWER_SENTENCE, noAnswer: true })), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
