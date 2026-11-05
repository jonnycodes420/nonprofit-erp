// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 2 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { orgTime } = require("../pool");
const { query, run } = require("../query");

// `pool` here is the init session, as it was in runSchemaInit.
async function run2(pool) {
// SPLIT-2 db.js piece 43

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
    // BUILD-100 (grants) Part 1 — a grant's money joins the same discipline.
    ["grants", "amount"], ["grants", "received"],
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

  // PARITY-4 Part 2 · A GIFT STARTED AND NOT FINISHED. Written by Steward's own
  // giving forms only: when the three-step form passes its email step (a token
  // the page made), and when a Checkout session is created. Expired by
  // checkout.session.expired. Whether it FINISHED is never stored: it is read
  // from the gifts (a gift by the same email after it started), so a gift
  // that lands by any path closes it. Nothing here is a person record.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_starts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      start_token TEXT,
      checkout_session_id TEXT,
      giving_page_id TEXT,
      form_name TEXT,
      form_path TEXT,
      amount NUMERIC(12,2),
      frequency TEXT,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      expired_at TIMESTAMPTZ,
      noticed_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      note_sent_at TIMESTAMPTZ,
      note_sent_by TEXT,
      note_sent_by_name TEXT,
      created_by TEXT,
      created_by_name TEXT
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS gift_starts_token ON gift_starts (org_id, start_token) WHERE start_token IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS gift_starts_session ON gift_starts (checkout_session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS gift_starts_org ON gift_starts (org_id, started_at)`);

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
  // POLISH-4: the lapse rule reads a person's links on every row (shared/numbers/lapse.js LINKED).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_rel_a_only ON donor_relationships (donor_id_a)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_rel_b_only ON donor_relationships (donor_id_b)`);

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
  // INT-BUILD-1 0e — who made the fold, so only they or an admin can split it.
  await pool.query(`ALTER TABLE import_merges ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE import_merges ADD COLUMN IF NOT EXISTS created_by_name TEXT`);

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
  // Per-user morning-email switch and the org-level weekend toggle (default off:
  // no weekend mail). STAFF-MAIL-2 (Jonathan, 31 Oct 2026): a new person starts
  // with the morning email OFF until they turn it on. Only the column default
  // changes: a person added before this keeps NULL, which still reads as on, so
  // nobody already getting the email loses it.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_thread_nudge BOOLEAN`);
  await pool.query(`ALTER TABLE users ALTER COLUMN notify_thread_nudge SET DEFAULT false`);
  // STAFF-MAIL-2: the weekly email ("Your week", Monday 7 AM) is the one a new
  // person starts with. The column is ADDED with no default, so every person
  // who exists today gets NULL (off) and nobody's mail changes at deploy; the
  // default is set after, so only a row inserted from now on starts ON.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_weekly BOOLEAN`);
  await pool.query(`ALTER TABLE users ALTER COLUMN notify_weekly SET DEFAULT true`);
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
  // FIX-60: budgets_account_year_fund is superseded by
  // budgets_account_year_fund_basis, just below, and is no longer built.

  // ── FIX-60 — A BUDGET SAYS WHICH YEAR IT IS ───────────────────────────────
  // `year` alone could not say whether 2027 meant the calendar year or the
  // fiscal year ending in 2027. `basis` ('calendar' | 'fiscal') is written by
  // every new budget. It is NULLABLE and NOTHING is back-filled: no row is
  // rewritten at deploy. A NULL basis reads as 'calendar', which is what the
  // page that wrote every old row measured it against (it sent no basis, and
  // the server's default was the calendar). The one-slot rule gains the basis,
  // so a fiscal and a calendar budget for the same account can sit side by
  // side; the new index is built before the old one is dropped.
  await pool.query(`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS basis TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS budgets_account_year_fund_basis
                      ON budgets (org_id, account_id, year, COALESCE(fund_id, ''), COALESCE(basis, 'calendar'))`);
  await pool.query(`DROP INDEX IF EXISTS budgets_account_year_fund`).catch(() => {});

  // ── BUILD-88b B.1 — A FUND ANSWERS TO MORE THAN ONE NAME ──────────────────
  // A deposit slip's memo line says "Xenia", "Xenia UMC" or "for Xenia trip";
  // the fund is called "Xenia Mission Trip". The aliases are the org's own —
  // typed once, on the fund — because a memo that matches no fund is a question
  // for a human, and NEVER quietly General. A guessed designation is an audit
  // finding.
  await pool.query(`ALTER TABLE fin_funds ADD COLUMN IF NOT EXISTS aliases JSONB`);
  // POLISH-2: the name a donor reads in a thank-you ("the boat fund"), when
  // it differs from the bookkeeping name ("Harbor Skills Boat"). Null = none.
  await pool.query(`ALTER TABLE fin_funds ADD COLUMN IF NOT EXISTS public_name TEXT`);
  // The org's unrestricted DEFAULT, set deliberately. A blank memo goes here
  // only if somebody chose one; with nothing chosen a blank memo is Needs you,
  // because "we do not know" is not the same as "unrestricted".
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS default_fund_id TEXT`);

  // ── BUILD-88b B.1 — THE DEPOSIT, REVERSIBLE AS A WHOLE ────────────────────
  // A deposit is one act: a slip that footed. Undoing it is also one act, for
  // twenty-four hours, because a slip keyed wrong is discovered the same day
  // and unpicking eleven gifts by hand is how a total stops matching.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS import_id TEXT`);
  // NUMBERS-4: the gift's place in its import's file, so two gifts on one day
  // from one file have a "last" that never depends on a random id (lastGift.js).
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS import_row INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_import ON gifts (org_id, import_id) WHERE import_id IS NOT NULL`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS reversed_by TEXT`);
  // IMPORT-7: a big undo's progress and what it has removed so far (server/imports/routes.js)
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS undo_state JSONB`);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS import_id TEXT`);
  // SECURE-3: a synced email's body, sealed (server/mail/sealedMail.js). Schema only; rows are sealed by scripts/ops/seal-synced-mail.js.
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS body_sealed TEXT, ADD COLUMN IF NOT EXISTS body_key_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS created_import_id TEXT`);

  // ── TRANS-1 Part 0 — THE MOVE. The state of an organisation's migration
  // from the system it is leaving. It lives on `orgs` deliberately: one row
  // per org, and no new org-child table to join every suite's org-reset
  // DELETE list (the BUILD-58/80 gotcha). Each Move Report is the `imports`
  // row that produced it, so nothing here is a second copy of a total.
  //   migration_source        the preset key they came from ("donorperfect")
  //   migration_started_at    when they picked that tile, not when they signed
  //   migration_completed_at  when they pressed "We've moved"
  //   migration_undo_until    completed_at + 30 days; after that the button
  //                           has no undo, and the move is simply history
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_source TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_started_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_completed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_completed_by TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_completed_by_name TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS migration_undo_until TIMESTAMPTZ`);
  // The source each import came from, so a named import says where the file
  // was exported from and the Move Report knows which vendor to name.
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS migration_source TEXT`);
  // The totals the org typed in from the system they are leaving. Their own
  // claim about their own file: it gets its own column on the Move Report and
  // is never folded into the headline, so a number typed from memory cannot
  // make Steward say it matched something it did not.
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS old_system_gifts INTEGER`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS old_system_cents BIGINT`);

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
  // FIX-60: the lapse rule asks "does this person hold an open pledge" by donor id
  // (shared/numbers/lapse.js holdSql), once per person in a list. Schema only.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pledges_donor ON pledges (donor_id)`);
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
  // IMPORT-5: a pledge may have "No set due date" (she said so on import);
  // Steward never makes one up. Schema only: no row changes.
  await pool.query(`ALTER TABLE pledges ALTER COLUMN due_date DROP NOT NULL`);
  await pool.query(`ALTER TABLE pledge_installments ALTER COLUMN due_date DROP NOT NULL`);
  // A pledge that states a cadence but no schedule can generate one; a SHELL
  // pledge (BUILD-88a A.7, inferred from payments) states neither and says so.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS frequency TEXT`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS installment_count INTEGER`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS is_shell BOOLEAN DEFAULT false`);
  // FIX-48: a reminder refused for good is marked here once, with its reason,
  // and next_reminder_at goes NULL so the hourly sweep never picks it again.
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS reminder_failed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS reminder_error TEXT`);

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
  // `emails_enabled` is that lever, per org (Donor mail in super-admin).
  // FIX-53: it defaults FALSE, and so does Staff mail below. Every org starts
  // with both off however it was made, and only the super-admin toggle
  // (POST /admin/orgs/:id/mail-switches) turns either on. The boot backfill
  // that wrote TRUE over a NULL is gone, and no existing row is changed here.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS emails_enabled BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN emails_enabled SET DEFAULT false`);

  // What an org IS, rather than what it may do. A demo org is one whose data
  // is invented: a seed script's org, or one provisioned for a prospect who
  // has not signed in yet. Kept separate from emails_enabled deliberately —
  // "this org is fiction" is a fact that outlives any switch, and a human
  // turning mail back on for a demo org should have to say so explicitly
  // rather than have the distinction quietly erased.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS is_demo_org BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ALTER COLUMN is_demo_org SET DEFAULT false`);
  await pool.query(`UPDATE orgs SET is_demo_org = false WHERE is_demo_org IS NULL`);

  // FIX-48: THE THREE MAIL SWITCHES, per org, in super-admin. Donor mail is
  // emails_enabled above (the incident's lever, unchanged). Staff mail had no
  // switch of its own and followed emails_enabled, so `staff_mail_enabled`
  // NULL still means exactly that, and no org's mail changes on deploy; the
  // first time a super-admin sets it, it is its own switch. Billing mail never
  // read emails_enabled, so it starts ON. Sign-in mail has no switch: it always goes.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS staff_mail_enabled BOOLEAN`);
  // FIX-53: a new org's Staff mail is its own switch from birth, and it is off.
  // Existing NULLs keep following Donor mail; nothing here rewrites them.
  await pool.query(`ALTER TABLE orgs ALTER COLUMN staff_mail_enabled SET DEFAULT false`);
  // Who last set each switch, and when, for the admin console's label.
  // NULL means nobody has: "Off since created" (or, for an org older than
  // FIX-53 whose switch is on, on from before this was recorded).
  for (const k of ["staff_mail", "donor_mail"]) {
    await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ${k}_set_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ${k}_set_by TEXT`);
    await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ${k}_set_by_name TEXT`);
  }
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_mail_enabled BOOLEAN NOT NULL DEFAULT true`);

  // ── MAIL-1: ONBOARDED, AND THE ONBOARDING SEQUENCE OFF FOR GOOD ─────────
  // An org is onboarded once a committed import wrote at least one real
  // (non-sample) donor, or a super-admin marked it by hand. Until then Steward
  // sends it no staff or donor mail (mailPolicy.js). `onboarded_via` says
  // which: 'import:<id>' or 'super_admin'.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS onboarded_via TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS onboarded_by TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS onboarded_by_name TEXT`);
  // The backfill (onboarded.js) reads orgs.org_kind, so it runs below, after
  // ADMIN-CLEAN adds that column (FIX-51: on a fresh database it ran first and
  // logged "column o.org_kind does not exist").
  // The founder drip never sends again: stop every onboarding enrolment so a
  // dormant one cannot fire, whatever later changes.
  await pool.query(`
    UPDATE sequence_enrollments SET status = 'stopped'
     WHERE status = 'active' AND sequence_id IN (SELECT id FROM sequences WHERE trigger = 'onboarding')`).catch(() => {});
  await pool.query(`UPDATE sequences SET status = 'paused' WHERE trigger = 'onboarding' AND status = 'active'`).catch(() => {});
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

  // ── NAV-1 §4: per-user sidebar layout ─────────────────────────────────────
  // [{ id, visible }] as text; NULL = the canonical groups (navGroups.js), so
  // a group added next month reaches everybody instead of freezing today's
  // rail into a row. Per USER for the same reason home_layout is: two people
  // share an organisation and not a job, and a volunteer coordinator's rail is
  // not the finance manager's.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_layout TEXT`);

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
// SPLIT-2 end
}

module.exports = { run: run2 };
