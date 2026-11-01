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
  "/mailbox","/calendar/today","/calendar/to-log","/home/owners"];   // SWEEP-1: the owners card
// (HOME-4: the board's two breakdowns are not among them; Home reads them when a panel opens.)
export const homeScopeReads=scope=>[`/dashboard/today?scope=${scope}`,`/metrics/stewardship-summary?scope=${scope}`,
  `/dashboard/home?scope=${scope}`,"/thank-yous"];
// Home's first scope: "mine" when this person has a portfolio, else "all"
// (and "all" when /dashboard/my-stats could not be read).
export const initialScope=myStats=>((myStats?.portfolioCount||0)>0?"mine":"all");
// PERF-2: the scoped reads asked for in the FIRST bundle, beside /dashboard/my-stats.
// The server resolves {scope} by initialScope's rule (routes/homeBundle.js) and
// answers each under its resolved path, so Home does not wait a round trip on a
// phone to ask for them. Keep the two rules the same.
export const HOME_SCOPED_FIRST=homeScopeReads("{scope}");

// PERF-2: the app's boot reads and the shell's (lib/bootReads.js asks for
// them), here beside Home's so app.html's preloader can be built from the same
// lists (scripts/prerender.mjs). Every path is in routes/homeBundle.js HOME_READS.
export const BOOT_READS=["/org","/grants","/volunteers","/tasks","/board","/financials","/billing/status"];
export const SHELL_READS=["/billing/donor-band","/atlas/status","/me/nav-layout","/people/photos","/capture/count",
  "/status/summary","/org/sample-data-status","/org/welcome","/atlas/activity","/changelog/hidden","/thank-yous/clock",
  "/volunteer-hub/crossover",
  "/me/mfa"];   // PERF-2: the idle guard's read, which left on its own after Home drew
// One bundle's address (GET /home/bundle), the one way it is written.
export const bundlePath=paths=>"/home/bundle?"+paths.map(p=>"p="+encodeURIComponent(p)).join("&");
// The bundles the app asks for as it boots, in the order it asks (main.jsx:
// boot, shell, then Home's deck, rail and first reads), each read in the first
// bundle that names it, as api.js prefetch drops a read already asked for.
export function bootBundles(home){
  const lists=[BOOT_READS,home?[...SHELL_READS,"/atlas/notes?place=home"]:SHELL_READS];
  if(home) lists.push(["/insights?view=deck"],RAIL_READS,[...HOME_FIRST_READS,...HOME_SCOPED_FIRST]);
  const asked=new Set();
  return lists.map(l=>[...new Set(l)].filter(p=>!asked.has(p)&&asked.add(p)));
}
