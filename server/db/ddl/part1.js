// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 1 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { query, run } = require("../query");
const { keepEarlierTotals } = require("../seed");

// `pool` here is the init session, as it was in runSchemaInit.
async function run1(pool) {
// SPLIT-2 db.js piece 42
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
  // ── INT-4 — A MAILBOX BELONGS TO A PERSON, AND ITS TOKENS ARE SEALED ──────
  //
  // `gmail_connections` above stored `access_token` and `refresh_token` as bare
  // TEXT: a staff member's entire mailbox, in plaintext, while every other
  // connection in this product seals its credentials with the org as AAD. This
  // table replaces it. The tokens live in one `credentials_sealed` envelope,
  // the row is keyed by USER because the consent is hers and not the
  // organisation's, and `paused` is her switch rather than an admin's.
  //
  // The old rows are migrated below and the plaintext columns are emptied.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailbox_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credentials_sealed TEXT,
      token_expires_at TIMESTAMPTZ,
      paused BOOLEAN DEFAULT false,
      history_cursor TEXT,
      last_synced_at TIMESTAMPTZ,
      last_tried_at TIMESTAMPTZ,
      last_logged_count INTEGER,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT mailbox_sealed_only CHECK (
        credentials_sealed IS NULL OR credentials_sealed LIKE 'v1.%'
      ),
      CONSTRAINT mailbox_status CHECK (status IN ('active','error','disconnected'))
    )`);
  // One live mailbox per person per provider. She may connect Gmail AND
  // Outlook; she may not have two live Gmail rows racing each other.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailbox_one_live
                    ON mailbox_connections (user_id, provider) WHERE status <> 'disconnected'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailbox_org ON mailbox_connections (org_id, status)`);

  // HER LIST, NOT THE ORGANISATION'S. An address or a bare domain she never
  // wants logged: her doctor, her children's school, the job she is applying
  // for. Keyed by user, and no admin route reads or writes it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailbox_never_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      pattern TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailbox_never_log_once
                    ON mailbox_never_log (user_id, pattern)`);

  // "Do not log this one", for good. The same idea as gmail_sync_exclusions,
  // widened to carry the provider so an Outlook message id cannot collide with
  // a Gmail one. The old table is read alongside it so nothing she already
  // removed comes back.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailbox_exclusions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT,
      provider TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailbox_exclusions_once
                    ON mailbox_exclusions (org_id, provider, message_id)`);

  // ── THE ONE-SHOT MIGRATION OFF PLAINTEXT ─────────────────────────────────
  // INT-BUILD-1 Part 1 — THE CALENDAR. Whether this connection's consent
  // included the calendar scope (INT-4 connections did not, and they keep
  // logging mail until she adds it), and the meetings themselves.
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS calendar_granted BOOLEAN NOT NULL DEFAULT false`);
  // FIX-28: she can put Steward's dates that are hers onto this calendar.
  // Off until she turns it on; calendar_pushes remembers each entry made.
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS push_dates BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_pushes (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      item_key TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      day TEXT NOT NULL,
      title TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, provider, item_key)
    )`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS calendar_synced_at TIMESTAMPTZ`);
  // ONE ROW PER MEETING WITH SOMEBODY ON FILE, AND SIX FIELDS FROM THE
  // PROVIDER (shared/calendarLog.js): title, start, end, location, the
  // matched people, the owner. No description, no attendee addresses. The
  // columns after those are HERS, written when she logs how it went.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      owner_user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      location TEXT,
      person_ids TEXT[] NOT NULL,
      booked_in_steward BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      next_step TEXT,
      logged_at TIMESTAMPTZ,
      logged_by TEXT,
      interaction_id TEXT,
      dismissed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT calendar_events_has_person CHECK (cardinality(person_ids) > 0)
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_once
                    ON calendar_events (org_id, owner_user_id, provider, provider_event_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_org_start ON calendar_events (org_id, starts_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_people ON calendar_events USING GIN (person_ids)`);

  // Every live gmail_connections row is sealed into mailbox_connections and
  // its plaintext columns are then emptied, so a connected person keeps
  // working and the cleartext stops existing.
  //
  // IT FAILS CLOSED. Without STEWARD_CREDENTIAL_KEY there is no sealing, and
  // the honest response is to leave the rows exactly as they are and say so
  // loudly rather than either inventing a plaintext fallback (which is the
  // thing being removed) or deleting somebody's working connection to tidy up.
  try {
    const [{ rows: pending }] = [await pool.query(
      `SELECT g.* FROM gmail_connections g
        WHERE g.refresh_token IS NOT NULL AND g.refresh_token <> ''
          AND NOT EXISTS (SELECT 1 FROM mailbox_connections m
                           WHERE m.user_id = g.user_id AND m.provider = 'google')`)];
    if (pending.length) {
      const { sealBag, credentialsConfigured } = await import("../../../shared/secretBox.js");
      if (!credentialsConfigured()) {
        console.error(`[mailbox] ${pending.length} Gmail connection(s) still hold PLAINTEXT tokens: STEWARD_CREDENTIAL_KEY is not set, so they were left untouched. Set it and restart to seal them.`);
      } else {
        let done = 0;
        for (const g of pending) {
          try {
            const sealed = sealBag(
              { accessToken: g.access_token || null, refreshToken: g.refresh_token, scope: null },
              { aad: g.org_id });
            await pool.query(
              `INSERT INTO mailbox_connections
                 (id, org_id, user_id, provider, address, status, credentials_sealed, token_expires_at,
                  history_cursor, last_synced_at, created_by, created_by_name)
               VALUES ($1,$2,$3,'google',$4,$5,$6,$7,$8,$9,'system:mailbox-migration','INT-4 migration')
               ON CONFLICT DO NOTHING`,
              [`mbx_${g.id}`, g.org_id, g.user_id, g.email,
               g.status === "active" ? "active" : "disconnected",
               sealed, g.token_expiry, g.history_id, g.last_synced_at]);
            // The cleartext goes only after the sealed copy is committed.
            await pool.query(
              `UPDATE gmail_connections SET access_token='', refresh_token='' WHERE id=$1`, [g.id]);
            done++;
          } catch (e) { console.error(`[mailbox] could not migrate gmail_connections ${g.id}:`, e.message); }
        }
        if (done) console.log(`[mailbox] sealed ${done} Gmail connection(s) and cleared their plaintext tokens`);
      }
    }
  } catch (e) { console.error("[mailbox] migration check failed:", e.message); }

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
  // FIX-10 Part C — WHICH GIFT MADE THIS TASK. Deleting a gift used to leave
  // its own thank-you task standing: "Thank Ruth, $500 just came in" against a
  // $500 gift that no longer existed anywhere, and no way to tell that task
  // apart from one a person had typed. This column is that way. It is stamped
  // ONLY where a gift's arrival creates the task, so a hand-written task has
  // it NULL by construction and can never be voided by a delete.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_gift_id TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS voided_reason TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_source_gift ON tasks (org_id, source_gift_id) WHERE source_gift_id IS NOT NULL`);
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
  // FIX-49 Part 5 · each running recipe became a journey (workflowsToJourneys.js).
  // One row per recipe: converted (a new journey), joined (an existing running
  // journey on the same event) or kept (no journey does this), with the reason.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_conversions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      workflow_id TEXT,
      recipe_key TEXT NOT NULL,
      journey_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('converted','joined','kept')),
      reason TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workflow_conversions_org ON workflow_conversions(org_id, created_at DESC)`);
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
  // NUMBERS-2 · AN IMPORTED TOTAL IS ITS OWN FIGURE (donorSummary.js). What
  // the old system stated: the total, count, first and last gift, the last day
  // it covers (`imported_through`), the source's words and the day it came in.
  // No recompute writes these; Lifetime is imported_total plus the gifts dated
  // after imported_through.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_total NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_gift_count INTEGER`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_first_gift_date TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_last_gift_date TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_last_gift_amount NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_through TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_source TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_on TEXT`);
  await keepEarlierTotals(pool);

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

  // BUILD-100 (grants) Part 1 — A GRANT'S MONEY COULD NOT HOLD CENTS.
  // `grants.amount` and `grants.received` have been INTEGER since the original
  // schema, exactly as the gift columns above were until BUILD-08 Phase B found
  // it live. A foundation awards $10,000 far more often than $10,000.37, which
  // is why this survived — but an award applied from a real payment schedule, or
  // a currency-converted one, is a number this column would have thrown on. The
  // brief asks for the pipeline total IN CENTS, which this made impossible.
  // Same guarded shape: only run the rewrite while the column is still integer.
  for (const [tbl, col] of [["grants", "amount"], ["grants", "received"]]) {
    await pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}' AND data_type='integer') THEN
        ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE NUMERIC USING ${col}::numeric;
      END IF;
    END $$;`);
  }
// SPLIT-2 end
}

module.exports = { run: run1 };
