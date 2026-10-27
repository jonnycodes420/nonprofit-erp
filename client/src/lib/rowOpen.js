// lib/rowOpen.js · POLISH-3 · CLICK ANYWHERE.
//
// A card or a list row that opens something opens when you click anywhere on
// it, and Enter opens it from the keyboard. What is inside it keeps its own
// job: a button, link, field, checkbox or menu does its own thing and never
// also opens the row; a click inside a portal (a menu or dialog the row
// opened) never reaches the row; and dragging across text to select it is not
// a click. JSX-free, so a page outside the app shell (the super-admin
// dashboard) can use it without the app's styles. In the app, use
// `interactive()` from components/shared.jsx, which adds the look.
export const ROW_INNER = "button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=menu],[role=menuitem],[role=checkbox],[role=switch],[role=dialog],[contenteditable=true],[data-row-inner]";

export function rowOwnsEvent(e, isClick) {
  const row = e && e.currentTarget, t = e && e.target;
  if (!row || !t) return true;
  if (t !== row && !(row.contains && row.contains(t))) return false;
  const hit = t !== row && t.closest ? t.closest(ROW_INNER) : null;
  if (hit && hit !== row && row.contains(hit)) return false;
  if (isClick && typeof window !== "undefined" && window.getSelection) {
    const sel = window.getSelection();
    if (sel && String(sel).trim() && sel.anchorNode && row.contains(sel.anchorNode)) return false;
  }
  return true;
}

// Props for a row element: role, tab stop, click and Enter/Space. With
// `href`, Cmd/Ctrl/Shift-click opens the same place in a new tab.
export function rowOpenProps(onOpen, opts = {}) {
  if (!onOpen) return {};
  return {
    onClick: e => {
      if (!rowOwnsEvent(e, true)) return;
      const plain = (e.button === 0 || e.button == null) && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
      if (opts.href && !plain) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); window.open(opts.href, "_blank", "noopener"); }
        return;
      }
      onOpen(e);
    },
    onKeyDown: e => { if ((e.key === "Enter" || e.key === " ") && rowOwnsEvent(e, false)) { e.preventDefault(); onOpen(e); } },
    role: opts.role || "button",
    tabIndex: 0,
    "aria-label": opts.label,
  };
}
