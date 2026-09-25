# Money and gifts

Read this when you touch gifts, `recordGift`, funds and methods, attribution, campaigns, the finance ledger, soft credits, tributes, matching gifts, deposits, cheques, pledges, giving sources, fees or refunds.

## Rules
- **Write every gift through `recordGift`, from every door.** Extras (soft credits, tributes, quid pro quo,
  instalment matching, membership renewal) live inside it and are checked before the insert
  (`checkGiftExtras`), so a second INSERT silently skips them all. (BUILD-88a, BUILD-98)
- **A gift row always carries a fund and a payment method; the timeline entry links to it.** The
  interaction points at `interactions.gift_id` and holds no copy of the amount. (BUILD-88a)
- **Every gift stamps `fin_transactions` exactly once.** Set `gift_id` and use `ON CONFLICT (gift_id)
  WHERE gift_id IS NOT NULL DO NOTHING`; `uq_fin_txns_gift` enforces it. Never add a second client call. (BUILD-21)
- **Deleting or fully refunding a gift reverses everything in one transaction.** Ledger stamp deleted,
  fulfilled pledge reopened, donor totals recomputed (never decremented). (BUILD-33, FIX attribution)
- **Imported history never stamps the ledger or raises work; only a current-period gift posts.** The
  first read of a giving source is history too (`backfilled_at`). Finance explains the gap
  (`hasUnledgeredGiving`), never a bare $0. (BUILD-26, BUILD-89S)
- **Money from a person, foundation or grant enters through the gift or grant paths.** Finance's manual
  money-in is for non-donor revenue; the form routes a recognised donor or open grant to its flow. (FIX entity-routing)
- **A grant award books the ledger at most once and never creates a gift.** `stampGrantAward` +
  `uq_fin_txns_grant`; un-award deletes the auto stamp and unlinks (never deletes) an adopted manual row. (FIX entity-routing)
- **Count a gift once, on the person whose money it was.** Soft credit is a row pointing at a gift
  (`gift_soft_credits`); no total, ledger or bookkeeper export reads it; reports add it only via `?credit=soft`. (BUILD-98)
- **A matching gift is a pledge on the employer's record, never money.** `pledges.is_match`; excluded
  from late-pledge threads and reminders, because Steward never chases a company. (BUILD-98)
- **A tribute honouree is a record when one exists, otherwise a name.** Imports never invent a record
  for a memorial; the notice module is handed no amount and Steward never sends it. (BUILD-98)
- **Nothing on the deposit sheet is placed by guess.** Four states; an unmatched memo never becomes
  General; a blank memo takes `orgs.default_fund_id` only if someone chose one. (BUILD-88b)
- **The deposit gate is on the server.** `/deposits/plan` writes nothing; `/deposits/commit` re-plans
  and writes from `plan.lines`, never the client's copy; key attachments by line number. (BUILD-88b, BUILD-95)
- **A cheque read proposes and cannot post; a cheque photo never costs the deposit.** Only box and line
  amounts agreeing to the cent fill an amount; a failed photo is reported by line;
  `gifts.cheque_asset_id` must stay in `collectLiveAssetRefs`. (BUILD-95)
- **A pledge schedule must sum to the pledge; an unpaid sponsor or award is a pledge, never money.**
  A matching payment applies inside `recordGift` from any door; within-10% is not matched there;
  a shell pledge never goes late. (BUILD-88b, BUILD-98)
- **Staff-typed gifts take the org's unrestricted default; donor-initiated gifts that designated nothing
  stay undesignated.** The server names the default (`isOrgDefault` via `ensureOrgLedger`); a refused
  fund id never becomes a different fund. (BUILD-88a)
- **A fund named in an import is a fund.** Match case-insensitively, create the rest unrestricted, and
  refuse a money-shaped cell as a fund name (`fundNameFromCell`). (BUILD-88a)
