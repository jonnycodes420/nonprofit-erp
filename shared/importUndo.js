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
// IMPORT-13: one window for every file (the gauntlet read "a gift file gets 7 days and a spreadsheet 30" in
// Settings while every door opens the one reader); a bank deposit is not a file of people and keeps its day.
export const IMPORT_UNDO_DAYS = 30;
export const SHAPE_REVERSE_HOURS = Object.freeze({
  deposit: DEPOSIT_REVERSE_HOURS, ...Object.fromEntries(["gift_file_with_donors", "gifts", "history", "transaction", "sheet", "aggregate", "wide", "workbook", "both"]
    .map(k => [k, 24 * IMPORT_UNDO_DAYS])),
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

// How long an import of `shape` can be undone, in words: "7 days", "30 days", "24 hours".
export function windowWords(shape) {
  const h = SHAPE_REVERSE_HOURS[shape] || DEPOSIT_REVERSE_HOURS;
  return h % 24 === 0 && h > 24 ? `${h / 24} days` : `${h} hours`;
}

// The one sentence. POLISH-15 item 5 (W-1127-Settings-01, "no undo window length is stated"): it
// names the date and, given the shape, the window's length. Open: "Undo available until Dec 3, 2026
// (7 days from the import)." Closed: "Undo window closed Dec 3, 2026 (it was open 7 days)."
// `now` is a Date (the caller's clock).
export function undoWords(until, { now = new Date(), timeZone, shape } = {}) {
  if (!until) return "";
  const len = shape ? windowWords(shape) : "";
  return new Date(until) > now
    ? `Undo available until ${day(until, timeZone)}${len ? ` (${len} from the import)` : ""}.`
    : `Undo window closed ${day(until, timeZone)}${len ? ` (it was open ${len})` : ""}.`;
}
