// client/src/lib/commitGuard.js · HARDEN-1 item 5. NOTHING COMMITS WITHOUT A CLICK ON ITS BUTTON.
//
// On 27 Oct an Enter in the "Name this import" field of the old Import Donors
// screen is the likely way 656 people were written into the wrong org. A key
// press meant for a field must never be the click that imports, undoes,
// deletes, merges, restores or sends.
//
// One rule, enforced in one place for every button marked `data-commit`:
//   - a pointer click commits (event.detail >= 1);
//   - a keyboard activation commits only when that button is the focused
//     element AND it already said what it says now when it took focus. So
//     Enter in a field (a form's implicit submit clicks its submit button
//     while focus stays in the field) is refused, and so is Enter on a "Next"
//     button that re-rendered into "Import 656 people" under the focus.
// And on a screen marked `data-commit-screen` (or a Modal given the class
// `commit-screen`), Enter in a text field does nothing at all, so there is no
// implicit form submit to begin with.
//
// The listeners sit on window in the capture phase, so they run before React's
// own (on the root and on each portal's container) and a refused click never
// reaches the button's onClick.

const focusLabel = new WeakMap();
const labelOf = el => String(el.textContent || "").replace(/\s+/g, " ").trim();
const TYPING = /^(text|search|email|tel|url|number|password|date|datetime-local|month|week|time|)$/;
let installed = false;

export function installCommitGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("focusin", e => {
    const b = e.target && e.target.closest && e.target.closest("[data-commit]");
    if (b) focusLabel.set(b, labelOf(b));
  }, true);
  window.addEventListener("click", e => {
    const b = e.target && e.target.closest && e.target.closest("[data-commit]");
    if (!b || e.detail > 0) return;
    const deliberate = document.activeElement === b && focusLabel.get(b) === labelOf(b);
    if (deliberate) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (!t || t.tagName !== "INPUT" || !TYPING.test(String(t.type || "").toLowerCase())) return;
    if (t.closest && t.closest("[data-commit-screen], .commit-screen")) e.preventDefault();
  }, true);
}