- **A payment against a restricted award posts to the grant's fund, inside `recordGift`.** Restricted
  remaining is received minus spent; overspent is shown, never clamped to zero. (BUILD-100)
- **Campaign `raised` = gift payments net of donor-covered fees + awarded grants.** Pledged is a
  separate figure, never summed in; a pledge payment inherits the pledge's campaign. (FIX attribution)
- **Attribute gifts to campaigns by `campaign_id`, never free text.** Foreign campaign is 404; a giving
  page's own campaign wins over a client-sent one; ambiguous attribution attributes nothing. (BUILD-32, FIX attribution)
- **Goal progress is computed, never stored.** Every thermometer is a live SUM; roll-ups sum top-level
  goals only; an exceeded goal shows `rawPercent`/`over`, the bar uses capped `percent`. (BUILD-21, FIX goals)
- **Goals count donor intent; Reports, Finance, receipts and donor totals count the charged gross.**
  The fee gross-up is server-derived only; a source's processor fee sits in `processor_fee_amount`,
  never `cover_fee_amount`. (FIX attribution, BUILD-89S)
- **Giving sources are read-only, provably.** Adapters get `readOnlyHttp`, not `fetch`; the only POST is
  in `READ_ONLY_EXCEPTIONS`; `sources/stripeSource.js` shares no code or SDK with Steward's Stripe. (BUILD-89S)
- **Source de-duplication is provider plus the provider's id, namespaced** (`paypal:…`). Donor match is
  exact email or a new donor, never a name; fund is the source default or nothing. (BUILD-89S)
- **Source credentials have no plaintext path.** `shared/secretBox.js` throws without
  `STEWARD_CREDENTIAL_KEY`; rotating the key orphans every stored credential. (BUILD-89S)
- **Square imports nothing until the org names its giving locations or items.** The refusal is loud;
  amounts are minor units; Square stays off the public allowlist until real money has run. (BUILD-95)
- **A statement file is a preset on the one mapper, never a second importer** (`shared/sourcePresets.js`).
  A named non-gift movement is refused whichever sign it carries. (BUILD-89S)
- **Source refunds are counted and named, not reversed.** A delete would be re-created by the next
  sync. Full Stripe refunds do reverse; partials shrink the gift and its stamp. (BUILD-89S, FIX attribution)
- **Online money is idempotent in the database.** `uq_gifts_stripe_pi` + `INSERT … ON CONFLICT DO
  NOTHING RETURNING`, with side effects only if a row was reserved. (BUILD-27)
- **Label money honestly.** "Recovered" is only what the failed-card workflow won back (re-engaged is
  separate); say "giving", never "revenue"; optional other income is never summed into giving. (BUILD-26, BUILD-32, BUILD-88a)
- **Read the fiscal year through `orgPeriodBounds`/`finPeriodBounds`, never string arithmetic.** The
  boundary comes from `fiscal_year_start_month` (July default); receipts use the calendar year. (BUILD-86, BUILD-88a)
- **The bookkeeper export must foot in cents before a byte is written.** Mismatch is a 409, nothing
  repaired; the database sum is asked for exactly, not pre-rounded (`bookkeeper.js`). (BUILD-87)

## Gotchas
- **`normalizeMoney` returns `{value, warn, blank}`, not a number.** Parse through the money seam
  before any `Number()` guard, or "1,000.00" is refused. (BUILD-89S, BUILD-88b)
- **pg serialises NUMERIC as a string.** `0 + "5000.00"` concatenates; sum in integer cents and
  `parseFloat` at the client boundary. (BUILD-100, BUILD-08)
- **A deposit fixture with no org default fund places zero blank-memo lines.** That is `needs_you` by
  design; set a default fund in the fixture. (BUILD-95)
- **The gift-to-ledger stamp no-ops without the '4010' account.** Fixtures must call
  `/onboarding/complete` to seed the chart of accounts. (BUILD-43)
