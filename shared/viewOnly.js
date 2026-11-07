// ACCESS-1 · THE VIEWER (read only). One file for the rule, read by the server
// (auth.js, the one door every signed-in request passes) and by the app (the
// guard in client/src/api.js and the buttons), so the two never disagree.
//
// A viewer sees every page their org's staff can see, except Settings → Team,
// billing and connections. They change nothing. Writes are refused by
// method, not by a list of write routes: any request that is not a GET, HEAD
// or OPTIONS is refused unless it is named below, so a write route added
// tomorrow is refused tomorrow with nobody remembering to add it.

export const VIEWER = "viewer";
export const VIEW_ONLY_ERROR = "view_only";
export const VIEW_ONLY_TIP = "View-only access";
export const VIEW_ONLY_SENTENCE =
  "You have view-only access, so this can't be changed from your account. An admin can change your role in Settings → Team.";
export const VIEWER_HIDDEN_SENTENCE =
  "Team, billing and connections are for staff and admins. A viewer can see every other page.";
export const VIEWER_EXPORT_OFF_SENTENCE =
  "Your organization has turned off exports for view-only accounts. An admin can turn them back on in Settings → Team.";
export const VIEWER_ATLAS_SENTENCE =
  "You have view-only access, so I answer questions but don't log, draft or change anything.";

// The roles a person can hold in an org, in the order the picker shows them.
export const ROLES = ["staff", "viewer", "volunteer_coordinator", "admin"];
export const ROLE_LABEL = {
  staff: "Staff, can view and edit data",
  viewer: "Viewer (read only)",
  volunteer_coordinator: "Volunteer coordinator, volunteers and hours only",
  admin: "Admin, full access including settings",
};
export function roleWord(role) {
  if (role === "volunteer_coordinator") return "volunteer coordinator";
  if (role === VIEWER) return "viewer (read only)";
  return String(role || "staff");
}

// What a viewer may still POST: their own account and session, and the
// questions that are asked with a POST but change nothing (Ask, Why, the help
// assistant, a report run, Atlas's question). Nothing here writes org data.
const MAY_POST_EXACT = new Set([
  "/auth/logout",
  "/auth/switch-org",
  "/auth/invite/accept",   // joining another org, where her role is that org's
  "/ask", "/ask/preview", "/why/ask", "/help/ask",
  "/report-builder/run",
  "/atlas",
  "/donors/list-layout",   // her own columns on People, kept per person like the nav layout
]);
const MAY_POST_PATTERNS = [
  /^\/me\/(password|profile|notification-prefs|home-layout|nav-layout|mfa(\/[a-z-]+)?|sessions\/[^/]+\/sign-out|sessions\/sign-out-others)$/,
  /^\/atlas\/[^/]+\/answer$/,   // her answer to Atlas's question; the steps it runs are read-only for a viewer
];

// What a viewer may not even read: Team, billing and connections.
const HIDDEN_EXACT = new Set(["/org/team", "/org/invites", "/users"]);
const HIDDEN_SEGMENTS = new Set([
  "billing", "connections", "api-keys", "webhooks", "oauth", "bookkeeping", "email-marketing",
  "pos", "giving-sources", "stripe", "qbo", "xero",
]);
const HIDDEN_ALLOWED = new Set([
  "/billing/status",   // the app's chrome reads the plan on every page; it carries no card and no invoice
]);

function cleanPath(path) {
  return String(path || "").split("?")[0].replace(/\/+$/, "") || "/";
}

export function isWriteMethod(method) {
  const m = String(method || "GET").toUpperCase();
  return !(m === "GET" || m === "HEAD" || m === "OPTIONS");
}

export function viewerMayWrite(path) {
  const p = cleanPath(path);
  return MAY_POST_EXACT.has(p) || MAY_POST_PATTERNS.some(re => re.test(p));
}

export function viewerHidden(path) {
  const p = cleanPath(path);
  if (HIDDEN_ALLOWED.has(p)) return false;
  if (HIDDEN_EXACT.has(p) || /^\/org\/(users|invites)\//.test(p) || /^\/users\//.test(p)) return true;
  const first = p.split("/")[1] || "";
  return HIDDEN_SEGMENTS.has(first);
}

// An export is a download of rows: a path with an "export" segment or a .csv.
export function isExportPath(path) {
  const p = cleanPath(path);
  return /(^|\/)[a-z-]*export[a-z-]*(\/|$)/i.test(p) || /\.csv$/i.test(p);
}

// The one decision. Returns null (go on) or { status, body }.
// `exportsOff` is the org's setting (orgs.viewer_exports_off), read only when
// the path is an export.
export function viewerRefusal(method, path, { exportsOff = false } = {}) {
  if (viewerHidden(path)) {
    return { status: 403, body: { error: VIEW_ONLY_ERROR, scope: "hidden", message: VIEWER_HIDDEN_SENTENCE } };
  }
  if (isWriteMethod(method)) {
    if (viewerMayWrite(path)) return null;
    return { status: 403, body: { error: VIEW_ONLY_ERROR, message: VIEW_ONLY_SENTENCE } };
  }
  if (exportsOff && isExportPath(path)) {
    return { status: 403, body: { error: VIEW_ONLY_ERROR, scope: "export", message: VIEWER_EXPORT_OFF_SENTENCE } };
  }
  return null;
}

// Atlas: the kinds of step that only read. Everything else is refused for a viewer.
export const ATLAS_READ_KINDS = new Set(["question", "find", "about"]);
