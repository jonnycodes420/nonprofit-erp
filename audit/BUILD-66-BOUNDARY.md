# BUILD-66 — Part 0: the boundary inventory

**Status: REPORT — awaiting Jonathan's review before any building begins.**

This classifies every module, route, table, background job, email template, and
test suite in the Steward repo into exactly one of three buckets:

| Bucket | Meaning |
|---|---|
| **KB** | Belongs to Kingdom Builders (the donor-facing giving product). |
| **STEWARD** | Stays behind. Not copied. |
| **SHARED** | Copied into Kingdom Builders **and** kept in Steward. |

The governing rule for Part 0 and every part after it: **this is a fork, not a
move.** Nothing here is deleted, moved, or refactored in the Steward repo. This
file is an additive audit artifact only.

Method: enumerated from the live tree — `db.js`/`server.js` `CREATE TABLE`, every
`app.<verb>` route, every `setInterval`/`setTimeout` job, every `send*Email`/
`*EmailHtml`/`render*Pdf` builder, `client/src/{components,pages,lib}`, and
`tests/*.test.js`. Counts as surveyed: **~87 tables · ~250 routes · 16 periodic
jobs · ~22 mail/PDF builders · ~30 components + 19 pages + 14 libs · 112 test
suites.**

The starting hypothesis from the brief is the baseline. Where reality diverges,
it's called out. **Everything I could not classify with confidence is in
§UNCLEAR at the bottom — those are Jonathan's to decide.**

---

## 1. The product line, in one paragraph

Kingdom Builders is the **donor-facing giving network**: a person makes an
account, gives to organizations through white-label portals and public giving
pages, sees all their giving in one cross-org dashboard, manages their own
recurring gifts, and gets receipts and year-end statements. An organization
signs up (gated approval), configures its portal/funds/campaigns/impact updates,
and receives money through its own Stripe. Steward keeps everything a
**development office** needs the donors it already has: portfolios, moves, asks,
grants, pledges, per-officer reporting, retention analytics, tasks, workflows.
The two products share the money spine — organizations, donors, gifts, funds,
campaigns, the ledger, receipts, recurring subscriptions, assets, the Stripe
webhook, the reconciliation guard, and outbound mail.

---

## 2. Database tables (87)

### SHARED — the money/identity spine (copied to KB, kept in Steward)
| Table | Why SHARED |
|---|---|
| `orgs` | The organization record. Both products. (Some columns are Steward-only — see §UNCLEAR U-1.) |
| `users` | Org-side staff auth. KB needs org admins to configure their portal. |
| `donors` | Donor records. KB writes them from the giving page; Steward is the CRM. (The rich CRM *surface* is STEWARD — see §UNCLEAR U-2.) |
| `gifts` | Every gift. The single money row both read. |
| `fin_funds` | Funds — designation target on the giving page + ledger. |
| `accounts` | Chart of accounts (`ensureOrgLedger`, the `'4010'` stamp target). |
| `fin_transactions` | The ledger. Every gift stamps it once. |
| `fin_audit_log` | Ledger audit trail (travels with the ledger). |
| `campaigns` | Campaigns — donor-facing name/story/hero render on the KB giving page + attribution. (`goal_amount`, story blocks.) |
| `receipts` | Gift receipts + year-end statements. Brief puts both in KB *and* SHARED → SHARED. |
| `recurring_subscriptions` | Recurring gift health record. |
| `recurring_change_log` | Append-only recurring movement ledger. |
| `recurring_proposals` | Staff→donor "move money" invitations. |
| `payment_recovery_events` | Failed-card recovery / dunning ledger. |
| `portal_assets` | Content-addressed asset store (logos, headers, impact photos). |
| `asset_pointer_history` | Pointer history (Part 6 guard). |
| `asset_purge_log` | Soft-delete/purge audit (Part 6 guard). |
| `email_suppressions` | Deliverability + marketing suppression (outbound mail). |
| `notification_failures` | Durable failed-send queue (outbound mail insurance). |
| `schema_meta` | db.js fast-path boot marker (infra). |