- **Clean up money data with the dry-run scripts, never by hand.** `build88a-dedupe-gifts.js`,
  `dedupe-finance-gift-stamps.js`, `backfill-campaign-attribution.js` are dry-run by default. (BUILD-88a, BUILD-21, BUILD-32)

## Where the code is
- `server.js` `recordGift` / `checkGiftExtras` / `writeGiftExtras` — the one gift write and its extras
- `money.js` — the money seam (`toCents`); `shared/importShape.js` `normalizeMoney` — the one money parser
- `shared/giftCredit.js` — soft credit, tribute and match rules
- `shared/depositSheet.js` — the deposit sheet's four-state plan
- `shared/givingSources.js`, `sources/`, `shared/sourcePresets.js`, `shared/secretBox.js` — giving sources
- `shared/restrictedMoney.js` — restricted-award balances
- `server.js` `stampGrantAward`, `ensureOrgLedger`, `fundraisingCampaignRows`, `computeFundraisingPace`
- `orgTime.js` `orgPeriodBounds`; `server.js` `finPeriodBounds` — fiscal and calendar period bounds
- `scripts/consistency-audit.js` — read-only cross-surface reconciliation; run before a pilot goes live

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Fiscal year (moved from the old CRITICAL WORKING RULES)

- Fiscal year = July 1 boundary (reuse fyStart logic from /dashboard/my-stats). Finance has a fiscal/calendar toggle (localStorage key "steward_fin_yearmode", default fiscal).

## Database tables (moved from the old "Database — key tables and columns")

### gifts
- amount, date, type, campaign, notes, stripe_payment_id, campaign_id
- fund_id TEXT — for fund affinity tracking
- payment_method TEXT — how gift was received
- acknowledgement_sent BOOLEAN DEFAULT false

### campaigns (extended)
- briefing TEXT — strategy/talking points, editable auto-save
- goal_amount NUMERIC, raised_amount NUMERIC DEFAULT 0
- start_date DATE, end_date DATE
- Raised is calculated live from gifts where campaign=name OR campaign_id=id

### Finance tables
- fin_transactions — id, org_id, date, description, vendor_donor (TEXT display name), amount, type (income/expense), account_id, fund_id, notes, receipt_url, is_sample, **donor_id** (nullable — added BUILD-09; the donor this row came from, for link-through; expenses/manual entries have none) and **source** (`manual`|`gift`|`online`|`import`, default `manual`, added BUILD-09; how the row entered the ledger — badged in the unified Transactions view) and **gift_id** (nullable, added BUILD-21; the gift this row was auto-stamped from — manual/expense rows have none) and **grant_id** (nullable, entity-routing FIX 2026-08-04; the grant whose award this row books — see "Finance entity-routing"). `source` also takes `'grant'` (the award auto-stamp). NB: earlier docs claimed fin_transactions had no donor_id; BUILD-09 added it. Indexes: `idx_fin_txns_org_date`, `idx_fin_txns_org_fund`, the partial-unique `uq_fin_txns_gift (gift_id) WHERE gift_id IS NOT NULL` (db.js) that enforces "every gift stamps the ledger exactly once" — see "Home hero · Funds crash · gift double-stamp (BUILD-21)" — and its grant twin `uq_fin_txns_grant (grant_id) WHERE grant_id IS NOT NULL` ("a grant award stamps the ledger exactly once").
- fin_accounts — id, org_id, name, type (checking/savings/credit), balance, institution
- fin_funds — id, org_id, name, balance, target, restricted (boolean), description
- fin_budgets — id, org_id, category, amount, period (monthly/annual), fund_id
- fin_audit_log — id, org_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values
- LEGACY (do not use for new Finance UI): `financials` (monthly pre-aggregated rows) + `funds` (old fund balances), served by `GET /financials`. `Finance.jsx`'s Overview subtab used to read fund balances + monthly breakdown from this legacy pair via the `data.financials.*` prop, which had diverged from the live `fin_*` data shown on every other Finance subtab. Fixed: Overview now derives from the same `/finance/funds` + `/finance/transactions` state (`fundBalances`, computed client-side as income − expense per fund) that the rest of Finance already uses — including the 6-Month Forecast / Risk Analysis AI prompts. The `financials`/`funds` tables and `GET /financials` route still exist but should be treated as legacy/unused going forward.

