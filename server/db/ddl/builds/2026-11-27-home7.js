// server/db/ddl/builds/2026-11-27-home7.js · HOME-7 item 1. THIS WEEK'S FIVE, KEPT FOR THE WEEK.
//
// home_week_five  one row per person in one user's five for one week (week_of, the org's Monday as a
//                 civil day). `move` is the deck's move as it stood when the person came in, so the
//                 reason and the draft read the same all week. `state` is open, not_now or not_fit;
//                 a person who is done is found at read (the move's Done, a call logged, a gift in)
//                 or written as done by the Done link. Additive; no row is written here.
"use strict";
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS home_week_five (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    week_of DATE NOT NULL,
    donor_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    move JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'open',
    state_at TIMESTAMPTZ,
    outcome TEXT,
    called_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS home_week_five_person ON home_week_five (org_id, user_id, week_of, donor_id)`);
}
module.exports = { run };