### KB — donor-facing giving network
| Table | Belongs to |
|---|---|
| `donor_accounts` | Global donor identity (cross-org). |
| `donor_account_aliases` | Verified alias emails. |
| `donor_account_links` | Account↔donor-record links (verified-email only). |
| `donor_account_audit` | Account lifecycle audit. |
| `donor_account_resets` | Password reset tokens. |
| `donor_account_signin_links` | Emailed sign-in links (front door). |
| `donor_org_follows` | Directory follow flow (dashboard-side, under THE WALL). |
| `portal_settings` | Per-org white-label theme + portal config. |
| `portal_pages` | Page-builder draft/published. |
| `portal_magic_links` | Portal magic-link auth (hash-at-rest). |
| `portal_sessions` | Portal + account sessions. |
| `portal_audit_log` | Portal access/mutation audit. |
| `impact_updates` | Impact feed content. |
| `giving_pages` | Public campaign donation pages. |
| `peer_fundraisers` | Peer-to-peer fundraiser pages. |
| `network_applications` | Nonprofit signup approval queue. |
| `ein_registry` | IRS Pub-78 EIN validation for signup gate. |

### STEWARD — development-office CRM
| Table | Belongs to |
|---|---|
| `moves` | Moves management. |
| `opportunities` | Ask-vs-gift. |
| `households` | Households + soft credit. |
| `donor_relationships` | Constituent relationships. |
| `donor_designations` | Planned-giving segment tags. |
| `planned_gifts` | Planned giving. |
| `pledges` | Pledges. |
| `grants` | Grants. |
| `grant_interactions` | Grant touchpoints. |
| `programs` | Programs. |
| `program_grants` | Program↔grant links. |
| `tasks` | Tasks. |
| `workflows` | Retention workflow recipes. (Dunning coordination — see §UNCLEAR U-3.) |
| `workflow_runs` | Workflow run log. |
| `sequences` / `sequence_steps` / `sequence_enrollments` | Email sequences. |
| `milestone_drafts` | AI milestone draft review queue. |
| `note_reminders` | Personal-note nudges. |
| `fundraising_goals` | Legacy single goal. |
| `annual_fund_goals` | Annual Fund. |
| `custom_fields` / `custom_field_values` | CRM custom fields. |
| `metric_snapshots` | Stewardship-debt / first-touch-delay / recovery-rate trends. |
| `board_members` / `board_reports` | Board. |
| `events` / `event_attendees` | Events. |
| `volunteers` | Volunteers. |
| `campaign_recipients` | Email campaign recipients. |
| `gmail_connections` / `gmail_sync_exclusions` | Gmail CRM sync. |
| `digest_sends` | Week-in-Review / per-officer digest idempotency. |
| `notification_sends` | Officer-notification dedup. |
| `invites` | Staff invites. |
| `invitation_requests` | Steward invitation-only funnel. |
| `demo_requests` | Steward demo requests. |
| `password_reset_tokens` | Staff password reset. |
| `financials` / `funds` | Legacy pre-`fin_*` tables (dead). |
| `ai_log` | AI usage log. |
| `migc_contacts` / `migc_subscribers` / `migc_events` | Mi Gulf Coast client-site integration (a specific Steward customer). |

### Money-safety guards — SHARED (Part 6 carries these into KB)
| Table | Guard |
|---|---|
| `billing_webhook_events` | Idempotency ledger — but see §UNCLEAR U-4 (platform billing). |
| `dispute_reversals` | Won-dispute reinstatement (BUILD-65 Part 7). SHARED — donation-side. |

---

## 3. Backend modules (top-level `.js`)