### Finance (reintegrated) — BUILD-09, 2026-07-17
Finance was hidden by the 2026-07-12 pivot; BUILD-09 **un-hid it AND rebuilt it to current design standards with Stripe woven in** (redesign-and-rewire, not just an un-hide — it predated the five-color rule, the sidebar shell, SectionTabs, and the load-test index discipline). `Finance.jsx` takes `isReadOnly` + `onNavigate` from App.jsx.
- **Nav**: `Finance.jsx` is `SectionTabs` (`components/shared.jsx`) with six sections — **Overview · Transactions · Funds · Budgets · Accounts · Audit Log**. The old internal "Reports" subtab was dropped (financial reports live in the Reports tab — Overview's "Gifts by fund →" cross-links there via `onNavigate("reports")`); the redundant "Donor Giving" subtab was dropped (Reports' Top Donors covers it). Five-color palette only: money-in = greenMid, money-out = terracotta, restricted fund = gold — every prior blue/purple/orange/red/pink is gone. Narrative-first `PageTitle` sub ("You're operating on $X across N funds…"), warm empty-state voice per subtab, `isReadOnly`-gated add/edit buttons (standard RO tooltip).
- **Money in (Overview)** — `MoneyInStrip` fetches `GET /finance/stripe-summary` (requireAuth): connected-account **balance** (available/pending) + **last 5 payouts** (amount/date/status), org-scoped strictly by the caller's `orgs.stripe_account_id`, **5-min in-memory cache per org** (`stripeSummaryCache`), graceful `{connected:false}` (warm "Connect Stripe →" prompt deep-linking to Settings→Giving) on no-account / no `STRIPE_SECRET_KEY` / any Stripe error — never 500s the tab, never touches platform billing (`/billing/*`). Payout↔gift reconciliation is deliberately NOT built (a note points staff to the online gifts in the ledger; full reconciliation is future work).
- **Unified ledger (Transactions)** — one `fin_transactions` row per gift as before (no new insert path → no double-count). Every gift→ledger sync path now stamps `donor_id` + `source`: the Stripe webhook `payment_intent.succeeded` → `online`, `POST /donors/:id/gifts` → `gift`, both bulk gift-import paths → `import`, `POST /finance/transactions` → `manual`. The ledger badges the source and links `donor_id` through to the profile (`onNavigate("donors",{selectDonorId})`); filters by type/source/fund/year. `GET /finance/transactions` returns `donor_id`/`source` via `ft.*` and its `donor_id` query-param filter now resolves (column exists).
- **Write-gating**: `checkWriteAccess` added to all fin write routes — `POST/PUT /finance/accounts`, `POST/PUT /finance/funds`, `POST /finance/transactions`, `POST /finance/budgets` (a read_only org gets 402). `DELETE /finance/transactions/:id` stays ungated per the DELETE-routes convention. Reads never gated.
- **Explicit non-goals** (unchanged from the build brief): full payout↔gift reconciliation, accounting exports (QuickBooks etc.), budget-approval workflows, resurrecting the legacy `financials`/`funds` tables or the old internal Reports subtab, any platform-billing surface inside Finance.
- **Verified**: `tests/finance-reintegration.test.js` — 23/23 against a local scratch server + Postgres (schema columns + indexes, stripe-summary disconnected/org-scoped shapes, gift→exactly-one-ledger-row provenance with source+donor_id, manual=source, donor_id filter, write-gating 402 on a trial_expired org with reads still 200 and DELETE ungated, org isolation). The **connected** stripe-summary branch (real balance/payouts) is an optional leg gated on `STRIPE_TEST_KEY`+`STRIPE_TEST_ACCOUNT` — not exercised in the dev environment (no creds). Local visual pass driving the real UI (login → Finance → Overview Money-in strip → unified ledger source/type/fund badges) at desktop width; the mobile screenshot-matrix re-run against prod is still owed post-deploy.

