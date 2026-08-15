-- MIGC (Mission Increase Gulf Coast client website) tables — 2026-08-12.
-- Run once against the production Postgres (Supabase SQL editor or psql).
-- routes/migc.js also runs these same statements idempotently at first use,
-- so local/scratch/CI environments need no manual step; this file is the
-- reviewed record of the schema and the way to apply it to prod explicitly.
--
-- All three tables are intentionally standalone: no foreign keys into any
-- Steward table, no org_id — the MIGC client site is a separate product
-- surface that only shares the deployment.

CREATE TABLE IF NOT EXISTS migc_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  org TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migc_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migc_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT,
  location TEXT,
  description TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The only query shape the site uses: published events by date.
CREATE INDEX IF NOT EXISTS idx_migc_events_published_date
  ON migc_events (date) WHERE is_published;
