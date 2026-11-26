// shared/importUndo.js · POLISH-13 item 5 (W-1119-Atlas-13). HOW LONG AN IMPORT CAN BE UNDONE, IN ONE PLACE.
//
// "No undo window length is stated anywhere on the page or in a receipt, so a user still cannot
// tell whether they can still undo." The window is a setting per kind of file (the server's
// importUndoWindow, server/imports/routes.js, judges an Undo by it), and every screen that says it
// reads it here: the import's confirm screen, its receipt, and Settings → Imports. A window that has
// closed says so, instead of a dead Undo.
//
// JSX-free and ESM (shared/endOnName.js's shape), so the client imports it and Node requires it.

// Hours an import of each kind can be undone, from its commit. A kind not listed: the deposit's.
export const DEPOSIT_REVERSE_HOURS = 24;
export const SHAPE_REVERSE_HOURS = Object.freeze({
  deposit: DEPOSIT_REVERSE_HOURS, gift_file_with_donors: 24 * 7, gifts: 24 * 7, history: 24 * 7, transaction: 24 * 7,
  sheet: 24 * 30, aggregate: 24 * 30, wide: 24 * 30, workbook: 24 * 30, both: 24 * 30,
});

// The last moment an import of `shape` committed at `committedAt` can be undone (a Date), or null.
export function undoUntil(shape, committedAt) {
  if (!committedAt) return null;
  const t = new Date(committedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + (SHAPE_REVERSE_HOURS[shape] || DEPOSIT_REVERSE_HOURS) * 3600e3);
}

// "Dec 3, 2026" in the org's zone (the caller's), or UTC.
function day(d, timeZone) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timeZone || "UTC" });
}

// The one sentence. Open: "You can undo this import until Dec 3, 2026." Closed: "The window to undo
// this import closed on Dec 3, 2026." `now` is a Date (the caller's clock).
export function undoWords(until, { now = new Date(), timeZone } = {}) {
  if (!until) return "";
  return new Date(until) > now
    ? `You can undo this import until ${day(until, timeZone)}.`
    : `The window to undo this import closed on ${day(until, timeZone)}.`;
}
