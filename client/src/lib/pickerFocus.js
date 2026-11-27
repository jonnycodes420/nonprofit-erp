// POLISH-15 item 3 (W-1127-Volunteers-02) · A CLICK ON A FIELD'S OWN PICKER IS NOT A CLICK OUTSIDE.
//
// "Clicking an hour option in the Meeting time picker closes the whole dialog
// without saving." A browser's own time, date or select picker draws outside
// the page; a click on it that reaches the page lands on whatever is beneath,
// and beneath was the dialog's backdrop, whose press closes the dialog. While
// such a field inside the dialog has the focus (its picker may be open), the
// first press outside only takes the focus off it, closing the picker; the
// dialog stays. A second press outside closes the dialog as before.
const PICKER_TYPES = new Set(["time", "date", "datetime-local", "month", "week", "color"]);

export function pickerFieldFocused(dialogEl) {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  if (!a || !dialogEl || !dialogEl.contains(a)) return null;
  const tag = String(a.tagName || "").toLowerCase();
  if (tag === "select") return a;
  if (tag === "input" && PICKER_TYPES.has(String(a.type || "").toLowerCase())) return a;
  // A list a field draws itself (the one time box's hours) says so while it is open.
  if (a.closest && a.closest("[data-own-picker='open']")) return a;
  return null;
}

// Escape inside a field's own open list closes the list, not the dialog.
export function escapeIsLocal(target) {
  return !!(target && target.closest && target.closest("[data-own-picker='open']"));
}
