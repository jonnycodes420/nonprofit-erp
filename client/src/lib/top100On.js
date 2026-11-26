// client/src/lib/top100On.js · POLISH-12 item 4. IS THE TOP 100 ON FOR THIS ORG?
//
// orgs.top100_enabled, off unless the org turns it on (server/org/menu.js; the
// server's own check is server/majorGifts/top100Switch.js). One read of GET
// /org/menu per session token, shared by every caller; Settings saving the
// menu ("steward:org-menu") answers it again at once. null while unknown, so
// nothing about the Top 100 is drawn until it is known to be on.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";

let pending = null, pendingFor = null, known = null;
export function loadTop100On() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; known = null; }
  if (!tok) return Promise.resolve(false);
  if (!pending) pending = apiFetch("/org/menu").then(r => (known = !!(r && r.top100))).catch(() => { pending = null; return false; });
  return pending;
}

export function useTop100On() {
  const [on, setOn] = useState(known);
  useEffect(() => {
    let live = true;
    loadTop100On().then(v => live && setOn(v));
    const onMenu = e => { const v = !!(e && e.detail && e.detail.top100); known = v; pending = Promise.resolve(v); if (live) setOn(v); };
    window.addEventListener("steward:org-menu", onMenu);
    return () => { live = false; window.removeEventListener("steward:org-menu", onMenu); };
  }, []);
  return on;
}
