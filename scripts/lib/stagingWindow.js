// STAGE-3 · STAGING HOLDS STILL WHILE THE FLEET WALKS IT.
//
// The QA fleet walks staging overnight. On 11 and 12 Nov merges deployed to
// staging in the middle of a walk (SALES-2 at 11:36 PM ET, ATLAS-7 at 12:45 AM
// ET) and whole areas filed nothing. Merges stay instant; only the staging
// DEPLOY waits:
//   · ci.yml's deploy-staging asks `decideHold` right before it deploys. Inside
//     the walk window it deploys nothing, says so, and marks the commit
//     `staging/deploy` pending "Held until 3:15 AM ET". It never sleeps.
//   · deploy-staging-release.yml runs on a cron just after the window's end
//     (both UTC offsets, so DST needs no edit). `decideRelease` says whether it
//     may act now; `pickRelease` picks the LATEST held merge (never an older
//     one, never one staging already has), and that run's deploy-staging is
//     re-run, which deploys and walks it as usual.
//   · A dispatch of the release workflow with force: true releases at once.
//
// The window is defined once: the repo variable STAGING_WALK_WINDOW, and when
// it is unset, DEFAULT_WINDOW here. Pure functions: the clock is passed in.
"use strict";

const DEFAULT_WINDOW = "23:30-03:15 America/New_York";
// deploy-staging-release.yml's cron, in UTC. 07:15 UTC is 3:15 AM EDT and
// 08:15 UTC is 3:15 AM EST; the window decides which run acts.
const RELEASE_CRON_UTC = ["07:20", "07:50", "08:20", "08:50", "09:20", "09:50"];
const HELD_CONTEXT = "staging/deploy";
const RELEASED_PREFIX = "Released";
const TZ_SHORT = { "America/New_York": "ET" };

function parseWindow(spec) {
  const s = String(spec == null || String(spec).trim() === "" ? DEFAULT_WINDOW : spec).trim();
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)$/.exec(s);
  if (!m) throw new Error(`STAGING_WALK_WINDOW "${s}" is not like "${DEFAULT_WINDOW}"`);
  const [sh, sm, eh, em] = [m[1], m[2], m[3], m[4]].map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) throw new Error(`STAGING_WALK_WINDOW "${s}" has a time that is not on a clock`);
  try { new Intl.DateTimeFormat("en-US", { timeZone: m[5] }); } catch { throw new Error(`STAGING_WALK_WINDOW names an unknown time zone "${m[5]}"`); }
  return { start: sh * 60 + sm, end: eh * 60 + em, tz: m[5], spec: s };
}

// Minutes past midnight on the wall clock in `tz` at instant `now`.
function wallMinutes(now, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = t => Number((parts.find(p => p.type === t) || {}).value);
  return (get("hour") % 24) * 60 + get("minute");
}

// Inside [start, end) on the wall clock; a window across midnight wraps.
function inWindow(now, spec) {
  const w = typeof spec === "object" && spec ? spec : parseWindow(spec);
  if (w.start === w.end) return false;
  const m = wallMinutes(now, w.tz);
  return w.start < w.end ? m >= w.start && m < w.end : m >= w.start || m < w.end;
}

// "3:15 AM ET"
function endLabel(spec) {
  const w = typeof spec === "object" && spec ? spec : parseWindow(spec);
  const h = Math.floor(w.end / 60), mm = String(w.end % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"} ${TZ_SHORT[w.tz] || w.tz}`;
}

// deploy-staging, right before it deploys: hold or go.
// `released` is true when the release workflow has marked this commit released
// (after the window, or forced): its re-run must deploy whatever the clock says.
function decideHold({ now, window, released = false }) {
  const w = parseWindow(window);
  if (released) return { hold: false, line: "Released by deploy-staging-release; deploying now." };
  if (!inWindow(now, w)) return { hold: false, line: `Outside the walk window (${w.spec}); deploying now.` };
  return { hold: true, until: endLabel(w),
    line: `Holding the staging deploy until ${endLabel(w)} so the overnight walk isn't interrupted.` };
}

// deploy-staging-release: may it release now?
function decideRelease({ now, window, force = false }) {
  const w = parseWindow(window);
  if (force) return { go: true, line: "Forced by hand: releasing the latest held merge now." };
  if (inWindow(now, w)) return { go: false, line: `Still inside the walk window (${w.spec}); the next scheduled run releases.` };
  return { go: true, line: `The walk window has ended (${endLabel(w)}); releasing the latest held merge.` };
}

// Which held merge goes out. `runs`: push-to-main CI runs, each
// { runNumber, sha, job: { id, status, conclusion } } for its deploy-staging.
// `newerThanLive(sha)` says whether staging lacks that commit (live is its
// ancestor). Only the newest run whose deploy-staging passed counts: an older
// held merge is inside the newer one, so deploying it would be wasted at best.
function pickRelease({ runs, newerThanLive }) {
  const done = (runs || []).filter(r => r && r.job && r.job.status === "completed" && r.job.conclusion === "success")
    .sort((a, b) => b.runNumber - a.runNumber);
  const latest = done[0];
  if (!latest) return { pick: null, line: "No merge on main has a passed deploy-staging to release." };
  if (!newerThanLive(latest.sha)) return { pick: null, line: `Staging already has ${latest.sha.slice(0, 7)}; nothing is held.` };
  // A newer merge already in its own deploy-staging deploys itself; releasing
  // an older one beside it would race it.
  const busy = (runs || []).find(r => r && r.job && r.job.status !== "completed" && r.runNumber > latest.runNumber);
  if (busy) return { pick: null, line: `Run #${busy.runNumber} (${busy.sha.slice(0, 7)}) is deploying staging itself; nothing to release.` };
  return { pick: latest, superseded: done.slice(1).filter(r => r.sha !== latest.sha && newerThanLive(r.sha)),
    line: `Releasing ${latest.sha.slice(0, 7)} (run #${latest.runNumber}), the latest merge on main.` };
}

module.exports = { DEFAULT_WINDOW, RELEASE_CRON_UTC, HELD_CONTEXT, RELEASED_PREFIX,
  parseWindow, wallMinutes, inWindow, endLabel, decideHold, decideRelease, pickRelease };
