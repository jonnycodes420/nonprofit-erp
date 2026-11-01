// HARDEN-2 item 2. The app's shell cannot draw Home until its boot reads are
// back (App.jsx loadData), and it used to start them only after its own code
// had downloaded and run: on a phone, two seconds of nothing in a row. main.jsx
// now starts them the moment the page loads on an app path with a session, in
// parallel with the app's code, and App takes each one once. A read nobody
// took within a minute is dropped, so a stale answer is never used.
import { apiFetch, prefetch } from "../api";
import { BOOT_READS, SHELL_READS, bootBundles } from "./homeReads";

export { BOOT_READS, SHELL_READS };   // PERF-2: the lists live in lib/homeReads.js
let started = null, at = 0;

export function startBootReads() {
  if (started) return;
  at = Date.now();
  started = {};
  // PERF-2: the seven ride in one bundle (GET /home/bundle); each apiFetch below
  // is handed its answer from it, or asks on its own when the bundle could not.
  prefetch(BOOT_READS).catch(() => {});
  for (const p of BOOT_READS) {
    started[p] = apiFetch(p);
    started[p].catch(() => {});   // App reads the rejection; this only keeps it from being "unhandled"
  }
}

// The shell's own reads (top bar, rail badges, Atlas): one bundle, parked.
// Every path is in routes/homeBundle.js HOME_READS (lists: lib/homeReads.js).
export function startShellReads(home) {
  prefetch(bootBundles(home)[1], { keep: true }).catch(() => {});
}

// On Home, its first bundle too, with the scoped reads in it (PERF-2). Its
// answers are parked for Home.
export function startHomeReads() {
  // Home's deck (Insights.jsx HomeMoves, useInsights("deck")) on its own: the
  // heaviest read on Home, so it does not hold the first bundle back.
  const [, , deck, rail, first] = bootBundles(true);
  prefetch(deck, { keep: true }).catch(() => {});
  // HOME-4: the right rail's reads, beside the deck's.
  prefetch(rail, { keep: true }).catch(() => {});
  // PERF-2: the scoped reads ride in the first bundle; the server picks the scope.
  prefetch(first, { keep: true }).catch(() => {});
}

export function bootRead(path) {
  const p = started && Date.now() - at < 60000 ? started[path] : null;
  if (started) delete started[path];
  return p || apiFetch(path);
}
