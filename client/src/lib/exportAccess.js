// client/src/lib/exportAccess.js · ACCESS-3. MAY THIS PERSON EXPORT?
//
// The Campaign cabinet preset turns export off (can_export false). GET /me says
// so (user.canExport), and the Donors list hides Export CSV for them; the
// server refuses the export with a 403 either way (server/auth/portfolio.js).
// Its own module, read only by the Donors list, so Home's first look carries
// none of it. One read of GET /me per session token.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";

let pending = null, pendingFor = null;
function load() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve(true);
  if (!pending) pending = apiFetch("/me").then(r => !(r && r.user && r.user.canExport === false)).catch(() => { pending = null; return true; });
  return pending;
}

// true for an admin without asking; for anyone else, false until GET /me
// says yes, so the button never flashes for someone who can't use it.
export function useCanExport(role) {
  const [on, setOn] = useState(role === "admin");
  useEffect(() => {
    if (role === "admin") { setOn(true); return undefined; }
    let live = true;
    load().then(v => { if (live) setOn(!!v); });
    return () => { live = false; };
  }, [role]);
  return on;
}
