// HARDEN-2 item 2. The app's shell cannot draw Home until its boot reads are
// back (App.jsx loadData), and it used to start them only after its own code
// had downloaded and run: on a phone, two seconds of nothing in a row. main.jsx
// now starts them the moment the page loads on an app path with a session, in
// parallel with the app's code, and App takes each one once. A read nobody
// took within a minute is dropped, so a stale answer is never used.
import { apiFetch, prefetch } from "../api";
import { HOME_FIRST_READS, RAIL_READS, homeScopeReads, initialScope } from "./homeReads";

export const BOOT_READS = ["/org", "/grants", "/volunteers", "/tasks", "/board", "/financials", "/billing/status"];
let started = null, at = 0;

export function startBootReads() {
  if (started) return;
  at = Date.now();
  started = {};
  for (const p of BOOT_READS) {
    started[p] = apiFetch(p);
    started[p].catch(() => {});   // App reads the rejection; this only keeps it from being "unhandled"
  }
}

// The shell's own reads (top bar, rail badges, Atlas): one bundle, parked.
// Every path here is in routes/homeBundle.js HOME_READS.
export const SHELL_READS = ["/billing/donor-band", "/atlas/status", "/me/nav-layout", "/people/photos", "/capture/count",
  "/status/summary", "/org/sample-data-status", "/org/welcome", "/atlas/activity", "/changelog/hidden", "/thank-yous/clock",
  "/volunteer-hub/crossover"];
export function startShellReads(home) {
  prefetch(home ? [...SHELL_READS, "/atlas/notes?place=home"] : SHELL_READS, { keep: true }).catch(() => {});
}

// On Home, its two bundles too: the first, then (from /dashboard/my-stats in
// it, by Home's own rule) the scoped one. Their answers are parked for Home.
export function startHomeReads() {
  // Home's deck (Insights.jsx HomeMoves, useInsights("deck")) on its own: the
  // heaviest read on Home, so it does not hold the first bundle back.
  prefetch(["/insights?view=deck"], { keep: true }).catch(() => {});
  // HOME-4: the right rail's reads, beside the deck's.
  prefetch(RAIL_READS, { keep: true }).catch(() => {});
  prefetch(HOME_FIRST_READS, { keep: true }).then(b => {
    const r = b && b["/dashboard/my-stats"];
    prefetch(homeScopeReads(initialScope(r && r.status === 200 ? r.body : null)), { keep: true });
  }).catch(() => {});
}

export function bootRead(path) {
  const p = started && Date.now() - at < 60000 ? started[path] : null;
  if (started) delete started[path];
  return p || apiFetch(path);
}
