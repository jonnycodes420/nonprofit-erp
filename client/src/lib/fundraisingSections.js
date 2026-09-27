// client/src/lib/fundraisingSections.js — FIX-1 §B: FUNDRAISING IS FOUR QUESTIONS.
//
// Fundraising had thirteen sub-tabs and the sidebar had a fourteenth
// (Pipeline); the strip scrolled sideways at 1440 (the walk's finding 6). It is
// now four tabs, each a question somebody opens Fundraising to ask, and every
// old view is a PART of exactly one of them. Nothing was deleted: the parts are
// the same components, reading the same endpoints, showing the same figures.
//
// FR_LEGACY is the promise that every old id still lands: a Home link written
// as navigateTo("fundraising", {frSection: "recurring"}), MajorGifts' own
// {frSection: "proposals"}, a stale navigateTo("pipeline"), and the URL form
// /dashboard?fr=<id> all resolve through resolveFr() to a section and the part
// inside it that IS the old view.
//
// JSX-free on purpose: Node imports it (tests/fix1-walk.test.js §6,
// tests/fix1-fundraising.test.js §1).

// Members and Funds — where they sit still wants Jonathan's confirmation
// (docs/fix-1/B-NOTES.md says why each is where it is).
export const FR_SECTIONS = [
  {
    id: "overview", label: "Overview",
    question: "How is this year's fundraising going?",
    parts: [{ id: "overview", label: "Overview" }],
  },
  {
    id: "campaigns", label: "Campaigns & pages",
    question: "What are we asking for, and where can people give?",
    parts: [
      { id: "campaigns", label: "Campaigns" },
      // BUILD-102 — a form is a giving page with a form config, so forms live
      // with the pages they are.
      { id: "pages", label: "Giving pages & forms" },
      { id: "events", label: "Events" },
      { id: "recurring", label: "Recurring" },
      { id: "members", label: "Members" },
    ],
  },
  {
    id: "majorgifts", label: "Major gifts",
    question: "Who are we cultivating for a large gift?",
    parts: [
      { id: "majorgifts", label: "At a glance" },
      // The sidebar's Pipeline folded in here. It keeps its Team gate.
      { id: "pipeline", label: "Pipeline", teamGated: true },
      { id: "proposals", label: "Proposals" },
      { id: "portfolios", label: "Portfolios" },
      { id: "plans", label: "Plans" },
    ],
  },
  {
    id: "moneyin", label: "Money in",
    question: "What has come in, and who still needs thanking?",
    parts: [
      { id: "deposits", label: "Deposits" },
      { id: "acknowledgments", label: "Acknowledgments" },
      { id: "funds", label: "Funds" },
    ],
  },
];

// Every id that ever named a Fundraising view (the thirteen sub-tabs and the
// sidebar's `pipeline`) → the section and the part that is that view now.
// `label` is the name it had, so the Overview's index can still be read by
// someone who learned the old tabs.
export const FR_LEGACY = {
  overview:        { section: "overview",   part: "overview",        label: "Overview" },
  deposits:        { section: "moneyin",    part: "deposits",        label: "Deposits" },
  acknowledgments: { section: "moneyin",    part: "acknowledgments", label: "Acknowledgments" },
  events:          { section: "campaigns",  part: "events",          label: "Events" },
  majorgifts:      { section: "majorgifts", part: "majorgifts",      label: "Major gifts" },
  proposals:       { section: "majorgifts", part: "proposals",       label: "Proposals" },
  portfolios:      { section: "majorgifts", part: "portfolios",      label: "Portfolios" },
  plans:           { section: "majorgifts", part: "plans",           label: "Plans" },
  campaigns:       { section: "campaigns",  part: "campaigns",       label: "Campaigns" },
  pages:           { section: "campaigns",  part: "pages",           label: "Giving Pages" },
  recurring:       { section: "campaigns",  part: "recurring",       label: "Recurring Giving" },
  members:         { section: "campaigns",  part: "members",         label: "Members" },
  funds:           { section: "moneyin",    part: "funds",           label: "Funds" },
  pipeline:        { section: "majorgifts", part: "pipeline",        label: "Pipeline" },
};

// Any id — an old tab id, a section id, or nothing — to {section, part}.
// A section id opens on its first part; anything unknown opens the Overview,
// never a blank screen.
export function resolveFr(id) {
  if (id && FR_LEGACY[id]) return { section: FR_LEGACY[id].section, part: FR_LEGACY[id].part };
  const sec = FR_SECTIONS.find(s => s.id === id);
  if (sec) return { section: sec.id, part: sec.parts[0].id };
  return { section: "overview", part: "overview" };
}