#### Overview credibility + copy — BUILD-10 Part 3, 2026-07-17
Every number on the Overview is now mutually consistent and honestly scoped — the fix for a treasurer seeing numbers that can't both be true (a ~$626k Cash on Hand next to a ~$5k current-period ledger, a headline that repeated the period-net twice, and a Monthly Breakdown that ignored the fiscal basis and rendered a wall of $0 bars).
- **No `fin_accounts`/starting-balance model exists** (the accounts table is `accounts` — chart of accounts only, no balance column). Cash on Hand is **already 100% ledger-derived** (`Σ all income − Σ all expense`, all-time). So the spec's Path R (reconcile account starting balances) and Path S (edit/exclude a seeded balance) were both **N/A** — there is nothing to reconcile or exclude. **Chosen: Path L (Label + reconcile-by-construction)** — Cash on Hand equals the ledger by definition; the defect was that it sat *unlabeled* next to current-period revenue. Do not add an account-balance data model here without new direction.
- **`GET /finance/summary` is the single Overview endpoint** (org-scoped via `req.user.orgId`). One FY definition — the July-1 rule via the new `finPeriodBounds(yearMode, offset)` helper (offset 0 current, -1 prior; identical boundary to `/dashboard/my-stats`/Reports, no second definition introduced). It now returns, alongside the existing `cashOnHand`/`ytd*`/`netSurplus`: `priorRevenue`/`priorExpenses`/`priorNet` (prior period, same basis), `monthly` (current-period months in **basis order — Jul-first under fiscal**) + `monthlyLabel` (`"FY 2026–27"` fiscal / `"2026"` calendar), all-time per-fund `fundBalances`, and `activeFundCount` (funds with a txn in the **current period**). `cashOnHand` stays all-time and basis-independent.
- **Headline** (`financeHeadline` in Finance.jsx) degrades gracefully: figure = current-period revenue "across N funds" (N = active-in-period, not total-ever), delta vs the **prior period of the same basis**. Guards: no prior history (`prior<=0` OR `delta===current`) drops the comparison clause; a fully-empty period yields a warm empty-state sentence; **the same number never appears twice in one sentence**. `fmtFull` used throughout.
- **Stat cards carry scope captions** — Cash on Hand is labeled `"All-time · income − expenses"` (the reconciliation a treasurer can verify by hand); the period cards carry the period label. **Fund Balances card is now all-time cumulative** ("Cumulative — all money in minus out, since inception"), so **Σ fund balances = Cash on Hand** (reconciles exactly; a negative fund renders terracotta). **Monthly Breakdown follows the basis and collapses empty months** into `"No activity yet in the other N months."` (never a wall of $0 bars).
- **Demo-data coherence fix**: the demo org's $626k was inflated by **76 orphaned gift-sync `fin_transactions`** (all dated 2025-12-31, `donor_id=NULL`, one 2026-06-12 batch, don't match the ~$162k of real donor giving — left behind when test donors were purged; purge-trash leaves `fin_transactions` untouched). Removed via `scripts/fix-demo-finance-ledger.js` (committed, **idempotent, dry-run by default**, `--apply` to execute; exports the rows to `docs/demo-finance-orphans-removed-*.json` first, deletes via the audited admin API). Demo now: Cash $6,202 = Σ fund balances; FY 2026–27 revenue $5,002, no prior-FY history → headline clause dropped; calendar shows a believable "down $60,348 from last year." **Note: demo `fin_transactions` are illustrative and must stay coherent with the ledger — don't reintroduce bulk rows that don't reconcile.**
- **Verified**: `tests/finance-overview.test.js` — 33/33 (reconciliation `cashOnHand = Σledger` and `= Σfundbalances`; period vs prior split both bases; fiscal monthly starts Jul + `FY YYYY–YY` label; calendar Jan-first; empty-month collapse + "other N" count; `financeHeadline` guard cases incl. degenerate/empty/no-history; active-in-period fund count; org scoping). Crisp screenshots (deviceScaleFactor 3, ≥2× bar asserted) via `scripts/finance-overview-capture.js` → `docs/finance-overview-2026-07-18/` (fiscal, calendar, accounts). No new write route added, so nothing new to `checkWriteAccess`-gate; the seed fix deletes via the already-`requireAdmin` DELETE route (ungated per DELETE convention).

