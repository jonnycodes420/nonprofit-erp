// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 4 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { query, run } = require("../query");

// `pool` here is the init session, as it was in runSchemaInit.
async function run4(pool) {
// SPLIT-2 db.js piece 45

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
  // INT-PROD-1: true only on a row the S3-put catch wrote to Postgres, so the
  // /health fallback alarm counts failures, not the demo seed's own rows.
  await pool.query(`ALTER TABLE portal_assets ADD COLUMN IF NOT EXISTS s3_fallback BOOLEAN NOT NULL DEFAULT FALSE`);
  // SECURE-3: a synced email's attachment is stored sealed; the header holds its wrapped data key.
  await pool.query(`ALTER TABLE portal_assets ADD COLUMN IF NOT EXISTS sealed_header TEXT, ADD COLUMN IF NOT EXISTS sealed_key_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_assets_deleted ON portal_assets(deleted_at) WHERE deleted_at IS NOT NULL`);
  // FIX-20 Part 0: an asset is PRIVATE unless an admin placed it on a public
  // page. /portal-assets/:id serves a public one to anyone and a private one
  // only to a signed-in user of the owning org. The backfill runs once, when
  // the column first appears: every existing asset of a public-page kind (the
  // logo, the header, impact, widget, campaign, event, auction and volunteer
  // page images) was placed there by an admin, and nothing else ever was.
  {
    const had = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='portal_assets' AND column_name='is_public'`);
    await pool.query(`ALTER TABLE portal_assets ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE`);
    if (!had.rows.length) {
      await pool.query(`UPDATE portal_assets SET is_public = TRUE
        WHERE kind IN ('logo','header','impact','widget','campaign','event','auction','volpage')`);
    }
  }
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
  // IRS Pub 78 / BMF snapshot (loaded by scripts/ops/load-irs-ein-registry.js;
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

  // ── INT-3 — THE EMAIL TOOL THE ORGANISATION ALREADY PAYS FOR ──────────────
  // A separate table from `giving_sources` because this one carries no money:
  // it is a mailing list, and putting it in the giving table would make it one
  // more thing every money figure has to remember to exclude. It joins INT-1's
  // watching layer through `shared/connections.js` all the same, so there is
  // one card shape and one definition of quiet, not a second system.
  //
  // `server_prefix` is Mailchimp's data centre, learned from the OAuth
  // metadata endpoint after consent. `mapping` is the org's own choice of
  // which audience and which groups carry which tags, and NOTHING is pushed
  // until it is non-null: the first sync is opt-in by construction.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_marketing_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credentials_sealed TEXT,
      server_prefix TEXT,
      account_name TEXT,
      audience_id TEXT,
      audience_name TEXT,
      mapping JSONB,
      webhook_secret TEXT,
      token_expires_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      last_tried_at TIMESTAMPTZ,
      last_pushed_count INTEGER,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT emc_sealed_only CHECK (
        credentials_sealed IS NULL OR credentials_sealed LIKE 'v1.%'
      ),
      CONSTRAINT emc_status CHECK (status IN ('active','error','disconnected'))
    )`);
  // One live connection per provider per org, and a disconnected row keeps its
  // history so "this used to come in through Mailchimp" stays true.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS emc_one_live
                    ON email_marketing_connections (org_id, provider) WHERE status <> 'disconnected'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emc_org ON email_marketing_connections (org_id, status)`);
  // MAILCHIMP-1: what the last read changed, and the addresses the tool
  // refused on it. A refusal is a row on the card, never the connection's status.
  await pool.query(`ALTER TABLE email_marketing_connections ADD COLUMN IF NOT EXISTS last_updated_count INTEGER`);
  await pool.query(`ALTER TABLE email_marketing_connections ADD COLUMN IF NOT EXISTS last_refused JSONB`);

  // IMPORT-2: history import. Tasks and relationships carry the run that made
  // them so the run undoes in one step; "no phone calls" is its own flag.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_import ON interactions (org_id, import_id) WHERE import_id IS NOT NULL`);

  // The campaigns the org sent FROM THE TOOL. Steward did not send these and
  // must never be able to: there is no body column, no recipient list and no
  // send path anywhere near this table. Counts only, plus the id that opens
  // them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_marketing_campaigns (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      provider TEXT NOT NULL,
      provider_campaign_id TEXT NOT NULL,
      name TEXT,
      subject TEXT,
      sent_at TIMESTAMPTZ,
      sends INTEGER DEFAULT 0,
      opens INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      unsubscribes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS emc_campaign_once
                    ON email_marketing_campaigns (org_id, provider, provider_campaign_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emc_campaign_org ON email_marketing_campaigns (org_id, sent_at DESC)`);

  // ONE ROW PER PERSON PER CAMPAIGN, not one per event. A donor who opened and
  // clicked has read the appeal once; three rows would read as three things she
  // did and would put the same campaign on her timeline three times.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_marketing_activity (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      campaign_id TEXT NOT NULL REFERENCES email_marketing_campaigns(id) ON DELETE CASCADE,
      donor_id TEXT REFERENCES donors(id) ON DELETE CASCADE,
      email TEXT,
      opened BOOLEAN DEFAULT false,
      clicked BOOLEAN DEFAULT false,
      clicked_label TEXT,
      unsubscribed BOOLEAN DEFAULT false,
      occurred_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS emc_activity_once
                    ON email_marketing_activity (campaign_id, donor_id) WHERE donor_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emc_activity_donor ON email_marketing_activity (org_id, donor_id)`);

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
  // ── INT-1 · THE WEBHOOK HALF ──────────────────────────────────────────────
  // `provider_account_id` is the merchant id the provider stamps on its own
  // webhooks, and it is how an incoming event is attributed to an org. It is
  // never read off the payload as the org: the payload names a merchant, and
  // THIS column is what says which organisation that merchant is.
  //   `webhook_seen_at` / `webhook_pending` are the nudge. A webhook does not
  // write a gift — two writers of one gift is the class BUILD-23 exists to
  // prevent — it marks the source as having news, and the one sync path writes
  // it on the next pass.
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS provider_account_id TEXT`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS webhook_seen_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS webhook_pending BOOLEAN DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_giving_sources_provider_acct
                      ON giving_sources (provider, provider_account_id) WHERE provider_account_id IS NOT NULL`);
  // INT-1 · WATCHING. One incident per quiet or broken connection, not one per
  // sync: `quiet_notified_at` is what makes the admin email once rather than
  // every six hours, and it is cleared the moment money arrives again.
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS quiet_notified_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS quiet_incident TEXT`);

  // ── INT-POS · A SALE IS NOT A GIFT ────────────────────────────────────────
  // What the register sold, and what the organisation said each item IS. The
  // key is the item's own NAME, folded: a catalogue id changes when somebody
  // re-creates the item in Square, and the name is what the person mapping it
  // recognises. One row per item per source, set once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_item_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      source_id TEXT REFERENCES giving_sources(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_class TEXT NOT NULL,
      event_id TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT pos_item_class CHECK (item_class IN ('donation','event','other'))
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS pos_item_one_per_source
                      ON pos_item_mappings (org_id, COALESCE(source_id,''), item_key)`);

  // EVERY SALE THE REGISTER TOOK, whether or not any of it was a gift. This is
  // the table that makes "buys, has never given" answerable at all: a person
  // who spends $200 a year at the gala and has never made a donation is
  // invisible to a CRM that only stores gifts, and they are the single most
  // askable person in the file.
  //
  // `gift_cents` is the part that became gifts through recordGift and nothing
  // else; `event_cents` and `other_cents` are REVENUE and never reach a giving
  // total, a lifetime figure, Drift, LYBUNT or a receipt.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_sales (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      source_id TEXT REFERENCES giving_sources(id) ON DELETE SET NULL,
      external_id TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      person_id TEXT,
      match_by TEXT,
      needs_confirm BOOLEAN DEFAULT false,
      buyer_name TEXT, buyer_email TEXT, buyer_phone TEXT,
      location_name TEXT,
      event_id TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0,
      gift_cents INTEGER NOT NULL DEFAULT 0,
      event_cents INTEGER NOT NULL DEFAULT 0,
      other_cents INTEGER NOT NULL DEFAULT 0,
      unmapped_lines INTEGER NOT NULL DEFAULT 0,
      lines JSONB,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // The register's own id is the dedupe key, per org. A second read of the
  // same night writes nothing twice.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_external
                      ON pos_sales (org_id, external_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_sales_person ON pos_sales (org_id, person_id, occurred_on)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_sales_event ON pos_sales (org_id, event_id)`);


  // ── INT-2 · THE BOOKKEEPER NEVER RETYPES A GIFT ───────────────────────────
  // The connection to an accounting system, its mapping, and the one row per
  // payout that makes sending idempotent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookkeeping_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      vendor TEXT NOT NULL,                       -- quickbooks | xero
      status TEXT NOT NULL DEFAULT 'active',      -- active | error | disconnected
      realm_id TEXT,                              -- Intuit's company id / Xero's tenant id
      credentials_sealed TEXT,
      -- The mapping, saved as one document because it is edited as one screen
      -- and read as one object. Nothing is sent until it is present and
      -- complete, and "complete" is decided by shared/bookkeeping.js, not here.
      mapping JSONB,
      donor_names BOOLEAN NOT NULL DEFAULT false, -- OFF by default, deliberately
      last_sent_at TIMESTAMPTZ,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT bookkeeping_vendor CHECK (vendor IN ('quickbooks','xero')),
      CONSTRAINT bookkeeping_status CHECK (status IN ('active','error','disconnected')),
      CONSTRAINT bookkeeping_sealed_only CHECK (
        credentials_sealed IS NULL OR credentials_sealed LIKE 'v1.%'
      )
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookkeeping_one_live
                      ON bookkeeping_connections (org_id, vendor) WHERE status <> 'disconnected'`);

  // ── INT-OAUTH · THE HALF-FINISHED HANDSHAKE ───────────────────────────────
  // Between "start" and "callback" there are two things a multi-instance
  // deploy cannot keep in memory: the PKCE verifier, and the fact that THIS
  // state was issued by us a moment ago. A row, with an expiry, and it is
  // consumed on use so a replayed callback finds nothing.
  //
  // It holds no token. The verifier is worthless without the code, the row is
  // gone within minutes either way, and the tokens themselves are sealed onto
  // the connection row they belong to.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      code_verifier TEXT,
      redirect_uri TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states (expires_at)`);

  // The tokens live on the connection they belong to, sealed by
  // shared/secretBox.js with the ORG as the AAD, so a blob copied from one
  // tenant's row into another's fails to open rather than handing over
  // somebody else's books. `token_expires_at` is what the refresh reads.
  await pool.query(`ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS connected_by TEXT`);
  await pool.query(`ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS connected_by_name TEXT`);
  await pool.query(`ALTER TABLE giving_sources ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`);

  // ONE ROW PER PAYOUT, PER VENDOR, AND IT IS THE WHOLE SAFETY MODEL.
  // A daily send, a manual send and a retry after a timeout are three things
  // that happen to one payout on one afternoon. Two deposits for one payout
  // DOUBLES a nonprofit's recorded revenue in its own books, which is worse
  // than sending nothing.
  //
  // The row is claimed BEFORE the call (status 'sending') and kept afterwards
  // whatever happened, because a timeout means Steward does not know whether
  // the first call landed and only the vendor can answer that. The unique
  // index is the guarantee; the vendor's idempotency key is the second belt.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookkeeping_deposits (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      connection_id TEXT REFERENCES bookkeeping_connections(id) ON DELETE CASCADE,
      vendor TEXT NOT NULL,
      payout_id TEXT NOT NULL,
      source_key TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',     -- sending | sent | refused | failed
      vendor_deposit_id TEXT,
      net_cents INTEGER NOT NULL DEFAULT 0,
      deposit_on TEXT,
      lines JSONB,
      refusal TEXT,
      last_error TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookkeeping_one_per_payout
                      ON bookkeeping_deposits (org_id, vendor, payout_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookkeeping_deposits_month
                      ON bookkeeping_deposits (org_id, vendor, deposit_on)`);

  // ── PARITY-2 Part 5 · QUICKBOOKS ONLINE SYNC ──────────────────────────────
  // Two switches on the org. `qbo_sync_enabled` is the founder's: production
  // keys need Intuit's app assessment, and until it is passed the connection
  // is shown only where he turned it on. `qbo_auto_sync` is the org admin's:
  // off means nothing is sent until a person presses Sync.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS qbo_sync_enabled BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS qbo_auto_sync BOOLEAN NOT NULL DEFAULT false`);
  // CONNECT-2: the Xero admin's own auto-sync switch. Off until every fund is mapped.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS xero_auto_sync BOOLEAN NOT NULL DEFAULT false`);
  // A lease, not a lock that holds a connection: one sync run per org at a
  // time, so two people pressing Sync all cannot create the same donor as two
  // QuickBooks customers. A run that dies leaves a lease that lapses itself.
  await pool.query(`ALTER TABLE bookkeeping_connections ADD COLUMN IF NOT EXISTS sync_lock_until TIMESTAMPTZ`);
  // ONE ROW PER GIFT PER ACCOUNTING SYSTEM, and the unique index is the
  // guarantee that a gift becomes one sales receipt. The row is claimed
  // ('sending') BEFORE the call and kept afterwards whatever happened; a
  // failed row is retried with the SAME request id, so QuickBooks itself
  // answers a retry after a timeout with the receipt it already made.
  // Disconnecting deletes nothing here: this is the history of what was sent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_bookkeeping_syncs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      gift_id TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT 'quickbooks',
      connection_id TEXT,
      realm_id TEXT,
      status TEXT NOT NULL DEFAULT 'sending',     -- sending | synced | skipped | failed
      txn_type TEXT,                              -- SalesReceipt | Deposit
      qbo_id TEXT,
      request_id TEXT,
      account_id TEXT, class_id TEXT, customer_id TEXT,
      amount_cents INTEGER,
      error TEXT,                                 -- the plain sentence a person reads
      error_code TEXT,
      reached_vendor BOOLEAN NOT NULL DEFAULT false,
      attempts INTEGER NOT NULL DEFAULT 1,
      synced_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT gift_bk_sync_status CHECK (status IN ('sending','synced','skipped','failed'))
    )`);
  // FIX-20: ONE ROW PER GIFT PER COMPANY. The sent list belongs to a
  // QuickBooks company (realm_id), not to the org: a connection moved to a
  // different company has sent nothing there yet. A row written before the
  // company was part of the key takes its connection's company; one with no
  // company at all keeps '' and so never counts as sent to a real company.
  await pool.query(`UPDATE gift_bookkeeping_syncs s SET realm_id = c.realm_id
                      FROM bookkeeping_connections c
                     WHERE s.realm_id IS NULL AND c.id = s.connection_id AND c.org_id = s.org_id AND c.realm_id IS NOT NULL`);
  await pool.query(`UPDATE gift_bookkeeping_syncs SET realm_id = '' WHERE realm_id IS NULL`);
  await pool.query(`ALTER TABLE gift_bookkeeping_syncs ALTER COLUMN realm_id SET DEFAULT ''`);
  await pool.query(`ALTER TABLE gift_bookkeeping_syncs ALTER COLUMN realm_id SET NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS gift_bookkeeping_one_per_gift_company
                      ON gift_bookkeeping_syncs (org_id, gift_id, vendor, realm_id)`);
  await pool.query(`DROP INDEX IF EXISTS gift_bookkeeping_one_per_gift`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gift_bk_syncs_status
                      ON gift_bookkeeping_syncs (org_id, vendor, status)`);
  // The QuickBooks customer each donor became, per company file, so the same
  // person is matched once and never created twice.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookkeeping_customers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      vendor TEXT NOT NULL DEFAULT 'quickbooks',
      realm_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT,
      matched_by TEXT,                            -- email | name | created
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookkeeping_customers_one
                      ON bookkeeping_customers (org_id, vendor, realm_id, donor_id)`);

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
  // FIX-12 Part 5: user_admin_audit was merged into fin_audit_log (see the
  // FIX-12 block below the append-only trigger) and is no longer created.

  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS target_org_id TEXT`);
  // FIX-32: Checkout's success page signs her in. The key rides the
  // success_url once; only its sha256 is stored, and it is spent on first use.
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS signin_key_hash TEXT`);
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS signin_used_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_close_links_target_org
                    ON close_links (target_org_id) WHERE target_org_id IS NOT NULL`);

  // ── GTM-1a · PUBLIC SIGNUP RIDES THE CLOSE LINK ──────────────────────────
  // Signup reopened, and it did NOT get a second way to create an
  // organisation. A visitor who signs up mints a close link for themselves:
  // same table, same Stripe Checkout, same thirty-day trial, same webhook
  // provisioning, same seven-day reminder and same two-click cancel. The only
  // difference is who pressed the button, and that is what `signup_source`
  // records.
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS signup_source TEXT`);
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS estimated_donors INTEGER`);
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS billing_interval TEXT`);
  await pool.query(`ALTER TABLE close_links ADD COLUMN IF NOT EXISTS contact_name TEXT`);

  // ── GTM-1b 1 · GROWING PAST YOUR BAND IS A CONVERSATION, NOT A SURPRISE ──
  // Steward counts active donors after an import and compares the count to the
  // band the org is paying for. If they are over it, the admin is told in the
  // product and by email, the new price takes effect no sooner than THIRTY
  // DAYS later, and nothing about the subscription changes until Jonathan or
  // the org acts. A price that moves without a person is the thing this
  // exists to make impossible.
  //
  // Three columns rather than a table: there is one open notice per org at a
  // time, a second import that finds the same band is the same notice, and a
  // history of counts is not evidence of anything anyone needs.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_band TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_effective_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_count INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_dismissed_at TIMESTAMPTZ`);

  // ── PRICING-1 · RECORDS, TWO MONTHS RUNNING, AND THE OWNER'S YES ────────
  // One row per org per calendar month: the record count Steward measured and
  // whether it was over the band the org pays for. A note goes out only when
  // this month AND last month were over; one month over changes nothing.
  // The notice still lives in orgs.tier_notice_*; the owner's yes is
  // tier_notice_agreed_at, and without it the price never moves. A request to
  // move DOWN waits for renewal in band_down_to.
  await pool.query(`CREATE TABLE IF NOT EXISTS org_record_months (
    org_id TEXT NOT NULL, month TEXT NOT NULL, record_count INTEGER NOT NULL,
    band_id TEXT, over BOOLEAN NOT NULL DEFAULT false, measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, month))`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_agreed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier_notice_agreed_by TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS band_down_to TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS band_down_requested_at TIMESTAMPTZ`);
  // The setup fee: charged once, at signup, by Checkout. Recorded from the
  // completed session so Billing can say it was paid and a replayed webhook
  // can never make it look paid twice.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_fee_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_fee_paid_at TIMESTAMPTZ`);
  // Existing deals hold. An org with a custom price (CKRH at $149, a beta org
  // free until its date) is never measured against a band and never moved to
  // a band price automatically. Set by a super-admin only.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS custom_price_cents INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS custom_price_ends_on DATE`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS custom_price_note TEXT`);

  // ── GTM-1b 4 · A FOUNDING ORG KEEPS ITS $50, ON ANY BAND ────────────────
  // The discount used to be a PRICE (STRIPE_PRICE_FOUNDING, $199). A price
  // cannot follow an org that grows: the day a founding partner moved off it
  // they would lose the thing they were promised for ever. A Stripe COUPON
  // rides the subscription instead, so it survives every band change.
  //
  // Backfilled from the plan for the orgs already on the founding price, so
  // nobody has to be remembered by hand.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS founding_partner BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`UPDATE orgs SET founding_partner = true WHERE plan = 'founding' AND founding_partner = false`);

  // ── GTM-1a · WHO AGREED, WHEN, AND TO WHICH VERSION ──────────────────────
  // A click-through agreement that cannot say which words were on the screen
  // is not evidence of anything. Every row names the document VERSION and the
  // sha256 of the exact text that was served, so the agreement a customer
  // accepted can be reproduced years later even after the document changes.
  //
  // APPEND-ONLY. Nothing updates or deletes a row here; a new agreement is a
  // new row. `org_id` is null until Checkout completes and the webhook mints
  // the organisation, then it is filled in — the acceptance happens BEFORE the
  // org exists, which is the whole shape of a signup.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      close_link_id TEXT,
      email TEXT NOT NULL,
      name TEXT,
      doc_version TEXT NOT NULL,
      doc_sha256 TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip TEXT,
      user_agent TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_terms_acceptances_org
                    ON terms_acceptances (org_id, accepted_at DESC) WHERE org_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_terms_acceptances_link
                    ON terms_acceptances (close_link_id) WHERE close_link_id IS NOT NULL`);

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
  // CKRH-1 — the greeting's own SENTENCE and its ONE next step, both the org's
  // own words. `welcome_line` replaces the generic "This is yours…" paragraph
  // for an org that has something better to say to its own people; NULL keeps
  // the default, so no existing org's greeting changes. `welcome_next_step` is
  // a single instruction, never a list: a first run that opens with three
  // things to do is a to-do list, not a welcome.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS welcome_line TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS welcome_next_step TEXT`);
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
  // AGENTS-1 — WHICH OF THE SIX WROTE THIS. Nullable on purpose: NULL means the
  // general agent, which is what every instruction written before this build
  // was, and what an instruction arriving from a screen that does not offer the
  // choice still is. The registry (shared/agentPersonas.js) validates the value;
  // this column stores a word and constrains nothing, because a persona added
  // next year must not need a migration.
  await pool.query(`ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS persona TEXT`);

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
  // AGENT-3 · NO SILENT FALLBACKS. Every AI call that falls back to the
  // non-AI path leaves one row here (aiClient.recordAiFallback), so the
  // nightly real-AI run can count them. `reason` "ai_off" is the switch, not a
  // failure; anything else is.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_fallbacks (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      surface TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_fallbacks_org ON ai_fallbacks (org_id, created_at DESC)`);

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
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | skipped | sent | dismissed
      sent_at TIMESTAMPTZ, dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // EMAIL-1: an Agent draft remembers the template it started from.
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS template_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_drafts_org ON agent_drafts (org_id, status, created_at DESC)`);
  // ── FIX-6 item 1 · WHO LOOKED AT IT, AND WHAT THEY DECIDED ──────────────
  // The approval queue had no way to approve or skip anything, so a draft's
  // only states were the two Steward could put it in. `approved` is HER
  // saying the words are right; it is deliberately NOT `sent`, because Steward
  // does not send a drafted note and a status that said sent would be a claim
  // that it had left the building. These ALTERs sit below the CREATE they
  // alter (VOL-2 learned that the hard way on a fresh database).
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS reviewed_by TEXT`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS skip_reason TEXT`);
  // WIRE-1-ADDENDUM: a draft knows the gifts it thanks (approving it marks them
  // thanked), the thread it put on the person, and what it is for.
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS gift_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS thread_id TEXT`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS purpose TEXT`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS marked_gift_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE agent_drafts ADD COLUMN IF NOT EXISTS approved_line_id TEXT`);

  // ── FIX-12 Part 2 · STEWARD DRAFTS IT. YOU SEND IT. ─────────────────────
  // Workflow recipes used to email donors the moment they fired. Their words
  // now land in milestone_drafts, the queue in Communications where a person
  // reviews, edits and sends each one. `source` says which recipe wrote it;
  // `reviewed_at` is the person saying the words are right, which is what
  // "Send all reviewed" sends and nothing else.
  // FIX-12 Part 7a — the optional morning email of today's meetings. OFF by
  // default: a new email nobody asked for is the thing this column prevents.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_meeting_brief BOOLEAN DEFAULT false`);
  // STAFF-MAIL-1 (Jonathan, 30 Oct 2026) — THE MORNING EMAIL IS THE ONLY STAFF
  // EMAIL THAT SENDS UNASKED. Every other staff email is a switch the person
  // turns on (routes/email.js userWantsEmail), so their columns default false,
  // and the morning email gets the person's own sections, hour and days.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_week_in_review BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_monthly_report BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_connection_alerts BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS brief_sections JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS brief_hour SMALLINT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS brief_days TEXT`);
  await pool.query(`ALTER TABLE users ALTER COLUMN notify_portfolio_gifts SET DEFAULT false`);
  await pool.query(`ALTER TABLE users ALTER COLUMN notify_task_assignments SET DEFAULT false`);
  await pool.query(`ALTER TABLE users ALTER COLUMN notify_step_reminder SET DEFAULT false`);
// SPLIT-2 end
}

module.exports = { run: run4 };
