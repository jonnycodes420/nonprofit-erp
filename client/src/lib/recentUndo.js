// FIX-45 · WHAT THIS TAB OFFERED TO UNDO.
//
// The server lists every undo it can rebuild on its own (the trash, a skipped
// To confirm card, a person added by hand: GET /recent-changes). A few screens
// undo a change by sending the old values back through the item's own route,
// and only the screen knows those values. Those offers are kept here, for this
// tab, so Recent changes can list them too while the page is open.
//
// UNDONE is the one event every screen may listen for: after any Undo, from
// the toast or from Recent changes, a screen reloads from the server rather
// than trusting what it drew before the change.
export const UNDONE = "steward:undone";
export const SESSION_UNDO_MINUTES = 30;

const offers = [];
let seq = 0;

export function rememberOffer({ message, action, label }) {
  if (typeof action !== "function") return null;
  const entry = { id: "tab:" + (++seq), sentence: message || (label ? `Changed the ${label}.` : "A change."), action,
    at: new Date().toISOString(), until: new Date(Date.now() + SESSION_UNDO_MINUTES * 60000).toISOString(), done: false };
  offers.unshift(entry);
  if (offers.length > 50) offers.length = 50;
  return entry;
}

export function sessionOffers() {
  const now = Date.now();
  return offers.filter(o => !o.done && new Date(o.until).getTime() > now);
}

export function markUndone(entry) { if (entry) entry.done = true; }

export function announceUndone(detail) {
  try { window.dispatchEvent(new CustomEvent(UNDONE, { detail: detail || null })); } catch { /* no window */ }
}
