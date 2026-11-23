// server/db/ddl/vol3.js · VOL-3. A VOLUNTEER HAS A STATUS, AND A RECORD THAT IS NOT AN APPLICATION.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   volunteer_records       (created in part7.js, beside the other person tables, so the
//                           merge guard's schema read sees it) one row per volunteer (org, person): what Add asked
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
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS event_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_slots_event ON volunteer_slots (org_id, event_id) WHERE event_id IS NOT NULL`);
}

module.exports = { run };
