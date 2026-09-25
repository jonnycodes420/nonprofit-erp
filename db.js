require("dotenv").config();
const { Pool } = require("pg");
const { randomUUID: uuid } = require("crypto");
const bcrypt = require("bcryptjs");
const orgTime = require("./orgTime"); // BUILD-75 A.5 — seed dates are CIVIL dates in the default org timezone, never UTC slices of the process clock

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Default keeps prod behavior (Supabase requires SSL). DB_SSL=disable turns it
  // off for a plain, non-SSL Postgres — the stock image CI uses (BUILD-38 Part 2).
  ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false },
});

async function getDb() {
  await initSchema();
  // The demo seed must never take the API down: schema is required to serve,
  // org_creo's demo sugar is not. A seed failure logs CRITICAL and the server
  // boots anyway (found live 2026-08-05: a seed 23505 crash-looped boot).
  try { await seedData(); }
  catch (err) { console.error("[seed] CRITICAL: demo seed failed (server continues):", err.message); }
  return pool;
}

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ... positional params
async function query(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

async function run(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return { changes: result.rowCount };
}

// Transaction helper — acquire a dedicated client, run fn(client) inside BEGIN/COMMIT
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// BUILD-27 Part C — serialize a critical section per key across concurrent
// requests using a Postgres SESSION-level advisory lock on a DEDICATED pooled
// client (acquire + release MUST be the same session). Different keys proceed in
// parallel; the same key serializes. Used to make check-then-insert dedup
// (parallel imports, the webhook donor resolve-or-create) race-safe WITHOUT a hard
// unique constraint — donor emails are legitimately non-unique in this product
// (the duplicate-merge tool exists precisely for that), so a UNIQUE(email) is the
// wrong primitive; an advisory lock closes the race without forbidding dupes or
// risking boot failure on already-duplicated data.
async function withAdvisoryLock(key, fn) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [String(key)]);
    return await fn();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]); } catch {}
    client.release();
  }
}

// Like query() / run() but bound to a specific pg client (for use inside withTransaction)
function queryTx(client, sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => r.rows);
}
function runTx(client, sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return client.query(pgSql, params).then(r => ({ changes: r.rowCount }));
}

// BUILD-54 §1 — schema-init fast path. initSchema is ~280 sequential DDL
// statements; against a remote Postgres that's a 40–70s "Database initializing"
// 503 window on EVERY deploy. The schema is fully determined by this file's
// contents, so a hash of db.js is a faithful schema version: unchanged file →
// the DDL is a guaranteed no-op → skip it. Any edit to db.js (i.e. any
// migration) changes the hash and the full init runs exactly once, then the
// new hash is stored. SCHEMA_INIT_FORCE=1 overrides the skip (break-glass,
// e.g. after manual DDL surgery in Supabase).
const SCHEMA_HASH = require("crypto")
  .createHash("sha256")
  .update(require("fs").readFileSync(__filename))
  .digest("hex");

async function schemaUnchanged() {
  if (process.env.SCHEMA_INIT_FORCE === "1") return false;
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const r = await pool.query(`SELECT schema_hash FROM schema_meta WHERE id = 1`);
  return r.rows.length > 0 && r.rows[0].schema_hash === SCHEMA_HASH;
}

