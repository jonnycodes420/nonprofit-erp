// FIX-2 B — REPORTS, ONE WAY IN.
//
// Reports used to have two navigations: a tab row of eleven handler reports
// (which ran off the screen at 1440) and, under "Your reports", a left list of
// the standard reports that repeated half of them. This file is the ONE list.
// A left rail grouped by the question each report answers, with Build a
// report at the top; at phone width the same list becomes a <select>.
//
// Every id a report has ever arrived by still lands: the old tab ids, the
// standard ids ("std:<key>", from the weekly email and "Your reports"), a
// saved report's own id, and "saved" (the old "Your reports" tab). They all go
// through resolveReportId, which is what Reports.jsx calls for initialReport
// and initialSavedReport alike — so a Home chip, an Agent link and an email
// link are one mechanism.
//
// Pure: no JSX, no network. Names of the standard reports come from the
// server's /saved-reports list (shared/reportBuilder.js's STANDARD_REPORTS),
// so they are written once.

// The reports Reports.jsx renders itself, with their own controls (period
// chips, year, fiscal/calendar, group-by). Their labels live beside their
// controls in Reports.jsx (REPORT_DEFS); tests/fix2-b-reports.test.js holds
// the two lists equal.
export const TAB_IDS = ["giving-summary", "by-group", "lybunt", "sybunt", "retention", "top-donors",
  "week-in-review", "three-year", "annual", "solicitations", "bookkeeper"];

// A standard report that IS one of the reports above (the same handler, the
// same computation) is not listed twice: its id lands on the richer one.
// `params` are the controls the standard version fixes.
export const ALIASES = {
  "std:lybunt": { id: "lybunt" },
  "std:sybunt": { id: "sybunt" },
  "std:retention": { id: "retention" },
  "std:top-50": { id: "top-donors", params: { scope: "lifetime" } },
  "std:by-fund": { id: "by-group", params: { groupBy: "funds" } },
  // The old "Your reports" tab opened on LYBUNT.
  saved: { id: "lybunt" },
};

// Where each report sits. FIX-3 E (finding 12): the org's own saved reports on
// top; the money that came in and the grants each get a group of their own
// instead of hanging under the year. The names are the brief's, word for word.
// The saved group is filled from the server, so it holds no fixed item.
// NAV-1 §2 — DASHBOARDS IS THE FIRST THING IN REPORTS. It was its own nav
// item sharing the ▤ glyph with this one, and "Dashboards" and "Reports" are
// the same question asked twice. Its four screens are the first group of this
// rail, filled from the server's own /dashboards list exactly as the saved
// group is filled from /saved-reports — so the rail cannot drift from what
// exists. A dashboard id is prefixed `dash:`; Reports.jsx draws the Dashboards
// component for one instead of running a report.
export const DASH_PREFIX = "dash:";
export const isDashboard = id => String(id || "").startsWith(DASH_PREFIX);
export const dashKeyOf = id => isDashboard(id) ? String(id).slice(DASH_PREFIX.length) : null;

// REPORTS-3 — A DASHBOARD SHE SAVED sits in the same group as the four
// Steward ships, because it is the same kind of thing and the rail is the one
// way in: a second list of "my dashboards" beside the list of dashboards is
// exactly what FIX-2 B took out of Reports. Its ids are prefixed `sdash:`, the
// board pack and the new-dashboard screen are two more items in that group,
// and all four kinds resolve through resolveReportId like everything else.
export const SDASH_PREFIX = "sdash:";
export const isSavedDashboard = id => String(id || "").startsWith(SDASH_PREFIX);
export const savedDashIdOf = id => isSavedDashboard(id) ? String(id).slice(SDASH_PREFIX.length) : null;
export const BOARD_PACK_ID = "board-pack";
export const NEW_DASH_ID = "new-dashboard";
export const isDashboardGroupId = id =>
  isDashboard(id) || isSavedDashboard(id) || id === BOARD_PACK_ID || id === NEW_DASH_ID;

export const RAIL_GROUPS = [
  { id: "dashboards", question: "Dashboards", items: [] },
  { id: "saved", question: "Your saved reports", items: [] },
  { id: "stopped", question: "Who stopped giving",
    items: ["lybunt", "sybunt", "std:lapsed-24", "retention", "std:monthly-givers"] },
  { id: "most", question: "Who gives the most",
    items: ["top-donors", "three-year", "std:board-giving", "solicitations"] },
  { id: "year", question: "The year",
    items: ["giving-summary", "std:by-month", "by-group", "annual", "week-in-review", "std:first-time"] },
  { id: "money", question: "Money in",
    items: ["std:pledges-outstanding", "std:ack-backlog", "std:gifts-by-link-source", "bookkeeper"] },
  { id: "grants", question: "Grants",
    items: ["std:grants-pipeline", "std:grants-by-funder", "std:grants-awarded-vs-requested",
      "std:grant-deadlines-90", "std:grant-restricted-balances"] },
  { id: "people", question: "Volunteers and members",
    items: ["std:volunteers-who-give", "std:members-by-level", "std:members-expiring", "std:members-lapsed",
      "std:members-new-renewed", "std:membership-revenue"] },
];

