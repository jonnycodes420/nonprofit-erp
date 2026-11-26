// server/auth/tabOrg.js · FRESH-3 item 4. ONE BROWSER TAB'S ORG NEVER CHANGES ANOTHER'S.
//
// The session token lives in localStorage, which every Steward tab in a browser
// shares. POST /auth/switch-org in tab B issues a new session in the new org and
// signs the old one out, so tab A, still painted for the org it was opened in,
// sent its next request with tab B's token. HARDEN-1 and FLOWS-20 made that
// request refuse (409 org_changed) instead of writing into the wrong org; the
// fleet still lost 25 minutes on 26 Nov to a profile flipping between two orgs.
//
// A tab names the org it was rendered for (X-Steward-Org) and the person it was
// rendered for (X-Steward-User). When that person is the token's own person and
// is a live member of the tab's org (home org or org_memberships, read now, as
// requireAuth reads a switched session), the request runs in the TAB's org with
// that org's role. So the switch takes effect in the tab that asked, and every
// other tab keeps working where it was.
//
// What it never does:
//   - cross people: another person's sign-in in tab B is a different user, so
//     tab A still gets 409 org_changed and its banner (middleware/orgBound.js);
//   - reach an org she isn't in: no live membership, no change (and the 409);
//   - touch a support session (it is in the org it was opened for, FIX-57) or a
//     setup-only session (two-step sign-in not yet set up);
//   - apply without the user header: an older client, an API key or a webhook
//     names no tab, so it is answered exactly as before.
// switchOrg.js's audit and support-access rules are unchanged.
"use strict";

const ORG_HEADER = "x-steward-org";
const USER_HEADER = "x-steward-user";

// { orgId, role } for the tab's org, or null to keep the token's org.
// `payload` is the verified token, `info` the user's live row (requireAuth's).
async function tabOrgFor(req, payload, info, tokenOrgId) {
  const page = String((req.headers && req.headers[ORG_HEADER]) || "").trim();
  const who = String((req.headers && req.headers[USER_HEADER]) || "").trim();
  if (!page || !who || !payload || !info) return null;
  if (payload.supportSid || payload.mfaSetup) return null;
  if (who !== String(payload.userId)) return null;
  if (page === String(tokenOrgId)) return null;
  if (String(info.org_id) === page) return { orgId: info.org_id, role: info.role };
  const m = await require("./access").membershipFor(payload.userId, page);
  return m ? { orgId: m.org_id, role: m.role } : null;
}

module.exports = { tabOrgFor, ORG_HEADER, USER_HEADER };
