// server/db/ddl/input1.js · INPUT-1. A FUTURE GIFT WAITS FOR ITS DAY; AN OVERNIGHT SHIFT SAYS SO.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   gift_day_holds        what follows a gift dated after today (its thank-you
//                         draft and task, its journeys and sequences), held
//                         until the gift's day (server/outreach/giftDay.js).
//                         One row per gift and step; `released_at` once it ran.
//   volunteer_slots.end_date  the day an overnight shift ends. NULL = the day it
//                         starts. An end before the start on the same day is
//                         refused (shared/volunteerShifts.js validateSlot).
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS gift_day_holds (
    gift_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    handler TEXT NOT NULL,
    due_on TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL DEFAULT 'system:outbox',
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    PRIMARY KEY (gift_id, handler)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS gift_day_holds_due ON gift_day_holds (due_on) WHERE released_at IS NULL`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS end_date TEXT`);
}

module.exports = { run };