### Fundraising (BUILD-11) — 2026-07-18
The money-moving home. A tab (`components/Fundraising.jsx`) that organizes and elevates fundraising primitives that already existed (org goals, campaigns-with-goals, giving pages) into one world-class command view, plus the one net-new primitive that makes the landing hero honest: a **campaign Goal (target + thermometer + pace)**.

- **The Goal model is computed, never stored.** There is NO `raised` counter anywhere in this feature. Every thermometer is a live `SUM(gifts)` at read time (`fundraisingCampaignRows()` matches gifts by `campaign_id OR campaign`-name text, same as `/campaigns/:id/progress`), so a total can't drift from reality. `computeFundraisingPace(raised, goal, startDate, endDate)` (server.js) is the shared pace/thermometer math and **degrades gracefully**: no goal → `percent:null` (no thermometer, caller shows totals); goal but no dates → progress with `paceState:null` and no "days left"; goal met → `paceState:'met'` (celebratory); goal+dates+elapsed → `on_track`/`behind` vs `expected = goal × elapsed/total`. Lifecycle (`upcoming`/`active`/`ended`) is derived from dates — the email-`campaigns.status` column is NOT repurposed.
- **A "fundraising campaign" is a `campaigns` row with `goal_amount` set (>0).** No new table — it reuses the existing dual-purpose `campaigns` table (the same one Communications uses for email). A campaign with no goal is a pure email campaign and is excluded from the Fundraising tab entirely. Creating one here inserts a `campaigns` row with `status='draft'`, empty subject/body — it can later grow an email in Communications, or not.
- **Routes** (all org-scoped): `GET /fundraising/overview` (active org goal + pace, this-period momentum vs prior period via `finPeriodBounds` — one FY/period source of truth with Finance, campaign + giving-page rollups, recent gifts), `GET /fundraising/campaigns` (each goal'd campaign with live raised/donorCount/pace, batched — no N+1), `POST`/`PUT /fundraising/campaigns[/:id]` (`checkWriteAccess`-gated; name + goal + optional dates; 400 on missing name / non-positive goal). Reads never gated. Giving Pages tab reuses the existing `GET /giving-pages` (CRUD stays in Settings — one source of truth; the tab surfaces live thermometers + QR/embed + deep-link to Settings→Giving). Funds tab is a cross-link to Finance Funds (no duplication). `adaptData` now carries `org.org_slug` (added for the giving-page share links).
- **Deliberately deferred (NOT built overnight, and why):** peer-to-peer, events/ticketing, auctions, raffles, memberships, shops. Each is the competitors' surface area but a multi-day build with real money/edge-case risk; shipping half of one is worse than not having it. Scope was **organize + elevate what exists + the cheap honest Goal primitive**. (P2P fundraising infrastructure *does* already exist at the data layer — see "Peer-to-peer fundraising" — this tab just doesn't surface a P2P management UI yet.)
- **Demo seed**: `scripts/seed-fundraising-demo.js` — idempotent (no-op once the campaign has raised>0), goes through the real API, seeds ONE coherent arts campaign ("Spring Studio Scholarships", $9,800 of $15,000, on-track) on real demo donors so the Overview tells a true, attractive story. **Defaults to LOCAL** (`BASE=http://localhost:5601`); running against prod writes real demo gifts and is a deliberate opt-in (`BASE=<railway> DEMO_EMAIL=… DEMO_PASSWORD=…`). The landing hero (Build B) is meant to be captured from this live Overview.
- **Verified**: `tests/fundraising.test.js` — **34/34** against local scratch server + Postgres (goal pace math incl. on_track/met/behind/null degradation, raised = Σ attributed gifts recomputed-not-stored, no-goal campaign excluded, giving-page rollup, write-gating 402 on a trial_expired org with reads 200, POST validation 400s, org isolation). Crisp screenshots (deviceScaleFactor 3, 4320×3000 desktop / 1170-wide mobile) at `docs/fundraising-2026-07-18/` (overview, campaigns, campaign-modal, pages, funds, overview-mobile).

