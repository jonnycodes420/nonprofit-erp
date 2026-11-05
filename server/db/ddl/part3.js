// SPLIT-2: moved VERBATIM from db.js (runSchemaInit, part 3 of 7; schema.js runs the parts in order). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { query, run } = require("../query");

// `pool` here is the init session, as it was in runSchemaInit.
async function run3(pool) {
// SPLIT-2 db.js piece 44
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
      -- [{ type, label, offsetDays }], validated by shared/planShape.js before
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
  // ONE ACTIVE PLAN PER PERSON PER JOURNEY. JOURNEYS-3: a person may be in
  // several journeys at once (their steps are spaced a week apart and take the
  // donor's one open thread in turn, soonest first), but never in the same
  // journey twice. The old one-per-person index is dropped below.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cultivation_plans_one_active_per_journey
                    ON cultivation_plans (org_id, donor_id, (COALESCE(template_id, ''))) WHERE status = 'active'`);
  await pool.query(`DROP INDEX IF EXISTS cultivation_plans_one_active`);
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

  // ── THREAD-2a · A JOURNEY IS A PLAN WITH A TRIGGER ──────────────────────
  // No parallel system, and no new tables: a journey IS a cultivation
  // template, and a donor in one IS a cultivation plan. These columns are the
  // only two things a journey has that a plan does not — the event that
  // starts it, and which one wins when a donor qualifies for two. Every
  // existing template reads as a by-hand plan with the default priority,
  // which is exactly what it was, so nothing that already works changes.
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS trigger_key TEXT`);
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS trigger_amount_cents INTEGER`);
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50`);
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS preset_key TEXT`);
  // Off by default: a template somebody built by hand before journeys existed
  // must not start firing at people because a column appeared.
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS journey_enabled BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_templates_trigger
                    ON cultivation_templates (org_id, trigger_key, priority DESC)
                    WHERE journey_enabled = true AND archived_at IS NULL`);
  // ── FIX-5 · A JOURNEY AN ORG WROTE ITSELF ────────────────────────────────
  // Two more columns and no new table. `description` is the one line under the
  // name in the list, which is what makes a shelf of five self-written journeys
  // readable. `audience` is the trigger's CONDITIONS stored WITH the journey:
  // until now the audience filters existed only inside the apply dialog, so
  // "volunteers who gave over $500" was something you re-picked every time
  // instead of something the journey knew about itself.
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE cultivation_templates ADD COLUMN IF NOT EXISTS audience JSONB NOT NULL DEFAULT '{}'::jsonb`);

  // WHY THIS DONOR IS IN THIS JOURNEY, AND WHAT IT REPLACED. A donor moved
  // from one journey to another by a rule, with no record of why, is a person
  // whose stewardship silently changed. `replaced_reason` is the sentence
  // shown in the timeline, written by shared/journeyShape.js so the stored
  // reason and the displayed one are one string.
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS trigger_key TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS replaced_plan_id TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS replaced_reason TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50`);

  // A step may carry a DRAFT — words Steward writes for her to read. It is
  // not a send and it never becomes one; the step is still a thread that
  // closes on a logged human action. tests/thread2a-no-send.test.js guards it.
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS draft_kind TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS owner_id TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS owner_name TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS skip_reason TEXT`);
  await pool.query(`ALTER TABLE cultivation_plan_steps ADD COLUMN IF NOT EXISTS done_note TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cult_steps_due
                    ON cultivation_plan_steps (org_id, status, due_date)
                    WHERE status IN ('pending','open')`);

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
  // BUILD-102 (Steward Give) Part 1 — WHAT THE DONOR IS OFFERED, beside the
  // widgets that surround it. A form is a giving page with a form config; there
  // is deliberately NO `forms` table, because a second table would be two ways to
  // reach one Stripe account and two answers to "which form took this gift".
  // NULL means "never configured", which renders the defaults — so every giving
  // page that already exists is a working form the moment this ships, and
  // `shared/formConfig.js` is the one validator that decides what may be in here.
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS form_config JSONB`).catch(() => {});
  // BUILD-102 Part 2 — the upsell threshold is the ORG's, because what counts as
  // a gift worth asking about differs by an order of magnitude between a food
  // pantry and a university. Default $100 (10000 cents); the monthly suggestion
  // is a third of the gift rounded to a whole dollar, which is arithmetic rather
  // than a setting and lives in shared/formConfig.js.
  await run(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS form_upsell_threshold_cents INTEGER`).catch(() => {});
  // BUILD-102 Part 5 — WHICH EMAIL BROUGHT THIS GIFT IN. The three UTM parameters
  // every mail tool and ad platform already writes, captured on the page, carried
  // through Checkout metadata and stored on the GIFT — so the question is answered
  // by the report builder over the gifts entity rather than by a separate
  // analytics product nobody reconciles against the money.
  //
  // Three columns rather than one JSONB, because these are the three a report
  // GROUPS BY, and grouping by a JSON key is how a figure stops being checkable.
  // TEXT and kept as the sender wrote them: a campaign name is the marketer's own
  // string and normalising it would silently merge two campaigns.
  await run(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS utm_source TEXT`).catch(() => {});
  await run(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS utm_medium TEXT`).catch(() => {});
  await run(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS utm_campaign TEXT`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_utm ON gifts (org_id, utm_source)`).catch(() => {});

  // ── BUILD-102 (Steward Give) Part 6 — THE FUNNEL, COUNTED AND NOT TRACKED ──
  // Views, starts and completions per form per day, and NOTHING about who. There
  // is no person id, no session id, no IP, no user agent and no cookie id in this
  // table — by design, and the shape is the guarantee rather than a promise in a
  // policy: there is nowhere to put one.
  //
  // COUNTED PER DAY, not per event, so the table stays small at scale and cannot
  // become a behavioural log by accident. A form with ten thousand views a day is
  // one row, and "who looked at this" is a question its own schema cannot answer.
  //
  // `variant` is BUILD-102 Part 6's A/B: NULL for a form with no test running, "a"
  // or "b" while one is. The same three counts per variant, from the same rows, so
  // the A/B is a lens on the funnel rather than a second measurement system.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_events (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      form_id TEXT REFERENCES giving_pages(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      variant TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      starts INTEGER NOT NULL DEFAULT 0,
      completions INTEGER NOT NULL DEFAULT 0,
      completed_cents BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // ONE ROW PER FORM PER DAY PER VARIANT is the whole storage contract, and the
  // unique index is what makes every counter an atomic upsert rather than a
  // read-modify-write that loses counts under concurrency.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS form_events_one_per_day
                      ON form_events (form_id, day, COALESCE(variant,''))`).catch(e =>
    console.error("[forms] form_events_one_per_day:", e.message));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_form_events_org ON form_events (org_id, day)`);

  // BUILD-102 Part 6 — the A/B, on the giving page's own row. Two variants of ONE
  // form differing in the suggested amounts or the headline only: a test that can
  // change the designation or the questions is not an A/B, it is two forms with one
  // set of numbers.
  await run(`ALTER TABLE giving_pages ADD COLUMN IF NOT EXISTS ab_test JSONB`).catch(() => {});
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

  // ── BUILD-100 (grants) Part 1 — A FUNDER IS A RECORD, NOT A STRING ────────
  // `grants.funder` has been free TEXT since the original schema, so "Sunrise
  // Foundation", "The Sunrise Foundation" and "Sunrise Fdn" were three funders
  // that could never be counted together, and none of them had a program
  // officer, an address or a giving history. BUILD-80 already settled what an
  // institution is — a `donors` row with `kind='organisation'` — and a funder is
  // one of those. So the grant points AT that record.
  //
  // `funder` (the text) STAYS and is kept in step, for the same reason
  // `opportunities` kept its name in BUILD-99: every existing read, report and
  // Kanban card uses it, and rewriting twenty call sites to chase a join is how
  // one of them gets missed. The text is the label; the id is the truth.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS funder_donor_id TEXT REFERENCES donors(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grants_org_funder ON grants (org_id, funder_donor_id)`);

  // WHAT KIND OF FUNDER IT IS lives on the FUNDER, not on the grant — the
  // Sunrise Foundation is a private foundation across every grant it ever makes,
  // and storing it per grant would let two rows disagree about one organisation.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_type TEXT`);
  // BUILD-100 (grants) Part 6 — A FUNDER'S EIN IS THE ONLY IDENTIFIER IN THIS
  // DOMAIN THAT IS ACTUALLY UNIQUE, and an imported grant spreadsheet often
  // carries it. Nine digits, no punctuation, stored only for an ORGANISATION.
  // The partial unique index is what makes "match on EIN" a fact rather than a
  // hope — two records claiming one EIN in one org is a duplicate to merge, not
  // a state to reconcile at read time.
  //
  // NB the repo-wide rule from FIX-legal-entity stands: an EIN is not public
  // and none is written down in this repository. This column holds a customer's
  // own data, entered by a customer.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_ein TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS donors_one_funder_ein
                      ON donors (org_id, funder_ein)
                    WHERE funder_ein IS NOT NULL AND deleted_at IS NULL`).catch(e =>
    console.error("[grants] donors_one_funder_ein:", e.message));

  // BUILD-100 (grants) Part 6 — the source's OWN record id, when the file
  // carried one. It is what makes importing the same export twice add nothing,
  // and the partial unique index is what makes that a guarantee rather than a
  // check-then-insert that loses a race.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grants_one_external_id
                      ON grants (org_id, external_id) WHERE external_id IS NOT NULL`).catch(e =>
    console.error("[grants] grants_one_external_id:", e.message));

  // The request, the award, and where the money is allowed to go.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS amount_requested NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS amount_awarded NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS restriction TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS restricted_from TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS restricted_until TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS fund_id TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS cycle_name TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS officer_id TEXT`);
  // The award IS a pledge from the funder (88b's path), and this is the link
  // back to it, so "what did they actually commit to" is one row away.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS award_pledge_id TEXT`);
  // A no, with its reason and whether to try again — the same discipline
  // BUILD-99 gave a declined proposal.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS decline_reason TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS declined_on TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS reapply BOOLEAN`);

  // ── BUILD-100 (grants) Part 2 — DEADLINES THAT COME AND FIND YOU ─────────
  // A milestone is a dated thing owed on a grant. It is its own table rather
  // than more columns because `report_due` REPEATS (a two-year grant reports
  // twice) and a repeating thing cannot be a column.
  //
  // `thread_id` is the link to the BUILD-81 thread that carries it, and
  // `state` is what the screen reads. The state `waiting` is the honest
  // middle: `threads_one_open` allows exactly one open thread per donor, and
  // a funder with three grants can have three milestones inside their lead
  // windows at once, so the second WAITS and the next close advances it
  // (BUILD-99's cultivation-plan answer to the same index).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_milestones (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      due_date TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      thread_id TEXT,
      raised_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      completed_by_name TEXT,
      notes TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_ms_org_due ON grant_milestones (org_id, due_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_ms_grant ON grant_milestones (grant_id)`);
  // A milestone that is not repeatable exists at most ONCE per grant per kind.
  // `report_due` is deliberately absent from the index's reach because the
  // index keys on (grant, kind, due_date) — two reports on different dates are
  // two milestones, two reports on the SAME date are one thing typed twice.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grant_ms_one_per_date
                      ON grant_milestones (grant_id, kind, due_date)`);
  // FIX-28: a custom deadline is named by whoever adds it.
  await pool.query(`ALTER TABLE grant_milestones ADD COLUMN IF NOT EXISTS label TEXT`);

  // ── BUILD-100 (grants) Part 3 — THE FILES A GRANT CARRIES ────────────────
  // One row per file, pointing at the BUILD-51 asset store by bare asset id
  // (the donor-photo shape, because these are served through their own signed
  // front door rather than as a public /portal-assets path).
  //
  // `asset_id` is in `collectLiveAssetRefs`, WITHOUT WHICH the 90-day
  // retention sweep would destroy a signed funder agreement. That line is
  // load-bearing, not belt-and-braces.
  //
  // NOT versioned by a column: two proposals are two rows and the version is
  // DERIVED from upload order (grantDocs.withVersions). A version column is a
  // number somebody has to keep in step, and this one has no reason to be.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_documents (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT,
      bytes INTEGER,
      notes TEXT,
      uploaded_by TEXT,
      uploaded_by_name TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_docs_grant ON grant_documents (grant_id, uploaded_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_docs_org ON grant_documents (org_id)`);
  // The SAME bytes filed twice under one type on one grant is a double-click,
  // not two documents. Different types (a PDF that is both the proposal and
  // the agreement) stay two rows, because that is a real thing.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grant_docs_one_per_type
                      ON grant_documents (grant_id, doc_type, asset_id)`);

  // ── BUILD-100 (grants) Part 4 — SPENDING AGAINST A RESTRICTED AWARD ──────
  // Entered BY HAND in this build. QuickBooks spend against a grant waits on
  // 91f and the Intuit keys (the brief's own line), and the screen says so
  // rather than implying a bank feed nobody connected.
  //
  // Amount is NUMERIC(12,2) like every other money column in this product, and
  // every figure derived from it is summed in integer cents — a restricted
  // balance is what an auditor reconciles.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_spend (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      spent_on TEXT NOT NULL,
      description TEXT NOT NULL,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_spend_grant ON grant_spend (grant_id, spent_on)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_spend_org ON grant_spend (org_id)`);

  // THE ORG'S OWN LEAD TIMES, one JSONB rather than five columns: the set is
  // fixed by shared/grantMilestones.js and always read whole. NULL means
  // "nobody has chosen", which is what makes the defaults still reachable if
  // they ever change.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS grant_lead_days JSONB`);

  // ── GRANTS-1 · GRANTS AS ITS OWN SYSTEM ──────────────────────────────────
  // The funder is a row in `donors` (one person record); these columns are
  // what a grants office knows about it. Program officers and other funder
  // contacts are people rows linked by donor_relationships
  // (relationship_type 'program_officer' or 'funder_contact', donor_id_a =
  // the funder, donor_id_b = the person).
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_interests TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_award_min NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_award_max NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_cycle TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_due_months INTEGER[]`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS funder_notes TEXT`);
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  // A grant's outcomes to report, the grant it renews, and the org's goal.
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS outcomes TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS renewal_of TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS closed_on TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS grant_goal_cents BIGINT`);
  // A grant's checklist is ordinary tasks with a grant_id, so each one has an
  // owner, a due date and its place on the Calendar like every other task.
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS grant_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_grant ON tasks (org_id, grant_id) WHERE grant_id IS NOT NULL`);
  // Where a grant document came from: typed in, or an attachment on an email
  // that went to (or came from) a funder contact.
  await pool.query(`ALTER TABLE grant_documents ADD COLUMN IF NOT EXISTS source TEXT`);
  await pool.query(`ALTER TABLE grant_documents ADD COLUMN IF NOT EXISTS sent_on TEXT`);
  await pool.query(`ALTER TABLE grant_documents ADD COLUMN IF NOT EXISTS sent_to_name TEXT`);
  await pool.query(`ALTER TABLE grant_documents ADD COLUMN IF NOT EXISTS sent_to_email TEXT`);
  await pool.query(`ALTER TABLE grant_documents ADD COLUMN IF NOT EXISTS message_id TEXT`);
  // The shared library of reusable pieces, each edit kept as a version.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_library (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_library_org ON grant_library (org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_library_versions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      piece_id TEXT REFERENCES grant_library(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT, body TEXT NOT NULL DEFAULT '',
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (piece_id, version)
    )`);
  // A grant's reports: what is due, when, what the funder asked for, the
  // draft, and once submitted the kept record of what went to whom.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_reports (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      milestone_id TEXT,
      title TEXT NOT NULL,
      due_date TEXT,
      asked_for TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      figures JSONB,
      version INTEGER NOT NULL DEFAULT 1,
      started_from TEXT,
      submitted_on TEXT,
      submitted_to_name TEXT,
      submitted_to_email TEXT,
      submitted_by TEXT, submitted_by_name TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_reports_grant ON grant_reports (org_id, grant_id)`);
  // What went to which funder, when, and to whom: a document, a library
  // piece at a version, a report, or an email. Read for "which version went
  // where" and for each funder's history.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_sends (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      funder_donor_id TEXT,
      what TEXT NOT NULL,
      document_id TEXT,
      library_piece_id TEXT,
      library_version INTEGER,
      report_id TEXT,
      subject TEXT,
      sent_on TEXT NOT NULL,
      sent_to_name TEXT,
      sent_to_email TEXT,
      direction TEXT NOT NULL DEFAULT 'out',
      source TEXT NOT NULL DEFAULT 'manual',
      message_id TEXT,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_sends_grant ON grant_sends (org_id, grant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_sends_funder ON grant_sends (org_id, funder_donor_id)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_sends_message ON grant_sends (org_id, grant_id, message_id) WHERE message_id IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_docs_message ON grant_documents (grant_id, message_id, file_name) WHERE message_id IS NOT NULL`);

  // ── SHEETS-1 · OLD SPREADSHEETS, KEPT ────────────────────────────────────
  // A spreadsheet somebody brought in: an old grant tracker (its grants went
  // into the pipeline) or a board report (its table is kept as it was). The
  // original file is in the asset store (asset_id, listed in
  // collectLiveAssetRefs), and every column Steward could not place is kept
  // here with its values, line by line, rather than dropped.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stored_sheets (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      period_label TEXT,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      asset_id TEXT,
      sheet_name TEXT,
      headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      unplaced JSONB NOT NULL DEFAULT '{}'::jsonb,
      grant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      removed_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stored_sheets_org ON stored_sheets (org_id, kind)`);

  // ── REPORTS-5 · OLD REPORTS, KEPT AND READ ───────────────────────────────
  // An old system's report is a stored sheet of kind 'old_report' (the file
  // itself, always kept), with what Steward guessed and the person confirmed:
  // the kind of report, the system it came from, the period it covers, and
  // whether its pages had text at all (a scan does not). One import is one
  // BATCH, so the whole import, files and totals, undoes in one step.
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS batch_id TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS report_kind TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS source_system TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS period_from TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS period_to TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS guess_why TEXT`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS scanned BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS page_count INTEGER`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS old_report_batches (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      undone_at TIMESTAMPTZ,
      undone_by TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // A HISTORICAL TOTAL is a number an old system printed for a period: never a
  // gift, never a person, and never added into Steward's own figures. It sits
  // beside them, and every screen that shows one says where it came from.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historical_totals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      batch_id TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      report_kind TEXT NOT NULL,
      counts_as_giving BOOLEAN NOT NULL DEFAULT false,
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      label TEXT,
      amount NUMERIC(14,2) NOT NULL,
      gift_count INTEGER,
      donor_count INTEGER,
      source_system TEXT,
      file_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_historical_totals_org ON historical_totals (org_id, period_from, period_to)`);

  // ── RECONCILE-1 · AN OLD REPORT, CHECKED AGAINST STEWARD ─────────────────
  // The mapping a file was pulled in with, so the check reads the same columns.
  await pool.query(`ALTER TABLE stored_sheets ADD COLUMN IF NOT EXISTS mapping JSONB`);
  // The latest check of one imported report against Steward's own figures
  // (reconcile.js): what matched, what differed and why. Re-run on import, on
  // a fix and whenever gifts change; one row per report, replaced each time.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS old_report_checks (
      sheet_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      result JSONB NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL, created_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_old_report_checks_org ON old_report_checks (org_id)`);
  // A fund or campaign name on an old report, mapped by a person to one of
  // the org's own funds. Only the check reads it; no gift moves.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS old_report_fund_maps (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      label_key TEXT NOT NULL,
      label TEXT NOT NULL,
      fund_id TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, label_key)
    )`);
  // "Use as last year's total": the one old report a person chose to stand
  // for a period when Steward has no gifts in it. Set only by a click.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS old_report_baselines (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, period_from, period_to)
    )`);

  // ── ONBOARD-1 · SET UP STEWARD FOR ME (schema lives beside its module) ────
  await require("../../../setup").ensureSchema(pool);

  // ── CAPTURE-1 · NOBODY TYPES A GIFT ──────────────────────────────────────
  // A check photo, a pledge form, a DAF letter: each becomes ONE card waiting
  // in "To confirm". A card PROPOSES; money is recorded only by a person's
  // confirm, through recordGift. `read` holds what Steward read and never a
  // routing or account number (capture.js scrubBank, asserted by the test).
  // A low-stakes card (an address change) is applied at once and keeps what it
  // replaced in `applied`, undoable for 30 days.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capture_items (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      kind TEXT NOT NULL,
      stakes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      source TEXT NOT NULL,
      batch_id TEXT,
      asset_id TEXT,
      content_type TEXT, file_name TEXT, page INTEGER,
      received_at TIMESTAMPTZ,
      read JSONB, proposal JSONB,
      ai TEXT, headline TEXT, sentence TEXT,
      gift_id TEXT, pledge_id TEXT, donor_id TEXT,
      skip_reason TEXT,
      applied JSONB, undo_until TIMESTAMPTZ,
      source_ref TEXT,
      decided_at TIMESTAMPTZ, decided_by TEXT, decided_by_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_capture_items_org ON capture_items (org_id, status)`);
  // One email attachment makes at most one set of cards, however often the mailbox is read.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_capture_items_ref ON capture_items (org_id, source_ref, page) WHERE source_ref IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capture_batches (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      slip_asset_id TEXT,
      slip_cents BIGINT,
      checks_cents BIGINT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  // What this org taught Steward: a memo phrase confirmed into a fund.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capture_fund_words (
      org_id TEXT NOT NULL REFERENCES orgs(id),
      phrase TEXT NOT NULL,
      fund_id TEXT NOT NULL,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (org_id, phrase)
    )`);
  // VOICE-1 · Tell Steward. One row per memo: the words as filed (a sensitive
  // sentence is held back from them), the people it is about, the runs that
  // did its work (each write is on agent_writes, so Undo is one loop), and the
  // cards waiting for her yes. No audio column: audio is never stored.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_memos (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'typed',
      status TEXT NOT NULL DEFAULT 'done',
      ai TEXT NOT NULL DEFAULT 'on',
      donor_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      read JSONB,
      cards JSONB NOT NULL DEFAULT '[]'::jsonb,
      instruction_id TEXT,
      run_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      undone_at TIMESTAMPTZ, undone_by TEXT, undone_by_name TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_voice_memos_org ON voice_memos (org_id, created_at DESC)`);
  // AGENT-5 · ATLAS'S ACTIVITY LOG. One row per thing Atlas did or readied:
  // who (actor and the person it was for), what (line, kind, state), where
  // (place, place_id, link) and Undo (run_id or card_id). The page notes, the
  // header bell and Recent changes read only this table. `waits` is what
  // waits on a person, and is the bell's count.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atlas_actions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      request_id TEXT,
      card_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      line TEXT NOT NULL,
      donor_id TEXT,
      place TEXT,
      place_id TEXT,
      link JSONB,
      waits BOOLEAN NOT NULL DEFAULT false,
      undoable BOOLEAN NOT NULL DEFAULT false,
      actor_id TEXT NOT NULL,
      actor_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      seen_at TIMESTAMPTZ, undone_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atlas_actions_org ON atlas_actions (org_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atlas_actions_place ON atlas_actions (org_id, place, place_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_atlas_actions_request ON atlas_actions (request_id)`);
  // VOICE-3: meeting mode is gone, and so is every transcript it saved.
  // There is no screen left to read or delete one, so none is kept.
  await pool.query(`DROP TABLE IF EXISTS voice_meetings`);
  // The gift-to-thanked clock. received_at: the check's date or the email's
  // arrival, whichever is later and not in the future (a live door: when it
  // came in). thanked_at: a thank-you sent, a thank-you call, or a note marked
  // thanked. A receipt is not a thank-you, so acknowledgement_sent_at (which a
  // receipt also sets) is not this clock.
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS thanked_at TIMESTAMPTZ`);
  // The major-gift line: a confirmed gift at or above it also puts a call on the Thread for today.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS major_gift_line_cents INTEGER DEFAULT 100000`);

  // ── EMAIL-1 · ONE EDITOR FOR PAGES AND EMAILS ────────────────────────────
  // The media library: every photo and video an org can put on a page or in
  // an email. A photo points at a JPEG in the asset store (inboxes such as
  // Outlook do not show WebP) and must carry alt text; a video is a YouTube
  // or Vimeo id, shown in email as its thumbnail linking to its page.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      alt TEXT NOT NULL DEFAULT '',
      asset_id TEXT,
      width INTEGER, height INTEGER,
      provider TEXT, video_id TEXT,
      thumb_asset_id TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      removed_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_items_org ON media_items (org_id, kind)`);
  // An email template: the same widget blocks a page uses (shared/pageWidgets.js,
  // surface "email"), a subject and a preheader. The brand is NOT stored here:
  // it is read from portal_settings at render time, so one colour change
  // reaches every page and every email.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      starter_key TEXT,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'appeal',
      subject TEXT NOT NULL DEFAULT '',
      preheader TEXT NOT NULL DEFAULT '',
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      archived_at TIMESTAMPTZ,
      created_by TEXT, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates (org_id)`);
  // Where a template is used: a campaign keeps its blocks (rendered for each
  // person at send), and a sequence step, a review draft and an Agent draft
  // remember the template they started from.
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_id TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_blocks JSONB`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS preheader TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by TEXT`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by_name TEXT`);
  await pool.query(`ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS template_id TEXT`);
  await pool.query(`ALTER TABLE milestone_drafts ADD COLUMN IF NOT EXISTS template_id TEXT`);
  // FIX-39 · A TEMPLATE IN USE CHANGES IN TWO STEPS. Saving one that a live
  // journey reads keeps the new words here; Publish moves them into the live
  // columns above, which are the only ones a draft or a send ever reads.
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS draft JSONB`);
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS draft_saved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS draft_by_name TEXT`);

  // ONE BACKFILL, applied once: `amount_requested` is what `amount` has always
  // meant on a grant that has not been awarded, and on an awarded one it is what
  // was asked for. Never guessed — a row with no amount stays null.
  await pool.query(`UPDATE grants SET amount_requested = amount
                     WHERE amount_requested IS NULL AND amount IS NOT NULL AND amount > 0`);
  await pool.query(`UPDATE grants SET amount_awarded = amount
                     WHERE amount_awarded IS NULL AND status = 'awarded' AND amount IS NOT NULL AND amount > 0`);
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
// SPLIT-2 end
}

module.exports = { run: run3 };
