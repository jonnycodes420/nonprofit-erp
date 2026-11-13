// HARDEN-2 item 2. The app's shell cannot draw Home until its boot reads are
// back (App.jsx loadData), and it used to start them only after its own code
// had downloaded and run: on a phone, two seconds of nothing in a row. main.jsx
// now starts them the moment the page loads on an app path with a session, in
// parallel with the app's code, and App takes each one once. A read nobody
// took within a minute is dropped, so a stale answer is never used.
import { apiFetch, prefetch, landed } from "../api";
import { retryImport } from "./lazyRetry";
import { BOOT_READS, SHELL_READS, RAIL_READS, bootBundles } from "./homeReads";

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
export function startHomeReads(again = false) {
  startHomeCode();
  // Home's deck (Insights.jsx HomeMoves, useInsights("deck")) on its own: the
  // heaviest read on Home, so it does not hold the first bundle back.
  let [, , deck, rail, first] = bootBundles(true);
  // PROFILE-SPEED-1: clicked back to Home (lib/pageReads.js), the shell's bundle
  // is not asked again, so the two shell reads Home's panels make (the rail's
  // thank-you clock, Home's volunteer crossover) ride in Home's own bundles
  // instead of each leaving alone (page-budget: Home sent 6 on a slow run).
  if (again) { rail = [...new Set(RAIL_READS)]; first = [...first, "/volunteer-hub/crossover"]; }
  prefetch(deck, { keep: true }).catch(() => {});
  // HOME-4: the right rail's reads, beside the deck's.
  prefetch(rail, { keep: true }).catch(() => {});
  // PERF-2: the scoped reads ride in the first bundle; the server picks the scope.
  prefetch(first, { keep: true }).catch(() => {});
}

// PERF-3: Home's first look draws the moves deck, whose code is its own chunk.
// On Home it is asked for with the reads (app.html has preloaded it: the
// first-look mark, scripts/prerender.mjs), and App waits for it as it waits
// for its reads, so Home draws once with the deck in it: drawn after, the deck
// pushed the Thread down (CLS 0.49 on a phone). homeCode() is null when Home
// was not the first screen; HomeMoves then loads it as it always did.
let deckCode = null;
export function startHomeCode() {
  if (!deckCode) deckCode = retryImport(() => import(/* first-look */ "../components/Insights"));
  return deckCode;
}
export const homeCode = () => deckCode;
// And the two reads that set the first look's shape: the deck and Home's lead
// (Ask's suggestions, the rail's order). On a second visit the code is cached
// and the shell was ready before them. Never more than HOME_SHAPE_MS longer.
const HOME_SHAPE_MS = 800;
export function homeShape() {
  if (!deckCode) return null;
  return Promise.race([
    Promise.all([deckCode, landed("/insights?view=deck"), landed("/home/lead")]),
    new Promise(r => setTimeout(r, HOME_SHAPE_MS)),
  ]);
}

export function bootRead(path) {
  const p = started && Date.now() - at < 60000 ? started[path] : null;
  if (started) delete started[path];
  return p || apiFetch(path);
}
