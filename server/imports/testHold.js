// server/imports/testHold.js · FLAKE-2. A SUITE CAN HOLD AN IMPORT'S RECENT-GIFT
// WORK AT A STEP, SO "PART WAY THROUGH" IS SEEN, NEVER RACED.
//
// fix37 §5 watched the work of a 5,000-gift import and pressed Undo while it
// ran. On a fast runner the work had finished before the suite looked ("the
// work is part way through" found it done), or had got far enough that the
// undo was over UNDO_INLINE_MAX and went on the queue ("undo during the work"
// found it still queued). Both were the test racing the job.
//
// THE HOLD. After its first batch is saved, the importRecent job waits on the
// advisory lock `test-hold:import-recent:<importId>` and lets it go at once.
// Nobody holds that key, so the wait is one round trip. A suite that holds it
// (tests/lib/importHold.js, from its own database session) keeps the job at
// that step, with its progress saved, until it lets go. The lock lives in
// Postgres, so it holds the job whichever process runs it.
//
// SAFETY: TEST_MODE only (the same guard as server/shared/testPlants.js), and
// never when NODE_ENV is production. In production the function returns
// before it touches the database, and nothing outside a test can take the key.
"use strict";

const active = () => process.env.NODE_ENV !== "production" &&
  (process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1");

const holdKey = importId => `test-hold:import-recent:${importId}`;

async function atFirstBatch(withAdvisoryLock, importId) {
  if (!active()) return;
  await withAdvisoryLock(holdKey(importId), async () => {});
}

module.exports = { atFirstBatch, holdKey, active };
