// BUILD-90 — PIN THE ONE RULE: THIRTY DAYS FROM SIGNING, FULL STOP.
// Pure unit test of trialEnd.js (no server, no DB), like money/greeting.
//   node tests/trial-end.test.js
//
// This file used to pin the opposite rule — "Free through December 31, 2026",
// a date every org created in 2026 inherited no matter when it signed. That
// promise is gone from the product (nobody had signed under it, so nothing is
// grandfathered) and the arithmetic that implemented it is deleted. What is
// asserted below is that there is now NO special case at all: the same span in
// January as in December, across a leap day, across a DST boundary, and for a
// date that used to be treated as magic.

const {
  computeTrialEnd, computeReminderAt, isReminderDue,
  TRIAL_DAYS, THIRTY_DAYS_MS, REMINDER_LEAD_DAYS,
} = require("../trialEnd");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : "")); }
};

const DAY = 24 * 60 * 60 * 1000;

console.log("— §1 · the constants —");
ok("the trial is 30 days", TRIAL_DAYS === 30, TRIAL_DAYS);
ok("…and THIRTY_DAYS_MS is exactly that in milliseconds", THIRTY_DAYS_MS === 30 * DAY, THIRTY_DAYS_MS);
ok("the reminder leads by 7 days", REMINDER_LEAD_DAYS === 7, REMINDER_LEAD_DAYS);
ok("the module exports no free-through date any more",
   !("FREE_THROUGH_MS" in require("../trialEnd")) && !("FREE_THROUGH_ISO" in require("../trialEnd")),
   Object.keys(require("../trialEnd")));

console.log("\n— §2 · thirty days, from any signing moment, with no special cases —");
// Each of these signing moments used to produce a DIFFERENT answer (2026 →
// EOD Dec 31; 2027+ → +30d). Now they all produce the same span.
for (const ts of [
  "2026-01-01T00:00:00.000Z", // start of the year the old rule made free
  "2026-09-20T17:30:00.000Z", // a Sunday afternoon close
  "2026-12-01T09:00:00.000Z", // a month the old rule capped
  "2026-12-31T23:59:59.999Z", // the exact instant the old rule pivoted on
  "2027-01-01T00:00:00.000Z",
  "2028-02-01T12:00:00.000Z", // → leap day lands inside the span
  "2026-03-01T12:00:00.000Z",
]) {
  const signed = new Date(ts).getTime();
  const end = computeTrialEnd(signed);
  ok(`signed ${ts} → charged ${new Date(signed + 30 * DAY).toISOString()}`,
     end.getTime() === signed + 30 * DAY, end.toISOString());
}

// The old rule's pivot instant is now utterly ordinary: one millisecond either
// side of it produces answers one millisecond apart, not six months apart.
const pivot = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
ok("one ms either side of the retired pivot differ by exactly one ms",
   computeTrialEnd(pivot + 1).getTime() - computeTrialEnd(pivot).getTime() === 1);

console.log("\n— §3 · input shapes —");
ok("accepts a Date object", computeTrialEnd(new Date("2026-05-01T00:00:00Z")).toISOString() === "2026-05-31T00:00:00.000Z");
ok("accepts an ISO string", computeTrialEnd("2026-05-01T00:00:00Z").toISOString() === "2026-05-31T00:00:00.000Z");
ok("accepts milliseconds", computeTrialEnd(Date.parse("2026-05-01T00:00:00Z")).toISOString() === "2026-05-31T00:00:00.000Z");
ok("a garbage input falls back to now rather than producing NaN",
   !Number.isNaN(computeTrialEnd("not a date").getTime()));

console.log("\n— §4 · the seven-day reminder window —");
const signed = Date.parse("2026-09-20T12:00:00.000Z");
const end = computeTrialEnd(signed);
ok("the reminder is due on day 23", computeReminderAt(end).getTime() === signed + 23 * DAY, computeReminderAt(end).toISOString());
ok("…which is seven days before the charge", end.getTime() - computeReminderAt(end).getTime() === 7 * DAY);

ok("day 22 — not yet due", !isReminderDue(end, signed + 22 * DAY));
ok("one minute before day 23 — still not due", !isReminderDue(end, signed + 23 * DAY - 60000));
ok("day 23 exactly — due", isReminderDue(end, signed + 23 * DAY));
// A tick that was down on day 23 must still send on day 24: the window stays
// open right up to the charge, because one late warning beats none.
ok("day 24 — still due (a missed tick must not eat the only warning)", isReminderDue(end, signed + 24 * DAY));
ok("day 29, 23:59 — still due", isReminderDue(end, end.getTime() - 60000));
ok("the charge instant — no longer due", !isReminderDue(end, end.getTime()));
ok("after the charge — not due", !isReminderDue(end, end.getTime() + DAY));

console.log(`\ntrial-end: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