async function initSchema() {
  if (await schemaUnchanged()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mission TEXT,
      ein TEXT,
      onboarding_complete INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'staff',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS donors (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'new',
      stage TEXT DEFAULT 'cultivate',
      total_giving INTEGER DEFAULT 0,
      last_gift_amount INTEGER DEFAULT 0,
      last_gift_date TEXT,
      gift_count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id),
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'cash',
      campaign TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id),
      type TEXT NOT NULL,
      note TEXT,
      date TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      funder TEXT NOT NULL,
      program TEXT,
      amount INTEGER DEFAULT 0,
      received INTEGER DEFAULT 0,
      status TEXT DEFAULT 'prospecting',
      deadline TEXT,
      report_due TEXT,
      officer TEXT,
      notes TEXT,
      history TEXT DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS volunteers (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT,
      hours INTEGER DEFAULT 0,
      skills TEXT DEFAULT '[]',
      last_active TEXT,
      donor_id TEXT,
      convert_potential TEXT DEFAULT 'medium',
      employer TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      title TEXT NOT NULL,
      due TEXT,
      priority TEXT DEFAULT 'medium',
      type TEXT DEFAULT 'donor',
      done INTEGER DEFAULT 0,
      donor_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS board_members (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      role TEXT DEFAULT 'Member',
      employer TEXT,
      term TEXT,
      giving_level TEXT,
      committees TEXT DEFAULT '[]',
      attendance INTEGER DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS financials (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      individual INTEGER DEFAULT 0,
      grants INTEGER DEFAULT 0,
      events INTEGER DEFAULT 0,
      other_revenue INTEGER DEFAULT 0,
      programs INTEGER DEFAULT 0,
      admin INTEGER DEFAULT 0,
      fundraising INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS funds (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      restricted INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      user_id TEXT,
      type TEXT,
      prompt_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      type TEXT DEFAULT 'appeal',
      subject TEXT DEFAULT '',
      body TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      segment TEXT DEFAULT '{}',
      sent_at TIMESTAMPTZ,
      recipient_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      donor_id TEXT REFERENCES donors(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      budget INTEGER DEFAULT 0,
      spent INTEGER DEFAULT 0,
      staff TEXT DEFAULT '[]',
      participant_count INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      outcomes TEXT DEFAULT '',
      metrics TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS program_grants (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      program_id TEXT REFERENCES programs(id) ON DELETE CASCADE,
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      allocated INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (program_id, grant_id)
    );

    CREATE TABLE IF NOT EXISTS annual_fund_goals (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      year INTEGER NOT NULL,
      goal INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, year)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'staff',
      invited_by TEXT,
      accepted_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Invitation-pivot (2026-08-06): the public "Request an invitation" form on
  // the landing + /invitation page. NOT the staff-invite system (that's
  // `invites` above) — these are prospective founding-partner orgs writing in.
  // Rows are read by a human (Jonathan), never rendered back into the app.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitation_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      organization TEXT NOT NULL,
      role TEXT,
      donor_band TEXT,
      hardest_part TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_interactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      note TEXT,
      date TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_host TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_user TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_pass TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_from TEXT`);

  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_score INTEGER DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS capacity_tier TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_confidence TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_last_updated TIMESTAMPTZ DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_rationale TEXT DEFAULT NULL`);

  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_to_name TEXT DEFAULT NULL`);

  // BUILD-58 Part 2 — deceased / do-not-contact are FIRST-CLASS flags, not
  // discarded import columns. deceased blocks ALL outbound donor mail;
  // do_not_contact blocks marketing only (donorMailDecision in server.js is
  // the one enforcement point). Import maps them; the profile shows them.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN DEFAULT false`);
  // BUILD-77 Part 1 — the flag FAMILY, not one flag. A real export's contact
  // preferences are per-channel (an org that mails but does not call is
  // normal), and the state lives in free text ("DO NOT SOLICIT", "Removed
  // from mailing - do not contact", "d. Nov 2023") that the importer now
  // scans into these fields. Semantics: do_not_solicit = no ASKS (drift
  // list, re-engage, suggested outreach, ask-automations) but stewardship/
  // newsletters may continue; do_not_mail/do_not_email are channel blocks;
  // deceased_date is display/history (deceased itself blocks everything).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS do_not_solicit BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS do_not_mail BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS do_not_email BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deceased_date TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address TEXT`);
  // BUILD-77 Part 5 — the sustainer's THIRD state. "Recurring" used to mean
  // "has a Stripe subscription object", which made every IMPORTED sustainer
  // invisible to the entire recurring surface (card credentials do not move
  // between processors — nobody can import a live authorization). unlinked =
  // sustainer history, no authorization here; these carry the historical
  // cadence so the reconnect flow can prefill it.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_sustainer BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_sustainer_amount NUMERIC`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_sustainer_last_gift TEXT`);

  // NOTE: an old boot-time backfill here auto-assigned EVERY unassigned donor to
  // the org's first admin. Removed (pipeline-is-a-portfolio FIX): assignment is a
  // deliberate act, and auto-assigning the whole base is exactly what dumped
  // 1,490 imported donors onto the working board.
  //
  // BUILD-30 — `in_pipeline` is RETIRED (dormant column). It was a SECOND board-
  // membership state that drifted from `assigned_to` (Home counted assignment,
  // the board counted in_pipeline → "Portfolio: 16" over an empty board). The ONE
  // definition is now ASSIGNMENT: a donor assigned to an officer IS in that
  // officer's portfolio AND on their pipeline board (server `portfolioMembership`
  // helper). Nothing reads or writes in_pipeline anymore. The physical column is
  // kept (not dropped) to avoid a destructive live-prod migration — it just holds
  // frozen historical values nobody reads. Do NOT reintroduce a separate flag.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS in_pipeline BOOLEAN DEFAULT false`);
  // The Pipeline board reads assigned donors, org-scoped, often by owner — see the
  // supporting index below. NOTE: it references donors.deleted_at, added further
  // down (see "ADD COLUMN IF NOT EXISTS deleted_at"); the index is created there,
  // after that column exists, so a FRESH schema init doesn't fail.

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stripe_payment_link TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS campaign_id TEXT`);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_slug TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT`);

  // Backfill slugs for existing orgs (safe to re-run)
  await pool.query(`
    UPDATE orgs
    SET org_slug = REGEXP_REPLACE(LOWER(TRIM(name)), '[^a-z0-9]+', '-', 'g') || '-' || SUBSTRING(id FROM 5 FOR 6)
    WHERE org_slug IS NULL
  `);

  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS requirements TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS attachments TEXT DEFAULT '[]'`);

  // ── Finance module ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_funds (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      restricted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_transactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor_donor TEXT DEFAULT '',
      amount NUMERIC NOT NULL,
      type TEXT NOT NULL,
      account_id TEXT REFERENCES accounts(id),
      fund_id TEXT REFERENCES fin_funds(id),
      notes TEXT DEFAULT '',
      receipt_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      account_id TEXT REFERENCES accounts(id),
      year INTEGER NOT NULL,
      amount NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, account_id, year)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      changes JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failure_reason TEXT`);

  // ── Email sequences ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_stage TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id TEXT PRIMARY KEY,
      sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      delay_days INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id TEXT PRIMARY KEY,
      sequence_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      next_send_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      UNIQUE(sequence_id, donor_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      options JSONB,
      required BOOLEAN DEFAULT false,
      field_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_field_values (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(donor_id, field_id)
    )
  `);

  // ── BUILD-78 — custom fields, grown up ─────────────────────────────────────
  // The definitions table is the ONLY authority on shape (spec 1.2); values
  // live in a custom_fields JSONB column ON the donor/gift row (1.1 — the EAV
  // custom_field_values table above is legacy, migrated once by
  // customFields.js migrateLegacyCustomFields and never read again).
  // `key` is generated once at creation and IMMUTABLE forever; `label` is what
  // a human sees and is never used as an identifier anywhere.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_field_defs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT 'donor',
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      options JSONB DEFAULT '[]',
      position INTEGER DEFAULT 0,
      show_in_directory BOOLEAN DEFAULT false,
      archived_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, entity, key)
    )
  `);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS custom_fields JSONB`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS custom_fields JSONB`);
  // Part 9 — the audit trail: definition changes are their OWN event type,
  // distinguishable from value writes; every event carries an actor identity.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_field_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      field_id TEXT,
      entity_id TEXT,
      event TEXT NOT NULL,
      detail JSONB DEFAULT '{}',
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cf_events_org ON custom_field_events (org_id, created_at DESC)`);
  // BUILD-78 Part 4.4 — saved import mappings store FIELD IDS, never labels:
  // rename every label and a re-imported file still resolves to the same
  // fields (asserted by the golden suite: rename-all, re-import, zero new).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_field_mappings (
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      header_norm TEXT NOT NULL,
      field_id TEXT NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, entity, header_norm)
    )
  `);

  // One-shot data-migration markers (hash-keyed schema init re-runs the whole
  // file on any edit; data moves must not re-run on donors that have since
  // diverged).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_flags (
      flag TEXT PRIMARY KEY,
      done_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS focus_area TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS annual_budget TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS founded_year INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS website TEXT`);

  // ── Super admin ───────────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false`);

  // ── SaaS billing ─────────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial'`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
  // Platform billing customer is per Stripe MODE: a cus_… created in live mode
  // doesn't exist under a test key. stripe_customer_id holds the LIVE customer
  // (existing prod values are live); the test-mode customer lives here. Switching
  // STRIPE_BILLING_SECRET_KEY between test/live uses the matching column.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_customer_id_test TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing'`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ`);

  // ── Gmail integration ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      history_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `);
  // Deleted Gmail-synced interactions land here so syncGmail's dedup step
  // never re-inserts them — without this, deleting a synced email only lasts
  // until the next 15-minute sync pass.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_sync_exclusions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, gmail_message_id)
    )
  `);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS metadata JSONB`);
  await pool.query(`ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS show_in_directory BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  // Pipeline board / portfolio membership index (BUILD-30: membership = ASSIGNMENT).
  // Created here because its WHERE clause references deleted_at, which only exists
  // as of this line. Covers the board query (assigned donors, org-scoped, by owner)
  // and Home's Portfolio/Pipeline card counts, which now share one definition.
  await pool.query(`DROP INDEX IF EXISTS idx_donors_pipeline`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_pipeline ON donors(org_id, assigned_to) WHERE assigned_to IS NOT NULL AND deleted_at IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Events ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      date DATE NOT NULL,
      end_date DATE,
      location TEXT,
      description TEXT,
      capacity INTEGER,
      status TEXT DEFAULT 'upcoming',
      revenue NUMERIC DEFAULT 0,
      cost NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_attendees (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      donor_id TEXT REFERENCES donors(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT,
      status TEXT DEFAULT 'invited',
      gift_amount NUMERIC,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id, donor_id)
    )
  `);

  // ── MGO toolkit pt 2 ─────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS briefing TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS goal_amount NUMERIC`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS raised_amount NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date DATE`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date DATE`);
  // BUILD-16 Part 2 — typed, multiple, roll-up fundraising goals. goal_category
  // classifies a goal'd campaign (annual/project/capital); parent_goal_id lets a
  // campaign roll up under an overarching goal (another campaigns row). Both
  // nullable → un-set is identical to the pre-BUILD-16 single-goal behavior.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS goal_category TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS parent_goal_id TEXT`);
  // ── BUILD-54 §2 — donor-facing campaign content, org-authored ONLY (never
  // generated, never estimated). donor_facing_name labels the donor's gift
  // history; donor_story is SANITIZED STRUCTURED TEXT (validated block array —
  // {type:'p'|'h2'|'ul', ...} — never raw HTML/CSS/JS; see validateStoryBlocks
  // in server.js). hero_image_url rides the BUILD-51 asset seam (kind
  // 'campaign'). goal_progress_public is the per-campaign donor-visible
  // thermometer OPT-IN — default OFF; when ON a donor sees goal/raised/percent
  // and NEVER donor counts or other donors' gifts.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS donor_facing_name TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS donor_description TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS donor_story JSONB`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hero_image_url TEXT`);
  // BUILD-65 Part 3 — non-destructive crop for the campaign hero (the BUILD-61
  // banner-crop library extended to this slot). hero_crop is a normalized
  // {x,y,w,h} against the ORIGINAL; hero_focal_{x,y} is the fallback when no
  // crop is set. Bytes are never touched.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hero_crop TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hero_focal_x REAL DEFAULT 0.5`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hero_focal_y REAL DEFAULT 0.5`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS goal_progress_public BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS logged_by_name TEXT`);

  // ── MGO toolkit ───────────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS zip TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US'`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS planned_giving BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS fund_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS payment_method TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS acknowledgement_sent BOOLEAN DEFAULT false`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planned_gifts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      estimated_value NUMERIC,
      date_indicated DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_materials (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_url TEXT,
      file_data TEXT,
      notes TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Email suppression (unsubscribe / bounce / complaint) ────────────────────
  // org_id NULL = global suppression (bounce/complaint — protects shared sending
  // domain reputation across every org). org_id set = that org's donor opted out
  // of that org's mail only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_suppressions_email ON email_suppressions (email)`);

  // ── Sample data flag ──────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  // BUILD-13 Tasks resurrection: owner/assignee (defaults to creator) + updated_at.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_name TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_org_donor ON tasks(org_id, donor_id)`);
  // BUILD-13 Part 2 org branding (tasteful white-label): base64 logo data-URI,
  // one accent color (normalized to an accessible range on save, see
  // branding.js), and the derived readable foreground for text-on-accent.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS logo_data TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS brand_accent TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS brand_accent_fg TEXT`);
  // BUILD-13 Part 3 — Workflows engine. Stored as DATA (trigger + conditions +
  // actions) so a future visual builder is a UI over this same schema, not a
  // rewrite. v1 exposes only the pre-built recipes (recipe_key). config holds
  // light per-recipe overrides (threshold / email template / owner).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      recipe_key TEXT,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      conditions JSONB DEFAULT '[]',
      actions JSONB DEFAULT '[]',
      config JSONB DEFAULT '{}',
      enabled BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Append-only run log + the idempotency guarantee: UNIQUE(workflow_id,
  // dedup_key) makes re-processing the same trigger event a no-op.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
      recipe_key TEXT,
      trigger TEXT,
      dedup_key TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      donor_id TEXT,
      actions_taken JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_dedup_uk ON workflow_runs(workflow_id, dedup_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workflows_org_trigger ON workflows(org_id, trigger, enabled)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON workflow_runs(org_id, created_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS workflows_org_recipe_uk ON workflows(org_id, recipe_key)`);
  // BUILD-24 — platform-billing (Steward's OWN subscription) webhook idempotency.
  // Stripe redelivers/retries subscription events routinely; the /billing/webhook
  // handler reserves the event id here BEFORE mutating org plan/status, so a
  // redelivered event is a strict no-op (same discipline as the donation
  // payment_intent guard, BUILD-23, and workflow_runs). event_id is the Stripe
  // event id (evt_…), globally unique on Steward's platform account. This is the
  // PLATFORM account's events only — connect/donation events go through the
  // separate /stripe/webhook endpoint and never touch this table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_webhook_events (
      event_id TEXT PRIMARY KEY,
      type TEXT,
      org_id TEXT,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  // BUILD-09 Finance reintegration: link a ledger row back to the donor it
  // came from (nullable — expenses/manual entries have none) and record how it
  // entered the ledger so the unified Transactions view can badge it
  // (online=Stripe webhook, gift=donor-profile log, import=bulk gift import,
  // manual=direct ledger entry). Existing rows default to 'manual'.
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS donor_id TEXT`);
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  // BUILD-21 Part 3 — the gift this ledger row was auto-stamped from (nullable;
  // manual/expense/grant rows have none). The invariant is "every gift stamps
  // fin_transactions exactly once" — a partial UNIQUE index over gift_id makes
  // that DB-enforced, so no path (donor-profile log, import, Stripe webhook,
  // event gift) can ever double-insert. Gift-stamp inserts use
  // ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING.
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS gift_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_txns_gift ON fin_transactions (gift_id) WHERE gift_id IS NOT NULL`);
  // Finance entity-routing FIX (2026-08-04) — the grant this ledger row books
  // the award income for (nullable; gifts/manual/expense rows have none). Same
  // invariant family as gift_id: "a grant award stamps the ledger exactly
  // once", DB-enforced by a partial UNIQUE so the award path can never
  // double-insert (re-award after un-award, redundant PUTs, or a manual row
  // adopted as the award stamp). Award inserts use
  // ON CONFLICT (grant_id) WHERE grant_id IS NOT NULL DO NOTHING.
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS grant_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_txns_grant ON fin_transactions (grant_id) WHERE grant_id IS NOT NULL`);
  // BUILD-27 Part C (scenario 2): the Stripe payment_intent id is the natural
  // per-charge key — one payment_intent = one online gift, ALWAYS. The webhook's
  // old check-then-insert dedup on stripe_payment_id lost the race under a PARALLEL
  // redelivery (both handlers SELECT-nothing, both INSERT → a doubled online gift +
  // ledger row, since each racer minted a different gift_id so uq_fin_txns_gift
  // couldn't catch it). This DB-level unique makes the exactly-once guarantee win
  // under a real race: the webhook now INSERTs ON CONFLICT DO NOTHING and only runs
  // the money side-effects if a row was actually reserved. Safe by construction —
  // two real gifts never share a Stripe pi.id.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gifts_stripe_pi ON gifts (org_id, stripe_payment_id) WHERE stripe_payment_id IS NOT NULL`);
  // BUILD-45 (portal) §1.1 F-3 — gift idempotency at the DATABASE, not app-layer.
  // Every non-webhook gift-create path takes a client-generated idempotency key
  // (the webhook's key is stripe_payment_id, guarded above). A double-tapped
  // Save, a double-submitted portal form, or a replayed request lands on the
  // partial unique and produces exactly one gift row.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gifts_idem ON gifts (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);

  // §1.2 F-4 — an import file's explicit external-ID column (gift/transaction id
  // from the source CRM) is the ONLY safe cross-run gift dedup key. (date,
  // amount, donor) alone is never a dedup key — forty $100 Sunday gifts are
  // forty gifts.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gifts_external ON gifts (org_id, external_id) WHERE external_id IS NOT NULL`);
  // §1.2 F-5 — pledge payments are LINKED to their pledge so the paid amount is
  // DERIVED (Σ gifts WHERE pledge_id), never a stored counter — same invariant
  // as every other money figure. Backfill from the legacy single-payment model
  // (pledges.fulfilled_gift_id) so history keeps its linkage.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS pledge_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_pledge ON gifts (pledge_id) WHERE pledge_id IS NOT NULL`);
  await pool.query(`UPDATE gifts g SET pledge_id = p.id FROM pledges p WHERE p.fulfilled_gift_id = g.id AND g.pledge_id IS NULL`).catch(() => {});
  // BUILD-58 Part 3 (boundary drill) — a disputed gift is an ordinary event
  // that no build had handled: the money is held pending resolution, so the
  // gift is FLAGGED (loud, never silent) on charge.dispute.created and
  // REVERSED like a refund only if the org LOSES. dispute_status ∈
  // needs_response | under_review | won | lost.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ DEFAULT NULL`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS dispute_status TEXT DEFAULT NULL`);
  // BUILD-65 Part 7 — a LOST dispute reverses the gift (deletes it), but a
  // dispute can be won BACK on appeal (charge.dispute.funds_reinstated). Without
  // a record of what was reversed, the gift/ledger/receipt could never be
  // restored. This holds the snapshot needed to reinstate: keyed on the
  // payment_intent (the reversal's natural id), consumed on reinstatement.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dispute_reversals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      stripe_payment_id TEXT NOT NULL,
      dispute_id TEXT,
      gift_snapshot JSONB NOT NULL,
      receipt_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, stripe_payment_id)
    )`);
  await pool.query(`ALTER TABLE fin_funds ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE board_members ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);

  // ── Stewardship: giving milestones & impact reporting ───────────────────
  // Org-configured "at this cumulative amount, here's what it funded" copy.
  // dollar_threshold doubles as the "cost per unit of impact" used to compute
  // {n} in outcome_template (e.g. threshold=300 + donor total=1200 -> n=4).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS impact_metrics (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dollar_threshold NUMERIC NOT NULL,
      outcome_template TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Milestones are computed from existing donor/gift data rather than stored
  // as their own events — first_gift_date is the one field that isn't cleanly
  // derivable from gifts alone (donors bulk-imported via the basic /donors/import
  // route get total_giving/gift_count set directly with no individual gifts
  // rows at all, so MIN(gifts.date) is NULL for them). Backfilled below.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS first_gift_date TEXT`);
  await pool.query(`
    UPDATE donors d
    SET first_gift_date = COALESCE(
      (SELECT MIN(g.date) FROM gifts g WHERE g.donor_id = d.id),
      d.last_gift_date
    )
    WHERE d.first_gift_date IS NULL
      AND (EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = d.id) OR d.last_gift_date IS NOT NULL)
  `);

  // Stores which specific milestone (threshold/anniversary) an enrollment
  // represents, so the sequences engine can tell a genuinely new milestone
  // apart from one already handled — see autoEnroll()'s 'milestone' branch.
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS metadata JSONB`);

  // AI-drafted milestone emails land here for staff review before sending —
  // deliberately not auto-sent. See processSequences()'s 'milestone' branch.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS milestone_drafts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      sequence_enrollment_id TEXT,
      milestone_key TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'pending_review',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      reviewed_by TEXT,
      sent_at TIMESTAMPTZ
    )
  `);

  // Personal-note reminders — the non-AI-drafted sibling of milestone_drafts.
  // Major milestones/anniversaries get a "write a note" nudge with real,
  // computed talking points instead of a drafted email; see isNoteMoment()
  // and computeNoteTalkingPoints() in server.js. No note content is ever
  // generated or stored here — talking_points are reference facts only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_reminders (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      sequence_enrollment_id TEXT,
      milestone_key TEXT,
      talking_points JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      sent_by TEXT
    )
  `);

  // Org-scoped fundraising goal for the home screen's goal banner. Only one
  // is "active" at a time — GET /goals/active picks the most recently
  // created row whose period contains today, so creating a new one that
  // overlaps today effectively replaces the prior active goal without
  // needing a delete/deactivate step.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fundraising_goals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      goal_type TEXT NOT NULL,
      goal_amount NUMERIC NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Generic daily snapshot store for computed "name the vague anxiety as a
  // number" metrics (see CLAUDE.md design patterns) — shared by
  // stewardship_debt, first_touch_delay, and any future metric of the same
  // shape, rather than a bespoke history table per metric. One row per
  // (org, metric, day); re-snapshotting the same day updates in place.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      value NUMERIC NOT NULL,
      snapshot_date TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(org_id, metric_key, snapshot_date)
    )
  `);

  // ── Recurring gift recovery (failed-payment dunning) ────────────────────
  // Needed to build a Stripe Checkout "setup" session for a donor's card
  // without asking them to log in — see GET /recurring/update-card.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);

  // Pending officer assignment (FIX 2026-07-28) — an import can route a donor to
  // an officer who's only been INVITED, not yet accepted (no users row exists).
  // We hold the assignment against the invite here (assigned_to stays NULL, the
  // donor is NOT yet on anyone's board) and resolve it on /auth/invite/accept:
  // the new user's portfolio is populated the moment they log in. pending_name
  // is the display label ("assigned to Jonathan · pending") until then.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS pending_assignee_invite_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS pending_assignee_name TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_pending_assignee ON donors (org_id, pending_assignee_invite_id)`);

  // Org-level kill switch + optional per-org override of the dunning email
  // copy, mirroring how campaign/sequence templates are editable text with
  // {{token}} placeholders rather than code. NULL subject/body = use the
  // built-in default template (see DEFAULT_DUNNING_TEMPLATE in server.js).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS recurring_dunning_enabled BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS recurring_dunning_subject TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS recurring_dunning_body TEXT`);

  // Donor-covers-fees (BUILD-08 Phase B): org-level switch for the optional
  // "add a little to cover processing costs" checkbox on the public donate
  // flow. DEFAULT true = on for new setups; the donor-side checkbox itself
  // always defaults to unchecked, so nothing is ever added silently. The
  // gross-up math lives server-side in POST /donate (never trusted from the
  // client) — see coverFeesGrossUpCents in server.js.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS cover_fees_enabled BOOLEAN DEFAULT true`);

  // Gift money columns were INTEGER (whole dollars) since the original
  // schema — any cents-carrying online gift (a $50.50 custom amount, or any
  // covered-fees total like $51.81) made the webhook's gift INSERT throw
  // "invalid input syntax for type integer" and the gift was silently lost
  // (Stripe got a 200, so no retry). Found live by the Phase B suite.
  // Guarded DO blocks: ALTER TYPE takes an exclusive lock + table rewrite,
  // so only run it while the column is still integer, not on every boot.
  for (const [tbl, col] of [["gifts", "amount"], ["donors", "total_giving"], ["donors", "last_gift_amount"]]) {
    await pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}' AND data_type='integer') THEN
        ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE NUMERIC USING ${col}::numeric;
      END IF;
    END $$;`);
  }

  // BUILD-73 Part 2 — CENTS, AT THE DATABASE. The migration above stopped these
  // columns being INTEGER, which is what made cents storable; it left them
  // unconstrained NUMERIC, which stores $33.333 just as happily as $33.33.
  // Money has exactly two decimal places, so the column says so. NUMERIC(12,2)
  // is arbitrary-precision decimal — not a float — and it is the last line of
  // defence behind money.js: if a future write path is added that skips the
  // seam, the database rounds to the cent rather than accepting sub-cent noise
  // that no invariant would ever catch.
  //
  // 12 digits total = up to $9,999,999,999.99, comfortably above any gift and
  // any org's lifetime total. Guarded on numeric_scale so the table rewrite
  // runs once, not on every boot (the same reason the block above is guarded).
  // The production audit (audit/BUILD-73-FINDINGS.md) confirmed ZERO rows carry
  // sub-cent values, so this rewrite cannot change a single stored figure.
  for (const [tbl, col] of [
    ["gifts", "amount"], ["gifts", "cover_fee_amount"], ["gifts", "deductible_amount"],
    ["donors", "total_giving"], ["donors", "last_gift_amount"],
    ["pledges", "amount"], ["fin_transactions", "amount"],
    ["recurring_subscriptions", "amount"],
  ]) {
    await pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}'
                   AND data_type='numeric' AND numeric_scale IS DISTINCT FROM 2) THEN
        ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE NUMERIC(12,2) USING ROUND(${col}::numeric, 2);
      END IF;
    END $$;`);
  }

  // One row per donor subscription — a health record layered on top of the
  // donors.stripe_subscription_id/stripe_subscription_status columns (which
  // already existed for the "active" happy path). This table is what actually
  // tracks a failure through its lifecycle: how many times it's failed, where
  // it is in the dunning cadence, and when it resolved (recovered or lost).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_subscriptions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      stripe_subscription_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      amount NUMERIC,
      interval TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      failure_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at TIMESTAMPTZ,
      last_failed_at TIMESTAMPTZ,
      recovered_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      dunning_step INTEGER NOT NULL DEFAULT 0,
      next_dunning_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_subs_dunning ON recurring_subscriptions (status, next_dunning_at)`);

  // ── (2026-09-11) THE CARD THAT IS GOING TO DIE, BEFORE IT DIES ───────────
  // Everything in the recovery engine until now started at
  // `invoice.payment_failed` — i.e. after the gift had already been lost and
  // the donor had already received an apology. Card expiry is the most
  // predictable cause of involuntary churn and the one thing that can be seen
  // coming, so these columns hold what Stripe knows about the card on file.
  //
  // It has to be a POLL, not a webhook: Stripe's `customer.source.expiring`
  // fires only for legacy Card/Source objects and explicitly does NOT occur
  // for PaymentMethod integrations, which is what Steward uses (setup-mode
  // Checkout → setupIntent.payment_method). Verified in Stripe's own event
  // reference, not assumed.
  //
  // `card_checked_at` is the re-read budget (a card is re-read at most every
  // CARD_RECHECK_DAYS); `card_expiry_notified_for` holds the 'YYYY-MM' of the
  // expiry already warned about, so one notice per card per expiry — a card
  // updated by the network clears it and becomes eligible again.
  for (const col of [
    ["card_payment_method_id", "TEXT"],   // lets payment_method.automatically_updated find its subscription
    ["card_brand", "TEXT"], ["card_last4", "TEXT"],
    ["card_exp_month", "INTEGER"], ["card_exp_year", "INTEGER"],
    ["card_checked_at", "TIMESTAMPTZ"], ["card_expiry_notified_for", "TEXT"],
  ]) await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS ${col[0]} ${col[1]}`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_subs_card_check
                      ON recurring_subscriptions (status, card_checked_at)
                    WHERE status IN ('active','past_due','recovering')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_subs_card_pm
                      ON recurring_subscriptions (card_payment_method_id)
                    WHERE card_payment_method_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_subs_donor ON recurring_subscriptions (org_id, donor_id)`);

  // ── BUILD-57 Part 1 — the staff recurring-giving surface ────────────────
  // recurring_change_log is the append-only movement ledger behind the MRR
  // waterfall (new / upgraded / downgraded / paused / resumed / voluntary vs
  // involuntary churn). Every subscription state change writes one row at the
  // moment it happens — the waterfall is a read-time SUM over this log, never
  // a stored counter. Separating involuntary (card failure) from voluntary
  // (donor chose to stop) churn is the point of the whole surface; the KIND
  // is decided at write time when the context is known, not inferred later.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_change_log (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      subscription_id TEXT,
      donor_id TEXT,
      kind TEXT NOT NULL,
      old_amount NUMERIC,
      new_amount NUMERIC,
      sub_interval TEXT,
      actor TEXT,
      actor_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_change_org ON recurring_change_log (org_id, created_at)`);

  // recurring_proposals — staff-initiated changes a DONOR must complete.
  // Anything that can move money (create / amount / frequency / card update)
  // is an invitation: staff propose, the donor completes via a tokenized
  // public link (token stored hash-at-rest, portal-magic-link discipline).
  // Proposals expire after 14 days and can be resent exactly once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_proposals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      subscription_id TEXT,
      kind TEXT NOT NULL,
      proposed_amount NUMERIC,
      proposed_interval TEXT,
      proposed_fund_id TEXT,
      token_hash TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_by_name TEXT,
      resend_count INTEGER NOT NULL DEFAULT 0,
      resent_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_proposals_org ON recurring_proposals (org_id, status)`);

  // BUILD-77 Part 6 — the reconnect ledger. One row per reconnect link sent
  // to an imported (unlinked) sustainer; the recovery numbers on the
  // recurring surface come from these REAL rows, never an estimate.
  // reconnected_at + new_subscription_id are stamped by the webhook when the
  // donor completes checkout and their new subscription stitches to the
  // EXISTING donor record (BUILD-73's rule: money is at risk until the
  // charge settles — reconnected_at means the subscription exists, and the
  // monthly-back figure counts only settled amounts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reconnect_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      historical_amount NUMERIC,
      historical_interval TEXT DEFAULT 'month',
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      sent_by TEXT,
      reconnected_at TIMESTAMPTZ,
      new_subscription_id TEXT,
      reconnected_amount NUMERIC,
      UNIQUE(org_id, donor_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reconnect_sends_org ON reconnect_sends (org_id)`);

  // Append-only log of everything that happens to a subscription's payment
  // health — the source of truth for recovery-rate math (recovered vs. lost
  // over a trailing window) and for webhook idempotency: stripe_event_id is
  // checked before processing so a redelivered Stripe event is a no-op.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_recovery_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT,
      subscription_id TEXT,
      type TEXT NOT NULL,
      stripe_event_id TEXT,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recovery_events_stripe_id ON payment_recovery_events (stripe_event_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recovery_events_org ON payment_recovery_events (org_id, created_at)`);

  // ── Case-insensitive email lookups (2026-07-13) ──────────────────────────
  // users.email was only ever compared exactly (WHERE email = lower($1)) —
  // lowercasing the *input* but not the *stored* value. A row saved with any
  // uppercase (e.g. a manual insert, or before this fix existed) silently
  // failed every lookup: /auth/forgot-password returned {success:true} with
  // no email sent, /auth/login returned "Invalid credentials." Normalize
  // existing rows once, guarded against a case-insensitive collision that
  // would violate the new unique index below.
  const emailDupes = await pool.query(`
    SELECT lower(btrim(email)) AS norm, COUNT(*) AS c
    FROM users
    GROUP BY lower(btrim(email))
    HAVING COUNT(*) > 1
  `);
  if (emailDupes.rows.length) {
    console.error(
      "[db] Skipping email-normalization migration — case-insensitive duplicate emails found, resolve manually:",
      emailDupes.rows.map(r => r.norm)
    );
  } else {
    await pool.query(`UPDATE users SET email = lower(btrim(email)) WHERE email <> lower(btrim(email))`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uk ON users (lower(email))`);
  }

  // ── Donor-to-donor relationships (2026-07-14) ────────────────────────────
  // employer was already tracked on volunteers/board_members but not donors —
  // added directly on the donor record (independent of any relationship link)
  // so matching-gift potential can be tracked even for a donor with no linked
  // household. Manual linking only — see donor_relationships below.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS employer TEXT`);

  // One row per relationship; order of donor_id_a/donor_id_b doesn't matter —
  // callers query both directions. relationship_type is free text at the DB
  // layer (spouse|household|family|employer_match are the ones the UI
  // offers) rather than an enum, matching this codebase's existing
  // convention of validating free-text stage/status columns in the app
  // layer, not via a CHECK constraint.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_relationships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id_a TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      donor_id_b TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_rel_a ON donor_relationships (org_id, donor_id_a)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_rel_b ON donor_relationships (org_id, donor_id_b)`);

  // BUILD-80 Part 6.2 — every merge the IMPORTER makes is reviewable and
  // reversible: the surviving donor, the identity variants that folded into
  // it (with their gift external ids), and the reason. Undo re-creates the
  // folded identity and moves its gifts back.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_merges (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id) ON DELETE CASCADE,
      surviving TEXT NOT NULL,
      folded JSONB NOT NULL,
      undone_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_merges_org ON import_merges (org_id)`);

  // BUILD-87 Part 1 — EVERY IMPORT RUN GETS A ROW, AND THE ROW IS THE HISTORY.
  // Before this, an import existed only as a screen that disappeared when it
  // was closed: no name, no date, no way to answer "what did we load in
  // March". The summary is the SAME read-back object the BUILD-83 receipt
  // computed at commit time, STORED — reopening the receipt must never
  // recompute it against a database that has moved on since.
  // `shape` is the file's detected shape ('workbook' | 'transaction' |
  // 'aggregate' | 'wide' | 'donors' | 'deposit'); BUILD-88's deposits are
  // imports with shape='deposit' and land here rather than in a second table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      source_filename TEXT,
      shape TEXT,
      started_at TIMESTAMPTZ,
      committed_at TIMESTAMPTZ DEFAULT NOW(),
      rows_in INTEGER DEFAULT 0,
      gifts_created INTEGER DEFAULT 0,
      donors_created INTEGER DEFAULT 0,
      donors_merged INTEGER DEFAULT 0,
      rows_set_aside INTEGER DEFAULT 0,
      rows_errored INTEGER DEFAULT 0,
      dollars_in NUMERIC(14,2) DEFAULT 0,
      dollars_created NUMERIC(14,2) DEFAULT 0,
      actor_user_id TEXT,
      actor_user_name TEXT,
      summary_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_imports_org ON imports (org_id, committed_at DESC)`);

  // BUILD-80 Part 6.1 — the source system's donor id, stored AS TEXT with
  // leading zeros kept (never grouped on when spreadsheet-damaged).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS external_donor_id TEXT`);
  // BUILD-80 Part 7 — organisations and the anonymous holding record are not
  // people: kind gates every person surface (drift, re-engage, attention).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS kind TEXT`);
  // BUILD-82 — the standard donor list is COMPLETE: every column a real CRM
  // export carries lands whole (middle/suffix/salutation/spouse/second email/
  // mobile/address 2/country/type/board), never split, dropped, or shunted to
  // a custom field. external_household_id is the SOURCE system's household
  // key (TEXT — the FK household_id belongs to Steward's own households).
  // external_donor_ids carries EVERY source id a record answers to after a
  // duplicate fold, so a gift posted to the folded id still finds its person.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS middle_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS suffix TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS salutation TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS spouse_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS email2 TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS mobile TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address2 TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS country TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS donor_type TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS board_member BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS external_household_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS external_donor_ids JSONB`);
  // BUILD-83 Part 3.5 — A PIPELINE STAGE IS A DECISION. Giving history can
  // SUGGEST one; it cannot make one. Everything inferred on import lands in
  // suggested_stage and `stage` stays NULL until a human places the donor, so
  // a funnel reading "Cultivate 3,143 · Solicit 926 · Steward 2,719" the minute
  // a file lands can say plainly that nobody decided any of it.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS suggested_stage TEXT`);
  // BUILD-84 P0-2 — an organization is a donor, and the person on its row is
  // the CONTACT on it, never the donor's name. `kind` (BUILD-80 Part 7) is the
  // donor type: 'person' | 'organisation' | 'anonymous'; NULL is a legacy row
  // whose kind was never recorded and is read as a person.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS contact_name TEXT`);

  // ── BUILD-84 P0-4 — GEOCODE ONCE AT WRITE TIME, NEVER AT RENDER ──────────
  // The Map used to geocode in the browser, one address per request, on every
  // render, storing nothing: minutes of crawl for 444 donors, unreachable at
  // 25,000, against a provider whose terms require caching and forbid
  // systematic queries — and it sent donor home addresses to a third party on
  // every page view. Coordinates are donor data now.
  //   geocode_status: 'pending' | 'ok' | 'no_address' | 'not_found' | 'failed'
  //   geocode_key:    the normalised address the coordinates belong to. A
  //                   record whose key is unchanged is NEVER looked up twice,
  //                   which is the provider's caching requirement satisfied by
  //                   construction rather than by a cache anyone has to trust.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS geocode_status TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS geocode_provider TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS geocode_key TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_geocode_pending ON donors (org_id) WHERE geocode_status = 'pending' AND deleted_at IS NULL`);
  // BUILD-80 Part 9 — derived surfaces must not outrun the import: the last
  // import's row/refusal counts and largest gifts, read by every headline
  // stat while refusals exceed 5% of rows.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS last_import_stats JSONB`);

  // ── BUILD-81 — THE THREAD ─────────────────────────────────────────────────
  // A thread is a donor plus an open next step. One open thread per donor
  // (partial unique index). The CHECK constraint is the structural guarantee
  // behind "no code path closes a thread without an outcome or a reason":
  // a closed row must be either an outcome (pointing at the interaction that
  // closed it) or a dismissal (carrying its reason) — the database refuses
  // anything else, not just the routes. "Revisit on [date]" is a SNOOZE on an
  // open thread (snoozed_until), deliberately not a close: the thread never
  // left, it just stops surfacing until that date.
  // donor_id cascades (import_merges precedent) so suite org-resets that
  // delete donors before orgs keep working without touching every list.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      next_step_type TEXT NOT NULL,
      next_step_label TEXT NOT NULL,
      due_date TEXT NOT NULL,
      opened_on TEXT NOT NULL,
      opening_interaction_id TEXT,
      opening_gift_id TEXT,
      owner_id TEXT,
      owner_name TEXT,
      created_by TEXT,
      created_by_name TEXT,
      followon_type TEXT,
      followon_label TEXT,
      followon_due TEXT,
      snoozed_until TEXT,
      closed_at TIMESTAMPTZ,
      close_kind TEXT,
      close_reason TEXT,
      closing_interaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT threads_close_honest CHECK (
        closed_at IS NULL
        OR (close_kind = 'outcome'   AND closing_interaction_id IS NOT NULL)
        OR (close_kind = 'dismissed' AND close_reason IS NOT NULL)
      )
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS threads_one_open ON threads (org_id, donor_id) WHERE closed_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_threads_org_open ON threads (org_id, due_date) WHERE closed_at IS NULL`);
  // Per-user nudge-email switch (default on — NULL is on, BUILD-36 pref
  // convention) and the org-level weekend toggle (default off: no weekend mail).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_thread_nudge BOOLEAN`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS thread_nudge_weekends BOOLEAN DEFAULT FALSE`);

  // ── BUILD-84 FEATURE — A TASK WITH A TIME ON IT EMAILS AT THAT TIME ───────
  // The next step's due field was a CIVIL DATE and nothing else (`due_date
  // TEXT NOT NULL`, every BUILD-81 default expressed as `+N days`), so there
  // was no 2:00 to fire at. Rather than convert due_date to a timestamptz —
  // which would drag every date-only task through a timezone it never had —
  // the time rides BESIDE it, nullable: `HH:MM` in the ORG's timezone, or
  // NULL for the date-only task that behaves exactly as it did yesterday.
  // Nothing to backfill by construction: every existing row is date-only and
  // stays date-only.
  await pool.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS due_time TEXT`);
  // Per-user switch for the timed reminder, same convention as the nudge
  // (NULL = on) and shown in the SAME notification settings list.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_step_reminder BOOLEAN`);
  // A timezone a HUMAN chose, distinct from the America/New_York default the
  // column carries so no read path has to cope with a null zone. A morning
  // digest forgives being an hour off; a 2:00 reminder does not, so the
  // feature is unavailable until this is stamped.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS timezone_confirmed_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_threads_org_timed ON threads (org_id, due_date, due_time) WHERE closed_at IS NULL AND due_time IS NOT NULL`);

  // ── BUILD-86 FIX — SNOOZE MOVES THE DUE DATE, AND KEEPS THE FIRST ONE ─────
  // BUILD-85 shipped with this named as a known gap: a "revisit"
  // dismissal set `snoozed_until` and left `due_date` where it was, so a
  // thread deliberately deferred for six months came back reading "overdue,
  // day 180", sorted to the top, and OWNED THE SUBJECT LINE of every morning
  // email. A number that is always big stops being a signal.
  //
  // The revisit now MOVES `due_date` to the chosen date, so "overdue" goes
  // back to meaning overdue. `original_due_date` keeps the day somebody first
  // committed to — the kind of fact this product does not throw away, and the
  // reason option (b) was chosen over simply overwriting. NULL means never
  // snoozed, so every pre-existing row is correct by construction with nothing
  // to backfill.
  await pool.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS original_due_date TEXT`);

  // ── BUILD-88a A.1 — ONE GIFT, ONE PATH ────────────────────────────────────
  // The timeline entry a gift produces LINKS to the gift instead of carrying a
  // copy of its amount in a sentence. The copy is why the Renee Castillo demo
  // record showed one $5,000 gift twice: the profile drew a "First gift $5,000"
  // milestone from the gift row AND a "Gift received: $5,000" line from an
  // interaction written beside it. A fact with two homes disagrees eventually;
  // this one disagreed immediately.
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS gift_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_gift ON interactions (gift_id) WHERE gift_id IS NOT NULL`);
  // The BUILD-83 posting rule, made a switch instead of a constant: import
  // history NEVER posts (that is not negotiable — it is what the org already
  // raised, not money moving through Steward), and a LIVE gift posts if the org
  // keeps it on. Default TRUE, which is exactly what every org does today, so
  // nobody's books move on deploy.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ledger_posting_enabled BOOLEAN DEFAULT true`);
  // ── BUILD-88a A.6 — GIVING, NOT REVENUE ───────────────────────────────────
  // Steward counts contributions. An organisation with a bookshop, tickets or
  // programme fees has real income Steward does not hold, and a board screen
  // that says "Revenue" invites it to be read as everything. The figure lives
  // here only if somebody typed it, it is shown on its OWN line under giving,
  // and it is never summed into giving — half of that sum would come from gifts
  // Steward holds and half from a number nobody here can check.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS other_income_enabled BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS other_income_this_year NUMERIC`);

  // ── BUILD-88a A.5 — A BOOLEAN CANNOT ANSWER "THIS WEEK" ───────────────────
  // `gifts.acknowledgement_sent` is a flag with no date, so "thank-yous marked
  // sent this week" was unanswerable: the fact was recorded and the moment was
  // thrown away. The stamp is written wherever the flag is set. Rows that were
  // already true carry no date and are counted in NO week, which the Week in
  // Review's definition says out loud rather than quietly folding them into the
  // first week after the deploy.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS acknowledgement_sent_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_ack_at ON gifts (org_id, acknowledgement_sent_at) WHERE acknowledgement_sent_at IS NOT NULL`);

  // ── BUILD-88a A.3 — A BUDGET HAS A FUND ───────────────────────────────────
  // A budget was (account, year, amount). An org that restricts money keeps
  // separate budgets per fund — $60,000 of contributions to the Building
  // Campaign is a different commitment from $60,000 unrestricted, and one row
  // could not hold both. `fund_id` is nullable: no fund means the whole
  // account, which is every budget that already exists. The uniqueness moves
  // with it (COALESCE so a NULL fund is one slot, not infinitely many).
  await pool.query(`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS fund_id TEXT`);
  await pool.query(`ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_org_id_account_id_year_key`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS budgets_account_year_fund
                      ON budgets (org_id, account_id, year, COALESCE(fund_id, ''))`);

  // ── BUILD-88b B.1 — A FUND ANSWERS TO MORE THAN ONE NAME ──────────────────
  // A deposit slip's memo line says "Xenia", "Xenia UMC" or "for Xenia trip";
  // the fund is called "Xenia Mission Trip". The aliases are the org's own —
  // typed once, on the fund — because a memo that matches no fund is a question
  // for a human, and NEVER quietly General. A guessed designation is an audit
  // finding.
  await pool.query(`ALTER TABLE fin_funds ADD COLUMN IF NOT EXISTS aliases JSONB`);
  // The org's unrestricted DEFAULT, set deliberately. A blank memo goes here
  // only if somebody chose one; with nothing chosen a blank memo is Needs you,
  // because "we do not know" is not the same as "unrestricted".
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS default_fund_id TEXT`);

  // ── BUILD-88b B.1 — THE DEPOSIT, REVERSIBLE AS A WHOLE ────────────────────
  // A deposit is one act: a slip that footed. Undoing it is also one act, for
  // twenty-four hours, because a slip keyed wrong is discovered the same day
  // and unpicking eleven gifts by hand is how a total stops matching.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_import ON gifts (org_id, import_id) WHERE import_id IS NOT NULL`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS reversed_by TEXT`);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS created_import_id TEXT`);

  // ── BUILD-88b B.3 — THANK-YOUS, DRAFTED ───────────────────────────────────
  // Steward never sends the thank-you. It writes one and puts it in a queue she
  // opens; Copy, Mark sent, Skip. One row per gift, so the queue cannot
  // double-count and a skip is a decision on the record rather than an absence.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thank_you_drafts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      gift_id TEXT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      voice TEXT,
      opened_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      skipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, gift_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ty_open ON thank_you_drafts (org_id, created_at DESC) WHERE sent_at IS NULL AND skipped_at IS NULL`);
  // Her voice, from three samples she pastes in Settings. Until they exist the
  // default is one plain sentence — never an invented voice.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS voice_samples JSONB`);
  // ── BUILD-88b B.2 — THE DRAFT A THREAD CARRIES ────────────────────────────
  // A late pledge instalment opens a thread with a note already written in her
  // voice. It rides ON the thread because the thread is the thing she opens,
  // and a draft in a second place is a draft she never sees. Steward does not
  // send it: she copies it and it leaves from her own mail.
  await pool.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS draft_note TEXT`);

  // ── BUILD-88c C.1 — HER OWN DOMAIN ────────────────────────────────────────
  // Every donor-facing email has left through `stewardapp.dev` with the org's
  // NAME in the display slot (BUILD-64) — which closes the "bare unfamiliar
  // domain" trust gap and does nothing about the other one: an unfamiliar
  // SENDING domain costs deliverability, and on a shared domain one org's spam
  // complaints drag down every other org's reputation. This is the other half
  // (the per-org sending-domain shape, built).
  //
  // The state machine is deliberately small: a domain, Resend's id for it, the
  // records the org must publish, a status, and the moment it verified. An org
  // with nothing here sends on the Steward domain exactly as before — nobody is
  // ever blocked from sending by a DNS record they have not published yet.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain_id TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain_status TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain_records JSONB`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain_verified_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_domain_checked_at TIMESTAMPTZ`);
  // The address the donor sees. It is a PERSON's, at the org's own domain,
  // because a reply to an appeal should reach the person who sent it.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sending_from_email TEXT`);
  // A DOMAIN BELONGS TO ONE ORG. Not a per-org uniqueness — a GLOBAL one, at
  // the database, because the whole point of authenticating a domain is that
  // mail from it is cryptographically that organisation's. Two orgs claiming
  // one domain is the tenant boundary failing in the one place a customer's
  // donors would see it.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_orgs_sending_domain
                      ON orgs (LOWER(sending_domain)) WHERE sending_domain IS NOT NULL`);
  // BACKFILL, once and idempotently: every gift timeline entry already written
  // is linked to the gift it was about, WHERE THERE IS EXACTLY ONE CANDIDATE
  // (same org, same donor, same date, and the amount the sentence named). An
  // ambiguous match is left alone — a wrong link is worse than an unlinked row,
  // and an unlinked row still renders correctly from the gift. Nothing is
  // deleted and no note is rewritten; the screen simply stops drawing the same
  // gift twice, which is what the copy in the text was causing.
  await pool.query(`
    UPDATE interactions i SET gift_id = m.gid
      FROM (
        SELECT i2.id AS iid, MIN(g.id) AS gid, COUNT(*) AS n
          FROM interactions i2
          JOIN gifts g ON g.org_id = i2.org_id AND g.donor_id = i2.donor_id AND g.date = i2.date
         WHERE i2.type = 'gift' AND i2.gift_id IS NULL
           AND i2.note ~ '^(Gift received|Online donation): \\$[0-9,.]+'
           AND round(g.amount::numeric, 2) = round(
                 replace(replace(substring(i2.note from '\\$([0-9,.]+)'), ',', ''), '$', '')::numeric, 2)
         GROUP BY i2.id
        HAVING COUNT(*) = 1
      ) m
     WHERE i.id = m.iid`).catch(e => console.error("[migrate] gift-interaction backfill:", e.message));

  // ── BUILD-86 PART B — HER WORDS ───────────────────────────────────────────
  // Sparrow has sponsors, not recurring donors. One JSON column on the org,
  // fixed keys (shared/vocabulary.js), holding ONLY what differs from today's
  // strings — so an org that answers nothing has an empty object rather than a
  // frozen copy of the defaults, and a later default change still reaches it.
  //
  // PRESENTATION ONLY. No column, id, API field or route is renamed by any
  // value in here; `donor_id` stays `donor_id` at a shop that says "sponsors".
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS vocabulary_json TEXT`);
  // Stamped when the five-question first run is answered OR skipped, so it is
  // offered exactly once and "skip" is a decision rather than a state that
  // keeps re-asking.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS vocabulary_set_at TIMESTAMPTZ`);

  // ── Giving Pages (2026-07-14) ────────────────────────────────────────────
  // Campaign-specific donation pages (gala/appeal/etc.), distinct from the
  // one org-wide /give/:orgSlug page. Deliberately NOT the `campaigns` table
  // — that's the email-campaign system (Communications module) and
  // gifts.campaign_id already links a gift to the *email* campaign that
  // drove it. giving_pages/gifts.giving_page_id is a fully independent
  // concept: which donation page a gift came through. slug is unique per
  // org (not globally) since the public URL is already namespaced by
  // org_slug: /give/:orgSlug/:pageSlug.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giving_pages (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      goal_amount NUMERIC,
      story TEXT,
      image_url TEXT,
      fund_id TEXT REFERENCES fin_funds(id),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS giving_pages_org_slug_uk ON giving_pages (org_id, slug)`);

  // Nullable, independent of the pre-existing gifts.campaign_id (email
  // campaign attribution) — a gift can be tagged with neither, either, or
  // both, since "which email got them here" and "which donation page they
  // gave through" are two different questions.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS giving_page_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_giving_page ON gifts (giving_page_id)`);

  // ── Pledges (2026-07-15) ──────────────────────────────────────────────────
  // A donor's promise to give $X by a future date. Previously had no schema
  // at all — "Gifts & Pledges" was only a UI tab label; `gifts` only ever
  // represents money already received (no due date/promised-status), and
  // `planned_gifts` is a different concept entirely (bequests/trusts/
  // annuities — long-horizon legacy giving indications, no due date). This
  // is the minimal model needed to identify a "promised, unfulfilled, due
  // date passed" record — just enough for the reminder cadence below to
  // have something to query, not a full pledge-management system.
  //
  // reminder_step/next_reminder_at/first_overdue_at deliberately mirror
  // recurring_subscriptions' dunning_step/next_dunning_at/first_failed_at
  // shape (see processDunning() in server.js, the template for
  // processPledgeReminders()) — same fixed-offset-from-first-event cadence
  // math, pledge-appropriate naming since there's no "failure" here, just a
  // due date passing unfulfilled.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pledges (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id),
      amount NUMERIC NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      fulfilled_gift_id TEXT REFERENCES gifts(id),
      fulfilled_at TIMESTAMPTZ,
      first_overdue_at TIMESTAMPTZ,
      reminder_step INTEGER NOT NULL DEFAULT 0,
      next_reminder_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pledges_org_donor ON pledges (org_id, donor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pledges_reminder ON pledges (status, next_reminder_at)`);
  // BUILD-72 Part 2 — the same seam on PLEDGES. A pledge is a money row on a
  // screen a finance person reads, and it had no idempotency at all: two
  // genuinely concurrent identical creates produced two pledges (Part 0 finding
  // 0.2b). Same shape as gifts: a client-minted key, unique per org, partial so
  // legacy and keyless rows are unaffected.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_pledges_idem ON pledges (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);

  // MOVED HERE, and it must stay here: this block was written beside the rest
  // of BUILD-88b's schema work, ~180 lines BEFORE the pledges table is created.
  // On an existing database that is invisible; on a FRESH one the FK to
  // pledges(id) does not resolve, the create throws, and the server never
  // finishes booting — which is exactly what CI does on every push.
  // ── BUILD-88b B.1/B.2 — A PLEDGE HAS INSTALMENTS ──────────────────────────
  // A pledge was one amount and one due date, so "the March instalment arrived"
  // had nowhere to land and a twelve-month pledge could only ever be all or
  // nothing. Instalments are rows: a due date, an amount, and the gift that
  // paid it. Created here (B.1) because the deposit sheet matches against them;
  // B.2 is what makes them keep themselves.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pledge_installments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      pledge_id TEXT NOT NULL REFERENCES pledges(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      paid_gift_id TEXT REFERENCES gifts(id) ON DELETE SET NULL,
      paid_at TIMESTAMPTZ,
      reminder_thread_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (pledge_id, seq)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pl_inst_org_due ON pledge_installments (org_id, due_date) WHERE paid_gift_id IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pl_inst_pledge ON pledge_installments (pledge_id)`);
  // A pledge that states a cadence but no schedule can generate one; a SHELL
  // pledge (BUILD-88a A.7, inferred from payments) states neither and says so.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS frequency TEXT`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS installment_count INTEGER`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS is_shell BOOLEAN DEFAULT false`);

  // BUILD-72 Part 3 — a donor who OVERPAYS a pledge is a good problem, and the
  // money must still appear. The old code clamped the balance to 0 and the
  // surplus vanished from every pledge surface. It is now recorded.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS surplus_amount NUMERIC NOT NULL DEFAULT 0`);
  // ...and every EXISTING row is recomputed once, so no pledge carries a status
  // or a surplus that drifted from its payment total before this build. Status
  // is derived from the payments, exactly as pledgeStatusFor() does at runtime;
  // written_off / cancelled are never resurrected by arithmetic.
  await pool.query(`
    WITH paid AS (
      SELECT p.id,
             p.amount::numeric                              AS amount,
             COALESCE(SUM(g.amount), 0)::numeric            AS paid
        FROM pledges p
        LEFT JOIN gifts g ON g.pledge_id = p.id AND g.org_id = p.org_id
       GROUP BY p.id, p.amount
    )
    UPDATE pledges pl
       SET status = CASE
             WHEN pl.status IN ('written_off','cancelled') THEN pl.status
             WHEN paid.amount > 0 AND paid.paid >= paid.amount THEN 'fulfilled'
             ELSE 'open'
           END,
           surplus_amount = CASE
             WHEN pl.status IN ('written_off','cancelled') THEN pl.surplus_amount
             WHEN paid.amount > 0 AND paid.paid > paid.amount THEN ROUND(paid.paid - paid.amount, 2)
             ELSE 0
           END
      FROM paid
     WHERE paid.id = pl.id
       AND (pl.status IS DISTINCT FROM CASE
              WHEN pl.status IN ('written_off','cancelled') THEN pl.status
              WHEN paid.amount > 0 AND paid.paid >= paid.amount THEN 'fulfilled'
              ELSE 'open'
            END
         OR pl.surplus_amount IS DISTINCT FROM CASE
              WHEN pl.status IN ('written_off','cancelled') THEN pl.surplus_amount
              WHEN paid.amount > 0 AND paid.paid > paid.amount THEN ROUND(paid.paid - paid.amount, 2)
              ELSE 0
            END)
  `);
  // §1.2 F-4 — an import file's explicit external-ID column (gift/transaction id
  // from the source CRM) is the ONLY safe cross-run gift dedup key. (date,
  // amount, donor) alone is never a dedup key — forty $100 Sunday gifts are
  // forty gifts.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS external_id TEXT`);
  

  // due_date was briefly a real DATE column, which node-pg serializes with a
  // full timestamp ("2026-07-05T00:00:00.000Z") — inconsistent with every
  // other date-like column in this schema (gifts.date, grants.deadline,
  // etc. are all TEXT for exactly this reason). Fixes any row already
  // created under the old column type; a no-op once already TEXT.
  await pool.query(`ALTER TABLE pledges ALTER COLUMN due_date TYPE TEXT USING to_char(due_date::date, 'YYYY-MM-DD')`).catch(() => {});

  // Same org-level kill switch + template-override shape as
  // recurring_dunning_enabled/subject/body — no dedicated Settings UI for
  // either (recurring dunning's overrides have never had one), just the
  // same code-level fallback-to-default pattern.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pledge_reminder_enabled BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pledge_reminder_subject TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pledge_reminder_body TEXT`);

  // ── Peer-to-peer fundraising (2026-07-15) ─────────────────────────────────
  // A supporter starts their own personal fundraiser under an org's Giving
  // Page — turning one donor-facing page into many supporter-facing ones.
  // Every peer_fundraiser belongs to exactly one giving_pages row (no
  // standalone fundraiser concept); ON DELETE CASCADE reflects that — a
  // fundraiser cannot outlive its parent campaign. slug is unique per
  // giving_page_id (not globally), same reasoning as giving_pages.slug being
  // unique per org: the public URL is already namespaced by
  // /give/:orgSlug/:pageSlug/:fundraiserSlug. No account/password system —
  // edit_token is a long random value (same shape as invites.token) mailed
  // to the supporter as their entire "auth" for managing the page later.
  // org_id is denormalized from giving_page_id (redundant with the join to
  // giving_pages) on purpose — CLAUDE.md's "Org_id scoping (security)"
  // convention is "AND org_id = ? on SELECT, UPDATE, DELETE" directly on the
  // scoped table itself. Without this column, every route touching
  // peer_fundraisers has to remember the extra JOIN to enforce org
  // isolation; with it, a future query that filters only by org_id (the
  // codebase-wide muscle-memory pattern) is correct by default instead of
  // silently crossing org boundaries if someone forgets the join.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS peer_fundraisers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      giving_page_id TEXT NOT NULL REFERENCES giving_pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      slug TEXT NOT NULL,
      personal_goal_amount NUMERIC,
      story TEXT,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      edit_token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS peer_fundraisers_page_slug_uk ON peer_fundraisers (giving_page_id, slug)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_peer_fundraisers_org ON peer_fundraisers (org_id)`);

  // Nullable, alongside the existing gifts.giving_page_id — a peer-fundraiser
  // gift always carries BOTH (see server.js /donate/:orgSlug), which is what
  // makes rollup free: the parent page's SUM(amount) WHERE giving_page_id=?
  // already includes every peer gift with zero extra aggregation. No FK
  // constraint, mirroring giving_page_id's own "tolerated dangling
  // reference" pattern (see CLAUDE.md "Admin data integrity") — a gift given
  // through a since-deleted fundraiser simply keeps an id that no longer
  // resolves.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS peer_fundraiser_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_peer_fundraiser ON gifts (peer_fundraiser_id)`);

  // ── Tax Receipting & Year-End Giving Statements (2026-07-16) ─────────────
  // US-only v1 (IRC §170(f)(8), IRS Pub 1771) — see CLAUDE.md "Tax
  // receipting" for the full design + explicit non-goals (no CRA/Canadian
  // receipts, no in-kind gifts, no auto-receipting historical/imported
  // gifts, no donor-facing retrieval portal).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS legal_name TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ein TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_address TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_signature_name TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_signature_title TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_custom_message TEXT`);
  // Org-level switch — server refuses to flip this true unless legal_name,
  // ein, and receipt_address are all already present (enforced in
  // PATCH /orgs/:id, not just a DB default).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipts_enabled BOOLEAN DEFAULT false`);

  // ── INCIDENT 2026-09-22 — AN ORG-LEVEL OFF SWITCH FOR OUTBOUND MAIL ──────
  // On 22 September a demo org sent real pledge reminders to real mailboxes,
  // and a freshly provisioned org sent a founder drip and a Week in Review —
  // built entirely from invented data — to a real prospect. There was no way
  // to stop one organisation's mail without stopping everyone's, so the only
  // lever available on the night was the Resend key itself.
  //
  // `emails_enabled` is that lever, per org. It defaults TRUE so no existing
  // customer goes quiet on deploy; it is set FALSE for any org born of a seed
  // or a provisioning run (see is_demo_org below).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS emails_enabled BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN emails_enabled SET DEFAULT true`);
  await pool.query(`UPDATE orgs SET emails_enabled = true WHERE emails_enabled IS NULL`);

  // What an org IS, rather than what it may do. A demo org is one whose data
  // is invented: a seed script's org, or one provisioned for a prospect who
  // has not signed in yet. Kept separate from emails_enabled deliberately —
  // "this org is fiction" is a fact that outlives any switch, and a human
  // turning mail back on for a demo org should have to say so explicitly
  // rather than have the distinction quietly erased.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS is_demo_org BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN is_demo_org SET DEFAULT false`);
  await pool.query(`UPDATE orgs SET is_demo_org = false WHERE is_demo_org IS NULL`);
  // Per-org sequence for receipt numbers, always incremented via
  // UPDATE ... RETURNING (never SELECT MAX+1 — see allocateReceiptNumber()
  // in server.js) so two concurrent issues can never collide on a number.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_counter INTEGER DEFAULT 0`);

  // (BUILD-75 C.1/C.3 columns are added at the END of initSchema — every
  // table must exist first; the early placement broke a FRESH database's
  // first boot in CI while the warm scratch DB hid it.)

  // deductible_amount is null for the common case ("equals amount"); only
  // set when it genuinely differs from gifts.amount, i.e. a quid pro quo gift.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS deductible_amount NUMERIC`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS quid_pro_quo_desc TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS quid_pro_quo_value NUMERIC`);

  // One receipt per gift (type='gift', gift_id set) or one per donor+tax_year
  // (type='year_end', gift_id null — a statement consolidates many gifts,
  // it isn't tied to any single one). `snapshot` freezes the org's legal
  // info + line items at issue time so an already-issued receipt never
  // silently changes meaning if org settings are edited later.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id),
      gift_id TEXT REFERENCES gifts(id),
      type TEXT NOT NULL DEFAULT 'gift',
      tax_year INTEGER,
      receipt_number TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      deductible_amount NUMERIC NOT NULL,
      snapshot JSONB NOT NULL,
      pdf_data TEXT,
      sent_to TEXT,
      sent_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      void_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Partial-unique — one ACTIVE (non-voided) receipt per gift, and one
  // active statement per donor+tax_year. Voiding + reissuing (see
  // POST /receipts/:id/void) is the only way to correct a mistake — an
  // issued receipt row is never updated in place, since it's a legal
  // artifact and the whole point of `snapshot`/`pdf_data` is that they
  // reflect exactly what was actually sent.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS receipts_active_gift_uk ON receipts (gift_id) WHERE voided_at IS NULL AND type = 'gift'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS receipts_active_statement_uk ON receipts (org_id, donor_id, tax_year) WHERE voided_at IS NULL AND type = 'year_end'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receipts_org_donor ON receipts (org_id, donor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receipts_org_tax_year ON receipts (org_id, tax_year)`);

  // ── Reports (2026-07-16) ─────────────────────────────────────────────────
  // GET /reports/:key aggregates entirely in SQL — these cover the period
  // scans (org+date), the by-group rollups (org+fund / org+campaign), and
  // the LYBUNT/SYBUNT donor-side ordering (org+last_gift_date).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_date ON gifts (org_id, date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_fund ON gifts (org_id, fund_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_campaign ON gifts (org_id, campaign_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_last_gift ON donors (org_id, last_gift_date)`);

  // ── Load-test pass (BUILD-05, 2026-07-16) — see LOADTEST_REPORT.md ────────
  // interactions had NO index beyond its pkey: every per-donor timeline fetch,
  // stewardship-debt/first-touch aggregate, and Gmail dedup probe was a full
  // seq scan (150k rows × 25k donors at tested scale). gifts had org-scoped
  // indexes only — per-donor paths (profile fetch, recalcDonorSummary after
  // import, lapsed-recovery goal math) scanned the whole table per donor.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_donor_date ON interactions (donor_id, date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_org_donor_date ON interactions (org_id, donor_id, date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_donor_date ON gifts (donor_id, date)`);

  // ── Finance reintegration (BUILD-09) ─────────────────────────────────────
  // The unified Transactions ledger, summary, and budget-actuals all scan
  // fin_transactions by org over a date window; the fund filter/rollups scan
  // by (org, fund). Before this, fin_transactions had only its pkey — every
  // Finance load seq-scanned the table.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_txns_org_date ON fin_transactions (org_id, date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_txns_org_fund ON fin_transactions (org_id, fund_id)`);

  // ── Constituent model: households / designations / portfolios (BUILD-14) ──
  // Households group 2+ constituents (spouses/partners). HARD CREDIT NEVER
  // MOVES — donors.total_giving stays the SUM of that donor's OWN gifts, and
  // the org hard total is SUM(all gifts) regardless of grouping. A household
  // is purely a GROUP BY key over the same gift rows: "combined giving" =
  // SUM(gifts of all members), and a member's SOFT CREDIT = SUM(gifts of the
  // OTHER members). Both are DERIVED at read time — there is no stored
  // soft-credit counter anywhere, so soft credit can never double-count hard
  // totals. This invariant is the correctness crux; tests/households.test.js
  // proves org totals are byte-identical individual-vs-household.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      primary_donor_id TEXT,
      joint_acknowledgment BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_households_org ON households (org_id)`);
  // A donor belongs to at most one household. ON DELETE SET NULL: deleting a
  // household unlinks its members, never cascades into donor/gift data.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS household_id TEXT REFERENCES households(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_household ON donors (org_id, household_id)`);

  // First-class, filterable, reportable constituent designations — gift-vehicle
  // / planned-giving flags (estate, planned-confirmed, planned-prospect, major
  // prospect). Kept out of the free-form donors.tags JSONB precisely because
  // planned giving must be a queryable segment, not a stringly-typed tag.
  // UNIQUE(donor_id, kind) makes add idempotent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_designations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS donor_designations_uk ON donor_designations (donor_id, kind)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_designations_org_kind ON donor_designations (org_id, kind)`);

  // Officer portfolio color (Team plan) — each gift officer gets one assigned
  // color; donor lists/kanban color-code constituents by their owner. Nullable
  // = unset (falls back to a deterministic hue in the UI). Single-user orgs
  // never surface color UI at all.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_color TEXT`);

  // Per-user Home layout (BUILD-34) — the saved [{id,visible}] section config
  // behind Home's edit mode (reorder + show/hide, section-level only). JSON
  // text; NULL = the canonical default order. Per USER, deliberately not
  // per-org: admins don't control other users' layouts, and the preference
  // follows the user across devices because it lives here, not localStorage.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_layout TEXT`);

  // ── BUILD-36 A4: per-user email notification toggles ──────────────────────
  // An officer must hear about their donors and tasks without logging in, but
  // must also be able to turn any of the three notification streams off. Three
  // booleans, DEFAULT true (on for everyone unless deliberately turned off);
  // NULL is treated as ON by userWantsEmail (server.js) so pre-existing rows
  // and any missed default keep receiving mail.
  //   notify_portfolio_gifts   — "a gift landed for a donor I own / in my org"
  //   notify_task_assignments  — "someone assigned me a task"
  //   notify_daily_tasks       — the daily due/overdue task reminder digest
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_portfolio_gifts BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_task_assignments BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_daily_tasks BOOLEAN DEFAULT true`);

  // BUILD-38 Part 1 — session revocation. A JWT issued before this timestamp is
  // rejected by requireAuth (auth.js). Bumped to now() on password reset/change,
  // role change, removal, and deactivation, killing all of that user's live
  // sessions within the auth cache TTL. NOTE: adding it stamps every existing
  // row with now(), so already-issued tokens are invalidated on first deploy —
  // a one-time forced re-login, which is the correct behavior for this rollout.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ NOT NULL DEFAULT now()`);

  // ── BUILD-35: "Set up Steward" activation checklist card state ────────────
  // The card's ITEMS are never stored — each done-state is computed live from
  // org data (donor count, stripe_account_id, receipt_address, live giving
  // page, enabled workflow, team members). Only the card's dismissal
  // preference persists, per ORG (admins share it): NULL = show while
  // incomplete, 'collapsed' = the small "Finish setup" chip, 'hidden' =
  // explicitly never show again.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_card_state TEXT`);
  // BUILD-92 B2 — the names an organisation typed into "Something else" on the
  // "Where giving comes in" page. Steward has no adapter for these and does not
  // pretend to: the name is recorded so the product knows what it is being
  // asked for, and the gifts come in through the ordinary statement import.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS other_giving_sources JSONB DEFAULT '[]'::jsonb`);
  // BUILD-79 Part 6 — "Import your donors" ticks only when gifts came with
  // them, or a human explicitly confirmed the file had none.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_no_gifts_confirmed BOOLEAN DEFAULT FALSE`);

  // ── BUILD-72 Part 4 — the organization's timezone ────────────────────────
  // Every date boundary in the product is computed in THIS zone: not the
  // server's, not the browser's, not UTC. Before this column existed, a task
  // due today began reading as "1 day overdue" at 20:00 EDT with nothing
  // changing but the wall clock (Part 0's live capture), because `todayStr`
  // was `new Date().toISOString()` — a UTC calendar date.
  //
  // IANA identifier, e.g. "America/New_York". Validated at the API boundary by
  // orgTime.isValidTimezone (Intl is the authority, not a hand-kept list).
  // NOT NULL with a default so no read path ever has to cope with a null zone.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS timezone TEXT`);
  await pool.query(`UPDATE orgs SET timezone = 'America/New_York' WHERE timezone IS NULL OR timezone = ''`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN timezone SET DEFAULT 'America/New_York'`);
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='orgs'
                    AND column_name='timezone' AND is_nullable='YES') THEN
        ALTER TABLE orgs ALTER COLUMN timezone SET NOT NULL;
      END IF;
    END $$;`);

  // ── Moves management & prospect pipeline (BUILD-15, Team plan) ────────────
  // The major-gifts spine. Reuses the existing donors.stage field as the
  // managed pipeline (no second stage column is forked). Every stage change
  // made through the pipeline board is a logged MOVE: officer, from→to, and a
  // REQUIRED description of what happened. This structured feed powers officer
  // activity reporting (BUILD-17) — which is why it's its own table rather
  // than stuffed into interactions.metadata JSONB (a stringly-typed tag can't
  // be aggregated per-officer cleanly). A stage_change interaction is still
  // logged alongside so the donor's activity timeline stays consistent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moves (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      officer_id TEXT,
      officer_name TEXT,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moves_org_donor ON moves (org_id, donor_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moves_org_officer ON moves (org_id, officer_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moves_org_created ON moves (org_id, created_at DESC)`);

  // Opportunities = ask vs. gift. Each solicitation on a prospect carries a
  // target ASK amount; when it closes 'won' the actual GIFT amount (and the
  // real gift row) are recorded. Pipeline forecast = SUM(target_amount) over
  // open opportunities (optionally weighted by the donor's stage). This is
  // officer accountability: asked for how much, closed how much.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      name TEXT,
      target_amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      gift_id TEXT,
      gift_amount NUMERIC,
      officer_id TEXT,
      officer_name TEXT,
      expected_close DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_donor ON opportunities (org_id, donor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_status ON opportunities (org_id, status)`);

  // ── BUILD-99 Part 1 — A PROPOSAL IS THIS TABLE WITH THE COLUMNS IT WAS
  // ALWAYS MISSING. See shared/proposalShape.js for why there is no second
  // `proposals` table: two ask amounts on one prospect is how a board report
  // goes wrong, and BUILD-30 is the write-up of the last time it did.
  //
  // `status` STAYS. Twenty BUILD-15/17/85/86 reads filter on it (the board's
  // ask totals, wonThisPeriod, officer activity, the four dashboards), and
  // `statusForStage` is the ONE derivation that keeps it honest — there is no
  // write path that sets a stage without setting the status from it.
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS proposal_stage TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS probability INTEGER`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS fund_id TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS decline_reason TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS declined_on TEXT`);
  // Committed writes a pledge OR a gift, NEVER both — `gift_id` was already
  // here, so this is its counterpart plus the word for which door was used.
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pledge_id TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS commit_kind TEXT`);
  await pool.query(`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  // ONE backfill, applied once, reasoned in stageFromLegacyStatus: BUILD-15's
  // own column comment calls target_amount "the ASK" and its UI is ask → gift
  // with Won/Lost buttons, so an open one is an ask that was made.
  await pool.query(
    `UPDATE opportunities SET proposal_stage =
       CASE status WHEN 'won' THEN 'committed' WHEN 'lost' THEN 'declined' ELSE 'asked' END
     WHERE proposal_stage IS NULL`);
  // THE STRUCTURAL FLOOR UNDER "ONE OPEN AT A TIME PER FUND", and the reason
  // it is attempted rather than asserted.
  //
  // BUILD-15 deliberately ALLOWED several open asks on one prospect. Those rows
  // exist, they were legitimate under the rule they were written under, and
  // every one of them now reads as an open proposal with no fund — so a bare
  // CREATE UNIQUE INDEX would throw on any org that has two, and the server
  // would never boot. Refusing to start over data somebody entered correctly
  // last month is not a guarantee, it is an outage.
  //
  // So: the WRITE PATH is where the rule actually lives, and it is atomic there
  // (an INSERT … WHERE NOT EXISTS in one statement, not a read-then-write). This
  // index is belt-and-braces on top, created when the org's existing rows
  // permit it, and when they do not the colliding donors are NAMED in the boot
  // log so somebody can close one — never silently skipped.
  //
  // COALESCE because a Postgres unique index treats NULLs as distinct, so "no
  // fund" — the most common case of all — would otherwise be unconstrained.
  // The stage list is spelled out rather than imported: db.js is CommonJS and
  // proposalShape.js is ESM, and a stale copy here fails the suite by name
  // (tests/build99-proposals.test.js asserts the two lists match).
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS opportunities_one_open_per_fund
         ON opportunities (org_id, donor_id, COALESCE(fund_id,''))
       WHERE proposal_stage IN ('identified','cultivating','asked')`);
  } catch (e) {
    const dupes = await pool.query(
      `SELECT org_id, donor_id, COUNT(*)::int AS n FROM opportunities
        WHERE proposal_stage IN ('identified','cultivating','asked')
        GROUP BY org_id, donor_id, COALESCE(fund_id,'') HAVING COUNT(*) > 1
        ORDER BY n DESC LIMIT 20`).catch(() => ({ rows: [] }));
    console.error("[proposals] one-open-per-fund index not created: " + e.message);
    for (const r of dupes.rows) console.error(`[proposals]   ${r.org_id} / ${r.donor_id}: ${r.n} open proposals on one fund`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_stage ON opportunities (org_id, proposal_stage)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_officer ON opportunities (org_id, officer_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_close ON opportunities (org_id, expected_close)`);

  // ── BUILD-99 (major gifts) Part 2 — PORTFOLIOS ────────────────────────────
  // A portfolio is not a new membership concept: BUILD-30 settled that
  // "assigned to an officer" IS "in that officer's portfolio" IS "on that
  // officer's board", one state and no flag. What was missing is what the
  // officer puts AROUND it — a target for the year and a count cap she chooses
  // — and the actor on the assignment itself.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_targets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      -- The org's own fiscal year, as its OPENING calendar year, so a July-start
      -- org's "2026-27" is stored as 2026 and orgPeriodBounds is the only
      -- thing that has to know which months that covers. (NB no backticks in
      -- here: a backtick inside a template literal ends it.)
      fiscal_year INTEGER NOT NULL,
      target_amount NUMERIC,
      count_cap INTEGER,
      created_by TEXT, created_by_name TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_targets ON portfolio_targets (org_id, user_id, fiscal_year)`);

  // WHO ASSIGNED THEM, AND WHEN. `assigned_to`/`assigned_to_name` have existed
  // since BUILD-14 and carried no actor, so "why is this person on my list"
  // had no answer on the row. NULL means the assignment predates this build —
  // never backfilled with a guess (the BUILD-75 actor rule).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_by TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_by_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`);

  // THE ORG SAYS WHAT "MAJOR PROSPECT" MEANS, IN ITS OWN MONEY. A threshold
  // Steward chose would be a claim about what a big gift is at an organisation
  // it knows nothing about — the BUILD-85 rule (money is relative to the org)
  // in a setting rather than a score. $1,000 is the DEFAULT, not the answer.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS major_prospect_cents INTEGER DEFAULT 100000`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN major_prospect_cents SET DEFAULT 100000`);

  // ── BUILD-99 (major gifts) Part 3 — CULTIVATION PLANS ─────────────────────
  // A plan is a SEQUENCE OF THREADS for one person, authored by the officer.
  // It does not fork the Thread engine: each step, when its turn comes, IS a
  // BUILD-81 thread, and the chaining rides the existing close paths.
  //
  // WHY THE STEPS ARE THEIR OWN TABLE AND NOT FOUR THREADS. `threads_one_open`
  // is a partial unique index: one open thread per donor, which is the promise
  // the whole surface rests on. Four threads would violate it on the second
  // step, and relaxing it would be a much larger change to a much older
  // guarantee. So a plan holds its steps, exactly one of them is OPEN and
  // carries a thread id, and the rest are PENDING — which is what the brief
  // asks for in its own words ("one open Thread and three pending").
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cultivation_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      -- [{ type, label, offsetDays }] — validated by shared/planShape.js before
      -- anything is stored, so a template cannot hold a step the Thread engine
      -- would refuse when its turn came.
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      archived_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_templates_org ON cultivation_templates (org_id) WHERE archived_at IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cultivation_plans (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      template_id TEXT,
      -- The template's NAME is copied, not joined: renaming or archiving a
      -- template must not rewrite what an applied plan says it was.
      template_name TEXT NOT NULL,
      applied_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',        -- active | done | abandoned
      owner_id TEXT, owner_name TEXT,
      created_by TEXT, created_by_name TEXT,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // ONE ACTIVE PLAN PER PERSON. Two plans would each be trying to hold the
  // donor's single open thread, and whichever lost would sit pending forever
  // looking like a bug.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cultivation_plans_one_active ON cultivation_plans (org_id, donor_id) WHERE status = 'active'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_plans_org ON cultivation_plans (org_id, status)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cultivation_plan_steps (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      plan_id TEXT NOT NULL REFERENCES cultivation_plans(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      label TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',       -- pending | open | done | skipped
      thread_id TEXT,
      closed_at TIMESTAMPTZ,
      closed_by TEXT, closed_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT cult_step_status CHECK (status IN ('pending','open','done','skipped'))
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cult_step_seq ON cultivation_plan_steps (plan_id, seq)`);
  // The OPEN step is the one holding the thread, and there may be only one per
  // plan — the structural half of "one open Thread and three pending".
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cult_step_one_open ON cultivation_plan_steps (plan_id) WHERE status = 'open'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_steps_thread ON cultivation_plan_steps (thread_id) WHERE thread_id IS NOT NULL`);

  // ── Development reporting cadence (BUILD-17) ─────────────────────────────
  // Append-only log of every digest email actually sent. The UNIQUE index on
  // (org_id, digest_type, period_key, recipient_user_id) is the idempotency
  // guarantee — the digest engine reserves a row (INSERT … ON CONFLICT DO
  // NOTHING RETURNING id) BEFORE sending, so re-running the 5-min tick within
  // the same week/month never double-sends. Same discipline as workflow_runs.
  // meta JSONB stores a small composition summary (section counts) for audit.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS digest_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      digest_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      recipient_email TEXT,
      scope TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS digest_sends_uk ON digest_sends (org_id, digest_type, period_key, recipient_user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_digest_sends_org ON digest_sends (org_id, created_at DESC)`);

  // ── BUILD-36 A4: one internal email per person per event ──────────────────
  // The idempotency + cross-recipe dedup ledger for INTERNAL staff
  // notifications (gift alerts, task-assignment emails). event_key is the
  // notification's natural cycle id: gift:<giftId> for anything a single gift
  // triggers (so gift-notify and the major-gift owner alert can NEVER both
  // email one person for the same gift — the whole point of A4), or
  // taskassign:<taskId>:<userId> for a manual task assignment. The UNIQUE
  // deliberately does NOT include channel: a person gets AT MOST ONE email per
  // (event, recipient), whichever recipe reserves first. notifyUserOnce()
  // (server.js) reserves the row BEFORE sending — same discipline as
  // workflow_runs / digest_sends. A pref opt-out reserves NOTHING (so a
  // different, opted-in notification for the same event can still win).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      channel TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_uk ON notification_sends (org_id, event_key, recipient_user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_sends_org ON notification_sends (org_id, created_at DESC)`);

  // BUILD-45 (fixes BUILD-44 F-2) — durable retry queue for internal-notification
  // sends that the email provider REJECTED. notifyUserOnce reserves the
  // notification_sends dedup row, sends, and on a real send failure RELEASES
  // that reservation and records the send here (with enough payload to retry).
  // A sweep on the existing 5-min tick re-attempts due rows and deletes them on
  // success; after MAX attempts a row is left as a permanent, surfaced record
  // (counted on /health). Before this, a failed send was reserved-to-silence
  // and lost forever — the class behind "the alert that never landed".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_failures (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      channel TEXT,
      subject TEXT,
      body_html TEXT,
      attempts INTEGER DEFAULT 1,
      last_error TEXT,
      next_retry_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_failures_due ON notification_failures (next_retry_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_failures_org ON notification_failures (org_id, created_at DESC)`);

  // ── Attribution completeness (FIX, 2026-08-04) ───────────────────────────
  // Every money path attributes to a campaign, reverses, and reconciles.
  // giving_pages.campaign_id — "gifts through this page count toward this
  // campaign". Optional (a general page stays unattributed). No FK — same
  // tolerated-dangling pattern as gifts.giving_page_id; org-scoped validation
  // lives in the POST/PUT routes.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  // BUILD-95 §5B — a giving page becomes a BUILT page. Same draft/published
  // split the portal has had since BUILD-54, and for the same reason: a page
  // half-rearranged at four in the afternoon must not be what a donor opens.
  //
  // These columns live on `giving_pages` rather than in a second table because
  // `portal_pages` is ONE row per org (org_id is its primary key) and giving
  // pages are many — so the portal's shape does not carry over, only its rule.
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS draft JSONB`).catch(() => {});
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS published JSONB`).catch(() => {});
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ`).catch(() => {});
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`).catch(() => {});
  // Where the donation form sits. NOT a widget: a giving page that can lose its
  // form is a page that silently stopped doing its one job.
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS form_position TEXT`).catch(() => {});
  // pledges.campaign_id — a pledge attributes at pledge time; payments against
  // it inherit the campaign. Campaign "raised" NEVER counts an open pledge —
  // pledged (committed-but-unpaid) is a separate figure, never summed in.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  // grants.campaign_id + awarded_at — an awarded grant's amount can count
  // toward a linked campaign. awarded_at (not raw status) is the attribution
  // fact: stamped on the transition INTO 'awarded' (the same moment the
  // existing fin_transactions income stamp fires), kept through active/closed,
  // cleared if the grant moves back to a pursuing/rejected status — so a
  // campaign thermometer never drops just because a won grant's status moved on.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ`);
  // gifts.cover_fee_amount — the donor-covers-fees portion of a grossed-up
  // online gift (charged − intended). The gift row / receipt / ledger keep the
  // FULL charged amount (what actually moved, what the IRS acknowledgment must
  // state); campaign/page goal progress counts amount − cover_fee_amount (what
  // the donor intended for the mission). 0 for every non-grossed-up gift.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS cover_fee_amount NUMERIC DEFAULT 0`);
  // recurring_subscriptions attribution — a subscription started through a
  // giving page remembers its page/campaign (from the checkout session
  // metadata) so every RENEWAL charge attributes too, not just the first.
  // cover_fee_amount mirrors gifts.cover_fee_amount for renewal stamping.
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS giving_page_id TEXT`);
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS cover_fee_amount NUMERIC DEFAULT 0`);
  // BUILD-56 (BUILD-55 §worry-3 follow-up) — a subscription remembers its FUND
  // designation the same way it remembers campaign/page attribution, so
  // renewal charges route to the designated fund instead of falling back to
  // undesignated (stamped at checkout.session.completed, read back by the
  // renewal-attribution block in payment_intent.succeeded).
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS fund_id TEXT`);
  // BUILD-57 — the roster's "next charge" column. Synced from Stripe webhook
  // payloads (subscription.updated / checkout completion) where available;
  // NULL renders as "—", never a guessed date.
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`);
  // BUILD-57 — renewal gifts link back to their subscription so the roster's
  // "total given on this subscription" is a real SUM over gift rows, not an
  // estimate. Stamped in payment_intent.succeeded when the PI's invoice
  // resolves a subscription; pre-BUILD-57 gifts stay NULL (unknowable —
  // never guessed by donor+amount matching).
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS recurring_subscription_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_recurring_sub ON gifts (org_id, recurring_subscription_id) WHERE recurring_subscription_id IS NOT NULL`);

  // ══ BUILD-45 — DONOR PORTAL ══════════════════════════════════════════════
  // A public, money-adjacent surface for people who are NOT Steward users.
  // Every table here is org-scoped; tokens are stored as SHA-256 HASHES only
  // (a DB leak must never leak a live magic link or session).

  // Per-org portal switch + white-label theme (§5). enabled defaults FALSE —
  // a public PII surface is opt-in per org, never on by construction.
  // powered_by defaults FALSE (the promise is Steward-invisible by default).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_settings (
      org_id TEXT PRIMARY KEY REFERENCES orgs(id),
      enabled BOOLEAN NOT NULL DEFAULT false,
      display_name TEXT,
      logo_data TEXT,
      header_image_data TEXT,
      primary_color TEXT,
      accent_color TEXT,
      footer_text TEXT,
      contact_email TEXT,
      ein_line TEXT,
      powered_by BOOLEAN NOT NULL DEFAULT false,
      min_recurring_cents INTEGER NOT NULL DEFAULT 500,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Magic links (P-1): ≥128-bit CSPRNG token, 15-minute expiry, single-use
  // (used_at), invalidated on re-request (superseded_at). Hash-at-rest.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_magic_links (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      requested_ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_links_org_email ON portal_magic_links (org_id, email)`);

  // Portal sessions (P-4): a SEPARATE table and a separate HttpOnly cookie —
  // never the staff JWT system. A session is (org, email): P-6's one-email/
  // many-donor-records case resolves donor rows at read time, always scoped
  // to the session's org.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_sessions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      ip TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_sessions_org_email ON portal_sessions (org_id, email)`);

  // P-7: append-only audit of every session-create, link-request, and
  // portal mutation.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT,
      email TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_audit_org ON portal_audit_log (org_id, created_at DESC)`);

  // Impact Updates (§6.1) — org-authored, attached to funds/campaigns (or
  // org-wide). Matching is deterministic over existing gift attribution
  // (§6.2) — no classifier, no AI.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS impact_updates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      title TEXT NOT NULL,
      body TEXT,
      photos JSONB DEFAULT '[]',
      targets JSONB DEFAULT '[]',
      org_wide BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'published',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_impact_updates_org ON impact_updates (org_id, created_at DESC)`);
  // BUILD-65 Part 3 — per-photo non-destructive crop, an array index-aligned
  // with `photos` (each entry a normalized {x,y,w,h} or null → center focal
  // fallback). Bytes are never touched. storeImpactPhotos preserves order, so
  // photos[i] ↔ photo_crops[i] stays aligned across add/remove.
  await pool.query(`ALTER TABLE impact_updates ADD COLUMN IF NOT EXISTS photo_crops JSONB DEFAULT '[]'`);

  // R-2/R-3 pause state (BUILD-44 F-6): a paused schedule produces zero
  // charges (Stripe pause_collection) and is excluded from dunning.
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ`);

  // ═══ BUILD-46 (network) — global donor accounts ════════════════════════════
  // THE WALL: everything in this block that is account-scoped is GLOBAL (no
  // org_id on donor_accounts/aliases/resets/audit) and must NEVER be joined
  // into an org-side query. A donor may see across orgs; an org may never see
  // across orgs. No org-side route may read these tables — enforced by
  // tests/org-blindness.test.js (S-13 byte-equality).

  // The account: email is stored case-folded (lower). password_hash nullable —
  // a magic-link-only BUILD-45 donor may never set one (§1.3 prompt, never
  // forced). bcryptjs cost 12 (matches staff auth; argon2id was rejected only
  // because it adds a native dep to a zero-native-deps deploy — documented
  // decision per the build brief). MFA columns are nullable placeholders —
  // TOTP is specced, not silently skipped — deferred, not in v1.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      email_verified_at TIMESTAMPTZ,
      verify_token_hash TEXT,
      verify_expires_at TIMESTAMPTZ,
      pending_email TEXT,
      email_change_token_hash TEXT,
      email_change_expires_at TIMESTAMPTZ,
      mfa_secret TEXT,
      mfa_enabled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Verified alias emails: proof-of-control only (confirmation link to the
  // alias address, hash-at-rest, single-use). A VERIFIED alias is globally
  // unique across accounts (partial unique) — S-12: one email can never be
  // claimed by two accounts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_account_aliases (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES donor_accounts(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      token_expires_at TIMESTAMPTZ,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(account_id, email)
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_donor_alias_verified_email
    ON donor_account_aliases (email) WHERE verified_at IS NOT NULL`);

  // Account ↔ per-org donor record. Created ONLY by exact match on a VERIFIED
  // email (never name/address/fuzzy — wrong-linking is a P0 privacy breach by
  // construction). unlinked_at = donor-initiated unlink: hides the org from
  // the dashboard, never deletes the org's own record, and the idempotent
  // link job never silently re-links an unlinked row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_account_links (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES donor_accounts(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      via_email TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      unlinked_at TIMESTAMPTZ,
      UNIQUE(account_id, donor_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_links_account ON donor_account_links (account_id)`);
  // The link matcher's hot path (verify/alias/lazy dashboard reads) matches
  // LOWER(d.email) across every portal org — the functional index keeps that
  // from scanning all donor rows as the network grows (FINDINGS worry #3,
  // shipped pre-flag per the go-live order).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_lower_email ON donors (LOWER(email)) WHERE deleted_at IS NULL`);

  // Password resets: ≥128-bit CSPRNG, ≤60 min, single-use, hash-at-rest,
  // invalidated (superseded) on password change and on re-request.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_account_resets (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES donor_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // BUILD-49 — account-level sign-in links (the /giving "email me a sign-in
  // link" alternate to password auth). Same token discipline as resets and the
  // portal magic links: CSPRNG, hash-at-rest, 15-min, single-use, superseded
  // on re-request. Only verified accounts ever receive one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_account_signin_links (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES donor_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Account-level audit (signup, login, link/unlink, alias, resets, email
  // change, deletion). GLOBAL — never surfaced to any org.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_account_audit (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      email TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_audit_account ON donor_account_audit (account_id, created_at DESC)`);

  // Sessions: the ONE portal_sessions table gains donor_account_id (both auth
  // paths mint the same session). An account-wide session has org_id NULL —
  // guarded migration drops the NOT NULL that BUILD-45 shipped with.
  await pool.query(`ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS donor_account_id TEXT`);
  await pool.query(`ALTER TABLE portal_sessions ALTER COLUMN org_id DROP NOT NULL`).catch(() => {});

  // §2.2 second switch: "list this organization in donor dashboards".
  // Default FALSE — existing CRM orgs stay invisible to the network until
  // they opt in; the network-signup approval path flips it on explicitly.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS network_listed BOOLEAN NOT NULL DEFAULT false`);

  // ── BUILD-47 — find your nonprofits (directory + follows) ────────────────
  // Directory listing card fields — org-editable in Settings › Donor Portal,
  // empty until the org sets them. Only ever shown for LISTED orgs.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS directory_description TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS directory_city TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS directory_state TEXT`);

  // ── BUILD-48 — theme depth (adaptive org takeover) ───────────────────────
  // All optional with designed fallbacks; every value is validated at the
  // write route (colors through the contrast guards, pairing/card style as
  // ENUMS — never free CSS, never font uploads or external font URLs).
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS background_tint TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS button_color TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS type_pairing TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS card_style TEXT`);

  // ── BUILD-59 — header FOCAL POINT ────────────────────────────────────────
  // The root cause of "out of crop": a photo is object-fit:cover'd into a
  // banner that doesn't share its aspect ratio, and the subject isn't always
  // centered (the installation photo's students sit right-of-center). A
  // normalized focal x/y (0..1, default center) the org sets once by clicking
  // the crop preview, honored in the render via object-position. Stored on the
  // header POINTER (per-org-per-slot), plumbed into the theme payload.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS header_focal_x REAL DEFAULT 0.5`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS header_focal_y REAL DEFAULT 0.5`);

  // BUILD-61 Part 2 — NON-DESTRUCTIVE CROP. A normalized crop rectangle
  // {x,y,w,h} (fractions 0..1 of the ORIGINAL asset, authored against the
  // banner ratio) stored on the header POINTER — the bytes are never re-encoded
  // and the original asset is never replaced, so an org can re-crop tomorrow
  // from the full picture (the whole point of BUILD-56's retention machinery).
  // NULL = no crop → the focal point (above) is the fallback.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS header_crop TEXT`);

  // BUILD-60 Part 2 — per-frequency, org-configurable donation amount ladders.
  // A $25/$50/$100/$250/$500 ladder is right for one-time and a punishing ask
  // as a monthly commitment, so the ladders are separate and each org sets its
  // own (they know their own donors). Stored as a JSON array of positive ints;
  // NULL = the built-in default (server GIVE_ONETIME_DEFAULT/GIVE_MONTHLY_DEFAULT).
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS onetime_amounts TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS monthly_amounts TEXT`);

  // ── BUILD-51 — theme-asset storage ───────────────────────────────────────
  // Theme images live OUT of the portal_settings row: the row carries a
  // content-addressed URL PATH (/portal-assets/<id>); the bytes live in
  // portal_assets (or in the S3 bucket when PORTAL_ASSETS_S3_* is set — see
  // assetStore.js). The legacy *_data columns are KEPT for compat: read sites
  // do COALESCE(url, data), so an unmigrated org renders unchanged; a re-save
  // through PUT /portal-settings migrates it.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS header_image_url TEXT`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS logo_url TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_assets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      storage TEXT NOT NULL DEFAULT 'db',
      s3_key TEXT,
      data TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_assets_org ON portal_assets(org_id, kind)`);

  // ── BUILD-56 — asset retention & undo ────────────────────────────────────
  // Destruction of an org's uploaded branding is impossible-by-default:
  //   • a refcount-zero asset is SOFT-DELETED (deleted_at stamped, bytes kept
  //     in whichever store) for ASSET_RETENTION_DAYS (assetStore.js), then
  //     destroyed by the logged purge sweep — the ONE destruction seam;
  //   • every mutation of a row that points at a content-addressed asset
  //     appends an asset_pointer_history row (which hash WAS the banner —
  //     the other half of recovery). History rows are tiny and are kept
  //     INDEFINITELY on purpose: they are the index into everything else;
  //   • every actual destruction is recorded in asset_purge_log.
  // Pinned by tests/asset-retention.test.js (incl. the one-seam battery).
  await pool.query(`ALTER TABLE portal_assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_assets_deleted ON portal_assets(deleted_at) WHERE deleted_at IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_pointer_history (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      from_value JSONB,
      to_value JSONB,
      actor_user_id TEXT,
      actor_email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_ptr_hist_org ON asset_pointer_history(org_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_purge_log (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      bytes INTEGER,
      storage TEXT,
      soft_deleted_at TIMESTAMPTZ,
      purged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // A follow is DASHBOARD-SIDE state only: a donor added a listed org whose
  // records don't (yet) match a verified email. Zero giving history rides it,
  // and it is INVISIBLE to the org — same WALL rule as donor_account* tables:
  // no org-side route may ever read donor_org_follows (org-blindness battery
  // covers follows since BUILD-47). History appears only when the existing
  // verified-email link machinery creates a donor_account_links row; display
  // precedence (link beats follow) is the follow→link conversion.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_org_follows (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES donor_accounts(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(account_id, org_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_follows_account ON donor_org_follows (account_id)`);

  // ── §3 the gate ───────────────────────────────────────────────────────────
  // IRS Pub 78 / BMF snapshot (loaded by scripts/load-irs-ein-registry.js;
  // refresh cadence: monthly, documented there). ein stored digits-only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ein_registry (
      ein TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      loaded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Network applications: one per org, every decision logged (decisions is an
  // append-only JSONB array). status: pending | approved | held | rejected |
  // dispute | delisted. UNIQUE(ein) among non-dispute applications is enforced
  // in the route (a second signup on a claimed EIN becomes a dispute row,
  // never a duplicate listing — S-15).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_applications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL UNIQUE,
      ein TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ein_result JSONB,
      domain_check JSONB,
      website TEXT,
      disputed_org_id TEXT,
      decisions JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_network_apps_status ON network_applications (status, created_at DESC)`);

  // ═══ BUILD-54 §4 — the portal page: typed widgets, draft/publish ═══════════
  // ONE page per org (the portal home). draft/published are VALIDATED widget
  // arrays (validateWidgets in server.js — typed fields only, never raw
  // HTML/CSS/JS/embeds; images ride the asset seam as /portal-assets paths;
  // video is stored as {provider, videoId} parsed server-side from an
  // allowlist). Autosave writes draft; nothing donor-visible until an
  // explicit publish copies draft → published; revert copies published →
  // draft. NULL published = the org has never published a page and the
  // portal renders the BUILD-45 fixed layout unchanged.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_pages (
      org_id TEXT PRIMARY KEY REFERENCES orgs(id),
      draft JSONB,
      published JSONB,
      draft_updated_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ
    )
  `);

  // ── BUILD-75 C.1 — THE ACTOR ON EVERY WRITE ───────────────────────────────
  // Every row that represents something someone DID records who did it:
  // `created_by` an IDENTITY (a user id, or a system identity string like
  // "system:stripe-webhook" / "system:workflow:<recipe>" — never a boolean),
  // `created_by_name` the frozen display fallback (survives user deletion;
  // live display should JOIN users when the id resolves). NULL means
  // "unrecorded — the row predates BUILD-75"; history is never backfilled
  // with guesses, which is exactly why this lands now rather than in 2027.
  // interactions (created_by/logged_by_name), moves (officer_id/officer_name),
  // donor_materials (uploaded_by), board_reports (generated_by), impact_updates
  // (created_by) and fin_audit_log already carried their own actor columns.
  // tests/actor-stamp.test.js pins that every server.js INSERT into these
  // tables stamps the actor.
  // BUILD-75 C.3 — user removal is a SOFT DETACH, never a row delete: the
  // actor columns above point at users forever, and "we delete the row" is
  // the wrong answer for a system whose value is institutional memory.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`);
  for (const t of ["gifts", "donors", "pledges", "tasks", "campaigns", "grants", "events",
    "households", "opportunities", "receipts", "giving_pages", "planned_gifts",
    "volunteers", "board_members", "fin_transactions", "sequences"]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS created_by TEXT`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  }

  // ── BUILD-87 Part 3 — EMAIL LOGGING BY BCC ────────────────────────────────
  // A message BCC'd to `log+<org_slug>@<inbound domain>` whose To address
  // matches exactly one donor is logged straight onto that donor as an `email`
  // interaction — it never reaches these tables. These two hold the other two
  // outcomes.
  //
  // inbound_email_unmatched: zero or several donor matches. A human picks the
  // donor or discards it; an inbound email NEVER creates a donor. It carries
  // the message body because the body is the thing being filed — deleting the
  // row is the discard.
  //
  // inbound_email_drops: the REFUSALS, counted and otherwise contentless. A
  // bad slug or a sender who is not a user of the org leaves a timestamp and a
  // reason and nothing else — the whole point of dropping a message is that we
  // do not keep it. org_id is NULL when the slug never resolved to an org,
  // which is exactly the case where we have no tenant to file it under.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_email_unmatched (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      kind TEXT NOT NULL,
      from_email TEXT,
      to_emails TEXT,
      subject TEXT,
      body TEXT,
      message_date TEXT,
      candidates JSONB,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inbound_unmatched_org ON inbound_email_unmatched (org_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_email_drops (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inbound_drops_org ON inbound_email_drops (org_id, created_at DESC)`);

  // ── BUILD-89S 89a — GIVING SOURCES: KEEP WHAT YOU TAKE GIFTS THROUGH ──────
  // An organisation keeps PayPal, Zeffy, Cash App or whatever it takes gifts
  // through today. Steward READS those gifts and never touches the money.
  // Placed here, after orgs / donors / fin_funds / gifts / threads, because a
  // table goes after the tables it references (CLAUDE.md).
  //
  // `credentials_sealed` holds a shared/secretBox.js v1 envelope and NOTHING
  // ELSE — the CHECK is the point of the column. Routes can be bypassed; a
  // database constraint cannot, so an API secret on the organisation's own
  // PayPal account CANNOT be written to this table in plain text even by a
  // future code path that forgets. NULL is legal only because a file provider
  // (Cash App, Venmo) has no credential to hold.
  //
  // `backfilled_at` carries BUILD-83's rule: the FIRST read of a source is
  // import history and never posts to the ledger; everything arriving on a
  // later sync is a live gift and posts if the org keeps posting on.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giving_sources (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credentials_sealed TEXT,
      default_fund_id TEXT REFERENCES fin_funds(id),
      sync_cursor TEXT,
      last_synced_at TIMESTAMPTZ,
      last_run_id TEXT,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      backfilled_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT giving_sources_sealed_only CHECK (
        credentials_sealed IS NULL OR credentials_sealed LIKE 'v1.%'
      ),
      CONSTRAINT giving_sources_status CHECK (status IN ('active','error','disconnected'))
    )`);
  // One live connection per provider per org. Partial on status so a
  // DISCONNECTED source keeps its row (and its history) without blocking a
  // reconnect — disconnect stops syncing and keeps every gift, it does not
  // erase that the money once came in this way.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS giving_sources_one_live
                    ON giving_sources (org_id, provider) WHERE status <> 'disconnected'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_giving_sources_org ON giving_sources (org_id, status)`);

  // ── BUILD-92 A2 — WHAT THE PROVIDER ACTUALLY SAID ─────────────────────────
  // `last_error` is the SENTENCE a human reads and it does not change here.
  // Beside it now sit the two facts that were thrown away: the HTTP status the
  // provider answered with, and the provider's own machine-readable error code
  // (PayPal's `invalid_client`, Stripe's `error.code`). Jonathan's PayPal
  // failure was a plain 401 with `invalid_client` sitting on the error object
  // unread while the sentence fell through to the generic last line.
  //   `last_tried_at` is stamped on EVERY attempt, success or failure, which is
  // what lets the API stop reporting "never checked" beside an error.
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS last_error_status INTEGER`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS last_error_provider_code TEXT`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS last_tried_at TIMESTAMPTZ`);

  // ── BUILD-92 A3 — THE SAME GIFT FROM TWO PLACES ───────────────────────────
  // De-duplication has always been per source, by the provider's own id.
  // Donorbox runs on the ORGANISATION'S OWN Stripe and PayPal, so connecting
  // all three does not give three sets of gifts - it gives ONE set of gifts
  // reported three times, and every figure in the product doubles or trebles.
  //
  // `sits_on_top_of` is the ONE SHORTCUT, per source: "this source rides on
  // that one", set once by a human who knows their own stack. A cross-source
  // match between two sources in that relationship resolves as the same gift
  // WITHOUT asking, forever. Everything else asks, once, and never guesses.
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS sits_on_top_of TEXT`);

  // A gift can be reported under more than one provider's id. `external_id`
  // stays the FIRST one (it is the dedupe key and the unique index is on it);
  // the others ride here, so answering "same gift" once means the question is
  // never asked again by any source, on any future sync.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS also_external_ids JSONB`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_also_external
                      ON gifts USING GIN (also_external_ids)`).catch(() => {});
  // The window the match runs over. A gift is looked for by donor and date, so
  // this is the index that keeps the question cheap on a big org.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_donor_date ON gifts (org_id, donor_id, date)`);

  // ONE LINE PER QUESTION, and it is a question, never a silent decision.
  // A row here means: source B reported something that looks like a gift
  // already on file from source A, and Steward did NOT write it. Nothing is
  // lost - the provider's whole row is kept in `candidate` so "Keep both"
  // can write it later without re-reading the provider.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_duplicate_questions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      source_id TEXT NOT NULL REFERENCES giving_sources(id) ON DELETE CASCADE,
      existing_gift_id TEXT,
      existing_source_id TEXT,
      external_key TEXT NOT NULL,
      donor_id TEXT,
      amount_cents INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      sentence TEXT NOT NULL,
      candidate JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT,
      resolved_by_name TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT gift_dupq_status CHECK (status IN ('open','same_gift','kept_both'))
    )
  `);
  // Asked ONCE. A re-sync that re-reads the same provider row finds the
  // question already standing (open OR answered) and says nothing new.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS gift_dupq_one_per_row
                      ON gift_duplicate_questions (org_id, external_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gift_dupq_open
                      ON gift_duplicate_questions (org_id, created_at) WHERE status = 'open'`);

  // ── BUILD-92 A4 — ANY STATEMENT, REMEMBERED ───────────────────────────────
  // "A bank or other statement" is ONE generic preset on the existing mapper.
  // She picks the date, amount and name columns once, NAMES the source
  // ("Zelle at Central Bank"), says whether negative rows are dropped, and
  // this is where that answer lives. Next month the same columns arrive, the
  // mapping matches on the COLUMN SET, and there is nothing to click.
  //
  // It is a MAPPING, not a source: nothing here has credentials, nothing here
  // syncs, and nothing here reaches a provider. That is why it is its own
  // small table rather than a row in giving_sources.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS statement_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      preset_key TEXT NOT NULL DEFAULT 'generic_statement',
      mapping JSONB NOT NULL,
      drop_negative BOOLEAN NOT NULL DEFAULT true,
      payment_method TEXT,
      times_used INTEGER NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // The NAME is the thing a human holds onto, so it is the thing that has to
  // be unique: saving "Zelle at Central Bank" twice must correct the mapping,
  // never mint a second one she then has to choose between.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS statement_mappings_name
                      ON statement_mappings (org_id, LOWER(name))`);

  // A gift that came in through a source remembers which one, what the
  // provider took, and the provider's own subscription id.
  //
  // processor_fee_amount is NOT cover_fee_amount. cover_fee_amount is the
  // donor CHOOSING to add the fee on top (BUILD-08 Phase B); this is what the
  // provider took out. The gift amount stays the GROSS either way: the donor
  // gave the gross, and a receipt that says otherwise is wrong.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS giving_source_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS processor_fee_amount NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS provider_recurring_ref TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_source ON gifts (org_id, giving_source_id) WHERE giving_source_id IS NOT NULL`);

  // ── THE RECURRING COMMITMENT, PROVIDER-NEUTRAL ────────────────────────────
  // The payoff of reading every source: Steward knows who gives monthly
  // through ANY of them and says so the week a payment does not arrive.
  //
  // `confidence` is the honest half. 'provider' means PayPal/Stripe/Givebutter
  // named the subscription. 'inferred' means nobody did and Steward saw the
  // pattern — it reads "looks monthly" on every surface until `confirmed_at`
  // is stamped by a human tapping once. A guess presented as a fact is the one
  // thing this product does not do.
  //
  // `missed_for` is what makes "one Thread per missed payment, never one per
  // day" true by construction: the date we have ALREADY raised is stored, so
  // tomorrow's sweep over the same unpaid month finds nothing to do.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giving_recurring (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES giving_sources(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      interval TEXT NOT NULL DEFAULT 'month',
      confidence TEXT NOT NULL,
      recurring_ref TEXT,
      gift_count INTEGER DEFAULT 0,
      first_gift_on TEXT,
      last_gift_on TEXT,
      expected_next TEXT,
      confirmed_at TIMESTAMPTZ,
      confirmed_by TEXT,
      confirmed_by_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      missed_for TEXT,
      missed_thread_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT giving_recurring_confidence CHECK (confidence IN ('provider','inferred')),
      CONSTRAINT giving_recurring_status CHECK (status IN ('active','missed','ended'))
    )`);
  // Two identities, because the two kinds are identified by different things:
  // the provider's subscription id when there is one, otherwise the donor and
  // the amount. Both partial, both org-scoped.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS giving_recurring_by_ref
                    ON giving_recurring (org_id, source_id, recurring_ref) WHERE recurring_ref IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS giving_recurring_by_pattern
                    ON giving_recurring (org_id, source_id, donor_id, amount_cents) WHERE recurring_ref IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_giving_recurring_due
                    ON giving_recurring (org_id, expected_next) WHERE status = 'active'`);

  // ── BUILD-90 90a/90b — THE CLOSE LINK AND THE BILLING DATE ────────────────
  // WHEN a customer is first charged is thirty days after SIGNING, and signing
  // is one timestamp: the moment Checkout completed in the room. It is stamped
  // once and never written again — not by an import, not by a second import,
  // not by a rescheduled onboarding meeting. `trial_ends_at` (already here
  // since BUILD-24) carries the date itself; this column carries the fact the
  // date is derived from, so a wrong trial end can always be re-derived and a
  // right one can be shown to have not moved.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ`);
  // Stamped when the seven-day reminder goes out. Its presence — not a time
  // window — is what makes "one email, once" true: a tick that runs every six
  // hours for seven days must not send fourteen warnings.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ`);
  // Which close link created this org, for the audit trail back to the room.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS close_link_id TEXT`);
  // The card on file, as SHE would recognise it: a brand and four digits. The
  // seven-day reminder names it, and Settings shows the same one — a warning
  // that says "your card" without saying WHICH card is not a warning. Stored
  // rather than fetched per page load, and refreshed from Stripe whenever the
  // subscription changes.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_card_brand TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_card_last4 TEXT`);

  // A close link is a Checkout session that has not been walked through yet.
  // It holds ONLY what the room agreed — who, which email, which plan — and
  // nothing exists in Steward until Stripe says the card went in. An unopened
  // link therefore leaves no org, no user and no subscription behind; a link
  // that is walked twice is stopped by `close_links_one_org`, so a refreshed
  // success page cannot mint a second organisation.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS close_links (
      id TEXT PRIMARY KEY,
      org_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      plan TEXT NOT NULL,
      stripe_session_id TEXT,
      checkout_url TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      org_id TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT close_links_status CHECK (status IN ('open','completed'))
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS close_links_one_org
                    ON close_links (id) WHERE org_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_close_links_session
                    ON close_links (stripe_session_id) WHERE stripe_session_id IS NOT NULL`);

  // BUILD-92: a close link can now point at an org that ALREADY EXISTS, rather
  // than only conjuring a new one. `target_org_id` is what tells the two apart
  // at completion time: set = attach the subscription to that org and create
  // NOTHING; null = the original behaviour, mint an org and its first admin.
  // Additive and nullable, so every link written before this reads as new-org.
  // BUILD-93 Part 2 — WHO REMOVED WHOM, AND WHEN.
  //
  // `DELETE /users/:id` was the only privileged mutation in the product that
  // left no actor behind: it stamped `deactivated_at` on the row it changed
  // and nothing else. When both Jonathan rows in the demo org were deactivated
  // 2.4 seconds apart on 2026-09-09, the timestamp was the ONLY evidence that
  // survived, and who did it is not recoverable. This is that gap closed.
  // Append-only; never written by a migration, only by the route.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_admin_audit (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      target_email TEXT,
      target_role TEXT,
      actor_user_id TEXT,
      actor_email TEXT,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT user_admin_audit_action CHECK (action IN ('removed','reactivated','refused'))
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_admin_audit_org
                    ON user_admin_audit (org_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_admin_audit_target
                    ON user_admin_audit (target_user_id, created_at DESC)`);

  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS target_org_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_close_links_target_org
                    ON close_links (target_org_id) WHERE target_org_id IS NOT NULL`);

  // ── BUILD-94 Part 1 — A FACE ON EVERY PROFILE ─────────────────────────────
  // The bytes live behind the BUILD-51 asset seam (content-addressed, org
  // scoped, S3-or-DB); the row keeps only the asset id. Deliberately NOT a
  // /portal-assets/ path like every other pointer in this product: a donor
  // photo is served through the signed, expiring /person-photos front door
  // (personPhoto.js), so storing a public path here would be a standing
  // invitation to render it.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS photo_asset_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_photo
                    ON donors (org_id) WHERE photo_asset_id IS NOT NULL`);
  // The import half. A mapped photo COLUMN holds a URL somebody else's system
  // wrote, so fetching it is an outbound request an uploaded spreadsheet chose
  // — it gets the same shape the BUILD-84 geocoder got: the row lands with a
  // `pending` status and a drainable queue does the network, so a dead URL on
  // row 4,000 of 25,000 costs that row its photo and nothing else. Every row
  // leaves with a TERMINAL status; the reason is kept ON THE ROW, because "it
  // silently has no photo" is the outcome nobody can debug.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS photo_source_url TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS photo_fetch_status TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS photo_fetch_error TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_photo_pending
                    ON donors (org_id, updated_at) WHERE photo_fetch_status = 'pending'`);

  // ── BUILD-94 Part 2 — PEOPLE WHO ARE NOT DONORS ──────────────────────────
  // Until this build every person in Steward was a donor. Volunteers, staff
  // and board now live on the same table, with a TYPE — and a person can hold
  // more than one (a volunteer who gives is both, on ONE record).
  //
  // JSONB array rather than a join table on purpose: four fixed values, always
  // read with the row, never independently queried, and every money surface
  // needs the predicate INLINE in a WHERE clause it already has (see
  // shared/personType.js donorOnlySql). A join table would put an EXISTS in
  // forty hot queries to express a four-bit fact.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS person_types JSONB DEFAULT '["donor"]'::jsonb`);
  // EVERY EXISTING PERSON IS A DONOR. That is what they were when they were
  // written, and it is what every giving total already assumes.
  await pool.query(`UPDATE donors SET person_types = '["donor"]'::jsonb WHERE person_types IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_person_types ON donors USING GIN (person_types)`);

  // ── BUILD-94 Part 3 — SEQUENCES WITH TRACKS ──────────────────────────────
  // Extends the BUILD-13 sequence tables rather than forking a second engine:
  // one place a scheduled email can come from is the whole point.
  //
  // `tracks` is the ordered rule list (shared/sequenceShape.js) — ORDER IS
  // MEANING: tracks are tried in order and the first match wins, which is what
  // makes "a person is on exactly one track" true by construction.
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS tracks JSONB`);
  // Turning a sequence on is an event with an actor and a time (BUILD-75).
  // It is also what the timeline line on every send quotes back.
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS turned_on_by TEXT`);
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS turned_on_by_name TEXT`);
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS turned_on_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS turned_off_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE sequences ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  await pool.query(`ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS track_key TEXT`);
  // "Send even after another gift" — a welcome series must not ask for a gift
  // the week after one arrived, but a thank-you step still should.
  await pool.query(`ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS send_even_after_gift BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS track_key TEXT`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS enrolled_by TEXT`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS enrolled_by_name TEXT`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS stop_reason TEXT`);
  // The gift count at enrollment. A SECOND gift during a first-gift sequence
  // skips the remaining steps — this is what "second" is measured against.
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS gift_count_at_enroll INTEGER`);

  // ── THE IDEMPOTENCY ROW ──────────────────────────────────────────────────
  // One row per (sequence, person, step), claimed BEFORE the provider call.
  // A retried job cannot send twice because the claim is the unique index, not
  // a flag somebody remembered to check. A failure is kept with its reason so
  // it can surface on Home rather than being swallowed (BUILD-37 H2).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      sequence_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'claimed',
      subject TEXT,
      error TEXT,
      attempts INTEGER DEFAULT 0,
      claimed_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      CONSTRAINT sequence_sends_status CHECK (status IN ('claimed','sent','failed'))
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sequence_sends_uk
                    ON sequence_sends (sequence_id, donor_id, step_order)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sequence_sends_org_failed
                    ON sequence_sends (org_id, sequence_id) WHERE status = 'failed'`);

  // ── BUILD-94 Part 4 — WHAT THE PROVIDER SAID ABOUT AN ADDRESS ────────────
  // A hard bounce is a fact about the ADDRESS, not a preference: it is kept
  // ON THE PERSON with its date and reason, so the profile can say why nothing
  // is reaching them instead of the mail silently going nowhere.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS email_unreachable BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS email_unreachable_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS email_unreachable_reason TEXT`);

  // ── BUILD-94 FIRST RUN — THE GREETING AN ORG GETS ONCE ───────────────────
  // A new organisation's first sign-in is the one moment where a product gets
  // to say "this is yours" before it says anything else. `welcome_motif` is
  // the single piece of white-label that greeting carries: NULL is the plain
  // brass moment every org gets, and a named motif draws the thing that
  // organisation is actually about. One column, one switch, and a motif an org
  // does not have simply does not draw.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS welcome_motif TEXT`);
  // The two or three words an organisation actually says about itself
  // ("Recreation · Restoration · Education"). Their words, stored, never
  // computed — the BUILD-86 rule, applied to the one screen that greets them.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS welcome_words JSONB`);
  // Per USER, not per org: a second staff member joining months later gets
  // their own greeting, and the founder's is not re-shown to them.
  //
  // DEFAULT NOW(), and every existing row backfilled — "already welcomed" is
  // the SAFE default and being greeted is the deliberate exception. A greeting
  // is a full-screen takeover, so a NULL-means-greet column would have thrown
  // one in front of every user who already uses the product, and in front of
  // every test fixture that inserts a user without thinking about it (which is
  // all of them). The signup path sets it back to NULL on purpose.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ DEFAULT NOW()`);
  // SET DEFAULT separately, and not as belt-and-braces: `ADD COLUMN IF NOT
  // EXISTS … DEFAULT x` does NOTHING AT ALL when the column already exists, so
  // a database that got this column from an earlier deploy (one without the
  // default) would keep inserting NULLs — and NULL here means "greet them",
  // which is a full-screen takeover in front of every user created from then
  // on. A fresh database would have been fine and an upgraded one would not:
  // exactly the divergence that only shows up in production.
  await pool.query(`ALTER TABLE users ALTER COLUMN welcomed_at SET DEFAULT NOW()`);
  await pool.query(`UPDATE users SET welcomed_at = NOW() WHERE welcomed_at IS NULL`);

  // ── BUILD-95 §5A — WHAT A SOURCE NEEDS TO BE TOLD ────────────────────────
  // Square is a point-of-sale: a lesson fee and a donation are the same shape
  // to it, and no field distinguishes them. So the ORGANISATION says which
  // locations (or which item wording) are giving, and Steward imports nothing
  // from Square until they have. This column holds that answer.
  //
  // Generic JSONB rather than square_location_ids, because the next provider
  // that needs to be told something will need to be told something else.
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS config JSONB`);

  // ── BUILD-95 — A PICTURE OF THE CHEQUE ───────────────────────────────────
  // A treasurer photographing each cheque as she enters it is the whole
  // feature: three months later, "did Margaret really write $250?" has an
  // answer that is the cheque rather than somebody's memory. The bytes ride
  // the BUILD-94 asset seam under the kind `cheque`, and the gift keeps only
  // the asset id — served through the same signed, expiring /person-photos
  // door, because a cheque image carries a name, an amount, a bank and a
  // signature and is the most sensitive image this product will ever hold.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS cheque_asset_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_cheque
                    ON gifts (org_id) WHERE cheque_asset_id IS NOT NULL`);

  // ── BUILD-97 — AN AUDIENCE IS A THING WITH A NAME ────────────────────────
  // A campaign's audience used to be an anonymous JSON blob typed into the
  // builder and discarded on send. A saved audience is that same segment with
  // a name over it, so "Lapsed sponsors" is something she can point at on a
  // Tuesday without composing anything.
  //
  // The segment column holds the EXISTING segment shape verbatim, so
  // resolveCampaignRecipients stays the one resolver. A second resolver is how
  // a campaign ends up going to a different list than the screen promised.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audiences (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT,
      segment JSONB NOT NULL,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audiences_org ON audiences (org_id, name)`);
  // Two audiences with the same name in one org is a trap at send time: the
  // confirmation names the audience, and naming it twice makes the
  // confirmation meaningless. Case-insensitive, because "Sponsors" and
  // "sponsors" are the same mistake.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS audiences_org_name_uk
                    ON audiences (org_id, LOWER(name))`);

  // ── BUILD-97 Part 3 — THE AGENT SHE INSTRUCTS ───────────────────────────
  // Three tables, and the third is the one that matters.
  //
  // Placed AFTER `orgs` and `users` because both are referenced, and the
  // BUILD-88c lesson is that schema init ORDER is part of the commit: a table
  // written beside its build's other work but BEFORE the table it references
  // resolves fine on an existing database and throws on a FRESH one, which
  // fails CI's boot step, which gates both deploy jobs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_instructions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      -- Her words, verbatim. Never rewritten, never normalised: the log quotes
      -- this back on every send, and a quote that is not what she typed is not
      -- a quote.
      text TEXT NOT NULL,
      kind TEXT NOT NULL,                       -- task | standing
      trigger TEXT,                             -- standing only
      status TEXT NOT NULL DEFAULT 'planned',   -- planned | active | paused | done
      -- THE DEFAULT IS 'draft' AT THE DATABASE, not only in the route. An
      -- instruction that reaches this table without an explicit answer drafts;
      -- it does not send. Named send_authorization rather than authorization,
      -- which Postgres reserves, and it is the clearer name anyway: it
      -- authorises SENDING and nothing else.
      send_authorization TEXT NOT NULL DEFAULT 'draft',
      plan JSONB,
      last_count INTEGER,                       -- for the change-by-half re-show rule
      created_by TEXT, created_by_name TEXT,
      -- "She turned it on" has to be TRUE, so who and when are recorded, and a
      -- super-admin is refused at the route (BUILD-94's rule, carried over).
      turned_on_by TEXT, turned_on_by_name TEXT, turned_on_at TIMESTAMPTZ,
      paused_at TIMESTAMPTZ, paused_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_instr_org ON agent_instructions (org_id, status)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      instruction_id TEXT REFERENCES agent_instructions(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT,                              -- running | done | refused | failed
      plan JSONB,
      -- What it READ, what it DID, what it DRAFTED, what it SENT, what it
      -- DECLINED and why. All five, because "14 things" with no breakdown is a
      -- number nobody can check.
      read_summary TEXT,
      actions JSONB,
      drafted INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      declined INTEGER DEFAULT 0,
      withheld INTEGER DEFAULT 0,
      withheld_reason TEXT,
      error TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_runs_org ON agent_runs (org_id, started_at DESC)`);

  // THE UNDO LEDGER. Every agent write records what the row looked like BEFORE
  // it, so undo is a restore and not a guess. Thirty days, per the brief.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_writes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
      instruction_id TEXT,
      tool TEXT NOT NULL,
      entity_table TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      -- A NULL before_row means the row did not exist, so undo deletes it.
      -- A row means it did exist, so undo restores these columns.
      before_row JSONB,
      after_row JSONB,
      -- The rows this action came from. An action that cannot cite one is not
      -- taken, so this is never empty on a committed write.
      cites JSONB,
      undone_at TIMESTAMPTZ, undone_by TEXT, undone_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_writes_org ON agent_writes (org_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_writes_run ON agent_writes (run_id)`);

  // THE AGENT'S DRAFTS HAVE THEIR OWN HOME, and that is a decision.
  // `thank_you_drafts` is per-GIFT: its gift_id is NOT NULL and unique per org,
  // because a thank-you is for a specific gift. An agent draft is a message to
  // a person for whatever reason her instruction gave, and most of those
  // reasons are not a gift. Forcing them into the same table would have meant
  // either a fake gift id or dropping the uniqueness that keeps the thank-you
  // queue honest.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_drafts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
      instruction_id TEXT,
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      subject TEXT,
      body TEXT NOT NULL,
      -- The rows this draft came from. A draft that cannot cite one is never
      -- written, so this is never empty on a committed row.
      cites JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | dismissed
      sent_at TIMESTAMPTZ, dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_drafts_org ON agent_drafts (org_id, status, created_at DESC)`);

  // ── BUILD-97 Part 5 — EVERY MESSAGE THAT LEFT THE BUILDING ──────────────
  // Written by the ONE wrapper around the Resend client (server.js), so every
  // one of the 26 existing send sites and every future one lands here without
  // anybody remembering to make it.
  //
  // THE RECIPIENT DOMAIN, NEVER THE ADDRESS. A super-admin needs to see that
  // mail went to yahoo.com from a demo org — which is the exact shape of the
  // 22 September incident — and does not need a list of donors' email
  // addresses sitting in an ops table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      recipient_domain TEXT,
      kind TEXT,
      subject TEXT,
      status TEXT,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_log_time ON email_log (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_log_org ON email_log (org_id, created_at DESC)`);

  // Every background tick, with its last run and its result. `processDigests`
  // and its eight siblings ran on a timer with nowhere to report to: a tick
  // that threw was a console line on a server nobody was reading.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tick_log (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      ok BOOLEAN,
      detail TEXT,
      error TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tick_log_name ON tick_log (name, started_at DESC)`);

  // ── PAUSE ALL, ONE BUTTON ────────────────────────────────────────────────
  // On the ORG, not on each instruction: "stop everything" has to be one
  // switch, and a switch that works by updating N rows can half-fail.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS agent_paused_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS agent_paused_by TEXT`);

  // The prompt and the response, kept per org for thirty days (agentShape's
  // PROMPT_RETENTION_DAYS). `ai_log` already existed and held a 100-character
  // summary; the agent needs the whole exchange to be auditable.
  await pool.query(`ALTER TABLE ai_log ADD COLUMN IF NOT EXISTS prompt_full TEXT`);
  await pool.query(`ALTER TABLE ai_log ADD COLUMN IF NOT EXISTS response_full TEXT`);
  await pool.query(`ALTER TABLE ai_log ADD COLUMN IF NOT EXISTS run_id TEXT`);
  // ── BUILD-96 Part 2 — SAMPLE DATA HAS TO BE EXACTLY KNOWABLE ─────────────
  // A real organisation's org now holds invented people under its own name, so
  // "clear the sample data" has to mean exactly the rows the provisioning path
  // wrote — not a heuristic, and never one row belonging to a customer.
  //
  // `is_sample` already existed on twelve tables. It did NOT exist on the
  // three that BUILD-85/BUILD-94 added, each of which the sample loader now
  // writes: a Thread, a household, a sequence enrolment. Deriving them from
  // the donor ("a Thread whose donor is a sample donor") would be exact TODAY
  // and a guess the moment anything else hangs off a Thread, so they are
  // tagged like everything else.
  //
  // DEFAULT false, and the direction matters for the same reason welcomed_at
  // defaults to NOW(): "not sample" is the safe answer for every row that
  // already exists and every fixture that inserts one without thinking about
  // it. A NULL-means-sample column would have put every customer's Threads
  // inside the blast radius of this route.
  for (const t of ["threads", "households", "sequence_enrollments"]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS is_sample BOOLEAN DEFAULT false`);
    // ADD COLUMN IF NOT EXISTS ... DEFAULT x does NOTHING when the column
    // already exists, including the default (BUILD-95's welcomed_at lesson).
    await pool.query(`ALTER TABLE ${t} ALTER COLUMN is_sample SET DEFAULT false`);
    await pool.query(`UPDATE ${t} SET is_sample = false WHERE is_sample IS NULL`);
  }

  // Clearing sample data is destructive and is done on someone else's org, so
  // it leaves an actor and a count behind. Append-only; never read by the
  // product, only by a person asking "what happened to that org".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sample_data_audit (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id TEXT,
      actor_email TEXT,
      counts JSONB,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT sample_data_audit_action CHECK (action IN ('cleared','refused'))
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sample_data_audit_org
                    ON sample_data_audit (org_id, created_at DESC)`);

  // ── BUILD-96 Part 3 — THE MODEL IS A SUBPROCESSOR AND A COST ─────────────
  // Two features send an organisation's data to Anthropic: cheque reading
  // sends a PHOTOGRAPH OF A CHEQUE — a name, an amount, a bank and a
  // signature, the most sensitive image this product will ever hold — and the
  // BUILD-97 agent sends rows and vocabulary from the org's own records.
  //
  // Both are now switchable PER ORG, defaulting ON. Default-on because an org
  // that has read the sentence in Settings and done nothing has consented to
  // the thing the sentence describes, and default-off would ship a feature
  // nobody finds. Switchable because "our board does not want donor images
  // leaving the building" is a legitimate answer and needs somewhere to live
  // that is not an email to support.
  //
  // DEFAULT true and backfilled true, the same direction as welcomed_at and
  // for the same reason: every existing org already has these features, and a
  // NULL-means-off column would silently switch them off for everybody on
  // deploy.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN ai_enabled SET DEFAULT true`);
  await pool.query(`UPDATE orgs SET ai_enabled = true WHERE ai_enabled IS NULL`);

  // ── BUILD-98 Part 1 — SOFT CREDITS, TRIBUTES, MATCHES ─────────────────────
  // shared/giftCredit.js is the rule: a gift is counted once, on the person
  // whose money it was. A soft credit is a row POINTING at a gift; nothing that
  // totals money reads this table unless it is asked to.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_soft_credits (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      gift_id TEXT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      pct NUMERIC(5,2),
      role TEXT NOT NULL DEFAULT 'other',
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (gift_id, donor_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gsc_org_donor ON gift_soft_credits (org_id, donor_id)`);
  // Tribute: a fact about the gift. The honouree is a record when there is one
  // (tribute_donor_id) and a name when there is not.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS tribute_type TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS tribute_donor_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS tribute_name TEXT`);
  // Matching: the employee's gift names the employer and the pledge that holds
  // the expected match; the employer's pledge names the gift it matches.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS match_employer_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS match_pledge_id TEXT`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS is_match BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS matches_gift_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_pledges_matches_gift ON pledges (matches_gift_id) WHERE matches_gift_id IS NOT NULL`);
  // The notice to the family — a DRAFT, never sent by Steward, and it holds no
  // amount because the family is never told one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribute_notices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      gift_id TEXT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      tribute_type TEXT NOT NULL,
      honouree_name TEXT NOT NULL,
      notify_name TEXT,
      notify_email TEXT,
      notify_address TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',   -- waiting | sent | skipped
      sent_at TIMESTAMPTZ, sent_by TEXT, sent_by_name TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (gift_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tribute_notices_open ON tribute_notices (org_id, created_at DESC) WHERE status = 'waiting'`);

  // ── BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT ──────
  // The letter in the org's own words, merged per donor (shared/ackLetter.js
  // refuses an unknown field at save). Who thanked a gift, and how, lives on the
  // gift beside the stamp that already said when.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ack_letter_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ack_tpl_org ON ack_letter_templates (org_id)`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS acknowledged_by TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS acknowledged_by_name TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS acknowledged_via TEXT`);
  // How late a gift is before it counts as the backlog — the org's own N.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ack_backlog_days INTEGER DEFAULT 7`);

  // ── BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD ─────────────────
  // A saved report is a DEFINITION — field names from shared/reportBuilder.js's
  // catalogue — never SQL. Private to its owner unless shared.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      question TEXT,
      definition JSONB NOT NULL,
      shared BOOLEAN NOT NULL DEFAULT false,
      owner_id TEXT, owner_name TEXT,
      schedule TEXT,                           -- NULL | 'weekly'
      last_sent_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_reports_org ON saved_reports (org_id)`);
  // ONCE per report per week: reserved before the send, released if it fails.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_report_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      report_id TEXT NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (report_id, period_key)
    )`);

  // ── BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA ─────────────────
  // Ticket and sponsorship levels. A ticket is a gift that bought something
  // (shared/eventShape.js): price and fair-market value in the level, and the
  // split written onto the gift so the receipt states the deductible part.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_levels (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'ticket',       -- ticket | sponsor
      name TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK (price > 0),
      fmv NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fmv >= 0),
      capacity INTEGER,
      recognition TEXT,
      position INTEGER DEFAULT 0,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (fmv <= price)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_levels_event ON event_levels (event_id)`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS level_id TEXT`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS table_label TEXT`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS registration_gift_id TEXT`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS sponsor_pledge_id TEXT`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS recognition TEXT`);
  // When this attendee's attendance reached their timeline — once, ever.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS attendance_logged_at TIMESTAMPTZ`);

  // ── BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS ─────────────────────
  // One row per shift, on the PERSON (donors row, BUILD-94 person types).
  // import_key makes re-importing the same export a no-op.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_shifts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      hours NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
      role TEXT,
      note TEXT,
      via TEXT NOT NULL DEFAULT 'staff',       -- staff | self | import
      import_key TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_shifts_person ON volunteer_shifts (org_id, person_id, date DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vol_shifts_import ON volunteer_shifts (org_id, import_key) WHERE import_key IS NOT NULL`);

  // ── BUILD-98 (switch) Part 6 — A KEY THAT OPENS ONE ORG, READ ONLY ─────
  // A key is shown ONCE and stored as its SHA-256; the prefix is kept so a
  // list can say which key is which. Revoked keys stay as rows (who made
  // it, when it was last used) — a revoke is a fact, not a delete.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes JSONB NOT NULL DEFAULT '["read"]'::jsonb,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (org_id, created_at DESC)`);
  // Wealth screening is a PAID ADD-ON later (DonorSearch / iWave). These are
  // the vendor's own figures, kept so an import from a CRM that has them does
  // not throw them away. They are NOT Steward's wealth_score and never feed it.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_screen_source TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_screen_rating TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_screen_capacity TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_screen_date TEXT`);

  // ── BUILD-98 (switch) Part 8 — TWO-STEP SIGN-IN FOR STAFF ──────────────
  // The secret is SEALED (shared/secretBox, AAD = the org id), never stored
  // readable. `mfa_last_counter` makes every code single-use. The org rule
  // is off by default: turning it on is an admin's act, and only an admin
  // who already has two-step on may do it.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_sealed TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_sealed TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_counter BIGINT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS require_admin_mfa BOOLEAN DEFAULT false`);

  // ── BUILD-101 — MEMBERSHIPS ────────────────────────────────────────────
  // A level: a price, the org's stated fair-market value of its benefits
  // (never more than the price — the BUILD-98 event-level CHECK), a term.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membership_levels (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK (price > 0),
      fmv NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fmv >= 0),
      term TEXT NOT NULL CHECK (term IN ('12_months','calendar_year','lifetime')),
      scope TEXT NOT NULL DEFAULT 'individual' CHECK (scope IN ('individual','household')),
      benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT true,
      position INTEGER DEFAULT 0,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (fmv <= price)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_membership_levels_org ON membership_levels (org_id, position)`);
  // A membership: one person on one level. The payment is a GIFT (recordGift,
  // quid-pro-quo = the level's FMV); gift_id points at it. Dates are civil.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id),
      household_id TEXT,
      level_id TEXT NOT NULL REFERENCES membership_levels(id),
      joined_on TEXT NOT NULL,
      starts_on TEXT NOT NULL,
      expires_on TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','grace','lapsed','cancelled')),
      payment_method TEXT,
      gift_id TEXT,
      source TEXT NOT NULL DEFAULT 'staff',
      cancelled_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // ONE CURRENT MEMBERSHIP PER PERSON PER ORG — the database decides, never
  // an if-statement. A member in their grace period still holds it.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_current
                      ON memberships (org_id, donor_id) WHERE status IN ('active','grace')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_memberships_org_expiry ON memberships (org_id, status, expires_on)`);
  // BUILD-101 Part 2 — renewals. A renewed membership keeps its row and says
  // so ('renewed'), the new term is a new row pointing back at it, and the
  // renewal thread raised for an expiry is recorded against THAT expiry, so a
  // second sweep over the same date finds nothing to do.
  await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewed_from TEXT`);
  await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_thread_id TEXT`);
  await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_thread_for TEXT`);
  await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status_changed_on TEXT`);
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='memberships_status_check'
                       AND pg_get_constraintdef(oid) LIKE '%renewed%') THEN
        ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
        ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
          CHECK (status IN ('active','grace','lapsed','cancelled','renewed'));
      END IF; END $$`);
  // The two numbers an org may change: how early the renewal thread opens, and
  // how long an expired membership is held in grace before it lapses.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS membership_renewal_days INTEGER DEFAULT 30`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS membership_grace_days INTEGER DEFAULT 30`);

  // Record this file's hash LAST — only a fully-completed init marks the
  // schema current, so a crash mid-init re-runs the whole thing next boot.
  await pool.query(
    `INSERT INTO schema_meta (id, schema_hash, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, updated_at = NOW()`,
    [SCHEMA_HASH]);
}

async function seedData() {
  const orgId = "org_creo";
  const userId = "user_admin";

  await pool.query(
    `INSERT INTO orgs (id, name, mission, ein, onboarding_complete)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [orgId, "CREO Arts", "Transformative arts education for underserved NYC youth", "47-1234567", 1]
  );

  const hash = bcrypt.hashSync("demo1234", 10);
  await pool.query(
    // BUILD-86 C.3 — a REAL first name. The greeting, the actor stamp on every
    // write and the officer chip on every row all render this; "Admin User" on
    // a demo screen tells a prospect they are looking at a fixture.
    //
    // BUILD-87 F.3.7 — AND IT HAS TO REACH THE ORG THAT ALREADY EXISTS. C.3
    // changed the literal and stopped there, so a fresh scratch database got
    // the real name and PRODUCTION's demo org — created long before, and
    // therefore hitting `ON CONFLICT DO NOTHING` on every boot since — kept
    // saying "Admin User" on every row. That is what was on the screen on 16
    // September. The name is the ONE column this upsert may correct: the
    // password, the email and the role are somebody's login and stay put.
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [userId, orgId, "admin@creoarts.org", hash, "Mike Henderson", "admin"]
  );

  // ── BUILD-92 A1 — THE DEMO ORG'S OWN WORDS, ON A FRESH DATABASE ──────────
  // BUILD-86 Part B gave the demo org Heart of Africa's vocabulary, but only
  // through `scripts/seed-build86-vocabulary.js`, run by hand against one
  // server. A fresh database therefore came up saying "donors" and "funds" —
  // the generic words BUILD-86 exists to avoid — until somebody remembered to
  // run the script. The words belong to the seed.
  //   Keys are exactly shared/vocabulary.js's VOCAB_KEYS; the values are the
  // ones in that script, kept in step with it.
  //   `WHERE vocabulary_json IS NULL` is what makes this idempotent AND safe:
  // an org that has answered the vocabulary questions (including this demo org
  // once somebody edits it in Settings) is never overwritten on a later boot.
  await pool.query(
    `UPDATE orgs SET vocabulary_json = $2, vocabulary_set_at = NOW()
      WHERE id = $1 AND vocabulary_json IS NULL`,
    [orgId, JSON.stringify({
      giver_singular: "sponsor",
      giver_plural: "sponsors",
      monthly_giver_singular: "sponsor",
      monthly_giver_plural: "sponsors",
      fund_singular: "designation",
      fund_plural: "designations",
      fiscal_year_start_month: 7,
      season_name: "Spring Campaign",
      season_date: "2027-06-30",
    })]
  );

  const donors = [
    ["d1", orgId, "Margaret Chen",         "m.chen@example.com",    "212-555-0101", "major",  "steward",   24500, 5000,  "2024-11-15", 8, '["board-adjacent","arts"]',  "Prefers phone calls. Interested in youth programming. Has mentioned potentially increasing giving this year."],
    ["d2", orgId, "Robert & Lisa Atkinson", "ratkinson@example.com", "917-555-0234", "mid",    "steward",   12000, 3000,  "2025-01-03", 5, '["education","recurring"]',  "Both educators. Very engaged with after-school programs. Anniversary donors."],
    ["d3", orgId, "James Okafor",           "jokafor@example.com",   "646-555-0387", "lapsed", "lapsed",     3200,  500,  "2023-09-22", 4, '["youth"]',                  "Lapsed 18+ months. Was a regular $500 donor. Worth personal outreach."],
    ["d4", orgId, "Sunrise Foundation",     "grants@sunrisefdn.org", "212-555-0199", "major",  "steward",   75000, 25000, "2025-03-01", 3, '["foundation","arts"]',      "Program officer is Angela Wu. Next grant cycle opens September."],
    ["d5", orgId, "Diana Torres",           "dtorres@example.com",   "718-555-0421", "new",    "cultivate",   850,  250,  "2025-02-14", 3, '["online"]',                 "Online donor via Instagram. Young professional. Good upgrade potential."],
    ["d6", orgId, "William Park",           "wpark@example.com",     "347-555-0512", "mid",    "solicit",    6700, 1000,  "2024-06-30", 7, '["recurring","arts"]',       "Long-time supporter. Consistent annual donor. Approaching 11 months since last gift."],
  ];
  for (const d of donors) {
    await pool.query(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      d
    );
  }

  const interactions = [
    ["i1", orgId, "d1", "gift",    "Annual major gift $5,000",                      "2024-11-15"],
    ["i2", orgId, "d1", "call",    "Cultivation call - discussed new mural program", "2024-09-10"],
    ["i3", orgId, "d1", "event",   "Attended spring gala, table host",               "2024-06-01"],
    ["i4", orgId, "d2", "gift",    "Annual gift $3,000",                             "2025-01-03"],
    ["i5", orgId, "d3", "gift",    "Last donation $500",                             "2023-09-22"],
    ["i6", orgId, "d4", "meeting", "Site visit with Angela Wu",                      "2025-02-15"],
    ["i7", orgId, "d4", "gift",    "Annual grant $25,000",                           "2025-03-01"],
  ];
  for (const i of interactions) {
    await pool.query(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,null) ON CONFLICT (id) DO NOTHING`,
      i
    );
  }

  const grants = [
    ["g1", orgId, "NEA",                      "Arts Education Initiative", 35000, 35000, "active",      "2025-06-30", "2025-07-15", "Sarah Kim",    "Final report pending.",                          '["2023: $30,000","2024: $35,000"]'],
    ["g2", orgId, "NY Community Trust",        "Youth Development",         50000, 25000, "active",      "2025-12-31", "2026-01-15", "Marcus Reid",  "Mid-year report submitted.",                     '["2024: $40,000"]'],
    ["g3", orgId, "Rockefeller Brothers Fund", "Cultural Innovation",        20000,     0, "pending",     "2025-08-01", null,         "Angela Moore", "LOI submitted. Full proposal invited.",           '["First-time applicant"]'],
    ["g4", orgId, "City Council",              "Cultural Programs FY25",    15000, 15000, "closed",      "2024-12-31", "2025-02-01", "James Liu",    "Completed. FY26 opens July.",                    '["2023: $12,000","2024: $15,000"]'],
    ["g5", orgId, "Ford Foundation",           "Creative Communities",     100000,     0, "prospecting", "2025-09-15", null,         "Sarah Kim",    "Competitive. Need strong theory of change.",      '["First-time applicant"]'],
  ];
  for (const g of grants) {
    await pool.query(
      `INSERT INTO grants (id,org_id,funder,program,amount,received,status,deadline,report_due,officer,notes,history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  const volunteers = [
    ["v1", orgId, "Priya Nair",    "pnair@example.com",   84,  '["event coordination","social media"]', "2025-04-12", null,  "high",      "Google",   "Very enthusiastic. Works in tech — capacity likely $500-1000 first gift."],
    ["v2", orgId, "Carlos Mendez", "cmendez@example.com", 210, '["teaching","curriculum"]',             "2025-05-01", null,  "high",      "NYC DOE",  "Most dedicated volunteer. Teaches after-school weekly. Deep mission alignment."],
    ["v3", orgId, "Sophie Laurent","slaurent@example.com",  32, '["design","photography"]',             "2025-03-20", null,  "medium",    "Freelance","Provided design work for annual report."],
    ["v4", orgId, "Devon Brooks",  "dbrooks@example.com", 156, '["accounting","admin"]',                "2025-04-28", "d3", "converted", "Deloitte", "Already a donor. Helps with books quarterly. Strong board candidate."],
  ];
  for (const v of volunteers) {
    await pool.query(
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,last_active,donor_id,convert_potential,employer,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      v
    );
  }

  const tasks = [
    ["t1", orgId, "Call Margaret Chen — major gift conversation", "2025-05-23", "high",   "donor",     0, "d1"],
    ["t2", orgId, "Submit NEA final report",                      "2025-07-15", "high",   "grant",     0, null],
    ["t3", orgId, "Follow up: Rockefeller LOI status",            "2025-06-01", "medium", "grant",     0, null],
    ["t4", orgId, "Re-engage James Okafor (lapsed 18mo)",         "2025-05-28", "medium", "donor",     0, "d3"],
    ["t5", orgId, "Board packet — Q2 financials",                 "2025-05-30", "high",   "board",     0, null],
    ["t6", orgId, "Volunteer appreciation event planning",        "2025-06-15", "low",    "volunteer", 1, null],
  ];
  for (const t of tasks) {
    await pool.query(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      t
    );
  }

  const board = [
    ["b1", orgId, "Dr. Angela Washington", "Chair",     "Columbia University",            "2023-2026", "$10,000", '["Executive","Finance"]',   92],
    ["b2", orgId, "Marcus Powell",          "Treasurer", "JPMorgan Chase",                 "2022-2025", "$5,000",  '["Finance","Audit"]',       100],
    ["b3", orgId, "Keisha Brown",           "Secretary", "Brooklyn Community Foundation",  "2024-2027", "$2,500",  '["Programs","DEI"]',         83],
    ["b4", orgId, "Tom Ricci",              "Member",    "Ricci Architecture",             "2023-2026", "$5,000",  '["Facilities","Executive"]', 75],
    ["b5", orgId, "Yun Li",                 "Member",    "Goldman Sachs",                  "2024-2027", "$7,500",  '["Finance","Fundraising"]',  92],
  ];
  for (const b of board) {
    await pool.query(
      `INSERT INTO board_members (id,org_id,name,role,employer,term,giving_level,committees,attendance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      b
    );
  }

  const months = [
    ["f1", orgId, "Jan", 2025,  8200, 12000,    0,  500, 14000, 4200, 2100],
    ["f2", orgId, "Feb", 2025,  5400,     0,    0,  200, 13500, 4200, 1800],
    ["f3", orgId, "Mar", 2025, 11000, 25000, 4200,  800, 15200, 4400, 3200],
    ["f4", orgId, "Apr", 2025,  7300,     0,    0,  300, 14800, 4200, 2400],
    ["f5", orgId, "May", 2025,  9100,     0,    0,  150, 15100, 4300, 2200],
  ];
  for (const m of months) {
    await pool.query(
      `INSERT INTO financials (id,org_id,month,year,individual,grants,events,other_revenue,programs,admin,fundraising)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  const funds = [
    ["fn1", orgId, "General Operating",          42000, 0],
    ["fn2", orgId, "NEA Arts Education",          35000, 1],
    ["fn3", orgId, "NY Community Trust — Youth",  25000, 1],
    ["fn4", orgId, "Gala Reserve",                 8200, 0],
  ];
  for (const f of funds) {
    await pool.query(
      `INSERT INTO funds (id,org_id,name,balance,restricted)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      f
    );
  }

  // ── Gift history (for annual fund dashboard) ────────────────────────────
  const gifts = [
    ["gft_23_01", orgId, "d1", 4000,  "2023-10-15", "cash",   "Annual Appeal",      ""],
    ["gft_23_02", orgId, "d2", 2500,  "2023-01-10", "check",  "Annual Fund",         ""],
    ["gft_23_03", orgId, "d3",  500,  "2023-09-22", "cash",   "General",             ""],
    ["gft_23_04", orgId, "d4", 20000, "2023-03-15", "wire",   "NEA Grant",           ""],
    ["gft_23_05", orgId, "d6", 1000,  "2023-07-01", "cash",   "Mid-Year",            ""],
    ["gft_23_06", orgId, "d1", 2000,  "2023-06-01", "cash",   "Gala",                ""],
    ["gft_23_07", orgId, "d4", 15000, "2023-09-01", "wire",   "Community Trust",     ""],
    ["gft_24_01", orgId, "d1", 5000,  "2024-11-15", "cash",   "Annual Major Gift",   ""],
    ["gft_24_02", orgId, "d2", 2800,  "2024-01-08", "check",  "Annual Fund",         ""],
    ["gft_24_03", orgId, "d4", 25000, "2024-03-01", "wire",   "NEA Grant",           ""],
    ["gft_24_04", orgId, "d5",  250,  "2024-12-15", "online", "Holiday Appeal",      ""],
    ["gft_24_05", orgId, "d6", 1000,  "2024-06-30", "cash",   "Mid-Year",            ""],
    ["gft_24_06", orgId, "d1", 2000,  "2024-06-01", "cash",   "Gala",                ""],
    ["gft_24_07", orgId, "d4", 25000, "2024-10-01", "wire",   "Community Trust",     ""],
    ["gft_24_08", orgId, "d2",  500,  "2024-08-20", "online", "Giving Tuesday",      ""],
    ["gft_25_01", orgId, "d2", 3000,  "2025-01-03", "check",  "Annual Fund",         ""],
    ["gft_25_02", orgId, "d4", 25000, "2025-03-01", "wire",   "NEA Grant",           ""],
    ["gft_25_03", orgId, "d5",  250,  "2025-02-14", "online", "Valentine Appeal",    ""],
    ["gft_25_04", orgId, "d4", 25000, "2025-01-15", "wire",   "Community Trust Q1",  ""],
    ["gft_25_05", orgId, "d1", 1500,  "2025-04-05", "cash",   "Spring Appeal",       ""],
    ["gft_25_06", orgId, "d6",  600,  "2025-03-15", "online", "Spring Campaign",     ""],
  ];
  for (const g of gifts) {
    await pool.query(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // ── Programs ────────────────────────────────────────────────────────────
  const programs = [
    [
      "prg_01", orgId, "After-School Arts",
      "Weekly arts education for K-8 students in underserved neighborhoods",
      85000, 52000, '["Carlos Mendez","Sophie Laurent"]', 120,
      "2024-09-01", "2025-06-30", "active",
      "Students showed 40% improvement in creative confidence assessments. Program served 120 students across 4 schools in Brooklyn and the Bronx.",
      '{"students_served":120,"schools":4,"sessions_completed":28,"avg_attendance_rate":"87%"}'
    ],
    [
      "prg_02", orgId, "Summer Intensive",
      "6-week intensive program for advanced students ages 14-18, focusing on portfolio development and college readiness.",
      45000, 18000, '["Carlos Mendez"]', 32,
      "2025-07-07", "2025-08-15", "planning",
      "Builds on after-school skills with college-prep portfolio development. Target: 85% of students complete portfolio.",
      '{"students_enrolled":32,"portfolio_completion_target":"100%","college_readiness_goal":"85%"}'
    ],
  ];
  for (const p of programs) {
    await pool.query(
      `INSERT INTO programs (id,org_id,name,description,budget,spent,staff,participant_count,start_date,end_date,status,outcomes,metrics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      p
    );
  }

  // ── Annual fund goal ─────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO annual_fund_goals (id,org_id,year,goal)
     VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
    ["afg_01", orgId, 2025, 250000]
  );

  // ── Draft campaign ────────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,recipient_count,open_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [
      "cmp_01", orgId, "Spring Appeal 2025", "appeal",
      "Help us reach 120 more students — a message from CREO Arts",
      "Dear {{donor_name}},\n\nYour support has made an incredible difference. This year, CREO Arts served 120 students across 4 NYC schools.\n\nAs we plan for fall, we need your help to expand our reach. A gift of any size helps us purchase art supplies, pay teaching artists, and keep our programs free for students who need them most.\n\nYour previous gift of {{gift_amount}} made a real impact. Will you renew your support today?\n\nWith gratitude,\nThe CREO Arts Team",
      "draft",
      '{"stages":["steward","solicit"],"statuses":["major","mid"]}',
      0, 0
    ]
  );

  // ── Chart of Accounts ────────────────────────────────────────────────────
  const chartOfAccounts = [
    ["acc_1010", orgId, "1010", "Cash & Cash Equivalents",            "asset",     "current"],
    ["acc_1020", orgId, "1020", "Savings / Reserve Account",          "asset",     "current"],
    ["acc_1100", orgId, "1100", "Accounts Receivable",                "asset",     "current"],
    ["acc_1200", orgId, "1200", "Prepaid Expenses",                   "asset",     "current"],
    ["acc_2010", orgId, "2010", "Accounts Payable",                   "liability", "current"],
    ["acc_2100", orgId, "2100", "Accrued Expenses",                   "liability", "current"],
    ["acc_2200", orgId, "2200", "Deferred Revenue",                   "liability", "current"],
    ["acc_3010", orgId, "3010", "Unrestricted Net Assets",            "net_asset", "unrestricted"],
    ["acc_3100", orgId, "3100", "Temporarily Restricted Net Assets",  "net_asset", "restricted"],
    ["acc_3200", orgId, "3200", "Permanently Restricted Net Assets",  "net_asset", "restricted"],
    ["acc_4010", orgId, "4010", "Individual Contributions",           "revenue",   "contributions"],
    ["acc_4020", orgId, "4020", "Foundation Grants",                  "revenue",   "grants"],
    ["acc_4030", orgId, "4030", "Government Grants",                  "revenue",   "grants"],
    ["acc_4040", orgId, "4040", "Program Revenue",                    "revenue",   "program"],
    ["acc_4050", orgId, "4050", "Special Events Revenue",             "revenue",   "events"],
    ["acc_4060", orgId, "4060", "Other Revenue",                      "revenue",   "other"],
    ["acc_5010", orgId, "5010", "Program Services — Salaries",        "expense",   "program"],
    ["acc_5020", orgId, "5020", "Program Services — Supplies",        "expense",   "program"],
    ["acc_5030", orgId, "5030", "Program Services — Contractors",     "expense",   "program"],
    ["acc_5040", orgId, "5040", "Program Services — Occupancy",       "expense",   "program"],
    ["acc_6010", orgId, "6010", "Management & General — Salaries",    "expense",   "management"],
    ["acc_6020", orgId, "6020", "Management & General — Admin",       "expense",   "management"],
    ["acc_6030", orgId, "6030", "Management & General — Technology",  "expense",   "management"],
    ["acc_7010", orgId, "7010", "Fundraising — Salaries",             "expense",   "fundraising"],
    ["acc_7020", orgId, "7020", "Fundraising — Events",               "expense",   "fundraising"],
    ["acc_7030", orgId, "7030", "Fundraising — Marketing",            "expense",   "fundraising"],
  ];
  for (const a of chartOfAccounts) {
    await pool.query(
      `INSERT INTO accounts (id,org_id,code,name,type,subtype)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      a
    );
  }

  // ── Finance Funds ─────────────────────────────────────────────────────────
  const finFunds = [
    ["ff_01", orgId, "General Operating",         "General unrestricted operating fund", false],
    ["ff_02", orgId, "NEA Arts Education",         "NEA grant — restricted to arts education programs", true],
    ["ff_03", orgId, "NY Community Trust — Youth", "Community Trust grant — restricted to youth development", true],
    ["ff_04", orgId, "Gala Reserve",              "Board-designated reserve for annual gala", false],
  ];
  for (const f of finFunds) {
    await pool.query(
      `INSERT INTO fin_funds (id,org_id,name,description,restricted)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      f
    );
  }

  // ── Sample Transactions 2025 ──────────────────────────────────────────────
  const finTxns = [
    ["ft_01", orgId, "2025-01-03",  "Annual Fund Gift — Atkinson",        "Robert Atkinson",       3000,  "income",  "acc_4010", "ff_01"],
    ["ft_02", orgId, "2025-01-15",  "Community Trust Q1 Disbursement",    "NY Community Trust",    25000, "income",  "acc_4020", "ff_03"],
    ["ft_03", orgId, "2025-02-14",  "Valentine Appeal — Torres",          "Diana Torres",          250,   "income",  "acc_4010", "ff_01"],
    ["ft_04", orgId, "2025-03-01",  "NEA Spring Disbursement",            "NEA",                   25000, "income",  "acc_4030", "ff_02"],
    ["ft_05", orgId, "2025-04-05",  "Spring Appeal — Chen",               "Margaret Chen",         1500,  "income",  "acc_4010", "ff_01"],
    ["ft_06", orgId, "2025-03-15",  "Spring Campaign — Park",             "William Park",          600,   "income",  "acc_4010", "ff_01"],
    ["ft_07", orgId, "2025-05-10",  "Foundation Grant — Q2",              "Sunrise Foundation",    10000, "income",  "acc_4020", "ff_02"],
    ["ft_08", orgId, "2025-01-15",  "Program Staff — January",            "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_09", orgId, "2025-01-20",  "Art Supplies — Q1",                  "Blick Art Materials",   1200,  "expense", "acc_5020", "ff_02"],
    ["ft_10", orgId, "2025-01-31",  "Office Rent — January",              "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_11", orgId, "2025-02-15",  "Program Staff — February",           "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_12", orgId, "2025-02-28",  "Office Rent — February",             "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_13", orgId, "2025-03-15",  "Program Staff — March",              "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_14", orgId, "2025-03-20",  "Admin Software — Q1",               "Quickbooks, Zoom",      450,   "expense", "acc_6030", "ff_01"],
    ["ft_15", orgId, "2025-03-31",  "Office Rent — March",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_16", orgId, "2025-04-15",  "Program Staff — April",              "Payroll",               8500,  "expense", "acc_5010", "ff_02"],
    ["ft_17", orgId, "2025-04-20",  "Teaching Artist Contractors",        "Carlos Mendez",         3000,  "expense", "acc_5030", "ff_02"],
    ["ft_18", orgId, "2025-04-30",  "Office Rent — April",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_19", orgId, "2025-05-15",  "Program Staff — May",                "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_20", orgId, "2025-05-20",  "Spring Gala Expenses",               "Event Venue",           4200,  "expense", "acc_7020", "ff_04"],
  ];
  for (const t of finTxns) {
    await pool.query(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      t
    );
  }

  // ── Annual Budgets 2025 ────────────────────────────────────────────────────
  const budgets2025 = [
    ["bgt_4010", orgId, "acc_4010", 2025, 75000],
    ["bgt_4020", orgId, "acc_4020", 2025, 60000],
    ["bgt_4030", orgId, "acc_4030", 2025, 50000],
    ["bgt_4050", orgId, "acc_4050", 2025, 12000],
    ["bgt_5010", orgId, "acc_5010", 2025, 102000],
    ["bgt_5020", orgId, "acc_5020", 2025, 12000],
    ["bgt_5030", orgId, "acc_5030", 2025, 24000],
    ["bgt_5040", orgId, "acc_5040", 2025, 38400],
    ["bgt_6010", orgId, "acc_6010", 2025, 48000],
    ["bgt_6020", orgId, "acc_6020", 2025, 6000],
    ["bgt_6030", orgId, "acc_6030", 2025, 3600],
    ["bgt_7010", orgId, "acc_7010", 2025, 18000],
    ["bgt_7020", orgId, "acc_7020", 2025, 8000],
    ["bgt_7030", orgId, "acc_7030", 2025, 4000],
  ];
  for (const b of budgets2025) {
    await pool.query(
      // BUILD-92 A1 — the conflict target must name the index that SURVIVES.
      // The CREATE TABLE above declares UNIQUE (org_id, account_id, year), but
      // the BUILD-88a fund migration (this file, "A BUDGET HAS A FUND") DROPS
      // that constraint and replaces it with budgets_account_year_fund on
      // (org_id, account_id, year, COALESCE(fund_id, '')). Naming the dropped
      // three-column target threw 42P10 on every boot, and because seedData is
      // one un-chunked async function that aborted the WHOLE REST of the demo
      // seed. These rows are the general, unfunded budget — one per
      // org/account/year with no fund — so COALESCE(fund_id,'') is exactly
      // right, and matches the upsert in server.js's budget route.
      `INSERT INTO budgets (id,org_id,account_id,year,amount)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, account_id, year, COALESCE(fund_id, '')) DO NOTHING`,
      b
    );
  }

  // ── Program grants ────────────────────────────────────────────────────────
  const programGrants = [
    ["pg_01", orgId, "prg_01", "g1", 35000],
    ["pg_02", orgId, "prg_01", "g2", 25000],
  ];
  for (const pg of programGrants) {
    await pool.query(
      `INSERT INTO program_grants (id,org_id,program_id,grant_id,allocated)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (program_id, grant_id) DO NOTHING`,
      pg
    );
  }

  // ── Impact metrics (for milestone/anniversary donor emails) ────────────────
  const impactMetrics = [
    ["im_01", orgId, "Art Supplies Kit", 50, "Your ${amount} has provided art supplies kits for {n} students"],
    ["im_02", orgId, "After-School Workshop", 300, "Your ${amount} has funded {n} after-school arts workshops"],
    ["im_03", orgId, "Full-Year Scholarship", 2500, "Your ${amount} has covered {n} full-year arts program scholarships"],
  ];
  for (const m of impactMetrics) {
    await pool.query(
      `INSERT INTO impact_metrics (id,org_id,name,dollar_threshold,outcome_template)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  // ── Dashboard revamp enrichment (2026-07) ─────────────────────────────────
  // org_creo's real donor set (CSV-imported at some point post-launch) only
  // ever lands in 'cultivate' or 'lapsed' — inferStage() never assigns
  // qualify/solicit, and cultivate/lapsed dominate. These fill out the other
  // four pipeline stages, add grants with deadlines that are actually still
  // in the future, some recent activity, and a few pending milestone_drafts
  // so the Dashboard's new milestone widget has real content. Dates are
  // computed relative to seed time rather than hardcoded, so they don't go
  // stale the way g1-g5's 2025 deadlines did.
  // ORG_TZ_SEAM_OK — org_creo sits in the seam's default zone; a seed run in
  // the UTC evening must not date everything for tomorrow.
  const seedToday = orgTime.orgToday({});
  const seedAgo = n => orgTime.addDays(seedToday, -n);
  const seedFromNow = n => orgTime.addDays(seedToday, n);

  const stageDonors = [
    ["dseed_01", orgId, "Priya Anand",     "panand@example.com",    "212-555-0801", "new",   "prospect", 0,     null, null,         0, '["board-referral"]', "Introduced by a board member at the spring gala. Not yet engaged.", null],
    ["dseed_02", orgId, "Marcus Webb",     "mwebb@example.com",     "718-555-0802", "new",   "prospect", 0,     null, null,         0, '["cold"]',           "Identified via prospect research. Local business owner, arts-adjacent.", null],
    ["dseed_03", orgId, "Renee Castillo",  "rcastillo@example.com", "347-555-0803", "new",   "qualify",  0,     null, null,         0, '["referral"]',       "Researching giving capacity. Attended an info session, hasn't given yet.", null],
    ["dseed_04", orgId, "Owen Bishop",     "obishop@example.com",   "929-555-0804", "new",   "qualify",  250,   250,  seedAgo(40),  1, '["first-gift"]',     "Made a small first gift after the winter showcase. Assessing upgrade potential.", seedAgo(40)],
    ["dseed_05", orgId, "Vanessa Cole",    "vcole@example.com",     "917-555-0805", "mid",   "solicit",  8000,  3000, seedAgo(200), 2, '["arts","overdue"]', "Ready for the ask — capacity signals are strong. Overdue for a follow-up call.", seedAgo(650)],
    ["dseed_06", orgId, "Julian Marsh",    "jmarsh@example.com",    "646-555-0806", "mid",   "solicit",  15000, 5000, seedAgo(150), 2, '["recurring"]',      "Consistent annual donor, due for this year's ask conversation.", seedAgo(900)],
    ["dseed_07", orgId, "Camille Torres",  "ctorres@example.com",   "212-555-0807", "mid",   "steward",  3200,  500,  seedAgo(20),  3, '["arts","loyal"]',   "Just crossed $2,500 lifetime giving. Warm relationship, steady giver.", seedAgo(920)],
    ["dseed_08", orgId, "Nathaniel Cross", "ncross@example.com",    "718-555-0808", "new",   "steward",  1050,  300,  seedAgo(35),  2, '["arts"]',           "Recently crossed $1,000 lifetime giving. Responsive to email outreach.", seedAgo(410)],
    ["dseed_09", orgId, "Elena Marchetti", "emarchetti@example.com","212-555-0809", "major", "steward",  12500, 5000, seedAgo(15),  3, '["arts","loyal"]',   "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent.", seedAgo(1000)],
  ];
  for (const d of stageDonors) {
    await pool.query(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,first_gift_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      d
    );
  }

  const stageGifts = [
    ["gftseed_04a", orgId, "dseed_04", 250,  seedAgo(40),   "online", "Winter Showcase",  ""],
    ["gftseed_05a", orgId, "dseed_05", 3000, seedAgo(200),  "check",  "Annual Fund",       ""],
    ["gftseed_05b", orgId, "dseed_05", 5000, seedAgo(650),  "check",  "Gala",              ""],
    ["gftseed_06a", orgId, "dseed_06", 5000, seedAgo(150),  "wire",   "Annual Fund",       ""],
    ["gftseed_06b", orgId, "dseed_06", 10000,seedAgo(900),  "wire",   "Capital Campaign",  ""],
    ["gftseed_07a", orgId, "dseed_07", 500,  seedAgo(20),   "online", "Spring Appeal",     ""],
    ["gftseed_07b", orgId, "dseed_07", 700,  seedAgo(300),  "cash",   "Gala",              ""],
    ["gftseed_07c", orgId, "dseed_07", 2000, seedAgo(920),  "check",  "Annual Fund",       ""],
    ["gftseed_08a", orgId, "dseed_08", 300,  seedAgo(35),   "online", "Spring Appeal",     ""],
    ["gftseed_08b", orgId, "dseed_08", 750,  seedAgo(410),  "cash",   "Annual Fund",       ""],
    ["gftseed_09a", orgId, "dseed_09", 5000, seedAgo(15),   "check",  "Annual Major Gift", ""],
    ["gftseed_09b", orgId, "dseed_09", 4500, seedAgo(400),  "check",  "Capital Campaign",  ""],
    ["gftseed_09c", orgId, "dseed_09", 3000, seedAgo(1000), "check",  "Annual Fund",       ""],
  ];
  for (const g of stageGifts) {
    await pool.query(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // A couple of grants with real near-future deadlines — g1-g5 above are all
  // 2025-dated and have long since passed, which is why the Dashboard's
  // Grant Deadlines widget always read empty.
  const upcomingGrants = [
    ["gseed_01", orgId, "Robert Wood Johnson Foundation", "Arts & Wellbeing Initiative", 45000, 0, "pending",     seedFromNow(12), null, "Dana Whitfield", "LOI accepted — full proposal under review.", '["First-time applicant"]'],
    ["gseed_02", orgId, "Mellon Foundation",               "Community Arts Access",       60000, 0, "prospecting", seedFromNow(25), null, "Priya Raman",    "Site visit completed; decision expected soon.", '["First-time applicant"]'],
  ];
  for (const g of upcomingGrants) {
    await pool.query(
      `INSERT INTO grants (id,org_id,funder,program,amount,received,status,deadline,report_due,officer,notes,history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // Recent activity so the Dashboard feed isn't empty
  const recentActivity = [
    ["iseed_01", orgId, "dseed_07", "gift",    "Gift received — $500 (Spring Appeal)",                                                                        seedAgo(20)],
    ["iseed_02", orgId, "dseed_07", "call",    "Thank-you call for recent gift — warm response",                                                              seedAgo(18)],
    ["iseed_03", orgId, "dseed_08", "email",   "Subject: Thank you for your generous support\n\nSo grateful for your continued generosity toward our after-school program.", seedAgo(9)],
    ["iseed_04", orgId, "dseed_09", "meeting", "Coffee meeting — discussed fall gala sponsorship",                                                             seedAgo(5)],
    ["iseed_05", orgId, "dseed_05", "call",    "Cultivation call — discussed program impact, gauging interest in a leadership gift",                          seedAgo(13)],
    ["iseed_06", orgId, "dseed_02", "note",    "Introduced by board member; interested in youth arts programming",                                            seedAgo(2)],
  ];
  for (const i of recentActivity) {
    await pool.query(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,null) ON CONFLICT (id) DO NOTHING`,
      i
    );
  }

  // Pending milestone drafts — populates the Dashboard's new review-queue
  // widget with real content on first load instead of another empty state.
  // Mirrors what generateMilestoneDraft() would actually produce: warm,
  // specific, no gamification language.
  const milestoneDrafts = [
    ["mdseed_01", orgId, "dseed_07", null, "threshold_2500",
     "Camille, a quick thank you",
     "Camille — I wanted to pause and let you know you've now given $3,200 with us. That total has now covered a full year of scholarship support for one of our students. It's donors like you, giving steadily and thoughtfully, who make that kind of continuity possible. Thank you for sticking with us.",
     "pending_review"],
    ["mdseed_02", orgId, "dseed_08", null, "threshold_1000",
     "Nathaniel — a thank you at $1,000",
     "Nathaniel — you've now given $1,050 total, and that's enough to fund three after-school arts workshops for our students. I don't think we've properly thanked you for how consistent you've been. It matters more than you probably realize. Thank you.",
     "pending_review"],
    // Elena's $10,000 crossing is NOT here — per the Phase 2 note/email split
    // (isNoteMoment() in server.js), $10k+ thresholds get a "write a note"
    // reminder instead of an AI-drafted email. See noteReminders below.
  ];
  for (const m of milestoneDrafts) {
    await pool.query(
      `INSERT INTO milestone_drafts (id,org_id,donor_id,sequence_enrollment_id,milestone_key,subject,body,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  // Personal-note reminders — real, computed talking points (not AI-drafted
  // text) for the org's highest-value/most-personal milestone moments.
  // Mirrors the shape computeNoteTalkingPoints() would actually produce.
  const elenaFirst = seedAgo(1000); // civil YYYY-MM-DD, via the seam
  const elenaYears = Math.floor(1000 / 365.25);
  const julianLastGift = seedAgo(150);
  const noteReminders = [
    ["notereminder_01", orgId, "dseed_09", null, "threshold_10000", JSON.stringify([
      "Just crossed $10,000 in total lifetime giving ($12,500 total).",
      'From their file: "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent."',
      `They've been giving for ${elenaYears} years — since ${orgTime.formatCivil(elenaFirst).replace(/ \d+,/, "")}.`,
    ]), "pending"],
    ["notereminder_02", orgId, "dseed_06", null, "anniversary_year_2", JSON.stringify([
      "This marks their 2-year anniversary with your organization.",
      'From their file: "Consistent annual donor, due for this year\'s ask conversation."',
      `Most recent gift: $5,000 on ${orgTime.formatCivil(julianLastGift)}.`,
    ]), "pending"],
  ];
  for (const n of noteReminders) {
    await pool.query(
      `INSERT INTO note_reminders (id,org_id,donor_id,sequence_enrollment_id,milestone_key,talking_points,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      n
    );
  }

  // A real active fundraising goal so the home screen's goal banner has
  // something to show on first load instead of the empty state.
  await pool.query(
    `INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    ["goalseed_01", orgId, seedAgo(30), seedFromNow(60), "total_raised", 25000, "Raise $25,000 this quarter"]
  );

  // Historical trend for the stewardship-debt / first-touch-delay metrics —
  // 21 daily points so the home screen's headline number has a real trend
  // to draw on first load, not just today's single value. The synthetic
  // curve is scaled off a baseline computed with the same formula
  // computeStewardshipDebt() uses (mirrored here since server.js isn't
  // importable from db.js), rather than an arbitrary illustrative number —
  // org_creo's real (mostly CSV-imported) donor set makes the actual value
  // much larger than a hand-picked constant, and a mismatched seed curve
  // would show up as a jarring, misleading cliff on the sparkline the first
  // time this endpoint computes the real live number. Debt trending down
  // (staff catching up on outreach); first-touch delay roughly flat.
  const debtBaselineRows = await pool.query(
    `SELECT d.total_giving,
       COALESCE(
         (SELECT MAX(i.date) FROM interactions i WHERE i.donor_id = d.id AND i.type IN ('call','meeting','email','stewardship')),
         d.first_gift_date
       ) AS last_contact
     FROM donors d
     WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.total_giving > 0`,
    [orgId]
  );
  let debtBaseline = 0;
  for (const row of debtBaselineRows.rows) {
    if (!row.last_contact) continue;
    // civil-days between the stored civil date and the seam's seed today
    const gap = orgTime.daysBetween(String(row.last_contact).slice(0, 10), seedToday);
    if (gap == null) continue;
    const daysSince = Math.max(0, Math.min(1000, gap));
    debtBaseline += (daysSince / 30) * ((Number(row.total_giving) || 0) / 1000);
  }
  debtBaseline = Math.round(debtBaseline) || 400;

  const touchBaselineRows = await pool.query(
    `SELECT d.first_gift_date,
       (SELECT MIN(i.date) FROM interactions i
        WHERE i.donor_id = d.id AND i.type IN ('call','meeting','email','stewardship') AND i.date >= d.first_gift_date) AS first_touch_date
     FROM donors d
     WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.first_gift_date IS NOT NULL`,
    [orgId]
  );
  let touchTotalDays = 0, touchSampleSize = 0;
  for (const row of touchBaselineRows.rows) {
    if (!row.first_touch_date) continue;
    touchTotalDays += Math.max(0, Math.floor((new Date(row.first_touch_date) - new Date(row.first_gift_date)) / 86400000));
    touchSampleSize++;
  }
  const touchBaseline = touchSampleSize > 0 ? Math.round(touchTotalDays / touchSampleSize) : 6;

  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    const date = seedAgo(daysAgo);
    const debtValue = Math.round(debtBaseline * (1 + daysAgo * 0.018) + Math.sin(daysAgo) * debtBaseline * 0.02);
    const touchValue = Math.max(1, Math.round(touchBaseline * (1 + Math.sin(daysAgo / 3) * 0.15)));
    await pool.query(
      // DO UPDATE (not DO NOTHING) deliberately: this seed shipped once
      // already with an arbitrary, badly-scaled baseline (see comment
      // above) — an already-deployed org's rows need the corrected,
      // data-derived values to actually replace them, not be skipped.
      `INSERT INTO metric_snapshots (id,org_id,metric_key,value,snapshot_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      // Date-stable id (was msseed_debt_${daysAgo}): with a fixed id and a
      // day-shifting date, the FIRST boot of a new day found no
      // (org,key,date) conflict-target match and fell through to the id
      // PRIMARY KEY → 23505 → db init failed → process exit. A crash-loop
      // time bomb on any deploy/restart crossing a date boundary (found
      // live 2026-08-05 on the scratch stack at local midnight). With the
      // date IN the id, an id collision implies a target match — idempotent
      // by construction, every day.
      [`msseed_debt_${date}`, orgId, "stewardship_debt", debtValue, date]
    );
    await pool.query(
      `INSERT INTO metric_snapshots (id,org_id,metric_key,value,snapshot_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      [`msseed_touch_${date}`, orgId, "first_touch_delay", touchValue, date]
    );
  }
}

// ── Blank org seeding (called from onboarding flow) ───────────────────────────
// Seeds structural data only — no sample donors, grants, or financials.
async function seedOrgData(orgId) {
  // Skip if already seeded
  const existing = await pool.query("SELECT id FROM accounts WHERE org_id = $1 LIMIT 1", [orgId]);
  if (existing.rows.length > 0) return;

  // Standard nonprofit chart of accounts
  const chartOfAccounts = [
    ["1010", "Cash & Cash Equivalents",            "asset",     "current"],
    ["1020", "Savings / Reserve Account",           "asset",     "current"],
    ["1100", "Accounts Receivable",                "asset",     "current"],
    ["1200", "Prepaid Expenses",                   "asset",     "current"],
    ["2010", "Accounts Payable",                   "liability", "current"],
    ["2100", "Accrued Expenses",                   "liability", "current"],
    ["2200", "Deferred Revenue",                   "liability", "current"],
    ["3010", "Unrestricted Net Assets",            "net_asset", "unrestricted"],
    ["3100", "Temporarily Restricted Net Assets",  "net_asset", "restricted"],
    ["3200", "Permanently Restricted Net Assets",  "net_asset", "restricted"],
    ["4010", "Individual Contributions",           "revenue",   "contributions"],
    ["4020", "Foundation Grants",                  "revenue",   "grants"],
    ["4030", "Government Grants",                  "revenue",   "grants"],
    ["4040", "Program Revenue",                    "revenue",   "program"],
    ["4050", "Special Events Revenue",             "revenue",   "events"],
    ["4060", "Other Revenue",                      "revenue",   "other"],
    ["5010", "Program Services — Salaries",        "expense",   "program"],
    ["5020", "Program Services — Supplies",        "expense",   "program"],
    ["5030", "Program Services — Contractors",     "expense",   "program"],
    ["5040", "Program Services — Occupancy",       "expense",   "program"],
    ["6010", "Management & General — Salaries",    "expense",   "management"],
    ["6020", "Management & General — Admin",       "expense",   "management"],
    ["6030", "Management & General — Technology",  "expense",   "management"],
    ["7010", "Fundraising — Salaries",             "expense",   "fundraising"],
    ["7020", "Fundraising — Events",               "expense",   "fundraising"],
    ["7030", "Fundraising — Marketing",            "expense",   "fundraising"],
  ];

  for (const [code, name, type, subtype] of chartOfAccounts) {
    await pool.query(
      `INSERT INTO accounts (id, org_id, code, name, type, subtype) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`acc_${uuid().slice(0, 8)}`, orgId, code, name, type, subtype]
    );
  }

  // Single General Operating fund
  await pool.query(
    `INSERT INTO fin_funds (id, org_id, name, description, restricted) VALUES ($1, $2, $3, $4, $5)`,
    [`ff_${uuid().slice(0, 8)}`, orgId, "General Operating", "General unrestricted operating fund", false]
  );
}

module.exports = { getDb, query, run, uuid, seedOrgData, withTransaction, withAdvisoryLock, queryTx, runTx };
