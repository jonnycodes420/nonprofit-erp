// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 7 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { orgTime } = require("../pool");
const { query, run } = require("../query");
const { SCHEMA_HASH } = require("../schemaHash");
const { backfillLinkedTasks, householdsFromLinks } = require("../seed");

// `pool` here is the init session, as it was in runSchemaInit.
async function run7(pool) {
// SPLIT-2 db.js piece 48
  await pool.query(`ALTER TABLE volunteer_signups ADD COLUMN IF NOT EXISTS role_id TEXT REFERENCES volunteer_slot_roles(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_signups_role ON volunteer_signups (role_id, status) WHERE role_id IS NOT NULL`);
  // Shift reminders and per-shift thank-yous are DRAFTS in the one review
  // queue (milestone_drafts), keyed vol:<kind>:<signup id> so a sweep that
  // runs twice writes one draft, not two. Staff send them, in one tap.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_milestone_drafts_vol_key
                      ON milestone_drafts (org_id, milestone_key) WHERE milestone_key LIKE 'vol:%'`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS slot_id TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS send_error TEXT`);

  // Part 1. An hour logged knows the opportunity and shift it was given to,
  // the clock times when it was logged that way, and who last changed it.
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS opportunity_id TEXT`);
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS slot_id TEXT`);
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS start_time TEXT`);
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS end_time TEXT`);
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_shifts_opp ON volunteer_shifts (org_id, opportunity_id, date) WHERE opportunity_id IS NOT NULL`);

  // Part 1. A volunteer's tags and qualifications: a skill ("Spanish"), a
  // certification with an expiry ("First aid", to 2027-03-01), or a tag
  // ("Saturday regular"). Background checks and waivers stay in
  // volunteer_credentials, which already holds a dated thing that lapses.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_qualifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('skill','certification','tag')),
      name TEXT NOT NULL,
      expires_on TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vol_qual ON volunteer_qualifications (org_id, person_id, kind, lower(name))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_qual_name ON volunteer_qualifications (org_id, kind, lower(name))`);
  // A coordinator's note is INTERNAL unless she says the volunteer may see it,
  // in which case it shows on their own page. Every note before this is internal.
  await pool.query(`ALTER TABLE volunteer_notes ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'`);

  // Part 2. THE RECRUITMENT PAGE, one per org: what the coordinator wrote
  // (rich text, sanitised by shared/richText.js before it is stored), the
  // questions the application asks, and whether it is live.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_recruitment (
      org_id TEXT PRIMARY KEY REFERENCES orgs(id),
      title TEXT NOT NULL DEFAULT 'Volunteer with us',
      body_html TEXT NOT NULL DEFAULT '',
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by TEXT, updated_by_name TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // An APPLICATION is what somebody sent from that page. It is not a person
  // until a coordinator approves it; approving matches them by email to the
  // record already on file (a donor stays one person) or makes one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_applications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      availability JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
      person_id TEXT REFERENCES donors(id) ON DELETE SET NULL,
      matched_existing BOOLEAN,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      decided_at TIMESTAMPTZ, decided_by TEXT, decided_by_name TEXT,
      created_by TEXT NOT NULL DEFAULT 'system:volunteer-apply', created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_apps_org ON volunteer_applications (org_id, status, submitted_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_apps_person ON volunteer_applications (org_id, person_id) WHERE person_id IS NOT NULL`);

  // ── VOL-PAGE-1 · THE VOLUNTEER PAGE IS A PAGE LIKE A GIVING PAGE ─────────
  // One table of public pages, so one editor, one list, one search and one
  // embed. `page_kind` says which surface of the widget registry it uses;
  // every read that means "a page that takes gifts" filters on 'give'.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS page_kind TEXT NOT NULL DEFAULT 'give'`);
  // What a role card shows, typed once on the role and never on the page.
  await pool.query(`ALTER TABLE volunteer_opportunities ADD COLUMN IF NOT EXISTS commitment TEXT`);
  await pool.query(`ALTER TABLE volunteer_opportunities ADD COLUMN IF NOT EXISTS skills TEXT`);
  // Each sign-up through a volunteer page: who, what they told us, and the
  // shift booking it made (none for "tell me when there is something").
  // This is the row the page's Sign-ups figure opens.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_page_signups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      page_id TEXT NOT NULL REFERENCES giving_pages(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      signup_id TEXT REFERENCES volunteer_signups(id) ON DELETE SET NULL,
      group_id TEXT REFERENCES volunteer_groups(id) ON DELETE SET NULL,
      group_size INTEGER,
      availability TEXT,
      interests JSONB NOT NULL DEFAULT '[]'::jsonb,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      matched BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_page_signups ON volunteer_page_signups (org_id, page_id, created_at DESC)`);
  // FIX-24 Part 1: the volunteer record made by staff (or the Agent) from a
  // person already on file: an APPROVED application with how many hours a week
  // they can give and the roles they will do. `via` says who made it: 'page'
  // (they applied), 'staff' or 'agent'. One per person is kept current by
  // makeVolunteer (server.js); a second press updates it, never adds one.
  await pool.query(`ALTER TABLE volunteer_applications ADD COLUMN IF NOT EXISTS hours_per_week NUMERIC(5,2)`);
  await pool.query(`ALTER TABLE volunteer_applications ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE volunteer_applications ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'page'`);

  // ── CLEAN-1 · DATA HEALTH ─────────────────────────────────────────────────
  // A MERGE IS UNDOABLE FOR 30 DAYS. Both people as they were, every row that
  // moved (table, column, row id) and every row set aside because the kept
  // record already had its twin, so undo restores both records and every row
  // exactly. The pure rules are dataHealth.js; the writer is routes/dataHealth.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_merges (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      kept_id TEXT NOT NULL,
      merged_id TEXT NOT NULL,
      kept_name TEXT, merged_name TEXT,
      kept_before JSONB NOT NULL,
      merged_before JSONB NOT NULL,
      moved JSONB NOT NULL DEFAULT '[]'::jsonb,
      set_aside JSONB NOT NULL DEFAULT '[]'::jsonb,
      choices JSONB,
      note_id TEXT,
      confidence TEXT,
      reasons JSONB,
      bulk BOOLEAN DEFAULT false,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      undone_at TIMESTAMPTZ, undone_by TEXT, undone_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_merges_org ON donor_merges (org_id, created_at DESC)`);
  // "Not a duplicate", "this role address is right" and the like: remembered
  // by key, so the same pair never comes back after the next import.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_health_dismissals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, kind, key)
    )`);
  // IMPORT-5: a couple written with a comma, fixed from Data health on her
  // click. One row per record changed, a batch per click, so Undo puts the
  // name back and removes the second person and the household it made.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS name_fixes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      before_name TEXT NOT NULL,
      before_spouse_name TEXT,
      before_household_id TEXT,
      after_name TEXT NOT NULL,
      created_donor_id TEXT,
      created_household_id TEXT,
      undone_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_name_fixes_batch ON name_fixes (org_id, batch_id)`);
  // FIX-59: a name with markup or a note in it ("Sadie (send with
  // Tess's) Norwood") is cleaned on her click and the note moved to Notes;
  // the Notes as they were, for its Undo.
  await pool.query(`ALTER TABLE name_fixes ADD COLUMN IF NOT EXISTS before_notes TEXT`);
  // FIX-59: imported gifts she says were already deposited, marked on her
  // click from Finance. One row per gift, a batch per click, so Undo puts
  // each gift's deposit columns back exactly as they were.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deposit_marks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      import_id TEXT,
      before_deposited_on TEXT,
      before_deposit_ref TEXT,
      undone_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposit_marks_batch ON deposit_marks (org_id, batch_id)`);
  // FIX-58: a pledge's installment dates moved from the event's day to Dec 31
  // from Data health on her click. One row per date changed (installment_id
  // NULL for the pledge's own due date), a batch per click, for its Undo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pledge_date_fixes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      pledge_id TEXT NOT NULL,
      installment_id TEXT,
      before_due TEXT NOT NULL,
      after_due TEXT NOT NULL,
      undone_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pledge_date_fixes_batch ON pledge_date_fixes (org_id, batch_id)`);
  // AGENT-2: A MERGE SOMEBODY PROPOSED. The Agent never merges two people;
  // told "merge the two Ellen Parks" it puts the pair at the top of CLEAN-1's
  // duplicate queue with the instruction as the reason, and a person commits
  // the merge there. The pair is stored in key order (dataHealth pairKey).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merge_proposals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      a TEXT NOT NULL,
      b TEXT NOT NULL,
      reason TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_merge_proposals_pair ON merge_proposals (org_id, a, b)`);
  // One row per run (after an import, once a night, or by hand): the counts
  // as they stood, and how many possible duplicates the import itself left.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_health_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      trigger TEXT NOT NULL CHECK (trigger IN ('import','nightly','manual')),
      import_id TEXT,
      counts JSONB NOT NULL,
      new_duplicates INTEGER NOT NULL DEFAULT 0,
      dismissed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_health_runs_org ON data_health_runs (org_id, created_at DESC)`);
  // FIX-59: Data health also re-checks after an import's undo, a merge, a
  // merge's undo and a bulk delete, and the page says which.
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_health_runs_trigger_check'
                     AND pg_get_constraintdef(oid) LIKE '%merge_undo%') THEN
      ALTER TABLE data_health_runs DROP CONSTRAINT IF EXISTS data_health_runs_trigger_check;
      ALTER TABLE data_health_runs ADD CONSTRAINT data_health_runs_trigger_check
        CHECK (trigger IN ('import','nightly','manual','undo','merge','merge_undo','delete'));
    END IF;
  END $$`);
  // The old address, kept. A tidy or a change of address never overwrites
  // without leaving the previous one here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_address_history (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('tidy','ncoa','ncoa_unmailable')),
      before JSONB NOT NULL,
      after JSONB,
      ncoa_move_id TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_addr_history_donor ON donor_address_history (org_id, donor_id, created_at DESC)`);
  // AGENT-2: an address changed on purpose (PATCH /donors/:id/contact) is history too.
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donor_address_history_source_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%edit%') THEN
      ALTER TABLE donor_address_history DROP CONSTRAINT donor_address_history_source_check;
      ALTER TABLE donor_address_history ADD CONSTRAINT donor_address_history_source_check
        CHECK (source IN ('tidy','ncoa','ncoa_unmailable','edit'));
    END IF; END $$`);
  // A change-of-address (NCOA) file a licensed provider returned, and each
  // move in it. A move waits for a person to approve it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ncoa_batches (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      filename TEXT,
      rows_in INTEGER NOT NULL DEFAULT 0,
      moves INTEGER NOT NULL DEFAULT 0,
      no_forwarding INTEGER NOT NULL DEFAULT 0,
      no_move INTEGER NOT NULL DEFAULT 0,
      unmatched INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ncoa_moves (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      batch_id TEXT NOT NULL REFERENCES ncoa_batches(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('move','no_forwarding')),
      code TEXT, words TEXT,
      move_type TEXT, move_date TEXT,
      old_address JSONB NOT NULL,
      new_address JSONB,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
      decided_at TIMESTAMPTZ, decided_by TEXT, decided_by_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ncoa_moves_org ON ncoa_moves (org_id, status)`);
  // A change of address with no forwarding address: the address stays as it
  // was (it is history, not a guess) and is marked not mailable.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address_unmailable BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address_unmailable_reason TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS address_unmailable_at TIMESTAMPTZ`);
  // IMPORT-5 (7d): a phone a note says is wrong ("Incorrect number") is kept
  // as history and never dialed or texted from Steward. Schema only.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS phone_unreachable BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS phone_unreachable_reason TEXT`);

  // ── PROSPECT-1 · ROOM TO GIVE ────────────────────────────────────────────
  // Who may see it: admins always, and staff an admin has given the major
  // gifts permission. Read live on every request (prospect.js), never from the JWT.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_major_gifts BOOLEAN NOT NULL DEFAULT false`);
  // A screening file a provider returned, and what came back for each person
  // it matched. Stored as the provider wrote it (ranges, never one number),
  // with the provider's name and the date it was screened.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screening_imports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      provider TEXT NOT NULL,
      screened_on TEXT NOT NULL,
      filename TEXT,
      rows_in INTEGER NOT NULL DEFAULT 0,
      matched INTEGER NOT NULL DEFAULT 0,
      unmatched JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screening_results (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      import_id TEXT REFERENCES screening_imports(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      screened_on TEXT NOT NULL,
      capacity_low_cents BIGINT, capacity_high_cents BIGINT,
      real_estate_low_cents BIGINT, real_estate_high_cents BIGINT,
      other_gifts TEXT, foundation_ties TEXT, business_affiliations TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_screening_results_donor ON screening_results (org_id, donor_id, created_at DESC)`);
  // A public filing for an organisation with an EIN, as last looked up (cache:
  // a person presses the button; a page render never calls out).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public_filings (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      ein TEXT NOT NULL,
      name TEXT,
      total_assets_cents BIGINT, grants_paid_cents BIGINT,
      tax_year INTEGER, form TEXT, filing_url TEXT, source_url TEXT,
      found BOOLEAN NOT NULL DEFAULT true,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL, created_by_name TEXT,
      PRIMARY KEY (org_id, donor_id)
    )`);
  // A file only major gifts staff may open (a prospect brief).
  await pool.query(`ALTER TABLE donor_materials ADD COLUMN IF NOT EXISTS major_gifts_only BOOLEAN NOT NULL DEFAULT false`);

  // FIX-22: the public filing comes from the IRS's own public-domain file, the
  // Exempt Organizations Business Master File, loaded by
  // scripts/ci/load-irs-bmf.js into irs_bmf (one row per EIN, every org reads it,
  // nobody's private data). A lookup reads this table only; nothing calls out
  // on a page render or on a button press. Money is whole dollars in the file,
  // stored as cents. tax_period is the file's YYYYMM.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS irs_bmf (
      ein TEXT PRIMARY KEY,
      name TEXT,
      city TEXT, state TEXT,
      subsection TEXT, foundation TEXT, ntee_cd TEXT,
      assets_cents BIGINT, income_cents BIGINT, revenue_cents BIGINT,
      tax_period TEXT,
      source_file TEXT NOT NULL,
      source_date DATE NOT NULL,
      loaded_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`ALTER TABLE public_filings ADD COLUMN IF NOT EXISTS revenue_cents BIGINT`);
  await pool.query(`ALTER TABLE public_filings ADD COLUMN IF NOT EXISTS income_cents BIGINT`);
  await pool.query(`ALTER TABLE public_filings ADD COLUMN IF NOT EXISTS tax_period TEXT`);
  await pool.query(`ALTER TABLE public_filings ADD COLUMN IF NOT EXISTS source_file TEXT`);
  await pool.query(`ALTER TABLE public_filings ADD COLUMN IF NOT EXISTS source_date DATE`);

  // ── FIX-33 · EVERY SYNC RUN IS A ROW ──────────────────────────────────────
  // "Connected" said nothing about whether Steward had read anything. Each
  // mail read, calendar read and calendar push writes one row here, ok or not,
  // with what it found and the one plain sentence of what went wrong. The
  // health panel, the reconnect banner, the error digest and the prod smoke
  // all read this table, so they cannot disagree.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailbox_sync_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      ok BOOLEAN,
      found INTEGER,
      logged INTEGER,
      error TEXT,
      trigger TEXT,
      CONSTRAINT mailbox_sync_runs_kind CHECK (kind IN ('mail','calendar','push'))
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailbox_sync_runs_user ON mailbox_sync_runs (user_id, provider, kind, started_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailbox_sync_runs_org ON mailbox_sync_runs (org_id, started_at DESC)`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS calendar_error TEXT`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS calendar_tried_at TIMESTAMPTZ`);
  // SCALE-2 · how far the first read of a new connection has got (0 to 99),
  // NULL when no first read is under way.
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS read_progress SMALLINT`);
  // FIX-34 · each API the connection needs, as last checked (apiCheck.js);
  // a 429 skips the connection until retry_after; the Gmail history id and
  // the calendar's last read time make a run with nothing new one small call;
  // the calendar a visit was last booked on, per person.
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS api_check JSONB`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS api_checked_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS gmail_history_id TEXT`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS calendar_read_from TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_booking_provider TEXT`);
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS graph_delta JSONB`);

  // ── PUSH-1 · INSTANT UPDATES ──────────────────────────────────────────────
  // One row per channel Google or Microsoft keeps for a connection: the Gmail
  // watch, the Calendar channel, and Graph's Inbox, Sent Items and events
  // subscriptions. The secret each notice must carry is stored only as its
  // SHA-256. Nothing a notice says about a message or a meeting is kept here;
  // only when the last one arrived.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailbox_push (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      channel_id TEXT,
      resource_id TEXT,
      secret_hash TEXT,
      expires_at TIMESTAMPTZ,
      renewed_at TIMESTAMPTZ,
      last_notified_at TIMESTAMPTZ,
      notices INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'on',
      paused_reason TEXT,
      paused_at TIMESTAMPTZ,
      retry_at TIMESTAMPTZ,
      last_error TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT mailbox_push_kind CHECK (kind IN ('gmail','gcal','graph_inbox','graph_sent','graph_events')),
      CONSTRAINT mailbox_push_status CHECK (status IN ('on','paused')),
      UNIQUE (connection_id, kind)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mailbox_push_channel ON mailbox_push (channel_id)`);
  // The calendar's incremental sync token (Google), so "anything new?" is one call.
  await pool.query(`ALTER TABLE mailbox_connections ADD COLUMN IF NOT EXISTS gcal_sync_token TEXT`);

  // ── FIX-33 · A CALENDAR EVENT STEWARD IS NOT SURE ABOUT ───────────────────
  // A title that names somebody on file ("Visit with Christine") with two
  // Christines on file is kept with both as CANDIDATES and nobody linked, so
  // a person picks. An event with neither a linked person nor a candidate is
  // still never stored.
  await pool.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS candidate_ids TEXT[] NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS matched_by TEXT`);
  await pool.query(`ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_has_person`);
  await pool.query(`ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_has_person
                    CHECK (cardinality(person_ids) > 0 OR cardinality(candidate_ids) > 0)`);

  // ── FIX-33 · WHAT A BOOKED MEETING DID TO THE RECORD ──────────────────────
  // One row per (meeting, person): the step it took over (and what that step
  // was before, so a cancel can put it back), the prep task, the after task,
  // and the journey steps it pushed past the meeting. meetingEffects.js is
  // the only writer.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_effects (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      calendar_event_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      day TEXT NOT NULL,
      thread_id TEXT,
      thread_created BOOLEAN NOT NULL DEFAULT false,
      prev_step JSONB,
      prep_task_id TEXT,
      after_task_id TEXT,
      moved_steps JSONB NOT NULL DEFAULT '[]',
      booked_interaction_id TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS meeting_effects_once ON meeting_effects (calendar_event_id, donor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_effects_donor ON meeting_effects (org_id, donor_id)`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS calendar_event_id TEXT`);
  await pool.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS calendar_event_id TEXT`);
  // FIX-31 · ONE RECORD, THREE VIEWS. A next step (a thread) and a grant
  // deadline each keep one task in step with them, written HERE, by the
  // database, because a thread is opened, moved and closed from a dozen
  // routes and a hook in each would miss the thirteenth. The task carries
  // `thread_id` or `milestone_id` + `link_kind`; the reverse direction (a task
  // ticked in Tasks or on the Calendar) goes through the task routes, which
  // close the thread or mark the deadline the same way their own screens do.
  // link_kind: next_step · deadline · deadline_start (the heads-up).
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS thread_id TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS milestone_id TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link_kind TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_thread ON tasks (thread_id) WHERE thread_id IS NOT NULL`);
  // TASKS-2 · A TASK A DIRECTOR RUNS HER WEEK FROM. Its kind (call, email,
  // meeting, thank-you, write, other; NULL = read from its words), a time of
  // day, notes, a checklist, a repeat, the snooze and its reason, a household
  // it is about, and who finished it when. shared/taskShape.js owns the rules.
  for (const col of ["kind TEXT", "due_time TEXT", "notes TEXT", "checklist JSONB DEFAULT '[]'::jsonb", "recur JSONB",
                     "recur_parent_id TEXT", "snooze_reason TEXT", "snoozed_from TEXT", "snoozed_at TIMESTAMPTZ",
                     "household_id TEXT", "completed_at TIMESTAMPTZ", "completed_by_name TEXT", "reassign_note TEXT"]) {
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee ON tasks (org_id, assigned_to) WHERE voided_at IS NULL`);
  // JOURNEYS-4 · HOW A CALL OR A MEETING ENDED, as one of the outcomes in
  // shared/journeyShape.js TASK_OUTCOMES. A task_outcome journey watches it.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outcome TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_milestone ON tasks (milestone_id, link_kind) WHERE milestone_id IS NOT NULL`);
  // The heads-up before a proposal, LOI or report: days ahead, 0 = off.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS grant_headsup_days INTEGER DEFAULT 14`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_thread_task_sync() RETURNS TRIGGER AS $fn$
    DECLARE owner_ok TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        DELETE FROM tasks WHERE thread_id = OLD.id AND org_id = OLD.org_id;
        RETURN OLD;
      END IF;
      -- A deadline's own follow-up is the deadline's task, never a second one.
      IF EXISTS (SELECT 1 FROM grant_milestones m WHERE m.thread_id = NEW.id AND m.org_id = NEW.org_id) THEN
        DELETE FROM tasks WHERE thread_id = NEW.id AND org_id = NEW.org_id;
        RETURN NEW;
      END IF;
      SELECT u.id INTO owner_ok FROM users u WHERE u.id = NEW.owner_id AND u.org_id = NEW.org_id;
      -- source_gift_id: a step a gift opened (the thank-you) is that gift's own
      -- task, so deleting the gift voids it with the rest (FIX-10 Part C).
      -- A closed step's voided task stays voided; an open one is never voided.
      INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, assigned_to, assigned_to_name,
                         thread_id, link_kind, source_gift_id, updated_at, created_by, created_by_name)
      VALUES ('t_ns_' || substr(md5(NEW.id), 1, 14), NEW.org_id, NEW.next_step_label, LEFT(NEW.due_date, 10), 'medium', 'donor',
              CASE WHEN NEW.closed_at IS NULL THEN 0 ELSE 1 END, NEW.donor_id, owner_ok, CASE WHEN owner_ok IS NULL THEN NULL ELSE NEW.owner_name END,
              NEW.id, 'next_step', NEW.opening_gift_id, NOW(), COALESCE(NEW.created_by, 'system:thread'), COALESCE(NEW.created_by_name, 'Steward'))
      ON CONFLICT (thread_id) WHERE thread_id IS NOT NULL DO UPDATE
         -- Never donor_id: a thread changes person only in a merge, and the
         -- merge moves tasks.donor_id itself, so its Undo puts the row back exactly.
         SET title = EXCLUDED.title, due = EXCLUDED.due, done = EXCLUDED.done,
             assigned_to = EXCLUDED.assigned_to, assigned_to_name = EXCLUDED.assigned_to_name,
             voided_at = CASE WHEN EXCLUDED.done = 1 THEN tasks.voided_at ELSE NULL END, updated_at = NOW()
       WHERE (tasks.title, tasks.due, tasks.done, tasks.assigned_to) IS DISTINCT FROM
             (EXCLUDED.title, EXCLUDED.due, EXCLUDED.done, EXCLUDED.assigned_to)
          OR (tasks.voided_at IS NOT NULL AND EXCLUDED.done = 0);
      RETURN NEW;
    END $fn$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_thread_task_sync ON threads`);
  await pool.query(`CREATE TRIGGER trg_thread_task_sync AFTER INSERT OR UPDATE OR DELETE ON threads
                      FOR EACH ROW EXECUTE FUNCTION steward_thread_task_sync()`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_milestone_task_sync() RETURNS TRIGGER AS $fn$
    DECLARE g RECORD; owner_id TEXT; owner_name TEXT; kname TEXT; start_word TEXT; lead INT; start_due DATE; is_done INT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        DELETE FROM tasks WHERE milestone_id = OLD.id AND org_id = OLD.org_id;
        RETURN OLD;
      END IF;
      -- The follow-up thread the lead time raised is this deadline, not another task.
      IF NEW.thread_id IS NOT NULL THEN
        DELETE FROM tasks WHERE thread_id = NEW.thread_id AND org_id = NEW.org_id AND link_kind = 'next_step';
      END IF;
      -- Taking a deadline off removes its tasks; putting it back brings them back.
      IF NEW.state = 'skipped' THEN
        DELETE FROM tasks WHERE milestone_id = NEW.id AND org_id = NEW.org_id;
        RETURN NEW;
      END IF;
      SELECT gr.officer_id, gr.created_by, gr.is_sample, gr.funder_donor_id, COALESCE(d.name, gr.funder) AS funder_name, o.grant_headsup_days,
             COALESCE(NULLIF(o.timezone, ''), '${orgTime.DEFAULT_TZ}') AS org_tz
        INTO g
        FROM grants gr
        LEFT JOIN donors d ON d.id = gr.funder_donor_id AND d.org_id = gr.org_id AND d.deleted_at IS NULL
        LEFT JOIN orgs o ON o.id = gr.org_id
       WHERE gr.id = NEW.grant_id AND gr.org_id = NEW.org_id;
      IF NOT FOUND OR g.is_sample IS TRUE THEN RETURN NEW; END IF;
      -- The person named on the deadline (whoever added it), else the grant's officer.
      SELECT u.id, u.name INTO owner_id, owner_name FROM users u
       WHERE u.org_id = NEW.org_id AND u.id IN (g.officer_id, g.created_by, NEW.created_by)
       ORDER BY (u.id = g.officer_id) DESC, (u.id = NEW.created_by) DESC LIMIT 1;
      kname := CASE NEW.kind WHEN 'loi_due' THEN 'LOI due' WHEN 'proposal_due' THEN 'Proposal due' WHEN 'report_due' THEN 'Report due'
                 WHEN 'decision' THEN 'Decision expected' WHEN 'renewal_opens' THEN 'Renewal window opens'
                 ELSE COALESCE(NULLIF(NEW.label, ''), 'Deadline') END;
      is_done := CASE WHEN NEW.state = 'done' THEN 1 ELSE 0 END;
      INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, grant_id, assigned_to, assigned_to_name,
                         milestone_id, link_kind, updated_at, created_by, created_by_name)
      VALUES ('t_gd_' || substr(md5(NEW.id), 1, 14), NEW.org_id, COALESCE(g.funder_name, 'A grant') || ': ' || kname, LEFT(NEW.due_date, 10),
              'high', 'grant', is_done, g.funder_donor_id, NEW.grant_id, owner_id, owner_name, NEW.id, 'deadline', NOW(),
              COALESCE(NEW.created_by, 'system:grant-deadline'), COALESCE(NEW.created_by_name, 'Steward'))
      ON CONFLICT (milestone_id, link_kind) WHERE milestone_id IS NOT NULL DO UPDATE
         SET title = EXCLUDED.title, due = EXCLUDED.due, done = EXCLUDED.done, donor_id = EXCLUDED.donor_id,
             assigned_to = EXCLUDED.assigned_to, assigned_to_name = EXCLUDED.assigned_to_name, voided_at = NULL, updated_at = NOW()
       WHERE (tasks.title, tasks.due, tasks.done, tasks.assigned_to, tasks.donor_id) IS DISTINCT FROM
             (EXCLUDED.title, EXCLUDED.due, EXCLUDED.done, EXCLUDED.assigned_to, EXCLUDED.donor_id) OR tasks.voided_at IS NOT NULL;
      -- THE HEADS-UP: a proposal, an LOI or a report needs starting well before it is due.
      lead := COALESCE(g.grant_headsup_days, 14);
      start_word := CASE NEW.kind WHEN 'loi_due' THEN 'LOI' WHEN 'proposal_due' THEN 'proposal' WHEN 'report_due' THEN 'report' ELSE NULL END;
      IF start_word IS NOT NULL AND lead > 0 AND NEW.due_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN
        start_due := LEFT(NEW.due_date, 10)::date - lead;
        IF EXISTS (SELECT 1 FROM tasks WHERE milestone_id = NEW.id AND link_kind = 'deadline_start') THEN
          UPDATE tasks SET due = to_char(start_due, 'YYYY-MM-DD'),
                           title = 'Start ' || start_word || ' for ' || COALESCE(g.funder_name, 'the grant'),
                           done = CASE WHEN is_done = 1 THEN 1 ELSE done END, voided_at = NULL, updated_at = NOW()
           WHERE milestone_id = NEW.id AND link_kind = 'deadline_start'
             AND (due IS DISTINCT FROM to_char(start_due, 'YYYY-MM-DD') OR (is_done = 1 AND done <> 1)
                  OR title IS DISTINCT FROM 'Start ' || start_word || ' for ' || COALESCE(g.funder_name, 'the grant') OR voided_at IS NOT NULL);
        -- CLOCK-1: a heads-up still ahead is judged by the org's today, not the database's.
        ELSIF is_done = 0 AND start_due >= ${orgTime.orgTodaySql("g.org_tz")} THEN
          INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, grant_id, assigned_to, assigned_to_name,
                             milestone_id, link_kind, updated_at, created_by, created_by_name)
          VALUES ('t_gh_' || substr(md5(NEW.id), 1, 14), NEW.org_id, 'Start ' || start_word || ' for ' || COALESCE(g.funder_name, 'the grant'),
                  to_char(start_due, 'YYYY-MM-DD'), 'medium', 'grant', 0, g.funder_donor_id, NEW.grant_id, owner_id, owner_name,
                  NEW.id, 'deadline_start', NOW(), 'system:grant-heads-up', 'Steward')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
      RETURN NEW;
    END $fn$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_milestone_task_sync ON grant_milestones`);
  await pool.query(`CREATE TRIGGER trg_milestone_task_sync AFTER INSERT OR UPDATE OR DELETE ON grant_milestones
                      FOR EACH ROW EXECUTE FUNCTION steward_milestone_task_sync()`);
  // A grant's funder, officer or sample flag changing re-reads its deadlines' tasks.
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_grant_task_touch() RETURNS TRIGGER AS $fn$
    BEGIN
      IF (NEW.officer_id, NEW.funder_donor_id, NEW.funder, NEW.is_sample) IS DISTINCT FROM (OLD.officer_id, OLD.funder_donor_id, OLD.funder, OLD.is_sample) THEN
        UPDATE grant_milestones SET updated_at = NOW() WHERE grant_id = NEW.id AND org_id = NEW.org_id;
      END IF;
      RETURN NEW;
    END $fn$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_grant_task_touch ON grants`);
  await pool.query(`CREATE TRIGGER trg_grant_task_touch AFTER UPDATE ON grants FOR EACH ROW EXECUTE FUNCTION steward_grant_task_touch()`);
  await backfillLinkedTasks();

  // ── ADMIN-CLEAN · WHAT AN ORG IS, AND WHAT IT REALLY PAYS ───────────────
  // org_kind: customer | prospect_trial | demo | internal_test | fixture.
  // NULL means nobody has said, and orgKind.js infers it from facts. Only
  // customer and prospect_trial count in the console's Metrics (orgKind.js).
  // archived_at hides an org from the console, reversibly; nothing else reads it.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_kind TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_kind_set_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_kind_set_by TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS archived_by TEXT`);
  // FIX-50 (Justin's Place, 26 Oct): an org is a demo only if its Kind is Demo.
  // The migration and the trigger that keeps is_demo_org a copy of Kind live in
  // orgDemoMigration.js. It runs with schema init, is idempotent, and logs its counts.
  {
    const changed = await require("../../../orgDemoMigration").matchDemoFlagToKind(pool);
    console.log(`[fix50] demo flag matched to Kind: ${changed.kindsSet} unset Kind(s) set to Demo, ${changed.flagsChanged} is_demo_org flag(s) changed`);
  }
  // SEND-GATE-1 (27 Oct): automatic donor mail only to people the org turned
  // it on for (sendGateMigration.js). The deploy change runs once and logs
  // every org it touched, with counts, and Creo's separately.
  {
    const SG = require("../../../sendGateMigration");
    await SG.sendGateSchema(pool);
    const ch = await SG.sendGateDeployChange(pool);
    if (ch.ran) {
      for (const r of ch.perOrg) console.log(`[send-gate-1] org ${r.org_id}: ${r.people} people start with automatic emails off`);
      console.log(`[send-gate-1] org_creo: ${ch.creoOn} people turned ON (received an automatic message in the last 12 months)`);
    }
    // SEND-GATE-2 (28 Oct): every email type starts off, for every org.
    await SG.sendGate2Schema(pool);
    const ch2 = await SG.sendGate2DeployChange(pool);
    if (ch2.ran) for (const r of ch2.perOrg) console.log(`[send-gate-2] org ${r.org_id}: ${r.types_on} email types on, ${r.always_include} Always include, ${r.follows} Follows your settings`);
  }
  // MAIL-1 · backfill onboarded by the same definition, never by guess
  // (onboarded.js). Here, not beside the onboarded_* columns, because its demo
  // test reads org_kind (FIX-51).
  await require("../../../onboarded").backfillOnboarded(query)
    .catch(e => console.error("[mail-1] onboarded backfill:", e.message));
  // The monthly amount of the org's live Stripe subscription, in cents, as the
  // billing webhook last read it. MRR is this, never a plan's list price.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_mrr_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_mrr_at TIMESTAMPTZ`);
  // One row per paid Steward invoice (amount_paid > 0). MRR by month and the
  // "has a real payment" delete guard both read it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_payments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      stripe_invoice_id TEXT UNIQUE NOT NULL,
      amount_paid_cents INTEGER NOT NULL,
      monthly_cents INTEGER NOT NULL,
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_platform_payments_org ON platform_payments (org_id, paid_at)`);
  // Console settings that belong to Steward, not to any org (the MRR target).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT)`);

  // SCALE-1 · indexes. The app shell and Home count an org's sample rows on
  // every load (countSampleData, /org/sample-data-status). Sample rows are few
  // or none, so a partial index on just them answers each count from a tiny
  // index instead of reading every gift the org has: 447 ms -> 0.02 ms for a
  // 150k-gift org's sample-gift count. Building them read the 5.8M-gift load
  // database in about 3 s in all.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_sample ON gifts (org_id) WHERE is_sample = true`);
  // SCALE-2: an employer's record lists the gifts it matched on every profile
  // open (routes/finance.js /donors/:id/relationship). Without this it read
  // every gift the org has: 279 ms for a 150k-gift org, on every profile.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_match_employer ON gifts (org_id, match_employer_id) WHERE match_employer_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_sample ON donors (org_id) WHERE is_sample = true`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_org_sample ON interactions (org_id) WHERE is_sample = true`);

  // ── GIVE-EDIT-1 · EVERY GIVING PAGE IS EDITED IN ONE PLACE ───────────────
  // The page's own fields (headline, story, photo, goal bar, where the gift
  // goes, the form's amounts and thank-you) wait in `draft_settings` until a
  // person publishes; the widgets already wait in `draft`. `show_goal` is the
  // goal bar's switch, on for every page that existed before.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS draft_settings JSONB`);
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS show_goal BOOLEAN NOT NULL DEFAULT TRUE`);
  // The org-wide donation form's amounts wait here the same way.
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS form_draft JSONB`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS form_published_at TIMESTAMPTZ`);
  // Each publish of a page, kept: what went live, who did it and when. A
  // restore is a publish of an earlier snapshot and is kept the same way.
  // `page_id` is a giving_pages id, or 'org_form' for the org-wide form.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giving_page_versions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      restored_from INTEGER,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, page_id, number))`);

  // FIX-41 PICTURES · every page and item can have a picture. A picture is
  // { url, alt, fx, fy } (pictures.js): the words a screen reader says and the
  // focal point a phone crop keeps. A slot that already had a url column keeps
  // it and gains its words and focus beside it; a new slot is one JSONB column.
  await pool.query(`ALTER TABLE event_levels ADD COLUMN IF NOT EXISTS picture JSONB`);
  await pool.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS picture JSONB`);
  await pool.query(`ALTER TABLE volunteer_slot_roles ADD COLUMN IF NOT EXISTS picture JSONB`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS hero_meta JSONB`);
  await pool.query(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS image_meta JSONB`);
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS image_meta JSONB`);
  // GIVE-3: how the page looks (layout, impact lines, trust panel, other ways
  // to give), shared/givingPageDesign.js. Drafted in draft_settings.design.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS design JSONB`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS membership_cover JSONB`);

  // CLIENT-SAFE-1 · "We serve clients whose details are private". Off by
  // default. A person marked as a client is never brought in from email,
  // documents or memos while it is on; their gifts are untouched.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS client_privacy BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS client_privacy_changed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS client_privacy_changed_by TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS is_client BOOLEAN DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_is_client ON donors (org_id) WHERE is_client`);

  // FIX-57 · SUPPORT ACCESS. A super-admin opens one org as Steward support:
  // read-only until a second confirm, every open and every change in the
  // org's Activity. An org turns it off in Settings (on by default, because
  // this is what replaces anyone reading prod data to debug a screen).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS support_access_off BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS support_access_changed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS support_access_changed_by TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_sessions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      support_name TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      write_enabled_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_sessions_org ON support_sessions (org_id, started_at DESC)`);
  // One row per detail held back. It says THAT something was held and where,
  // never what: there is no column that could carry the words.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_holds (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT,
      interaction_id TEXT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_privacy_holds_org ON privacy_holds (org_id, created_at DESC)`);
  // A bulk or uploaded marking, so Undo puts back exactly what it changed.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_marks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      source TEXT NOT NULL,
      donor_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      undone_at TIMESTAMPTZ)`);
  // "Remove email already logged for this person": the rows are kept here for
  // thirty days so Undo can put them back, then emptied for good.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_email_removals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      rows JSONB,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      undone_at TIMESTAMPTZ,
      purged_at TIMESTAMPTZ)`);

  // HOME-2 · "Not now" on a Home lead card. One row per press, per person:
  // that card stays aside for the day, and after three of a kind that kind
  // ranks lower for that person only (shared/homeLead.js DISMISS_RUN).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS home_lead_dismissals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      card_key TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_home_lead_dismissals_user ON home_lead_dismissals (org_id, user_id, created_at DESC)`);

  // FIX-57 · A SIGNATURE FOR EACH PERSON. Settings, My profile: the name she
  // signs with, her title, phone, an optional photo, and the block itself
  // (blank: those lines, in that order). It signs what is drafted for her,
  // ahead of Brand's signature (shared/brandKit.js senderSignature).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_title TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_phone TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_photo TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_block TEXT`);

  // LIST-1 · THE DONOR LIST'S COLUMNS. One layout per person (user_id), and
  // one org default (user_id ''), set by an admin. A saved view is a name for
  // a set of columns plus a filter, kept per person. Columns are field keys
  // from donorList.js, a custom field as "cf:<key>".
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS county TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_zip ON donors (org_id, zip)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_list_layouts (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      widths JSONB NOT NULL DEFAULT '{}'::jsonb,
      page_size INTEGER NOT NULL DEFAULT 50,
      created_by TEXT NOT NULL, created_by_name TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, user_id))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_list_views (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      widths JSONB NOT NULL DEFAULT '{}'::jsonb,
      filters JSONB,
      page_size INTEGER NOT NULL DEFAULT 50,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_list_views_user ON donor_list_views (org_id, user_id)`);
  await require("../../donors/listViewsSchema").listViewsSchema(pool);   // LIST-3: a saved view keeps its sort
  // FLOWS-2: and the list's own filters (search, Stage, Owner, Tag…). Here, not in
  // listViewsSchema.js: the schema hash covers db.js and server/db/ only, so a
  // column added in a file outside them would never run on a database already at
  // the old hash.
  await pool.query(`ALTER TABLE donor_list_views ADD COLUMN IF NOT EXISTS chips JSONB`);
  // FEEL-1: the import whose stated total is donors.imported_total. Its own
  // undated gifts are inside that total (shared/numbers/lifetime.js AFTER_IMPORT).
  // Null on every existing row, so no lifetime moves when this runs.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS imported_import_id TEXT`);

  // FIX-49 decision 8 · ONE HOUSEHOLD GROUPING. Spouses and household links
  // become household records (the only grouping); the links themselves stay.
  await householdsFromLinks(pool);

  // WALKB-2: a withdrawn invite (Settings → Team, Revoke) and an archived
  // event (one with gifts or guests, which is never deleted). Columns only.
  await pool.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  // COMMS-1 · each staff invite email Steward sent (server/org/inviteMail.js):
  // the 20-a-day cap per org, Resend's once-in-ten-minutes, and a bounce.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      invite_id TEXT NOT NULL,
      email TEXT NOT NULL,
      provider_id TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      bounced_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invite_sends_org ON invite_sends (org_id, sent_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invite_sends_invite ON invite_sends (invite_id, sent_at DESC)`);
  // COMMS-1 item 4 · a dismissed draft is archived, never deleted: who and when (server/drafts/dismiss.js).
  for (const t of ["milestone_drafts", "agent_drafts", "thank_you_drafts"]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS archived_by TEXT`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS archived_by_name TEXT`);
  }

  // ACCESS-1 · a person in more than one org. Their home org stays users.org_id
  // with users.role; each further org is one row here, with its own role. A
  // session is in one org at a time (the token's orgId), and requireAuth reads
  // the role from the row for that org. Additive: no existing row changes.
  // viewer_exports_off: an admin's switch that stops view-only accounts exporting.
  await pool.query(`CREATE TABLE IF NOT EXISTS org_memberships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    org_id TEXT NOT NULL REFERENCES orgs(id),
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    revoked_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_user_org ON org_memberships (user_id, org_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships (org_id) WHERE revoked_at IS NULL`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS viewer_exports_off BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS reason TEXT`);

  // SCALE-2 · the per-org summary's change rows. LAST, so every table above is
  // watched: one statement trigger per write event on every table with org_id
  // (orgSummary.js says which few are not, and why).
  await require("../../../orgSummary").installTriggers(pool);

  // Record this file's hash LAST — only a fully-completed init marks the
  // schema current, so a crash mid-init re-runs the whole thing next boot.
  await pool.query(
    `INSERT INTO schema_meta (id, schema_hash, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, updated_at = NOW()`,
    [SCHEMA_HASH]);
// SPLIT-2 end
}

module.exports = { run: run7 };
