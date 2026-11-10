// server/donors/notesAtSchema.js · FLOWS-4 (W-1109-Atlas-02X). The schema
// init's part for this build, called from server/db/ddl/part7.js: one new
// column and one trigger, each IF NOT EXISTS / OR REPLACE, no row changes.
//   donors.notes_at   when the record's notes field was last written, so the
//                     profile's Notes banner can date a stored note ("Mar 2025
//                     note: …") instead of showing it as today's fact.
// The trigger stamps it on every write that changes `notes`, whichever door
// wrote it (the edit form, an import, Atlas, a merge), so no route has to
// remember. Existing rows keep NULL; the banner then dates the note by the
// day the record was made, which is the earliest it can have been written.
"use strict";

async function notesAtSchema(pool) {
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS notes_at TIMESTAMPTZ`);
  await pool.query(`CREATE OR REPLACE FUNCTION donors_stamp_notes_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF COALESCE(NEW.notes, '') <> '' AND NEW.notes_at IS NULL THEN NEW.notes_at := NOW(); END IF;
      ELSIF NEW.notes IS DISTINCT FROM OLD.notes AND NEW.notes_at IS NOT DISTINCT FROM OLD.notes_at THEN
        NEW.notes_at := CASE WHEN COALESCE(NEW.notes, '') = '' THEN NULL ELSE NOW() END;
      END IF;
      RETURN NEW;
    END $$`);
  const [t] = (await pool.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'donors_notes_at' AND tgrelid = 'donors'::regclass`)).rows;
  if (!t) await pool.query(`CREATE TRIGGER donors_notes_at BEFORE INSERT OR UPDATE OF notes ON donors FOR EACH ROW EXECUTE FUNCTION donors_stamp_notes_at()`);
}

module.exports = { notesAtSchema };
