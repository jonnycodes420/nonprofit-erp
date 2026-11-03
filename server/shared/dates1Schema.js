// server/shared/dates1Schema.js · DATES-1. The schema init's part for this
// build, called from db.js initSchema like setup.ensureSchema: new columns and
// tables only, each IF NOT EXISTS, no row changes.
//   donors.about_them        the short note read first on the profile (500 at most)
//   journey_start_skips      who a yearly-date journey did not start on its day, and why
//   journey_batches          many people put into one journey from the Donors list
//   cultivation_plans.batch_id  the batch that started a plan, so one Undo stops them all
async function dates1Schema(pool) {
  // DATES-1 · who a yearly-date journey did not start on its day, and why,
  // once per person per year (the journey's stats count these).
  await pool.query(`CREATE TABLE IF NOT EXISTS journey_start_skips (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      sentence TEXT,
      on_day TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, template_id, donor_id, event_key)
    )`);
  // DATES-1 · many people put in one journey at once from the Donors list:
  // one row per batch, so one Undo stops every journey it started, for 30 days.
  await pool.query(`CREATE TABLE IF NOT EXISTS journey_batches (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_name TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      asked INT NOT NULL DEFAULT 0,
      done INT NOT NULL DEFAULT 0,
      started INT NOT NULL DEFAULT 0,
      skipped INT NOT NULL DEFAULT 0,
      skip_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      donor_ids JSONB,
      plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      join_others BOOLEAN NOT NULL DEFAULT TRUE,
      job_id TEXT,
      error TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      undone_at TIMESTAMPTZ,
      undone_by TEXT,
      undone_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_journey_batches_org ON journey_batches (org_id, created_at DESC)`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS batch_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS about_them TEXT`);
  await pool.query(`DO $$ BEGIN
    ALTER TABLE donors ADD CONSTRAINT donors_about_them_len CHECK (about_them IS NULL OR char_length(about_them) <= 500);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
}

module.exports = { dates1Schema };
