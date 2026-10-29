// idleDraft.js — SECURE-2 item 7. WHAT SHE WAS TYPING SURVIVES AN IDLE SIGN-OUT.
//
// At the moment Steward signs somebody out for being idle, every text field
// and text area on the page that holds something typed (its value differs
// from what the page drew) is kept in this tab's sessionStorage, under the
// page's address. After she signs in again and lands on that page, the values
// are put back once, through React's own input path, and the copy is gone.
// sessionStorage only: it never leaves the tab, and closing the tab clears it.
// Passwords and codes are never kept.
const KEY = "steward_idle_drafts";
const SKIP = /^(password|hidden|file|checkbox|radio|submit|button)$/i;

const fieldKey = el => el.getAttribute("data-testid") ? "t:" + el.getAttribute("data-testid")
  : el.id ? "i:" + el.id : el.name ? "n:" + el.name : el.getAttribute("aria-label") ? "a:" + el.getAttribute("aria-label") : null;

function findField(key) {
  const [kind, ...rest] = key.split(":");
  const v = rest.join(":");
  const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
  if (kind === "t") return document.querySelector(`[data-testid="${esc(v)}"]`);
  if (kind === "i") return document.getElementById(v);
  if (kind === "n") return document.querySelector(`[name="${esc(v)}"]`);
  if (kind === "a") return document.querySelector(`[aria-label="${esc(v)}"]`);
  return null;
}

export function saveDrafts() {
  try {
    const fields = [];
    for (const el of document.querySelectorAll("input, textarea")) {
      if (el.tagName === "INPUT" && SKIP.test(el.type || "")) continue;
      if (/code|otp|password/i.test(el.autocomplete || "") || el.inputMode === "numeric" && /code/i.test(el.getAttribute("aria-label") || "")) continue;
      const v = el.value;
      if (!v || v === el.defaultValue) continue;
      const k = fieldKey(el);
      if (k) fields.push({ k, v: String(v).slice(0, 20000) });
    }
    if (!fields.length) return 0;
    sessionStorage.setItem(KEY, JSON.stringify({ path: window.location.pathname + window.location.search, at: Date.now(), fields }));
    return fields.length;
  } catch { return 0; }
}

// Put the values back into a React-controlled field: the native setter, then
// an input event, so the component's own state takes the value.
function fill(el, v) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value").set;
  set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Called once the app is up after a sign-in. Retries for a few seconds while
// the page draws its form; gives up quietly after that (a day-old draft is
// dropped too).
export function restoreDrafts() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { saved = null; }
  if (!saved || !Array.isArray(saved.fields)) return;
  if (Date.now() - (saved.at || 0) > 24 * 3600 * 1000) { try { sessionStorage.removeItem(KEY); } catch { /* storage off */ } return; }
  if (saved.path !== window.location.pathname + window.location.search) return;
  let tries = 0;
  const left = new Map(saved.fields.map(f => [f.k, f.v]));
  const tick = () => {
    for (const [k, v] of [...left]) {
      const el = findField(k);
      if (el) { fill(el, v); left.delete(k); }
    }
    if (left.size && ++tries < 20) setTimeout(tick, 250);
    else { try { sessionStorage.removeItem(KEY); } catch { /* storage off */ } }
  };
  setTimeout(tick, 200);
}