### Donor-covers-fees (BUILD-08 Phase B — 2026-07-17)
Optional "Add $X to help cover card-processing costs" checkbox on the public donate flow (all three page types — org-wide, Giving Page, peer fundraiser — one implementation in `Donate.jsx`, since they share the form).
- **`orgs.cover_fees_enabled BOOLEAN DEFAULT true`** — org-level switch, admin toggle in Settings → Giving Pages (`CoverFeesCard`, saves via `PATCH /orgs/:id {coverFeesEnabled}`; that route now skips its profile-fields UPDATE when the request carries none of them, so a toggle-only PATCH can't null the org's mission/website). Default on for all orgs; the donor-side checkbox itself is **always unchecked by default** — nothing is added silently.
- **Gross-up is server-derived, never trusted from the client**: `POST /donate/:orgSlug` accepts only a `coverFees` boolean; `coverFeesGrossUpCents(net) = ceil((net + 30) / (1 - 0.029))` (standard Stripe card rate) computes the charged amount. `Donate.jsx` has a display-only copy (`grossUpCents`) that the committed suite keeps in lockstep with the server's by parity sweep. Works for one-time AND recurring (the recurring price is the grossed-up amount). Session metadata records `cover_fees`/`base_amount_cents` for reference only.
- **The full charged amount IS the donation** — the webhook's gift insert uses `pi.amount_received`, so the gift row, donor totals, and the auto-issued tax receipt all record the grossed-up total. No fee itemization anywhere.
- **INTEGER→NUMERIC money migration came with this**: `gifts.amount`, `donors.total_giving`, `donors.last_gift_amount` were INTEGER since the original schema — any cents-carrying online gift (a $50.50 custom amount, or every covered-fees total) made the webhook's INSERT throw and the gift was **silently lost** (Stripe got a 200, no retry). Found live by the Phase B suite. db.js migrates them via guarded DO blocks (only ALTERs while still integer — ALTER TYPE takes an exclusive lock + rewrite, so it must not run every boot). Client adapters (`adaptDonor` in api.js, DonorProfile's gift fetch) now `parseFloat` these since pg serializes NUMERIC as strings.
- `donateLimiter` now honors `DISABLE_RATE_LIMIT=1` like the general/login/register limiters (local suites hit /donate repeatedly).
- **Verified** (tests/cover-fees.test.js — committed): 24/24 against local scratch server + REAL Stripe **test mode** (needs `STRIPE_TEST_KEY` sk_test + `STRIPE_TEST_ACCOUNT`, a charges-enabled test connected account; `FULL_E2E=1` + `stripe listen --forward-connect-to` adds the end-to-end leg). Covers: client/server math parity sweep, all three public endpoints exposing the flag, covered $50 → real Checkout Session of 5181¢ (verified via Stripe API) with metadata, uncovered → 5000¢, client-sent totals ignored, recurring $25/mo → 2606¢/mo subscription, toggle-off hides AND refuses server-side, no-clobber PATCH, and a REAL 4242-card checkout completion → webhook → gift row $51.81 → auto-receipt $51.81 → donor total $51.81. Screenshots: docs/cover-fees-2026-07-17/.
