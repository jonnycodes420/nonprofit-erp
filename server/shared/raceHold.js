// server/shared/raceHold.js · RACE-1. A SUITE CAN STOP A WRITE AT ITS CRITICAL
// STEP, SO A RACE IS REPLAYED, NEVER WAITED FOR.
//
// The same idea as FLAKE-2's import hold (server/imports/testHold.js), for any
// named point: raceHold.at("journey-open:<donor>:<journey>") waits on the
// advisory lock `test-hold:<that name>` and lets go at once. Nobody holds it,
// so the wait is one round trip. A suite that holds it from its own database
// session (tests/lib/raceHold.js) keeps the write at that point until it lets
// go, and can start a second writer meanwhile.
//
// SAFETY: TEST_MODE only, and never when NODE_ENV is production. In
// production at() returns before it touches the database.
"use strict";

const active = () => process.env.NODE_ENV !== "production" &&
  (process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1");

const holdKey = name => `test-hold:${name}`;

async function at(name) {
  if (!active()) return;
  await require("../db/query").withAdvisoryLock(holdKey(name), async () => {});
}

module.exports = { at, holdKey, active };
