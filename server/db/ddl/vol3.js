// server/db/ddl/vol3.js · VOL-3. A VOLUNTEER HAS A STATUS, AND A RECORD THAT IS NOT AN APPLICATION.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   volunteer_records       one row per volunteer (org, person): what Add asked
//                           for (hours a week, days, roles) and their status
//                           (active, paused, former) with the day it was set and
//                           who set it. The previous status is kept beside it so
//                           Undo puts back exactly what was there. Written only by
//                           server/volunteers/volunteerRecord.js. No row means
//                           Active with nothing said yet.
//   volunteer_slots.event_id the event a shift belongs to, so an event page shows
//                           its volunteer team. NULL for a shift with no event.
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS volunteer_records (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    hours_per_week NUMERIC(5,2),
    availability JSONB NOT NULL DEFAULT '[]'::jsonb,
    roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','former')),
    status_on TEXT,
    status_by TEXT,
    status_by_name TEXT,
    prev_status TEXT CHECK (prev_status IS NULL OR prev_status IN ('active','paused','former')),
    prev_status_on TEXT,
    prev_status_by TEXT,
    prev_status_by_name TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS volunteer_records_person ON volunteer_records (org_id, person_id)`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS event_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_slots_event ON volunteer_slots (org_id, event_id) WHERE event_id IS NOT NULL`);
}

module.exports = { run };
