// SCALE-2: what Home reads when it opens, and what it reads once it knows the
// scope (GET /home/bundle answers each list in one request; routes/homeBundle.js
// holds the same paths). Keep in step with Dashboard.jsx's effects.
//
// HARDEN-2 item 2: these lived in Dashboard.jsx. They are here so main.jsx can
// ask for them while the app's code is still downloading (lib/bootReads.js),
// with the same lists and the same rule for the scope as Home itself.
export const HOME_FIRST_READS=["/data-health/notice","/gift-starts/notice","/journey-sends/notice","/recurring/exceptions","/readouts/latest","/move",
  "/sequences/home","/agent/daily-line","/threads/health","/org/setup-status","/me/home-layout","/tasks/counts?scope=mine",
  "/dashboard/my-stats","/donors/stage-counts","/recurring/health","/impact","/fundraising/overview","/goals/active","/drift",
  "/threads?scope=mine","/calendar/today","/calendar/to-log","/mailbox","/home/calls","/home/annual-goal","/ask/pins",
  "/donors/birthdays-near","/home/lead",
  // HARDEN-2: Home's people counts (lib/people.js peopleCounts), read on every open.
  "/donors/counts"];
export const homeScopeReads=scope=>[`/dashboard/today?scope=${scope}`,`/metrics/stewardship-summary?scope=${scope}`,
  `/dashboard/home?scope=${scope}`,"/thank-yous",`/dashboard/stewardship-debt/breakdown?scope=${scope}`,
  `/dashboard/retention/breakdown?scope=${scope}`];
// Home's first scope: "mine" when this person has a portfolio, else "all"
// (and "all" when /dashboard/my-stats could not be read).
export const initialScope=myStats=>((myStats?.portfolioCount||0)>0?"mine":"all");
