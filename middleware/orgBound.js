// middleware/orgBound.js · HARDEN-1 item 1. A WRITE LANDS IN THE ORG THE PAGE WAS SHOWING.
//
// The session lives in one place in the browser (localStorage `npe_token`),
// shared by every tab. Signing in to a second org in one tab moved every
// other tab with it, silently: a page still painted for Steward LLC sent its
// next write with the new org's token, and on 27 Oct an import previewed in
// Steward LLC committed 656 people into CREO Arts (Demo).
//
// So the SPA names the org each page was rendered for on every write
// (`X-Steward-Org`, set once in client/src/api.js), and this seam, mounted
// beside the audit write and above every router, refuses a write whose page
// org is not the session's org: 409 `org_changed`, one sentence with both
// names, and nothing written. A route added tomorrow is covered without its
// author doing anything.
//
// WHAT PASSES WITHOUT A CHECK, on purpose:
//   - a request with no header: API keys, webhooks, public pages (/give, the
//     portal), an old client mid-deploy. They name no page, so there is no
//     page to disagree with. The SPA always sends it.
//   - a token that does not verify (an API key in the Bearer slot, an expired
//     session): requireAuth, or requireApiKey, says no on its own terms.
//   - signing out: a stale tab may always end the session it holds.
// FLOWS-20 (W-1120-Fundraising-13): a READ is bound too. GET and HEAD change nothing, but a tab
// still painted for one org read another's: Harborlight's Verity Underhill, opened just before a
// sign-in to org_stagewalk in the same browser, showed "By year could not be read: Donor not
// found" and "Could not load fund data" (staging, 20 Nov 05:19 UTC, every read on her tabs 404).
// A read whose page org is not the session's is answered 409 org_changed, the same sentence, so
// the tab says "reload" instead of another org's "not found". The tab's own way to learn its org
// (/me, /me/orgs) and the auth paths pass.

const ORG_HEADER = "x-steward-org";
const EXEMPT_PATHS = new Set(["/auth/logout", "/auth/login", "/auth/switch-org"]);   // ACCESS-1: a switch is the deliberate change of org
const READ_EXEMPT = /^\/(me|me\/orgs|health|auth\/.*|support-session\/.*)$/;   // FLOWS-20: how a tab learns where it is

function orgChangedSentence(pageName, nowName) {
  return `This page was for ${pageName || "another organization"}, but you're now in ${nowName || "another organization"}. Reload to continue.`;
}

async function orgNames(ids) {
  const { query } = require("../db");
  const rows = await query("SELECT id, name FROM orgs WHERE id = ANY(?)", [ids.filter(Boolean)]);
  return new Map(rows.map(r => [r.id, r.name]));
}

// The refusal for a page bound to `pageOrgId` while the session is in
// `sessionOrgId`, or null when they agree (or the page named none). Used by
// the seam below and by the import commit, whose preview carries its org.
async function orgChangedRefusal(pageOrgId, sessionOrgId) {
  const page = String(pageOrgId || "").trim();
  if (!page || !sessionOrgId || page === String(sessionOrgId)) return null;
  const names = await orgNames([page, String(sessionOrgId)]).catch(() => new Map());
  return {
    status: 409,
    body: { error: "org_changed", code: "org_changed", pageOrgId: page, sessionOrgId: String(sessionOrgId),
            message: orgChangedSentence(names.get(page), names.get(String(sessionOrgId))) },
  };
}

function orgBound() {
  return async (req, res, next) => {
    try {
      if (req.method === "OPTIONS") return next();
      const page = req.headers[ORG_HEADER];
      if (!page || EXEMPT_PATHS.has(req.path)) return next();
      const read = req.method === "GET" || req.method === "HEAD";
      if (read && READ_EXEMPT.test(req.path)) return next();
      const sessionOrg = await require("../auth").sessionOrgOf(req);
      if (!sessionOrg) return next();
      const refusal = await orgChangedRefusal(page, sessionOrg);
      if (!refusal) return next();
      // nothing was written, so there is nothing for the audit log to say
      if (!read && req.audit) req.audit.skip("org_changed");
      return res.status(refusal.status).json(refusal.body);
    } catch (e) { next(e); }
  };
}

module.exports = { orgBound, orgChangedRefusal, orgChangedSentence, ORG_HEADER };
