// POLISH-15 item 3 (W-1127-Volunteers-02) · A CLICK ON A FIELD'S OWN PICKER IS NOT A CLICK OUTSIDE.
//
// "Clicking an hour option in the Meeting time picker closes the whole dialog
// without saving." A browser's own time, date or select picker draws outside
// the page; a click on it that reaches the page lands on whatever is beneath,
// and beneath was the dialog's backdrop, whose press closes the dialog. While
// such a field inside the dialog has the focus (its picker may be open), the
// first press outside only takes the focus off it, closing the picker; the
// dialog stays. A second press outside closes the dialog as before.
// One regex for the native pickers' field types (smaller on Home's first look than a Set).
export function pickerFieldFocused(dialogEl) {
  const a = document.activeElement;
  if (!a || !dialogEl || !dialogEl.contains(a)) return null;
  // A select, a native picker input, or a list a field draws itself (the time box's hours) while it is open.
  return a.tagName === "SELECT" || (a.tagName === "INPUT" && /^(time|date|datetime-local|month|week|color)$/.test(a.type)) || a.closest("[data-own-picker='open']") ? a : null;
}

// Escape inside a field's own open list closes the list, not the dialog.
export const escapeIsLocal = t => !!(t && t.closest && t.closest("[data-own-picker='open']"));
