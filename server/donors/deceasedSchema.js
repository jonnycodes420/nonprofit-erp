// server/donors/deceasedSchema.js · PEOPLE-1. The schema init's part for this
// build, called from db.js initSchema like dates1Schema: new columns and
// tables only, each IF NOT EXISTS, no row changes.
//   donors.deceased_note / deceased_remind / deceased_marked_*   the dialog's answers, and who marked them
//   deceased_marks        one row per "Mark as deceased", with what it closed, so Undo can put it back
//   tasks.closed_reason   "Closed: marked deceased" on an ask that closed with them
//   cultivation_plans.end_reason   'deceased' on a journey that ended with them
"use strict";

async function deceasedSchema(pool) {
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_note TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_remind BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_marked_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_marked_by TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_marked_by_name TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_reason TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS end_reason TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS deceased_marks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      died_on TEXT,
      before_date TEXT,
      closed_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      closed_thread_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ended_plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ended_enrollment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      memorial_task_id TEXT,
      undone_at TIMESTAMPTZ,
      undone_by TEXT,
      undone_by_name TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deceased_marks_donor ON deceased_marks (org_id, donor_id) WHERE undone_at IS NULL`);
}

module.exports = { deceasedSchema };
