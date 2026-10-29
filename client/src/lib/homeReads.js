// SCALE-2: what Home reads when it opens, and what it reads once it knows the
// scope (GET /home/bundle answers each list in one request; routes/homeBundle.js
// holds the same paths). Keep in step with Dashboard.jsx's effects.
//
// HARDEN-2 item 2: these lived in Dashboard.jsx. They are here so main.jsx can
// ask for them while the app's code is still downloading (lib/bootReads.js),
// with the same lists and the same rule for the scope as Home itself.
export const HOME_FIRST_READS=["/data-health/notice","/gift-starts/notice","/journey-sends/notice","/recurring/exceptions","/readouts/latest","/move",
  "/sequences/home","/agent/daily-line","/threads/health","/me/home-layout",
  "/dashboard/my-stats","/donors/stage-counts","/impact","/fundraising/overview","/goals/active","/drift",
  "/ask/pins","/home/lead",
  // HARDEN-2: Home's people counts (lib/people.js peopleCounts), read on every open.
  "/donors/counts"];
// HOME-4: the right rail's reads, in their own bundle, asked for at the same
// moment as the deck's (/insights) so the rail never waits behind the rest of
// Home, and never starts a read of its own after Home has painted.
export const RAIL_READS=["/org/setup-status","/tasks/counts?scope=mine","/threads?scope=mine","/recurring/health",
  "/home/calls","/home/annual-goal","/thank-yous/clock","/mail-types","/mail-types/status","/donors/birthdays-near",
  "/mailbox","/calendar/today","/calendar/to-log"];
// (HOME-4: the board's two breakdowns are not among them; Home reads them when a panel opens.)
export const homeScopeReads=scope=>[`/dashboard/today?scope=${scope}`,`/metrics/stewardship-summary?scope=${scope}`,
  `/dashboard/home?scope=${scope}`,"/thank-yous"];
// Home's first scope: "mine" when this person has a portfolio, else "all"
// (and "all" when /dashboard/my-stats could not be read).
export const initialScope=myStats=>((myStats?.portfolioCount||0)>0?"mine":"all");
