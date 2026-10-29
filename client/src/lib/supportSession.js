// lib/supportSession.js · FIX-57. OPEN AS SUPPORT, AND COMING BACK.
//
// A super-admin's own session is kept aside while a support session is open,
// and put back when it ends (or when the server says it has ended: the org
// turned support access off, or two hours passed). The server is the guard
// (requireAuth refuses every change from a read-only support session); this
// file only moves tokens.
const RETURN_KEY = "npe_support_return";

function setSession(s) {
  localStorage.setItem("npe_token", s.token);
  localStorage.setItem("npe_user", JSON.stringify(s.user));
  localStorage.setItem("npe_org", JSON.stringify(s.org));
}

// Called with the answer of POST /admin/orgs/:id/support/open.
export function enterSupport(open) {
  try {
    const back = {
      token: localStorage.getItem("npe_token"),
      user: JSON.parse(localStorage.getItem("npe_user") || "null"),
      org: JSON.parse(localStorage.getItem("npe_org") || "null"),
    };
    localStorage.setItem(RETURN_KEY, JSON.stringify(back));
  } catch { /* the console is one sign-in away */ }
  setSession({ token: open.token, user: open.user, org: { ...open.org, onboarding_complete: open.org.onboarding_complete ?? 1 } });
  window.location.href = "/dashboard";
}

export function inSupport() {
  try { return !!(JSON.parse(localStorage.getItem("npe_user") || "{}") || {}).support; } catch { return false; }
}

// Puts the super-admin's own session back and goes to the console. True when
// there was one to put back.
export function leaveSupport() {
  let back = null;
  try { back = JSON.parse(localStorage.getItem(RETURN_KEY) || "null"); } catch { back = null; }
  localStorage.removeItem(RETURN_KEY);
  if (!back || !back.token) return false;
  setSession(back);
  window.location.href = "/admin";
  return true;
}
