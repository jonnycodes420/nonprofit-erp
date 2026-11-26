// client/src/lib/orgBinding.js · HARDEN-1 item 1. EACH TAB IS BOUND TO THE ORG IT WAS RENDERED FOR.
//
// The session token lives in localStorage, which every Steward tab shares.
// Signing in to another org in one tab used to move every tab with it,
// silently: a page still painted for Steward LLC sent its next write with the
// new org's token (on 27 Oct an import committed into CREO Arts (Demo)).
//
// Three rules, one file:
//   1. The page's org is fixed per tab: what this tab's AuthProvider holds,
//      set at render and at a sign-in IN THIS TAB. Another tab never moves it.
//   2. Every authenticated call to the API carries it (`X-Steward-Org`). The
//      server refuses a write, or a read (FLOWS-20), whose page org is not the
//      session's (409 org_changed, middleware/orgBound.js). The header is added in one place,
//      a wrapper on fetch, so apiFetch and every hand-rolled fetch that sends
//      the bearer token are covered alike.
//   3. Tabs tell each other. A sign-in announces its org on a BroadcastChannel
//      (the `storage` event on npe_org is the fallback); any other tab bound to
//      a different org shows a banner and refuses writes until reloaded.
//   4. FRESH-3 item 4: a tab also names its person (`X-Steward-User`). When the
//      other tab's change was the SAME person switching org, this tab may stay:
//      the server runs its requests in this tab's org while she is a member
//      there (server/auth/tabOrg.js), so nobody is signed out and nothing moves.

const CHANNEL = "steward-org";
const SEEN_KEY = "steward_orgs_seen";
const ORG_HEADER = "X-Steward-Org";
const USER_HEADER = "X-Steward-User";   // FRESH-3 item 4
const PASS_PATHS = ["/auth/logout", "/auth/login"];
const READ_PASS = /^\/(me|me\/orgs|health|auth\/.*|support-session\/.*)$/;   // FLOWS-20: how a tab learns its org

let pageOrg = null;      // { id, name } — the org this tab's page is for
let pageUser = null;     // FRESH-3: the person this tab's page is for (an id)
let changed = null;      // { message, canStay } once the tab knows it is out of date
let stayed = new Set();  // FRESH-3: orgs another tab moved to that this tab chose to stay out of
const listeners = new Set();
let channel = null;
let installed = false;

const notify = () => { for (const fn of listeners) { try { fn(changed); } catch { /* a listener's own bug */ } } };

export const pageOrgId = () => (pageOrg ? pageOrg.id : null);
export const pageOrgName = () => (pageOrg ? pageOrg.name : null);
export const orgChanged = () => changed;
export function subscribeOrgChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function markChanged(message, canStay = false) {
  if (changed && changed.message === message) return;
  changed = { message, canStay };
  notify();
}
// FRESH-3 item 4: "Stay here". The banner goes, writes go out again, and the
// server keeps answering in this tab's org (the person and the org ride on
// every request). If the server can't (she left that org), it says 409 again.
export function stayHere() {
  if (!changed || !changed.canStay) return;
  if (changed.orgId) stayed.add(changed.orgId);
  changed = null;
  notify();
}
export function reportOrgChanged(message) {
  markChanged(message || "This page was for another organization. Reload to continue.");
}

function rememberSeen(id) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    if (!seen.includes(id)) localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-20)));
  } catch { /* private window */ }
}
// More than one org has been signed in to from this browser: the top bar names
// the org then, so two tabs can be told apart at a glance.
export function orgsSeenCount() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]").length; } catch { return 0; }
}

// Bind this tab to `org`. `announce` is true for a sign-in in this tab: the
// other tabs hear it. A render or a refresh of the same org is not news.
export function setPageOrg(org, { announce = false, user = undefined } = {}) {
  const next = org && org.id ? { id: String(org.id), name: org.name || "" } : null;
  const moved = (next && next.id) !== (pageOrg && pageOrg.id);
  pageOrg = next;
  if (user !== undefined) pageUser = user && user.id ? String(user.id) : null;
  if (moved) stayed = new Set();
  if (next) rememberSeen(next.id);
  if (moved && changed) { changed = null; notify(); }
  if (announce && next && channel) { try { channel.postMessage({ orgId: next.id, orgName: next.name, userId: pageUser }); } catch { /* closed */ } }
}

