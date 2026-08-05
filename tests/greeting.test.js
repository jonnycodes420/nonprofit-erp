// BUILD-36 B3 — greeting windows.
// Pure lib test (client/src/lib/greeting.js, dynamic-imported like money.js).
// No server/DB needed, but it runs inside run-all.sh's booted stack fine.
//
// Windows: evening 5 PM–4 AM · morning 4 AM–noon · afternoon noon–5 PM.
// The bug this locks down: a bare `hour<12` said "Good morning" at 12:23 AM.

const { ok, summary } = require("./helpers");

(async () => {
  const { greetingForHour } = await import("../client/src/lib/greeting.js");

  // The reported bug: 12:23 AM must NOT be morning.
  ok("00:00 (midnight) → Good evening", greetingForHour(0) === "Good evening", greetingForHour(0));
  ok("00 (the 12:23 AM case) is evening, never morning", greetingForHour(0) !== "Good morning");
  ok("03:59 (hour 3) → Good evening (last evening hour)", greetingForHour(3) === "Good evening");

  // Morning 4 AM–noon
  ok("04:00 → Good morning (first morning hour)", greetingForHour(4) === "Good morning");
  ok("08:00 → Good morning", greetingForHour(8) === "Good morning");
  ok("11:59 (hour 11) → Good morning (last morning hour)", greetingForHour(11) === "Good morning");

  // Afternoon noon–5 PM
  ok("12:00 (noon) → Good afternoon", greetingForHour(12) === "Good afternoon");
  ok("16:59 (hour 16) → Good afternoon (last afternoon hour)", greetingForHour(16) === "Good afternoon");

  // Evening 5 PM–4 AM
  ok("17:00 (5 PM) → Good evening (first evening hour)", greetingForHour(17) === "Good evening");
  ok("21:00 → Good evening", greetingForHour(21) === "Good evening");
  ok("23:59 (hour 23) → Good evening", greetingForHour(23) === "Good evening");

  // Robust to junk / out-of-range
  ok("normalizes 24 → 0 → Good evening", greetingForHour(24) === "Good evening");
  ok("normalizes -1 → 23 → Good evening", greetingForHour(-1) === "Good evening");
  ok("floors 8.9 → 8 → Good morning", greetingForHour(8.9) === "Good morning");

  // Full 24-hour sweep: exactly one label per hour, correct counts.
  const counts = { "Good morning": 0, "Good afternoon": 0, "Good evening": 0 };
  for (let h = 0; h < 24; h++) counts[greetingForHour(h)]++;
  ok("morning covers 8 hours (4..11)", counts["Good morning"] === 8, counts);
  ok("afternoon covers 5 hours (12..16)", counts["Good afternoon"] === 5, counts);
  ok("evening covers 11 hours (17..23 + 0..3)", counts["Good evening"] === 11, counts);

  summary();
})();
