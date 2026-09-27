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

// Where each report sits: the question it answers. The fifth group is the
// org's own saved reports, filled from the server, so it holds no fixed item.
export const RAIL_GROUPS = [
  { id: "stopped", question: "Who stopped giving?",
    items: ["lybunt", "sybunt", "std:lapsed-24", "retention", "std:monthly-givers"] },
  { id: "most", question: "Who gives the most?",
    items: ["top-donors", "three-year", "std:board-giving", "solicitations"] },
  { id: "year", question: "How did the year go?",
    items: ["giving-summary", "std:by-month", "by-group", "annual", "week-in-review", "std:first-time",
      "std:pledges-outstanding", "std:ack-backlog", "std:gifts-by-link-source", "bookkeeper",
      "std:grants-pipeline", "std:grants-by-funder", "std:grants-awarded-vs-requested",
      "std:grant-deadlines-90", "std:grant-restricted-balances"] },
  { id: "people", question: "Volunteers and members",
    items: ["std:volunteers-who-give", "std:members-by-level", "std:members-expiring", "std:members-lapsed",
      "std:members-new-renewed", "std:membership-revenue"] },
  { id: "saved", question: "Your saved reports", items: [] },
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
export function railGroups(tabDefs = [], standard = [], saved = []) {
  const tab = id => tabDefs.find(r => r.key === id);
  const name = id => (tab(id) || {}).label || (standard.find(s => s.id === id) || {}).name || null;
  return RAIL_GROUPS.map(g => ({
    ...g,
    items: g.id === "saved"
      ? saved.map(s => ({ id: s.id, label: s.name, sub: s.schedule === "weekly" ? "weekly" : (s.mine && !s.shared ? "just you" : null) }))
      : g.items.map(id => ({ id, label: name(id), team: !!(tab(id) || {}).team })).filter(i => i.label),
  }));
}

// The label of any report id, for a heading.
export function reportLabel(id, tabDefs = [], standard = [], saved = []) {
  return (tabDefs.find(r => r.key === id) || {}).label
    || (standard.find(s => s.id === id) || {}).name
    || (saved.find(s => s.id === id) || {}).name || null;
}
