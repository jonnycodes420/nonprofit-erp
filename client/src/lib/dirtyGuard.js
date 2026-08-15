// BUILD-54 §6 — unsaved-state handling, one mechanism for every settings/
// editor surface. A form with unsaved edits registers itself via
// useDirtyGuard(dirty); navigation choke points (App tab switches, Settings
// section switches) call confirmIfDirty() before moving, and the browser's
// own beforeunload guard covers closing/refreshing the tab. Born of a real
// incident: an image was uploaded, Save was never clicked, and the product
// appeared broken.
import { useEffect, useRef } from "react";

const holders = new Set();

export function markDirty(token, dirty) {
  if (dirty) holders.add(token); else holders.delete(token);
}

export function anyDirty() {
  return holders.size > 0;
}

// Returns true when it's OK to navigate. Confirming clears the registry (the
// forms unmount with the navigation).
export function confirmIfDirty(message) {
  if (!holders.size) return true;
  const ok = window.confirm(message || "You have unsaved changes — leave without saving them?");
  if (ok) holders.clear();
  return ok;
}

export function useDirtyGuard(dirty) {
  const token = useRef({});
  useEffect(() => {
    const t = token.current;
    markDirty(t, dirty);
    return () => markDirty(t, false);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}
