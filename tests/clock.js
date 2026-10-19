// tests/clock.js: FIX-42. ONE PINNED "NOW" FOR A TEST RUN, SHARED BY THE
// SERVER AND THE SUITES.
//
// Since 15 Oct, night builds lost hours to suites whose result depended on the
// time of day: fix33-sync-proof just after New York midnight, and anything that
// read a civil date while UTC and New York disagree (8 PM to midnight Eastern).
// The cure is that a test run does not ask the machine what time it is. It asks
// this file, and this file answers with one instant chosen for the run.
//
// HOW IT IS LOADED
//   node -r ./tests/clock.js …   (tests/shard.sh puts it in NODE_OPTIONS for the
//   shard's server AND for every suite it runs, so both read the same clock)
//
// WHAT IT DOES
//   STEWARD_TEST_NOW=<ISO instant>   the run starts at that instant, in the
//                                    server and in every suite (the proof runs:
//                                    00:30, 21:00 and noon in New York)
//   (unset)                          the run starts at the real instant the
//                                    process started; nothing is shifted
//
// The instant must not be EARLIER than the real clock. Postgres keeps its own
// NOW(), and a server clock behind the database's revokes every fresh session
// (a token issued "before" the session row it belongs to). Later is safe.
//
// The pinned clock TICKS: it is the real clock plus one fixed offset, so
// timeouts, elapsed-time measurements and "created after" orderings behave as
// they always did, and every process in the run reads the same time.
//
// SAFETY: it does nothing unless TEST_MODE=1 (every test server and suite sets
// it) or a run's STEWARD_TEST_OFFSET_MS is present, and never when NODE_ENV is
// "production". It lives under tests/ and nothing in the
// product requires it, so a production process cannot load it by accident.
//
// What it cannot move: Postgres's own NOW(). So a fixture that needs an exact
// relation to now passes `testNow()` as a parameter instead of writing NOW(),
// and a fixture that says "earlier today" uses `earlierToday()`, which never
// crosses the org's midnight, whatever the hour.
"use strict";

const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);
const ZONE = "America/New_York";

// Noon in New York on the given civil day, as an instant. Noon is 16:00Z in
// summer and 17:00Z in winter; pick whichever formats back to 12 in the zone.
function nyNoon(civil) {
  for (const h of [16, 17]) {
    const t = RealDate.parse(`${civil}T${String(h).padStart(2, "0")}:00:00Z`);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }).format(new RealDate(t));
    if (Number(hour) === 12) return t;
  }
  return RealDate.parse(`${civil}T16:00:00Z`);
}

// The pin is an OFFSET from the real clock, so every process in a run agrees to
// the millisecond however late it started: tests/shard.sh computes it once
// (STEWARD_TEST_OFFSET_MS, the same offset its database's now() uses), and a
// process given only STEWARD_TEST_NOW computes it at load and hands it down.
function pinnedOffset() {
  const off = process.env.STEWARD_TEST_OFFSET_MS;
  if (off != null && off !== "") {
    const n = Number(off);
    if (!Number.isFinite(n)) throw new Error(`tests/clock.js: STEWARD_TEST_OFFSET_MS is not a number: ${off}`);
    return n;
  }
  const raw = process.env.STEWARD_TEST_NOW;
  if (!raw) return null;
  const t = RealDate.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`tests/clock.js: STEWARD_TEST_NOW is not an instant: ${raw}`);
  return t - realNow();
}

// A child that a suite boots with TEST_MODE cleared (scale1-queue's "production
// limits" web processes) still carries the run's offset, and must keep it: a
// process on the real clock beside a shifted database revokes its own sessions.
const active = process.env.NODE_ENV !== "production" &&
  (process.env.TEST_MODE === "1" || (process.env.STEWARD_TEST_OFFSET_MS || "") !== "");
const offset = active ? pinnedOffset() : null;
const pinnedNow = () => (offset == null ? realNow() : realNow() + offset);

if (offset != null && !global.__stewardTestClock) {
  // Every child process this one spawns (a server a suite boots itself, a
  // script it runs) inherits the same offset, not a fresh start.
  process.env.STEWARD_TEST_OFFSET_MS = String(offset);
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(pinnedNow());
      else super(...args);
    }
    static now() { return pinnedNow(); }
  }
  // Calling Date() as a function returns a string of now.
  const DateFn = new Proxy(PinnedDate, {
    apply() { return new RealDate(pinnedNow()).toString(); },
  });
  global.Date = DateFn;
  global.__stewardTestClock = { offset, RealDate };
}

// The instant a suite builds its fixtures from. Use this, not Date.now(), so a
// fixture that says "two hours ago" means two hours before the pinned now.
const testNow = () => pinnedNow();
// The civil day of an instant in a zone (the org's, New York by default).
const civilDay = (ms = testNow(), tz = ZONE) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new RealDate(ms));

// Start of the org's civil day containing `ms`, as an instant.
function startOfDay(ms = testNow(), tz = ZONE) {
  const day = civilDay(ms, tz);
  let lo = ms - 26 * 3600e3, hi = ms;               // the day began within the last 26h
  while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (civilDay(mid, tz) === day) hi = mid; else lo = mid; }
  return hi;
}
// "h hours ago, but still today": an instant before now and never before the
// org's midnight. At 00:30 "two hours ago" is yesterday; this is 00:15 instead.
function earlierToday(h, ms = testNow(), tz = ZONE) {
  const sod = startOfDay(ms, tz);
  return Math.max(ms - h * 3600e3, sod + Math.floor((ms - sod) / 2));
}

module.exports = { testNow, civilDay, startOfDay, earlierToday, nyNoon, pinned: offset != null, RealDate };
