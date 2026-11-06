// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 6 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { query, run } = require("../query");

// `pool` here is the init session, as it was in runSchemaInit.
async function run6(pool) {
// SPLIT-2 db.js piece 47

  // FIX-41 REMOVAL. Something with money or people attached is RETIRED, not
  // deleted: hidden from new use, kept on every past record (removal.js).
  // These say when and by whom. Undo puts back what the columns were.
  for (const t of ["event_levels", "membership_levels", "volunteer_slots", "fin_funds", "campaigns", "volunteer_opportunities"]) {
    if (t !== "volunteer_opportunities") await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS retired_by TEXT`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS retired_by_name TEXT`);
  }

  // APPEND-ONLY, ENFORCED BY THE DATABASE, not by a convention about which
  // routes exist. A trail that can be edited is not a trail, and the person
  // most motivated to edit it is the person it incriminates. No screen and no
  // route can change or remove a row: the trigger refuses UPDATE and DELETE
  // outright.
  //
  // THE ONE EXCEPTION, and it is not a loophole: closing an organisation's
  // account erases that organisation's data, audit rows included, and that
  // erasure is a deliberate act of the account-closing path rather than
  // something a request can reach. It announces itself by setting a
  // transaction-local flag, so the refusal is the default and the exception is
  // visible in the one function that uses it.
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_audit_append_only() RETURNS TRIGGER AS $fn$
    BEGIN
      IF current_setting('steward.app_connection', true) IS DISTINCT FROM 'on' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END IF;
      -- FIX-12 Part 5: the purge flag reaches only rows past seven years.
      IF current_setting('steward.audit_purge', true) = 'on' AND TG_OP = 'DELETE'
         AND OLD.created_at < NOW() - INTERVAL '7 years' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'fin_audit_log is append-only: % from the application is refused', TG_OP
        USING ERRCODE = 'check_violation';
    END;
    $fn$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_audit_append_only ON fin_audit_log`);
  await pool.query(`
    CREATE TRIGGER trg_audit_append_only
      BEFORE UPDATE OR DELETE ON fin_audit_log
      FOR EACH ROW EXECUTE FUNCTION steward_audit_append_only()`);
  // FIX-12 Part 5 — ONE AUDIT LOG. user_admin_audit (BUILD-93: who removed
  // whom) was a second trail the audit screen never read. Its rows move into
  // fin_audit_log with their ORIGINAL times and ids (prefixed, so a re-run is a
  // no-op), carrying ids rather than addresses (FIX-12 Part 4), and the old
  // table goes. The route now improves the middleware's row instead.
  {
    const [{ t }] = (await pool.query(`SELECT to_regclass('user_admin_audit') AS t`)).rows;
    if (t) {
      await pool.query(`
        INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                   entity_label, changes, created_at)
        SELECT 'al_uaa_' || id, org_id, actor_user_id,
               CASE WHEN actor_user_id IS NULL THEN 'System' ELSE NULL END,
               CASE WHEN actor_user_id IS NULL THEN 'system' ELSE 'user' END,
               CASE action WHEN 'removed' THEN 'removed from the team'
                           WHEN 'reactivated' THEN 'reactivated'
                           ELSE 'removal refused' END,
               'user', target_user_id, NULL,
               jsonb_build_object('migrated_from', 'user_admin_audit', 'target_role', target_role, 'detail', detail),
               created_at
          FROM user_admin_audit
        ON CONFLICT (id) DO NOTHING`);
      const [{ a }] = (await pool.query(`SELECT COUNT(*)::int AS a FROM user_admin_audit`)).rows;
      const [{ b }] = (await pool.query(`SELECT COUNT(*)::int AS b FROM fin_audit_log WHERE id LIKE 'al_uaa_%'`)).rows;
      if (b >= a) { await pool.query(`DROP TABLE user_admin_audit`); console.log(`[audit] merged ${a} user_admin_audit row(s) into fin_audit_log`); }
      else console.error(`[audit] user_admin_audit merge incomplete (${b}/${a}); the old table is kept`);
    }
  }
  // ── FIX-11 Part 2 — A TABLE IS A ROW, NOT A STRING ON A GUEST ────────────
  // A table used to exist only as `event_attendees.table_label`: a table came
  // into being the moment somebody was sitting at it and vanished when they
  // left. So on a real gala the seating card said "Drag a name onto a table to
  // seat them" with no tables on it and no way to make one, and a guest had
  // nowhere to go. A table is a thing the organisation decides on before the
  // guests arrive, and it has a number of seats, which is the fact the whole
  // screen turns on.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_tables (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      seats INTEGER NOT NULL DEFAULT 8 CHECK (seats > 0 AND seats <= 60),
      -- A sponsor table is held for a sponsor's party, which is why
      -- "Seat everyone" places them first and never fills their seats with
      -- somebody else.
      sponsor_name TEXT,
      sort INTEGER,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (event_id, label)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_tables_event ON event_tables (org_id, event_id, sort)`);
  // PARITY-4: THE DRAWN ROOM. A table is round or long (a head table, a
  // trestle along a wall), a guest sits on a numbered chair at it, and a guest
  // can be marked VIP so the room knows who to greet. All three extend the
  // FIX-11 rows: still one table row and one attendee row, never a second
  // seating model. `seat_no` is NULL for anyone seated before chairs existed;
  // `seatPlaces` (shared/eventShape.js) gives them the lowest free chair.
  await pool.query(`ALTER TABLE event_tables ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'round'`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS seat_no INTEGER`);
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS vip BOOLEAN NOT NULL DEFAULT FALSE`);

  // THE SEAT POINTS AT THE TABLE ROW. `table_label` stays, written from the
  // table's label on every move, because the print chart, the name tags, the
  // kiosk and the guest export all read it and none of them should have to
  // change. A rename updates both in one statement.
  await pool.query(`ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS table_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_attendees_table ON event_attendees (org_id, event_id, table_id)`);

  // THE EXISTING CHARTS KEEP THEIR TABLES. Every distinct table_label already
  // in the database becomes a real table, sized to hold the people already at
  // it (never smaller than eight, which is the common round table), so no
  // seating plan anybody has made is lost by this build. One-shot, by flag, and
  // a failure leaves the flag unset so the next boot retries.
  try {
    const done = await pool.query("SELECT 1 FROM schema_flags WHERE flag='f11_event_tables_backfill'");
    if (!done.rows.length) {
      const r = await pool.query(`
        INSERT INTO event_tables (id, org_id, event_id, label, seats, sort, created_by, created_by_name)
        SELECT 'etb_' || substr(md5(a.event_id || ':' || a.table_label), 1, 12),
               a.org_id, a.event_id, a.table_label,
               GREATEST(COUNT(*)::int, 8), NULL, 'system:f11-backfill', 'Steward (seating backfill)'
          FROM event_attendees a
         WHERE a.table_label IS NOT NULL AND a.table_label <> ''
         GROUP BY a.org_id, a.event_id, a.table_label
        ON CONFLICT (event_id, label) DO NOTHING
        RETURNING id`);
      await pool.query(`
        UPDATE event_attendees a SET table_id = t.id
          FROM event_tables t
         WHERE t.event_id = a.event_id AND t.label = a.table_label AND a.table_id IS NULL`);
      await pool.query("INSERT INTO schema_flags (flag) VALUES ('f11_event_tables_backfill') ON CONFLICT (flag) DO NOTHING");
      if (r.rows.length) console.log(`[seating] ${r.rows.length} existing table(s) became real rows`);
    }
  } catch (e) {
    console.error("[seating] CRITICAL: the table backfill failed — existing seating charts have no table rows yet:", e.message);
  }

  // ── FIX-11 Part 3 — WHAT A BOOKKEEPER NEEDS AND THE FILE DID NOT CARRY ───
  //
  // THE CHEQUE NUMBER. Jonathan's August export had 0 of 51 cheques carrying
  // one, and the reason was not a missing export column: the number was never
  // a column at all. The deposit sheet wrote it into the gift's NOTES
  // ("Check 1041 · spring appeal"), and the export reads `reference`, which is
  // the external or Stripe id. A cheque number is how a bookkeeper ties a row
  // to a bank statement, so it is a field.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS check_number TEXT`);
  // SEARCH-2 · ⌘K finds a gift by its exact amount ("$500") or cheque number
  // ("1053"), and an email or note by its type, newest first. Each is an exact
  // match inside one org, so each gets the index that keeps it from reading
  // the org's whole gift list or timeline as an org grows.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_amount ON gifts (org_id, amount)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_org_check ON gifts (org_id, check_number) WHERE check_number IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_org_type_date ON interactions (org_id, type, date DESC)`);

  // WHICH DEPOSIT THIS GIFT ARRIVED IN. `deposited_on` is the day the money
  // reached the bank (the deposit sheet's date, or a payout's arrival date);
  // `deposit_ref` names the deposit (a payout id, or `sheet:<date>` for a
  // cheque-and-cash run). Together they are the grouping the deposits file is
  // built from, and without them nothing tied a gift to the line on the
  // statement it is part of.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS deposited_on TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS deposit_ref TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_deposit ON gifts (org_id, deposited_on, deposit_ref)`);

  // ── QBO-IN · GIFTS ENTERED IN QUICKBOOKS COME INTO STEWARD ───────────────
  // `read_from_vendor` marks a gift Steward READ from the books ('quickbooks'),
  // so the send side never posts it back (qboSync.pendingWhere). A read is a
  // run: its plan lines are kept (the review screen and every number on it
  // open them), and `qbo_read_gifts` is the once-only key, one row per
  // QuickBooks line ever recorded (company + transaction + line).
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS read_from_vendor TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qbo_read_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      realm_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'review',
      read_from TEXT,
      automatic BOOLEAN NOT NULL DEFAULT false,
      summary JSONB,
      import_id TEXT,
      saved_at TIMESTAMPTZ,
      undone_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_qbo_read_runs_org ON qbo_read_runs (org_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qbo_read_lines (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      run_id TEXT NOT NULL,
      line_key TEXT NOT NULL,
      txn_type TEXT NOT NULL,
      txn_id TEXT NOT NULL,
      txn_date TEXT,
      cents BIGINT NOT NULL DEFAULT 0,
      account_id TEXT,
      account_name TEXT,
      fund_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      business BOOLEAN NOT NULL DEFAULT false,
      method TEXT,
      check_number TEXT,
      memo TEXT,
      bucket TEXT NOT NULL,
      reason TEXT,
      donor_id TEXT,
      matched_gift_id TEXT,
      candidates JSONB,
      gift_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_qbo_read_lines_run ON qbo_read_lines (org_id, run_id, bucket)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qbo_read_gifts (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      line_key TEXT NOT NULL,
      realm_id TEXT NOT NULL,
      txn_type TEXT NOT NULL,
      txn_id TEXT NOT NULL,
      customer_id TEXT,
      cents BIGINT NOT NULL,
      gift_id TEXT,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recorded',
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, line_key)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_qbo_read_gifts_txn ON qbo_read_gifts (org_id, realm_id, txn_type, txn_id)`);

  // THE CHEQUE NUMBERS ALREADY RECORDED, recovered from the notes the deposit
  // sheet wrote them into. One-shot, by flag. The pattern is the one
  // routes/crm.js writes and nothing else uses, so a note that merely mentions
  // a cheque is not mined for a number.
  try {
    const done = await pool.query("SELECT 1 FROM schema_flags WHERE flag='f11_check_number_backfill'");
    if (!done.rows.length) {
      const r = await pool.query(`
        UPDATE gifts
           SET check_number = substring(notes from '(?:^|· )Check ([A-Za-z0-9-]{1,24})')
         WHERE check_number IS NULL
           AND notes ~ '(?:^|· )Check [A-Za-z0-9-]{1,24}'
        RETURNING id`);
      await pool.query("INSERT INTO schema_flags (flag) VALUES ('f11_check_number_backfill') ON CONFLICT (flag) DO NOTHING");
      if (r.rows.length) console.log(`[books] recovered ${r.rows.length} cheque number(s) from gift notes`);
    }
  } catch (e) {
    console.error("[books] CRITICAL: the cheque-number backfill failed — existing cheques export without a number:", e.message);
  }

  // ── FIX-11 Part 5 — BCC LOGGING IS PER ORGANISATION ──────────────────────
  // `INBOUND_EMAIL_ENABLED` is one environment flag for the whole deployment,
  // which cannot express "on for every real customer and off for the demo".
  // The demo org is shown to strangers and its people are fictional; mail
  // arriving at its logging address has nowhere honest to go.
  //
  // DEFAULT TRUE, because the env flag is still the outer gate: this column
  // only takes an org OUT. A new org inherits whatever the deployment does.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS inbound_email_enabled BOOLEAN NOT NULL DEFAULT TRUE`);

  // ── GIVE-2 §5 — THE ORG'S OWN PROCESSING RATE ────────────────────────────
  // The donor-covers-fees gross-up was Stripe's published card rate, hard-coded
  // in three places. It is wrong in the expensive direction for two of the ways
  // money now arrives: a nonprofit on Stripe's discounted rate pays 2.2% and was
  // asked to cover 2.9%, and an ACH gift pays 0.8% capped at $5 and was asked to
  // cover a card rate.
  //
  // NULL means "I have not told Steward my rate", which is where every org
  // starts, and `shared/processingRates.js` answers with the published default
  // for it. So this migration changes no org's arithmetic by a cent until
  // somebody types a number into Settings.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS fee_rate_card_pct NUMERIC(6,5)`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS fee_rate_card_flat_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS fee_rate_ach_pct NUMERIC(6,5)`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS fee_rate_ach_flat_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS fee_rate_ach_cap_cents INTEGER`);

  // ── GIVE-2 §4 — THE CARD A RETURNING DONOR ALREADY GAVE ──────────────────
  // Stripe's customer id for this donor ON THE ORG'S OWN CONNECTED ACCOUNT, so
  // a donor who chose "Remember me" can give again in one tap. Steward stores
  // the id and nothing else: no card number, no expiry, no CVC, ever. The card
  // itself lives on the org's Stripe account and is read back by its id when a
  // charge is made.
  //
  // It is per org by construction because `donors` is per org: the same human
  // giving to two organisations is two donor rows and two Stripe customers on
  // two accounts, which is right — one org may not charge a card saved with
  // another.
  // `donors.stripe_customer_id` already exists (added for the recurring layer),
  // and express giving reuses it rather than minting a second customer for the
  // same person on the same connected account.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS express_pm_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS express_pm_brand TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS express_pm_last4 TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS express_pm_saved_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_stripe_customer ON donors(org_id, stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`);

  // ── GIVE-2 §8 — THE EMPLOYERS THIS ORG KNOWS MATCH ───────────────────────
  // Typed by staff, shown to a donor on the page their gift just landed on,
  // with the company's OWN form link. No vendor, no lookup service, no contract:
  // `shared/matchingGifts.js` has the adapter shape for one and names none.
  await pool.query(`CREATE TABLE IF NOT EXISTS matching_employers (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    form_url TEXT,
    ratio TEXT,
    min_cents INTEGER,
    max_cents INTEGER,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    created_by_name TEXT
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_matching_employers_org_name ON matching_employers(org_id, lower(name))`);

  // ── GIVE-2 §5 — WHERE THE FEE NUMBER CAME FROM ───────────────────────────
  // `processor_fee_amount` has defaulted to 0 since BUILD-89S, which means a
  // gift that nobody has read a fee for is indistinguishable from a gift that
  // cost nothing. That was fine while the only gifts carrying a fee came from a
  // connected giving source that always stated one. It stops being fine the
  // moment a Fundraising panel shows "received" beside "charged": a cash gift
  // nets its full amount, an online gift whose balance transaction could not be
  // read does not, and a screen that shows the same zero for both is wrong
  // about one of them.
  //
  // So the SOURCE is recorded beside the number. NULL means nobody has said.
  //   'stripe_balance_transaction'  read off the charge itself
  //   'provider'                    stated by a connected giving source
  //   'none'                        there was no processor (cash, cheque)
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS processor_fee_source TEXT`);

  // ── GIVE-2 §4 — ONE MAGIC-LINK TABLE, TWO PURPOSES ───────────────────────
  // Express giving needs exactly what the portal's sign-in link already is: a
  // single-use, hashed, fifteen-minute token tied to an org and an email, which
  // a re-request supersedes. A second table would be a second place that
  // expiry, single use and supersession could be got wrong, so it is the same
  // table with the purpose written down.
  //
  // THE PURPOSE IS LOAD-BEARING AND BOTH CONSUMERS FILTER ON IT. An express
  // link must never open the donor portal and a portal link must never charge a
  // card. DEFAULT 'portal' is what every existing row is.
  await pool.query(`ALTER TABLE portal_magic_links ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'portal'`);

  // ── GIVE-2 §6 — THE MONTHLY SUGGESTION THE ORG NAMES ─────────────────────
  // BUILD-102 made the THRESHOLD the org's and left the suggested monthly
  // amount derived (a third of the gift). An org that knows its own sustainer
  // tier should be able to name it. NULL keeps the derived third, which is what
  // every org has today.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS form_upsell_monthly_cents INTEGER`);
  // Every gift a giving source already imported DID state its fee, so the
  // backfill is factual rather than a guess: those rows have a source.
  await pool.query(`UPDATE gifts SET processor_fee_source='provider'
                     WHERE processor_fee_source IS NULL AND giving_source_id IS NOT NULL`);

  // ── CAMPAIGN-2 · A CAMPAIGN'S PUBLIC PAGE, AND ITS PLAN ──────────────────
  //
  // A CAMPAIGN'S PAGE IS A GIVING PAGE. There is no second kind of public page:
  // `giving_pages.campaign_id` already makes a page's thermometer the
  // campaign's, and peer-to-peer fundraisers already roll into the page's own
  // total, so linking the page to the campaign is what makes every one of those
  // gifts count toward the same bar without a line of aggregation.
  //
  // What was missing is WHICH page. A campaign may legitimately have several
  // linked pages (an appeal page and a walk's p2p page), so the one the
  // campaign screen opens and the template creates is flagged. One flag, one
  // page, and a partial unique index makes "one" a fact rather than a habit.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS is_campaign_page BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_pages_one_campaign_page
                      ON giving_pages(org_id, campaign_id) WHERE is_campaign_page`);

  // THE MATCHING CHALLENGE. Shown only when the organisation has entered one,
  // and `match_started_at` is what makes "how much of it is left" answerable:
  // the match applies to gifts recorded from the moment it began, not to money
  // that arrived before anybody promised to double it.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_cents INTEGER`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_sponsor TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_started_at TIMESTAMPTZ`);
  // FIX-49 · "Leave grants off the public bar". Awarded grants count on a
  // campaign's public bar unless this is on; the admin cards always count them.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS grants_off_public_bar BOOLEAN NOT NULL DEFAULT false`);

  // THE DONOR'S OWN CHOICE ABOUT THEIR NAME, gift by gift. FALSE by default and
  // the default IS the decision (BUILD-103's rule, applied to a public page): a
  // gift to an organisation is not a public act unless the person giving it
  // says so. A separate column from `show_name_to_fundraiser` because they are
  // two different audiences and two different answers — a donor may be happy
  // for the friend whose page they gave through to know, and not for the
  // internet.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS show_name_publicly BOOLEAN NOT NULL DEFAULT FALSE`);

  // PARITY-2 Part 2 · PEER-TO-PEER PAGES. Two switches on the page, both off by
  // default so every campaign already running keeps behaving as it did.
  // `p2p_requires_approval`: a new fundraiser page is written 'pending' and is
  // not public until a staff member approves it (peer_fundraisers.status is
  // 'active' | 'pending' | 'archived'; only 'active' is ever shown or takes a
  // gift). `ends_on`: the date the countdown runs to on a page that does not
  // count toward a campaign; a linked page counts down to the campaign's end.
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS p2p_requires_approval BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS ends_on DATE`);

  // THE STAFF PLAN. A template's steps are dated TASKS, not Threads: a Thread
  // is one person's list and requires a donor by construction (`threads.donor_id
  // NOT NULL`), while "draft the appeal" is the campaign's and belongs to
  // nobody in particular until somebody takes it. The column is what lets the
  // plan be read back as a plan.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS campaign_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_campaign ON tasks(org_id, campaign_id) WHERE campaign_id IS NOT NULL`);

  // ENGAGE-1 — the two scores, as last computed (engagement.js). Derived data:
  // an org's rows are replaced as one set by the compute, never edited by a
  // person. Stored so the Donors list can sort by them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_scores (
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      engagement INTEGER NOT NULL DEFAULT 0,
      generosity INTEGER NOT NULL DEFAULT 0,
      band TEXT NOT NULL DEFAULT 'distant',
      reason TEXT,
      last_touch TEXT,
      parts JSONB,
      computed_for TEXT,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      PRIMARY KEY (org_id, donor_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_scores_eng ON donor_scores(org_id, engagement DESC)`);
  // WIRE-1 addendum: where their giving stands against their OWN rhythm
  // (drift.js assessDrift): 'on_track', 'drifting', 'lapsed', or NULL with
  // fewer than two gifts. The closeness word reads it, so a once-a-year donor
  // who gave on time is On track, never Cooling.
  await pool.query(`ALTER TABLE donor_scores ADD COLUMN IF NOT EXISTS pattern TEXT`);
  // STATUS-1: the last day they are on time by the one rhythm (engagement.onTimeThrough).
  await pool.query(`ALTER TABLE donor_scores ADD COLUMN IF NOT EXISTS on_time_through TEXT`);

  // ── LIVE-1 · EVERY DOOR FEEDS THE MACHINE ─────────────────────────────────
  // donor_rhythm: what the one after-change step (afterChange.js) computed for
  // a person the last time any door touched them. Drift still decides "late"
  // (drift.js); this row remembers the answer so a readout can say who BECAME
  // late, which a read-time computation cannot.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_rhythm (
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      rhythm TEXT NOT NULL DEFAULT 'none',
      cadence_days INTEGER,
      expected_next TEXT,
      drift_state TEXT,
      state_changed_at TIMESTAMPTZ DEFAULT NOW(),
      giving_this_year NUMERIC NOT NULL DEFAULT 0,
      giving_last_year NUMERIC NOT NULL DEFAULT 0,
      largest_gift NUMERIC NOT NULL DEFAULT 0,
      last_door TEXT,
      computed_for TEXT,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      PRIMARY KEY (org_id, donor_id)
    )`);
  // SCALE-2 · the gift-derived half of each person's Drift answer, stored for
  // one org calendar day (server.js driftGiftAnswers). `assessment` is TEXT,
  // not JSONB, so it reads back byte for byte in the order it was written.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_drift (
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      assessment TEXT NOT NULL,
      yesterday_high BOOLEAN NOT NULL DEFAULT false,
      pledge_recent BOOLEAN NOT NULL DEFAULT false,
      refused_rows INTEGER NOT NULL DEFAULT 0,
      computed_for TEXT NOT NULL,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, donor_id)
    )`);
  // INSIGHTS-1 · gift type on a gift and a pledge (Stock, IRA, DAF, …), written
  // by the import from now on; existing rows keep NULL and the engine reads
  // their words instead. The ladder's major-gift line is a setting (NULL: the
  // default); it is not Capture's big-gift alert line (major_gift_line_cents).
  // What she did with each card, her Review and Link decisions: new tables, so
  // nothing that was here changes. A row she marks Not a gift is kept whole in
  // insight_reviews.row_data while it lives in Finance (routes/insights.js).
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS gift_type TEXT`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS gift_type TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ladder_major_line_cents INTEGER`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_outcomes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_key TEXT NOT NULL,
      donor_ids TEXT[] NOT NULL DEFAULT '{}',
      state TEXT NOT NULL,
      until DATE,
      reason TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_insight_outcomes_org ON insight_outcomes (org_id, kind, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_shown (
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_key TEXT NOT NULL,
      donor_ids TEXT[] NOT NULL DEFAULT '{}',
      first_shown_on DATE NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      PRIMARY KEY (org_id, kind, item_key)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_reviews (
      org_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      as_type TEXT,
      row_data JSONB,
      fin_id TEXT,
      fin_prev JSONB,
      donor_id TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, gift_id)
    )`);
  // HOME-3: `received` is the value received on a row marked Partly a gift
  // (decision 'partly'): the part that is Finance revenue, not giving.
  for (const c of ["as_type TEXT", "row_data JSONB", "fin_id TEXT", "fin_prev JSONB", "donor_id TEXT", "received NUMERIC"])
    await pool.query(`ALTER TABLE insight_reviews ADD COLUMN IF NOT EXISTS ${c}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_links (
      org_id TEXT NOT NULL,
      network_key TEXT NOT NULL,
      decision TEXT NOT NULL,
      relationship_ids TEXT[] NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, network_key)
    )`);
  // Any write to gifts forgets the stored answer of every person it touched,
  // in the same transaction, whichever door wrote it.
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_gift_forgets_drift() RETURNS TRIGGER AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        DELETE FROM donor_drift s USING (SELECT DISTINCT org_id, donor_id FROM new_rows) x
         WHERE s.org_id = x.org_id AND s.donor_id = x.donor_id;
      ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM donor_drift s USING (SELECT DISTINCT org_id, donor_id FROM old_rows) x
         WHERE s.org_id = x.org_id AND s.donor_id = x.donor_id;
      ELSE
        DELETE FROM donor_drift s USING (SELECT org_id, donor_id FROM new_rows UNION SELECT org_id, donor_id FROM old_rows) x
         WHERE s.org_id = x.org_id AND s.donor_id = x.donor_id;
      END IF;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql`);
  for (const [ev, ref] of [["INSERT", "NEW TABLE AS new_rows"], ["DELETE", "OLD TABLE AS old_rows"],
                           ["UPDATE", "NEW TABLE AS new_rows OLD TABLE AS old_rows"]]) {
    await pool.query(`DROP TRIGGER IF EXISTS trg_gift_forgets_drift_${ev.toLowerCase()} ON gifts`);
    await pool.query(`CREATE TRIGGER trg_gift_forgets_drift_${ev.toLowerCase()} AFTER ${ev} ON gifts
                        REFERENCING ${ref} FOR EACH STATEMENT EXECUTE FUNCTION steward_gift_forgets_drift()`);
  }
  // Someone the after-change step saw cross into a group by rule.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_crossings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      door TEXT,
      crossed_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_crossings_org ON group_crossings (org_id, crossed_at DESC)`);
  // A readout: "what this told us", written when an import, a giving-source
  // read or a QuickBooks read finishes. `lines` holds each line's kind, count,
  // the donor and gift ids behind it, its action and its Why.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS readouts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT,
      title TEXT NOT NULL,
      headline TEXT NOT NULL,
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      for_date TEXT NOT NULL,
      is_example BOOLEAN NOT NULL DEFAULT FALSE,
      removed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_readouts_org ON readouts (org_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_readouts_source ON readouts (org_id, source_kind, source_id)`);
  // FIX-37 · AN IMPORT'S RECENT-GIFT WORK, BEHIND THE SCREEN. One job row per
  // import run (its progress, the thank-you answer it runs under, whether the
  // readout has been written), and one work row per recent gift still to go
  // through recordGift. The work rows are what make the job survive a
  // restart: a gift the file brought is never only in memory. A done row is
  // deleted, so what is left is exactly what is still to do.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_recent_jobs (
      import_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      thank_yous INTEGER NOT NULL DEFAULT 0,
      thanks JSONB,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      touched JSONB NOT NULL DEFAULT '[]'::jsonb,
      readout_claimed BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  // FIX-52 · A SPREADSHEET IMPORT IS A JOB. Clicking Import writes this row and
  // returns; the write runs behind the screen in ONE transaction, and the
  // modal and the Imports list read the job's real state from here, never
  // from a request that may have been dropped. request_key is the file and
  // the preview: while one is running, a second click is the same job.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheet_import_jobs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      phase TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      file_name TEXT,
      error TEXT,
      result JSONB,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  // HARDEN-2: the key under "the same file is the same job while it runs"
  // (routes/sheetImport.js takes the org's commit lock above it). Over running
  // rows only, so finished history never blocks it; and a table that somehow
  // holds two running rows for one file logs and boots rather than failing.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sheet_import_jobs_running ON sheet_import_jobs (org_id, request_key) WHERE status = 'running'`);
  } catch (e) { console.error("[harden-2] uq_sheet_import_jobs_running not created:", e.message); }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sheet_import_jobs_org ON sheet_import_jobs (org_id, started_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_recent_work (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      gift JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_recent_work_run ON import_recent_work (import_id, seq)`);
  // FIX-37: the answer to "have the last 30 days already been thanked?",
  // saved with the run and shown in its history.
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS thanks_answer JSONB`);
  // SCALE-1 · THE QUEUE (jobQueue.js). One row per run of a background job;
  // one row per periodic job's next due time. At most one waiting row per key,
  // which is what makes a second enqueue of the same run a no-op.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_queue (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      org_id TEXT,
      key TEXT NOT NULL,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','running','done','dead')),
      priority INTEGER NOT NULL DEFAULT 5,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      backoff_ms INTEGER,
      run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      round TEXT,
      locked_by TEXT,
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS backoff_ms INTEGER`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS job_queue_one_waiting ON job_queue (key) WHERE status = 'waiting'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_ready ON job_queue (status, priority, run_after)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_running_key ON job_queue (key) WHERE status = 'running'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_running_org ON job_queue (org_id) WHERE status = 'running'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_round ON job_queue (round) WHERE round IS NOT NULL`);
  // JOBS-1 · THE OUTBOX (server/shared/outbox.js). A door writes the event in
  // the same transaction as its row; the relay moves it onto job_queue, one
  // job per handler. `ready` is false while the door is still writing the
  // facts its handlers read; a row left not ready (the process died) is
  // relayed anyway after a minute, and its handlers read the facts live.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events_outbox (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      donor_ids TEXT[] NOT NULL DEFAULT '{}',
      ready BOOLEAN NOT NULL DEFAULT TRUE,
      relayed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_outbox_unrelayed ON events_outbox (created_at) WHERE relayed_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_outbox_donors ON events_outbox USING GIN (donor_ids)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_schedule (
      name TEXT PRIMARY KEY,
      every_ms BIGINT NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_enqueued_at TIMESTAMPTZ
    )`);
  // DEPLOY-1 · one row per process that runs jobs (jobQueue.beatProcess); the web's /health reads the worker's here.
  await pool.query(`CREATE TABLE IF NOT EXISTS process_heartbeats (id TEXT PRIMARY KEY, role TEXT NOT NULL, build_sha TEXT,
    handlers TEXT[] NOT NULL DEFAULT '{}', started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), stopped_at TIMESTAMPTZ)`);
  // POOL-1: the process's connection budget ({ max, setMax }), for npm run status.
  await pool.query(`ALTER TABLE process_heartbeats ADD COLUMN IF NOT EXISTS pool JSONB`);
  // SCALE-1 · rate-limit counters every web replica shares (rateLimitStore.js),
  // and the once-an-hour mark for an ops alert, so two replicas send it once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 0,
      reset_at TIMESTAMPTZ NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset ON rate_limit_hits (reset_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_in_flight (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_in_flight_org ON import_in_flight (org_id, started_at)`);
  // SCALE-1 · each org's AI calls per UTC day (aiClient.js's daily budget).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      org_id TEXT NOT NULL,
      day DATE NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, day)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_alert_marks (
      hour_key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // The nightly check (HARDEN-1/2) is gone, and its one result table with it.
  // Its read-only queries live on as scripts/*-readonly.sql.
  await pool.query(`DROP TABLE IF EXISTS nightly_check_runs`);
  // What staff did with a line: dismissed, restored (the kind put back), or
  // acted (a task, a draft, a group opened). The learning reads these.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS readout_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      readout_id TEXT,
      line_kind TEXT NOT NULL,
      event TEXT NOT NULL,
      action_kind TEXT,
      donor_id TEXT,
      made_id TEXT,
      acted_on TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      CONSTRAINT readout_events_event CHECK (event IN ('dismissed','restored','acted'))
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_readout_events_org ON readout_events (org_id, line_kind, created_at DESC)`);
  // Files map themselves: a file's column answers saved against its header
  // shape, and value answers ("CHK" is a check) saved against the field.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_shape_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      shape_key TEXT NOT NULL,
      headers JSONB NOT NULL,
      mapping JSONB NOT NULL,
      times_used INTEGER NOT NULL DEFAULT 1,
      is_example BOOLEAN NOT NULL DEFAULT FALSE,
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      UNIQUE (org_id, shape_key)
    )`);
  // IMPORT-5: the one reader's saved mappings share the table ('sheet'; shape
  // key "sheet:<headers>", mapping header → role); the old mapper's are 'mapper'
  await pool.query(`ALTER TABLE import_shape_mappings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'mapper'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_value_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      field TEXT NOT NULL,
      raw_norm TEXT NOT NULL,
      raw TEXT NOT NULL,
      value TEXT NOT NULL,
      times_used INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      UNIQUE (org_id, field, raw_norm)
    )`);
  // APPEAL-WHY: the campaign a campaign is compared with, when the user chose one.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS compare_campaign_id TEXT`);

  // SURVEY-1 — surveys and their answers. A survey's questions live in
  // `sections` (shared/surveyShape.js normalises them). A response is NAMED
  // (linked to a person by a personal link or a matched email, or carrying the
  // name and email they typed when no record matched) or ANONYMOUS. The CHECK
  // is the promise the anonymous page makes, held by the database: an
  // anonymous row has no person, no name and no email, whatever code wrote it.
  // Neither table has an IP column.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      intro TEXT,
      thank_you TEXT,
      mode TEXT NOT NULL DEFAULT 'named',
      audience TEXT NOT NULL DEFAULT 'anyone',
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, slug)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      anonymous BOOLEAN NOT NULL,
      donor_id TEXT REFERENCES donors(id) ON DELETE SET NULL,
      respondent_name TEXT,
      respondent_email TEXT,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      CONSTRAINT survey_anonymous_is_anonymous CHECK (NOT anonymous OR (donor_id IS NULL AND respondent_name IS NULL AND respondent_email IS NULL))
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_survey_responses ON survey_responses(org_id, survey_id, submitted_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_survey_responses_donor ON survey_responses(org_id, donor_id) WHERE donor_id IS NOT NULL`);
  // The volunteer survey whose personal link rides on the hours thank-you draft.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS volunteer_survey_id TEXT`);

  // COMMS-2 — the brand kit. The logo stays orgs.logo_data, the signer stays
  // receipt_signature_name/title and the address stays receipt_address (one
  // store each, already read by receipts); these are what was missing.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS brand_primary TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS brand_secondary TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS brand_signature_extra TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tax_language TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS statement_your_year BOOLEAN NOT NULL DEFAULT TRUE`);
  // The org's own wording for each template kind (shared/brandKit.js). A row
  // exists once somebody saved it, which is what "reviewed" means.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      reviewed_at TIMESTAMPTZ,
      reviewed_by_name TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, kind)
    )`);

  // ── PARITY-1 E · STARTER EMAILS SOMEBODY HAS READ ──────────────────────
  // One row per org per starter key (shared/emailTemplates.js) once a person
  // has saved a campaign from that starter with its body changed. No row means
  // the gallery and the editor still say "Not yet reviewed".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_starter_reviews (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      starter_key TEXT NOT NULL,
      campaign_id TEXT,
      reviewed_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      PRIMARY KEY (org_id, starter_key)
    )`);

  // PARITY-1 Part 1 · giving levels. The two cut points between General, Mid
  // and Major, on what a person gave in the last 12 months (donorStatus.js).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS giving_level_mid_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS giving_level_major_cents INTEGER`);

  // ── PARITY-1 Part B — A FILE ON A CONVERSATION OR A NOTE ────────────────
  // The bytes live in the asset seam (assetStore.js, kind 'ixfile'); this row
  // names the file, ties it to one interaction on one person, and says who
  // attached it. Delete is SOFT (deleted_at): the row stays, the signed door
  // stops serving it, and the asset retention sweep keeps the bytes 90 days.
  // No FK to interactions on purpose: a trashed interaction is deleted and
  // restorable (FIX-14 Undo), and its files come back with it because every
  // read joins the live interaction.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interaction_attachments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      interaction_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ix_attach_donor ON interaction_attachments (org_id, donor_id) WHERE deleted_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ix_attach_interaction ON interaction_attachments (org_id, interaction_id)`);

  // ── PARITY-1 Part F · VIDEO THANK-YOUS ────────────────────────────────────
  // A short video she records on the donor profile. The bytes live in the
  // org's asset store (portal_assets, kind 'video_thanks'); this row is the
  // pointer, the unguessable token the donor's link carries, and how often
  // the donor has watched it. Saving one writes a DRAFT email in the review
  // queue (milestone_drafts, source 'video_thanks'); nothing sends by itself.
  // A view is recorded by a POST from the page, never by the GET.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_thanks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
      asset_id TEXT,
      mime TEXT,
      bytes INTEGER,
      duration_seconds INTEGER,
      token TEXT NOT NULL UNIQUE,
      draft_id TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      first_viewed_at TIMESTAMPTZ,
      view_count INTEGER NOT NULL DEFAULT 0
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_video_thanks_donor ON video_thanks (org_id, donor_id, created_at DESC)`);

  // PARITY-1 Part C · calls to make. The gift size that puts a gift on Home's
  // "Calls to make" panel (null means WHY-1's $250 floor), and a snooze per
  // gift: Snooze hides that one gift's row until the day in `until`.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS call_gift_floor_cents INTEGER`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_snoozes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      until TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, gift_id)
    )`);

  // PARITY-1 Part D · GROUPS AND JOURNEY TRIGGERS.
  // A Group is an audiences row with a `kind`: 'dynamic' (its `rules` are the
  // donor list filters, evaluated live, so nothing about membership is stored)
  // or 'static' (its people are rows in group_members, added and removed by
  // hand). A row with no kind is a saved audience from BUILD-97 and reads as
  // before. One store for every named list; no second list table.
  await pool.query(`ALTER TABLE audiences ADD COLUMN IF NOT EXISTS kind TEXT`);
  await pool.query(`ALTER TABLE audiences ADD COLUMN IF NOT EXISTS rules JSONB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      group_id TEXT NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_by_name TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (group_id, donor_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_members_donor ON group_members (org_id, donor_id)`);
  // Journeys: what narrows a trigger beyond its amount (fund, campaign, the
  // group a "joins a group" journey watches), and the event a plan was started
  // by, so one event enrols a donor in one journey once and only once.
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS trigger_filters JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS ever_enabled BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`UPDATE cultivation_templates SET ever_enabled = true WHERE journey_enabled = true AND ever_enabled = false`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS trigger_event TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS started_import_id TEXT`);   // LIVE-1: the import whose gift started it
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cultivation_plans_event_once
                    ON cultivation_plans (org_id, template_id, donor_id, trigger_event) WHERE trigger_event IS NOT NULL`);
  // JOURNEYS-3 · several journeys at once. `exclusive` marks the journeys a
  // person may be in only one of at a time (the higher one wins, as before).
  // The touch gap is the org's: no two steps from different journeys within
  // this many days of each other. A step moved to keep that gap remembers
  // the date it had, why, and which journey moved it, so an Undo can put it
  // back exactly. The plan remembers its timeline line for the same reason.
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS exclusive BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS journey_touch_gap_days INTEGER NOT NULL DEFAULT 7`);
  // AUTO-1 · A JOURNEY EMAIL STEP THAT SENDS ITSELF. Off unless an owner or
  // admin turns it on for one step, and only for words a person on staff saved.
  // `words_saved_*` is stamped by a person's own Save or Publish of a template
  // (never by a starter copy, an AI proposal or a super-admin), and the switch
  // keeps a fingerprint of the words it was turned on for: new words hold the
  // sends until somebody turns it on again for them.
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS words_saved_by TEXT`);
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS words_saved_by_name TEXT`);
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS words_saved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS auto_send_paused_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS auto_send_paused_by_name TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS auto_send_cap_noted_on TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journey_auto_steps (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      template_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      email_template_id TEXT NOT NULL,
      words_hash TEXT NOT NULL,
      turned_on_by TEXT NOT NULL, turned_on_by_name TEXT, turned_on_at TIMESTAMPTZ DEFAULT NOW(),
      turned_off_at TIMESTAMPTZ, turned_off_by_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS journey_auto_steps_one_on ON journey_auto_steps (template_id, seq) WHERE turned_off_at IS NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journey_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      template_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      donor_id TEXT NOT NULL,
      email_template_id TEXT NOT NULL,
      auto_step_id TEXT NOT NULL,
      send_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      reason TEXT,
      subject TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      sent_at TIMESTAMPTZ,
      sent_day TEXT,
      decided_by_name TEXT,
      interaction_id TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT journey_sends_status CHECK (status IN ('scheduled','claimed','sent','failed','skipped','held'))
    )`);
  // One send per person per step, ever: the row IS the idempotency key.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS journey_sends_one_per_step ON journey_sends (step_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_journey_sends_due ON journey_sends (org_id, status, send_on)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_journey_sends_donor ON journey_sends (org_id, donor_id, sent_at)`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS moved_from TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS moved_reason TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS moved_by_plan_id TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS start_interaction_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_plans_donor_active ON cultivation_plans (org_id, donor_id) WHERE status = 'active'`);
  // The daily sweep's own memory of who was in each dynamic group yesterday,
  // so "joins a group" can fire for a rule-based group. It is a cache of the
  // last sweep, never the membership itself (that is always the live rule).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_sweep_seen (
      org_id TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL,
      seen_on TEXT NOT NULL,
      PRIMARY KEY (group_id, donor_id)
    )`);

  // PARITY-2 Part 4 · AUCTIONS. An auction is a page with opening and
  // closing times (per event, or standalone); an item is something donated,
  // with the org's own fair market value; a bidder is a donors row (one
  // person record) plus a number and a hashed session token; a bid is a row
  // stamped by the DATABASE clock. Winners are computed at read time from the
  // bids (amount, then earliest), never stored, so a closed auction cannot
  // disagree with its own bids. The money is a gift through recordGift when
  // the winner pays through the org's own Stripe; the item's paid_gift_id
  // points at it. The donated item is an in-kind gift for its donor, recorded
  // once, by a person pressing a button (in_kind_gift_id).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      event_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      public_slug TEXT NOT NULL UNIQUE,
      opens_at TIMESTAMPTZ NOT NULL,
      closes_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (closes_at > opens_at)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auctions_org ON auctions (org_id, closes_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_items (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      photos JSONB NOT NULL DEFAULT '[]'::jsonb,
      donor_id TEXT,
      fmv NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fmv >= 0),
      starting_bid NUMERIC(12,2) NOT NULL CHECK (starting_bid > 0),
      bid_increment NUMERIC(12,2) NOT NULL CHECK (bid_increment > 0),
      buy_now NUMERIC(12,2) CHECK (buy_now IS NULL OR buy_now >= starting_bid),
      position INTEGER NOT NULL DEFAULT 0,
      closed_at TIMESTAMPTZ,
      in_kind_gift_id TEXT,
      paid_gift_id TEXT,
      paid_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auction_items_auction ON auction_items (org_id, auction_id, position)`);
  // FIX-41: an item with bids is retired, not deleted (removal.js). Removing a
  // winner returns the item to unassigned: bids made up to that instant stay on
  // record but no longer make anyone the winner. No payment is touched
  // (auctionCore TOP_BIDS_SQL reads it).
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS retired_by TEXT`);
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS retired_by_name TEXT`);
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_bidders (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      donor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      bidder_number INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (auction_id, bidder_number)
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_bidders_email ON auction_bidders (auction_id, LOWER(email))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_bids (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES auction_items(id) ON DELETE CASCADE,
      bidder_id TEXT NOT NULL REFERENCES auction_bidders(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      buy_now BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      created_by TEXT NOT NULL,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auction_bids_item ON auction_bids (item_id, amount DESC, created_at, id)`);
  // FIX-20 Part 1: ONE ITEM, ONE PAID WINNER. The first payment to arrive
  // claims the item (paid_payment_id, set in one UPDATE by the webhook); a
  // second payment for the same item records no gift and becomes a row here,
  // which the staff screen shows with the exact payment to refund in Stripe.
  // Steward never refunds on its own. The open checkout is remembered so a
  // second checkout for the same item expires the first one before it opens.
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS paid_payment_id TEXT`);
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS checkout_session_id TEXT`);
  // WIRE-1: the Thread step a won-but-unpaid item opened, so the sweep opens
  // one per item and never a second.
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS unpaid_thread_id TEXT`);
  // THREAD-3 · NOTHING THAT NEEDS A HUMAN SLIPS.
  // (1) A donor's email nobody answered opens one step; this row says which
  // logged email it was for, so the sweep never opens a second for it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_reply_steps (
      org_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      thread_id TEXT,
      task_id TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, interaction_id)
    )`);
  // (2) The one "Missed you at" task an event's no-shows open.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS event_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_event_noshow ON tasks (org_id, event_id) WHERE event_id IS NOT NULL AND type = 'event_no_show'`);
  // (3) Archive: the person leaves the lists and their monthly plan keeps
  // running. Delete is refused while a plan is active (routes/crm.js).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS archived_by TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_refund_flags (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      auction_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      stripe_payment_id TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      payer_name TEXT,
      payer_email TEXT,
      donor_id TEXT,
      kept_payment_id TEXT,
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT,
      resolved_by_name TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, stripe_payment_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auction_refund_flags_auction ON auction_refund_flags (org_id, auction_id)`);
  // FIX-20 Part 6: a bidder signed in on a second device. Each device holds
  // its own session token (hashed here); the first device keeps its own.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_bidder_devices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      bidder_id TEXT NOT NULL REFERENCES auction_bidders(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

  // ── PARITY-3 · VOLUNTEERS, AND THE TWO LEFTOVERS FROM PARITY-1 ───────────
  // 6a. A birthday is a month and a day; the year is optional, because most
  // people tell a charity the day and not their age (shared/birthday.js).
  // Month and day are set together or not at all, enforced here as well as by
  // the route, so an import cannot leave half a birthday behind.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS birth_month SMALLINT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS birth_day SMALLINT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS birth_year SMALLINT`);
  await pool.query(`DO $$ BEGIN
    ALTER TABLE donors ADD CONSTRAINT donors_birthday_whole CHECK (
      (birth_month IS NULL AND birth_day IS NULL AND birth_year IS NULL)
      OR (birth_month BETWEEN 1 AND 12 AND birth_day BETWEEN 1 AND 31
          AND (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100)));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_birthday ON donors (org_id, birth_month, birth_day) WHERE birth_month IS NOT NULL`);
  // DATES-1 · "About them": a short note read first on the profile (500 at most,
  // held by the route and here), not a timeline Note.
  // DATES-1 · "About them", yearly-date skips and journey batches (server/shared/dates1Schema.js).
  await require("../../shared/dates1Schema").dates1Schema(pool);
  await require("../../donors/deceasedSchema").deceasedSchema(pool);   // PEOPLE-1
  await require("../../donors/giftFundLines").giftFundLinesSchema(pool);   // GIFTS-2: a gift split across funds
  await require("../../reports/goalPledgesSchema").goalPledgesSchema(pool);   // GIFTS-2: a goal can count pledges

  // Part 4. A shift has a name, a colour, a venue and a place within it, and
  // is published or a draft (volunteers see only published shifts). Published
  // by default, so every shift made before this stays visible.
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS color TEXT`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS venue TEXT`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS location_detail TEXT`);
  await pool.query(`ALTER TABLE volunteer_slots ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE`);
  // A ROLE on a shift, with the number of people it needs. When a shift has
  // roles, capacity and the waiting list are decided per role, in the same
  // locked transaction as before (routes/volunteerScheduling.js signUp).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteer_slot_roles (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      slot_id TEXT NOT NULL REFERENCES volunteer_slots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      needed INTEGER NOT NULL CHECK (needed >= 0 AND needed <= 500),
      sort INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vol_slot_roles_slot ON volunteer_slot_roles (slot_id, sort)`);
// SPLIT-2 end
}

module.exports = { run: run6 };