export const DEFAULT_REPORT = "giving-summary";
export const BUILD_ID = "build";

const PLACED = new Set(RAIL_GROUPS.flatMap(g => g.items));

// id → { id, params?, saved? }. `saved` marks an org's own report (any id the
// rail does not hold and that is not an alias); an empty id is the default.
export function resolveReportId(raw) {
  const id = String(raw == null ? "" : raw).trim();
  if (!id) return { id: DEFAULT_REPORT };
  if (id === BUILD_ID) return { id: BUILD_ID };
  if (ALIASES[id]) return { ...ALIASES[id] };
  if (isDashboardGroupId(id)) return { id };
  if (PLACED.has(id)) return { id };
  if (id.startsWith("std:")) return { id: DEFAULT_REPORT };   // a standard report that no longer exists
  return { id, saved: true };
}

export const isTabReport = id => TAB_IDS.includes(id);

// The standard version of a tab report, when the screen's controls match what
// the standard fixes — its PDF is then the same rows as the screen.
export const PDF_TWIN = { lybunt: "std:lybunt", sybunt: "std:sybunt", retention: "std:retention", "top-donors": "std:top-50" };

// The rail's rows, with names: tab reports from `tabDefs` ({key,label,team}),
// standard reports by the server's name, saved reports from the org's list.
export function railGroups(tabDefs = [], standard = [], saved = [], dashboards = [], savedDashboards = []) {
  const tab = id => tabDefs.find(r => r.key === id);
  const name = id => (tab(id) || {}).label || (standard.find(s => s.id === id) || {}).name || null;
  return RAIL_GROUPS.map(g => ({
    ...g,
    items: g.id === "dashboards"
      ? [...dashboards.map(d => ({ id: DASH_PREFIX + d.key, label: d.label, sub: null })),
         ...savedDashboards.map(d => ({ id: SDASH_PREFIX + d.id, label: d.name,
           sub: d.mine && !d.shared ? "just you" : (d.shared && !d.mine ? d.ownerName || "shared" : null) })),
         { id: BOARD_PACK_ID, label: "Board pack", sub: null },
         { id: NEW_DASH_ID, label: "New dashboard", sub: null }]
      : g.id === "saved"
      ? saved.map(s => ({ id: s.id, label: s.name, sub: s.schedule === "weekly" ? "weekly" : (s.mine && !s.shared ? "just you" : null) }))
      : g.items.map(id => ({ id, label: name(id), team: !!(tab(id) || {}).team })).filter(i => i.label),
  })).filter(g => g.id !== "dashboards" || g.items.length > 0);
}

// The label of any report id, for a heading.
export function reportLabel(id, tabDefs = [], standard = [], saved = [], dashboards = [], savedDashboards = []) {
  if (id === BOARD_PACK_ID) return "Board pack";
  if (id === NEW_DASH_ID) return "New dashboard";
  if (isSavedDashboard(id)) return (savedDashboards.find(d => SDASH_PREFIX + d.id === id) || {}).name || null;
  if (isDashboard(id)) return (dashboards.find(d => DASH_PREFIX + d.key === id) || {}).label || null;
  return (tabDefs.find(r => r.key === id) || {}).label
    || (standard.find(s => s.id === id) || {}).name
    || (saved.find(s => s.id === id) || {}).name || null;
}

// The group a report id opens into: its rail item's group (through the
// resolver, so an alias opens its twin's group), "saved" for an org's own
// report, null for the builder.
export function groupOfReport(raw) {
  const r = resolveReportId(raw);
  if (r.id === BUILD_ID) return null;
  if (isDashboardGroupId(r.id)) return "dashboards";
  if (r.saved) return "saved";
  const g = RAIL_GROUPS.find(x => x.items.includes(r.id));
  return g ? g.id : null;
}

// The rail's search: reports whose name holds the text, any case, across every
// group. A group with no match drops out. An empty search is the whole rail.
export function filterRail(groups, text) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return groups;
  return groups
    .map(g => ({ ...g, items: g.items.filter(i => String(i.label || "").toLowerCase().includes(t)) }))
    .filter(g => g.items.length > 0);
}

// Which groups a viewer has folded, remembered per viewer in this browser.
export const COLLAPSE_KEY = "steward_reports_rail_collapsed";
export const collapseKey = userId => `${COLLAPSE_KEY}:${userId || "anon"}`;
