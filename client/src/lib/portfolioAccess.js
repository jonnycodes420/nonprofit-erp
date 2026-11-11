// client/src/lib/portfolioAccess.js · ACCESS-2. Someone who sees only the
// people assigned to them (GET /me user.portfolio). The SERVER is the guard
// (server/auth/portfolio.js): every surface not open to them answers 404.
// This only keeps the rail to the pages that answer: Home, Tasks, Donors and
// Settings. One read of GET /me per session token, as majorGiftsAccess.js.
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../api";

export const PORTFOLIO_PAGES = new Set(["dashboard", "tasks", "donors", "settings"]);

// ACCESS-3: the same read carries canExport (off for the Campaign cabinet
// preset), so the Donors list hides Export CSV for them; the server refuses
// it with a 403 either way (server/auth/portfolio.js gate).
let pending = null, pendingFor = null;
function loadMe() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve({ portfolio: false, canExport: true });
  if (!pending) pending = apiFetch("/me").then(r => ({ portfolio: !!(r && r.user && r.user.portfolio), canExport: !(r && r.user && r.user.canExport === false) }))
    .catch(() => { pending = null; return { portfolio: false, canExport: true }; });
  return pending;
}
const load = () => loadMe().then(m => m.portfolio);

// false for an admin without asking; otherwise what GET /me says.
export function usePortfolio(role) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!role || role === "admin") { setOn(false); return undefined; }
    let live = true;
    load().then(v => { if (live) setOn(!!v); });
    return () => { live = false; };
  }, [role]);
  return on;
}

// The rail's groups with only their pages, and a group with none left dropped.
export function portfolioNav(groups, on) {
  if (!on) return groups;
  return groups.map(g => ({ ...g, items: g.items.filter(it => PORTFOLIO_PAGES.has(it.id)) })).filter(g => g.items.length);
}

// ACCESS-3: may this person export? true for an admin without asking; for
// anyone else, false until GET /me says yes, so the button never flashes.
export function useCanExport(role) {
  const [on, setOn] = useState(role === "admin");
  useEffect(() => {
    if (role === "admin") { setOn(true); return undefined; }
    let live = true;
    loadMe().then(m => { if (live) setOn(!!m.canExport); });
    return () => { live = false; };
  }, [role]);
  return on;
}
