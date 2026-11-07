// lib/viewOnly.js · ACCESS-1. The viewer in the app.
//
// The server is the guard (auth.js refuses every write from a viewer). This
// file makes the app say so before she clicks: no write request leaves the
// browser (apiFetch asks `viewOnlyRefusal` first), and the buttons that would
// change something are disabled with the tooltip "View-only access".
//
// The rule is shared/viewOnly.js, the same file the server reads.
import { VIEWER, VIEW_ONLY_TIP, VIEW_ONLY_SENTENCE, VIEW_ONLY_ERROR, isWriteMethod, viewerMayWrite } from "../../../shared/viewOnly.js";

export { VIEWER, VIEW_ONLY_TIP };

export function currentRole() {
  try { return (JSON.parse(localStorage.getItem("npe_user") || "null") || {}).role || null; } catch { return null; }
}
export const isViewer = () => currentRole() === VIEWER;

// For apiFetch: an Error to throw instead of sending, or null.
export function viewOnlyRefusal(method, path) {
  if (!isViewer() || !isWriteMethod(method) || viewerMayWrite(path)) return null;
  return Object.assign(new Error(VIEW_ONLY_SENTENCE), { status: 403, error: VIEW_ONLY_ERROR, message: VIEW_ONLY_SENTENCE, viewOnly: true });
}
