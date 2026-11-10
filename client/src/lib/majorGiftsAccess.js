// client/src/lib/majorGiftsAccess.js · who may see the major gifts work
// (PROSPECT-1): admins, and staff with the major gifts permission. The SERVER
// is the boundary; this only decides what to draw. Moved out of
// lib/majorGifts.js by ASKS-1 so the shell (the Major Gifts rail entry) loads
// this and nothing else from there.
//
// One read of GET /me per page load, shared by every caller, keyed on the
// session token, so signing out and in as somebody else in the same tab never
// reuses the last person's answer.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";

let pending = null, pendingFor = null;
export function loadCanMajorGifts() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve(false);
  if (!pending) pending = apiFetch("/me").then(r => !!(r && r.user && (r.user.canMajorGifts || r.user.role === "admin"))).catch(() => { pending = null; return false; });
  return pending;
}

// ASKS-1: three-way: null while GET /me has not said, then true or false. The
// rail and the Major Gifts tab wait for it, so somebody without the permission
// never sees the page flash before going Home. An admin always has it, so an
// admin's first look asks nothing.
export function useMajorGiftsAccess(role) {
  const isAdmin = role === "admin";
  const [can, setCan] = useState(isAdmin ? true : null);
  useEffect(() => {
    if (isAdmin) { setCan(true); return undefined; }
    let live = true; loadCanMajorGifts().then(v => live && setCan(!!v)); return () => { live = false; };
  }, [isAdmin]);
  return can;
}
