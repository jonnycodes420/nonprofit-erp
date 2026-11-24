// server/db/ddl/builds/2026-11-24-events4.js · EVENTS-4. A TICKET CAN BE FREE.
//
// On part7's DDL session (schema.js ddlSession): a short lock_timeout and a
// retry, so an ALTER never queues in front of reads.
//
//   event_levels price   was CHECK (price > 0), so a $0 ticket could not be
//                        saved. A ticket may now be $0 (free: registering for it
//                        writes no gift, server/events/freeTickets.js); a
//                        sponsorship is still more than $0. The old check is
//                        found by its definition, not its generated name, and
//                        dropped only after the new one is in place. Every row
//                        already saved has price > 0, so it passes the new one.
// No row is written here.
async function run(pool) {
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_event_levels_price') THEN
      ALTER TABLE event_levels ADD CONSTRAINT ck_event_levels_price CHECK (price >= 0 AND (kind <> 'sponsor' OR price > 0));
    END IF; END $$`);
  const old = await pool.query(`SELECT conname FROM pg_constraint
     WHERE conrelid = 'event_levels'::regclass AND contype = 'c' AND conname <> 'ck_event_levels_price'
       AND pg_get_constraintdef(oid) ~ '^CHECK \\(\\(price > \\(?0'`);
  for (const r of old.rows || []) await pool.query(`ALTER TABLE event_levels DROP CONSTRAINT IF EXISTS "${String(r.conname).replace(/"/g, "")}"`);
}

module.exports = { run };
