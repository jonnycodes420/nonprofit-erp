// FIX-13 Part 6 — REAL LINKS. Every tab and record has a URL, so a donor, a
// list or a report can be opened in its own browser tab (Cmd/Ctrl-click,
// middle-click, "Open in new tab") and come back exactly as it was.
//
// Home is /dashboard, Donors is /donors and a donor is /donors/:id (the D-1
// path, unchanged). Every other tab is /app/:tab, because several tab ids
// (agent, connections) are also marketing pages at the root. The intent a
// tab opens with (a report, a grant, a settings section) rides the query.
// This module is the one place a path is built AND read, so the two cannot
// drift. JSX-free, so the sidebar, App and any list can import it.

// opts key  <->  query key, for the tabs whose intent is a single value.
const QUERY_KEYS = [
  ["frSection", "fr"], ["report", "report"], ["savedReport", "saved"],
  ["section", "section"], ["focus", "focus"], ["grantId", "grant"],
  ["grantsSection", "gsection"], ["journeyId", "journey"],
  ["agentView", "view"], ["scope", "scope"], ["subtab", "subtab"],
  ["highlightDraftId", "draft"], ["preset", "preset"], ["from", "from"],
  ["to", "to"], ["yearMode", "year"],
];

export function donorHref(id) {
  return "/donors/" + encodeURIComponent(id);
}

// The donor list's own state: search, filters and the selected view. The
// same names are read back by Donors.jsx on mount (donorsListState below).
export const DONOR_LIST_KEYS = [
  ["view", "view"], ["search", "q"], ["stage", "stage"], ["owner", "owner"],
  ["designation", "designation"], ["noMeeting", "nomeeting"],
  ["nmOwner", "nm_owner"], ["nmMin", "nm_min"],
];

export function donorsListHref(state) {
  const qs = new URLSearchParams();
  for (const [k, q] of DONOR_LIST_KEYS) {
    const v = state && state[k];
    if (v === true) qs.set(q, "1");
    else if (v != null && v !== "" && v !== false && !(k === "view" && v === "directory")) qs.set(q, String(v));
  }
  const s = qs.toString();
  return "/donors" + (s ? "?" + s : "");
}

export function donorsListState(search) {
  const qs = new URLSearchParams(search || "");
  const out = {};
  for (const [k, q] of DONOR_LIST_KEYS) {
    if (!qs.has(q)) continue;
    out[k] = k === "noMeeting" ? qs.get(q) === "1" : qs.get(q);
  }
  return out;
}

export function tabHref(tab, opts) {
  const o = opts || {};
  if (tab === "dashboard") return "/dashboard";
  if (tab === "donors") {
    if (o.selectDonorId) return donorHref(o.selectDonorId) + (o.openConversation ? "?conversation=1" : "");
    return donorsListHref({ view: o.view, stage: o.stageFilter });
  }
  const qs = new URLSearchParams();
  for (const [k, q] of QUERY_KEYS) if (o[k] != null && o[k] !== "") qs.set(q, String(o[k]));
  const s = qs.toString();
  return "/app/" + encodeURIComponent(tab) + (s ? "?" + s : "");
}

// The inverse: a location -> { tab, opts }, or null when the path is not an
// app path. Old links (/dashboard?report=, ?fr=, ?tab=settings&sub=) keep
// working and are reported as `legacy` so App can replace them.
export function parseAppUrl(pathname, search, hash) {
  const qs = new URLSearchParams(search || "");
  // FIX-13 Part 5: a #anchor (?sub=integrations#api) rides along as the
  // Settings focus, so the one Connections page opens on that card.
  const anchor = decodeURIComponent((hash || "").replace(/^#/, "")) || null;
  const path = (pathname || "").replace(/\/+$/, "") || "/";
  const donor = path.match(/^\/donors\/([^/]+)$/);
  if (donor) {
    const opts = { selectDonorId: decodeURIComponent(donor[1]) };
    if (qs.get("conversation") === "1") opts.openConversation = true;
    return { tab: "donors", opts };
  }
  if (path === "/donors") {
    const st = donorsListState(search);
    return { tab: "donors", opts: { view: st.view, stageFilter: st.stage } };
  }
  const tabMatch = path.match(/^\/app\/([^/]+)$/);
  if (tabMatch) {
    const opts = {};
    for (const [k, q] of QUERY_KEYS) if (qs.get(q) != null) opts[k] = qs.get(q);
    if (anchor && opts.focus == null) opts.focus = anchor;
    return { tab: decodeURIComponent(tabMatch[1]), opts };
  }
  if (path === "/dashboard") {
    if (qs.get("report")) return { tab: "reports", opts: { savedReport: qs.get("report") }, legacy: true };
    if (qs.get("fr")) return qs.get("fr") === "pipeline"
      ? { tab: "pipeline", opts: {}, legacy: true }
      : { tab: "fundraising", opts: { frSection: qs.get("fr") }, legacy: true };
    if (qs.get("tab") === "settings") return { tab: "settings", opts: { section: qs.get("sub") || "connections", focus: anchor || qs.get("focus") || null }, legacy: true };
    return { tab: "dashboard", opts: {} };
  }
  return null;
}

// Only a plain left click with no modifier is the app's to handle. Anything
// else (Cmd, Ctrl, Shift, Alt, the middle button) belongs to the browser.
export function isPlainLeftClick(e) {
  return !!e && (e.button === 0 || e.button == null) && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

// A whole-row click handler for rows whose name carries the real link: a
// plain click opens in place, Cmd/Ctrl/Shift-click opens the same URL in a
// new tab or window, so the row and its link never disagree.
export function rowClick(href, open) {
  return (e) => {
    if (!isPlainLeftClick(e)) {
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); window.open(href, "_blank", "noopener"); }
      return;
    }
    open(e);
  };
}

// A same-origin path only: the sign-in page's ?next= can never send anyone
// to another site.
export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/^\/(login|signup|welcome)\b/.test(next)) return null;
  // Rebuilt from a parsed URL on this origin, so only a path ever leaves.
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch { return null; }
}