// FRESH-3 item 4: the same person moved org in another tab: she may follow it or
// stay. Someone else signed in there: this tab's page is not theirs, so Reload.
export function switchedSentence(orgName) {
  return `You switched to ${orgName || "another organization"} in another tab. Reload to follow, or stay here.`;
}
function heard(orgId, orgName, userId) {
  if (!pageOrg || !orgId || String(orgId) === pageOrg.id) return;
  const same = !!pageUser && !!userId && String(userId) === pageUser;
  if (same && stayed.has(String(orgId))) return;
  if (same) { markChanged(switchedSentence(orgName), true); changed.orgId = String(orgId); return; }
  markChanged(`You switched to ${orgName || "another organization"} in another tab. Reload to see it.`);
}

function isApiWrite(url, method, apiBase) {
  if (method === "GET" || method === "HEAD") return false;
  return typeof url === "string" && !!apiBase && url.startsWith(apiBase);
}
function isApiCall(url, apiBase) {
  return typeof url === "string" && !!apiBase && url.startsWith(apiBase) && !url.startsWith(apiBase + "/api/migc");
}
function hasBearer(h) { return /^Bearer\s/i.test(h.get("Authorization") || ""); }

// Installed once, from main.jsx, before anything renders.
export function installOrgBinding(apiBase) {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.href : null);
    const method = String((init && init.method) || "GET").toUpperCase();
    // SECURE-3 Release A: every call to the API lets the browser keep and send
    // the httpOnly session cookie the server now sets beside the token. The
    // token (Bearer) still decides who is asking until Release B; the cookie
    // only starts to count once the API is first-party (api.stewardapp.dev).
    if (isApiCall(url, apiBase) && !(init && init.credentials)) init = { ...(init || {}), credentials: "include" };
    // FLOWS-20: a read names the page's org too (the server answers a stale tab 409 org_changed,
    // never another org's "not found"); only a write is refused here before it leaves.
    const write = isApiWrite(url, method, apiBase);
    if (!pageOrg || !(write || isApiCall(url, apiBase))) return realFetch(input, init);
    const headers = new Headers((init && init.headers) || {});
    if (!hasBearer(headers)) return realFetch(input, init);
    const path = url.slice(apiBase.length).split("?")[0];
    if (PASS_PATHS.includes(path)) return realFetch(input, init);
    // FRESH-3: how a tab learns where it is (/me) names the tab too, so a tab that stayed hears
    // its own org back, never the org another tab moved to. The server never refuses these.
    if (!write && READ_PASS.test(path)) {
      headers.set(ORG_HEADER, pageOrg.id);
      if (pageUser) headers.set(USER_HEADER, pageUser);
      return realFetch(input, { ...init, headers });
    }
    // This tab already knows the org moved: the write never leaves the browser.
    if (changed && write) {
      return new Response(JSON.stringify({ error: "org_changed", code: "org_changed", message: changed.message }),
        { status: 409, headers: { "Content-Type": "application/json" } });
    }
    if (!headers.has(ORG_HEADER)) headers.set(ORG_HEADER, pageOrg.id);
    if (pageUser && !headers.has(USER_HEADER)) headers.set(USER_HEADER, pageUser);
    const res = await realFetch(input, { ...init, headers });
    if (res.status === 409) {
      res.clone().json().then(b => { if (b && b.code === "org_changed") reportOrgChanged(b.message); }).catch(() => {});
    }
    return res;
  };
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = e => heard(e.data && e.data.orgId, e.data && e.data.orgName, e.data && e.data.userId);
  } catch { channel = null; }
  // The fallback, and the belt to the channel's braces: a sign-in elsewhere
  // rewrites npe_org, and every other tab hears the storage event.
  window.addEventListener("storage", e => {
    if (e.key !== "npe_org" || !e.newValue) return;
    let u = null;
    try { u = JSON.parse(localStorage.getItem("npe_user") || "null"); } catch { /* not ours */ }
    try { const o = JSON.parse(e.newValue); heard(o && o.id, o && o.name, u && u.id); } catch { /* not ours */ }
  });
}
