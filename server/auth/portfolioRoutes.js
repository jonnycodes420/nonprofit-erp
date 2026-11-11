// server/auth/portfolioRoutes.js · ACCESS-2. WHAT A PORTFOLIO USER MAY REACH.
//
// Every route behind sign-in is DECLARED here, for a user who sees only the
// people assigned to them (server/auth/portfolio.js). First match wins:
//
//   free    carries no person: their own account, the org's chrome, settings
//           the app reads. Opened as is.
//   param   names one person, or a record hanging off one, in its path. The
//           gate checks every parameter (and a write's body) before the
//           handler runs; the handler is unchanged.
//   scoped  a list, a count, a search or an export of people. The HANDLER adds
//           visiblePeople (portfolio.visibleSql); the gate still checks any
//           person the request names.
//   closed  not open to a portfolio user: 404, as if it weren't there.
//
// A route that matches nothing is closed at run time, and
// tests/access2-portfolio.test.js fails on it in CI: a new person-linked route
// cannot ship without someone deciding which of the four it is.
//
// Patterns are the route's Express path. A string is that exact path; a
// RegExp is tested against it. `params` names what a path parameter is when
// the path alone doesn't say (null = names no person).
"use strict";

const ANY = "*";
const D = (method, pattern, cls, opts = {}) => ({ method, pattern, cls, ...opts });

// What a parameter names, read from its name or from the segment before it.
const NAMED_PARAMS = { donorId: "donor", personId: "donor", giftId: "gift", householdId: "household" };
const SEGMENT_KIND = {
  donors: "donor", people: "donor", gifts: "gift", interactions: "interaction", pledges: "pledge",
  tasks: "task", households: "household", "donor-relationships": "relationship", threads: "thread",
  drift: "donor",
};

