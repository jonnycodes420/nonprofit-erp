// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 5 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { orgTime } = require("../pool");
const { query, run } = require("../query");

// `pool` here is the init session, as it was in runSchemaInit.
async function run5(pool) {
// SPLIT-2 db.js piece 46
  // One-shot, by flag, in one transaction, at the first boot of this build.
  // IT ONLY EVER TURNS THINGS OFF. The alerts that used to start on are set
  // off (a person turns back on what they want), and a person who had turned
  // the old "daily task reminder" off gets no tasks or meetings section. Nothing
  // is set on: a person with the Thread email off stays off (her old tasks-only
  // email ends with it), and the org weekend toggle is not carried into "every
  // day" (everyone starts on weekdays). The two fixture orgs are never written
  // (CLAUDE.md: only seed-demo.js writes org_b72demo; org_creo is never written).
  {
    const NOT_FIXTURE = "org_id NOT IN ('org_creo','org_b72demo')";
    const c = pool;   // runSchemaInit's one DDL session (ddlSession): the transaction runs on it
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('staff_mail_1_opt_in'))");   // two replicas booting together run it once
      const done = await c.query("SELECT 1 FROM schema_flags WHERE flag='staff_mail_1_opt_in'");
      if (!done.rows.length) {
        const a = await c.query(`UPDATE users SET notify_portfolio_gifts=false, notify_task_assignments=false, notify_step_reminder=false
                                  WHERE ${NOT_FIXTURE} AND (notify_portfolio_gifts IS DISTINCT FROM false
                                    OR notify_task_assignments IS DISTINCT FROM false OR notify_step_reminder IS DISTINCT FROM false)`);
        const t = await c.query(`UPDATE users SET brief_sections=COALESCE(brief_sections,'{}'::jsonb) || '{"tasks":false,"meetings":false}'::jsonb
                                  WHERE ${NOT_FIXTURE} AND notify_daily_tasks=false`);
        await c.query("INSERT INTO schema_flags (flag) VALUES ('staff_mail_1_opt_in') ON CONFLICT (flag) DO NOTHING");
        console.log(`[staff-mail-1] staff alerts are now opt-in: ${a.rowCount} user(s) had alerts turned off, ${t.rowCount} kept tasks out of the morning email`);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      console.error("[staff-mail-1] CRITICAL: the opt-in migration failed and changed nothing:", e.message);
    }
  }
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS source TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS workflow_run_id TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  // Every saved recipe on every org switches to drafting, live ones included.
  // The engine also treats a leftover send_email as a draft, so this is the
  // tidy-up, not the guarantee.
  await pool.query(`UPDATE workflows SET actions = REPLACE(actions::text, '"send_email"', '"draft_email"')::jsonb, updated_at = NOW()
                     WHERE actions::text LIKE '%"send_email"%'`);
  await pool.query(`UPDATE workflows SET name = 'Failed recurring gift → recovery note to review + task'
                     WHERE recipe_key = 'failed_recurring_recovery' AND name = 'Failed recurring gift → recovery email + task'`);
  await pool.query(`UPDATE workflows SET name = 'New donor''s first gift → thank-you to review + task'
                     WHERE recipe_key = 'new_donor_welcome' AND name = 'New donor''s first gift → thank-you + task'`);

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
  // HARDEN-1: which arm of the donor-mail gate let a send go (sendGate.js:
  // exempt, staff_confirm, auto_email_on) and the people it went to (ids,
  // never addresses), so scripts/ops/auto-mail-switches-readonly.sql can prove no
  // automatic message reached a person whose Automatic emails switch was off.
  await pool.query(`ALTER TABLE email_log ADD COLUMN IF NOT EXISTS gate TEXT`);
  await pool.query(`ALTER TABLE email_log ADD COLUMN IF NOT EXISTS donor_ids TEXT[]`);

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
  // CHECK-2: the memo line of a check, saved on the gift exactly as written
  // (after the bank-number scrub), and the org's rule for a joint check:
  // hard credit to the first name on it, or to the household's primary contact.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS memo TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS joint_gift_credit TEXT NOT NULL DEFAULT 'first_named'`);
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

  // ── REPORTS-3 — SAVED DASHBOARDS AND THE BOARD PACK ─────────────────────
  // A saved dashboard is tiles she picked, in the order she put them, with the
  // filters she chose. A tile is a DECLARATION — a figure source name, a chart
  // key or a report id, validated by shared/boardPack.js — never SQL, exactly
  // as a saved report is a definition and never SQL.
  //
  // THE ORDER OF THESE THREE MATTERS. board_pack_schedules references
  // saved_dashboards, so on a fresh database (CI's, and every new org's first
  // boot) saved_dashboards must exist first. A build shipped with these the
  // other way round once and the schema failed to initialise, which failed the
  // deploy with every test green.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_dashboards (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      tiles JSONB NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}',
      shared BOOLEAN NOT NULL DEFAULT false,
      owner_id TEXT, owner_name TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_dashboards_org ON saved_dashboards (org_id)`);

  // ONE schedule per organisation: the board pack is the organisation's, not a
  // thing each person keeps their own copy of. OFF until somebody turns it on
  // (`enabled` DEFAULT false) — a schedule that mails a board the moment it is
  // created is a schedule nobody consented to.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_pack_schedules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      dashboard_id TEXT REFERENCES saved_dashboards(id) ON DELETE SET NULL,
      frequency TEXT NOT NULL,
      day_of_month INTEGER NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      last_sent_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_board_pack_schedule_org ON board_pack_schedules (org_id)`);

  // ONCE per schedule per period, ever: reserved BEFORE the send and released
  // if it fails (the digest_sends discipline). A board that gets the same pack
  // twice stops reading it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_pack_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      schedule_id TEXT NOT NULL REFERENCES board_pack_schedules(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      period_label TEXT,
      recipients INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (schedule_id, period_key)
    )`);

  // The organisation's OWN leadership addresses: staff and board, never
  // donors. It is a list the org types in Settings and the only list a
  // scheduled pack is ever sent to.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS board_pack_emails JSONB DEFAULT '[]'`);

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

  // ── EVENTS-1 · WHAT THE NIGHT IS FOR ─────────────────────────────────────
  // An event had `revenue` and `cost` and no GOAL, so the one question an ED
  // asks before the night ("are we going to make it?") had no field to answer
  // from. `revenue` stays what it always was: a figure somebody can type. The
  // goal is what the cards and the report are measured against, and what is
  // RAISED is never typed — it is summed from the gifts, so the number on the
  // card and the rows behind it cannot drift.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS goal_amount NUMERIC`);
  // WHICH EVENT THIS GIFT BELONGS TO, stamped at registration. Before this the
  // only link was the campaign NAME, so "raised" for an event was a string
  // comparison and a renamed event lost its money. The campaign match stays as
  // a FALLBACK for rows written before this column existed; nothing is
  // rewritten behind anybody's back.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS event_id TEXT`);
  // IMPORT-4: a gift whose day the file never gave is stored with no date (an
  // undated gift). It counts in Lifetime and its event, never in a period.
  await pool.query(`ALTER TABLE gifts ALTER COLUMN date DROP NOT NULL`);
  // IMPORT-3: what one spreadsheet import made, so Undo removes the whole file:
  // its pledges, the households and the event it created. A pledge made at an
  // event remembers which.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS event_id TEXT`);
  await pool.query(`ALTER TABLE households ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS import_id TEXT`);
  // IMPORT-4: an import writes attendance (undone with the run), and an event
  // a file names without a day is put on the import's day, said so on its page.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_attendees_import ON event_attendees (org_id, import_id) WHERE import_id IS NOT NULL`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS date_unknown BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_event ON gifts (org_id, event_id) WHERE event_id IS NOT NULL`);
  // The campaign an event raises into, so an event and its appeal are one
  // total rather than two.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  // The public registration page's address. Set when an event is made public,
  // never guessed from the name: a renamed event keeps the link somebody
  // printed on a poster.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS public_slug TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_events_public_slug ON events (org_id, public_slug) WHERE public_slug IS NOT NULL`);
  // A registration that came in from the public page and has NOT been paid or
  // confirmed by the office yet. It is not money and not a place taken.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS source TEXT`);
  // Dietary notes and a seat belong to the guest, not to the ticket: two
  // people on one ticket sit at different tables and eat different things.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS dietary TEXT`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ`);
  // A guest brought BY a registration, who is not the person who paid. They
  // are on the list, they have a seat and a name tag, and they are not a
  // second gift.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS guest_of TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_attendees_event ON event_attendees (org_id, event_id, table_label)`);

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

  // ── FIX-1 C — THE COORDINATOR'S OWN NOTES ────────────────────────────────
  // Training, a background-check date, availability: things that are about
  // VOLUNTEERING, not about giving. They live here and NOT in interactions, so
  // they can never reach the donor timeline, Drift, a thank-you draft or the
  // agent's rows — those all read interactions, and this table is not it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_notes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('training','background_check','availability','note')),
      body TEXT NOT NULL,
      note_date TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_notes_person ON volunteer_notes (org_id, person_id, created_at DESC)`);

  // ── LOST & FOUND · THE LEAD, AND NOTHING ELSE ──────────────────────────
  // Lost & Found runs the whole audit in the visitor's browser. THE DONOR
  // FILE NEVER REACHES THIS DATABASE, and these two tables are the complete
  // list of what does.
  //
  // A LEAD is the three fields the visitor TYPED to download the PDF, plus
  // where they came from. There is no column here that could hold a donor's
  // name, a donor's email or an amount, which is the point: the guarantee is
  // enforced by the SHAPE OF THE TABLE, not by a promise in a route.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lost_and_found_leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      organization TEXT NOT NULL,
      ref TEXT,                                -- ?ref= , so an affiliate gets credit
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // FIX-13: a Book a demo request is a lead in this table too (ref
  // book-a-demo), and it carries two more answers: the size band she picked
  // and where her records live today. Both are words she chose about her
  // organisation, never a row from a file.
  await pool.query(`ALTER TABLE lost_and_found_leads ADD COLUMN IF NOT EXISTS org_size TEXT`);
  await pool.query(`ALTER TABLE lost_and_found_leads ADD COLUMN IF NOT EXISTS current_system TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lf_leads_created ON lost_and_found_leads (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lf_leads_ref ON lost_and_found_leads (ref) WHERE ref IS NOT NULL`);

  // A BENCHMARK is four aggregate numbers, opt-in, with NO link to a lead:
  // no lead id, no email, no organisation name. Joining the two would turn
  // an anonymous contribution into an attributed one, so the schema makes
  // the join impossible rather than forbidding it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lost_and_found_benchmarks (
      id TEXT PRIMARY KEY,
      donor_band TEXT NOT NULL,
      retention_pct INTEGER,
      share_lapsed_pct INTEGER,
      share_drifting_pct INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lf_bench_band ON lost_and_found_benchmarks (donor_band)`);

  // ── VOL-1 · SCHEDULING, CAPACITY, WAITLISTS, CREDENTIALS ────────────────
  // See shared/volunteerShifts.js for the vocabulary. In one line: an
  // OPPORTUNITY is a standing thing to do, a SLOT is one dated occurrence of
  // it with a capacity, a SIGN-UP is one person on one slot, and a SHIFT
  // (volunteer_shifts, above) is hours that were actually worked. A slot
  // becomes a shift at CHECK-OUT and never before, because a sign-up nobody
  // attended is not hours anybody gave.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_opportunities (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      location TEXT,
      program TEXT,
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      requires_waiver BOOLEAN NOT NULL DEFAULT FALSE,
      requires_background_check BOOLEAN NOT NULL DEFAULT FALSE,
      archived_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vol_opp_slug ON volunteer_opportunities (org_id, slug)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_opp_org ON volunteer_opportunities (org_id, archived_at)`);

  // A slot is a CIVIL date and two clock times in the org's own timezone,
  // never a UTC instant: a 9am shift is 9am where the volunteers are, and an
  // org either side of a DST change must not find Saturday morning moved.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_slots (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      opportunity_id TEXT NOT NULL REFERENCES volunteer_opportunities(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      capacity INTEGER,                        -- NULL = no limit; 0 = closed
      notes TEXT,
      cancelled_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_slots_org_date ON volunteer_slots (org_id, date, start_time)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_slots_opp ON volunteer_slots (opportunity_id, date)`);

  // A group is a LABEL on a set of sign-ups: a church group, a company day.
  // Never a person, never a second roster — every member is still their own
  // record with their own hours.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      contact_person_id TEXT REFERENCES donors(id) ON DELETE SET NULL,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_groups_org ON volunteer_groups (org_id, name)`);

  // ── FIX-9 Part B · A GROUP HAS MEMBERS BEFORE IT HAS A SHIFT ──────────────
  // Membership was carried entirely by `volunteer_signups.group_id`, and that
  // row requires a slot: somebody could only be "in" a church group by being
  // on a date with it. So a coordinator could not build the group first and
  // schedule it second, which is the order every group actually arrives in.
  // This table is membership itself. Sign-ups keep their group_id, because a
  // shift somebody worked WITH a group is a fact about that shift, and the
  // group's member list is the union of the two.
  //
  // It holds no hours, no giving and no second name: a member is a donors row
  // (one person, one record) and this says only that they belong.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_group_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      group_id TEXT NOT NULL REFERENCES volunteer_groups(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS vol_group_member_once
                      ON volunteer_group_members (org_id, group_id, person_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_group_members_group
                      ON volunteer_group_members (org_id, group_id)`);

  // ONE SIGN-UP PER PERSON PER SLOT, decided by the database. Capacity that
  // is only checked by an if-statement is capacity that is advisory, and the
  // failure mode is four people driving across town to a full shift.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_signups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      slot_id TEXT NOT NULL REFERENCES volunteer_slots(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      group_id TEXT REFERENCES volunteer_groups(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed','waitlisted','cancelled','no_show','completed')),
      position INTEGER,                        -- waitlist order
      checked_in_at TIMESTAMPTZ,
      checked_out_at TIMESTAMPTZ,
      hours_shift_id TEXT,                     -- the volunteer_shifts row check-out wrote
      source TEXT NOT NULL DEFAULT 'staff',    -- public | self | staff | kiosk | group
      note TEXT,
      cancelled_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vol_signup_open
                      ON volunteer_signups (org_id, slot_id, person_id) WHERE status <> 'cancelled'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_signups_slot ON volunteer_signups (slot_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_signups_person ON volunteer_signups (org_id, person_id, status)`);

  // Waivers and background checks: the same shape (a thing done on a date
  // that stops being true on another date), so one table and one set of
  // rules. Steward records that a background check happened and the org's own
  // reference; it never holds the report.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_credentials (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      person_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('waiver','background_check')),
      signed_on TEXT NOT NULL,
      expires_on TEXT,
      reference TEXT,
      signature_name TEXT,                     -- what they typed, for an online waiver
      signature_ip TEXT,
      waiver_text_sha256 TEXT,                 -- WHICH words they agreed to
      superseded_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_creds_person ON volunteer_credentials (org_id, person_id, kind, signed_on DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_creds_expiry ON volunteer_credentials (org_id, kind, expires_on) WHERE superseded_at IS NULL`);

  // ── VOL-2 · WHICH IMPORT PUT THIS ROW HERE ───────────────────────────────
  // An undo has to be EXACT: it may remove what one import wrote and nothing
  // else. A "delete everything created in the last five minutes" undo would
  // take the shift a coordinator logged by hand while the import ran. So the
  // import stamps its own `imports.id` on every row it creates, across the
  // three tables it writes, and the undo deletes by that id alone.
  //
  // On `donors` it means "this import CREATED this person". A person the
  // import merely matched and added hours to has no stamp and is never
  // removed by an undo: they were here before the file arrived.
  //
  // IT LIVES HERE, AFTER `volunteer_credentials` IS CREATED, and that is the
  // whole point of the placement. It first went in beside the shifts indexes
  // further up, which worked on every database that already had the table and
  // failed on a FRESH one: all three battery shards died on boot with
  // `relation "volunteer_credentials" does not exist`. An ALTER goes below the
  // CREATE it alters, always.
  await pool.query(`ALTER TABLE volunteer_shifts ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE volunteer_credentials ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS volunteer_import_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_shifts_import_id ON volunteer_shifts (org_id, import_id) WHERE import_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_creds_import_id ON volunteer_credentials (org_id, import_id) WHERE import_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_vol_import ON donors (org_id, volunteer_import_id) WHERE volunteer_import_id IS NOT NULL`);

  // The volunteer's own page, by magic link. A SEPARATE family from the
  // donor portal's (portal_magic_links) on purpose: a volunteer is not a
  // donor account, the two must not share a session, and a link that opens a
  // roster must never open a giving history.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_magic_links (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_magic_person ON volunteer_magic_links (org_id, person_id)`);

  // Shift reminders are OFF BY DEFAULT, per org, and never on the demo org.
  // Turning them on is an org's decision about mail reaching its volunteers,
  // and a default of ON would make that decision for them.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS volunteer_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS volunteer_waiver_text TEXT`);
  // The highest hour milestone a thank-you draft has been written for, so
  // crossing 25 writes one draft and not one per shift thereafter.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS volunteer_milestone_hours INTEGER`);
  // Which sign-up a reminder has already gone out for. One row, one send.
  await pool.query(`ALTER TABLE volunteer_signups ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`);
  // WHY-1 Part 8 — HONEST "SENT". A refused reminder or onboarding email is
  // not sent: it keeps its reason and its time, and is retried at most once a day.
  await pool.query(`ALTER TABLE volunteer_signups ADD COLUMN IF NOT EXISTS reminder_error TEXT`);
  await pool.query(`ALTER TABLE volunteer_signups ADD COLUMN IF NOT EXISTS reminder_failed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS last_error TEXT`);
  await pool.query(`ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ`);
  // FIX-1 — the volunteer sign-up link's version. It is signed into the link,
  // so "make a new link" bumps it and every older link stops verifying.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS volunteer_link_version INTEGER NOT NULL DEFAULT 0`);

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

  // ── INT-5 — THE CALL LOG, THIRTY DAYS, NO DONOR DATA ─────────────────────
  // What was asked for and what Steward answered, per key. The ids involved
  // and nothing else: a log that recorded the CONTENTS of a request would be a
  // second, unguarded copy of the CRM, kept somewhere nobody thinks to guard.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_call_log (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      key_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      scope_required TEXT,
      entity_id TEXT,
      ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_call_log_key ON api_call_log (key_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_call_log_org ON api_call_log (org_id, created_at DESC)`);

  // ── INT-5 — WEBHOOKS OUT ─────────────────────────────────────────────────
  // One endpoint, the events it subscribed to, and its OWN signing secret, so
  // one endpoint's secret leaking never lets anybody forge a delivery to
  // another. `paused_at` is set when it keeps failing, and it is never a silent
  // disable: a Thread step is opened for the admin at the same time.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      url TEXT NOT NULL,
      description TEXT,
      events JSONB NOT NULL DEFAULT '[]'::jsonb,
      secret TEXT NOT NULL,
      paused_at TIMESTAMPTZ,
      consecutive_failures INTEGER DEFAULT 0,
      last_delivered_at TIMESTAMPTZ,
      last_status INTEGER,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints (org_id)`);

  // Every ATTEMPT, not every delivery: "it failed four times and then worked"
  // is the thing somebody debugging needs to see, and a table that keeps only
  // the last outcome cannot show it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload JSONB NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      status INTEGER,
      outcome TEXT,
      error TEXT,
      next_attempt_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      gave_up_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
                    ON webhook_deliveries (next_attempt_at) WHERE delivered_at IS NULL AND gave_up_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
                    ON webhook_deliveries (endpoint_id, created_at DESC)`);
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
  // SECURE-2 item 8: staff may take a file of more than 1,000 people only when
  // an admin allows it here (exportGuard.js). Off for every org, new and old.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS allow_staff_large_exports BOOLEAN NOT NULL DEFAULT false`);
  // SEC-1 — two-factor for everyone, and the sessions it guards.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS require_mfa BOOLEAN NOT NULL DEFAULT false`);
  // TRUST-2 — the day a person was erased at their request (personData.js).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ`);
  // TRUST-2 Part 2 — a What's new entry a super-admin has hidden.
  // HELP-1 — "Did this help?" (no personal data), the questions people ask
  // (question text only, 12 months), and support tickets.
  await pool.query(`CREATE TABLE IF NOT EXISTS help_feedback (id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL, helpful BOOLEAN NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS question_log (
      id BIGSERIAL PRIMARY KEY, surface TEXT NOT NULL, question TEXT NOT NULL, topic TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT question_log_surface CHECK (surface IN ('help','agent','analyst')))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_question_log_created ON question_log (created_at)`);
  // WHY-1 — Ask why logs here too (surface 'why'), with whether Steward could
  // answer. The question text only, never donor data and never the answer.
  await pool.query(`ALTER TABLE question_log ADD COLUMN IF NOT EXISTS answered BOOLEAN`);
  // ASK-2 — the org a question came from, so the box suggests an org's own
  // most-asked questions. Nullable: help and agent rows predate it.
  await pool.query(`ALTER TABLE question_log ADD COLUMN IF NOT EXISTS org_id TEXT`);
  // ASK-2 — an answer pinned to Home: the plan (never the numbers), re-run
  // live every time Home opens. One person's pins; nobody else sees them.
  await pool.query(`CREATE TABLE IF NOT EXISTS ask_pins (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), user_id TEXT NOT NULL,
      question TEXT, plan JSONB NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ask_pins_user ON ask_pins (org_id, user_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_question_log_org ON question_log (org_id, surface, answered)`);
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_log_surface' AND pg_get_constraintdef(oid) LIKE '%why%') THEN
        ALTER TABLE question_log DROP CONSTRAINT IF EXISTS question_log_surface;
        ALTER TABLE question_log ADD CONSTRAINT question_log_surface CHECK (surface IN ('help','agent','analyst','why'));
      END IF; END $$`);
  // SUPPORT-1 — the support agent logs here too: 'support' in the app, 'site'
  // on the website, with the ids of the sources that answered (never the answer).
  await pool.query(`ALTER TABLE question_log ADD COLUMN IF NOT EXISTS sources TEXT`);
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_log_surface' AND pg_get_constraintdef(oid) LIKE '%site%') THEN
        ALTER TABLE question_log DROP CONSTRAINT IF EXISTS question_log_surface;
        ALTER TABLE question_log ADD CONSTRAINT question_log_surface CHECK (surface IN ('help','agent','analyst','why','support','site'));
      END IF; END $$`);
  await pool.query(`CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, user_id TEXT NOT NULL, user_email TEXT NOT NULL, user_name TEXT,
      subject TEXT NOT NULL, screen TEXT, browser TEXT, status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT,
      CONSTRAINT support_tickets_status CHECK (status IN ('open','waiting','closed')))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      from_kind TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS changelog_hidden (entry_id TEXT PRIMARY KEY, hidden_by TEXT NOT NULL, hidden_at TIMESTAMPTZ DEFAULT NOW())`);
  // TRUST-2 Part 1 — the status page. One row per service per minute; the page
  // reads ONLY these rows, so a percentage is never typed in by hand.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_checks (
      id BIGSERIAL PRIMARY KEY, service TEXT NOT NULL, state TEXT NOT NULL, detail TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT status_checks_state CHECK (state IN ('up','degraded','down','unknown')))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_status_checks ON status_checks (service, checked_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_incidents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, affected TEXT[] NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'investigating', created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      CONSTRAINT status_incidents_state CHECK (state IN ('investigating','identified','monitoring','resolved')))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_incident_updates (
      id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
      body TEXT NOT NULL, state TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failed_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_locked_until TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_must_setup BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes (user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mfa_email_codes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mfa_email_user ON mfa_email_codes (user_id, created_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mfa_trusted_browsers (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, user_agent TEXT,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mfa_trusted_user ON mfa_trusted_browsers (user_id)`);
  // ONE ROW PER SIGNED-IN SESSION. Every token carries its id; auth.js checks
  // it on every request, so signing one out ends it on the next request.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_agent TEXT, ip_prefix TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), last_active_at TIMESTAMPTZ DEFAULT NOW(),
      revoked_at TIMESTAMPTZ, revoked_by TEXT)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, revoked_at)`);
  // SECURE-2 item 7: a session with no activity for the org's idle minutes is
  // signed out (default 60; an admin sets 15 to 480). And every browser a
  // person has signed in from, by a one-way fingerprint, so a new one is told.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS idle_minutes INTEGER NOT NULL DEFAULT 60`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_hash TEXT NOT NULL,
      first_seen TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_hash ON user_devices (user_id, device_hash)`);

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
  // PARITY-2 Part 1: the public signup page. A level carries a short
  // DESCRIPTION for its card, and HIDDEN takes it off the page without
  // retiring it (a retired level cannot be bought at all; a hidden one is
  // still sold by its own link). A ONE-MONTH term joins the three: it renews
  // by a monthly subscription on the existing recurring path.
  await pool.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='membership_levels_term_check'
                       AND pg_get_constraintdef(oid) LIKE '%1_month%') THEN
        ALTER TABLE membership_levels DROP CONSTRAINT IF EXISTS membership_levels_term_check;
        ALTER TABLE membership_levels ADD CONSTRAINT membership_levels_term_check
          CHECK (term IN ('12_months','calendar_year','lifetime','1_month'));
      END IF; END $$`);
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
  // BUILD-101 Part 4 — an auto-renewing membership IS a recurring
  // subscription (the existing dunning and card-expiry machinery, unchanged);
  // this column is what makes each renewal charge extend a membership.
  await pool.query(`ALTER TABLE recurring_subscriptions ADD COLUMN IF NOT EXISTS membership_level_id TEXT`);

  // ── BUILD-103 — PEER-TO-PEER: TEAMS, AND A FUNDRAISER WITH A DASHBOARD ──
  // Supporters raising money for the org from their own networks. Most of the
  // machinery already existed (peer_fundraisers under a giving page, a
  // token-only manage link, rollup for free because a gift carries BOTH
  // peer_fundraiser_id and the parent giving_page_id). This adds the parts a
  // walk or a ride actually needs.
  //
  // A campaign is a giving page with this switch on. There is no second kind
  // of page and no second kind of campaign attribution: the thermometer is the
  // one Fundraising already shows.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS p2p_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

  // A TEAM. Its total is a live SUM over the same gift rows everything else
  // sums, never a stored counter, so page = teams + solo fundraisers + direct
  // gifts in cents BY CONSTRUCTION. Archiving a team leaves its gifts counted
  // on the page: the money did arrive.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS p2p_teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      giving_page_id TEXT NOT NULL REFERENCES giving_pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      captain_fundraiser_id TEXT,
      goal_amount NUMERIC(12,2),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (giving_page_id, slug)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_p2p_teams_page ON p2p_teams (org_id, giving_page_id, status)`);

  // A fundraiser belongs to zero or one team.
  await pool.query(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS team_id TEXT`);
  // The CRM person this fundraiser IS, matched by exact email on sign-up and
  // never by name. It is what a soft credit is written against.
  await pool.query(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS person_id TEXT`);
  // The thank-yous the fundraiser has ticked off. Theirs to tick: Steward
  // sends nothing to a fundraiser's contacts and never will.
  await pool.query(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS thanked JSONB NOT NULL DEFAULT '[]'::jsonb`);

  // HASH AT REST. The manage link is the whole auth model, so the token is
  // stored as its SHA-256 exactly like every other credential here. Existing
  // rows are migrated by hashing what they already hold, so every link already
  // in somebody's inbox keeps working; the plaintext column is then emptied.
  await pool.query(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS edit_token_hash TEXT`);
  await pool.query(`UPDATE peer_fundraisers SET edit_token_hash = encode(digest(edit_token, 'sha256'), 'hex')
                     WHERE edit_token IS NOT NULL AND edit_token <> '' AND edit_token_hash IS NULL`)
    .catch(async () => {
      // pgcrypto is not installed on every database. Fall back to leaving the
      // migration to the route, which hashes on first use.
      console.warn("[schema] peer fundraiser tokens will be hashed on first use (pgcrypto unavailable)");
    });
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pf_token_hash ON peer_fundraisers (edit_token_hash)`);
  // The plaintext column is emptied, not dropped, so an older deploy rolling
  // back still finds the column it expects. It has to become nullable for
  // that: it carries a UNIQUE index, and "" is a value that collides.
  await pool.query(`ALTER TABLE peer_fundraisers ALTER COLUMN edit_token DROP NOT NULL`).catch(() => {});
  await pool.query(`UPDATE peer_fundraisers SET edit_token = NULL WHERE edit_token = ''`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pf_team ON peer_fundraisers (org_id, team_id)`);

  // WHETHER THIS DONOR LET THE FUNDRAISER SEE THEIR NAME. Off by default, and
  // that default is the decision: a gift through a friend's page is still a
  // gift to the organisation, and the fundraiser is not entitled to a list of
  // who gave unless each person said so.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS show_name_to_fundraiser BOOLEAN NOT NULL DEFAULT FALSE`);
  // A page that ALREADY has fundraisers on it is already a peer-to-peer
  // campaign, whatever the new column says. Turning the switch on for those
  // pages is what keeps every live fundraiser sign-up link working the day
  // this ships.
  await pool.query(`UPDATE giving_pages SET p2p_enabled = true
                     WHERE p2p_enabled = false
                       AND id IN (SELECT DISTINCT giving_page_id FROM peer_fundraisers)`);

  // ── EVENTS-2 — TICKETS PEOPLE CAN BUY ───────────────────────────────────
  // EVENTS-1 shipped a public page that could not take a card, and said so.
  // These four things are what it takes to take one honestly.
  //
  // A MEMBER PRICE. Null means the level has one price. It is never above the
  // full price and never below the fair-market value, by CHECK: a ticket
  // whose deductible part is negative is not a discount, it is a mistake.
  await pool.query(`ALTER TABLE event_levels ADD COLUMN IF NOT EXISTS member_price NUMERIC(12,2)`);
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='event_levels_member_price_check') THEN
        ALTER TABLE event_levels ADD CONSTRAINT event_levels_member_price_check
          CHECK (member_price IS NULL OR (member_price > 0 AND member_price <= price AND fmv <= member_price));
      END IF; END $$`);

  // A SEAT HELD WHILE SOMEBODY PAYS. Fifteen minutes, then it is gone. A hold
  // is not a registration and never becomes one on its own: the webhook is
  // what confirms, and the hold exists only so that the last two seats are not
  // sold three times in the ninety seconds it takes to find a card.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_seat_holds (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      level_id TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      email TEXT,
      stripe_session_id TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      released_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_seat_holds_live ON event_seat_holds (level_id, expires_at)
                      WHERE released_at IS NULL AND confirmed_at IS NULL`);

  // THE WAITING LIST. A sold-out ticket type still takes a name, and a seat is
  // OFFERED by a person pressing a button — never handed out by a sweep.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_waitlist (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      level_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      position INTEGER,
      offered_at TIMESTAMPTZ,
      offered_by TEXT,
      taken_at TIMESTAMPTZ,
      removed_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_waitlist_level ON event_waitlist (org_id, level_id, position)
                      WHERE removed_at IS NULL AND taken_at IS NULL`);

  // WHO IS COMING ON THIS TICKET, and whether the buyer may move it on. A
  // refund is never self-serve: it stays a staff act on the gift.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS ticket_code_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS transferred_from TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS event_self_service BOOLEAN NOT NULL DEFAULT FALSE`);
  // A public link that has been printed on a poster, posted to a Facebook page
  // and forwarded round a family cannot be taken away because somebody fixed a
  // spelling. Renaming a slug keeps the old one here and /e/:slug redirects.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS previous_slug TEXT`);
  // PARITY-2 Part 3: THE PUBLIC EVENT PAGE, COMPLETE. A start and an end are
  // civil HH:MM in the ORG's zone (orgTime.js); none means an all-day event.
  // The hero is an image on the asset seam (kind 'event') or a YouTube/Vimeo
  // link parsed by shared/eventPage.js. The gallery is a list of asset paths
  // on the event row ({path, caption}), shown on the page once the night is
  // over, and collectLiveAssetRefs reads it so no photo in it is ever pruned.
  // A sponsor level's benefits are one line each.
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS hero_image_url TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS hero_video_url TEXT`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE event_levels ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb`);

  // ── MEMBERS-2 — "YOUR PAGE": ONE PAGE PER PERSON PER ORG ────────────────
  // A member, a ticket buyer, a fundraiser and a volunteer were each heading
  // for their own surface with their own link. There is one now, and one way
  // in: an emailed link that is single-use, hashed at rest and short-lived,
  // which mints a session. Nobody ever has a password.
  //
  // It is the volunteer link's model, generalised, not a second auth system:
  // the same CSPRNG token, the same hash-at-rest, the same identical answer
  // for a known and an unknown email. What changes is that the link is spent
  // on arrival and the SESSION is what lasts, so a link forwarded on, or
  // sitting in a mailbox somebody else can read next year, opens nothing.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supporter_links (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      requested_ip TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_supporter_links_person ON supporter_links (org_id, person_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supporter_sessions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_supporter_sessions_person ON supporter_sessions (org_id, person_id)`);
  // Two facts the Members screen shows staff: that a link was sent, and that
  // the person opened their page. Neither is a metric — they are the two
  // things somebody about to chase a lapsed member needs to know first.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS your_page_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS your_page_opened_at TIMESTAMPTZ`);
  // An auto-renewing membership is a recurring subscription; this is what
  // lets a member turn that off from their own page without cancelling the
  // membership they have already paid for.
  await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS auto_renew_subscription_id TEXT`);

  // ── FIX-11 Part 1 — THE TRAIL EVERYTHING LEAVES ──────────────────────────
  // `fin_audit_log` was a finance-settings table that thirty-three hand-placed
  // calls wrote to. It is now the audit log for the whole application, written
  // in ONE place (middleware/auditTrail.js). The columns below are what a row
  // needs to be read by somebody who was not there: who acted and in what
  // capacity, which record, and both sides of every field that moved.
  //
  // The table is not renamed. Renaming it would orphan the rows already in it
  // on every live org, and the history we have is the history we have.
  // AN ORG'S HISTORY GOES WITH THE ORG. The foreign key was a bare
  // REFERENCES, which was harmless while only a handful of finance-settings
  // routes wrote rows and became a wall the moment every route did: deleting
  // an organisation now had to delete its audit rows first, and four test
  // teardowns and the account-closing path all had to know that. Cascade says
  // it once, where the relationship is declared. The append-only trigger still
  // fires on the cascaded delete, so the application cannot reach this by
  // deleting an org either (routes/billing.js is the one path that may, and it
  // says so out loud).
  // FIX-12 Part 5 — SEVEN YEARS, WHATEVER HAPPENS TO THE ORG. The cascade
  // above meant deleting an organisation deleted its history with it, inside
  // the seven years the log promises. There is no foreign key at all now:
  // org_id stays on every row as plain text, an org can be deleted, and its
  // audit rows outlive it.
  await pool.query(`ALTER TABLE fin_audit_log DROP CONSTRAINT IF EXISTS fin_audit_log_org_id_fkey`);

  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS actor_kind TEXT`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS entity_label TEXT`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS before_fields JSONB`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS after_fields JSONB`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS summary TEXT`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS record_count INTEGER`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS request_method TEXT`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS request_path TEXT`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS status_code INTEGER`);
  await pool.query(`ALTER TABLE fin_audit_log ADD COLUMN IF NOT EXISTS ip TEXT`);
  // Newest first, inside one org, is how the screen reads it; the other two
  // are the filters it offers. Every one of these is (org_id, …) first because
  // an audit row is never read across organisations.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org_time ON fin_audit_log (org_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org_actor ON fin_audit_log (org_id, user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org_entity ON fin_audit_log (org_id, entity_type, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org_record ON fin_audit_log (org_id, entity_id)`);

  // ── FIX-14 Part 2 — EDIT EVERYTHING, AND UNDO A DELETE ───────────────────
  // An edited conversation, next step or task says so: who and when. The
  // previous versions are not kept here; they are in the audit log, which
  // already holds the before and after of every edit and can never lose them.
  // FIX-14 Part 2b: pledges, asks, households and relationships too.
  for (const t of ["interactions", "threads", "tasks", "pledges", "opportunities", "households", "donor_relationships"]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS edited_by TEXT`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS edited_by_name TEXT`);
  }
  // A relationship says who linked the two, so "whoever made it, or an admin"
  // can be asked of it like everything else.
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  // A DELETE THAT CAN BE UNDONE without every reader learning a deleted_at
  // column: the row is moved here whole, and Undo puts it back exactly as it
  // was (same id, same columns). Seventy queries read `interactions`; none of
  // them has to change for a deleted entry to vanish from all of them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deleted_records (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      row_data JSONB NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      restored_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deleted_records_org ON deleted_records (org_id, created_at DESC)`);
  // HARDEN-2: a person's OPEN deletion records, by person (personTrash.js,
  // scripts/ops/stale-deletions-readonly.sql and the trigger below all ask this).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deleted_records_open_person ON deleted_records (org_id, record_id)
                      WHERE table_name = 'donors' AND restored_at IS NULL`);
  // HARDEN-2: an open deletion record is about one row. When a new row takes a
  // deleted person's id (Load sample data reuses its ids after Clear), that
  // person is live again, so the record is closed, in the same statement,
  // whichever door did it. Without this, Clear and then Load sample data put a
  // person back on the list whose deletion record was still open.
  // Closed, never deleted: the record of who deleted them stays.
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_person_row_forgets_trash() RETURNS TRIGGER AS $fn$
    BEGIN
      UPDATE deleted_records r SET restored_at = NOW()
        FROM (SELECT DISTINCT org_id, id FROM new_rows) x
       WHERE r.org_id = x.org_id AND r.record_id = x.id AND r.table_name = 'donors' AND r.restored_at IS NULL;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_person_row_forgets_trash_delete ON donors`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_person_row_forgets_trash_insert ON donors`);
  await pool.query(`CREATE TRIGGER trg_person_row_forgets_trash_insert AFTER INSERT ON donors
                      REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION steward_person_row_forgets_trash()`);
// SPLIT-2 end
}

module.exports = { run: run5 };
