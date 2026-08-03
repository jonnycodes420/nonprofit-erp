require("dotenv").config();
const { Pool } = require("pg");
const { randomUUID: uuid } = require("crypto");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDb() {
  await initSchema();
  await seedData();
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

async function initSchema() {
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_subs_donor ON recurring_subscriptions (org_id, donor_id)`);

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
  // Per-org sequence for receipt numbers, always incremented via
  // UPDATE ... RETURNING (never SELECT MAX+1 — see allocateReceiptNumber()
  // in server.js) so two concurrent issues can never collide on a number.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_counter INTEGER DEFAULT 0`);

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
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
    [userId, orgId, "admin@creoarts.org", hash, "Admin User", "admin"]
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
      `INSERT INTO budgets (id,org_id,account_id,year,amount)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, account_id, year) DO NOTHING`,
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
  const seedNow = new Date();
  const seedAgo = n => { const d = new Date(seedNow); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; };
  const seedFromNow = n => { const d = new Date(seedNow); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };

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
  const elenaFirst = new Date(seedNow); elenaFirst.setDate(elenaFirst.getDate() - 1000);
  const elenaYears = Math.floor(1000 / 365.25);
  const julianLastGift = new Date(seedNow); julianLastGift.setDate(julianLastGift.getDate() - 150);
  const noteReminders = [
    ["notereminder_01", orgId, "dseed_09", null, "threshold_10000", JSON.stringify([
      "Just crossed $10,000 in total lifetime giving ($12,500 total).",
      'From their file: "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent."',
      `They've been giving for ${elenaYears} years — since ${elenaFirst.toLocaleDateString("en-US",{month:"long",year:"numeric"})}.`,
    ]), "pending"],
    ["notereminder_02", orgId, "dseed_06", null, "anniversary_year_2", JSON.stringify([
      "This marks their 2-year anniversary with your organization.",
      'From their file: "Consistent annual donor, due for this year\'s ask conversation."',
      `Most recent gift: $5,000 on ${julianLastGift.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.`,
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
  const nowMs = seedNow.getTime();
  for (const row of debtBaselineRows.rows) {
    if (!row.last_contact) continue;
    const daysSince = Math.max(0, Math.min(1000, Math.floor((nowMs - new Date(row.last_contact).getTime()) / 86400000)));
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
      [`msseed_debt_${daysAgo}`, orgId, "stewardship_debt", debtValue, date]
    );
    await pool.query(
      `INSERT INTO metric_snapshots (id,org_id,metric_key,value,snapshot_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      [`msseed_touch_${daysAgo}`, orgId, "first_touch_delay", touchValue, date]
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