| Module | Bucket | Note |
|---|---|---|
| `server.js` | **SPLIT** | The 20k-line monolith holds all three buckets. KB copies the KB+SHARED route/handler set; the STEWARD handlers are removed in KB (Part 3). This is the single biggest carve. |
| `db.js` | **SPLIT** | Schema for all buckets. KB gets the KB+SHARED tables only (Part 2). |
| `auth.js` | SHARED | requireAuth/requireAdmin/requireSuperAdmin. |
| `sessionCache.js` | SHARED | Session cache. |
| `stripeKeys.js` | SHARED | Donation vs billing key resolver (billing half → see U-4). |
| `stripeEvents.js` | SHARED | Webhook event manifest + diff (Part 6 guard). |
| `publicUrl.js` | SHARED | Canonical email URL resolver (outbound mail). |
| `assetStore.js` | SHARED | Object-storage driver + destruction seam (Part 6). |
| `branding.js` | SHARED | Accent normalization / contrast guard (portal theming). |
| `guards.js` | SHARED | `computeGuardsOk` (Part 6). |
| `billingPlans.js` | STEWARD | Core/Team plan↔price mapping (Steward's commercial model). See U-4. |
| `trialEnd.js` | STEWARD | Steward's "free through 2026" pricing promise. |
| `matchingGifts.js` | STEWARD | Employer matching-gift lookup (CRM donor profile). |
| `generate-favicons.js` | STEWARD | Steward brand asset tooling. |
| `routes/migc.js` | STEWARD | Mi Gulf Coast client-site API. |

---

## 4. Routes (~250), grouped by family

### KB routes
- **Donor accounts / auth**: `/account/*` (signup, verify, login, logout, request-link, link-verify, request-reset, reset, change-email[/confirm], change-password, aliases[/verify], links/:id/{unlink,relink}, orgs/add, follows/:id, dashboard, me, recurring, tax-summary).
- **Portal**: `/portal/:orgSlug/*` (config, session, me, verify, request-link, logout, give-default, receipts/:id/pdf, impact/:updateId/viewed, recurring/:subId/{amount,cancel,pause,resume,update-card}), `/portal-settings`, `/portal-page[/draft,/publish,/revert,/starter]`, `/portal-audit`, `/portal-engagement`, `/portal-assets/:id`, `/impact-updates` (CRUD).
- **Public giving**: `/donate/:orgSlug`, `/give*` (client), `/org/:orgSlug/public`, `/org/:orgSlug/giving-page/:pageSlug[/fundraiser/:fs]/public`, `/org/public-list`, `/giving-pages` (CRUD + `/:id/fundraisers`), `/org/:orgSlug/giving-page/:pageSlug/fundraisers`, `/peer-fundraisers/manage/:token`, `/peer-fundraisers/:id`.
- **Network**: `/network/{config,signup,application,directory}`, `/admin/network/{applications,applications/:id/decide,run-gate-sweep}`.
- **Recurring donor self-service**: `/recurring/{proposal,proposal/confirm,update-card}` (public token paths).

### SHARED routes
- **Staff auth**: `/auth/{login,register,register-org,forgot-password,reset-password,invite,invite/accept}`, `/me`, `/org`, `/orgs/:id` (PATCH), `/org/team`.
- **Gifts + receipts**: `/donors/:id/gifts`, `/gifts/:id` (PUT/DELETE), `/gifts/:id/receipt`, `/receipts/{:id/pdf,:id/void,preview,year-end-run}`, `/donors/:id/{receipts,year-end-statement}`.
- **Stripe donation path**: `/stripe/{connect,webhook,status,online-gifts,campaign-link,donation-page}`, `/finance/stripe-summary`.
- **Ledger/funds core**: `/finance/{funds,summary}` (the stamping + fund reads KB needs). *Finance-tab management routes → STEWARD, see U-5.*
- **Reconciliation + webhook guards**: `/admin/{reconcile/run,webhook-subscriptions/check}`, `/health`.
- **Outbound mail plumbing**: `/unsubscribe` (GET/POST), `/resend/webhook`, `/track/:recipientId/open.gif`.
- **Recurring subscription lifecycle** (webhook-driven, shared): the recurring handlers inside `/stripe/webhook`.

### STEWARD routes
- **Pipeline/moves/asks**: `/pipeline*`, `/donors/:id/{moves,move-suggestions,opportunities,stage,assign}`, `/donors/bulk-{stage,assign}`, `/donors/:id/score`, `/opportunities/:id`, `/portfolio/officers*`.
- **Grants/programs/pledges/planned**: `/grants*`, `/programs*`, `/pledges*`, `/donors/:id/{planned-gifts,pledges,designations}`, `/planned-gifts/:id`.
- **Households/relationships**: `/households*`, `/donors/:id/{relationships,soft-credit}`, `/donor-relationships/:id`.
- **Tasks/workflows/sequences**: `/tasks*`, `/workflows*`, `/sequences*`, `/milestone-drafts*`, `/note-reminders*`.
- **Reports/digests**: `/reports/*` (board, `:key`), `/digests/*`. *Giving-summary report → see U-6.*
- **CRM surfaces**: `/donors/{import,import-combined,duplicates,merge,summaries,my,stage-counts,custom-field-values/all}`, `/gifts/import-history`, `/custom-fields*`, `/donors/:id/{custom-fields,fund-affinity,impact-summary/pdf,tasks,events}`.
- **Finance mgmt tab**: `/finance/{accounts,budgets,transactions,audit-log}`, `/financials*`. (See U-5.)
- **Dashboard/metrics**: `/dashboard/*`, `/metrics/*`, `/annual-fund*`, `/goals*`, `/fundraising/*` (see U-7).
- **Gmail**: `/gmail/*`.
- **Events/volunteers/board**: `/events*`, `/volunteers*`, `/board*`, `/reports/board*`.
- **Recurring STAFF surface**: `/recurring/{roster,movement,exceptions,health}`, `/recurring/subs/:subId/{pause,resume,cancel,fund}`, `/recurring/proposals*`, `/recurring/:donorId/resend`, `/recurring/process-dunning`. (See U-8 — the staff roster vs the engine.)
- **Platform billing**: `/billing/*`, `/admin/{billing-diagnostic,orgs/:id/change-plan,orgs/:id/extend-trial}`. (See U-4.)
- **Steward marketing**: `/invitation-request`, `/demo-request`.
- **Super-admin ops**: `/admin/{orgs,orgs/:id,data-integrity,data-integrity/fix,metrics,notifications/retry,debug/sentry-test}`.
- **MIGC**: `/api/migc/*` (via `routes/migc.js`).

---

## 5. Background jobs (16 periodic)

| Job | Bucket |
|---|---|
| `reconcileStripeVsGifts` + `refreshReconcileDenominator` | SHARED (reconciliation guard). |
| `checkWebhookSubscriptions` | SHARED (webhook manifest guard). |
| `purgeExpiredAssets` | SHARED (asset retention). |
| `processDunning` | SHARED (failed-card recovery — the KB giving product needs it). |
| `processScheduledCampaigns` | SHARED-leaning (send infra) — but campaign scheduling is Steward comms → see U-9. |
| `processSmartMoves` (auto-lapse) | STEWARD. |
| `processDigests` | STEWARD (Week-in-Review / per-officer). |
| `processDailyTaskReminders` | STEWARD. |
| `processWorkflowSweeps` | STEWARD (workflow recipes) — dunning coordination U-3. |
| `processPledgeReminders` | STEWARD. |
| `processNetworkGate` (auto-delist sweep) | KB (network). |
| `syncAllGmail` | STEWARD. |
| `checkTrialExpiry` | STEWARD (platform billing / trial). |
| `snapshotAllOrgMetrics` | STEWARD (stewardship-debt/first-touch trends). |
| `retryFailedNotifications` | SHARED (outbound-mail insurance). |
| `processSequences` | STEWARD (email sequences). |

---

## 6. Email templates + PDF renderers (~22)

| Builder | Bucket |
|---|---|
| `sendRawEmail` / `sendDonorLifecycleEmail` | SHARED (mail plumbing). |
| `brandEmailHeaderHtml` | SHARED (org branding band). |
| `unsubscribeEmailFooterHtml` | SHARED (CAN-SPAM). |
| `sendReceiptEmail` + `renderReceiptPdf` | SHARED (receipts + year-end PDFs). |
| `sendDunningEmail` + `DEFAULT_DUNNING_*` | SHARED (recovery). |
| `sendRecoveredThankYouEmail` | SHARED (recovery). |
| `sendRecurringDonorEmail` | SHARED/KB (recurring self-service transactional). |
| `sendPortalMagicLinkEmail` | KB (portal auth). |
| `sendPortalMutationEmail` | KB (portal). |
| `consumerEmailHtml` / `givingAccountEmailFooterHtml` | KB (donor account / cross-org). |
| `sendFundraiserManageEmail` | KB (peer-to-peer). |
| `sendGiftAlertEmail` | STEWARD (officer internal alert). |
| `sendWorkflowEmail` | STEWARD (workflow recipes). |
| `sendDigestEmail` | STEWARD (Week-in-Review). |
| `sendPledgeReminderEmail` + `DEFAULT_PLEDGE_REMINDER_*` | STEWARD (pledges). |
| `impact-summary/pdf` renderer | STEWARD (CRM donor PDF). |
| `reports/board` PDF | STEWARD (board reports). |

---

## 7. Client (30 components · 19 pages · 14 libs)

### KB
- **Pages**: `Donate.jsx`, `ManageFundraiser.jsx`, `Portal.jsx`, `PortalEditor.jsx`, `GivingDashboard.jsx`, `JoinNetwork.jsx`, `publicTheme.js`, `PrivacyPage.jsx`/`TermsPage.jsx` (KB gets its own copies — see U-10).
- **Components**: `Portal*` (`PortalBanner`, `PortalWidgets`), `DonorPortalHub.jsx`, `ShareBlocks.jsx`, `Uploader.jsx`, `PortalManager`/`ImpactUpdatesManager` (exported from Settings).
- **Libs**: `assetUrl.js`, `portalCrop.js`, `portalScale.js`, `portalScrim.js`, `portalTheme.js`, `storyBlocks.js`.

### SHARED
- **Components**: `shared.jsx` (design tokens/`T`, `fmt`), `TopBar.jsx`, `MetricBreakdownPanel.jsx` (portal-agnostic bits).
- **Pages**: `LoginPage.jsx`, `SignupPage.jsx`, `ForgotPasswordPage.jsx`, `ResetPasswordPage.jsx`, `InvitePage.jsx`, `WelcomePage.jsx` (org-side staff shell — KB needs a trimmed version).
- **Libs**: `money.js`, `dirtyGuard.js`, `greeting.js`.
- `App.jsx` / `main.jsx` — **SPLIT** (KB gets a shell with only KB+SHARED tabs/routes).

### STEWARD
- **Components**: `Dashboard.jsx`, `Donors.jsx`, `Pipeline.jsx`, `Grants.jsx`, `Programs.jsx`, `Communications.jsx`, `Reports.jsx`, `Finance.jsx`, `Fundraising.jsx`, `Tasks.jsx`, `Workflows.jsx`, `RecurringGiving.jsx` (staff roster — U-8), `Settings.jsx` (SPLIT — U-11), `DonorMap.jsx`, `FunnelChart.jsx`, `AnnualFund.jsx`, `Events.jsx`, `Volunteers.jsx`, `Board.jsx`, `PlanPicker.jsx`/`UpgradeModal.jsx` (billing — U-4).
- **Pages**: `Landing.jsx`, `Invitation.jsx`, `Pricing.jsx`, `AdminDashboard.jsx` (super-admin ops — KB needs its own — U-12).
- **Libs**: `homeLayout.js`, `importShape.js`, `campaignMatch.js`, `financeMatch.js`, `taskDue.js`.

---

## 8. Test suites (112) — the batteries that must travel

### SHARED / KB batteries to carry green (Part 6 explicitly names most)
- **org-blindness** `org-blindness.test.js` — the WALL. KB (network) + SHARED discipline.
- **brand battery** — becomes KB's inverted "no `Steward` string" test (Part 4).
- **reconciliation** `reconciliation.test.js`, **guards** `guards.test.js`, **webhook-manifest** `webhook-manifest.test.js`, **webhook-ordering** `webhook-ordering.test.js` — money-safety, KB.
- **asset retention** `asset-retention.test.js`, `theme-assets.test.js`, `portal-crop/-visual/-contrast.test.js` — KB.
- **portal** `portal.test.js`, `portal-page.test.js`, `portal-designation.test.js` — KB.
- **donor accounts/network** `donor-accounts`, `donor-linking`, `donor-dashboard`, `donor-front-door`, `network-directory`, `network-gate` — KB.
- **gifts/receipts/idempotency** `gift-idempotency`, `cover-fees`, `stripe-disputes`, `giving-flow-brand`, `giving-summary` — SHARED/KB.
- **recurring** `recurring-surface` (SPLIT — staff vs donor), `first-login-matrix` (portal-tier).
- **consistency-e2e** — SHARED money invariants (SPLIT: drop CRM-only assertions in KB).
- **tenant-isolation**, **session-cache**, **session-privilege**, **permissions-matrix** — SHARED.

### STEWARD-only suites (not copied)
pipeline, moves, portfolios, pipeline-gating, smart-moves, portfolio-pipeline-consistency, solicitations-winrate, households, designations, grants (in report-truth/state-diff), pledges, tasks, task-due, workflows, workflows-e2e, digests, reports, reports-cadence, report-truth, home, home-layout, goals, fundraising, gift-attribution, finance-* (overview/funds/gift-stamp/entity-routing/reintegration/reports-consistency), import-* (assign/both/columns/combined/shape/stage), name-normalize, reserved-recovered, clickability, locked-features, upgrade-checkout, billing, billing-config-error, trial-end, migc, no-emoji, palette, brand-glyph, brand-allowlist, onboarding-brand, invitation, demo-content, officer-chip, notifications, notify-delivery, mail-suppression, email-polish, greeting, uploader, presentation-wiring, empty-states, state-diff/state-diff2, concurrency/concurrency2, ledger-provisioning, impact, setup-checklist, reserved-recovered.

*(Several of these are SPLIT — e.g. `email-links`, `email-footer`, `export-zip`, `ledger-provisioning`, `attribution-completeness` contain both KB-relevant and STEWARD-only assertions. Marked in §UNCLEAR where the split isn't obvious.)*

---

## §UNCLEAR — Jonathan decides these

**U-1 · `orgs` column split.** `orgs` is SHARED, but it carries Steward-only
columns (plan/trial/`stripe_customer_id*`/`subscription_status`/`grace_until`,
`recurring_dunning_*`, Gmail, receipt/tax identity, `network_listed`,
`cover_fees_enabled`, `setup_card_state`). KB copies the table; **which columns
come with it?** My lean: keep the money/portal/receipt/network columns, drop the
Steward commercial-plan columns (KB gets its own billing model, U-4).

**U-2 · The donor CRM surface.** `donors` (data) is SHARED, but the *rich CRM UI*
— wealth scoring, custom fields, merge-duplicates, the directory kanban, moves
rail — is STEWARD. KB needs *some* "who gave to us" view for an org admin. **How
much donor surface does a KB org get?** My lean: a read-oriented donor/gift list
scoped to the org, not the major-gifts CRM.

**U-3 · Workflows ↔ dunning coordination.** The brief puts workflows in STEWARD,
but recipe #1 (`failed_recurring_recovery`) coordinates with the always-on
dunning engine (SHARED) so they don't double-send. In KB there are no workflow
recipes, so dunning runs alone — **confirm KB ships dunning WITHOUT the workflow
layer** (I believe it cleanly does; recipe #1 just advances `dunning_step`).

**U-4 · Platform billing / monetization.** `/billing/*`, `billingPlans.js`,
`billing_webhook_events`, PlanPicker, Core/Team/founding, LockedFeature Team-gating,
portal-tier — all Steward's commercial model. **KB's monetization is undecided.**
My lean: platform billing = STEWARD; KB launches with billing as a stub / a
separate later decision. This likely wants its own `BLOCKED-build66-*.md`.

**U-5 · Finance management tab.** Ledger + funds + chart-of-accounts = SHARED
(KB needs stamping, funds for designation, receipts). But the full Finance tab
(budgets, manual transactions, accounts, audit-log UI, money-in reconciliation)
is org accounting. **Does a KB org get the Finance tab, or just the invisible
ledger + a funds editor?** My lean: KB gets a **funds editor** (needed to
configure designation) + the money-in view, not the full treasurer tab.

**U-6 · Which reports does KB get?** LYBUNT/SYBUNT/retention/3-year/top-donors =
STEWARD. But `giving-summary` is already granted to portal-tier orgs by the
network gate, and a KB org legitimately wants "what did we raise." **Is
giving-summary SHARED (copied) or STEWARD?** My lean: giving-summary → SHARED
(KB org-side "our giving"); every other report → STEWARD.

**U-7 · Fundraising tab / campaign goals.** `campaigns` = SHARED (render on the
giving page). But the Fundraising *dashboard* (typed roll-up goals, pace,
`fundraising_goals`/`annual_fund_goals`, Week-in-Review momentum) is a staff
surface. KB org-side admin **does** need to create campaigns (goal thermometer +
donor-facing story show on the public page). **Where's the line between "create a
campaign for the giving page" (KB) and "the Fundraising analytics tab"
(STEWARD)?** My lean: a lean KB **campaign editor** (name, goal, dates,
donor-facing story/hero, fund) travels; the roll-up analytics dashboard stays.

**U-8 · Staff recurring surface.** `recurring-surface`/`RecurringGiving.jsx` (the
roster, MRR waterfall, movement, exceptions, proposals) is staff-facing but it's
the *giving product's* operational heart. **KB or STEWARD?** My lean: KB — a KB
org must see and act on its recurring donors; the donor self-service half is
already unambiguously KB. This is the most consequential UNCLEAR item.

**U-9 · `processScheduledCampaigns` / email campaigns / sequences.** Email
campaigns (`campaign_recipients`, Communications.jsx, `/campaigns/:id/send`) are
Steward marketing comms → STEWARD. But `campaigns` the table is SHARED (giving
attribution). Confirm the **send/scheduling** machinery stays STEWARD while the
campaign *record* travels.

**U-10 · Legal pages.** `PrivacyPage.jsx`/`TermsPage.jsx`/`PricingPage` carry
Steward's legal + pricing copy. KB needs *its own* — copied-then-rewritten, or
authored fresh? (Ties to Part 4 rebrand + Part 8 BEFORE-YOU-LAUNCH attorney work.)

**U-11 · `Settings.jsx` split.** Settings holds both KB config (Donor Portal,
Branding, Giving Pages, Tax Receipts) and Steward config (Team, Integrations/
Gmail, Custom Fields, Impact Metrics, Billing). It's one big component that must
be carved, not copied whole. Flagging the surgery, not a decision.

**U-12 · Super-admin `AdminDashboard.jsx`.** KB needs its **own** super-admin ops
tool (network review queue, org management) — the network-review queue is already
KB. Copy-and-strip, or author a lean KB admin? My lean: copy the KB-relevant
routes (`/admin/network/*`, org list/extend) into a fresh lean KB admin.

**U-13 · `sequences`/`milestone_drafts`/`note_reminders`.** All STEWARD
(retention drafting). But `sequences` includes the **onboarding drip** — KB will
want *some* org-onboarding email. Confirm KB authors its own onboarding email
rather than carrying the sequence engine.

---

## Recommended cut, in one line

**KB = donor accounts + portal + page builder + impact feed + directory/follow +
public giving page + peer-to-peer + receipts/year-end + recurring (donor *and*
staff, pending U-8) + network signup/approval + asset store/theming + a lean
org-side admin (portal, funds, campaigns, impact) + the money-safety guards.
Everything a development office does with donors it already has stays in Steward.
The money spine is copied to both.**

**Stopping here per Part 0. Awaiting review of the buckets and the 13 UNCLEAR
items before Part 1 (the new repo).**