const DECLARATIONS = [
  // ── FREE: their own account, the session, the app's chrome ──────────────
  D(ANY, /^\/me(\/|$)/, "free", { params: { id: null } }),
  D(ANY, /^\/auth\/(logout|switch-org|invite\/accept)$/, "free"),
  D("GET", /^\/org(\/(welcome|vocabulary|ai-status|team|sample-data-status|membership-settings))?$/, "free"),   // ACCESS-2B: not setup-status, the admin's checklist
  D("POST", "/org/welcome/seen", "free"),
  D("GET", "/billing/status", "free"),
  D(ANY, /^\/onboarding\/(mine|home-opened)$/, "free"),
  D(ANY, /^\/(help|support)\//, "free"),
  D("GET", /^\/(custom-fields|settings\/giving-levels|mail-types|why\/questions|atlas\/status|changes\/marks)$/, "free"),
  D("GET", "/people/photos", "free"),
  // Home's and the shell's reads in one request: each part is its own route,
  // run as them, so each part meets this gate itself (routes/homeBundle.js).
  D("GET", "/home/bundle", "free"),
  // ACCESS-2B: the page-timing beacon (a page name and milliseconds), and the
  // AI stream, whose prompt the browser writes from what it already shows them;
  // neither reads a person on the server.
  D("POST", /^\/(perf\/page-ready|ai\/stream)$/, "free"),
  D(ANY, /^\/donors\/list-(setup|layout|views)(\/:id)?$/, "free", { params: { id: null } }),
  D(ANY, /^\/touch-types(\/:id)?$/, "free", { params: { id: null } }),   // TOUCH-1: the kinds of touch (no person; adding one is an admin's)
  D("PATCH", "/donors/:id/care-plan/touches/:taskId", "param", { params: { kind: null, taskId: "task" } }),   // TOUCH-1: a planned touch is a task on their person

  // ── SCOPED: lists, counts, search, export of people ─────────────────────
  D("GET", /^\/donors(\/(ids|pick|lookup|counts|stage-counts|summaries|export\/csv))?$/, "scoped"),
  D("GET", "/search", "scoped"),
  D("GET", /^\/tasks(\/counts)?$/, "scoped"),
  D("GET", /^\/top100(\/export\.csv)?$/, "scoped"),
  D("GET", "/donors/birthdays-near", "scoped"),   // ACCESS-2B: Home's birthdays, their people's
  // ACCESS-2B: the Thread, their people's follow-ups only (composeThreads' visible).
  D("GET", "/threads", "scoped"),
  D("GET", "/home/portfolio", "scoped"),   // ACCESS-3: Home's "Your portfolio" card, their people only
  D("POST", "/threads/plan", "param"),
  // Creating a person makes them the creator's own (server/donors/routes.js).
  D("POST", /^\/donors$|^\/gifts\/new-person$/, "scoped"),
  D("POST", "/tasks", "scoped"),
  D(ANY, /^\/donors\/bulk-(tag|stage)$/, "param", { ids: "donor" }),
  D("POST", "/tasks/bulk", "param", { ids: "task" }),
  // Atlas reads only their people (server/atlas portfolio filter).
  D(ANY, /^\/atlas(\/|$)/, "scoped", { params: { id: null, key: null } }),

  // ── CLOSED inside the person's routes: someone else's mail, merges, ─────
  // imports, wealth and the owner (an admin's job).
  D(ANY, /^\/donors\/:id\/(blocked-mail|emails-received|auto-email|wealth-score|room-to-give|screening|public-filing|prospect-brief|export-data|erase|refused-rows|assign|archive|unarchive)/, "closed"),
  D(ANY, /^\/donors\/(merge|import|import-semantics|import-combined|bulk-assign|bulk-delete|bulk-wealth-score|duplicates|trash-check|purge-trash|auto-email|custom-field-values)/, "closed"),

  // ── PARAM: one person, and what hangs off them ──────────────────────────
  D(ANY, /^\/donors\/:id(\/|$)/, "param", { params: { kind: null } }),
  D(ANY, /^\/people\/:id(\/|$)/, "param"),
  D(ANY, /^\/(gifts|interactions|pledges|tasks|households|donor-relationships|threads)\/:id(\/|$)/, "param"),
  D("POST", "/households", "param"),
];

// Every other surface is closed to a portfolio user in this build, named by
// its first segment so a route added under one is declared by it. Reports,
// dashboards, Fundraising and Finance, Calendar, Groups and campaigns, events,
// mail and imports read the whole org; each opens here once its handler reads
// visiblePeople (docs/history/ACCESS-2.md lists them).
const CLOSED_SEGMENTS = new Set(`
  acknowledgments admin after-change-log ai annual-fund api-keys ask assets audiences audit auction-items
  auction-refund-flags auctions auth auto-send billing board board-pack bookkeeping brand-kit briefs calendar
  campaign-templates campaigns capture care-templates changes communications connections cultivation-templates
  custom-fields dashboard dashboard-tiles dashboards data-health deleted-records deposits digests donor-relationships
  donors drafts drift email email-marketing email-preview email-templates emails event-choices event-levels events
  figures financials finance fundraising funders geocode gift-attribution gift-starts gifts giving-page-templates
  giving-pages giving-recurring giving-sources give-settings gmail goals going-out grant-funders grant-library
  grant-outlines grant-overview grant-reports grant-sends grants groups help history-import home households
  impact impact-metrics impact-updates import-field-mappings import-mappings import-merges import-shapes
  import-values imports insights interactions journey-sends journeys mail-types mailbox major-gifts matching-employers
  materials me media meetings membership-levels memberships metrics milestone-drafts move network note-reminders
  nudges oauth offline-plans old-reports onboard onboarding opportunities org org-form org-summary orgs p2p-teams
  peer-fundraisers people perf photos pictures pipeline plan-steps planned-gifts plans pledges portal-audit
  portal-engagement portal-page portal-settings portfolio pos privacy programs proposals prospects qbo readout-kinds
  readouts receipts recent-changes records recurring removals report-builder reports saved-dashboards saved-reports
  scores screening search sequences settings setup sheet-import sheets statement-mappings step-reminders stock-photos
  stripe support support-access support-session surveys surveys-volunteer-followup tasks templates threads thank-yous
  top100 trash tribute-notices users voice voice-memos volunteer-hours volunteer-qualifications volunteer-shifts
  volunteers volunteer-hub webhooks why workflows xero agent api plan-steps
`.split(/\s+/).filter(Boolean));

function matches(d, method, path) {
  if (d.method !== ANY && d.method !== method) return false;
  return typeof d.pattern === "string" ? d.pattern === path : d.pattern.test(path);
}

// The declaration for one route, or null when it has none at all.
function declarationFor(method, routePath) {
  const m = String(method || "").toUpperCase(), p = String(routePath || "");
  for (const d of DECLARATIONS) if (matches(d, m === "HEAD" ? "GET" : m, p)) return d;
  const first = p.split("/")[1] || "";
  if (CLOSED_SEGMENTS.has(first)) return { method: ANY, pattern: "segment:" + first, cls: "closed" };
  return null;
}

// What a path parameter names: a kind (donor, gift…), null (no person), or
// undefined (nobody said, and the gate refuses).
function paramKind(routePath, name, decl) {
  if (decl && decl.params && Object.prototype.hasOwnProperty.call(decl.params, name)) return decl.params[name];
  if (NAMED_PARAMS[name]) return NAMED_PARAMS[name];
  const segs = String(routePath || "").split("/");
  const i = segs.indexOf(":" + name);
  if (name === "id" && i > 0 && SEGMENT_KIND[segs[i - 1]]) return SEGMENT_KIND[segs[i - 1]];
  return undefined;
}

// An export: off for the Campaign cabinet preset (can_export false).
function isExport(method, routePath) {
  return /export|\.csv$|\/csv$|\/pdf$/.test(String(routePath || ""));
}

module.exports = { DECLARATIONS, CLOSED_SEGMENTS, declarationFor, paramKind, isExport };
