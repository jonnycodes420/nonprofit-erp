// client/src/lib/majorGiftsTab.js · ASKS-1 item 2. MAJOR GIFTS HAS ITS OWN PLACE.
//
// Allie (Justin's Place), 10 Nov, could not find Major Gifts: it was a part
// three levels down, Fundraising → Major gifts → Top 100. It is a rail entry
// now, under Raise between Fundraising and Events, for admins and staff with
// the major gifts permission (prospect.canSee, read live from GET /me), and it
// opens on four tabs, the same views as before: Top 100 · Portfolios ·
// Pipeline · Plans. Top 100 is where it opens.
//
// The Fundraising part ids that are these views (a bookmark on
// /app/fundraising?fr=top100, navigateTo("pipeline"), an older card) land here.
// Somebody without the permission who arrives here goes Home.
//
// JSX-free, so Node reads it (tests/asks1-three-asks.test.js).
export const MG_TAB = "majorgifts";
export const MG_VIEWS = [
  { id: "top100", label: "Top 100" },
  { id: "portfolios", label: "Portfolios" },
  { id: "pipeline", label: "Pipeline" },
  { id: "plans", label: "Plans" },
];
export const MG_DEFAULT = "top100";
const IDS = new Set(MG_VIEWS.map(v => v.id));

// The view a request names, or Top 100.
export function mgView(id) { return IDS.has(id) ? id : MG_DEFAULT; }

// A navigation, rewritten: an old Fundraising part that is one of these views
// (or the old `pipeline` tab) opens Major Gifts on it; Major Gifts itself is
// only for somebody who may see it (`can`: true, false, or null while unknown).
// Returns { tab, opts }.
export function routeMajorGifts(tab, opts, can) {
  let t = tab, o = opts || {};
  if (t === "pipeline") { t = MG_TAB; o = { ...o, subtab: "pipeline" }; }
  else if (t === "fundraising" && o.frSection && IDS.has(o.frSection)) {
    const { frSection, ...rest } = o;
    t = MG_TAB; o = { ...rest, subtab: frSection };
  }
  if (t === MG_TAB && can === false) return { tab: "dashboard", opts: {} };
  if (t === MG_TAB) o = { ...o, subtab: mgView(o.subtab) };
  return { tab: t, opts: o };
}
