// client/src/lib/portfolioRoutes.js · ACCESS-2B. THE APP ASKS A PORTFOLIO USER'S
// OPEN ROUTES AND NOTHING ELSE.
//
// Someone who sees only the people assigned to them has most of Steward
// closed (server/auth/portfolioRoutes.js). The server sends the routes open to
// them (GET /me/portfolio-routes, built from the live router and the same
// declarations the gate reads), and every request leaves through api.js
// apiFetchNow, which asks here first: a closed one is answered in the browser,
// as the server would (a 404 marked scope "portfolio"), and never sent. A
// bundle's closed parts are taken out before it leaves. The server is still
// the guard; this keeps the network and the console clean.
//
// The flag: the sign-in answer's user.portfolio, kept in step by the
// X-Steward-Portfolio header on every answer.
const FLAG_HEADER = "x-steward-portfolio";
const BUNDLES = /^\/(home\/bundle|donors\/[^/?]+\/bundle)\?/;

function storedUser() {
  try { return JSON.parse(localStorage.getItem("npe_user") || "null"); } catch { return null; }
}
export function isPortfolioUser() {
  const u = storedUser();
  return !!(u && u.portfolio === true);
}

let list = null, listFor = null;
function openList(api, token) {
  if (listFor !== token) { list = null; listFor = token; }
  if (!list) {
    list = fetch(`${api}/me/portfolio-routes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(b => (b && Array.isArray(b.open) ? b.open.map(([m, re, on]) => [m, new RegExp(re), on !== false]) : null))
      .catch(() => null);
    list.then(l => { if (!l) list = null; });   // a failed read is asked again next time
  }
  return list;
}

const bare = p => String(p).split("?")[0].split("#")[0];
// The FIRST route that matches decides, as in Express: /donors/birthdays-near
// is its own route, not /donors/:id. No route at all: not open.
const isOpen = (open, method, path) => { const hit = open.find(([m, re]) => m === method && re.test(bare(path))); return !!(hit && hit[2]); };
const closed = (method, path) => Object.assign(new Error("This isn't part of what you see in Steward."),
  { status: 404, error: "not_found", scope: "portfolio", local: true, path, method });

// Before a request leaves: { refuse } to answer it here, { path } to send
// (a bundle with its closed parts taken out), or null to send as it is.
export async function portfolioBefore(method, path, api, token) {
  if (!token || !isPortfolioUser() || bare(path) === "/me/portfolio-routes") return null;
  const open = await openList(api, token);
  if (!open) return null;   // the list could not be read: the server's gate still answers
  if (!isOpen(open, method, path)) return { refuse: closed(method, path) };
  if (method === "GET" && BUNDLES.test(path)) {
    const [head, query] = path.split("?");
    const parts = new URLSearchParams(query);
    const kept = parts.getAll("p").filter(p => isOpen(open, "GET", p));
    if (!kept.length) return { empty: true };
    const out = new URLSearchParams();
    for (const [k, v] of parts) if (k !== "p") out.append(k, v);
    for (const p of kept) out.append("p", p);
    return { path: head + "?" + out.toString() };
  }
  return null;
}

// After an answer: the flag as the server says it is now.
export function portfolioAfter(res) {
  const h = res && res.headers && res.headers.get(FLAG_HEADER);
  if (h !== "1" && h !== "0") return;
  const u = storedUser();
  if (!u || (u.portfolio === true) === (h === "1")) return;
  try { localStorage.setItem("npe_user", JSON.stringify({ ...u, portfolio: h === "1" })); } catch { /* private mode */ }
  list = null;
}
