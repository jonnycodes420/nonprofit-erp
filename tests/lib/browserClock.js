// tests/lib/browserClock.js: ARCH-1. THE BROWSER READS THE RUN'S CLOCK TOO.
//
// tests/clock.js moves the server, every suite and the database to the run's
// pinned instant (STEWARD_TEST_NOW, carried as STEWARD_TEST_OFFSET_MS). A
// browser leg's page did not move: a screen that works out "today" or "last
// month" in the browser (Finance's month close, through orgTodayCivil) read
// the machine's real day while the data behind it was written for the pinned
// one. On Saturday 31 Oct with the Monday pin, polish1-trust §bare opened
// September's close while its fixture had put the problems in October.
//
// pinBrowserClock(ctx) gives a Playwright context the same offset: Date and
// Date.now() in every page are the real clock plus the run's offset, ticking,
// exactly as tests/clock.js does in Node. Unpinned it does nothing.
"use strict";

function offsetMs() {
  const raw = process.env.STEWARD_TEST_OFFSET_MS;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function pinBrowserClock(ctx) {
  const off = offsetMs();
  if (!off) return false;
  await ctx.addInitScript(o => {
    const RealDate = Date;
    const now = () => RealDate.now() + o;
    class PinnedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(now()); else super(...args); }
      static now() { return now(); }
    }
    // Date() called as a function returns a string of now.
    window.Date = new Proxy(PinnedDate, { apply() { return new RealDate(now()).toString(); } });
  }, off);
  return true;
}

module.exports = { pinBrowserClock, offsetMs };
