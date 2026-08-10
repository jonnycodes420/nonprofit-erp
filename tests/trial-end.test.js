// BUILD-50 item 1 — pin the "Free through December 31, 2026" trial rule.
// Pure unit test of computeTrialEnd (no server, no DB), like money/greeting.
//   node tests/trial-end.test.js

const { computeTrialEnd, FREE_THROUGH_MS, FREE_THROUGH_ISO } = require("../trialEnd");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : "")); }
};

const EOD_2026 = "2026-12-31T23:59:59.999Z";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// The constant itself is end of day 2026-12-31 UTC.
ok("FREE_THROUGH_ISO is EOD 2026-12-31 UTC", FREE_THROUGH_ISO === EOD_2026, FREE_THROUGH_ISO);

// ── An org created with a 2026 timestamp has a trial ending 2026-12-31 ──
for (const ts of [
  "2026-08-10T04:04:00.000Z", // tonight's case
  "2026-01-01T00:00:00.000Z", // start of 2026
  "2026-12-31T09:00:00.000Z", // same day, morning
  "2026-12-31T23:59:59.000Z", // last second before EOD
  "2025-06-15T12:00:00.000Z", // an existing org from 2025
]) {
  const end = computeTrialEnd(new Date(ts).getTime());
  ok(`org created ${ts} → trial ends ${EOD_2026}`, end.toISOString() === EOD_2026, end.toISOString());
}

// ── An org created with a 2027 timestamp gets 30 days ──
for (const ts of [
  "2027-01-01T00:00:00.000Z", // first paid instant
  "2027-03-15T10:30:00.000Z",
  "2028-11-02T00:00:00.000Z",
]) {
  const created = new Date(ts).getTime();
  const end = computeTrialEnd(created);
  ok(`org created ${ts} → trial ends created+30d`, end.getTime() === created + THIRTY_DAYS, end.toISOString());
}

// ── Boundary: the exact FREE_THROUGH instant is still "through 2026" ──
ok("created exactly at FREE_THROUGH_MS → ends at FREE_THROUGH (not +30d)",
  computeTrialEnd(FREE_THROUGH_MS).toISOString() === EOD_2026);
ok("created 1ms after FREE_THROUGH → +30d",
  computeTrialEnd(FREE_THROUGH_MS + 1).getTime() === FREE_THROUGH_MS + 1 + THIRTY_DAYS);

// ── Input shapes: ms, Date, ISO all accepted ──
ok("accepts a Date object", computeTrialEnd(new Date("2026-05-01T00:00:00Z")).toISOString() === EOD_2026);
ok("accepts an ISO string", computeTrialEnd("2026-05-01T00:00:00Z").toISOString() === EOD_2026);

console.log(`\ntrial-end: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
